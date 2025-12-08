import React from 'react';
import { VariableListSidebar } from './VariableListSidebar';
import { VariableTablePlaceholders } from './VariableTablePlaceholders';
import { Variable } from '../../utils/tabs/types';
import { getTableOptionsForVariable } from '../../utils/tabs/tableOptions';
import { getBaseQuestionNumber } from '../../utils/tabs/questionHelpers';

interface VariablesViewProps {
  variables: Variable[];
  filteredVariables: Variable[];
  selectedVariable: string | null;
  onSelectVariable: (variableName: string | null) => void;
  variableFilter: string;
  onVariableFilterChange: (filter: string) => void;
  questionTypeFilter: string;
  onQuestionTypeFilterChange: (filter: string) => void;
  showQuestionTypeFilter: boolean;
  onToggleQuestionTypeFilter: () => void;
  loading: boolean;
  loadingFullRawData: boolean;
  getVariableDataByExpectedHeader: (expectedHeader: string) => any;
  questionnaireQuestions: any[];
  columnMapping: Record<string, string>;
  columnHeaders: string[];
  fullRawData: any;
  datamapData: any;
  dataMappingMemo: any;
  hiddenFromBanners: Set<string>;
  getExpectedHeadersForQuestion: (question: any, baseQuestionNumber?: string) => string[];
  convertHiddenVariableToExpectedHeader: (variableName: string) => string | null;
  netSummaryTableSelectedCodes: Record<string, Array<{ name: string; codes: string[] }>>;
  variableTableSelections: Record<string, Set<string>>;
  summaryTableSortSelections: Record<string, Set<string>>;
  variableSortByFrequency: Record<string, boolean>;
  variableHoldResponseCodes: Record<string, string[]>;
  getStatsSelectionsForVariable: (variableName: string) => any;
}

export const VariablesView: React.FC<VariablesViewProps> = ({
  variables,
  filteredVariables,
  selectedVariable,
  onSelectVariable,
  variableFilter,
  onVariableFilterChange,
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
  netSummaryTableSelectedCodes,
  variableTableSelections,
  summaryTableSortSelections,
  variableSortByFrequency,
  variableHoldResponseCodes,
  getStatsSelectionsForVariable,
}) => {
  return (
    <div className="flex h-[calc(100vh-200px)]">
      <VariableListSidebar
        variables={variables}
        filteredVariables={filteredVariables}
        selectedVariable={selectedVariable}
        onSelect={onSelectVariable}
        filter={variableFilter}
        onFilterChange={onVariableFilterChange}
        questionTypeFilter={questionTypeFilter}
        onQuestionTypeFilterChange={onQuestionTypeFilterChange}
        showQuestionTypeFilter={showQuestionTypeFilter}
        onToggleQuestionTypeFilter={onToggleQuestionTypeFilter}
        loading={loading}
        loadingFullRawData={loadingFullRawData}
        getVariableDataByExpectedHeader={getVariableDataByExpectedHeader}
        questionnaireQuestions={questionnaireQuestions}
        columnMapping={columnMapping}
        columnHeaders={columnHeaders}
        fullRawData={fullRawData}
        datamapData={datamapData}
        dataMappingMemo={dataMappingMemo}
        hiddenFromBanners={hiddenFromBanners}
        getExpectedHeadersForQuestion={getExpectedHeadersForQuestion}
        convertHiddenVariableToExpectedHeader={convertHiddenVariableToExpectedHeader}
        netSummaryTableSelectedCodes={netSummaryTableSelectedCodes}
      />
      {/* Variable Detail View */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {selectedVariable ? (() => {
          const selectedVar = variables.find(v => v.name === selectedVariable);
          const tableOptions = selectedVar 
            ? getTableOptionsForVariable(selectedVar, questionnaireQuestions, netSummaryTableSelectedCodes)
            : [];
          const statsSelections = getStatsSelectionsForVariable(selectedVariable);
          const typeLower = selectedVar?.type?.toLowerCase() || '';
          const isMultiSelectGrid = typeLower.includes('multi-select grid');
          const isOpenEndListType = typeLower.includes('open end list');
          const summarySortDefaultsToOn = isMultiSelectGrid || isOpenEndListType;
          
          // Find matching question for the selected variable
          const baseQuestionNumber = selectedVar ? getBaseQuestionNumber(selectedVar.name) : '';
          const matchingQuestion = questionnaireQuestions.find(question => {
            const qNum = question.number || question.id;
            if (!qNum) return false;
            const qNumStr = String(qNum);
            const normalizedQNum = qNumStr.replace(/^Q/i, '');
            const normalizedBase = baseQuestionNumber.replace(/^Q/i, '');
            return (
              qNumStr === baseQuestionNumber ||
              normalizedQNum === normalizedBase ||
              `Q${normalizedQNum}` === baseQuestionNumber ||
              `Q${normalizedBase}` === qNumStr
            );
          });
          
          const questionNumber = matchingQuestion 
            ? (matchingQuestion.number || matchingQuestion.id || baseQuestionNumber)
            : baseQuestionNumber;
          const questionText = matchingQuestion 
            ? (matchingQuestion.text || matchingQuestion.question || matchingQuestion.description || String(questionNumber))
            : '';
          const questionType = matchingQuestion 
            ? (matchingQuestion.type || 'Unknown')
            : (selectedVar?.type || 'Unknown');
          
          return (
            <>
              {/* Sticky Header with Question Number and Text */}
              <div className="sticky top-0 z-10 bg-white border-b border-gray-200 px-6 py-4 shadow-sm">
                <div className="flex items-start justify-between gap-4">
                  <div className="flex flex-col gap-2 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="text-lg font-semibold text-gray-900">
                        {questionNumber}
                      </span>
                      {(() => {
                        // Check if question has 0 mapped variables
                        if (matchingQuestion) {
                          const expectedHeaders = getExpectedHeadersForQuestion(matchingQuestion, questionNumber);
                          const mappedCount = expectedHeaders.filter(expectedHeader => {
                            const mappedColumn = columnMapping[expectedHeader] || columnMapping[expectedHeader.replace(/^Q/, '')] || '';
                            return !!mappedColumn;
                          }).length;
                          
                          if (mappedCount === 0 && expectedHeaders.length > 0) {
                            return (
                              <span className="text-xs px-2 py-1 bg-red-100 text-red-700 rounded">
                                Unmapped
                              </span>
                            );
                          }
                        }
                        return null;
                      })()}
                    </div>
                    {questionText && (
                      <span className="text-base text-gray-700">
                        {questionText}
                      </span>
                    )}
                  </div>
                  <span className="text-xs px-2 py-1 rounded flex-shrink-0 bg-blue-100 text-blue-800" style={{ minWidth: '80px', textAlign: 'center' }}>
                    {questionType}
                  </span>
                </div>
              </div>
              {/* Scrollable Content */}
              <div className="flex-1 overflow-y-auto p-6">
                <VariableTablePlaceholders
                  variable={selectedVar || null}
                  tableOptions={tableOptions}
                  statsSelections={statsSelections}
                  summaryTableSortSelections={summaryTableSortSelections}
                  summarySortDefaultsToOn={summarySortDefaultsToOn}
                  variableTableSelections={variableTableSelections}
                  variableSortByFrequency={variableSortByFrequency}
                  variableHoldResponseCodes={variableHoldResponseCodes}
                  netSummaryTableSelectedCodes={netSummaryTableSelectedCodes}
                  getVariableDataByExpectedHeader={getVariableDataByExpectedHeader}
                  fullRawData={fullRawData}
                  columnMapping={columnMapping}
                  questionnaireQuestions={questionnaireQuestions}
                />
              </div>
            </>
          );
        })() : (
          <div className="flex-1 flex items-center justify-center">
            <div className="text-center py-12 text-gray-500">Select a variable to view tables</div>
          </div>
        )}
      </div>
    </div>
  );
};

