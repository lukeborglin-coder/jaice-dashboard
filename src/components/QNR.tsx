import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
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
  ChevronUpIcon,
  CircleStackIcon,
  Squares2X2Icon,
  HashtagIcon,
  TableCellsIcon,
  ChatBubbleLeftRightIcon,
  ListBulletIcon,
  FunnelIcon,
  ArrowDownTrayIcon,
  ClipboardDocumentIcon
} from '@heroicons/react/24/outline';
import { IconCheckbox } from '@tabler/icons-react';
import { API_BASE_URL } from '../config';
import { useAuth } from '../contexts/AuthContext';
import { Document, Packer, Paragraph, TextRun, HeadingLevel, AlignmentType, Table, TableRow, TableCell, WidthType, BorderStyle, ImageRun } from 'docx';

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
  manuallyFlipped?: boolean; // Flag to indicate question was manually flipped, overriding fallback logic
}

interface Section {
  sectionNumber: number;
  sectionName: string;
  textLength: number;
  parsed: boolean;
  questions?: Question[];
  expectedQuestionCount?: number;
  foundQuestionNumbers?: string[];
  questionPrefix?: string | null;
}

interface Quota {
  name: string;
  conditions: string[];
  limit: number;
  description?: string;
}

interface Questionnaire {
  id: string;
  name: string;
  questions: Question[];
  sections?: Section[];
  quotas?: Quota[];
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
  const [excludedSections, setExcludedSections] = useState<Set<number>>(new Set());
  const parsingCancelledRef = React.useRef<boolean>(false);
  const [questionnaireName, setQuestionnaireName] = useState('');
  const [allQuestionnaires, setAllQuestionnaires] = useState<Questionnaire[]>([]);
  const [selectedQuestionTypes, setSelectedQuestionTypes] = useState<Set<string>>(new Set());
  const [variableData, setVariableData] = useState<Record<string, any>>({});
  const [expandedSections, setExpandedSections] = useState<Set<string>>(new Set());
  const [selectedSection, setSelectedSection] = useState<string | null>(null);
  const [questionTypesExpanded, setQuestionTypesExpanded] = useState<boolean>(false);
  const [surveyView, setSurveyView] = useState(false);
  const [fileSelected, setFileSelected] = useState(false);
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
  const [showQuestionTypeSelector, setShowQuestionTypeSelector] = useState(false);
  const [pendingQuestionInsertIndex, setPendingQuestionInsertIndex] = useState<number | null>(null);
  const [previewQuestionType, setPreviewQuestionType] = useState<string | null>(null);
  const [editingSection, setEditingSection] = useState<number | null>(null);
  const [editSectionName, setEditSectionName] = useState('');
  const [editQuestionNumbers, setEditQuestionNumbers] = useState<string[]>([]);
  const [editQuotas, setEditQuotas] = useState<Quota[]>([]);
  const [editingQuotasModal, setEditingQuotasModal] = useState(false);
  const [xmlCopied, setXmlCopied] = useState(false);

  // Load questionnaires for a project
  const loadQuestionnaires = useCallback(async (projectId: string) => {
    try {
      const response = await fetch(`${API_BASE_URL}/api/questionnaire/${projectId}`, {
        headers: { 'Authorization': `Bearer ${localStorage.getItem('cognitive_dash_token')}` }
      });
      if (response.ok) {
        const data = await response.json();
        // Convert numeric list questions to numeric grids
        // Also migrate Open End questions with statementOptions to Open End List
        const convertedData = (data || []).map((qnr: any) => {
          if (qnr.questions && Array.isArray(qnr.questions)) {
            qnr.questions = qnr.questions.map((q: any) => {
              // Convert numeric list to numeric grid
              if (q.type && q.type.toLowerCase().includes('numeric list')) {
                q.type = 'Numeric Grid';
                // Convert options to statementOptions if they exist
                if (q.options && Array.isArray(q.options) && q.options.length > 0 && !q.statementOptions) {
                  q.statementOptions = q.options.map((opt: any, idx: number) => {
                    if (typeof opt === 'string') {
                      return { code: `r${idx + 1}`, text: opt };
                    }
                    return { code: opt.code || `r${idx + 1}`, text: opt.text || opt.code || '' };
                  });
                  q.options = [];
                }
                // Ensure there's at least one responseOption (default column)
                if (!q.responseOptions || q.responseOptions.length === 0) {
                  const hasPercentTag = q.tags && Array.isArray(q.tags) && q.tags.includes('%');
                  const hasNumberTag = q.tags && Array.isArray(q.tags) && q.tags.includes('Number');
                  const columnLabel = hasPercentTag ? '%' : (hasNumberTag ? '#' : '#');
                  q.responseOptions = [{ code: 'c1', text: columnLabel }];
                }
              }
              
              // Migrate Open End questions with statementOptions to Open End List
              const isOpenEnd = q.type?.toLowerCase() === 'open end' || 
                               (q.type?.toLowerCase().includes('open end') && !q.type?.toLowerCase().includes('list'));
              const hasStatementOptions = q.statementOptions && Array.isArray(q.statementOptions) && q.statementOptions.length > 0;
              if (isOpenEnd && hasStatementOptions) {
                console.log(`⚠️ Auto-migrating question ${q.number || q.id} from "Open End" to "Open End List" - it has ${q.statementOptions.length} statement options`);
                q.type = 'Open End List';
                // Move statementOptions to responseOptions if responseOptions doesn't exist
                if (!q.responseOptions || q.responseOptions.length === 0) {
                  q.responseOptions = q.statementOptions;
                }
                // Clear statementOptions
                q.statementOptions = undefined;
              }
              
              return q;
            });
          }
          return qnr;
        });
        setQuestionnaires(convertedData);
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
          // Convert numeric list questions to numeric grids
          const convertedData = (data || []).map((qnr: any) => {
            if (qnr.questions && Array.isArray(qnr.questions)) {
              qnr.questions = qnr.questions.map((q: any) => {
                if (q.type && q.type.toLowerCase().includes('numeric list')) {
                  q.type = 'Numeric Grid';
                  // Convert options to statementOptions if they exist
                  if (q.options && Array.isArray(q.options) && q.options.length > 0 && !q.statementOptions) {
                    q.statementOptions = q.options.map((opt: any, idx: number) => {
                      if (typeof opt === 'string') {
                        return { code: `r${idx + 1}`, text: opt };
                      }
                      return { code: opt.code || `r${idx + 1}`, text: opt.text || opt.code || '' };
                    });
                    q.options = [];
                  }
                  // Ensure there's at least one responseOption (default column)
                  if (!q.responseOptions || q.responseOptions.length === 0) {
                    const hasPercentTag = q.tags && Array.isArray(q.tags) && q.tags.includes('%');
                    const hasNumberTag = q.tags && Array.isArray(q.tags) && q.tags.includes('Number');
                    const columnLabel = hasPercentTag ? '%' : (hasNumberTag ? '#' : '#');
                    q.responseOptions = [{ code: 'c1', text: columnLabel }];
                  }
                }
                return q;
              });
            }
            return qnr;
          });
          setAllQuestionnaires(convertedData);
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
        onPageTitleChange('Questionnaire');
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

  // Check for project navigation from Project Hub (similar to Transcripts and Storytelling)
  useEffect(() => {
    try {
      const storedProjectId = sessionStorage.getItem('cognitive_dash_qnr_focus_project');
      const storedViewMode = sessionStorage.getItem('cognitive_dash_qnr_view_mode');
      
      if (storedProjectId && (projects.length > 0 || archivedProjects.length > 0)) {
        // Check both active and archived projects
        const allProjects = [...projects, ...archivedProjects];
        const targetProject = allProjects.find(p => p.id === storedProjectId);
        if (targetProject) {
          setSelectedProject(targetProject);
          if (storedViewMode === 'project') {
            setViewMode('project');
            // Load questionnaires for the project
            loadQuestionnaires(targetProject.id);
          }
          // Set the correct tab if project is archived
          if (targetProject.archived) {
            setActiveTab('archived');
          } else {
            setActiveTab('active');
          }
          // Clear sessionStorage after reading
          sessionStorage.removeItem('cognitive_dash_qnr_focus_project');
          sessionStorage.removeItem('cognitive_dash_qnr_view_mode');
        }
      }
    } catch (error) {
      console.warn('Unable to read QNR navigation target', error);
    }
  }, [projects, archivedProjects, loadQuestionnaires]);

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


  // Migrate Scale tags to include point count (only 5pt, 7pt, 10pt)
  useEffect(() => {
    if (!selectedQuestionnaire) return;

    let needsUpdate = false;
    const updatedQuestions = selectedQuestionnaire.questions?.map((q: Question) => {
      if (!q.tags) return q;

      // Check if question has any Scale tag (with or without point count)
      const hasScaleTag = q.tags.some(tag => tag === 'Scale' || tag.startsWith('Scale ('));

      if (hasScaleTag) {
        needsUpdate = true;

        // For grids (single select grid, multi-select grid), count responseOptions (columns)
        // For regular single select, count options
        const isGrid = q.type?.toLowerCase().includes('grid');
        const numPoints = isGrid
          ? (q.responseOptions?.length || 0)
          : (q.options?.length || 0);

        // Only keep Scale tag if it's 5pt, 7pt, 10pt, or 11pt - otherwise remove it completely
        if (numPoints === 5 || numPoints === 7 || numPoints === 10 || numPoints === 11) {
          const newTag = `Scale (${numPoints}pt)`;
          // Replace any Scale tag (with or without point count) with the correct one
          return {
            ...q,
            tags: q.tags.map(tag =>
              (tag === 'Scale' || tag.startsWith('Scale (')) ? newTag : tag
            )
          };
        } else {
          // Remove all Scale tags for other point counts
          return {
            ...q,
            tags: q.tags.filter(tag => tag !== 'Scale' && !tag.startsWith('Scale ('))
          };
        }
      }
      return q;
    });

    if (needsUpdate && updatedQuestions) {
      const updatedQnr = {
        ...selectedQuestionnaire,
        questions: updatedQuestions
      };
      setSelectedQuestionnaire(updatedQnr);

      // Save to backend
      fetch(`${API_BASE_URL}/api/questionnaire/${selectedQuestionnaire.id}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${localStorage.getItem('cognitive_dash_token')}`
        },
        body: JSON.stringify(updatedQnr)
      })
        .then(() => {
          // Trigger a reload by updating the questionnaire reference
          // Force a re-render in other components that depend on this questionnaire
          console.log('Scale tags migration completed and saved');
        })
        .catch(err => console.error('Failed to update Scale tags:', err));
    }
  }, [selectedQuestionnaire?.id]);

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

  // Group ALL questions by section (unfiltered) - used for displaying all sections
  const allQuestionsBySection = useMemo(() => {
    if (!selectedQuestionnaire?.questions) return {};
    const grouped: Record<string, Question[]> = {};
    const sectionOrder: string[] = [];
    
    // Always add Quota section first if quotas exist or if there are hidden variables
    const hasQuotas = selectedQuestionnaire?.quotas && selectedQuestionnaire.quotas.length > 0;
    const hasHiddenVariables = selectedQuestionnaire.questions.some(q => q.number?.startsWith('hid_'));
    
    if (hasQuotas || hasHiddenVariables) {
      sectionOrder.push('QUOTA');
      grouped['QUOTA'] = [];
      
      // Add hidden variables to the Quota section
      selectedQuestionnaire.questions.forEach((question) => {
        if (question.number?.startsWith('hid_')) {
          grouped['QUOTA'].push(question);
        }
      });
    }
    
    selectedQuestionnaire.questions.forEach((question) => {
      // Skip hidden variables as they're already in the Quota section
      if (question.number?.startsWith('hid_')) {
        return;
      }
      
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
  }, [selectedQuestionnaire?.questions, selectedQuestionnaire?.quotas]);

  // Group questions by first letter of question number, preserving QNR order (filtered by question type)
  const questionsBySection = useMemo(() => {
    const grouped: Record<string, Question[]> = {};
    const sectionOrder: string[] = [];
    
    // Always add Quota section first if quotas exist or if there are hidden variables
    const hasQuotas = selectedQuestionnaire?.quotas && selectedQuestionnaire.quotas.length > 0;
    const hasHiddenVariables = filteredQuestions.some(q => q.number?.startsWith('hid_'));
    
    if (hasQuotas || hasHiddenVariables) {
      sectionOrder.push('QUOTA');
      grouped['QUOTA'] = [];
      
      // Add hidden variables to the Quota section
      filteredQuestions.forEach((question) => {
        if (question.number?.startsWith('hid_')) {
          grouped['QUOTA'].push(question);
        }
      });
    }
    
    filteredQuestions.forEach((question) => {
      // Skip hidden variables as they're already in the Quota section
      if (question.number?.startsWith('hid_')) {
        return;
      }
      
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
  }, [filteredQuestions, selectedQuestionnaire?.quotas]);

  // Get section keys in order (from all sections, not filtered)
  const sectionKeys = useMemo(() => {
    return Object.keys(allQuestionsBySection);
  }, [allQuestionsBySection]);

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

  // Show question type selector when plus is clicked
  const showQuestionTypeSelectorForIndex = useCallback((insertAfterIndex: number) => {
    setPendingQuestionInsertIndex(insertAfterIndex);
    setShowQuestionTypeSelector(true);
  }, []);

  // Show preview for a question type
  const showPreviewForType = useCallback((questionType: string) => {
    setPreviewQuestionType(questionType);
  }, []);

  // Add a new question at a specific index with a selected type
  const addQuestionAtIndex = useCallback(async (questionData: Question) => {
    if (!selectedQuestionnaire || !selectedSectionQuestions.length || pendingQuestionInsertIndex === null) return;
    
    // Get the question we're inserting after
    const questionAfter = selectedSectionQuestions[pendingQuestionInsertIndex];
    if (!questionAfter) {
      setShowQuestionTypeSelector(false);
      setPendingQuestionInsertIndex(null);
      return;
    }
    
    // Find the position of this question in the full questions array
    const fullQuestions = selectedQuestionnaire.questions || [];
    const insertPosition = fullQuestions.findIndex(q => q.id === questionAfter.id);
    
    if (insertPosition === -1) {
      console.error('Could not find question in full array');
      setShowQuestionTypeSelector(false);
      setPendingQuestionInsertIndex(null);
      return;
    }
    
    // Use provided question number, or calculate one based on position
    let finalQuestionNumber: string;
    if (questionData.number && questionData.number.trim()) {
      finalQuestionNumber = questionData.number.trim();
    } else {
      // Get the section prefix from the question we're inserting after
      // This ensures the new question appears in the same section
      const questionAfterNum = questionAfter.number || '';
      const sectionPrefix = questionAfterNum.toString().charAt(0).toUpperCase() || 'Q';
      
      // Find the next number in this section
      const sectionQuestions = fullQuestions.filter((q: Question) => {
        const qNum = q.number || '';
        return qNum.toString().charAt(0).toUpperCase() === sectionPrefix;
      });
      const maxNumber = sectionQuestions.reduce((max, q) => {
        const qNum = q.number || '';
        const numPart = parseInt(qNum.toString().substring(1)) || 0;
        return Math.max(max, numPart);
      }, 0);
      const nextNumber = maxNumber + 1;
      finalQuestionNumber = `${sectionPrefix}${nextNumber}`;
    }
    
    // Create a new question using the provided question data
    const newQuestion: Question = {
      ...questionData,
      id: `q-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      number: finalQuestionNumber,
      // Ensure all required fields are present
      text: questionData.text || '',
      type: questionData.type || '',
      options: questionData.options || [],
      tags: questionData.tags || [],
      needsReview: questionData.needsReview || false,
      randomize: questionData.randomize || false
    };
    
    // Insert the new question right after the current one
    const updatedQuestions = [
      ...fullQuestions.slice(0, insertPosition + 1),
      newQuestion,
      ...fullQuestions.slice(insertPosition + 1)
    ];
    
    // Update local state
    const updatedQuestionnaire = {
      ...selectedQuestionnaire,
      questions: updatedQuestions
    };
    setSelectedQuestionnaire(updatedQuestionnaire);
    
    // Close the selector
    setShowQuestionTypeSelector(false);
    setPendingQuestionInsertIndex(null);
    
    // Save to backend
    try {
      const response = await fetch(`${API_BASE_URL}/api/questionnaire/${selectedQuestionnaire.id}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${localStorage.getItem('cognitive_dash_token')}`
        },
        body: JSON.stringify(updatedQuestionnaire)
      });
      
      if (response.ok) {
        // Notify Tabs page to reload questionnaire data
        window.dispatchEvent(new CustomEvent('questionnaireUpdated', { 
          detail: { questionnaireId: selectedQuestionnaire.id } 
        }));
      } else {
        alert('Failed to save new question. Please try again.');
        // Revert on error
        setSelectedQuestionnaire(selectedQuestionnaire);
      }
    } catch (error) {
      console.error('Error adding question:', error);
      alert('Failed to save new question. Please try again.');
      // Revert on error
      setSelectedQuestionnaire(selectedQuestionnaire);
    }
  }, [selectedQuestionnaire, selectedSectionQuestions, pendingQuestionInsertIndex]);

  // Handle project selection
  const handleProjectClick = (project: any) => {
    setSelectedProject(project);
    setViewMode('project');
    loadQuestionnaires(project.id);
  };

  // Handle QNR upload
  // Handle file selection
  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    // Trigger re-render when file is selected so the Upload button state updates
    setFileSelected(!!e.target.files?.[0]);
  };

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
        setExcludedSections(new Set()); // Reset excluded sections
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

  // Helper function to create text segments with bracket information for Word
  const parseTextWithBrackets = (text: string): Array<{ text: string; isBracket: boolean }> => {
    if (!text) return [];
    
    const segments: Array<{ text: string; isBracket: boolean }> = [];
    const regex = /(\[[^\]]+\])/g;
    let lastIndex = 0;
    let match;
    
    while ((match = regex.exec(text)) !== null) {
      // Add text before the bracket
      if (match.index > lastIndex) {
        segments.push({
          text: text.substring(lastIndex, match.index),
          isBracket: false
        });
      }
      
      // Add the bracketed text
      segments.push({
        text: match[1], // Include the brackets
        isBracket: true
      });
      
      lastIndex = regex.lastIndex;
    }
    
    // Add remaining text after last bracket
    if (lastIndex < text.length) {
      segments.push({
        text: text.substring(lastIndex),
        isBracket: false
      });
    }
    
    // If no brackets found, return single segment
    if (segments.length === 0) {
      segments.push({
        text: text,
        isBracket: false
      });
    }
    
    return segments;
  };

  // Download QNR as Word document
  const downloadQNRAsWord = async () => {
    if (!selectedQuestionnaire) return;

    try {
      const children: any[] = [];

      // Add logo
      let logoImage;
      try {
        const logoResponse = await fetch('/assets/Cog Logo.png');
        const logoBlob = await logoResponse.blob();
        const logoBuffer = await logoBlob.arrayBuffer();
        logoImage = new ImageRun({
          data: new Uint8Array(logoBuffer),
          transformation: {
            width: 2.01 * 72, // Convert inches to points (72 points per inch)
            height: 0.43 * 72
          }
        });
      } catch (err) {
        console.error('Error loading logo:', err);
      }

      if (logoImage) {
        children.push(
          new Paragraph({
            children: [logoImage],
            alignment: AlignmentType.CENTER
          })
        );
      }

      // Add line break
      children.push(
        new Paragraph({
          text: ''
        })
      );

      // Add download date (month and year)
      const now = new Date();
      const monthNames = ['January', 'February', 'March', 'April', 'May', 'June',
        'July', 'August', 'September', 'October', 'November', 'December'];
      const downloadDate = `${monthNames[now.getMonth()]} ${now.getFullYear()}`;
      children.push(
        new Paragraph({
          children: [
            new TextRun({
              text: downloadDate,
              font: 'Trebuchet MS',
              size: 20,
              italics: true
            })
          ],
          alignment: AlignmentType.LEFT
        })
      );

      // Add line break
      children.push(
        new Paragraph({
          text: ''
        })
      );

      // Add title in a table (like open end boxes)
      children.push(
        new Table({
          rows: [
            new TableRow({
              height: {
                value: 720,
                rule: 'atLeast'
              },
              children: [
                new TableCell({
                  children: [
                    new Paragraph({
                      children: [
                        new TextRun({
                          text: selectedQuestionnaire.name.toUpperCase(),
                          font: 'Trebuchet MS',
                          size: 24,
                          bold: true
                        })
                      ],
                      alignment: AlignmentType.CENTER
                    })
                  ],
                  width: {
                    size: 100,
                    type: WidthType.PERCENTAGE
                  },
                  verticalAlign: 'center'
                })
              ]
            })
          ],
          width: {
            size: 100,
            type: WidthType.PERCENTAGE
          },
          borders: {
            top: { size: 4, color: '000000', style: BorderStyle.SINGLE },
            bottom: { size: 4, color: '000000', style: BorderStyle.SINGLE },
            left: { size: 4, color: '000000', style: BorderStyle.SINGLE },
            right: { size: 4, color: '000000', style: BorderStyle.SINGLE },
            insideHorizontal: { size: 4, color: '000000', style: BorderStyle.SINGLE },
            insideVertical: { size: 4, color: '000000', style: BorderStyle.SINGLE }
          }
        })
      );

      // Add line break after header
      children.push(
        new Paragraph({
          text: ''
        })
      );

      // Group questions by section
      const questionsBySection = allQuestionsBySection;
      const sectionKeys = Object.keys(questionsBySection);

      // Add questions organized by section
      for (const sectionKey of sectionKeys) {
        const questions = questionsBySection[sectionKey] || [];
        if (questions.length === 0) continue;

        // Skip quota section (includes hidden variables)
        if (sectionKey === 'QUOTA') {
          continue;
        }

        // Section header
        children.push(
          new Table({
            rows: [
              new TableRow({
                children: [
                  new TableCell({
                    children: [
                      new Paragraph({
                        children: [
                          new TextRun({
                            text: `SECTION ${sectionKey}${sectionKey === 'S' ? ' (SCREENING)' : ''}`,
                            font: 'Trebuchet MS',
                            size: 24,
                            bold: true
                          })
                        ]
                      })
                    ],
                    shading: {
                      fill: 'D3D3D3'
                    },
                    width: {
                      size: 100,
                      type: WidthType.PERCENTAGE
                    }
                  })
                ]
              })
            ],
            width: {
              size: 100,
              type: WidthType.PERCENTAGE
            },
            borders: {
              top: { size: 0, color: 'FFFFFF' },
              bottom: { size: 0, color: 'FFFFFF' },
              left: { size: 0, color: 'FFFFFF' },
              right: { size: 0, color: 'FFFFFF' },
              insideHorizontal: { size: 0, color: 'FFFFFF' },
              insideVertical: { size: 0, color: 'FFFFFF' }
            }
          }),
          new Paragraph({
            text: ''
          })
        );

        // Add each question
        for (const question of questions) {
          // Show logic - show BEFORE the question
          if (question.showLogic) {
            const showLogicSegments = parseTextWithBrackets(question.showLogic);
            const showLogicRuns = showLogicSegments.map(seg => 
              new TextRun({
                text: seg.isBracket ? seg.text : seg.text.toUpperCase(),
                font: 'Trebuchet MS',
                size: 18,
                color: '0070C0', // Blue
                italics: true,
                bold: false
              })
            );
            children.push(
              new Paragraph({
                children: [
                  new TextRun({
                    text: 'SHOW IF: ',
                    font: 'Trebuchet MS',
                    size: 18,
                    color: '0070C0',
                    italics: true,
                    bold: false
                  }),
                  ...showLogicRuns
                ]
              })
            );
          }
          
          // Question number and text - use table format for proper alignment
          const questionNumber = question.number || 'Q';
          const questionText = question.text || '';
          const questionSegments = parseTextWithBrackets(questionText);
          const questionTextRuns = questionSegments.map(seg => 
            new TextRun({
              text: seg.text,
              font: 'Trebuchet MS',
              size: 22,
              color: seg.isBracket ? '0070C0' : undefined,
              italics: seg.isBracket ? true : undefined
            })
          );
          
          // Build content for column 2 (question text and type)
          const column2Content: Paragraph[] = [];
          
          // Question text
          column2Content.push(
            new Paragraph({
              children: questionTextRuns,
              indent: { left: 0, hanging: 0 }
            })
          );
          
          // Question type
          if (question.type) {
            const typeSegments = parseTextWithBrackets(question.type);
            const typeTextRuns = typeSegments.map(seg =>
              new TextRun({
                text: seg.text,
                font: 'Trebuchet MS',
                size: 16,
                color: seg.isBracket ? '0070C0' : undefined,
                italics: true // All type text is italic
              })
            );
            column2Content.push(
              new Paragraph({
                children: [
                  new TextRun({
                    text: 'Type: ',
                    font: 'Trebuchet MS',
                    size: 16,
                    italics: true
                  }),
                  ...typeTextRuns
                ],
                indent: { left: 0, hanging: 0 }
              })
            );
          }
          
          // Create table row for question
          children.push(
            new Table({
              rows: [
                new TableRow({
                  children: [
                    new TableCell({
                      children: [
                        new Paragraph({
                          children: [
                            new TextRun({
                              text: `${questionNumber}.`,
                              font: 'Trebuchet MS',
                              size: 22
                            })
                          ],
                          indent: { left: 0, hanging: 0 }
                        })
                      ],
                      width: {
                        size: 5,
                        type: WidthType.PERCENTAGE
                      },
                      margins: {
                        top: 0,
                        bottom: 0,
                        left: 0,
                        right: 100
                      }
                    }),
                    new TableCell({
                      children: column2Content,
                      width: {
                        size: 95,
                        type: WidthType.PERCENTAGE
                      },
                      margins: {
                        top: 0,
                        bottom: 0,
                        left: 0,
                        right: 0
                      }
                    })
                  ]
                })
              ],
              width: {
                size: 100,
                type: WidthType.PERCENTAGE
              },
              borders: {
                top: { size: 0, color: 'FFFFFF' },
                bottom: { size: 0, color: 'FFFFFF' },
                left: { size: 0, color: 'FFFFFF' },
                right: { size: 0, color: 'FFFFFF' },
                insideHorizontal: { size: 0, color: 'FFFFFF' },
                insideVertical: { size: 0, color: 'FFFFFF' }
              }
            })
          );
          
          // Add spacing after question
          children.push(
            new Paragraph({
              text: ''
            })
          );

          // Options - use table for single select questions
          if (question.options && question.options.length > 0) {
            const tableRows: TableRow[] = [];
            const terminateCodes = parseTerminateLogic(question.terminateLogic, question.options, question.type);
            
            for (const option of question.options) {
              let optionText: string;
              let optionCode: string;
              
              if (typeof option === 'string') {
                // Try to extract code from string (e.g., "99 Don't Know" -> code: "99", text: "Don't Know")
                const codeMatch = option.match(/^(\d+):?\s+(.+)$/);
                if (codeMatch) {
                  optionCode = codeMatch[1];
                  optionText = codeMatch[2].trim();
                } else {
                  // No code found, use index
                  optionCode = String(question.options.indexOf(option) + 1);
                  optionText = option;
                }
              } else {
                // Use actual code from option object, removing any prefixes like "c" or "r"
                optionCode = option.code ? option.code.replace(/^[rc]/i, '') : String(question.options.indexOf(option) + 1);
                optionText = option.text || '';
              }
              
              // Parse tags from option text
              const { cleanText, hasExclusive, hasAnchor, hasSpecify } = parseOptionTags(optionText);
              const shouldTerminate = terminateCodes.has(optionCode);
              
              // Build text runs for option text
              const optionTextRuns = parseTextWithBrackets(cleanText).map(seg => 
                new TextRun({
                  text: seg.text,
                  font: 'Trebuchet MS',
                  size: 20,
                  color: seg.isBracket ? '0070C0' : undefined,
                  italics: seg.isBracket ? true : undefined
                })
              );
              
              // Add tag indicators
              const tagRuns: TextRun[] = [];
              if (shouldTerminate) {
                tagRuns.push(
                  new TextRun({
                    text: ' TERM',
                    font: 'Trebuchet MS',
                    size: 20,
                    color: 'FF0000', // Red
                    bold: true
                  })
                );
              }
              if (hasSpecify) {
                tagRuns.push(
                  new TextRun({
                    text: ' [SPECIFY]',
                    font: 'Trebuchet MS',
                    size: 20,
                    color: '0070C0', // Blue
                    italics: true
                  })
                );
              }
              if (hasAnchor) {
                tagRuns.push(
                  new TextRun({
                    text: ' [ANCHOR]',
                    font: 'Trebuchet MS',
                    size: 20,
                    color: '0070C0', // Blue
                    italics: true
                  })
                );
              }
              if (hasExclusive) {
                tagRuns.push(
                  new TextRun({
                    text: ' [EXCLUSIVE]',
                    font: 'Trebuchet MS',
                    size: 20,
                    color: '0070C0', // Blue
                    italics: true
                  })
                );
              }
              
              tableRows.push(
                new TableRow({
                  children: [
                    new TableCell({
                      children: [
                        new Paragraph({
                          children: [
                            new TextRun({
                              text: optionCode,
                              font: 'Trebuchet MS',
                              size: 20
                            })
                          ],
                          alignment: AlignmentType.CENTER,
                          indent: {
                            left: 0,
                            hanging: 0
                          }
                        })
                      ],
                      width: {
                        size: 5,
                        type: WidthType.PERCENTAGE
                      }
                    }),
                    new TableCell({
                      children: [
                        new Paragraph({
                          children: [...optionTextRuns, ...tagRuns],
                          alignment: AlignmentType.LEFT,
                          indent: {
                            left: 0,
                            hanging: 0
                          }
                        })
                      ],
                      width: {
                        size: 95,
                        type: WidthType.PERCENTAGE
                      }
                    })
                  ]
                })
              );
            }
            
            if (tableRows.length > 0) {
              // Add RANDOMIZE header row if randomize is true
              if (question.randomize) {
                tableRows.unshift(
                  new TableRow({
                    children: [
                      new TableCell({
                        children: [
                          new Paragraph({
                            children: [
                              new TextRun({
                                text: 'RANDOMIZE',
                                font: 'Trebuchet MS',
                                size: 20,
                                color: '0070C0',
                                italics: true
                              })
                            ],
                            alignment: AlignmentType.LEFT
                          })
                        ],
                        columnSpan: 2,
                        width: {
                          size: 100,
                          type: WidthType.PERCENTAGE
                        }
                      })
                    ]
                  })
                );
              }

              children.push(
                new Table({
                  rows: tableRows,
                  width: {
                    size: 100,
                    type: WidthType.PERCENTAGE
                  },
                  borders: {
                    top: { size: 4, color: '000000', style: BorderStyle.SINGLE },
                    bottom: { size: 4, color: '000000', style: BorderStyle.SINGLE },
                    left: { size: 4, color: '000000', style: BorderStyle.SINGLE },
                    right: { size: 4, color: '000000', style: BorderStyle.SINGLE },
                    insideHorizontal: { size: 4, color: '000000', style: BorderStyle.SINGLE },
                    insideVertical: { size: 4, color: '000000', style: BorderStyle.SINGLE }
                  }
                })
              );
            }
          }
          
          // For numeric and open end questions (single response, not lists/grids), add blank table
          const typeLower = question.type?.toLowerCase() || '';
          const isNumericSingle = typeLower.includes('numeric') && !typeLower.includes('list') && !typeLower.includes('grid');
          const isOpenEndSingle = typeLower.includes('open end') && !typeLower.includes('list') && !typeLower.includes('grid');
          
          if ((isNumericSingle || isOpenEndSingle) && !question.options && !question.responseOptions) {
            // Check if there's a programming note for this question
            let cellContent;
            if (question.logic) {
              const skipLogicSegments = parseTextWithBrackets(question.logic);
              const skipLogicRuns = skipLogicSegments.map(seg =>
                new TextRun({
                  text: seg.text,
                  font: 'Trebuchet MS',
                  size: 18,
                  color: '0070C0',
                  italics: true
                })
              );
              cellContent = [
                new Paragraph({
                  children: [
                    new TextRun({
                      text: 'PROGRAMMING NOTE: ',
                      font: 'Trebuchet MS',
                      size: 18,
                      color: '0070C0',
                      italics: true
                    }),
                    ...skipLogicRuns
                  ],
                  alignment: AlignmentType.CENTER
                })
              ];
            } else {
              cellContent = [
                new Paragraph({
                  text: ''
                })
              ];
            }

            children.push(
              new Table({
                rows: [
                  new TableRow({
                    height: {
                      value: 720,
                      rule: 'atLeast'
                    },
                    children: [
                      new TableCell({
                        children: cellContent,
                        width: {
                          size: 100,
                          type: WidthType.PERCENTAGE
                        },
                        verticalAlign: 'center'
                      })
                    ]
                  })
                ],
                width: {
                  size: 100,
                  type: WidthType.PERCENTAGE
                },
                borders: {
                  top: { size: 4, color: '000000', style: BorderStyle.SINGLE },
                  bottom: { size: 4, color: '000000', style: BorderStyle.SINGLE },
                  left: { size: 4, color: '000000', style: BorderStyle.SINGLE },
                  right: { size: 4, color: '000000', style: BorderStyle.SINGLE },
                  insideHorizontal: { size: 4, color: '000000', style: BorderStyle.SINGLE },
                  insideVertical: { size: 4, color: '000000', style: BorderStyle.SINGLE }
                }
              })
            );
          }

          // Numeric grids - format as table with rows and columns
          const isNumericGrid = typeLower.includes('numeric grid');
          const isGrid = typeLower.includes('grid');

          if (isGrid && question.statementOptions && question.statementOptions.length > 0) {
            // Add "Rows:" label
            children.push(
              new Paragraph({
                children: [
                  new TextRun({
                    text: 'Rows:',
                    font: 'Trebuchet MS',
                    size: 20,
                    bold: true
                  })
                ]
              })
            );

            // Create table for statement options (rows)
            const stmtTableRows: TableRow[] = [];
            for (const stmt of question.statementOptions) {
              const stmtCode = stmt.code ? stmt.code.replace(/^[rc]/i, '') : '';
              const stmtSegments = parseTextWithBrackets(stmt.text || '');
              const stmtTextRuns = stmtSegments.map(seg =>
                new TextRun({
                  text: seg.text,
                  font: 'Trebuchet MS',
                  size: 20,
                  color: seg.isBracket ? '0070C0' : undefined,
                  italics: seg.isBracket ? true : undefined
                })
              );

              stmtTableRows.push(
                new TableRow({
                  children: [
                    new TableCell({
                      children: [
                        new Paragraph({
                          children: [
                            new TextRun({
                              text: stmtCode,
                              font: 'Trebuchet MS',
                              size: 20
                            })
                          ],
                          alignment: AlignmentType.CENTER,
                          indent: { left: 0, hanging: 0 }
                        })
                      ],
                      width: {
                        size: 5,
                        type: WidthType.PERCENTAGE
                      }
                    }),
                    new TableCell({
                      children: [
                        new Paragraph({
                          children: stmtTextRuns,
                          alignment: AlignmentType.LEFT,
                          indent: { left: 100, hanging: 0 }
                        })
                      ],
                      width: {
                        size: 95,
                        type: WidthType.PERCENTAGE
                      }
                    })
                  ]
                })
              );
            }

            if (stmtTableRows.length > 0) {
              // Add RANDOMIZE header row if randomize is true
              if (question.randomize) {
                stmtTableRows.unshift(
                  new TableRow({
                    children: [
                      new TableCell({
                        children: [
                          new Paragraph({
                            children: [
                              new TextRun({
                                text: 'RANDOMIZE',
                                font: 'Trebuchet MS',
                                size: 20,
                                color: '0070C0',
                                italics: true
                              })
                            ],
                            alignment: AlignmentType.LEFT
                          })
                        ],
                        columnSpan: 2,
                        width: {
                          size: 100,
                          type: WidthType.PERCENTAGE
                        }
                      })
                    ]
                  })
                );
              }

              children.push(
                new Table({
                  rows: stmtTableRows,
                  width: {
                    size: 100,
                    type: WidthType.PERCENTAGE
                  },
                  borders: {
                    top: { size: 4, color: '000000', style: BorderStyle.SINGLE },
                    bottom: { size: 4, color: '000000', style: BorderStyle.SINGLE },
                    left: { size: 4, color: '000000', style: BorderStyle.SINGLE },
                    right: { size: 4, color: '000000', style: BorderStyle.SINGLE },
                    insideHorizontal: { size: 4, color: '000000', style: BorderStyle.SINGLE },
                    insideVertical: { size: 4, color: '000000', style: BorderStyle.SINGLE }
                  }
                })
              );
            }

            // Add spacing between tables
            children.push(
              new Paragraph({
                text: ''
              })
            );

            // Add "Columns:" label
            children.push(
              new Paragraph({
                children: [
                  new TextRun({
                    text: 'Columns:',
                    font: 'Trebuchet MS',
                    size: 20,
                    bold: true
                  })
                ]
              })
            );

            // Create table for response options (columns)
            const respTableRows: TableRow[] = [];
            // For numeric grids without response options, create fallback column with % or # based on tags
            let responseOptions = question.responseOptions || [];
            if (isNumericGrid && responseOptions.length === 0 && question.statementOptions && question.statementOptions.length > 0) {
              const hasPercentTag = question.tags && question.tags.includes('%');
              const hasNumberTag = question.tags && question.tags.includes('Number');
              const fallbackColumnLabel = hasPercentTag ? '%' : (hasNumberTag ? '#' : '#');
              responseOptions = [{ code: '1', text: fallbackColumnLabel }];
            }
            for (const resp of responseOptions) {
              const respCode = resp.code ? resp.code.replace(/^[rc]/i, '') : '';
              const respSegments = parseTextWithBrackets(resp.text || '');
              const respTextRuns = respSegments.map(seg =>
                new TextRun({
                  text: seg.text,
                  font: 'Trebuchet MS',
                  size: 20,
                  color: seg.isBracket ? '0070C0' : undefined,
                  italics: seg.isBracket ? true : undefined
                })
              );

              respTableRows.push(
                new TableRow({
                  children: [
                    new TableCell({
                      children: [
                        new Paragraph({
                          children: [
                            new TextRun({
                              text: respCode,
                              font: 'Trebuchet MS',
                              size: 20
                            })
                          ],
                          alignment: AlignmentType.CENTER,
                          indent: { left: 0, hanging: 0 }
                        })
                      ],
                      width: {
                        size: 5,
                        type: WidthType.PERCENTAGE
                      }
                    }),
                    new TableCell({
                      children: [
                        new Paragraph({
                          children: respTextRuns,
                          alignment: AlignmentType.LEFT,
                          indent: { left: 100, hanging: 0 }
                        })
                      ],
                      width: {
                        size: 95,
                        type: WidthType.PERCENTAGE
                      }
                    })
                  ]
                })
              );
            }

            if (respTableRows.length > 0) {
              // Add RANDOMIZE header row if randomize is true
              if (question.randomize) {
                respTableRows.unshift(
                  new TableRow({
                    children: [
                      new TableCell({
                        children: [
                          new Paragraph({
                            children: [
                              new TextRun({
                                text: 'RANDOMIZE',
                                font: 'Trebuchet MS',
                                size: 20,
                                color: '0070C0',
                                italics: true
                              })
                            ],
                            alignment: AlignmentType.LEFT
                          })
                        ],
                        columnSpan: 2,
                        width: {
                          size: 100,
                          type: WidthType.PERCENTAGE
                        }
                      })
                    ]
                  })
                );
              }

              children.push(
                new Table({
                  rows: respTableRows,
                  width: {
                    size: 100,
                    type: WidthType.PERCENTAGE
                  },
                  borders: {
                    top: { size: 4, color: '000000', style: BorderStyle.SINGLE },
                    bottom: { size: 4, color: '000000', style: BorderStyle.SINGLE },
                    left: { size: 4, color: '000000', style: BorderStyle.SINGLE },
                    right: { size: 4, color: '000000', style: BorderStyle.SINGLE },
                    insideHorizontal: { size: 4, color: '000000', style: BorderStyle.SINGLE },
                    insideVertical: { size: 4, color: '000000', style: BorderStyle.SINGLE }
                  }
                })
              );
            }
          }

          // Skip logic - only add as separate paragraph if NOT a numeric/open end single question
          // (those have the programming note inside the response table)
          const skipLogicInTable = (isNumericSingle || isOpenEndSingle) && !question.options && !question.responseOptions;
          if (question.logic && !skipLogicInTable) {
            // Add line break before programming note
            children.push(
              new Paragraph({
                text: ''
              })
            );

            const skipLogicSegments = parseTextWithBrackets(question.logic);
            const skipLogicRuns = skipLogicSegments.map(seg =>
              new TextRun({
                text: seg.text,
                font: 'Trebuchet MS',
                size: 18,
                color: '0070C0',
                italics: true
              })
            );
            children.push(
              new Paragraph({
                children: [
                  new TextRun({
                    text: 'PROGRAMMING NOTE: ',
                    font: 'Trebuchet MS',
                    size: 18,
                    color: '0070C0',
                    italics: true
                  }),
                  ...skipLogicRuns
                ]
              })
            );
          }

          // Single line break after question
          children.push(
            new Paragraph({
              text: ''
            })
          );
        }
      }

      // Create document
      const doc = new Document({
        sections: [{
          properties: {},
          children: children
        }]
      });

      // Generate and download
      const blob = await Packer.toBlob(doc);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      const filename = selectedQuestionnaire.name.replace(/[/\\?%*:|"<>]/g, '-');
      a.download = `${filename}.docx`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (error) {
      console.error('Error generating Word document:', error);
      alert('Failed to generate Word document');
    }
  };

  // Copy QNR as Forsta XML to clipboard
  const downloadQNRAsForstaXML = async () => {
    if (!selectedQuestionnaire) return;

    try {
      // Create a copy of the questionnaire without quotas and hidden variables
      const forstaQuestionnaire = {
        ...selectedQuestionnaire,
        quotas: undefined, // Remove quotas
        questions: selectedQuestionnaire.questions.filter(q => !q.number?.startsWith('hid_'))
      };

      const response = await fetch(`${API_BASE_URL}/api/questionnaire/forsta-xml`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${localStorage.getItem('cognitive_dash_token')}`
        },
        body: JSON.stringify(forstaQuestionnaire)
      });

      if (response.ok) {
        const xml = await response.text();
        // Copy to clipboard
        await navigator.clipboard.writeText(xml);
        setXmlCopied(true);
        // Reset the copied state after 3 seconds
        setTimeout(() => {
          setXmlCopied(false);
        }, 3000);
      } else {
        const error = await response.json();
        alert(`Failed to generate XML: ${error.error || 'Unknown error'}`);
      }
    } catch (error) {
      console.error('Error generating Forsta XML:', error);
      alert('Failed to generate Forsta XML');
    }
  };

  return (
    <div className="flex-1 p-6 space-y-4 max-w-full overflow-y-auto overflow-x-hidden" style={{ height: 'calc(100vh - 80px)', marginTop: '80px' }}>
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
                            {(() => {
                              // Exclude hidden variables (questions with number starting with 'hid_') from count
                              const allQuestions = qnr.questions || [];
                              const questionCount = allQuestions.filter(q => !q.number?.startsWith('hid_')).length;
                              return questionCount;
                            })()} questions • Created {new Date(qnr.createdAt).toLocaleDateString()}
                          </p>
                        </div>
                        <div className="flex items-center gap-2">
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
        <div className="flex flex-col h-[calc(100vh-8rem)]">
          {/* Header - spans full width above sidebar and content */}
          <div className="flex-shrink-0 pr-6 pt-0">
            <div className="flex items-start justify-between">
              <div className="flex items-start gap-3">
                <button
                  onClick={() => {
                    setViewMode('project');
                    setSelectedQuestionnaire(null);
                    setSelectedQuestionTypes(new Set());
                  }}
                  className="text-gray-600 hover:text-gray-800 hover:bg-gray-100 p-2 rounded-lg transition-colors flex-shrink-0"
                  title="Back to QNRs"
                >
                  <ArrowLeftIcon className="h-6 w-6" />
                </button>
                <div>
                  <div className="text-3xl font-semibold" style={{ color: BRAND_GRAY }}>
                    {selectedSection === 'QUOTA' ? selectedQuestionnaire?.name || 'OVERVIEW' : `SECTION ${selectedSection || ''}${selectedSection === 'S' ? ' (SCREENING)' : ''}`}
                  </div>
                  {selectedSection === 'QUOTA' ? (
                    selectedQuestionnaire?.projectId && (() => {
                      const project = projects.find(p => p.id === selectedQuestionnaire.projectId) ||
                                    archivedProjects.find(p => p.id === selectedQuestionnaire.projectId);
                      const clientName = project?.client || '';
                      return clientName ? (
                        <div className="text-sm italic mt-1" style={{ color: BRAND_GRAY }}>{clientName}</div>
                      ) : null;
                    })()
                  ) : (
                    selectedQuestionnaire?.name && (
                      <div className="text-sm italic mt-1" style={{ color: BRAND_GRAY }}>{selectedQuestionnaire.name}</div>
                    )
                  )}
                </div>
              </div>
              <img
                src="/CogDashLogo.png"
                alt="Cognitive Dash Logo"
                className="h-[3.5rem] w-auto object-contain"
              />
            </div>
            <div className="border-b border-gray-300 mt-4"></div>
          </div>

          {/* Sidebar and Content Container */}
          <div className="flex flex-1 overflow-hidden pt-4">
          {/* Left Sidebar - reduced width */}
          <div className="w-[22%] bg-gray-50 border-r border-gray-200 flex flex-col overflow-hidden">
            {/* Filter Boxes Container - Sections static, Question Types fill remaining */}
            <div className="flex-1 flex flex-col gap-4 pr-4 pt-0 overflow-hidden">
              {/* Sections - No scrolling, always show all */}
              {sectionKeys.length > 0 && (
                <div className="space-y-2 flex-shrink-0">
                  <div className="flex flex-col gap-2">
                    {sectionKeys.map((sectionKey) => {
                      const isSelected = selectedSection === sectionKey;
                      // Use filtered count for display (will be 0 if no questions match the filter)
                      const count = sectionKey === 'QUOTA' 
                        ? (selectedQuestionnaire?.quotas?.length || 0)
                        : (questionsBySection[sectionKey]?.length || 0);
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
                          <span className="text-xs font-medium">
                            {sectionKey === 'QUOTA' ? 'OVERVIEW' : `SECTION ${sectionKey}${sectionKey === 'S' ? ' (SCREENING)' : ''}`}
                          </span>
                          {sectionKey !== 'QUOTA' && (
                            <span className={`ml-1.5 text-xs ${isSelected ? 'text-white' : 'text-gray-500'}`}>
                              ({count})
                            </span>
                          )}
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Question Type Filters - Fill remaining space with scroll */}
              {allQuestionTypes.length > 0 && (
                <div className={`bg-white border border-gray-200 rounded-lg p-4 space-y-2 flex flex-col ${questionTypesExpanded ? 'flex-1 min-h-0' : ''}`}>
                  <button
                    onClick={() => setQuestionTypesExpanded(!questionTypesExpanded)}
                    className="text-xs font-medium text-gray-700 uppercase tracking-wider flex-shrink-0 flex items-center gap-2 hover:text-gray-900 transition-colors w-full"
                  >
                    <FunnelIcon className="h-4 w-4" />
                    <span className="flex-1 text-left">Question Types</span>
                    {questionTypesExpanded ? (
                      <ChevronUpIcon className="h-4 w-4" />
                    ) : (
                      <ChevronDownIcon className="h-4 w-4" />
                    )}
                  </button>
                  {questionTypesExpanded && (
                    <div className="flex flex-col gap-2 overflow-y-auto flex-1 pr-4 min-h-0">
                      {allQuestionTypes.map((type) => {
                        const isSelected = selectedQuestionTypes.has(type);
                        const count = questionTypeCounts[type] || 0;
                        return (
                          <label
                            key={type}
                            className="flex items-center gap-2 px-2 py-1.5 rounded hover:bg-gray-50 cursor-pointer transition-colors flex-shrink-0"
                          >
                            <input
                              type="checkbox"
                              checked={isSelected}
                              onChange={() => toggleQuestionType(type)}
                              className="w-4 h-4 rounded border-gray-300 text-orange-600 focus:ring-2 focus:ring-orange-500 focus:ring-offset-0 cursor-pointer"
                              style={{ accentColor: BRAND_ORANGE }}
                            />
                            <div className="flex items-center gap-1.5 flex-1 min-w-0">
                              <span className="text-xs font-medium text-gray-700 truncate">{type}</span>
                              <span className="text-xs text-gray-500 whitespace-nowrap">
                                ({count})
                              </span>
                            </div>
                          </label>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>

          {/* Right Content Area - 3/4 width */}
          <div className="flex-1 flex flex-col overflow-hidden px-6">
            {selectedSection === 'QUOTA' ? (
              // Always show quota table for quota section (no survey view)
              <>
                {/* Scrollable Content */}
                <div className="flex-1 overflow-y-auto pt-0">
                  {/* QNR Statistics Cards */}
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
                    <div className="rounded-lg p-3 text-white" style={{ backgroundColor: BRAND_ORANGE }}>
                      <div className="text-xs text-white/80 mb-1">Total Questions</div>
                      <div className="text-xl font-bold text-white">
                        {(() => {
                          // Exclude hidden variables (questions with number starting with 'hid_') from count
                          const allQuestions = selectedQuestionnaire?.questions || [];
                          return allQuestions.filter(q => !q.number?.startsWith('hid_')).length;
                        })()}
                      </div>
                    </div>
                    <div className="rounded-lg p-3 text-white" style={{ backgroundColor: BRAND_ORANGE }}>
                      <div className="text-xs text-white/80 mb-1">Fieldwork</div>
                      <div className="text-xl font-bold text-white">
                        {(() => {
                          if (!selectedQuestionnaire?.projectId) return 'N/A';
                          const project = projects.find(p => p.id === selectedQuestionnaire.projectId) || 
                                        archivedProjects.find(p => p.id === selectedQuestionnaire.projectId);
                          if (!project) return 'N/A';
                          
                          // Try to get fieldwork dates from segments
                          const segments = project.segments || [];
                          const fieldingSegment = segments.find((s: any) => s.phase === 'Fielding');
                          
                          if (fieldingSegment?.startDate && fieldingSegment?.endDate) {
                            const startDate = new Date(fieldingSegment.startDate);
                            const endDate = new Date(fieldingSegment.endDate);
                            return `${startDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} - ${endDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`;
                          }
                          
                          // Try phaseTimeline as fallback
                          const phaseTimeline = project.phaseTimeline || {};
                          const fieldingPhase = phaseTimeline['Fielding'];
                          if (fieldingPhase?.start && fieldingPhase?.end) {
                            const startDate = new Date(fieldingPhase.start);
                            const endDate = new Date(fieldingPhase.end);
                            return `${startDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} - ${endDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`;
                          }
                          
                          return 'N/A';
                        })()}
                      </div>
                    </div>
                    <div className="rounded-lg p-3 text-white" style={{ backgroundColor: BRAND_ORANGE }}>
                      <div className="text-xs text-white/80 mb-1">LOI</div>
                      <div className="text-xl font-bold text-white">
                        {(() => {
                          if (!selectedQuestionnaire?.questions || selectedQuestionnaire.questions.length === 0) {
                            return '0 min';
                          }
                          
                          // Filter out hidden variables (questions starting with 'hid_')
                          // Note: Quotas are stored separately in the quotas array, so they're already excluded
                          const visibleQuestions = selectedQuestionnaire.questions.filter((q: Question) => 
                            !q.number?.startsWith('hid_')
                          );
                          
                          if (visibleQuestions.length === 0) {
                            return '0 min';
                          }
                          
                          let totalMinutes = 0;
                          
                          visibleQuestions.forEach((question: Question) => {
                            const typeLower = question.type?.toLowerCase() || '';
                            
                            // Base time per question type (in minutes)
                            let baseTime = 0.4; // Default 24 seconds
                            
                            if (typeLower.includes('single select')) {
                              baseTime = 0.25; // 15 seconds
                              // Add time for reading options (1.5 seconds per option)
                              const optionsCount = question.options?.length || 0;
                              baseTime += (optionsCount * 0.025); // ~1.5 seconds per option
                            } else if (typeLower.includes('multi-select')) {
                              baseTime = 0.4; // 24 seconds
                              // Add time for reading and selecting options (2.5 seconds per option)
                              const optionsCount = question.options?.length || 0;
                              baseTime += (optionsCount * 0.042); // ~2.5 seconds per option
                            } else if (typeLower.includes('open end')) {
                              if (typeLower.includes('list')) {
                                // Open end list - multiple text boxes
                                baseTime = 0.8; // 48 seconds base
                                const responseOptionsCount = question.responseOptions?.length || 0;
                                baseTime += (responseOptionsCount * 0.4); // 24 seconds per text box
                              } else {
                                // Single open end
                                baseTime = 0.8; // 48 seconds for typing
                              }
                            } else if (typeLower.includes('numeric')) {
                              if (typeLower.includes('grid')) {
                                baseTime = 0.3; // 18 seconds base
                                const statementCount = question.statementOptions?.length || 0;
                                const responseCount = question.responseOptions?.length || 0;
                                baseTime += (statementCount * responseCount * 0.04); // 2.4 seconds per cell
                              } else if (typeLower.includes('list')) {
                                baseTime = 0.25; // 15 seconds base
                                const responseOptionsCount = question.responseOptions?.length || 0;
                                baseTime += (responseOptionsCount * 0.08); // 5 seconds per numeric input
                              } else {
                                // Single numeric
                                baseTime = 0.15; // 9 seconds
                              }
                            } else if (typeLower.includes('grid')) {
                              baseTime = 0.4; // 24 seconds base
                              const statementCount = question.statementOptions?.length || 0;
                              const responseCount = question.responseOptions?.length || 0;
                              // Grid questions take longer - need to read row and column
                              baseTime += (statementCount * responseCount * 0.067); // ~4 seconds per cell
                            } else if (typeLower.includes('scale')) {
                              baseTime = 0.35; // 21 seconds
                              const optionsCount = question.options?.length || 0;
                              baseTime += (optionsCount * 0.025); // ~1.5 seconds per option
                            }
                            
                            totalMinutes += baseTime;
                          });
                          
                          // Round to nearest minute
                          const roundedMinutes = Math.round(totalMinutes);
                          return `${roundedMinutes} min`;
                        })()}
                      </div>
                    </div>
                    <div className="rounded-lg p-3 text-white" style={{ backgroundColor: BRAND_ORANGE }}>
                      <div className="text-xs text-white/80 mb-1">Open Ended Questions</div>
                      <div className="text-xl font-bold text-white">
                        {selectedQuestionnaire?.questions?.filter(q => {
                          const typeLower = q.type?.toLowerCase() || '';
                          return typeLower.includes('open end');
                        }).length || 0}
                      </div>
                    </div>
                  </div>
                  {/* Download Boxes */}
                  <div className="grid grid-cols-2 gap-3 mb-6">
                    <button
                      onClick={downloadQNRAsWord}
                      className="rounded-lg p-4 bg-white border-2 border-gray-300 text-gray-700 hover:border-gray-400 hover:bg-gray-50 transition-all cursor-pointer flex flex-col items-center justify-center gap-2"
                    >
                      <DocumentTextIcon className="w-6 h-6" />
                      <div className="text-sm font-semibold text-center">Download as Word</div>
                      <div className="text-xs text-gray-500 text-center">Full QNR Document</div>
                    </button>
                    <button
                      onClick={downloadQNRAsForstaXML}
                      className={`rounded-lg p-4 border-2 transition-all cursor-pointer flex flex-col items-center justify-center gap-2 ${
                        xmlCopied
                          ? 'bg-green-50 border-green-400 text-green-700'
                          : 'bg-white border-gray-300 text-gray-700 hover:border-gray-400 hover:bg-gray-50'
                      }`}
                    >
                      {xmlCopied ? (
                        <>
                          <CheckIcon className="w-6 h-6" />
                          <div className="text-sm font-semibold text-center">Copied!</div>
                          <div className="text-xs text-green-600 text-center">XML in clipboard</div>
                        </>
                      ) : (
                        <>
                          <ClipboardDocumentIcon className="w-6 h-6" />
                          <div className="text-sm font-semibold text-center">Copy Forsta XML</div>
                          <div className="text-xs text-gray-500 text-center">Survey Programming Code</div>
                        </>
                      )}
                    </button>
                  </div>
                <div className="flex items-center justify-between mb-2">
                  <h3 className="text-md font-semibold text-gray-900">Quotas</h3>
                  <button
                    onClick={() => {
                      setEditQuotas([...(selectedQuestionnaire?.quotas || [])]);
                      setEditingQuotasModal(true);
                    }}
                    className="p-1 text-gray-400 hover:text-gray-600 transition-colors"
                    title="Edit quotas"
                  >
                    <PencilIcon className="w-4 h-4" />
                  </button>
                </div>
                {selectedQuestionnaire?.quotas && selectedQuestionnaire.quotas.length > 0 ? (
                  <div className="overflow-x-auto border border-gray-300 rounded-lg overflow-hidden">
                    <table className="min-w-full divide-y divide-gray-200">
                      <thead className="bg-white">
                        <tr>
                          <th className="px-4 py-3 text-left text-xs font-medium text-black uppercase tracking-wider">
                            Quota
                          </th>
                          <th className="px-4 py-3 text-center text-xs font-medium text-black uppercase tracking-wider">
                            Total Sample
                          </th>
                        </tr>
                      </thead>
                      <tbody className="bg-white divide-y divide-gray-200">
                        {(() => {
                          // Sort quotas so "TOTAL" always appears first
                          const sortedQuotas = [...(selectedQuestionnaire.quotas || [])].sort((a, b) => {
                            const aName = (a.name || a.conditions?.join(', ') || '').toUpperCase();
                            const bName = (b.name || b.conditions?.join(', ') || '').toUpperCase();
                            if (aName === 'TOTAL') return -1;
                            if (bName === 'TOTAL') return 1;
                            return 0;
                          });
                          return sortedQuotas.map((quota, index) => (
                            <tr key={index} className="hover:bg-gray-50">
                              <td className="px-4 py-3 text-sm text-gray-900">
                                {quota.name || quota.conditions?.join(', ') || `Quota ${index + 1}`}
                              </td>
                              <td className="px-4 py-3 text-sm text-gray-900 text-center">
                                n={quota.limit || 0}
                              </td>
                            </tr>
                          ));
                        })()}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <div className="text-center py-12 bg-white border border-gray-200 rounded-lg">
                    <p className="text-gray-500">No quotas in this section.</p>
                  </div>
                )}
                {/* Display hidden variables if any */}
                {selectedSectionQuestions.length > 0 && (
                  <div className="mt-6">
                    <h3 className="text-md font-semibold text-gray-900 mb-4">Hidden Variables</h3>
                    {selectedSectionQuestions.map((question, index) => (
                      <React.Fragment key={question.id || index}>
                        <QuestionBox 
                          question={question} 
                          index={index}
                          variableData={variableData}
                          onUpdateQuestion={(updatedQuestion) => {
                            // Update the question in the selected questionnaire
                            // Prioritize ID matching (more stable), then fall back to number matching
                            const updatedQuestions = selectedQuestionnaire.questions.map(q => {
                              // Match by ID first (most reliable)
                              if (q.id && updatedQuestion.id && q.id === updatedQuestion.id) {
                                return updatedQuestion;
                              }
                              // Fall back to number matching if IDs don't match or don't exist
                              if ((q.number || q.id) === (updatedQuestion.number || updatedQuestion.id)) {
                                return updatedQuestion;
                              }
                              return q;
                            });
                            setSelectedQuestionnaire({
                              ...selectedQuestionnaire,
                              questions: updatedQuestions
                            });
                            return updatedQuestions;
                          }}
                          questionnaireId={selectedQuestionnaire.id}
                        />
                        {index < selectedSectionQuestions.length - 1 && (
                          <div className="relative my-4 h-0 flex items-center justify-center">
                            <div className="absolute left-0 right-0 top-0 border-t border-dashed border-gray-300"></div>
                            <button
                              onClick={() => showQuestionTypeSelectorForIndex(index)}
                              className="relative bg-white rounded-full border border-gray-300 w-6 h-6 flex items-center justify-center z-20 hover:bg-gray-50 hover:border-gray-400 cursor-pointer transition-colors"
                              title="Add new question here"
                            >
                              <PlusIcon className="w-3 h-3 text-gray-500" strokeWidth={2} />
                            </button>
                          </div>
                        )}
                      </React.Fragment>
                    ))}
                  </div>
                )}
                </div>
              </>
            ) : surveyView ? (
              /* Survey View */
              <>
                {/* Scrollable Content */}
                <div className="flex-1 overflow-y-auto pt-0">
                  {selectedSectionQuestions.length === 0 ? (
                    <div className="text-center py-12 bg-white border border-gray-200 rounded-lg">
                      <p className="text-gray-500">No questions in the selected section.</p>
                    </div>
                  ) : (
                    <div className="space-y-6">
                      <button
                        onClick={() => setSurveyView(!surveyView)}
                        className={`flex items-center justify-start gap-1.5 px-2.5 py-1 text-xs font-medium rounded transition-colors w-28 mb-4 ${
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
                        <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <circle cx="12" cy="12" r="8" strokeWidth="2" />
                          {surveyView && <circle cx="12" cy="12" r="4" fill="currentColor" />}
                        </svg>
                        {surveyView ? 'QNR View' : 'Survey View'}
                      </button>
                      {selectedSectionQuestions.map((question, index) => (
                      <SurveyQuestionView 
                        key={question.number || question.id || index}
                        question={question} 
                        index={index}
                        onUpdateQuestion={(updatedQuestion) => {
                          // Update the question in the selected questionnaire
                          // Prioritize ID matching (more stable), then fall back to number matching
                          const updatedQuestions = selectedQuestionnaire.questions.map(q => {
                            // Match by ID first (most reliable)
                            if (q.id && updatedQuestion.id && q.id === updatedQuestion.id) {
                              return updatedQuestion;
                            }
                            // Fall back to number matching if IDs don't match or don't exist
                            if ((q.number || q.id) === (updatedQuestion.number || updatedQuestion.id)) {
                              return updatedQuestion;
                            }
                            return q;
                          });
                          setSelectedQuestionnaire({
                            ...selectedQuestionnaire,
                            questions: updatedQuestions
                          });
                          return updatedQuestions;
                        }}
                        questionnaireId={selectedQuestionnaire.id}
                      />
                      ))}
                    </div>
                  )}
                </div>
              </>
            ) : (
              /* Default QNR View - Floating Question Boxes */
              <>
                {selectedSection === 'QUOTA' && selectedQuestionnaire?.quotas && selectedQuestionnaire.quotas.length > 0 ? (
                  <>
                  {selectedSection === 'QUOTA' && (
                    <div className="mb-4">
                      <div className="flex items-center justify-between mb-2">
                        <div className="text-lg font-semibold text-gray-900">{selectedQuestionnaire?.name || 'QUOTA'}</div>
                        {selectedQuestionnaire?.createdAt && (
                          <span className="text-sm text-gray-500 italic">
                            {new Date(selectedQuestionnaire.createdAt).toLocaleDateString()}
                          </span>
                        )}
                      </div>
                      <div className="flex items-center justify-between">
                        <h3 className="text-md font-semibold text-gray-900">Quotas</h3>
                        <button
                          onClick={() => {
                            setEditQuotas([...(selectedQuestionnaire?.quotas || [])]);
                            setEditingQuotasModal(true);
                          }}
                          className="p-1 text-gray-400 hover:text-gray-600 transition-colors"
                          title="Edit quotas"
                        >
                          <PencilIcon className="w-4 h-4" />
                        </button>
                      </div>
                    </div>
                  )}
                    {/* Display quotas as a table */}
                    <div className="overflow-x-auto border border-gray-300 rounded-lg overflow-hidden">
                      <table className="min-w-full divide-y divide-gray-200">
                        <thead className="bg-white">
                          <tr>
                            <th className="px-4 py-3 text-left text-xs font-medium text-gray-700 uppercase tracking-wider">
                              Quota
                            </th>
                            <th className="px-4 py-3 text-center text-xs font-medium text-gray-700 uppercase tracking-wider">
                              Total Sample
                            </th>
                          </tr>
                        </thead>
                        <tbody className="bg-white divide-y divide-gray-200">
                          {(() => {
                            // Sort quotas so "TOTAL" always appears first
                            const sortedQuotas = [...(selectedQuestionnaire.quotas || [])].sort((a, b) => {
                              const aName = (a.name || a.conditions?.join(', ') || '').toUpperCase();
                              const bName = (b.name || b.conditions?.join(', ') || '').toUpperCase();
                              if (aName === 'TOTAL') return -1;
                              if (bName === 'TOTAL') return 1;
                              return 0;
                            });
                            return sortedQuotas.map((quota, index) => (
                              <tr key={index} className="hover:bg-gray-50">
                                <td className="px-4 py-3 text-sm text-gray-900">
                                  {quota.name || quota.conditions?.join(', ') || `Quota ${index + 1}`}
                                </td>
                                <td className="px-4 py-3 text-sm text-gray-900 text-center">
                                  n={quota.limit || 0}
                                </td>
                              </tr>
                            ));
                          })()}
                        </tbody>
                      </table>
                    </div>
                    {/* Display hidden variables if any */}
                    {selectedSectionQuestions.length > 0 && (
                      <div className="mt-6">
                        <h3 className="text-md font-semibold text-gray-900 mb-4">Hidden Variables</h3>
                        {selectedSectionQuestions.map((question, index) => (
                          <React.Fragment key={question.id || index}>
                            <QuestionBox 
                              question={question} 
                              index={index}
                              variableData={variableData}
                              onUpdateQuestion={(updatedQuestion) => {
                                // Update the question in the selected questionnaire
                                // Prioritize ID matching (more stable), then fall back to number matching
                                const updatedQuestions = selectedQuestionnaire.questions.map(q => {
                                  // Match by ID first (most reliable)
                                  if (q.id && updatedQuestion.id && q.id === updatedQuestion.id) {
                                    return updatedQuestion;
                                  }
                                  // Fall back to number matching if IDs don't match or don't exist
                                  if ((q.number || q.id) === (updatedQuestion.number || updatedQuestion.id)) {
                                    return updatedQuestion;
                                  }
                                  return q;
                                });
                                setSelectedQuestionnaire({
                                  ...selectedQuestionnaire,
                                  questions: updatedQuestions
                                });
                                return updatedQuestions;
                              }}
                              questionnaireId={selectedQuestionnaire.id}
                            />
                            {index < selectedSectionQuestions.length - 1 && (
                              <div className="relative my-4 h-0 flex items-center justify-center">
                                <div className="absolute left-0 right-0 top-0 border-t border-dashed border-gray-300"></div>
                                <button
                                  onClick={() => showQuestionTypeSelectorForIndex(index)}
                                  className="relative bg-white rounded-full border border-gray-300 w-6 h-6 flex items-center justify-center z-20 hover:bg-gray-50 hover:border-gray-400 cursor-pointer transition-colors"
                                  title="Add new question here"
                                >
                                  <PlusIcon className="w-3 h-3 text-gray-500" strokeWidth={2} />
                                </button>
                              </div>
                            )}
                          </React.Fragment>
                        ))}
                      </div>
                    )}
                  </>
                ) : (
                  <>
                    {/* Scrollable Content */}
                    <div className="flex-1 overflow-y-auto pt-0">
                      {selectedSectionQuestions.length === 0 ? (
                        <div className="text-center py-12 bg-white border border-gray-200 rounded-lg">
                          <p className="text-gray-500">No questions in the selected section.</p>
                        </div>
                      ) : (
                        <div className="space-y-4">
                          <button
                            onClick={() => setSurveyView(!surveyView)}
                            className={`flex items-center justify-start gap-1.5 px-2.5 py-1 text-xs font-medium rounded transition-colors w-28 mb-4 ${
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
                            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                              <circle cx="12" cy="12" r="8" strokeWidth="2" />
                              {surveyView && <circle cx="12" cy="12" r="4" fill="currentColor" />}
                            </svg>
                            {surveyView ? 'QNR View' : 'Survey View'}
                          </button>
                          {selectedSectionQuestions.map((question, index) => (
                      <React.Fragment key={question.id || index}>
                        <QuestionBox 
                          question={question} 
                          index={index}
                          variableData={variableData}
                          onUpdateQuestion={(updatedQuestion) => {
                            // Update the question in the selected questionnaire
                            // Prioritize ID matching (more stable), then fall back to number matching
                            const updatedQuestions = selectedQuestionnaire.questions.map(q => {
                              // Match by ID first (most reliable)
                              if (q.id && updatedQuestion.id && q.id === updatedQuestion.id) {
                                return updatedQuestion;
                              }
                              // Fall back to number matching if IDs don't match or don't exist
                              if ((q.number || q.id) === (updatedQuestion.number || updatedQuestion.id)) {
                                return updatedQuestion;
                              }
                              return q;
                            });
                            setSelectedQuestionnaire({
                              ...selectedQuestionnaire,
                              questions: updatedQuestions
                            });
                            return updatedQuestions;
                          }}
                          questionnaireId={selectedQuestionnaire.id}
                        />
                        {index < selectedSectionQuestions.length - 1 && (
                          <div className="relative my-4 h-0 flex items-center justify-center">
                            <div className="absolute left-0 right-0 top-0 border-t border-dashed border-gray-300"></div>
                            <button
                              onClick={() => showQuestionTypeSelectorForIndex(index)}
                              className="relative bg-white rounded-full border border-gray-300 w-6 h-6 flex items-center justify-center z-20 hover:bg-gray-50 hover:border-gray-400 cursor-pointer transition-colors"
                              title="Add new question here"
                            >
                              <PlusIcon className="w-3 h-3 text-gray-500" strokeWidth={2} />
                            </button>
                          </div>
                        )}
                      </React.Fragment>
                          ))}
                        </div>
                      )}
                    </div>
                  </>
                )}
              </>
            )}
          </div>
          </div>
        </div>
      )}

      {/* Question Type Selector Modal */}
      {showQuestionTypeSelector && (
        <div className="fixed bg-black bg-opacity-50 flex items-center justify-center z-50" style={{ top: 0, left: 0, right: 0, bottom: 0, margin: 0, padding: 0 }} onClick={() => {
          setShowQuestionTypeSelector(false);
          setPendingQuestionInsertIndex(null);
          setPreviewQuestionType(null);
        }}>
          <div className="bg-white rounded-lg w-full max-w-4xl mx-4 max-h-[90vh] overflow-y-auto overflow-x-hidden relative" onClick={(e) => e.stopPropagation()}>
            {!previewQuestionType ? (
              <>
                <div className="sticky top-0 bg-white z-10 p-6 pb-4 border-b border-gray-200">
                  <div className="flex items-start justify-between">
                    <div>
                      <h2 className="text-xl font-semibold text-gray-900">Select Question Type</h2>
                      <p className="text-sm text-gray-500 mt-1">Choose a question type for your new question</p>
                    </div>
                    <button
                      onClick={() => {
                        setShowQuestionTypeSelector(false);
                        setPendingQuestionInsertIndex(null);
                        setPreviewQuestionType(null);
                      }}
                      className="ml-4 text-gray-400 hover:text-gray-600 transition-colors"
                    >
                      <XMarkIcon className="w-6 h-6" />
                    </button>
                  </div>
                </div>
                
                <div className="p-6 pt-6 space-y-6">
              {/* Standard Category */}
              <div>
                <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                  {[
                    { 
                      type: 'Single Select', 
                      description: 'One answer choice', 
                      icon: ({ className }: { className?: string }) => (
                        <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <circle cx="12" cy="12" r="8" strokeWidth="2" fill="none"/>
                          <circle cx="12" cy="12" r="3" fill="currentColor"/>
                        </svg>
                      ),
                      example: 'Which brand do you prefer?\n○ Brand A\n○ Brand B\n○ Brand C',
                      tags: []
                    },
                    { 
                      type: 'Scale Rating Single Select', 
                      description: 'Rating scale (1-5, 1-7, etc.)', 
                      icon: ({ className }: { className?: string }) => (
                        <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11.049 2.927c.3-.921 1.603-.921 1.902 0l1.519 4.674a1 1 0 00.95.69h4.915c.969 0 1.371 1.24.588 1.81l-3.976 2.888a1 1 0 00-.363 1.118l1.518 4.674c.3.922-.755 1.688-1.538 1.118l-3.976-2.888a1 1 0 00-1.176 0l-3.976 2.888c-.783.57-1.838-.197-1.538-1.118l1.518-4.674a1 1 0 00-.363-1.118l-3.976-2.888c-.784-.57-.38-1.81.588-1.81h4.914a1 1 0 00.951-.69l1.519-4.674z" />
                        </svg>
                      ),
                      example: 'How satisfied are you?',
                      exampleTable: true,
                      tags: ['Scale']
                    },
                    { 
                      type: 'Multi-Select', 
                      description: 'Multiple answer choices', 
                      icon: IconCheckbox,
                      example: 'Which features are important? (Select all)\n☐ Feature 1\n☐ Feature 2\n☐ Feature 3',
                      tags: []
                    }
                      ].map(({ type, description, icon: Icon, example, exampleTable = false, tags = [] }, index, array) => {
                        const totalItems = array.length;
                        const isTopRow = index < 3;
                        const isBottomRow = index >= Math.floor((totalItems - 1) / 3) * 3;
                        return (
                    <div key={type} className="relative group/card">
                      <button
                        onClick={() => showPreviewForType(type)}
                        className="w-full p-4 border-2 border-gray-200 rounded-lg transition-all text-left flex items-start gap-3"
                        onMouseEnter={(e) => {
                          e.currentTarget.style.borderColor = BRAND_ORANGE;
                          e.currentTarget.style.backgroundColor = BRAND_ORANGE;
                        }}
                        onMouseLeave={(e) => {
                          const card = e.currentTarget.closest('.group\\/card');
                          if (card && !card.matches(':hover')) {
                            e.currentTarget.style.borderColor = '#E5E7EB';
                            e.currentTarget.style.backgroundColor = '';
                          }
                        }}
                      >
                        <Icon className="w-6 h-6 text-gray-400 group-hover/card:text-white flex-shrink-0 mt-0.5 transition-colors" />
                        <div className="flex-1">
                          <div className="font-medium text-gray-900 group-hover/card:text-white transition-colors">{type}</div>
                          <div className="text-sm text-gray-500 group-hover/card:text-white mt-1 transition-colors">{description}</div>
                        </div>
                      </button>
                      <div 
                        className="absolute top-2 right-2" 
                        onClick={(e) => e.stopPropagation()}
                        onMouseEnter={(e) => {
                          const card = e.currentTarget.closest('.group\\/card');
                          const button = card?.querySelector('button');
                          if (button) {
                            (button as HTMLElement).style.borderColor = BRAND_ORANGE;
                            (button as HTMLElement).style.backgroundColor = BRAND_ORANGE;
                          }
                        }}
                        onMouseLeave={(e) => {
                          const card = e.currentTarget.closest('.group\\/card');
                          const button = card?.querySelector('button');
                          if (button && !card?.matches(':hover')) {
                            (button as HTMLElement).style.borderColor = '#E5E7EB';
                            (button as HTMLElement).style.backgroundColor = '';
                          }
                        }}
                      >
                        <div className="relative group/info">
                          <InformationCircleIcon className="w-5 h-5 text-gray-400 group-hover/card:text-white hover:text-white cursor-help transition-colors" />
                          <div className={`absolute ${isBottomRow ? 'bottom-6' : isTopRow ? 'top-0' : 'top-6'} w-80 p-3 bg-white border border-gray-300 text-gray-900 text-xs rounded-lg shadow-xl opacity-0 invisible group-hover/info:opacity-100 group-hover/info:visible transition-all z-50`} style={index === 0 ? { left: '0', right: 'auto', maxWidth: 'min(320px, calc(100vw - 4rem))' } : { right: '0', left: 'auto', maxWidth: 'min(320px, calc(100vw - 4rem))' }}>
                            <div className="font-semibold mb-2 text-sm">{type} Example:</div>
                            {exampleTable ? (
                              <div className="text-xs">
                                <div className="mb-2">{example}</div>
                                {type === 'Scale Rating Single Select' ? (
                                  <table className="w-full border-collapse border border-gray-400" style={{ tableLayout: 'fixed' }}>
                                    <colgroup>
                                      <col style={{ width: '18%' }} />
                                      <col style={{ width: '12%' }} />
                                      <col style={{ width: '12%' }} />
                                      <col style={{ width: '12%' }} />
                                      <col style={{ width: '12%' }} />
                                      <col style={{ width: '12%' }} />
                                      <col style={{ width: '18%' }} />
                                    </colgroup>
                                    <thead>
                                      <tr>
                                        <th className="border border-gray-400 px-2 py-1 text-center align-middle">
                                          <div className="text-center">1</div>
                                          <div className="text-[10px] font-normal text-center">Not at All</div>
                                        </th>
                                        <th className="border border-gray-400 px-2 py-1 text-center align-middle">2</th>
                                        <th className="border border-gray-400 px-2 py-1 text-center align-middle">3</th>
                                        <th className="border border-gray-400 px-2 py-1 text-center align-middle">4</th>
                                        <th className="border border-gray-400 px-2 py-1 text-center align-middle">5</th>
                                        <th className="border border-gray-400 px-2 py-1 text-center align-middle">6</th>
                                        <th className="border border-gray-400 px-2 py-1 text-center align-middle">
                                          <div className="text-center">7</div>
                                          <div className="text-[10px] font-normal text-center">Extremely</div>
                                        </th>
                                      </tr>
                                    </thead>
                                    <tbody>
                                      <tr>
                                        <td className="border border-gray-400 px-2 py-1 text-center align-middle">○</td>
                                        <td className="border border-gray-400 px-2 py-1 text-center align-middle">○</td>
                                        <td className="border border-gray-400 px-2 py-1 text-center align-middle">○</td>
                                        <td className="border border-gray-400 px-2 py-1 text-center align-middle">○</td>
                                        <td className="border border-gray-400 px-2 py-1 text-center align-middle">○</td>
                                        <td className="border border-gray-400 px-2 py-1 text-center align-middle">○</td>
                                        <td className="border border-gray-400 px-2 py-1 text-center align-middle">○</td>
                                      </tr>
                                    </tbody>
                                  </table>
                                ) : type === 'Single Select Grid' ? (
                                  <table className="w-full border-collapse border border-gray-400" style={{ tableLayout: 'fixed' }}>
                                    <colgroup>
                                      <col style={{ width: '30%' }} />
                                      <col style={{ width: '14%' }} />
                                      <col style={{ width: '14%' }} />
                                      <col style={{ width: '14%' }} />
                                      <col style={{ width: '14%' }} />
                                      <col style={{ width: '14%' }} />
                                    </colgroup>
                                    <thead>
                                      <tr>
                                        <th className="border border-gray-400 px-2 py-1 text-center align-middle"></th>
                                        <th className="border border-gray-400 px-2 py-1 text-center align-middle">1</th>
                                        <th className="border border-gray-400 px-2 py-1 text-center align-middle">2</th>
                                        <th className="border border-gray-400 px-2 py-1 text-center align-middle">3</th>
                                        <th className="border border-gray-400 px-2 py-1 text-center align-middle">4</th>
                                        <th className="border border-gray-400 px-2 py-1 text-center align-middle">5</th>
                                      </tr>
                                    </thead>
                                    <tbody>
                                      <tr>
                                        <td className="border border-gray-400 px-2 py-1 text-left align-middle">Item 1</td>
                                        <td className="border border-gray-400 px-2 py-1 text-center align-middle">○</td>
                                        <td className="border border-gray-400 px-2 py-1 text-center align-middle">○</td>
                                        <td className="border border-gray-400 px-2 py-1 text-center align-middle">○</td>
                                        <td className="border border-gray-400 px-2 py-1 text-center align-middle">○</td>
                                        <td className="border border-gray-400 px-2 py-1 text-center align-middle">○</td>
                                      </tr>
                                      <tr>
                                        <td className="border border-gray-400 px-2 py-1 text-left align-middle">Item 2</td>
                                        <td className="border border-gray-400 px-2 py-1 text-center align-middle">○</td>
                                        <td className="border border-gray-400 px-2 py-1 text-center align-middle">○</td>
                                        <td className="border border-gray-400 px-2 py-1 text-center align-middle">○</td>
                                        <td className="border border-gray-400 px-2 py-1 text-center align-middle">○</td>
                                        <td className="border border-gray-400 px-2 py-1 text-center align-middle">○</td>
                                      </tr>
                                    </tbody>
                                  </table>
                                ) : type === 'Multi-Select Grid' ? (
                                  <table className="w-full border-collapse border border-gray-400" style={{ tableLayout: 'fixed' }}>
                                    <colgroup>
                                      <col style={{ width: '40%' }} />
                                      <col style={{ width: '30%' }} />
                                      <col style={{ width: '30%' }} />
                                    </colgroup>
                                    <thead>
                                      <tr>
                                        <th className="border border-gray-400 px-2 py-1 text-center align-middle"></th>
                                        <th className="border border-gray-400 px-2 py-1 text-center align-middle">Yes</th>
                                        <th className="border border-gray-400 px-2 py-1 text-center align-middle">No</th>
                                      </tr>
                                    </thead>
                                    <tbody>
                                      <tr>
                                        <td className="border border-gray-400 px-2 py-1 text-left align-middle">Item 1</td>
                                        <td className="border border-gray-400 px-2 py-1 text-center align-middle">☐</td>
                                        <td className="border border-gray-400 px-2 py-1 text-center align-middle">☐</td>
                                      </tr>
                                      <tr>
                                        <td className="border border-gray-400 px-2 py-1 text-left align-middle">Item 2</td>
                                        <td className="border border-gray-400 px-2 py-1 text-center align-middle">☐</td>
                                        <td className="border border-gray-400 px-2 py-1 text-center align-middle">☐</td>
                                      </tr>
                                    </tbody>
                                  </table>
                                ) : type === 'Numeric Grid' ? (
                                  <table className="w-full border-collapse border border-gray-400" style={{ tableLayout: 'fixed' }}>
                                    <colgroup>
                                      <col style={{ width: '35%' }} />
                                      <col style={{ width: '22%' }} />
                                      <col style={{ width: '22%' }} />
                                      <col style={{ width: '21%' }} />
                                    </colgroup>
                                    <thead>
                                      <tr>
                                        <th className="border border-gray-400 px-2 py-1 text-center align-middle"></th>
                                        <th className="border border-gray-400 px-2 py-1 text-center align-middle">18-34</th>
                                        <th className="border border-gray-400 px-2 py-1 text-center align-middle">35-54</th>
                                        <th className="border border-gray-400 px-2 py-1 text-center align-middle">55+</th>
                                      </tr>
                                    </thead>
                                    <tbody>
                                      <tr>
                                        <td className="border border-gray-400 px-2 py-1 text-left align-middle">Treatment A</td>
                                        <td className="border border-gray-400 px-2 py-1 text-center align-middle">
                                          <div className="inline-block w-12 h-6 bg-white border border-gray-300 rounded"></div>
                                        </td>
                                        <td className="border border-gray-400 px-2 py-1 text-center align-middle">
                                          <div className="inline-block w-12 h-6 bg-white border border-gray-300 rounded"></div>
                                        </td>
                                        <td className="border border-gray-400 px-2 py-1 text-center align-middle">
                                          <div className="inline-block w-12 h-6 bg-white border border-gray-300 rounded"></div>
                                        </td>
                                      </tr>
                                      <tr>
                                        <td className="border border-gray-400 px-2 py-1 text-left align-middle">Treatment B</td>
                                        <td className="border border-gray-400 px-2 py-1 text-center align-middle">
                                          <div className="inline-block w-12 h-6 bg-white border border-gray-300 rounded"></div>
                                        </td>
                                        <td className="border border-gray-400 px-2 py-1 text-center align-middle">
                                          <div className="inline-block w-12 h-6 bg-white border border-gray-300 rounded"></div>
                                        </td>
                                        <td className="border border-gray-400 px-2 py-1 text-center align-middle">
                                          <div className="inline-block w-12 h-6 bg-white border border-gray-300 rounded"></div>
                                        </td>
                                      </tr>
                                    </tbody>
                                  </table>
                                ) : null}
                              </div>
                            ) : (type === 'Numeric' || type === 'Numeric Grid' || type === 'Open End' || type === 'Open End List') ? (
                              <div className="text-xs space-y-2">
                                {example.split('\n').map((line, lineIdx) => {
                                  const parts = line.split(/(\[[^\]]+\])/);
                                  return (
                                    <div key={lineIdx} className="flex items-center gap-2 flex-wrap">
                                      {parts.map((part, partIdx) => {
                                        if (part.match(/^\[.+\]$/)) {
                                          const isOpenEnd = type === 'Open End' || type === 'Open End List';
                                          const isSingleOpenEnd = type === 'Open End';
                                          const width = isSingleOpenEnd ? 'w-full' : (part.length > 10 ? 'w-32' : part.length > 5 ? 'w-20' : 'w-16');
                                          const height = isSingleOpenEnd ? 'h-12' : 'h-6';
                                          return (
                                            <div
                                              key={partIdx}
                                              className={`${width} ${height} bg-white border border-gray-300 rounded`}
                                            ></div>
                                          );
                                        }
                                        return <span key={partIdx}>{part}</span>;
                                      })}
                                    </div>
                                  );
                                })}
                              </div>
                            ) : (
                              <div className="font-mono text-xs leading-relaxed whitespace-pre-line">{example}</div>
                            )}
                            <div className={`absolute ${isBottomRow ? '-bottom-1 border-b border-r' : '-top-1 border-l border-t'} w-2 h-2 bg-white border-gray-300 transform rotate-45`} style={index === 0 ? { left: '1rem' } : { right: '1rem' }}></div>
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                  })}
                </div>
              </div>

              {/* Grids Category */}
              <div>
                <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                  {[
                    { 
                      type: 'Single Select Grid', 
                      description: 'Single selection in a grid', 
                      icon: TableCellsIcon,
                      example: 'Rate each item (1-5 scale)',
                      exampleTable: true
                    },
                    { 
                      type: 'Multi-Select Grid', 
                      description: 'Multiple selections in a grid', 
                      icon: TableCellsIcon,
                      example: 'Select all that apply',
                      exampleTable: true
                    },
                    { 
                      type: 'Numeric Grid', 
                      description: 'Numeric values in a grid', 
                      icon: TableCellsIcon,
                      example: 'How many patients by age group?',
                      exampleTable: true
                    }
                  ].map(({ type, description, icon: Icon, example, exampleTable = false }, index, array) => {
                        const totalItems = array.length;
                        const isTopRow = index < 3;
                        const isBottomRow = index >= Math.floor((totalItems - 1) / 3) * 3;
                        return (
                    <div key={type} className="relative group/card">
                      <button
                        onClick={() => showPreviewForType(type)}
                        className="w-full p-4 border-2 border-gray-200 rounded-lg transition-all text-left flex items-start gap-3"
                        onMouseEnter={(e) => {
                          e.currentTarget.style.borderColor = BRAND_ORANGE;
                          e.currentTarget.style.backgroundColor = BRAND_ORANGE;
                        }}
                        onMouseLeave={(e) => {
                          const card = e.currentTarget.closest('.group\\/card');
                          if (card && !card.matches(':hover')) {
                            e.currentTarget.style.borderColor = '#E5E7EB';
                            e.currentTarget.style.backgroundColor = '';
                          }
                        }}
                      >
                        <Icon className="w-6 h-6 text-gray-400 group-hover/card:text-white flex-shrink-0 mt-0.5 transition-colors" />
                        <div className="flex-1">
                          <div className="font-medium text-gray-900 group-hover/card:text-white transition-colors">{type}</div>
                          <div className="text-sm text-gray-500 group-hover/card:text-white mt-1 transition-colors">{description}</div>
                        </div>
                      </button>
                      <div 
                        className="absolute top-2 right-2" 
                        onClick={(e) => e.stopPropagation()}
                        onMouseEnter={(e) => {
                          const card = e.currentTarget.closest('.group\\/card');
                          const button = card?.querySelector('button');
                          if (button) {
                            (button as HTMLElement).style.borderColor = BRAND_ORANGE;
                            (button as HTMLElement).style.backgroundColor = BRAND_ORANGE;
                          }
                        }}
                        onMouseLeave={(e) => {
                          const card = e.currentTarget.closest('.group\\/card');
                          const button = card?.querySelector('button');
                          if (button && !card?.matches(':hover')) {
                            (button as HTMLElement).style.borderColor = '#E5E7EB';
                            (button as HTMLElement).style.backgroundColor = '';
                          }
                        }}
                      >
                        <div className="relative group/info">
                          <InformationCircleIcon className="w-5 h-5 text-gray-400 group-hover/card:text-white hover:text-white cursor-help transition-colors" />
                          <div className={`absolute ${isBottomRow ? 'bottom-6' : isTopRow ? 'top-0' : 'top-6'} w-80 p-3 bg-white border border-gray-300 text-gray-900 text-xs rounded-lg shadow-xl opacity-0 invisible group-hover/info:opacity-100 group-hover/info:visible transition-all z-50`} style={index === 0 ? { left: '0', right: 'auto', maxWidth: 'min(320px, calc(100vw - 4rem))' } : { right: '0', left: 'auto', maxWidth: 'min(320px, calc(100vw - 4rem))' }}>
                            <div className="font-semibold mb-2 text-sm">{type} Example:</div>
                            {exampleTable ? (
                              <div className="text-xs">
                                <div className="mb-2">{example}</div>
                                {type === 'Scale Rating Single Select' ? (
                                  <table className="w-full border-collapse border border-gray-400" style={{ tableLayout: 'fixed' }}>
                                    <colgroup>
                                      <col style={{ width: '18%' }} />
                                      <col style={{ width: '12%' }} />
                                      <col style={{ width: '12%' }} />
                                      <col style={{ width: '12%' }} />
                                      <col style={{ width: '12%' }} />
                                      <col style={{ width: '12%' }} />
                                      <col style={{ width: '18%' }} />
                                    </colgroup>
                                    <thead>
                                      <tr>
                                        <th className="border border-gray-400 px-2 py-1 text-center align-middle">
                                          <div className="text-center">1</div>
                                          <div className="text-[10px] font-normal text-center">Not at All</div>
                                        </th>
                                        <th className="border border-gray-400 px-2 py-1 text-center align-middle">2</th>
                                        <th className="border border-gray-400 px-2 py-1 text-center align-middle">3</th>
                                        <th className="border border-gray-400 px-2 py-1 text-center align-middle">4</th>
                                        <th className="border border-gray-400 px-2 py-1 text-center align-middle">5</th>
                                        <th className="border border-gray-400 px-2 py-1 text-center align-middle">6</th>
                                        <th className="border border-gray-400 px-2 py-1 text-center align-middle">
                                          <div className="text-center">7</div>
                                          <div className="text-[10px] font-normal text-center">Extremely</div>
                                        </th>
                                      </tr>
                                    </thead>
                                    <tbody>
                                      <tr>
                                        <td className="border border-gray-400 px-2 py-1 text-center align-middle">○</td>
                                        <td className="border border-gray-400 px-2 py-1 text-center align-middle">○</td>
                                        <td className="border border-gray-400 px-2 py-1 text-center align-middle">○</td>
                                        <td className="border border-gray-400 px-2 py-1 text-center align-middle">○</td>
                                        <td className="border border-gray-400 px-2 py-1 text-center align-middle">○</td>
                                        <td className="border border-gray-400 px-2 py-1 text-center align-middle">○</td>
                                        <td className="border border-gray-400 px-2 py-1 text-center align-middle">○</td>
                                      </tr>
                                    </tbody>
                                  </table>
                                ) : type === 'Single Select Grid' ? (
                                  <table className="w-full border-collapse border border-gray-400" style={{ tableLayout: 'fixed' }}>
                                    <colgroup>
                                      <col style={{ width: '30%' }} />
                                      <col style={{ width: '14%' }} />
                                      <col style={{ width: '14%' }} />
                                      <col style={{ width: '14%' }} />
                                      <col style={{ width: '14%' }} />
                                      <col style={{ width: '14%' }} />
                                    </colgroup>
                                    <thead>
                                      <tr>
                                        <th className="border border-gray-400 px-2 py-1 text-center align-middle"></th>
                                        <th className="border border-gray-400 px-2 py-1 text-center align-middle">1</th>
                                        <th className="border border-gray-400 px-2 py-1 text-center align-middle">2</th>
                                        <th className="border border-gray-400 px-2 py-1 text-center align-middle">3</th>
                                        <th className="border border-gray-400 px-2 py-1 text-center align-middle">4</th>
                                        <th className="border border-gray-400 px-2 py-1 text-center align-middle">5</th>
                                      </tr>
                                    </thead>
                                    <tbody>
                                      <tr>
                                        <td className="border border-gray-400 px-2 py-1 text-left align-middle">Item 1</td>
                                        <td className="border border-gray-400 px-2 py-1 text-center align-middle">○</td>
                                        <td className="border border-gray-400 px-2 py-1 text-center align-middle">○</td>
                                        <td className="border border-gray-400 px-2 py-1 text-center align-middle">○</td>
                                        <td className="border border-gray-400 px-2 py-1 text-center align-middle">○</td>
                                        <td className="border border-gray-400 px-2 py-1 text-center align-middle">○</td>
                                      </tr>
                                      <tr>
                                        <td className="border border-gray-400 px-2 py-1 text-left align-middle">Item 2</td>
                                        <td className="border border-gray-400 px-2 py-1 text-center align-middle">○</td>
                                        <td className="border border-gray-400 px-2 py-1 text-center align-middle">○</td>
                                        <td className="border border-gray-400 px-2 py-1 text-center align-middle">○</td>
                                        <td className="border border-gray-400 px-2 py-1 text-center align-middle">○</td>
                                        <td className="border border-gray-400 px-2 py-1 text-center align-middle">○</td>
                                      </tr>
                                    </tbody>
                                  </table>
                                ) : type === 'Multi-Select Grid' ? (
                                  <table className="w-full border-collapse border border-gray-400" style={{ tableLayout: 'fixed' }}>
                                    <colgroup>
                                      <col style={{ width: '40%' }} />
                                      <col style={{ width: '30%' }} />
                                      <col style={{ width: '30%' }} />
                                    </colgroup>
                                    <thead>
                                      <tr>
                                        <th className="border border-gray-400 px-2 py-1 text-center align-middle"></th>
                                        <th className="border border-gray-400 px-2 py-1 text-center align-middle">Yes</th>
                                        <th className="border border-gray-400 px-2 py-1 text-center align-middle">No</th>
                                      </tr>
                                    </thead>
                                    <tbody>
                                      <tr>
                                        <td className="border border-gray-400 px-2 py-1 text-left align-middle">Item 1</td>
                                        <td className="border border-gray-400 px-2 py-1 text-center align-middle">☐</td>
                                        <td className="border border-gray-400 px-2 py-1 text-center align-middle">☐</td>
                                      </tr>
                                      <tr>
                                        <td className="border border-gray-400 px-2 py-1 text-left align-middle">Item 2</td>
                                        <td className="border border-gray-400 px-2 py-1 text-center align-middle">☐</td>
                                        <td className="border border-gray-400 px-2 py-1 text-center align-middle">☐</td>
                                      </tr>
                                    </tbody>
                                  </table>
                                ) : type === 'Numeric Grid' ? (
                                  <table className="w-full border-collapse border border-gray-400" style={{ tableLayout: 'fixed' }}>
                                    <colgroup>
                                      <col style={{ width: '35%' }} />
                                      <col style={{ width: '22%' }} />
                                      <col style={{ width: '22%' }} />
                                      <col style={{ width: '21%' }} />
                                    </colgroup>
                                    <thead>
                                      <tr>
                                        <th className="border border-gray-400 px-2 py-1 text-center align-middle"></th>
                                        <th className="border border-gray-400 px-2 py-1 text-center align-middle">18-34</th>
                                        <th className="border border-gray-400 px-2 py-1 text-center align-middle">35-54</th>
                                        <th className="border border-gray-400 px-2 py-1 text-center align-middle">55+</th>
                                      </tr>
                                    </thead>
                                    <tbody>
                                      <tr>
                                        <td className="border border-gray-400 px-2 py-1 text-left align-middle">Treatment A</td>
                                        <td className="border border-gray-400 px-2 py-1 text-center align-middle">
                                          <div className="inline-block w-12 h-6 bg-white border border-gray-300 rounded"></div>
                                        </td>
                                        <td className="border border-gray-400 px-2 py-1 text-center align-middle">
                                          <div className="inline-block w-12 h-6 bg-white border border-gray-300 rounded"></div>
                                        </td>
                                        <td className="border border-gray-400 px-2 py-1 text-center align-middle">
                                          <div className="inline-block w-12 h-6 bg-white border border-gray-300 rounded"></div>
                                        </td>
                                      </tr>
                                      <tr>
                                        <td className="border border-gray-400 px-2 py-1 text-left align-middle">Treatment B</td>
                                        <td className="border border-gray-400 px-2 py-1 text-center align-middle">
                                          <div className="inline-block w-12 h-6 bg-white border border-gray-300 rounded"></div>
                                        </td>
                                        <td className="border border-gray-400 px-2 py-1 text-center align-middle">
                                          <div className="inline-block w-12 h-6 bg-white border border-gray-300 rounded"></div>
                                        </td>
                                        <td className="border border-gray-400 px-2 py-1 text-center align-middle">
                                          <div className="inline-block w-12 h-6 bg-white border border-gray-300 rounded"></div>
                                        </td>
                                      </tr>
                                    </tbody>
                                  </table>
                                ) : null}
                              </div>
                            ) : (type === 'Numeric' || type === 'Numeric Grid' || type === 'Open End' || type === 'Open End List') ? (
                              <div className="text-xs space-y-2">
                                {example.split('\n').map((line, lineIdx) => {
                                  const parts = line.split(/(\[[^\]]+\])/);
                                  return (
                                    <div key={lineIdx} className="flex items-center gap-2 flex-wrap">
                                      {parts.map((part, partIdx) => {
                                        if (part.match(/^\[.+\]$/)) {
                                          const isOpenEnd = type === 'Open End' || type === 'Open End List';
                                          const isSingleOpenEnd = type === 'Open End';
                                          const width = isSingleOpenEnd ? 'w-full' : (part.length > 10 ? 'w-32' : part.length > 5 ? 'w-20' : 'w-16');
                                          const height = isSingleOpenEnd ? 'h-12' : 'h-6';
                                          return (
                                            <div
                                              key={partIdx}
                                              className={`${width} ${height} bg-white border border-gray-300 rounded`}
                                            ></div>
                                          );
                                        }
                                        return <span key={partIdx}>{part}</span>;
                                      })}
                                    </div>
                                  );
                                })}
                              </div>
                            ) : (
                              <div className="font-mono text-xs leading-relaxed whitespace-pre-line">{example}</div>
                            )}
                            <div className={`absolute ${isBottomRow ? '-bottom-1 border-b border-r' : '-top-1 border-l border-t'} w-2 h-2 bg-white border-gray-300 transform rotate-45`} style={index === 0 ? { left: '1rem' } : { right: '1rem' }}></div>
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                  })}
                </div>
              </div>

              {/* Numeric Category */}
              <div>
                <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                  {[
                    { 
                      type: 'Numeric', 
                      description: 'Numeric input', 
                      icon: HashtagIcon,
                      example: 'How many years of experience?\n[____] years'
                    },
                  ].map(({ type, description, icon: Icon, example, exampleTable = false }, index, array) => {
                        const totalItems = array.length;
                        const isTopRow = index < 3;
                        const isBottomRow = index >= Math.floor((totalItems - 1) / 3) * 3;
                        return (
                    <div key={type} className="relative group/card">
                      <button
                        onClick={() => showPreviewForType(type)}
                        className="w-full p-4 border-2 border-gray-200 rounded-lg transition-all text-left flex items-start gap-3"
                        onMouseEnter={(e) => {
                          e.currentTarget.style.borderColor = BRAND_ORANGE;
                          e.currentTarget.style.backgroundColor = BRAND_ORANGE;
                        }}
                        onMouseLeave={(e) => {
                          const card = e.currentTarget.closest('.group\\/card');
                          if (card && !card.matches(':hover')) {
                            e.currentTarget.style.borderColor = '#E5E7EB';
                            e.currentTarget.style.backgroundColor = '';
                          }
                        }}
                      >
                        <Icon className="w-6 h-6 text-gray-400 group-hover/card:text-white flex-shrink-0 mt-0.5 transition-colors" />
                        <div className="flex-1">
                          <div className="font-medium text-gray-900 group-hover/card:text-white transition-colors">{type}</div>
                          <div className="text-sm text-gray-500 group-hover/card:text-white mt-1 transition-colors">{description}</div>
                        </div>
                      </button>
                      <div 
                        className="absolute top-2 right-2" 
                        onClick={(e) => e.stopPropagation()}
                        onMouseEnter={(e) => {
                          const card = e.currentTarget.closest('.group\\/card');
                          const button = card?.querySelector('button');
                          if (button) {
                            (button as HTMLElement).style.borderColor = BRAND_ORANGE;
                            (button as HTMLElement).style.backgroundColor = BRAND_ORANGE;
                          }
                        }}
                        onMouseLeave={(e) => {
                          const card = e.currentTarget.closest('.group\\/card');
                          const button = card?.querySelector('button');
                          if (button && !card?.matches(':hover')) {
                            (button as HTMLElement).style.borderColor = '#E5E7EB';
                            (button as HTMLElement).style.backgroundColor = '';
                          }
                        }}
                      >
                        <div className="relative group/info">
                          <InformationCircleIcon className="w-5 h-5 text-gray-400 group-hover/card:text-white hover:text-white cursor-help transition-colors" />
                          <div className={`absolute ${isBottomRow ? 'bottom-6' : isTopRow ? 'top-0' : 'top-6'} w-80 p-3 bg-white border border-gray-300 text-gray-900 text-xs rounded-lg shadow-xl opacity-0 invisible group-hover/info:opacity-100 group-hover/info:visible transition-all z-50`} style={index === 0 ? { left: '0', right: 'auto', maxWidth: 'min(320px, calc(100vw - 4rem))' } : { right: '0', left: 'auto', maxWidth: 'min(320px, calc(100vw - 4rem))' }}>
                            <div className="font-semibold mb-2 text-sm">{type} Example:</div>
                            {exampleTable ? (
                              <div className="text-xs">
                                <div className="mb-2">{example}</div>
                                {type === 'Scale Rating Single Select' ? (
                                  <table className="w-full border-collapse border border-gray-400" style={{ tableLayout: 'fixed' }}>
                                    <colgroup>
                                      <col style={{ width: '18%' }} />
                                      <col style={{ width: '12%' }} />
                                      <col style={{ width: '12%' }} />
                                      <col style={{ width: '12%' }} />
                                      <col style={{ width: '12%' }} />
                                      <col style={{ width: '12%' }} />
                                      <col style={{ width: '18%' }} />
                                    </colgroup>
                                    <thead>
                                      <tr>
                                        <th className="border border-gray-400 px-2 py-1 text-center align-middle">
                                          <div className="text-center">1</div>
                                          <div className="text-[10px] font-normal text-center">Not at All</div>
                                        </th>
                                        <th className="border border-gray-400 px-2 py-1 text-center align-middle">2</th>
                                        <th className="border border-gray-400 px-2 py-1 text-center align-middle">3</th>
                                        <th className="border border-gray-400 px-2 py-1 text-center align-middle">4</th>
                                        <th className="border border-gray-400 px-2 py-1 text-center align-middle">5</th>
                                        <th className="border border-gray-400 px-2 py-1 text-center align-middle">6</th>
                                        <th className="border border-gray-400 px-2 py-1 text-center align-middle">
                                          <div className="text-center">7</div>
                                          <div className="text-[10px] font-normal text-center">Extremely</div>
                                        </th>
                                      </tr>
                                    </thead>
                                    <tbody>
                                      <tr>
                                        <td className="border border-gray-400 px-2 py-1 text-center align-middle">○</td>
                                        <td className="border border-gray-400 px-2 py-1 text-center align-middle">○</td>
                                        <td className="border border-gray-400 px-2 py-1 text-center align-middle">○</td>
                                        <td className="border border-gray-400 px-2 py-1 text-center align-middle">○</td>
                                        <td className="border border-gray-400 px-2 py-1 text-center align-middle">○</td>
                                        <td className="border border-gray-400 px-2 py-1 text-center align-middle">○</td>
                                        <td className="border border-gray-400 px-2 py-1 text-center align-middle">○</td>
                                      </tr>
                                    </tbody>
                                  </table>
                                ) : type === 'Single Select Grid' ? (
                                  <table className="w-full border-collapse border border-gray-400" style={{ tableLayout: 'fixed' }}>
                                    <colgroup>
                                      <col style={{ width: '30%' }} />
                                      <col style={{ width: '14%' }} />
                                      <col style={{ width: '14%' }} />
                                      <col style={{ width: '14%' }} />
                                      <col style={{ width: '14%' }} />
                                      <col style={{ width: '14%' }} />
                                    </colgroup>
                                    <thead>
                                      <tr>
                                        <th className="border border-gray-400 px-2 py-1 text-center align-middle"></th>
                                        <th className="border border-gray-400 px-2 py-1 text-center align-middle">1</th>
                                        <th className="border border-gray-400 px-2 py-1 text-center align-middle">2</th>
                                        <th className="border border-gray-400 px-2 py-1 text-center align-middle">3</th>
                                        <th className="border border-gray-400 px-2 py-1 text-center align-middle">4</th>
                                        <th className="border border-gray-400 px-2 py-1 text-center align-middle">5</th>
                                      </tr>
                                    </thead>
                                    <tbody>
                                      <tr>
                                        <td className="border border-gray-400 px-2 py-1 text-left align-middle">Item 1</td>
                                        <td className="border border-gray-400 px-2 py-1 text-center align-middle">○</td>
                                        <td className="border border-gray-400 px-2 py-1 text-center align-middle">○</td>
                                        <td className="border border-gray-400 px-2 py-1 text-center align-middle">○</td>
                                        <td className="border border-gray-400 px-2 py-1 text-center align-middle">○</td>
                                        <td className="border border-gray-400 px-2 py-1 text-center align-middle">○</td>
                                      </tr>
                                      <tr>
                                        <td className="border border-gray-400 px-2 py-1 text-left align-middle">Item 2</td>
                                        <td className="border border-gray-400 px-2 py-1 text-center align-middle">○</td>
                                        <td className="border border-gray-400 px-2 py-1 text-center align-middle">○</td>
                                        <td className="border border-gray-400 px-2 py-1 text-center align-middle">○</td>
                                        <td className="border border-gray-400 px-2 py-1 text-center align-middle">○</td>
                                        <td className="border border-gray-400 px-2 py-1 text-center align-middle">○</td>
                                      </tr>
                                    </tbody>
                                  </table>
                                ) : type === 'Multi-Select Grid' ? (
                                  <table className="w-full border-collapse border border-gray-400" style={{ tableLayout: 'fixed' }}>
                                    <colgroup>
                                      <col style={{ width: '40%' }} />
                                      <col style={{ width: '30%' }} />
                                      <col style={{ width: '30%' }} />
                                    </colgroup>
                                    <thead>
                                      <tr>
                                        <th className="border border-gray-400 px-2 py-1 text-center align-middle"></th>
                                        <th className="border border-gray-400 px-2 py-1 text-center align-middle">Yes</th>
                                        <th className="border border-gray-400 px-2 py-1 text-center align-middle">No</th>
                                      </tr>
                                    </thead>
                                    <tbody>
                                      <tr>
                                        <td className="border border-gray-400 px-2 py-1 text-left align-middle">Item 1</td>
                                        <td className="border border-gray-400 px-2 py-1 text-center align-middle">☐</td>
                                        <td className="border border-gray-400 px-2 py-1 text-center align-middle">☐</td>
                                      </tr>
                                      <tr>
                                        <td className="border border-gray-400 px-2 py-1 text-left align-middle">Item 2</td>
                                        <td className="border border-gray-400 px-2 py-1 text-center align-middle">☐</td>
                                        <td className="border border-gray-400 px-2 py-1 text-center align-middle">☐</td>
                                      </tr>
                                    </tbody>
                                  </table>
                                ) : type === 'Numeric Grid' ? (
                                  <table className="w-full border-collapse border border-gray-400" style={{ tableLayout: 'fixed' }}>
                                    <colgroup>
                                      <col style={{ width: '35%' }} />
                                      <col style={{ width: '22%' }} />
                                      <col style={{ width: '22%' }} />
                                      <col style={{ width: '21%' }} />
                                    </colgroup>
                                    <thead>
                                      <tr>
                                        <th className="border border-gray-400 px-2 py-1 text-center align-middle"></th>
                                        <th className="border border-gray-400 px-2 py-1 text-center align-middle">18-34</th>
                                        <th className="border border-gray-400 px-2 py-1 text-center align-middle">35-54</th>
                                        <th className="border border-gray-400 px-2 py-1 text-center align-middle">55+</th>
                                      </tr>
                                    </thead>
                                    <tbody>
                                      <tr>
                                        <td className="border border-gray-400 px-2 py-1 text-left align-middle">Treatment A</td>
                                        <td className="border border-gray-400 px-2 py-1 text-center align-middle">
                                          <div className="inline-block w-12 h-6 bg-white border border-gray-300 rounded"></div>
                                        </td>
                                        <td className="border border-gray-400 px-2 py-1 text-center align-middle">
                                          <div className="inline-block w-12 h-6 bg-white border border-gray-300 rounded"></div>
                                        </td>
                                        <td className="border border-gray-400 px-2 py-1 text-center align-middle">
                                          <div className="inline-block w-12 h-6 bg-white border border-gray-300 rounded"></div>
                                        </td>
                                      </tr>
                                      <tr>
                                        <td className="border border-gray-400 px-2 py-1 text-left align-middle">Treatment B</td>
                                        <td className="border border-gray-400 px-2 py-1 text-center align-middle">
                                          <div className="inline-block w-12 h-6 bg-white border border-gray-300 rounded"></div>
                                        </td>
                                        <td className="border border-gray-400 px-2 py-1 text-center align-middle">
                                          <div className="inline-block w-12 h-6 bg-white border border-gray-300 rounded"></div>
                                        </td>
                                        <td className="border border-gray-400 px-2 py-1 text-center align-middle">
                                          <div className="inline-block w-12 h-6 bg-white border border-gray-300 rounded"></div>
                                        </td>
                                      </tr>
                                    </tbody>
                                  </table>
                                ) : null}
                              </div>
                            ) : (type === 'Numeric' || type === 'Numeric Grid' || type === 'Open End' || type === 'Open End List') ? (
                              <div className="text-xs space-y-2">
                                {example.split('\n').map((line, lineIdx) => {
                                  const parts = line.split(/(\[[^\]]+\])/);
                                  return (
                                    <div key={lineIdx} className="flex items-center gap-2 flex-wrap">
                                      {parts.map((part, partIdx) => {
                                        if (part.match(/^\[.+\]$/)) {
                                          const isOpenEnd = type === 'Open End' || type === 'Open End List';
                                          const isSingleOpenEnd = type === 'Open End';
                                          const width = isSingleOpenEnd ? 'w-full' : (part.length > 10 ? 'w-32' : part.length > 5 ? 'w-20' : 'w-16');
                                          const height = isSingleOpenEnd ? 'h-12' : 'h-6';
                                          return (
                                            <div
                                              key={partIdx}
                                              className={`${width} ${height} bg-white border border-gray-300 rounded`}
                                            ></div>
                                          );
                                        }
                                        return <span key={partIdx}>{part}</span>;
                                      })}
                                    </div>
                                  );
                                })}
                              </div>
                            ) : (
                              <div className="font-mono text-xs leading-relaxed whitespace-pre-line">{example}</div>
                            )}
                            <div className={`absolute ${isBottomRow ? '-bottom-1 border-b border-r' : '-top-1 border-l border-t'} w-2 h-2 bg-white border-gray-300 transform rotate-45`} style={index === 0 ? { left: '1rem' } : { right: '1rem' }}></div>
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                  })}
                </div>
              </div>

              {/* Open Ends Category */}
              <div>
                <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                  {[
                    { 
                      type: 'Open End', 
                      description: 'Free text response', 
                      icon: ChatBubbleLeftRightIcon,
                      example: 'Please describe your experience:\n[___________________________]'
                    },
                    { 
                      type: 'Open End List', 
                      description: 'Multiple free text responses', 
                      icon: ListBulletIcon,
                      example: 'List your top 3 concerns:\n1. [___________________]\n2. [___________________]\n3. [___________________]',
                      exampleTable: false
                    }
                  ].map(({ type, description, icon: Icon, example, exampleTable = false }, index, array) => {
                        const totalItems = array.length;
                        const isTopRow = index < 3;
                        const isBottomRow = index >= Math.floor((totalItems - 1) / 3) * 3;
                        return (
                    <div key={type} className="relative group/card">
                      <button
                        onClick={() => showPreviewForType(type)}
                        className="w-full p-4 border-2 border-gray-200 rounded-lg transition-all text-left flex items-start gap-3"
                        onMouseEnter={(e) => {
                          e.currentTarget.style.borderColor = BRAND_ORANGE;
                          e.currentTarget.style.backgroundColor = BRAND_ORANGE;
                        }}
                        onMouseLeave={(e) => {
                          const card = e.currentTarget.closest('.group\\/card');
                          if (card && !card.matches(':hover')) {
                            e.currentTarget.style.borderColor = '#E5E7EB';
                            e.currentTarget.style.backgroundColor = '';
                          }
                        }}
                      >
                        <Icon className="w-6 h-6 text-gray-400 group-hover/card:text-white flex-shrink-0 mt-0.5 transition-colors" />
                        <div className="flex-1">
                          <div className="font-medium text-gray-900 group-hover/card:text-white transition-colors">{type}</div>
                          <div className="text-sm text-gray-500 group-hover/card:text-white mt-1 transition-colors">{description}</div>
                        </div>
                      </button>
                      <div 
                        className="absolute top-2 right-2" 
                        onClick={(e) => e.stopPropagation()}
                        onMouseEnter={(e) => {
                          const card = e.currentTarget.closest('.group\\/card');
                          const button = card?.querySelector('button');
                          if (button) {
                            (button as HTMLElement).style.borderColor = BRAND_ORANGE;
                            (button as HTMLElement).style.backgroundColor = BRAND_ORANGE;
                          }
                        }}
                        onMouseLeave={(e) => {
                          const card = e.currentTarget.closest('.group\\/card');
                          const button = card?.querySelector('button');
                          if (button && !card?.matches(':hover')) {
                            (button as HTMLElement).style.borderColor = '#E5E7EB';
                            (button as HTMLElement).style.backgroundColor = '';
                          }
                        }}
                      >
                        <div className="relative group/info">
                          <InformationCircleIcon className="w-5 h-5 text-gray-400 group-hover/card:text-white hover:text-white cursor-help transition-colors" />
                          <div className={`absolute ${isBottomRow ? 'bottom-6' : isTopRow ? 'top-0' : 'top-6'} w-80 p-3 bg-white border border-gray-300 text-gray-900 text-xs rounded-lg shadow-xl opacity-0 invisible group-hover/info:opacity-100 group-hover/info:visible transition-all z-50`} style={index === 0 ? { left: '0', right: 'auto', maxWidth: 'min(320px, calc(100vw - 4rem))' } : { right: '0', left: 'auto', maxWidth: 'min(320px, calc(100vw - 4rem))' }}>
                            <div className="font-semibold mb-2 text-sm">{type} Example:</div>
                            {exampleTable ? (
                              <div className="text-xs">
                                <div className="mb-2">{example}</div>
                                {type === 'Scale Rating Single Select' ? (
                                  <table className="w-full border-collapse border border-gray-400" style={{ tableLayout: 'fixed' }}>
                                    <colgroup>
                                      <col style={{ width: '18%' }} />
                                      <col style={{ width: '12%' }} />
                                      <col style={{ width: '12%' }} />
                                      <col style={{ width: '12%' }} />
                                      <col style={{ width: '12%' }} />
                                      <col style={{ width: '12%' }} />
                                      <col style={{ width: '18%' }} />
                                    </colgroup>
                                    <thead>
                                      <tr>
                                        <th className="border border-gray-400 px-2 py-1 text-center align-middle">
                                          <div className="text-center">1</div>
                                          <div className="text-[10px] font-normal text-center">Not at All</div>
                                        </th>
                                        <th className="border border-gray-400 px-2 py-1 text-center align-middle">2</th>
                                        <th className="border border-gray-400 px-2 py-1 text-center align-middle">3</th>
                                        <th className="border border-gray-400 px-2 py-1 text-center align-middle">4</th>
                                        <th className="border border-gray-400 px-2 py-1 text-center align-middle">5</th>
                                        <th className="border border-gray-400 px-2 py-1 text-center align-middle">6</th>
                                        <th className="border border-gray-400 px-2 py-1 text-center align-middle">
                                          <div className="text-center">7</div>
                                          <div className="text-[10px] font-normal text-center">Extremely</div>
                                        </th>
                                      </tr>
                                    </thead>
                                    <tbody>
                                      <tr>
                                        <td className="border border-gray-400 px-2 py-1 text-center align-middle">○</td>
                                        <td className="border border-gray-400 px-2 py-1 text-center align-middle">○</td>
                                        <td className="border border-gray-400 px-2 py-1 text-center align-middle">○</td>
                                        <td className="border border-gray-400 px-2 py-1 text-center align-middle">○</td>
                                        <td className="border border-gray-400 px-2 py-1 text-center align-middle">○</td>
                                        <td className="border border-gray-400 px-2 py-1 text-center align-middle">○</td>
                                        <td className="border border-gray-400 px-2 py-1 text-center align-middle">○</td>
                                      </tr>
                                    </tbody>
                                  </table>
                                ) : type === 'Single Select Grid' ? (
                                  <table className="w-full border-collapse border border-gray-400" style={{ tableLayout: 'fixed' }}>
                                    <colgroup>
                                      <col style={{ width: '30%' }} />
                                      <col style={{ width: '14%' }} />
                                      <col style={{ width: '14%' }} />
                                      <col style={{ width: '14%' }} />
                                      <col style={{ width: '14%' }} />
                                      <col style={{ width: '14%' }} />
                                    </colgroup>
                                    <thead>
                                      <tr>
                                        <th className="border border-gray-400 px-2 py-1 text-center align-middle"></th>
                                        <th className="border border-gray-400 px-2 py-1 text-center align-middle">1</th>
                                        <th className="border border-gray-400 px-2 py-1 text-center align-middle">2</th>
                                        <th className="border border-gray-400 px-2 py-1 text-center align-middle">3</th>
                                        <th className="border border-gray-400 px-2 py-1 text-center align-middle">4</th>
                                        <th className="border border-gray-400 px-2 py-1 text-center align-middle">5</th>
                                      </tr>
                                    </thead>
                                    <tbody>
                                      <tr>
                                        <td className="border border-gray-400 px-2 py-1 text-left align-middle">Item 1</td>
                                        <td className="border border-gray-400 px-2 py-1 text-center align-middle">○</td>
                                        <td className="border border-gray-400 px-2 py-1 text-center align-middle">○</td>
                                        <td className="border border-gray-400 px-2 py-1 text-center align-middle">○</td>
                                        <td className="border border-gray-400 px-2 py-1 text-center align-middle">○</td>
                                        <td className="border border-gray-400 px-2 py-1 text-center align-middle">○</td>
                                      </tr>
                                      <tr>
                                        <td className="border border-gray-400 px-2 py-1 text-left align-middle">Item 2</td>
                                        <td className="border border-gray-400 px-2 py-1 text-center align-middle">○</td>
                                        <td className="border border-gray-400 px-2 py-1 text-center align-middle">○</td>
                                        <td className="border border-gray-400 px-2 py-1 text-center align-middle">○</td>
                                        <td className="border border-gray-400 px-2 py-1 text-center align-middle">○</td>
                                        <td className="border border-gray-400 px-2 py-1 text-center align-middle">○</td>
                                      </tr>
                                    </tbody>
                                  </table>
                                ) : type === 'Multi-Select Grid' ? (
                                  <table className="w-full border-collapse border border-gray-400" style={{ tableLayout: 'fixed' }}>
                                    <colgroup>
                                      <col style={{ width: '40%' }} />
                                      <col style={{ width: '30%' }} />
                                      <col style={{ width: '30%' }} />
                                    </colgroup>
                                    <thead>
                                      <tr>
                                        <th className="border border-gray-400 px-2 py-1 text-center align-middle"></th>
                                        <th className="border border-gray-400 px-2 py-1 text-center align-middle">Yes</th>
                                        <th className="border border-gray-400 px-2 py-1 text-center align-middle">No</th>
                                      </tr>
                                    </thead>
                                    <tbody>
                                      <tr>
                                        <td className="border border-gray-400 px-2 py-1 text-left align-middle">Item 1</td>
                                        <td className="border border-gray-400 px-2 py-1 text-center align-middle">☐</td>
                                        <td className="border border-gray-400 px-2 py-1 text-center align-middle">☐</td>
                                      </tr>
                                      <tr>
                                        <td className="border border-gray-400 px-2 py-1 text-left align-middle">Item 2</td>
                                        <td className="border border-gray-400 px-2 py-1 text-center align-middle">☐</td>
                                        <td className="border border-gray-400 px-2 py-1 text-center align-middle">☐</td>
                                      </tr>
                                    </tbody>
                                  </table>
                                ) : type === 'Numeric Grid' ? (
                                  <table className="w-full border-collapse border border-gray-400" style={{ tableLayout: 'fixed' }}>
                                    <colgroup>
                                      <col style={{ width: '35%' }} />
                                      <col style={{ width: '22%' }} />
                                      <col style={{ width: '22%' }} />
                                      <col style={{ width: '21%' }} />
                                    </colgroup>
                                    <thead>
                                      <tr>
                                        <th className="border border-gray-400 px-2 py-1 text-center align-middle"></th>
                                        <th className="border border-gray-400 px-2 py-1 text-center align-middle">18-34</th>
                                        <th className="border border-gray-400 px-2 py-1 text-center align-middle">35-54</th>
                                        <th className="border border-gray-400 px-2 py-1 text-center align-middle">55+</th>
                                      </tr>
                                    </thead>
                                    <tbody>
                                      <tr>
                                        <td className="border border-gray-400 px-2 py-1 text-left align-middle">Treatment A</td>
                                        <td className="border border-gray-400 px-2 py-1 text-center align-middle">
                                          <div className="inline-block w-12 h-6 bg-white border border-gray-300 rounded"></div>
                                        </td>
                                        <td className="border border-gray-400 px-2 py-1 text-center align-middle">
                                          <div className="inline-block w-12 h-6 bg-white border border-gray-300 rounded"></div>
                                        </td>
                                        <td className="border border-gray-400 px-2 py-1 text-center align-middle">
                                          <div className="inline-block w-12 h-6 bg-white border border-gray-300 rounded"></div>
                                        </td>
                                      </tr>
                                      <tr>
                                        <td className="border border-gray-400 px-2 py-1 text-left align-middle">Treatment B</td>
                                        <td className="border border-gray-400 px-2 py-1 text-center align-middle">
                                          <div className="inline-block w-12 h-6 bg-white border border-gray-300 rounded"></div>
                                        </td>
                                        <td className="border border-gray-400 px-2 py-1 text-center align-middle">
                                          <div className="inline-block w-12 h-6 bg-white border border-gray-300 rounded"></div>
                                        </td>
                                        <td className="border border-gray-400 px-2 py-1 text-center align-middle">
                                          <div className="inline-block w-12 h-6 bg-white border border-gray-300 rounded"></div>
                                        </td>
                                      </tr>
                                    </tbody>
                                  </table>
                                ) : null}
                              </div>
                            ) : (type === 'Numeric' || type === 'Numeric Grid' || type === 'Open End' || type === 'Open End List') ? (
                              <div className="text-xs space-y-2">
                                {example.split('\n').map((line, lineIdx) => {
                                  const parts = line.split(/(\[[^\]]+\])/);
                                  return (
                                    <div key={lineIdx} className="flex items-center gap-2 flex-wrap">
                                      {parts.map((part, partIdx) => {
                                        if (part.match(/^\[.+\]$/)) {
                                          const isOpenEnd = type === 'Open End' || type === 'Open End List';
                                          const isSingleOpenEnd = type === 'Open End';
                                          const width = isSingleOpenEnd ? 'w-full' : (part.length > 10 ? 'w-32' : part.length > 5 ? 'w-20' : 'w-16');
                                          const height = isSingleOpenEnd ? 'h-12' : 'h-6';
                                          return (
                                            <div
                                              key={partIdx}
                                              className={`${width} ${height} bg-white border border-gray-300 rounded`}
                                            ></div>
                                          );
                                        }
                                        return <span key={partIdx}>{part}</span>;
                                      })}
                                    </div>
                                  );
                                })}
                              </div>
                            ) : (
                              <div className="font-mono text-xs leading-relaxed whitespace-pre-line">{example}</div>
                            )}
                            <div className={`absolute ${isBottomRow ? '-bottom-1 border-b border-r' : '-top-1 border-l border-t'} w-2 h-2 bg-white border-gray-300 transform rotate-45`} style={index === 0 ? { left: '1rem' } : { right: '1rem' }}></div>
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                  })}
                </div>
              </div>
            </div>
              </>
            ) : (
              <QuestionPreviewView
                questionType={previewQuestionType}
                onBack={() => setPreviewQuestionType(null)}
                onCreate={(question) => {
                  if (previewQuestionType) {
                    addQuestionAtIndex(question);
                    setPreviewQuestionType(null);
                    setShowQuestionTypeSelector(false);
                    setPendingQuestionInsertIndex(null);
                  }
                }}
                onClose={() => {
                  setPreviewQuestionType(null);
                  setShowQuestionTypeSelector(false);
                  setPendingQuestionInsertIndex(null);
                }}
                pendingQuestionInsertIndex={pendingQuestionInsertIndex}
                selectedQuestionnaire={selectedQuestionnaire}
                selectedSectionQuestions={selectedSectionQuestions}
              />
            )}
          </div>
        </div>
      )}

      {/* Upload Modal */}
      {showUploadModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50" style={{ margin: 0, padding: 0, top: 0, left: 0, right: 0, bottom: 0 }}>
          <div className="bg-white rounded-lg w-full max-w-2xl max-h-[90vh] mx-4 flex flex-col">
            {uploading && !uploadedQuestionnaire ? (
              <div className="p-6 text-center py-8">
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
              <div className="flex flex-col h-full max-h-[90vh]">
                {/* Fixed Header */}
                <div className="p-6 pb-4 border-b flex-shrink-0">
                  <h3 className="text-lg font-semibold">Questionnaire Sections</h3>
                  <p className="text-sm text-gray-600 mt-1">
                    Found {uploadedQuestionnaire.sections.length} section{uploadedQuestionnaire.sections.length !== 1 ? 's' : ''} • Select sections to parse
                  </p>
                </div>
                {/* Scrollable Sections List */}
                <div className="flex-1 overflow-y-auto px-6 py-4">
                  <div className="space-y-3">
                  {uploadedQuestionnaire.sections.map((section) => {
                    // Extract the letter prefix for section name (e.g., "Section S" -> "Section S", "Quotas" -> "Quotas")
                    let displayName = section.sectionName;
                    const isQuotaSection = section.sectionName === 'Quota' || 
                                          section.sectionName === 'Quotas' ||
                                          section.sectionName?.toLowerCase() === 'quota' ||
                                          section.sectionName?.toLowerCase() === 'quotas';
                    
                    if (!isQuotaSection) {
                      // Extract the prefix letter from "Section S" or just use the prefix if it's already just a letter
                      const prefixMatch = section.sectionName.match(/Section\s+([A-Z]+)/i);
                      if (prefixMatch) {
                        displayName = `Section ${prefixMatch[1]}`;
                      } else if (section.questionPrefix) {
                        displayName = `Section ${section.questionPrefix}`;
                      }
                    } else {
                      // Normalize to "Quotas"
                      displayName = 'Quotas';
                    }
                    
                    const isExcluded = excludedSections.has(section.sectionNumber);

                    return (
                      <div
                        key={section.sectionNumber}
                        className={`p-3 border border-gray-200 rounded-md ${isExcluded ? 'bg-gray-100 opacity-60' : 'hover:bg-gray-50'}`}
                      >
                        <div className="flex items-start justify-between mb-1">
                          <div className="flex items-center gap-3">
                            {!section.parsed && (
                              <input
                                type="checkbox"
                                checked={!isExcluded}
                                onChange={(e) => {
                                  const newExcluded = new Set(excludedSections);
                                  if (e.target.checked) {
                                    newExcluded.delete(section.sectionNumber);
                                  } else {
                                    newExcluded.add(section.sectionNumber);
                                  }
                                  setExcludedSections(newExcluded);
                                }}
                                className="w-4 h-4 rounded border-gray-300 focus:ring-2"
                                style={{ accentColor: BRAND_ORANGE }}
                                title={isExcluded ? "Include in parsing" : "Exclude from parsing"}
                              />
                            )}
                            <div className={`font-medium ${isExcluded ? 'text-gray-500 line-through' : 'text-gray-900'}`}>
                              {displayName}
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
                                {isQuotaSection ? (
                                  <>✓ Parsed ({uploadedQuestionnaire.quotas?.length || 0} quotas)</>
                                ) : (
                                  <>✓ Parsed ({section.questions?.length || 0} questions)</>
                                )}
                              </span>
                            ) : null}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                  </div>
                </div>
                
                {/* Edit Section Modal */}
                {editingSection !== null && (() => {
                  const section = uploadedQuestionnaire.sections?.find(s => s.sectionNumber === editingSection);
                  if (!section) return null;
                  const isQuotaSection = section.sectionName === 'Quota' || 
                                        section.sectionName === 'Quotas' ||
                                        section.sectionName?.toLowerCase() === 'quota' ||
                                        section.sectionName?.toLowerCase() === 'quotas';
                  
                  return (
                    <div 
                      className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50" 
                      style={{ margin: 0, padding: 0, top: 0, left: 0, right: 0, bottom: 0 }}
                      onClick={(e) => {
                        if (e.target === e.currentTarget) {
                          setEditingSection(null);
                          setEditSectionName('');
                          setEditQuestionNumbers([]);
                          setEditQuotas([]);
                        }
                      }}
                    >
                      <div className="bg-white rounded-lg p-6 w-full max-w-lg mx-4" onClick={(e) => e.stopPropagation()}>
                        <div className="flex items-center justify-between mb-4">
                          <h3 className="text-lg font-semibold">Edit Section</h3>
                          <button
                            onClick={() => {
                              setEditingSection(null);
                              setEditSectionName('');
                              setEditQuestionNumbers([]);
                              setEditQuotas([]);
                            }}
                            className="text-gray-400 hover:text-gray-600"
                          >
                            <XMarkIcon className="w-5 h-5" />
                          </button>
                        </div>
                        
                        <div className="space-y-4">
                          <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">
                              Section Name
                            </label>
                            <input
                              type="text"
                              value={editSectionName}
                              onChange={(e) => setEditSectionName(e.target.value)}
                              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-orange-500"
                              disabled={isQuotaSection}
                            />
                          </div>
                          
                          {isQuotaSection ? (
                            <div>
                              <label className="block text-sm font-medium text-gray-700 mb-2">
                                Quotas
                              </label>
                              <div className="space-y-2 max-h-96 overflow-y-auto border border-gray-200 rounded-md p-3">
                                {editQuotas.length === 0 ? (
                                  <p className="text-sm text-gray-500">No quotas</p>
                                ) : (
                                  editQuotas.map((quota, index) => (
                                    <div key={index} className="bg-gray-50 p-3 rounded border border-gray-200">
                                      <div className="flex items-start justify-between mb-2">
                                        <span className="text-sm font-medium text-gray-700">Quota {index + 1}</span>
                                        <button
                                          onClick={() => {
                                            setEditQuotas(editQuotas.filter((_, i) => i !== index));
                                          }}
                                          className="text-red-500 hover:text-red-700"
                                          title="Remove quota"
                                        >
                                          <XMarkIcon className="w-4 h-4" />
                                        </button>
                                      </div>
                                      <div className="space-y-2">
                                        <div>
                                          <label className="text-xs text-gray-600">Name</label>
                                          <input
                                            type="text"
                                            value={quota.name || ''}
                                            onChange={(e) => {
                                              const updated = [...editQuotas];
                                              updated[index] = { ...updated[index], name: e.target.value };
                                              setEditQuotas(updated);
                                            }}
                                            className="w-full px-2 py-1 text-sm border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-orange-500"
                                            placeholder="e.g., TOTAL, Male 18-24"
                                          />
                                        </div>
                                        <div>
                                          <label className="text-xs text-gray-600">Sample Size (n=)</label>
                                          <input
                                            type="number"
                                            value={quota.limit || 0}
                                            onChange={(e) => {
                                              const updated = [...editQuotas];
                                              updated[index] = { ...updated[index], limit: parseInt(e.target.value) || 0 };
                                              setEditQuotas(updated);
                                            }}
                                            className="w-full px-2 py-1 text-sm border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-orange-500"
                                            placeholder="e.g., 1000"
                                          />
                                        </div>
                                      </div>
                                    </div>
                                  ))
                                )}
                              </div>
                              <button
                                onClick={() => {
                                  setEditQuotas([...editQuotas, { name: '', conditions: [], limit: 0 }]);
                                }}
                                className="mt-2 w-full px-3 py-2 text-sm border border-gray-300 rounded-md hover:bg-gray-50 transition-colors flex items-center justify-center gap-2"
                              >
                                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                                </svg>
                                Add Quota
                              </button>
                            </div>
                          ) : (
                            <div>
                              <label className="block text-sm font-medium text-gray-700 mb-2">
                                Question Numbers
                              </label>
                              <div className="space-y-2 max-h-60 overflow-y-auto border border-gray-200 rounded-md p-3">
                                {editQuestionNumbers.length === 0 ? (
                                  <p className="text-sm text-gray-500">No question numbers</p>
                                ) : (
                                  editQuestionNumbers.map((qNum, index) => (
                                    <div key={index} className="flex items-center justify-between bg-gray-50 p-2 rounded">
                                      <span className="text-sm font-mono text-gray-700">{qNum}</span>
                                      <button
                                        onClick={() => {
                                          setEditQuestionNumbers(editQuestionNumbers.filter((_, i) => i !== index));
                                        }}
                                        className="text-red-500 hover:text-red-700"
                                        title="Remove"
                                      >
                                        <XMarkIcon className="w-4 h-4" />
                                      </button>
                                    </div>
                                  ))
                                )}
                              </div>
                              <div className="mt-2">
                                <input
                                  type="text"
                                  placeholder="Add question number (e.g., S1, A2)"
                                  onKeyDown={(e) => {
                                    if (e.key === 'Enter') {
                                      e.preventDefault();
                                      const value = e.currentTarget.value.trim().toUpperCase();
                                      if (value && !editQuestionNumbers.includes(value)) {
                                        setEditQuestionNumbers([...editQuestionNumbers, value].sort((a, b) => {
                                          const numA = parseInt(a.replace(/[^0-9]/g, '')) || 0;
                                          const numB = parseInt(b.replace(/[^0-9]/g, '')) || 0;
                                          if (numA !== numB) return numA - numB;
                                          return a.localeCompare(b);
                                        }));
                                        e.currentTarget.value = '';
                                      }
                                    }
                                  }}
                                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-orange-500 text-sm"
                                />
                                <p className="text-xs text-gray-500 mt-1">Press Enter to add</p>
                              </div>
                            </div>
                          )}
                        </div>
                        
                        <div className="flex justify-end gap-3 mt-6 pt-4 border-t">
                          <button
                            onClick={() => {
                              setEditingSection(null);
                              setEditSectionName('');
                              setEditQuestionNumbers([]);
                              setEditQuotas([]);
                            }}
                            className="px-4 py-2 text-gray-700 bg-gray-100 rounded-md hover:bg-gray-200 transition-colors"
                          >
                            Cancel
                          </button>
                          <button
                            onClick={async () => {
                              // Update the section in uploadedQuestionnaire
                              let updatedQnr: Questionnaire | null = null;
                              setUploadedQuestionnaire(prev => {
                                if (!prev) return prev;
                                const section = prev.sections?.find(s => s.sectionNumber === editingSection);
                                const isQuotaSection = section?.sectionName === 'Quota' ||
                                                      section?.sectionName === 'Quotas' ||
                                                      section?.sectionName?.toLowerCase() === 'quota' ||
                                                      section?.sectionName?.toLowerCase() === 'quotas';

                                const updatedSections = prev.sections?.map(s =>
                                  s.sectionNumber === editingSection
                                    ? {
                                        ...s,
                                        sectionName: editSectionName,
                                        foundQuestionNumbers: editQuestionNumbers,
                                        expectedQuestionCount: editQuestionNumbers.length
                                      }
                                    : s
                                );

                                updatedQnr = {
                                  ...prev,
                                  sections: updatedSections,
                                  // Update quotas if this is a quota section
                                  quotas: isQuotaSection ? editQuotas : prev.quotas
                                };
                                return updatedQnr;
                              });

                              // Persist quotas to backend if quota section was edited
                              if (updatedQnr) {
                                try {
                                  await fetch(`${API_BASE_URL}/api/questionnaire/${updatedQnr.id}`, {
                                    method: 'PUT',
                                    headers: {
                                      'Content-Type': 'application/json',
                                      'Authorization': `Bearer ${localStorage.getItem('cognitive_dash_token')}`
                                    },
                                    body: JSON.stringify({ quotas: updatedQnr.quotas })
                                  });
                                } catch (error) {
                                  console.error('Failed to save quotas:', error);
                                }
                              }

                              setEditingSection(null);
                              setEditSectionName('');
                              setEditQuestionNumbers([]);
                              setEditQuotas([]);
                            }}
                            className="px-4 py-2 text-white rounded-md hover:opacity-90"
                            style={{ backgroundColor: BRAND_ORANGE }}
                          >
                            Save
                          </button>
                        </div>
                      </div>
                    </div>
                  );
                })()}
                
                {/* Fixed Footer */}
                <div className="p-6 pt-4 border-t flex-shrink-0 flex justify-end items-center gap-3">
                  {!uploadedQuestionnaire.sections?.every(s => s.parsed) && (
                    <>
                      <button
                        onClick={() => {
                          // Cancel any ongoing parsing
                          parsingCancelledRef.current = true;
                          setParsingSections(new Set());

                          // Go back to upload view
                          setUploadedQuestionnaire(null);
                          setUploadSuccess(false);
                          setUploading(false);
                          setFileValidation(null);
                          setQuestionnaireName('');
                          setFileSelected(false);
                          if (fileInputRef.current) {
                            fileInputRef.current.value = '';
                          }
                        }}
                        className="px-4 py-2 text-gray-700 bg-gray-100 rounded-md hover:bg-gray-200 transition-colors"
                      >
                        {parsingSections.size > 0 ? 'Cancel' : 'Back'}
                      </button>
                      {parsingSections.size === 0 && (
                      <button
                        onClick={async () => {
                          // Reset cancellation flag
                          parsingCancelledRef.current = false;

                          // Get initial list of sections to parse (excluding excluded sections)
                          let sectionsToParse = [...(uploadedQuestionnaire.sections || [])]
                            .filter(s => !s.parsed && !excludedSections.has(s.sectionNumber));

                          if (sectionsToParse.length === 0) {
                            alert('All non-excluded sections have already been parsed.');
                            return;
                          }

                          // Mark all sections as parsing
                          setParsingSections(new Set(sectionsToParse.map(s => s.sectionNumber)));

                          // Parse all sections in parallel for faster processing
                          try {
                            const parsePromises = sectionsToParse.map(async (section) => {
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

                                  // Remove from parsing set as soon as this section completes
                                  setParsingSections(prev => {
                                    const newSet = new Set(prev);
                                    newSet.delete(section.sectionNumber);
                                    return newSet;
                                  });

                                  return {
                                    success: true,
                                    sectionNumber: section.sectionNumber,
                                    sectionName: section.sectionName,
                                    questions: result.questions,
                                    quotas: result.quotas
                                  };
                                } else {
                                  const error = await response.json();
                                  return { success: false, sectionNumber: section.sectionNumber, error: error.error };
                                }
                              } catch (error) {
                                console.error(`Parse section ${section.sectionNumber} error:`, error);
                                return { success: false, sectionNumber: section.sectionNumber, error: error.message };
                              }
                            });

                            // Wait for all sections to complete
                            const results = await Promise.all(parsePromises);

                            // Update all sections at once to avoid race conditions
                            const successfulResults = results.filter(r => r.success);
                            if (successfulResults.length > 0) {
                              setUploadedQuestionnaire(prev => {
                                if (!prev) return prev;

                                // Collect all questions and quotas from all successful parses
                                const allNewQuestions = [];
                                let allNewQuotas = prev.quotas || [];

                                // Update sections and collect questions
                                const updatedSections = prev.sections?.map(s => {
                                  const result = successfulResults.find(r => r.sectionNumber === s.sectionNumber);
                                  if (result) {
                                    // This section was just parsed
                                    allNewQuestions.push(...(result.questions || []));

                                    // If this is the Quota section, update quotas
                                    const isQuotaSection = s.sectionName === 'Quota' || s.sectionName?.toLowerCase() === 'quota';
                                    if (isQuotaSection && result.quotas) {
                                      allNewQuotas = result.quotas;
                                    }

                                    return { ...s, parsed: true, questions: result.questions };
                                  }
                                  return s;
                                });

                                return {
                                  ...prev,
                                  sections: updatedSections,
                                  questions: [...(prev.questions || []), ...allNewQuestions],
                                  quotas: allNewQuotas
                                };
                              });
                            }

                            // Check for any errors
                            const failedSections = results.filter(r => !r.success);
                            if (failedSections.length > 0) {
                              const failedSectionNumbers = failedSections.map(r => r.sectionNumber).join(', ');
                              alert(`Failed to parse section(s) ${failedSectionNumbers}. Please try again.`);
                            }

                            // Reload questionnaires to get updated data
                            const allResponse = await fetch(`${API_BASE_URL}/api/questionnaire/all`, {
                              headers: { 'Authorization': `Bearer ${localStorage.getItem('cognitive_dash_token')}` }
                            });
                            if (allResponse.ok) {
                              const allData = await allResponse.json();
                              setAllQuestionnaires(allData || []);
                            }
                            await loadQuestionnaires(selectedProject!.id);

                            // Clear any remaining parsing sections
                            setParsingSections(new Set());
                          } catch (error) {
                            console.error('Error parsing sections:', error);
                            alert('An error occurred while parsing sections. Please try again.');
                            setParsingSections(new Set());
                          }
                        }}
                        disabled={uploadedQuestionnaire.sections?.every(s => s.parsed) ?? false}
                        className="px-4 py-2 text-white rounded-md hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed"
                        style={{ backgroundColor: BRAND_ORANGE }}
                      >
                        Parse All Sections
                      </button>
                      )}
                    </>
                  )}
                  {uploadedQuestionnaire.sections?.every(s => s.parsed) && (
                    <button
                      onClick={() => {
                        setShowUploadModal(false);
                        setUploadedQuestionnaire(null);
                        setUploadSuccess(false);
                        setUploading(false);
                        setQuestionnaireName('');
                        setFileSelected(false);
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
                  )}
                </div>
              </div>
            ) : uploadSuccess ? (
              <div className="p-6 text-center py-8">
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
                    setFileSelected(false);
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
              <div className="p-6">
                <div className="flex items-center justify-between mb-4">
                  <h3 className="text-lg font-semibold">Upload QNR</h3>
                  <button
                    onClick={() => {
                      setShowUploadModal(false);
                      setUploadSuccess(false);
                      setUploading(false);
                      setQuestionnaireName('');
                      setFileValidation(null);
                      setFileSelected(false);
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
                      setFileValidation(null);
                      setFileSelected(false);
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
                    disabled={uploading || !fileInputRef.current?.files?.[0] || !questionnaireName.trim()}
                  >
                    Upload
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Edit Quotas Modal */}
      {editingQuotasModal && (
        <div
          className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50"
          style={{ margin: 0, padding: 0, top: 0, left: 0, right: 0, bottom: 0 }}
          onClick={(e) => {
            if (e.target === e.currentTarget) {
              setEditingQuotasModal(false);
              setEditQuotas([]);
            }
          }}
        >
          <div className="bg-white rounded-lg p-6 w-full max-w-lg mx-4" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold">Edit Quotas</h3>
              <button
                onClick={() => {
                  setEditingQuotasModal(false);
                  setEditQuotas([]);
                }}
                className="text-gray-400 hover:text-gray-600"
              >
                <XMarkIcon className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Quotas
                </label>
                <div className="space-y-2 max-h-96 overflow-y-auto border border-gray-200 rounded-md p-3">
                  {editQuotas.length === 0 ? (
                    <p className="text-sm text-gray-500">No quotas</p>
                  ) : (
                    editQuotas.map((quota, index) => (
                      <div key={index} className="bg-gray-50 p-3 rounded border border-gray-200">
                        <div className="flex items-start justify-between mb-2">
                          <span className="text-sm font-medium text-gray-700">Quota {index + 1}</span>
                          <button
                            onClick={() => {
                              setEditQuotas(editQuotas.filter((_, i) => i !== index));
                            }}
                            className="text-red-500 hover:text-red-700"
                            title="Remove quota"
                          >
                            <XMarkIcon className="w-4 h-4" />
                          </button>
                        </div>
                        <div className="space-y-2">
                          <div>
                            <label className="text-xs text-gray-600">Name</label>
                            <input
                              type="text"
                              value={quota.name || ''}
                              onChange={(e) => {
                                const updated = [...editQuotas];
                                updated[index] = { ...updated[index], name: e.target.value };
                                setEditQuotas(updated);
                              }}
                              className="w-full px-2 py-1 text-sm border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-orange-500"
                              placeholder="e.g., TOTAL, Male 18-24"
                            />
                          </div>
                          <div>
                            <label className="text-xs text-gray-600">Sample Size (n=)</label>
                            <input
                              type="number"
                              value={quota.limit || 0}
                              onChange={(e) => {
                                const updated = [...editQuotas];
                                updated[index] = { ...updated[index], limit: parseInt(e.target.value) || 0 };
                                setEditQuotas(updated);
                              }}
                              className="w-full px-2 py-1 text-sm border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-orange-500"
                              placeholder="e.g., 1000"
                            />
                          </div>
                        </div>
                      </div>
                    ))
                  )}
                </div>
                <button
                  onClick={() => {
                    setEditQuotas([...editQuotas, { name: '', conditions: [], limit: 0 }]);
                  }}
                  className="mt-2 w-full px-3 py-2 text-sm border border-gray-300 rounded-md hover:bg-gray-50 transition-colors flex items-center justify-center gap-2"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                  </svg>
                  Add Quota
                </button>
              </div>
            </div>

            <div className="flex justify-end gap-3 mt-6 pt-4 border-t">
              <button
                onClick={() => {
                  setEditingQuotasModal(false);
                  setEditQuotas([]);
                }}
                className="px-4 py-2 text-gray-700 bg-gray-100 rounded-md hover:bg-gray-200 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={async () => {
                  // Update quotas in selectedQuestionnaire
                  if (selectedQuestionnaire) {
                    const updatedQnr = {
                      ...selectedQuestionnaire,
                      quotas: editQuotas
                    };
                    setSelectedQuestionnaire(updatedQnr);

                    // Persist to backend
                    try {
                      await fetch(`${API_BASE_URL}/api/questionnaire/${selectedQuestionnaire.id}`, {
                        method: 'PUT',
                        headers: {
                          'Content-Type': 'application/json',
                          'Authorization': `Bearer ${localStorage.getItem('cognitive_dash_token')}`
                        },
                        body: JSON.stringify({ quotas: editQuotas })
                      });
                    } catch (error) {
                      console.error('Failed to save quotas:', error);
                    }
                  }

                  setEditingQuotasModal(false);
                  setEditQuotas([]);
                }}
                className="px-4 py-2 text-white rounded-md hover:opacity-90"
                style={{ backgroundColor: BRAND_ORANGE }}
              >
                Save
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// Question Preview View Component
function QuestionPreviewView({
  questionType,
  onBack,
  onCreate,
  onClose,
  pendingQuestionInsertIndex,
  selectedQuestionnaire,
  selectedSectionQuestions
}: {
  questionType: string;
  onBack: () => void;
  onCreate: (question: Question) => void;
  onClose: () => void;
  pendingQuestionInsertIndex: number | null;
  selectedQuestionnaire: any;
  selectedSectionQuestions: Question[];
}) {
  const [previewQuestionNumber, setPreviewQuestionNumber] = useState<string>('');
  const [showSurveyPreview, setShowSurveyPreview] = useState(false);
  const [questionNumberError, setQuestionNumberError] = useState<string | null>(null);
  
  // Helper function to suggest a question number based on position
  const suggestQuestionNumber = (): string => {
    if (pendingQuestionInsertIndex === null || !selectedQuestionnaire || !selectedSectionQuestions.length) {
      return 'Q1';
    }

    const fullQuestions = selectedQuestionnaire.questions || [];
    
    // The question at pendingQuestionInsertIndex is the one we're inserting AFTER
    // So we want to use that question's number as the base
    const questionBefore = selectedSectionQuestions[pendingQuestionInsertIndex];
    
    if (!questionBefore) {
      // Inserting at the end
      const lastQuestion = selectedSectionQuestions[selectedSectionQuestions.length - 1];
      if (lastQuestion) {
        const lastNum = lastQuestion.number || '';
        const sectionPrefix = lastNum.charAt(0).toUpperCase() || 'Q';
        const numPart = parseInt(lastNum.substring(1)) || 0;
        return `${sectionPrefix}${numPart + 1}`;
      }
      return 'Q1';
    }

    const questionBeforeNum = questionBefore.number || '';
    const sectionPrefix = questionBeforeNum.charAt(0).toUpperCase() || 'Q';
    
    // Extract numeric part from question before (e.g., "S6" -> 6, "S6A" -> 6)
    const numMatch = questionBeforeNum.match(/^[A-Z](\d+)/);
    if (!numMatch) {
      return `${sectionPrefix}1`;
    }
    
    const baseNum = parseInt(numMatch[1]);
    let suggestedNum = `${sectionPrefix}${baseNum}A`;
    
    // Check if this number already exists, if so, increment the letter
    const existingNumbers = new Set(fullQuestions.map((q: Question) => q.number?.toUpperCase() || ''));
    let attempts = 0;
    
    while (existingNumbers.has(suggestedNum.toUpperCase()) && attempts < 26) {
      const letter = String.fromCharCode(65 + attempts); // A=65, B=66, etc.
      suggestedNum = `${sectionPrefix}${baseNum}${letter}`;
      attempts++;
    }
    
    // If we've exhausted A-Z, try the next number
    if (attempts >= 26) {
      suggestedNum = `${sectionPrefix}${baseNum + 1}`;
    }
    
    return suggestedNum;
  };

  // Determine if this is a Scale Rating Single Select (needs special handling)
  const isScaleRating = questionType === 'Scale Rating Single Select';
  const actualType = isScaleRating ? 'Single Select' : questionType;

  // Calculate scale points for Scale tag (only 5pt, 7pt, 10pt)
  const getScaleTag = (question: Question): string[] => {
    if (!isScaleRating) return [];

    // Count the number of options to determine scale points
    const numPoints = question.options?.length || 0;

    // Only return Scale tag if it's 5pt, 7pt, 10pt, or 11pt
    if (numPoints === 5 || numPoints === 7 || numPoints === 10 || numPoints === 11) {
      return [`Scale (${numPoints}pt)`];
    }

    // Don't add Scale tag for other point counts
    return [];
  };

  // Create a temporary question for preview with suggested number
  const previewQuestion: Question = {
    id: 'preview',
    number: suggestQuestionNumber(),
    text: '',
    type: actualType,
    options: [],
    tags: [],
    needsReview: false
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
                            typeLower.includes('numeric grid') ||
                            (typeLower.includes('open end') && !typeLower.includes('list'))
    };
  };

  const fields = getFieldsForType(actualType);

  // Initialize with default options if needed
  if (fields.needsOptions && previewQuestion.options?.length === 0) {
    previewQuestion.options = [{ code: '1', text: 'Option 1' }, { code: '2', text: 'Option 2' }];
  }
  if (fields.needsStatementOptions && !previewQuestion.statementOptions) {
    previewQuestion.statementOptions = [{ code: 'r1', text: 'Row 1' }, { code: 'r2', text: 'Row 2' }];
  }
  if (fields.needsResponseOptions && !previewQuestion.responseOptions) {
    if (fields.needsStatementOptions) {
      // Grid question
      previewQuestion.responseOptions = [{ code: 'c1', text: 'Column 1' }, { code: 'c2', text: 'Column 2' }];
    } else {
      // List question
      previewQuestion.responseOptions = [{ code: 'c1', text: 'Item 1' }, { code: 'c2', text: 'Item 2' }];
    }
  }

  // State to track the current edited question for preview
  const [currentEditedQuestion, setCurrentEditedQuestion] = useState<Question>(previewQuestion);

  // Update currentEditedQuestion when previewQuestion changes
  React.useEffect(() => {
    setCurrentEditedQuestion(previewQuestion);
  }, [previewQuestion.id]);

  // Update tags whenever options change (for Scale questions)
  React.useEffect(() => {
    if (isScaleRating && currentEditedQuestion) {
      const scaleTag = getScaleTag(currentEditedQuestion);
      if (JSON.stringify(currentEditedQuestion.tags) !== JSON.stringify(scaleTag)) {
        setCurrentEditedQuestion(prev => ({
          ...prev,
          tags: scaleTag
        }));
      }
    }
  }, [currentEditedQuestion.options, isScaleRating]);

  return (
    <>
      <div className="sticky top-0 bg-white z-10 p-6 pb-4 border-b border-gray-200">
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-4">
            <button
              onClick={onBack}
              className="text-gray-400 hover:text-gray-600 transition-colors"
            >
              <ArrowLeftIcon className="w-6 h-6" />
            </button>
            <div>
              <h2 className="text-xl font-semibold text-gray-900">Preview: {questionType}</h2>
            </div>
          </div>
          <button
            onClick={onClose}
            className="ml-4 text-gray-400 hover:text-gray-600 transition-colors"
          >
            <XMarkIcon className="w-6 h-6" />
          </button>
        </div>
      </div>
      
      <div className="p-6">
        {!showSurveyPreview ? (
          <QuestionBox
            question={currentEditedQuestion || previewQuestion}
            index={0}
            variableData={{}}
            onUpdateQuestion={(updatedQuestion) => {
              setCurrentEditedQuestion(updatedQuestion);
              return [];
            }}
            questionnaireId={selectedQuestionnaire?.id}
            forceEditMode={true}
            hideDelete={true}
            hideSaveCancel={true}
            allQuestions={selectedQuestionnaire?.questions || []}
            isPreview={true}
            onQuestionNumberChange={(num) => setPreviewQuestionNumber(num)}
            onQuestionChange={(q) => {
              setCurrentEditedQuestion(q);
            }}
            onQuestionNumberErrorChange={(error) => {
              setQuestionNumberError(error);
            }}
          />
        ) : (
          <div className="border border-gray-200 rounded-lg p-4 bg-white">
            <SurveyQuestionView
              question={currentEditedQuestion || previewQuestion}
              index={0}
              onUpdateQuestion={() => []}
              questionnaireId={selectedQuestionnaire?.id}
            />
          </div>
        )}
        
        <div className="mt-6 flex justify-between items-center">
          <button
            onClick={() => setShowSurveyPreview(!showSurveyPreview)}
            className="px-4 py-2 text-gray-600 hover:text-gray-800 transition-colors border border-gray-300 rounded-md hover:bg-gray-50"
          >
            {showSurveyPreview ? 'Back to Edit' : 'Survey View'}
          </button>
          <button
            onClick={() => {
              if (currentEditedQuestion) {
                // Use the current edited question with the question number from state
                const questionToCreate = {
                  ...currentEditedQuestion,
                  number: previewQuestionNumber || currentEditedQuestion.number || previewQuestion.number
                };
                onCreate(questionToCreate);
              }
            }}
            disabled={!!questionNumberError}
            className={`px-4 py-2 text-white rounded-md transition-opacity ${
              questionNumberError 
                ? 'opacity-50 cursor-not-allowed' 
                : 'hover:opacity-90'
            }`}
            style={{ backgroundColor: BRAND_ORANGE }}
          >
            Create Question
          </button>
        </div>
      </div>
    </>
  );
}

// Helper function to extract definition for a specific option code from terminateLogic string
function getOptionDefinition(terminateLogic: string | { optionCodes: string[] } | undefined, optionCode: string): string {
  if (!terminateLogic || typeof terminateLogic !== 'string') {
    return '';
  }
  
  // Try to find patterns like "option 1: definition" or "option 1 means definition" or "option 1 = definition"
  const patterns = [
    new RegExp(`option\\s+${optionCode.replace(/[c]/gi, '')}\\s*[:=]\\s*(.+?)(?:\\.|$|,|;|\\n)`, 'i'),
    new RegExp(`option\\s+${optionCode.replace(/[c]/gi, '')}\\s+means\\s+(.+?)(?:\\.|$|,|;|\\n)`, 'i'),
    new RegExp(`option\\s+${optionCode.replace(/[c]/gi, '')}\\s+(.+?)(?:\\.|$|,|;|\\n)`, 'i'),
  ];
  
  for (const pattern of patterns) {
    const match = terminateLogic.match(pattern);
    if (match && match[1]) {
      return match[1].trim();
    }
  }
  
  return '';
}

// Helper function to parse logic string and extract logic for each option
// Logic string may contain conditions for all options, separated by patterns like "for [Option Text]"
function parseLogicByOption(logicString: string, options: Array<string | { code: string; text: string }>): string[] {
  if (!logicString || !options || options.length === 0) {
    return [];
  }
  
  const logicArray: string[] = new Array(options.length).fill('');
  
  // Extract option texts for matching
  const optionTexts = options.map((opt, idx) => {
    if (typeof opt === 'string') {
      // Try to extract text after code
      const codeMatch = opt.match(/^\d+:?\s+(.+)$/);
      return codeMatch ? codeMatch[1].trim() : opt;
    }
    return opt.text || '';
  });
  
  // Try to split logic by "for [Option Text]" patterns
  // First, try to find all "for [text]" patterns in the logic string
  const forPattern = /for\s+([^:]+?)(?:\s*[:]|\s+if|\s+when|$)/gi;
  const matches: Array<{ text: string; index: number; fullMatch: string }> = [];
  let forMatch;
  while ((forMatch = forPattern.exec(logicString)) !== null) {
    matches.push({
      text: forMatch[1].trim(),
      index: forMatch.index,
      fullMatch: forMatch[0]
    });
  }
  
  // Try to match each "for [text]" with an option
  if (matches.length > 0) {
    for (let i = 0; i < matches.length; i++) {
      const matchText = matches[i].text.toLowerCase();
      // Find the option that best matches this text
      for (let optIdx = 0; optIdx < optionTexts.length; optIdx++) {
        const optionText = optionTexts[optIdx].toLowerCase();
        // Check if the match text contains key words from the option text
        // or if the option text contains key words from the match text
        const optionWords = optionText.split(/\s+/).filter(w => w.length > 3);
        const matchWords = matchText.split(/\s+/).filter(w => w.length > 3);
        const hasCommonWords = optionWords.some(w => matchText.includes(w)) || 
                              matchWords.some(w => optionText.includes(w));
        
        if (hasCommonWords || optionText.includes(matchText) || matchText.includes(optionText)) {
          // Extract the logic for this option
          // Find where the "for [text]" pattern ends
          const patternEnd = matches[i].index + matches[i].fullMatch.length;
          const endIndex = i < matches.length - 1 ? matches[i + 1].index : logicString.length;
          let optionLogic = logicString.substring(patternEnd, endIndex).trim();
          
          // Clean up the logic (remove leading colons, "if", "when", etc.)
          optionLogic = optionLogic.replace(/^[:]\s*/, '').replace(/^(if|when)\s+/i, '').trim();
          
          // Also try to extract from the full match if the above doesn't work well
          if (!optionLogic || optionLogic.length < 10) {
            // Try extracting from the full match including the "for" part
            const fullMatch = logicString.substring(matches[i].index, endIndex);
            const logicMatch = fullMatch.match(/for\s+[^:]+[:]?\s*(.+)/i);
            if (logicMatch && logicMatch[1]) {
              optionLogic = logicMatch[1].trim();
            }
          }
          
          if (optionLogic && (!logicArray[optIdx] || optionLogic.length > logicArray[optIdx].length)) {
            logicArray[optIdx] = optionLogic;
          }
          break;
        }
      }
    }
  }
  
  // If we found some matches, return what we have
  if (logicArray.some(logic => logic)) {
    return logicArray;
  }
  
  // Fallback: Try to split by option numbers or other delimiters
  // Try splitting by numbered patterns like "1.", "2.", etc.
  const numberedPattern = /(\d+)\.\s*([^]*?)(?=\d+\.|$)/g;
  let numberedMatch;
  while ((numberedMatch = numberedPattern.exec(logicString)) !== null) {
    const optionNum = parseInt(numberedMatch[1]);
    if (optionNum >= 1 && optionNum <= options.length) {
      logicArray[optionNum - 1] = numberedMatch[2].trim();
    }
  }
  
  // If still no matches, try pattern matching with option text directly
  if (logicArray.every(logic => !logic)) {
    for (let i = 0; i < optionTexts.length; i++) {
      const optionText = optionTexts[i];
      if (!optionText) continue;
      
      // Escape special regex characters in option text
      const escapedText = optionText.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      
      // Try to find "for [Option Text]" pattern
      const pattern = new RegExp(`for\\s+${escapedText}\\s*[:]?\\s*([^]*?)(?=for\\s+[^:]+:|$)`, 'i');
      const match = logicString.match(pattern);
      if (match && match[1]) {
        const logic = match[1].trim();
        if (logic) {
          logicArray[i] = logic;
        }
      }
    }
  }
  
  // Last resort: If logic is long and contains multiple conditions, try to split by common patterns
  if (logicArray.every(logic => !logic) && logicString.length > 100) {
    // Try to split by patterns that might separate options (like variable assignments)
    // Look for patterns that might indicate different conditions for different options
    const conditionPattern = /(S\d+[^]*?)(?=S\d+|for\s+|$)/g;
    const conditions: string[] = [];
    let conditionMatch;
    while ((conditionMatch = conditionPattern.exec(logicString)) !== null) {
      conditions.push(conditionMatch[1].trim());
    }
    
    // If we found multiple conditions, distribute them to options
    if (conditions.length > 0 && conditions.length <= options.length) {
      conditions.forEach((condition, idx) => {
        if (idx < logicArray.length) {
          logicArray[idx] = condition;
        }
      });
    }
  }
  
  return logicArray;
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
  questionnaireId,
  forceEditMode = false,
  hideDelete = false,
  hideSaveCancel = false,
  allQuestions = [],
  isPreview = false,
  onQuestionNumberChange,
  onQuestionChange,
  onQuestionNumberErrorChange
}: { 
  question: Question; 
  index: number;
  variableData?: Record<string, any>;
  onUpdateQuestion?: (question: Question) => Question[];
  questionnaireId?: string;
  forceEditMode?: boolean;
  hideDelete?: boolean;
  hideSaveCancel?: boolean;
  allQuestions?: Question[];
  isPreview?: boolean;
  onQuestionNumberChange?: (questionNumber: string) => void;
  onQuestionChange?: (question: Question) => void;
  onQuestionNumberErrorChange?: (error: string | null) => void;
}) {
  const [isEditing, setIsEditing] = useState(forceEditMode);
  const [isFlipping, setIsFlipping] = useState(false);
  const [editedQuestionNumber, setEditedQuestionNumber] = useState<string>('');
  const [editedQuestionText, setEditedQuestionText] = useState<string>('');
  const [editedType, setEditedType] = useState<string>('');
  const [editedOptions, setEditedOptions] = useState<Array<{ code: string; text: string }>>([]);
  const [editedResponseOptions, setEditedResponseOptions] = useState<Array<{ code: string; text: string }>>([]);
  const [editedStatementOptions, setEditedStatementOptions] = useState<Array<{ code: string; text: string }>>([]);
  const [editedRandomize, setEditedRandomize] = useState<boolean>(false);
  const [editedTerminateLogic, setEditedTerminateLogic] = useState<string>('');
  const [questionNumberError, setQuestionNumberError] = useState<string | null>(null);
  
  // Track which sections have been rendered to prevent duplicates
  const renderedSectionsRef = useRef<Set<string>>(new Set());
  
  // Use ref to store the callback to avoid infinite loops
  const onQuestionChangeRef = useRef(onQuestionChange);
  useEffect(() => {
    onQuestionChangeRef.current = onQuestionChange;
  }, [onQuestionChange]);
  
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
        })),
        manuallyFlipped: true // Mark as manually flipped to override fallback logic
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
                            typeLower.includes('numeric grid') ||
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

    // Numeric Grid - no validation (can have responseOptions or options)
    // Removed validation error for numeric grid questions

    // Numeric Grid - no validation (don't show error icon)
    // Removed validation error for numeric grid questions

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

  // Helper function to build current question from edited values
  const buildCurrentQuestion = useCallback((): Question => {
    const isNumericGrid = editedType?.toLowerCase().includes('numeric grid');
    const fields = getFieldsForType(editedType);

    return {
      ...question,
      number: editedQuestionNumber.trim() || question.number || `Q${index + 1}`,
      text: editedQuestionText.trim() || question.text || '',
      type: editedType || question.type || '',
      options: fields.needsOptions
        ? (editedOptions.length > 0
          ? editedOptions.map(opt => ({
              code: opt.code,
              text: opt.text,
              tags: (() => {
                const originalOpt = question.options?.find((o, idx) => {
                  const originalOptObj = typeof o === 'string' ? { code: String(idx + 1), text: o } : o;
                  return originalOptObj.text === opt.text || originalOptObj.code === opt.code;
                });
                return originalOpt && typeof originalOpt !== 'string' ? originalOpt.tags : undefined;
              })()
            }))
          : [])
        : question.options || [],
      responseOptions: fields.needsResponseOptions && editedResponseOptions.length > 0
        ? editedResponseOptions.map(opt => ({
            code: `c${opt.code}`,
            text: opt.text
          }))
        : fields.needsResponseOptions
          ? []
          : question.responseOptions,
      statementOptions: fields.needsStatementOptions && editedStatementOptions.length > 0
        ? editedStatementOptions.map(opt => ({
            code: `r${opt.code}`,
            text: opt.text
          }))
        : fields.needsStatementOptions
          ? []
          : question.statementOptions,
      randomize: editedRandomize,
      terminateLogic: editedTerminateLogic.trim()
        ? { optionCodes: editedTerminateLogic.split(',').map(c => c.trim()).filter(Boolean) }
        : question.terminateLogic
    };
  }, [question, editedQuestionNumber, editedQuestionText, editedType, editedOptions, editedResponseOptions, editedStatementOptions, editedRandomize, editedTerminateLogic, index]);

  // Notify parent of question changes when in preview mode
  // Use a ref to track previous values to avoid unnecessary updates
  const prevValuesRef = useRef<string>('');
  
  // Create stable string representations of arrays for comparison
  const optionsStr = useMemo(() => JSON.stringify(editedOptions), [editedOptions]);
  const responseOptionsStr = useMemo(() => JSON.stringify(editedResponseOptions), [editedResponseOptions]);
  const statementOptionsStr = useMemo(() => JSON.stringify(editedStatementOptions), [editedStatementOptions]);
  
  useEffect(() => {
    if (isPreview && onQuestionChangeRef.current && isEditing) {
      const currentQ = buildCurrentQuestion();
      // Create a stable string representation to compare
      const currentValues = JSON.stringify({
        number: currentQ.number,
        text: currentQ.text,
        type: currentQ.type,
        options: currentQ.options,
        responseOptions: currentQ.responseOptions,
        statementOptions: currentQ.statementOptions,
        randomize: currentQ.randomize,
        terminateLogic: currentQ.terminateLogic
      });
      
      // Only update if values actually changed
      if (currentValues !== prevValuesRef.current) {
        prevValuesRef.current = currentValues;
        onQuestionChangeRef.current(currentQ);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isPreview, isEditing, editedQuestionNumber, editedQuestionText, editedType, optionsStr, responseOptionsStr, statementOptionsStr, editedRandomize, editedTerminateLogic]);

  // Track if we've initialized to prevent resetting on question updates
  const hasInitializedRef = useRef(false);
  const initialQuestionIdRef = useRef<string | undefined>(question.id);
  const lastQuestionRef = useRef<Question>(question);
  
  // Reset rendered sections when question changes
  useEffect(() => {
    renderedSectionsRef.current.clear();
  }, [question.id, question.number]);
  
  // Initialize edit mode when forceEditMode is true (only once, or when question ID changes)
  useEffect(() => {
    // Reset initialization flag if question ID changes (new question)
    if (question.id !== initialQuestionIdRef.current) {
      hasInitializedRef.current = false;
      initialQuestionIdRef.current = question.id;
    }
    
    // If question data changed significantly (not just from user edits), re-initialize
    // This handles the case when switching back from preview mode
    const questionChanged = JSON.stringify(question) !== JSON.stringify(lastQuestionRef.current);
    if (questionChanged && forceEditMode && hasInitializedRef.current && isPreview) {
      // Update form fields from the new question data without resetting the initialization flag
      // This preserves the user's edits while syncing with the updated question
      setEditedQuestionNumber(question.number || `Q${index + 1}`);
      setEditedQuestionText(question.text || '');
      // Normalize question type - convert "Numeric grid" to "Numeric Grid" to match dropdown
      let normalizedType = question.type || '';
      if (normalizedType.toLowerCase() === 'numeric grid') {
        normalizedType = 'Numeric Grid';
      }
      setEditedType(normalizedType);
      
      // Parse options - extract leading number as code if present
      const parseOption = (opt: string | { code?: string; text?: string }, idx: number) => {
        if (typeof opt === 'string') {
          // Match leading number(s) followed by space, then the rest of the text
          // Pattern: one or more digits at the start, followed by a space, then the rest
          // Examples: "1 Text" -> code: "1", text: "Text"
          //           "99 None of the above apply" -> code: "99", text: "None of the above apply"
          const match = opt.match(/^(\d+)\s+(.+)$/);
          if (match) {
            const code = match[1]; // The extracted code (e.g., "1", "99")
            const text = match[2].trim(); // The remaining text (without the leading number)
            return { code, text };
          }
          // If no code found, use index as code
          return { code: String(idx + 1), text: opt };
        }
        // Already an object, use it
        return { code: opt.code || String(idx + 1), text: opt.text || '' };
      };
      
      const options = (question.options || []).map((opt, idx) => parseOption(opt, idx));
      setEditedOptions(options);
      
      // Initialize statement options
      const isNumericGridForStmt = question.type?.toLowerCase().includes('numeric grid');
      if (isNumericGridForStmt && question.statementOptions && question.statementOptions.length > 0) {
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
        // For Open End List questions, don't set statementOptions - they should be in responseOptions
        const isOpenEndListForStmt = question.type?.toLowerCase().includes('open end list');
        if (!isOpenEndListForStmt) {
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
          // Open End List should not have statementOptions - clear them
          setEditedStatementOptions([]);
        }
      } else {
        setEditedStatementOptions([]);
      }
      
      // Initialize response options
      // For numeric grids:
      // 1. Use responseOptions if available
      // 2. Use options if available (for legacy data)
      // 3. Use statementOptions if available (for fallback)
      // For Open End List: If it has statementOptions (incorrectly stored), convert them to responseOptions
      const isNumericGridForResponse = question.type?.toLowerCase().includes('numeric grid');
      const isOpenEndList = question.type?.toLowerCase().includes('open end list');
      const hasResponseOptionsForResponse = question.responseOptions && Array.isArray(question.responseOptions) && question.responseOptions.length > 0;
      const hasOptionsForResponse = question.options && Array.isArray(question.options) && question.options.length > 0;
      const hasStatementOptionsForResponse = question.statementOptions && Array.isArray(question.statementOptions) && question.statementOptions.length > 0;
      
      // CRITICAL: For Open End List questions, if they have statementOptions, convert them to responseOptions
      // Open End List should use responseOptions, not statementOptions
      if (isOpenEndList && hasStatementOptionsForResponse && !hasResponseOptionsForResponse) {
        console.log(`⚠️ Converting statementOptions to responseOptions for Open End List question ${question.number}`);
        // The statementOptions will be converted to responseOptions below
      }

      // Always try to use responseOptions first, then options, then use # or % from tags for numeric grids
      // For Open End List: prioritize responseOptions, but if only statementOptions exist, use those
      let optionsToUseForResponse: any[] = [];
      if (hasResponseOptionsForResponse && question.responseOptions) {
        // For numeric grids, check if responseOptions are valid (have at least one column with a label)
        if (isNumericGridForResponse) {
          const validResponseOptions = question.responseOptions.filter((opt: any) => {
            const text = typeof opt === 'string' ? opt : (opt.text || '');
            return text.trim() !== '';
          });
          // If we have valid response options (at least one with a label), use them
          if (validResponseOptions.length > 0) {
            optionsToUseForResponse = question.responseOptions;
          } else {
            // Invalid or empty response options - use # or % from tags
            const hasPercentTag = question.tags && question.tags.includes('%');
            const hasNumberTag = question.tags && question.tags.includes('Number');
            const fallbackColumnLabel = hasPercentTag ? '%' : (hasNumberTag ? '#' : '#');
            optionsToUseForResponse = [{ code: '1', text: fallbackColumnLabel }];
          }
        } else {
          optionsToUseForResponse = question.responseOptions;
        }
      } else if (isOpenEndList && hasStatementOptionsForResponse && question.statementOptions) {
        // For Open End List, if only statementOptions exist, use them (they should be responseOptions)
        optionsToUseForResponse = question.statementOptions;
      } else if (hasOptionsForResponse && question.options) {
        // For legacy numeric grids, use the options field
        optionsToUseForResponse = question.options;
      } else if (isNumericGridForResponse) {
        // For numeric grids without response options or with invalid response options, create fallback column with % or # based on tags
        const hasPercentTag = question.tags && question.tags.includes('%');
        const hasNumberTag = question.tags && question.tags.includes('Number');
        const fallbackColumnLabel = hasPercentTag ? '%' : (hasNumberTag ? '#' : '#');
        optionsToUseForResponse = [{ code: '1', text: fallbackColumnLabel }];
      }

      const responseOptions = optionsToUseForResponse.map((opt, idx) => {
        const respOpt = typeof opt === 'string' ? { code: `c${idx + 1}`, text: opt } : { code: opt.code || `c${idx + 1}`, text: opt.text || '' };
        // For numeric grids, extract the numeric code
        let numericCode: string;
        numericCode = respOpt.code.replace(/^[rc]/i, '');
        if (!numericCode || numericCode.trim() === '') {
          numericCode = String(idx + 1);
        }
        return { code: numericCode, text: respOpt.text || '' };
      });
      setEditedResponseOptions(responseOptions);
      
      setEditedRandomize(question.randomize || false);
      setEditedTerminateLogic(
        typeof question.terminateLogic === 'object' && question.terminateLogic?.optionCodes
          ? question.terminateLogic.optionCodes.join(', ')
          : ''
      );
      
      lastQuestionRef.current = question;
    }
    
    if (forceEditMode && !hasInitializedRef.current) {
      setIsEditing(true);
      setEditedQuestionNumber(question.number || `Q${index + 1}`);
      setEditedQuestionText(question.text || '');
      // Normalize question type - convert "Numeric grid" to "Numeric Grid" to match dropdown
      let normalizedType = question.type || '';
      if (normalizedType.toLowerCase() === 'numeric grid') {
        normalizedType = 'Numeric Grid';
      }
      setEditedType(normalizedType);
      
      // Parse options - extract leading number as code if present
      const parseOption = (opt: string | { code?: string; text?: string }, idx: number) => {
        if (typeof opt === 'string') {
          // Match leading number(s) followed by space, then the rest of the text
          const match = opt.match(/^(\d+)\s+(.+)$/);
          if (match) {
            const code = match[1];
            const text = match[2].trim();
            return { code, text };
          }
          return { code: String(idx + 1), text: opt };
        }
        return { code: opt.code || String(idx + 1), text: opt.text || '' };
      };
      
      // Initialize options
      const options = (question.options || []).map((opt, idx) => parseOption(opt, idx));
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
      } else if (question.statementOptions && question.statementOptions.length > 0) {
        // For Open End List questions, don't set statementOptions - they should be in responseOptions
        const isOpenEndListForStmt = question.type?.toLowerCase().includes('open end list');
        if (!isOpenEndListForStmt) {
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
          // Open End List should not have statementOptions - clear them
          setEditedStatementOptions([]);
        }
      } else {
        setEditedStatementOptions([]);
      }
      
      // Initialize response options
      // For numeric grids:
      // 1. Use responseOptions if available
      // 2. Use options if available (for legacy data)
      // 3. Use statementOptions if available (for fallback)
      // For Open End List: If it has statementOptions (incorrectly stored), convert them to responseOptions
      const isNumericGridForInit = question.type?.toLowerCase().includes('numeric grid');
      const isOpenEndList = question.type?.toLowerCase().includes('open end list');
      const hasResponseOptionsForInit = question.responseOptions && Array.isArray(question.responseOptions) && question.responseOptions.length > 0;
      const hasOptionsForInit = question.options && Array.isArray(question.options) && question.options.length > 0;
      const hasStatementOptionsForInit = question.statementOptions && Array.isArray(question.statementOptions) && question.statementOptions.length > 0;

      // Always try to use responseOptions first, then options, then use # or % from tags for numeric grids
      // For Open End List: prioritize responseOptions, but if only statementOptions exist, use those
      let optionsToUseForInit: any[] = [];
      if (hasResponseOptionsForInit && question.responseOptions) {
        // For numeric grids, check if responseOptions are valid (have at least one column with a label)
        if (isNumericGridForInit) {
          const validResponseOptions = question.responseOptions.filter((opt: any) => {
            const text = typeof opt === 'string' ? opt : (opt.text || '');
            return text.trim() !== '';
          });
          // If we have valid response options (at least one with a label), use them
          if (validResponseOptions.length > 0) {
            optionsToUseForInit = question.responseOptions;
          } else {
            // Invalid or empty response options - use # or % from tags
            const hasPercentTag = question.tags && question.tags.includes('%');
            const hasNumberTag = question.tags && question.tags.includes('Number');
            const fallbackColumnLabel = hasPercentTag ? '%' : (hasNumberTag ? '#' : '#');
            optionsToUseForInit = [{ code: '1', text: fallbackColumnLabel }];
          }
        } else {
          optionsToUseForInit = question.responseOptions;
        }
      } else if (isOpenEndList && hasStatementOptionsForInit && question.statementOptions) {
        // For Open End List, if only statementOptions exist, use them (they should be responseOptions)
        optionsToUseForInit = question.statementOptions;
      } else if (hasOptionsForInit && question.options) {
        // For legacy numeric grids, use the options field
        optionsToUseForInit = question.options;
      } else if (isNumericGridForInit) {
        // For numeric grids without response options or with invalid response options, create fallback column with % or # based on tags
        const hasPercentTag = question.tags && question.tags.includes('%');
        const hasNumberTag = question.tags && question.tags.includes('Number');
        const fallbackColumnLabel = hasPercentTag ? '%' : (hasNumberTag ? '#' : '#');
        optionsToUseForInit = [{ code: '1', text: fallbackColumnLabel }];
      }

      const responseOptions = optionsToUseForInit.map((opt, idx) => {
        const respOpt = typeof opt === 'string' ? { code: `c${idx + 1}`, text: opt } : { code: opt.code || `c${idx + 1}`, text: opt.text || '' };
        // For numeric grids, extract the numeric code
        let numericCode: string;
        numericCode = respOpt.code.replace(/^[rc]/i, '');
        if (!numericCode || numericCode.trim() === '') {
          numericCode = String(idx + 1);
        }
        return { code: numericCode, text: respOpt.text || '' };
      });
      setEditedResponseOptions(responseOptions);
      
      setEditedRandomize(question.randomize || false);
      setEditedTerminateLogic(
        typeof question.terminateLogic === 'object' && question.terminateLogic?.optionCodes
          ? question.terminateLogic.optionCodes.join(', ')
          : ''
      );
      hasInitializedRef.current = true;
      lastQuestionRef.current = question;
    }
    // Include question in dependencies to detect when it changes (e.g., switching back from preview)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [forceEditMode, index, question]);

  // Initialize edit mode with current question data
  const handleStartEdit = () => {
    setEditedQuestionNumber(question.number || `Q${index + 1}`);
    setEditedQuestionText(question.text || '');
    // Normalize question type - convert "Numeric grid" to "Numeric Grid" to match dropdown
    let normalizedType = question.type || '';
    if (normalizedType.toLowerCase() === 'numeric grid') {
      normalizedType = 'Numeric Grid';
    }
    setEditedType(normalizedType);
    
    // Parse options - extract leading number as code if present
    const parseOption = (opt: string | { code?: string; text?: string }, idx: number) => {
      if (typeof opt === 'string') {
        // Match leading number(s) followed by space, then the rest of the text
        const match = opt.match(/^(\d+)\s+(.+)$/);
        if (match) {
          const code = match[1];
          const text = match[2].trim();
          return { code, text };
        }
        return { code: String(idx + 1), text: opt };
      }
      return { code: opt.code || String(idx + 1), text: opt.text || '' };
    };
    
    // Initialize options
    const options = question.options?.map((opt, idx) => parseOption(opt, idx)) || [];
    setEditedOptions(options);
    
    // Initialize response options
    const isNumericGridForResp = question.type?.toLowerCase().includes('numeric grid');
    if (isNumericGridForResp && question.statementOptions && question.statementOptions.length > 0) {
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
      // For Open End List questions, don't set statementOptions - they should be in responseOptions
      const isOpenEndListForStmt = question.type?.toLowerCase().includes('open end list');
      if (!isOpenEndListForStmt) {
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
        // Open End List should not have statementOptions - clear them
        setEditedStatementOptions([]);
      }
    } else {
      setEditedStatementOptions([]);
    }
    
    // Initialize response options
    // For numeric grids:
    // 1. Use responseOptions if available
    // 2. Use options if available (for legacy data)
    // 3. Use statementOptions if available (for fallback)
    // For Open End List: If it has statementOptions (incorrectly stored), convert them to responseOptions
    const isNumericGrid = question.type?.toLowerCase().includes('numeric grid');
    const isOpenEndList = question.type?.toLowerCase().includes('open end list');
    const hasResponseOptions = question.responseOptions && Array.isArray(question.responseOptions) && question.responseOptions.length > 0;
    const hasOptions = question.options && Array.isArray(question.options) && question.options.length > 0;
    const hasStatementOptions = question.statementOptions && Array.isArray(question.statementOptions) && question.statementOptions.length > 0;

    // Always try to use responseOptions first, then options, then use # or % from tags for numeric grids
    // For Open End List: prioritize responseOptions, but if only statementOptions exist, use those
    let optionsToUse: any[] = [];
    if (hasResponseOptions && question.responseOptions) {
      // For numeric grids, check if responseOptions are valid (have at least one column with a label)
      if (isNumericGrid) {
        const validResponseOptions = question.responseOptions.filter((opt: any) => {
          const text = typeof opt === 'string' ? opt : (opt.text || '');
          return text.trim() !== '';
        });
        // If we have valid response options (at least one with a label), use them
        if (validResponseOptions.length > 0) {
          optionsToUse = question.responseOptions;
        } else {
          // Invalid or empty response options - use # or % from tags
          const hasPercentTag = question.tags && question.tags.includes('%');
          const hasNumberTag = question.tags && question.tags.includes('Number');
          const fallbackColumnLabel = hasPercentTag ? '%' : (hasNumberTag ? '#' : '#');
          optionsToUse = [{ code: '1', text: fallbackColumnLabel }];
        }
      } else {
        optionsToUse = question.responseOptions;
      }
    } else if (isOpenEndList && hasStatementOptions && question.statementOptions) {
      // For Open End List, if only statementOptions exist, use them (they should be responseOptions)
      optionsToUse = question.statementOptions;
    } else if (hasOptions && question.options) {
      // For legacy numeric grids, use the options field
      optionsToUse = question.options;
    } else if (isNumericGrid) {
      // For numeric grids without response options or with invalid response options, create fallback column with % or # based on tags
      const hasPercentTag = question.tags && question.tags.includes('%');
      const hasNumberTag = question.tags && question.tags.includes('Number');
      const fallbackColumnLabel = hasPercentTag ? '%' : (hasNumberTag ? '#' : '#');
      optionsToUse = [{ code: '1', text: fallbackColumnLabel }];
    }

    const responseOptions = optionsToUse.map((opt, idx) => {
      const respOpt = typeof opt === 'string' ? { code: `c${idx + 1}`, text: opt } : { code: opt.code || `c${idx + 1}`, text: opt.text || '' };
      // For numeric grids, extract the numeric code
      let numericCode: string;
      numericCode = respOpt.code.replace(/^[rc]/i, '');
      if (!numericCode || numericCode.trim() === '') {
        numericCode = String(idx + 1);
      }
      return { code: numericCode, text: respOpt.text || '' };
    });

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
    // IMPORTANT: Preserve the question ID to ensure proper matching when updating
    const updatedQuestion: Question = {
      ...question,
      id: question.id, // Explicitly preserve ID for matching
      number: editedQuestionNumber.trim(),
      text: editedQuestionText.trim(),
      type: editedType,
      // Only include options if the type needs them (Single Select, Multi-Select)
      // Plain Numeric questions should NOT have options
      options: fields.needsOptions
        ? (editedOptions.length > 0
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
          : [])
        : question.options || [],
      // Only include responseOptions if the type needs them (Numeric Grid, Open End List)
      // Plain Numeric questions should NOT have responseOptions
      responseOptions: fields.needsResponseOptions && editedResponseOptions.length > 0
        ? editedResponseOptions.map(opt => ({
            code: `c${opt.code}`,
            text: opt.text
          }))
        : fields.needsResponseOptions
          ? (question.responseOptions || []) // Preserve existing responseOptions if editedResponseOptions is empty
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
          <div className="flex items-start justify-between gap-4">
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium text-gray-700">Q#:</span>
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  value={editedQuestionNumber}
                  onChange={(e) => {
                    const newNumber = e.target.value;
                    setEditedQuestionNumber(newNumber);
                    
                    // Notify parent of question number change
                    if (onQuestionNumberChange) {
                      onQuestionNumberChange(newNumber);
                    }
                    
                    // Validate for duplicates (only check trimmed value)
                    if (allQuestions.length > 0 && newNumber.trim()) {
                      const isDuplicate = allQuestions.some((q: Question) => 
                        q.id !== question.id && 
                        q.number?.toUpperCase() === newNumber.trim().toUpperCase()
                      );
                      if (isDuplicate) {
                        setQuestionNumberError('This question number already exists');
                        if (onQuestionNumberErrorChange) {
                          onQuestionNumberErrorChange('This question number already exists');
                        }
                      } else {
                        setQuestionNumberError(null);
                        if (onQuestionNumberErrorChange) {
                          onQuestionNumberErrorChange(null);
                        }
                      }
                    } else {
                      setQuestionNumberError(null);
                      if (onQuestionNumberErrorChange) {
                        onQuestionNumberErrorChange(null);
                      }
                    }
                  }}
                  className={`px-2 py-1 text-sm border rounded focus:outline-none focus:ring-2 w-1/2 ${
                    questionNumberError 
                      ? 'border-red-500 focus:ring-red-500' 
                      : 'border-gray-300 focus:ring-[#D14A2D]'
                  }`}
                  placeholder="Q1"
                />
                {questionNumberError && (
                  <span className="text-xs text-red-600 whitespace-nowrap">{questionNumberError}</span>
                )}
              </div>
            </div>
            <div className="flex items-center gap-2">
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
                    <div className="absolute right-0 top-6 hidden group-hover:block z-50 w-64 p-2 bg-red-600 text-white text-xs rounded shadow-lg">
                      {validationError}
                    </div>
                  </div>
                ) : null;
              })()}
            </div>
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
                  <div className="flex items-end gap-2">
                    <label className="block text-sm font-medium text-gray-700">Response Options:</label>
                    <button
                      onClick={() => setEditedRandomize(!editedRandomize)}
                      className={`text-[10px] px-1.5 py-0.5 rounded ${
                        editedRandomize ? 'bg-blue-100 text-blue-800' : 'bg-gray-200 text-gray-600'
                      }`}
                      title="Toggle randomize options"
                    >
                      RANDOMIZE
                    </button>
                  </div>
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

          {/* Response Options (for grid questions, open end list) */}
          {(() => {
            const fields = getFieldsForType(editedType);
            const responsesToShow = fields.needsResponseOptions && editedResponseOptions.length === 0 ? [{ code: '1', text: '' }] : editedResponseOptions;
            const isOpenEnd = editedType?.toLowerCase().includes('open end') && !editedType?.toLowerCase().includes('list');
            const isNumericGrid = editedType?.toLowerCase().includes('numeric grid');
            return fields.needsResponseOptions && (
              <div>
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-end gap-2">
                    <label className="block text-sm font-medium text-gray-700">
                      {isOpenEnd ? 'Opt-out Options:' : fields.needsStatementOptions ? 'Response Options (Columns):' : 'Response Options:'}
                    </label>
                    {!isOpenEnd && (
                      <button
                        onClick={() => setEditedRandomize(!editedRandomize)}
                        className={`text-[10px] px-1.5 py-0.5 rounded ${
                          editedRandomize ? 'bg-blue-100 text-blue-800' : 'bg-gray-200 text-gray-600'
                        }`}
                        title="Toggle randomize response options"
                      >
                        RANDOMIZE
                      </button>
                    )}
                  </div>
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
                      {!isNumericGrid && (
                        <>
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
                        </>
                      )}
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
          {!hideSaveCancel && (
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
              {!hideDelete && (
                <button
                  onClick={handleDeleteQuestion}
                  className="flex items-center gap-1 px-4 py-2 text-sm font-medium text-white bg-red-600 hover:bg-red-700 rounded transition-colors"
                >
                  <TrashIcon className="w-4 h-4" />
                  Delete Question
                </button>
              )}
            </div>
          )}
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
            const isHiddenVariable = question.number?.startsWith('hid_');
            
            // Parse logic array once for hidden variables
            let logicArray: string[] = [];
            if (isHiddenVariable && question.logic) {
              if (typeof question.logic === 'string') {
                try {
                  // Try parsing as JSON array first
                  const parsed = JSON.parse(question.logic);
                  if (Array.isArray(parsed)) {
                    logicArray = parsed;
                  } else {
                    // If it's a single string, try to parse it by option
                    logicArray = parseLogicByOption(question.logic, question.options || []);
                  }
                } catch {
                  // If not valid JSON, check if it looks like an array string
                  const arrayMatch = question.logic.match(/\[(.*?)\]/);
                  if (arrayMatch) {
                    try {
                      logicArray = JSON.parse(question.logic);
                    } catch {
                      // Try to parse manually if JSON.parse fails
                      const items = question.logic.replace(/[\[\]"]/g, '').split(',').map(s => s.trim());
                      logicArray = items;
                    }
                  } else {
                    // If it's a single string with all logic, parse it by option
                    logicArray = parseLogicByOption(question.logic, question.options || []);
                  }
                }
              } else if (Array.isArray(question.logic)) {
                logicArray = question.logic;
              }
            }
            
            return (
              <div className="mb-3">
                <div className="flex items-end gap-2 mb-2">
                  <h4 className="text-xs font-medium text-gray-700">
                    Response Options:
                  </h4>
                  {question.randomize && (
                    <span className="text-[10px] px-1 py-0 rounded bg-blue-100 text-blue-800">RANDOMIZE</span>
                  )}
                </div>
                <div className="space-y-1">
                  {question.options.map((option, optIndex) => {
                    // Options should already be normalized with codes extracted, but handle both formats
                    let opt: { code: string; text: string; tags?: string[] };
                    if (typeof option === 'string') {
                      // Try to extract code from string (e.g., "99 Don't Know" -> code: "99", text: "Don't Know")
                      const codeMatch = option.match(/^(\d+):?\s+(.+)$/);
                      if (codeMatch) {
                        opt = { code: codeMatch[1], text: codeMatch[2].trim() };
                      } else {
                        opt = { code: String(optIndex + 1), text: option };
                      }
                    } else {
                      opt = { 
                        code: option.code || String(optIndex + 1), 
                        text: typeof option.text === 'string' ? option.text : String(option),
                        tags: option.tags
                      };
                    }
                    const shouldTerminate = terminateCodes.has(opt.code || String(optIndex + 1));
                    const { cleanText: rawCleanText, hasExclusive, hasAnchor, hasSpecify } = parseOptionTags(opt.text);
                    // If the text starts with the same code we're displaying, remove it to avoid duplication
                    // e.g., if code is "1" and text is "1 Yes", show just "Yes"
                    // Escape special regex characters in displayCode
                    let cleanText = rawCleanText;
                    const displayCodeForOption = opt.code || String(optIndex + 1);
                    const escapedCode = displayCodeForOption.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
                    const codePattern = new RegExp(`^${escapedCode}\\s+`, 'i');
                    if (cleanText.match(codePattern)) {
                      cleanText = cleanText.replace(codePattern, '').trim();
                    }
                    
                    // Get logic for this option (for hidden variables)
                    const logicText = isHiddenVariable ? (logicArray[optIndex] || null) : null;
                    
                    return (
                      <div key={optIndex} className="flex items-center gap-2 text-sm text-gray-700 flex-wrap">
                        <span className="font-mono text-xs text-gray-500 w-8">{opt.code}:</span>
                        <span>{formatDescriptionWithBrackets(cleanText)}</span>
                        {logicText && (
                          <span className="text-xs italic text-blue-600">
                            ({logicText})
                          </span>
                        )}
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
           question.statementOptions && question.statementOptions.length > 0 && (() => {
            // For numeric grids, if no responseOptions are detected, show a single column with # or % based on tags
            const hasResponseOptions = question.responseOptions && question.responseOptions.length > 0;
            const hasPercentTag = question.tags && question.tags.includes('%');
            const hasNumberTag = question.tags && question.tags.includes('Number');
            const fallbackColumnLabel = hasPercentTag ? '%' : (hasNumberTag ? '#' : '#');
            const displayResponseOptions: Array<{ code: string; text: string } | string> = hasResponseOptions 
              ? (question.responseOptions as Array<{ code: string; text: string } | string>) 
              : [{ code: 'c1', text: fallbackColumnLabel }];
            
            return (
              <div className="mb-3">
                <h4 className="text-xs font-medium text-gray-700 mb-2">Grid Structure:</h4>
                <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
                  <div className="overflow-x-auto">
                    <table className="min-w-full divide-y divide-gray-200">
                      <thead className="bg-gray-50">
                        <tr>
                          <th colSpan={2} className="px-4 py-2 text-left text-xs font-semibold text-gray-900">Statements (Rows)</th>
                          {displayResponseOptions && displayResponseOptions.map((resp, respIndex) => {
                            const respOpt = typeof resp === 'string' 
                              ? { code: `c${respIndex + 1}`, text: resp } 
                              : resp;
                            const displayCode = respOpt.code?.replace(/^[rc]/i, '') || String(respIndex + 1);
                            // For fallback columns (# or %), don't show the code in parentheses
                            const isFallbackColumn = respOpt.text === '#' || respOpt.text === '%';
                            return (
                              <th key={respIndex} className="px-4 py-2 text-center text-xs font-medium text-gray-500 uppercase tracking-wider whitespace-nowrap" style={{ width: '8rem' }}>
                                {formatDescriptionWithBrackets(respOpt.text)}{!isFallbackColumn && ` (${displayCode})`}
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
                              {displayResponseOptions && displayResponseOptions.map((resp, respIndex) => {
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
            );
          })()}

          {/* Statement Options (for grid questions - rows) - only show if not already shown in grid table */}
          {question.statementOptions && question.statementOptions.length > 0 && 
           !(question.type?.toLowerCase().includes('numeric grid')) && (() => {
            const terminateCodes = parseTerminateLogic(question.terminateLogic, question.statementOptions, question.type);
            // Check if this is a numeric grid that fell back (has statementOptions but no responseOptions)
            const isNumericGrid = question.type?.toLowerCase().includes('numeric grid');
            const hasNoResponseOptions = !question.responseOptions || question.responseOptions.length === 0;
            const hasOptions = isNumericGrid && question.options && question.options.length > 0;
            
            // DEBUG: Log for numeric grids
            if (isNumericGrid && question.number) {
              console.log(`[${question.number}] Statement Options Section Check:`, {
                hasStatementOptions: !!question.statementOptions,
                statementOptionsLength: question.statementOptions?.length,
                hasOptions,
                optionsLength: question.options?.length,
                hasResponseOptions: !hasNoResponseOptions,
                responseOptionsLength: question.responseOptions?.length,
                willShow: !(isNumericGrid && (hasOptions || hasNoResponseOptions === false))
              });
            }
            
            // For numeric grids: only show Statement Options if it's a fallback (no options, no responseOptions)
            // Otherwise, Response Options section will show the data, so hide this section to avoid duplicates
            // IMPORTANT: If numeric grid has ANY options or responseOptions, never show Statement Options section
            if (isNumericGrid) {
              const hasAnyResponseData = hasOptions || (question.responseOptions && question.responseOptions.length > 0);
              if (hasAnyResponseData) {
                console.log(`[${question.number}] HIDING Statement Options section - numeric grid has options or responseOptions`);
                return null;
              }
            }
            const isFallbackNumericGrid = isNumericGrid && hasNoResponseOptions;
            
            // Prevent duplicate rendering for numeric grids - use a ref to track if we've already rendered this section
            const statementSectionKey = `statement-options-${question.id || question.number}`;
            const responseSectionKey = `response-options-${question.id || question.number}`;
            // If Response Options section has already been rendered, don't render Statement Options
            if (isNumericGrid && renderedSectionsRef.current.has(responseSectionKey)) {
              console.log(`[${question.number}] HIDING Statement Options section - Response Options section already rendered`);
              return null;
            }
            if (isNumericGrid && renderedSectionsRef.current.has(statementSectionKey)) {
              console.log(`[${question.number}] DUPLICATE PREVENTED: Statement Options section already rendered`);
              return null;
            }
            // Mark that we're about to render Statement Options section, so Response Options section knows to hide
            if (isNumericGrid) {
              renderedSectionsRef.current.add(statementSectionKey);
              renderedSectionsRef.current.add(responseSectionKey); // Block Response Options too
            }
            
            return (
              <div className="mb-3">
                <div className="flex items-end gap-2 mb-2">
                  <h4 className="text-xs font-medium text-gray-700">
                    {isFallbackNumericGrid ? 'Response Options:' : 'Statement Options (Rows):'}
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
                    // For fallback numeric grids, display just the number
                    const displayCode = isFallbackNumericGrid 
                      ? String(stmtIndex + 1)
                      : (stmtOpt.code || defaultCode);
                    const codeForTerminate = isFallbackNumericGrid 
                      ? String(stmtIndex + 1)
                      : (stmtOpt.code || defaultCode);
                    const shouldTerminate = terminateCodes.has(codeForTerminate);
                    // If the text starts with the same code we're displaying, remove it to avoid duplication
                    // e.g., if displayCode is "1" and text is "1 Yes", show just "Yes"
                    // Escape special regex characters in displayCode
                    let displayText = stmtOpt.text || '';
                    const escapedCode = displayCode.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
                    const codePattern = new RegExp(`^${escapedCode}\\s+`, 'i');
                    if (displayText.match(codePattern)) {
                      displayText = displayText.replace(codePattern, '').trim();
                    }
                    return (
                      <div key={stmtIndex} className="flex items-center gap-2 text-sm text-gray-700">
                        <span className="font-mono text-xs text-gray-500 w-8">{displayCode}:</span>
                        <span>{formatDescriptionWithBrackets(displayText)}</span>
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
          {/* For numeric grids, also check the options field if responseOptions is not available */}
          {(() => {
            const isNumericGrid = question.type?.toLowerCase().includes('numeric grid');
            const hasResponseOptions = question.responseOptions && question.responseOptions.length > 0;
            const hasOptions = isNumericGrid && question.options && question.options.length > 0;
            // For numeric grids, prioritize options over responseOptions to avoid duplicates
            // If numeric grid has options, use those. Otherwise use responseOptions.
            const optionsToDisplay = (isNumericGrid && hasOptions) ? question.options : (hasResponseOptions ? question.responseOptions : (hasOptions ? question.options : null));
            
            // DEBUG: Log for numeric grids
            if (isNumericGrid && question.number) {
              console.log(`[${question.number}] Response Options Section Check:`, {
                hasOptions,
                optionsLength: question.options?.length,
                options: question.options,
                hasResponseOptions,
                responseOptionsLength: question.responseOptions?.length,
                responseOptions: question.responseOptions,
                hasStatementOptions: !!question.statementOptions,
                statementOptionsLength: question.statementOptions?.length,
                statementOptions: question.statementOptions,
                optionsToDisplayLength: optionsToDisplay?.length,
                optionsToDisplay: optionsToDisplay,
                willShow: !(!optionsToDisplay || optionsToDisplay.length === 0) && 
                         !(isNumericGrid && !hasOptions && !hasResponseOptions && question.statementOptions && question.statementOptions.length > 0)
              });
            }
            
            if (!optionsToDisplay || optionsToDisplay.length === 0) return null;
            if (question.type?.toLowerCase().includes('numeric grid') && question.statementOptions && question.statementOptions.length > 0) return null;
            if (question.type?.toLowerCase() === 'numeric') return null; // Exclude plain Numeric questions (single response box - no responseOptions)
            // For numeric grids: 
            // - If they have options OR responseOptions, show in this Response Options section
            // - If they only have statementOptions (fallback case), they'll be shown in Statement Options section instead
            // So don't show this Response Options section for fallback numeric grids (they're shown in Statement Options section)
            if (isNumericGrid && !hasOptions && !hasResponseOptions && question.statementOptions && question.statementOptions.length > 0) {
              console.log(`[${question.number}] HIDING Response Options section - numeric grid only has statementOptions (fallback case)`);
              return null;
            }
            // Additional safety check: if this is a numeric grid and we're about to show the same data that's in statementOptions,
            // and statementOptions section is also showing, hide this one to avoid duplicates
            if (isNumericGrid && question.statementOptions && question.statementOptions.length > 0 && 
                optionsToDisplay && optionsToDisplay.length > 0 &&
                optionsToDisplay.length === question.statementOptions.length &&
                JSON.stringify(optionsToDisplay) === JSON.stringify(question.statementOptions) &&
                !hasOptions && !hasResponseOptions) {
              console.log(`[${question.number}] HIDING Response Options section - same data as statementOptions`);
              return null;
            }
            
            // Prevent duplicate rendering for numeric grids - use a ref to track if we've already rendered this section
            const sectionKey = `response-options-${question.id || question.number}`;
            if (isNumericGrid && renderedSectionsRef.current.has(sectionKey)) {
              console.log(`[${question.number}] DUPLICATE PREVENTED: Response Options section already rendered`);
              return null;
            }
            // Mark that we're about to render Response Options section, so Statement Options section knows to hide
            if (isNumericGrid) {
              renderedSectionsRef.current.add(sectionKey);
              renderedSectionsRef.current.add(`statement-options-${question.id || question.number}`); // Block Statement Options too
            }
            
            return (() => {
            const terminateCodes = parseTerminateLogic(question.terminateLogic, optionsToDisplay, question.type);
            const isOpenEnd = question.type?.toLowerCase().includes('open end') && !question.type?.toLowerCase().includes('list');
            const isHiddenVariable = question.number?.startsWith('hid_');
            
            // For hidden variables, show as table with definition column
            if (isHiddenVariable) {
              // Parse logic array once for all options
              // Check both question.logic and question.showLogic for hidden variables
              let logicArray: string[] = [];
              let originalLogicString: string | null = null;
              const logicSource = question.logic || question.showLogic;
              
              if (logicSource) {
                if (typeof logicSource === 'string') {
                  originalLogicString = logicSource;
                  try {
                    // Try parsing as JSON array first
                    const parsed = JSON.parse(logicSource);
                    if (Array.isArray(parsed)) {
                      logicArray = parsed;
                    } else {
                      // If it's a single string, try to parse it by option
                      logicArray = parseLogicByOption(logicSource, optionsToDisplay);
                    }
                  } catch {
                    // If not valid JSON, check if it looks like an array string
                    const arrayMatch = logicSource.match(/\[(.*?)\]/);
                    if (arrayMatch) {
                      try {
                        logicArray = JSON.parse(logicSource);
                      } catch {
                        // Try to parse manually if JSON.parse fails
                        const items = logicSource.replace(/[\[\]"]/g, '').split(',').map(s => s.trim());
                        logicArray = items;
                      }
                    } else {
                      // If it's a single string with all logic, parse it by option
                      logicArray = parseLogicByOption(logicSource, optionsToDisplay);
                    }
                  }
                } else if (Array.isArray(logicSource)) {
                  logicArray = logicSource;
                }
              }
              
              // Fallback: If parsing returned all empty strings, use the original logic string for all options
              if (originalLogicString && logicArray.every(logic => !logic)) {
                logicArray = new Array(optionsToDisplay.length).fill(originalLogicString);
              }
              
              return (
                <div key={`response-options-hidden-${question.id || question.number}`} className="mb-3">
                  <div className="flex items-end gap-2 mb-2">
                    <h4 className="text-xs font-medium text-gray-700">
                      {isOpenEnd ? 'Opt-out Options:' : 'Response Options (Columns):'}
                    </h4>
                    {question.randomize && (
                      <span className="text-[10px] px-1 py-0 rounded bg-blue-100 text-blue-800">RANDOMIZE</span>
                    )}
                  </div>
                  <div className="overflow-x-auto">
                    <table className="min-w-full divide-y divide-gray-200">
                      <thead className="bg-gray-50">
                        <tr>
                          <th className="px-3 py-2 text-left text-xs font-medium text-gray-700 uppercase tracking-wider">Code</th>
                          <th className="px-3 py-2 text-left text-xs font-medium text-gray-700 uppercase tracking-wider">Text</th>
                          <th className="px-3 py-2 text-left text-xs font-medium text-gray-700 uppercase tracking-wider">Definition</th>
                        </tr>
                      </thead>
                      <tbody className="bg-white divide-y divide-gray-200">
                        {optionsToDisplay.map((resp, respIndex) => {
                          // If resp is a string, try to extract code from it (e.g., "99 Don't know" -> code: "99", text: "Don't know")
                          let respOpt: { code: string; text: string };
                          if (typeof resp === 'string') {
                            // Try to extract leading number as code
                            const codeMatch = resp.match(/^(\d+):?\s+(.+)$/);
                            if (codeMatch) {
                              respOpt = { code: `c${codeMatch[1]}`, text: codeMatch[2].trim() };
                            } else {
                              respOpt = { code: `c${respIndex + 1}`, text: resp };
                            }
                          } else {
                            respOpt = resp;
                          }
                          // For numeric grids, use just the number (1, 2, 3) instead of c1, r1, etc.
                          const isNumericGridType = question.type?.toLowerCase().includes('numeric grid');
                          const hasResponseOpts = question.responseOptions && question.responseOptions.length > 0;
                          const hasOpts = question.options && question.options.length > 0;
                          const isNumericGridDisplay = isNumericGridType && !hasResponseOpts && hasOpts;
                          const displayCode = isNumericGridDisplay 
                            ? String(respIndex + 1)
                            : (respOpt.code?.replace(/^[rc]/i, '') || String(respIndex + 1));
                          const codeForTerminate = isNumericGridDisplay 
                            ? String(respIndex + 1)
                            : (respOpt.code || `c${respIndex + 1}`);
                          const shouldTerminate = terminateCodes.has(codeForTerminate);
                          const { cleanText: rawCleanText, hasExclusive, hasAnchor, hasSpecify } = parseOptionTags(respOpt.text);
                          // If the text starts with the same code we're displaying, remove it to avoid duplication
                          // e.g., if displayCode is "99" and text is "99 Don't know", show just "Don't know"
                          // Escape special regex characters in displayCode
                          let cleanText = rawCleanText;
                          const escapedCode = displayCode.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
                          const codePattern = new RegExp(`^${escapedCode}\\s+`, 'i');
                          if (cleanText.match(codePattern)) {
                            cleanText = cleanText.replace(codePattern, '').trim();
                          }
                          const definition = getOptionDefinition(question.terminateLogic, codeForTerminate);
                          
                          // Get logic for this response option (logic is an array matching response options in order)
                          const logicText = logicArray[respIndex] || null;
                          
                          // For hidden variables, use the parsed logic as the definition if available
                          const displayDefinition = logicText || definition || '-';
                          
                          return (
                            <tr key={respIndex} className="hover:bg-gray-50">
                              <td className="px-3 py-2 text-sm font-mono text-gray-500">
                                {displayCode}
                              </td>
                              <td className="px-3 py-2 text-sm text-gray-700">
                                <div className="flex items-center gap-1 flex-wrap">
                                  <span>{formatDescriptionWithBrackets(cleanText)}</span>
                                  {logicText && (
                                    <span className="text-xs italic text-blue-600">
                                      ({logicText})
                                    </span>
                                  )}
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
                              </td>
                              <td className="px-3 py-2 text-sm text-blue-600 italic">
                                {displayDefinition !== '-' ? (
                                  <span className="normal-case">{displayDefinition}</span>
                                ) : (
                                  <span className="uppercase">{displayDefinition}</span>
                                )}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              );
            }
            
            // For regular questions, show as list (original format)
            // For numeric grids with options, show as "Response Options:" not "Response Options (Columns):"
            const isNumericGridType = question.type?.toLowerCase().includes('numeric grid');
            const isNumericGridWithOptions = isNumericGridType && !question.responseOptions && question.options && question.options.length > 0;
            return (
              <div key={`response-options-${question.id || question.number}`} className="mb-3">
                <div className="flex items-end gap-2 mb-2">
                  <h4 className="text-xs font-medium text-gray-700">
                    {isOpenEnd ? 'Opt-out Options:' : (isNumericGridWithOptions ? 'Response Options:' : 'Response Options (Columns):')}
                  </h4>
                  {question.randomize && (
                    <span className="text-[10px] px-1 py-0 rounded bg-blue-100 text-blue-800">RANDOMIZE</span>
                  )}
                </div>
                <div className="space-y-1">
                  {optionsToDisplay.map((resp, respIndex) => {
                    // If resp is a string, try to extract code from it (e.g., "99 Don't know" -> code: "99", text: "Don't know")
                    let respOpt: { code: string; text: string };
                    if (typeof resp === 'string') {
                      // Try to extract leading number as code
                      const codeMatch = resp.match(/^(\d+):?\s+(.+)$/);
                      if (codeMatch) {
                        respOpt = { code: `c${codeMatch[1]}`, text: codeMatch[2].trim() };
                      } else {
                        respOpt = { code: `c${respIndex + 1}`, text: resp };
                      }
                    } else {
                      respOpt = resp;
                    }
                    // For numeric lists, use just the number (1, 2, 3) instead of c1, r1, etc.
                    // But if the code exists, extract the numeric part from it
                    let displayCode: string;
                    if (isNumericGridWithOptions) {
                      // For numeric grids, try to extract the numeric code, otherwise use index
                      const numericCode = respOpt.code?.replace(/^[rc]/i, '') || String(respIndex + 1);
                      displayCode = numericCode;
                    } else {
                      // For other types, remove prefix and use the code, or fallback to index
                      displayCode = respOpt.code?.replace(/^[rc]/i, '') || String(respIndex + 1);
                    }
                    const codeForTerminate = isNumericGridWithOptions 
                      ? String(respIndex + 1)
                      : (respOpt.code || `c${respIndex + 1}`);
                    const shouldTerminate = terminateCodes.has(codeForTerminate);
                    const { cleanText: rawCleanText, hasExclusive, hasAnchor, hasSpecify } = parseOptionTags(respOpt.text);
                    // If the text starts with the same code we're displaying, remove it to avoid duplication
                    // e.g., if displayCode is "1" and text is "1 Yes", show just "Yes"
                    // Escape special regex characters in displayCode
                    let cleanText = rawCleanText;
                    const escapedCode = displayCode.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
                    const codePattern = new RegExp(`^${escapedCode}\\s+`, 'i');
                    if (cleanText.match(codePattern)) {
                      cleanText = cleanText.replace(codePattern, '').trim();
                    }
                    return (
                      <div key={respIndex} className="flex items-center gap-2 text-sm text-gray-700">
                        <span className="font-mono text-xs text-gray-500 w-8">{displayCode}:</span>
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
          })();
          })()}

      {/* Logic (only show if there's logic but no showLogic, since showLogic is shown above question number) */}
      {/* Hide logic section for hidden variables since logic is now displayed inline with response options */}
      {!question.showLogic && question.logic && !question.number?.startsWith('hid_') && (
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

      {/* Validation */}
      {question.validation && (() => {
        // Helper function to resolve validation value (e.g., "S4r5" -> "S4r5c1" for numeric grids with 1 column)
        const resolveValidationValue = (value: any, allQuestions: Question[]): any => {
          if (!value || typeof value !== 'string') return value;
          
          // Pattern: S4r5 or Q1r3 (question number + row number, no column)
          const match = value.match(/^([A-Z0-9]+)(r\d+)$/i);
          if (!match) return value; // Already has column or doesn't match pattern
          
          const [, questionNum, rowNum] = match;
          
          // Find the referenced question
          const refQuestion = allQuestions.find(q => {
            const qNum = (q.number || q.id || '').toUpperCase();
            return qNum === questionNum.toUpperCase();
          });
          
          if (!refQuestion) return value;
          
          // Check if it's a numeric grid with responseOptions (columns)
          const refQuestionType = (refQuestion.type || '').toLowerCase();
          const isNumericGrid = refQuestionType.includes('numeric grid');
          const hasColumns = refQuestion.responseOptions && refQuestion.responseOptions.length > 0;
          
          // If it's a numeric grid with exactly 1 column, add c1
          if (isNumericGrid && hasColumns && refQuestion.responseOptions.length === 1) {
            return `${questionNum}${rowNum}c1`;
          }
          
          return value;
        };
        
        // Create a resolved validation object for display
        let displayValidation = question.validation;
        if (typeof question.validation === 'object' && question.validation !== null) {
          const validation = question.validation as any;
          if (validation.type === 'sum' && typeof validation.value === 'string') {
            displayValidation = {
              ...validation,
              value: resolveValidationValue(validation.value, allQuestions)
            };
          }
        }
        
        return (
          <div className="mb-3">
            <h4 className="text-xs font-medium text-gray-700 mb-1">Validation:</h4>
            <p className="text-xs text-gray-600 font-mono bg-gray-50 p-2 rounded">
              {typeof displayValidation === 'string' 
                ? displayValidation 
                : JSON.stringify(displayValidation)}
            </p>
          </div>
        );
      })()}

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
        }),
        manuallyFlipped: true // Mark as manually flipped to override fallback logic
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
        // Try to extract leading number as code (e.g., "1 Yes" -> code: "1", text: "Yes")
        const codeMatch = opt.match(/^(\d+):?\s+(.+)$/);
        if (codeMatch) {
          return { code: codeMatch[1], text: codeMatch[2].trim() };
        }
        return { code: String(idx + 1), text: opt };
      }
      // If it's already an object, extract numeric part of code if it has a prefix
      const numericCode = opt.code?.replace(/^[rc]/i, '') || String(idx + 1);
      return { code: numericCode, text: opt.text || opt.code || '' };
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
      {isSingleSelect && (() => {
        const hasScaleTag = question.tags && question.tags.includes('Scale');
        const options = getOptions();
        
        // If Scale tag is present, render horizontally in a table
        if (hasScaleTag) {
          return (
            <div className="overflow-x-auto">
              <table className="w-full border border-gray-300 rounded-lg" style={{ tableLayout: 'fixed' }}>
                <tbody>
                  <tr>
                    {options.map((opt, optIdx) => {
                      // Remove the code from the beginning of the text if it's still there
                      let displayText = opt.text || opt.code || '';
                      const escapedCode = opt.code.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
                      const codePattern = new RegExp(`^${escapedCode}\\s+`, 'i');
                      if (displayText.match(codePattern)) {
                        displayText = displayText.replace(codePattern, '').trim();
                      }
                      const { cleanText, hasExclusive, hasAnchor, hasSpecify } = parseOptionTags(displayText);
                      const numColumns = options.length;
                      const columnWidth = `${100 / numColumns}%`;
                      return (
                        <td
                          key={optIdx}
                          className="px-4 py-3 text-center border-r border-gray-300 last:border-r-0"
                          style={{ width: columnWidth }}
                        >
                          <label className="flex flex-col items-center gap-2 cursor-pointer hover:bg-gray-50 rounded p-2">
                            <input
                              type="radio"
                              name={`question-${question.id || index}`}
                              value={opt.code}
                              className="w-4 h-4 focus:ring-2 focus:ring-[#D14A2D]"
                              style={{ accentColor: BRAND_ORANGE }}
                            />
                            <span className="text-sm text-gray-700 text-center">
                              {formatDescriptionWithBrackets(cleanText)}
                            </span>
                            <div className="flex items-center gap-1 justify-center">
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
                            <div className="mt-2">
                              <input
                                type="text"
                                placeholder="Please specify..."
                                className="w-full px-2 py-1 text-xs border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-[#D14A2D]"
                              />
                            </div>
                          )}
                        </td>
                      );
                    })}
                  </tr>
                </tbody>
              </table>
            </div>
          );
        }
        
        // Default vertical list rendering
        return (
          <div className="space-y-2">
            {options.map((opt, optIdx) => {
              // Remove the code from the beginning of the text if it's still there
              let displayText = opt.text || opt.code || '';
              const escapedCode = opt.code.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
              const codePattern = new RegExp(`^${escapedCode}\\s+`, 'i');
              if (displayText.match(codePattern)) {
                displayText = displayText.replace(codePattern, '').trim();
              }
              const { cleanText, hasExclusive, hasAnchor, hasSpecify } = parseOptionTags(displayText);
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
        );
      })()}

      {/* Multi-Select */}
      {isMultiSelect && (
        <div className="space-y-2">
          {getOptions().map((opt, optIdx) => {
            // Remove the code from the beginning of the text if it's still there
            let displayText = opt.text || opt.code || '';
            const escapedCode = opt.code.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            const codePattern = new RegExp(`^${escapedCode}\\s+`, 'i');
            if (displayText.match(codePattern)) {
              displayText = displayText.replace(codePattern, '').trim();
            }
            const { cleanText, hasExclusive, hasAnchor, hasSpecify } = parseOptionTags(displayText);
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
                    // Extract code from string if it starts with a number
                    let optObj: { code: string; text: string };
                    if (typeof opt === 'string') {
                      const codeMatch = opt.match(/^(\d+):?\s+(.+)$/);
                      if (codeMatch) {
                        optObj = { code: codeMatch[1], text: codeMatch[2].trim() };
                      } else {
                        optObj = { code: String(optIdx + 1), text: opt };
                      }
                    } else {
                      const numericCode = opt.code?.replace(/^[rc]/i, '') || String(optIdx + 1);
                      optObj = { code: numericCode, text: opt.text || opt.code || '' };
                    }
                    // Remove the code from the beginning of the text if it's still there
                    let displayText = optObj.text;
                    const escapedCode = optObj.code.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
                    const codePattern = new RegExp(`^${escapedCode}\\s+`, 'i');
                    if (displayText.match(codePattern)) {
                      displayText = displayText.replace(codePattern, '').trim();
                    }
                    const { cleanText, hasExclusive, hasAnchor, hasSpecify } = parseOptionTags(displayText);
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
                  // Extract code from string if it starts with a number
                  let respOpt: { code: string; text: string };
                  if (typeof resp === 'string') {
                    const codeMatch = resp.match(/^(\d+):?\s+(.+)$/);
                    if (codeMatch) {
                      respOpt = { code: codeMatch[1], text: codeMatch[2].trim() };
                    } else {
                      respOpt = { code: `c${respIdx + 1}`, text: resp };
                    }
                  } else {
                    const numericCode = resp.code?.replace(/^[rc]/i, '') || `c${respIdx + 1}`;
                    respOpt = { code: numericCode, text: resp.text || resp.code || '' };
                  }
                  // Remove the code from the beginning of the text if it's still there
                  let displayText = respOpt.text;
                  const escapedCode = respOpt.code.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
                  const codePattern = new RegExp(`^${escapedCode}\\s+`, 'i');
                  if (displayText.match(codePattern)) {
                    displayText = displayText.replace(codePattern, '').trim();
                  }
                  const { cleanText } = parseOptionTags(displayText);
                  return (
                    <th key={respIdx} className="px-4 py-2 text-center text-sm font-medium text-gray-700 border-b border-gray-300">
                      {formatDescriptionWithBrackets(cleanText || displayText)}
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {displayStatementOptions.map((stmt, stmtIdx) => {
                // Extract code from string if it starts with a number
                let stmtOpt: { code: string; text: string };
                if (typeof stmt === 'string') {
                  const codeMatch = stmt.match(/^(\d+):?\s+(.+)$/);
                  if (codeMatch) {
                    stmtOpt = { code: codeMatch[1], text: codeMatch[2].trim() };
                  } else {
                    stmtOpt = { code: `r${stmtIdx + 1}`, text: stmt };
                  }
                } else {
                  const numericCode = stmt.code?.replace(/^[rc]/i, '') || `r${stmtIdx + 1}`;
                  stmtOpt = { code: numericCode, text: stmt.text || stmt.code || '' };
                }
                // Remove the code from the beginning of the text if it's still there
                let displayText = stmtOpt.text;
                const escapedCode = stmtOpt.code.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
                const codePattern = new RegExp(`^${escapedCode}\\s+`, 'i');
                if (displayText.match(codePattern)) {
                  displayText = displayText.replace(codePattern, '').trim();
                }
                const { cleanText } = parseOptionTags(displayText);
                return (
                  <tr key={stmtIdx} className="border-b border-gray-200">
                    <td className="px-4 py-3 text-sm text-gray-700">{formatDescriptionWithBrackets(cleanText || displayText)}</td>
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
                  // Extract code from string if it starts with a number
                  let respOpt: { code: string; text: string };
                  if (typeof resp === 'string') {
                    const codeMatch = resp.match(/^(\d+):?\s+(.+)$/);
                    if (codeMatch) {
                      respOpt = { code: codeMatch[1], text: codeMatch[2].trim() };
                    } else {
                      respOpt = { code: `c${respIdx + 1}`, text: resp };
                    }
                  } else {
                    const numericCode = resp.code?.replace(/^[rc]/i, '') || `c${respIdx + 1}`;
                    respOpt = { code: numericCode, text: resp.text || resp.code || '' };
                  }
                  // Remove the code from the beginning of the text if it's still there
                  let displayText = respOpt.text;
                  const escapedCode = respOpt.code.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
                  const codePattern = new RegExp(`^${escapedCode}\\s+`, 'i');
                  if (displayText.match(codePattern)) {
                    displayText = displayText.replace(codePattern, '').trim();
                  }
                  const { cleanText } = parseOptionTags(displayText);
                  return (
                    <th key={respIdx} className="px-4 py-2 text-center text-sm font-medium text-gray-700 border-b border-gray-300">
                      {formatDescriptionWithBrackets(cleanText || displayText)}
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {displayStatementOptions.map((stmt, stmtIdx) => {
                // Extract code from string if it starts with a number
                let stmtOpt: { code: string; text: string };
                if (typeof stmt === 'string') {
                  const codeMatch = stmt.match(/^(\d+):?\s+(.+)$/);
                  if (codeMatch) {
                    stmtOpt = { code: codeMatch[1], text: codeMatch[2].trim() };
                  } else {
                    stmtOpt = { code: `r${stmtIdx + 1}`, text: stmt };
                  }
                } else {
                  const numericCode = stmt.code?.replace(/^[rc]/i, '') || `r${stmtIdx + 1}`;
                  stmtOpt = { code: numericCode, text: stmt.text || stmt.code || '' };
                }
                // Remove the code from the beginning of the text if it's still there
                let displayText = stmtOpt.text;
                const escapedCode = stmtOpt.code.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
                const codePattern = new RegExp(`^${escapedCode}\\s+`, 'i');
                if (displayText.match(codePattern)) {
                  displayText = displayText.replace(codePattern, '').trim();
                }
                const { cleanText } = parseOptionTags(displayText);
                return (
                  <tr key={stmtIdx} className="border-b border-gray-200">
                    <td className="px-4 py-3 text-sm text-gray-700">{formatDescriptionWithBrackets(cleanText || displayText)}</td>
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
      {isNumericGrid && question.statementOptions && question.statementOptions.length > 0 && (() => {
        // For numeric grids, if no responseOptions are detected or they're invalid, show a single column with # or % based on tags
        const hasResponseOptions = question.responseOptions && question.responseOptions.length > 0;
        let displayResponseOptions: Array<{ code: string; text: string } | string> = [];
        
        if (hasResponseOptions && question.responseOptions) {
          // Check if responseOptions are valid (have at least one column with a label)
          const validResponseOptions = question.responseOptions.filter((opt: any) => {
            const text = typeof opt === 'string' ? opt : (opt.text || '');
            return text.trim() !== '';
          });
          // If we have valid response options (at least one with a label), use them
          if (validResponseOptions.length > 0) {
            displayResponseOptions = question.responseOptions;
          } else {
            // Invalid or empty response options - use # or % from tags
            const hasPercentTag = question.tags && question.tags.includes('%');
            const hasNumberTag = question.tags && question.tags.includes('Number');
            const fallbackColumnLabel = hasPercentTag ? '%' : (hasNumberTag ? '#' : '#');
            displayResponseOptions = [{ code: 'c1', text: fallbackColumnLabel }];
          }
        } else {
          // No response options - use # or % from tags
          const hasPercentTag = question.tags && question.tags.includes('%');
          const hasNumberTag = question.tags && question.tags.includes('Number');
          const fallbackColumnLabel = hasPercentTag ? '%' : (hasNumberTag ? '#' : '#');
          displayResponseOptions = [{ code: 'c1', text: fallbackColumnLabel }];
        }
        
        return (
          <div className="overflow-x-auto">
            <table className="w-full border border-gray-300 rounded-lg" style={{ tableLayout: 'fixed' }}>
              <thead>
                <tr className="bg-gray-50">
                  <th className="px-4 py-2 text-left text-sm font-medium text-gray-700 border-b border-gray-300"></th>
                  {displayResponseOptions.map((resp, respIdx) => {
                    // Extract code from string if it starts with a number
                    let respOpt: { code: string; text: string };
                    if (typeof resp === 'string') {
                      const codeMatch = resp.match(/^(\d+):?\s+(.+)$/);
                      if (codeMatch) {
                        respOpt = { code: codeMatch[1], text: codeMatch[2].trim() };
                      } else {
                        respOpt = { code: `c${respIdx + 1}`, text: resp };
                      }
                    } else {
                      const numericCode = resp.code?.replace(/^[rc]/i, '') || `c${respIdx + 1}`;
                      respOpt = { code: numericCode, text: resp.text || resp.code || '' };
                    }
                    // Remove the code from the beginning of the text if it's still there
                    let displayText = respOpt.text;
                    const escapedCode = respOpt.code.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
                    const codePattern = new RegExp(`^${escapedCode}\\s+`, 'i');
                    if (displayText.match(codePattern)) {
                      displayText = displayText.replace(codePattern, '').trim();
                    }
                    const { cleanText } = parseOptionTags(displayText);
                    const numColumns = displayResponseOptions.length;
                    // Response columns share remaining space equally (assuming first column takes ~30%)
                    const columnWidth = `${70 / numColumns}%`;
                    return (
                      <th
                        key={respIdx}
                        className="px-4 py-2 text-center text-sm font-medium text-gray-700 border-b border-gray-300"
                        style={{ width: columnWidth }}
                      >
                        {formatDescriptionWithBrackets(cleanText || displayText)}
                      </th>
                    );
                  })}
                </tr>
              </thead>
              <tbody>
                {question.statementOptions.map((stmt, stmtIdx) => {
                  // Extract code from string if it starts with a number
                  let stmtOpt: { code: string; text: string };
                  if (typeof stmt === 'string') {
                    const codeMatch = stmt.match(/^(\d+):?\s+(.+)$/);
                    if (codeMatch) {
                      stmtOpt = { code: codeMatch[1], text: codeMatch[2].trim() };
                    } else {
                      stmtOpt = { code: `r${stmtIdx + 1}`, text: stmt };
                    }
                  } else {
                    const numericCode = stmt.code?.replace(/^[rc]/i, '') || `r${stmtIdx + 1}`;
                    stmtOpt = { code: numericCode, text: stmt.text || stmt.code || '' };
                  }
                  // Remove the code from the beginning of the text if it's still there
                  let displayText = stmtOpt.text;
                  const escapedCode = stmtOpt.code.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
                  const codePattern = new RegExp(`^${escapedCode}\\s+`, 'i');
                  if (displayText.match(codePattern)) {
                    displayText = displayText.replace(codePattern, '').trim();
                  }
                  const { cleanText } = parseOptionTags(displayText);
                  const numColumns = displayResponseOptions.length;
                  const columnWidth = `${70 / numColumns}%`;
                  return (
                    <tr key={stmtIdx} className="border-b border-gray-200">
                      <td className="px-4 py-3 text-sm text-gray-700">{formatDescriptionWithBrackets(cleanText || displayText)}</td>
                      {displayResponseOptions.map((resp, respIdx) => (
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
        );
      })()}

      {/* Open End List */}
      {isOpenEndList && question.responseOptions && (
        <div className="space-y-3">
          {question.responseOptions.map((resp, respIdx) => {
            // Extract code from string if it starts with a number
            let respOpt: { code: string; text: string };
            if (typeof resp === 'string') {
              const codeMatch = resp.match(/^(\d+):?\s+(.+)$/);
              if (codeMatch) {
                respOpt = { code: codeMatch[1], text: codeMatch[2].trim() };
              } else {
                respOpt = { code: `r${respIdx + 1}`, text: resp };
              }
            } else {
              const numericCode = resp.code?.replace(/^[rc]/i, '') || `r${respIdx + 1}`;
              respOpt = { code: numericCode, text: resp.text || resp.code || '' };
            }
            // Remove the code from the beginning of the text if it's still there
            let displayText = respOpt.text;
            const escapedCode = respOpt.code.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            const codePattern = new RegExp(`^${escapedCode}\\s+`, 'i');
            if (displayText.match(codePattern)) {
              displayText = displayText.replace(codePattern, '').trim();
            }
            const { cleanText } = parseOptionTags(displayText);
            return (
              <div key={respIdx}>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  {formatDescriptionWithBrackets(cleanText || displayText)}
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

    </div>
  );
}


