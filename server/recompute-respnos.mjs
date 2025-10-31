import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs/promises';
import { recomputeAnalysisRespnos } from './services/respno.service.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, './data');
const ANALYSES_PATH = path.join(DATA_DIR, 'savedAnalyses.json');

async function main() {
  const raw = await fs.readFile(ANALYSES_PATH, 'utf8').catch(() => '[]');
  const analyses = JSON.parse(raw || '[]');
  let updated = 0;
  for (const a of analyses) {
    const res = await recomputeAnalysisRespnos(a.projectId, a.id).catch(e => ({ updated: false, error: e?.message }));
    if (res?.updated) updated++;
    console.log(`Recomputed ${a.id} (${a.name || ''}) =>`, res);
  }
  console.log(`Done. Updated analyses: ${updated}/${analyses.length}`);
}

main().catch(err => {
  console.error('Failed:', err);
  process.exit(1);
});




