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

// Helper to load the latest questionnaire for a project (with id + questions)
async function loadLatestQuestionnaireForProject(projectId) {
  try {
    const questionnairesPath = path.join(dataRoot, 'questionnaires.json');
    const questionnairesData = await fs.readFile(questionnairesPath, 'utf-8');
    const questionnaires = JSON.parse(questionnairesData) || {};

    // Primary format: questionnaires[projectId] = Questionnaire[]
    const list = Array.isArray(questionnaires[projectId]) ? questionnaires[projectId] : [];
    if (list.length > 0) {
      const sorted = [...list].sort((a, b) => new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime());
      return sorted[0] || null;
    }

    // Fallback: search all keys for a questionnaire that matches projectId
    let found = [];
    Object.values(questionnaires).forEach((arr) => {
      if (!Array.isArray(arr)) return;
      arr.forEach((qnr) => {
        if (qnr?.projectId === projectId) found.push(qnr);
      });
    });
    if (found.length === 0) return null;
    found.sort((a, b) => new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime());
    return found[0] || null;
  } catch (error) {
    return null;
  }
}

// Prefer a questionnaire that has an existing, non-empty columnMapping saved (from Tabs mapping).
async function loadBestQuestionnaireForProject(projectId) {
  const qnr = await loadLatestQuestionnaireForProject(projectId);
  if (!qnr) return { qnr: null, columnMapping: {} };

  // Get candidate list (same logic as loadLatestQuestionnaireForProject, but keep the full sorted list)
  let list = [];
  try {
    const questionnairesPath = path.join(dataRoot, 'questionnaires.json');
    const questionnairesData = await fs.readFile(questionnairesPath, 'utf-8');
    const questionnaires = JSON.parse(questionnairesData) || {};
    list = Array.isArray(questionnaires[projectId]) ? questionnaires[projectId] : [];
  } catch {}

  const candidates = (list.length ? list : [qnr]).sort(
    (a, b) => new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime()
  );

  for (const candidate of candidates) {
    if (!candidate?.id) continue;
    const mapping = await loadColumnMapping(candidate.id);
    if (mapping && Object.keys(mapping).length > 0) {
      return { qnr: candidate, columnMapping: mapping };
    }
  }

  // fallback: latest questionnaire with empty mapping
  return { qnr: candidates[0] || qnr, columnMapping: {} };
}

function normalizeBaseQuestionNumber(value) {
  return String(value || '').trim().replace(/^Q/i, '');
}

function buildExpectedHeadersForRule(rule, questionnaireQuestions = []) {
  if (!rule || !rule.checkTypeId) return [];

  // Speeding is global and uses qtime, not QNR variables
  if (rule.checkTypeId === 'speeding') {
    return ['qtime'];
  }

  const rawId = rule.questionId || rule.questionNumber;
  const base = normalizeBaseQuestionNumber(rawId);
  if (!base) return [];

  const matchingQuestion = (questionnaireQuestions || []).find((q) => {
    const qNum = q?.number || q?.id;
    return normalizeBaseQuestionNumber(qNum).toLowerCase() === base.toLowerCase();
  });

  const typeLower = String(matchingQuestion?.type || '').toLowerCase();

  // Open end list: multiple columns (usually c1, c2, ...)
  if (typeLower.includes('open end') && typeLower.includes('list')) {
    const responseOptions = Array.isArray(matchingQuestion?.responseOptions) ? matchingQuestion.responseOptions : [];
    if (responseOptions.length > 0) {
      return responseOptions.map((opt) => {
        const code = String(opt?.code || '').trim();
        const normalized = /^c\d+/i.test(code) ? code : `c${code}`;
        return `Q${base}${normalized}`;
      });
    }
    return [`Q${base}`];
  }

  // Grid questions (straightlining uses rows)
  if (rule.checkTypeId === 'straightlining' || typeLower.includes('grid')) {
    const statementOptions = Array.isArray(matchingQuestion?.statementOptions) ? matchingQuestion.statementOptions : [];
    if (statementOptions.length > 0) {
      return statementOptions.map((opt) => {
        const code = String(opt?.code || '').trim();
        const normalized = /^r\d+/i.test(code) ? code : `r${code}`;
        return `Q${base}${normalized}`;
      });
    }
    return [`Q${base}`];
  }

  // Default single-column question
  return [`Q${base}`];
}

function getRowValueCaseInsensitive(row, header) {
  if (!row || !header) return undefined;
  if (Object.prototype.hasOwnProperty.call(row, header)) return row[header];
  const target = String(header).toLowerCase().trim();
  const key = Object.keys(row).find((k) => String(k).toLowerCase().trim() === target);
  return key ? row[key] : undefined;
}

function normalizeHeaderKey(value) {
  return String(value || '')
    .toLowerCase()
    .trim()
    .replace(/[\s_]+/g, ''); // remove spaces/underscores for loose matching
}

function getRowValueLoose(row, header) {
  if (!row || !header) return undefined;

  // 1) Exact / case-insensitive
  const exact = getRowValueCaseInsensitive(row, header);
  if (exact !== undefined) return exact;

  // 2) Normalized match (handles underscores/spaces differences)
  const target = normalizeHeaderKey(header);
  if (!target) return undefined;
  const key = Object.keys(row).find((k) => normalizeHeaderKey(k) === target);
  return key ? row[key] : undefined;
}

function getObjValueLoose(obj, key) {
  if (!obj || !key) return undefined;
  if (Object.prototype.hasOwnProperty.call(obj, key)) return obj[key];
  const target = normalizeHeaderKey(key);
  if (!target) return undefined;
  const foundKey = Object.keys(obj).find((k) => normalizeHeaderKey(k) === target);
  return foundKey ? obj[foundKey] : undefined;
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

// POST /api/data-quality/:projectId/plan/rules - Add a new rule
router.post('/:projectId/plan/rules', async (req, res) => {
  try {
    const { projectId } = req.params;
    const ruleData = req.body;
    
    let plan = await storage.loadQualityPlan(projectId);
    if (!plan) {
      plan = models.createDefaultQualityPlan(projectId);
    }
    
    const newRule = {
      id: `rule-${Date.now()}`,
      ...ruleData,
      createdAt: new Date().toISOString()
    };
    
    plan.rules.push(newRule);
    const savedPlan = await storage.saveQualityPlan(projectId, plan);
    
    res.json(newRule);
  } catch (error) {
    console.error('Error adding rule:', error);
    res.status(500).json({ error: 'Failed to add rule' });
  }
});

// PUT /api/data-quality/:projectId/plan/settings - Update global settings
router.put('/:projectId/plan/settings', async (req, res) => {
  try {
    const { projectId } = req.params;
    const { globalAggressiveness, expectedLOI } = req.body;
    
    let plan = await storage.loadQualityPlan(projectId);
    if (!plan) {
      plan = models.createDefaultQualityPlan(projectId);
    }
    
    if (globalAggressiveness) {
      plan.globalAggressiveness = {
        ...plan.globalAggressiveness,
        ...globalAggressiveness
      };
    }
    
    // Update expected LOI (in minutes) for speeding checks
    if (expectedLOI !== undefined) {
      plan.expectedLOI = expectedLOI === '' || expectedLOI === null ? null : parseFloat(expectedLOI);
    }
    
    const savedPlan = await storage.saveQualityPlan(projectId, plan);
    
    res.json(savedPlan);
  } catch (error) {
    console.error('Error updating settings:', error);
    res.status(500).json({ error: 'Failed to update settings' });
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
    const newRules = [];
    
    // Always add a global speeding rule (not question-specific)
    // Speeding uses the `qtime` column (seconds) and compares against expected LOI.
    newRules.push({
      id: `GLOBAL_speeding_${Date.now()}`,
      questionId: 'qtime',
      questionNumber: 'qtime',
      questionText: 'Completion time (seconds)',
      questionType: 'numeric',
      checkTypeId: 'speeding',
      settings: {},
      enabled: true
    });
    
    questions.forEach((question) => {
      const questionType = question.type || '';
      
      // Determine which check types apply
      const checkTypes = models.getCheckTypesForQuestionType(questionType);
      
      checkTypes.forEach((checkType) => {
        // Only auto-generate for certain types
        if (checkType.id === 'open_end' && questionType.toLowerCase().includes('open end')) {
          const rule = models.createDefaultQualityRule(question, checkType.id);
          newRules.push(rule);
        } else if (checkType.id === 'straightlining' && 
                   questionType.toLowerCase().includes('single select grid')) {
          // Only single select grids for straightlining (not multi-select)
          const rule = models.createDefaultQualityRule(question, checkType.id);
          newRules.push(rule);
        } else if (checkType.id === 'straightlining' && 
                   questionType.toLowerCase().includes('numeric grid')) {
          const rule = models.createDefaultQualityRule(question, checkType.id);
          newRules.push(rule);
        }
      });
    });
    
    // Create or update quality plan
    let plan = await storage.loadQualityPlan(projectId);
    if (!plan) {
      plan = models.createDefaultQualityPlan(projectId);
    }
    
    // Build a set of keys for the newly generated rules
    const newRuleKeys = new Set(newRules.map((r) => `${r.questionNumber}_${r.checkTypeId}`));
    
    // Keep only manually added rules (rules with question+checkType combos NOT in the new generation)
    // This effectively replaces any previously auto-generated rules
    const manualRules = plan.rules.filter((r) => {
      const key = `${r.questionNumber}_${r.checkTypeId}`;
      return !newRuleKeys.has(key);
    });
    
    // Combine: manual rules first, then new generated rules
    plan.rules = [...manualRules, ...newRules];
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
    
    // Load questionnaire + mapping (prefer the one with saved mapping from Tabs)
    const best = questionnaireId
      ? { qnr: { id: questionnaireId, questions: await loadQuestionnaireQuestions(projectId) }, columnMapping: await loadColumnMapping(questionnaireId) }
      : await loadBestQuestionnaireForProject(projectId);

    const questionnaireQuestions = Array.isArray(best?.qnr?.questions) ? best.qnr.questions : [];
    const columnMapping = best?.columnMapping || {};
    
    // Parse file
    const filePath = req.file.path;
    const workbook = XLSX.readFile(filePath);
    const sheetName = workbook.SheetNames[0];
    const worksheet = workbook.Sheets[sheetName];
    const rawData = XLSX.utils.sheet_to_json(worksheet, { defval: null });
    const fileHeaders = rawData && rawData.length > 0 ? Object.keys(rawData[0] || {}) : [];
    
    // Build expected headers from the quality plan (QNR variable names) then map to file headers
    const enabledRules = (plan.rules || []).filter((r) => r?.enabled);
    const expectedHeaders = [];
    const expectedSet = new Set();
    enabledRules.forEach((rule) => {
      buildExpectedHeadersForRule(rule, questionnaireQuestions).forEach((h) => {
        const header = String(h).trim();
        if (!header || expectedSet.has(header)) return;
        expectedSet.add(header);
        expectedHeaders.push(header);
      });
    });

    // Determine which columns we need from the uploaded file
    const neededColumns = new Set([
      'RESPNO', 'respno', 'record', 'Record', 'RESPONO', 'respono',
      // Always include qtime for speeding checks (completion time in seconds)
      'qtime', 'QTIME', 'QTime', 'Qtime',
      ...expectedHeaders
    ]);

    // Also include mapped raw column headers (if present)
    expectedHeaders.forEach((expected) => {
      const mapped = columnMapping[expected] || columnMapping[expected.replace(/^Q/i, '')];
      if (mapped) neededColumns.add(mapped);
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

      // Normalize qtime into a single key
      const qtimeVal =
        getRowValueLoose(row, 'qtime') ??
        getRowValueLoose(row, 'QTIME') ??
        getRowValueLoose(row, 'QTime') ??
        getRowValueLoose(row, 'Qtime');
      if (qtimeVal !== undefined) {
        columns.qtime = qtimeVal;
      }

      // Store only expected (QNR) headers, using mapping to pull values from file headers
      expectedHeaders.forEach((expected) => {
        if (expected === 'qtime') return;
        const mapped = columnMapping[expected] || columnMapping[expected.replace(/^Q/i, '')] || expected;
        const val = getRowValueLoose(row, mapped);
        if (val !== undefined) {
          columns[expected] = val;
        }
      });
      
      dataRows.push({
        respno: String(respno),
        columns
      });
    });
    
    // Save QA data
    await storage.saveQAData(projectId, dataRows);
    
    // Track this upload
    const uploadRecord = await storage.addUpload(projectId, {
      filename: req.file.originalname,
      respondentCount: dataRows.length,
      respnos: dataRows.map(r => r.respno),
      fileHeaders
    });
    
    // Clean up temp file
    await fs.unlink(filePath).catch(() => {});
    
    res.json({
      success: true,
      rowsProcessed: dataRows.length,
      columnsExtracted: neededColumns.size,
      upload: uploadRecord
    });
  } catch (error) {
    console.error('Error uploading data:', error);
    res.status(500).json({ error: 'Failed to upload data' });
  }
});

// GET /api/data-quality/:projectId/data/uploads - Get upload history
router.get('/:projectId/data/uploads', async (req, res) => {
  try {
    const { projectId } = req.params;
    const uploads = await storage.loadUploads(projectId);
    
    res.json({
      uploads,
      total: uploads.length
    });
  } catch (error) {
    console.error('Error loading uploads:', error);
    res.status(500).json({ error: 'Failed to load uploads' });
  }
});

// GET /api/data-quality/:projectId/data/uploads/:uploadId/preview - Get QA data preview for a specific upload
router.get('/:projectId/data/uploads/:uploadId/preview', async (req, res) => {
  try {
    const { projectId, uploadId } = req.params;

    const uploads = await storage.loadUploads(projectId);
    const upload = (uploads || []).find((u) => u.id === uploadId);
    if (!upload) {
      return res.status(404).json({ error: 'Upload not found' });
    }

    const plan = await storage.loadQualityPlan(projectId);
    if (!plan || !Array.isArray(plan.rules)) {
      return res.status(400).json({ error: 'No quality plan found' });
    }

    const qaData = await storage.loadQAData(projectId);

    // Load questionnaire + mapping (prefer the one with saved mapping from Tabs)
    const best = await loadBestQuestionnaireForProject(projectId);
    const questionnaireQuestions = Array.isArray(best?.qnr?.questions) ? best.qnr.questions : [];
    const columnMapping = best?.columnMapping || {};

    const enabledRules = plan.rules.filter((r) => r?.enabled);

    // Build expected headers (QNR names) in plan order, plus per-column metadata for UI
    const expectedHeaders = [];
    const columnsMeta = [];
    const expectedSet = new Set();

    const uploadFileHeaders = Array.isArray(upload.fileHeaders) ? upload.fileHeaders : [];
    const fileHeaderNormalized = new Map();
    uploadFileHeaders.forEach((h) => {
      const norm = normalizeHeaderKey(h);
      if (norm && !fileHeaderNormalized.has(norm)) fileHeaderNormalized.set(norm, h);
    });

    enabledRules.forEach((rule) => {
      // Use the exact "question number" from the quality plan for display (e.g. S3),
      // and keep the expected header (QNR variable) in parentheses.
      const planQuestionName = (rule.questionNumber ?? rule.questionId ?? '');
      const headersForRule = buildExpectedHeadersForRule(rule, questionnaireQuestions);

      headersForRule.forEach((h) => {
        const expected = String(h).trim();
        if (!expected || expectedSet.has(expected)) return;
        expectedSet.add(expected);
        expectedHeaders.push(expected);

        const mapped = columnMapping[expected] || columnMapping[expected.replace(/^Q/i, '')] || expected;
        const normMapped = normalizeHeaderKey(mapped);
        const matchedFileHeader = normMapped ? fileHeaderNormalized.get(normMapped) : null;

        columnsMeta.push({
          expectedHeader: expected,
          planQuestionName,
          mappedHeader: mapped,
          matched: !!matchedFileHeader,
          matchedFileHeader: matchedFileHeader || null,
        });
      });
    });

    const respnos = Array.isArray(upload.respnos) ? upload.respnos : [];
    const rows = respnos.map((respno) => {
      const row = qaData?.[respno] || { respno, columns: {} };
      const cols = row.columns || {};
      const filtered = {};

      expectedHeaders.forEach((expected) => {
        if (expected === 'qtime') {
          // Prefer normalized qtime if stored; otherwise attempt variants
          const qtimeVal =
            getObjValueLoose(cols, 'qtime') ??
            getObjValueLoose(cols, 'QTIME') ??
            getObjValueLoose(cols, 'QTime') ??
            getObjValueLoose(cols, 'Qtime');
          if (qtimeVal !== undefined) filtered.qtime = qtimeVal;
          return;
        }

        const mapped = columnMapping[expected] || columnMapping[expected.replace(/^Q/i, '')] || expected;
        const val =
          getObjValueLoose(cols, expected) ??
          getObjValueLoose(cols, mapped) ??
          undefined;
        if (val !== undefined) filtered[expected] = val;
      });

      return { respno: String(respno), columns: filtered };
    });

    // Show the expected headers (even if values are blank) so the UI reflects the plan columns.
    const columns = expectedHeaders.map((h) => (h === 'qtime' ? 'qtime' : h));

    res.json({
      upload: {
        id: upload.id,
        filename: upload.filename,
        uploadedAt: upload.uploadedAt,
        respondentCount: upload.respondentCount
      },
      columns,
      columnsMeta,
      rows
    });
  } catch (error) {
    console.error('Error loading upload preview:', error);
    res.status(500).json({ error: 'Failed to load upload preview' });
  }
});

// DELETE /api/data-quality/:projectId/data/uploads/:uploadId - Delete an upload
router.delete('/:projectId/data/uploads/:uploadId', async (req, res) => {
  try {
    const { projectId, uploadId } = req.params;
    
    const deleted = await storage.deleteUpload(projectId, uploadId);
    
    if (!deleted) {
      return res.status(404).json({ error: 'Upload not found' });
    }
    
    res.json({ success: true, deleted });
  } catch (error) {
    console.error('Error deleting upload:', error);
    res.status(500).json({ error: 'Failed to delete upload' });
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




