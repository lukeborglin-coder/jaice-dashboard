import express from 'express';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { authenticateToken, requireCognitiveOrAdmin } from '../middleware/auth.middleware.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const router = express.Router();

// Enforce admin access for storage endpoints
router.use(authenticateToken, requireCognitiveOrAdmin);

// Data directory paths
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '../data');
const FILES_DIR = process.env.FILES_DIR || path.join(DATA_DIR, 'uploads');

// Helper function to get directory size recursively
async function getDirectorySize(dirPath) {
  try {
    let totalSize = 0;
    const entries = await fs.readdir(dirPath, { withFileTypes: true });
    
    for (const entry of entries) {
      const fullPath = path.join(dirPath, entry.name);
      
      try {
        if (entry.isDirectory()) {
          totalSize += await getDirectorySize(fullPath);
        } else {
          const stats = await fs.stat(fullPath);
          totalSize += stats.size;
        }
      } catch (err) {
        // Skip files/directories we can't access
        console.warn(`Could not access ${fullPath}:`, err.message);
      }
    }
    
    return totalSize;
  } catch (err) {
    // Directory doesn't exist or can't be accessed
    return 0;
  }
}

// Helper function to get file size
async function getFileSize(filePath) {
  try {
    const stats = await fs.stat(filePath);
    return stats.size;
  } catch (err) {
    return 0;
  }
}

// Helper function to format bytes
function formatBytes(bytes) {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${(bytes / Math.pow(k, i)).toFixed(2)} ${sizes[i]}`;
}

// GET /api/storage/projects - Get storage usage for all projects
router.get('/projects', async (req, res) => {
  try {
    const projectsPath = path.join(DATA_DIR, 'projects.json');
    const transcriptsPath = path.join(DATA_DIR, 'transcripts.json');
    const questionnairesPath = path.join(DATA_DIR, 'questionnaires.json');
    const savedAnalysesPath = path.join(DATA_DIR, 'savedAnalyses.json');
    const storytellingPath = path.join(DATA_DIR, 'storytelling.json');
    const tabulationsPath = path.join(DATA_DIR, 'data-tabulations', 'saved-tabulations.json');
    const conjointWorkflowsPath = path.join(DATA_DIR, 'conjointWorkflows.json');

    // Load all project data
    let projects = {};
    try {
      const projectsData = await fs.readFile(projectsPath, 'utf8');
      projects = JSON.parse(projectsData);
    } catch (err) {
      console.warn('Could not load projects.json:', err.message);
    }

    // Load transcripts
    let transcripts = {};
    try {
      const transcriptsData = await fs.readFile(transcriptsPath, 'utf8');
      transcripts = JSON.parse(transcriptsData);
    } catch (err) {
      console.warn('Could not load transcripts.json:', err.message);
    }

    // Load questionnaires
    let questionnaires = {};
    try {
      const questionnairesData = await fs.readFile(questionnairesPath, 'utf8');
      questionnaires = JSON.parse(questionnairesData);
    } catch (err) {
      console.warn('Could not load questionnaires.json:', err.message);
    }

    // Load saved analyses
    let savedAnalyses = [];
    try {
      const analysesData = await fs.readFile(savedAnalysesPath, 'utf8');
      savedAnalyses = JSON.parse(analysesData);
      // Convert to array if it's an object
      if (!Array.isArray(savedAnalyses)) {
        savedAnalyses = Object.values(savedAnalyses);
      }
    } catch (err) {
      console.warn('Could not load savedAnalyses.json:', err.message);
    }

    // Load storytelling data
    let storytelling = {};
    try {
      const storytellingData = await fs.readFile(storytellingPath, 'utf8');
      storytelling = JSON.parse(storytellingData);
    } catch (err) {
      console.warn('Could not load storytelling.json:', err.message);
    }

    // Load tabulations
    let tabulations = [];
    try {
      const tabulationsData = await fs.readFile(tabulationsPath, 'utf8');
      tabulations = JSON.parse(tabulationsData);
      if (!Array.isArray(tabulations)) {
        tabulations = Object.values(tabulations);
      }
    } catch (err) {
      // Tabulations file might not exist
    }

    // Load conjoint workflows
    let conjointWorkflows = [];
    try {
      const workflowsData = await fs.readFile(conjointWorkflowsPath, 'utf8');
      const workflowsObj = JSON.parse(workflowsData);
      conjointWorkflows = Array.isArray(workflowsObj) ? workflowsObj : Object.values(workflowsObj);
    } catch (err) {
      // Conjoint workflows file might not exist
    }

    // Flatten projects from all users
    const allProjects = [];
    for (const userId in projects) {
      if (Array.isArray(projects[userId])) {
        allProjects.push(...projects[userId]);
      }
    }

    // Calculate storage for each project
    const projectStorage = await Promise.all(
      allProjects.map(async (project) => {
        const projectId = project.id;
        const projectName = project.name || 'Unnamed Project';
        const storage = {
          projectId,
          projectName,
          archived: project.archived || false,
          totalSize: 0,
          breakdown: {
            transcripts: { size: 0, count: 0, files: [] },
            questionnaires: { size: 0, count: 0, files: [] },
            contentAnalysis: { size: 0, count: 0, files: [] },
            storytelling: { size: 0, count: 0 },
            dataTabulation: { size: 0, count: 0 },
            conjoint: { size: 0, count: 0 },
            other: { size: 0, count: 0 }
          }
        };

        // Calculate transcripts storage
        if (transcripts[projectId]) {
          const projectTranscripts = transcripts[projectId];
          storage.breakdown.transcripts.count = projectTranscripts.length;
          
          for (const transcript of projectTranscripts) {
            // Check original file
            if (transcript.originalPath) {
              const filePath = path.isAbsolute(transcript.originalPath)
                ? transcript.originalPath
                : path.join(DATA_DIR, transcript.originalPath);
              const size = await getFileSize(filePath);
              storage.breakdown.transcripts.size += size;
              storage.breakdown.transcripts.files.push({
                name: transcript.originalFilename || 'Unknown',
                size,
                type: 'original'
              });
            }
            
            // Check cleaned file
            if (transcript.cleanedPath) {
              const filePath = path.isAbsolute(transcript.cleanedPath)
                ? transcript.cleanedPath
                : path.join(DATA_DIR, transcript.cleanedPath);
              const size = await getFileSize(filePath);
              storage.breakdown.transcripts.size += size;
              storage.breakdown.transcripts.files.push({
                name: transcript.cleanedFilename || 'Unknown',
                size,
                type: 'cleaned'
              });
            }
          }
        }

        // Calculate questionnaires storage
        if (questionnaires[projectId]) {
          const projectQuestionnaires = questionnaires[projectId];
          storage.breakdown.questionnaires.count = projectQuestionnaires.length;
          
          for (const qnr of projectQuestionnaires) {
            // Check questionnaire data directory
            const qnrDataDir = path.join(DATA_DIR, 'questionnaire-data', qnr.id);
            const qnrDirSize = await getDirectorySize(qnrDataDir);
            storage.breakdown.questionnaires.size += qnrDirSize;
            
            // Check original file
            if (qnr.filePath) {
              const filePath = path.isAbsolute(qnr.filePath)
                ? qnr.filePath
                : path.join(DATA_DIR, qnr.filePath);
              const size = await getFileSize(filePath);
              storage.breakdown.questionnaires.size += size;
            }
            
            storage.breakdown.questionnaires.files.push({
              name: qnr.name || 'Unknown Questionnaire',
              size: qnrDirSize,
              questionnaireId: qnr.id
            });
          }
        }

        // Calculate content analysis storage
        const projectAnalyses = savedAnalyses.filter(a => a.projectId === projectId);
        storage.breakdown.contentAnalysis.count = projectAnalyses.length;
        
        for (const analysis of projectAnalyses) {
          // Check discussion guide files
          const guideHtmlPath = path.join(DATA_DIR, 'discussionGuides', `${projectId}.html`);
          const guideDocxPath = path.join(DATA_DIR, 'discussionGuides', `${projectId}.docx`);
          
          const htmlSize = await getFileSize(guideHtmlPath);
          const docxSize = await getFileSize(guideDocxPath);
          
          storage.breakdown.contentAnalysis.size += htmlSize + docxSize;
          storage.breakdown.contentAnalysis.files.push({
            name: analysis.name || 'Content Analysis',
            size: htmlSize + docxSize,
            analysisId: analysis.id
          });
        }

        // Calculate storytelling storage (JSON only, usually small)
        const storytellingKeys = Object.keys(storytelling).filter(key => 
          key.startsWith(`${projectId}-`) || key === projectId
        );
        storage.breakdown.storytelling.count = storytellingKeys.length;
        // Storytelling is stored in JSON, calculate size from JSON string
        for (const key of storytellingKeys) {
          const data = storytelling[key];
          const jsonSize = Buffer.byteLength(JSON.stringify(data), 'utf8');
          storage.breakdown.storytelling.size += jsonSize;
        }

        // Calculate data tabulation storage
        const projectTabulations = tabulations.filter(t => t.projectId === projectId);
        storage.breakdown.dataTabulation.count = projectTabulations.length;
        // Tabulation files are in data-tabulations directory
        const tabulationDir = path.join(DATA_DIR, 'data-tabulations');
        // Note: Individual tabulation file sizes would require more detailed tracking
        // For now, we'll estimate based on JSON size
        for (const tab of projectTabulations) {
          const jsonSize = Buffer.byteLength(JSON.stringify(tab), 'utf8');
          storage.breakdown.dataTabulation.size += jsonSize;
        }

        // Calculate conjoint storage
        const projectWorkflows = conjointWorkflows.filter(w => w.projectId === projectId);
        storage.breakdown.conjoint.count = projectWorkflows.length;
        
        for (const workflow of projectWorkflows) {
          const workflowDir = path.join(DATA_DIR, 'conjoint-workflows', workflow.id || `wf-${workflow.createdAt}`);
          const workflowSize = await getDirectorySize(workflowDir);
          storage.breakdown.conjoint.size += workflowSize;
        }

        // Calculate total size
        storage.totalSize = 
          storage.breakdown.transcripts.size +
          storage.breakdown.questionnaires.size +
          storage.breakdown.contentAnalysis.size +
          storage.breakdown.storytelling.size +
          storage.breakdown.dataTabulation.size +
          storage.breakdown.conjoint.size;

        return storage;
      })
    );

    // Calculate total storage across all projects
    const totalStorage = projectStorage.reduce((sum, p) => sum + p.totalSize, 0);

    // Calculate overall system storage
    const systemStorage = {
      totalDataDir: await getDirectorySize(DATA_DIR),
      uploadsDir: await getDirectorySize(FILES_DIR),
      questionnaireDataDir: await getDirectorySize(path.join(DATA_DIR, 'questionnaire-data')),
      discussionGuidesDir: await getDirectorySize(path.join(DATA_DIR, 'discussionGuides')),
      conjointWorkflowsDir: await getDirectorySize(path.join(DATA_DIR, 'conjoint-workflows')),
      dataTabulationsDir: await getDirectorySize(path.join(DATA_DIR, 'data-tabulations'))
    };

    res.json({
      projects: projectStorage.sort((a, b) => b.totalSize - a.totalSize), // Sort by size descending
      summary: {
        totalProjects: projectStorage.length,
        totalStorage,
        totalStorageFormatted: formatBytes(totalStorage),
        systemStorage,
        systemStorageFormatted: {
          totalDataDir: formatBytes(systemStorage.totalDataDir),
          uploadsDir: formatBytes(systemStorage.uploadsDir),
          questionnaireDataDir: formatBytes(systemStorage.questionnaireDataDir),
          discussionGuidesDir: formatBytes(systemStorage.discussionGuidesDir),
          conjointWorkflowsDir: formatBytes(systemStorage.conjointWorkflowsDir),
          dataTabulationsDir: formatBytes(systemStorage.dataTabulationsDir)
        }
      }
    });
  } catch (error) {
    console.error('Error calculating storage:', error);
    res.status(500).json({ error: 'Failed to calculate storage: ' + error.message });
  }
});

// GET /api/storage/system - Get overall system storage
router.get('/system', async (req, res) => {
  try {
    const systemStorage = {
      dataDir: await getDirectorySize(DATA_DIR),
      uploadsDir: await getDirectorySize(FILES_DIR),
      questionnaireDataDir: await getDirectorySize(path.join(DATA_DIR, 'questionnaire-data')),
      discussionGuidesDir: await getDirectorySize(path.join(DATA_DIR, 'discussionGuides')),
      conjointWorkflowsDir: await getDirectorySize(path.join(DATA_DIR, 'conjoint-workflows')),
      dataTabulationsDir: await getDirectorySize(path.join(DATA_DIR, 'data-tabulations'))
    };

    const total = Object.values(systemStorage).reduce((sum, size) => sum + size, 0);

    res.json({
      ...systemStorage,
      total,
      formatted: {
        dataDir: formatBytes(systemStorage.dataDir),
        uploadsDir: formatBytes(systemStorage.uploadsDir),
        questionnaireDataDir: formatBytes(systemStorage.questionnaireDataDir),
        discussionGuidesDir: formatBytes(systemStorage.discussionGuidesDir),
        conjointWorkflowsDir: formatBytes(systemStorage.conjointWorkflowsDir),
        dataTabulationsDir: formatBytes(systemStorage.dataTabulationsDir),
        total: formatBytes(total)
      }
    });
  } catch (error) {
    console.error('Error calculating system storage:', error);
    res.status(500).json({ error: 'Failed to calculate system storage: ' + error.message });
  }
});

export default router;

