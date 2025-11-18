import React, { useState, useRef, useEffect } from 'react';
import { PlusIcon, TrashIcon, ArrowDownTrayIcon } from '@heroicons/react/24/outline';

const BRAND = {
  orange: "#D14A2D",
  gray: "#5D5F62",
  bg: "#FBFBFB"
};

interface Column {
  id: string;
  letter: string;
  title: string;
  sampleSize: string;
  values: string[];
}

interface SignificantDifference {
  rowIndex: number;
  colIndex: number;
  higherThanColumns: string[];
}

const StatTesting: React.FC = () => {
  const [confidenceLevel, setConfidenceLevel] = useState<95 | 90 | 80>(95);
  const [columns, setColumns] = useState<Column[]>([
    { id: '1', letter: 'A', title: '', sampleSize: '', values: [''] },
    { id: '2', letter: 'B', title: '', sampleSize: '', values: [''] }
  ]);

  // Calculate the number of rows needed (filled rows + 1 empty row)
  const getNumRows = (): number => {
    let maxFilledRow = 0;
    columns.forEach(col => {
      for (let i = col.values.length - 1; i >= 0; i--) {
        if (col.values[i] !== '') {
          maxFilledRow = Math.max(maxFilledRow, i);
          break;
        }
      }
    });
    return maxFilledRow + 2; // +1 for next empty row, +1 because index starts at 0
  };

  const numRows = getNumRows();

  // Calculate z-score based on confidence level
  const getZScore = (level: 95 | 90 | 80): number => {
    switch (level) {
      case 95: return 1.96;
      case 90: return 1.645;
      case 80: return 1.282;
    }
  };

  // Calculate if difference is statistically significant
  const isSignificant = (p1: number, n1: number, p2: number, n2: number): boolean => {
    if (!n1 || !n2 || n1 <= 0 || n2 <= 0) return false;

    // Convert percentages to proportions
    const prop1 = p1 / 100;
    const prop2 = p2 / 100;

    // Calculate pooled proportion
    const pooledProp = (prop1 * n1 + prop2 * n2) / (n1 + n2);

    // Calculate standard error
    const se = Math.sqrt(pooledProp * (1 - pooledProp) * (1/n1 + 1/n2));

    // Calculate z-statistic
    const z = Math.abs(prop1 - prop2) / se;

    // Compare to critical value
    return z > getZScore(confidenceLevel);
  };

  // Get significant differences for a cell
  const getSignificantDifferences = (rowIndex: number, colIndex: number): string[] => {
    const currentCol = columns[colIndex];
    const currentValue = parseFloat(currentCol.values[rowIndex]);
    const currentSampleSize = parseInt(currentCol.sampleSize);

    if (isNaN(currentValue) || isNaN(currentSampleSize)) return [];

    const higherThanColumns: string[] = [];

    columns.forEach((otherCol, otherColIndex) => {
      if (otherColIndex === colIndex) return;

      const otherValue = parseFloat(otherCol.values[rowIndex]);
      const otherSampleSize = parseInt(otherCol.sampleSize);

      if (isNaN(otherValue) || isNaN(otherSampleSize)) return;

      // Check if current value is significantly higher than other value
      if (currentValue > otherValue && isSignificant(currentValue, currentSampleSize, otherValue, otherSampleSize)) {
        higherThanColumns.push(otherCol.letter);
      }
    });

    return higherThanColumns;
  };

  const addColumn = () => {
    const nextLetter = String.fromCharCode(65 + columns.length); // A=65, B=66, etc.
    // Match the number of rows in existing columns
    const currentNumRows = columns[0]?.values.length || 1;
    setColumns([...columns, {
      id: Date.now().toString(),
      letter: nextLetter,
      title: '',
      sampleSize: '',
      values: Array(currentNumRows).fill('')
    }]);
  };

  const removeColumn = (id: string) => {
    if (columns.length <= 2) return; // Keep at least 2 columns
    const newColumns = columns.filter(col => col.id !== id);
    // Reassign letters
    newColumns.forEach((col, index) => {
      col.letter = String.fromCharCode(65 + index);
    });
    setColumns(newColumns);
  };

  const updateColumnTitle = (id: string, title: string) => {
    setColumns(columns.map(col =>
      col.id === id ? { ...col, title } : col
    ));
  };

  const updateColumnSampleSize = (id: string, sampleSize: string) => {
    setColumns(columns.map(col =>
      col.id === id ? { ...col, sampleSize } : col
    ));
  };

  const updateCellValue = (colId: string, rowIndex: number, value: string) => {
    // Allow empty string
    if (value === '') {
      setColumns(columns.map(col => {
        const newValues = [...col.values];
        while (newValues.length <= rowIndex) {
          newValues.push('');
        }
        if (col.id === colId) {
          newValues[rowIndex] = value;
        }
        return { ...col, values: newValues };
      }));
      return;
    }

    // Only allow numbers (no decimals), max 3 digits
    if (!/^\d{1,3}$/.test(value)) return;

    // Check if value is between 0-100
    const numValue = parseInt(value);
    if (numValue < 0 || numValue > 100) return;

    setColumns(columns.map(col => {
      const newValues = [...col.values];

      // Ensure the array is long enough
      while (newValues.length <= rowIndex) {
        newValues.push('');
      }

      if (col.id === colId) {
        newValues[rowIndex] = value;
      }

      return { ...col, values: newValues };
    }));
  };

  // Handle paste event for Excel-like copy/paste
  const handlePaste = (e: React.ClipboardEvent, startColIndex: number, startRowIndex: number) => {
    e.preventDefault();
    const pastedData = e.clipboardData.getData('text');
    
    // Parse tab-separated values (Excel format)
    const rows = pastedData.split(/\r?\n/).filter(row => row.trim() !== '');
    const pasteData: string[][] = rows.map(row => row.split(/\t/));

    if (pasteData.length === 0) return;

    setColumns(prevColumns => {
      const newColumns = prevColumns.map((col, colIndex) => {
        const newValues = [...col.values];
        
        pasteData.forEach((row, rowOffset) => {
          const targetRowIndex = startRowIndex + rowOffset;
          const targetColIndex = colIndex - startColIndex;
          
          // Only paste if we have data for this column
          if (targetColIndex >= 0 && targetColIndex < row.length) {
            const cellValue = row[targetColIndex].trim();
            
            // Ensure array is long enough
            while (newValues.length <= targetRowIndex) {
              newValues.push('');
            }
            
            // Validate and set value
            if (cellValue === '') {
              newValues[targetRowIndex] = '';
            } else {
              // Remove % sign if present
              const cleanValue = cellValue.replace('%', '').trim();
              // Only allow numbers 0-100
              if (/^\d{1,3}$/.test(cleanValue)) {
                const numValue = parseInt(cleanValue);
                if (numValue >= 0 && numValue <= 100) {
                  newValues[targetRowIndex] = cleanValue;
                }
              }
            }
          }
        });
        
        return { ...col, values: newValues };
      });
      
      return newColumns;
    });
  };

  const exportToExcel = () => {
    // Create CSV content with proper formatting
    let csvContent = '';
    
    // Add BOM for proper UTF-8 encoding
    csvContent = '\uFEFF';
    
    // Add row 1: Subgroup titles
    csvContent += 'Subgroup,';
    columns.forEach((col, index) => {
      const title = col.title || `Subgroup ${col.letter}`;
      csvContent += `"${title}"`;
      if (index < columns.length - 1) csvContent += ',';
    });
    csvContent += '\n';
    
    // Add row 2: Sample sizes
    csvContent += 'Sample Size,';
    columns.forEach((col, index) => {
      const sampleSize = col.sampleSize || '';
      csvContent += `"${sampleSize}"`;
      if (index < columns.length - 1) csvContent += ',';
    });
    csvContent += '\n';
    
    // Add row 3: Column letters (A, B, C, etc.)
    csvContent += ',';
    columns.forEach((col, index) => {
      csvContent += `"(${col.letter})"`;
      if (index < columns.length - 1) csvContent += ',';
    });
    csvContent += '\n';
    
    // Add data rows with statistical significance
    const numRows = getNumRows();
    for (let rowIndex = 0; rowIndex < numRows; rowIndex++) {
      csvContent += `${rowIndex + 1},`;
      
      columns.forEach((col, colIndex) => {
        const value = col.values[rowIndex] || '';
        const significantDiffs = getSignificantDifferences(rowIndex, colIndex);
        const hasSignificance = significantDiffs.length > 0;
        
        let cellContent = value;
        if (value && !isNaN(parseFloat(value))) {
          cellContent = `${value}%`;
        }
        
        if (hasSignificance) {
          cellContent += ` (${significantDiffs.join(', ')})`;
        }
        
        csvContent += `"${cellContent}"`;
        if (colIndex < columns.length - 1) csvContent += ',';
      });
      
      csvContent += '\n';
    }
    
    // Create and download the file
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    const url = URL.createObjectURL(blob);
    link.setAttribute('href', url);
    link.setAttribute('download', 'statistical_testing_data.csv');
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  return (
    <div className="h-screen overflow-hidden flex flex-col w-full" style={{ background: BRAND.bg, marginTop: '80px', height: 'calc(100vh - 80px)' }}>
      <div className="flex-1 overflow-auto p-6 w-full">
        {/* Confidence Level Controls */}
        <div className="mb-4 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <label className="text-sm font-medium" style={{ color: BRAND.gray }}>
              Confidence Level:
            </label>
            <select
              value={confidenceLevel}
              onChange={(e) => setConfidenceLevel(parseInt(e.target.value) as 95 | 90 | 80)}
              className="px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-orange-500"
            >
              <option value={95}>95%</option>
              <option value={90}>90%</option>
              <option value={80}>80%</option>
            </select>
          </div>
          <button
            onClick={exportToExcel}
            className="flex items-center gap-2 px-4 py-2 bg-white border border-gray-300 rounded-lg text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors"
          >
            <ArrowDownTrayIcon className="h-4 w-4" />
            Export to Excel
          </button>
        </div>
        
        <div className="bg-white rounded-lg border border-gray-300 overflow-auto w-full shadow-sm">
          <table className="border-collapse" style={{ width: 'auto', minWidth: '100%' }}>
            <thead>
              <tr className="bg-gray-100 border-b-2 border-gray-400">
                <th className="w-12 px-2 py-2 text-center border-r-2 border-gray-400 bg-gray-200 font-semibold text-xs text-gray-700 sticky left-0 z-10">
                  #
                </th>
                {columns.map((col) => (
                  <th key={col.id} className="px-3 py-2 text-center border-r border-gray-300 min-w-[150px]">
                    <input
                      type="text"
                      value={col.title}
                      onChange={(e) => updateColumnTitle(col.id, e.target.value)}
                      placeholder="Subgroup Title"
                      className="w-full px-2 py-1 text-xs border border-gray-400 rounded-none focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-center bg-white"
                      style={{ fontFamily: 'inherit' }}
                    />
                  </th>
                ))}
                <th className="w-12 px-2 py-2 border-r-2 border-gray-400 bg-gray-200" rowSpan={3}>
                  <button
                    onClick={addColumn}
                    className="p-1 hover:bg-gray-300 rounded transition-colors flex items-center justify-center mx-auto w-full h-full"
                    title="Add column"
                  >
                    <PlusIcon className="w-4 h-4 text-gray-700" />
                  </button>
                </th>
              </tr>
              <tr className="bg-gray-100 border-b border-gray-300">
                <th className="px-2 py-2 text-center border-r-2 border-gray-400 bg-gray-200 sticky left-0 z-10"></th>
                {columns.map((col) => (
                  <th key={`sample-${col.id}`} className="px-3 py-2 text-center border-r border-gray-300">
                    <input
                      type="text"
                      value={col.sampleSize}
                      onChange={(e) => {
                        const value = e.target.value;
                        if (value === '' || /^\d+$/.test(value)) {
                          updateColumnSampleSize(col.id, value);
                        }
                      }}
                      placeholder="n="
                      className="w-full px-2 py-1 text-xs text-center border border-gray-400 rounded-none focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 bg-white"
                      style={{ fontFamily: 'inherit' }}
                    />
                  </th>
                ))}
              </tr>
              <tr className="bg-gray-100 border-b-2 border-gray-400">
                <th className="px-2 py-2 text-center border-r-2 border-gray-400 bg-gray-200 sticky left-0 z-10"></th>
                {columns.map((col) => (
                  <th key={`header-${col.id}`} className="px-3 py-2 text-center border-r border-gray-300">
                    <div className="flex items-center justify-center gap-2">
                      <span className="text-xs font-semibold" style={{ color: BRAND.gray }}>
                        ({col.letter})
                      </span>
                      {columns.length > 2 && (
                        <button
                          onClick={() => removeColumn(col.id)}
                          className="p-1 hover:bg-red-100 rounded transition-colors"
                          title="Remove column"
                        >
                          <TrashIcon className="w-3 h-3 text-red-600" />
                        </button>
                      )}
                    </div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {Array.from({ length: numRows }).map((_, rowIndex) => {
                // Check if this is the last (empty) row
                const isEmptyRow = rowIndex === numRows - 1;
                const isRowEmpty = columns.every(col => !col.values[rowIndex] || col.values[rowIndex] === '');
                const isLastRow = isEmptyRow && isRowEmpty;

                return (
                  <tr
                    key={rowIndex}
                    className={`${isLastRow ? 'bg-gray-50' : 'hover:bg-blue-50'} transition-colors`}
                  >
                    <td className="px-2 py-1 text-center border-r-2 border-gray-400 border-b border-gray-300 bg-gray-200 font-semibold text-xs text-gray-700 sticky left-0 z-10">
                      {rowIndex + 1}
                    </td>
                    {columns.map((col, colIndex) => {
                      const significantDiffs = getSignificantDifferences(rowIndex, colIndex);
                      const cellValue = col.values[rowIndex] || '';
                      return (
                        <td key={col.id} className="px-0 py-0 border-r border-gray-300 border-b border-gray-300 relative group" style={{ minWidth: '100px' }}>
                          <div className="flex items-center justify-center h-full relative">
                            <input
                              type="text"
                              value={cellValue}
                              onChange={(e) => updateCellValue(col.id, rowIndex, e.target.value)}
                              onPaste={(e) => handlePaste(e, colIndex, rowIndex)}
                              onFocus={(e) => {
                                e.target.placeholder = '';
                                e.target.select();
                              }}
                              onBlur={(e) => e.target.placeholder = ''}
                              placeholder=""
                              className={`w-full px-2 py-1.5 text-sm text-center border-0 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:z-20 relative bg-transparent ${isLastRow ? 'bg-gray-50' : ''}`}
                              style={{ 
                                fontFamily: 'inherit',
                                minHeight: '28px'
                              }}
                            />
                            {cellValue && (
                              <span className="absolute right-2 top-1/2 transform -translate-y-1/2 text-xs text-gray-500 pointer-events-none">
                                %
                              </span>
                            )}
                            {significantDiffs.length > 0 && (
                              <span className="absolute top-0.5 right-8 text-xs font-bold text-red-600 pointer-events-none whitespace-nowrap">
                                ({significantDiffs.join(',')})
                              </span>
                            )}
                          </div>
                        </td>
                      );
                    })}
                    <td className="px-2 py-1 border-r-2 border-gray-400 border-b border-gray-300 bg-gray-200"></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};

export default StatTesting;
