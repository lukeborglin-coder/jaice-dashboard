import express from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs/promises';
import mammoth from 'mammoth';
import OpenAI from 'openai';
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

// Parse questionnaire from .docx file using AI
async function parseQuestionnaire(filePath, projectId) {
  try {
    // Extract text from .docx file
    const result = await mammoth.extractRawText({ path: filePath });
    const text = result.value;
    
    // Use OpenAI to intelligently parse the questionnaire
    const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    
    const systemPrompt = `You are an expert survey researcher and questionnaire analyst specializing in Forsta/Decipher survey platforms. Your task is to parse questionnaire documents and extract structured question data using comprehensive question type knowledge.

COMPREHENSIVE QUESTION TYPE LIBRARY:
Basic Question Types:
- Single Select: Respondents pick one option (can be one-dimensional or two-dimensional)
- Multi-Select: Respondents pick one or more options (supports exclusive options)
- Dropdown Menu: Drop-down list with up to three dimensions
- Button Single Select: Mobile-friendly button-based single selection
- Single Select Grid: Matrix-style grid with one column selection per row
- Button Single Select Grid: Touch-friendly grid with button selections
- Multi-Select Grid: Grid allowing multiple selections per row/cell
- Button Multi-Select/Grid: Button-based multi-select including grid variants
- Text/Open-Ended: Freeform alphanumeric text input
- Number Question: Numeric values only

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

Guidelines:
- Identify all questions in the document, including their numbers, text, and response options
- Determine the most appropriate Forsta question type from the comprehensive library above
- Extract response options where applicable
- Identify any special tags or instructions (like [SPECIFY], [ANCHOR], [RANDOMIZE])
- Flag questions that need review (incomplete text, missing options, unclear formatting)
- For rating/scale questions, determine appropriate scale ranges and suggest dynamic variants
- Consider mobile-friendly alternatives (Button variants) when appropriate
- Be thorough and accurate in your parsing

Return your analysis as a JSON object with this structure:
{
  "questions": [
    {
      "id": "unique-id",
      "number": "question number (e.g., S1, A1, Q1)",
      "text": "full question text",
      "type": "specific Forsta question type from the library above",
      "options": ["option1", "option2", ...],
      "tags": ["tag1", "tag2", ...],
      "needsReview": true/false,
      "logic": "any skip logic or conditions",
      "suggestedVariants": ["alternative question types that might work better"]
    }
  ]
}`;

    const userPrompt = `Please parse this questionnaire document and extract all questions with their details:

${text}

Analyze the document thoroughly and return the structured data as JSON.`;

    const response = await client.chat.completions.create({
      model: 'gpt-4o',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt }
      ],
      temperature: 0.1,
      response_format: { type: 'json_object' }
    });

    const parsedData = JSON.parse(response.choices[0].message.content);
    
    // Log cost for questionnaire parsing
    const inputTokens = response.usage?.prompt_tokens || 0;
    const outputTokens = response.usage?.completion_tokens || 0;
    
    // Log the cost if we have valid token counts
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
    
    // Add unique IDs and ensure proper formatting
    const questions = parsedData.questions.map((question, index) => ({
      ...question,
      id: question.id || `q-${Date.now()}-${index + 1}`,
      needsReview: question.needsReview || false,
      tags: question.tags || [],
      logic: question.logic || ''
    }));
    
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
    let xml = `  <question id="${question.id}" type="${question.type}">
    <text>${question.text}</text>`;
    
    if (question.options.length > 0) {
      xml += `
    <options>`;
      question.options.forEach((option, index) => {
        const value = option.replace(/[^a-zA-Z0-9]/g, '_').toLowerCase();
        xml += `
      <option value="${value}" code="${index + 1}">${option}</option>`;
      });
      xml += `
    </options>`;
    }
    
    if (question.tags.length > 0) {
      xml += `
    <tags>`;
      question.tags.forEach(tag => {
        xml += `
      <tag>${tag}</tag>`;
      });
      xml += `
    </tags>`;
    }
    
    if (question.logic) {
      xml += `
    <logic>${question.logic}</logic>`;
    }
    
    // Add question attributes based on type
    if (question.type === 'scale') {
      xml += `
    <attributes>
      <min>1</min>
      <max>10</max>
      <step>1</step>
    </attributes>`;
    } else if (question.type === 'open-end') {
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
    <version>1.0</version>
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
- Single Select Grid: Matrix-style grid with one column selection per row
- Button Single Select Grid: Touch-friendly grid with button selections
- Multi-Select Grid: Grid allowing multiple selections per row/cell
- Button Multi-Select/Grid: Button-based multi-select including grid variants
- Text/Open-Ended: Freeform alphanumeric text input
- Number Question: Numeric values only

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
- Single Select Grid: Matrix-style grid with one column selection per row
- Button Single Select Grid: Touch-friendly grid with button selections
- Multi-Select Grid: Grid allowing multiple selections per row/cell
- Button Multi-Select/Grid: Button-based multi-select including grid variants
- Text/Open-Ended: Freeform alphanumeric text input
- Number Question: Numeric values only

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

export default router;
