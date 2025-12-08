import React from 'react';
import { Variable, VariableStatsSelection } from '../../utils/tabs/types';
import { TableOption } from '../../utils/tabs/tableOptions';
import { getBaseQuestionNumber } from '../../utils/tabs/questionHelpers';

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

// Helper function to count respondents with data for a variable
const countRespondentsWithData = (
  variableName: string,
  getVariableDataByExpectedHeader?: (expectedHeader: string) => any
): number => {
  if (!getVariableDataByExpectedHeader) return 0;
  
  const variableData = getVariableDataByExpectedHeader(variableName);
  if (!variableData || !variableData.values) return 0;
  
  // Count non-null, non-empty values
  return variableData.values.filter((v: any) => 
    v !== null && 
    v !== undefined && 
    v !== '' && 
    !(typeof v === 'string' && v.trim() === '')
  ).length;
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
}) => {
  if (!variable || tableOptions.length === 0) {
    return (
      <div className="text-center py-12 text-gray-500">
        {variable ? 'No tables available for this variable' : 'Select a variable to view tables'}
      </div>
    );
  }

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

  // Group table options by type - Summary first, then Individual
  // Filter tables to only show selected ones
  // Get nets for single select questions (not shown as separate tables, but as stat pills)
  const variableName = variable?.name || '';
  
  // Filter tables to only show selected ones
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
  const typeLower = variable?.type?.toLowerCase() || '';
  const isSingleSelect = typeLower.includes('single select') && !typeLower.includes('grid');
  const isSingleSelectGrid = typeLower.includes('single select grid');
  const isMultiSelect = typeLower.includes('multi-select') && !typeLower.includes('grid');
  const isMultiSelectGrid = typeLower.includes('multi-select grid');
  const isNumericGrid = typeLower.includes('numeric grid');
  const isOpenEndListType = typeLower.includes('open end list');
  // Get nets for single select questions and single select grids
  const netsForVariable = (isSingleSelect || isSingleSelectGrid)
    ? (netSummaryTableSelectedCodes[variableName] || [])
    : [];

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
    const baseQuestionNumber = getBaseQuestionNumber(variable.name);
    const matchingQuestion = questionnaireQuestions.find(question => {
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
  const getMultiSelectResponseCounts = (responseOptions: Array<{ code: string; text: string }>): Record<string, number> => {
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
      valueToCodeMap[code] = code;
      valueToCodeMap[code.toLowerCase()] = code;
      valueToCodeMap[code.toUpperCase()] = code;
      
      const numericMatch = code.match(/(\d+)$/);
      if (numericMatch) {
        const numericPart = numericMatch[1];
        valueToCodeMap[numericPart] = code;
        valueToCodeMap[String(parseInt(numericPart))] = code;
      }
      
      const codeIndex = responseOptions.findIndex(opt => opt.code === code) + 1;
      valueToCodeMap[String(codeIndex)] = code;
    });
    
    // For multi-select, count all occurrences (values can be arrays or comma-separated)
    variableData.values.forEach((value: any) => {
      if (value === null || value === undefined || value === '') return;
      
      // Handle array values
      if (Array.isArray(value)) {
        value.forEach((item: any) => {
          if (item === null || item === undefined || item === '') return;
          const valueStr = String(item).trim();
          if (valueStr === '') return;
          
          if (valueToCodeMap.hasOwnProperty(valueStr)) {
            const matchedCode = valueToCodeMap[valueStr];
            if (counts.hasOwnProperty(matchedCode)) {
              counts[matchedCode]++;
            }
            return;
          }
          
          const lowerValue = valueStr.toLowerCase();
          if (valueToCodeMap.hasOwnProperty(lowerValue)) {
            const matchedCode = valueToCodeMap[lowerValue];
            if (counts.hasOwnProperty(matchedCode)) {
              counts[matchedCode]++;
            }
            return;
          }
          
          const numericValue = parseFloat(valueStr);
          if (!isNaN(numericValue)) {
            const numericStr = String(Math.round(numericValue));
            if (valueToCodeMap.hasOwnProperty(numericStr)) {
              const matchedCode = valueToCodeMap[numericStr];
              if (counts.hasOwnProperty(matchedCode)) {
                counts[matchedCode]++;
              }
            }
          }
        });
        return;
      }
      
      // Handle comma-separated string values
      const valueStr = String(value).trim();
      if (valueStr === '') return;
      
      // Check if it's comma-separated
      if (valueStr.includes(',')) {
        const parts = valueStr.split(',').map(p => p.trim()).filter(p => p !== '');
        parts.forEach(part => {
          if (valueToCodeMap.hasOwnProperty(part)) {
            const matchedCode = valueToCodeMap[part];
            if (counts.hasOwnProperty(matchedCode)) {
              counts[matchedCode]++;
            }
            return;
          }
          
          const lowerValue = part.toLowerCase();
          if (valueToCodeMap.hasOwnProperty(lowerValue)) {
            const matchedCode = valueToCodeMap[lowerValue];
            if (counts.hasOwnProperty(matchedCode)) {
              counts[matchedCode]++;
            }
            return;
          }
          
          const numericValue = parseFloat(part);
          if (!isNaN(numericValue)) {
            const numericStr = String(Math.round(numericValue));
            if (valueToCodeMap.hasOwnProperty(numericStr)) {
              const matchedCode = valueToCodeMap[numericStr];
              if (counts.hasOwnProperty(matchedCode)) {
                counts[matchedCode]++;
              }
            }
          }
        });
        return;
      }
      
      // Single value (same logic as single-select)
      if (valueToCodeMap.hasOwnProperty(valueStr)) {
        const matchedCode = valueToCodeMap[valueStr];
        if (counts.hasOwnProperty(matchedCode)) {
          counts[matchedCode]++;
        }
        return;
      }
      
      const lowerValue = valueStr.toLowerCase();
      if (valueToCodeMap.hasOwnProperty(lowerValue)) {
        const matchedCode = valueToCodeMap[lowerValue];
        if (counts.hasOwnProperty(matchedCode)) {
          counts[matchedCode]++;
        }
        return;
      }
      
      const numericValue = parseFloat(valueStr);
      if (!isNaN(numericValue)) {
        const numericStr = String(Math.round(numericValue));
        if (valueToCodeMap.hasOwnProperty(numericStr)) {
          const matchedCode = valueToCodeMap[numericStr];
          if (counts.hasOwnProperty(matchedCode)) {
            counts[matchedCode]++;
          }
        }
      }
    });
    
    return counts;
  };

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

    // Get selected stats (single select grids only show mean)
    const availableStats = getStatsForTableType(option.type, variable);
    const selectedStats = availableStats.filter(stat => statsSelections?.[stat.key]);
    
    // Get selected nets for this variable (filter by what's checked in tab specs)
    const selectedNets = netsForVariable.filter((net, idx) => {
      const tableId = `${variableName}_NetSummaryTable_${idx}`;
      return variableTableSelections[variableName]?.has(tableId) || false;
    });

    return (
      <div key={option.id} className="border border-gray-300 rounded-lg overflow-hidden bg-white">
        {statementName && (
          <div className="bg-gray-50 border-b border-gray-200 px-4 py-2">
            <h4 className="text-sm font-semibold text-gray-900">{statementName}</h4>
          </div>
        )}
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

    const totalResponding = countRespondentsWithData(variableName, getVariableDataByExpectedHeader);
    const responseOptions = getResponseOptions();
    const responseCounts = getMultiSelectResponseCounts(responseOptions);
    
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
              {sortedResponseOptions.map((opt) => {
                const count = responseCounts[opt.code] || 0;
                const percentage = totalResponding > 0 ? Math.round((count / totalResponding) * 100) : 0;
                const isMapped = isResponseOptionMapped(opt.code);
                return (
                  <tr 
                    key={opt.code} 
                    className={`border-b border-gray-200 hover:bg-gray-50 ${!isMapped ? 'bg-yellow-50' : ''}`}
                  >
                    <td className="px-4 py-2 text-sm text-gray-900 border-r border-gray-200">
                      <div className="flex items-center justify-between">
                        <span>{opt.text}</span>
                        {!isMapped && (
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
    
    // First try variable.statements
    if (variable.statements && Object.keys(variable.statements).length > 0) {
      return Object.entries(variable.statements).map(([code, text]) => ({
        code,
        text: String(text || code),
      }));
    }
    
    // Fallback to questionnaireQuestions
    const baseQuestionNumber = getBaseQuestionNumber(variable.name);
    const matchingQuestion = questionnaireQuestions.find(question => {
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

  // Calculate mean or sum for a numeric grid statement across all columns (with optional outlier removal)
  const calculateNumericGridSummaryForStatement = (
    statementCode: string,
    summaryType: 'mean' | 'sum' | 'meanNoOutliers' | 'sumNoOutliers'
  ): number => {
    if (!getVariableDataByExpectedHeader) return 0;
    
    const baseQuestionNumber = getBaseQuestionNumber(variableName);
    const allValues: number[] = [];
    
    // Get all column codes from variable.codes or responseOptions
    const columnCodes: string[] = [];
    if (variable && variable.codes && Object.keys(variable.codes).length > 0) {
      columnCodes.push(...Object.keys(variable.codes));
    } else {
      // Fallback: try to get from responseOptions
      const responseOptions = getResponseOptions();
      responseOptions.forEach(opt => {
        if (opt.code.startsWith('c') || /^\d+$/.test(opt.code)) {
          columnCodes.push(opt.code);
        }
      });
    }
    
    // For each column, get the statement's data and collect all values
    columnCodes.forEach(columnCode => {
      const possibleVariableNames = [
        `${baseQuestionNumber}_${statementCode}_${columnCode}`,
        `${baseQuestionNumber}${statementCode}${columnCode}`,
        `${baseQuestionNumber}_${statementCode}_${columnCode.replace(/^c/i, '')}`,
        `${baseQuestionNumber}${statementCode}${columnCode.replace(/^c/i, '')}`,
      ];
      
      for (const varName of possibleVariableNames) {
        const data = getVariableDataByExpectedHeader?.(varName);
        if (data && data.values) {
          data.values.forEach((value: any) => {
            if (value === null || value === undefined || value === '') return;
            const numValue = parseFloat(String(value));
            if (!isNaN(numValue)) {
              allValues.push(numValue);
            }
          });
          break;
        }
      }
    });
    
    if (allValues.length === 0) return 0;
    
    // For outlier removal, calculate mean and std dev first, then filter
    if (summaryType === 'meanNoOutliers' || summaryType === 'sumNoOutliers') {
      const sum = allValues.reduce((acc, val) => acc + val, 0);
      const mean = sum / allValues.length;
      
      // Calculate standard deviation
      const variance = allValues.reduce((acc, val) => acc + Math.pow(val - mean, 2), 0) / allValues.length;
      const stdDev = Math.sqrt(variance);
      
      // Filter values within 2 standard deviations from mean
      const valuesNoOutliers = allValues.filter(val => Math.abs(val - mean) <= 2 * stdDev);
      
      if (valuesNoOutliers.length === 0) {
        // If no values remain, return 0
        return 0;
      }
      
      if (summaryType === 'meanNoOutliers') {
        const sumNoOutliers = valuesNoOutliers.reduce((acc, val) => acc + val, 0);
        return sumNoOutliers / valuesNoOutliers.length;
      } else {
        // sumNoOutliers
        return valuesNoOutliers.reduce((acc, val) => acc + val, 0);
      }
    }
    
    // Regular mean or sum
    if (summaryType === 'mean') {
      const sum = allValues.reduce((acc, val) => acc + val, 0);
      return sum / allValues.length;
    } else {
      // sum
      return allValues.reduce((acc, val) => acc + val, 0);
    }
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
    
    const summaryType = isMeanSummary ? 'mean' : 
                       isSumSummary ? 'sum' :
                       isMeanNoOutliersSummary ? 'meanNoOutliers' : 'sumNoOutliers';
    const statements = getStatements();
    if (statements.length === 0) return null;
    
    // Calculate total responding (anyone who answered at least one statement)
    let totalResponding = 0;
    const respondentSet = new Set<number>();
    
    statements.forEach(stmt => {
      const baseQuestionNumber = getBaseQuestionNumber(variableName);
      const columnCodes: string[] = [];
      if (variable && variable.codes && Object.keys(variable.codes).length > 0) {
        columnCodes.push(...Object.keys(variable.codes));
      } else {
        const responseOptions = getResponseOptions();
        responseOptions.forEach(opt => {
          if (opt.code.startsWith('c') || /^\d+$/.test(opt.code)) {
            columnCodes.push(opt.code);
          }
        });
      }
      
      columnCodes.forEach(columnCode => {
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
              const numValue = parseFloat(String(value));
              if (!isNaN(numValue)) {
                respondentSet.add(idx);
              }
            });
            break;
          }
        }
      });
    });
    
    totalResponding = respondentSet.size;
    
    // Calculate summary values and base for each statement
    const statementSummaries = statements.map(stmt => {
      const baseQuestionNumber = getBaseQuestionNumber(variableName);
      const columnCodes: string[] = [];
      if (variable && variable.codes && Object.keys(variable.codes).length > 0) {
        columnCodes.push(...Object.keys(variable.codes));
      } else {
        const responseOptions = getResponseOptions();
        responseOptions.forEach(opt => {
          if (opt.code.startsWith('c') || /^\d+$/.test(opt.code)) {
            columnCodes.push(opt.code);
          }
        });
      }
      
      // Calculate base for this statement (anyone who answered any column for this statement)
      let statementBase = 0;
      let adjustedBase = 0;
      
      // For outlier-removed tables, we need to calculate which respondents have outliers
      if (summaryType === 'meanNoOutliers' || summaryType === 'sumNoOutliers') {
        // First, collect all values for this statement across all columns
        const allValuesForStatement: Array<{ value: number; respondentIndex: number }> = [];
        
        columnCodes.forEach(columnCode => {
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
                const numValue = parseFloat(String(value));
                if (!isNaN(numValue)) {
                  allValuesForStatement.push({ value: numValue, respondentIndex: idx });
                }
              });
              break;
            }
          }
        });
        
        if (allValuesForStatement.length > 0) {
          // Calculate mean and std dev for this statement
          const values = allValuesForStatement.map(item => item.value);
          const sum = values.reduce((acc, val) => acc + val, 0);
          const mean = sum / values.length;
          const variance = values.reduce((acc, val) => acc + Math.pow(val - mean, 2), 0) / values.length;
          const stdDev = Math.sqrt(variance);
          
          // Find respondents who have at least one non-outlier value
          const respondentsWithNonOutliers = new Set<number>();
          allValuesForStatement.forEach(({ value, respondentIndex }) => {
            if (Math.abs(value - mean) <= 2 * stdDev) {
              respondentsWithNonOutliers.add(respondentIndex);
            }
          });
          
          statementBase = new Set(allValuesForStatement.map(item => item.respondentIndex)).size;
          adjustedBase = respondentsWithNonOutliers.size;
        } else {
          statementBase = 0;
          adjustedBase = 0;
        }
      } else {
        // For regular tables, use the original base calculation
        const statementRespondentSet = new Set<number>();
        
        columnCodes.forEach(columnCode => {
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
                const numValue = parseFloat(String(value));
                if (!isNaN(numValue)) {
                  statementRespondentSet.add(idx);
                }
              });
              break;
            }
          }
        });
        
        statementBase = statementRespondentSet.size;
        adjustedBase = statementBase;
      }
      
      return {
        code: stmt.code,
        text: stmt.text,
        value: calculateNumericGridSummaryForStatement(stmt.code, summaryType),
        base: adjustedBase, // Use adjusted base for outlier-removed tables, original base for others
      };
    });
    
    // Calculate total of all values for percentage calculation (only used for sum tables)
    const totalValue = statementSummaries.reduce((sum, stmt) => sum + stmt.value, 0);
    
    // Check if all bases are equal
    const allBasesEqual = statementSummaries.length > 0 && 
      statementSummaries.every(stmt => stmt.base === statementSummaries[0].base);
    
    // Check if this is a mean summary table (mean or meanNoOutliers)
    const isMeanSummaryTable = summaryType === 'mean' || summaryType === 'meanNoOutliers';
    
    // Check if sort by frequency is enabled (numeric grids don't default to sort)
    const sortState = variableSortByFrequency[variableName];
    const isSortedByFrequency = sortState !== undefined ? sortState : false;
    
    // Sort statements by value (descending) if sort by frequency is enabled
    let sortedStatements = isSortedByFrequency
      ? [...statementSummaries].sort((a, b) => b.value - a.value)
      : statementSummaries;
    
    // Apply hold ordering if hold codes are selected
    if (isSortedByFrequency && variableHoldResponseCodes[variableName] && variableHoldResponseCodes[variableName].length > 0) {
      const holdList = variableHoldResponseCodes[variableName];
      const holdSet = new Set(holdList);
      const remaining: typeof statementSummaries = [];
      const held: typeof statementSummaries = [];
      
      sortedStatements.forEach(stmt => {
        if (holdSet.has(stmt.code)) {
          held.push(stmt);
        } else {
          remaining.push(stmt);
        }
      });
      
      // Held items go at the bottom, maintaining their order from holdList
      const heldOrdered: typeof statementSummaries = [];
      holdList.forEach(code => {
        const match = held.find(stmt => stmt.code === code);
        if (match) {
          heldOrdered.push(match);
        }
      });
      
      sortedStatements = [...remaining, ...heldOrdered];
    }

    const tableName = summaryType === 'mean' ? 'Mean Summary' : 
                     summaryType === 'sum' ? 'Sum Summary' :
                     summaryType === 'meanNoOutliers' ? 'Mean (Outliers Removed) Summary' : 
                     'Sum (Outliers Removed) Summary';

    return (
      <div key={option.id} className="border border-gray-300 rounded-lg overflow-hidden bg-white">
        <div className="bg-gray-50 border-b border-gray-200 px-4 py-2">
          <h4 className="text-sm font-semibold text-gray-900">{tableName}</h4>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full border-collapse">
            <colgroup>
              <col className="w-auto" />
              <col className="w-20" />
              {!isMeanSummaryTable && <col className="w-20" />}
            </colgroup>
            <thead>
              <tr className="bg-gray-200 border-b border-gray-200">
                <th className="px-4 py-2 text-left text-xs font-semibold text-gray-700 uppercase tracking-wider border-r border-gray-200">
                </th>
                <th className={`px-2 py-2 text-center text-xs font-semibold text-gray-700 uppercase tracking-wider ${!isMeanSummaryTable ? 'border-r border-gray-200' : ''}`}>
                  {summaryType === 'mean' || summaryType === 'meanNoOutliers' ? 'Mean' : 'Sum'}
                </th>
                {!isMeanSummaryTable && (
                  <th className="px-2 py-2 text-center text-xs font-semibold text-gray-700 uppercase tracking-wider">
                    %
                  </th>
                )}
              </tr>
            </thead>
            <tbody>
              {isMeanSummaryTable ? (
                // For mean summary tables: show base row above each statement, no % column, no total row
                sortedStatements.map((stmt, index) => {
                  const displayValue = formatNumber(stmt.value.toFixed(2));
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
                })
              ) : (
                // For sum summary tables: show base row above each statement, keep % column and total row
                <>
                  {sortedStatements.map((stmt, index) => {
                    // Calculate percentage: this row's value divided by sum of all values
                    const percentage = totalValue > 0 ? Math.round((stmt.value / totalValue) * 100) : 0;
                    const displayValue = formatNumber(Math.round(stmt.value));
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
                            {displayValue}
                          </td>
                          <td className="px-2 py-2 text-sm text-center text-gray-900">
                            {percentage}%
                          </td>
                        </tr>
                      </React.Fragment>
                    );
                  })}
                  {/* Total row */}
                  <tr className="bg-gray-50 border-b border-gray-200">
                    <td className="px-4 py-2 text-sm font-semibold text-gray-900 border-r border-gray-200">
                      Total
                    </td>
                    <td className="px-2 py-2 text-sm text-center text-gray-900 font-medium border-r border-gray-200">
                      {formatNumber(Math.round(totalValue))}
                    </td>
                    <td className="px-2 py-2 text-sm text-center text-gray-900 font-medium">
                      100%
                    </td>
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
      
      return (
        <div key={option.id} className="border border-gray-300 rounded-lg overflow-hidden bg-white">
          <div className="bg-gray-50 border-b border-gray-200 px-4 py-2">
            <h4 className="text-sm font-semibold text-gray-900">{net.name || `Net ${netIndex + 1}`}</h4>
          </div>
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

    return (
      <div key={option.id} className="border border-gray-300 rounded-lg overflow-hidden bg-white">
        <div className="bg-gray-50 border-b border-gray-200 px-4 py-2">
          <h4 className="text-sm font-semibold text-gray-900">Mean Summary</h4>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full border-collapse">
            <colgroup>
              <col className="w-auto" />
              <col className="w-20" />
            </colgroup>
            <thead>
              <tr className="bg-gray-200 border-b border-gray-200">
                <th className="px-4 py-2 text-left text-xs font-semibold text-gray-700 uppercase tracking-wider border-r border-gray-200">
                </th>
                <th className="px-2 py-2 text-center text-xs font-semibold text-gray-700 uppercase tracking-wider">
                  Mean
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
    
    const statementCounts = getMultiSelectGridSummaryCounts(columnCode, statements);
    
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

    return (
      <div key={option.id} className="border border-gray-300 rounded-lg overflow-hidden bg-white">
        {responseOptionName && (
          <div className="bg-gray-50 border-b border-gray-200 px-4 py-2">
            <h4 className="text-sm font-semibold text-gray-900">{responseOptionName}</h4>
          </div>
        )}
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
    
    // For numeric grids, extract statement code from option ID (e.g., "S14_r1" -> "r1")
    let targetVariableName = variableName;
    let statementName: string | null = null;
    if (isNumericGrid && option.id !== variableName) {
      // This is a statement-specific table
      const statementCodeMatch = option.id.match(/_(r\d+)$/);
      if (statementCodeMatch) {
        const statementCode = statementCodeMatch[1];
        const baseQuestionNumber = getBaseQuestionNumber(variableName);
        // Try different variable name formats
        const possibleNames = [
          `${baseQuestionNumber}_${statementCode}`,
          `${baseQuestionNumber}${statementCode}`,
        ];
        // Use the first one that has data, or default to the first format
        for (const name of possibleNames) {
          const data = getVariableDataByExpectedHeader?.(name);
          if (data && data.values) {
            targetVariableName = name;
            break;
          }
        }
        if (targetVariableName === variableName) {
          targetVariableName = possibleNames[0];
        }
        
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
    const frequencyDistribution = getNumericFrequencyDistribution(targetVariableName);
    const stats = calculateNumericStats(targetVariableName);
    
    // Get selected stats
    const availableStats = getStatsForTableType(option.type, variable);
    const selectedStats = availableStats.filter(stat => statsSelections?.[stat.key]);
    
    return (
      <div key={option.id} className="border border-gray-300 rounded-lg overflow-hidden bg-white">
        {statementName && (
          <div className="bg-gray-50 border-b border-gray-200 px-4 py-2">
            <h4 className="text-sm font-semibold text-gray-900">{statementName}</h4>
          </div>
        )}
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
    
    // Check if sort by frequency is enabled (open ends default to true)
    const sortState = variableSortByFrequency[variableName];
    const isSortedByFrequency = sortState !== undefined ? sortState : true;
    
    // Sort by count if enabled
    let sortedResponses = isSortedByFrequency
      ? [...responseCounts].sort((a, b) => b.count - a.count)
      : responseCounts;
    
    return (
      <div key={option.id} className="border border-gray-300 rounded-lg overflow-hidden bg-white">
        <div className="bg-gray-50 border-b border-gray-200 px-4 py-2">
          <h4 className="text-sm font-semibold text-gray-900">{responseOptionName}</h4>
        </div>
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

  return (
    <div className="space-y-6">
      {/* Summary Tables Section - First */}
      {summaryTables.length > 0 && (
        <div>
          <div className="grid grid-cols-1 gap-3">
            {summaryTables.map(renderTableBox)}
          </div>
        </div>
      )}

      {/* Individual Tables Section */}
      {individualTables.length > 0 && (
        <div>
          <div className="grid grid-cols-1 gap-3">
            {individualTables.map(renderTableBox)}
          </div>
        </div>
      )}

    </div>
  );
};

