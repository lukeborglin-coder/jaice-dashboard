import express from 'express';
import { authenticateToken, requireCognitiveOrAdmin } from '../middleware/auth.middleware.mjs';
import multer from 'multer';
import path from 'path';
import fs from 'fs/promises';
import mammoth from 'mammoth';
import { generateCAFromDGAsJSON, generateExcelFromJSON, generateGuideMapFromDGText } from '../services/caGenerator.service.mjs';
import { fillRespondentRowsFromTranscript } from '../services/transcriptFiller.service.mjs';
import { fileURLToPath } from 'url';
import OpenAI from 'openai';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const router = express.Router();

// In-memory job store for background processing
const uploadJobs = new Map();

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
      return JSON.parse(data);
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
    const { id, data, name, description, quotes, projectId, projectName, transcripts } = req.body;
    if (!id || !data) {
      return res.status(400).json({ error: 'id and data are required' });
    }
    const analyses = await loadSavedAnalyses();
    const idx = analyses.findIndex(a => a.id === id);
    if (idx === -1) return res.status(404).json({ error: 'Analysis not found' });

    const oldProjectId = analyses[idx].projectId;
    const projectChanged = projectId && projectId !== oldProjectId;

    if (name) analyses[idx].name = name; if (description) analyses[idx].description = description; if (projectId) analyses[idx].projectId = projectId; if (projectName) analyses[idx].projectName = projectName; analyses[idx].data = data; if (quotes) analyses[idx].quotes = quotes; if (transcripts) analyses[idx].transcripts = transcripts;
    analyses[idx].savedAt = new Date().toISOString();
    await saveAnalysesToFile(analyses);

    // If project changed, move the discussion guide file between projects
    if (projectChanged) {
      try {
        const projectsPath = path.join(process.env.DATA_DIR || path.join(__dirname, '../data'), 'projects.json');
        const allProj = JSON.parse(await fs.readFile(projectsPath, 'utf8'));

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

    res.json({ success: true });
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
        const allProj = JSON.parse(rawProj || '{}');

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
          const allProj = JSON.parse(rawProj || '{}');

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

    if (!req.file) {
      console.log('No file uploaded');
      return res.status(400).json({ error: 'No transcript file uploaded' });
    }

    const { projectId, activeSheet, discussionGuide, guideMap: guideMapRaw, analysisId, cleanTranscript, checkForAEs, messageConceptTesting, messageTestingDetails } = req.body;

    if (!projectId || !activeSheet) {
      console.log('Missing required fields:', { projectId, activeSheet });
      return res.status(400).json({ error: 'Project ID and active sheet are required' });
    }

    // Process transcript synchronously
    console.log(`Processing transcript for project: ${projectId}, sheet: ${activeSheet}`);
    console.log('File details:', {
      originalname: req.file.originalname,
      mimetype: req.file.mimetype,
      size: req.file.size,
      path: req.file.path
    });

    // Read the transcript file
    let transcriptText;
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

    // Get the current content analysis data structure from the request body
    // The frontend should send the current data structure
    const currentData = req.body.currentData ? JSON.parse(req.body.currentData) : getProjectData(projectId);
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

    // Derive moderator aliases from the associated project (projects.json)
    const moderatorAliases = [];
    try {
      const projectsPath = path.join(process.env.DATA_DIR || path.join(__dirname, '../data'), 'projects.json');
      if (await fs.access(projectsPath).then(() => true).catch(() => false)) {
        const rawProj = await fs.readFile(projectsPath, 'utf8');
        const allProj = JSON.parse(rawProj || '{}');
        for (const [uid, arr] of Object.entries(allProj || {})) {
          if (String(uid).includes('_archived')) continue;
          if (!Array.isArray(arr)) continue;
          const proj = arr.find(p => String(p?.id) === String(projectId));
          if (proj) {
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
      console.warn('Failed to derive moderator aliases from projects.json:', e.message);
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

    // Clean the transcript with AI (if requested)
    let cleanedTranscript = transcriptText;
    
    if (cleanTranscript === 'true' || cleanTranscript === true) {
      console.log('=== ABOUT TO CALL cleanTranscriptWithAI ===');
      console.log('Transcript text preview:', transcriptText.substring(0, 300));
      console.log('Discussion guide available:', !!discussionGuide);
      console.log('Column headers:', columnHeaders);

      cleanedTranscript = await cleanTranscriptWithAI(transcriptText, enrichedGuide, columnHeaders, moderatorAliases);
    } else {
      console.log('=== SKIPPING TRANSCRIPT CLEANING (cleanTranscript=false) ===');
    }

    console.log('=== TRANSCRIPT CLEANING COMPLETED ===');
    console.log('Cleaned transcript preview:', cleanedTranscript.substring(0, 300));
    console.log('⏱️  Elapsed time:', Math.round((Date.now() - Date.now()) / 1000), 'seconds');

    console.log('=== STARTING MAIN TRANSCRIPT PROCESSING ===');
    console.log('⏱️  This step may take 15-25 minutes for large transcripts...');

    // Process the CLEANED transcript with AI to extract key findings for ALL sheets
    const messageTestingDetailsParsed = messageTestingDetails ? JSON.parse(messageTestingDetails) : null;
    const processed = await processTranscriptWithAI(cleanedTranscript, currentData, enrichedGuide, messageTestingDetailsParsed);

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

    // If analysisId is provided, persist the updated data to savedAnalyses
    if (analysisId) {
      const idx = savedAnalyses.findIndex(a => a.id === analysisId);
      if (idx !== -1) {
        savedAnalyses[idx].data = processed.data;
        savedAnalyses[idx].quotes = processed.quotes;
        savedAnalyses[idx].context = processed.context;
        // Ensure guideMap is preserved if it existed on the saved analysis
        if (!savedAnalyses[idx].guideMap && req.body.guideMap) {
          try { savedAnalyses[idx].guideMap = typeof req.body.guideMap === 'string' ? JSON.parse(req.body.guideMap) : req.body.guideMap; } catch {}
        }
        savedAnalyses[idx].savedAt = new Date().toISOString();
        await saveAnalysesToFile(savedAnalyses);
        console.log(`Persisted updated analysis ${analysisId} with quotes and context`);
      } else {
        console.log(`Analysis ${analysisId} not found to persist`);
      }
    }

    // Clean up uploaded file
    try {
      await fs.unlink(req.file.path);
      console.log('Uploaded file cleaned up successfully');
    } catch (cleanupError) {
      console.warn('Failed to cleanup uploaded file:', cleanupError);
    }

    // Extract the respno from the Demographics sheet (it's the newly added row)
    const demographicsSheet = processed.data.Demographics;
    let respno = null;
    if (demographicsSheet && Array.isArray(demographicsSheet) && demographicsSheet.length > 0) {
      const lastRow = demographicsSheet[demographicsSheet.length - 1];
      respno = lastRow['Respondent ID'] || lastRow['respno'] || null;
    }

        console.log('Transcript processing completed successfully');
        console.log('Extracted respno:', respno);
        console.log('📤 About to send response with context:', processed.context);
        console.log('📤 Context keys:', processed.context ? Object.keys(processed.context) : 'NO CONTEXT');
        for (const [sheet, cols] of Object.entries(processed.context || {})) {
          console.log(`📤 Sheet "${sheet}" context columns:`, Object.keys(cols));
        }

        // Clean up uploaded file
        try {
          await fs.unlink(req.file.path);
        } catch (cleanupError) {
          console.warn('Failed to cleanup uploaded file:', cleanupError);
        }

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

        // Return the processed result directly
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

  // Try to match common date formats
  // Format: Oct 1, 2025 (abbreviated month)
  const dateMatch1 = header.match(/\b((?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\.?\s+\d{1,2},\s+\d{4})\b/i);
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
      model: 'gpt-4o',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
        { role: 'assistant', content: 'I will follow ALL rules exactly and output ONLY the cleaned transcript with proper formatting. I will preserve existing speaker labels if present and will not change respondent wording.' },
        { role: 'user', content: 'Please proceed with cleaning. Preserve existing Moderator/Respondent labels and do not reassign speakers.' }
      ],
      temperature: 0.1, // Very low temperature for strict rule following
      max_tokens: 8000, // Increased for longer transcripts (gpt-4o-mini supports 16k)
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
    id: `R${String(newRespondentId).padStart(3, '0')}`,
    numericId: newRespondentId,
    date: newInterviewDate || currentDate,
    sheetName: 'Demographics', // Will be updated for all sheets
    row: null // Will be created
  });

  // Assign new sequential IDs based on chronological order
  allRespondents.forEach((respondent, index) => {
    const newId = index + 1;
    const newFormattedId = `R${String(newId).padStart(3, '0')}`;
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
      return id && id.toString().trim() !== '';
    });

    // Create the new respondent row for Demographics
    const cols = Object.keys(updatedData.Demographics[0] || {});
    const newRow = {};
    for (const col of cols) newRow[col] = '';

    const aiRow = aiRowsBySheet.Demographics || {};
    for (const col of cols) {
      if (col in aiRow) newRow[col] = aiRow[col];
    }

    // Use the new respondent's assigned ID
    const newFormattedId = `R${String(newRespondentId).padStart(3, '0')}`;
    if ('Respondent ID' in newRow) newRow['Respondent ID'] = newFormattedId;
    else if ('respno' in newRow) newRow['respno'] = newFormattedId;

    // If there are no actual respondents, replace the empty template with the new respondent
    // Otherwise, add the new row to the existing data
    const allDemographics = hasActualRespondents 
      ? [...updatedData.Demographics, newRow]
      : [newRow];
    
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
      const newId = `R${String(index + 1).padStart(3, '0')}`;
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
    const newFormattedId = `R${String(newRespondentId).padStart(3, '0')}`;
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

  if (currentData.context) {
    for (const [sheetName, sheetContext] of Object.entries(currentData.context)) {
      if (!contextBySheetAndResp[sheetName]) contextBySheetAndResp[sheetName] = {};
      for (const [oldRespId, respContext] of Object.entries(sheetContext)) {
        const newRespId = idMapping.get(oldRespId) || oldRespId;
        contextBySheetAndResp[sheetName][newRespId] = respContext;
      }
    }
  }

  console.log('Processed sheets:', processedSheets);
  console.log('Total sheets updated:', processedSheets.length);
  console.log('Respondent ID reassignments applied:', Array.from(idMapping.entries()));
  return { data: updatedData, quotes: quotesBySheetAndResp, context: contextBySheetAndResp };
}

export default router;
