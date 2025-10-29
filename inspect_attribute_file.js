const XLSX = require('xlsx');
const fs = require('fs');

// Read the Excel file
const workbook = XLSX.readFile('assets/Mock Conjoint/MOCK Conjoint Attribute List.xlsx');

console.log('Sheet names:', workbook.SheetNames);

// Get the first sheet (or Attributes sheet if it exists)
const sheetName = workbook.SheetNames.find(n => /attribute/i.test(String(n))) || workbook.SheetNames[0];
const sheet = workbook.Sheets[sheetName];

console.log('Using sheet:', sheetName);

// Convert to JSON
const data = XLSX.utils.sheet_to_json(sheet, { defval: '', raw: false });

console.log('Total rows:', data.length);
console.log('First 20 rows:');
data.slice(0, 20).forEach((row, i) => {
  console.log(`Row ${i}:`, JSON.stringify(row));
});

// Look for patterns
console.log('\nLooking for attribute patterns...');
let attributeCount = 0;
let currentAttribute = null;

data.forEach((row, i) => {
  const keys = Object.keys(row);
  const values = Object.values(row);
  
  // Check if this row starts a new attribute
  if (keys.includes('ATTRIBUTES') && values.some(v => v && String(v).trim())) {
    attributeCount++;
    currentAttribute = values.find(v => v && String(v).trim());
    console.log(`Found attribute ${attributeCount} at row ${i}: ${currentAttribute}`);
  }
});

console.log(`\nTotal attributes found: ${attributeCount}`);
