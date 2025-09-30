import { Router } from 'express';
import multer from 'multer';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { generateCAFromDG } from '../services/caGenerator.service.mjs';
import { ingestCAWorkbook, parseCAWorkbook } from '../services/caIngest.service.mjs';

const router = Router();
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const uploadDir = process.env.FILES_DIR || path.join(__dirname, '../../uploads');
await fs.mkdir(uploadDir, { recursive: true });

const upload = multer({ dest: uploadDir });

router.get('/template', async (req, res) => {
  const templatePath = path.join(__dirname, '../../templates/CA_template_HCP.xlsx');
  res.download(templatePath, 'CA_template_HCP.xlsx');
});

router.post('/generate', upload.single('dg'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'Missing dg file' });
    const outPath = await generateCAFromDG(req.file.path, uploadDir);
    const id = path.basename(outPath);
    res.json({ fileId: id, downloadUrl: `/api/ca/download/${id}` });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Failed to generate CA from DG' });
  }
});

router.get('/download/:id', async (req, res) => {
  const p = path.join(uploadDir, req.params.id);
  res.download(p);
});

router.post('/upload', upload.single('file'), async (req, res) => {
  try {
    const { projectId } = req.body;
    if (!req.file || !projectId) return res.status(400).json({ error: 'Missing file or projectId' });
    const record = await ingestCAWorkbook(projectId, req.file.path);
    res.json(record);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Failed to upload CA' });
  }
});

router.get('/:projectId', async (req, res) => {
  try {
    const data = await parseCAWorkbook(req.params.projectId);
    res.json(data);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Failed to parse CA for project' });
  }
});

export default router;
