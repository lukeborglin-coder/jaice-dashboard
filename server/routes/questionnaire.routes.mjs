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
    
    const systemPrompt = `You are a Forsta/Decipher questionnaire expert. Parse questionnaires with EXACT fidelity to programming logic.

CRITICAL PARSING RULES:

1. PROGRAMMING NOTES (ALL CAPS TEXT):
   - "ASK IF [condition]" → showLogic: "[condition]"
   - "SHOW IF [condition]" → showLogic: "[condition]"  
   - "TERMINATE IF [condition]" → terminateLogic: "[condition]"
   - "RANDOMIZE" → randomize: true
   - "RANGE: X-Y" → validation: {type: "range", min: X, max: Y}
   - "MUST = 100%" → validation: {type: "sum", value: 100, unit: "%"}

2. GRID DETECTION:
   Look for patterns like:
   - Multiple columns with headers
   - Row labels on the left
   - Codes like "r1c2" (row 1, column 2)
   - "AUTOFILL SUM OF..." → autofill calculation
   - "DO NOT SHOW COLUMN" → hidden column for calculations

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

OUTPUT STRUCTURE:
Return enhanced JSON with all logic preserved.`;

    const userPrompt = `Please parse this questionnaire document and extract all questions with their details:

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
      "options": ["option1", "option2", ...],
      "showLogic": "condition for showing this question (if present)",
      "randomize": true/false,
      "tags": ["tag1", "tag2"],
      "needsReview": true/false,
      "logic": "any skip logic or conditions"
    }
  ]
}

IMPORTANT: Return ONLY valid JSON. Do not include any explanatory text outside the JSON object.`;

    const response = await client.chat.completions.create({
      model: 'gpt-4o',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt }
      ],
      temperature: 0.1,
      response_format: { type: 'json_object' }
    });

    let parsedData;
    try {
      parsedData = JSON.parse(response.choices[0].message.content);
    } catch (parseError) {
      console.error('JSON Parse Error:', parseError);
      console.error('Raw response:', response.choices[0].message.content);
      
      // Try to extract JSON from the response if it's wrapped in text
      const content = response.choices[0].message.content;
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        try {
          parsedData = JSON.parse(jsonMatch[0]);
        } catch (secondError) {
          throw new Error('Failed to parse JSON response from AI. Raw content: ' + content.substring(0, 500));
        }
      } else {
        throw new Error('No valid JSON found in AI response. Raw content: ' + content.substring(0, 500));
      }
    }
    
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
      showLogic: question.showLogic || null,
      randomize: question.randomize || false,
      // Handle legacy logic field for backward compatibility
      logic: question.logic || question.showLogic || ''
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
    } else if (question.type === 'open-end' || question.type === 'Text/Open-Ended') {
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
      
      if (question.type === 'Text/Open-Ended' && !question.validation) {
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
