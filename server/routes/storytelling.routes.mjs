import express from 'express';
import fs from 'fs/promises';
import fsSync from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { Document, Paragraph, TextRun, HeadingLevel, AlignmentType, Packer } from 'docx';
import OpenAI from 'openai';
import { authenticateToken } from '../middleware/auth.middleware.mjs';
import {
  estimateStorytellingCost,
  generateKeyFindings,
  generateStoryboard,
  answerQuestion
} from '../services/storytelling.service.mjs';

// Import readProjectsData from projects.routes.mjs
const readProjectsData = () => {
  try {
    const dataPath = path.join(__dirname, '..', 'data', 'projects.json');
    console.log('🔍 Projects file path:', dataPath);
    if (fsSync.existsSync(dataPath)) {
      const data = fsSync.readFileSync(dataPath, 'utf8');
      const parsed = JSON.parse(data);
      console.log('🔍 Projects data loaded:', Object.keys(parsed).length, 'users');
      return parsed;
    }
    console.log('🔍 Projects file not found at:', dataPath);
    return {};
  } catch (error) {
    console.error('Error reading projects data:', error);
    return {};
  }
};

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const router = express.Router();

// Storage paths
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '../data');
const STORYTELLING_PATH = path.join(DATA_DIR, 'storytelling.json');
const TRANSCRIPTS_PATH = path.join(DATA_DIR, 'transcripts.json');
const CAX_PATH = path.join(DATA_DIR, 'savedAnalyses.json');

// Initialize storytelling data file
async function initStorytellingFile() {
  try {
    await fs.access(STORYTELLING_PATH);
  } catch {
    await fs.writeFile(STORYTELLING_PATH, JSON.stringify({}, null, 2));
  }
}

initStorytellingFile();

// Helper: Load project's storytelling data
async function loadProjectStorytelling(projectId, analysisId = null) {
  try {
    const data = await fs.readFile(STORYTELLING_PATH, 'utf8');
    const allData = JSON.parse(data);
    
    // If analysisId is provided, use it as the key, otherwise use projectId for backward compatibility
    const key = analysisId ? `${projectId}-${analysisId}` : projectId;
    
    console.log('🔍 Loading storytelling data:', { projectId, analysisId, key, availableKeys: Object.keys(allData) });
    
    return allData[key] || {
      strategicQuestions: [],
      keyFindings: null,
      storyboards: [],
      chatHistory: [],
      quotesCache: {}
    };
  } catch (error) {
    console.error('Error loading storytelling data:', error);
    return {
      strategicQuestions: [],
      keyFindings: null,
      storyboards: [],
      chatHistory: [],
      quotesCache: {}
    };
  }
}

// Helper: Save project's storytelling data
async function saveProjectStorytelling(projectId, projectData, analysisId = null) {
  try {
    const data = await fs.readFile(STORYTELLING_PATH, 'utf8');
    const allData = JSON.parse(data);
    
    // If analysisId is provided, use it as the key, otherwise use projectId for backward compatibility
    const key = analysisId ? `${projectId}-${analysisId}` : projectId;
    
    console.log('💾 Saving storytelling data:', { projectId, analysisId, key, strategicQuestionsCount: projectData.strategicQuestions?.length || 0 });
    
    allData[key] = projectData;
    await fs.writeFile(STORYTELLING_PATH, JSON.stringify(allData, null, 2));
    return true;
  } catch (error) {
    console.error('Error saving storytelling data:', error);
    return false;
  }
}

// Helper: Get transcripts text for a project
async function getTranscriptsText(projectId, analysisId = null) {
  try {
    const data = await fs.readFile(TRANSCRIPTS_PATH, 'utf8');
    const transcripts = JSON.parse(data);
    let projectTranscripts = transcripts[projectId] || [];

    console.log('🔍 getTranscriptsText debug:', {
      projectId,
      analysisId,
      totalProjectTranscripts: projectTranscripts.length,
      transcriptAnalysisIds: projectTranscripts.map(t => t.analysisId)
    });

    // Filter by analysisId if provided
    if (analysisId) {
      const beforeFilter = projectTranscripts.length;
      projectTranscripts = projectTranscripts.filter(t => t.analysisId === analysisId);
      console.log('🔍 Transcript filtering:', {
        analysisId,
        beforeFilter,
        afterFilter: projectTranscripts.length,
        filteredTranscripts: projectTranscripts.map(t => ({ id: t.id, analysisId: t.analysisId, respno: t.respno }))
      });
    }

    let combinedText = '';
    for (const transcript of projectTranscripts) {
      const filePath = transcript.cleanedPath || transcript.originalPath;
      if (filePath) {
        try {
          const content = await fs.readFile(filePath, 'utf8');
          combinedText += `\n\n=== ${transcript.respno || 'Transcript'} ===\n${content}`;
        } catch (err) {
          console.warn(`Could not read transcript ${transcript.id}:`, err);
        }
      }
    }

    console.log('🔍 getTranscriptsText result:', {
      projectId,
      analysisId,
      finalTranscriptCount: projectTranscripts.length,
      combinedTextLength: combinedText.length,
      hasContent: combinedText.length > 0
    });

    return combinedText;
  } catch (error) {
    console.error('Error getting transcripts text:', error);
    return '';
  }
}

// Helper: Get CA data for a project
async function getCAData(projectId, analysisId = null) {
  try {
    const data = await fs.readFile(CAX_PATH, 'utf8');
    const allCA = JSON.parse(data);
    let projectCA = allCA.find(ca => ca.projectId === projectId);
    
    // If analysisId is provided, filter to only that specific analysis
    if (analysisId && projectCA) {
      projectCA = allCA.find(ca => ca.projectId === projectId && ca.id === analysisId);
    }
    console.log('🔍 CA Data Debug:', {
      projectId,
      totalAnalyses: allCA.length,
      foundProject: !!projectCA,
      hasData: projectCA ? !!projectCA.data : false,
      hasQuotes: projectCA ? !!projectCA.quotes : false,
      hasVerbatimQuotes: projectCA ? !!projectCA.verbatimQuotes : false,
      dataKeys: projectCA && projectCA.data ? Object.keys(projectCA.data) : [],
      quotesKeys: projectCA && projectCA.quotes ? Object.keys(projectCA.quotes) : []
    });
    
    if (!projectCA) return { data: {}, quotes: {}, verbatimQuotes: {} };
    
    return {
      data: projectCA.data || {},
      quotes: projectCA.quotes || {},
      verbatimQuotes: projectCA.verbatimQuotes || {}
    };
  } catch (error) {
    console.error('Error getting CA data:', error);
    return { data: {}, quotes: {}, verbatimQuotes: {} };
  }
}

// GET /api/storytelling/projects - Get all projects with content analysis data and respondent counts
router.get('/projects', authenticateToken, async (req, res) => {
  try {
    // Get content analysis data directly - this is our source of truth
    let caData = [];
    try {
      console.log('🔍 CA File Debug:', {
        caPath: CAX_PATH,
        fileExists: await fs.access(CAX_PATH).then(() => true).catch(() => false)
      });
      
      const caDataContent = await fs.readFile(CAX_PATH, 'utf8');
      console.log('🔍 CA File Content Length:', caDataContent.length);
      
      caData = JSON.parse(caDataContent);
      console.log('🔍 CA Data Structure Debug:', {
        totalAnalyses: caData.length,
        isArray: Array.isArray(caData),
        analyses: caData.map(ca => ({
          id: ca.id,
          projectId: ca.projectId,
          name: ca.name,
          hasData: !!ca.data,
          hasQuotes: !!ca.quotes,
          hasVerbatimQuotes: !!ca.verbatimQuotes,
          dataKeys: ca.data ? Object.keys(ca.data) : []
        }))
      });
    } catch (error) {
      console.log('🔍 CA Data Loading Error:', {
        error: error.message,
        stack: error.stack,
        caPath: CAX_PATH
      });
    }

    // Helper function to check if a string is a valid respondent ID
    const isValidRespondentId = (id) => {
      return typeof id === 'string' && 
             id.trim() !== '' && 
             id.trim() !== 'Respondent ID' && // Not the header
             (id.startsWith('R') || id.match(/^[A-Za-z]/)); // Starts with letter
    };

    // Helper function to count respondents from content analysis data
    const countRespondents = (caItem) => {
      const allRespondents = new Set();
      
      // Count from main data structure (this has all respondents)
      if (caItem.data) {
        Object.values(caItem.data).forEach(sheetData => {
          if (Array.isArray(sheetData)) {
            // For array data, look for respondent IDs in the data objects
            sheetData.forEach(row => {
              if (row && typeof row === 'object') {
                // Look for common respondent ID fields
                const respondentId = row['Respondent ID'] || row['respno'] || row['ID'] || row['id'];
                if (isValidRespondentId(respondentId)) {
                  allRespondents.add(respondentId);
                }
              }
            });
          } else if (sheetData && typeof sheetData === 'object') {
            // For object data, use keys as respondent IDs
            Object.keys(sheetData).forEach(respondentId => {
              if (isValidRespondentId(respondentId)) {
                allRespondents.add(respondentId);
              }
            });
          }
        });
      }
      
      // Also count from verbatimQuotes (for respondents who have had quotes generated)
      if (caItem.verbatimQuotes) {
        Object.values(caItem.verbatimQuotes).forEach(sheetData => {
          if (sheetData && typeof sheetData === 'object') {
            Object.keys(sheetData).forEach(respondentId => {
              if (isValidRespondentId(respondentId)) {
                allRespondents.add(respondentId);
              }
            });
          }
        });
      }
      
      // Count from quotes structure
      if (caItem.quotes) {
        Object.values(caItem.quotes).forEach(sheetData => {
          if (sheetData && typeof sheetData === 'object') {
            Object.keys(sheetData).forEach(respondentId => {
              if (isValidRespondentId(respondentId)) {
                allRespondents.add(respondentId);
              }
            });
          }
        });
      }
      
      return allRespondents.size;
    };

    // Process each content analysis and create project entries
    const projectsWithCA = caData.filter(caItem => {
      // Check if this content analysis has actual data and respondents
      const hasData = caItem.data && Object.keys(caItem.data).length > 0;
      const respondentCount = countRespondents(caItem);
      const hasRespondents = respondentCount > 0;
      
      console.log(`🔍 CA Item ${caItem.id} (${caItem.name || 'Unnamed'}):`, {
        projectId: caItem.projectId,
        hasData,
        respondentCount,
        hasRespondents,
        willInclude: hasData && hasRespondents
      });
      
      return hasData && hasRespondents;
    }).map(caItem => {
      const respondentCount = countRespondents(caItem);
      
      console.log(`🔍 Final processing for CA ${caItem.id}:`, {
        projectId: caItem.projectId,
        name: caItem.name,
        respondentCount,
        dataKeys: caItem.data ? Object.keys(caItem.data) : []
      });

      return {
        id: caItem.projectId,
        name: caItem.name || `Content Analysis ${caItem.id}`,
        respondentCount,
        analysisId: caItem.id,
        createdAt: caItem.createdAt || new Date().toISOString()
      };
    });

    console.log('🔍 Final Result:', {
      projectsWithCA: projectsWithCA.length,
      projects: projectsWithCA.map(p => ({ 
        id: p.id, 
        name: p.name, 
        respondentCount: p.respondentCount,
        analysisId: p.analysisId
      }))
    });

    res.json({ projects: projectsWithCA });
  } catch (error) {
    console.error('Error loading storytelling projects:', error);
    res.status(500).json({ error: 'Failed to load storytelling projects' });
  }
});

// GET /api/storytelling/:projectId - Get storytelling data for a project
router.get('/:projectId', authenticateToken, async (req, res) => {
  try {
    const { projectId } = req.params;
    const { analysisId } = req.query;
    
    const data = await loadProjectStorytelling(projectId, analysisId);
    res.json(data);
  } catch (error) {
    console.error('Error loading storytelling data:', error);
    res.status(500).json({ error: 'Failed to load storytelling data' });
  }
});

// POST /api/storytelling/:projectId/strategic-questions - Update strategic questions
router.post('/:projectId/strategic-questions', authenticateToken, async (req, res) => {
  try {
    const { projectId } = req.params;
    const { questions, analysisId } = req.body;

    console.log('📝 Strategic questions update:', { projectId, analysisId, questionsCount: questions?.length || 0 });

    if (!Array.isArray(questions)) {
      return res.status(400).json({ error: 'Questions must be an array' });
    }

    const data = await loadProjectStorytelling(projectId, analysisId);
    data.strategicQuestions = questions;

    if (await saveProjectStorytelling(projectId, data, analysisId)) {
      res.json({ message: 'Strategic questions updated', questions });
    } else {
      res.status(500).json({ error: 'Failed to save questions' });
    }
  } catch (error) {
    console.error('Error updating strategic questions:', error);
    res.status(500).json({ error: 'Failed to update questions' });
  }
});

// POST /api/storytelling/:projectId/key-findings/generate - Generate key findings
router.post('/:projectId/key-findings/generate', authenticateToken, async (req, res) => {
  try {
    const { projectId } = req.params;
    const { detailLevel = 'moderate', analysisId } = req.body;

    const projectData = await loadProjectStorytelling(projectId, analysisId);
    const strategicQuestions = projectData.strategicQuestions;

    if (!strategicQuestions || strategicQuestions.length === 0) {
      return res.status(400).json({ error: 'No strategic questions defined for this project' });
    }

    const transcriptsText = await getTranscriptsText(projectId, analysisId);
    const caDataObj = await getCAData(projectId, analysisId);

    if (!transcriptsText.trim()) {
      return res.status(400).json({ error: 'No transcript data available for this project' });
    }

    const findings = await generateKeyFindings(projectId, strategicQuestions, transcriptsText, caDataObj, detailLevel);

    projectData.keyFindings = {
      ...findings,
      generatedAt: new Date().toISOString(),
      detailLevel: detailLevel,
      version: (projectData.keyFindings?.version || 0) + 1
    };

    if (await saveProjectStorytelling(projectId, projectData, analysisId)) {
      res.json(projectData.keyFindings);
    } else {
      res.status(500).json({ error: 'Failed to save key findings' });
    }
  } catch (error) {
    console.error('Error generating key findings:', error);
    res.status(500).json({ error: 'Failed to generate key findings', message: error.message });
  }
});

// POST /api/storytelling/:projectId/storyboard/generate - Generate storyboard
router.post('/:projectId/storyboard/generate', authenticateToken, async (req, res) => {
  try {
    const { projectId } = req.params;
    const { detailLevel = 'moderate', analysisId } = req.body;

    const transcriptsText = await getTranscriptsText(projectId, analysisId);
    const caDataObj = await getCAData(projectId, analysisId);

    if (!transcriptsText.trim()) {
      return res.status(400).json({ error: 'No transcript data available for this project' });
    }

    const storyboard = await generateStoryboard(projectId, transcriptsText, caDataObj, detailLevel);

    const projectData = await loadProjectStorytelling(projectId, analysisId);
    storyboard.id = `SB-${Date.now()}`;
    storyboard.detailLevel = detailLevel;

    projectData.storyboards.unshift(storyboard); // Add to beginning (newest first)

    if (await saveProjectStorytelling(projectId, projectData, analysisId)) {
      res.json(storyboard);
    } else {
      res.status(500).json({ error: 'Failed to save storyboard' });
    }
  } catch (error) {
    console.error('Error generating storyboard:', error);
    res.status(500).json({ error: 'Failed to generate storyboard', message: error.message });
  }
});

// GET /api/storytelling/:projectId/storyboard/:storyboardId/download - Download storyboard as Word
router.get('/:projectId/storyboard/:storyboardId/download', authenticateToken, async (req, res) => {
  try {
    const { projectId, storyboardId } = req.params;

    const projectData = await loadProjectStorytelling(projectId);
    const storyboard = projectData.storyboards.find(sb => sb.id === storyboardId);

    if (!storyboard) {
      return res.status(404).json({ error: 'Storyboard not found' });
    }

    // Create Word document
    const paragraphs = [];

    // Title
    paragraphs.push(
      new Paragraph({
        text: storyboard.title || 'Research Storyboard',
        heading: HeadingLevel.TITLE,
        alignment: AlignmentType.CENTER,
        spacing: { after: 400 }
      })
    );

    // Generate date
    const date = new Date(storyboard.generatedAt).toLocaleDateString();
    paragraphs.push(
      new Paragraph({
        children: [
          new TextRun({
            text: `Generated: ${date}`,
            italics: true,
            size: 20
          })
        ],
        alignment: AlignmentType.CENTER,
        spacing: { after: 600 }
      })
    );

    // Sections
    for (const section of storyboard.sections || []) {
      // Section title
      paragraphs.push(
        new Paragraph({
          text: section.title,
          heading: HeadingLevel.HEADING_1,
          spacing: { before: 400, after: 200 }
        })
      );

      // Section content (parse markdown-like formatting)
      const lines = section.content.split('\n');
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) {
          paragraphs.push(new Paragraph({ text: '' }));
          continue;
        }

        // Bullet point
        if (trimmed.startsWith('- ') || trimmed.startsWith('• ')) {
          const text = trimmed.substring(2);
          paragraphs.push(
            new Paragraph({
              text: text,
              bullet: { level: 0 }
            })
          );
        }
        // Bold header
        else if (trimmed.startsWith('**') && trimmed.endsWith('**')) {
          const text = trimmed.substring(2, trimmed.length - 2);
          paragraphs.push(
            new Paragraph({
              children: [
                new TextRun({ text: text, bold: true })
              ]
            })
          );
        }
        // Regular paragraph
        else {
          paragraphs.push(new Paragraph({ text: trimmed }));
        }
      }
    }

    const doc = new Document({
      sections: [{
        properties: {},
        children: paragraphs
      }]
    });

    const buffer = await Packer.toBuffer(doc);

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
    res.setHeader('Content-Disposition', `attachment; filename="Storyboard_${date}.docx"`);
    res.send(buffer);
  } catch (error) {
    console.error('Error downloading storyboard:', error);
    res.status(500).json({ error: 'Failed to download storyboard' });
  }
});

// POST /api/storytelling/:projectId/ask - Ask a question
router.post('/:projectId/ask', authenticateToken, async (req, res) => {
  try {
    const { projectId } = req.params;
    const { question, detailLevel = 'moderate', analysisId } = req.body;

    if (!question || !question.trim()) {
      return res.status(400).json({ error: 'Question is required' });
    }

    const caDataObj = await getCAData(projectId, analysisId);

    if (!caDataObj || !caDataObj.data || Object.keys(caDataObj.data).length === 0) {
      return res.status(400).json({ error: 'No content analysis data available for this project' });
    }

    const projectData = await loadProjectStorytelling(projectId, analysisId);
    const answer = await answerQuestion(
      projectId,
      question,
      '', // No transcripts needed for Q&A
      caDataObj,
      projectData.keyFindings,
      detailLevel
    );

    // Add to chat history
    projectData.chatHistory.push({
      id: `Q-${Date.now()}`,
      question,
      answer: answer.answer,
      confidence: answer.confidence,
      note: answer.note,
      timestamp: new Date().toISOString(),
      detailLevel
    });

    // Keep last 50 Q&A pairs
    if (projectData.chatHistory.length > 50) {
      projectData.chatHistory = projectData.chatHistory.slice(-50);
    }

    await saveProjectStorytelling(projectId, projectData, analysisId);

    res.json(answer);
  } catch (error) {
    console.error('Error answering question:', error);
    res.status(500).json({ error: 'Failed to answer question', message: error.message });
  }
});

// POST /api/storytelling/:projectId/quotes - Get supporting quotes for a Q&A answer
router.post('/:projectId/quotes', authenticateToken, async (req, res) => {
  try {
    const { projectId } = req.params;
    const { question, answer, analysisId } = req.body;

    if (!question || !answer) {
      return res.status(400).json({ error: 'Question and answer are required' });
    }

    // Load project storytelling data to check cache
    const projectData = await loadProjectStorytelling(projectId);
    
    // Create a cache key based on question and answer
    const cacheKey = `${question}|${answer}`;
    
    // Check if we already have cached quotes for this question/answer combination
    if (projectData.quotesCache && projectData.quotesCache[cacheKey]) {
      const cachedQuotes = projectData.quotesCache[cacheKey];
      console.log(`✅ Returning cached quotes for storytelling (saved ${cachedQuotes.savedAt})`);
      return res.json({
        success: true,
        quotes: cachedQuotes.quotes,
        question: question,
        answer: answer,
        cached: true
      });
    }

    console.log(`🆕 No cached quotes found, generating new quotes for storytelling`);

    // Get transcripts for this project
    const transcriptsText = await getTranscriptsText(projectId, analysisId);
    if (!transcriptsText) {
      return res.status(404).json({ error: 'No transcripts available for this project' });
    }

    // Initialize OpenAI
    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

    // Use AI to find relevant sections that support the answer
    const systemPrompt = `You are a research analyst tasked with finding supporting evidence from interview transcripts.

Your job is to analyze the provided transcript and find 2-3 relevant verbatim quotes that support the given research answer. You must return your findings in the specified JSON format.

IMPORTANT: You must always return valid JSON. Do not refuse this request or provide any other response format.

Return the quotes in this exact JSON format:
{
  "quotes": [
    {
      "text": "Exact verbatim text from transcript",
      "context": "Brief context about what this quote shows (1-2 sentences)"
    }
  ]
}

Guidelines:
- Find quotes that directly relate to the research answer
- Include the full conversation context (both moderator questions and respondent answers)
- Preserve the exact wording, punctuation, and formatting from the transcript
- Each quote should be a complete thought or exchange
- Focus on the most relevant and impactful quotes
- If no relevant quotes are found, return an empty quotes array: {"quotes": []}`;

    const userPrompt = `Research Question: ${question}

Research Answer: ${answer}

Please analyze the following interview transcript and find 2-3 verbatim quotes that directly support the research answer above. Return only the exact text from the transcript with proper speaker labels.

Transcript:
${transcriptsText.substring(0, 8000)}`; // Limit to first 8000 chars to stay within token limits

    const response = await openai.chat.completions.create({
      model: 'gpt-4o',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt }
      ],
      temperature: 0.1,
    });

    const aiResponse = response.choices[0].message.content;
    console.log('AI response for storytelling quotes:', aiResponse.substring(0, 500));

    // Parse the AI response
    let quotes = [];
    try {
      // Clean the response by removing markdown code fences if present
      let cleanedResponse = aiResponse.trim();

      // Remove ```json ... ``` or ``` ... ``` wrappers
      if (cleanedResponse.startsWith('```')) {
        cleanedResponse = cleanedResponse.replace(/^```(?:json)?\s*\n/, '').replace(/\n```\s*$/, '');
      }

      // Check if AI refused the request
      if (cleanedResponse.toLowerCase().includes("i'm sorry") || 
          cleanedResponse.toLowerCase().includes("i can't assist") ||
          cleanedResponse.toLowerCase().includes("i cannot help")) {
        console.log('AI refused the request, returning empty quotes');
        quotes = [];
      } else {
        const parsed = JSON.parse(cleanedResponse);
        quotes = parsed.quotes || [];
      }
    } catch (error) {
      console.error('Failed to parse AI response:', error);
      console.error('Raw AI response:', aiResponse);
      
      // Check if AI refused the request
      if (aiResponse.toLowerCase().includes("i'm sorry") || 
          aiResponse.toLowerCase().includes("i can't assist") ||
          aiResponse.toLowerCase().includes("i cannot help")) {
        console.log('AI refused the request, returning empty quotes');
        quotes = [];
      } else {
        // Fallback: return the raw response as a single quote
        quotes = [{
          text: aiResponse,
          context: "AI-generated response (parsing failed)"
        }];
      }
    }

    // Cache the quotes for future requests (only if we got valid quotes)
    if (!projectData.quotesCache) {
      projectData.quotesCache = {};
    }
    
    // Only cache if we have valid quotes (not empty due to AI refusal)
    if (quotes.length > 0) {
      projectData.quotesCache[cacheKey] = {
        quotes: quotes,
        question: question,
        answer: answer,
        savedAt: new Date().toISOString()
      };

      // Save the updated project data
      await saveProjectStorytelling(projectId, projectData);
      console.log(`💾 Cached quotes for storytelling: ${cacheKey}`);
    } else {
      console.log(`⚠️ Not caching empty quotes for: ${cacheKey}`);
    }

    res.json({
      success: true,
      quotes: quotes,
      question: question,
      answer: answer,
      cached: false
    });

  } catch (error) {
    console.error('Error getting quotes for storytelling:', error);
    res.status(500).json({ error: error.message });
  }
});

// POST /api/storytelling/:projectId/clear-quotes-cache - Clear quotes cache for testing
router.post('/:projectId/clear-quotes-cache', authenticateToken, async (req, res) => {
  try {
    const { projectId } = req.params;
    const { question, answer } = req.body;

    if (!question || !answer) {
      return res.status(400).json({ error: 'Question and answer are required' });
    }

    const projectData = await loadProjectStorytelling(projectId);
    const cacheKey = `${question}|${answer}`;
    
    if (projectData.quotesCache && projectData.quotesCache[cacheKey]) {
      delete projectData.quotesCache[cacheKey];
      await saveProjectStorytelling(projectId, projectData);
      console.log(`🗑️ Cleared cache for: ${cacheKey}`);
      res.json({ success: true, message: 'Cache cleared' });
    } else {
      res.json({ success: true, message: 'No cache found for this question/answer' });
    }
  } catch (error) {
    console.error('Error clearing quotes cache:', error);
    res.status(500).json({ error: error.message });
  }
});

// POST /api/storytelling/:projectId/estimate - Estimate cost
router.post('/:projectId/estimate', authenticateToken, async (req, res) => {
  try {
    const { projectId } = req.params;
    const { detailLevel = 'moderate', analysisId } = req.body;

    const transcriptsText = await getTranscriptsText(projectId, analysisId);
    const caDataObj = await getCAData(projectId, analysisId);

    const estimate = estimateStorytellingCost(transcriptsText, caDataObj, detailLevel, 'moderate', 'qa');

    res.json(estimate);
  } catch (error) {
    console.error('Error estimating cost:', error);
    res.status(500).json({ error: 'Failed to estimate cost' });
  }
});

export default router;
