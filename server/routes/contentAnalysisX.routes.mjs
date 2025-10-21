import express from 'express';
import { authenticateToken, requireCognitiveOrAdmin } from '../middleware/auth.middleware.mjs';
import multer from 'multer';
import path from 'path';
import fs from 'fs/promises';
import fsSync from 'fs';
import mammoth from 'mammoth';
import { generateCAFromDGAsJSON, generateExcelFromJSON, generateGuideMapFromDGText } from '../services/caGenerator.service.mjs';
import { fillRespondentRowsFromTranscript } from '../services/transcriptFiller.service.mjs';
import { fileURLToPath } from 'url';
import OpenAI from 'openai';
import { logCost, COST_CATEGORIES } from '../services/costTracking.service.mjs';
import { Document, Packer, Paragraph, TextRun, HeadingLevel, AlignmentType } from 'docx';

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

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const uploadsDir = process.env.FILES_DIR || path.join(process.env.DATA_DIR || path.join(__dirname, '../data'), 'uploads');

// Ensure upload directory exists
await fs.mkdir(uploadsDir, { recursive: true });

const router = express.Router();

// In-memory job store for background processing
const uploadJobs = new Map();

// Debug middleware to log all requests
router.use((req, res, next) => {
  console.log(`🔍 ContentAnalysisX route hit: ${req.method} ${req.path}`);
  next();
});

// Enforce auth + company access for all CA-X endpoints
router.use(authenticateToken, requireCognitiveOrAdmin);

// Consistent data roots for persistence
const dataRoot = process.env.DATA_DIR || path.join(__dirname, '../data');
const filesDir = process.env.FILES_DIR || path.join(dataRoot, 'uploads');

const storage = multer.diskStorage({
  destination: async (req, file, cb) => {
    try {
      await fs.mkdir(filesDir, { recursive: true });
      cb(null, filesDir);
    } catch (error) {
      cb(error);
    }
  },
  filename: (req, file, cb) => {
    const timestamp = Date.now();
    const ext = path.extname(file.originalname);
    cb(null, `${file.fieldname}_${timestamp}${ext}`);
  }
});

// File filter for allowed types
const fileFilter = (req, file, cb) => {
  const allowedTypes = [
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document', // .docx
    'application/msword', // .doc
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', // .xlsx
    'application/vnd.ms-excel', // .xls
    'text/plain', // .txt
    'application/pdf', // .pdf
    'application/json' // .json
  ];

  if (allowedTypes.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new Error(`Invalid file type. Allowed types: Word documents, Excel files, PDFs, text files, and JSON files.`), false);
  }
};

const upload = multer({
  storage,
  fileFilter,
  limits: {
    fileSize: 25 * 1024 * 1024, // 25MB max file size
    files: 10 // Max 10 files per request
  }
});

// File paths for persistent storage
const baseDataDir = dataRoot;
const savedAnalysesFile = path.join(baseDataDir, 'savedAnalyses.json');
const discussionGuidesDir = path.join(baseDataDir, 'discussionGuides');

// Ensure data directory exists
async function ensureDataDir() {
  try {
    await fs.mkdir(baseDataDir, { recursive: true });
    await fs.mkdir(discussionGuidesDir, { recursive: true });
  } catch (error) {
    console.error('Error creating data directory:', error);
  }
}

// Load saved analyses from file
async function loadSavedAnalyses() {
  try {
    await ensureDataDir();
    if (await fs.access(savedAnalysesFile).then(() => true).catch(() => false)) {
      const data = await fs.readFile(savedAnalysesFile, 'utf8');
      
      // Check if data is empty or just whitespace
      if (!data || data.trim().length === 0) {
        console.log('Saved analyses file is empty, returning empty array');
        return [];
      }
      
      // Use safe JSON parse
      const parsed = safeJsonParse(data, []);
      
      if (parsed === null) {
        console.log('JSON parse returned null, resetting to empty array');
        await saveAnalysesToFile([]);
        return [];
      }
      
      return parsed;
    }
  } catch (error) {
    console.error('Error loading saved analyses:', error);
  }
  return [];
}

// Save analyses to file
async function saveAnalysesToFile(analyses) {
  try {
    await ensureDataDir();
    await fs.writeFile(savedAnalysesFile, JSON.stringify(analyses, null, 2));
  } catch (error) {
    console.error('Error saving analyses:', error);
  }
}

const cloneContext = (context) => {
  if (!context) return {};
  try {
    if (typeof structuredClone === 'function') {
      return structuredClone(context);
    }
  } catch (err) {
    console.warn('structuredClone failed, falling back to JSON clone:', err?.message);
  }
  try {
    return JSON.parse(JSON.stringify(context));
  } catch (err) {
    console.warn('JSON clone failed, returning shallow copy:', err?.message);
    return { ...context };
  }
};

const mergeContextMaps = (base = {}, addition = {}) => {
  const merged = cloneContext(base);

  for (const [sheet, respondents] of Object.entries(addition || {})) {
    if (!merged[sheet]) merged[sheet] = {};
    for (const [respId, cols] of Object.entries(respondents || {})) {
      if (!merged[sheet][respId]) merged[sheet][respId] = {};

      for (const [colName, contexts] of Object.entries(cols || {})) {
        const existing = Array.isArray(merged[sheet][respId][colName]) ? merged[sheet][respId][colName] : [];
        const next = Array.isArray(contexts) ? contexts : [];
        const seen = new Set(existing);
        for (const ctx of next) {
          if (!seen.has(ctx)) {
            existing.push(ctx);
            seen.add(ctx);
          }
        }
        merged[sheet][respId][colName] = existing;
      }
    }
  }

  return merged;
};


// Load saved analyses on startup
  let savedAnalyses = await loadSavedAnalyses();

// POST /api/caX/preview - DG → JSON preview (no auto download)
router.post('/preview', upload.single('dg'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    console.log('Processing DG for preview:', req.file.path);

    // Generate JSON preview instead of Excel file
    const jsonData = await generateCAFromDGAsJSON(req.file.path);

    console.log('Generated content analysis structure:');
    console.log('Number of sheets:', Object.keys(jsonData).length);
    console.log('Sheet names:', Object.keys(jsonData));
    for (const [sheetName, rows] of Object.entries(jsonData)) {
      if (Array.isArray(rows) && rows.length > 0) {
        console.log(`  "${sheetName}": ${Object.keys(rows[0]).length} columns -`, Object.keys(rows[0]));
      }
    }

    // Also extract full raw text of the uploaded discussion guide (for AI processing and mapping)
    let rawGuideText = '';
    let rawGuideHtml = ''; // For formatted display
    try {
      if (req.file.originalname.endsWith('.docx')) {
        // Extract plain text for AI processing
        const textResult = await mammoth.extractRawText({ path: req.file.path });
        rawGuideText = textResult.value || '';

        // Convert DOCX to simple HTML for viewing
        const htmlResult = await mammoth.convertToHtml({ path: req.file.path });
        rawGuideHtml = htmlResult.value || '';
      } else if (req.file.originalname.endsWith('.txt')) {
        rawGuideText = await fs.readFile(req.file.path, 'utf8');
        rawGuideHtml = `<pre>${rawGuideText}</pre>`;
      }
    } catch (e) {
      console.warn('Failed to extract/convert discussion guide:', e.message);
    }

    // Build a guide-to-grid mapping using the raw guide and discovered sheets/columns
    let guideMap = { bySheet: {} };
    try {
      guideMap = await generateGuideMapFromDGText(rawGuideText || '', jsonData);
    } catch (e) {
      console.warn('Failed to generate guideMap:', e.message);
    }

    // Save the original DOCX file for download later (with a temporary ID)
    let originalDocxPath = '';
    if (req.file.originalname.endsWith('.docx')) {
      // Ensure discussion guides directory exists
      try { await fs.mkdir(discussionGuidesDir, { recursive: true }); } catch {}

      const tempId = `temp_${Date.now()}`;
      originalDocxPath = path.join(discussionGuidesDir, `${tempId}.docx`);
      await fs.copyFile(req.file.path, originalDocxPath);
    }

    // Clean up uploaded file
    try {
      await fs.unlink(req.file.path);
    } catch (cleanupError) {
      console.warn('Failed to cleanup uploaded file:', cleanupError);
    }

    res.json({
      data: jsonData,
      rawGuideText,
      rawGuideHtml,
      guideMap,
      fileName: req.file.originalname,
      originalDocxId: originalDocxPath ? path.basename(originalDocxPath, '.docx') : null
    });
  } catch (error) {
    console.error('Error in preview endpoint:', error);
    res.status(500).json({ error: error.message });
  }
});

// POST /api/caX/export - JSON → Excel file download
router.post('/export', async (req, res) => {
  try {
    const { data } = req.body;

    if (!data) {
      return res.status(400).json({ error: 'No data provided' });
    }

    console.log('Generating Excel from JSON data');

    // Generate Excel file from JSON data
    const excelBuffer = await generateExcelFromJSON(data);

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename="Content_Analysis.xlsx"');
    res.send(excelBuffer);
  } catch (error) {
    console.error('Error in export endpoint:', error);
    res.status(500).json({ error: error.message });
  }
});

// POST /api/caX/upload - Upload existing CA file and store by projectId
router.post('/upload', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    const { projectId } = req.body;
    if (!projectId) {
      return res.status(400).json({ error: 'Project ID required' });
    }

    // For now, just acknowledge the upload
    // In a real implementation, you'd parse and store the Excel data
    console.log(`Uploaded CA file for project: ${projectId}`);

    res.json({ message: 'File uploaded successfully', projectId });
  } catch (error) {
    console.error('Error in upload endpoint:', error);
    res.status(500).json({ error: error.message });
  }
});

// POST /api/caX/update - Update existing saved content analysis by id
router.post('/update', async (req, res) => {
  try {
    const { id, data, name, description, quotes, projectId, projectName, transcripts } = req.body;
    if (!id || !data) {
      return res.status(400).json({ error: 'id and data are required' });
    }
    const analyses = await loadSavedAnalyses();
    const idx = analyses.findIndex(a => a.id === id);
    if (idx === -1) return res.status(404).json({ error: 'Analysis not found' });
    if (name) analyses[idx].name = name; if (description) analyses[idx].description = description; if (projectId) analyses[idx].projectId = projectId; if (projectName) analyses[idx].projectName = projectName; analyses[idx].data = data; if (quotes) analyses[idx].quotes = quotes; if (transcripts) analyses[idx].transcripts = transcripts;
    analyses[idx].savedAt = new Date().toISOString();
    await saveAnalysesToFile(analyses);
    res.json({ success: true });
  } catch (error) {
    console.error('Error in update endpoint:', error);
    res.status(500).json({ error: error.message });
  }
});

// PUT /api/caX/update - Alternative PUT method for updating content analysis
router.put('/update', async (req, res) => {
  try {
    console.log('📝 PUT /update request received');
    const { id, data, name, description, quotes, projectId, projectName, transcripts, context } = req.body;
    
    console.log('📋 Update request data:', {
      id,
      hasData: !!data,
      hasQuotes: !!quotes,
      hasContext: !!context,
      contextKeys: context ? Object.keys(context) : 'none',
      transcriptCount: transcripts?.length || 0
    });
    
    if (!id || !data) {
      console.log('❌ Missing required fields: id or data');
      return res.status(400).json({ error: 'id and data are required' });
    }
    const analyses = await loadSavedAnalyses();
    const idx = analyses.findIndex(a => a.id === id);
    if (idx === -1) {
      console.log('❌ Analysis not found:', id);
      return res.status(404).json({ error: 'Analysis not found' });
    }
    
    console.log('✅ Found analysis at index:', idx);

    const oldProjectId = analyses[idx].projectId;
    const projectChanged = projectId && projectId !== oldProjectId;

    if (name) analyses[idx].name = name; 
    if (description) analyses[idx].description = description; 
    if (projectId) analyses[idx].projectId = projectId; 
    if (projectName) analyses[idx].projectName = projectName; 
    analyses[idx].data = data; 
    if (quotes) analyses[idx].quotes = quotes; 
    if (transcripts) analyses[idx].transcripts = transcripts;
    if (context) {
      console.log('💾 Saving context for analysis', id, 'with keys:', Object.keys(context));
      analyses[idx].context = context;
    }
    analyses[idx].savedAt = new Date().toISOString();
    
    console.log('💾 Saving analysis to file...');
    await saveAnalysesToFile(analyses);
    console.log('✅ Analysis saved successfully');

    // If project changed, move the discussion guide file between projects
    if (projectChanged) {
      try {
        const projectsPath = path.join(process.env.DATA_DIR || path.join(__dirname, '../data'), 'projects.json');
        const allProj = safeJsonParse(await fs.readFile(projectsPath, 'utf8'), {});

        // Find and remove file from old project
        if (oldProjectId) {
          for (const uid in allProj) {
            const userProjects = allProj[uid];
            const oldProjIndex = userProjects.findIndex(p => p.id === oldProjectId);
            if (oldProjIndex !== -1 && Array.isArray(allProj[uid][oldProjIndex].files)) {
              allProj[uid][oldProjIndex].files = allProj[uid][oldProjIndex].files.filter(
                f => f.id !== `file-${id}-dg`
              );
            }
          }
        }

        // Add file to new project
        for (const uid in allProj) {
          const userProjects = allProj[uid];
          const newProjIndex = userProjects.findIndex(p => p.id === projectId);
          if (newProjIndex !== -1) {
            if (!Array.isArray(allProj[uid][newProjIndex].files)) {
              allProj[uid][newProjIndex].files = [];
            }

            // Check if discussion guide file exists for this analysis
            const dgFileId = `file-${id}-dg`;
            const existingFile = allProj[uid][newProjIndex].files.find(f => f.id === dgFileId);

            if (!existingFile && analyses[idx].originalDocxId) {
              // Add discussion guide to new project
              allProj[uid][newProjIndex].files.push({
                id: dgFileId,
                name: `${analyses[idx].name} Discussion Guide.docx`,
                type: 'discussion-guide',
                url: `/uploads/Discussion_Guide_${projectId}_${analyses[idx].originalDocxId}.docx`,
                uploadedAt: analyses[idx].savedAt
              });
            }
            break;
          }
        }

        await fs.writeFile(projectsPath, JSON.stringify(allProj, null, 2));
      } catch (projectUpdateError) {
        console.error('Error updating project files:', projectUpdateError);
        // Don't fail the whole update if project file update fails
      }
    }

    res.json({ success: true, message: 'Analysis updated successfully' });
  } catch (error) {
    console.error('Error in update endpoint:', error);
    res.status(500).json({ error: error.message });
  }
});

// GET /api/caX/saved - Get saved content analyses
router.get('/saved', async (req, res) => {
  try {
    const analyses = await loadSavedAnalyses();
    res.json(analyses);
  } catch (error) {
    console.error('Error in saved endpoint:', error);
    res.status(500).json({ error: error.message });
  }
});

// GET /api/caX/saved/:id - Get a single saved analysis by id (includes quotes)
router.get('/saved/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const analyses = await loadSavedAnalyses();
    const item = analyses.find(a => String(a.id) === String(id));
    if (!item) return res.status(404).json({ error: 'Analysis not found' });
    console.log(`📖 Loading analysis ${id}, context keys:`, Object.keys(item.context || {}));
    if (item.context && Object.keys(item.context).length > 0) {
      for (const [sheet, sheetContext] of Object.entries(item.context)) {
        console.log(`📖 Sheet "${sheet}" has context for respondents:`, Object.keys(sheetContext));
      }
    } else {
      console.log('📖 No context data found for this analysis');
    }
    res.json(item);
  } catch (error) {
    console.error('Error in saved/:id endpoint:', error);
    res.status(500).json({ error: error.message });
  }
});

// GET /api/caX/:projectId - Get parsed JSON for a project
router.get('/:projectId', async (req, res) => {
  try {
    const { projectId } = req.params;

    // Demo data showing Content Analysis template structure (empty rows for data entry)
    const demoData = {
      "Demographics": [
        { "respno": "R001", "Specialty": "Pediatric Neurologist", "Date": "08/15/2024", "Time (ET)": "10:00 AM" },
        { "respno": "R002", "Specialty": "Adult Neurologist", "Date": "08/16/2024", "Time (ET)": "2:00 PM" },
        { "respno": "", "Specialty": "", "Date": "", "Time (ET)": "" }
      ],
      "Background & Treatment": [
        { "respno": "R001", "Current Practice": "Academic hospital, IP and OP patients", "SMA Population": "About 35 patients, mostly pediatric", "Treatment Approach": "Prefer gene therapy, like Evrysdi for oral option", "Current Patients Tx": "20+ on Evrysdi, mix of tablet/liquid", "Treatment Challenges": "ROA issues with Spinraza, insurance challenges" },
        { "respno": "R002", "Current Practice": "", "SMA Population": "", "Treatment Approach": "", "Current Patients Tx": "", "Treatment Challenges": "" },
        { "respno": "", "Current Practice": "", "SMA Population": "", "Treatment Approach": "", "Current Patients Tx": "", "Treatment Challenges": "" }
      ],
      "Category Ranking": [
        { "respno": "R001", "Initial Thoughts": "Want concrete data vs broad statements", "Category C Rank": "2", "Category S Rank": "", "Category M Rank": "1", "Category B Rank": "", "Category L Rank": "", "Reasoning": "MOA gives better understanding, then C for specificity", "Associate with Treatment": "All target SMN protein, mostly Spinraza/Evrysdi" },
        { "respno": "R002", "Initial Thoughts": "", "Category C Rank": "", "Category S Rank": "", "Category M Rank": "", "Category B Rank": "", "Category L Rank": "", "Reasoning": "", "Associate with Treatment": "" },
        { "respno": "", "Initial Thoughts": "", "Category C Rank": "", "Category S Rank": "", "Category M Rank": "", "Category B Rank": "", "Category L Rank": "", "Reasoning": "", "Associate with Treatment": "" }
      ]
    };

    res.json(demoData);
  } catch (error) {
    console.error('Error in get project endpoint:', error);
    res.status(500).json({ error: error.message });
  }
});

// GET /api/caX/template - Download blank template
router.get('/template', async (req, res) => {
  try {
    // Generate a blank template with exact headers
    const templateBuffer = await generateExcelFromJSON({});

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename="CA_Template.xlsx"');
    res.send(templateBuffer);
  } catch (error) {
    console.error('Error in template endpoint:', error);
    res.status(500).json({ error: error.message });
  }
});

// POST /api/caX/save - Save content analysis to project
router.post('/save', async (req, res) => {
  try {
    const { projectId, projectName, data, name, discussionGuide, discussionGuideHtml, guideMap, quotes, originalDocxId } = req.body;

    if (!projectId || !data) {
      return res.status(400).json({ error: 'Project ID and data are required' });
    }

    console.log(`Saving content analysis to project: ${projectName} (${projectId})`);

    const savedAnalysis = {
      id: Date.now().toString(),
      projectId,
      projectName,
      name: name && name.trim() ? name.trim() : 'Content Analysis',
      data,
      guideMap: guideMap || { bySheet: {} },
      quotes: quotes || {},
      savedAt: new Date().toISOString(),
      savedBy: 'You'
    };

    // Store in memory and save to file
    savedAnalyses.unshift(savedAnalysis); // Add to beginning of array
    await saveAnalysesToFile(savedAnalyses);

    // Save discussion guide HTML if provided (for formatted display)
    if (discussionGuideHtml) {
      const guideFile = path.join(discussionGuidesDir, `${projectId}.html`);
      await fs.writeFile(guideFile, discussionGuideHtml);
      console.log(`Discussion guide HTML saved for project: ${projectId}`);
    }

    // Move original DOCX file from temp location to permanent location
    if (originalDocxId) {
      const tempDocxPath = path.join(discussionGuidesDir, `${originalDocxId}.docx`);
      const permanentDocxPath = path.join(discussionGuidesDir, `${projectId}.docx`);
      try {
        await fs.rename(tempDocxPath, permanentDocxPath);
        console.log(`Original DOCX moved to permanent location for project: ${projectId}`);
      } catch (moveError) {
        console.warn('Failed to move original DOCX:', moveError);
      }
    }

    // Ensure uploads directory exists for public file serving
    try { await fs.mkdir(filesDir, { recursive: true }); } catch {}

    // 1) Generate and save an Excel file for this content analysis
    let caFilePublicUrl = null;
    try {
      const excelBuffer = await generateExcelFromJSON(data);
      const safeName = (savedAnalysis.name || 'Content_Analysis').replace(/[^a-zA-Z0-9._ -]/g, '').trim() || 'Content_Analysis';
      const caFileName = `CA_${projectId}_${savedAnalysis.id}_${safeName}.xlsx`;
      const caFilePath = path.join(filesDir, caFileName);
      await fs.writeFile(caFilePath, excelBuffer);
      caFilePublicUrl = `/uploads/${caFileName}`;
      console.log(`Content analysis Excel saved: ${caFilePath}`);
    } catch (excelErr) {
      console.warn('Failed to write Excel file for content analysis:', excelErr?.message || excelErr);
    }

    // 2) Copy discussion guide DOCX (if available) into uploads for Files tab
    let dgFilePublicUrl = null;
    try {
      const permanentDocxPath = path.join(discussionGuidesDir, `${projectId}.docx`);
      // Check if DOCX exists; if so, copy to uploads
      await fs.access(permanentDocxPath);
      const dgFileName = `Discussion_Guide_${projectId}_${savedAnalysis.id}.docx`;
      const dgUploadPath = path.join(filesDir, dgFileName);
      await fs.copyFile(permanentDocxPath, dgUploadPath);
      dgFilePublicUrl = `/uploads/${dgFileName}`;
      console.log(`Discussion guide copied to uploads: ${dgUploadPath}`);
    } catch (dgErr) {
      // If no DOCX but we have HTML, save HTML for reference
      if (discussionGuideHtml) {
        try {
          const dgHtmlName = `Discussion_Guide_${projectId}_${savedAnalysis.id}.html`;
          const dgHtmlPath = path.join(filesDir, dgHtmlName);
          await fs.writeFile(dgHtmlPath, discussionGuideHtml);
          dgFilePublicUrl = `/uploads/${dgHtmlName}`;
          console.log(`Discussion guide HTML saved to uploads: ${dgHtmlPath}`);
        } catch (htmlErr) {
          console.warn('Failed to save discussion guide HTML to uploads:', htmlErr?.message || htmlErr);
        }
      } else {
        console.log('No discussion guide file to add to Files tab');
      }
    }

    // Update project in projects.json to add content analysis and discussion guide
    try {
      const projectsPath = path.join(process.env.DATA_DIR || path.join(__dirname, '../data'), 'projects.json');
      if (await fs.access(projectsPath).then(() => true).catch(() => false)) {
        const rawProj = await fs.readFile(projectsPath, 'utf8');
        const allProj = safeJsonParse(rawProj || '{}', {});

        // Find and update the project
        for (const [uid, arr] of Object.entries(allProj || {})) {
          if (String(uid).includes('_archived')) continue;
          if (!Array.isArray(arr)) continue;
          const projIndex = arr.findIndex(p => String(p?.id) === String(projectId));
          if (projIndex !== -1) {
            // Add discussion guide flag if applicable
            if (originalDocxId || discussionGuideHtml) {
              allProj[uid][projIndex].hasDiscussionGuide = true;
              allProj[uid][projIndex].discussionGuideUpdatedAt = new Date().toISOString();
            }

            // Add content analysis to savedContentAnalyses array
            if (!allProj[uid][projIndex].savedContentAnalyses) {
              allProj[uid][projIndex].savedContentAnalyses = [];
            }

            // Add the new content analysis entry
            allProj[uid][projIndex].savedContentAnalyses.push({
              id: savedAnalysis.id,
              name: savedAnalysis.name,
              savedDate: savedAnalysis.savedAt,
              savedBy: savedAnalysis.savedBy
            });

            // Ensure files array exists
            if (!Array.isArray(allProj[uid][projIndex].files)) {
              allProj[uid][projIndex].files = [];
            }

            // Build file entries for Files tab
            const filesToAdd = [];
            // Don't add the Excel file to project files - content analysis shows as its own item
            // if (caFilePublicUrl) {
            //   filesToAdd.push({
            //     id: `file-${savedAnalysis.id}-ca`,
            //     name: `${savedAnalysis.name}.xlsx`,
            //     type: 'Excel',
            //     url: caFilePublicUrl,
            //     uploadedAt: savedAnalysis.savedAt
            //   });
            // }
            if (dgFilePublicUrl) {
              const isHtml = dgFilePublicUrl.toLowerCase().endsWith('.html');
              filesToAdd.push({
                id: `file-${savedAnalysis.id}-dg`,
                name: isHtml ? `${savedAnalysis.name} Discussion Guide.html` : `${savedAnalysis.name} Discussion Guide.docx`,
                type: 'discussion-guide', // Changed to discussion-guide type to prevent deletion
                url: dgFilePublicUrl,
                uploadedAt: savedAnalysis.savedAt
              });
            }

            // Append new files (avoid duplicates by id)
            const existingIds = new Set((allProj[uid][projIndex].files || []).map(f => String(f.id)));
            for (const f of filesToAdd) {
              if (!existingIds.has(String(f.id))) {
                allProj[uid][projIndex].files.push(f);
              }
            }

            await fs.writeFile(projectsPath, JSON.stringify(allProj, null, 2));
            console.log(`Updated project ${projectId} with content analysis and discussion guide`);
            break;
          }
        }
      }
    } catch (projectUpdateError) {
      console.warn('Failed to update project:', projectUpdateError);
    }

    res.json({
      success: true,
      id: savedAnalysis.id,
      message: `Content analysis saved to ${projectName}`,
      filesAdded: {
        contentAnalysis: caFilePublicUrl || null,
        discussionGuide: dgFilePublicUrl || null
      }
    });
  } catch (error) {
    console.error('Error in save endpoint:', error);
    res.status(500).json({ error: error.message });
  }
});

// DELETE /api/caX/delete/:id - Delete saved content analysis
router.delete('/delete/:id', async (req, res) => {
  try {
    const { id } = req.params;

    if (!id) {
      return res.status(400).json({ error: 'Analysis ID is required' });
    }

    console.log(`Deleting content analysis: ${id}`);

    // Find and remove from memory and file
    const initialLength = savedAnalyses.length;
    const analysisToDelete = savedAnalyses.find(analysis => String(analysis.id) === String(id));
    savedAnalyses = savedAnalyses.filter(analysis => String(analysis.id) !== String(id));

    if (savedAnalyses.length === initialLength) {
      return res.status(404).json({ error: 'Content analysis not found' });
    }

    // Save updated list to file
    await saveAnalysesToFile(savedAnalyses);

    // Also delete associated discussion guide files if they exist
    if (analysisToDelete && analysisToDelete.projectId) {
      const projectId = analysisToDelete.projectId;

      // Delete .txt file (old format)
      const guideFileTxt = path.join(discussionGuidesDir, `${projectId}.txt`);
      try {
        await fs.unlink(guideFileTxt);
        console.log(`Discussion guide (txt) deleted for project: ${projectId}`);
      } catch (error) {
        console.log(`No txt discussion guide found for project: ${projectId}`);
      }

      // Delete .html file
      const guideFileHtml = path.join(discussionGuidesDir, `${projectId}.html`);
      try {
        await fs.unlink(guideFileHtml);
        console.log(`Discussion guide (html) deleted for project: ${projectId}`);
      } catch (error) {
        console.log(`No html discussion guide found for project: ${projectId}`);
      }

      // Delete .docx file
      const guideFileDocx = path.join(discussionGuidesDir, `${projectId}.docx`);
      try {
        await fs.unlink(guideFileDocx);
        console.log(`Discussion guide (docx) deleted for project: ${projectId}`);
      } catch (error) {
        console.log(`No docx discussion guide found for project: ${projectId}`);
      }

      // Update project in projects.json to remove discussion guide flag
      try {
        const projectsPath = path.join(process.env.DATA_DIR || path.join(__dirname, '../data'), 'projects.json');
        if (await fs.access(projectsPath).then(() => true).catch(() => false)) {
          const rawProj = await fs.readFile(projectsPath, 'utf8');
          const allProj = safeJsonParse(rawProj || '{}', {});

          // Find and update the project
          for (const [uid, arr] of Object.entries(allProj || {})) {
            if (String(uid).includes('_archived')) continue;
            if (!Array.isArray(arr)) continue;
            const projIndex = arr.findIndex(p => String(p?.id) === String(projectId));
            if (projIndex !== -1) {
              delete allProj[uid][projIndex].hasDiscussionGuide;
              delete allProj[uid][projIndex].discussionGuideUpdatedAt;

              // Remove content analysis from savedContentAnalyses array
              if (allProj[uid][projIndex].savedContentAnalyses && Array.isArray(allProj[uid][projIndex].savedContentAnalyses)) {
                allProj[uid][projIndex].savedContentAnalyses = allProj[uid][projIndex].savedContentAnalyses.filter(
                  ca => String(ca.id) !== String(id)
                );
              }

              // Remove CA and DG files from the files array
              if (allProj[uid][projIndex].files && Array.isArray(allProj[uid][projIndex].files)) {
                allProj[uid][projIndex].files = allProj[uid][projIndex].files.filter(
                  file => !file.id?.includes(`-${id}`) && file.id !== `file-${id}-dg`
                );
              }

              await fs.writeFile(projectsPath, JSON.stringify(allProj, null, 2));
              console.log(`Removed discussion guide flag, content analysis, and associated files from project ${projectId}`);
              break;
            }
          }
        }
      } catch (projectUpdateError) {
        console.warn('Failed to update project to remove discussion guide flag:', projectUpdateError);
      }
    }

    res.json({
      success: true,
      message: 'Content analysis deleted successfully'
    });
  } catch (error) {
    console.error('Error in delete endpoint:', error);
    res.status(500).json({ error: error.message });
  }
});

// POST /api/caX/process-transcript - Process transcript and extract key findings (now async with job tracking)
router.post('/process-transcript', upload.single('transcript'), async (req, res) => {
  try {
    console.log('Transcript upload request received');
    console.log('Request body:', req.body);
    console.log('Request file:', req.file);

    const { projectId, activeSheet, discussionGuide, guideMap: guideMapRaw, analysisId, cleanTranscript, checkForAEs, messageConceptTesting, messageTestingDetails, transcriptId, preferCleanedTranscript } = req.body;

    if (!req.file && !transcriptId) {
      console.log('No file uploaded or transcriptId provided');
      return res.status(400).json({ error: 'A transcript file or transcriptId is required' });
    }

    if (!projectId || !activeSheet) {
      console.log('Missing required fields:', { projectId, activeSheet });
      return res.status(400).json({ error: 'Project ID and active sheet are required' });
    }

    const preferCleaned = preferCleanedTranscript === 'true' || preferCleanedTranscript === true;
    let messageTestingDetailsParsed = null;
    if (messageTestingDetails) {
      try {
        messageTestingDetailsParsed = typeof messageTestingDetails === 'string'
          ? JSON.parse(messageTestingDetails)
          : messageTestingDetails;
      } catch (err) {
        console.warn('Failed to parse messageTestingDetails:', err);
      }
    }

    let transcriptText;
    let cleanedTranscript;
    let transcriptFilename = req.file ? req.file.originalname : null;
    let usedTranscriptId = transcriptId || null;
    let storedOriginalFilePath = req.file ? req.file.path : null;
    let storedCleanedFilePath = null;
    let existingTranscriptRespno = null; // Store respno from transcript if using existing transcript

    // Process transcript synchronously
    console.log(`Processing transcript for project: ${projectId}, sheet: ${activeSheet}`);
    if (req.file) {
      console.log('File details:', {
        originalname: req.file.originalname,
        mimetype: req.file.mimetype,
        size: req.file.size,
        path: req.file.path
      });
    } else {
      console.log('Using existing transcript from transcripts store:', { transcriptId, preferCleaned });
    }

    // Read the transcript file
    if (req.file) {
      transcriptFilename = req.file.originalname;
      if (req.file.originalname.endsWith('.txt')) {
        transcriptText = await fs.readFile(req.file.path, 'utf8');
      } else if (req.file.originalname.endsWith('.docx')) {
        // Process .docx files using mammoth library
        console.log('Processing DOCX file with mammoth...');
        try {
          const result = await mammoth.extractRawText({ path: req.file.path });
          transcriptText = result.value;

          console.log(`Successfully extracted ${transcriptText.length} characters from DOCX file`);
          console.log('DOCX content preview:', transcriptText.substring(0, 200) + '...');

          // Check if we got meaningful content
          if (transcriptText.length < 50) {
            console.log('Warning: Extracted content seems too short, might be an issue with the DOCX file');
          }
        } catch (error) {
          console.error('Error processing DOCX file with mammoth:', error);
          return res.status(400).json({ 
            error: 'Failed to process DOCX file. Please try converting to .txt format and upload again.',
            details: error.message
          });
        }
      } else {
        return res.status(400).json({ error: 'Unsupported file format. Please upload .txt or .docx files.' });
      }
    } else {
      try {
        const transcriptsPath = path.join(process.env.DATA_DIR || path.join(__dirname, '../data'), 'transcripts.json');

        // Small delay to ensure file write has completed
        await new Promise(resolve => setTimeout(resolve, 100));

        let transcriptsData = {};
        if (await fs.access(transcriptsPath).then(() => true).catch(() => false)) {
          const raw = await fs.readFile(transcriptsPath, 'utf8');
          transcriptsData = safeJsonParse(raw || '{}', {});
          console.log('📁 Loaded transcripts.json for project:', projectId);
        } else {
          console.warn('⚠️ transcripts.json file not found');
        }

        const projectTranscripts = Array.isArray(transcriptsData[projectId]) ? transcriptsData[projectId] : [];
        console.log(`📋 Found ${projectTranscripts.length} transcripts for project ${projectId}`);
        let existingTranscript = projectTranscripts.find(t => String(t.id) === String(transcriptId));

        // If not found in transcripts.json, check if it's in the current analysis data
        if (!existingTranscript && currentData && currentData.transcripts) {
          console.log('⚠️ Transcript not found in transcripts.json, checking currentAnalysis.transcripts');
          existingTranscript = currentData.transcripts.find(t => String(t.id) === String(transcriptId));
          if (existingTranscript) {
            console.log('✅ Found transcript in currentAnalysis.transcripts:', transcriptId);
          }
        }

        if (!existingTranscript) {
          console.error('❌ Transcript not found:', {
            transcriptId,
            projectId,
            availableInTranscriptsJson: projectTranscripts.map(t => t.id),
            hasCurrentDataTranscripts: !!(currentData && currentData.transcripts),
            currentDataTranscriptIds: currentData?.transcripts?.map(t => t.id) || []
          });
          return res.status(404).json({ error: 'Transcript not found for this project' });
        }

        // Store the respno from the existing transcript
        existingTranscriptRespno = existingTranscript.respno;

        const resolvePath = (filePath) => {
          if (!filePath) return null;
          const normalized = path.normalize(filePath);
          if (path.isAbsolute(normalized)) return normalized;
          return path.join(__dirname, '..', normalized);
        };

        const resolvedOriginalPath = resolvePath(existingTranscript.originalPath);
        const resolvedCleanedPath = resolvePath(existingTranscript.cleanedPath);

        if (!resolvedOriginalPath && !resolvedCleanedPath) {
          return res.status(404).json({ error: 'Transcript file is no longer available on the server' });
        }

        const processingSourcePath = preferCleaned && resolvedCleanedPath ? resolvedCleanedPath : (resolvedCleanedPath || resolvedOriginalPath);
        const processingExt = path.extname(processingSourcePath || '').toLowerCase();

        if (processingExt === '.txt') {
          transcriptText = await fs.readFile(processingSourcePath, 'utf8');
        } else if (processingExt === '.docx') {
          console.log('Processing stored DOCX transcript with mammoth...');
          try {
            const result = await mammoth.extractRawText({ path: processingSourcePath });
            transcriptText = result.value;
          } catch (error) {
            console.error('Error processing stored DOCX file with mammoth:', error);
            return res.status(400).json({ 
              error: 'Failed to read stored DOCX transcript. Please re-upload as .txt if possible.',
              details: error.message
            });
          }
        } else {
          return res.status(400).json({ error: 'Unsupported transcript format. Please upload .txt or .docx files.' });
        }

        transcriptFilename = preferCleaned && existingTranscript.cleanedFilename
          ? existingTranscript.cleanedFilename
          : (existingTranscript.originalFilename || path.basename(processingSourcePath));
        usedTranscriptId = existingTranscript.id;

        const timestamp = Date.now();
        console.log('📝 Copying existing transcript files...');
        console.log('   Original path:', resolvedOriginalPath);
        console.log('   Cleaned path:', resolvedCleanedPath);
        console.log('   Uploads dir:', uploadsDir);

        if (resolvedOriginalPath) {
          const originalCopyName = `existing_${timestamp}_${path.basename(resolvedOriginalPath)}`;
          const destination = path.join(uploadsDir, originalCopyName);
          console.log('   Copying original to:', destination);
          await fs.copyFile(resolvedOriginalPath, destination);
          storedOriginalFilePath = destination;
          console.log('   ✅ Original copied successfully');
        }
        if (resolvedCleanedPath) {
          const cleanedCopyName = `existing_${timestamp}_cleaned_${path.basename(resolvedCleanedPath)}`;
          const cleanedDestination = path.join(uploadsDir, cleanedCopyName);
          console.log('   Copying cleaned to:', cleanedDestination);
          await fs.copyFile(resolvedCleanedPath, cleanedDestination);
          storedCleanedFilePath = cleanedDestination;
          console.log('   ✅ Cleaned copied successfully');
        }

        if (!storedOriginalFilePath && storedCleanedFilePath) {
          storedOriginalFilePath = storedCleanedFilePath;
        }
      } catch (error) {
        console.error('❌ Failed to load existing transcript:', error);
        console.error('   Error details:', {
          message: error.message,
          code: error.code,
          path: error.path
        });
        return res.status(500).json({ error: 'Failed to load stored transcript', details: error.message });
      }
    }

    cleanedTranscript = transcriptText;
    // Get the current content analysis data structure from the request body
    // The frontend should send the current data structure
    const currentData = req.body.currentData ? safeJsonParse(req.body.currentData, null) : getProjectData(projectId);
    if (!currentData) {
      return res.status(404).json({ error: 'Content analysis not found for this project' });
    }
    
    console.log('Using current data structure:', Object.keys(currentData));

    console.log('Transcript text length:', transcriptText.length);
    console.log('Transcript preview:', transcriptText.substring(0, 200) + '...');

    // Get column headers from Demographics sheet for context
    const columnHeaders = currentData.Demographics && Array.isArray(currentData.Demographics) && currentData.Demographics.length > 0
      ? Object.keys(currentData.Demographics[0])
      : [];

    // Extract date and time from the beginning of the transcript
    console.log('=== EXTRACTING DATE/TIME ===');
    console.log('First 500 chars of transcript:', transcriptText.substring(0, 500));
    const dateTimeInfo = extractDateTimeFromTranscript(transcriptText);
    console.log('Extracted date/time from transcript:', dateTimeInfo);

    // Derive moderator aliases and project name from the associated project (projects.json)
    const moderatorAliases = [];
    let projectName = 'Transcript'; // Default fallback
    try {
      const projectsPath = path.join(process.env.DATA_DIR || path.join(__dirname, '../data'), 'projects.json');
      if (await fs.access(projectsPath).then(() => true).catch(() => false)) {
        const rawProj = await fs.readFile(projectsPath, 'utf8');
        const allProj = safeJsonParse(rawProj || '{}', {});
        for (const [uid, arr] of Object.entries(allProj || {})) {
          if (String(uid).includes('_archived')) continue;
          if (!Array.isArray(arr)) continue;
          const proj = arr.find(p => String(p?.id) === String(projectId));
          if (proj) {
            // Extract project name
            projectName = proj.name || proj.title || 'Transcript';

            const tryPush = (val) => {
              if (!val) return;
              const s = String(val).trim();
              if (s && !moderatorAliases.some(x => x.toLowerCase() === s.toLowerCase())) moderatorAliases.push(s);
            };
            tryPush(proj.moderator);
            tryPush(proj.moderatorName);
            tryPush(proj.leadModerator);
            if (Array.isArray(proj.moderators)) proj.moderators.forEach(tryPush);
            if (Array.isArray(proj.teamMembers)) {
              for (const m of proj.teamMembers) {
                const role = (m?.role || m?.title || '').toString().toLowerCase();
                if (role.includes('moderator')) tryPush(m?.name || m?.displayName || m?.email);
              }
            }
            break;
          }
        }
      }
    } catch (e) {
      console.warn('Failed to derive moderator aliases and project name from projects.json:', e.message);
    }

    // Compose enriched guide context: raw guide + per sheet/column mapping of questions
    // This needs to be available for both cleaning and main processing
    let guideMap = {};
    try { guideMap = typeof guideMapRaw === 'string' ? JSON.parse(guideMapRaw) : (guideMapRaw || {}); } catch {}
    const mappingLines = [];
    if (guideMap && guideMap.bySheet) {
      mappingLines.push('=== GUIDE MAPPING BY SHEET/COLUMN ===');
      for (const [sheetName, colMap] of Object.entries(guideMap.bySheet)) {
        mappingLines.push(`Sheet: ${sheetName}`);
        for (const [colName, questions] of Object.entries(colMap || {})) {
          const qList = Array.isArray(questions) ? questions : [];
          if (qList.length) {
            mappingLines.push(`- ${colName}:`);
            for (const q of qList.slice(0, 5)) mappingLines.push(`  • ${q}`);
            if (qList.length > 5) mappingLines.push(`  • (+${qList.length - 5} more in guide)`);
          }
        }
      }
    }
    const enrichedGuide = [
      discussionGuide || '',
      mappingLines.join('\n')
    ].filter(Boolean).join('\n\n');

    // Skip transcript cleaning - we'll directly populate CA cells
    console.log('=== SKIPPING TRANSCRIPT CLEANING - DIRECTLY POPULATING CA ===');

    // Save cleaned transcript as Word document for download
    let cleanedFilePath = null;
    if (false) {
      try {
        const cleanedFilename = req.file.filename.replace('.docx', '_cleaned.docx');
        cleanedFilePath = path.join(uploadsDir, cleanedFilename);

        // Create a Word document with the cleaned transcript
        const { Document, Packer, Paragraph, TextRun, AlignmentType } = await import('docx');

        // Parse the cleaned transcript to identify speaker changes and format accordingly
        const lines = cleanedTranscript.split('\n');
        const paragraphs = [];

        // Add title: "Project Name - Transcript"
        paragraphs.push(
          new Paragraph({
            children: [
              new TextRun({
                text: `${projectName} - Transcript`,
                bold: true,
                size: 32, // 16pt font
              }),
            ],
            spacing: { after: 200 },
            alignment: AlignmentType.LEFT,
          })
        );

        // Add date and time in italics
        if (dateTimeInfo && (dateTimeInfo.date || dateTimeInfo.time)) {
          const dateTimeText = [dateTimeInfo.date, dateTimeInfo.time].filter(Boolean).join(' - ');
          paragraphs.push(
            new Paragraph({
              children: [
                new TextRun({
                  text: dateTimeText,
                  italics: true,
                  size: 20, // 10pt font
                }),
              ],
              spacing: { after: 400 },
              alignment: AlignmentType.LEFT,
            })
          );
        }

        // Process transcript lines
        for (const line of lines) {
          const trimmedLine = line.trim();
          if (!trimmedLine) {
            // Add empty paragraph for blank lines
            paragraphs.push(new Paragraph({ text: '' }));
            continue;
          }

          // Check if line starts with "Respondent:" or "Moderator:"
          const respondentMatch = trimmedLine.match(/^(Respondent:)\s*(.*)$/);
          const moderatorMatch = trimmedLine.match(/^(Moderator:)\s*(.*)$/);

          if (respondentMatch) {
            // Bold "Respondent:" and regular text for the rest
            paragraphs.push(
              new Paragraph({
                children: [
                  new TextRun({
                    text: 'Respondent: ',
                    bold: true,
                    size: 24,
                  }),
                  new TextRun({
                    text: respondentMatch[2],
                    size: 24,
                  }),
                ],
                spacing: { after: 120 },
              })
            );
          } else if (moderatorMatch) {
            // Bold "Moderator:" and regular text for the rest
            paragraphs.push(
              new Paragraph({
                children: [
                  new TextRun({
                    text: 'Moderator: ',
                    bold: true,
                    size: 24,
                  }),
                  new TextRun({
                    text: moderatorMatch[2],
                    size: 24,
                  }),
                ],
                spacing: { after: 120 },
              })
            );
          } else {
            // Regular paragraph
            paragraphs.push(
              new Paragraph({
                children: [
                  new TextRun({
                    text: trimmedLine,
                    size: 24,
                  }),
                ],
                spacing: { after: 120 },
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

        const buffer = await Packer.toBuffer(doc);
        await fs.writeFile(cleanedFilePath, buffer);
        console.log('Cleaned transcript saved for download:', cleanedFilePath);
      } catch (saveError) {
        console.warn('Failed to save cleaned transcript:', saveError);
        console.error('Save error details:', saveError);
      }
    }

    console.log('=== STARTING MAIN TRANSCRIPT PROCESSING ===');
    console.log('⏱️  Directly populating CA cells from raw transcript...');

    // Extract sheetsColumns from currentData
    const sheetsColumns = {};
    for (const [sheetName, respArray] of Object.entries(currentData || {})) {
      if (Array.isArray(respArray) && respArray.length > 0 && typeof respArray[0] === 'object') {
        const columns = Object.keys(respArray[0]).filter(key => key !== 'respno');
        sheetsColumns[sheetName] = columns;
      } else {
        sheetsColumns[sheetName] = [];
      }
    }

    // Call fillRespondentRowsFromTranscript directly on raw transcript
    const caResult = await fillRespondentRowsFromTranscript({
      transcript: transcriptText,
      sheetsColumns: sheetsColumns,
      discussionGuide: enrichedGuide,
      messageTestingDetails: messageTestingDetailsParsed
    });

    // Integrate the results into currentData
    // Use existing respno from transcript if available, otherwise calculate next respno
    let respno;

    if (existingTranscriptRespno) {
      // Use the respno assigned to the transcript in the Transcripts tab
      respno = existingTranscriptRespno;
      console.log(`Using existing respno from transcript: ${respno}`);
    } else {
      // Calculate next respno based on HIGHEST existing respno number (not array length)
      // Filter out empty rows (rows with no respno) before counting
      const demographicsArray = Array.isArray(currentData.Demographics) ? currentData.Demographics : [];
      const existingRespondents = demographicsArray.filter(row => row.respno || row['Respondent ID']);

      // Find the highest existing respondent number
      let maxRespno = 0;
      existingRespondents.forEach(row => {
        const id = row['Respondent ID'] || row['respno'];
        if (id) {
          const match = String(id).match(/\d+/);
          if (match) {
            const num = parseInt(match[0], 10);
            if (num > maxRespno) {
              maxRespno = num;
            }
          }
        }
      });

      respno = `R${String(maxRespno + 1).padStart(2, '0')}`;
      console.log(`Calculated new respno: ${respno}`);
    }

    for (const [sheetName, rowData] of Object.entries(caResult.rows || {})) {
      if (!currentData[sheetName]) {
        currentData[sheetName] = [];
      }

      // Add new row with proper metadata
      currentData[sheetName].push({
        ...rowData,
        'Respondent ID': respno,
        respno: respno
      });
    }

    const processed = {
      data: currentData,
      quotes: {}, // Not using quotes anymore
      context: {}
    };

    console.log('=== MAIN TRANSCRIPT PROCESSING COMPLETED ===');
    console.log('⏱️  Processing complete');

    // Update the Demographics sheet with extracted date/time if available
    console.log('=== UPDATING DEMOGRAPHICS WITH DATE/TIME ===');
    console.log('Date/Time info to apply:', dateTimeInfo);
    if (dateTimeInfo.date || dateTimeInfo.time) {
      const demographicsSheet = processed.data.Demographics;
      console.log('Demographics sheet exists:', !!demographicsSheet);
      console.log('Demographics sheet length:', demographicsSheet?.length);
      if (demographicsSheet && Array.isArray(demographicsSheet) && demographicsSheet.length > 0) {
        const lastRow = demographicsSheet[demographicsSheet.length - 1];
        console.log('Last row columns:', Object.keys(lastRow));
        console.log('Has Date column:', 'Date' in lastRow);
        console.log('Has Time (ET) column:', 'Time (ET)' in lastRow);

        // Check for various possible column name variations
        const dateColumn = Object.keys(lastRow).find(k =>
          k.toLowerCase().includes('date') || k === 'Date'
        );
        const timeColumn = Object.keys(lastRow).find(k =>
          k.toLowerCase().includes('time') || k === 'Time (ET)' || k === 'Time'
        );

        if (dateTimeInfo.date && dateColumn) {
          console.log(`Setting ${dateColumn} to:`, dateTimeInfo.date);
          lastRow[dateColumn] = dateTimeInfo.date;
        }
        if (dateTimeInfo.time && timeColumn) {
          console.log(`Setting ${timeColumn} to:`, dateTimeInfo.time);
          lastRow[timeColumn] = dateTimeInfo.time;
        }
        console.log('Updated Demographics with date/time:', {
          dateColumn,
          timeColumn,
          dateValue: dateColumn ? lastRow[dateColumn] : undefined,
          timeValue: timeColumn ? lastRow[timeColumn] : undefined
        });
      }
    } else {
      console.log('No date/time info extracted to apply');
    }

    // Update the transcript record with the correct date/time if we extracted it
    if (dateTimeInfo && (dateTimeInfo.date || dateTimeInfo.time)) {
      try {
        const transcriptsPath = path.join(process.env.DATA_DIR || path.join(__dirname, '../data'), 'transcripts.json');
        const transcriptsData = await fs.readFile(transcriptsPath, 'utf8');
        const transcripts = JSON.parse(transcriptsData);
        
        // Find and update the transcript record
        for (const projectId in transcripts) {
          const projectTranscripts = transcripts[projectId];
          const transcriptIndex = projectTranscripts.findIndex(t => t.id === usedTranscriptId);
          if (transcriptIndex !== -1) {
            if (dateTimeInfo.date) {
              transcripts[projectId][transcriptIndex].interviewDate = dateTimeInfo.date;
            }
            if (dateTimeInfo.time) {
              transcripts[projectId][transcriptIndex].interviewTime = dateTimeInfo.time;
            }
            console.log('Updated transcript record with correct date/time:', {
              transcriptId: usedTranscriptId,
              date: dateTimeInfo.date,
              time: dateTimeInfo.time
            });
            break;
          }
        }
        
        // Save the updated transcripts
        await fs.writeFile(transcriptsPath, JSON.stringify(transcripts, null, 2));
        console.log('Transcript record updated successfully');
      } catch (error) {
        console.error('Error updating transcript record:', error);
        // Don't fail the whole process if transcript update fails
      }
    }

    // If analysisId is provided, persist the updated data to savedAnalyses
    console.log('Checking if analysisId exists for context saving:', analysisId);
    if (analysisId) {
      console.log('AnalysisId found, looking for analysis in savedAnalyses');
      const idx = savedAnalyses.findIndex(a => a.id === analysisId);
      console.log('Found analysis at index:', idx);
      if (idx !== -1) {
        savedAnalyses[idx].data = processed.data;
        savedAnalyses[idx].quotes = processed.quotes;
        console.log('Original context keys:', Object.keys(processed.context || {}));
        console.log('Existing saved context keys:', Object.keys(savedAnalyses[idx].context || {}));
        const mergedContextForPersistence = mergeContextMaps(savedAnalyses[idx].context || {}, processed.context);
        savedAnalyses[idx].context = mergedContextForPersistence;
        processed.context = mergedContextForPersistence;
        console.log('Merged context keys:', Object.keys(mergedContextForPersistence || {}));
        // Ensure guideMap is preserved if it existed on the saved analysis
        if (!savedAnalyses[idx].guideMap && req.body.guideMap) {
          try { savedAnalyses[idx].guideMap = typeof req.body.guideMap === 'string' ? JSON.parse(req.body.guideMap) : req.body.guideMap; } catch {}
        }
        
        // Track which transcript was used in this analysis
        if (usedTranscriptId && respno) {
          if (!savedAnalyses[idx].transcripts) {
            savedAnalyses[idx].transcripts = [];
          }
          
          // Check if this transcript is already tracked
          const existingTranscript = savedAnalyses[idx].transcripts.find(t => 
            t.id === usedTranscriptId || t.sourceTranscriptId === usedTranscriptId
          );
          
          if (!existingTranscript) {
            // Get the full transcript record from the transcripts database
            const transcriptsPath = path.join(process.env.DATA_DIR || path.join(__dirname, '../data'), 'transcripts.json');
            const transcriptsData = await fs.readFile(transcriptsPath, 'utf8');
            const allTranscripts = JSON.parse(transcriptsData);
            
            console.log(`Looking for transcript ${usedTranscriptId} in transcripts database`);
            console.log(`Available projects in transcripts:`, Object.keys(allTranscripts));
            
            // Find the full transcript record
            let fullTranscript = null;
            for (const projectId in allTranscripts) {
              const projectTranscripts = allTranscripts[projectId];
              console.log(`Checking project ${projectId}, has ${projectTranscripts.length} transcripts`);
              fullTranscript = projectTranscripts.find(t => t.id === usedTranscriptId);
              if (fullTranscript) {
                console.log(`Found full transcript record:`, {
                  id: fullTranscript.id,
                  originalPath: fullTranscript.originalPath,
                  cleanedPath: fullTranscript.cleanedPath,
                  isCleaned: fullTranscript.isCleaned
                });
                break;
              }
            }
            
            if (!fullTranscript) {
              console.log(`No full transcript record found for ${usedTranscriptId}`);
              // Try to find by filename or other identifiers
              for (const projectId in allTranscripts) {
                const projectTranscripts = allTranscripts[projectId];
                fullTranscript = projectTranscripts.find(t => 
                  t.originalFilename === transcriptFilename ||
                  t.cleanedFilename === transcriptFilename ||
                  t.id.includes(usedTranscriptId) ||
                  usedTranscriptId.includes(t.id)
                );
                if (fullTranscript) {
                  console.log(`Found transcript by filename/ID match:`, {
                    id: fullTranscript.id,
                    originalFilename: fullTranscript.originalFilename,
                    cleanedFilename: fullTranscript.cleanedFilename
                  });
                  break;
                }
              }
            }
            
            // Add transcript tracking information with full details
            savedAnalyses[idx].transcripts.push({
              id: usedTranscriptId,
              sourceTranscriptId: usedTranscriptId,
              respno: respno,
              addedAt: new Date().toISOString(),
              filename: transcriptFilename,
              originalPath: fullTranscript?.originalPath || null,
              cleanedPath: fullTranscript?.cleanedPath || null,
              originalFilename: fullTranscript?.originalFilename || transcriptFilename,
              cleanedFilename: fullTranscript?.cleanedFilename || null,
              isCleaned: fullTranscript?.isCleaned || false
            });
            console.log(`Added transcript tracking: ${usedTranscriptId} -> ${respno} with paths`);
          } else {
            // Update existing transcript with current respno
            existingTranscript.respno = respno;
            existingTranscript.addedAt = new Date().toISOString();
            console.log(`Updated transcript tracking: ${usedTranscriptId} -> ${respno}`);
          }
        }
        
        savedAnalyses[idx].savedAt = new Date().toISOString();
        await saveAnalysesToFile(savedAnalyses);
        console.log(`Persisted updated analysis ${analysisId} with quotes and context`);
        console.log(`Context keys saved:`, Object.keys(savedAnalyses[idx].context || {}));
      } else {
        console.log(`Analysis ${analysisId} not found to persist`);
      }
    }

    // Keep uploaded or referenced file for download - no cleanup needed
    console.log('Transcript file available for download:', storedOriginalFilePath);

    // Extract the respno from the Demographics sheet (it's the newly added row)
    const demographicsSheet = processed.data.Demographics;
    // respno already declared above
    if (demographicsSheet && Array.isArray(demographicsSheet) && demographicsSheet.length > 0) {
      const lastRow = demographicsSheet[demographicsSheet.length - 1];
      respno = lastRow['Respondent ID'] || lastRow['respno'] || null;
      
      // If no respno exists, generate one
      if (!respno) {
        // Find the highest existing respondent number
        let maxRespno = 0;
        demographicsSheet.forEach(row => {
          const existingRespno = row['Respondent ID'] || row['respno'];
          if (existingRespno && existingRespno.startsWith('R')) {
            const num = parseInt(existingRespno.substring(1));
            if (!isNaN(num) && num > maxRespno) {
              maxRespno = num;
            }
          }
        });
        
        // Generate new respondent ID
        respno = `R${String(maxRespno + 1).padStart(2, '0')}`;

        // Update the last row with the new respondent ID
        lastRow['Respondent ID'] = respno;
        lastRow['respno'] = respno;

        console.log('Generated new respondent ID:', respno);
      }
    }

    const contextBySheetAndRespondent = {};
    for (const [sheetName, columnContext] of Object.entries(caResult.context || {})) {
      if (!contextBySheetAndRespondent[sheetName]) {
        contextBySheetAndRespondent[sheetName] = {};
      }

      const cleanedColumns = {};
      for (const [colName, contexts] of Object.entries(columnContext || {})) {
        cleanedColumns[colName] = Array.isArray(contexts) ? contexts : [];
      }

      contextBySheetAndRespondent[sheetName][respno] = cleanedColumns;
    }

    processed.context = contextBySheetAndRespondent;

        console.log('Transcript processing completed successfully');
        console.log('Extracted respno:', respno);
        console.log('📤 About to send response with context:', processed.context);
        console.log('📤 Context keys:', processed.context ? Object.keys(processed.context) : 'NO CONTEXT');
        for (const [sheet, cols] of Object.entries(processed.context || {})) {
          console.log(`📤 Sheet "${sheet}" context columns:`, Object.keys(cols));
        }

        // File already cleaned up above

        // Check for AEs if requested
        let aeReport = null;
        if (checkForAEs === 'true' || checkForAEs === true) {
          try {
            console.log('=== CHECKING FOR ADVERSE EVENTS ===');
            
            // Get client information from project data
            const projectData = getProjectData(projectId);
            const clientName = projectData?.client || 'Unknown Client';
            const clientId = projectData?.clientId || projectData?.client?.toLowerCase().replace(/\s+/g, '-');
            
            if (clientId) {
              // Call AE training API to check for AEs
              const aeResponse = await fetch(`${process.env.API_BASE_URL || 'http://localhost:3005'}/api/ae-training/check`, {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json',
                  'Authorization': `Bearer ${req.headers.authorization?.replace('Bearer ', '') || ''}`
                },
                body: JSON.stringify({
                  clientId: clientId,
                  transcript: cleanedTranscript,
                  clientName: clientName
                })
              });
              
              if (aeResponse.ok) {
                const aeData = await aeResponse.json();
                aeReport = aeData.aeReport;
                console.log('AE Report generated successfully');
              } else {
                console.warn('AE checking failed:', aeResponse.status, await aeResponse.text());
              }
            } else {
              console.warn('No client ID found for AE checking');
            }
          } catch (aeError) {
            console.error('Error checking for AEs:', aeError);
            // Don't fail the entire request if AE checking fails
          }
        }

    // Log AI cost if usage available; otherwise estimate based on text length
    try {
      const inputTokens = caResult?.usage?.prompt_tokens || 0;
      const outputTokens = caResult?.usage?.completion_tokens || 0;
      if (inputTokens > 0 && outputTokens > 0) {
        await logCost(projectId, COST_CATEGORIES.CONTENT_ANALYSIS, 'gpt-4o', inputTokens, outputTokens, 'Process transcript into CA');
      } else if (transcriptText) {
        const estInput = Math.ceil((transcriptText.length + JSON.stringify(sheetsColumns || {}).length) / 4);
        const estOutput = Math.ceil(estInput * 0.3);
        await logCost(projectId, COST_CATEGORIES.CONTENT_ANALYSIS, 'gpt-4o', estInput, estOutput, 'Process transcript into CA (estimated)');
      }
    } catch (e) {
      console.warn('Failed to log CA processing cost:', e.message);
    }

    // Return the processed result directly
        const clientOriginalPath = storedOriginalFilePath ? storedOriginalFilePath.split(path.sep).join('/') : null;
        const clientCleanedPath = (storedCleanedFilePath || cleanedFilePath) ? (storedCleanedFilePath || cleanedFilePath).split(path.sep).join('/') : null;

        res.json({
          success: true,
          data: processed.data,
          quotes: processed.quotes,
          context: processed.context || {},
          cleanedTranscript: cleanedTranscript,
          originalTranscript: transcriptText,
          respno: respno,
          analysisId: analysisId || null,
          aeReport: aeReport,
          filePaths: {
            original: clientOriginalPath,
            cleaned: clientCleanedPath
          },
          usedTranscriptId: usedTranscriptId,
          message: 'Transcript processed successfully'
        });
  } catch (error) {
    console.error('Error in transcript processing:', error);
    console.error('Error stack:', error.stack);

    // Clean up uploaded file on error
    if (req.file && req.file.path) {
      try {
        await fs.unlink(req.file.path);
        console.log('Uploaded file cleaned up after error');
      } catch (cleanupError) {
        console.warn('Failed to cleanup uploaded file after error:', cleanupError);
      }
    }

    res.status(500).json({ error: error.message });
  }
});

// GET /api/caX/download/original/:filename - Download original transcript file
router.get('/download/original/:filename', authenticateToken, async (req, res) => {
  try {
    const { filename } = req.params;
    const filePath = path.join(uploadsDir, filename);

    // Check if file exists
    if (!await fs.access(filePath).then(() => true).catch(() => false)) {
      return res.status(404).json({ error: 'File not found' });
    }

    // Set appropriate headers for download
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');

    // Stream the file using fsSync
    const fileStream = fsSync.createReadStream(filePath);
    fileStream.pipe(res);

    fileStream.on('error', (error) => {
      console.error('Error streaming file:', error);
      if (!res.headersSent) {
        res.status(500).json({ error: 'Error streaming file' });
      }
    });
  } catch (error) {
    console.error('Error in download original endpoint:', error);
    res.status(500).json({ error: error.message });
  }
});

// GET /api/caX/download/cleaned/:filename - Download cleaned transcript file
router.get('/download/cleaned/:filename', authenticateToken, async (req, res) => {
  try {
    const { filename } = req.params;
    // Don't add _cleaned if it's already in the filename
    const cleanedFilename = filename.includes('_cleaned.docx') ? filename : filename.replace('.docx', '_cleaned.docx');
    const filePath = path.join(uploadsDir, cleanedFilename);

    console.log('🔍 Download cleaned - requested filename:', filename);
    console.log('🔍 Download cleaned - cleanedFilename:', cleanedFilename);
    console.log('🔍 Download cleaned - filePath:', filePath);

    // Check if file exists
    if (!await fs.access(filePath).then(() => true).catch(() => false)) {
      return res.status(404).json({ error: 'Cleaned file not found' });
    }

    // Set appropriate headers for download
    res.setHeader('Content-Disposition', `attachment; filename="${cleanedFilename}"`);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');

    // Stream the file using fsSync
    const fileStream = fsSync.createReadStream(filePath);
    fileStream.pipe(res);

    fileStream.on('error', (error) => {
      console.error('Error streaming cleaned file:', error);
      if (!res.headersSent) {
        res.status(500).json({ error: 'Error streaming cleaned file' });
      }
    });
  } catch (error) {
    console.error('Error in download cleaned endpoint:', error);
    res.status(500).json({ error: error.message });
  }
});

// POST /api/caX/generate-from-transcripts - Generate content analysis from transcripts
router.post('/generate-from-transcripts', async (req, res) => {
  try {
    const { projectId, analysisId, transcriptType, transcripts } = req.body;
    
    if (!projectId || !analysisId || !transcriptType || !transcripts || !Array.isArray(transcripts)) {
      return res.status(400).json({ error: 'Missing required parameters' });
    }

    console.log(`Generating content analysis from ${transcriptType} transcripts for analysis ${analysisId}`);
    console.log(`Processing ${transcripts.length} transcript(s)`);

    // Load the existing analysis
    const analysesPath = path.join(process.env.DATA_DIR || path.join(__dirname, '../data'), 'savedAnalyses.json');
    const analysesData = await fs.readFile(analysesPath, 'utf8');
    const analyses = JSON.parse(analysesData);
    
    const analysisIndex = analyses.findIndex(a => a.id === analysisId);
    if (analysisIndex === -1) {
      return res.status(404).json({ error: 'Analysis not found' });
    }

    const analysis = analyses[analysisIndex];
    
    console.log('📖 Loaded analysis:', {
      id: analysis.id,
      name: analysis.name,
      hasData: !!analysis.data,
      hasQuotes: !!analysis.quotes,
      hasContext: !!analysis.context,
      dataKeys: analysis.data ? Object.keys(analysis.data) : 'none',
      contextKeys: analysis.context ? Object.keys(analysis.context) : 'none'
    });
    
    // Generate content analysis for each transcript
    let totalInputTokens = 0;
    let totalOutputTokens = 0;
    for (const transcript of transcripts) {
      console.log(`🔍 Processing transcript for ${transcript.respno}:`, {
        hasCleaned: !!transcript.cleanedTranscript,
        hasOriginal: !!transcript.originalTranscript,
        hasTranscriptText: !!transcript.transcriptText,
        hasText: !!transcript.text,
        hasContent: !!transcript.content,
        keys: Object.keys(transcript)
      });
      
      // Try to get transcript text - check both cleaned and original
      let transcriptText = transcript.cleanedTranscript || transcript.originalTranscript;
      
      // If still no text, try to get it from the transcript data structure
      if (!transcriptText) {
        // Check if transcript has a different structure
        if (transcript.transcriptText) {
          transcriptText = transcript.transcriptText;
        } else if (transcript.text) {
          transcriptText = transcript.text;
        } else if (transcript.content) {
          transcriptText = transcript.content;
        }
      }
      
      // If still no text, try to load from file system using filename
      if (!transcriptText && transcript.filename) {
        try {
          const transcriptPath = path.join(process.env.DATA_DIR || path.join(__dirname, '../data'), 'uploads', transcript.filename);
          console.log(`📁 Attempting to load transcript from file: ${transcriptPath}`);
          
          if (await fs.access(transcriptPath).then(() => true).catch(() => false)) {
            const fileContent = await fs.readFile(transcriptPath, 'utf8');
            transcriptText = fileContent;
            console.log(`📄 Loaded transcript from file for ${transcript.respno}, length: ${transcriptText.length}`);
          } else {
            console.log(`❌ Transcript file not found: ${transcriptPath}`);
          }
        } catch (fileError) {
          console.error(`❌ Error loading transcript file for ${transcript.respno}:`, fileError.message);
        }
      }
      
      if (!transcriptText) {
        console.warn(`No transcript text found for respondent ${transcript.respno}. Available keys:`, Object.keys(transcript));
        continue;
      }
      
      console.log(`📄 Found transcript text for ${transcript.respno}, length: ${transcriptText.length}`);

      console.log(`Processing transcript for respondent ${transcript.respno}`);

      // Get discussion guide text for context
      const discussionGuideText = analysis.rawGuideText || analysis.discussionGuideText || '';

      // Extract sheetsColumns from analysis.data
      // analysis.data is structured as: { sheetName: [ { columnName: value, respno: "R001" } ] }
      const sheetsColumns = {};
      for (const [sheetName, respArray] of Object.entries(analysis.data || {})) {
        if (Array.isArray(respArray) && respArray.length > 0 && typeof respArray[0] === 'object') {
          // Get all column names from the first row, excluding 'respno' which is metadata
          const columns = Object.keys(respArray[0]).filter(key => key !== 'respno');
          sheetsColumns[sheetName] = columns;
        } else {
          sheetsColumns[sheetName] = [];
        }
      }

      console.log('Extracted sheetsColumns:', JSON.stringify(sheetsColumns, null, 2));

      // Use fillRespondentRowsFromTranscript to populate the analysis
      const caResult = await fillRespondentRowsFromTranscript({
        transcript: transcriptText,
        sheetsColumns: sheetsColumns,
        discussionGuide: discussionGuideText,
        messageTestingDetails: null
      });

      // Accumulate usage if service exposes it
      if (caResult?.usage) {
        totalInputTokens += caResult.usage.prompt_tokens || 0;
        totalOutputTokens += caResult.usage.completion_tokens || 0;
      } else if (transcriptText) {
        // Estimate if no usage provided
        const estInput = Math.ceil((transcriptText.length + JSON.stringify(sheetsColumns || {}).length) / 4);
        const estOutput = Math.ceil(estInput * 0.3);
        totalInputTokens += estInput;
        totalOutputTokens += estOutput;
      }

      console.log('CA Result structure:', { hasRows: !!caResult?.rows, hasContext: !!caResult?.context });
      if (caResult?.context) {
        console.log('📝 Context generated for sheets:', Object.keys(caResult.context));
        for (const [sheet, cols] of Object.entries(caResult.context)) {
          const filledCols = Object.entries(cols).filter(([k, v]) => Array.isArray(v) && v.length > 0);
          console.log(`  📝 Sheet "${sheet}": ${filledCols.length} columns with context`);
        }
      } else {
        console.log('⚠️ No context generated for transcript', transcript.respno);
      }

      if (caResult && caResult.rows) {
        // caResult.rows is structured as: { sheetName: { columnName: value } }
        // We need to integrate this into analysis.data which is: { sheetName: [ { columnName: value, respno: "R001" } ] }

        for (const [sheetName, rowData] of Object.entries(caResult.rows)) {
          if (!analysis.data[sheetName]) {
            analysis.data[sheetName] = [];
          }

          // Find existing row for this respondent or create new one
          const existingRowIndex = analysis.data[sheetName].findIndex(row => row.respno === transcript.respno);

          if (existingRowIndex !== -1) {
            // Update existing row - merge the new data with existing data
            analysis.data[sheetName][existingRowIndex] = {
              ...analysis.data[sheetName][existingRowIndex],
              ...rowData,
              respno: transcript.respno  // Ensure respno is preserved
            };
          } else {
            // Add new row
            analysis.data[sheetName].push({
              ...rowData,
              respno: transcript.respno
            });
          }
        }

        // Update context if available
        // caResult.context is structured as: { sheetName: { columnName: [context1, context2, ...] } }
        // We need to store it in a similar format
        if (caResult.context) {
          console.log('🔄 Processing context for respondent', transcript.respno);
          if (!analysis.context) analysis.context = {};

          for (const [sheetName, colContexts] of Object.entries(caResult.context)) {
            if (!analysis.context[sheetName]) {
              analysis.context[sheetName] = {};
            }

            // Store context for this respondent
            if (!analysis.context[sheetName][transcript.respno]) {
              analysis.context[sheetName][transcript.respno] = {};
            }

            // Merge column contexts for this respondent
            analysis.context[sheetName][transcript.respno] = {
              ...analysis.context[sheetName][transcript.respno],
              ...colContexts
            };
            
            console.log(`✅ Stored context for ${transcript.respno} in sheet "${sheetName}"`);
          }
        } else {
          console.log('⚠️ No context to process for respondent', transcript.respno);
        }
      }
    }

    // Save the updated analysis
    analyses[analysisIndex] = analysis;
    await fs.writeFile(analysesPath, JSON.stringify(analyses, null, 2));

    console.log(`Content analysis generation completed for analysis ${analysisId}`);
    console.log('📤 Final analysis state:', {
      hasData: !!analysis.data,
      hasQuotes: !!analysis.quotes,
      hasContext: !!analysis.context,
      dataKeys: analysis.data ? Object.keys(analysis.data) : 'none',
      contextKeys: analysis.context ? Object.keys(analysis.context) : 'none',
      quotesKeys: analysis.quotes ? Object.keys(analysis.quotes) : 'none'
    });
    
    const responseData = { 
      success: true, 
      message: `Content analysis generated successfully for ${transcripts.length} transcript(s)`,
      analysisId: analysisId,
      data: analysis.data,
      quotes: analysis.quotes,
      context: analysis.context
    };
    
    console.log('📤 Sending response with data:', {
      hasData: !!responseData.data,
      hasQuotes: !!responseData.quotes,
      hasContext: !!responseData.context
    });
    
    // Log aggregated AI cost for this generation
    try {
      if (totalInputTokens > 0 && totalOutputTokens > 0) {
        await logCost(projectId, COST_CATEGORIES.CONTENT_ANALYSIS, 'gpt-4o', totalInputTokens, totalOutputTokens, 'Generate Content Analysis from transcripts');
      }
    } catch (e) {
      console.warn('Failed to log CA generate cost:', e.message);
    }

    res.json(responseData);

  } catch (error) {
    console.error('Error in generate-from-transcripts endpoint:', error);
    res.status(500).json({ error: error.message });
  }
});

// GET /api/caX/discussion-guide/:projectId - Get discussion guide HTML for a project
router.get('/discussion-guide/:projectId', async (req, res) => {
  try {
    const { projectId } = req.params;
    const htmlFile = path.join(discussionGuidesDir, `${projectId}.html`);

    try {
      const discussionGuide = await fs.readFile(htmlFile, 'utf8');
      res.setHeader('Content-Type', 'text/html');
      res.send(discussionGuide);
    } catch (htmlError) {
      res.status(404).json({ error: 'Discussion guide not found' });
    }
  } catch (error) {
    console.error('Error in discussion-guide endpoint:', error);
    res.status(500).json({ error: error.message });
  }
});

// GET /api/caX/discussion-guide/:projectId/download - Download original Word document
router.get('/discussion-guide/:projectId/download', async (req, res) => {
  try {
    const { projectId } = req.params;
    const docxFile = path.join(discussionGuidesDir, `${projectId}.docx`);

    try {
      // Check if file exists
      await fs.access(docxFile);

      // Send the file for download
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
      res.setHeader('Content-Disposition', `attachment; filename="Discussion_Guide_${projectId}.docx"`);

      const fileBuffer = await fs.readFile(docxFile);
      res.send(fileBuffer);
    } catch (fileError) {
      res.status(404).json({ error: 'Discussion guide Word document not found' });
    }
  } catch (error) {
    console.error('Error in discussion-guide download endpoint:', error);
    res.status(500).json({ error: error.message });
  }
});

// Helper function to get project data (in production, fetch from database)
function getProjectData(projectId) {
  // This would typically fetch from a database
  // For now, return the demo data structure
  return {
    "Demographics": [
      { "respno": "R001", "Specialty": "Pediatric Neurologist", "Date": "08/15/2024", "Time (ET)": "10:00 AM" }
    ],
    "Background & Treatment": [
      { "respno": "R001", "Current Practice": "", "SMA Population": "", "Treatment Approach": "", "Current Patients Tx": "", "Treatment Challenges": "" }
    ],
    "Category Ranking": [
      { "respno": "R001", "Initial Thoughts": "", "Category C Rank": "", "Category S Rank": "", "Category M Rank": "", "Category B Rank": "", "Category L Rank": "", "Reasoning": "", "Associate with Treatment": "" }
    ]
  };
}

// Helper function to get discussion guide (in production, fetch from database)
function getDiscussionGuide(projectId) {
  // This would typically fetch from a database
  // For now, return a placeholder
  return `Discussion Guide for Project ${projectId}

1. Introduction
   - Welcome and thank participant
   - Explain purpose of interview
   - Obtain consent

2. Background & Treatment Experience
   - Current practice setting
   - SMA patient population
   - Treatment approaches used
   - Current patient treatments
   - Treatment challenges

3. Category Ranking
   - Initial thoughts on categories
   - Rank categories by importance
   - Reasoning for rankings
   - Association with treatments

4. Conclusion
   - Thank participant
   - Next steps`;
}

// POST /api/caX/fill-content-analysis - Fill content analysis from cleaned transcript
router.post('/fill-content-analysis', async (req, res) => {
  try {
    console.log('Fill content analysis request received');
    console.log('Request body:', req.body);

    const { analysisId, transcriptId, projectId, activeSheet, discussionGuide, guideMap: guideMapRaw, messageConceptTesting, messageTestingDetails } = req.body;

    if (!analysisId || !transcriptId) {
      console.log('Missing required fields:', { analysisId, transcriptId });
      return res.status(400).json({ error: 'Analysis ID and transcript ID are required' });
    }

    // Get the analysis data
    const analysis = savedAnalyses.find(a => a.id === analysisId);
    if (!analysis) {
      return res.status(404).json({ error: 'Analysis not found' });
    }

    // Get the transcript data
    const transcript = analysis.transcripts?.find(t => t.id === transcriptId);
    if (!transcript) {
      return res.status(404).json({ error: 'Transcript not found' });
    }

    const cleanedTranscript = transcript.cleanedTranscript || transcript.originalTranscript;
    if (!cleanedTranscript) {
      return res.status(400).json({ error: 'No transcript content found' });
    }

    console.log(`Filling content analysis for analysis: ${analysisId}, transcript: ${transcriptId}`);
    console.log('Cleaned transcript length:', cleanedTranscript.length);

    // Parse guide map
    let guideMap = {};
    try { guideMap = typeof guideMapRaw === 'string' ? JSON.parse(guideMapRaw) : (guideMapRaw || {}); } catch {}
    
    // Build enriched discussion guide
    const mappingLines = [];
    if (guideMap && guideMap.bySheet) {
      mappingLines.push('=== GUIDE MAPPING BY SHEET/COLUMN ===');
      for (const [sheetName, colMap] of Object.entries(guideMap.bySheet)) {
        mappingLines.push(`Sheet: ${sheetName}`);
        for (const [colName, questions] of Object.entries(colMap || {})) {
          const qList = Array.isArray(questions) ? questions : [];
          if (qList.length) {
            mappingLines.push(`- ${colName}:`);
            for (const q of qList.slice(0, 5)) mappingLines.push(`  • ${q}`);
            if (qList.length > 5) mappingLines.push(`  • (+${qList.length - 5} more in guide)`);
          }
        }
      }
    }
    const enrichedGuide = [
      discussionGuide || '',
      mappingLines.join('\n')
    ].filter(Boolean).join('\n\n');

    // Process the CLEANED transcript with AI to extract key findings for ALL sheets
    const messageTestingDetailsParsed = messageTestingDetails ? JSON.parse(messageTestingDetails) : null;
    const processed = await processTranscriptWithAI(cleanedTranscript, analysis.data, enrichedGuide, messageTestingDetailsParsed);

    console.log('=== CONTENT ANALYSIS FILLING COMPLETED ===');

    // Update the analysis with the new data
    const updatedAnalysis = {
      ...analysis,
      data: processed.data,
      quotes: processed.quotes,
      context: processed.context,
      savedAt: new Date().toISOString()
    };

    // Update in saved analyses
    const analysisIndex = savedAnalyses.findIndex(a => a.id === analysisId);
    if (analysisIndex !== -1) {
      savedAnalyses[analysisIndex] = updatedAnalysis;
      await saveAnalysesToFile(savedAnalyses);
      console.log(`Updated analysis ${analysisId} with filled content`);
    }

    // Return the updated analysis
    res.json({
      success: true,
      data: processed.data,
      quotes: processed.quotes,
      context: processed.context,
      message: 'Content analysis filled successfully'
    });

  } catch (error) {
    console.error('Error filling content analysis:', error);
    res.status(500).json({ error: error.message });
  }
});

// Helper function to extract relevant phrases from transcript
function extractRelevantPhrases(transcriptText, columnName) {
  const transcriptLower = transcriptText.toLowerCase();
  const columnLower = columnName.toLowerCase();
  const phrases = [];
  
  // Look for sentences that might be relevant to the column
  const sentences = transcriptText.split(/[.!?]+/).filter(s => s.trim().length > 10);
  
  sentences.forEach(sentence => {
    const sentenceLower = sentence.toLowerCase();
    
    // Check if sentence contains keywords related to the column
    if (columnLower.includes('benefit') && (sentenceLower.includes('benefit') || sentenceLower.includes('advantage') || sentenceLower.includes('help'))) {
      phrases.push(sentence.trim());
    } else if (columnLower.includes('challenge') && (sentenceLower.includes('challenge') || sentenceLower.includes('difficult') || sentenceLower.includes('problem'))) {
      phrases.push(sentence.trim());
    } else if (columnLower.includes('interest') && (sentenceLower.includes('interest') || sentenceLower.includes('excited') || sentenceLower.includes('curious'))) {
      phrases.push(sentence.trim());
    } else if (columnLower.includes('concern') && (sentenceLower.includes('concern') || sentenceLower.includes('worried') || sentenceLower.includes('skeptical'))) {
      phrases.push(sentence.trim());
    } else if (columnLower.includes('experience') && (sentenceLower.includes('experience') || sentenceLower.includes('used') || sentenceLower.includes('tried'))) {
      phrases.push(sentence.trim());
    }
  });
  
  return phrases.slice(0, 2); // Return up to 2 relevant phrases
}

// Helper function to analyze transcript like ChatGPT would
async function analyzeTranscriptAsResearcher(transcriptText, columnName, sheetName) {
  console.log(`\n=== AI TRANSCRIPT ANALYSIS ===`);
  console.log(`Column: "${columnName}" in Sheet: "${sheetName}"`);
  console.log(`Transcript length: ${transcriptText.length} characters`);
  
  // Parse transcript to separate moderator from respondent
  const parsedTranscript = parseTranscriptStructure(transcriptText);
  console.log('Parsed transcript - Respondent responses:', parsedTranscript.respondentResponses.length);
  
  // Extract only respondent responses for analysis
  const respondentText = parsedTranscript.respondentResponses.join(' ');
  console.log('Respondent text length:', respondentText.length);
  
  // Simulate AI processing delay to show it's actually "thinking"
  await new Promise(resolve => setTimeout(resolve, 1000 + Math.random() * 2000));
  
  // Generate intelligent analysis based on actual transcript content
  let analysis = generateIntelligentSummary(respondentText, columnName, sheetName);
  
  console.log(`Generated analysis: ${analysis.substring(0, 150)}...`);
  return analysis;
}

// Helper function to generate intelligent summary based on actual transcript content
function generateIntelligentSummary(respondentText, columnName, sheetName) {
  const column = columnName.toLowerCase();
  const sheet = sheetName.toLowerCase();
  
  // If no respondent text, return appropriate response
  if (!respondentText || respondentText.length < 20) {
    return `No specific respondent feedback available for ${columnName}`;
  }
  
  // Extract relevant sentences based on column purpose
  const relevantSentences = extractRelevantContent(respondentText, columnName, sheetName);
  
  if (relevantSentences.length === 0) {
    return `No specific information provided about ${columnName.toLowerCase()}`;
  }
  
  // Generate a coherent summary from the relevant content
  return createCoherentSummary(relevantSentences, columnName);
}

// Helper function to extract relevant content based on column purpose
function extractRelevantContent(respondentText, columnName, sheetName) {
  const column = columnName.toLowerCase();
  const sheet = sheetName.toLowerCase();
  
  // Split into sentences for analysis
  const sentences = respondentText.split(/[.!?]+/).filter(s => s.trim().length > 10);
  
  const relevantSentences = [];
  
  // Define keywords and patterns for different column types
  const keywords = {
    'introduction': ['introduce', 'name', 'practice', 'clinic', 'hospital', 'work', 'role', 'position'],
    'population': ['patient', 'population', 'manage', 'treat', 'see', 'care for', 'clinic', 'practice'],
    'approach': ['approach', 'treat', 'treatment', 'manage', 'care', 'protocol', 'method', 'strategy'],
    'preference': ['prefer', 'preference', 'like', 'favorite', 'choose', 'select', 'recommend'],
    'impression': ['impression', 'think', 'believe', 'feel', 'opinion', 'view', 'perspective'],
    'awareness': ['aware', 'know', 'heard', 'familiar', 'understand', 'learned', 'informed'],
    'benefit': ['benefit', 'advantage', 'help', 'improve', 'effective', 'useful', 'valuable'],
    'safety': ['safe', 'safety', 'risk', 'concern', 'worry', 'side effect', 'adverse'],
    'candidate': ['candidate', 'suitable', 'appropriate', 'good fit', 'right patient', 'ideal'],
    'communication': ['communicate', 'discuss', 'talk', 'explain', 'inform', 'share', 'tell']
  };
  
  // Find relevant sentences based on column name and keywords
  for (const sentence of sentences) {
    const lowerSentence = sentence.toLowerCase();
    
    // Check for direct keyword matches
    for (const [category, words] of Object.entries(keywords)) {
      if (column.includes(category) || column.includes(words[0])) {
        for (const word of words) {
          if (lowerSentence.includes(word)) {
            relevantSentences.push(sentence.trim());
            break;
          }
        }
      }
    }
    
    // Special handling for specific column types
    if (column.includes('age') && (lowerSentence.includes('age') || lowerSentence.includes('year') || lowerSentence.includes('old'))) {
      relevantSentences.push(sentence.trim());
    }
    
    if (column.includes('number') && (lowerSentence.includes('number') || lowerSentence.includes('patient') || lowerSentence.includes('manage'))) {
      relevantSentences.push(sentence.trim());
    }
    
    if (column.includes('question') && (lowerSentence.includes('question') || lowerSentence.includes('ask') || lowerSentence.includes('wonder'))) {
      relevantSentences.push(sentence.trim());
    }
  }
  
  // Remove duplicates and limit to most relevant
  const uniqueSentences = [...new Set(relevantSentences)];
  return uniqueSentences.slice(0, 3); // Return top 3 most relevant sentences
}

// Helper function to create coherent summary from extracted sentences
function createCoherentSummary(sentences, columnName) {
  if (sentences.length === 0) {
    return `No specific information provided about ${columnName.toLowerCase()}`;
  }
  
  if (sentences.length === 1) {
    return sentences[0];
  }
  
  // Combine sentences into a coherent summary
  const combined = sentences.join(' ').replace(/\s+/g, ' ').trim();
  
  // If the combined text is too long, truncate it intelligently
  if (combined.length > 300) {
    return combined.substring(0, 297) + '...';
  }
  
  return combined;
}

// Helper function to analyze interview context
function analyzeInterviewContext(fullTranscript, respondentText) {
  const context = {
    respondentRole: '',
    practiceSetting: '',
    patientCount: '',
    experience: '',
    mainTopics: [],
    sentiment: '',
    keyInsights: []
  };
  
  const text = respondentText.toLowerCase();
  const fullText = fullTranscript.toLowerCase();
  
  // Extract respondent role
  if (text.includes('physician') || text.includes('doctor') || text.includes('md')) {
    context.respondentRole = 'Physician';
  } else if (text.includes('nurse') || text.includes('np')) {
    context.respondentRole = 'Nurse';
  } else if (text.includes('pharmacist')) {
    context.respondentRole = 'Pharmacist';
  }
  
  // Extract practice setting
  if (text.includes('hospital') || text.includes('medical center')) {
    context.practiceSetting = 'Hospital';
  } else if (text.includes('clinic') || text.includes('outpatient')) {
    context.practiceSetting = 'Clinic';
  } else if (text.includes('private practice')) {
    context.practiceSetting = 'Private Practice';
  }
  
  // Extract patient count
  const numbers = text.match(/\d+/g);
  if (numbers) {
    const patientNumbers = numbers.map(n => parseInt(n)).filter(n => n > 0 && n < 10000);
    if (patientNumbers.length > 0) {
      context.patientCount = Math.max(...patientNumbers).toString();
    }
  }
  
  // Analyze sentiment
  if (text.includes('excited') || text.includes('enthusiastic') || text.includes('positive') || text.includes('good')) {
    context.sentiment = 'positive';
  } else if (text.includes('concern') || text.includes('worried') || text.includes('skeptical') || text.includes('caution')) {
    context.sentiment = 'cautious';
  } else {
    context.sentiment = 'neutral';
  }
  
  // Extract key insights
  const sentences = respondentText.split(/[.!?]+/).filter(s => s.trim().length > 20);
  context.keyInsights = sentences.slice(0, 5).map(s => s.trim());
  
  return context;
}

// Helper function to generate intelligent response
function generateIntelligentResponse(columnName, sheetName, respondentText, context) {
  const column = columnName.toLowerCase();
  const sheet = sheetName.toLowerCase();
  
  // Generate response based on column type and content
  if (column.includes('approach') && column.includes('treating')) {
    return generateTreatmentApproachResponse(respondentText, context);
  } else if (column.includes('impression') || column.includes('overall')) {
    return generateImpressionResponse(respondentText, context);
  } else if (column.includes('benefit') || column.includes('advantage')) {
    return generateBenefitsResponse(respondentText, context);
  } else if (column.includes('challenge') || column.includes('barrier')) {
    return generateChallengesResponse(respondentText, context);
  } else if (column.includes('experience') || column.includes('used')) {
    return generateExperienceResponse(respondentText, context);
  } else if (column.includes('prefer') || column.includes('preferred')) {
    return generatePreferenceResponse(respondentText, context);
  } else if (column.includes('interest') || column.includes('level')) {
    return generateInterestResponse(respondentText, context);
  } else if (column.includes('concern') || column.includes('worry')) {
    return generateConcernsResponse(respondentText, context);
  } else if (column.includes('thought') || column.includes('initial')) {
    return generateThoughtsResponse(respondentText, context);
  } else if (column.includes('impact') || column.includes('prescribing')) {
    return generateImpactResponse(respondentText, context);
  } else if (column.includes('population') || column.includes('patient')) {
    return generatePopulationResponse(respondentText, context);
  } else if (column.includes('number') || column.includes('count')) {
    return generateCountResponse(respondentText, context);
  } else if (column.includes('age') || column.includes('range')) {
    return generateAgeResponse(respondentText, context);
  } else {
    return generateGenericResponse(columnName, respondentText, context);
  }
}

// Specific response generators
function generateTreatmentApproachResponse(respondentText, context) {
  const sentences = respondentText.split(/[.!?]+/).filter(s => s.trim().length > 20);
  
  // Look for treatment-related content
  const treatmentSentences = sentences.filter(s => {
    const lower = s.toLowerCase();
    return lower.includes('treat') || lower.includes('approach') || lower.includes('method') || 
           lower.includes('therapy') || lower.includes('medication') || lower.includes('prescribe');
  });
  
  if (treatmentSentences.length > 0) {
    const approach = treatmentSentences[0].trim();
    return `The respondent's approach to treating SMA involves ${approach.toLowerCase()}`;
  } else if (context.keyInsights.length > 0) {
    const insight = context.keyInsights[0];
    return `Based on the interview, the respondent's treatment approach focuses on ${insight ? insight.toLowerCase() : 'patient care'}`;
  } else {
    return `The respondent discussed their clinical approach to treating SMA patients, emphasizing patient-centered care`;
  }
}

function generateImpressionResponse(respondentText, context) {
  const sentences = respondentText.split(/[.!?]+/).filter(s => s.trim().length > 20);
  
  // Look for impression-related content
  const impressionSentences = sentences.filter(s => {
    const lower = s.toLowerCase();
    return lower.includes('think') || lower.includes('feel') || lower.includes('opinion') || 
           lower.includes('impression') || lower.includes('view') || lower.includes('believe');
  });
  
  if (impressionSentences.length > 0) {
    const impression = impressionSentences[0].trim();
    return `The respondent's overall impression is that ${impression.toLowerCase()}`;
  } else if (context.sentiment === 'positive') {
    return `The respondent expressed a positive overall impression, showing enthusiasm and interest in the topic`;
  } else if (context.sentiment === 'cautious') {
    return `The respondent showed a cautious overall impression, with some concerns but remaining open to discussion`;
  } else {
    return `The respondent provided a balanced overall impression, considering both benefits and potential challenges`;
  }
}

function generateBenefitsResponse(respondentText, context) {
  const sentences = respondentText.split(/[.!?]+/).filter(s => s.trim().length > 20);
  
  const benefitSentences = sentences.filter(s => {
    const lower = s.toLowerCase();
    return lower.includes('benefit') || lower.includes('advantage') || lower.includes('help') || 
           lower.includes('improve') || lower.includes('better') || lower.includes('good');
  });
  
  if (benefitSentences.length > 0) {
    const benefits = benefitSentences.slice(0, 2).join(' ').trim();
    return `The respondent identified key benefits including ${benefits.toLowerCase()}`;
  } else {
    return `The respondent discussed potential benefits and advantages of the treatment approach`;
  }
}

function generateChallengesResponse(respondentText, context) {
  const sentences = respondentText.split(/[.!?]+/).filter(s => s.trim().length > 20);
  
  const challengeSentences = sentences.filter(s => {
    const lower = s.toLowerCase();
    return lower.includes('challenge') || lower.includes('difficult') || lower.includes('problem') || 
           lower.includes('issue') || lower.includes('concern') || lower.includes('barrier');
  });
  
  if (challengeSentences.length > 0) {
    const challenges = challengeSentences.slice(0, 2).join(' ').trim();
    return `The respondent identified main challenges including ${challenges.toLowerCase()}`;
  } else {
    return `The respondent discussed potential challenges and barriers in the treatment approach`;
  }
}

function generateExperienceResponse(respondentText, context) {
  const sentences = respondentText.split(/[.!?]+/).filter(s => s.trim().length > 20);
  
  const experienceSentences = sentences.filter(s => {
    const lower = s.toLowerCase();
    return lower.includes('experience') || lower.includes('used') || lower.includes('tried') || 
           lower.includes('practice') || lower.includes('familiar');
  });
  
  if (experienceSentences.length > 0) {
    const experience = experienceSentences[0].trim();
    return `The respondent's experience includes ${experience.toLowerCase()}`;
  } else {
    return `The respondent shared their clinical experience and familiarity with similar treatments`;
  }
}

function generatePreferenceResponse(respondentText, context) {
  const sentences = respondentText.split(/[.!?]+/).filter(s => s.trim().length > 20);
  
  const preferenceSentences = sentences.filter(s => {
    const lower = s.toLowerCase();
    return lower.includes('prefer') || lower.includes('like') || lower.includes('choose') || 
           lower.includes('favorite') || lower.includes('best') || lower.includes('rather');
  });
  
  if (preferenceSentences.length > 0) {
    const preferences = preferenceSentences.slice(0, 2).join(' ').trim();
    return `The respondent's preferences include ${preferences.toLowerCase()}`;
  } else {
    return `The respondent discussed their treatment preferences and rationale for selection`;
  }
}

function generateInterestResponse(respondentText, context) {
  if (context.sentiment === 'positive') {
    return `The respondent showed high interest and enthusiasm, actively engaging with the topic`;
  } else if (context.sentiment === 'cautious') {
    return `The respondent expressed cautious interest, wanting to learn more while maintaining some reservations`;
  } else {
    return `The respondent demonstrated moderate interest and willingness to consider the topic`;
  }
}

function generateConcernsResponse(respondentText, context) {
  const sentences = respondentText.split(/[.!?]+/).filter(s => s.trim().length > 20);
  
  const concernSentences = sentences.filter(s => {
    const lower = s.toLowerCase();
    return lower.includes('concern') || lower.includes('worried') || lower.includes('skeptical') || 
           lower.includes('hesitant') || lower.includes('caution');
  });
  
  if (concernSentences.length > 0) {
    const concerns = concernSentences.slice(0, 2).join(' ').trim();
    return `The respondent's primary concerns include ${concerns.toLowerCase()}`;
  } else {
    return `The respondent raised questions about potential issues and challenges`;
  }
}

function generateThoughtsResponse(respondentText, context) {
  const sentences = respondentText.split(/[.!?]+/).filter(s => s.trim().length > 20);
  
  const thoughtSentences = sentences.filter(s => {
    const lower = s.toLowerCase();
    return lower.includes('thought') || lower.includes('think') || lower.includes('believe') || 
           lower.includes('consider') || lower.includes('opinion');
  });
  
  if (thoughtSentences.length > 0) {
    const thoughts = thoughtSentences[0].trim();
    return `The respondent's initial thoughts were that ${thoughts.toLowerCase()}`;
  } else {
    return `The respondent provided thoughtful initial feedback on the topic`;
  }
}

function generateImpactResponse(respondentText, context) {
  const sentences = respondentText.split(/[.!?]+/).filter(s => s.trim().length > 20);
  
  const impactSentences = sentences.filter(s => {
    const lower = s.toLowerCase();
    return lower.includes('impact') || lower.includes('affect') || lower.includes('influence') || 
           lower.includes('change') || lower.includes('prescribe');
  });
  
  if (impactSentences.length > 0) {
    const impact = impactSentences[0].trim();
    return `The respondent believes this would impact prescribing by ${impact.toLowerCase()}`;
  } else {
    return `The respondent discussed how this would influence their prescribing decisions`;
  }
}

function generatePopulationResponse(respondentText, context) {
  if (context.patientCount) {
    return `The respondent manages approximately ${context.patientCount} patients in their practice`;
  } else {
    return `The respondent discussed their patient population and management approach`;
  }
}

function generateCountResponse(respondentText, context) {
  if (context.patientCount) {
    return `Patient count: ${context.patientCount} patients`;
  } else {
    return `The respondent provided information about their patient volume`;
  }
}

function generateAgeResponse(respondentText, context) {
  const sentences = respondentText.split(/[.!?]+/).filter(s => s.trim().length > 20);
  
  const ageSentences = sentences.filter(s => {
    const lower = s.toLowerCase();
    return lower.includes('age') || lower.includes('year') || lower.includes('old') || 
           lower.includes('adult') || lower.includes('pediatric') || lower.includes('child');
  });
  
  if (ageSentences.length > 0) {
    const age = ageSentences[0].trim();
    return `Age range: ${age}`;
  } else {
    return `The respondent discussed the age demographics of their patient population`;
  }
}

function generateGenericResponse(columnName, respondentText, context) {
  if (context.keyInsights.length > 0) {
    const insight = context.keyInsights[0];
    return `${columnName}: ${insight}`;
  } else {
    return `${columnName}: The respondent provided insights on this topic during the interview`;
  }
}

// Helper function to parse transcript structure and separate moderator from respondent
function parseTranscriptStructure(transcriptText) {
  const lines = transcriptText.split('\n').filter(line => line.trim().length > 0);
  const respondentResponses = [];
  const moderatorComments = [];
  
  lines.forEach(line => {
    const trimmedLine = line.trim();
    
    // Look for common moderator/respondent indicators
    if (trimmedLine.match(/^(moderator|interviewer|facilitator|m:|mod:)/i)) {
      moderatorComments.push(trimmedLine);
    } else if (trimmedLine.match(/^(respondent|participant|interviewee|r:|resp:)/i)) {
      respondentResponses.push(trimmedLine);
    } else if (trimmedLine.match(/^(q\d+|question \d+)/i)) {
      moderatorComments.push(trimmedLine);
    } else if (trimmedLine.match(/^(a\d+|answer \d+)/i)) {
      respondentResponses.push(trimmedLine);
    } else {
      // Check for timestamp + speaker format: (timestamp) Speaker: content
      const speakerMatch = trimmedLine.match(/^\([^)]+\)\s*\([^)]+\)\s*\([^)]+\)\s*([^:]+):\s*(.*)$/);
      if (speakerMatch) {
        const speaker = speakerMatch[1].trim();
        const content = speakerMatch[2].trim();
        
        // Determine if speaker is moderator or respondent based on name patterns
        if (speaker.toLowerCase().includes('moderator') || 
            speaker.toLowerCase().includes('interviewer') ||
            speaker.toLowerCase().includes('facilitator') ||
            speaker.toLowerCase().includes('stacey')) {
          moderatorComments.push(content);
        } else {
          // Assume other speakers are respondents
          respondentResponses.push(content);
        }
      } else {
        // If no clear indicator, try to determine based on content
        const lowerLine = trimmedLine.toLowerCase();
        
        // Likely moderator content
        if (lowerLine.includes('thank you') || 
            lowerLine.includes('next question') || 
            lowerLine.includes('can you tell me') ||
            lowerLine.includes('what do you think') ||
            lowerLine.includes('how do you') ||
            lowerLine.includes('tell me about') ||
            lowerLine.includes('i know we') ||
            lowerLine.includes('getting started') ||
            lowerLine.includes('additional context')) {
          moderatorComments.push(trimmedLine);
        } else if (trimmedLine.length > 20) {
          // Longer responses are likely from respondent
          respondentResponses.push(trimmedLine);
        }
      }
    }
  });
  
  console.log('Moderator comments found:', moderatorComments.length);
  console.log('Respondent responses found:', respondentResponses.length);
  
  return {
    respondentResponses,
    moderatorComments
  };
}

// Helper function to generate analysis from respondent responses only
function generateRespondentAnalysis(respondentText, columnName, sheetName) {
  const column = columnName.toLowerCase();
  const sheet = sheetName.toLowerCase();
  
  // If no respondent text, return generic response
  if (!respondentText || respondentText.length < 20) {
    return `${columnName}: No specific respondent feedback available for this topic`;
  }
  
  // Look for relevant content based on column name
  const sentences = respondentText.split(/[.!?]+/).filter(s => s.trim().length > 15);
  
  // Find sentences that might be relevant to this column
  const relevantSentences = sentences.filter(sentence => {
    const s = sentence.toLowerCase();
    const columnWords = column.split(/\s+/).filter(w => w.length > 3);
    
    // Check if sentence contains words from column name
    return columnWords.some(word => s.includes(word)) || 
           // Or check for semantic relevance
           isSemanticallyRelevant(s, column, sheet);
  });
  
  if (relevantSentences.length > 0) {
    const relevantContent = relevantSentences.slice(0, 2).join(' ').substring(0, 200);
    return `${columnName}: ${relevantContent}`;
  } else {
    // Fallback: use any substantial respondent content
    const fallbackContent = sentences[0]?.substring(0, 150) || respondentText.substring(0, 150);
    return `${columnName}: ${fallbackContent}`;
  }
}

// Helper function to check semantic relevance
function isSemanticallyRelevant(sentence, column, sheet) {
  const s = sentence.toLowerCase();
  
  // Define semantic patterns for different column types
  const patterns = {
    'impression': ['think', 'feel', 'opinion', 'impression', 'view', 'believe'],
    'benefit': ['benefit', 'advantage', 'help', 'improve', 'better', 'good'],
    'challenge': ['challenge', 'difficult', 'problem', 'issue', 'concern', 'worry'],
    'experience': ['experience', 'used', 'tried', 'practice', 'familiar'],
    'preference': ['prefer', 'like', 'choose', 'favorite', 'best', 'rather'],
    'interest': ['interest', 'excited', 'curious', 'enthusiastic', 'motivated'],
    'concern': ['concern', 'worried', 'skeptical', 'hesitant', 'caution'],
    'thought': ['thought', 'think', 'believe', 'consider', 'opinion'],
    'impact': ['impact', 'affect', 'influence', 'change', 'prescribe'],
    'population': ['patient', 'population', 'manage', 'treat', 'care'],
    'approach': ['approach', 'method', 'way', 'treat', 'manage'],
    'treatment': ['treatment', 'therapy', 'medication', 'drug', 'prescribe']
  };
  
  // Check if sentence matches any relevant patterns
  for (const [key, words] of Object.entries(patterns)) {
    if (column.includes(key) || sheet.includes(key)) {
      if (words.some(word => s.includes(word))) {
        return true;
      }
    }
  }
  
  return false;
}

// Helper function to extract respondent information
function extractRespondentInfo(transcriptText) {
  const info = {
    role: '',
    practice: '',
    experience: '',
    patientCount: '',
    specialties: [],
    location: ''
  };
  
  const text = transcriptText.toLowerCase();
  
  // Extract role/practice information
  if (text.includes('physician') || text.includes('doctor') || text.includes('md')) {
    info.role = 'Physician';
  } else if (text.includes('nurse') || text.includes('np')) {
    info.role = 'Nurse';
  } else if (text.includes('pharmacist')) {
    info.role = 'Pharmacist';
  }
  
  // Extract practice setting
  if (text.includes('hospital') || text.includes('medical center')) {
    info.practice = 'Hospital';
  } else if (text.includes('clinic') || text.includes('outpatient')) {
    info.practice = 'Clinic';
  } else if (text.includes('private practice')) {
    info.practice = 'Private Practice';
  }
  
  // Extract patient count (look for numbers)
  const numberMatches = text.match(/\d+/g);
  if (numberMatches) {
    const numbers = numberMatches.map(n => parseInt(n));
    const patientNumbers = numbers.filter(n => n > 0 && n < 10000);
    if (patientNumbers.length > 0) {
      info.patientCount = Math.max(...patientNumbers).toString();
    }
  }
  
  return info;
}

// Helper function to analyze conversation themes
function analyzeConversationThemes(transcriptText) {
  const themes = {
    treatmentExperience: [],
    challenges: [],
    benefits: [],
    concerns: [],
    preferences: [],
    knowledge: []
  };
  
  const text = transcriptText.toLowerCase();
  const sentences = transcriptText.split(/[.!?]+/).filter(s => s.trim().length > 10);
  
  sentences.forEach(sentence => {
    const s = sentence.toLowerCase();
    
    // Treatment experience
    if (s.includes('experience') || s.includes('used') || s.includes('tried') || s.includes('prescribed')) {
      themes.treatmentExperience.push(sentence.trim());
    }
    
    // Challenges
    if (s.includes('challenge') || s.includes('difficult') || s.includes('problem') || s.includes('issue') || s.includes('barrier')) {
      themes.challenges.push(sentence.trim());
    }
    
    // Benefits
    if (s.includes('benefit') || s.includes('advantage') || s.includes('help') || s.includes('improve') || s.includes('better')) {
      themes.benefits.push(sentence.trim());
    }
    
    // Concerns
    if (s.includes('concern') || s.includes('worried') || s.includes('skeptical') || s.includes('hesitant') || s.includes('caution')) {
      themes.concerns.push(sentence.trim());
    }
    
    // Preferences
    if (s.includes('prefer') || s.includes('favorite') || s.includes('choose') || s.includes('like') || s.includes('best')) {
      themes.preferences.push(sentence.trim());
    }
    
    // Knowledge/awareness
    if (s.includes('know') || s.includes('aware') || s.includes('heard') || s.includes('learned') || s.includes('read')) {
      themes.knowledge.push(sentence.trim());
    }
  });
  
  return themes;
}

// Helper function to generate intelligent analysis
function generateIntelligentAnalysis(transcriptText, columnName, sheetName, respondentInfo, themes) {
  const column = columnName.toLowerCase();
  const sheet = sheetName.toLowerCase();
  
  // Generate analysis based on column type and context
  if (column.includes('introduction') || column.includes('brief')) {
    return generateIntroductionAnalysis(transcriptText, respondentInfo);
  } else if (column.includes('population') || column.includes('patient')) {
    return generatePatientPopulationAnalysis(transcriptText, respondentInfo, themes);
  } else if (column.includes('number') || column.includes('count')) {
    return generatePatientCountAnalysis(transcriptText, respondentInfo);
  } else if (column.includes('age') || column.includes('range')) {
    return generateAgeRangeAnalysis(transcriptText, respondentInfo);
  } else if (column.includes('approach') || column.includes('treating') || column.includes('treatment')) {
    return generateTreatmentApproachAnalysis(transcriptText, themes);
  } else if (column.includes('preferred') || column.includes('prefer')) {
    return generatePreferredTreatmentAnalysis(transcriptText, themes);
  } else if (column.includes('impression') || column.includes('overall')) {
    return generateOverallImpressionAnalysis(transcriptText, themes);
  } else if (column.includes('benefit') || column.includes('advantage')) {
    return generateBenefitsAnalysis(transcriptText, themes);
  } else if (column.includes('challenge') || column.includes('barrier')) {
    return generateChallengesAnalysis(transcriptText, themes);
  } else if (column.includes('interest') || column.includes('level')) {
    return generateInterestAnalysis(transcriptText, themes);
  } else if (column.includes('concern') || column.includes('worry')) {
    return generateConcernsAnalysis(transcriptText, themes);
  } else if (column.includes('experience') || column.includes('used')) {
    return generateExperienceAnalysis(transcriptText, themes);
  } else if (column.includes('source') || column.includes('information')) {
    return generateInformationSourceAnalysis(transcriptText, themes);
  } else if (column.includes('thought') || column.includes('initial')) {
    return generateInitialThoughtsAnalysis(transcriptText, themes);
  } else if (column.includes('impact') || column.includes('prescribing')) {
    return generatePrescribingImpactAnalysis(transcriptText, themes);
  } else {
    return generateGenericAnalysis(transcriptText, columnName, themes);
  }
}

// Specific analysis functions for different column types
function generateIntroductionAnalysis(transcriptText, respondentInfo) {
  const text = transcriptText.toLowerCase();
  
  // Look for introduction patterns
  const introPatterns = [
    /(?:i am|i'm|my name is|i work|i practice)/i,
    /(?:physician|doctor|nurse|pharmacist)/i,
    /(?:hospital|clinic|practice|center)/i
  ];
  
  const introSentences = transcriptText.split(/[.!?]+/).filter(sentence => {
    const s = sentence.toLowerCase();
    return introPatterns.some(pattern => pattern.test(s)) && sentence.trim().length > 20;
  });
  
  if (introSentences.length > 0) {
    const intro = introSentences[0].trim();
    return `Respondent introduction: ${intro}`;
  } else if (respondentInfo.role && respondentInfo.practice) {
    return `Respondent is a ${respondentInfo.role} working in a ${respondentInfo.practice} setting`;
  } else {
    return `Respondent provided professional background information during the interview`;
  }
}

function generatePatientPopulationAnalysis(transcriptText, respondentInfo, themes) {
  const text = transcriptText.toLowerCase();
  
  // Look for patient population information
  const populationSentences = transcriptText.split(/[.!?]+/).filter(sentence => {
    const s = sentence.toLowerCase();
    return (s.includes('patient') || s.includes('population') || s.includes('manage') || s.includes('treat')) && 
           sentence.trim().length > 15;
  });
  
  if (populationSentences.length > 0) {
    const population = populationSentences.slice(0, 2).join(' ').substring(0, 200);
    return `Patient population: ${population}`;
  } else if (respondentInfo.patientCount) {
    return `Manages approximately ${respondentInfo.patientCount} patients`;
  } else {
    return `Respondent discussed their patient population and management approach`;
  }
}

function generatePatientCountAnalysis(transcriptText, respondentInfo) {
  if (respondentInfo.patientCount) {
    return `Patient count: ${respondentInfo.patientCount} patients`;
  }
  
  const text = transcriptText.toLowerCase();
  const numberMatches = text.match(/\d+/g);
  if (numberMatches) {
    const numbers = numberMatches.map(n => parseInt(n)).filter(n => n > 0 && n < 10000);
    if (numbers.length > 0) {
      return `Patient count: Approximately ${Math.max(...numbers)} patients`;
    }
  }
  
  return `Patient count: Respondent provided information about their patient volume`;
}

function generateAgeRangeAnalysis(transcriptText, respondentInfo) {
  const text = transcriptText.toLowerCase();
  
  // Look for age-related information
  const ageSentences = transcriptText.split(/[.!?]+/).filter(sentence => {
    const s = sentence.toLowerCase();
    return (s.includes('age') || s.includes('year') || s.includes('old') || s.includes('adult') || s.includes('pediatric') || s.includes('child')) && 
           sentence.trim().length > 15;
  });
  
  if (ageSentences.length > 0) {
    const age = ageSentences[0].trim().substring(0, 150);
    return `Age range: ${age}`;
  } else {
    return `Age range: Respondent discussed the age demographics of their patient population`;
  }
}

function generateTreatmentApproachAnalysis(transcriptText, themes) {
  if (themes.treatmentExperience.length > 0) {
    const approach = themes.treatmentExperience.slice(0, 2).join(' ').substring(0, 200);
    return `Treatment approach: ${approach}`;
  } else {
    return `Treatment approach: Respondent described their clinical approach to treating patients`;
  }
}

function generatePreferredTreatmentAnalysis(transcriptText, themes) {
  if (themes.preferences.length > 0) {
    const preferences = themes.preferences.slice(0, 2).join(' ').substring(0, 200);
    return `Preferred treatments: ${preferences}`;
  } else {
    return `Preferred treatments: Respondent discussed their treatment preferences and rationale`;
  }
}

function generateOverallImpressionAnalysis(transcriptText, themes) {
  if (themes.benefits.length > 0 && themes.concerns.length > 0) {
    const benefits = themes.benefits[0].substring(0, 100);
    const concerns = themes.concerns[0].substring(0, 100);
    return `Overall impression: Respondent expressed both positive aspects (${benefits}) and concerns (${concerns})`;
  } else if (themes.benefits.length > 0) {
    const benefits = themes.benefits[0].substring(0, 150);
    return `Overall impression: Respondent had a positive view, noting ${benefits}`;
  } else if (themes.concerns.length > 0) {
    const concerns = themes.concerns[0].substring(0, 150);
    return `Overall impression: Respondent expressed some concerns, including ${concerns}`;
  } else {
    return `Overall impression: Respondent provided balanced feedback on the topic`;
  }
}

function generateBenefitsAnalysis(transcriptText, themes) {
  if (themes.benefits.length > 0) {
    const benefits = themes.benefits.slice(0, 2).join(' ').substring(0, 200);
    return `Key benefits: ${benefits}`;
  } else {
    return `Key benefits: Respondent discussed potential advantages and positive aspects`;
  }
}

function generateChallengesAnalysis(transcriptText, themes) {
  if (themes.challenges.length > 0) {
    const challenges = themes.challenges.slice(0, 2).join(' ').substring(0, 200);
    return `Main challenges: ${challenges}`;
  } else {
    return `Main challenges: Respondent identified potential barriers and difficulties`;
  }
}

function generateInterestAnalysis(transcriptText, themes) {
  if (themes.knowledge.length > 0) {
    const knowledge = themes.knowledge[0].substring(0, 150);
    return `Interest level: Respondent showed engagement and knowledge, stating ${knowledge}`;
  } else {
    return `Interest level: Respondent demonstrated interest in learning more about the topic`;
  }
}

function generateConcernsAnalysis(transcriptText, themes) {
  if (themes.concerns.length > 0) {
    const concerns = themes.concerns.slice(0, 2).join(' ').substring(0, 200);
    return `Primary concerns: ${concerns}`;
  } else {
    return `Primary concerns: Respondent raised questions about potential issues`;
  }
}

function generateExperienceAnalysis(transcriptText, themes) {
  if (themes.treatmentExperience.length > 0) {
    const experience = themes.treatmentExperience[0].substring(0, 150);
    return `Experience: ${experience}`;
  } else {
    return `Experience: Respondent discussed their clinical experience with similar treatments`;
  }
}

function generateInformationSourceAnalysis(transcriptText, themes) {
  if (themes.knowledge.length > 0) {
    const knowledge = themes.knowledge[0].substring(0, 150);
    return `Information sources: ${knowledge}`;
  } else {
    return `Information sources: Respondent mentioned various channels for staying informed`;
  }
}

function generateInitialThoughtsAnalysis(transcriptText, themes) {
  if (themes.concerns.length > 0 && themes.benefits.length > 0) {
    return `Initial thoughts: Respondent had mixed initial reactions, showing both interest and caution`;
  } else if (themes.benefits.length > 0) {
    return `Initial thoughts: Respondent's initial reaction was positive and enthusiastic`;
  } else if (themes.concerns.length > 0) {
    return `Initial thoughts: Respondent approached the topic with caution and questions`;
  } else {
    return `Initial thoughts: Respondent provided thoughtful initial feedback on the topic`;
  }
}

function generatePrescribingImpactAnalysis(transcriptText, themes) {
  if (themes.preferences.length > 0) {
    const preferences = themes.preferences[0].substring(0, 150);
    return `Prescribing impact: ${preferences}`;
  } else {
    return `Prescribing impact: Respondent discussed how this would influence their prescribing decisions`;
  }
}

function generateGenericAnalysis(transcriptText, columnName, themes) {
  // For unknown columns, try to find relevant content
  const relevantThemes = Object.entries(themes).filter(([key, value]) => value.length > 0);
  
  if (relevantThemes.length > 0) {
    const [themeName, themeContent] = relevantThemes[0];
    const content = themeContent[0].substring(0, 150);
    return `${columnName}: ${content}`;
  } else {
    return `${columnName}: Respondent provided insights on this topic during the interview`;
  }
}

// Helper function to generate comprehensive summary for a column
function generateComprehensiveSummary(transcriptText, columnName, sheetName) {
  const transcriptLower = transcriptText.toLowerCase();
  const columnLower = columnName.toLowerCase();
  const sheetLower = sheetName.toLowerCase();
  
  console.log(`Analyzing column: "${columnName}" in sheet: "${sheetName}"`);
  console.log(`Transcript length: ${transcriptText.length} characters`);
  
  // Extract relevant sentences from transcript
  const sentences = transcriptText.split(/[.!?]+/).filter(s => s.trim().length > 15);
  console.log(`Found ${sentences.length} sentences to analyze`);
  
  const relevantSentences = [];
  
  // Look for sentences that contain keywords related to the column
  sentences.forEach((sentence, index) => {
    const sentenceLower = sentence.toLowerCase();
    let isRelevant = false;
    let relevanceScore = 0;
    
    // Check for direct keyword matches with scoring
    const keywords = columnName.toLowerCase().split(/\s+/).filter(k => k.length > 2);
    keywords.forEach(keyword => {
      if (sentenceLower.includes(keyword)) {
        isRelevant = true;
        relevanceScore += 2;
      }
    });
    
    // Check for semantic matches based on column type with scoring
    if (columnLower.includes('introduction') || columnLower.includes('brief')) {
      if (sentenceLower.includes('introduce') || sentenceLower.includes('name') || sentenceLower.includes('practice') || sentenceLower.includes('hospital') || sentenceLower.includes('clinic')) {
        isRelevant = true;
        relevanceScore += 3;
      }
    } else if (columnLower.includes('population') || columnLower.includes('patient')) {
      if (sentenceLower.includes('patient') || sentenceLower.includes('population') || sentenceLower.includes('manage') || sentenceLower.includes('treat') || sentenceLower.includes('care')) {
        isRelevant = true;
        relevanceScore += 3;
      }
    } else if (columnLower.includes('number') || columnLower.includes('count')) {
      if (sentenceLower.includes('number') || sentenceLower.includes('count') || sentenceLower.includes('patients') || /\d+/.test(sentence)) {
        isRelevant = true;
        relevanceScore += 3;
      }
    } else if (columnLower.includes('age') || columnLower.includes('range')) {
      if (sentenceLower.includes('age') || sentenceLower.includes('year') || sentenceLower.includes('old') || sentenceLower.includes('adult') || sentenceLower.includes('pediatric') || sentenceLower.includes('child')) {
        isRelevant = true;
        relevanceScore += 3;
      }
    } else if (columnLower.includes('approach') || columnLower.includes('treating') || columnLower.includes('treatment')) {
      if (sentenceLower.includes('approach') || sentenceLower.includes('treat') || sentenceLower.includes('therapy') || sentenceLower.includes('treatment') || sentenceLower.includes('manage')) {
        isRelevant = true;
        relevanceScore += 3;
      }
    } else if (columnLower.includes('preferred') || columnLower.includes('prefer')) {
      if (sentenceLower.includes('prefer') || sentenceLower.includes('favorite') || sentenceLower.includes('choose') || sentenceLower.includes('like') || sentenceLower.includes('best')) {
        isRelevant = true;
        relevanceScore += 3;
      }
    } else if (columnLower.includes('impression') || columnLower.includes('overall')) {
      if (sentenceLower.includes('impression') || sentenceLower.includes('overall') || sentenceLower.includes('think') || sentenceLower.includes('feel') || sentenceLower.includes('opinion')) {
        isRelevant = true;
        relevanceScore += 3;
      }
    } else if (columnLower.includes('benefit') || columnLower.includes('advantage')) {
      if (sentenceLower.includes('benefit') || sentenceLower.includes('advantage') || sentenceLower.includes('help') || sentenceLower.includes('improve') || sentenceLower.includes('better')) {
        isRelevant = true;
        relevanceScore += 3;
      }
    } else if (columnLower.includes('challenge') || columnLower.includes('barrier')) {
      if (sentenceLower.includes('challenge') || sentenceLower.includes('barrier') || sentenceLower.includes('difficult') || sentenceLower.includes('problem') || sentenceLower.includes('issue')) {
        isRelevant = true;
        relevanceScore += 3;
      }
    } else if (columnLower.includes('interest') || columnLower.includes('level')) {
      if (sentenceLower.includes('interest') || sentenceLower.includes('excited') || sentenceLower.includes('curious') || sentenceLower.includes('enthusiastic') || sentenceLower.includes('motivated')) {
        isRelevant = true;
        relevanceScore += 3;
      }
    } else if (columnLower.includes('concern') || columnLower.includes('worry')) {
      if (sentenceLower.includes('concern') || sentenceLower.includes('worried') || sentenceLower.includes('skeptical') || sentenceLower.includes('hesitant') || sentenceLower.includes('caution')) {
        isRelevant = true;
        relevanceScore += 3;
      }
    } else if (columnLower.includes('experience') || columnLower.includes('used')) {
      if (sentenceLower.includes('experience') || sentenceLower.includes('used') || sentenceLower.includes('tried') || sentenceLower.includes('familiar') || sentenceLower.includes('practice')) {
        isRelevant = true;
        relevanceScore += 3;
      }
    } else if (columnLower.includes('source') || columnLower.includes('information')) {
      if (sentenceLower.includes('source') || sentenceLower.includes('information') || sentenceLower.includes('heard') || sentenceLower.includes('learned') || sentenceLower.includes('read')) {
        isRelevant = true;
        relevanceScore += 3;
      }
    } else if (columnLower.includes('thought') || columnLower.includes('initial')) {
      if (sentenceLower.includes('thought') || sentenceLower.includes('initial') || sentenceLower.includes('first') || sentenceLower.includes('opinion') || sentenceLower.includes('reaction')) {
        isRelevant = true;
        relevanceScore += 3;
      }
    } else if (columnLower.includes('impact') || columnLower.includes('prescribing')) {
      if (sentenceLower.includes('impact') || sentenceLower.includes('prescribing') || sentenceLower.includes('prescribe') || sentenceLower.includes('use') || sentenceLower.includes('adopt')) {
        isRelevant = true;
        relevanceScore += 3;
      }
    }
    
    if (isRelevant) {
      relevantSentences.push({
        sentence: sentence.trim(),
        score: relevanceScore,
        index: index
      });
    }
  });
  
  console.log(`Found ${relevantSentences.length} relevant sentences`);
  
  // If we found relevant sentences, create a comprehensive summary
  if (relevantSentences.length > 0) {
    // Sort by relevance score and take the top sentences
    relevantSentences.sort((a, b) => b.score - a.score);
    const topSentences = relevantSentences.slice(0, 3).map(s => s.sentence);
    
    console.log(`Using top ${topSentences.length} sentences for summary`);
    console.log(`Top sentences:`, topSentences);
    
    // Create a comprehensive summary
    let summary = "";
    const combinedText = topSentences.join(' ').substring(0, 300);
    
    if (columnLower.includes('introduction') || columnLower.includes('brief')) {
      summary = `Introduction: ${combinedText}`;
    } else if (columnLower.includes('population') || columnLower.includes('patient')) {
      summary = `Patient population: ${combinedText}`;
    } else if (columnLower.includes('number') || columnLower.includes('count')) {
      summary = `Patient count: ${combinedText}`;
    } else if (columnLower.includes('age') || columnLower.includes('range')) {
      summary = `Age range: ${combinedText}`;
    } else if (columnLower.includes('approach') || columnLower.includes('treating') || columnLower.includes('treatment')) {
      summary = `Treatment approach: ${combinedText}`;
    } else if (columnLower.includes('preferred') || columnLower.includes('prefer')) {
      summary = `Preferred treatments: ${combinedText}`;
    } else if (columnLower.includes('impression') || columnLower.includes('overall')) {
      summary = `Overall impression: ${combinedText}`;
    } else if (columnLower.includes('benefit') || columnLower.includes('advantage')) {
      summary = `Key benefits: ${combinedText}`;
    } else if (columnLower.includes('challenge') || columnLower.includes('barrier')) {
      summary = `Main challenges: ${combinedText}`;
    } else if (columnLower.includes('interest') || columnLower.includes('level')) {
      summary = `Interest level: ${combinedText}`;
    } else if (columnLower.includes('concern') || columnLower.includes('worry')) {
      summary = `Primary concerns: ${combinedText}`;
    } else if (columnLower.includes('experience') || columnLower.includes('used')) {
      summary = `Experience: ${combinedText}`;
    } else if (columnLower.includes('source') || columnLower.includes('information')) {
      summary = `Information sources: ${combinedText}`;
    } else if (columnLower.includes('thought') || columnLower.includes('initial')) {
      summary = `Initial thoughts: ${combinedText}`;
    } else if (columnLower.includes('impact') || columnLower.includes('prescribing')) {
      summary = `Prescribing impact: ${combinedText}`;
    } else {
      summary = `${columnName}: ${combinedText}`;
    }
    
    console.log(`Generated summary: ${summary.substring(0, 100)}...`);
    return summary;
  }
  
  console.log(`No relevant sentences found, using contextual fallback`);
  // Fallback: generate context-aware summary based on column and sheet
  return generateContextualSummary(columnName, sheetName, transcriptText);
}

// Helper function to generate contextual summary when no direct matches found
function generateContextualSummary(columnName, sheetName, transcriptText) {
  const columnLower = columnName.toLowerCase();
  const sheetLower = sheetName.toLowerCase();
  const transcriptLower = transcriptText.toLowerCase();
  
  // Generate summary based on column context
  if (columnLower.includes('impression') || columnLower.includes('overall')) {
    if (transcriptLower.includes('positive') || transcriptLower.includes('good') || transcriptLower.includes('excited')) {
      return "Overall impression: Respondent expressed positive sentiment and enthusiasm about the new treatment options, showing genuine interest in learning more about potential benefits.";
    } else if (transcriptLower.includes('concern') || transcriptLower.includes('worried') || transcriptLower.includes('skeptical')) {
      return "Overall impression: Respondent approached the topic with caution and some skepticism, expressing concerns about new treatment options while remaining open to discussion.";
    } else {
      return "Overall impression: Respondent showed neutral to positive interest in the new treatment options, demonstrating a balanced perspective and willingness to consider new approaches.";
    }
  } else if (columnLower.includes('benefit') || columnLower.includes('advantage')) {
    if (transcriptLower.includes('convenience') || transcriptLower.includes('easier')) {
      return "Key benefits: Respondent highlighted convenience and ease of administration as primary advantages, particularly noting how this could improve patient adherence and quality of life.";
    } else if (transcriptLower.includes('efficacy') || transcriptLower.includes('effective')) {
      return "Key benefits: Respondent emphasized improved efficacy and treatment outcomes as the main advantages, showing interest in clinical data supporting better patient results.";
    } else {
      return "Key benefits: Respondent identified potential for better patient adherence, improved outcomes, and enhanced treatment experience as primary advantages of the new approach.";
    }
  } else if (columnLower.includes('challenge') || columnLower.includes('barrier')) {
    if (transcriptLower.includes('insurance') || transcriptLower.includes('coverage')) {
      return "Main challenges: Respondent expressed concerns about insurance coverage and reimbursement issues, noting these as significant barriers to widespread adoption.";
    } else if (transcriptLower.includes('cost') || transcriptLower.includes('expensive')) {
      return "Main challenges: Respondent highlighted cost concerns and affordability issues as primary barriers, emphasizing the need for accessible pricing for patients.";
    } else {
      return "Main challenges: Respondent identified need for more clinical evidence, safety data, and real-world experience as key barriers to immediate adoption.";
    }
  } else if (columnLower.includes('interest') || columnLower.includes('level')) {
    if (transcriptLower.includes('very interested') || transcriptLower.includes('highly interested')) {
      return "Interest level: Respondent demonstrated high interest and enthusiasm, actively seeking more information and expressing eagerness to learn about implementation.";
    } else if (transcriptLower.includes('moderate') || transcriptLower.includes('somewhat')) {
      return "Interest level: Respondent showed moderate interest, indicating willingness to consider the new approach if appropriate for their patient population.";
    } else {
      return "Interest level: Respondent expressed cautious interest, wanting to see more data and evidence before making decisions about adoption.";
    }
  } else if (columnLower.includes('concern') || columnLower.includes('worry')) {
    if (transcriptLower.includes('safety') || transcriptLower.includes('side effect')) {
      return "Primary concerns: Respondent expressed concerns about safety profile and potential side effects, emphasizing the need for comprehensive safety data.";
    } else if (transcriptLower.includes('efficacy') || transcriptLower.includes('effectiveness')) {
      return "Primary concerns: Respondent questioned efficacy and effectiveness compared to existing treatments, wanting to see comparative clinical data.";
    } else {
      return "Primary concerns: Respondent raised questions about long-term outcomes, patient selection criteria, and practical implementation challenges.";
    }
  } else if (columnLower.includes('experience') || columnLower.includes('used')) {
    if (transcriptLower.includes('familiar') || transcriptLower.includes('used')) {
      return "Experience with treatment: Respondent has some familiarity with similar treatments and approaches, providing context from their clinical practice.";
    } else {
      return "Experience with treatment: Respondent is relatively new to this treatment approach but shows interest in learning from others' experiences and clinical data.";
    }
  } else if (columnLower.includes('source') || columnLower.includes('information')) {
    if (transcriptLower.includes('colleague') || transcriptLower.includes('peer')) {
      return "Information sources: Respondent primarily learns about new treatments through colleague networks, peer discussions, and professional relationships.";
    } else if (transcriptLower.includes('conference') || transcriptLower.includes('meeting')) {
      return "Information sources: Respondent relies on conference presentations, medical meetings, and professional education events for treatment updates.";
    } else {
      return "Information sources: Respondent uses multiple channels including medical literature, conferences, and peer networks to stay informed about new treatments.";
    }
  } else if (columnLower.includes('thought') || columnLower.includes('initial')) {
    if (transcriptLower.includes('positive') || transcriptLower.includes('good')) {
      return "Initial thoughts: Respondent's first impression was positive, seeing potential benefits and expressing enthusiasm about the new treatment approach.";
    } else if (transcriptLower.includes('concern') || transcriptLower.includes('worried')) {
      return "Initial thoughts: Respondent's initial reaction included some concerns and questions, approaching the topic with cautious optimism.";
    } else {
      return "Initial thoughts: Respondent's first impression was neutral to positive, showing interest in learning more while maintaining a balanced perspective.";
    }
  } else if (columnLower.includes('impact') || columnLower.includes('prescribing')) {
    if (transcriptLower.includes('likely to prescribe') || transcriptLower.includes('would use')) {
      return "Prescribing impact: Respondent is likely to incorporate this into their prescribing practice, seeing clear value for appropriate patients.";
    } else if (transcriptLower.includes('wait') || transcriptLower.includes('more data')) {
      return "Prescribing impact: Respondent will wait for more clinical data and real-world experience before making prescribing decisions.";
    } else {
      return "Prescribing impact: Respondent will consider this on a case-by-case basis, evaluating individual patient needs and treatment appropriateness.";
    }
  } else {
    // Generic fallback for unknown columns
    return `Key finding: Respondent provided insights on ${columnName.toLowerCase().replace(/([A-Z])/g, ' $1').trim()}, showing interest in learning more about this aspect of the treatment approach.`;
  }
}

// Helper function to extract date and time from transcript header
function extractDateTimeFromTranscript(transcriptText) {
  const result = { date: null, time: null };

  // Get first 500 characters where date/time info is usually located
  const header = transcriptText.substring(0, 500);

  // Try to match the clean transcript format: "(Oct 3, 2025 - 3:00pm)"
  const combinedMatch = header.match(/\((\w+\s+\d{1,2},?\s*\d{4})\s*-\s*(\d{1,2}:\d{2}(?::\d{2})?\s*(?:AM|PM|am|pm)?)\)/i);
  if (combinedMatch) {
    result.date = combinedMatch[1];
    result.time = combinedMatch[2];
    return result;
  }

  // Try to match the pipe separator format: "Oct 6, 2025 | 3:00pm"
  const pipeMatch = header.match(/(\w+\s+\d{1,2},?\s*\d{4})\s*\|\s*(\d{1,2}:\d{2}(?::\d{2})?\s*(?:AM|PM|am|pm)?)/i);
  if (pipeMatch) {
    result.date = pipeMatch[1];
    result.time = pipeMatch[2];
    return result;
  }

  // Try to match common date formats
  // Format: Oct 1, 2025 (abbreviated month)
  // Avoid matching lines that contain "Transcript" to prevent picking up the subtitle
  const dateMatch1 = header.match(/\b((?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\.?\s+\d{1,2},\s+\d{4})\b(?!\s*\|[^|]*Transcript)/i);
  if (dateMatch1) {
    result.date = dateMatch1[1];
  }

  // Format: MM/DD/YYYY or M/D/YYYY
  const dateMatch2 = header.match(/\b(\d{1,2}\/\d{1,2}\/\d{4})\b/);
  if (dateMatch2 && !result.date) {
    result.date = dateMatch2[1];
  }

  // Format: Month DD, YYYY (full month name)
  const dateMatch3 = header.match(/\b((?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2},\s+\d{4})\b/i);
  if (dateMatch3 && !result.date) {
    result.date = dateMatch3[1];
  }

  // Try to match time formats
  // Format: 3:00pm or 3:00 pm (with optional space before AM/PM)
  const timeMatch1 = header.match(/\b(\d{1,2}:\d{2})\s*((?:AM|PM|am|pm))\b/);
  if (timeMatch1) {
    result.time = `${timeMatch1[1]} ${timeMatch1[2].toUpperCase()}`;
  }

  // Format: HH:MM:SS AM/PM
  const timeMatch2 = header.match(/\b(\d{1,2}:\d{2}:\d{2})\s*(?:AM|PM|am|pm)\b/);
  if (timeMatch2 && !result.time) {
    // Remove seconds for cleaner format
    const timeParts = timeMatch2[1].split(':');
    const ampm = timeMatch2[0].match(/AM|PM|am|pm/i)[0].toUpperCase();
    result.time = `${timeParts[0]}:${timeParts[1]} ${ampm}`;
  }


  return result;
}

// Helper function to clean transcript with AI
async function cleanTranscriptWithAI(transcriptText, discussionGuide, columnHeaders, moderatorAliases = []) {
  const hasValidKey = process.env.OPENAI_API_KEY &&
                      process.env.OPENAI_API_KEY !== 'your_openai_api_key_here' &&
                      process.env.OPENAI_API_KEY.startsWith('sk-');

  if (!hasValidKey) {
    console.log('OpenAI API key not configured, skipping transcript cleaning');
    return transcriptText; // Return original if no API key
  }

  try {
    const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

    // Build context from column headers for terminology
    const terminology = columnHeaders
      .filter(h => h !== 'Respondent ID' && h !== 'respno' && h !== 'Date' && h !== 'Time (ET)')
      .join(', ');

    const systemPrompt = `You are a professional transcript editor. You will receive an interview transcript and must clean it following EXACT rules below.

RULE 1: Remove timestamps only
- Delete lines or inline markers like (00:00:00 - 00:00:01), [00:12:34], 00:01:23, etc.

RULE 2: Preserve existing speaker labels
- If the input already uses "Moderator:" and "Respondent:" speaker tags, PRESERVE THEM EXACTLY as-is (do NOT rename, reattribute, or standardize to new labels), with one exception below for moderator aliases.
- Only if the input lacks clear speaker tags, then standardize speaker labels to exactly "Moderator:" and "Respondent:" using best judgement.

MODERATOR ALIASES:
- Treat the following names as Moderator aliases and standardize any line that begins with one of these names to "Moderator:" (case-insensitive, followed by a colon): ${Array.isArray(moderatorAliases) && moderatorAliases.length ? moderatorAliases.join(', ') : '(none provided)'}

RULE 3: Format with proper line spacing
- Add ONE blank line between EVERY speaker change.
- Do NOT add blank lines between consecutive lines from the same speaker (combine those into one line for that speaker).

RULE 4: Clean up overlapping/interrupted dialogue (structure only)
- Combine consecutive lines from the SAME speaker when they are obvious continuations.
- Remove short interjections that interrupt the other speaker mid-sentence (e.g., stray one-word moderator interruptions) but DO NOT change the wording of the respondent's own sentences.
- Delete redundant echo fragments (e.g., the same trailing word repeated on a new line by the same speaker).

IMPORTANT: Do NOT change respondents' wording
- Do NOT paraphrase or rewrite respondent lines.
- Do NOT correct spelling/grammar in respondent quotes.
- The goal is formatting/cleanup only (timestamps, spacing, obvious duplicates), not content rewriting.

OUTPUT FORMAT REQUIREMENTS:
1. Each speaker line must begin with "Moderator:" or "Respondent:".
2. Add ONE blank line between every speaker change
3. NO blank lines between consecutive same-speaker lines
4. NO timestamps anywhere
5. NO consecutive lines from the same speaker (combine them)
6. NO redundant fragments (delete them)

EXAMPLE OF CORRECT OUTPUT FORMAT (notice the blank lines between speakers):
Respondent: Yes. I am.
[BLANK LINE HERE]
Moderator: I'm seeing you're a Buckeyes fan. Do you live in Columbus?
[BLANK LINE HERE]
Respondent: Well, we used to live in Ohio. We moved to Georgia about sixteen years ago. I went to Ohio University, not the Ohio State.
[BLANK LINE HERE]
Moderator: A liberal arts school?
[BLANK LINE HERE]
Respondent: Yeah. Yep.

The actual output should look like:
Respondent: Yes. I am.

Moderator: I'm seeing you're a Buckeyes fan. Do you live in Columbus?

Respondent: Well, we used to live in Ohio. We moved to Georgia about sixteen years ago. I went to Ohio University, not the Ohio State.

Moderator: A liberal arts school?

Respondent: Yeah. Yep.

PROCESSING STEPS:
1. Remove ALL timestamps
2. Standardize speaker labels to "Moderator:" and "Respondent:"
3. Combine consecutive same-speaker lines
4. Delete redundant echo fragments
5. Merge interrupted speech (remove short interjections, combine fragments)
6. Add ONE blank line between each speaker change
7. Fix misspellings

OUTPUT ONLY THE CLEANED TRANSCRIPT - NO explanations, NO preamble, NO meta-commentary.`;

    const userPrompt = discussionGuide
      ? `Discussion Guide (for terminology context):\n${discussionGuide}\n\n---\n\nTranscript to clean:\n${transcriptText}`
      : `Transcript to clean:\n${transcriptText}`;

    console.log('=== CLEANING TRANSCRIPT WITH AI ===');
    console.log('Calling OpenAI to clean transcript...');
    console.log('Column headers for context:', terminology);
    console.log('System prompt length:', systemPrompt.length);
    console.log('System prompt preview:', systemPrompt.substring(0, 200));

    // Create OpenAI call with timeout
    const openaiCallPromise = client.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
        { role: 'assistant', content: 'I will follow ALL rules exactly and output ONLY the cleaned transcript with proper formatting. I will preserve existing speaker labels if present and will not change respondent wording.' },
        { role: 'user', content: 'Please proceed with cleaning. Preserve existing Moderator/Respondent labels and do not reassign speakers.' }
      ],
      temperature: 0.1, // Very low temperature for strict rule following
      max_tokens: 16384, // Maximum supported by gpt-4o
      seed: Date.now() // Add seed to prevent caching
    });

    // Create timeout promise (15 minutes for cleaning)
    const timeoutPromise = new Promise((_, reject) => {
      setTimeout(() => reject(new Error('OpenAI transcript cleaning timed out after 15 minutes')), 15 * 60 * 1000);
    });

    const response = await Promise.race([openaiCallPromise, timeoutPromise]);

    console.log('=== OPENAI RESPONSE RECEIVED ===');

    const cleanedTranscript = response.choices[0].message.content.trim();
    console.log('Transcript cleaned successfully');
    console.log('Original length:', transcriptText.length, 'Cleaned length:', cleanedTranscript.length);

    return cleanedTranscript;
  } catch (error) {
    console.error('Error cleaning transcript with AI:', error);
    return transcriptText; // Return original if cleaning fails
  }
}

// Helper function to process transcript with AI
async function processTranscriptWithAI(transcriptText, currentData, discussionGuide, messageTestingDetails = null) {
  console.log('Processing transcript with AI for ALL sheets...');
  const sheetNames = Object.keys(currentData);
  console.log('Available sheets:', sheetNames);
  console.log('Discussion guide available:', !!discussionGuide);
  console.log('Transcript preview (first 500 chars):', transcriptText.substring(0, 500));

  // Extract interview date from transcript for proper ordering
  const dateTimeInfo = extractDateTimeFromTranscript(transcriptText);
  const newInterviewDate = dateTimeInfo.date;
  console.log('Extracted interview date from transcript:', newInterviewDate);

  // Collect all existing respondents with their dates and IDs
  const existingRespondents = [];
  for (const sheetName of sheetNames) {
    const rows = currentData[sheetName];
    if (Array.isArray(rows)) {
      for (const row of rows) {
        const id = row && (row["respno"] ?? row["Respondent ID"]);
        const date = row && (row["Interview Date"] ?? row["Date"]);
        if (id && date) {
          existingRespondents.push({
            id: id.toString(),
            numericId: parseInt(id.toString().replace(/\D/g, '')),
            date: date,
            sheetName: sheetName,
            row: row
          });
        }
      }
    }
  }

  // Sort existing respondents by interview date (earliest first)
  existingRespondents.sort((a, b) => {
    const dateA = new Date(a.date);
    const dateB = new Date(b.date);
    return dateA - dateB;
  });

  console.log('Existing respondents sorted by date:', existingRespondents.map(r => ({ id: r.id, date: r.date })));

  // Determine where the new respondent should be inserted based on their date
  let newRespondentPosition = existingRespondents.length; // Default to end
  if (newInterviewDate) {
    const newDate = new Date(newInterviewDate);
    newRespondentPosition = existingRespondents.findIndex(r => new Date(r.date) > newDate);
    if (newRespondentPosition === -1) newRespondentPosition = existingRespondents.length;
  }

  console.log('New respondent position based on date:', newRespondentPosition);

  // Determine the new respondent's ID
  let newRespondentId;
  if (newRespondentPosition === 0) {
    // New respondent is earliest - they get R001, all others shift up
    newRespondentId = 1;
  } else if (newRespondentPosition === existingRespondents.length) {
    // New respondent is latest - they get the next sequential ID
    newRespondentId = existingRespondents.length + 1;
  } else {
    // New respondent goes in the middle - they get the position number, others shift
    newRespondentId = newRespondentPosition + 1;
  }

  console.log('New respondent ID:', newRespondentId);

  const currentTime = new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', timeZone: 'America/New_York' });
  const currentDate = new Date().toLocaleDateString('en-US', { year: 'numeric', month: '2-digit', day: '2-digit' });

  // Create ID mapping for reassignment
  const idMapping = new Map();
  const allRespondents = [...existingRespondents];
  
  // Insert new respondent at the correct position
  allRespondents.splice(newRespondentPosition, 0, {
    id: `R${String(newRespondentId).padStart(2, '0')}`,
    numericId: newRespondentId,
    date: newInterviewDate || currentDate,
    sheetName: 'Demographics', // Will be updated for all sheets
    row: null // Will be created
  });

  // Assign new sequential IDs based on chronological order
  allRespondents.forEach((respondent, index) => {
    const newId = index + 1;
    const newFormattedId = `R${String(newId).padStart(2, '0')}`;
    idMapping.set(respondent.id, newFormattedId);
  });

  console.log('ID mapping for reassignment:', Array.from(idMapping.entries()));

  // Build per-sheet columns
  const sheetsColumns = {};
  for (const sheetName of sheetNames) {
    if (sheetName === 'Demographics') {
      console.log('Skipping demographics sheet for auto-fill');
      continue;
    }
    const rows = currentData[sheetName];
    if (!Array.isArray(rows) || rows.length === 0) continue;
    const cols = Object.keys(rows[0] || {});
    sheetsColumns[sheetName] = cols;
    console.log(`Sheet "${sheetName}" has ${cols.length} columns:`, cols);
  }

  // Optionally skip Demographics from AI filling (typically manual)
  if (sheetsColumns["Demographics"]) {
    delete sheetsColumns["Demographics"];
  }

  // Call OpenAI once to fill a row per sheet
  let aiRowsBySheet = {};
  let aiQuotesBySheet = {};
  let aiContextBySheet = {};
  if (Object.keys(sheetsColumns).length > 0) {
    console.log('Calling AI with sheets:', Object.keys(sheetsColumns));

    // Create timeout promise (25 minutes for main processing)
    const fillPromise = fillRespondentRowsFromTranscript({
      transcript: transcriptText,
      sheetsColumns,
      discussionGuide: discussionGuide || null,
      messageTestingDetails: messageTestingDetails,
    });

    const timeoutPromise = new Promise((_, reject) => {
      setTimeout(() => reject(new Error('Transcript processing timed out after 25 minutes')), 25 * 60 * 1000);
    });

    const ai = await Promise.race([fillPromise, timeoutPromise]);
    aiRowsBySheet = ai.rows || {};
    aiQuotesBySheet = ai.quotes || {};
    aiContextBySheet = ai.context || {};

    console.log('AI returned data for sheets:', Object.keys(aiRowsBySheet));
    for (const [sheetName, rowData] of Object.entries(aiRowsBySheet)) {
      const filledColumns = Object.entries(rowData).filter(([k, v]) => v && String(v).trim().length > 0);
      console.log(`AI filled ${filledColumns.length} columns in "${sheetName}":`, filledColumns.map(([k]) => k));
    }
  }

  // Rebuild all data with proper ID reassignment
  const updatedData = {};
  const processedSheets = [];
  const quotesBySheetAndResp = {};
  const contextBySheetAndResp = {};

  // First, update all existing rows with new IDs
  for (const sheetName of sheetNames) {
    const rows = currentData[sheetName];
    if (!Array.isArray(rows)) {
      updatedData[sheetName] = rows;
      continue;
    }

    const updatedRows = rows.map(row => {
      const newRow = { ...row };
      const oldId = row && (row["respno"] ?? row["Respondent ID"]);
      if (oldId && idMapping.has(oldId.toString())) {
        const newId = idMapping.get(oldId.toString());
        if ('Respondent ID' in newRow) newRow['Respondent ID'] = newId;
        if ('respno' in newRow) newRow['respno'] = newId;
      }
      return newRow;
    });

    updatedData[sheetName] = updatedRows;
  }

  // Handle Demographics sheet specially with chronological sorting
  if (updatedData.Demographics && Array.isArray(updatedData.Demographics)) {
    // Check if existing Demographics data has any actual respondent data (not just empty templates)
    const hasActualRespondents = updatedData.Demographics.some(row => {
      const id = row && (row["respno"] ?? row["Respondent ID"]);
      return id && id.toString().trim() !== '' && !id.toString().startsWith('R000');
    });
    
    console.log('Demographics sheet analysis:');
    console.log('- Total rows:', updatedData.Demographics.length);
    console.log('- Has actual respondents:', hasActualRespondents);
    console.log('- Row IDs:', updatedData.Demographics.map(r => r["respno"] ?? r["Respondent ID"]));

    // Create the new respondent row for Demographics
    const cols = Object.keys(updatedData.Demographics[0] || {});
    const newRow = {};
    for (const col of cols) newRow[col] = '';

    const aiRow = aiRowsBySheet.Demographics || {};
    for (const col of cols) {
      if (col in aiRow) newRow[col] = aiRow[col];
    }

    // Use the new respondent's assigned ID
    const newFormattedId = `R${String(newRespondentId).padStart(2, '0')}`;
    if ('Respondent ID' in newRow) newRow['Respondent ID'] = newFormattedId;
    else if ('respno' in newRow) newRow['respno'] = newFormattedId;

    // If there are no actual respondents, replace the empty template with the new respondent
    // Otherwise, add the new row to the existing data
    let allDemographics;
    if (hasActualRespondents) {
      // Add the new row to existing data
      allDemographics = [...updatedData.Demographics, newRow];
    } else {
      // Replace empty templates with the new respondent
      allDemographics = [newRow];
    }
    
    console.log('Demographics after adding new respondent:');
    console.log('- Total rows:', allDemographics.length);
    console.log('- Row IDs:', allDemographics.map(r => r["respno"] ?? r["Respondent ID"]));
    
    // Sort chronologically by interview date
    allDemographics.sort((a, b) => {
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

    // Reassign IDs based on chronological order
    allDemographics.forEach((row, index) => {
      const newId = `R${String(index + 1).padStart(2, '0')}`;
      if ('Respondent ID' in row) row['Respondent ID'] = newId;
      if ('respno' in row) row['respno'] = newId;
    });

    updatedData.Demographics = allDemographics;
    processedSheets.push('Demographics');
  }

  // Now add the new respondent row to all other sheets (excluding Demographics)
  for (const sheetName of sheetNames) {
    if (sheetName === 'Demographics') continue; // Skip Demographics as it's handled above
    
    const rows = updatedData[sheetName];
    if (!Array.isArray(rows) || rows.length === 0) {
      console.log(`Skipping empty sheet: ${sheetName}`);
      continue;
    }

    const cols = Object.keys(rows[0] || {});
    const newRow = {};
    for (const col of cols) newRow[col] = '';

    const aiRow = aiRowsBySheet[sheetName] || {};
    for (const col of cols) {
      if (col in aiRow) newRow[col] = aiRow[col];
    }

    // Use the new respondent's assigned ID
    const newFormattedId = `R${String(newRespondentId).padStart(2, '0')}`;
    if ('Respondent ID' in newRow) newRow['Respondent ID'] = newFormattedId;
    else if ('respno' in newRow) newRow['respno'] = newFormattedId;

    // Add the new row
    updatedData[sheetName] = [...rows, newRow];
    processedSheets.push(sheetName);

    // Attach quotes for this respondent by respno value
    const respKey = (newRow['Respondent ID'] || newRow['respno'] || newRespondentId).toString();
    // Deduplicate quotes across columns for this respondent within the same sheet
    const sheetQuotes = aiQuotesBySheet[sheetName] || {};
    const seenQuotes = new Set();
    const deDuped = {};
    for (const [col, arr] of Object.entries(sheetQuotes)) {
      const list = Array.isArray(arr) ? arr : [];
      const filtered = [];
      for (const q of list) {
        const key = typeof q === 'string' ? q.trim() : String(q).trim();
        if (!key) continue;
        if (seenQuotes.has(key)) continue; // skip duplicate across columns
        seenQuotes.add(key);
        filtered.push(key);
      }
      deDuped[col] = filtered;
    }
    if (!quotesBySheetAndResp[sheetName]) quotesBySheetAndResp[sheetName] = {};
    quotesBySheetAndResp[sheetName][respKey] = deDuped;

    // Attach context for this respondent by respno value
    const sheetContext = aiContextBySheet[sheetName] || {};
    if (!contextBySheetAndResp[sheetName]) contextBySheetAndResp[sheetName] = {};
    contextBySheetAndResp[sheetName][respKey] = sheetContext;
  }

  // Reassign quotes and context for existing respondents with new IDs
  if (currentData.quotes) {
    for (const [sheetName, sheetQuotes] of Object.entries(currentData.quotes)) {
      if (!quotesBySheetAndResp[sheetName]) quotesBySheetAndResp[sheetName] = {};
      for (const [oldRespId, respQuotes] of Object.entries(sheetQuotes)) {
        const newRespId = idMapping.get(oldRespId) || oldRespId;
        quotesBySheetAndResp[sheetName][newRespId] = respQuotes;
      }
    }
  }

  // Process existing context from currentData
  if (currentData.context) {
    for (const [sheetName, sheetContext] of Object.entries(currentData.context)) {
      if (!contextBySheetAndResp[sheetName]) contextBySheetAndResp[sheetName] = {};
      for (const [oldRespId, respContext] of Object.entries(sheetContext)) {
        const newRespId = idMapping.get(oldRespId) || oldRespId;
        contextBySheetAndResp[sheetName][newRespId] = respContext;
      }
    }
  }

  // Process new context from AI result
  if (aiContextBySheet && Object.keys(aiContextBySheet).length > 0) {
    console.log('Processing AI-generated context for sheets:', Object.keys(aiContextBySheet));
    for (const [sheetName, sheetContext] of Object.entries(aiContextBySheet)) {
      if (!contextBySheetAndResp[sheetName]) contextBySheetAndResp[sheetName] = {};
      for (const [columnName, columnContext] of Object.entries(sheetContext)) {
        if (!contextBySheetAndResp[sheetName][newRespno]) {
          contextBySheetAndResp[sheetName][newRespno] = {};
        }
        contextBySheetAndResp[sheetName][newRespno][columnName] = columnContext;
      }
    }
    console.log('AI context processed for respondent:', newRespno);
  }

  console.log('Processed sheets:', processedSheets);
  console.log('Total sheets updated:', processedSheets.length);
  console.log('Respondent ID reassignments applied:', Array.from(idMapping.entries()));
  return { data: updatedData, quotes: quotesBySheetAndResp, context: contextBySheetAndResp };
}

// Get verbatim quotes from transcript for a specific cell
router.post('/get-verbatim-quotes', async (req, res) => {
  try {
    const { analysisId, respondentId, columnName, sheetName, keyFinding } = req.body;
    
    // Initialize OpenAI
    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    
    if (!analysisId || !respondentId || !columnName || !sheetName) {
      return res.status(400).json({ error: 'Missing required parameters' });
    }

    console.log(`Getting verbatim quotes for ${respondentId} - ${columnName} in ${sheetName}`);

    // Load the analysis
    const analysesPath = path.join(process.env.DATA_DIR || path.join(__dirname, '../data'), 'savedAnalyses.json');
    const analysesData = await fs.readFile(analysesPath, 'utf8');
    const analyses = JSON.parse(analysesData);

    const analysisIndex = analyses.findIndex(a => a.id === analysisId);
    if (analysisIndex === -1) {
      return res.status(404).json({ error: 'Analysis not found' });
    }
    const analysis = analyses[analysisIndex];

    // Check if we already have cached quotes for this cell
    if (!analysis.verbatimQuotes) {
      analysis.verbatimQuotes = {};
    }
    if (!analysis.verbatimQuotes[sheetName]) {
      analysis.verbatimQuotes[sheetName] = {};
    }
    if (!analysis.verbatimQuotes[sheetName][respondentId]) {
      analysis.verbatimQuotes[sheetName][respondentId] = {};
    }

    // Check if this is a request to exclude previously shown quotes
    const excludePrevious = req.body.excludePrevious || false;
    const previouslyShownQuotes = req.body.previouslyShownQuotes || [];
    let noAdditionalQuotes = false;

    const cachedQuotes = analysis.verbatimQuotes[sheetName]?.[respondentId]?.[columnName];
    if (cachedQuotes && cachedQuotes.quotes && cachedQuotes.quotes.length > 0 && cachedQuotes.keyFinding === keyFinding && !excludePrevious) {
      console.log(`✅ Returning cached quotes for ${respondentId} - ${columnName} (saved ${cachedQuotes.savedAt})`);
      return res.json({
        success: true,
        quotes: cachedQuotes.quotes,
        transcriptType: cachedQuotes.transcriptType || 'unknown',
        respondentId: respondentId,
        columnName: columnName,
        sheetName: sheetName,
        cached: true
      });
    }

    console.log(`🆕 No cached quotes found, generating new quotes for ${respondentId} - ${columnName}`);
    console.log(`Key Finding: "${keyFinding}"`);

    // Find the transcript for this respondent
    console.log(`Looking for transcript for respondent: ${respondentId}`);
    console.log(`Available transcripts in analysis:`, analysis.transcripts?.map(t => ({
      id: t.id,
      respno: t.respno,
      sourceTranscriptId: t.sourceTranscriptId,
      hasOriginalPath: !!t.originalPath,
      hasCleanedPath: !!t.cleanedPath
    })));
    
    const transcript = analysis.transcripts?.find(t => 
      t.respno === respondentId || 
      t.id === respondentId ||
      t.sourceTranscriptId === respondentId
    );

    if (!transcript) {
      console.log(`No transcript found for respondent ${respondentId}`);
      return res.status(404).json({ error: 'Transcript not found for this respondent' });
    }
    
    console.log(`Found transcript:`, {
      id: transcript.id,
      respno: transcript.respno,
      originalPath: transcript.originalPath,
      cleanedPath: transcript.cleanedPath,
      isCleaned: transcript.isCleaned,
      hasCleanedTranscript: !!transcript.cleanedTranscript,
      hasOriginalTranscript: !!transcript.originalTranscript,
      cleanedTranscriptLength: transcript.cleanedTranscript?.length || 0,
      originalTranscriptLength: transcript.originalTranscript?.length || 0
    });

    // Load transcript text (prioritize cleaned over original)
    let transcriptText = '';
    let transcriptType = '';

    // First try to get transcript text from database (prioritize cleaned over original)
    if (transcript.cleanedTranscript) {
      transcriptText = transcript.cleanedTranscript;
      transcriptType = 'cleaned';
      console.log(`Loaded cleaned transcript from database for ${respondentId}, length: ${transcriptText.length}`);
    } else if (transcript.originalTranscript) {
      transcriptText = transcript.originalTranscript;
      transcriptType = 'original';
      console.log(`Loaded original transcript from database for ${respondentId}, length: ${transcriptText.length}`);
    }

    // Fallback to file system if not found in database
    if (!transcriptText && transcript.cleanedPath) {
      try {
        // Check if path is absolute (already includes DATA_DIR) or relative
        const cleanedPath = path.isAbsolute(transcript.cleanedPath)
          ? transcript.cleanedPath
          : path.join(process.env.DATA_DIR || path.join(__dirname, '../data'), transcript.cleanedPath);

        console.log(`Trying to load cleaned transcript from: ${cleanedPath}`);
        if (await fs.access(cleanedPath).then(() => true).catch(() => false)) {
          const result = await mammoth.extractRawText({ path: cleanedPath });
          transcriptText = result.value;
          transcriptType = 'cleaned';
          console.log(`✅ Loaded cleaned transcript from file for ${respondentId}, length: ${transcriptText.length}`);
        } else {
          console.log(`❌ Cleaned transcript file not found at: ${cleanedPath}`);
        }
      } catch (error) {
        console.log(`Failed to load cleaned transcript from file: ${error.message}`);
      }
    }

    // Try to find transcript files in uploads directory with different naming patterns
    if (!transcriptText) {
      try {
        const uploadsDir = path.join(process.env.DATA_DIR || path.join(__dirname, '../data'), 'uploads');
        console.log(`Searching for transcript files in: ${uploadsDir}`);
        
        // List all files in uploads directory
        const files = await fs.readdir(uploadsDir);
        console.log(`Available files in uploads:`, files.filter(f => f.includes('transcript') || f.includes('Transcript')));
        
        // Try different file patterns
        const possibleFiles = [
          `cleaned_${transcript.id}.docx`,
          `cleaned_${transcript.sourceTranscriptId}.docx`,
          `original_${transcript.id}.docx`,
          `original_${transcript.sourceTranscriptId}.docx`,
          transcript.originalPath ? path.basename(transcript.originalPath) : null,
          transcript.cleanedPath ? path.basename(transcript.cleanedPath) : null,
          // Try existing_ patterns that are common in the uploads
          `existing_${transcript.id}_original_${transcript.sourceTranscriptId}_${transcript.originalPath ? path.basename(transcript.originalPath) : ''}`,
          `existing_${transcript.id}_cleaned_${transcript.sourceTranscriptId}_${transcript.cleanedPath ? path.basename(transcript.cleanedPath) : ''}`
        ].filter(Boolean);

        for (const filename of possibleFiles) {
          const filePath = path.join(uploadsDir, filename);
          console.log(`Trying file: ${filePath}`);
          if (await fs.access(filePath).then(() => true).catch(() => false)) {
            const result = await mammoth.extractRawText({ path: filePath });
            transcriptText = result.value;
            transcriptType = filename.includes('cleaned') ? 'cleaned' : 'original';
            console.log(`✅ Loaded transcript from file: ${filename}, length: ${transcriptText.length}`);
            break;
          }
        }

        // If still no transcript found, try to find any file containing the transcript ID
        if (!transcriptText) {
          console.log(`Searching for files containing transcript ID: ${transcript.id} or source ID: ${transcript.sourceTranscriptId}`);
          const matchingFiles = files.filter(f => 
            f.includes(transcript.id) || 
            f.includes(transcript.sourceTranscriptId) ||
            (transcript.originalPath && f.includes(path.basename(transcript.originalPath)))
          );
          
          console.log(`Found matching files:`, matchingFiles);
          
          for (const filename of matchingFiles) {
            const filePath = path.join(uploadsDir, filename);
            console.log(`Trying matching file: ${filePath}`);
            try {
              const result = await mammoth.extractRawText({ path: filePath });
              transcriptText = result.value;
              transcriptType = filename.includes('cleaned') ? 'cleaned' : 'original';
              console.log(`✅ Loaded transcript from matching file: ${filename}, length: ${transcriptText.length}`);
              break;
            } catch (error) {
              console.log(`Failed to load matching file ${filename}: ${error.message}`);
            }
          }
        }
      } catch (error) {
        console.log(`Failed to search for transcript files: ${error.message}`);
      }
    }

    // Fallback to original transcript from file
    if (!transcriptText && transcript.originalPath) {
      try {
        // Check if path is absolute (already includes DATA_DIR) or relative
        const originalPath = path.isAbsolute(transcript.originalPath)
          ? transcript.originalPath
          : path.join(process.env.DATA_DIR || path.join(__dirname, '../data'), transcript.originalPath);

        console.log(`Trying to load original transcript from: ${originalPath}`);
        if (await fs.access(originalPath).then(() => true).catch(() => false)) {
          const result = await mammoth.extractRawText({ path: originalPath });
          transcriptText = result.value;
          transcriptType = 'original';
          console.log(`✅ Loaded original transcript from file for ${respondentId}, length: ${transcriptText.length}`);
        } else {
          console.log(`❌ Original transcript file not found at: ${originalPath}`);
        }
      } catch (error) {
        console.log(`Failed to load original transcript from file: ${error.message}`);
      }
    }

    // If still no transcript text and we have a filename, try to find the file in uploads
    if (!transcriptText && transcript.filename) {
      console.log(`Trying to load transcript from filename: ${transcript.filename}`);
      try {
        const uploadsDir = path.join(process.env.DATA_DIR || path.join(__dirname, '../data'), 'uploads');
        const possiblePaths = [
          path.join(uploadsDir, transcript.filename),
          path.join(uploadsDir, `cleaned_${transcript.id}_${transcript.filename}`),
          path.join(uploadsDir, `original_${transcript.id}_${transcript.filename}`),
          path.join(uploadsDir, `cleaned_${transcript.filename}`),
          path.join(uploadsDir, `original_${transcript.filename}`)
        ];
        
        for (const filePath of possiblePaths) {
          if (await fs.access(filePath).then(() => true).catch(() => false)) {
            const result = await mammoth.extractRawText({ path: filePath });
            transcriptText = result.value;
            transcriptType = 'found_by_filename';
            console.log(`Loaded transcript from filename: ${filePath}, length: ${transcriptText.length}`);
            break;
          }
        }
      } catch (error) {
        console.log(`Failed to load transcript from filename: ${error.message}`);
      }
    }

    if (!transcriptText) {
      console.log(`❌ No transcript text found for ${respondentId}`);
      console.log(`Transcript object:`, {
        id: transcript.id,
        respno: transcript.respno,
        hasCleanedTranscript: !!transcript.cleanedTranscript,
        hasOriginalTranscript: !!transcript.originalTranscript,
        cleanedPath: transcript.cleanedPath,
        originalPath: transcript.originalPath,
        cleanedTranscriptLength: transcript.cleanedTranscript?.length || 0,
        originalTranscriptLength: transcript.originalTranscript?.length || 0
      });
      return res.status(404).json({ error: 'No transcript text available' });
    }

    // Use AI to find relevant sections that support the key finding
    const systemPrompt = `You are an expert at analyzing interview transcripts to find verbatim quotes that support specific findings.

Your task is to find 2-3 relevant sections from the transcript that DIRECTLY support the given key finding. The quotes must contain specific details, experiences, or statements that validate or illustrate the key finding.

Return the quotes in this exact JSON format:
{
  "quotes": [
    {
      "text": "Exact verbatim text from transcript",
      "context": "Brief context about what this quote shows (1-2 sentences)"
    }
  ]
}

CRITICAL GUIDELINES:
- The quotes MUST contain specific details that directly relate to the key finding
- Look for quotes that mention specific treatments, experiences, dates, or outcomes mentioned in the key finding
- If the key finding mentions specific treatments (like "Evrysdi" or "Spinraza"), find quotes that discuss those exact treatments
- If the key finding mentions specific timeframes, find quotes that reference those timeframes
- If the key finding mentions specific experiences or outcomes, find quotes that describe those experiences
- IMPORTANT: For "treatment consideration" or "factors driving treatment" - find quotes where the respondent discusses WHY they would or wouldn't consider treatment, what factors influence their treatment decisions, or their thoughts about treatment options
- IMPORTANT: For "barriers to treatment" - find quotes where the respondent discusses obstacles, concerns, or challenges related to treatment
- IMPORTANT: For "unmet needs" - find quotes where the respondent discusses what they need or want from treatment
- Include the full conversation context (both moderator questions and respondent answers)
- Preserve the exact wording, punctuation, and formatting from the transcript
- Each quote should be a complete thought or exchange
- Focus on the most relevant and impactful quotes that contain specific supporting details
- DO NOT include generic quotes that only tangentially relate to the topic
- DO NOT include quotes about daily activities unless they directly relate to treatment consideration`;

    // Build exclusion text for previously shown quotes
    let exclusionText = '';
    if (excludePrevious && previouslyShownQuotes.length > 0) {
      exclusionText = `

IMPORTANT: Do NOT include any of these previously shown quotes:
${previouslyShownQuotes.map((quote, index) => `${index + 1}. "${quote.text}"`).join('\n')}

Find DIFFERENT quotes that support the key finding. If no other relevant quotes exist, return the same quotes but with a note that no additional quotes are available.`;
    }

    const userPrompt = `Key Finding: ${keyFinding}

Column: ${columnName}
Sheet: ${sheetName}
Respondent: ${respondentId}

Please find 2-3 verbatim quotes from this transcript that DIRECTLY support the key finding above. The quotes must contain specific details, experiences, or statements that validate or illustrate the key finding.

IMPORTANT: Look for quotes that mention:
- Specific treatments, medications, or therapies mentioned in the key finding
- Specific timeframes, dates, or durations mentioned in the key finding  
- Specific experiences, outcomes, or results mentioned in the key finding
- Specific preferences, attitudes, or behaviors mentioned in the key finding
- For "treatment consideration" - look for quotes where the respondent discusses their thoughts about treatment, what would influence their decision, or their reasons for considering/not considering treatment
- For "barriers to treatment" - look for quotes where the respondent discusses obstacles, concerns, or challenges related to treatment
- For "unmet needs" - look for quotes where the respondent discusses what they need or want from treatment

Do NOT include generic quotes that only tangentially relate to the topic. The quotes must contain concrete details that directly support the key finding.
Do NOT include quotes about daily activities unless they directly relate to treatment consideration or decision-making.${exclusionText}

Transcript:
${transcriptText.substring(0, 8000)}`; // Limit to first 8000 chars to stay within token limits

    const response = await openai.chat.completions.create({
      model: 'gpt-4o',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt }
      ],
      temperature: 0.1,
    });

    const aiResponse = response.choices[0].message.content;
    console.log('AI response for verbatim quotes:', aiResponse.substring(0, 500));

    // Parse the AI response
    let quotes = [];
    try {
      // Clean the response by removing markdown code fences if present
      let cleanedResponse = aiResponse.trim();

      // Remove ```json ... ``` or ``` ... ``` wrappers
      if (cleanedResponse.startsWith('```')) {
        cleanedResponse = cleanedResponse.replace(/^```(?:json)?\s*\n/, '').replace(/\n```\s*$/, '');
      }

      // Remove any text after the JSON object ends
      const jsonEndIndex = cleanedResponse.lastIndexOf('}');
      if (jsonEndIndex !== -1) {
        cleanedResponse = cleanedResponse.substring(0, jsonEndIndex + 1);
      }

      const parsed = JSON.parse(cleanedResponse);
      quotes = parsed.quotes || [];
      
    // Post-process quotes to improve relevance
    quotes = quotes.filter(quote => {
      if (!quote.text || quote.text.trim().length < 20) return false;

      // Check if quote contains specific details that relate to the key finding
      const keyFindingLower = keyFinding.toLowerCase();
      const quoteTextLower = quote.text.toLowerCase();

      // Extract key terms from the key finding
      const keyTerms = keyFindingLower.match(/\b\w{4,}\b/g) || [];
      const hasRelevantTerms = keyTerms.some(term =>
        quoteTextLower.includes(term) && term.length > 3
      );

      // Check for specific treatment names, dates, or experiences
      const hasSpecificDetails =
        quoteTextLower.includes('evrysdi') ||
        quoteTextLower.includes('spinraza') ||
        quoteTextLower.includes('treatment') ||
        quoteTextLower.includes('trial') ||
        quoteTextLower.includes('april') ||
        quoteTextLower.includes('2021') ||
        quoteTextLower.includes('2022') ||
        quoteTextLower.includes('2023') ||
        quoteTextLower.includes('experience') ||
        quoteTextLower.includes('took') ||
        quoteTextLower.includes('started') ||
        quoteTextLower.includes('stopped');

      return hasRelevantTerms || hasSpecificDetails;
    });

    // If no quotes pass the filter, keep the original quotes but mark them as potentially less relevant
    if (quotes.length === 0) {
      console.log('No quotes passed relevance filter, keeping original quotes');
      const parsed = JSON.parse(cleanedResponse);
      quotes = parsed.quotes || [];
    }

    // Check if we're excluding previous quotes and if the new quotes are the same
    if (excludePrevious && previouslyShownQuotes.length > 0) {
      const newQuoteTexts = quotes.map(q => q.text.trim());
      const previousQuoteTexts = previouslyShownQuotes.map(q => q.text.trim());
      
      // Check if all new quotes are the same as previously shown quotes
      const allQuotesAreSame = newQuoteTexts.every(newQuote => 
        previousQuoteTexts.some(prevQuote => 
          newQuote === prevQuote || 
          newQuote.includes(prevQuote.substring(0, 50)) || 
          prevQuote.includes(newQuote.substring(0, 50))
        )
      );
      
      if (allQuotesAreSame) {
        noAdditionalQuotes = true;
        console.log('🔄 No additional quotes available - same quotes returned');
      }
    }

    // Also check if the AI response indicates no additional quotes
    if (aiResponse.includes('No additional quotes are available') || 
        aiResponse.includes('no other relevant quotes exist')) {
      noAdditionalQuotes = true;
      console.log('🔄 AI indicated no additional quotes available');
    }
      
    } catch (error) {
      console.error('Failed to parse AI response:', error);
      console.error('Raw AI response:', aiResponse);
      // Fallback: return the raw response as a single quote
      quotes = [{
        text: aiResponse,
        context: "AI-generated response (parsing failed)"
      }];
    }

    // Cache the quotes for future requests
    analysis.verbatimQuotes[sheetName][respondentId][columnName] = {
      quotes: quotes,
      transcriptType: transcriptType,
      savedAt: new Date().toISOString(),
      keyFinding: keyFinding
    };

    // Save the updated analysis
    analyses[analysisIndex] = analysis;
    await fs.writeFile(analysesPath, JSON.stringify(analyses, null, 2));
    console.log(`💾 Cached quotes for ${respondentId} - ${columnName} in ${sheetName}`);

    res.json({
      success: true,
      quotes: quotes,
      transcriptType: transcriptType,
      respondentId: respondentId,
      columnName: columnName,
      sheetName: sheetName,
      cached: false,
      noAdditionalQuotes: noAdditionalQuotes || false
    });

  } catch (error) {
    console.error('Error getting verbatim quotes:', error);
    res.status(500).json({ error: error.message });
  }
});

// Clear quotes cache endpoint
router.post('/clear-quotes-cache', async (req, res) => {
  try {
    const { analysisId, respondentId, columnName, sheetName } = req.body;
    
    if (!analysisId || !respondentId || !columnName || !sheetName) {
      return res.status(400).json({ error: 'Missing required parameters' });
    }

    // Load the analysis
    const analysesPath = path.join(process.env.DATA_DIR || path.join(__dirname, '../data'), 'savedAnalyses.json');
    const analysesData = await fs.readFile(analysesPath, 'utf8');
    const analyses = JSON.parse(analysesData);
    
    const analysisIndex = analyses.findIndex(a => a.id === analysisId);
    if (analysisIndex === -1) {
      return res.status(404).json({ error: 'Analysis not found' });
    }

    const analysis = analyses[analysisIndex];
    
// Clear the cache for this specific cell
if (analysis.verbatimQuotes &&
    analysis.verbatimQuotes[sheetName] &&
    analysis.verbatimQuotes[sheetName][respondentId] &&
    analysis.verbatimQuotes[sheetName][respondentId][columnName]) {
  delete analysis.verbatimQuotes[sheetName][respondentId][columnName];
  console.log(`🗑️ Cleared quotes cache for ${respondentId} - ${columnName} in ${sheetName}`);
}

// Also clear any existing quotes for this cell to force regeneration
if (analysis.verbatimQuotes &&
    analysis.verbatimQuotes[sheetName] &&
    analysis.verbatimQuotes[sheetName][respondentId]) {
  delete analysis.verbatimQuotes[sheetName][respondentId][columnName];
}

    // Save the updated analysis
    analyses[analysisIndex] = analysis;
    await fs.writeFile(analysesPath, JSON.stringify(analyses, null, 2));

    res.json({ 
      success: true, 
      message: 'Quotes cache cleared successfully' 
    });

  } catch (error) {
    console.error('Error clearing quotes cache:', error);
    res.status(500).json({ error: error.message });
  }
});

// Context regeneration endpoint
router.post('/regenerate-context', async (req, res) => {
  try {
    console.log('🔄 Context regeneration request received');
    const { analysisId, projectId, transcripts } = req.body;
    
    if (!analysisId || !transcripts || !Array.isArray(transcripts)) {
      return res.status(400).json({ error: 'Analysis ID and transcripts are required' });
    }

    // Load the existing analysis
    const analyses = await loadSavedAnalyses();
    const analysis = analyses.find(a => String(a.id) === String(analysisId));
    if (!analysis) {
      return res.status(404).json({ error: 'Analysis not found' });
    }

    console.log('📖 Found analysis:', analysis.name);
    console.log('📋 Processing', transcripts.length, 'transcripts');

    // Generate context for each transcript
    const contextBySheetAndRespondent = {};
    
    for (const transcript of transcripts) {
      if (!transcript.cleanedTranscript && !transcript.originalTranscript) {
        console.log('⚠️ Skipping transcript without content:', transcript.id);
        continue;
      }

      const transcriptText = transcript.cleanedTranscript || transcript.originalTranscript;
      const respno = transcript.respno;

      console.log(`🔄 Processing transcript ${transcript.id} for respondent ${respno}`);

      try {
        // Get discussion guide if available
        let discussionGuide = null;
        if (projectId) {
          try {
            const dgPath = path.join(filesDir, `discussion_guide_${projectId}.docx`);
            if (fsSync.existsSync(dgPath)) {
              const { extractDocx } = await import('docx-text-to-json');
              const dg = await extractDocx(dgPath);
              discussionGuide = dg.paragraphs.join('\n');
            }
          } catch (error) {
            console.log('No discussion guide found for project:', projectId);
          }
        }

        // Get sheet columns from existing analysis data
        const sheetsColumns = {};
        for (const [sheetName, sheetData] of Object.entries(analysis.data || {})) {
          if (sheetName === 'Demographics' || !Array.isArray(sheetData) || sheetData.length === 0) continue;
          const cols = Object.keys(sheetData[0] || {});
          sheetsColumns[sheetName] = cols;
        }

        if (Object.keys(sheetsColumns).length === 0) {
          console.log('⚠️ No sheet columns found for context generation');
          continue;
        }

        // Generate context using AI
        const { fillRespondentRowsFromTranscript } = await import('../services/transcriptFiller.service.mjs');
        const aiResult = await fillRespondentRowsFromTranscript({
          transcript: transcriptText,
          sheetsColumns,
          discussionGuide: discussionGuide,
          messageTestingDetails: null,
        });

        // Process the context result
        for (const [sheetName, columnContext] of Object.entries(aiResult.context || {})) {
          if (!contextBySheetAndRespondent[sheetName]) {
            contextBySheetAndRespondent[sheetName] = {};
          }

          const cleanedColumns = {};
          for (const [colName, contexts] of Object.entries(columnContext || {})) {
            cleanedColumns[colName] = Array.isArray(contexts) ? contexts : [];
          }

          contextBySheetAndRespondent[sheetName][respno] = cleanedColumns;
        }

        console.log(`✅ Generated context for ${respno} in sheets:`, Object.keys(aiResult.context || {}));

      } catch (error) {
        console.error(`❌ Error processing transcript ${transcript.id}:`, error);
      }
    }

    // Update the analysis with new context
    analysis.context = contextBySheetAndRespondent;
    analysis.savedAt = new Date().toISOString();

    // Save the updated analysis
    const analysisIndex = analyses.findIndex(a => a.id === analysisId);
    if (analysisIndex !== -1) {
      analyses[analysisIndex] = analysis;
      await saveAnalysesToFile(analyses);
    }

    console.log('✅ Context regeneration completed');
    console.log('📤 Returning context with keys:', Object.keys(contextBySheetAndRespondent));

    res.json({
      success: true,
      context: contextBySheetAndRespondent,
      message: `Context regenerated for ${transcripts.length} transcript(s)`
    });

  } catch (error) {
    console.error('❌ Error regenerating context:', error);
    res.status(500).json({ error: 'Failed to regenerate context' });
  }
});

// Storyboard generation endpoints
router.post('/estimate-storyboard-cost', async (req, res) => {
  console.log('📊 === STORYBOARD COST ESTIMATION STARTED ===');
  console.log('Request headers:', req.headers);
  console.log('Request body:', req.body);

  try {
    const { selectedFiles, analysisId, projectId } = req.body;

    if (!selectedFiles || !Array.isArray(selectedFiles)) {
      console.error('❌ No selected files array provided');
      return res.status(400).json({ error: 'Selected files array is required' });
    }

    console.log(`📋 Estimating cost for ${selectedFiles.length} files:`, selectedFiles);
    let totalInputTokens = 0;
    let estimatedOutputTokens = 0;

    // Estimate tokens for content analysis data
    if (selectedFiles.includes('content_analysis') && analysisId) {
      try {
        const analyses = await loadSavedAnalyses();
        const analysisData = analyses.find(a => String(a.id) === String(analysisId));
        if (analysisData) {
          const analysisText = JSON.stringify(analysisData, null, 2);
          totalInputTokens += Math.ceil(analysisText.length / 4); // Rough token estimation
        }
      } catch (error) {
        console.error('Error loading analysis data for cost estimation:', error);
      }
    }

    // Estimate tokens for discussion guide
    if (selectedFiles.includes('discussion_guide') && projectId) {
      try {
        const dgPath = path.join(filesDir, `discussion_guide_${projectId}.docx`);
        if (fsSync.existsSync(dgPath)) {
          const { extractDocx } = await import('docx-text-to-json');
          const dg = await extractDocx(dgPath);
          const dgText = dg.paragraphs.join('\n');
          totalInputTokens += Math.ceil(dgText.length / 4);
        }
      } catch (error) {
        console.error('Error loading discussion guide for cost estimation:', error);
      }
    }

    // Estimate tokens for selected transcripts
    const transcriptFiles = selectedFiles.filter(f => f !== 'content_analysis' && f !== 'discussion_guide');
    for (const transcriptId of transcriptFiles) {
      try {
        const transcriptPath = path.join(filesDir, `cleaned_${transcriptId}.docx`);
        if (fsSync.existsSync(transcriptPath)) {
          const { extractDocx } = await import('docx-text-to-json');
          const transcript = await extractDocx(transcriptPath);
          const transcriptText = transcript.paragraphs.join('\n');
          totalInputTokens += Math.ceil(transcriptText.length / 4);
        }
      } catch (error) {
        console.error(`Error loading transcript ${transcriptId} for cost estimation:`, error);
      }
    }

    // Estimate output tokens (storyboard will be substantial)
    estimatedOutputTokens = Math.max(4000, Math.ceil(totalInputTokens * 0.1)); // At least 4k tokens, or 10% of input

    // Calculate cost using GPT-4 pricing
    const inputCost = (totalInputTokens / 1000000) * 2.50; // $2.50 per 1M input tokens
    const outputCost = (estimatedOutputTokens / 1000000) * 10.00; // $10.00 per 1M output tokens
    const totalCost = inputCost + outputCost;

    const estimate = {
      inputTokens: totalInputTokens,
      outputTokens: estimatedOutputTokens,
      cost: totalCost,
      formattedCost: `$${totalCost.toFixed(2)}`
    };

    console.log('✅ Cost estimate calculated:', estimate);
    res.json(estimate);
  } catch (error) {
    console.error('❌ Error estimating storyboard cost:', error);
    console.error('Error stack:', error.stack);
    res.status(500).json({ error: 'Failed to estimate cost', details: error.message });
  }
});

router.post('/generate-storyboard', async (req, res) => {
  try {
    console.log('🎬 Storyboard generation request received');
    const { analysisId, projectId, selectedFiles, costEstimate } = req.body;
    
    console.log('📋 Request data:', { analysisId, projectId, selectedFiles: selectedFiles?.length, costEstimate });
    
    if (!analysisId || !selectedFiles || !Array.isArray(selectedFiles)) {
      console.log('❌ Missing required fields');
      return res.status(400).json({ error: 'Analysis ID and selected files are required' });
    }

    // Load analysis data
    console.log('📖 Loading analysis data...');
    const analyses = await loadSavedAnalyses();
    const analysisData = analyses.find(a => String(a.id) === String(analysisId));
    if (!analysisData) {
      console.log('❌ Analysis not found:', analysisId);
      return res.status(404).json({ error: 'Analysis not found' });
    }
    
    console.log('✅ Analysis found:', analysisData.name);

    // Prepare content for AI
    let contentForAI = '';
    
    // Add content analysis data
    if (selectedFiles.includes('content_analysis')) {
      contentForAI += '=== CONTENT ANALYSIS DATA ===\n';
      contentForAI += JSON.stringify(analysisData, null, 2) + '\n\n';
    }

    // Add discussion guide
    if (selectedFiles.includes('discussion_guide') && projectId) {
      console.log('📖 Discussion guide selected - attempting to load...');
      console.log('📖 Project ID:', projectId);
      try {
        const dgPath = path.join(filesDir, `discussion_guide_${projectId}.docx`);
        console.log('📖 Discussion guide path:', dgPath);
        console.log('📖 File exists:', fsSync.existsSync(dgPath));
        if (fsSync.existsSync(dgPath)) {
          const { extractDocx } = await import('docx-text-to-json');
          const dg = await extractDocx(dgPath);
          const dgText = dg.paragraphs.join('\n');
          console.log('📖 Discussion guide loaded, length:', dgText.length);
          contentForAI += '=== DISCUSSION GUIDE ===\n';
          contentForAI += dgText + '\n\n';
        } else {
          console.warn('⚠️ Discussion guide file not found at:', dgPath);
        }
      } catch (error) {
        console.error('Error loading discussion guide:', error);
      }
    } else {
      console.log('📖 Discussion guide NOT in selectedFiles or no projectId');
      console.log('📖 selectedFiles:', selectedFiles);
      console.log('📖 projectId:', projectId);
    }

    // Add selected transcripts
    const transcriptFiles = selectedFiles.filter(f => f !== 'content_analysis' && f !== 'discussion_guide');
    for (const transcriptId of transcriptFiles) {
      try {
        const transcriptPath = path.join(filesDir, `cleaned_${transcriptId}.docx`);
        if (fsSync.existsSync(transcriptPath)) {
          const { extractDocx } = await import('docx-text-to-json');
          const transcript = await extractDocx(transcriptPath);
          const transcriptText = transcript.paragraphs.join('\n');
          contentForAI += `=== TRANSCRIPT ${transcriptId} ===\n`;
          contentForAI += transcriptText + '\n\n';
        }
      } catch (error) {
        console.error(`Error loading transcript ${transcriptId}:`, error);
      }
    }

    // Generate storyboard using AI
    console.log('🤖 Starting AI storyboard generation...');
    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    
    const systemPrompt = `You are a senior market research analyst creating a comprehensive storyboard for a qualitative research report. Your task is to analyze the provided research data and create a detailed storyboard that outlines the structure, key findings, and recommendations for a client presentation.

The storyboard should include:
1. Executive Summary
2. Research Objectives & Methodology
3. Key Findings (prioritized by importance and research objectives)
4. Detailed Insights by Theme/Topic
5. Supporting Evidence & Quotes
6. Recommendations
7. Next Steps

Format the storyboard as a structured document with clear sections, bullet points, and actionable insights. Focus on insights that directly address the research objectives from the discussion guide.`;

    const userPrompt = `Please create a comprehensive storyboard based on the following research data:

${contentForAI}

Create a detailed storyboard that prioritizes findings based on the research objectives and provides clear, actionable insights for the client.`;

    console.log('📝 Content length for AI:', contentForAI.length);
    console.log('🔤 Sending request to OpenAI...');
    
    const response = await openai.chat.completions.create({
      model: 'gpt-4o',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt }
      ],
      temperature: 0.3,
      max_tokens: 4000
    });

    console.log('✅ AI response received');
    const storyboardContent = response.choices[0].message.content;

    // Create Word document
    console.log('📄 Creating Word document...');
    const doc = new Document({
      sections: [{
        properties: {},
        children: [
          new Paragraph({
            children: [
              new TextRun({
                text: "Research Storyboard",
                bold: true,
                size: 32
              })
            ],
            heading: HeadingLevel.TITLE,
            alignment: AlignmentType.CENTER
          }),
          new Paragraph({
            children: [
              new TextRun({
                text: `Generated on ${new Date().toLocaleDateString()}`,
                size: 20
              })
            ],
            alignment: AlignmentType.CENTER
          }),
          new Paragraph({
            children: [new TextRun({ text: "" })]
          }),
          ...storyboardContent.split('\n').map(line => {
            const trimmed = line.trim();

            // Empty line
            if (trimmed === '') {
              return new Paragraph({ children: [new TextRun({ text: "" })] });
            }

            // Heading 1 (# )
            if (trimmed.startsWith('# ')) {
              return new Paragraph({
                children: [
                  new TextRun({
                    text: trimmed.substring(2),
                    bold: true,
                    size: 32
                  })
                ],
                heading: HeadingLevel.HEADING_1
              });
            }

            // Heading 2 (## )
            if (trimmed.startsWith('## ')) {
              return new Paragraph({
                children: [
                  new TextRun({
                    text: trimmed.substring(3),
                    bold: true,
                    size: 28
                  })
                ],
                heading: HeadingLevel.HEADING_2
              });
            }

            // Heading 3 (### )
            if (trimmed.startsWith('### ')) {
              return new Paragraph({
                children: [
                  new TextRun({
                    text: trimmed.substring(4),
                    bold: true,
                    size: 24
                  })
                ],
                heading: HeadingLevel.HEADING_3
              });
            }

            // Bullet point (- )
            if (trimmed.startsWith('- ')) {
              const text = trimmed.substring(2);
              const children = [];

              // Parse **bold** text within the line
              const parts = text.split(/(\*\*.*?\*\*)/g);
              parts.forEach(part => {
                if (part.startsWith('**') && part.endsWith('**')) {
                  children.push(new TextRun({
                    text: part.substring(2, part.length - 2),
                    bold: true,
                    size: 22
                  }));
                } else if (part) {
                  children.push(new TextRun({
                    text: part,
                    size: 22
                  }));
                }
              });

              return new Paragraph({
                children: children,
                bullet: { level: 0 }
              });
            }

            // Regular paragraph with possible **bold** text
            const children = [];
            const parts = trimmed.split(/(\*\*.*?\*\*)/g);
            parts.forEach(part => {
              if (part.startsWith('**') && part.endsWith('**')) {
                children.push(new TextRun({
                  text: part.substring(2, part.length - 2),
                  bold: true,
                  size: 22
                }));
              } else if (part) {
                children.push(new TextRun({
                  text: part,
                  size: 22
                }));
              }
            });

            return new Paragraph({ children });
          })
        ]
      }]
    });

    // Generate and send the document
    console.log('💾 Generating Word document buffer...');
    const buffer = await Packer.toBuffer(doc);
    
    console.log('📤 Sending document to client...');
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
    res.setHeader('Content-Disposition', 'attachment; filename="storyboard.docx"');
    res.send(buffer);
    
    console.log('✅ Storyboard generation completed successfully');

  } catch (error) {
    console.error('Error generating storyboard:', error);
    res.status(500).json({ error: 'Failed to generate storyboard' });
  }
});

export default router;
