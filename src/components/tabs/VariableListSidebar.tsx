import React from 'react';
import { MagnifyingGlassIcon, ArrowPathIcon, FunnelIcon } from '@heroicons/react/24/outline';
import { Variable } from '../../utils/tabs/types';
import { getBaseQuestionNumber } from '../../utils/tabs/questionHelpers';

interface VariableListSidebarProps {
  variables: Variable[];
  filteredVariables: Variable[];
  selectedVariable: string | null;
  onSelect: (variableName: string) => void;
  filter: string;
  onFilterChange: (filter: string) => void;
  questionTypeFilter: string | null;
  onQuestionTypeFilterChange: (filter: string | null) => void;
  showQuestionTypeFilter: boolean;
  onToggleQuestionTypeFilter: () => void;
  loading: boolean;
  loadingFullRawData: boolean;
  getVariableDataByExpectedHeader: (variableName: string) => any;
  questionnaireQuestions: any[];
  columnMapping: Record<string, string>;
  columnHeaders: string[];
  fullRawData: { columns: string[]; rows: any[] } | null;
  datamapData: any;
  dataMappingMemo: {
    filteredHeaders: string[];
    mappingStatusMap: Map<string, { isMapped: boolean; mappedColumnHeader: string; mappedVariableName: string }>;
  } | null;
  hiddenFromBanners: Set<string>;
  getExpectedHeadersForQuestion: (question: any, baseQuestionNumber?: string) => string[];
  convertHiddenVariableToExpectedHeader: (variableName: string) => string;
  netSummaryTableSelectedCodes?: Record<string, Array<{ name: string; codes: string[] }>>;
}

export const VariableListSidebar: React.FC<VariableListSidebarProps> = ({
  variables,
  filteredVariables,
  selectedVariable,
  onSelect,
  filter,
  onFilterChange,
  questionTypeFilter,
  onQuestionTypeFilterChange,
  showQuestionTypeFilter,
  onToggleQuestionTypeFilter,
  loading,
  loadingFullRawData,
  getVariableDataByExpectedHeader,
  questionnaireQuestions,
  columnMapping,
  columnHeaders,
  fullRawData,
  datamapData,
  dataMappingMemo,
  hiddenFromBanners,
  getExpectedHeadersForQuestion,
  convertHiddenVariableToExpectedHeader,
  netSummaryTableSelectedCodes = {},
}) => {
  // Get unique question types from variables
  const uniqueTypes = React.useMemo(() => {
    const types = new Set<string>();
    variables.forEach(v => {
      if (v.type) {
        types.add(v.type);
      }
    });
    return Array.from(types).sort();
  }, [variables]);

  return (
    <div className="w-80 border-r border-gray-200 flex flex-col">
      {/* Sticky header with search bar */}
      <div className="p-4 border-b border-gray-200 bg-white sticky top-0 z-10">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-semibold text-gray-900 flex items-center gap-2">
            Variables <span className="text-gray-500 italic font-normal">({filteredVariables.length})</span>
            {loadingFullRawData && (
              <ArrowPathIcon className="h-4 w-4 animate-spin text-gray-400" />
            )}
          </h3>
          <div className="flex items-center gap-1">
            <div className="relative">
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onToggleQuestionTypeFilter();
                }}
                className={`p-1.5 rounded-lg transition-colors ${
                  questionTypeFilter
                    ? 'text-orange-600 bg-orange-50'
                    : 'text-gray-400 hover:text-gray-600 hover:bg-gray-100'
                }`}
                title="Filter by question type"
              >
                <FunnelIcon className="h-5 w-5" />
              </button>
              {showQuestionTypeFilter && (
                <>
                  <div 
                    className="fixed inset-0 z-10" 
                    onClick={() => onToggleQuestionTypeFilter()}
                  />
                  <div className="absolute right-0 mt-2 w-56 bg-white border border-gray-200 rounded-lg shadow-lg z-20">
                    <div className="p-2">
                      <button
                        onClick={() => {
                          onQuestionTypeFilterChange(null);
                          onToggleQuestionTypeFilter();
                        }}
                        className={`w-full text-left px-3 py-2 text-sm rounded hover:bg-gray-100 ${
                          questionTypeFilter === null ? 'bg-orange-50 text-orange-600 font-medium' : 'text-gray-700'
                        }`}
                      >
                        All Types
                      </button>
                      {uniqueTypes.map(type => (
                        <button
                          key={type}
                          onClick={() => {
                            onQuestionTypeFilterChange(type);
                            onToggleQuestionTypeFilter();
                          }}
                          className={`w-full text-left px-3 py-2 text-sm rounded hover:bg-gray-100 ${
                            questionTypeFilter === type ? 'bg-orange-50 text-orange-600 font-medium' : 'text-gray-700'
                          }`}
                        >
                          {type}
                        </button>
                      ))}
                    </div>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
        <div className="relative">
          <MagnifyingGlassIcon className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-gray-400" />
          <input
            type="text"
            id="variable-search"
            name="variable-search"
            placeholder="Search variables..."
            value={filter}
            onChange={(e) => onFilterChange(e.target.value)}
            className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-orange-500"
          />
        </div>
        {questionTypeFilter && (
          <div className="mt-2 flex items-center gap-2">
            <span className="text-xs text-gray-600">Filtered by:</span>
            <span className="text-xs px-2 py-1 bg-orange-100 text-orange-800 rounded">
              {questionTypeFilter}
            </span>
            <button
              onClick={() => onQuestionTypeFilterChange(null)}
              className="text-xs text-gray-500 hover:text-gray-700"
            >
              Clear
            </button>
          </div>
        )}
      </div>
      {/* Scrollable variable list */}
      <div className="flex-1 overflow-y-auto p-2">
        {loading ? (
          <div className="text-center py-8 text-gray-500">Loading variables...</div>
        ) : filteredVariables.length === 0 ? (
          <div className="text-center py-8 text-gray-500">
            {filter ? 'No variables match your search' : ''}
          </div>
        ) : (
          <div className="space-y-1">
            {filteredVariables.map((v) => {
              // For hidden variables, use the converted header format
              const variableNameForLookup = v.name.toLowerCase().startsWith('hid_') 
                ? convertHiddenVariableToExpectedHeader(v.name)
                : v.name;
              const varData = getVariableDataByExpectedHeader(variableNameForLookup);
              
              // For summary tables (numeric grids), check if the table has any data to display
              let hasData = false;
              
              // Special handling for open end list summary tables
              if (v.type?.toLowerCase().includes('open end list') && 
                  (v as any).isSummaryTable && 
                  v.name.endsWith('_Summary')) {
                // For open end list summary tables, check if any related individual variables have data
                const baseQuestionName = v.name.replace('_Summary', '');
                const relatedVariables = variables.filter((relatedV: any) => {
                  if (!relatedV.type?.toLowerCase().includes('open end list')) return false;
                  if ((relatedV as any).isSummaryTable) return false;
                  const varMatch = relatedV.name.match(/^([A-Z0-9]+)r\d+$/i);
                  return varMatch && varMatch[1] === baseQuestionName;
                });
                
                // Check if any related variable has data
                hasData = relatedVariables.some((relatedVar: any) => {
                  const relatedVarData = getVariableDataByExpectedHeader(relatedVar.name);
                  if (!relatedVarData) return false;
                  
                  const hasFrequencies = relatedVarData.frequencies && typeof relatedVarData.frequencies === 'object' && 
                    Object.keys(relatedVarData.frequencies).length > 0 &&
                    Object.values(relatedVarData.frequencies).some((count: any) => typeof count === 'number' && count > 0);
                  const hasValues = Array.isArray(relatedVarData.values) && relatedVarData.values.length > 0;
                  
                  return hasFrequencies || hasValues;
                });
              } else if ((v as any).isSummaryTable && v.statements) {
                // Check if this is a column summary table (e.g., S4_c1_Summary)
                const columnMatch = v.name.match(/^([A-Z0-9]+)_(c\d+)(?:_Summary)?$/i);
                const isNumericGridColumnSummary = columnMatch && v.type?.toLowerCase().includes('numeric');
                
                if (isNumericGridColumnSummary) {
                  // For column summary tables, check if any rows have data (mean or sum)
                  const baseName = columnMatch![1];
                  const columnCode = columnMatch![2];
                  
                  // Check if this is a numeric grid
                  const question = questionnaireQuestions.find(q => {
                    const qNum = q.number || q.id;
                    return qNum === baseName || 
                           qNum === baseName.replace(/^Q/, '') ||
                           String(qNum) === String(baseName);
                  });
                  const isNumericGrid = question?.type?.toLowerCase().includes('numeric grid');
                  
                  hasData = Object.keys(v.statements).some((stmtCode) => {
                    // Try to find data for this row in this column
                    let hasRowData = false;
                    
                    // For numeric grids, normalize the code (add "r" prefix if needed)
                    let normalizedStmtCode = stmtCode;
                    if (isNumericGrid && !/^r\d+/i.test(stmtCode) && /^\d+$/.test(stmtCode)) {
                      normalizedStmtCode = `r${stmtCode}`;
                    }
                    
                    // Check cell variables first
                    const cellVarNames = [
                      // Without Q prefix
                      `${baseName}${normalizedStmtCode}${columnCode}`,
                      `${baseName}_${normalizedStmtCode}_${columnCode}`,
                      `${baseName}${normalizedStmtCode}_${columnCode}`,
                      `${baseName}_${normalizedStmtCode}${columnCode}`,
                      // With Q prefix (data often stored with Q prefix)
                      `Q${baseName}${normalizedStmtCode}${columnCode}`,
                      `Q${baseName}_${normalizedStmtCode}_${columnCode}`,
                      `Q${baseName}${normalizedStmtCode}_${columnCode}`,
                      `Q${baseName}_${normalizedStmtCode}${columnCode}`,
                    ];
                    
                    for (const cellVarName of cellVarNames) {
                      const cellData = getVariableDataByExpectedHeader(cellVarName);
                      if (cellData && (
                        (cellData.count && cellData.count > 0) ||
                        (cellData.values && Array.isArray(cellData.values) && cellData.values.length > 0) ||
                        (cellData.sum !== undefined) ||
                        (cellData.mean !== undefined)
                      )) {
                        hasRowData = true;
                        break;
                      }
                    }
                    
                    // Check statement variable with frequencies
                    if (!hasRowData) {
                      const statementVarName = `${baseName}${normalizedStmtCode}`;
                      const expectedHeader = `Q${statementVarName}`;
                      const statementData = getVariableDataByExpectedHeader(expectedHeader);
                      if (statementData) {
                        if (statementData.frequencies && (
                          statementData.frequencies[columnCode] !== undefined ||
                          statementData.frequencies[columnCode.replace(/^c/i, '')] !== undefined
                        )) {
                          hasRowData = true;
                        } else if (statementData.sum !== undefined || statementData.mean !== undefined) {
                          hasRowData = true;
                        }
                      }
                    }
                    
                    return hasRowData;
                  });
                } else {
                  // For other summary tables, check if any of the child statement variables have data
                  // For summary tables, extract base question number (remove "_Summary" or "_Summary Tables" suffix)
                  let baseName = v.name;
                  if (v.name.endsWith('_Summary')) {
                    baseName = v.name.replace('_Summary', '');
                  } else if (v.name.endsWith('_Summary Tables')) {
                    baseName = v.name.replace('_Summary Tables', '');
                  }
                  hasData = Object.keys(v.statements).some((stmtCode) => {
                    const statementVarName = `${baseName}${stmtCode}`;
                    const expectedHeader = `Q${statementVarName}`;
                    const statementData = getVariableDataByExpectedHeader(expectedHeader);
                    return statementData && (
                      (statementData.count && statementData.count > 0) ||
                      (statementData.frequencies && Object.keys(statementData.frequencies || {}).length > 0) ||
                      (statementData.values && Array.isArray(statementData.values) && statementData.values.length > 0) ||
                      (statementData.sum !== undefined) ||
                      (statementData.mean !== undefined)
                    );
                  });
                }
              } else if (v.type?.toLowerCase().includes('numeric grid') && v.statements && v.codes && 
                         Object.keys(v.statements).length > 0 && Object.keys(v.codes).length > 0) {
                // For numeric grids with both statements and response options, check cell variables
                hasData = Object.keys(v.statements || {}).some((stmtCode) => {
                  return Object.keys(v.codes || {}).some((responseCode) => {
                    const cellVarName = `${v.name}_${stmtCode}_${responseCode}`;
                    const cellData = getVariableDataByExpectedHeader(cellVarName);
                    return cellData && (
                      (cellData.count && cellData.count > 0) ||
                      (cellData.values && Array.isArray(cellData.values) && cellData.values.length > 0) ||
                      (cellData.sum !== undefined) ||
                      (cellData.mean !== undefined)
                    );
                  });
                });
              } else if (v.type?.toLowerCase().includes('single select grid') && v.statements && 
                         Object.keys(v.statements).length > 0) {
                // For single select grids, check if any statement variables have data
                const baseQuestionNumber = getBaseQuestionNumber(v.name);
                hasData = Object.keys(v.statements || {}).some((stmtCode) => {
                  // Try different variable name formats for the statement
                  const possibleNames = [
                    `${baseQuestionNumber}_${stmtCode}`,
                    `${baseQuestionNumber}${stmtCode}`,
                    `Q${baseQuestionNumber}_${stmtCode}`,
                    `Q${baseQuestionNumber}${stmtCode}`,
                  ];
                  
                  return possibleNames.some(varName => {
                    const statementData = getVariableDataByExpectedHeader(varName);
                    return statementData && (
                      (statementData.count && statementData.count > 0) ||
                      (statementData.frequencies && Object.keys(statementData.frequencies || {}).length > 0) ||
                      (statementData.values && Array.isArray(statementData.values) && statementData.values.length > 0)
                    );
                  });
                });
              } else {
                hasData = varData && (
                  (varData.count && varData.count > 0) ||
                  (varData.frequencies && Object.keys(varData.frequencies || {}).length > 0) ||
                  (varData.values && Array.isArray(varData.values) && varData.values.length > 0)
                );
              }

              // Check for scale summary variables (T2B, M3B, B2B)
              if ((v as any).isScaleSummary && v.statements) {
                const scaleMatch = v.name.match(/^([A-Z0-9]+)_(T2B|M3B|B2B)$/i);
                if (scaleMatch) {
                  const baseName = scaleMatch[1];
                  hasData = Object.keys(v.statements).some((stmtCode) => {
                    const statementVarName = `${baseName}${stmtCode}`;
                    const expectedHeader = `Q${statementVarName}`;
                    const statementData = getVariableDataByExpectedHeader(expectedHeader);

                    if (!statementData) return false;

                    const hasFrequencies = statementData.frequencies &&
                      Object.keys(statementData.frequencies).length > 0;
                    const hasValues = statementData.values &&
                      Array.isArray(statementData.values) &&
                      statementData.values.length > 0;

                    return hasFrequencies || hasValues;
                  });
                }
              }

              return (
                <div key={v.name}>
                  <button
                    onClick={() => onSelect(v.name)}
                    className={`w-full text-left px-3 py-2 rounded-lg text-sm transition-colors ${
                      selectedVariable === v.name
                        ? 'bg-orange-100 text-orange-900'
                        : 'hover:bg-gray-100 text-gray-700'
                    }`}
                  >
                        <div className="flex items-center justify-between gap-2 w-full">
                          <div className="flex items-center gap-2 flex-1 min-w-0">
                        {(() => {
                          // Check if this is a numeric grid column summary (e.g., S11_c1_Summary)
                          const columnSummaryMatch = v.name.match(/^([A-Z0-9]+)_(c\d+)_Summary$/i);
                          let displayName = v.name;
                          let titleText = v.name;
                          
                          if (columnSummaryMatch && (v as any).isSummaryTable) {
                            const baseQuestionNumber = columnSummaryMatch[1];
                            const columnCode = columnSummaryMatch[2]; // e.g., "c1"
                            
                            // Find the question to check if it's a numeric grid
                            const question = questionnaireQuestions.find(q => {
                              const qNum = q.number || q.id;
                              return qNum === baseQuestionNumber || 
                                     qNum === baseQuestionNumber.replace(/^Q/, '') ||
                                     String(qNum) === String(baseQuestionNumber);
                            });
                            
                            const isNumericGrid = question?.type?.toLowerCase().includes('numeric grid');
                            
                            if (isNumericGrid) {
                              // For numeric grids, check if it has "%" tag to determine label
                              const hasPercentTag = (v as any).tags && Array.isArray((v as any).tags) && (v as any).tags.includes('%');
                              // For numeric grids with "%" tag, show as "{baseQuestionNumber}_Mean Summary"
                              // Otherwise show as "{baseQuestionNumber}_Summary"
                              displayName = hasPercentTag ? `${baseQuestionNumber}_Mean Summary` : `${baseQuestionNumber}_Summary`;
                              titleText = displayName;
                            } else if (question && question.responseOptions && Array.isArray(question.responseOptions)) {
                              // For numeric grids, show column name
                              // Extract column number from code (e.g., "c1" -> 1)
                              const colNumMatch = columnCode.match(/c(\d+)/i);
                              if (colNumMatch) {
                                const colIndex = parseInt(colNumMatch[1]) - 1; // Convert to 0-based index
                                const responseOption = question.responseOptions[colIndex];
                                
                                if (responseOption) {
                                  // Get the text from the response option
                                  const optionText = typeof responseOption === 'string' 
                                    ? responseOption 
                                    : (responseOption.text || responseOption.label || `Column ${colIndex + 1}`);
                                  
                                  displayName = `${baseQuestionNumber} - ${optionText}`;
                                  titleText = displayName;
                                }
                              }
                            }
                            
                            // Fallback: if we can't find the response option, just show the column code
                            if (displayName === v.name) {
                              displayName = `${baseQuestionNumber} - ${columnCode}`;
                              titleText = displayName;
                            }
                          }
                          
                          return (
                            <span className="font-medium truncate block" title={titleText}>
                              {displayName}
                            </span>
                          );
                        })()}
                      </div>
                      <span className="text-xs px-2 py-0.5 rounded flex-shrink-0 bg-blue-100 text-blue-800" style={{ minWidth: '80px', textAlign: 'center' }}>
                        {v.type || 'Unknown'}
                      </span>
                    </div>
                    {v.description && (
                      <div className="text-xs text-gray-500 mt-1">
                        {(() => {
                          const desc = v.description;
                          // Check if description contains a newline (for grid individual variables)
                          if (desc.includes('\n')) {
                            const [questionText, statementText] = desc.split('\n', 2);
                            return (
                              <>
                                <div className="truncate">{questionText}</div>
                                <div className="truncate font-semibold mt-0.5">{statementText}</div>
                              </>
                            );
                          }
                          return <div className="truncate">{desc}</div>;
                        })()}
                      </div>
                    )}
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};
