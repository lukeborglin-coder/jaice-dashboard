import fs from 'fs/promises';

const data = JSON.parse(await fs.readFile('./server/data/savedAnalyses.json', 'utf8'));
const analysis = data.find(a => a.id === '1760031085874');

if (analysis) {
  console.log('Analysis found:', analysis.id);
  console.log('Has data:', !!analysis.data);
  console.log('Data keys:', Object.keys(analysis.data || {}));

  if (analysis.data) {
    const firstSheet = Object.keys(analysis.data)[0];
    console.log('\nFirst sheet:', firstSheet);
    console.log('First sheet structure:', JSON.stringify(analysis.data[firstSheet], null, 2));
  }
} else {
  console.log('Analysis not found');
}
