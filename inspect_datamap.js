const XLSX = require('xlsx');

const workbook = XLSX.readFile('./assets/MOCK Conjoint Only Data.xlsx');
const datamapSheet = workbook.Sheets['Datamap'];

// Try as 2D array first
const rows = XLSX.utils.sheet_to_json(datamapSheet, { defval: '', raw: false, header: 1 });

console.log('Looking for QC2 entries in Datamap:');
rows.forEach((row, i) => {
  if (row[0] && String(row[0]).includes('QC2')) {
    console.log(`Row ${i}:`, row.slice(0, 5));
  }
});
