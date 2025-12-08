import React from 'react';
import { createPortal } from 'react-dom';
import { XMarkIcon } from '@heroicons/react/24/outline';
import { Variable } from '../../utils/tabs/types';
import { VariableStatsSelection } from '../../utils/tabs/types';

interface DebugModalProps {
  isOpen: boolean;
  onClose: () => void;
  variable: Variable | null;
  tableName?: string;
  questionnaireQuestions?: any[];
  fullRawData?: { columns: string[]; rows: any[] } | null;
  statsSelections?: VariableStatsSelection;
  variableSortByFrequency?: boolean;
  netSummaryTableSelectedCodes?: Array<{ name: string; codes: string[] }>;
  netSummaryTableRanges?: Array<{ name: string; low: string; high: string }>;
}

export const DebugModal: React.FC<DebugModalProps> = ({
  isOpen,
  onClose,
  variable,
  tableName,
  questionnaireQuestions = [],
  fullRawData,
  statsSelections,
  variableSortByFrequency = false,
  netSummaryTableSelectedCodes = [],
  netSummaryTableRanges = [],
}) => {
  if (!isOpen || !variable) return null;

  const tags = (variable as any).tags || [];
  const isNumericGrid = variable.type?.toLowerCase().includes('numeric grid');
  const isSingleSelectGrid = variable.type?.toLowerCase().includes('single select grid') && !(variable as any).isSummaryTable;
  const isMultiSelectGrid = variable.type?.toLowerCase().includes('multi-select grid');
  const isMainQuestionRow = !tableName || (tableName.includes('Summary') && tableName.includes(','));
  const isSummaryTable = isMainQuestionRow || (tableName ? (
    tableName.endsWith('_T2B') ||
    tableName.endsWith('_M3B') ||
    tableName.endsWith('_B2B') ||
    tableName.includes('_Mean Summary') ||
    tableName.includes('Summary') && (tableName.includes(variable.name)) ||
    (isNumericGrid && tableName.match(/^[A-Z0-9]+_\d+\s*\(.+\)$/)) ||
    (isNumericGrid && tableName.match(/^[A-Z0-9]+_c\d+_Summary\s*\(.+\)$/))
  ) : false);

  const question = questionnaireQuestions.find(q => {
    const qNum = q.number || q.id;
    const baseNum = variable.name.split('_')[0].replace(/^Q/i, '');
    return qNum === baseNum || qNum === 'Q' + baseNum || String(qNum) === String(baseNum);
  });

  const hasNets = (netSummaryTableSelectedCodes && netSummaryTableSelectedCodes.length > 0) || 
                  (netSummaryTableRanges && netSummaryTableRanges.length > 0);

  return createPortal(
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg shadow-xl max-w-4xl w-full max-h-[90vh] overflow-y-auto m-4">
        <div className="p-6 border-b border-gray-200 sticky top-0 bg-white z-10">
          <div className="flex items-center justify-between">
            <h2 className="text-xl font-semibold text-gray-900">
              Debug Info: {variable.name}
            </h2>
            <button
              onClick={onClose}
              className="text-gray-400 hover:text-gray-600"
            >
              <XMarkIcon className="h-6 w-6" />
            </button>
          </div>
        </div>

        <div className="p-6 space-y-6">
          {/* Variable Info */}
          <div>
            <h3 className="text-lg font-semibold text-gray-900 mb-3">Variable Information</h3>
            <div className="bg-gray-50 rounded-lg p-4 space-y-2">
              <div className="grid grid-cols-2 gap-2 text-sm">
                <div className="text-gray-600">Name:</div>
                <div className="font-mono text-gray-900">{variable.name}</div>

                <div className="text-gray-600">Description:</div>
                <div className="text-gray-900">{variable.description || 'N/A'}</div>

                <div className="text-gray-600">Type:</div>
                <div className="text-gray-900">{variable.type || 'N/A'}</div>

                <div className="text-gray-600">Is Summary Table:</div>
                <div className="text-gray-900 font-semibold">{isSummaryTable ? 'Yes' : 'No'}</div>

                {tableName && (
                  <>
                    <div className="text-gray-600">Table Name:</div>
                    <div className="text-gray-900">{tableName}</div>
                  </>
                )}

                <div className="text-gray-600">Is Main Question Row:</div>
                <div className="text-gray-900">{isMainQuestionRow ? 'Yes' : 'No'}</div>
              </div>

              {/* Stats Selections */}
              {statsSelections && (
                <div className="mt-3 pt-3 border-t border-gray-200">
                  <div className="text-gray-600 text-sm mb-2 font-semibold">Stats Selections:</div>
                  <div className="bg-white p-3 rounded border border-gray-200">
                    <div className="flex flex-col gap-1 text-xs">
                      <div className="flex items-center justify-between">
                        <span className="text-gray-600">Sort:</span>
                        <span className={variableSortByFrequency ? 'text-green-600 font-semibold' : 'text-gray-400'}>
                          {variableSortByFrequency ? 'True' : 'False'}
                        </span>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-gray-600">Sum:</span>
                        <span className={statsSelections.sum ? 'text-green-600 font-semibold' : 'text-gray-400'}>
                          {statsSelections.sum ? 'True' : 'False'}
                        </span>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-gray-600">Mean:</span>
                        <span className={statsSelections.mean ? 'text-green-600 font-semibold' : 'text-gray-400'}>
                          {statsSelections.mean ? 'True' : 'False'}
                        </span>
                      </div>
                      {!isSummaryTable && (
                        <>
                          <div className="flex items-center justify-between">
                            <span className="text-gray-600">Median:</span>
                            <span className={statsSelections.median ? 'text-green-600 font-semibold' : 'text-gray-400'}>
                              {statsSelections.median ? 'True' : 'False'}
                            </span>
                          </div>
                          <div className="flex items-center justify-between">
                            <span className="text-gray-600">Mode:</span>
                            <span className={statsSelections.mode ? 'text-green-600 font-semibold' : 'text-gray-400'}>
                              {statsSelections.mode ? 'True' : 'False'}
                            </span>
                          </div>
                          <div className="flex items-center justify-between">
                            <span className="text-gray-600">Std Dev:</span>
                            <span className={statsSelections.stdDev ? 'text-green-600 font-semibold' : 'text-gray-400'}>
                              {statsSelections.stdDev ? 'True' : 'False'}
                            </span>
                          </div>
                          <div className="flex items-center justify-between">
                            <span className="text-gray-600">Max:</span>
                            <span className={statsSelections.max ? 'text-green-600 font-semibold' : 'text-gray-400'}>
                              {statsSelections.max ? 'True' : 'False'}
                            </span>
                          </div>
                          <div className="flex items-center justify-between">
                            <span className="text-gray-600">Min:</span>
                            <span className={statsSelections.min ? 'text-green-600 font-semibold' : 'text-gray-400'}>
                              {statsSelections.min ? 'True' : 'False'}
                            </span>
                          </div>
                        </>
                      )}
                      <div className="flex items-center justify-between">
                        <span className="text-gray-600">Nets:</span>
                        <span className={hasNets ? 'text-green-600 font-semibold' : 'text-gray-400'}>
                          {hasNets ? 'True' : 'False'}
                        </span>
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* Net Definitions */}
              {hasNets && (
                <div className="mt-3 pt-3 border-t border-gray-200">
                  <div className="text-gray-600 text-sm mb-2 font-semibold">Net Definitions:</div>
                  <div className="bg-white p-3 rounded border border-gray-200">
                    <div className="flex flex-col gap-2 text-xs">
                      {netSummaryTableSelectedCodes && netSummaryTableSelectedCodes.length > 0 && netSummaryTableSelectedCodes.map((net, idx) => (
                        <div key={idx} className="pb-2 border-b border-gray-200 last:border-b-0 last:pb-0">
                          <div className="font-semibold text-gray-900 mb-1">
                            {net.name || `Net ${idx + 1}`}
                          </div>
                          <div className="text-gray-600">
                            Codes: {net.codes && net.codes.length > 0 ? net.codes.join(', ') : 'None'}
                          </div>
                        </div>
                      ))}
                      {netSummaryTableRanges && netSummaryTableRanges.length > 0 && netSummaryTableRanges.map((net, idx) => (
                        <div key={idx} className="pb-2 border-b border-gray-200 last:border-b-0 last:pb-0">
                          <div className="font-semibold text-gray-900 mb-1">
                            {net.name || `Net ${idx + 1}`}
                          </div>
                          <div className="text-gray-600">
                            Range: {net.low !== undefined && net.high !== undefined ? `${net.low} - ${net.high}` : 'Not defined'}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              )}

              <div className="mt-3 pt-3 border-t border-gray-200">
                <div className="text-gray-600 text-sm mb-2">Full Variable Object:</div>
                <pre className="bg-white p-3 rounded border border-gray-200 text-xs overflow-x-auto">
                  {JSON.stringify(variable, null, 2)}
                </pre>
              </div>
            </div>
          </div>

          {/* Question Match Info */}
          <div>
            <h3 className="text-lg font-semibold text-gray-900 mb-3">Question Match</h3>
            {question ? (
              <div className="bg-gray-50 rounded-lg p-4 space-y-2">
                <div className="grid grid-cols-2 gap-2 text-sm">
                  <div className="text-gray-600">Question Number:</div>
                  <div className="font-mono text-gray-900">{question.number || question.id}</div>

                  <div className="text-gray-600">Question Type:</div>
                  <div className="text-gray-900">{question.type}</div>

                  <div className="text-gray-600">Question Text:</div>
                  <div className="text-gray-900 col-span-2">{question.text}</div>
                </div>

                <div className="mt-3 pt-3 border-t border-gray-200">
                  <div className="text-gray-600 text-sm mb-2">Full Question Object:</div>
                  <pre className="bg-white p-3 rounded border border-gray-200 text-xs overflow-x-auto">
                    {JSON.stringify(question, null, 2)}
                  </pre>
                </div>
              </div>
            ) : (
              <div className="bg-red-50 border border-red-200 rounded-lg p-4">
                <p className="text-red-900 font-semibold">No Question Match Found</p>
                <p className="text-red-700 text-sm mt-2">
                  No question was found matching variable "{variable.name}".
                  Base number extracted: "{variable.name.split('_')[0].replace(/^Q/i, '')}"
                </p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
};
