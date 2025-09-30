import { Router } from 'express';
import multer from 'multer';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { previewFromDG_SchemaLocked, exportExcelFromPreview } from '../services/caXGenerator.service.mjs';
import { ingestCAXWorkbook, parseCAXWorkbook } from '../services/caXIngest.service.mjs';

const router = Router();
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const uploadDir = process.env.FILES_DIR || path.join(__dirname, '../../uploads');
await fs.mkdir(uploadDir, { recursive: true });

const upload = multer({ dest: uploadDir });

router.get('/template', async (req, res) => {
  const p = path.join(__dirname, '../../templates/CA_template_schema_locked.xlsx');
  res.download(p, 'CA_template_schema_locked.xlsx');
});

// NEW: Preview-only (JSON) for DG upload
router.post('/preview', upload.single('dg'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'Missing dg file' });
    const json = await previewFromDG_SchemaLocked(req.file.path);
    res.json(json);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Failed to create preview from DG' });
  }
});

// NEW: Export JSON preview to Excel (schema-locked)
router.post('/export', async (req, res) => {
  try {
    const data = req.body?.data;
    if (!data) return res.status(400).json({ error: 'Missing data' });
    const { filePath, filename } = await exportExcelFromPreview(data, uploadDir);
    res.download(filePath, filename);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Failed to export Excel from preview' });
  }
});

// Keep upload/parse for projects
router.post('/upload', upload.single('file'), async (req, res) => {
  try {
    const { projectId } = req.body;
    if (!req.file || !projectId) return res.status(400).json({ error: 'Missing file or projectId' });
    const record = await ingestCAXWorkbook(projectId, req.file.path);
    res.json(record);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Failed to upload CA' });
  }
});

router.get('/:projectId', async (req, res) => {
  try {
    const data = await parseCAXWorkbook(req.params.projectId);
    res.json(data);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Failed to parse CA for project' });
  }
});

export default router;
