import express from 'express';
import multer from 'multer';
import fs from 'fs/promises';
import path from 'path';
import OpenAI from 'openai';
import mammoth from 'mammoth';
import { fileURLToPath } from 'url';
import { authenticateToken } from '../middleware/auth.middleware.mjs';
import { Document, Paragraph, TextRun, AlignmentType, Packer } from 'docx';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const router = express.Router();

const upload = multer({ dest: './uploads/' });

// Storage path for transcripts
const TRANSCRIPTS_PATH = path.join(__dirname, '../data/transcripts.json');
const PROJECTS_PATH = path.join(__dirname, '../data/projects.json');

// Initialize transcripts file if it doesn't exist
async function initTranscriptsFile() {
  try {
    await fs.access(TRANSCRIPTS_PATH);
  } catch {
    await fs.writeFile(TRANSCRIPTS_PATH, JSON.stringify({}, null, 2));
  }
}

initTranscriptsFile();

// Helper function to assign respnos based on chronological order
function assignRespnos(transcripts) {
  // Sort by interview date (earliest first)
  const sorted = [...transcripts].sort((a, b) => {
    const dateA = a.interviewDate || '';
    const dateB = b.interviewDate || '';

    if (!dateA && !dateB) return 0;
    if (!dateA) return 1; // Put entries without dates at the end
    if (!dateB) return -1;

    try {
      const parsedA = new Date(dateA);
      const parsedB = new Date(dateB);

      if (!isNaN(parsedA.getTime()) && !isNaN(parsedB.getTime())) {
        return parsedA.getTime() - parsedB.getTime();
      }
    } catch (e) {
      // If date parsing fails, maintain current order
    }

    return 0;
  });

  // Assign sequential respnos
  sorted.forEach((transcript, index) => {
    transcript.respno = `R${String(index + 1).padStart(2, '0')}`;
  });

  return sorted;
}

// Helper function to parse date and time from transcript
function parseDateTimeFromTranscript(transcriptText) {
  // Common date patterns in transcripts
  const datePatterns = [
    /(?:Date|Interview Date|Session Date):\s*(\d{1,2}\/\d{1,2}\/\d{4})/i,
    /(?:Date|Interview Date|Session Date):\s*(\d{4}-\d{2}-\d{2})/i,
    /(?:Date|Interview Date|Session Date):\s*(\w+\s+\d{1,2},?\s+\d{4})/i,
    /(\d{1,2}\/\d{1,2}\/\d{4})/,
    /(\d{4}-\d{2}-\d{2})/,
  ];

  const timePatterns = [
    /(?:Time|Interview Time|Session Time):\s*(\d{1,2}:\d{2}\s*(?:AM|PM|am|pm))/i,
    /(?:Time|Interview Time|Session Time):\s*(\d{1,2}:\d{2}:\d{2})/i,
    /(\d{1,2}:\d{2}\s*(?:AM|PM|am|pm))/,
  ];

  let interviewDate = null;
  let interviewTime = null;

  // Try to find date
  for (const pattern of datePatterns) {
    const match = transcriptText.match(pattern);
    if (match) {
      interviewDate = match[1];
      break;
    }
  }

  // Try to find time
  for (const pattern of timePatterns) {
    const match = transcriptText.match(pattern);
    if (match) {
      interviewTime = match[1];
      break;
    }
  }

  return { interviewDate, interviewTime };
}

// Helper function to create formatted Word document
async function createFormattedWordDoc(cleanedText, projectName, respno, interviewDate, interviewTime) {
  const paragraphs = [];

  // Title: Project Name
  paragraphs.push(
    new Paragraph({
      children: [
        new TextRun({
          text: projectName,
          bold: true,
          size: 32, // 16pt
        }),
      ],
      alignment: AlignmentType.CENTER,
      spacing: { after: 200 },
    })
  );

  // Subtitle: [date] | [time] EST | [respno] Transcript
  const subtitleParts = [];
  if (interviewDate) subtitleParts.push(interviewDate);
  if (interviewTime) subtitleParts.push(`${interviewTime} EST`);
  subtitleParts.push(`${respno} Transcript`);
  const subtitle = subtitleParts.join(' | ');

  paragraphs.push(
    new Paragraph({
      children: [
        new TextRun({
          text: subtitle,
          italics: true,
          size: 20, // 10pt
        }),
      ],
      alignment: AlignmentType.CENTER,
      spacing: { after: 400 },
    })
  );

  // Process the cleaned transcript
  const lines = cleanedText.split('\n');

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();

    if (!line) {
      // Empty line - add spacing
      paragraphs.push(new Paragraph({ text: '' }));
      continue;
    }

    // Check if line starts with speaker label
    const moderatorMatch = line.match(/^(Moderator:)\s*(.*)$/);
    const respondentMatch = line.match(/^(Respondent:)\s*(.*)$/);

    if (moderatorMatch || respondentMatch) {
      const match = moderatorMatch || respondentMatch;
      const speaker = match[1];
      const text = match[2];

      paragraphs.push(
        new Paragraph({
          children: [
            new TextRun({
              text: speaker,
              bold: true,
            }),
            new TextRun({
              text: ' ' + text,
            }),
          ],
        })
      );
    } else {
      // Regular text (continuation of previous speaker)
      paragraphs.push(
        new Paragraph({
          text: line,
        })
      );
    }
  }

  const doc = new Document({
    sections: [{
      properties: {},
      children: paragraphs,
    }],
  });

  return await Packer.toBuffer(doc);
}

// GET all transcripts grouped by project
router.get('/all', authenticateToken, async (req, res) => {
  try {
    const data = await fs.readFile(TRANSCRIPTS_PATH, 'utf8');
    const transcripts = JSON.parse(data);
    res.json(transcripts);
  } catch (error) {
    console.error('Error loading transcripts:', error);
    res.status(500).json({ error: 'Failed to load transcripts' });
  }
});

// POST upload transcript
router.post('/upload', authenticateToken, upload.single('transcript'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No transcript file uploaded' });
    }

    const { projectId, cleanTranscript } = req.body;

    if (!projectId) {
      return res.status(400).json({ error: 'projectId is required' });
    }

    const originalSize = req.file.size;

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

    // Parse date and time from original transcript
    const { interviewDate, interviewTime } = parseDateTimeFromTranscript(transcriptText);

    // Load project data to get project name
    const projectsData = await fs.readFile(PROJECTS_PATH, 'utf8');
    const projectsObj = JSON.parse(projectsData);

    // Find project across all users
    let project = null;
    for (const userProjects of Object.values(projectsObj)) {
      if (Array.isArray(userProjects)) {
        project = userProjects.find(p => p.id === projectId);
        if (project) break;
      }
    }
    const projectName = project ? project.name : 'Transcript';

    // Get existing transcripts
    const transcriptsData = await fs.readFile(TRANSCRIPTS_PATH, 'utf8');
    const transcripts = JSON.parse(transcriptsData);

    if (!transcripts[projectId]) {
      transcripts[projectId] = [];
    }

    // Respno will be assigned AFTER we add the transcript and sort by date
    const transcriptId = `T-${Date.now()}`;

    let cleanedPath = null;
    let cleanedFilename = null;
    let cleanedSize = null;
    let cleanedText = null;

    // Clean the transcript if requested
    if (cleanTranscript === 'true') {
      const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

      const systemPrompt = `You are a professional transcript editor specializing in qualitative research interviews. Clean this transcript by following these rules:

CRITICAL INSTRUCTIONS:
1. PRESERVE INTERVIEW METADATA AT THE TOP:
   - If the transcript starts with interview metadata (Date, Time, Interview Date, Interview Time, Session Date, etc.), KEEP IT at the very beginning
   - Preserve the exact format of date and time information (e.g., "Interview Date: 10/15/2024" or "Date: October 15, 2024")
   - This metadata should appear BEFORE any speaker dialogue

2. IDENTIFY SPEAKERS CORRECTLY:
   - The MODERATOR asks questions, probes, facilitates the interview (e.g., "Can you tell me...", "How do you feel...", "That's interesting...")
   - The RESPONDENT answers questions, shares experiences, provides opinions (e.g., "I think...", "In my experience...", "I was...")
   - DO NOT simply copy existing speaker labels - they may be WRONG or MISSING
   - READ THE CONTENT to determine who is actually speaking

3. CLEAN UP THE TEXT:
   - Remove timestamps (e.g., (00:00:01 - 00:00:11))
   - Remove filler words (um, uh, like as filler, you know when used as filler)
   - Fix incomplete sentences and sentence fragments
   - Remove cross-talk and overlapping speech markers
   - Merge sentence fragments that belong together
   - Remove single-word fragments that don't add meaning (e.g., "This.", "Yeah." as standalone)

4. FORMATTING:
   - Use ONLY "Moderator:" and "Respondent:" as speaker labels
   - Put a blank line between each speaker turn
   - Keep each speaker's full turn together (don't split mid-thought)
   - Maintain natural paragraph breaks within long turns

5. PRESERVE CONTENT:
   - NEVER change meaning or remove substantive content
   - Keep all medical terms, drug names, dates, and specific details
   - Preserve the respondent's actual words and phrasing
   - Keep emotional context and tone

Output ONLY the cleaned transcript. No explanations or notes.`;

      const response = await client.chat.completions.create({
        model: 'gpt-4o',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: `Clean this transcript:\n\n${transcriptText}` }
        ],
        temperature: 0.1,
      });

      cleanedText = response.choices[0].message.content;

      // Save cleaned filename and path (will regenerate with correct respno later)
      cleanedFilename = `cleaned_${Date.now()}_${req.file.originalname.replace(/\.(txt|docx)$/i, '.docx')}`;
      cleanedPath = path.join('./uploads', cleanedFilename);
    }

    // Save original transcript with permanent name
    const originalFilename = `original_${Date.now()}_${req.file.originalname}`;
    const originalPath = path.join('./uploads', originalFilename);
    await fs.rename(req.file.path, originalPath);

    // Add transcript with temp respno
    const transcriptRecord = {
      id: transcriptId,
      originalFilename: req.file.originalname,
      cleanedFilename,
      originalPath,
      cleanedPath,
      uploadedAt: Date.now(),
      isCleaned: cleanTranscript === 'true',
      originalSize: originalSize,
      cleanedSize: null, // Will be set after Word doc is generated
      interviewDate,
      interviewTime,
      respno: `TEMP_${transcriptId}` // Temporary respno
    };

    transcripts[projectId].push(transcriptRecord);

    // Sort by date and assign sequential respnos
    transcripts[projectId] = assignRespnos(transcripts[projectId]);

    // Find the transcript we just added to get its final respno
    const finalTranscript = transcripts[projectId].find(t => t.id === transcriptId);

    if (!finalTranscript) {
      throw new Error('Failed to find transcript after respno assignment');
    }

    // If cleaned, generate Word document with the FINAL respno
    if (cleanTranscript === 'true' && cleanedText) {
      const wordBuffer = await createFormattedWordDoc(
        cleanedText,
        projectName,
        finalTranscript.respno,
        interviewDate,
        interviewTime
      );

      await fs.writeFile(cleanedPath, wordBuffer);
      finalTranscript.cleanedSize = wordBuffer.length;
    }

    // Save the final transcripts array with correct respnos
    await fs.writeFile(TRANSCRIPTS_PATH, JSON.stringify(transcripts, null, 2));

    res.json(finalTranscript);
  } catch (error) {
    console.error('Error uploading transcript:', error);
    res.status(500).json({ error: 'Failed to upload transcript' });
  }
});

// GET download transcript
router.get('/download/:projectId/:transcriptId', authenticateToken, async (req, res) => {
  try {
    const { projectId, transcriptId } = req.params;

    const data = await fs.readFile(TRANSCRIPTS_PATH, 'utf8');
    const transcripts = JSON.parse(data);

    if (!transcripts[projectId]) {
      return res.status(404).json({ error: 'Project not found' });
    }

    const transcript = transcripts[projectId].find(t => t.id === transcriptId);

    if (!transcript) {
      return res.status(404).json({ error: 'Transcript not found' });
    }

    // Download cleaned if available, otherwise original
    const filePath = (transcript.isCleaned && transcript.cleanedPath) ? transcript.cleanedPath : transcript.originalPath;
    const filename = (transcript.isCleaned && transcript.cleanedFilename) ? transcript.cleanedFilename : transcript.originalFilename;

    res.download(filePath, filename);
  } catch (error) {
    console.error('Error downloading transcript:', error);
    res.status(500).json({ error: 'Failed to download transcript' });
  }
});

// DELETE transcript
router.delete('/:projectId/:transcriptId', authenticateToken, async (req, res) => {
  try {
    const { projectId, transcriptId } = req.params;

    const data = await fs.readFile(TRANSCRIPTS_PATH, 'utf8');
    const transcripts = JSON.parse(data);

    if (!transcripts[projectId]) {
      return res.status(404).json({ error: 'Project not found' });
    }

    const transcriptIndex = transcripts[projectId].findIndex(t => t.id === transcriptId);

    if (transcriptIndex === -1) {
      return res.status(404).json({ error: 'Transcript not found' });
    }

    const transcript = transcripts[projectId][transcriptIndex];

    // Delete files
    try {
      await fs.unlink(transcript.originalPath);
      if (transcript.cleanedPath) {
        await fs.unlink(transcript.cleanedPath);
      }
    } catch (error) {
      console.warn('Failed to delete transcript files:', error);
    }

    // Remove from list
    transcripts[projectId].splice(transcriptIndex, 1);

    // Reassign respnos based on chronological order after deletion
    transcripts[projectId] = assignRespnos(transcripts[projectId]);

    await fs.writeFile(TRANSCRIPTS_PATH, JSON.stringify(transcripts, null, 2));

    res.json({ success: true });
  } catch (error) {
    console.error('Error deleting transcript:', error);
    res.status(500).json({ error: 'Failed to delete transcript' });
  }
});

export default router;

