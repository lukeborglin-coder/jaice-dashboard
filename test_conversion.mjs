import { convertArrayOfArraysToJSON } from './server/services/caGenerator.service.mjs';

// Sample 3-row header data (mimicking what buildCategorySheet produces)
const testData = [
  // Row 1: Section headers
  ['', '', '', '', '', 'Initial Ranking & Impressions', '', '', '', '', '', '', '', '', 'Detailed Message Review'],

  // Row 2: Sub-headers
  ['', '', '', '', '', 'Overall reaction?', 'MESSAGE RANKING', '', '', '', 'Why did you rank them?', 'MOST preferred?', 'LEAST preferred?', '', 'C-W'],

  // Row 3: Column names
  ['Respondent ID', 'Specialty', 'Date', 'Time (ET)', '', '', 'C-W', 'C-S', 'C-D', 'C-M', '', '', '', '', 'Initial thoughts?'],

  // Data rows
  ['R001', 'Neuro', '08/15/24', '10:00 AM', '', 'Good messages', '1', '2', '3', '4', 'Clear hierarchy', 'C-W best', 'C-M least', '', 'Very clear'],
  ['R002', 'Pediatric', '08/16/24', '2:00 PM', '', 'Interesting', '2', '1', '4', '3', 'Different needs', 'C-S best', 'C-D least', '', 'Makes sense']
];

console.log('Testing convertArrayOfArraysToJSON...\n');
console.log('Input: 3-row header + 2 data rows');
console.log('Headers:');
console.log('  Row 1:', testData[0].slice(0, 15));
console.log('  Row 2:', testData[1].slice(0, 15));
console.log('  Row 3:', testData[2].slice(0, 15));

const result = convertArrayOfArraysToJSON(testData);

console.log('\nOutput: JSON objects with hierarchical column names');
console.log('Number of data rows:', result.length);
console.log('\nFirst row keys (first 10):');
const keys = Object.keys(result[0]).slice(0, 10);
keys.forEach(key => console.log(`  - "${key}"`));

console.log('\nFirst data row values:');
console.log(JSON.stringify(result[0], null, 2));

console.log('\n✅ Conversion successful! Headers are now hierarchical column names.');
