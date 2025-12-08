import React, { useMemo, useState, useRef, useEffect } from 'react';
import { MagnifyingGlassIcon } from '@heroicons/react/24/outline';
import { Variable } from '../../utils/tabs/types';
import { getBaseQuestionNumber } from '../../utils/tabs/questionHelpers';

interface RawDataViewerProps {
  data: { columns: string[]; rows: any[] } | null;
  page: number;
  rowsPerPage: number;
  columnStart: number;
  columnsPerPage: number;
  onPageChange: (page: number) => void;
  onColumnChange: (start: number) => void;
  loading: boolean;
  columnMapping?: Record<string, string>;
  variables?: Variable[];
  questionnaireQuestions?: any[];
}

export const RawDataViewer: React.FC<RawDataViewerProps> = ({
  data,
  page,
  rowsPerPage,
  columnStart,
  columnsPerPage,
  onPageChange,
  onColumnChange,
  loading,
  columnMapping = {},
  variables = [],
  questionnaireQuestions = [],
}) => {
  const [rawDataSearch, setRawDataSearch] = useState('');
  const [showRawDataSuggestions, setShowRawDataSuggestions] = useState(false);
  const firstHeaderRowRef = useRef<HTMLTableRowElement>(null);
  const [secondRowTop, setSecondRowTop] = useState(40);

  // Helper function to get expected column headers for a base question number
  const getExpectedColumnHeadersForBase = useMemo(() => {
    return (baseNumber: string, vars: Variable[]): string[] => {
      const headers: string[] = [];
      const baseNum = baseNumber.replace(/^Q/i, '');
      
      vars.forEach(v => {
        if (v.name.endsWith('_Summary Tables') || 
            v.name.endsWith('_T2B') || 
            v.name.endsWith('_B2B') || 
            v.name.endsWith('_M3B') ||
            (v as any).isSummaryTable) {
          return;
        }
        
        const vBase = getBaseQuestionNumber(v.name);
        const vBaseNum = vBase.replace(/^Q/i, '');
        
        if (vBaseNum.toLowerCase() === baseNum.toLowerCase() || 
            vBase.toLowerCase() === baseNumber.toLowerCase()) {
          if (v.statements && Object.keys(v.statements).length > 0) {
            Object.keys(v.statements).forEach(stmtCode => {
              const normalized = /^r\d+/i.test(stmtCode) ? stmtCode : `r${stmtCode}`;
              headers.push(`Q${baseNum}${normalized}`);
            });
          } else if (v.codes && Object.keys(v.codes).length > 0) {
            headers.push(`Q${baseNum}`);
          } else {
            headers.push(`Q${baseNum}`);
          }
        }
      });
      
      return Array.from(new Set(headers));
    };
  }, []);

  // Process raw data
  const processedRawData = useMemo(() => {
    if (!data || !data.rows || data.rows.length === 0 || !columnMapping || variables.length === 0 || questionnaireQuestions.length === 0) {
      return { headers: [], rows: [] };
    }

    // Get all expected headers from all variables in QNR order
    const allExpectedHeaders: string[] = [];
    const expectedHeadersSet = new Set<string>();
    const processedBaseNumbers = new Set<string>();

    // First, iterate through questionnaireQuestions in order to preserve QNR order
    questionnaireQuestions.forEach((question) => {
      const qNum = question.number || question.id;
      const baseNumber = String(qNum);

      if (processedBaseNumbers.has(baseNumber)) {
        return;
      }
      processedBaseNumbers.add(baseNumber);

      const expectedHeaders = getExpectedColumnHeadersForBase(baseNumber, variables);
      expectedHeaders.forEach(header => {
        if (!expectedHeadersSet.has(header)) {
          expectedHeadersSet.add(header);
          allExpectedHeaders.push(header);
        }
      });
    });

    // Then, handle any variables that might not be in questionnaireQuestions
    variables.forEach((variable) => {
      if (variable.name.endsWith('_Summary Tables') ||
          variable.name.endsWith('_T2B') ||
          variable.name.endsWith('_B2B') ||
          variable.name.endsWith('_M3B') ||
          (variable as any).isSummaryTable) {
        return;
      }

      const baseNumber = getBaseQuestionNumber(variable.name);

      if (processedBaseNumbers.has(baseNumber)) {
        return;
      }

      const question = questionnaireQuestions.find(q => {
        const qNum = q.number || q.id;
        return qNum === baseNumber ||
               qNum === baseNumber.replace(/^Q/, '') ||
               String(qNum) === String(baseNumber);
      });

      if (!question) {
        processedBaseNumbers.add(baseNumber);
        const expectedHeaders = getExpectedColumnHeadersForBase(baseNumber, variables);
        expectedHeaders.forEach(header => {
          if (!expectedHeadersSet.has(header)) {
            expectedHeadersSet.add(header);
            allExpectedHeaders.push(header);
          }
        });
      }
    });

    // Always include "record" as the first column if it exists in the data
    const finalHeaders: string[] = [];
    if (data.columns && data.columns.includes('record')) {
      finalHeaders.push('record');
    }
    finalHeaders.push(...allExpectedHeaders);

    // Process data rows - only include rows that have a record/respno value
    const dataRows: Record<string, any>[] = [];
    data.rows.forEach((rawRow: any) => {
      const recordValue = rawRow['record'] ?? rawRow['respno'] ?? rawRow['Record'] ?? rawRow['Respno'] ?? rawRow['RECORD'] ?? rawRow['RESPNO'];
      if (recordValue === null || recordValue === undefined || recordValue === '' || (typeof recordValue === 'string' && recordValue.trim() === '')) {
        return;
      }

      const row: Record<string, any> = {};

      finalHeaders.forEach((expectedHeader) => {
        if (expectedHeader === 'record') {
          row[expectedHeader] = recordValue;
        } else {
          const isCodedColumn = /^[a-z0-9]+r\d+$/i.test(expectedHeader);

          if (isCodedColumn) {
            if (rawRow.hasOwnProperty(expectedHeader)) {
              const value = rawRow[expectedHeader];
              row[expectedHeader] = value;
            } else {
              row[expectedHeader] = null;
            }
          } else {
            const mappedColumnHeader = columnMapping[expectedHeader];
            if (mappedColumnHeader && rawRow.hasOwnProperty(mappedColumnHeader)) {
              const value = rawRow[mappedColumnHeader];
              if (value === null || value === undefined || value === '' || (typeof value === 'string' && value.trim() === '')) {
                row[expectedHeader] = null;
              } else {
                row[expectedHeader] = value;
              }
            } else {
              row[expectedHeader] = null;
            }
          }
        }
      });

      dataRows.push(row);
    });

    return {
      headers: finalHeaders,
      rows: dataRows,
    };
  }, [data, columnMapping, variables, questionnaireQuestions, getExpectedColumnHeadersForBase]);

  // Compute visible headers (needed for useEffect, must be before early returns)
  const allColumns = data?.columns || [];
  const firstColumnKey = allColumns.find(col => {
    const colLower = String(col).toLowerCase().trim();
    return colLower === 'respono' || colLower === 'record' || colLower === 'respno';
  }) || allColumns[0];
  const firstColumnIndex = firstColumnKey ? allColumns.indexOf(firstColumnKey) : 0;
  const firstColumn = firstColumnKey ? [firstColumnKey] : [];
  const otherColumns = allColumns.filter((col, idx) => idx !== firstColumnIndex);
  const columnsPerPageCount = 10;
  const currentColumnPage = Math.floor(columnStart / columnsPerPageCount);
  const startIdx = currentColumnPage * columnsPerPageCount;
  const endIdx = Math.min(startIdx + columnsPerPageCount, otherColumns.length);
  const visibleOtherColumns = otherColumns.slice(startIdx, endIdx);
  const visibleHeaders = [...firstColumn, ...visibleOtherColumns];

  // Measure first row height and set second row position (must be before early returns)
  useEffect(() => {
    if (firstHeaderRowRef.current) {
      const height = firstHeaderRowRef.current.offsetHeight;
      setSecondRowTop(height);
    }
  }, [visibleHeaders]);

  // Show loading state
  if (loading) {
    return <div className="text-center py-8 text-gray-500">Loading data...</div>;
  }

  // Show message if no data
  if (!data || !data.rows || data.rows.length === 0) {
    return (
      <div className="text-center py-8">
        <p className="text-sm text-gray-500">No data available. Please upload a data file first.</p>
      </div>
    );
  }

  const allRows = data.rows || [];
  const totalColumnPages = Math.ceil(otherColumns.length / columnsPerPageCount);
  const canGoBack = columnStart > 0;
  const canGoForward = endIdx < otherColumns.length;

  // Filter headers that match the search
  const matchingHeaders = rawDataSearch.trim()
    ? allColumns.filter(header => {
        const headerLower = String(header).toLowerCase();
        const searchLower = rawDataSearch.toLowerCase().trim();
        return headerLower.includes(searchLower);
      }).slice(0, 10)
    : [];

  return (
    <div>
      <div className="mb-3 flex items-center gap-3">
        <div className="relative flex-1">
          <MagnifyingGlassIcon className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-gray-400" />
          <input
            type="text"
            id="raw-data-search"
            name="raw-data-search"
            placeholder="Search raw data columns..."
            value={rawDataSearch}
            onChange={(e) => {
              setRawDataSearch(e.target.value);
              setShowRawDataSuggestions(e.target.value.trim().length > 0);
            }}
            onFocus={() => {
              if (rawDataSearch.trim().length > 0) {
                setShowRawDataSuggestions(true);
              }
            }}
            onBlur={() => {
              setTimeout(() => setShowRawDataSuggestions(false), 200);
            }}
            className="w-full pl-10 pr-4 py-2 text-sm border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-orange-500 focus:border-transparent"
          />
          {showRawDataSuggestions && matchingHeaders.length > 0 && (
            <div className="absolute z-50 w-full mt-1 bg-white border border-gray-300 rounded-md shadow-lg max-h-60 overflow-y-auto">
              {matchingHeaders.map((header, idx) => {
                return (
                  <div
                    key={idx}
                    onClick={() => {
                      // Scroll to column if needed (could implement smooth scroll)
                      setShowRawDataSuggestions(false);
                    }}
                    className="px-4 py-2 hover:bg-gray-100 cursor-pointer border-b border-gray-100 last:border-b-0"
                  >
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-medium text-gray-900">{header}</span>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
        {otherColumns.length > columnsPerPageCount && (
          <div className="flex items-center gap-2">
            <button
              onClick={() => onColumnChange(Math.max(0, columnStart - columnsPerPageCount))}
              disabled={!canGoBack}
              className="px-3 py-1.5 text-sm bg-white border border-gray-300 rounded hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              ← Back
            </button>
            <span className="text-sm text-gray-600 whitespace-nowrap">
              Page {currentColumnPage + 1} of {totalColumnPages}
            </span>
            <button
              onClick={() => onColumnChange(Math.min(otherColumns.length - columnsPerPageCount, columnStart + columnsPerPageCount))}
              disabled={!canGoForward}
              className="px-3 py-1.5 text-sm bg-white border border-gray-300 rounded hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              Forward →
            </button>
          </div>
        )}
      </div>

      <div className="border border-gray-200 rounded-lg overflow-hidden" style={{ maxHeight: 'calc(100vh - 250px)' }}>
        <div className="overflow-x-auto overflow-y-auto" style={{ maxHeight: 'calc(100vh - 250px)' }}>
          <table className="divide-y divide-gray-200" style={{ tableLayout: 'fixed', width: '100%' }}>
            <colgroup>
              {visibleHeaders.map((_, idx) => {
                // All columns get equal width
                const columnWidth = `${100 / visibleHeaders.length}%`;
                return (
                  <col key={idx} style={{ width: columnWidth }} />
                );
              })}
            </colgroup>
            <thead className="bg-gray-50">
              <tr ref={firstHeaderRowRef} className="sticky top-0 z-20">
                {visibleHeaders.map((header, idx) => {
                  const isFirstColumn = idx === 0;
                  return (
                    <th
                      key={idx}
                      className={`px-4 py-3 text-left text-xs font-medium text-gray-500 tracking-wider whitespace-nowrap bg-gray-50 ${
                        isFirstColumn ? 'sticky left-0 z-30 shadow-[2px_0_4px_rgba(0,0,0,0.1)]' : 'z-20'
                      }`}
                      style={{ borderBottom: 'none' }}
                    >
                      <div className="truncate" title={String(header)}>
                        {header}
                      </div>
                    </th>
                  );
                })}
              </tr>
              <tr className="bg-gray-100 sticky" style={{ top: `${secondRowTop}px`, zIndex: 20 }}>
                {visibleHeaders.map((header, idx) => {
                  const isFirstColumn = idx === 0;
                  
                  // Find the expected variable that maps to this column header
                  // columnMapping is { expectedVariable: columnHeader }
                  // We need to reverse lookup: find expectedVariable where columnHeader === header
                  let mappedVariable = '';
                  if (columnMapping && Object.keys(columnMapping).length > 0) {
                    const headerStr = String(header);
                    // Check for exact match
                    const mappingEntry = Object.entries(columnMapping).find(
                      ([expectedVar, mappedCol]) => String(mappedCol) === headerStr
                    );
                    if (mappingEntry) {
                      mappedVariable = mappingEntry[0];
                    } else {
                      // Try case-insensitive match
                      const headerLower = headerStr.toLowerCase().trim();
                      const mappingEntryCaseInsensitive = Object.entries(columnMapping).find(
                        ([expectedVar, mappedCol]) => String(mappedCol).toLowerCase().trim() === headerLower
                      );
                      if (mappingEntryCaseInsensitive) {
                        mappedVariable = mappingEntryCaseInsensitive[0];
                      }
                    }
                  }
                  
                  return (
                    <th
                      key={idx}
                      className={`px-4 py-2 text-left text-xs font-normal text-gray-600 whitespace-nowrap bg-gray-100 border-b border-gray-200 ${
                        isFirstColumn ? 'sticky left-0 z-30 shadow-[2px_0_4px_rgba(0,0,0,0.1)]' : 'z-20'
                      }`}
                    >
                      <div className="truncate" title={mappedVariable || '-'}>
                        {mappedVariable || '-'}
                      </div>
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {allRows.length > 0 ? (
                allRows.map((row, rowIdx) => {
                  return (
                    <tr key={rowIdx} className="hover:bg-gray-50">
                      {visibleHeaders.map((header, colIdx) => {
                        const isFirstColumn = colIdx === 0;
                        const cellValue = row[header];
                        const displayValue = (cellValue === null || cellValue === undefined || cellValue === '')
                          ? '-'
                          : String(cellValue);

                        return (
                          <td
                            key={colIdx}
                            className={`px-4 py-3 text-sm text-gray-500 whitespace-nowrap ${
                              isFirstColumn 
                                ? 'sticky left-0 z-10 bg-white hover:bg-gray-50 shadow-[2px_0_4px_rgba(0,0,0,0.1)]' 
                                : 'bg-white'
                            }`}
                          >
                            <div className="truncate" title={displayValue}>
                              {displayValue}
                            </div>
                          </td>
                        );
                      })}
                    </tr>
                  );
                })
              ) : (
                <tr>
                  <td colSpan={visibleHeaders.length} className="px-4 py-8 text-center text-sm text-gray-500">
                    No data available.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
