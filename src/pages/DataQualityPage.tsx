import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { useParams, useNavigate, useLocation } from 'react-router-dom';
import { ArrowLeftIcon } from '@heroicons/react/24/outline';
import { IconDatabaseExclamation } from '@tabler/icons-react';
import { useAuth } from '../contexts/AuthContext';
import { useDataQuality } from '../hooks/useDataQuality';
import QualityPlanTab from '../components/dataQuality/QualityPlanTab';
import DataUploadTab from '../components/dataQuality/DataUploadTab';
import QAResultsTab from '../components/dataQuality/QAResultsTab';
import { API_BASE_URL } from '../config';

const BRAND_ORANGE = '#D14A2D';

type TabType = 'plan' | 'upload' | 'results';

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
  const [activeTabType, setActiveTabType] = useState<TabType>('plan');

  // Extract projectId from URL if provided
  const projectId = urlProjectId || (location.pathname.match(/\/data-quality\/([^\/]+)/)?.[1]);

  const {
    qualityPlan,
    loadingPlan,
    qaData,
    loadingData,
    qaResults,
    loadingResults,
    resultsSummary,
    loadQualityPlan,
    saveQualityPlan,
    loadQAData,
    uploadQAData,
    loadQAResults,
    runQA,
    updateQAResult
  } = useDataQuality({ projectId: projectId || null });

  // Filter to only quantitative projects
  const isQuantitative = useCallback((project: any) => {
    const methodology = project?.methodologyType?.toLowerCase();
    if (!methodology) {
      return false;
    }
    return methodology.includes('quant') ||
           methodology === 'quantitative' ||
           methodology === 'quant';
  }, []);

  const quantActiveProjects = useMemo(
    () => projects.filter(isQuantitative),
    [projects, isQuantitative]
  );

  const quantArchivedProjects = useMemo(
    () => archivedProjects.filter(isQuantitative),
    [archivedProjects, isQuantitative]
  );

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

  const filteredActiveProjects = useMemo(
    () => filterProjectsByUser(quantActiveProjects),
    [filterProjectsByUser, quantActiveProjects]
  );

  const filteredArchivedProjects = useMemo(
    () => filterProjectsByUser(quantArchivedProjects),
    [filterProjectsByUser, quantArchivedProjects]
  );

  const displayProjects = activeTab === 'active' ? filteredActiveProjects : filteredArchivedProjects;

  // Load archived projects
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

  // Handle project selection from URL
  useEffect(() => {
    if (projectId && projects.length > 0) {
      const allProjects = [...projects, ...archivedProjects];
      const targetProject = allProjects.find(p => p.id === projectId);
      if (targetProject) {
        setSelectedProject(targetProject);
        setViewMode('project');
        if (targetProject.archived) {
          setActiveTab('archived');
        } else {
          setActiveTab('active');
        }
      }
    }
  }, [projectId, projects, archivedProjects]);

  // Load initial data when project is selected
  useEffect(() => {
    if (selectedProject && viewMode === 'project') {
      loadQualityPlan();
      loadQAData(1, 50);
      loadQAResults();
    }
  }, [selectedProject, viewMode, loadQualityPlan, loadQAData, loadQAResults]);

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
    navigate('/data-quality');
  }, [navigate]);

  // Home view - Project list
  if (viewMode === 'home' || !selectedProject) {
    return (
      <div className="flex-1 p-6 space-y-4 max-w-full overflow-y-auto overflow-x-hidden" style={{ height: 'calc(100vh - 80px)', marginTop: '80px' }}>
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

  // Project view - Data Quality tabs
  const tabs = [
    { id: 'plan' as TabType, label: 'Quality Plan' },
    { id: 'upload' as TabType, label: 'Data Upload' },
    { id: 'results' as TabType, label: 'QA Results' }
  ];

  return (
    <div className="flex-1 p-6 space-y-4 max-w-full overflow-y-auto overflow-x-hidden" style={{ height: 'calc(100vh - 80px)', marginTop: '80px' }}>
      {/* Project Header */}
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
            <div></div> {/* Spacer for centering */}
          </div>
        </div>

        {/* Tabs */}
        <div className="px-6 border-b border-gray-200">
          <div className="flex space-x-1">
            {tabs.map((tab) => (
              <button
                key={tab.id}
                onClick={() => setActiveTabType(tab.id)}
                className={`px-4 py-3 text-sm font-medium border-b-2 transition-colors ${
                  activeTabType === tab.id
                    ? 'border-orange-500 text-orange-600'
                    : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>
        </div>

        {/* Tab Content */}
        <div className="p-6">
          {activeTabType === 'plan' && (
            <QualityPlanTab
              projectId={selectedProject.id}
              qualityPlan={qualityPlan}
              loadingPlan={loadingPlan}
              onSavePlan={saveQualityPlan}
              onLoadPlan={loadQualityPlan}
            />
          )}
          {activeTabType === 'upload' && (
            <DataUploadTab
              projectId={selectedProject.id}
              qaData={qaData}
              loadingData={loadingData}
              onUpload={uploadQAData}
              onLoadData={loadQAData}
            />
          )}
          {activeTabType === 'results' && (
            <QAResultsTab
              projectId={selectedProject.id}
              qaResults={qaResults}
              loadingResults={loadingResults}
              resultsSummary={resultsSummary}
              onRunQA={runQA}
              onUpdateResult={updateQAResult}
              onLoadResults={loadQAResults}
            />
          )}
        </div>
      </div>
    </div>
  );
}
