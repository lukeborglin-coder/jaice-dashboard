import express from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import XLSX from 'xlsx';
import OpenAI from 'openai';
import { authenticateToken, requireCognitiveOrAdmin } from '../middleware/auth.middleware.mjs';
import { logCost, COST_CATEGORIES } from '../services/costTracking.service.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const router = express.Router();

// Apply authentication middleware to all routes
router.use(authenticateToken);
router.use(requireCognitiveOrAdmin);

// Configure multer for file uploads
const filesDir = process.env.FILES_DIR || path.join(__dirname, '../data/uploads');
if (!fs.existsSync(filesDir)) {
  fs.mkdirSync(filesDir, { recursive: true });
}

const storage = multer.diskStorage({
  destination: filesDir,
  filename: (req, file, cb) => {
    const timestamp = Date.now();
    const ext = path.extname(file.originalname);
    cb(null, `openend_${timestamp}${ext}`);
  }
});

const fileFilter = (req, file, cb) => {
  const allowedTypes = [
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', // .xlsx
    'application/vnd.ms-excel', // .xls
    'text/csv' // .csv
  ];

  if (allowedTypes.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new Error('Invalid file type. Please upload an Excel (.xlsx, .xls) or CSV file.'), false);
  }
};

const upload = multer({
  storage,
  fileFilter,
  limits: { fileSize: 10 * 1024 * 1024 } // 10MB limit
});

// Initialize OpenAI
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

// Helper function to parse Excel/CSV file
function parseFile(filePath) {
  const workbook = XLSX.readFile(filePath);
  const sheetName = workbook.SheetNames[0];
  const worksheet = workbook.Sheets[sheetName];
  const data = XLSX.utils.sheet_to_json(worksheet, { header: 1, defval: '' });

  if (data.length < 2) {
    throw new Error('File must contain at least a header row and one data row');
  }

  const headers = data[0];
  const rows = data.slice(1).filter(row => row.some(cell => cell !== ''));

  return { headers, rows };
}

// Helper function to generate themes using AI
async function generateThemesForQuestion(question, responses, userId) {
  // Filter out empty responses
  const validResponses = responses.filter(r => r && r.trim() !== '');

  if (validResponses.length === 0) {
    return { themes: [], codes: {} };
  }

  // Sample responses if there are too many (to fit in context)
  const maxSampleSize = 200;
  const sampledResponses = validResponses.length > maxSampleSize
    ? validResponses.slice(0, maxSampleSize)
    : validResponses;

  const prompt = `You are analyzing open-ended survey responses for the following question:
"${question}"

Here are the responses (${validResponses.length} total, showing ${sampledResponses.length}):
${sampledResponses.map((r, i) => `${i + 1}. ${r}`).join('\n')}

IMPORTANT: First, carefully read the question to understand what is being asked:

1. If the question asks for SPECIFIC ITEMS (e.g., "Which medicines...", "What brands...", "Which products...", "What companies...", etc.):
   - Create themes based on the ACTUAL SPECIFIC ITEMS mentioned in responses (e.g., "Evrysdi", "Zolgensma", "Spinraza")
   - Use the most common/correct spelling for each item as the theme name
   - Group misspellings and variations together (e.g., "Eversdi", "Evrysdy", "Evrysdi" should all be one theme: "Evrysdi")
   - DO NOT use abstract categories like "Common treatments" or "Gene therapy" - use the specific item names

2. If the question asks for OPINIONS, EXPERIENCES, or OPEN-ENDED THOUGHTS:
   - Create thematic categories that capture the main ideas (e.g., "High Cost", "Quality Concerns", "Positive Experience")
   - Group similar sentiments and concepts together

Requirements:
- Create between 5-15 themes that cover the major patterns in the data
- Each theme should have a clear, descriptive name
- For categorical questions: use specific item names (with correct spelling)
- For thematic questions: use conceptual categories
- Responses can be coded to multiple themes if they mention multiple items/concepts
- Return the themes as a JSON array of objects with format: [{"code": 1, "theme": "Theme Name", "description": "Brief description"}]

Return ONLY valid JSON, no other text.`;

  const completion = await openai.chat.completions.create({
    model: 'gpt-4o',
    messages: [
      { role: 'system', content: 'You are an expert qualitative researcher who creates coding schemes for open-ended survey data. When the question asks for specific items (medicines, brands, products, etc.), identify and group those specific items, handling misspellings. When the question asks for opinions or experiences, create thematic categories. Always respond with valid JSON only.' },
      { role: 'user', content: prompt }
    ],
    temperature: 0.2,
  });

  const content = completion.choices[0].message.content;
  const tokens = completion.usage.total_tokens;
  const cost = (completion.usage.prompt_tokens * 0.0025 / 1000) + (completion.usage.completion_tokens * 0.01 / 1000);

  // Log cost
  await logCost(COST_CATEGORIES.contentAnalysis, tokens, cost, userId);

  // Parse JSON response
  let themes;
  try {
    themes = JSON.parse(content);
  } catch (e) {
    // Try to extract JSON from response
    const jsonMatch = content.match(/\[[\s\S]*\]/);
    if (jsonMatch) {
      themes = JSON.parse(jsonMatch[0]);
    } else {
      throw new Error('Failed to parse AI response as JSON');
    }
  }

  return { themes, totalTokens: tokens, totalCost: cost };
}

// Helper function to code responses using AI
async function codeResponses(question, themes, responses, userId) {
  const validResponseIndices = responses
    .map((r, idx) => ({ response: r, originalIndex: idx }))
    .filter(item => item.response && item.response.trim() !== '');

  if (validResponseIndices.length === 0) {
    return { codes: {}, totalTokens: 0, totalCost: 0 };
  }

  // Process in batches to avoid token limits
  const batchSize = 50;
  const batches = [];
  for (let i = 0; i < validResponseIndices.length; i += batchSize) {
    batches.push(validResponseIndices.slice(i, i + batchSize));
  }

  const allCodes = {};
  let totalTokens = 0;
  let totalCost = 0;

  for (const batch of batches) {
    const themesText = themes.map(t => `${t.code}: ${t.theme} - ${t.description || ''}`).join('\n');

    const prompt = `You are coding open-ended survey responses for the question:
"${question}"

Available codes/themes:
${themesText}

Please assign one or more codes to each response below. A response can have multiple codes if it mentions multiple themes.

Responses to code:
${batch.map((item, i) => `${i + 1}. ${item.response}`).join('\n')}

Return a JSON object where keys are the response numbers (1, 2, 3...) and values are arrays of code numbers that apply to that response.
Format: {"1": [1, 3], "2": [2], "3": [1, 2, 4], ...}

Return ONLY valid JSON, no other text.`;

    const completion = await openai.chat.completions.create({
      model: 'gpt-4o',
      messages: [
        { role: 'system', content: 'You are an expert qualitative researcher who codes open-ended survey responses. Always respond with valid JSON only.' },
        { role: 'user', content: prompt }
      ],
      temperature: 0.1,
    });

    const content = completion.choices[0].message.content;
    const tokens = completion.usage.total_tokens;
    const cost = (completion.usage.prompt_tokens * 0.0025 / 1000) + (completion.usage.completion_tokens * 0.01 / 1000);

    totalTokens += tokens;
    totalCost += cost;

    // Log cost
    await logCost(COST_CATEGORIES.contentAnalysis, tokens, cost, userId);

    // Parse JSON response
    let batchCodes;
    try {
      batchCodes = JSON.parse(content);
    } catch (e) {
      // Try to extract JSON from response
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        batchCodes = JSON.parse(jsonMatch[0]);
      } else {
        throw new Error('Failed to parse AI coding response as JSON');
      }
    }

    // Map batch indices back to original indices
    Object.keys(batchCodes).forEach(key => {
      const batchIdx = parseInt(key) - 1;
      const originalIdx = batch[batchIdx].originalIndex;
      allCodes[originalIdx] = batchCodes[key];
    });
  }

  return { codes: allCodes, totalTokens, totalCost };
}

// Main endpoint for processing open-ended data
router.post('/process', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    const filePath = req.file.path;
    const userId = req.user.id;

    // Parse the file
    const { headers, rows } = parseFile(filePath);

    if (headers.length < 2) {
      return res.status(400).json({ error: 'File must have at least 2 columns (ID and one question)' });
    }

    const idColumn = headers[0];
    const questionColumns = headers.slice(1);

    // Process each question column
    const results = {
      idColumn,
      questions: [],
      totalTokens: 0,
      totalCost: 0
    };

    for (let qIdx = 0; qIdx < questionColumns.length; qIdx++) {
      const question = questionColumns[qIdx];
      const columnIdx = qIdx + 1; // +1 because first column is ID

      // Extract responses for this question
      const responses = rows.map(row => row[columnIdx] || '');

      console.log(`Processing question ${qIdx + 1}/${questionColumns.length}: ${question}`);

      // Generate themes
      const { themes, totalTokens: themeTokens, totalCost: themeCost } =
        await generateThemesForQuestion(question, responses, userId);

      results.totalTokens += themeTokens || 0;
      results.totalCost += themeCost || 0;

      // Code responses
      const { codes, totalTokens: codeTokens, totalCost: codeCost } =
        await codeResponses(question, themes, responses, userId);

      results.totalTokens += codeTokens || 0;
      results.totalCost += codeCost || 0;

      // Calculate frequencies
      const frequencies = {};
      themes.forEach(t => {
        frequencies[t.code] = 0;
      });

      Object.values(codes).forEach(codesArray => {
        codesArray.forEach(code => {
          frequencies[code] = (frequencies[code] || 0) + 1;
        });
      });

      const totalResponses = Object.keys(codes).length;

      const frequencyTable = themes.map(t => ({
        code: t.code,
        theme: t.theme,
        frequency: frequencies[t.code] || 0,
        percentage: totalResponses > 0
          ? ((frequencies[t.code] || 0) / totalResponses * 100).toFixed(1)
          : '0.0'
      }));

      // Build raw data table
      const rawData = rows.map((row, idx) => ({
        respondentId: row[0] || '',
        response: row[columnIdx] || '',
        codes: codes[idx] || []
      }));

      results.questions.push({
        question,
        themes,
        frequencyTable,
        rawData
      });
    }

    // Clean up uploaded file
    fs.unlinkSync(filePath);

    res.json(results);

  } catch (error) {
    console.error('Error processing open-ended data:', error);

    // Clean up file if it exists
    if (req.file && fs.existsSync(req.file.path)) {
      fs.unlinkSync(req.file.path);
    }

    res.status(500).json({
      error: 'Failed to process file',
      details: error.message
    });
  }
});

export default router;
