import XLSX from 'xlsx';

/**
 * Conjoint Data Preprocessing Service
 * 
 * Automatically identifies and categorizes all relevant columns in conjoint survey data
 * using deterministic regex patterns instead of AI inference.
 */

/**
 * Normalize column names for consistent matching
 */
function normalizeKey(key) {
  return String(key || '').trim().toLowerCase().replace(/[^a-z0-9]/g, '');
}

/**
 * Extract product names from Datamap sheet
 * @param {Object} workbook - XLSX workbook object
 * @returns {Map} Map of rowNumber -> productName
 */
export function extractProductNamesFromDatamap(workbook) {
  const productNameMap = new Map();
  
  try {
    // Find Datamap sheet
    const datamapSheetName = workbook.SheetNames.find(name =>
      name.toLowerCase() === 'datamap' || 
      name.toLowerCase() === 'data map' ||
      name.toLowerCase().includes('datamap')
    );

    if (!datamapSheetName) {
      console.warn('No Datamap sheet found in workbook');
      return productNameMap;
    }

    const datamapSheet = workbook.Sheets[datamapSheetName];
    const datamapRows = XLSX.utils.sheet_to_json(datamapSheet, { defval: '', raw: false });

    console.log(`[Preprocessor] Processing ${datamapRows.length} rows from Datamap sheet`);

    // Process each row in Datamap
    datamapRows.forEach((row, index) => {
      // Try different possible column names for column name and label
      const colName = String(
        row['Column Name'] || 
        row['column name'] || 
        row['ColumnName'] || 
        row['Variable'] || 
        row['[record]: Record number'] ||
        ''
      ).trim();

      const label = String(
        row['Label'] || 
        row['label'] || 
        row['Question Text'] || 
        row['Text'] || 
        row['Unnamed: 1'] ||
        ''
      ).trim();

      // Debug logging for QC2 entries
      if (colName && colName.includes('QC2') && index < 10) {
        console.log(`[Preprocessor] Debug QC2 row ${index}:`, { colName, label });
      }

      if (colName && colName !== 'NaN') {
        // Match pattern QC2_*r{rowNum}c1 to extract row number and label
        const match = colName.match(/^QC2_\d+r(\d+)c1$/i);
        if (match) {
          const rowNum = parseInt(match[1]);
          if (!productNameMap.has(rowNum)) {
            productNameMap.set(rowNum, label || colName);
            console.log(`[Preprocessor] Found product ${rowNum}: ${label || colName}`);
          }
        }
        
        // Also try pattern QC2_{taskNum}c1 for alternative format
        const altMatch = colName.match(/^QC2_(\d+)c1:/i);
        if (altMatch) {
          const taskNum = parseInt(altMatch[1]);
          console.log(`[Preprocessor] Found QC2_${taskNum}c1 pattern`);
          
          // Extract product name from the question text
          // Look for patterns like "Original - Consider your PFO closure patients..."
          let productName = `Product ${taskNum}`;
          
          // Try to extract from colName first (since label might be empty)
          const textToSearch = label || colName;
          
          if (textToSearch) {
            // Try different patterns to extract product name
            const patterns = [
              /Original - Consider your (.+?) patients/i,
              /Consider your (.+?) patients/i,
              /your (.+?) patients/i,
              /(.+?) patients/i
            ];
            
            for (const pattern of patterns) {
              const match = textToSearch.match(pattern);
              if (match && match[1]) {
                productName = match[1].trim();
                break;
              }
            }
          }
          
          // Map task numbers to row numbers (this is a heuristic)
          const rowNum = taskNum; // Assuming task number corresponds to row number
          if (!productNameMap.has(rowNum)) {
            productNameMap.set(rowNum, productName);
            console.log(`[Preprocessor] Found product ${rowNum}: ${productName}`);
          }
        }
      }
    });

    console.log(`[Preprocessor] Extracted ${productNameMap.size} product names from Datamap`);
    
  } catch (error) {
    console.warn('[Preprocessor] Error parsing Datamap sheet:', error.message);
  }

  return productNameMap;
}

/**
 * Categorize columns using regex patterns
 * @param {Array} columns - Array of column names
 * @returns {Object} Categorized columns
 */
export function categorizeColumns(columns) {
  const categorized = {
    choiceColumns: [],
    versionColumn: null,
    marketShareColumns: [],
    attributeColumns: [],
    otherColumns: []
  };

  columns.forEach(col => {
    if (/^QC1_\d+$/i.test(col) || /^QS3r\d+$/i.test(col)) {
      categorized.choiceColumns.push(col);
    } else if (normalizeKey(col) === 'qc1version') {
      categorized.versionColumn = col;
    } else if (/^QC2_\d+r\d+c\d+$/i.test(col) || /^QS[45]r\d+c\d+$/i.test(col)) {
      categorized.marketShareColumns.push(col);
    } else if (/^hATTR_/i.test(col)) {
      categorized.attributeColumns.push(col);
    } else {
      categorized.otherColumns.push(col);
    }
  });

  // Sort choice columns numerically
  categorized.choiceColumns.sort((a, b) => {
    let numA, numB;
    
    // Handle QC1_* pattern
    const qc1MatchA = a.match(/QC1_(\d+)/i);
    const qc1MatchB = b.match(/QC1_(\d+)/i);
    
    // Handle QS3r* pattern
    const qs3MatchA = a.match(/QS3r(\d+)/i);
    const qs3MatchB = b.match(/QS3r(\d+)/i);
    
    if (qc1MatchA) numA = parseInt(qc1MatchA[1]);
    else if (qs3MatchA) numA = parseInt(qs3MatchA[1]);
    else numA = 0;
    
    if (qc1MatchB) numB = parseInt(qc1MatchB[1]);
    else if (qs3MatchB) numB = parseInt(qs3MatchB[1]);
    else numB = 0;
    
    return numA - numB;
  });

  return categorized;
}

/**
 * Group market share columns by scenario
 * @param {Array} marketShareColumns - Array of QC2 column names
 * @param {Map} productNameMap - Map of rowNumber -> productName
 * @returns {Object} Grouped by scenario
 */
export function groupMarketShareByScenario(marketShareColumns, productNameMap) {
  const scenarios = {
    original: {}, // c1 columns
    withNewOptions: {} // c2 columns
  };

  marketShareColumns.forEach(col => {
    // Handle QC2_* pattern (original format)
    let match = col.match(/^QC2_(\d+)r(\d+)c(\d+)$/i);
    let taskNum, rowNum, scenarioNum;
    
    if (match) {
      [, taskNum, rowNum, scenarioNum] = match;
    } else {
      // Handle QS4* and QS5* patterns (new format)
      const qs4Match = col.match(/^QS4r(\d+)c(\d+)$/i);
      const qs5Match = col.match(/^QS5r(\d+)c(\d+)$/i);
      
      if (qs4Match) {
        // QS4* = original scenario (c1)
        [, rowNum, scenarioNum] = qs4Match;
        taskNum = '1'; // Default task for QS4
        scenarioNum = '1'; // Force to scenario 1 (original)
      } else if (qs5Match) {
        // QS5* = with new options scenario (c2)
        [, rowNum, scenarioNum] = qs5Match;
        taskNum = '1'; // Default task for QS5
        scenarioNum = '2'; // Force to scenario 2 (with new options)
      } else {
        return; // Skip if no pattern matches
      }
    }

    const task = parseInt(taskNum);
    const row = parseInt(rowNum);
    const scenario = parseInt(scenarioNum);

    const productName = productNameMap.get(row) || `Product ${row}`;
    
    if (scenario === 1) {
      // Original scenario
      if (!scenarios.original[task]) {
        scenarios.original[task] = {};
      }
      scenarios.original[task][row] = {
        columnName: col,
        productName: productName,
        rowNumber: row
      };
    } else if (scenario === 2) {
      // With New Options scenario
      if (!scenarios.withNewOptions[task]) {
        scenarios.withNewOptions[task] = {};
      }
      scenarios.withNewOptions[task][row] = {
        columnName: col,
        productName: productName,
        rowNumber: row
      };
    }
  });

  return scenarios;
}

/**
 * Clean and validate survey data
 * @param {Array} surveyRows - Raw survey data rows
 * @param {Object} categorized - Categorized columns
 * @returns {Object} Cleaned data and validation results
 */
export function cleanAndValidateData(surveyRows, categorized) {
  const validation = {
    isValid: true,
    warnings: [],
    errors: []
  };

  if (!surveyRows || surveyRows.length === 0) {
    validation.isValid = false;
    validation.errors.push('No survey data found');
    return { surveyRows: [], validation };
  }

  // Check for required columns
  if (categorized.choiceColumns.length === 0) {
    validation.isValid = false;
    validation.errors.push('No choice columns (QC1_*) found');
  }

  if (!categorized.versionColumn) {
    validation.warnings.push('No version column (QC1_Version) found');
  }

  if (categorized.marketShareColumns.length === 0) {
    validation.warnings.push('No market share columns (QC2_*) found');
  }

  // Validate choice column values
  categorized.choiceColumns.forEach(col => {
    const uniqueValues = new Set();
    surveyRows.forEach(row => {
      const value = row[col];
      if (value !== null && value !== undefined && value !== '') {
        uniqueValues.add(String(value));
      }
    });
    
    if (uniqueValues.size === 0) {
      validation.warnings.push(`Choice column ${col} has no valid responses`);
    }
  });

  // Filter out rows with no conjoint data
  const cleanedRows = surveyRows.filter(row => {
    // Keep row if it has at least one choice response
    return categorized.choiceColumns.some(col => {
      const value = row[col];
      return value !== null && value !== undefined && value !== '';
    });
  });

  if (cleanedRows.length < surveyRows.length) {
    validation.warnings.push(`Filtered out ${surveyRows.length - cleanedRows.length} rows with no conjoint responses`);
  }

  return { surveyRows: cleanedRows, validation };
}

/**
 * Main preprocessing function
 * @param {Object} workbook - XLSX workbook object
 * @param {string} firstSheetName - Name of the first sheet
 * @param {Object} options - Optional parameters
 * @param {boolean} options.skipProductExtraction - Skip extracting products from Datamap (use predefined products instead)
 * @returns {Object} Complete preprocessing results
 */
export function preprocessConjointData(workbook, firstSheetName, options = {}) {
  console.log('[Preprocessor] Starting conjoint data preprocessing...');

  // Get survey data
  const surveySheet = workbook.Sheets[firstSheetName];
  if (!surveySheet) {
    throw new Error('Unable to read the first sheet in the workbook');
  }

  const surveyRows = XLSX.utils.sheet_to_json(surveySheet, { defval: '', raw: false });
  if (!surveyRows.length) {
    throw new Error('The survey export appears to be empty');
  }

  // Extract columns
  const columns = Object.keys(surveyRows[0] || {});
  console.log(`[Preprocessor] Found ${columns.length} total columns`);

  // Categorize columns
  const categorized = categorizeColumns(columns);
  console.log(`[Preprocessor] Categorized columns:`, {
    choice: categorized.choiceColumns.length,
    marketShare: categorized.marketShareColumns.length,
    attributes: categorized.attributeColumns.length,
    version: categorized.versionColumn ? 1 : 0
  });

  // Extract product names from Datamap (unless skipped)
  let productNameMap = new Map();
  if (!options.skipProductExtraction) {
    productNameMap = extractProductNamesFromDatamap(workbook);
  } else {
    console.log('[Preprocessor] Skipping product extraction from Datamap - using predefined products');
  }

  // Group market share columns by scenario
  const marketShareScenarios = groupMarketShareByScenario(
    categorized.marketShareColumns, 
    productNameMap
  );

  // Clean and validate data
  const { surveyRows: cleanedRows, validation } = cleanAndValidateData(surveyRows, categorized);

  // Build summary
  const summary = {
    totalRows: surveyRows.length,
    cleanedRows: cleanedRows.length,
    totalColumns: columns.length,
    relevantColumns: {
      choice: categorized.choiceColumns.length,
      marketShare: categorized.marketShareColumns.length,
      attributes: categorized.attributeColumns.length,
      version: categorized.versionColumn ? 1 : 0
    },
    marketShareScenarios: {
      original: Object.keys(marketShareScenarios.original).length,
      withNewOptions: Object.keys(marketShareScenarios.withNewOptions).length
    },
    products: Array.from(productNameMap.entries()).map(([row, name]) => ({
      rowNumber: row,
      name: name
    }))
  };

  console.log('[Preprocessor] Preprocessing complete:', summary);

  return {
    surveyRows: cleanedRows,
    categorized,
    productNameMap,
    marketShareScenarios,
    validation,
    summary
  };
}

/**
 * Get detailed column information for frontend display
 * @param {Object} preprocessingResult - Result from preprocessConjointData
 * @returns {Object} Detailed column breakdown
 */
export function getDetailedColumnBreakdown(preprocessingResult) {
  const { categorized, marketShareScenarios, productNameMap } = preprocessingResult;

  const breakdown = {
    choiceColumns: categorized.choiceColumns.map(col => {
      let taskNumber = 'unknown';
      const qc1Match = col.match(/QC1_(\d+)/i);
      const qs3Match = col.match(/QS3r(\d+)/i);
      
      if (qc1Match) taskNumber = qc1Match[1];
      else if (qs3Match) taskNumber = qs3Match[1];
      
      return {
        columnName: col,
        description: `Choice for conjoint task ${taskNumber}`,
        type: 'choice'
      };
    }),
    versionColumn: categorized.versionColumn ? [{
      columnName: categorized.versionColumn,
      description: 'Design version for conjoint tasks',
      type: 'version'
    }] : [],
    attributeColumns: categorized.attributeColumns.map(col => ({
      columnName: col,
      description: 'Holdout attribute for conjoint tasks',
      type: 'attribute'
    })),
    marketShareScenarios: {
      original: [],
      withNewOptions: []
    }
  };

  // Add market share columns by scenario
  Object.entries(marketShareScenarios.original).forEach(([task, products]) => {
    Object.values(products).forEach(product => {
      breakdown.marketShareScenarios.original.push({
        columnName: product.columnName,
        description: `Current market share for ${product.productName} (Task ${task})`,
        type: 'market share',
        scenario: 'original',
        productName: product.productName,
        taskNumber: parseInt(task)
      });
    });
  });

  Object.entries(marketShareScenarios.withNewOptions).forEach(([task, products]) => {
    Object.values(products).forEach(product => {
      breakdown.marketShareScenarios.withNewOptions.push({
        columnName: product.columnName,
        description: `Projected market share for ${product.productName} (Task ${task})`,
        type: 'market share',
        scenario: 'withNewOptions',
        productName: product.productName,
        taskNumber: parseInt(task)
      });
    });
  });

  return breakdown;
}
