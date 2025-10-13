const xlsx = require('xlsx');

const wb = xlsx.readFile('assets/discussion guide example/Promo Refresh Content Analysis_HCP.xlsx');
const ws = wb.Sheets['Category C'];
const data = xlsx.utils.sheet_to_json(ws, {header: 1, defval: ''});

console.log('=== CATEGORY C STRUCTURE ===\n');

const row1 = data[0]; // Main section headers
const row2 = data[1]; // Sub-section headers
const row3 = data[2]; // Column names

console.log('Total columns:', row3.length);
console.log('\n=== ALL COLUMNS ===\n');

for(let i=0; i<row3.length; i++) {
  if (row3[i] || row2[i] || row1[i]) {
    console.log(`Col ${i+1}:`);
    console.log(`  Section: ${row1[i]}`);
    console.log(`  Sub: ${row2[i]}`);
    console.log(`  Column: ${row3[i]}`);
    console.log('');
  }
}
