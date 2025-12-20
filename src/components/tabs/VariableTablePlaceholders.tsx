import React from 'react';
import { Variable, VariableStatsSelection } from '../../utils/tabs/types';
import { TableOption } from '../../utils/tabs/tableOptions';
import { getBaseQuestionNumber } from '../../utils/tabs/questionHelpers';
import { countRespondentsWithData, countCheckedForItemColumn, getMultiSelectResponseCounts } from '../../utils/tabs/chartHelpers';
import { buildNumericGridSummaryModel, type NumericGridSummaryType } from '../../utils/tabs/gridNumericSummary';
const BRAND_ORANGE = '#D14A2D';
interface VariableTablePlaceholdersProps {
  variable: Variable | null;
  tableOptions: TableOption[];
  statsSelections?: VariableStatsSelection;
  summaryTableSortSelections?: Record<string, Set<string>>;
  summarySortDefaultsToOn?: boolean;
  variableTableSelections?: Record<string, Set<string>>;
  variableSortByFrequency?: Record<string, boolean>;
  variableHoldResponseCodes?: Record<string, string[]>;
  netSummaryTableSelectedCodes?: Record<string, Array<{ name: string; codes: string[] }>>;
  getVariableDataByExpectedHeader?: (expectedHeader: string) => any;
  fullRawData?: any;
  columnMapping?: Record<string, string>;
  questionnaireQuestions?: any[];
  disableMappingIndicators?: boolean;
  columnHeaderOverrides?: Record<string, string>;
  onTablesNoData?: (variableName: string, noData: boolean) => void;
}
// Define which stats apply to which table types
const getStatsForTableType = (tableType: 'individual' | 'summary' | 'net', variable: Variable | null): Array<{ key: keyof VariableStatsSelection; label: string }> => {
  if (!variable) return [];
  
  const typeLower = variable.type?.toLowerCase() || '';
  const isNumericQuestion = typeLower.includes('numeric') && !typeLower.includes('grid') && !typeLower.includes('list');
  const isNumericGrid = typeLower.includes('numeric grid');
  const isSingleSelectGrid = typeLower.includes('single select grid');
  const isSingleSelect = typeLower.includes('single select') && !typeLower.includes('grid');
  
  // All available stats
  const allStats: Array<{ key: keyof VariableStatsSelection; label: string }> = [
    { key: 'mean', label: 'Mean' },
    { key: 'meanNoOutliers', label: 'Mean (outliers removed)' },
    { key: 'sum', label: 'Sum' },
    { key: 'sumNoOutliers', label: 'Sum (outliers removed)' },
    { key: 'stdDev', label: 'Std deviation' },
    { key: 'median', label: 'Median' },
    { key: 'mode', label: 'Mode' },
    { key: 'max', label: 'Max' },
    { key: 'min', label: 'Min' },
  ];
  
  // For summary tables, don't show any stats pills
  if (tableType === 'summary') {
    return [];
  }
  
  // For single select questions (not grids) and single select grids, only show mean
  // This matches the logic in the config popup (Tabs.tsx line 1965)
  const isMultiSelect = typeLower.includes('multi-select') && !typeLower.includes('grid');
  if (tableType === 'individual' && ((isSingleSelect && !isMultiSelect && !isNumericQuestion && !isNumericGrid) || isSingleSelectGrid)) {
    return allStats.filter(stat => stat.key === 'mean');
  }
  
  // For individual tables with numeric questions/grids, show all stats
  if (tableType === 'individual' && (isNumericQuestion || isNumericGrid)) {
    return allStats;
  }
  
  // For net tables, show all stats
  if (tableType === 'net') {
    return allStats;
  }
  
  // Default: no stats for regular individual tables
  return [];
};
export const VariableTablePlaceholders: React.FC<VariableTablePlaceholdersProps> = ({
  variable,
  tableOptions,
  statsSelections,
  summaryTableSortSelections = {},
  summarySortDefaultsToOn = false,
  variableTableSelections = {},
  variableSortByFrequency = {},
  variableHoldResponseCodes = {},
  netSummaryTableSelectedCodes = {},
  getVariableDataByExpectedHeader,
  fullRawData,
  columnMapping,
  questionnaireQuestions = [],
  disableMappingIndicators = false,
  columnHeaderOverrides,
  onTablesNoData,
}) => {
  // Early validation - check before any hooks
  if (!variable || tableOptions.length === 0) {
    return (
      <div className="text-center py-12 text-gray-500">
        {variable ? 'No tables available for this variable' : 'Select a variable to view tables'}
      </div>
    );
  }

  const variableName = variable?.name || '';
  const typeLower = variable?.type?.toLowerCase() || '';
  const isSingleSelect = typeLower.includes('single select') && !typeLower.includes('grid');
  const isSingleSelectGrid = typeLower.includes('single select grid');
  const isMultiSelect = typeLower.includes('multi-select') && !typeLower.includes('grid');
  const isMultiSelectGrid = typeLower.includes('multi-select grid');
  const isNumericGrid = typeLower.includes('numeric grid');
  const isOpenEndListType = typeLower.includes('open end list');
  let anyTableRendered = false;
  let anyTableHasData = false;
  const markTableData = (hasData: boolean) => {
    anyTableRendered = true;
    if (hasData) anyTableHasData = true;
  };
  // Get nets for single select questions and single select grids
  const netsForVariable = (isSingleSelect || isSingleSelectGrid)
    ? (netSummaryTableSelectedCodes[variableName] || [])
    : [];
  const hasDataInVariable = (data: any): boolean => {
    if (!data) return false;
    const hasCount = typeof data.count === 'number' && data.count > 0;
    const hasValues = Array.isArray(data.values) && data.values.some((v: any) => v !== null && v !== undefined && String(v).trim() !== '');
    const hasFreq =
      data.frequencies &&
      typeof data.frequencies === 'object' &&
      Object.values(data.frequencies).some((v: any) => typeof v === 'number' && v > 0);
    const hasSum = data.sum !== undefined || data.mean !== undefined || data.meanNoOutliers !== undefined;
    return hasCount || hasValues || hasFreq || hasSum;
  };
  // Numeric grid: bail early if every column/row is empty (bases all 0)
  const numericGridHasData = React.useMemo(() => {
    if (!isNumericGrid) return true;
    if (!getVariableDataByExpectedHeader) return true;
    const stmtCodes = Object.keys(variable?.statements || {});
    const colCodes = Object.keys(variable?.codes || {});
    const baseQuestionNumber = getBaseQuestionNumber(variableName);
    const baseNormalized = baseQuestionNumber.replace(/^Q/i, '');
    const normalizedRow = (code: string | undefined): string => {
      if (!code) return '';
      const trimmed = code.trim();
      if (/^r\d+/i.test(trimmed)) return trimmed;
      const digits = trimmed.match(/\d+/);
      return digits ? `r${digits[0]}` : trimmed;
    };
    const normalizedCol = (code: string | undefined): string => {
      if (!code) return '';
      const trimmed = code.trim();
      if (/^c\d+/i.test(trimmed)) return trimmed;
      const digits = trimmed.match(/\d+/);
      return digits ? `c${digits[0]}` : trimmed;
    };
    const candidates = new Set<string>();
    const addCandidate = (name: string | undefined) => {
      if (!name) return;
      const trimmed = name.trim();
      if (!trimmed) return;
      candidates.add(trimmed);
      candidates.add(trimmed.replace(/^Q/i, ''));
      if (!/^Q/i.test(trimmed)) {
        candidates.add(`Q${trimmed}`);
      }
    };
    const addRowColCombos = (prefix: string | undefined, rowCode: string, colCode: string) => {
      if (!prefix) return;
      const normalizedRowCode = normalizedRow(rowCode) || rowCode;
      const normalizedColCode = normalizedCol(colCode) || colCode;
      const combos = [
        `${prefix}${normalizedRowCode}${normalizedColCode}`,
        `${prefix}_${normalizedRowCode}_${normalizedColCode}`,
        `${prefix}${normalizedRowCode}_${normalizedColCode}`,
        `${prefix}_${normalizedRowCode}${normalizedColCode}`,
        `${prefix}${normalizedRowCode}`,
        `${prefix}${normalizedColCode}`,
      ];
      combos.forEach((combo) => addCandidate(combo));
      if (/^Q/i.test(prefix)) {
        combos.forEach((combo) => addCandidate(combo.replace(/^Q/i, '')));
      } else {
        combos.forEach((combo) => addCandidate(`Q${combo}`));
      }
    };
    const addBaseVariation = () => {
      addCandidate(variableName);
      addCandidate(baseQuestionNumber);
      addCandidate(baseNormalized);
      addCandidate(`Q${baseNormalized}`);
    };
    if (stmtCodes.length > 0 && colCodes.length > 0) {
      stmtCodes.forEach((rowCode) => {
        colCodes.forEach((colCode) => {
          addRowColCombos(variableName, rowCode, colCode);
          addRowColCombos(baseQuestionNumber, rowCode, colCode);
          addRowColCombos(baseNormalized, rowCode, colCode);
        });
      });
    } else {
      addBaseVariation();
    }
    for (const name of candidates) {
      const data = getVariableDataByExpectedHeader(name);
      if (hasDataInVariable(data)) return true;
    }
    return false;
  }, [isNumericGrid, getVariableDataByExpectedHeader, variable?.statements, variable?.codes, variableName]);
  // Helper function to format numbers with commas (for 4+ digits)
  const formatNumber = (value: number | string): string => {
    // Parse if string, otherwise use as-is
    const num = typeof value === 'string' ? parseFloat(value) : value;
    if (isNaN(num)) return String(value);
    
    // Check if it's a whole number or has decimals
    if (Number.isInteger(num)) {
      // For integers, use toLocaleString for comma formatting
      return num.toLocaleString('en-US');
    } else {
      // For decimals, format the integer part with commas and keep decimals
      // If value is a string from toFixed, use it directly; otherwise format
      if (typeof value === 'string' && value.includes('.')) {
        const parts = value.split('.');
        const integerPart = parseInt(parts[0], 10);
        const decimalPart = parts[1];
        return `${integerPart.toLocaleString('en-US')}.${decimalPart}`;
      } else {
        const parts = num.toFixed(2).split('.');
        const integerPart = parseInt(parts[0], 10);
        const decimalPart = parts[1];
        return `${integerPart.toLocaleString('en-US')}.${decimalPart}`;
      }
    }
  };
  const renderNoDataBanner = (key?: string, customText?: string) => (
    <div
      key={key ? `${key}-no-data` : 'no-data'}
      className="border border-red-200 bg-red-50 text-red-700 px-4 py-3 rounded mb-2"
    >
      {customText ||
        'No data found for this table - bases are 0 across all rows/columns. Upload or map data for this question to see tables.'}
    </div>
  );
  // Group table options by type - Summary first, then Individual
  // Filter tables to only show selected ones
  // Get nets for single select questions (not shown as separate tables, but as stat pills)
  const summaryTables = tableOptions.filter(opt => {
    if (opt.type !== 'summary') return false;
    // Check if this table is selected
    return variableTableSelections[variableName]?.has(opt.id) || false;
  });
  const individualTables = tableOptions.filter(opt => {
    if (opt.type !== 'individual') return false;
    // Check if this table is selected
    return variableTableSelections[variableName]?.has(opt.id) || false;
  });
  // Find matching question (used for raw-plan multi-select "notes" options)
  const baseQuestionNumber = getBaseQuestionNumber(variableName);
  const matchingQuestion = questionnaireQuestions.find((question: any) => {
    const qNum = question.number || question.id;
    if (!qNum) return false;
    const qNumStr = String(qNum);
    const normalizedQNum = qNumStr.replace(/^Q/i, '');
    const normalizedBase = baseQuestionNumber.replace(/^Q/i, '');
    return (
      qNumStr === baseQuestionNumber ||
      normalizedQNum === normalizedBase ||
      `Q${normalizedQNum}` === baseQuestionNumber ||
      `Q${normalizedBase}` === qNumStr
    );
  });
  const columnCodeMatch = variableName.match(/c\d+/i);
  const columnCode = columnCodeMatch ? columnCodeMatch[0].toLowerCase() : '';
  const columnStatementsFromNotes = React.useMemo(() => {
    if (!matchingQuestion || !Array.isArray(matchingQuestion.notes) || matchingQuestion.notes.length === 0) {
      return [];
    }
    const baseNormalized = baseQuestionNumber.replace(/^Q/i, '').toLowerCase();
    const statementsMap = new Map<string, { code: string; text: string }>();
    matchingQuestion.notes.forEach((note: any) => {
      if (!note || typeof note !== 'string') return;
      const match = note.match(/^\[Q?([^\]]+)\]\s*(.*)$/i);
      if (!match) return;
      const codePart = match[1] || '';
      const text = (match[2] || '').trim();
      const normalizedCode = codePart.replace(/^Q/i, '');
      const noteBase = normalizedCode.replace(/r\d+/gi, '').replace(/c\d+/gi, '').toLowerCase();
      if (!noteBase) return;
      if (baseNormalized && noteBase !== baseNormalized && noteBase.replace(/^q/i, '') !== baseNormalized) {
        return;
      }
      const rowMatch = normalizedCode.match(/r\d+/i);
      const rowCode = rowMatch ? rowMatch[0].toLowerCase() : '';
      const noteColumnMatch = normalizedCode.match(/c\d+/i);
      const noteColumn = noteColumnMatch ? noteColumnMatch[0].toLowerCase() : '';
      if (columnCode && noteColumn && noteColumn !== columnCode) return;
      if (!rowCode) return;
      if (!statementsMap.has(rowCode)) {
        statementsMap.set(rowCode, {
          code: rowCode,
          text: text || rowCode,
        });
      }
    });
    return Array.from(statementsMap.values()).sort((a, b) => {
      const aNum = parseInt(a.code.replace(/[^\d]/g, ''), 10);
      const bNum = parseInt(b.code.replace(/[^\d]/g, ''), 10);
      if (!isNaN(aNum) && !isNaN(bNum)) {
        return aNum - bNum;
      }
      return a.code.localeCompare(b.code);
    });
  }, [matchingQuestion, columnCode, baseQuestionNumber]);
  // Get response options for single select variable
  const getResponseOptions = (): Array<{ code: string; text: string }> => {
    if (!variable) return [];
    
    // First try variable.codes
    if (variable.codes && Object.keys(variable.codes).length > 0) {
      return Object.entries(variable.codes).map(([code, text]) => ({
        code,
        text: String(text || code),
      }));
    }
    
    // Fallback to questionnaireQuestions
    if (matchingQuestion && Array.isArray(matchingQuestion.responseOptions)) {
      return matchingQuestion.responseOptions.map((opt: any, idx: number) => {
        if (typeof opt === 'string') {
          return { code: `c${idx + 1}`, text: opt };
        }
        return {
          code: opt.code || `c${idx + 1}`,
          text: opt.text || opt.label || opt.value || opt.code || `Option ${idx + 1}`,
        };
      });
    }
    
    return [];
  };
  const getTotalRespondents = (): number => {
    // Prefer raw data rows count (raw plans often have no "base" variable column)
    const rows = fullRawData?.rows;
    if (Array.isArray(rows) && rows.length > 0) {
      // Filter out totally empty record rows if present
      const valid = rows.filter((r: any) => {
        const recordValue = r?.record ?? r?.respno ?? r?.respNo ?? r?.Record ?? r?.Respno ?? r?.RECORD ?? r?.RESPNO;
        if (recordValue === null || recordValue === undefined) return true;
        if (typeof recordValue === 'string') return recordValue.trim() !== '';
        return true;
      });
      return valid.length || rows.length;
    }
    // Fallback to existing helper based on variable column
    return countRespondentsWithData(variableName, getVariableDataByExpectedHeader);
  };

  /**
   * Calculate base for multi-select questions by counting only respondents
   * who have at least one 0 or 1 value across all response options
   */
  const getMultiSelectBase = (responseItems: Array<{ code: string; text: string }>): number => {
    if (!getVariableDataByExpectedHeader) return 0;

    // Collect all values arrays for each response option
    const allValuesArrays: Array<any[]> = [];

    for (const item of responseItems) {
      const baseQuestionNumber = getBaseQuestionNumber(variableName);
      const possibleHeaders = [
        item.code,
        `${variableName}_${item.code}`,
        `${variableName}${item.code}`,
        `${baseQuestionNumber}${item.code}`,
        `${baseQuestionNumber}_${item.code}`,
      ];

      // Try to get data for this response option
      for (const header of possibleHeaders) {
        const data = getVariableDataByExpectedHeader(header);
        if (data && Array.isArray(data.values) && data.values.length > 0) {
          allValuesArrays.push(data.values);
          break;
        }
      }
    }

    if (allValuesArrays.length === 0) return 0;

    // Count respondents who have at least one valid value (0 or 1) across all options
    const maxLength = Math.max(...allValuesArrays.map(arr => arr.length));
    let validRespondents = 0;

    for (let i = 0; i < maxLength; i++) {
      let hasAnswer = false;

      // Check if this respondent has a 0 or 1 for any response option
      for (const valuesArray of allValuesArrays) {
        if (i < valuesArray.length) {
          const value = valuesArray[i];
          // Check if value is 0 or 1 (answered the question)
          if (value === 0 || value === 1 || value === '0' || value === '1' || value === false || value === true) {
            hasAnswer = true;
            break;
          }
        }
      }

      if (hasAnswer) {
        validRespondents++;
      }
    }

    return validRespondents;
  };
  const parseNotesAsMultiSelectItems = (): Array<{ code: string; text: string }> => {
    const notes = (matchingQuestion as any)?.notes;
    if (!Array.isArray(notes) || notes.length === 0) return [];
    const items: Array<{ code: string; text: string }> = [];
    notes.forEach((n: any) => {
      const s = String(n || '').trim();
      if (!s) return;
      const m = s.match(/^\[([^\]]+)\]\s*(.*)$/);
      if (!m) return;
      const id = String(m[1] || '').trim();
      const label = String(m[2] || '').trim();
      if (!id) return;
      items.push({ code: id, text: label || id });
    });
    // De-dupe by code
    const seen = new Set<string>();
    return items.filter((it) => {
      const key = it.code.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  };
  // Count responses for each code
  const getResponseCounts = (responseOptions: Array<{ code: string; text: string }>): Record<string, number> => {
    if (!getVariableDataByExpectedHeader) return {};
    
    const variableData = getVariableDataByExpectedHeader(variableName);
    if (!variableData || !variableData.values) return {};
    
    const counts: Record<string, number> = {};
    responseOptions.forEach(opt => {
      counts[opt.code] = 0;
    });
    
    // Build a map of all possible value representations to codes
    const valueToCodeMap: Record<string, string> = {};
    responseOptions.forEach(opt => {
      const code = opt.code;
      
      // Map the code itself
      valueToCodeMap[code] = code;
      valueToCodeMap[code.toLowerCase()] = code;
      valueToCodeMap[code.toUpperCase()] = code;
      
      // Extract numeric part from code (e.g., "c1" -> "1", "r2" -> "2")
      const numericMatch = code.match(/(\d+)$/);
      if (numericMatch) {
        const numericPart = numericMatch[1];
        valueToCodeMap[numericPart] = code;
        valueToCodeMap[String(parseInt(numericPart))] = code;
      }
      
      // Map numeric index (1-based)
      const codeIndex = responseOptions.findIndex(opt => opt.code === code) + 1;
      valueToCodeMap[String(codeIndex)] = code;
    });
    
    // Count occurrences of each code
    variableData.values.forEach((value: any) => {
      if (value === null || value === undefined || value === '') return;
      
      const valueStr = String(value).trim();
      if (valueStr === '') return;
      
      // Try exact match first
      if (valueToCodeMap.hasOwnProperty(valueStr)) {
        const matchedCode = valueToCodeMap[valueStr];
        if (counts.hasOwnProperty(matchedCode)) {
          counts[matchedCode]++;
        }
        return;
      }
      
      // Try case-insensitive match
      const lowerValue = valueStr.toLowerCase();
      if (valueToCodeMap.hasOwnProperty(lowerValue)) {
        const matchedCode = valueToCodeMap[lowerValue];
        if (counts.hasOwnProperty(matchedCode)) {
          counts[matchedCode]++;
        }
        return;
      }
      
      // Try numeric match (if value is a number, try matching to numeric part of codes)
      const numericValue = parseFloat(valueStr);
      if (!isNaN(numericValue)) {
        const numericStr = String(Math.round(numericValue));
        if (valueToCodeMap.hasOwnProperty(numericStr)) {
          const matchedCode = valueToCodeMap[numericStr];
          if (counts.hasOwnProperty(matchedCode)) {
            counts[matchedCode]++;
          }
          return;
        }
      }
    });
    
    return counts;
  };
  // Get code value for mean calculation (extract numeric part from code)
  const getCodeValueForMean = (code: string): number | null => {
    // Extract numeric part from code (e.g., "c1" -> 1, "r2" -> 2, "1" -> 1)
    const numericMatch = code.match(/(\d+)$/);
    if (numericMatch) {
      return parseInt(numericMatch[1], 10);
    }
    // If code is just a number, parse it
    const numericValue = parseFloat(code);
    if (!isNaN(numericValue)) {
      return Math.round(numericValue);
    }
    return null;
  };
  // Calculate mean for single select
  const calculateMean = (responseOptions: Array<{ code: string; text: string }>, responseCounts: Record<string, number>): number => {
    let totalSum = 0;
    let totalCount = 0;
    
    responseOptions.forEach(opt => {
      const codeValue = getCodeValueForMean(opt.code);
      if (codeValue === null) return;
      
      const count = responseCounts[opt.code] || 0;
      totalSum += codeValue * count;
      totalCount += count;
    });
    
    return totalCount > 0 ? totalSum / totalCount : 0;
  };
  // Count respondents matching a net (any of the codes in the net)
  const countNetRespondents = (netCodes: string[], responseOptions: Array<{ code: string; text: string }>, responseCounts: Record<string, number>): number => {
    // Build a set of all codes that match the net codes
    const matchingCodes = new Set<string>();
    
    netCodes.forEach(netCode => {
      // Try exact match
      if (responseCounts.hasOwnProperty(netCode)) {
        matchingCodes.add(netCode);
      }
      
      // Try case-insensitive match
      const matchingOpt = responseOptions.find(opt => opt.code.toLowerCase() === netCode.toLowerCase());
      if (matchingOpt) {
        matchingCodes.add(matchingOpt.code);
      }
      
      // Try numeric match
      const numericMatch = netCode.match(/(\d+)$/);
      if (numericMatch) {
        const numericPart = numericMatch[1];
        const matchingNumericOpt = responseOptions.find(opt => {
          const optNumericMatch = opt.code.match(/(\d+)$/);
          return optNumericMatch && optNumericMatch[1] === numericPart;
        });
        if (matchingNumericOpt) {
          matchingCodes.add(matchingNumericOpt.code);
        }
      }
    });
    
    // Sum counts for all matching codes
    let total = 0;
    matchingCodes.forEach(code => {
      total += responseCounts[code] || 0;
    });
    
    return total;
  };
  // Count responses for multi-select (each value can appear multiple times)
  // Render actual table for single select grid individual tables
  const renderSingleSelectGridTable = (option: TableOption) => {
    if (option.type !== 'individual' || !isSingleSelectGrid) {
      return null;
    }
    // Extract statement code from option ID (e.g., "B8_r1" -> "r1")
    let targetVariableName = variableName;
    let statementName: string | null = null;
    if (option.id !== variableName) {
      const statementCodeMatch = option.id.match(/_(r\d+)$/);
      if (statementCodeMatch) {
        const statementCode = statementCodeMatch[1];
        const baseQuestionNumber = getBaseQuestionNumber(variableName);
        // Use the expected header format directly (QC1r1) - this matches what's in columnMapping
        // The Data tab shows QC1r1, QC1r2, etc., so use that format
        // Ensure we have Q prefix and no underscore
        const baseNum = baseQuestionNumber.replace(/^Q/i, '');
        const expectedHeaderFormat = `Q${baseNum}${statementCode}`;
        targetVariableName = expectedHeaderFormat;
        
        // Get statement name from variable.statements
        if (variable && variable.statements && variable.statements[statementCode]) {
          statementName = String(variable.statements[statementCode]);
        } else {
          // Fallback to getStatements
          const statements = getStatements();
          const matchingStatement = statements.find(stmt => stmt.code === statementCode);
          if (matchingStatement) {
            statementName = matchingStatement.text;
          }
        }
      }
    }
    const totalResponding = countRespondentsWithData(targetVariableName, getVariableDataByExpectedHeader);
    
    // Get response options for this statement (should be the same as the base variable)
    const responseOptions = getResponseOptions();
    
    // Get response counts for this specific statement variable
    const responseCounts: Record<string, number> = {};
    responseOptions.forEach(opt => {
      responseCounts[opt.code] = 0;
    });
    
    const variableData = getVariableDataByExpectedHeader?.(targetVariableName);
    if (variableData && variableData.values) {
      variableData.values.forEach((value: any) => {
        if (value === null || value === undefined || value === '') return;
        
        const valueStr = String(value).trim();
        if (valueStr === '') return;
        
        // Try to match value to response option codes
        responseOptions.forEach(opt => {
          // Check exact match
          if (valueStr === opt.code || valueStr.toLowerCase() === opt.code.toLowerCase()) {
            responseCounts[opt.code]++;
            return;
          }
          
          // Check if value matches the code's numeric part
          const codeNum = opt.code.replace(/^[rc]/i, '').replace(/^c/i, '');
          if (valueStr === codeNum || valueStr === opt.code) {
            responseCounts[opt.code]++;
            return;
          }
          
          // Check if value matches the text (case-insensitive)
          if (valueStr.toLowerCase() === opt.text.toLowerCase()) {
            responseCounts[opt.code]++;
            return;
          }
          
          // Check numeric match
          const numericValue = parseFloat(valueStr);
          if (!isNaN(numericValue)) {
            const numericStr = String(Math.round(numericValue));
            if (numericStr === codeNum || numericStr === opt.code) {
              responseCounts[opt.code]++;
              return;
            }
          }
        });
      });
    }
    markTableData(totalResponding > 0);
    
    // Check if sort by frequency is enabled
    const sortState = variableSortByFrequency[variableName];
    const isSortedByFrequency = sortState !== undefined ? sortState : false;
    
    // Sort response options by count (descending) if sort by frequency is enabled
    let sortedResponseOptions = isSortedByFrequency
      ? [...responseOptions].sort((a, b) => {
          const countA = responseCounts[a.code] || 0;
          const countB = responseCounts[b.code] || 0;
          return countB - countA; // Descending order
        })
      : responseOptions;
    
    // Apply hold ordering if hold codes are selected
    if (isSortedByFrequency && variableHoldResponseCodes[variableName] && variableHoldResponseCodes[variableName].length > 0) {
      const holdList = variableHoldResponseCodes[variableName];
      const holdSet = new Set(holdList);
      const remaining: typeof responseOptions = [];
      const held: typeof responseOptions = [];
      
      sortedResponseOptions.forEach(opt => {
        if (holdSet.has(opt.code)) {
          held.push(opt);
        } else {
          remaining.push(opt);
        }
      });
      
      // Held items go at the bottom, maintaining their order from holdList
      const heldOrdered: typeof responseOptions = [];
      holdList.forEach(code => {
        const match = held.find(opt => opt.code === code);
        if (match) {
          heldOrdered.push(match);
        }
      });
      
      sortedResponseOptions = [...remaining, ...heldOrdered];
    }
    const noDataNotice = totalResponding === 0 ? renderNoDataBanner(option.id) : null;
    // Get selected stats (single select grids only show mean)
    const availableStats = getStatsForTableType(option.type, variable);
    const selectedStats = availableStats.filter(stat => statsSelections?.[stat.key]);
    
    // Get selected nets for this variable (filter by what's checked in tab specs)
    const selectedNets = netsForVariable.filter((net, idx) => {
      const tableId = `${variableName}_NetSummaryTable_${idx}`;
      return variableTableSelections[variableName]?.has(tableId) || false;
    });
    const overrideLabel = columnHeaderOverrides?.[option.label] || columnHeaderOverrides?.[option.code];
    const headerLabel = overrideLabel || statementName || option.label;
    const split = typeof headerLabel === 'string' ? headerLabel.split(' - ') : [];
    return (
      <div key={option.id} className="border border-gray-300 rounded-lg overflow-hidden bg-white">
        {noDataNotice}
        <div className="overflow-x-auto">
          <table className="w-full border-collapse">
            <colgroup>
              <col className="w-auto" />
              <col className="w-20" />
              <col className="w-20" />
            </colgroup>
            <thead>
              <tr className="bg-gray-200 border-b border-gray-200">
                <th className="px-4 py-2 text-left text-xs font-semibold text-gray-700 uppercase tracking-wider border-r border-gray-200">
                  {split.length >= 2 ? split.slice(0, -1).join(' - ') : headerLabel}
                </th>
                <th className="px-2 py-2 text-center text-xs font-semibold text-gray-700 uppercase tracking-wider border-r border-gray-200">
                  Count
                </th>
                <th className="px-2 py-2 text-center text-xs font-semibold text-gray-700 uppercase tracking-wider">
                  %
                </th>
              </tr>
            </thead>
            <tbody>
              <tr className="bg-gray-50 border-b border-gray-200">
                <td className={`px-4 py-2 text-sm font-semibold border-r border-gray-200 ${totalResponding === 0 ? 'text-red-600' : 'text-gray-900'}`}>
                  Base (total responding)
                </td>
                <td className={`px-2 py-2 text-sm text-center font-medium border-r border-gray-200 ${totalResponding === 0 ? 'text-red-600' : 'text-gray-900'}`}>
                  {formatNumber(totalResponding)}
                </td>
                <td className={`px-2 py-2 text-sm text-center font-medium ${totalResponding === 0 ? 'text-red-600' : 'text-gray-900'}`}>
                  100%
                </td>
              </tr>
              {sortedResponseOptions.map((opt) => {
                const count = responseCounts[opt.code] || 0;
                const percentage = totalResponding > 0 ? Math.round((count / totalResponding) * 100) : 0;
                return (
                  <tr key={opt.code} className="border-b border-gray-200 hover:bg-gray-50">
                    <td className="px-4 py-2 text-sm text-gray-900 border-r border-gray-200">
                      {opt.text}
                    </td>
                    <td className="px-2 py-2 text-sm text-center text-gray-900 border-r border-gray-200">
                      {formatNumber(count)}
                    </td>
                    <td className="px-2 py-2 text-sm text-center text-gray-900">
                      {percentage}%
                    </td>
                  </tr>
                );
              })}
              {/* Selected stats rows */}
              {selectedStats.map((stat) => {
                let value: number | string = 0;
                let displayValue: string = '0';
                
                if (stat.key === 'mean') {
                  // Calculate mean for single select
                  let totalSum = 0;
                  let totalCount = 0;
                  
                  sortedResponseOptions.forEach(opt => {
                    const codeValue = getCodeValueForMean(opt.code);
                    if (codeValue === null) return;
                    
                    const count = responseCounts[opt.code] || 0;
                    totalSum += codeValue * count;
                    totalCount += count;
                  });
                  
                  value = totalCount > 0 ? totalSum / totalCount : 0;
                  displayValue = formatNumber(value.toFixed(2));
                } else {
                  // For other stats, get from variable data if available
                  const variableData = getVariableDataByExpectedHeader?.(targetVariableName);
                  if (variableData) {
                    const statValue = variableData[stat.key];
                    if (statValue !== undefined && statValue !== null) {
                      value = statValue;
                      if (typeof value === 'number') {
                        // Format based on stat type
                        if (stat.key === 'mode' || stat.key === 'min' || stat.key === 'max' || stat.key === 'sum' || stat.key === 'sumNoOutliers') {
                          displayValue = formatNumber(Math.round(value));
                        } else {
                          displayValue = formatNumber(value.toFixed(2));
                        }
                      } else {
                        displayValue = String(value);
                      }
                    }
                  }
                }
                
                return (
                  <tr key={stat.key} className="bg-gray-50 border-b border-gray-200">
                    <td className="px-4 py-2 text-sm font-semibold text-gray-900 border-r border-gray-200">
                      {stat.label}
                    </td>
                    <td className="px-2 py-2 text-sm text-center text-gray-900 font-medium border-r border-gray-200">
                      {displayValue}
                    </td>
                    <td className="px-2 py-2 text-sm text-center text-gray-900 font-medium">
                      -
                    </td>
                  </tr>
                );
              })}
              {/* Selected nets rows */}
              {selectedNets.map((net, idx) => {
                const netCount = countNetRespondents(net.codes, responseOptions, responseCounts);
                const netPercentage = totalResponding > 0 ? Math.round((netCount / totalResponding) * 100) : 0;
                
                return (
                  <tr key={`net-${idx}`} className="bg-gray-50 border-b border-gray-200">
                    <td className="px-4 py-2 text-sm font-semibold text-gray-900 border-r border-gray-200">
                      {net.name || `Net ${idx + 1}`}
                    </td>
                    <td className="px-2 py-2 text-sm text-center text-gray-900 font-medium border-r border-gray-200">
                      {formatNumber(netCount)}
                    </td>
                    <td className="px-2 py-2 text-sm text-center text-gray-900 font-medium">
                      {netPercentage}%
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    );
  };
  // Render actual table for single select individual tables
  const renderSingleSelectTable = (option: TableOption) => {
    if (option.type !== 'individual' || !isSingleSelect || isSingleSelectGrid) {
      return null;
    }
    const totalResponding = countRespondentsWithData(variableName, getVariableDataByExpectedHeader);
    const responseOptions = getResponseOptions();
    const responseCounts = getResponseCounts(responseOptions);
    markTableData(totalResponding > 0);
    
    // Check if sort by frequency is enabled
    const sortState = variableSortByFrequency[variableName];
    const isSortedByFrequency = sortState !== undefined ? sortState : false;
    
    // Sort response options by count (descending) if sort by frequency is enabled
    let sortedResponseOptions = isSortedByFrequency
      ? [...responseOptions].sort((a, b) => {
          const countA = responseCounts[a.code] || 0;
          const countB = responseCounts[b.code] || 0;
          return countB - countA; // Descending order
        })
      : responseOptions;
    
    // Apply hold ordering if hold codes are selected
    if (isSortedByFrequency && variableHoldResponseCodes[variableName] && variableHoldResponseCodes[variableName].length > 0) {
      const holdList = variableHoldResponseCodes[variableName];
      const holdSet = new Set(holdList);
      const remaining: typeof responseOptions = [];
      const held: typeof responseOptions = [];
      
      sortedResponseOptions.forEach(opt => {
        if (holdSet.has(opt.code)) {
          held.push(opt);
        } else {
          remaining.push(opt);
        }
      });
      
      // Held items go at the bottom, maintaining their order from holdList
      const heldOrdered: typeof responseOptions = [];
      holdList.forEach(code => {
        const match = held.find(opt => opt.code === code);
        if (match) {
          heldOrdered.push(match);
        }
      });
      
      sortedResponseOptions = [...remaining, ...heldOrdered];
    }
    
    // Get selected stats
    const availableStats = getStatsForTableType(option.type, variable);
    const selectedStats = availableStats.filter(stat => statsSelections?.[stat.key]);
    
    // Get selected nets
    const selectedNets = netsForVariable.filter((net, idx) => {
      const tableId = `${variableName}_NetSummaryTable_${idx}`;
      return variableTableSelections[variableName]?.has(tableId) || false;
    });
    const noDataNotice = totalResponding === 0 ? renderNoDataBanner(option.id) : null;
    return (
      <div key={option.id} className="border border-gray-300 rounded-lg overflow-hidden bg-white">
        {noDataNotice}
        <div className="overflow-x-auto">
          <table className="w-full border-collapse">
            <colgroup>
              <col className="w-auto" />
              <col className="w-20" />
              <col className="w-20" />
            </colgroup>
            <thead>
              <tr className="bg-gray-200 border-b border-gray-200">
                <th className="px-4 py-2 text-left text-xs font-semibold text-gray-700 uppercase tracking-wider border-r border-gray-200">
                  {option.label}
                </th>
                <th className="px-2 py-2 text-center text-xs font-semibold text-gray-700 uppercase tracking-wider border-r border-gray-200">
                  Count
                </th>
                <th className="px-2 py-2 text-center text-xs font-semibold text-gray-700 uppercase tracking-wider">
                  %
                </th>
              </tr>
            </thead>
            <tbody>
              <tr className="bg-gray-50 border-b border-gray-200">
                <td className={`px-4 py-2 text-sm font-semibold border-r border-gray-200 ${totalResponding === 0 ? 'text-red-600' : 'text-gray-900'}`}>
                  Base (total responding)
                </td>
                <td className={`px-2 py-2 text-sm text-center font-medium border-r border-gray-200 ${totalResponding === 0 ? 'text-red-600' : 'text-gray-900'}`}>
                  {formatNumber(totalResponding)}
                </td>
                <td className={`px-2 py-2 text-sm text-center font-medium ${totalResponding === 0 ? 'text-red-600' : 'text-gray-900'}`}>
                  100%
                </td>
              </tr>
              {sortedResponseOptions.map((opt) => {
                const count = responseCounts[opt.code] || 0;
                const percentage = totalResponding > 0 ? Math.round((count / totalResponding) * 100) : 0;
                return (
                  <tr key={opt.code} className="border-b border-gray-200 hover:bg-gray-50">
                    <td className="px-4 py-2 text-sm text-gray-900 border-r border-gray-200">
                      {opt.text}
                    </td>
                    <td className="px-2 py-2 text-sm text-center text-gray-900 border-r border-gray-200">
                      {formatNumber(count)}
                    </td>
                    <td className="px-2 py-2 text-sm text-center text-gray-900">
                      {percentage}%
                    </td>
                  </tr>
                );
              })}
              {/* Selected stats rows */}
              {selectedStats.map((stat) => {
                let value: number | string = 0;
                let displayValue: string = '0';
                
                if (stat.key === 'mean') {
                  value = calculateMean(responseOptions, responseCounts);
                  displayValue = formatNumber(value.toFixed(2));
                } else {
                  // For other stats, get from variable data if available
                  const variableData = getVariableDataByExpectedHeader?.(variableName);
                  if (variableData) {
                    const statValue = variableData[stat.key];
                    if (statValue !== undefined && statValue !== null) {
                      value = statValue;
                      if (typeof value === 'number') {
                        // Format based on stat type
                        if (stat.key === 'mode' || stat.key === 'min' || stat.key === 'max' || stat.key === 'sum' || stat.key === 'sumNoOutliers') {
                          displayValue = formatNumber(Math.round(value));
                        } else {
                          displayValue = formatNumber(value.toFixed(2));
                        }
                      } else {
                        displayValue = String(value);
                      }
                    }
                  }
                }
                
                return (
                  <tr key={stat.key} className="bg-gray-50 border-b border-gray-200">
                    <td className="px-4 py-2 text-sm font-semibold text-gray-900 border-r border-gray-200">
                      {stat.label}
                    </td>
                    <td className="px-2 py-2 text-sm text-center text-gray-900 font-medium border-r border-gray-200">
                      {displayValue}
                    </td>
                    <td className="px-2 py-2 text-sm text-center text-gray-900 font-medium">
                      -
                    </td>
                  </tr>
                );
              })}
              {/* Selected nets rows */}
              {selectedNets.map((net, idx) => {
                const netCount = countNetRespondents(net.codes, responseOptions, responseCounts);
                const netPercentage = totalResponding > 0 ? Math.round((netCount / totalResponding) * 100) : 0;
                
                return (
                  <tr key={`net-${idx}`} className="bg-gray-50 border-b border-gray-200">
                    <td className="px-4 py-2 text-sm font-semibold text-gray-900 border-r border-gray-200">
                      {net.name || `Net ${idx + 1}`}
                    </td>
                    <td className="px-2 py-2 text-sm text-center text-gray-900 font-medium border-r border-gray-200">
                      {netCount}
                    </td>
                    <td className="px-2 py-2 text-sm text-center text-gray-900 font-medium">
                      {netPercentage}%
                    </td>
                  </tr>
                );
              })}
              {/* Selected nets rows */}
              {selectedNets.map((net, idx) => {
                const netCount = countNetRespondents(net.codes, responseOptions, responseCounts);
                const netPercentage = totalResponding > 0 ? Math.round((netCount / totalResponding) * 100) : 0;
                
                return (
                  <tr key={`net-${idx}`} className="bg-gray-50 border-b border-gray-200">
                    <td className="px-4 py-2 text-sm font-semibold text-gray-900 border-r border-gray-200">
                      {net.name || `Net ${idx + 1}`}
                    </td>
                    <td className="px-2 py-2 text-sm text-center text-gray-900 font-medium border-r border-gray-200">
                      {formatNumber(netCount)}
                    </td>
                    <td className="px-2 py-2 text-sm text-center text-gray-900 font-medium">
                      {netPercentage}%
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    );
  };
  // Check if a multi-select response option is mapped to a variable
  const isResponseOptionMapped = (responseCode: string): boolean => {
    if (disableMappingIndicators) return true;
    if (!columnMapping) return true; // If no mapping, assume mapped
    
    const baseQuestionNumber = getBaseQuestionNumber(variableName);
    // Extract numeric part from code (e.g., "c1" -> "1", "r2" -> "2", "1" -> "1")
    const codeNum = responseCode.replace(/^[rc]/i, '').replace(/^c/i, '');
    
    // Check various possible variable name formats
    const possibleVariableNames = [
      `${baseQuestionNumber}r${codeNum}`,
      `${baseQuestionNumber}_r${codeNum}`,
      `Q${baseQuestionNumber}r${codeNum}`,
      `Q${baseQuestionNumber}_r${codeNum}`,
    ];
    
    // Check if any of these variable names exist in columnMapping
    for (const varName of possibleVariableNames) {
      // Check exact match
      if (columnMapping[varName]) return true;
      
      // Check case-insensitive match
      const match = Object.keys(columnMapping).find(k => k.toLowerCase() === varName.toLowerCase());
      if (match) return true;
    }
    
    return false;
  };
  // Render actual table for multi-select individual tables
  const renderMultiSelectTable = (option: TableOption) => {
    if (option.type !== 'individual' || !isMultiSelect || isMultiSelectGrid) {
      return null;
    }
    // RAW PLAN: multi-selects are stored as many 0/1 columns (one per item) referenced in Data Map "notes".
    // Show those items and compute % checked for each.
    const noteItems = parseNotesAsMultiSelectItems();
    if (noteItems.length > 0) {
      const totalResponding = getMultiSelectBase(noteItems);
      const noDataNotice = totalResponding === 0 ? renderNoDataBanner(option.id) : null;
      markTableData(totalResponding > 0);
      const counts: Record<string, number> = {};
      noteItems.forEach((it) => {
        const baseQuestionNumber = getBaseQuestionNumber(variableName);
        const fallbackHeaders = new Set<string>([
          `${variableName}`,
          `${variableName}_${it.code}`,
          `${variableName}${it.code}`,
          `${baseQuestionNumber}${it.code}`,
          `${baseQuestionNumber}_${it.code}`,
        ]);
        counts[it.code] = countCheckedForItemColumn(it.code, getVariableDataByExpectedHeader, [
          ...Array.from(fallbackHeaders).filter(Boolean),
        ]);
      });
      const sortState = variableSortByFrequency[variableName];
      const isSortedByFrequency = sortState !== undefined ? sortState : true;
      let sorted = isSortedByFrequency
        ? [...noteItems].sort((a, b) => (counts[b.code] || 0) - (counts[a.code] || 0))
        : noteItems;
      if (isSortedByFrequency && variableHoldResponseCodes[variableName] && variableHoldResponseCodes[variableName].length > 0) {
        const holdList = variableHoldResponseCodes[variableName];
        const holdSet = new Set(holdList.map((c) => String(c)));
        const remaining: typeof noteItems = [];
        const held: typeof noteItems = [];
        sorted.forEach((opt) => {
          if (holdSet.has(opt.code)) held.push(opt);
          else remaining.push(opt);
        });
        const heldOrdered: typeof noteItems = [];
        holdList.forEach((code) => {
          const match = held.find((opt) => opt.code === code);
          if (match) heldOrdered.push(match);
        });
        sorted = [...remaining, ...heldOrdered];
      }
      return (
        <div key={option.id} className="border border-gray-300 rounded-lg overflow-hidden bg-white">
          {noDataNotice}
          <div className="overflow-x-auto">
            <table className="w-full border-collapse">
              <colgroup>
                <col className="w-auto" />
                <col className="w-20" />
                <col className="w-20" />
              </colgroup>
              <thead>
                <tr className="bg-gray-200 border-b border-gray-200">
                  <th className="px-4 py-2 text-left text-xs font-semibold text-gray-700 uppercase tracking-wider border-r border-gray-200">
                    {option.label}
                  </th>
                  <th className="px-2 py-2 text-center text-xs font-semibold text-gray-700 uppercase tracking-wider border-r border-gray-200">
                    Count
                  </th>
                  <th className="px-2 py-2 text-center text-xs font-semibold text-gray-700 uppercase tracking-wider">
                    %
                  </th>
                </tr>
              </thead>
              <tbody>
                <tr className="bg-gray-50 border-b border-gray-200">
                  <td className={`px-4 py-2 text-sm font-semibold border-r border-gray-200 ${totalResponding === 0 ? 'text-red-600' : 'text-gray-900'}`}>
                    Base (total responding)
                  </td>
                  <td className={`px-2 py-2 text-sm text-center font-medium border-r border-gray-200 ${totalResponding === 0 ? 'text-red-600' : 'text-gray-900'}`}>
                    {formatNumber(totalResponding)}
                  </td>
                  <td className={`px-2 py-2 text-sm text-center font-medium ${totalResponding === 0 ? 'text-red-600' : 'text-gray-900'}`}>
                    100%
                  </td>
                </tr>
                {sorted.map((opt) => {
                  const count = counts[opt.code] || 0;
                  const percentage = totalResponding > 0 ? Math.round((count / totalResponding) * 100) : 0;
                  return (
                    <tr key={opt.code} className="border-b border-gray-200 hover:bg-gray-50">
                      <td className="px-4 py-2 text-sm text-gray-900 border-r border-gray-200">
                        {opt.text}
                      </td>
                      <td className="px-2 py-2 text-sm text-center text-gray-900 border-r border-gray-200">
                        {formatNumber(count)}
                      </td>
                      <td className="px-2 py-2 text-sm text-center text-gray-900">
                        {percentage}%
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      );
    }
    const responseOptions = getResponseOptions();
    const totalResponding = getMultiSelectBase(responseOptions);
    const noDataNotice = totalResponding === 0 ? renderNoDataBanner(option.id) : null;
    markTableData(totalResponding > 0);
    const { counts: responseCounts } = getMultiSelectResponseCounts(variableName, responseOptions, getVariableDataByExpectedHeader);
    
    // Check if sort by frequency is enabled
    const sortState = variableSortByFrequency[variableName];
    const isSortedByFrequency = sortState !== undefined ? sortState : true; // Multi-select defaults to true
    
    // Sort response options by count (descending) if sort by frequency is enabled
    let sortedResponseOptions = isSortedByFrequency
      ? [...responseOptions].sort((a, b) => {
          const countA = responseCounts[a.code] || 0;
          const countB = responseCounts[b.code] || 0;
          return countB - countA; // Descending order
        })
      : responseOptions;
    
    // Apply hold ordering if hold codes are selected
    if (isSortedByFrequency && variableHoldResponseCodes[variableName] && variableHoldResponseCodes[variableName].length > 0) {
      const holdList = variableHoldResponseCodes[variableName];
      const holdSet = new Set(holdList);
      const remaining: typeof responseOptions = [];
      const held: typeof responseOptions = [];
      
      sortedResponseOptions.forEach(opt => {
        if (holdSet.has(opt.code)) {
          held.push(opt);
        } else {
          remaining.push(opt);
        }
      });
      
      // Held items go at the bottom, maintaining their order from holdList
      const heldOrdered: typeof responseOptions = [];
      holdList.forEach(code => {
        const match = held.find(opt => opt.code === code);
        if (match) {
          heldOrdered.push(match);
        }
      });
      
      sortedResponseOptions = [...remaining, ...heldOrdered];
    }
    
    // Get selected stats (multi-select typically doesn't show stats, but check anyway)
    const availableStats = getStatsForTableType(option.type, variable);
    const selectedStats = availableStats.filter(stat => statsSelections?.[stat.key]);
    return (
      <div key={option.id} className="border border-gray-300 rounded-lg overflow-hidden bg-white">
        {noDataNotice}
        <div className="overflow-x-auto">
          <table className="w-full border-collapse">
            <colgroup>
              <col className="w-auto" />
              <col className="w-20" />
              <col className="w-20" />
            </colgroup>
            <thead>
              <tr className="bg-gray-200 border-b border-gray-200">
                <th className="px-4 py-2 text-left text-xs font-semibold text-gray-700 uppercase tracking-wider border-r border-gray-200">
                  {option.label}
                </th>
                <th className="px-2 py-2 text-center text-xs font-semibold text-gray-700 uppercase tracking-wider border-r border-gray-200">
                  Count
                </th>
                <th className="px-2 py-2 text-center text-xs font-semibold text-gray-700 uppercase tracking-wider">
                  %
                </th>
              </tr>
            </thead>
            <tbody>
              <tr className="bg-gray-50 border-b border-gray-200">
                <td className={`px-4 py-2 text-sm font-semibold border-r border-gray-200 ${totalResponding === 0 ? 'text-red-600' : 'text-gray-900'}`}>
                  Base (total responding)
                </td>
                <td className={`px-2 py-2 text-sm text-center font-medium border-r border-gray-200 ${totalResponding === 0 ? 'text-red-600' : 'text-gray-900'}`}>
                  {formatNumber(totalResponding)}
                </td>
                <td className={`px-2 py-2 text-sm text-center font-medium ${totalResponding === 0 ? 'text-red-600' : 'text-gray-900'}`}>
                  100%
                </td>
              </tr>
              {sortedResponseOptions.map((opt) => {
                const count = responseCounts[opt.code] || 0;
                const percentage = totalResponding > 0 ? Math.round((count / totalResponding) * 100) : 0;
                const isMapped = disableMappingIndicators ? true : isResponseOptionMapped(opt.code);
                return (
                  <tr 
                    key={opt.code} 
                    className={`border-b border-gray-200 hover:bg-gray-50 ${!isMapped ? 'bg-yellow-50' : ''}`}
                  >
                    <td className="px-4 py-2 text-sm text-gray-900 border-r border-gray-200">
                      <div className="flex items-center justify-between">
                        <span>{opt.text}</span>
                        {!disableMappingIndicators && !isMapped && (
                          <span className="text-xs px-2 py-0.5 rounded-full bg-yellow-200 text-yellow-800 border border-yellow-300 font-semibold ml-2">
                            Unmapped
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="px-2 py-2 text-sm text-center text-gray-900 border-r border-gray-200">
                      {formatNumber(count)}
                    </td>
                    <td className="px-2 py-2 text-sm text-center text-gray-900">
                      {percentage}%
                    </td>
                  </tr>
                );
              })}
              {/* Selected stats rows */}
              {selectedStats.map((stat) => {
                let value: number | string = 0;
                let displayValue: string = '-';
                
                // For multi-select, stats are typically not applicable, but show if available
                const variableData = getVariableDataByExpectedHeader?.(variableName);
                if (variableData) {
                  const statValue = variableData[stat.key];
                  if (statValue !== undefined && statValue !== null) {
                    value = statValue;
                    if (typeof value === 'number') {
                      if (stat.key === 'mode' || stat.key === 'min' || stat.key === 'max' || stat.key === 'sum' || stat.key === 'sumNoOutliers') {
                        displayValue = formatNumber(Math.round(value));
                      } else {
                        displayValue = formatNumber(value.toFixed(2));
                      }
                    } else {
                      displayValue = String(value);
                    }
                  }
                }
                
                return (
                  <tr key={stat.key} className="bg-gray-50 border-b border-gray-200">
                    <td className="px-4 py-2 text-sm font-semibold text-gray-900 border-r border-gray-200">
                      {stat.label}
                    </td>
                    <td className="px-2 py-2 text-sm text-center text-gray-900 font-medium border-r border-gray-200">
                      {displayValue}
                    </td>
                    <td className="px-2 py-2 text-sm text-center text-gray-900 font-medium">
                      -
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    );
  };
  // Calculate Levenshtein distance between two strings
  const levenshteinDistance = (str1: string, str2: string): number => {
    const len1 = str1.length;
    const len2 = str2.length;
    const matrix: number[][] = [];
    
    for (let i = 0; i <= len1; i++) {
      matrix[i] = [i];
    }
    
    for (let j = 0; j <= len2; j++) {
      matrix[0][j] = j;
    }
    
    for (let i = 1; i <= len1; i++) {
      for (let j = 1; j <= len2; j++) {
        if (str1[i - 1] === str2[j - 1]) {
          matrix[i][j] = matrix[i - 1][j - 1];
        } else {
          matrix[i][j] = Math.min(
            matrix[i - 1][j] + 1,     // deletion
            matrix[i][j - 1] + 1,     // insertion
            matrix[i - 1][j - 1] + 1  // substitution
          );
        }
      }
    }
    
    return matrix[len1][len2];
  };
  // Check if two strings are similar enough to be grouped
  const areSimilar = (str1: string, str2: string): boolean => {
    const normalized1 = str1.toLowerCase().trim();
    const normalized2 = str2.toLowerCase().trim();
    
    // Exact match after normalization
    if (normalized1 === normalized2) return true;
    
    // Check length difference - if too different, not similar
    const lenDiff = Math.abs(normalized1.length - normalized2.length);
    const maxLen = Math.max(normalized1.length, normalized2.length);
    if (maxLen === 0) return true;
    
    // If length difference is more than 20% of max length, likely not similar
    if (lenDiff / maxLen > 0.2) return false;
    
    // Calculate Levenshtein distance
    const distance = levenshteinDistance(normalized1, normalized2);
    const maxDistance = Math.ceil(maxLen * 0.15); // Allow up to 15% difference
    
    return distance <= maxDistance;
  };
  // Count unique open end responses with fuzzy matching
  const getOpenEndResponseCounts = (): Array<{ text: string; count: number }> => {
    if (!getVariableDataByExpectedHeader) return [];
    
    const variableData = getVariableDataByExpectedHeader(variableName);
    if (!variableData || !variableData.values) return [];
    
    // First, count all responses
    const rawCounts: Record<string, number> = {};
    const responseTexts: string[] = [];
    
    variableData.values.forEach((value: any) => {
      if (value === null || value === undefined || value === '') return;
      
      const text = String(value).trim();
      if (text === '') return;
      
      if (!rawCounts[text]) {
        responseTexts.push(text);
      }
      rawCounts[text] = (rawCounts[text] || 0) + 1;
    });
    
    // Group similar responses
    const grouped: Array<{ text: string; count: number; originalTexts: string[] }> = [];
    const processed = new Set<string>();
    
    responseTexts.forEach(text => {
      if (processed.has(text)) return;
      
      // Find all similar responses
      const similarTexts: string[] = [text];
      let totalCount = rawCounts[text];
      
      // Use the most common spelling as the representative text
      let representativeText = text;
      let maxCount = rawCounts[text];
      
      responseTexts.forEach(otherText => {
        if (otherText === text || processed.has(otherText)) return;
        
        if (areSimilar(text, otherText)) {
          similarTexts.push(otherText);
          totalCount += rawCounts[otherText];
          
          // Use the text with the highest count as representative
          if (rawCounts[otherText] > maxCount) {
            maxCount = rawCounts[otherText];
            representativeText = otherText;
          }
        }
      });
      
      // Mark all similar texts as processed
      similarTexts.forEach(t => processed.add(t));
      
      grouped.push({
        text: representativeText,
        count: totalCount,
        originalTexts: similarTexts
      });
    });
    
    // Sort by count (descending) and return
    return grouped
      .map(({ text, count }) => ({ text, count }))
      .sort((a, b) => b.count - a.count);
  };
  // Get statements for multi-select grid
  const getStatements = (): Array<{ code: string; text: string }> => {
    if (!variable) return [];
    if (columnStatementsFromNotes.length > 0) {
      return columnStatementsFromNotes;
    }
    // First try variable.statements
    if (variable.statements && Object.keys(variable.statements).length > 0) {
      return Object.entries(variable.statements).map(([code, text]) => ({
        code,
        text: String(text || code),
      }));
    }
    
    // Fallback to questionnaireQuestions
    if (matchingQuestion && Array.isArray(matchingQuestion.statementOptions)) {
      return matchingQuestion.statementOptions.map((stmt: any, idx: number) => {
        if (typeof stmt === 'string') {
          return { code: `r${idx + 1}`, text: stmt };
        }
        return {
          code: stmt.code || `r${idx + 1}`,
          text: stmt.text || stmt.label || stmt.value || stmt.code || `Statement ${idx + 1}`,
        };
      });
    }
    
    return [];
  };
  // Count responses for multi-select grid summary table (for a specific column/response option)
  const getMultiSelectGridSummaryCounts = (columnCode: string, statements: Array<{ code: string; text: string }>): Record<string, number> => {
    if (!getVariableDataByExpectedHeader) return {};
    
    const counts: Record<string, number> = {};
    statements.forEach(stmt => {
      counts[stmt.code] = 0;
    });
    
    // For each statement, construct the variable name and get its data
    statements.forEach(stmt => {
      // Construct variable name: {base}_{statement}_{column}
      // e.g., B8_r1_c1, B8_r2_c1, etc.
      const baseQuestionNumber = getBaseQuestionNumber(variableName);
      const possibleVariableNames = [
        `${baseQuestionNumber}_${stmt.code}_${columnCode}`,
        `${baseQuestionNumber}${stmt.code}${columnCode}`,
        `${baseQuestionNumber}_${stmt.code}_${columnCode.replace(/^c/i, '')}`,
        `${baseQuestionNumber}${stmt.code}${columnCode.replace(/^c/i, '')}`,
      ];
      
      // Try to get data for any of these variable name formats
      let statementData = null;
      for (const varName of possibleVariableNames) {
        const data = getVariableDataByExpectedHeader?.(varName);
        if (data && data.values) {
          statementData = data;
          break;
        }
      }
      
      if (statementData && statementData.values) {
        // Count how many respondents selected this option (value = 1, true, "1", "Yes", etc.)
        statementData.values.forEach((value: any) => {
          if (value === null || value === undefined || value === '') return;
          
          const valueStr = String(value).trim().toLowerCase();
          const numValue = parseFloat(valueStr);
          
          // Check if value indicates selection (1, true, "1", "yes", etc.)
          if (
            numValue === 1 ||
            value === true ||
            valueStr === '1' ||
            valueStr === 'yes' ||
            valueStr === 'true'
          ) {
            counts[stmt.code]++;
          }
        });
      }
    });
    
    return counts;
  };
  // Render actual table for numeric grid mean/sum summary tables
  const renderNumericGridSummaryTable = (option: TableOption) => {
    if (option.type !== 'summary' || !isNumericGrid) {
      return null;
    }
    
    // Determine if this is a mean, sum, meanNoOutliers, or sumNoOutliers summary table
    const isMeanSummary = option.id.endsWith('_MeanSummaryTable') && !option.id.endsWith('_MeanNoOutliersSummaryTable');
    const isSumSummary = option.id.endsWith('_SumSummaryTable') && !option.id.endsWith('_SumNoOutliersSummaryTable');
    const isMeanNoOutliersSummary = option.id.endsWith('_MeanNoOutliersSummaryTable');
    const isSumNoOutliersSummary = option.id.endsWith('_SumNoOutliersSummaryTable');
    
    if (!isMeanSummary && !isSumSummary && !isMeanNoOutliersSummary && !isSumNoOutliersSummary) return null;
    
    const summaryType: NumericGridSummaryType = isMeanSummary
      ? 'mean'
      : isSumSummary
        ? 'sum'
        : isMeanNoOutliersSummary
          ? 'meanNoOutliers'
          : 'sumNoOutliers';

    const statements = getStatements();
    if (statements.length === 0) return null;
    if (!getVariableDataByExpectedHeader) return null;

    const responseOptions = getResponseOptions();
    const sortState = variableSortByFrequency[variableName];
    const isSortedByFrequency = sortState !== undefined ? sortState : false;
    const holdCodes = variableHoldResponseCodes[variableName] || [];

    const model = buildNumericGridSummaryModel({
      variable,
      variableName,
      optionId: option.id,
      summaryType,
      statements,
      responseOptions,
      getVariableDataByExpectedHeader,
      sortByFrequency: isSortedByFrequency,
      holdCodes,
    });

    const noDataNotice =
      model.rows.length > 0 && model.rows.every((stmt) => stmt.base === 0) ? renderNoDataBanner(option.id) : null;
    markTableData(model.rows.some((stmt) => stmt.base > 0));

    const columnsToUse = model.columnsToUse;
    const columnLabels = model.columnLabels;
    const totalValuesByColumn = model.totalValuesByColumn;
    const allBasesEqual = model.allBasesEqual;
    const isMeanSummaryTable = model.isMeanSummaryTable;
    const tableName = model.tableName;
    const sortedStatements = model.rows;

    // If there are multiple columns, show a column for each data column
    const hasMultipleColumns = columnsToUse.length > 1;

    return (
      <div key={option.id} className="border border-gray-300 rounded-lg overflow-hidden bg-white">
        {noDataNotice}
        <div className="overflow-x-auto">
          <table className="w-full border-collapse">
            <colgroup>
              <col className="w-auto" />
              {columnsToUse.map(colCode => (
                <React.Fragment key={colCode}>
                  <col className="w-20" />
                  {!isMeanSummaryTable && <col className="w-20" />}
                </React.Fragment>
              ))}
            </colgroup>
            <thead>
              <tr
                className="border-b"
                style={{ backgroundColor: BRAND_ORANGE }}
              >
                <th className="px-4 py-2 text-left text-xs font-semibold text-white uppercase tracking-wider border-r border-gray-200">
                  {tableName}
                </th>
                {columnsToUse.map((colCode, idx) => (
                  <React.Fragment key={colCode}>
                    <th
                      className={`px-2 py-2 text-center text-xs font-semibold text-white uppercase tracking-wider ${!isMeanSummaryTable ? 'border-r border-gray-200' : (idx < columnsToUse.length - 1 ? 'border-r border-gray-200' : '')}`}
                    >
                      {hasMultipleColumns
                        ? (columnLabels[colCode] || colCode)
                        : (isMeanSummaryTable ? 'Total' : 'Sum')}
                    </th>
                    {!isMeanSummaryTable && (
                      <th className={`px-2 py-2 text-center text-xs font-semibold text-white uppercase tracking-wider ${idx < columnsToUse.length - 1 ? 'border-r border-gray-200' : ''}`}>
                        %
                      </th>
                    )}
                  </React.Fragment>
                ))}
              </tr>
            </thead>
            <tbody>
              {isMeanSummaryTable ? (
                // For mean summary tables: show base row above each statement, no % column, no total row
                sortedStatements.map((stmt, index) => {
                  const isBaseZero = stmt.base === 0;
                  const baseRowClass = isBaseZero ? 'text-red-600' : 'text-gray-900';
                  // Only show base row if bases are different, or if this is the first statement
                  const showBaseRow = !allBasesEqual || index === 0;

                  return (
                    <React.Fragment key={stmt.code}>
                      {/* Base row for this statement */}
                      {showBaseRow && (
                        <tr className="bg-gray-50 border-b border-gray-200">
                          <td className={`px-4 py-2 text-sm font-semibold border-r border-gray-200 ${baseRowClass}`}>
                            Base (total responding)
                          </td>
                          {columnsToUse.map((colCode, colIdx) => (
                            <td
                              key={colCode}
                              className={`px-2 py-2 text-sm text-center font-medium ${baseRowClass} ${colIdx < columnsToUse.length - 1 ? 'border-r border-gray-200' : ''}`}
                            >
                              {formatNumber(stmt.base)}
                            </td>
                          ))}
                        </tr>
                      )}
                      {/* Statement row */}
                      <tr className="border-b border-gray-200 hover:bg-gray-50">
                        <td className="px-4 py-2 text-sm text-gray-900 border-r border-gray-200">
                          {stmt.text}
                        </td>
                        {columnsToUse.map((colCode, colIdx) => {
                          const displayValue = formatNumber((stmt.columnValues[colCode] || 0).toFixed(2));
                          return (
                            <td
                              key={colCode}
                              className={`px-2 py-2 text-sm text-center text-gray-900 ${colIdx < columnsToUse.length - 1 ? 'border-r border-gray-200' : ''}`}
                            >
                              {displayValue}
                            </td>
                          );
                        })}
                      </tr>
                    </React.Fragment>
                  );
                })
              ) : (
                // For sum summary tables: show base row above each statement, keep % column and total row
                <>
                  {sortedStatements.map((stmt, index) => {
                    const isBaseZero = stmt.base === 0;
                    const baseRowClass = isBaseZero ? 'text-red-600' : 'text-gray-900';
                    // Only show base row if bases are different, or if this is the first statement
                    const showBaseRow = !allBasesEqual || index === 0;

                    return (
                      <React.Fragment key={stmt.code}>
                        {/* Base row for this statement */}
                        {showBaseRow && (
                          <tr className="bg-gray-50 border-b border-gray-200">
                            <td className={`px-4 py-2 text-sm font-semibold border-r border-gray-200 ${baseRowClass}`}>
                              Base (total responding)
                            </td>
                            {columnsToUse.map((colCode, colIdx) => (
                              <React.Fragment key={colCode}>
                                <td className={`px-2 py-2 text-sm text-center font-medium border-r border-gray-200 ${baseRowClass}`}>
                                  {formatNumber(stmt.base)}
                                </td>
                                <td className={`px-2 py-2 text-sm text-center font-medium ${baseRowClass} ${colIdx < columnsToUse.length - 1 ? 'border-r border-gray-200' : ''}`}>
                                  100%
                                </td>
                              </React.Fragment>
                            ))}
                          </tr>
                        )}
                        {/* Statement row */}
                        <tr className="border-b border-gray-200 hover:bg-gray-50">
                          <td className="px-4 py-2 text-sm text-gray-900 border-r border-gray-200">
                            {stmt.text}
                          </td>
                          {columnsToUse.map((colCode, colIdx) => {
                            const columnValue = stmt.columnValues[colCode] || 0;
                            const displayValue = formatNumber(Math.round(columnValue));
                            const percentage = totalValuesByColumn[colCode] > 0
                              ? Math.round((columnValue / totalValuesByColumn[colCode]) * 100)
                              : 0;
                            return (
                              <React.Fragment key={colCode}>
                                <td className="px-2 py-2 text-sm text-center text-gray-900 border-r border-gray-200">
                                  {displayValue}
                                </td>
                                <td className={`px-2 py-2 text-sm text-center text-gray-900 ${colIdx < columnsToUse.length - 1 ? 'border-r border-gray-200' : ''}`}>
                                  {percentage}%
                                </td>
                              </React.Fragment>
                            );
                          })}
                        </tr>
                      </React.Fragment>
                    );
                  })}
                  {/* Total row */}
                  <tr className="bg-gray-50 border-b border-gray-200">
                    <td className="px-4 py-2 text-sm font-semibold text-gray-900 border-r border-gray-200">
                      Total
                    </td>
                    {columnsToUse.map((colCode, colIdx) => (
                      <React.Fragment key={colCode}>
                        <td className="px-2 py-2 text-sm text-center text-gray-900 font-medium border-r border-gray-200">
                          {formatNumber(Math.round(totalValuesByColumn[colCode] || 0))}
                        </td>
                        <td className={`px-2 py-2 text-sm text-center text-gray-900 font-medium ${colIdx < columnsToUse.length - 1 ? 'border-r border-gray-200' : ''}`}>
                          100%
                        </td>
                      </React.Fragment>
                    ))}
                  </tr>
                </>
              )}
            </tbody>
          </table>
        </div>
      </div>
    );
  };
  // Calculate mean for a single select grid statement
  const calculateSingleSelectGridMeanForStatement = (statementCode: string): number => {
    if (!getVariableDataByExpectedHeader) return 0;
    
    const baseQuestionNumber = getBaseQuestionNumber(variableName);
    const possibleVariableNames = [
      `${baseQuestionNumber}_${statementCode}`,
      `${baseQuestionNumber}${statementCode}`,
    ];
    
    // Get the statement variable data
    let statementData = null;
    for (const varName of possibleVariableNames) {
      const data = getVariableDataByExpectedHeader?.(varName);
      if (data && data.values) {
        statementData = data;
        break;
      }
    }
    
    if (!statementData || !statementData.values) return 0;
    
    // Get response options
    const responseOptions = getResponseOptions();
    
    // Count responses for each option
    const responseCounts: Record<string, number> = {};
    responseOptions.forEach(opt => {
      responseCounts[opt.code] = 0;
    });
    
    // Count occurrences of each response option
    statementData.values.forEach((value: any) => {
      if (value === null || value === undefined || value === '') return;
      
      const valueStr = String(value).trim();
      if (valueStr === '') return;
      
      // Try to match value to response option codes
      responseOptions.forEach(opt => {
        // Check exact match
        if (valueStr === opt.code || valueStr.toLowerCase() === opt.code.toLowerCase()) {
          responseCounts[opt.code]++;
          return;
        }
        
        // Check if value matches the code's numeric part
        const codeNum = opt.code.replace(/^[rc]/i, '').replace(/^c/i, '');
        if (valueStr === codeNum || valueStr === opt.code) {
          responseCounts[opt.code]++;
          return;
        }
        
        // Check if value matches the text (case-insensitive)
        if (valueStr.toLowerCase() === opt.text.toLowerCase()) {
          responseCounts[opt.code]++;
          return;
        }
        
        // Check numeric match
        const numericValue = parseFloat(valueStr);
        if (!isNaN(numericValue)) {
          const numericStr = String(Math.round(numericValue));
          if (numericStr === codeNum || numericStr === opt.code) {
            responseCounts[opt.code]++;
            return;
          }
        }
      });
    });
    
    // Calculate weighted mean
    return calculateMean(responseOptions, responseCounts);
  };
  // Render actual table for single select grid mean summary tables and net summary tables
  const renderSingleSelectGridSummaryTable = (option: TableOption) => {
    if (option.type !== 'summary' || !isSingleSelectGrid) {
      return null;
    }
    
    // Check if this is a mean summary table
    const isMeanSummary = option.id.endsWith('_MeanSummaryTable');
    // Check if this is a net summary table
    const netSummaryMatch = option.id.match(/_NetSummaryTable_(\d+)$/);
    const isNetSummary = netSummaryMatch !== null;
    
    if (!isMeanSummary && !isNetSummary) return null;
    
    // Handle net summary tables
    if (isNetSummary) {
      const netIndex = parseInt(netSummaryMatch![1], 10);
      const nets = netsForVariable;
      if (!nets || netIndex >= nets.length) return null;
      
      const net = nets[netIndex];
      if (!net || !net.codes || net.codes.length === 0) return null;
      
      const statements = getStatements();
      if (statements.length === 0) return null;
      
      // Calculate net counts for each statement
      const statementNetCounts = statements.map(stmt => {
        const baseQuestionNumber = getBaseQuestionNumber(variableName);
        const baseNum = baseQuestionNumber.replace(/^Q/i, '');
        const expectedHeaderFormat = `Q${baseNum}${stmt.code}`;
        const statementBase = countRespondentsWithData(expectedHeaderFormat, getVariableDataByExpectedHeader);
        
        // Get response options
        const responseOptions = getResponseOptions();
        
        // Get response counts for this statement
        const responseCounts: Record<string, number> = {};
        responseOptions.forEach(opt => {
          responseCounts[opt.code] = 0;
        });
        
        const variableData = getVariableDataByExpectedHeader?.(expectedHeaderFormat);
        if (variableData && variableData.values) {
          variableData.values.forEach((value: any) => {
            if (value === null || value === undefined || value === '') return;
            
            const valueStr = String(value).trim();
            if (valueStr === '') return;
            
            // Try to match value to response option codes
            responseOptions.forEach(opt => {
              if (valueStr === opt.code || valueStr.toLowerCase() === opt.code.toLowerCase()) {
                responseCounts[opt.code]++;
                return;
              }
              
              const codeNum = opt.code.replace(/^[rc]/i, '').replace(/^c/i, '');
              if (valueStr === codeNum || valueStr === opt.code) {
                responseCounts[opt.code]++;
                return;
              }
              
              if (valueStr.toLowerCase() === opt.text.toLowerCase()) {
                responseCounts[opt.code]++;
                return;
              }
              
              const numericValue = parseFloat(valueStr);
              if (!isNaN(numericValue)) {
                const numericStr = String(Math.round(numericValue));
                if (numericStr === codeNum || numericStr === opt.code) {
                  responseCounts[opt.code]++;
                  return;
                }
              }
            });
          });
        }
        
        // Calculate net count for this statement
        const netCount = countNetRespondents(net.codes, responseOptions, responseCounts);
        
        return {
          code: stmt.code,
          text: stmt.text,
          base: statementBase,
          netCount: netCount,
        };
      });
      
      // Check if all bases are equal
      const allBasesEqual = statementNetCounts.length > 0 && 
        statementNetCounts.every(stmt => stmt.base === statementNetCounts[0].base);
      
      // Check if sort by frequency is enabled
      const sortState = variableSortByFrequency[variableName];
      const isSortedByFrequency = sortState !== undefined ? sortState : false;
      
      // Sort statements by net count (descending) if sort by frequency is enabled
      let sortedStatements = isSortedByFrequency
        ? [...statementNetCounts].sort((a, b) => b.netCount - a.netCount)
        : statementNetCounts;
      
      // Apply hold ordering if hold codes are selected
      if (isSortedByFrequency && variableHoldResponseCodes[variableName] && variableHoldResponseCodes[variableName].length > 0) {
        const holdList = variableHoldResponseCodes[variableName];
        const holdSet = new Set(holdList);
        const remaining: typeof statementNetCounts = [];
        const held: typeof statementNetCounts = [];
        
        sortedStatements.forEach(stmt => {
          if (holdSet.has(stmt.code)) {
            held.push(stmt);
          } else {
            remaining.push(stmt);
          }
        });
        
        // Held items go at the bottom, maintaining their order from holdList
        const heldOrdered: typeof statementNetCounts = [];
        holdList.forEach(code => {
          const match = held.find(stmt => stmt.code === code);
          if (match) {
            heldOrdered.push(match);
          }
        });
        
        sortedStatements = [...remaining, ...heldOrdered];
      }
      const noDataNotice = statementNetCounts.length > 0 && statementNetCounts.every(stmt => stmt.base === 0)
        ? renderNoDataBanner(option.id)
        : null;
      markTableData(statementNetCounts.some(stmt => stmt.base > 0));
      return (
        <div key={option.id} className="border border-gray-300 rounded-lg overflow-hidden bg-white">
          {noDataNotice}
          <div className="overflow-x-auto">
            <table className="w-full border-collapse">
              <colgroup>
                <col className="w-auto" />
                <col className="w-20" />
                <col className="w-20" />
              </colgroup>
              <thead>
                <tr
                  className="border-b"
                  style={{ backgroundColor: BRAND_ORANGE }}
                >
                  <th className="px-4 py-2 text-left text-xs font-semibold text-white uppercase tracking-wider border-r border-gray-200">
                    {net.name || `Net ${netIndex + 1}`}
                  </th>
                  <th className="px-2 py-2 text-center text-xs font-semibold text-white uppercase tracking-wider border-r border-gray-200">
                    Count
                  </th>
                  <th className="px-2 py-2 text-center text-xs font-semibold text-white uppercase tracking-wider">
                    %
                  </th>
                </tr>
              </thead>
              <tbody>
                {sortedStatements.map((stmt, index) => {
                  const percentage = stmt.base > 0 ? Math.round((stmt.netCount / stmt.base) * 100) : 0;
                  const isBaseZero = stmt.base === 0;
                  const baseRowClass = isBaseZero ? 'text-red-600' : 'text-gray-900';
                  // Only show base row if bases are different, or if this is the first statement
                  const showBaseRow = !allBasesEqual || index === 0;
                  
                  return (
                    <React.Fragment key={stmt.code}>
                      {/* Base row for this statement */}
                      {showBaseRow && (
                        <tr className="bg-gray-50 border-b border-gray-200">
                          <td className={`px-4 py-2 text-sm font-semibold border-r border-gray-200 ${baseRowClass}`}>
                            Base (total responding)
                          </td>
                          <td className={`px-2 py-2 text-sm text-center font-medium border-r border-gray-200 ${baseRowClass}`}>
                            {formatNumber(stmt.base)}
                          </td>
                          <td className={`px-2 py-2 text-sm text-center font-medium ${baseRowClass}`}>
                            100%
                          </td>
                        </tr>
                      )}
                      {/* Statement row */}
                      <tr className="border-b border-gray-200 hover:bg-gray-50">
                        <td className="px-4 py-2 text-sm text-gray-900 border-r border-gray-200">
                          {stmt.text}
                        </td>
                        <td className="px-2 py-2 text-sm text-center text-gray-900 border-r border-gray-200">
                          {formatNumber(stmt.netCount)}
                        </td>
                        <td className="px-2 py-2 text-sm text-center text-gray-900">
                          {percentage}%
                        </td>
                      </tr>
                    </React.Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      );
    }
    
    // Continue with mean summary table logic below
    
    const statements = getStatements();
    if (statements.length === 0) return null;
    
    // Calculate total responding (anyone who answered at least one statement)
    let totalResponding = 0;
    const respondentSet = new Set<number>();
    
    statements.forEach(stmt => {
      const baseQuestionNumber = getBaseQuestionNumber(variableName);
      const possibleVariableNames = [
        `${baseQuestionNumber}_${stmt.code}`,
        `${baseQuestionNumber}${stmt.code}`,
      ];
      
      for (const varName of possibleVariableNames) {
        const data = getVariableDataByExpectedHeader?.(varName);
        if (data && data.values) {
          data.values.forEach((value: any, idx: number) => {
            if (value === null || value === undefined || value === '') return;
            respondentSet.add(idx);
          });
          break;
        }
      }
    });
    
    totalResponding = respondentSet.size;
    
    // Calculate mean and base for each statement
    const statementMeans = statements.map(stmt => {
      const baseQuestionNumber = getBaseQuestionNumber(variableName);
      const baseNum = baseQuestionNumber.replace(/^Q/i, '');
      const expectedHeaderFormat = `Q${baseNum}${stmt.code}`;
      const statementBase = countRespondentsWithData(expectedHeaderFormat, getVariableDataByExpectedHeader);
      
      return {
        code: stmt.code,
        text: stmt.text,
        mean: calculateSingleSelectGridMeanForStatement(stmt.code),
        base: statementBase,
      };
    });
    
    // Calculate total of all means for percentage calculation
    const totalMean = statementMeans.reduce((sum, stmt) => sum + stmt.mean, 0);
    
    // Check if all bases are equal
    const allBasesEqual = statementMeans.length > 0 && 
      statementMeans.every(stmt => stmt.base === statementMeans[0].base);
    
    // Check if sort by frequency is enabled (single select grids don't default to sort)
    const sortState = variableSortByFrequency[variableName];
    const isSortedByFrequency = sortState !== undefined ? sortState : false;
    
    // Sort statements by mean (descending) if sort by frequency is enabled
    let sortedStatements = isSortedByFrequency
      ? [...statementMeans].sort((a, b) => b.mean - a.mean)
      : statementMeans;
    
    // Apply hold ordering if hold codes are selected
    if (isSortedByFrequency && variableHoldResponseCodes[variableName] && variableHoldResponseCodes[variableName].length > 0) {
      const holdList = variableHoldResponseCodes[variableName];
      const holdSet = new Set(holdList);
      const remaining: typeof statementMeans = [];
      const held: typeof statementMeans = [];
      
      sortedStatements.forEach(stmt => {
        if (holdSet.has(stmt.code)) {
          held.push(stmt);
        } else {
          remaining.push(stmt);
        }
      });
      
      // Held items go at the bottom, maintaining their order from holdList
      const heldOrdered: typeof statementMeans = [];
      holdList.forEach(code => {
        const match = held.find(stmt => stmt.code === code);
        if (match) {
          heldOrdered.push(match);
        }
      });
      
      sortedStatements = [...remaining, ...heldOrdered];
    }
    markTableData(statementMeans.some(stmt => stmt.base > 0));
    const noDataNotice = statementMeans.length > 0 && statementMeans.every(stmt => stmt.base === 0)
      ? renderNoDataBanner(option.id)
      : null;
    return (
      <div key={option.id} className="border border-gray-300 rounded-lg overflow-hidden bg-white">
        {noDataNotice}
        <div className="overflow-x-auto">
          <table className="w-full border-collapse">
            <colgroup>
              <col className="w-auto" />
              <col className="w-20" />
            </colgroup>
            <thead>
              <tr
                className="border-b"
                style={{ backgroundColor: BRAND_ORANGE }}
              >
                <th className="px-4 py-2 text-left text-xs font-semibold text-white uppercase tracking-wider border-r border-gray-200">
                  Mean Summary
                </th>
                <th className="px-2 py-2 text-center text-xs font-semibold text-white uppercase tracking-wider">
                  Total
                </th>
              </tr>
            </thead>
            <tbody>
              {sortedStatements.map((stmt, index) => {
                const displayValue = formatNumber(stmt.mean.toFixed(2));
                const isBaseZero = stmt.base === 0;
                const baseRowClass = isBaseZero ? 'text-red-600' : 'text-gray-900';
                // Only show base row if bases are different, or if this is the first statement
                const showBaseRow = !allBasesEqual || index === 0;
                
                return (
                  <React.Fragment key={stmt.code}>
                    {/* Base row for this statement */}
                    {showBaseRow && (
                      <tr className="bg-gray-50 border-b border-gray-200">
                        <td className={`px-4 py-2 text-sm font-semibold border-r border-gray-200 ${baseRowClass}`}>
                          Base (total responding)
                        </td>
                        <td className={`px-2 py-2 text-sm text-center font-medium ${baseRowClass}`}>
                          {formatNumber(stmt.base)}
                        </td>
                      </tr>
                    )}
                    {/* Statement row */}
                    <tr className="border-b border-gray-200 hover:bg-gray-50">
                      <td className="px-4 py-2 text-sm text-gray-900 border-r border-gray-200">
                        {stmt.text}
                      </td>
                      <td className="px-2 py-2 text-sm text-center text-gray-900">
                        {displayValue}
                      </td>
                    </tr>
                  </React.Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    );
  };
  // Render actual table for multi-select grid summary tables
  const renderMultiSelectGridSummaryTable = (option: TableOption) => {
    if (option.type !== 'summary' || !isMultiSelectGrid) {
      return null;
    }
    
    // Extract column code from option ID (e.g., "B8_c1_SummaryTable" -> "c1")
    const columnCodeMatch = option.id.match(/_([^_]+)_SummaryTable$/);
    if (!columnCodeMatch) return null;
    
    const columnCode = columnCodeMatch[1];
    
    // Get response option name (column name) for this column code
    let responseOptionName: string | null = null;
    if (variable && variable.codes && variable.codes[columnCode]) {
      responseOptionName = String(variable.codes[columnCode]);
    } else {
      // Fallback to getResponseOptions
      const responseOptions = getResponseOptions();
      const matchingOption = responseOptions.find(opt => opt.code === columnCode);
      if (matchingOption) {
        responseOptionName = matchingOption.text;
      }
    }
    
    const statements = getStatements();
    if (statements.length === 0) return null;
    
    // Count total responding (anyone who answered at least one statement for this column)
    let totalResponding = 0;
    const respondentSet = new Set<number>();
    
    statements.forEach(stmt => {
      const baseQuestionNumber = getBaseQuestionNumber(variableName);
      const possibleVariableNames = [
        `${baseQuestionNumber}_${stmt.code}_${columnCode}`,
        `${baseQuestionNumber}${stmt.code}${columnCode}`,
        `${baseQuestionNumber}_${stmt.code}_${columnCode.replace(/^c/i, '')}`,
        `${baseQuestionNumber}${stmt.code}${columnCode.replace(/^c/i, '')}`,
      ];
      
      for (const varName of possibleVariableNames) {
        const data = getVariableDataByExpectedHeader?.(varName);
        if (data && data.values) {
          data.values.forEach((value: any, idx: number) => {
            if (value === null || value === undefined || value === '') return;
            
            const valueStr = String(value).trim().toLowerCase();
            const numValue = parseFloat(valueStr);
            
            if (
              numValue === 1 ||
              value === true ||
              valueStr === '1' ||
              valueStr === 'yes' ||
              valueStr === 'true'
            ) {
              respondentSet.add(idx);
            }
          });
          break;
        }
      }
    });
    
    totalResponding = respondentSet.size;
    markTableData(totalResponding > 0);
    
    const statementCounts = getMultiSelectGridSummaryCounts(columnCode, statements);
    const noDataNotice = totalResponding === 0 ? renderNoDataBanner(option.id) : null;
    
    // Check if sort by frequency is enabled (multi-select grids default to true)
    const sortState = variableSortByFrequency[variableName];
    const isSortedByFrequency = sortState !== undefined ? sortState : true;
    
    // Sort statements by count (descending) if sort by frequency is enabled
    let sortedStatements = isSortedByFrequency
      ? [...statements].sort((a, b) => {
          const countA = statementCounts[a.code] || 0;
          const countB = statementCounts[b.code] || 0;
          return countB - countA; // Descending order
        })
      : statements;
    
    // Apply hold ordering if hold codes are selected (for statements)
    if (isSortedByFrequency && variableHoldResponseCodes[variableName] && variableHoldResponseCodes[variableName].length > 0) {
      const holdList = variableHoldResponseCodes[variableName];
      const holdSet = new Set(holdList);
      const remaining: typeof statements = [];
      const held: typeof statements = [];
      
      sortedStatements.forEach(stmt => {
        if (holdSet.has(stmt.code)) {
          held.push(stmt);
        } else {
          remaining.push(stmt);
        }
      });
      
      // Held items go at the bottom, maintaining their order from holdList
      const heldOrdered: typeof statements = [];
      holdList.forEach(code => {
        const match = held.find(stmt => stmt.code === code);
        if (match) {
          heldOrdered.push(match);
        }
      });
      
      sortedStatements = [...remaining, ...heldOrdered];
    }
    const overrideLabel = columnHeaderOverrides?.[responseOptionName || ''] || columnHeaderOverrides?.[option.label] || columnHeaderOverrides?.[option.code];
    const headerLabel = overrideLabel || responseOptionName || option.label;
    const split = typeof headerLabel === 'string' ? headerLabel.split(' - ') : [];
    return (
      <div key={option.id} className="border border-gray-300 rounded-lg overflow-hidden bg-white">
        {noDataNotice}
        <div className="overflow-x-auto">
          <table className="w-full border-collapse">
            <colgroup>
              <col className="w-auto" />
              <col className="w-20" />
              <col className="w-20" />
            </colgroup>
            <thead>
              <tr className="bg-gray-200 border-b border-gray-200">
                <th className="px-4 py-2 text-left text-xs font-semibold text-gray-700 uppercase tracking-wider border-r border-gray-200">
                  {split.length >= 2 ? split.slice(0, -1).join(' - ') : headerLabel}
                </th>
                <th className="px-2 py-2 text-center text-xs font-semibold text-gray-700 uppercase tracking-wider border-r border-gray-200">
                  Count
                </th>
                <th className="px-2 py-2 text-center text-xs font-semibold text-gray-700 uppercase tracking-wider">
                  %
                </th>
              </tr>
            </thead>
            <tbody>
              <tr className="bg-gray-50 border-b border-gray-200">
                <td className={`px-4 py-2 text-sm font-semibold border-r border-gray-200 ${totalResponding === 0 ? 'text-red-600' : 'text-gray-900'}`}>
                  Base (total responding)
                </td>
                <td className={`px-2 py-2 text-sm text-center font-medium border-r border-gray-200 ${totalResponding === 0 ? 'text-red-600' : 'text-gray-900'}`}>
                  {formatNumber(totalResponding)}
                </td>
                <td className={`px-2 py-2 text-sm text-center font-medium ${totalResponding === 0 ? 'text-red-600' : 'text-gray-900'}`}>
                  100%
                </td>
              </tr>
              {sortedStatements.map((stmt) => {
                const count = statementCounts[stmt.code] || 0;
                const percentage = totalResponding > 0 ? Math.round((count / totalResponding) * 100) : 0;
                return (
                  <tr key={stmt.code} className="border-b border-gray-200 hover:bg-gray-50">
                    <td className="px-4 py-2 text-sm text-gray-900 border-r border-gray-200">
                      {stmt.text}
                    </td>
                    <td className="px-2 py-2 text-sm text-center text-gray-900 border-r border-gray-200">
                      {formatNumber(count)}
                    </td>
                    <td className="px-2 py-2 text-sm text-center text-gray-900">
                      {percentage}%
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    );
  };
  // Get numeric frequency distribution
  const getNumericFrequencyDistribution = (targetVariableName?: string): Array<{ value: number; count: number }> => {
    if (!getVariableDataByExpectedHeader) return [];
    
    const varName = targetVariableName || variableName;
    const variableData = getVariableDataByExpectedHeader(varName);
    if (!variableData || !variableData.values) return [];
    
    // Count occurrences of each unique numeric value
    const frequencyMap: Record<number, number> = {};
    
    variableData.values.forEach((value: any) => {
      if (value === null || value === undefined || value === '') return;
      
      const numValue = parseFloat(String(value));
      if (isNaN(numValue)) return;
      
      // Round to nearest integer for frequency distribution
      const roundedValue = Math.round(numValue);
      frequencyMap[roundedValue] = (frequencyMap[roundedValue] || 0) + 1;
    });
    
    // Convert to array and sort by value (ascending)
    return Object.entries(frequencyMap)
      .map(([value, count]) => ({ value: parseFloat(value), count }))
      .sort((a, b) => a.value - b.value);
  };
  // Calculate statistics for numeric data
  const calculateNumericStats = (targetVariableName?: string): Record<string, number> => {
    if (!getVariableDataByExpectedHeader) return {};
    
    const varName = targetVariableName || variableName;
    const variableData = getVariableDataByExpectedHeader(varName);
    if (!variableData || !variableData.values) return {};
    
    // Get all numeric values
    const numericValues: number[] = [];
    variableData.values.forEach((value: any) => {
      if (value === null || value === undefined || value === '') return;
      const numValue = parseFloat(String(value));
      if (!isNaN(numValue)) {
        numericValues.push(numValue);
      }
    });
    
    if (numericValues.length === 0) return {};
    
    // Calculate basic stats
    const sorted = [...numericValues].sort((a, b) => a - b);
    const sum = numericValues.reduce((acc, val) => acc + val, 0);
    const mean = sum / numericValues.length;
    
    // Calculate standard deviation
    const variance = numericValues.reduce((acc, val) => acc + Math.pow(val - mean, 2), 0) / numericValues.length;
    const stdDev = Math.sqrt(variance);
    
    // Calculate median
    const median = sorted.length % 2 === 0
      ? (sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2
      : sorted[Math.floor(sorted.length / 2)];
    
    // Calculate mode (most frequent value)
    const frequencyMap: Record<number, number> = {};
    numericValues.forEach(val => {
      const rounded = Math.round(val);
      frequencyMap[rounded] = (frequencyMap[rounded] || 0) + 1;
    });
    const modeEntry = Object.entries(frequencyMap).reduce((max, [val, count]) => 
      count > max[1] ? [val, count] : max, ['0', 0]
    );
    const mode = parseFloat(modeEntry[0]);
    
    const min = sorted[0];
    const max = sorted[sorted.length - 1];
    
    // Calculate stats with outliers removed (2 standard deviations from mean)
    const lowerBound = mean - 2 * stdDev;
    const upperBound = mean + 2 * stdDev;
    const valuesNoOutliers = numericValues.filter(val => val >= lowerBound && val <= upperBound);
    
    let meanNoOutliers = 0;
    let sumNoOutliers = 0;
    if (valuesNoOutliers.length > 0) {
      sumNoOutliers = valuesNoOutliers.reduce((acc, val) => acc + val, 0);
      meanNoOutliers = sumNoOutliers / valuesNoOutliers.length;
    }
    
    return {
      mean,
      meanNoOutliers,
      sum,
      sumNoOutliers,
      stdDev,
      median,
      mode,
      min,
      max,
    };
  };
  // Render actual table for numeric individual tables
  const renderNumericTable = (option: TableOption) => {
    const isNumericQuestion = typeLower.includes('numeric') && !typeLower.includes('grid') && !typeLower.includes('list');
    const isNumericGrid = typeLower.includes('numeric grid');
    
    // Check if this is a numeric question (non-grid) or numeric grid statement
    if (option.type !== 'individual' || (!isNumericQuestion && !isNumericGrid)) {
      return null;
    }
    
    // For numeric grids, extract statement code and aggregate values across all columns for that statement
    let targetVariableName = variableName;
    let statementName: string | null = null;
    let aggregatedValues: number[] | null = null;
    let aggregatedRespondentSet: Set<number> | null = null;
    let debugHeaders: string[] = [];
    if (isNumericGrid && option.id !== variableName) {
      const statementCodeMatch = option.id.match(/_(r\d+)$/);
      if (statementCodeMatch) {
        const statementCode = statementCodeMatch[1];
        const baseQuestionNumber = getBaseQuestionNumber(variableName);

        const values: number[] = [];
        const respondentSet = new Set<number>();

        // Use exact headers from the data map: baseQuestionNumber + statementCode + columnCode
        const columnCodes: string[] = [];
        if (variable?.codes && Object.keys(variable.codes).length > 0) {
          columnCodes.push(...Object.keys(variable.codes));
        } else {
          const responseOptions = getResponseOptions();
          responseOptions.forEach(opt => {
            if (opt.code.startsWith('c') || /^\d+$/.test(opt.code)) {
              columnCodes.push(opt.code);
            }
          });
        }
        const normalizeCol = (code: string) => {
          const trimmed = String(code || '').trim();
          if (!trimmed) return '';
          if (/^c\d+/i.test(trimmed)) return trimmed;
          if (/^\d+$/.test(trimmed)) return `c${trimmed}`;
          return trimmed;
        };
        const normalizedColumns = columnCodes.map(normalizeCol).filter(Boolean);
        const columnFromVariableNameMatch = variableName.match(/c\d+/i);
        const columnFromVariableName = columnFromVariableNameMatch ? normalizeCol(columnFromVariableNameMatch[0]) : null;
        const columnsToUse = columnFromVariableName
          ? [columnFromVariableName]
          : (normalizedColumns.length > 0 ? normalizedColumns : ['c1']);

        const exactHeaders = columnsToUse.map(col => `${baseQuestionNumber}${statementCode}${col}`);
        debugHeaders = exactHeaders;

        exactHeaders.forEach(header => {
          const data = getVariableDataByExpectedHeader?.(header);
          if (data && Array.isArray(data.values)) {
            data.values.forEach((value: any, idx: number) => {
              if (value === null || value === undefined || value === '') return;
              const numValue = parseFloat(String(value));
              if (!isNaN(numValue)) {
                values.push(numValue);
                respondentSet.add(idx);
              }
            });
          }
        });

        aggregatedValues = values;
        aggregatedRespondentSet = respondentSet;
        targetVariableName = `${baseQuestionNumber}_${statementCode}`;

        // Get statement name from variable.statements
        if (variable && variable.statements && variable.statements[statementCode]) {
          statementName = String(variable.statements[statementCode]);
        } else {
          // Fallback to getStatements
          const statements = getStatements();
          const matchingStatement = statements.find(stmt => stmt.code === statementCode);
          if (matchingStatement) {
            statementName = matchingStatement.text;
          }
        }
      }
    }

    const computeFrequencyDistribution = (vals: number[]): Array<{ value: number; count: number }> => {
      const freq: Record<number, number> = {};
      vals.forEach(v => {
        const rounded = Math.round(v);
        freq[rounded] = (freq[rounded] || 0) + 1;
      });
      return Object.entries(freq)
        .map(([value, count]) => ({ value: parseFloat(value), count }))
        .sort((a, b) => a.value - b.value);
    };

    const computeStats = (vals: number[]) => {
      if (!vals.length) return {};
      const sorted = [...vals].sort((a, b) => a - b);
      const sum = vals.reduce((acc, val) => acc + val, 0);
      const mean = sum / vals.length;
      const variance = vals.reduce((acc, val) => acc + Math.pow(val - mean, 2), 0) / vals.length;
      const stdDev = Math.sqrt(variance);
      const median = sorted.length % 2 === 0
        ? (sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2
        : sorted[Math.floor(sorted.length / 2)];
      const freqMap: Record<number, number> = {};
      vals.forEach(v => {
        const r = Math.round(v);
        freqMap[r] = (freqMap[r] || 0) + 1;
      });
      const modeEntry = Object.entries(freqMap).reduce((max, [val, count]) =>
        count > max[1] ? [val, count] : max, ['0', 0]);
      const mode = parseFloat(modeEntry[0]);
      const min = sorted[0];
      const max = sorted[sorted.length - 1];

      const lowerBound = mean - 2 * stdDev;
      const upperBound = mean + 2 * stdDev;
      const valsNoOutliers = vals.filter(v => v >= lowerBound && v <= upperBound);
      const sumNoOutliers = valsNoOutliers.reduce((acc, val) => acc + val, 0);
      const meanNoOutliers = valsNoOutliers.length > 0 ? sumNoOutliers / valsNoOutliers.length : 0;

      return {
        mean,
        meanNoOutliers,
        sum,
        sumNoOutliers,
        stdDev,
        median,
        mode,
        min,
        max,
      };
    };

    let totalResponding = 0;
    let frequencyDistribution: Array<{ value: number; count: number }> = [];
    let stats: Record<string, number> = {};

    // Use only aggregated values for numeric grids so the frequency table reflects the exact headers list
    if (isNumericGrid && aggregatedValues && aggregatedRespondentSet) {
      totalResponding = aggregatedRespondentSet.size;
      frequencyDistribution = computeFrequencyDistribution(aggregatedValues);
      stats = computeStats(aggregatedValues) as Record<string, number>;
    } else {
      totalResponding = countRespondentsWithData(targetVariableName, getVariableDataByExpectedHeader);
      frequencyDistribution = getNumericFrequencyDistribution(targetVariableName);
      stats = calculateNumericStats(targetVariableName);
    }
    // Suppress the red no-data banner for numeric grids while debugging headers
    const noDataNotice =
      isNumericGrid
        ? null
        : (totalResponding === 0 ? renderNoDataBanner(option.id) : null);
    // For numeric grids in debug mode, mark as having data so parent doesn't collapse
    if (isNumericGrid) {
      markTableData(true);
    } else {
      markTableData(totalResponding > 0);
    }
    
    // Get selected stats
    const availableStats = getStatsForTableType(option.type, variable);
    const selectedStats = availableStats.filter(stat => statsSelections?.[stat.key]);
    
    const overrideLabel = columnHeaderOverrides?.[statementName || ''] || columnHeaderOverrides?.[option.label] || columnHeaderOverrides?.[option.code];
    const headerLabel = overrideLabel || statementName || option.label;
    const split = typeof headerLabel === 'string' ? headerLabel.split(' - ') : [];
    markTableData(totalResponding > 0);
    return (
      <div key={option.id} className="border border-gray-300 rounded-lg overflow-hidden bg-white">
        {noDataNotice}
        <div className="overflow-x-auto">
          <table className="w-full border-collapse">
            <colgroup>
              <col className="w-auto" />
              <col className="w-20" />
              <col className="w-20" />
            </colgroup>
            <thead>
              <tr className="bg-gray-200 border-b border-gray-200">
                <th className="px-4 py-2 text-left text-xs font-semibold text-gray-700 uppercase tracking-wider border-r border-gray-200">
                  {split.length >= 2 ? split.slice(0, -1).join(' - ') : headerLabel}
                </th>
                <th className="px-2 py-2 text-center text-xs font-semibold text-gray-700 uppercase tracking-wider border-r border-gray-200">
                  Count
                </th>
                <th className="px-2 py-2 text-center text-xs font-semibold text-gray-700 uppercase tracking-wider">
                  %
                </th>
              </tr>
            </thead>
            <tbody>
              <tr className="bg-gray-50 border-b border-gray-200">
                <td className={`px-4 py-2 text-sm font-semibold border-r border-gray-200 ${totalResponding === 0 ? 'text-red-600' : 'text-gray-900'}`}>
                  Base (total responding)
                </td>
                <td className={`px-2 py-2 text-sm text-center font-medium border-r border-gray-200 ${totalResponding === 0 ? 'text-red-600' : 'text-gray-900'}`}>
                  {formatNumber(totalResponding)}
                </td>
                <td className={`px-2 py-2 text-sm text-center font-medium ${totalResponding === 0 ? 'text-red-600' : 'text-gray-900'}`}>
                  100%
                </td>
              </tr>
              {frequencyDistribution.map((item) => {
                const percentage = totalResponding > 0 ? Math.round((item.count / totalResponding) * 100) : 0;
                return (
                  <tr key={item.value} className="border-b border-gray-200 hover:bg-gray-50">
                    <td className="px-4 py-2 text-sm text-gray-900 border-r border-gray-200">
                      {item.value}
                    </td>
                    <td className="px-2 py-2 text-sm text-center text-gray-900 border-r border-gray-200">
                      {formatNumber(item.count)}
                    </td>
                    <td className="px-2 py-2 text-sm text-center text-gray-900">
                      {percentage}%
                    </td>
                  </tr>
                );
              })}
              {/* Selected stats rows */}
              {selectedStats.map((stat) => {
                const statValue = stats[stat.key];
                let displayValue: string = '-';
                
                if (statValue !== undefined && statValue !== null && !isNaN(statValue)) {
                  if (stat.key === 'mean' || stat.key === 'meanNoOutliers' || stat.key === 'median' || stat.key === 'stdDev') {
                    displayValue = statValue.toFixed(2);
                  } else if (stat.key === 'mode' || stat.key === 'min' || stat.key === 'max' || stat.key === 'sum' || stat.key === 'sumNoOutliers') {
                    displayValue = Math.round(statValue).toString();
                  } else {
                    displayValue = statValue.toFixed(2);
                  }
                }
                
                return (
                  <tr key={stat.key} className="bg-gray-50 border-b border-gray-200">
                    <td className="px-4 py-2 text-sm font-semibold text-gray-900 border-r border-gray-200">
                      {stat.label}
                    </td>
                    <td className="px-2 py-2 text-sm text-center text-gray-900 font-medium border-r border-gray-200">
                      {displayValue}
                    </td>
                    <td className="px-2 py-2 text-sm text-center text-gray-900 font-medium">
                      -
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    );
  };
  // Get open end response counts for a specific variable name
  const getOpenEndResponseCountsForVariable = (targetVariableName: string): Array<{ text: string; count: number }> => {
    if (!getVariableDataByExpectedHeader) return [];
    
    const variableData = getVariableDataByExpectedHeader(targetVariableName);
    if (!variableData || !variableData.values) return [];
    
    // First, count all responses
    const rawCounts: Record<string, number> = {};
    const responseTexts: string[] = [];
    
    variableData.values.forEach((value: any) => {
      if (value === null || value === undefined || value === '') return;
      
      const text = String(value).trim();
      if (text === '') return;
      
      if (!rawCounts[text]) {
        responseTexts.push(text);
      }
      rawCounts[text] = (rawCounts[text] || 0) + 1;
    });
    
    // Group similar responses
    const grouped: Array<{ text: string; count: number; originalTexts: string[] }> = [];
    const processed = new Set<string>();
    
    responseTexts.forEach(text => {
      if (processed.has(text)) return;
      
      // Find all similar responses
      const similarTexts: string[] = [text];
      let totalCount = rawCounts[text];
      
      // Use the most common spelling as the representative text
      let representativeText = text;
      let maxCount = rawCounts[text];
      
      responseTexts.forEach(otherText => {
        if (otherText === text || processed.has(otherText)) return;
        
        if (areSimilar(text, otherText)) {
          similarTexts.push(otherText);
          totalCount += rawCounts[otherText];
          
          // Use the text with the highest count as representative
          if (rawCounts[otherText] > maxCount) {
            maxCount = rawCounts[otherText];
            representativeText = otherText;
          }
        }
      });
      
      // Mark all similar texts as processed
      similarTexts.forEach(t => processed.add(t));
      
      grouped.push({
        text: representativeText,
        count: totalCount,
        originalTexts: similarTexts
      });
    });
    
    // Sort by count (descending) and return
    return grouped
      .map(({ text, count }) => ({ text, count }))
      .sort((a, b) => b.count - a.count);
  };
  // Render actual table for open end individual tables
  const renderOpenEndTable = (option: TableOption) => {
    const isOpenEndType = typeLower.includes('open end') && !typeLower.includes('list');
    if (option.type !== 'individual' || !isOpenEndType) {
      return null;
    }
    const totalResponding = countRespondentsWithData(variableName, getVariableDataByExpectedHeader);
    const responseCounts = getOpenEndResponseCounts();
    markTableData(totalResponding > 0);
    
    // Check if sort by frequency is enabled (open ends default to true)
    const sortState = variableSortByFrequency[variableName];
    const isSortedByFrequency = sortState !== undefined ? sortState : true;
    
    // Sort by count if enabled (already sorted by default, but allow disabling)
    let sortedResponses = isSortedByFrequency
      ? [...responseCounts].sort((a, b) => b.count - a.count)
      : responseCounts;
    
    // Get selected stats (open ends typically don't show stats, but check anyway)
    const availableStats = getStatsForTableType(option.type, variable);
    const selectedStats = availableStats.filter(stat => statsSelections?.[stat.key]);
    return (
      <div key={option.id} className="border border-gray-300 rounded-lg overflow-hidden bg-white">
        <div className="overflow-x-auto">
          <table className="w-full border-collapse">
            <colgroup>
              <col className="w-auto" />
              <col className="w-20" />
              <col className="w-20" />
            </colgroup>
            <thead>
              <tr className="bg-gray-200 border-b border-gray-200">
                <th className="px-4 py-2 text-left text-xs font-semibold text-gray-700 uppercase tracking-wider border-r border-gray-200">
                </th>
                <th className="px-2 py-2 text-center text-xs font-semibold text-gray-700 uppercase tracking-wider border-r border-gray-200">
                  Count
                </th>
                <th className="px-2 py-2 text-center text-xs font-semibold text-gray-700 uppercase tracking-wider">
                  %
                </th>
              </tr>
            </thead>
            <tbody>
              <tr className="bg-gray-50 border-b border-gray-200">
                <td className={`px-4 py-2 text-sm font-semibold border-r border-gray-200 ${totalResponding === 0 ? 'text-red-600' : 'text-gray-900'}`}>
                  Base (total responding)
                </td>
                <td className={`px-2 py-2 text-sm text-center font-medium border-r border-gray-200 ${totalResponding === 0 ? 'text-red-600' : 'text-gray-900'}`}>
                  {formatNumber(totalResponding)}
                </td>
                <td className={`px-2 py-2 text-sm text-center font-medium ${totalResponding === 0 ? 'text-red-600' : 'text-gray-900'}`}>
                  100%
                </td>
              </tr>
              {sortedResponses.map((response, idx) => {
                const percentage = totalResponding > 0 ? Math.round((response.count / totalResponding) * 100) : 0;
                return (
                  <tr key={`openend-${idx}`} className="border-b border-gray-200 hover:bg-gray-50">
                    <td className="px-4 py-2 text-sm text-gray-900 border-r border-gray-200">
                      {response.text}
                    </td>
                    <td className="px-2 py-2 text-sm text-center text-gray-900 border-r border-gray-200">
                      {formatNumber(response.count)}
                    </td>
                    <td className="px-2 py-2 text-sm text-center text-gray-900">
                      {percentage}%
                    </td>
                  </tr>
                );
              })}
              {/* Selected stats rows */}
              {selectedStats.map((stat) => {
                let value: number | string = 0;
                let displayValue: string = '-';
                
                // For open ends, stats are typically not applicable, but show if available
                const variableData = getVariableDataByExpectedHeader?.(variableName);
                if (variableData) {
                  const statValue = variableData[stat.key];
                  if (statValue !== undefined && statValue !== null) {
                    value = statValue;
                    if (typeof value === 'number') {
                      if (stat.key === 'mode' || stat.key === 'min' || stat.key === 'max' || stat.key === 'sum' || stat.key === 'sumNoOutliers') {
                        displayValue = formatNumber(Math.round(value));
                      } else {
                        displayValue = formatNumber(value.toFixed(2));
                      }
                    } else {
                      displayValue = String(value);
                    }
                  }
                }
                
                return (
                  <tr key={stat.key} className="bg-gray-50 border-b border-gray-200">
                    <td className="px-4 py-2 text-sm font-semibold text-gray-900 border-r border-gray-200">
                      {stat.label}
                    </td>
                    <td className="px-2 py-2 text-sm text-center text-gray-900 font-medium border-r border-gray-200">
                      {displayValue}
                    </td>
                    <td className="px-2 py-2 text-sm text-center text-gray-900 font-medium">
                      -
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    );
  };
  // Render actual table for open-end list summary tables
  const renderOpenEndListSummaryTable = (option: TableOption) => {
    if (option.type !== 'summary' || !isOpenEndListType) {
      return null;
    }
    
    // Extract response option code from option ID (e.g., "S12_r1_FrequencyDistributionTable" -> "r1")
    // The format is: {variableName}_{code}_FrequencyDistributionTable
    const codeMatch = option.id.match(/_(r\d+|c\d+)_FrequencyDistributionTable$/i);
    if (!codeMatch) return null;
    
    const responseOptionCode = codeMatch[1]; // e.g., "r1" or "c1"
    
    // Get base question number
    const baseQuestionNumber = getBaseQuestionNumber(variableName);
    const baseNum = baseQuestionNumber.replace(/^Q/i, '');
    
    // Construct expected header (e.g., Q12r1, Q12r2, etc.)
    // For open-end lists, expected headers use "r" prefix (r1, r2, etc.)
    // Extract numeric part from code (r1 -> 1, c1 -> 1)
    const rowNum = responseOptionCode.replace(/[^0-9]/g, '');
    // Always use "r" prefix for open-end list expected headers
    const expectedHeader = `Q${baseNum}r${rowNum}`;
    
    // Get response option name/label
    let responseOptionName = responseOptionCode;
    if (variable && variable.codes && variable.codes[responseOptionCode]) {
      responseOptionName = String(variable.codes[responseOptionCode]);
    } else {
      // Try to get from questionnaire
      const matchingQuestion = questionnaireQuestions.find(question => {
        const qNum = question.number || question.id;
        if (!qNum) return false;
        const qNumStr = String(qNum);
        const normalizedQNum = qNumStr.replace(/^Q/i, '');
        const normalizedBase = baseNum.replace(/^Q/i, '');
        return (
          qNumStr === baseQuestionNumber ||
          normalizedQNum === normalizedBase ||
          `Q${normalizedQNum}` === baseQuestionNumber
        );
      });
      
      if (matchingQuestion && Array.isArray(matchingQuestion.responseOptions)) {
        // Find matching option by index (rowNum) or by code
        const matchingOption = matchingQuestion.responseOptions.find((opt: any, idx: number) => {
          const optCode = typeof opt === 'string' ? `r${idx + 1}` : (opt.code || `r${idx + 1}`);
          const optRowNum = optCode.replace(/[^0-9]/g, '');
          return optCode.toLowerCase() === responseOptionCode.toLowerCase() || 
                 optRowNum === rowNum ||
                 String(idx + 1) === rowNum;
        });
        
        if (matchingOption) {
          responseOptionName = typeof matchingOption === 'string' 
            ? matchingOption 
            : (matchingOption.text || matchingOption.label || matchingOption.value || responseOptionCode);
        }
      }
    }
    
    // Get data for this specific response option
    const totalResponding = countRespondentsWithData(expectedHeader, getVariableDataByExpectedHeader);
    const responseCounts = getOpenEndResponseCountsForVariable(expectedHeader);
    const noDataNotice = totalResponding === 0 ? renderNoDataBanner(option.id) : null;
    
    // Check if sort by frequency is enabled (open ends default to true)
    const sortState = variableSortByFrequency[variableName];
    const isSortedByFrequency = sortState !== undefined ? sortState : true;
    
    // Sort by count if enabled
    let sortedResponses = isSortedByFrequency
      ? [...responseCounts].sort((a, b) => b.count - a.count)
      : responseCounts;
    
    const overrideLabel = columnHeaderOverrides?.[responseOptionName || ''] || columnHeaderOverrides?.[option.label] || columnHeaderOverrides?.[option.code];
    const headerLabel = overrideLabel || responseOptionName || option.label;
    markTableData(totalResponding > 0);
    return (
      <div key={option.id} className="border border-gray-300 rounded-lg overflow-hidden bg-white">
        {noDataNotice}
        <div className="overflow-x-auto">
          <table className="w-full border-collapse">
            <colgroup>
              <col className="w-auto" />
              <col className="w-20" />
              <col className="w-20" />
            </colgroup>
            <thead>
              <tr className="bg-gray-200 border-b border-gray-200">
                <th className="px-4 py-2 text-left text-xs font-semibold text-gray-700 uppercase tracking-wider border-r border-gray-200">
                  {split.length >= 2 ? split.slice(0, -1).join(' - ') : headerLabel}
                </th>
                <th className="px-2 py-2 text-center text-xs font-semibold text-gray-700 uppercase tracking-wider border-r border-gray-200">
                  Count
                </th>
                <th className="px-2 py-2 text-center text-xs font-semibold text-gray-700 uppercase tracking-wider">
                  %
                </th>
              </tr>
            </thead>
            <tbody>
              <tr className="bg-gray-50 border-b border-gray-200">
                <td className={`px-4 py-2 text-sm font-semibold border-r border-gray-200 ${totalResponding === 0 ? 'text-red-600' : 'text-gray-900'}`}>
                  Base (total responding)
                </td>
                <td className={`px-2 py-2 text-sm text-center font-medium border-r border-gray-200 ${totalResponding === 0 ? 'text-red-600' : 'text-gray-900'}`}>
                  {formatNumber(totalResponding)}
                </td>
                <td className={`px-2 py-2 text-sm text-center font-medium ${totalResponding === 0 ? 'text-red-600' : 'text-gray-900'}`}>
                  100%
                </td>
              </tr>
              {sortedResponses.map((response, idx) => {
                const percentage = totalResponding > 0 ? Math.round((response.count / totalResponding) * 100) : 0;
                return (
                  <tr key={`openendlist-${idx}`} className="border-b border-gray-200 hover:bg-gray-50">
                    <td className="px-4 py-2 text-sm text-gray-900 border-r border-gray-200">
                      {response.text}
                    </td>
                    <td className="px-2 py-2 text-sm text-center text-gray-900 border-r border-gray-200">
                      {formatNumber(response.count)}
                    </td>
                    <td className="px-2 py-2 text-sm text-center text-gray-900">
                      {percentage}%
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    );
  };
  const renderTableBox = (option: TableOption) => {
    // For single select individual tables, render actual table instead of placeholder
    if (option.type === 'individual' && isSingleSelect && !isSingleSelectGrid) {
      return renderSingleSelectTable(option);
    }
    
    // For single select grid individual tables, render actual table instead of placeholder
    if (option.type === 'individual' && isSingleSelectGrid) {
      return renderSingleSelectGridTable(option);
    }
    
    // For multi-select individual tables, render actual table instead of placeholder
    if (option.type === 'individual' && isMultiSelect && !isMultiSelectGrid) {
      return renderMultiSelectTable(option);
    }
    
    // For numeric individual tables, render actual table instead of placeholder
    if (option.type === 'individual') {
      const isNumericQuestion = typeLower.includes('numeric') && !typeLower.includes('grid') && !typeLower.includes('list');
      const isNumericGrid = typeLower.includes('numeric grid');
      if (isNumericQuestion || isNumericGrid) {
        return renderNumericTable(option);
      }
    }
    
    // For open end individual tables, render actual table instead of placeholder
    if (option.type === 'individual') {
      const isOpenEndType = typeLower.includes('open end') && !typeLower.includes('list');
      if (isOpenEndType) {
        return renderOpenEndTable(option);
      }
    }
    
    // For numeric grid summary tables, render actual table instead of placeholder
    if (option.type === 'summary' && isNumericGrid) {
      return renderNumericGridSummaryTable(option);
    }
    
    // For single select grid summary tables, render actual table instead of placeholder
    if (option.type === 'summary' && isSingleSelectGrid) {
      return renderSingleSelectGridSummaryTable(option);
    }
    
    // For multi-select grid summary tables, render actual table instead of placeholder
    if (option.type === 'summary' && isMultiSelectGrid) {
      return renderMultiSelectGridSummaryTable(option);
    }
    
    // For open-end list summary tables, render actual table instead of placeholder
    if (option.type === 'summary' && isOpenEndListType) {
      return renderOpenEndListSummaryTable(option);
    }
    const availableStats = getStatsForTableType(option.type, variable);
    const isTableSelected = variableTableSelections[variableName]?.has(option.id) || false;
    
    // Check if sorting is available (typeLower already defined above)
    const isNumericQuestion = typeLower.includes('numeric') && !typeLower.includes('grid') && !typeLower.includes('list');
    const isOpenEndType = typeLower.includes('open end') && !typeLower.includes('list');
    const isMultiSelectType = isMultiSelect || isMultiSelectGrid;
    
    // Sorting is available for:
    // 1. Individual tables (not numeric questions or numeric grids) - always show when available
    // 2. Summary tables - always show (all summary tables have sort option, like in TableSelector)
    const isSortAvailableForIndividual = option.type === 'individual' && !isNumericQuestion && !isNumericGrid;
    const isSortAvailableForSummary = option.type === 'summary';
    const isSortAvailable = isSortAvailableForIndividual || isSortAvailableForSummary;
    
    // Determine if sort is enabled
    let isSortEnabled = false;
    if (isSortAvailableForIndividual) {
      // For individual tables: check variableSortByFrequency state, with defaults
      // Open-end types always have sort ON, multi-select defaults to ON
      const defaultSortByFrequency = isMultiSelectType || isOpenEndType;
      const sortState = variableSortByFrequency[variableName];
      isSortEnabled = isOpenEndType 
        ? true 
        : (sortState !== undefined ? sortState : defaultSortByFrequency);
    } else if (isSortAvailableForSummary) {
      // For summary tables: use summaryTableSortSelections with inverted logic for defaults
      // This matches the logic in TableSelector.tsx line 120-121
      const sortSet = summaryTableSortSelections[variableName];
      if (summarySortDefaultsToOn) {
        // Sort defaults to ON (for multi-select grids), so it's ON if NOT in the set (inverted logic)
        isSortEnabled = !sortSet?.has(option.id);
      } else {
        // Sort defaults to OFF (for numeric grids, single select grids, etc.), so it's ON if IN the set
        isSortEnabled = sortSet?.has(option.id) || false;
      }
    }
    
    return (
      <div
        key={option.id}
        className={`border-2 border-dashed rounded-lg p-4 transition-colors ${
          isTableSelected
            ? 'border-green-300 bg-green-50 hover:bg-green-100'
            : 'border-gray-300 bg-gray-50 hover:bg-gray-100'
        }`}
      >
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium text-gray-700">{option.label}</span>
            {isSortAvailable && (
              <span className={`text-xs px-2 py-0.5 rounded-full ${
                isSortEnabled
                  ? 'bg-green-100 text-green-700 border border-green-200'
                  : 'bg-gray-100 text-gray-500 border border-gray-200'
              }`}>
                Sort
              </span>
            )}
          </div>
          <div className="flex items-center gap-2">
            {option.pill && (
              <span className="text-xs px-2 py-1 rounded-full bg-blue-50 text-blue-700 border border-blue-100">
                {option.pill}
              </span>
            )}
            <span className={`text-xs px-2 py-1 rounded ${
              option.type === 'summary' ? 'bg-purple-100 text-purple-700' :
              option.type === 'net' ? 'bg-green-100 text-green-700' :
              'bg-blue-100 text-blue-700'
            }`}>
              {option.type === 'summary' ? 'Summary' : option.type === 'net' ? 'Net' : 'Individual'}
            </span>
          </div>
        </div>
        {(availableStats.length > 0 || (option.type === 'individual' && isSingleSelect && !isSingleSelectGrid && netsForVariable.length > 0)) && (
          <div className="flex flex-wrap gap-1.5 mt-2">
            {availableStats.map((stat) => {
              const isSelected = statsSelections?.[stat.key] || false;
              return (
                <span
                  key={stat.key}
                  className={`text-xs px-2 py-0.5 rounded-full ${
                    isSelected
                      ? 'bg-green-100 text-green-700 border border-green-200'
                      : 'bg-gray-100 text-gray-500 border border-gray-200'
                  }`}
                >
                  {stat.label}
                </span>
              );
            })}
            {/* Show selected nets as green stat pills for single select individual tables */}
            {option.type === 'individual' && isSingleSelect && !isSingleSelectGrid && netsForVariable.map((net, idx) => {
              const tableId = `${variableName}_NetSummaryTable_${idx}`;
              const isNetSelected = variableTableSelections[variableName]?.has(tableId) || false;
              // Only show nets that are selected
              if (!isNetSelected) return null;
              return (
                <span
                  key={`net-${idx}`}
                  className="text-xs px-2 py-0.5 rounded-full bg-green-100 text-green-700 border border-green-200"
                >
                  {net.name || `Net ${idx + 1}`}
                </span>
              );
            })}
          </div>
        )}
      </div>
    );
  };
  const summaryContent = summaryTables.length > 0 ? (
    <div>
      <div className="grid grid-cols-1 gap-3">
        {summaryTables.map(renderTableBox)}
      </div>
    </div>
  ) : null;

  const individualContent = individualTables.length > 0 ? (
    <div>
      <div className="grid grid-cols-1 gap-3">
        {individualTables.map(renderTableBox)}
      </div>
    </div>
  ) : null;

  const noDataAcrossTables = anyTableRendered && !anyTableHasData;

  React.useEffect(() => {
    if (!onTablesNoData) return;
    if (!variableName) return;
    onTablesNoData(variableName, noDataAcrossTables);
  }, [onTablesNoData, variableName, noDataAcrossTables]);

  if (noDataAcrossTables) {
    return renderNoDataBanner(undefined, 'No data found for these tables - bases are 0 across all rows/columns. Upload or map data for this question to see tables.');
  }

  // Show numeric grid no-data banner if bases are all 0
  if (isNumericGrid && !numericGridHasData) {
    return (
      <div className="border border-red-200 bg-red-50 text-red-700 px-4 py-3 rounded">
        No data found for this numeric grid - bases are 0 across all columns/rows. Upload or map data for this question to see tables.
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {summaryContent}
      {individualContent}
    </div>
  );
};
