import express from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs/promises';
import mammoth from 'mammoth';
import OpenAI from 'openai';
import XLSX from 'xlsx';
import { authenticateToken, requireCognitiveOrAdmin } from '../middleware/auth.middleware.mjs';
import { logCost, COST_CATEGORIES } from '../services/costTracking.service.mjs';
import { cleanQuestionnaire, parseCleanedQuestionnaire } from './questionnaire.routes.NEW.mjs';

const router = express.Router();

// Enforce auth + company access for all questionnaire endpoints
router.use(authenticateToken, requireCognitiveOrAdmin);

// Mutex lock for questionnaire file writes to prevent race conditions during parallel parsing
const questionnaireLocks = new Map();

async function withQuestionnaireLock(questionnaireId, fn) {
  // Get or create a lock for this questionnaire
  if (!questionnaireLocks.has(questionnaireId)) {
    questionnaireLocks.set(questionnaireId, Promise.resolve());
  }

  // Chain this operation after the previous one
  const previousLock = questionnaireLocks.get(questionnaireId);
  const currentLock = previousLock.then(fn).catch(err => {
    console.error('Error in locked operation:', err);
    throw err;
  });

  questionnaireLocks.set(questionnaireId, currentLock);

  return currentLock;
}

// Consistent data roots for persistence
const dataRoot = process.env.DATA_DIR || path.join(process.cwd(), 'data');
const filesDir = process.env.FILES_DIR || path.join(dataRoot, 'uploads');

const storage = multer.diskStorage({
  destination: async (req, file, cb) => {
    try {
      await fs.mkdir(filesDir, { recursive: true });
      cb(null, filesDir);
    } catch (error) {
      cb(error);
    }
  },
  filename: (req, file, cb) => {
    const timestamp = Date.now();
    const ext = path.extname(file.originalname);
    cb(null, `questionnaire_${timestamp}${ext}`);
  }
});

// File filter for .docx files only
const fileFilter = (req, file, cb) => {
  const allowedTypes = [
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document' // .docx
  ];

  if (allowedTypes.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new Error('Invalid file type. Only .docx files are allowed.'), false);
  }
};

const upload = multer({
  storage,
  fileFilter,
  limits: { fileSize: 10 * 1024 * 1024 } // 10MB limit
});

// Storage for data files (Excel/CSV) - store temporarily first
const dataFileStorage = multer.diskStorage({
  destination: async (req, file, cb) => {
    try {
      // Store temporarily in uploads directory first
      await fs.mkdir(filesDir, { recursive: true });
      cb(null, filesDir);
    } catch (error) {
      cb(error);
    }
  },
  filename: (req, file, cb) => {
    const timestamp = Date.now();
    const ext = path.extname(file.originalname);
    cb(null, `data_temp_${timestamp}${ext}`);
  }
});

// File filter for data files (Excel/CSV)
const dataFileFilter = (req, file, cb) => {
  const allowedTypes = [
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', // .xlsx
    'application/vnd.ms-excel', // .xls
    'text/csv', // .csv
    'application/vnd.ms-excel.sheet.macroEnabled.12' // .xlsm
  ];

  if (allowedTypes.includes(file.mimetype) || file.originalname.match(/\.(xlsx|xls|csv)$/i)) {
    cb(null, true);
  } else {
    cb(new Error('Invalid file type. Only .xlsx, .xls, and .csv files are allowed.'), false);
  }
};

const uploadDataFile = multer({
  storage: dataFileStorage,
  fileFilter: dataFileFilter,
  limits: { fileSize: 50 * 1024 * 1024 } // 50MB limit for data files
});

// Helper function to parse option string and extract code
// Handles formats like "1 Amyotrophic lateral sclerosis (ALS)" or "99 None of the above apply [EXCLUSIVE, ANCHOR]"
function parseOptionString(optionString) {
  if (typeof optionString !== 'string') {
    return optionString; // Already an object, return as-is
  }

  // Clean up the string: remove extra whitespace, normalize newlines to spaces
  const cleaned = optionString.replace(/\s+/g, ' ').trim();

  // Match leading number(s) optionally followed by colon, then whitespace, then the rest of the text
  // Pattern: one or more digits at the start, optional colon, whitespace, then the rest
  // Examples:
  //   "1 Text" -> code: "1", text: "Text"
  //   "1: Text" -> code: "1", text: "Text"
  //   "8:\n99 Prefer not to answer" -> code: "8", text: "99 Prefer not to answer"
  //   "99 None of the above apply [EXCLUSIVE, ANCHOR]" -> code: "99", text: "None of the above apply [EXCLUSIVE, ANCHOR]"
  const match = cleaned.match(/^(\d+):?\s+(.+)$/);

  if (match) {
    const code = match[1]; // The extracted code (e.g., "1", "8", "99")
    const text = match[2].trim(); // The remaining text (without the leading number and colon)
    return { code, text };
  }

  // If no code found, return as-is (will use index as code later)
  return cleaned || optionString;
}

// Helper function to identify sections using AI
// Helper function to count quotas in a section text
function countQuotasInSection(sectionText) {
  if (!sectionText || !sectionText.trim()) {
    return { count: 0, quotaNames: [] };
  }
  
  // Look for quota tables or quota definitions
  // Quotas are typically in tables with rows like:
  // - "Age 18-34" | "n=100"
  // - "Gender = Male" | "50"
  // - "TOTAL" | "n=500"
  // - Subquotas may be indented or have hierarchical structures
  // Or in lists with conditions and limits
  
  const quotaNames = [];
  const seenQuotas = new Set();
  
  // Pattern 1: Look for table-like structures with quota names and sample sizes
  // Match patterns like "Quota Name" followed by "n=" or numbers, tabs, pipes
  const quotaTablePattern = /(?:^|\n)(\s*)([A-Z][A-Za-z0-9\s\-=<>()]+?)\s*(?:\||\t|n\s*=\s*|Complete\s+|Total\s+)?\d+/gi;
  let match;
  while ((match = quotaTablePattern.exec(sectionText)) !== null) {
    const indent = match[1] || '';
    let quotaName = match[2].trim();
    
    // Clean up quota name - remove trailing colons, equals signs, etc.
    quotaName = quotaName.replace(/[:=]\s*$/, '').trim();
    
    // Skip common false positives
    if (quotaName && 
        !quotaName.match(/^(Response Option|Quota|Total Sample|Sample Size|n=|TOTAL|Total|Complete|Limit|Count)$/i) &&
        quotaName.length > 1 &&
        !seenQuotas.has(quotaName.toLowerCase())) {
      quotaNames.push(quotaName);
      seenQuotas.add(quotaName.toLowerCase());
    }
  }
  
  // Pattern 2: Look for explicit quota definitions with "n=" or sample sizes
  const quotaDefPattern = /(?:^|\n)(\s*)([A-Z][A-Za-z0-9\s\-=<>()]+?)\s*:?\s*(?:n\s*=\s*|Complete\s+|Total\s+)?\d+/gi;
  while ((match = quotaDefPattern.exec(sectionText)) !== null) {
    const indent = match[1] || '';
    let quotaName = match[2].trim();
    
    // Clean up quota name
    quotaName = quotaName.replace(/[:=]\s*$/, '').trim();
    
    if (quotaName && 
        !quotaName.match(/^(Response Option|Quota|Total Sample|Sample Size|n=|TOTAL|Total|Complete|Limit|Count)$/i) &&
        quotaName.length > 1 &&
        !seenQuotas.has(quotaName.toLowerCase())) {
      quotaNames.push(quotaName);
      seenQuotas.add(quotaName.toLowerCase());
    }
  }
  
  // Pattern 3: Look for quota names in bulleted or numbered lists
  // Match lines that start with bullet points or numbers followed by quota-like text
  const quotaListPattern = /(?:^|\n)(\s*)[•\-\*\d+\.]\s*([A-Z][A-Za-z0-9\s\-=<>()]+?)(?:\s*:|\s*-\s*|\s*\||\s*n\s*=|$)/gi;
  while ((match = quotaListPattern.exec(sectionText)) !== null) {
    const indent = match[1] || '';
    let quotaName = match[2].trim();
    
    // Clean up quota name
    quotaName = quotaName.replace(/[:=]\s*$/, '').trim();
    
    if (quotaName && 
        !quotaName.match(/^(Response Option|Quota|Total Sample|Sample Size|n=|TOTAL|Total|Complete|Limit|Count)$/i) &&
        quotaName.length > 1 &&
        !seenQuotas.has(quotaName.toLowerCase())) {
      quotaNames.push(quotaName);
      seenQuotas.add(quotaName.toLowerCase());
    }
  }
  
  // Pattern 4: Look for subquotas (indented lines that look like quota conditions)
  // These are often nested under main quotas
  const subQuotaPattern = /(?:^|\n)(\s{2,})([A-Z][A-Za-z0-9\s\-=<>()]+?)(?:\s*:|\s*-\s*|\s*\||\s*n\s*=|$)/gi;
  while ((match = subQuotaPattern.exec(sectionText)) !== null) {
    const indent = match[1] || '';
    let quotaName = match[2].trim();
    
    // Clean up quota name
    quotaName = quotaName.replace(/[:=]\s*$/, '').trim();
    
    // Subquotas are typically shorter and more specific
    if (quotaName && 
        !quotaName.match(/^(Response Option|Quota|Total Sample|Sample Size|n=|TOTAL|Total|Complete|Limit|Count|And|Or)$/i) &&
        quotaName.length > 1 &&
        !seenQuotas.has(quotaName.toLowerCase())) {
      quotaNames.push(quotaName);
      seenQuotas.add(quotaName.toLowerCase());
    }
  }
  
  // Remove duplicates and sort
  const uniqueQuotas = [...new Set(quotaNames)];
  
  return { count: uniqueQuotas.length, quotaNames: uniqueQuotas };
}

// Helper function to count questions in a section text and return the found question numbers
function countQuestionsInSection(sectionText, questionPrefix) {
  if (!sectionText || !sectionText.trim()) {
    return { count: 0, questionNumbers: [] };
  }
  
  // For Quota section, we don't count here - use countQuotasInSection instead
  // This function is only for regular question sections
  if (!questionPrefix) {
    // Return empty - quotas should be counted separately
    return { count: 0, questionNumbers: [] };
  }
  
  // STRICT pattern to match question numbers with the given prefix
  // Format: Prefix + 1-2 digits + Optional letter + Period (REQUIRED)
  // Examples: S1., A2., C20., C20A., B2B.
  // This prevents false positives like "E953" in response options

  // Escape special regex characters in the prefix
  const escapedPrefix = questionPrefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

  // STRICT: Prefix + 1-2 digits + Optional letter + Period
  const strictPattern = new RegExp(
    `\\b${escapedPrefix}(\\d{1,2})([A-Za-z]?)\\.`,
    'gi'
  );

  const allMatches = [];

  // Collect all matches using the strict pattern
  let match;
  strictPattern.lastIndex = 0;
  while ((match = strictPattern.exec(sectionText)) !== null) {
    const digits = match[1];
    const letter = (match[2] || '').toUpperCase();
    const questionNumber = `${questionPrefix}${digits}${letter}`.toUpperCase();
    allMatches.push({
      number: questionNumber,
      index: match.index,
      fullMatch: match[0]
    });
  }
  
  if (allMatches.length === 0) {
    return { count: 0, questionNumbers: [] };
  }
  
  // Remove duplicates - prefer matches that appear earlier in the text
  const uniqueQuestions = new Map();
  allMatches.forEach(m => {
    if (!uniqueQuestions.has(m.number) || uniqueQuestions.get(m.number).index > m.index) {
      uniqueQuestions.set(m.number, m);
    }
  });
  
  // Sort the question numbers for better display
  const questionNumbers = Array.from(uniqueQuestions.keys()).sort((a, b) => {
    // Extract numeric part for sorting
    const numA = parseInt(a.replace(/[^0-9]/g, '')) || 0;
    const numB = parseInt(b.replace(/[^0-9]/g, '')) || 0;
    if (numA !== numB) return numA - numB;
    // If numbers are equal, sort by letter suffix
    return a.localeCompare(b);
  });
  
  return { count: questionNumbers.length, questionNumbers };
}

// Extract all question numbers from the full document and group them by prefix
function extractAllQuestionNumbersByPrefix(text) {
  if (!text || !text.trim()) {
    return {};
  }
  
  // STRICT Pattern to match question numbers:
  // - Must have 1-2 letter prefix (S, A, B, C, QS, etc.)
  // - Must have 1-2 digit numbers (1-99, not 100+)
  // - Optional letter suffix (A, B, C, etc.)
  // - MUST end with a period (.)
  // Examples: S1., A2., C20., C20A., B2B., QS14.
  // This prevents false positives like "E953" in response options

  const patterns = [
    // Strict format: Prefix(1-2 letters) + Digits(1-2) + Optional Letter + Period (REQUIRED)
    /\b([A-Z]{1,2})(\d{1,2})([A-Za-z]?)\./gi
  ];
  
  const questionMap = new Map(); // prefix -> Set of question numbers
  
  patterns.forEach(pattern => {
    let match;
    // Reset lastIndex to avoid issues with global regex
    pattern.lastIndex = 0;
    while ((match = pattern.exec(text)) !== null) {
      const prefix = match[1].toUpperCase();
      const digits = match[2];
      const letter = (match[3] || '').toUpperCase();
      const questionNumber = `${prefix}${digits}${letter}`;
      
      // Additional validation: skip if it looks like a date, time, or other non-question pattern
      const beforeChar = text[match.index - 1] || ' ';
      const afterChar = text[match.index + match[0].length] || ' ';
      
      // Skip if it's clearly part of a larger word (but allow common question markers)
      if (/[A-Za-z0-9]/.test(beforeChar)) {
        // If there's a letter/digit before, it's likely part of a word - skip
        continue;
      }
      
      // Allow if followed by common question markers or whitespace
      if (/[A-Za-z0-9]/.test(afterChar) && !/[.,:;)\]\}\s\n\r\t]/.test(afterChar)) {
        // If followed by alphanumeric that's not a question marker, skip
        continue;
      }
      
      if (!questionMap.has(prefix)) {
        questionMap.set(prefix, new Set());
      }
      questionMap.get(prefix).add(questionNumber);
    }
  });
  
  // Convert Sets to sorted arrays
  const result = {};
  questionMap.forEach((questionSet, prefix) => {
    const questionNumbers = Array.from(questionSet).sort((a, b) => {
      // Extract numeric part for sorting
      const numA = parseInt(a.replace(/[^0-9]/g, '')) || 0;
      const numB = parseInt(b.replace(/[^0-9]/g, '')) || 0;
      if (numA !== numB) return numA - numB;
      // If numbers are equal, sort by letter suffix
      return a.localeCompare(b);
    });
    result[prefix] = questionNumbers;
  });
  
  return result;
}

// Create sections based on question number prefixes found in the document
function createSectionsFromQuestionNumbers(text, questionNumbersByPrefix) {
  const sections = [];
  let sectionNumber = 1;
  
  // Always create a Quota section first (sectionNumber: 1)
  // Find where quotas end and questions begin by finding the first question number
  // STRICT: Question must have 1-2 letter prefix, 1-2 digits, optional letter, and period
  let quotaEndIndex = 0;
  const firstQuestionPattern = /\b([A-Z]{1,2})(\d{1,2})([A-Za-z]?)\./i;
  const firstQuestionMatch = text.match(firstQuestionPattern);
  if (firstQuestionMatch) {
    quotaEndIndex = firstQuestionMatch.index;
  }
  
  // Extract quota text
  const quotaText = quotaEndIndex > 0 ? text.substring(0, quotaEndIndex) : text;

  // Don't hard-code quota counting - let AI handle it during parsing
  sections.push({
    sectionNumber: sectionNumber++,
    sectionName: 'Quota',
    questionPrefix: null,
    startIndex: 0,
    endIndex: quotaEndIndex > 0 ? quotaEndIndex : null,
    text: quotaText,
    expectedQuestionCount: 0,
    foundQuestionNumbers: []
  });
  
  // Create sections for each prefix found, in order of first appearance
  const prefixOrder = [];
  const prefixFirstIndex = new Map();
  
  Object.keys(questionNumbersByPrefix).forEach(prefix => {
    // Find first occurrence of this prefix in the text (STRICT: must have period)
    const firstMatch = text.search(new RegExp(`\\b${prefix}\\d{1,2}[A-Za-z]?\\.`, 'i'));
    if (firstMatch !== -1) {
      prefixFirstIndex.set(prefix, firstMatch);
      prefixOrder.push(prefix);
    }
  });
  
  // Sort prefixes by their first appearance in the document
  prefixOrder.sort((a, b) => {
    const indexA = prefixFirstIndex.get(a);
    const indexB = prefixFirstIndex.get(b);
    return indexA - indexB;
  });
  
  // Create a section for each prefix
  prefixOrder.forEach((prefix, index) => {
    const questionNumbers = questionNumbersByPrefix[prefix];
    const firstIndex = prefixFirstIndex.get(prefix);
    
    // Find the end index (start of next section or end of document)
    let endIndex = null;
    if (index < prefixOrder.length - 1) {
      const nextPrefix = prefixOrder[index + 1];
      endIndex = prefixFirstIndex.get(nextPrefix);
    }
    
    // Extract section text
    const sectionText = endIndex !== null 
      ? text.substring(firstIndex, endIndex)
      : text.substring(firstIndex);
    
    sections.push({
      sectionNumber: sectionNumber++,
      sectionName: `Section ${prefix}`,
      questionPrefix: prefix,
      startIndex: firstIndex,
      endIndex: endIndex,
      text: sectionText,
      expectedQuestionCount: questionNumbers.length,
      foundQuestionNumbers: questionNumbers
    });
  });
  
  return sections;
}

async function identifySectionsWithAI(text, projectId) {
  const client = new OpenAI({ 
    apiKey: process.env.OPENAI_API_KEY,
    timeout: 60000, // 1 minute timeout
    maxRetries: 2
  });
  
  const systemPrompt = `You are an expert at analyzing questionnaire documents. Your task is to identify distinct sections in a questionnaire.

A section is a logical grouping of questions that belong together. Sections can be identified by:
1. Explicit section headers (e.g., "Section 1", "SECTION 1", "Screening Questions", "Demographics", etc.)
2. Changes in question numbering prefixes (e.g., questions starting with S1, S2... then switching to A1, A2...)
3. Thematic groupings (e.g., all questions about demographics, all questions about satisfaction, etc.)
4. Visual separators or page breaks that indicate a new section

CRITICAL: You MUST ALWAYS create a "Quota" section as the FIRST section (sectionNumber: 1). This section should contain any quota tables or quota definitions found at the beginning of the document, before the main questions begin. The Quota section should have:
- sectionNumber: 1
- sectionName: "Quota"
- questionPrefix: null (quotas don't have question prefixes)
- startIndex: 0 (beginning of document)
- endIndex: The character index where quotas end and main questions begin

For each section you identify (after the Quota section), provide:
- sectionNumber: A sequential number (2, 3, 4, etc. - starting from 2 since Quota is 1)
- sectionName: A descriptive name. ALWAYS use the question prefix letter format (e.g., "Section S", "Section A", "Section C") even if there's a descriptive header. The prefix letter is critical for parsing.
- questionPrefix: The letter prefix used by questions in this section (e.g., "S", "A", "B", "C", "QS", "F", "G", etc.). This is REQUIRED and must match the actual question numbering.
- startIndex: The character index where this section begins in the text
- endIndex: The character index where this section ends (or null if it's the last section)

IMPORTANT RULES:
- ALWAYS create a "Quota" section first (sectionNumber: 1) containing quota tables/definitions from the beginning of the document
- ALWAYS identify the question prefix (the letter(s) before the number in questions like S1, A1, C1, QS14, F1, etc.)
- ALWAYS use "Section {prefix}" format for sectionName (e.g., "Section S", "Section A", "Section C")
- The questionPrefix field is CRITICAL - it must accurately reflect the letter prefix used by ALL questions in that section
- If a section has a descriptive header like "Screening Questionnaire" but questions start with S1, S2, etc., the sectionName should be "Section S" and questionPrefix should be "S"
- Each section should contain ALL questions that belong to that logical group, including the first question (e.g., C1, F1, S1, etc.)
- Do not create duplicate section names - if multiple sections use the same prefix, add a number (e.g., "Section S", "Section S (2)")
- Be precise with start and end indices to avoid overlapping sections and ensure the first question of each section is included
- Return sections in the order they appear in the document (with Quota always first)
- Make sure startIndex includes any section headers or introductory text before the first question
- HIDDEN VARIABLES: Hidden variables (questions with "hid_" prefix) should be included in the Quota section (sectionNumber: 1). Do NOT create a separate "Section H" for hidden variables. All hidden variables should be placed in the Quota section, appearing after the quota tables but before the first regular question section.

AVOID FALSE POSITIVES:
- DO NOT identify a section based on isolated references like "Q1", "Q2", "Q3", "Q4" when they refer to quarters (Q1 2024, Q4 2023, etc.), not questions
- Only identify a section when there is a CLEAR PATTERN of multiple questions with the same prefix (e.g., Q1, Q2, Q3, Q4, Q5, Q6, etc. as questions)
- Look for context: actual questions have question text, response options, and programming logic - not just a reference
- A single mention of "Q4" or "Q1-Q4" referring to time periods or other context is NOT a question section
- Only create a section when you see at least 3+ questions with the same prefix pattern consistently used throughout a portion of the document`;

  const userPrompt = `Please analyze this questionnaire document and identify all distinct sections:

${text}

Return a JSON object with this structure:
{
  "sections": [
    {
      "sectionNumber": 1,
      "sectionName": "Quota",
      "questionPrefix": null,
      "startIndex": 0,
      "endIndex": 500
    },
    {
      "sectionNumber": 2,
      "sectionName": "Section S",
      "questionPrefix": "S",
      "startIndex": 500,
      "endIndex": 1843
    },
    {
      "sectionNumber": 3,
      "sectionName": "Section A",
      "questionPrefix": "A",
      "startIndex": 1843,
      "endIndex": 19541
    }
  ]
}

CRITICAL:
- ALWAYS include a "Quota" section as the FIRST section (sectionNumber: 1) containing quota tables/definitions from the beginning of the document
- The questionPrefix field is REQUIRED for all sections except Quota (where it should be null)
- Make sure startIndex includes the first question of the section (e.g., if the section starts with C1, the startIndex should be before C1)
- Make sure endIndex is after the last question of the section
- HIDDEN VARIABLES: All hidden variables should be included in the Quota section (sectionNumber: 1). Do NOT create a separate "Section H" for hidden variables. Hidden variables should appear in the Quota section after quota tables.
- AVOID FALSE POSITIVES: Do NOT create a "Section Q" if you only see references like "Q1", "Q2", "Q3", "Q4" in the context of quarters/time periods. Only create sections when you see a CLEAR PATTERN of multiple actual questions (with question text, options, logic) using that prefix.

Return ONLY valid JSON. Do not include any explanatory text outside the JSON object.`;

  try {
    const response = await client.chat.completions.create({
      model: 'gpt-4o',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt }
      ],
      temperature: 0.1,
      response_format: { type: 'json_object' },
      max_tokens: 4096
    });

    const content = response.choices[0].message.content;
    const parsedData = JSON.parse(content);
    
    // Log cost
    if (projectId && response.usage) {
      const inputTokens = response.usage.prompt_tokens || 0;
      const outputTokens = response.usage.completion_tokens || 0;
      if (inputTokens > 0 && outputTokens > 0) {
        try {
          await logCost(
            projectId,
            COST_CATEGORIES.QUESTIONNAIRE_PARSING,
            'gpt-4o',
            inputTokens,
            outputTokens,
            'Questionnaire section identification'
          );
        } catch (costError) {
          console.warn('Failed to log cost for section identification:', costError.message);
        }
      }
    }
    
    // Convert AI response to section objects with text
    const sections = [];
    const aiSections = parsedData.sections || [];
    
    // Check if Quota section exists, if not create it
    let hasQuotaSection = false;
    for (let i = 0; i < aiSections.length; i++) {
      if (aiSections[i].sectionName === 'Quota' || 
          aiSections[i].sectionName === 'Quotas' ||
          aiSections[i].sectionName?.toLowerCase() === 'quota' ||
          aiSections[i].sectionName?.toLowerCase() === 'quotas') {
        hasQuotaSection = true;
        // Normalize to "Quotas"
        if (aiSections[i].sectionName?.toLowerCase() === 'quota') {
          aiSections[i].sectionName = 'Quotas';
        }
        break;
      }
    }
    
    // If no Quota section found, create one at the beginning
    if (!hasQuotaSection && aiSections.length > 0) {
      // Find where the first question section starts (excluding hidden variables)
      // STRICT: Question must have 1-2 letter prefix, 1-2 digits, optional letter, and period
      let firstQuestionIndex = text.length;
      const firstQuestionMatch = text.match(/(?:^|\n)([A-Z]{1,2})(\d{1,2})([A-Za-z]?)\./i);
      if (firstQuestionMatch) {
        firstQuestionIndex = firstQuestionMatch.index || 0;
      } else if (aiSections.length > 0 && aiSections[0].startIndex) {
        firstQuestionIndex = aiSections[0].startIndex;
      }
      
      // Find all hidden variables in the document and include them in the Quota section
      // Hidden variables typically appear before the first regular question
      // They may be in the quota area or scattered, but we want them in the Quota section
      const hiddenVariablePattern = /(?:^|\n)([A-Z][A-Z\s]+)\s*\(Hidden Variable\)/gi;
      let hiddenVariableEndIndex = firstQuestionIndex;
      let match;
      while ((match = hiddenVariablePattern.exec(text)) !== null) {
        // Extend the Quota section to include hidden variables
        const hiddenVarEnd = match.index + match[0].length;
        if (hiddenVarEnd > hiddenVariableEndIndex && hiddenVarEnd < firstQuestionIndex) {
          hiddenVariableEndIndex = hiddenVarEnd;
        }
      }
      
      // Create Quota section from beginning to first question (including hidden variables)
      const quotaSectionText = text.substring(0, Math.max(firstQuestionIndex, hiddenVariableEndIndex)).trim();

      sections.push({
        text: quotaSectionText,
        sectionNumber: 1,
        sectionName: 'Quotas',
        questionPrefix: null,
        expectedQuestionCount: null,
        foundQuestionNumbers: []
      });
    } else if (hasQuotaSection) {
      // If Quota section exists, extend it to include hidden variables that appear before the first regular question
      const quotaSection = aiSections.find(s => 
        s.sectionName === 'Quota' || 
        s.sectionName === 'Quotas' ||
        s.sectionName?.toLowerCase() === 'quota' ||
        s.sectionName?.toLowerCase() === 'quotas'
      );
      if (quotaSection) {
        // Normalize to "Quotas"
        if (quotaSection.sectionName?.toLowerCase() === 'quota') {
          quotaSection.sectionName = 'Quotas';
        }
        // Find the first regular question section (not hidden variables)
        let firstRegularQuestionIndex = text.length;
        for (let i = 0; i < aiSections.length; i++) {
          const section = aiSections[i];
          const isQuota = section.sectionName === 'Quota' || 
                         section.sectionName === 'Quotas' ||
                         section.sectionName?.toLowerCase() === 'quota' ||
                         section.sectionName?.toLowerCase() === 'quotas';
          if (!isQuota && section.questionPrefix && section.questionPrefix !== 'H') {
            if (section.startIndex < firstRegularQuestionIndex) {
              firstRegularQuestionIndex = section.startIndex;
            }
          }
        }
        
        // Find hidden variables between quota section end and first regular question
        const hiddenVariablePattern = /(?:^|\n)([A-Z][A-Z\s]+)\s*\(Hidden Variable\)/gi;
        let hiddenVariableEndIndex = quotaSection.endIndex || firstRegularQuestionIndex;
        let match;
        const searchStart = quotaSection.endIndex || 0;
        const searchEnd = firstRegularQuestionIndex;
        const searchText = text.substring(searchStart, searchEnd);
        while ((match = hiddenVariablePattern.exec(searchText)) !== null) {
          const hiddenVarEnd = searchStart + match.index + match[0].length;
          if (hiddenVarEnd > hiddenVariableEndIndex) {
            hiddenVariableEndIndex = hiddenVarEnd;
          }
        }
        
        // Extend the Quota section endIndex to include hidden variables
        if (hiddenVariableEndIndex > (quotaSection.endIndex || 0)) {
          quotaSection.endIndex = hiddenVariableEndIndex;
        }
      }
    }
    
    for (let i = 0; i < aiSections.length; i++) {
      const aiSection = aiSections[i];
      
      // Skip "Section H" or sections with "H" prefix - hidden variables should be in Quota section
      if (aiSection.sectionName === 'Section H' || 
          aiSection.sectionName?.toLowerCase() === 'section h' ||
          aiSection.questionPrefix === 'H' ||
          (aiSection.sectionName && aiSection.sectionName.match(/^Section\s+H/i))) {
        console.log(`⚠️ Skipping Section H - hidden variables should be in Quota section`);
        continue;
      }
      
      // If AI created a Quota section, we'll use it (but extend it to include hidden variables if needed)
      // The extension logic above already handles this
      
      const startIndex = aiSection.startIndex || 0;
      const endIndex = aiSection.endIndex !== null && aiSection.endIndex !== undefined 
        ? aiSection.endIndex 
        : text.length;
      
      // Ensure we don't go out of bounds
      const safeStartIndex = Math.max(0, Math.min(startIndex, text.length));
      const safeEndIndex = Math.max(safeStartIndex, Math.min(endIndex, text.length));
      
      let sectionText = text.substring(safeStartIndex, safeEndIndex).trim();
      
      if (sectionText.length > 0) {
        // Extract question prefix if not provided by AI (skip for Quota section)
        let questionPrefix = aiSection.questionPrefix;
        const isQuotaSection = aiSection.sectionName === 'Quota' || 
                              aiSection.sectionName === 'Quotas' ||
                              aiSection.sectionName?.toLowerCase() === 'quota' ||
                              aiSection.sectionName?.toLowerCase() === 'quotas';
        if (!questionPrefix && !isQuotaSection) {
          // Try to extract from section name (e.g., "Section S" -> "S")
          const nameMatch = aiSection.sectionName?.match(/Section\s+([A-Z]+(?:[A-Z]+)?)/i);
          if (nameMatch) {
            questionPrefix = nameMatch[1].toUpperCase();
          } else {
            // Try to extract from first question in the section
            // STRICT: Question must have 1-2 letter prefix, 1-2 digits, optional letter, and period
            const firstQuestionMatch = sectionText.match(/(?:^|\n)([A-Z]{1,2})(\d{1,2})([A-Za-z]?)\./i);
            if (firstQuestionMatch) {
              questionPrefix = firstQuestionMatch[1].toUpperCase();
            }
          }
        }
        
        // Normalize Quota section name to "Quotas"
        let sectionName = aiSection.sectionName || `Section ${questionPrefix || i + 1}`;
        if (isQuotaSection) {
          sectionName = 'Quotas';
        }

        sections.push({
          text: sectionText,
          sectionNumber: aiSection.sectionNumber || (hasQuotaSection ? i + 1 : i + 2),
          sectionName: sectionName,
          questionPrefix: questionPrefix || null,
          expectedQuestionCount: null,
          foundQuestionNumbers: []
        });
      }
    }

    // Return sections without any pre-parsing or counting of questions
    console.log(`📦 AI identified ${sections.length} sections`);
    sections.forEach((section, idx) => {
      const prefixInfo = section.questionPrefix ? ` [prefix: ${section.questionPrefix}]` : '';
      console.log(`   Section ${idx + 1}: ${section.sectionName}${prefixInfo} (${section.text.length} chars)`);
    });

    return sections;
  } catch (error) {
    console.error('Error identifying sections with AI:', error);
    throw new Error(`Failed to identify sections: ${error.message}`);
  }
}

// Legacy function kept for fallback - split questionnaire text into sections using regex
// This is a fallback if AI identification fails
function splitQuestionnaireIntoSections(text) {
  const sections = [];
  
  // Pattern to match explicit section headers (case-insensitive)
  // Matches: "Section 1", "SECTION 1", "Section 1:", "SECTION 1:", etc.
  const sectionHeaderPattern = /(?:^|\n)(?:Section\s+\d+|SECTION\s+\d+)[:\s]*/i;
  
  // STRICT pattern to match question markers and extract their prefix
  // Format: Prefix(1-2 letters) + Digits(1-2) + Optional letter + Period (REQUIRED)
  // Examples: S1., A2., C20., QS14., B2B.
  const questionPattern = /(?:^|\n)([A-Z]{1,2})(\d{1,2})([A-Za-z]?)\./i;
  
  // Find all section headers
  const sectionHeaders = [];
  let match;
  const sectionRegex = new RegExp(sectionHeaderPattern.source, sectionHeaderPattern.flags + 'g');
  
  while ((match = sectionRegex.exec(text)) !== null) {
    sectionHeaders.push({
      index: match.index,
      text: match[0].trim(),
      type: 'header'
    });
  }
  
  // Find all question markers and identify section boundaries by prefix changes
  const questionMarkers = [];
  const questionRegex = new RegExp(questionPattern.source, questionPattern.flags + 'g');
  let currentPrefix = null;
  
  while ((match = questionRegex.exec(text)) !== null) {
    const fullMatch = match[0].trim();
    // Extract prefix from capture group 1
    const prefix = match[1] ? match[1].toUpperCase() : null;
    
    // If prefix changed, mark this as a section boundary
    if (prefix && currentPrefix !== null && prefix !== currentPrefix) {
      questionMarkers.push({
        index: match.index,
        text: fullMatch,
        type: 'section_boundary',
        prefix: prefix,
        previousPrefix: currentPrefix
      });
    }
    
    if (prefix) {
      currentPrefix = prefix;
    }
    
    questionMarkers.push({
      index: match.index,
      text: fullMatch,
      type: 'question',
      prefix: prefix
    });
  }
  
  // Combine section headers and section boundaries, sort by position
  const allBoundaries = [
    ...sectionHeaders,
    ...questionMarkers.filter(m => m.type === 'section_boundary')
  ].sort((a, b) => a.index - b.index);
  
  // If no sections found, return the whole text as a single section
  if (allBoundaries.length === 0) {
    console.log(`📦 No sections found, treating entire questionnaire as one section`);
    const countResult = countQuestionsInSection(text, null);
    return [{ 
      text: text, 
      sectionNumber: 1, 
      sectionName: 'Section 1',
      questionPrefix: null,
      expectedQuestionCount: countResult.count,
      foundQuestionNumbers: countResult.questionNumbers
    }];
  }
  
  // Helper function to extract prefix from first question in a section
  // STRICT: Question must have 1-2 letter prefix, 1-2 digits, optional letter, and period
  const getPrefixFromSectionText = (sectionText) => {
    const firstQuestionMatch = sectionText.match(/(?:^|\n)([A-Z]{1,2})(\d{1,2})([A-Za-z]?)\./i);
    if (firstQuestionMatch) {
      return firstQuestionMatch[1].toUpperCase();
    }
    return null;
  };
  
  // Split text into sections based on boundaries
  let sectionStart = 0;
  let sectionNumber = 1;
  
  for (let i = 0; i < allBoundaries.length; i++) {
    const boundary = allBoundaries[i];
    
    // If this boundary is not at the start, create a section from previous start to here
    if (boundary.index > sectionStart) {
      const sectionText = text.substring(sectionStart, boundary.index).trim();
      if (sectionText.length > 0) {
        let sectionName;
        let prefix = null;
        if (boundary.type === 'header') {
          sectionName = boundary.text;
        } else {
          // Determine prefix from the section text (first question in the section)
          prefix = getPrefixFromSectionText(sectionText) || boundary.previousPrefix || 'Unknown';
          sectionName = `Section ${prefix}`;
        }
        // Count questions in this section
        const countResult = countQuestionsInSection(sectionText, prefix);
        
        sections.push({
          text: sectionText,
          sectionNumber: sectionNumber,
          sectionName: sectionName,
          questionPrefix: prefix,
          expectedQuestionCount: countResult.count,
          foundQuestionNumbers: countResult.questionNumbers
        });
        sectionNumber++;
      }
    }
    
    sectionStart = boundary.index;
  }
  
  // Add the final section
  const finalSectionText = text.substring(sectionStart).trim();
  if (finalSectionText.length > 0) {
    const lastBoundary = allBoundaries[allBoundaries.length - 1];
    let sectionName;
    if (lastBoundary.type === 'header') {
      sectionName = lastBoundary.text;
    } else {
      // Determine prefix from the final section text (first question in the section)
      const prefix = getPrefixFromSectionText(finalSectionText) || lastBoundary.prefix || 'Unknown';
      sectionName = `Section ${prefix}`;
    }
    // Count questions in this section
    const finalPrefix = getPrefixFromSectionText(finalSectionText) || lastBoundary.prefix || null;
    const finalCountResult = countQuestionsInSection(finalSectionText, finalPrefix);
    
    sections.push({
      text: finalSectionText,
      sectionNumber: sectionNumber,
      sectionName: sectionName,
      questionPrefix: finalPrefix,
      expectedQuestionCount: finalCountResult.count,
      foundQuestionNumbers: finalCountResult.questionNumbers
    });
  }
  
  // If we somehow have no sections, return the whole text
  if (sections.length === 0) {
    const countResult = countQuestionsInSection(text, null);
    return [{ 
      text: text, 
      sectionNumber: 1, 
      sectionName: 'Section 1',
      questionPrefix: null,
      expectedQuestionCount: countResult.count,
      foundQuestionNumbers: countResult.questionNumbers
    }];
  }
  
  console.log(`📦 Split into ${sections.length} sections based on section headers and question prefix changes`);
  sections.forEach((section, idx) => {
    const countInfo = section.expectedQuestionCount !== undefined ? ` (${section.expectedQuestionCount} questions)` : '';
    const numbersInfo = section.foundQuestionNumbers && section.foundQuestionNumbers.length > 0 
      ? ` [Found: ${section.foundQuestionNumbers.join(', ')}]` 
      : '';
    console.log(`   Section ${idx + 1}: ${section.sectionName}${countInfo}${numbersInfo} (${section.text.length} chars)`);
  });
  
  return sections;
}

// Parse a single section of questionnaire
async function parseQuestionnaireSection(section, sectionIndex, totalSections, systemPrompt, projectId) {
  const client = new OpenAI({ 
    apiKey: process.env.OPENAI_API_KEY,
    timeout: 180000, // 3 minute timeout per section
    maxRetries: 2
  });
  
  const sectionLabel = sectionIndex === 0 && totalSections > 1 
    ? 'FIRST SECTION' 
    : sectionIndex === totalSections - 1 && totalSections > 1 
    ? 'FINAL SECTION' 
    : totalSections > 1 
    ? `SECTION ${sectionIndex + 1} of ${totalSections}` 
    : '';
  
  // Build section context with question prefix information
  const sectionContext = section.questionPrefix
    ? `Section: ${section.sectionName} (Questions in this section use the "${section.questionPrefix}" prefix, e.g., ${section.questionPrefix}1, ${section.questionPrefix}2, etc.)`
    : `Section: ${section.sectionName || 'unnamed section'}`;

  // Check if this is the Quota section
  const isQuotaSection = section.sectionName === 'Quota' || section.sectionName === 'Quotas' || section.sectionName?.toLowerCase() === 'quota' || section.sectionName?.toLowerCase() === 'quotas';

  // For non-quota sections, use the identified question numbers to guide parsing
  // For quota section, don't provide any hints - let AI parse from beginning to first section
  const foundQuestionsHint = !isQuotaSection && section.foundQuestionNumbers && section.foundQuestionNumbers.length > 0
    ? `\n\nIMPORTANT: During initial parsing, we identified the following ${section.foundQuestionNumbers.length} questions in this section: ${section.foundQuestionNumbers.join(', ')}. You MUST parse ALL of these specific questions. Use these question numbers to locate each question in the text and extract all the required details for each one. Do NOT search for or identify other questions - only parse these identified questions.`
    : '';
  
  const userPrompt = isQuotaSection 
    ? `Please parse this QUOTA section of a questionnaire document and extract ALL quotas AND hidden variables:

${section.text}

CRITICAL: This is the Quota section. You MUST extract:
1. ALL quotas from this section
2. ALL hidden variables from this section

QUOTAS:
Quotas are typically formatted as tables with:
- Response options or conditions (e.g., "Age 18-34", "Gender = Male", "Treatment Group A", etc.)
- Total sample limits (e.g., "n=100", "Complete 50", "100", etc.)

Look for quota tables or quota definitions. Each quota should have:
- A name or identifier (often the response option/condition)
- Conditions (array of conditions that define the quota)
- A limit (the total sample size to collect)
- Optional description

HIDDEN VARIABLES:
Hidden variables are sections with titles like "VARIABLE NAME (Hidden Variable)". For each hidden variable:
- Include it in the "questions" array (NOT in quotas)
- Use "number": "hid_VARIABLE_NAME" format (convert title to UPPERCASE, replace spaces with underscores, remove "(Hidden Variable)")
- Example: "SPINRAZA RESTART GAP (Hidden Variable)" → number: "hid_SPINRAZA_RESTART_GAP"
- Extract all options/conditions from the hidden variable table
- Include the full title as the "text" field
- Set "type" to "Hidden Variable" or "Single Select" (depending on the structure)

Extract ALL quotas found in this section and return them in the "quotas" array. Extract ALL hidden variables and return them in the "questions" array.

Return a JSON object with this structure:
{
  "quotas": [
    {
      "name": "quota name or response option identifier",
      "conditions": ["condition1", "condition2", ...],
      "limit": 100,
      "description": "quota description or details (optional)"
    }
  ],
  "questions": [
    {
      "number": "hid_VARIABLE_NAME",
      "text": "VARIABLE NAME (Hidden Variable)",
      "type": "Hidden Variable",
      "options": ["option1", "option2", ...],
      ...
    }
  ]
}

IMPORTANT: 
- Populate the "quotas" array with quota definitions
- Populate the "questions" array with hidden variables (if any are found in this section)
- Hidden variables should use the "hid_" prefix in their number field`
    : `Please parse this ${sectionLabel} of a questionnaire document and extract ALL questions with their details:

${sectionContext}

${section.text}

${totalSections > 1 ? `\nCRITICAL: This is section ${sectionIndex + 1} of ${totalSections} (${section.sectionName || 'unnamed section'}). You MUST parse EVERY SINGLE question in this section, including the FIRST question. Do not skip any questions.${foundQuestionsHint}\n\nHIDDEN VARIABLES: You MUST also parse any hidden variables found in this section. Hidden variables are sections with titles like "VARIABLE NAME (Hidden Variable)". For each hidden variable:\n- Include it in the questions array IN THE SAME ORDER it appears in the QNR (do NOT group them in a separate section)\n- Use "number": "hid_VARIABLE_NAME" format (convert title to UPPERCASE, replace spaces with underscores, remove "(Hidden Variable)")\n- Example: "SPINRAZA RESTART GAP (Hidden Variable)" → number: "hid_SPINRAZA_RESTART_GAP"\n- Extract all options/conditions from the hidden variable table\n- Include the full title as the "text" field` : `\nCRITICAL: You MUST parse EVERY SINGLE question in this document, including the FIRST question. Do not skip any questions.${foundQuestionsHint}\n\nHIDDEN VARIABLES: You MUST also parse any hidden variables found in this document. Hidden variables are sections with titles like "VARIABLE NAME (Hidden Variable)". For each hidden variable:\n- Include it in the questions array IN THE SAME ORDER it appears in the QNR (do NOT group them in a separate section)\n- Use "number": "hid_VARIABLE_NAME" format (convert title to UPPERCASE, replace spaces with underscores, remove "(Hidden Variable)")\n- Example: "SPINRAZA RESTART GAP (Hidden Variable)" → number: "hid_SPINRAZA_RESTART_GAP"\n- Extract all options/conditions from the hidden variable table\n- Include the full title as the "text" field`}

Return a JSON object with this structure:
{
  "quotas": [
    {
      "name": "quota name or identifier",
      "conditions": ["condition1", "condition2", ...],
      "limit": 100,
      "description": "quota description or details"
    }
  ],
  "questions": [
    {
      "number": "question number (e.g., S1, A1, Q1) - this will be used as the unique identifier. For hidden variables, use format 'hid_VARIABLE_NAME' (e.g., 'hid_SPINRAZA_RESTART_GAP')",
      "text": "full question text",
      "type": "specific Forsta question type from the library above",
      "options": ["option1", "option2", ...],  // For non-grid questions: response options
      "statementOptions": [{"code": "r1", "text": "statement 1"}, ...],  // For grid questions: row labels/statements (ALWAYS use "r" prefix: r1, r2, r3, etc.)
      "responseOptions": [{"code": "c1", "text": "Option 1"}, ...],  // For grid questions: column headers/response scale (ALWAYS use "c" prefix: c1, c2, c3, etc.)
      "showLogic": "condition for showing this question (if present)",
      "randomize": true/false,  // ONLY applies to rows/statement options, NEVER to columns/response options
      "tags": ["tag1", "tag2"],
      "needsReview": true/false,
      "logic": "any skip logic or conditions",
      "terminateLogic": "TERMINATE IF [condition]" OR {"optionCodes": ["1", "2", "3"]}  // For simple single/multi-select: structured object with optionCodes array. For complex logic: text string.
    }
  ]
}

NOTE: The "quotas" array is optional. Only include it if quotas are found in the document. If no quotas are found, you can omit the "quotas" field or set it to an empty array.

CRITICAL STRUCTURE RULES:
- For NUMERIC GRID: 
  - If the grid has ONLY rows with numeric input (no column headers/categories) → Use statementOptions (rows) only. DO NOT include responseOptions.
  - If the grid has BOTH rows (statements) AND columns (categories like age groups, time periods, etc.) where numeric values are entered → Use BOTH statementOptions (rows) AND responseOptions (columns). Examples: "How many patients by age group" (rows = treatments, columns = age groups), "Enter numbers for each category" (rows = items, columns = categories).
- For SINGLE SELECT GRID: Use BOTH statementOptions (rows) AND responseOptions (column headers/scale like 1-7, Yes/No, etc.)
- For MULTI-SELECT GRID: Use BOTH statementOptions (rows) AND responseOptions (columns)
- For regular questions (non-grid): Use "options" field (not statementOptions/responseOptions)
- If a grid asks for numbers/amounts/counts, it's a NUMERIC GRID, not a multi-select grid

CRITICAL: CODE FORMATTING RULES:
- statementOptions codes MUST always use "r" prefix: "r1", "r2", "r3", etc. (for rows)
- responseOptions codes MUST always use "c" prefix: "c1", "c2", "c3", etc. (for columns)
- Never use just numbers like "1", "2" for responseOptions - ALWAYS use "c1", "c2", etc.
- Never use just numbers like "1", "2" for statementOptions - ALWAYS use "r1", "r2", etc.

CRITICAL: RATING/SCALE QUESTION LABELS:
For rating questions (Button Rating, Rating Scale, Single Select Grid with scales, etc.), you MUST capture FULL labels, not just numbers:

PRIMARY METHOD - Extract from column headers/table headers:
- If the QNR shows column headers like "1 Strongly Disagree", "2 Disagree", "3 Neutral", "4 Agree", "5 Strongly Agree"
- Extract the FULL text: "1 Strongly Disagree" (not just "1")
- Look in the table/column headers for complete labels

FALLBACK METHOD - Extract from question text:
- If column headers are not available, look for labels defined in the question text itself
- Patterns to look for: "1=X", "4=Y", "7=Z" or "where 1=X, 4=Y, 7=Z" or "1=X, 4=Y, 7=Z"
- Example: "Please use a 7-point scale where 1=Less Likely to be Compliant on the Tablet, 4=Equally as Likely to be Compliant on the Tablet, and 7=More Likely to be Compliant on the Tablet"
- Extract: "1" → "1 Less Likely to be Compliant on the Tablet", "4" → "4 Equally as Likely to be Compliant on the Tablet", "7" → "7 More Likely to be Compliant on the Tablet"
- For intermediate numbers not explicitly labeled, use just the number (e.g., "2", "3", "5", "6")

ALWAYS prioritize column headers over question text. If both are present, use column headers.

Response options should ALWAYS include the full descriptive text, not just the numeric code.

TAG SYSTEM - ADDITIONAL METADATA:
Questions should include tags in the "tags" array to provide additional context:

IMPORTANT: DO NOT add "terminate" as a tag. Termination logic is handled separately in the "terminateLogic" field (see TERMINATE LOGIC PARSING RULES above).

1. SCALE TAG:
   - ONLY add "Scale" tag if the question is ACTUALLY a rating scale question, NOT just because it has 5, 7, or 10 options
   - Rating scales are questions that ask respondents to RATE, EVALUATE, or MEASURE something on a numeric scale (e.g., satisfaction, agreement, likelihood, importance)
   - Look for key indicators in the question text: "rate", "how satisfied", "how likely", "how much do you agree", "on a scale of", "rate from 1 to X", "how important", "how would you rate", etc.
   - Examples of ACTUAL scales: "How satisfied are you?" with 1-5 options, "How likely are you to recommend?" with 1-10 options, "Rate your agreement" with 1-7 options
   - Examples of NON-scales (DO NOT add Scale tag): "How many years of experience?" with 5 options (1-5, 6-10, etc.) → NOT a scale, "Which age group?" with 5 options → NOT a scale, "How many times per week?" with 7 options → NOT a scale, "How many patients?" with 10 options → NOT a scale
   - The question must be asking for a RATING/EVALUATION/MEASUREMENT, not just a categorical selection, count, or demographic question
   - If the question has 5, 7, or 10 options but is asking for a category, count, demographic, or selection (not a rating), DO NOT add the Scale tag
   - When in doubt, ask yourself: "Is this asking the respondent to rate/evaluate something?" If no, don't add the Scale tag

2. NUMERIC TYPE TAGS:
   - For Numeric questions, Numeric Grid questions, or Numeric List questions:
     - If the question text mentions "percent", "percentage", "%", or asks for a percentage → add "%" tag
     - If the question asks for a number, count, amount, or quantity (not a percentage) → add "Number" tag
     - Examples: "What percentage of..." → add "%" tag
     - Examples: "How many patients..." → add "Number" tag
     - Examples: "Enter a number from 0-100..." → determine from context (if asking for percentage, add "%", otherwise "Number")

3. BUTTON RATING CLASSIFICATION:
   - Button Rating questions should be classified as "Single Select" type
   - ONLY add the "Scale" tag if the Button Rating question is actually asking for a rating/evaluation (see SCALE TAG rules above)
   - DO NOT automatically add Scale tag just because it has 5, 7, or 10 options

IMPORTANT: Return ONLY valid JSON. Do not include any explanatory text outside the JSON object.`;

  const requestStartTime = Date.now();
  console.log(`    📡 Sending API request for section ${sectionIndex + 1} (${section.sectionName || 'unnamed'}, ${section.text.length} chars)...`);
  
  const response = await client.chat.completions.create({
    model: 'gpt-4o', // Using GPT-4o for better parsing accuracy
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt }
    ],
    temperature: 0.1,
    response_format: { type: 'json_object' },
    max_tokens: 16384  // Maximum for gpt-4o
  });
  
  const requestTime = ((Date.now() - requestStartTime) / 1000).toFixed(1);
  console.log(`    ✅ API response received in ${requestTime}s for section ${sectionIndex + 1}`);

  const finishReason = response.choices[0].finish_reason;
  if (finishReason === 'length') {
    throw new Error(`Section ${sectionIndex + 1} (${section.sectionName || 'unnamed'}) response was truncated. The questionnaire section is too large.`);
  }

  const content = response.choices[0].message.content;
  if (!content || content.trim().length === 0) {
    throw new Error(`Section ${sectionIndex + 1} (${section.sectionName || 'unnamed'}) returned empty response`);
  }

  let parsedData;
  try {
    parsedData = JSON.parse(content);
  } catch (parseError) {
    console.error(`JSON Parse Error for section ${sectionIndex + 1}:`, parseError);
    throw new Error(`Failed to parse JSON response for section ${sectionIndex + 1} (${section.sectionName || 'unnamed'}): ${parseError.message}`);
  }

  const questions = parsedData.questions || [];
  const quotas = parsedData.quotas || [];
  
  // Log cost for this section
  if (projectId && response.usage) {
    const inputTokens = response.usage.prompt_tokens || 0;
    const outputTokens = response.usage.completion_tokens || 0;
    if (inputTokens > 0 && outputTokens > 0) {
      try {
        await logCost(
          projectId,
          COST_CATEGORIES.QUESTIONNAIRE_PARSING,
          'gpt-4o',
          inputTokens,
          outputTokens,
          `Questionnaire parsing section ${sectionIndex + 1} of ${totalSections} (${section.sectionName || 'unnamed'})`
        );
      } catch (costError) {
        console.warn('Failed to log cost for section:', costError.message);
      }
    }
  }
  
  // Return both questions and quotas
  return { questions, quotas };
}

// Hard-coded parser to extract questions from standardized format
function parseStandardizedFormat(cleanedText) {
  const questions = [];
  const questionBlocks = cleanedText.split('===QUESTION===').filter(block => block.trim());

  for (const block of questionBlocks) {
    if (!block.includes('===END===')) continue;

    const content = block.split('===END===')[0].trim();
    const lines = content.split('\n').map(l => l.trim()).filter(l => l);

    const question = {
      number: '',
      text: '',
      type: '',
      options: [],
      statementOptions: [],
      responseOptions: [],
      showLogic: '',
      randomize: false,
      tags: [],
      needsReview: false,
      logic: '',
      terminateLogic: null
    };

    let currentField = null;

    for (const line of lines) {
      if (line.startsWith('NUMBER:')) {
        question.number = line.substring(7).trim();
      } else if (line.startsWith('TEXT:')) {
        question.text = line.substring(5).trim();
      } else if (line.startsWith('TYPE:')) {
        question.type = line.substring(5).trim();
      } else if (line.startsWith('OPTIONS:')) {
        currentField = 'options';
      } else if (line.startsWith('STATEMENT_OPTIONS:')) {
        currentField = 'statementOptions';
      } else if (line.startsWith('RESPONSE_OPTIONS:')) {
        currentField = 'responseOptions';
      } else if (line.startsWith('SHOW_LOGIC:')) {
        question.showLogic = line.substring(11).trim();
        currentField = null;
      } else if (line.startsWith('RANDOMIZE:') || line.startsWith('RANDOMIZE_ROWS:')) {
        const value = line.includes(':') ? line.split(':')[1].trim().toLowerCase() : '';
        question.randomize = value === 'true';
        currentField = null;
      } else if (line.startsWith('TAGS:')) {
        const tagsStr = line.substring(5).trim();
        question.tags = tagsStr ? tagsStr.split(',').map(t => t.trim()).filter(t => t) : [];
        currentField = null;
      } else if (line.startsWith('NEEDS_REVIEW:')) {
        question.needsReview = line.substring(13).trim().toLowerCase() === 'true';
        currentField = null;
      } else if (line.startsWith('LOGIC:')) {
        question.logic = line.substring(6).trim();
        currentField = null;
      } else if (line.startsWith('TERMINATE_IF:')) {
        const terminateStr = line.substring(13).trim();
        if (terminateStr && terminateStr !== 'none') {
          // Check if it's a simple list of option codes or complex logic
          if (/^[\d,\s-]+$/.test(terminateStr)) {
            // Simple option codes like "1,2" or "1-4"
            const codes = [];
            const parts = terminateStr.split(',').map(p => p.trim());
            for (const part of parts) {
              if (part.includes('-')) {
                const [start, end] = part.split('-').map(n => parseInt(n.trim()));
                for (let i = start; i <= end; i++) {
                  codes.push(String(i));
                }
              } else {
                codes.push(part);
              }
            }
            question.terminateLogic = { optionCodes: codes };
          } else {
            // Complex logic - keep as string
            question.terminateLogic = terminateStr;
          }
        }
        currentField = null;
      } else if (currentField && line.match(/^\s+(.+)/)) {
        // This is a continuation line for options/statements/responses
        const match = line.match(/^\s*(.+)/);
        if (match) {
          const content = match[1].trim();
          if (content.includes('|')) {
            const [code, text] = content.split('|').map(s => s.trim());
            if (currentField === 'options') {
              question.options.push({ code, text });
            } else if (currentField === 'statementOptions') {
              question.statementOptions.push({ code, text });
            } else if (currentField === 'responseOptions') {
              question.responseOptions.push({ code, text });
            }
          } else if (currentField === 'options') {
            // Option without explicit code - use text as both
            question.options.push(content);
          }
        }
      }
    }

    // Clean up empty arrays
    if (question.statementOptions.length === 0) delete question.statementOptions;
    if (question.responseOptions.length === 0) delete question.responseOptions;
    if (question.options.length === 0) delete question.options;
    if (!question.showLogic) delete question.showLogic;
    if (!question.logic) delete question.logic;
    if (!question.terminateLogic) delete question.terminateLogic;
    if (question.tags.length === 0) delete question.tags;

    if (question.number && question.text) {
      questions.push(question);
    }
  }

  return questions;
}

// Parse questionnaire from .docx file using AI
async function parseQuestionnaire(filePath, projectId, extractedText = null) {
  try {
    // Extract text from .docx file if not provided
    let text;
    if (extractedText) {
      text = extractedText;
    } else {
    const result = await mammoth.extractRawText({ path: filePath });
      text = result.value;
    }

    // Define systemPrompt (used for both chunked and non-chunked parsing)
    const systemPrompt = `You are a Forsta/Decipher questionnaire expert. Parse questionnaires with EXACT fidelity to programming logic.

CRITICAL PARSING RULES:

1. PROGRAMMING NOTES (ALL CAPS TEXT):
   - "ASK IF [condition]" → showLogic: "[condition]"
   - "SHOW IF [condition]" → showLogic: "[condition]"  
   - "TERMINATE IF [condition]" → terminateLogic: See TERMINATE LOGIC rules below
   - "RANDOMIZE" → randomize: true (NOTE: This ONLY applies to rows/statement options, NEVER to columns/response options)
   - "RANGE: X-Y" → validation: {type: "range", min: X, max: Y}
   - "MUST = 100%" → validation: {type: "sum", value: 100, unit: "%"}

TERMINATE LOGIC PARSING RULES:
For "TERMINATE IF [condition]" instructions, parse as follows:

A. SIMPLE TERMINATE LOGIC (for Single Select and Multi-Select questions only):
   - If the condition references option codes from the current question (e.g., "if option 1", "if options 1, 2, 3", "if option 1-4")
   - Parse into structured format: terminateLogic: { "optionCodes": ["1", "2", "3"] }
   - Extract the option codes (numbers) that trigger termination
   - Examples:
     * "TERMINATE IF option 1 is selected" → terminateLogic: { "optionCodes": ["1"] }
     * "TERMINATE IF options 1, 2, 3, or 4 are selected" → terminateLogic: { "optionCodes": ["1", "2", "3", "4"] }
     * "TERMINATE IF option 1-4" → terminateLogic: { "optionCodes": ["1", "2", "3", "4"] }
     * "TERMINATE IF option 1 or 2" → terminateLogic: { "optionCodes": ["1", "2"] }

B. COMPLEX TERMINATE LOGIC:
   - If the condition references other questions (e.g., "if S9=1 and S10=5")
   - If the condition is complex (multiple conditions, AND/OR logic, etc.)
   - Keep as text string: terminateLogic: "TERMINATE IF S9=1 and S10=5"
   - Examples:
     * "TERMINATE IF S9=1 and S10=5" → terminateLogic: "TERMINATE IF S9=1 and S10=5"
     * "TERMINATE IF Q5=1 OR Q6=2" → terminateLogic: "TERMINATE IF Q5=1 OR Q6=2"

IMPORTANT: Only use structured format (optionCodes array) for Single Select and Multi-Select questions when the condition only references options from the current question. For all other cases, use text string format.

2. GRID DETECTION AND CLASSIFICATION:
   Grid questions are matrix-style questions with rows and columns. CRITICAL DISTINCTIONS:
   
   NUMERIC GRID:
   - Respondents enter numeric values (numbers, counts, percentages, etc.) in cells
   - MUST have BOTH row labels (statements) AND column headers (categories like age groups, time periods, etc.)
   - Respondents enter numbers for each row-column combination
   - Structure: BOTH statementOptions (rows) AND responseOptions (columns)
   - Examples: "How many patients by age group?" (rows = treatments, columns = age groups), "Enter numbers for each category" (rows = items, columns = categories)
   - Type: "Numeric Grid"
   - Key indicator: Look for multiple columns with headers that represent categories (age groups, time periods, etc.) where numeric values are entered, AND rows that represent statements/items

   CRITICAL FOR NUMERIC GRID PARSING:
   - You MUST extract BOTH the row labels AND the column headers
   - Row labels go in "statementOptions" array (these are the items being measured)
   - Column headers go in "responseOptions" array (these are the categories/time periods/groups)
   - Look for table structure with headers at the top and row labels on the left
   - Common column header patterns: "Q1 2024", "Q2 2024", "Q3 2024", "Q4 2024" OR "0-17", "18-34", "35-54", "55+" OR "Week 1", "Week 2", "Week 3"
   - If you see a table with rows on the left and columns at the top where numbers are entered, you MUST populate BOTH statementOptions AND responseOptions
   - Example structure:
     {
       "statementOptions": [
         {"code": "r1", "text": "Row 1 label"},
         {"code": "r2", "text": "Row 2 label"}
       ],
       "responseOptions": [
         {"code": "c1", "text": "Column 1 header"},
         {"code": "c2", "text": "Column 2 header"},
         {"code": "c3", "text": "Column 3 header"}
       ]
     }
   
   NUMERIC LIST:
   - Respondents enter numeric values (numbers, counts, percentages, etc.)
   - Has ONLY response options (a list of items), NO row labels/statements
   - Each response option gets a single numeric input
   - Structure: responseOptions only (or "options" field), NO statementOptions
   - Examples: "How many patients for each treatment?" (list of treatments, each with one number), "Enter a number for each option" (list of options, each with one number)
   - Type: "Numeric List"
   - Key indicator: Multiple items/options listed, each requiring a single numeric value (not a grid with rows and columns)
   
   SINGLE SELECT GRID:
   - Has row labels (statements) AND column headers (response codes/options)
   - Respondents select ONE option per row
   - Column headers are the response options (e.g., 1-7 scale, Yes/No, etc.)
   - Row labels are the statements (what's being rated/selected)
   - Type: "Single Select Grid"
   - Structure: statementOptions (rows) AND responseOptions (columns/headers)
   
   MULTI-SELECT GRID:
   - Has row labels (statements) AND column headers (response codes)
   - Respondents can select MULTIPLE options per row
   - Typically has "Values: 0-1" indicating checked/unchecked
   - Type: "Multi-Select Grid"
   - Structure: statementOptions (rows) AND responseOptions (columns)
   
   DETECTION PATTERNS:
   - Multiple columns with headers → check if numeric input or selection
   - Row labels on the left → these are statementOptions
   - Codes like "r1c2" (row 1, column 2) → indicates grid with both rows and columns
   - "AUTOFILL SUM OF..." → autofill calculation (often indicates numeric grid with columns)
   - "DO NOT SHOW COLUMN" → hidden column for calculations (often indicates numeric grid with columns)
   - "SUM OF COLUMNS X-Y MUST = COLUMN Z" → validation rule indicating numeric grid with multiple columns
   - If asking for numbers/amounts:
     - Has BOTH rows (statements) AND columns (categories) → NUMERIC GRID (with statementOptions AND responseOptions)
     - Has ONLY a list of options (no rows, no columns) → NUMERIC LIST (use "options" field)
     - Single input field → NUMERIC
   - If asking to select/rate from options (not entering numbers) → single-select or multi-select grid

3. SPECIAL TAGS (IN BRACKETS):
   - [ANCHOR] → anchor option to bottom
   - [EXCLUSIVE] → deselects all other options when selected
   - [SPECIFY] → adds text box for "Other, specify"
   - [RANDOMIZE] → randomize: true (NOTE: This ONLY applies to rows/statement options, NEVER to columns/response options. Only set randomize: true if the RANDOMIZE instruction applies to the statement options/rows)

4. PIPING (VARIABLES IN BRACKETS):
   - [INSERT variable] → insert value from previous question
   - "Of your [INSERT S4r5] patients" → piping from S4, row 5

5. HIDDEN VARIABLES:
   Detect sections like:
   "PATIENT COUNT (Hidden Variable)"
   "SPINRAZA RESTART GAP (Hidden Variable)"
   "TIME ON PAST TREATMENT (Hidden Variable)"
   
   CRITICAL: Hidden variables MUST be included in the questions array as regular questions with:
   - "number": Use format "hid_VARIABLE_NAME" where VARIABLE_NAME is derived from the hidden variable title
   - Convert the title to UPPERCASE and replace spaces with underscores
   - Remove "(Hidden Variable)" text from the name
   - Examples:
     * "SPINRAZA RESTART GAP (Hidden Variable)" → number: "hid_SPINRAZA_RESTART_GAP"
     * "TIME ON PAST TREATMENT (Hidden Variable)" → number: "hid_TIME_ON_PAST_TREATMENT"
     * "PATIENT COUNT (Hidden Variable)" → number: "hid_PATIENT_COUNT"
   - "text": The full title of the hidden variable (e.g., "SPINRAZA RESTART GAP (Hidden Variable)")
   - "type": "Single Select" (hidden variables typically have conditional logic options)
   - "options": Extract all the options/conditions from the hidden variable table/logic
   - "logic": Extract the calculation/conditional logic for each option
   - CRITICAL ORDERING: Hidden variables MUST appear in the questions array in the SAME ORDER they appear in the QNR document. Do NOT group them together in a separate section or at the end. If a hidden variable appears between question S5 and S6, it should be placed between S5 and S6 in the questions array.

6. QUOTAS:
   CRITICAL: Quotas are typically found at the FRONT of the questionnaire document, before the main questions begin.
   - Look for quota tables or quota definitions near the beginning of the document
   - Quotas typically have conditions (e.g., "Age 18-34", "Gender = Male") and limits (e.g., "n=100", "Complete 50")
   - Extract ALL quotas found in the document
   - Return quotas in a separate "quotas" array at the top level of the JSON response (NOT in the questions array)
   - Each quota should include:
     * "name": The quota name or identifier
     * "conditions": Array of conditions (e.g., ["Age 18-34", "Gender = Male"])
     * "limit": The quota limit (e.g., 100, 50)
     * "description": Any additional details about the quota
   - If quotas are found, include them in a "quotas" section at the beginning of the output

COMPREHENSIVE QUESTION TYPE LIBRARY:
Basic Question Types:
- Single Select: Respondents pick one option (can be one-dimensional or two-dimensional)
- Multi-Select: Respondents pick one or more options (supports exclusive options)
- Dropdown Menu: Drop-down list with up to three dimensions
- Button Single Select: Mobile-friendly button-based single selection
- Single Select Grid: Matrix-style grid with one column selection per row. Has statementOptions (rows) and responseOptions (column headers/scale)
- Button Single Select Grid: Touch-friendly grid with button selections
- Numeric Grid: Grid where respondents enter numeric values. MUST have BOTH statementOptions (rows) AND responseOptions (columns) representing categories like age groups, time periods, etc. Use when asking for numbers in a grid format with both rows and columns.
- Numeric List: List where respondents enter numeric values. Has ONLY response options (use "options" field), NO statementOptions. Each option gets a single numeric input. Use when asking for numbers for a list of items (no grid structure with rows and columns).
- Multi-Select Grid: Grid allowing multiple selections per row/cell. Has statementOptions (rows) and responseOptions (columns). Typically has "Values: 0-1"
- Button Multi-Select/Grid: Button-based multi-select including grid variants
- Open End: Freeform alphanumeric text input
- Numeric: Numeric values only (single numeric input, not a grid)

Dynamic/Advanced Types:
- Autosuggest: Type-ahead suggestions from predefined list
- Button Rating: Numeric rating scale as buttons (1-5, 1-10)
- Card Rating: Visual card-based rating
- Card Sort: Drag-and-drop cards into categories
- Date Picker: Calendar widget for date selection
- DCM Conjoint: Choice-based conjoint with profile selection
- Image Map: Click on specific image areas (hotspots)
- Media Evaluator: Rate/view media with timed feedback
- Media Testimonial: Record/upload video/audio responses
- Open Assist: AI-assisted open-ended questions
- Rating Scale (Dynamic): Visually enhanced animated rating scales
- Shopping Cart: E-commerce cart simulation
- Slider/Slider Rating: Draggable slider for numeric/percentage values
- Star Rating: Visual 1-5 or 1-10 star rating
- Text Highlighter: Highlight parts of passages
- This or That: Two-option comparison
- Video/Audio Player: Embedded media with follow-up
- Heat-Click: Track clicks/focus points on images
- Virtual Magazine/Page Timer: Timed/paginated content tracking
- Image Upload: Upload images as responses

Structural Elements:
- Descriptive Content: Static text/instructions
- Section: Organize questions into logical groups
- Note: Internal comments (not visible to respondents)
- Skip: Logic control for routing
- Terminate: End survey/disqualify based on conditions
- Quota: Control completion limits
- Reusable Answer List: Shared response options
- Exec: Hidden Python/custom logic execution
- Import Data: External variables/preloaded data

OUTPUT STRUCTURE:
Return enhanced JSON with all logic preserved.`;

    // Split questionnaire into sections using AI
    // This approach respects the natural structure of the questionnaire
    console.log(`🤖 Using AI to identify sections...`);
    let sections;
    try {
      sections = await identifySectionsWithAI(text, projectId);
    } catch (error) {
      console.error('AI section identification failed, falling back to regex method:', error);
      // Fallback to regex-based method if AI fails
      sections = splitQuestionnaireIntoSections(text);
    }
    
    if (sections.length === 0) {
      throw new Error('Failed to split questionnaire into sections');
    }
    
    // Parse all sections in parallel for faster processing
    const startTime = Date.now();
    console.log(`📦 Starting parallel parsing of ${sections.length} sections using GPT-4o...`);

    try {
      const sectionPromises = sections.map((section, i) =>
        parseQuestionnaireSection(section, i, sections.length, systemPrompt, projectId)
          .then(result => {
            const questionCount = result.questions?.length || 0;
            const quotaCount = result.quotas?.length || 0;
            const isQuotaSection = section.sectionName === 'Quota' || section.sectionName === 'Quotas' || section.sectionName?.toLowerCase() === 'quota' || section.sectionName?.toLowerCase() === 'quotas';
            
            // Validate question/quota count if expected count is available
            if (section.expectedQuestionCount !== undefined && section.expectedQuestionCount !== null) {
              const expectedCount = section.expectedQuestionCount;
              const actualCount = isQuotaSection ? quotaCount : questionCount;
              
              if (actualCount !== expectedCount) {
                console.warn(`⚠️ Section ${i + 1} (${section.sectionName || 'unnamed'}) - Expected ${expectedCount} ${isQuotaSection ? 'quotas' : 'questions'}, but found ${actualCount}`);
              } else {
                console.log(`✅ Section ${i + 1} (${section.sectionName || 'unnamed'}) - Found ${actualCount} ${isQuotaSection ? 'quotas' : 'questions'} (matches expected count)`);
              }
            } else {
              if (isQuotaSection && quotaCount > 0) {
                console.log(`✅ Section ${i + 1} (${section.sectionName || 'unnamed'}) completed - found ${quotaCount} quotas`);
              } else if (!isQuotaSection) {
                console.log(`✅ Section ${i + 1} (${section.sectionName || 'unnamed'}) completed - found ${questionCount} questions`);
              }
            }
            return result;
          })
          .catch(error => {
            console.error(`❌ Error parsing section ${i + 1} (${section.sectionName || 'unnamed'}):`, error);
            throw new Error(`Failed to parse section ${i + 1} of ${sections.length} (${section.sectionName || 'unnamed'}): ${error.message}`);
          })
      );

      const results = await Promise.all(sectionPromises);
      const allQuestions = results.flatMap(r => r.questions || []);
      const allQuotas = results.flatMap(r => r.quotas || []);

      const totalTime = ((Date.now() - startTime) / 1000).toFixed(1);
      console.log(`✅ Successfully parsed ${allQuestions.length} questions and ${allQuotas.length} quotas from ${sections.length} sections in ${totalTime}s (parallel processing)`);
    } catch (error) {
      throw error; // Re-throw to be caught by outer error handler
    }

      // Process and normalize all questions
      const processedQuestions = allQuestions.map((question, index) => {
        // Normalize options - extract codes from strings like "1 Amyotrophic lateral sclerosis (ALS)"
        const normalizedOptions = question.options?.map((opt, optIndex) => {
          const parsed = parseOptionString(opt);
          if (typeof parsed === 'string') {
            // No code found in string, use index
            return { code: String(optIndex + 1), text: parsed };
          }
          // Code was extracted, use it
          return parsed;
        });

        // Normalize statementOptions codes to always use "r" prefix
        const normalizedStatementOptions = question.statementOptions?.map((stmt, stmtIndex) => {
          const parsed = parseOptionString(stmt);
          const stmtObj = typeof parsed === 'string' ? { code: `r${stmtIndex + 1}`, text: parsed } : parsed;
          const code = stmtObj.code || `r${stmtIndex + 1}`;
          const normalizedCode = code.startsWith('r') ? code : `r${code.replace(/^r?/, '')}`;
          return { ...stmtObj, code: normalizedCode };
        });

        // Normalize responseOptions codes to always use "c" prefix
        const normalizedResponseOptions = question.responseOptions?.map((resp, respIndex) => {
          const parsed = parseOptionString(resp);
          const respObj = typeof parsed === 'string' ? { code: `c${respIndex + 1}`, text: parsed } : parsed;
          const code = respObj.code || `c${respIndex + 1}`;
          const normalizedCode = code.startsWith('c') ? code : `c${code.replace(/^c?/, '')}`;
          return { ...respObj, code: normalizedCode };
        });

        // Process tags
        let processedTags = Array.isArray(question.tags) ? [...question.tags] : [];

        // Detect scale questions first
        const questionText = (question.text || '').toLowerCase();
        const mentionsScale = questionText.includes('point scale') || questionText.includes('-point scale') ||
                             questionText.includes('rating scale') ||
                             (questionText.includes('scale') && (questionText.includes('rate') || questionText.includes('rate from') || questionText.includes('on a scale'))) ||
                             questionText.includes('how satisfied') || questionText.includes('how likely') ||
                             questionText.includes('how much do you agree') || questionText.includes('rate your') ||
                             questionText.includes('how important') || questionText.includes('how would you rate');

        // Check if this question has a Scale tag (either from AI or from mentions above)
        const hasScaleTag = processedTags.includes('Scale') || mentionsScale;

        if (mentionsScale && !processedTags.includes('Scale')) {
          processedTags.push('Scale');
        }

        // Convert Button Rating or Single Select with Scale tag to Rating Scale (Dynamic)
        if (question.type === 'Button Rating' || (question.type === 'Single Select' && hasScaleTag)) {
          question.type = 'Rating Scale (Dynamic)';
        }

        // Ensure hidden variables have the correct type
        const isHiddenVariable = question.number?.startsWith('hid_') ||
                                 question.text?.includes('(Hidden Variable)') ||
                                 question.type === 'Hidden Variable';
        if (isHiddenVariable) {
          question.type = 'Hidden Variable';
        }

        // Detect numeric type tags
        const isNumericQuestion = question.type === 'Numeric' || question.type === 'Numeric Grid' || question.type === 'Numeric List';
        if (isNumericQuestion) {
          const isPercent = questionText.includes('percent') || questionText.includes('percentage') || 
                            questionText.includes('%') || questionText.match(/\d+\s*%/);
          
          if (isPercent && !processedTags.includes('%')) {
            processedTags.push('%');
          } else if (!isPercent && !processedTags.includes('Number') && !processedTags.includes('%')) {
            processedTags.push('Number');
          }
        }

        return {
          ...question,
          // Use number as id if they're the same, otherwise use number as primary identifier
          id: question.number || question.id || `Q${index + 1}`,
          number: question.number || question.id || `Q${index + 1}`,
          needsReview: question.needsReview || false,
          tags: processedTags,
          showLogic: question.showLogic || null,
          randomize: question.randomize || false,
          logic: question.logic || question.showLogic || '',
          terminateLogic: question.terminateLogic || null,
          statementOptions: normalizedStatementOptions || (question.type && question.type.toLowerCase().includes('grid') ? [] : undefined),
          responseOptions: normalizedResponseOptions || (question.type && question.type.toLowerCase().includes('grid') && !question.type.toLowerCase().includes('numeric') ? [] : undefined),
          options: normalizedOptions || [],
          rawAiOutput: JSON.stringify(question, null, 2) // Store raw AI response for this question
        };
      });
      
      return { questions: processedQuestions, quotas: allQuotas };
  } catch (error) {
    console.error('Error parsing questionnaire:', error);
    throw new Error('Failed to parse questionnaire file: ' + error.message);
  }
}

// This function is kept for backward compatibility but is no longer used
// The upload endpoint now uses section-based parsing instead
async function parseQuestionnaireLegacy(filePath, projectId, extractedText = null) {
  try {
    // Extract text from .docx file if not provided
    let text;
    if (extractedText) {
      text = extractedText;
    } else {
      const result = await mammoth.extractRawText({ path: filePath });
      text = result.value;
    }

    // Single-pass parsing for smaller questionnaires
    const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    
    const userPrompt = `Please parse this questionnaire document and extract ALL questions with their details. CRITICAL: You MUST parse EVERY SINGLE question in this document. Do not skip any questions. Look for all question markers (QS, S, Q, A, F, G, etc. followed by numbers) and extract every question you find:


${text}

QUOTAS: Look for quota tables or quota definitions near the beginning of the document. Quotas are typically found at the FRONT of the questionnaire document, before the main questions begin. Extract ALL quotas found and include them in a "quotas" array.

HIDDEN VARIABLES: You MUST also parse any hidden variables found in this document. Hidden variables are sections with titles like "VARIABLE NAME (Hidden Variable)". For each hidden variable:
- Include it in the questions array IN THE SAME ORDER it appears in the QNR (do NOT group them in a separate section)
- Use "number": "hid_VARIABLE_NAME" format (convert title to UPPERCASE, replace spaces with underscores, remove "(Hidden Variable)")
- Example: "SPINRAZA RESTART GAP (Hidden Variable)" → number: "hid_SPINRAZA_RESTART_GAP"
- Extract all options/conditions from the hidden variable table
- Include the full title as the "text" field

Analyze the document thoroughly and return the structured data as JSON. Focus on extracting the core question information first, then add logic details where clearly present.

Return a JSON object with this structure:
{
  "quotas": [
    {
      "name": "quota name or identifier",
      "conditions": ["condition1", "condition2", ...],
      "limit": 100,
      "description": "quota description or details"
    }
  ],
  "questions": [
    {
      "number": "question number (e.g., S1, A1, Q1) - this will be used as the unique identifier. For hidden variables, use format 'hid_VARIABLE_NAME' (e.g., 'hid_SPINRAZA_RESTART_GAP')",
      "text": "full question text",
      "type": "specific Forsta question type from the library above",
      "options": ["option1", "option2", ...],  // For non-grid questions: response options
      "statementOptions": [{"code": "r1", "text": "statement 1"}, ...],  // For grid questions: row labels/statements (ALWAYS use "r" prefix: r1, r2, r3, etc.)
      "responseOptions": [{"code": "c1", "text": "Option 1"}, ...],  // For grid questions: column headers/response scale (ALWAYS use "c" prefix: c1, c2, c3, etc.)
      "showLogic": "condition for showing this question (if present)",
      "randomize": true/false,  // ONLY applies to rows/statement options, NEVER to columns/response options
      "tags": ["tag1", "tag2"],
      "needsReview": true/false,
      "logic": "any skip logic or conditions",
      "terminateLogic": "TERMINATE IF [condition]" OR {"optionCodes": ["1", "2", "3"]}  // For simple single/multi-select: structured object with optionCodes array. For complex logic: text string.
    }
  ]
}

NOTE: The "quotas" array is optional. Only include it if quotas are found in the document. If no quotas are found, you can omit the "quotas" field or set it to an empty array.

CRITICAL STRUCTURE RULES:
- For NUMERIC GRID: 
  - If the grid has ONLY rows with numeric input (no column headers/categories) → Use statementOptions (rows) only. DO NOT include responseOptions.
  - If the grid has BOTH rows (statements) AND columns (categories like age groups, time periods, etc.) where numeric values are entered → Use BOTH statementOptions (rows) AND responseOptions (columns). Examples: "How many patients by age group" (rows = treatments, columns = age groups), "Enter numbers for each category" (rows = items, columns = categories).
- For SINGLE SELECT GRID: Use BOTH statementOptions (rows) AND responseOptions (column headers/scale like 1-7, Yes/No, etc.)
- For MULTI-SELECT GRID: Use BOTH statementOptions (rows) AND responseOptions (columns)
- For regular questions (non-grid): Use "options" field (not statementOptions/responseOptions)
- If a grid asks for numbers/amounts/counts, it's a NUMERIC GRID, not a multi-select grid

CRITICAL: CODE FORMATTING RULES:
- statementOptions codes MUST always use "r" prefix: "r1", "r2", "r3", etc. (for rows)
- responseOptions codes MUST always use "c" prefix: "c1", "c2", "c3", etc. (for columns)
- Never use just numbers like "1", "2" for responseOptions - ALWAYS use "c1", "c2", etc.
- Never use just numbers like "1", "2" for statementOptions - ALWAYS use "r1", "r2", etc.

CRITICAL: RATING/SCALE QUESTION LABELS:
For rating questions (Button Rating, Rating Scale, Single Select Grid with scales, etc.), you MUST capture FULL labels, not just numbers:

PRIMARY METHOD - Extract from column headers/table headers:
- If the QNR shows column headers like "1 Strongly Disagree", "2 Disagree", "3 Neutral", "4 Agree", "5 Strongly Agree"
- Extract the FULL text: "1 Strongly Disagree" (not just "1")
- Look in the table/column headers for complete labels

FALLBACK METHOD - Extract from question text:
- If column headers are not available, look for labels defined in the question text itself
- Patterns to look for: "1=X", "4=Y", "7=Z" or "where 1=X, 4=Y, 7=Z" or "1=X, 4=Y, 7=Z"
- Example: "Please use a 7-point scale where 1=Less Likely to be Compliant on the Tablet, 4=Equally as Likely to be Compliant on the Tablet, and 7=More Likely to be Compliant on the Tablet"
- Extract: "1" → "1 Less Likely to be Compliant on the Tablet", "4" → "4 Equally as Likely to be Compliant on the Tablet", "7" → "7 More Likely to be Compliant on the Tablet"
- For intermediate numbers not explicitly labeled, use just the number (e.g., "2", "3", "5", "6")

ALWAYS prioritize column headers over question text. If both are present, use column headers.

Response options should ALWAYS include the full descriptive text, not just the numeric code.

TAG SYSTEM - ADDITIONAL METADATA:
Questions should include tags in the "tags" array to provide additional context:

IMPORTANT: DO NOT add "terminate" as a tag. Termination logic is handled separately in the "terminateLogic" field (see TERMINATE LOGIC PARSING RULES above).

1. SCALE TAG:
   - ONLY add "Scale" tag if the question is ACTUALLY a rating scale question, NOT just because it has 5, 7, or 10 options
   - Rating scales are questions that ask respondents to RATE, EVALUATE, or MEASURE something on a numeric scale (e.g., satisfaction, agreement, likelihood, importance)
   - Look for key indicators in the question text: "rate", "how satisfied", "how likely", "how much do you agree", "on a scale of", "rate from 1 to X", "how important", "how would you rate", etc.
   - Examples of ACTUAL scales: "How satisfied are you?" with 1-5 options, "How likely are you to recommend?" with 1-10 options, "Rate your agreement" with 1-7 options
   - Examples of NON-scales (DO NOT add Scale tag): "How many years of experience?" with 5 options (1-5, 6-10, etc.) → NOT a scale, "Which age group?" with 5 options → NOT a scale, "How many times per week?" with 7 options → NOT a scale, "How many patients?" with 10 options → NOT a scale
   - The question must be asking for a RATING/EVALUATION/MEASUREMENT, not just a categorical selection, count, or demographic question
   - If the question has 5, 7, or 10 options but is asking for a category, count, demographic, or selection (not a rating), DO NOT add the Scale tag
   - When in doubt, ask yourself: "Is this asking the respondent to rate/evaluate something?" If no, don't add the Scale tag

2. NUMERIC TYPE TAGS:
   - For Numeric questions, Numeric Grid questions, or Numeric List questions:
     - If the question text mentions "percent", "percentage", "%", or asks for a percentage → add "%" tag
     - If the question asks for a number, count, amount, or quantity (not a percentage) → add "Number" tag
     - Examples: "What percentage of..." → add "%" tag
     - Examples: "How many patients..." → add "Number" tag
     - Examples: "Enter a number from 0-100..." → determine from context (if asking for percentage, add "%", otherwise "Number")

3. BUTTON RATING CLASSIFICATION:
   - Button Rating questions should be classified as "Single Select" type
   - ONLY add the "Scale" tag if the Button Rating question is actually asking for a rating/evaluation (see SCALE TAG rules above)
   - DO NOT automatically add Scale tag just because it has 5, 7, or 10 options

IMPORTANT: Return ONLY valid JSON. Do not include any explanatory text outside the JSON object.`;

    const response = await client.chat.completions.create({
      model: 'gpt-4o',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt }
      ],
      temperature: 0.1,
      response_format: { type: 'json_object' },
      max_tokens: 16384  // Maximum output tokens for gpt-4o
    });

    const finishReason = response.choices[0].finish_reason;
    const content = response.choices[0].message.content;
    
    if (finishReason === 'length') {
      // Response was truncated - automatically retry with section-based parsing
      console.log('⚠️ Response was truncated. Automatically retrying with section-based parsing...');
      
      // Split into sections using AI and parse
      console.log('🤖 Using AI to identify sections for retry...');
      let sections;
      try {
        sections = await identifySectionsWithAI(text, projectId);
      } catch (error) {
        console.error('AI section identification failed, falling back to regex method:', error);
        // Fallback to regex-based method if AI fails
        sections = splitQuestionnaireIntoSections(text);
      }
      console.log(`📦 Split into ${sections.length} sections for retry`);
      
      if (sections.length === 0) {
        throw new Error('Failed to split questionnaire into sections');
      }
      
      // Parse all sections in parallel for much faster processing (retry path)
      const startTime = Date.now();
      console.log(`📦 Starting parallel parsing of ${sections.length} sections (retry)...`);

      try {
        const sectionPromises = sections.map((section, i) =>
          parseQuestionnaireSection(section, i, sections.length, systemPrompt, projectId)
            .then(questions => {
              console.log(`✅ Section ${i + 1} (${section.sectionName || 'unnamed'}) completed - found ${questions.length} questions`);
              return questions;
            })
            .catch(error => {
              console.error(`❌ Error parsing section ${i + 1} (${section.sectionName || 'unnamed'}):`, error);
              throw new Error(`Failed to parse section ${i + 1} of ${sections.length} (${section.sectionName || 'unnamed'}): ${error.message}`);
            })
        );

        const results = await Promise.all(sectionPromises);
        const allQuestions = results.flat();

        const totalTime = ((Date.now() - startTime) / 1000).toFixed(1);
        console.log(`✅ Successfully parsed ${allQuestions.length} questions from ${sections.length} sections in ${totalTime}s (parallel processing - retry)`);
      } catch (error) {
        throw error; // Re-throw to be caught by outer error handler
      }

      // Process and normalize all questions (same as chunked path above)
      const processedQuestions = allQuestions.map((question, index) => {
        // Normalize options - extract codes from strings like "1 Amyotrophic lateral sclerosis (ALS)"
        const normalizedOptions = question.options?.map((opt, optIndex) => {
          const parsed = parseOptionString(opt);
          if (typeof parsed === 'string') {
            // No code found in string, use index
            return { code: String(optIndex + 1), text: parsed };
          }
          // Code was extracted, use it
          return parsed;
        });

        const normalizedStatementOptions = question.statementOptions?.map((stmt, stmtIndex) => {
          const parsed = parseOptionString(stmt);
          const stmtObj = typeof parsed === 'string' ? { code: `r${stmtIndex + 1}`, text: parsed } : parsed;
          const code = stmtObj.code || `r${stmtIndex + 1}`;
          const normalizedCode = code.startsWith('r') ? code : `r${code.replace(/^r?/, '')}`;
          return { ...stmtObj, code: normalizedCode };
        });

        const normalizedResponseOptions = question.responseOptions?.map((resp, respIndex) => {
          const parsed = parseOptionString(resp);
          const respObj = typeof parsed === 'string' ? { code: `c${respIndex + 1}`, text: parsed } : parsed;
          const code = respObj.code || `c${respIndex + 1}`;
          const normalizedCode = code.startsWith('c') ? code : `c${code.replace(/^c?/, '')}`;
          return { ...respObj, code: normalizedCode };
        });

        let processedTags = Array.isArray(question.tags) ? [...question.tags] : [];

        // Detect scale questions first
        const questionText = (question.text || '').toLowerCase();
        const mentionsScale = questionText.includes('point scale') || questionText.includes('-point scale') ||
                             questionText.includes('rating scale') ||
                             (questionText.includes('scale') && (questionText.includes('rate') || questionText.includes('rate from') || questionText.includes('on a scale'))) ||
                             questionText.includes('how satisfied') || questionText.includes('how likely') ||
                             questionText.includes('how much do you agree') || questionText.includes('rate your') ||
                             questionText.includes('how important') || questionText.includes('how would you rate');

        // Check if this question has a Scale tag (either from AI or from mentions above)
        const hasScaleTag = processedTags.includes('Scale') || mentionsScale;

        if (mentionsScale && !processedTags.includes('Scale')) {
          processedTags.push('Scale');
        }

        // Convert Button Rating or Single Select with Scale tag to Rating Scale (Dynamic)
        if (question.type === 'Button Rating' || (question.type === 'Single Select' && hasScaleTag)) {
          question.type = 'Rating Scale (Dynamic)';
        }

        // Ensure hidden variables have the correct type
        const isHiddenVariable = question.number?.startsWith('hid_') ||
                                 question.text?.includes('(Hidden Variable)') ||
                                 question.type === 'Hidden Variable';
        if (isHiddenVariable) {
          question.type = 'Hidden Variable';
        }

        const isNumericQuestion = question.type === 'Numeric' || question.type === 'Numeric Grid' || question.type === 'Numeric List';
        if (isNumericQuestion) {
          const isPercent = questionText.includes('percent') || questionText.includes('percentage') || 
                            questionText.includes('%') || questionText.match(/\d+\s*%/);
          
          if (isPercent && !processedTags.includes('%')) {
            processedTags.push('%');
          } else if (!isPercent && !processedTags.includes('Number') && !processedTags.includes('%')) {
            processedTags.push('Number');
          }
        }

        return {
          ...question,
          // Use number as id if they're the same, otherwise use number as primary identifier
          id: question.number || question.id || `Q${index + 1}`,
          number: question.number || question.id || `Q${index + 1}`,
          needsReview: question.needsReview || false,
          tags: processedTags,
          showLogic: question.showLogic || null,
          randomize: question.randomize || false,
          logic: question.logic || question.showLogic || '',
          terminateLogic: question.terminateLogic || null,
          statementOptions: normalizedStatementOptions || (question.type && question.type.toLowerCase().includes('grid') ? [] : undefined),
          responseOptions: normalizedResponseOptions || (question.type && question.type.toLowerCase().includes('grid') && !question.type.toLowerCase().includes('numeric') ? [] : undefined),
          options: normalizedOptions || [],
          rawAiOutput: JSON.stringify(question, null, 2) // Store raw AI response for this question
        };
      });
      
      return processedQuestions;
    }
    
    // Check if content ends properly (basic check for incomplete JSON)
    if (!content || content.trim().length === 0) {
      throw new Error('AI returned empty response');
    }

    // Check if JSON appears incomplete (doesn't end with } or ])
    const trimmedContent = content.trim();
    let parsedData;
    if (!trimmedContent.endsWith('}') && !trimmedContent.endsWith(']')) {
      console.warn('Response may be incomplete - does not end with closing brace/bracket');
      // Try to find the last complete JSON object
      const lastBrace = trimmedContent.lastIndexOf('}');
      if (lastBrace > 0) {
        const potentiallyComplete = trimmedContent.substring(0, lastBrace + 1);
        try {
          parsedData = JSON.parse(potentiallyComplete);
          console.warn('Attempted to parse potentially truncated JSON - some questions may be missing');
        } catch (e) {
          // Fall through to full parse attempt
        }
      }
    }

    try {
      if (!parsedData) {
        parsedData = JSON.parse(content);
      }
    } catch (parseError) {
      console.error('JSON Parse Error:', parseError);
      console.error('Finish reason:', finishReason);
      console.error('Response length:', content.length);
      console.error('Raw response (first 1000 chars):', content.substring(0, 1000));
      console.error('Raw response (last 500 chars):', content.substring(Math.max(0, content.length - 500)));
      
      // Try to extract JSON from the response if it's wrapped in text
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        try {
          parsedData = JSON.parse(jsonMatch[0]);
        } catch (secondError) {
          throw new Error('Failed to parse JSON response from AI. The response may be incomplete. Finish reason: ' + finishReason + '. Error: ' + parseError.message + '. Raw content preview: ' + content.substring(0, 500));
        }
      } else {
        throw new Error('No valid JSON found in AI response. Finish reason: ' + finishReason + '. Raw content preview: ' + content.substring(0, 500));
      }
    }
    
    // Log cost for questionnaire parsing
    const inputTokens = response.usage?.prompt_tokens || 0;
    const outputTokens = response.usage?.completion_tokens || 0;
    
    if (inputTokens > 0 && outputTokens > 0 && projectId) {
      await logCost(
        projectId,
        COST_CATEGORIES.QUESTIONNAIRE_PARSING,
        'gpt-4o',
        inputTokens,
        outputTokens,
        'Questionnaire parsing and analysis'
      );
    }
    
    parsedData = parsedData || { questions: [] };
    
    // Add unique IDs and ensure proper formatting
    const questions = parsedData.questions.map((question, index) => {
      // Normalize options - extract codes from strings like "1 Amyotrophic lateral sclerosis (ALS)"
      const normalizedOptions = question.options?.map((opt, optIndex) => {
        const parsed = parseOptionString(opt);
        if (typeof parsed === 'string') {
          // No code found in string, use index
          return { code: String(optIndex + 1), text: parsed };
        }
        // Code was extracted, use it
        return parsed;
      });

      // Normalize statementOptions codes to always use "r" prefix
      const normalizedStatementOptions = question.statementOptions?.map((stmt, stmtIndex) => {
        const parsed = parseOptionString(stmt);
        const stmtObj = typeof parsed === 'string' ? { code: `r${stmtIndex + 1}`, text: parsed } : parsed;
        const code = stmtObj.code || `r${stmtIndex + 1}`;
        // Ensure code starts with "r" prefix
        const normalizedCode = code.startsWith('r') ? code : `r${code.replace(/^r?/, '')}`;
        return { ...stmtObj, code: normalizedCode };
      });

      // Normalize responseOptions codes to always use "c" prefix
      const normalizedResponseOptions = question.responseOptions?.map((resp, respIndex) => {
        const parsed = parseOptionString(resp);
        const respObj = typeof parsed === 'string' ? { code: `c${respIndex + 1}`, text: parsed } : parsed;
        const code = respObj.code || `c${respIndex + 1}`;
        // Ensure code starts with "c" prefix
        const normalizedCode = code.startsWith('c') ? code : `c${code.replace(/^c?/, '')}`;
        return { ...respObj, code: normalizedCode };
      });

      // Process tags - ensure we have an array
      let processedTags = Array.isArray(question.tags) ? [...question.tags] : [];

      // Detect scale questions first - ONLY if actually a rating/evaluation question, not just based on number of options
      // The AI should have already determined this in the prompt, but we do a final check for explicit scale mentions
      const questionText = (question.text || '').toLowerCase();
      const mentionsScale = questionText.includes('point scale') || questionText.includes('-point scale') ||
                           questionText.includes('rating scale') ||
                           (questionText.includes('scale') && (questionText.includes('rate') || questionText.includes('rate from') || questionText.includes('on a scale'))) ||
                           questionText.includes('how satisfied') || questionText.includes('how likely') ||
                           questionText.includes('how much do you agree') || questionText.includes('rate your') ||
                           questionText.includes('how important') || questionText.includes('how would you rate');

      // Check if this question has a Scale tag (either from AI or from mentions above)
      const hasScaleTag = processedTags.includes('Scale') || mentionsScale;

      // Only add Scale tag if AI already added it OR if question explicitly mentions scale terminology
      // DO NOT automatically add based on number of options - let AI determine from context
      if (mentionsScale && !processedTags.includes('Scale')) {
        processedTags.push('Scale');
      }

      // Convert Button Rating or Single Select with Scale tag to Rating Scale (Dynamic)
      if (question.type === 'Button Rating' || (question.type === 'Single Select' && hasScaleTag)) {
        question.type = 'Rating Scale (Dynamic)';
      }

      // Ensure hidden variables have the correct type
      const isHiddenVariable = question.number?.startsWith('hid_') ||
                               question.text?.includes('(Hidden Variable)') ||
                               question.type === 'Hidden Variable';
      if (isHiddenVariable) {
        question.type = 'Hidden Variable';
      }

      // Detect numeric type tags for Numeric questions and Numeric Grids
      const isNumericQuestion = question.type === 'Numeric' || question.type === 'Numeric Grid';
      if (isNumericQuestion) {
        const isPercent = questionText.includes('percent') || questionText.includes('percentage') || 
                          questionText.includes('%') || questionText.match(/\d+\s*%/);
        
        if (isPercent && !processedTags.includes('%')) {
          processedTags.push('%');
        } else if (!isPercent && !processedTags.includes('Number') && !processedTags.includes('%')) {
          processedTags.push('Number');
        }
      }

      // Store raw AI output before normalization
      const rawAiOutput = JSON.stringify(question, null, 2);
      
      return {
        ...question,
        // Use number as id if they're the same, otherwise use number as primary identifier
        id: question.number || question.id || `Q${index + 1}`,
        number: question.number || question.id || `Q${index + 1}`,
        needsReview: question.needsReview || false,
        rawAiOutput: rawAiOutput, // Store raw AI response for this question
        tags: processedTags,
        showLogic: question.showLogic || null,
        randomize: question.randomize || false,
        // Handle legacy logic field for backward compatibility
        logic: question.logic || question.showLogic || '',
        // Ensure statementOptions and responseOptions are properly formatted with correct prefixes
        statementOptions: normalizedStatementOptions || (question.type && question.type.toLowerCase().includes('grid') ? [] : undefined),
        responseOptions: normalizedResponseOptions || (question.type && question.type.toLowerCase().includes('grid') && !question.type.toLowerCase().includes('numeric') ? [] : undefined),
        // Keep options for backward compatibility with non-grid questions
        options: normalizedOptions || []
      };
    });
    
    return questions;
  } catch (error) {
    console.error('Error parsing questionnaire:', error);
    throw new Error('Failed to parse questionnaire file: ' + error.message);
  }
}

// XML escaping and sanitization helpers
function escapeXmlText(text) {
  if (!text) return '';
  let result = String(text);
  
  // Use placeholders to protect styled text from later processing
  const placeholderPrefix = '___STYLED_TEXT_';
  const placeholders = [];
  let placeholderIndex = 0;
  
  // Find all [text] patterns and wrap just the content in blue italic styling (no brackets)
  result = result.replace(/\[([^\]]+)\]/g, (match, content) => {
    // Escape HTML entities in the content
    const escapedContent = content
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
    // Create styled version without brackets - just the text in blue italic
    const styled = '<span style="color: blue; font-style: italic;">' + escapedContent + '</span>';
    // Store and return placeholder
    const placeholder = placeholderPrefix + placeholderIndex++ + '___';
    placeholders.push(styled);
    return placeholder;
  });
  
  // Now escape & < > in the remaining text
  result = result
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
  
  // Escape any remaining single brackets that weren't part of [text] patterns
  result = result.replace(/\[/g, '[[');
  result = result.replace(/\]/g, ']]');
  
  // Restore the styled text (unescape the HTML tags)
  placeholders.forEach((styled, index) => {
    const placeholder = placeholderPrefix + index + '___';
    // Unescape HTML entities in the span tags
    const unescapedStyled = styled
      .replace(/&lt;span/g, '<span')
      .replace(/&lt;\/span&gt;/g, '</span>');
    result = result.replace(placeholder, unescapedStyled);
  });
  
  return result;
}

function escapeXmlAttribute(text) {
  if (!text) return '';
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
    .replace(/\[/g, '[[')  // Escape [ to [[ to prevent Forsta from interpreting as variable (double bracket = literal bracket)
    .replace(/\]/g, ']]'); // Escape ] to ]] to prevent Forsta from interpreting as variable (double bracket = literal bracket)
}

function sanitizeXmlName(name) {
  if (!name) return 'unnamed';
  // XML element names must start with letter or underscore, and can only contain letters, digits, hyphens, underscores, and periods
  let sanitized = String(name)
    .replace(/[^a-zA-Z0-9_\-\.]/g, '_') // Replace invalid characters with underscore
    .replace(/^[^a-zA-Z_]/, '_'); // Ensure it starts with letter or underscore

  // Ensure the name is not empty
  return sanitized || 'unnamed';
}

// Generate XML for Forsta/Decipher compatibility - Simple/Legacy Structure
// Outputs XML using <radio>, <checkbox>, <grid>, <text>, <number>, <info> tags
function generateXml(questionnaire) {
  // Helper function to determine row label (r1, r2, r3, etc.)
  // Special cases: r97 for "Other", r98 for "Don't know", r99 for "Prefer not to answer" or "None"
  function getRowLabel(optionText, index, options) {
    const textLower = String(optionText || '').toLowerCase().trim();
    
    // Check for special cases
    if (textLower.includes('other') && (textLower.includes('specify') || textLower.includes('please specify'))) {
      return 'r97';
    }
    if (textLower.includes("don't know") || textLower.includes('dont know') || textLower.includes('don\'t know')) {
      return 'r98';
    }
    if (textLower.includes('prefer not to answer') || textLower.includes('none of the above') || textLower.includes('none')) {
      return 'r99';
    }
    
    // Default: r1, r2, r3, etc.
    return `r${index + 1}`;
  }

  // Helper function to check if option is "Other (specify)"
  function isOtherSpecify(optionText) {
    const textLower = String(optionText || '').toLowerCase().trim();
    // Must contain "other" and ("specify" or "please specify")
    // Exclude "none of the above" which might contain "other" in some contexts
    return textLower.includes('other') && 
           (textLower.includes('specify') || textLower.includes('please specify')) &&
           !textLower.includes('none of the above');
  }

  // Helper function to check if option is exclusive (None of the above, Prefer not to answer)
  function isExclusive(optionText) {
    const textLower = String(optionText || '').toLowerCase().trim();
    return textLower.includes('prefer not to answer') || 
           textLower.includes('none of the above') || 
           (textLower.includes('none') && !textLower.includes('other'));
  }

  // Helper function to get question label (QID)
  function getQuestionLabel(question) {
    // Use question.number if available, otherwise use question.id
    return question.number || question.id || 'Q1';
  }

  // Helper function to get options from question
  function getOptions(question) {
    // Try options first, then responseOptions
    if (question.options && question.options.length > 0) {
      return question.options;
    }
    if (question.responseOptions && question.responseOptions.length > 0) {
      return question.responseOptions;
    }
    return [];
  }

  // Helper function to get option text
  function getOptionText(option) {
    let text = '';
    if (typeof option === 'string') {
      text = option;
    } else {
      text = option.text || option.value || '';
    }
    
    // Remove leading numbers followed by a space (e.g., "1 Yes" -> "Yes")
    // This is because row labels (r1, r2, etc.) already serve as the codes
    text = text.replace(/^\d+\s+/, '').trim();
    
    return text;
  }

  const xml = questionnaire.questions.map(question => {
    const questionType = (question.type || '').toLowerCase();
    const questionLabel = getQuestionLabel(question);
    const questionText = question.text || '';
    
    // Determine XML tag type based on question type
    let tagName = '';
    let isGrid = false;
    let isSingleSelectGrid = false;
    let isMultiSelectGrid = false;
    
    if (questionType.includes('single select grid')) {
      tagName = 'radio';
      isGrid = true;
      isSingleSelectGrid = true;
    } else if (questionType.includes('multi-select grid')) {
      tagName = 'checkbox';
      isGrid = true;
      isMultiSelectGrid = true;
    } else if (questionType.includes('single select') || questionType.includes('single-select')) {
      tagName = 'radio';
    } else if (questionType.includes('multi-select') || questionType.includes('multi select')) {
      tagName = 'checkbox';
    } else if (questionType.includes('open end') || questionType.includes('open-end') || questionType.includes('text/open-ended')) {
      tagName = 'text';
    } else if (questionType.includes('numeric') || questionType.includes('number')) {
      tagName = 'number';
    } else if (questionType.includes('info') || questionType.includes('text-only')) {
      tagName = 'info';
        } else {
      // Default to text for unknown types
      tagName = 'text';
    }

    // Build opening tag with attributes
    let openingTag = `<${tagName} label="${escapeXmlAttribute(questionLabel)}"`;
    
    // For text (open end) questions, add size attribute for larger response box
    if (tagName === 'text') {
      openingTag += ` size="100"`;
    }
    
    // For number questions, add range attribute (required by Forsta/Decipher)
    if (tagName === 'number') {
      if (question.validation && question.validation.type === 'range') {
        // Use explicit checks to handle 0 correctly (0 is falsy but valid)
        const min = (question.validation.min !== undefined && question.validation.min !== null) 
          ? question.validation.min 
          : 0;
        const max = (question.validation.max !== undefined && question.validation.max !== null) 
          ? question.validation.max 
          : 999;
        openingTag += ` range="${min}-${max}"`;
        } else {
        // Default range if no validation specified
        openingTag += ` range="0-999"`;
      }
    }
    
    openingTag += `>\n`;
    let xml = openingTag;
    
    // Add title
    xml += `  <title>${escapeXmlText(questionText)}</title>\n`;
    
    // Add comment if available (optional)
    if (question.comment || question.instruction) {
      const commentText = question.comment || question.instruction;
      xml += `  <comment>${escapeXmlText(commentText)}</comment>\n`;
    } else if (tagName === 'radio') {
      if (isGrid) {
        xml += `  <comment>1 = Strongly disagree, 5 = Strongly agree</comment>\n`;
        } else {
        xml += `  <comment>Select one</comment>\n`;
      }
    } else if (tagName === 'checkbox') {
      if (isGrid) {
        xml += `  <comment>Select all that apply</comment>\n`;
      } else {
        xml += `  <comment>Select all that apply</comment>\n`;
      }
    } else if (tagName === 'text') {
      xml += `  <comment>Type your response below</comment>\n`;
    } else if (tagName === 'number') {
      xml += `  <comment>Enter a number</comment>\n`;
    }
    
    xml += '\n';

    // Handle GRID questions (use radio for single-select grid, checkbox for multi-select grid)
    if (isGrid) {
      // Grid has columns (responseOptions) and rows (statementOptions)
      const columns = question.responseOptions || [];
      const rows = question.statementOptions || [];
      
      // Add columns first
      columns.forEach((col, index) => {
        const colText = getOptionText(col);
        xml += `  <col label="c${index + 1}">${escapeXmlText(colText)}</col>\n`;
      });
      
      xml += '\n';
      
      // Add rows
      rows.forEach((row, index) => {
        const rowText = getOptionText(row);
        xml += `  <row label="r${index + 1}">${escapeXmlText(rowText)}</row>\n`;
      });
    }
    // Handle RADIO and CHECKBOX questions
    else if (tagName === 'radio' || tagName === 'checkbox') {
      const options = getOptions(question);
      
      // Track used labels to avoid duplicates
      const usedLabels = new Set();
      let regularIndex = 1;
      
      options.forEach((option, index) => {
        const optionText = getOptionText(option);
        let rowLabel = getRowLabel(optionText, index, options);
        
        // If the special label is already used, use regular numbering
        if (usedLabels.has(rowLabel)) {
          // Find next available regular label
          while (usedLabels.has(`r${regularIndex}`) || 
                 regularIndex === 97 || regularIndex === 98 || regularIndex === 99) {
            regularIndex++;
          }
          rowLabel = `r${regularIndex}`;
          regularIndex++;
        }
        
        usedLabels.add(rowLabel);
        
        let rowXml = `  <row label="${rowLabel}"`;
        
        // Add open="1" for "Other (specify)" options
        if (isOtherSpecify(optionText)) {
          rowXml += ` open="1" openSize="200"`;
        }
        
        // Add exclusive="1" for exclusive options
        if (isExclusive(optionText)) {
          rowXml += ` exclusive="1"`;
        }
        
        rowXml += `>${escapeXmlText(optionText)}</row>\n`;
        xml += rowXml;
      });
    }
    // Handle NUMBER questions
    // Range is already added as an attribute on the opening tag
    else if (tagName === 'number') {
      // Number questions don't have additional elements in the simple structure
    }
    // TEXT and INFO questions don't have rows/columns
    
    xml += `</${tagName}>`;
    
    return xml;
  }).join('\n\n<suspend/>\n\n');

  // Wrap the questions in the complete Forsta survey structure
  const surveyName = escapeXmlAttribute(questionnaire.name || 'Survey');
  const fullXml = `<?xml version="1.0" encoding="UTF-8"?>

<survey 
  alt="${surveyName}"
  autosave="0"
  builder:wizardCompleted="1"
  builderCompatible="1"
  compat="154"
  delphi="1"
  extraVariables="source,record,decLang,list,userAgent"
  fir="on"
  html:showNumber="0"
  mobile="compat"
  mobileDevices="smartphone,tablet,desktop"
  name="${surveyName}"
  secure="1"
  setup="term,decLang,quota,time"
  ss:disableBackButton="1"
  ss:enableNavigation="1"
  ss:hideProgressBar="0"
  state="testing">

<samplesources default="0">
  <samplesource list="0">
    <title>Open Survey</title>
    <invalid>You are missing information in the URL. Please verify the URL with the original invite.</invalid>
    <completed>It seems you have already completed this survey.</completed>
    <exit cond="terminated">Thank you for taking our survey.</exit>
    <exit cond="qualified">Thank you for taking our survey. Your efforts are greatly appreciated!</exit>
    <exit cond="overquota">Thank you for taking our survey.</exit>
  </samplesource>
</samplesources>

<suspend/>

${xml}

</survey>`;

  return fullXml;
}

// GET /api/questionnaire/all - Get all questionnaires across all projects
router.get('/all', async (req, res) => {
  try {
    const questionnairesPath = path.join(dataRoot, 'questionnaires.json');
    
    let questionnaires = {};
    try {
      const data = await fs.readFile(questionnairesPath, 'utf8');
      questionnaires = JSON.parse(data);
    } catch (error) {
      // File doesn't exist yet, that's fine
    }
    
    // Flatten all questionnaires from all projects into a single array
    const allQuestionnaires = [];
    for (const projectId in questionnaires) {
      if (Array.isArray(questionnaires[projectId])) {
        allQuestionnaires.push(...questionnaires[projectId]);
      }
    }
    
    res.json(allQuestionnaires);
  } catch (error) {
    console.error('Error loading all questionnaires:', error);
    res.status(500).json({ error: 'Failed to load questionnaires' });
  }
});

// GET /api/questionnaire/:projectId - Get questionnaires for a project
router.get('/:projectId', async (req, res) => {
  try {
    const { projectId } = req.params;
    const questionnairesPath = path.join(dataRoot, 'questionnaires.json');
    
    let questionnaires = {};
    try {
      const data = await fs.readFile(questionnairesPath, 'utf8');
      questionnaires = JSON.parse(data);
    } catch (error) {
      // File doesn't exist yet, that's fine
    }
    
    const projectQuestionnaires = questionnaires[projectId] || [];
    res.json(projectQuestionnaires);
  } catch (error) {
    console.error('Error loading questionnaires:', error);
    res.status(500).json({ error: 'Failed to load questionnaires' });
  }
});

// POST /api/questionnaire/validate-file - Validate file size and estimate tokens
router.post('/validate-file', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file provided' });
    }

    // Extract text from .docx file
    let text;
    try {
      const result = await mammoth.extractRawText({ path: req.file.path });
      text = result.value;
    } catch (error) {
      // Clean up file on error
      try {
        await fs.unlink(req.file.path);
      } catch (e) {
        // Ignore cleanup errors
      }
      return res.status(400).json({ error: 'Failed to read questionnaire file. Please ensure it is a valid .docx file.' });
    }

    // Estimate tokens
    const estimatedTokens = text.length / 4; // Rough estimate: 4 chars per token
    const estimatedOutputTokens = estimatedTokens * 0.3; // Rough estimate: output is ~30% of input

    // Limits
    const MAX_ESTIMATED_OUTPUT_TOKENS = 20000;
    const MAX_TEXT_LENGTH = 500000;

    const isValid = estimatedOutputTokens <= MAX_ESTIMATED_OUTPUT_TOKENS && text.length <= MAX_TEXT_LENGTH;

    // Clean up the temporary file
    try {
      await fs.unlink(req.file.path);
    } catch (e) {
      // Ignore cleanup errors
    }

    res.json({
      isValid,
      fileSize: req.file.size,
      textLength: text.length,
      estimatedInputTokens: Math.round(estimatedTokens),
      estimatedOutputTokens: Math.round(estimatedOutputTokens),
      maxOutputTokens: MAX_ESTIMATED_OUTPUT_TOKENS,
      maxTextLength: MAX_TEXT_LENGTH,
      message: isValid 
        ? 'File is valid and ready to upload'
        : `File is too large. Estimated output tokens: ${Math.round(estimatedOutputTokens)} (max: ${MAX_ESTIMATED_OUTPUT_TOKENS}), Text length: ${text.length} characters (max: ${MAX_TEXT_LENGTH})`
    });
  } catch (error) {
    console.error('Error validating file:', error);
    // Clean up file on error
    if (req.file && req.file.path) {
      try {
        await fs.unlink(req.file.path);
      } catch (e) {
        // Ignore cleanup errors
      }
    }
    res.status(500).json({ error: 'Failed to validate file: ' + error.message });
  }
});

// POST /api/questionnaire/upload - Upload questionnaire and identify sections (without parsing)
router.post('/upload', upload.single('file'), async (req, res) => {
  try {
    const { projectId } = req.body;
    const { name } = req.body;
    
    if (!req.file || !projectId) {
      return res.status(400).json({ error: 'Missing file or projectId' });
    }
    
    // Extract text from file
    let text;
    try {
      const result = await mammoth.extractRawText({ path: req.file.path });
      text = result.value;
    } catch (error) {
      // Clean up file on error
      try {
        await fs.unlink(req.file.path);
      } catch (e) {
        // Ignore cleanup errors
      }
      return res.status(400).json({ error: 'Failed to read questionnaire file. Please ensure it is a valid .docx file.' });
    }
    
    // Delete the .docx file immediately after extracting text
    try {
      await fs.unlink(req.file.path);
      console.log(`🗑️ Deleted uploaded file: ${req.file.path}`);
    } catch (error) {
      console.warn(`⚠️ Could not delete uploaded file ${req.file.path}:`, error);
      // Continue even if file deletion fails
    }
    
    // Extract all question numbers and group by prefix (hard-coded approach)
    console.log('🔍 Extracting question numbers from document...');
    const questionNumbersByPrefix = extractAllQuestionNumbersByPrefix(text);
    
    // Log found question numbers by prefix
    console.log('📋 Found question numbers by prefix:');
    let totalQuestionCount = 0;
    Object.keys(questionNumbersByPrefix).forEach(prefix => {
      const questions = questionNumbersByPrefix[prefix];
      totalQuestionCount += questions.length;
      console.log(`   Section ${prefix}: ${questions.length} questions - ${questions.slice(0, 10).join(', ')}${questions.length > 10 ? '...' : ''}`);
    });
    
    // Create sections based on question number prefixes
    let sections = createSectionsFromQuestionNumbers(text, questionNumbersByPrefix);

    // Filter out false positive "Section Q" with only 1-2 questions (likely quarter references like Q1, Q2, Q3, Q4)
    const filteredSections = sections.filter(section => {
      const isQuestionQ = section.questionPrefix === 'Q' || section.sectionName === 'Section Q';
      const hasVeryFewQuestions = section.expectedQuestionCount !== undefined && section.expectedQuestionCount <= 2;

      if (isQuestionQ && hasVeryFewQuestions) {
        console.log(`🚫 Filtering out "${section.sectionName}" with only ${section.expectedQuestionCount} question(s) - likely a false positive (quarter reference)`);
        return false;
      }
      return true;
    });

    // Renumber sections after filtering
    sections = filteredSections.map((section, index) => ({
      ...section,
      sectionNumber: index + 1
    }));

    // Log quota section info if it exists
    const quotaSection = sections.find(s => s.sectionName === 'Quota' || s.sectionName?.toLowerCase() === 'quota');
    if (quotaSection && quotaSection.foundQuestionNumbers && quotaSection.foundQuestionNumbers.length > 0) {
      console.log(`📊 Quota section: Found ${quotaSection.foundQuestionNumbers.length} quotas/subquotas - ${quotaSection.foundQuestionNumbers.slice(0, 10).join(', ')}${quotaSection.foundQuestionNumbers.length > 10 ? '...' : ''}`);
    }
    
    console.log(`✅ Created ${sections.length} sections from question number prefixes (Total questions: ${totalQuestionCount})`);
    
    // Create a temporary questionnaire object with sections but no questions yet
    const questionnaireId = `qnr-${Date.now()}`;
    const questionnaire = {
      id: questionnaireId,
      name: name || req.file.originalname.replace('.docx', ''),
      questions: [], // Will be populated as sections are parsed
      sections: sections.map((section, index) => ({
        expectedQuestionCount: section.expectedQuestionCount,
        foundQuestionNumbers: section.foundQuestionNumbers || [],
        sectionNumber: section.sectionNumber,
        sectionName: section.sectionName,
        questionPrefix: section.questionPrefix || null,
        startIndex: section.startIndex,
        endIndex: section.endIndex,
        textLength: section.text.length,
        parsed: false,
        questions: []
      })),
      extractedText: text, // Save extracted text instead of file path
      createdAt: new Date().toISOString(),
      projectId: projectId
    };
    
    // Save to questionnaires.json (with extracted text so we can parse sections later)
    const questionnairesPath = path.join(dataRoot, 'questionnaires.json');
    let questionnaires = {};
    
    try {
      const data = await fs.readFile(questionnairesPath, 'utf8');
      questionnaires = JSON.parse(data);
    } catch (error) {
      // File doesn't exist yet, that's fine
    }
    
    if (!questionnaires[projectId]) {
      questionnaires[projectId] = [];
    }
    
    questionnaires[projectId].push(questionnaire);
    
    await fs.writeFile(questionnairesPath, JSON.stringify(questionnaires, null, 2));
    
    // Return questionnaire with sections (but no questions yet)
    res.json({
      ...questionnaire,
      sections: sections.map((section, index) => ({
        sectionNumber: section.sectionNumber,
        sectionName: section.sectionName,
        questionPrefix: section.questionPrefix || null,
        textLength: section.text.length,
        parsed: false,
        expectedQuestionCount: section.expectedQuestionCount,
        foundQuestionNumbers: section.foundQuestionNumbers || []
      }))
    });
  } catch (error) {
    console.error('Error uploading questionnaire:', error);
    res.status(500).json({ error: 'Failed to upload questionnaire: ' + error.message });
  }
});

// POST /api/questionnaire/:questionnaireId/parse-section - Parse a single section
router.post('/:questionnaireId/parse-section', async (req, res) => {
  try {
    const { questionnaireId } = req.params;
    const { sectionNumber } = req.body;
    
    if (!sectionNumber) {
      return res.status(400).json({ error: 'Missing sectionNumber' });
    }
    
    // Load questionnaire
    const questionnairesPath = path.join(dataRoot, 'questionnaires.json');
    let questionnaires = {};
    
    try {
      const data = await fs.readFile(questionnairesPath, 'utf8');
      questionnaires = JSON.parse(data);
    } catch (error) {
      return res.status(404).json({ error: 'Questionnaires file not found' });
    }
    
    // Find questionnaire
    let questionnaire = null;
    let projectId = null;
    
    for (const pid in questionnaires) {
      const qnr = questionnaires[pid].find(q => q.id === questionnaireId);
      if (qnr) {
        questionnaire = qnr;
        projectId = pid;
        break;
      }
    }
    
    if (!questionnaire) {
      return res.status(404).json({ error: 'Questionnaire not found' });
    }
    
    // Get extracted text (preferred) or extract from file (backwards compatibility)
    let text;
    if (questionnaire.extractedText) {
      text = questionnaire.extractedText;
    } else if (questionnaire.filePath) {
      // Backwards compatibility: extract from file if extractedText not available
      try {
        const result = await mammoth.extractRawText({ path: questionnaire.filePath });
        text = result.value;
      } catch (error) {
        return res.status(400).json({ error: 'Failed to read questionnaire file.' });
      }
    } else {
      return res.status(400).json({ error: 'Questionnaire text not found. Cannot parse section.' });
    }
    
    // Find the section
    const section = questionnaire.sections?.find(s => s.sectionNumber === sectionNumber);
    if (!section) {
      return res.status(404).json({ error: `Section ${sectionNumber} not found` });
    }
    
    if (section.parsed) {
      return res.json({
        message: 'Section already parsed',
        questions: section.questions || []
      });
    }

    // Extract section text using saved startIndex and endIndex (don't re-identify with AI)
    console.log(`📄 Extracting section ${sectionNumber} text using saved boundaries...`);
    const startIndex = section.startIndex !== undefined ? section.startIndex : 0;
    const endIndex = section.endIndex !== undefined && section.endIndex !== null
      ? section.endIndex
      : text.length;

    const sectionText = text.substring(startIndex, endIndex);

    // Create section object for parsing
    const sectionToParse = {
      text: sectionText,
      sectionNumber: section.sectionNumber,
      sectionName: section.sectionName,
      questionPrefix: section.questionPrefix,
      expectedQuestionCount: section.expectedQuestionCount,
      foundQuestionNumbers: section.foundQuestionNumbers || []
    };

    console.log(`✅ Extracted section text (${sectionText.length} chars, ${section.foundQuestionNumbers?.length || 0} identified questions)`);

    if (!sectionToParse || !sectionText) {
      return res.status(404).json({ error: `Section ${sectionNumber} text not found` });
    }
    
    // Get the system prompt (same as used in parseQuestionnaire)
    const systemPrompt = `You are a Forsta/Decipher questionnaire expert. Parse questionnaires with EXACT fidelity to programming logic.

CRITICAL PARSING RULES:

1. PROGRAMMING NOTES (ALL CAPS TEXT):
   - "ASK IF [condition]" → showLogic: "[condition]"
   - "SHOW IF [condition]" → showLogic: "[condition]"  
   - "TERMINATE IF [condition]" → terminateLogic: See TERMINATE LOGIC rules below
   - "RANDOMIZE" → randomize: true (NOTE: This ONLY applies to rows/statement options, NEVER to columns/response options)
   - "RANGE: X-Y" → validation: {type: "range", min: X, max: Y}
   - "MUST = 100%" → validation: {type: "sum", value: 100, unit: "%"}

TERMINATE LOGIC PARSING RULES:
For "TERMINATE IF [condition]" instructions, parse as follows:

A. SIMPLE TERMINATE LOGIC (for Single Select and Multi-Select questions only):
   - If the condition references option codes from the current question (e.g., "if option 1", "if options 1, 2, 3", "if option 1-4")
   - Parse into structured format: terminateLogic: { "optionCodes": ["1", "2", "3"] }
   - Extract the option codes (numbers) that trigger termination
   - Examples:
     * "TERMINATE IF option 1 is selected" → terminateLogic: { "optionCodes": ["1"] }
     * "TERMINATE IF options 1, 2, 3, or 4 are selected" → terminateLogic: { "optionCodes": ["1", "2", "3", "4"] }
     * "TERMINATE IF option 1-4" → terminateLogic: { "optionCodes": ["1", "2", "3", "4"] }
     * "TERMINATE IF option 1 or 2" → terminateLogic: { "optionCodes": ["1", "2"] }

B. COMPLEX TERMINATE LOGIC:
   - If the condition references other questions (e.g., "if S9=1 and S10=5")
   - If the condition is complex (multiple conditions, AND/OR logic, etc.)
   - Keep as text string: terminateLogic: "TERMINATE IF S9=1 and S10=5"
   - Examples:
     * "TERMINATE IF S9=1 and S10=5" → terminateLogic: "TERMINATE IF S9=1 and S10=5"
     * "TERMINATE IF Q5=1 OR Q6=2" → terminateLogic: "TERMINATE IF Q5=1 OR Q6=2"

IMPORTANT: Only use structured format (optionCodes array) for Single Select and Multi-Select questions when the condition only references options from the current question. For all other cases, use text string format.

2. GRID DETECTION AND CLASSIFICATION:
   Grid questions are matrix-style questions with rows and columns. CRITICAL DISTINCTIONS:
   
   NUMERIC GRID:
   - Respondents enter numeric values (numbers, counts, percentages, etc.) in cells
   - MUST have BOTH row labels (statements) AND column headers (categories like age groups, time periods, etc.)
   - Respondents enter numbers for each row-column combination
   - Structure: BOTH statementOptions (rows) AND responseOptions (columns)
   - Examples: "How many patients by age group?" (rows = treatments, columns = age groups), "Enter numbers for each category" (rows = items, columns = categories)
   - Type: "Numeric Grid"
   - Key indicator: Look for multiple columns with headers that represent categories (age groups, time periods, etc.) where numeric values are entered, AND rows that represent statements/items

   CRITICAL FOR NUMERIC GRID PARSING:
   - You MUST extract BOTH the row labels AND the column headers
   - Row labels go in "statementOptions" array (these are the items being measured)
   - Column headers go in "responseOptions" array (these are the categories/time periods/groups)
   - Look for table structure with headers at the top and row labels on the left
   - Common column header patterns: "Q1 2024", "Q2 2024", "Q3 2024", "Q4 2024" OR "0-17", "18-34", "35-54", "55+" OR "Week 1", "Week 2", "Week 3"
   - If you see a table with rows on the left and columns at the top where numbers are entered, you MUST populate BOTH statementOptions AND responseOptions
   - Example structure:
     {
       "statementOptions": [
         {"code": "r1", "text": "Row 1 label"},
         {"code": "r2", "text": "Row 2 label"}
       ],
       "responseOptions": [
         {"code": "c1", "text": "Column 1 header"},
         {"code": "c2", "text": "Column 2 header"},
         {"code": "c3", "text": "Column 3 header"}
       ]
     }
   
   NUMERIC LIST:
   - Respondents enter numeric values (numbers, counts, percentages, etc.)
   - Has ONLY response options (a list of items), NO row labels/statements
   - Each response option gets a single numeric input
   - Structure: responseOptions only (or "options" field), NO statementOptions
   - Examples: "How many patients for each treatment?" (list of treatments, each with one number), "Enter a number for each option" (list of options, each with one number)
   - Type: "Numeric List"
   - Key indicator: Multiple items/options listed, each requiring a single numeric value (not a grid with rows and columns)
   
   SINGLE SELECT GRID:
   - Has row labels (statements) AND column headers (response codes/options)
   - Respondents select ONE option per row
   - Column headers are the response options (e.g., 1-7 scale, Yes/No, etc.)
   - Row labels are the statements (what's being rated/selected)
   - Type: "Single Select Grid"
   - Structure: statementOptions (rows) AND responseOptions (columns/headers)
   
   MULTI-SELECT GRID:
   - Has row labels (statements) AND column headers (response codes)
   - Respondents can select MULTIPLE options per row
   - Typically has "Values: 0-1" indicating checked/unchecked
   - Type: "Multi-Select Grid"
   - Structure: statementOptions (rows) AND responseOptions (columns)
   
   DETECTION PATTERNS:
   - Multiple columns with headers → check if numeric input or selection
   - Row labels on the left → these are statementOptions
   - Codes like "r1c2" (row 1, column 2) → indicates grid with both rows and columns
   - "AUTOFILL SUM OF..." → autofill calculation (often indicates numeric grid with columns)
   - "DO NOT SHOW COLUMN" → hidden column for calculations (often indicates numeric grid with columns)
   - "SUM OF COLUMNS X-Y MUST = COLUMN Z" → validation rule indicating numeric grid with multiple columns
   - If asking for numbers/amounts:
     - Has BOTH rows (statements) AND columns (categories) → NUMERIC GRID (with statementOptions AND responseOptions)
     - Has ONLY a list of options (no rows, no columns) → NUMERIC LIST (use "options" field)
     - Single input field → NUMERIC
   - If asking to select/rate from options (not entering numbers) → single-select or multi-select grid

3. SPECIAL TAGS (IN BRACKETS):
   - [ANCHOR] → anchor option to bottom
   - [EXCLUSIVE] → deselects all other options when selected
   - [SPECIFY] → adds text box for "Other, specify"
   - [RANDOMIZE] → randomize: true (NOTE: This ONLY applies to rows/statement options, NEVER to columns/response options. Only set randomize: true if the RANDOMIZE instruction applies to the statement options/rows)

4. PIPING (VARIABLES IN BRACKETS):
   - [INSERT variable] → insert value from previous question
   - "Of your [INSERT S4r5] patients" → piping from S4, row 5

5. HIDDEN VARIABLES:
   Detect sections like:
   "PATIENT COUNT (Hidden Variable)"
   "SPINRAZA RESTART GAP (Hidden Variable)"
   "TIME ON PAST TREATMENT (Hidden Variable)"
   
   CRITICAL: Hidden variables MUST be included in the questions array as regular questions with:
   - "number": Use format "hid_VARIABLE_NAME" where VARIABLE_NAME is derived from the hidden variable title
   - Convert the title to UPPERCASE and replace spaces with underscores
   - Remove "(Hidden Variable)" text from the name
   - Examples:
     * "SPINRAZA RESTART GAP (Hidden Variable)" → number: "hid_SPINRAZA_RESTART_GAP"
     * "TIME ON PAST TREATMENT (Hidden Variable)" → number: "hid_TIME_ON_PAST_TREATMENT"
     * "PATIENT COUNT (Hidden Variable)" → number: "hid_PATIENT_COUNT"
   - "text": The full title of the hidden variable (e.g., "SPINRAZA RESTART GAP (Hidden Variable)")
   - "type": "Single Select" (hidden variables typically have conditional logic options)
   - "options": Extract all the options/conditions from the hidden variable table/logic
   - "logic": Extract the calculation/conditional logic for each option
   - CRITICAL ORDERING: Hidden variables MUST appear in the questions array in the SAME ORDER they appear in the QNR document. Do NOT group them together in a separate section or at the end. If a hidden variable appears between question S5 and S6, it should be placed between S5 and S6 in the questions array.

6. QUOTAS:
   CRITICAL: Quotas are typically found at the FRONT of the questionnaire document, before the main questions begin.
   - Look for quota tables or quota definitions near the beginning of the document
   - Quotas typically have conditions (e.g., "Age 18-34", "Gender = Male") and limits (e.g., "n=100", "Complete 50")
   - Extract ALL quotas found in the document
   - Return quotas in a separate "quotas" array at the top level of the JSON response (NOT in the questions array)
   - Each quota should include:
     * "name": The quota name or identifier
     * "conditions": Array of conditions (e.g., ["Age 18-34", "Gender = Male"])
     * "limit": The quota limit (e.g., 100, 50)
     * "description": Any additional details about the quota
   - If quotas are found, include them in a "quotas" section at the beginning of the output

COMPREHENSIVE QUESTION TYPE LIBRARY:
Basic Question Types:
- Single Select: Respondents pick one option (can be one-dimensional or two-dimensional)
- Multi-Select: Respondents pick one or more options (supports exclusive options)
- Dropdown Menu: Drop-down list with up to three dimensions
- Button Single Select: Mobile-friendly button-based single selection
- Single Select Grid: Matrix-style grid with one column selection per row. Has statementOptions (rows) and responseOptions (column headers/scale)
- Button Single Select Grid: Touch-friendly grid with button selections
- Numeric Grid: Grid where respondents enter numeric values. MUST have BOTH statementOptions (rows) AND responseOptions (columns) representing categories like age groups, time periods, etc. Use when asking for numbers in a grid format with both rows and columns.
- Numeric List: List where respondents enter numeric values. Has ONLY response options (use "options" field), NO statementOptions. Each option gets a single numeric input. Use when asking for numbers for a list of items (no grid structure with rows and columns).
- Multi-Select Grid: Grid allowing multiple selections per row/cell. Has statementOptions (rows) and responseOptions (columns). Typically has "Values: 0-1"
- Button Multi-Select/Grid: Button-based multi-select including grid variants
- Open End: Freeform alphanumeric text input
- Numeric: Numeric values only (single numeric input, not a grid)

Dynamic/Advanced Types:
- Autosuggest: Type-ahead suggestions from predefined list
- Button Rating: Numeric rating scale as buttons (1-5, 1-10)
- Card Rating: Visual card-based rating
- Card Sort: Drag-and-drop cards into categories
- Date Picker: Calendar widget for date selection
- DCM Conjoint: Choice-based conjoint with profile selection
- Image Map: Click on specific image areas (hotspots)
- Media Evaluator: Rate/view media with timed feedback
- Media Testimonial: Record/upload video/audio responses
- Open Assist: AI-assisted open-ended questions
- Rating Scale (Dynamic): Visually enhanced animated rating scales
- Shopping Cart: E-commerce cart simulation
- Slider/Slider Rating: Draggable slider for numeric/percentage values
- Star Rating: Visual 1-5 or 1-10 star rating
- Text Highlighter: Highlight parts of passages
- This or That: Two-option comparison
- Video/Audio Player: Embedded media with follow-up
- Heat-Click: Track clicks/focus points on images
- Virtual Magazine/Page Timer: Timed/paginated content tracking
- Image Upload: Upload images as responses

Structural Elements:
- Descriptive Content: Static text/instructions
- Section: Organize questions into logical groups
- Note: Internal comments (not visible to respondents)
- Skip: Logic control for routing
- Terminate: End survey/disqualify based on conditions
- Quota: Control completion limits
- Reusable Answer List: Shared response options
- Exec: Hidden Python/custom logic execution
- Import Data: External variables/preloaded data

OUTPUT STRUCTURE:
Return enhanced JSON with all logic preserved.`;
    
    // Parse the section (AI call - can happen in parallel)
    const result = await parseQuestionnaireSection(
      sectionToParse,
      sectionNumber - 1,
      questionnaire.sections.length,
      systemPrompt,
      projectId
    );

    const questions = result.questions || [];
    const quotas = result.quotas || [];

    // Use mutex lock for file operations to prevent race conditions during parallel parsing
    await withQuestionnaireLock(questionnaireId, async () => {
      // Re-read the questionnaire file to get the latest state
      const latestData = await fs.readFile(questionnairesPath, 'utf8');
      const latestQuestionnaires = JSON.parse(latestData);

      // Find the questionnaire again with latest data
      let latestQuestionnaire = null;
      for (const pid in latestQuestionnaires) {
        const qnr = latestQuestionnaires[pid].find(q => q.id === questionnaireId);
        if (qnr) {
          latestQuestionnaire = qnr;
          break;
        }
      }

      if (!latestQuestionnaire) {
        throw new Error('Questionnaire not found during update');
      }

      // Find the section in the latest questionnaire
      const latestSection = latestQuestionnaire.sections?.find(s => s.sectionNumber === sectionNumber);
      if (!latestSection) {
        throw new Error(`Section ${sectionNumber} not found during update`);
      }

      // Update the section
      latestSection.parsed = true;
      latestSection.questions = questions;

      // Rebuild the main questions array from all sections in correct order
      // This ensures questions appear in section order, not completion order
      latestQuestionnaire.questions = [];
      const sortedSections = (latestQuestionnaire.sections || []).sort((a, b) => a.sectionNumber - b.sectionNumber);
      for (const sect of sortedSections) {
        if (sect.parsed && sect.questions) {
          latestQuestionnaire.questions.push(...sect.questions);
        }
      }

      // Add quotas to the questionnaire if this is the Quota section
      const isQuotaSection = latestSection.sectionName === 'Quota' || latestSection.sectionName === 'Quotas' || latestSection.sectionName?.toLowerCase() === 'quota' || latestSection.sectionName?.toLowerCase() === 'quotas';
      if (isQuotaSection) {
        latestQuestionnaire.quotas = quotas;
      } else if (quotas.length > 0) {
        // If quotas found in a non-quota section, merge them
        if (!latestQuestionnaire.quotas) {
          latestQuestionnaire.quotas = [];
        }
        latestQuestionnaire.quotas.push(...quotas);
      }

      // Save updated questionnaire
      await fs.writeFile(questionnairesPath, JSON.stringify(latestQuestionnaires, null, 2));
    });
    
    res.json({
      sectionNumber: sectionNumber,
      sectionName: section.sectionName,
      questions: questions,
      quotas: quotas,
      totalQuestions: questionnaire.questions.length
    });
  } catch (error) {
    console.error('Error parsing section:', error);
    res.status(500).json({ error: 'Failed to parse section: ' + error.message });
  }
});

// POST /api/questionnaire/xml - Generate XML for questionnaire
router.post('/xml', async (req, res) => {
  try {
    const questionnaire = req.body;
    const xml = generateXml(questionnaire);
    
    res.setHeader('Content-Type', 'text/xml');
    res.send(xml);
  } catch (error) {
    console.error('Error generating XML:', error);
    res.status(500).json({ error: 'Failed to generate XML' });
  }
});

// POST /api/questionnaire/forsta-xml - Generate XML for Forsta survey programming
// This endpoint expects a questionnaire that has already been filtered to exclude
// quotas and hidden variables (questions with 'hid_' prefix)
router.post('/forsta-xml', async (req, res) => {
  try {
    const questionnaire = req.body;
    // Ensure quotas are not included and questions are already filtered
    const forstaQuestionnaire = {
      ...questionnaire,
      quotas: undefined
    };
    const xml = generateXml(forstaQuestionnaire);

    res.setHeader('Content-Type', 'text/plain');
    res.send(xml);
  } catch (error) {
    console.error('Error generating Forsta XML:', error);
    res.status(500).json({ error: 'Failed to generate Forsta XML' });
  }
});

// POST /api/questionnaire/:questionnaireId/reparse - Re-parse questionnaire with updated classification
router.post('/:questionnaireId/reparse', async (req, res) => {
  try {
    const { questionnaireId } = req.params;
    
    // Load questionnaires
    const questionnairesPath = path.join(dataRoot, 'questionnaires.json');
    let questionnaires = {};
    
    try {
      const data = await fs.readFile(questionnairesPath, 'utf8');
      questionnaires = JSON.parse(data);
    } catch (error) {
      return res.status(404).json({ error: 'Questionnaires file not found' });
    }
    
    // Find the questionnaire
    let questionnaire = null;
    let projectId = null;
    
    for (const pid in questionnaires) {
      if (Array.isArray(questionnaires[pid])) {
        const found = questionnaires[pid].find(q => q.id === questionnaireId);
        if (found) {
          questionnaire = found;
          projectId = pid;
          break;
        }
      }
    }
    
    if (!questionnaire) {
      return res.status(404).json({ error: 'Questionnaire not found' });
    }
    
    // Get extracted text (preferred) or extract from file (backwards compatibility)
    let text;
    if (questionnaire.extractedText) {
      text = questionnaire.extractedText;
    } else if (questionnaire.filePath) {
      // Backwards compatibility: extract from file if extractedText not available
      try {
        await fs.access(questionnaire.filePath);
        const result = await mammoth.extractRawText({ path: questionnaire.filePath });
        text = result.value;
      } catch (error) {
        return res.status(404).json({ error: 'Original questionnaire file not found. Please re-upload the file.' });
      }
    } else {
      return res.status(404).json({ error: 'Questionnaire text not found. Please re-upload the file.' });
    }
    
    // Re-parse the questionnaire with updated prompt
    const parseResult = await parseQuestionnaire(null, projectId, text);
    const questions = parseResult.questions || [];
    const quotas = parseResult.quotas || [];
    
    // Update the questionnaire in the array
    for (const pid in questionnaires) {
      if (Array.isArray(questionnaires[pid])) {
        const index = questionnaires[pid].findIndex(q => q.id === questionnaireId);
        if (index !== -1) {
          questionnaires[pid][index] = {
            ...questionnaires[pid][index],
            questions: questions,
            quotas: quotas,
            updatedAt: new Date().toISOString(),
            reparsedAt: new Date().toISOString()
          };
          questionnaire = questionnaires[pid][index];
          break;
        }
      }
    }
    
    // Save updated questionnaire
    await fs.writeFile(questionnairesPath, JSON.stringify(questionnaires, null, 2));
    
    console.log(`✅ Re-parsed questionnaire ${questionnaireId} with updated classification`);
    
    res.json({ 
      message: 'Questionnaire re-parsed successfully',
      questionnaire: questionnaire
    });
  } catch (error) {
    console.error('Error re-parsing questionnaire:', error);
    res.status(500).json({ error: 'Failed to re-parse questionnaire', details: error.message });
  }
});

// PUT /api/questionnaire/:questionnaireId - Update questionnaire
router.put('/:questionnaireId', async (req, res) => {
  try {
    const { questionnaireId } = req.params;
    const updates = req.body;
    
    const questionnairesPath = path.join(dataRoot, 'questionnaires.json');
    let questionnaires = {};
    
    try {
      const data = await fs.readFile(questionnairesPath, 'utf8');
      questionnaires = JSON.parse(data);
    } catch (error) {
      return res.status(404).json({ error: 'Questionnaires not found' });
    }
    
    // Find and update the questionnaire
    let found = false;
    for (const projectId in questionnaires) {
      const index = questionnaires[projectId].findIndex(q => q.id === questionnaireId);
      if (index !== -1) {
        questionnaires[projectId][index] = { ...questionnaires[projectId][index], ...updates };
        found = true;
        break;
      }
    }
    
    if (!found) {
      return res.status(404).json({ error: 'Questionnaire not found' });
    }
    
    await fs.writeFile(questionnairesPath, JSON.stringify(questionnaires, null, 2));
    
    res.json({ success: true });
  } catch (error) {
    console.error('Error updating questionnaire:', error);
    res.status(500).json({ error: 'Failed to update questionnaire' });
  }
});

// DELETE /api/questionnaire/:questionnaireId - Delete questionnaire
router.delete('/:questionnaireId', async (req, res) => {
  try {
    const { questionnaireId } = req.params;
    
    const questionnairesPath = path.join(dataRoot, 'questionnaires.json');
    let questionnaires = {};
    
    try {
      const data = await fs.readFile(questionnairesPath, 'utf8');
      questionnaires = JSON.parse(data);
    } catch (error) {
      return res.status(404).json({ error: 'Questionnaires not found' });
    }
    
    // Find the questionnaire before deleting it
    let questionnaire = null;
    let found = false;
    for (const projectId in questionnaires) {
      const index = questionnaires[projectId].findIndex(q => q.id === questionnaireId);
      if (index !== -1) {
        questionnaire = questionnaires[projectId][index];
        questionnaires[projectId].splice(index, 1);
        found = true;
        break;
      }
    }
    
    if (!found) {
      return res.status(404).json({ error: 'Questionnaire not found' });
    }
    
    // Delete the .docx file if it still exists (backwards compatibility)
    if (questionnaire.filePath) {
      try {
        await fs.unlink(questionnaire.filePath);
        console.log(`🗑️ Deleted questionnaire file: ${questionnaire.filePath}`);
      } catch (error) {
        // File might not exist, that's fine
        console.log(`ℹ️ File ${questionnaire.filePath} not found or already deleted`);
      }
    }
    
    // Delete questionnaire data directory if it exists
    const qnrDataDir = path.join(dataRoot, 'questionnaire-data', questionnaireId);
    try {
      const dirExists = await fs.access(qnrDataDir).then(() => true).catch(() => false);
      if (dirExists) {
        // Delete all files in the directory
        const entries = await fs.readdir(qnrDataDir, { withFileTypes: true });
        for (const entry of entries) {
          if (entry.isFile()) {
            const filePath = path.join(qnrDataDir, entry.name);
            try {
              await fs.unlink(filePath);
              console.log(`🗑️ Deleted data file: ${entry.name}`);
            } catch (e) {
              console.warn(`Could not delete file ${entry.name}:`, e);
            }
          }
        }
        // Try to remove the directory
        try {
          await fs.rmdir(qnrDataDir);
          console.log(`🗑️ Removed data directory: ${qnrDataDir}`);
        } catch (e) {
          // Directory not empty or other error - that's fine
        }
      }
    } catch (error) {
      // Directory doesn't exist, that's fine
      console.log(`ℹ️ Data directory ${qnrDataDir} not found or already deleted`);
    }
    
    await fs.writeFile(questionnairesPath, JSON.stringify(questionnaires, null, 2));
    
    res.json({ success: true });
  } catch (error) {
    console.error('Error deleting questionnaire:', error);
    res.status(500).json({ error: 'Failed to delete questionnaire' });
  }
});

// POST /api/questionnaire/improve-wording - AI helper to improve question wording
router.post('/improve-wording', async (req, res) => {
  try {
    const { text, projectId } = req.body;
    
    if (!text) {
      return res.status(400).json({ error: 'Question text is required' });
    }
    
    const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    
    const systemPrompt = `You are an expert survey researcher and questionnaire designer specializing in Forsta/Decipher platforms. Your task is to improve question wording to make it clearer, more professional, and more effective for data collection using comprehensive question type knowledge.

COMPREHENSIVE QUESTION TYPE LIBRARY:
Basic Question Types:
- Single Select: Respondents pick one option (can be one-dimensional or two-dimensional)
- Multi-Select: Respondents pick one or more options (supports exclusive options)
- Dropdown Menu: Drop-down list with up to three dimensions
- Button Single Select: Mobile-friendly button-based single selection
- Single Select Grid: Matrix-style grid with one column selection per row. Has statementOptions (rows) and responseOptions (column headers/scale)
- Button Single Select Grid: Touch-friendly grid with button selections
- Numeric Grid: Grid where respondents enter numeric values. MUST have BOTH statementOptions (rows) AND responseOptions (columns) representing categories like age groups, time periods, etc. Use when asking for numbers in a grid format with both rows and columns.
- Numeric List: List where respondents enter numeric values. Has ONLY response options (use "options" field), NO statementOptions. Each option gets a single numeric input. Use when asking for numbers for a list of items (no grid structure with rows and columns).
- Multi-Select Grid: Grid allowing multiple selections per row/cell. Has statementOptions (rows) and responseOptions (columns). Typically has "Values: 0-1"
- Button Multi-Select/Grid: Button-based multi-select including grid variants
- Open End: Freeform alphanumeric text input
- Numeric: Numeric values only (single numeric input, not a grid)

Dynamic/Advanced Types:
- Autosuggest: Type-ahead suggestions from predefined list
- Button Rating: Numeric rating scale as buttons (1-5, 1-10)
- Card Rating: Visual card-based rating
- Card Sort: Drag-and-drop cards into categories
- Date Picker: Calendar widget for date selection
- DCM Conjoint: Choice-based conjoint with profile selection
- Image Map: Click on specific image areas (hotspots)
- Media Evaluator: Rate/view media with timed feedback
- Media Testimonial: Record/upload video/audio responses
- Open Assist: AI-assisted open-ended questions
- Rating Scale (Dynamic): Visually enhanced animated rating scales
- Shopping Cart: E-commerce cart simulation
- Slider/Slider Rating: Draggable slider for numeric/percentage values
- Star Rating: Visual 1-5 or 1-10 star rating
- Text Highlighter: Highlight parts of passages
- This or That: Two-option comparison
- Video/Audio Player: Embedded media with follow-up
- Heat-Click: Track clicks/focus points on images
- Virtual Magazine/Page Timer: Timed/paginated content tracking
- Image Upload: Upload images as responses

Guidelines:
- Make questions clear, concise, and unambiguous
- Use professional, neutral language appropriate for the question type
- Ensure questions are unbiased and don't lead respondents
- Use proper grammar and punctuation
- Make questions specific and actionable
- Avoid jargon or technical terms when possible
- Ensure questions are easy to understand for all respondents
- Consider mobile-friendly alternatives (Button variants) when appropriate
- Optimize wording for the specific Forsta question type being used
- Consider advanced question types when they would be more effective

Return only the improved question text, nothing else.`;

    const userPrompt = `Please improve the wording of this survey question:

"${text}"

Make it clearer, more professional, and more effective for data collection.`;

    const response = await client.chat.completions.create({
      model: 'gpt-4o',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt }
      ],
      temperature: 0.3
    });

    // Log cost for wording improvement
    const inputTokens = response.usage?.prompt_tokens || 0;
    const outputTokens = response.usage?.completion_tokens || 0;
    
    if (inputTokens > 0 && outputTokens > 0 && projectId) {
      await logCost(
        projectId,
        COST_CATEGORIES.QUESTIONNAIRE_PARSING,
        'gpt-4o',
        inputTokens,
        outputTokens,
        'Question wording improvement'
      );
    }

    const improvedText = response.choices[0].message.content.trim();
    
    res.json({ improvedText });
  } catch (error) {
    console.error('Error improving wording:', error);
    res.status(500).json({ error: 'Failed to improve wording' });
  }
});

// POST /api/questionnaire/validate - Validate parsed questionnaire for Forsta compatibility
router.post('/validate', async (req, res) => {
  try {
    const { questionnaire, projectId } = req.body;
    
    if (!questionnaire || !questionnaire.questions) {
      return res.status(400).json({ error: 'Questionnaire with questions is required' });
    }
    
    const validationResults = {
      isValid: true,
      errors: [],
      warnings: [],
      suggestions: []
    };
    
    // Validate each question
    questionnaire.questions.forEach((question, index) => {
      // Check required fields
      if (!question.id) {
        validationResults.errors.push(`Question ${index + 1}: Missing ID`);
        validationResults.isValid = false;
      }
      
      if (!question.text || question.text.trim() === '') {
        validationResults.errors.push(`Question ${index + 1}: Missing or empty text`);
        validationResults.isValid = false;
      }
      
      if (!question.type) {
        validationResults.errors.push(`Question ${index + 1}: Missing question type`);
        validationResults.isValid = false;
      }
      
      // Validate show logic syntax
      if (question.showLogic) {
        const logicPattern = /^[A-Za-z0-9]+[=<>!]+[0-9,]+$/;
        if (!logicPattern.test(question.showLogic)) {
          validationResults.warnings.push(`Question ${index + 1}: Show logic "${question.showLogic}" may have invalid syntax`);
        }
      }
      
      // Validate grid structure
      if (question.grid) {
        if (!question.grid.rows || question.grid.rows.length === 0) {
          validationResults.warnings.push(`Question ${index + 1}: Grid has no rows defined`);
        }
        if (!question.grid.columns || question.grid.columns.length === 0) {
          validationResults.warnings.push(`Question ${index + 1}: Grid has no columns defined`);
        }
      }
      
      // Validate hidden variables
      if (question.hiddenVariable) {
        if (!question.hiddenVariable.name) {
          validationResults.errors.push(`Question ${index + 1}: Hidden variable missing name`);
          validationResults.isValid = false;
        }
        if (!question.hiddenVariable.options || question.hiddenVariable.options.length === 0) {
          validationResults.warnings.push(`Question ${index + 1}: Hidden variable has no options`);
        }
      }
      
      // Check for potential issues
      if (question.needsReview) {
        validationResults.warnings.push(`Question ${index + 1}: Marked as needing review`);
      }
      
      // Suggest improvements
      if (question.type === 'Single Select' && question.options && question.options.length > 10) {
        validationResults.suggestions.push(`Question ${index + 1}: Consider using Dropdown Menu for ${question.options.length} options`);
      }
      
      if ((question.type === 'Text/Open-Ended' || question.type === 'Open End' || question.type === 'open-end') && !question.validation) {
        validationResults.suggestions.push(`Question ${index + 1}: Consider adding character limits for open-ended questions`);
      }
    });
    
    // Check for duplicate question IDs
    const questionIds = questionnaire.questions.map(q => q.id);
    const duplicateIds = questionIds.filter((id, index) => questionIds.indexOf(id) !== index);
    if (duplicateIds.length > 0) {
      validationResults.errors.push(`Duplicate question IDs found: ${duplicateIds.join(', ')}`);
      validationResults.isValid = false;
    }
    
    // Check for missing question references in logic
    const allQuestionIds = new Set(questionnaire.questions.map(q => q.id));
    questionnaire.questions.forEach((question, index) => {
      if (question.showLogic) {
        const referencedIds = question.showLogic.match(/[A-Za-z]+[0-9]+/g) || [];
        referencedIds.forEach(refId => {
          if (!allQuestionIds.has(refId)) {
            validationResults.warnings.push(`Question ${index + 1}: Show logic references non-existent question "${refId}"`);
          }
        });
      }
    });
    
    res.json(validationResults);
  } catch (error) {
    console.error('Error validating questionnaire:', error);
    res.status(500).json({ error: 'Failed to validate questionnaire' });
  }
});

// POST /api/questionnaire/suggest-options - AI helper to suggest response options
router.post('/suggest-options', async (req, res) => {
  try {
    const { text, type, projectId } = req.body;
    
    if (!text) {
      return res.status(400).json({ error: 'Question text is required' });
    }
    
    const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    
    const systemPrompt = `You are an expert survey researcher and questionnaire designer specializing in Forsta/Decipher platforms. Your task is to suggest appropriate response options for survey questions using comprehensive question type knowledge.

COMPREHENSIVE QUESTION TYPE LIBRARY:
Basic Question Types:
- Single Select: Respondents pick one option (can be one-dimensional or two-dimensional)
- Multi-Select: Respondents pick one or more options (supports exclusive options)
- Dropdown Menu: Drop-down list with up to three dimensions
- Button Single Select: Mobile-friendly button-based single selection
- Single Select Grid: Matrix-style grid with one column selection per row. Has statementOptions (rows) and responseOptions (column headers/scale)
- Button Single Select Grid: Touch-friendly grid with button selections
- Numeric Grid: Grid where respondents enter numeric values. MUST have BOTH statementOptions (rows) AND responseOptions (columns) representing categories like age groups, time periods, etc. Use when asking for numbers in a grid format with both rows and columns.
- Numeric List: List where respondents enter numeric values. Has ONLY response options (use "options" field), NO statementOptions. Each option gets a single numeric input. Use when asking for numbers for a list of items (no grid structure with rows and columns).
- Multi-Select Grid: Grid allowing multiple selections per row/cell. Has statementOptions (rows) and responseOptions (columns). Typically has "Values: 0-1"
- Button Multi-Select/Grid: Button-based multi-select including grid variants
- Open End: Freeform alphanumeric text input
- Numeric: Numeric values only (single numeric input, not a grid)

Dynamic/Advanced Types:
- Autosuggest: Type-ahead suggestions from predefined list
- Button Rating: Numeric rating scale as buttons (1-5, 1-10)
- Card Rating: Visual card-based rating
- Card Sort: Drag-and-drop cards into categories
- Date Picker: Calendar widget for date selection
- DCM Conjoint: Choice-based conjoint with profile selection
- Image Map: Click on specific image areas (hotspots)
- Media Evaluator: Rate/view media with timed feedback
- Media Testimonial: Record/upload video/audio responses
- Open Assist: AI-assisted open-ended questions
- Rating Scale (Dynamic): Visually enhanced animated rating scales
- Shopping Cart: E-commerce cart simulation
- Slider/Slider Rating: Draggable slider for numeric/percentage values
- Star Rating: Visual 1-5 or 1-10 star rating
- Text Highlighter: Highlight parts of passages
- This or That: Two-option comparison
- Video/Audio Player: Embedded media with follow-up
- Heat-Click: Track clicks/focus points on images
- Virtual Magazine/Page Timer: Timed/paginated content tracking
- Image Upload: Upload images as responses

Guidelines:
- Suggest 3-7 response options that are comprehensive and mutually exclusive
- Use clear, professional language appropriate for the question type
- Ensure options cover the full range of possible responses
- Include "Other" or "Not applicable" when appropriate
- For rating/scale questions, suggest appropriate scale ranges and consider dynamic variants
- For mobile-friendly questions, consider Button variants
- Make options specific to the question content and context
- Avoid leading or biased options
- Consider advanced question types when appropriate (Card Rating, Star Rating, etc.)

Return your suggestions as a JSON object with this structure:
{
  "suggestedOptions": ["option1", "option2", "option3", ...],
  "suggestedQuestionType": "most appropriate Forsta question type",
  "alternativeTypes": ["alternative question types that might work better"]
}`;

    const userPrompt = `Please suggest appropriate response options for this survey question:

Question: "${text}"
Question Type: ${type}

Provide 3-7 relevant response options that would be appropriate for this question.`;

    const response = await client.chat.completions.create({
      model: 'gpt-4o',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt }
      ],
      temperature: 0.3,
      response_format: { type: 'json_object' }
    });

    // Log cost for option suggestions
    const inputTokens = response.usage?.prompt_tokens || 0;
    const outputTokens = response.usage?.completion_tokens || 0;
    
    if (inputTokens > 0 && outputTokens > 0 && projectId) {
      await logCost(
        projectId,
        COST_CATEGORIES.QUESTIONNAIRE_PARSING,
        'gpt-4o',
        inputTokens,
        outputTokens,
        'Response options suggestion'
      );
    }

    const result = JSON.parse(response.choices[0].message.content);
    
    res.json({ suggestedOptions: result.suggestedOptions });
  } catch (error) {
    console.error('Error suggesting options:', error);
    res.status(500).json({ error: 'Failed to suggest options' });
  }
});

// POST /api/questionnaire/map-columns - AI mapping of variable names to data file column headers
router.post('/map-columns', async (req, res) => {
  try {
    const { variableNames, variables, dataHeaders, dataMapHeaders, questionnaireId, existingMapping, mapping } = req.body;
    
    // If a complete mapping is provided (from frontend), just save it and return
    if (mapping && typeof mapping === 'object') {
      if (questionnaireId) {
        try {
          const qnrDataDir = path.join(dataRoot, 'questionnaire-data', questionnaireId);
          await fs.mkdir(qnrDataDir, { recursive: true });
          const metadataPath = path.join(qnrDataDir, 'metadata.json');
          
          let metadata = {};
          try {
            const existingMetadata = await fs.readFile(metadataPath, 'utf-8');
            metadata = JSON.parse(existingMetadata);
          } catch (e) {
            // File doesn't exist yet, that's fine
          }
          
          metadata.columnMapping = mapping;
          metadata.mappingCreatedAt = new Date().toISOString();
          await fs.writeFile(metadataPath, JSON.stringify(metadata, null, 2));
        } catch (saveError) {
          console.warn('Could not save column mapping to metadata:', saveError);
          // Continue anyway - mapping is still returned
        }
      }
      
      return res.json({ mapping });
    }
    
    // Create a map of variable name to type for easy lookup
    const variableTypeMap = {};
    if (variables && Array.isArray(variables)) {
      variables.forEach(v => {
        variableTypeMap[v.name] = v.type || 'Unknown';
      });
    }
    
    if (!variableNames || !Array.isArray(variableNames) || variableNames.length === 0) {
      return res.status(400).json({ error: 'Variable names are required' });
    }
    
    if (!dataHeaders || !Array.isArray(dataHeaders) || dataHeaders.length === 0) {
      return res.status(400).json({ error: 'Data headers are required' });
    }
    
    // Filter out already matched variables if existingMapping is provided
    const variablesToProcess = existingMapping 
      ? variableNames.filter(v => !existingMapping[v] || existingMapping[v] === '')
      : variableNames;
    
    if (variablesToProcess.length === 0) {
      // All variables are already matched, return existing mapping
      return res.json({ mapping: existingMapping || {} });
    }
    
    // Filter variables array to only include unmatched ones
    const variablesToMap = variables && Array.isArray(variables)
      ? variables.filter(v => variablesToProcess.includes(v.name))
      : variablesToProcess.map(name => ({ name, type: variableTypeMap[name] || 'Unknown' }));
    
    const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    
    const systemPrompt = `You are an expert at matching survey variable names with data file column headers. Your task is to match variable names with the corresponding column headers from a data file.

VARIABLE NAMING CONVENTIONS:
1. Simple variables: S1, S2, Q1, A1, etc. (question number only)
2. Numeric grid cell variables: S11r1c1, S11r2c1, S14r1c3 (format: {question}r{row}c{column})
   - Example: S11r1c1 = question S11, row 1, column 1
   - Also may appear as: S11_r1_c1, S11r1_c1, S11_r1c1, S11c1r1 (column-first format)
3. Numeric grid column variables: S11_c1, S11_c2 (format: {question}_{column})
4. Grid row variables: C1_r1, C1_r2 (format: {question}_r{row})
5. Multi-select response variables: B8r1, B8r2, D1Ar1 (format: {question}r{option})
   - Example: B8r1 = question B8, response option 1
6. Open End variables: Freeform text responses - these should ALWAYS be mapped if a matching column exists
   - Open ends may have column headers like "Q1", "QS1 - Question text", or just the question number
   - These contain full text responses and should be mapped to show frequency tables
7. Summary table variables: S11_c1_Mean Summary (these are COMPUTED - skip them, do not map)

COLUMN HEADER FORMATS IN DATA FILES:
- Exact match: "S1" matches variable "S1"
- With Q prefix: "QS1" or "QA7" matches "S1" or "A7"
- With question text: "QS1 - Which of the following..." matches "S1" or "QS1"
- With underscores/dashes: "S1_r1", "S1-r1", "S1r1" all match "S1_r1"
- Numeric grid cells: "S11r1c1", "S11_r1_c1", "S11c1r1" all match "S11r1c1"
- Multi-select: "B8r1", "B8_r1", "B8-1" all match "B8r1"

CRITICAL MATCHING RULES (BE AGGRESSIVE - MATCH WHENEVER POSSIBLE):
1. For simple variables (S1, A7, etc.):
   - Match to columns starting with the variable name OR with "Q" + variable name
   - Example: "A7" matches "QA7", "QA7 - Question text", "A7", "A7 - Question text"
   - Extract the FULL column header text, not just the prefix

2. For numeric grid cell variables (S11r1c1):
   - Match to columns with the same pattern: "S11r1c1", "S11_r1_c1", "S11c1r1", "S11_c1_r1"
   - Handle both row-first (r1c1) and column-first (c1r1) formats
   - Match flexibly: underscores, dashes, or no separators

3. For numeric grid column variables (S11_c1):
   - Match to columns like "QS11 - Column 1 text" or "S11_c1" or "S11c1"
   - These represent aggregated columns for a specific response option

4. For multi-select response variables (B8r1, B8r2):
   - Match to columns like "B8r1", "B8_r1", "B8-1", "QB8r1", "QB8 - Option 1"
   - These are binary (0/1) variables for each response option

5. SKIP these variables (do not map):
   - Variables ending with "_Mean Summary" or "Summary" (computed variables)
   - Variables that are clearly derived/computed

6. MATCHING STRATEGY:
   - Be FLEXIBLE with separators (underscores, dashes, no separator)
   - Be FLEXIBLE with case (case-insensitive matching)
   - Handle Q prefix variations (QS1 = S1, QA7 = A7)
   - For partial matches, prefer the most specific match
   - If multiple columns match, choose the one that's most specific to the variable

7. ALWAYS return the COMPLETE column header text exactly as it appears in the data headers list

Your goal is to maximize matches - be aggressive and match whenever there's a reasonable connection between the variable name and column header.`;

    // Filter out already used headers if existingMapping is provided
    const usedHeaders = existingMapping ? new Set(Object.values(existingMapping).filter(h => h && h !== '')) : new Set();
    const availableHeaders = dataHeaders.filter(h => !usedHeaders.has(h));
    
    // Log what we're sending to AI for debugging
    const alreadyMatchedCount = existingMapping ? Object.keys(existingMapping).filter(k => existingMapping[k] && existingMapping[k] !== '').length : 0;
    console.log(`📤 Sending ${variablesToProcess.length} unmatched variables to AI for mapping (${alreadyMatchedCount} already matched automatically)`);
    console.log(`📋 Available headers: ${availableHeaders.length} (${usedHeaders.size} already used)`);
    
    // Get sample variable names and headers for examples
    const sampleVariables = variablesToProcess.slice(0, 20);
    const sampleHeaders = availableHeaders.slice(0, 30);
    
    // Try to find some example matches to show the AI
    const exampleMatches = [];
    sampleVariables.forEach(varName => {
      // Try to find a matching header
      const varLower = varName.toLowerCase();
      const matchingHeader = availableHeaders.find(h => {
        const hLower = h.toLowerCase();
        // Check various patterns
        return hLower === varLower ||
               hLower.startsWith(varLower) ||
               hLower.startsWith('q' + varLower) ||
               hLower.includes(varLower) ||
               (varLower.match(/^[a-z]\d+$/) && hLower.startsWith('q' + varLower));
      });
      if (matchingHeader && exampleMatches.length < 5) {
        exampleMatches.push({ variable: varName, header: matchingHeader });
      }
    });

    // Format variables with their types for the prompt
    const variablesWithTypes = variablesToProcess.map((name, i) => {
      const varType = variableTypeMap[name] || 'Unknown';
      return `${i + 1}. ${name} (Type: ${varType})`;
    }).join('\n');
    
    // Count open ends
    const openEndCount = Object.values(variableTypeMap).filter(t => 
      typeof t === 'string' && t.toLowerCase().includes('open end')
    ).length;

    const userPrompt = `Please match the following variable names with the column headers from the data file.

${existingMapping && alreadyMatchedCount > 0 ? `NOTE: ${alreadyMatchedCount} variables have already been matched automatically. You only need to match the remaining ${variablesToProcess.length} variables listed below.

` : ''}${exampleMatches.length > 0 ? `EXAMPLE MATCHES (use these as a guide for matching patterns):
${exampleMatches.map((ex, i) => `${i + 1}. Variable "${ex.variable}" → Column "${ex.header}"`).join('\n')}

` : ''}Variable Names with Types (${variablesToProcess.length} total${openEndCount > 0 ? `, ${openEndCount} Open End variables` : ''}):
${variablesWithTypes}

Available Data Headers (from first sheet, ${availableHeaders.length} total${usedHeaders.size > 0 ? `, ${usedHeaders.size} already matched` : ''}):
${availableHeaders.map((h, i) => `${i + 1}. ${h}`).join('\n')}

${dataMapHeaders && dataMapHeaders.length > 0 ? `Data Map Headers (from data map sheet, ${dataMapHeaders.length} total):
${dataMapHeaders.map((h, i) => `${i + 1}. ${h}`).join('\n')}` : ''}

IMPORTANT MATCHING INSTRUCTIONS (BE AGGRESSIVE - MATCH WHENEVER POSSIBLE):

1. SIMPLE VARIABLES (S1, A7, Q1, etc.):
   - Match to columns starting with the variable name OR "Q" + variable name
   - Examples:
     * Variable "A7" → Match "QA7", "QA7 - Question text", "A7", "A7 - Question text"
     * Variable "S1" → Match "QS1", "QS1 - Question text", "S1", "S1 - Question text"
   - Always return the COMPLETE column header text

2. NUMERIC GRID CELL VARIABLES (S11r1c1, S14r2c3):
   - Match flexibly: "S11r1c1", "S11_r1_c1", "S11r1_c1", "S11_r1c1"
   - Also handle column-first format: "S11c1r1", "S11_c1_r1", "S11c1_r1"
   - Match to the exact column that contains data for that specific cell

3. NUMERIC GRID COLUMN VARIABLES (S11_c1, S11_c2):
   - Match to columns like "QS11 - Column text", "S11_c1", "S11c1", "S11 - Column 1"
   - These represent columns for a specific response option/column

4. MULTI-SELECT RESPONSE VARIABLES (B8r1, B8r2, D1Ar1):
   - Match to columns like "B8r1", "B8_r1", "B8-1", "QB8r1", "QB8 - Option 1 text"
   - These are binary variables (0/1) for each response option

5. OPEN END VARIABLES (Type: "Open End"):
   - CRITICAL: Open End variables MUST be mapped if a matching column exists
   - These contain freeform text responses and need to show frequency tables
   - Match to columns like "Q1", "QS1", "QS1 - Question text", or just the question number
   - Open ends may have simple column headers without response codes
   - Be especially aggressive in matching Open End variables - they are important for analysis
   - Example: Variable "Q1" (Type: Open End) → Match "Q1", "QS1", "QS1 - Please describe..."

6. SKIP (do not map):
   - Variables ending with "_Mean Summary" or containing "Summary" (computed variables)
   - Return empty string "" for these

7. MATCHING FLEXIBILITY:
   - Ignore case differences (A7 = a7 = A7)
   - Ignore separator differences (S11r1c1 = S11_r1_c1 = S11-r1-c1)
   - Handle Q prefix (QS1 = S1, QA7 = A7)
   - For partial matches, choose the most specific match
   - If you find ANY reasonable match, use it - be aggressive!

7. If NO clear match exists after trying all patterns, use an empty string ""

Return a JSON object with this structure:
{
  "mapping": {
    "variableName1": "matchedColumnHeader1",
    "variableName2": "matchedColumnHeader2",
    ...
  }
}

For each variable:
- Match it to the most likely column header from either the data headers or data map headers
- If a variable matches multiple columns (e.g., grid variables), match to the base column name (e.g., "C1_r1" might match "C1_r1" or "C1r1")
- If no clear match exists, use an empty string ""
- Be flexible with naming conventions (underscores, dashes, case differences)
- Prioritize exact matches, then partial matches

CRITICAL: JSON FORMATTING REQUIREMENTS:
- ALL string values in the JSON MUST be properly escaped
- If a column header contains double quotes ("), escape them as \\"
- If a column header contains backslashes (\\), escape them as \\\\
- If a column header contains newlines, escape them as \\n
- Use ONLY double quotes for JSON strings
- Ensure all strings are properly closed
- The response MUST be valid, parseable JSON

Return ONLY valid JSON. Do not include any explanatory text, markdown code blocks, or formatting outside the JSON object.`;

    const response = await client.chat.completions.create({
      model: 'gpt-4o',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt }
      ],
      temperature: 0.1,
      response_format: { type: 'json_object' },
      max_tokens: 8192 // Increased to handle larger mappings
    });

    // Check for truncation
    const finishReason = response.choices[0].finish_reason;
    if (finishReason === 'length') {
      console.error('⚠️ Column mapping response was truncated due to token limit');
      return res.status(500).json({ error: 'Mapping response was too large. Please try with fewer variables or increase the token limit.' });
    }

    // Log cost
    const inputTokens = response.usage?.prompt_tokens || 0;
    const outputTokens = response.usage?.completion_tokens || 0;
    
    // Get projectId from user if available, or from questionnaire context
    const projectId = req.user?.projectId || req.body.projectId;
    if (inputTokens > 0 && outputTokens > 0 && projectId) {
      await logCost(
        projectId,
        COST_CATEGORIES.QUESTIONNAIRE_PARSING,
        'gpt-4o',
        inputTokens,
        outputTokens,
        'Column mapping'
      );
    }

    // Get and validate response content
    const content = response.choices[0].message.content;
    if (!content || content.trim().length === 0) {
      console.error('⚠️ Empty response from AI for column mapping');
      return res.status(500).json({ error: 'Empty response from AI' });
    }

    // Try to parse JSON with better error handling
    let result;
    try {
      result = JSON.parse(content);
    } catch (parseError) {
      console.error('❌ JSON parse error in column mapping response:');
      console.error('Error:', parseError.message);
      console.error('Response length:', content.length);
      console.error('Response preview (first 500 chars):', content.substring(0, 500));
      console.error('Response preview (around error position):', content.substring(Math.max(0, 12268 - 200), Math.min(content.length, 12268 + 200)));
      
      // Try to extract JSON from the response if it's wrapped in markdown or has extra text
      try {
        // Try to find JSON object in the response
        const jsonMatch = content.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          result = JSON.parse(jsonMatch[0]);
          console.log('✅ Successfully extracted JSON from response');
        } else {
          throw new Error('No JSON object found in response');
        }
      } catch (recoveryError) {
        console.error('❌ Failed to recover JSON from response:', recoveryError.message);
        return res.status(500).json({ 
          error: 'Failed to parse AI response as JSON. The response may contain invalid characters or be truncated.',
          details: parseError.message
        });
      }
    }

    const aiMapping = result.mapping || {};
    
    // Log mapping results for debugging
    const aiMappedCount = Object.keys(aiMapping).filter(k => aiMapping[k] && aiMapping[k] !== '').length;
    const aiUnmappedCount = variablesToProcess.length - aiMappedCount;
    console.log(`📥 Received mapping from AI: ${aiMappedCount} mapped, ${aiUnmappedCount} unmapped out of ${variablesToProcess.length} unmatched variables`);
    
    // Merge with existing mapping for saving (but return only AI mapping to frontend)
    const finalMapping = existingMapping 
      ? { ...existingMapping, ...aiMapping }
      : aiMapping;
    
    // Save merged mapping to metadata if questionnaireId is provided
    if (questionnaireId) {
      try {
        const qnrDataDir = path.join(dataRoot, 'questionnaire-data', questionnaireId);
        await fs.mkdir(qnrDataDir, { recursive: true });
        const metadataPath = path.join(qnrDataDir, 'metadata.json');
        
        let metadata = {};
        try {
          const existingMetadata = await fs.readFile(metadataPath, 'utf-8');
          metadata = JSON.parse(existingMetadata);
        } catch (e) {
          // File doesn't exist yet, that's fine
        }
        
        metadata.columnMapping = finalMapping;
        metadata.mappingCreatedAt = new Date().toISOString();
        await fs.writeFile(metadataPath, JSON.stringify(metadata, null, 2));
      } catch (saveError) {
        console.warn('Could not save column mapping to metadata:', saveError);
        // Continue anyway - mapping is still returned
      }
    }
    
    // Return only AI mapping (frontend will merge with automatic mapping)
    res.json({ mapping: aiMapping });
  } catch (error) {
    console.error('Error mapping columns:', error);
    res.status(500).json({ error: 'Failed to map columns' });
  }
});

// POST /api/questionnaire/upload-data-file - Upload and save data file for a questionnaire
router.post('/upload-data-file', uploadDataFile.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }
    
    const { questionnaireId } = req.body;
    if (!questionnaireId) {
      // Clean up temp file
      try {
        await fs.unlink(req.file.path);
      } catch (e) {
        // Ignore cleanup errors
      }
      return res.status(400).json({ error: 'Questionnaire ID is required' });
    }
    
    // Create directory for this questionnaire's data files
    const qnrDataDir = path.join(dataRoot, 'questionnaire-data', questionnaireId);
    await fs.mkdir(qnrDataDir, { recursive: true });
    
    // Clean up old data files before uploading new one
    try {
      const existingEntries = await fs.readdir(qnrDataDir, { withFileTypes: true });
      for (const entry of existingEntries) {
        if (entry.isFile() && entry.name.startsWith('data_')) {
          const oldFilePath = path.join(qnrDataDir, entry.name);
          try {
            await fs.unlink(oldFilePath);
            console.log(`🗑️ Cleaned up old data file: ${entry.name}`);
          } catch (e) {
            console.warn(`Could not delete old file ${entry.name}:`, e);
          }
        }
      }
    } catch (e) {
      // Directory might be empty, that's fine
    }
    
    // Move file from temp location to questionnaire-specific directory
    const timestamp = Date.now();
    const ext = path.extname(req.file.originalname);
    const fileName = `data_${timestamp}${ext}`;
    const finalPath = path.join(qnrDataDir, fileName);
    
    await fs.rename(req.file.path, finalPath);
    
    // Verify file was saved correctly by checking its size
    const stats = await fs.stat(finalPath);
    console.log(`💾 Saved data file: ${fileName} (${(stats.size / 1024 / 1024).toFixed(2)} MB)`);
    
    // Save metadata about the file
    const metadataPath = path.join(qnrDataDir, 'metadata.json');
    let metadata = {};
    try {
      const existingMetadata = await fs.readFile(metadataPath, 'utf-8');
      metadata = JSON.parse(existingMetadata);
    } catch (e) {
      // File doesn't exist yet, that's fine
    }
    
    metadata.dataFileName = fileName;
    metadata.originalFileName = req.file.originalname;
    metadata.uploadedAt = new Date().toISOString();
    await fs.writeFile(metadataPath, JSON.stringify(metadata, null, 2));
    
    res.json({ fileName, originalFileName: req.file.originalname, message: 'File uploaded successfully' });
  } catch (error) {
    console.error('Error uploading data file:', error);
    // Clean up temp file on error
    if (req.file && req.file.path) {
      try {
        await fs.unlink(req.file.path);
      } catch (e) {
        // Ignore cleanup errors
      }
    }
    res.status(500).json({ error: 'Failed to upload data file: ' + (error.message || String(error)) });
  }
});

// GET /api/questionnaire/data-file/:questionnaireId - Get saved data file for a questionnaire
router.get('/data-file/:questionnaireId', async (req, res) => {
  try {
    const { questionnaireId } = req.params;
    const qnrDataDir = path.join(dataRoot, 'questionnaire-data', questionnaireId);
    const metadataPath = path.join(qnrDataDir, 'metadata.json');
    
    try {
      const metadata = JSON.parse(await fs.readFile(metadataPath, 'utf-8'));
      const filePath = path.join(qnrDataDir, metadata.dataFileName);
      
      // Check if file exists
      try {
        await fs.access(filePath);
      } catch (e) {
        return res.status(404).json({ error: 'Data file not found' });
      }
      
      res.sendFile(path.resolve(filePath));
    } catch (e) {
      res.status(404).json({ error: 'No data file found for this questionnaire' });
    }
  } catch (error) {
    console.error('Error fetching data file:', error);
    res.status(500).json({ error: 'Failed to fetch data file' });
  }
});

// GET /api/questionnaire/data-file-info/:questionnaireId - Get metadata about saved data file
router.get('/data-file-info/:questionnaireId', async (req, res) => {
  try {
    const { questionnaireId } = req.params;
    const qnrDataDir = path.join(dataRoot, 'questionnaire-data', questionnaireId);
    const metadataPath = path.join(qnrDataDir, 'metadata.json');
    
    try {
      const metadata = JSON.parse(await fs.readFile(metadataPath, 'utf-8'));
      
      // If column headers are missing but we have a data file, try to parse them
      let columnHeaders = metadata.columnHeaders || null;
      if (!columnHeaders && metadata.dataFileName) {
        try {
          const filePath = path.join(qnrDataDir, metadata.dataFileName);
          const ext = path.extname(metadata.dataFileName).toLowerCase();
          
          let workbook;
          if (ext === '.csv') {
            const fileContent = await fs.readFile(filePath, 'utf-8');
            workbook = XLSX.read(fileContent, { type: 'string' });
          } else {
            const fileBuffer = await fs.readFile(filePath);
            workbook = XLSX.read(fileBuffer, { type: 'buffer' });
          }
          
          const firstSheetName = workbook.SheetNames[0];
          const worksheet = workbook.Sheets[firstSheetName];
          const headerRange = XLSX.utils.decode_range(worksheet['!ref'] || 'A1');
          const headers = [];
          
          for (let col = headerRange.s.c; col <= headerRange.e.c; col++) {
            const cellAddress = XLSX.utils.encode_cell({ r: 0, c: col });
            const cell = worksheet[cellAddress];
            if (cell && cell.v !== undefined && cell.v !== null) {
              headers.push(String(cell.v).trim());
            }
          }
          
          const filteredHeaders = headers.filter(h => h.length > 0);
          if (filteredHeaders.length > 0) {
            columnHeaders = filteredHeaders;
            // Save the parsed headers to metadata for future use
            metadata.columnHeaders = columnHeaders;
            await fs.writeFile(metadataPath, JSON.stringify(metadata, null, 2));
            console.log(`📋 Parsed and saved ${columnHeaders.length} column headers from existing file`);
          }
        } catch (parseError) {
          console.warn('Could not parse column headers from existing file:', parseError);
        }
      }
      
      res.json({
        fileName: metadata.dataFileName,
        originalFileName: metadata.originalFileName,
        uploadedAt: metadata.uploadedAt,
        processedAt: metadata.processedAt,
        columnMapping: metadata.columnMapping || null,
        mappingCreatedAt: metadata.mappingCreatedAt || null,
        columnHeaders: columnHeaders
      });
    } catch (e) {
      res.status(404).json({ error: 'No data file found for this questionnaire' });
    }
  } catch (error) {
    console.error('Error fetching data file info:', error);
    res.status(500).json({ error: 'Failed to fetch data file info' });
  }
});

// DELETE /api/questionnaire/delete-data-file/:questionnaireId - Delete data file and metadata
router.delete('/delete-data-file/:questionnaireId', async (req, res) => {
  try {
    const { questionnaireId } = req.params;
    const qnrDataDir = path.join(dataRoot, 'questionnaire-data', questionnaireId);
    
    try {
      // Check if directory exists
      const dirExists = await fs.access(qnrDataDir).then(() => true).catch(() => false);
      
      if (!dirExists) {
        return res.json({ message: 'No data directory found to delete' });
      }
      
      // Read all files in the directory
      const entries = await fs.readdir(qnrDataDir, { withFileTypes: true });
      
      let deletedCount = 0;
      const errors = [];
      
      // Delete ALL files in the directory (including old timestamped files)
      for (const entry of entries) {
        if (entry.isFile()) {
          const filePath = path.join(qnrDataDir, entry.name);
          try {
            await fs.unlink(filePath);
            console.log(`🗑️ Deleted file: ${entry.name}`);
            deletedCount++;
          } catch (e) {
            console.warn(`Could not delete file ${entry.name}:`, e);
            errors.push(entry.name);
          }
        }
      }
      
      // Try to remove the directory itself (will fail if not empty, which is fine)
      try {
        await fs.rmdir(qnrDataDir);
        console.log(`🗑️ Removed directory: ${qnrDataDir}`);
      } catch (e) {
        // Directory not empty or other error - that's fine, we've deleted the files
      }
      
      if (errors.length > 0) {
        console.warn(`⚠️ Some files could not be deleted: ${errors.join(', ')}`);
      }
      
      res.json({ 
        message: `Deleted ${deletedCount} file(s) successfully`,
        deletedCount,
        errors: errors.length > 0 ? errors : undefined
      });
    } catch (e) {
      // Directory doesn't exist, that's fine - return success anyway
      res.json({ message: 'No data directory found to delete' });
    }
  } catch (error) {
    console.error('Error deleting data file:', error);
    res.status(500).json({ error: 'Failed to delete data file' });
  }
});

// GET /api/questionnaire/processed-data/:questionnaireId - Get processed data for a questionnaire
router.get('/processed-data/:questionnaireId', async (req, res) => {
  try {
    const { questionnaireId } = req.params;
    const qnrDataDir = path.join(dataRoot, 'questionnaire-data', questionnaireId);
    const metadataPath = path.join(qnrDataDir, 'metadata.json');
    
    console.log(`📥 Fetching processed data for questionnaire: ${questionnaireId}`);
    console.log(`📁 Data directory: ${qnrDataDir}`);
    
    try {
      const metadata = JSON.parse(await fs.readFile(metadataPath, 'utf-8'));
      console.log(`📋 Metadata loaded. processedAt: ${metadata.processedAt}, processedDataFile: ${metadata.processedDataFile}`);
      
      // Determine which file to use - check metadata first, then fallback to default
      let dataFileName = metadata.processedDataFile;
      
      // If metadata doesn't have processedDataFile but has processedAt, try default filename
      if (!dataFileName && metadata.processedAt) {
        console.log(`⚠️ Metadata missing processedDataFile but has processedAt. Using default filename.`);
        dataFileName = 'processed-data.json';
        // Update metadata to include the filename for future requests
        metadata.processedDataFile = dataFileName;
        await fs.writeFile(metadataPath, JSON.stringify(metadata, null, 2));
        console.log(`✅ Updated metadata with processedDataFile: ${dataFileName}`);
      }
      
      if (!dataFileName) {
        console.log(`❌ No processedDataFile in metadata and no processedAt timestamp`);
        return res.status(404).json({ error: 'No processed data found. Please upload and process data first.' });
      }
      
      const dataFilePath = path.join(qnrDataDir, dataFileName);
      console.log(`📄 Looking for processed data file: ${dataFilePath}`);
      
      // Check if file exists before trying to read it
      try {
        await fs.access(dataFilePath);
        console.log(`✅ Processed data file exists`);
      } catch (accessError) {
        // File doesn't exist
        console.log(`❌ Processed data file not found: ${dataFilePath}`);
        console.log(`   Error: ${accessError.message}`);
        return res.status(404).json({ error: 'Processed data file not found. Please upload and process data first.' });
      }
      
      const processedData = JSON.parse(await fs.readFile(dataFilePath, 'utf-8'));
      console.log(`✅ Loaded processed data: ${Object.keys(processedData).length} variables`);
      
      res.json(processedData);
    } catch (e) {
      if (e.code === 'ENOENT') {
        console.log(`ℹ️ No processed data found for questionnaire ${questionnaireId} (this is normal for newly uploaded questionnaires)`);
        res.status(404).json({ error: 'No processed data found for this questionnaire' });
      } else {
        console.error(`❌ Error reading processed data:`, e);
        throw e;
      }
    }
  } catch (error) {
    console.error('Error fetching processed data:', error);
    res.status(500).json({ error: 'Failed to fetch processed data' });
  }
});

// GET /api/questionnaire/raw-data/:questionnaireId - Get full raw data file as JSON
router.get('/raw-data/:questionnaireId', async (req, res) => {
  try {
    const { questionnaireId } = req.params;
    const qnrDataDir = path.join(dataRoot, 'questionnaire-data', questionnaireId);
    const metadataPath = path.join(qnrDataDir, 'metadata.json');
    
    try {
      const metadata = JSON.parse(await fs.readFile(metadataPath, 'utf-8'));
      if (!metadata.dataFileName) {
        return res.status(404).json({ error: 'No data file found. Please upload a data file first.' });
      }
      
      const filePath = path.join(qnrDataDir, metadata.dataFileName);
      
      // Check if file exists
      try {
        await fs.access(filePath);
      } catch (e) {
        return res.status(404).json({ error: 'Data file not found' });
      }
      
      // Read and parse the Excel file
      const workbook = XLSX.readFile(filePath);
      const dataSheetName = workbook.SheetNames[0];
      const dataWorksheet = workbook.Sheets[dataSheetName];
      
      // Convert entire sheet to JSON - includes ALL rows and ALL columns
      const dataJson = XLSX.utils.sheet_to_json(dataWorksheet, { 
        defval: null, 
        blankrows: false,
        raw: false 
      });
      
      // Get all column headers (from first row or all unique keys)
      const allColumns = new Set();
      dataJson.forEach(row => {
        Object.keys(row).forEach(key => allColumns.add(key));
      });
      const columnHeaders = Array.from(allColumns);
      
      res.json({
        columns: columnHeaders,
        rows: dataJson,
        totalRows: dataJson.length,
        totalColumns: columnHeaders.length
      });
    } catch (e) {
      console.error('Error reading raw data file:', e);
      res.status(404).json({ error: 'No data file found for this questionnaire' });
    }
  } catch (error) {
    console.error('Error fetching raw data:', error);
    res.status(500).json({ error: 'Failed to fetch raw data' });
  }
});

// POST /api/questionnaire/save-column-headers - Save column headers to metadata
router.post('/save-column-headers', async (req, res) => {
  try {
    const { questionnaireId, columnHeaders } = req.body;
    
    if (!questionnaireId || !columnHeaders || !Array.isArray(columnHeaders)) {
      return res.status(400).json({ error: 'Questionnaire ID and column headers are required' });
    }
    
    const qnrDataDir = path.join(dataRoot, 'questionnaire-data', questionnaireId);
    await fs.mkdir(qnrDataDir, { recursive: true });
    const metadataPath = path.join(qnrDataDir, 'metadata.json');
    
    let metadata = {};
    try {
      const existingMetadata = await fs.readFile(metadataPath, 'utf-8');
      metadata = JSON.parse(existingMetadata);
    } catch (e) {
      // File doesn't exist yet, that's fine
    }
    
    metadata.columnHeaders = columnHeaders;
    await fs.writeFile(metadataPath, JSON.stringify(metadata, null, 2));
    
    res.json({ message: 'Column headers saved successfully' });
  } catch (error) {
    console.error('Error saving column headers:', error);
    res.status(500).json({ error: 'Failed to save column headers' });
  }
});

// POST /api/questionnaire/upload-data - Process and upload data using column mapping
router.post('/upload-data', async (req, res) => {
  try {
    const { questionnaireId, columnMapping } = req.body;
    
    if (!questionnaireId || !columnMapping) {
      return res.status(400).json({ error: 'Questionnaire ID and column mapping are required' });
    }
    
    // Get saved data file
    const qnrDataDir = path.join(dataRoot, 'questionnaire-data', questionnaireId);
    const metadataPath = path.join(qnrDataDir, 'metadata.json');
    
    let dataFileName;
    try {
      const metadata = JSON.parse(await fs.readFile(metadataPath, 'utf-8'));
      dataFileName = metadata.dataFileName;
    } catch (e) {
      return res.status(404).json({ error: 'No data file found. Please upload a data file first.' });
    }
    
    // Load questionnaire to get question structure for code mapping
    let questionnaire = null;
    try {
      const questionnairesPath = path.join(dataRoot, 'questionnaires.json');
      const questionnairesData = JSON.parse(await fs.readFile(questionnairesPath, 'utf-8'));
      
      // Find the questionnaire in the nested structure
      for (const projectId in questionnairesData) {
        if (Array.isArray(questionnairesData[projectId])) {
          const found = questionnairesData[projectId].find(q => q.id === questionnaireId);
          if (found) {
            questionnaire = found;
            break;
          }
        }
      }
      
      if (!questionnaire) {
        console.warn(`Could not find questionnaire ${questionnaireId} in questionnaires.json`);
      }
    } catch (e) {
      console.warn('Could not load questionnaire for code mapping:', e);
    }
    
    const filePath = path.join(qnrDataDir, dataFileName);
    
    // Read and parse the Excel file - this reads ALL rows, not just headers
    const workbook = XLSX.readFile(filePath);
    const dataSheetName = workbook.SheetNames[0];
    const dataWorksheet = workbook.Sheets[dataSheetName];
    
    // Convert entire sheet to JSON - this includes ALL rows of data
    // Use defval: null to set empty cells to null, and blankrows: false to skip completely empty rows
    // raw: false ensures we get formatted values (not raw cell values)
    const dataJson = XLSX.utils.sheet_to_json(dataWorksheet, { 
      defval: null, 
      blankrows: false,
      raw: false 
    });
    
    console.log(`📁 Reading data file: ${dataFileName}`);
    console.log(`📊 Total rows in file: ${dataJson.length} (including header row)`);
    
    if (dataJson.length === 0) {
      return res.status(400).json({ error: 'Data file is empty' });
    }
    
    if (dataJson.length === 1) {
      console.warn('⚠️ WARNING: Only header row found, no data rows!');
      return res.status(400).json({ error: 'Data file contains only headers, no data rows' });
    }
    
    console.log(`✅ Successfully loaded ${dataJson.length} rows from data file`);
    
    // Process data using column mapping
    // Extract data for each variable based on the column mapping
    const processedData = {};
    
    // dataJson includes ALL rows - first row is headers, rest are data
    // XLSX.utils.sheet_to_json already converts headers to object keys, so each row is an object
    const totalDataRows = dataJson.length;
    console.log(`📊 Processing ${totalDataRows} rows with ${Object.keys(columnMapping).length} variable mappings`);
    
    // Check what columns are actually in the data file
    // Get all unique column names from all rows to ensure we catch all columns
    // (some rows might not have all columns if cells are empty)
    const allColumnNames = new Set();
    dataJson.forEach(row => {
      Object.keys(row).forEach(key => allColumnNames.add(key));
    });
    const actualColumns = Array.from(allColumnNames);
    
    // Verify column mappings exist in the data file
    const allMappedColumns = Object.values(columnMapping).filter(col => col && col.trim() !== '');
    const allFound = allMappedColumns.filter(mappedCol => {
      return actualColumns.some(col => {
        const colLower = col.toLowerCase().trim();
        const mappedLower = mappedCol.toLowerCase().trim();
        return col === mappedCol || 
               colLower === mappedLower ||
               colLower.startsWith(mappedLower) || 
               mappedLower.startsWith(colLower);
      });
    });
    
    if (allFound.length < allMappedColumns.length) {
      console.warn(`⚠️ Warning: ${allMappedColumns.length - allFound.length} mapped columns not found in data file`);
    }
    
    // Process each row of data
    dataJson.forEach((row, rowIndex) => {
      // For each variable in the mapping, extract its value from the corresponding column
      Object.entries(columnMapping).forEach(([variableName, columnHeader]) => {
        if (!columnHeader || columnHeader === '') {
          return; // Skip unmapped variables
        }
        
        if (!processedData[variableName]) {
          processedData[variableName] = [];
        }
        
        // Get the value from the row using the column header
        // The columnHeader is what the AI identified from the data file headers
        // We need to match it against the actual keys in the row object
        const rowKeys = Object.keys(row);
        let value = null;
        let matchedKey = null;
        
        // IMPORTANT: Check if column exists in actualColumns first
        // If column doesn't exist in the data file at all, value should be null
        // If column exists but not in this row (empty cell), value should also be null
        const columnExistsInFile = actualColumns.some(col => {
          const colLower = col.toLowerCase().trim();
          const headerLower = columnHeader.toLowerCase().trim();
          return col === columnHeader || 
                 colLower === headerLower ||
                 col.trim().toLowerCase() === headerLower;
        });
        
        if (!columnExistsInFile) {
          // Column doesn't exist in file at all - set to null
          value = null;
          matchedKey = null;
        } else {
          // Column exists in file - try to find it in this specific row
          // Try multiple matching strategies (in order of strictness):
          // 1. Exact match (most reliable)
          if (rowKeys.includes(columnHeader)) {
            value = row[columnHeader];
            matchedKey = columnHeader;
          }
          // 2. Case-insensitive exact match
          else if (columnHeader) {
            const matchingKey = rowKeys.find(key => key.toLowerCase() === columnHeader.toLowerCase());
            if (matchingKey) {
              value = row[matchingKey];
              matchedKey = matchingKey;
            }
          }
          // 3. Trimmed case-insensitive match (in case of extra whitespace)
          if ((value === null || value === undefined) && columnHeader) {
            const trimmedHeader = columnHeader.trim();
            const matchingKey = rowKeys.find(key => key.trim().toLowerCase() === trimmedHeader.toLowerCase());
            if (matchingKey) {
              value = row[matchingKey];
              matchedKey = matchingKey;
            }
          }
          // Note: Removed starts-with and partial matching strategies to prevent incorrect column matching
          // If exact matches (strategies 1-3) don't find the column, it means:
          // - The cell is empty (column exists in file but not in this row), OR
          // - The column header doesn't match exactly
          // In either case, value should remain null
          // If column exists in file but not found in this row, it means the cell is empty
          // value remains null, which is correct
        }
        
        // Log warnings for variables that should have data but aren't matching
        if (rowIndex === 0 && !matchedKey && columnHeader) {
          // Only log once per variable (on first row) to avoid spam
          const potentialMatches = rowKeys.filter(key => {
            const keyLower = key.toLowerCase();
            const headerLower = columnHeader.toLowerCase();
            // Check if there's any similarity
            return keyLower.includes('qs11') && headerLower.includes('qs11') ||
                   (keyLower.includes('s11') && headerLower.includes('s11'));
          });
          if (potentialMatches.length > 0 && variableName.startsWith('S11')) {
            console.warn(`⚠️ Variable ${variableName} mapped to "${columnHeader}" but no exact match found. Potential matches: ${potentialMatches.slice(0, 3).join(', ')}`);
          }
        }
        
        // If column wasn't found, ensure value is null
        // This handles cases where:
        // 1. The column doesn't exist in the row (empty cell)
        // 2. The column header doesn't match any key in the row
        if (!matchedKey) {
          value = null;
        }
        
        // Normalize empty values - Excel may return empty cells as null, undefined, empty string, whitespace, or 0
        // Convert all empty-like values to null to maintain consistency
        let normalizedValue = value;
        if (value === null || value === undefined) {
          normalizedValue = null;
        } else if (typeof value === 'string') {
          // Empty string or whitespace-only string should be null
          normalizedValue = value.trim() === '' ? null : value;
        } else if (typeof value === 'number' && isNaN(value)) {
          // NaN should be null
          normalizedValue = null;
        }
        // Note: We keep 0 as 0 (not null) because 0 is a valid data value
        // If 0 should be treated as empty, uncomment the line below:
        // normalizedValue = (normalizedValue === 0) ? null : normalizedValue;
        
        // Always push values (including null/empty) to maintain array alignment across variables
        // Empty cells should be null, not skipped, so that row indices match across all variables
        // This ensures that all variables have the same array length, preventing misalignment
        processedData[variableName].push(normalizedValue);
      });
    });
    
    // Count how many variables have data
    const variablesWithDataCount = Object.entries(processedData).filter(([name, values]) => 
      values && Array.isArray(values) && values.length > 0
    ).length;
    
    console.log(`✅ Extracted data for ${variablesWithDataCount} out of ${Object.keys(processedData).length} variables`);
    
    if (variablesWithDataCount === 0) {
      console.warn(`⚠️ WARNING: No data extracted for any variables! Check column mapping.`);
    }
    
    // Calculate statistics for each variable
    const variableStats = {};
    Object.entries(processedData).forEach(([variableName, values]) => {
      if (!values || values.length === 0) {
        variableStats[variableName] = {
          count: 0,
          values: []
        };
        return;
      }
      
      // Convert to numbers if possible
      const numericValues = values.map(v => {
        const num = parseFloat(v);
        return isNaN(num) ? null : num;
      }).filter(v => v !== null);
      
      const allNumeric = numericValues.length === values.length;
      
      if (allNumeric && numericValues.length > 0) {
        // Calculate statistics for numeric variables
        const sorted = [...numericValues].sort((a, b) => a - b);
        const sum = numericValues.reduce((a, b) => a + b, 0);
        const mean = sum / numericValues.length;
        const median = sorted.length % 2 === 0
          ? (sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2
          : sorted[Math.floor(sorted.length / 2)];
        
        // Calculate mode
        const frequency = {};
        numericValues.forEach(v => {
          frequency[v] = (frequency[v] || 0) + 1;
        });
        const mode = Object.entries(frequency).sort((a, b) => b[1] - a[1])[0]?.[0];
        
        // Calculate standard deviation
        const variance = numericValues.reduce((acc, val) => acc + Math.pow(val - mean, 2), 0) / numericValues.length;
        const stdDev = Math.sqrt(variance);
        
        // Calculate mean with outliers removed (outliers = values outside 2 standard deviations from mean)
        const valuesWithoutOutliers = numericValues.filter(val => {
          return Math.abs(val - mean) <= 2 * stdDev;
        });
        
        let meanNoOutliers = null;
        let sumNoOutliers = null;
        if (valuesWithoutOutliers.length > 0) {
          sumNoOutliers = valuesWithoutOutliers.reduce((a, b) => a + b, 0);
          meanNoOutliers = sumNoOutliers / valuesWithoutOutliers.length;
        }
        
        variableStats[variableName] = {
          count: values.length,
          values: values,
          numeric: true,
          mean,
          median,
          mode: mode ? parseFloat(mode) : null,
          min: sorted[0],
          max: sorted[sorted.length - 1],
          sum,
          stdDev,
          meanNoOutliers,
          sumNoOutliers
        };
      } else {
        // Count frequencies for categorical variables
        // Try to map values to codes from questionnaire if available
        const frequency = {};
        
        // Try to find the question for this variable to get code mappings
        let codeMap = null;
        if (questionnaire && questionnaire.questions) {
          // Extract base variable name and determine if it's a grid variable
          // Patterns: "S4_r1" -> baseVar="S4", suffix="_r1" (statement)
          //          "S4_c1" -> baseVar="S4", suffix="_c1" (response)
          //          "S4" -> baseVar="S4", no suffix (summary or non-grid)
          const gridMatch = variableName.match(/^([A-Z0-9]+)_([rc])(\d+)$/i);
          const baseMatch = variableName.match(/^([A-Z0-9]+)/);
          
          if (baseMatch) {
            const baseVar = baseMatch[1];
            const question = questionnaire.questions.find((q) => 
              q.number === baseVar || q.id === baseVar
            );
            
            if (question) {
              // Determine which options to use based on variable name pattern
              let optionsToUse = null;
              
              if (gridMatch) {
                // This is a grid variable (e.g., "S4_r1" or "S4_c1")
                const suffixType = gridMatch[2].toLowerCase(); // 'r' or 'c'
                if (suffixType === 'r' && question.statementOptions) {
                  // Statement variable - use statementOptions
                  optionsToUse = question.statementOptions;
                } else if (suffixType === 'c' && question.responseOptions) {
                  // Response variable - use responseOptions
                  optionsToUse = question.responseOptions;
                }
              } else if (question.options) {
                // Non-grid question - use regular options
                optionsToUse = question.options;
              } else if (question.responseOptions) {
                // Fallback: might be a grid question without suffix, try responseOptions
                optionsToUse = question.responseOptions;
              }
              
              if (optionsToUse) {
                // Build code map: value -> code
                codeMap = {};
                optionsToUse.forEach((opt, idx) => {
                  // Handle both string and object formats
                  let code, value;
                  if (typeof opt === 'string') {
                    code = String(idx + 1);
                    value = opt;
                  } else {
                    // Object format: {code: "c1", text: "Option 1"} or {code: "r1", text: "Statement 1"}
                    code = opt.code || String(idx + 1);
                    value = opt.text || opt.value || String(idx + 1);
                  }
                  
                  // Normalize value for matching (trim whitespace, lowercase for comparison)
                  const normalizedValue = String(value).trim().toLowerCase();
                  
                  // Map multiple representations to the code
                  // 1. Exact text match (case-sensitive)
                  codeMap[String(value)] = code;
                  codeMap[value] = code;
                  
                  // 2. Normalized text match (case-insensitive, trimmed)
                  codeMap[normalizedValue] = code;
                  
                  // 3. Numeric index
                  codeMap[String(idx + 1)] = code;
                  
                  // 4. The code itself (in case data already has codes)
                  codeMap[code] = code;
                  
                  // 5. Numeric representations
                  if (!isNaN(parseInt(value))) {
                    codeMap[String(parseInt(value))] = code;
                  }
                  
                  // 6. Map just the number part if code has prefix (e.g., "c1" -> map "1" to "c1")
                  const codeNumMatch = code.match(/(\d+)$/);
                  if (codeNumMatch) {
                    codeMap[codeNumMatch[1]] = code;
                  }
                  
                  // 7. Partial text matching - map common variations
                  // If value contains parentheses, also map the text before parentheses
                  const parenMatch = String(value).match(/^([^(]+)/);
                  if (parenMatch) {
                    const beforeParen = parenMatch[1].trim();
                    codeMap[beforeParen.toLowerCase()] = code;
                    codeMap[beforeParen] = code;
                  }
                });
              }
            }
          }
        }
        
        values.forEach(v => {
          const rawValue = String(v).trim();
          const normalizedValue = rawValue.toLowerCase();
          
          // Try to find matching code using multiple strategies
          let code = null;
          let matchType = 'none';
          
          if (codeMap) {
            // 1. Try exact match (case-sensitive)
            if (codeMap[rawValue]) {
              code = codeMap[rawValue];
              matchType = 'exact';
            }
            // 2. Try normalized match (case-insensitive)
            else if (codeMap[normalizedValue]) {
              code = codeMap[normalizedValue];
              matchType = 'normalized';
            }
            // 3. Try partial match - find keys that contain the value or vice versa
            else {
              // First, try to find a key where the value is contained in the key
              // This handles cases like "Adult Neurology" matching "Adult Neurology (AN)"
              const containingKey = Object.keys(codeMap).find(key => {
                const keyLower = key.toLowerCase();
                const valueLower = normalizedValue;
                // Check if key contains the full value (most specific match)
                if (keyLower.includes(valueLower) && valueLower.length > 3) {
                  return true;
                }
                // Also check if value contains key (for abbreviations)
                if (valueLower.includes(keyLower) && keyLower.length > 3) {
                  return true;
                }
                return false;
              });
              
              if (containingKey) {
                code = codeMap[containingKey];
                matchType = 'partial';
              }
              // 4. Try word-by-word matching for multi-word values
              else if (normalizedValue.includes(' ')) {
                const valueWords = normalizedValue.split(/\s+/).filter(w => w.length > 2);
                const matchingKey = Object.keys(codeMap).find(key => {
                  const keyLower = key.toLowerCase();
                  // Check if all significant words from value appear in key
                  const allWordsMatch = valueWords.every(word => keyLower.includes(word));
                  if (allWordsMatch) {
                    return true;
                  }
                  // Also check reverse - if key words appear in value
                  const keyWords = keyLower.split(/\s+/).filter(w => w.length > 2);
                  return keyWords.every(word => normalizedValue.includes(word));
                });
                if (matchingKey) {
                  code = codeMap[matchingKey];
                  matchType = 'word-match';
                }
              }
            }
          }
          
          // If no match found, use raw value as code
          if (!code) {
            code = rawValue;
            matchType = 'no-match';
          }
          
          frequency[code] = (frequency[code] || 0) + 1;
        });
        
        variableStats[variableName] = {
          count: values.length,
          values: values,
          numeric: false,
          frequencies: frequency
        };
      }
    });
    
    // Save processed data to file
    const dataFilePath = path.join(qnrDataDir, 'processed-data.json');
    await fs.writeFile(dataFilePath, JSON.stringify(variableStats, null, 2));
    console.log(`💾 Saved processed data to: ${dataFilePath}`);
    
    // Verify file was written
    try {
      await fs.access(dataFilePath);
      const stats = await fs.stat(dataFilePath);
      console.log(`✅ Verified processed data file exists (${stats.size} bytes)`);
    } catch (verifyError) {
      console.error(`❌ ERROR: Processed data file was not created! ${verifyError.message}`);
    }
    
    // Also update metadata
    const metadata = JSON.parse(await fs.readFile(metadataPath, 'utf-8'));
    metadata.processedDataFile = 'processed-data.json';
    metadata.processedAt = new Date().toISOString();
    metadata.rowsProcessed = dataJson.length;
    await fs.writeFile(metadataPath, JSON.stringify(metadata, null, 2));
    console.log(`💾 Updated metadata with processedDataFile and processedAt`);
    
    console.log(`✅ Processed data for ${Object.keys(variableStats).length} variables`);
    console.log(`📊 Sample variable stats:`, Object.keys(variableStats).slice(0, 3).map(v => ({
      variable: v,
      count: variableStats[v].count,
      hasFrequencies: !!variableStats[v].frequencies,
      isNumeric: variableStats[v].numeric
    })));
    
    res.json({ 
      message: 'Data uploaded and processed successfully',
      rowsProcessed: dataJson.length,
      variablesProcessed: Object.keys(variableStats).length,
      variablesWithData: variablesWithDataCount,
      data: variableStats
    });
  } catch (error) {
    console.error('Error uploading data:', error);
    res.status(500).json({ error: 'Failed to upload data' });
  }
});

// TEST ENDPOINT: New fast parser using AI cleaning + hard-coded parsing
router.post('/parse-test-new', upload.single('file'), async (req, res) => {
  console.log('🧪 TEST: Using NEW fast parser (AI cleaning + hard-coded parsing)');

  try {
    const { projectId } = req.body;

    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    const filePath = req.file.path;

    console.log(`📄 Processing file: ${req.file.originalname}`);
    console.log(`📊 File size: ${req.file.size} bytes`);

    const startTime = Date.now();

    // Use new parser
    const questions = await cleanAndParseQuestionnaire(filePath, projectId);

    const totalTime = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log(`✅ TEST COMPLETE: Parsed ${questions.length} questions in ${totalTime}s`);

    // Clean up uploaded file
    try {
      await fs.unlink(filePath);
    } catch (cleanupError) {
      console.warn('Failed to delete temp file:', cleanupError);
    }

    res.json({
      success: true,
      message: `Successfully parsed ${questions.length} questions using NEW method`,
      totalTime: `${totalTime}s`,
      questionCount: questions.length,
      questions: questions,
      method: 'AI Cleaning + Hard-Coded Parser (NEW)'
    });

  } catch (error) {
    console.error('❌ Error in new parser test:', error);

    // Clean up file on error
    if (req.file?.path) {
      try {
        await fs.unlink(req.file.path);
      } catch (cleanupError) {
        console.warn('Failed to delete temp file:', cleanupError);
      }
    }

    res.status(500).json({
      error: error.message || 'Failed to parse questionnaire',
      method: 'AI Cleaning + Hard-Coded Parser (NEW - FAILED)'
    });
  }
});

// STEP 1: Clean QNR with AI (don't parse yet)
router.post('/clean-qnr', upload.single('file'), async (req, res) => {
  console.log('🧪 STEP 1: Cleaning QNR with AI...');

  try {
    const { projectId } = req.body;

    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    const filePath = req.file.path;

    console.log(`📄 Processing file: ${req.file.originalname}`);
    console.log(`📊 File size: ${req.file.size} bytes`);

    // Clean the questionnaire with AI
    const { cleanedText, cleaningTime } = await cleanQuestionnaire(filePath, projectId);

    console.log(`✅ STEP 1 COMPLETE: Cleaned in ${cleaningTime}s`);

    // Clean up uploaded file
    try {
      await fs.unlink(filePath);
    } catch (cleanupError) {
      console.warn('Failed to delete temp file:', cleanupError);
    }

    res.json({
      success: true,
      message: `AI cleaning completed in ${cleaningTime}s`,
      cleaningTime: `${cleaningTime}s`,
      cleanedText: cleanedText,
      step: 'CLEANED - Ready to parse'
    });

  } catch (error) {
    console.error('❌ Error cleaning QNR:', error);

    // Clean up file on error
    if (req.file?.path) {
      try {
        await fs.unlink(req.file.path);
      } catch (cleanupError) {
        console.warn('Failed to delete temp file:', cleanupError);
      }
    }

    res.status(500).json({
      error: error.message || 'Failed to clean questionnaire',
      step: 'CLEANING FAILED'
    });
  }
});

// STEP 2: Parse already-cleaned QNR (instant!)
router.post('/parse-cleaned-qnr', async (req, res) => {
  console.log('🧪 STEP 2: Parsing cleaned QNR...');

  try {
    const { cleanedText } = req.body;

    if (!cleanedText) {
      return res.status(400).json({ error: 'No cleaned text provided' });
    }

    // Parse the cleaned questionnaire (instant!)
    const { questions, parseTime } = parseCleanedQuestionnaire(cleanedText);

    console.log(`✅ STEP 2 COMPLETE: Parsed ${questions.length} questions in ${parseTime}s`);

    res.json({
      success: true,
      message: `Successfully parsed ${questions.length} questions`,
      parseTime: `${parseTime}s`,
      questionCount: questions.length,
      questions: questions,
      step: 'PARSED - Complete'
    });

  } catch (error) {
    console.error('❌ Error parsing cleaned QNR:', error);

    res.status(500).json({
      error: error.message || 'Failed to parse cleaned questionnaire',
      step: 'PARSING FAILED'
    });
  }
});

export default router;
