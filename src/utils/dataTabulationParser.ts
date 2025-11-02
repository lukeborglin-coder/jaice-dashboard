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
        
        // Parse datamap to get variable definitions
        const variables = parseDatamapSheet(datamapWorksheet);
        
        // Parse data sheet
        const dataJson = XLSX.utils.sheet_to_json(dataWorksheet, { defval: null });
        
        const result: ParsedDataFile = {
          variables,
          data: dataJson as Record<string, any>[],
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

