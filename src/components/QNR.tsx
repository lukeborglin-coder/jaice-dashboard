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
  InformationCircleIcon,
  ChevronDownIcon,
  ChevronUpIcon
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
  terminateLogic?: string | { optionCodes: string[] };
  validation?: object;
  randomize?: boolean;
  rawAiOutput?: string; // Raw AI response for this question
}

interface Section {
  sectionNumber: number;
  sectionName: string;
  textLength: number;
  parsed: boolean;
  questions?: Question[];
}

interface Questionnaire {
  id: string;
  name: string;
  questions: Question[];
  sections?: Section[];
  filePath?: string;
  createdAt: string;
  projectId: string;
}

interface QNRProps {
  projects?: any[];
  onNavigateToProject?: (project: any) => void;
  onPageTitleChange?: (title: string) => void;
}

// Helper function to parse special option tags (EXCLUSIVE, ANCHOR, SPECIFY)
const parseOptionTags = (text: string): { cleanText: string; hasExclusive: boolean; hasAnchor: boolean; hasSpecify: boolean } => {
  if (!text) return { cleanText: '', hasExclusive: false, hasAnchor: false, hasSpecify: false };

  let cleanText = text;
  let hasExclusive = false;
  let hasAnchor = false;
  let hasSpecify = false;

  // Find all bracketed content and check for special tags
  const bracketRegex = /\[([^\]]+)\]/g;
  let match;
  const bracketsToRemove: string[] = [];

  while ((match = bracketRegex.exec(text)) !== null) {
    const bracketContent = match[1]; // Content inside brackets
    const fullBracket = match[0]; // Full bracket including [ and ]

    // Split by comma and check each part
    const parts = bracketContent.split(',').map(p => p.trim().toUpperCase());

    let shouldRemoveBracket = false;

    for (const part of parts) {
      if (part === 'EXCLUSIVE') {
        hasExclusive = true;
        shouldRemoveBracket = true;
      }
      if (part === 'ANCHOR') {
        hasAnchor = true;
        shouldRemoveBracket = true;
      }
      if (part === 'SPECIFY') {
        hasSpecify = true;
        shouldRemoveBracket = true;
      }
    }

    // If this bracket only contains special tags, mark it for removal
    if (shouldRemoveBracket) {
      // Check if ALL parts are special tags
      const allPartsAreSpecialTags = parts.every(part =>
        part === 'EXCLUSIVE' || part === 'ANCHOR' || part === 'SPECIFY'
      );

      if (allPartsAreSpecialTags) {
        bracketsToRemove.push(fullBracket);
      }
    }
  }

  // Remove brackets that only contain special tags
  for (const bracket of bracketsToRemove) {
    cleanText = cleanText.replace(bracket, '');
  }

  // Clean up extra whitespace
  cleanText = cleanText.replace(/\s+/g, ' ').trim();

  return { cleanText, hasExclusive, hasAnchor, hasSpecify };
};

// Helper function to toggle a tag in option text
const toggleOptionTag = (text: string, tagName: 'EXCLUSIVE' | 'ANCHOR' | 'SPECIFY', add: boolean): string => {
  const { cleanText, hasExclusive, hasAnchor, hasSpecify } = parseOptionTags(text);

  // Build array of tags that should be present
  const tags: string[] = [];
  if (tagName === 'EXCLUSIVE' ? add : hasExclusive) tags.push('EXCLUSIVE');
  if (tagName === 'ANCHOR' ? add : hasAnchor) tags.push('ANCHOR');
  if (tagName === 'SPECIFY' ? add : hasSpecify) tags.push('SPECIFY');

  // Return text with tags
  if (tags.length === 0) {
    return cleanText;
  } else {
    return `${cleanText} [${tags.join(', ')}]`.trim();
  }
};

// Helper function to format text with brackets styled in blue italic
const formatDescriptionWithBrackets = (text: string) => {
  if (!text) return null;

  // Split text by brackets, keeping the brackets in the result
  const parts: (string | JSX.Element)[] = [];
  const regex = /(\[[^\]]+\])/g;
  let lastIndex = 0;
  let match;
  let key = 0;
  let foundBrackets = false;

  while ((match = regex.exec(text)) !== null) {
    foundBrackets = true;
    // Add text before the bracket
    if (match.index > lastIndex) {
      parts.push(text.substring(lastIndex, match.index));
    }

    // Add the bracketed text with styling (including the brackets)
    const bracketContent = match[1].slice(1, -1); // Remove [ and ]
    parts.push(
      <span key={key++} className="text-blue-600 italic">
        [{bracketContent}]
      </span>
    );

    lastIndex = regex.lastIndex;
  }
  
  // Add remaining text after last bracket
  if (lastIndex < text.length) {
    parts.push(text.substring(lastIndex));
  }
  
  // If no brackets found, return original text as-is
  if (!foundBrackets) {
    return text;
  }
  
  return <>{parts}</>;
};

export default function QNR({ projects = [], onNavigateToProject, onPageTitleChange }: QNRProps) {
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
  const [parsingSections, setParsingSections] = useState<Set<number>>(new Set());
  const [questionnaireName, setQuestionnaireName] = useState('');
  const [allQuestionnaires, setAllQuestionnaires] = useState<Questionnaire[]>([]);
  const [selectedQuestionTypes, setSelectedQuestionTypes] = useState<Set<string>>(new Set());
  const [variableData, setVariableData] = useState<Record<string, any>>({});
  const [expandedSections, setExpandedSections] = useState<Set<string>>(new Set());
  const [selectedSection, setSelectedSection] = useState<string | null>(null);
  const [surveyView, setSurveyView] = useState(false);
  const fileInputRef = React.useRef<HTMLInputElement>(null);
  const pendingSyncRef = React.useRef<{ qnrId: string; projectId: string } | null>(null);
  const [fileValidation, setFileValidation] = useState<{
    isValid: boolean;
    fileSize?: number;
    textLength?: number;
    estimatedInputTokens?: number;
    estimatedOutputTokens?: number;
    maxOutputTokens?: number;
    maxTextLength?: number;
    message?: string;
  } | null>(null);
  const [validatingFile, setValidatingFile] = useState(false);

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

  // Update page title when questionnaire is selected
  useEffect(() => {
    if (onPageTitleChange) {
      if (viewMode === 'qnr' && selectedQuestionnaire) {
        const questionCount = selectedQuestionnaire.questions?.length || 0;
        onPageTitleChange(`${selectedQuestionnaire.name} (${questionCount})`);
      } else {
        onPageTitleChange('QNR');
      }
    }
  }, [selectedQuestionnaire, viewMode, onPageTitleChange]);

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

  // Group questions by first letter of question number, preserving QNR order
  const questionsBySection = useMemo(() => {
    const grouped: Record<string, Question[]> = {};
    const sectionOrder: string[] = [];
    
    filteredQuestions.forEach((question) => {
      const qNum = question.number || '';
      const firstLetter = qNum.toString().charAt(0).toUpperCase();
      const sectionKey = firstLetter || 'OTHER';
      if (!grouped[sectionKey]) {
        grouped[sectionKey] = [];
        sectionOrder.push(sectionKey);
      }
      grouped[sectionKey].push(question);
    });
    
    // Return sections in the order they first appeared in the QNR
    return sectionOrder.reduce((acc, key) => {
      acc[key] = grouped[key];
      return acc;
    }, {} as Record<string, Question[]>);
  }, [filteredQuestions]);

  // Get section keys in order
  const sectionKeys = useMemo(() => {
    return Object.keys(questionsBySection);
  }, [questionsBySection]);

  // Set first section as selected by default when sections change
  useEffect(() => {
    if (sectionKeys.length > 0) {
      if (!selectedSection || !sectionKeys.includes(selectedSection)) {
        // If no section selected or selected section no longer exists, select first section
        setSelectedSection(sectionKeys[0]);
      }
    } else {
      setSelectedSection(null);
    }
  }, [sectionKeys]);

  // Get questions for the selected section
  const selectedSectionQuestions = useMemo(() => {
    if (!selectedSection || !questionsBySection[selectedSection]) {
      return [];
    }
    return questionsBySection[selectedSection];
  }, [selectedSection, questionsBySection]);

  // Toggle section expansion
  const toggleSection = useCallback((sectionKey: string) => {
    setExpandedSections((prev) => {
      const newSet = new Set(prev);
      if (newSet.has(sectionKey)) {
        newSet.delete(sectionKey);
      } else {
        newSet.add(sectionKey);
      }
      return newSet;
    });
  }, []);

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
  // Handle file selection and validation
  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) {
      setFileValidation(null);
      return;
    }

    setValidatingFile(true);
    setFileValidation(null);

    try {
      const formData = new FormData();
      formData.append('file', file);

      const response = await fetch(`${API_BASE_URL}/api/questionnaire/validate-file`, {
        method: 'POST',
        body: formData,
        headers: { 'Authorization': `Bearer ${localStorage.getItem('cognitive_dash_token')}` }
      });

      if (response.ok) {
        const validation = await response.json();
        setFileValidation(validation);
      } else {
        const error = await response.json();
        setFileValidation({
          isValid: false,
          message: error.error || 'Failed to validate file'
        });
      }
    } catch (error) {
      console.error('Validation error:', error);
      setFileValidation({
        isValid: false,
        message: 'Failed to validate file - please try again'
      });
    } finally {
      setValidatingFile(false);
    }
  };

  const handleUpload = async () => {
    const file = fileInputRef.current?.files?.[0];
    if (!file) {
      alert('Please select a file first');
      return;
    }
    if (!fileValidation?.isValid) {
      alert('File validation failed. Please select a valid file.');
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
        console.log('Upload response:', result);
        console.log('Sections found:', result.sections?.length || 0);
        
        // Verify sections exist
        if (!result.sections || result.sections.length === 0) {
          alert('No sections were identified in the questionnaire. Please check the file format.');
          setUploading(false);
          return;
        }
        
        // Set the uploaded questionnaire with sections - don't set uploadSuccess
        setUploadedQuestionnaire(result);
        setUploading(false); // Set to false to show sections view
        // Don't reload questionnaires yet - wait until sections are parsed
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
        <div className="flex h-[calc(100vh-8rem)]">
          {/* Left Sidebar - reduced width */}
          <div className="w-[22%] bg-gray-50 border-r border-gray-200 flex flex-col overflow-hidden">
            {/* Back Button */}
            <div className="pr-4 pt-4 pb-4 flex-shrink-0">
              <button
                onClick={() => {
                  setViewMode('project');
                  setSelectedQuestionnaire(null);
                  setSelectedQuestionTypes(new Set());
                }}
                className="flex items-center gap-2 text-gray-600 hover:text-gray-800 hover:bg-gray-100 px-3 py-2 rounded-lg transition-colors whitespace-nowrap"
                title="Back to QNRs"
              >
                <ArrowLeftIcon className="h-5 w-5 flex-shrink-0" />
                <span className="text-sm font-medium">Back to QNRs</span>
              </button>
            </div>

            {/* Filter Boxes Container - Sections static, Question Types fill remaining */}
            <div className="flex-1 flex flex-col gap-4 pr-4 overflow-hidden">
              {/* Sections - No scrolling, always show all */}
              {sectionKeys.length > 0 && (
                <div className="space-y-2 flex-shrink-0">
                  <div className="flex flex-col gap-2">
                    {sectionKeys.map((sectionKey) => {
                      const isSelected = selectedSection === sectionKey;
                      const count = questionsBySection[sectionKey]?.length || 0;
                      return (
                        <button
                          key={sectionKey}
                          onClick={() => setSelectedSection(sectionKey)}
                          className={`w-full text-left px-2 py-1 rounded border-2 transition-all flex-shrink-0 ${
                            isSelected
                              ? 'text-white shadow-sm'
                              : 'border-gray-300 text-gray-700 hover:border-gray-400 hover:bg-gray-50'
                          }`}
                          style={isSelected ? { backgroundColor: BRAND_ORANGE, borderColor: BRAND_ORANGE } : {}}
                        >
                          <span className="text-xs font-medium">SECTION {sectionKey}</span>
                          <span className={`ml-1.5 text-xs ${isSelected ? 'text-white' : 'text-gray-500'}`}>
                            ({count})
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Question Type Filters - Fill remaining space with scroll */}
              {allQuestionTypes.length > 0 && (
                <div className="bg-white border border-gray-200 rounded-lg p-4 space-y-2 flex flex-col flex-1 min-h-0">
                  <div className="text-xs font-medium text-gray-700 uppercase tracking-wider flex-shrink-0">Question Types</div>
                  <div className="flex flex-col gap-2 overflow-y-auto flex-1 pr-4">
                    {allQuestionTypes.map((type) => {
                      const isSelected = selectedQuestionTypes.has(type);
                      const count = questionTypeCounts[type] || 0;
                      return (
                        <button
                          key={type}
                          onClick={() => toggleQuestionType(type)}
                          className={`w-full text-left px-2 py-1 rounded border-2 transition-all flex-shrink-0 ${
                            isSelected
                              ? 'text-white shadow-sm'
                              : 'border-gray-300 text-gray-700 hover:border-gray-400 hover:bg-gray-50'
                          }`}
                          style={isSelected ? { backgroundColor: BRAND_ORANGE, borderColor: BRAND_ORANGE } : {}}
                        >
                          <div className="truncate">
                            <span className="text-xs font-medium">{type}</span>
                            <span className={`ml-1.5 text-xs ${isSelected ? 'text-white' : 'text-gray-500'}`}>
                              ({count})
                            </span>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Right Content Area - 3/4 width */}
          <div className="flex-1 overflow-y-auto p-6">
            {surveyView ? (
              /* Survey View */
              <div className="space-y-6">
                {selectedSectionQuestions.length === 0 ? (
                  <div className="text-center py-12 bg-white border border-gray-200 rounded-lg">
                    <p className="text-gray-500">No questions in the selected section.</p>
                  </div>
                ) : (
                  <>
                    {selectedSection && (
                      <div className="flex items-center justify-between mb-2">
                        <div className="text-lg font-semibold text-gray-900">
                          SECTION {selectedSection}
                        </div>
                        <button
                          onClick={() => setSurveyView(!surveyView)}
                          className={`flex items-center justify-center gap-1.5 px-2.5 py-1 text-xs font-medium rounded transition-colors w-28 ${
                            surveyView
                              ? 'text-white'
                              : 'bg-white text-gray-700 border border-gray-300 hover:bg-gray-50'
                          }`}
                          style={surveyView ? { backgroundColor: BRAND_ORANGE } : {}}
                          onMouseEnter={(e) => {
                            if (surveyView) {
                              e.currentTarget.style.backgroundColor = '#B83D25';
                            }
                          }}
                          onMouseLeave={(e) => {
                            if (surveyView) {
                              e.currentTarget.style.backgroundColor = BRAND_ORANGE;
                            }
                          }}
                          title={surveyView ? 'Switch to QNR view' : 'Switch to Survey view'}
                        >
                          <DocumentTextIcon className="w-3.5 h-3.5" />
                          {surveyView ? 'QNR View' : 'Survey View'}
                        </button>
                      </div>
                    )}
                    {selectedSectionQuestions.map((question, index) => (
                    <SurveyQuestionView 
                      key={question.number || question.id || index} 
                      question={question} 
                      index={index}
                      onUpdateQuestion={(updatedQuestion) => {
                        // Update the question in the selected questionnaire
                        const updatedQuestions = selectedQuestionnaire.questions.map(q => 
                          (q.number || q.id) === (updatedQuestion.number || updatedQuestion.id) ? updatedQuestion : q
                        );
                        setSelectedQuestionnaire({
                          ...selectedQuestionnaire,
                          questions: updatedQuestions
                        });
                        return updatedQuestions;
                      }}
                      questionnaireId={selectedQuestionnaire.id}
                    />
                    ))}
                  </>
                )}
              </div>
            ) : (
              /* Default QNR View - Floating Question Boxes */
              <div className="space-y-4">
              {selectedSectionQuestions.length === 0 ? (
                <div className="text-center py-12 bg-white border border-gray-200 rounded-lg">
                  <p className="text-gray-500">No questions in the selected section.</p>
                </div>
              ) : (
                <>
                  {selectedSection && (
                    <div className="flex items-center justify-between mb-2">
                      <div className="text-lg font-semibold text-gray-900">
                        SECTION {selectedSection}
                      </div>
                      <button
                        onClick={() => setSurveyView(!surveyView)}
                        className={`flex items-center justify-center gap-1.5 px-2.5 py-1 text-xs font-medium rounded transition-colors ${
                          surveyView
                            ? 'text-white'
                            : 'bg-white text-gray-700 border border-gray-300 hover:bg-gray-50'
                        }`}
                        style={surveyView ? { backgroundColor: BRAND_ORANGE } : {}}
                        onMouseEnter={(e) => {
                          if (surveyView) {
                            e.currentTarget.style.backgroundColor = '#B83D25';
                          }
                        }}
                        onMouseLeave={(e) => {
                          if (surveyView) {
                            e.currentTarget.style.backgroundColor = BRAND_ORANGE;
                          }
                        }}
                        title={surveyView ? 'Switch to QNR view' : 'Switch to Survey view'}
                      >
                        <DocumentTextIcon className="w-3.5 h-3.5" />
                        {surveyView ? 'QNR View' : 'Survey View'}
                      </button>
                    </div>
                  )}
                  {selectedSectionQuestions.map((question, index) => (
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
                  ))}
                </>
              )}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Upload Modal */}
      {showUploadModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50" style={{ margin: 0, padding: 0, top: 0, left: 0, right: 0, bottom: 0 }}>
          <div className="bg-white rounded-lg p-6 w-full max-w-2xl max-h-[90vh] overflow-y-auto mx-4">
            {uploading && !uploadedQuestionnaire ? (
              <div className="text-center py-8">
                <div className="w-16 h-16 mx-auto mb-4">
                  <svg className="animate-spin w-16 h-16" fill="none" viewBox="0 0 24 24" style={{ color: BRAND_ORANGE }}>
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                  </svg>
                </div>
                <h3 className="text-lg font-semibold text-gray-900 mb-2">Identifying Sections</h3>
                <p className="text-sm text-gray-600 mt-2">Analyzing questionnaire structure...</p>
              </div>
            ) : uploadedQuestionnaire && uploadedQuestionnaire.sections && uploadedQuestionnaire.sections.length > 0 ? (
              <div>
                <div className="flex items-center justify-between mb-4">
                  <div>
                    <h3 className="text-lg font-semibold">Questionnaire Sections</h3>
                    <p className="text-sm text-gray-600 mt-1">
                      Found {uploadedQuestionnaire.sections.length} section{uploadedQuestionnaire.sections.length !== 1 ? 's' : ''}
                    </p>
                  </div>
                  <button
                    onClick={async () => {
                      // Get initial list of sections to parse
                      let sectionsToParse = [...(uploadedQuestionnaire.sections || [])].filter(s => !s.parsed);
                      
                      if (sectionsToParse.length === 0) {
                        alert('All sections have already been parsed.');
                        return;
                      }
                      
                      // Parse sections sequentially
                      for (const section of sectionsToParse) {
                        setParsingSections(prev => new Set(prev).add(section.sectionNumber));
                        
                        try {
                          const response = await fetch(`${API_BASE_URL}/api/questionnaire/${uploadedQuestionnaire.id}/parse-section`, {
                            method: 'POST',
                            headers: {
                              'Content-Type': 'application/json',
                              'Authorization': `Bearer ${localStorage.getItem('cognitive_dash_token')}`
                            },
                            body: JSON.stringify({ sectionNumber: section.sectionNumber })
                          });

                          if (response.ok) {
                            const result = await response.json();
                            // Update the section in uploadedQuestionnaire using functional update
                            setUploadedQuestionnaire(prev => {
                              if (!prev) return prev;
                              const updatedSections = prev.sections?.map(s => 
                                s.sectionNumber === section.sectionNumber 
                                  ? { ...s, parsed: true, questions: result.questions }
                                  : s
                              );
                              return {
                                ...prev,
                                sections: updatedSections,
                                questions: [...(prev.questions || []), ...result.questions]
                              };
                            });
                            // Reload questionnaires to get updated data
                            const allResponse = await fetch(`${API_BASE_URL}/api/questionnaire/all`, {
                              headers: { 'Authorization': `Bearer ${localStorage.getItem('cognitive_dash_token')}` }
                            });
                            if (allResponse.ok) {
                              const allData = await allResponse.json();
                              setAllQuestionnaires(allData || []);
                            }
                            await loadQuestionnaires(selectedProject!.id);
                            
                            // Small delay to allow UI to update before next section
                            await new Promise(resolve => setTimeout(resolve, 200));
                          } else {
                            const error = await response.json();
                            alert(`Failed to parse section ${section.sectionNumber}: ${error.error}`);
                            break; // Stop parsing if there's an error
                          }
                        } catch (error) {
                          console.error('Parse section error:', error);
                          alert(`Failed to parse section ${section.sectionNumber} - please try again`);
                          break; // Stop parsing if there's an error
                        } finally {
                          setParsingSections(prev => {
                            const newSet = new Set(prev);
                            newSet.delete(section.sectionNumber);
                            return newSet;
                          });
                        }
                      }
                    }}
                    disabled={parsingSections.size > 0 || (uploadedQuestionnaire.sections?.every(s => s.parsed) ?? false)}
                    className="px-4 py-2 text-white rounded-md hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed"
                    style={{ backgroundColor: BRAND_ORANGE }}
                  >
                    {parsingSections.size > 0 ? (
                      <span className="flex items-center">
                        <svg className="animate-spin -ml-1 mr-2 h-4 w-4 text-white" fill="none" viewBox="0 0 24 24">
                          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                        </svg>
                        Parsing...
                      </span>
                    ) : (
                      'Parse All Sections'
                    )}
                  </button>
                </div>
                <div className="space-y-3 mb-4">
                  {uploadedQuestionnaire.sections.map((section) => (
                    <div 
                      key={section.sectionNumber} 
                      className="flex items-center justify-between p-3 border border-gray-200 rounded-md hover:bg-gray-50"
                    >
                      <div className="flex-1">
                        <div className="font-medium text-gray-900">
                          Section {section.sectionNumber}: {section.sectionName}
                        </div>
                      </div>
                      <div className="flex items-center">
                        {parsingSections.has(section.sectionNumber) ? (
                          <span className="flex items-center text-sm text-gray-600">
                            <svg className="animate-spin -ml-1 mr-2 h-4 w-4" fill="none" viewBox="0 0 24 24" style={{ color: BRAND_ORANGE }}>
                              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                            </svg>
                            Parsing...
                          </span>
                        ) : section.parsed ? (
                          <span className="text-sm text-green-600 font-medium">
                            ✓ Parsed ({section.questions?.length || 0} questions)
                          </span>
                        ) : (
                          <span className="text-sm text-gray-400">
                            Pending
                          </span>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
                <div className="flex justify-end gap-3 mt-6 pt-4 border-t">
                  <button
                    onClick={() => {
                      setShowUploadModal(false);
                      setUploadedQuestionnaire(null);
                      setUploadSuccess(false);
                      setUploading(false);
                      setQuestionnaireName('');
                      if (fileInputRef.current) {
                        fileInputRef.current.value = '';
                      }
                      // Reload questionnaires to get the latest data
                      loadQuestionnaires(selectedProject!.id);
                    }}
                    className="px-4 py-2 text-white rounded-md hover:opacity-90"
                    style={{ backgroundColor: BRAND_ORANGE }}
                  >
                    Done
                  </button>
                </div>
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
                      setFileValidation(null);
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
                      className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-[#D14A2D]"
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
                      onChange={handleFileChange}
                      className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-[#D14A2D]"
                      disabled={uploading || validatingFile}
                    />
                    {validatingFile && (
                      <p className="mt-2 text-sm text-gray-500">Validating file...</p>
                    )}
                    {fileValidation && (
                      <div className={`mt-3 p-3 rounded-md ${fileValidation.isValid ? 'bg-green-50 border border-green-200' : 'bg-red-50 border border-red-200'}`}>
                        <div className="text-sm">
                          <div className="font-medium mb-2" style={{ color: fileValidation.isValid ? '#16a34a' : '#dc2626' }}>
                            {fileValidation.isValid ? '✓ File is valid' : '✗ File is too large'}
                          </div>
                          {fileValidation.fileSize && (
                            <div className="text-gray-700 mb-1">
                              File size: {(fileValidation.fileSize / 1024).toFixed(2)} KB
                            </div>
                          )}
                          {fileValidation.textLength && (
                            <div className="text-gray-700 mb-1">
                              Text length: {fileValidation.textLength.toLocaleString()} characters
                              {fileValidation.maxTextLength && (
                                <span className="text-gray-500"> / {fileValidation.maxTextLength.toLocaleString()} max</span>
                              )}
                            </div>
                          )}
                          {fileValidation.estimatedInputTokens && (
                            <div className="text-gray-700 mb-1">
                              Estimated input tokens: {fileValidation.estimatedInputTokens.toLocaleString()}
                            </div>
                          )}
                          {fileValidation.estimatedOutputTokens && (
                            <div className="text-gray-700 mb-1">
                              Estimated output tokens: {fileValidation.estimatedOutputTokens.toLocaleString()}
                              {fileValidation.maxOutputTokens && (
                                <span className="text-gray-500"> / {fileValidation.maxOutputTokens.toLocaleString()} max</span>
                              )}
                            </div>
                          )}
                          {fileValidation.message && (
                            <div className="mt-2 text-xs" style={{ color: fileValidation.isValid ? '#16a34a' : '#dc2626' }}>
                              {fileValidation.message}
                            </div>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                </div>
                {fileValidation && (
                  <div className="flex justify-end gap-3 mt-6">
                    <button
                      onClick={() => {
                        setShowUploadModal(false);
                        setUploadSuccess(false);
                        setUploading(false);
                        setQuestionnaireName('');
                        setFileValidation(null);
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
                      className="px-4 py-2 text-white rounded-md hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed"
                      style={{ backgroundColor: BRAND_ORANGE }}
                      disabled={uploading || !fileValidation.isValid}
                    >
                      Upload
                    </button>
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// Helper function to parse terminate logic and extract option codes that trigger termination
// Only works for single-select and multi-select questions
function parseTerminateLogic(terminateLogic: string | { optionCodes: string[] } | undefined, options: Array<string | { code: string; text: string }>, questionType?: string): Set<string> {
  const terminateCodes = new Set<string>();
  
  if (!terminateLogic || !options || options.length === 0) {
    return terminateCodes;
  }

  // Only parse structured terminate logic for single-select and multi-select questions
  const typeLower = questionType?.toLowerCase() || '';
  const isSingleOrMultiSelect = typeLower.includes('single select') || 
                                 typeLower.includes('multi-select') || 
                                 typeLower.includes('multi select') ||
                                 (!typeLower.includes('grid') && !typeLower.includes('numeric') && !typeLower.includes('open end'));

  // If terminateLogic is a structured object with optionCodes, use it directly (only for single/multi-select)
  if (isSingleOrMultiSelect && typeof terminateLogic === 'object' && terminateLogic !== null && 'optionCodes' in terminateLogic) {
    terminateLogic.optionCodes.forEach(code => {
      terminateCodes.add(String(code));
    });
    return terminateCodes;
  }

  // Otherwise, parse from string (fallback for complex logic or legacy format)
  const logicString = typeof terminateLogic === 'string' ? terminateLogic : JSON.stringify(terminateLogic);
  
  // Extract option codes from options array
  const optionCodes = options.map((opt, idx) => {
    if (typeof opt === 'string') {
      return String(idx + 1);
    }
    return opt.code || String(idx + 1);
  });

  // Pattern 1: "option 1, 2, 3, or 4" or "options 1, 2, 3, or 4"
  const listPattern = /option[s]?\s+(\d+(?:\s*,\s*\d+)*(?:\s+or\s+\d+)?)/gi;
  let match;
  while ((match = listPattern.exec(logicString)) !== null) {
    const numbers = match[1].split(/[,]|\s+or\s+/i).map(n => n.trim()).filter(n => n);
    numbers.forEach(num => {
      const code = String(parseInt(num));
      if (optionCodes.includes(code)) {
        terminateCodes.add(code);
      }
    });
  }

  // Pattern 2: "option 1-4" or "options 1-4"
  const rangePattern = /option[s]?\s+(\d+)\s*-\s*(\d+)/gi;
  while ((match = rangePattern.exec(logicString)) !== null) {
    const start = parseInt(match[1]);
    const end = parseInt(match[2]);
    for (let i = start; i <= end; i++) {
      const code = String(i);
      if (optionCodes.includes(code)) {
        terminateCodes.add(code);
      }
    }
  }

  // Pattern 3: "if option 1, 2, 3, or 4 is selected"
  const ifPattern = /if\s+option[s]?\s+(\d+(?:\s*,\s*\d+)*(?:\s+or\s+\d+)?)/gi;
  while ((match = ifPattern.exec(logicString)) !== null) {
    const numbers = match[1].split(/[,]|\s+or\s+/i).map(n => n.trim()).filter(n => n);
    numbers.forEach(num => {
      const code = String(parseInt(num));
      if (optionCodes.includes(code)) {
        terminateCodes.add(code);
      }
    });
  }

  // Pattern 4: Direct code mentions like "option 1" or "option 2"
  optionCodes.forEach(code => {
    const codeRegex = new RegExp(`\\boption[s]?\\s+${code}\\b`, 'i');
    if (codeRegex.test(logicString)) {
      terminateCodes.add(code);
    }
  });

  return terminateCodes;
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
  const [isEditing, setIsEditing] = useState(false);
  const [isFlipping, setIsFlipping] = useState(false);
  const [editedQuestionNumber, setEditedQuestionNumber] = useState<string>('');
  const [editedQuestionText, setEditedQuestionText] = useState<string>('');
  const [editedType, setEditedType] = useState<string>('');
  const [editedOptions, setEditedOptions] = useState<Array<{ code: string; text: string }>>([]);
  const [editedResponseOptions, setEditedResponseOptions] = useState<Array<{ code: string; text: string }>>([]);
  const [editedStatementOptions, setEditedStatementOptions] = useState<Array<{ code: string; text: string }>>([]);
  const [editedRandomize, setEditedRandomize] = useState<boolean>(false);
  const [editedTerminateLogic, setEditedTerminateLogic] = useState<string>('');
  const [isRawAiOutputCollapsed, setIsRawAiOutputCollapsed] = useState<boolean>(true);
  
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

      if (response.ok) {
        setIsFlipping(false);
        // Notify Tabs page to reload questionnaire data
        window.dispatchEvent(new CustomEvent('questionnaireUpdated', { detail: { questionnaireId } }));
      } else {
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

  // Helper function to determine what fields are needed for a question type
  const getFieldsForType = (type: string) => {
    const typeLower = type?.toLowerCase() || '';
    return {
      needsOptions: typeLower.includes('single select') && !typeLower.includes('grid') ||
                    typeLower.includes('multi-select') && !typeLower.includes('grid'),
      needsStatementOptions: typeLower.includes('grid'),
      needsResponseOptions: typeLower.includes('grid') ||
                            typeLower.includes('open end list') ||
                            typeLower.includes('numeric list') ||
                            (typeLower.includes('open end') && !typeLower.includes('list')) // Open End can have opt-out options
    };
  };

  // Validate question type rules
  const validateQuestionType = (q: Question): string | null => {
    const typeLower = q.type?.toLowerCase().trim() || '';

    // Check what actually exists in the data (not filtered by what should be there)
    const hasResponseOptions = q.responseOptions && q.responseOptions.length > 0;
    const hasStatementOptions = q.statementOptions && q.statementOptions.length > 0;
    const hasOptions = q.options && q.options.length > 0;

    // Numeric (plain) - should NOT have responseOptions or options
    // Must check this BEFORE the includes checks to avoid false matches
    if (typeLower === 'numeric' || (typeLower.includes('numeric') && !typeLower.includes('list') && !typeLower.includes('grid'))) {
      if (hasResponseOptions || hasOptions) {
        return 'Numeric questions should not have response options (single response box only)';
      }
    }

    // Numeric List - no validation (can have responseOptions or options)
    // Removed validation error for numeric list questions

    // Numeric Grid - SHOULD have both statementOptions AND responseOptions
    if (typeLower.includes('numeric grid')) {
      if (!hasStatementOptions) {
        return 'Numeric Grid questions must have statement options (rows)';
      }
      if (!hasResponseOptions) {
        return 'Numeric Grid questions must have response options (columns)';
      }
    }

    // Single Select Grid / Multi-Select Grid - SHOULD have both statementOptions AND responseOptions
    if ((typeLower.includes('single select grid') || typeLower.includes('multi-select grid')) && typeLower.includes('grid')) {
      if (!hasStatementOptions) {
        return `${q.type} questions must have statement options (rows)`;
      }
      if (!hasResponseOptions) {
        return `${q.type} questions must have response options (columns)`;
      }
    }

    // Open End List - SHOULD have responseOptions
    if (typeLower.includes('open end list')) {
      if (!hasResponseOptions) {
        return 'Open End List questions must have response options (one per text box)';
      }
    }

    // Single Select / Multi-Select (not grid) - SHOULD have options
    if ((typeLower.includes('single select') || typeLower.includes('multi-select')) && !typeLower.includes('grid')) {
      if (!hasOptions) {
        return `${q.type} questions must have response options`;
      }
    }

    return null; // No errors
  };

  // Initialize edit mode with current question data
  const handleStartEdit = () => {
    setEditedQuestionNumber(question.number || `Q${index + 1}`);
    setEditedQuestionText(question.text || '');
    setEditedType(question.type || '');
    
    // Initialize options
    const options = question.options?.map((opt, idx) => 
      typeof opt === 'string' ? { code: String(idx + 1), text: opt } : { code: opt.code || String(idx + 1), text: opt.text || '' }
    ) || [];
    setEditedOptions(options);
    
    // Initialize response options
    const isNumericGrid = question.type?.toLowerCase().includes('numeric grid');
    if (isNumericGrid && question.statementOptions && question.statementOptions.length > 0) {
      const statementOptions = question.statementOptions.map((opt, idx) => {
        const stmtOpt = typeof opt === 'string' ? { code: `r${idx + 1}`, text: opt } : { code: opt.code || `r${idx + 1}`, text: opt.text || '' };
        let numericCode = stmtOpt.code.replace(/^[rc]/i, '');
        if (!numericCode || numericCode.trim() === '') {
          numericCode = String(idx + 1);
        }
        return { code: numericCode, text: stmtOpt.text || '' };
      });
      setEditedStatementOptions(statementOptions);
    } else if (question.statementOptions && question.statementOptions.length > 0) {
      const statementOptions = question.statementOptions.map((opt, idx) => {
        const stmtOpt = typeof opt === 'string' ? { code: `r${idx + 1}`, text: opt } : { code: opt.code || `r${idx + 1}`, text: opt.text || '' };
        let numericCode = stmtOpt.code.replace(/^[rc]/i, '');
        if (!numericCode || numericCode.trim() === '') {
          numericCode = String(idx + 1);
        }
        return { code: numericCode, text: stmtOpt.text || '' };
      });
      setEditedStatementOptions(statementOptions);
    } else {
      setEditedStatementOptions([]);
    }
    
    // Initialize response options
    const responseOptions = question.responseOptions?.map((opt, idx) => {
      const respOpt = typeof opt === 'string' ? { code: `c${idx + 1}`, text: opt } : { code: opt.code || `c${idx + 1}`, text: opt.text || '' };
      let numericCode = respOpt.code.replace(/^[rc]/i, '');
      if (!numericCode || numericCode.trim() === '') {
        numericCode = String(idx + 1);
      }
      return { code: numericCode, text: respOpt.text || '' };
    }) || [];
    setEditedResponseOptions(responseOptions);
    
    // Initialize randomize
    setEditedRandomize(question.randomize || false);

    // Initialize terminate logic
    if (typeof question.terminateLogic === 'string') {
      setEditedTerminateLogic(question.terminateLogic);
    } else if (question.terminateLogic && Array.isArray(question.terminateLogic.optionCodes)) {
      setEditedTerminateLogic(question.terminateLogic.optionCodes.join(', '));
    } else {
      setEditedTerminateLogic('');
    }

    setIsEditing(true);
  };

  // Handle type change - initialize fields based on new type
  const handleTypeChange = (newType: string) => {
    setEditedType(newType);
    const fields = getFieldsForType(newType);
    
    // Initialize options if needed
    if (fields.needsOptions && editedOptions.length === 0) {
      setEditedOptions([{ code: '1', text: '' }]);
    } else if (!fields.needsOptions) {
      setEditedOptions([]);
    }
    
    // Initialize statement options if needed (for grid questions)
    if (fields.needsStatementOptions && editedStatementOptions.length === 0) {
      setEditedStatementOptions([{ code: '1', text: '' }]);
    } else if (!fields.needsStatementOptions) {
      setEditedStatementOptions([]);
    }
    
    // Initialize response options if needed
    if (fields.needsResponseOptions && editedResponseOptions.length === 0) {
      setEditedResponseOptions([{ code: '1', text: '' }]);
    } else if (!fields.needsResponseOptions && !fields.needsStatementOptions) {
      // Only clear if not a grid (grids need response options)
      setEditedResponseOptions([]);
    }
  };

  // Cancel edit mode
  const handleCancelEdit = () => {
    setIsEditing(false);
    setEditedQuestionNumber('');
    setEditedQuestionText('');
    setEditedType('');
    setEditedOptions([]);
    setEditedResponseOptions([]);
    setEditedStatementOptions([]);
    setEditedRandomize(false);
  };

  // Delete question
  const handleDeleteQuestion = async () => {
    if (!questionnaireId || !onUpdateQuestion) return;
    
    if (!confirm(`Are you sure you want to delete question ${question.number}?`)) {
      return;
    }

    try {
      // Fetch current questionnaire
      const response = await fetch(`${API_BASE_URL}/api/questionnaire/${questionnaireId}`, {
        headers: { 'Authorization': `Bearer ${localStorage.getItem('cognitive_dash_token')}` }
      });
      
      if (response.ok) {
        const questionnaire = await response.json();
        // Remove the question from the questions array
        const updatedQuestions = questionnaire.questions.filter((q: Question) => (q.number || q.id) !== (question.number || question.id));
        
        // Update on backend
        const updateResponse = await fetch(`${API_BASE_URL}/api/questionnaire/${questionnaireId}`, {
          method: 'PUT',
          headers: {
            'Authorization': `Bearer ${localStorage.getItem('cognitive_dash_token')}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            ...questionnaire,
            questions: updatedQuestions
          })
        });
        
        if (updateResponse.ok) {
          // Update parent component by calling onUpdateQuestion with the updated questions
          // This will trigger a re-render with the question removed
          const updatedQnr = { ...questionnaire, questions: updatedQuestions };
          onUpdateQuestion(updatedQnr.questions.find((q: Question) => (q.number || q.id) === (question.number || question.id)) || question);
          // Notify parent to reload questionnaire data
          window.dispatchEvent(new CustomEvent('questionnaireUpdated', { detail: { questionnaireId } }));
          // Reload to reflect the deletion in the UI
          window.location.reload();
        }
      }
    } catch (error) {
      console.error('Error deleting question:', error);
      alert('Failed to delete question. Please try again.');
    }
  };

  // Save all changes
  const handleSaveAll = async () => {
    if (!onUpdateQuestion || !questionnaireId) return;

    // Validate duplicate codes in options
    if (editedOptions.length > 0) {
      const codes = editedOptions.map(opt => opt.code.trim().toLowerCase()).filter(code => code);
      const duplicateCodes = codes.filter((code, index) => codes.indexOf(code) !== index);
      if (duplicateCodes.length > 0) {
        alert('Duplicate codes are not allowed in response options. Please ensure each code is unique.');
        return;
      }
    }

    // Validate duplicate codes in response options
    if (editedResponseOptions.length > 0) {
      const responseCodes = editedResponseOptions.map(opt => opt.code.trim().toLowerCase()).filter(code => code);
      const duplicateResponseCodes = responseCodes.filter((code, index) => responseCodes.indexOf(code) !== index);
      if (duplicateResponseCodes.length > 0) {
        alert('Duplicate codes are not allowed within response options. Please ensure each response code is unique.');
        return;
      }
    }

    // Validate duplicate codes in statement options
    if (editedStatementOptions.length > 0) {
      const statementCodes = editedStatementOptions.map(opt => opt.code.trim().toLowerCase()).filter(code => code);
      const duplicateStatementCodes = statementCodes.filter((code, index) => statementCodes.indexOf(code) !== index);
      if (duplicateStatementCodes.length > 0) {
        alert('Duplicate codes are not allowed within statements. Please ensure each statement code is unique.');
        return;
      }
    }

    const isNumericGrid = editedType?.toLowerCase().includes('numeric grid');
    const fields = getFieldsForType(editedType);

    // Build updated question
    const updatedQuestion: Question = {
      ...question,
      number: editedQuestionNumber.trim(),
      text: editedQuestionText.trim(),
      type: editedType,
      // Only include options if the type needs them (Single Select, Multi-Select)
      // Plain Numeric questions should NOT have options
      options: fields.needsOptions && editedOptions.length > 0
        ? editedOptions.map(opt => ({
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
        : fields.needsOptions
          ? []
          : undefined,
      // Only include responseOptions if the type needs them (Numeric Grid, Numeric List, Open End List)
      // Plain Numeric questions should NOT have responseOptions
      responseOptions: fields.needsResponseOptions && editedResponseOptions.length > 0
        ? editedResponseOptions.map(opt => ({
            code: `c${opt.code}`,
            text: opt.text
          }))
        : fields.needsResponseOptions
          ? []
          : undefined,
      // Only include statementOptions if the type needs them (all grid types)
      statementOptions: fields.needsStatementOptions && editedStatementOptions.length > 0
        ? editedStatementOptions.map(opt => ({
            code: `r${opt.code}`,
            text: opt.text
          }))
        : fields.needsStatementOptions
          ? []
          : undefined,
      randomize: editedRandomize,
      terminateLogic: editedTerminateLogic.trim()
        ? { optionCodes: editedTerminateLogic.split(',').map(c => c.trim()).filter(Boolean) }
        : undefined
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
        setIsEditing(false);
        // Notify Tabs page to reload questionnaire data
        window.dispatchEvent(new CustomEvent('questionnaireUpdated', { detail: { questionnaireId } }));
      } else {
        alert('Failed to save changes. Please try again.');
      }
    } catch (error) {
      console.error('Error saving question:', error);
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
    <div className="border border-gray-200 rounded-lg p-4 bg-white relative" data-question-number={question.number || `Q${index + 1}`}>
      {isEditing ? (
        // Edit Mode
        <div className="space-y-4">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-medium text-gray-700">Q#:</span>
            <input
              type="text"
              value={editedQuestionNumber}
              onChange={(e) => setEditedQuestionNumber(e.target.value)}
              className="px-2 py-1 text-sm border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-[#D14A2D]"
              placeholder="Q1"
            />
            <span className="text-sm font-medium text-gray-700">Type:</span>
            <select
              value={editedType}
              onChange={(e) => handleTypeChange(e.target.value)}
              className="px-2 py-1 text-sm border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-[#D14A2D]"
            >
              <option value="">Select type...</option>
              <option value="Single Select">Single Select</option>
              <option value="Multi-Select">Multi-Select</option>
              <option value="Numeric">Numeric</option>
              <option value="Numeric Grid">Numeric Grid</option>
              <option value="Single Select Grid">Single Select Grid</option>
              <option value="Multi-Select Grid">Multi-Select Grid</option>
              <option value="Open End">Open End</option>
              <option value="Open End List">Open End List</option>
              <option value="Numeric List">Numeric List</option>
            </select>
            {(() => {
              const fields = getFieldsForType(editedType);
              const tempQuestion: Question = {
                ...question,
                type: editedType,
                // Only include options if the type needs them
                options: fields.needsOptions ? (editedOptions.length > 0 ? editedOptions : question.options) : [],
                // Only include responseOptions if the type needs them
                responseOptions: fields.needsResponseOptions
                  ? (editedResponseOptions.length > 0 ? editedResponseOptions.map(opt => ({ code: `c${opt.code}`, text: opt.text })) : question.responseOptions)
                  : undefined,
                // Only include statementOptions if the type needs them
                statementOptions: fields.needsStatementOptions
                  ? (editedStatementOptions.length > 0 ? editedStatementOptions.map(opt => ({ code: `r${opt.code}`, text: opt.text })) : question.statementOptions)
                  : undefined
              };
              const validationError = validateQuestionType(tempQuestion);
              return validationError ? (
                <div className="relative group">
                  <InformationCircleIcon className="w-4 h-4 text-red-600 cursor-help flex-shrink-0" />
                  <div className="absolute left-0 top-6 hidden group-hover:block z-50 w-64 p-2 bg-red-600 text-white text-xs rounded shadow-lg">
                    {validationError}
                  </div>
                </div>
              ) : null;
            })()}
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Question Text:</label>
            <textarea
              value={editedQuestionText}
              onChange={(e) => setEditedQuestionText(e.target.value)}
              className="w-full px-3 py-2 text-sm border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-[#D14A2D] resize-none"
              rows={3}
              placeholder="Enter question text..."
            />
          </div>

          {/* Response Options (for Single Select, Multi-Select) */}
          {(() => {
            const fields = getFieldsForType(editedType);
            const optionsToShow = fields.needsOptions && editedOptions.length === 0 ? [{ code: '1', text: '' }] : editedOptions;
            return fields.needsOptions && (
              <div>
                <div className="flex items-center justify-between mb-2">
                  <label className="block text-sm font-medium text-gray-700">Response Options:</label>
                  <button
                    onClick={() => {
                      const currentOptions = editedOptions.length === 0 ? [{ code: '1', text: '' }] : editedOptions;
                      const newCode = String(currentOptions.length + 1);
                      setEditedOptions([...currentOptions, { code: newCode, text: '' }]);
                    }}
                    className="px-2 py-1 text-xs font-medium"
                    style={{ color: BRAND_ORANGE }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.color = '#B83D25';
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.color = BRAND_ORANGE;
                    }}
                  >
                    + Add Option
                  </button>
                </div>
              <div className="space-y-2">
                {optionsToShow.map((opt, optIndex) => {
                  const codes = optionsToShow.map(o => o.code.trim().toLowerCase()).filter(c => c);
                  const isDuplicate = codes.filter((c, idx) => codes.indexOf(c) !== idx).includes(opt.code.trim().toLowerCase());
                  
                  const { hasExclusive, hasAnchor, hasSpecify } = parseOptionTags(opt.text);
                  // Parse edited terminate logic to check if this option is marked for termination
                  const editedTerminateCodes = editedTerminateLogic.split(',').map(c => c.trim()).filter(Boolean);
                  const hasTerminate = editedTerminateCodes.includes(opt.code);

                  return (
                    <div key={optIndex} className="flex items-center gap-2">
                      <input
                        type="text"
                        value={opt.code}
                        onChange={(e) => {
                          const currentOptions = editedOptions.length === 0 ? [{ code: '1', text: '' }] : editedOptions;
                          const updated = [...currentOptions];
                          updated[optIndex] = { ...updated[optIndex], code: e.target.value };
                          setEditedOptions(updated);
                        }}
                        className={`w-12 px-2 py-1 text-xs font-mono border rounded focus:outline-none focus:ring-2 focus:ring-[#D14A2D] ${
                          isDuplicate ? 'border-red-500 focus:ring-red-500' : 'border-gray-300 focus:ring-2 focus:ring-[#D14A2D]'
                        }`}
                        placeholder="Code"
                      />
                      <input
                        type="text"
                        value={opt.text}
                        onChange={(e) => {
                          const currentOptions = editedOptions.length === 0 ? [{ code: '1', text: '' }] : editedOptions;
                          const updated = [...currentOptions];
                          updated[optIndex] = { ...updated[optIndex], text: e.target.value };
                          setEditedOptions(updated);
                        }}
                        className="flex-1 px-2 py-1 text-xs border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-[#D14A2D]"
                        placeholder="Text"
                      />
                      <button
                        onClick={() => {
                          const currentOptions = editedOptions.length === 0 ? [{ code: '1', text: '' }] : editedOptions;
                          const updated = [...currentOptions];
                          updated[optIndex] = { ...updated[optIndex], text: toggleOptionTag(opt.text, 'EXCLUSIVE', !hasExclusive) };
                          setEditedOptions(updated);
                        }}
                        className={`text-xs font-bold rounded inline-flex items-center justify-center w-5 h-5 ${
                          hasExclusive ? 'bg-blue-100 text-blue-800' : 'bg-gray-200 text-gray-500'
                        }`}
                        title="Toggle Exclusive"
                      >
                        E
                      </button>
                      <button
                        onClick={() => {
                          const currentOptions = editedOptions.length === 0 ? [{ code: '1', text: '' }] : editedOptions;
                          const updated = [...currentOptions];
                          updated[optIndex] = { ...updated[optIndex], text: toggleOptionTag(opt.text, 'ANCHOR', !hasAnchor) };
                          setEditedOptions(updated);
                        }}
                        className={`text-xs font-bold rounded inline-flex items-center justify-center w-5 h-5 ${
                          hasAnchor ? 'bg-blue-100 text-blue-800' : 'bg-gray-200 text-gray-500'
                        }`}
                        title="Toggle Anchor"
                      >
                        A
                      </button>
                      <button
                        onClick={() => {
                          const currentOptions = editedOptions.length === 0 ? [{ code: '1', text: '' }] : editedOptions;
                          const updated = [...currentOptions];
                          updated[optIndex] = { ...updated[optIndex], text: toggleOptionTag(opt.text, 'SPECIFY', !hasSpecify) };
                          setEditedOptions(updated);
                        }}
                        className={`text-xs font-bold rounded inline-flex items-center justify-center w-5 h-5 ${
                          hasSpecify ? 'bg-blue-100 text-blue-800' : 'bg-gray-200 text-gray-500'
                        }`}
                        title="Toggle Specify"
                      >
                        S
                      </button>
                      <button
                        onClick={() => {
                          // Toggle terminate logic using edited state
                          let newTerminateCodes = editedTerminateLogic.split(',').map(c => c.trim()).filter(Boolean);

                          if (hasTerminate) {
                            // Remove this code
                            newTerminateCodes = newTerminateCodes.filter(c => c !== opt.code);
                          } else {
                            // Add this code
                            if (!newTerminateCodes.includes(opt.code)) {
                              newTerminateCodes.push(opt.code);
                            }
                          }

                          // Update terminate logic
                          setEditedTerminateLogic(newTerminateCodes.length > 0 ? newTerminateCodes.join(', ') : '');
                        }}
                        className={`text-xs font-bold rounded inline-flex items-center justify-center w-5 h-5 ${
                          hasTerminate ? 'bg-red-100 text-red-800' : 'bg-gray-200 text-gray-500'
                        }`}
                        title="Toggle Terminate"
                      >
                        T
                      </button>
                      <button
                        onClick={() => {
                          const currentOptions = editedOptions.length === 0 ? [{ code: '1', text: '' }] : editedOptions;
                          const updated = [...currentOptions];
                          updated.splice(optIndex, 1);
                          // If this was the last option and type requires options, keep at least one empty
                          const fields = getFieldsForType(editedType);
                          if (updated.length === 0 && fields.needsOptions) {
                            setEditedOptions([{ code: '1', text: '' }]);
                          } else {
                            setEditedOptions(updated);
                          }
                        }}
                        className="px-2 py-1 text-red-600 hover:text-red-700"
                        title="Remove option"
                      >
                        <XMarkIcon className="w-4 h-4" />
                      </button>
                    </div>
                  );
                })}
              </div>
            </div>
            );
          })()}

          {/* Statement Options (for grid questions) */}
          {(() => {
            const fields = getFieldsForType(editedType);
            const statementsToShow = fields.needsStatementOptions && editedStatementOptions.length === 0 ? [{ code: '1', text: '' }] : editedStatementOptions;
            return fields.needsStatementOptions && (
              <div>
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-end gap-2">
                    <label className="block text-sm font-medium text-gray-700">Statement Options (Rows):</label>
                    <button
                      onClick={() => setEditedRandomize(!editedRandomize)}
                      className={`text-[10px] px-1.5 py-0.5 rounded ${
                        editedRandomize ? 'bg-blue-100 text-blue-800' : 'bg-gray-200 text-gray-600'
                      }`}
                      title="Toggle randomize rows"
                    >
                      RANDOMIZE
                    </button>
                  </div>
                  <button
                    onClick={() => {
                      const currentStatements = editedStatementOptions.length === 0 ? [{ code: '1', text: '' }] : editedStatementOptions;
                      const newCode = String(currentStatements.length + 1);
                      setEditedStatementOptions([...currentStatements, { code: newCode, text: '' }]);
                    }}
                    className="px-2 py-1 text-xs font-medium"
                    style={{ color: BRAND_ORANGE }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.color = '#B83D25';
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.color = BRAND_ORANGE;
                    }}
                  >
                    + Add Statement
                  </button>
                </div>
              <div className="space-y-2">
                {statementsToShow.map((stmtOpt, stmtIndex) => {
                  const codes = statementsToShow.map(o => o.code.trim().toLowerCase()).filter(c => c);
                  const isDuplicate = codes.filter((c, idx) => codes.indexOf(c) !== idx).includes(stmtOpt.code.trim().toLowerCase());
                  
                  return (
                    <div key={stmtIndex} className="flex items-center gap-2">
                      <input
                        type="text"
                        value={stmtOpt.code}
                        onChange={(e) => {
                          const currentStatements = editedStatementOptions.length === 0 ? [{ code: '1', text: '' }] : editedStatementOptions;
                          const updated = [...currentStatements];
                          updated[stmtIndex] = { ...updated[stmtIndex], code: e.target.value };
                          setEditedStatementOptions(updated);
                        }}
                        className={`w-12 px-2 py-1 text-xs font-mono border rounded focus:outline-none focus:ring-2 focus:ring-[#D14A2D] ${
                          isDuplicate ? 'border-red-500 focus:ring-red-500' : 'border-gray-300 focus:ring-2 focus:ring-[#D14A2D]'
                        }`}
                        placeholder="Code"
                      />
                      <input
                        type="text"
                        value={stmtOpt.text}
                        onChange={(e) => {
                          const currentStatements = editedStatementOptions.length === 0 ? [{ code: '1', text: '' }] : editedStatementOptions;
                          const updated = [...currentStatements];
                          updated[stmtIndex] = { ...updated[stmtIndex], text: e.target.value };
                          setEditedStatementOptions(updated);
                        }}
                        className="flex-1 px-2 py-1 text-xs border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-[#D14A2D]"
                        placeholder="Text"
                      />
                      <button
                        onClick={() => {
                          const currentStatements = editedStatementOptions.length === 0 ? [{ code: '1', text: '' }] : editedStatementOptions;
                          const updated = [...currentStatements];
                          updated.splice(stmtIndex, 1);
                          // If this was the last statement and type requires statements, keep at least one empty
                          const fields = getFieldsForType(editedType);
                          if (updated.length === 0 && fields.needsStatementOptions) {
                            setEditedStatementOptions([{ code: '1', text: '' }]);
                          } else {
                            setEditedStatementOptions(updated);
                          }
                        }}
                        className="px-2 py-1 text-red-600 hover:text-red-700"
                        title="Remove statement"
                      >
                        <XMarkIcon className="w-4 h-4" />
                      </button>
                    </div>
                  );
                })}
              </div>
            </div>
            );
          })()}

          {/* Flip Options button (only for grid questions in edit mode) */}
          {canFlip && (() => {
            const fields = getFieldsForType(editedType);
            return fields.needsStatementOptions && fields.needsResponseOptions && (
              <div>
                <button
                  onClick={handleFlipOptions}
                  disabled={isFlipping}
                  className="flex items-center gap-1 px-3 py-1 text-xs font-medium text-gray-700 bg-gray-100 hover:bg-gray-200 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                  title="Flip statement options and response options"
                >
                  <ArrowPathIcon className={`w-4 h-4 ${isFlipping ? 'animate-spin' : ''}`} />
                  Flip Options
                </button>
              </div>
            );
          })()}

          {/* Response Options (for grid questions, open end list, numeric list) */}
          {(() => {
            const fields = getFieldsForType(editedType);
            const responsesToShow = fields.needsResponseOptions && editedResponseOptions.length === 0 ? [{ code: '1', text: '' }] : editedResponseOptions;
            const isOpenEnd = editedType?.toLowerCase().includes('open end') && !editedType?.toLowerCase().includes('list');
            return fields.needsResponseOptions && (
              <div>
                <div className="flex items-center justify-between mb-2">
                  <label className="block text-sm font-medium text-gray-700">
                    {isOpenEnd ? 'Opt-out Options:' : fields.needsStatementOptions ? 'Response Options (Columns):' : 'Response Options:'}
                  </label>
                  <button
                    onClick={() => {
                      const currentResponses = editedResponseOptions.length === 0 ? [{ code: '1', text: '' }] : editedResponseOptions;
                      const newCode = String(currentResponses.length + 1);
                      setEditedResponseOptions([...currentResponses, { code: newCode, text: '' }]);
                    }}
                    className="px-2 py-1 text-xs font-medium"
                    style={{ color: BRAND_ORANGE }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.color = '#B83D25';
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.color = BRAND_ORANGE;
                    }}
                  >
                    {isOpenEnd ? '+ Add Opt-out Option' : '+ Add Response Option'}
                  </button>
                </div>
              <div className="space-y-2">
                {responsesToShow.map((respOpt, respIndex) => {
                  const codes = responsesToShow.map(o => o.code.trim().toLowerCase()).filter(c => c);
                  const isDuplicate = codes.filter((c, idx) => codes.indexOf(c) !== idx).includes(respOpt.code.trim().toLowerCase());
                  
                  const { hasExclusive, hasAnchor, hasSpecify } = parseOptionTags(respOpt.text);
                  // Parse edited terminate logic to check if this response option is marked for termination
                  const editedTerminateCodes = editedTerminateLogic.split(',').map(c => c.trim()).filter(Boolean);
                  const respCode = `c${respOpt.code}`;
                  const hasTerminate = editedTerminateCodes.includes(respCode) || editedTerminateCodes.includes(respOpt.code);

                  return (
                    <div key={respIndex} className="flex items-center gap-2">
                      <input
                        type="text"
                        value={respOpt.code}
                        onChange={(e) => {
                          const currentResponses = editedResponseOptions.length === 0 ? [{ code: '1', text: '' }] : editedResponseOptions;
                          const updated = [...currentResponses];
                          updated[respIndex] = { ...updated[respIndex], code: e.target.value };
                          setEditedResponseOptions(updated);
                        }}
                        className={`w-12 px-2 py-1 text-xs font-mono border rounded focus:outline-none focus:ring-2 focus:ring-[#D14A2D] ${
                          isDuplicate ? 'border-red-500 focus:ring-red-500' : 'border-gray-300 focus:ring-2 focus:ring-[#D14A2D]'
                        }`}
                        placeholder="Code"
                      />
                      <input
                        type="text"
                        value={respOpt.text}
                        onChange={(e) => {
                          const currentResponses = editedResponseOptions.length === 0 ? [{ code: '1', text: '' }] : editedResponseOptions;
                          const updated = [...currentResponses];
                          updated[respIndex] = { ...updated[respIndex], text: e.target.value };
                          setEditedResponseOptions(updated);
                        }}
                        className="flex-1 px-2 py-1 text-xs border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-[#D14A2D]"
                        placeholder="Text"
                      />
                      <button
                        onClick={() => {
                          const currentResponses = editedResponseOptions.length === 0 ? [{ code: '1', text: '' }] : editedResponseOptions;
                          const updated = [...currentResponses];
                          updated[respIndex] = { ...updated[respIndex], text: toggleOptionTag(respOpt.text, 'EXCLUSIVE', !hasExclusive) };
                          setEditedResponseOptions(updated);
                        }}
                        className={`text-xs font-bold rounded inline-flex items-center justify-center w-5 h-5 ${
                          hasExclusive ? 'bg-blue-100 text-blue-800' : 'bg-gray-200 text-gray-500'
                        }`}
                        title="Toggle Exclusive"
                      >
                        E
                      </button>
                      <button
                        onClick={() => {
                          const currentResponses = editedResponseOptions.length === 0 ? [{ code: '1', text: '' }] : editedResponseOptions;
                          const updated = [...currentResponses];
                          updated[respIndex] = { ...updated[respIndex], text: toggleOptionTag(respOpt.text, 'ANCHOR', !hasAnchor) };
                          setEditedResponseOptions(updated);
                        }}
                        className={`text-xs font-bold rounded inline-flex items-center justify-center w-5 h-5 ${
                          hasAnchor ? 'bg-blue-100 text-blue-800' : 'bg-gray-200 text-gray-500'
                        }`}
                        title="Toggle Anchor"
                      >
                        A
                      </button>
                      <button
                        onClick={() => {
                          const currentResponses = editedResponseOptions.length === 0 ? [{ code: '1', text: '' }] : editedResponseOptions;
                          const updated = [...currentResponses];
                          updated[respIndex] = { ...updated[respIndex], text: toggleOptionTag(respOpt.text, 'SPECIFY', !hasSpecify) };
                          setEditedResponseOptions(updated);
                        }}
                        className={`text-xs font-bold rounded inline-flex items-center justify-center w-5 h-5 ${
                          hasSpecify ? 'bg-blue-100 text-blue-800' : 'bg-gray-200 text-gray-500'
                        }`}
                        title="Toggle Specify"
                      >
                        S
                      </button>
                      <button
                        onClick={() => {
                          // Toggle terminate logic using edited state
                          let newTerminateCodes = editedTerminateLogic.split(',').map(c => c.trim()).filter(Boolean);
                          const respCode = `c${respOpt.code}`;

                          if (hasTerminate) {
                            // Remove this code (both with and without 'c' prefix)
                            newTerminateCodes = newTerminateCodes.filter(c => c !== respCode && c !== respOpt.code);
                          } else {
                            // Add this code
                            if (!newTerminateCodes.includes(respCode)) {
                              newTerminateCodes.push(respCode);
                            }
                          }

                          // Update terminate logic
                          setEditedTerminateLogic(newTerminateCodes.length > 0 ? newTerminateCodes.join(', ') : '');
                        }}
                        className={`text-xs font-bold rounded inline-flex items-center justify-center w-5 h-5 ${
                          hasTerminate ? 'bg-red-100 text-red-800' : 'bg-gray-200 text-gray-500'
                        }`}
                        title="Toggle Terminate"
                      >
                        T
                      </button>
                      <button
                        onClick={() => {
                          const currentResponses = editedResponseOptions.length === 0 ? [{ code: '1', text: '' }] : editedResponseOptions;
                          const updated = [...currentResponses];
                          updated.splice(respIndex, 1);
                          // If this was the last response and type requires responses, keep at least one empty
                          const fields = getFieldsForType(editedType);
                          if (updated.length === 0 && fields.needsResponseOptions) {
                            setEditedResponseOptions([{ code: '1', text: '' }]);
                          } else {
                            setEditedResponseOptions(updated);
                          }
                        }}
                        className="px-2 py-1 text-red-600 hover:text-red-700"
                        title="Remove response option"
                      >
                        <XMarkIcon className="w-4 h-4" />
                      </button>
                    </div>
                  );
                })}
                  </div>
                </div>
              );
            })()}

          {/* Save/Cancel/Delete Buttons */}
          <div className="flex items-center justify-between pt-2 border-t border-gray-200">
            <div className="flex items-center gap-2">
              <button
                onClick={handleSaveAll}
                className="flex items-center gap-1 px-4 py-2 text-sm font-medium text-white bg-green-600 hover:bg-green-700 rounded transition-colors"
              >
                <CheckIcon className="w-4 h-4" />
                Save
              </button>
              <button
                onClick={handleCancelEdit}
                className="flex items-center gap-1 px-4 py-2 text-sm font-medium text-gray-700 bg-gray-200 hover:bg-gray-300 rounded transition-colors"
              >
                <XMarkIcon className="w-4 h-4" />
                Cancel
              </button>
            </div>
            <button
              onClick={handleDeleteQuestion}
              className="flex items-center gap-1 px-4 py-2 text-sm font-medium text-white bg-red-600 hover:bg-red-700 rounded transition-colors"
            >
              <TrashIcon className="w-4 h-4" />
              Delete Question
            </button>
          </div>
        </div>
      ) : (
        // View Mode
        <>
          {/* Show Logic - left-aligned, with edit button on the right if show logic exists */}
          {question.showLogic ? (
            <div className="flex items-center justify-between mb-2">
              <p className="text-xs italic" style={{ color: '#2563eb' }}>
                {typeof question.showLogic === 'string' 
                  ? question.showLogic 
                  : JSON.stringify(question.showLogic)}
              </p>
              {/* Edit Icon */}
              {!isEditing && (
                <button
                  onClick={handleStartEdit}
                  className="px-2 py-1 text-xs text-gray-600 hover:text-gray-900 hover:bg-gray-100 rounded transition-colors flex items-center justify-center flex-shrink-0"
                  title="Edit question"
                >
                  <PencilIcon className="w-4 h-4" />
                </button>
              )}
            </div>
          ) : (
            /* Edit Icon on question number line if no show logic */
            null
          )}
          {/* Question number, question type pill, needs review, and edit button */}
          <div className="flex items-center gap-2 flex-wrap justify-between mb-1">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-sm font-semibold text-gray-900">{question.number || `Q${index + 1}`}</span>
              {/* Question type pill - blue, right after question number */}
              <div className="flex items-center gap-1">
                <span className="text-xs px-2 py-1 rounded flex-shrink-0 bg-blue-100 text-blue-800" style={{ minWidth: '80px', textAlign: 'center' }}>
                  {question.type || 'other'}
                </span>
                {(() => {
                  const validationError = validateQuestionType(question);
                  return validationError ? (
                    <div className="relative group">
                      <InformationCircleIcon className="w-4 h-4 text-red-600 cursor-help" />
                      <div className="absolute left-0 top-6 hidden group-hover:block z-50 w-64 p-2 bg-red-600 text-white text-xs rounded shadow-lg">
                        {validationError}
                      </div>
                    </div>
                  ) : null;
                })()}
              </div>
              {/* Display metadata tags (Scale, %, Number) as pills - grey, right after question type */}
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
              {question.needsReview && (
                <span className="text-xs px-2 py-1 bg-red-100 text-red-700 rounded">Needs Review</span>
              )}
            </div>
            {/* Edit Icon - only show here if there's no show logic */}
            {!question.showLogic && !isEditing && (
              <button
                onClick={handleStartEdit}
                className="px-2 py-1 text-xs text-gray-600 hover:text-gray-900 hover:bg-gray-100 rounded transition-colors flex items-center justify-center flex-shrink-0"
                title="Edit question"
              >
                <PencilIcon className="w-4 h-4" />
              </button>
            )}
          </div>

          <div className="mb-3">
            <p className="text-sm text-gray-900">{formatDescriptionWithBrackets(question.text)}</p>
          </div>

          {/* Response Options */}
          {question.options && question.options.length > 0 &&
           !(question.type?.toLowerCase() === 'numeric' || (question.type?.toLowerCase().includes('numeric') && !question.type?.toLowerCase().includes('list') && !question.type?.toLowerCase().includes('grid'))) && // Exclude plain Numeric questions
           (() => {
            const terminateCodes = parseTerminateLogic(question.terminateLogic, question.options, question.type);
            return (
              <div className="mb-3">
                <h4 className="text-xs font-medium text-gray-700 mb-2">
                  Response Options:
                </h4>
                <div className="space-y-1">
                  {question.options.map((option, optIndex) => {
                    // Options should already be normalized with codes extracted, but handle both formats
                    let opt: { code: string; text: string; tags?: string[] };
                    if (typeof option === 'string') {
                      opt = { code: String(optIndex + 1), text: option };
                    } else {
                      opt = { 
                        code: option.code || String(optIndex + 1), 
                        text: typeof option.text === 'string' ? option.text : String(option),
                        tags: option.tags
                      };
                    }
                    const shouldTerminate = terminateCodes.has(opt.code || String(optIndex + 1));
                    const { cleanText, hasExclusive, hasAnchor, hasSpecify } = parseOptionTags(opt.text);
                    return (
                      <div key={optIndex} className="flex items-center gap-2 text-sm text-gray-700">
                        <span className="font-mono text-xs text-gray-500 w-8">{opt.code}:</span>
                        <span>{formatDescriptionWithBrackets(cleanText)}</span>
                        {hasExclusive && (
                          <span className="text-xs font-bold bg-blue-100 text-blue-800 rounded ml-0.5 inline-flex items-center justify-center w-5 h-5">E</span>
                        )}
                        {hasAnchor && (
                          <span className="text-xs font-bold bg-blue-100 text-blue-800 rounded ml-0.5 inline-flex items-center justify-center w-5 h-5">A</span>
                        )}
                        {hasSpecify && (
                          <span className="text-xs font-bold bg-blue-100 text-blue-800 rounded ml-0.5 inline-flex items-center justify-center w-5 h-5">S</span>
                        )}
                        {shouldTerminate && (
                          <span className="text-xs font-bold bg-red-100 text-red-800 rounded ml-0.5 inline-flex items-center justify-center w-5 h-5">T</span>
                        )}
                        {opt.tags && opt.tags.length > 0 && (
                          <div className="flex gap-1 ml-2">
                            {opt.tags.map((tag: string, tagIdx: number) => (
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
              </div>
            );
          })()}

          {/* Grid table for numeric grids with both statements and response options */}
          {question.type?.toLowerCase().includes('numeric grid') && 
           question.statementOptions && question.statementOptions.length > 0 && 
           question.responseOptions && question.responseOptions.length > 0 && (
            <div className="mb-3">
              <h4 className="text-xs font-medium text-gray-700 mb-2">Grid Structure:</h4>
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
                          {formatDescriptionWithBrackets(respOpt.text)} ({displayCode})
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
                        <td className="px-4 py-2 text-xs text-gray-900">{formatDescriptionWithBrackets(stmtOpt.text)}</td>
                        {question.responseOptions?.map((resp, respIndex) => {
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
        </div>
      )}

          {/* Statement Options (for grid questions - rows) - only show if not already shown in grid table */}
          {question.statementOptions && question.statementOptions.length > 0 && 
           !(question.type?.toLowerCase().includes('numeric grid') && question.responseOptions && question.responseOptions.length > 0) && (() => {
            const terminateCodes = parseTerminateLogic(question.terminateLogic, question.statementOptions, question.type);
            return (
              <div className="mb-3">
                <div className="flex items-end gap-2 mb-2">
                  <h4 className="text-xs font-medium text-gray-700">
                    Statement Options (Rows):
                  </h4>
                  {question.randomize && (
                    <span className="text-[10px] px-1 py-0 rounded bg-blue-100 text-blue-800">RANDOMIZE</span>
                  )}
                </div>
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
                    const shouldTerminate = terminateCodes.has(stmtOpt.code || defaultCode);
                    return (
                      <div key={stmtIndex} className="flex items-center gap-2 text-sm text-gray-700">
                        <span className="font-mono text-xs text-gray-500 w-8">{stmtOpt.code}:</span>
                        <span>{formatDescriptionWithBrackets(stmtOpt.text)}</span>
                        {shouldTerminate && (
                          <span className="text-[10px] font-bold text-red-600 ml-1">TERM</span>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })()}

          {/* Response Options (for grid questions - column headers/scale) - only show if not already shown in grid table */}
          {question.responseOptions && question.responseOptions.length > 0 &&
           !(question.type?.toLowerCase().includes('numeric grid') && question.statementOptions && question.statementOptions.length > 0) &&
           !(question.type?.toLowerCase() === 'numeric') && // Exclude plain Numeric questions (single response box - no responseOptions)
           (() => {
            const terminateCodes = parseTerminateLogic(question.terminateLogic, question.responseOptions, question.type);
            const isOpenEnd = question.type?.toLowerCase().includes('open end') && !question.type?.toLowerCase().includes('list');
            return (
              <div className="mb-3">
                <h4 className="text-xs font-medium text-gray-700 mb-2">
                  {isOpenEnd ? 'Opt-out Options:' : 'Response Options (Columns):'}
                </h4>
                <div className="space-y-1">
                  {question.responseOptions.map((resp, respIndex) => {
                    const respOpt = typeof resp === 'string'
                      ? { code: `c${respIndex + 1}`, text: resp }
                      : resp;
                    const shouldTerminate = terminateCodes.has(respOpt.code || `c${respIndex + 1}`);
                    const { cleanText, hasExclusive, hasAnchor, hasSpecify } = parseOptionTags(respOpt.text);
                    return (
                      <div key={respIndex} className="flex items-center gap-2 text-sm text-gray-700">
                        <span className="font-mono text-xs text-gray-500 w-8">{respOpt.code}:</span>
                        <span>{formatDescriptionWithBrackets(cleanText)}</span>
                        {hasExclusive && (
                          <span className="text-xs font-bold bg-blue-100 text-blue-800 rounded ml-0.5 inline-flex items-center justify-center w-5 h-5">E</span>
                        )}
                        {hasAnchor && (
                          <span className="text-xs font-bold bg-blue-100 text-blue-800 rounded ml-0.5 inline-flex items-center justify-center w-5 h-5">A</span>
                        )}
                        {hasSpecify && (
                          <span className="text-xs font-bold bg-blue-100 text-blue-800 rounded ml-0.5 inline-flex items-center justify-center w-5 h-5">S</span>
                        )}
                        {shouldTerminate && (
                          <span className="text-xs font-bold bg-red-100 text-red-800 rounded ml-0.5 inline-flex items-center justify-center w-5 h-5">T</span>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })()}

      {/* Logic (only show if there's logic but no showLogic, since showLogic is shown above question number) */}
      {!question.showLogic && question.logic && (
        <div className="mb-3">
          <h4 className="text-xs font-medium text-gray-700 mb-1">Logic:</h4>
          <p className="text-xs text-gray-600 font-mono bg-gray-50 p-2 rounded">
            {typeof question.logic === 'string' 
              ? question.logic 
              : JSON.stringify(question.logic)}
          </p>
        </div>
      )}

      {/* Terminate Logic is now displayed as T badges on individual options, no need for separate section */}

      {/* Misc - Raw AI Output */}
      <div className="mb-3">
        <button
          onClick={() => setIsRawAiOutputCollapsed(!isRawAiOutputCollapsed)}
          className="flex items-center gap-2 text-xs font-medium text-gray-700 mb-1 hover:text-gray-900"
        >
          {isRawAiOutputCollapsed ? (
            <ChevronDownIcon className="w-4 h-4" />
          ) : (
            <ChevronUpIcon className="w-4 h-4" />
          )}
          Raw AI Output:
        </button>
        {!isRawAiOutputCollapsed && (
          <div className="bg-gray-50 p-3 rounded border border-gray-200">
            {question.rawAiOutput ? (
              <pre className="text-xs text-gray-700 font-mono whitespace-pre-wrap overflow-x-auto">
                {question.rawAiOutput}
              </pre>
            ) : (
              <pre className="text-xs text-gray-500 font-mono whitespace-pre-wrap overflow-x-auto italic">
                Raw AI output not available (this question was parsed before raw output storage was added)
              </pre>
            )}
          </div>
        )}
      </div>

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
        </>
      )}
    </div>
  );
}

// Survey Question View Component
function SurveyQuestionView({ 
  question, 
  index,
  onUpdateQuestion,
  questionnaireId
}: { 
  question: Question; 
  index: number;
  onUpdateQuestion?: (question: Question) => Question[];
  questionnaireId?: string;
}) {
  const [isFlipping, setIsFlipping] = useState(false);
  
  const questionType = question.type?.toLowerCase() || '';
  const isSingleSelect = questionType.includes('single select') && !questionType.includes('grid');
  const isMultiSelect = questionType.includes('multi-select') && !questionType.includes('grid');
  const isNumeric = questionType.includes('numeric') && !questionType.includes('grid') && !questionType.includes('list');
  const isNumericGrid = questionType.includes('numeric grid');
  const isSingleSelectGrid = questionType.includes('single select grid');
  const isMultiSelectGrid = questionType.includes('multi-select grid');
  const isOpenEnd = questionType.includes('open end') && !questionType.includes('list');
  const isOpenEndList = questionType.includes('open end list');
  const isNumericList = questionType.includes('numeric list');
  
  
  // Check if question can be flipped (has both statement and response options)
  const canFlip = question.statementOptions && question.statementOptions.length > 0 && 
                  question.responseOptions && question.responseOptions.length > 0;
  
  // Use actual question data (no local flip state - it's persisted)
  const displayStatementOptions = question.statementOptions;
  const displayResponseOptions = question.responseOptions;
  
  // Handle flip options - same logic as QNR view
  const handleFlipOptions = async () => {
    if (!canFlip || !onUpdateQuestion || !questionnaireId) return;

    setIsFlipping(true);
    const originalQuestion = question;
    let updatedQuestions: Question[] = [];

    try {
      // Create updated question with flipped options
      const updatedQuestion: Question = {
        ...question,
        statementOptions: question.responseOptions?.map((opt, idx) => {
          const optObj = typeof opt === 'string' ? { code: `r${idx + 1}`, text: opt } : opt;
          return {
            code: `r${idx + 1}`,
            text: optObj.text
          };
        }),
        responseOptions: question.statementOptions?.map((opt, idx) => {
          const optObj = typeof opt === 'string' ? { code: `c${idx + 1}`, text: opt } : opt;
          return {
            code: `c${idx + 1}`,
            text: optObj.text
          };
        })
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

      if (response.ok) {
        setIsFlipping(false);
        // Notify Tabs page to reload questionnaire data
        window.dispatchEvent(new CustomEvent('questionnaireUpdated', { detail: { questionnaireId } }));
      } else {
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

  // Get options for single/multi-select
  const getOptions = () => {
    if (!question.options) return [];
    return question.options.map((opt, idx) => {
      if (typeof opt === 'string') {
        return { code: String(idx + 1), text: opt };
      }
      return { code: opt.code || String(idx + 1), text: opt.text || '' };
    });
  };

  return (
    <div className="bg-white border border-gray-200 rounded-lg p-6">
      <div className="mb-4">
        <div className="flex items-center justify-between mb-2">
          <div className="text-sm text-gray-500">
            {question.number || `Q${index + 1}`}
          </div>
          {canFlip && (isSingleSelectGrid || isMultiSelectGrid) && (
            <button
              onClick={handleFlipOptions}
              disabled={isFlipping}
              className="flex items-center gap-1 px-3 py-1 text-xs font-medium text-gray-700 bg-gray-100 hover:bg-gray-200 rounded-lg transition-colors flex-shrink-0 disabled:opacity-50 disabled:cursor-not-allowed"
              title="Flip statement options and response options"
            >
              <ArrowPathIcon className={`w-4 h-4 ${isFlipping ? 'animate-spin' : ''}`} />
              Flip Options
            </button>
          )}
        </div>
        <div className="text-base text-gray-900">
          {formatDescriptionWithBrackets(question.text)}
        </div>
      </div>

      {/* Single Select */}
      {isSingleSelect && (
        <div className="space-y-2">
          {getOptions().map((opt, optIdx) => {
            const { cleanText, hasExclusive, hasAnchor, hasSpecify } = parseOptionTags(opt.text || opt.code);
            return (
              <div key={optIdx}>
                <label className="flex items-center gap-3 p-2 hover:bg-gray-50 rounded cursor-pointer">
                  <input
                    type="radio"
                    name={`question-${question.id || index}`}
                    value={opt.code}
                    className="w-4 h-4 focus:ring-2 focus:ring-[#D14A2D]"
                    style={{ accentColor: BRAND_ORANGE }}
                  />
                  <span className="text-sm text-gray-700">{formatDescriptionWithBrackets(cleanText)}</span>
                  {hasExclusive && (
                    <span className="text-xs font-bold bg-blue-100 text-blue-800 rounded ml-0.5 inline-flex items-center justify-center w-5 h-5">E</span>
                  )}
                  {hasAnchor && (
                    <span className="text-xs font-bold bg-blue-100 text-blue-800 rounded ml-0.5 inline-flex items-center justify-center w-5 h-5">A</span>
                  )}
                  {hasSpecify && (
                    <span className="text-xs font-bold bg-blue-100 text-blue-800 rounded ml-0.5 inline-flex items-center justify-center w-5 h-5">S</span>
                  )}
                </label>
                {hasSpecify && (
                  <div className="ml-10 mt-1">
                    <input
                      type="text"
                      placeholder="Please specify..."
                      className="w-full max-w-md px-3 py-2 text-sm border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-[#D14A2D]"
                    />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Multi-Select */}
      {isMultiSelect && (
        <div className="space-y-2">
          {getOptions().map((opt, optIdx) => {
            const { cleanText, hasExclusive, hasAnchor, hasSpecify } = parseOptionTags(opt.text || opt.code);
            return (
              <div key={optIdx}>
                <label className="flex items-start gap-3 p-2 hover:bg-gray-50 rounded cursor-pointer">
                  <input
                    type="checkbox"
                    name={`question-${question.id || index}`}
                    value={opt.code}
                    className="w-4 h-4 mt-0.5 rounded focus:ring-2 focus:ring-[#D14A2D] flex-shrink-0"
                    style={{ accentColor: BRAND_ORANGE }}
                  />
                  <div className="flex items-center gap-1 flex-1">
                    <span className="text-sm text-gray-700">{formatDescriptionWithBrackets(cleanText)}</span>
                    {hasExclusive && (
                      <span className="text-xs font-bold bg-blue-100 text-blue-800 rounded ml-0.5 inline-flex items-center justify-center w-5 h-5">E</span>
                    )}
                    {hasAnchor && (
                      <span className="text-xs font-bold bg-blue-100 text-blue-800 rounded ml-0.5 inline-flex items-center justify-center w-5 h-5">A</span>
                    )}
                    {hasSpecify && (
                      <span className="text-xs font-bold bg-blue-100 text-blue-800 rounded ml-0.5 inline-flex items-center justify-center w-5 h-5">S</span>
                    )}
                  </div>
                </label>
                {hasSpecify && (
                  <div className="ml-10 mt-1">
                    <input
                      type="text"
                      placeholder="Please specify..."
                      className="w-full max-w-md px-3 py-2 text-sm border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-[#D14A2D]"
                    />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Numeric */}
      {isNumeric && (
        <div className="flex items-center gap-2">
          <input
            type="number"
            name={`question-${question.id || index}`}
            className="w-auto min-w-[120px] max-w-[200px] px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-[#D14A2D] [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
            placeholder="Enter a number"
          />
          {question.tags && question.tags.includes('%') && (
            <span className="text-sm text-gray-700">%</span>
          )}
        </div>
      )}

      {/* Open End */}
      {isOpenEnd && (
        <div className="space-y-3">
          <textarea
            name={`question-${question.id || index}`}
            rows={3}
            className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-[#D14A2D] resize-none"
            placeholder="Enter your response"
          />

          {/* Opt-out options (e.g., "Don't know", "Prefer not to answer") */}
          {(() => {
            // Check for opt-out options in responseOptions or options
            const optOutOptions = question.responseOptions || question.options || [];
            if (optOutOptions.length === 0) return null;

            return (
              <div className="border-t pt-3">
                <div className="text-xs font-medium text-gray-600 mb-2">Or select:</div>
                <div className="space-y-1">
                  {optOutOptions.map((opt, optIdx) => {
                    const optObj = typeof opt === 'string'
                      ? { code: String(optIdx + 1), text: opt }
                      : opt;
                    const { cleanText, hasExclusive, hasAnchor, hasSpecify } = parseOptionTags(optObj.text || optObj.code);
                    return (
                      <div key={optIdx}>
                        <label className="flex items-center gap-2 text-sm text-gray-700 cursor-pointer">
                          <input
                            type="radio"
                            name={`question-${question.id || index}`}
                            value={optObj.code}
                            className="w-4 h-4 focus:ring-2 focus:ring-[#D14A2D]"
                            style={{ accentColor: BRAND_ORANGE }}
                          />
                          <span>{formatDescriptionWithBrackets(cleanText)}</span>
                          {hasExclusive && (
                            <span className="text-xs font-bold bg-blue-100 text-blue-800 rounded ml-0.5 inline-flex items-center justify-center w-5 h-5">E</span>
                          )}
                          {hasAnchor && (
                            <span className="text-xs font-bold bg-blue-100 text-blue-800 rounded ml-0.5 inline-flex items-center justify-center w-5 h-5">A</span>
                          )}
                          {hasSpecify && (
                            <span className="text-xs font-bold bg-blue-100 text-blue-800 rounded ml-0.5 inline-flex items-center justify-center w-5 h-5">S</span>
                          )}
                        </label>
                        {hasSpecify && (
                          <div className="ml-6 mt-1">
                            <input
                              type="text"
                              placeholder="Please specify..."
                              className="w-full max-w-md px-3 py-2 text-sm border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-[#D14A2D]"
                            />
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })()}
        </div>
      )}

      {/* Single Select Grid */}
      {isSingleSelectGrid && displayStatementOptions && displayResponseOptions && (
        <div className="overflow-x-auto">
          <table className="min-w-full border border-gray-300 rounded-lg">
            <thead>
              <tr className="bg-gray-50">
                <th className="px-4 py-2 text-left text-sm font-medium text-gray-700 border-b border-gray-300"></th>
                {displayResponseOptions.map((resp, respIdx) => {
                  const respOpt = typeof resp === 'string' 
                    ? { code: `c${respIdx + 1}`, text: resp } 
                    : resp;
                  return (
                    <th key={respIdx} className="px-4 py-2 text-center text-sm font-medium text-gray-700 border-b border-gray-300">
                      {formatDescriptionWithBrackets(respOpt.text || respOpt.code)}
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {displayStatementOptions.map((stmt, stmtIdx) => {
                const stmtOpt = typeof stmt === 'string' 
                  ? { code: `r${stmtIdx + 1}`, text: stmt } 
                  : stmt;
                return (
                  <tr key={stmtIdx} className="border-b border-gray-200">
                    <td className="px-4 py-3 text-sm text-gray-700">{formatDescriptionWithBrackets(stmtOpt.text || stmtOpt.code)}</td>
                    {displayResponseOptions?.map((resp, respIdx) => (
                      <td key={respIdx} className="px-4 py-3 text-center">
                        <input
                          type="radio"
                          name={`question-${question.id || index}-stmt-${stmtIdx}`}
                          value={respIdx}
                          className="w-4 h-4 focus:ring-2 focus:ring-[#D14A2D]"
                style={{ accentColor: BRAND_ORANGE }}
                        />
                      </td>
                    ))}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Multi-Select Grid */}
      {isMultiSelectGrid && displayStatementOptions && displayResponseOptions && (
        <div className="overflow-x-auto">
          <table className="min-w-full border border-gray-300 rounded-lg">
            <thead>
              <tr className="bg-gray-50">
                <th className="px-4 py-2 text-left text-sm font-medium text-gray-700 border-b border-gray-300"></th>
                {displayResponseOptions.map((resp, respIdx) => {
                  const respOpt = typeof resp === 'string' 
                    ? { code: `c${respIdx + 1}`, text: resp } 
                    : resp;
                  return (
                    <th key={respIdx} className="px-4 py-2 text-center text-sm font-medium text-gray-700 border-b border-gray-300">
                      {formatDescriptionWithBrackets(respOpt.text || respOpt.code)}
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {displayStatementOptions.map((stmt, stmtIdx) => {
                const stmtOpt = typeof stmt === 'string' 
                  ? { code: `r${stmtIdx + 1}`, text: stmt } 
                  : stmt;
                return (
                  <tr key={stmtIdx} className="border-b border-gray-200">
                    <td className="px-4 py-3 text-sm text-gray-700">{formatDescriptionWithBrackets(stmtOpt.text || stmtOpt.code)}</td>
                    {displayResponseOptions?.map((resp, respIdx) => (
                      <td key={respIdx} className="px-4 py-3 text-center">
                        <input
                          type="checkbox"
                          name={`question-${question.id || index}-stmt-${stmtIdx}-resp-${respIdx}`}
                          className="w-4 h-4 rounded focus:ring-2 focus:ring-[#D14A2D]"
                          style={{ accentColor: BRAND_ORANGE }}
                        />
                      </td>
                    ))}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Numeric Grid */}
      {isNumericGrid && question.statementOptions && question.responseOptions && (
        <div className="overflow-x-auto">
          <table className="w-full border border-gray-300 rounded-lg" style={{ tableLayout: 'fixed' }}>
            <thead>
              <tr className="bg-gray-50">
                <th className="px-4 py-2 text-left text-sm font-medium text-gray-700 border-b border-gray-300"></th>
                {question.responseOptions.map((resp, respIdx) => {
                  const respOpt = typeof resp === 'string' 
                    ? { code: `c${respIdx + 1}`, text: resp } 
                    : resp;
                  const numColumns = question.responseOptions?.length || 1;
                  // Response columns share remaining space equally (assuming first column takes ~30%)
                  const columnWidth = `${70 / numColumns}%`;
                  return (
                    <th 
                      key={respIdx} 
                      className="px-4 py-2 text-center text-sm font-medium text-gray-700 border-b border-gray-300"
                      style={{ width: columnWidth }}
                    >
                      {formatDescriptionWithBrackets(respOpt.text || respOpt.code)}
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {question.statementOptions.map((stmt, stmtIdx) => {
                const stmtOpt = typeof stmt === 'string' 
                  ? { code: `r${stmtIdx + 1}`, text: stmt } 
                  : stmt;
                const numColumns = question.responseOptions?.length || 1;
                const columnWidth = `${70 / numColumns}%`;
                return (
                  <tr key={stmtIdx} className="border-b border-gray-200">
                    <td className="px-4 py-3 text-sm text-gray-700">{formatDescriptionWithBrackets(stmtOpt.text || stmtOpt.code)}</td>
                    {question.responseOptions?.map((resp, respIdx) => (
                      <td 
                        key={respIdx} 
                        className="px-4 py-3 text-center"
                        style={{ width: columnWidth }}
                      >
                        <div className="flex items-center justify-center gap-1">
                          <input
                            type="number"
                            name={`question-${question.id || index}-stmt-${stmtIdx}-resp-${respIdx}`}
                            className="w-16 px-2 py-1 border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-[#D14A2D] text-center [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                            placeholder="0"
                          />
                          {question.tags && question.tags.includes('%') && (
                            <span className="text-sm text-gray-700">%</span>
                          )}
                        </div>
                      </td>
                    ))}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Open End List */}
      {isOpenEndList && question.responseOptions && (
        <div className="space-y-3">
          {question.responseOptions.map((resp, respIdx) => {
            const respOpt = typeof resp === 'string' 
              ? { code: `r${respIdx + 1}`, text: resp } 
              : resp;
            return (
              <div key={respIdx}>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  {formatDescriptionWithBrackets(respOpt.text || respOpt.code)}
                </label>
                <textarea
                  name={`question-${question.id || index}-resp-${respIdx}`}
                  rows={2}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-[#D14A2D] resize-none"
                  placeholder="Enter your response"
                />
              </div>
            );
          })}
        </div>
      )}

      {/* Numeric List */}
      {isNumericList && (() => {
        // For numeric lists, response options should be in question.responseOptions
        const responseOptions = question.responseOptions || [];
        const hasResponseOptions = responseOptions.length > 0;
        
        if (!hasResponseOptions) {
          return (
            <div className="text-sm text-gray-500 italic">No response options available</div>
          );
        }
        
        return (
          <div className="overflow-x-auto">
            <table className="w-full border border-gray-300 rounded-lg">
              <tbody>
                {responseOptions.map((resp, respIdx) => {
                  const respOpt = typeof resp === 'string' 
                    ? { code: `r${respIdx + 1}`, text: resp } 
                    : resp;
                  return (
                    <tr key={respIdx} className="border-b border-gray-200 last:border-b-0">
                      <td className="px-4 py-3 text-sm text-gray-700">
                        {formatDescriptionWithBrackets(respOpt.text || respOpt.code)}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center justify-start gap-1">
                          <input
                            type="number"
                            name={`question-${question.id || index}-resp-${respIdx}`}
                            className="w-16 px-2 py-1 border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-[#D14A2D] text-center [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                            placeholder="0"
                          />
                          {question.tags && question.tags.includes('%') && (
                            <span className="text-sm text-gray-700">%</span>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        );
      })()}
    </div>
  );
}

