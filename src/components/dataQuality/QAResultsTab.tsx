import React, { useState } from 'react';
import { PlayIcon, ChevronDownIcon, ChevronUpIcon } from '@heroicons/react/24/outline';

interface QAResultsTabProps {
  projectId: string;
  qaResults: any[];
  loadingResults: boolean;
  resultsSummary: any;
  onRunQA: (respondentIds?: string[], force?: boolean, questionnaireId?: string) => Promise<any>;
  onUpdateResult: (respno: string, updates: any) => Promise<any>;
  onLoadResults: (filters?: any) => Promise<any>;
}

export default function QAResultsTab({
  projectId,
  qaResults,
  loadingResults,
  resultsSummary,
  onRunQA,
  onUpdateResult,
  onLoadResults
}: QAResultsTabProps) {
  const [running, setRunning] = useState(false);
  const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set());
  const [categoryFilter, setCategoryFilter] = useState<string>('');
  const [checkTypeFilter, setCheckTypeFilter] = useState<string>('');

  const handleRunQA = async () => {
    if (!window.confirm('Run QA checks for all new respondents?')) return;
    
    setRunning(true);
    try {
      await onRunQA();
      await onLoadResults({ category: categoryFilter || undefined, checkType: checkTypeFilter || undefined });
    } catch (error: any) {
      console.error('Error running QA:', error);
      alert(error.response?.data?.error || 'Failed to run QA checks');
    } finally {
      setRunning(false);
    }
  };

  const handleUpdateCategory = async (respno: string, category: string) => {
    try {
      await onUpdateResult(respno, { category, statusLocked: true });
      await onLoadResults({ category: categoryFilter || undefined, checkType: checkTypeFilter || undefined });
    } catch (error) {
      console.error('Error updating category:', error);
    }
  };

  const toggleRow = (respno: string) => {
    const newExpanded = new Set(expandedRows);
    if (newExpanded.has(respno)) {
      newExpanded.delete(respno);
    } else {
      newExpanded.add(respno);
    }
    setExpandedRows(newExpanded);
  };

  const getCategoryColor = (category: string) => {
    switch (category) {
      case 'good':
        return 'bg-green-100 text-green-800';
      case 'questionable':
        return 'bg-yellow-100 text-yellow-800';
      case 'remove':
        return 'bg-red-100 text-red-800';
      default:
        return 'bg-gray-100 text-gray-800';
    }
  };

  const filteredResults = qaResults.filter((result) => {
    if (categoryFilter && result.category !== categoryFilter) return false;
    if (checkTypeFilter && !result.flags?.some((f: any) => f.checkTypeId === checkTypeFilter)) return false;
    return true;
  });

  return (
    <div className="p-6">
      <div className="flex justify-between items-center mb-6">
        <h2 className="text-xl font-semibold">QA Results</h2>
        <button
          onClick={handleRunQA}
          disabled={running}
          className="px-4 py-2 bg-orange-500 text-white rounded-lg hover:bg-orange-600 disabled:opacity-50 flex items-center gap-2"
        >
          <PlayIcon className="w-4 h-4" />
          {running ? 'Running QA...' : 'Run QA'}
        </button>
      </div>

      {/* Summary Stats */}
      {resultsSummary && (
        <div className="grid grid-cols-3 gap-4 mb-6">
          <div className="bg-white rounded-lg border border-gray-200 p-4">
            <div className="text-sm text-gray-500">Good</div>
            <div className="text-2xl font-semibold text-green-600">{resultsSummary.byCategory?.good || 0}</div>
            <div className="text-xs text-gray-400">{resultsSummary.percentages?.good || '0.0'}%</div>
          </div>
          <div className="bg-white rounded-lg border border-gray-200 p-4">
            <div className="text-sm text-gray-500">Questionable</div>
            <div className="text-2xl font-semibold text-yellow-600">{resultsSummary.byCategory?.questionable || 0}</div>
            <div className="text-xs text-gray-400">{resultsSummary.percentages?.questionable || '0.0'}%</div>
          </div>
          <div className="bg-white rounded-lg border border-gray-200 p-4">
            <div className="text-sm text-gray-500">Remove</div>
            <div className="text-2xl font-semibold text-red-600">{resultsSummary.byCategory?.remove || 0}</div>
            <div className="text-xs text-gray-400">{resultsSummary.percentages?.remove || '0.0'}%</div>
          </div>
        </div>
      )}

      {/* Filters */}
      <div className="flex gap-4 mb-4">
        <select
          value={categoryFilter}
          onChange={(e) => {
            setCategoryFilter(e.target.value);
            onLoadResults({ category: e.target.value || undefined, checkType: checkTypeFilter || undefined });
          }}
          className="px-3 py-2 border border-gray-300 rounded-lg"
        >
          <option value="">All Categories</option>
          <option value="good">Good</option>
          <option value="questionable">Questionable</option>
          <option value="remove">Remove</option>
        </select>
        <select
          value={checkTypeFilter}
          onChange={(e) => {
            setCheckTypeFilter(e.target.value);
            onLoadResults({ category: categoryFilter || undefined, checkType: e.target.value || undefined });
          }}
          className="px-3 py-2 border border-gray-300 rounded-lg"
        >
          <option value="">All Check Types</option>
          <option value="open_end">Open-End</option>
          <option value="straightlining">Straight-Lining</option>
          <option value="speeding">Speeding</option>
          <option value="logic_consistency">Logic Consistency</option>
          <option value="custom">Custom</option>
        </select>
      </div>

      {/* Results Table */}
      <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
        <table className="min-w-full divide-y divide-gray-200">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase w-12"></th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">RESPNO</th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Category</th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Score</th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Flags</th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Main Reasons</th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Actions</th>
            </tr>
          </thead>
          <tbody className="bg-white divide-y divide-gray-200">
            {filteredResults.length > 0 ? (
              filteredResults.map((result) => (
                <React.Fragment key={result.respno}>
                  <tr className="hover:bg-gray-50">
                    <td className="px-4 py-3">
                      <button
                        onClick={() => toggleRow(result.respno)}
                        className="text-gray-400 hover:text-gray-600"
                      >
                        {expandedRows.has(result.respno) ? (
                          <ChevronUpIcon className="w-4 h-4" />
                        ) : (
                          <ChevronDownIcon className="w-4 h-4" />
                        )}
                      </button>
                    </td>
                    <td className="px-4 py-3 text-sm font-medium text-gray-900">{result.respno}</td>
                    <td className="px-4 py-3 text-sm">
                      <span className={`px-2 py-1 rounded-full text-xs font-medium ${getCategoryColor(result.category)}`}>
                        {result.category}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-500">{result.score}</td>
                    <td className="px-4 py-3 text-sm text-gray-500">{result.flags?.length || 0}</td>
                    <td className="px-4 py-3 text-sm text-gray-500">
                      {result.flags?.slice(0, 2).map((f: any) => f.message).join(', ') || '-'}
                    </td>
                    <td className="px-4 py-3 text-sm">
                      <select
                        value={result.category}
                        onChange={(e) => handleUpdateCategory(result.respno, e.target.value)}
                        className="px-2 py-1 border border-gray-300 rounded text-xs"
                      >
                        <option value="good">Good</option>
                        <option value="questionable">Questionable</option>
                        <option value="remove">Remove</option>
                      </select>
                    </td>
                  </tr>
                  {expandedRows.has(result.respno) && (
                    <tr>
                      <td colSpan={7} className="px-4 py-4 bg-gray-50">
                        <div className="space-y-2">
                          <div className="font-medium text-sm mb-2">Flags:</div>
                          {result.flags?.map((flag: any, idx: number) => (
                            <div key={idx} className="text-sm text-gray-600 pl-4 border-l-2 border-gray-300">
                              <div className="font-medium">{flag.checkTypeId} - {flag.severity}</div>
                              <div className="text-gray-500">{flag.message}</div>
                            </div>
                          ))}
                        </div>
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              ))
            ) : (
              <tr>
                <td colSpan={7} className="px-4 py-8 text-center text-gray-500">
                  {loadingResults ? 'Loading results...' : 'No QA results found. Click "Run QA" to start.'}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}


