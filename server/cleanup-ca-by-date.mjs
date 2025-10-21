import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function cleanupCAByDate() {
  const DATA_DIR = path.join(__dirname, 'data');
  const TRANSCRIPTS_PATH = path.join(DATA_DIR, 'transcripts.json');
  const ANALYSES_PATH = path.join(DATA_DIR, 'savedAnalyses.json');

  // Read current transcripts
  const transcriptsData = await fs.readFile(TRANSCRIPTS_PATH, 'utf8');
  const transcripts = JSON.parse(transcriptsData);

  // Read CA data
  const analysesData = await fs.readFile(ANALYSES_PATH, 'utf8');
  const analyses = JSON.parse(analysesData);

  console.log('=== CLEANUP BY DATE STARTING ===\n');

  for (const analysis of analyses) {
    const projectId = analysis.projectId;
    console.log(`Processing project: ${projectId}`);

    const projectTranscripts = transcripts[projectId] || [];
    console.log(`Transcripts in project: ${projectTranscripts.length}`);

    if (projectTranscripts.length === 0) {
      console.log('  No transcripts found, skipping...\n');
      continue;
    }

    // Build a list of valid date+time combinations from transcripts
    const validDateTimes = projectTranscripts.map(t => ({
      date: t.interviewDate,
      time: t.interviewTime,
      respno: t.respno
    }));

    console.log('  Valid transcript date/times:');
    validDateTimes.forEach(dt => {
      console.log(`    ${dt.respno}: ${dt.date} - ${dt.time}`);
    });

    // Clean Demographics by matching date+time
    if (analysis.data && analysis.data.Demographics) {
      const demographics = analysis.data.Demographics;
      const originalCount = demographics.length;

      // Keep only rows that match a transcript's date+time
      analysis.data.Demographics = demographics.filter(row => {
        const rowDate = row['Interview Date'] || row['Date'];
        const rowTime = row['Interview Time'] || row['Time (ET)'];

        const matches = validDateTimes.some(dt =>
          dt.date === rowDate && dt.time === rowTime
        );

        if (!matches && (rowDate || rowTime)) {
          console.log(`  Removing orphaned row: ${rowDate} - ${rowTime}`);
        }

        return matches;
      });

      const newCount = analysis.data.Demographics.length;
      console.log(`  Demographics: ${originalCount} -> ${newCount} rows`);

      // Re-sort by date and reassign respnos
      analysis.data.Demographics.sort((a, b) => {
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
      analysis.data.Demographics.forEach((row, index) => {
        if (index < projectTranscripts.length) {
          const newRespno = projectTranscripts[index].respno;
          row['Respondent ID'] = newRespno;
          row['respno'] = newRespno;
        }
      });

      // Update all other sheets to match the count
      const sheetNames = Object.keys(analysis.data).filter(name => name !== 'Demographics');
      for (const sheetName of sheetNames) {
        const rows = analysis.data[sheetName];
        if (Array.isArray(rows)) {
          const originalSheetCount = rows.length;

          // Keep only the first N rows matching Demographics count
          analysis.data[sheetName] = rows.slice(0, analysis.data.Demographics.length);

          // Update respnos
          analysis.data[sheetName].forEach((row, index) => {
            if (index < analysis.data.Demographics.length) {
              const newRespno = analysis.data.Demographics[index]['Respondent ID'];
              row['Respondent ID'] = newRespno;
              row['respno'] = newRespno;
            }
          });

          const newSheetCount = analysis.data[sheetName].length;
          if (originalSheetCount !== newSheetCount) {
            console.log(`  ${sheetName}: ${originalSheetCount} -> ${newSheetCount} rows`);
          }
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

cleanupCAByDate().catch(console.error);
