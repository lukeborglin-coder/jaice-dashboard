import React from 'react';
import { createPortal } from 'react-dom';
import { XMarkIcon } from '@heroicons/react/24/outline';
import { TableSelector } from './TableSelector';
import { StatsSelector } from './StatsSelector';
import { Variable, VariableStatsSelection } from '../../utils/tabs/types';
import { getBaseQuestionNumber } from '../../utils/tabs/questionHelpers';

const BRAND_ORANGE = '#D14A2D';

interface ConfigPopupModalProps {
  isOpen: boolean;
  variable: Variable | null;
  onClose: () => void;
  questionnaireQuestions: any[];
  variableTableSelections: Record<string, Set<string>>;
  summaryTableSortSelections: Record<string, Set<string>>;
  variableSortByFrequency: Record<string, boolean>;
  variableHoldResponseCodes: Record<string, string[]>;
  holdOptionsDropdownOpen: Record<string, boolean>;
  netSummaryTableRanges: Record<string, Array<{ name: string; low: string; high: string; enabled?: boolean; context?: 'stats' | 'summary' }>>;
  netSummaryTableSelectedCodes: Record<string, Array<{ name: string; codes: string[] }>>;
  getStatsSelectionsForVariable: (variableName: string) => VariableStatsSelection;
  onToggleIndividualTable: (varName: string, tableId: string, allTableOptionIds: string[], dependentTableIds: string[]) => void;
  onSelectTable: (varName: string, tableId: string) => void;
  onRemoveSummarySortSelection: (varName: string, tableId: string) => void;
  onSummaryTableSortToggle: (varName: string, tableId: string, defaultOn: boolean) => void;
  onHoldOptionsToggle: (varName: string, isOpen: boolean, codes?: string[]) => void;
  onOpenHoldOptionsDropdown: (varName: string) => void;
  onCloseHoldOptionsDropdown: (varName: string) => void;
  onHoldOptionSelection: (varName: string, code: string) => void;
  onOpenNetSummaryModal: (variableName: string, config?: { mode?: 'range' | 'codes'; responseOptions?: Array<{ code: string; text: string }>; initialName?: string; initialLow?: string; initialHigh?: string; initialCodes?: string[]; editingIndex?: number | null }) => void;
  onEditNetSummary: (variableName: string, netMeta: { type: 'range' | 'codes'; index: number }, responseOptions: Array<{ code: string; text: string }>) => void;
  onAddInlineNumericNet: (variableName: string, low: string, high: string) => void;
  onUpdateInlineNumericNet: (variableName: string, globalIndex: number, key: 'name' | 'low' | 'high', value: string) => void;
  onRemoveInlineNumericNet: (variableName: string, index: number) => void;
  onSortPreferenceChange: (variableName: string, value: 'default' | 'frequency', persistFalse?: boolean) => void;
  onToggleStatSelection: (varName: string, statKey: keyof VariableStatsSelection) => void;
}

export const ConfigPopupModal: React.FC<ConfigPopupModalProps> = ({
  isOpen,
  variable,
  onClose,
  questionnaireQuestions,
  variableTableSelections,
  summaryTableSortSelections,
  variableSortByFrequency,
  variableHoldResponseCodes,
  holdOptionsDropdownOpen,
  netSummaryTableRanges,
  netSummaryTableSelectedCodes,
  getStatsSelectionsForVariable,
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
  onSortPreferenceChange,
  onToggleStatSelection,
}) => {
  if (!isOpen || !variable) return null;

  const popupVariableName = variable.name;
  const typeLower = variable.type?.toLowerCase() || '';
  const isNumericGrid = typeLower.includes('numeric grid');
  const isSingleSelect = typeLower.includes('single select') && !typeLower.includes('grid');
  const isMultiSelectGrid = typeLower.includes('multi-select grid');
  const isSingleSelectGrid = typeLower.includes('single select grid');
  const isMultiSelect = typeLower.includes('multi-select') && !typeLower.includes('grid');
  const isMultiSelectType = isMultiSelect || isMultiSelectGrid;
  const isNumericQuestion = typeLower.includes('numeric') && !typeLower.includes('grid') && !typeLower.includes('list');
  const isOpenEndListType = typeLower.includes('open end list');
  const isOpenEndType = typeLower.includes('open end') && !isOpenEndListType;
  const popupStatsSelections = getStatsSelectionsForVariable(popupVariableName);
  const baseQuestionNumberForPopup = getBaseQuestionNumber(popupVariableName);
  const matchingQuestion = questionnaireQuestions.find(question => {
    const qNum = question.number || question.id;
    if (!qNum) return false;
    const qNumStr = String(qNum);
    const normalizedQNum = qNumStr.replace(/^Q/i, '');
    const normalizedBase = baseQuestionNumberForPopup.replace(/^Q/i, '');
    return (
      qNumStr === baseQuestionNumberForPopup ||
      normalizedQNum === normalizedBase ||
      `Q${normalizedQNum}` === baseQuestionNumberForPopup
    );
  });
  
  // Get response options
  const responseOptions = (() => {
    if (isMultiSelectGrid) {
      if (variable.statements && Object.keys(variable.statements).length > 0) {
        return Object.entries(variable.statements).map(([code, text]) => ({
          code,
          text: String(text || code),
        }));
      }
      if (matchingQuestion && Array.isArray(matchingQuestion.statementOptions)) {
        return matchingQuestion.statementOptions.map((stmt: any, idx: number) => {
          if (typeof stmt === 'string') {
            return { code: `r${idx + 1}`, text: stmt };
          }
          return {
            code: stmt.code || `r${idx + 1}`,
            text: stmt.text || stmt.label || stmt.code || `Row ${idx + 1}`,
          };
        });
      }
      return [];
    }
    if (variable.codes && Object.keys(variable.codes).length > 0) {
      return Object.entries(variable.codes).map(([code, text]) => ({
        code,
        text: String(text || code),
      }));
    }
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
  })();

  const defaultSortByFrequency = isMultiSelectType || isOpenEndType;
  const isSortedByFrequencyState = variableSortByFrequency[popupVariableName];
  const isSortedByFrequency = isOpenEndType
    ? true
    : (isSortedByFrequencyState !== undefined ? isSortedByFrequencyState : defaultSortByFrequency);
  
  const defaultHoldCodes = isMultiSelectType
    ? responseOptions
        .map((option: { code: string; text: string }) => option.code)
        .filter((code: string) => {
          const numeric = parseInt(String(code).replace(/[^0-9-]/g, ''), 10);
          return !isNaN(numeric) && numeric >= 90 && numeric <= 99;
        })
    : [];
  
  const holdSelection = variableHoldResponseCodes[popupVariableName];
  // hasHoldSelection is true if the key exists in variableHoldResponseCodes (even if array is empty)
  // This allows users to enable hold and then select codes
  const hasHoldSelection = popupVariableName in variableHoldResponseCodes;
  const holdSelectionArray = holdSelection && holdSelection.length > 0
    ? holdSelection
    : (hasHoldSelection ? [] : defaultHoldCodes);
  
  const netEntries = (netSummaryTableRanges[popupVariableName] || []).map((net, idx) => ({ ...net, globalIndex: idx }));
  const statsNetEntries = netEntries.filter(entry => entry.context !== 'summary');
  const netCodeSelections = netSummaryTableSelectedCodes[popupVariableName] || [];
  
  // Build table options
  const individualTableOptions: Array<{ id: string; label: string; disabled?: boolean; helperText?: string }> = [];
  if (!isNumericGrid && !isMultiSelectGrid && !isOpenEndListType && !isSingleSelectGrid) {
    const baseLabel = (isSingleSelect || isMultiSelect || isOpenEndType)
      ? 'Frequency Table'
      : (isNumericQuestion ? 'Frequency Distribution Table' : 'Overall Table');
    const displayLabel = isOpenEndType ? 'Frequency Distribution Table' : baseLabel;
    individualTableOptions.push({ id: popupVariableName, label: displayLabel });
  }
  
  const hasStatements = variable.statements && Object.keys(variable.statements).length > 0;
  // For numeric questions (not grids) and numeric grids, add individual tables for each statement
  if (hasStatements && !isOpenEndListType && (isNumericQuestion || isNumericGrid) && variable.statements) {
    Object.entries(variable.statements).forEach((entry) => {
      const [code, label] = entry;
      individualTableOptions.push({
        id: `${popupVariableName}_${code}`,
        label: String(label || code),
      });
    });
  }
  
  if (isSingleSelectGrid && hasStatements && variable.statements) {
    Object.entries(variable.statements).forEach((entry) => {
      const [code, label] = entry;
      individualTableOptions.push({
        id: `${popupVariableName}_${code}`,
        label: String(label || code),
      });
    });
  }

  const summaryTableOptions: Array<{ id: string; label: string; pill?: string; netMeta?: { type: 'range' | 'codes'; index: number } }> = [];
  // Ensure we have a valid question number for labels
  const questionNumberForLabel = baseQuestionNumberForPopup || (matchingQuestion?.number ? String(matchingQuestion.number) : popupVariableName.split('_')[0]) || popupVariableName;
  
  if (isNumericGrid) {
    summaryTableOptions.push(
      { id: `${popupVariableName}_MeanSummaryTable`, label: `${questionNumberForLabel}: Mean Summary Table`, pill: 'Mean' },
      { id: `${popupVariableName}_SumSummaryTable`, label: `${questionNumberForLabel}: Sum Summary Table`, pill: 'Sum' },
      { id: `${popupVariableName}_MeanNoOutliersSummaryTable`, label: `${questionNumberForLabel}: Mean (Outliers Removed) Summary Table`, pill: 'Mean (Outliers Removed)' },
      { id: `${popupVariableName}_SumNoOutliersSummaryTable`, label: `${questionNumberForLabel}: Sum (Outliers Removed) Summary Table`, pill: 'Sum (Outliers Removed)' }
    );
  }
  if (isSingleSelectGrid) {
    summaryTableOptions.push({
      id: `${popupVariableName}_MeanSummaryTable`,
      label: `${questionNumberForLabel}: Mean Summary Table`,
      pill: 'Mean'
    });
  }
  
  // For multi-select grids, add summary table options - one for each response option (column)
  if (isMultiSelectGrid) {
    // Get response options (columns) from variable or matching question
    const responseOptionsForSummary: Array<{ code: string; label: string }> = [];
    
    if (variable.codes && Object.keys(variable.codes).length > 0) {
      // Use codes (response options/columns) from variable
      Object.entries(variable.codes).forEach(([code, label]) => {
        responseOptionsForSummary.push({
          code,
          label: String(label || code)
        });
      });
    } else if (matchingQuestion && Array.isArray(matchingQuestion.responseOptions)) {
      // Fallback to responseOptions from questionnaire
      matchingQuestion.responseOptions.forEach((opt: any, idx: number) => {
        if (typeof opt === 'string') {
          responseOptionsForSummary.push({
            code: `c${idx + 1}`,
            label: opt
          });
        } else {
          responseOptionsForSummary.push({
            code: opt.code || `c${idx + 1}`,
            label: opt.text || opt.label || opt.value || opt.code || `Column ${idx + 1}`
          });
        }
      });
    }
    
    // Create one summary table option for each response option (column)
    responseOptionsForSummary.forEach((opt) => {
      summaryTableOptions.push({
        id: `${popupVariableName}_${opt.code}_SummaryTable`,
        label: `${baseQuestionNumberForPopup}: ${opt.label} Summary Table`,
        pill: 'Summary'
      });
    });
  }
  
  // For open end list, add summary table options - one frequency distribution table for each response option
  if (isOpenEndListType) {
    // Get response options (list items) from variable or matching question
    const responseOptionsForSummary: Array<{ code: string; label: string }> = [];
    
    if (variable.codes && Object.keys(variable.codes).length > 0) {
      // Use codes (response options) from variable
      Object.entries(variable.codes).forEach(([code, label]) => {
        responseOptionsForSummary.push({
          code,
          label: String(label || code)
        });
      });
    } else if (matchingQuestion && Array.isArray(matchingQuestion.responseOptions)) {
      // Fallback to responseOptions from questionnaire
      matchingQuestion.responseOptions.forEach((opt: any, idx: number) => {
        if (typeof opt === 'string') {
          responseOptionsForSummary.push({
            code: `c${idx + 1}`,
            label: opt
          });
        } else {
          responseOptionsForSummary.push({
            code: opt.code || `c${idx + 1}`,
            label: opt.text || opt.label || opt.value || opt.code || `Option ${idx + 1}`
          });
        }
      });
    }
    
    // Create one frequency distribution table option for each response option
    responseOptionsForSummary.forEach((opt) => {
      summaryTableOptions.push({
        id: `${popupVariableName}_${opt.code}_FrequencyDistributionTable`,
        label: `${baseQuestionNumberForPopup}: ${opt.label} Frequency Distribution Table`
      });
    });
  }

  // Add single select grid nets to summaryTableOptions
  if (isSingleSelectGrid && netCodeSelections.length > 0) {
    netCodeSelections.forEach((net: { name: string; codes: string[] }, idx: number) => {
      const codes = Array.isArray(net.codes) ? net.codes : [];
      summaryTableOptions.push({
        id: `${popupVariableName}_NetSummaryTable_${idx}`,
        label: `${questionNumberForLabel}: ${net.name || `Net ${idx + 1}`}`,
        pill: 'Net',
        netMeta: { type: 'codes' as const, index: idx },
      });
    });
  }

  // Single select (non-grid) nets are shown separately in stats box
  const singleSelectNetTableOptions = (!isSingleSelectGrid && isSingleSelect)
    ? netCodeSelections.map((net: { name: string; codes: string[] }, idx: number) => {
        const codes = Array.isArray(net.codes) ? net.codes : [];
        return {
          id: `${popupVariableName}_NetSummaryTable_${idx}`,
          label: net.name || `Net ${idx + 1}`,
          pill: `Net (${codes.length > 0 ? codes.join(', ') : '?'})`,
          netMeta: { type: 'codes' as const, index: idx },
          codes: codes,
        };
      })
    : [];

  const allTableOptions = [...individualTableOptions, ...summaryTableOptions, ...singleSelectNetTableOptions];
  const allTableOptionIds = allTableOptions.map(option => option.id);
  const individualSelectionSet = variableTableSelections[popupVariableName];
  const summarySortSet = summaryTableSortSelections[popupVariableName];
  const summarySortDefaultsToOn = isMultiSelectGrid || isOpenEndListType;

  const isTableSelected = (tableName: string) => {
    if (!individualSelectionSet) {
      return false;
    }
    return individualSelectionSet.has(tableName);
  };

  const statsCheckboxes: Array<{ key: keyof VariableStatsSelection; label: string }> = [
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
  
  const statsHeaderSpacing = (isNumericQuestion || isNumericGrid) ? 'mb-2' : 'mb-4';
  const statsOptionsForDisplay = (() => {
    if ((isSingleSelect && !isMultiSelect && !isNumericQuestion && !isNumericGrid) || isSingleSelectGrid) {
      return statsCheckboxes.filter(option => option.key === 'mean');
    }
    return statsCheckboxes;
  })();

  const summaryTableGridTemplate = isMultiSelectGrid
    ? 'minmax(0,1fr) minmax(0,200px) 80px'
    : 'minmax(0,1fr) 80px';
  const showSummaryPillColumn = isMultiSelectGrid;
  const showNetSummaryLink = isNumericGrid || isSingleSelectGrid;

  return createPortal(
    <div className="fixed inset-0 bg-black/40 z-[2000]" onClick={onClose}>
      <div className="flex items-start justify-center w-full h-full p-4 sm:p-6 md:p-10">
        <div className="bg-white rounded-2xl shadow-2xl max-w-4xl w-full max-h-[90vh] flex flex-col overflow-hidden" onClick={(e) => e.stopPropagation()}>
          <div className="px-6 py-5 border-b border-gray-200 flex items-start justify-between gap-4">
            <div className="flex-1 space-y-2">
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="text-xl font-semibold text-gray-900">Q{popupVariableName}</h3>
                {variable.type && (
                  <span className="inline-flex items-center px-2.5 py-0.5 text-xs font-medium rounded-full bg-orange-50 text-orange-700 border border-orange-100">
                    {variable.type}
                  </span>
                )}
                {(variable as any)?.tags?.length ? (
                  (variable as any).tags
                    .filter((tag: string) => tag.toLowerCase() !== 'terminate' && tag.toLowerCase() !== 'specify')
                    .map((tag: string, idx: number) => (
                      <span key={`${popupVariableName}-tag-${idx}`} className="px-2 py-0.5 text-xs rounded bg-blue-100 text-blue-800">
                        {tag}
                      </span>
                    ))
                ) : null}
              </div>
              <p className="text-sm text-gray-600">
                {variable.description || (variable as any)?.label || 'No description available.'}
              </p>
            </div>
            <button
              onClick={onClose}
              className="text-gray-400 hover:text-gray-600 transition"
            >
              <XMarkIcon className="h-5 w-5" />
            </button>
          </div>
          <div className="flex-1 overflow-y-auto px-6 py-6 space-y-6 bg-gray-50/60">
            <TableSelector
              variable={variable}
              individualTableOptions={individualTableOptions}
              summaryTableOptions={summaryTableOptions}
              singleSelectNetTableOptions={singleSelectNetTableOptions}
              allTableOptionIds={allTableOptionIds}
              computedDefaultSelectedTableIds={allTableOptionIds}
              isTableSelected={isTableSelected}
              variableTableSelections={individualSelectionSet || new Set()}
              summaryTableSortSelections={summarySortSet || new Set()}
              summarySortDefaultsToOn={summarySortDefaultsToOn}
              isMultiSelectGrid={isMultiSelectGrid}
              isOpenEndType={isOpenEndType}
              isOpenEndListType={isOpenEndListType}
              isSingleSelectGrid={isSingleSelectGrid}
              isNumericGrid={isNumericGrid}
              isNumericQuestion={isNumericQuestion}
              isSingleSelect={isSingleSelect}
              showSummaryPillColumn={showSummaryPillColumn}
              summaryTableGridTemplate={summaryTableGridTemplate}
              showNetSummaryLink={showNetSummaryLink}
              responseOptions={responseOptions}
              netSummaryTableRanges={statsNetEntries}
              netSummaryTableSelectedCodes={netCodeSelections}
              variableHoldResponseCodes={holdSelectionArray}
              holdOptionsDropdownOpen={holdOptionsDropdownOpen[popupVariableName] ?? false}
              onToggleIndividualTable={onToggleIndividualTable}
              onSelectTable={onSelectTable}
              onRemoveSummarySortSelection={onRemoveSummarySortSelection}
              onSummaryTableSortToggle={onSummaryTableSortToggle}
              onHoldOptionsToggle={onHoldOptionsToggle}
              onOpenHoldOptionsDropdown={onOpenHoldOptionsDropdown}
              onCloseHoldOptionsDropdown={onCloseHoldOptionsDropdown}
              onHoldOptionSelection={onHoldOptionSelection}
              onOpenNetSummaryModal={onOpenNetSummaryModal}
              onEditNetSummary={onEditNetSummary}
              onAddInlineNumericNet={onAddInlineNumericNet}
              onUpdateInlineNumericNet={(varName, index, key, value) => {
                // Find the net entry by index and get its globalIndex
                const netEntry = statsNetEntries[index];
                if (netEntry && netEntry.globalIndex !== undefined) {
                  onUpdateInlineNumericNet(varName, netEntry.globalIndex, key, value);
                }
              }}
              onRemoveInlineNumericNet={onRemoveInlineNumericNet}
              defaultHoldCodes={defaultHoldCodes}
              BRAND_ORANGE={BRAND_ORANGE}
            />
            <div className={`grid grid-cols-1 ${!(isOpenEndType || isOpenEndListType) ? 'lg:grid-cols-2' : ''} gap-4`}>
              {!isMultiSelectGrid && individualTableOptions.length > 0 && (
                <div className="rounded-2xl border border-gray-200 bg-white p-5 h-full flex flex-col">
                  <div className="mb-4">
                    <h4 className="text-base font-semibold text-gray-900">Individual Tables</h4>
                    <p className="text-sm text-gray-600">Select which individual tables to include.</p>
                  </div>
                  <div className="flex-1 overflow-y-auto pr-1">
                    <div className="space-y-2">
                      {individualTableOptions.map(option => {
                        const optionChecked = isTableSelected(option.id);
                        return (
                          <label
                            key={option.id}
                            className="flex flex-col gap-1 rounded-lg border border-gray-200 px-3 py-2 text-sm bg-white text-gray-800"
                          >
                            <div className="flex items-center gap-3">
                              <input
                                type="checkbox"
                                className="h-4 w-4 rounded border-gray-300 text-orange-600 focus:ring-orange-500"
                                checked={optionChecked}
                                onClick={(e) => e.stopPropagation()}
                                onChange={(e) => {
                                  e.stopPropagation();
                                  onToggleIndividualTable(popupVariableName, option.id, allTableOptionIds, []);
                                }}
                              />
                              <span className="truncate">{option.label}</span>
                            </div>
                            {option.helperText && (
                              <span className="text-xs text-gray-500">{option.helperText}</span>
                            )}
                          </label>
                        );
                      })}
                    </div>
                  </div>
                </div>
              )}
              {!(isOpenEndType || isOpenEndListType || isMultiSelectGrid) && (
                <div className="flex flex-col gap-4">
                  <StatsSelector
                    variable={variable}
                    statsSelections={popupStatsSelections}
                    isNumericQuestion={isNumericQuestion}
                    isNumericGrid={isNumericGrid}
                    isMultiSelect={isMultiSelect}
                    isMultiSelectGrid={isMultiSelectGrid}
                    isSingleSelect={isSingleSelect}
                    isSingleSelectGrid={isSingleSelectGrid}
                    isSortedByFrequency={isSortedByFrequency}
                    isMultiSelectType={isMultiSelectType}
                    hasHoldSelection={hasHoldSelection}
                    holdSelectionArray={holdSelectionArray}
                    responseOptions={responseOptions}
                    defaultHoldCodes={defaultHoldCodes}
                    statsOptionsForDisplay={statsOptionsForDisplay}
                    statsHeaderSpacing={statsHeaderSpacing}
                    onToggleStatSelection={onToggleStatSelection}
                    onSortPreferenceChange={(varName, value, persistFalse) => {
                      onSortPreferenceChange(varName, value, persistFalse);
                    }}
                    onHoldOptionsToggle={onHoldOptionsToggle}
                    onOpenHoldOptionsDropdown={onOpenHoldOptionsDropdown}
                    onCloseHoldOptionsDropdown={onCloseHoldOptionsDropdown}
                    onHoldOptionSelection={onHoldOptionSelection}
                    holdOptionsDropdownOpen={holdOptionsDropdownOpen[popupVariableName] ?? false}
                    netSummaryTableRanges={statsNetEntries}
                    onAddInlineNumericNet={onAddInlineNumericNet}
                    onUpdateInlineNumericNet={(varName, index, key, value) => {
                      // Find the net entry by index and get its globalIndex
                      const netEntry = statsNetEntries[index];
                      if (netEntry && netEntry.globalIndex !== undefined) {
                        onUpdateInlineNumericNet(varName, netEntry.globalIndex, key, value);
                      }
                    }}
                    onRemoveInlineNumericNet={onRemoveInlineNumericNet}
                    netSummaryTableSelectedCodes={netCodeSelections}
                    variableTableSelections={individualSelectionSet || new Set()}
                    onToggleNetSelection={(varName, tableId) => {
                      onToggleIndividualTable(varName, tableId, allTableOptionIds, []);
                    }}
                    onOpenNetSummaryModal={onOpenNetSummaryModal}
                    onEditNetSummary={(varName, netMeta, responseOptions) => {
                      onEditNetSummary(varName, netMeta, responseOptions);
                    }}
                    BRAND_ORANGE={BRAND_ORANGE}
                  />
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
};

