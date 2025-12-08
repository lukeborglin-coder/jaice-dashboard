import React from 'react';
import { IconBook2 } from '@tabler/icons-react';
import { DocumentTextIcon } from '@heroicons/react/24/outline';
import { BRAND_ORANGE, BRAND_BG } from '../../../utils/constants';
import { useQualProjects } from '../../../hooks/useQualProjects';

interface Project {
  id: string;
  name: string;
  client?: string;
  archived?: boolean;
  [key: string]: any;
}

interface ContentAnalysisHomeProps {
  savedAnalyses: any[];
  onProjectSelect: (project: Project) => void;
  onCreateNew: () => void;
  user?: any;
}

export default function ContentAnalysisHome({
  savedAnalyses,
  onProjectSelect,
  onCreateNew,
  user
}: ContentAnalysisHomeProps) {
  const {
    displayProjects,
    filteredActiveProjects,
    filteredArchivedProjects,
    activeTab,
    setActiveTab,
    showMyProjectsOnly,
    setShowMyProjectsOnly,
    isLoadingProjects,
    isLoadingArchived
  } = useQualProjects({
    filterQualitative: true,
    sessionStorageKey: 'cognitive_dash_content_analysis'
  });

  const isLoadingCurrentTab = activeTab === 'active' ? isLoadingProjects : isLoadingArchived;

  return (
    <>
      {/* Tabs */}
      <div>
        <div className="flex items-center justify-between">
          <nav className="-mb-px flex space-x-8 items-center">
            <button
              onClick={() => setActiveTab('active')}
              className={`py-2 px-1 border-b-2 font-medium text-sm ${
                activeTab === 'active'
                  ? 'text-white'
                  : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
              }`}
              style={activeTab === 'active' ? { borderBottomColor: BRAND_ORANGE, color: BRAND_ORANGE } : {}}
            >
              Active Projects ({filteredActiveProjects.length})
            </button>
            <button
              onClick={() => setActiveTab('archived')}
              className={`py-2 px-1 border-b-2 font-medium text-sm ${
                activeTab === 'archived'
                  ? 'text-white'
                  : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
              }`}
              style={activeTab === 'archived' ? { borderBottomColor: BRAND_ORANGE, color: BRAND_ORANGE } : {}}
            >
              Archived Projects ({filteredArchivedProjects.length})
            </button>
          </nav>
          <div className="flex items-center gap-3">
            {user?.role !== 'oversight' && (
              <button
                onClick={() => setShowMyProjectsOnly(!showMyProjectsOnly)}
                className={`px-3 py-1 text-xs rounded-lg shadow-sm transition-colors ${
                  showMyProjectsOnly
                    ? 'bg-white border border-gray-300 hover:bg-gray-50'
                    : 'text-white hover:opacity-90'
                }`}
                style={showMyProjectsOnly ? {} : { backgroundColor: BRAND_ORANGE }}
              >
                {showMyProjectsOnly ? 'Only My Projects' : 'All Cognitive Projects'}
              </button>
            )}
            <button
              onClick={onCreateNew}
              className="flex items-center gap-1 rounded-lg px-3 py-1 text-xs shadow-sm transition-colors text-white hover:opacity-90"
              style={{ backgroundColor: BRAND_ORANGE }}
            >
              <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
              </svg>
              Create New
            </button>
          </div>
        </div>
        <div className="border-b border-gray-200"></div>
      </div>

      {/* Projects Table */}
      <div className="bg-white shadow-sm border border-gray-200 rounded-lg overflow-hidden">
        <div className="overflow-x-auto">
          {isLoadingCurrentTab ? (
            <div className="p-12 text-center">
              <div className="mx-auto mb-4 h-10 w-10 animate-spin rounded-full border-4 border-gray-200" style={{ borderTopColor: BRAND_ORANGE }}></div>
              <p className="text-sm text-gray-500">Loading projects...</p>
            </div>
          ) : displayProjects.length === 0 ? (
            <div className="p-12 text-center">
              <DocumentTextIcon className="mx-auto mb-4 h-16 w-16 text-gray-300" />
              <h3 className="text-lg font-semibold text-gray-900">
                {activeTab === 'archived'
                  ? 'No archived qualitative projects'
                  : 'No active qualitative projects'}
              </h3>
              <p className="mt-2 text-gray-500">
                {activeTab === 'archived'
                  ? 'Archived qualitative projects will appear here.'
                  : 'Create a qualitative project to start content analysis.'}
              </p>
            </div>
          ) : (
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th className="pl-6 pr-2 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider w-0 whitespace-nowrap">
                    Project
                  </th>
                  <th className="pl-2 pr-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider w-32">
                    Client
                  </th>
                  <th className="px-6 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider w-32">
                    Analyses
                  </th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {displayProjects.map(project => {
                  const projectAnalyses = savedAnalyses.filter(a => a.projectId === project.id);
                  return (
                    <tr
                      key={project.id}
                      className="hover:bg-gray-50 cursor-pointer transition-colors"
                      onClick={() => onProjectSelect(project)}
                    >
                      <td className="pl-6 pr-2 py-4 whitespace-nowrap w-0">
                        <div className="inline-block text-sm font-medium text-gray-900">{project.name}</div>
                      </td>
                      <td className="pl-2 pr-6 py-4 whitespace-nowrap w-32">
                        <div className="text-sm text-gray-900 truncate">{project.client || '-'}</div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-center w-32">
                        <div className="flex items-center justify-center gap-1 text-sm text-gray-900">
                          <IconBook2 className="h-4 w-4 text-gray-400" />
                          {projectAnalyses.length}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </>
  );
}
