import express from 'express';
import multer from 'multer';
import axios from 'axios';
import FormData from 'form-data';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import XLSX from 'xlsx';
import os from 'os';
import { execFile } from 'child_process';
import mammoth from 'mammoth';
import OpenAI from 'openai';

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage() });

// Python backend URL
const PYTHON_API_URL = process.env.CONJOINT_API_URL || 'http://localhost:8000';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_ROOT = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
const WORKFLOW_STORE_PATH = path.join(DATA_ROOT, 'conjointWorkflows.json');
const WORKFLOW_UPLOAD_ROOT = path.join(DATA_ROOT, 'conjoint-workflows');

// Initialize OpenAI client (lazy initialization)
function getOpenAIClient() {
  // Debug logging
  console.log('[getOpenAIClient] OPENAI_API_KEY exists:', !!process.env.OPENAI_API_KEY);
  console.log('[getOpenAIClient] OPENAI_API_KEY length:', process.env.OPENAI_API_KEY?.length || 0);
  console.log('[getOpenAIClient] OPENAI_API_KEY starts with sk-:', process.env.OPENAI_API_KEY?.startsWith('sk-') || false);
  
  if (!process.env.OPENAI_API_KEY || process.env.OPENAI_API_KEY === 'your_openai_api_key_here' || process.env.OPENAI_API_KEY.trim() === '') {
    throw new Error('OPENAI_API_KEY is not configured. Please set it in your .env file.');
  }
  return new OpenAI({
    apiKey: process.env.OPENAI_API_KEY
  });
}

async function ensureDataStore() {
  await fs.mkdir(DATA_ROOT, { recursive: true });
  await fs.mkdir(WORKFLOW_UPLOAD_ROOT, { recursive: true });
  try {
    await fs.access(WORKFLOW_STORE_PATH);
  } catch (error) {
    if (error && error.code === 'ENOENT') {
      await fs.writeFile(WORKFLOW_STORE_PATH, JSON.stringify([], null, 2), 'utf8');
    } else {
      throw error;
    }
  }
}

async function loadWorkflows() {
  await ensureDataStore();
  try {
    const raw = await fs.readFile(WORKFLOW_STORE_PATH, 'utf8');
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (error) {
    if (error instanceof SyntaxError) {
      // JSON is corrupted - try to recover or create backup
      console.error('Corrupted workflows JSON file detected. Attempting recovery...');
      try {
        // Create a backup of the corrupted file
        const backupPath = `${WORKFLOW_STORE_PATH}.backup.${Date.now()}`;
        const raw = await fs.readFile(WORKFLOW_STORE_PATH, 'utf8');
        await fs.writeFile(backupPath, raw, 'utf8');
        console.log(`Backup created at: ${backupPath}`);
        
        // Try to find the last valid JSON array closing bracket
        let lastValidIndex = -1;
        let bracketCount = 0;
        let inString = false;
        let escapeNext = false;
        
        for (let i = 0; i < raw.length; i++) {
          const char = raw[i];
          
          if (escapeNext) {
            escapeNext = false;
            continue;
          }
          
          if (char === '\\') {
            escapeNext = true;
            continue;
          }
          
          if (char === '"' && !escapeNext) {
            inString = !inString;
            continue;
          }
          
          if (!inString) {
            if (char === '[') {
              bracketCount++;
            } else if (char === ']') {
              bracketCount--;
              if (bracketCount === 0) {
                lastValidIndex = i;
              }
            }
          }
        }
        
        if (lastValidIndex > 0) {
          // Try to parse the truncated JSON
          const truncated = raw.substring(0, lastValidIndex + 1);
          try {
            const parsed = JSON.parse(truncated);
            if (Array.isArray(parsed)) {
              console.log(`Recovered ${parsed.length} workflows from corrupted file`);
              // Save the recovered data
              await fs.writeFile(WORKFLOW_STORE_PATH, JSON.stringify(parsed, null, 2), 'utf8');
              return parsed;
            }
          } catch (recoveryError) {
            console.error('Recovery attempt failed:', recoveryError.message);
          }
        }
        
        // If recovery failed, reset to empty array
        console.warn('Could not recover workflows. Resetting to empty array.');
        await fs.writeFile(WORKFLOW_STORE_PATH, JSON.stringify([], null, 2), 'utf8');
        return [];
      } catch (backupError) {
        console.error('Error during recovery:', backupError);
        // Last resort: reset to empty array
        await fs.writeFile(WORKFLOW_STORE_PATH, JSON.stringify([], null, 2), 'utf8');
        return [];
      }
    } else {
      // Other file read errors
      console.error('Error reading workflows file:', error);
      // If file doesn't exist, create it
      if (error.code === 'ENOENT') {
        await fs.writeFile(WORKFLOW_STORE_PATH, JSON.stringify([], null, 2), 'utf8');
        return [];
      }
      throw error;
    }
  }
}

async function saveWorkflows(workflows) {
  await ensureDataStore();
  await fs.writeFile(WORKFLOW_STORE_PATH, JSON.stringify(workflows, null, 2), 'utf8');
}

// Helper function to calculate design summary
function calculateDesignSummary(designMatrix, normalizedAttributes) {
  if (!Array.isArray(designMatrix) || designMatrix.length === 0) {
    return {
      attColumnCount: 0,
      attColumns: [],
      totalRows: 0,
      versions: [],
      attributeCoverage: []
    };
  }

  const firstRow = designMatrix[0] || {};
  const columns = Object.keys(firstRow);

  // Find attribute columns (ATT1, ATT2, etc. or similar patterns)
  const attColumns = columns.filter(col =>
    /^ATT\d+$/i.test(col) ||
    /^ATTRIBUTE[\s_]?\d+$/i.test(col) ||
    /^A\d+$/i.test(col)
  );

  // Group by version if version column exists
  const versionColumn = columns.find(col => /version/i.test(col));
  const versions = [];

  if (versionColumn) {
    const versionGroups = new Map();
    designMatrix.forEach(row => {
      const ver = String(row[versionColumn] || '').trim();
      if (!versionGroups.has(ver)) {
        versionGroups.set(ver, []);
      }
      versionGroups.get(ver).push(row);
    });

    versionGroups.forEach((rows, version) => {
      const taskColumn = columns.find(col => /task/i.test(col));
      const conceptColumn = columns.find(col => /concept/i.test(col) || /alt/i.test(col));

      let tasksPerVersion = 0;
      let conceptsPerTask = [];

      if (taskColumn) {
        const tasks = new Set(rows.map(r => r[taskColumn]));
        tasksPerVersion = tasks.size;

        if (conceptColumn) {
          tasks.forEach(task => {
            const taskRows = rows.filter(r => r[taskColumn] === task);
            conceptsPerTask.push(taskRows.length);
          });
        }
      }

      versions.push({
        version,
        taskCount: tasksPerVersion,
        minConceptsPerTask: conceptsPerTask.length > 0 ? Math.min(...conceptsPerTask) : 0,
        maxConceptsPerTask: conceptsPerTask.length > 0 ? Math.max(...conceptsPerTask) : 0,
        avgConceptsPerTask: conceptsPerTask.length > 0
          ? conceptsPerTask.reduce((a, b) => a + b, 0) / conceptsPerTask.length
          : 0
      });
    });
  }

  // Calculate attribute coverage
  const attributeCoverage = [];

  // Group normalized attributes by attribute number
  const attrGroups = new Map();
  normalizedAttributes.forEach(attr => {
    if (!attrGroups.has(attr.attributeNo)) {
      attrGroups.set(attr.attributeNo, {
        attributeNo: attr.attributeNo,
        attributeText: attr.attributeText,
        levels: []
      });
    }
    attrGroups.get(attr.attributeNo).levels.push({
      code: attr.code,
      levelText: attr.levelText
    });
  });

  attrGroups.forEach((group, attrNo) => {
    const levelCounts = new Map();

    // Count how many times each level appears in design
    attColumns.forEach(col => {
      designMatrix.forEach(row => {
        const code = String(row[col] || '').trim();
        const level = group.levels.find(l => l.code === code);
        if (level) {
          const count = levelCounts.get(level.levelText) || 0;
          levelCounts.set(level.levelText, count + 1);
        }
      });
    });

    attributeCoverage.push({
      attributeNo: group.attributeNo,
      attributeText: group.attributeText,
      total: designMatrix.length,
      levels: Array.from(levelCounts.entries()).map(([levelText, count]) => ({
        levelText,
        count
      }))
    });
  });

  return {
    attColumnCount: attColumns.length,
    attColumns,
    totalRows: designMatrix.length,
    versions,
    attributeCoverage
  };
}

// Proxy endpoint for uploading Excel and estimating model
router.post('/estimate_from_two_sheets', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ detail: 'No file uploaded' });
    }

    // Create form data to forward to Python backend
    const formData = new FormData();
    formData.append('file', req.file.buffer, {
      filename: req.file.originalname,
      contentType: req.file.mimetype
    });

    // Forward to Python backend
    const response = await axios.post(`${PYTHON_API_URL}/estimate_from_two_sheets`, formData, {
      headers: {
        ...formData.getHeaders(),
      },
    });

    res.json(response.data);
  } catch (error) {
    console.error('Error estimating model:', error);
    res.status(error.response?.status || 500).json({
      detail: error.response?.data?.detail || error.message
    });
  }
});

// Proxy endpoint for estimating from survey export (wide format)
router.post('/estimate_from_survey_export', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ detail: 'No file uploaded' });
    }

    // Create form data to forward to Python backend
    const formData = new FormData();
    formData.append('file', req.file.buffer, {
      filename: req.file.originalname,
      contentType: req.file.mimetype
    });

    // Forward to Python backend
    const response = await axios.post(`${PYTHON_API_URL}/estimate_from_survey_export`, formData, {
      headers: {
        ...formData.getHeaders(),
      },
    });

    res.json(response.data);
  } catch (error) {
    console.error('Error estimating from survey export:', error);
    res.status(error.response?.status || 500).json({
      detail: error.response?.data?.detail || error.message
    });
  }
});

// Proxy endpoint for running simulation
router.post('/simulate', async (req, res) => {
  const payload = req.body || {};
  try {
    const response = await axios.post(`${PYTHON_API_URL}/simulate`, payload, {
      timeout: 30000
    });
    res.json(response.data);
    return;
  } catch (error) {
    console.error('Error running simulation:', error);

    const allowFallback = process.env.CONJOINT_DISABLE_CLI_FALLBACK !== '1';
    const connectivityError = ['ECONNREFUSED', 'ENOTFOUND', 'ECONNABORTED', 'ETIMEDOUT'].includes(error.code);
    const serverStatus = error.response?.status;
    const shouldFallback =
      allowFallback && (connectivityError || !error.response || (serverStatus && serverStatus >= 500));

    if (!shouldFallback) {
      res.status(error.response?.status || 500).json({
        detail: error.response?.data?.detail || error.message
      });
      return;
    }

    try {
      const fallbackResult = runLocalSimulationFallback(payload);
      res.status(200).json({
        ...fallbackResult,
        warnings: [
          'Simulation completed via local fallback because the Python API was unavailable.'
        ]
      });
    } catch (fallbackError) {
      console.error('Local simulation fallback failed:', fallbackError);
      res.status(503).json({
        detail: `Unable to reach the simulation service at ${PYTHON_API_URL}, and the local fallback failed.`,
        message: fallbackError.message
      });
    }
  }
});

router.get('/workflows', async (req, res) => {
  try {
    const { projectId } = req.query;
    if (!projectId) {
      return res.status(400).json({ detail: 'projectId query parameter is required.' });
    }

    const workflows = await loadWorkflows();
    const filtered = workflows
      .filter(workflow => workflow.projectId === projectId)
      .sort((a, b) => new Date(b.updatedAt || b.createdAt).getTime() - new Date(a.updatedAt || a.createdAt).getTime());

    res.json({ workflows: filtered });
  } catch (error) {
    console.error('Error loading conjoint workflows:', error);
    res.status(500).json({
      detail: 'Failed to load workflows.',
      message: error.message
    });
  }
});

router.delete('/workflows/:workflowId', async (req, res) => {
  try {
    const { workflowId } = req.params;
    if (!workflowId) {
      return res.status(400).json({ detail: 'workflowId is required in the URL path.' });
    }

    const workflows = await loadWorkflows();
    const index = workflows.findIndex(workflow => workflow.id === workflowId);

    if (index === -1) {
      return res.status(404).json({ detail: `Workflow ${workflowId} not found.` });
    }

    // Remove workflow from array
    workflows.splice(index, 1);
    await saveWorkflows(workflows);

    // Optionally: Clean up associated files
    try {
      const workflowDir = path.join(WORKFLOW_UPLOAD_ROOT, workflowId);
      await fs.rm(workflowDir, { recursive: true, force: true });
    } catch (cleanupError) {
      console.warn('Failed to clean up workflow files:', cleanupError);
      // Continue anyway - workflow is deleted from database
    }

    res.status(200).json({ message: 'Workflow deleted successfully', workflowId });
  } catch (error) {
    console.error('Error deleting workflow:', error);
    res.status(500).json({
      detail: 'Failed to delete workflow.',
      message: error.message
    });
  }
});

router.post('/workflows', async (req, res) => {
  try {
    const {
      projectId,
      attributes,
      designMatrix,
      designSummary,
      warnings = [],
      sourceFileName
    } = req.body || {};

    if (!projectId) {
      return res.status(400).json({ detail: 'projectId is required.' });
    }

    if (!Array.isArray(attributes) || attributes.length === 0) {
      return res.status(400).json({ detail: 'attributes must contain at least one normalized attribute record.' });
    }

    if (!Array.isArray(designMatrix) || designMatrix.length === 0) {
      return res.status(400).json({ detail: 'designMatrix must contain at least one row.' });
    }

    if (!designSummary || typeof designSummary !== 'object') {
      return res.status(400).json({ detail: 'designSummary is required.' });
    }

    const workflowId = `wf-${Date.now()}`;
    const timestamp = new Date().toISOString();

    const workflows = await loadWorkflows();
    workflows.push({
      id: workflowId,
      projectId,
      attributes,
      designMatrix,
      designSummary,
      warnings,
      sourceFileName: sourceFileName || null,
      createdAt: timestamp,
      updatedAt: timestamp
    });

    await saveWorkflows(workflows);

    res.status(201).json({
      workflowId,
      savedAt: timestamp
    });
  } catch (error) {
    console.error('Error saving conjoint workflow:', error);
    res.status(500).json({
      detail: 'Failed to save workflow draft.',
      message: error.message
    });
  }
});

router.delete('/workflows/:workflowId/survey', async (req, res) => {
  console.log('[DELETE Survey] Request received:', req.params, req.method, req.path);
  try {
    const { workflowId } = req.params;
    if (!workflowId) {
      console.log('[DELETE Survey] Missing workflowId');
      return res.status(400).json({ detail: 'workflowId is required in the URL path.' });
    }

    console.log('[DELETE Survey] Loading workflows for workflowId:', workflowId);
    const workflows = await loadWorkflows();
    const index = workflows.findIndex(workflow => workflow.id === workflowId);

    if (index === -1) {
      console.log('[DELETE Survey] Workflow not found:', workflowId);
      return res.status(404).json({ detail: `Workflow ${workflowId} not found.` });
    }

    const workflow = workflows[index];
    console.log('[DELETE Survey] Workflow found, removing survey data...');

    // Remove survey data and estimation results
    if (workflow.survey?.storedFileName) {
      try {
        const surveyFilePath = path.join(WORKFLOW_UPLOAD_ROOT, workflowId, workflow.survey.storedFileName);
        await fs.rm(surveyFilePath, { force: true });
        console.log(`[Survey Delete] Removed survey file: ${surveyFilePath}`);
      } catch (cleanupError) {
        console.warn('[Survey Delete] Failed to remove survey file:', cleanupError);
        // Continue anyway - we'll still remove from database
      }
    }

    // Remove survey data and estimation from workflow
    workflows[index] = {
      ...workflow,
      survey: undefined,
      surveyUploadedAt: undefined,
      surveySummary: undefined,
      estimation: undefined,
      estimationResult: undefined,
      updatedAt: new Date().toISOString()
    };

    await saveWorkflows(workflows);

    res.status(200).json({ 
      message: 'Survey data and estimation results removed successfully', 
      workflowId 
    });
  } catch (error) {
    console.error('Error removing survey data:', error);
    res.status(500).json({
      detail: 'Failed to remove survey data.',
      message: error.message
    });
  }
});

// Download survey file
router.get('/workflows/:workflowId/survey/download', async (req, res) => {
  try {
    const { workflowId } = req.params;
    if (!workflowId) {
      return res.status(400).json({ detail: 'workflowId is required in the URL path.' });
    }

    const workflows = await loadWorkflows();
    const workflow = workflows.find(w => w.id === workflowId);
    
    if (!workflow) {
      return res.status(404).json({ detail: `Workflow ${workflowId} not found.` });
    }

    if (!workflow.survey?.storedFileName) {
      return res.status(404).json({ detail: 'Survey file not found for this workflow.' });
    }

    const surveyFilePath = path.join(WORKFLOW_UPLOAD_ROOT, workflowId, workflow.survey.storedFileName);
    
    // Check if file exists
    try {
      await fs.access(surveyFilePath);
    } catch {
      return res.status(404).json({ detail: 'Survey file not found on disk.' });
    }

    // Get the original filename (remove leading underscore if present)
    const originalFileName = workflow.survey.fileName || workflow.survey.storedFileName.replace(/^_/, '');

    res.download(surveyFilePath, originalFileName);
  } catch (error) {
    console.error('Error downloading survey file:', error);
    res.status(500).json({
      detail: 'Failed to download survey file.',
      message: error.message
    });
  }
});

router.post('/workflows/:workflowId/survey', upload.single('file'), async (req, res) => {
  try {
    const { workflowId } = req.params;
    if (!workflowId) {
      return res.status(400).json({ detail: 'workflowId is required in the URL path.' });
    }

    if (!req.file) {
      return res.status(400).json({ detail: 'No file uploaded' });
    }

    const workflows = await loadWorkflows();
    const index = workflows.findIndex(workflow => workflow.id === workflowId);
    if (index === -1) {
      return res.status(404).json({ detail: `Workflow ${workflowId} not found.` });
    }

    const workflow = workflows[index];
    const designCodes = new Set(
      (workflow.designMatrix || [])
        .flatMap(row => Object.values(row || {}))
        .map(value => String(value || '').trim())
        .filter(Boolean)
    );

    const workbook = XLSX.read(req.file.buffer, { type: 'buffer' });
    const firstSheetName = workbook.SheetNames[0];
    const surveySheet = workbook.Sheets[firstSheetName];
    if (!surveySheet) {
      return res.status(400).json({ detail: 'Unable to read the first sheet in the workbook.' });
    }

    const surveyRows = XLSX.utils.sheet_to_json(surveySheet, { defval: '', raw: false });
    if (!surveyRows.length) {
      return res.status(400).json({ detail: 'The survey export appears to be empty.' });
    }

    // Use deterministic preprocessing for consistent column detection
    const { preprocessConjointData, groupMarketShareByScenario } = await import('../services/conjointDataPreprocessor.mjs');
    
    // Get column mapping from workflow if available
    const columnMapping = workflow?.survey?.summary?.columnMapping || null;
    
    // Skip product extraction since we'll use AI-identified products instead
    const preprocessingResult = preprocessConjointData(workbook, firstSheetName, { 
      skipProductExtraction: true,
      columnMapping: columnMapping
    });
    const { categorized, productNameMap, marketShareScenarios } = preprocessingResult;

    console.log('[Survey Upload] Preprocessing complete:', preprocessingResult.summary);

    // Use categorized columns from preprocessing
    const choiceColumns = categorized.choiceColumns;
    const versionColumn = categorized.versionColumn;
    const attributeColumns = categorized.attributeColumns;
    const marketShareColumns = categorized.marketShareColumns;

    // Map AI analysis products to row numbers - OVERRIDE Datamap names
    try {
      if (workflow?.aiAnalysis?.products && Array.isArray(workflow.aiAnalysis.products)) {
        const aiProducts = workflow.aiAnalysis.products
          .map(p => (typeof p === 'string' ? p : (p?.name || p?.label || '')))
          .filter(Boolean);
        
        console.log('[Survey Upload] Mapping AI products to row numbers:', aiProducts);

        // Gather all row numbers found in the data
        const allRowNumbers = new Set();
        Object.values(marketShareScenarios.original).forEach(taskProducts => {
          Object.values(taskProducts).forEach(product => {
            if (typeof product.rowNumber === 'number') {
              allRowNumbers.add(product.rowNumber);
            }
          });
        });
        const sortedRowNumbers = Array.from(allRowNumbers).sort((a, b) => a - b);

        // Separate named products from "Other"/"None" options
        const namedProducts = aiProducts.filter(p => {
          const lowerP = p.toLowerCase();
          return !lowerP.includes('other') && 
                 !lowerP.includes('none') && 
                 !lowerP.includes('don\'t know') &&
                 !lowerP.includes('dont know') &&
                 !lowerP.includes('not applicable') &&
                 !lowerP.includes('na') &&
                 !lowerP.includes('n/a') &&
                 !lowerP.includes('specify') &&
                 !lowerP.includes('please specify');
        });
        const otherProducts = aiProducts.filter(p => {
          const lowerP = p.toLowerCase();
          return lowerP.includes('other') || 
                 lowerP.includes('none') || 
                 lowerP.includes('don\'t know') ||
                 lowerP.includes('dont know') ||
                 lowerP.includes('not applicable') ||
                 lowerP.includes('na') ||
                 lowerP.includes('n/a') ||
                 lowerP.includes('specify') ||
                 lowerP.includes('please specify');
        });

        // Map named products to first rows (1, 2, ...)
        namedProducts.forEach((productName, index) => {
          const rowNumber = sortedRowNumbers[index] ?? (index + 1);
          productNameMap.set(rowNumber, productName);
          console.log(`[Survey Upload] Mapped row ${rowNumber} to "${productName}"`);
        });

        // Map "Other"/"None" products to highest row numbers (98, 97, ...)
        otherProducts.forEach((productName, index) => {
          const rowNumber = sortedRowNumbers[sortedRowNumbers.length - 1 - index];
          if (rowNumber) {
            productNameMap.set(rowNumber, productName);
            console.log(`[Survey Upload] Mapped row ${rowNumber} to "${productName}" (Other/None option)`);
          }
        });

        console.log(`[Survey Upload] AI identified ${aiProducts.length} products. Mapped ${namedProducts.length + otherProducts.length} products to rows.`);
      }
    } catch (aiNameError) {
      console.warn('AI product name mapping failed:', aiNameError);
    }

    const versionCounts = new Map();
    const unmatchedCodes = new Set();
    const codesUsed = new Set();

    preprocessingResult.surveyRows.forEach(row => {
      const versionValue = versionColumn ? String(row[versionColumn] || '').trim() : '';
      const versionKey = versionValue || 'unspecified';
      versionCounts.set(versionKey, (versionCounts.get(versionKey) || 0) + 1);

      attributeColumns.forEach(column => {
        const rawValue = row[column];
        if (rawValue === undefined || rawValue === null) return;
        const value = String(rawValue).trim();
        if (!value) return;
        codesUsed.add(value);
        if (!designCodes.has(value)) {
          unmatchedCodes.add(value);
        }
      });
    });

    // Extract market share data using preprocessing results
    const marketShareProducts = [];
    
    // Process original scenario (c1) market share data
    // ONLY process products that were identified by AI (exist in productNameMap)
    Object.entries(marketShareScenarios.original).forEach(([task, products]) => {
      Object.values(products).forEach(product => {
        // Skip products that weren't identified by AI (e.g., "None of these" options)
        if (!productNameMap.has(product.rowNumber)) {
          console.log(`[Data Processing] Skipping row ${product.rowNumber} - not an AI-identified product`);
          return;
        }

        const existingProduct = marketShareProducts.find(p => p.name === product.productName);

        if (!existingProduct) {
          // Calculate average market share across all tasks for this product
          let totalShare = 0;
          let taskCount = 0;
          
          Object.values(marketShareScenarios.original).forEach(taskProducts => {
            const taskProduct = Object.values(taskProducts).find(p => p.productName === product.productName);
            if (taskProduct) {
              // Calculate average for this task - treat blank/missing values as 0
              let taskShare = 0;
              const totalRows = preprocessingResult.surveyRows.length;

              preprocessingResult.surveyRows.forEach(row => {
                const value = parseFloat(row[taskProduct.columnName]);
                // Treat blank/missing/invalid values as 0
                if (!isNaN(value) && value >= 0 && value <= 100) {
                  taskShare += value;
                } else {
                  // Blank or invalid value = 0
                  taskShare += 0;
                }
              });

              if (totalRows > 0) {
                totalShare += taskShare / totalRows;
                taskCount++;
              }
            }
          });
          
          if (taskCount > 0) {
            const avgShare = totalShare / taskCount;
            // Convert percentage to decimal (assume all values are percentages)
            const shareAsDecimal = avgShare / 100;

            marketShareProducts.push({
              name: product.productName,
              currentShare: shareAsDecimal,
              adjustedShare: shareAsDecimal,
              rowNumber: product.rowNumber
            });
          }
        }
      });
    });

    // Sort market share products by row number for consistent order
    marketShareProducts.sort((a, b) => (a.rowNumber || 0) - (b.rowNumber || 0));

    const summary = {
      totalRespondents: preprocessingResult.summary.cleanedRows,
      tasksPerRespondent: choiceColumns.length,
      choiceColumns,
      versionCounts: Array.from(versionCounts.entries()).map(([version, count]) => ({ version, count })),
      uniqueCodesInSurvey: Array.from(codesUsed),
      unmatchedCodes: Array.from(unmatchedCodes),
      marketShareProducts,
      marketShareScenarios: {
        original: Object.keys(marketShareScenarios.original).length,
        withNewOptions: Object.keys(marketShareScenarios.withNewOptions).length
      },
      products: Array.from(productNameMap.entries()).map(([row, name]) => ({
        rowNumber: row,
        name: name
      }))
    };

    const warnings = [];
    if (!choiceColumns.length) {
      warnings.push('No QC1_N columns were found in the survey export.');
    }
    if (unmatchedCodes.size) {
      warnings.push(`Survey contains ${unmatchedCodes.size} code(s) that do not appear in the design matrix.`);
    }

    await fs.mkdir(path.join(WORKFLOW_UPLOAD_ROOT, workflowId), { recursive: true });
    const sanitizedOriginalName = req.file.originalname.replace(/[^\w.\-]/g, '_');
    const storedFileName = `${Date.now()}_${sanitizedOriginalName}`;
    await fs.writeFile(path.join(WORKFLOW_UPLOAD_ROOT, workflowId, storedFileName), req.file.buffer);

    const timestamp = new Date().toISOString();
    workflows[index] = {
      ...workflow,
      survey: {
        originalFileName: req.file.originalname,
        storedFileName,
        summary,
        warnings,
        uploadedAt: timestamp
      },
      updatedAt: timestamp
    };

    await saveWorkflows(workflows);

    res.status(201).json({
      workflowId,
      uploadedAt: timestamp,
      summary,
      warnings
    });
  } catch (error) {
    console.error('Error processing conjoint survey export:', error);
    res.status(500).json({
      detail: 'Failed to process survey export.',
      message: error.message
    });
  }
});

// AI Workflow Analysis - Step 1: Analyze questionnaire file
router.post('/ai-workflow/analyze-questionnaire', upload.single('questionnaire'), async (req, res) => {
  try {
    const { projectId } = req.body;

    if (!projectId) {
      return res.status(400).json({ detail: 'projectId is required' });
    }

    const questionnaireFile = req.file;

    if (!questionnaireFile) {
      return res.status(400).json({ detail: 'Questionnaire file is required' });
    }

    console.log('[AI Workflow Step 1] Starting questionnaire analysis for project:', projectId);
    console.log('[AI Workflow Step 1] File received:', questionnaireFile.originalname);

    // Parse Word document
    console.log('[AI Workflow Step 1] Parsing questionnaire document...');
    const questionnaireText = await mammoth.extractRawText({ buffer: questionnaireFile.buffer });
    const fullText = questionnaireText.value;

    // Use OpenAI to analyze questionnaire and extract conjoint information
    console.log('[AI Workflow Step 1] Analyzing questionnaire with OpenAI...');
    const aiPrompt = `You are analyzing a market research questionnaire to identify and extract information about a conjoint analysis exercise.

Please analyze the following questionnaire and extract:
1. The section identifier/name where the conjoint exercise appears (e.g., "Section C", "Part 3", "SMA DEMAND CONJOINT", etc.)
2. ALL product/brand names mentioned in market share questions - look for questions asking about current market share, patient share, or usage share. These could be in tables, lists, or question text. Include ALL products mentioned, not just the first few.
3. A brief description of what the conjoint is measuring
4. The question identifier for market share questions (e.g., C2, Q15, S13, etc.)

IMPORTANT: Look carefully for ALL products mentioned in market share questions. Don't stop at 3 products - there may be 8 or more products listed. Look for:
- Tables with product names and percentage columns
- Questions asking "What percentage of your patients currently use..."
- Lists of products with share questions
- Any mention of current market share or usage
- "Other" options, "Other (specify)", "Other brand", "None of these", "Don't know", or similar catch-all categories
- Generic options like "Other", "Other (please specify)", "Other brand", "None", "Not applicable"

Format your response as JSON with this structure:
{
  "conjointSection": "the section identifier",
  "sectionDescription": "brief description of what this section measures",
  "products": ["product1", "product2", "product3", "product4", "product5", "product6", "product7", "product8", ...],
  "marketShareQuestion": "the question number or identifier asking about market share"
}

Questionnaire text:
${fullText.substring(0, 20000)}`;

    const openai = getOpenAIClient();
    const aiResponse = await openai.chat.completions.create({
      model: "gpt-4o",
      messages: [
        {
          role: "system",
          content: "You are an expert at analyzing market research questionnaires and extracting structured information about conjoint analysis exercises."
        },
        {
          role: "user",
          content: aiPrompt
        }
      ],
      response_format: { type: "json_object" },
      temperature: 0.3
    });

    const aiAnalysis = JSON.parse(aiResponse.choices[0].message.content);
    console.log('[AI Workflow Step 1] AI Analysis result:', aiAnalysis);

    // Return the analysis result for user review
    res.status(200).json({
      step: 1,
      success: true,
      analysis: {
        conjointSection: aiAnalysis.conjointSection || 'Unknown',
        sectionDescription: aiAnalysis.sectionDescription || '',
        products: aiAnalysis.products || [],
        marketShareQuestion: aiAnalysis.marketShareQuestion || ''
      },
      message: 'Questionnaire analysis complete. Please review the results and proceed to the next step.'
    });
  } catch (error) {
    console.error('[AI Workflow Step 1] Error during questionnaire analysis:', error);
    res.status(500).json({
      detail: 'Failed to analyze questionnaire file',
      message: error.message
    });
  }
});

// AI Workflow Analysis - Step 2: Analyze attribute list file
router.post('/ai-workflow/analyze-attributes', upload.single('attributeList'), async (req, res) => {
  try {
    const { projectId } = req.body;

    if (!projectId) {
      return res.status(400).json({ detail: 'projectId is required' });
    }

    const attributeListFile = req.file;

    if (!attributeListFile) {
      return res.status(400).json({ detail: 'Attribute list file is required' });
    }

    console.log('[AI Workflow Step 2] Starting attribute list analysis for project:', projectId);
    console.log('[AI Workflow Step 2] File received:', attributeListFile.originalname);

    // Parse attribute list using AI
    console.log('[AI Workflow Step 2] Parsing attribute list with AI...');
    const attributeWorkbook = XLSX.read(attributeListFile.buffer, { type: 'buffer' });
    // Prefer a sheet containing "attribute" in the name if available
    let attributeSheetName = attributeWorkbook.SheetNames.find(n => /attribute/i.test(String(n))) || attributeWorkbook.SheetNames[0];
    const attributeSheet = attributeWorkbook.Sheets[attributeSheetName];
    const attributeData = XLSX.utils.sheet_to_json(attributeSheet, { defval: '', raw: false });

    // Convert ALL attribute data to text for AI analysis
    const attributeText = attributeData.map((row, i) => {
      const rowText = Object.entries(row)
        .filter(([key, value]) => value && String(value).trim())
        .map(([key, value]) => `${key}: ${value}`)
        .join(' | ');
      return `Row ${i}: ${rowText}`;
    }).join('\n');

    console.log('[AI Workflow Step 2] Attribute sheet:', attributeSheetName);
    console.log('[AI Workflow Step 2] Total attribute data rows:', attributeData.length);

    // Use AI to parse the attribute structure
    const attributePrompt = `You are analyzing an Excel file containing conjoint analysis attributes and levels. 

CRITICAL: This file contains exactly 20 attributes (numbered 1-20). You must find ALL 20 attributes, not just the first few.

The structure is:
- Each attribute starts with a row where ATTRIBUTES column has a number (1, 2, 3, etc.) and __EMPTY column has the attribute name
- The following rows have empty ATTRIBUTES column but LEVEL column has numbers (1, 2, 3, etc.) and __EMPTY_1 column has the level descriptions
- This pattern repeats for each of the 20 attributes

Example pattern:
Row 0: ATTRIBUTES: 1 | __EMPTY: Attribute Name | LEVEL: 1 | __EMPTY_1: Level 1 description
Row 1: ATTRIBUTES: | __EMPTY: | LEVEL: 2 | __EMPTY_1: Level 2 description
Row 2: ATTRIBUTES: | __EMPTY: | LEVEL: 3 | __EMPTY_1: Level 3 description
Row 5: ATTRIBUTES: 2 | __EMPTY: Next Attribute Name | LEVEL: 1 | __EMPTY_1: Level 1 description

You must scan through ALL rows to find attributes 1 through 20. Do not stop after finding just a few attributes.

Format your response as JSON with this structure:
{
  "attributes": [
    {
      "attributeNo": "1",
      "attributeText": "Attribute Name",
      "levels": [
        {
          "levelNo": "1", 
          "levelText": "Level Description",
          "code": "optional code if available"
        }
      ]
    }
  ]
}

Data to analyze (scan ALL rows to find all 20 attributes):
${attributeText}`;

    const openai = getOpenAIClient();
    const attributeAIResponse = await openai.chat.completions.create({
      model: "gpt-4o",
      messages: [
        {
          role: "system",
          content: "You are an expert at parsing conjoint analysis attribute files and extracting structured attribute/level information from various Excel formats."
        },
        {
          role: "user",
          content: attributePrompt
        }
      ],
      response_format: { type: "json_object" },
      temperature: 0.3
    });

    const aiAttributeAnalysis = JSON.parse(attributeAIResponse.choices[0].message.content);
    console.log('[AI Workflow Step 2] AI Attribute Analysis result:', aiAttributeAnalysis);

    // Convert AI analysis to normalized format
    const normalizedAttributes = [];
    if (aiAttributeAnalysis.attributes && Array.isArray(aiAttributeAnalysis.attributes)) {
      aiAttributeAnalysis.attributes.forEach(attr => {
        if (attr.levels && Array.isArray(attr.levels)) {
          attr.levels.forEach(level => {
            normalizedAttributes.push({
              code: level.code || level.levelNo || '',
              attributeNo: attr.attributeNo || '',
              attributeText: attr.attributeText || '',
              levelNo: level.levelNo || '',
              levelText: level.levelText || ''
            });
          });
        }
      });
    }

    console.log('[AI Workflow Step 2] Found', normalizedAttributes.length, 'attribute levels via AI parsing');

    // Group attributes by attribute number for display
    const attributeGroups = new Map();
    normalizedAttributes.forEach(attr => {
      const key = String(attr.attributeNo || '').trim();
      if (!key) return;
      if (!attributeGroups.has(key)) {
        attributeGroups.set(key, {
          attributeNo: key,
          attributeText: attr.attributeText,
          levels: []
        });
      }
      attributeGroups.get(key).levels.push({
        code: attr.code,
        levelNo: attr.levelNo,
        levelText: attr.levelText
      });
    });

    const groupedAttributes = Array.from(attributeGroups.values());

    // Return the analysis result for user review
    res.status(200).json({
      step: 2,
      success: true,
      analysis: {
        attributes: groupedAttributes,
        totalAttributeLevels: normalizedAttributes.length,
        normalizedAttributes: normalizedAttributes // Include for design matrix analysis
      },
      message: 'Attribute list analysis complete. Please review the results and proceed to the next step.'
    });
  } catch (error) {
    console.error('[AI Workflow Step 2] Error during attribute analysis:', error);
    res.status(500).json({
      detail: 'Failed to analyze attribute list file',
      message: error.message
    });
  }
});

// AI Workflow Analysis - Step 3: Analyze design matrix file and create workflow
router.post('/ai-workflow/analyze-design', upload.single('designFile'), async (req, res) => {
  try {
    const { projectId, questionnaireAnalysis, attributeAnalysis } = req.body;

    if (!projectId) {
      return res.status(400).json({ detail: 'projectId is required' });
    }

    const designFile = req.file;

    if (!designFile) {
      return res.status(400).json({ detail: 'Design file is required' });
    }

    // Parse questionnaire and attribute analysis from previous steps
    let questionnaireData = null;
    let normalizedAttributes = [];
    let attributeAnalysisData = null;
    
    try {
      if (questionnaireAnalysis) {
        questionnaireData = typeof questionnaireAnalysis === 'string' 
          ? JSON.parse(questionnaireAnalysis) 
          : questionnaireAnalysis;
        console.log('[AI Workflow Step 3] Parsed questionnaire data:', questionnaireData);
      }
      if (attributeAnalysis) {
        attributeAnalysisData = typeof attributeAnalysis === 'string' 
          ? JSON.parse(attributeAnalysis) 
          : attributeAnalysis;
        console.log('[AI Workflow Step 3] Raw attributeAnalysis:', typeof attributeAnalysis === 'string' ? 'string' : 'object');
        console.log('[AI Workflow Step 3] Parsed attribute analysis data:', attributeAnalysisData);
        console.log('[AI Workflow Step 3] attributeAnalysisData keys:', attributeAnalysisData ? Object.keys(attributeAnalysisData) : 'null');
        console.log('[AI Workflow Step 3] attributeAnalysisData.attributes:', attributeAnalysisData?.attributes);
        console.log('[AI Workflow Step 3] attributeAnalysisData.attributes length:', Array.isArray(attributeAnalysisData?.attributes) ? attributeAnalysisData.attributes.length : 'not array');
        console.log('[AI Workflow Step 3] attributeAnalysisData.normalizedAttributes:', attributeAnalysisData?.normalizedAttributes);
        console.log('[AI Workflow Step 3] attributeAnalysisData.normalizedAttributes length:', Array.isArray(attributeAnalysisData?.normalizedAttributes) ? attributeAnalysisData.normalizedAttributes.length : 'not array');
        
        // The attributeAnalysis is the analysis result directly, which contains normalizedAttributes
        normalizedAttributes = attributeAnalysisData.normalizedAttributes || [];
        console.log('[AI Workflow Step 3] Extracted normalizedAttributes:', normalizedAttributes.length);
      } else {
        console.warn('[AI Workflow Step 3] No attributeAnalysis provided in request body');
      }
    } catch (parseError) {
      console.warn('[AI Workflow Step 3] Error parsing previous step data:', parseError);
      console.warn('[AI Workflow Step 3] Parse error details:', parseError.message);
    }

    console.log('[AI Workflow Step 3] Starting design matrix analysis for project:', projectId);
    console.log('[AI Workflow Step 3] File received:', designFile.originalname);

    // Parse design file
    console.log('[AI Workflow Step 3] Parsing design file...');
    const designWorkbook = XLSX.read(designFile.buffer, { type: 'buffer' });
    console.log('[AI Workflow Step 3] Design file has sheets:', designWorkbook.SheetNames);
    
    // Use second sheet if available (experimental design with Task/Concept/Attribute columns)
    // Otherwise use first sheet
    let designSheetName;
    let designSheet;
    if (designWorkbook.SheetNames.length >= 2) {
      designSheetName = designWorkbook.SheetNames[1];
      designSheet = designWorkbook.Sheets[designSheetName];
      console.log('[AI Workflow Step 3] Using second sheet for design matrix:', designSheetName);
    } else {
      designSheetName = designWorkbook.SheetNames[0];
      designSheet = designWorkbook.Sheets[designSheetName];
      console.log('[AI Workflow Step 3] Only one sheet found, using first sheet:', designSheetName);
    }
    
    const designMatrix = XLSX.utils.sheet_to_json(designSheet, { defval: '', raw: false });
    
    // Log sample columns to understand structure
    if (designMatrix.length > 0) {
      const sampleCols = Object.keys(designMatrix[0]);
      console.log('[AI Workflow Step 3] Design matrix columns (sample):', sampleCols.slice(0, 10));
    }

    console.log('[AI Workflow Step 3] Design matrix has', designMatrix.length, 'rows');

    // Calculate design summary
    const designSummary = calculateDesignSummary(designMatrix, normalizedAttributes);

    // Combine questionnaire and attribute analysis
    // questionnaireData is { analysis: { ... } } from Step 1
    // attributeAnalysisData is the analysis result directly from Step 2: { attributes: [...], normalizedAttributes: [...] }
    // Step 2 response structure: { step: 2, success: true, analysis: { attributes: [...], normalizedAttributes: [...] } }
    // But when passed from frontend, step2Result is just the analysis object
    
    // Ensure we get the grouped attributes from Step 2
    const groupedAttributes = attributeAnalysisData?.attributes || [];
    
    console.log('[AI Workflow Step 3] Preparing completeAiAnalysis:', {
      hasQuestionnaireData: !!questionnaireData,
      hasAttributeAnalysisData: !!attributeAnalysisData,
      groupedAttributesCount: groupedAttributes.length,
      normalizedAttributesCount: normalizedAttributes.length
    });
    
    const completeAiAnalysis = {
      ...(questionnaireData?.analysis || {}),
      attributes: groupedAttributes  // Use the grouped attributes from Step 2
    };
    
    console.log('[AI Workflow Step 3] Complete AI analysis:', {
      conjointSection: completeAiAnalysis.conjointSection,
      products: completeAiAnalysis.products?.length || 0,
      attributes: completeAiAnalysis.attributes?.length || 0
    });
    console.log('[AI Workflow Step 3] Normalized attributes count:', normalizedAttributes.length);
    console.log('[AI Workflow Step 3] Attribute analysis data sample:', {
      hasAttributeAnalysisData: !!attributeAnalysisData,
      hasAttributes: !!attributeAnalysisData?.attributes,
      attributesCount: attributeAnalysisData?.attributes?.length || 0,
      hasNormalizedAttributes: !!attributeAnalysisData?.normalizedAttributes,
      normalizedAttributesCount: attributeAnalysisData?.normalizedAttributes?.length || 0
    });

    // Store analysis data temporarily in workflow store with temp ID
    const tempId = `temp-ai-${Date.now()}`;
    const workflows = await loadWorkflows();
    
    workflows.push({
      id: tempId,
      projectId,
      attributes: normalizedAttributes,
      designMatrix,
      designSummary,
      warnings: [],
      sourceFileName: designFile.originalname,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      aiGenerated: true,
      aiAnalysis: completeAiAnalysis,
      temporary: true  // Mark as temporary
    });
    await saveWorkflows(workflows);

    console.log('[AI Workflow Step 3] Analysis complete, workflow created with temp ID:', tempId);

    // Get sample rows for display (first 3 rows)
    const sampleRows = designMatrix.slice(0, 3).map(row => {
      const sampleRow = {};
      Object.keys(row).forEach(key => {
        sampleRow[key] = String(row[key] || '').trim();
      });
      return sampleRow;
    });

    // Get all column names
    const allColumns = designMatrix.length > 0 ? Object.keys(designMatrix[0]) : [];
    
    // Identify Task, Concept, and Version columns
    const taskColumn = allColumns.find(col => /task/i.test(col));
    const conceptColumn = allColumns.find(col => /concept/i.test(col) || /alt/i.test(col));
    const versionColumn = allColumns.find(col => /version/i.test(col));
    
    // Extract unique concept values from design matrix if concept column found
    let conceptValues = [];
    if (conceptColumn && designMatrix.length > 0) {
      const conceptValueSet = new Set();
      designMatrix.forEach(row => {
        const val = row[conceptColumn];
        if (val !== undefined && val !== null && val !== '') {
          conceptValueSet.add(String(val).trim());
        }
      });
      conceptValues = Array.from(conceptValueSet).sort((a, b) => {
        const aNum = parseInt(a);
        const bNum = parseInt(b);
        if (!isNaN(aNum) && !isNaN(bNum)) return aNum - bNum;
        return a.localeCompare(b);
      });
      console.log(`[AI Workflow Step 3] Found Concept column '${conceptColumn}' with ${conceptValues.length} unique values: [${conceptValues.join(', ')}]`);
    }

    // Return analysis result for user review with detailed information
    res.status(200).json({
      step: 3,
      success: true,
      tempWorkflowId: tempId,
      analysis: {
        designSummary: {
          totalRows: designSummary.totalRows,
          attColumnCount: designSummary.attColumnCount,
          attColumns: designSummary.attColumns, // Include actual column names
          versions: designSummary.versions,
          attributeCoverage: designSummary.attributeCoverage,
          allColumns: allColumns, // All columns found
          identifiedColumns: {
            taskColumn: taskColumn || null,
            conceptColumn: conceptColumn || null,
            versionColumn: versionColumn || null,
            conceptValues: conceptValues // Add concept values for user verification
          },
          sampleRows: sampleRows // First 3 rows for preview
        }
      },
      questionnaireAnalysis: questionnaireData?.analysis || null,
      attributeAnalysis: attributeAnalysis?.analysis || null,
      message: 'Design matrix analysis complete. Review all results and create workflow when ready.'
    });
  } catch (error) {
    console.error('[AI Workflow Step 3] Error during design analysis:', error);
    res.status(500).json({
      detail: 'Failed to analyze design file',
      message: error.message
    });
  }
});

// Legacy endpoint - keep for backwards compatibility but mark as deprecated
router.post('/ai-workflow/analyze', upload.fields([
  { name: 'questionnaire', maxCount: 1 },
  { name: 'attributeList', maxCount: 1 },
  { name: 'designFile', maxCount: 1 }
]), async (req, res) => {
  try {
    const { projectId } = req.body;

    if (!projectId) {
      return res.status(400).json({ detail: 'projectId is required' });
    }

    const questionnaireFile = req.files?.questionnaire?.[0];
    const attributeListFile = req.files?.attributeList?.[0];
    const designFile = req.files?.designFile?.[0];

    if (!questionnaireFile || !attributeListFile || !designFile) {
      return res.status(400).json({ detail: 'All three files are required: questionnaire, attributeList, and designFile' });
    }

    console.log('[AI Workflow] [DEPRECATED] Using legacy analyze endpoint - please use step-by-step endpoints');
    console.log('[AI Workflow] Starting analysis for project:', projectId);
    console.log('[AI Workflow] Files received:', {
      questionnaire: questionnaireFile.originalname,
      attributeList: attributeListFile.originalname,
      designFile: designFile.originalname
    });

    // Step 1: Parse Word document
    console.log('[AI Workflow] Parsing questionnaire document...');
    const questionnaireText = await mammoth.extractRawText({ buffer: questionnaireFile.buffer });
    const fullText = questionnaireText.value;

    // Step 2: Use OpenAI to analyze questionnaire and extract conjoint information
    console.log('[AI Workflow] Analyzing with OpenAI...');
      const aiPrompt = `You are analyzing a market research questionnaire to identify and extract information about a conjoint analysis exercise.

Please analyze the following questionnaire and extract:
1. The section identifier/name where the conjoint exercise appears (e.g., "Section C", "Part 3", "SMA DEMAND CONJOINT", etc.)
2. ALL product/brand names mentioned in market share questions - look for questions asking about current market share, patient share, or usage share. These could be in tables, lists, or question text. Include ALL products mentioned, not just the first few.
3. A brief description of what the conjoint is measuring
4. The question identifier for market share questions (e.g., C2, Q15, S13, etc.)

IMPORTANT: Look carefully for ALL products mentioned in market share questions. Don't stop at 3 products - there may be 8 or more products listed. Look for:
- Tables with product names and percentage columns
- Questions asking "What percentage of your patients currently use..."
- Lists of products with share questions
- Any mention of current market share or usage
- "Other" options, "Other (specify)", "Other brand", "None of these", "Don't know", or similar catch-all categories
- Generic options like "Other", "Other (please specify)", "Other brand", "None", "Not applicable"

Format your response as JSON with this structure:
{
  "conjointSection": "the section identifier",
  "sectionDescription": "brief description of what this section measures",
  "products": ["product1", "product2", "product3", "product4", "product5", "product6", "product7", "product8", ...],
  "marketShareQuestion": "the question number or identifier asking about market share"
}

Questionnaire text:
${fullText.substring(0, 20000)}`;

    const openai = getOpenAIClient();
    const aiResponse = await openai.chat.completions.create({
      model: "gpt-4o",
      messages: [
        {
          role: "system",
          content: "You are an expert at analyzing market research questionnaires and extracting structured information about conjoint analysis exercises."
        },
        {
          role: "user",
          content: aiPrompt
        }
      ],
      response_format: { type: "json_object" },
      temperature: 0.3
    });

    const aiAnalysis = JSON.parse(aiResponse.choices[0].message.content);
    console.log('[AI Workflow] AI Analysis:', aiAnalysis);

      // Step 3: Parse attribute list using AI (more flexible than rigid column matching)
      console.log('[AI Workflow] Parsing attribute list with AI...');
      const attributeWorkbook = XLSX.read(attributeListFile.buffer, { type: 'buffer' });
      // Prefer a sheet containing "attribute" in the name if available
      let attributeSheetName = attributeWorkbook.SheetNames.find(n => /attribute/i.test(String(n))) || attributeWorkbook.SheetNames[0];
      const attributeSheet = attributeWorkbook.Sheets[attributeSheetName];
      const attributeData = XLSX.utils.sheet_to_json(attributeSheet, { defval: '', raw: false });

      // Convert ALL attribute data to text for AI analysis - we need to see the full file
      const attributeText = attributeData.map((row, i) => {
        const rowText = Object.entries(row)
          .filter(([key, value]) => value && String(value).trim())
          .map(([key, value]) => `${key}: ${value}`)
          .join(' | ');
        return `Row ${i}: ${rowText}`;
      }).join('\n');

      console.log('[AI Workflow] Attribute sheet:', attributeSheetName);
      console.log('[AI Workflow] Total attribute data rows:', attributeData.length);
      console.log('[AI Workflow] Sample attribute data for AI:', attributeText.substring(0, 1000));
      console.log('[AI Workflow] Full attribute text length:', attributeText.length);

      // Use AI to parse the attribute structure
      const attributePrompt = `You are analyzing an Excel file containing conjoint analysis attributes and levels. 

CRITICAL: This file contains exactly 20 attributes (numbered 1-20). You must find ALL 20 attributes, not just the first few.

The structure is:
- Each attribute starts with a row where ATTRIBUTES column has a number (1, 2, 3, etc.) and __EMPTY column has the attribute name
- The following rows have empty ATTRIBUTES column but LEVEL column has numbers (1, 2, 3, etc.) and __EMPTY_1 column has the level descriptions
- This pattern repeats for each of the 20 attributes

Example pattern:
Row 0: ATTRIBUTES: 1 | __EMPTY: Attribute Name | LEVEL: 1 | __EMPTY_1: Level 1 description
Row 1: ATTRIBUTES: | __EMPTY: | LEVEL: 2 | __EMPTY_1: Level 2 description
Row 2: ATTRIBUTES: | __EMPTY: | LEVEL: 3 | __EMPTY_1: Level 3 description
Row 5: ATTRIBUTES: 2 | __EMPTY: Next Attribute Name | LEVEL: 1 | __EMPTY_1: Level 1 description

You must scan through ALL rows to find attributes 1 through 20. Do not stop after finding just a few attributes.

Format your response as JSON with this structure:
{
  "attributes": [
    {
      "attributeNo": "1",
      "attributeText": "Attribute Name",
      "levels": [
        {
          "levelNo": "1", 
          "levelText": "Level Description",
          "code": "optional code if available"
        }
      ]
    }
  ]
}

Data to analyze (scan ALL rows to find all 20 attributes):
${attributeText}`;

      const attributeAIResponse = await openai.chat.completions.create({
        model: "gpt-4o",
        messages: [
          {
            role: "system",
            content: "You are an expert at parsing conjoint analysis attribute files and extracting structured attribute/level information from various Excel formats."
          },
          {
            role: "user",
            content: attributePrompt
          }
        ],
        response_format: { type: "json_object" },
        temperature: 0.3
      });

      const aiAttributeAnalysis = JSON.parse(attributeAIResponse.choices[0].message.content);
      console.log('[AI Workflow] AI Attribute Analysis:', aiAttributeAnalysis);

      // Convert AI analysis to normalized format
      const normalizedAttributes = [];
      if (aiAttributeAnalysis.attributes && Array.isArray(aiAttributeAnalysis.attributes)) {
        aiAttributeAnalysis.attributes.forEach(attr => {
          if (attr.levels && Array.isArray(attr.levels)) {
            attr.levels.forEach(level => {
              normalizedAttributes.push({
                code: level.code || level.levelNo || '',
                attributeNo: attr.attributeNo || '',
                attributeText: attr.attributeText || '',
                levelNo: level.levelNo || '',
                levelText: level.levelText || ''
              });
            });
          }
        });
      }

      console.log('[AI Workflow] Found', normalizedAttributes.length, 'attribute levels via AI parsing');

    // Step 4: Parse design file
    console.log('[AI Workflow] Parsing design file...');
    const designWorkbook = XLSX.read(designFile.buffer, { type: 'buffer' });
    console.log('[AI Workflow] Design file has sheets:', designWorkbook.SheetNames);
    
    // Use second sheet if available (experimental design with Task/Concept/Attribute columns)
    // Otherwise use first sheet
    let designSheetName;
    let designSheet;
    if (designWorkbook.SheetNames.length >= 2) {
      designSheetName = designWorkbook.SheetNames[1];
      designSheet = designWorkbook.Sheets[designSheetName];
      console.log('[AI Workflow] Using second sheet for design matrix:', designSheetName);
    } else {
      designSheetName = designWorkbook.SheetNames[0];
      designSheet = designWorkbook.Sheets[designSheetName];
      console.log('[AI Workflow] Only one sheet found, using first sheet:', designSheetName);
    }
    
    const designMatrix = XLSX.utils.sheet_to_json(designSheet, { defval: '', raw: false });
    
    // Log sample columns to understand structure
    if (designMatrix.length > 0) {
      const sampleCols = Object.keys(designMatrix[0]);
      console.log('[AI Workflow] Design matrix columns (sample):', sampleCols.slice(0, 10));
    }

    console.log('[AI Workflow] Design matrix has', designMatrix.length, 'rows');

    // Calculate design summary
    const designSummary = calculateDesignSummary(designMatrix, normalizedAttributes);

    console.log('[AI Workflow] Analysis complete, returning preview...');

      // Group attributes by attribute number for display
      const attributeGroups = new Map();
      normalizedAttributes.forEach(attr => {
        const key = String(attr.attributeNo || '').trim();
        if (!key) return;
        if (!attributeGroups.has(key)) {
          attributeGroups.set(key, {
            attributeNo: key,
            attributeText: attr.attributeText,
            levels: []
          });
        }
        attributeGroups.get(key).levels.push({
          code: attr.code,
          levelNo: attr.levelNo,
          levelText: attr.levelText
        });
      });

      const groupedAttributes = Array.from(attributeGroups.values());

    // Store analysis data temporarily in workflow store with temp ID
    const tempId = `temp-ai-${Date.now()}`;
    const workflows = await loadWorkflows();
    
    // Combine questionnaire analysis with attribute analysis
    const completeAiAnalysis = {
      ...aiAnalysis,
      attributes: groupedAttributes
    };
    
    workflows.push({
      id: tempId,
      projectId,
      attributes: normalizedAttributes,
      designMatrix,
      designSummary,
      warnings: [],
      sourceFileName: designFile.originalname,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      aiGenerated: true,
      aiAnalysis: completeAiAnalysis,
      temporary: true  // Mark as temporary
    });
    await saveWorkflows(workflows);

    // Return analysis preview WITHOUT finalizing workflow
    const analysisResult = {
      preview: true,
      tempWorkflowId: tempId,
      conjointSection: aiAnalysis.conjointSection || 'Unknown',
      sectionDescription: aiAnalysis.sectionDescription || '',
      products: aiAnalysis.products || [],
      marketShareQuestion: aiAnalysis.marketShareQuestion || '',
      attributes: groupedAttributes,
      designSummary: {
        totalRows: designSummary.totalRows,
        attColumnCount: designSummary.attColumnCount,
        versions: designSummary.versions,
        attributeCoverage: designSummary.attributeCoverage
      },
      totalAttributeLevels: normalizedAttributes.length,
      message: 'AI analysis completed! Review the results below and click "Create Workflow" when ready.'
    };

    res.status(200).json(analysisResult);
  } catch (error) {
    console.error('[AI Workflow] Error during analysis:', error);
    res.status(500).json({
      detail: 'Failed to analyze files',
      message: error.message
    });
  }
});

// Finalize AI-generated workflow
// Deterministic data processing for AI workflows
router.post('/ai-workflow/process-data', upload.single('file'), async (req, res) => {
  try {
    const { workflowId } = req.body;
    
    if (!workflowId) {
      return res.status(400).json({ detail: 'workflowId is required' });
    }

    if (!req.file) {
      return res.status(400).json({ detail: 'No file uploaded' });
    }

    console.log('[Data Processing] Starting deterministic data analysis for workflow:', workflowId);

    // Load workflow to get AI analysis
    const workflows = await loadWorkflows();
    const workflow = workflows.find(w => w.id === workflowId);
    
    if (!workflow) {
      return res.status(404).json({ detail: 'Workflow not found' });
    }

    if (!workflow.aiAnalysis) {
      return res.status(400).json({ detail: 'Workflow does not have AI analysis data' });
    }

    // Parse the uploaded data file
    const workbook = XLSX.read(req.file.buffer, { type: 'buffer' });
    const dataSheetName = workbook.SheetNames[0];

    // Use deterministic preprocessing instead of AI
    const { preprocessConjointData, getDetailedColumnBreakdown } = await import('../services/conjointDataPreprocessor.mjs');
    
    // Get existing column mapping from workflow if available (may be null on first upload)
    const existingColumnMapping = workflow?.survey?.summary?.columnMapping || null;
    
    // Skip product extraction since we'll use AI-identified products instead
    // Pass column mapping if available (will be used after AI analysis completes)
    const preprocessingResult = preprocessConjointData(workbook, dataSheetName, { 
      skipProductExtraction: true,
      columnMapping: existingColumnMapping
    });
    let columnBreakdown = getDetailedColumnBreakdown(preprocessingResult);

    console.log('[Data Processing] Preprocessing complete:', preprocessingResult.summary);

    // Save the uploaded file to disk for estimation to use later
    const workflowUploadDir = path.join(WORKFLOW_UPLOAD_ROOT, workflowId);
    await fs.mkdir(workflowUploadDir, { recursive: true });
    
    const timestamp = Date.now();
    const storedFileName = `${timestamp}_${req.file.originalname}`;
    const filePath = path.join(workflowUploadDir, storedFileName);
    await fs.writeFile(filePath, req.file.buffer);
    console.log('[Data Processing] Saved survey file to:', filePath);

    // Process market share data using deterministic preprocessing
    const marketShareProducts = [];
    const { marketShareScenarios, productNameMap } = preprocessingResult;

    // Map AI analysis products to row numbers - OVERRIDE Datamap names
    // BUT if we already have marketShareProducts from the survey, use those instead
    try {
      console.log('[Data Processing] DEBUG - workflow.survey exists?', !!workflow?.survey);
      console.log('[Data Processing] DEBUG - workflow.survey.summary exists?', !!workflow?.survey?.summary);
      console.log('[Data Processing] DEBUG - workflow.survey.summary.marketShareProducts:', workflow?.survey?.summary?.marketShareProducts);

      const existingMarketShareProducts = workflow?.survey?.summary?.marketShareProducts;

      // Prefer existing market share products over AI analysis
      if (existingMarketShareProducts && Array.isArray(existingMarketShareProducts) && existingMarketShareProducts.length > 0) {
        console.log('[Data Processing] Using existing market share products from survey:', existingMarketShareProducts.map(p => p.name));

        // Map existing products to their row numbers
        existingMarketShareProducts.forEach(product => {
          if (product.rowNumber && product.name) {
            productNameMap.set(product.rowNumber, product.name);
            console.log(`[Data Processing] Preserved row ${product.rowNumber} = "${product.name}"`);
          }
        });

        // ALSO check if AI identified products that are NOT in the existing list
        // This ensures "Other"/"None" products are included even if they were missing from initial upload
        if (workflow?.aiAnalysis?.products && Array.isArray(workflow.aiAnalysis.products)) {
          const aiProducts = workflow.aiAnalysis.products
            .map(p => (typeof p === 'string' ? p : (p?.name || p?.label || '')))
            .filter(Boolean);

          const existingProductNames = new Set(existingMarketShareProducts.map(p => p.name));
          const missingAiProducts = aiProducts.filter(p => !existingProductNames.has(p));

          if (missingAiProducts.length > 0) {
            console.log('[Data Processing] Found AI-identified products missing from existing list:', missingAiProducts);

            // Gather all row numbers present in market share scenarios
            const allRowNumbers = new Set();
            Object.values(marketShareScenarios.original).forEach(taskProducts => {
              Object.values(taskProducts).forEach(product => {
                if (typeof product.rowNumber === 'number') {
                  allRowNumbers.add(product.rowNumber);
                }
              });
            });

            const sortedRowNumbers = Array.from(allRowNumbers).sort((a, b) => a - b);

            // Map missing products using intelligent mapping (Other/None → highest rows)
            const otherProducts = missingAiProducts.filter(p => p.toLowerCase().includes('other') || p.toLowerCase().includes('none'));
            const namedMissingProducts = missingAiProducts.filter(p => !p.toLowerCase().includes('other') && !p.toLowerCase().includes('none'));

            // Find unused row numbers
            const usedRows = new Set(existingMarketShareProducts.map(p => p.rowNumber));
            const unusedRows = sortedRowNumbers.filter(r => !usedRows.has(r));

            // Map "Other"/"None" products to highest unused row numbers
            otherProducts.forEach((productName, index) => {
              const rowNumber = unusedRows[unusedRows.length - 1 - index];
              if (rowNumber) {
                productNameMap.set(rowNumber, productName);
                console.log(`[Data Processing] Added missing product: row ${rowNumber} = "${productName}" (Other/None option)`);
              }
            });

            // Map other missing named products to lowest unused row numbers
            namedMissingProducts.forEach((productName, index) => {
              const rowNumber = unusedRows[index];
              if (rowNumber) {
                productNameMap.set(rowNumber, productName);
                console.log(`[Data Processing] Added missing product: row ${rowNumber} = "${productName}"`);
              }
            });
          }
        }

        // Sync market share scenarios with existing product names
        Object.values(marketShareScenarios.original).forEach(taskProducts => {
          Object.values(taskProducts).forEach(product => {
            const updatedName = productNameMap.get(product.rowNumber);
            if (updatedName) {
              product.productName = updatedName;
            }
          });
        });
        Object.values(marketShareScenarios.withNewOptions).forEach(taskProducts => {
          Object.values(taskProducts).forEach(product => {
            const updatedName = productNameMap.get(product.rowNumber);
            if (updatedName) {
              product.productName = updatedName;
            }
          });
        });

        // Update preprocessing summary to include ALL mapped products (existing + missing)
        const allMappedProducts = Array.from(productNameMap.entries())
          .map(([rowNumber, name]) => ({ rowNumber, name }))
          .sort((a, b) => a.rowNumber - b.rowNumber);
        preprocessingResult.summary.products = allMappedProducts;

        // Rebuild column breakdown so product names reflect preserved names
        columnBreakdown = getDetailedColumnBreakdown(preprocessingResult);
      } else if (workflow?.aiAnalysis?.products && Array.isArray(workflow.aiAnalysis.products)) {
        // Fallback to AI products if no existing market share products
        const aiProducts = workflow.aiAnalysis.products
          .map(p => (typeof p === 'string' ? p : (p?.name || p?.label || '')))
          .filter(Boolean);

        console.log('[Data Processing] Mapping AI products to row numbers:', aiProducts);
        
        // Gather all row numbers present in market share scenarios
        const allRowNumbers = new Set();
        Object.values(marketShareScenarios.original).forEach(taskProducts => {
          Object.values(taskProducts).forEach(product => {
            if (typeof product.rowNumber === 'number') {
              allRowNumbers.add(product.rowNumber);
            }
          });
        });
        Object.values(marketShareScenarios.withNewOptions).forEach(taskProducts => {
          Object.values(taskProducts).forEach(product => {
            if (typeof product.rowNumber === 'number') {
              allRowNumbers.add(product.rowNumber);
            }
          });
        });

        // Fallback to any keys already in the product map if scenarios were empty
        if (allRowNumbers.size === 0) {
          productNameMap.forEach((_, rowNumber) => allRowNumbers.add(rowNumber));
        }

        const sortedRowNumbers = Array.from(allRowNumbers).sort((a, b) => a - b);

        // Assign AI product names to the appropriate row numbers
        // Map named products to first rows, "Other"/"None" to highest row
        const assignedRowNumbers = new Set();
        const namedProducts = aiProducts.filter(p => {
          const lowerP = p.toLowerCase();
          return !lowerP.includes('other') && 
                 !lowerP.includes('none') && 
                 !lowerP.includes('don\'t know') &&
                 !lowerP.includes('dont know') &&
                 !lowerP.includes('not applicable') &&
                 !lowerP.includes('na') &&
                 !lowerP.includes('n/a') &&
                 !lowerP.includes('specify') &&
                 !lowerP.includes('please specify');
        });
        const otherProducts = aiProducts.filter(p => {
          const lowerP = p.toLowerCase();
          return lowerP.includes('other') || 
                 lowerP.includes('none') || 
                 lowerP.includes('don\'t know') ||
                 lowerP.includes('dont know') ||
                 lowerP.includes('not applicable') ||
                 lowerP.includes('na') ||
                 lowerP.includes('n/a') ||
                 lowerP.includes('specify') ||
                 lowerP.includes('please specify');
        });

        // Map named products to first rows
        namedProducts.forEach((productName, index) => {
          const rowNumber = sortedRowNumbers[index] ?? (index + 1);
          productNameMap.set(rowNumber, productName);
          assignedRowNumbers.add(rowNumber);
          console.log(`[Data Processing] Mapped row ${rowNumber} to "${productName}"`);
        });

        // Map "Other"/"None" products to highest row numbers
        otherProducts.forEach((productName, index) => {
          // Start from the end of sorted rows for "Other" options
          const rowNumber = sortedRowNumbers[sortedRowNumbers.length - 1 - index];
          if (rowNumber) {
            productNameMap.set(rowNumber, productName);
            assignedRowNumbers.add(rowNumber);
            console.log(`[Data Processing] Mapped row ${rowNumber} to "${productName}" (Other/None option)`);
          }
        });

        console.log(`[Data Processing] AI identified ${aiProducts.length} products, mapped to ${assignedRowNumbers.size} rows. Ignoring ${sortedRowNumbers.length - assignedRowNumbers.size} unmapped rows.`);

        // DO NOT add generic names for unmapped rows - those are likely "None of these" options
        // Only the AI-identified products should be included in the simulator

        // Ensure unique names only for the AI-identified products
        const seenNames = new Set();
        Array.from(assignedRowNumbers).sort((a, b) => a - b).forEach(rowNumber => {
          let finalName = String(productNameMap.get(rowNumber) || '').trim();
          if (!finalName || seenNames.has(finalName)) {
            finalName = `Product ${rowNumber}`;
          }
          seenNames.add(finalName);
          productNameMap.set(rowNumber, finalName);
        });

        // Sync market share scenarios with updated product names
        Object.values(marketShareScenarios.original).forEach(taskProducts => {
          Object.values(taskProducts).forEach(product => {
            const updatedName = productNameMap.get(product.rowNumber);
            if (updatedName) {
              product.productName = updatedName;
            }
          });
        });
        Object.values(marketShareScenarios.withNewOptions).forEach(taskProducts => {
          Object.values(taskProducts).forEach(product => {
            const updatedName = productNameMap.get(product.rowNumber);
            if (updatedName) {
              product.productName = updatedName;
            }
          });
        });

        // Update preprocessing summary with ONLY the AI-identified products (ordered by row number)
        preprocessingResult.summary.products = Array.from(assignedRowNumbers).sort((a, b) => a - b).map(rowNumber => ({
          rowNumber,
          name: productNameMap.get(rowNumber)
        }));

        // Rebuild column breakdown so product names reflect overrides
        columnBreakdown = getDetailedColumnBreakdown(preprocessingResult);
      }
    } catch (aiNameError) {
      console.warn('AI product name mapping failed:', aiNameError);
    }

    // Process original scenario (c1) market share data
    // ONLY process products that were identified by AI (exist in productNameMap)
    Object.entries(marketShareScenarios.original).forEach(([task, products]) => {
      Object.values(products).forEach(product => {
        // Skip products that weren't identified by AI (e.g., "None of these" options)
        if (!productNameMap.has(product.rowNumber)) {
          console.log(`[Data Processing] Skipping row ${product.rowNumber} - not an AI-identified product`);
          return;
        }

        const existingProduct = marketShareProducts.find(p => p.name === product.productName);

        if (!existingProduct) {
          // Calculate average market share across all tasks for this product
          let totalShare = 0;
          let taskCount = 0;
          
          Object.values(marketShareScenarios.original).forEach(taskProducts => {
            const taskProduct = Object.values(taskProducts).find(p => p.productName === product.productName);
            if (taskProduct) {
              // Calculate average for this task - treat blank/missing values as 0
              let taskShare = 0;
              const totalRows = preprocessingResult.surveyRows.length;

              preprocessingResult.surveyRows.forEach(row => {
                const value = parseFloat(row[taskProduct.columnName]);
                // Treat blank/missing/invalid values as 0
                if (!isNaN(value) && value >= 0 && value <= 100) {
                  taskShare += value;
                } else {
                  // Blank or invalid value = 0
                  taskShare += 0;
                }
              });

              if (totalRows > 0) {
                totalShare += taskShare / totalRows;
                taskCount++;
              }
            }
          });
          
          if (taskCount > 0) {
            const avgShare = totalShare / taskCount;
            console.log(`[Market Share Debug] Product "${productNameMap.get(product.rowNumber) || product.productName}" (row ${product.rowNumber}): avgShare = ${avgShare}, totalShare = ${totalShare}, taskCount = ${taskCount}`);

            // Convert percentage to decimal (assume all values are percentages)
            const shareAsDecimal = avgShare / 100;
            console.log(`[Market Share Debug] After conversion: shareAsDecimal = ${shareAsDecimal}`);

            marketShareProducts.push({
              name: productNameMap.get(product.rowNumber) || product.productName,
              currentShare: shareAsDecimal,
              adjustedShare: shareAsDecimal,
              rowNumber: product.rowNumber
            });
          }
        }
      });
    });

    // Create comprehensive column breakdown for frontend
    const allRelevantColumns = [
      ...columnBreakdown.choiceColumns,
      ...columnBreakdown.versionColumn,
      ...columnBreakdown.attributeColumns,
      ...columnBreakdown.marketShareScenarios.original,
      ...columnBreakdown.marketShareScenarios.withNewOptions
    ];

    // Get attribute columns from columnBreakdown (which contains the actual column names)
    const attributeColumnsArray = columnBreakdown.attributeColumns.map(col => 
      typeof col === 'string' ? col : col.columnName
    ).filter(Boolean);

    // Update workflow with processed data
    const updatedWorkflow = {
      ...workflow,
      survey: {
        uploadedAt: new Date().toISOString(),
        fileName: req.file.originalname,
        storedFileName: storedFileName, // Save the stored file name for estimation endpoint
        summary: {
          totalRows: preprocessingResult.summary.cleanedRows,
          relevantColumns: allRelevantColumns,
          marketShareProducts: marketShareProducts,
          marketShareScenarios: {
            original: columnBreakdown.marketShareScenarios.original,
            withNewOptions: columnBreakdown.marketShareScenarios.withNewOptions
          },
          products: preprocessingResult.summary.products,
          dataSummary: {
            totalRows: preprocessingResult.summary.totalRows,
            relevantColumnCount: allRelevantColumns.length,
            choiceColumns: preprocessingResult.summary.relevantColumns.choice,
            marketShareColumns: preprocessingResult.summary.relevantColumns.marketShare,
            attributeColumns: attributeColumnsArray  // Store actual array of column names, not count
          }
        }
      },
      updatedAt: new Date().toISOString()
    };

    // Update workflow in storage
    const workflowIndex = workflows.findIndex(w => w.id === workflowId);
    workflows[workflowIndex] = updatedWorkflow;
    await saveWorkflows(workflows);

    console.log('[AI Data Processing] Data processing complete for workflow:', workflowId);

    // Perform AI analysis to map design matrix to data file columns
    console.log('[AI Data Processing] Starting AI column mapping analysis...');
    let columnMapping = null;
    try {
      // Read the second sheet (column definitions) if available
      const secondSheetName = workbook.SheetNames.length > 1 ? workbook.SheetNames[1] : null;
      let columnDefinitionsSheet = null;
      if (secondSheetName) {
        columnDefinitionsSheet = workbook.Sheets[secondSheetName];
      }

      // Get ONLY column headers from the data file (no data values)
      const allColumnNames = [];
      if (workbook.Sheets[dataSheetName]) {
        // Read just the header row to get column names
        const headerRange = XLSX.utils.decode_range(workbook.Sheets[dataSheetName]['!ref'] || 'A1');
        // Get header row (first row)
        for (let col = headerRange.s.c; col <= headerRange.e.c; col++) {
          const cellAddress = XLSX.utils.encode_cell({ r: 0, c: col });
          const cell = workbook.Sheets[dataSheetName][cellAddress];
          if (cell && cell.v) {
            allColumnNames.push(String(cell.v).trim());
          }
        }
      }
      
      // Get column definitions from second tab if available (this is metadata about columns)
      let columnDefinitionsText = '';
      if (columnDefinitionsSheet) {
        const defRows = XLSX.utils.sheet_to_json(columnDefinitionsSheet, { defval: '', raw: false });
        columnDefinitionsText = defRows.slice(0, 50).map((row, i) => {
          const rowText = Object.entries(row)
            .filter(([key, value]) => value && String(value).trim())
            .map(([key, value]) => `${key}: ${value}`)
            .join(' | ');
          return `Row ${i}: ${rowText}`;
        }).join('\n');
      }

      // Prepare design matrix info for AI (column structure only)
      const designMatrixInfo = workflow.designMatrix ? 
        workflow.designMatrix.slice(0, 20).map((row, i) => {
          const rowText = Object.entries(row)
            .filter(([key, value]) => value && String(value).trim())
            .map(([key, value]) => `${key}: ${value}`)
            .join(' | ');
          return `Row ${i}: ${rowText}`;
        }).join('\n') : '';

      // Prepare attribute info
      const attributeInfo = workflow.attributes ? 
        workflow.attributes.map(attr => 
          `Attribute ${attr.attributeNo}: ${attr.attributeText} (Levels: ${attr.levelText || 'N/A'})`
        ).join('\n') : '';

      // Prepare ALL column headers from data file (sorted for easier analysis)
      const sortedColumnNames = [...allColumnNames].sort();
      const columnHeadersList = sortedColumnNames.map((col, idx) => `${idx + 1}. ${col}`).join('\n');

      // Create AI prompt for column mapping - ONLY using column headers
      const openai = getOpenAIClient();
      const mappingPrompt = `You are analyzing a conjoint analysis data file to map the experimental design to the actual data column HEADERS (column names only - no data values).

**DESIGN MATRIX (from Step 3):**
This shows the experimental design structure with Task, Concept/Alt, and attribute columns (e.g., hATTR_1, ATT1, etc.):
${designMatrixInfo || 'No design matrix available'}

**ATTRIBUTES (from Step 2):**
${attributeInfo || 'No attributes available'}

**COLUMN DEFINITIONS (from second tab of data file, if available - this explains what the columns mean):**
${columnDefinitionsText || 'No column definitions sheet found'}

**ALL COLUMN HEADERS FROM DATA FILE (first tab - these are the actual column names to map):**
${columnHeadersList || 'No columns found'}

**QUESTIONNAIRE INFO:**
- Products: ${workflow?.aiAnalysis?.products?.join(', ') || 'N/A'}
- Market Share Question: ${workflow?.aiAnalysis?.marketShareQuestion || 'N/A'}

**TASK:**
Analyze ONLY the column headers (column names) from the data file and map them to the design matrix elements. DO NOT use data values - only use the column names themselves.

For each design element, identify:
1. Which column headers in the data file represent that element
2. How the column naming convention works (e.g., hATTR_GORE_1c1 means task 1, concept 1)
3. How choice columns are named (e.g., QC1_1, QC1_2, QS3r1, QS3r2)
4. How market share columns are named (e.g., QC2_1r1c1, QC2_1r1c2)

Return a JSON mapping with this structure:
{
  "columnMapping": [
    {
      "designElement": "Task Column",
      "dataFileColumn": "column name or pattern",
      "description": "explanation of the mapping",
      "pattern": "regex pattern if applicable"
    },
    {
      "designElement": "Concept/Product Column", 
      "dataFileColumn": "column name or pattern",
      "description": "explanation"
    },
    {
      "designElement": "Attribute 1 - [Attribute Name]",
      "dataFileColumns": ["hATTR_GORE_1c1", "hATTR_GORE_2c1", ...],
      "description": "how attribute 1 is represented across tasks/concepts",
      "pattern": "hATTR_GORE_*c*"
    },
    {
      "designElement": "Choice Columns",
      "dataFileColumns": ["QC1_1", "QC1_2", ...],
      "description": "how choice responses are stored",
      "pattern": "QC1_* or QS3r*"
    },
    {
      "designElement": "Market Share Columns - Original",
      "dataFileColumns": ["QC2_1r1c1", "QC2_1r2c1", ...],
      "description": "how original market shares are stored",
      "pattern": "QC2_*r*c1"
    },
    {
      "designElement": "Market Share Columns - With New Options",
      "dataFileColumns": ["QC2_1r1c2", "QC2_1r2c2", ...],
      "description": "how market shares with new options are stored",
      "pattern": "QC2_*r*c2"
    }
  ],
  "columnNamingConvention": {
    "taskExtraction": "how task number is extracted from column names",
    "conceptExtraction": "how concept/product number is extracted",
    "attributeExtraction": "how attribute number is extracted",
    "examples": ["example1", "example2"]
  },
  "summary": {
    "totalAttributesMapped": 20,
    "totalChoiceColumns": 15,
    "totalMarketShareColumns": 75,
    "mappingConfidence": "high/medium/low"
  }
}`;

      const mappingAIResponse = await openai.chat.completions.create({
        model: "gpt-4o",
        messages: [
          {
            role: "system",
            content: "You are an expert at analyzing conjoint analysis data files and mapping experimental design elements to actual data column names and patterns."
          },
          {
            role: "user",
            content: mappingPrompt
          }
        ],
        response_format: { type: "json_object" },
        temperature: 0.2
      });

      columnMapping = JSON.parse(mappingAIResponse.choices[0].message.content);
      console.log('[AI Data Processing] Column mapping analysis complete:', columnMapping);
      
      // Build detailed task/concept/attribute -> column mapping from header columns
      // This will be used during scenario matching to quickly find the right columns
      const attributeColumnMapping = {};
      
      // Get first row of data to read header column values
      const surveySheet = workbook.Sheets[dataSheetName];
      const surveyRows = XLSX.utils.sheet_to_json(surveySheet, { defval: '', raw: false });
      const firstRow = surveyRows[0] || {};
      
      // Get ALL column names from the workbook (not just from columnBreakdown)
      // This ensures we have all hATTR columns even if they weren't categorized yet
      const allColumnNamesForMapping = [];
      if (workbook.Sheets[dataSheetName]) {
        const range = XLSX.utils.decode_range(workbook.Sheets[dataSheetName]['!ref'] || 'A1');
        for (let col = range.s.c; col <= range.e.c; col++) {
          const cellAddress = XLSX.utils.encode_cell({ r: 0, c: col });
          const cell = workbook.Sheets[dataSheetName][cellAddress];
          if (cell && cell.v) {
            allColumnNamesForMapping.push(String(cell.v).trim());
          }
        }
      }
      
      // Find all hATTR columns (both from columnBreakdown and from all columns)
      const hattrColumnsFromBreakdown = columnBreakdown.attributeColumns
        .filter(col => {
          const colName = typeof col === 'string' ? col : col.columnName;
          return /^hATTR_/i.test(colName);
        })
        .map(col => typeof col === 'string' ? col : col.columnName);
      
      const hattrColumnsFromAll = allColumnNamesForMapping.filter(col => /^hATTR_/i.test(col));
      
      // Combine and deduplicate
      const hattrColumns = [...new Set([...hattrColumnsFromBreakdown, ...hattrColumnsFromAll])];
      
      console.log(`[AI Data Processing] Found ${hattrColumns.length} hATTR columns (${hattrColumnsFromBreakdown.length} from breakdown, ${hattrColumnsFromAll.length} from all columns)`);
      
      // Group columns by task/concept pattern
      // Pattern: hATTR_<BRAND>_<TASK>c<CONCEPT> or hATTR_<BRAND>_H_<TASK>c<CONCEPT>
      const taskConceptGroups = {};
      hattrColumns.forEach(colName => {
        // Try pattern with _H in the middle: hATTR_GORE_H_10c4
        let match = colName.match(/^hATTR_([A-Z0-9_]+?)_H_(\d+)c(\d+)$/i);
        let isHeader = false;
        
        if (!match) {
          // Try pattern without _H: hATTR_GORE_10c4
          match = colName.match(/^hATTR_([A-Z0-9_]+?)_(\d+)c(\d+)$/i);
          isHeader = false;
        } else {
          isHeader = true;
        }
        
        if (match) {
          const brand = match[1];
          const task = match[2];
          const concept = match[3];
          const key = `${task}_${concept}`;
          
          if (!taskConceptGroups[key]) {
            taskConceptGroups[key] = {
              task,
              concept,
              headerColumns: {},
              valueColumns: {}
            };
          }
          
          if (isHeader) {
            taskConceptGroups[key].headerColumns[brand] = colName;
          } else {
            taskConceptGroups[key].valueColumns[brand] = colName;
          }
        }
      });
      
      console.log(`[AI Data Processing] Grouped into ${Object.keys(taskConceptGroups).length} task/concept combinations`);
      
      // Extract unique concept numbers from task/concept groups
      const detectedConcepts = new Set();
      const detectedTasks = new Set();
      Object.values(taskConceptGroups).forEach(group => {
        detectedConcepts.add(group.concept);
        detectedTasks.add(group.task);
      });
      const sortedConcepts = Array.from(detectedConcepts).sort((a, b) => parseInt(a) - parseInt(b));
      const sortedTasks = Array.from(detectedTasks).sort((a, b) => parseInt(a) - parseInt(b));
      
      console.log(`[AI Data Processing] Detected ${sortedConcepts.length} unique concept numbers: [${sortedConcepts.join(', ')}]`);
      console.log(`[AI Data Processing] Detected ${sortedTasks.length} unique task numbers: [${sortedTasks.slice(0, 10).join(', ')}${sortedTasks.length > 10 ? '...' : ''}]`);
      
      // Also check for Concept column in design matrix if available
      let designMatrixConceptColumn = null;
      let designMatrixConceptValues = [];
      try {
        if (designWorkbook && designWorkbook.SheetNames.length > 0) {
          const designSheetName = designWorkbook.SheetNames[0];
          const designSheet = designWorkbook.Sheets[designSheetName];
          const designData = XLSX.utils.sheet_to_json(designSheet, { header: 1 });
          
          if (designData.length > 0) {
            const designHeaders = designData[0].map(h => String(h || '').trim().toLowerCase());
            const conceptColIndex = designHeaders.findIndex(h => 
              h === 'concept' || h === 'alt' || h === 'alternative' || h === 'product'
            );
            
            if (conceptColIndex !== -1) {
              designMatrixConceptColumn = designData[0][conceptColIndex];
              // Extract unique concept values from design matrix
              const conceptValues = new Set();
              for (let i = 1; i < designData.length; i++) {
                const val = designData[i][conceptColIndex];
                if (val !== undefined && val !== null && val !== '') {
                  conceptValues.add(String(val).trim());
                }
              }
              designMatrixConceptValues = Array.from(conceptValues).sort((a, b) => {
                const aNum = parseInt(a);
                const bNum = parseInt(b);
                if (!isNaN(aNum) && !isNaN(bNum)) return aNum - bNum;
                return a.localeCompare(b);
              });
              console.log(`[AI Data Processing] Found Concept column '${designMatrixConceptColumn}' in design matrix with values: [${designMatrixConceptValues.join(', ')}]`);
            }
          }
        }
      } catch (designError) {
        console.warn('[AI Data Processing] Could not check design matrix for Concept column:', designError.message);
      }
      
      // Build mapping: task/concept/attribute -> column
      Object.values(taskConceptGroups).forEach(group => {
        const { task, concept, headerColumns, valueColumns } = group;
        
        // For each brand, check what attribute number is in the header column
        Object.keys(valueColumns).forEach(brand => {
          // Try to find matching header column (could be brand or brand_H)
          let headerCol = headerColumns[brand];
          if (!headerCol) {
            // Try with _H suffix
            headerCol = headerColumns[`${brand}_H`];
          }
          if (!headerCol) {
            // Try without _H suffix
            headerCol = headerColumns[brand.replace('_H', '')];
          }
          
          const valueCol = valueColumns[brand];
          
          if (headerCol && valueCol && firstRow[headerCol]) {
            const attrNo = String(firstRow[headerCol]).trim();
            if (attrNo) {
              const mappingKey = `${task}_${concept}_${attrNo}`;
              if (!attributeColumnMapping[mappingKey]) {
                attributeColumnMapping[mappingKey] = [];
              }
              attributeColumnMapping[mappingKey].push({
                brand,
                headerColumn: headerCol,
                valueColumn: valueCol,
                attributeNumber: attrNo
              });
            }
          }
        });
      });
      
      console.log(`[AI Data Processing] Built attribute column mapping with ${Object.keys(attributeColumnMapping).length} task/concept/attribute combinations`);
      
      // Log sample mappings for debugging
      if (Object.keys(attributeColumnMapping).length > 0) {
        const sampleKeys = Object.keys(attributeColumnMapping).slice(0, 5);
        console.log(`[AI Data Processing] Sample mapping keys: ${sampleKeys.join(', ')}`);
        sampleKeys.forEach(key => {
          console.log(`[AI Data Processing]   ${key}: ${JSON.stringify(attributeColumnMapping[key])}`);
        });
      } else {
        console.warn(`[AI Data Processing] No mappings built! Check taskConceptGroups:`, Object.keys(taskConceptGroups).slice(0, 5));
        if (Object.keys(taskConceptGroups).length > 0) {
          const sampleGroup = Object.values(taskConceptGroups)[0];
          console.log(`[AI Data Processing] Sample group:`, JSON.stringify(sampleGroup, null, 2));
          console.log(`[AI Data Processing] Sample firstRow keys containing hATTR:`, Object.keys(firstRow).filter(k => /hATTR/i.test(k)).slice(0, 10));
        }
      }
      
      // Store the detailed mapping in columnMapping
      if (!columnMapping.attributeColumnMapping) {
        columnMapping.attributeColumnMapping = {};
      }
      columnMapping.attributeColumnMapping = attributeColumnMapping;
      
      // Store concept detection info in columnMapping for easy access
      columnMapping.conceptDetection = {
        conceptsFromHattrColumns: sortedConcepts || [],
        conceptsFromDesignMatrix: designMatrixConceptValues || [],
        designMatrixConceptColumn: designMatrixConceptColumn || null,
        totalUniqueConcepts: sortedConcepts?.length || 0,
        totalUniqueTasks: sortedTasks?.length || 0,
        recommendedConcepts: designMatrixConceptValues.length > 0 ? designMatrixConceptValues : (sortedConcepts || [])
      };

      // Store column mapping in workflow
      updatedWorkflow.survey.summary.columnMapping = columnMapping;
      
      // Re-run preprocessing with the new column mapping to get accurate categorization
      console.log('[AI Data Processing] Re-running preprocessing with AI column mapping...');
      const preprocessingResultWithMapping = preprocessConjointData(workbook, dataSheetName, { 
        skipProductExtraction: true,
        columnMapping: columnMapping
      });
      
      // Update with properly categorized columns
      const columnBreakdownWithMapping = getDetailedColumnBreakdown(preprocessingResultWithMapping);
      const attributeColumnsArrayWithMapping = columnBreakdownWithMapping.attributeColumns.map(col => 
        typeof col === 'string' ? col : col.columnName
      ).filter(Boolean);
      
      // Update the workflow with corrected categorization
      updatedWorkflow.survey.summary.dataSummary.attributeColumns = attributeColumnsArrayWithMapping;
      updatedWorkflow.survey.summary.relevantColumns = [
        ...columnBreakdownWithMapping.choiceColumns,
        ...(columnBreakdownWithMapping.versionColumn ? [columnBreakdownWithMapping.versionColumn] : []),
        ...columnBreakdownWithMapping.attributeColumns.map(c => typeof c === 'string' ? c : c.columnName),
        ...columnBreakdownWithMapping.marketShareScenarios.original,
        ...columnBreakdownWithMapping.marketShareScenarios.withNewOptions
      ];
      
      // Update workflow in storage with mapping and corrected categorization
      workflows[workflowIndex] = updatedWorkflow;
      await saveWorkflows(workflows);
    } catch (mappingError) {
      console.error('[AI Data Processing] Column mapping analysis failed:', mappingError);
      // Don't fail the entire upload if mapping fails
    }

    const aiDataAnalysis = updatedWorkflow.aiAnalysis || workflow?.aiAnalysis || null;
    
    // Extract concept detection info from columnMapping if available
    const conceptDetectionInfo = columnMapping?.conceptDetection || {
      conceptsFromHattrColumns: [],
      conceptsFromDesignMatrix: [],
      designMatrixConceptColumn: null,
      totalUniqueConcepts: 0,
      totalUniqueTasks: 0,
      recommendedConcepts: []
    };
    
    console.log(`[AI Data Processing] Returning concept detection info:`, JSON.stringify(conceptDetectionInfo, null, 2));

    res.json({
      success: true,
      workflow: updatedWorkflow,
      dataSummary: {
        totalRows: preprocessingResult.summary.cleanedRows,
        relevantColumns: allRelevantColumns.length,
        marketShareProducts: marketShareProducts.length,
        aiAnalysis: aiDataAnalysis,
        columnMapping: columnMapping,
        conceptDetection: conceptDetectionInfo
      }
    });

  } catch (error) {
    console.error('[AI Data Processing] Error:', error);
    console.error('[AI Data Processing] Error stack:', error.stack);
    res.status(500).json({
      detail: 'Failed to process data with AI',
      message: error.message || 'Unknown error occurred',
      error: process.env.NODE_ENV === 'development' ? error.stack : undefined
    });
  }
});

router.post('/ai-workflow/finalize', async (req, res) => {
  try {
    const { tempWorkflowId, name } = req.body;
    
    if (!tempWorkflowId) {
      return res.status(400).json({ detail: 'tempWorkflowId is required' });
    }

    const workflows = await loadWorkflows();
    const tempIndex = workflows.findIndex(w => w.id === tempWorkflowId && w.temporary);
    
    if (tempIndex === -1) {
      return res.status(404).json({ detail: 'Temporary workflow not found' });
    }

    const tempWorkflow = workflows[tempIndex];
    
    // Verify aiAnalysis exists and has attributes
    console.log('[AI Workflow Finalize] Temp workflow aiAnalysis:', {
      hasAiAnalysis: !!tempWorkflow.aiAnalysis,
      hasAttributes: !!tempWorkflow.aiAnalysis?.attributes,
      attributesCount: tempWorkflow.aiAnalysis?.attributes?.length || 0
    });
    
    // Create final workflow
    const finalWorkflow = {
      ...tempWorkflow,
      id: `workflow_${Date.now()}`,
      name: name || `AI Generated Workflow - ${new Date().toLocaleDateString()}`,
      temporary: false,
      finalizedAt: new Date().toISOString()
    };

    // Ensure aiAnalysis is preserved
    if (!finalWorkflow.aiAnalysis && tempWorkflow.aiAnalysis) {
      finalWorkflow.aiAnalysis = tempWorkflow.aiAnalysis;
    }

    // Replace temporary workflow with final one
    workflows[tempIndex] = finalWorkflow;
    await saveWorkflows(workflows);

    console.log('[AI Workflow] Finalized workflow:', finalWorkflow.id);
    console.log('[AI Workflow] Final workflow aiAnalysis:', {
      hasAiAnalysis: !!finalWorkflow.aiAnalysis,
      hasAttributes: !!finalWorkflow.aiAnalysis?.attributes,
      attributesCount: finalWorkflow.aiAnalysis?.attributes?.length || 0
    });

    res.json({
      success: true,
      workflow: finalWorkflow
    });

  } catch (error) {
    console.error('[AI Workflow] Finalization error:', error);
    res.status(500).json({
      detail: 'Failed to finalize workflow',
      message: error.message
    });
  }
});

router.post('/workflows/:workflowId/estimate', async (req, res) => {
  try {
    const { workflowId } = req.params;
    console.log(`[Estimation] Request received for workflow ${workflowId}`);
    if (!workflowId) {
      return res.status(400).json({ detail: 'workflowId is required in the URL path.' });
    }

    const workflows = await loadWorkflows();
    const index = workflows.findIndex(workflow => workflow.id === workflowId);
    if (index === -1) {
      return res.status(404).json({ detail: `Workflow ${workflowId} not found.` });
    }

    const workflow = workflows[index];

    // Validate that design exists
    if (!workflow.designMatrix || !Array.isArray(workflow.designMatrix) || workflow.designMatrix.length === 0) {
      return res.status(400).json({
        detail: 'Design matrix is missing or empty. Please ensure the workflow has a valid design before estimating.'
      });
    }

    if (!workflow.designSummary || typeof workflow.designSummary !== 'object') {
      return res.status(400).json({
        detail: 'Design summary is missing. Please ensure the workflow has a valid design before estimating.'
      });
    }

    // Validate that survey exists
    if (!workflow.survey || !workflow.survey.storedFileName) {
      return res.status(400).json({
        detail: 'Survey data is missing. Please upload and validate survey data before estimating utilities.'
      });
    }

    if (!workflow.survey.summary) {
      return res.status(400).json({
        detail: 'Survey summary is missing. Please re-upload and validate the survey export.'
      });
    }

    // Read the survey file from disk
    const surveyFilePath = path.join(WORKFLOW_UPLOAD_ROOT, workflowId, workflow.survey.storedFileName);
    let surveyBuffer;
    try {
      surveyBuffer = await fs.readFile(surveyFilePath);
    } catch (error) {
      console.error('Failed to read stored survey file:', error);
      return res.status(500).json({
        detail: `Failed to read stored survey file. The file may have been deleted or moved.`,
        message: error.message
      });
    }

    // Verify survey file has hATTR columns (but don't use them to filter attributes)
    // The column format is hATTR_{BRAND}_{TASK}c{SLOT} where BRAND is the product name,
    // and the VALUES in these columns are attribute codes that correspond to the 20 attributes
    const workbook = XLSX.read(surveyBuffer, { type: 'buffer' });
    const firstSheetName = workbook.SheetNames[0];
    const surveySheet = workbook.Sheets[firstSheetName];
    const surveyRows = XLSX.utils.sheet_to_json(surveySheet, { defval: '', raw: false });
    const columns = surveyRows.length > 0 ? Object.keys(surveyRows[0]) : [];

    // Check for hATTR columns to verify file format
    const attrPattern = /^hATTR_(.+?)_\d+c\d+$/i;
    const hasAttrColumns = columns.some(col => col.match(attrPattern));

    if (!hasAttrColumns) {
      return res.status(400).json({
        detail: 'No attribute columns (hATTR_*) were detected in the survey export. Please verify the survey file matches the validation template.'
      });
    }

    // Extract brand/product names from column headers for logging (not for filtering)
    const brandNames = new Set();
    for (const col of columns) {
      const match = col.match(attrPattern);
      if (match) {
        const brandName = match[1] ? match[1].toUpperCase() : '';
        if (brandName) {
          brandNames.add(brandName);
        }
      }
    }

    const preEstimationWarnings = [];
    const uniqueAttrNos = new Set((workflow.attributes || []).map(attr => String(attr?.attributeNo ?? '').trim()).filter(Boolean));
    
    // Log information about brands found (for debugging, not filtering)
    if (brandNames.size > 0) {
      console.log(`[Estimation] Found ${brandNames.size} brands/products in survey: ${Array.from(brandNames).join(', ')}`);
    }
    console.log(`[Estimation] Processing ${uniqueAttrNos.size} attributes from workflow design`);

    // Transform attributes from flat format to grouped format for Python
    // Pass ALL attributes from workflow - Python backend will extract which ones are actually used
    // Don't filter by "attributeShortNames" - those are brand names, not attributes
    const attributesGrouped = transformAttributesToGroupedFormat(workflow.attributes || [], []);
    if (!attributesGrouped.length) {
      return res.status(400).json({
        detail: 'Unable to map attribute metadata for estimation. Please re-import the attribute list and try again.'
      });
    }
    
    // Log what we're sending for debugging
    console.log(`[Estimation] Sending ${attributesGrouped.length} attributes to Python backend:`);
    attributesGrouped.slice(0, 5).forEach((attr, idx) => {
      console.log(`  ${idx + 1}. name="${attr.name}", attributeNo="${attr.attributeNo}", levels=${attr.levels?.length || 0}, sample_codes=${attr.levels?.slice(0, 3).map(l => l.code).join(',') || 'none'}`);
    });
    if (attributesGrouped.length > 5) {
      console.log(`  ... and ${attributesGrouped.length - 5} more`);
    }

    // Extract ONLY relevant columns for conjoint analysis
    // Use the workflow's identified columns from survey summary
    const relevantColumns = new Set();
    
    // Add respondent ID column (needed for data structure)
    relevantColumns.add('record');
    relevantColumns.add('uuid');
    
    // Add choice columns (from workflow survey summary)
    if (workflow.survey?.summary?.dataSummary?.choiceColumns) {
      const choiceCols = workflow.survey.summary.dataSummary.choiceColumns;
      if (Array.isArray(choiceCols)) {
        choiceCols.forEach(col => relevantColumns.add(col));
      }
    }
    
    // Add attribute columns (hATTR_*)
    if (workflow.survey?.summary?.dataSummary?.attributeColumns) {
      const attrCols = workflow.survey.summary.dataSummary.attributeColumns;
      if (Array.isArray(attrCols)) {
        attrCols.forEach(col => relevantColumns.add(col));
      }
    }
    
    // Add market share columns (QC_* and QC2_*)
    if (workflow.survey?.summary?.marketShareScenarios) {
      const original = workflow.survey.summary.marketShareScenarios.original || [];
      const withNewOptions = workflow.survey.summary.marketShareScenarios.withNewOptions || [];
      
      [original, withNewOptions].forEach(colArray => {
        if (Array.isArray(colArray)) {
          colArray.forEach(colInfo => {
            if (typeof colInfo === 'string') {
              relevantColumns.add(colInfo);
            } else if (colInfo?.columnName) {
              relevantColumns.add(colInfo.columnName);
            }
          });
        }
      });
    }
    
    // Also add version column if it exists
    if (workflow.survey?.summary?.versionColumn) {
      const versionCol = workflow.survey.summary.versionColumn;
      if (typeof versionCol === 'string') {
        relevantColumns.add(versionCol);
      } else if (versionCol?.[0]?.columnName) {
        relevantColumns.add(versionCol[0].columnName);
      }
    }
    
    // ALWAYS use preprocessing to identify columns (more reliable than relying on stored summary)
    // This ensures we get the latest column detection logic
    console.log('[Estimation] Using preprocessing to identify relevant columns...');
    const { preprocessConjointData } = await import('../services/conjointDataPreprocessor.mjs');
    
    // Get column mapping from workflow if available
    const columnMapping = workflow?.survey?.summary?.columnMapping || null;
    
    const preprocessingResult = preprocessConjointData(workbook, firstSheetName, { 
      skipProductExtraction: true,
      columnMapping: columnMapping
    });
    const { categorized } = preprocessingResult;
    
    // Add all identified columns (preprocessing is the source of truth)
    categorized.choiceColumns.forEach(col => relevantColumns.add(col));
    categorized.attributeColumns.forEach(col => relevantColumns.add(col));
    categorized.marketShareColumns.forEach(col => relevantColumns.add(col));
    if (categorized.versionColumn) {
      relevantColumns.add(categorized.versionColumn);
    }
    
    console.log(`[Estimation] Preprocessing identified:`, {
      choiceColumns: categorized.choiceColumns.length,
      attributeColumns: categorized.attributeColumns.length,
      marketShareColumns: categorized.marketShareColumns.length,
      versionColumn: categorized.versionColumn ? 1 : 0
    });
    console.log(`[Estimation] Sample choice columns:`, categorized.choiceColumns.slice(0, 10));
    console.log(`[Estimation] Sample attribute columns:`, categorized.attributeColumns.slice(0, 10));
    console.log(`[Estimation] Total relevant columns for filtering: ${relevantColumns.size} (out of ${columns.length} total columns)`);
    
    // Filter the data to only include relevant columns
    // Ensure we preserve column order and include all columns that exist in the data
    const relevantColumnsArray = Array.from(relevantColumns).filter(col => columns.includes(col));
    
    // Verify attribute columns are included
    const attributeColumnsInFiltered = relevantColumnsArray.filter(col => 
      categorized.attributeColumns.includes(col)
    );
    console.log(`[Estimation] Attribute columns in filtered data: ${attributeColumnsInFiltered.length} out of ${categorized.attributeColumns.length} identified`);
    if (attributeColumnsInFiltered.length < categorized.attributeColumns.length) {
      const missing = categorized.attributeColumns.filter(col => !relevantColumnsArray.includes(col));
      console.warn(`[Estimation] WARNING: ${missing.length} attribute columns missing from filtered data:`, missing.slice(0, 10));
    }
    
    console.log(`[Estimation] Filtering to ${relevantColumnsArray.length} columns that exist in the data`);
    console.log(`[Estimation] Sample filtered columns:`, relevantColumnsArray.slice(0, 20));
    
    let filteredRows = surveyRows.map(row => {
      const filteredRow = {};
      relevantColumnsArray.forEach(col => {
        // Include column even if value is undefined/null (preserve structure)
        filteredRow[col] = col in row ? row[col] : '';
      });
      return filteredRow;
    });
    
    // Verify we have choice columns in the filtered data
    // Match patterns: QC1_*, QS3r*, QC_*r1 (e.g., QC_1r1, QC_2r1)
    const choiceColumnsInFiltered = relevantColumnsArray.filter(col => 
      /^QC1_\d+$/i.test(col) || 
      /^QS3r\d+$/i.test(col) || 
      /^QC_\d+r1$/i.test(col)
    );
    console.log(`[Estimation] Choice columns in filtered data: ${choiceColumnsInFiltered.length}`);
    console.log(`[Estimation] Sample choice columns:`, choiceColumnsInFiltered.slice(0, 10));
    
    if (choiceColumnsInFiltered.length === 0) {
      console.error(`[Estimation] ERROR: No choice columns found in filtered data!`);
      console.error(`[Estimation] Preprocessing found ${categorized.choiceColumns.length} choice columns:`, categorized.choiceColumns.slice(0, 10));
      console.error(`[Estimation] Relevant columns array (first 50):`, relevantColumnsArray.slice(0, 50));
      
      // If no choice columns, add them explicitly from preprocessing
      categorized.choiceColumns.forEach(col => {
        if (!relevantColumnsArray.includes(col)) {
          relevantColumnsArray.push(col);
          console.log(`[Estimation] Added missing choice column: ${col}`);
        }
      });
      
      // Re-filter rows with updated columns
      filteredRows = surveyRows.map(row => {
        const filteredRow = {};
        relevantColumnsArray.forEach(col => {
          filteredRow[col] = col in row ? row[col] : '';
        });
        return filteredRow;
      });
      
      console.log(`[Estimation] After adding missing columns: ${relevantColumnsArray.length} total columns, ${categorized.choiceColumns.filter(c => relevantColumnsArray.includes(c)).length} choice columns`);
    }
    
    // Create a new Excel workbook with only relevant columns
    const filteredWorkbook = XLSX.utils.book_new();
    const filteredWorksheet = XLSX.utils.json_to_sheet(filteredRows, { 
      header: relevantColumnsArray 
    });
    XLSX.utils.book_append_sheet(filteredWorkbook, filteredWorksheet, firstSheetName);
    
    // Convert to buffer
    const filteredBuffer = XLSX.write(filteredWorkbook, { type: 'buffer', bookType: 'xlsx' });
    
    // Final verification: check what columns are actually in the filtered Excel
    const verifyWorkbook = XLSX.read(filteredBuffer, { type: 'buffer' });
    const verifySheet = verifyWorkbook.Sheets[firstSheetName];
    const verifyRows = XLSX.utils.sheet_to_json(verifySheet, { defval: '', raw: false, header: 1 });
    const verifyColumns = verifyRows.length > 0 ? verifyRows[0] : [];
    const verifyChoiceCols = verifyColumns.filter((col) => 
      /^QC1_\d+$/i.test(String(col)) || /^QS3r\d+$/i.test(String(col))
    );
    
    console.log(`[Estimation] Created filtered Excel file with ${filteredRows.length} rows and ${relevantColumnsArray.length} columns`);
    console.log(`[Estimation] Verification: Excel file contains ${verifyChoiceCols.length} choice columns:`, verifyChoiceCols.slice(0, 10));

    // Create form data to forward to Python backend with filtered file
    const formData = new FormData();
    formData.append('file', filteredBuffer, {
      filename: 'filtered_survey.xlsx',
      contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    });

    // Also send the attribute definitions so Python can properly decode the survey columns
    formData.append('attributes', JSON.stringify(attributesGrouped));

    // Call Python API
    let estimationData;
    let usedLocalFallback = false;
    try {
      const pythonResponse = await axios.post(`${PYTHON_API_URL}/estimate_from_survey_export`, formData, {
        headers: {
          ...formData.getHeaders(),
        },
        maxBodyLength: Infinity,
        timeout: 60000
      });

      estimationData = pythonResponse.data;
      
      // Log estimation results for debugging
      console.log(`[Estimation] Python backend returned:`, {
        utilitiesCount: Object.keys(estimationData.utilities || {}).length,
        schemaAttributesCount: estimationData.schema?.attributes?.length || 0,
        intercept: estimationData.intercept,
        converged: estimationData.diagnostics?.converged,
        iterations: estimationData.diagnostics?.iterations,
        pseudo_r2: estimationData.diagnostics?.pseudo_r2
      });
      
      // Log which attributes have utilities
      if (estimationData.utilities) {
        const attrNames = Object.keys(estimationData.utilities);
        console.log(`[Estimation] Attributes with utilities (${attrNames.length}):`, attrNames.slice(0, 10).join(', '), attrNames.length > 10 ? `... and ${attrNames.length - 10} more` : '');
      }
    } catch (error) {
      console.error('Python API error during estimation:', error);

      const allowFallback = process.env.CONJOINT_DISABLE_CLI_FALLBACK !== '1';
      const connectivityError = ['ECONNREFUSED', 'ENOTFOUND', 'ECONNABORTED', 'ETIMEDOUT'].includes(error.code);
      const serverStatus = error.response?.status;
      const shouldFallback =
        allowFallback && (connectivityError || !error.response || (serverStatus && serverStatus >= 500));

      if (shouldFallback) {
        try {
          estimationData = await runLocalEstimationFallback(surveyFilePath, attributesGrouped);
          usedLocalFallback = true;
        } catch (fallbackError) {
          console.error('Local estimation fallback failed:', fallbackError);
        }
      }

      if (!estimationData) {
        if (connectivityError) {
          return res.status(503).json({
            detail: `Unable to connect to the estimation service at ${PYTHON_API_URL}. Please ensure the Python backend is running.`,
            message: error.message
          });
        }

        if (error.response?.data?.detail) {
          return res.status(error.response.status || 500).json({
            detail: error.response.data.detail,
            message: error.message
          });
        }

        const fallbackMessage = allowFallback
          ? 'Failed to estimate utilities using both the API and local fallback.'
          : 'Failed to estimate utilities. An unexpected error occurred.';

        return res.status(500).json({
          detail: fallbackMessage,
          message: error.message
        });
      }
    }

    const timestamp = new Date().toISOString();

    const combinedWarnings = Array.isArray(estimationData.warnings) ? [...estimationData.warnings] : [];
    combinedWarnings.push(...preEstimationWarnings);
    if (usedLocalFallback) {
      combinedWarnings.push('Estimation completed via local fallback because the Python API was unavailable.');
    }

    // Persist estimation results in the workflow
    workflows[index] = {
      ...workflow,
      estimation: {
        utilities: estimationData.utilities || null,
        intercept: estimationData.intercept || null,
        schema: estimationData.schema || null,
        columns: estimationData.columns || [],
        diagnostics: estimationData.diagnostics || {},
        warnings: combinedWarnings,
        estimatedAt: timestamp
      },
      updatedAt: timestamp
    };

    await saveWorkflows(workflows);

    // Return estimation results
    res.status(200).json({
      workflowId,
      estimatedAt: timestamp,
      utilities: estimationData.utilities || null,
      intercept: estimationData.intercept || null,
      schema: estimationData.schema || null,
      columns: estimationData.columns || [],
      diagnostics: estimationData.diagnostics || {},
      warnings: combinedWarnings
    });

  } catch (error) {
    console.error('Error estimating utilities:', error);
    res.status(500).json({
      detail: 'Failed to estimate utilities.',
      message: error.message
    });
  }
});

// New endpoint for scenario-based analysis using Python backend
router.post('/workflows/:workflowId/scenario-analysis', async (req, res) => {
  try {
    const { workflowId } = req.params;
    const { newScenarios, choiceRule = 'logit' } = req.body;

    if (!workflowId) {
      return res.status(400).json({ detail: 'workflowId is required' });
    }

    if (!newScenarios || !Array.isArray(newScenarios)) {
      return res.status(400).json({ detail: 'newScenarios array is required' });
    }

    console.log(`[Scenario Analysis] Processing workflow ${workflowId} with ${newScenarios.length} scenarios`);

    const workflows = await loadWorkflows();
    const workflow = workflows.find(w => w.id === workflowId);

    if (!workflow) {
      return res.status(404).json({ detail: 'Workflow not found' });
    }

    if (!workflow.survey) {
      return res.status(400).json({ detail: 'Workflow does not have survey data' });
    }

    // Prepare data for Python backend
    const originalMarketShares = workflow.survey.summary.marketShareProducts || [];
    
    // Get the "withNewOptions" market share scenario data from the survey
    // This contains respondent-level data about how shares change when new products are shown
    // withNewOptions is a nested structure: {task: {rowNumber: {columnName, productName, rowNumber}}}
    // We need to flatten it into an array for the Python backend
    const withNewOptionsRaw = workflow.survey.summary.marketShareScenarios?.withNewOptions || {};
    const withNewOptionsColumns = [];
    
    // Flatten the nested structure
    if (typeof withNewOptionsRaw === 'object' && !Array.isArray(withNewOptionsRaw)) {
      // It's a nested object by task
      Object.entries(withNewOptionsRaw).forEach(([task, products]) => {
        if (typeof products === 'object' && !Array.isArray(products)) {
          // products is {rowNumber: {columnName, productName, rowNumber}}
          Object.values(products).forEach(product => {
            withNewOptionsColumns.push({
              columnName: product.columnName,
              productName: product.productName,
              taskNumber: parseInt(task),
              rowNumber: product.rowNumber
            });
          });
        } else if (Array.isArray(products)) {
          // Already an array (shouldn't happen but handle it)
          products.forEach(product => {
            withNewOptionsColumns.push({
              ...product,
              taskNumber: typeof product.taskNumber !== 'undefined' ? product.taskNumber : parseInt(task)
            });
          });
        }
      });
    } else if (Array.isArray(withNewOptionsRaw)) {
      // Already an array
      withNewOptionsColumns.push(...withNewOptionsRaw);
    }
    
    console.log(`[Scenario Analysis] Flattened ${withNewOptionsColumns.length} withNewOptions columns from nested structure`);
    
    // Validate withNewOptionsColumns structure
    if (withNewOptionsColumns.length > 0) {
      const firstColumn = withNewOptionsColumns[0];
      console.log('[Scenario Analysis] Sample withNewOptions column structure:', {
        hasColumnName: !!firstColumn.columnName,
        hasProductName: !!firstColumn.productName,
        hasTaskNumber: typeof firstColumn.taskNumber !== 'undefined',
        columnName: firstColumn.columnName,
        productName: firstColumn.productName,
        taskNumber: firstColumn.taskNumber
      });
      
      // Verify required fields
      const hasRequiredFields = withNewOptionsColumns.every(col => 
        col.columnName && col.productName && typeof col.taskNumber !== 'undefined'
      );
      if (!hasRequiredFields) {
        console.warn('[Scenario Analysis] Some withNewOptions columns are missing required fields (columnName, productName, or taskNumber)');
      }
    }
    
    // Extract utilities from workflow estimation (same as AverageUtilitiesView)
    // Check for estimation data - prefer estimationResult (which is mapped from estimation),
    // but fall back to estimation directly if estimationResult isn't available
    const estimationData = workflow?.estimationResult || workflow?.estimation;
    
    if (!estimationData?.utilities) {
      return res.status(400).json({
        detail: 'No utilities found in workflow. Please run estimation first before running scenario analysis.'
      });
    }

    const utilities = estimationData.utilities;
    const intercept = estimationData.intercept !== undefined && estimationData.intercept !== null
      ? Number(estimationData.intercept)
      : 0.0;

    // Get schema for attribute mapping
    const schemaAttributes = estimationData.schema?.attributes || [];

    console.log('[Scenario Analysis] Using utilities from workflow:', {
      intercept,
      utilityAttributeCount: Object.keys(utilities).length,
      utilityAttributes: Object.keys(utilities),
      schemaAttributeCount: schemaAttributes.length,
      newScenariosCount: newScenarios.length,
      withNewOptionsColumnsCount: withNewOptionsColumns.length,
      hasSurveyData: !!(workflow.survey?.storedFileName)
    });

    // Load the actual survey data file to access respondent-level "withNewOptions" data
    // We need to match the new scenario to the choice tasks and aggregate the data
    let surveyDataRows = null;
    if (workflow.survey?.storedFileName) {
      try {
        const XLSX = (await import('xlsx')).default;
        const fs = await import('fs/promises');
        const path = await import('path');
        
        const surveyFilePath = path.join(WORKFLOW_UPLOAD_ROOT, workflowId, workflow.survey.storedFileName);
        const fileBuffer = await fs.readFile(surveyFilePath);
        const workbook = XLSX.read(fileBuffer, { type: 'buffer' });
        const firstSheetName = workbook.SheetNames[0];
        const surveySheet = workbook.Sheets[firstSheetName];
        surveyDataRows = XLSX.utils.sheet_to_json(surveySheet, { defval: '', raw: false });
        console.log(`[Scenario Analysis] Loaded ${surveyDataRows.length} survey rows from ${firstSheetName}`);
        
        // Verify that we can access the withNewOptions columns in the data
        if (surveyDataRows.length > 0 && withNewOptionsColumns.length > 0) {
          const firstRow = surveyDataRows[0];
          const sampleColumns = withNewOptionsColumns.slice(0, 3);
          const accessibleColumns = sampleColumns.filter(col => col.columnName in firstRow);
          console.log(`[Scenario Analysis] Sample columns accessibility: ${accessibleColumns.length}/${sampleColumns.length} columns accessible in first row`);
          if (accessibleColumns.length < sampleColumns.length) {
            const missing = sampleColumns.filter(col => !(col.columnName in firstRow));
            console.warn(`[Scenario Analysis] Some withNewOptions columns not found in survey data:`, missing.map(col => col.columnName));
          }
        }
      } catch (error) {
        console.warn('[Scenario Analysis] Could not load survey file for withNewOptions data:', error.message);
        // Continue without it - will fall back to projection method
      }
    } else {
      console.warn('[Scenario Analysis] No stored survey file name found in workflow. Cannot load survey data for withNewOptions analysis.');
    }

    // Include design matrix for task-to-scenario matching
    const designMatrix = workflow.designMatrix || [];
    
    // Extract attribute columns - handle both old format (number) and new format (array)
    let attributeColumns = [];
    const attributeColumnsData = workflow.survey?.summary?.dataSummary?.attributeColumns;
    
    console.log('[Scenario Analysis] attributeColumnsData type:', typeof attributeColumnsData, 'value:', attributeColumnsData);
    
    if (Array.isArray(attributeColumnsData) && attributeColumnsData.length > 0) {
      // New format: already an array
      attributeColumns = attributeColumnsData;
      console.log(`[Scenario Analysis] Using existing attributeColumns array: ${attributeColumns.length} columns`);
    } else if (surveyDataRows && surveyDataRows.length > 0) {
      // Extract from survey data if not already an array or if it's a number
      if (typeof attributeColumnsData === 'number') {
        console.log(`[Scenario Analysis] attributeColumns is a number (${attributeColumnsData}), extracting column names from survey data...`);
      } else {
        console.log('[Scenario Analysis] attributeColumns is not an array, extracting column names from survey data...');
      }
      const XLSX = (await import('xlsx')).default;
      const fs = await import('fs/promises');
      const path = await import('path');
      
      try {
        const surveyFilePath = path.join(WORKFLOW_UPLOAD_ROOT, workflowId, workflow.survey.storedFileName);
        const fileBuffer = await fs.readFile(surveyFilePath);
        const workbook = XLSX.read(fileBuffer, { type: 'buffer' });
        const firstSheetName = workbook.SheetNames[0];
        const surveySheet = workbook.Sheets[firstSheetName];
        
        // Get all column names from the first row
        // XLSX.utils.sheet_to_json already gives us column names in the objects
        // But we need to get them from the sheet directly
        const range = XLSX.utils.decode_range(surveySheet['!ref'] || 'A1');
        const allColumns = [];
        for (let col = 0; col <= range.e.c; col++) {
          const cellAddress = XLSX.utils.encode_cell({ r: 0, c: col });
          const cell = surveySheet[cellAddress];
          if (cell && cell.v) {
            allColumns.push(String(cell.v).trim());
          }
        }
        
        // Also try to get column names from the first row of data if available
        if (surveyDataRows && surveyDataRows.length > 0) {
          const firstDataRow = surveyDataRows[0];
          const dataColumns = Object.keys(firstDataRow);
          // Merge with header columns
          const combinedColumns = [...new Set([...allColumns, ...dataColumns])];
          
          // Filter for hATTR_* columns
          attributeColumns = combinedColumns.filter(col => /^hATTR_/i.test(col));
          console.log(`[Scenario Analysis] Extracted ${attributeColumns.length} attribute columns from survey file (checked ${combinedColumns.length} total columns)`);
          
          // Log sample columns for debugging
          if (attributeColumns.length === 0) {
            const sampleCols = combinedColumns.slice(0, 20);
            console.log(`[Scenario Analysis] No hATTR_ columns found. Sample columns: ${sampleCols.join(', ')}`);
            console.log(`[Scenario Analysis] Looking for columns matching pattern: hATTR_*`);
          }
        } else {
          // Filter for hATTR_* columns from header row only
          attributeColumns = allColumns.filter(col => /^hATTR_/i.test(col));
          console.log(`[Scenario Analysis] Extracted ${attributeColumns.length} attribute columns from survey file header row`);
        }
        
        // Update workflow with the extracted columns (for future use)
        if (attributeColumns.length > 0) {
          const workflowIndex = workflows.findIndex(w => w.id === workflowId);
          if (workflowIndex >= 0) {
            workflows[workflowIndex].survey.summary.dataSummary.attributeColumns = attributeColumns;
            await saveWorkflows(workflows);
            console.log('[Scenario Analysis] Updated workflow with extracted attributeColumns array');
          }
        }
      } catch (error) {
        console.warn('[Scenario Analysis] Failed to extract attribute columns from survey file:', error.message);
      }
    }

    // Get column mapping from workflow for Python backend
    const columnMapping = workflow?.survey?.summary?.columnMapping || null;
    
    // Call Python backend scenario analysis endpoint
    const pythonPayload = {
      intercept: intercept,
      utilities: utilities,
      original_market_shares: originalMarketShares,
      new_scenarios: newScenarios,
      rule: choiceRule,
      ...(estimationData.schema ? { schema: estimationData.schema } : {}),
      ...(withNewOptionsColumns && withNewOptionsColumns.length > 0 ? { with_new_options_columns: withNewOptionsColumns } : {}),
      ...(surveyDataRows && surveyDataRows.length > 0 ? { survey_data_rows: surveyDataRows } : {}),
      ...(attributeColumns && attributeColumns.length > 0 ? { attribute_columns: attributeColumns } : {}),
      ...(designMatrix && designMatrix.length > 0 ? { design_matrix: designMatrix } : {}),
      ...(columnMapping ? { column_mapping: columnMapping } : {})
    };

    console.log('[Scenario Analysis] Calling Python backend with payload:', {
      intercept: pythonPayload.intercept,
      utilitiesKeys: Object.keys(pythonPayload.utilities),
      scenarioCount: pythonPayload.new_scenarios.length,
      firstScenario: pythonPayload.new_scenarios[0] || null,
      withNewOptionsColumnsCount: pythonPayload.with_new_options_columns?.length || 0,
      surveyDataRowsCount: pythonPayload.survey_data_rows?.length || 0,
      attributeColumnsCount: pythonPayload.attribute_columns?.length || 0,
      attributeColumnsSample: pythonPayload.attribute_columns?.slice(0, 5) || [],
      designMatrixRows: pythonPayload.design_matrix?.length || 0,
      hasSchema: !!pythonPayload.schema
    });
    
    const pythonResponse = await axios.post(`${PYTHON_API_URL}/analyze_scenarios`, pythonPayload, {
      headers: {
        'Content-Type': 'application/json'
      },
      timeout: 30000 // 30 second timeout
    });

    console.log('[Scenario Analysis] Python backend response received');

    // Update workflow with scenario analysis results
    const updatedWorkflow = {
      ...workflow,
      scenarioAnalysis: {
        originalScenario: pythonResponse.data.original_scenario,
        projectedScenarios: pythonResponse.data.projected_scenarios,
        marketImpact: pythonResponse.data.market_impact,
        diagnostics: pythonResponse.data.diagnostics,
        analyzedAt: new Date().toISOString()
      },
      updatedAt: new Date().toISOString()
    };

    const workflowIndex = workflows.findIndex(w => w.id === workflowId);
    workflows[workflowIndex] = updatedWorkflow;
    await saveWorkflows(workflows);

    return res.status(200).json(updatedWorkflow);

  } catch (error) {
    console.error('[Scenario Analysis] Error:', error);
    
    if (error.response) {
      // Python backend error
      const errorDetail = error.response.data?.detail || error.response.data?.message || error.message;
      console.error('[Scenario Analysis] Python backend error detail:', errorDetail);
      return res.status(error.response.status).json({
        detail: 'Python backend error',
        message: errorDetail
      });
    } else if (error.code === 'ECONNREFUSED') {
      return res.status(503).json({
        detail: 'Python backend not available',
        message: 'Please ensure the conjoint analysis backend is running'
      });
    } else {
      return res.status(500).json({
        detail: 'Scenario analysis failed',
        message: error.message
      });
    }
  }
});

// Endpoint to get scenario analysis results
router.get('/workflows/:workflowId/scenario-analysis', async (req, res) => {
  try {
    const { workflowId } = req.params;

    const workflows = await loadWorkflows();
    const workflow = workflows.find(w => w.id === workflowId);

    if (!workflow) {
      return res.status(404).json({ detail: 'Workflow not found' });
    }

    if (!workflow.scenarioAnalysis) {
      return res.status(404).json({ detail: 'No scenario analysis found for this workflow' });
    }

    return res.status(200).json(workflow.scenarioAnalysis);

  } catch (error) {
    console.error('[Scenario Analysis] Error retrieving results:', error);
    return res.status(500).json({
      detail: 'Failed to retrieve scenario analysis',
      message: error.message
    });
  }
});

export default router;

function normalizeKey(value) {
  return String(value || '').replace(/\s+/g, '').toLowerCase();
}

/**
 * Transform attributes from flat storage format to grouped format expected by Python API.
 *
 * Input format (flat):
 * [
 *   {"code": "11", "attributeNo": "1", "attributeText": "On-Table Closure Rate", "levelNo": "1", "levelText": "70%..."},
 *   {"code": "12", "attributeNo": "1", "attributeText": "On-Table Closure Rate", "levelNo": "2", "levelText": "80%..."}
 * ]
 *
 * attributeShortNames: ["GORE", "PFO", ...]  (extracted from survey export columns)
 *
 * Output format (grouped):
 * [
 *   {
 *     "name": "GORE",  // Uses short name from survey, not full text
 *     "levels": [
 *       {"code": "11", "level": "70%..."},
 *       {"code": "12", "level": "80%..."}
 *     ]
 *   }
 * ]
 */
function transformAttributesToGroupedFormat(flatAttributes, attributeShortNames = []) {
  if (!Array.isArray(flatAttributes) || flatAttributes.length === 0) {
    return [];
  }

  const sanitizeName = (value, fallback = '') => {
    if (typeof value !== 'string') {
      return fallback;
    }
    const cleaned = value
      .trim()
      .replace(/\s+/g, '_')
      .replace(/[^a-zA-Z0-9_]/g, '_')
      .replace(/_+/g, '_')
      .replace(/^_+|_+$/g, '')
      .toUpperCase();
    return cleaned || fallback;
  };

  const grouped = new Map();

  flatAttributes.forEach(attr => {
    if (!attr) {
      return;
    }

    const attrNoRaw = attr.attributeNo ?? attr.attributeNumber ?? '';
    const attrNo = String(attrNoRaw || '').trim();
    if (!attrNo) {
      return;
    }

    const code = String(attr.code ?? '').trim();
    const levelText = String(attr.levelText ?? attr.levelName ?? '').trim();
    const levelNoRaw = attr.levelNo ?? attr.levelNumber ?? null;
    let levelNo = null;
    if (levelNoRaw !== null && levelNoRaw !== undefined) {
      const parsed = Number.parseFloat(String(levelNoRaw).trim());
      if (Number.isFinite(parsed)) {
        levelNo = parsed;
      }
    }
    const attributeText = String(attr.attributeText ?? attr.attributeName ?? '').trim();

    if (!grouped.has(attrNo)) {
      grouped.set(attrNo, {
        attributeNo: attrNo,
        attributeText,
        levels: []
      });
    }

    const groupedEntry = grouped.get(attrNo);
    if (attributeText && !groupedEntry.attributeText) {
      groupedEntry.attributeText = attributeText;
    }

    if (code && levelText) {
      groupedEntry.levels.push({
        code,
        level: levelText,
        levelNo
      });
    }
  });

  const sortedAttrNos = Array.from(grouped.keys()).sort((a, b) => Number(a) - Number(b));
  const usedNames = new Set();
  const result = [];

  // Process ALL attributes from the workflow
  // The Python backend will extract which attributes are actually present in the survey data
  // by looking at the attribute codes in the hATTR column values, not the column names
  // (The column names contain brand/product names, not attribute identifiers)
  sortedAttrNos.forEach((attrNo, index) => {
    const entry = grouped.get(attrNo);
    if (!entry) {
      return;
    }

    // Generate attribute name from attribute number or text
    // Don't use attributeShortNames here - those are brand names, not attribute identifiers
    let name = sanitizeName(entry.attributeText, `ATT${String(attrNo).padStart(2, '0')}`);
    
    // If attributeShortNames is provided and matches position, use it as a fallback identifier
    // but prefer the attribute number or text
    if (attributeShortNames.length > 0 && index < attributeShortNames.length) {
      const candidateShort = attributeShortNames[index];
      const sanitizedShort = sanitizeName(candidateShort);
      if (sanitizedShort && !name) {
        name = sanitizedShort;
      }
    }

    let uniqueName = name;
    let attempt = 1;
    while (usedNames.has(uniqueName)) {
      attempt += 1;
      uniqueName = `${name}_${attempt}`;
    }
    usedNames.add(uniqueName);

    const sortedLevels = entry.levels
      .slice()
      .sort((a, b) => {
        if (a.levelNo !== null && b.levelNo !== null) {
          return a.levelNo - b.levelNo;
        }
        const codeA = Number(a.code);
        const codeB = Number(b.code);
        if (!Number.isNaN(codeA) && !Number.isNaN(codeB)) {
          return codeA - codeB;
        }
        return a.code.localeCompare(b.code);
      })
      .map(levelEntry => ({
        code: levelEntry.code,
        level: levelEntry.level
      }));

    const referenceLevel = sortedLevels.length > 0 ? sortedLevels[sortedLevels.length - 1].level : null;

    result.push({
      name: uniqueName,
      label: entry.attributeText || uniqueName,
      attributeNo: entry.attributeNo,
      levels: sortedLevels,
      reference: referenceLevel
    });
  });

  return result;
}

async function runLocalEstimationFallback(excelPath, attributesGrouped) {
  const scriptPath = path.join(__dirname, '..', '..', 'conjoint-backend', 'estimate_from_survey_cli.py');
  const pythonExe = process.env.CONJOINT_PYTHON_BIN || 'python';

  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'conjoint-estimate-'));
  const attributesPath = path.join(tempDir, 'attributes.json');

  try {
    await fs.writeFile(attributesPath, JSON.stringify(attributesGrouped, null, 2), 'utf8');

    const execArgs = [scriptPath, '--excel', excelPath, '--attributes', attributesPath];

    const { stdout, stderr } = await new Promise((resolve, reject) => {
      execFile(
        pythonExe,
        execArgs,
        { maxBuffer: 20 * 1024 * 1024 },
        (error, stdout, stderr) => {
          if (error) {
            error.stderr = stderr;
            return reject(error);
          }
          resolve({ stdout, stderr });
        }
      );
    });

    try {
      return JSON.parse(stdout);
    } catch (parseError) {
      parseError.stderr = stderr;
      throw parseError;
    }
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
}

function runLocalSimulationFallback(payload = {}) {
  const { scenarios, utilities, intercept = 0, rule = 'logit' } = payload;

  if (!Array.isArray(scenarios) || scenarios.length === 0) {
    throw new Error('At least one scenario is required for simulation.');
  }
  if (!utilities || typeof utilities !== 'object') {
    throw new Error('Utilities payload is required for simulation.');
  }
  if (rule !== 'logit' && rule !== 'first_choice') {
    throw new Error(`Unknown simulation rule: ${rule}. Use 'logit' or 'first_choice'.`);
  }

  const interceptValue = Number(intercept) || 0;
  const normalizedUtilities = {};

  Object.entries(utilities).forEach(([attr, levels]) => {
    if (!levels || typeof levels !== 'object') {
      return;
    }
    normalizedUtilities[attr] = {};
    Object.entries(levels).forEach(([level, value]) => {
      const numericValue = Number(value);
      normalizedUtilities[attr][level] = Number.isFinite(numericValue) ? numericValue : 0;
    });
  });

  const scenarioUtilities = scenarios.map(scenario => {
    let total = interceptValue;
    if (!scenario || typeof scenario !== 'object') {
      return total;
    }
    Object.entries(scenario).forEach(([attr, levelValue]) => {
      const attrUtilities = normalizedUtilities[attr] || {};
      const levelKeys = Object.keys(attrUtilities);
      if (levelKeys.length === 0) {
        return;
      }

      const levelKey = String(levelValue ?? '').trim();
      if (Object.prototype.hasOwnProperty.call(attrUtilities, levelKey)) {
        total += attrUtilities[levelKey];
      } else {
        const referencePenalty = levelKeys.reduce(
          (sum, key) => sum + (attrUtilities[key] || 0),
          0
        );
        total -= referencePenalty;
      }
    });
    return total;
  });

  let shares;
  if (rule === 'first_choice') {
    const maxUtility = Math.max(...scenarioUtilities);
    const winners = scenarioUtilities
      .map((value, index) => ({ value, index }))
      .filter(item => Math.abs(item.value - maxUtility) < 1e-9)
      .map(item => item.index);
    const sharePerWinner = winners.length ? 1 / winners.length : 0;
    shares = scenarioUtilities.map((_, idx) => (winners.includes(idx) ? sharePerWinner : 0));
  } else {
    const maxUtility = Math.max(...scenarioUtilities);
    const exps = scenarioUtilities.map(value => Math.exp(value - maxUtility));
    const denom = exps.reduce((sum, value) => sum + value, 0);
    shares = denom === 0 ? scenarioUtilities.map(() => 0) : exps.map(value => value / denom);
  }

  return {
    utilities: scenarioUtilities,
    shares
  };
}
