import React, { useState, useEffect, useMemo, useCallback } from 'react';
import {
  DocumentArrowUpIcon,
  DocumentTextIcon,
  ArrowLeftIcon,
  PlusIcon,
  TrashIcon,
  XMarkIcon,
  CloudArrowUpIcon,
  EyeIcon,
  MagnifyingGlassIcon,
  ArrowPathIcon,
  PencilIcon,
  CheckIcon,
  InformationCircleIcon
} from '@heroicons/react/24/outline';
import { IconCheckbox } from '@tabler/icons-react';
import { API_BASE_URL } from '../config';
import { useAuth } from '../contexts/AuthContext';

const BRAND_ORANGE = '#D14A2D';
const BRAND_BG = '#F7F7F8';
const BRAND_GRAY = '#5D5F62';

interface Question {
  id: string;
  number: string;
  text: string;
  type: string;
  options: Array<string | { code: string; text: string; tags?: string[] }>;
  tags: string[];
  needsReview: boolean;
  logic?: string;
  showLogic?: string;
  statementOptions?: Array<{ code: string; text: string }>;
  responseOptions?: Array<{ code: string; text: string }>;
  terminateLogic?: string | object;
  validation?: object;
}

interface Questionnaire {
  id: string;
  name: string;
  questions: Question[];
  createdAt: string;
  projectId: string;
}

interface QNRProps {
  projects?: any[];
  onNavigateToProject?: (project: any) => void;
}

export default function QNR({ projects = [], onNavigateToProject }: QNRProps) {
  const { user } = useAuth();
  const [viewMode, setViewMode] = useState<'home' | 'project' | 'qnr'>('home');
  const [activeTab, setActiveTab] = useState<'active' | 'archived'>('active');
  const [showMyProjectsOnly, setShowMyProjectsOnly] = useState(true);
  const [selectedProject, setSelectedProject] = useState<any | null>(null);
  const [questionnaires, setQuestionnaires] = useState<Questionnaire[]>([]);
  const [selectedQuestionnaire, setSelectedQuestionnaire] = useState<Questionnaire | null>(null);
  const [loading, setLoading] = useState(false);
  const [archivedProjects, setArchivedProjects] = useState<any[]>([]);
  const [showUploadModal, setShowUploadModal] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadSuccess, setUploadSuccess] = useState(false);
  const [uploadedQuestionnaire, setUploadedQuestionnaire] = useState<Questionnaire | null>(null);
  const [questionnaireName, setQuestionnaireName] = useState('');
  const [allQuestionnaires, setAllQuestionnaires] = useState<Questionnaire[]>([]);
  const [selectedQuestionTypes, setSelectedQuestionTypes] = useState<Set<string>>(new Set());
  const [variableData, setVariableData] = useState<Record<string, any>>({});
  const fileInputRef = React.useRef<HTMLInputElement>(null);
  const pendingSyncRef = React.useRef<{ qnrId: string; projectId: string } | null>(null);

  // Load questionnaires for a project
  const loadQuestionnaires = useCallback(async (projectId: string) => {
    try {
      const response = await fetch(`${API_BASE_URL}/api/questionnaire/${projectId}`, {
        headers: { 'Authorization': `Bearer ${localStorage.getItem('cognitive_dash_token')}` }
      });
      if (response.ok) {
        const data = await response.json();
        setQuestionnaires(data || []);
      }
    } catch (error) {
      console.error('Error loading questionnaires:', error);
      setQuestionnaires([]);
    }
  }, []);

  // Load all questionnaires to get counts
  useEffect(() => {
    const loadAllQuestionnaires = async () => {
      try {
        const response = await fetch(`${API_BASE_URL}/api/questionnaire/all`, {
          headers: { 'Authorization': `Bearer ${localStorage.getItem('cognitive_dash_token')}` }
        });
        if (response.ok) {
          const data = await response.json();
          setAllQuestionnaires(data || []);
        }
      } catch (error) {
        console.error('Error loading all questionnaires:', error);
      }
    };
    loadAllQuestionnaires();
  }, []);

  // Get QNR count for a project
  const getQNRCount = useCallback((projectId: string) => {
    return allQuestionnaires.filter(q => q.projectId === projectId).length;
  }, [allQuestionnaires]);

  // Load archived projects
  useEffect(() => {
    const loadArchived = async () => {
      try {
        const response = await fetch(`${API_BASE_URL}/api/projects`, {
          headers: { 'Authorization': `Bearer ${localStorage.getItem('cognitive_dash_token')}` }
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
    loadArchived();
  }, [user?.id]);

  // Check for sync request from Tabs component
  useEffect(() => {
    const syncQnrId = sessionStorage.getItem('cognitive_dash_tabs_sync_qnr_id');
    const syncProjectId = sessionStorage.getItem('cognitive_dash_tabs_sync_project_id');
    
    if (syncQnrId && syncProjectId && projects.length > 0) {
      // Store in ref and clear sessionStorage
      pendingSyncRef.current = { qnrId: syncQnrId, projectId: syncProjectId };
      sessionStorage.removeItem('cognitive_dash_tabs_sync_qnr_id');
      sessionStorage.removeItem('cognitive_dash_tabs_sync_project_id');
      
      // Find the project
      const project = projects.find(p => p.id === syncProjectId);
      if (project) {
        setSelectedProject(project);
        setViewMode('project');
        // Load questionnaires for the project
        loadQuestionnaires(project.id);
      }
    }
  }, [projects, loadQuestionnaires]);

  // When questionnaires are loaded and we have a sync request, select the QNR
  useEffect(() => {
    if (pendingSyncRef.current && questionnaires.length > 0 && selectedProject) {
      const { qnrId } = pendingSyncRef.current;
      const targetQnr = questionnaires.find(q => q.id === qnrId);
      if (targetQnr) {
        setSelectedQuestionnaire(targetQnr);
        setViewMode('qnr');
        // Clear the sync ref
        pendingSyncRef.current = null;
      }
    }
  }, [questionnaires, selectedProject]);

  // Load variable data when a questionnaire is selected
  useEffect(() => {
    const loadVariableData = async () => {
      if (!selectedQuestionnaire) {
        setVariableData({});
        return;
      }
      try {
        const response = await fetch(`${API_BASE_URL}/api/questionnaire/processed-data/${selectedQuestionnaire.id}`, {
          headers: { 'Authorization': `Bearer ${localStorage.getItem('cognitive_dash_token')}` }
        });
        if (response.ok) {
          const data = await response.json();
          if (data && typeof data === 'object') {
            setVariableData(data);
          } else {
            setVariableData({});
          }
        } else {
          setVariableData({});
        }
      } catch (error) {
        console.error('Error loading variable data:', error);
        setVariableData({});
      }
    };
    loadVariableData();
  }, [selectedQuestionnaire]);

  // Filter for quantitative projects
  const isQuantitative = (project: any) => {
    const methodology = project?.methodologyType?.toLowerCase();
    if (!methodology) {
      return false;
    }
    
    return methodology.includes('quant') ||
           methodology.includes('survey') ||
           methodology.includes('quantitative') ||
           (!methodology.includes('qual') && 
            !methodology.includes('interview') && 
            !methodology.includes('focus group'));
  };

  const quantActiveProjects = useMemo(
    () => projects.filter(isQuantitative),
    [projects]
  );

  const quantArchivedProjects = useMemo(
    () => archivedProjects.filter(isQuantitative),
    [archivedProjects]
  );

  const filterProjectsByUser = useCallback(
    (list: any[]) => {
      if (!showMyProjectsOnly || !user) return list;

      const uid = String((user as any)?.id || '').toLowerCase();
      const uemail = String((user as any)?.email || '').toLowerCase();
      const uname = String((user as any)?.name || '').toLowerCase();

      return list.filter(project => {
        const createdBy = String((project as any)?.createdBy || '').toLowerCase();
        const createdByMe = !!createdBy && (createdBy === uid || createdBy === uemail);

        const teamMembers = Array.isArray((project as any)?.teamMembers)
          ? (project as any).teamMembers
          : [];

        const inTeam = teamMembers.some((member: any) => {
          const mid = String(member?.id || '').toLowerCase();
          const memail = String(member?.email || '').toLowerCase();
          const mname = String(member?.name || '').toLowerCase();
          return (uid && mid === uid) || (uemail && memail === uemail) || (uname && mname === uname);
        });

        return createdByMe || inTeam;
      });
    },
    [showMyProjectsOnly, user]
  );

  const filteredActiveProjects = useMemo(
    () => filterProjectsByUser(quantActiveProjects),
    [filterProjectsByUser, quantActiveProjects]
  );

  const filteredArchivedProjects = useMemo(
    () => filterProjectsByUser(quantArchivedProjects),
    [filterProjectsByUser, quantArchivedProjects]
  );

  const displayProjects = activeTab === 'active' ? filteredActiveProjects : filteredArchivedProjects;

  // Calculate question type counts for selected questionnaire
  const questionTypeCounts = useMemo(() => {
    if (!selectedQuestionnaire?.questions) return {};
    const counts: Record<string, number> = {};
    selectedQuestionnaire.questions.forEach((q) => {
      const type = q.type || 'other';
      counts[type] = (counts[type] || 0) + 1;
    });
    return counts;
  }, [selectedQuestionnaire?.questions]);

  // Get all unique question types
  const allQuestionTypes = useMemo(() => {
    if (!selectedQuestionnaire?.questions) return [];
    const types = new Set<string>();
    selectedQuestionnaire.questions.forEach((q) => {
      types.add(q.type || 'other');
    });
    return Array.from(types).sort();
  }, [selectedQuestionnaire?.questions]);

  // Filter questions based on selected types
  const filteredQuestions = useMemo(() => {
    if (!selectedQuestionnaire?.questions) return [];
    if (selectedQuestionTypes.size === 0) {
      return selectedQuestionnaire.questions;
    }
    return selectedQuestionnaire.questions.filter((q) => 
      selectedQuestionTypes.has(q.type || 'other')
    );
  }, [selectedQuestionnaire?.questions, selectedQuestionTypes]);

  // Toggle question type filter
  const toggleQuestionType = useCallback((type: string) => {
    setSelectedQuestionTypes((prev) => {
      const newSet = new Set(prev);
      if (newSet.has(type)) {
        newSet.delete(type);
      } else {
        newSet.add(type);
      }
      return newSet;
    });
  }, []);

  // Handle project selection
  const handleProjectClick = (project: any) => {
    setSelectedProject(project);
    setViewMode('project');
    loadQuestionnaires(project.id);
  };

  // Handle QNR upload
  const handleUpload = async () => {
    const file = fileInputRef.current?.files?.[0];
    if (!file) {
      alert('Please select a file first');
      return;
    }
    if (!questionnaireName.trim()) {
      alert('Please enter a questionnaire name');
      return;
    }
    if (!selectedProject) {
      alert('Please select a project');
      return;
    }

    setUploading(true);
    try {
      const formData = new FormData();
      formData.append('file', file);
      formData.append('projectId', selectedProject.id);
      formData.append('name', questionnaireName);

      const response = await fetch(`${API_BASE_URL}/api/questionnaire/upload`, {
        method: 'POST',
        body: formData,
        headers: { 'Authorization': `Bearer ${localStorage.getItem('cognitive_dash_token')}` }
      });

      if (response.ok) {
        const result = await response.json();
        // Reload all questionnaires to update counts
        const allResponse = await fetch(`${API_BASE_URL}/api/questionnaire/all`, {
          headers: { 'Authorization': `Bearer ${localStorage.getItem('cognitive_dash_token')}` }
        });
        if (allResponse.ok) {
          const allData = await allResponse.json();
          setAllQuestionnaires(allData || []);
        }
        await loadQuestionnaires(selectedProject.id);
        // Set success state instead of closing modal
        setUploadSuccess(true);
        setUploadedQuestionnaire(result);
      } else {
        const error = await response.json();
        setUploading(false);
        alert(`Upload failed: ${error.error}`);
      }
    } catch (error) {
      console.error('Upload error:', error);
      setUploading(false);
      alert('Upload failed - please try again');
    }
  };

  // Handle QNR deletion
  const handleDeleteQNR = async (qnrId: string) => {
    if (!confirm('Are you sure you want to delete this QNR? This action cannot be undone.')) {
      return;
    }

    try {
      const response = await fetch(`${API_BASE_URL}/api/questionnaire/${qnrId}`, {
        method: 'DELETE',
        headers: {
          'Authorization': `Bearer ${localStorage.getItem('cognitive_dash_token')}`
        }
      });

      if (response.ok) {
        // Reload all questionnaires to update counts
        const allResponse = await fetch(`${API_BASE_URL}/api/questionnaire/all`, {
          headers: { 'Authorization': `Bearer ${localStorage.getItem('cognitive_dash_token')}` }
        });
        if (allResponse.ok) {
          const allData = await allResponse.json();
          setAllQuestionnaires(allData || []);
        }
        await loadQuestionnaires(selectedProject!.id);
        if (selectedQuestionnaire?.id === qnrId) {
          setSelectedQuestionnaire(null);
          setViewMode('project');
        }
        alert('QNR deleted successfully!');
      } else {
        const error = await response.json();
        alert(`Failed to delete QNR: ${error.error}`);
      }
    } catch (error) {
      console.error('Error deleting QNR:', error);
      alert('Failed to delete QNR - please try again');
    }
  };

  return (
    <div className="flex-1 p-6 space-y-4 max-w-full overflow-y-auto" style={{ height: 'calc(100vh - 80px)', marginTop: '80px' }}>
      {viewMode === 'home' && (
        <>
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
                <IconCheckbox className="mx-auto mb-4 h-16 w-16 text-gray-300" />
                <h3 className="text-lg font-semibold text-gray-900">
                  {activeTab === 'archived' ? 'No archived quantitative projects' : 'No active quantitative projects'}
                </h3>
                <p className="mt-2 text-gray-500">
                  {activeTab === 'archived'
                    ? 'Archived quantitative projects will appear here.'
                    : 'Create a quantitative project to start managing QNRs.'}
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
                        QNRs
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
                            <IconCheckbox className="h-4 w-4 text-gray-400" />
                            <span>{getQNRCount(project.id)}</span>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      )}

      {viewMode === 'project' && selectedProject && (
        <>
          <div className="bg-white shadow-sm border border-gray-200 rounded-lg overflow-hidden">
            <div className="px-6 py-4 border-b border-gray-200 bg-gray-50">
              <div className="flex items-center justify-between">
                <button
                  onClick={() => {
                    setViewMode('home');
                    setSelectedProject(null);
                    setQuestionnaires([]);
                  }}
                  className="flex items-center gap-2 text-sm text-gray-600 hover:text-gray-800 hover:bg-gray-100 px-3 py-1 rounded-lg transition-colors"
                >
                  <ArrowLeftIcon className="h-4 w-4" />
                  Back to Projects
                </button>
                <button
                  onClick={() => setShowUploadModal(true)}
                  className="inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium text-white shadow-sm transition hover:opacity-90"
                  style={{ backgroundColor: BRAND_ORANGE }}
                >
                  <CloudArrowUpIcon className="w-5 h-5" />
                  Upload QNR
                </button>
              </div>
            </div>

            <div className="px-6 py-6">
              <h2 className="text-xl font-semibold text-gray-900 mb-4">{selectedProject.name}</h2>
              
              {questionnaires.length === 0 ? (
                <div className="text-center py-12">
                  <IconCheckbox className="mx-auto mb-4 h-16 w-16 text-gray-300" />
                  <h3 className="text-lg font-semibold text-gray-900 mb-2">No QNRs found</h3>
                  <p className="text-gray-500 mb-4">Upload a QNR to get started.</p>
                  <button
                    onClick={() => setShowUploadModal(true)}
                    className="inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium text-white shadow-sm transition hover:opacity-90"
                    style={{ backgroundColor: BRAND_ORANGE }}
                  >
                    <CloudArrowUpIcon className="w-5 h-5" />
                    Upload QNR
                  </button>
                </div>
              ) : (
                <div className="space-y-3">
                  {questionnaires.map((qnr) => (
                    <div
                      key={qnr.id}
                      className="border border-gray-200 rounded-lg p-4 hover:bg-gray-50 cursor-pointer transition-colors"
                      onClick={() => {
                        setSelectedQuestionnaire(qnr);
                        setViewMode('qnr');
                      }}
                    >
                      <div className="flex items-center justify-between">
                        <div>
                          <h3 className="text-lg font-medium text-gray-900">{qnr.name}</h3>
                          <p className="text-sm text-gray-500 mt-1">
                            {qnr.questions?.length || 0} questions • Created {new Date(qnr.createdAt).toLocaleDateString()}
                          </p>
                        </div>
                        <div className="flex items-center gap-2">
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              setSelectedQuestionnaire(qnr);
                              setViewMode('qnr');
                            }}
                            className="p-2 text-gray-600 hover:text-gray-900 hover:bg-gray-100 rounded-lg transition-colors"
                            title="View QNR"
                          >
                            <EyeIcon className="w-5 h-5" />
                          </button>
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              handleDeleteQNR(qnr.id);
                            }}
                            className="p-2 text-red-600 hover:text-red-700 hover:bg-red-50 rounded-lg transition-colors"
                            title="Delete QNR"
                          >
                            <TrashIcon className="w-5 h-5" />
                          </button>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </>
      )}

      {viewMode === 'qnr' && selectedQuestionnaire && (
        <>
          <div className="bg-white shadow-sm border border-gray-200 rounded-lg overflow-hidden">
            <div className="px-6 py-4 border-b border-gray-200 bg-gray-50">
              <div className="flex items-center justify-between">
                <button
                  onClick={() => {
                    setViewMode('project');
                    setSelectedQuestionnaire(null);
                    setSelectedQuestionTypes(new Set());
                  }}
                  className="flex items-center gap-2 text-sm text-gray-600 hover:text-gray-800 hover:bg-gray-100 px-3 py-1 rounded-lg transition-colors"
                >
                  <ArrowLeftIcon className="h-4 w-4" />
                  Back to QNRs
                </button>
                <h2 className="text-xl font-semibold text-gray-900">{selectedQuestionnaire.name}</h2>
                <div className="text-sm text-gray-500">
                  {filteredQuestions.length} of {selectedQuestionnaire.questions?.length || 0} questions
                </div>
              </div>
            </div>

            {/* Question Type Filters */}
            {allQuestionTypes.length > 0 && (
              <div className="px-6 py-4 border-b border-gray-200 bg-white">
                <div className="flex flex-wrap gap-2">
                  {allQuestionTypes.map((type) => {
                    const isSelected = selectedQuestionTypes.has(type);
                    const count = questionTypeCounts[type] || 0;
                    return (
                      <button
                        key={type}
                        onClick={() => toggleQuestionType(type)}
                        className={`px-4 py-2 rounded-lg border-2 transition-all ${
                          isSelected
                            ? 'border-orange-500 text-white shadow-sm'
                            : 'border-gray-300 text-gray-700 hover:border-gray-400 hover:bg-gray-50'
                        }`}
                        style={isSelected ? { backgroundColor: BRAND_ORANGE } : {}}
                      >
                        <span className="text-sm font-medium">{type}</span>
                        <span className={`ml-2 text-xs ${isSelected ? 'text-white' : 'text-gray-500'}`}>
                          ({count})
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            <div className="px-6 py-6 space-y-4">
              {filteredQuestions.length === 0 ? (
                <div className="text-center py-12">
                  <p className="text-gray-500">No questions match the selected filters.</p>
                  <button
                    onClick={() => setSelectedQuestionTypes(new Set())}
                    className="mt-4 text-sm text-orange-600 hover:text-orange-700 underline"
                  >
                    Clear filters
                  </button>
                </div>
              ) : (
                filteredQuestions.map((question, index) => (
                  <QuestionBox 
                    key={question.id || index} 
                    question={question} 
                    index={index}
                    variableData={variableData}
                    onUpdateQuestion={(updatedQuestion) => {
                      // Update the question in the selected questionnaire
                      const updatedQuestions = selectedQuestionnaire.questions.map(q => 
                        q.id === updatedQuestion.id ? updatedQuestion : q
                      );
                      setSelectedQuestionnaire({
                        ...selectedQuestionnaire,
                        questions: updatedQuestions
                      });
                      return updatedQuestions;
                    }}
                    questionnaireId={selectedQuestionnaire.id}
                  />
                ))
              )}
            </div>
          </div>
        </>
      )}

      {/* Upload Modal */}
      {showUploadModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50" style={{ margin: 0, padding: 0, top: 0, left: 0, right: 0, bottom: 0 }}>
          <div className="bg-white rounded-lg p-6 w-96 max-w-full mx-4">
            {uploading && !uploadSuccess ? (
              <div className="text-center py-8">
                <div className="w-16 h-16 mx-auto mb-4">
                  <svg className="animate-spin w-16 h-16" fill="none" viewBox="0 0 24 24" style={{ color: BRAND_ORANGE }}>
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                  </svg>
                </div>
                <h3 className="text-lg font-semibold text-gray-900 mb-2">Parsing QNR</h3>
              </div>
            ) : uploadSuccess ? (
              <div className="text-center py-8">
                <div className="w-16 h-16 mx-auto mb-4 flex items-center justify-center rounded-full" style={{ backgroundColor: '#dcfce7' }}>
                  <svg className="w-10 h-10" fill="none" viewBox="0 0 24 24" style={{ color: '#16a34a' }}>
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" stroke="currentColor" d="M5 13l4 4L19 7" />
                  </svg>
                </div>
                <h3 className="text-lg font-semibold text-gray-900 mb-2">Upload Complete!</h3>
                <p className="text-sm text-gray-600 mb-6">Questionnaire uploaded and parsed successfully.</p>
                <button
                  onClick={() => {
                    setShowUploadModal(false);
                    setUploadSuccess(false);
                    setUploading(false);
                    setQuestionnaireName('');
                    if (fileInputRef.current) {
                      fileInputRef.current.value = '';
                    }
                    // Open the newly uploaded QNR
                    if (uploadedQuestionnaire) {
                      setSelectedQuestionnaire(uploadedQuestionnaire);
                      setViewMode('qnr');
                    }
                    setUploadedQuestionnaire(null);
                  }}
                  className="px-6 py-2 text-white rounded-md hover:opacity-90 transition-opacity"
                  style={{ backgroundColor: BRAND_ORANGE }}
                >
                  Close
                </button>
              </div>
            ) : (
              <>
                <div className="flex items-center justify-between mb-4">
                  <h3 className="text-lg font-semibold">Upload QNR</h3>
                  <button
                    onClick={() => {
                      setShowUploadModal(false);
                      setUploadSuccess(false);
                      setUploading(false);
                      setQuestionnaireName('');
                      if (fileInputRef.current) {
                        fileInputRef.current.value = '';
                      }
                    }}
                    className="text-gray-400 hover:text-gray-600"
                  >
                    <XMarkIcon className="w-6 h-6" />
                  </button>
                </div>
                <div className="space-y-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      QNR Name
                    </label>
                    <input
                      type="text"
                      value={questionnaireName}
                      onChange={(e) => setQuestionnaireName(e.target.value)}
                      className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-orange-500"
                      placeholder="e.g., US ATU W3 QNR"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Upload .docx File
                    </label>
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept=".docx"
                      className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-orange-500"
                      disabled={uploading}
                    />
                  </div>
                </div>
                <div className="flex justify-end gap-3 mt-6">
                  <button
                    onClick={() => {
                      setShowUploadModal(false);
                      setUploadSuccess(false);
                      setUploading(false);
                      setQuestionnaireName('');
                      if (fileInputRef.current) {
                        fileInputRef.current.value = '';
                      }
                    }}
                    className="px-4 py-2 text-gray-600 hover:text-gray-800"
                    disabled={uploading}
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handleUpload}
                    className="px-4 py-2 text-white rounded-md hover:opacity-90"
                    style={{ backgroundColor: BRAND_ORANGE }}
                    disabled={uploading}
                  >
                    Upload
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// Question Box Component
function QuestionBox({ 
  question, 
  index, 
  variableData = {},
  onUpdateQuestion,
  questionnaireId
}: { 
  question: Question; 
  index: number;
  variableData?: Record<string, any>;
  onUpdateQuestion?: (question: Question) => Question[];
  questionnaireId?: string;
}) {
  const [isFlipping, setIsFlipping] = useState(false);
  const [isEditingOptions, setIsEditingOptions] = useState(false);
  const [editedOptions, setEditedOptions] = useState<Array<{ code: string; text: string }>>([]);
  const [isEditingResponseOptions, setIsEditingResponseOptions] = useState(false);
  const [editedResponseOptions, setEditedResponseOptions] = useState<Array<{ code: string; text: string }>>([]);
  
  // Check if question has both statementOptions and responseOptions (can be flipped)
  const canFlip = question.statementOptions && question.statementOptions.length > 0 && 
                  question.responseOptions && question.responseOptions.length > 0;

  const handleFlipOptions = async () => {
    if (!canFlip || !onUpdateQuestion || !questionnaireId) return;

    setIsFlipping(true);
    const originalQuestion = question;
    let updatedQuestions: Question[] = [];

    try {
      // Create updated question with flipped options
      const updatedQuestion: Question = {
        ...question,
        statementOptions: question.responseOptions?.map((opt, idx) => ({
          code: `r${idx + 1}`,
          text: opt.text
        })),
        responseOptions: question.statementOptions?.map((opt, idx) => ({
          code: `c${idx + 1}`,
          text: opt.text
        }))
      };

      // Update locally first for immediate feedback
      updatedQuestions = onUpdateQuestion(updatedQuestion);

      // Save to backend with all questions
      const response = await fetch(`${API_BASE_URL}/api/questionnaire/${questionnaireId}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${localStorage.getItem('cognitive_dash_token')}`
        },
        body: JSON.stringify({
          questions: updatedQuestions
        })
      });

      if (!response.ok) {
        // Revert on error
        onUpdateQuestion(originalQuestion);
        alert('Failed to save changes. Please try again.');
      }
    } catch (error) {
      console.error('Error flipping options:', error);
      // Revert on error
      if (onUpdateQuestion) {
        onUpdateQuestion(originalQuestion);
      }
      alert('Failed to save changes. Please try again.');
    } finally {
      setIsFlipping(false);
    }
  };

  const handleStartEditOptions = () => {
    const options = question.options?.map((opt, idx) => 
      typeof opt === 'string' ? { code: String(idx + 1), text: opt } : { code: opt.code || String(idx + 1), text: opt.text || '' }
    ) || [];
    setEditedOptions(options);
    setIsEditingOptions(true);
  };

  const handleCancelEditOptions = () => {
    setIsEditingOptions(false);
    setEditedOptions([]);
  };

  const handleSaveOptions = async () => {
    if (!onUpdateQuestion || !questionnaireId) return;

    // Check for duplicate codes
    const codes = editedOptions.map(opt => opt.code.trim().toLowerCase());
    const duplicateCodes = codes.filter((code, index) => codes.indexOf(code) !== index);
    if (duplicateCodes.length > 0) {
      alert('Duplicate codes are not allowed. Please ensure each code is unique.');
      return;
    }

    const updatedQuestion: Question = {
      ...question,
      options: editedOptions.map(opt => ({
        code: opt.code,
        text: opt.text,
        tags: (() => {
          // Preserve tags from original option if it exists
          const originalOpt = question.options?.find((o, idx) => {
            const originalOptObj = typeof o === 'string' ? { code: String(idx + 1), text: o } : o;
            return originalOptObj.text === opt.text || originalOptObj.code === opt.code;
          });
          return originalOpt && typeof originalOpt !== 'string' ? originalOpt.tags : undefined;
        })()
      }))
    };

    try {
      const updatedQuestions = onUpdateQuestion(updatedQuestion);
      
      const response = await fetch(`${API_BASE_URL}/api/questionnaire/${questionnaireId}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${localStorage.getItem('cognitive_dash_token')}`
        },
        body: JSON.stringify({
          questions: updatedQuestions
        })
      });

      if (response.ok) {
        setIsEditingOptions(false);
      } else {
        alert('Failed to save changes. Please try again.');
      }
    } catch (error) {
      console.error('Error saving options:', error);
      alert('Failed to save changes. Please try again.');
    }
  };

  const handleStartEditResponseOptions = () => {
    const responseOptions = question.responseOptions?.map((opt, idx) => 
      typeof opt === 'string' ? { code: `c${idx + 1}`, text: opt } : { code: opt.code || `c${idx + 1}`, text: opt.text || '' }
    ) || [];
    setEditedResponseOptions(responseOptions);
    setIsEditingResponseOptions(true);
  };

  const handleCancelEditResponseOptions = () => {
    setIsEditingResponseOptions(false);
    setEditedResponseOptions([]);
  };

  const handleSaveResponseOptions = async () => {
    if (!onUpdateQuestion || !questionnaireId) return;

    // Check for duplicate codes
    const codes = editedResponseOptions.map(opt => opt.code.trim().toLowerCase());
    const duplicateCodes = codes.filter((code, index) => codes.indexOf(code) !== index);
    if (duplicateCodes.length > 0) {
      alert('Duplicate codes are not allowed. Please ensure each code is unique.');
      return;
    }

    const updatedQuestion: Question = {
      ...question,
      responseOptions: editedResponseOptions
    };

    try {
      const updatedQuestions = onUpdateQuestion(updatedQuestion);
      
      const response = await fetch(`${API_BASE_URL}/api/questionnaire/${questionnaireId}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${localStorage.getItem('cognitive_dash_token')}`
        },
        body: JSON.stringify({
          questions: updatedQuestions
        })
      });

      if (response.ok) {
        setIsEditingResponseOptions(false);
      } else {
        alert('Failed to save changes. Please try again.');
      }
    } catch (error) {
      console.error('Error saving response options:', error);
      alert('Failed to save changes. Please try again.');
    }
  };

  // Calculate hasPercentageError and hasData from variableData
  const questionNumber = question.number || `Q${index + 1}`;
  
  // Find the variable that matches this question number
  // Try exact match first, then try with various prefixes
  let varData = variableData[questionNumber];
  if (!varData) {
    // Try other possible variable names
    const possibleNames = [
      questionNumber.replace(/^Q/i, ''),
      `S${questionNumber.replace(/^Q/i, '')}`,
      questionNumber.replace(/^Q/i, 'S')
    ];
    for (const name of possibleNames) {
      if (variableData[name]) {
        varData = variableData[name];
        break;
      }
    }
  }
  
  // Calculate hasData
  let hasData = false;
  if (varData) {
    hasData = (
      (varData.count && varData.count > 0) ||
      (varData.frequencies && Object.keys(varData.frequencies || {}).length > 0) ||
      (varData.values && Array.isArray(varData.values) && varData.values.length > 0)
    );
  }
  
  // Calculate hasPercentageError for single-select questions
  let hasPercentageError = false;
  if (hasData && varData && question.options && question.options.length > 0) {
    // Check if this is a single-select question (has options with codes)
    const hasCodes = question.options.some(opt => {
      if (typeof opt === 'object' && opt.code) return true;
      return false;
    });
    
    if (hasCodes) {
      // Extract codes from question options
      const codes: Record<string, string> = {};
      question.options.forEach(opt => {
        if (typeof opt === 'object' && opt.code) {
          codes[opt.code] = opt.text || '';
        }
      });
      
      if (Object.keys(codes).length > 0) {
        // Use the same frequency generation logic as in Tabs.tsx
        let frequencies = varData.frequencies;
        if (!frequencies && varData.values && Array.isArray(varData.values)) {
          frequencies = {};
          varData.values.forEach((val: any) => {
            const valStr = String(val).trim();
            let matchedCode: string | null = null;
            
            if (codes[valStr]) {
              matchedCode = valStr;
            } else {
              const numVal = /^\d+$/.test(valStr) ? parseInt(valStr, 10) : null;
              if (numVal !== null) {
                if (codes[String(numVal)]) {
                  matchedCode = String(numVal);
                } else if (codes[numVal]) {
                  matchedCode = String(numVal);
                }
              }
            }
            
            if (matchedCode) {
              frequencies[matchedCode] = (frequencies[matchedCode] || 0) + 1;
            } else {
              frequencies[valStr] = (frequencies[valStr] || 0) + 1;
            }
          });
        }
        
        if (frequencies) {
          const total = varData.count || 0;
          let totalPercentage = 0;
          
          const getCount = (code: string): number => {
            let count = 0;
            if (frequencies[code] !== undefined) {
              count = frequencies[code];
            } else {
              const numericCode = /^\d+$/.test(code) ? parseInt(code, 10) : null;
              if (numericCode !== null) {
                if (frequencies[numericCode] !== undefined) {
                  count = frequencies[numericCode];
                } else if (frequencies[String(numericCode)] !== undefined) {
                  count = frequencies[String(numericCode)];
                }
              }
              if (count === 0) {
                const codeWithoutPrefix = code.replace(/^[rc]/i, '');
                if (frequencies[codeWithoutPrefix] !== undefined) {
                  count = frequencies[codeWithoutPrefix];
                } else if (/^\d+$/.test(codeWithoutPrefix)) {
                  const num = parseInt(codeWithoutPrefix, 10);
                  if (frequencies[num] !== undefined) {
                    count = frequencies[num];
                  }
                }
              }
              if (count === 0 && !code.match(/^[rc]/i)) {
                if (frequencies[`c${code}`] !== undefined) {
                  count = frequencies[`c${code}`];
                } else if (frequencies[`r${code}`] !== undefined) {
                  count = frequencies[`r${code}`];
                }
              }
            }
            return count;
          };
          
          Object.keys(codes).forEach((code) => {
            const count = getCount(code);
            const percentage = total > 0 ? (count / total) * 100 : 0;
            totalPercentage += percentage;
          });
          
          if (total > 0 && totalPercentage > 0 && Math.abs(totalPercentage - 100) > 0.1) {
            hasPercentageError = true;
          }
        }
      }
    }
  }

  return (
    <div className="border border-gray-200 rounded-lg p-4 bg-white" data-question-number={question.number || `Q${index + 1}`}>
      <div className="flex items-start justify-between mb-3">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-sm font-semibold text-gray-900">{question.number || `Q${index + 1}`}</span>
          {hasPercentageError ? (
            <InformationCircleIcon className="h-5 w-5 text-red-500 flex-shrink-0" title="Percentages don't sum to 100% - check response codes" />
          ) : !hasData ? (
            <InformationCircleIcon className="h-5 w-5 text-red-500 flex-shrink-0" title="No data available for this variable" />
          ) : null}
          {question.needsReview && (
            <span className="text-xs px-2 py-1 bg-red-100 text-red-700 rounded">Needs Review</span>
          )}
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          {/* Display metadata tags (Scale, %, Number) as pills - right aligned and grey */}
          {question.tags && question.tags.filter(tag => 
            (tag === 'Scale' || tag === '%' || tag === 'Number') &&
            tag.toLowerCase() !== 'terminate' && tag.toLowerCase() !== 'specify'
          ).map((tag, tagIndex) => (
            <span
              key={tagIndex}
              className="text-xs px-2 py-1 bg-gray-100 text-gray-700 rounded"
            >
              {tag}
            </span>
          ))}
          {/* Question type pill - blue, right-aligned */}
          <span className="text-xs px-2 py-1 rounded flex-shrink-0 bg-blue-100 text-blue-800" style={{ minWidth: '80px', textAlign: 'center' }}>
            {question.type || 'other'}
          </span>
        {canFlip && (
          <button
            onClick={handleFlipOptions}
            disabled={isFlipping}
            className="flex items-center gap-1 px-3 py-1 text-xs font-medium text-gray-700 bg-gray-100 hover:bg-gray-200 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            title="Flip statement options and response options"
          >
            <ArrowPathIcon className={`w-4 h-4 ${isFlipping ? 'animate-spin' : ''}`} />
            Flip Options
          </button>
        )}
        </div>
      </div>

      <div className="mb-3">
        <p className="text-sm text-gray-900">{question.text}</p>
      </div>

      {/* Response Options */}
      {question.options && question.options.length > 0 && (
        <div className="mb-3">
          <div className="flex items-center justify-between mb-2">
            <h4 className="text-xs font-medium text-gray-700">Response Options:</h4>
            {!isEditingOptions && (
              <button
                onClick={handleStartEditOptions}
                className="flex items-center gap-1 px-2 py-1 text-xs font-medium text-gray-600 hover:text-gray-900 hover:bg-gray-100 rounded transition-colors"
                title="Edit response codes"
              >
                <PencilIcon className="w-3 h-3" />
                Edit
              </button>
            )}
          </div>
          {isEditingOptions ? (
            <div className="space-y-2">
              {(() => {
                // Check for duplicate codes
                const codes = editedOptions.map(opt => opt.code.trim().toLowerCase());
                const duplicateCodes = new Set<string>();
                codes.forEach((code, index) => {
                  if (code && codes.indexOf(code) !== index) {
                    duplicateCodes.add(code);
                  }
                });
                
                return (
                  <>
                    {editedOptions.map((opt, optIndex) => {
                      const codeLower = opt.code.trim().toLowerCase();
                      const isDuplicate = codeLower && duplicateCodes.has(codeLower);
                      
                      return (
                        <div key={optIndex} className="flex items-center gap-2">
                          <input
                            type="text"
                            value={opt.code}
                            onChange={(e) => {
                              const updated = [...editedOptions];
                              updated[optIndex] = { ...updated[optIndex], code: e.target.value };
                              setEditedOptions(updated);
                            }}
                            className={`w-16 px-2 py-1 text-xs font-mono border rounded focus:outline-none focus:ring-2 ${
                              isDuplicate 
                                ? 'border-red-500 focus:ring-red-500' 
                                : 'border-gray-300 focus:ring-orange-500'
                            }`}
                            placeholder="Code"
                          />
                          <input
                            type="text"
                            value={opt.text}
                            onChange={(e) => {
                              const updated = [...editedOptions];
                              updated[optIndex] = { ...updated[optIndex], text: e.target.value };
                              setEditedOptions(updated);
                            }}
                            className="flex-1 px-2 py-1 text-xs border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-orange-500"
                            placeholder="Text"
                          />
                        </div>
                      );
                    })}
                    {duplicateCodes.size > 0 && (
                      <p className="text-xs text-red-600 mt-1">
                        Duplicate codes are not allowed. Please ensure each code is unique.
                      </p>
                    )}
                  </>
                );
              })()}
              <div className="flex items-center gap-2 mt-2">
                {(() => {
                  const codes = editedOptions.map(opt => opt.code.trim().toLowerCase());
                  const duplicateCodes = codes.filter((code, index) => code && codes.indexOf(code) !== index);
                  const hasDuplicates = duplicateCodes.length > 0;
                  
                  return (
                    <button
                      onClick={handleSaveOptions}
                      disabled={hasDuplicates}
                      className={`flex items-center gap-1 px-3 py-1 text-xs font-medium rounded transition-colors ${
                        hasDuplicates
                          ? 'bg-gray-400 text-gray-600 cursor-not-allowed'
                          : 'text-white bg-green-600 hover:bg-green-700'
                      }`}
                    >
                      <CheckIcon className="w-3 h-3" />
                      Save
                    </button>
                  );
                })()}
                <button
                  onClick={handleCancelEditOptions}
                  className="flex items-center gap-1 px-3 py-1 text-xs font-medium text-gray-700 bg-gray-200 hover:bg-gray-300 rounded transition-colors"
                >
                  <XMarkIcon className="w-3 h-3" />
                  Cancel
                </button>
              </div>
            </div>
          ) : (
          <div className="space-y-1">
            {question.options.map((option, optIndex) => {
              const opt = typeof option === 'string' 
                ? { code: String(optIndex + 1), text: option } 
                : option;
              return (
                <div key={optIndex} className="flex items-center gap-2 text-sm text-gray-700">
                  <span className="font-mono text-xs text-gray-500 w-8">{opt.code}:</span>
                  <span>{opt.text}</span>
                  {opt.tags && opt.tags.length > 0 && (
                    <div className="flex gap-1 ml-2">
                      {opt.tags.map((tag, tagIdx) => (
                        <span
                          key={tagIdx}
                          className="text-xs px-1.5 py-0.5 bg-blue-100 text-blue-700 rounded"
                        >
                          {tag}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
          )}
        </div>
      )}

      {/* Grid table for numeric grids with both statements and response options */}
      {question.type?.toLowerCase().includes('numeric grid') && 
       question.statementOptions && question.statementOptions.length > 0 && 
       question.responseOptions && question.responseOptions.length > 0 && (
        <div className="mb-3">
          <div className="flex items-center justify-between mb-2">
            <h4 className="text-xs font-medium text-gray-700">Grid Structure:</h4>
            {!isEditingResponseOptions && (
              <button
                onClick={handleStartEditResponseOptions}
                className="flex items-center gap-1 px-2 py-1 text-xs font-medium text-gray-600 hover:text-gray-900 hover:bg-gray-100 rounded transition-colors"
                title="Edit response codes"
              >
                <PencilIcon className="w-3 h-3" />
                Edit Response Codes
              </button>
            )}
          </div>
          {isEditingResponseOptions ? (
            <div className="space-y-2 mb-3">
              <div className="text-xs font-medium text-gray-700 mb-2">Response Options (Columns):</div>
              {(() => {
                // Check for duplicate codes
                const codes = editedResponseOptions.map(opt => opt.code.trim().toLowerCase());
                const duplicateCodes = new Set<string>();
                codes.forEach((code, index) => {
                  if (code && codes.indexOf(code) !== index) {
                    duplicateCodes.add(code);
                  }
                });
                
                return (
                  <>
                    {editedResponseOptions.map((respOpt, respIndex) => {
                      const codeLower = respOpt.code.trim().toLowerCase();
                      const isDuplicate = codeLower && duplicateCodes.has(codeLower);
                      
                      return (
                        <div key={respIndex} className="flex items-center gap-2">
                          <input
                            type="text"
                            value={respOpt.code}
                            onChange={(e) => {
                              const updated = [...editedResponseOptions];
                              updated[respIndex] = { ...updated[respIndex], code: e.target.value };
                              setEditedResponseOptions(updated);
                            }}
                            className={`w-16 px-2 py-1 text-xs font-mono border rounded focus:outline-none focus:ring-2 ${
                              isDuplicate 
                                ? 'border-red-500 focus:ring-red-500' 
                                : 'border-gray-300 focus:ring-orange-500'
                            }`}
                            placeholder="Code"
                          />
                          <input
                            type="text"
                            value={respOpt.text}
                            onChange={(e) => {
                              const updated = [...editedResponseOptions];
                              updated[respIndex] = { ...updated[respIndex], text: e.target.value };
                              setEditedResponseOptions(updated);
                            }}
                            className="flex-1 px-2 py-1 text-xs border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-orange-500"
                            placeholder="Text"
                          />
                        </div>
                      );
                    })}
                    {duplicateCodes.size > 0 && (
                      <p className="text-xs text-red-600 mt-1">
                        Duplicate codes are not allowed. Please ensure each code is unique.
                      </p>
                    )}
                  </>
                );
              })()}
              <div className="flex items-center gap-2 mt-2">
                {(() => {
                  const codes = editedResponseOptions.map(opt => opt.code.trim().toLowerCase());
                  const duplicateCodes = codes.filter((code, index) => code && codes.indexOf(code) !== index);
                  const hasDuplicates = duplicateCodes.length > 0;
                  
                  return (
                    <button
                      onClick={handleSaveResponseOptions}
                      disabled={hasDuplicates}
                      className={`flex items-center gap-1 px-3 py-1 text-xs font-medium rounded transition-colors ${
                        hasDuplicates
                          ? 'bg-gray-400 text-gray-600 cursor-not-allowed'
                          : 'text-white bg-green-600 hover:bg-green-700'
                      }`}
                    >
                      <CheckIcon className="w-3 h-3" />
                      Save
                    </button>
                  );
                })()}
                <button
                  onClick={handleCancelEditResponseOptions}
                  className="flex items-center gap-1 px-3 py-1 text-xs font-medium text-gray-700 bg-gray-200 hover:bg-gray-300 rounded transition-colors"
                >
                  <XMarkIcon className="w-3 h-3" />
                  Cancel
                </button>
              </div>
            </div>
          ) : null}
          {!isEditingResponseOptions && (
          <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-200">
                <thead className="bg-gray-50">
                  <tr>
                    <th colSpan={2} className="px-4 py-2 text-left text-xs font-semibold text-gray-900">Statements (Rows)</th>
                    {question.responseOptions.map((resp, respIndex) => {
                      // Note: responseOptions in numeric grids are also labeled as "Statements (Rows)" in the QNR
                      const respOpt = typeof resp === 'string' 
                        ? { code: `c${respIndex + 1}`, text: resp } 
                        : resp;
                      const displayCode = respOpt.code?.replace(/^[rc]/i, '') || String(respIndex + 1);
                      return (
                        <th key={respIndex} className="px-4 py-2 text-center text-xs font-medium text-gray-500 uppercase tracking-wider whitespace-nowrap" style={{ width: '8rem' }}>
                          {respOpt.text} ({displayCode})
                        </th>
                      );
                    })}
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-200">
                  {question.statementOptions.map((stmt, stmtIndex) => {
                    const stmtOpt = typeof stmt === 'string' 
                      ? { code: `r${stmtIndex + 1}`, text: stmt } 
                      : { 
                          code: stmt.code || `r${stmtIndex + 1}`, 
                          text: stmt.text 
                        };
                    const displayStmtCode = stmtOpt.code?.replace(/^[rc]/i, '') || String(stmtIndex + 1);
                    return (
                      <tr key={stmtIndex}>
                        <td className="px-2 py-2 text-xs font-mono text-gray-700 text-center" style={{ width: '2.5rem' }}>{displayStmtCode}</td>
                        <td className="px-4 py-2 text-xs text-gray-900">{stmtOpt.text}</td>
                        {question.responseOptions.map((resp, respIndex) => {
                          const respOpt = typeof resp === 'string' 
                            ? { code: `c${respIndex + 1}`, text: resp } 
                            : resp;
                          return (
                            <td key={respIndex} className="px-4 py-2 text-xs text-gray-500 text-center" style={{ width: '8rem' }}>
                              —
                            </td>
                          );
                        })}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
          )}
        </div>
      )}

      {/* Statement Options (for grid questions - rows) - only show if not already shown in grid table */}
      {question.statementOptions && question.statementOptions.length > 0 && 
       !(question.type?.toLowerCase().includes('numeric grid') && question.responseOptions && question.responseOptions.length > 0) && (
        <div className="mb-3">
          <h4 className="text-xs font-medium text-gray-700 mb-2">Statement Options (Rows):</h4>
          <div className="space-y-1">
            {question.statementOptions.map((stmt, stmtIndex) => {
              const isNumericGrid = question.type?.toLowerCase().includes('numeric grid');
              // For numeric grids, use c1, c2, etc. For other grids, use r1, r2, etc. or existing code
              const defaultCode = isNumericGrid ? `c${stmtIndex + 1}` : `r${stmtIndex + 1}`;
              const stmtOpt = typeof stmt === 'string' 
                ? { code: defaultCode, text: stmt } 
                : { 
                    code: isNumericGrid ? `c${stmtIndex + 1}` : (stmt.code || defaultCode), 
                    text: stmt.text 
                  };
              return (
                <div key={stmtIndex} className="flex items-center gap-2 text-sm text-gray-700">
                  <span className="font-mono text-xs text-gray-500 w-8">{stmtOpt.code}:</span>
                  <span>{stmtOpt.text}</span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Response Options (for grid questions - column headers/scale) - only show if not already shown in grid table */}
      {question.responseOptions && question.responseOptions.length > 0 && 
       !(question.type?.toLowerCase().includes('numeric grid') && question.statementOptions && question.statementOptions.length > 0) && (
        <div className="mb-3">
          <div className="flex items-center justify-between mb-2">
            <h4 className="text-xs font-medium text-gray-700">Response Options (Columns):</h4>
            {!isEditingResponseOptions && (
              <button
                onClick={handleStartEditResponseOptions}
                className="flex items-center gap-1 px-2 py-1 text-xs font-medium text-gray-600 hover:text-gray-900 hover:bg-gray-100 rounded transition-colors"
                title="Edit response codes"
              >
                <PencilIcon className="w-3 h-3" />
                Edit
              </button>
            )}
          </div>
          {isEditingResponseOptions ? (
            <div className="space-y-2">
              {(() => {
                // Check for duplicate codes
                const codes = editedResponseOptions.map(opt => opt.code.trim().toLowerCase());
                const duplicateCodes = new Set<string>();
                codes.forEach((code, index) => {
                  if (code && codes.indexOf(code) !== index) {
                    duplicateCodes.add(code);
                  }
                });
                
                return (
                  <>
                    {editedResponseOptions.map((respOpt, respIndex) => {
                      const codeLower = respOpt.code.trim().toLowerCase();
                      const isDuplicate = codeLower && duplicateCodes.has(codeLower);
                      
                      return (
                        <div key={respIndex} className="flex items-center gap-2">
                          <input
                            type="text"
                            value={respOpt.code}
                            onChange={(e) => {
                              const updated = [...editedResponseOptions];
                              updated[respIndex] = { ...updated[respIndex], code: e.target.value };
                              setEditedResponseOptions(updated);
                            }}
                            className={`w-16 px-2 py-1 text-xs font-mono border rounded focus:outline-none focus:ring-2 ${
                              isDuplicate 
                                ? 'border-red-500 focus:ring-red-500' 
                                : 'border-gray-300 focus:ring-orange-500'
                            }`}
                            placeholder="Code"
                          />
                          <input
                            type="text"
                            value={respOpt.text}
                            onChange={(e) => {
                              const updated = [...editedResponseOptions];
                              updated[respIndex] = { ...updated[respIndex], text: e.target.value };
                              setEditedResponseOptions(updated);
                            }}
                            className="flex-1 px-2 py-1 text-xs border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-orange-500"
                            placeholder="Text"
                          />
                        </div>
                      );
                    })}
                    {duplicateCodes.size > 0 && (
                      <p className="text-xs text-red-600 mt-1">
                        Duplicate codes are not allowed. Please ensure each code is unique.
                      </p>
                    )}
                  </>
                );
              })()}
              <div className="flex items-center gap-2 mt-2">
                {(() => {
                  const codes = editedResponseOptions.map(opt => opt.code.trim().toLowerCase());
                  const duplicateCodes = codes.filter((code, index) => code && codes.indexOf(code) !== index);
                  const hasDuplicates = duplicateCodes.length > 0;
                  
                  return (
                    <button
                      onClick={handleSaveResponseOptions}
                      disabled={hasDuplicates}
                      className={`flex items-center gap-1 px-3 py-1 text-xs font-medium rounded transition-colors ${
                        hasDuplicates
                          ? 'bg-gray-400 text-gray-600 cursor-not-allowed'
                          : 'text-white bg-green-600 hover:bg-green-700'
                      }`}
                    >
                      <CheckIcon className="w-3 h-3" />
                      Save
                    </button>
                  );
                })()}
                <button
                  onClick={handleCancelEditResponseOptions}
                  className="flex items-center gap-1 px-3 py-1 text-xs font-medium text-gray-700 bg-gray-200 hover:bg-gray-300 rounded transition-colors"
                >
                  <XMarkIcon className="w-3 h-3" />
                  Cancel
                </button>
              </div>
            </div>
          ) : (
          <div className="space-y-1">
            {question.responseOptions.map((resp, respIndex) => {
              const respOpt = typeof resp === 'string' 
                ? { code: `c${respIndex + 1}`, text: resp } 
                : resp;
              return (
                <div key={respIndex} className="flex items-center gap-2 text-sm text-gray-700">
                  <span className="font-mono text-xs text-gray-500 w-8">{respOpt.code}:</span>
                  <span>{respOpt.text}</span>
                </div>
              );
            })}
          </div>
          )}
        </div>
      )}

      {/* Logic/Show Logic */}
      {(question.showLogic || question.logic) && (
        <div className="mb-3">
          <h4 className="text-xs font-medium text-gray-700 mb-1">Logic:</h4>
          <p className="text-xs text-gray-600 font-mono bg-gray-50 p-2 rounded">
            {typeof (question.showLogic || question.logic) === 'string' 
              ? (question.showLogic || question.logic) 
              : JSON.stringify(question.showLogic || question.logic)}
          </p>
        </div>
      )}

      {/* Terminate Logic */}
      {question.terminateLogic && (
        <div className="mb-3">
          <h4 className="text-xs font-medium text-gray-700 mb-1">Terminate Logic:</h4>
          <p className="text-xs text-gray-600 font-mono bg-gray-50 p-2 rounded">
            {typeof question.terminateLogic === 'string' 
              ? question.terminateLogic 
              : JSON.stringify(question.terminateLogic)}
          </p>
        </div>
      )}

      {/* Validation */}
      {question.validation && (
        <div className="mb-3">
          <h4 className="text-xs font-medium text-gray-700 mb-1">Validation:</h4>
          <p className="text-xs text-gray-600 font-mono bg-gray-50 p-2 rounded">
            {typeof question.validation === 'string' 
              ? question.validation 
              : JSON.stringify(question.validation)}
          </p>
        </div>
      )}

      {/* Other Tags (excluding metadata tags that are shown as pills) */}
      {question.tags && question.tags.filter(tag => 
        tag !== 'Scale' && tag !== '%' && tag !== 'Number'
      ).length > 0 && (
        <div className="flex flex-wrap gap-1">
          <span className="text-xs font-medium text-gray-700">Other Tags: </span>
          {question.tags.filter(tag => 
            tag !== 'Scale' && tag !== '%' && tag !== 'Number'
          ).map((tag, tagIndex) => (
            <span
              key={tagIndex}
              className="text-xs px-2 py-1 bg-gray-100 text-gray-700 rounded"
            >
              {tag}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

