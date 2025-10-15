import express from 'express';
import multer from 'multer';
import fs from 'fs/promises';
import path from 'path';
import OpenAI from 'openai';
import { logCost, COST_CATEGORIES } from '../services/costTracking.service.mjs';
import mammoth from 'mammoth';
import { fileURLToPath } from 'url';
import { authenticateToken } from '../middleware/auth.middleware.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const router = express.Router();

const upload = multer({ dest: './uploads/' });

// Storage path for cleaner projects
const CLEANER_PROJECTS_PATH = path.join(__dirname, '../data/cleanerProjects.json');

// Initialize cleaner projects file if it doesn't exist
async function initCleanerProjectsFile() {
  try {
    await fs.access(CLEANER_PROJECTS_PATH);
  } catch {
    await fs.writeFile(CLEANER_PROJECTS_PATH, JSON.stringify([], null, 2));
  }
}

initCleanerProjectsFile();

// GET all cleaner projects
router.get('/projects', authenticateToken, async (req, res) => {
  try {
    const data = await fs.readFile(CLEANER_PROJECTS_PATH, 'utf8');
    const projects = JSON.parse(data);
    res.json(projects);
  } catch (error) {
    console.error('Error loading cleaner projects:', error);
    res.status(500).json({ error: 'Failed to load cleaner projects' });
  }
});

// POST create new cleaner project
router.post('/projects', authenticateToken, async (req, res) => {
  try {
    const { name, projectId } = req.body;

    if (!name || !projectId) {
      return res.status(400).json({ error: 'Name and projectId are required' });
    }

    const data = await fs.readFile(CLEANER_PROJECTS_PATH, 'utf8');
    const projects = JSON.parse(data);

    const newProject = {
      id: `TC-${Date.now()}`,
      name,
      projectId,
      transcripts: [],
      createdAt: Date.now()
    };

    projects.push(newProject);
    await fs.writeFile(CLEANER_PROJECTS_PATH, JSON.stringify(projects, null, 2));

    res.json(newProject);
  } catch (error) {
    console.error('Error creating cleaner project:', error);
    res.status(500).json({ error: 'Failed to create cleaner project' });
  }
});

// POST upload and clean transcript
router.post('/upload', authenticateToken, upload.single('transcript'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No transcript file uploaded' });
    }

    const { cleanerProjectId } = req.body;

    if (!cleanerProjectId) {
      return res.status(400).json({ error: 'cleanerProjectId is required' });
    }

    // Read the transcript file
    let transcriptText;
    if (req.file.originalname.endsWith('.txt')) {
      transcriptText = await fs.readFile(req.file.path, 'utf8');
    } else if (req.file.originalname.endsWith('.docx')) {
      const result = await mammoth.extractRawText({ path: req.file.path });
      transcriptText = result.value;
    } else {
      return res.status(400).json({ error: 'Unsupported file format. Please upload .txt or .docx files.' });
    }

    // Clean the transcript using AI
    const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

    const systemPrompt = `You are a professional transcript editor. You will receive an interview transcript and must clean it following EXACT rules below.

RULE 1: Remove timestamps only
- Delete lines or inline markers like (00:00:01 - 00:00:11) or [00:00:01]
- Keep the header timestamp if it appears at the very top (e.g., "(Oct 1, 2025 - 3:00pm)")

RULE 2: Fix speaker labels
- Standardize to "Moderator:" and "Respondent:"
- Fix variations like "Interviewer:", "Nancy:", "Michael:", "Participant:", etc.
- Ensure consistent formatting with colon after speaker name

RULE 3: Remove filler words and clean up speech
- Remove: "um", "uh", "like" (when used as filler), "you know", stutters
- Fix incomplete sentences and fragments
- Keep the meaning exactly the same

RULE 4: Format properly
- One speaker turn per paragraph
- Blank line between speaker turns
- No extra whitespace

RULE 5: Preserve content
- NEVER change the actual words or meaning
- NEVER remove substantive content
- NEVER add information that wasn't there

Output ONLY the cleaned transcript. No explanations, no comments.`;

    const userPrompt = `Clean this transcript:\n\n${transcriptText}`;

    const response = await client.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt }
      ],
      temperature: 0.1,
    });

    const cleanedText = response.choices[0].message.content;

    // Log AI cost for transcript cleaner (exact tokens when available)
    try {
      const inputTokens = response.usage?.prompt_tokens || 0;
      const outputTokens = response.usage?.completion_tokens || 0;
      const projectId = req.body?.projectId;
      if (inputTokens > 0 && outputTokens > 0 && projectId) {
        await logCost(
          projectId,
          COST_CATEGORIES.TRANSCRIPT_CLEANING,
          'gpt-4o-mini',
          inputTokens,
          outputTokens,
          'Transcript Cleaner - AI cleaning'
        );
      }
    } catch (e) {
      console.warn('Failed to log transcript cleaner cost:', e.message);
    }

    // Save cleaned transcript
    const cleanedFilename = `cleaned_${Date.now()}_${req.file.originalname.replace('.docx', '.txt')}`;
    const cleanedPath = path.join('./uploads', cleanedFilename);
    await fs.writeFile(cleanedPath, cleanedText, 'utf8');

    // Update cleaner project
    const data = await fs.readFile(CLEANER_PROJECTS_PATH, 'utf8');
    const projects = JSON.parse(data);
    const projectIndex = projects.findIndex(p => p.id === cleanerProjectId);

    if (projectIndex === -1) {
      return res.status(404).json({ error: 'Cleaner project not found' });
    }

    const transcriptRecord = {
      id: `T-${Date.now()}`,
      originalFilename: req.file.originalname,
      cleanedFilename,
      cleanedPath,
      uploadedAt: Date.now()
    };

    projects[projectIndex].transcripts.push(transcriptRecord);
    await fs.writeFile(CLEANER_PROJECTS_PATH, JSON.stringify(projects, null, 2));

    // Clean up original upload
    await fs.unlink(req.file.path);

    res.json(transcriptRecord);
  } catch (error) {
    console.error('Error uploading transcript:', error);
    res.status(500).json({ error: 'Failed to upload and clean transcript' });
  }
});

// GET download cleaned transcript
router.get('/download/:cleanerProjectId/:transcriptId', authenticateToken, async (req, res) => {
  try {
    const { cleanerProjectId, transcriptId } = req.params;

    const data = await fs.readFile(CLEANER_PROJECTS_PATH, 'utf8');
    const projects = JSON.parse(data);
    const project = projects.find(p => p.id === cleanerProjectId);

    if (!project) {
      return res.status(404).json({ error: 'Cleaner project not found' });
    }

    const transcript = project.transcripts.find(t => t.id === transcriptId);

    if (!transcript) {
      return res.status(404).json({ error: 'Transcript not found' });
    }

    res.download(transcript.cleanedPath, transcript.cleanedFilename);
  } catch (error) {
    console.error('Error downloading transcript:', error);
    res.status(500).json({ error: 'Failed to download transcript' });
  }
});

export default router;

