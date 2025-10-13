import xlsx from 'xlsx';

const wb = xlsx.readFile('assets/discussion guide example/Promo Refresh Content Analysis_HCP.xlsx');

const categorySheets = ['Category C', 'Category S', 'Category M', 'Category B', 'Category L'];

for (const sheetName of categorySheets) {
  console.log(`\n${'='.repeat(80)}`);
  console.log(`SHEET: ${sheetName}`);
  console.log('='.repeat(80));

  const ws = wb.Sheets[sheetName];
  const data = xlsx.utils.sheet_to_json(ws, {header: 1, defval: ''});

  const row1 = data[0]; // Main section headers
  const row2 = data[1]; // Sub-section headers
  const row3 = data[2]; // Column names

  console.log(`\nTotal columns: ${row3.length}\n`);

  // Group by main section
  let currentSection = '';
  let currentSub = '';
  let sectionCols = [];

  for(let i=0; i<row3.length; i++) {
    const section = row1[i] || currentSection;
    const sub = row2[i] || currentSub;
    const col = row3[i];

    if (section !== currentSection) {
      if (sectionCols.length > 0) {
        console.log(`  Columns: ${sectionCols.length}`);
        console.log('');
      }
      currentSection = section;
      if (section) {
        console.log(`SECTION: ${section}`);
      }
      sectionCols = [];
    }

    if (sub !== currentSub || section !== row1[i]) {
      currentSub = sub;
      if (sub) {
        console.log(`  Sub: ${sub}`);
      }
    }

    if (col) {
      console.log(`    - ${col}`);
      sectionCols.push(col);
    }
  }

  if (sectionCols.length > 0) {
    console.log(`  Columns: ${sectionCols.length}`);
  }
}
