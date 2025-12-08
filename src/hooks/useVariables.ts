import { useState, useCallback, useMemo } from 'react';
import { Variable } from '../utils/tabs/types';
import { getBaseQuestionNumber } from '../utils/tabs/questionHelpers';

interface UseVariablesProps {
  questionnaireQuestions?: any[];
  fullRawData?: { rows: any[] } | null;
  columnMapping?: Record<string, string> | null;
}

export const useVariables = (props?: UseVariablesProps) => {
  const { questionnaireQuestions = [], fullRawData, columnMapping } = props || {};
  
  const [variables, setVariables] = useState<Variable[]>([]);
  const [selectedVariable, setSelectedVariable] = useState<string | null>(null);
  const [variableData, setVariableData] = useState<Record<string, any>>({});
  const [variableFilter, setVariableFilter] = useState('');
  const [questionTypeFilter, setQuestionTypeFilter] = useState<string | null>(null);
  const [showQuestionTypeFilter, setShowQuestionTypeFilter] = useState(false);
  const [customNetsMode, setCustomNetsMode] = useState<Record<string, boolean>>({});

  // Helper function to convert hidden variable names to expected header format
  // Converts "hid_SPECIALTY" to "hSPECIALTY"
  const convertHiddenVariableToExpectedHeader = useCallback((variableName: string): string => {
    if (variableName.toLowerCase().startsWith('hid_')) {
      return 'h' + variableName.substring(4); // Remove "hid_" and add "h"
    }
    return variableName;
  }, []);

  // Get response codes for a variable
  const getResponseCodesForVariable = useCallback((variable: Variable): string[] => {
    if (variable.statements && Object.keys(variable.statements).length > 0) {
      return Object.keys(variable.statements);
    }
    if (variable.codes && Object.keys(variable.codes).length > 0) {
      return Object.keys(variable.codes);
    }
    const baseNumber = getBaseQuestionNumber(variable.name);
    const matchingQuestion = questionnaireQuestions.find(question => {
      const qNum = question.number || question.id;
      if (!qNum) return false;
      const qNumStr = String(qNum);
      const normalizedQuestion = qNumStr.replace(/^Q/i, '');
      const normalizedBase = baseNumber.replace(/^Q/i, '');
      return (
        qNumStr === baseNumber ||
        normalizedQuestion === normalizedBase ||
        `Q${normalizedQuestion}` === baseNumber ||
        `Q${normalizedBase}` === qNumStr
      );
    });
    if (matchingQuestion && Array.isArray(matchingQuestion.responseOptions)) {
      return matchingQuestion.responseOptions.map((opt: any, idx: number) => {
        if (typeof opt === 'string') {
          return opt;
        }
        return opt.code || opt.value || `c${idx + 1}`;
      });
    }
    return [];
  }, [questionnaireQuestions]);

  // Helper function to extract variable data from full raw data
  // Uses columnMapping to find the matched column header, then extracts values from fullRawData
  const getVariableDataFromRawData = useCallback((variableName: string): any => {
    if (!fullRawData || !fullRawData.rows || fullRawData.rows.length === 0 || !columnMapping) {
      return undefined;
    }

    // Convert hidden variables first: "hid_SPECIALTY" -> "hSPECIALTY"
    let processedName = convertHiddenVariableToExpectedHeader(variableName);

    // Convert legacy numeric grid variable names to expected header format
    let lookupName = processedName;
    
    // Only convert if it's NOT already in expected header format
    // Check for formats like: QC1r1 (single select grid), QC1r1c1 (numeric grid), or hPATIENT_COUNT (hidden variable)
    const isAlreadyExpectedFormat = /^[Qh]?[A-Z0-9]+r\d+(c\d+)?$/i.test(processedName) || processedName.toLowerCase().startsWith('h');
    
    if (!isAlreadyExpectedFormat) {
      // Check if this is a legacy numeric grid variable (pattern: {baseNumber}_{number})
      const numericListPattern = /^([A-Z0-9]+)_(\d+)$/i;
      const numericListMatch = processedName.match(numericListPattern);
      if (numericListMatch) {
        const baseNumber = numericListMatch[1];
        const optionNumber = numericListMatch[2];
        // Convert S14B_1 -> QS14Br1c1
        lookupName = `Q${baseNumber}r${optionNumber}c1`;
      } else {
        // Check for _r pattern (e.g., S5_r1, C1_r1)
        const underscoreRPattern = /^([A-Z0-9]+)_r(\d+)$/i;
        const underscoreRMatch = processedName.match(underscoreRPattern);
        if (underscoreRMatch) {
          const baseNumber = underscoreRMatch[1];
          const rowNumber = underscoreRMatch[2];
          // Check if this is a numeric grid or single select grid question
          const question = questionnaireQuestions.find(q => {
            const qNum = q.number || q.id;
            return qNum === baseNumber || qNum === baseNumber.replace(/^Q/, '');
          });
          const isNumericGrid = question?.type?.toLowerCase().includes('numeric grid');
          const isSingleSelectGrid = question?.type?.toLowerCase().includes('single select grid');
          if (isNumericGrid) {
            // Convert S5_r1 -> QS5r1c1 (numeric grids have columns)
            lookupName = `Q${baseNumber}r${rowNumber}c1`;
          } else if (isSingleSelectGrid) {
            // Convert C1_r1 -> QC1r1 (single select grids don't have column suffix)
            lookupName = `Q${baseNumber}r${rowNumber}`;
          }
        }
      }
    }

    // Try to find the expected header in columnMapping (try variations)
    let expectedHeader: string | undefined = undefined;
    
    // Try exact match with converted name first
    if (columnMapping[lookupName]) {
      expectedHeader = lookupName;
    }
    
    // Try exact match with original name
    if (!expectedHeader && columnMapping[variableName]) {
      expectedHeader = variableName;
    }
    
    // Try exact match with processed name (for hidden variables)
    if (!expectedHeader && processedName !== variableName && columnMapping[processedName]) {
      expectedHeader = processedName;
    }
    
    // For single select grids, also try format without underscore (C1r1 instead of C1_r1)
    if (!expectedHeader && processedName.includes('_r')) {
      const withoutUnderscore = processedName.replace('_r', 'r');
      if (columnMapping[withoutUnderscore]) {
        expectedHeader = withoutUnderscore;
      }
    }
    
    // Try with Q prefix (but not for hidden variables - they use "h" prefix)
    if (!expectedHeader && !processedName.toLowerCase().startsWith('h')) {
      const withQ = lookupName.startsWith('Q') ? lookupName : `Q${lookupName}`;
      if (columnMapping[withQ]) {
        expectedHeader = withQ;
      }
    }
    
    // Try without Q prefix
    if (!expectedHeader && lookupName.startsWith('Q')) {
      const withoutQ = lookupName.substring(1);
      if (columnMapping[withoutQ]) {
        expectedHeader = withoutQ;
      }
    }

    // For numeric questions, try with r1 suffix
    if (!expectedHeader) {
      const baseWithR1 = lookupName.endsWith('r1') ? lookupName : `${lookupName}r1`;
      const withQandR1 = baseWithR1.startsWith('Q') ? baseWithR1 : `Q${baseWithR1}`;
      if (columnMapping[withQandR1]) {
        expectedHeader = withQandR1;
      } else if (columnMapping[baseWithR1]) {
        expectedHeader = baseWithR1;
      }

      // Also try without r1 suffix if lookupName already has it
      if (!expectedHeader && lookupName.endsWith('r1')) {
        const withoutR1 = lookupName.slice(0, -2);
        if (columnMapping[withoutR1]) {
          expectedHeader = withoutR1;
        }
        const withQnoR1 = withoutR1.startsWith('Q') ? withoutR1 : `Q${withoutR1}`;
        if (!expectedHeader && columnMapping[withQnoR1]) {
          expectedHeader = withQnoR1;
        }
      }
    }

    // Try case-insensitive lookup
    if (!expectedHeader) {
      const mappingKeys = Object.keys(columnMapping);
      const matchingKey = mappingKeys.find(key => 
        key.toLowerCase() === lookupName.toLowerCase() ||
        (!lookupName.toLowerCase().startsWith('h') && key.toLowerCase() === (lookupName.startsWith('Q') ? lookupName : `Q${lookupName}`).toLowerCase()) ||
        (lookupName.startsWith('Q') && key.toLowerCase() === lookupName.substring(1).toLowerCase())
      );
      if (matchingKey) {
        expectedHeader = matchingKey;
      }
    }
    
    if (!expectedHeader) {
      return undefined;
    }
    
    // Get the matched column header (the actual Excel column name)
    const matchedColumnHeader = columnMapping[expectedHeader];
    if (!matchedColumnHeader) {
      return undefined;
    }
    
    // Extract values from fullRawData rows
    const values: any[] = [];
    fullRawData.rows.forEach((row: any) => {
      if (row.hasOwnProperty(matchedColumnHeader)) {
        const value = row[matchedColumnHeader];
        // Normalize empty values to null
        if (value === null || value === undefined || value === '') {
          values.push(null);
        } else if (typeof value === 'string' && value.trim() === '') {
          values.push(null);
        } else {
          values.push(value);
        }
      } else {
        values.push(null);
      }
    });
    
    // Calculate statistics
    const nonNullValues = values.filter(v => v !== null && v !== undefined);
    const numericValues = nonNullValues.map(v => {
      const num = parseFloat(String(v));
      return isNaN(num) ? null : num;
    }).filter(v => v !== null) as number[];
    
    const allNumeric = numericValues.length === nonNullValues.length && numericValues.length > 0;
    
    // Calculate frequencies for categorical data
    const frequencies: Record<string, number> = {};
    if (!allNumeric) {
      nonNullValues.forEach(val => {
        const valStr = String(val);
        frequencies[valStr] = (frequencies[valStr] || 0) + 1;
      });
    }
    
    // Calculate numeric statistics if applicable
    let mean: number | undefined = undefined;
    let median: number | undefined = undefined;
    let sum: number | undefined = undefined;
    let min: number | undefined = undefined;
    let max: number | undefined = undefined;
    let mode: number | undefined = undefined;
    let stdDev: number | undefined = undefined;
    let meanNoOutliers: number | undefined = undefined;
    let sumNoOutliers: number | undefined = undefined;

    if (allNumeric && numericValues.length > 0) {
      const sorted = [...numericValues].sort((a, b) => a - b);
      sum = numericValues.reduce((a, b) => a + b, 0);
      mean = sum / numericValues.length;
      median = sorted.length % 2 === 0
        ? (sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2
        : sorted[Math.floor(sorted.length / 2)];

      min = sorted[0];
      max = sorted[sorted.length - 1];

      // Mode - most frequent value
      const freqMap: Record<number, number> = {};
      numericValues.forEach(v => {
        freqMap[v] = (freqMap[v] || 0) + 1;
      });
      let maxFreq = 0;
      Object.entries(freqMap).forEach(([val, freq]) => {
        if (freq > maxFreq) {
          maxFreq = freq;
          mode = parseFloat(val);
        }
      });

      // Standard Deviation
      const squaredDiffs = numericValues.map(v => Math.pow(v - mean!, 2));
      const avgSquaredDiff = squaredDiffs.reduce((a, b) => a + b, 0) / numericValues.length;
      stdDev = Math.sqrt(avgSquaredDiff);

      // Mean with outliers removed (using 2 standard deviations method)
      if (stdDev !== undefined && mean !== undefined) {
        const valuesNoOutliers = numericValues.filter(v => Math.abs(v - (mean ?? 0)) <= 2 * (stdDev ?? 0));
        if (valuesNoOutliers.length > 0) {
          sumNoOutliers = valuesNoOutliers.reduce((a, b) => a + b, 0);
          meanNoOutliers = sumNoOutliers / valuesNoOutliers.length;
        } else {
          meanNoOutliers = mean;
          sumNoOutliers = sum;
        }
      } else {
        meanNoOutliers = mean;
        sumNoOutliers = sum;
      }
    }

    return {
      values: values,
      numericValues: numericValues,
      count: values.length,
      numeric: allNumeric,
      frequencies: Object.keys(frequencies).length > 0 ? frequencies : undefined,
      mean: mean,
      median: median,
      sum: sum,
      min: min,
      max: max,
      mode: mode,
      stdDev: stdDev,
      meanNoOutliers: meanNoOutliers,
      sumNoOutliers: sumNoOutliers
    };
  }, [fullRawData, columnMapping, questionnaireQuestions, convertHiddenVariableToExpectedHeader]);

  // Helper function to get variable data using expected header format
  const getVariableDataByExpectedHeader = useCallback((variableName: string): any => {
    return getVariableDataFromRawData(variableName);
  }, [getVariableDataFromRawData]);

  // Convert questions to variables
  const convertQuestionsToVariables = useCallback((questions: any[], dataColumnHeaders: string[]) => {
    const vars: Variable[] = [];
    const processedQuestionNumbers = new Set<string>();
    
    // Extract unique Q# base numbers from column headers in the data
    const baseNumbersInData = new Set<string>();
    
    // Process column headers to extract Q# values
    dataColumnHeaders.forEach(header => {
      if (!header || typeof header !== 'string') return;
      
      const trimmed = header.trim();
      // Check if header starts with Q (case-insensitive)
      if (/^Q/i.test(trimmed)) {
        // Remove Q prefix
        const withoutQ = trimmed.substring(1);
        // Extract base question number using getBaseQuestionNumber logic
        const baseNumber = getBaseQuestionNumber(withoutQ);
        if (baseNumber) {
          // Store in lowercase for case-insensitive matching
          baseNumbersInData.add(baseNumber.toLowerCase());
        }
      }
      // Also check for hidden variables (h prefix, e.g., "hPATIENT_COUNT")
      if (/^h/i.test(trimmed) && !trimmed.toLowerCase().startsWith('hid_')) {
        // This is a hidden variable in expected header format (hPATIENT_COUNT)
        // Store both the original format and the converted format
        const hiddenName = trimmed.substring(1); // Remove 'h' prefix
        baseNumbersInData.add(trimmed.toLowerCase()); // Store as "hpatient_count"
        baseNumbersInData.add(`hid_${hiddenName}`.toLowerCase()); // Also store as "hid_patient_count"
      }
    });
    
    // Process questions in QNR order - only create variables for questions that have data
    questions.forEach(question => {
      const questionNumber = question.number || question.id;
      const questionNumberStr = String(questionNumber);
      
      // Skip if already processed
      if (processedQuestionNumbers.has(questionNumberStr)) {
        return;
      }
      
      let questionType = question.type || '';
      
      // Check if this question has data in the column headers
      const questionNumNormalized = questionNumberStr.toLowerCase().replace(/^q/, '');
      let hasData = baseNumbersInData.has(questionNumNormalized);
      
      // For hidden variables (hid_ prefix), also check the converted format (h prefix)
      if (!hasData && questionNumNormalized.startsWith('hid_')) {
        const convertedName = 'h' + questionNumNormalized.substring(4); // Convert "hid_patient_count" to "hpatient_count"
        hasData = baseNumbersInData.has(convertedName) || baseNumbersInData.has(questionNumNormalized);
      }
      
      // If base number not found, check for grid types that have statement variables
      if (!hasData && question.statementOptions && Array.isArray(question.statementOptions)) {
        const tempQuestionType = question.type || '';
        const isSingleSelectGrid = tempQuestionType.toLowerCase().includes('single select grid');
        const isMultiSelectGrid = tempQuestionType.toLowerCase().includes('multi-select grid');
        
        if (isSingleSelectGrid || isMultiSelectGrid) {
          // Check if any statement variables exist in the data
          hasData = question.statementOptions.some((stmt: any) => {
            const stmtCode = typeof stmt === 'string' 
              ? `r${question.statementOptions.indexOf(stmt) + 1}`
              : (stmt.code || `r${question.statementOptions.indexOf(stmt) + 1}`);
            // Try different variable name formats
            const possibleNames = [
              `${questionNumNormalized}_${stmtCode}`,
              `${questionNumNormalized}${stmtCode}`,
              `q${questionNumNormalized}_${stmtCode}`,
              `q${questionNumNormalized}${stmtCode}`,
            ];
            return possibleNames.some(name => {
              const normalizedName = name.toLowerCase();
              return dataColumnHeaders.some(header => {
                const headerLower = header.toLowerCase();
                return headerLower === normalizedName || 
                       headerLower.startsWith(normalizedName + '_') ||
                       headerLower.startsWith(normalizedName);
              });
            });
          });
        }
      }
      
      // Always create variables for all questions from the QNR, regardless of whether they have data
      // This ensures:
      // 1. The Data tab can show all QNR questions with their expected headers
      // 2. Tab specs can show all questions
      // 3. The Variables tab sidebar will filter based on data existence (handled in VariableListSidebar)
      // The data existence check (hasData) is still calculated for use in the Variables tab sidebar
      // but we don't skip creating variables here

      // Convert numeric lists to numeric grids
      if (questionType.toLowerCase().includes('numeric list')) {
        questionType = 'Numeric grid';
      }

      // Convert Open End with statementOptions to Open End List
      const isOpenEndBase = questionType.toLowerCase() === 'open end' ||
                          (questionType.toLowerCase().includes('open end') && !questionType.toLowerCase().includes('list'));
      const hasStatementOptions = question.statementOptions && Array.isArray(question.statementOptions) && question.statementOptions.length > 0;
      if (isOpenEndBase && hasStatementOptions) {
        questionType = 'Open End List';
      }

      const isNumericGrid = questionType.toLowerCase().includes('numeric grid');
      const isSingleSelectGrid = questionType.toLowerCase().includes('single select grid');
      const isMultiSelectGrid = questionType.toLowerCase().includes('multi-select grid');
      const isGrid = isNumericGrid || isSingleSelectGrid || isMultiSelectGrid;
      const isOpenEndList = questionType.toLowerCase().includes('open end list');
      const hasScaleTag = question.tags && Array.isArray(question.tags) && question.tags.includes('Scale');
      const hasNumberTag = question.tags && Array.isArray(question.tags) && question.tags.includes('Number');
      const hasPercentTag = question.tags && Array.isArray(question.tags) && question.tags.includes('%');
      
      // Convert statementOptions to statements object
      let statements: Record<string, string> | undefined = undefined;
      let codes: Record<string, string> | undefined = undefined;
      
      if (question.statementOptions && Array.isArray(question.statementOptions)) {
        const allStatements = question.statementOptions;
        
        const hasColumnCodes = allStatements.some((stmt: any) => {
          const code = typeof stmt === 'string' ? '' : (stmt.code || '');
          return code && (code.toLowerCase().startsWith('c') || code.match(/^c\d+$/i));
        });
        
        if (isNumericGrid && !question.responseOptions && hasColumnCodes) {
          const rowStatements: any[] = [];
          const colStatements: any[] = [];
          
          allStatements.forEach((stmt: any) => {
            const code = typeof stmt === 'string' ? '' : (stmt.code || '');
            if (code && (code.toLowerCase().startsWith('c') || code.match(/^c\d+$/i))) {
              colStatements.push(stmt);
            } else {
              rowStatements.push(stmt);
            }
          });
          
          if (rowStatements.length > 0) {
            statements = {};
            rowStatements.forEach((stmt: any, idx: number) => {
              const code = typeof stmt === 'string' 
                ? `r${idx + 1}`
                : (stmt.code || `r${idx + 1}`);
              const text = typeof stmt === 'string' ? stmt : stmt.text;
              if (statements) {
                statements[code] = text;
              }
            });
          }
          
          if (colStatements.length > 0) {
            codes = {};
            colStatements.forEach((stmt: any, idx: number) => {
              const code = typeof stmt === 'string' 
                ? `c${idx + 1}`
                : (stmt.code || `c${idx + 1}`);
              const text = typeof stmt === 'string' ? stmt : stmt.text;
              if (codes) {
                codes[code] = text;
              }
            });
          }
        } else {
          statements = {};
          allStatements.forEach((stmt: any, idx: number) => {
            const code = typeof stmt === 'string' 
              ? `r${idx + 1}`
              : (stmt.code || `r${idx + 1}`);
            const text = typeof stmt === 'string' ? stmt : stmt.text;
            if (statements) {
              statements[code] = text;
            }
          });
        }
      }
      
      // Convert responseOptions to codes object
      if (!codes && question.responseOptions && Array.isArray(question.responseOptions)) {
        codes = {};
        question.responseOptions.forEach((resp: any, idx: number) => {
          const code = typeof resp === 'string' ? `c${idx + 1}` : (resp.code || `c${idx + 1}`);
          let text = typeof resp === 'string' ? resp : resp.text;
          // Clean text: remove leading numeric codes and tabs
          if (text && typeof text === 'string') {
            text = text.replace(/^\d+[\t\s]+/, '').trim();
          }
          if (codes) {
            codes[code] = text;
          }
        });
      } else if (!codes && question.options && Array.isArray(question.options)) {
        // For numeric grids, convert options to responseOptions (columns) if needed
        codes = {};
        question.options.forEach((opt: any, idx: number) => {
          const code = typeof opt === 'string' ? `c${idx + 1}` : (opt.code || `c${idx + 1}`);
          let text = typeof opt === 'string' ? opt : opt.text;
          if (text && typeof text === 'string') {
            text = text.replace(/^\d+[\t\s]+/, '').trim();
          }
          if (codes) {
            codes[code] = text;
          }
        });
      }
      
      // For numeric grids without responseOptions, create a default column
      if (isNumericGrid && !codes && statements) {
        codes = {};
        const columnLabel = hasPercentTag ? '%' : (hasNumberTag ? '#' : '#');
        codes['c1'] = columnLabel;
      }
      
      // Create variable name - use the base question number
      const variableName = questionNumberStr;
      
      // Create variable description from question text
      const description = question.text || question.question || question.description || questionNumberStr;
      
      // Create the variable
      const variable: Variable = {
        name: variableName,
        description: description,
        type: questionType,
        codes: codes,
        statements: statements,
        tags: question.tags || []
      };
      
      vars.push(variable);
      processedQuestionNumbers.add(questionNumberStr);
    });
    
    setVariables(vars);
  }, []);

  // Filter variables based on filter and question type
  const filteredVariables = useMemo(() => {
    let filtered = [...variables];
    if (variableFilter) {
      const filter = variableFilter.toLowerCase();
      filtered = filtered.filter(v => 
        v.name.toLowerCase().includes(filter) ||
        (v.description && v.description.toLowerCase().includes(filter))
      );
    }
    if (questionTypeFilter) {
      filtered = filtered.filter(v => v.type === questionTypeFilter);
    }
    return filtered;
  }, [variables, variableFilter, questionTypeFilter]);

  return {
    variables,
    selectedVariable,
    variableData,
    variableFilter,
    questionTypeFilter,
    showQuestionTypeFilter,
    customNetsMode,
    filteredVariables,
    getResponseCodesForVariable,
    getVariableDataFromRawData,
    getVariableDataByExpectedHeader,
    convertQuestionsToVariables,
    convertHiddenVariableToExpectedHeader,
    setVariables,
    setSelectedVariable,
    setVariableData,
    setVariableFilter,
    setQuestionTypeFilter,
    setShowQuestionTypeFilter,
    setCustomNetsMode,
  };
};

