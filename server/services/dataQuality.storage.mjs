import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
const DATA_QUALITY_DIR = path.join(DATA_DIR, 'data-quality');

/**
 * Get the path to a project's data quality directory
 */
export function getProjectDataQualityDir(projectId) {
  return path.join(DATA_QUALITY_DIR, projectId);
}

/**
 * Get the path to quality-plan.json
 */
export function getQualityPlanPath(projectId) {
  return path.join(getProjectDataQualityDir(projectId), 'quality-plan.json');
}

/**
 * Get the path to qa-data.json
 */
export function getQADataPath(projectId) {
  return path.join(getProjectDataQualityDir(projectId), 'qa-data.json');
}

/**
 * Get the path to qa-results.json
 */
export function getQAResultsPath(projectId) {
  return path.join(getProjectDataQualityDir(projectId), 'qa-results.json');
}

/**
 * Get the path to uploads.json
 */
export function getUploadsPath(projectId) {
  return path.join(getProjectDataQualityDir(projectId), 'uploads.json');
}

/**
 * Ensure data quality directory exists for a project
 */
async function ensureProjectDir(projectId) {
  const projectDir = getProjectDataQualityDir(projectId);
  await fs.mkdir(projectDir, { recursive: true });
  return projectDir;
}

/**
 * Load quality plan for a project
 */
export async function loadQualityPlan(projectId) {
  try {
    const planPath = getQualityPlanPath(projectId);
    const content = await fs.readFile(planPath, 'utf-8');
    return JSON.parse(content);
  } catch (error) {
    if (error.code === 'ENOENT') {
      return null; // File doesn't exist yet
    }
    throw error;
  }
}

/**
 * Save quality plan for a project
 */
export async function saveQualityPlan(projectId, plan) {
  await ensureProjectDir(projectId);
  const planPath = getQualityPlanPath(projectId);
  
  // Update timestamps
  const now = new Date().toISOString();
  if (!plan.createdAt) {
    plan.createdAt = now;
  }
  plan.updatedAt = now;
  
  await fs.writeFile(planPath, JSON.stringify(plan, null, 2), 'utf-8');
  return plan;
}

/**
 * Load QA data for a project
 * Returns object with respno as keys
 */
export async function loadQAData(projectId) {
  try {
    const dataPath = getQADataPath(projectId);
    const content = await fs.readFile(dataPath, 'utf-8');
    const data = JSON.parse(content);
    
    // Convert array to object if needed (for backward compatibility)
    if (Array.isArray(data)) {
      const obj = {};
      data.forEach((row) => {
        if (row.respno) {
          obj[row.respno] = row;
        }
      });
      return obj;
    }
    
    return data || {};
  } catch (error) {
    if (error.code === 'ENOENT') {
      return {}; // File doesn't exist yet
    }
    throw error;
  }
}

/**
 * Save QA data for a project (upsert by RESPNO)
 */
export async function saveQAData(projectId, dataRows) {
  await ensureProjectDir(projectId);
  const dataPath = getQADataPath(projectId);
  
  // Load existing data
  const existing = await loadQAData(projectId);
  
  // Upsert new rows
  if (Array.isArray(dataRows)) {
    dataRows.forEach((row) => {
      if (row.respno) {
        existing[row.respno] = {
          ...existing[row.respno],
          ...row,
          respno: row.respno
        };
      }
    });
  } else if (typeof dataRows === 'object' && dataRows.respno) {
    // Single row
    existing[dataRows.respno] = {
      ...existing[dataRows.respno],
      ...dataRows,
      respno: dataRows.respno
    };
  }
  
  await fs.writeFile(dataPath, JSON.stringify(existing, null, 2), 'utf-8');
  return existing;
}

/**
 * Load QA results for a project
 * Returns object with respno as keys
 */
export async function loadQAResults(projectId) {
  try {
    const resultsPath = getQAResultsPath(projectId);
    const content = await fs.readFile(resultsPath, 'utf-8');
    const results = JSON.parse(content);
    
    // Convert array to object if needed (for backward compatibility)
    if (Array.isArray(results)) {
      const obj = {};
      results.forEach((result) => {
        if (result.respno) {
          obj[result.respno] = result;
        }
      });
      return obj;
    }
    
    return results || {};
  } catch (error) {
    if (error.code === 'ENOENT') {
      return {}; // File doesn't exist yet
    }
    throw error;
  }
}

/**
 * Save QA results for a project (upsert by RESPNO)
 */
export async function saveQAResults(projectId, results) {
  await ensureProjectDir(projectId);
  const resultsPath = getQAResultsPath(projectId);
  
  // Load existing results
  const existing = await loadQAResults(projectId);
  
  // Upsert new results
  if (Array.isArray(results)) {
    results.forEach((result) => {
      if (result.respno) {
        const now = new Date().toISOString();
        existing[result.respno] = {
          ...existing[result.respno],
          ...result,
          respno: result.respno,
          updatedAt: now,
          createdAt: existing[result.respno]?.createdAt || now
        };
      }
    });
  } else if (typeof results === 'object' && results.respno) {
    // Single result
    const now = new Date().toISOString();
    existing[results.respno] = {
      ...existing[results.respno],
      ...results,
      respno: results.respno,
      updatedAt: now,
      createdAt: existing[results.respno]?.createdAt || now
    };
  }
  
  await fs.writeFile(resultsPath, JSON.stringify(existing, null, 2), 'utf-8');
  return existing;
}

/**
 * Get a single QA result by RESPNO
 */
export async function getQAResultByRespno(projectId, respno) {
  const results = await loadQAResults(projectId);
  return results[respno] || null;
}

/**
 * Get a single QA data row by RESPNO
 */
export async function getQADataByRespno(projectId, respno) {
  const data = await loadQAData(projectId);
  return data[respno] || null;
}

/**
 * Load uploads for a project
 */
export async function loadUploads(projectId) {
  try {
    const uploadsPath = getUploadsPath(projectId);
    const content = await fs.readFile(uploadsPath, 'utf-8');
    return JSON.parse(content) || [];
  } catch (error) {
    if (error.code === 'ENOENT') {
      return []; // File doesn't exist yet
    }
    throw error;
  }
}

/**
 * Save uploads for a project
 */
export async function saveUploads(projectId, uploads) {
  await ensureProjectDir(projectId);
  const uploadsPath = getUploadsPath(projectId);
  await fs.writeFile(uploadsPath, JSON.stringify(uploads, null, 2), 'utf-8');
  return uploads;
}

/**
 * Add an upload record
 */
export async function addUpload(projectId, uploadData) {
  const uploads = await loadUploads(projectId);
  const newUpload = {
    id: `upload-${Date.now()}`,
    projectId,
    ...uploadData,
    uploadedAt: new Date().toISOString()
  };
  uploads.unshift(newUpload); // Add to beginning (most recent first)
  await saveUploads(projectId, uploads);
  return newUpload;
}

/**
 * Delete an upload and its associated data
 */
export async function deleteUpload(projectId, uploadId) {
  const uploads = await loadUploads(projectId);
  const uploadIndex = uploads.findIndex(u => u.id === uploadId);
  
  if (uploadIndex === -1) {
    return null;
  }
  
  const [deletedUpload] = uploads.splice(uploadIndex, 1);
  await saveUploads(projectId, uploads);
  
  // Also remove the respondent data associated with this upload
  if (deletedUpload.respnos && deletedUpload.respnos.length > 0) {
    const qaData = await loadQAData(projectId);
    deletedUpload.respnos.forEach(respno => {
      delete qaData[respno];
    });
    const dataPath = getQADataPath(projectId);
    await fs.writeFile(dataPath, JSON.stringify(qaData, null, 2), 'utf-8');
    
    // Also remove QA results for these respondents
    const qaResults = await loadQAResults(projectId);
    deletedUpload.respnos.forEach(respno => {
      delete qaResults[respno];
    });
    const resultsPath = getQAResultsPath(projectId);
    await fs.writeFile(resultsPath, JSON.stringify(qaResults, null, 2), 'utf-8');
  }
  
  return deletedUpload;
}




