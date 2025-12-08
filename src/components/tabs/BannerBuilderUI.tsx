import React from 'react';
import { BannerGroup } from '../../types/dataTabulation';
import { Variable } from '../../utils/tabs/types';
import { TrashIcon, ArrowDownTrayIcon, ArrowPathIcon } from '@heroicons/react/24/outline';
import { IconTable } from '@tabler/icons-react';

const BRAND_ORANGE = '#D14A2D';

interface BannerBuilderUIProps {
  bannerGroups: BannerGroup[];
  onEdit: (group: BannerGroup) => void;
  onDelete: (groupId: string) => void;
  onExport?: (groupId: string) => Promise<void>;
  exportingBannerId?: string | null;
  variables?: Variable[];
}

export const BannerBuilderUI: React.FC<BannerBuilderUIProps> = ({
  bannerGroups,
  onEdit,
  onDelete,
  onExport,
  exportingBannerId,
  variables = [],
}) => {
  return (
    <div className="flex flex-col flex-1 py-6 pr-6">
      <div className="mb-6">
        <h3 className="text-lg font-semibold text-gray-900">Banner Groups</h3>
      </div>
      {bannerGroups.length === 0 ? (
        <div className="text-center py-12">
          <IconTable className="h-16 w-16 text-gray-300 mx-auto mb-4" />
          <h3 className="text-lg font-medium text-gray-900 mb-2">No Banner Groups</h3>
          <p className="text-gray-600 mb-4">Create banner groups to organize your cross-tabulations</p>
          <p className="text-sm text-gray-500">Click "Create Banner Group" button above to get started</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-3 pl-0">
          {bannerGroups.map((group) => {
            // Build "Subgroup (Cut1, Cut2), Other Group (CutA, CutB)" style subtitle
            const subgroupSummaries: string[] = Array.isArray(group.groups)
              ? group.groups.map((sub: any) => {
                  const titles = Array.isArray(sub.cuts)
                    ? sub.cuts
                        .map((c: any) => String(c.title || '').trim())
                        .filter(Boolean)
                    : [];
                  const uniqueTitles = Array.from(new Set(titles));
                  const cutsText = uniqueTitles.join(', ');
                  const groupTitle = String(sub.title || '').trim();
                  if (groupTitle && cutsText) {
                    return `${groupTitle} (${cutsText})`;
                  }
                  if (groupTitle) return groupTitle;
                  return cutsText;
                }).filter((s: string) => !!s && s !== '()')
              : [];
            const cutsSubtitle = subgroupSummaries.join(', ');
            return (
              <div
                key={group.id}
                className="flex items-center justify-between border border-gray-200 rounded-lg px-4 py-3 hover:border-gray-300 hover:bg-gray-50 transition-colors"
                onClick={() => onEdit(group)}
                role="button"
              >
                <div className="min-w-0 pr-3">
                  <div className="text-sm font-medium text-gray-900 truncate">{group.title}</div>
                  {cutsSubtitle && (
                    <div className="text-xs italic text-gray-600 mt-0.5 truncate">{cutsSubtitle}</div>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  {onExport && (
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        void onExport(group.id);
                      }}
                      className={`p-2 rounded-lg transition-colors ${exportingBannerId === group.id ? 'text-gray-400 cursor-wait' : 'text-gray-600 hover:text-gray-900 hover:bg-gray-100'}`}
                      title={exportingBannerId === group.id ? 'Exporting...' : 'Download tables for this banner'}
                      disabled={exportingBannerId === group.id}
                    >
                      {exportingBannerId === group.id ? (
                        <ArrowPathIcon className="h-5 w-5 animate-spin" />
                      ) : (
                        <ArrowDownTrayIcon className="h-5 w-5" />
                      )}
                    </button>
                  )}
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      if (window.confirm('Are you sure you want to delete this banner group?')) {
                        onDelete(group.id);
                      }
                    }}
                    className="p-2 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                    title="Delete banner group"
                  >
                    <TrashIcon className="h-5 w-5" />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};
