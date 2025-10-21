import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const TRANSCRIPTS_FILE = path.join(__dirname, 'data', 'transcripts.json');
const ANALYSES_FILE = path.join(__dirname, 'data', 'savedAnalyses.json');
const BACKUP_DIR = path.join(__dirname, 'data', 'backups');

async function ensureBackupDir() {
  try {
    await fs.access(BACKUP_DIR);
  } catch {
    await fs.mkdir(BACKUP_DIR, { recursive: true });
  }
}

async function createBackup(filePath) {
  const timestamp = new Date().toISOString().replace(/:/g, '-').replace(/\..+/, '');
  const basename = path.basename(filePath, '.json');
  const backupPath = path.join(BACKUP_DIR, `${basename}_backup_${timestamp}.json`);

  const data = await fs.readFile(filePath, 'utf8');
  await fs.writeFile(backupPath, data, 'utf8');

  console.log(`✅ Backup created: ${backupPath}`);
  return backupPath;
}

async function loadJSON(filePath) {
  const data = await fs.readFile(filePath, 'utf8');
  return JSON.parse(data);
}

async function saveJSON(filePath, data) {
  await fs.writeFile(filePath, JSON.stringify(data, null, 2), 'utf8');
}

function normalizeDateTime(date, time) {
  // Normalize date and time for comparison
  const normalizedDate = (date || '').trim();
  const normalizedTime = (time || '').trim();
  return `${normalizedDate}|${normalizedTime}`;
}

async function syncContentAnalyses() {
  console.log('\n🔄 Starting Content Analysis Sync...\n');

  // Create backup directory
  await ensureBackupDir();

  // Create backups
  console.log('📦 Creating backups...');
  await createBackup(ANALYSES_FILE);

  // Load data
  console.log('\n📖 Loading data...');
  const transcriptsByProject = await loadJSON(TRANSCRIPTS_FILE);
  const analyses = await loadJSON(ANALYSES_FILE);

  console.log(`   Found ${Object.keys(transcriptsByProject).length} projects with transcripts`);
  console.log(`   Found ${analyses.length} content analyses\n`);

  let totalAnalysesProcessed = 0;
  let totalRowsRemoved = 0;
  let totalDuplicatesRemoved = 0;

  // Process each analysis
  for (const analysis of analyses) {
    if (!analysis.data || !analysis.projectId) {
      console.log(`⚠️  Skipping analysis ${analysis.id} - no data or projectId`);
      continue;
    }

    totalAnalysesProcessed++;
    const projectId = analysis.projectId;
    const projectTranscripts = transcriptsByProject[projectId] || [];

    console.log(`\n📊 Processing: ${analysis.name || analysis.id}`);
    console.log(`   Project: ${projectId}`);
    console.log(`   Project has ${projectTranscripts.length} transcripts`);

    // Build a set of valid respondent IDs and date/times from transcripts
    const validRespondents = new Set();
    const validDateTimes = new Set();

    projectTranscripts.forEach(t => {
      const respno = t.respno || t['Respondent ID'];
      const date = t.interviewDate || t['Interview Date'];
      const time = t.interviewTime || t['Interview Time'];

      if (respno) validRespondents.add(respno);
      if (date && time) {
        validDateTimes.add(normalizeDateTime(date, time));
      }
    });

    console.log(`   Valid respondents: ${Array.from(validRespondents).join(', ')}`);

    // Process each sheet in the analysis
    for (const [sheetName, sheetData] of Object.entries(analysis.data)) {
      if (!Array.isArray(sheetData)) continue;

      const originalRowCount = sheetData.length;
      let rowsRemoved = 0;
      let duplicatesRemoved = 0;

      // Track seen date/times for duplicate detection
      const seenDateTimes = new Set();

      // Filter rows
      const filteredData = [];

      for (const row of sheetData) {
        const rowRespno = row['Respondent ID'] || row['respno'];
        const rowDate = row['Interview Date'] || row['interviewDate'];
        const rowTime = row['Interview Time'] || row['interviewTime'];

        // Check if respondent exists in project transcripts
        if (rowRespno && !validRespondents.has(rowRespno)) {
          console.log(`   ❌ Removing ${sheetName} row: ${rowRespno} (transcript not found in project)`);
          rowsRemoved++;
          continue;
        }

        // Check for duplicates by date/time
        if (rowDate && rowTime) {
          const dateTimeKey = normalizeDateTime(rowDate, rowTime);

          if (seenDateTimes.has(dateTimeKey)) {
            console.log(`   ⚠️  Removing duplicate ${sheetName} row: ${rowRespno} (${rowDate} ${rowTime})`);
            duplicatesRemoved++;
            rowsRemoved++;
            continue;
          }

          seenDateTimes.add(dateTimeKey);
        }

        // Keep this row
        filteredData.push(row);
      }

      // Update the sheet data
      analysis.data[sheetName] = filteredData;

      if (rowsRemoved > 0) {
        console.log(`   📝 ${sheetName}: ${originalRowCount} → ${filteredData.length} rows (removed ${rowsRemoved}, duplicates: ${duplicatesRemoved})`);
        totalRowsRemoved += rowsRemoved;
        totalDuplicatesRemoved += duplicatesRemoved;
      }
    }
  }

  // Save updated analyses
  console.log('\n💾 Saving updated analyses...');
  await saveJSON(ANALYSES_FILE, analyses);

  console.log('\n✅ Sync completed!');
  console.log(`\n📈 Summary:`);
  console.log(`   Analyses processed: ${totalAnalysesProcessed}`);
  console.log(`   Total rows removed: ${totalRowsRemoved}`);
  console.log(`   Duplicates removed: ${totalDuplicatesRemoved}`);
  console.log(`\n💾 Backup location: ${BACKUP_DIR}\n`);
}

// Run the sync
syncContentAnalyses().catch(error => {
  console.error('\n❌ Error during sync:', error);
  process.exit(1);
});
