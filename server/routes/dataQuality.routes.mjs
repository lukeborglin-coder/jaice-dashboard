import express from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs/promises';
import XLSX from 'xlsx';
import { fileURLToPath } from 'url';
import { authenticateToken, requireCognitiveOrAdmin } from '../middleware/auth.middleware.mjs';
import * as storage from '../services/dataQuality.storage.mjs';
import * as models from '../services/dataQuality.models.mjs';
import * as qaRunner from '../services/qaEngine.runner.mjs';

const router = express.Router();
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dataRoot = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
const filesDir = process.env.FILES_DIR || path.join(dataRoot, 'uploads');

// Enforce auth for all endpoints
router.use(authenticateToken, requireCognitiveOrAdmin);

// Multer setup for data file uploads
const dataFileStorage = multer.diskStorage({
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
    cb(null, `qa_data_${timestamp}${ext}`);
  }
});

const dataFileFilter = (req, file, cb) => {
  const allowedTypes = [
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', // .xlsx
    'application/vnd.ms-excel', // .xls
    'text/csv' // .csv
  ];
  if (allowedTypes.includes(file.mimetype) || 
      file.originalname.match(/\.(xlsx|xls|csv)$/i)) {
    cb(null, true);
  } else {
    cb(new Error('Invalid file type. Only Excel (.xlsx, .xls) and CSV files are allowed.'), false);
  }
};

const upload = multer({
  storage: dataFileStorage,
  fileFilter: dataFileFilter,
  limits: { fileSize: 50 * 1024 * 1024 } // 50MB limit
});

// Helper to load questionnaire questions
async function loadQuestionnaireQuestions(projectId) {
  try {
    const questionnairesPath = path.join(dataRoot, 'questionnaires.json');
    const questionnairesData = await fs.readFile(questionnairesPath, 'utf-8');
    const questionnaires = JSON.parse(questionnairesData);
    
    // Find questionnaire for this project
    for (const userId in questionnaires) {
      const userQuestionnaires = questionnaires[userId] || [];
      const qnr = userQuestionnaires.find((q) => q.projectId === projectId);
      if (qnr && qnr.questions) {
        return qnr.questions;
      }
    }
    
    return null;
  } catch (error) {
    console.error('Error loading questionnaire:', error);
    return null;
  }
}

// Helper to load column mapping
async function loadColumnMapping(questionnaireId) {
  try {
    const metadataPath = path.join(dataRoot, 'questionnaire-data', questionnaireId, 'metadata.json');
    const metadataContent = await fs.readFile(metadataPath, 'utf-8');
    const metadata = JSON.parse(metadataContent);
    return metadata.columnMapping || {};
  } catch (error) {
    return {}; // Return empty mapping if not found
  }
}

// GET /api/data-quality/:projectId/plan - Get quality plan
router.get('/:projectId/plan', async (req, res) => {
  try {
    const { projectId } = req.params;
    const plan = await storage.loadQualityPlan(projectId);
    
    if (!plan) {
      return res.status(404).json({ error: 'Quality plan not found' });
    }
    
    res.json(plan);
  } catch (error) {
    console.error('Error loading quality plan:', error);
    res.status(500).json({ error: 'Failed to load quality plan' });
  }
});

// POST /api/data-quality/:projectId/plan - Create/update quality plan
router.post('/:projectId/plan', async (req, res) => {
  try {
    const { projectId } = req.params;
    const planData = req.body;
    
    if (!planData.projectId) {
      planData.projectId = projectId;
    }
    
    const savedPlan = await storage.saveQualityPlan(projectId, planData);
    res.json(savedPlan);
  } catch (error) {
    console.error('Error saving quality plan:', error);
    res.status(500).json({ error: 'Failed to save quality plan' });
  }
});

// PUT /api/data-quality/:projectId/plan/rules/:ruleId - Update a specific rule
router.put('/:projectId/plan/rules/:ruleId', async (req, res) => {
  try {
    const { projectId, ruleId } = req.params;
    const ruleData = req.body;
    
    const plan = await storage.loadQualityPlan(projectId);
    if (!plan) {
      return res.status(404).json({ error: 'Quality plan not found' });
    }
    
    const ruleIndex = plan.rules.findIndex((r) => r.id === ruleId);
    if (ruleIndex === -1) {
      return res.status(404).json({ error: 'Rule not found' });
    }
    
    plan.rules[ruleIndex] = { ...plan.rules[ruleIndex], ...ruleData, id: ruleId };
    const savedPlan = await storage.saveQualityPlan(projectId, plan);
    
    res.json(savedPlan.rules[ruleIndex]);
  } catch (error) {
    console.error('Error updating rule:', error);
    res.status(500).json({ error: 'Failed to update rule' });
  }
});

// DELETE /api/data-quality/:projectId/plan/rules/:ruleId - Delete a rule
router.delete('/:projectId/plan/rules/:ruleId', async (req, res) => {
  try {
    const { projectId, ruleId } = req.params;
    
    const plan = await storage.loadQualityPlan(projectId);
    if (!plan) {
      return res.status(404).json({ error: 'Quality plan not found' });
    }
    
    plan.rules = plan.rules.filter((r) => r.id !== ruleId);
    await storage.saveQualityPlan(projectId, plan);
    
    res.json({ success: true });
  } catch (error) {
    console.error('Error deleting rule:', error);
    res.status(500).json({ error: 'Failed to delete rule' });
  }
});

// POST /api/data-quality/:projectId/plan/generate - Generate plan from questionnaire
router.post('/:projectId/plan/generate', async (req, res) => {
  try {
    const { projectId } = req.params;
    const { questionnaireId } = req.body;
    
    // Load questionnaire questions
    let questions = null;
    if (questionnaireId) {
      try {
        const questionnairesPath = path.join(dataRoot, 'questionnaires.json');
        const questionnairesData = await fs.readFile(questionnairesPath, 'utf-8');
        const questionnaires = JSON.parse(questionnairesData);
        
        for (const userId in questionnaires) {
          const userQuestionnaires = questionnaires[userId] || [];
          const qnr = userQuestionnaires.find((q) => q.id === questionnaireId);
          if (qnr && qnr.questions) {
            questions = qnr.questions;
            break;
          }
        }
      } catch (error) {
        console.error('Error loading questionnaire:', error);
      }
    }
    
    if (!questions) {
      questions = await loadQuestionnaireQuestions(projectId);
    }
    
    if (!questions || questions.length === 0) {
      return res.status(404).json({ error: 'Questionnaire questions not found' });
    }
    
    // Generate rules for each question
    const rules = [];
    questions.forEach((question) => {
      const questionType = question.type || '';
      const qNum = question.number || question.id;
      
      // Determine which check types apply
      const checkTypes = models.getCheckTypesForQuestionType(questionType);
      
      checkTypes.forEach((checkType) => {
        // Only auto-generate for certain types
        if (checkType.id === 'open_end' && questionType.toLowerCase().includes('open end')) {
          const rule = models.createDefaultQualityRule(question, checkType.id);
          rules.push(rule);
        } else if (checkType.id === 'straightlining' && 
                   (questionType.toLowerCase().includes('grid') || 
                    questionType.toLowerCase().includes('scale'))) {
          const rule = models.createDefaultQualityRule(question, checkType.id);
          rules.push(rule);
        }
      });
    });
    
    // Create or update quality plan
    let plan = await storage.loadQualityPlan(projectId);
    if (!plan) {
      plan = models.createDefaultQualityPlan(projectId);
    }
    
    // Merge with existing rules (don't duplicate)
    const existingRuleIds = new Set(plan.rules.map((r) => r.id));
    const newRules = rules.filter((r) => !existingRuleIds.has(r.id));
    plan.rules = [...plan.rules, ...newRules];
    plan.lastGeneratedFromQuestionnaireAt = new Date().toISOString();
    
    const savedPlan = await storage.saveQualityPlan(projectId, plan);
    
    res.json({
      plan: savedPlan,
      generated: newRules.length,
      total: savedPlan.rules.length
    });
  } catch (error) {
    console.error('Error generating quality plan:', error);
    res.status(500).json({ error: 'Failed to generate quality plan' });
  }
});

// POST /api/data-quality/:projectId/data/upload - Upload data file
router.post('/:projectId/data/upload', upload.single('file'), async (req, res) => {
  try {
    const { projectId } = req.params;
    const { questionnaireId } = req.body;
    
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }
    
    // Load quality plan to determine which columns we need
    const plan = await storage.loadQualityPlan(projectId);
    if (!plan || !plan.rules || plan.rules.length === 0) {
      return res.status(400).json({ error: 'No quality plan found. Please create a quality plan first.' });
    }
    
    // Load column mapping if questionnaireId provided
    let columnMapping = {};
    if (questionnaireId) {
      columnMapping = await loadColumnMapping(questionnaireId);
    }
    
    // Load questionnaire questions to get expected headers
    let questions = null;
    if (questionnaireId) {
      try {
        const questionnairesPath = path.join(dataRoot, 'questionnaires.json');
        const questionnairesData = await fs.readFile(questionnairesPath, 'utf-8');
        const questionnaires = JSON.parse(questionnairesData);
        
        for (const userId in questionnaires) {
          const userQuestionnaires = questionnaires[userId] || [];
          const qnr = userQuestionnaires.find((q) => q.id === questionnaireId);
          if (qnr && qnr.questions) {
            questions = qnr.questions;
            break;
          }
        }
      } catch (error) {
        console.error('Error loading questionnaire:', error);
      }
    }
    
    // Parse file
    const filePath = req.file.path;
    const workbook = XLSX.readFile(filePath);
    const sheetName = workbook.SheetNames[0];
    const worksheet = workbook.Sheets[sheetName];
    const rawData = XLSX.utils.sheet_to_json(worksheet, { defval: null });
    
    // Determine which columns we need based on quality plan rules
    const neededColumns = new Set(['RESPNO', 'respno', 'record', 'Record', 'RESPONO', 'respono']);
    
    plan.rules.forEach((rule) => {
      const questionId = rule.questionId || rule.questionNumber;
      // Add columns for this question (simplified - would need full variable mapping in production)
      neededColumns.add(`Q${questionId}`);
      neededColumns.add(`QA${questionId}`);
      neededColumns.add(questionId);
    });
    
    // Extract RESPNO and needed columns
    const dataRows = [];
    rawData.forEach((row) => {
      const respno = row['RESPNO'] || row['respno'] || row['record'] || row['Record'] || 
                     row['RESPONO'] || row['respono'] || null;
      
      if (!respno) {
        return; // Skip rows without RESPNO
      }
      
      const columns = {};
      neededColumns.forEach((col) => {
        if (row.hasOwnProperty(col)) {
          columns[col] = row[col];
        }
      });
      
      // Also include any columns that match the question IDs in rules
      Object.keys(row).forEach((col) => {
        const colLower = col.toLowerCase();
        plan.rules.forEach((rule) => {
          const qIdLower = String(rule.questionId || rule.questionNumber).toLowerCase().replace(/^q/, '');
          if (colLower.includes(qIdLower)) {
            columns[col] = row[col];
          }
        });
      });
      
      dataRows.push({
        respno: String(respno),
        columns
      });
    });
    
    // Save QA data
    await storage.saveQAData(projectId, dataRows);
    
    // Clean up temp file
    await fs.unlink(filePath).catch(() => {});
    
    res.json({
      success: true,
      rowsProcessed: dataRows.length,
      columnsExtracted: neededColumns.size
    });
  } catch (error) {
    console.error('Error uploading data:', error);
    res.status(500).json({ error: 'Failed to upload data' });
  }
});

// GET /api/data-quality/:projectId/data - Get QA data (paginated)
router.get('/:projectId/data', async (req, res) => {
  try {
    const { projectId } = req.params;
    const { page = 1, limit = 50 } = req.query;
    
    const qaData = await storage.loadQAData(projectId);
    const dataArray = Object.values(qaData);
    
    const start = (parseInt(page) - 1) * parseInt(limit);
    const end = start + parseInt(limit);
    const paginatedData = dataArray.slice(start, end);
    
    res.json({
      data: paginatedData,
      total: dataArray.length,
      page: parseInt(page),
      limit: parseInt(limit),
      totalPages: Math.ceil(dataArray.length / parseInt(limit))
    });
  } catch (error) {
    console.error('Error loading QA data:', error);
    res.status(500).json({ error: 'Failed to load QA data' });
  }
});

// POST /api/data-quality/:projectId/qa/run - Run QA checks
router.post('/:projectId/qa/run', async (req, res) => {
  try {
    const { projectId } = req.params;
    const { respondentIds, force = false, questionnaireId } = req.body;
    
    // Load questionnaire questions if provided
    let questionnaireQuestions = null;
    if (questionnaireId) {
      try {
        const questionnairesPath = path.join(dataRoot, 'questionnaires.json');
        const questionnairesData = await fs.readFile(questionnairesPath, 'utf-8');
        const questionnaires = JSON.parse(questionnairesData);
        
        for (const userId in questionnaires) {
          const userQuestionnaires = questionnaires[userId] || [];
          const qnr = userQuestionnaires.find((q) => q.id === questionnaireId);
          if (qnr && qnr.questions) {
            questionnaireQuestions = qnr.questions;
            break;
          }
        }
      } catch (error) {
        console.error('Error loading questionnaire:', error);
      }
    }
    
    if (!questionnaireQuestions) {
      questionnaireQuestions = await loadQuestionnaireQuestions(projectId);
    }
    
    const result = await qaRunner.runQAForRespondents(
      projectId,
      respondentIds,
      {
        force,
        questionnaireQuestions
      }
    );
    
    res.json(result);
  } catch (error) {
    console.error('Error running QA:', error);
    res.status(500).json({ error: error.message || 'Failed to run QA checks' });
  }
});

// GET /api/data-quality/:projectId/qa/results - Get QA results
router.get('/:projectId/qa/results', async (req, res) => {
  try {
    const { projectId } = req.params;
    const { category, checkType, page = 1, limit = 50 } = req.query;
    
    const results = await storage.loadQAResults(projectId);
    let resultsArray = Object.values(results);
    
    // Apply filters
    if (category) {
      resultsArray = resultsArray.filter((r) => r.category === category);
    }
    
    if (checkType) {
      resultsArray = resultsArray.filter((r) =>
        r.flags?.some((f) => f.checkTypeId === checkType)
      );
    }
    
    // Paginate
    const start = (parseInt(page) - 1) * parseInt(limit);
    const end = start + parseInt(limit);
    const paginatedResults = resultsArray.slice(start, end);
    
    // Calculate summary stats
    const total = resultsArray.length;
    const byCategory = {
      good: resultsArray.filter((r) => r.category === 'good').length,
      questionable: resultsArray.filter((r) => r.category === 'questionable').length,
      remove: resultsArray.filter((r) => r.category === 'remove').length
    };
    
    res.json({
      results: paginatedResults,
      total,
      page: parseInt(page),
      limit: parseInt(limit),
      totalPages: Math.ceil(total / parseInt(limit)),
      summary: {
        byCategory,
        percentages: {
          good: total > 0 ? ((byCategory.good / total) * 100).toFixed(1) : '0.0',
          questionable: total > 0 ? ((byCategory.questionable / total) * 100).toFixed(1) : '0.0',
          remove: total > 0 ? ((byCategory.remove / total) * 100).toFixed(1) : '0.0'
        }
      }
    });
  } catch (error) {
    console.error('Error loading QA results:', error);
    res.status(500).json({ error: 'Failed to load QA results' });
  }
});

// PUT /api/data-quality/:projectId/qa/results/:respno - Update respondent status
router.put('/:projectId/qa/results/:respno', async (req, res) => {
  try {
    const { projectId, respno } = req.params;
    const { category, statusLocked, score } = req.body;
    
    const results = await storage.loadQAResults(projectId);
    const existing = results[respno];
    
    if (!existing) {
      return res.status(404).json({ error: 'QA result not found' });
    }
    
    const updated = {
      ...existing,
      category: category !== undefined ? category : existing.category,
      statusLocked: statusLocked !== undefined ? statusLocked : existing.statusLocked,
      score: score !== undefined ? score : existing.score,
      updatedAt: new Date().toISOString()
    };
    
    await storage.saveQAResults(projectId, updated);
    
    res.json(updated);
  } catch (error) {
    console.error('Error updating QA result:', error);
    res.status(500).json({ error: 'Failed to update QA result' });
  }
});

export default router;


