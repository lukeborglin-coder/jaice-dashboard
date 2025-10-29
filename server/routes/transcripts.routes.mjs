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

    // Respno will be assigned AFTER we add the transcript and sort by date
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

        // Save cleaned filename and path (will regenerate with correct respno later)
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

    // Add transcript with temp respno
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
      console.log('💾 Saving cleaned transcript to file...');
      console.log('📁 Cleaned path:', cleanedPath);
      console.log('📄 Cleaned text length:', cleanedText.length);
      
      try {
        const wordBuffer = await createFormattedWordDoc(
          cleanedText,
          projectName,
          finalTranscript.respno,
          interviewDate,
          interviewTime
        );

        await fs.writeFile(cleanedPath, wordBuffer);
        finalTranscript.cleanedSize = wordBuffer.length;
        console.log('✅ Cleaned transcript saved successfully');
        console.log('📊 File size:', wordBuffer.length, 'bytes');
      } catch (saveError) {
        console.error('❌ Error saving cleaned transcript file:', saveError);
        console.error('Error details:', saveError.message);
        // Don't fail the upload if file save fails, but mark as not cleaned
        finalTranscript.isCleaned = false;
        finalTranscript.cleanedPath = null;
        finalTranscript.cleanedFilename = null;
      }
    } else if (cleanTranscript === 'true' && !cleanedText) {
      console.warn('⚠️ Cleaning was requested but no cleaned text was generated');
      finalTranscript.isCleaned = false;
    }

    // Save the final transcripts array with correct respnos
    await fs.writeFile(TRANSCRIPTS_PATH, JSON.stringify(transcripts, null, 2));

    // CRITICAL: Update content analysis data to reflect new respno assignments
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

          // Sort demographics by the new respno order
          updatedDemographics.sort((a, b) => {
            const respnoA = a['Respondent ID'] || a['respno'];
            const respnoB = b['Respondent ID'] || b['respno'];

            // Extract numeric part for comparison (e.g., R01 -> 1)
            const numA = parseInt(String(respnoA).replace('R', ''), 10);
            const numB = parseInt(String(respnoB).replace('R', ''), 10);

            return numA - numB;
          });

          // Update the analysis data
          analysis.data.Demographics = updatedDemographics;

          // Update other sheets to match Demographics respnos and transcriptIds
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

      // analyses is an array, so find all analyses for this project
      const projectAnalyses = analyses.filter(a => a.projectId === projectId);

      for (const analysis of projectAnalyses) {
        console.log(`Processing analysis ${analysis.id} for deleted transcript ${deletedRespno}`);

        // Remove rows matching the deleted respno from all sheets
        if (analysis.data) {
          for (const sheetName of Object.keys(analysis.data)) {
            if (Array.isArray(analysis.data[sheetName])) {
              const beforeLength = analysis.data[sheetName].length;
              const filteredRows = analysis.data[sheetName].filter(row => {
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

        // Re-sort Demographics by date and reassign all respnos chronologically to match transcripts
        if (analysis.data && analysis.data.Demographics) {
          const demographics = analysis.data.Demographics;

          // Sort by interview date and time
          demographics.sort((a, b) => {
            const dateA = a['Interview Date'] || '';
            const timeA = a['Interview Time'] || '';
            const dateB = b['Interview Date'] || '';
            const timeB = b['Interview Time'] || '';

            if (dateA && dateB) {
              const parsedA = new Date(dateA + ' ' + timeA);
              const parsedB = new Date(dateB + ' ' + timeB);
              if (!isNaN(parsedA.getTime()) && !isNaN(parsedB.getTime())) {
                return parsedA.getTime() - parsedB.getTime();
              }
            }
            return 0;
          });

          // CRITICAL: Get current transcript order from transcripts.json to match transcriptIds
          try {
            console.log('🔍 Starting transcriptId update process...');
            const transcriptsData = await fs.readFile(TRANSCRIPTS_PATH, 'utf8');
            const allTranscripts = JSON.parse(transcriptsData);
            const projectTranscripts = allTranscripts[projectId] || [];
            
            console.log('🔍 Project transcripts found:', projectTranscripts.length);
            console.log('🔍 Project transcripts:', projectTranscripts.map(t => ({ id: t.id, respno: t.respno })));
            
            // Create mapping of respno to transcriptId from current transcript order
            const respnoToTranscriptId = new Map();
            projectTranscripts.forEach((transcript, index) => {
              const respno = `R${String(index + 1).padStart(2, '0')}`;
              respnoToTranscriptId.set(respno, transcript.id);
            });
            
            console.log('🔍 Transcript deletion - respno to transcriptId mapping:', Array.from(respnoToTranscriptId.entries()));

            // Reassign respnos and transcriptIds sequentially to match the transcript order
            demographics.forEach((row, index) => {
              const newRespno = `R${String(index + 1).padStart(2, '0')}`;
              const newTranscriptId = respnoToTranscriptId.get(newRespno);
              
              console.log(`🔍 Updating row ${index}: old transcriptId=${row.transcriptId}, new transcriptId=${newTranscriptId}`);
              
              if ('Respondent ID' in row) row['Respondent ID'] = newRespno;
              if ('respno' in row) row['respno'] = newRespno;
              if (newTranscriptId) row['transcriptId'] = newTranscriptId;
            });
            
            console.log('🔍 Updated demographics after transcriptId assignment:', demographics.map(r => ({ 
              transcriptId: r.transcriptId, 
              respno: r['Respondent ID'] || r.respno 
            })));
          } catch (error) {
            console.error('❌ Error updating transcriptIds during deletion:', error);
          }

          // Update other sheets to match Demographics respnos and transcriptIds
          const sheetNames = Object.keys(analysis.data).filter(name => name !== 'Demographics');
          console.log('🔍 Sheet names to update:', sheetNames);
          console.log('🔍 Demographics length:', demographics.length);
          
          for (const sheetName of sheetNames) {
            const rows = analysis.data[sheetName];
            console.log(`🔍 Processing sheet ${sheetName}:`, Array.isArray(rows) ? `Array with ${rows.length} rows` : 'Not an array');
            
            if (Array.isArray(rows) && rows.length > 0) {
              // If demographics is empty, we need to clear all other sheets too
              if (demographics.length === 0) {
                console.log(`🔍 Clearing ${sheetName} sheet because demographics is empty`);
                analysis.data[sheetName] = [];
              } else {
                // Update existing rows to match demographics
                rows.forEach((row, index) => {
                  console.log(`🔍 Sheet ${sheetName} row ${index}: current respno=${row['Respondent ID'] || row.respno}`);
                  
                  if (index < demographics.length) {
                    const newRespno = demographics[index]['Respondent ID'] || demographics[index]['respno'];
                    const newTranscriptId = demographics[index]['transcriptId'];
                    
                    console.log(`🔍 Updating ${sheetName} row ${index}: old respno=${row['Respondent ID'] || row.respno}, new respno=${newRespno}, newTranscriptId=${newTranscriptId}`);
                    
                    if ('Respondent ID' in row) row['Respondent ID'] = newRespno;
                    if ('respno' in row) row['respno'] = newRespno;
                    if (newTranscriptId) row['transcriptId'] = newTranscriptId;
                    
                    console.log(`🔍 Updated ${sheetName} row ${index}: new respno=${row['Respondent ID'] || row.respno}`);
                  } else {
                    console.log(`🔍 Skipping ${sheetName} row ${index}: index ${index} >= demographics.length ${demographics.length}`);
                  }
                });
              }
            }
          }

          console.log(`  Updated respnos and transcriptIds in CA to match new transcript order`);
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

    // Parse date and time
    const { interviewDate, interviewTime } = parseDateTimeFromTranscript(transcriptText);

    console.log('📅 Parsed date:', interviewDate);
    console.log('🕐 Parsed time:', interviewTime);

    // Clean up uploaded file
    try {
      await fs.unlink(req.file.path);
    } catch (e) {
      console.warn('Failed to clean up file:', e);
    }

    const response = { date: interviewDate, time: interviewTime };
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

    // Reassign respnos based on chronological order after update
    // This function returns the sorted array, so we need to use it
    const sortedTranscripts = assignRespnos(transcripts[projectId]);
    transcripts[projectId] = sortedTranscripts;

    await fs.writeFile(TRANSCRIPTS_PATH, JSON.stringify(transcripts, null, 2));

    res.json({ success: true });
  } catch (error) {
    console.error('Error updating transcript date/time:', error);
    res.status(500).json({ error: 'Failed to update transcript date/time' });
  }
});

export default router;

