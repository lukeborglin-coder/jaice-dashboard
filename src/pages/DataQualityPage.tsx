import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { useParams, useNavigate, useLocation } from 'react-router-dom';
import { ArrowLeftIcon } from '@heroicons/react/24/outline';
import { IconDatabaseExclamation } from '@tabler/icons-react';
import { useAuth } from '../contexts/AuthContext';
import { API_BASE_URL } from '../config';
import { useQuestionnaire } from '../hooks/useQuestionnaire';
import { useRawDataViewer } from '../hooks/useRawDataViewer';
import { useDataMapping } from '../hooks/useDataMapping';
import { DataQualityV2DataTab } from '../components/dataQualityV2/DataQualityV2DataTab';

const BRAND_ORANGE = '#D14A2D';

interface DataQualityPageProps {
  projects?: any[];
  onNavigateToProject?: (project: any) => void;
}

export default function DataQualityPage({ projects = [], onNavigateToProject }: DataQualityPageProps) {
  const { user } = useAuth();
  const { projectId: urlProjectId } = useParams<{ projectId?: string }>();
  const location = useLocation();
  const navigate = useNavigate();
  const [viewMode, setViewMode] = useState<'home' | 'project'>('home');
  const [activeTab, setActiveTab] = useState<'active' | 'archived'>('active');
  const [showMyProjectsOnly, setShowMyProjectsOnly] = useState(true);
  const [selectedProject, setSelectedProject] = useState<any | null>(null);
  const [archivedProjects, setArchivedProjects] = useState<any[]>([]);
  const [creatingDataset, setCreatingDataset] = useState(false);

  // Extract projectId from URL if provided
  const projectId = urlProjectId || (location.pathname.match(/\/data-quality\/([^\/]+)/)?.[1]);

  // Filter to only quantitative projects
  const isQuantitative = useCallback((project: any) => {
    const methodology = project?.methodologyType?.toLowerCase();
    if (!methodology) return false;
    return methodology.includes('quant') || methodology === 'quantitative' || methodology === 'quant';
  }, []);

  const quantActiveProjects = useMemo(() => projects.filter(isQuantitative), [projects, isQuantitative]);
  const quantArchivedProjects = useMemo(() => archivedProjects.filter(isQuantitative), [archivedProjects, isQuantitative]);

  const filterProjectsByUser = useCallback((list: any[]) => {
    if (!showMyProjectsOnly || !user) return list;
    const uid = String((user as any)?.id || '').toLowerCase();
    const uemail = String((user as any)?.email || '').toLowerCase();
    const uname = String((user as any)?.name || '').toLowerCase();
    return list.filter(project => {
      const createdBy = String((project as any)?.createdBy || '').toLowerCase();
      const createdByMe = !!createdBy && (createdBy === uid || createdBy === uemail);
      const teamMembers = Array.isArray((project as any)?.teamMembers) ? (project as any).teamMembers : [];
      const inTeam = teamMembers.some((member: any) => {
        const mid = String(member?.id || '').toLowerCase();
        const memail = String(member?.email || '').toLowerCase();
        const mname = String(member?.name || '').toLowerCase();
        return (uid && mid === uid) || (uemail && memail === uemail) || (uname && mname === uname);
      });
      return createdByMe || inTeam;
    });
  }, [showMyProjectsOnly, user]);

  const filteredActiveProjects = useMemo(() => filterProjectsByUser(quantActiveProjects), [filterProjectsByUser, quantActiveProjects]);
  const filteredArchivedProjects = useMemo(() => filterProjectsByUser(quantArchivedProjects), [filterProjectsByUser, quantArchivedProjects]);
  const displayProjects = activeTab === 'active' ? filteredActiveProjects : filteredArchivedProjects;

  // Load archived projects (mirrors DataQualityPage)
  useEffect(() => {
    const loadArchived = async () => {
      try {
        const token = localStorage.getItem('cognitive_dash_token');
        const response = await fetch(`${API_BASE_URL}/api/projects`, {
          headers: { 'Authorization': `Bearer ${token}` }
        });
        if (response.ok) {
          const allProjects = await response.json();
          const archived = allProjects[`${user?.id}_archived`] || [];
          setArchivedProjects(archived);
        }
      } catch (error) {
        console.error('Error loading archived projects:', error);
      }
    };
    if (user?.id) {
      loadArchived();
    }
  }, [user?.id]);

  // Questionnaire container for DQ v2 (created on demand)
  const questionnaireHook = useQuestionnaire({ selectedProject });
  const {
    questionnaires,
    selectedQuestionnaire,
    loadQuestionnaires,
    setSelectedQuestionnaire,
  } = questionnaireHook;

  const rawDataHook = useRawDataViewer({ selectedQuestionnaire });
  const {
    fullRawData,
    loadingFullRawData,
    rawDataPage,
    rawDataRowsPerPage,
    rawDataColumnStart,
    rawDataColumnsPerPage,
    loadFullRawData,
    setFullRawData,
    setRawDataPage,
    setRawDataColumnStart,
  } = rawDataHook;

  const dataMappingHook = useDataMapping({ selectedQuestionnaire });
  const {
    datamapData,
    loadingDatamap,
    loadDatamap,
    setDatamapData,
  } = dataMappingHook;

  // Handle project selection from URL
  useEffect(() => {
    if (projectId && projects.length > 0) {
      const allProjects = [...projects, ...archivedProjects];
      const targetProject = allProjects.find(p => p.id === projectId);
      if (targetProject) {
        setSelectedProject(targetProject);
        setViewMode('project');
        if (targetProject.archived) setActiveTab('archived');
        else setActiveTab('active');
      }
    }
  }, [projectId, projects, archivedProjects]);

  // Load questionnaires when a project is selected
  useEffect(() => {
    if (selectedProject && viewMode === 'project') {
      loadQuestionnaires(selectedProject.id);
    }
  }, [selectedProject, viewMode, loadQuestionnaires]);

  // Ensure there is a dedicated DQ v2 “dataset questionnaire” for this project
  useEffect(() => {
    if (!selectedProject || viewMode !== 'project') return;
    if (!Array.isArray(questionnaires)) return;
    if (creatingDataset) return;

    // If already selected and is the dqv2 container, keep it
    if (selectedQuestionnaire && (selectedQuestionnaire as any).isDataQualityV2) {
      return;
    }

    const existing = questionnaires.find((q: any) => q?.isDataQualityV2 === true);
    if (existing) {
      setSelectedQuestionnaire(existing);
      return;
    }

    const create = async () => {
      setCreatingDataset(true);
      try {
        const resp = await fetch(`${API_BASE_URL}/api/questionnaire/create-empty`, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${localStorage.getItem('cognitive_dash_token')}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            projectId: selectedProject.id,
            name: 'Data Quality Dataset',
          }),
        });
        if (resp.ok) {
          const created = await resp.json();
          await loadQuestionnaires(selectedProject.id);
          setSelectedQuestionnaire(created);
        } else {
          const err = await resp.json().catch(() => ({}));
          console.error('Failed to create DQ v2 dataset questionnaire', err);
        }
      } catch (e) {
        console.error('Error creating DQ v2 dataset questionnaire', e);
      } finally {
        setCreatingDataset(false);
      }
    };

    void create();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [questionnaires, selectedProject, viewMode]);

  const handleProjectClick = useCallback((project: any) => {
    setSelectedProject(project);
    setViewMode('project');
    navigate(`/data-quality/${project.id}`);
    if (onNavigateToProject) {
      onNavigateToProject(project);
    }
  }, [navigate, onNavigateToProject]);

  const handleBackToProjects = useCallback(() => {
    setViewMode('home');
    setSelectedProject(null);
    setSelectedQuestionnaire(null);
    setDatamapData(null);
    setFullRawData(null);
    navigate('/data-quality');
  }, [navigate, setDatamapData, setFullRawData, setSelectedQuestionnaire]);

  // Home view - Project list
  if (viewMode === 'home' || !selectedProject) {
    return (
      <div className="flex-1 p-6 space-y-4 max-w-full overflow-y-auto overflow-x-hidden" style={{ height: 'calc(100vh - 80px)', marginTop: '80px' }}>
        <div>
          <div className="flex items-center justify-between">
            <nav className="-mb-px flex space-x-8 items-center">
              <button
                onClick={() => setActiveTab('active')}
                className={`py-2 px-1 border-b-2 font-medium text-sm ${activeTab === 'active'
                  ? 'text-white'
                  : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                }`}
                style={activeTab === 'active' ? { borderBottomColor: BRAND_ORANGE, color: BRAND_ORANGE } : {}}
              >
                Active Projects ({filteredActiveProjects.length})
              </button>
              <button
                onClick={() => setActiveTab('archived')}
                className={`py-2 px-1 border-b-2 font-medium text-sm ${activeTab === 'archived'
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
                  className={`px-3 py-1 text-xs rounded-lg shadow-sm transition-colors ${showMyProjectsOnly
                    ? 'bg-white border border-gray-300 hover:bg-gray-50'
                    : 'text-white hover:opacity-90'
                  }`}
                  style={showMyProjectsOnly ? {} : { backgroundColor: BRAND_ORANGE }}
                >
                  {showMyProjectsOnly ? 'Only My Projects' : 'All Projects'}
                </button>
              )}
            </div>
          </div>
          <div className="border-b border-gray-200"></div>
        </div>

        <div className="bg-white shadow-sm border border-gray-200 rounded-lg overflow-hidden">
          {displayProjects.length === 0 ? (
            <div className="p-12 text-center">
              <IconDatabaseExclamation className="mx-auto mb-4 h-16 w-16 text-gray-300" />
              <h3 className="text-lg font-semibold text-gray-900">
                {activeTab === 'archived' ? 'No archived quantitative projects' : 'No active quantitative projects'}
              </h3>
              <p className="mt-2 text-gray-500">
                {activeTab === 'archived'
                  ? 'Archived quantitative projects will appear here.'
                  : 'Create a quantitative project to start managing data quality.'}
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-200">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Project
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Client
                    </th>
                    <th className="px-6 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Status
                    </th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-200">
                  {displayProjects.map(project => (
                    <tr
                      key={project.id}
                      className="hover:bg-gray-50 cursor-pointer transition-colors"
                      onClick={() => handleProjectClick(project)}
                    >
                      <td className="px-6 py-4">
                        <div className="text-sm font-medium text-gray-900">{project.name}</div>
                        <div className="text-xs text-gray-500 mt-1">
                          {project.methodologyType || 'Quantitative'}
                        </div>
                      </td>
                      <td className="px-6 py-4">
                        <div className="text-sm text-gray-900">{project.client || '-'}</div>
                      </td>
                      <td className="px-6 py-4 text-center">
                        <div className="flex items-center justify-center gap-1 text-sm text-gray-900">
                          <IconDatabaseExclamation className="h-4 w-4 text-gray-400" />
                          <span>Data Quality</span>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    );
  }

  // Project view - Data Map + Raw Data (questionnaire-backed)
  return (
    <div className="flex-1 p-6 space-y-4 max-w-full overflow-y-auto overflow-x-hidden" style={{ height: 'calc(100vh - 80px)', marginTop: '80px' }}>
      <div className="bg-white shadow-sm border border-gray-200 rounded-lg overflow-hidden">
        <div className="px-6 py-4 border-b border-gray-200 bg-gray-50">
          <div className="flex items-center justify-between">
            <button
              onClick={handleBackToProjects}
              className="flex items-center gap-2 text-sm text-gray-600 hover:text-gray-800 hover:bg-gray-100 px-3 py-1 rounded-lg transition-colors"
            >
              <ArrowLeftIcon className="h-4 w-4" />
              Back to Projects
            </button>
            <h2 className="text-xl font-semibold text-gray-900">{selectedProject.name}</h2>
            <div></div>
          </div>
        </div>

        <div className="p-6">
          {!selectedQuestionnaire || creatingDataset ? (
            <div className="border border-gray-200 rounded-lg overflow-hidden">
              <div className="p-8 text-center">
                <div className="mx-auto mb-4 h-12 w-12 animate-spin rounded-full border-4 border-gray-200 border-t-[#D14A2D]"></div>
                <p className="text-sm text-gray-700">Preparing dataset container…</p>
              </div>
            </div>
          ) : (
            <DataQualityV2DataTab
              selectedProject={selectedProject}
              selectedQuestionnaire={selectedQuestionnaire}
              fullRawData={fullRawData}
              loadingFullRawData={loadingFullRawData}
              rawDataPage={rawDataPage}
              rawDataRowsPerPage={rawDataRowsPerPage}
              rawDataColumnStart={rawDataColumnStart}
              rawDataColumnsPerPage={rawDataColumnsPerPage}
              onPageChange={setRawDataPage}
              onColumnChange={setRawDataColumnStart}
              datamapData={datamapData}
              loadingDatamap={loadingDatamap}
              onDataUploaded={async () => {
                setFullRawData(null);
                // Keep the upload spinner until both are done.
                await Promise.all([
                  loadFullRawData(true),
                  loadDatamap(true),
                ]);
              }}
              onEnsureRawData={(force?: boolean) => {
                loadFullRawData(!!force);
              }}
              onDataDeleted={() => {
                setFullRawData(null);
                setDatamapData(null);
              }}
              onLoadDatamap={loadDatamap}
              onClearDatamap={() => setDatamapData(null)}
            />
          )}
        </div>
      </div>
    </div>
  );
}


