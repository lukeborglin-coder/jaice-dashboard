import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function cleanupCAData() {
  const DATA_DIR = path.join(__dirname, 'data');
  const TRANSCRIPTS_PATH = path.join(DATA_DIR, 'transcripts.json');
  const ANALYSES_PATH = path.join(DATA_DIR, 'savedAnalyses.json');

  // Read current transcripts
  const transcriptsData = await fs.readFile(TRANSCRIPTS_PATH, 'utf8');
  const transcripts = JSON.parse(transcriptsData);

  // Read CA data
  const analysesData = await fs.readFile(ANALYSES_PATH, 'utf8');
  const analyses = JSON.parse(analysesData);

  console.log('=== CLEANUP STARTING ===\n');

  for (const analysis of analyses) {
    const projectId = analysis.projectId;
    console.log(`Processing project: ${projectId}`);

    const projectTranscripts = transcripts[projectId] || [];
    console.log(`Transcripts in project: ${projectTranscripts.length}`);

    if (projectTranscripts.length === 0) {
      console.log('  No transcripts found, skipping...\n');
      continue;
    }

    // Get valid respnos from transcripts
    const validRespnos = projectTranscripts.map(t => t.respno);
    console.log(`  Valid respnos: ${validRespnos.join(', ')}`);

    // Clean up all sheets - keep only rows matching valid respnos
    if (analysis.data) {
      for (const sheetName of Object.keys(analysis.data)) {
        if (!Array.isArray(analysis.data[sheetName])) continue;

        const originalCount = analysis.data[sheetName].length;

        // Filter to keep only valid respnos and non-empty rows
        analysis.data[sheetName] = analysis.data[sheetName].filter(row => {
          const rowRespno = row['Respondent ID'] || row['respno'];
          // Keep if respno is valid OR if it's not empty (for template rows)
          return rowRespno && validRespnos.includes(rowRespno);
        });

        const newCount = analysis.data[sheetName].length;
        if (originalCount !== newCount) {
          console.log(`  ${sheetName}: Removed ${originalCount - newCount} orphaned rows (${originalCount} -> ${newCount})`);
        }
      }
    }

    // Re-sort Demographics by date and reassign respnos to match transcripts
    if (analysis.data && analysis.data.Demographics) {
      const demographics = analysis.data.Demographics;

      // Sort by interview date
      demographics.sort((a, b) => {
        const dateA = a['Interview Date'] || a['Date'] || '';
        const dateB = b['Interview Date'] || b['Date'] || '';

        if (dateA && dateB) {
          const parsedA = new Date(dateA);
          const parsedB = new Date(dateB);
          if (!isNaN(parsedA.getTime()) && !isNaN(parsedB.getTime())) {
            return parsedA.getTime() - parsedB.getTime();
          }
        }
        return 0;
      });

      // Reassign respnos to match transcript order
      demographics.forEach((row, index) => {
        if (index < validRespnos.length) {
          const newRespno = validRespnos[index];
          if ('Respondent ID' in row) row['Respondent ID'] = newRespno;
          if ('respno' in row) row['respno'] = newRespno;
        }
      });

      // Update other sheets to match
      const sheetNames = Object.keys(analysis.data).filter(name => name !== 'Demographics');
      for (const sheetName of sheetNames) {
        const rows = analysis.data[sheetName];
        if (Array.isArray(rows)) {
          rows.forEach((row, index) => {
            if (index < demographics.length) {
              const newRespno = demographics[index]['Respondent ID'] || demographics[index]['respno'];
              if ('Respondent ID' in row) row['Respondent ID'] = newRespno;
              if ('respno' in row) row['respno'] = newRespno;
            }
          });
        }
      }

      console.log(`  Reassigned respnos to match transcript order`);
    }

    // Clean up context and quotes
    if (analysis.context) {
      for (const sheetName of Object.keys(analysis.context)) {
        if (analysis.context[sheetName]) {
          const contextRespnos = Object.keys(analysis.context[sheetName]);
          for (const respno of contextRespnos) {
            if (!validRespnos.includes(respno)) {
              delete analysis.context[sheetName][respno];
              console.log(`  Removed context for orphaned respno: ${respno}`);
            }
          }
        }
      }
    }

    if (analysis.quotes) {
      const quoteRespnos = Object.keys(analysis.quotes);
      for (const respno of quoteRespnos) {
        if (!validRespnos.includes(respno)) {
          delete analysis.quotes[respno];
          console.log(`  Removed quotes for orphaned respno: ${respno}`);
        }
      }
    }

    console.log('');
  }

  // Save cleaned data
  await fs.writeFile(ANALYSES_PATH, JSON.stringify(analyses, null, 2));
  console.log('=== CLEANUP COMPLETE ===');
  console.log('Saved cleaned data to savedAnalyses.json');
}

cleanupCAData().catch(console.error);
