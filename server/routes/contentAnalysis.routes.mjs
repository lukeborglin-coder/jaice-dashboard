import { Router } from 'express';
import { authenticateToken, requireCognitiveOrAdmin } from '../middleware/auth.middleware.mjs';
import multer from 'multer';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { generateCAFromDG } from '../services/caGenerator.service.mjs';
import { ingestCAWorkbook, parseCAWorkbook } from '../services/caIngest.service.mjs';

const router = Router();
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const uploadDir = process.env.FILES_DIR || path.join(process.env.DATA_DIR || path.join(__dirname, '../data'), 'uploads');

// Ensure upload directory exists
await fs.mkdir(uploadDir, { recursive: true });

const upload = multer({ dest: uploadDir });

// Download template (public for now)
router.get('/template', async (req, res) => {
  try {
    const templatePath = path.join(__dirname, '../templates/CA_template_HCP.xlsx');

    // Check if template exists, create a basic one if not
    try {
      await fs.access(templatePath);
    } catch {
      // Create a basic template
      await createBasicTemplate(templatePath);
    }

    res.download(templatePath, 'CA_template_HCP.xlsx');
  } catch (error) {
    console.error('Error serving template:', error);
    res.status(500).json({ error: 'Failed to serve template' });
  }
});

// Require auth + company access for subsequent endpoints
router.use(authenticateToken, requireCognitiveOrAdmin);

// Generate CA from Discussion Guide
router.post('/generate', upload.single('dg'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'Missing dg file' });
    }

    if (!process.env.OPENAI_API_KEY) {
      return res.status(500).json({ error: 'OpenAI API key not configured' });
    }

    const outPath = await generateCAFromDG(req.file.path, uploadDir);
    const id = path.basename(outPath);

    res.json({
      fileId: id,
      downloadUrl: `/api/ca/download/${id}`,
      message: 'Content Analysis generated successfully'
    });
  } catch (error) {
    console.error('Error generating CA from DG:', error);
    res.status(500).json({ error: 'Failed to generate CA from DG: ' + error.message });
  }
});

// Download generated file
router.get('/download/:id', async (req, res) => {
  try {
    const filePath = path.join(uploadDir, req.params.id);
    res.download(filePath);
  } catch (error) {
    console.error('Error downloading file:', error);
    res.status(404).json({ error: 'File not found' });
  }
});

// Upload and ingest CA file
router.post('/upload', upload.single('file'), async (req, res) => {
  try {
    const { projectId } = req.body;
    if (!req.file || !projectId) {
      return res.status(400).json({ error: 'Missing file or projectId' });
    }

    const record = await ingestCAWorkbook(projectId, req.file.path);
    res.json(record);
  } catch (error) {
    console.error('Error uploading CA:', error);
    res.status(500).json({ error: 'Failed to upload CA: ' + error.message });
  }
});

// Get CA data for project
router.get('/:projectId', async (req, res) => {
  try {
    const data = await parseCAWorkbook(req.params.projectId);
    res.json(data);
  } catch (error) {
    console.error('Error parsing CA for project:', error);
    res.status(404).json({ error: 'Failed to parse CA for project: ' + error.message });
  }
});

// Create a basic template if one doesn't exist
async function createBasicTemplate(templatePath) {
  const xlsx = await import('xlsx');
  const wb = xlsx.utils.book_new();

  // Create a basic template with sample structure
  const sampleData = [
    { Category: 'Treatment A', Statement: 'Effective treatment', Mentions: 0, 'Top Box': 0, 'Second Box': 0, 'Bottom Box': 0, 'Net Positive': 0, Rank: 1 }
  ];

  const ws = xlsx.utils.json_to_sheet(sampleData);
  xlsx.utils.book_append_sheet(wb, ws, 'Category Ranking');

  await fs.mkdir(path.dirname(templatePath), { recursive: true });
  xlsx.writeFile(wb, templatePath);
}

export default router;

