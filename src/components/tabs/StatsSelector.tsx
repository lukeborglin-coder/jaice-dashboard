import React, { useRef, useEffect } from 'react';
import { Variable, VariableStatsSelection } from '../../utils/tabs/types';
import { XMarkIcon } from '@heroicons/react/24/outline';

interface StatsSelectorProps {
  variable: Variable;
  statsSelections: VariableStatsSelection;
  isNumericQuestion: boolean;
  isNumericGrid: boolean;
  isMultiSelect: boolean;
  isMultiSelectGrid: boolean;
  isSingleSelect: boolean;
  isSingleSelectGrid: boolean;
  isSortedByFrequency: boolean;
  isMultiSelectType: boolean;
  hasHoldSelection: boolean;
  holdSelectionArray: string[];
  responseOptions: Array<{ code: string; text: string }>;
  defaultHoldCodes: string[];
  statsOptionsForDisplay: Array<{ key: keyof VariableStatsSelection; label: string }>;
  statsHeaderSpacing: string;
  onToggleStatSelection: (variableName: string, key: keyof VariableStatsSelection) => void;
  onSortPreferenceChange: (variableName: string, value: 'default' | 'frequency', persistFalse?: boolean) => void;
  onHoldOptionsToggle: (variableName: string, enabled: boolean, defaultCodes?: string[]) => void;
  onOpenHoldOptionsDropdown: (variableName: string) => void;
  onCloseHoldOptionsDropdown: (variableName: string) => void;
  onHoldOptionSelection: (variableName: string, code: string) => void;
  holdOptionsDropdownOpen?: boolean;
  // Nets props for numeric grids
  netSummaryTableRanges?: Array<{ name: string; low: string; high: string; context?: string; globalIndex?: number }>;
  onAddInlineNumericNet?: (variableName: string) => void;
  onUpdateInlineNumericNet?: (variableName: string, index: number, key: 'name' | 'low' | 'high', value: string) => void;
  onRemoveInlineNumericNet?: (variableName: string, index: number) => void;
  // Nets props for single select
  netSummaryTableSelectedCodes?: Array<{ name: string; codes: string[] }>;
  variableTableSelections?: Set<string>;
  onToggleNetSelection?: (variableName: string, tableId: string) => void;
  onOpenNetSummaryModal?: (variableName: string, config?: { mode?: 'range' | 'codes'; responseOptions?: Array<{ code: string; text: string }>; initialName?: string; initialLow?: string; initialHigh?: string; initialCodes?: string[]; editingIndex?: number | null; }) => void;
  onEditNetSummary?: (variableName: string, netMeta: { type: 'range' | 'codes'; index: number }, responseOptions: Array<{ code: string; text: string }>) => void;
  BRAND_ORANGE?: string;
}

export const StatsSelector: React.FC<StatsSelectorProps> = ({
  variable,
  statsSelections,
  isNumericQuestion,
  isNumericGrid,
  isMultiSelect,
  isMultiSelectGrid,
  isSingleSelect,
  isSingleSelectGrid,
  isSortedByFrequency,
  isMultiSelectType,
  hasHoldSelection,
  holdSelectionArray,
  responseOptions,
  defaultHoldCodes,
  statsOptionsForDisplay,
  statsHeaderSpacing,
  onToggleStatSelection,
  onSortPreferenceChange,
  onHoldOptionsToggle,
  onOpenHoldOptionsDropdown,
  onCloseHoldOptionsDropdown,
  onHoldOptionSelection,
  holdOptionsDropdownOpen = false,
  netSummaryTableRanges = [],
  onAddInlineNumericNet,
  onUpdateInlineNumericNet,
  onRemoveInlineNumericNet,
  netSummaryTableSelectedCodes = [],
  variableTableSelections,
  onToggleNetSelection,
  onOpenNetSummaryModal,
  onEditNetSummary,
  BRAND_ORANGE = '#D14A2D',
}) => {
  const variableName = variable.name;
  const dropdownRef = useRef<HTMLDivElement>(null);
  
  // Filter out summary context nets (only show stats nets)
  const statsNetEntries = netSummaryTableRanges.filter(entry => entry.context !== 'summary');
  
  // Check if a net table is selected
  const isNetSelected = (tableId: string) => {
    return variableTableSelections?.has(tableId) || false;
  };

  // Close dropdown when clicking outside
  useEffect(() => {
    if (!holdOptionsDropdownOpen) return;

    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        onCloseHoldOptionsDropdown(variableName);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [holdOptionsDropdownOpen, variableName, onCloseHoldOptionsDropdown]);

  return (
    <>
      {/* Statistics Box */}
      {!(isMultiSelect || isMultiSelectGrid) && statsOptionsForDisplay.length > 0 && (
        <div className="rounded-2xl border border-gray-200 bg-white p-5 h-full flex flex-col">
          <div className="mb-4">
            <h4 className="text-base font-semibold text-gray-900">Statistics</h4>
            <p className="text-sm text-gray-600">Select which statistics to include.</p>
          </div>
          <div className="space-y-2">
            {statsOptionsForDisplay.map(option => (
              <label key={option.key} className="flex items-center gap-3 text-sm text-gray-800">
                <input
                  type="checkbox"
                  className="h-4 w-4 rounded border-gray-300 text-orange-600 focus:ring-orange-500"
                  checked={!!statsSelections[option.key]}
                  onClick={(e) => e.stopPropagation()}
                  onChange={(e) => {
                    e.stopPropagation();
                    onToggleStatSelection(variableName, option.key);
                  }}
                />
                <span>{option.label}</span>
              </label>
            ))}
            
            {/* Single Select Nets - show below mean (for both single select and single select grids) */}
            {(isSingleSelect || isSingleSelectGrid) && onToggleNetSelection && (
              <>
                <div className="mt-4 pt-4 border-t border-gray-200">
                  <div className="flex items-center justify-between mb-2">
                    <h5 className="text-sm font-semibold text-gray-900">Nets</h5>
                    {onOpenNetSummaryModal && (
                      <button
                        type="button"
                        className="text-xs font-semibold"
                        style={{ color: BRAND_ORANGE }}
                        onClick={() => onOpenNetSummaryModal(variableName, {
                          mode: 'codes',
                          responseOptions: responseOptions.map(opt => ({
                            code: opt.code || '',
                            text: opt.text || '',
                          })),
                        })}
                      >
                        + Add Net
                      </button>
                    )}
                  </div>
                  {netSummaryTableSelectedCodes.length === 0 ? (
                    <p className="text-xs text-gray-500">No nets defined. Click + Add Net to create one.</p>
                  ) : (
                    <div className="space-y-2">
                      {netSummaryTableSelectedCodes.map((net, idx) => {
                        const tableId = `${variableName}_NetSummaryTable_${idx}`;
                        const isSelected = isNetSelected(tableId);
                        return (
                          <label key={`${variableName}-net-${idx}`} className="flex items-center gap-3 text-sm text-gray-800">
                            <input
                              type="checkbox"
                              className="h-4 w-4 rounded border-gray-300 text-orange-600 focus:ring-orange-500"
                              checked={isSelected}
                              onClick={(e) => e.stopPropagation()}
                              onChange={(e) => {
                                e.stopPropagation();
                                onToggleNetSelection(variableName, tableId);
                              }}
                            />
                            <span className="flex-1">{net.name || `Net ${idx + 1}`}</span>
                            {onEditNetSummary && (
                              <button
                                type="button"
                                className="text-xs text-blue-600 hover:underline"
                                onClick={(e) => {
                                  e.preventDefault();
                                  e.stopPropagation();
                                  onEditNetSummary(variableName, { type: 'codes', index: idx }, responseOptions);
                                }}
                              >
                                Edit
                              </button>
                            )}
                          </label>
                        );
                      })}
                    </div>
                  )}
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* Options Box */}
      <div className="rounded-2xl border border-gray-200 bg-white p-5 h-full flex flex-col">
        <div className="mb-4">
          <h4 className="text-base font-semibold text-gray-900">Options</h4>
          <p className="text-sm text-gray-600">Configure sorting and other options.</p>
        </div>
        {!isNumericQuestion && !isNumericGrid && (
          <div className="space-y-3">
            <div className="flex items-center justify-between gap-3">
              <label className="flex items-center gap-3 text-sm text-gray-800 flex-1">
                <input
                  type="checkbox"
                  className="h-4 w-4 rounded border-gray-300 text-orange-600 focus:ring-orange-500"
                  checked={isSortedByFrequency}
                  onClick={(e) => e.stopPropagation()}
                  onChange={(e) => {
                    e.stopPropagation();
                    onSortPreferenceChange(variableName, isSortedByFrequency ? 'default' : 'frequency', isMultiSelectType);
                    // If disabling sort by frequency, also disable hold
                    if (isSortedByFrequency) {
                      onHoldOptionsToggle(variableName, false);
                      onCloseHoldOptionsDropdown(variableName);
                    }
                  }}
                />
                <span>Sort by frequency</span>
              </label>
              {isSortedByFrequency && (
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    // Enable hold if not already enabled
                    if (!hasHoldSelection) {
                      onHoldOptionsToggle(variableName, true, defaultHoldCodes);
                    }
                    // Toggle dropdown
                    if (holdOptionsDropdownOpen) {
                      onCloseHoldOptionsDropdown(variableName);
                    } else {
                      onOpenHoldOptionsDropdown(variableName);
                    }
                  }}
                  className="text-sm text-orange-600 font-semibold hover:text-orange-700 whitespace-nowrap"
                >
                  Holds ({holdSelectionArray.length})
                </button>
              )}
            </div>
            {/* Hold options dropdown */}
            {isSortedByFrequency && holdOptionsDropdownOpen && responseOptions.length > 0 && (
              <div ref={dropdownRef} className="mt-2 border border-gray-200 rounded-md bg-white shadow-lg max-h-64 overflow-y-auto z-10">
                <div className="p-2 space-y-1">
                  {responseOptions.map(option => {
                    const isChecked = holdSelectionArray.includes(option.code);
                    return (
                      <label
                        key={`hold-${option.code}`}
                        className="flex items-center gap-2 px-3 py-2 text-sm text-gray-800 hover:bg-gray-50 cursor-pointer rounded"
                      >
                        <input
                          type="checkbox"
                          className="h-4 w-4 rounded border-gray-300 text-orange-600 focus:ring-orange-500"
                          checked={isChecked}
                          onClick={(e) => e.stopPropagation()}
                          onChange={(e) => {
                            e.stopPropagation();
                            if (!hasHoldSelection) {
                              onHoldOptionsToggle(variableName, true, defaultHoldCodes);
                            }
                            onHoldOptionSelection(variableName, option.code);
                          }}
                        />
                        <span className="truncate">
                          <span className="font-mono text-xs text-gray-500 mr-2">{option.code}</span>
                          {option.text}
                        </span>
                      </label>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        )}
        
        {/* Numeric Grid/Question Nets */}
        {(isNumericQuestion || isNumericGrid) && onAddInlineNumericNet && onUpdateInlineNumericNet && onRemoveInlineNumericNet && (
          <div className="mt-4 space-y-3">
            <div className="flex items-center justify-between">
              <h5 className="text-sm font-semibold text-gray-900">Nets</h5>
              <button
                type="button"
                onClick={() => onAddInlineNumericNet(variableName)}
                className="text-sm font-medium text-orange-600 hover:text-orange-700"
              >
                + Net
              </button>
            </div>
            {statsNetEntries.length === 0 ? (
              <p className="text-xs text-gray-500">No nets defined. Click + Net to create one.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full border border-gray-200 text-sm">
                  <thead className="bg-gray-50 text-xs font-semibold text-gray-600">
                    <tr>
                      <th className="py-2 px-3 text-left border-b border-gray-200">Net Name</th>
                      <th className="py-2 px-3 text-center border-b border-gray-200 w-16">Low</th>
                      <th className="py-2 px-3 text-center border-b border-gray-200 w-16">High</th>
                      <th className="py-2 text-center border-b border-gray-200 w-12"> </th>
                    </tr>
                  </thead>
                  <tbody>
                    {statsNetEntries.map((net) => (
                      <tr key={`${variableName}-net-${net.globalIndex}`}>
                        <td className="py-2 px-3 border-b border-gray-200">
                          <input
                            type="text"
                            value={net.name}
                            onChange={(e) => onUpdateInlineNumericNet(variableName, net.globalIndex!, 'name', e.target.value)}
                            className="w-full border border-gray-300 rounded-md px-2 py-1 text-sm focus:outline-none focus:ring-1 focus:ring-orange-500"
                          />
                        </td>
                        <td className="py-2 px-2 border-b border-gray-200 text-center">
                          <input
                            type="text"
                            inputMode="decimal"
                            pattern="[0-9.-]*"
                            value={net.low}
                            onChange={(e) => onUpdateInlineNumericNet(variableName, net.globalIndex!, 'low', e.target.value.replace(/[^0-9.-]/g, ''))}
                            className="w-16 border border-gray-300 rounded-md px-2 py-1 text-sm text-center focus:outline-none focus:ring-1 focus:ring-orange-500"
                          />
                        </td>
                        <td className="py-2 px-2 border-b border-gray-200 text-center">
                          <input
                            type="text"
                            inputMode="decimal"
                            pattern="[0-9.-]*"
                            value={net.high}
                            onChange={(e) => onUpdateInlineNumericNet(variableName, net.globalIndex!, 'high', e.target.value.replace(/[^0-9.-]/g, ''))}
                            className="w-16 border border-gray-300 rounded-md px-2 py-1 text-sm text-center focus:outline-none focus:ring-1 focus:ring-orange-500"
                          />
                        </td>
                        <td className="py-2 border-b border-gray-200 text-center">
                          <button
                            type="button"
                            className="inline-flex items-center justify-center text-red-500 hover:text-red-600"
                            onClick={() => onRemoveInlineNumericNet(variableName, net.globalIndex!)}
                          >
                            <XMarkIcon className="h-4 w-4" />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
      </div>
    </>
  );
};
