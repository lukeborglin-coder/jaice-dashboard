import express from 'express';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import OpenAI from 'openai';

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

// POST /api/utilities/match-headers-ai - Match unmapped headers using AI
// IMPORTANT: This must come BEFORE the /:projectId routes to avoid route collision
router.post('/match-headers-ai', async (req, res) => {
  try {
    const { unmappedExpectedHeaders, unmappedDataFileHeaders } = req.body;

    if (!unmappedExpectedHeaders || !unmappedDataFileHeaders) {
      return res.status(400).json({ error: 'Both unmappedExpectedHeaders and unmappedDataFileHeaders are required' });
    }

    // Use OpenAI API to match headers
    const hasValidKey = process.env.OPENAI_API_KEY &&
                        process.env.OPENAI_API_KEY !== 'your_openai_api_key_here' &&
                        process.env.OPENAI_API_KEY.startsWith('sk-');

    if (!hasValidKey) {
      return res.status(500).json({ error: 'OpenAI API key not configured' });
    }

    const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

    const systemPrompt = `You are a data mapping assistant. You need to match expected column headers from a questionnaire to actual column headers found in a data file.

For each expected header, try to find the best matching data file header. If you find a match, provide it. If you cannot find a good match, provide a brief reason (3-5 words) explaining why.

Return your response as a JSON array with this structure:
[
  {
    "expectedHeader": "header name",
    "dataFileHeader": "matched header name" (only if found),
    "reason": "brief reason" (only if no match found)
  }
]

Only include either "dataFileHeader" OR "reason" for each entry, not both. Return ONLY the JSON array, no other text.`;

    const userPrompt = `Expected headers (from questionnaire): ${JSON.stringify(unmappedExpectedHeaders, null, 2)}

Available data file headers (unmapped): ${JSON.stringify(unmappedDataFileHeaders, null, 2)}

Match the expected headers to the available data file headers.`;

    const response = await client.chat.completions.create({
      model: 'gpt-4',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt }
      ],
      temperature: 0.3,
      max_tokens: 4000
    });

    const aiText = response.choices[0].message.content.trim();

    // Parse the JSON from the AI response
    let matches;
    try {
      // Try to extract JSON from the response
      const jsonMatch = aiText.match(/\[[\s\S]*\]/);
      if (jsonMatch) {
        matches = JSON.parse(jsonMatch[0]);
      } else {
        throw new Error('No JSON found in AI response');
      }
    } catch (error) {
      console.error('Error parsing AI response:', error);
      console.error('AI response text:', aiText);
      return res.status(500).json({ error: 'Failed to parse AI response' });
    }

    res.json({ matches });
  } catch (error) {
    console.error('Error matching headers with AI:', error);
    res.status(500).json({ error: 'Failed to match headers with AI' });
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

