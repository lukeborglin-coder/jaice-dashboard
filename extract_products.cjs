const XLSX = require('xlsx');
const wb = XLSX.readFile('assets/MOCK Conjoint Only Data.xlsx');
const dataMapSheet = wb.Sheets['Datamap'];
const data = XLSX.utils.sheet_to_json(dataMapSheet, { header: 1 });
const productMap = new Map();

data.forEach(row => {
  const colName = row[1];
  const label = row[2];
  if (colName && label && colName.match(/QC2_\d+r(\d+)c1/)) {
    const match = colName.match(/r(\d+)c1/);
    if (match) {
      const rowNum = match[1];
      if (!productMap.has(rowNum)) {
        productMap.set(rowNum, label);
      }
    }
  }
});

console.log('Product names by row number:');
for (const [rowNum, name] of productMap.entries()) {
  console.log('r' + rowNum + ':', name);
}
