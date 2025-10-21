import express from 'express';
import multer from 'multer';
import fs from 'fs/promises';
import path from 'path';
import OpenAI from 'openai';
import { logCost, COST_CATEGORIES } from '../services/costTracking.service.mjs';
import mammoth from 'mammoth';
import { fileURLToPath } from 'url';
import { authenticateToken } from '../middleware/auth.middleware.mjs';
import { Document, Paragraph, TextRun, AlignmentType, Packer } from 'docx';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const router = express.Router();

const upload = multer({ dest: './uploads/' });

// Storage path for transcripts
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '../data');
const TRANSCRIPTS_PATH = path.join(DATA_DIR, 'transcripts.json');
const PROJECTS_PATH = path.join(DATA_DIR, 'projects.json');

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

// Helper functions to normalize date/time strings from transcripts
function normalizeDateString(dateStr) {
  if (!dateStr) return null;
  let value = dateStr.trim();
  value = value.replace(/(\d{1,2})(st|nd|rd|th)/gi, '$1');
  value = value.replace(/(\d{1,2}),(\d{4})/, '$1, $2');
  let parsed = Date.parse(value);

  if (Number.isNaN(parsed)) {
    const mmdd = value.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
    if (mmdd) {
      parsed = Date.parse(`${mmdd[3]}-${mmdd[1]}-${mmdd[2]}`);
    }
  }

  if (Number.isNaN(parsed)) {
    const iso = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (iso) {
      parsed = Date.parse(value);
    }
  }

  if (!Number.isNaN(parsed)) {
    const date = new Date(parsed);
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  }

  return value;
}

function normalizeTimeString(timeStr) {
  if (!timeStr) return null;
  let value = timeStr.trim();
  value = value.replace(/[��]/g, '-');
  value = value.replace(/([0-9])\s*(AM|PM)/ig, '$1 $2');

  const timezoneMatch = value.match(/([A-Z]{2,4})$/);
  let timezone = null;
  if (timezoneMatch) {
    timezone = timezoneMatch[1].toUpperCase();
    value = value.slice(0, timezoneMatch.index).trim();
  }

  const ampmMatch = value.match(/(AM|PM)$/i);
  let hours;
  let minutes;

  if (ampmMatch) {
    const ampm = ampmMatch[1].toUpperCase();
    const base = value.slice(0, ampmMatch.index).trim();
    const parts = base.split(':');
    hours = parseInt(parts[0], 10);
    minutes = parseInt(parts[1] || '0', 10);

    if (Number.isNaN(hours) || Number.isNaN(minutes)) {
      return timeStr.trim();
    }

    hours = hours % 12 || 12;
    const formatted = `${hours}:${String(minutes).padStart(2, '0')} ${ampm}`;
    return timezone ? `${formatted} ${timezone}` : formatted;
  }

  const parts = value.split(':');
  hours = parseInt(parts[0], 10);
  minutes = parseInt(parts[1] || '0', 10);

  if (Number.isNaN(hours) || Number.isNaN(minutes)) {
    return timeStr.trim();
  }

  const ampm = hours >= 12 ? 'PM' : 'AM';
  hours = hours % 12 || 12;
  const formatted = `${hours}:${String(minutes).padStart(2, '0')} ${ampm}`;
  return timezone ? `${formatted} ${timezone}` : formatted;
}

// Helper function to parse date and time from transcript
function parseDateTimeFromTranscript(transcriptText) {
  if (!transcriptText) {
    return { interviewDate: null, interviewTime: null };
  }


  const text = transcriptText.replace(/\n/g, '');
  let rawDate = null;
  let rawTime = null;

  const combinedMatch = text.match(/\(?([A-Za-z]+\s+\d{1,2},?\s*\d{4})\s*(?:-|\u2013)\s*(\d{1,2}:\d{2}(?::\d{2})?\s*(?:AM|PM|am|pm)?(?:\s*[A-Z]{2,4})?)\)?/);
  if (combinedMatch) {
    rawDate = combinedMatch[1];
    rawTime = combinedMatch[2];
  }

  const datePatterns = [
    /(?:Date|Interview Date|Session Date):\s*(\d{1,2}\/\d{1,2}\/\d{4})/i,
    /(?:Date|Interview Date|Session Date):\s*(\d{4}-\d{2}-\d{2})/i,
    /(?:Date|Interview Date|Session Date):\s*(\w+\s+\d{1,2},?\s*\d{4})/i,
    /\((\w+\s+\d{1,2},?\s*\d{4})\s*-\s*\d{1,2}:\d{2}(?::\d{2})?\s*(?:AM|PM|am|pm)?\)/i, // Matches "(Oct 3, 2025 - 3:00pm)"
    // Match date with time separator (like "Oct 6, 2025 | 3:00pm")
    /(\w+\s+\d{1,2},?\s*\d{4})\s*\|\s*\d{1,2}:\d{2}(?::\d{2})?\s*(?:AM|PM|am|pm)?/i,
    /(\d{1,2}\/\d{1,2}\/\d{4})/,
    /(\d{4}-\d{2}-\d{2})/,
    // Match dates but avoid lines with "Transcript" word before the date - improved regex
    /(?<!Transcript\s*)(?<!Transcript)(?<![a-zA-Z])([A-Z][a-z]+\s+\d{1,2},?\s*\d{4})(?!\s*Transcript)(?!.*\.docx)(?!.*\.txt)/
  ];

  const timePatterns = [
    /(?:Time|Interview Time|Session Time):\s*(\d{1,2}:\d{2}(?::\d{2})?\s*(?:AM|PM|am|pm)?(?:\s*[A-Z]{2,4})?)/i,
    /\((\w+\s+\d{1,2},?\s*\d{4})\s*-\s*(\d{1,2}:\d{2}(?::\d{2})?\s*(?:AM|PM|am|pm)?)\)/i, // Matches "(Oct 3, 2025 - 3:00pm)"
    // Match time with date separator (like "Oct 6, 2025 | 3:00pm")
    /(\w+\s+\d{1,2},?\s*\d{4})\s*\|\s*(\d{1,2}:\d{2}(?::\d{2})?\s*(?:AM|PM|am|pm)?)/i,
    /(\d{1,2}:\d{2}(?::\d{2})?\s*(?:AM|PM|am|pm)?(?:\s*[A-Z]{2,4})?)/
  ];

  if (!rawDate) {
    for (const pattern of datePatterns) {
      const match = text.match(pattern);
      if (match) {
        rawDate = match[1];
        break;
      }
    }
  }

  if (!rawTime) {
    for (const pattern of timePatterns) {
      const match = text.match(pattern);
      if (match) {
        // For the combined date-time pattern, we need match[2] for time
        // For the pipe separator pattern "Oct 6, 2025 | 3:00pm", match[2] is the time
        rawTime = match.length > 2 ? match[2] : match[1];
        break;
      }
    }
  }

  // Clean up any dates that still have "Transcript" prefix
  if (rawDate && rawDate.includes('Transcript')) {
    rawDate = rawDate.replace(/^Transcript\s*/i, '').trim();
  }

  const interviewDate = normalizeDateString(rawDate);
  const interviewTime = normalizeTimeString(rawTime);


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
  if (interviewTime) subtitleParts.push(interviewTime);
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
  let hasStartedContent = false;

  for (let i = 0; i < lines.length; i++) {
    const rawLine = lines[i];
    const trimmedLine = rawLine.trim();

    if (!hasStartedContent) {
      if (!trimmedLine) {
        continue;
      }

      const normalizedLine = trimmedLine.replace(/\s+/g, ' ').toLowerCase();
      const normalizedProjectName = projectName.replace(/\s+/g, ' ').toLowerCase();
      const normalizedSubtitle = subtitle.replace(/\s+/g, ' ').toLowerCase();
      const respnoLine = `${respno} transcript`.toLowerCase();

      if (normalizedLine === normalizedProjectName) {
        continue;
      }

      if (subtitle && normalizedLine === normalizedSubtitle) {
        continue;
      }

      if (normalizedLine === respnoLine) {
        continue;
      }

      if (/^\(.*\)$/.test(trimmedLine)) {
        const inner = trimmedLine.slice(1, -1);
        if (/\d/.test(inner)) {
          continue;
        }
      }

      hasStartedContent = true;
    }

    if (!trimmedLine) {
      paragraphs.push(new Paragraph({ text: '' }));
      continue;
    }

    const moderatorMatch = trimmedLine.match(/^(Moderator:)\s*(.*)$/);
    const respondentMatch = trimmedLine.match(/^(Respondent:)\s*(.*)$/);

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
          text: trimmedLine,
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
1. REMOVE DUPLICATE HEADER INFORMATION:
   - If the transcript has duplicate title or project name information, keep only ONE instance
   - If there are duplicate date/time lines, keep only ONE instance
   - Remove any redundant header information that appears multiple times

2. PRESERVE INTERVIEW METADATA AT THE TOP:
   - Keep interview metadata (Date, Time, Interview Date, Interview Time, Session Date, etc.) at the very beginning
   - Preserve the exact format of date and time information (e.g., "Interview Date: 10/15/2024" or "Date: October 15, 2024")
   - This metadata should appear BEFORE any speaker dialogue

3. IDENTIFY SPEAKERS CORRECTLY:
   - The MODERATOR asks questions, probes, facilitates the interview (e.g., "Can you tell me...", "How do you feel...", "That's interesting...")
   - The RESPONDENT answers questions, shares experiences, provides opinions (e.g., "I think...", "In my experience...", "I was...")
   - DO NOT simply copy existing speaker labels - they may be WRONG or MISSING
   - READ THE CONTENT to determine who is actually speaking

4. CLEAN UP THE TEXT:
   - Remove timestamps (e.g., (00:00:01 - 00:00:11))
   - Remove filler words (um, uh, like as filler, you know when used as filler)
   - Fix incomplete sentences and sentence fragments
   - Remove cross-talk and overlapping speech markers
   - Merge sentence fragments that belong together
   - Remove single-word fragments that don't add meaning (e.g., "This.", "Yeah." as standalone)

5. FORMATTING:
   - Use ONLY "Moderator:" and "Respondent:" as speaker labels
   - Put a blank line between each speaker turn
   - Keep each speaker's full turn together (don't split mid-thought)
   - Maintain natural paragraph breaks within long turns

6. PRESERVE CONTENT:
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

      // Log AI cost for transcript cleaning (exact tokens when available)
      try {
        const inputTokens = response.usage?.prompt_tokens || 0;
        const outputTokens = response.usage?.completion_tokens || 0;
        if (inputTokens > 0 && outputTokens > 0) {
          await logCost(
            projectId,
            COST_CATEGORIES.TRANSCRIPT_CLEANING,
            'gpt-4o',
            inputTokens,
            outputTokens,
            'Transcript cleaning during upload'
          );
        }
      } catch (e) {
        console.warn('Failed to log cleaning cost:', e.message);
      }

      // Save cleaned filename and path (will regenerate with correct respno later)
      cleanedFilename = `cleaned_${Date.now()}_${req.file.originalname.replace(/\.(txt|docx)$/i, '.docx')}`;
      cleanedPath = path.join(DATA_DIR, 'uploads', cleanedFilename);
    }

    // Save original transcript with permanent name
    const uploadsDir = path.join(DATA_DIR, 'uploads');

    // Ensure uploads directory exists
    try {
      await fs.mkdir(uploadsDir, { recursive: true });
    } catch (error) {
      console.log('Uploads directory already exists or created');
    }

    const originalFilename = `original_${Date.now()}_${req.file.originalname}`;
    const originalPath = path.join(uploadsDir, originalFilename);

    // Use copyFile + unlink instead of rename to handle cross-device scenarios
    await fs.copyFile(req.file.path, originalPath);
    await fs.unlink(req.file.path);

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
    const deletedRespno = transcript.respno; // Store respno before deletion

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

    // Also remove from Content Analysis data if it exists
    try {
      const ANALYSES_PATH = path.join(process.env.DATA_DIR || path.join(__dirname, '../data'), 'savedAnalyses.json');
      const analysesData = await fs.readFile(ANALYSES_PATH, 'utf8');
      const analyses = JSON.parse(analysesData);

      if (analyses[projectId]) {
        const analysis = analyses[projectId];

        // Remove rows matching the deleted respno from all sheets
        if (analysis.data) {
          for (const sheetName of Object.keys(analysis.data)) {
            if (Array.isArray(analysis.data[sheetName])) {
              analysis.data[sheetName] = analysis.data[sheetName].filter(row => {
                const rowRespno = row['Respondent ID'] || row['respno'];
                return rowRespno !== deletedRespno;
              });
            }
          }
        }

        // Remove context for deleted respno
        if (analysis.context) {
          for (const sheetName of Object.keys(analysis.context)) {
            if (analysis.context[sheetName] && analysis.context[sheetName][deletedRespno]) {
              delete analysis.context[sheetName][deletedRespno];
            }
          }
        }

        // Remove quotes for deleted respno
        if (analysis.quotes && analysis.quotes[deletedRespno]) {
          delete analysis.quotes[deletedRespno];
        }

        // Now reassign respnos in CA data to match the updated transcript respnos
        // Build mapping from old respnos to new respnos based on updated transcripts
        const respnoMapping = new Map();
        transcripts[projectId].forEach((t, index) => {
          const newRespno = t.respno; // Already reassigned above
          // We need to find which old respno this transcript had
          // We can use the transcript ID to track it
          if (analysis.data && analysis.data.Demographics) {
            const demographicsRow = analysis.data.Demographics.find(row => {
              // Match by some unique identifier - we'll use position after sorting
              return true; // Will be fixed by chronological re-sort below
            });
          }
        });

        // Re-sort Demographics by date and reassign all respnos chronologically
        if (analysis.data && analysis.data.Demographics) {
          const demographics = analysis.data.Demographics;

          // Sort by interview date
          demographics.sort((a, b) => {
            const dateA = a['Interview Date'] || a['Date'] || '';
            const dateB = b['Interview Date'] || b['Date'] || '';

            if (dateA && dateB) {
              const parsedA = new Date(dateA);
              const parsedB = new Date(dateB);
              if (!isNaN(parsedA.getTime()) && !isNaN(parsedB.getTime())) {
                return parsedA.getTime() - parsedB.getTime();
              }
            }
            return 0;
          });

          // Reassign respnos sequentially
          demographics.forEach((row, index) => {
            const newRespno = `R${String(index + 1).padStart(2, '0')}`;
            if ('Respondent ID' in row) row['Respondent ID'] = newRespno;
            if ('respno' in row) row['respno'] = newRespno;
          });

          // Update other sheets to match Demographics respnos
          const sheetNames = Object.keys(analysis.data).filter(name => name !== 'Demographics');
          for (const sheetName of sheetNames) {
            const rows = analysis.data[sheetName];
            if (Array.isArray(rows)) {
              rows.forEach((row, index) => {
                if (index < demographics.length) {
                  const newRespno = demographics[index]['Respondent ID'] || demographics[index]['respno'];
                  if ('Respondent ID' in row) row['Respondent ID'] = newRespno;
                  if ('respno' in row) row['respno'] = newRespno;
                }
              });
            }
          }
        }

        await fs.writeFile(ANALYSES_PATH, JSON.stringify(analyses, null, 2));
        console.log(`Cleaned up CA data for deleted transcript ${deletedRespno}`);
      }
    } catch (error) {
      console.warn('Failed to clean up Content Analysis data:', error);
    }

    res.json({ success: true });
  } catch (error) {
    console.error('Error deleting transcript:', error);
    res.status(500).json({ error: 'Failed to delete transcript' });
  }
});

// Parse date/time from transcript file
router.post('/parse-datetime', authenticateToken, upload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    // Read the file
    let transcriptText = '';
    if (req.file.originalname.endsWith('.docx')) {
      const result = await mammoth.extractRawText({ path: req.file.path });
      transcriptText = result.value;
    } else {
      transcriptText = await fs.readFile(req.file.path, 'utf8');
    }

    // Parse date and time
    const { interviewDate, interviewTime } = parseDateTimeFromTranscript(transcriptText);

    // Clean up uploaded file
    await fs.unlink(req.file.path);

    res.json({ date: interviewDate, time: interviewTime });
  } catch (error) {
    console.error('Error parsing date/time:', error);
    // Clean up file if it exists
    if (req.file) {
      try {
        await fs.unlink(req.file.path);
      } catch (e) {
        console.warn('Failed to clean up file:', e);
      }
    }
    res.status(500).json({ error: 'Failed to parse date/time from transcript' });
  }
});

export default router;

