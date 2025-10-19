import React, { useState } from 'react';
import { PlusIcon, TrashIcon } from '@heroicons/react/24/outline';

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

  return (
    <div className="h-screen overflow-hidden flex flex-col w-full" style={{ background: BRAND.bg }}>
      <div className="p-6 border-b border-gray-200 bg-white flex-shrink-0 w-full">
        <div className="flex items-center justify-between mb-4">
          <h1 className="text-2xl font-bold" style={{ color: BRAND.gray }}>Statistical Testing</h1>
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
        </div>
        <p className="text-sm text-gray-600">
          Compare subgroup percentages and identify statistically significant differences.
          Values significantly higher than others will be marked with red letters.
        </p>
      </div>

      <div className="flex-1 overflow-auto p-6 w-full">
        <div className="bg-white rounded-lg border border-gray-200 overflow-auto w-full">
          <table className="w-full border-collapse">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-200">
                <th className="w-12 px-4 py-3 text-left text-xs font-semibold text-gray-600 border-r border-gray-200">
                  Subgroup
                </th>
                {columns.map((col) => (
                  <th key={col.id} className="px-4 py-3 text-center border-r border-gray-200 last:border-r-0">
                    <input
                      type="text"
                      value={col.title}
                      onChange={(e) => updateColumnTitle(col.id, e.target.value)}
                      placeholder="Subgroup Title"
                      className="w-full px-2 py-1 text-sm border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-orange-500"
                    />
                  </th>
                ))}
                <th className="w-16 px-4 py-3 border-r border-gray-200" rowSpan={3}>
                  <button
                    onClick={addColumn}
                    className="p-2 hover:bg-gray-100 rounded-lg transition-colors flex items-center justify-center mx-auto"
                    title="Add column"
                  >
                    <PlusIcon className="w-5 h-5 text-gray-600" />
                  </button>
                </th>
              </tr>
              <tr className="bg-gray-50 border-b border-gray-200">
                <th className="w-12 px-4 py-3 text-left text-xs font-semibold text-gray-600 border-r border-gray-200">
                  Sample
                </th>
                {columns.map((col) => (
                  <th key={`sample-${col.id}`} className="px-4 py-3 text-center border-r border-gray-200">
                    <input
                      type="text"
                      value={col.sampleSize}
                      onChange={(e) => {
                        const value = e.target.value;
                        if (value === '' || /^\d+$/.test(value)) {
                          updateColumnSampleSize(col.id, value);
                        }
                      }}
                      placeholder="0"
                      className="w-full px-2 py-1 text-sm text-center border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-orange-500"
                    />
                  </th>
                ))}
              </tr>
              <tr className="bg-gray-50 border-b border-gray-200">
                <th className="w-12 px-4 py-2 text-left text-xs font-semibold text-gray-600 border-r border-gray-200">
                </th>
                {columns.map((col) => (
                  <th key={`header-${col.id}`} className="px-4 py-2 text-center border-r border-gray-200">
                    <div className="flex items-center justify-center gap-2">
                      <span className="text-xs" style={{ color: BRAND.gray }}>
                        ({col.letter})
                      </span>
                      {columns.length > 2 && (
                        <button
                          onClick={() => removeColumn(col.id)}
                          className="p-1 hover:bg-red-50 rounded transition-colors"
                          title="Remove column"
                        >
                          <TrashIcon className="w-4 h-4 text-red-600" />
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
                    className={`border-b border-gray-200 last:border-b-0 ${isLastRow ? 'bg-gray-50' : 'hover:bg-gray-50'}`}
                  >
                    <td className={`px-4 py-2 text-center text-sm font-medium border-r border-gray-200 ${isLastRow ? 'text-gray-400' : 'text-gray-600'}`}>
                      {rowIndex + 1}
                    </td>
                    {columns.map((col, colIndex) => {
                      const significantDiffs = getSignificantDifferences(rowIndex, colIndex);
                      return (
                        <td key={col.id} className="px-4 py-2 border-r border-gray-200 last:border-r-0">
                          <div className="flex items-center justify-center gap-1">
                            <div className="flex items-center gap-1">
                              <input
                                type="text"
                                value={col.values[rowIndex] || ''}
                                onChange={(e) => updateCellValue(col.id, rowIndex, e.target.value)}
                                onFocus={(e) => e.target.placeholder = ''}
                                onBlur={(e) => e.target.placeholder = '0'}
                                placeholder="0"
                                className={`w-16 px-2 py-1 text-sm text-center border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-orange-500 ${isLastRow ? 'bg-gray-50' : ''}`}
                              />
                              <span className="text-sm text-gray-500">%</span>
                            </div>
                            {significantDiffs.length > 0 && (
                              <span className="text-xs font-bold text-red-600 ml-1">
                                {significantDiffs.join('')}
                              </span>
                            )}
                          </div>
                        </td>
                      );
                    })}
                    <td className="px-4 py-2"></td>
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
