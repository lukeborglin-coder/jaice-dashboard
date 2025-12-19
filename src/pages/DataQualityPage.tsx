import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { useParams, useNavigate, useLocation } from 'react-router-dom';
import { ArrowLeftIcon, TrashIcon } from '@heroicons/react/24/outline';
import { IconDatabaseExclamation } from '@tabler/icons-react';
import { useAuth } from '../contexts/AuthContext';
import { API_BASE_URL } from '../config';
import { useQuestionnaire } from '../hooks/useQuestionnaire';
import { useRawDataViewer } from '../hooks/useRawDataViewer';
import { useDataMapping } from '../hooks/useDataMapping';
import { DataQualityV2DataTab, type DataQualityV2UploadHandle } from '../components/dataQualityV2/DataQualityV2DataTab';

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
  const [showProjectLoading, setShowProjectLoading] = useState(false);
  const [showDataView, setShowDataView] = useState(false);
  const [showFileListLoading, setShowFileListLoading] = useState(false);
  const [fileInfo, setFileInfo] = useState<{ fileName: string; uploadedAt: string; respondentCount?: number } | null>(null);
  const [dataFileCounts, setDataFileCounts] = useState<Record<string, number>>({});
  const [pendingUploadStart, setPendingUploadStart] = useState(false);
  const dataTabRef = useRef<DataQualityV2UploadHandle | null>(null);
  const [projectLoadingMinDone, setProjectLoadingMinDone] = useState(false);
  const [projectLoadingDataReady, setProjectLoadingDataReady] = useState(false);
  const projectLoadingTimerRef = useRef<number | null>(null);
  const fileListTimerRef = useRef<number | null>(null);

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

  // Load archived projects (mirror Tabs behavior)
  useEffect(() => {
    const loadArchived = async () => {
      if (!user?.id) return;
      const token = localStorage.getItem('cognitive_dash_token');
      try {
        // Primary: same endpoint used by Tabs
        const resp = await fetch(`${API_BASE_URL}/api/projects/archived?userId=${user.id}`, {
          headers: { 'Authorization': `Bearer ${token}` },
        });
        if (resp.ok) {
          const data = await resp.json();
          const archived = Array.isArray(data?.projects) ? data.projects : [];
          setArchivedProjects(archived);
          return;
        }
      } catch (err) {
        console.error('Error loading archived projects (primary)', err);
      }

      // Fallback to legacy shape
      try {
        const response = await fetch(`${API_BASE_URL}/api/projects`, {
          headers: { 'Authorization': `Bearer ${token}` }
        });
        if (response.ok) {
          const allProjects = await response.json();
          const archived = allProjects[`${user?.id}_archived`] || [];
          setArchivedProjects(archived);
        }
      } catch (error) {
        console.error('Error loading archived projects (fallback)', error);
      }
    };
    loadArchived();
  }, [user?.id]);

  const startProjectLoadingOverlay = useCallback(() => {
    if (projectLoadingTimerRef.current) {
      clearTimeout(projectLoadingTimerRef.current);
    }
    console.debug('[DQ] Start project loading overlay (3s)');
    setShowProjectLoading(true);
    setProjectLoadingMinDone(false);
    setProjectLoadingDataReady(false);
    projectLoadingTimerRef.current = window.setTimeout(() => {
      console.debug('[DQ] Auto-hide project loading overlay after 3s');
      setProjectLoadingMinDone(true);
      projectLoadingTimerRef.current = null;
    }, 3000);
  }, []);

  const startFileListLoading = useCallback(() => {
    if (fileListTimerRef.current) {
      clearTimeout(fileListTimerRef.current);
    }
    setShowFileListLoading(true);
    fileListTimerRef.current = window.setTimeout(() => {
      setShowFileListLoading(false);
      fileListTimerRef.current = null;
    }, 1000);
  }, []);

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

  const lastNavigatedProjectRef = useRef<string | null>(null);
  const lastDatamapReadyKeyRef = useRef<string | null>(null);
  const lastDatamapPreloadKeyRef = useRef<string | null>(null);

  const computeRespondentCount = useCallback((raw: any) => {
    const normalizeHeaderKey = (value: unknown) => String(value || '').toLowerCase().trim().replace(/[^a-z0-9]/g, '');
    try {
      const rows = Array.isArray(raw?.rows) ? raw.rows : [];
      if (rows.length === 0) return 0;
      const columns = Array.isArray(raw?.columns) ? raw.columns : [];

      const recordIdx = columns.findIndex((c) => normalizeHeaderKey(c) === 'record');
      const fallbackIdx = columns.length > 0 ? 0 : -1;

      return rows.reduce((count: number, row: any) => {
        let val: any = undefined;
        if (Array.isArray(row)) {
          const idx = recordIdx >= 0 ? recordIdx : fallbackIdx;
          if (idx >= 0) val = row[idx];
        } else if (row && typeof row === 'object') {
          const source = (row.columns && typeof row.columns === 'object') ? row.columns : row;
          const key =
            (Array.isArray(columns) && columns.length > 0
              ? columns.find((c) => normalizeHeaderKey(c) === 'record')
              : null) ||
            Object.keys(source)[0];
          if (key && Object.prototype.hasOwnProperty.call(source, key)) {
            val = (source as any)[key];
          }
        }
        const text = val === null || val === undefined ? '' : String(val).trim();
        return text.length > 0 ? count + 1 : count;
      }, 0);
    } catch {
      return 0;
    }
  }, []);

  // Handle project selection from URL
  useEffect(() => {
    if (projectId && projects.length > 0) {
      const allProjects = [...projects, ...archivedProjects];
      const targetProject = allProjects.find(p => p.id === projectId);
      if (targetProject) {
        if (lastNavigatedProjectRef.current === targetProject.id && selectedProject?.id === targetProject.id && viewMode === 'project') {
          return;
        }
        lastNavigatedProjectRef.current = targetProject.id;
        setSelectedProject(targetProject);
        setViewMode('project');
        setShowDataView(false);
        startFileListLoading();
        console.debug('[DQ] Navigated via URL param to project', targetProject.id);
        if (targetProject.archived) setActiveTab('archived');
        else setActiveTab('active');
      }
    }
  }, [projectId, projects, archivedProjects, startFileListLoading]);

  // Load questionnaires when a project is selected
  useEffect(() => {
    if (selectedProject && viewMode === 'project') {
      console.debug('[DQ] loadQuestionnaires for project', selectedProject.id);
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

  const fetchFileInfo = useCallback(async () => {
    if (!selectedQuestionnaire?.id || viewMode !== 'project') return;
    try {
      const response = await fetch(`${API_BASE_URL}/api/questionnaire/data-file-info/${selectedQuestionnaire.id}`, {
        headers: { 'Authorization': `Bearer ${localStorage.getItem('cognitive_dash_token')}` }
      });
      if (response.ok) {
        const data = await response.json();
        if (data?.fileName || data?.originalFileName) {
          const uploadedAt = data.uploadedAt || new Date().toISOString();
          const parsedRespondentCount = [data.respondentCount, data.rowCount]
            .map((v) => Number(v))
            .find((n) => Number.isFinite(n) && n >= 0);
          const info = {
            fileName: data.originalFileName || data.fileName,
            uploadedAt,
            respondentCount: parsedRespondentCount ?? undefined,
          };
          setFileInfo(info);
          if (selectedProject?.id) {
            const count = Number.isFinite(data?.fileCount) ? data.fileCount : 1;
            setDataFileCounts((prev) => ({ ...prev, [selectedProject.id]: count }));
          }
          return;
        }
      }
      setFileInfo(null);
      if (selectedProject?.id) {
        setDataFileCounts((prev) => ({ ...prev, [selectedProject.id]: 0 }));
      }
    } catch (error) {
      console.error('Error loading data file info', error);
      setFileInfo(null);
      if (selectedProject?.id) {
        setDataFileCounts((prev) => ({ ...prev, [selectedProject.id]: 0 }));
      }
    }
  }, [selectedQuestionnaire?.id, viewMode, selectedProject?.id]);

  // Load existing data file info for the DQ dataset
  useEffect(() => {
    fetchFileInfo();
  }, [fetchFileInfo]);

  // Sync respondent count from loaded raw data (first column non-empty, excluding header)
  useEffect(() => {
    if (!fileInfo) return;
    const count = computeRespondentCount(fullRawData);
    if (typeof count !== 'number' || Number.isNaN(count) || count < 0) return;
    if (fileInfo.respondentCount === count) return;
    setFileInfo((prev) => prev ? { ...prev, respondentCount: count } : prev);
  }, [fullRawData, computeRespondentCount, fileInfo?.respondentCount]);

  // If we have a file but no respondent count yet, load raw data once to compute it
  useEffect(() => {
    if (!fileInfo) return;
    if (fileInfo.respondentCount !== undefined) return;
    if (loadingFullRawData || fullRawData) return;
    if (!selectedQuestionnaire) return;
    loadFullRawData(true);
  }, [fileInfo?.respondentCount, fileInfo, loadingFullRawData, fullRawData, selectedQuestionnaire, loadFullRawData]);

  // Auto-trigger upload picker when requested (for Add Data File from list view)
  useEffect(() => {
    if (pendingUploadStart && dataTabRef.current && typeof dataTabRef.current.openUploadPicker === 'function') {
      console.debug('[DQ] Triggering hidden data tab upload picker');
      dataTabRef.current.openUploadPicker();
      setPendingUploadStart(false);
      setShowProjectLoading(false);
      setProjectLoadingMinDone(true);
      setProjectLoadingDataReady(true);
    }
  }, [pendingUploadStart]);

  const handleViewDataFile = useCallback(() => {
    if (!selectedProject || !fileInfo) return;
    console.debug('[DQ] Opening data file view for project', selectedProject.id);
    setShowDataView(true);
    setDatamapData(null);
    setFullRawData(null);
    setProjectLoadingDataReady(false);
    setProjectLoadingMinDone(false);
    startProjectLoadingOverlay();
  }, [selectedProject, fileInfo, startProjectLoadingOverlay, setDatamapData, setFullRawData]);

  const handleAddDataFile = useCallback((projectId: string) => {
    console.debug('[DQ] Add data file clicked', projectId);
    if ((dataFileCounts[projectId] || 0) >= 10) {
      alert('You have reached the limit of 10 data files for this project. Please delete an existing file before uploading a new one.');
      return;
    }
    setPendingUploadStart(true);
    setShowProjectLoading(false);
    setProjectLoadingMinDone(true);
    setProjectLoadingDataReady(true);
  }, [dataFileCounts]);

  const triggerUploadFromList = useCallback(() => {
    console.debug('[DQ] triggerUploadFromList fired');
    setPendingUploadStart(true);
    setShowProjectLoading(false);
    setProjectLoadingMinDone(true);
    setProjectLoadingDataReady(true);
  }, []);

  const handleProjectClick = useCallback((project: any) => {
    setSelectedProject(project);
    setViewMode('project');
    setShowDataView(false);
    setDatamapData(null); // clear stale datamap so we always preload for the new project
    setFullRawData(null);
    setPendingUploadStart(false);
    setProjectLoadingDataReady(false);
    setProjectLoadingMinDone(false);
    setShowProjectLoading(false);
    startFileListLoading();
    console.debug('[DQ] Clicked project, showing file list first', project.id);
    navigate(`/data-quality/${project.id}`);
    if (onNavigateToProject) {
      onNavigateToProject(project);
    }
  }, [navigate, onNavigateToProject, setDatamapData, setFullRawData, startFileListLoading]);

  const handleBackToProjects = useCallback(() => {
    setViewMode('home');
    setSelectedProject(null);
    setSelectedQuestionnaire(null);
    setDatamapData(null);
    setFullRawData(null);
    setShowDataView(false);
    setFileInfo(null);
    navigate('/data-quality');
  }, [navigate, setDatamapData, setFullRawData, setSelectedQuestionnaire]);

  const handleBackToFileList = useCallback(() => {
    console.debug('[DQ] Back to file list clicked');
    setShowDataView(false);
    setProjectLoadingMinDone(false);
    setProjectLoadingDataReady(false);
    setShowProjectLoading(false);
    setPendingUploadStart(false);
  }, []);

  const handleDeleteDataFile = useCallback(async () => {
    if (!selectedQuestionnaire) return;
    if (!confirm('Delete this data file permanently? You will need to upload a new file.')) return;
    try {
      const resp = await fetch(`${API_BASE_URL}/api/questionnaire/delete-data-file/${selectedQuestionnaire.id}`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${localStorage.getItem('cognitive_dash_token')}` }
      });
      if (resp.ok) {
        setFileInfo(null);
        setDatamapData(null);
        setFullRawData(null);
        setShowDataView(false);
        if (selectedProject?.id) {
          setDataFileCounts((prev) => ({ ...prev, [selectedProject.id]: 0 }));
        }
        return;
      }
      const err = await resp.json().catch(() => ({}));
      alert(`Failed to delete data file: ${err.error || 'Unknown error'}`);
    } catch (error: any) {
      console.error('Error deleting data file', error);
      alert(`Failed to delete data file: ${error?.message || 'Unknown error'}`);
    }
  }, [selectedQuestionnaire, selectedProject?.id]);

  useEffect(() => {
    return () => {
      if (projectLoadingTimerRef.current) {
        clearTimeout(projectLoadingTimerRef.current);
        projectLoadingTimerRef.current = null;
      }
      if (fileListTimerRef.current) {
        clearTimeout(fileListTimerRef.current);
        fileListTimerRef.current = null;
      }
    };
  }, []);

  // Preload datamap while the loading overlay is showing (so Data Map is ready when the spinner clears)
  useEffect(() => {
    if (viewMode !== 'project') return;
    if (!showDataView) return;
    if (!fileInfo) return;
    if (!selectedQuestionnaire) return;
    if (loadingDatamap) return;
    if (datamapData) return;
    if (lastDatamapPreloadKeyRef.current === selectedQuestionnaire.id) return;
    lastDatamapPreloadKeyRef.current = selectedQuestionnaire.id;
    console.debug('[DQ] Preloading datamap during overlay', {
      projectId: selectedProject?.id,
      questionnaireId: selectedQuestionnaire?.id,
    });
    console.debug('[DQ] Calling loadDatamap(true)');
    loadDatamap(true);
  }, [viewMode, showDataView, selectedQuestionnaire?.id, loadingDatamap, datamapData, loadDatamap]);

  // Track when datamap is actually ready
  useEffect(() => {
    if (loadingDatamap) return;
    if (datamapData && showDataView) {
      const key = `${selectedProject?.id || 'none'}-${selectedQuestionnaire?.id || 'none'}-${Array.isArray(datamapData?.parsedQuestions) ? datamapData.parsedQuestions.length : 'na'}`;
      if (lastDatamapReadyKeyRef.current !== key) {
        lastDatamapReadyKeyRef.current = key;
        console.debug('[DQ] Datamap loaded', {
          projectId: selectedProject?.id,
          questionnaireId: selectedQuestionnaire?.id,
          questions: Array.isArray(datamapData?.parsedQuestions) ? datamapData.parsedQuestions.length : 0,
        });
        setProjectLoadingDataReady(true);
      }
    }
  }, [datamapData, loadingDatamap, selectedProject?.id, selectedQuestionnaire?.id, showDataView]);

  // Hide overlay only after min duration and data readiness
  useEffect(() => {
    if (showProjectLoading && projectLoadingMinDone && projectLoadingDataReady) {
      console.debug('[DQ] Hiding project overlay (min time met + data ready)');
      setShowProjectLoading(false);
    }
  }, [showProjectLoading, projectLoadingMinDone, projectLoadingDataReady]);

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
                      Data Files
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
                      </td>
                      <td className="px-6 py-4">
              <div className="text-sm text-gray-900">{project.client || '-'}</div>
                      </td>
                      <td className="px-6 py-4 text-center">
                        <div className="text-sm text-gray-900">{dataFileCounts[project.id] ?? project.dataFileCount ?? 0}</div>
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
    <div className="flex-1 p-6 space-y-6 max-w-full overflow-y-auto overflow-x-hidden" style={{ height: 'calc(100vh - 80px)', marginTop: '80px' }}>
      {!showDataView ? (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <button
              onClick={handleBackToProjects}
              className="flex items-center gap-2 text-sm text-gray-600 hover:text-gray-800 hover:bg-gray-100 px-3 py-1 rounded-lg transition-colors"
            >
              <ArrowLeftIcon className="h-4 w-4" />
              Back to Projects
            </button>
            <div>
              {fileInfo && (dataFileCounts[selectedProject.id] ?? 0) < 10 && (
                <button
                  onClick={() => handleAddDataFile(selectedProject.id)}
                  className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-white rounded-md hover:opacity-90"
                  style={{ backgroundColor: BRAND_ORANGE }}
                >
                  Add Data File
                </button>
              )}
            </div>
          </div>

          {showFileListLoading ? (
            <div className="p-12 text-center bg-white border border-gray-200 rounded-lg">
              <div className="mx-auto mb-4 h-12 w-12 animate-spin rounded-full border-4 border-gray-200 border-t-[#D14A2D]"></div>
              <p className="text-sm text-gray-600">Loading data files...</p>
            </div>
          ) : fileInfo ? (
            <div className="border border-gray-200 rounded-lg overflow-hidden">
              <table className="min-w-full divide-y divide-gray-200">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">File Name</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Uploaded</th>
                    <th className="px-6 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider">Respondents</th>
                    <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider"></th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-200">
                  <tr
                    className="hover:bg-gray-50 cursor-pointer transition-colors"
                    onClick={() => handleViewDataFile()}
                  >
                    <td className="px-6 py-4 text-sm text-gray-900">{fileInfo.fileName}</td>
                    <td className="px-6 py-4 text-sm text-gray-500">
                      {new Date(fileInfo.uploadedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} · {new Date(fileInfo.uploadedAt).toLocaleDateString()}
                    </td>
                    <td className="px-6 py-4 text-sm text-center text-gray-900">
                      {fileInfo.respondentCount ?? '—'}
                    </td>
                    <td className="px-6 py-4 text-right">
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          handleDeleteDataFile();
                        }}
                        className="inline-flex items-center justify-center p-2 text-red-600 hover:text-red-700 hover:bg-red-50 rounded-full transition-colors"
                        title="Delete data file"
                      >
                        <TrashIcon className="h-5 w-5" />
                      </button>
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          ) : (
            <div className="border border-dashed border-gray-300 rounded-lg p-8 text-center bg-white">
              <h4 className="text-md font-semibold text-gray-900 mb-2">No data files uploaded</h4>
              <p className="text-sm text-gray-600 mb-4">Upload a data file to start data quality checks.</p>
              <button
                onClick={() => triggerUploadFromList()}
                className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-white rounded-md hover:opacity-90"
                style={{ backgroundColor: BRAND_ORANGE }}
              >
                Upload Data File
              </button>
            </div>
          )}
        </div>
      ) : (
        <> 
          {showProjectLoading ? (
            <div className="flex flex-col items-center justify-center py-16">
              <div className="mb-4 h-12 w-12 animate-spin rounded-full border-4 border-gray-200 border-t-[#D14A2D]"></div>
              <p className="text-sm text-gray-600">Loading data quality workspace...</p>
            </div>
          ) : !selectedQuestionnaire || creatingDataset ? (
            <div className="flex flex-col items-center justify-center py-16">
              <div className="mb-4 h-12 w-12 animate-spin rounded-full border-4 border-gray-200 border-t-[#D14A2D]"></div>
              <p className="text-sm text-gray-600">Loading data quality workspace...</p>
            </div>
          ) : (
            <DataQualityV2DataTab
              selectedProject={selectedProject}
              selectedQuestionnaire={selectedQuestionnaire}
              onBackToFiles={handleBackToFileList}
              showBackButton={!showProjectLoading && !creatingDataset}
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
                console.debug('[DQ-UPLOAD] onDataUploaded (from DataTab) start');
                setFullRawData(null);
                setShowDataView(true);
                startProjectLoadingOverlay();
                console.debug('[DQ-UPLOAD] fetchFileInfo after upload start');
                await fetchFileInfo();
                // Keep the upload spinner until both are done.
                console.debug('[DQ-UPLOAD] Loading raw data + datamap');
                await Promise.all([
                  loadFullRawData(true),
                  loadDatamap(true),
                ]);
                console.debug('[DQ-UPLOAD] onDataUploaded complete (raw data + datamap kicked off)');
              }}
              onEnsureRawData={(force?: boolean) => {
                loadFullRawData(!!force);
              }}
              onDataDeleted={() => {
                setFullRawData(null);
                setDatamapData(null);
                setFileInfo(null);
              }}
              onLoadDatamap={loadDatamap}
              onClearDatamap={() => setDatamapData(null)}
              hideUploadBox={!!fileInfo}
              initialUploadedFileInfo={fileInfo ? { fileName: fileInfo.fileName, uploadedAt: fileInfo.uploadedAt } : null}
              ref={dataTabRef}
            />
          )}
        </>
      )}

      {/* Hidden data tab to power the upload picker when no file exists */}
      {!showDataView && (
        <div style={{ position: 'absolute', width: 0, height: 0, overflow: 'hidden', opacity: 0 }}>
          <DataQualityV2DataTab
            ref={dataTabRef}
            hideUploadBox
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
              setShowDataView(true);
              startProjectLoadingOverlay();
              await fetchFileInfo();
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
              setFileInfo(null);
            }}
            onLoadDatamap={loadDatamap}
            onClearDatamap={() => setDatamapData(null)}
          />
        </div>
      )}
    </div>
  );
}
