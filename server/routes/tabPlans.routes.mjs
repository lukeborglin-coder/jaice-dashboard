import express from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs/promises';
import crypto from 'crypto';
import XLSX from 'xlsx';
import { authenticateToken, requireCognitiveOrAdmin } from '../middleware/auth.middleware.mjs';
import { parseDatamapFromExcelFile } from '../services/datamapParser.mjs';

const router = express.Router();

// Enforce auth + company access for all tab plan endpoints
router.use(authenticateToken, requireCognitiveOrAdmin);

// Consistent data roots for persistence (match questionnaire routes)
const dataRoot = process.env.DATA_DIR || path.join(process.cwd(), 'data');
const filesDir = process.env.FILES_DIR || path.join(dataRoot, 'uploads');
const tabPlansRoot = path.join(dataRoot, 'tab-plans');
const indexPath = path.join(tabPlansRoot, '_index.json');

async function ensureDir(dirPath) {
  await fs.mkdir(dirPath, { recursive: true });
}

async function readJson(filePath, fallback) {
  try {
    const raw = await fs.readFile(filePath, 'utf-8');
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

async function writeJson(filePath, obj) {
  await ensureDir(path.dirname(filePath));
  await fs.writeFile(filePath, JSON.stringify(obj, null, 2));
}

async function getIndex() {
  await ensureDir(tabPlansRoot);
  return await readJson(indexPath, { version: 1, plans: {} });
}

async function setIndex(nextIndex) {
  await writeJson(indexPath, nextIndex);
}

async function resolvePlanLocation(planId) {
  const idx = await getIndex();
  const hit = idx?.plans?.[planId];
  if (hit?.projectId) {
    return {
      projectId: hit.projectId,
      planDir: path.join(tabPlansRoot, String(hit.projectId), String(planId)),
      planPath: path.join(tabPlansRoot, String(hit.projectId), String(planId), 'plan.json'),
      metadataPath: path.join(tabPlansRoot, String(hit.projectId), String(planId), 'metadata.json'),
    };
  }

  // Fallback: scan projects (rare; keeps API resilient if index is missing)
  try {
    const projectDirs = await fs.readdir(tabPlansRoot, { withFileTypes: true });
    for (const dirent of projectDirs) {
      if (!dirent.isDirectory()) continue;
      const maybePlanDir = path.join(tabPlansRoot, dirent.name, String(planId));
      try {
        await fs.access(path.join(maybePlanDir, 'plan.json'));
        return {
          projectId: dirent.name,
          planDir: maybePlanDir,
          planPath: path.join(maybePlanDir, 'plan.json'),
          metadataPath: path.join(maybePlanDir, 'metadata.json'),
        };
      } catch {
        // keep scanning
      }
    }
  } catch {
    // ignore
  }

  return null;
}

function nowIso() {
  return new Date().toISOString();
}

function emptySpecs() {
  return {
    variableTableSelections: {},
    variableStatsSelections: {},
    summaryTableSortSelections: {},
    variableSortByFrequency: {},
    variableHoldResponseCodes: {},
    singleSelectSort: {},
    newBannerGroups: [],
    bannerFilterConditions: null,
    hiddenFromBanners: [],
    netSummaryTableSelectedCodes: {},
    netSummaryTableRanges: {},
    settings: {
      significanceLevel: 95,
      percentageDecimals: 0,
    },
  };
}

// Storage for plan data files (Excel only) - store temporarily first
const dataFileStorage = multer.diskStorage({
  destination: async (req, file, cb) => {
    try {
      await ensureDir(filesDir);
      cb(null, filesDir);
    } catch (error) {
      cb(error);
    }
  },
  filename: (req, file, cb) => {
    const timestamp = Date.now();
    const ext = path.extname(file.originalname);
    cb(null, `tabplan_data_temp_${timestamp}${ext}`);
  },
});

const dataFileFilter = (req, file, cb) => {
  const allowedTypes = [
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', // .xlsx
    'application/vnd.ms-excel', // .xls
    'application/vnd.ms-excel.sheet.macroEnabled.12', // .xlsm (allowed in practice)
  ];

  if (allowedTypes.includes(file.mimetype) || file.originalname.match(/\.(xlsx|xls)$/i)) {
    cb(null, true);
  } else {
    cb(new Error('Invalid file type. Only .xlsx and .xls files are allowed.'), false);
  }
};

const uploadPlanDataFile = multer({
  storage: dataFileStorage,
  fileFilter: dataFileFilter,
  limits: { fileSize: 50 * 1024 * 1024 },
});

// GET /api/tab-plans/project/:projectId - list plans for project
router.get('/project/:projectId', async (req, res) => {
  try {
    const { projectId } = req.params;
    const projectDir = path.join(tabPlansRoot, String(projectId));
    let entries = [];
    try {
      entries = await fs.readdir(projectDir, { withFileTypes: true });
    } catch {
      return res.json([]);
    }

    const plans = [];
    for (const dirent of entries) {
      if (!dirent.isDirectory()) continue;
      const planPath = path.join(projectDir, dirent.name, 'plan.json');
      try {
        const plan = JSON.parse(await fs.readFile(planPath, 'utf-8'));
        plans.push(plan);
      } catch {
        // ignore broken entries
      }
    }

    plans.sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')));
    res.json(plans);
  } catch (error) {
    console.error('Error listing tab plans:', error);
    res.status(500).json({ error: 'Failed to list tab plans' });
  }
});

// POST /api/tab-plans - create plan
router.post('/', async (req, res) => {
  try {
    const { projectId, name, sourceType, qnrId } = req.body || {};
    if (!projectId || !name || !sourceType) {
      return res.status(400).json({ error: 'projectId, name, and sourceType are required' });
    }
    if (sourceType !== 'qnr' && sourceType !== 'raw') {
      return res.status(400).json({ error: 'sourceType must be "qnr" or "raw"' });
    }
    if (sourceType === 'qnr' && !qnrId) {
      return res.status(400).json({ error: 'qnrId is required when sourceType is "qnr"' });
    }

    const id = crypto.randomUUID();
    const createdAt = nowIso();
    const plan = {
      id,
      projectId: String(projectId),
      name: String(name),
      sourceType,
      qnrId: sourceType === 'qnr' ? String(qnrId) : undefined,
      createdAt,
      updatedAt: createdAt,
      specs: emptySpecs(),
    };

    const planDir = path.join(tabPlansRoot, String(projectId), id);
    await ensureDir(planDir);
    await writeJson(path.join(planDir, 'plan.json'), plan);
    await writeJson(path.join(planDir, 'metadata.json'), { createdAt, sourceType: plan.sourceType });

    const idx = await getIndex();
    idx.plans = idx.plans || {};
    idx.plans[id] = { projectId: String(projectId), createdAt };
    await setIndex(idx);

    res.json(plan);
  } catch (error) {
    console.error('Error creating tab plan:', error);
    res.status(500).json({ error: 'Failed to create tab plan' });
  }
});

// GET /api/tab-plans/:planId - get plan
router.get('/:planId', async (req, res) => {
  try {
    const { planId } = req.params;
    const loc = await resolvePlanLocation(planId);
    if (!loc) return res.status(404).json({ error: 'Tab plan not found' });
    const plan = JSON.parse(await fs.readFile(loc.planPath, 'utf-8'));
    res.json(plan);
  } catch (error) {
    console.error('Error getting tab plan:', error);
    res.status(500).json({ error: 'Failed to get tab plan' });
  }
});

// PUT /api/tab-plans/:planId - update plan (name/specs)
router.put('/:planId', async (req, res) => {
  try {
    const { planId } = req.params;
    const loc = await resolvePlanLocation(planId);
    if (!loc) return res.status(404).json({ error: 'Tab plan not found' });

    const existing = JSON.parse(await fs.readFile(loc.planPath, 'utf-8'));
    const { name, specs } = req.body || {};

    const updated = {
      ...existing,
      name: typeof name === 'string' && name.trim() ? name.trim() : existing.name,
      specs: specs && typeof specs === 'object' ? specs : existing.specs,
      updatedAt: nowIso(),
    };

    await writeJson(loc.planPath, updated);
    res.json(updated);
  } catch (error) {
    console.error('Error updating tab plan:', error);
    res.status(500).json({ error: 'Failed to update tab plan' });
  }
});

// DELETE /api/tab-plans/:planId - delete a plan and its files
router.delete('/:planId', async (req, res) => {
  try {
    const { planId } = req.params;
    const loc = await resolvePlanLocation(planId);
    if (!loc) return res.status(404).json({ error: 'Tab plan not found' });

    // Remove directory (plan.json, metadata, uploaded files)
    try {
      await fs.rm(loc.planDir, { recursive: true, force: true });
    } catch (e) {
      // keep going; we still try to clean index
    }

    // Remove from index
    try {
      const idx = await getIndex();
      if (idx?.plans?.[planId]) {
        delete idx.plans[planId];
        await setIndex(idx);
      }
    } catch {
      // ignore index failures
    }

    res.json({ success: true });
  } catch (error) {
    console.error('Error deleting tab plan:', error);
    res.status(500).json({ error: 'Failed to delete tab plan' });
  }
});

// POST /api/tab-plans/:planId/upload-data-file - upload Excel data file for raw plans
router.post('/:planId/upload-data-file', uploadPlanDataFile.single('file'), async (req, res) => {
  try {
    const { planId } = req.params;
    const loc = await resolvePlanLocation(planId);
    if (!loc) {
      if (req.file?.path) {
        try { await fs.unlink(req.file.path); } catch {}
      }
      return res.status(404).json({ error: 'Tab plan not found' });
    }
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    const plan = JSON.parse(await fs.readFile(loc.planPath, 'utf-8'));
    if (plan.sourceType !== 'raw') {
      // Clean up temp file
      try { await fs.unlink(req.file.path); } catch {}
      return res.status(400).json({ error: 'Only raw-data tab plans can upload a data file' });
    }

    await ensureDir(loc.planDir);

    // Clean up old data files
    try {
      const existingEntries = await fs.readdir(loc.planDir, { withFileTypes: true });
      for (const entry of existingEntries) {
        if (entry.isFile() && entry.name.startsWith('data_')) {
          try { await fs.unlink(path.join(loc.planDir, entry.name)); } catch {}
        }
      }
    } catch {}

    const timestamp = Date.now();
    const ext = path.extname(req.file.originalname);
    const fileName = `data_${timestamp}${ext}`;
    const finalPath = path.join(loc.planDir, fileName);
    await fs.rename(req.file.path, finalPath);

    const metadata = await readJson(loc.metadataPath, {});
    const nextMeta = {
      ...metadata,
      dataFileName: fileName,
      originalFileName: req.file.originalname,
      uploadedAt: nowIso(),
    };
    await writeJson(loc.metadataPath, nextMeta);

    // Touch plan updatedAt
    plan.updatedAt = nowIso();
    await writeJson(loc.planPath, plan);

    res.json({ fileName, originalFileName: req.file.originalname, message: 'File uploaded successfully' });
  } catch (error) {
    console.error('Error uploading tab plan data file:', error);
    if (req.file?.path) {
      try { await fs.unlink(req.file.path); } catch {}
    }
    res.status(500).json({ error: 'Failed to upload data file' });
  }
});

// GET /api/tab-plans/:planId/raw-data - Get full raw data (first sheet) as JSON
router.get('/:planId/raw-data', async (req, res) => {
  try {
    const { planId } = req.params;
    const loc = await resolvePlanLocation(planId);
    if (!loc) return res.status(404).json({ error: 'Tab plan not found' });

    const metadata = await readJson(loc.metadataPath, null);
    if (!metadata?.dataFileName) {
      return res.status(404).json({ error: 'No data file found. Please upload a data file first.' });
    }

    const filePath = path.join(loc.planDir, metadata.dataFileName);
    try {
      await fs.access(filePath);
    } catch {
      return res.status(404).json({ error: 'Data file not found' });
    }

    // Read and parse the Excel file
    const workbook = XLSX.readFile(filePath);
    const dataSheetName = workbook.SheetNames[0];
    const dataWorksheet = workbook.Sheets[dataSheetName];

    const dataJson = XLSX.utils.sheet_to_json(dataWorksheet, {
      defval: null,
      blankrows: false,
      raw: false,
    });

    const allColumns = new Set();
    dataJson.forEach((row) => {
      Object.keys(row).forEach((key) => allColumns.add(key));
    });
    const columnHeaders = Array.from(allColumns);

    res.json({
      columns: columnHeaders,
      rows: dataJson,
      totalRows: dataJson.length,
      totalColumns: columnHeaders.length,
    });
  } catch (error) {
    console.error('Error fetching tab plan raw data:', error);
    res.status(500).json({ error: 'Failed to fetch raw data' });
  }
});

// GET /api/tab-plans/:planId/datamap - parse datamap from plan data file
router.get('/:planId/datamap', async (req, res) => {
  try {
    const { planId } = req.params;
    const loc = await resolvePlanLocation(planId);
    if (!loc) return res.status(404).json({ error: 'Tab plan not found' });

    const metadata = await readJson(loc.metadataPath, null);
    if (!metadata?.dataFileName) {
      return res.status(404).json({ error: 'No data file found. Please upload a data file first.' });
    }

    const filePath = path.join(loc.planDir, metadata.dataFileName);
    try {
      await fs.access(filePath);
    } catch {
      return res.status(404).json({ error: 'Data file not found' });
    }

    try {
      const payload = await parseDatamapFromExcelFile(filePath);
      res.json(payload);
    } catch (e) {
      const status = e?.status || 404;
      res.status(status).json({
        error: e?.message || 'No datamap found for this tab plan',
        availableSheets: e?.availableSheets,
        sheetName: e?.sheetName,
        details: e?.details,
        stack: process.env.NODE_ENV === 'development' ? e?.stack : undefined,
      });
    }
  } catch (error) {
    console.error('Error fetching tab plan datamap:', error);
    res.status(500).json({ error: 'Failed to fetch datamap' });
  }
});

export default router;





