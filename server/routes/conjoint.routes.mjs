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

// Initialize OpenAI client
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

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
  const raw = await fs.readFile(WORKFLOW_STORE_PATH, 'utf8');
  return Array.isArray(JSON.parse(raw)) ? JSON.parse(raw) : [];
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
    
    // Skip product extraction since we'll use AI-identified products instead
    const preprocessingResult = preprocessConjointData(workbook, firstSheetName, { skipProductExtraction: true });
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

// AI Workflow Analysis endpoint
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
    const designSheetName = designWorkbook.SheetNames[0];
    const designSheet = designWorkbook.Sheets[designSheetName];
    const designMatrix = XLSX.utils.sheet_to_json(designSheet, { defval: '', raw: false });

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
    
    // Skip product extraction since we'll use AI-identified products instead
    const preprocessingResult = preprocessConjointData(workbook, dataSheetName, { skipProductExtraction: true });
    let columnBreakdown = getDetailedColumnBreakdown(preprocessingResult);

    console.log('[Data Processing] Preprocessing complete:', preprocessingResult.summary);

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

    // Update workflow with processed data
    const updatedWorkflow = {
      ...workflow,
      survey: {
        uploadedAt: new Date().toISOString(),
        fileName: req.file.originalname,
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
            attributeColumns: preprocessingResult.summary.relevantColumns.attributes
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

    const aiDataAnalysis = updatedWorkflow.aiAnalysis || workflow?.aiAnalysis || null;

    res.json({
      success: true,
      workflow: updatedWorkflow,
      dataSummary: {
        totalRows: preprocessingResult.summary.cleanedRows,
        relevantColumns: allRelevantColumns.length,
        marketShareProducts: marketShareProducts.length,
        aiAnalysis: aiDataAnalysis
      }
    });

  } catch (error) {
    console.error('[AI Data Processing] Error:', error);
    res.status(500).json({
      detail: 'Failed to process data with AI',
      message: error.message
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
    
    // Create final workflow
    const finalWorkflow = {
      ...tempWorkflow,
      id: `workflow_${Date.now()}`,
      name: name || `AI Generated Workflow - ${new Date().toLocaleDateString()}`,
      temporary: false,
      finalizedAt: new Date().toISOString()
    };

    // Replace temporary workflow with final one
    workflows[tempIndex] = finalWorkflow;
    await saveWorkflows(workflows);

    console.log('[AI Workflow] Finalized workflow:', finalWorkflow.id);

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

    // Extract attribute short names from survey export columns
    const workbook = XLSX.read(surveyBuffer, { type: 'buffer' });
    const firstSheetName = workbook.SheetNames[0];
    const surveySheet = workbook.Sheets[firstSheetName];
    const surveyRows = XLSX.utils.sheet_to_json(surveySheet, { defval: '', raw: false });
    const columns = surveyRows.length > 0 ? Object.keys(surveyRows[0]) : [];

    // Extract attribute short names from columns like hATTR_GORE_1c1
    const attributeShortNames = [];
    const attrPattern = /^hATTR_(.+?)_\d+c\d+$/i;
    const seenNames = new Set();

    for (const col of columns) {
      const match = col.match(attrPattern);
      if (match) {
        const shortName = match[1] ? match[1].toUpperCase() : '';
        if (!seenNames.has(shortName)) {
          attributeShortNames.push(shortName);
          seenNames.add(shortName);
        }
      }
    }

    if (!attributeShortNames.length) {
      return res.status(400).json({
        detail: 'No attribute columns (hATTR_*) were detected in the survey export. Please verify the survey file matches the validation template.'
      });
    }

    const preEstimationWarnings = [];
    const uniqueAttrNos = new Set((workflow.attributes || []).map(attr => String(attr?.attributeNo ?? '').trim()).filter(Boolean));
    if (uniqueAttrNos.size && attributeShortNames.length !== uniqueAttrNos.size) {
      preEstimationWarnings.push(
        `Attribute mismatch detected. Survey export includes ${attributeShortNames.length} attribute groups but the design lists ${uniqueAttrNos.size}.`
      );
    }

    // Transform attributes from flat format to grouped format for Python
    // Map by attribute number to short name
    const attributesGrouped = transformAttributesToGroupedFormat(workflow.attributes || [], attributeShortNames);
    if (!attributesGrouped.length) {
      return res.status(400).json({
        detail: 'Unable to map attribute metadata for estimation. Please re-import the attribute list and try again.'
      });
    }

    // Create form data to forward to Python backend
    const formData = new FormData();
    formData.append('file', surveyBuffer, {
      filename: workflow.survey.originalFileName || 'survey.xlsx',
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
    
    // For now, use default utilities - in a real implementation, these would come from conjoint estimation
    const utilities = {
      "Brand": {
        "Brand A": 0.5,
        "Brand B": 0.3,
        "Brand C": 0.2
      },
      "Price": {
        "Low": 0.4,
        "Medium": 0.2,
        "High": -0.1
      },
      "Feature": {
        "Standard": 0.0,
        "Premium": 0.3,
        "Deluxe": 0.6
      }
    };

    // Call Python backend scenario analysis endpoint
    const pythonPayload = {
      intercept: 0.0,
      utilities: utilities,
      original_market_shares: originalMarketShares,
      new_scenarios: newScenarios,
      rule: choiceRule
    };

    console.log('[Scenario Analysis] Calling Python backend...');
    
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
      return res.status(error.response.status).json({
        detail: 'Python backend error',
        message: error.response.data?.detail || error.message
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

  sortedAttrNos.forEach((attrNo, index) => {
    const entry = grouped.get(attrNo);
    if (!entry) {
      return;
    }

    const candidateShort = attributeShortNames[index] || '';
    let name = sanitizeName(candidateShort);
    if (!name) {
      name = sanitizeName(entry.attributeText, `ATT${String(index + 1).padStart(2, '0')}`);
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
