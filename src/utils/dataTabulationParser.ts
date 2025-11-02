import * as XLSX from 'xlsx';

export interface VariableDefinition {
  name: string;
  description: string;
  type: 'categorical' | 'open-numeric' | 'open-text';
  codes: Record<string, string>; // {code: label}
}

export interface ParsedDataFile {
  variables: VariableDefinition[];
  data: Record<string, any>[]; // Array of response objects
  rowCount: number;
  metadata: {
    fileName: string;
    uploadedAt: Date;
    sheetNames: string[];
  };
}

/**
 * Parse the datamap sheet to extract variable definitions and codes
 */
function parseDatamapSheet(worksheet: XLSX.WorkSheet): VariableDefinition[] {
  const data = XLSX.utils.sheet_to_json(worksheet, { header: 1, defval: '' });
  const variables: VariableDefinition[] = [];
  
  let currentVar: VariableDefinition | null = null;
  let collectingCodes = false;
  
  for (let i = 0; i < data.length; i++) {
    const row = data[i] as string[];
    const firstCell = row && row[0] ? row[0].toString().trim() : '';
    const secondCell = row && row[1] ? row[1].toString().trim() : '';
    const thirdCell = row && row[2] ? row[2].toString().trim() : '';
    
    // Check if this is a variable definition (starts with [)
    if (firstCell.startsWith('[') && firstCell.includes(']:')) {
      // Save previous variable if exists
      if (currentVar) {
        variables.push(currentVar);
      }
      
      collectingCodes = false;
      
      // Extract variable name and description
      const match = firstCell.match(/\[([^\]]+)\]:\s*(.+)/);
      if (match) {
        const varName = match[1];
        const description = match[2];
        currentVar = {
          name: varName,
          description: description,
          type: 'open-text', // Default, will be updated below
          codes: {}
        };
      }
    } else if (currentVar) {
      // Check for response type
      if (firstCell.includes('Values:')) {
        currentVar.type = 'categorical';
        collectingCodes = true; // Start collecting codes after "Values:"
      } else if (firstCell.includes('Open numeric')) {
        currentVar.type = 'open-numeric';
        collectingCodes = false; // Stop collecting codes
      } else if (firstCell.includes('Open text')) {
        currentVar.type = 'open-text';
        collectingCodes = false; // Stop collecting codes
      }
      
      // Only collect codes if we're in code collection mode and it's a categorical variable
      if (collectingCodes && currentVar.type === 'categorical') {
        // Check if this row contains a code definition
        // Format: ["", "codeValue", "codeLabel"]
        if (!firstCell && secondCell && secondCell.match(/^\d+$/)) {
          // This is a code row: empty first cell, code in second, label in third
          const codeValue = secondCell;
          let codeLabel = thirdCell || '';
          // Remove the code number if it's appended at the end of the label (with no space)
          if (codeLabel.endsWith(codeValue)) {
            codeLabel = codeLabel.slice(0, -codeValue.length).trim();
          }
          // Only add if we have a valid label (not empty, and not just a variable name like Q1, Q2, etc.)
          if (codeLabel && !codeLabel.match(/^Q\d+/i)) {
            currentVar.codes[codeValue] = codeLabel;
          }
        } else if (firstCell && firstCell.match(/^\d+$/) && secondCell) {
          // Alternative format: code in first cell, label in second
          const codeValue = firstCell;
          let codeLabel = secondCell;
          // Remove the code number if it's appended at the end of the label (with no space)
          if (codeLabel.endsWith(codeValue)) {
            codeLabel = codeLabel.slice(0, -codeValue.length).trim();
          }
          // Only add if we have a valid label (not empty, and not just a variable name like Q1, Q2, etc.)
          if (codeLabel && !codeLabel.match(/^Q\d+/i)) {
            currentVar.codes[codeValue] = codeLabel;
          }
        } else {
          // If we encounter a non-code row while collecting codes, stop collecting
          // This handles cases where there might be blank lines or other content after codes
          if (firstCell && !firstCell.match(/^\d+$/) && !firstCell.includes('Values:')) {
            // Stop collecting if we hit something that's not a code (unless it's empty)
            if (firstCell && !firstCell.startsWith('[')) {
              collectingCodes = false;
            }
          }
        }
      }
      
      // Check if we hit another variable definition (stop collecting codes)
      if (firstCell.startsWith('[')) {
        collectingCodes = false;
        variables.push(currentVar);
        const match = firstCell.match(/\[([^\]]+)\]:\s*(.+)/);
        if (match) {
          currentVar = {
            name: match[1],
            description: match[2],
            type: 'open-text',
            codes: {}
          };
        } else {
          currentVar = null;
        }
      }
    }
  }
  
  // Don't forget the last variable
  if (currentVar) {
    variables.push(currentVar);
  }
  
  return variables;
}

/**
 * Parse Excel file with data and datamap sheets
 */
export async function parseDataFile(file: File): Promise<ParsedDataFile> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    
    reader.onload = (e) => {
      try {
        const data = new Uint8Array(e.target?.result as ArrayBuffer);
        const workbook = XLSX.read(data, { type: 'array' });
        
        if (workbook.SheetNames.length < 2) {
          reject(new Error('File must contain at least 2 sheets: one for data and one for datamap'));
          return;
        }
        
        // Find data sheet (typically first sheet, or sheet named "A1" or similar)
        let dataSheetName = workbook.SheetNames[0];
        let datamapSheetName = workbook.SheetNames.find(name => 
          name.toLowerCase().includes('datamap') || name.toLowerCase().includes('data map')
        ) || workbook.SheetNames[1];
        
        // If no explicit datamap found, assume first sheet is data, second is datamap
        if (!workbook.SheetNames.some(name => name.toLowerCase().includes('datamap'))) {
          dataSheetName = workbook.SheetNames[0];
          datamapSheetName = workbook.SheetNames[1];
        }
        
        const dataWorksheet = workbook.Sheets[dataSheetName];
        const datamapWorksheet = workbook.Sheets[datamapSheetName];
        
        if (!dataWorksheet || !datamapWorksheet) {
          reject(new Error('Could not find required sheets. Expected: data sheet and datamap sheet'));
          return;
        }
        
        console.log(`Using data sheet: "${dataSheetName}"`);
        console.log(`Using datamap sheet: "${datamapSheetName}"`);
        console.log(`All sheets:`, workbook.SheetNames);
        
        // Parse datamap to get variable definitions
        const variables = parseDatamapSheet(datamapWorksheet);
        console.log(`Parsed ${variables.length} variables from datamap`);
        
        // Parse data sheet
        const dataJson = XLSX.utils.sheet_to_json(dataWorksheet, { defval: null }) as Record<string, any>[];
        console.log(`Parsed ${dataJson.length} rows from data sheet`);
        
        // Create a mapping from variable names to actual column names (handles case-insensitive and whitespace differences)
        const variableToColumnMap: Record<string, string> = {};
        if (dataJson.length > 0) {
          const firstRow = dataJson[0];
          const columnNames = Object.keys(firstRow);
          
          // Build mapping: for each variable, find matching column (case-insensitive, trimmed)
          // Column headers may include descriptions like "QS1 - Question text here"
          variables.forEach(v => {
            const varNameNormalized = v.name.trim().toLowerCase();
            // Try exact match first
            let matchingColumn = columnNames.find(col => {
              const colTrimmed = col.trim().toLowerCase();
              return colTrimmed === varNameNormalized;
            });
            
            // If no exact match, try matching the part before " - " (description separator)
            if (!matchingColumn) {
              matchingColumn = columnNames.find(col => {
                const colTrimmed = col.trim();
                // Extract variable name part (before " - " or just the column name)
                const varPart = colTrimmed.split(' - ')[0].trim().toLowerCase();
                return varPart === varNameNormalized;
              });
            }
            
            if (matchingColumn) {
              variableToColumnMap[v.name] = matchingColumn;
            } else {
              // Only log the first few to avoid spam
              if (variables.indexOf(v) < 5) {
                console.warn(`Variable "${v.name}" not found in data columns.`);
              }
            }
          });
          
          // Debug: log mapping summary and actual columns
          console.log(`Matched ${Object.keys(variableToColumnMap).length} of ${variables.length} variables to columns`);
          console.log(`Actual data columns (${columnNames.length}):`, columnNames);
          console.log(`Variables from datamap (first 10):`, variables.slice(0, 10).map(v => v.name));
          
          // Normalize row data: add variable names as aliases for column access
          // This allows row[variableName] to work even if column header differs slightly
          dataJson.forEach(row => {
            Object.keys(variableToColumnMap).forEach(varName => {
              const columnName = variableToColumnMap[varName];
              if (columnName in row) {
                // Add variable name as an alias to the column value
                row[varName] = row[columnName];
              }
            });
            
            // Also add aliases for columns that have descriptions (extract variable name part)
            Object.keys(row).forEach(colName => {
              const trimmed = colName.trim();
              // Extract variable name part (before " - ")
              if (trimmed.includes(' - ')) {
                const varPart = trimmed.split(' - ')[0].trim();
                // Only add as alias if it matches a variable name (case-insensitive)
                const matchingVar = variables.find(v => 
                  v.name.trim().toLowerCase() === varPart.toLowerCase()
                );
                if (matchingVar && !(matchingVar.name in row)) {
                  row[matchingVar.name] = row[colName];
                }
              }
              
              // Also normalize all column names by trimming (so exact matches work)
              if (trimmed !== colName && !(trimmed in row)) {
                row[trimmed] = row[colName];
              }
            });
          });
        }
        
        const result: ParsedDataFile = {
          variables,
          data: dataJson,
          rowCount: dataJson.length,
          metadata: {
            fileName: file.name,
            uploadedAt: new Date(),
            sheetNames: workbook.SheetNames
          }
        };
        
        resolve(result);
      } catch (error) {
        reject(error);
      }
    };
    
    reader.onerror = () => {
      reject(new Error('Failed to read file'));
    };
    
    reader.readAsArrayBuffer(file);
  });
}

/**
 * Get variable definition by name
 */
export function getVariableDefinition(variables: VariableDefinition[], varName: string): VariableDefinition | undefined {
  return variables.find(v => v.name === varName);
}

/**
 * Get code label for a variable and code value
 */
export function getCodeLabel(variables: VariableDefinition[], varName: string, codeValue: string | number | null | undefined): string {
  if (codeValue === null || codeValue === undefined || codeValue === '') {
    return 'Missing';
  }
  
  const varDef = getVariableDefinition(variables, varName);
  if (!varDef || varDef.type !== 'categorical') {
    return String(codeValue);
  }
  
  const codeStr = String(codeValue);
  return varDef.codes[codeStr] || codeStr;
}

