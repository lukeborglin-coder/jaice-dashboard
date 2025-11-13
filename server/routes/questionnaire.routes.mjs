import express from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs/promises';
import mammoth from 'mammoth';
import OpenAI from 'openai';
import XLSX from 'xlsx';
import { authenticateToken, requireCognitiveOrAdmin } from '../middleware/auth.middleware.mjs';
import { logCost, COST_CATEGORIES } from '../services/costTracking.service.mjs';

const router = express.Router();

// Enforce auth + company access for all questionnaire endpoints
router.use(authenticateToken, requireCognitiveOrAdmin);

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

// Helper function to split questionnaire text into chunks
function splitQuestionnaireIntoChunks(text, maxChunkSize = 35000) {
  // Improved regex to catch more question formats: QS14, S1, A1, Q1, Section 1, Question 1, etc.
  // This pattern matches: QS followed by digits, S/Q followed by digits, any letter followed by digits, or Section/Question headers
  // Note: QS must come before Q to avoid matching QS as just Q
  const questionPattern = /(?:^|\n)(QS\d+|S\d+|Q\d+|A\d+|[A-Z]+\d+|Section\s+\d+|Question\s+\d+)/i;
  
  // Find all question markers and their positions
  const markers = [];
  let match;
  const regex = new RegExp(questionPattern.source, questionPattern.flags + 'g');
  
  while ((match = regex.exec(text)) !== null) {
    markers.push({
      index: match.index,
      text: match[0].trim(),
      fullMatch: match[0]
    });
  }
  
  // If no markers found, split by size only
  if (markers.length === 0) {
    const chunks = [];
    for (let i = 0; i < text.length; i += maxChunkSize) {
      chunks.push(text.substring(i, i + maxChunkSize));
    }
    return chunks;
  }
  
  // Split into chunks at question boundaries
  // Strategy: Start from first marker, accumulate questions until we hit size limit, then split
  const chunks = [];
  const chunkInfo = []; // Track chunk positions for verification
  
  if (markers.length === 0) {
    // No markers found, split by size only
    for (let i = 0; i < text.length; i += maxChunkSize) {
      const chunk = text.substring(i, i + maxChunkSize);
      chunks.push(chunk);
      chunkInfo.push({ start: i, end: i + chunk.length });
    }
    return chunks;
  }
  
  // Start from the first marker (or beginning if no markers)
  let chunkStart = markers[0]?.index ?? 0;
  
  for (let i = 0; i < markers.length; i++) {
    const marker = markers[i];
    const nextMarker = markers[i + 1];
    
    // Calculate where this chunk would end if we include this marker's question
    // The chunk ends at the start of the next marker (or end of text)
    const proposedChunkEnd = nextMarker ? nextMarker.index : text.length;
    const proposedChunkSize = proposedChunkEnd - chunkStart;
    
    // If adding this question would exceed max size AND we're not at the first marker,
    // we need to split before this marker
    if (proposedChunkSize > maxChunkSize && i > 0) {
      // End the current chunk right before this marker
      const chunk = text.substring(chunkStart, marker.index);
      if (chunk.length > 0) {
        chunks.push(chunk);
        chunkInfo.push({ start: chunkStart, end: marker.index });
        const firstMarkerInChunk = markers.find(m => m.index >= chunkStart);
        console.log(`📦 Chunk ${chunks.length}: ${chunk.length} chars, positions ${chunkStart}-${marker.index}, from marker ${firstMarkerInChunk?.text || 'start'} to before ${marker.text}`);
      }
      // Start a new chunk at this marker
      chunkStart = marker.index;
    }
    
    // If this is the last marker, we're done - will add final chunk below
    if (!nextMarker) {
      break;
    }
  }
  
  // Always add the final chunk (from current chunkStart to end of text)
  const finalChunk = text.substring(chunkStart);
  if (finalChunk.length > 0) {
    chunks.push(finalChunk);
    chunkInfo.push({ start: chunkStart, end: text.length });
    const firstMarkerInChunk = markers.find(m => m.index >= chunkStart);
    const lastMarker = markers[markers.length - 1];
  }
  
  // Verify all markers are included in chunks
  let markersInChunks = 0;
  chunkInfo.forEach((info) => {
    const markersInThisChunk = markers.filter(m => m.index >= info.start && m.index < info.end);
    markersInChunks += markersInThisChunk.length;
  });
  
  if (markersInChunks < markers.length) {
    console.warn(`⚠️ Warning: Only ${markersInChunks} of ${markers.length} markers found in chunks!`);
  }
  
  // If we somehow have no chunks, return the whole text
  if (chunks.length === 0) {
    return [text];
  }
  
  console.log(`📦 Split into ${chunks.length} chunks at question boundaries`);
  
  return chunks;
}

// Parse a single chunk of questionnaire
async function parseQuestionnaireChunk(textChunk, chunkIndex, totalChunks, systemPrompt, projectId) {
  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  
  const userPrompt = `Please parse this ${chunkIndex === 0 && totalChunks > 1 ? 'FIRST SECTION' : chunkIndex === totalChunks - 1 && totalChunks > 1 ? 'FINAL SECTION' : totalChunks > 1 ? `SECTION ${chunkIndex + 1} of ${totalChunks}` : ''} of a questionnaire document and extract ALL questions with their details:

${textChunk}

${totalChunks > 1 ? `\nCRITICAL: This is section ${chunkIndex + 1} of ${totalChunks}. You MUST parse EVERY SINGLE question in this section. Do not skip any questions. Look for all question markers (QS, S, Q, A, F, G, etc. followed by numbers) and extract every question you find.` : '\nCRITICAL: You MUST parse EVERY SINGLE question in this document. Do not skip any questions. Look for all question markers (QS, S, Q, A, F, G, etc. followed by numbers) and extract every question you find.'}

Return a JSON object with this structure:
{
  "questions": [
    {
      "id": "unique-id",
      "number": "question number (e.g., S1, A1, Q1)",
      "text": "full question text",
      "type": "specific Forsta question type from the library above",
      "options": ["option1", "option2", ...],  // For non-grid questions: response options
      "statementOptions": [{"code": "r1", "text": "statement 1"}, ...],  // For grid questions: row labels/statements (ALWAYS use "r" prefix: r1, r2, r3, etc.)
      "responseOptions": [{"code": "c1", "text": "Option 1"}, ...],  // For grid questions: column headers/response scale (ALWAYS use "c" prefix: c1, c2, c3, etc.)
      "showLogic": "condition for showing this question (if present)",
      "randomize": true/false,
      "tags": ["tag1", "tag2"],
      "needsReview": true/false,
      "logic": "any skip logic or conditions"
    }
  ]
}

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
    max_tokens: 16384  // Maximum for gpt-4o
  });

  const finishReason = response.choices[0].finish_reason;
  if (finishReason === 'length') {
    throw new Error(`Chunk ${chunkIndex + 1} response was truncated. The questionnaire section is too large.`);
  }

  const content = response.choices[0].message.content;
  if (!content || content.trim().length === 0) {
    throw new Error(`Chunk ${chunkIndex + 1} returned empty response`);
  }

  let parsedData;
  try {
    parsedData = JSON.parse(content);
  } catch (parseError) {
    console.error(`JSON Parse Error for chunk ${chunkIndex + 1}:`, parseError);
    throw new Error(`Failed to parse JSON response for chunk ${chunkIndex + 1}: ${parseError.message}`);
  }

  const questions = parsedData.questions || [];
  
  // Log cost for this chunk
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
          `Questionnaire parsing chunk ${chunkIndex + 1} of ${totalChunks}`
        );
      } catch (costError) {
        console.warn('Failed to log cost for chunk:', costError.message);
      }
    }
  }
  
  return questions;
}

// Parse questionnaire from .docx file using AI
async function parseQuestionnaire(filePath, projectId) {
  try {
    // Extract text from .docx file
    const result = await mammoth.extractRawText({ path: filePath });
    const text = result.value;
    
    // Define systemPrompt (used for both chunked and non-chunked parsing)
    const systemPrompt = `You are a Forsta/Decipher questionnaire expert. Parse questionnaires with EXACT fidelity to programming logic.

CRITICAL PARSING RULES:

1. PROGRAMMING NOTES (ALL CAPS TEXT):
   - "ASK IF [condition]" → showLogic: "[condition]"
   - "SHOW IF [condition]" → showLogic: "[condition]"  
   - "TERMINATE IF [condition]" → terminateLogic: "[condition]"
   - "RANDOMIZE" → randomize: true
   - "RANGE: X-Y" → validation: {type: "range", min: X, max: Y}
   - "MUST = 100%" → validation: {type: "sum", value: 100, unit: "%"}

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
   - [RANDOMIZE] → randomize this specific option set

4. PIPING (VARIABLES IN BRACKETS):
   - [INSERT variable] → insert value from previous question
   - "Of your [INSERT S4r5] patients" → piping from S4, row 5

5. HIDDEN VARIABLES:
   Detect sections like:
   "PATIENT COUNT (Hidden Variable)"
   Extract calculation logic

6. QUOTAS:
   Extract quota tables with conditions

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

    const estimatedTokens = text.length / 4; // Rough estimate: 4 chars per token
    
    // Single-pass parsing - use full context window
    const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    
    const userPrompt = `Please parse this questionnaire document and extract ALL questions with their details. CRITICAL: You MUST parse EVERY SINGLE question in this document. Do not skip any questions. Look for all question markers (QS, S, Q, A, F, G, etc. followed by numbers) and extract every question you find:


${text}

Analyze the document thoroughly and return the structured data as JSON. Focus on extracting the core question information first, then add logic details where clearly present.

Return a JSON object with this structure:
{
  "questions": [
    {
      "id": "unique-id",
      "number": "question number (e.g., S1, A1, Q1)",
      "text": "full question text",
      "type": "specific Forsta question type from the library above",
      "options": ["option1", "option2", ...],  // For non-grid questions: response options
      "statementOptions": [{"code": "r1", "text": "statement 1"}, ...],  // For grid questions: row labels/statements (ALWAYS use "r" prefix: r1, r2, r3, etc.)
      "responseOptions": [{"code": "c1", "text": "Option 1"}, ...],  // For grid questions: column headers/response scale (ALWAYS use "c" prefix: c1, c2, c3, etc.)
      "showLogic": "condition for showing this question (if present)",
      "randomize": true/false,
      "tags": ["tag1", "tag2"],
      "needsReview": true/false,
      "logic": "any skip logic or conditions"
    }
  ]
}

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
      throw new Error('AI response was truncated due to output token limit (16,384 tokens max). The questionnaire may be too large to parse in a single pass. Please try splitting the questionnaire or contact support.');
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
      // Normalize statementOptions codes to always use "r" prefix
      const normalizedStatementOptions = question.statementOptions?.map((stmt, stmtIndex) => {
        const stmtObj = typeof stmt === 'string' ? { code: `r${stmtIndex + 1}`, text: stmt } : stmt;
        const code = stmtObj.code || `r${stmtIndex + 1}`;
        // Ensure code starts with "r" prefix
        const normalizedCode = code.startsWith('r') ? code : `r${code.replace(/^r?/, '')}`;
        return { ...stmtObj, code: normalizedCode };
      });

      // Normalize responseOptions codes to always use "c" prefix
      const normalizedResponseOptions = question.responseOptions?.map((resp, respIndex) => {
        const respObj = typeof resp === 'string' ? { code: `c${respIndex + 1}`, text: resp } : resp;
        const code = respObj.code || `c${respIndex + 1}`;
        // Ensure code starts with "c" prefix
        const normalizedCode = code.startsWith('c') ? code : `c${code.replace(/^c?/, '')}`;
        return { ...respObj, code: normalizedCode };
      });

      // Process tags - ensure we have an array
      let processedTags = Array.isArray(question.tags) ? [...question.tags] : [];

      // Convert Button Rating to Single Select
      if (question.type === 'Button Rating') {
        question.type = 'Single Select';
      }

      // Detect scale questions - ONLY if actually a rating/evaluation question, not just based on number of options
      // The AI should have already determined this in the prompt, but we do a final check for explicit scale mentions
      const questionText = (question.text || '').toLowerCase();
      const mentionsScale = questionText.includes('point scale') || questionText.includes('-point scale') || 
                           questionText.includes('rating scale') || 
                           (questionText.includes('scale') && (questionText.includes('rate') || questionText.includes('rate from') || questionText.includes('on a scale'))) ||
                           questionText.includes('how satisfied') || questionText.includes('how likely') || 
                           questionText.includes('how much do you agree') || questionText.includes('rate your') ||
                           questionText.includes('how important') || questionText.includes('how would you rate');
      
      // Only add Scale tag if AI already added it OR if question explicitly mentions scale terminology
      // DO NOT automatically add based on number of options - let AI determine from context
      if (mentionsScale && !processedTags.includes('Scale')) {
        processedTags.push('Scale');
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

      return {
        ...question,
        id: question.id || `q-${Date.now()}-${index + 1}`,
        needsReview: question.needsReview || false,
        tags: processedTags,
        showLogic: question.showLogic || null,
        randomize: question.randomize || false,
        // Handle legacy logic field for backward compatibility
        logic: question.logic || question.showLogic || '',
        // Ensure statementOptions and responseOptions are properly formatted with correct prefixes
        statementOptions: normalizedStatementOptions || (question.type && question.type.toLowerCase().includes('grid') ? [] : undefined),
        responseOptions: normalizedResponseOptions || (question.type && question.type.toLowerCase().includes('grid') && !question.type.toLowerCase().includes('numeric') ? [] : undefined),
        // Keep options for backward compatibility with non-grid questions
        options: question.options || []
      };
    });
    
    return questions;
  } catch (error) {
    console.error('Error parsing questionnaire:', error);
    throw new Error('Failed to parse questionnaire file: ' + error.message);
  }
}

// Generate XML for Forsta/Decipher compatibility
function generateXml(questionnaire) {
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<survey>
  <title>${questionnaire.name}</title>
  <created>${questionnaire.createdAt}</created>
  <description>Generated from JAICE Questionnaire Parser</description>
  
  ${questionnaire.questions.map(question => {
    let xml = `  <question id="${question.id}" type="${question.type}"`;
    
    // Add show logic if present
    if (question.showLogic) {
      xml += ` showif="${question.showLogic}"`;
    }
    
    xml += `>
    <text>${question.text}</text>`;
    
    // Handle enhanced options structure
    if (question.options && question.options.length > 0) {
      xml += `
    <options>`;
      
      question.options.forEach((option, index) => {
        let optionXml = `
      <option`;
        
        // Handle both string and object option formats
        if (typeof option === 'string') {
          const value = option.replace(/[^a-zA-Z0-9]/g, '_').toLowerCase();
          optionXml += ` value="${value}" code="${index + 1}">${option}</option>`;
        } else {
          const value = option.value || (index + 1).toString();
          const code = option.code || (index + 1).toString();
          optionXml += ` value="${value}" code="${code}"`;
          
          // Add action if present
          if (option.action) {
            optionXml += ` action="${option.action}"`;
          }
          
          // Add tags if present
          if (option.tags && option.tags.length > 0) {
            optionXml += ` tags="${option.tags.join(',')}"`;
          }
          
          optionXml += `>${option.text}</option>`;
        }
        
        xml += optionXml;
      });
      
      xml += `
    </options>`;
    }
    
    // Add randomize attribute
    if (question.randomize) {
      xml += `
    <randomize>true</randomize>`;
    }
    
    // Add validation rules
    if (question.validation) {
      xml += `
    <validation>`;
      if (question.validation.type === 'range') {
        xml += `
      <range min="${question.validation.min}" max="${question.validation.max}"/>`;
      } else if (question.validation.type === 'sum') {
        xml += `
      <sum value="${question.validation.value}" unit="${question.validation.unit}"/>`;
      }
      xml += `
    </validation>`;
    }
    
    // Add grid structure
    if (question.grid) {
      xml += `
    <grid>`;
      if (question.grid.rows) {
        xml += `
      <rows>`;
        question.grid.rows.forEach(row => {
          xml += `
        <row code="${row.code}">${row.text}</row>`;
          if (row.validation) {
            xml += ` <!-- ${row.validation} -->`;
          }
        });
        xml += `
      </rows>`;
      }
      if (question.grid.columns) {
        xml += `
      <columns>`;
        question.grid.columns.forEach(col => {
          xml += `
        <column code="${col.code}" type="${col.type}">${col.text}</column>`;
        });
        xml += `
      </columns>`;
      }
      if (question.grid.autofill) {
        xml += `
      <autofill>${question.grid.autofill}</autofill>`;
      }
      if (question.grid.sumValidation) {
        xml += `
      <sumValidation>${question.grid.sumValidation}</sumValidation>`;
      }
      xml += `
    </grid>`;
    }
    
    // Add skip logic
    if (question.skipLogic && question.skipLogic.length > 0) {
      xml += `
    <skipLogic>`;
      question.skipLogic.forEach(logic => {
        xml += `
      <condition logic="${logic.condition}" action="${logic.action}"/>`;
      });
      xml += `
    </skipLogic>`;
    }
    
    // Add piping variables
    if (question.piping && question.piping.length > 0) {
      xml += `
    <piping>`;
      question.piping.forEach(pipe => {
        xml += `
      <variable>${pipe}</variable>`;
      });
      xml += `
    </piping>`;
    }
    
    // Add hidden variable
    if (question.hiddenVariable) {
      xml += `
    <hiddenVariable name="${question.hiddenVariable.name}">`;
      if (question.hiddenVariable.options) {
        question.hiddenVariable.options.forEach(option => {
          xml += `
      <option value="${option.value}" label="${option.label}" logic="${option.logic}"/>`;
        });
      }
      xml += `
    </hiddenVariable>`;
    }
    
    // Add legacy tags for backward compatibility
    if (question.tags && question.tags.length > 0) {
      xml += `
    <tags>`;
      question.tags.forEach(tag => {
        xml += `
      <tag>${tag}</tag>`;
      });
      xml += `
    </tags>`;
    }
    
    // Add legacy logic for backward compatibility
    if (question.logic) {
      xml += `
    <logic>${question.logic}</logic>`;
    }
    
    // Add question attributes based on type
    if (question.type === 'scale' || question.type === 'Slider Rating') {
      xml += `
    <attributes>
      <min>1</min>
      <max>10</max>
      <step>1</step>
    </attributes>`;
    } else if (question.type === 'open-end' || question.type === 'Text/Open-Ended' || question.type === 'Open End') {
      xml += `
    <attributes>
      <maxLength>1000</maxLength>
      <multiline>true</multiline>
    </attributes>`;
    }
    
    xml += `
  </question>`;
    return xml;
  }).join('\n')}
  
  <metadata>
    <generator>JAICE Questionnaire Parser</generator>
    <version>2.0</version>
    <exportDate>${new Date().toISOString()}</exportDate>
  </metadata>
</survey>`;

  return xml;
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

// POST /api/questionnaire/upload - Upload and parse questionnaire
router.post('/upload', upload.single('file'), async (req, res) => {
  try {
    const { projectId } = req.body;
    const { name } = req.body;
    
    if (!req.file || !projectId) {
      return res.status(400).json({ error: 'Missing file or projectId' });
    }
    
    // Parse the questionnaire
    const questions = await parseQuestionnaire(req.file.path, projectId);
    
    // Create questionnaire object
    const questionnaire = {
      id: `qnr-${Date.now()}`,
      name: name || req.file.originalname.replace('.docx', ''),
      questions: questions,
      createdAt: new Date().toISOString(),
      projectId: projectId,
      filePath: req.file.path
    };
    
    // Save to questionnaires.json
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
    
    res.json(questionnaire);
  } catch (error) {
    console.error('Error uploading questionnaire:', error);
    res.status(500).json({ error: 'Failed to upload questionnaire: ' + error.message });
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
    
    // Check if original file still exists
    if (!questionnaire.filePath) {
      return res.status(404).json({ error: 'Original questionnaire file path not found. Please re-upload the file.' });
    }
    
    try {
      await fs.access(questionnaire.filePath);
    } catch (error) {
      return res.status(404).json({ error: 'Original questionnaire file not found. Please re-upload the file.' });
    }
    
    // Re-parse the questionnaire with updated prompt
    const questions = await parseQuestionnaire(questionnaire.filePath, projectId);
    
    // Update the questionnaire in the array
    for (const pid in questionnaires) {
      if (Array.isArray(questionnaires[pid])) {
        const index = questionnaires[pid].findIndex(q => q.id === questionnaireId);
        if (index !== -1) {
          questionnaires[pid][index] = {
            ...questionnaires[pid][index],
            questions: questions,
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
    
    // Find and delete the questionnaire
    let found = false;
    for (const projectId in questionnaires) {
      const index = questionnaires[projectId].findIndex(q => q.id === questionnaireId);
      if (index !== -1) {
        questionnaires[projectId].splice(index, 1);
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
    const metadataPath = path.join(qnrDataDir, 'metadata.json');
    
    try {
      const metadata = JSON.parse(await fs.readFile(metadataPath, 'utf-8'));
      
      // Delete the data file if it exists
      if (metadata.dataFileName) {
        const filePath = path.join(qnrDataDir, metadata.dataFileName);
        try {
          await fs.unlink(filePath);
          console.log(`🗑️ Deleted data file: ${metadata.dataFileName}`);
        } catch (e) {
          console.warn('Could not delete data file:', e);
        }
      }
      
      // Delete processed data file if it exists
      const processedDataPath = path.join(qnrDataDir, 'processed-data.json');
      try {
        await fs.unlink(processedDataPath);
        console.log('🗑️ Deleted processed data file');
      } catch (e) {
        // File doesn't exist, that's fine
      }
      
      // Delete metadata file
      await fs.unlink(metadataPath);
      console.log('🗑️ Deleted metadata file');
      
      res.json({ message: 'Data file and all related data deleted successfully' });
    } catch (e) {
      // Metadata file doesn't exist, that's fine - return success anyway
      res.json({ message: 'No data file found to delete' });
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
        console.log(`❌ File not found error: ${e.message}`);
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

export default router;
