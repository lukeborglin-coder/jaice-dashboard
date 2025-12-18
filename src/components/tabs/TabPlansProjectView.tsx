import React from 'react';
import { ArrowLeftIcon, PlusCircleIcon, TrashIcon } from '@heroicons/react/24/outline';
import { IconTable } from '@tabler/icons-react';
import { TabPlan } from '../../hooks/useTabPlans';

const BRAND_ORANGE = '#D14A2D';

interface TabPlansProjectViewProps {
  selectedProject: any;
  plans: TabPlan[];
  loading: boolean;
  qnrNameById?: Record<string, string>;
  onBackToProjects: () => void;
  onCreateNewPlan: () => void;
  onOpenPlan: (plan: TabPlan) => void;
  onDeletePlan: (plan: TabPlan) => Promise<void> | void;
}

export const TabPlansProjectView: React.FC<TabPlansProjectViewProps> = ({
  selectedProject,
  plans,
  loading,
  qnrNameById = {},
  onBackToProjects,
  onCreateNewPlan,
  onOpenPlan,
  onDeletePlan,
}) => {
  const formatUpdated = (iso: string | undefined) => {
    if (!iso) return '-';
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '-';
    return d.toLocaleString(undefined, {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  return (
    <>
      <div>
        <div className="flex items-center justify-between">
          <button
            onClick={onBackToProjects}
            className="flex items-center gap-2 text-sm text-gray-600 hover:text-gray-800 hover:bg-gray-100 px-3 py-1 rounded-lg transition-colors"
          >
            <ArrowLeftIcon className="h-4 w-4" />
            Back to Projects
          </button>
          {plans.length > 0 && (
            <div className="flex items-center gap-2">
              <button
                onClick={onCreateNewPlan}
                className="flex items-center gap-2 px-3 py-1 text-xs text-white rounded-md hover:opacity-90"
                style={{ backgroundColor: BRAND_ORANGE }}
              >
                Create New Tab Plan
              </button>
            </div>
          )}
        </div>
        <div className="border-b border-gray-200"></div>
      </div>

      <div className="bg-white shadow-sm border border-gray-200 rounded-lg overflow-hidden">
        {loading ? (
          <div className="p-12 text-center">
            <div className="mx-auto mb-4 h-12 w-12 animate-spin rounded-full border-4 border-gray-200 border-t-[#D14A2D]"></div>
            <p className="text-sm text-gray-600">Loading tab plans…</p>
          </div>
        ) : plans.length === 0 ? (
          <div className="p-12 text-center">
            <IconTable className="mx-auto mb-4 h-16 w-16 text-gray-300" />
            <h3 className="text-lg font-semibold text-gray-900">No tab plans yet</h3>
            <p className="mt-2 text-gray-500">
              Create a tab plan for <span className="font-medium">{selectedProject?.name}</span> to start working in Tabs.
            </p>
            <div className="mt-6">
              <button
                onClick={onCreateNewPlan}
                className="inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium text-white shadow-sm transition hover:opacity-90"
                style={{ backgroundColor: BRAND_ORANGE }}
              >
                <PlusCircleIcon className="h-5 w-5" />
                Create New Tab Plan
              </button>
            </div>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Plan</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Source</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Updated</th>
                  <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider"></th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {plans.map((p) => (
                  <tr
                    key={p.id}
                    className="hover:bg-gray-50 cursor-pointer transition-colors"
                    onClick={() => onOpenPlan(p)}
                  >
                    <td className="px-6 py-4">
                      <div className="text-sm font-medium text-gray-900">{p.name}</div>
                    </td>
                    <td className="px-6 py-4 text-sm text-gray-700">
                      {p.sourceType === 'qnr' ? (
                        <span>{p.qnrId ? (qnrNameById[String(p.qnrId)] || 'QNR') : 'QNR'}</span>
                      ) : (
                        <span>Raw data upload</span>
                      )}
                    </td>
                    <td className="px-6 py-4 text-sm text-gray-700">
                      {formatUpdated(p.updatedAt)}
                    </td>
                    <td className="px-6 py-4 text-right">
                      <button
                        onClick={async (e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          const ok = window.confirm(`Delete tab plan "${p.name}"? This cannot be undone.`);
                          if (!ok) return;
                          await onDeletePlan(p);
                        }}
                        className="inline-flex items-center justify-center p-1 text-red-600 hover:text-red-700 hover:bg-red-50 rounded transition-colors"
                        title="Delete tab plan"
                      >
                        <TrashIcon className="h-4 w-4" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  );
};





