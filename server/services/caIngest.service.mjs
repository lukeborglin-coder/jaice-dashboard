import fs from 'fs/promises';
import path from 'path';
import xlsx from 'xlsx';

// Simple in-memory storage for demo (in production, use a proper database)
const projectData = new Map();

export async function ingestCAWorkbook(projectId, filePath) {
  try {
    const workbook = xlsx.readFile(filePath);
    const parsed = parseWorkbook(workbook);

    // Store the parsed data
    projectData.set(projectId, parsed);

    return {
      projectId,
      sheets: Object.keys(parsed),
      timestamp: new Date().toISOString(),
      success: true
    };
  } catch (error) {
    console.error('Error ingesting CA workbook:', error);
    throw error;
  }
}

export async function parseCAWorkbook(projectId) {
  try {
    const data = projectData.get(projectId);
    if (!data) {
      throw new Error(`No data found for project: ${projectId}`);
    }
    return data;
  } catch (error) {
    console.error('Error parsing CA workbook:', error);
    throw error;
  }
}

function parseWorkbook(workbook) {
  const result = {};

  for (const sheetName of workbook.SheetNames) {
    const worksheet = workbook.Sheets[sheetName];
    const jsonData = xlsx.utils.sheet_to_json(worksheet);
    result[sheetName] = jsonData;
  }

  return result;
}