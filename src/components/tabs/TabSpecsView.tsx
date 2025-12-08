import React from 'react';
import { TableCellsIcon, Cog6ToothIcon, ArrowDownTrayIcon, PlusCircleIcon, CheckCircleIcon, InformationCircleIcon } from '@heroicons/react/24/outline';
import ExcelJS from 'exceljs';
import BannerBuilder from '../BannerBuilder';
import { BannerBuilderUI } from './BannerBuilderUI';
import { BannerFilterUI } from './BannerFilterUI';
import { Variable } from '../../utils/tabs/types';
import { getBaseQuestionNumber } from '../../utils/tabs/questionHelpers';
import { getExpectedColumnHeadersForBase } from '../../utils/tabs/expectedHeaders';

const BRAND_ORANGE = '#D14A2D';

interface TabSpecsViewProps {
  tabSpecsSubView: 'tables' | 'banners';
  onTabSpecsSubViewChange: (view: 'tables' | 'banners') => void;
  tabSpecsTypeFilter: string;
  onTabSpecsTypeFilterChange: (filter: string) => void;
  tabSpecsTypeOptions: string[];
  specsResetKey: number;
  selectedQuestionnaire: any;
  questionnaireQuestions: any[];
  variables: Variable[];
  variableTableSelections: Record<string, Set<string>>;
  onQuestionClick: (question: any, displayVariable: Variable | null) => void;
  onShowSettingsPopup: () => void;
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
  onBannerChange: (group: any) => void;
  onBannerSave: () => void;
  onBannerCancel: () => void;
  onBannerFilterConditionsChange: (conditions: any) => void;
}

export const TabSpecsView: React.FC<TabSpecsViewProps> = ({
  tabSpecsSubView,
  onTabSpecsSubViewChange,
  tabSpecsTypeFilter,
  onTabSpecsTypeFilterChange,
  tabSpecsTypeOptions,
  specsResetKey,
  selectedQuestionnaire,
  questionnaireQuestions,
  variables,
  variableTableSelections,
  onQuestionClick,
  onShowSettingsPopup,
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
  onBannerChange,
  onBannerSave,
  onBannerCancel,
  onBannerFilterConditionsChange,
}) => {
  return (
    <div className="p-6">
      <div className="mb-4 flex items-start justify-between">
        <div>
          <h2 className="text-lg font-semibold text-gray-900 mb-2">Table Specifications</h2>
          <div className="flex items-center gap-2">
            <button
              onClick={() => onTabSpecsSubViewChange('tables')}
              className={`px-3 py-1.5 text-xs sm:text-sm font-medium rounded-md border transition-colors ${
                tabSpecsSubView === 'tables'
                  ? 'text-white'
                  : 'text-gray-900 bg-white border-gray-300 hover:bg-gray-50'
              }`}
              style={tabSpecsSubView === 'tables' ? { backgroundColor: BRAND_ORANGE, borderColor: BRAND_ORANGE } : {}}
            >
              Tables
            </button>
            <button
              onClick={() => onTabSpecsSubViewChange('banners')}
              className={`px-3 py-1.5 text-xs sm:text-sm font-medium rounded-md border transition-colors ${
                tabSpecsSubView === 'banners'
                  ? 'text-white'
                  : 'text-gray-900 bg-white border-gray-300 hover:bg-gray-50'
              }`}
              style={tabSpecsSubView === 'banners' ? { backgroundColor: BRAND_ORANGE, borderColor: BRAND_ORANGE } : {}}
            >
              Banners
            </button>
          </div>
        </div>
        {tabSpecsSubView === 'tables' && questionnaireQuestions.length > 0 && (
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
        )}
        {tabSpecsSubView === 'banners' && !showBannerBuilder && !selectedNewBannerGroupId && (
          <div className="flex items-center gap-2">
            <button
              onClick={async () => {
                // Generate and download banner spec template using ExcelJS for styling
                const workbook = new ExcelJS.Workbook();
                const worksheet = workbook.addWorksheet('Banner Specs');
                
                // Set column widths
                worksheet.getColumn(1).width = 30; // Banner Heading
                worksheet.getColumn(2).width = 30; // Banner Point
                worksheet.getColumn(3).width = 50; // Banner Definition
                
                // Add header row with brand orange background and white text
                const headerRow = worksheet.addRow(['Banner Heading (e.g. Gender)', 'Banner Point (e.g. Male)', 'Banner Definition']);
                headerRow.font = { color: { argb: 'FFFFFFFF' }, bold: true };
                headerRow.fill = {
                  type: 'pattern',
                  pattern: 'solid',
                  fgColor: { argb: 'FFD14A2D' } // Brand orange
                };
                headerRow.alignment = { horizontal: 'left', vertical: 'middle' };
                
                // Add Total row as first data row
                worksheet.addRow(['Total', '', '']);
                
                // Generate buffer and download
                const buffer = await workbook.xlsx.writeBuffer();
                const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
                const url = window.URL.createObjectURL(blob);
                const link = document.createElement('a');
                link.href = url;
                link.download = 'Banner_Spec_Template.xlsx';
                document.body.appendChild(link);
                link.click();
                document.body.removeChild(link);
                window.URL.revokeObjectURL(url);
              }}
              className="flex items-center gap-2 px-3 py-1.5 text-sm text-white rounded-lg hover:opacity-90"
              style={{ backgroundColor: BRAND_ORANGE }}
              title="Download banner spec template"
            >
              <ArrowDownTrayIcon className="h-5 w-5" />
              Download Banner Spec Template
            </button>
            <input
              ref={bannerSpecsFileInputRef}
              type="file"
              accept=".xlsx,.xls"
              className="hidden"
              onChange={onBannerSpecsFileChange}
            />
            <button
              onClick={onHandleClickImportBannerSpecs}
              className="flex items-center gap-2 px-3 py-1.5 text-sm text-white rounded-lg hover:opacity-90"
              style={{ backgroundColor: BRAND_ORANGE }}
              title="Create banner group using banner specs (AI)"
            >
              <PlusCircleIcon className="h-5 w-5" />
              Add
            </button>
          </div>
        )}
      </div>
      {tabSpecsSubView === 'tables' ? (
        <>
          {!selectedQuestionnaire ? (
            <div className="text-center py-12">
              <TableCellsIcon className="mx-auto h-12 w-12 text-gray-300 mb-4" />
              <p className="text-gray-500">Please select a questionnaire to view table specifications</p>
            </div>
          ) : questionnaireQuestions.length === 0 ? (
            <div className="text-center py-12">
              <TableCellsIcon className="mx-auto h-12 w-12 text-gray-300 mb-4" />
              <p className="text-gray-500">No questions found in this questionnaire.</p>
            </div>
          ) : (
            <div className="overflow-x-auto max-h-[600px] relative">
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
                  {questionnaireQuestions
                    .filter(question => {
                      if (tabSpecsTypeFilter === 'all') return true;
                      const qType = question.type || 'Unknown';
                      return qType === tabSpecsTypeFilter;
                    })
                    .map(question => {
                      const qNum = question.number || question.id;
                      const qNumStr = String(qNum);
                      const tags = question.tags || [];
                      const questionText = question.text || question.question || question.description || qNumStr;
                      const questionType = question.type || 'Unknown';
                      const typeLower = questionType.toLowerCase();
                      const isNumericGrid = typeLower.includes('numeric grid') || typeLower.includes('numeric list');
                      
                      // Find matching variable if it exists (for when data is uploaded)
                      const matchingVariable = variables.find(v => {
                        const vBase = getBaseQuestionNumber(v.name);
                        return vBase === qNumStr || vBase === qNumStr.replace(/^Q/, '') || vBase.replace(/^Q/, '') === qNumStr;
                      });
                      // Use variable if available, otherwise use question
                      const displayVariable = matchingVariable || null;
                      
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
                      
                      // Check if any tables are selected for this question
                      const isIncluded = (() => {
                        // Check if we have a matching variable with selected tables
                        if (displayVariable) {
                          const varName = displayVariable.name;
                          const selections = variableTableSelections[varName];
                          if (selections && selections.size > 0) {
                            return true;
                          }
                        }
                        
                        // Also check by question number (for questions without variables yet)
                        // Table selections might be stored with the question number as the key
                        const qNumForMatching = qNumStr.replace(/^Q/, '');
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
                          key={qNumStr}
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
                              hasDataFile && isFullyUnmapped ? (
                                <InformationCircleIcon 
                                  className="h-5 w-5 text-yellow-500 mx-auto cursor-help" 
                                  title="Marked to include but not mapped to any variables from the data file"
                                />
                              ) : (
                                <CheckCircleIcon className="h-5 w-5 text-green-500 mx-auto" />
                              )
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
                variables={variables}
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

