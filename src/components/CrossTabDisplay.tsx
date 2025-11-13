import React, { useMemo, useState, useRef, useEffect } from 'react';
import { type ParsedDataFile, getCodeLabel } from '../utils/dataTabulationHelpers';
import { type BannerGroup } from '../types/dataTabulation';
import { ChevronDownIcon } from '@heroicons/react/24/outline';

interface CrossTabDisplayProps {
  parsedFile: ParsedDataFile;
  bannerGroup: BannerGroup;
  selectedStubVariable: string;
  onStubVariableChange: (variableName: string) => void;
  hideStubVariableDropdown?: boolean;
  hideOpenEnds: boolean;
  hideZeroBase: boolean;
  getVariableBase: (variableName: string) => number;
  hideInCrosstabs: Record<string, boolean>;
  sortOptions?: Record<string, 'qnr' | 'asc' | 'desc'>;
  hideZeroFrequencies?: Record<string, boolean>;
  allBannerGroups?: BannerGroup[];
  currentBannerGroupIndex?: number;
  onEdit?: () => void;
  onDelete?: () => void;
}

const CrossTabDisplay: React.FC<CrossTabDisplayProps> = ({
  parsedFile,
  bannerGroup,
  selectedStubVariable,
  onStubVariableChange,
  hideStubVariableDropdown = false,
  hideOpenEnds,
  hideZeroBase,
  getVariableBase,
  hideInCrosstabs,
  sortOptions = {},
  hideZeroFrequencies = {},
  allBannerGroups = [],
  currentBannerGroupIndex = 0,
  onEdit,
  onDelete
}) => {
  // Apply the same filtering as the Tables subtab
  const categoricalVariables = useMemo(() => {
    const excludeList = [
      'disposition', 'status', 'record', 'uuid', 'date', 'markers',
      'listsource', 'qhidstage', 'qhidlivetrack',
      'id', 'identifier', 'qinfo', 'sesskey', 'pcid', 'shghash', 'cnt',
      'session', 'url', 'dcua', 'useragent', 'list', 'declang', 'source',
      'vdropout', 'start_date', 'vmobileos', 'vmobiledevice', 'vbrowser',
      'vbrowserr15oe', 'vosr15oe', 'vos', 'vdeclang', 'qtime', 'vcnt',
      'vpcid', 'vqinfo', 'vlist', 'vqtime',
      'pmassist1', 'pmassist2', 'pmassist3', 'pmassist4', 'pmassist5'
    ];

    return parsedFile.variables.filter(v => {
      // Only categorical variables
      if (v.type !== 'categorical') return false;
      
      // Exclude system variables
      if (excludeList.includes(v.name.toLowerCase())) {
        return false;
      }
      
      // Hide variables with "Term" in the name
      if (v.name.toLowerCase().includes('term')) {
        return false;
      }
      
      // Apply filter options
      if (hideOpenEnds && v.type === 'open-text') {
        return false;
      }
      
      if (hideZeroBase) {
        const base = getVariableBase(v.name);
        if (base === 0) {
          return false;
        }
      }
      
      // Hide variables marked as hidden in crosstabs
      if (hideInCrosstabs[v.name]) {
        return false;
      }
      
      return true;
    });
  }, [parsedFile, hideOpenEnds, hideZeroBase, getVariableBase, hideInCrosstabs]);

  // Calculate data for each column (Total + each cut) and group structure
  const { columnData, groupStructure } = useMemo(() => {
    const columns: Array<{
      id: string;
      title: string;
      cutTitle: string;
      groupTitle?: string;
      isTotal: boolean;
      filterFn: (row: Record<string, any>) => boolean;
    }> = [
      {
        id: 'total',
        title: 'Total',
        cutTitle: 'Total',
        isTotal: true,
        filterFn: () => true // Total includes all rows
      }
    ];

    const groups: Array<{ title: string; cutCount: number }> = [];

    // Handle both old structure (cuts directly) and new structure (groups with cuts)
    if (bannerGroup.groups && bannerGroup.groups.length > 0) {
      // New structure: groups with cuts
      bannerGroup.groups.forEach(subGroup => {
        const cutIds: string[] = [];
        subGroup.cuts.forEach(cut => {
          const variable = parsedFile.variables.find(v => v.name === cut.variableName);
          if (!variable) {
            console.warn(`[Banner] Variable "${cut.variableName}" not found in parsed file`);
            return;
          }

          columns.push({
            id: cut.id,
            title: cut.title,
            cutTitle: cut.title,
            groupTitle: subGroup.title,
            isTotal: false,
            filterFn: (row: Record<string, any>) => {
              const value = row[cut.variableName];
              if (value === null || value === undefined || value === '') return false;
              
              const valueStr = String(value).trim();
              
              // Check if value matches stored codes directly (codes are stored as strings like "1", "2")
              const codeStr = cut.codes.map(c => String(c).trim());
              if (codeStr.includes(valueStr)) {
                return true;
              }
              
              // If value doesn't match codes, it might be a label (like "Pediatric", "Adult")
              // Check if the value matches any of the labels for the stored codes
              const variable = parsedFile.variables.find(v => v.name === cut.variableName);
              if (variable && variable.codes) {
                // Check if value matches the label for any of our stored codes
                for (const code of cut.codes) {
                  const codeLabel = variable.codes[String(code)] || variable.codes[code];
                  if (codeLabel && String(codeLabel).trim() === valueStr) {
                    return true;
                  }
                }
              }
              
              return false;
            }
          });
          cutIds.push(cut.id);
        });
        groups.push({ title: subGroup.title, cutCount: cutIds.length });
      });
    } else if ((bannerGroup as any).cuts && (bannerGroup as any).cuts.length > 0) {
      // Old structure: cuts directly (for backward compatibility)
      (bannerGroup as any).cuts.forEach((cut: any) => {
        const variable = parsedFile.variables.find(v => v.name === cut.variableName);
        if (!variable) {
          console.warn(`[Banner] Variable "${cut.variableName}" not found in parsed file`);
          return;
        }

        columns.push({
          id: cut.id,
          title: cut.title,
          cutTitle: cut.title,
          isTotal: false,
            filterFn: (row: Record<string, any>) => {
              const value = row[cut.variableName];
              if (value === null || value === undefined || value === '') return false;
              
              const valueStr = String(value).trim();
              
              // Check if value matches stored codes directly (codes are stored as strings like "1", "2")
              const codeStr = cut.codes.map((c: any) => String(c).trim());
              if (codeStr.includes(valueStr)) {
                return true;
              }
              
              // If value doesn't match codes, it might be a label (like "Pediatric", "Adult")
              // Check if the value matches any of the labels for the stored codes
              const variable = parsedFile.variables.find(v => v.name === cut.variableName);
              if (variable && variable.codes) {
                // Check if value matches the label for any of our stored codes
                for (const code of cut.codes) {
                  const codeLabel = variable.codes[String(code)] || variable.codes[code];
                  if (codeLabel && String(codeLabel).trim() === valueStr) {
                    return true;
                  }
                }
              }
              
              return false;
            }
        });
      });
      // For old structure, treat each cut as its own group
      (bannerGroup as any).cuts.forEach((cut: any) => {
        groups.push({ title: cut.title, cutCount: 1 });
      });
    }

    return { columnData: columns, groupStructure: groups };
  }, [parsedFile, bannerGroup]);

  // Get stub variable rows (codes)
  const stubRows = useMemo(() => {
    if (!selectedStubVariable) return [];
    
    const variable = parsedFile.variables.find(v => v.name === selectedStubVariable);
    if (!variable || variable.type !== 'categorical') return [];

    // Get all codes from the variable definition
    return Object.keys(variable.codes);
  }, [parsedFile, selectedStubVariable]);

  // Calculate cross tab data
  const crossTabData = useMemo(() => {
    if (!selectedStubVariable || stubRows.length === 0) return [];

    return stubRows.map(stubCode => {
      const row: Record<string, { count: number; percentage: number; base: number }> = {};

      columnData.forEach(column => {
        let base = 0;
        let count = 0;

        parsedFile.data.forEach(dataRow => {
          // Check if row matches the column filter (for banner cuts)
          const matchesColumn = column.filterFn(dataRow);
          if (!matchesColumn) return;

          base++;
          
          // Check if stub variable value matches this stub code
          const stubValue = dataRow[selectedStubVariable];
          if (stubValue !== null && stubValue !== undefined && stubValue !== '') {
            const stubValueStr = String(stubValue).trim();
            
            // Check if value matches the code directly
            if (stubValueStr === stubCode) {
              count++;
            } else {
              // Check if value matches the label for this code
              const stubVariable = parsedFile.variables.find(v => v.name === selectedStubVariable);
              if (stubVariable && stubVariable.codes) {
                const codeLabel = stubVariable.codes[stubCode];
                if (codeLabel && String(codeLabel).trim() === stubValueStr) {
                  count++;
                }
              }
            }
          }
        });

        row[column.id] = {
          count,
          percentage: base > 0 ? (count / base) * 100 : 0,
          base
        };
      });

      return {
        code: stubCode,
        label: getCodeLabel(parsedFile.variables, selectedStubVariable, stubCode),
        ...row
      };
    });
  }, [parsedFile, selectedStubVariable, stubRows, columnData]);

  // Apply sorting and hide zeros to crossTabData
  const processedCrossTabData = useMemo(() => {
    if (!selectedStubVariable) return crossTabData;
    
    let processed = [...crossTabData];
    
    // Filter out rows with 0 counts if hideZeroFrequencies is enabled for this variable
    if (hideZeroFrequencies[selectedStubVariable]) {
      // Check if any column has a non-zero count
      processed = processed.filter(row => {
        return columnData.some(column => {
          const cell = row[column.id];
          return cell && cell.count > 0;
        });
      });
    }
    
    // Apply sorting
    const sortOption = sortOptions[selectedStubVariable] || 'qnr';
    const variable = parsedFile.variables.find(v => v.name === selectedStubVariable);
    const codeOrder = variable && (variable.type === 'categorical' || variable.type === 'multi-select' || 
                                   variable.type === 'grid' || variable.type === 'grid-single-select' || 
                                   variable.type === 'grid-multi-select')
      ? Object.keys(variable.codes)
      : [];
    
    processed.sort((a, b) => {
      if (sortOption === 'qnr') {
        // QNR: sort by original order from the data file (code definition order)
        const aIndex = codeOrder.indexOf(a.code);
        const bIndex = codeOrder.indexOf(b.code);
        // If code not found in order, put it at the end
        if (aIndex === -1 && bIndex === -1) return 0;
        if (aIndex === -1) return 1;
        if (bIndex === -1) return -1;
        return aIndex - bIndex;
      } else if (sortOption === 'asc') {
        // Ascending: sort by percentage in the Total column (ascending)
        const aTotal = a['total']?.percentage || 0;
        const bTotal = b['total']?.percentage || 0;
        return aTotal - bTotal;
      } else if (sortOption === 'desc') {
        // Descending: sort by percentage in the Total column (descending)
        const aTotal = a['total']?.percentage || 0;
        const bTotal = b['total']?.percentage || 0;
        return bTotal - aTotal;
      }
      return 0;
    });
    
    return processed;
  }, [crossTabData, selectedStubVariable, sortOptions, hideZeroFrequencies, parsedFile, columnData]);

  const stubVariable = parsedFile.variables.find(v => v.name === selectedStubVariable);
  const totalBase = parsedFile.rowCount;

  // Calculate starting letter index based on all previous banner groups
  const startingLetterIndex = useMemo(() => {
    let index = 0;
    
    // Count all non-total columns from previous banner groups
    for (let i = 0; i < currentBannerGroupIndex && i < allBannerGroups.length; i++) {
      const prevGroup = allBannerGroups[i];
      if (prevGroup.groups && prevGroup.groups.length > 0) {
        // New structure: groups with cuts
        prevGroup.groups.forEach(subGroup => {
          subGroup.cuts.forEach(() => {
            index++; // Each cut gets a letter
          });
        });
      } else if ((prevGroup as any).cuts && (prevGroup as any).cuts.length > 0) {
        // Old structure: cuts directly
        (prevGroup as any).cuts.forEach(() => {
          index++; // Each cut gets a letter
        });
      }
    }
    
    return index;
  }, [allBannerGroups, currentBannerGroupIndex]);

  // Generate stat testing letters (A, B, C, etc.) for columns
  // Letters continue across all banner groups
  const getStatLetter = (columnIndex: number): string | null => {
    if (columnIndex === 0) return null; // Total doesn't get a letter
    
    const column = columnData[columnIndex];
    if (!column || column.isTotal) return null;
    
    // Count all columns before this one (excluding Total) across all banner groups
    let letterIndex = startingLetterIndex;
    for (let i = 1; i < columnIndex; i++) {
      if (!columnData[i].isTotal) {
        letterIndex++;
      }
    }
    
    return String.fromCharCode(65 + letterIndex); // A=65, B=66, etc.
  };

  // Statistical testing: two-proportion Z-test
  const isSignificant = (p1: number, n1: number, p2: number, n2: number, confidenceLevel: 95 | 90 | 80 = 95): boolean => {
    if (!n1 || !n2 || n1 <= 0 || n2 <= 0) return false;
    
    // Convert percentages to proportions
    const prop1 = p1 / 100;
    const prop2 = p2 / 100;
    
    // Calculate pooled proportion
    const pooledProp = (prop1 * n1 + prop2 * n2) / (n1 + n2);
    
    // Calculate standard error
    const se = Math.sqrt(pooledProp * (1 - pooledProp) * (1/n1 + 1/n2));
    if (se === 0) return false;
    
    // Calculate z-statistic
    const z = Math.abs(prop1 - prop2) / se;
    
    // Get z-critical value based on confidence level
    // 95% = 1.96, 90% = 1.645, 80% = 1.282
    const zCritical = confidenceLevel === 95 ? 1.96 : confidenceLevel === 90 ? 1.645 : 1.282;
    
    return z > zCritical;
  };

  const confidenceLevel = bannerGroup.confidenceLevel || 95;

  // Get significant differences for a cell (returns array of letters it's significantly higher than)
  // Only compares columns within the same group (excluding Total)
  const getSignificantDifferences = useMemo(() => {
    const results: Record<number, Record<number, string[]>> = {};
    
    // Helper function to get stat letter for a column index
    // Uses the same logic as getStatLetter to ensure consistency
    const getLetterForColumn = (colIdx: number): string | null => {
      if (colIdx === 0) return null; // Total doesn't get a letter
      
      const column = columnData[colIdx];
      if (!column || column.isTotal) return null;
      
      // Count all columns before this one (excluding Total) across all banner groups
      let letterIndex = startingLetterIndex;
      for (let i = 1; i < colIdx; i++) {
        if (!columnData[i].isTotal) {
          letterIndex++;
        }
      }
      
      return String.fromCharCode(65 + letterIndex); // A=65, B=66, etc.
    };
    
    processedCrossTabData.forEach((row, rowIdx) => {
      results[rowIdx] = {};
      
      // Compare each non-total column to other non-total columns in the same group
      columnData.forEach((col1, col1Idx) => {
        if (col1.isTotal) return; // Skip total column
        
        const cell1 = row[col1.id];
        const higherThan: string[] = [];
        
        // Only compare with columns in the same group
        columnData.forEach((col2, col2Idx) => {
          if (col2.isTotal || col1Idx === col2Idx) return; // Skip total and self
          if (col1.groupTitle !== col2.groupTitle) return; // Only compare within same group
          
          const cell2 = row[col2.id];
          
          // Check if cell1 is significantly higher than cell2
          if (cell1.percentage > cell2.percentage && 
              isSignificant(cell1.percentage, cell1.base, cell2.percentage, cell2.base, confidenceLevel)) {
            const letter = getLetterForColumn(col2Idx);
            if (letter) higherThan.push(letter);
          }
        });
        
        if (higherThan.length > 0) {
          results[rowIdx][col1Idx] = higherThan;
        }
      });
    });
    
    return results;
  }, [processedCrossTabData, columnData, confidenceLevel, startingLetterIndex]);

  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const showAll = selectedStubVariable === '';

  // Calculate number of tables showing
  const tableCount = useMemo(() => {
    if (showAll) {
      // Count how many variables have valid cross-tab data
      let count = 0;
      categoricalVariables.forEach(variable => {
        // Check if this variable has any data
        const hasData = parsedFile.data.some(row => {
          const value = row[variable.name];
          return value !== null && value !== undefined && value !== '';
        });
        if (hasData) {
          count++;
        }
      });
      return count;
    } else {
      // Single variable view shows 1 table if there's data
      return selectedStubVariable && processedCrossTabData.length > 0 ? 1 : 0;
    }
  }, [showAll, categoricalVariables, selectedStubVariable, processedCrossTabData.length, parsedFile]);

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsDropdownOpen(false);
      }
    };

    if (isDropdownOpen) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [isDropdownOpen]);

  const selectedVariable = categoricalVariables.find(v => v.name === selectedStubVariable);

  // Generate cross tab data for a specific variable
  const generateCrossTabForVariable = (variableName: string) => {
    const variable = parsedFile.variables.find(v => v.name === variableName);
    if (!variable || variable.type !== 'categorical') return null;

    const stubRows = Object.keys(variable.codes);
    if (stubRows.length === 0) return null;

    const data: Array<{
      code: string;
      label: string;
      [key: string]: { count: number; percentage: number; base: number } | string;
    }> = [];

    stubRows.forEach(stubCode => {
      const row: Record<string, { count: number; percentage: number; base: number } | string> = {
        code: stubCode,
        label: getCodeLabel(parsedFile.variables, variableName, stubCode)
      };

      columnData.forEach(column => {
        let base = 0;
        let count = 0;

        parsedFile.data.forEach(dataRow => {
          const matchesColumn = column.filterFn(dataRow);
          if (!matchesColumn) return;

          base++;
          
          const stubValue = dataRow[variableName];
          if (stubValue !== null && stubValue !== undefined && stubValue !== '') {
            const stubValueStr = String(stubValue).trim();
            
            // Check if value matches the code directly
            if (stubValueStr === stubCode) {
              count++;
            } else {
              // Check if value matches the label for this code
              if (variable && variable.codes) {
                const codeLabel = variable.codes[stubCode];
                if (codeLabel && String(codeLabel).trim() === stubValueStr) {
                  count++;
                }
              }
            }
          }
        });

        row[column.id] = {
          count,
          percentage: base > 0 ? (count / base) * 100 : 0,
          base
        };
      });

      data.push(row as any);
    });

    // Apply sorting and hide zeros
    let processed = [...data];
    
    // Filter out rows with 0 counts if hideZeroFrequencies is enabled for this variable
    if (hideZeroFrequencies[variableName]) {
      processed = processed.filter(row => {
        return columnData.some(column => {
          const cell = row[column.id] as { count: number } | undefined;
          return cell && cell.count > 0;
        });
      });
    }
    
    // Apply sorting
    const sortOption = sortOptions[variableName] || 'qnr';
    const codeOrder = Object.keys(variable.codes);
    
    processed.sort((a, b) => {
      if (sortOption === 'qnr') {
        // QNR: sort by original order from the data file (code definition order)
        const aIndex = codeOrder.indexOf(a.code);
        const bIndex = codeOrder.indexOf(b.code);
        // If code not found in order, put it at the end
        if (aIndex === -1 && bIndex === -1) return 0;
        if (aIndex === -1) return 1;
        if (bIndex === -1) return -1;
        return aIndex - bIndex;
      } else if (sortOption === 'asc') {
        // Ascending: sort by percentage in the Total column (ascending)
        const aTotal = (a['total'] as { percentage: number } | undefined)?.percentage || 0;
        const bTotal = (b['total'] as { percentage: number } | undefined)?.percentage || 0;
        return aTotal - bTotal;
      } else if (sortOption === 'desc') {
        // Descending: sort by percentage in the Total column (descending)
        const aTotal = (a['total'] as { percentage: number } | undefined)?.percentage || 0;
        const bTotal = (b['total'] as { percentage: number } | undefined)?.percentage || 0;
        return bTotal - aTotal;
      }
      return 0;
    });
    
    return processed;
  };

  return (
    <div className="space-y-4 min-w-0">
      {/* Banner Group Title, Stub Variable Selection, and Action Buttons */}
      <div className="flex-shrink-0">
        <div className="flex items-center justify-between gap-4 mb-3">
          <h3 className="text-lg font-semibold text-gray-900 uppercase">
            {bannerGroup.title}
            {tableCount > 0 && (
              <span className="text-sm font-normal normal-case ml-2">({tableCount} {tableCount === 1 ? 'table' : 'tables'})</span>
            )}
          </h3>
          <div className="flex items-start gap-4">
            {!hideStubVariableDropdown && (
              <div className="relative flex-shrink-0" style={{ minWidth: '300px', maxWidth: '400px' }} ref={dropdownRef}>
                <button
                  type="button"
                  onClick={() => setIsDropdownOpen(!isDropdownOpen)}
                  className="w-full border border-gray-300 rounded-lg px-4 py-2 text-sm text-left bg-white flex items-center justify-between focus:outline-none focus:ring-2 focus:ring-orange-500"
                >
                  <span className="truncate">
                    {showAll ? (
                      <span className="font-semibold">Show all</span>
                    ) : selectedVariable ? (
                      <>
                        <span className="font-bold">{selectedVariable.name}</span>
                        {selectedVariable.description && (
                          <span className="text-gray-600"> - {selectedVariable.description}</span>
                        )}
                      </>
                    ) : (
                      <span className="text-gray-500">Select a variable...</span>
                    )}
                  </span>
                  <ChevronDownIcon className={`h-4 w-4 text-gray-400 flex-shrink-0 ml-2 transition-transform ${isDropdownOpen ? 'rotate-180' : ''}`} />
                </button>
                {isDropdownOpen && (
                  <div className="absolute z-10 w-full mt-1 bg-white border border-gray-300 rounded-lg shadow-lg max-h-96 overflow-y-auto">
                    {categoricalVariables.length === 0 ? (
                      <div className="px-4 py-3 text-sm text-gray-500">No variables available</div>
                    ) : (
                      <>
                        <button
                          type="button"
                          onClick={() => {
                            onStubVariableChange('');
                            setIsDropdownOpen(false);
                          }}
                          className={`w-full text-left px-4 py-2 text-sm hover:bg-gray-50 transition-colors border-b border-gray-100 ${
                            showAll ? 'bg-orange-50' : ''
                          }`}
                        >
                          <div className="truncate">
                            <span className="font-semibold text-gray-900">Show all</span>
                          </div>
                        </button>
                        {categoricalVariables.map(variable => (
                          <button
                            key={variable.name}
                            type="button"
                            onClick={() => {
                              onStubVariableChange(variable.name);
                              setIsDropdownOpen(false);
                            }}
                            className={`w-full text-left px-4 py-2 text-sm hover:bg-gray-50 transition-colors border-b border-gray-100 last:border-b-0 ${
                              selectedStubVariable === variable.name ? 'bg-orange-50' : ''
                            }`}
                          >
                            <div className="truncate">
                              <span className="font-bold text-gray-900">{variable.name}</span>
                              {variable.description && (
                                <span className="text-gray-600"> - {variable.description}</span>
                              )}
                            </div>
                          </button>
                        ))}
                      </>
                    )}
                  </div>
                )}
              </div>
            )}
            {onEdit && (
              <div className="flex items-center gap-2">
                <button
                  onClick={onEdit}
                  className="text-sm text-gray-600 hover:text-gray-900 px-3 py-1.5 border border-gray-300 rounded-lg hover:bg-gray-50"
                >
                  Edit
                </button>
              </div>
            )}
          </div>
        </div>
        <div className="border-b border-gray-200 mb-4"></div>
      </div>

      {/* Cross Tab Tables */}
      {showAll ? (
        <div className="space-y-3">
          {categoricalVariables.map((variable, varIdx) => {
            const variableCrossTabData = generateCrossTabForVariable(variable.name);
            if (!variableCrossTabData || variableCrossTabData.length === 0) return null;

            return (
              <div key={variable.name} className="space-y-1">
                  <h4 className="text-sm font-bold text-gray-900">{variable.name}</h4>
                  {variable.description && (
                    <p className="text-xs text-gray-600">{variable.description}</p>
                  )}
                  <div className="overflow-x-auto border border-gray-200 rounded-lg min-w-0">
                  <table className="w-full divide-y divide-gray-200" style={{ tableLayout: 'fixed' }}>
                    <colgroup>
                      <col style={{ width: '256px' }} />
                      {columnData.map(() => (
                        <col key={Math.random()} style={{ width: `${100 / columnData.length}%` }} />
                      ))}
                    </colgroup>
                    <thead className="sticky top-0" style={{ backgroundColor: '#D14A2D' }}>
                      {/* Group titles row */}
                      <tr>
                        <th className="px-3 py-1.5 text-left text-xs font-bold text-white uppercase tracking-wider border-r border-white/20" rowSpan={2}>
                        </th>
                        {/* Total column header */}
                        {columnData[0].isTotal && (
                          <th
                            className="px-3 py-1.5 text-center text-xs font-bold text-white uppercase tracking-wider border-r border-white/20 align-bottom"
                            rowSpan={2}
                          >
                            Total
                          </th>
                        )}
                        {/* Group title merged cells */}
                        {groupStructure.map((group, groupIdx) => {
                          return (
                            <th
                              key={`group-${groupIdx}`}
                              className="px-3 py-1.5 text-center text-xs font-bold text-white uppercase tracking-wider border-r border-white/20 border-b border-white/20 align-bottom"
                              colSpan={group.cutCount}
                            >
                              {group.title}
                            </th>
                          );
                        })}
                      </tr>
                      {/* Cut titles row with stat letters */}
                      <tr>
                        {columnData.slice(1).map((column, colIdx) => {
                          const actualColIdx = colIdx + 1; // +1 because we skip Total
                          const letter = getStatLetter(actualColIdx);
                          return (
                            <th
                              key={column.id}
                              className="px-3 py-1.5 text-center text-xs font-bold text-white uppercase tracking-wider border-r border-white/20 last:border-r-0"
                            >
                              <div>{column.cutTitle}</div>
                              {letter && <div className="text-xs font-medium mt-0.5">({letter})</div>}
                            </th>
                          );
                        })}
                      </tr>
                    </thead>
                    <tbody className="bg-white divide-y divide-gray-200">
                      {/* Total Row */}
                      <React.Fragment>
                        <tr className="bg-gray-50 font-semibold">
                          <td className="px-3 py-1 text-xs text-gray-900 border-r border-gray-300" rowSpan={2}>Total</td>
                          {columnData.map(column => {
                            const totalCount = variableCrossTabData.reduce((sum, row) => sum + ((row[column.id] as { count: number })?.count || 0), 0);
                            return (
                              <td key={column.id} className="px-3 py-1 text-xs text-gray-900 text-center border-r border-gray-300 last:border-r-0">
                                {totalCount}
                                {totalCount < 15 && (
                                  <span className="text-red-600 ml-1">*</span>
                                )}
                              </td>
                            );
                          })}
                        </tr>
                        <tr className="bg-gray-50 font-semibold">
                          {columnData.map(column => {
                            const totalCount = variableCrossTabData.reduce((sum, row) => sum + ((row[column.id] as { count: number })?.count || 0), 0);
                            const totalBase = variableCrossTabData.length > 0 ? ((variableCrossTabData[0][column.id] as { base: number })?.base || 0) : 0;
                            const totalPercentage = totalBase > 0 ? (totalCount / totalBase) * 100 : 0;
                            return (
                              <td key={column.id} className="px-3 py-1 text-xs text-gray-900 text-center border-r border-gray-300 last:border-r-0">
                                {totalPercentage.toFixed(1)}%
                              </td>
                            );
                          })}
                        </tr>
                      </React.Fragment>
                      {variableCrossTabData.map((row, rowIdx) => (
                        <React.Fragment key={rowIdx}>
                          <tr 
                            className="hover:bg-gray-50 [&:hover+tr]:bg-gray-50"
                            data-row-index={rowIdx}
                            onMouseEnter={(e) => {
                              const nextRow = e.currentTarget.nextElementSibling as HTMLTableRowElement;
                              if (nextRow) nextRow.classList.add('bg-gray-50');
                            }}
                            onMouseLeave={(e) => {
                              const nextRow = e.currentTarget.nextElementSibling as HTMLTableRowElement;
                              if (nextRow) nextRow.classList.remove('bg-gray-50');
                            }}
                          >
                            <td className="px-3 py-1 text-xs text-gray-900 border-r border-gray-300" rowSpan={2}>
                              <div className="font-medium">{row.label}</div>
                            </td>
                            {columnData.map((column, colIdx) => {
                              const cell = row[column.id] as { count: number; percentage: number; base: number };
                              return (
                                <td key={column.id} className="px-3 py-1 text-xs text-gray-900 text-center border-r border-gray-300 last:border-r-0">
                                  {cell.count}
                                </td>
                              );
                            })}
                          </tr>
                          <tr 
                            className="hover:bg-gray-50 [&:has(+tr:hover)]:bg-gray-50"
                            data-row-index={rowIdx}
                            onMouseEnter={(e) => {
                              const prevRow = e.currentTarget.previousElementSibling as HTMLTableRowElement;
                              if (prevRow) prevRow.classList.add('bg-gray-50');
                            }}
                            onMouseLeave={(e) => {
                              const prevRow = e.currentTarget.previousElementSibling as HTMLTableRowElement;
                              if (prevRow) prevRow.classList.remove('bg-gray-50');
                            }}
                          >
                            {columnData.map((column, colIdx) => {
                              const cell = row[column.id] as { count: number; percentage: number; base: number };
                              // Calculate significant differences for this cell - only within same group
                              const higherThan: string[] = [];
                              if (!column.isTotal) {
                                columnData.forEach((col2, col2Idx) => {
                                  if (col2.isTotal || colIdx === col2Idx) return;
                                  if (column.groupTitle !== col2.groupTitle) return; // Only compare within same group
                                  const cell2 = row[col2.id] as { count: number; percentage: number; base: number };
                                  if (cell.percentage > cell2.percentage && 
                                      isSignificant(cell.percentage, cell.base, cell2.percentage, cell2.base, bannerGroup.confidenceLevel || 95)) {
                                    const letter = getStatLetter(col2Idx);
                                    if (letter) higherThan.push(letter);
                                  }
                                });
                              }
                              return (
                                <td key={column.id} className="px-3 py-1 text-xs text-gray-900 text-center border-r border-gray-300 last:border-r-0">
                                  <div className="flex items-center justify-center gap-1">
                                    <span>{cell.percentage.toFixed(1)}%</span>
                                    {higherThan.length > 0 && (
                                      <span className="text-xs font-bold text-red-600">
                                        {higherThan.join('')}
                                      </span>
                                    )}
                                  </div>
                                </td>
                              );
                            })}
                          </tr>
                        </React.Fragment>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            );
          })}
        </div>
      ) : selectedStubVariable && crossTabData.length > 0 && (
        <div className="overflow-x-auto border border-gray-200 rounded-lg min-w-0">
          <table className="w-full divide-y divide-gray-200" style={{ tableLayout: 'fixed' }}>
            <colgroup>
              <col style={{ width: '256px' }} />
              {columnData.map(() => (
                <col key={Math.random()} style={{ width: `${100 / columnData.length}%` }} />
              ))}
            </colgroup>
            <thead className="sticky top-0" style={{ backgroundColor: '#D14A2D' }}>
              {/* Group titles row */}
              <tr>
                <th className="px-3 py-1.5 text-left text-xs font-bold text-white uppercase tracking-wider border-r border-white/20" rowSpan={2}>
                </th>
                {/* Total column header - no group title needed */}
                {columnData[0].isTotal && (
                  <th
                    className="px-3 py-1.5 text-center text-xs font-bold text-white uppercase tracking-wider border-r border-white/20 align-bottom"
                    rowSpan={2}
                  >
                    Total
                  </th>
                )}
                {/* Group title merged cells */}
                {groupStructure.map((group, groupIdx) => {
                  let colStartIdx = 1; // Start after Total
                  for (let i = 0; i < groupIdx; i++) {
                    colStartIdx += groupStructure[i].cutCount;
                  }
                  return (
                    <th
                      key={`group-${groupIdx}`}
                      className="px-3 py-1.5 text-center text-xs font-bold text-white uppercase tracking-wider border-r border-white/20 border-b border-white/20 align-bottom"
                      colSpan={group.cutCount}
                    >
                      {group.title}
                    </th>
                  );
                })}
              </tr>
              {/* Cut titles row with stat letters */}
              <tr>
                {columnData.slice(1).map((column, colIdx) => {
                  const actualColIdx = colIdx + 1; // +1 because we skip Total
                  const letter = getStatLetter(actualColIdx);
                  return (
                    <th
                      key={column.id}
                      className="px-3 py-1.5 text-center text-xs font-bold text-white uppercase tracking-wider border-r border-white/20 last:border-r-0"
                    >
                      <div>{column.cutTitle}</div>
                      {letter && <div className="text-xs font-medium mt-0.5">({letter})</div>}
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {/* Total Row */}
              <React.Fragment>
                <tr className="bg-gray-50 font-semibold">
                  <td className="px-3 py-1 text-xs text-gray-900 border-r border-gray-300" rowSpan={2}>Total</td>
                  {columnData.map((column, colIdx) => {
                    const totalCount = crossTabData.reduce((sum, row) => sum + (row[column.id]?.count || 0), 0);
                    return (
                      <td key={column.id} className="px-3 py-1 text-xs text-gray-900 text-center border-r border-gray-300 last:border-r-0">
                        {totalCount}
                        {totalCount < 15 && (
                          <span className="text-red-600 ml-1">*</span>
                        )}
                      </td>
                    );
                  })}
                </tr>
                <tr className="bg-gray-50 font-semibold">
                  {columnData.map((column, colIdx) => {
                    const totalCount = crossTabData.reduce((sum, row) => sum + (row[column.id]?.count || 0), 0);
                    const totalBase = crossTabData.length > 0 ? (crossTabData[0][column.id]?.base || 0) : 0;
                    const totalPercentage = totalBase > 0 ? (totalCount / totalBase) * 100 : 0;
                    return (
                      <td key={column.id} className="px-3 py-1 text-xs text-gray-900 text-center border-r border-gray-300 last:border-r-0">
                        {totalPercentage.toFixed(1)}%
                      </td>
                    );
                  })}
                </tr>
              </React.Fragment>
              {processedCrossTabData.map((row, rowIdx) => (
                <React.Fragment key={rowIdx}>
                  <tr 
                    className="hover:bg-gray-50"
                    data-row-index={rowIdx}
                    onMouseEnter={(e) => {
                      const nextRow = e.currentTarget.nextElementSibling as HTMLTableRowElement;
                      if (nextRow) nextRow.classList.add('bg-gray-50');
                    }}
                    onMouseLeave={(e) => {
                      const nextRow = e.currentTarget.nextElementSibling as HTMLTableRowElement;
                      if (nextRow) nextRow.classList.remove('bg-gray-50');
                    }}
                  >
                    <td className="px-3 py-1 text-xs text-gray-900 border-r border-gray-300" rowSpan={2}>
                      <div className="font-medium">{row.label}</div>
                    </td>
                    {columnData.map((column, colIdx) => {
                      const cell = row[column.id];
                      return (
                        <td key={column.id} className="px-3 py-1 text-xs text-gray-900 text-center border-r border-gray-300 last:border-r-0">
                          {cell.count}
                        </td>
                      );
                    })}
                  </tr>
                  <tr 
                    className="hover:bg-gray-50"
                    data-row-index={rowIdx}
                    onMouseEnter={(e) => {
                      const prevRow = e.currentTarget.previousElementSibling as HTMLTableRowElement;
                      if (prevRow) prevRow.classList.add('bg-gray-50');
                    }}
                    onMouseLeave={(e) => {
                      const prevRow = e.currentTarget.previousElementSibling as HTMLTableRowElement;
                      if (prevRow) prevRow.classList.remove('bg-gray-50');
                    }}
                  >
                    {columnData.map((column, colIdx) => {
                      const cell = row[column.id];
                      const significantDiffs = getSignificantDifferences[rowIdx]?.[colIdx] || [];
                      return (
                        <td key={column.id} className="px-3 py-1 text-xs text-gray-900 text-center border-r border-gray-300 last:border-r-0">
                          <div className="flex items-center justify-center gap-1">
                            <span>{cell.percentage.toFixed(1)}%</span>
                            {significantDiffs.length > 0 && (
                              <span className="text-xs font-bold text-red-600">
                                {significantDiffs.join('')}
                              </span>
                            )}
                          </div>
                        </td>
                      );
                    })}
                  </tr>
                </React.Fragment>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};

export default CrossTabDisplay;

