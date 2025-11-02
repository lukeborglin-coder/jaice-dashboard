import express from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs/promises';
import { fileURLToPath } from 'url';
import { authenticateToken } from '../middleware/auth.middleware.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const router = express.Router();

// Apply authentication middleware
router.use(authenticateToken);

// Data directory
const dataDir = process.env.DATA_DIR || path.join(__dirname, '../data');
const tabulationsDir = path.join(dataDir, 'data-tabulations');
const tabulationsFile = path.join(tabulationsDir, 'saved-tabulations.json');

// Ensure directories exist
async function ensureDataDir() {
  try {
    await fs.mkdir(tabulationsDir, { recursive: true });
  } catch (error) {
    console.error('Error creating data tabulations directory:', error);
  }
}

// Helper to safely parse JSON
function safeJsonParse(data, defaultValue) {
  try {
    return JSON.parse(data);
  } catch (error) {
    console.error('JSON parse error:', error);
    return defaultValue;
  }
}

// Load saved tabulations
async function loadSavedTabulations() {
  try {
    await ensureDataDir();
    try {
      await fs.access(tabulationsFile);
    } catch {
      return [];
    }
    
    const data = await fs.readFile(tabulationsFile, 'utf8');
    if (!data || data.trim().length === 0) {
      return [];
    }
    
    return safeJsonParse(data, []);
  } catch (error) {
    console.error('Error loading saved tabulations:', error);
    return [];
  }
}

// Save tabulations to file
async function saveTabulationsToFile(tabulations) {
  try {
    await ensureDataDir();
    await fs.writeFile(tabulationsFile, JSON.stringify(tabulations, null, 2));
  } catch (error) {
    console.error('Error saving tabulations:', error);
    throw error;
  }
}

// In-memory storage
let savedTabulations = [];

// Initialize on startup
(async () => {
  savedTabulations = await loadSavedTabulations();
  console.log(`Loaded ${savedTabulations.length} saved data tabulations`);
})();

// GET /api/dataTabulation/saved - Get all saved tabulations
router.get('/saved', async (req, res) => {
  try {
    const tabulations = await loadSavedTabulations();
    res.json(tabulations);
  } catch (error) {
    console.error('Error loading saved tabulations:', error);
    res.status(500).json({ error: 'Failed to load saved tabulations' });
  }
});

// GET /api/dataTabulation/saved/:projectId - Get tabulations for a project
router.get('/saved/:projectId', async (req, res) => {
  try {
    const { projectId } = req.params;
    const tabulations = await loadSavedTabulations();
    const projectTabulations = tabulations.filter(t => t.projectId === projectId);
    res.json(projectTabulations);
  } catch (error) {
    console.error('Error loading project tabulations:', error);
    res.status(500).json({ error: 'Failed to load project tabulations' });
  }
});

// POST /api/dataTabulation/save - Save a tabulation
router.post('/save', async (req, res) => {
  try {
    const { projectId, projectName, name, description, parsedData, bannerGroups, selectedStubVariables } = req.body;

    if (!projectId || !parsedData) {
      return res.status(400).json({ error: 'Project ID and parsed data are required' });
    }

    const savedTabulation = {
      id: Date.now().toString(),
      projectId,
      projectName: projectName || 'Unknown Project',
      name: name || 'Untitled Tabulation',
      description: description || '',
      parsedData,
      bannerGroups: bannerGroups || [],
      selectedStubVariables: selectedStubVariables || {},
      savedAt: new Date().toISOString(),
      savedBy: req.user?.name || req.user?.email || 'Unknown'
    };

    savedTabulations = await loadSavedTabulations();
    savedTabulations.unshift(savedTabulation);
    await saveTabulationsToFile(savedTabulations);

    res.json(savedTabulation);
  } catch (error) {
    console.error('Error saving tabulation:', error);
    res.status(500).json({ error: 'Failed to save tabulation' });
  }
});

// GET /api/dataTabulation/:id - Get a specific tabulation
router.get('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const tabulations = await loadSavedTabulations();
    const tabulation = tabulations.find(t => t.id === id);
    
    if (!tabulation) {
      return res.status(404).json({ error: 'Tabulation not found' });
    }
    
    res.json(tabulation);
  } catch (error) {
    console.error('Error loading tabulation:', error);
    res.status(500).json({ error: 'Failed to load tabulation' });
  }
});

// PUT /api/dataTabulation/:id - Update a tabulation
router.put('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    savedTabulations = await loadSavedTabulations();
    const index = savedTabulations.findIndex(t => t.id === id);
    
    if (index === -1) {
      return res.status(404).json({ error: 'Tabulation not found' });
    }
    
    // Update the tabulation with new data
    savedTabulations[index] = {
      ...savedTabulations[index],
      ...req.body,
      savedAt: new Date().toISOString()
    };
    
    await saveTabulationsToFile(savedTabulations);
    
    res.json(savedTabulations[index]);
  } catch (error) {
    console.error('Error updating tabulation:', error);
    res.status(500).json({ error: 'Failed to update tabulation' });
  }
});

// DELETE /api/dataTabulation/:id - Delete a tabulation
router.delete('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    savedTabulations = await loadSavedTabulations();
    const index = savedTabulations.findIndex(t => t.id === id);
    
    if (index === -1) {
      return res.status(404).json({ error: 'Tabulation not found' });
    }
    
    savedTabulations.splice(index, 1);
    await saveTabulationsToFile(savedTabulations);
    
    res.json({ success: true });
  } catch (error) {
    console.error('Error deleting tabulation:', error);
    res.status(500).json({ error: 'Failed to delete tabulation' });
  }
});

export default router;

