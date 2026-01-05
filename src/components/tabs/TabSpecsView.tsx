import React from 'react';
import { TableCellsIcon, Cog6ToothIcon, ArrowDownTrayIcon, PlusCircleIcon, CheckCircleIcon } from '@heroicons/react/24/outline';
import ExcelJS from 'exceljs';
import BannerBuilder from '../BannerBuilder';
import { BannerBuilderUI } from './BannerBuilderUI';
import { BannerFilterUI } from './BannerFilterUI';
import { BannerGroup } from '../../types/dataTabulation';
import { Variable } from '../../utils/tabs/types';
import { getBaseQuestionNumber } from '../../utils/tabs/questionHelpers';
import { getExpectedColumnHeadersForBase } from '../../utils/tabs/expectedHeaders';

const BRAND_ORANGE = '#D14A2D';

interface TabSpecsViewProps {
  viewType: 'tables' | 'banners';
  tabSpecsTypeFilter: string;
  onTabSpecsTypeFilterChange: (filter: string) => void;
  tabSpecsTypeOptions: string[];
  specsResetKey: number;
  selectedQuestionnaire: any;
  questionnaireQuestions: any[];
  variables: Variable[];
  variableTableSelections: Record<string, Set<string>>;
  showIncludedQuestions: boolean;
  onQuestionClick: (question: any, displayVariable: Variable | null) => void;
  onShowSettingsPopup: () => void;
  onExportTables?: () => void;
  exportingTables?: boolean;
  // Banner-related props
  showBannerBuilder: boolean;
  selectedNewBannerGroupId: string | null;
  editingBannerGroup: any;
  newBannerGroups: any[];
  bannerFilterConditions: any;
  fullRawData: any;
  columnMapping: Record<string, string>;
  getExpectedHeadersForQuestion: (question: any, baseQuestionNumber?: string) => string[];
  bannerSettingsOpenRef: React.MutableRefObject<(() => void) | null>;
  bannerSpecsFileInputRef: React.RefObject<HTMLInputElement>;
  onBannerSpecsFileChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  onHandleClickImportBannerSpecs: () => void;
  onBannerEdit: (group: any) => void;
  onBannerDelete: (groupId: string) => void;
  onBannerExport?: (groupId: string) => Promise<void>;
  exportingBannerId?: string | null;
  onBannerChange: (group: any) => void;
  onBannerSave: (group: BannerGroup) => void;
  onBannerCancel: () => void;
  onBannerFilterConditionsChange: (conditions: any) => void;
  onBackToTabPlans?: () => void;
  getTablesForVariable?: (variable: Variable) => string[];
  projectName?: string;
}

export const TabSpecsView: React.FC<TabSpecsViewProps> = ({
  viewType,
  tabSpecsTypeFilter,
  onTabSpecsTypeFilterChange,
  tabSpecsTypeOptions,
  specsResetKey,
  selectedQuestionnaire,
  questionnaireQuestions,
  variables,
  variableTableSelections,
  showIncludedQuestions,
  onQuestionClick,
  onShowSettingsPopup,
  onExportTables,
  exportingTables = false,
  showBannerBuilder,
  selectedNewBannerGroupId,
  editingBannerGroup,
  newBannerGroups,
  bannerFilterConditions,
  fullRawData,
  columnMapping,
  getExpectedHeadersForQuestion,
  bannerSettingsOpenRef,
  bannerSpecsFileInputRef,
  onBannerSpecsFileChange,
  onHandleClickImportBannerSpecs,
  onBannerEdit,
  onBannerDelete,
  onBannerExport,
  exportingBannerId,
  onBannerChange,
  onBannerSave,
  onBannerCancel,
  onBannerFilterConditionsChange,
  onBackToTabPlans,
  getTablesForVariable,
  projectName,
}) => {
  const [showLoadingShimmer, setShowLoadingShimmer] = React.useState(false);
  const [showLoadingOverlay, setShowLoadingOverlay] = React.useState(false);
  const overlayTimerRef = React.useRef<number | null>(null);

  React.useEffect(() => {
    if (selectedQuestionnaire && questionnaireQuestions.length === 0) {
      setShowLoadingShimmer(true);
      const t = window.setTimeout(() => setShowLoadingShimmer(false), 3000);
      return () => window.clearTimeout(t);
    } else {
      setShowLoadingShimmer(false);
    }
  }, [questionnaireQuestions.length, selectedQuestionnaire]);

  React.useEffect(() => {
    if (overlayTimerRef.current) {
      window.clearTimeout(overlayTimerRef.current);
      overlayTimerRef.current = null;
    }
    if (selectedQuestionnaire) {
      setShowLoadingOverlay(true);
      overlayTimerRef.current = window.setTimeout(() => {
        setShowLoadingOverlay(false);
      }, 3000);
    } else {
      setShowLoadingOverlay(false);
    }
    return () => {
      if (overlayTimerRef.current) {
        window.clearTimeout(overlayTimerRef.current);
      }
    };
  }, [selectedQuestionnaire]);

  return (
    <div className="p-6">
      {viewType === 'tables' && questionnaireQuestions.length > 0 && (
        <div className="mb-4 flex items-end justify-between gap-3">
          <div className="flex items-center gap-2">
            <div>
              <label htmlFor="tab-specs-type-select" className="sr-only">Filter questions</label>
              <select
                id="tab-specs-type-select"
                value={tabSpecsTypeFilter}
                onChange={(e) => onTabSpecsTypeFilterChange(e.target.value)}
                className="px-2 py-1.5 text-sm border border-gray-300 rounded-md bg-white focus:outline-none focus:ring-2 focus:ring-orange-500"
                title="Filter question list by type"
              >
                <option value="all">All questions</option>
                {tabSpecsTypeOptions.map((type: string) => (
                  <option key={type} value={type}>{type}</option>
                ))}
              </select>
            </div>
            <button
              onClick={onShowSettingsPopup}
              className="p-1 hover:bg-gray-100 rounded transition-colors"
              title="Table Settings"
            >
              <Cog6ToothIcon className="h-5 w-5 text-gray-600" />
            </button>
          </div>
          {onExportTables && (
            <button
              type="button"
              onClick={onExportTables}
              disabled={exportingTables}
              className={`inline-flex items-center gap-2 px-3 py-2 rounded-lg border text-sm font-semibold ${
                exportingTables
                  ? 'border-gray-300 bg-gray-100 text-gray-400 cursor-not-allowed'
                  : 'border-gray-300 bg-white text-gray-700 hover:bg-gray-50'
              }`}
              title="Export tables with Total column only"
            >
              {exportingTables ? (
                <div className="h-4 w-4 animate-spin rounded-full border-2 border-gray-200" style={{ borderTopColor: '#D14A2D' }} />
              ) : (
                <ArrowDownTrayIcon className="h-4 w-4" />
              )}
              {exportingTables ? 'Exporting…' : 'Export Tables'}
            </button>
          )}
        </div>
      )}
      {viewType === 'tables' ? (
        <>
          {!selectedQuestionnaire ? (
            <div className="text-center py-12">
              <TableCellsIcon className="mx-auto h-12 w-12 text-gray-300 mb-4" />
              <p className="text-gray-500">Please select a questionnaire to view table specifications</p>
            </div>
          ) : (
            <div className="relative overflow-x-auto max-h-[calc(100vh-280px)]">
              <table key={specsResetKey} className="min-w-full text-sm border-collapse">
                <thead className="sticky top-0 z-10">
                  <tr className="border-b-2 border-gray-300">
                    <th className="px-4 py-3 text-left text-xs font-semibold text-white uppercase tracking-wider border-r border-gray-300 whitespace-nowrap" style={{ backgroundColor: BRAND_ORANGE }}>Q#</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-white uppercase tracking-wider border-r border-gray-300" style={{ backgroundColor: BRAND_ORANGE }}>Type</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-white uppercase tracking-wider border-r border-gray-300" style={{ backgroundColor: BRAND_ORANGE }}>Tags</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-white uppercase tracking-wider border-r border-gray-300" style={{ backgroundColor: BRAND_ORANGE }}>Question Text</th>
                    <th className="px-4 py-3 text-center text-xs font-semibold text-white uppercase tracking-wider border-r border-gray-300" style={{ backgroundColor: BRAND_ORANGE }}>Included</th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-200">
                  {variables
                    .filter(variable => {
                      // Type filter
                      if (tabSpecsTypeFilter !== 'all') {
                        const vType = variable.type || 'Unknown';
                        if (vType !== tabSpecsTypeFilter) return false;
                      }

                      // Hide questions without numeric digits in Q# by default
                      if (!showIncludedQuestions) {
                        const qNum = variable.name;
                        // Check if question number contains any numeric digit
                        if (!/\d/.test(qNum)) {
                          return false; // Hide questions without numeric digits
                        }
                      }

                      // Show/hide questions without included tables
                      // By default (showIncludedQuestions = false): Show ONLY questions WITH tables
                      // When showIncludedQuestions = true: Show ALL questions
                      if (!showIncludedQuestions) {
                        // Check if this variable has any tables included
                        const selections = variableTableSelections[variable.name];
                        if (!selections || selections.size === 0) {
                          return false; // Hide questions without included tables
                        }
                      }

                      return true;
                    })
                    .map((variable, idx) => {
                      const qNumStr = variable.name;
                      const tags = (variable as any).tags || [];
                      const questionText = variable.description || qNumStr;
                      const questionType = variable.type || 'Unknown';
                      const typeLower = questionType.toLowerCase();
                      const isNumericGrid = typeLower.includes('numeric grid') || typeLower.includes('numeric list');

                      // Use the variable directly as displayVariable
                      const displayVariable = variable;

                      // For backwards compatibility, create a question-like object
                      const question = {
                        number: variable.name,
                        id: variable.name,
                        type: variable.type,
                        text: variable.description,
                        tags: tags,
                      };
                      
                      // For numeric grids, show grid structure info with more detail
                      let gridInfo = null;
                      let gridStructurePreview = null;
                      if (isNumericGrid) {
                        const statementCount = question.statementOptions ? question.statementOptions.length : 0;
                        const responseCount = question.responseOptions ? question.responseOptions.length : 0;
                        const hasPercentTag = tags.includes('%');
                        const hasNumberTag = tags.includes('Number');
                        const columnLabel = hasPercentTag ? '%' : (hasNumberTag ? '#' : '#');
                        const effectiveColumns = responseCount > 0 ? responseCount : 1;
                        gridInfo = `${statementCount} row${statementCount !== 1 ? 's' : ''} × ${effectiveColumns} column${effectiveColumns !== 1 ? 's' : ''}`;
                        
                        // Show a preview of statements and columns if available
                        if (statementCount > 0 || responseCount > 0) {
                          const statementPreview = question.statementOptions && question.statementOptions.length > 0
                            ? question.statementOptions.slice(0, 2).map((stmt: any) => {
                                const text = typeof stmt === 'string' ? stmt : (stmt.text || stmt.label || '');
                                return text.length > 20 ? text.substring(0, 20) + '...' : text;
                              }).join(', ')
                            : '';
                          const columnPreview = question.responseOptions && question.responseOptions.length > 0
                            ? question.responseOptions.slice(0, 3).map((opt: any) => {
                                const text = typeof opt === 'string' ? opt : (opt.text || opt.label || opt.value || '');
                                return text.length > 15 ? text.substring(0, 15) + '...' : text;
                              }).join(', ')
                            : (effectiveColumns === 1 ? columnLabel : '');
                          
                          if (statementPreview || columnPreview) {
                            gridStructurePreview = (
                              <div className="text-xs text-gray-500 mt-1 space-y-0.5">
                                {statementPreview && (
                                  <div className="truncate">
                                    <span className="font-medium">Rows:</span> {statementPreview}
                                    {statementCount > 2 && <span className="text-gray-400"> +{statementCount - 2} more</span>}
                                  </div>
                                )}
                                {columnPreview && (
                                  <div className="truncate">
                                    <span className="font-medium">Cols:</span> {columnPreview}
                                    {responseCount > 3 && <span className="text-gray-400"> +{responseCount - 3} more</span>}
                                  </div>
                                )}
                              </div>
                            );
                          }
                        }
                      }

                      // Since we're iterating over variables directly, matchingVariables is just the current variable
                      const matchingVariables = [variable];

                      // Check if any tables are selected for this question
                      const isIncluded = (() => {
                        const qNumForMatching = qNumStr.replace(/^Q/, '');

                        // Check matching variables for selected tables
                        for (const matchVar of matchingVariables) {
                          const selections = variableTableSelections[matchVar.name];
                          if (selections && selections.size > 0) {
                            return true;
                          }
                        }
                      
                        // Also check by question number (for questions without variables yet)
                        const selectionsByQNum = variableTableSelections[qNumStr] || variableTableSelections[qNumForMatching];
                        if (selectionsByQNum && selectionsByQNum.size > 0) {
                          return true;
                        }
                        
                        // Also check all variable table selections to see if any table IDs match this question
                        for (const [varName, selections] of Object.entries(variableTableSelections)) {
                          if (selections && selections.size > 0) {
                            // Check if the variable name matches this question number
                            const varBase = getBaseQuestionNumber(varName);
                            if (varBase === qNumStr || 
                                varBase === qNumForMatching || 
                                varBase.replace(/^Q/, '') === qNumForMatching) {
                              return true;
                            }
                            
                            // Also check if any selected table ID starts with this question number
                            for (const tableId of selections) {
                              if (tableId.startsWith(qNumStr) || 
                                  tableId.startsWith(qNumForMatching) ||
                                  tableId.startsWith(`Q${qNumForMatching}`)) {
                                return true;
                              }
                            }
                          }
                        }
                        
                        return false;
                      })();
                      
                      // Check if data file is uploaded (has fullRawData)
                      const hasDataFile = fullRawData !== null && fullRawData !== undefined;
                      
                      // Check if question is fully unmapped (0 mapped variables)
                      const isFullyUnmapped = (() => {
                        if (!hasDataFile) return false;
                        
                        const expectedHeaders = getExpectedHeadersForQuestion(question, qNumStr);
                        if (expectedHeaders.length === 0) return false;
                        
                        const mappedCount = expectedHeaders.filter(expectedHeader => {
                          const mappedColumn = columnMapping[expectedHeader] || columnMapping[expectedHeader.replace(/^Q/, '')] || '';
                          return !!mappedColumn;
                        }).length;
                        
                        return mappedCount === 0;
                      })();
                      
                      return (
                        <tr
                          key={`${qNumStr}-${idx}`}
                          className="hover:bg-gray-50 cursor-pointer transition-colors"
                          onClick={() => onQuestionClick(question, displayVariable)}
                        >
                          <td className="px-4 py-3 text-sm text-gray-900 border-r border-gray-100 font-medium whitespace-nowrap">
                            {qNumStr}
                          </td>
                          <td className="px-4 py-3 text-sm text-gray-700 border-r border-gray-100 whitespace-nowrap">
                            {questionType}
                          </td>
                          <td className="px-4 py-3 text-sm text-gray-700 border-r border-gray-100">
                            {tags.length > 0 ? (
                              <div className="flex flex-wrap gap-1">
                                {tags.filter((tag: string) => tag.toLowerCase() !== 'terminate' && tag.toLowerCase() !== 'specify').map((tag: string, idx: number) => (
                                  <span key={`${qNumStr}-tag-${idx}`} className="px-2 py-1 bg-blue-100 text-blue-800 text-xs rounded">
                                    {tag}
                                  </span>
                                ))}
                              </div>
                            ) : (
                              <span className="text-gray-400">-</span>
                            )}
                          </td>
                          <td className="px-4 py-3 text-sm text-gray-700 border-r border-gray-100" style={{ maxWidth: '400px' }}>
                            <div className="flex flex-col gap-1">
                              <span
                                className="block"
                                title={questionText}
                                style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}
                              >
                                {questionText || '-'}
                              </span>
                              {gridInfo && (
                                <div className="flex flex-col gap-0.5">
                                  <span className="text-xs text-gray-500 italic">
                                    {gridInfo}
                                  </span>
                                  {gridStructurePreview}
                                </div>
                              )}
                            </div>
                          </td>
                          <td className="px-4 py-3 text-center border-r border-gray-100">
                            {isIncluded ? (
                              <CheckCircleIcon className="h-5 w-5 text-green-500 mx-auto" />
                            ) : (
                              <span className="text-gray-400">-</span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                </tbody>
              </table>
            </div>
          )}
        </>
      ) : (
        <>
          {showBannerBuilder ? (
            <BannerBuilder
              variables={variables}
              editingGroup={editingBannerGroup}
              existingBannerCount={newBannerGroups.length}
              rawData={fullRawData}
              columnMapping={columnMapping}
              settingsOpenRef={bannerSettingsOpenRef}
              questionnaireId={selectedQuestionnaire?.id}
              expectedHeaders={(() => {
                try {
                  const set = new Set<string>();
                  (questionnaireQuestions || []).forEach((q: any) => {
                    const qNum = q.number || q.id;
                    if (!qNum) return;
                    const headers = getExpectedColumnHeadersForBase(String(qNum), variables);
                    headers.forEach((h: string) => set.add(h));
                  });
                  return Array.from(set);
                } catch {
                  return [];
                }
              })()}
              onChange={onBannerChange}
              onSave={onBannerSave}
              onCancel={onBannerCancel}
              variableTableSelections={variableTableSelections}
              getTablesForVariable={getTablesForVariable}
              projectName={projectName}
            />
          ) : selectedNewBannerGroupId ? (
            /* Banner Detail View - to be implemented */
            <div className="p-6 text-center text-gray-500">
              Banner detail view - Component extraction in progress
            </div>
          ) : (
            /* Banner Groups List */
            <>
              <BannerBuilderUI
                bannerGroups={newBannerGroups}
                onEdit={onBannerEdit}
                onDelete={onBannerDelete}
                onExport={onBannerExport}
                exportingBannerId={exportingBannerId}
                variables={variables}
                bannerSpecsFileInputRef={bannerSpecsFileInputRef}
                onBannerSpecsFileChange={onBannerSpecsFileChange}
                onHandleClickImportBannerSpecs={onHandleClickImportBannerSpecs}
              />
              {bannerFilterConditions && (
                <div className="mt-6 border-t border-gray-200 pt-6">
                  <BannerFilterUI
                    filterConditions={bannerFilterConditions}
                    onChange={onBannerFilterConditionsChange}
                    variables={variables}
                    rawData={fullRawData}
                    columnMapping={columnMapping}
                  />
                </div>
              )}
            </>
          )}
        </>
      )}
    </div>
  );
};

