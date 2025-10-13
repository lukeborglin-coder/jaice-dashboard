import express from 'express';
import fs from 'fs/promises';
import fsSync from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { Document, Paragraph, TextRun, HeadingLevel, AlignmentType, Packer } from 'docx';
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
    const dataPath = path.join(process.env.DATA_DIR || '/server/data', 'projects.json');
    if (fsSync.existsSync(dataPath)) {
      const data = fsSync.readFileSync(dataPath, 'utf8');
      return JSON.parse(data);
    }
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
async function loadProjectStorytelling(projectId) {
  try {
    const data = await fs.readFile(STORYTELLING_PATH, 'utf8');
    const allData = JSON.parse(data);
    return allData[projectId] || {
      strategicQuestions: [],
      keyFindings: null,
      storyboards: [],
      chatHistory: []
    };
  } catch (error) {
    console.error('Error loading storytelling data:', error);
    return {
      strategicQuestions: [],
      keyFindings: null,
      storyboards: [],
      chatHistory: []
    };
  }
}

// Helper: Save project's storytelling data
async function saveProjectStorytelling(projectId, projectData) {
  try {
    const data = await fs.readFile(STORYTELLING_PATH, 'utf8');
    const allData = JSON.parse(data);
    allData[projectId] = projectData;
    await fs.writeFile(STORYTELLING_PATH, JSON.stringify(allData, null, 2));
    return true;
  } catch (error) {
    console.error('Error saving storytelling data:', error);
    return false;
  }
}

// Helper: Get transcripts text for a project
async function getTranscriptsText(projectId) {
  try {
    const data = await fs.readFile(TRANSCRIPTS_PATH, 'utf8');
    const transcripts = JSON.parse(data);
    const projectTranscripts = transcripts[projectId] || [];

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
    return combinedText;
  } catch (error) {
    console.error('Error getting transcripts text:', error);
    return '';
  }
}

// Helper: Get CA data for a project
async function getCAData(projectId) {
  try {
    const data = await fs.readFile(CAX_PATH, 'utf8');
    const allCA = JSON.parse(data);
    const projectCA = allCA.find(ca => ca.projectId === projectId);
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
    // Read all projects
    const projectsData = readProjectsData();
    const allProjects = [];
    
    // Collect all projects from all users
    Object.keys(projectsData).forEach(userId => {
      if (!userId.endsWith('_archived')) {
        const userProjects = projectsData[userId] || [];
        allProjects.push(...userProjects);
      }
    });

    // Get content analysis data to count respondents
    let caData = [];
    try {
      console.log('🔍 CA File Debug:', {
        caPath: CAX_PATH,
        fileExists: await fs.access(CAX_PATH).then(() => true).catch(() => false)
      });
      
      const caDataContent = await fs.readFile(CAX_PATH, 'utf8');
      console.log('🔍 CA File Content Length:', caDataContent.length);
      console.log('🔍 CA File Content Preview:', caDataContent.substring(0, 500));
      
      caData = JSON.parse(caDataContent);
      console.log('🔍 CA Data Structure Debug:', {
        totalAnalyses: caData.length,
        isArray: Array.isArray(caData),
        firstAnalysis: caData[0] ? {
          projectId: caData[0].projectId,
          hasData: !!caData[0].data,
          hasQuotes: !!caData[0].quotes,
          hasVerbatimQuotes: !!caData[0].verbatimQuotes,
          verbatimQuotesKeys: caData[0].verbatimQuotes ? Object.keys(caData[0].verbatimQuotes) : [],
          verbatimQuotesStructure: caData[0].verbatimQuotes ? 
            Object.keys(caData[0].verbatimQuotes).map(key => ({
              sheet: key,
              respondentCount: caData[0].verbatimQuotes[key] ? Object.keys(caData[0].verbatimQuotes[key]).length : 0
            })) : [],
          dataKeys: caData[0].data ? Object.keys(caData[0].data) : [],
          quotesKeys: caData[0].quotes ? Object.keys(caData[0].quotes) : [],
          fullDataStructure: caData[0].data ? caData[0].data : null
        } : null
      });
    } catch (error) {
      console.log('🔍 CA Data Loading Error:', {
        error: error.message,
        stack: error.stack,
        caPath: CAX_PATH
      });
    }

    // Filter projects that have content analysis data and add respondent counts
    console.log('🔍 Projects Debug:', {
      totalProjects: allProjects.length,
      projectIds: allProjects.map(p => p.id),
      caProjectIds: caData.map(ca => ca.projectId)
    });

    const projectsWithCA = allProjects.filter(project => {
      const projectCA = caData.find(ca => ca.projectId === project.id);
      // Check for main data structure instead of just verbatimQuotes
      const hasCA = projectCA && projectCA.data && Object.keys(projectCA.data).length > 0;
      
      console.log(`🔍 Project ${project.id} (${project.name}):`, {
        foundCA: !!projectCA,
        hasData: projectCA ? !!projectCA.data : false,
        hasVerbatimQuotes: projectCA ? !!projectCA.verbatimQuotes : false,
        dataKeys: projectCA && projectCA.data ? Object.keys(projectCA.data) : [],
        verbatimQuotesKeys: projectCA && projectCA.verbatimQuotes ? Object.keys(projectCA.verbatimQuotes) : [],
        willInclude: hasCA
      });
      
      return hasCA;
    }).map(project => {
      const projectCA = caData.find(ca => ca.projectId === project.id);
      let respondentCount = 0;
      
      if (projectCA) {
        // Count unique respondents from all data structures (verbatimQuotes, data, quotes)
        const allRespondents = new Set();
        
        console.log(`🔍 Respondent Count Debug for ${project.id}:`, {
          verbatimQuotesKeys: projectCA.verbatimQuotes ? Object.keys(projectCA.verbatimQuotes) : [],
          dataKeys: projectCA.data ? Object.keys(projectCA.data) : [],
          quotesKeys: projectCA.quotes ? Object.keys(projectCA.quotes) : [],
          verbatimQuotesStructure: projectCA.verbatimQuotes ? 
            Object.keys(projectCA.verbatimQuotes).map(sheet => ({
              sheet,
              respondentIds: projectCA.verbatimQuotes[sheet] ? Object.keys(projectCA.verbatimQuotes[sheet]) : []
            })) : [],
          dataStructure: projectCA.data ? 
            Object.keys(projectCA.data).map(sheet => ({
              sheet,
              respondentIds: projectCA.data[sheet] ? Object.keys(projectCA.data[sheet]) : []
            })) : [],
          quotesStructure: projectCA.quotes ? 
            Object.keys(projectCA.quotes).map(sheet => ({
              sheet,
              respondentIds: projectCA.quotes[sheet] ? Object.keys(projectCA.quotes[sheet]) : []
            })) : []
        });
        
        // Helper function to check if a string is a valid respondent ID
        const isValidRespondentId = (id) => {
          return typeof id === 'string' && 
                 id.trim() !== '' && 
                 !/^\d+$/.test(id) && // Not just numbers
                 (id.startsWith('R') || id.match(/^[A-Za-z]/)); // Starts with letter
        };
        
        // Count from main data structure first (this has all respondents)
        if (projectCA.data) {
          Object.values(projectCA.data).forEach(sheetData => {
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
        if (projectCA.verbatimQuotes) {
          Object.values(projectCA.verbatimQuotes).forEach(sheetData => {
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
        if (projectCA.quotes) {
          Object.values(projectCA.quotes).forEach(sheetData => {
            if (sheetData && typeof sheetData === 'object') {
              Object.keys(sheetData).forEach(respondentId => {
                if (isValidRespondentId(respondentId)) {
                  allRespondents.add(respondentId);
                }
              });
            }
          });
        }
        
        respondentCount = allRespondents.size;
        
        console.log(`🔍 Final respondent count for ${project.id}:`, {
          allRespondents: Array.from(allRespondents),
          count: respondentCount,
          sources: {
            verbatimQuotes: projectCA.verbatimQuotes ? 'yes' : 'no',
            data: projectCA.data ? 'yes' : 'no',
            quotes: projectCA.quotes ? 'yes' : 'no'
          }
        });
      }

      return {
        ...project,
        respondentCount
      };
    });

    console.log('🔍 Final Result:', {
      projectsWithCA: projectsWithCA.length,
      projects: projectsWithCA.map(p => ({ id: p.id, name: p.name, respondentCount: p.respondentCount }))
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
    const data = await loadProjectStorytelling(projectId);
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
    const { questions } = req.body;

    if (!Array.isArray(questions)) {
      return res.status(400).json({ error: 'Questions must be an array' });
    }

    const data = await loadProjectStorytelling(projectId);
    data.strategicQuestions = questions;

    if (await saveProjectStorytelling(projectId, data)) {
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

    const projectData = await loadProjectStorytelling(projectId);
    const strategicQuestions = projectData.strategicQuestions;

    if (!strategicQuestions || strategicQuestions.length === 0) {
      return res.status(400).json({ error: 'No strategic questions defined for this project' });
    }

    const transcriptsText = await getTranscriptsText(projectId);
    const caDataObj = await getCAData(projectId);

    if (!transcriptsText.trim()) {
      return res.status(400).json({ error: 'No transcript data available for this project' });
    }

    const findings = await generateKeyFindings(projectId, strategicQuestions, transcriptsText, caDataObj);

    projectData.keyFindings = {
      ...findings,
      generatedAt: new Date().toISOString(),
      version: (projectData.keyFindings?.version || 0) + 1
    };

    if (await saveProjectStorytelling(projectId, projectData)) {
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
    const { detailLevel = 'moderate', quoteLevel = 'moderate' } = req.body;

    const transcriptsText = await getTranscriptsText(projectId);
    const caDataObj = await getCAData(projectId);

    if (!transcriptsText.trim()) {
      return res.status(400).json({ error: 'No transcript data available for this project' });
    }

    const storyboard = await generateStoryboard(projectId, transcriptsText, caDataObj, detailLevel, quoteLevel);

    const projectData = await loadProjectStorytelling(projectId);
    storyboard.id = `SB-${Date.now()}`;
    storyboard.detailLevel = detailLevel;
    storyboard.quoteLevel = quoteLevel;

    projectData.storyboards.unshift(storyboard); // Add to beginning (newest first)

    if (await saveProjectStorytelling(projectId, projectData)) {
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
        // Italic quote
        else if (trimmed.startsWith('_') && trimmed.endsWith('_')) {
          const text = trimmed.substring(1, trimmed.length - 1);
          paragraphs.push(
            new Paragraph({
              children: [
                new TextRun({ text: `"${text}"`, italics: true })
              ],
              indent: { left: 720 }
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
    const { question, detailLevel = 'moderate', quoteLevel = 'moderate' } = req.body;

    if (!question || !question.trim()) {
      return res.status(400).json({ error: 'Question is required' });
    }

    const caDataObj = await getCAData(projectId);

    if (!caDataObj || !caDataObj.data || Object.keys(caDataObj.data).length === 0) {
      return res.status(400).json({ error: 'No content analysis data available for this project' });
    }

    const projectData = await loadProjectStorytelling(projectId);
    const answer = await answerQuestion(
      projectId,
      question,
      '', // No transcripts needed for Q&A
      caDataObj,
      projectData.keyFindings,
      detailLevel,
      quoteLevel
    );

    // Add to chat history
    projectData.chatHistory.push({
      id: `Q-${Date.now()}`,
      question,
      answer: answer.answer,
      quotes: answer.quotes || [],
      confidence: answer.confidence,
      note: answer.note,
      timestamp: new Date().toISOString(),
      detailLevel,
      quoteLevel
    });

    // Keep last 50 Q&A pairs
    if (projectData.chatHistory.length > 50) {
      projectData.chatHistory = projectData.chatHistory.slice(-50);
    }

    await saveProjectStorytelling(projectId, projectData);

    res.json(answer);
  } catch (error) {
    console.error('Error answering question:', error);
    res.status(500).json({ error: 'Failed to answer question', message: error.message });
  }
});

// POST /api/storytelling/:projectId/estimate - Estimate cost
router.post('/:projectId/estimate', authenticateToken, async (req, res) => {
  try {
    const { projectId } = req.params;
    const { detailLevel = 'moderate', quoteLevel = 'moderate' } = req.body;

    const transcriptsText = await getTranscriptsText(projectId);
    const caDataObj = await getCAData(projectId);

    const estimate = estimateStorytellingCost(transcriptsText, caDataObj, detailLevel, quoteLevel, 'qa');

    res.json(estimate);
  } catch (error) {
    console.error('Error estimating cost:', error);
    res.status(500).json({ error: 'Failed to estimate cost' });
  }
});

export default router;
