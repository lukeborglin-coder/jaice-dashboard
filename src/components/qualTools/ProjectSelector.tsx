import React from 'react';
import { useQualProjects } from '../../hooks/useQualProjects';
import { BRAND_ORANGE, BRAND_BG, BRAND_GRAY } from '../../utils/constants';
import { DocumentTextIcon } from '@heroicons/react/24/outline';

interface Project {
  id: string;
  name: string;
  client?: string;
  archived?: boolean;
  [key: string]: any;
}

interface ProjectSelectorProps {
  /**
   * Session storage key for project navigation
   */
  sessionStorageKey?: string;
  /**
   * Callback when a project is selected
   */
  onProjectSelect: (project: Project) => void;
  /**
   * Custom render function for project row
   * If not provided, uses default table row
   */
  renderProjectRow?: (project: Project, index: number) => React.ReactNode;
  /**
   * Custom columns configuration
   */
  columns?: Array<{
    header: string;
    accessor: (project: Project) => React.ReactNode;
    className?: string;
  }>;
  /**
   * Empty state message
   */
  emptyStateMessage?: {
    active: string;
    archived: string;
  };
  /**
   * Empty state description
   */
  emptyStateDescription?: {
    active: string;
    archived: string;
  };
  /**
   * Hide "My Projects Only" toggle
   */
  hideMyProjectsToggle?: boolean;
  /**
   * Additional header actions
   */
  headerActions?: React.ReactNode;
}

/**
 * Shared project selector component for qualitative tools
 * Provides consistent UI for project selection across Content Analysis, Transcripts, and Storytelling
 */
export default function ProjectSelector({
  sessionStorageKey,
  onProjectSelect,
  renderProjectRow,
  columns,
  emptyStateMessage,
  emptyStateDescription,
  hideMyProjectsToggle = false,
  headerActions
}: ProjectSelectorProps) {
  const {
    displayProjects,
    filteredActiveProjects,
    filteredArchivedProjects,
    selectedProject,
    setSelectedProject,
    activeTab,
    setActiveTab,
    showMyProjectsOnly,
    setShowMyProjectsOnly,
    isLoadingProjects,
    isLoadingArchived
  } = useQualProjects({
    filterQualitative: true,
    sessionStorageKey
  });

  const isLoadingCurrentTab = activeTab === 'active' ? isLoadingProjects : isLoadingArchived;

  // Default columns if none provided
  const defaultColumns = [
    {
      header: 'Project',
      accessor: (project: Project) => (
        <div className="text-sm font-medium text-gray-900">{project.name}</div>
      ),
      className: 'pl-6 pr-2 py-4 whitespace-nowrap w-0'
    },
    {
      header: 'Client',
      accessor: (project: Project) => (
        <div className="text-sm text-gray-900 truncate">{project.client || '-'}</div>
      ),
      className: 'pl-2 pr-6 py-4 whitespace-nowrap w-32'
    }
  ];

  const displayColumns = columns || defaultColumns;

  // Default empty state messages
  const defaultEmptyStateMessage = {
    active: 'No active qualitative projects',
    archived: 'No archived qualitative projects'
  };

  const defaultEmptyStateDescription = {
    active: 'Create a qualitative project to get started.',
    archived: 'Archived qualitative projects will appear here.'
  };

  const emptyMessage = emptyStateMessage || defaultEmptyStateMessage;
  const emptyDescription = emptyStateDescription || defaultEmptyStateDescription;

  const handleProjectClick = (project: Project) => {
    setSelectedProject(project);
    onProjectSelect(project);
  };

  return (
    <main
      className="flex-1 overflow-y-auto"
      style={{ backgroundColor: BRAND_BG, height: 'calc(100vh - 80px)', marginTop: '80px' }}
    >
      <div className="flex-1 p-6 space-y-6 max-w-full">
        {/* Tabs */}
        <div className="border-b border-gray-200">
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
              {!hideMyProjectsToggle && (
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
              {headerActions}
            </div>
          </div>
        </div>

        {/* Projects Table */}
        <div className="bg-white shadow-sm border border-gray-200 rounded-lg overflow-hidden">
          {isLoadingCurrentTab ? (
            <div className="p-12 text-center">
              <div className="mx-auto mb-4 h-10 w-10 animate-spin rounded-full border-4 border-gray-200" style={{ borderTopColor: BRAND_ORANGE }}></div>
              <p className="text-sm text-gray-500">Loading projects...</p>
            </div>
          ) : displayProjects.length === 0 ? (
            <div className="p-12 text-center">
              <DocumentTextIcon className="mx-auto mb-4 h-16 w-16 text-gray-300" />
              <h3 className="text-lg font-semibold text-gray-900">
                {activeTab === 'archived' ? emptyMessage.archived : emptyMessage.active}
              </h3>
              <p className="mt-2 text-gray-500">
                {activeTab === 'archived' ? emptyDescription.archived : emptyDescription.active}
              </p>
            </div>
          ) : renderProjectRow ? (
            // Custom render function
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-200">
                <thead className="bg-gray-50">
                  <tr>
                    {displayColumns.map((col, idx) => (
                      <th
                        key={idx}
                        className={`${col.className || 'px-6 py-3'} text-left text-xs font-medium text-gray-500 uppercase tracking-wider`}
                      >
                        {col.header}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-200">
                  {displayProjects.map((project, index) => renderProjectRow(project, index))}
                </tbody>
              </table>
            </div>
          ) : (
            // Default table rendering
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-200">
                <thead className="bg-gray-50">
                  <tr>
                    {displayColumns.map((col, idx) => (
                      <th
                        key={idx}
                        className={`${col.className || 'px-6 py-3'} text-left text-xs font-medium text-gray-500 uppercase tracking-wider`}
                      >
                        {col.header}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-200">
                  {displayProjects.map((project) => (
                    <tr
                      key={project.id}
                      className="hover:bg-gray-50 cursor-pointer transition-colors"
                      onClick={() => handleProjectClick(project)}
                    >
                      {displayColumns.map((col, idx) => (
                        <td key={idx} className={col.className || 'px-6 py-4 whitespace-nowrap'}>
                          {col.accessor(project)}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </main>
  );
}

