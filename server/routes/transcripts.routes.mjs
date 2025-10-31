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

// Helper function to regenerate cleaned transcript files when respnos change
async function regenerateCleanedTranscripts(projectId, transcripts, projectName) {
  try {
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
    const finalProjectName = project ? project.name : projectName || 'Transcript';

    // Regenerate cleaned transcripts for all transcripts that have cleaned files
    for (const transcript of transcripts) {
      if (transcript.isCleaned && transcript.cleanedPath) {
        try {
          // Check if cleaned file exists
          const cleanedPathExists = await fs.access(transcript.cleanedPath).then(() => true).catch(() => false);
          
          if (cleanedPathExists) {
            // Extract text from existing cleaned Word document
            const result = await mammoth.extractRawText({ path: transcript.cleanedPath });
            const cleanedText = result.value;
            
            if (cleanedText && cleanedText.trim()) {
              // Regenerate Word document (no respno)
              const wordBuffer = await createFormattedWordDoc(
                cleanedText,
                finalProjectName,
                null, // No respno in cleaned transcripts
                transcript.interviewDate,
                transcript.interviewTime
              );

              await fs.writeFile(transcript.cleanedPath, wordBuffer);
              transcript.cleanedSize = wordBuffer.length;
              console.log(`✅ Regenerated cleaned transcript for ${transcript.id}`);
            }
          }
        } catch (error) {
          console.warn(`⚠️ Failed to regenerate cleaned transcript for ${transcript.id}:`, error.message);
        }
      }
    }
  } catch (error) {
    console.error('❌ Error regenerating cleaned transcripts:', error);
  }
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
// Note: respno parameter is kept for backward compatibility but is not used (cleaned transcripts don't include respno)
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

  // Subtitle: [date] | [time] (no respno)
  const subtitleParts = [];
  if (interviewDate) subtitleParts.push(interviewDate);
  if (interviewTime) subtitleParts.push(interviewTime);
  const subtitle = subtitleParts.length > 0 ? subtitleParts.join(' | ') : null;

  // Only add subtitle if we have date or time
  if (subtitle) {
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
  }

  // Process the cleaned transcript
  // First, collapse multiple consecutive blank lines into single blank lines
  let normalizedText = cleanedText.replace(/\n{3,}/g, '\n\n');
  const lines = normalizedText.split('\n');
  let hasStartedContent = false;
  let previousWasBlank = false;
  let previousWasSpeaker = false;

  for (let i = 0; i < lines.length; i++) {
    const rawLine = lines[i];
    const trimmedLine = rawLine.trim();

    if (!hasStartedContent) {
      if (!trimmedLine) {
        continue;
      }

      const normalizedLine = trimmedLine.replace(/\s+/g, ' ').toLowerCase();
      const normalizedProjectName = projectName.replace(/\s+/g, ' ').toLowerCase();
      const normalizedSubtitle = subtitle ? subtitle.replace(/\s+/g, ' ').toLowerCase() : '';

      if (normalizedLine === normalizedProjectName) {
        continue;
      }

      if (subtitle && normalizedLine === normalizedSubtitle) {
        continue;
      }

      // Skip lines that look like respno patterns (e.g., "R01", "R01 Transcript", "R 01", "R01 - Transcript", etc.)
      if (/^r\s*\d{2}\s*[-:]?\s*(transcript)?$/i.test(trimmedLine)) {
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

    // Handle blank lines - only add one paragraph between speakers
    if (!trimmedLine) {
      // Only add blank paragraph if the previous line was a speaker line
      // Skip if we already added a blank after the previous speaker
      if (previousWasSpeaker && !previousWasBlank) {
        paragraphs.push(new Paragraph({ text: '' }));
        previousWasBlank = true;
      }
      continue;
    }

    // Reset blank flag since we have content
    previousWasBlank = false;

    const moderatorMatch = trimmedLine.match(/^(Moderator:)\s*(.*)$/);
    const respondentMatch = trimmedLine.match(/^(Respondent:)\s*(.*)$/);

    if (moderatorMatch || respondentMatch) {
      const match = moderatorMatch || respondentMatch;
      const speaker = match[1];
      const text = match[2];

      // Add blank line before speaker if previous line was also a speaker (different speaker turn)
      if (previousWasSpeaker) {
        paragraphs.push(new Paragraph({ text: '' }));
      }

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
      previousWasSpeaker = true;
    } else {
      // Regular text (continuation of previous speaker)
      paragraphs.push(
        new Paragraph({
          text: trimmedLine,
        })
      );
      previousWasSpeaker = false;
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

// GET transcripts for a specific project
router.get('/:projectId', authenticateToken, async (req, res) => {
  try {
    const { projectId } = req.params;
    const data = await fs.readFile(TRANSCRIPTS_PATH, 'utf8');
    const transcripts = JSON.parse(data);
    const projectTranscripts = transcripts[projectId] || [];
    res.json(projectTranscripts);
  } catch (error) {
    console.error('Error loading project transcripts:', error);
    res.status(500).json({ error: 'Failed to load project transcripts' });
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

    // Respno will be assigned when added to a Content Analysis (not on upload)
    const transcriptId = `T-${Date.now()}`;

    let cleanedPath = null;
    let cleanedFilename = null;
    let cleanedSize = null;
    let cleanedText = null;

    // Clean the transcript if requested
    if (cleanTranscript === 'true') {
      try {
        console.log('🧹 Starting transcript cleaning process...');
        console.log('📄 Original transcript length:', transcriptText.length);
        
        if (!process.env.OPENAI_API_KEY) {
          console.error('❌ OpenAI API key not configured');
          throw new Error('OpenAI API key not configured');
        }

        const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

        const providedModerator = req.body?.moderatorName || null;
        const providedRespondent = req.body?.respondentName || null;
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

7. SPEAKER LABELS (IF PROVIDED BY USER):
   - If the user provided speaker tags, use them as the fixed speaker labels:
     - Moderator label: ${providedModerator || 'Moderator'}
     - Respondent label: ${providedRespondent || 'Respondent'}
   - If not provided or ambiguous, default to Moderator/Respondent as labels

6. PRESERVE CONTENT:
   - NEVER change meaning or remove substantive content
   - Keep all medical terms, drug names, dates, and specific details
   - Preserve the respondent's actual words and phrasing
   - Keep emotional context and tone

Output ONLY the cleaned transcript. No explanations or notes.`;

        console.log('🤖 Calling OpenAI API for transcript cleaning...');
        const response = await client.chat.completions.create({
          model: 'gpt-4o',
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: `Clean this transcript:\n\n${transcriptText}` }
          ],
          temperature: 0.1,
        });

        if (!response.choices || !response.choices[0] || !response.choices[0].message || !response.choices[0].message.content) {
          throw new Error('OpenAI API returned invalid response');
        }

        cleanedText = response.choices[0].message.content.trim();
        
        console.log('✅ Received cleaned transcript from OpenAI');
        console.log('📄 Cleaned transcript length:', cleanedText.length);
        console.log('📊 Original vs Cleaned length difference:', transcriptText.length - cleanedText.length);
        
        // Verify the cleaned text is actually different
        if (cleanedText === transcriptText.trim()) {
          console.warn('⚠️ WARNING: Cleaned transcript is identical to original! OpenAI may not have cleaned it properly.');
        }
        
        if (cleanedText.length === 0) {
          throw new Error('Cleaned transcript is empty');
        }

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

        // Save cleaned filename and path (no respno in filename)
        cleanedFilename = `cleaned_${Date.now()}_${req.file.originalname.replace(/\.(txt|docx)$/i, '.docx')}`;
        cleanedPath = path.join(DATA_DIR, 'uploads', cleanedFilename);
        
        console.log('✅ Transcript cleaning completed successfully');
      } catch (cleaningError) {
        console.error('❌ Error during transcript cleaning:', cleaningError);
        console.error('Error details:', cleaningError.message);
        console.error('Stack trace:', cleaningError.stack);
        // Don't fail the upload if cleaning fails - just mark it as not cleaned
        cleanedText = null;
        cleanedFilename = null;
        cleanedPath = null;
        console.warn('⚠️ Continuing with upload without cleaning due to error');
      }
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

    // Add transcript without assigning respno yet
    const transcriptRecord = {
      id: transcriptId,
      originalFilename: req.file.originalname,
      cleanedFilename,
      originalPath,
      cleanedPath,
      uploadedAt: Date.now(),
      isCleaned: cleanTranscript === 'true' && cleanedText !== null && cleanedText.length > 0,
      originalSize: originalSize,
      cleanedSize: null, // Will be set after Word doc is generated
      interviewDate,
      interviewTime,
      respno: null
    };

    transcripts[projectId].push(transcriptRecord);

    // DO NOT assign respno on upload - respnos are only assigned when transcript is added to a Content Analysis
    // Keep respno as null until added to CA
    
    // If cleaned, generate Word document (respno will be null/placeholder until added to CA)
    if (cleanTranscript === 'true' && cleanedText) {
      console.log('💾 Saving cleaned transcript to file...');
      console.log('📁 Cleaned path:', cleanedPath);
      console.log('📄 Cleaned text length:', cleanedText.length);
      
      try {
        // Generate Word doc without respno (will be regenerated when added to CA with proper respno)
        const wordBuffer = await createFormattedWordDoc(
          cleanedText,
          projectName,
          null, // No respno yet - will be assigned when added to CA
          interviewDate,
          interviewTime
        );

        await fs.writeFile(cleanedPath, wordBuffer);
        transcriptRecord.cleanedSize = wordBuffer.length;
        console.log('✅ Cleaned transcript saved successfully (without respno)');
        console.log('📊 File size:', wordBuffer.length, 'bytes');
      } catch (saveError) {
        console.error('❌ Error saving cleaned transcript file:', saveError);
        console.error('Error details:', saveError.message);
        // Don't fail the upload if file save fails, but mark as not cleaned
        transcriptRecord.isCleaned = false;
        transcriptRecord.cleanedPath = null;
        transcriptRecord.cleanedFilename = null;
      }
    } else if (cleanTranscript === 'true' && !cleanedText) {
      console.warn('⚠️ Cleaning was requested but no cleaned text was generated');
      transcriptRecord.isCleaned = false;
    }

    // Save the final transcripts array
    await fs.writeFile(TRANSCRIPTS_PATH, JSON.stringify(transcripts, null, 2));

    // Regenerate cleaned transcripts for all transcripts that may have changed respnos
    // (this handles the case where adding a new transcript causes respnos to shift)
    await regenerateCleanedTranscripts(projectId, transcripts[projectId], projectName);

    // Update content analysis data only if needed (no respno changes on upload now)
    try {
      console.log('🔄 Updating content analysis data after transcript re-ordering...');
      const ANALYSES_PATH = path.join(DATA_DIR, 'savedAnalyses.json');
      const analysesData = await fs.readFile(ANALYSES_PATH, 'utf8');
      const analyses = JSON.parse(analysesData);

      const projectAnalyses = analyses.filter(analysis => analysis.projectId === projectId);
      console.log(`🔍 Found ${projectAnalyses.length} analyses for project ${projectId}`);

      for (const analysis of projectAnalyses) {
        if (analysis.data && analysis.data.Demographics && analysis.data.Demographics.length > 0) {
          console.log(`🔍 Updating analysis ${analysis.id} with ${analysis.data.Demographics.length} demographics rows`);
          
          // Create mapping of transcriptId to new respno from current transcript order
          const transcriptIdToRespno = new Map();
          transcripts[projectId].forEach((transcript) => {
            if (transcript.id && transcript.respno) {
              transcriptIdToRespno.set(transcript.id, transcript.respno);
            }
          });
          
          console.log('🔍 TranscriptId to Respno mapping:', Array.from(transcriptIdToRespno.entries()));

          // Update respnos in all demographics rows based on transcriptId
          const updatedDemographics = analysis.data.Demographics.map((row) => {
            if (row.transcriptId) {
              const newRespno = transcriptIdToRespno.get(row.transcriptId);
              if (newRespno) {
                return {
                  ...row,
                  'Respondent ID': newRespno,
                  respno: newRespno
                };
              }
            }
            return row;
          });

          // Sort demographics by the new respno order (R01, R02, ...)
          updatedDemographics.sort((a, b) => {
            const respnoA = a['Respondent ID'] || a['respno'];
            const respnoB = b['Respondent ID'] || b['respno'];
            const numA = parseInt(String(respnoA).replace(/\D/g, '') || '999', 10);
            const numB = parseInt(String(respnoB).replace(/\D/g, '') || '999', 10);
            return numA - numB;
          });

          // Update the analysis data
          analysis.data.Demographics = updatedDemographics;

          // Update other sheets to match Demographics respnos and transcriptIds by index
          const sheetNames = Object.keys(analysis.data).filter(name => name !== 'Demographics');
          console.log('🔍 Updating other sheets:', sheetNames);

          for (const sheetName of sheetNames) {
            const rows = analysis.data[sheetName];
            if (Array.isArray(rows)) {
              rows.forEach((row, index) => {
                if (index < updatedDemographics.length) {
                  const newRespno = updatedDemographics[index]['Respondent ID'] || updatedDemographics[index]['respno'];
                  const newTranscriptId = updatedDemographics[index]['transcriptId'];

                  if ('Respondent ID' in row) row['Respondent ID'] = newRespno;
                  if ('respno' in row) row['respno'] = newRespno;
                  if (newTranscriptId) row['transcriptId'] = newTranscriptId;
                }
              });
            }
          }

          console.log(`✅ Updated content analysis ${analysis.id} with new respno assignments`);
        }
      }

      // Save the updated analyses
      if (projectAnalyses.length > 0) {
        await fs.writeFile(ANALYSES_PATH, JSON.stringify(analyses, null, 2));
        console.log(`✅ Updated ${projectAnalyses.length} content analyses after transcript re-ordering`);
      }
    } catch (error) {
      console.error('❌ Failed to update content analysis data:', error);
      // Don't fail the transcript upload if CA update fails
    }

    res.json(transcriptRecord);
  } catch (error) {
    console.error('Error uploading transcript:', error);
    res.status(500).json({ error: 'Failed to upload transcript' });
  }
});

// GET download transcript
router.get('/download/:projectId/:transcriptId', authenticateToken, async (req, res) => {
  try {
    const { projectId, transcriptId } = req.params;
    const { preferCleaned, asText } = req.query;

    const data = await fs.readFile(TRANSCRIPTS_PATH, 'utf8');
    const transcripts = JSON.parse(data);

    if (!transcripts[projectId]) {
      return res.status(404).json({ error: 'Project not found' });
    }

    const transcript = transcripts[projectId].find(t => t.id === transcriptId);

    if (!transcript) {
      return res.status(404).json({ error: 'Transcript not found' });
    }

    // Determine which file to use
    let filePath;
    let filename;

    if (preferCleaned === 'true' && transcript.isCleaned && transcript.cleanedPath) {
      filePath = transcript.cleanedPath;
      filename = transcript.cleanedFilename;
    } else {
      filePath = transcript.originalPath;
      filename = transcript.originalFilename;
    }

    // If asText is requested, extract plain text from .docx
    if (asText === 'true') {
      try {
        const result = await mammoth.extractRawText({ path: filePath });
        const text = result.value;
        res.setHeader('Content-Type', 'text/plain; charset=utf-8');
        return res.send(text);
      } catch (extractError) {
        console.error('Error extracting text from docx:', extractError);
        return res.status(500).json({ error: 'Failed to extract text from document' });
      }
    }

    // Otherwise, download the file as-is
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
    const deletedTranscriptId = transcript.id; // Use transcriptId, not respno
    const deletedRespno = transcript.respno; // Store for logging

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

    // Do NOT renumber existing respnos on deletion; they are locked. Optionally regenerate docs unchanged.
    try { await regenerateCleanedTranscripts(projectId, transcripts[projectId], null); } catch {}

    await fs.writeFile(TRANSCRIPTS_PATH, JSON.stringify(transcripts, null, 2));

    // Also remove from Content Analysis data if it exists
    try {
      const ANALYSES_PATH = path.join(process.env.DATA_DIR || path.join(__dirname, '../data'), 'savedAnalyses.json');
      const analysesData = await fs.readFile(ANALYSES_PATH, 'utf8');
      const analyses = JSON.parse(analysesData);

      // analyses is an array, so find all analyses for this project
      const projectAnalyses = analyses.filter(a => a.projectId === projectId);

      for (const analysis of projectAnalyses) {
        console.log(`Processing analysis ${analysis.id} for deleted transcript ${deletedTranscriptId} (${deletedRespno})`);

        // CRITICAL: Remove rows matching the deleted transcriptId, NOT respno
        // Different CAs can have different transcripts with the same respno
        if (analysis.data) {
          for (const sheetName of Object.keys(analysis.data)) {
            if (Array.isArray(analysis.data[sheetName])) {
              const beforeLength = analysis.data[sheetName].length;
              const filteredRows = analysis.data[sheetName].filter(row => {
                // Match by transcriptId first (most reliable), fallback to respno only if no transcriptId exists
                const rowTranscriptId = row?.transcriptId ? String(row.transcriptId) : null;
                if (rowTranscriptId) {
                  return rowTranscriptId !== String(deletedTranscriptId);
                }
                // Fallback: if row has no transcriptId, match by respno (legacy rows)
                // This is less reliable but needed for backwards compatibility
                const rowRespno = row['Respondent ID'] || row['respno'];
                return rowRespno !== deletedRespno;
              });
              
              // CRITICAL: Preserve sheet structure even when no data rows remain
              // Keep the sheet as an empty array to maintain the sheet structure
              analysis.data[sheetName] = filteredRows;
              
              const afterLength = analysis.data[sheetName].length;
              if (beforeLength !== afterLength) {
                console.log(`  Removed from ${sheetName}: ${beforeLength} → ${afterLength} rows`);
                if (afterLength === 0) {
                  console.log(`  ⚠️ Sheet ${sheetName} is now empty but structure preserved`);
                }
              }
            }
          }
        }

        // Remove context for deleted transcript (match by respno since context is keyed by respno)
        // Find the respno that was associated with this transcriptId in this CA
        let respnoToRemoveFromContext = null;
        if (analysis.data?.Demographics) {
          const demoRow = analysis.data.Demographics.find(r => 
            r?.transcriptId && String(r.transcriptId) === String(deletedTranscriptId)
          );
          if (demoRow) {
            respnoToRemoveFromContext = demoRow['Respondent ID'] || demoRow['respno'];
          }
        }
        
        if (analysis.context && respnoToRemoveFromContext) {
          for (const sheetName of Object.keys(analysis.context)) {
            if (analysis.context[sheetName] && analysis.context[sheetName][respnoToRemoveFromContext]) {
              delete analysis.context[sheetName][respnoToRemoveFromContext];
            }
          }
        }

        // Remove quotes for deleted transcript (match by respno since quotes are keyed by respno)
        if (analysis.quotes && respnoToRemoveFromContext) {
          if (analysis.quotes[respnoToRemoveFromContext]) {
            delete analysis.quotes[respnoToRemoveFromContext];
          }
        }
        
        // Also remove from verbatimQuotes if present
        if (analysis.verbatimQuotes && respnoToRemoveFromContext) {
          for (const sheetName of Object.keys(analysis.verbatimQuotes)) {
            if (analysis.verbatimQuotes[sheetName] && analysis.verbatimQuotes[sheetName][respnoToRemoveFromContext]) {
              delete analysis.verbatimQuotes[sheetName][respnoToRemoveFromContext];
            }
          }
        }
        
        // Remove from analysis.transcripts array
        if (Array.isArray(analysis.transcripts)) {
          const beforeTranscriptsLength = analysis.transcripts.length;
          analysis.transcripts = analysis.transcripts.filter(t => {
            const tid = t?.id || t?.sourceTranscriptId;
            return String(tid) !== String(deletedTranscriptId);
          });
          if (analysis.transcripts.length !== beforeTranscriptsLength) {
            console.log(`  Removed transcript ${deletedTranscriptId} from analysis.transcripts`);
          }
        }

        // After deletion, ensure other sheets don't have more rows than Demographics
        // This is a cleanup step - rows with deleted transcriptIds should already be removed above
        if (analysis.data && analysis.data.Demographics) {
          const demographics = analysis.data.Demographics;
          const demographicsTranscriptIds = new Set(
            demographics
              .filter(r => r?.transcriptId)
              .map(r => String(r.transcriptId))
          );

          // Update other sheets to match Demographics - remove any rows that don't have matching transcriptIds
          const sheetNames = Object.keys(analysis.data).filter(name => name !== 'Demographics');
          console.log('🔍 Sheet names to update:', sheetNames);
          console.log('🔍 Demographics length:', demographics.length);
          console.log('🔍 Demographics transcriptIds:', Array.from(demographicsTranscriptIds));
          
          for (const sheetName of sheetNames) {
            const rows = analysis.data[sheetName];
            console.log(`🔍 Processing sheet ${sheetName}:`, Array.isArray(rows) ? `Array with ${rows.length} rows` : 'Not an array');
            
            if (Array.isArray(rows) && rows.length > 0) {
              // If demographics is empty, remove only respondent rows; keep template/category rows
              if (demographics.length === 0) {
                console.log(`🔍 Demographics is empty; preserving ${sheetName} template rows and removing respondent rows`);
                const preserved = rows.filter((row) => {
                  const rid = row?.['Respondent ID'] || row?.respno;
                  const tid = row?.transcriptId;
                  // Preserve rows that do NOT look like respondent rows
                  return !( (typeof rid === 'string' && rid.trim().startsWith('R')) || (typeof tid === 'string' && tid.trim() !== '') );
                });
                analysis.data[sheetName] = preserved;
              } else {
                // CRITICAL: Remove rows that don't have transcriptIds matching Demographics
                const validRows = rows.filter((row) => {
                  const tid = row?.transcriptId ? String(row.transcriptId).trim() : null;
                  const rid = row?.['Respondent ID'] || row?.respno;
                  const isRespondentRow = rid && typeof rid === 'string' && rid.trim().startsWith('R');
                  
                  // Remove any respondent row (starts with 'R') that doesn't have a transcriptId
                  if (isRespondentRow && !tid) {
                    console.log(`  Removing row from ${sheetName} with respno ${rid} but no transcriptId`);
                    return false;
                  }
                  
                  // Keep rows that:
                  // 1. Have a transcriptId that matches Demographics, OR
                  // 2. Don't have a transcriptId/respno (template/category rows)
                  if (tid) {
                    const keep = demographicsTranscriptIds.has(tid);
                    if (!keep) {
                      console.log(`  Removing row from ${sheetName} with transcriptId ${tid} (not in Demographics)`);
                    }
                    return keep;
                  }
                  
                  // Keep rows without transcriptIds that are NOT respondent rows (template/category rows)
                  return !isRespondentRow;
                });
                
                // Now update remaining rows to match Demographics order
                const updatedRows = validRows.map((row, index) => {
                  if (index < demographics.length) {
                    const newRespno = demographics[index]['Respondent ID'] || demographics[index]['respno'];
                    const newTranscriptId = demographics[index]['transcriptId'];
                    
                    return {
                      ...row,
                      'Respondent ID': newRespno,
                      respno: newRespno,
                      transcriptId: newTranscriptId || row.transcriptId
                    };
                  }
                  return row;
                }).slice(0, demographics.length); // Ensure we don't have more rows than Demographics
                
                analysis.data[sheetName] = updatedRows;
                console.log(`  Updated ${sheetName}: ${rows.length} → ${updatedRows.length} rows`);
              }
            }
          }

          console.log(`  Updated sheets to match Demographics after deletion`);
        }
      }

      if (projectAnalyses.length > 0) {
        await fs.writeFile(ANALYSES_PATH, JSON.stringify(analyses, null, 2));
        console.log(`✅ Cleaned up ${projectAnalyses.length} CA(s) for deleted transcript ${deletedRespno}`);
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

// Helper function to update CA data sheets with new respnos
async function updateCADataWithRespnos(projectId, transcriptIdToRespno) {
  try {
    const CAX_PATH = path.join(DATA_DIR, 'savedAnalyses.json');
    const caData = await fs.readFile(CAX_PATH, 'utf8');
    const analyses = JSON.parse(caData);
    
    const projectAnalyses = analyses.filter(a => a.projectId === projectId);
    let updated = false;
    
    for (const analysis of projectAnalyses) {
      if (!analysis.data || typeof analysis.data !== 'object') continue;
      
      let analysisUpdated = false;
      
      // Update all sheets
      for (const [sheetName, sheetData] of Object.entries(analysis.data)) {
        if (!Array.isArray(sheetData)) continue;
        
        const updatedSheet = sheetData.map(row => {
          if (!row || typeof row !== 'object') return row;
          if (!row.transcriptId) return row;
          
          const newRespno = transcriptIdToRespno.get(String(row.transcriptId));
          if (newRespno) {
            analysisUpdated = true;
            return {
              ...row,
              'Respondent ID': newRespno,
              respno: newRespno
            };
          }
          return row;
        });
        
        if (analysisUpdated) {
          analysis.data[sheetName] = updatedSheet;
        }
      }
      
      if (analysisUpdated) {
        updated = true;
      }
    }
    
    if (updated) {
      await fs.writeFile(CAX_PATH, JSON.stringify(analyses, null, 2));
    }
    
    return updated;
  } catch (error) {
    console.error('Error updating CA data with respnos:', error);
    throw error;
  }
}

// POST /api/transcripts/reset-respnos/:projectId - Reset all respnos for transcripts in CAs (exclude un-assigned)
router.post('/reset-respnos/:projectId', authenticateToken, async (req, res) => {
  try {
    const { projectId } = req.params;
    const transcriptsData = await fs.readFile(TRANSCRIPTS_PATH, 'utf8');
    const transcripts = JSON.parse(transcriptsData);

    if (!transcripts[projectId]) {
      return res.status(404).json({ error: 'Project not found' });
    }

    // Get all transcripts assigned to any CA for this project
    const CAX_PATH = path.join(DATA_DIR, 'savedAnalyses.json');
    const caData = await fs.readFile(CAX_PATH, 'utf8');
    const analyses = JSON.parse(caData);
    const projectAnalyses = analyses.filter(a => a.projectId === projectId);
    
    // Collect transcript IDs that are in any CA
    const transcriptsInCA = new Set();
    for (const analysis of projectAnalyses) {
      if (!analysis.data || typeof analysis.data !== 'object') continue;
      for (const sheetData of Object.values(analysis.data)) {
        if (Array.isArray(sheetData)) {
          sheetData.forEach(row => {
            if (row?.transcriptId) {
              transcriptsInCA.add(String(row.transcriptId));
            }
          });
        }
      }
    }
    
    // Filter transcripts to only those in CAs
    const transcriptsToReset = transcripts[projectId].filter(t => 
      transcriptsInCA.has(String(t.id))
    );
    
    if (transcriptsToReset.length === 0) {
      return res.json({ success: true, projectId, updated: false, message: 'No transcripts in content analyses to reset' });
    }
    
    // Sort chronologically
    const sorted = assignRespnos(transcriptsToReset);
    
    // Create map of transcriptId to new respno
    const transcriptIdToRespno = new Map();
    sorted.forEach(t => {
      if (t.id && t.respno) {
        transcriptIdToRespno.set(String(t.id), t.respno);
      }
    });
    
    // Update transcripts array with new respnos (maintaining order of all transcripts)
    const updatedTranscripts = transcripts[projectId].map(t => {
      const newRespno = transcriptIdToRespno.get(String(t.id));
      if (newRespno) {
        return { ...t, respno: newRespno };
      }
      return t;
    });
    
    transcripts[projectId] = updatedTranscripts;
    
    // Save transcripts
    await fs.writeFile(TRANSCRIPTS_PATH, JSON.stringify(transcripts, null, 2));
    
    // Update CA data with new respnos
    await updateCADataWithRespnos(projectId, transcriptIdToRespno);
    
    // Regenerate cleaned transcript files
    try {
      await regenerateCleanedTranscripts(projectId, transcripts[projectId], null);
    } catch (e) {
      console.warn('Failed to regenerate cleaned transcripts after reset:', e?.message);
    }

    res.json({ success: true, projectId, updated: true, transcriptsReset: sorted.length });
  } catch (error) {
    console.error('Error resetting respnos:', error);
    res.status(500).json({ error: 'Failed to reset respnos', message: error.message });
  }
});

// Recompute respnos for a project (utility endpoint)
router.post('/reassign/:projectId', authenticateToken, async (req, res) => {
  try {
    const { projectId } = req.params;
    const data = await fs.readFile(TRANSCRIPTS_PATH, 'utf8');
    const transcripts = JSON.parse(data);

    if (!transcripts[projectId]) {
      return res.status(404).json({ error: 'Project not found' });
    }

    const hadMissing = transcripts[projectId].some(t => !t.respno || String(t.respno).trim() === '');

    // Always reassign to ensure correct chronological order
    transcripts[projectId] = assignRespnos(transcripts[projectId]);

    // Persist and regenerate cleaned transcript files with updated respnos
    await fs.writeFile(TRANSCRIPTS_PATH, JSON.stringify(transcripts, null, 2));
    try {
      await regenerateCleanedTranscripts(projectId, transcripts[projectId], null);
    } catch (e) {
      console.warn('Failed to regenerate cleaned transcripts after reassign:', e?.message);
    }

    res.json({ success: true, projectId, updated: true, hadMissing });
  } catch (error) {
    console.error('Error reassigning respnos:', error);
    res.status(500).json({ error: 'Failed to reassign respnos' });
  }
});

// Parse date/time from transcript file
router.post('/parse-datetime', authenticateToken, upload.single('file'), async (req, res) => {
  try {
    console.log('📅 Parse datetime request received');

    if (!req.file) {
      console.log('❌ No file uploaded');
      return res.status(400).json({ error: 'No file uploaded' });
    }

    console.log('📄 File:', req.file.originalname);

    // Read the file
    let transcriptText = '';
    if (req.file.originalname.endsWith('.docx')) {
      const result = await mammoth.extractRawText({ path: req.file.path });
      transcriptText = result.value;
    } else {
      transcriptText = await fs.readFile(req.file.path, 'utf8');
    }

    console.log('📝 Transcript text length:', transcriptText.length);

    // Optional: projectId to aid name detection
    const projectId = req.body?.projectId;
    let projectModeratorName = null;
    if (projectId) {
      try {
        const projectsRaw = await fs.readFile(PROJECTS_PATH, 'utf8');
        const projectsObj = JSON.parse(projectsRaw || '{}');
        for (const userProjects of Object.values(projectsObj)) {
          if (Array.isArray(userProjects)) {
            const proj = userProjects.find(p => p.id === projectId);
            if (proj) {
              projectModeratorName = proj.moderator || proj.moderatorName || proj.leadModerator || null;
              break;
            }
          }
        }
      } catch (e) {
        console.warn('Failed to read project moderator:', e?.message);
      }
    }

    // Quick simple extraction: detect Moderator/Respondent tags or speaker labels
    let moderatorName = null;
    let respondentName = null;
    const RESERVED = new Set(['date','time','moderator','respondent','interview','session','transcript']);
    const isLikelyName = (s) => {
      if (!s) return false;
      const v = String(s).trim();
      if (!v) return false;
      if (v.length > 40) return false;
      if (/[?!@#\$%\^&*_+=\[\]{}<>]/.test(v)) return false;
      if (RESERVED.has(v.toLowerCase())) return false;
      // Disallow sentences
      if (/(thank you|appreciate|today|interview|time)/i.test(v)) return false;
      const words = v.split(/\s+/);
      if (words.length > 4) return false;
      // Each word should be alphabetical with optional ' or - and start uppercase
      const nameWord = /^[A-Z][a-zA-Z'-]*$/;
      const ok = words.every(w => nameWord.test(w));
      return ok;
    };
    const findNextLikelyName = (arr, startIdx) => {
      for (let i = startIdx + 1; i < Math.min(arr.length, startIdx + 6); i++) {
        const cand = arr[i].trim();
        if (!cand) continue;
        if (isLikelyName(cand)) return cand;
        // also accept "Name (Moderator)" pattern
        const paren = cand.match(/^([A-Z][A-Za-z'-]+(?:\s+[A-Z][A-Za-z'-]+){0,3})\s*\((?:Moderator|Respondent)\)/i);
        if (paren && isLikelyName(paren[1])) return paren[1];
      }
      return null;
    };
    let modTagFound = false;
    let respTagFound = false;
    try {
      const lines = transcriptText.split(/\r?\n/).slice(0, 200); // look only at first ~200 lines
      for (let idx = 0; idx < lines.length; idx++) {
        const line = lines[idx].trim();
        if (!line) continue;
        const modMatch = line.match(/^Moderator:\s*(.*)$/i);
        const respMatch = line.match(/^Respondent:\s*(.*)$/i);
        if (modMatch && !moderatorName) {
          modTagFound = true;
          const val = (modMatch[1] || '').trim();
          moderatorName = isLikelyName(val) ? val : findNextLikelyName(lines, idx);
        }
        if (respMatch && !respondentName) {
          respTagFound = true;
          const val = (respMatch[1] || '').trim();
          respondentName = isLikelyName(val) ? val : findNextLikelyName(lines, idx);
        }
        if (moderatorName && respondentName) break;
      }
      if (!moderatorName || !respondentName) {
        // Detect speaker label pattern like "John:" or "Jane:"; infer moderator if it matches project moderator
        const speakerLabel = lines
          .map(l => l.trim())
          .filter(l => /^[A-Za-z][A-Za-z .'-]{1,30}:/.test(l))
          .map(l => l.split(':')[0].trim());
        const unique = Array.from(new Set(speakerLabel));
        if (!moderatorName && projectModeratorName) {
          const pm = projectModeratorName.toLowerCase();
          const hit = unique.find(n => n.toLowerCase() === pm || pm.includes(n.toLowerCase()) || n.toLowerCase().includes(pm));
          if (hit) moderatorName = hit;
        }
        if (!moderatorName && unique.length && isLikelyName(unique[0])) moderatorName = unique[0];
        if (!respondentName && unique.length > 1) {
          const alt = unique.find(n => n !== moderatorName && isLikelyName(n));
          if (alt) respondentName = alt;
        }
      }
    } catch (e) {
      // ignore simple extraction errors
    }

    // Use AI to extract metadata from first page only (cost-effective)
    const firstPage = transcriptText.substring(0, 3000); // First ~3000 chars = roughly first page
    console.log('🤖 Using AI to extract metadata from first page...');

    let interviewDate = null;
    let interviewTime = null;

    try {
      if (!process.env.OPENAI_API_KEY) {
        throw new Error('OpenAI API key not configured');
      }

      const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

      const systemPrompt = `You are an expert at extracting metadata from interview transcripts. Use simple label detection first; do not read the full content. Look for explicit speaker tags such as "Moderator:" and "Respondent:" or speaker name labels like "John:".

If a project moderator is provided, prefer mapping that name to the moderator role when ambiguous.

Your task is to read the beginning of a transcript and extract:

1. Interview Date (in a clear format like "Oct 15, 2024" or "10/15/2024")
2. Interview Time (including AM/PM and timezone if available, like "3:00 PM EST")
3. Moderator Name (the actual person's name, NOT just "Moderator" - look for headers, introductions, or labels)
4. Respondent Name (the actual person's name, NOT just "Respondent" - look for headers, introductions, or labels)

IMPORTANT INSTRUCTIONS:
- Prefer explicit tags: lines starting with "Moderator:" or "Respondent:" and capture text after the colon.
- If tags are not present, look for speaker labels like "John:" and "Jane:"; infer moderator using the provided project moderator when present.
- Ignore single-letter speaker labels (e.g., "M:", "R:") as names.
- If a proper name cannot be found, return the generic tag ("Moderator" / "Respondent") rather than a wrong guess.
- If you cannot find an actual name, return null for that field.

Return your response as a JSON object with these exact keys:
{
  "date": "string or null",
  "time": "string or null",
  "moderatorName": "string or null",
  "respondentName": "string or null"
}

Return ONLY the JSON object, no additional text.`;

      const response = await client.chat.completions.create({
        model: 'gpt-4o',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: `Project Moderator (if known): ${projectModeratorName || 'null'}\nExisting simple extraction: moderator=${moderatorName || 'null'}, respondent=${respondentName || 'null'}\n\nExtract the metadata from this transcript:\n\n${firstPage}` }
        ],
        temperature: 0.1,
        response_format: { type: 'json_object' }
      });

      if (!response.choices || !response.choices[0] || !response.choices[0].message || !response.choices[0].message.content) {
        throw new Error('OpenAI API returned invalid response');
      }

      const extracted = JSON.parse(response.choices[0].message.content);
      interviewDate = extracted.date || null;
      interviewTime = extracted.time || null;
      // Merge with simple extraction but validate AI outputs
      const aiMod = extracted.moderatorName || null;
      const aiResp = extracted.respondentName || null;
      if (!moderatorName && isLikelyName(aiMod)) moderatorName = aiMod;
      if (!respondentName && isLikelyName(aiResp)) respondentName = aiResp;

      // Final sanity: avoid identical or reserved outputs
      if (moderatorName && RESERVED.has(moderatorName.toLowerCase())) moderatorName = null;
      if (respondentName && RESERVED.has(respondentName.toLowerCase())) respondentName = null;
      if (moderatorName && respondentName && moderatorName.toLowerCase() === respondentName.toLowerCase()) {
        // If both same, prefer project moderator assignment if available
        if (projectModeratorName && moderatorName.toLowerCase() !== projectModeratorName.toLowerCase()) {
          // assign moderator to project moderator if it passes name check
          if (isLikelyName(projectModeratorName)) moderatorName = projectModeratorName;
          else moderatorName = null;
        } else {
          respondentName = null;
        }
      }

      // If still missing and tags were present, fall back to generic labels
      if (!moderatorName && modTagFound) moderatorName = 'Moderator';
      if (!respondentName && respTagFound) respondentName = 'Respondent';

      console.log('✅ AI extraction successful:', { interviewDate, interviewTime, moderatorName, respondentName });

      // Log cost for metadata extraction
      try {
        const inputTokens = response.usage?.prompt_tokens || 0;
        const outputTokens = response.usage?.completion_tokens || 0;
        if (inputTokens > 0 && outputTokens > 0) {
          await logCost(
            'metadata-extraction',
            COST_CATEGORIES.TRANSCRIPT_CLEANING, // Reuse category
            'gpt-4o-mini',
            inputTokens,
            outputTokens,
            'Transcript metadata extraction'
          );
        }
      } catch (e) {
        console.warn('Failed to log metadata extraction cost:', e.message);
      }
    } catch (aiError) {
      console.error('❌ AI extraction failed, falling back to regex:', aiError.message);

      // Fallback to original regex-based parsing for date/time only
      const parsed = parseDateTimeFromTranscript(transcriptText);
      interviewDate = parsed.interviewDate;
      interviewTime = parsed.interviewTime;
      // Don't attempt name extraction with regex - better to return null than wrong data
      moderatorName = null;
      respondentName = null;
    }

    console.log('👤 Final parsed moderator:', moderatorName);
    console.log('👤 Final parsed respondent:', respondentName);

    // Clean up uploaded file
    try {
      await fs.unlink(req.file.path);
    } catch (e) {
      console.warn('Failed to clean up file:', e);
    }

    const response = { date: interviewDate, time: interviewTime, moderatorName, respondentName };
    console.log('✅ Sending response:', response);

    return res.json(response);
  } catch (error) {
    console.error('❌ Error parsing date/time:', error);
    // Clean up file if it exists
    if (req.file) {
      try {
        await fs.unlink(req.file.path);
      } catch (e) {
        console.warn('Failed to clean up file:', e);
      }
    }
    return res.status(500).json({ error: 'Failed to parse date/time from transcript' });
  }
});

// PUT transcript date/time
router.put('/:projectId/:transcriptId/datetime', authenticateToken, async (req, res) => {
  try {
    const { projectId, transcriptId } = req.params;
    const { field, value } = req.body;

    if (!field || !value) {
      return res.status(400).json({ error: 'Field and value are required' });
    }

    if (field !== 'date' && field !== 'time') {
      return res.status(400).json({ error: 'Field must be "date" or "time"' });
    }

    const data = await fs.readFile(TRANSCRIPTS_PATH, 'utf8');
    const transcripts = JSON.parse(data);

    if (!transcripts[projectId]) {
      return res.status(404).json({ error: 'Project not found' });
    }

    const transcriptIndex = transcripts[projectId].findIndex(t => t.id === transcriptId);
    if (transcriptIndex === -1) {
      return res.status(404).json({ error: 'Transcript not found' });
    }

    // Update the transcript
    if (field === 'date') {
      // Convert short date format (MM/DD/YY) to standard format for storage
      const shortDateRegex = /^\d{1,2}\/\d{1,2}\/\d{2}$/;
      if (shortDateRegex.test(value)) {
        const [month, day, year] = value.split('/').map(Number);
        const fullYear = year < 50 ? 2000 + year : 1900 + year;
        // Format as YYYY-MM-DD directly to avoid timezone issues
        const formattedDate = `${fullYear}-${month.toString().padStart(2, '0')}-${day.toString().padStart(2, '0')}`;
        transcripts[projectId][transcriptIndex].interviewDate = formattedDate;
      } else {
        transcripts[projectId][transcriptIndex].interviewDate = value;
      }
    } else if (field === 'time') {
      // Validate and standardize time format
      const timeRegex = /^\d{1,2}:\d{2}\s*(AM|PM)$/i;
      if (timeRegex.test(value)) {
        // Convert to uppercase for consistency
        transcripts[projectId][transcriptIndex].interviewTime = value.toUpperCase();
      } else {
        // Try to parse and convert to standard format
        try {
          const time = new Date(`2000-01-01 ${value}`);
          if (!isNaN(time.getTime())) {
            const hours = time.getHours();
            const minutes = time.getMinutes();
            const ampm = hours >= 12 ? 'PM' : 'AM';
            const displayHours = hours % 12 || 12;
            const displayMinutes = minutes.toString().padStart(2, '0');
            transcripts[projectId][transcriptIndex].interviewTime = `${displayHours}:${displayMinutes} ${ampm}`;
          } else {
            transcripts[projectId][transcriptIndex].interviewTime = value;
          }
        } catch (error) {
          transcripts[projectId][transcriptIndex].interviewTime = value;
        }
      }
    }

    // Do not reassign respnos on date/time edits; preserve CA-assigned respnos
    // Optionally regenerate cleaned transcripts for this project without changing respnos
    await regenerateCleanedTranscripts(projectId, transcripts[projectId], null);

    await fs.writeFile(TRANSCRIPTS_PATH, JSON.stringify(transcripts, null, 2));

    res.json({ success: true });
  } catch (error) {
    console.error('Error updating transcript date/time:', error);
    res.status(500).json({ error: 'Failed to update transcript date/time' });
  }
});

export default router;

