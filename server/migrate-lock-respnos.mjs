import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, './data');
const TRANSCRIPTS_PATH = path.join(DATA_DIR, 'transcripts.json');
const ANALYSES_PATH = path.join(DATA_DIR, 'savedAnalyses.json');

function nextRespno(used) {
  let n = 1;
  while (used.has(`R${String(n).padStart(2, '0')}`) || used.has(`R${n}`)) n++;
  return n < 100 ? `R${String(n).padStart(2, '0')}` : `R${n}`;
}

async function main() {
  const transcriptsRaw = await fs.readFile(TRANSCRIPTS_PATH, 'utf8').catch(() => '{}');
  const analysesRaw = await fs.readFile(ANALYSES_PATH, 'utf8').catch(() => '[]');
  const transcripts = JSON.parse(transcriptsRaw || '{}');
  const analyses = JSON.parse(analysesRaw || '[]');

  // Lock/assign project respnos
  for (const [projectId, list] of Object.entries(transcripts)) {
    if (!Array.isArray(list)) continue;
    const used = new Set(list.map(t => String(t.respno || '').trim()).filter(Boolean));
    for (const t of list) {
      if (!t.respno || String(t.respno).trim() === '') {
        const r = nextRespno(used);
        t.respno = r;
        used.add(r);
      }
      t.respnoLocked = true;
    }
  }
  await fs.writeFile(TRANSCRIPTS_PATH, JSON.stringify(transcripts, null, 2));

  // Overwrite analysis rows' respno from locked transcripts
  const projectMap = new Map(Object.entries(transcripts));
  for (const a of analyses) {
    const projList = projectMap.get(a.projectId) || [];
    const idToRespno = new Map(projList.map(t => [String(t.id), t.respno]));
    if (a.data && a.data.Demographics && Array.isArray(a.data.Demographics)) {
      a.data.Demographics = a.data.Demographics.map(row => {
        if (row && row.transcriptId && idToRespno.has(String(row.transcriptId))) {
          const r = idToRespno.get(String(row.transcriptId));
          return { ...row, respno: r, 'Respondent ID': r };
        }
        return row;
      });
    }
    // Also update other sheets to match Demographics by index if transcriptId present
    if (a.data && typeof a.data === 'object') {
      for (const [sheet, rows] of Object.entries(a.data)) {
        if (sheet === 'Demographics' || !Array.isArray(rows)) continue;
        a.data[sheet] = rows.map(row => {
          if (row && row.transcriptId && idToRespno.has(String(row.transcriptId))) {
            const r = idToRespno.get(String(row.transcriptId));
            return { ...row, respno: r, 'Respondent ID': r };
          }
          return row;
        });
      }
    }
  }
  await fs.writeFile(ANALYSES_PATH, JSON.stringify(analyses, null, 2));

  console.log('✅ Migration complete: respnos locked and CA rows updated');
}

main().catch(err => {
  console.error('❌ Migration failed:', err);
  process.exit(1);
});




