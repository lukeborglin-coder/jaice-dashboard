import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '../data');
const COSTS_PATH = path.join(DATA_DIR, 'costs.json');

// OpenAI API pricing (as of current rates)
const PRICING = {
  'gpt-4o': {
    input: 2.50 / 1_000_000,  // $2.50 per 1M input tokens
    output: 10.00 / 1_000_000  // $10.00 per 1M output tokens
  },
  'gpt-4o-mini': {
    input: 0.150 / 1_000_000,  // $0.15 per 1M input tokens
    output: 0.600 / 1_000_000  // $0.60 per 1M output tokens
  },
  'gpt-4': {
    input: 30.00 / 1_000_000,  // $30.00 per 1M input tokens
    output: 60.00 / 1_000_000  // $60.00 per 1M output tokens
  },
  'gpt-3.5-turbo': {
    input: 0.50 / 1_000_000,   // $0.50 per 1M input tokens
    output: 1.50 / 1_000_000   // $1.50 per 1M output tokens
  }
};

// Cost categories for different operations
export const COST_CATEGORIES = {
  TRANSCRIPT_CLEANING: 'Transcript Cleaning',
  CONTENT_ANALYSIS: 'Content Analysis',
  STORYBOARD_GENERATION: 'Storyboard Generation',
  STORYTELLING: 'Storytelling',
  WORKBOOK_PARSING: 'Workbook Parsing',
  QUESTIONNAIRE_PARSING: 'Questionnaire Parsing',
  OTHER: 'Other API Calls'
};

// Initialize costs file if it doesn't exist
async function initCostsFile() {
  try {
    await fs.access(COSTS_PATH);
  } catch {
    await fs.writeFile(COSTS_PATH, JSON.stringify({}, null, 2));
  }
}

initCostsFile();

// Read costs data
async function readCostsData() {
  try {
    const data = await fs.readFile(COSTS_PATH, 'utf8');
    return JSON.parse(data);
  } catch (error) {
    console.error('Error reading costs data:', error);
    return {};
  }
}

// Write costs data
async function writeCostsData(data) {
  try {
    await fs.writeFile(COSTS_PATH, JSON.stringify(data, null, 2));
    return true;
  } catch (error) {
    console.error('Error writing costs data:', error);
    return false;
  }
}

/**
 * Calculate cost for an API call based on token usage
 * @param {string} model - The model used (e.g., 'gpt-4o')
 * @param {number} inputTokens - Number of input tokens
 * @param {number} outputTokens - Number of output tokens
 * @returns {number} Cost in dollars
 */
export function calculateCost(model, inputTokens, outputTokens) {
  const pricing = PRICING[model];

  if (!pricing) {
    console.warn(`Unknown model: ${model}, using gpt-4o pricing as fallback`);
    const fallback = PRICING['gpt-4o'];
    return (inputTokens * fallback.input) + (outputTokens * fallback.output);
  }

  return (inputTokens * pricing.input) + (outputTokens * pricing.output);
}

/**
 * Log a cost entry for a project
 * @param {string} projectId - The project ID
 * @param {string} category - Cost category (e.g., 'Transcript Cleaning')
 * @param {string} model - The model used
 * @param {number} inputTokens - Number of input tokens
 * @param {number} outputTokens - Number of output tokens
 * @param {string} description - Optional description of the operation
 */
export async function logCost(projectId, category, model, inputTokens, outputTokens, description = '') {
  try {
    const cost = calculateCost(model, inputTokens, outputTokens);

    const costsData = await readCostsData();

    if (!costsData[projectId]) {
      costsData[projectId] = [];
    }

    const costEntry = {
      id: `COST-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      category,
      model,
      inputTokens,
      outputTokens,
      cost,
      description,
      timestamp: new Date().toISOString()
    };

    costsData[projectId].push(costEntry);

    await writeCostsData(costsData);

    console.log(`[Cost Tracking] Logged $${cost.toFixed(4)} for project ${projectId} - ${category}`);

    return costEntry;
  } catch (error) {
    console.error('Error logging cost:', error);
    return null;
  }
}

/**
 * Get total costs for a project
 * @param {string} projectId - The project ID
 * @returns {Object} Total costs broken down by category
 */
export async function getProjectCosts(projectId) {
  try {
    const costsData = await readCostsData();
    const projectCosts = costsData[projectId] || [];

    const breakdown = {};
    let total = 0;

    projectCosts.forEach(entry => {
      if (!breakdown[entry.category]) {
        breakdown[entry.category] = 0;
      }
      breakdown[entry.category] += entry.cost;
      total += entry.cost;
    });

    return {
      projectId,
      total,
      breakdown,
      entries: projectCosts
    };
  } catch (error) {
    console.error('Error getting project costs:', error);
    return {
      projectId,
      total: 0,
      breakdown: {},
      entries: []
    };
  }
}

/**
 * Get costs for all projects
 * @returns {Array} Array of project cost summaries
 */
export async function getAllProjectCosts() {
  try {
    const costsData = await readCostsData();
    const projectSummaries = [];

    for (const [projectId, entries] of Object.entries(costsData)) {
      const breakdown = {};
      let total = 0;

      entries.forEach(entry => {
        if (!breakdown[entry.category]) {
          breakdown[entry.category] = 0;
        }
        breakdown[entry.category] += entry.cost;
        total += entry.cost;
      });

      projectSummaries.push({
        projectId,
        total,
        breakdown,
        entryCount: entries.length,
        lastUpdated: entries.length > 0 ? entries[entries.length - 1].timestamp : null
      });
    }

    // Sort by total cost descending
    projectSummaries.sort((a, b) => b.total - a.total);

    return projectSummaries;
  } catch (error) {
    console.error('Error getting all project costs:', error);
    return [];
  }
}

/**
 * Delete all cost entries for a project
 * @param {string} projectId - The project ID
 */
export async function deleteProjectCosts(projectId) {
  try {
    const costsData = await readCostsData();
    delete costsData[projectId];
    await writeCostsData(costsData);
    return true;
  } catch (error) {
    console.error('Error deleting project costs:', error);
    return false;
  }
}

export default {
  calculateCost,
  logCost,
  getProjectCosts,
  getAllProjectCosts,
  deleteProjectCosts,
  COST_CATEGORIES
};
