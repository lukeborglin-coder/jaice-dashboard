import React from 'react';
import { Variable } from '../../utils/tabs/types';

interface TableOption {
  id: string;
  label: string;
  disabled?: boolean;
  helperText?: string;
  pill?: string;
  netMeta?: { type: 'range' | 'codes'; index: number };
}

interface TableSelectorProps {
  variable: Variable;
  individualTableOptions: TableOption[];
  summaryTableOptions: TableOption[];
  singleSelectNetTableOptions: TableOption[];
  allTableOptionIds: string[];
  computedDefaultSelectedTableIds: string[];
  isTableSelected: (tableName: string) => boolean;
  variableTableSelections: Set<string>;
  summaryTableSortSelections: Set<string>;
  summarySortDefaultsToOn: boolean;
  isMultiSelectGrid: boolean;
  isOpenEndType: boolean;
  isOpenEndListType: boolean;
  isSingleSelectGrid: boolean;
  isNumericGrid: boolean;
  isNumericQuestion: boolean;
  isSingleSelect: boolean;
  showSummaryPillColumn: boolean;
  summaryTableGridTemplate: string;
  showNetSummaryLink: boolean;
  responseOptions: Array<{ code: string; text: string }>;
  netSummaryTableRanges: Array<{ name: string; low: string; high: string; context?: string; globalIndex?: number }>;
  netSummaryTableSelectedCodes: Array<{ name: string; codes: string[] }>;
  variableHoldResponseCodes: string[];
  holdOptionsDropdownOpen: boolean;
  onToggleIndividualTable: (variableName: string, tableName: string, allTableNames: string[], initialSelectedNames?: string[]) => void;
  onSelectTable: (variableName: string, tableName: string) => void;
  onRemoveSummarySortSelection: (variableName: string, tableName: string) => void;
  onSummaryTableSortToggle: (variableName: string, tableName: string, defaultOn: boolean) => void;
  onHoldOptionsToggle: (variableName: string, enabled: boolean, defaultCodes?: string[]) => void;
  onOpenHoldOptionsDropdown: (variableName: string) => void;
  onCloseHoldOptionsDropdown: (variableName: string) => void;
  onHoldOptionSelection: (variableName: string, code: string) => void;
  onOpenNetSummaryModal: (variableName: string, config?: { mode?: 'range' | 'codes'; responseOptions?: Array<{ code: string; text: string }>; initialName?: string; initialLow?: string; initialHigh?: string; initialCodes?: string[]; editingIndex?: number | null; }) => void;
  onEditNetSummary: (variableName: string, netMeta: { type: 'range' | 'codes'; index: number }, responseOptions: Array<{ code: string; text: string }>) => void;
  onAddInlineNumericNet: (variableName: string) => void;
  onUpdateInlineNumericNet: (variableName: string, index: number, key: 'name' | 'low' | 'high', value: string) => void;
  onRemoveInlineNumericNet: (variableName: string, index: number) => void;
  defaultHoldCodes: string[];
  BRAND_ORANGE: string;
}

export const TableSelector: React.FC<TableSelectorProps> = ({
  variable,
  individualTableOptions,
  summaryTableOptions,
  singleSelectNetTableOptions,
  allTableOptionIds,
  computedDefaultSelectedTableIds,
  isTableSelected,
  variableTableSelections,
  summaryTableSortSelections,
  summarySortDefaultsToOn,
  isMultiSelectGrid,
  isOpenEndType,
  isOpenEndListType,
  isSingleSelectGrid,
  isNumericGrid,
  isNumericQuestion,
  isSingleSelect,
  showSummaryPillColumn,
  summaryTableGridTemplate,
  showNetSummaryLink,
  responseOptions,
  netSummaryTableRanges,
  netSummaryTableSelectedCodes,
  variableHoldResponseCodes,
  holdOptionsDropdownOpen,
  onToggleIndividualTable,
  onSelectTable,
  onRemoveSummarySortSelection,
  onSummaryTableSortToggle,
  onHoldOptionsToggle,
  onOpenHoldOptionsDropdown,
  onCloseHoldOptionsDropdown,
  onHoldOptionSelection,
  onOpenNetSummaryModal,
  onEditNetSummary,
  onAddInlineNumericNet,
  onUpdateInlineNumericNet,
  onRemoveInlineNumericNet,
  defaultHoldCodes,
  BRAND_ORANGE,
}) => {
  const variableName = variable.name;
  const holdSelectionArray = variableHoldResponseCodes && variableHoldResponseCodes.length > 0
    ? variableHoldResponseCodes
    : defaultHoldCodes;
  const hasHoldSelection = holdSelectionArray.length > 0;
  const statsNetEntries = netSummaryTableRanges.filter(entry => entry.context === 'summary' ? false : true);

  return (
    <>
      {/* Summary Tables Section */}
      {summaryTableOptions.length > 0 && (
        <div className="rounded-2xl border border-gray-200 bg-white p-5">
          <div className="mb-4 flex items-start justify-between gap-3">
            <div>
              <h4 className="text-base font-semibold text-gray-900">Summary Tables</h4>
              <p className="text-sm text-gray-600">Select which summary tables to include for this question.</p>
            </div>
          </div>
          <div className="space-y-2 rounded-lg">
            {summaryTableOptions.map(option => {
              const isSelected = isTableSelected(option.id);
              const isSortChecked = summaryTableSortSelections
                ? (summarySortDefaultsToOn ? !summaryTableSortSelections.has(option.id) : summaryTableSortSelections.has(option.id))
                : summarySortDefaultsToOn;
              const pillClassBase = 'text-xs font-semibold px-3 py-0.5 rounded-full min-w-[120px] text-center whitespace-nowrap';
              const pillClass = option.pill
                ? `${pillClassBase} text-blue-700 bg-blue-50 border border-blue-100`
                : pillClassBase;
              const pillContent = option.pill ? (
                option.netMeta ? (
                  <button
                    type="button"
                    className={`${pillClass} hover:bg-blue-100`}
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      onEditNetSummary(variableName, option.netMeta!, responseOptions);
                    }}
                  >
                    {option.pill}
                  </button>
                ) : (
                  <span className={pillClass}>{option.pill}</span>
                )
              ) : null;
              return (
                <div
                  key={option.id}
                  className="grid items-center bg-white text-sm text-gray-800 rounded-lg border border-gray-200"
                  style={{ gridTemplateColumns: summaryTableGridTemplate }}
                >
                  <label className="flex items-center gap-3 cursor-pointer px-3 py-2">
                    <input
                      type="checkbox"
                      className="h-4 w-4 rounded border-gray-300 text-orange-600 focus:ring-orange-500"
                      checked={isSelected}
                      onClick={(e) => e.stopPropagation()}
                      onChange={(e) => {
                        e.stopPropagation();
                        const wasSelected = isTableSelected(option.id);
                        onToggleIndividualTable(variableName, option.id, allTableOptionIds, []);
                        if (wasSelected) {
                          onRemoveSummarySortSelection(variableName, option.id);
                        }
                      }}
                    />
                    <div className="flex items-center w-full">
                      <span className="truncate">{option.label}</span>
                    </div>
                  </label>
                  {showSummaryPillColumn && (
                    <div className="flex items-center justify-center px-3 py-2">
                      {pillContent}
                    </div>
                  )}
                  <div className="flex items-center gap-2 justify-end px-3 py-2">
                    <input
                      type="checkbox"
                      className="h-4 w-4 rounded border-gray-300 text-orange-600 focus:ring-orange-500"
                      checked={isSortChecked}
                      onClick={(e) => e.stopPropagation()}
                      onChange={(e) => {
                        e.stopPropagation();
                        onSummaryTableSortToggle(variableName, option.id, summarySortDefaultsToOn);
                      }}
                    />
                    <span className="text-sm text-gray-700">Sort</span>
                  </div>
                </div>
              );
            })}
            {showNetSummaryLink && (
              <button
                type="button"
                className="text-sm font-semibold text-left"
                style={{ color: BRAND_ORANGE }}
                onClick={() => onOpenNetSummaryModal(variableName, {
                  mode: isSingleSelectGrid ? 'codes' : 'range',
                  responseOptions: responseOptions.map(opt => ({
                    code: opt.code || '',
                    text: opt.text || '',
                  })),
                })}
              >
                + Net Summary Table
              </button>
            )}
          </div>
        </div>
      )}



    </>
  );
};
