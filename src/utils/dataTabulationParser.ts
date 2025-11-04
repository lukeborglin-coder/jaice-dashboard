import * as XLSX from 'xlsx';

export interface VariableDefinition {
  name: string;
  description: string;
  type: 'categorical' | 'open-numeric' | 'open-text' | 'multi-select' | 'grid';
  codes: Record<string, string>; // {code: label} - for grid, these are the response options
  statements?: Record<string, string>; // For grid questions: {statementCode: statementText}
  isMultiSelectOption?: boolean; // True if this is a sub-variable of a multi-select (e.g., QS3r1)
  parentMultiSelect?: string; // Parent multi-select variable name (e.g., QS3)
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
  let collectingMultiSelectOptions = false; // Track if we're collecting multi-select sub-variables
  let multiSelectOptions: Array<{ name: string; description: string }> = []; // Store sub-variable refs
  let collectingGridStatements = false; // Track if we're collecting grid statements
  let gridStatements: Array<{ name: string; description: string }> = []; // Store grid statement refs

  for (let i = 0; i < data.length; i++) {
    const row = data[i] as string[];
    const firstCell = row && row[0] ? row[0].toString().trim() : '';
    const secondCell = row && row[1] ? row[1].toString().trim() : '';
    const thirdCell = row && row[2] ? row[2].toString().trim() : '';

    // Check if this is a multi-select question definition (e.g., "QS2: question text")
    // Pattern: starts with a question code followed by colon, not in brackets
    const multiSelectMatch = firstCell.match(/^([A-Z]+\d+[A-Za-z]*)\s*:\s*(.+)/);
    if (multiSelectMatch && !firstCell.startsWith('[')) {
      // Save previous variable if exists
      if (currentVar) {
        variables.push(currentVar);
      }

      const varName = multiSelectMatch[1];
      const description = multiSelectMatch[2];

      // Look ahead to see if this is a multi-select or grid (next row should be "Values: X-Y")
      const nextRow = i + 1 < data.length ? data[i + 1] as string[] : [];
      const nextFirstCell = nextRow && nextRow[0] ? nextRow[0].toString().trim() : '';

      if (nextFirstCell.includes('Values:')) {
        // Extract the range to determine question type
        if (nextFirstCell.includes('0-1')) {
          // This is a multi-select question (Values: 0-1 = Unchecked/Checked)
          currentVar = {
            name: varName,
            description: description,
            type: 'multi-select',
            codes: {} // Will be populated from sub-variables
          };
          collectingCodes = false;
          collectingMultiSelectOptions = true;
          multiSelectOptions = [];
          continue;
        } else {
          // This is a grid question (Values: 1-X where X > 1)
          // Grid has response codes (1-X) that apply to each statement
          currentVar = {
            name: varName,
            description: description,
            type: 'grid',
            codes: {}, // Will be populated with response options (1-3, etc.)
            statements: {} // Will be populated with grid statements
          };
          collectingCodes = true; // First collect the response codes
          collectingGridStatements = false;
          gridStatements = [];
          continue;
        }
      } else {
        // Not a multi-select or grid, just a regular question
        currentVar = {
          name: varName,
          description: description,
          type: 'open-text',
          codes: {}
        };
        collectingCodes = false;
        collectingMultiSelectOptions = false;
        continue;
      }
    }

    // If we're collecting multi-select options, look for sub-variable references in column [1]
    if (collectingMultiSelectOptions && currentVar) {
      // Skip "Values:" rows, code definition rows, etc.
      if (firstCell.includes('Values:') ||
          (!firstCell && secondCell.match(/^\d+$/))) {
        // Skip these rows when collecting multi-select options
        continue;
      }

      // Check for empty row (signals end of multi-select definition)
      if (!firstCell && !secondCell && !thirdCell) {
        // Build codes from collected sub-variables
        multiSelectOptions.forEach((opt, idx) => {
          const optionNumber = String(idx + 1);
          currentVar!.codes[optionNumber] = opt.description;
        });

        variables.push(currentVar);
        currentVar = null;
        collectingMultiSelectOptions = false;
        multiSelectOptions = [];
        continue;
      }

      // Check if column [1] contains a sub-variable reference like "[QS2r1]"
      const subVarMatch = secondCell.match(/\[([^\]]+)\]/);
      if (subVarMatch && thirdCell) {
        const subVarName = subVarMatch[1];
        multiSelectOptions.push({
          name: subVarName,
          description: thirdCell
        });
        continue;
      }

      // If we hit a new variable definition (starts with [), stop collecting
      if (firstCell.startsWith('[') && firstCell.includes(']:')) {
        // Save the multi-select variable with collected options
        multiSelectOptions.forEach((opt, idx) => {
          const optionNumber = String(idx + 1);
          currentVar!.codes[optionNumber] = opt.description;
        });

        variables.push(currentVar);
        collectingMultiSelectOptions = false;
        multiSelectOptions = [];

        // Now process this new variable definition
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
        continue;
      }
    }

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
      // Check if we've hit an empty row after collecting codes
      // This signals the end of the current variable's definition
      if (collectingCodes && !firstCell && !secondCell && !thirdCell) {
        // Empty row after codes - stop collecting and save the variable
        collectingCodes = false;
        variables.push(currentVar);
        currentVar = null;
        continue;
      }

      // Check for response type
      if (firstCell.includes('Values:')) {
        // Skip "Values:" rows for grid questions - we've already set the type
        if (currentVar.type === 'grid') {
          continue;
        }

        // If we encounter a new "Values:" while already collecting codes,
        // it means we've moved to a new variable definition (like QS2)
        // Save the current variable and stop collecting
        if (collectingCodes) {
          variables.push(currentVar);
          currentVar = null;
          collectingCodes = false;
          continue;
        }

        currentVar.type = 'categorical';
        collectingCodes = true; // Start collecting codes after "Values:"
      } else if (firstCell.includes('Open numeric')) {
        currentVar.type = 'open-numeric';
        collectingCodes = false; // Stop collecting codes
      } else if (firstCell.includes('Open text')) {
        currentVar.type = 'open-text';
        collectingCodes = false; // Stop collecting codes
      }
      
      // Collect codes for categorical variables
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

      // Collect codes and statements for grid questions
      if (currentVar && currentVar.type === 'grid') {
        // First collect response codes
        if (collectingCodes && !collectingGridStatements) {
          if (!firstCell && secondCell && secondCell.match(/^\d+$/)) {
            // This is a response code row
            const codeValue = secondCell;
            let codeLabel = thirdCell || '';
            if (codeLabel.endsWith(codeValue)) {
              codeLabel = codeLabel.slice(0, -codeValue.length).trim();
            }
            if (codeLabel && !codeLabel.match(/^Q\d+/i)) {
              currentVar.codes[codeValue] = codeLabel;
            }
          } else if (!firstCell && secondCell.match(/^\[.+\]$/)) {
            // Found a statement reference like [QS4r1] - switch to collecting statements
            collectingCodes = false;
            collectingGridStatements = true;

            // Process this statement row
            const subVarMatch = secondCell.match(/\[([^\]]+)\]/);
            if (subVarMatch && thirdCell) {
              const statementCode = subVarMatch[1];
              gridStatements.push({
                name: statementCode,
                description: thirdCell
              });
            }
          }
        } else if (collectingGridStatements) {
          // Continue collecting grid statements

          // Check for empty row (signals end of grid definition)
          if (!firstCell && !secondCell && !thirdCell) {
            // Build statements from collected data
            gridStatements.forEach((stmt, idx) => {
              const statementNumber = String(idx + 1);
              currentVar!.statements![statementNumber] = stmt.description;
            });

            variables.push(currentVar);
            currentVar = null;
            collectingGridStatements = false;
            gridStatements = [];
            continue;
          }

          // Check if column [1] contains a statement reference like "[QS4r1]"
          const subVarMatch = secondCell.match(/\[([^\]]+)\]/);
          if (subVarMatch && thirdCell) {
            const statementCode = subVarMatch[1];
            gridStatements.push({
              name: statementCode,
              description: thirdCell
            });
            continue;
          }

          // If we hit a new variable definition (starts with [), stop collecting
          if (firstCell.startsWith('[') && firstCell.includes(']:')) {
            // Save the grid variable with collected statements
            gridStatements.forEach((stmt, idx) => {
              const statementNumber = String(idx + 1);
              currentVar!.statements![statementNumber] = stmt.description;
            });

            variables.push(currentVar);
            collectingGridStatements = false;
            gridStatements = [];

            // Now process this new variable definition
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
            continue;
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
  
  // Post-process: Detect and group multi-select questions
  // Pattern: Variables like QS3r1, QS3r2, etc. indicate QS3 is a multi-select
  const processedVariables: VariableDefinition[] = [];
  
  // Group variables by base name (e.g., QS3r1, QS3r2 -> base: QS3)
  const multiSelectGroups = new Map<string, VariableDefinition[]>();
  const allSubVars: VariableDefinition[] = [];
  
  // First pass: identify multi-select sub-variables
  variables.forEach(v => {
    // Check if variable name matches pattern: [base]r[number] (e.g., QS3r1, QS3r25)
    const match = v.name.match(/^(.+?)(r\d+)$/i);
    if (match) {
      const baseName = match[1]; // e.g., "QS3"
      
      if (!multiSelectGroups.has(baseName)) {
        multiSelectGroups.set(baseName, []);
      }
      
      // Mark this as a multi-select option
      v.isMultiSelectOption = true;
      v.parentMultiSelect = baseName;
      multiSelectGroups.get(baseName)!.push(v);
      allSubVars.push(v);
      return; // Don't add to processedVariables yet
    }
    
    // Not a multi-select sub-variable, add to processed list
    processedVariables.push(v);
  });
  
  // Second pass: create or update multi-select parent variables
  multiSelectGroups.forEach((subVars, baseName) => {
    // Sort sub-variables by their number (QS3r1, QS3r2, etc.)
    subVars.sort((a, b) => {
      const aMatch = a.name.match(/r(\d+)$/i);
      const bMatch = b.name.match(/r(\d+)$/i);
      const aNum = aMatch ? parseInt(aMatch[1], 10) : 0;
      const bNum = bMatch ? parseInt(bMatch[1], 10) : 0;
      return aNum - bNum;
    });
    
    // Find the parent variable if it exists
    let parentVar = variables.find(v => v.name === baseName);
    
    if (parentVar) {
      // Convert existing variable to multi-select
      parentVar.type = 'multi-select';
      parentVar.codes = {}; // Reset codes, will rebuild from sub-variables
      
      // Build codes from sub-variables
      // Each sub-variable's description becomes a response option
      subVars.forEach((subVar) => {
        // Extract the number from the variable name (e.g., QS3r1 -> 1)
        const numMatch = subVar.name.match(/r(\d+)$/i);
        const optionNumber = numMatch ? numMatch[1] : String(subVars.indexOf(subVar) + 1);
        // Use the sub-variable's description as the response option label
        // This is typically the state name, option text, etc.
        parentVar.codes[optionNumber] = subVar.description || subVar.name.replace(/^.+?r/i, '');
      });
      
      // Replace the regular variable with multi-select version
      const index = processedVariables.findIndex(v => v.name === baseName);
      if (index >= 0) {
        processedVariables[index] = parentVar;
      } else {
        processedVariables.push(parentVar);
      }
    } else {
      // Create new multi-select parent variable
      // Try to find a reasonable description
      // Often the first sub-var has a description that includes the parent question
      // Or we can infer from the pattern
      const firstSubVar = subVars[0];
      let description = baseName;
      
      // Try to extract parent question from first sub-variable description
      if (firstSubVar?.description) {
        // Sometimes description is like "QS3: Which state(s)..." or just the option
        // For now, use the base name - could be improved
        description = `${baseName}: Multi-select question`;
      }
      
      parentVar = {
        name: baseName,
        description: description,
        type: 'multi-select',
        codes: {}
      };
      
      // Build codes from sub-variables
      subVars.forEach((subVar) => {
        const numMatch = subVar.name.match(/r(\d+)$/i);
        const optionNumber = numMatch ? numMatch[1] : String(subVars.indexOf(subVar) + 1);
        // Use the sub-variable's description as the response option label
        parentVar.codes[optionNumber] = subVar.description || subVar.name.replace(/^.+?r/i, '');
      });
      
      processedVariables.push(parentVar);
    }
  });
  
  // Add sub-variables to the list (they're needed for data access, but marked as options)
  // These can be filtered out in the UI if needed
  allSubVars.forEach(subVar => {
    if (!processedVariables.find(v => v.name === subVar.name)) {
      processedVariables.push(subVar);
    }
  });
  
  return processedVariables;
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

