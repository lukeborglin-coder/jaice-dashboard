import express from 'express';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import { execSync } from 'child_process';
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
      dataTabulationsDir: await getDirectorySize(path.join(DATA_DIR, 'data-tabulations')),
      transcriptsDir: await getDirectorySize(path.join(DATA_DIR, 'transcripts'))
    };
    
    // Calculate total system storage - use totalDataDir which includes ALL data
    // This ensures we count everything including tabs page data and any other directories
    // Note: We subtract uploadsDir if it's inside DATA_DIR to avoid double counting
    // But if FILES_DIR is separate, we add it
    const uploadsInDataDir = FILES_DIR.startsWith(DATA_DIR);
    systemStorage.totalSystemStorage = systemStorage.totalDataDir + (uploadsInDataDir ? 0 : systemStorage.uploadsDir);

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
          totalSystemStorage: formatBytes(systemStorage.totalSystemStorage),
          questionnaireDataDir: formatBytes(systemStorage.questionnaireDataDir),
          discussionGuidesDir: formatBytes(systemStorage.discussionGuidesDir),
          conjointWorkflowsDir: formatBytes(systemStorage.conjointWorkflowsDir),
          dataTabulationsDir: formatBytes(systemStorage.dataTabulationsDir),
          transcriptsDir: formatBytes(systemStorage.transcriptsDir)
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

// Helper function to recursively list all files in a directory
async function listAllFiles(dirPath, basePath = '') {
  const files = [];
  try {
    const entries = await fs.readdir(dirPath, { withFileTypes: true });
    
    for (const entry of entries) {
      const fullPath = path.join(dirPath, entry.name);
      const relativePath = path.join(basePath, entry.name);
      
      try {
        if (entry.isDirectory()) {
          // Recursively list files in subdirectories
          const subFiles = await listAllFiles(fullPath, relativePath);
          files.push(...subFiles);
        } else {
          const stats = await fs.stat(fullPath);
          files.push({
            path: relativePath,
            fullPath: fullPath,
            name: entry.name,
            size: stats.size,
            sizeFormatted: formatBytes(stats.size),
            modified: stats.mtime.toISOString(),
            type: path.extname(entry.name).toLowerCase() || 'no extension'
          });
        }
      } catch (err) {
        console.warn(`Could not access ${fullPath}:`, err.message);
      }
    }
  } catch (err) {
    // Directory doesn't exist or can't be accessed
  }
  
  return files;
}

// GET /api/storage/files - Get all uploaded files across all directories
router.get('/files', async (req, res) => {
  try {
    const directories = [
      { name: 'questionnaire-data', path: path.join(DATA_DIR, 'questionnaire-data'), category: 'Tabs Data' },
      { name: 'discussion-guides', path: path.join(DATA_DIR, 'discussionGuides'), category: 'Discussion Guides' },
      { name: 'data-tabulations', path: path.join(DATA_DIR, 'data-tabulations'), category: 'Data Tabulations' },
      { name: 'conjoint-workflows', path: path.join(DATA_DIR, 'conjoint-workflows'), category: 'Conjoint Workflows' },
      { name: 'transcripts', path: path.join(DATA_DIR, 'transcripts'), category: 'Transcripts' }
    ];

    const allFiles = [];
    
    // Load questionnaires.json to get QNR metadata (name, projectId)
    let questionnaires = {};
    try {
      const questionnairesPath = path.join(DATA_DIR, 'questionnaires.json');
      const questionnairesData = await fs.readFile(questionnairesPath, 'utf8');
      questionnaires = JSON.parse(questionnairesData);
    } catch (err) {
      // File doesn't exist or can't be read, that's fine
    }
    
    // Create a map of file paths to questionnaire info
    // Note: New QNR uploads no longer save filePath since files are deleted after parsing
    // This map is only for legacy QNR files that still have filePath saved
    const qnrFileMap = new Map();
    for (const projectId in questionnaires) {
      if (Array.isArray(questionnaires[projectId])) {
        for (const qnr of questionnaires[projectId]) {
          if (qnr.filePath) {
            // Normalize path for comparison
            const normalizedPath = path.normalize(qnr.filePath);
            qnrFileMap.set(normalizedPath, {
              name: qnr.name,
              projectId: qnr.projectId,
              questionnaireId: qnr.id,
              createdAt: qnr.createdAt
            });
          }
        }
      }
    }
    
    // Scan uploads directory and separate QNR files, transcript files, and general uploads
    try {
      const uploadsFiles = await listAllFiles(FILES_DIR, 'uploads');
      uploadsFiles.forEach(file => {
        // QNR files start with "questionnaire_" and are .docx files
        if (file.name.startsWith('questionnaire_') && (file.type === '.docx' || file.name.endsWith('.docx'))) {
          file.category = 'QNR Files';
          file.directory = 'uploads';
          
          // Try to find matching questionnaire info
          const normalizedFullPath = path.normalize(file.fullPath);
          const qnrInfo = qnrFileMap.get(normalizedFullPath);
          if (qnrInfo) {
            file.qnrName = qnrInfo.name;
            file.projectId = qnrInfo.projectId;
            file.questionnaireId = qnrInfo.questionnaireId;
            file.qnrCreatedAt = qnrInfo.createdAt;
          }
        } else if (file.name.startsWith('original_') || file.name.startsWith('cleaned_')) {
          // Transcript files: original_* or cleaned_*
          file.category = 'Transcripts';
          file.directory = 'uploads';
        } else {
          file.category = 'General Uploads';
          file.directory = 'uploads';
        }
      });
      allFiles.push(...uploadsFiles);
    } catch (err) {
      console.warn(`Could not list files in ${FILES_DIR}:`, err.message);
    }
    
    // Also scan the entire DATA_DIR for any other files/directories not in the list above
    // This ensures we catch all saved data
    try {
      const dataDirEntries = await fs.readdir(DATA_DIR, { withFileTypes: true });
      const scannedDirs = new Set(directories.map(d => path.basename(d.path)));
      scannedDirs.add('uploads'); // Don't scan uploads again
      
      for (const entry of dataDirEntries) {
        if (entry.isDirectory()) {
          const dirName = entry.name;
          // Skip directories we're already scanning explicitly
          if (!scannedDirs.has(dirName) && 
              dirName !== 'node_modules' && 
              dirName !== '.git' &&
              !dirName.startsWith('.')) {
            const dirPath = path.join(DATA_DIR, dirName);
            try {
              const files = await listAllFiles(dirPath, dirName);
              files.forEach(file => {
                file.category = 'Other Data';
                file.directory = dirName;
              });
              allFiles.push(...files);
            } catch (err) {
              console.warn(`Could not list files in ${dirPath}:`, err.message);
            }
          }
        } else if (entry.isFile() && entry.name.endsWith('.json')) {
          // Include JSON metadata files in the root data directory
          const filePath = path.join(DATA_DIR, entry.name);
          try {
            const stats = await fs.stat(filePath);
            allFiles.push({
              name: entry.name,
              path: entry.name,
              fullPath: filePath,
              size: stats.size,
              sizeFormatted: formatBytes(stats.size),
              modified: stats.mtime.toISOString(),
              type: 'json',
              category: 'Metadata Files',
              directory: 'root'
            });
          } catch (err) {
            console.warn(`Could not stat file ${filePath}:`, err.message);
          }
        }
      }
    } catch (err) {
      console.warn(`Could not scan DATA_DIR for additional files:`, err.message);
    }
    
    for (const dir of directories) {
      try {
        const files = await listAllFiles(dir.path, dir.name);
        files.forEach(file => {
          file.category = dir.category;
          file.directory = dir.name;
        });
        allFiles.push(...files);
      } catch (err) {
        console.warn(`Could not list files in ${dir.path}:`, err.message);
      }
    }

    // Load metadata files to check for orphaned files
    let transcripts = {};
    let savedAnalyses = [];
    let conjointWorkflows = [];
    let tabulations = {};
    
    try {
      const transcriptsPath = path.join(DATA_DIR, 'transcripts.json');
      const transcriptsData = await fs.readFile(transcriptsPath, 'utf8');
      transcripts = JSON.parse(transcriptsData);
    } catch (err) {
      // File doesn't exist or can't be read, that's fine
    }
    
    try {
      const savedAnalysesPath = path.join(DATA_DIR, 'savedAnalyses.json');
      const savedAnalysesData = await fs.readFile(savedAnalysesPath, 'utf8');
      savedAnalyses = JSON.parse(savedAnalysesData);
      if (!Array.isArray(savedAnalyses)) {
        savedAnalyses = Object.values(savedAnalyses);
      }
    } catch (err) {
      // File doesn't exist or can't be read, that's fine
    }
    
    try {
      const conjointWorkflowsPath = path.join(DATA_DIR, 'conjointWorkflows.json');
      const conjointWorkflowsData = await fs.readFile(conjointWorkflowsPath, 'utf8');
      conjointWorkflows = JSON.parse(conjointWorkflowsData);
      if (!Array.isArray(conjointWorkflows)) {
        conjointWorkflows = [];
      }
    } catch (err) {
      // File doesn't exist or can't be read, that's fine
    }
    
    try {
      const tabulationsPath = path.join(DATA_DIR, 'data-tabulations', 'saved-tabulations.json');
      const tabulationsData = await fs.readFile(tabulationsPath, 'utf8');
      tabulations = JSON.parse(tabulationsData);
    } catch (err) {
      // File doesn't exist or can't be read, that's fine
    }
    
    // Build sets of referenced file paths
    const referencedPaths = new Set();
    
    // Add transcript file paths
    for (const projectId in transcripts) {
      if (Array.isArray(transcripts[projectId])) {
        for (const transcript of transcripts[projectId]) {
          if (transcript.cleanedPath) {
            referencedPaths.add(path.normalize(transcript.cleanedPath));
          }
          if (transcript.originalPath) {
            referencedPaths.add(path.normalize(transcript.originalPath));
          }
        }
      }
    }
    
    // Add QNR file paths (legacy files only, new ones don't have filePath)
    for (const projectId in questionnaires) {
      if (Array.isArray(questionnaires[projectId])) {
        for (const qnr of questionnaires[projectId]) {
          if (qnr.filePath) {
            referencedPaths.add(path.normalize(qnr.filePath));
          }
          // Check for questionnaire data files
          if (qnr.id) {
            const qnrDataDir = path.join(DATA_DIR, 'questionnaire-data', qnr.id);
            try {
              const metadataPath = path.join(qnrDataDir, 'metadata.json');
              const metadataData = await fs.readFile(metadataPath, 'utf8');
              const metadata = JSON.parse(metadataData);
              if (metadata.dataFileName) {
                referencedPaths.add(path.normalize(path.join(qnrDataDir, metadata.dataFileName)));
              }
            } catch (e) {
              // No metadata file, that's fine
            }
          }
        }
      }
    }
    
    // Add discussion guide file paths
    for (const analysis of savedAnalyses) {
      if (analysis.projectId) {
        const guidePath = path.join(DATA_DIR, 'discussionGuides', `${analysis.projectId}.docx`);
        referencedPaths.add(path.normalize(guidePath));
      }
    }
    
    // Add conjoint workflow file paths
    for (const workflow of conjointWorkflows) {
      if (workflow.id && workflow.survey?.storedFileName) {
        const workflowPath = path.join(DATA_DIR, 'conjoint-workflows', workflow.id, workflow.survey.storedFileName);
        referencedPaths.add(path.normalize(workflowPath));
      }
    }
    
    // Add data tabulation file paths
    if (Array.isArray(tabulations)) {
      for (const tabulation of tabulations) {
        if (tabulation.filePath) {
          referencedPaths.add(path.normalize(path.join(DATA_DIR, 'data-tabulations', tabulation.filePath)));
        }
      }
    } else if (typeof tabulations === 'object') {
      for (const key in tabulations) {
        const tabulation = tabulations[key];
        if (tabulation && tabulation.filePath) {
          referencedPaths.add(path.normalize(path.join(DATA_DIR, 'data-tabulations', tabulation.filePath)));
        }
      }
    }
    
    // Mark files as orphaned if not referenced
    allFiles.forEach(file => {
      const normalizedPath = path.normalize(file.fullPath || path.join(DATA_DIR, file.path));
      
      // Metadata files are always considered active
      if (file.category === 'Metadata Files') {
        file.isOrphaned = false;
        return;
      }
      
      // Check if file is referenced in metadata
      file.isOrphaned = !referencedPaths.has(normalizedPath);
      
      // Special case: QNR files - new uploads don't save filePath, so they're considered orphaned
      // (since they're deleted after parsing anyway)
      if (file.category === 'QNR Files' && file.name.startsWith('questionnaire_')) {
        // If it's not in the qnrFileMap, it's orphaned (legacy file not in metadata)
        const normalizedFullPath = path.normalize(file.fullPath);
        file.isOrphaned = !qnrFileMap.has(normalizedFullPath);
      }
      
      // Special case: original_ transcript files are always orphaned now (we don't save them)
      if (file.name.startsWith('original_')) {
        file.isOrphaned = true;
      }
    });

    // Sort by modified date (newest first)
    allFiles.sort((a, b) => new Date(b.modified) - new Date(a.modified));

    res.json({ files: allFiles, total: allFiles.length });
  } catch (error) {
    console.error('Error listing files:', error);
    res.status(500).json({ error: 'Failed to list files: ' + error.message });
  }
});

// DELETE /api/storage/orphaned - Delete all orphaned files
router.delete('/orphaned', async (req, res) => {
  try {
    // Reuse the same file listing and orphan detection logic from GET /files
    const directories = [
      { name: 'questionnaire-data', path: path.join(DATA_DIR, 'questionnaire-data'), category: 'Tabs Data' },
      { name: 'discussion-guides', path: path.join(DATA_DIR, 'discussionGuides'), category: 'Discussion Guides' },
      { name: 'data-tabulations', path: path.join(DATA_DIR, 'data-tabulations'), category: 'Data Tabulations' },
      { name: 'conjoint-workflows', path: path.join(DATA_DIR, 'conjoint-workflows'), category: 'Conjoint Workflows' },
      { name: 'transcripts', path: path.join(DATA_DIR, 'transcripts'), category: 'Transcripts' }
    ];

    const allFiles = [];
    
    // Load all metadata files (same as in GET /files)
    let questionnaires = {};
    let transcripts = {};
    let savedAnalyses = [];
    let conjointWorkflows = [];
    let tabulations = {};
    
    try {
      const questionnairesPath = path.join(DATA_DIR, 'questionnaires.json');
      const questionnairesData = await fs.readFile(questionnairesPath, 'utf8');
      questionnaires = JSON.parse(questionnairesData);
    } catch (err) {}
    
    try {
      const transcriptsPath = path.join(DATA_DIR, 'transcripts.json');
      const transcriptsData = await fs.readFile(transcriptsPath, 'utf8');
      transcripts = JSON.parse(transcriptsData);
    } catch (err) {}
    
    try {
      const savedAnalysesPath = path.join(DATA_DIR, 'savedAnalyses.json');
      const savedAnalysesData = await fs.readFile(savedAnalysesPath, 'utf8');
      savedAnalyses = JSON.parse(savedAnalysesData);
      if (!Array.isArray(savedAnalyses)) {
        savedAnalyses = Object.values(savedAnalyses);
      }
    } catch (err) {}
    
    try {
      const conjointWorkflowsPath = path.join(DATA_DIR, 'conjointWorkflows.json');
      const conjointWorkflowsData = await fs.readFile(conjointWorkflowsPath, 'utf8');
      conjointWorkflows = JSON.parse(conjointWorkflowsData);
      if (!Array.isArray(conjointWorkflows)) {
        conjointWorkflows = [];
      }
    } catch (err) {}
    
    try {
      const tabulationsPath = path.join(DATA_DIR, 'data-tabulations', 'saved-tabulations.json');
      const tabulationsData = await fs.readFile(tabulationsPath, 'utf8');
      tabulations = JSON.parse(tabulationsData);
    } catch (err) {}
    
    // Build referenced paths set (same logic as GET /files)
    const referencedPaths = new Set();
    
    for (const projectId in transcripts) {
      if (Array.isArray(transcripts[projectId])) {
        for (const transcript of transcripts[projectId]) {
          if (transcript.cleanedPath) referencedPaths.add(path.normalize(transcript.cleanedPath));
          if (transcript.originalPath) referencedPaths.add(path.normalize(transcript.originalPath));
        }
      }
    }
    
    const qnrFileMap = new Map();
    for (const projectId in questionnaires) {
      if (Array.isArray(questionnaires[projectId])) {
        for (const qnr of questionnaires[projectId]) {
          if (qnr.filePath) {
            referencedPaths.add(path.normalize(qnr.filePath));
          }
          if (qnr.id) {
            const qnrDataDir = path.join(DATA_DIR, 'questionnaire-data', qnr.id);
            try {
              const metadataPath = path.join(qnrDataDir, 'metadata.json');
              const metadataData = await fs.readFile(metadataPath, 'utf8');
              const metadata = JSON.parse(metadataData);
              if (metadata.dataFileName) {
                referencedPaths.add(path.normalize(path.join(qnrDataDir, metadata.dataFileName)));
              }
            } catch (e) {}
          }
        }
      }
    }
    
    for (const analysis of savedAnalyses) {
      if (analysis.projectId) {
        const guidePath = path.join(DATA_DIR, 'discussionGuides', `${analysis.projectId}.docx`);
        referencedPaths.add(path.normalize(guidePath));
      }
    }
    
    for (const workflow of conjointWorkflows) {
      if (workflow.id && workflow.survey?.storedFileName) {
        const workflowPath = path.join(DATA_DIR, 'conjoint-workflows', workflow.id, workflow.survey.storedFileName);
        referencedPaths.add(path.normalize(workflowPath));
      }
    }
    
    if (Array.isArray(tabulations)) {
      for (const tabulation of tabulations) {
        if (tabulation.filePath) {
          referencedPaths.add(path.normalize(path.join(DATA_DIR, 'data-tabulations', tabulation.filePath)));
        }
      }
    } else if (typeof tabulations === 'object') {
      for (const key in tabulations) {
        const tabulation = tabulations[key];
        if (tabulation && tabulation.filePath) {
          referencedPaths.add(path.normalize(path.join(DATA_DIR, 'data-tabulations', tabulation.filePath)));
        }
      }
    }
    
    // Scan uploads directory
    try {
      const uploadsFiles = await listAllFiles(FILES_DIR, 'uploads');
      uploadsFiles.forEach(file => {
        if (file.name.startsWith('questionnaire_') && (file.type === '.docx' || file.name.endsWith('.docx'))) {
          file.category = 'QNR Files';
        } else if (file.name.startsWith('original_') || file.name.startsWith('cleaned_')) {
          file.category = 'Transcripts';
        } else {
          file.category = 'General Uploads';
        }
      });
      allFiles.push(...uploadsFiles);
    } catch (err) {}
    
    // Scan other directories
    for (const dir of directories) {
      try {
        const files = await listAllFiles(dir.path, dir.name);
        files.forEach(file => {
          file.category = dir.category;
        });
        allFiles.push(...files);
      } catch (err) {}
    }
    
    // Find orphaned files
    const orphanedFiles = [];
    for (const file of allFiles) {
      const normalizedPath = path.normalize(file.fullPath || path.join(DATA_DIR, file.path));
      
      if (file.category === 'Metadata Files') {
        continue; // Skip metadata files
      }
      
      let isOrphaned = !referencedPaths.has(normalizedPath);
      
      if (file.category === 'QNR Files' && file.name.startsWith('questionnaire_')) {
        isOrphaned = !qnrFileMap.has(normalizedPath);
      }
      
      if (file.name.startsWith('original_')) {
        isOrphaned = true;
      }
      
      if (isOrphaned) {
        orphanedFiles.push(file);
      }
    }
    
    // Delete all orphaned files
    let deletedCount = 0;
    let deletedSize = 0;
    const errors = [];
    
    for (const file of orphanedFiles) {
      try {
        const filePath = file.fullPath || path.join(DATA_DIR, file.path);
        const stats = await fs.stat(filePath);
        await fs.unlink(filePath);
        deletedCount++;
        deletedSize += stats.size;
        console.log(`Deleted orphaned file: ${filePath}`);
      } catch (error) {
        errors.push({ file: file.name, error: error.message });
        console.error(`Failed to delete orphaned file ${file.name}:`, error);
      }
    }
    
    res.json({
      success: true,
      deletedCount,
      deletedSize,
      deletedSizeFormatted: formatBytes(deletedSize),
      errors: errors.length > 0 ? errors : undefined
    });
  } catch (error) {
    console.error('Error deleting orphaned files:', error);
    res.status(500).json({ error: 'Failed to delete orphaned files: ' + error.message });
  }
});

// GET /api/storage/disk-info - Get disk space information
router.get('/disk-info', async (req, res) => {
  try {
    const platform = os.platform();
    
    let totalSpace = 0;
    let freeSpace = 0;
    let usedSpace = 0;
    
    // Always use df command for production servers (Linux/Unix)
    // This will work on production servers where the live site is running
    // For Windows development, it will try df first, then fall back to Windows methods
    try {
      // Use df command - works on Linux/Unix (production) and may work on Windows with WSL/Git Bash
      // On Render, persistent disks are mounted at /opt/render/project/src/data or similar
      // We check the disk where DATA_DIR is located
      const dfOutput = execSync(`df -k "${DATA_DIR}"`, { encoding: 'utf8' });
      console.log(`[Disk Info] Checking disk space for: ${DATA_DIR}`);
      const lines = dfOutput.trim().split('\n');
      if (lines.length > 1) {
        // Find the line that matches our DATA_DIR path
        // df output format: Filesystem 1K-blocks Used Available Use% Mounted on
        for (let i = 1; i < lines.length; i++) {
          const parts = lines[i].split(/\s+/).filter(p => p.length > 0);
          if (parts.length >= 6) {
            // Check if this line's mount point matches or contains our DATA_DIR
            const mountPoint = parts[5];
            if (DATA_DIR.startsWith(mountPoint) || mountPoint === DATA_DIR) {
              const totalKB = parseInt(parts[1]) * 1024;
              const usedKB = parseInt(parts[2]) * 1024;
              const availableKB = parseInt(parts[3]) * 1024;
              
              totalSpace = totalKB;
              usedSpace = usedKB;
              freeSpace = availableKB;
              break;
            }
          }
        }
        
        // If we didn't find a match, use the first data line (most common case)
        if (totalSpace === 0 && lines.length > 1) {
          const parts = lines[1].split(/\s+/).filter(p => p.length > 0);
          if (parts.length >= 4) {
            const totalKB = parseInt(parts[1]) * 1024;
            const usedKB = parseInt(parts[2]) * 1024;
            const availableKB = parseInt(parts[3]) * 1024;
            
            totalSpace = totalKB;
            usedSpace = usedKB;
            freeSpace = availableKB;
          }
        }
      }
    } catch (dfError) {
      // df command failed, try platform-specific methods
      if (platform === 'win32') {
        // On Windows (local development), use PowerShell or wmic
        try {
          const driveLetter = path.parse(DATA_DIR).root.replace('\\', '');
          
          // Try PowerShell first
          const psCommand = `Get-PSDrive -PSProvider FileSystem | Where-Object { $_.Root -eq '${driveLetter}' } | Select-Object -Property Used,Free | ConvertTo-Json`;
          const psOutput = execSync(`powershell -Command "${psCommand}"`, { encoding: 'utf8' });
          
          try {
            const diskInfo = JSON.parse(psOutput);
            if (diskInfo && typeof diskInfo.Used === 'number' && typeof diskInfo.Free === 'number') {
              usedSpace = diskInfo.Used;
              freeSpace = diskInfo.Free;
              totalSpace = usedSpace + freeSpace;
            } else {
              throw new Error('Invalid PowerShell output format');
            }
          } catch (parseError) {
            // Try wmic as fallback
            const wmicCommand = `wmic logicaldisk where "DeviceID='${driveLetter.replace(':', '')}'" get Size,FreeSpace /format:list`;
            const wmicOutput = execSync(wmicCommand, { encoding: 'utf8' });
            const sizeMatch = wmicOutput.match(/Size=(\d+)/);
            const freeMatch = wmicOutput.match(/FreeSpace=(\d+)/);
            
            if (sizeMatch && freeMatch) {
              totalSpace = parseInt(sizeMatch[1]);
              freeSpace = parseInt(freeMatch[1]);
              usedSpace = totalSpace - freeSpace;
            } else {
              throw new Error('Could not parse wmic output');
            }
          }
        } catch (winError) {
          console.warn('Could not get disk space info on Windows:', winError);
          // Final fallback: show used space only
          const usedSpaceBytes = await getDirectorySize(DATA_DIR);
          usedSpace = usedSpaceBytes;
          totalSpace = usedSpace * 10; // Placeholder
          freeSpace = totalSpace - usedSpace;
        }
      } else {
        // Unix-like system but df failed - this shouldn't happen, but handle it
        console.warn('df command failed on Unix-like system:', dfError);
        const usedSpaceBytes = await getDirectorySize(DATA_DIR);
        usedSpace = usedSpaceBytes;
        totalSpace = usedSpace * 10; // Placeholder
        freeSpace = totalSpace - usedSpace;
      }
    }
    
    res.json({
      total: totalSpace,
      used: usedSpace,
      free: freeSpace,
      formatted: {
        total: formatBytes(totalSpace),
        used: formatBytes(usedSpace),
        free: formatBytes(freeSpace)
      },
      percentageUsed: totalSpace > 0 ? ((usedSpace / totalSpace) * 100).toFixed(1) : '0.0'
    });
  } catch (error) {
    console.error('Error getting disk info:', error);
    res.status(500).json({ error: 'Failed to get disk info: ' + error.message });
  }
});

// DELETE /api/storage/files - Delete a file and optionally its metadata
router.delete('/files', async (req, res) => {
  try {
    const { filePath, deleteMetadata } = req.body;
    
    if (!filePath) {
      return res.status(400).json({ error: 'File path is required' });
    }

    // Construct full path
    let fullPath;
    if (path.isAbsolute(filePath)) {
      fullPath = filePath;
    } else {
      // Try to find the file in known directories
      const possiblePaths = [
        path.join(FILES_DIR, filePath),
        path.join(DATA_DIR, filePath),
        path.join(DATA_DIR, 'questionnaire-data', filePath),
        path.join(DATA_DIR, 'discussionGuides', filePath),
        path.join(DATA_DIR, 'data-tabulations', filePath),
        path.join(DATA_DIR, 'conjoint-workflows', filePath),
        path.join(DATA_DIR, 'transcripts', filePath)
      ];
      
      fullPath = null;
      for (const possiblePath of possiblePaths) {
        try {
          await fs.access(possiblePath);
          fullPath = possiblePath;
          break;
        } catch (e) {
          // File doesn't exist at this path, try next
        }
      }
      
      if (!fullPath) {
        return res.status(404).json({ error: 'File not found' });
      }
    }

    // Verify file exists
    try {
      await fs.access(fullPath);
    } catch (e) {
      return res.status(404).json({ error: 'File not found' });
    }

    // Delete the file
    await fs.unlink(fullPath);
    console.log(`Deleted file: ${fullPath}`);

    // If deleteMetadata is true, try to remove references from metadata files
    if (deleteMetadata) {
      try {
        // Check if it's a tabulation file
        if (filePath.includes('data-tabulations')) {
          const tabulationsPath = path.join(DATA_DIR, 'data-tabulations', 'saved-tabulations.json');
          try {
            const tabulationsData = await fs.readFile(tabulationsPath, 'utf8');
            let tabulations = JSON.parse(tabulationsData);
            if (!Array.isArray(tabulations)) {
              tabulations = Object.values(tabulations);
            }
            
            // Remove tabulations that reference this file
            const fileName = path.basename(filePath);
            const filtered = tabulations.filter(t => {
              // Check if tabulation references this file
              const tabStr = JSON.stringify(t);
              return !tabStr.includes(fileName);
            });
            
            if (filtered.length !== tabulations.length) {
              await fs.writeFile(tabulationsPath, JSON.stringify(filtered, null, 2));
              console.log(`Removed ${tabulations.length - filtered.length} tabulation metadata entries`);
            }
          } catch (e) {
            // Tabulations file doesn't exist or can't be read, that's okay
          }
        }

        // Check if it's a transcript file
        if (filePath.includes('uploads') && (filePath.includes('cleaned_') || filePath.includes('transcript'))) {
          const transcriptsPath = path.join(DATA_DIR, 'transcripts.json');
          try {
            const transcriptsData = await fs.readFile(transcriptsPath, 'utf8');
            const transcripts = JSON.parse(transcriptsData);
            const fileName = path.basename(filePath);
            
            // Remove transcript entries that reference this file
            for (const projectId in transcripts) {
              if (Array.isArray(transcripts[projectId])) {
                transcripts[projectId] = transcripts[projectId].filter(t => {
                  const originalPath = t.originalPath || '';
                  const cleanedPath = t.cleanedPath || '';
                  return !originalPath.includes(fileName) && !cleanedPath.includes(fileName);
                });
              }
            }
            
            await fs.writeFile(transcriptsPath, JSON.stringify(transcripts, null, 2));
            console.log('Updated transcripts.json to remove deleted file references');
          } catch (e) {
            // Transcripts file doesn't exist or can't be read, that's okay
          }
        }

        // Check if it's a questionnaire data file
        if (filePath.includes('questionnaire-data')) {
          const questionnairesPath = path.join(DATA_DIR, 'questionnaires.json');
          try {
            const questionnairesData = await fs.readFile(questionnairesPath, 'utf8');
            const questionnaires = JSON.parse(questionnairesData);
            const fileName = path.basename(filePath);
            
            // Find and update questionnaire metadata
            for (const projectId in questionnaires) {
              if (Array.isArray(questionnaires[projectId])) {
                for (const qnr of questionnaires[projectId]) {
                  if (qnr.filePath && qnr.filePath.includes(fileName)) {
                    delete qnr.filePath;
                  }
                  
                  // Check questionnaire data directory metadata
                  const qnrDataDir = path.join(DATA_DIR, 'questionnaire-data', qnr.id);
                  const metadataPath = path.join(qnrDataDir, 'metadata.json');
                  try {
                    const metadataData = await fs.readFile(metadataPath, 'utf8');
                    const metadata = JSON.parse(metadataData);
                    if (metadata.dataFileName === fileName) {
                      delete metadata.dataFileName;
                      delete metadata.originalFileName;
                      await fs.writeFile(metadataPath, JSON.stringify(metadata, null, 2));
                    }
                  } catch (e) {
                    // Metadata file doesn't exist, that's okay
                  }
                }
              }
            }
            
            await fs.writeFile(questionnairesPath, JSON.stringify(questionnaires, null, 2));
            console.log('Updated questionnaires.json to remove deleted file references');
          } catch (e) {
            // Questionnaires file doesn't exist or can't be read, that's okay
          }
        }
      } catch (e) {
        console.warn('Error cleaning up metadata:', e.message);
        // Continue even if metadata cleanup fails
      }
    }

    res.json({ success: true, message: 'File deleted successfully' });
  } catch (error) {
    console.error('Error deleting file:', error);
    res.status(500).json({ error: 'Failed to delete file: ' + error.message });
  }
});

export default router;

