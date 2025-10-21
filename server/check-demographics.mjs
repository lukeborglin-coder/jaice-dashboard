import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function checkDemographics() {
  const ANALYSES_PATH = path.join(__dirname, 'data', 'savedAnalyses.json');
  const analysesData = await fs.readFile(ANALYSES_PATH, 'utf8');
  const analyses = JSON.parse(analysesData);

  const analysis = analyses.find(a => a.projectId === 'P-1759172819869');

  if (analysis && analysis.data && analysis.data.Demographics) {
    console.log('Demographics rows for P-1759172819869:');
    console.log('Total rows:', analysis.data.Demographics.length);
    console.log('');

    analysis.data.Demographics.forEach((row, index) => {
      console.log(`Row ${index + 1}:`);
      console.log('  Respondent ID:', row['Respondent ID']);
      console.log('  respno:', row['respno']);
      console.log('  Date:', row['Interview Date'] || row['Date']);
      console.log('  Time:', row['Interview Time'] || row['Time (ET)']);
      console.log('');
    });
  } else {
    console.log('No analysis found for P-1759172819869');
  }
}

checkDemographics().catch(console.error);
