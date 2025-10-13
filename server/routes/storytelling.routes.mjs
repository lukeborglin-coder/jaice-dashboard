import express from 'express';
import fs from 'fs/promises';
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

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const router = express.Router();

// Storage paths
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '../data');
const STORYTELLING_PATH = path.join(DATA_DIR, 'storytelling.json');
const TRANSCRIPTS_PATH = path.join(DATA_DIR, 'transcripts.json');
const CAX_PATH = path.join(DATA_DIR, 'contentAnalysisX.json');

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
    if (!projectCA) return { data: {}, quotes: {} };
    
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

    const transcriptsText = await getTranscriptsText(projectId);
    const caDataObj = await getCAData(projectId);

    if (!transcriptsText.trim()) {
      return res.status(400).json({ error: 'No transcript data available for this project' });
    }

    const projectData = await loadProjectStorytelling(projectId);
    const answer = await answerQuestion(
      projectId,
      question,
      transcriptsText,
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
