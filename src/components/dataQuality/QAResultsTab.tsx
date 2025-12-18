import React, { useState } from 'react';
import { PlayIcon, ChevronDownIcon, ChevronUpIcon, ArrowDownTrayIcon } from '@heroicons/react/24/outline';
import { useToast } from '../Toast';
import Pagination from '../Pagination';

const BRAND_ORANGE = '#D14A2D';

interface PaginationState {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

interface QAResultsTabProps {
  projectId: string;
  qaResults: any[];
  loadingResults: boolean;
  resultsSummary: any;
  pagination?: PaginationState;
  onRunQA: (respondentIds?: string[], force?: boolean, questionnaireId?: string) => Promise<any>;
  onUpdateResult: (respno: string, updates: any) => Promise<any>;
  onLoadResults: (filters?: any) => Promise<any>;
  onBulkUpdate?: (respnos: string[], updates: any) => Promise<any>;
}

export default function QAResultsTab({
  projectId,
  qaResults,
  loadingResults,
  resultsSummary,
  pagination,
  onRunQA,
  onUpdateResult,
  onLoadResults,
  onBulkUpdate
}: QAResultsTabProps) {
  const toast = useToast();
  const [running, setRunning] = useState(false);
  const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set());
  const [categoryFilter, setCategoryFilter] = useState<string>('');
  const [checkTypeFilter, setCheckTypeFilter] = useState<string>('');
  const [selectedRows, setSelectedRows] = useState<Set<string>>(new Set());
  const [bulkUpdating, setBulkUpdating] = useState(false);

  const handleRunQA = async () => {
    if (!window.confirm('Run QA checks for all new respondents?')) return;
    
    setRunning(true);
    try {
      await onRunQA();
      await onLoadResults({ category: categoryFilter || undefined, checkType: checkTypeFilter || undefined });
      toast.success('QA checks completed successfully');
    } catch (error: any) {
      console.error('Error running QA:', error);
      toast.error(error.response?.data?.error || 'Failed to run QA checks');
    } finally {
      setRunning(false);
    }
  };

  const handleUpdateCategory = async (respno: string, category: string) => {
    try {
      await onUpdateResult(respno, { category, statusLocked: true });
      toast.success(`Updated respondent ${respno} to ${category}`);
    } catch (error) {
      console.error('Error updating category:', error);
      toast.error('Failed to update category');
    }
  };

  const handleSelectAll = () => {
    if (selectedRows.size === qaResults.length) {
      setSelectedRows(new Set());
    } else {
      setSelectedRows(new Set(qaResults.map(r => r.respno)));
    }
  };

  const handleSelectRow = (respno: string) => {
    const newSelected = new Set(selectedRows);
    if (newSelected.has(respno)) {
      newSelected.delete(respno);
    } else {
      newSelected.add(respno);
    }
    setSelectedRows(newSelected);
  };

  const handleBulkUpdate = async (category: string) => {
    if (selectedRows.size === 0) {
      toast.warning('No respondents selected');
      return;
    }

    if (!window.confirm(`Update ${selectedRows.size} respondent(s) to "${category}"?`)) return;

    setBulkUpdating(true);
    try {
      if (onBulkUpdate) {
        await onBulkUpdate(Array.from(selectedRows), { category, statusLocked: true });
      } else {
        // Fallback to individual updates
        await Promise.all(
          Array.from(selectedRows).map(respno => 
            onUpdateResult(respno, { category, statusLocked: true })
          )
        );
        await onLoadResults({ category: categoryFilter || undefined, checkType: checkTypeFilter || undefined });
      }
      toast.success(`Updated ${selectedRows.size} respondent(s) to ${category}`);
      setSelectedRows(new Set());
    } catch (error) {
      console.error('Error bulk updating:', error);
      toast.error('Failed to update some respondents');
    } finally {
      setBulkUpdating(false);
    }
  };

  const handleExportCSV = () => {
    if (qaResults.length === 0) {
      toast.warning('No results to export');
      return;
    }

    const headers = ['RESPNO', 'Category', 'Score', 'Flags Count', 'Main Reasons'];
    const rows = qaResults.map(r => [
      r.respno,
      r.category,
      r.score,
      r.flags?.length || 0,
      r.flags?.slice(0, 3).map((f: any) => f.message).join('; ') || ''
    ]);

    const csvContent = [
      headers.join(','),
      ...rows.map(row => row.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(','))
    ].join('\n');

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `qa_results_${projectId}_${new Date().toISOString().split('T')[0]}.csv`;
    link.click();
    URL.revokeObjectURL(link.href);
    toast.success('Results exported successfully');
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
        <div className="flex gap-2">
          <button
            onClick={handleExportCSV}
            disabled={qaResults.length === 0}
            className="px-4 py-2 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 disabled:opacity-50 flex items-center gap-2 transition-colors"
          >
            <ArrowDownTrayIcon className="w-4 h-4" />
            Export CSV
          </button>
          <button
            onClick={handleRunQA}
            disabled={running}
            className="px-4 py-2 text-white rounded-lg disabled:opacity-50 flex items-center gap-2 transition-colors"
            style={{ backgroundColor: BRAND_ORANGE }}
            onMouseOver={(e) => !running && (e.currentTarget.style.backgroundColor = '#B8402A')}
            onMouseOut={(e) => e.currentTarget.style.backgroundColor = BRAND_ORANGE}
          >
            <PlayIcon className="w-4 h-4" />
            {running ? 'Running QA...' : 'Run QA'}
          </button>
        </div>
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

      {/* Filters and Bulk Actions */}
      <div className="flex justify-between items-center mb-4">
        <div className="flex gap-4">
          <select
            value={categoryFilter}
            onChange={(e) => {
              setCategoryFilter(e.target.value);
              onLoadResults({ category: e.target.value || undefined, checkType: checkTypeFilter || undefined });
            }}
            className="px-3 py-2 border border-gray-300 rounded-lg text-sm"
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
            className="px-3 py-2 border border-gray-300 rounded-lg text-sm"
          >
            <option value="">All Check Types</option>
            <option value="open_end">Open-End</option>
            <option value="straightlining">Straight-Lining</option>
            <option value="speeding">Speeding</option>
            <option value="logic_consistency">Logic Consistency</option>
            <option value="custom">Custom</option>
          </select>
        </div>

        {/* Bulk Actions */}
        {selectedRows.size > 0 && (
          <div className="flex items-center gap-3 px-4 py-2 rounded-lg border" style={{ backgroundColor: `${BRAND_ORANGE}10`, borderColor: `${BRAND_ORANGE}40` }}>
            <span className="text-sm font-medium" style={{ color: BRAND_ORANGE }}>
              {selectedRows.size} selected
            </span>
            <div className="flex gap-2">
              <button
                onClick={() => handleBulkUpdate('good')}
                disabled={bulkUpdating}
                className="px-3 py-1 text-xs bg-green-100 text-green-800 rounded hover:bg-green-200 disabled:opacity-50 transition-colors"
              >
                Mark Good
              </button>
              <button
                onClick={() => handleBulkUpdate('questionable')}
                disabled={bulkUpdating}
                className="px-3 py-1 text-xs bg-yellow-100 text-yellow-800 rounded hover:bg-yellow-200 disabled:opacity-50 transition-colors"
              >
                Mark Questionable
              </button>
              <button
                onClick={() => handleBulkUpdate('remove')}
                disabled={bulkUpdating}
                className="px-3 py-1 text-xs bg-red-100 text-red-800 rounded hover:bg-red-200 disabled:opacity-50 transition-colors"
              >
                Mark Remove
              </button>
              <button
                onClick={() => setSelectedRows(new Set())}
                className="px-3 py-1 text-xs text-gray-600 hover:text-gray-800 transition-colors"
              >
                Clear
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Results Table */}
      <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
        <table className="min-w-full divide-y divide-gray-200">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-4 py-3 w-10">
                <input
                  type="checkbox"
                  checked={qaResults.length > 0 && selectedRows.size === qaResults.length}
                  onChange={handleSelectAll}
                  className="w-4 h-4 rounded"
                  style={{ accentColor: BRAND_ORANGE }}
                />
              </th>
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
                  <tr className="hover:bg-gray-50" style={selectedRows.has(result.respno) ? { backgroundColor: `${BRAND_ORANGE}10` } : {}}>
                    <td className="px-4 py-3">
                      <input
                        type="checkbox"
                        checked={selectedRows.has(result.respno)}
                        onChange={() => handleSelectRow(result.respno)}
                        className="w-4 h-4 rounded"
                        style={{ accentColor: BRAND_ORANGE }}
                      />
                    </td>
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
                      <td colSpan={8} className="px-4 py-4 bg-gray-50">
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
                <td colSpan={8} className="px-4 py-8 text-center text-gray-500">
                  {loadingResults ? 'Loading results...' : 'No QA results found. Click "Run QA" to start.'}
                </td>
              </tr>
            )}
          </tbody>
        </table>
        {pagination && pagination.totalPages > 1 && (
          <Pagination
            page={pagination.page}
            totalPages={pagination.totalPages}
            total={pagination.total}
            limit={pagination.limit}
            onPageChange={(newPage) => onLoadResults({ 
              category: categoryFilter || undefined, 
              checkType: checkTypeFilter || undefined,
              page: newPage,
              limit: pagination.limit
            })}
            onLimitChange={(newLimit) => onLoadResults({ 
              category: categoryFilter || undefined, 
              checkType: checkTypeFilter || undefined,
              page: 1,
              limit: newLimit
            })}
          />
        )}
      </div>
    </div>
  );
}




