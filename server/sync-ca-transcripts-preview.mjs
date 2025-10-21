import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const TRANSCRIPTS_FILE = path.join(__dirname, 'data', 'transcripts.json');
const ANALYSES_FILE = path.join(__dirname, 'data', 'savedAnalyses.json');

async function loadJSON(filePath) {
  const data = await fs.readFile(filePath, 'utf8');
  return JSON.parse(data);
}

function normalizeDateTime(date, time) {
  const normalizedDate = (date || '').trim();
  const normalizedTime = (time || '').trim();
  return `${normalizedDate}|${normalizedTime}`;
}

async function previewSync() {
  console.log('\n🔍 Preview Mode - No changes will be made\n');
  console.log('=' .repeat(60));

  // Load data
  const transcriptsByProject = await loadJSON(TRANSCRIPTS_FILE);
  const analyses = await loadJSON(ANALYSES_FILE);

  console.log(`\n📖 Found ${Object.keys(transcriptsByProject).length} projects with transcripts`);
  console.log(`📖 Found ${analyses.length} content analyses\n`);

  let totalRowsToRemove = 0;
  let totalDuplicatesToRemove = 0;

  // Process each analysis
  for (const analysis of analyses) {
    if (!analysis.data || !analysis.projectId) {
      continue;
    }

    const projectId = analysis.projectId;
    const projectTranscripts = transcriptsByProject[projectId] || [];

    console.log('\n' + '─'.repeat(60));
    console.log(`📊 Analysis: ${analysis.name || analysis.id}`);
    console.log(`   Project ID: ${projectId}`);
    console.log(`   Transcripts in project: ${projectTranscripts.length}`);

    // Build valid respondents set
    const validRespondents = new Set();
    projectTranscripts.forEach(t => {
      const respno = t.respno || t['Respondent ID'];
      if (respno) validRespondents.add(respno);
    });

    console.log(`   Valid respondents: ${Array.from(validRespondents).join(', ') || 'none'}`);

    // Check each sheet
    for (const [sheetName, sheetData] of Object.entries(analysis.data)) {
      if (!Array.isArray(sheetData)) continue;

      const rowsToRemove = [];
      const duplicates = [];
      const seenDateTimes = new Set();

      for (let i = 0; i < sheetData.length; i++) {
        const row = sheetData[i];
        const rowRespno = row['Respondent ID'] || row['respno'];
        const rowDate = row['Interview Date'] || row['interviewDate'];
        const rowTime = row['Interview Time'] || row['interviewTime'];

        // Check if respondent exists
        if (rowRespno && !validRespondents.has(rowRespno)) {
          rowsToRemove.push({
            index: i,
            respno: rowRespno,
            date: rowDate,
            time: rowTime,
            reason: 'Transcript not found in project'
          });
        }

        // Check for duplicates
        if (rowDate && rowTime) {
          const dateTimeKey = normalizeDateTime(rowDate, rowTime);
          if (seenDateTimes.has(dateTimeKey)) {
            duplicates.push({
              index: i,
              respno: rowRespno,
              date: rowDate,
              time: rowTime,
              reason: 'Duplicate date/time'
            });
          }
          seenDateTimes.add(dateTimeKey);
        }
      }

      if (rowsToRemove.length > 0 || duplicates.length > 0) {
        console.log(`\n   📋 Sheet: ${sheetName}`);
        console.log(`      Current rows: ${sheetData.length}`);

        if (rowsToRemove.length > 0) {
          console.log(`\n      ❌ Rows to remove (no transcript):`);
          rowsToRemove.forEach(r => {
            console.log(`         Row ${r.index + 1}: ${r.respno} (${r.date} ${r.time})`);
          });
        }

        if (duplicates.length > 0) {
          console.log(`\n      ⚠️  Duplicate rows to remove:`);
          duplicates.forEach(d => {
            console.log(`         Row ${d.index + 1}: ${d.respno} (${d.date} ${d.time})`);
          });
        }

        const totalToRemove = rowsToRemove.length + duplicates.length;
        console.log(`\n      📊 After cleanup: ${sheetData.length} → ${sheetData.length - totalToRemove} rows`);

        totalRowsToRemove += rowsToRemove.length;
        totalDuplicatesToRemove += duplicates.length;
      }
    }
  }

  console.log('\n' + '='.repeat(60));
  console.log('\n📈 Summary:');
  console.log(`   Orphaned rows to remove: ${totalRowsToRemove}`);
  console.log(`   Duplicate rows to remove: ${totalDuplicatesToRemove}`);
  console.log(`   Total rows to remove: ${totalRowsToRemove + totalDuplicatesToRemove}`);

  if (totalRowsToRemove + totalDuplicatesToRemove > 0) {
    console.log('\n💡 To apply these changes, run:');
    console.log('   node sync-ca-transcripts.mjs');
  } else {
    console.log('\n✅ No changes needed - data is already synchronized!');
  }
  console.log('');
}

// Run the preview
previewSync().catch(error => {
  console.error('\n❌ Error during preview:', error);
  process.exit(1);
});
