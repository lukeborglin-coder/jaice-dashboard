import fs from 'fs/promises';
import path from 'path';
import xlsx from 'xlsx';
import { buildSchema, sheetOrder } from '../util/xlsxSchema.mjs';

const storeDir = process.env.FILES_DIR;

export async function ingestCAWorkbook(projectId, filePath) {
  const dest = path.join(storeDir, `project_${projectId}_CA.xlsx`);
  await fs.copyFile(filePath, dest);
  const data = await parseWorkbook(dest);
  // Persist lightweight JSON cache
  await fs.writeFile(path.join(storeDir, `project_${projectId}_CA.json`), JSON.stringify(data, null, 2));
  return { projectId, stored: true, sheets: Object.keys(data) };
}

export async function parseCAWorkbook(projectId) {
  const p = path.join(storeDir, `project_${projectId}_CA.json`);
  const raw = await fs.readFile(p, 'utf-8');
  return JSON.parse(raw);
}

async function parseWorkbook(filePath) {
  const wb = xlsx.readFile(filePath);
  const result = {};
  for (const sheet of wb.SheetNames) {
    const ws = wb.Sheets[sheet];
    const rows = xlsx.utils.sheet_to_json(ws, { defval: "" });
    // Apply rank calculations if present
    result[sheet] = rows.map(applyDerivedFields(sheet));
  }
  return result;
}

function applyDerivedFields(sheet) {
  return (row) => {
    // Example: If the sheet has 'Total Mentions' and 'Rank', recompute Rank based on descending mentions.
    // Here we leave rank computation to the frontend (stable on edits), but keep hook for server-side if needed.
    return row;
  };
}
