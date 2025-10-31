import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '../data');
const TRANSCRIPTS_PATH = path.join(DATA_DIR, 'transcripts.json');
const ANALYSES_PATH = path.join(DATA_DIR, 'savedAnalyses.json');

export function computeChronoKey({ interviewDate, interviewTime, uploadedAt }) {
  // Prefer interviewDate + interviewTime; fallback to uploadedAt; fallback to 0
  let ts = 0;
  if (interviewDate) {
    const composed = interviewTime ? `${interviewDate} ${interviewTime}` : interviewDate;
    const d = new Date(composed);
    if (!Number.isNaN(d.getTime())) ts = d.getTime();
  }
  if (!ts) {
    ts = Number.isFinite(uploadedAt) ? uploadedAt : 0;
  }
  return ts || 0;
}

function toRespno(index) {
  const n = index + 1;
  if (n < 100) return `R${String(n).padStart(2, '0')}`;
  return `R${String(n)}`;
}

async function readJsonSafe(filePath, fallback) {
  try {
    const data = await fs.readFile(filePath, 'utf8');
    return JSON.parse(data);
  } catch {
    return fallback;
  }
}

function normalizeRespno(val) {
  if (!val) return null;
  const s = String(val).trim();
  if (!s) return null;
  return s;
}

export async function recomputeAnalysisRespnos(projectId, analysisId) {
  const transcriptsAll = await readJsonSafe(TRANSCRIPTS_PATH, {});
  const analyses = await readJsonSafe(ANALYSES_PATH, []);

  const projectTranscripts = transcriptsAll[projectId] || [];
  const analysisIndex = analyses.findIndex(a => a.id === analysisId && a.projectId === projectId);
  if (analysisIndex === -1) {
    return { updated: false };
  }

  const analysis = analyses[analysisIndex];
  const data = analysis.data || {};

  // Build set of transcriptIds included in this analysis from Demographics (preferred) or any sheet
  // Also track rows by respno for rows that might not have transcriptId yet
  const includedTranscriptIds = new Set();
  const respnoToTranscriptId = new Map(); // Track existing respno -> transcriptId mappings
  const sheetNames = Object.keys(data);
  for (const sheetName of sheetNames) {
    const rows = data[sheetName];
    if (!Array.isArray(rows)) continue;
    for (const row of rows) {
      if (row && row.transcriptId) {
        includedTranscriptIds.add(row.transcriptId);
        // Also track respno -> transcriptId for matching later
        const respno = normalizeRespno(row['Respondent ID'] || row['respno']);
        if (respno) {
          respnoToTranscriptId.set(respno, row.transcriptId);
        }
      }
    }
  }

  // Map transcriptId -> transcript record
  const idToTranscript = new Map(
    projectTranscripts.map(t => [String(t.id), t])
  );

  // Also try to match rows without transcriptId by matching respno in transcripts.json
  // This handles legacy rows that might not have transcriptId set
  for (const transcript of projectTranscripts) {
    const respno = normalizeRespno(transcript.respno);
    if (respno && !includedTranscriptIds.has(String(transcript.id))) {
      // Check if this respno is already mapped to a transcriptId
      const existingTranscriptId = respnoToTranscriptId.get(respno);
      if (!existingTranscriptId) {
        // No existing mapping, so this transcript might be missing from CA
        // We'll include it if there are rows with matching respno
        includedTranscriptIds.add(String(transcript.id));
      }
    }
  }

  // Build ordered list by chronology for only included transcripts
  const ordered = Array.from(includedTranscriptIds)
    .map(id => {
      const t = idToTranscript.get(String(id));
      return {
        id: String(id),
        ts: t ? computeChronoKey({ interviewDate: t.interviewDate, interviewTime: t.interviewTime, uploadedAt: t.uploadedAt }) : 0,
        uploadedAt: t?.uploadedAt || 0
      };
    })
    .sort((a, b) => {
      if (a.ts !== b.ts) return a.ts - b.ts;
      if (a.uploadedAt !== b.uploadedAt) return a.uploadedAt - b.uploadedAt;
      return String(a.id).localeCompare(String(b.id));
    });

  // Assign new respnos gaplessly
  const transcriptIdToRespno = new Map();
  ordered.forEach((item, idx) => {
    transcriptIdToRespno.set(item.id, toRespno(idx));
  });

  // Persist respnos onto transcripts.json for included transcripts only
  let transcriptsChanged = false;
  for (const t of projectTranscripts) {
    if (transcriptIdToRespno.has(t.id)) {
      const newResp = transcriptIdToRespno.get(t.id);
      if (normalizeRespno(t.respno) !== newResp) {
        t.respno = newResp;
        transcriptsChanged = true;
      }
    }
  }
  if (transcriptsChanged) {
    transcriptsAll[projectId] = projectTranscripts;
    await fs.writeFile(TRANSCRIPTS_PATH, JSON.stringify(transcriptsAll, null, 2));
  }

  // Update all sheets in analysis by transcriptId mapping and reorder rows by respno
  const respnoOrderIndex = new Map();
  ordered.forEach((item, idx) => respnoOrderIndex.set(toRespno(idx), idx));

  function setRowRespno(row) {
    if (!row || typeof row !== 'object') return;
    
    const tid = row.transcriptId ? String(row.transcriptId) : null;
    let newResp = null;
    
    // First try to match by transcriptId
    if (tid && transcriptIdToRespno.has(tid)) {
      newResp = transcriptIdToRespno.get(tid);
    } else {
      // Try to match by existing respno -> find which transcript this respno belongs to
      const existingRespno = normalizeRespno(row['Respondent ID'] || row['respno']);
      if (existingRespno && respnoToTranscriptId.has(existingRespno)) {
        const mappedTranscriptId = respnoToTranscriptId.get(existingRespno);
        if (mappedTranscriptId && transcriptIdToRespno.has(String(mappedTranscriptId))) {
          newResp = transcriptIdToRespno.get(String(mappedTranscriptId));
          // Also update the transcriptId if it was missing
          if (!row.transcriptId) {
            row.transcriptId = mappedTranscriptId;
          }
        }
      } else if (existingRespno) {
        // No transcriptId found, try to match by respno to transcript records
        const matchingTranscript = projectTranscripts.find(t => normalizeRespno(t.respno) === existingRespno);
        if (matchingTranscript && transcriptIdToRespno.has(String(matchingTranscript.id))) {
          newResp = transcriptIdToRespno.get(String(matchingTranscript.id));
          row.transcriptId = String(matchingTranscript.id);
        }
      }
    }
    
    if (newResp) {
      if ('Respondent ID' in row) row['Respondent ID'] = newResp;
      if ('respno' in row) row['respno'] = newResp;
      if (!('Respondent ID' in row) && !('respno' in row)) row['respno'] = newResp;
    }
  }

  // Remove duplicate rows (same transcriptId)
  for (const sheetName of sheetNames) {
    const rows = data[sheetName];
    if (!Array.isArray(rows) || rows.length === 0) continue;
    
    // Remove duplicates: keep first occurrence of each transcriptId
    const seenTranscriptIds = new Set();
    const uniqueRows = [];
    for (const row of rows) {
      if (!row || typeof row !== 'object') continue;
      const tid = row.transcriptId ? String(row.transcriptId) : null;
      if (tid) {
        if (seenTranscriptIds.has(tid)) {
          console.log(`⚠️ Removing duplicate row with transcriptId ${tid} in sheet ${sheetName}`);
          continue; // Skip duplicate
        }
        seenTranscriptIds.add(tid);
      }
      uniqueRows.push(row);
    }
    
    // Update respnos
    uniqueRows.forEach(r => setRowRespno(r));
    
    // Sort by respno order
    uniqueRows.sort((a, b) => {
      const ra = normalizeRespno(a['Respondent ID'] || a['respno']);
      const rb = normalizeRespno(b['Respondent ID'] || b['respno']);
      const ia = respnoOrderIndex.has(ra) ? respnoOrderIndex.get(ra) : Number.MAX_SAFE_INTEGER;
      const ib = respnoOrderIndex.has(rb) ? respnoOrderIndex.get(rb) : Number.MAX_SAFE_INTEGER;
      return ia - ib;
    });
    
    data[sheetName] = uniqueRows;
  }

  analyses[analysisIndex].data = data;
  await fs.writeFile(ANALYSES_PATH, JSON.stringify(analyses, null, 2));

  return { updated: true, count: ordered.length };
}

export async function removeTranscriptFromAnalysis(projectId, analysisId, transcriptId) {
  const analyses = await readJsonSafe(ANALYSES_PATH, []);
  const idx = analyses.findIndex(a => a.id === analysisId && a.projectId === projectId);
  if (idx === -1) return { updated: false };
  const analysis = analyses[idx];
  if (!analysis.data) return { updated: false };

  for (const sheetName of Object.keys(analysis.data)) {
    const rows = analysis.data[sheetName];
    if (!Array.isArray(rows)) continue;
    analysis.data[sheetName] = rows.filter(r => r.transcriptId !== transcriptId);
  }

  // Also remove from analysis.transcripts list if present
  if (Array.isArray(analysis.transcripts)) {
    analysis.transcripts = analysis.transcripts.filter(t => {
      const id = t?.id || t?.sourceTranscriptId;
      return String(id) !== String(transcriptId);
    });
  }

  analyses[idx] = analysis;
  await fs.writeFile(ANALYSES_PATH, JSON.stringify(analyses, null, 2));
  // Recompute to recompact respnos
  return recomputeAnalysisRespnos(projectId, analysisId);
}

export default {
  computeChronoKey,
  recomputeAnalysisRespnos,
  removeTranscriptFromAnalysis
};


