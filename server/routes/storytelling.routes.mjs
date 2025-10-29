import express from 'express';
import fs from 'fs/promises';
import fsSync from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { Document, Paragraph, TextRun, HeadingLevel, AlignmentType, Packer } from 'docx';
import mammoth from 'mammoth';
import OpenAI from 'openai';
import { authenticateToken } from '../middleware/auth.middleware.mjs';

// Safe JSON parse utility with repair capabilities
function safeJsonParse(data, fallback = null) {
  try {
    if (!data || data.trim().length === 0) {
      return fallback;
    }
    return JSON.parse(data);
  } catch (error) {
    console.error('JSON parse error:', error.message);
    console.log('Data length:', data?.length || 0);
    if (data && data.length > 0) {
      console.log('Data preview (first 200 chars):', data.substring(0, 200));
      console.log('Data preview (last 200 chars):', data.substring(Math.max(0, data.length - 200)));
    }
    
    // Try to repair common JSON issues
    try {
      console.log('Attempting to repair JSON...');
      let repairedData = data.trim();
      
      // Remove trailing extra brackets and braces
      while (repairedData.endsWith(']') || repairedData.endsWith('}')) {
        const lastBracket = repairedData.lastIndexOf(']');
        const lastBrace = repairedData.lastIndexOf('}');
        const lastChar = Math.max(lastBracket, lastBrace);
        
        if (lastChar > 0) {
          const beforeLast = repairedData.substring(0, lastChar).trim();
          if (beforeLast.endsWith(']') || beforeLast.endsWith('}')) {
            repairedData = beforeLast;
          } else {
            break;
          }
        } else {
          break;
        }
      }
      
      console.log('Repaired data preview (last 100 chars):', repairedData.substring(Math.max(0, repairedData.length - 100)));
      
      const repaired = JSON.parse(repairedData);
      console.log('JSON repair successful!');
      return repaired;
    } catch (repairError) {
      console.error('JSON repair failed:', repairError.message);
      
      // If repair failed, try to extract valid JSON by finding the last complete object
      try {
        console.log('Attempting advanced JSON repair...');
        
        // Use the original data for advanced repair
        let advancedRepairData = data.trim();
        
        // Find the last complete array/object by counting brackets
        let bracketCount = 0;
        let braceCount = 0;
        let lastValidPosition = -1;
        
        for (let i = 0; i < advancedRepairData.length; i++) {
          const char = advancedRepairData[i];
          if (char === '[') bracketCount++;
          else if (char === ']') bracketCount--;
          else if (char === '{') braceCount++;
          else if (char === '}') braceCount--;
          
          // If we're back to balanced state, this might be a valid end
          if (bracketCount === 0 && braceCount === 0) {
            lastValidPosition = i;
          }
        }
        
        if (lastValidPosition > 0) {
          const truncatedData = advancedRepairData.substring(0, lastValidPosition + 1);
          console.log('Truncated data preview (last 100 chars):', truncatedData.substring(Math.max(0, truncatedData.length - 100)));
          
          const truncated = JSON.parse(truncatedData);
          console.log('Advanced JSON repair successful!');
          return truncated;
        }
      } catch (advancedRepairError) {
        console.error('Advanced JSON repair failed:', advancedRepairError.message);
      }
    }
    
    return fallback;
  }
}
import {
  estimateStorytellingCost,
  generateKeyFindings,
  generateStoryboard,
  generateConciseExecutiveSummary,
  generateDynamicReport,
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
    
    const projectData = allData[key] || {
      strategicQuestions: [],
      keyFindings: null,
      storyboards: [],
      chatHistory: [],
      quotesCache: {}
    };
    
    console.log('🔍 Loaded project data keys:', Object.keys(projectData));
    console.log('🔍 Report data in loaded data:', !!projectData.reportData);
    if (projectData.reportData) {
      console.log('🔍 Report data slides count in loaded data:', projectData.reportData.slides?.length || 0);
    }
    
    // Clean up chat history to keep only last 10 entries
    if (projectData.chatHistory && projectData.chatHistory.length > 10) {
      projectData.chatHistory = projectData.chatHistory.slice(-10);
      // Save the cleaned data
      allData[key] = projectData;
      await fs.writeFile(STORYTELLING_PATH, JSON.stringify(allData, null, 2));
    }
    
    return projectData;
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
    
    console.log('💾 Saving storytelling data:', { 
      projectId, 
      analysisId, 
      key, 
      strategicQuestionsCount: projectData.strategicQuestions?.length || 0,
      hasReportData: !!projectData.reportData,
      reportDataSlidesCount: projectData.reportData?.slides?.length || 0
    });
    
    allData[key] = projectData;
    await fs.writeFile(STORYTELLING_PATH, JSON.stringify(allData, null, 2));
    console.log('✅ Storytelling data saved to file successfully');
    return true;
  } catch (error) {
    console.error('❌ Error saving storytelling data:', error);
    return false;
  }
}

// Helper: Get transcripts text for a project
async function getTranscriptsText(projectId, analysisId = null, transcriptIds = null) {
  try {
    const data = await fs.readFile(TRANSCRIPTS_PATH, 'utf8');
    const transcripts = JSON.parse(data);
    let projectTranscripts = transcripts[projectId] || [];

    console.log('🔍 getTranscriptsText debug:', {
      projectId,
      analysisId,
      transcriptIds,
      totalProjectTranscripts: projectTranscripts.length,
      transcriptAnalysisIds: projectTranscripts.map(t => t.analysisId)
    });

    // Filter by analysisId if provided
    if (analysisId) {
      const beforeFilter = projectTranscripts.length;
      const transcriptsWithAnalysisId = projectTranscripts.filter(t => t.analysisId === analysisId);
      
      // If transcripts have analysisId, filter by it
      // If no transcripts have analysisId, use all transcripts (legacy behavior)
      if (transcriptsWithAnalysisId.length > 0) {
        projectTranscripts = transcriptsWithAnalysisId;
        console.log('🔍 Filtered to transcripts with matching analysisId');
      } else {
        // Check if any transcripts have analysisId at all
        const hasAnyAnalysisId = projectTranscripts.some(t => t.analysisId);
        if (hasAnyAnalysisId) {
          console.log('🔍 No transcripts found with analysisId, returning empty result');
          return '';
        } else {
          console.log('🔍 No transcripts have analysisId, using all transcripts (legacy behavior)');
        }
      }
      
      console.log('🔍 Transcript filtering:', {
        analysisId,
        beforeFilter,
        afterFilter: projectTranscripts.length,
        filteredTranscripts: projectTranscripts.map(t => ({ id: t.id, analysisId: t.analysisId, respno: t.respno }))
      });
    }

    // Filter by transcriptIds if provided
    if (transcriptIds && Array.isArray(transcriptIds) && transcriptIds.length > 0) {
      const beforeIdFilter = projectTranscripts.length;
      // Normalize IDs to strings for comparison
      const normalizedTranscriptIds = transcriptIds.map(id => String(id));
      projectTranscripts = projectTranscripts.filter(t => {
        const transcriptId = String(t.id);
        return normalizedTranscriptIds.includes(transcriptId);
      });
      console.log('🔍 Filtered by transcriptIds:', {
        requestedTranscriptIds: transcriptIds,
        normalizedTranscriptIds,
        beforeFilter: beforeIdFilter,
        afterFilter: projectTranscripts.length,
        filteredTranscripts: projectTranscripts.map(t => ({ id: t.id, respno: t.respno })),
        allTranscriptIds: projectTranscripts.map(t => String(t.id))
      });
      
      if (projectTranscripts.length === 0) {
        console.warn('⚠️ Warning: No transcripts matched the provided transcriptIds. Requested:', normalizedTranscriptIds);
      }
    }

    let combinedText = '';
    for (const transcript of projectTranscripts) {
      const filePath = transcript.cleanedPath || transcript.originalPath;
      if (filePath) {
        try {
          // Use mammoth to extract text from .docx files (filters out images and binary data)
          const result = await mammoth.extractRawText({ path: filePath });
          const content = result.value; // This is plain text without images
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
      
      caData = safeJsonParse(caDataContent, []);
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
      const isValid = typeof id === 'string' && 
             id.trim() !== '' && 
             id.trim() !== 'Respondent ID' && // Not the header
             (id.startsWith('R') || id.match(/^[A-Za-z]/) || !isNaN(Number(id))); // Starts with letter OR is numeric
      
      if (id && typeof id === 'string' && id.trim() !== '') {
        console.log(`🔍 Respondent ID validation: "${id}" -> ${isValid}`);
      }
      
      return isValid;
    };

    // Helper function to count respondents from content analysis data
    const countRespondents = (caItem) => {
      const allRespondents = new Set();
      
      console.log(`🔍 Counting respondents for CA ${caItem.id}:`, {
        hasData: !!caItem.data,
        dataKeys: caItem.data ? Object.keys(caItem.data) : []
      });
      
      // Count from main data structure (this has all respondents)
      if (caItem.data) {
        Object.values(caItem.data).forEach((sheetData, sheetIndex) => {
          console.log(`🔍 Processing sheet ${sheetIndex}:`, {
            isArray: Array.isArray(sheetData),
            length: Array.isArray(sheetData) ? sheetData.length : 'N/A',
            sampleRow: Array.isArray(sheetData) && sheetData.length > 0 ? sheetData[0] : 'N/A'
          });
          
          if (Array.isArray(sheetData)) {
            // For array data, look for respondent IDs in the data objects
            sheetData.forEach((row, rowIndex) => {
              if (row && typeof row === 'object') {
                // Look for common respondent ID fields
                const respondentId = row['Respondent ID'] || row['respno'] || row['ID'] || row['id'];
                if (isValidRespondentId(respondentId)) {
                  allRespondents.add(respondentId);
                  if (rowIndex < 3) { // Log first few for debugging
                    console.log(`🔍 Found valid respondent: "${respondentId}" in row ${rowIndex}`);
                  }
                }
              }
            });
          } else if (sheetData && typeof sheetData === 'object') {
            // For object data, use keys as respondent IDs
            Object.keys(sheetData).forEach(respondentId => {
              if (isValidRespondentId(respondentId)) {
                allRespondents.add(respondentId);
                console.log(`🔍 Found valid respondent in object keys: "${respondentId}"`);
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
      
      console.log(`🔍 Final respondent count for CA ${caItem.id}: ${allRespondents.size}`);
      console.log(`🔍 Respondent IDs found:`, Array.from(allRespondents));
      
      return allRespondents.size;
    };

    // Load all projects data to get full project metadata
    const projectsData = readProjectsData();
    const allProjects = [];
    for (const userId in projectsData) {
      if (projectsData[userId]) {
        allProjects.push(...projectsData[userId]);
      }
    }

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

      // Find the full project data to get metadata like teamMembers, methodology, etc.
      const fullProject = allProjects.find(p => p.id === caItem.projectId);

      console.log(`🔍 Final processing for CA ${caItem.id}:`, {
        projectId: caItem.projectId,
        name: caItem.name,
        respondentCount,
        dataKeys: caItem.data ? Object.keys(caItem.data) : [],
        foundFullProject: !!fullProject,
        fullProjectTeamMembers: fullProject?.teamMembers?.length || 0,
        allProjectsCount: allProjects.length,
        allProjectIds: allProjects.map(p => p.id)
      });

      return {
        id: caItem.projectId,
        name: caItem.name || fullProject?.name || `Content Analysis ${caItem.id}`,
        respondentCount,
        analysisId: caItem.id,
        createdAt: caItem.createdAt || new Date().toISOString(),
        // Include full project metadata for filtering
        ...(fullProject || {}),
        // Override with CA-specific data
        analysisId: caItem.id,
        respondentCount,
        analysisCount: 1, // Each entry represents one content analysis
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
    
    console.log('🔍 Loading storytelling data for project:', { projectId, analysisId });
    
    const data = await loadProjectStorytelling(projectId, analysisId);
    
    console.log('🔍 Loaded storytelling data keys:', Object.keys(data));
    console.log('🔍 Report data exists:', !!data.reportData);
    if (data.reportData) {
      console.log('🔍 Report data slides count:', data.reportData.slides?.length || 0);
    }
    
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

    // Calculate respondent count from CA data
    let respondentCount = 0;
    if (caDataObj && caDataObj.data) {
      const allRespondents = new Set();
      Object.values(caDataObj.data).forEach((sheetData) => {
        if (Array.isArray(sheetData)) {
          sheetData.forEach((row) => {
            if (row && typeof row === 'object') {
              const respondentId = row['Respondent ID'] || row['respno'] || row['ID'] || row['id'];
              if (respondentId && typeof respondentId === 'string' && respondentId.trim() !== '') {
                allRespondents.add(respondentId.trim());
              }
            }
          });
        }
      });
      respondentCount = allRespondents.size;
    }

    const findings = await generateKeyFindings(projectId, strategicQuestions, transcriptsText, caDataObj, detailLevel);

    projectData.keyFindings = {
      ...findings,
      generatedAt: new Date().toISOString(),
      detailLevel: detailLevel,
      version: (projectData.keyFindings?.version || 0) + 1,
      respondentCount: respondentCount,
      strategicQuestions: strategicQuestions
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
    // Keep only the 5 most recent storyboards
    if (projectData.storyboards.length > 5) {
      projectData.storyboards = projectData.storyboards.slice(0, 5);
    }

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

// POST /api/storytelling/:projectId/executive-summary/generate - Generate concise executive summary
router.post('/:projectId/executive-summary/generate', authenticateToken, async (req, res) => {
  try {
    const { projectId } = req.params;
    const { analysisId } = req.body;

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

    const conciseFindings = await generateConciseExecutiveSummary(projectId, strategicQuestions, transcriptsText, caDataObj);

    // Store the concise findings in the project data
    projectData.conciseExecutiveSummary = {
      ...conciseFindings,
      generatedAt: new Date().toISOString()
    };

    if (await saveProjectStorytelling(projectId, projectData, analysisId)) {
      res.json(projectData.conciseExecutiveSummary);
    } else {
      res.status(500).json({ error: 'Failed to save concise executive summary' });
    }
  } catch (error) {
    console.error('Error generating concise executive summary:', error);
    res.status(500).json({ error: 'Failed to generate concise executive summary', message: error.message });
  }
});

// POST /api/storytelling/:projectId/dynamic-report/generate - Generate dynamic report
router.post('/:projectId/dynamic-report/generate', authenticateToken, async (req, res) => {
  try {
    const { projectId } = req.params;
    const { analysisId } = req.body;

    const projectData = await loadProjectStorytelling(projectId, analysisId);
    const strategicQuestions = projectData.strategicQuestions || [];

    // Allow report generation even without strategic questions
    // The executive summary slide will show a message when no questions are available

    const transcriptsText = await getTranscriptsText(projectId, analysisId);
    const caDataObj = await getCAData(projectId, analysisId);

    if (!transcriptsText.trim()) {
      return res.status(400).json({ error: 'No transcript data available for this project' });
    }

    // Get project information for title slide
    const projectInfo = {
      name: projectData.projectName || 'Project Name',
      client: projectData.client || 'Client Name'
    };

    const dynamicReport = await generateDynamicReport(projectId, transcriptsText, caDataObj, strategicQuestions, analysisId, projectInfo);

    // Store the dynamic report in the project data
    projectData.dynamicReport = {
      ...dynamicReport,
      generatedAt: new Date().toISOString()
    };

    if (await saveProjectStorytelling(projectId, projectData, analysisId)) {
      res.json(projectData.dynamicReport);
    } else {
      res.status(500).json({ error: 'Failed to save dynamic report' });
    }
  } catch (error) {
    console.error('Error generating dynamic report:', error);
    res.status(500).json({ error: 'Failed to generate dynamic report', message: error.message });
  }
});

// GET /api/storytelling/:projectId/storyboard/:storyboardId/download - Download storyboard as Word
router.get('/:projectId/storyboard/:storyboardId/download', authenticateToken, async (req, res) => {
  try {
    const { projectId, storyboardId } = req.params;
    const { analysisId } = req.query || {};

    // Try loading with analysisId first (newer storage scheme), then fallback to legacy key
    let projectData = await loadProjectStorytelling(projectId, analysisId);
    let storyboard = projectData.storyboards.find(sb => sb.id === storyboardId);

    if (!storyboard && analysisId) {
      // Fallback to legacy storage without analysisId
      projectData = await loadProjectStorytelling(projectId, null);
      storyboard = projectData.storyboards.find(sb => sb.id === storyboardId);
    }

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

        // Markdown-style headings (generic)
        // Normalize common markdown heading prefixes
        const normalized = trimmed.replace(/^\*{3,}\s*/, '### ').replace(/^\-\-\-+\s*/, '### ');
        const headingMatch = normalized.match(/^(#{1,6})\s*(.*)$/);
        if (headingMatch) {
          const level = headingMatch[1].length; // number of #
          const text = headingMatch[2].trim();
          let headingLevel = HeadingLevel.HEADING_1;
          if (level >= 4) headingLevel = HeadingLevel.HEADING_3;
          else if (level === 3) headingLevel = HeadingLevel.HEADING_2;
          else if (level === 2) headingLevel = HeadingLevel.HEADING_1;
          paragraphs.push(
            new Paragraph({
              text: text || '',
              heading: headingLevel,
              spacing: { before: 300, after: 150 }
            })
          );
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

    // Keep last 10 Q&A pairs only
    if (projectData.chatHistory.length > 10) {
      projectData.chatHistory = projectData.chatHistory.slice(-10);
    }

    await saveProjectStorytelling(projectId, projectData, analysisId);

    res.json(answer);
  } catch (error) {
    console.error('Error answering question:', error);
    res.status(500).json({ error: 'Failed to answer question', message: error.message });
  }
});

// POST /api/storytelling/:projectId/expand-bullet - Expand a bullet point (internal use, doesn't add to chat history)
router.post('/:projectId/expand-bullet', authenticateToken, async (req, res) => {
  try {
    const { projectId } = req.params;
    const { bullet, detailLevel = 'moderate', analysisId } = req.body;

    if (!bullet || !bullet.trim()) {
      return res.status(400).json({ error: 'Bullet text is required' });
    }

    const caDataObj = await getCAData(projectId, analysisId);

    if (!caDataObj || !caDataObj.data || Object.keys(caDataObj.data).length === 0) {
      return res.status(400).json({ error: 'No content analysis data available for this project' });
    }

    const projectData = await loadProjectStorytelling(projectId, analysisId);
    const answer = await answerQuestion(
      projectId,
      `Expand with 2-3 sentences and context for this point, keeping it concise and actionable: ${bullet}`,
      '', // No transcripts needed for bullet expansion
      caDataObj,
      projectData.keyFindings,
      detailLevel
    );

    // Don't add to chat history - this is internal use only
    res.json(answer);
  } catch (error) {
    console.error('Error expanding bullet:', error);
    res.status(500).json({ error: 'Failed to expand bullet', message: error.message });
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
- Include ONLY respondent answers and responses (exclude moderator questions and content)
- Preserve the exact wording, punctuation, and formatting from the transcript
- Each quote should be a complete thought or exchange (at least 2-3 sentences)
- Focus on the most relevant and impactful quotes that provide detailed insights
- IMPORTANT: Always include the specific respondent ID (e.g., "R01:", "R02:", "R03:") in the quote text when available
- Use the exact respondent IDs as they appear in the transcript (R01, R02, etc.)
- If no relevant quotes are found, return an empty quotes array: {"quotes": []}
- Prioritize longer, more detailed quotes over short one-liners
- Look for quotes that provide context and explanation, not just brief statements
- NEVER include any text that starts with "Moderator:", "Interviewer:", "Facilitator:", or similar moderator labels
- NEVER include any text that appears to be questions being asked (e.g., "Can you tell me...", "What do you think...", "How do you...")
- Focus on text that appears to be answers, opinions, experiences, or responses from respondents`;

    const userPrompt = `Research Question: ${question}

Research Answer: ${answer}

Please analyze the following interview transcript and find 2-3 verbatim quotes that directly support the research answer above. Return only the exact text from the transcript with proper speaker labels (use "Moderator:" for interviewer/moderator and "Respondent:" for all participants).

CRITICAL: ONLY return quotes from respondents - NEVER include any moderator questions, responses, or content.

Transcript:
${transcriptsText.substring(0, 20000)}`; // Increased limit to 20000 chars for better quote quality

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
    console.log('🔍 Full AI response for debugging:', aiResponse);

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

// POST /api/storytelling/:projectId/report-data - Save report data
router.post('/:projectId/report-data', authenticateToken, async (req, res) => {
  try {
    const { projectId } = req.params;
    const { reportData, analysisId } = req.body;

    console.log('💾 Saving report data:', { 
      projectId, 
      analysisId, 
      hasSlides: !!reportData?.slides,
      slidesCount: reportData?.slides?.length || 0
    });

    const data = await loadProjectStorytelling(projectId, analysisId);
    console.log('🔍 Current data before saving report data:', Object.keys(data));
    
    data.reportData = reportData;
    console.log('🔍 Data after adding report data:', Object.keys(data));

    if (await saveProjectStorytelling(projectId, data, analysisId)) {
      console.log('✅ Report data saved successfully to file');
      res.json({ message: 'Report data saved successfully' });
    } else {
      console.error('❌ Failed to save report data to file');
      res.status(500).json({ error: 'Failed to save report data' });
    }
  } catch (error) {
    console.error('❌ Error saving report data:', error);
    res.status(500).json({ error: 'Failed to save report data' });
  }
});

// POST /api/storytelling/:projectId/estimate - Estimate cost for storyboard
router.post('/:projectId/estimate', authenticateToken, async (req, res) => {
  try {
    const { projectId } = req.params;
    const { detailLevel = 'moderate', analysisId } = req.body;

    const transcriptsText = await getTranscriptsText(projectId, analysisId);
    const caDataObj = await getCAData(projectId, analysisId);

    const estimate = estimateStorytellingCost(transcriptsText, caDataObj, detailLevel, 'moderate', 'storyboard');

    res.json(estimate);
  } catch (error) {
    console.error('Error estimating cost:', error);
    res.status(500).json({ error: 'Failed to estimate cost' });
  }
});

// POST /api/storytelling/:projectId/find-quotes - Find report-ready quotes for a finding
router.post('/:projectId/find-quotes', authenticateToken, async (req, res) => {
  try {
    const { projectId } = req.params;
    const { finding, transcriptIds, analysisId } = req.body;

    if (!finding || !finding.trim()) {
      return res.status(400).json({ error: 'Finding is required' });
    }

    // Get transcripts for this project, filtered by transcriptIds if provided
    const transcriptsText = await getTranscriptsText(projectId, analysisId, transcriptIds);
    if (!transcriptsText) {
      return res.status(404).json({ error: 'No transcripts available for this project' });
    }

    // Import the quote finding service
    const storytellingService = await import('../services/storytelling.service.mjs');
    const { findReportQuotes } = storytellingService.default;

    // Find quotes using hybrid search approach (transcriptIds already filtered in getTranscriptsText)
    const quotes = await findReportQuotes(finding, transcriptsText, null);

    res.json({
      success: true,
      quotes: quotes,
      finding: finding,
      totalFound: quotes.length
    });
  } catch (error) {
    console.error('Error finding quotes:', error);
    res.status(500).json({ error: 'Failed to find quotes', message: error.message });
  }
});

export default router;
