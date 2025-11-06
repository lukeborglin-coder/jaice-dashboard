import * as XLSX from 'xlsx';

export interface VariableDefinition {
  name: string;
  description: string;
  type: 'categorical' | 'open-numeric' | 'open-text' | 'multi-select' | 'grid' | 'grid-numeric' | 'grid-verbatim' | 'grid-single-select' | 'grid-multi-select';
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
        // Check for "0-1" but make sure it's not part of a larger range like "0-100"
        const valuesMatch = nextFirstCell.match(/Values:\s*(\d+)(?:\s*-\s*(\d+))?/i);
        const isZeroToOne = valuesMatch && valuesMatch[1] === '0' && valuesMatch[2] === '1';
        
        if (isZeroToOne) {
          // Check if this is a multi-select question or multi-select grid
          // Look further ahead to see if there are statements (indicates grid)
          let isGrid = false;
          if (i + 2 < data.length) {
            const secondNextRow = data[i + 2] as string[];
            const secondNextFirstCell = secondNextRow && secondNextRow[0] ? secondNextRow[0].toString().trim() : '';
            // Check if next rows have statement references like [QSXr1]
            if (secondNextFirstCell.includes('[') || (secondNextRow && secondNextRow[1] && String(secondNextRow[1]).match(/^\[.+\]$/))) {
              isGrid = true;
            }
          }
          
          if (isGrid) {
            // Multi-select grid - has statements and response codes, but values are 0-1
            currentVar = {
              name: varName,
              description: description,
              type: 'grid-multi-select',
              codes: {}, // Will be populated with response options
              statements: {} // Will be populated with grid statements
            };
            collectingCodes = true; // First collect the response codes
          } else {
            // This is a regular multi-select question (Values: 0-1 = Unchecked/Checked)
            currentVar = {
              name: varName,
              description: description,
              type: 'multi-select',
              codes: {} // Will be populated from sub-variables
            };
            collectingCodes = false;
            collectingMultiSelectOptions = true;
            multiSelectOptions = [];
          }
          collectingGridStatements = false;
          gridStatements = [];
          continue;
        } else {
          // This is a grid question (Values: 1-X where X > 1, or other range)
          // Could be single-select grid (has statements AND response codes) or numeric grid (has statements but NO response codes)
          // Check if it's a numeric range (e.g., 0-100, 0-10, or any range > 10)
          const valuesMatch = nextFirstCell.match(/Values:\s*(\d+)(?:\s*-\s*(\d+))?/i);
          let isNumericRange = false;
          
          if (valuesMatch) {
            const startValue = parseInt(valuesMatch[1]);
            const endValue = valuesMatch[2] ? parseInt(valuesMatch[2]) : startValue;
            // If the range is large (e.g., 0-100) or starts at 0, it's likely a numeric range, not response codes
            if (startValue === 0 || (endValue - startValue) > 10) {
              isNumericRange = true;
            }
          }
          
          if (isNumericRange) {
            // Numeric grid - has statements but no response codes, values are numeric
            currentVar = {
              name: varName,
              description: description,
              type: 'grid-numeric',
              codes: {}, // No response codes for numeric grids
              statements: {} // Will be populated with grid statements
            };
            collectingCodes = false; // Don't collect codes for numeric grids
            collectingGridStatements = true; // Start collecting statements directly
          } else {
            // Single-select grid - has statements AND response codes
            currentVar = {
              name: varName,
              description: description,
              type: 'grid', // Will be refined in post-processing based on whether codes are found
              codes: {}, // Will be populated with response options (1-3, etc.) if it's a single-select grid
              statements: {} // Will be populated with grid statements
            };
            collectingCodes = true; // First collect the response codes
          }
          collectingGridStatements = false;
          gridStatements = [];
          continue;
        }
      } else {
        // Could be a grid with open-ended responses (numeric or verbatim)
        // Check if next rows indicate it's a grid (has statements)
        // For now, create as grid type - will be refined when we see statements or "Open numeric/text"
        currentVar = {
          name: varName,
          description: description,
          type: 'grid', // Will be refined to grid-numeric or grid-verbatim based on response type
          codes: {},
          statements: {}
        };
        collectingCodes = false;
        collectingMultiSelectOptions = false;
        collectingGridStatements = false;
        gridStatements = [];
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
        // Extract the value range from "Values: X-Y" or "Values: X"
        const valuesMatch = firstCell.match(/Values:\s*(\d+)(?:\s*-\s*(\d+))?/i);
        let isNumericRange = false;
        
        if (valuesMatch) {
          const startValue = parseInt(valuesMatch[1]);
          const endValue = valuesMatch[2] ? parseInt(valuesMatch[2]) : startValue;
          // If the range is large (e.g., 0-100) or starts at 0, it's likely a numeric range, not response codes
          // Response codes are typically small ranges like 1-4, 1-5, etc.
          // Numeric ranges are typically 0-100, 0-10, etc. or any range > 10
          if (startValue === 0 || (endValue - startValue) > 10) {
            isNumericRange = true;
          }
        }
        
        // For grid questions with numeric ranges, set to grid-numeric
        if ((currentVar.type === 'grid' || currentVar.type === 'grid-single-select') && isNumericRange) {
          currentVar.type = 'grid-numeric';
          collectingCodes = false; // Don't collect codes for numeric grids
          collectingGridStatements = true; // Start collecting statements for numeric grids
          continue;
        }
        
        // Skip "Values:" rows for grid questions - we've already set the type
        // But don't skip if we're already collecting statements (for numeric/verbatim grids)
        if ((currentVar.type === 'grid' || currentVar.type === 'grid-single-select' || 
            currentVar.type === 'grid-multi-select' || currentVar.type === 'grid-numeric' || 
            currentVar.type === 'grid-verbatim') && !collectingGridStatements) {
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

        // For numeric ranges, don't treat as categorical with codes
        if (isNumericRange && currentVar.type === 'grid') {
          currentVar.type = 'grid-numeric';
          collectingCodes = false;
        } else {
          currentVar.type = 'categorical';
          collectingCodes = true; // Start collecting codes after "Values:"
        }
      } else if (firstCell.includes('Open numeric')) {
        // Check if this is a grid with open numeric responses (numeric grid)
        if (currentVar.type === 'grid' && currentVar.statements && Object.keys(currentVar.statements).length > 0) {
          currentVar.type = 'grid-numeric';
        } else {
          currentVar.type = 'open-numeric';
        }
        collectingCodes = false; // Stop collecting codes
      } else if (firstCell.includes('Open text')) {
        // Check if this is a grid with open text responses (verbatim grid)
        if (currentVar.type === 'grid' && currentVar.statements && Object.keys(currentVar.statements).length > 0) {
          currentVar.type = 'grid-verbatim';
        } else {
          currentVar.type = 'open-text';
        }
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
      if (currentVar && (currentVar.type === 'grid' || currentVar.type === 'grid-single-select' || 
                         currentVar.type === 'grid-multi-select' || currentVar.type === 'grid-numeric' || 
                         currentVar.type === 'grid-verbatim')) {
        // For numeric and verbatim grids, skip code collection and go straight to statements
        if ((currentVar.type === 'grid-numeric' || currentVar.type === 'grid-verbatim') && !collectingGridStatements) {
          // Start collecting statements directly for numeric/verbatim grids
          // Look for statement references like [QA1r1c1]
          if (!firstCell && secondCell && secondCell.match(/^\[.+\]$/)) {
            collectingGridStatements = true;
            const subVarMatch = secondCell.match(/\[([^\]]+)\]/);
            if (subVarMatch && thirdCell) {
              const statementCode = subVarMatch[1];
              gridStatements.push({
                name: statementCode,
                description: thirdCell
              });
            }
            continue;
          }
        }
        
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
  
  // Post-process: Refine grid question types based on their structure
  variables.forEach(v => {
    // Skip if already correctly classified as grid-numeric or grid-multi-select
    if (v.type === 'grid-numeric' || v.type === 'grid-multi-select') {
      // Verify grid-numeric is correct (has statements, no codes)
      if (v.type === 'grid-numeric') {
        const hasStatements = v.statements && Object.keys(v.statements).length > 0;
        const hasResponseCodes = v.codes && Object.keys(v.codes).length > 0;
        // If it somehow has codes, it shouldn't be numeric grid
        if (hasResponseCodes) {
          // This shouldn't happen, but if it does, it might be misclassified
          console.warn(`Warning: ${v.name} is marked as grid-numeric but has response codes. Reclassifying...`);
          v.type = 'grid-single-select';
        }
      }
      // Verify grid-multi-select is correct (should only be set for Values: 0-1)
      if (v.type === 'grid-multi-select') {
        const hasStatements = v.statements && Object.keys(v.statements).length > 0;
        const hasResponseCodes = v.codes && Object.keys(v.codes).length > 0;
        // Multi-select grids should have both statements and codes
        // If it has statements but no codes, it's actually a numeric grid
        if (hasStatements && !hasResponseCodes) {
          console.warn(`Warning: ${v.name} is marked as grid-multi-select but has no response codes. Reclassifying as grid-numeric.`);
          v.type = 'grid-numeric';
        }
      }
      return;
    }
    
    if (v.type === 'grid' || v.type === 'grid-single-select') {
      const hasStatements = v.statements && Object.keys(v.statements).length > 0;
      const hasResponseCodes = v.codes && Object.keys(v.codes).length > 0;
      
      if (hasStatements && !hasResponseCodes) {
        // Numeric or Verbatim Grid - has statements but no response codes
        // Will be refined later when we have access to data to distinguish numeric vs verbatim
        v.type = 'grid-numeric';
      } else if (hasStatements && hasResponseCodes) {
        // Has both statements AND response codes - this is a single-select or multi-select grid
        // Multi-select grids are detected earlier by checking for "Values: 0-1"
        // If we got here and it's not already set to grid-multi-select, it's single-select
        if (v.type !== 'grid-multi-select') {
          v.type = 'grid-single-select';
        }
      } else if (!hasStatements && hasResponseCodes) {
        // Has response codes but no statements - this shouldn't be a grid, but keep it as single-select for now
        // This case shouldn't normally happen
        v.type = 'grid-single-select';
      }
    }
  });
  
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
        let label = subVar.description;
        
        // If description is missing or looks like just a number, try to extract from name
        if (!label || label.trim() === '' || /^\d+$/.test(label.trim())) {
          // Try to extract meaningful label from the name pattern
          // For now, use the option number as fallback, but log a warning
          console.warn(`[Multi-select ${baseName}] Sub-variable ${subVar.name} has no valid description. Using number as fallback.`);
          label = optionNumber;
        }
        
        parentVar.codes[optionNumber] = label;
      });
      
      // Debug logging for multi-select codes
      console.log(`[Multi-select ${baseName}] Built codes:`, parentVar.codes);
      
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
        let label = subVar.description;
        
        // If description is missing or looks like just a number, try to extract from name
        if (!label || label.trim() === '' || /^\d+$/.test(label.trim())) {
          // Try to extract meaningful label from the name pattern
          // For now, use the option number as fallback, but log a warning
          console.warn(`[Multi-select ${baseName}] Sub-variable ${subVar.name} has no valid description. Using number as fallback.`);
          label = optionNumber;
        }
        
        parentVar.codes[optionNumber] = label;
      });
      
      // Debug logging for multi-select codes
      console.log(`[Multi-select ${baseName}] Built codes:`, parentVar.codes);
      
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
        
        // Refine grid types based on actual data values
        if (dataJson.length > 0) {
          const firstRow = dataJson[0];
          variables.forEach(v => {
            if (v.type === 'grid-numeric') {
              // Check if values are numeric or text to determine numeric vs verbatim
              const prefix = `${v.name} - `;
              const matchingColumns = Object.keys(firstRow).filter(colName => 
                colName.startsWith(prefix) || colName === v.name
              );
              
              if (matchingColumns.length > 0) {
                // Sample a few values to determine type
                let numericCount = 0;
                let textCount = 0;
                let sampled = 0;
                
                for (const colName of matchingColumns.slice(0, 10)) { // Sample first 10 columns
                  const value = firstRow[colName];
                  if (value !== null && value !== undefined && value !== '') {
                    sampled++;
                    if (typeof value === 'number' || (typeof value === 'string' && !isNaN(parseFloat(value)) && isFinite(parseFloat(value)))) {
                      numericCount++;
                    } else {
                      textCount++;
                    }
                  }
                }
                
                // If we find text values, it's a verbatim grid
                if (sampled > 0 && textCount > numericCount) {
                  v.type = 'grid-verbatim';
                }
              }
            } else if (v.type === 'grid-single-select') {
              // Check if a grid-single-select actually has numeric data (should be grid-numeric)
              // This can happen if response codes are defined in datamap but data values are numeric
              const prefix = `${v.name} - `;
              const matchingColumns = Object.keys(firstRow).filter(colName => 
                colName.startsWith(prefix) || colName === v.name
              );
              
              if (matchingColumns.length > 0 && v.codes && Object.keys(v.codes).length > 0) {
                // Sample values from multiple columns and rows to check if they match response codes
                let numericValueCount = 0;
                let codeMatchCount = 0;
                let sampled = 0;
                
                // Get all response code values (normalized)
                const responseCodes = new Set(Object.keys(v.codes));
                const responseCodeLabels = new Set(Object.values(v.codes).map(l => String(l).trim().toLowerCase()));
                
                // Sample from multiple columns and rows
                for (const colName of matchingColumns.slice(0, 5)) { // Sample first 5 columns
                  for (let rowIdx = 0; rowIdx < Math.min(10, dataJson.length); rowIdx++) {
                    const value = dataJson[rowIdx][colName];
                    if (value !== null && value !== undefined && value !== '') {
                      sampled++;
                      const valueStr = String(value);
                      const valueNum = typeof value === 'number' ? value : parseFloat(valueStr);
                      
                      // Check if value is numeric
                      if (typeof value === 'number' || (!isNaN(valueNum) && isFinite(valueNum))) {
                        // Check if it matches a response code
                        if (responseCodes.has(valueStr) || (Number.isInteger(valueNum) && valueNum >= 1 && valueNum <= responseCodes.size)) {
                          // Small integer that could be a code - check if it matches
                          codeMatchCount++;
                        } else {
                          // Large number or decimal - likely numeric grid
                          numericValueCount++;
                        }
                      } else {
                        // Text value - check if it matches a code label
                        const normalizedValue = valueStr.trim().toLowerCase();
                        if (responseCodeLabels.has(normalizedValue)) {
                          codeMatchCount++;
                        } else {
                          // Text that doesn't match codes - count as numeric grid indicator
                          numericValueCount++;
                        }
                      }
                    }
                  }
                }
                
                // If most values are numeric and don't match response codes, it's likely a numeric grid
                if (sampled > 0 && numericValueCount > codeMatchCount * 2) {
                  // Reclassify as numeric grid
                  v.type = 'grid-numeric';
                  console.log(`Reclassified ${v.name} from grid-single-select to grid-numeric based on data values (${numericValueCount} numeric vs ${codeMatchCount} code matches)`);
                }
              }
            }
          });
        }
        
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
  if (!varDef) {
    return String(codeValue);
  }
  
  // Handle categorical, multi-select, and grid types (all have codes)
  if (varDef.type === 'categorical' || varDef.type === 'multi-select' || 
      varDef.type === 'grid' || varDef.type === 'grid-single-select' || 
      varDef.type === 'grid-multi-select') {
    const codeStr = String(codeValue);
    return varDef.codes[codeStr] || codeStr;
  }
  
  return String(codeValue);
}

