import xlsx from 'xlsx';

try {
  const workbook = xlsx.readFile('Promo Refresh Content Analysis_HCP.xlsx');

  console.log('=== EXCEL ANALYSIS ===');
  console.log('Sheet Names:', workbook.SheetNames);
  console.log('');

  workbook.SheetNames.forEach(sheetName => {
    console.log(`=== SHEET: ${sheetName} ===`);
    const worksheet = workbook.Sheets[sheetName];
    const jsonData = xlsx.utils.sheet_to_json(worksheet, { header: 1 });

    if (jsonData.length > 0) {
      console.log('Headers (first row):', jsonData[0]);
      console.log('Total rows:', jsonData.length);

      if (jsonData.length > 1) {
        console.log('Sample data (first 3 rows):');
        jsonData.slice(0, Math.min(4, jsonData.length)).forEach((row, i) => {
          console.log(`Row ${i}:`, row);
        });
      }
    }
    console.log('');
  });
} catch (error) {
  console.error('Error reading Excel file:', error);
}