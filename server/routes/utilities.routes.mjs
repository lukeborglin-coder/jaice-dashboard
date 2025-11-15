import express from 'express';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const router = express.Router();
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_ROOT = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
const UTILITIES_STORE_PATH = path.join(DATA_ROOT, 'utilities.json');

// Ensure data directory exists
async function ensureDataStore() {
  await fs.mkdir(DATA_ROOT, { recursive: true });
  try {
    await fs.access(UTILITIES_STORE_PATH);
  } catch (error) {
    if (error && error.code === 'ENOENT') {
      await fs.writeFile(UTILITIES_STORE_PATH, JSON.stringify({}, null, 2), 'utf8');
    } else {
      throw error;
    }
  }
}

// Load utilities data from file
async function loadUtilitiesData() {
  try {
    await ensureDataStore();
    const data = await fs.readFile(UTILITIES_STORE_PATH, 'utf8');
    return JSON.parse(data);
  } catch (error) {
    console.error('Error loading utilities data:', error);
    return {};
  }
}

// Save utilities data to file
async function saveUtilitiesData(data) {
  try {
    await ensureDataStore();
    await fs.writeFile(UTILITIES_STORE_PATH, JSON.stringify(data, null, 2), 'utf8');
    return true;
  } catch (error) {
    console.error('Error saving utilities data:', error);
    return false;
  }
}

// GET /api/utilities - Get list of project IDs that have utilities
router.get('/', async (req, res) => {
  try {
    const utilitiesData = await loadUtilitiesData();
    const projectIds = Object.keys(utilitiesData);
    res.json({ projectIds });
  } catch (error) {
    console.error('Error loading utilities list:', error);
    res.status(500).json({ error: 'Failed to load utilities list' });
  }
});

// GET /api/utilities/:projectId - Get utilities data for a project
router.get('/:projectId', async (req, res) => {
  try {
    const { projectId } = req.params;
    const utilitiesData = await loadUtilitiesData();
    const projectUtilities = utilitiesData[projectId] || null;
    
    if (projectUtilities) {
      res.json(projectUtilities);
    } else {
      res.status(404).json({ error: 'No utilities data found for this project' });
    }
  } catch (error) {
    console.error('Error loading utilities:', error);
    res.status(500).json({ error: 'Failed to load utilities data' });
  }
});

// POST /api/utilities/:projectId - Save utilities data for a project
router.post('/:projectId', async (req, res) => {
  try {
    const { projectId } = req.params;
    const utilitiesData = req.body;
    
    if (!utilitiesData) {
      return res.status(400).json({ error: 'Utilities data is required' });
    }
    
    const allUtilities = await loadUtilitiesData();
    allUtilities[projectId] = {
      ...utilitiesData,
      savedAt: new Date().toISOString()
    };
    
    if (await saveUtilitiesData(allUtilities)) {
      res.json({ message: 'Utilities data saved successfully', data: allUtilities[projectId] });
    } else {
      res.status(500).json({ error: 'Failed to save utilities data' });
    }
  } catch (error) {
    console.error('Error saving utilities:', error);
    res.status(500).json({ error: 'Failed to save utilities data' });
  }
});

// DELETE /api/utilities/:projectId - Delete utilities data for a project
router.delete('/:projectId', async (req, res) => {
  try {
    const { projectId } = req.params;
    const allUtilities = await loadUtilitiesData();
    
    if (allUtilities[projectId]) {
      delete allUtilities[projectId];
      if (await saveUtilitiesData(allUtilities)) {
        res.json({ message: 'Utilities data deleted successfully' });
      } else {
        res.status(500).json({ error: 'Failed to delete utilities data' });
      }
    } else {
      res.status(404).json({ error: 'No utilities data found for this project' });
    }
  } catch (error) {
    console.error('Error deleting utilities:', error);
    res.status(500).json({ error: 'Failed to delete utilities data' });
  }
});

export default router;

