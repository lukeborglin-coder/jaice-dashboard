import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { createPortal } from 'react-dom';
import {
  ArrowLeftIcon,
  MagnifyingGlassIcon,
  ArrowPathIcon,
  CloudArrowUpIcon,
  TrashIcon,
  XMarkIcon,
  InformationCircleIcon,
  PlusCircleIcon,
  ChevronUpIcon,
  ChevronDownIcon,
  PencilIcon,
  EyeIcon,
  EyeSlashIcon,
  FunnelIcon,
} from '@heroicons/react/24/outline';
import { IconTable, IconCheckbox } from '@tabler/icons-react';
import { API_BASE_URL } from '../config';
import { useAuth } from '../contexts/AuthContext';
import { useNavigate } from 'react-router-dom';
import * as XLSX from 'xlsx';
import { type BannerGroup, type BannerCut } from '../types/dataTabulation';
import BannerBuilder from './BannerBuilder';
import CrossTabDisplay from './CrossTabDisplay';
import { type ParsedDataFile } from '../utils/dataTabulationHelpers';
import { autoMatchHeaders } from '../utils/headerMatcher';

const BRAND_ORANGE = '#D14A2D';
const BRAND_BG = '#F7F7F8';
const BRAND_GRAY = '#5D5F62';

interface TabsProps {
  projects?: any[];
  onNavigateToProject?: (project: any) => void;
  onHeaderChange?: (header: string | null) => void;
}

interface Variable {
  name: string;
  description: string;
  type: string;
  codes?: Record<string, string>;
  statements?: Record<string, string>;
  tags?: string[];
  isSummaryTable?: boolean;
  isScaleSummary?: boolean;
}

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

export default function Tabs({ projects = [], onNavigateToProject, onHeaderChange }: TabsProps) {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [viewMode, setViewMode] = useState<'home' | 'project' | 'qnr'>('home');
  const [activeTab, setActiveTab] = useState<'active' | 'archived'>('active');
  const [showMyProjectsOnly, setShowMyProjectsOnly] = useState(true);
  const [selectedProject, setSelectedProject] = useState<any | null>(null);
  const [questionnaires, setQuestionnaires] = useState<any[]>([]);
  const [selectedQuestionnaire, setSelectedQuestionnaire] = useState<any | null>(null);
  const [questionnaireQuestions, setQuestionnaireQuestions] = useState<any[]>([]);
  const [variables, setVariables] = useState<Variable[]>([]);
  const [selectedVariable, setSelectedVariable] = useState<string | null>(null);
  const [variableData, setVariableData] = useState<Record<string, any>>({});
  const [loading, setLoading] = useState(false);
  const [archivedProjects, setArchivedProjects] = useState<any[]>([]);
  const [customNetsMode, setCustomNetsMode] = useState<Record<string, boolean>>({});
  const [variableFilter, setVariableFilter] = useState('');
  const [questionTypeFilter, setQuestionTypeFilter] = useState<string | null>(null);
  const [showQuestionTypeFilter, setShowQuestionTypeFilter] = useState(false);
  const [allQuestionnaires, setAllQuestionnaires] = useState<any[]>([]);
  const [qnrViewMode, setQnrViewMode] = useState<'variables' | 'banners' | 'data'>('variables');
  const [fullRawData, setFullRawData] = useState<{ columns: string[]; rows: any[] } | null>(null);
  const [loadingFullRawData, setLoadingFullRawData] = useState(false);
  const [newBannerGroups, setNewBannerGroups] = useState<BannerGroup[]>([]);
  const [showBannerBuilder, setShowBannerBuilder] = useState(false);
  const [editingBannerGroup, setEditingBannerGroup] = useState<BannerGroup | null>(null);
  const [selectedNewBannerGroupId, setSelectedNewBannerGroupId] = useState<string | null>(null);
  const [selectedNewBannerVariable, setSelectedNewBannerVariable] = useState<string | null>(null);
  const [parsedFile, setParsedFile] = useState<ParsedDataFile | null>(null);
  const [mappingFilter, setMappingFilter] = useState<'all' | 'mapped' | 'unmapped'>('all');
  const [singleSelectSort, setSingleSelectSort] = useState<Record<string, { column: 'code' | 'count' | 'percentage', direction: 'asc' | 'desc' }>>({});
  const [hiddenFromBanners, setHiddenFromBanners] = useState<Set<string>>(new Set());

  // Load new banner groups from localStorage when questionnaire changes
  useEffect(() => {
    if (selectedQuestionnaire?.id) {
      const key = `newBannerGroups_${selectedQuestionnaire.id}`;
      const stored = localStorage.getItem(key);
      if (stored) {
        try {
          const parsed = JSON.parse(stored);
          setNewBannerGroups(parsed || []);
        } catch (e) {
          console.error('Error loading new banner groups:', e);
        }
      } else {
        setNewBannerGroups([]);
      }
    } else {
      setNewBannerGroups([]);
    }
  }, [selectedQuestionnaire?.id]);

  // Save new banner groups to localStorage when they change
  useEffect(() => {
    if (selectedQuestionnaire?.id && newBannerGroups.length > 0) {
      const key = `newBannerGroups_${selectedQuestionnaire.id}`;
      localStorage.setItem(key, JSON.stringify(newBannerGroups));
    }
  }, [newBannerGroups, selectedQuestionnaire?.id]);

  // Initialize hiddenFromBanners: hide open ends and open end lists by default
  useEffect(() => {
    if (selectedQuestionnaire?.id) {
      const key = `hiddenFromBanners_${selectedQuestionnaire.id}`;
      const stored = localStorage.getItem(key);
      
      if (stored) {
        try {
          const parsed = JSON.parse(stored);
          setHiddenFromBanners(new Set(parsed));
        } catch (e) {
          console.error('Error loading hidden from banners:', e);
          // Initialize with defaults if loading fails
          if (variables.length > 0) {
            const defaultHidden = new Set<string>();
            variables.forEach(v => {
              const isOpenEnd = v.type?.toLowerCase().includes('open end');
              if (isOpenEnd) {
                defaultHidden.add(v.name);
              }
            });
            setHiddenFromBanners(defaultHidden);
          }
        }
      } else if (variables.length > 0) {
        // Initialize with defaults: hide open ends and open end lists
        const defaultHidden = new Set<string>();
        variables.forEach(v => {
          const isOpenEnd = v.type?.toLowerCase().includes('open end');
          if (isOpenEnd) {
            defaultHidden.add(v.name);
          }
        });
        setHiddenFromBanners(defaultHidden);
      }
    } else {
      setHiddenFromBanners(new Set());
    }
  }, [selectedQuestionnaire?.id, variables]);

  // Save hiddenFromBanners to localStorage when it changes
  useEffect(() => {
    if (selectedQuestionnaire?.id) {
      const key = `hiddenFromBanners_${selectedQuestionnaire.id}`;
      if (hiddenFromBanners.size > 0) {
        localStorage.setItem(key, JSON.stringify(Array.from(hiddenFromBanners)));
      } else {
        localStorage.removeItem(key);
      }
    }
  }, [hiddenFromBanners, selectedQuestionnaire?.id]);

  const [dataFile, setDataFile] = useState<File | null>(null);
  const [uploadingFile, setUploadingFile] = useState(false);
  const [dataUploadSuccess, setDataUploadSuccess] = useState(false);
  const [columnHeaders, setColumnHeaders] = useState<string[]>([]);
  const [showAllHeaders, setShowAllHeaders] = useState(false);
  const [uploadedFileInfo, setUploadedFileInfo] = useState<{
    fileName: string;
    uploadedAt: string;
    processed: boolean;
  } | null>(null);
  const [mappingVariables, setMappingVariables] = useState(false);
  const [mappingWithAI, setMappingWithAI] = useState(false);
  const [columnMapping, setColumnMapping] = useState<Record<string, string>>({});
  const [columnHeaderSearch, setColumnHeaderSearch] = useState('');
  const [qnrVariableSearch, setQnrVariableSearch] = useState('');
  const [showMappingModal, setShowMappingModal] = useState(false);
  const [hasAttemptedMapping, setHasAttemptedMapping] = useState(false);
  const [selectedColumnHeader, setSelectedColumnHeader] = useState<string | null>(null);
  const [selectedVariableForMapping, setSelectedVariableForMapping] = useState<string>('');
  const [uploadingData, setUploadingData] = useState(false);
  const [showQuestionModal, setShowQuestionModal] = useState(false);
  const [showColumnHeaderModal, setShowColumnHeaderModal] = useState(false);
  const [selectedQuestionForMapping, setSelectedQuestionForMapping] = useState<string | null>(null);
  const [columnHeaderModalSearch, setColumnHeaderModalSearch] = useState('');
  const [loadingQuestion, setLoadingQuestion] = useState(false);
  const [showUnmappedQuestionMappingModal, setShowUnmappedQuestionMappingModal] = useState(false);
  const [selectedUnmappedQuestion, setSelectedUnmappedQuestion] = useState<{ baseNumber: string; type: string; variables: Variable[] } | null>(null);
  const [unmappedQuestionMappingSearch, setUnmappedQuestionMappingSearch] = useState('');
  const [showUnmappedHeaderMappingModal, setShowUnmappedHeaderMappingModal] = useState(false);
  const [selectedUnmappedExpectedHeader, setSelectedUnmappedExpectedHeader] = useState<string | null>(null);
  const [unmappedHeaderMappingSearch, setUnmappedHeaderMappingSearch] = useState('');
  const [openDropdownForHeader, setOpenDropdownForHeader] = useState<string | null>(null);
  const [dropdownSearch, setDropdownSearch] = useState<string>('');
  const [questionData, setQuestionData] = useState<any>(null);
  const [editingQuestion, setEditingQuestion] = useState<any>(null);
  const [isEditingQuestion, setIsEditingQuestion] = useState(false);
  const [loadingQnrNavigation, setLoadingQnrNavigation] = useState(false);
  const [dataUploaded, setDataUploaded] = useState(false);

  // Parse file headers locally
  const parseFileHeaders = useCallback(async (file: File): Promise<string[]> => {
    return new Promise<string[]>((resolve, reject) => {
      const reader = new FileReader();
      const isCSV = file.name.toLowerCase().endsWith('.csv');
      
      reader.onload = (e) => {
        try {
          let workbook: XLSX.WorkBook;
          
          if (isCSV) {
            // For CSV files, read as text and parse
            const text = e.target?.result as string;
            workbook = XLSX.read(text, { type: 'string' });
          } else {
            // For Excel files, read as array buffer
            const data = new Uint8Array(e.target?.result as ArrayBuffer);
            workbook = XLSX.read(data, { type: 'array' });
          }
          
          // Get first sheet
          const firstSheetName = workbook.SheetNames[0];
          const worksheet = workbook.Sheets[firstSheetName];
          
          // Read only the first row (headers)
          const headerRange = XLSX.utils.decode_range(worksheet['!ref'] || 'A1');
          const headers: string[] = [];
          
          // Extract headers from first row
          for (let col = headerRange.s.c; col <= headerRange.e.c; col++) {
            const cellAddress = XLSX.utils.encode_cell({ r: 0, c: col });
            const cell = worksheet[cellAddress];
            if (cell && cell.v !== undefined && cell.v !== null) {
              headers.push(String(cell.v).trim());
            } else {
              headers.push('');
            }
          }
          
          // Filter out empty headers
          const filteredHeaders = headers.filter(h => h.length > 0);
          setColumnHeaders(filteredHeaders);
          resolve(filteredHeaders);
      } catch (error) {
          console.error('Error parsing file headers:', error);
          reject(error);
        }
      };
      
      reader.onerror = () => {
        reject(new Error('Failed to read file'));
      };
      
      // Use appropriate read method based on file type
      if (isCSV) {
        reader.readAsText(file);
      } else {
        reader.readAsArrayBuffer(file);
      }
    });
  }, []);

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

  // Convert questionnaire questions to variables for display
  const convertQuestionsToVariables = useCallback((questions: any[]) => {
    const vars: Variable[] = [];
    const processedQuestionNumbers = new Set<string>();
    
    // Process questions in order to maintain QNR order
    questions.forEach((question) => {
      const questionNumber = question.number || question.id;
      let questionType = question.type || '';
      
      // Keep the question type from QNR - don't auto-classify Open End questions
      // Open End can have responseOptions (opt-out options like "Don't know")
      // Open End List has responseOptions that define multiple text boxes
      
      const isNumericGrid = questionType.toLowerCase().includes('numeric grid');
      const isNumericList = questionType.toLowerCase().includes('numeric list');
      const isSingleSelectGrid = questionType.toLowerCase().includes('single select grid');
      const isMultiSelectGrid = questionType.toLowerCase().includes('multi-select grid');
      const isGrid = isNumericGrid || isSingleSelectGrid || isMultiSelectGrid;
      const isOpenEndList = questionType.toLowerCase().includes('open end list');
      const hasScaleTag = question.tags && Array.isArray(question.tags) && question.tags.includes('Scale');
      const hasNumberTag = question.tags && Array.isArray(question.tags) && question.tags.includes('Number');
      const hasPercentTag = question.tags && Array.isArray(question.tags) && question.tags.includes('%');
      
      // Convert statementOptions to statements object
      // StatementOptions are ALWAYS rows, so they should ALWAYS use "r" prefix
      let statements: Record<string, string> | undefined = undefined;
      let codes: Record<string, string> | undefined = undefined;
      
      if (question.statementOptions && Array.isArray(question.statementOptions)) {
        // Check if statementOptions might contain both rows and columns (mis-parsed)
        // For numeric grids, if we have statementOptions but no responseOptions, 
        // and the question type suggests it should have columns, check if there are multiple groups
        const allStatements = question.statementOptions;
        
        // If this is a numeric grid and we have statementOptions but no responseOptions,
        // check if the codes in statementOptions suggest they might be columns (c1, c2, etc.)
        const hasColumnCodes = allStatements.some((stmt: any) => {
          const code = typeof stmt === 'string' ? '' : (stmt.code || '');
          return code && (code.toLowerCase().startsWith('c') || code.match(/^c\d+$/i));
        });
        
        if (isNumericGrid && !question.responseOptions && hasColumnCodes) {
          // Likely mis-parsed: columns are in statementOptions
          // Split into rows (r codes) and columns (c codes)
          const rowStatements: any[] = [];
          const colStatements: any[] = [];
          
          allStatements.forEach((stmt: any) => {
            const code = typeof stmt === 'string' ? '' : (stmt.code || '');
            if (code && (code.toLowerCase().startsWith('c') || code.match(/^c\d+$/i))) {
              colStatements.push(stmt);
            } else {
              rowStatements.push(stmt);
            }
          });
          
          // Use row statements for statements
          if (rowStatements.length > 0) {
            statements = {};
            rowStatements.forEach((stmt: any, idx: number) => {
              const code = typeof stmt === 'string' 
                ? `r${idx + 1}`
                : (stmt.code || `r${idx + 1}`);
              const text = typeof stmt === 'string' ? stmt : stmt.text;
              if (statements) {
                statements[code] = text;
              }
            });
          }
          
          // Use column statements for codes
          if (colStatements.length > 0) {
            codes = {};
            colStatements.forEach((stmt: any, idx: number) => {
              const code = typeof stmt === 'string' 
                ? `c${idx + 1}`
                : (stmt.code || `c${idx + 1}`);
              const text = typeof stmt === 'string' ? stmt : stmt.text;
              if (codes) {
                codes[code] = text;
              }
            });
          }
        } else {
          // Normal case: statementOptions are rows
          statements = {};
          allStatements.forEach((stmt: any, idx: number) => {
            const code = typeof stmt === 'string' 
              ? `r${idx + 1}`
              : (stmt.code || `r${idx + 1}`);
            const text = typeof stmt === 'string' ? stmt : stmt.text;
            if (statements) {
              statements[code] = text;
            }
          });
        }
      }
      
      // Convert responseOptions to codes object (if not already set from statementOptions split)
      if (!codes && question.responseOptions && Array.isArray(question.responseOptions)) {
        codes = {};
        question.responseOptions.forEach((resp: any, idx: number) => {
          const code = typeof resp === 'string' ? `c${idx + 1}` : (resp.code || `c${idx + 1}`);
          const text = typeof resp === 'string' ? resp : resp.text;
          if (codes) {
            codes[code] = text;
          }
        });
      } else if (!codes && question.options && Array.isArray(question.options)) {
        // For non-grid questions, convert options to codes
        codes = {};
        question.options.forEach((opt: any, idx: number) => {
          const code = typeof opt === 'string' ? String(idx + 1) : (opt.code || String(idx + 1));
          const text = typeof opt === 'string' ? opt : opt.text;
          if (codes) {
            codes[code] = text;
          }
        });
      }
      
      // For numeric grids: only individual column variables (if has columns) or statement variables (if no columns)
      // Note: Mean summary table and main grid variable are not shown for numeric grids - only individual tables as variables
      if (isNumericGrid && statements && Object.keys(statements).length > 0) {
        // Debug logging for numeric grids removed
        
        processedQuestionNumbers.add(questionNumber);
        
        // For numeric grids with responseOptions (columns), create individual cell variables for each row/column combination
        // Format: {questionNumber}{rowCode}{columnCode} e.g., S11r1c1, S11r2c1, etc.
        // For numeric grids without responseOptions, create individual variables for each statement (row)
        if (codes && Object.keys(codes).length > 0) {
          // Create summary table variables for each column (one per column) - FIRST, before individual variables
          Object.entries(codes).forEach(([responseCode, responseText]) => {
            const summaryTableVarName = `${questionNumber}_${responseCode}_Summary`;
            vars.push({
              name: summaryTableVarName,
              description: `${question.text || questionNumber}\n${responseText} - Summary`,
              type: 'Numeric Grid',
              statements: statements, // Rows (statements) for this column summary
              tags: question.tags || [],
              isSummaryTable: true,
              isScaleSummary: false
            });
          });
          
          // Create cell variables for each combination of row (statement) and column (response option)
          Object.entries(statements).forEach(([stmtCode, stmtText]) => {
            Object.entries(codes).forEach(([responseCode, responseText]) => {
              // Format: S11r1c1 (row first, then column)
              const cellVarName = `${questionNumber}${stmtCode}${responseCode}`;
              vars.push({
                name: cellVarName,
                description: `${question.text || questionNumber}\n${stmtText} - ${responseText}`,
                type: 'Numeric',
                tags: question.tags || [],
                isSummaryTable: false,
                isScaleSummary: false
              });
            });
          });
          
          // Also create column variables for backward compatibility and summary tables
          Object.entries(codes).forEach(([responseCode, responseText]) => {
            const columnVarName = `${questionNumber}_${responseCode}`;
            vars.push({
              name: columnVarName,
              description: `${question.text || questionNumber}\n${responseText}`,
              type: 'Numeric',
              tags: question.tags || [],
              isSummaryTable: false,
              isScaleSummary: false
            });
          });
        } else {
          // No responseOptions, so create individual variables for each statement (row)
          Object.entries(statements).forEach(([stmtCode, stmtText]) => {
            const statementVarName = `${questionNumber}_${stmtCode}`;
            vars.push({
              name: statementVarName,
              description: `${question.text || questionNumber}\n${stmtText}`,
              type: 'Numeric',
              tags: question.tags || [],
              isSummaryTable: false,
              isScaleSummary: false
            });
          });
        }
      } 
      // For scale grids: scale summaries first, then main grid, then individual statement variables
      else if (isSingleSelectGrid && statements && codes && Object.keys(statements).length > 0 && Object.keys(codes).length > 0 && hasScaleTag) {
        const responseOptionsCount = codes ? Object.keys(codes).length : 0;
        
        // Scale summaries first
        if (responseOptionsCount === 7) {
          // 7-point scale: T2B, M3B, B2B
          vars.push({
            name: `${questionNumber}_T2B`,
            description: `${question.text || questionNumber} - Top 2 Box`,
            type: 'Scale Summary',
            statements: statements,
            tags: ['Scale'],
            isSummaryTable: false,
            isScaleSummary: true
          });
          vars.push({
            name: `${questionNumber}_M3B`,
            description: `${question.text || questionNumber} - Middle 3 Box`,
            type: 'Scale Summary',
                          statements: statements,
            tags: ['Scale'],
            isSummaryTable: false,
            isScaleSummary: true
          });
          vars.push({
            name: `${questionNumber}_B2B`,
            description: `${question.text || questionNumber} - Bottom 2 Box`,
            type: 'Scale Summary',
            statements: statements,
            tags: ['Scale'],
            isSummaryTable: false,
            isScaleSummary: true
          });
        } else if (responseOptionsCount === 5 || responseOptionsCount === 10) {
          // 5-point or 10-point scale: T2B, B2B
          vars.push({
            name: `${questionNumber}_T2B`,
            description: `${question.text || questionNumber} - Top 2 Box`,
            type: 'Scale Summary',
            statements: statements,
            tags: ['Scale'],
            isSummaryTable: false,
            isScaleSummary: true
          });
          vars.push({
            name: `${questionNumber}_B2B`,
            description: `${question.text || questionNumber} - Bottom 2 Box`,
            type: 'Scale Summary',
            statements: statements,
            tags: ['Scale'],
            isSummaryTable: false,
            isScaleSummary: true
          });
        }

        processedQuestionNumbers.add(questionNumber);

        // Individual statement variables for single select grids
        Object.entries(statements).forEach(([stmtCode, stmtText]) => {
          // Remove underscores to match expected header format (e.g., S13r1 instead of S13_r1)
          const statementVarName = `${questionNumber}${stmtCode}`;
          vars.push({
            name: statementVarName,
            description: `${question.text || questionNumber}\n${stmtText}`,
            type: isSingleSelectGrid ? 'Single Select' : 'Multi-Select',
            codes: codes,
            tags: question.tags || [],
            isSummaryTable: false,
            isScaleSummary: false
          });
        });
      }
      // For single select grids without scale tag: create individual statement variables
      else if (isSingleSelectGrid && statements && codes && Object.keys(statements).length > 0 && Object.keys(codes).length > 0) {
        processedQuestionNumbers.add(questionNumber);

        // Individual statement variables
        Object.entries(statements).forEach(([stmtCode, stmtText]) => {
          // Remove underscores to match expected header format (e.g., S13r1 instead of S13_r1)
          const statementVarName = `${questionNumber}${stmtCode}`;
          vars.push({
            name: statementVarName,
            description: `${question.text || questionNumber}\n${stmtText}`,
            type: 'Single Select',
            codes: codes,
            tags: question.tags || [],
            isSummaryTable: false,
            isScaleSummary: false
          });
        });
      }
      // For other grids (multi-select grids): main grid first, then individual statement variables
      else if (isGrid && statements && codes && Object.keys(statements).length > 0 && Object.keys(codes).length > 0) {
        // Only create main grid variable for multi-select grids, not single select grids
        if (isMultiSelectGrid) {
          // Main grid variable first
          vars.push({
            name: questionNumber,
            description: question.text || '',
            type: questionType,
            statements: statements,
            codes: codes,
            tags: question.tags || [],
            isSummaryTable: false,
            isScaleSummary: false
          });
        }
        processedQuestionNumbers.add(questionNumber);
        
        // Then individual statement variables
        Object.entries(statements).forEach(([stmtCode, stmtText]) => {
          // Remove underscores to match expected header format (e.g., S13r1 instead of S13_r1)
          const statementVarName = `${questionNumber}${stmtCode}`;
          vars.push({
            name: statementVarName,
            description: `${question.text || questionNumber} - ${stmtText}`,
            type: 'Multi-Select',
            codes: codes,
            tags: question.tags || [],
            isSummaryTable: false,
            isScaleSummary: false
          });
        });
      }
      // For numeric list questions: create a single summary table (like numeric grids)
      // Numeric lists have one column (c1), so create one summary table with response options as rows
      else if (isNumericList && codes && Object.keys(codes).length > 0) {
        processedQuestionNumbers.add(questionNumber);
        
        // Create a single summary table for the one column (c1)
        // Use response options (codes) as the "statements" (rows) for the summary table
        const summaryTableVarName = `${questionNumber}_c1_Summary`;
        vars.push({
          name: summaryTableVarName,
          description: question.text || questionNumber,
          type: 'Numeric List',
          statements: codes, // Response options become the rows in the summary table
          tags: question.tags || [],
          isSummaryTable: true,
          isScaleSummary: false
        });
        
        // Also create individual cell variables for each response option (for data mapping)
        // Format: {questionNumber}r{number}c1 e.g., S14Br1c1, S14Br2c1, etc.
        Object.entries(codes).forEach(([optionCode, optionText]) => {
          // Extract numeric part from option code (handles "1", "r1", "c1", etc.)
          let optionNumber = optionCode;
          if (optionCode.toLowerCase().startsWith('r')) {
            optionNumber = optionCode.substring(1);
          } else if (optionCode.toLowerCase().startsWith('c')) {
            optionNumber = optionCode.substring(1);
          }
          // Format: S14Br1c1 (row code, then column code c1)
          const cellVarName = `${questionNumber}r${optionNumber}c1`;
          vars.push({
            name: cellVarName,
            description: `${question.text || questionNumber}\n${optionText}`,
            type: 'Numeric',
            tags: question.tags || [],
            isSummaryTable: false,
            isScaleSummary: false
          });
        });
      }
      // Open End List questions - create individual variables for each response option
      else if (isOpenEndList && codes && Object.keys(codes).length > 0) {
        processedQuestionNumbers.add(questionNumber);
        
        // Create individual variables for each response option (r1, r2, etc.)
        Object.entries(codes).forEach(([optionCode, optionText]) => {
          // Extract the numeric part from the code (handles "1", "c1", "c01", etc.)
          let optionNumber = optionCode;
          // Remove 'c' prefix if present
          if (optionCode.toLowerCase().startsWith('c')) {
            optionNumber = optionCode.substring(1);
          }
          // Remove leading zeros
          optionNumber = String(parseInt(optionNumber, 10));
          
          // Use 'r' prefix for open end list response options (e.g., S12r1, S12r2)
          const responseVarName = `${questionNumber}r${optionNumber}`;
          vars.push({
            name: responseVarName,
            description: `${question.text || questionNumber} - ${optionText}`,
            type: 'Open End List',
            tags: question.tags || [],
            isSummaryTable: false,
            isScaleSummary: false
          });
        });
        
        // Create a summary variable that combines all responses from all items
        const summaryVarName = `${questionNumber}_Summary`;
        vars.push({
          name: summaryVarName,
          description: `${question.text || questionNumber} - Summary (All Items Combined)`,
          type: 'Open End List',
          tags: question.tags || [],
          isSummaryTable: true,
          isScaleSummary: false
        });
      }
      // Open End questions with opt-out options
      else if (questionType.toLowerCase().includes('open end') && !questionType.toLowerCase().includes('list')) {
        processedQuestionNumbers.add(questionNumber);

        // Create main Open End variable
        vars.push({
          name: questionNumber,
          description: question.text || '',
          type: 'Open End',
          tags: question.tags || [],
          isSummaryTable: false,
          isScaleSummary: false
        });

        // If there are opt-out options (responseOptions or options), create variables for them
        // These will appear at the bottom of the variable table
        const optOutOptions = question.responseOptions || question.options || [];
        if (optOutOptions.length > 0) {
          optOutOptions.forEach((opt: any, idx: number) => {
            const optObj = typeof opt === 'string' ? { code: String(idx + 1), text: opt } : opt;
            const optionCode = optObj.code || String(idx + 1);
            const optionText = optObj.text || optObj.code;

            // Extract numeric part from code
            let optionNumber = optionCode;
            if (optionCode.toLowerCase().startsWith('c')) {
              optionNumber = optionCode.substring(1);
            }
            optionNumber = String(parseInt(optionNumber, 10) || (idx + 1));

            // Create opt-out variable with "opt" suffix to distinguish from Open End List
            const optOutVarName = `${questionNumber}_opt${optionNumber}`;
            vars.push({
              name: optOutVarName,
              description: `${question.text || questionNumber} - ${optionText}`,
              type: 'Open End (Opt-out)',
              codes: { '0': 'Not Selected', '1': 'Selected' },
              tags: question.tags || [],
              isSummaryTable: false,
              isScaleSummary: false
            });
          });
        }
      }
      // Regular questions (non-grid)
      else {
        const isMultiSelect = questionType.toLowerCase().includes('multi-select');
        
        if (isMultiSelect && codes && Object.keys(codes).length > 0) {
          // For multiselect questions, create individual variables for each response option
          Object.entries(codes).forEach(([optionCode, optionText]) => {
            // Extract the numeric part from the code (handles "1", "c1", "c01", etc.)
            // The code number should match the response number in the variable name
            let optionNumber = optionCode;
            // Remove 'c' prefix if present
            if (optionCode.toLowerCase().startsWith('c')) {
              optionNumber = optionCode.substring(1);
            }
            // Remove leading zeros
            optionNumber = String(parseInt(optionNumber, 10));
            
            // Use 'r' prefix for multiselect response options (e.g., B8r1, B8r2)
            const responseVarName = `${questionNumber}r${optionNumber}`;
            vars.push({
              name: responseVarName,
              description: `${question.text || questionNumber} - ${optionText}`,
              type: 'Multi-Select',
              codes: { '0': 'Not Selected', '1': 'Selected' }, // Binary codes for multiselect options
              tags: question.tags || [],
              isSummaryTable: false,
              isScaleSummary: false
            });
          });
        } else if (isMultiSelect) {
          // Fallback: if no codes, create main variable
        vars.push({
                    name: questionNumber,
          description: question.text || '',
          type: questionType,
                        codes: codes,
          tags: question.tags || [],
          isSummaryTable: false,
          isScaleSummary: false
        });
        } else {
          // For non-multiselect questions, create the main variable
          vars.push({
            name: questionNumber,
            description: question.text || '',
            type: questionType,
            codes: codes,
            tags: question.tags || [],
            isSummaryTable: false,
            isScaleSummary: false
          });
        }
        processedQuestionNumbers.add(questionNumber);
      }
    });
    
    // Ensure every question has at least one variable (fallback for questions that didn't meet conditions)
    questions.forEach((question) => {
      const questionNumber = question.number || question.id;
      
      // Skip if this question already generated variables
      if (processedQuestionNumbers.has(questionNumber)) {
        return;
      }
      
      // Create a basic variable for this question so it shows up in the QNR variables tab
      let questionType = question.type || '';

      // Keep the question type from QNR - don't auto-classify
      
      // Try to get codes if available
      let codes: Record<string, string> | undefined = undefined;
      if (question.responseOptions && Array.isArray(question.responseOptions)) {
        codes = {};
        question.responseOptions.forEach((resp: any, idx: number) => {
          const code = typeof resp === 'string' ? `c${idx + 1}` : (resp.code || `c${idx + 1}`);
          const text = typeof resp === 'string' ? resp : resp.text;
          if (codes) {
            codes[code] = text;
          }
        });
      } else if (question.options && Array.isArray(question.options)) {
        codes = {};
        question.options.forEach((opt: any, idx: number) => {
          const code = typeof opt === 'string' ? String(idx + 1) : (opt.code || String(idx + 1));
          const text = typeof opt === 'string' ? opt : opt.text;
          if (codes) {
            codes[code] = text;
          }
        });
      }
      
      // Create a basic variable for this question
      vars.push({
        name: questionNumber,
        description: question.text || '',
        type: questionType,
        codes: codes,
        tags: question.tags || [],
        isSummaryTable: false,
        isScaleSummary: false
      });
      
      processedQuestionNumbers.add(questionNumber);
    });
    
    // Also add any variables from processed data that aren't already in our list
    // This catches any variables that might exist in the data but not in questions
    // (e.g., calculated variables, hidden variables, etc.)
    Object.keys(variableData).forEach((varName) => {
      // Skip if it's a statement variable (already added above)
      if (varName.includes('_')) {
        const [baseVar] = varName.split('_');
        if (processedQuestionNumbers.has(baseVar)) {
          return; // Already processed as part of a grid
        }
      }
      
      // Skip if it's a multiselect response variable (already added above as broken out variables)
      // Check for pattern like B8r1, B8r2, etc.
      const multiselectMatch = varName.match(/^(.+?)r\d+$/i);
      if (multiselectMatch) {
        const baseQuestion = multiselectMatch[1];
        if (processedQuestionNumbers.has(baseQuestion)) {
          return; // Already processed as multiselect response variables
        }
      }
      
      // Skip if the variable name matches a processed question number (for multiselect questions)
      // This prevents adding B8 if we've already created B8r1, B8r2, etc.
      if (processedQuestionNumbers.has(varName)) {
        // Check if we've created response variables for this question
        const hasResponseVars = vars.some(v => {
          const responseMatch = v.name.match(/^(.+?)r\d+$/i);
          return responseMatch && responseMatch[1] === varName;
        });
        if (hasResponseVars) {
          return; // Skip the main variable if we have response variables
        }
      }
      
      // Skip if we already have this variable
      if (vars.some(v => v.name === varName)) {
        return;
      }
      
      // Add as a basic variable
      const varData = variableData[varName];
      vars.push({
        name: varName,
        description: varName,
        type: varData?.numeric ? 'Numeric' : 'Categorical',
        tags: [],
        isSummaryTable: false,
        isScaleSummary: false
      });
    });
    
    // Variables are already in the correct order (matching QNR question order)
    // No need to sort - they're created in the order we want them displayed
    setVariables(vars);
  }, [variableData]);

  // Extract base question number from variable name
  const getBaseQuestionNumber = useCallback((variableName: string): string => {
    let base = variableName;
    
    // Remove summary suffixes first
    base = base.replace(/_Summary Tables$/, '');
    base = base.replace(/_Summary$/, '');
    // Remove other suffixes like _T2B, _B2B, _M3B
    base = base.replace(/_T2B$/, '');
    base = base.replace(/_B2B$/, '');
    base = base.replace(/_M3B$/, '');
    
    // Remove numeric list response codes with underscore (e.g., _1, _2) - must be just a number
    // This pattern matches underscore followed by digits at the end, but not _r1 or _c1
    base = base.replace(/_\d+$/, '');
    
    // Remove response codes with underscore (e.g., _r1, _r2) - this handles other numeric lists
    base = base.replace(/_[rR]\d+$/i, '');
    
    // Remove column codes with underscore (e.g., _c1, _c2)
    base = base.replace(/_[cC]\d+$/, '');
    
    // Remove response codes without underscore (r1, r2, etc.)
    base = base.replace(/[rR]\d+/gi, '');
    
    // Remove column codes without underscore (c1, c2, etc.)
    base = base.replace(/[cC]\d+/gi, '');
    
    // Remove any trailing underscores
    base = base.replace(/_+$/, '');
    
    return base;
  }, []);

  // Helper function to extract variable data from full raw data
  // Uses columnMapping to find the matched column header, then extracts values from fullRawData
  const getVariableDataFromRawData = useCallback((variableName: string): any => {
    if (!fullRawData || !fullRawData.rows || fullRawData.rows.length === 0 || !columnMapping) {
      return undefined;
    }

    // Convert numeric list variable names to expected header format
    // Numeric list variables are named like S14B_1, S14B_2, etc., but expected headers are QS14Br1c1, QS14Br2c1, etc.
    // BUT: if the variableName is already in expected header format (e.g., QS14Br1c1), don't convert it again
    let lookupName = variableName;
    
    // Only convert if it's NOT already in expected header format (doesn't have r and c codes)
    const isAlreadyExpectedFormat = /^Q?[A-Z0-9]+r\d+c\d+$/i.test(variableName);
    
    if (!isAlreadyExpectedFormat) {
      // Check if this is a numeric list variable (pattern: {baseNumber}_{number})
      const numericListPattern = /^([A-Z0-9]+)_(\d+)$/i;
      const numericListMatch = variableName.match(numericListPattern);
      if (numericListMatch) {
        const baseNumber = numericListMatch[1];
        const optionNumber = numericListMatch[2];
        // Convert S14B_1 -> QS14Br1c1
        lookupName = `Q${baseNumber}r${optionNumber}c1`;
      } else {
        // Check for _r pattern (e.g., S5_r1)
        const underscoreRPattern = /^([A-Z0-9]+)_r(\d+)$/i;
        const underscoreRMatch = variableName.match(underscoreRPattern);
        if (underscoreRMatch) {
          const baseNumber = underscoreRMatch[1];
          const rowNumber = underscoreRMatch[2];
          // Check if this is a numeric list question
          const question = questionnaireQuestions.find(q => {
            const qNum = q.number || q.id;
            return qNum === baseNumber || qNum === baseNumber.replace(/^Q/, '');
          });
          const isNumericList = question?.type?.toLowerCase().includes('numeric list');
          if (isNumericList) {
            // Convert S5_r1 -> QS5r1c1
            lookupName = `Q${baseNumber}r${rowNumber}c1`;
          }
        }
      }
    }

    // Try to find the expected header in columnMapping (try variations)
    let expectedHeader: string | undefined = undefined;
    
    // Try exact match with converted name first
    if (columnMapping[lookupName]) {
      expectedHeader = lookupName;
    }
    
    // Try exact match with original name
    if (!expectedHeader && columnMapping[variableName]) {
      expectedHeader = variableName;
    }
    
    // Try with Q prefix
    if (!expectedHeader) {
      const withQ = lookupName.startsWith('Q') ? lookupName : `Q${lookupName}`;
      if (columnMapping[withQ]) {
        expectedHeader = withQ;
      }
    }
    
    // Try without Q prefix
    if (!expectedHeader && lookupName.startsWith('Q')) {
      const withoutQ = lookupName.substring(1);
      if (columnMapping[withoutQ]) {
        expectedHeader = withoutQ;
      }
    }
    
    // Try case-insensitive lookup with converted name
    if (!expectedHeader) {
      const mappingKeys = Object.keys(columnMapping);
      const matchingKey = mappingKeys.find(key => 
        key.toLowerCase() === lookupName.toLowerCase() ||
        key.toLowerCase() === (lookupName.startsWith('Q') ? lookupName : `Q${lookupName}`).toLowerCase() ||
        (lookupName.startsWith('Q') && key.toLowerCase() === lookupName.substring(1).toLowerCase())
      );
      if (matchingKey) {
        expectedHeader = matchingKey;
      }
    }
    
    // Try case-insensitive lookup with original name as fallback
    if (!expectedHeader) {
      const mappingKeys = Object.keys(columnMapping);
      const matchingKey = mappingKeys.find(key => 
        key.toLowerCase() === variableName.toLowerCase() ||
        key.toLowerCase() === (variableName.startsWith('Q') ? variableName : `Q${variableName}`).toLowerCase() ||
        (variableName.startsWith('Q') && key.toLowerCase() === variableName.substring(1).toLowerCase())
      );
      if (matchingKey) {
        expectedHeader = matchingKey;
      }
    }
    
    if (!expectedHeader) {
      return undefined;
    }
    
    // Get the matched column header (the actual Excel column name)
    const matchedColumnHeader = columnMapping[expectedHeader];
    if (!matchedColumnHeader) {
      return undefined;
    }
    
    // Extract values from fullRawData rows
    const values: any[] = [];
    fullRawData.rows.forEach((row: any) => {
      if (row.hasOwnProperty(matchedColumnHeader)) {
        const value = row[matchedColumnHeader];
        // Normalize empty values to null
        if (value === null || value === undefined || value === '') {
          values.push(null);
        } else if (typeof value === 'string' && value.trim() === '') {
          values.push(null);
        } else {
          values.push(value);
        }
      } else {
        values.push(null);
      }
    });
    
    // Calculate statistics
    const nonNullValues = values.filter(v => v !== null && v !== undefined);
    const numericValues = nonNullValues.map(v => {
      const num = parseFloat(String(v));
      return isNaN(num) ? null : num;
    }).filter(v => v !== null) as number[];
    
    const allNumeric = numericValues.length === nonNullValues.length && numericValues.length > 0;
    
    // Calculate frequencies for categorical data
    const frequencies: Record<string, number> = {};
    if (!allNumeric) {
      nonNullValues.forEach(val => {
        const valStr = String(val);
        frequencies[valStr] = (frequencies[valStr] || 0) + 1;
      });
    }
    
    // Calculate numeric statistics if applicable
    let mean: number | undefined = undefined;
    let median: number | undefined = undefined;
    let sum: number | undefined = undefined;
    
    if (allNumeric && numericValues.length > 0) {
      const sorted = [...numericValues].sort((a, b) => a - b);
      sum = numericValues.reduce((a, b) => a + b, 0);
      mean = sum / numericValues.length;
      median = sorted.length % 2 === 0
        ? (sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2
        : sorted[Math.floor(sorted.length / 2)];
    }
    
    return {
      values: values,
      count: values.length,
      numeric: allNumeric,
      frequencies: Object.keys(frequencies).length > 0 ? frequencies : undefined,
      mean: mean,
      median: median,
      sum: sum
    };
  }, [fullRawData, columnMapping, questionnaireQuestions]);

  // Helper function to get variable data using expected header format
  // Now uses fullRawData instead of variableData for better accuracy
  const getVariableDataByExpectedHeader = useCallback((variableName: string): any => {
    // Convert numeric list variable names to expected header format
    // Numeric list variables are named like S5_1, S5_2, etc., but expected headers are QS5r1c1, QS5r2c1, etc.
    let expectedHeaderName = variableName;
    
    // Check if this is a numeric list variable (pattern: {baseNumber}_{number})
    const numericListPattern = /^([A-Z0-9]+)_(\d+)$/i;
    const numericListMatch = variableName.match(numericListPattern);
    if (numericListMatch) {
      const baseNumber = numericListMatch[1];
      const optionNumber = numericListMatch[2];
      // Convert S14B_1 -> QS14Br1c1
      expectedHeaderName = `Q${baseNumber}r${optionNumber}c1`;
    } else {
      // Check for _r pattern (e.g., S5_r1)
      const underscoreRPattern = /^([A-Z0-9]+)_r(\d+)$/i;
      const underscoreRMatch = variableName.match(underscoreRPattern);
      if (underscoreRMatch) {
        const baseNumber = underscoreRMatch[1];
        const rowNumber = underscoreRMatch[2];
        // Check if this is a numeric list question
        const question = questionnaireQuestions.find(q => {
          const qNum = q.number || q.id;
          return qNum === baseNumber || qNum === baseNumber.replace(/^Q/, '');
        });
        const isNumericList = question?.type?.toLowerCase().includes('numeric list');
        if (isNumericList) {
          // Convert S5_r1 -> QS5r1c1
          expectedHeaderName = `Q${baseNumber}r${rowNumber}c1`;
        }
      }
    }

    // First try to get data from full raw data (more accurate) using the expected header format
    const rawData = getVariableDataFromRawData(expectedHeaderName);
    if (rawData) {
      return rawData;
    }

    // Also try with the original variable name (but only if conversion happened)
    if (expectedHeaderName !== variableName) {
      const rawDataOriginal = getVariableDataFromRawData(variableName);
      if (rawDataOriginal) {
        return rawDataOriginal;
      }
    }
    
    // Fallback to variableData if raw data not available (for backward compatibility)
    // Try different variations:
    
    // 1. Try expected header name (for numeric lists)
    if (expectedHeaderName !== variableName && variableData[expectedHeaderName]) {
      return variableData[expectedHeaderName];
    }
    
    // 2. Try variable name as-is
    if (variableData[variableName]) {
      return variableData[variableName];
    }
    
    // 3. Try with Q prefix (e.g., "S14r1" -> "QS14r1")
    const withQ = variableName.startsWith('Q') ? variableName : `Q${variableName}`;
    if (variableData[withQ]) {
      return variableData[withQ];
    }
    
    // 4. Try without Q prefix (e.g., "QS14r1" -> "S14r1")
    if (variableName.startsWith('Q')) {
      const withoutQ = variableName.substring(1);
      if (variableData[withoutQ]) {
        return variableData[withoutQ];
      }
    }
    
    // 5. Try case-insensitive lookup
    const variableDataKeys = Object.keys(variableData);
    const matchingKey = variableDataKeys.find(key => 
      key.toLowerCase() === variableName.toLowerCase() ||
      key.toLowerCase() === withQ.toLowerCase() ||
      key.toLowerCase() === expectedHeaderName.toLowerCase() ||
      (variableName.startsWith('Q') && key.toLowerCase() === variableName.substring(1).toLowerCase())
    );
    if (matchingKey) {
      return variableData[matchingKey];
    }
    
    // Return undefined if nothing found
    return undefined;
  }, [getVariableDataFromRawData, variableData, questionnaireQuestions]);

  // Generate expected column headers for a base question (all variables with that base)
  const getExpectedColumnHeadersForBase = useCallback((baseQuestionNumber: string, allVariables: Variable[]): string[] => {
    // Check the original question data to see if it has statements
    const question = questionnaireQuestions.find(q => (q.number || q.id) === baseQuestionNumber);
    const questionType = question?.type || '';
    const isNumericList = questionType.toLowerCase().includes('numeric list');
    const isNumericGrid = questionType.toLowerCase().includes('numeric grid');
    const isNumericOnly = questionType.toLowerCase() === 'numeric' || (questionType.toLowerCase().includes('numeric') && !isNumericList && !isNumericGrid);
    const isOpenEndList = questionType.toLowerCase().includes('open end list');
    const isOpenEnd = questionType.toLowerCase().includes('open end') && !isOpenEndList;
    const isSingleSelect = questionType.toLowerCase().includes('single select') && !questionType.toLowerCase().includes('grid');
    const isSingleSelectGrid = questionType.toLowerCase().includes('single select grid');
    const isMultiSelectGrid = questionType.toLowerCase().includes('multi-select grid');
    const isGrid = isNumericGrid || isSingleSelectGrid || isMultiSelectGrid;
    
    // For single select questions (not grids) and open end questions (not lists), return just Q + question number
    if ((isSingleSelect || isOpenEnd) && !isGrid) {
      return [`Q${baseQuestionNumber}`];
    }
    
    // Find all variables that belong to this base question
    const relatedVariables = allVariables.filter(v => {
      const base = getBaseQuestionNumber(v.name);
      return base === baseQuestionNumber;
    });
    
    let questionHasStatements = false;
    let statementCodes: string[] = [];
    
    // For "Numeric" questions (not "Numeric List" or "Numeric Grid"), assume single statement (r1)
    if (isNumericOnly) {
      questionHasStatements = true;
      statementCodes = ['r1'];
    } else if (question && question.statementOptions && Array.isArray(question.statementOptions) && question.statementOptions.length > 0) {
      questionHasStatements = true;
      // Extract statement codes
      question.statementOptions.forEach((stmt: any, idx: number) => {
        const code = typeof stmt === 'string' ? `r${idx + 1}` : (stmt.code || `r${idx + 1}`);
        statementCodes.push(code);
      });
    }

    // Check if there are statement variables (variables with row codes like r1, r2, etc.)
    // Statement variables can be in format: S5_r1 (with underscore) or S5r1 (without underscore)
    const statementVariables = relatedVariables.filter(v => {
      // Check if variable name has a row code pattern (r followed by digits)
      const hasRowCode = /r\d+/i.test(v.name);
      // Make sure it's not a numeric grid cell (which would also have column codes)
      const hasColCode = /c\d+/i.test(v.name);
      // Check if it's a statement variable (has r code but not c code, and is not the base)
      return hasRowCode && !hasColCode && v.name !== baseQuestionNumber;
    });
    const hasStatementVariables = statementVariables.length > 0 || questionHasStatements;

    // Generate expected headers for each related variable
    const expectedHeaders: string[] = [];
    
    // For numeric grids, generate expected headers from question data (statements × responseOptions)
    if (isNumericGrid && question) {
      // Get statement codes (rows) - same logic as convertQuestionsToVariables
      const rowCodes: string[] = [];
      let statements: Record<string, string> | undefined = undefined;
      
      if (question.statementOptions && Array.isArray(question.statementOptions)) {
        const allStatements = question.statementOptions;
        
        // Check if columns are mixed in with statementOptions (mis-parsed)
        const hasColumnCodes = allStatements.some((stmt: any) => {
          const code = typeof stmt === 'string' ? '' : (stmt.code || '');
          return code && (code.toLowerCase().startsWith('c') || code.match(/^c\d+$/i));
        });
        
        if (!question.responseOptions && hasColumnCodes) {
          // Columns are in statementOptions - split them
          const rowStatements: any[] = [];
          allStatements.forEach((stmt: any) => {
            const code = typeof stmt === 'string' ? '' : (stmt.code || '');
            if (!code || !(code.toLowerCase().startsWith('c') || code.match(/^c\d+$/i))) {
              rowStatements.push(stmt);
            }
          });
          
          rowStatements.forEach((stmt: any, idx: number) => {
            const code = typeof stmt === 'string' ? `r${idx + 1}` : (stmt.code || `r${idx + 1}`);
            rowCodes.push(code);
          });
        } else {
          // Normal case: statementOptions are rows
          allStatements.forEach((stmt: any, idx: number) => {
            const code = typeof stmt === 'string' ? `r${idx + 1}` : (stmt.code || `r${idx + 1}`);
            rowCodes.push(code);
          });
        }
      }
      
      // Get response option codes (columns) - same logic as convertQuestionsToVariables
      const colCodes: string[] = [];
      
      if (question.responseOptions && Array.isArray(question.responseOptions)) {
        question.responseOptions.forEach((resp: any, idx: number) => {
          const code = typeof resp === 'string' ? `c${idx + 1}` : (resp.code || `c${idx + 1}`);
          colCodes.push(code);
        });
      } else if (question.statementOptions && Array.isArray(question.statementOptions)) {
        // Check if columns are in statementOptions (mis-parsed case)
        const allStatements = question.statementOptions;
        const hasColumnCodes = allStatements.some((stmt: any) => {
          const code = typeof stmt === 'string' ? '' : (stmt.code || '');
          return code && (code.toLowerCase().startsWith('c') || code.match(/^c\d+$/i));
        });
        
        if (hasColumnCodes) {
          allStatements.forEach((stmt: any) => {
            const code = typeof stmt === 'string' ? '' : (stmt.code || '');
            if (code && (code.toLowerCase().startsWith('c') || code.match(/^c\d+$/i))) {
              colCodes.push(code);
            }
          });
        }
      }
      
      // Generate all combinations: each row × each column
      // Group by column first (c1, c2, c3...), then by row within each column
      if (rowCodes.length > 0) {
        if (colCodes.length > 0) {
          // Sort columns numerically
          const sortedColCodes = [...colCodes].sort((a, b) => {
            const aNum = parseInt(a.match(/c?(\d+)/i)?.[1] || '0', 10);
            const bNum = parseInt(b.match(/c?(\d+)/i)?.[1] || '0', 10);
            return aNum - bNum;
          });
          
          // Generate headers grouped by column: all c1 first, then all c2, etc.
          sortedColCodes.forEach(colCode => {
            const colNumberMatch = colCode.match(/c?(\d+)/i);
            const colNum = colNumberMatch ? colNumberMatch[1] : colCode.replace(/[^0-9]/g, '');
            
            // Sort rows numerically within each column
            const sortedRowCodes = [...rowCodes].sort((a, b) => {
              const aNum = parseInt(a.match(/r?(\d+)/i)?.[1] || '0', 10);
              const bNum = parseInt(b.match(/r?(\d+)/i)?.[1] || '0', 10);
              return aNum - bNum;
            });
            
            sortedRowCodes.forEach(rowCode => {
              const rowNumberMatch = rowCode.match(/r?(\d+)/i);
              const rowNum = rowNumberMatch ? rowNumberMatch[1] : rowCode.replace(/[^0-9]/g, '');
              expectedHeaders.push(`Q${baseQuestionNumber}r${rowNum}c${colNum}`);
            });
          });
        } else {
          // If no columns found, still add row with c1 (fallback)
          rowCodes.forEach(rowCode => {
            const rowNumberMatch = rowCode.match(/r?(\d+)/i);
            const rowNum = rowNumberMatch ? rowNumberMatch[1] : rowCode.replace(/[^0-9]/g, '');
            expectedHeaders.push(`Q${baseQuestionNumber}r${rowNum}c1`);
          });
        }
      }
      
      if (expectedHeaders.length > 0) {
        // Headers are already sorted by column then row, no need to sort again
        return expectedHeaders;
      }
    }
    
    // For numeric list questions, generate expected headers from response options (r1c1, r2c1, etc.)
    if (isNumericList && question) {
      // Get response options from question or from related variables
      const responseOptions = question.responseOptions || question.options || [];
      let codesToUse: Record<string, string> | undefined = undefined;
      
      // Try to get codes from the question's responseOptions
      if (responseOptions && Array.isArray(responseOptions) && responseOptions.length > 0) {
        codesToUse = {};
        responseOptions.forEach((resp: any, idx: number) => {
          const code = typeof resp === 'string' ? String(idx + 1) : (resp.code || String(idx + 1));
          const text = typeof resp === 'string' ? resp : (resp.text || resp.label || `Option ${idx + 1}`);
          codesToUse![code] = text;
        });
      } else if (responseOptions && typeof responseOptions === 'object' && !Array.isArray(responseOptions)) {
        codesToUse = responseOptions as Record<string, string>;
      }
      
      // If we have codes, generate expected headers
      if (codesToUse && Object.keys(codesToUse).length > 0) {
        Object.keys(codesToUse).forEach((code) => {
          // Extract numeric part from code (handles "1", "r1", "c1", etc.)
          let rowNum = code;
          if (code.toLowerCase().startsWith('r')) {
            rowNum = code.substring(1);
          } else if (code.toLowerCase().startsWith('c')) {
            rowNum = code.substring(1);
          }
          // Format: QS14Br1c1, QS14Br2c1, etc.
          expectedHeaders.push(`Q${baseQuestionNumber}r${rowNum}c1`);
        });
        return expectedHeaders.sort();
      }
    }
    
    // For Open End List questions, generate expected headers from response options (r1, r2, etc.)
    if (isOpenEndList && question) {
      const responseOptions = question.responseOptions || question.options || [];
      if (responseOptions.length > 0) {
        responseOptions.forEach((resp: any, idx: number) => {
          const rowNum = idx + 1;
          // Format: QS12r1, QS12r2, etc. (no c1 suffix)
          expectedHeaders.push(`Q${baseQuestionNumber}r${rowNum}`);
        });
        return expectedHeaders.sort();
      }
    }
    
    // If question has statements but no statement variables exist, generate expected headers from question data
    if (questionHasStatements && statementVariables.length === 0) {
      // Generate expected headers based on statement codes from the question
      statementCodes.forEach(code => {
        // Extract the number from the code (e.g., "r1" -> "1", "r2" -> "2")
        const numberMatch = code.match(/r(\d+)/i);
        if (numberMatch) {
          // For numeric lists, add c1 at the end (e.g., QS5r1c1)
          // For other questions, just use QS5r1
          if (isNumericList) {
            expectedHeaders.push(`Q${baseQuestionNumber}r${numberMatch[1]}c1`);
          } else {
            expectedHeaders.push(`Q${baseQuestionNumber}r${numberMatch[1]}`);
          }
        }
      });
      
      return expectedHeaders.sort();
    }
    
    relatedVariables.forEach(variable => {
      // Filter out summary table variables and scale summaries
      if (variable.name.endsWith('_Summary Tables') || 
          variable.name.endsWith('_T2B') || 
          variable.name.endsWith('_B2B') || 
          variable.name.endsWith('_M3B') ||
          (variable as any).isSummaryTable) {
        return;
      }
      
      // Filter out column summary variables for numeric grids (e.g., S4_c1)
      // These are calculated summaries, not raw data columns
      const columnSummaryPattern = new RegExp(`^${baseQuestionNumber}_c\\d+$`, 'i');
      if (columnSummaryPattern.test(variable.name)) {
        return;
      }
      
      // Filter out variables ending with _Summary (e.g., S4_c1_Summary)
      if (variable.name.endsWith('_Summary')) {
        return;
      }
      
      // For numeric questions with statements, filter out the base variable
      // Only include statement variables (e.g., S5r1, S5r2) not the base (S5)
      // BUT for numeric lists and numeric grids, we want to include their specific variables
      if (hasStatementVariables && !isNumericList && !isNumericGrid) {
        // If this is the exact base question number (no row/column codes), skip it
        if (variable.name === baseQuestionNumber) {
          return;
        }
        // Also skip if it matches the base with underscore pattern but no r code (e.g., S5_1, but not S5_r1)
        const baseWithUnderscorePattern = new RegExp(`^${baseQuestionNumber}_\\d+$`, 'i');
        if (baseWithUnderscorePattern.test(variable.name) && !/r\d+/i.test(variable.name)) {
          return;
        }
      }
      
      // For numeric lists, filter out the base variable if it exists
      if (isNumericList && variable.name === baseQuestionNumber) {
        return;
      }
      
      // For numeric grids, filter out the base variable if it exists
      if (isNumericGrid && variable.name === baseQuestionNumber) {
        return;
      }
      
      // For open end lists, filter out the base variable if it exists
      if (isOpenEndList && variable.name === baseQuestionNumber) {
        return;
      }
      
      // For numeric lists, handle both patterns:
      // 1. {baseQuestionNumber}_r{number} (e.g., S5_r1)
      // 2. {baseQuestionNumber}_{number} (e.g., S14B_1)
      if (isNumericList) {
        // Check for _r1, _r2 pattern
        const statementWithUnderscorePattern = new RegExp(`^${baseQuestionNumber}_r(\\d+)$`, 'i');
        const rMatch = variable.name.match(statementWithUnderscorePattern);
        if (rMatch) {
          // Convert S5_r1 -> QS5r1c1
          expectedHeaders.push(`Q${baseQuestionNumber}r${rMatch[1]}c1`);
        } else {
          // Check for _1, _2 pattern (just a number after underscore)
          const numericCodePattern = new RegExp(`^${baseQuestionNumber}_(\\d+)$`, 'i');
          const numericMatch = variable.name.match(numericCodePattern);
          if (numericMatch) {
            // Convert S14B_1 -> QS14Br1c1
            expectedHeaders.push(`Q${baseQuestionNumber}r${numericMatch[1]}c1`);
          } else {
            // Fallback: add "Q" prefix to variable name as-is
            expectedHeaders.push(`Q${variable.name}`);
          }
        }
      } else if (isNumericGrid) {
        // For numeric grids, variables are named like S14r1c1, S14r1c2, S14r2c1, etc.
        // We want to preserve both row and column codes: QS14r1c1, QS14r1c2, QS14r2c1, etc.
        // Check if variable matches pattern: {baseQuestionNumber}r{rowNumber}c{colNumber}
        const gridCellPattern = new RegExp(`^${baseQuestionNumber}r(\\d+)c(\\d+)$`, 'i');
        const gridMatch = variable.name.match(gridCellPattern);
        if (gridMatch) {
          // Convert S14r1c1 -> QS14r1c1
          expectedHeaders.push(`Q${baseQuestionNumber}r${gridMatch[1]}c${gridMatch[2]}`);
        } else {
          // Check for underscore pattern: {baseQuestionNumber}_r{rowNumber}_c{colNumber}
          const gridCellUnderscorePattern = new RegExp(`^${baseQuestionNumber}_r(\\d+)_c(\\d+)$`, 'i');
          const gridUnderscoreMatch = variable.name.match(gridCellUnderscorePattern);
          if (gridUnderscoreMatch) {
            // Convert S14_r1_c1 -> QS14r1c1
            expectedHeaders.push(`Q${baseQuestionNumber}r${gridUnderscoreMatch[1]}c${gridUnderscoreMatch[2]}`);
          } else {
            // Fallback: add "Q" prefix to variable name as-is
            expectedHeaders.push(`Q${variable.name}`);
          }
        }
      } else if (isOpenEndList) {
        // For open end lists, variables should be named like S12r1, S12r2, etc.
        // Format: QS12r1, QS12r2, etc. (no c1 suffix)
        const openEndListPattern = new RegExp(`^${baseQuestionNumber}r(\\d+)$`, 'i');
        const openEndMatch = variable.name.match(openEndListPattern);
        if (openEndMatch) {
          // Convert S12r1 -> QS12r1
          expectedHeaders.push(`Q${baseQuestionNumber}r${openEndMatch[1]}`);
        } else {
          // Check for underscore pattern: S12_r1
          const openEndUnderscorePattern = new RegExp(`^${baseQuestionNumber}_r(\\d+)$`, 'i');
          const openEndUnderscoreMatch = variable.name.match(openEndUnderscorePattern);
          if (openEndUnderscoreMatch) {
            // Convert S12_r1 -> QS12r1
            expectedHeaders.push(`Q${baseQuestionNumber}r${openEndUnderscoreMatch[1]}`);
          } else {
            // Fallback: add "Q" prefix to variable name as-is
            expectedHeaders.push(`Q${variable.name}`);
          }
        }
      } else {
        // For non-numeric lists and non-numeric grids, handle statement variables
        // Check for pattern without underscore first (e.g., C1r1)
        const statementPattern = new RegExp(`^${baseQuestionNumber}r(\\d+)$`, 'i');
        const match = variable.name.match(statementPattern);
        if (match) {
          // Convert C1r1 -> QC1r1
          expectedHeaders.push(`Q${baseQuestionNumber}r${match[1]}`);
        } else {
          // Check for underscore pattern (e.g., C1_r1)
          const statementWithUnderscorePattern = new RegExp(`^${baseQuestionNumber}_r(\\d+)$`, 'i');
          const underscoreMatch = variable.name.match(statementWithUnderscorePattern);
          if (underscoreMatch) {
            // Convert C1_r1 -> QC1r1
            expectedHeaders.push(`Q${baseQuestionNumber}r${underscoreMatch[1]}`);
          } else {
            // Add "Q" prefix to variable name as-is
            expectedHeaders.push(`Q${variable.name}`);
          }
        }
      }
    });

    // Normalize all expected headers to remove underscores and ensure consistent format
    const normalizedHeaders = expectedHeaders.map(header => {
      // Remove underscores from expected headers (e.g., QC1_r1 -> QC1r1)
      return header.replace(/_/g, '');
    });

    // Sort to ensure consistent ordering
    return normalizedHeaders.sort();
  }, [getBaseQuestionNumber, questionnaireQuestions]);

  // Load questionnaire details function
  const loadQuestionnaireDetails = useCallback(async () => {
    if (!selectedQuestionnaire) {
      return;
    }
    
    // First check if the questionnaire already has questions
    if (selectedQuestionnaire.questions && selectedQuestionnaire.questions.length > 0) {
      setQuestionnaireQuestions(selectedQuestionnaire.questions);
      return;
    }
    
    // If not, try to find it in allQuestionnaires
    if (allQuestionnaires.length > 0) {
      const fullQnr = allQuestionnaires.find(q => q.id === selectedQuestionnaire.id);
      if (fullQnr && fullQnr.questions && fullQnr.questions.length > 0) {
        setQuestionnaireQuestions(fullQnr.questions);
      return;
      }
    }
    
    // If still not found, try to load from the project's questionnaires
    if (selectedProject) {
      setLoading(true);
      try {
        const response = await fetch(`${API_BASE_URL}/api/questionnaire/${selectedProject.id}`, {
          headers: { 'Authorization': `Bearer ${localStorage.getItem('cognitive_dash_token')}` }
        });
      if (response.ok) {
          const projectQuestionnaires = await response.json();
          const fullQnr = projectQuestionnaires.find((q: any) => q.id === selectedQuestionnaire.id);
          if (fullQnr && fullQnr.questions && fullQnr.questions.length > 0) {
            setQuestionnaireQuestions(fullQnr.questions);
          }
        }
      } catch (error) {
        console.error('Error loading questionnaire details:', error);
      } finally {
        setLoading(false);
      }
    }
  }, [selectedQuestionnaire, selectedProject, allQuestionnaires]);

  // Load processed data function
  const loadProcessedData = useCallback(async () => {
    if (!selectedQuestionnaire) {
      // Only clear if we're switching away from a questionnaire
      return;
    }
    try {
      const response = await fetch(`${API_BASE_URL}/api/questionnaire/processed-data/${selectedQuestionnaire.id}`, {
          headers: { 'Authorization': `Bearer ${localStorage.getItem('cognitive_dash_token')}` }
        });
      if (response.ok) {
        const data = await response.json();
        // Always set the data, even if it's an empty object
        if (data && typeof data === 'object') {
          setVariableData(data);
        } else {
          setVariableData({});
        }
      }
    } catch (error) {
      // It's okay if processed data doesn't exist yet
      console.error('Error loading processed data:', error);
      // Don't clear on error - might be a temporary network issue
    }
  }, [selectedQuestionnaire]);

  // Clear full raw data when questionnaire changes
  useEffect(() => {
    setFullRawData(null);
  }, [selectedQuestionnaire?.id]);

  // Load full raw data function
  const loadFullRawData = useCallback(async () => {
    if (!selectedQuestionnaire) {
      return;
    }
    setLoadingFullRawData(true);
    try {
      const response = await fetch(`${API_BASE_URL}/api/questionnaire/raw-data/${selectedQuestionnaire.id}`, {
        headers: { 'Authorization': `Bearer ${localStorage.getItem('cognitive_dash_token')}` }
      });
      if (response.ok) {
        const data = await response.json();
        setFullRawData(data);
      } else {
        console.error('Failed to load full raw data');
        setFullRawData(null);
      }
    } catch (error) {
      console.error('Error loading full raw data:', error);
      setFullRawData(null);
    } finally {
      setLoadingFullRawData(false);
    }
  }, [selectedQuestionnaire]);

  // Load full raw data when viewing raw data tab OR variables tab with uploaded data
  useEffect(() => {
    if (!selectedQuestionnaire || loadingFullRawData) {
      return;
    }

    // Don't reload if we already have data for this questionnaire
    if (fullRawData) {
      return;
    }

    // Load when on raw data tab
    if (qnrViewMode === 'rawdata') {
      loadFullRawData();
      return;
    }

    // Also load when on variables tab and there's uploaded data
    if (qnrViewMode === 'variables' && uploadedFileInfo && dataUploaded) {
      loadFullRawData();
    }
  }, [qnrViewMode, fullRawData, loadingFullRawData, selectedQuestionnaire, uploadedFileInfo, dataUploaded, loadFullRawData]);

  // Track loading state to prevent duplicate calls
  const [loadingFileInfo, setLoadingFileInfo] = useState(false);
  const loadFileInfoAbortControllerRef = React.useRef<AbortController | null>(null);
  const loadFileInfoTimeoutRef = React.useRef<NodeJS.Timeout | null>(null);
  const isLoadingFileInfoRef = React.useRef<boolean>(false);
  const lastLoadedFileInfoRef = React.useRef<{ qnrId: string | null; viewMode: string }>({ qnrId: null, viewMode: '' });


  // Load file info function
  const loadFileInfo = useCallback(async () => {
    if (!selectedQuestionnaire) {
      setUploadedFileInfo(null);
      setColumnMapping({});
      setColumnHeaders([]);
      setDataUploaded(false);
      setHasAttemptedMapping(false);
      isLoadingFileInfoRef.current = false;
      lastLoadedFileInfoRef.current = { qnrId: null, viewMode: '' };
      return;
    }

    // Cancel any pending request
    if (loadFileInfoAbortControllerRef.current) {
      loadFileInfoAbortControllerRef.current.abort();
    }

    // Prevent duplicate calls using ref to avoid stale closure
    if (isLoadingFileInfoRef.current) {
      return;
    }

    isLoadingFileInfoRef.current = true;
    setLoadingFileInfo(true);
    const abortController = new AbortController();
    loadFileInfoAbortControllerRef.current = abortController;

    try {
      const response = await fetch(`${API_BASE_URL}/api/questionnaire/data-file-info/${selectedQuestionnaire.id}`, {
        headers: { 'Authorization': `Bearer ${localStorage.getItem('cognitive_dash_token')}` },
        signal: abortController.signal
      });
      
      if (abortController.signal.aborted) {
        return;
      }

      if (response.ok) {
        const data = await response.json();
        // Check if column mapping exists to determine if it's been mapped
        const isMapped = !!(data.columnMapping && Object.keys(data.columnMapping).length > 0);
        // Check if data has been processed/uploaded
        const isUploaded = !!data.processedAt;
        
        // Batch all state updates together to prevent multiple re-renders
        setUploadedFileInfo({
          fileName: data.originalFileName || data.fileName || 'Unknown',
          uploadedAt: data.uploadedAt || new Date().toISOString(),
          processed: isMapped
        });
        setDataUploaded(isUploaded);
        
        // Load the column mapping if it exists
        if (data.columnMapping) {
          setColumnMapping(data.columnMapping);
          // If there's a mapping, mark that mapping has been attempted
          setHasAttemptedMapping(true);
        } else {
          setColumnMapping({});
          setHasAttemptedMapping(false);
        }
        
        // Load column headers if they exist in metadata
        if (data.columnHeaders && Array.isArray(data.columnHeaders) && data.columnHeaders.length > 0) {
          setColumnHeaders(data.columnHeaders);
        } else {
          // If no column headers in metadata, clear them
          setColumnHeaders([]);
        }
      } else if (response.status === 404) {
        // Only clear if we get a 404 (file doesn't exist)
        // Don't clear on other errors as they might be temporary
        setUploadedFileInfo(null);
        setColumnMapping({});
        setColumnHeaders([]);
        setDataUploaded(false);
        setHasAttemptedMapping(false);
      }
      // For other error statuses, don't clear existing state - might be a temporary issue
    } catch (error: any) {
      if (error.name === 'AbortError') {
        return;
      }
      // Don't clear state on network errors - preserve existing data
      // Only log the error for debugging
      console.error('Error loading file info:', error);
    } finally {
      if (!abortController.signal.aborted) {
        isLoadingFileInfoRef.current = false;
        setLoadingFileInfo(false);
        loadFileInfoAbortControllerRef.current = null;
      }
    }
  }, [selectedQuestionnaire]);

  // Create debounced function after loadFileInfo is defined
  const debouncedLoadFileInfo = useCallback((delay: number = 500) => {
    // Clear any existing timeout
    if (loadFileInfoTimeoutRef.current) {
      clearTimeout(loadFileInfoTimeoutRef.current);
    }
    
    // Set new timeout
    loadFileInfoTimeoutRef.current = setTimeout(() => {
      loadFileInfo();
    }, delay);
  }, [loadFileInfo]);

  // Load questionnaire details and processed data when questionnaire is selected
  useEffect(() => {
    if (selectedQuestionnaire) {
      // Always load questionnaire details to get questions/variables
      loadQuestionnaireDetails();
      // Also try to load processed data if it exists - this ensures data persists when navigating back
      // This is critical for page refreshes - data must be loaded from backend
      loadProcessedData();
      // Load file info immediately to get column mapping and file info
      // This is needed for the mapping display in the variables tab
      loadFileInfo();
    } else {
      // Only clear data when explicitly switching away from a questionnaire
      // Don't clear during initial render or when questionnaire is temporarily undefined
      if (viewMode === 'home' || viewMode === 'project') {
        setVariableData({});
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedQuestionnaire, viewMode]);

  // Listen for questionnaire updates from QNR page
  useEffect(() => {
    const handleQuestionnaireUpdate = async (event: CustomEvent) => {
      const { questionnaireId } = event.detail;
      
      // Only reload if this is the currently selected questionnaire
      if (selectedQuestionnaire && selectedQuestionnaire.id === questionnaireId) {
        // Reload questionnaire details to get updated questions
        try {
          // Fetch fresh questionnaire data
          if (selectedProject) {
            const response = await fetch(`${API_BASE_URL}/api/questionnaire/${selectedProject.id}`, {
              headers: { 'Authorization': `Bearer ${localStorage.getItem('cognitive_dash_token')}` }
            });
            if (response.ok) {
              const projectQuestionnaires = await response.json();
              const updatedQnr = projectQuestionnaires.find((q: any) => q.id === questionnaireId);
              if (updatedQnr) {
                // Update selected questionnaire
                setSelectedQuestionnaire(updatedQnr);
                // Update questionnaire questions - this will trigger variable regeneration via useEffect
                if (updatedQnr.questions && updatedQnr.questions.length > 0) {
                  setQuestionnaireQuestions(updatedQnr.questions);
                  // Explicitly trigger variable regeneration to ensure variables reflect updated question types
                  convertQuestionsToVariables(updatedQnr.questions);
                }
                // Update questionnaires list
                setQuestionnaires(projectQuestionnaires);
                // Update allQuestionnaires if needed
                const updatedAllQnrs = allQuestionnaires.map((q: any) => 
                  q.id === questionnaireId ? updatedQnr : q
                );
                if (!updatedAllQnrs.find((q: any) => q.id === questionnaireId)) {
                  updatedAllQnrs.push(updatedQnr);
                }
                setAllQuestionnaires(updatedAllQnrs);
              }
            }
          }
        } catch (error) {
          console.error('Error reloading questionnaire after update:', error);
        }
      }
    };

    const eventHandler = (event: Event) => {
      handleQuestionnaireUpdate(event as CustomEvent);
    };
    
    window.addEventListener('questionnaireUpdated', eventHandler);
    
    return () => {
      window.removeEventListener('questionnaireUpdated', eventHandler);
    };
  }, [selectedQuestionnaire, selectedProject, allQuestionnaires, convertQuestionsToVariables]);
  
  // Reload file info when switching to data view to ensure it's fresh
  // The initial load happens in the effect above when questionnaire is selected
  useEffect(() => {
    if (qnrViewMode === 'data' && selectedQuestionnaire && !isLoadingFileInfoRef.current) {
      // Check if we've already loaded for this questionnaire and view mode combination
      const currentKey = `${selectedQuestionnaire.id}-${qnrViewMode}`;
      const lastKey = `${lastLoadedFileInfoRef.current.qnrId}-${lastLoadedFileInfoRef.current.viewMode}`;
      
      if (currentKey !== lastKey) {
        // Update the ref before calling to prevent duplicate calls
        lastLoadedFileInfoRef.current = { qnrId: selectedQuestionnaire.id, viewMode: qnrViewMode };
        // Use debounced version to prevent rapid calls
        debouncedLoadFileInfo(200);
      }
    }
    
    // Cleanup function to clear any pending timeouts when dependencies change
    return () => {
      if (loadFileInfoTimeoutRef.current) {
        clearTimeout(loadFileInfoTimeoutRef.current);
        loadFileInfoTimeoutRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [qnrViewMode, selectedQuestionnaire]);

  // Memoize data mapping computation to prevent infinite loops
  const dataMappingMemo = useMemo(() => {
    if (variables.length === 0) {
      return { filteredHeaders: [], mappingStatusMap: new Map<string, { isMapped: boolean; mappedColumnHeader: string; mappedVariableName: string }>() };
    }
    
    // Group variables by base question number
    const baseQuestionMap = new Map<string, { baseNumber: string; type: string; variables: Variable[] }>();
    
    variables.forEach((variable) => {
      if (variable.name.endsWith('_Summary Tables') || 
          variable.name.endsWith('_T2B') || 
          variable.name.endsWith('_B2B') || 
          variable.name.endsWith('_M3B') ||
          (variable as any).isSummaryTable) {
        return;
      }
      
      const baseNumber = getBaseQuestionNumber(variable.name);
      if (!baseQuestionMap.has(baseNumber)) {
        const question = questionnaireQuestions.find(q => {
          const qNum = q.number || q.id;
          return qNum === baseNumber || 
                 qNum === baseNumber.replace(/^Q/, '') ||
                 String(qNum) === String(baseNumber);
        });
        const questionType = question?.type || variable.type || '';
        
        baseQuestionMap.set(baseNumber, {
          baseNumber,
          type: questionType,
          variables: []
        });
      }
      baseQuestionMap.get(baseNumber)!.variables.push(variable);
    });
    
    // Get expected headers in the order they appear in variables (preserve QNR order)
    const expectedHeadersSet = new Set<string>();
    const expectedHeadersOrdered: string[] = [];
    baseQuestionMap.forEach((group) => {
      const headers = getExpectedColumnHeadersForBase(group.baseNumber, variables);
      headers.forEach(header => {
        if (!expectedHeadersSet.has(header)) {
          expectedHeadersSet.add(header);
          expectedHeadersOrdered.push(header);
        }
      });
    });
    
    // Apply search filter (preserving order)
    const filtered = expectedHeadersOrdered.filter(header => {
      if (!qnrVariableSearch.trim()) return true;
      const searchLower = qnrVariableSearch.toLowerCase();
      return header.toLowerCase().includes(searchLower);
    });
    
    // Pre-compute mapping status
    const statusMap = new Map<string, { isMapped: boolean; mappedColumnHeader: string; mappedVariableName: string }>();
    
    filtered.forEach((expectedHeader) => {
      let isMapped = false;
      let mappedColumnHeader = '';
      let mappedVariableName = '';
      
      // Normalize expected header for comparison (case-insensitive, handle Q prefix)
      const expectedNormalized = expectedHeader.toLowerCase().trim();
      const expectedWithoutQ = expectedNormalized.startsWith('q') ? expectedNormalized.substring(1) : expectedNormalized;
      const expectedWithQ = expectedNormalized.startsWith('q') ? expectedNormalized : 'q' + expectedNormalized;
      
      // First, check if the expected header itself is a key in the mapping
      // The mapping now uses expected headers as keys (e.g., "QA1r1c1" -> "QA1r1c1")
      const possibleKeys = [expectedHeader, expectedNormalized, expectedWithoutQ, expectedWithQ];
      for (const key of possibleKeys) {
        if (columnMapping[key] && columnMapping[key].trim() !== '') {
          isMapped = true;
          mappedColumnHeader = columnMapping[key];
          mappedVariableName = key;
          break;
        }
      }
      
      // Fallback: Also check variable names for backward compatibility
      if (!isMapped) {
        // Try to find the actual variable that corresponds to this expected header
        let matchingVariable: Variable | null = null;
        
        for (const variable of variables) {
          const varNameNormalized = variable.name.toLowerCase().trim();
          const varNameWithoutQ = varNameNormalized.startsWith('q') ? varNameNormalized.substring(1) : varNameNormalized;
          const varNameWithQ = varNameNormalized.startsWith('q') ? varNameNormalized : 'q' + varNameNormalized;
          
          // Check if this variable matches the expected header
          if (varNameNormalized === expectedNormalized ||
              varNameWithoutQ === expectedWithoutQ ||
              varNameWithQ === expectedWithQ ||
              varNameNormalized === expectedWithQ ||
              varNameNormalized === expectedWithoutQ) {
            matchingVariable = variable;
            break;
          }
        }
        
        // If we found a matching variable, check if it has a mapping
        if (matchingVariable) {
          const varName = matchingVariable.name;
          const varNameNormalized = varName.toLowerCase().trim();
          const varNameWithoutQ = varNameNormalized.startsWith('q') ? varNameNormalized.substring(1) : varNameNormalized;
          const varNameWithQ = varNameNormalized.startsWith('q') ? varNameNormalized : 'q' + varNameNormalized;
          
          // Check all possible key variations
          const varPossibleKeys = [varName, varNameNormalized, varNameWithoutQ, varNameWithQ];
          for (const key of varPossibleKeys) {
            if (columnMapping[key] && columnMapping[key].trim() !== '') {
              isMapped = true;
              mappedColumnHeader = columnMapping[key];
              mappedVariableName = key;
              break;
            }
          }
        }
      }
      
      // If still not mapped, check if any mapped column header value matches the expected header
      // This handles cases where the variable name key doesn't match but the column header value does
      if (!isMapped) {
        for (const [varName, colHeader] of Object.entries(columnMapping)) {
          if (!colHeader || colHeader.trim() === '') continue;
          
          const colHeaderNormalized = colHeader.toLowerCase().trim();
          const colHeaderWithoutQ = colHeaderNormalized.startsWith('q') ? colHeaderNormalized.substring(1) : colHeaderNormalized;
          const colHeaderWithQ = colHeaderNormalized.startsWith('q') ? colHeaderNormalized : 'q' + colHeaderNormalized;
          
          // Check if the column header value matches the expected header (direct match)
          if (colHeaderNormalized === expectedNormalized ||
              colHeaderWithoutQ === expectedWithoutQ ||
              colHeaderWithQ === expectedWithQ ||
              colHeaderNormalized === expectedWithQ ||
              colHeaderNormalized === expectedWithoutQ) {
            // If column header matches, check if variable name also matches (to ensure it's the right mapping)
            const varNameNormalized = varName.toLowerCase().trim();
            const varNameWithoutQ = varNameNormalized.startsWith('q') ? varNameNormalized.substring(1) : varNameNormalized;
            const varNameWithQ = varNameNormalized.startsWith('q') ? varNameNormalized : 'q' + varNameNormalized;
            
            // Check if variable name matches expected header (with Q prefix variations)
            if (varNameNormalized === expectedNormalized ||
                varNameWithoutQ === expectedWithoutQ ||
                varNameWithQ === expectedWithQ ||
                varNameNormalized === expectedWithQ ||
                varNameNormalized === expectedWithoutQ) {
              isMapped = true;
              mappedColumnHeader = colHeader;
              mappedVariableName = varName;
              break;
            }
          }
        }
      }
      
      statusMap.set(expectedHeader, { isMapped, mappedColumnHeader, mappedVariableName });
    });

    return { filteredHeaders: filtered, mappingStatusMap: statusMap };
  }, [variables, questionnaireQuestions, qnrVariableSearch, columnMapping, columnHeaders, getExpectedColumnHeadersForBase, getBaseQuestionNumber]);

  // Compute unmapped expected headers and unused column headers for AI mapping
  const unmappedHeadersInfo = useMemo(() => {
    if (!hasAttemptedMapping || variables.length === 0) {
      return { unmappedExpectedHeaders: [], unusedColumnHeaders: [] };
    }

    // Get all expected headers
    const baseQuestionMap = new Map<string, { baseNumber: string; type: string; variables: Variable[] }>();
    variables.forEach((variable) => {
      if (variable.name.endsWith('_Summary Tables') || 
          variable.name.endsWith('_T2B') || 
          variable.name.endsWith('_B2B') || 
          variable.name.endsWith('_M3B') ||
          (variable as any).isSummaryTable) {
        return;
      }
      const baseNumber = getBaseQuestionNumber(variable.name);
      if (!baseQuestionMap.has(baseNumber)) {
        const question = questionnaireQuestions.find(q => {
          const qNum = q.number || q.id;
          return qNum === baseNumber || 
                 qNum === baseNumber.replace(/^Q/, '') ||
                 String(qNum) === String(baseNumber);
        });
        const questionType = question?.type || variable.type || '';
        baseQuestionMap.set(baseNumber, {
          baseNumber,
          type: questionType,
          variables: []
        });
      }
      baseQuestionMap.get(baseNumber)!.variables.push(variable);
    });

    const allExpectedHeaders: string[] = [];
    baseQuestionMap.forEach((group) => {
      const headers = getExpectedColumnHeadersForBase(group.baseNumber, variables);
      headers.forEach(header => {
        if (!allExpectedHeaders.includes(header)) {
          allExpectedHeaders.push(header);
        }
      });
    });

    // Find unmapped expected headers
    const unmappedExpectedHeaders = allExpectedHeaders.filter(expectedHeader => {
      const status = dataMappingMemo.mappingStatusMap.get(expectedHeader);
      return !status || !status.isMapped;
    });

    // Find unused column headers (those not in the current mapping values)
    const usedColumnHeaders = new Set<string>(
      Object.values(columnMapping)
        .filter(h => h && h.trim() !== '')
        .map(h => h.toLowerCase().trim())
    );
    const unusedColumnHeaders = columnHeaders.filter(colHeader => {
      if (!colHeader || colHeader.trim() === '') return false;
      return !usedColumnHeaders.has(colHeader.toLowerCase().trim());
    });

    return { unmappedExpectedHeaders, unusedColumnHeaders };
  }, [hasAttemptedMapping, variables, questionnaireQuestions, columnMapping, columnHeaders, dataMappingMemo, getBaseQuestionNumber, getExpectedColumnHeadersForBase]);

  // Convert questions to variables when both questions and variableData are available
  // This must run whenever either questions or variableData changes to ensure variables
  // are properly populated on page refresh when data loads asynchronously
  useEffect(() => {
    if (questionnaireQuestions.length > 0) {
      // Always call convertQuestionsToVariables when we have questions
      // It will use the current variableData (even if empty initially, then re-run when data loads)
      convertQuestionsToVariables(questionnaireQuestions);
    } else if (Object.keys(variableData).length > 0) {
      // If we have variableData but no questions yet, we still want to show variables
      // This handles edge cases where data exists but questions haven't loaded
      // Create variables directly from variableData
      const vars: Variable[] = Object.keys(variableData).map((varName) => {
        const varData = variableData[varName];
        return {
          name: varName,
          description: varName,
          type: varData?.numeric ? 'Numeric' : 'Categorical',
          tags: [],
          isSummaryTable: false,
          isScaleSummary: false
        };
      });
      setVariables(vars);
    }
  }, [questionnaireQuestions, variableData, convertQuestionsToVariables]);

  // Update header when viewMode changes
  useEffect(() => {
    if (!onHeaderChange) return;
    
    if (viewMode === 'home') {
      onHeaderChange(null);
    } else if (viewMode === 'project' && selectedProject) {
      onHeaderChange(selectedProject.name);
    } else if (viewMode === 'qnr' && selectedQuestionnaire && selectedProject) {
      onHeaderChange(`${selectedProject.name} • ${selectedQuestionnaire.name}`);
    }
  }, [viewMode, selectedProject, selectedQuestionnaire, onHeaderChange]);

  // Handle project selection
  const handleProjectClick = (project: any) => {
    setSelectedProject(project);
    setViewMode('project');
    loadQuestionnaires(project.id);
  };

  // Filter variables
  const filteredVariables = useMemo(() => {
    // First, identify multiselect response variables and group them by base question
    const multiselectResponseVars = new Set<string>();
    const multiselectBaseQuestions = new Map<string, { variable: Variable; originalIndex: number }>(); // baseQuestion -> first response variable (for metadata) and its original index
    
    variables.forEach((v, index) => {
      const match = v.name.match(/^(.+?)r(\d+)$/i);
      if (match && v.type?.toLowerCase().includes('multi-select')) {
        const baseQuestion = match[1];
        multiselectResponseVars.add(v.name);
        if (!multiselectBaseQuestions.has(baseQuestion)) {
          // Store the first response variable and its original index to maintain QNR order
          multiselectBaseQuestions.set(baseQuestion, { variable: v, originalIndex: index });
        }
      }
    });
    
    // Filter out multiselect response variables and add base question variables
    let filtered = variables.filter(v => {
      // Exclude multiselect response variables (B8r1, B8r2, etc.)
      if (multiselectResponseVars.has(v.name)) {
        return false;
      }
      return true;
    });
    
    // Add synthetic base question variables for multiselect questions at their original position
    // Sort by original index to maintain QNR order
    const sortedBaseQuestions = Array.from(multiselectBaseQuestions.entries())
      .sort((a, b) => a[1].originalIndex - b[1].originalIndex);
    
    sortedBaseQuestions.forEach(([baseQuestion, { variable: firstRespVar, originalIndex }]) => {
      // Check if base question variable already exists (it shouldn't for multiselects)
      const baseExists = filtered.some(v => v.name === baseQuestion);
      if (!baseExists) {
        // Create a synthetic variable for the base question
        // Use the question text from the first response variable's description
        const description = firstRespVar.description?.split(' - ')[0] || baseQuestion;
        const syntheticVar = {
          name: baseQuestion,
          description: description,
          type: 'Multi-Select',
          codes: { '0': 'Not Selected', '1': 'Selected' }, // Binary codes for multiselect options
          tags: firstRespVar.tags || [],
          isSummaryTable: false,
          isScaleSummary: false
        };
        
        // Find the insertion point: find the first variable that was originally after this one
        let insertIndex = filtered.length;
        for (let i = 0; i < filtered.length; i++) {
          const currentVar = filtered[i];
          const currentOriginalIndex = variables.findIndex(v => v.name === currentVar.name);
          if (currentOriginalIndex > originalIndex) {
            insertIndex = i;
            break;
          }
        }
        
        // Insert at the correct position to maintain QNR order
        filtered.splice(insertIndex, 0, syntheticVar);
      }
    });
    
    // Filter out numeric grid column variables (e.g., S4_c1) if there's a mean summary table for them
    // This prevents showing redundant column variable tables when mean summary tables exist
    filtered = filtered.filter(v => {
      // Check if this is a numeric grid column variable (pattern: {questionNumber}_c{number})
      if (v.type?.toLowerCase().includes('numeric') && !v.type?.toLowerCase().includes('grid')) {
        const columnMatch = v.name.match(/^([A-Z0-9]+)_(c\d+)$/i);
        if (columnMatch) {
          const baseName = columnMatch[1];
          const columnCode = columnMatch[2]; // e.g., "c1"
          const meanSummaryTableName = `${baseName}_${columnCode}_Summary`;
          
          // Check if there's a mean summary table for this column
          const hasMeanSummaryTable = variables.some((otherV: any) => 
            otherV.name === meanSummaryTableName && (otherV as any).isSummaryTable
          );
          
          // Exclude this column variable if a mean summary table exists
          if (hasMeanSummaryTable) {
            return false;
          }
        }
      }
      return true;
    });
    
    // Filter out individual cell variables (e.g., S4r1c1, S4r2c1) if there's a summary table for that column
    // This prevents showing redundant individual cell tables when summary tables exist
    filtered = filtered.filter(v => {
      // Check if this is a numeric cell variable (pattern: {baseName}{rowCode}{columnCode} like S4r1c1)
      if (v.type?.toLowerCase().includes('numeric') && !v.type?.toLowerCase().includes('grid')) {
        // Try to match cell variable patterns: S4r1c1, S4_r1_c1, etc.
        // Pattern 1: {baseName}{rowCode}{columnCode} (e.g., S4r1c1)
        const cellMatch1 = v.name.match(/^([A-Z0-9]+)([rc]\d+)(c\d+)$/i);
        if (cellMatch1) {
          const baseName = cellMatch1[1];
          const columnCode = cellMatch1[3]; // e.g., "c1"
          const summaryTableName = `${baseName}_${columnCode}_Summary`;
          
          // Check if there's a summary table for this column
          const hasSummaryTable = variables.some((otherV: any) => 
            otherV.name === summaryTableName && (otherV as any).isSummaryTable
          );
          
          // Exclude this cell variable if a summary table exists
          if (hasSummaryTable) {
            return false;
          }
        }
        
        // Pattern 2: {baseName}_{rowCode}_{columnCode} (e.g., S4_r1_c1)
        const cellMatch2 = v.name.match(/^([A-Z0-9]+)_([rc]\d+)_(c\d+)$/i);
        if (cellMatch2) {
          const baseName = cellMatch2[1];
          const columnCode = cellMatch2[3]; // e.g., "c1"
          const summaryTableName = `${baseName}_${columnCode}_Summary`;
          
          // Check if there's a summary table for this column
          const hasSummaryTable = variables.some((otherV: any) => 
            otherV.name === summaryTableName && (otherV as any).isSummaryTable
          );
          
          // Exclude this cell variable if a summary table exists
          if (hasSummaryTable) {
            return false;
          }
        }
        
        // Pattern 3: {baseName}{rowCode}_{columnCode} (e.g., S4r1_c1)
        const cellMatch3 = v.name.match(/^([A-Z0-9]+)([rc]\d+)_(c\d+)$/i);
        if (cellMatch3) {
          const baseName = cellMatch3[1];
          const columnCode = cellMatch3[3]; // e.g., "c1"
          const summaryTableName = `${baseName}_${columnCode}_Summary`;
          
          // Check if there's a summary table for this column
          const hasSummaryTable = variables.some((otherV: any) => 
            otherV.name === summaryTableName && (otherV as any).isSummaryTable
          );
          
          // Exclude this cell variable if a summary table exists
          if (hasSummaryTable) {
            return false;
          }
        }
        
        // Pattern 4: {baseName}_{rowCode}{columnCode} (e.g., S4_r1c1)
        const cellMatch4 = v.name.match(/^([A-Z0-9]+)_([rc]\d+)(c\d+)$/i);
        if (cellMatch4) {
          const baseName = cellMatch4[1];
          const columnCode = cellMatch4[3]; // e.g., "c1"
          const summaryTableName = `${baseName}_${columnCode}_Summary`;
          
          // Check if there's a summary table for this column
          const hasSummaryTable = variables.some((otherV: any) => 
            otherV.name === summaryTableName && (otherV as any).isSummaryTable
          );
          
          // Exclude this cell variable if a summary table exists
          if (hasSummaryTable) {
            return false;
          }
        }
      }
      return true;
    });
    
    // Apply search filter
    if (variableFilter) {
    const filter = variableFilter.toLowerCase();
      filtered = filtered.filter(v => 
      v.name.toLowerCase().includes(filter) ||
        (v.description && v.description.toLowerCase().includes(filter))
    );
    }
    
    // Apply question type filter
    if (questionTypeFilter) {
      filtered = filtered.filter(v => v.type === questionTypeFilter);
    }
    
    return filtered;
  }, [variables, variableFilter, questionTypeFilter]);

  // Filter variables for banners tab (exclude hidden variables)
  const filteredBannerVariables = useMemo(() => {
    return filteredVariables.filter(v => !hiddenFromBanners.has(v.name));
  }, [filteredVariables, hiddenFromBanners]);

  const variable = variables.find((v: any) => v.name === selectedVariable);

  return (
    <>
      {/* Loading screen for QNR navigation */}
      {loadingQnrNavigation && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg shadow-xl p-8 flex flex-col items-center">
            <div className="mx-auto mb-4 h-12 w-12 animate-spin rounded-full border-4 border-gray-200 border-t-[#D14A2D]"></div>
            <p className="text-sm text-gray-700">Loading QNR...</p>
          </div>
        </div>
      )}
    <div className="flex-1 p-6 space-y-4 max-w-full overflow-y-auto" style={{ height: 'calc(100vh - 80px)', marginTop: '80px', backgroundColor: BRAND_BG }}>
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
            <IconTable className="mx-auto mb-4 h-16 w-16 text-gray-300" />
            <h3 className="text-lg font-semibold text-gray-900">
              {activeTab === 'archived' ? 'No archived quantitative projects' : 'No active quantitative projects'}
            </h3>
            <p className="mt-2 text-gray-500">
              {activeTab === 'archived'
                ? 'Archived quantitative projects will appear here.'
                    : 'Create a quantitative project to start viewing tabs.'}
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
          <div>
            <div className="flex items-center justify-between">
              <button
                onClick={() => {
                  setViewMode('home');
                  setSelectedProject(null);
                  setQuestionnaires([]);
                  setSelectedQuestionnaire(null);
                  setVariables([]);
                  setSelectedVariable(null);
                }}
                className="flex items-center gap-2 text-sm text-gray-600 hover:text-gray-800 hover:bg-gray-100 px-3 py-1 rounded-lg transition-colors"
              >
                <ArrowLeftIcon className="h-4 w-4" />
                Back to Projects
              </button>
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
            {questionnaires.length === 0 ? (
              <div className="p-12 text-center">
                <IconTable className="mx-auto mb-4 h-16 w-16 text-gray-300" />
                <h3 className="text-lg font-semibold text-gray-900">
                  No QNRs found
                </h3>
                <p className="mt-2 text-gray-500">
                  Upload data to a QNR to view tabs.
                </p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="min-w-full divide-y divide-gray-200">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                        QNR Name
                      </th>
                      <th className="px-6 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider">
                        Questions
                      </th>
                    </tr>
                  </thead>
                  <tbody className="bg-white divide-y divide-gray-200">
                    {questionnaires.map((qnr) => (
                      <tr
                        key={qnr.id}
                        className="hover:bg-gray-50 cursor-pointer transition-colors"
                        onClick={() => {
                          setSelectedQuestionnaire(qnr);
                          setViewMode('qnr');
                        }}
                      >
                        <td className="px-6 py-4">
                          <div className="text-sm font-medium text-gray-900">{qnr.name}</div>
                        </td>
                        <td className="px-6 py-4 text-center">
                          <div className="text-sm text-gray-900">
                            {qnr.questions?.length || 0}
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

      {viewMode === 'qnr' && selectedQuestionnaire && (
        <>
          <div>
            <div className="flex items-center justify-between">
              <nav className="-mb-px flex space-x-8 items-center">
                <button
                  onClick={() => setQnrViewMode('variables')}
                  className={`py-2 px-1 border-b-2 font-medium text-sm ${
                    qnrViewMode === 'variables'
                      ? 'text-white'
                      : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                  }`}
                  style={qnrViewMode === 'variables' ? { borderBottomColor: BRAND_ORANGE, color: BRAND_ORANGE } : {}}
                >
                  Variables
                </button>
                <button
                  onClick={() => setQnrViewMode('banners')}
                  className={`py-2 px-1 border-b-2 font-medium text-sm ${
                    qnrViewMode === 'banners'
                      ? 'text-white'
                      : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                  }`}
                  style={qnrViewMode === 'banners' ? { borderBottomColor: BRAND_ORANGE, color: BRAND_ORANGE } : {}}
                >
                  Banners
                </button>
                <button
                  onClick={() => setQnrViewMode('data')}
                  className={`py-2 px-1 border-b-2 font-medium text-sm ${
                    qnrViewMode === 'data'
                      ? 'text-white'
                      : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                  }`}
                  style={qnrViewMode === 'data' ? { borderBottomColor: BRAND_ORANGE, color: BRAND_ORANGE } : {}}
                >
                  Data
                </button>
                <button
                  onClick={() => setQnrViewMode('rawdata')}
                  className={`py-2 px-1 border-b-2 font-medium text-sm ${
                    qnrViewMode === 'rawdata'
                      ? 'text-white'
                      : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                  }`}
                  style={qnrViewMode === 'rawdata' ? { borderBottomColor: BRAND_ORANGE, color: BRAND_ORANGE } : {}}
                >
                  Raw Data
                </button>
              </nav>
              <div className="flex items-center gap-3">
                {/* Check if QNR has variables loaded - show sync button if no variables */}
                {qnrViewMode === 'variables' && (!loading && variables.length === 0) && (
                  <button
                    onClick={() => {
                      // Load questionnaire details to get questions and convert to variables
                      loadQuestionnaireDetails();
                    }}
                    className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-white rounded-lg shadow-sm transition-colors hover:opacity-90"
                    style={{ backgroundColor: BRAND_ORANGE }}
                  >
                    <ArrowPathIcon className="h-4 w-4" />
                    Sync with QNR
                  </button>
                )}
              </div>
            </div>
            <div className="border-b border-gray-200"></div>
          </div>

          <div className="bg-white shadow-sm border border-gray-200 rounded-lg overflow-hidden">

          {qnrViewMode === 'variables' ? (
            <div className="flex h-[calc(100vh-200px)]">
              {/* Variable List Sidebar */}
              <div className="w-80 border-r border-gray-200 flex flex-col">
                {/* Sticky header with search bar */}
                <div className="p-4 border-b border-gray-200 bg-white sticky top-0 z-10">
                  <div className="flex items-center justify-between mb-3">
                    <h3 className="text-sm font-semibold text-gray-900">
                      Variables <span className="text-gray-500 italic font-normal">({filteredVariables.length})</span>
                    </h3>
                    <div className="relative">
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          setShowQuestionTypeFilter(!showQuestionTypeFilter);
                        }}
                        className={`p-1.5 rounded-lg transition-colors ${
                          questionTypeFilter 
                            ? 'text-orange-600 bg-orange-50' 
                            : 'text-gray-400 hover:text-gray-600 hover:bg-gray-100'
                        }`}
                        title="Filter by question type"
                      >
                        <FunnelIcon className="h-5 w-5" />
                      </button>
                      {showQuestionTypeFilter && (
                        <>
                          <div 
                            className="fixed inset-0 z-10" 
                            onClick={() => setShowQuestionTypeFilter(false)}
                          />
                          <div className="absolute right-0 mt-2 w-56 bg-white border border-gray-200 rounded-lg shadow-lg z-20">
                            <div className="p-2">
                              <button
                                onClick={() => {
                                  setQuestionTypeFilter(null);
                                  setShowQuestionTypeFilter(false);
                                }}
                                className={`w-full text-left px-3 py-2 text-sm rounded hover:bg-gray-100 ${
                                  questionTypeFilter === null ? 'bg-orange-50 text-orange-600 font-medium' : 'text-gray-700'
                                }`}
                              >
                                All Types
                              </button>
                              {(() => {
                                // Get unique question types from variables
                                const uniqueTypes = new Set<string>();
                                variables.forEach(v => {
                                  if (v.type) {
                                    uniqueTypes.add(v.type);
                                  }
                                });
                                return Array.from(uniqueTypes).sort().map(type => (
                                  <button
                                    key={type}
                                    onClick={() => {
                                      setQuestionTypeFilter(type);
                                      setShowQuestionTypeFilter(false);
                                    }}
                                    className={`w-full text-left px-3 py-2 text-sm rounded hover:bg-gray-100 ${
                                      questionTypeFilter === type ? 'bg-orange-50 text-orange-600 font-medium' : 'text-gray-700'
                                    }`}
                                  >
                                    {type}
                                  </button>
                                ));
                              })()}
                            </div>
                          </div>
                        </>
                      )}
                    </div>
                  </div>
                  <div className="relative">
                    <MagnifyingGlassIcon className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-gray-400" />
                    <input
                      type="text"
                      id="variable-search"
                      name="variable-search"
                      placeholder="Search variables..."
                      value={variableFilter}
                      onChange={(e) => setVariableFilter(e.target.value)}
                      className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-orange-500"
                    />
                  </div>
                  {questionTypeFilter && (
                    <div className="mt-2 flex items-center gap-2">
                      <span className="text-xs text-gray-600">Filtered by:</span>
                      <span className="text-xs px-2 py-1 bg-orange-100 text-orange-800 rounded">
                        {questionTypeFilter}
                      </span>
                      <button
                        onClick={() => setQuestionTypeFilter(null)}
                        className="text-xs text-gray-500 hover:text-gray-700"
                      >
                        Clear
                      </button>
                    </div>
                  )}
                </div>
                {/* Scrollable variable list */}
                <div className="flex-1 overflow-y-auto p-2">
                  {loading ? (
                    <div className="text-center py-8 text-gray-500">Loading variables...</div>
                  ) : filteredVariables.length === 0 ? (
                    <div className="text-center py-8 text-gray-500">
                      {variableFilter ? 'No variables match your search' : 'No variables available. Upload data to see variables.'}
                </div>
                  ) : (
                    <div className="space-y-1">
                      {filteredVariables.map((v) => {
                        const varData = getVariableDataByExpectedHeader(v.name);
                        
                        // For summary tables (numeric grids), check if the table has any data to display
                        let hasData = false;
                        
                        // Special handling for open end list summary tables
                        if (v.type?.toLowerCase().includes('open end list') && 
                            (v as any).isSummaryTable && 
                            v.name.endsWith('_Summary')) {
                          // For open end list summary tables, check if any related individual variables have data
                          const baseQuestionName = v.name.replace('_Summary', '');
                          const relatedVariables = variables.filter((relatedV: any) => {
                            if (!relatedV.type?.toLowerCase().includes('open end list')) return false;
                            if ((relatedV as any).isSummaryTable) return false;
                            const varMatch = relatedV.name.match(/^([A-Z0-9]+)r\d+$/i);
                            return varMatch && varMatch[1] === baseQuestionName;
                          });
                          
                          // Check if any related variable has data
                          hasData = relatedVariables.some((relatedVar: any) => {
                            const relatedVarData = getVariableDataByExpectedHeader(relatedVar.name);
                            if (!relatedVarData) return false;
                            
                            const hasFrequencies = relatedVarData.frequencies && typeof relatedVarData.frequencies === 'object' && 
                              Object.keys(relatedVarData.frequencies).length > 0 &&
                              Object.values(relatedVarData.frequencies).some((count: any) => typeof count === 'number' && count > 0);
                            const hasValues = Array.isArray(relatedVarData.values) && relatedVarData.values.length > 0;
                            
                            return hasFrequencies || hasValues;
                          });
                        } else if ((v as any).isSummaryTable && v.statements) {
                          // Check if this is a column summary table (e.g., S4_c1_Summary)
                          const columnMatch = v.name.match(/^([A-Z0-9]+)_(c\d+)(?:_Summary)?$/i);
                          const isNumericGridColumnSummary = columnMatch && v.type?.toLowerCase().includes('numeric');
                          
                          if (isNumericGridColumnSummary) {
                            // For column summary tables, check if any rows have data (mean or sum)
                            const baseName = columnMatch![1];
                            const columnCode = columnMatch![2];
                            
                            // Check if this is a numeric list
                            const question = questionnaireQuestions.find(q => {
                              const qNum = q.number || q.id;
                              return qNum === baseName || 
                                     qNum === baseName.replace(/^Q/, '') ||
                                     String(qNum) === String(baseName);
                            });
                            const isNumericList = question?.type?.toLowerCase().includes('numeric list');
                            
                            hasData = Object.keys(v.statements).some((stmtCode) => {
                              // Try to find data for this row in this column
                              let hasRowData = false;
                              
                              // For numeric lists, normalize the code (add "r" prefix if needed)
                              let normalizedStmtCode = stmtCode;
                              if (isNumericList && !/^r\d+/i.test(stmtCode) && /^\d+$/.test(stmtCode)) {
                                normalizedStmtCode = `r${stmtCode}`;
                              }
                              
                              // Check cell variables first
                              const cellVarNames = [
                                // Without Q prefix
                                `${baseName}${normalizedStmtCode}${columnCode}`,
                                `${baseName}_${normalizedStmtCode}_${columnCode}`,
                                `${baseName}${normalizedStmtCode}_${columnCode}`,
                                `${baseName}_${normalizedStmtCode}${columnCode}`,
                                // With Q prefix (data often stored with Q prefix)
                                `Q${baseName}${normalizedStmtCode}${columnCode}`,
                                `Q${baseName}_${normalizedStmtCode}_${columnCode}`,
                                `Q${baseName}${normalizedStmtCode}_${columnCode}`,
                                `Q${baseName}_${normalizedStmtCode}${columnCode}`,
                              ];
                              
                              for (const cellVarName of cellVarNames) {
                                const cellData = getVariableDataByExpectedHeader(cellVarName);
                                if (cellData && (
                                  (cellData.count && cellData.count > 0) ||
                                  (cellData.values && Array.isArray(cellData.values) && cellData.values.length > 0) ||
                                  (cellData.sum !== undefined) ||
                                  (cellData.mean !== undefined)
                                )) {
                                  hasRowData = true;
                                  break;
                                }
                              }
                              
                              // Check statement variable with frequencies
                              if (!hasRowData) {
                                const statementVarName = `${baseName}${normalizedStmtCode}`;
                                const expectedHeader = `Q${statementVarName}`;
                                const statementData = getVariableDataByExpectedHeader(expectedHeader);
                                if (statementData) {
                                  if (statementData.frequencies && (
                                    statementData.frequencies[columnCode] !== undefined ||
                                    statementData.frequencies[columnCode.replace(/^c/i, '')] !== undefined
                                  )) {
                                    hasRowData = true;
                                  } else if (statementData.sum !== undefined || statementData.mean !== undefined) {
                                    hasRowData = true;
                                  }
                                }
                              }
                              
                              return hasRowData;
                            });
                          } else {
                            // For other summary tables, check if any of the child statement variables have data
                            // For summary tables, extract base question number (remove "_Summary" or "_Summary Tables" suffix)
                            let baseName = v.name;
                            if (v.name.endsWith('_Summary')) {
                              baseName = v.name.replace('_Summary', '');
                            } else if (v.name.endsWith('_Summary Tables')) {
                              baseName = v.name.replace('_Summary Tables', '');
                            }
                            hasData = Object.keys(v.statements).some((stmtCode) => {
                              const statementVarName = `${baseName}${stmtCode}`;
                              const expectedHeader = `Q${statementVarName}`;
                              const statementData = variableData[expectedHeader] || variableData[statementVarName];
                              return statementData && (
                                (statementData.count && statementData.count > 0) ||
                                (statementData.frequencies && Object.keys(statementData.frequencies || {}).length > 0) ||
                                (statementData.values && Array.isArray(statementData.values) && statementData.values.length > 0) ||
                                (statementData.sum !== undefined) ||
                                (statementData.mean !== undefined)
                              );
                            });
                          }
                        } else if (v.type?.toLowerCase().includes('numeric grid') && v.statements && v.codes && 
                                   Object.keys(v.statements).length > 0 && Object.keys(v.codes).length > 0) {
                          // For numeric grids with both statements and response options, check cell variables
                          hasData = Object.keys(v.statements || {}).some((stmtCode) => {
                            return Object.keys(v.codes || {}).some((responseCode) => {
                              const cellVarName = `${v.name}_${stmtCode}_${responseCode}`;
                              const cellData = getVariableDataByExpectedHeader(cellVarName);
                              return cellData && (
                                (cellData.count && cellData.count > 0) ||
                                (cellData.values && Array.isArray(cellData.values) && cellData.values.length > 0) ||
                                (cellData.sum !== undefined) ||
                                (cellData.mean !== undefined)
                              );
                            });
                          });
                        } else {
                          // Check if this is a multiselect base question (B8) that has response variables (B8r1, B8r2, etc.)
                          const isMultiselectBase = v.type?.toLowerCase().includes('multi-select') && 
                                                   !v.name.match(/r\d+$/i);
                          
                          if (isMultiselectBase) {
                            // Check if any response variables have data
                            hasData = variables.some(respVar => {
                              const match = respVar.name.match(/^(.+?)r(\d+)$/i);
                              if (match && match[1] === v.name && respVar.type?.toLowerCase().includes('multi-select')) {
                                const respVarData = getVariableDataByExpectedHeader(respVar.name);
                                return respVarData && (
                                  (respVarData.count && respVarData.count > 0) ||
                                  (respVarData.frequencies && Object.keys(respVarData.frequencies || {}).length > 0) ||
                                  (respVarData.values && Array.isArray(respVarData.values) && respVarData.values.length > 0)
                                );
                              }
                              return false;
                          });
                        } else {
                          hasData = varData && (
                            (varData.count && varData.count > 0) ||
                            (varData.frequencies && Object.keys(varData.frequencies || {}).length > 0) ||
                            (varData.values && Array.isArray(varData.values) && varData.values.length > 0)
                          );
                          }
                        }

                        // Check for scale summary variables (T2B, M3B, B2B)
                        if ((v as any).isScaleSummary && v.statements) {
                          const scaleMatch = v.name.match(/^([A-Z0-9]+)_(T2B|M3B|B2B)$/i);
                          if (scaleMatch) {
                            const baseName = scaleMatch[1];
                            hasData = Object.keys(v.statements).some((stmtCode) => {
                              const statementVarName = `${baseName}${stmtCode}`;
                              const expectedHeader = `Q${statementVarName}`;
                              const statementData = getVariableDataByExpectedHeader(expectedHeader);

                              if (!statementData) return false;

                              const hasFrequencies = statementData.frequencies &&
                                Object.keys(statementData.frequencies).length > 0;
                              const hasValues = statementData.values &&
                                Array.isArray(statementData.values) &&
                                statementData.values.length > 0;

                              return hasFrequencies || hasValues;
                            });
                          }
                        }

                        // Check if percentages don't sum to 100% (for single-select questions)
                        let hasPercentageError = false;
                        if (hasData && v.codes && Object.keys(v.codes).length > 0 && 
                            !v.statements && !(v as any).isSummaryTable && 
                            !v.type?.toLowerCase().includes('numeric grid')) {
                          // Use the same frequency generation logic as in the table
                          let frequencies = varData?.frequencies;
                          if (!frequencies && varData?.values && Array.isArray(varData.values) && v.codes && Object.keys(v.codes).length > 0) {
                            frequencies = {};
                            const codes: Record<string, string> = v.codes;
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
                            const total = varData?.count || 0;
                            const isSingleSelect = v.type?.toLowerCase().includes('single select') && !v.type?.toLowerCase().includes('grid');
                            let totalCount = 0;
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
                            
                            // First pass: calculate totalCount for single-select tables
                            if (isSingleSelect) {
                              Object.entries(v.codes || {}).forEach(([code]) => {
                                const count = getCount(code);
                                totalCount += count;
                              });
                            }
                            
                            // Second pass: calculate percentages
                            Object.entries(v.codes || {}).forEach(([code]) => {
                              const count = getCount(code);
                              // For single-select tables, use totalCount; otherwise use total
                              const percentage = isSingleSelect && totalCount > 0 
                                ? (count / totalCount) * 100 
                                : (total > 0 ? (count / total) * 100 : 0);
                              totalPercentage += percentage;
                            });
                            
                            // Only show error if totalPercentage is not 100% (or very close)
                            if (Math.abs(totalPercentage - 100) > 0.1) {
                              hasPercentageError = true;
                            }
                          }
                        }
                    
                    return (
                          <button
                            key={v.name}
                            onClick={() => setSelectedVariable(v.name)}
                            className={`w-full text-left px-3 py-2 rounded-lg text-sm transition-colors ${
                              selectedVariable === v.name
                                ? 'bg-orange-100 text-orange-900'
                                : 'hover:bg-gray-100 text-gray-700'
                            }`}
                          >
                            <div className="flex items-center justify-between gap-2 w-full">
                              <div className="flex items-center gap-2 flex-1 min-w-0">
                              {(() => {
                                // Check if this is a numeric grid column summary (e.g., S11_c1_Summary)
                                const columnSummaryMatch = v.name.match(/^([A-Z0-9]+)_(c\d+)_Summary$/i);
                                let displayName = v.name;
                                let titleText = v.name;
                                
                                if (columnSummaryMatch && (v as any).isSummaryTable) {
                                  const baseQuestionNumber = columnSummaryMatch[1];
                                  const columnCode = columnSummaryMatch[2]; // e.g., "c1"
                                  
                                  // Find the question to check if it's a numeric list
                                  const question = questionnaireQuestions.find(q => {
                                    const qNum = q.number || q.id;
                                    return qNum === baseQuestionNumber || 
                                           qNum === baseQuestionNumber.replace(/^Q/, '') ||
                                           String(qNum) === String(baseQuestionNumber);
                                  });
                                  
                                  const isNumericList = question?.type?.toLowerCase().includes('numeric list');
                                  
                                  if (isNumericList) {
                                    // For numeric lists, check if it has "%" tag to determine label
                                    const hasPercentTag = (v as any).tags && Array.isArray((v as any).tags) && (v as any).tags.includes('%');
                                    // For numeric lists with "%" tag, show as "{baseQuestionNumber}_Mean Summary"
                                    // Otherwise show as "{baseQuestionNumber}_Summary"
                                    displayName = hasPercentTag ? `${baseQuestionNumber}_Mean Summary` : `${baseQuestionNumber}_Summary`;
                                    titleText = displayName;
                                  } else if (question && question.responseOptions && Array.isArray(question.responseOptions)) {
                                    // For numeric grids, show column name
                                    // Extract column number from code (e.g., "c1" -> 1)
                                    const colNumMatch = columnCode.match(/c(\d+)/i);
                                    if (colNumMatch) {
                                      const colIndex = parseInt(colNumMatch[1]) - 1; // Convert to 0-based index
                                      const responseOption = question.responseOptions[colIndex];
                                      
                                      if (responseOption) {
                                        // Get the text from the response option
                                        const optionText = typeof responseOption === 'string' 
                                          ? responseOption 
                                          : (responseOption.text || responseOption.label || `Column ${colIndex + 1}`);
                                        
                                        displayName = `${baseQuestionNumber} - ${optionText}`;
                                        titleText = displayName;
                                      }
                                    }
                                  }
                                  
                                  // Fallback: if we can't find the response option, just show the column code
                                  if (displayName === v.name) {
                                    displayName = `${baseQuestionNumber} - ${columnCode}`;
                                    titleText = displayName;
                                  }
                                }
                                
                                return (
                                  <span className="font-medium truncate block" title={titleText}>
                                    {displayName}
                                  </span>
                                );
                              })()}
                              {/* Show crossed-out eye icon as visual indicator when hidden from banners */}
                              {hiddenFromBanners.has(v.name) && (
                                <EyeSlashIcon className="h-4 w-4 text-gray-400 flex-shrink-0" title="Hidden from banners" />
                              )}
                              {/* Show error icon for percentage errors or when there's no data (warning message shown above table) */}
                              {hasPercentageError || !hasData ? (
                                <InformationCircleIcon 
                                  className="h-4 w-4 text-red-500 flex-shrink-0" 
                                  title={hasPercentageError 
                                    ? "Percentages don't sum to 100% - check response codes"
                                    : "No data available - see warning message above table"
                                  } 
                                />
                              ) : null}
                              </div>
                              <span className="text-xs px-2 py-0.5 rounded flex-shrink-0 bg-blue-100 text-blue-800" style={{ minWidth: '80px', textAlign: 'center' }}>
                                {v.type || 'Unknown'}
                              </span>
                        </div>
                            {v.description && (
                              <div className="text-xs text-gray-500 mt-1">
                                {(() => {
                                  const desc = v.description;
                                  // Check if description contains a newline (for grid individual variables)
                                  if (desc.includes('\n')) {
                                    const [questionText, statementText] = desc.split('\n', 2);
                                    return (
                                      <>
                                        <div className="truncate">{questionText}</div>
                                        <div className="truncate font-semibold mt-0.5">{statementText}</div>
                                      </>
                                    );
                                  }
                                  return <div className="truncate">{desc}</div>;
                                })()}
                              </div>
                            )}
                          </button>
                    );
                  })}
                          </div>
                  )}
              </div>
            </div>

              {/* Variable Detail View */}
              <div className="flex-1 overflow-y-auto p-6">
              {selectedVariable ? (
                (() => {
                    // Look in filteredVariables first (includes synthetic multiselect base variables),
                    // then fall back to variables array
                    let variable = filteredVariables.find((v: any) => v.name === selectedVariable);
                    if (!variable) {
                      variable = variables.find((v: any) => v.name === selectedVariable);
                    }
                    
                    if (!variable) {
                      return <div className="text-center py-12 text-gray-500">Variable not found</div>;
                    }
                  
                  const varData = getVariableDataByExpectedHeader(variable.name);
                  
                  // Check if percentages don't sum to 100% (for single-select questions)
                  let hasPercentageError = false;
                  const isMultiSelect = variable.type?.toLowerCase().includes('multi-select');
                  if (variable.codes && Object.keys(variable.codes).length > 0 && 
                      !variable.statements && !(variable as any).isSummaryTable && 
                      !variable.type?.toLowerCase().includes('numeric grid') &&
                      !isMultiSelect) {
                    // Use the same frequency generation logic as in the table
                    let frequencies = varData?.frequencies;
                    if (!frequencies && varData?.values && Array.isArray(varData.values) && variable.codes && Object.keys(variable.codes).length > 0) {
                      frequencies = {};
                      const codes: Record<string, string> = variable.codes;
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
                      const total = varData?.count || 0;
                      const isSingleSelect = variable.type?.toLowerCase().includes('single select') && !variable.type?.toLowerCase().includes('grid');
                      let totalCount = 0;
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
                      
                      // First pass: calculate totalCount for single-select tables
                      if (isSingleSelect) {
                        Object.entries(variable.codes || {}).forEach(([code]) => {
                          const count = getCount(code);
                          totalCount += count;
                        });
                      }
                      
                      // Second pass: calculate percentages
                      Object.entries(variable.codes || {}).forEach(([code]) => {
                        const count = getCount(code);
                        // For single-select tables, use totalCount; otherwise use total
                        const percentage = isSingleSelect && totalCount > 0 
                          ? (count / totalCount) * 100 
                          : (total > 0 ? (count / total) * 100 : 0);
                        totalPercentage += percentage;
                      });
                      
                      // Only show error if totalPercentage is not 100% (or very close)
                      // Skip this check for multi-select questions as they can have percentages > 100%
                      if (!isMultiSelect && Math.abs(totalPercentage - 100) > 0.1) {
                        hasPercentageError = true;
                      }
                    }
                  }
                  
                  // For summary tables (numeric grids), check if the table has any data to display
                  let hasData = false;
                  
                  // Special handling for open end list summary tables
                  if (variable.type?.toLowerCase().includes('open end list') && 
                      (variable as any).isSummaryTable && 
                      variable.name.endsWith('_Summary')) {
                    // For open end list summary tables, check if any related individual variables have data
                    const baseQuestionName = variable.name.replace('_Summary', '');
                    const relatedVariables = variables.filter((v: any) => {
                      if (!v.type?.toLowerCase().includes('open end list')) return false;
                      if ((v as any).isSummaryTable) return false;
                      const varMatch = v.name.match(/^([A-Z0-9]+)r\d+$/i);
                      return varMatch && varMatch[1] === baseQuestionName;
                    });
                    
                    // Check if any related variable has data
                    hasData = relatedVariables.some((relatedVar: any) => {
                      const relatedVarData = getVariableDataByExpectedHeader(relatedVar.name);
                      if (!relatedVarData) return false;
                      
                      const hasFrequencies = relatedVarData.frequencies && typeof relatedVarData.frequencies === 'object' && 
                        Object.keys(relatedVarData.frequencies).length > 0 &&
                        Object.values(relatedVarData.frequencies).some((count: any) => typeof count === 'number' && count > 0);
                      const hasValues = Array.isArray(relatedVarData.values) && relatedVarData.values.length > 0;
                      
                      return hasFrequencies || hasValues;
                    });
                  } else if ((variable as any).isSummaryTable && variable.statements) {
                    // Check if this is a column summary table (e.g., S4_c1_Summary)
                    const columnMatch = variable.name.match(/^([A-Z0-9]+)_(c\d+)(?:_Summary)?$/i);
                    const isNumericGridColumnSummary = columnMatch && variable.type?.toLowerCase().includes('numeric');
                    
                    if (isNumericGridColumnSummary) {
                      // For column summary tables (including numeric lists), check if any rows have data (mean or sum)
                      const baseName = columnMatch![1];
                      const columnCode = columnMatch![2];
                      
                      // Check if this is a numeric list
                      const question = questionnaireQuestions.find(q => {
                        const qNum = q.number || q.id;
                        return qNum === baseName || qNum === baseName.replace(/^Q/, '');
                      });
                      const isNumericList = question?.type?.toLowerCase().includes('numeric list');
                      
                      hasData = Object.keys(variable.statements).some((stmtCode) => {
                        // Try to find data for this row in this column
                        let hasRowData = false;
                        
                        // For numeric lists, normalize the code (add "r" prefix if needed)
                        let normalizedStmtCode = stmtCode;
                        if (isNumericList && !/^r\d+/i.test(stmtCode) && /^\d+$/.test(stmtCode)) {
                          normalizedStmtCode = `r${stmtCode}`;
                        }
                        
                        // Check cell variables first
                        const cellVarNames = [
                          // Without Q prefix
                          `${baseName}${normalizedStmtCode}${columnCode}`,
                          `${baseName}_${normalizedStmtCode}_${columnCode}`,
                          `${baseName}${normalizedStmtCode}_${columnCode}`,
                          `${baseName}_${normalizedStmtCode}${columnCode}`,
                          // With Q prefix (data often stored with Q prefix)
                          `Q${baseName}${normalizedStmtCode}${columnCode}`,
                          `Q${baseName}_${normalizedStmtCode}_${columnCode}`,
                          `Q${baseName}${normalizedStmtCode}_${columnCode}`,
                          `Q${baseName}_${normalizedStmtCode}${columnCode}`,
                        ];
                        
                        for (const cellVarName of cellVarNames) {
                          const cellData = getVariableDataByExpectedHeader(cellVarName);
                          if (cellData && (
                            (cellData.count && cellData.count > 0) ||
                            (cellData.values && Array.isArray(cellData.values) && cellData.values.length > 0) ||
                            (cellData.sum !== undefined) ||
                            (cellData.mean !== undefined)
                          )) {
                            hasRowData = true;
                            break;
                          }
                        }
                        
                        // Check statement variable with frequencies
                        if (!hasRowData) {
                          const statementVarName = `${baseName}${normalizedStmtCode}`;
                          const expectedHeader = `Q${statementVarName}`;
                          const statementData = getVariableDataByExpectedHeader(expectedHeader);
                          if (statementData) {
                            if (statementData.frequencies && (
                              statementData.frequencies[columnCode] !== undefined ||
                              statementData.frequencies[columnCode.replace(/^c/i, '')] !== undefined
                            )) {
                              hasRowData = true;
                            } else if (statementData.sum !== undefined || statementData.mean !== undefined) {
                              hasRowData = true;
                            }
                          }
                        }
                        
                        return hasRowData;
                      });
                    } else {
                      // For other summary tables, check if any of the child statement variables have data
                      // For summary tables, extract base question number (remove "_Summary" or "_Summary Tables" suffix)
                      let baseName = variable.name;
                      if (variable.name.endsWith('_Summary')) {
                        baseName = variable.name.replace('_Summary', '');
                      } else if (variable.name.endsWith('_Summary Tables')) {
                        baseName = variable.name.replace('_Summary Tables', '');
                      }
                      hasData = Object.keys(variable.statements).some((stmtCode) => {
                        const statementVarName = `${baseName}${stmtCode}`;
                        const expectedHeader = `Q${statementVarName}`;
                        const statementData = getVariableDataByExpectedHeader(expectedHeader);
                        return statementData && (
                          (statementData.count && statementData.count > 0) ||
                          (statementData.frequencies && Object.keys(statementData.frequencies || {}).length > 0) ||
                          (statementData.values && Array.isArray(statementData.values) && statementData.values.length > 0) ||
                          (statementData.sum !== undefined) ||
                          (statementData.mean !== undefined)
                        );
                      });
                    }
                  } else if (variable.type?.toLowerCase().includes('numeric grid') && variable.statements && variable.codes && 
                             Object.keys(variable.statements).length > 0 && Object.keys(variable.codes).length > 0) {
                    // For numeric grids with both statements and response options, check cell variables
                    hasData = Object.keys(variable.statements || {}).some((stmtCode) => {
                      return Object.keys(variable.codes || {}).some((responseCode) => {
                        const cellVarName = `${variable.name}_${stmtCode}_${responseCode}`;
                        const cellData = getVariableDataByExpectedHeader(cellVarName);
                        return cellData && (
                          (cellData.count && cellData.count > 0) ||
                          (cellData.values && Array.isArray(cellData.values) && cellData.values.length > 0) ||
                          (cellData.sum !== undefined) ||
                          (cellData.mean !== undefined)
                        );
                      });
                    });
                  } else if (variable.type?.toLowerCase().includes('numeric') && !variable.type?.toLowerCase().includes('grid')) {
                    // Check if this is a numeric grid column variable (pattern: {questionNumber}_c{number})
                    const columnMatch = variable.name.match(/^([A-Z0-9]+)_(c\d+)$/i);
                    if (columnMatch) {
                      const baseName = columnMatch[1];
                      const columnCode = columnMatch[2]; // This includes the "c" prefix (e.g., "c1")
                      
                      // First, check if the column variable itself exists in variableData
                      // This handles cases where data is stored directly under the column variable name
                      const columnVarData = getVariableDataByExpectedHeader(variable.name);
                      if (columnVarData && (
                        (columnVarData.count && columnVarData.count > 0) ||
                        (columnVarData.frequencies && Object.keys(columnVarData.frequencies || {}).length > 0) ||
                        (columnVarData.values && Array.isArray(columnVarData.values) && columnVarData.values.length > 0) ||
                        (columnVarData.sum !== undefined) ||
                        (columnVarData.mean !== undefined)
                      )) {
                        hasData = true;
                      } else {
                        // Check if there's a mapped column name (from columnMapping)
                        // Convert to expected header format and get mapped column name
                        const expectedHeader = variable.name.startsWith('Q') ? variable.name : `Q${variable.name}`;
                        let mappedColumnName = columnMapping[expectedHeader];
                        if (!mappedColumnName) {
                          mappedColumnName = columnMapping[variable.name];
                        }
                        if (mappedColumnName) {
                          const mappedVarData = variableData[mappedColumnName];
                          if (mappedVarData && (
                            (mappedVarData.count && mappedVarData.count > 0) ||
                            (mappedVarData.frequencies && Object.keys(mappedVarData.frequencies || {}).length > 0) ||
                            (mappedVarData.values && Array.isArray(mappedVarData.values) && mappedVarData.values.length > 0) ||
                            (mappedVarData.sum !== undefined) ||
                            (mappedVarData.mean !== undefined)
                          )) {
                            hasData = true;
                          }
                        }
                        
                        // If still no data, check cell variables
                        if (!hasData) {
                      // Find the main grid variable to get statements
                      const mainGridVar = variables.find((v: any) => v.name === baseName && v.type?.toLowerCase().includes('numeric grid'));
                      
                      if (mainGridVar && mainGridVar.statements) {
                        // Check if any cell variables have data for this column
                        // Try multiple cell variable name formats
                        hasData = Object.keys(mainGridVar.statements || {}).some((stmtCode) => {
                          const cellVarNames = [
                            // Without Q prefix
                            `${baseName}_${stmtCode}_${columnCode}`,  // S11_r1_c1
                            `${baseName}${stmtCode}${columnCode}`,    // S11r1c1
                            `${baseName}_${stmtCode}${columnCode}`,   // S11_r1c1
                            `${baseName}${stmtCode}_${columnCode}`,   // S11r1_c1
                            // With Q prefix (data often stored with Q prefix)
                            `Q${baseName}_${stmtCode}_${columnCode}`,  // QS11_r1_c1
                            `Q${baseName}${stmtCode}${columnCode}`,    // QS11r1c1
                            `Q${baseName}_${stmtCode}${columnCode}`,   // QS11_r1c1
                            `Q${baseName}${stmtCode}_${columnCode}`,   // QS11r1_c1
                            // Also try with mapped column names if available
                            mappedColumnName ? `${mappedColumnName.replace(/^Q/i, '')}_${stmtCode}_${columnCode}` : null,
                            mappedColumnName ? `${mappedColumnName.replace(/^Q/i, '')}${stmtCode}${columnCode}` : null
                          ].filter(Boolean) as string[];
                          
                          for (const cellVarName of cellVarNames) {
                            const cellData = getVariableDataByExpectedHeader(cellVarName);
                            if (cellData && (
                              (cellData.count && cellData.count > 0) ||
                              (cellData.values && Array.isArray(cellData.values) && cellData.values.length > 0) ||
                              (cellData.sum !== undefined) ||
                              (cellData.mean !== undefined)
                            )) {
                              return true;
                            }
                          }
                          return false;
                        });
                      } else {
                        // Not a column variable or no main grid found, check direct variable data
                        // For numeric variables, also check for sum and mean which indicate data exists
                        hasData = varData && (
                          (varData.count && varData.count > 0) ||
                          (varData.frequencies && Object.keys(varData.frequencies || {}).length > 0) ||
                          (varData.values && Array.isArray(varData.values) && varData.values.length > 0) ||
                          (varData.sum !== undefined) ||
                          (varData.mean !== undefined)
                        );
                          }
                        }
                      }
                    } else {
                      // Regular numeric variable (including numeric list variables), check direct data
                      // For numeric variables, also check for sum and mean which indicate data exists
                      hasData = varData && (
                        (varData.count && varData.count > 0) ||
                        (varData.frequencies && Object.keys(varData.frequencies || {}).length > 0) ||
                        (varData.values && Array.isArray(varData.values) && varData.values.length > 0) ||
                        (varData.sum !== undefined) ||
                        (varData.mean !== undefined)
                      );
                    }
                  } else {
                    // Check if this is a multiselect base question (B8) that has response variables (B8r1, B8r2, etc.)
                    const isMultiselectBase = variable.type?.toLowerCase().includes('multi-select') && 
                                             !variable.name.match(/r\d+$/i);
                    
                    if (isMultiselectBase) {
                      // Check if any response variables have data
                      hasData = variables.some(v => {
                        const match = v.name.match(/^(.+?)r(\d+)$/i);
                        if (match && match[1] === variable.name && v.type?.toLowerCase().includes('multi-select')) {
                          const respVarData = getVariableDataByExpectedHeader(v.name);
                          return respVarData && (
                            (respVarData.count && respVarData.count > 0) ||
                            (respVarData.frequencies && Object.keys(respVarData.frequencies || {}).length > 0) ||
                            (respVarData.values && Array.isArray(respVarData.values) && respVarData.values.length > 0)
                          );
                        }
                        return false;
                      });
                  } else {
                    // For regular variables (including numeric list variables), check the variable itself
                    // For numeric variables, also check for sum and mean which indicate data exists
                    hasData = varData && (
                      (varData.count && varData.count > 0) ||
                      (varData.frequencies && Object.keys(varData.frequencies || {}).length > 0) ||
                      (varData.values && Array.isArray(varData.values) && varData.values.length > 0) ||
                      (varData.sum !== undefined) ||
                      (varData.mean !== undefined)
                    );
                    }
                  }

                  // Check for scale summary variables (T2B, M3B, B2B)
                  if ((variable as any).isScaleSummary && variable.statements) {
                    // Check if any statement variables have data
                    const scaleMatch = variable.name.match(/^([A-Z0-9]+)_(T2B|M3B|B2B)$/i);
                    if (scaleMatch) {
                      const baseName = scaleMatch[1];
                      hasData = Object.keys(variable.statements).some((stmtCode) => {
                        const statementVarName = `${baseName}${stmtCode}`;
                        const expectedHeader = `Q${statementVarName}`;
                        const statementData = getVariableDataByExpectedHeader(expectedHeader);

                        if (!statementData) return false;

                        // Check if statement has frequencies or values
                        const hasFrequencies = statementData.frequencies &&
                          Object.keys(statementData.frequencies).length > 0;
                        const hasValues = statementData.values &&
                          Array.isArray(statementData.values) &&
                          statementData.values.length > 0;

                        return hasFrequencies || hasValues;
                      });
                    }
                  }

                  return (
                      <div className="space-y-6">
                        {/* Variable Header */}
                    <div>
                        <div className="flex items-center justify-between gap-2 flex-wrap w-full">
                        <div className="flex items-center gap-2 flex-wrap">
                        <h3 className="text-lg font-semibold text-gray-900">
                          {(() => {
                            // Check if this is a numeric list summary table (e.g., S14B_c1_Summary)
                            const columnSummaryMatch = variable.name.match(/^([A-Z0-9]+)_(c\d+)_Summary$/i);
                            if (columnSummaryMatch && (variable as any).isSummaryTable) {
                              const baseQuestionNumber = columnSummaryMatch[1];
                              const columnCode = columnSummaryMatch[2]; // e.g., "c1"
                              
                              // Check if this is a numeric list (not a numeric grid)
                              const question = questionnaireQuestions.find(q => {
                                const qNum = q.number || q.id;
                                return qNum === baseQuestionNumber || 
                                       qNum === baseQuestionNumber.replace(/^Q/, '') ||
                                       String(qNum) === String(baseQuestionNumber);
                              });
                              
                              const isNumericList = question?.type?.toLowerCase().includes('numeric list');
                              
                              if (isNumericList) {
                                // For numeric lists, check if it has "%" tag to determine label
                                const hasPercentTag = (variable as any).tags && Array.isArray((variable as any).tags) && (variable as any).tags.includes('%');
                                // For numeric lists with "%" tag, show as "{baseQuestionNumber}_Mean Summary"
                                // Otherwise show as "{baseQuestionNumber}_Summary"
                                return hasPercentTag ? `${baseQuestionNumber}_Mean Summary` : `${baseQuestionNumber}_Summary`;
                              }
                              
                              // For numeric grids, show column name
                              if (question && question.responseOptions && Array.isArray(question.responseOptions)) {
                                // Extract column number from code (e.g., "c1" -> 1)
                                const colNumMatch = columnCode.match(/c(\d+)/i);
                                if (colNumMatch) {
                                  const colIndex = parseInt(colNumMatch[1]) - 1; // Convert to 0-based index
                                  const responseOption = question.responseOptions[colIndex];
                                  
                                  if (responseOption) {
                                    // Get the text from the response option
                                    const optionText = typeof responseOption === 'string' 
                                      ? responseOption 
                                      : (responseOption.text || responseOption.label || `Column ${colIndex + 1}`);
                                    
                                    return `${baseQuestionNumber} - ${optionText}`;
                                  }
                                }
                              }
                              
                              // Fallback: if we can't find the response option, just show the column code
                              return `${baseQuestionNumber} - ${columnCode}`;
                            }
                            
                            // For all other variables, show the name as-is
                            return variable.name;
                          })()}
                        </h3>
                        {/* Eye icon to toggle visibility in banners */}
                        <button
                          onClick={() => {
                            setHiddenFromBanners(prev => {
                              const newSet = new Set(prev);
                              if (newSet.has(variable.name)) {
                                newSet.delete(variable.name);
                              } else {
                                newSet.add(variable.name);
                              }
                              return newSet;
                            });
                          }}
                          className="flex items-center justify-center text-gray-400 hover:text-gray-600 transition-colors"
                          title={hiddenFromBanners.has(variable.name) ? "Show in banners" : "Hide from banners"}
                        >
                          {hiddenFromBanners.has(variable.name) ? (
                            <EyeSlashIcon className="h-5 w-5" />
                          ) : (
                            <EyeIcon className="h-5 w-5" />
                          )}
                        </button>
                          </div>
                          <div className="flex items-center gap-2 flex-shrink-0">
                            {variable.tags && variable.tags
                              .filter((tag: string) => tag.toLowerCase() !== 'terminate' && tag.toLowerCase() !== 'specify')
                              .map((tag, idx) => (
                              <span
                              key={idx}
                              className="text-xs px-2 py-1 bg-gray-100 text-gray-700 rounded"
                              >
                                {tag}
                              </span>
                            ))}
                            <span className="text-xs px-2 py-1 rounded flex-shrink-0 bg-blue-100 text-blue-800" style={{ minWidth: '80px', textAlign: 'center' }}>
                              {variable.type || 'Unknown'}
                            </span>
                          </div>
                        </div>
                          {variable.description && (
                            <div className="text-sm text-gray-600 mt-1">
                              {(() => {
                                const desc = variable.description;
                                // Check if description contains a newline (for numeric grid individual variables)
                                if (desc.includes('\n')) {
                                  const [questionText, statementText] = desc.split('\n', 2);
                                  return (
                                    <>
                                      <p>{formatDescriptionWithBrackets(questionText)}</p>
                                      <p className="font-bold mt-1">{formatDescriptionWithBrackets(statementText)}</p>
                                    </>
                                  );
                                }
                                return <p>{formatDescriptionWithBrackets(desc)}</p>;
                              })()}
                            </div>
                        )}
                      </div>

                        {/* No Data Warning */}
                        {/* For summary tables, only show if the table below has no data (hasData already checks table rows) */}
                        {/* For other variables, show if the variable itself has no data */}
                        {!hasData && (
                          <div className="bg-red-50 border border-red-200 rounded-lg p-4 flex items-start gap-3">
                            <InformationCircleIcon className="h-5 w-5 text-red-500 flex-shrink-0 mt-0.5" />
                            <div>
                              <h4 className="text-sm font-medium text-red-800 mb-1">No Data Available</h4>
                              <p className="text-sm text-red-700">
                                {((variable as any).isSummaryTable && variable.statements) 
                                  ? 'This summary table has no data. None of the rows contain any values.'
                                  : 'This variable has no data or mapping. This could mean:'}
                              </p>
                              {!((variable as any).isSummaryTable && variable.statements) && (
                                <ul className="text-sm text-red-700 mt-2 list-disc list-inside space-y-1">
                                  <li>The column mapping for this variable was not found in the uploaded data file</li>
                                  <li>No data was extracted for this variable during processing</li>
                                  <li>The variable name in the QNR doesn't match the column headers in your data file</li>
                                </ul>
                              )}
                      </div>
                          </div>
                        )}

                        {/* Statistics section for numeric questions */}
                        {/* Exclude statistics for numeric list summary tables - they show stats in the table instead */}
                        {variable.type?.toLowerCase().includes('numeric') && 
                         !variable.type?.toLowerCase().includes('grid') && 
                         !(variable.type?.toLowerCase().includes('numeric list') && (variable as any).isSummaryTable) && (
                        <div className="mb-4">
                                  {(() => {
                              const varData = getVariableDataByExpectedHeader(variable.name);
                              const hasNumberTag = (variable as any).tags && Array.isArray((variable as any).tags) && (variable as any).tags.includes('Number');
                              // Check if this is a numeric grid statement variable (name pattern: {questionNumber}_{r|c}{number})
                              const isNumericGridStatement = /^[A-Z0-9]+_[rc]\d+$/i.test(variable.name);
                              const showSumBoxes = hasNumberTag && isNumericGridStatement;
                              
                              return (
                                <div className="space-y-4">
                                  {/* First row: Mean and Sum boxes */}
                                  <div className="flex flex-wrap gap-4">
                                    <div className="flex-1 min-w-[120px] border border-gray-200 rounded-lg p-4 bg-white text-center">
                                      <p className="text-xs text-gray-500 mb-2">Mean</p>
                                      <p className="text-sm font-semibold text-gray-900">
                                        {varData?.mean !== undefined ? varData.mean.toFixed(2) : '-'}
                                      </p>
                                    </div>
                                    <div className="flex-1 min-w-[120px] border border-gray-200 rounded-lg p-4 bg-white text-center">
                                      <p className="text-xs text-gray-500 mb-2">
                                        Mean <span className="italic">(Outliers Removed)</span> <span className="text-red-600">*</span>
                                      </p>
                                      <p className="text-sm font-semibold text-gray-900">
                                        {varData?.meanNoOutliers !== undefined && varData.meanNoOutliers !== null ? varData.meanNoOutliers.toFixed(2) : '-'}
                                      </p>
                                    </div>
                                    {showSumBoxes && (
                                      <>
                                        <div className="flex-1 min-w-[120px] border border-gray-200 rounded-lg p-4 bg-white text-center">
                                          <p className="text-xs text-gray-500 mb-2">Sum</p>
                                          <p className="text-sm font-semibold text-gray-900">
                                            {varData?.sum !== undefined ? varData.sum.toFixed(0) : '-'}
                                          </p>
                                        </div>
                                        <div className="flex-1 min-w-[120px] border border-gray-200 rounded-lg p-4 bg-white text-center">
                                          <p className="text-xs text-gray-500 mb-2">
                                            Sum <span className="italic">(Outliers Removed)</span> <span className="text-red-600">*</span>
                                          </p>
                                          <p className="text-sm font-semibold text-gray-900">
                                            {varData?.sumNoOutliers !== undefined && varData.sumNoOutliers !== null ? varData.sumNoOutliers.toFixed(0) : '-'}
                                          </p>
                                        </div>
                                      </>
                                    )}
                                  </div>
                                  {/* Second row: Other stats */}
                                  <div className="flex flex-wrap gap-4">
                                    <div className="flex-1 min-w-[120px] border border-gray-200 rounded-lg p-4 bg-white text-center">
                                      <p className="text-xs text-gray-500 mb-2">Median</p>
                                      <p className="text-sm font-semibold text-gray-900">
                                        {varData?.median !== undefined ? varData.median.toFixed(2) : '-'}
                                      </p>
                                    </div>
                                    <div className="flex-1 min-w-[120px] border border-gray-200 rounded-lg p-4 bg-white text-center">
                                      <p className="text-xs text-gray-500 mb-2">Mode</p>
                                      <p className="text-sm font-semibold text-gray-900">
                                        {varData?.mode !== undefined ? varData.mode.toFixed(2) : '-'}
                                      </p>
                                    </div>
                                    <div className="flex-1 min-w-[120px] border border-gray-200 rounded-lg p-4 bg-white text-center">
                                      <p className="text-xs text-gray-500 mb-2">Std Dev</p>
                                      <p className="text-sm font-semibold text-gray-900">
                                        {varData?.stdDev !== undefined ? varData.stdDev.toFixed(2) : 
                                         varData?.stddev !== undefined ? varData.stddev.toFixed(2) :
                                         varData?.standardDeviation !== undefined ? varData.standardDeviation.toFixed(2) :
                                         varData?.sd !== undefined ? varData.sd.toFixed(2) : '-'}
                                      </p>
                                    </div>
                                    <div className="flex-1 min-w-[120px] border border-gray-200 rounded-lg p-4 bg-white text-center">
                                      <p className="text-xs text-gray-500 mb-2">Low</p>
                                      <p className="text-sm font-semibold text-gray-900">
                                        {varData?.min !== undefined ? varData.min.toFixed(2) : '-'}
                                      </p>
                                    </div>
                                    <div className="flex-1 min-w-[120px] border border-gray-200 rounded-lg p-4 bg-white text-center">
                                      <p className="text-xs text-gray-500 mb-2">High</p>
                                      <p className="text-sm font-semibold text-gray-900">
                                        {varData?.max !== undefined ? varData.max.toFixed(2) : '-'}
                                      </p>
                                    </div>
                                  </div>
                                </div>
                              );
                                  })()}
                              </div>
                            )}

                        {/* Statement table for numeric grid column variables (e.g., S11_c1, S14_c1) - shows all statements (rows) for this column */}
                        {(() => {
                          const hasNumeric = variable.type?.toLowerCase().includes('numeric');
                          const hasGrid = variable.type?.toLowerCase().includes('grid');
                          const conditionMatches = hasNumeric && !hasGrid;
                          const columnMatch = variable.name.match(/^([A-Z0-9]+)_(c\d+)$/i);
                          
                          // Check if this is a numeric list variable (pattern: {baseNumber}_{number} like S14B_1)
                          // Numeric list variables should NOT go through this column variable table logic
                          const numericListMatch = variable.name.match(/^([A-Z0-9]+)_(\d+)$/i);
                          const isNumericList = numericListMatch && !columnMatch;
                          
                          // Check if the question type is numeric list
                          const question = questionnaireQuestions.find(q => {
                            const qNum = q.number || q.id;
                            const baseNumber = numericListMatch ? numericListMatch[1] : '';
                            return qNum === baseNumber || qNum === baseNumber.replace(/^Q/, '');
                          });
                          const questionIsNumericList = question?.type?.toLowerCase().includes('numeric list');
                          // Exclude numeric list variables from this check - they should display as regular numeric variables
                          if (!conditionMatches || !columnMatch || isNumericList || questionIsNumericList) {
                            return null;
                          }
                          
                          // Check if this is a numeric grid column variable (pattern: {questionNumber}_c{number})
                          {
                            const baseName = columnMatch[1];
                            const columnCode = columnMatch[2]; // This includes the "c" prefix (e.g., "c1")
                            
                            // Check if there's a summary table for this column (e.g., S4_c1_Summary)
                            // If so, skip rendering this column variable table since the summary table is already shown
                            const meanSummaryTableName = `${baseName}_${columnCode}_Summary`;
                            const hasMeanSummaryTable = filteredVariables.some((v: any) => 
                              v.name === meanSummaryTableName && (v as any).isSummaryTable
                            ) || variables.some((v: any) => 
                              v.name === meanSummaryTableName && (v as any).isSummaryTable
                            );
                            
                            if (hasMeanSummaryTable) {
                              // Don't render the column variable table if a mean summary table exists
                              return null;
                            }
                            
                            // Find the main grid variable to get statements
                            const mainGridVar = variables.find((v: any) => v.name === baseName && v.type?.toLowerCase().includes('numeric grid'));
                            
                            if (mainGridVar && mainGridVar.statements) {
                              
                              const matchingKeys = Object.keys(variableData).filter(key => 
                                key.toLowerCase().includes(baseName.toLowerCase())
                              );
                              
                              // The data is likely stored in statement variables (S11_r1, S11_r2, etc.)
                              // Each statement variable should have frequencies keyed by column codes (c1, c2, c3)
                              // OR the data might be in cell variables (S11_r1_c1, S11_r1_c2, etc.)
                              
                              // Build table showing all statements (rows) for this column
                              const statementRows = Object.entries(mainGridVar.statements).map(([stmtCode, stmtText]) => {
                                let value: number | undefined = undefined;
                                
                                
                                // Strategy 1: Check if statement variable exists (S11r1) and has frequencies with column code
                                const statementVarName = `${baseName}${stmtCode}`;
                                const expectedHeader = `Q${statementVarName}`;
                                const statementVarData = getVariableDataByExpectedHeader(expectedHeader);

                                if (statementVarData && statementVarData.frequencies) {
                                  // Try to find the column code in frequencies
                                  if (statementVarData.frequencies[columnCode] !== undefined) {
                                    value = statementVarData.frequencies[columnCode];
                                  } else {
                                    // Try without "c" prefix (c1 -> 1)
                                    const colCodeWithoutPrefix = columnCode.replace(/^c/i, '');
                                    if (statementVarData.frequencies[colCodeWithoutPrefix] !== undefined) {
                                      value = statementVarData.frequencies[colCodeWithoutPrefix];
                                    }
                                  }
                                }
                                
                                // Strategy 1b: If statement variable has sum/mean, use that as a fallback
                                // This happens when the Excel file has columns like S11_r1 (not S11_r1_c1, S11_r1_c2, etc.)
                                // In this case, each statement variable contains aggregated data for all columns
                                if (value === undefined && statementVarData) {
                                  // For numeric grids with columns, if we don't have cell-specific data,
                                  // we can't show column-specific values. But we can show the aggregated value
                                  // as a fallback to indicate there is data
                                  if (statementVarData.sum !== undefined) {
                                    // Use sum as a fallback - this represents the total across all columns for this statement
                                    value = statementVarData.sum;
                                  } else if (statementVarData.mean !== undefined) {
                                    // Use mean as a fallback
                                    value = statementVarData.mean;
                                  } else if (statementVarData.values && Array.isArray(statementVarData.values)) {
                                    // Calculate from values array
                                    const numericValues = statementVarData.values
                                      .map((v: any) => parseFloat(v))
                                      .filter((v: number) => !isNaN(v));
                                    
                                    if (numericValues.length > 0) {
                                      // Sum all values for this statement (represents total across all columns)
                                      value = numericValues.reduce((sum: number, val: number) => sum + val, 0);
                                    }
                                  }
                                }
                                
                                // Strategy 2: Try cell variable formats (QS11r1c1, etc.)
                                if (value === undefined) {
                                  // Construct the expected header format (e.g., QS11r1c1)
                                  const expectedHeader = `Q${baseName}${stmtCode}${columnCode}`;
                                  
                                  
                                  const cellData = getVariableDataByExpectedHeader(expectedHeader);
                                  if (cellData) {
                                    if (cellData.sum !== undefined) {
                                      value = cellData.sum;
                                    } else if (cellData.mean !== undefined) {
                                      value = cellData.mean;
                                    } else if (cellData.values && Array.isArray(cellData.values) && cellData.values.length > 0) {
                                      // Sum up all numeric values
                                      value = cellData.values.reduce((sum: number, val: any) => {
                                        const numVal = parseFloat(val);
                                        return sum + (isNaN(numVal) ? 0 : numVal);
                                      }, 0);
                                    } else if (cellData.count !== undefined && cellData.count > 0) {
                                      // Use count as value if it's a frequency count
                                      value = cellData.count;
                                    }
                                  }
                                  
                                  if (value === undefined) {
                                  }
                                }
                                
                                // Strategy 3: Check if column variable exists (S11_c1) with statement codes as keys
                                if (value === undefined) {
                                  const columnVarData = getVariableDataByExpectedHeader(variable.name);

                                  if (columnVarData && columnVarData.frequencies) {
                                    if (columnVarData.frequencies[stmtCode] !== undefined) {
                                      value = columnVarData.frequencies[stmtCode];
                                    } else {
                                      const codeWithoutPrefix = stmtCode.replace(/^[rc]/i, '');
                                      if (columnVarData.frequencies[codeWithoutPrefix] !== undefined) {
                                        value = columnVarData.frequencies[codeWithoutPrefix];
                                      }
                                    }
                                  }
                                  
                                  // Also check mapped column name
                                  if (value === undefined) {
                                    // Convert to expected header format and get mapped column name
                                    const expectedHeader = variable.name.startsWith('Q') ? variable.name : `Q${variable.name}`;
                                    let mappedColumnName = columnMapping[expectedHeader];
                                    if (!mappedColumnName) {
                                      mappedColumnName = columnMapping[variable.name];
                                    }
                                    if (mappedColumnName) {
                                      const mappedColumnVarData = variableData[mappedColumnName];
                                      if (mappedColumnVarData && mappedColumnVarData.frequencies) {
                                        if (mappedColumnVarData.frequencies[stmtCode] !== undefined) {
                                          value = mappedColumnVarData.frequencies[stmtCode];
                                        } else {
                                          const codeWithoutPrefix = stmtCode.replace(/^[rc]/i, '');
                                          if (mappedColumnVarData.frequencies[codeWithoutPrefix] !== undefined) {
                                            value = mappedColumnVarData.frequencies[codeWithoutPrefix];
                                          }
                                        }
                                      }
                                    }
                                  }
                                }
                                
                                if (value !== undefined) {
                                } else {
                                }
                                
                                return {
                                  code: stmtCode,
                                  text: stmtText,
                                  value: value
                                };
                              });
                              
                              // Check if any rows have data
                              const hasData = statementRows.some(row => row.value !== undefined);
                              
                              if (!hasData) return null;
                              
                              return (
                                <div className="mt-4 bg-white border border-gray-200 rounded-lg overflow-hidden">
                                  <div className="overflow-x-auto">
                                    <table className="min-w-full divide-y divide-gray-200">
                                      <thead className="bg-gray-50">
                                        <tr>
                                          <th colSpan={2} className="px-4 py-2 text-left text-sm font-semibold text-gray-900">Statements (Rows)</th>
                                          <th className="px-4 py-2 text-center text-xs font-medium text-gray-500 uppercase tracking-wider whitespace-nowrap" style={{ width: '5rem' }}>Value</th>
                                        </tr>
                                      </thead>
                                      <tbody className="bg-white divide-y divide-gray-200">
                                        {statementRows.map((row) => {
                                          const displayCode = row.code.replace(/^[rc]/i, '');
                                          return (
                                            <tr key={row.code}>
                                              <td className="px-2 py-2 text-sm font-mono text-gray-700 text-center" style={{ width: '2.5rem' }}>{displayCode}</td>
                                              <td className="px-4 py-2 text-sm text-gray-900">{row.text}</td>
                                              <td className="px-4 py-2 text-sm text-gray-900 text-center" style={{ width: '5rem' }}>
                                                {row.value !== undefined ? row.value.toFixed(0) : '-'}
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
                            
                            return null;
                          }
                        })()}

                        {/* Frequency table for numeric variables (both numeric grid statements and regular numeric questions) */}
                        {variable.type?.toLowerCase().includes('numeric') && !variable.type?.toLowerCase().includes('grid') && (() => {
                          // Show frequency table for:
                          // 1. Numeric grid row variables (name pattern: {questionNumber}_r{number}) - rows
                          // 2. Numeric grid column variables (name pattern: {questionNumber}_c{number}) - columns
                          // 3. Regular numeric questions (name pattern: just {questionNumber}, no underscore)
                          const isNumericGridRow = /^[A-Z0-9]+_r\d+$/i.test(variable.name);
                          const isNumericGridColumn = /^[A-Z0-9]+_c\d+$/i.test(variable.name);
                          const isRegularNumeric = /^[A-Z0-9]+$/i.test(variable.name) && !variable.name.includes('_');
                          
                          if (!isNumericGridRow && !isNumericGridColumn && !isRegularNumeric) return null;
                          
                          const varData = getVariableDataByExpectedHeader(variable.name);
                          if (!varData) return null;
                          
                          // Build frequency distribution from values array or frequencies object
                          const frequencyMap = new Map<number, number>();
                          let totalCount = 0;
                          
                          // Try to get frequencies from frequencies object first
                          if (varData.frequencies && typeof varData.frequencies === 'object') {
                            Object.entries(varData.frequencies).forEach(([key, count]) => {
                              // Try to parse the key as a number
                              const numKey = parseFloat(key);
                              if (!isNaN(numKey) && typeof count === 'number' && count > 0) {
                                frequencyMap.set(numKey, (frequencyMap.get(numKey) || 0) + count);
                                totalCount += count;
                              }
                            });
                          }
                          
                          // If no frequencies found, calculate from values array
                          if (frequencyMap.size === 0 && Array.isArray(varData.values)) {
                            varData.values.forEach((val: any) => {
                              const numVal = parseFloat(val);
                              if (!isNaN(numVal)) {
                                frequencyMap.set(numVal, (frequencyMap.get(numVal) || 0) + 1);
                                totalCount++;
                              }
                            });
                          }
                          
                          // Only show if we have data
                          if (frequencyMap.size === 0) return null;
                          
                          // Calculate base size (sample size) - count all people who saw the question
                          let baseSize = 0;
                          if (varData.values && Array.isArray(varData.values)) {
                            // Count all non-blank values
                            baseSize = varData.values.filter((v: any) => {
                              return v !== null && v !== undefined && v !== '' && String(v).trim() !== '';
                            }).length;
                          } else if (varData.count !== undefined) {
                            baseSize = varData.count;
                          } else if (varData.frequencies) {
                            baseSize = Object.values(varData.frequencies).reduce((sum: number, count: any) => {
                              return sum + (typeof count === 'number' ? count : 0);
                            }, 0);
                          }
                          
                          // Calculate mean and stdDev to identify outliers
                          const mean = varData.mean;
                          const stdDev = varData.stdDev || varData.stddev || varData.standardDeviation || varData.sd;
                          
                          // Sort by numeric value
                          const sortedFrequencies = Array.from(frequencyMap.entries())
                            .sort((a, b) => a[0] - b[0]);
                          
                          return (
                            <div className="mt-4">
                              {/* Sample Size */}
                              {baseSize > 0 && (
                                <p className="mb-4 text-sm text-gray-700">
                                  <span className="font-semibold">Sample Size:</span> <span className="font-semibold">{baseSize.toLocaleString()}</span>
                                </p>
                              )}
                              
                              <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
                              <div className="overflow-x-auto">
                                <table className="min-w-full divide-y divide-gray-200">
                                  <thead className="bg-gray-50">
                                    <tr>
                                      <th colSpan={2} className="px-4 py-2 text-left text-sm font-semibold text-gray-900">Frequency Distribution</th>
                                      <th className="px-4 py-2 text-center text-xs font-medium text-gray-500 uppercase tracking-wider whitespace-nowrap" style={{ width: '5rem' }}>Count</th>
                                      <th className="px-4 py-2 text-center text-xs font-medium text-gray-500 uppercase tracking-wider whitespace-nowrap" style={{ width: '5rem' }}>%</th>
                                    </tr>
                                  </thead>
                                  <tbody className="bg-white divide-y divide-gray-200">
                                    {sortedFrequencies.map(([value, count]) => {
                                      const percent = totalCount > 0 ? ((count / totalCount) * 100) : 0;
                                      // Display value as integer if it's a whole number, otherwise show with decimals
                                      const displayValue = Number.isInteger(value) ? Math.round(value) : value;
                                      
                                      // Check if this value is an outlier (outside 2 standard deviations from mean)
                                      const isOutlier = mean !== undefined && stdDev !== undefined && 
                                        Math.abs(value - mean) > 2 * stdDev;
                                      
                                      return (
                                        <tr key={value}>
                                          <td className="px-2 py-2 text-sm font-mono text-gray-700 text-center" style={{ width: '2.5rem' }}>
                                            {displayValue}
                                            {isOutlier && <span className="text-red-600 ml-1">*</span>}
                                          </td>
                                          <td className="px-4 py-2 text-sm text-gray-900"></td>
                                          <td className="px-4 py-2 text-sm text-gray-900 text-center" style={{ width: '5rem' }}>{count}</td>
                                          <td className="px-4 py-2 text-sm text-gray-900 text-center" style={{ width: '5rem' }}>{percent.toFixed(1)}%</td>
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

                        {/* Scale Summary Tables (T2B, M3B, B2B) */}
                        {(variable as any).isScaleSummary && variable.statements && (
                          <div>
                            <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
                              <div className="overflow-x-auto">
                                <table className="min-w-full divide-y divide-gray-200">
                                  <thead className="bg-gray-50">
                                    <tr>
                                      <th colSpan={2} className="px-4 py-2 text-left text-sm font-semibold text-gray-900">
                                        {variable.name.includes('_T2B') ? 'Top 2 Box (T2B)' :
                                         variable.name.includes('_M3B') ? 'Middle 3 Box (M3B)' :
                                         variable.name.includes('_B2B') ? 'Bottom 2 Box (B2B)' : 'Scale Summary'}
                                      </th>
                                      <th className="px-4 py-2 text-center text-xs font-medium text-gray-500 uppercase tracking-wider whitespace-nowrap" style={{ width: '5rem' }}>Count</th>
                                      <th className="px-4 py-2 text-center text-xs font-medium text-gray-500 uppercase tracking-wider whitespace-nowrap" style={{ width: '5rem' }}>%</th>
                                    </tr>
                                  </thead>
                                  <tbody className="bg-white divide-y divide-gray-200">
                                    {(() => {
                                      // Extract base name and summary type from variable name (e.g., "C2_T2B" -> baseName: "C2", summaryType: "T2B")
                                      const scaleMatch = variable.name.match(/^([A-Z0-9]+)_(T2B|M3B|B2B)$/i);
                                      if (!scaleMatch) return null;

                                      const baseName = scaleMatch[1];
                                      const summaryType = scaleMatch[2].toUpperCase();

                                      // Build rows for each statement
                                      const rows = Object.entries(variable.statements || {}).map(([stmtCode, stmtText]) => {
                                        const statementVarName = `${baseName}${stmtCode}`;
                                        const expectedHeader = `Q${statementVarName}`;
                                        const statementData = getVariableDataByExpectedHeader(expectedHeader);

                                        if (!statementData) {
                                          return (
                                            <tr key={stmtCode}>
                                              <td className="px-2 py-2 text-sm font-mono text-gray-700 text-center" style={{ width: '2.5rem' }}>{stmtCode.replace(/^[rc]/i, '')}</td>
                                              <td className="px-4 py-2 text-sm text-gray-900">{String(stmtText)}</td>
                                              <td className="px-4 py-2 text-sm text-gray-900 text-center" style={{ width: '5rem' }}>-</td>
                                              <td className="px-4 py-2 text-sm text-gray-900 text-center" style={{ width: '5rem' }}>-</td>
                                            </tr>
                                          );
                                        }

                                        // Generate frequencies if they don't exist
                                        let frequencies = statementData.frequencies;
                                        if (!frequencies && statementData.values && Array.isArray(statementData.values)) {
                                          frequencies = {};
                                          statementData.values.forEach((val: any) => {
                                            if (val !== null && val !== undefined && val !== '') {
                                              const valStr = String(val).trim();
                                              frequencies[valStr] = (frequencies[valStr] || 0) + 1;
                                            }
                                          });
                                        }

                                        if (!frequencies || Object.keys(frequencies).length === 0) {
                                          return (
                                            <tr key={stmtCode}>
                                              <td className="px-2 py-2 text-sm font-mono text-gray-700 text-center" style={{ width: '2.5rem' }}>{stmtCode.replace(/^[rc]/i, '')}</td>
                                              <td className="px-4 py-2 text-sm text-gray-900">{String(stmtText)}</td>
                                              <td className="px-4 py-2 text-sm text-gray-900 text-center" style={{ width: '5rem' }}>-</td>
                                              <td className="px-4 py-2 text-sm text-gray-900 text-center" style={{ width: '5rem' }}>-</td>
                                            </tr>
                                          );
                                        }

                                        // Get frequency counts for each code position
                                        const frequencyEntries = Object.entries(frequencies)
                                          .map(([code, count]) => {
                                            const codeNum = parseInt(code.replace(/^[rc]/i, ''), 10);
                                            return { codeNum, count: count as number };
                                          })
                                          .filter(({ codeNum }) => !isNaN(codeNum))
                                          .sort((a, b) => a.codeNum - b.codeNum);

                                        // Calculate total count
                                        const totalCount = frequencyEntries.reduce((sum, { count }) => sum + count, 0);

                                        // Calculate summary based on type
                                        let summaryCount = 0;
                                        if (summaryType === 'T2B') {
                                          // Top 2 Box (high end: codes 6-7)
                                          summaryCount = frequencyEntries
                                            .filter(({ codeNum }) => codeNum >= 6 && codeNum <= 7)
                                            .reduce((sum, { count }) => sum + count, 0);
                                        } else if (summaryType === 'M3B') {
                                          // Middle 3 Box (codes 3-5)
                                          summaryCount = frequencyEntries
                                            .filter(({ codeNum }) => codeNum >= 3 && codeNum <= 5)
                                            .reduce((sum, { count }) => sum + count, 0);
                                        } else if (summaryType === 'B2B') {
                                          // Bottom 2 Box (low end: codes 1-2)
                                          summaryCount = frequencyEntries
                                            .filter(({ codeNum }) => codeNum >= 1 && codeNum <= 2)
                                            .reduce((sum, { count }) => sum + count, 0);
                                        }

                                        const percentage = totalCount > 0 ? (summaryCount / totalCount) * 100 : 0;

                                        return (
                                          <tr key={stmtCode}>
                                            <td className="px-2 py-2 text-sm font-mono text-gray-700 text-center" style={{ width: '2.5rem' }}>{stmtCode.replace(/^[rc]/i, '')}</td>
                                            <td className="px-4 py-2 text-sm text-gray-900">{String(stmtText)}</td>
                                            <td className="px-4 py-2 text-sm text-gray-900 text-center" style={{ width: '5rem' }}>{summaryCount}</td>
                                            <td className="px-4 py-2 text-sm text-gray-900 text-center" style={{ width: '5rem' }}>{totalCount > 0 ? `${percentage.toFixed(1)}%` : '-'}</td>
                                          </tr>
                                        );
                                      });

                                      return rows;
                                    })()}
                                  </tbody>
                                </table>
                              </div>
                            </div>
                          </div>
                        )}

                        {/* Summary Table for numeric grids */}
                        {(variable as any).isSummaryTable && variable.statements && !variable.name.endsWith('_Summary Tables') && (
                          <div>
                            {(() => {
                              // Calculate sample size: count unique rows (respondents) with at least one non-blank value
                              // For numeric lists, each row in the data file is one respondent
                              // We count how many respondents have at least one non-blank value across all response options
                              const columnMatch = variable.name.match(/^([A-Z0-9]+)_(c\d+)(?:_Summary)?$/i);
                              const baseName = columnMatch ? columnMatch[1] : '';
                              const columnCode = columnMatch ? columnMatch[2] : '';
                              
                              // Collect all values arrays from all rows
                              const allValuesArrays: any[][] = [];
                              let maxLength = 0;
                              
                              Object.entries(variable.statements || {}).forEach(([code]) => {
                                // Normalize the code for numeric lists
                                let normalizedCode = code;
                                if (!/^r\d+/i.test(code) && /^\d+$/.test(code)) {
                                  normalizedCode = `r${code}`;
                                }
                                const expectedHeader = `Q${baseName}${normalizedCode}${columnCode}`;
                                
                                const cellData = getVariableDataByExpectedHeader(expectedHeader);
                                
                                if (cellData && cellData.values && Array.isArray(cellData.values)) {
                                  allValuesArrays.push(cellData.values);
                                  maxLength = Math.max(maxLength, cellData.values.length);
                                }
                              });
                              
                              // Count unique rows (respondents) that have at least one non-blank value
                              let sampleSize = 0;
                              
                              if (allValuesArrays.length > 0 && maxLength > 0) {
                                // For each respondent position (row index)
                                for (let i = 0; i < maxLength; i++) {
                                  // Check if this respondent has at least one non-blank value across all response options
                                  const hasData = allValuesArrays.some(valuesArray => {
                                    if (i < valuesArray.length) {
                                      const value = valuesArray[i];
                                      return value !== null && value !== undefined && value !== '' && String(value).trim() !== '';
                                    }
                                    return false;
                                  });
                                  
                                  if (hasData) {
                                    sampleSize++;
                                  }
                                }
                              }
                              
                              return sampleSize > 0 ? (
                                <p className="mb-4 text-sm text-gray-700">
                                  <span className="font-semibold">Sample Size:</span> <span className="font-semibold">{sampleSize.toLocaleString()}</span>
                                </p>
                              ) : null;
                            })()}
                            <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
                            <div className="overflow-x-auto">
                            <table className="min-w-full divide-y divide-gray-200">
                                <thead className="bg-gray-50">
                                  <tr>
                                    <th colSpan={2} className="px-4 py-2 text-left text-sm font-semibold text-gray-900">Summary Table</th>
                                    <th className="px-4 py-2 text-center text-xs font-medium text-gray-500 uppercase tracking-wider whitespace-nowrap" style={{ width: '5rem' }}>Mean</th>
                                    {((variable as any).tags && Array.isArray((variable as any).tags) && (variable as any).tags.includes('Number')) && (
                                      <>
                                        <th className="px-4 py-2 text-center text-xs font-medium text-gray-500 uppercase tracking-wider whitespace-nowrap" style={{ width: '5rem' }}>Sum</th>
                                        <th className="px-4 py-2 text-center text-xs font-medium text-gray-500 uppercase tracking-wider whitespace-nowrap" style={{ width: '5rem' }}>%</th>
                                      </>
                                    )}
                                  </tr>
                                </thead>
                              <tbody className="bg-white divide-y divide-gray-200">
                                {(() => {
                                  // Extract base name and column code from variable name (e.g., "S11_c1_Summary" -> baseName: "S11", columnCode: "c1")
                                  const columnMatch = variable.name.match(/^([A-Z0-9]+)_(c\d+)(?:_Summary)?$/i);
                                  const baseName = columnMatch ? columnMatch[1] : '';
                                  const columnCode = columnMatch ? columnMatch[2] : '';
                                  const hasNumberTag = (variable as any).tags && Array.isArray((variable as any).tags) && (variable as any).tags.includes('Number');
                                  const hasPercentTag = (variable as any).tags && Array.isArray((variable as any).tags) && (variable as any).tags.includes('%');

                                  // Check if this is a numeric grid (not a numeric list)
                                  const question = questionnaireQuestions.find(q => {
                                    const qNum = q.number || q.id;
                                    return qNum === baseName || 
                                           qNum === baseName.replace(/^Q/, '') ||
                                           String(qNum) === String(baseName);
                                  });
                                  const isNumericGrid = question?.type?.toLowerCase().includes('numeric grid');
                                  const isNumericList = question?.type?.toLowerCase().includes('numeric list');

                                  // Calculate total sum first for percentage calculation
                                  let totalSum = 0;
                                  if (hasNumberTag) {
                                    Object.entries(variable.statements || {}).forEach(([code]) => {
                                      // Construct the expected header (e.g., QS11r1c1)
                                      // For numeric lists, codes might be "1", "2", etc. instead of "r1", "r2"
                                      // Normalize the code to ensure it has "r" prefix
                                      let normalizedCode = code;
                                      if (!/^r\d+/i.test(code) && /^\d+$/.test(code)) {
                                        normalizedCode = `r${code}`;
                                      }
                                      const expectedHeader = `Q${baseName}${normalizedCode}${columnCode}`;
                                      
                                      // Use the helper function to get cell data
                                      const cellData = getVariableDataByExpectedHeader(expectedHeader);
                                      
                                      if (cellData) {
                                        if (cellData.sum !== undefined) {
                                          totalSum += cellData.sum;
                                        } else if (cellData.values && Array.isArray(cellData.values) && cellData.values.length > 0) {
                                          const numericValues = cellData.values
                                            .map((v: any) => parseFloat(v))
                                            .filter((v: number) => !isNaN(v));
                                          if (numericValues.length > 0) {
                                            totalSum += numericValues.reduce((sum: number, val: number) => sum + val, 0);
                                          }
                                        }
                                      }
                                    });
                                  }

                                  // First pass: calculate all means
                                  const rowData = Object.entries(variable.statements || {}).map(([code, text]) => {
                                    const displayCode = code.replace(/^[rc]/i, '');

                                    // Calculate mean and sum for this row
                                    let mean: number | undefined = undefined;
                                    let sum: number | undefined = undefined;

                                    // Construct the expected header (e.g., QS11r1c1)
                                    // For numeric lists, codes might be "1", "2", etc. instead of "r1", "r2"
                                    // Normalize the code to ensure it has "r" prefix
                                    let normalizedCode = code;
                                    if (!/^r\d+/i.test(code) && /^\d+$/.test(code)) {
                                      normalizedCode = `r${code}`;
                                    }
                                    const expectedHeader = `Q${baseName}${normalizedCode}${columnCode}`;
                                    
                                    // Use the helper function to get cell data
                                    const cellData = getVariableDataByExpectedHeader(expectedHeader);

                                    if (cellData) {
                                      // Get mean
                                      if (cellData.mean !== undefined) {
                                        mean = cellData.mean;
                                      } else if (cellData.values && Array.isArray(cellData.values) && cellData.values.length > 0) {
                                        // Calculate mean from values
                                        const numericValues = cellData.values
                                          .map((v: any) => parseFloat(v))
                                          .filter((v: number) => !isNaN(v));
                                        if (numericValues.length > 0) {
                                          mean = numericValues.reduce((sum: number, val: number) => sum + val, 0) / numericValues.length;
                                        }
                                      }

                                      // Get sum
                                      if (cellData.sum !== undefined) {
                                        sum = cellData.sum;
                                      } else if (cellData.values && Array.isArray(cellData.values) && cellData.values.length > 0) {
                                        // Calculate sum from values
                                        const numericValues = cellData.values
                                          .map((v: any) => parseFloat(v))
                                          .filter((v: number) => !isNaN(v));
                                        if (numericValues.length > 0) {
                                          sum = numericValues.reduce((sumAcc: number, val: number) => sumAcc + val, 0);
                                        }
                                      }
                                    }

                                    return { code, text, displayCode, mean, sum };
                                  });

                                  // Calculate sum of means
                                  let sumOfMeans = 0;
                                  rowData.forEach(row => {
                                    if (row.mean !== undefined) {
                                      sumOfMeans += row.mean;
                                    }
                                  });

                                  // Normalize means for numeric grids with "%" tag so they sum to 100%
                                  let normalizationFactor = 1;
                                  if (hasPercentTag && isNumericGrid && sumOfMeans > 0) {
                                    normalizationFactor = 100 / sumOfMeans;
                                  }

                                  // Second pass: render rows with normalized means
                                  const rows = rowData.map(({ code, text, displayCode, mean, sum }) => {
                                    // Apply normalization to mean if needed
                                    const normalizedMean = mean !== undefined && hasPercentTag && isNumericGrid
                                      ? mean * normalizationFactor
                                      : mean;

                                    // Calculate percentage
                                    const rowPercentage = hasNumberTag && totalSum > 0 && sum !== undefined
                                      ? (sum / totalSum) * 100
                                      : undefined;

                                    return (
                                      <tr key={code}>
                                        <td className="px-2 py-2 text-sm font-mono text-gray-700 text-center" style={{ width: '2.5rem' }}>{displayCode}</td>
                                        <td className="px-4 py-2 text-sm text-gray-900">{text}</td>
                                        <td className="px-4 py-2 text-sm text-gray-900 text-center" style={{ width: '5rem' }}>
                                          {normalizedMean !== undefined
                                            ? (hasPercentTag ? `${normalizedMean.toFixed(1)}%` : normalizedMean.toFixed(2))
                                            : '-'}
                                        </td>
                                        {hasNumberTag && (
                                          <>
                                            <td className="px-4 py-2 text-sm text-gray-900 text-center" style={{ width: '5rem' }}>
                                              {sum !== undefined ? sum.toFixed(0) : '-'}
                                            </td>
                                            <td className="px-4 py-2 text-sm text-gray-900 text-center" style={{ width: '5rem' }}>
                                              {rowPercentage !== undefined ? `${rowPercentage.toFixed(1)}%` : '-'}
                                            </td>
                                          </>
                                        )}
                                      </tr>
                                    );
                                  });

                                  return rows;
                                })()}
                                {/* Total row */}
                                {(() => {
                                  const columnMatch = variable.name.match(/^([A-Z0-9]+)_(c\d+)(?:_Summary)?$/i);
                                  const baseName = columnMatch ? columnMatch[1] : '';
                                  const columnCode = columnMatch ? columnMatch[2] : '';
                                  const hasNumberTag = (variable as any).tags && Array.isArray((variable as any).tags) && (variable as any).tags.includes('Number');
                                  const hasPercentTag = (variable as any).tags && Array.isArray((variable as any).tags) && (variable as any).tags.includes('%');

                                  // Check if this is a numeric grid (not a numeric list)
                                  const question = questionnaireQuestions.find(q => {
                                    const qNum = q.number || q.id;
                                    return qNum === baseName || 
                                           qNum === baseName.replace(/^Q/, '') ||
                                           String(qNum) === String(baseName);
                                  });
                                  const isNumericGrid = question?.type?.toLowerCase().includes('numeric grid');

                                  // Calculate totals
                                  let totalSum = 0;
                                  let sumOfMeans = 0;

                                  Object.entries(variable.statements || {}).forEach(([code]) => {
                                    // Construct the expected header (e.g., QS11r1c1)
                                    // For numeric lists, codes might be "1", "2", etc. instead of "r1", "r2"
                                    // Normalize the code to ensure it has "r" prefix
                                    let normalizedCode = code;
                                    if (!/^r\d+/i.test(code) && /^\d+$/.test(code)) {
                                      normalizedCode = `r${code}`;
                                    }
                                    const expectedHeader = `Q${baseName}${normalizedCode}${columnCode}`;
                                    
                                    // Use the helper function to get cell data
                                    const cellData = getVariableDataByExpectedHeader(expectedHeader);
                                    
                                    if (cellData) {
                                      // Sum up means
                                      if (cellData.mean !== undefined) {
                                        sumOfMeans += cellData.mean;
                                      } else if (cellData.values && Array.isArray(cellData.values) && cellData.values.length > 0) {
                                        const numericValues = cellData.values
                                          .map((v: any) => parseFloat(v))
                                          .filter((v: number) => !isNaN(v));
                                        if (numericValues.length > 0) {
                                          sumOfMeans += numericValues.reduce((sum: number, val: number) => sum + val, 0) / numericValues.length;
                                        }
                                      }

                                      // Sum up totals
                                      if (cellData.sum !== undefined) {
                                        totalSum += cellData.sum;
                                      } else if (cellData.values && Array.isArray(cellData.values) && cellData.values.length > 0) {
                                        const numericValues = cellData.values
                                          .map((v: any) => parseFloat(v))
                                          .filter((v: number) => !isNaN(v));
                                        if (numericValues.length > 0) {
                                          totalSum += numericValues.reduce((sum: number, val: number) => sum + val, 0);
                                        }
                                      }
                                    }
                                  });

                                  // Normalize sumOfMeans for numeric grids with "%" tag so it equals 100%
                                  let normalizedSumOfMeans = sumOfMeans;
                                  if (hasPercentTag && isNumericGrid && sumOfMeans > 0) {
                                    normalizedSumOfMeans = 100;
                                  }

                                  return (
                                    <tr className="bg-gray-50 font-semibold border-t-2 border-gray-300">
                                      <td className="px-2 py-2 text-sm text-gray-900" colSpan={2}>Total</td>
                                      <td className="px-4 py-2 text-sm text-gray-900 text-center" style={{ width: '5rem' }}>
                                        {normalizedSumOfMeans > 0
                                          ? (hasPercentTag ? `${normalizedSumOfMeans.toFixed(1)}%` : normalizedSumOfMeans.toFixed(2))
                                          : '-'}
                                      </td>
                                      {hasNumberTag && (
                                        <>
                                          <td className="px-4 py-2 text-sm text-gray-900 text-center" style={{ width: '5rem' }}>
                                            {totalSum > 0 ? totalSum.toFixed(0) : '-'}
                                          </td>
                                          <td className="px-4 py-2 text-sm text-gray-900 text-center" style={{ width: '5rem' }}>
                                            {totalSum > 0 ? '100.0%' : '-'}
                                          </td>
                                        </>
                                      )}
                                    </tr>
                                  );
                                })()}
                              </tbody>
                            </table>
                          </div>
                          </div>
                        </div>
                      )}

                        {/* Summary Table with Outliers Removed for numeric grids */}
                        {(variable as any).isSummaryTable && variable.statements && !(variable as any).isScaleSummary && (() => {
                          // For summary tables, extract base question number (remove "_Summary" suffix)
                          const baseName = variable.name.endsWith('_Summary') 
                            ? variable.name.replace('_Summary', '') 
                            : variable.name;
                          
                          // Check if any statement variables have meanNoOutliers data
                          const hasNoOutliersData = Object.keys(variable.statements || {}).some((stmtCode) => {
                            const statementVarName = `${baseName}${stmtCode}`;
                            const expectedHeader = `Q${statementVarName}`;
                            const statementData = getVariableDataByExpectedHeader(expectedHeader);
                            return statementData && statementData.meanNoOutliers !== undefined && statementData.meanNoOutliers !== null;
                          });
                          
                          if (!hasNoOutliersData) return null;
                          
                          return (
                            <div className="mt-4 bg-white border border-gray-200 rounded-lg overflow-hidden">
                              <div className="overflow-x-auto">
                                <table className="min-w-full divide-y divide-gray-200">
                                  <thead className="bg-gray-50">
                                    <tr>
                                      <th colSpan={2} className="px-4 py-2 text-left text-sm font-semibold text-gray-900">
                                        Summary Table (Outliers Removed) <span className="text-red-600">*</span>
                                      </th>
                                      <th className="px-4 py-2 text-center text-xs font-medium text-gray-500 uppercase tracking-wider whitespace-nowrap" style={{ width: '5rem' }}>Mean</th>
                                      {((variable as any).tags && Array.isArray((variable as any).tags) && (variable as any).tags.includes('Number')) && (
                                        <>
                                          <th className="px-4 py-2 text-center text-xs font-medium text-gray-500 uppercase tracking-wider whitespace-nowrap" style={{ width: '5rem' }}>Sum</th>
                                          <th className="px-4 py-2 text-center text-xs font-medium text-gray-500 uppercase tracking-wider whitespace-nowrap" style={{ width: '5rem' }}>%</th>
                                        </>
                                      )}
                                    </tr>
                                  </thead>
                                  <tbody className="bg-white divide-y divide-gray-200">
                                    {(() => {
                                      // Calculate total sumNoOutliers for numeric summary tables BEFORE rendering rows (for percentage base)
                                      const hasNumberTag = (variable as any).tags && Array.isArray((variable as any).tags) && (variable as any).tags.includes('Number');
                                      const hasPercentTag = (variable as any).tags && Array.isArray((variable as any).tags) && (variable as any).tags.includes('%');
                                      
                                      // Check if this is a numeric grid (not a numeric list)
                                      const columnMatch = variable.name.match(/^([A-Z0-9]+)_(c\d+)(?:_Summary)?$/i);
                                      const baseQuestionNumber = columnMatch ? columnMatch[1] : '';
                                      const question = questionnaireQuestions.find(q => {
                                        const qNum = q.number || q.id;
                                        return qNum === baseQuestionNumber || 
                                               qNum === baseQuestionNumber.replace(/^Q/, '') ||
                                               String(qNum) === String(baseQuestionNumber);
                                      });
                                      const isNumericGrid = question?.type?.toLowerCase().includes('numeric grid');
                                      
                                      let totalSumNoOutliersForPercentage = 0;
                                      
                                      if (hasNumberTag) {
                                        Object.keys(variable.statements || {}).forEach((stmtCode) => {
                                          const statementVarName = `${baseName}${stmtCode}`;
                                          const expectedHeader = `Q${statementVarName}`;
                                          const statementData = getVariableDataByExpectedHeader(expectedHeader);
                                          if (statementData && statementData.sumNoOutliers !== undefined && statementData.sumNoOutliers !== null) {
                                            totalSumNoOutliersForPercentage += statementData.sumNoOutliers;
                                          }
                                        });
                                      }
                                      
                                      // First pass: collect all meanNoOutliers values
                                      const rowDataNoOutliers = Object.entries(variable.statements || {}).map(([code, text]) => {
                                        const displayCode = code.replace(/^[rc]/i, '');
                                        const statementVarName = `${baseName}${code}`;
                                        const expectedHeader = `Q${statementVarName}`;
                                        const statementData = variableData[expectedHeader] || variableData[statementVarName];
                                        
                                        if (!statementData) {
                                          return { code, text, displayCode, meanNoOutliers: undefined, sumNoOutliers: undefined };
                                        }
                                        
                                        const meanNoOutliers = statementData.meanNoOutliers;
                                        const sumNoOutliers = statementData.sumNoOutliers;
                                        
                                        return { code, text, displayCode, meanNoOutliers, sumNoOutliers };
                                      });
                                      
                                      // Calculate sum of meansNoOutliers
                                      let sumOfMeansNoOutliers = 0;
                                      rowDataNoOutliers.forEach(row => {
                                        if (row.meanNoOutliers !== undefined && row.meanNoOutliers !== null) {
                                          sumOfMeansNoOutliers += row.meanNoOutliers;
                                        }
                                      });
                                      
                                      // Normalize meansNoOutliers for numeric grids with "%" tag so they sum to 100%
                                      let normalizationFactorNoOutliers = 1;
                                      if (hasPercentTag && isNumericGrid && sumOfMeansNoOutliers > 0) {
                                        normalizationFactorNoOutliers = 100 / sumOfMeansNoOutliers;
                                      }
                                      
                                      // Second pass: render rows with normalized means
                                      return rowDataNoOutliers.map(({ code, text, displayCode, meanNoOutliers, sumNoOutliers }) => {
                                        if (meanNoOutliers === undefined || meanNoOutliers === null) {
                                          return (
                                            <tr key={code}>
                                              <td className="px-2 py-2 text-sm font-mono text-gray-700 text-center" style={{ width: '2.5rem' }}>{displayCode}</td>
                                              <td className="px-4 py-2 text-sm text-gray-900">{text}</td>
                                              <td className="px-4 py-2 text-sm text-gray-900 text-center">-</td>
                                              {hasNumberTag && (
                                                <>
                                                  <td className="px-4 py-2 text-sm text-gray-900 text-center">-</td>
                                                  <td className="px-4 py-2 text-sm text-gray-900 text-center">-</td>
                                                </>
                                              )}
                                            </tr>
                                          );
                                        }
                                        
                                        // Apply normalization to meanNoOutliers if needed
                                        const normalizedMeanNoOutliers = hasPercentTag && isNumericGrid
                                          ? meanNoOutliers * normalizationFactorNoOutliers
                                          : meanNoOutliers;
                                        
                                        // Calculate percentage: (row sumNoOutliers / total sumNoOutliers of all rows) * 100
                                        const rowPercentage = totalSumNoOutliersForPercentage > 0 && sumNoOutliers !== undefined && sumNoOutliers !== null
                                          ? (sumNoOutliers / totalSumNoOutliersForPercentage) * 100 
                                          : undefined;
                                        
                                        return (
                                          <tr key={code}>
                                            <td className="px-2 py-2 text-sm font-mono text-gray-700 text-center" style={{ width: '2.5rem' }}>{displayCode}</td>
                                            <td className="px-4 py-2 text-sm text-gray-900">{text}</td>
                                            <td className="px-4 py-2 text-sm text-gray-900 text-center" style={{ width: '5rem' }}>
                                              {normalizedMeanNoOutliers !== undefined && normalizedMeanNoOutliers !== null
                                                ? (hasPercentTag ? `${normalizedMeanNoOutliers.toFixed(1)}%` : normalizedMeanNoOutliers.toFixed(2))
                                                : (hasPercentTag ? '-%' : '-')}
                                            </td>
                                            {hasNumberTag && (
                                              <>
                                                <td className="px-4 py-2 text-sm text-gray-900 text-center" style={{ width: '5rem' }}>
                                                  {sumNoOutliers !== undefined && sumNoOutliers !== null ? sumNoOutliers.toFixed(0) : '-'}
                                                </td>
                                                <td className="px-4 py-2 text-sm text-gray-900 text-center" style={{ width: '5rem' }}>
                                                  {rowPercentage !== undefined ? `${rowPercentage.toFixed(1)}%` : '-'}
                                                </td>
                                              </>
                                            )}
                                          </tr>
                                        );
                                      });
                                    })()}
                                    {/* Total row for numeric summary tables with Number or % tag */}
                                    {(variable as any).tags && 
                                     Array.isArray((variable as any).tags) && 
                                     ((variable as any).tags.includes('Number') || (variable as any).tags.includes('%')) && (() => {
                                      const hasPercentTag = (variable as any).tags && Array.isArray((variable as any).tags) && (variable as any).tags.includes('%');
                                      const hasNumberTag = (variable as any).tags && Array.isArray((variable as any).tags) && (variable as any).tags.includes('Number');
                                      
                                      // Check if this is a numeric grid (not a numeric list)
                                      const columnMatch = variable.name.match(/^([A-Z0-9]+)_(c\d+)(?:_Summary)?$/i);
                                      const baseQuestionNumber = columnMatch ? columnMatch[1] : '';
                                      const question = questionnaireQuestions.find(q => {
                                        const qNum = q.number || q.id;
                                        return qNum === baseQuestionNumber || 
                                               qNum === baseQuestionNumber.replace(/^Q/, '') ||
                                               String(qNum) === String(baseQuestionNumber);
                                      });
                                      const isNumericGrid = question?.type?.toLowerCase().includes('numeric grid');
                                      
                                      let sumOfMeansNoOutliers = 0;
                                      let totalSumNoOutliers = 0;
                                      
                                      Object.keys(variable.statements || {}).forEach((stmtCode) => {
                                        const statementVarName = `${baseName}${stmtCode}`;
                                        const expectedHeader = `Q${statementVarName}`;
                                        const statementData = variableData[expectedHeader] || variableData[statementVarName];
                                        
                                        if (statementData && statementData.meanNoOutliers !== undefined && statementData.meanNoOutliers !== null) {
                                          sumOfMeansNoOutliers += statementData.meanNoOutliers;
                                        }
                                        if (statementData && statementData.sumNoOutliers !== undefined && statementData.sumNoOutliers !== null) {
                                          totalSumNoOutliers += statementData.sumNoOutliers;
                                        }
                                      });
                                      
                                      // Normalize sumOfMeansNoOutliers for numeric grids with "%" tag so it equals 100%
                                      let normalizedSumOfMeansNoOutliers = sumOfMeansNoOutliers;
                                      if (hasPercentTag && isNumericGrid && sumOfMeansNoOutliers > 0) {
                                        normalizedSumOfMeansNoOutliers = 100;
                                      }
                                      
                                      // Total percentage should be 100% since it's the sum of all rows in the table
                                      const totalPercentage = totalSumNoOutliers > 0 ? 100 : undefined;
                                      
                                      return (
                                        <tr className="bg-gray-50 font-semibold border-t-2 border-gray-300">
                                          <td className="px-2 py-2 text-sm text-gray-900" colSpan={2}>Total</td>
                                          <td className="px-4 py-2 text-sm text-gray-900 text-center" style={{ width: '5rem' }}>
                                            {normalizedSumOfMeansNoOutliers > 0
                                              ? (hasPercentTag ? `${normalizedSumOfMeansNoOutliers.toFixed(1)}%` : normalizedSumOfMeansNoOutliers.toFixed(2))
                                              : (hasPercentTag ? '-%' : '-')}
                                          </td>
                                          {hasNumberTag && (
                                            <>
                                              <td className="px-4 py-2 text-sm text-gray-900 text-center" style={{ width: '5rem' }}>
                                                {totalSumNoOutliers > 0 ? totalSumNoOutliers.toFixed(0) : '-'}
                                              </td>
                                              <td className="px-4 py-2 text-sm text-gray-900 text-center" style={{ width: '5rem' }}>
                                                {totalPercentage !== undefined ? `${totalPercentage.toFixed(1)}%` : '-'}
                                              </td>
                                            </>
                                          )}
                                        </tr>
                                      );
                                    })()}
                                  </tbody>
                                </table>
                              </div>
                            </div>
                          );
                        })()}

                        {/* Grid table for numeric grids with both statements and response options */}
                        {variable.type?.toLowerCase().includes('numeric grid') && 
                         variable.statements && 
                         variable.codes && 
                         Object.keys(variable.statements).length > 0 && 
                         Object.keys(variable.codes).length > 0 && 
                         !(variable as any).isSummaryTable && (
                          <div className="mt-4 bg-white border border-gray-200 rounded-lg overflow-hidden">
                            <div className="overflow-x-auto">
                              <table className="min-w-full divide-y divide-gray-200">
                                <thead className="bg-gray-50">
                                  <tr>
                                    <th colSpan={2} className="px-4 py-2 text-left text-sm font-semibold text-gray-900">Grid Data</th>
                                    {Object.entries(variable.codes || {}).map(([responseCode, responseLabel]) => {
                                      const displayCode = responseCode.replace(/^[rc]/i, '');
                                      return (
                                        <th key={responseCode} className="px-4 py-2 text-center text-xs font-medium text-gray-500 uppercase tracking-wider whitespace-nowrap" style={{ width: '8rem' }}>
                                          {responseLabel} ({displayCode})
                                        </th>
                                      );
                                    })}
                                  </tr>
                                </thead>
                                <tbody className="bg-white divide-y divide-gray-200">
                                  {Object.entries(variable.statements || {}).map(([stmtCode, stmtText]) => {
                                    const displayStmtCode = stmtCode.replace(/^[rc]/i, '');
                                    return (
                                      <tr key={stmtCode}>
                                        <td className="px-2 py-2 text-sm font-mono text-gray-700 text-center" style={{ width: '2.5rem' }}>{displayStmtCode}</td>
                                        <td className="px-4 py-2 text-sm text-gray-900">{stmtText}</td>
                                        {Object.entries(variable.codes || {}).map(([responseCode]) => {
                                          const cellVarName = `${variable.name}_${stmtCode}_${responseCode}`;
                                          const cellData = getVariableDataByExpectedHeader(cellVarName);
                                          
                                          // Get the numeric value (could be sum, mean, or from values array)
                                          let value: number | undefined = undefined;
                                          if (cellData) {
                                            if (cellData.sum !== undefined) {
                                              value = cellData.sum;
                                            } else if (cellData.mean !== undefined) {
                                              value = cellData.mean;
                                            } else if (cellData.values && Array.isArray(cellData.values) && cellData.values.length > 0) {
                                              // Sum up all numeric values
                                              value = cellData.values.reduce((sum: number, val: any) => {
                                                const numVal = parseFloat(val);
                                                return sum + (isNaN(numVal) ? 0 : numVal);
                                              }, 0);
                                            }
                                          }
                                          
                                          return (
                                            <td key={responseCode} className="px-4 py-2 text-sm text-gray-900 text-center" style={{ width: '8rem' }}>
                                              {value !== undefined ? value.toFixed(0) : '-'}
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

                        {/* Error message if percentages don't sum to 100% - separated from table */}
                        {variable.codes && 
                         Object.keys(variable.codes).length > 0 && 
                         !variable.statements && 
                         !(variable as any).isSummaryTable && 
                         !variable.type?.toLowerCase().includes('numeric grid') &&
                         !variable.type?.toLowerCase().includes('multi-select') && (() => {
                            const varData = getVariableDataByExpectedHeader(variable.name);
                            
                            // Use the same frequency generation logic as in the table
                            // If variable has codes but no frequencies, try to generate frequencies from values array
                            let frequencies = varData?.frequencies;
                            if (!frequencies && varData?.values && Array.isArray(varData.values) && variable.codes && Object.keys(variable.codes).length > 0) {
                              frequencies = {};
                              const codes: Record<string, string> = variable.codes;
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
                            
                            const total = varData?.count || 0;
                            const isSingleSelect = variable.type?.toLowerCase().includes('single select') && !variable.type?.toLowerCase().includes('grid');
                            let totalCount = 0;
                            let totalPercentage = 0;
                            
                            // Calculate total percentage (same strict logic as in the table)
                            const getCount = (code: string, label: string): number => {
                              let count = 0;
                              if (frequencies) {
                                // Try exact code match first (string)
                                if (frequencies[code] !== undefined) {
                                  count = frequencies[code];
                                } else {
                                  // Try numeric match (code might be "1" but frequency key is 1 or vice versa)
                                  const numericCode = /^\d+$/.test(code) ? parseInt(code, 10) : null;
                                  if (numericCode !== null) {
                                    // Try as number
                                    if (frequencies[numericCode] !== undefined) {
                                      count = frequencies[numericCode];
                                    }
                                    // Try as string
                                    if (count === 0 && frequencies[String(numericCode)] !== undefined) {
                                      count = frequencies[String(numericCode)];
                                    }
                                  }
                                  
                                  // Try without prefix (c1 -> 1)
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
                                  
                                  // Try with prefix (1 -> c1 or r1)
                                  if (count === 0 && !code.match(/^[rc]/i)) {
                                    if (frequencies[`c${code}`] !== undefined) {
                                      count = frequencies[`c${code}`];
                                    } else if (frequencies[`r${code}`] !== undefined) {
                                      count = frequencies[`r${code}`];
                                    }
                                  }
                                  
                                  // Last resort: try label matching (case-insensitive, trimmed)
                                  if (count === 0 && label) {
                                    const normalizedLabel = label.trim().toLowerCase();
                                    for (const [key, value] of Object.entries(frequencies)) {
                                      if (key.toLowerCase() === normalizedLabel) {
                                        count = value as number;
                                        break;
                                      }
                                    }
                                  }
                                }
                              }
                              return count;
                            };
                            
                            // First pass: calculate totalCount for single-select tables
                            if (isSingleSelect) {
                              Object.entries(variable.codes || {}).forEach(([code, label]) => {
                                const count = getCount(code, label);
                                totalCount += count;
                              });
                            }
                            
                            // Second pass: calculate percentages
                            Object.entries(variable.codes || {}).forEach(([code, label]) => {
                              const count = getCount(code, label);
                              // For single-select tables, use totalCount; otherwise use total
                              const percentage = isSingleSelect && totalCount > 0 
                                ? (count / totalCount) * 100 
                                : (total > 0 ? (count / total) * 100 : 0);
                              totalPercentage += percentage;
                            });
                            
                            // Only show warning if totalPercentage is not 100% (or very close)
                            // Skip this check for multi-select questions as they can have percentages > 100%
                            const isMultiSelect = variable.type?.toLowerCase().includes('multi-select');
                            if (!isMultiSelect && Math.abs(totalPercentage - 100) > 0.1) {
                              // Find the questionnaire that contains this question
                              // Extract base variable name (e.g., "S4" from "S4_1")
                              const baseVarName = variable.name.match(/^(.+?)_\d+$/) ? variable.name.match(/^(.+?)_\d+$/)![1] : variable.name;
                              const matchingQnr = questionnaires.find(qnr => 
                                qnr.questions?.some((q: any) => {
                                  const qNumber = q.number || q.id || '';
                                  return qNumber === baseVarName || qNumber === variable.name;
                                })
                              );
                              
                              return (
                                <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg">
                                  <div className="flex items-start gap-2">
                                    <InformationCircleIcon className="h-5 w-5 text-red-500 flex-shrink-0 mt-0.5" />
                                    <p className="text-sm text-red-800">
                                      <strong>Warning:</strong> Percentages don't sum to 100% ({totalPercentage.toFixed(1)}%). 
                                      This may indicate a mismatch between response codes in your data and the QNR. 
                                    {matchingQnr && selectedProject ? (
                                      <span> Please review the response codes in the{' '}
                                        <button
                                          onClick={() => {
                                            // Store project and QNR IDs in sessionStorage for QNR component to pick up
                                            sessionStorage.setItem('cognitive_dash_tabs_sync_project_id', selectedProject.id);
                                            sessionStorage.setItem('cognitive_dash_tabs_sync_qnr_id', matchingQnr.id);
                                            navigate('/qnr');
                                          }}
                                          className="text-red-600 underline hover:text-red-800 font-medium"
                                        >
                                          QNR
                                        </button>
                                        {' '}to ensure they were parsed correctly.
                                      </span>
                                    ) : (
                                      <span> Please review the response codes in the QNR to ensure they were parsed correctly.</span>
                                    )}
                                    </p>
                                  </div>
                                  <p className="text-xs text-red-700 mt-2 ml-7">
                                    Note: Codes like 97, 98, and 99 are often the cause of this error. These can be updated in the QNR tab.
                                  </p>
                                </div>
                              );
                            }
                            return null;
                          })()}

                        {/* Response Options for categorical variables */}
                        {variable.codes && 
                         Object.keys(variable.codes).length > 0 && 
                         !variable.statements && 
                         !(variable as any).isSummaryTable && 
                         !variable.type?.toLowerCase().includes('numeric grid') && (() => {
                          // Check if this is a multiselect base question (B8) or response variable (B8r1, B8r2, etc.)
                          const multiselectMatch = variable.name.match(/^(.+?)r(\d+)$/i);
                          const isMultiselectResponse = multiselectMatch && variable.type?.toLowerCase().includes('multi-select');
                          const isMultiselectBase = variable.type?.toLowerCase().includes('multi-select') && !multiselectMatch;
                          
                          if (isMultiselectBase || isMultiselectResponse) {
                            // Determine the base question name
                            const baseQuestion = isMultiselectResponse ? multiselectMatch![1] : variable.name;
                            
                            // Find all response variables for this multiselect question
                            const responseVariables = variables.filter(v => {
                              const match = v.name.match(/^(.+?)r(\d+)$/i);
                              return match && match[1] === baseQuestion && v.type?.toLowerCase().includes('multi-select');
                            }).sort((a, b) => {
                              const aMatch = a.name.match(/r(\d+)$/i);
                              const bMatch = b.name.match(/r(\d+)$/i);
                              const aNum = aMatch ? parseInt(aMatch[1], 10) : 0;
                              const bNum = bMatch ? parseInt(bMatch[1], 10) : 0;
                              return aNum - bNum;
                            });
                            
                            // Show combined table if we have response variables
                            if (responseVariables.length > 0) {
                              // Calculate base size (sample size) - count all people who saw the question
                              // Use the first response variable to determine who saw the question
                              // Any row with 0 or 1 (not blank) means they saw the question
                              let baseSize = 0;
                              const firstRespVar = responseVariables[0];
                              const firstRespVarData = getVariableDataByExpectedHeader(firstRespVar.name);
                              
                              if (firstRespVarData) {
                                if (firstRespVarData.values && Array.isArray(firstRespVarData.values)) {
                                  // Count all non-blank values (0, 1, or any other value means they saw it)
                                  baseSize = firstRespVarData.values.filter((v: any) => {
                                    // Exclude null, undefined, empty string, and whitespace-only strings
                                    return v !== null && v !== undefined && v !== '' && String(v).trim() !== '';
                                  }).length;
                                } else if (firstRespVarData.count !== undefined) {
                                  // If we have a count, use it (but this might include blanks, so prefer values array)
                                  baseSize = firstRespVarData.count;
                                } else if (firstRespVarData.frequencies) {
                                  // Sum all frequencies (0s and 1s)
                                  baseSize = Object.values(firstRespVarData.frequencies).reduce((sum: number, count: any) => {
                                    return sum + (typeof count === 'number' ? count : 0);
                                  }, 0);
                                }
                              }
                              
                              // Build combined multiselect table
                              const responseRows: Array<{code: string, label: string, count: number, percentage: number}> = [];
                              let totalResponses = 0;
                              
                              responseVariables.forEach((respVar) => {
                                const respVarData = getVariableDataByExpectedHeader(respVar.name);
                                if (!respVarData) return;
                                
                                // Get count for "Selected" (code "1")
                                let count = 0;
                                if (respVarData.frequencies) {
                                  count = respVarData.frequencies['1'] || respVarData.frequencies[1] || 0;
                                } else if (respVarData.values && Array.isArray(respVarData.values)) {
                                  count = respVarData.values.filter((v: any) => v === 1 || v === '1' || String(v).trim() === '1').length;
                                }
                                
                                // Get the response option label from the variable description
                                // Format: "Question Text - Response Option Text"
                                const description = respVar.description || '';
                                const label = description.includes(' - ') ? description.split(' - ')[1] : respVar.name;
                                
                                // Extract response number from variable name (B8r1 -> 1)
                                const respMatch = respVar.name.match(/r(\d+)$/i);
                                const respCode = respMatch ? respMatch[1] : '';
                                
                                if (count > 0 || respVarData.count > 0) {
                                  responseRows.push({
                                    code: respCode,
                                    label: label,
                                    count: count,
                                    percentage: 0 // Will calculate after we have total
                                  });
                                  totalResponses += count;
                                }
                              });
                              
                              // Calculate percentages based on base size (sample size), not total responses
                              responseRows.forEach(row => {
                                row.percentage = baseSize > 0 ? (row.count / baseSize) * 100 : 0;
                              });
                              
                              responseRows.sort((a, b) => {
                                // Sort by count descending, then by percentage descending
                                if (b.count !== a.count) {
                                  return b.count - a.count;
                                }
                                return b.percentage - a.percentage;
                              });
                              
                              // Get base question info - use just the question label
                              const baseQuestionVar = variables.find(v => v.name === baseQuestion);
                              const questionText = baseQuestionVar?.description || baseQuestion;
                              
                              return (
                                <div>
                                  {/* Sample Size */}
                                  {baseSize > 0 && (
                                    <p className="mb-4 text-sm text-gray-700">
                                      <span className="font-semibold">Sample Size:</span> <span className="font-semibold">{baseSize.toLocaleString()}</span>
                                    </p>
                                  )}
                                  
                                  <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
                                    <div className="overflow-x-auto">
                                      <table className="min-w-full divide-y divide-gray-200">
                                        <thead className="bg-gray-50">
                                          <tr>
                                            <th colSpan={2} className="px-4 py-2 text-left text-sm font-semibold text-gray-900">
                                              {questionText}
                                            </th>
                                            <th className="px-4 py-2 text-center text-xs font-medium text-gray-500 uppercase tracking-wider whitespace-nowrap" style={{ width: '5rem' }}>Count</th>
                                            <th className="px-4 py-2 text-center text-xs font-medium text-gray-500 uppercase tracking-wider whitespace-nowrap" style={{ width: '5rem' }}>%</th>
                                          </tr>
                                        </thead>
                                        <tbody className="bg-white divide-y divide-gray-200">
                                          {responseRows.map((row) => (
                                            <tr key={row.code}>
                                              <td className="px-2 py-2 text-sm font-mono text-gray-700 text-center" style={{ width: '2.5rem' }}>{row.code}</td>
                                              <td className="px-4 py-2 text-sm text-gray-900">{row.label}</td>
                                              <td className="px-4 py-2 text-sm text-gray-900 text-center" style={{ width: '5rem' }}>{row.count}</td>
                                              <td className="px-4 py-2 text-sm text-gray-900 text-center" style={{ width: '5rem' }}>{baseSize > 0 ? `${row.percentage.toFixed(1)}%` : '-'}</td>
                                            </tr>
                                          ))}
                                          {/* Total row */}
                                          <tr className="bg-gray-50 font-semibold border-t-2 border-gray-300">
                                            <td className="px-2 py-2 text-sm text-gray-900" colSpan={2}>Total</td>
                                            <td className="px-4 py-2 text-sm text-gray-900 text-center" style={{ width: '5rem' }}>{totalResponses}</td>
                                            <td className="px-4 py-2 text-sm text-center font-semibold text-gray-900" style={{ width: '5rem' }}>
                                              {baseSize > 0 ? `${((totalResponses / baseSize) * 100).toFixed(1)}%` : '-'}
                                            </td>
                                          </tr>
                                        </tbody>
                                      </table>
                                    </div>
                                  </div>
                                </div>
                              );
                            }
                            
                            // For other response variables, don't show individual table
                            return null;
                          }
                          
                          // Regular categorical variable - show normal table
                          return (
                            <div>
                              {(() => {
                                // Calculate base size (sample size) - count all people who saw the question
                                const varData = getVariableDataByExpectedHeader(variable.name);
                                let baseSize = 0;
                                
                                if (varData) {
                                  if (varData.values && Array.isArray(varData.values)) {
                                    // Count all non-blank values (any value means they saw it)
                                    baseSize = varData.values.filter((v: any) => {
                                      // Exclude null, undefined, empty string, and whitespace-only strings
                                      return v !== null && v !== undefined && v !== '' && String(v).trim() !== '';
                                    }).length;
                                  } else if (varData.count !== undefined) {
                                    // If we have a count, use it
                                    baseSize = varData.count;
                                  } else if (varData.frequencies) {
                                    // Sum all frequencies
                                    baseSize = Object.values(varData.frequencies).reduce((sum: number, count: any) => {
                                      return sum + (typeof count === 'number' ? count : 0);
                                    }, 0);
                                  }
                                }
                                
                                return baseSize > 0 ? (
                                  <p className="mb-4 text-sm text-gray-700">
                                    <span className="font-semibold">Sample Size:</span> <span className="font-semibold">{baseSize.toLocaleString()}</span>
                                  </p>
                                ) : null;
                              })()}
                              
                          <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
                            <div className="overflow-x-auto">
                            <table className="min-w-full divide-y divide-gray-200">
                                <thead className="bg-gray-50">
                                  <tr>
                                    {(() => {
                                      const isSingleSelect = variable.type?.toLowerCase().includes('single select') && !variable.type?.toLowerCase().includes('grid');
                                      const currentSort = singleSelectSort[variable.name];
                                      // Default to sorting by code ascending for single select questions
                                      const effectiveSort = isSingleSelect && !currentSort 
                                        ? { column: 'code' as const, direction: 'asc' as const }
                                        : currentSort;
                                      
                                      const handleSort = (column: 'code' | 'count' | 'percentage') => {
                                        setSingleSelectSort(prev => {
                                          const current = prev[variable.name];
                                          if (current?.column === column) {
                                            // Toggle direction
                                            return {
                                              ...prev,
                                              [variable.name]: {
                                                column,
                                                direction: current.direction === 'asc' ? 'desc' : 'asc'
                                              }
                                            };
                                          } else {
                                            // New column: count and percentage default to descending, code defaults to ascending
                                            const defaultDirection = (column === 'count' || column === 'percentage') ? 'desc' : 'asc';
                                            return {
                                              ...prev,
                                              [variable.name]: {
                                                column,
                                                direction: defaultDirection
                                              }
                                            };
                                          }
                                        });
                                      };
                                      
                                      const SortableHeader = ({ column, label }: { column: 'code' | 'count' | 'percentage', label: string }) => {
                                        if (!isSingleSelect) {
                                          return (
                                            <th className="px-4 py-2 text-center text-xs font-medium text-gray-500 uppercase tracking-wider whitespace-nowrap" style={{ width: '5rem' }}>{label}</th>
                                          );
                                        }
                                        
                                        // For count and percentage, show arrow for both when either is sorted
                                        // Since they have the same order (count and percentage are correlated)
                                        const isActive = effectiveSort?.column === column || 
                                          (effectiveSort?.column === 'count' && column === 'percentage') ||
                                          (effectiveSort?.column === 'percentage' && column === 'count');
                                        
                                        return (
                                          <th 
                                            className="px-4 py-2 text-center text-xs font-medium text-gray-500 uppercase tracking-wider whitespace-nowrap cursor-pointer hover:bg-gray-100 select-none" 
                                            style={{ width: '5rem' }}
                                            onClick={() => handleSort(column)}
                                          >
                                            <div className="flex items-center justify-center gap-1">
                                              <span>{label}</span>
                                              {isActive && effectiveSort && (
                                                effectiveSort.direction === 'asc' ? (
                                                  <ChevronUpIcon className="h-3 w-3 text-gray-500" />
                                                ) : (
                                                  <ChevronDownIcon className="h-3 w-3 text-gray-500" />
                                                )
                                              )}
                                            </div>
                                          </th>
                                        );
                                      };
                                      
                                      const CodeHeader = () => {
                                        if (!isSingleSelect) {
                                          return (
                                            <th colSpan={2} className="px-4 py-2 text-left text-sm font-semibold text-gray-900">Response Options</th>
                                          );
                                        }
                                        
                                        const isActive = effectiveSort?.column === 'code';
                                        return (
                                          <th 
                                            colSpan={2} 
                                            className="px-4 py-2 text-left text-sm font-semibold text-gray-900 cursor-pointer hover:bg-gray-100 select-none"
                                            onClick={() => handleSort('code')}
                                          >
                                            <div className="flex items-center gap-1">
                                              <span>Response Options</span>
                                              {isActive && effectiveSort && (
                                                effectiveSort.direction === 'asc' ? (
                                                  <ChevronUpIcon className="h-3 w-3 text-gray-500" />
                                                ) : (
                                                  <ChevronDownIcon className="h-3 w-3 text-gray-500" />
                                                )
                                              )}
                                            </div>
                                          </th>
                                        );
                                      };
                                      
                                      return (
                                        <>
                                          <CodeHeader />
                                          <SortableHeader column="count" label="Count" />
                                          <SortableHeader column="percentage" label="%" />
                                        </>
                                      );
                                    })()}
                                  </tr>
                                </thead>
                              <tbody className="bg-white divide-y divide-gray-200">
                                  {(() => {
                                    const varData = getVariableDataByExpectedHeader(variable.name);
                                    
                                    // If variable has codes but no frequencies, try to generate frequencies from values array
                                    // This handles cases where backend incorrectly marked a categorical variable as numeric
                                    let frequencies = varData?.frequencies;
                                    if (!frequencies && varData?.values && Array.isArray(varData.values) && variable.codes && Object.keys(variable.codes).length > 0) {
                                      frequencies = {};
                                      const codes: Record<string, string> = variable.codes; // Store reference with explicit type
                                      varData.values.forEach((val: any) => {
                                        const valStr = String(val).trim();
                                        // Try to match value to a code
                                        let matchedCode: string | null = null;
                                        
                                        // Try exact match
                                        if (codes[valStr]) {
                                          matchedCode = valStr;
                                        } else {
                                          // Try numeric match
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
                                          // Store unmatched value as-is
                                          frequencies[valStr] = (frequencies[valStr] || 0) + 1;
                                        }
                                      });
                                    }
                                    
                                    const total = varData?.count || 0;
                                    
                                    // Calculate total count and sum of percentages by summing all frequencies
                                    let totalCount = 0;
                                    let totalPercentage = 0;
                                    
                                    // Helper function to get count for a code/label pair
                                    // STRICT MATCHING: Only match exact codes or prefix variations
                                    // Do NOT fall back to label matching or values array matching
                                    // This ensures unmatched codes (like 99) don't get incorrectly assigned
                                    const getCount = (code: string, label: string): number => {
                                      let count = 0;
                                      let matchedKey: string | null = null;
                                      
                                      if (frequencies) {
                                        // Try exact code match first (string)
                                        if (frequencies[code] !== undefined) {
                                          count = frequencies[code];
                                          matchedKey = code;
                                        }
                                        
                                        // Try numeric match (code might be "1" but frequency key is 1 or vice versa)
                                        if (count === 0) {
                                          const numericCode = /^\d+$/.test(code) ? parseInt(code, 10) : null;
                                          if (numericCode !== null) {
                                            // Try as number
                                            if (frequencies[numericCode] !== undefined) {
                                              count = frequencies[numericCode];
                                              matchedKey = String(numericCode);
                                            }
                                            // Try as string
                                            if (count === 0 && frequencies[String(numericCode)] !== undefined) {
                                              count = frequencies[String(numericCode)];
                                              matchedKey = String(numericCode);
                                            }
                                          }
                                        }
                                        
                                        // If no match, try without prefix (c1 -> 1)
                                        if (count === 0) {
                                          const codeWithoutPrefix = code.replace(/^[rc]/i, '');
                                          if (frequencies[codeWithoutPrefix] !== undefined) {
                                            count = frequencies[codeWithoutPrefix];
                                            matchedKey = codeWithoutPrefix;
                                          }
                                          // Also try numeric version
                                          if (count === 0 && /^\d+$/.test(codeWithoutPrefix)) {
                                            const num = parseInt(codeWithoutPrefix, 10);
                                            if (frequencies[num] !== undefined) {
                                              count = frequencies[num];
                                              matchedKey = String(num);
                                            }
                                          }
                                        }
                                        
                                        // If still no match, try with prefix (1 -> c1, but only if code doesn't already have prefix)
                                        if (count === 0 && !code.match(/^[rc]/i)) {
                                          if (frequencies[`c${code}`] !== undefined) {
                                            count = frequencies[`c${code}`];
                                            matchedKey = `c${code}`;
                                          } else if (frequencies[`r${code}`] !== undefined) {
                                            count = frequencies[`r${code}`];
                                            matchedKey = `r${code}`;
                                          }
                                        }
                                        
                                        // Last resort: try label matching (case-insensitive, trimmed)
                                        if (count === 0 && label) {
                                          const normalizedLabel = label.trim().toLowerCase();
                                          for (const [key, value] of Object.entries(frequencies)) {
                                            // Check if any frequency key matches the label
                                            if (key.toLowerCase() === normalizedLabel) {
                                              count = value as number;
                                              matchedKey = key;
                                              break;
                                            }
                                          }
                                        }
                                      }
                                      
                                      return count;
                                    };
                                    
                                    // First pass: calculate totalCount by summing all row counts
                                    const isSingleSelect = variable.type?.toLowerCase().includes('single select') && !variable.type?.toLowerCase().includes('grid');
                                    Object.entries(variable.codes).forEach(([code, label]) => {
                                      const count = getCount(code, label);
                                      totalCount += count;
                                    });
                                    
                                    // Second pass: build rows array with percentages calculated based on totalCount
                                    const rows: Array<{ code: string, label: string, count: number, percentage: number, displayCode: string }> = [];
                                    Object.entries(variable.codes).forEach(([code, label]) => {
                                      const count = getCount(code, label);
                                      // For single select tables, calculate percentage based on totalCount (sum of all row counts)
                                      const percentage = isSingleSelect && totalCount > 0 ? (count / totalCount) * 100 : (total > 0 ? (count / total) * 100 : 0);
                                      totalPercentage += percentage;
                                      
                                      // Display code without prefix (c1 -> 1, r1 -> 1) for the first column
                                      const displayCode = code.replace(/^[rc]/i, '');
                                      
                                      rows.push({
                                        code,
                                        label: label as string,
                                        count,
                                        percentage,
                                        displayCode
                                      });
                                    });
                                    
                                    // Apply sorting for single select questions
                                    if (isSingleSelect) {
                                      const currentSort = singleSelectSort[variable.name];
                                      // Default to sorting by code ascending if no sort is set
                                      const sortToApply = currentSort || { column: 'code' as const, direction: 'asc' as const };
                                      
                                      rows.sort((a, b) => {
                                        let comparison = 0;
                                        
                                        switch (sortToApply.column) {
                                          case 'code':
                                            // Sort by code numerically if possible, otherwise alphabetically
                                            const aCodeNum = /^\d+$/.test(a.displayCode) ? parseInt(a.displayCode, 10) : null;
                                            const bCodeNum = /^\d+$/.test(b.displayCode) ? parseInt(b.displayCode, 10) : null;
                                            
                                            if (aCodeNum !== null && bCodeNum !== null) {
                                              comparison = aCodeNum - bCodeNum;
                                            } else {
                                              comparison = a.displayCode.localeCompare(b.displayCode);
                                            }
                                            break;
                                          case 'count':
                                            comparison = a.count - b.count;
                                            break;
                                          case 'percentage':
                                            comparison = a.percentage - b.percentage;
                                            break;
                                          default:
                                            return 0;
                                        }
                                        
                                        return sortToApply.direction === 'asc' ? comparison : -comparison;
                                      });
                                    }
                                    
                                    return (
                                      <>
                                        {rows.map((row) => (
                                          <tr key={row.code}>
                                            <td className="px-2 py-2 text-sm font-mono text-gray-700 text-center" style={{ width: '2.5rem' }}>{row.displayCode}</td>
                                            <td className="px-4 py-2 text-sm text-gray-900">{row.label}</td>
                                            <td className="px-4 py-2 text-sm text-gray-900 text-center" style={{ width: '5rem' }}>{row.count}</td>
                                            <td className="px-4 py-2 text-sm text-gray-900 text-center" style={{ width: '5rem' }}>{(isSingleSelect && totalCount > 0) || (!isSingleSelect && total > 0) ? `${row.percentage.toFixed(1)}%` : '-'}</td>
                                          </tr>
                                        ))}

                                        {/* Scale summary rows for 7-point scales with Scale tag */}
                                        {(() => {
                                          const hasScaleTag = variable.tags && Array.isArray(variable.tags) && variable.tags.includes('Scale');
                                          const is7PointScale = hasScaleTag && isSingleSelect && rows.length === 7;

                                          if (!is7PointScale) return null;

                                          // Calculate T2B (Top 2 Box) - high end (codes 6-7)
                                          const t2bCount = rows.slice(5, 7).reduce((sum, row) => sum + row.count, 0);
                                          const t2bPercentage = totalCount > 0 ? (t2bCount / totalCount) * 100 : 0;

                                          // Calculate M3B (Middle 3 Box) - middle 3 responses (codes 3-5)
                                          const m3bCount = rows.slice(2, 5).reduce((sum, row) => sum + row.count, 0);
                                          const m3bPercentage = totalCount > 0 ? (m3bCount / totalCount) * 100 : 0;

                                          // Calculate B2B (Bottom 2 Box) - low end (codes 1-2)
                                          const b2bCount = rows.slice(0, 2).reduce((sum, row) => sum + row.count, 0);
                                          const b2bPercentage = totalCount > 0 ? (b2bCount / totalCount) * 100 : 0;

                                          // Calculate Mean - weighted average (codes 1-7)
                                          let weightedSum = 0;
                                          rows.forEach((row, index) => {
                                            weightedSum += row.count * (index + 1);
                                          });
                                          const mean = totalCount > 0 ? weightedSum / totalCount : 0;

                                          return (
                                            <>
                                              <tr className="bg-blue-50 border-t border-gray-300">
                                                <td className="px-2 py-2 text-sm text-gray-900" colSpan={2}>T2B (Top 2 Box)</td>
                                                <td className="px-4 py-2 text-sm text-gray-900 text-center" style={{ width: '5rem' }}>{t2bCount}</td>
                                                <td className="px-4 py-2 text-sm text-gray-900 text-center" style={{ width: '5rem' }}>{totalCount > 0 ? `${t2bPercentage.toFixed(1)}%` : '-'}</td>
                                              </tr>
                                              <tr className="bg-blue-50">
                                                <td className="px-2 py-2 text-sm text-gray-900" colSpan={2}>M3B (Middle 3 Box)</td>
                                                <td className="px-4 py-2 text-sm text-gray-900 text-center" style={{ width: '5rem' }}>{m3bCount}</td>
                                                <td className="px-4 py-2 text-sm text-gray-900 text-center" style={{ width: '5rem' }}>{totalCount > 0 ? `${m3bPercentage.toFixed(1)}%` : '-'}</td>
                                              </tr>
                                              <tr className="bg-blue-50">
                                                <td className="px-2 py-2 text-sm text-gray-900" colSpan={2}>B2B (Bottom 2 Box)</td>
                                                <td className="px-4 py-2 text-sm text-gray-900 text-center" style={{ width: '5rem' }}>{b2bCount}</td>
                                                <td className="px-4 py-2 text-sm text-gray-900 text-center" style={{ width: '5rem' }}>{totalCount > 0 ? `${b2bPercentage.toFixed(1)}%` : '-'}</td>
                                              </tr>
                                              <tr className="bg-blue-50 border-b border-gray-300">
                                                <td className="px-2 py-2 text-sm text-gray-900" colSpan={2}>Mean</td>
                                                <td className="px-4 py-2 text-sm text-gray-900 text-center" style={{ width: '5rem' }}>{totalCount > 0 ? mean.toFixed(2) : '-'}</td>
                                                <td className="px-4 py-2 text-sm text-gray-900 text-center" style={{ width: '5rem' }}>-</td>
                                              </tr>
                                            </>
                                          );
                                        })()}

                                        {/* Total row */}
                                        <tr className="bg-gray-50 font-semibold border-t-2 border-gray-300">
                                          <td className="px-2 py-2 text-sm text-gray-900" colSpan={2}>Total</td>
                                          <td className="px-4 py-2 text-sm text-gray-900 text-center" style={{ width: '5rem' }}>{totalCount}</td>
                                          <td className={`px-4 py-2 text-sm text-center font-semibold ${Math.abs(totalPercentage - 100) > 0.01 ? 'text-red-600' : 'text-gray-900'}`} style={{ width: '5rem' }}>
                                            {isSingleSelect && totalCount > 0 ? '100.0%' : (!isSingleSelect && total > 0 ? `${totalPercentage.toFixed(1)}%` : '-')}
                                          </td>
                                        </tr>
                                      </>
                                    );
                                  })()}
                              </tbody>
                            </table>
                          </div>
                        </div>
                            </div>
                          );
                        })()}

                        {/* Summary table for open end list variables - shown only when viewing the summary variable */}
                        {variable.type?.toLowerCase().includes('open end list') && 
                         (variable as any).isSummaryTable && 
                         variable.name.endsWith('_Summary') && (() => {
                          // Extract base question name (e.g., "S12" from "S12_Summary")
                          const baseQuestionName = variable.name.replace('_Summary', '');
                          
                          // Find all related open end list variables (e.g., S12r1, S12r2, S12r3, etc.)
                          const relatedVariables = variables.filter((v: any) => {
                            if (!v.type?.toLowerCase().includes('open end list')) return false;
                            if ((v as any).isSummaryTable) return false; // Exclude summary variable itself
                            const varMatch = v.name.match(/^([A-Z0-9]+)r\d+$/i);
                            return varMatch && varMatch[1] === baseQuestionName;
                          });
                          
                          if (relatedVariables.length === 0) return null;
                          
                          // Combine all responses from all related variables
                          const combinedFrequencyMap = new Map<string, number>();
                          let combinedTotalCount = 0;
                          
                          relatedVariables.forEach((relatedVar: any) => {
                            const relatedVarData = getVariableDataByExpectedHeader(relatedVar.name);
                            if (!relatedVarData) return;
                            
                            // Process frequencies object
                            if (relatedVarData.frequencies && typeof relatedVarData.frequencies === 'object') {
                              Object.entries(relatedVarData.frequencies).forEach(([key, count]) => {
                                if (typeof count === 'number' && count > 0) {
                                  const keyStr = String(key).trim();
                                  if (keyStr && keyStr !== '(No response)' && keyStr !== '(Empty response)') {
                                    combinedFrequencyMap.set(keyStr, (combinedFrequencyMap.get(keyStr) || 0) + count);
                                    combinedTotalCount += count;
                                  }
                                }
                              });
                            }
                            // Process values array
                            else if (Array.isArray(relatedVarData.values)) {
                              relatedVarData.values.forEach((val: any) => {
                                if (val !== null && val !== undefined && val !== '') {
                                  const valStr = String(val).trim();
                                  if (valStr) {
                                    combinedFrequencyMap.set(valStr, (combinedFrequencyMap.get(valStr) || 0) + 1);
                                    combinedTotalCount++;
                                  }
                                }
                              });
                            }
                          });
                          
                          if (combinedFrequencyMap.size === 0) return null;
                          
                          // Sort by count (descending), then alphabetically
                          const sortedCombinedFrequencies = Array.from(combinedFrequencyMap.entries())
                            .sort((a, b) => {
                              if (b[1] !== a[1]) {
                                return b[1] - a[1]; // Sort by count descending
                              }
                              return a[0].localeCompare(b[0]); // Then alphabetically
                            });
                          
                          const combinedCalculatedTotal = combinedTotalCount;
                          
                          // Calculate total from sum of counts in rows (for display in sample size and total row)
                          const totalFromRows = sortedCombinedFrequencies.reduce((sum, [, count]) => sum + count, 0);
                          
                          return (
                            <div className="mt-4">
                              {/* Sample Size */}
                              {totalFromRows > 0 && (
                                <p className="mb-4 text-sm text-gray-700">
                                  <span className="font-semibold">Sample Size:</span> <span className="font-semibold">{totalFromRows.toLocaleString()}</span>
                                </p>
                              )}
                              
                              <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
                                <div className="overflow-x-auto">
                                  <table className="min-w-full divide-y divide-gray-200">
                                    <thead className="bg-gray-50">
                                      <tr>
                                        <th className="px-4 py-2 text-left text-sm font-semibold text-gray-900">Response</th>
                                        <th className="px-4 py-2 text-center text-xs font-medium text-gray-500 uppercase tracking-wider whitespace-nowrap" style={{ width: '5rem' }}>Count</th>
                                        <th className="px-4 py-2 text-center text-xs font-medium text-gray-500 uppercase tracking-wider whitespace-nowrap" style={{ width: '5rem' }}>%</th>
                                      </tr>
                                    </thead>
                                    <tbody className="bg-white divide-y divide-gray-200">
                                      {(() => {
                                        
                                        return (
                                          <>
                                            {sortedCombinedFrequencies.map(([response, count], index) => {
                                              // Calculate percentage based on total from rows
                                              const percent = totalFromRows > 0 ? ((count / totalFromRows) * 100) : 0;
                                              
                                              return (
                                                <tr key={index}>
                                                  <td className="px-4 py-2 text-sm text-gray-900 break-words max-w-md">{response}</td>
                                                  <td className="px-4 py-2 text-sm text-gray-900 text-center" style={{ width: '5rem' }}>{count}</td>
                                                  <td className="px-4 py-2 text-sm text-gray-900 text-center" style={{ width: '5rem' }}>{percent.toFixed(1)}%</td>
                                                </tr>
                                              );
                                            })}
                                            <tr className="bg-gray-100 font-bold border-t-2 border-gray-400">
                                              <td className="px-4 py-2 text-sm text-gray-900">Total</td>
                                              <td className="px-4 py-2 text-sm text-gray-900 text-center" style={{ width: '5rem' }}>{totalFromRows}</td>
                                              <td className="px-4 py-2 text-sm text-gray-900 text-center" style={{ width: '5rem' }}>{totalFromRows > 0 ? '100.0%' : '0.0%'}</td>
                                            </tr>
                                          </>
                                        );
                                      })()}
                                    </tbody>
                                  </table>
                                </div>
                              </div>
                            </div>
                          );
                        })()}

                        {/* Frequency table for open end questions */}
                        {(variable.type?.toLowerCase().includes('open end') || variable.type?.toLowerCase().includes('open end list')) &&
                         (!variable.codes || Object.keys(variable.codes).length === 0) &&
                         (!variable.statements || Object.keys(variable.statements).length === 0) &&
                         !(variable as any).isSummaryTable &&
                         !variable.name.endsWith('_Summary') && (() => {
                          const varData = getVariableDataByExpectedHeader(variable.name);

                          if (!varData) return null;
                          
                          // Check if we have meaningful data
                          // Only render if we have frequencies with actual counts, or values array with data
                          const hasFrequencies = varData.frequencies && typeof varData.frequencies === 'object' && 
                            Object.keys(varData.frequencies).length > 0 &&
                            Object.values(varData.frequencies).some((count: any) => typeof count === 'number' && count > 0);
                          const hasValues = Array.isArray(varData.values) && varData.values.length > 0;
                          
                          // If we don't have frequencies with counts or values array, show a message
                          if (!hasFrequencies && !hasValues) {
                            return (
                              <div className="mt-4 bg-yellow-50 border border-yellow-200 rounded-lg p-4">
                                <p className="text-sm text-yellow-800">
                                  Open end data found but no response values available to display.
                                  Data might need to be reprocessed or mapped correctly.
                                </p>
                              </div>
                            );
                          }
                          
                          // Build frequency map from values array or frequencies object
                          const frequencyMap = new Map<string, number>();
                          let totalCount = 0;
                          
                          // If frequencies object exists, use it (pre-aggregated)
                          if (hasFrequencies) {
                            Object.entries(varData.frequencies).forEach(([key, count]) => {
                              if (typeof count === 'number' && count > 0) {
                                let keyStr = String(key).trim();
                                // Normalize null/empty values
                                if (!keyStr || keyStr === 'null' || keyStr.toLowerCase() === 'null' || 
                                    key === null || key === undefined) {
                                  keyStr = '(No response)';
                                }
                                if (keyStr) {
                                  frequencyMap.set(keyStr, (frequencyMap.get(keyStr) || 0) + count);
                                  totalCount += count;
                                }
                              }
                            });
                          } 
                          // Otherwise, calculate from values array
                          else if (hasValues) {
                            varData.values.forEach((val: any) => {
                              // Include ALL values, even empty ones (they represent "no response")
                              // But normalize empty values to a consistent representation
                              let valStr: string;
                              // Handle null, undefined, empty string, or the string "null"
                              if (val === null || val === undefined || val === '' || 
                                  (typeof val === 'string' && val.toLowerCase().trim() === 'null')) {
                                valStr = '(No response)';
                              } else {
                                valStr = String(val).trim();
                                if (!valStr || valStr.toLowerCase() === 'null') {
                                  valStr = '(No response)';
                                }
                              }
                              
                              // Count all responses, including empty ones
                              frequencyMap.set(valStr, (frequencyMap.get(valStr) || 0) + 1);
                              totalCount++;
                            });
                          }
                          
                          // Only show if we have data
                          if (frequencyMap.size === 0) return null;
                          
                          // Calculate base size (sample size) - count ALL people who saw the question (including empty responses)
                          let baseSize = 0;
                          if (varData.values && Array.isArray(varData.values)) {
                            // Count ALL values (including null/empty) - everyone who saw the question
                            baseSize = varData.values.length;
                          } else if (varData.count !== undefined) {
                            baseSize = varData.count;
                          } else if (varData.frequencies) {
                            baseSize = Object.values(varData.frequencies).reduce((sum: number, count: any) => {
                              return sum + (typeof count === 'number' ? count : 0);
                            }, 0);
                          }
                          
                          // Sort by count (descending), then alphabetically
                          const sortedFrequencies = Array.from(frequencyMap.entries())
                            .sort((a, b) => {
                              if (b[1] !== a[1]) {
                                return b[1] - a[1]; // Sort by count descending
                              }
                              return a[0].localeCompare(b[0]); // Then alphabetically
                            });
                          
                          // Filter out "(No response)" and "(Empty response)" entries for display and calculation
                          const filteredFrequencies = sortedFrequencies.filter(([response]) => 
                            response !== '(No response)' && response !== '(Empty response)'
                          );
                          
                          // Calculate total from sum of counts in rows (excluding no response entries)
                          const totalFromRows = filteredFrequencies.reduce((sum, [, count]) => sum + count, 0);
                          const isOpenEndList = variable.type?.toLowerCase().includes('open end list');
                          
                          return (
                            <div className="mt-4">
                              {/* Sample Size */}
                              <p className="mb-4 text-sm text-gray-700">
                                <span className="font-semibold">Sample Size:</span> <span className="font-semibold">{totalFromRows.toLocaleString()}</span>
                              </p>
                              
                              <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
                                <div className="overflow-x-auto">
                                  <table className="min-w-full divide-y divide-gray-200">
                                    <thead className="bg-gray-50">
                                      <tr>
                                        <th className="px-4 py-2 text-left text-sm font-semibold text-gray-900">Response</th>
                                        <th className="px-4 py-2 text-center text-xs font-medium text-gray-500 uppercase tracking-wider whitespace-nowrap" style={{ width: '5rem' }}>Count</th>
                                        <th className="px-4 py-2 text-center text-xs font-medium text-gray-500 uppercase tracking-wider whitespace-nowrap" style={{ width: '5rem' }}>%</th>
                                      </tr>
                                    </thead>
                                    <tbody className="bg-white divide-y divide-gray-200">
                                      {(() => {
                                        
                                        return (
                                          <>
                                            {filteredFrequencies.map(([response, count], index) => {
                                              // Calculate percentage based on sum of displayed rows
                                              const percent = totalFromRows > 0 ? ((count / totalFromRows) * 100) : 0;
                                              
                                              return (
                                                <tr key={index}>
                                                  <td className="px-4 py-2 text-sm text-gray-900 break-words max-w-md">{response}</td>
                                                  <td className="px-4 py-2 text-sm text-gray-900 text-center" style={{ width: '5rem' }}>{count}</td>
                                                  <td className="px-4 py-2 text-sm text-gray-900 text-center" style={{ width: '5rem' }}>{percent.toFixed(1)}%</td>
                                                </tr>
                                              );
                                            })}
                                            <tr className="bg-gray-100 font-bold border-t-2 border-gray-400">
                                              <td className="px-4 py-2 text-sm text-gray-900">Total</td>
                                              <td className="px-4 py-2 text-sm text-gray-900 text-center" style={{ width: '5rem' }}>{totalFromRows}</td>
                                              <td className="px-4 py-2 text-sm text-gray-900 text-center" style={{ width: '5rem' }}>100.0%</td>
                                            </tr>
                                          </>
                                        );
                                      })()}
                                    </tbody>
                                  </table>
                                </div>
                              </div>
                            </div>
                          );
                        })()}
                                    </div>
                                  );
                                })()
                              ) : (
                  <div className="text-center py-12 text-gray-500">
                    Select a variable from the list to view its details
                            </div>
                          )}
                            </div>
                            </div>
            ) : qnrViewMode === 'banners' ? (
            /* New Banners View - Simplified */
            <div className="bg-white shadow-sm rounded-lg flex flex-col" style={{ minHeight: 0, borderRadius: 0 }}>
              {showBannerBuilder ? (
                <BannerBuilder
                  variables={variables}
                  editingGroup={editingBannerGroup}
                  existingBannerCount={newBannerGroups.length}
                  onSave={(group) => {
                    if (editingBannerGroup) {
                      setNewBannerGroups(newBannerGroups.map(g => g.id === group.id ? group : g));
                    } else {
                      setNewBannerGroups([...newBannerGroups, group]);
                    }
                    setShowBannerBuilder(false);
                    setEditingBannerGroup(null);
                  }}
                  onCancel={() => {
                    setShowBannerBuilder(false);
                    setEditingBannerGroup(null);
                  }}
                />
              ) : selectedNewBannerGroupId ? (
                /* Banner Detail View with Variables Sidebar */
                (() => {
                  const selectedGroup = newBannerGroups.find(g => g.id === selectedNewBannerGroupId);
                  if (!selectedGroup) {
                    setSelectedNewBannerGroupId(null);
                    return null;
                  }

                  return (
                    <div className="flex h-[calc(100vh-200px)]">
                      {/* Left Sidebar - Variables List */}
                      <div className="w-80 border-r border-gray-200 flex flex-col bg-white">
                        <div className="p-4 border-b border-gray-200">
                          <button
                            onClick={() => {
                              setSelectedNewBannerGroupId(null);
                              setSelectedNewBannerVariable(null);
                            }}
                            className="flex items-center gap-2 text-sm text-gray-600 hover:text-gray-900 mb-3"
                          >
                            <ArrowLeftIcon className="h-4 w-4" />
                            Back to Banner Groups
                          </button>
                          <h3 className="text-lg font-semibold text-gray-900">
                            {selectedGroup.title} <span className="font-normal text-xs italic text-gray-600">({filteredBannerVariables.length} tables)</span>
                          </h3>
                        </div>

                        {/* Sticky search bar - Same format as Variables tab */}
                        <div className="p-4 bg-white sticky top-0 z-10">
                          <div className="relative">
                            <MagnifyingGlassIcon className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-gray-400" />
                            <input
                              type="text"
                              placeholder="Search variables..."
                              value={variableFilter}
                              onChange={(e) => setVariableFilter(e.target.value)}
                              className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-orange-500"
                            />
                          </div>
                        </div>

                        {/* Scrollable variable list */}
                        <div className="flex-1 overflow-y-auto p-2">
                          <div className="space-y-1">
                            {filteredBannerVariables.map((variable) => {
                                const isSummaryTable = (variable as any).isSummaryTable && variable.statements;
                                const isScaleSummary = (variable as any).isScaleSummary && variable.statements;
                                const isNumericQuestion = variable.type?.toLowerCase().includes('numeric') && 
                                                         !variable.type?.toLowerCase().includes('grid') && 
                                                         !variable.type?.toLowerCase().includes('list') &&
                                                         !isSummaryTable;
                                // For numeric questions, codes are not needed (they have numeric values instead)
                                // For scale summary tables, codes are not needed (they use statements instead)
                                // Only show red icon for non-numeric, non-scale-summary questions that don't have codes
                                const hasNoResponseOptions = !isSummaryTable && !isScaleSummary && !isNumericQuestion && (!variable.codes || Object.keys(variable.codes).length === 0);
                                
                                return (
                                  <button
                                    key={variable.name}
                                    onClick={() => setSelectedNewBannerVariable(variable.name)}
                                    className={`w-full text-left px-3 py-2 rounded-lg text-sm transition-colors ${
                                      selectedNewBannerVariable === variable.name
                                        ? 'bg-orange-100 text-orange-900'
                                        : 'hover:bg-gray-100 text-gray-700'
                                    }`}
                                  >
                                    <div className="flex items-center justify-between gap-2 w-full">
                                      <div className="flex items-center gap-1.5 min-w-0">
                                        <span className="font-medium truncate">{variable.name}</span>
                                        {hasNoResponseOptions && (
                                          <InformationCircleIcon className="h-4 w-4 text-red-500 flex-shrink-0" title="No response options available for this variable" />
                                        )}
                                      </div>
                                      {variable.type && (
                                        <span className="text-xs text-gray-500 flex-shrink-0">
                                          {variable.type.length > 15 ? variable.type.substring(0, 15) + '...' : variable.type}
                                        </span>
                                      )}
                                    </div>
                                  </button>
                                );
                              })}
                          </div>
                        </div>
                      </div>

                      {/* Right Content Area */}
                      <div className="flex-1 flex flex-col bg-white" style={{ minHeight: 0, overflow: 'hidden' }}>
                        {selectedNewBannerVariable ? (
                          /* Show selected variable details */
                          (() => {
                            const variable = variables.find(v => v.name === selectedNewBannerVariable);
                            if (!variable) return <div className="text-center text-gray-500">Variable not found</div>;

                            // Calculate banner table data
                            const calculateBannerTableData = () => {
                              if (!selectedGroup || !fullRawData || !fullRawData.rows || fullRawData.rows.length === 0 || !columnMapping) {
                                // Return empty object instead of null so the table still renders
                                return {};
                              }

                              // Get the column header for the selected variable
                              const getColumnHeader = (varName: string): string | null => {
                                // Try different variations of the variable name
                                const variations = [
                                  varName,
                                  varName.startsWith('Q') ? varName : `Q${varName}`,
                                  varName.startsWith('Q') ? varName.substring(1) : varName
                                ];

                                // First, try columnMapping
                                for (const variation of variations) {
                                  if (columnMapping[variation]) {
                                    return columnMapping[variation];
                                  }
                                  // Try case-insensitive
                                  const matchingKey = Object.keys(columnMapping).find(
                                    key => key.toLowerCase() === variation.toLowerCase()
                                  );
                                  if (matchingKey) {
                                    return columnMapping[matchingKey];
                                  }
                                }
                                
                                // If not found in columnMapping, try direct match in fullRawData.columns
                                if (fullRawData.columns) {
                                  for (const variation of variations) {
                                    const directMatch = fullRawData.columns.find(
                                      col => col.toLowerCase() === variation.toLowerCase()
                                    );
                                    if (directMatch) {
                                      return directMatch;
                                    }
                                  }
                                }
                                
                                return null;
                              };

                              // Check if this is a summary table with statements (numeric grid summary)
                              const isSummaryTable = (variable as any).isSummaryTable && variable.statements;
                              
                              // Check if this is a scale summary table (T2B, M3B, B2B)
                              const isScaleSummary = (variable as any).isScaleSummary && variable.statements;
                              
                              // For scale summary tables, return empty data (handled separately in rendering)
                              if (isScaleSummary) {
                                return {};
                              }
                              
                              // Check if this is a numeric question (not a grid, not a summary table, not a list)
                              const isNumericQuestion = variable.type?.toLowerCase().includes('numeric') && 
                                                       !variable.type?.toLowerCase().includes('grid') && 
                                                       !variable.type?.toLowerCase().includes('list') &&
                                                       !isSummaryTable &&
                                                       !isScaleSummary;
                              
                              // For regular variables, we need the stub column header
                              // For summary tables, we don't need it (we calculate from statement variables directly)
                              // For numeric questions, try to find the column header using the variable name directly
                              let stubColumnHeader: string | null = null;
                              if (!isSummaryTable) {
                                if (isNumericQuestion && selectedNewBannerVariable) {
                                  // For numeric questions, use the same logic as getVariableDataFromRawData
                                  // to find the expected header, then get the column header from columnMapping
                                  let lookupName = selectedNewBannerVariable;
                                  
                                  // Try variations: original name, with Q prefix, with r1 suffix
                                  const variations = [
                                    lookupName,
                                    lookupName.startsWith('Q') ? lookupName : `Q${lookupName}`,
                                    lookupName.startsWith('Q') ? lookupName.substring(1) : lookupName,
                                    `${lookupName}r1`,
                                    `Q${lookupName}r1`,
                                    lookupName.startsWith('Q') ? `${lookupName.substring(1)}r1` : `${lookupName}r1`
                                  ];
                                  
                                  // Try to find expected header in columnMapping
                                  let expectedHeader: string | undefined = undefined;
                                  for (const variation of variations) {
                                    if (columnMapping[variation]) {
                                      expectedHeader = variation;
                                      break;
                                    }
                                    // Try case-insensitive
                                    const matchingKey = Object.keys(columnMapping).find(
                                      key => key.toLowerCase() === variation.toLowerCase()
                                    );
                                    if (matchingKey) {
                                      expectedHeader = matchingKey;
                                      break;
                                    }
                                  }
                                  
                                  // If found expected header, get the column header
                                  if (expectedHeader && columnMapping[expectedHeader]) {
                                    stubColumnHeader = columnMapping[expectedHeader];
                                  } else if (fullRawData.columns) {
                                    // Try direct match in fullRawData.columns
                                    for (const variation of variations) {
                                      const directMatch = fullRawData.columns.find(
                                        col => col.toLowerCase() === variation.toLowerCase()
                                      );
                                      if (directMatch) {
                                        stubColumnHeader = directMatch;
                                        break;
                                      }
                                    }
                                  }
                                } else {
                                  stubColumnHeader = getColumnHeader(selectedNewBannerVariable);
                                }
                              }
                              
                              // For numeric questions, don't return early if stubColumnHeader is null
                              // We'll handle it in the numeric question block
                              if (!isSummaryTable && !isNumericQuestion && !stubColumnHeader) {
                                // Return empty object instead of null so the table still renders
                                return {};
                              }

                              // Build column filters
                              const columns: Array<{
                                id: string;
                                title: string;
                                filterFn: (row: Record<string, any>) => boolean;
                              }> = [
                                {
                                  id: 'total',
                                  title: 'Total',
                                  filterFn: () => true // Total includes all rows
                                }
                              ];

                              // Add filters for each banner cut
                              selectedGroup.groups?.forEach(group => {
                                group.cuts.forEach(cut => {
                                  const cutVariable = variables.find(v => v.name === cut.variableName);
                                  if (!cutVariable) return;

                                  const cutColumnHeader = getColumnHeader(cut.variableName);
                                  if (!cutColumnHeader) return;

                                  columns.push({
                                    id: cut.id,
                                    title: cut.title,
                                    filterFn: (row: Record<string, any>) => {
                                      const value = row[cutColumnHeader];
                                      if (value === null || value === undefined || value === '') return false;
                                      
                                      const valueStr = String(value).trim();
                                      
                                      // Check if value matches stored codes directly
                                      const codeStr = cut.codes.map(c => String(c).trim());
                                      if (codeStr.includes(valueStr)) {
                                        return true;
                                      }
                                      
                                      // Check if value matches any of the labels for the stored codes
                                      if (cutVariable.codes) {
                                        for (const code of cut.codes) {
                                          const codeLabel = cutVariable.codes[String(code)] || cutVariable.codes[code];
                                          if (codeLabel && String(codeLabel).trim() === valueStr) {
                                            return true;
                                          }
                                        }
                                      }
                                      
                                      return false;
                                    }
                                  });
                                });
                              });

                              if (isSummaryTable && variable.statements) {
                                // For summary tables, calculate sum and mean for each statement
                                const statementData: Record<string, Record<string, { sum: number; mean: number; base: number }>> = {};
                                
                                // Extract base name from summary table name (e.g., "S11_c1_Summary" -> "S11_c1")
                                const baseName = variable.name.endsWith('_Summary') 
                                  ? variable.name.replace('_Summary', '') 
                                  : variable.name;
                                
                                Object.entries(variable.statements).forEach(([stmtCode, stmtText]) => {
                                  statementData[stmtCode] = {};
                                  
                                  // Find the statement variable name (e.g., "S11r1c1" for statement "r1" in column "c1")
                                  // The summary table name format is like "S11_c1_Summary", so we need to construct "S11r1c1"
                                  const columnMatch = baseName.match(/^([A-Z0-9]+)_(c\d+)$/i);
                                  let statementVarName: string;
                                  if (columnMatch) {
                                    const baseQNum = columnMatch[1];
                                    const columnCode = columnMatch[2];
                                    statementVarName = `${baseQNum}${stmtCode}${columnCode}`;
                                  } else {
                                    // Fallback: try to construct from baseName and stmtCode
                                    statementVarName = `${baseName}${stmtCode}`;
                                  }
                                  
                                  // Try multiple variations of the statement variable name
                                  let statementColumnHeader = getColumnHeader(statementVarName);
                                  if (!statementColumnHeader) {
                                    // Try with Q prefix
                                    statementColumnHeader = getColumnHeader(`Q${statementVarName}`);
                                  }
                                  if (!statementColumnHeader) {
                                    // Try with underscore format (e.g., S11_r1_c1)
                                    const underscoreFormat = statementVarName.replace(/([A-Z0-9]+)(r\d+)(c\d+)/i, '$1_$2_$3');
                                    statementColumnHeader = getColumnHeader(underscoreFormat);
                                  }
                                  if (!statementColumnHeader) {
                                    // Try with Q prefix and underscore format
                                    const underscoreFormat = statementVarName.replace(/([A-Z0-9]+)(r\d+)(c\d+)/i, '$1_$2_$3');
                                    statementColumnHeader = getColumnHeader(`Q${underscoreFormat}`);
                                  }
                                  
                                  if (!statementColumnHeader) {
                                    // Skip this statement if we can't find the column
                                    return;
                                  }
                                  
                                  columns.forEach(column => {
                                    let base = 0;
                                    let sum = 0;
                                    const values: number[] = [];

                                    fullRawData.rows.forEach((row: any) => {
                                      // Check if row matches the column filter (for banner cuts)
                                      const matchesColumn = column.filterFn(row);
                                      if (!matchesColumn) return;

                                      const value = row[statementColumnHeader];
                                      if (value !== null && value !== undefined && value !== '') {
                                        const numValue = parseFloat(String(value));
                                        if (!isNaN(numValue)) {
                                          base++;
                                          sum += numValue;
                                          values.push(numValue);
                                        }
                                      }
                                    });

                                    const mean = values.length > 0 ? sum / values.length : 0;

                                    statementData[stmtCode][column.id] = {
                                      sum,
                                      mean,
                                      base
                                    };
                                  });
                                });

                                return statementData;
                              }

                              // Handle numeric questions (collect all unique numeric responses)
                              // For numeric questions, always collect all unique numeric values from the data
                              if (isNumericQuestion) {
                                // If we still don't have a column header, return empty data
                                if (!stubColumnHeader) {
                                  return {};
                                }
                                
                                // Collect all unique numeric values from the data
                                const uniqueNumericValues = new Set<number>();
                                
                                fullRawData.rows.forEach((row: any) => {
                                  const stubValue = row[stubColumnHeader];
                                  if (stubValue !== null && stubValue !== undefined && stubValue !== '') {
                                    const numValue = parseFloat(String(stubValue));
                                    if (!isNaN(numValue)) {
                                      uniqueNumericValues.add(numValue);
                                    }
                                  }
                                });
                                
                                // Sort numeric values from lowest to highest
                                const sortedNumericValues = Array.from(uniqueNumericValues).sort((a, b) => a - b);
                                
                                // Calculate data for each numeric value
                                const numericData: Record<string, Record<string, { count: number; percentage: number; base: number }>> = {};
                                
                                sortedNumericValues.forEach(numericValue => {
                                  const valueKey = String(numericValue);
                                  numericData[valueKey] = {};
                                  
                                  columns.forEach(column => {
                                    let base = 0;
                                    let count = 0;

                                    fullRawData.rows.forEach((row: any) => {
                                      // Check if row matches the column filter (for banner cuts)
                                      const matchesColumn = column.filterFn(row);
                                      if (!matchesColumn) return;

                                      const stubValue = row[stubColumnHeader];
                                      if (stubValue !== null && stubValue !== undefined && stubValue !== '') {
                                        base++;
                                        
                                        const numValue = parseFloat(String(stubValue));
                                        if (!isNaN(numValue) && numValue === numericValue) {
                                          count++;
                                        }
                                      }
                                    });

                                    numericData[valueKey][column.id] = {
                                      count,
                                      percentage: base > 0 ? (count / base) * 100 : 0,
                                      base
                                    };
                                  });
                                });
                                
                                return numericData;
                              }

                              // Calculate data for each code (regular categorical variables)
                              const codeData: Record<string, Record<string, { count: number; percentage: number; base: number }>> = {};

                              if (variable.codes) {
                                Object.keys(variable.codes).forEach(code => {
                                  codeData[code] = {};
                                  
                                  columns.forEach(column => {
                                    let base = 0;
                                    let count = 0;

                                    fullRawData.rows.forEach((row: any) => {
                                      // Check if row matches the column filter (for banner cuts)
                                      const matchesColumn = column.filterFn(row);
                                      if (!matchesColumn) return;

                                      base++;
                                      
                                      // Check if stub variable value matches this code
                                      const stubValue = stubColumnHeader ? row[stubColumnHeader] : null;
                                      if (stubValue !== null && stubValue !== undefined && stubValue !== '') {
                                        const stubValueStr = String(stubValue).trim();
                                        
                                        // Check if value matches the code directly (as string or number)
                                        if (stubValueStr === code || String(stubValue) === code || Number(stubValue) === Number(code)) {
                                          count++;
                                        } else {
                                          // Check if value matches the label for this code
                                          const codeLabel = variable.codes?.[code];
                                          if (codeLabel && String(codeLabel).trim() === stubValueStr) {
                                            count++;
                                          }
                                        }
                                      }
                                    });

                                    codeData[code][column.id] = {
                                      count,
                                      percentage: base > 0 ? (count / base) * 100 : 0,
                                      base
                                    };
                                  });
                                });
                              }

                              return codeData;
                            };
                            
                            const bannerTableData = calculateBannerTableData();

                            // Calculate sample sizes for each column (only for non-summary tables)
                            const calculateSampleSizes = () => {
                              const isSummaryTable = (variable as any).isSummaryTable && variable.statements;
                              if (isSummaryTable || !selectedGroup || !fullRawData || !fullRawData.rows || fullRawData.rows.length === 0 || !columnMapping) {
                                return null;
                              }

                              // Get the column header for the selected variable
                              const getColumnHeader = (varName: string): string | null => {
                                const variations = [
                                  varName,
                                  varName.startsWith('Q') ? varName : `Q${varName}`,
                                  varName.startsWith('Q') ? varName.substring(1) : varName
                                ];

                                for (const variation of variations) {
                                  if (columnMapping[variation]) {
                                    return columnMapping[variation];
                                  }
                                  const matchingKey = Object.keys(columnMapping).find(
                                    key => key.toLowerCase() === variation.toLowerCase()
                                  );
                                  if (matchingKey) {
                                    return columnMapping[matchingKey];
                                  }
                                }
                                
                                if (fullRawData.columns) {
                                  for (const variation of variations) {
                                    const directMatch = fullRawData.columns.find(
                                      col => col.toLowerCase() === variation.toLowerCase()
                                    );
                                    if (directMatch) {
                                      return directMatch;
                                    }
                                  }
                                }
                                
                                return null;
                              };

                              // Use the same logic as calculateBannerTableData for finding column header
                              // (especially important for numeric questions)
                              let stubColumnHeader: string | null = null;
                              const isNumericQuestion = variable.type?.toLowerCase().includes('numeric') && 
                                                       !variable.type?.toLowerCase().includes('grid') && 
                                                       !variable.type?.toLowerCase().includes('list') &&
                                                       !isSummaryTable;
                              
                              if (isNumericQuestion && selectedNewBannerVariable) {
                                // For numeric questions, use the same logic as calculateBannerTableData
                                let lookupName = selectedNewBannerVariable;
                                
                                const variations = [
                                  lookupName,
                                  lookupName.startsWith('Q') ? lookupName : `Q${lookupName}`,
                                  lookupName.startsWith('Q') ? lookupName.substring(1) : lookupName,
                                  `${lookupName}r1`,
                                  `Q${lookupName}r1`,
                                  lookupName.startsWith('Q') ? `${lookupName.substring(1)}r1` : `${lookupName}r1`
                                ];
                                
                                let expectedHeader: string | undefined = undefined;
                                for (const variation of variations) {
                                  if (columnMapping[variation]) {
                                    expectedHeader = variation;
                                    break;
                                  }
                                  const matchingKey = Object.keys(columnMapping).find(
                                    key => key.toLowerCase() === variation.toLowerCase()
                                  );
                                  if (matchingKey) {
                                    expectedHeader = matchingKey;
                                    break;
                                  }
                                }
                                
                                if (expectedHeader && columnMapping[expectedHeader]) {
                                  stubColumnHeader = columnMapping[expectedHeader];
                                } else if (fullRawData.columns) {
                                  for (const variation of variations) {
                                    const directMatch = fullRawData.columns.find(
                                      col => col.toLowerCase() === variation.toLowerCase()
                                    );
                                    if (directMatch) {
                                      stubColumnHeader = directMatch;
                                      break;
                                    }
                                  }
                                }
                              } else {
                                stubColumnHeader = getColumnHeader(selectedNewBannerVariable);
                              }
                              
                              if (!stubColumnHeader) {
                                return null;
                              }

                              // Build column filters (same as in calculateBannerTableData)
                              const columns: Array<{
                                id: string;
                                title: string;
                                filterFn: (row: Record<string, any>) => boolean;
                              }> = [
                                {
                                  id: 'total',
                                  title: 'Total',
                                  filterFn: () => true
                                }
                              ];

                              selectedGroup.groups?.forEach(group => {
                                group.cuts.forEach(cut => {
                                  const cutVariable = variables.find(v => v.name === cut.variableName);
                                  if (!cutVariable) return;

                                  const cutColumnHeader = getColumnHeader(cut.variableName);
                                  if (!cutColumnHeader) return;

                                  columns.push({
                                    id: cut.id,
                                    title: cut.title,
                                    filterFn: (row: Record<string, any>) => {
                                      const value = row[cutColumnHeader];
                                      if (value === null || value === undefined || value === '') return false;
                                      
                                      const valueStr = String(value).trim();
                                      
                                      const codeStr = cut.codes.map(c => String(c).trim());
                                      if (codeStr.includes(valueStr)) {
                                        return true;
                                      }
                                      
                                      if (cutVariable.codes) {
                                        for (const code of cut.codes) {
                                          const codeLabel = cutVariable.codes[String(code)] || cutVariable.codes[code];
                                          if (codeLabel && String(codeLabel).trim() === valueStr) {
                                            return true;
                                          }
                                        }
                                      }
                                      
                                      return false;
                                    }
                                  });
                                });
                              });

                              // Calculate sample size for each column
                              const sampleSizes: Record<string, number> = {};
                              
                              columns.forEach(column => {
                                let sampleSize = 0;
                                
                                fullRawData.rows.forEach((row: any) => {
                                  // Check if row matches the column filter
                                  const matchesColumn = column.filterFn(row);
                                  if (!matchesColumn) return;
                                  
                                  // Check if the question was answered (stub value is not null/undefined/empty)
                                  const stubValue = row[stubColumnHeader];
                                  if (stubValue !== null && stubValue !== undefined && stubValue !== '') {
                                    sampleSize++;
                                  }
                                });
                                
                                sampleSizes[column.id] = sampleSize;
                              });

                              return sampleSizes;
                            };

                            const sampleSizes = calculateSampleSizes();
                            const isSummaryTable = (variable as any).isSummaryTable && variable.statements;
                            const isScaleSummary = (variable as any).isScaleSummary && variable.statements;
                            const isNumericQuestion = variable.type?.toLowerCase().includes('numeric') && 
                                                     !variable.type?.toLowerCase().includes('grid') && 
                                                     !isSummaryTable &&
                                                     !isScaleSummary;

                            return (
                              <>
                                {/* Sticky Header */}
                                <div className="flex-shrink-0 bg-white border-b border-gray-200 p-6 z-10">
                                  <div className="flex items-start gap-2 flex-wrap">
                                    <div className="flex-1 min-w-0">
                                      <h2 className="text-lg font-bold text-gray-900">{variable.name}</h2>
                                      {variable.description && (
                                        <div className="text-sm text-gray-600 mt-1">
                                          {(() => {
                                            // For summary tables, split description by newline and display summary text on new line, bolded
                                            if ((variable as any).isSummaryTable && variable.description.includes('\n')) {
                                              const descParts = variable.description.split('\n');
                                              const questionText = descParts[0];
                                              const summaryText = descParts.slice(1).join('\n'); // Handle multiple newlines
                                              
                                              return (
                                                <>
                                                  <div>{questionText}</div>
                                                  {summaryText && (
                                                    <div className="font-bold mt-1">{summaryText}</div>
                                                  )}
                                                </>
                                              );
                                            }
                                            // For scale summary tables, split by " - " and display summary name on new line, bolded
                                            const isScaleSummary = (variable as any).isScaleSummary;
                                            if (isScaleSummary && variable.description.includes(' - ')) {
                                              const descParts = variable.description.split(' - ');
                                              const questionText = descParts[0];
                                              let summaryName = descParts.slice(1).join(' - '); // Handle multiple " - " separators
                                              
                                              // Add informative rating range text based on summary table type
                                              if (variable.name.includes('_T2B')) {
                                                summaryName += ' (Rated 6-7)';
                                              } else if (variable.name.includes('_M3B')) {
                                                summaryName += ' (Rated 3-5)';
                                              } else if (variable.name.includes('_B2B')) {
                                                summaryName += ' (Rated 1-2)';
                                              }
                                              
                                              return (
                                                <>
                                                  <div>{questionText}</div>
                                                  {summaryName && (
                                                    <div className="font-bold mt-1">{summaryName}</div>
                                                  )}
                                                </>
                                              );
                                            }
                                            // For single select grid statement variables (individual tables), split by newline and bold the statement text
                                            const isSingleSelectGridStatement = variable.type?.toLowerCase().includes('single select') && 
                                                                                variable.description.includes('\n') &&
                                                                                !(variable as any).isSummaryTable;
                                            if (isSingleSelectGridStatement) {
                                              const descParts = variable.description.split('\n');
                                              const questionText = descParts[0];
                                              const statementText = descParts.slice(1).join('\n'); // Handle multiple newlines
                                              
                                              return (
                                                <>
                                                  <div>{questionText}</div>
                                                  {statementText && (
                                                    <div className="font-bold mt-1">{statementText}</div>
                                                  )}
                                                </>
                                              );
                                            }
                                            // For regular variables, display as-is
                                            return <div>{variable.description}</div>;
                                          })()}
                                        </div>
                                      )}
                                    </div>
                                    {variable.type && (
                                      <span className="text-sm italic text-gray-500 flex-shrink-0 m-0 p-0">
                                        {variable.type}
                                      </span>
                                    )}
                                  </div>
                                </div>

                                {/* Scrollable Content */}
                                <div className="flex-1 overflow-y-auto p-6" style={{ minHeight: 0 }}>
                                  {/* Show variable data with banner headers */}
                                <div className="bg-white rounded-lg overflow-hidden border border-gray-200">
                                  <div className="overflow-x-auto">
                                    <table className="min-w-full">
                                      <colgroup>
                                        <col style={{ width: '256px' }} />
                                        {/* Total column */}
                                        <col style={{ width: '120px' }} />
                                        {/* Cuts columns */}
                                        {selectedGroup.groups?.flatMap(group =>
                                          group.cuts.map(() => <col key={Math.random()} style={{ width: '120px' }} />)
                                        )}
                                      </colgroup>
                                      <thead className="sticky top-0" style={{ backgroundColor: BRAND_ORANGE }}>
                                        {/* Group titles row */}
                                        <tr>
                                          <th className="px-3 py-1.5 text-left text-xs font-bold text-white uppercase tracking-wider border-r border-white/20" rowSpan={2}>
                                          </th>
                                          {/* Total column header */}
                                          <th
                                            className="px-3 py-1.5 text-center text-xs font-bold text-white uppercase tracking-wider border-r border-white/20 align-bottom"
                                            rowSpan={2}
                                          >
                                            Total
                                          </th>
                                          {/* Group title merged cells */}
                                          {selectedGroup.groups?.map((group, groupIdx) => (
                                            <th
                                              key={`group-${groupIdx}`}
                                              className="px-3 py-1.5 text-center text-xs font-bold text-white uppercase tracking-wider border-r border-white/20 border-b border-white/20 align-bottom"
                                              colSpan={group.cuts.length}
                                            >
                                              {group.title || `Group ${groupIdx + 1}`}
                                            </th>
                                          ))}
                                        </tr>
                                        {/* Cut titles row */}
                                        <tr>
                                          {(() => {
                                            let cutIndex = 0;
                                            return selectedGroup.groups?.flatMap((group) =>
                                              group.cuts.map((cut, cutIdx) => {
                                                const letter = String.fromCharCode(65 + cutIndex); // A, B, C, etc.
                                                cutIndex++;
                                                return (
                                                  <th
                                                    key={cut.id}
                                                    className="px-3 py-1.5 text-center text-xs font-bold text-white uppercase tracking-wider border-r border-white/20 last:border-r-0"
                                                  >
                                                    <div>{cut.title || `Cut ${cutIdx + 1}`}</div>
                                                    <div className="text-xs font-medium mt-0.5">({letter})</div>
                                                  </th>
                                                );
                                              })
                                            );
                                          })()}
                                        </tr>
                                      </thead>
                                      <tbody className="bg-white divide-y divide-gray-200">
                                        {/* Total respondents row - for non-summary tables (including numeric questions) */}
                                        {!isSummaryTable && sampleSizes && (
                                          <tr className="bg-gray-100">
                                            <td className="px-3 py-1 text-sm font-medium text-gray-900 border-r border-gray-300">
                                              Total respondents
                                            </td>
                                            {/* Total column */}
                                            <td className="px-3 py-1 text-xs text-gray-900 text-center border-r border-gray-300 font-medium">
                                              {sampleSizes['total'] || 0}
                                            </td>
                                            {/* Cut columns */}
                                            {selectedGroup.groups?.flatMap((group) =>
                                              group.cuts.map((cut) => (
                                                <td key={`${cut.id}-sample`} className="px-3 py-1 text-xs text-gray-900 text-center border-r border-gray-300 last:border-r-0 font-medium">
                                                  {sampleSizes[cut.id] || 0}
                                                </td>
                                              ))
                                            )}
                                          </tr>
                                        )}
                                        {/* Scale summary table rows (T2B, M3B, B2B) */}
                                        {isScaleSummary && variable.statements && Object.entries(variable.statements).length > 0 && fullRawData && fullRawData.rows ? (
                                          (() => {
                                            // Determine which scale summary type (T2B, M3B, or B2B)
                                            const isT2B = variable.name.includes('_T2B');
                                            const isM3B = variable.name.includes('_M3B');
                                            const isB2B = variable.name.includes('_B2B');
                                            
                                            // Get base question number (e.g., "C2" from "C2_T2B")
                                            const baseQuestionNumber = getBaseQuestionNumber(variable.name);
                                            
                                            // Find all individual statement variables for this question
                                            const individualStatementVars = variables.filter(v => {
                                              const base = getBaseQuestionNumber(v.name);
                                              return base === baseQuestionNumber && 
                                                     v.type?.toLowerCase().includes('single select') &&
                                                     !(v as any).isScaleSummary &&
                                                     v.codes &&
                                                     Object.keys(v.codes).length > 0;
                                            });
                                            
                                            // Helper to get column header (reuse from calculateBannerTableData scope)
                                            const getColumnHeaderForStmt = (varName: string): string | null => {
                                              const variations = [
                                                varName,
                                                varName.startsWith('Q') ? varName : `Q${varName}`,
                                                varName.startsWith('Q') ? varName.substring(1) : varName
                                              ];
                                              
                                              for (const variation of variations) {
                                                if (columnMapping[variation]) {
                                                  return columnMapping[variation];
                                                }
                                                const matchingKey = Object.keys(columnMapping).find(
                                                  key => key.toLowerCase() === variation.toLowerCase()
                                                );
                                                if (matchingKey) {
                                                  return columnMapping[matchingKey];
                                                }
                                              }
                                              
                                              if (fullRawData.columns) {
                                                for (const variation of variations) {
                                                  const directMatch = fullRawData.columns.find(
                                                    col => col.toLowerCase() === variation.toLowerCase()
                                                  );
                                                  if (directMatch) {
                                                    return directMatch;
                                                  }
                                                }
                                              }
                                              
                                              return null;
                                            };
                                            
                                            // Build column filters (same as in calculateBannerTableData)
                                            const columns: Array<{
                                              id: string;
                                              title: string;
                                              filterFn: (row: Record<string, any>) => boolean;
                                            }> = [
                                              {
                                                id: 'total',
                                                title: 'Total',
                                                filterFn: () => true
                                              }
                                            ];
                                            
                                            selectedGroup.groups?.forEach(group => {
                                              group.cuts.forEach(cut => {
                                                const cutVariable = variables.find(v => v.name === cut.variableName);
                                                if (!cutVariable) return;
                                                
                                                const cutColumnHeader = getColumnHeaderForStmt(cut.variableName);
                                                if (!cutColumnHeader) return;
                                                
                                                columns.push({
                                                  id: cut.id,
                                                  title: cut.title,
                                                  filterFn: (row: Record<string, any>) => {
                                                    const value = row[cutColumnHeader];
                                                    if (value === null || value === undefined || value === '') return false;
                                                    const valueStr = String(value).trim();
                                                    const codeStr = cut.codes.map(c => String(c).trim());
                                                    if (codeStr.includes(valueStr)) return true;
                                                    if (cutVariable.codes) {
                                                      for (const code of cut.codes) {
                                                        const codeLabel = cutVariable.codes[String(code)] || cutVariable.codes[code];
                                                        if (codeLabel && String(codeLabel).trim() === valueStr) return true;
                                                      }
                                                    }
                                                    return false;
                                                  }
                                                });
                                              });
                                            });
                                            
                                            // Calculate scale stats for each statement variable
                                            const calculateStatementScaleStats = (stmtVar: Variable, columnId: string) => {
                                              if (!fullRawData || !fullRawData.rows || fullRawData.rows.length === 0) {
                                                return null;
                                              }
                                              
                                              const stmtVarName = stmtVar.name;
                                              const stmtColumnHeader = getColumnHeaderForStmt(stmtVarName);
                                              if (!stmtColumnHeader) return null;
                                              
                                              // Get the codes and sort them
                                              const sortedCodes = Object.keys(stmtVar.codes || {})
                                                .map(code => {
                                                  const num = parseFloat(code);
                                                  if (!isNaN(num)) return num;
                                                  const match = code.match(/\d+/);
                                                  return match ? parseFloat(match[0]) : NaN;
                                                })
                                                .filter(code => !isNaN(code))
                                                .sort((a, b) => a - b);
                                              
                                              const numCodes = sortedCodes.length;
                                              if (numCodes !== 5 && numCodes !== 7 && numCodes !== 10) {
                                                return null;
                                              }
                                              
                                              // Get counts for each code
                                              const codeCounts: { code: number; count: number }[] = [];
                                              const codeMap: Record<number, string> = {};
                                              
                                              Object.keys(stmtVar.codes || {}).forEach(originalCode => {
                                                const num = parseFloat(originalCode);
                                                if (!isNaN(num)) {
                                                  codeMap[num] = originalCode;
                                                } else {
                                                  const match = originalCode.match(/\d+/);
                                                  if (match) {
                                                    codeMap[parseFloat(match[0])] = originalCode;
                                                  }
                                                }
                                              });
                                              
                                              // Get the column filter
                                              const column = columns.find(c => c.id === columnId);
                                              if (!column) return null;
                                              
                                              sortedCodes.forEach(code => {
                                                const originalCode = codeMap[code] || String(code);
                                                let count = 0;
                                                
                                                fullRawData.rows.forEach((row: any) => {
                                                  const matchesColumn = column.filterFn(row);
                                                  if (!matchesColumn) return;
                                                  
                                                  const value = row[stmtColumnHeader];
                                                  if (value !== null && value !== undefined && value !== '') {
                                                    const valueStr = String(value).trim();
                                                    if (valueStr === originalCode || String(value) === originalCode) {
                                                      count++;
                                                    } else {
                                                      const codeLabel = stmtVar.codes?.[originalCode];
                                                      if (codeLabel && String(codeLabel).trim() === valueStr) {
                                                        count++;
                                                      }
                                                    }
                                                  }
                                                });
                                                
                                                codeCounts.push({ code, count });
                                              });
                                              
                                              const totalCount = codeCounts.reduce((sum, item) => sum + item.count, 0);
                                              if (totalCount === 0) return null;
                                              
                                              let value = 0;
                                              
                                              if (isT2B) {
                                                if (numCodes === 7) {
                                                  value = codeCounts.slice(5, 7).reduce((sum, item) => sum + item.count, 0);
                                                } else {
                                                  value = codeCounts.slice(-2).reduce((sum, item) => sum + item.count, 0);
                                                }
                                              } else if (isM3B && numCodes === 7) {
                                                value = codeCounts.slice(2, 5).reduce((sum, item) => sum + item.count, 0);
                                              } else if (isB2B) {
                                                value = codeCounts.slice(0, 2).reduce((sum, item) => sum + item.count, 0);
                                              }
                                              
                                              const percentage = totalCount > 0 ? (value / totalCount) * 100 : 0;
                                              
                                              return { count: value, percentage, base: totalCount };
                                            };
                                            
                                            return (
                                              <>
                                                {Object.entries(variable.statements).map(([stmtCode, stmtText]) => {
                                                  // Find the corresponding individual statement variable
                                                  const stmtVar = individualStatementVars.find(v => {
                                                    // Match by statement code (e.g., "r1" should match variable name ending with "r1")
                                                    return v.name.endsWith(stmtCode) || v.name.includes(stmtCode);
                                                  });
                                                  
                                                  if (!stmtVar) return null;
                                                  
                                                  // Calculate stats for each column
                                                  const totalStats = calculateStatementScaleStats(stmtVar, 'total');
                                                  const cutStats: Record<string, ReturnType<typeof calculateStatementScaleStats>> = {};
                                                  
                                                  selectedGroup.groups?.forEach(group => {
                                                    group.cuts.forEach(cut => {
                                                      const stats = calculateStatementScaleStats(stmtVar, cut.id);
                                                      if (stats) {
                                                        cutStats[cut.id] = stats;
                                                      }
                                                    });
                                                  });
                                                  
                                                  if (!totalStats) return null;
                                                  
                                                  return (
                                                    <React.Fragment key={stmtCode}>
                                                      {/* Count row */}
                                                      <tr className="hover:bg-gray-50 [&:hover+tr]:bg-gray-50">
                                                        <td className="px-3 py-1 text-sm text-gray-900 border-r border-gray-300" rowSpan={2}>
                                                          {String(stmtText)}
                                                        </td>
                                                        {/* Total column - count */}
                                                        <td className="px-3 py-1 text-xs text-gray-900 text-center border-r border-gray-300">
                                                          {totalStats.count}
                                                        </td>
                                                        {/* Cut columns - count */}
                                                        {selectedGroup.groups?.flatMap((group) =>
                                                          group.cuts.map((cut) => {
                                                            const cutData = cutStats[cut.id];
                                                            return (
                                                              <td key={`${cut.id}-count`} className="px-3 py-1 text-xs text-gray-900 text-center border-r border-gray-300 last:border-r-0">
                                                                {cutData?.count || '-'}
                                                              </td>
                                                            );
                                                          })
                                                        )}
                                                      </tr>
                                                      {/* Percentage row */}
                                                      <tr className="hover:bg-gray-50">
                                                        {/* Total column - percentage */}
                                                        <td className="px-3 py-1 text-xs text-gray-900 text-center border-r border-gray-300">
                                                          {totalStats.percentage.toFixed(1) + '%'}
                                                        </td>
                                                        {/* Cut columns - percentage */}
                                                        {selectedGroup.groups?.flatMap((group) =>
                                                          group.cuts.map((cut) => {
                                                            const cutData = cutStats[cut.id];
                                                            return (
                                                              <td key={`${cut.id}-pct`} className="px-3 py-1 text-xs text-gray-900 text-center border-r border-gray-300 last:border-r-0">
                                                                {cutData ? cutData.percentage.toFixed(1) + '%' : '-'}
                                                              </td>
                                                            );
                                                          })
                                                        )}
                                                      </tr>
                                                    </React.Fragment>
                                                  );
                                                })}
                                              </>
                                            );
                                          })()
                                        ) : ((variable as any).isSummaryTable && variable.statements && Object.entries(variable.statements).length > 0) ? (
                                          Object.entries(variable.statements).map(([stmtCode, stmtText]) => {
                                            const cellData = bannerTableData?.[stmtCode] as any;
                                            const totalData = cellData?.['total'] || { sum: 0, mean: 0, base: 0 };
                                            
                                            return (
                                              <React.Fragment key={stmtCode}>
                                                {/* Sum row */}
                                                <tr className="hover:bg-gray-50 [&:hover+tr]:bg-gray-50">
                                                  {/* Statement label - spans 2 rows */}
                                                  <td className="px-3 py-1 text-sm text-gray-900 border-r border-gray-300" rowSpan={2}>
                                                    {String(stmtText)}
                                                  </td>
                                                  {/* Total column - sum */}
                                                  <td className="px-3 py-1 text-xs text-gray-900 text-center border-r border-gray-300">
                                                    {bannerTableData ? totalData.sum.toFixed(0) : '-'}
                                                  </td>
                                                  {/* Cut columns - sum */}
                                                  {selectedGroup.groups?.flatMap((group) =>
                                                    group.cuts.map((cut) => {
                                                      const cutData = cellData?.[cut.id] || { sum: 0, mean: 0, base: 0 };
                                                      return (
                                                        <td key={`${cut.id}-sum`} className="px-3 py-1 text-xs text-gray-900 text-center border-r border-gray-300 last:border-r-0">
                                                          {bannerTableData ? cutData.sum.toFixed(0) : '-'}
                                                        </td>
                                                      );
                                                    })
                                                  )}
                                                </tr>
                                                {/* Mean row */}
                                                <tr className="hover:bg-gray-50">
                                                  {/* Total column - mean */}
                                                  <td className="px-3 py-1 text-xs text-gray-900 text-center border-r border-gray-300">
                                                    {bannerTableData ? totalData.mean.toFixed(2) : '-'}
                                                  </td>
                                                  {/* Cut columns - mean */}
                                                  {selectedGroup.groups?.flatMap((group) =>
                                                    group.cuts.map((cut) => {
                                                      const cutData = cellData?.[cut.id] || { sum: 0, mean: 0, base: 0 };
                                                      return (
                                                        <td key={`${cut.id}-mean`} className="px-3 py-1 text-xs text-gray-900 text-center border-r border-gray-300 last:border-r-0">
                                                          {bannerTableData ? cutData.mean.toFixed(2) : '-'}
                                                        </td>
                                                      );
                                                    })
                                                  )}
                                                </tr>
                                              </React.Fragment>
                                            );
                                          })
                                        ) : (variable.type?.toLowerCase().includes('numeric') && !variable.type?.toLowerCase().includes('grid') && !isSummaryTable) ? (
                                          /* Numeric questions - count and percentage rows for each unique numeric value */
                                          bannerTableData && Object.keys(bannerTableData).length > 0 ? (
                                            Object.entries(bannerTableData)
                                              .sort(([a], [b]) => {
                                                // Sort by numeric value (lowest to highest)
                                                const numA = parseFloat(a);
                                                const numB = parseFloat(b);
                                                if (!isNaN(numA) && !isNaN(numB)) {
                                                  return numA - numB;
                                                }
                                                return 0;
                                              })
                                              .map(([numericValue, cellData]: [string, any]) => {
                                              const totalData = cellData?.['total'] || { count: 0, percentage: 0, base: 0 };
                                              
                                              return (
                                                <React.Fragment key={numericValue}>
                                                  {/* Count row */}
                                                  <tr className="hover:bg-gray-50 [&:hover+tr]:bg-gray-50">
                                                    {/* Numeric value label - spans 2 rows */}
                                                    <td className="px-3 py-1 text-sm text-gray-900 border-r border-gray-300" rowSpan={2}>
                                                      {numericValue}
                                                    </td>
                                                    {/* Total column - count */}
                                                    <td className="px-3 py-1 text-xs text-gray-900 text-center border-r border-gray-300">
                                                      {bannerTableData ? totalData.count : '-'}
                                                    </td>
                                                    {/* Cut columns - count */}
                                                    {selectedGroup.groups?.flatMap((group) =>
                                                      group.cuts.map((cut) => {
                                                        const cutData = cellData?.[cut.id] || { count: 0, percentage: 0, base: 0 };
                                                        return (
                                                          <td key={`${cut.id}-count`} className="px-3 py-1 text-xs text-gray-900 text-center border-r border-gray-300 last:border-r-0">
                                                            {bannerTableData ? cutData.count : '-'}
                                                          </td>
                                                        );
                                                      })
                                                    )}
                                                  </tr>
                                                  {/* Percentage row */}
                                                  <tr className="hover:bg-gray-50">
                                                    {/* Total column - percentage */}
                                                    <td className="px-3 py-1 text-xs text-gray-900 text-center border-r border-gray-300">
                                                      {bannerTableData ? totalData.percentage.toFixed(1) + '%' : '-'}
                                                    </td>
                                                    {/* Cut columns - percentage */}
                                                    {selectedGroup.groups?.flatMap((group) =>
                                                      group.cuts.map((cut) => {
                                                        const cutData = cellData?.[cut.id] || { count: 0, percentage: 0, base: 0 };
                                                        return (
                                                          <td key={`${cut.id}-pct`} className="px-3 py-1 text-xs text-gray-900 text-center border-r border-gray-300 last:border-r-0">
                                                            {bannerTableData ? cutData.percentage.toFixed(1) + '%' : '-'}
                                                          </td>
                                                        );
                                                      })
                                                    )}
                                                  </tr>
                                                </React.Fragment>
                                              );
                                            })
                                          ) : (
                                            <tr>
                                              <td className="px-3 py-8 text-center text-gray-400 text-sm" colSpan={1 + 1 + (selectedGroup.groups?.reduce((sum, g) => sum + g.cuts.length, 0) || 0)}>
                                                No numeric responses found for this variable
                                              </td>
                                            </tr>
                                          )
                                        ) : variable.codes && Object.entries(variable.codes).length > 0 ? (
                                          /* Regular categorical variables - count and percentage rows */
                                          Object.entries(variable.codes).map(([code, label], rowIdx) => {
                                            const cellData = bannerTableData?.[code] as any;
                                            const totalData = cellData?.['total'] || { count: 0, percentage: 0, base: 0 };
                                            
                                            return (
                                              <React.Fragment key={code}>
                                                {/* Count row */}
                                                <tr className="hover:bg-gray-50 [&:hover+tr]:bg-gray-50">
                                                  {/* Response option label - spans 2 rows */}
                                                  <td className="px-3 py-1 text-sm text-gray-900 border-r border-gray-300" rowSpan={2}>
                                                    {String(label)}
                                                  </td>
                                                  {/* Total column - count */}
                                                  <td className="px-3 py-1 text-xs text-gray-900 text-center border-r border-gray-300">
                                                    {bannerTableData ? totalData.count : '-'}
                                                  </td>
                                                  {/* Cut columns - count */}
                                                  {selectedGroup.groups?.flatMap((group) =>
                                                    group.cuts.map((cut) => {
                                                      const cutData = cellData?.[cut.id] || { count: 0, percentage: 0, base: 0 };
                                                      return (
                                                        <td key={`${cut.id}-count`} className="px-3 py-1 text-xs text-gray-900 text-center border-r border-gray-300 last:border-r-0">
                                                          {bannerTableData ? cutData.count : '-'}
                                                        </td>
                                                      );
                                                    })
                                                  )}
                                                </tr>
                                                {/* Percentage row */}
                                                <tr className="hover:bg-gray-50">
                                                  {/* Total column - percentage */}
                                                  <td className="px-3 py-1 text-xs text-gray-900 text-center border-r border-gray-300">
                                                    {bannerTableData ? totalData.percentage.toFixed(1) + '%' : '-'}
                                                  </td>
                                                  {/* Cut columns - percentage */}
                                                  {selectedGroup.groups?.flatMap((group) =>
                                                    group.cuts.map((cut) => {
                                                      const cutData = cellData?.[cut.id] || { count: 0, percentage: 0, base: 0 };
                                                      return (
                                                        <td key={`${cut.id}-pct`} className="px-3 py-1 text-xs text-gray-900 text-center border-r border-gray-300 last:border-r-0">
                                                          {bannerTableData ? cutData.percentage.toFixed(1) + '%' : '-'}
                                                        </td>
                                                      );
                                                    })
                                                  )}
                                                </tr>
                                              </React.Fragment>
                                            );
                                          })
                                        ) : (
                                          <tr>
                                            <td className="px-3 py-8 text-center text-gray-400 text-sm" colSpan={1 + 1 + (selectedGroup.groups?.reduce((sum, g) => sum + g.cuts.length, 0) || 0)}>
                                              No response options available for this variable
                                            </td>
                                          </tr>
                                        )}
                                        
                                        {/* Scale statistics rows for single select questions with scale tag (not scale summary tables) */}
                                        {(() => {
                                          // Check if variable has scale tag, or check the question for scale tag
                                          const hasScaleTagOnVariable = variable.tags && Array.isArray(variable.tags) && variable.tags.includes('Scale');
                                          
                                          // Also check the question for scale tag (in case variable doesn't have it)
                                          let hasScaleTag = hasScaleTagOnVariable;
                                          if (!hasScaleTagOnVariable) {
                                            const baseQuestionNumber = getBaseQuestionNumber(variable.name);
                                            const question = questionnaireQuestions.find(q => {
                                              const qNum = q.number || q.id;
                                              return String(qNum) === baseQuestionNumber || String(qNum) === baseQuestionNumber.replace(/^Q/, '');
                                            });
                                            hasScaleTag = question?.tags && Array.isArray(question.tags) && question.tags.includes('Scale');
                                          }
                                          
                                          // Check if this is a single select question (regular or grid statement variable)
                                          // For grids, we want individual statement variables, not the main grid variable
                                          const isSingleSelect = variable.type?.toLowerCase().includes('single select');
                                          const isNotScaleSummary = !(variable as any).isScaleSummary;
                                          
                                          // Debug logging
                                          console.log('Scale stats debug:', {
                                            variableName: variable.name,
                                            hasScaleTagOnVariable,
                                            hasScaleTag,
                                            isSingleSelect,
                                            isNotScaleSummary,
                                            hasCodes: !!variable.codes,
                                            hasBannerTableData: !!bannerTableData,
                                            variableType: variable.type,
                                            variableTags: variable.tags
                                          });
                                          
                                          // Only show for single select questions with scale tag that are NOT scale summary tables
                                          // This includes both regular single select questions and individual statement variables from single select grids
                                          if (!hasScaleTag || !isSingleSelect || !isNotScaleSummary || !variable.codes || !bannerTableData) {
                                            return null;
                                          }
                                          
                                          // Get sorted codes (as numbers) to determine scale length
                                          // Handle codes that might have prefixes like 'c1', 'c2', etc. or just be numbers
                                          const sortedCodes = Object.keys(variable.codes)
                                            .map(code => {
                                              // Try to parse as number first
                                              const num = parseFloat(code);
                                              if (!isNaN(num)) {
                                                return num;
                                              }
                                              // If that fails, try to extract number from prefix (e.g., 'c1' -> 1, 'r2' -> 2)
                                              const match = code.match(/\d+/);
                                              if (match) {
                                                return parseFloat(match[0]);
                                              }
                                              return NaN;
                                            })
                                            .filter(code => !isNaN(code))
                                            .sort((a, b) => a - b);
                                          
                                          const numCodes = sortedCodes.length;
                                          
                                          console.log('Scale stats codes debug:', {
                                            numCodes,
                                            sortedCodes,
                                            allCodes: Object.keys(variable.codes)
                                          });
                                          
                                          // Only calculate for 5, 7, or 10 point scales
                                          if (numCodes !== 5 && numCodes !== 7 && numCodes !== 10) {
                                            return null;
                                          }
                                          
                                          // Calculate scale statistics for each column
                                          const calculateScaleStats = (columnId: string) => {
                                            // Get counts for each code in order
                                            // We need to map sorted numeric codes back to the original code keys
                                            const codeCounts: { code: number; count: number; base: number; originalCode: string }[] = [];
                                            
                                            // Create a map of numeric value to original code key
                                            const codeMap: Record<number, string> = {};
                                            Object.keys(variable.codes).forEach(originalCode => {
                                              const num = parseFloat(originalCode);
                                              if (!isNaN(num)) {
                                                codeMap[num] = originalCode;
                                              } else {
                                                const match = originalCode.match(/\d+/);
                                                if (match) {
                                                  const numValue = parseFloat(match[0]);
                                                  codeMap[numValue] = originalCode;
                                                }
                                              }
                                            });
                                            
                                            sortedCodes.forEach(code => {
                                              const originalCode = codeMap[code] || String(code);
                                              const cellData = bannerTableData?.[originalCode] as any;
                                              const columnData = cellData?.[columnId] || { count: 0, percentage: 0, base: 0 };
                                              codeCounts.push({
                                                code,
                                                count: columnData.count || 0,
                                                base: columnData.base || 0,
                                                originalCode
                                              });
                                            });
                                            
                                            const totalCount = codeCounts.reduce((sum, item) => sum + item.count, 0);
                                            
                                            if (totalCount === 0) {
                                              return null;
                                            }
                                            
                                            let t2b = 0;
                                            let m3b = 0;
                                            let b2b = 0;
                                            let mean = 0;
                                            
                                            if (numCodes === 7) {
                                              // 7-point scale: T2B (top 2), M3B (middle 3), B2B (bottom 2)
                                              // Codes are sorted ascending, so last 2 are top, first 2 are bottom
                                              t2b = codeCounts.slice(5, 7).reduce((sum, item) => sum + item.count, 0);
                                              m3b = codeCounts.slice(2, 5).reduce((sum, item) => sum + item.count, 0);
                                              b2b = codeCounts.slice(0, 2).reduce((sum, item) => sum + item.count, 0);
                                              
                                              // Mean: weighted average using actual code values
                                              let weightedSum = 0;
                                              codeCounts.forEach((item) => {
                                                weightedSum += item.count * item.code;
                                              });
                                              mean = weightedSum / totalCount;
                                            } else if (numCodes === 5 || numCodes === 10) {
                                              // 5-point or 10-point scale: T2B (top 2), B2B (bottom 2)
                                              t2b = codeCounts.slice(-2).reduce((sum, item) => sum + item.count, 0);
                                              b2b = codeCounts.slice(0, 2).reduce((sum, item) => sum + item.count, 0);
                                              
                                              // Mean: weighted average using actual code values
                                              let weightedSum = 0;
                                              codeCounts.forEach((item) => {
                                                weightedSum += item.count * item.code;
                                              });
                                              mean = weightedSum / totalCount;
                                            }
                                            
                                            // Calculate percentages
                                            const t2bPercentage = totalCount > 0 ? (t2b / totalCount) * 100 : 0;
                                            const m3bPercentage = numCodes === 7 && totalCount > 0 ? (m3b / totalCount) * 100 : 0;
                                            const b2bPercentage = totalCount > 0 ? (b2b / totalCount) * 100 : 0;
                                            
                                            return {
                                              t2b,
                                              t2bPercentage,
                                              m3b: numCodes === 7 ? m3b : undefined,
                                              m3bPercentage: numCodes === 7 ? m3bPercentage : undefined,
                                              b2b,
                                              b2bPercentage,
                                              mean,
                                              totalCount
                                            };
                                          };
                                          
                                          const totalStats = calculateScaleStats('total');
                                          const cutStats: Record<string, ReturnType<typeof calculateScaleStats>> = {};
                                          
                                          selectedGroup.groups?.forEach(group => {
                                            group.cuts.forEach(cut => {
                                              cutStats[cut.id] = calculateScaleStats(cut.id);
                                            });
                                          });
                                          
                                          if (!totalStats) {
                                            return null;
                                          }
                                          
                                          // T2B, M3B, B2B rows (with count and percentage)
                                          const boxStatsRows = [
                                            { label: 'T2B', getCount: (stats: ReturnType<typeof calculateScaleStats> | null) => stats?.t2b?.toFixed(0) || '-', getPercentage: (stats: ReturnType<typeof calculateScaleStats> | null) => stats?.t2bPercentage?.toFixed(1) + '%' || '-' },
                                            ...(numCodes === 7 ? [{ label: 'M3B', getCount: (stats: ReturnType<typeof calculateScaleStats> | null) => stats?.m3b?.toFixed(0) || '-', getPercentage: (stats: ReturnType<typeof calculateScaleStats> | null) => stats?.m3bPercentage?.toFixed(1) + '%' || '-' }] : []),
                                            { label: 'B2B', getCount: (stats: ReturnType<typeof calculateScaleStats> | null) => stats?.b2b?.toFixed(0) || '-', getPercentage: (stats: ReturnType<typeof calculateScaleStats> | null) => stats?.b2bPercentage?.toFixed(1) + '%' || '-' }
                                          ];
                                          
                                          return (
                                            <>
                                              {boxStatsRows.map((statRow) => (
                                                <React.Fragment key={statRow.label}>
                                                  {/* Count row */}
                                                  <tr className="bg-gray-50 hover:bg-gray-100 [&:hover+tr]:bg-gray-100">
                                                    <td className="px-3 py-1 text-sm font-medium text-gray-900 border-r border-gray-300" rowSpan={2}>
                                                      {statRow.label}
                                                    </td>
                                                    {/* Total column - count */}
                                                    <td className="px-3 py-1 text-xs text-gray-900 text-center border-r border-gray-300">
                                                      {statRow.getCount(totalStats)}
                                                    </td>
                                                    {/* Cut columns - count */}
                                                    {selectedGroup.groups?.flatMap((group) =>
                                                      group.cuts.map((cut) => (
                                                        <td key={`${cut.id}-${statRow.label}-count`} className="px-3 py-1 text-xs text-gray-900 text-center border-r border-gray-300 last:border-r-0">
                                                          {statRow.getCount(cutStats[cut.id] || null)}
                                                        </td>
                                                      ))
                                                    )}
                                                  </tr>
                                                  {/* Percentage row */}
                                                  <tr className="bg-gray-50 hover:bg-gray-100">
                                                    {/* Total column - percentage */}
                                                    <td className="px-3 py-1 text-xs text-gray-900 text-center border-r border-gray-300">
                                                      {statRow.getPercentage(totalStats)}
                                                    </td>
                                                    {/* Cut columns - percentage */}
                                                    {selectedGroup.groups?.flatMap((group) =>
                                                      group.cuts.map((cut) => (
                                                        <td key={`${cut.id}-${statRow.label}-pct`} className="px-3 py-1 text-xs text-gray-900 text-center border-r border-gray-300 last:border-r-0">
                                                          {statRow.getPercentage(cutStats[cut.id] || null)}
                                                        </td>
                                                      ))
                                                    )}
                                                  </tr>
                                                </React.Fragment>
                                              ))}
                                              {/* Mean row (single row, no percentage) */}
                                              <tr className="bg-gray-50 hover:bg-gray-100">
                                                <td className="px-3 py-1 text-sm font-medium text-gray-900 border-r border-gray-300">
                                                  Mean
                                                </td>
                                                {/* Total column */}
                                                <td className="px-3 py-1 text-xs text-gray-900 text-center border-r border-gray-300">
                                                  {totalStats?.mean?.toFixed(2) || '-'}
                                                </td>
                                                {/* Cut columns */}
                                                {selectedGroup.groups?.flatMap((group) =>
                                                  group.cuts.map((cut) => (
                                                    <td key={`${cut.id}-mean`} className="px-3 py-1 text-xs text-gray-900 text-center border-r border-gray-300 last:border-r-0">
                                                      {cutStats[cut.id]?.mean?.toFixed(2) || '-'}
                                                    </td>
                                                  ))
                                                )}
                                              </tr>
                                            </>
                                          );
                                        })()}
                                        
                                        {/* Statistics rows for numeric questions */}
                                        {isNumericQuestion && bannerTableData && Object.keys(bannerTableData).length > 0 && (() => {
                                          // Calculate statistics for each column
                                          const calculateStats = (columnId: string) => {
                                            const values: number[] = [];
                                            
                                            // Collect all numeric values for this column
                                            Object.entries(bannerTableData).forEach(([numericValue, cellData]: [string, any]) => {
                                              const columnData = (cellData as any)?.[columnId] || { count: 0, base: 0 };
                                              const numValue = parseFloat(numericValue);
                                              if (!isNaN(numValue) && columnData.count > 0) {
                                                // Add this numeric value 'count' times
                                                for (let i = 0; i < columnData.count; i++) {
                                                  values.push(numValue);
                                                }
                                              }
                                            });
                                            
                                            if (values.length === 0) {
                                              return null;
                                            }
                                            
                                            const sorted = [...values].sort((a, b) => a - b);
                                            const sum = values.reduce((a, b) => a + b, 0);
                                            const mean = sum / values.length;
                                            const median = sorted.length % 2 === 0
                                              ? (sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2
                                              : sorted[Math.floor(sorted.length / 2)];
                                            
                                            // Calculate mode
                                            const frequency: Record<number, number> = {};
                                            values.forEach(v => {
                                              frequency[v] = (frequency[v] || 0) + 1;
                                            });
                                            let mode: number | undefined = undefined;
                                            let maxFreq = 0;
                                            Object.entries(frequency).forEach(([val, freq]) => {
                                              if (freq > maxFreq) {
                                                maxFreq = freq;
                                                mode = parseFloat(val);
                                              }
                                            });
                                            
                                            // Calculate standard deviation
                                            const variance = values.reduce((acc, val) => acc + Math.pow(val - mean, 2), 0) / values.length;
                                            const stdDev = Math.sqrt(variance);
                                            
                                            return {
                                              mean,
                                              median,
                                              mode: mode !== undefined ? mode : undefined,
                                              stdDev,
                                              min: sorted[0],
                                              max: sorted[sorted.length - 1],
                                              sum,
                                              count: values.length
                                            };
                                          };
                                          
                                          const totalStats = calculateStats('total');
                                          const cutStats: Record<string, ReturnType<typeof calculateStats>> = {};
                                          
                                          selectedGroup.groups?.forEach(group => {
                                            group.cuts.forEach(cut => {
                                              cutStats[cut.id] = calculateStats(cut.id);
                                            });
                                          });
                                          
                                          if (!totalStats) {
                                            return null;
                                          }
                                          
                                          const statsRows = [
                                            { label: 'Mean', getValue: (stats: ReturnType<typeof calculateStats> | null) => stats?.mean?.toFixed(2) || '-' },
                                            { label: 'Sum', getValue: (stats: ReturnType<typeof calculateStats> | null) => stats?.sum?.toFixed(0) || '-' },
                                            { label: 'Median', getValue: (stats: ReturnType<typeof calculateStats> | null) => stats?.median?.toFixed(2) || '-' },
                                            { label: 'Mode', getValue: (stats: ReturnType<typeof calculateStats> | null) => stats?.mode !== undefined ? stats.mode.toFixed(2) : '-' },
                                            { label: 'Std Dev', getValue: (stats: ReturnType<typeof calculateStats> | null) => stats?.stdDev?.toFixed(2) || '-' },
                                            { label: 'Low', getValue: (stats: ReturnType<typeof calculateStats> | null) => stats?.min?.toFixed(2) || '-' },
                                            { label: 'High', getValue: (stats: ReturnType<typeof calculateStats> | null) => stats?.max?.toFixed(2) || '-' }
                                          ];
                                          
                                          return (
                                            <>
                                              {statsRows.map((statRow) => (
                                                <tr key={statRow.label} className="bg-gray-50 hover:bg-gray-100">
                                                  <td className="px-3 py-1 text-sm font-medium text-gray-900 border-r border-gray-300">
                                                    {statRow.label}
                                                  </td>
                                                  {/* Total column */}
                                                  <td className="px-3 py-1 text-xs text-gray-900 text-center border-r border-gray-300">
                                                    {statRow.getValue(totalStats)}
                                                  </td>
                                                  {/* Cut columns */}
                                                  {selectedGroup.groups?.flatMap((group) =>
                                                    group.cuts.map((cut) => (
                                                      <td key={`${cut.id}-${statRow.label}`} className="px-3 py-1 text-xs text-gray-900 text-center border-r border-gray-300 last:border-r-0">
                                                        {statRow.getValue(cutStats[cut.id] || null)}
                                                      </td>
                                                    ))
                                                  )}
                                                </tr>
                                              ))}
                                            </>
                                          );
                                        })()}
                                      </tbody>
                                    </table>
                                  </div>
                                </div>
                                </div>
                              </>
                            );
                          })()
                        ) : (
                          /* Show banner group details when no variable is selected */
                          <div className="text-center py-12">
                            <IconTable className="h-16 w-16 text-gray-300 mx-auto mb-4" />
                            <h3 className="text-lg font-medium text-gray-900 mb-2">Select a Variable</h3>
                            <p className="text-gray-600">Choose a variable from the list to view its details</p>
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })()
              ) : (
                /* Banner Groups List */
                <div className="flex flex-col flex-1 p-6">
                  <div className="flex items-center justify-between mb-6">
                    <h3 className="text-lg font-semibold text-gray-900">Banner Groups</h3>
                    <button
                      onClick={() => {
                        setEditingBannerGroup(null);
                        setShowBannerBuilder(true);
                      }}
                      className="flex items-center gap-2 px-4 py-2 text-sm text-white rounded-lg hover:opacity-90"
                      style={{ backgroundColor: BRAND_ORANGE }}
                    >
                      <PlusCircleIcon className="h-5 w-5" />
                      Create Banner Group
                    </button>
                  </div>
                  {newBannerGroups.length === 0 ? (
                    <div className="text-center py-12">
                      <IconTable className="h-16 w-16 text-gray-300 mx-auto mb-4" />
                      <h3 className="text-lg font-medium text-gray-900 mb-2">No Banner Groups</h3>
                      <p className="text-gray-600 mb-4">Create banner groups to organize your cross-tabulations</p>
                      <button
                        onClick={() => {
                          setEditingBannerGroup(null);
                          setShowBannerBuilder(true);
                        }}
                        className="flex items-center gap-2 px-4 py-2 text-sm text-white rounded-lg hover:opacity-90 mx-auto"
                        style={{ backgroundColor: BRAND_ORANGE }}
                      >
                        <PlusCircleIcon className="h-5 w-5" />
                        Create Banner Group
                      </button>
                    </div>
                  ) : (
                    <div className="grid grid-cols-1 gap-4">
                      {newBannerGroups.map((group) => (
                        <div
                          key={group.id}
                          onClick={() => setSelectedNewBannerGroupId(group.id)}
                          className="border border-gray-200 rounded-lg p-4 hover:border-gray-300 hover:shadow-md transition-all cursor-pointer"
                        >
                          <div className="flex items-center justify-between">
                            <div className="flex-1">
                              <h4 className="text-md font-semibold text-gray-900 mb-1">{group.title}</h4>
                              <p className="text-sm text-gray-600">
                                {group.groups && group.groups.length > 0 && (
                                  <>
                                    {group.groups.length} {group.groups.length === 1 ? 'sub-group' : 'sub-groups'} • {' '}
                                    {group.groups.reduce((sum, g) => sum + g.cuts.length, 0)} {group.groups.reduce((sum, g) => sum + g.cuts.length, 0) === 1 ? 'cut' : 'cuts'}
                                  </>
                                )}
                              </p>
                            </div>
                            <div className="flex items-center gap-2">
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setEditingBannerGroup(group);
                                  setShowBannerBuilder(true);
                                }}
                                className="p-2 text-gray-400 hover:text-orange-600 hover:bg-orange-50 rounded-lg transition-colors"
                                title="Edit banner group"
                              >
                                <PencilIcon className="h-5 w-5" />
                              </button>
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  if (confirm('Are you sure you want to delete this banner group?')) {
                                    setNewBannerGroups(newBannerGroups.filter(g => g.id !== group.id));
                                  }
                                }}
                                className="p-2 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                                title="Delete banner group"
                              >
                                <TrashIcon className="h-5 w-5" />
                              </button>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
            ) : qnrViewMode === 'rawdata' ? (
            /* Raw Data View */
            <div key={`rawdata-${selectedQuestionnaire?.id}-${questionnaireQuestions.map(q => `${q.id || q.number}:${q.type || ''}`).join('|')}`} className="p-6">
              <h3 className="text-lg font-semibold text-gray-900 mb-4">Raw Data</h3>

              {(() => {
                  // Load full raw data if not already loaded
                  if (!fullRawData && !loadingFullRawData && selectedQuestionnaire) {
                    loadFullRawData();
                    return <div className="text-center py-8 text-gray-500">Loading data...</div>;
                  }

                  if (loadingFullRawData) {
                    return <div className="text-center py-8 text-gray-500">Loading data...</div>;
                  }

                  if (!fullRawData || !fullRawData.rows || fullRawData.rows.length === 0) {
                    return (
                      <div className="text-center py-8">
                        <p className="text-sm text-gray-500">No data available. Please upload a data file first.</p>
                      </div>
                    );
                  }

                  if (!variables || variables.length === 0) {
                    return (
                      <div className="text-center py-8">
                        <p className="text-sm text-gray-500">No variables available</p>
                        <p className="text-xs text-gray-400 mt-2">Sync with QNR to load variables</p>
                      </div>
                    );
                  }

                  // Get all expected headers from all variables
                  const allExpectedHeaders: string[] = [];
                  const baseQuestionMap = new Map<string, { baseNumber: string; type: string; variables: Variable[] }>();

                  variables.forEach((variable) => {
                    // Skip summary table variables
                    if (variable.name.endsWith('_Summary Tables') ||
                        variable.name.endsWith('_T2B') ||
                        variable.name.endsWith('_B2B') ||
                        variable.name.endsWith('_M3B') ||
                        (variable as any).isSummaryTable) {
                      return;
                    }

                    const baseNumber = getBaseQuestionNumber(variable.name);
                    if (!baseQuestionMap.has(baseNumber)) {
                      const question = questionnaireQuestions.find(q => {
                        const qNum = q.number || q.id;
                        return qNum === baseNumber ||
                               qNum === baseNumber.replace(/^Q/, '') ||
                               String(qNum) === String(baseNumber);
                      });
                      const questionType = question?.type || variable.type || '';

                      baseQuestionMap.set(baseNumber, {
                        baseNumber,
                        type: questionType,
                        variables: []
                      });
                    }
                    baseQuestionMap.get(baseNumber)!.variables.push(variable);
                  });

                  baseQuestionMap.forEach((group) => {
                    const expectedHeaders = getExpectedColumnHeadersForBase(group.baseNumber, variables);
                    allExpectedHeaders.push(...expectedHeaders);
                  });

                  // Always include "record" as the first column if it exists in the data
                  const finalHeaders: string[] = [];
                  if (fullRawData.columns.includes('record')) {
                    finalHeaders.push('record');
                  }
                  finalHeaders.push(...allExpectedHeaders);

                  // Filter to only show headers that are mapped
                  const mappedHeaders = finalHeaders.filter(header => {
                    if (header === 'record') return true; // Always show record column
                    return columnMapping && columnMapping[header] && columnMapping[header] !== '';
                  });

                  // Get data rows from full raw data, matching by column headers
                  const dataRows = fullRawData.rows.map((rawRow: any) => {
                    const row: Record<string, any> = {};
                    mappedHeaders.forEach((header) => {
                      if (header === 'record') {
                        // Use record column directly from raw data
                        row[header] = rawRow['record'] ?? null;
                      } else {
                        // Get the matched column header from columnMapping
                        const matchedColumnHeader = columnMapping?.[header];
                        if (matchedColumnHeader && rawRow.hasOwnProperty(matchedColumnHeader)) {
                          const value = rawRow[matchedColumnHeader];
                          // Normalize empty values
                          if (value === null || value === undefined || value === '') {
                            row[header] = null;
                          } else if (typeof value === 'string' && value.trim() === '') {
                            row[header] = null;
                          } else {
                            row[header] = value;
                          }
                        } else {
                          row[header] = null;
                        }
                      }
                    });
                    return row;
                  });

                  return (
                    <div className="border border-gray-200 rounded-lg overflow-hidden flex flex-col" style={{ maxHeight: 'calc(100vh - 200px)' }}>
                      <div className="overflow-y-auto overflow-x-auto flex-1">
                        <table className="min-w-full divide-y divide-gray-200">
                          <thead className="bg-gray-50">
                            <tr>
                              {mappedHeaders.map((header, idx) => {
                                // Get the mapped column header from columnMapping to show the actual column name from the data file
                                const mappedHeader = header === 'record' ? 'record' : (columnMapping?.[header] || '');
                                
                                return (
                                  <th 
                                    key={idx} 
                                    className="px-4 py-3 text-left text-xs font-medium text-gray-500 tracking-wider whitespace-nowrap bg-gray-50"
                                    style={{ position: 'sticky', top: 0, zIndex: 20 }}
                                  >
                                    {mappedHeader}
                                  </th>
                                );
                              })}
                            </tr>
                            <tr className="bg-gray-100">
                              {mappedHeaders.map((header, idx) => {
                                // Show the expected header (e.g., QS14r1c1) in the second row
                                return (
                                  <th 
                                    key={idx} 
                                    className="px-4 py-2 text-left text-xs font-normal text-gray-600 italic whitespace-nowrap bg-gray-100"
                                    style={{ position: 'sticky', top: '48px', zIndex: 20 }}
                                  >
                                    {header}
                                  </th>
                                );
                              })}
                            </tr>
                          </thead>
                          <tbody className="bg-white divide-y divide-gray-200">
                            {dataRows.length > 0 ? (
                              dataRows.map((row, rowIdx) => (
                                <tr key={rowIdx}>
                                  {mappedHeaders.map((header, colIdx) => {
                                    const cellValue = row[header];
                                    // Display empty cells (null, undefined, or empty string) as "-"
                                    const displayValue = (cellValue === null || cellValue === undefined || cellValue === '') 
                                      ? '-' 
                                      : String(cellValue);
                                    
                                    return (
                                      <td key={colIdx} className="px-4 py-3 text-sm text-gray-500 whitespace-nowrap">
                                        {displayValue}
                                      </td>
                                    );
                                  })}
                                </tr>
                              ))
                            ) : (
                              <tr>
                                <td colSpan={mappedHeaders.length} className="px-4 py-8 text-center text-sm text-gray-500">
                                  No data available.
                                </td>
                              </tr>
                            )}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  );
                })()}
            </div>
            ) : (
            /* Data Upload View */
            <div className="p-6">
                  <div className="flex items-center justify-between mb-4">
                    <h3 className="text-lg font-semibold text-gray-900">Data File</h3>
                    {!uploadedFileInfo && (
                      <button
                        onClick={() => document.getElementById('data-file-upload')?.click()}
                        className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-white rounded-lg shadow-sm transition-colors hover:opacity-90"
                        style={{ backgroundColor: BRAND_ORANGE }}
                      >
                        <CloudArrowUpIcon className="h-4 w-4" />
                        Upload Data File
                      </button>
                    )}
                  </div>

                  {uploadedFileInfo ? (
                    <div className="border border-gray-200 rounded-lg overflow-hidden">
                                          <table className="w-full divide-y divide-gray-200">
                                            <thead className="bg-gray-50">
                                              <tr>
                            <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">File Name</th>
                            <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Date Uploaded</th>
                            <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider whitespace-nowrap"></th>
                                              </tr>
                                            </thead>
                                            <tbody className="bg-white divide-y divide-gray-200">
                          <tr>
                            <td className="px-4 py-3 text-sm text-gray-500 truncate" title={uploadedFileInfo.fileName}>{uploadedFileInfo.fileName}</td>
                            <td className="px-4 py-3 text-sm text-gray-500">
                              {new Date(uploadedFileInfo.uploadedAt).toLocaleDateString()} {new Date(uploadedFileInfo.uploadedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                                                  </td>
                            <td className="px-4 py-3 text-sm text-right whitespace-nowrap">
                              <div className="flex items-center justify-end gap-2 flex-wrap">
                              {uploadedFileInfo.processed ? (
                                <button
                                  onClick={async (e) => {
                                    e.stopPropagation();
                                    // Clear all mappings
                                    const newMapping = {};
                                    setColumnMapping(newMapping);
                                    setHasAttemptedMapping(false);
                                    
                                    // Update uploadedFileInfo immediately to show mapping button
                                    if (uploadedFileInfo) {
                                      setUploadedFileInfo({
                                        ...uploadedFileInfo,
                                        processed: false
                                      });
                                    }
                                    
                                    // Save to backend
                                    if (selectedQuestionnaire) {
                                      try {
                                        const saveResponse = await fetch(`${API_BASE_URL}/api/questionnaire/map-columns`, {
                                          method: 'POST',
                                          headers: {
                                            'Content-Type': 'application/json',
                                          },
                                          body: JSON.stringify({
                                            questionnaireId: selectedQuestionnaire.id,
                                            variableNames: variables.map(v => v.name),
                                            dataHeaders: columnHeaders,
                                            mapping: newMapping
                                          })
                                        });
                                        if (saveResponse.ok) {
                                          // Wait a bit for the backend to persist, then reload
                                          await new Promise(resolve => setTimeout(resolve, 300));
                                          debouncedLoadFileInfo(500);
                                        } else {
                                          console.error('Failed to save unmapping:', await saveResponse.text());
                                        }
                                      } catch (error) {
                                        console.error('Error saving unmapping:', error);
                                      }
                                    }
                                  }}
                                  className="inline-flex items-center gap-1 px-2 py-1.5 text-xs font-medium rounded bg-green-100 text-green-800 hover:bg-green-200 transition-colors cursor-pointer"
                                  title="Click to unmap all variables"
                                >
                                  <span>Mapped</span>
                                  <svg className="w-3 h-3 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                                  </svg>
                                </button>
                              ) : (
                                <button
                                  onClick={async () => {
                                    if (!selectedQuestionnaire || columnHeaders.length === 0 || variables.length === 0) {
                                      return;
                                    }
                                    
                                    setMappingVariables(true);
                                    try {
                                      // Filter out computed/summary variables that shouldn't be mapped
                                      // Include variable type information for better AI matching
                                      const variablesToMap = variables
                                        .filter(v => {
                                          // Skip summary table variables
                                          if (v.name.includes('_Summary') || 
                                              v.name.includes('Summary') && v.isSummaryTable) {
                                            return false;
                                          }
                                          // Skip scale summary variables
                                          if (v.isScaleSummary) {
                                            return false;
                                          }
                                          return true;
                                        })
                                        .map(v => ({
                                          name: v.name,
                                          type: v.type || 'Unknown',
                                          description: v.description || ''
                                        }));
                                      
                                      // Match expected headers directly to column headers (exact matches only)
                                      // This maps expected headers like QA1r1c1 to column headers like QA1r1c1
                                      const expectedHeadersMapping: Record<string, string> = {};
                                      
                                      // Get all expected headers for all base questions
                                      const baseQuestionMap = new Map<string, { baseNumber: string; type: string; variables: Variable[] }>();
                                      variables.forEach((variable) => {
                                        if (variable.name.endsWith('_Summary Tables') || 
                                            variable.name.endsWith('_T2B') || 
                                            variable.name.endsWith('_B2B') || 
                                            variable.name.endsWith('_M3B') ||
                                            (variable as any).isSummaryTable) {
                                          return;
                                        }
                                        const baseNumber = getBaseQuestionNumber(variable.name);
                                        if (!baseQuestionMap.has(baseNumber)) {
                                          const question = questionnaireQuestions.find(q => {
                                            const qNum = q.number || q.id;
                                            return qNum === baseNumber || 
                                                   qNum === baseNumber.replace(/^Q/, '') ||
                                                   String(qNum) === String(baseNumber);
                                          });
                                          const questionType = question?.type || variable.type || '';
                                          baseQuestionMap.set(baseNumber, {
                                            baseNumber,
                                            type: questionType,
                                            variables: []
                                          });
                                        }
                                        baseQuestionMap.get(baseNumber)!.variables.push(variable);
                                      });
                                      
                                      // Generate expected headers and match them directly to column headers
                                      const usedColumnHeaders = new Set<string>();
                                      baseQuestionMap.forEach((group) => {
                                        const expectedHeaders = getExpectedColumnHeadersForBase(group.baseNumber, variables);
                                        expectedHeaders.forEach(expectedHeader => {
                                          // Check if this expected header exactly matches any column header
                                          const expectedNormalized = expectedHeader.toLowerCase().trim();
                                          for (const colHeader of columnHeaders) {
                                            if (usedColumnHeaders.has(colHeader)) continue; // Already used
                                            
                                            const colHeaderNormalized = colHeader.toLowerCase().trim();
                                            // Exact match (case-insensitive)
                                            if (colHeaderNormalized === expectedNormalized) {
                                              // Map expected header to column header
                                              expectedHeadersMapping[expectedHeader] = colHeader;
                                              usedColumnHeaders.add(colHeader);
                                              break;
                                            }
                                          }
                                        });
                                      });
                                      
                                      const finalMapping = expectedHeadersMapping;
                                      
                                      // Save the automatic mapping to the backend first
                                      const saveResponse = await fetch(`${API_BASE_URL}/api/questionnaire/map-columns`, {
                                        method: 'POST',
                                        headers: {
                                          'Authorization': `Bearer ${localStorage.getItem('cognitive_dash_token')}`,
                                          'Content-Type': 'application/json'
                                        },
                                        body: JSON.stringify({
                                          questionnaireId: selectedQuestionnaire.id,
                                          variableNames: variablesToMap.map(v => v.name),
                                          dataHeaders: columnHeaders,
                                          mapping: finalMapping // Save the automatic mapping
                                        })
                                      });
                                      
                                      if (saveResponse.ok) {
                                        // Get the saved mapping from response (backend may have normalized it)
                                        const result = await saveResponse.json();
                                        const savedMapping = result.mapping || finalMapping;
                                        
                                        // Update state only after successful save to prevent double rendering
                                        setColumnMapping(savedMapping);
                                        setHasAttemptedMapping(true);
                                        
                                        // Update uploadedFileInfo to reflect that mapping is complete
                                        if (uploadedFileInfo) {
                                          setUploadedFileInfo({
                                            ...uploadedFileInfo,
                                            processed: true
                                          });
                                        }
                                      } else {
                                        console.error('Failed to save automatic mapping');
                                        // Still update state even if save failed (user can see the mapping)
                                        setColumnMapping(finalMapping);
                                        setHasAttemptedMapping(true);
                                      }
                                    } catch (error) {
                                      console.error('Error mapping variables:', error);
                                    } finally {
                                      setMappingVariables(false);
                                    }
                                  }}
                                  disabled={mappingVariables}
                                  className="px-3 py-1.5 text-xs font-medium text-white rounded bg-orange-600 hover:bg-orange-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                                  style={{ backgroundColor: BRAND_ORANGE }}
                                >
                                  {mappingVariables ? 'Mapping...' : 'Map Variables to QNR'}
                                                </button>
                              )}
                              {hasAttemptedMapping && unmappedHeadersInfo.unmappedExpectedHeaders.length > 0 && unmappedHeadersInfo.unusedColumnHeaders.length > 0 && (
                                <button
                                  onClick={async () => {
                                    if (!selectedQuestionnaire || unmappedHeadersInfo.unmappedExpectedHeaders.length === 0 || unmappedHeadersInfo.unusedColumnHeaders.length === 0) {
                                      return;
                                    }
                                    
                                    setMappingWithAI(true);
                                    try {
                                      // Call AI mapping endpoint with unmapped expected headers and unused column headers
                                      const aiMappingResponse = await fetch(`${API_BASE_URL}/api/questionnaire/map-columns`, {
                                        method: 'POST',
                                        headers: {
                                          'Authorization': `Bearer ${localStorage.getItem('cognitive_dash_token')}`,
                                          'Content-Type': 'application/json'
                                        },
                                        body: JSON.stringify({
                                          questionnaireId: selectedQuestionnaire.id,
                                          variableNames: unmappedHeadersInfo.unmappedExpectedHeaders, // Use expected headers as variable names
                                          dataHeaders: unmappedHeadersInfo.unusedColumnHeaders, // Only unused column headers
                                          existingMapping: columnMapping // Pass existing mapping so AI knows what's already mapped
                                        })
                                      });
                                      
                                      if (aiMappingResponse.ok) {
                                        const result = await aiMappingResponse.json();
                                        const aiMapping = result.mapping || {};
                                        
                                        // Merge AI mapping with existing mapping
                                        const mergedMapping = { ...columnMapping, ...aiMapping };
                                        
                                        // Save the merged mapping
                                        const saveResponse = await fetch(`${API_BASE_URL}/api/questionnaire/map-columns`, {
                                          method: 'POST',
                                          headers: {
                                            'Authorization': `Bearer ${localStorage.getItem('cognitive_dash_token')}`,
                                            'Content-Type': 'application/json'
                                          },
                                          body: JSON.stringify({
                                            questionnaireId: selectedQuestionnaire.id,
                                            variableNames: unmappedHeadersInfo.unmappedExpectedHeaders,
                                            dataHeaders: columnHeaders,
                                            mapping: mergedMapping
                                          })
                                        });
                                        
                                        if (saveResponse.ok) {
                                          const saveResult = await saveResponse.json();
                                          const savedMapping = saveResult.mapping || mergedMapping;
                                          setColumnMapping(savedMapping);
                                          
                                          // Update uploadedFileInfo to reflect that mapping is complete
                                          if (uploadedFileInfo) {
                                            setUploadedFileInfo({
                                              ...uploadedFileInfo,
                                              processed: true
                                            });
                                          }
                                        } else {
                                          console.error('Failed to save AI mapping');
                                          // Still update state even if save failed
                                          setColumnMapping(mergedMapping);
                                        }
                                      } else {
                                        console.error('Failed to get AI mapping');
                                        const errorData = await aiMappingResponse.json().catch(() => ({}));
                                        alert(`Failed to map with AI: ${errorData.error || 'Unknown error'}`);
                                      }
                                    } catch (error) {
                                      console.error('Error mapping with AI:', error);
                                      alert('Error mapping with AI. Please try again.');
                                    } finally {
                                      setMappingWithAI(false);
                                    }
                                  }}
                                  disabled={mappingWithAI || mappingVariables}
                                  className="px-3 py-1.5 text-xs font-medium text-white rounded bg-blue-600 hover:bg-blue-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                                >
                                  {mappingWithAI ? 'Mapping with AI...' : `Map unmapped with AI (${unmappedHeadersInfo.unmappedExpectedHeaders.length} remaining)`}
                                </button>
                              )}
                              {dataUploaded ? (
                                <span className="inline-flex items-center gap-1 px-2 py-1.5 text-xs font-medium rounded bg-green-100 text-green-800">
                                  Uploaded
                                            <button
                                              onClick={() => {
                                      if (!confirm('Are you sure you want to remove the uploaded data? You can upload it again using the button below.')) {
                                        return;
                                      }
                                      setDataUploaded(false);
                                      // Clear variable data from variables view
                                      setVariableData({});
                                    }}
                                    className="ml-1 hover:bg-green-200 rounded p-0.5 transition-colors"
                                    title="Remove uploaded data (allows re-upload)"
                                  >
                                    <XMarkIcon className="h-3 w-3" />
                                            </button>
                                </span>
                              ) : (
                              <button
                                  onClick={async () => {
                                    if (!selectedQuestionnaire) {
                                      return;
                                    }
                                    
                                    if (!uploadedFileInfo.processed || Object.keys(columnMapping).length === 0) {
                                      return;
                                    }
                                    
                                    setUploadingData(true);
                                    try {
                                      // Convert expected header mapping to variable name mapping
                                      // The columnMapping uses expected headers as keys (e.g., "QA1r1c1")
                                      // But the backend expects variable names as keys (e.g., "A1_r1")
                                      const variableNameMapping: Record<string, string> = {};
                                      
                                      // Group variables by base question to find which variable corresponds to each expected header
                                      const baseQuestionMap = new Map<string, { baseNumber: string; type: string; variables: Variable[] }>();
                                      variables.forEach((variable) => {
                                        if (variable.name.endsWith('_Summary Tables') || 
                                            variable.name.endsWith('_T2B') || 
                                            variable.name.endsWith('_B2B') || 
                                            variable.name.endsWith('_M3B') ||
                                            (variable as any).isSummaryTable) {
                                          return;
                                        }
                                        const baseNumber = getBaseQuestionNumber(variable.name);
                                        if (!baseQuestionMap.has(baseNumber)) {
                                          const question = questionnaireQuestions.find(q => {
                                            const qNum = q.number || q.id;
                                            return qNum === baseNumber || 
                                                   qNum === baseNumber.replace(/^Q/, '') ||
                                                   String(qNum) === String(baseNumber);
                                          });
                                          const questionType = question?.type || variable.type || '';
                                          baseQuestionMap.set(baseNumber, {
                                            baseNumber,
                                            type: questionType,
                                            variables: []
                                          });
                                        }
                                        baseQuestionMap.get(baseNumber)!.variables.push(variable);
                                      });
                                      
                                      // For each expected header in the mapping, find the corresponding variable
                                      Object.entries(columnMapping).forEach(([expectedHeader, columnHeader]) => {
                                        if (!columnHeader || columnHeader.trim() === '') return;

                                        // Try to find which variable generates this expected header
                                        let foundVariable: Variable | null = null;

                                        // For numeric grid cell variables (e.g., S4r1c1), match directly by pattern
                                        // Expected header format: QS4r1c1, variable name format: S4r1c1
                                        const cellVarPattern = expectedHeader.match(/^Q?([A-Z0-9]+r\d+c\d+)$/i);
                                        if (cellVarPattern) {
                                          const varName = cellVarPattern[1]; // e.g., "S4r1c1"
                                          foundVariable = variables.find(v => v.name === varName) || null;
                                        }

                                        // If not a cell variable, use the original logic
                                        if (!foundVariable) {
                                          for (const group of baseQuestionMap.values()) {
                                            if (foundVariable) break; // Already found

                                            // Check each variable in this group
                                            // Generate expected headers for this group
                                            const headers = getExpectedColumnHeadersForBase(group.baseNumber, variables);
                                            if (headers.includes(expectedHeader)) {
                                              // Find which variable in the group matches this expected header
                                              for (const variable of group.variables) {
                                                // For now, just use the first variable in the group
                                                // The actual mapping will be to the expected header itself
                                                foundVariable = variable;
                                                break;
                                              }
                                            }
                                          }
                                        }

                                        if (foundVariable !== null) {
                                          // Use the variable name as the key
                                          variableNameMapping[foundVariable.name] = columnHeader;
                                        } else {
                                          // If no variable found, use the expected header as-is (fallback)
                                          // This handles edge cases where expected header might be used directly
                                          variableNameMapping[expectedHeader] = columnHeader;
                                        }
                                      });

                                      // Always include "record" column if it exists in column headers
                                      const recordHeader = columnHeaders.find(h => h.toLowerCase() === 'record');
                                      if (recordHeader) {
                                        variableNameMapping['record'] = recordHeader;
                                      }

                                      const response = await fetch(`${API_BASE_URL}/api/questionnaire/upload-data`, {
                                  method: 'POST',
                                  headers: {
                                          'Authorization': `Bearer ${localStorage.getItem('cognitive_dash_token')}`,
                                          'Content-Type': 'application/json'
                                        },
                                        body: JSON.stringify({
                                          questionnaireId: selectedQuestionnaire.id,
                                          columnMapping: variableNameMapping
                                        })
                                      });
                                      
                                      if (response.ok) {
                                        const result = await response.json();
                                        
                                        // Use the data directly from the response if available
                                        if (result.data && typeof result.data === 'object') {
                                          setVariableData(result.data);
                                        }
                                        
                                        setDataUploaded(true);
                                        // Also reload processed data after a delay to ensure it's persisted
                                        setTimeout(() => {
                                          loadProcessedData();
                                          if (debouncedLoadFileInfo) {
                                            debouncedLoadFileInfo(500);
                                          }
                                        }, 2000);
                                      } else {
                                        const error = await response.json();
                                        console.error('Failed to upload data:', error.error || 'Unknown error');
                                      }
                                    } catch (error) {
                                      console.error('Error uploading data:', error);
                              } finally {
                                      setUploadingData(false);
                                    }
                                  }}
                                  disabled={uploadingData || !uploadedFileInfo.processed || Object.keys(columnMapping).length === 0}
                                  className="px-3 py-1.5 text-xs font-medium text-white rounded bg-orange-600 hover:bg-orange-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                                  style={{ backgroundColor: BRAND_ORANGE }}
                                >
                                  {uploadingData ? 'Uploading...' : 'Upload Data'}
                          </button>
                              )}
                        <button
                          onClick={async () => {
                                    if (!selectedQuestionnaire) {
                                      return;
                                    }
                                    
                                    if (!confirm('Are you sure you want to delete this data file permanently? This will remove the file, column headers, and mapping from the server. You will need to upload a new file.')) {
                                return;
                              }

                                    try {
                                      const response = await fetch(`${API_BASE_URL}/api/questionnaire/delete-data-file/${selectedQuestionnaire.id}`, {
                                        method: 'DELETE',
                                        headers: {
                                          'Authorization': `Bearer ${localStorage.getItem('cognitive_dash_token')}`
                                        }
                                      });
                                      
                                      if (response.ok) {
                                        // Clear all related state
                                        setUploadedFileInfo(null);
                                        setColumnHeaders([]);
                                        setColumnMapping({});
                                        setDataUploaded(false);
                                        setDataFile(null);
                                        setHasAttemptedMapping(false);
                                        // Clear variable data from variables view
                                        setVariableData({});
                                        // Reset file input
                                        const fileInput = document.getElementById('data-file-upload') as HTMLInputElement;
                                        if (fileInput) fileInput.value = '';
                                    } else {
                                        const error = await response.json();
                                        console.error('Failed to delete data file:', error.error || 'Unknown error');
                                      }
                                    } catch (error) {
                                      console.error('Error deleting data file:', error);
                                    }
                                  }}
                                  className="flex items-center justify-center px-2 py-1.5 text-white bg-red-600 hover:bg-red-700 rounded transition-colors"
                                  title="Delete data file permanently from server"
                                >
                                  <TrashIcon className="h-4 w-4" />
                                </button>
                              </div>
                            </td>
                          </tr>
                        </tbody>
                            </table>
                          </div>
                  ) : (
                    <div className="text-center py-8">
                      <p className="text-sm text-gray-500">No data file uploaded</p>
                      <p className="text-xs text-gray-400 mt-2">Click the "Upload Data File" button to get started</p>
                    </div>
                  )}

                  {/* Hidden file input */}
                  <input
                    type="file"
                    id="data-file-upload"
                    accept=".xlsx,.xls,.csv"
                    onChange={async (e) => {
                      const file = e.target.files?.[0];
                      if (file && selectedQuestionnaire) {
                        setDataFile(file);
                        setDataUploadSuccess(false);
                        setShowAllHeaders(false);

                        try {
                          setUploadingFile(true);
                          const parsedHeaders = await parseFileHeaders(file);

                          const formData = new FormData();
                          formData.append('file', file);
                          formData.append('questionnaireId', selectedQuestionnaire.id);

                          const response = await fetch(`${API_BASE_URL}/api/questionnaire/upload-data-file`, {
                            method: 'POST',
                            headers: {
                              'Authorization': `Bearer ${localStorage.getItem('cognitive_dash_token')}`
                            },
                            body: formData
                          });

                          if (response.ok) {
                            const result = await response.json();
                            setDataUploadSuccess(true);
                            setUploadedFileInfo({
                              fileName: result.originalFileName || result.fileName || file.name,
                              uploadedAt: new Date().toISOString(),
                              processed: false
                            });

                            if (parsedHeaders.length > 0 && selectedQuestionnaire) {
                              try {
                                const saveResponse = await fetch(`${API_BASE_URL}/api/questionnaire/save-column-headers`, {
                                  method: 'POST',
                                  headers: {
                                    'Authorization': `Bearer ${localStorage.getItem('cognitive_dash_token')}`,
                                    'Content-Type': 'application/json'
                                  },
                                  body: JSON.stringify({
                                    questionnaireId: selectedQuestionnaire.id,
                                    columnHeaders: parsedHeaders
                                  })
                                });
                                if (!saveResponse.ok) {
                                  console.error('Failed to save column headers');
                                }
                              } catch (error) {
                                console.error('Error saving column headers:', error);
                              }
                            }

                            setDataFile(null);
                            const fileInput = document.getElementById('data-file-upload') as HTMLInputElement;
                            if (fileInput) fileInput.value = '';

                            setTimeout(() => {
                              loadFileInfo();
                            }, 500);
                          } else {
                            const error = await response.json();
                            console.error('Failed to upload data file:', error.error || 'Unknown error');
                          }
                        } catch (error) {
                          console.error('Error parsing headers or uploading file:', error);
                        } finally {
                          setUploadingFile(false);
                        }
                      }
                    }}
                    className="hidden"
                  />

                  {uploadingFile && (
                    <div className="mt-4 text-center text-sm text-gray-500">
                      {columnHeaders.length > 0 ? 'Uploading file...' : 'Parsing column headers...'}
                        </div>
                      )}
                      

                  {/* Three Boxes: QNR Variables, Column Headers, Data Mapping */}
                  <div key={`data-mapping-${selectedQuestionnaire?.id}-${questionnaireQuestions.map(q => `${q.id || q.number}:${q.type || ''}`).join('|')}`} className="mt-6">
                    {uploadedFileInfo ? (
                      <div className={`grid gap-6 ${variables.length > 0 ? 'grid-cols-3' : 'grid-cols-2'}`}>
                        {/* QNR Variables Box */}
                        <div className="flex flex-col">
                          <div className="flex items-center justify-between mb-3">
                            <h4 className="text-sm font-semibold text-gray-900">
                              QNR Variables {questionnaireQuestions.length > 0 ? `(${questionnaireQuestions.length})` : variables.length > 0 ? `(${variables.length})` : ''}
                            </h4>
                          </div>
                          <div className="mb-3">
                            <div className="relative">
                              <MagnifyingGlassIcon className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-gray-400" />
                              <input
                                type="text"
                                id="qnr-variable-search"
                                name="qnr-variable-search"
                                placeholder="Search QNR variables..."
                                value={qnrVariableSearch}
                                onChange={(e) => setQnrVariableSearch(e.target.value)}
                                className="w-full pl-10 pr-4 py-2 text-sm border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-orange-500 focus:border-transparent"
                              />
                            </div>
                          </div>
                          <div className="border border-gray-200 rounded-lg overflow-hidden flex flex-col">
                            <table className="w-full divide-y divide-gray-200">
                              <thead className="bg-gray-50">
                                <tr>
                                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider whitespace-nowrap" style={{ width: 'auto', minWidth: '80px' }}>Q#</th>
                                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider" style={{ width: '30%' }}>Question Type</th>
                                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Expected Headers</th>
                                </tr>
                              </thead>
                            </table>
                            <div className="overflow-y-auto overflow-x-hidden" style={{ maxHeight: 'calc(10 * 3rem)' }}>
                              <table className="w-full divide-y divide-gray-200">
                                <tbody className="bg-white divide-y divide-gray-200">
                                  {questionnaireQuestions.length > 0 ? (() => {
                                    // Iterate through all questions from the QNR
                                    let questionsToShow = [...questionnaireQuestions];
                                    
                                    // Apply search filter
                                    if (qnrVariableSearch.trim()) {
                                      const searchLower = qnrVariableSearch.toLowerCase();
                                      questionsToShow = questionsToShow.filter(question => {
                                        const qNum = question.number || question.id;
                                        const qNumStr = String(qNum);
                                        const questionType = question.type || '';
                                        const expectedHeaders = getExpectedColumnHeadersForBase(qNumStr, variables);
                                        const matchesBase = qNumStr.toLowerCase().includes(searchLower);
                                        const matchesType = questionType.toLowerCase().includes(searchLower);
                                        const matchesExpected = expectedHeaders.some(h => h.toLowerCase().includes(searchLower));
                                        return matchesBase || matchesType || matchesExpected;
                                      });
                                    }
                                    
                                    return questionsToShow.map((question) => {
                                      const qNum = question.number || question.id;
                                      const qNumStr = String(qNum);
                                      const questionType = question.type || '';
                                      const expectedHeaders = getExpectedColumnHeadersForBase(qNumStr, variables);
                                      
                                      return (
                                        <tr key={qNumStr}>
                                          <td className="px-4 py-3 text-xs font-medium text-gray-500 tracking-wider whitespace-nowrap" style={{ width: 'auto', minWidth: '80px' }} title={qNumStr}>{qNumStr}</td>
                                          <td className="px-4 py-3 text-xs font-medium text-gray-500 tracking-wider truncate" style={{ width: '30%' }} title={questionType || '-'}>{questionType || '-'}</td>
                                          <td className="px-4 py-3 text-xs font-medium text-gray-500 tracking-wider">
                                            <div className="flex flex-wrap gap-1">
                                              {expectedHeaders.map((header, idx) => (
                                                <span key={idx} className="inline-block px-2 py-1 text-xs font-medium rounded bg-blue-50 text-blue-700 border border-blue-200">
                                                  {header}
                                                </span>
                                              ))}
                                            </div>
                                          </td>
                                        </tr>
                                      );
                                    });
                                  })() : (
                                <tr>
                                      <td colSpan={3} className="px-4 py-8 text-center text-sm text-gray-500">
                                        No questions available. Sync with QNR to load questions.
                                  </td>
                                </tr>
                              )}
                                </tbody>
                              </table>
                            </div>
                          </div>
                        </div>

                        {/* Column Headers Box */}
                        <div className="flex flex-col">
                          <div className="flex items-center justify-between mb-3">
                            <h4 className="text-sm font-semibold text-gray-900">
                              Column Headers ({columnHeaders.length} total)
                            </h4>
                          </div>
                          <div className="mb-3">
                            <div className="relative">
                              <MagnifyingGlassIcon className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-gray-400" />
                              <input
                                type="text"
                                id="column-header-search"
                                name="column-header-search"
                                placeholder="Search column headers..."
                                value={columnHeaderSearch}
                                onChange={(e) => setColumnHeaderSearch(e.target.value)}
                                className="w-full pl-10 pr-4 py-2 text-sm border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-orange-500 focus:border-transparent"
                              />
                            </div>
                          </div>
                          <div className="border border-gray-200 rounded-lg overflow-hidden flex flex-col">
                            <table className="w-full divide-y divide-gray-200" style={{ tableLayout: 'fixed' }}>
                              <thead className="bg-gray-50">
                                <tr>
                                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider" style={{ width: '3rem' }}>#</th>
                                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider" style={{ width: 'calc(100% - 3rem)' }}>Column Name</th>
                                </tr>
                              </thead>
                            </table>
                            <div className="overflow-y-auto overflow-x-hidden" style={{ maxHeight: 'calc(10 * 3rem)' }}>
                              <table className="w-full divide-y divide-gray-200" style={{ tableLayout: 'fixed' }}>
                                <tbody className="bg-white divide-y divide-gray-200">
                                  {columnHeaders.length > 0 ? (
                                    columnHeaders
                                      .filter((header) => {
                                        if (!columnHeaderSearch.trim()) return true;
                                        return header.toLowerCase().includes(columnHeaderSearch.toLowerCase());
                                      })
                                      .map((header, index) => {
                                        // Find the original index for numbering
                                        const originalIndex = columnHeaders.indexOf(header);
                                        const isMapped = Object.values(columnMapping).includes(header);
                                        return (
                                          <tr 
                                            key={index}
                                            className={isMapped ? 'bg-green-50' : ''}
                                          >
                                            <td className="px-4 py-3 text-xs font-medium text-gray-500 tracking-wider" style={{ width: '3rem' }}>{originalIndex + 1}</td>
                                            <td className="px-4 py-3 text-xs font-medium text-gray-500 tracking-wider truncate" style={{ width: 'calc(100% - 3rem)' }} title={header}>{header}</td>
                                          </tr>
                                        );
                                      })
                                  ) : (
                                    <tr>
                                      <td colSpan={2} className="px-4 py-8 text-center text-sm text-gray-500">
                                        No column headers found. Please upload a data file.
                                      </td>
                                    </tr>
                                  )}
                                </tbody>
                              </table>
                            </div>
                          </div>
                        </div>

                        {/* Data Mapping Box - Show all expected headers with mapping status */}
                        {variables.length > 0 && (
                        <div className="flex flex-col">
                          {(() => {
                            // Calculate counts
                            const allHeaders = dataMappingMemo.filteredHeaders;
                            const mappedCount = allHeaders.filter(header => {
                              const status = dataMappingMemo.mappingStatusMap.get(header);
                              return status?.isMapped === true;
                            }).length;
                            const unmappedCount = allHeaders.length - mappedCount;
                            
                            // Filter headers based on selected filter
                            const displayHeaders = allHeaders.filter(header => {
                              if (mappingFilter === 'all') return true;
                              const status = dataMappingMemo.mappingStatusMap.get(header);
                              if (mappingFilter === 'mapped') return status?.isMapped === true;
                              if (mappingFilter === 'unmapped') return status?.isMapped !== true;
                              return true;
                            });
                            
                            return (
                              <>
                                <div className="flex items-center justify-between mb-3">
                                  <h4 className="text-sm font-semibold text-gray-900">
                                    Data Mapping
                                  </h4>
                                  {/* Filter Pills */}
                                  <div className="flex items-center gap-1.5">
                                    <button
                                      onClick={() => setMappingFilter('all')}
                                      className={`px-2 py-1 text-xs font-medium rounded-full transition-colors ${
                                        mappingFilter === 'all'
                                          ? 'bg-orange-100 text-orange-700 border border-orange-500'
                                          : 'bg-gray-100 text-gray-700 border border-transparent hover:bg-gray-200'
                                      }`}
                                    >
                                      All ({allHeaders.length})
                                    </button>
                                    <button
                                      onClick={() => setMappingFilter('mapped')}
                                      className={`px-2 py-1 text-xs font-medium rounded-full transition-colors ${
                                        mappingFilter === 'mapped'
                                          ? 'bg-green-100 text-green-700 border border-green-500'
                                          : 'bg-gray-100 text-gray-700 border border-transparent hover:bg-gray-200'
                                      }`}
                                    >
                                      Mapped ({mappedCount})
                                    </button>
                                    <button
                                      onClick={() => setMappingFilter('unmapped')}
                                      className={`px-2 py-1 text-xs font-medium rounded-full transition-colors ${
                                        mappingFilter === 'unmapped'
                                          ? 'bg-red-100 text-red-700 border border-red-500'
                                          : 'bg-gray-100 text-gray-700 border border-transparent hover:bg-gray-200'
                                      }`}
                                    >
                                      Unmapped ({unmappedCount})
                                    </button>
                                  </div>
                                </div>
                                <div className="mb-3">
                                  <div className="relative">
                                    <MagnifyingGlassIcon className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-gray-400" />
                                    <input
                                      type="text"
                                      id="mapping-search"
                                      name="mapping-search"
                                      placeholder="Search mappings..."
                                      value={qnrVariableSearch}
                                      onChange={(e) => setQnrVariableSearch(e.target.value)}
                                      className="w-full pl-10 pr-4 py-2 text-sm border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-orange-500 focus:border-transparent"
                                    />
                                  </div>
                                </div>
                                <div className="border border-gray-200 rounded-lg overflow-hidden flex flex-col">
                                  <table className="w-full divide-y divide-gray-200" style={{ tableLayout: 'fixed' }}>
                                    <thead className="bg-gray-50">
                                      <tr>
                                        <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider whitespace-nowrap">Expected Header</th>
                                        <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider whitespace-nowrap">Match Column Header</th>
                                        <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider whitespace-nowrap"></th>
                                      </tr>
                                    </thead>
                                  </table>
                                  <div className="overflow-y-auto overflow-x-auto" style={{ maxHeight: 'calc(10 * 3rem)' }}>
                                    <table className="w-full divide-y divide-gray-200" style={{ tableLayout: 'fixed' }}>
                                      <tbody className="bg-white divide-y divide-gray-200">
                                        {displayHeaders.length === 0 ? (
                                          <tr>
                                            <td colSpan={3} className="px-4 py-8 text-center text-sm text-gray-500">
                                              {variables.length === 0 ? 'No variables available. Sync with QNR to load variables.' : mappingFilter === 'mapped' ? 'No mapped headers found.' : mappingFilter === 'unmapped' ? 'No unmapped headers found.' : 'No expected headers found.'}
                                            </td>
                                          </tr>
                                        ) : (
                                          displayHeaders.map((expectedHeader) => {
                                      const status = dataMappingMemo.mappingStatusMap.get(expectedHeader) || { isMapped: false, mappedColumnHeader: '', mappedVariableName: '' };
                                      const { isMapped, mappedColumnHeader, mappedVariableName } = status;
                                      
                                      return (
                                        <tr key={expectedHeader}>
                                          <td className="px-4 py-3 text-xs font-medium text-gray-500 tracking-wider whitespace-nowrap" title={expectedHeader}>{expectedHeader}</td>
                                          <td className="px-4 py-3 text-xs text-gray-900 whitespace-nowrap" title={mappedColumnHeader || undefined}>
                                            {isMapped && mappedColumnHeader ? mappedColumnHeader : ''}
                                          </td>
                                          <td className="px-4 py-3 text-right whitespace-nowrap">
                                            {isMapped && mappedColumnHeader ? (
                                              <span className="inline-flex items-center px-2 py-1 text-xs font-medium rounded-full bg-green-100 text-green-700" title={`Mapped to: ${mappedColumnHeader}`}>
                                                Mapped
                                              </span>
                                            ) : (
                                              <button
                                                onClick={() => {
                                                  setSelectedUnmappedExpectedHeader(expectedHeader);
                                                  setShowUnmappedHeaderMappingModal(true);
                                                }}
                                                className="inline-flex items-center px-2 py-1 text-xs font-medium rounded-full bg-orange-100 text-orange-700 hover:bg-orange-200 transition-colors cursor-pointer"
                                                title="Click to map this header"
                                              >
                                                Unmapped
                                              </button>
                                            )}
                                          </td>
                                        </tr>
                                      );
                                    })
                                  )}
                                </tbody>
                              </table>
                            </div>
                          </div>
                              </>
                            );
                          })()}
                        </div>
                        )}
                      </div>
                    ) : (
                      /* QNR Variables Box - Full width when no data uploaded */
                      <div className="flex flex-col">
                        <div className="flex items-center justify-between mb-3">
                          <h4 className="text-sm font-semibold text-gray-900">
                            QNR Variables {questionnaireQuestions.length > 0 ? `(${questionnaireQuestions.length})` : variables.length > 0 ? `(${variables.length})` : ''}
                          </h4>
                        </div>
                        <div className="mb-3">
                          <div className="relative">
                            <MagnifyingGlassIcon className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-gray-400" />
                            <input
                              type="text"
                              id="qnr-variable-search-data"
                              name="qnr-variable-search-data"
                              placeholder="Search QNR variables..."
                              value={qnrVariableSearch}
                              onChange={(e) => setQnrVariableSearch(e.target.value)}
                              className="w-full pl-10 pr-4 py-2 text-sm border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-orange-500 focus:border-transparent"
                            />
                          </div>
                        </div>
                        <div className="border border-gray-200 rounded-lg overflow-hidden flex flex-col">
                          <table className="w-full divide-y divide-gray-200">
                            <thead className="bg-gray-50">
                              <tr>
                                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider whitespace-nowrap" style={{ width: 'auto', minWidth: '80px' }}>Q#</th>
                                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider" style={{ width: '30%' }}>Question Type</th>
                                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Expected Headers</th>
                              </tr>
                            </thead>
                          </table>
                          <div className="overflow-y-auto overflow-x-hidden" style={{ maxHeight: 'calc(10 * 3rem)' }}>
                            <table className="w-full divide-y divide-gray-200">
                              <tbody className="bg-white divide-y divide-gray-200">
                                {questionnaireQuestions.length > 0 ? (() => {
                                  // Iterate through all questions from the QNR
                                  let questionsToShow = [...questionnaireQuestions];
                                  
                                  // Apply search filter
                                  if (qnrVariableSearch.trim()) {
                                    const searchLower = qnrVariableSearch.toLowerCase();
                                    questionsToShow = questionsToShow.filter(question => {
                                      const qNum = question.number || question.id;
                                      const qNumStr = String(qNum);
                                      const questionType = question.type || '';
                                      const expectedHeaders = getExpectedColumnHeadersForBase(qNumStr, variables);
                                      const matchesBase = qNumStr.toLowerCase().includes(searchLower);
                                      const matchesType = questionType.toLowerCase().includes(searchLower);
                                      const matchesExpected = expectedHeaders.some(h => h.toLowerCase().includes(searchLower));
                                      return matchesBase || matchesType || matchesExpected;
                                    });
                                  }
                                  
                                  return questionsToShow.map((question) => {
                                    const qNum = question.number || question.id;
                                    const qNumStr = String(qNum);
                                    const questionType = question.type || '';
                                    const expectedHeaders = getExpectedColumnHeadersForBase(qNumStr, variables);
                                    
                                    return (
                                      <tr key={qNumStr}>
                                        <td className="px-4 py-3 text-xs font-medium text-gray-500 tracking-wider whitespace-nowrap" style={{ width: 'auto', minWidth: '80px' }} title={qNumStr}>{qNumStr}</td>
                                        <td className="px-4 py-3 text-xs font-medium text-gray-500 tracking-wider truncate" style={{ width: '30%' }} title={questionType || '-'}>{questionType || '-'}</td>
                                        <td className="px-4 py-3 text-xs font-medium text-gray-500 tracking-wider">
                                          <div className="flex flex-wrap gap-1">
                                            {expectedHeaders.map((header, idx) => (
                                              <span key={idx} className="inline-block px-2 py-1 text-xs font-medium rounded bg-blue-50 text-blue-700 border border-blue-200">
                                                {header}
                                              </span>
                                            ))}
                                          </div>
                                        </td>
                                      </tr>
                                    );
                                  });
                                })() : (
                              <tr>
                                    <td colSpan={3} className="px-4 py-8 text-center text-sm text-gray-500">
                                      No questions available. Sync with QNR to load questions.
                                </td>
                              </tr>
                            )}
                          </tbody>
                        </table>
                      </div>
                </div>
                      </div>
                    )}
                  </div>
            </div>
          )}
          </div>
        </>
      )}

      {/* Question Modal */}
      {showQuestionModal && createPortal(
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50" style={{ top: 0, left: 0, right: 0, bottom: 0, position: 'fixed' }} onClick={() => setShowQuestionModal(false)}>
          <div className="bg-white rounded-lg shadow-xl max-w-3xl w-full mx-4 max-h-[90vh] overflow-hidden flex flex-col" onClick={(e) => e.stopPropagation()}>
            {/* Header: Question title and type */}
            <div className="flex items-center justify-between p-6 border-b border-gray-200">
              <div className="flex items-center gap-3">
                <h3 className="text-lg font-semibold text-gray-900">
                  {questionData ? `Q${questionData.number || questionData.id}` : 'Question'}
                </h3>
                {questionData && (
                  <span className={`text-xs px-2 py-1 rounded ${
                    questionData.type?.toLowerCase().includes('numeric grid') ? 'bg-orange-100 text-orange-800' :
                    questionData.type?.toLowerCase().includes('single select grid') ? 'bg-blue-100 text-blue-800' :
                    questionData.type?.toLowerCase().includes('multi-select') ? 'bg-purple-100 text-purple-800' :
                    questionData.type?.toLowerCase().includes('numeric') ? 'bg-green-100 text-green-800' :
                    'bg-gray-100 text-gray-800'
                  }`}>
                    {questionData.type || 'Unknown'}
                  </span>
                )}
              </div>
              <div className="flex items-center gap-2">
                {!isEditingQuestion ? (
                  <button
                    onClick={() => {
                      // Initialize editing state with current question data
                      const questionNumber = questionData.number || questionData.id;
                      const matchingQnr = questionnaires.find((qnr: any) => 
                        qnr.questions?.some((q: any) => 
                          (q.number || q.id) === questionNumber
                        )
                      ) || allQuestionnaires.find((qnr: any) => 
                        qnr.questions?.some((q: any) => 
                          (q.number || q.id) === questionNumber
                        )
                      );
                      
                      if (matchingQnr) {
                        const question = matchingQnr.questions?.find((q: any) => 
                          (q.number || q.id) === questionNumber
                        );
                        if (question) {
                          setEditingQuestion({
                            ...question,
                            responseOptions: question.responseOptions ? [...question.responseOptions] : [],
                            statementOptions: question.statementOptions ? [...question.statementOptions] : [],
                            options: question.options ? [...question.options] : []
                          });
                          setIsEditingQuestion(true);
                        }
                      }
                    }}
                    className="px-3 py-1.5 text-sm font-medium text-gray-700 bg-gray-100 rounded-lg hover:bg-gray-200 transition-colors"
                  >
                    Edit
                  </button>
                ) : null}
                <button
                  onClick={() => {
                    setShowQuestionModal(false);
                    setQuestionData(null);
                    setIsEditingQuestion(false);
                    setEditingQuestion(null);
                  }}
                  className="text-gray-400 hover:text-gray-600"
                >
                  <XMarkIcon className="h-6 w-6" />
                </button>
              </div>
            </div>
            
            {/* Body: Question text and other content */}
            <div className="flex-1 overflow-y-auto p-6">
              {loadingQuestion ? (
                <div className="flex items-center justify-center py-12">
                  <div className="text-center">
                    <div className="mx-auto mb-4 h-8 w-8 animate-spin rounded-full border-4 border-gray-200 border-t-[#D14A2D]"></div>
                    <p className="text-sm text-gray-500">Loading question...</p>
                  </div>
                </div>
              ) : questionData ? (
                isEditingQuestion && editingQuestion ? (
                  /* Edit Mode */
                  <div className="space-y-6">
                    {/* Question Type Dropdown */}
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">
                        Question Type
                      </label>
                      <select
                        value={editingQuestion.type || ''}
                        onChange={(e) => setEditingQuestion({ ...editingQuestion, type: e.target.value })}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-orange-500 focus:border-orange-500"
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
                    </div>

                    {/* Response Options (for single/multi-select) */}
                    {(editingQuestion.type?.toLowerCase().includes('select') && !editingQuestion.type?.toLowerCase().includes('grid')) && (
                      <div>
                        <div className="flex items-center justify-between mb-2">
                          <label className="block text-sm font-medium text-gray-700">
                            Response Options
                          </label>
                          <button
                            onClick={() => {
                              const newOptions = editingQuestion.options || [];
                              const newCode = String(newOptions.length + 1);
                              setEditingQuestion({
                                ...editingQuestion,
                                options: [...newOptions, { code: newCode, text: '' }]
                              });
                            }}
                            className="px-2 py-1 text-xs font-medium text-orange-600 hover:text-orange-700"
                          >
                            + Add Option
                          </button>
                        </div>
                        <div className="space-y-2">
                          {(editingQuestion.options || []).map((option: any, idx: number) => {
                            const opt = typeof option === 'string' 
                              ? { code: String(idx + 1), text: option } 
                              : option;
                            return (
                              <div key={idx} className="flex items-center gap-2">
                                <span className="font-mono text-xs text-gray-500 w-8">{opt.code}:</span>
                                <input
                                  type="text"
                                  value={opt.text}
                                  onChange={(e) => {
                                    const newOptions = [...(editingQuestion.options || [])];
                                    if (typeof newOptions[idx] === 'string') {
                                      newOptions[idx] = e.target.value;
                                    } else {
                                      newOptions[idx] = { ...newOptions[idx], text: e.target.value };
                                    }
                                    setEditingQuestion({ ...editingQuestion, options: newOptions });
                                  }}
                                  className="flex-1 px-3 py-1.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-orange-500 focus:border-orange-500"
                                  placeholder="Option text"
                                />
                                <button
                                  onClick={() => {
                                    const newOptions = [...(editingQuestion.options || [])];
                                    newOptions.splice(idx, 1);
                                    setEditingQuestion({ ...editingQuestion, options: newOptions });
                                  }}
                                  className="px-2 py-1 text-red-600 hover:text-red-700"
                                >
                                  <XMarkIcon className="h-4 w-4" />
                                </button>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    )}

                    {/* Statement Options (Rows) */}
                    {editingQuestion.type?.toLowerCase().includes('grid') && (
                      <div>
                        <div className="flex items-center justify-between mb-2">
                          <label className="block text-sm font-medium text-gray-700">
                            Statements (Rows)
                          </label>
                          <button
                            onClick={() => {
                              const newStatements = editingQuestion.statementOptions || [];
                              const newCode = `r${newStatements.length + 1}`;
                              setEditingQuestion({
                                ...editingQuestion,
                                statementOptions: [...newStatements, { code: newCode, text: '' }]
                              });
                            }}
                            className="px-2 py-1 text-xs font-medium text-orange-600 hover:text-orange-700"
                          >
                            + Add Statement
                          </button>
                        </div>
                        <div className="space-y-2">
                          {(editingQuestion.statementOptions || []).map((stmt: any, idx: number) => {
                            const stmtObj = typeof stmt === 'string' 
                              ? { code: `r${idx + 1}`, text: stmt } 
                              : stmt;
                            return (
                              <div key={idx} className="flex items-center gap-2">
                                <span className="font-mono text-xs text-gray-500 w-12">{stmtObj.code}:</span>
                                <input
                                  type="text"
                                  value={stmtObj.text}
                                  onChange={(e) => {
                                    const newStatements = [...(editingQuestion.statementOptions || [])];
                                    if (typeof newStatements[idx] === 'string') {
                                      newStatements[idx] = e.target.value;
                                    } else {
                                      newStatements[idx] = { ...newStatements[idx], text: e.target.value };
                                    }
                                    setEditingQuestion({ ...editingQuestion, statementOptions: newStatements });
                                  }}
                                  className="flex-1 px-3 py-1.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-orange-500 focus:border-orange-500"
                                  placeholder="Statement text"
                                />
                                <button
                                  onClick={() => {
                                    const newStatements = [...(editingQuestion.statementOptions || [])];
                                    newStatements.splice(idx, 1);
                                    setEditingQuestion({ ...editingQuestion, statementOptions: newStatements });
                                  }}
                                  className="px-2 py-1 text-red-600 hover:text-red-700"
                                >
                                  <XMarkIcon className="h-4 w-4" />
                                </button>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    )}

                    {/* Response Options (Columns) */}
                    {editingQuestion.type?.toLowerCase().includes('grid') && (
                      <div>
                        <div className="flex items-center justify-between mb-2">
                          <label className="block text-sm font-medium text-gray-700">
                            Response Options (Columns)
                          </label>
                          <button
                            onClick={() => {
                              const newResponses = editingQuestion.responseOptions || [];
                              const newCode = `c${newResponses.length + 1}`;
                              setEditingQuestion({
                                ...editingQuestion,
                                responseOptions: [...newResponses, { code: newCode, text: '' }]
                              });
                            }}
                            className="px-2 py-1 text-xs font-medium text-orange-600 hover:text-orange-700"
                          >
                            + Add Response Option
                          </button>
                        </div>
                        <div className="space-y-2">
                          {(editingQuestion.responseOptions || []).map((resp: any, idx: number) => {
                            const respObj = typeof resp === 'string' 
                              ? { code: `c${idx + 1}`, text: resp } 
                              : resp;
                            return (
                              <div key={idx} className="flex items-center gap-2">
                                <span className="font-mono text-xs text-gray-500 w-12">{respObj.code}:</span>
                                <input
                                  type="text"
                                  value={respObj.text}
                                  onChange={(e) => {
                                    const newResponses = [...(editingQuestion.responseOptions || [])];
                                    if (typeof newResponses[idx] === 'string') {
                                      newResponses[idx] = e.target.value;
                                    } else {
                                      newResponses[idx] = { ...newResponses[idx], text: e.target.value };
                                    }
                                    setEditingQuestion({ ...editingQuestion, responseOptions: newResponses });
                                  }}
                                  className="flex-1 px-3 py-1.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-orange-500 focus:border-orange-500"
                                  placeholder="Response option text"
                                />
                                <button
                                  onClick={() => {
                                    const newResponses = [...(editingQuestion.responseOptions || [])];
                                    newResponses.splice(idx, 1);
                                    setEditingQuestion({ ...editingQuestion, responseOptions: newResponses });
                                  }}
                                  className="px-2 py-1 text-red-600 hover:text-red-700"
                                >
                                  <XMarkIcon className="h-4 w-4" />
                                </button>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    )}
                  </div>
                ) : (
                  /* View Mode */
                  <div className="space-y-4">
                    {/* Question text */}
                    <div>
                      <p className="text-base text-gray-900">{questionData.text}</p>
                    </div>
                    
                    {questionData.options && questionData.options.length > 0 && (
                      <div>
                        <h4 className="text-sm font-medium text-gray-700 mb-2">Response Options:</h4>
                        <div className="space-y-1">
                          {questionData.options.map((option: any, idx: number) => {
                            const opt = typeof option === 'string' 
                              ? { code: String(idx + 1), text: option } 
                              : option;
                            return (
                              <div key={idx} className="flex items-center gap-2 text-sm text-gray-700">
                                <span className="font-mono text-xs text-gray-500 w-8">{opt.code}:</span>
                                <span>{opt.text}</span>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    )}
                    
                    {questionData.statementOptions && questionData.statementOptions.length > 0 && (
                      <div>
                        <div className="flex items-center gap-2 mb-2">
                          <h4 className="text-sm font-medium text-gray-700">Statements (Rows):</h4>
                          <button
                            onClick={() => {
                              // Initialize editing state with current question data
                              const questionNumber = questionData.number || questionData.id;
                              const matchingQnr = questionnaires.find((qnr: any) => 
                                qnr.questions?.some((q: any) => 
                                  (q.number || q.id) === questionNumber
                                )
                              ) || allQuestionnaires.find((qnr: any) => 
                                qnr.questions?.some((q: any) => 
                                  (q.number || q.id) === questionNumber
                                )
                              );
                              
                              if (matchingQnr) {
                                const question = matchingQnr.questions?.find((q: any) => 
                                  (q.number || q.id) === questionNumber
                                );
                                if (question) {
                                  setEditingQuestion({
                                    ...question,
                                    responseOptions: question.responseOptions ? [...question.responseOptions] : [],
                                    statementOptions: question.statementOptions ? [...question.statementOptions] : [],
                                    options: question.options ? [...question.options] : []
                                  });
                                  setIsEditingQuestion(true);
                                }
                              }
                            }}
                            className="px-2 py-1 text-xs font-medium text-orange-600 hover:text-orange-700 flex items-center gap-1"
                            title="Edit statement options"
                          >
                            <PencilIcon className="h-3 w-3" />
                            Edit
                          </button>
                        </div>
                        <div className="space-y-1">
                          {questionData.statementOptions.map((stmt: any, idx: number) => {
                            const stmtObj = typeof stmt === 'string' 
                              ? { code: `r${idx + 1}`, text: stmt } 
                              : stmt;
                            return (
                              <div key={idx} className="flex items-center gap-2 text-sm text-gray-700">
                                <span className="font-mono text-xs text-gray-500 w-12">{stmtObj.code}:</span>
                                <span>{stmtObj.text}</span>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    )}
                    
                    {questionData.responseOptions && questionData.responseOptions.length > 0 && (
                      <div>
                        <div className="flex items-center gap-2 mb-2">
                          <h4 className="text-sm font-medium text-gray-700">Response Options (Columns):</h4>
                          <button
                            onClick={() => {
                              // Initialize editing state with current question data
                              const questionNumber = questionData.number || questionData.id;
                              const matchingQnr = questionnaires.find((qnr: any) => 
                                qnr.questions?.some((q: any) => 
                                  (q.number || q.id) === questionNumber
                                )
                              ) || allQuestionnaires.find((qnr: any) => 
                                qnr.questions?.some((q: any) => 
                                  (q.number || q.id) === questionNumber
                                )
                              );
                              
                              if (matchingQnr) {
                                const question = matchingQnr.questions?.find((q: any) => 
                                  (q.number || q.id) === questionNumber
                                );
                                if (question) {
                                  setEditingQuestion({
                                    ...question,
                                    responseOptions: question.responseOptions ? [...question.responseOptions] : [],
                                    statementOptions: question.statementOptions ? [...question.statementOptions] : [],
                                    options: question.options ? [...question.options] : []
                                  });
                                  setIsEditingQuestion(true);
                                }
                              }
                            }}
                            className="px-2 py-1 text-xs font-medium text-orange-600 hover:text-orange-700 flex items-center gap-1"
                            title="Edit response options"
                          >
                            <PencilIcon className="h-3 w-3" />
                            Edit
                          </button>
                        </div>
                        <div className="space-y-1">
                          {questionData.responseOptions.map((resp: any, idx: number) => {
                            const respObj = typeof resp === 'string' 
                              ? { code: `c${idx + 1}`, text: resp } 
                              : resp;
                            return (
                              <div key={idx} className="flex items-center gap-2 text-sm text-gray-700">
                                <span className="font-mono text-xs text-gray-500 w-12">{respObj.code}:</span>
                                <span>{respObj.text}</span>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    )}
                    
                    {questionData.tags && questionData.tags.length > 0 && (
                      <div>
                        <h4 className="text-sm font-medium text-gray-700 mb-2">Tags:</h4>
                        <div className="flex flex-wrap gap-2">
                          {questionData.tags.map((tag: string, idx: number) => (
                            <span key={idx} className="text-xs px-2 py-1 bg-blue-100 text-blue-700 rounded">
                              {tag}
                            </span>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                )
              ) : (
                <div className="text-center py-12">
                  <p className="text-gray-500">Question not found in QNR</p>
                </div>
              )}
            </div>
            
            {/* Bottom: Actions */}
            {questionData && (
              <div className="border-t border-gray-200 p-6 space-y-4">
                {isEditingQuestion && editingQuestion ? (
                  /* Edit Mode Actions */
                  <div className="flex gap-3">
                    <button
                      onClick={async () => {
                        try {
                          const questionNumber = questionData.number || questionData.id;
                          const matchingQnr = questionnaires.find((qnr: any) => 
                            qnr.questions?.some((q: any) => 
                              (q.number || q.id) === questionNumber
                            )
                          ) || allQuestionnaires.find((qnr: any) => 
                            qnr.questions?.some((q: any) => 
                              (q.number || q.id) === questionNumber
                            )
                          );
                          
                          if (!matchingQnr) {
                            alert('Questionnaire not found');
                            return;
                          }
                          
                          // Update the question in the questionnaire
                          const updatedQuestions = matchingQnr.questions.map((q: any) => {
                            if ((q.number || q.id) === questionNumber) {
                              return editingQuestion;
                            }
                            return q;
                          });
                          
                          // Save to API
                          const response = await fetch(`${API_BASE_URL}/api/questionnaire/${matchingQnr.id}`, {
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
                            // Update local state
                            const updatedQnr = { ...matchingQnr, questions: updatedQuestions };
                            const updatedQuestionnaires = questionnaires.map((qnr: any) => 
                              qnr.id === matchingQnr.id ? updatedQnr : qnr
                            );
                            setQuestionnaires(updatedQuestionnaires);
                            
                            // Update questionData to reflect changes
                            setQuestionData(editingQuestion);
                            setIsEditingQuestion(false);
                            setEditingQuestion(null);
                            
                            // Reload variables to reflect changes
                            if (selectedQuestionnaire && selectedQuestionnaire.id === matchingQnr.id) {
                              // Reload the questionnaire to get updated questions
                              const reloadResponse = await fetch(`${API_BASE_URL}/api/questionnaire/${selectedQuestionnaire.id}`, {
                                headers: { 'Authorization': `Bearer ${localStorage.getItem('cognitive_dash_token')}` }
                              });
                              if (reloadResponse.ok) {
                                const reloadedQnr = await reloadResponse.json();
                                setQuestionnaireQuestions(reloadedQnr.questions || []);
                              }
                            }
                          } else {
                            alert('Failed to save changes');
                          }
                        } catch (error) {
                          console.error('Error saving question:', error);
                          alert('Error saving question');
                        }
                      }}
                      className="flex-1 px-4 py-2 text-sm font-medium text-white rounded-lg shadow-sm transition-colors hover:opacity-90"
                      style={{ backgroundColor: BRAND_ORANGE }}
                    >
                      Save Changes
                    </button>
                    <button
                      onClick={() => {
                        setIsEditingQuestion(false);
                        setEditingQuestion(null);
                      }}
                      className="px-4 py-2 text-sm font-medium text-gray-700 bg-gray-100 rounded-lg hover:bg-gray-200 transition-colors"
                    >
                      Cancel
                    </button>
                  </div>
                ) : (
                  /* View Mode Actions */
                  <>
                    {/* Programming Logic */}
                    {(questionData.showLogic || questionData.logic || questionData.terminateLogic || questionData.randomize !== undefined) && (
                      <div className="space-y-3">
                        <h4 className="text-sm font-semibold text-gray-900">Programming Logic:</h4>
                        
                        {questionData.showLogic && (
                          <div>
                            <h5 className="text-xs font-medium text-gray-700 mb-1">Show Logic:</h5>
                            <p className="text-xs text-gray-600 font-mono bg-gray-50 p-2 rounded">
                              {typeof questionData.showLogic === 'string' 
                                ? questionData.showLogic 
                                : JSON.stringify(questionData.showLogic, null, 2)}
                            </p>
                          </div>
                        )}
                        
                        {questionData.logic && (
                          <div>
                            <h5 className="text-xs font-medium text-gray-700 mb-1">Logic:</h5>
                            <p className="text-xs text-gray-600 font-mono bg-gray-50 p-2 rounded">
                              {typeof questionData.logic === 'string' 
                                ? questionData.logic 
                                : JSON.stringify(questionData.logic, null, 2)}
                            </p>
                          </div>
                        )}
                        
                        {questionData.terminateLogic && (
                          <div>
                            <h5 className="text-xs font-medium text-gray-700 mb-1">Terminate Logic:</h5>
                            <p className="text-xs text-gray-600 font-mono bg-gray-50 p-2 rounded">
                              {typeof questionData.terminateLogic === 'string' 
                                ? questionData.terminateLogic 
                                : JSON.stringify(questionData.terminateLogic, null, 2)}
                            </p>
                          </div>
                        )}
                        
                        {questionData.randomize !== undefined && (
                          <div>
                            <h5 className="text-xs font-medium text-gray-700 mb-1">Randomize:</h5>
                            <p className="text-xs text-gray-600 font-mono bg-gray-50 p-2 rounded">
                              {questionData.randomize ? 'Yes' : 'No'}
                            </p>
                          </div>
                        )}
                      </div>
                    )}
                    
                    {/* Button to navigate to QNR tab */}
                    {selectedProject && (() => {
                      const questionNumber = questionData.number || questionData.id;
                      const matchingQnr = questionnaires.find((qnr: any) => 
                        qnr.questions?.some((q: any) => 
                          (q.number || q.id) === questionNumber
                        )
                      ) || allQuestionnaires.find((qnr: any) => 
                        qnr.questions?.some((q: any) => 
                          (q.number || q.id) === questionNumber
                        )
                      );
                      
                      return matchingQnr ? (
                        <div>
                          <button
                            onClick={() => {
                              sessionStorage.setItem('cognitive_dash_tabs_sync_project_id', selectedProject.id);
                              sessionStorage.setItem('cognitive_dash_tabs_sync_qnr_id', matchingQnr.id);
                              setShowQuestionModal(false);
                              navigate('/qnr');
                            }}
                            className="w-full flex items-center justify-center gap-2 px-4 py-2 text-sm font-medium text-white rounded-lg shadow-sm transition-colors hover:opacity-90"
                            style={{ backgroundColor: BRAND_ORANGE }}
                          >
                            <span>Open in QNR Tab</span>
                          </button>
                        </div>
                      ) : null;
                    })()}
                  </>
                )}
              </div>
            )}
          </div>
        </div>,
        document.body
      )}

      {/* Column Header Selection Modal */}
      {showColumnHeaderModal && selectedQuestionForMapping && createPortal(
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50" style={{ top: 0, left: 0, right: 0, bottom: 0, position: 'fixed' }} onClick={() => {
          setShowColumnHeaderModal(false);
          setSelectedQuestionForMapping(null);
          setColumnHeaderModalSearch('');
        }}>
          <div className="bg-white rounded-lg shadow-xl max-w-2xl w-full mx-4 max-h-[80vh] overflow-hidden flex flex-col" onClick={(e) => e.stopPropagation()}>
            {/* Header */}
            <div className="flex items-center justify-between p-6 border-b border-gray-200">
              <h3 className="text-lg font-semibold text-gray-900">
                Select Column Header for Question {selectedQuestionForMapping}
              </h3>
              <button
                onClick={() => {
                  setShowColumnHeaderModal(false);
                  setSelectedQuestionForMapping(null);
                  setColumnHeaderModalSearch('');
                }}
                className="text-gray-400 hover:text-gray-600"
              >
                <XMarkIcon className="h-6 w-6" />
              </button>
            </div>
            
            {/* Search Bar */}
            <div className="p-4 border-b border-gray-200">
              <div className="relative">
                <MagnifyingGlassIcon className="absolute left-3 top-1/2 transform -translate-y-1/2 h-5 w-5 text-gray-400" />
                <input
                  type="text"
                  id="column-header-modal-search"
                  name="column-header-modal-search"
                  placeholder="Search column headers..."
                  value={columnHeaderModalSearch}
                  onChange={(e) => setColumnHeaderModalSearch(e.target.value)}
                  className="w-full pl-10 pr-4 py-2 text-sm border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-orange-500 focus:border-transparent"
                  autoFocus
                />
              </div>
            </div>
            
            {/* Column Headers List */}
            <div className="flex-1 overflow-y-auto p-4">
              {(() => {
                const filteredHeaders = columnHeaders.filter(header =>
                  header.toLowerCase().includes(columnHeaderModalSearch.toLowerCase())
                );
                const currentMapping = columnMapping[selectedQuestionForMapping] || '';

                if (filteredHeaders.length === 0) {
                  return (
                    <div className="text-center py-12">
                      <p className="text-gray-500">No column headers found</p>
                    </div>
                  );
                }

                return (
                  <div className="space-y-1">
                    {filteredHeaders.map((header, index) => (
                      <button
                        key={header}
                        type="button"
                        onClick={() => {
                          // Find the question being mapped
                          const question = questionnaireQuestions.find(q => (q.number || q.id) === selectedQuestionForMapping);
                          const questionType = question?.type || '';
                          const isMultiSelect = questionType.toLowerCase().includes('multi-select') && !questionType.toLowerCase().includes('grid');
                          
                          if (isMultiSelect) {
                            // Get response options from either options or responseOptions
                            const responseOptions = question?.responseOptions && Array.isArray(question.responseOptions) 
                              ? question.responseOptions 
                              : (question?.options && Array.isArray(question.options) ? question.options : []);
                            
                            if (responseOptions.length > 0) {
                              // For multiselect questions, map all response option variables
                              const newMapping = { ...columnMapping };
                              const basePattern = selectedQuestionForMapping;
                              
                              // Determine the pattern from the selected header
                              // Check if the header starts with the question number and has a pattern suffix
                              let detectedPattern: 'underscore' | 'r' | 'dash' | null = null;
                              
                              // Check if header starts with basePattern and has a pattern indicator
                              if (header.startsWith(basePattern)) {
                                const suffix = header.substring(basePattern.length);
                                if (suffix.startsWith('_')) {
                                  detectedPattern = 'underscore';
                                } else if (suffix.match(/^r\d+$/i)) {
                                  detectedPattern = 'r';
                                } else if (suffix.startsWith('-')) {
                                  detectedPattern = 'dash';
                                }
                              }
                              
                              // If we detected a pattern from the header, use it; otherwise try all patterns
                              const patternsToTry = detectedPattern 
                                ? [detectedPattern] 
                                : ['r', 'underscore', 'dash']; // Try 'r' first as it's common
                              
                              let foundHeaders: string[] = [];
                              
                              for (const pattern of patternsToTry) {
                                foundHeaders = [];
                                
                                for (let i = 1; i <= responseOptions.length; i++) {
                                  let testHeader = '';
                                  if (pattern === 'underscore') {
                                    testHeader = `${basePattern}_${i}`;
                                    if (!columnHeaders.includes(testHeader)) {
                                      testHeader = `${basePattern}_${String(i).padStart(2, '0')}`;
                                    }
                                  } else if (pattern === 'r') {
                                    testHeader = `${basePattern}r${i}`;
                                  } else if (pattern === 'dash') {
                                    testHeader = `${basePattern}-${i}`;
                                  }
                                  
                                  if (columnHeaders.includes(testHeader)) {
                                    foundHeaders.push(testHeader);
                                  }
                                }
                                
                                // If we found headers matching this pattern, use it
                                if (foundHeaders.length > 0) {
                                  break;
                                }
                              }
                              
                              // Map all found headers to their corresponding response option variables
                              foundHeaders.forEach((foundHeader, index) => {
                                const optionNumber = index + 1;
                                
                                // Determine variable name based on the header pattern
                                let varName = '';
                                if (foundHeader.includes('_') && !foundHeader.includes('r')) {
                                  varName = foundHeader; // Use exact match for underscore pattern
                                } else if (foundHeader.includes('r') && !foundHeader.includes('_')) {
                                  varName = `${basePattern}r${optionNumber}`;
                                } else if (foundHeader.includes('-')) {
                                  varName = `${basePattern}-${optionNumber}`;
                                } else {
                                  varName = `${basePattern}_${optionNumber}`;
                                }
                                
                                newMapping[varName] = foundHeader;
                              });
                              
                              setColumnMapping(newMapping);
                            } else {
                              // No response options found, map normally
                              setColumnMapping(prev => ({
                                ...prev,
                                [selectedQuestionForMapping]: header
                              }));
                            }
                          } else {
                            // For non-multiselect questions, map normally
                            setColumnMapping(prev => ({
                              ...prev,
                              [selectedQuestionForMapping]: header
                            }));
                          }
                          
                          setShowColumnHeaderModal(false);
                          setSelectedQuestionForMapping(null);
                          setColumnHeaderModalSearch('');
                        }}
                        className={`w-full px-4 py-3 text-sm text-left rounded-md transition-colors ${
                          currentMapping === header
                            ? 'bg-orange-100 text-orange-900 border-2 border-orange-500'
                            : 'bg-gray-50 text-gray-900 hover:bg-gray-100 border-2 border-transparent'
                        }`}
                      >
                        <div className="flex items-center justify-between">
                          <span className="font-medium">{header}</span>
                          {currentMapping === header && (
                            <span className="text-xs px-2 py-1 bg-orange-200 text-orange-800 rounded">
                              Current
                            </span>
                          )}
                        </div>
                      </button>
                    ))}
                  </div>
                );
              })()}
            </div>
          </div>
        </div>,
        document.body
      )}

      {/* Unmapped Header Mapping Modal */}
      {showUnmappedHeaderMappingModal && selectedUnmappedExpectedHeader && createPortal(
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50" style={{ top: 0, left: 0, right: 0, bottom: 0, position: 'fixed' }} onClick={() => {
          setShowUnmappedHeaderMappingModal(false);
          setSelectedUnmappedExpectedHeader(null);
          setUnmappedHeaderMappingSearch('');
        }}>
          <div className="bg-white rounded-lg shadow-xl max-w-2xl w-full mx-4 max-h-[80vh] overflow-hidden flex flex-col" onClick={(e) => e.stopPropagation()}>
            {/* Header */}
            <div className="flex items-center justify-between p-6 border-b border-gray-200">
              <div>
                <h3 className="text-lg font-semibold text-gray-900">
                  Map Expected Header
                </h3>
                <p className="text-sm text-gray-500 mt-1">{selectedUnmappedExpectedHeader}</p>
              </div>
              <button
                onClick={() => {
                  setShowUnmappedHeaderMappingModal(false);
                  setSelectedUnmappedExpectedHeader(null);
                  setUnmappedHeaderMappingSearch('');
                }}
                className="text-gray-400 hover:text-gray-600"
              >
                <XMarkIcon className="h-6 w-6" />
              </button>
            </div>
            
            {/* Search and Column Headers List */}
            <div className="flex-1 overflow-y-auto p-6">
              <div className="mb-4">
                <div className="relative">
                  <MagnifyingGlassIcon className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-gray-400" />
                  <input
                    type="text"
                    placeholder="Search unused column headers..."
                    value={unmappedHeaderMappingSearch}
                    onChange={(e) => setUnmappedHeaderMappingSearch(e.target.value)}
                    className="w-full pl-10 pr-4 py-2 text-sm border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-orange-500 focus:border-transparent"
                    autoFocus
                  />
                </div>
              </div>
              
              {/* List of unused column headers */}
              <div className="space-y-2">
                {(() => {
                  // Get unused column headers
                  const usedColumnHeaders = new Set<string>(
                    Object.values(columnMapping)
                      .filter(h => h && h.trim() !== '')
                      .map(h => h.toLowerCase().trim())
                  );
                  const unusedColumnHeaders = columnHeaders.filter(colHeader => {
                    if (!colHeader || colHeader.trim() === '') return false;
                    return !usedColumnHeaders.has(colHeader.toLowerCase().trim());
                  });
                  
                  // Filter by search
                  const filteredHeaders = unusedColumnHeaders.filter(header => {
                    if (!unmappedHeaderMappingSearch.trim()) return true;
                    return header.toLowerCase().includes(unmappedHeaderMappingSearch.toLowerCase());
                  });
                  
                  if (filteredHeaders.length === 0) {
                    return (
                      <div className="text-center py-8 text-sm text-gray-500">
                        {unmappedHeaderMappingSearch.trim() ? 'No unused column headers match your search.' : 'No unused column headers available.'}
                      </div>
                    );
                  }
                  
                  return filteredHeaders.map((colHeader) => (
                    <button
                      key={colHeader}
                      onClick={async () => {
                        // Update the mapping
                        const newMapping = { ...columnMapping };
                        newMapping[selectedUnmappedExpectedHeader] = colHeader;
                        setColumnMapping(newMapping);
                        
                        // Save to backend
                        if (selectedQuestionnaire) {
                          try {
                            const saveResponse = await fetch(`${API_BASE_URL}/api/questionnaire/map-columns`, {
                              method: 'POST',
                              headers: {
                                'Content-Type': 'application/json',
                              },
                              body: JSON.stringify({
                                questionnaireId: selectedQuestionnaire.id,
                                variableNames: variables.map(v => v.name),
                                dataHeaders: columnHeaders,
                                mapping: newMapping
                              })
                            });
                            if (saveResponse.ok) {
                              // Wait a bit for the backend to persist, then reload
                              await new Promise(resolve => setTimeout(resolve, 300));
                              debouncedLoadFileInfo(500);
                            } else {
                              console.error('Failed to save mapping:', await saveResponse.text());
                            }
                          } catch (error) {
                            console.error('Error saving mapping:', error);
                          }
                        }
                        
                        // Close modal
                        setShowUnmappedHeaderMappingModal(false);
                        setSelectedUnmappedExpectedHeader(null);
                        setUnmappedHeaderMappingSearch('');
                      }}
                      className="w-full text-left px-4 py-3 text-sm border border-gray-200 rounded-md hover:bg-orange-50 hover:border-orange-300 transition-colors"
                    >
                      {colHeader}
                    </button>
                  ));
                })()}
              </div>
            </div>
          </div>
        </div>,
        document.body
      )}

      {/* Unmapped Question Mapping Modal */}
      {showUnmappedQuestionMappingModal && selectedUnmappedQuestion && createPortal(
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50" style={{ top: 0, left: 0, right: 0, bottom: 0, position: 'fixed' }} onClick={() => {
          setShowUnmappedQuestionMappingModal(false);
          setSelectedUnmappedQuestion(null);
          setOpenDropdownForHeader(null);
          setDropdownSearch('');
        }}>
          <div className="bg-white rounded-lg shadow-xl max-w-4xl w-full mx-4 max-h-[90vh] overflow-hidden flex flex-col" onClick={(e) => e.stopPropagation()}>
            {/* Header */}
            <div className="flex items-center justify-between p-6 border-b border-gray-200">
              <div>
                <h3 className="text-lg font-semibold text-gray-900">
                  Map Expected Headers for Question {selectedUnmappedQuestion.baseNumber}
                </h3>
                <p className="text-sm text-gray-500 mt-1">{selectedUnmappedQuestion.type || 'Unknown Type'}</p>
              </div>
              <button
                onClick={() => {
                  setShowUnmappedQuestionMappingModal(false);
                  setSelectedUnmappedQuestion(null);
                  setOpenDropdownForHeader(null);
                  setDropdownSearch('');
                }}
                className="text-gray-400 hover:text-gray-600"
              >
                <XMarkIcon className="h-6 w-6" />
              </button>
            </div>
            
            {/* Expected Headers and Column Headers Mapping */}
            <div 
              className="flex-1 overflow-y-auto p-6"
              onClick={() => {
                setOpenDropdownForHeader(null);
                setDropdownSearch('');
              }}
            >
              {(() => {
                const expectedHeaders = getExpectedColumnHeadersForBase(selectedUnmappedQuestion.baseNumber, variables);
                const usedHeaders = new Set(Object.values(columnMapping).filter(h => h && h !== ''));
                
                return (
                  <div className="space-y-4">
                    {expectedHeaders.map((expectedHeader, idx) => {
                      // Find which variable this expected header corresponds to
                      const matchingVariable = selectedUnmappedQuestion.variables.find(v => v.name === expectedHeader);
                      const currentMapping = columnMapping[expectedHeader] || '';
                      const isDropdownOpen = openDropdownForHeader === expectedHeader;
                      
                      // Filter headers based on dropdown search
                      const filteredHeaders = columnHeaders.filter(h => 
                        !dropdownSearch || h.toLowerCase().includes(dropdownSearch.toLowerCase())
                      );
                      
                      return (
                        <div key={idx} className="flex items-center gap-4" onClick={(e) => e.stopPropagation()}>
                          <div className="flex items-center gap-2 min-w-[200px]">
                            <span className="inline-block px-2 py-1 text-xs font-medium rounded bg-blue-50 text-blue-700 border border-blue-200">
                              {expectedHeader}
                            </span>
                            {matchingVariable && (
                              <span className="text-xs text-gray-500">
                                ({matchingVariable.type || 'Unknown'})
                              </span>
                            )}
                          </div>
                          
                          <div className="flex-1 relative">
                            <button
                              type="button"
                              onClick={() => {
                                if (isDropdownOpen) {
                                  setOpenDropdownForHeader(null);
                                  setDropdownSearch('');
                                } else {
                                  setOpenDropdownForHeader(expectedHeader);
                                  setDropdownSearch('');
                                }
                              }}
                              className="w-full text-left px-4 py-2 text-sm border border-gray-300 rounded-md bg-white hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-orange-500 focus:border-transparent flex items-center justify-between"
                            >
                              <span className={currentMapping ? 'text-gray-900' : 'text-gray-500'}>
                                {currentMapping || 'Select column header...'}
                              </span>
                              <svg className={`h-5 w-5 text-gray-400 transition-transform ${isDropdownOpen ? 'transform rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                              </svg>
                            </button>
                            
                            {isDropdownOpen && (
                              <div className="absolute z-10 mt-1 w-full bg-white border border-gray-300 rounded-md shadow-lg max-h-60 overflow-hidden flex flex-col">
                                {/* Search bar inside dropdown */}
                                <div className="p-2 border-b border-gray-200">
                                  <div className="relative">
                                    <MagnifyingGlassIcon className="absolute left-2 top-1/2 transform -translate-y-1/2 h-4 w-4 text-gray-400" />
                                    <input
                                      type="text"
                                      id="dropdown-column-header-search"
                                      name="dropdown-column-header-search"
                                      placeholder="Search column headers..."
                                      value={dropdownSearch}
                                      onChange={(e) => setDropdownSearch(e.target.value)}
                                      className="w-full pl-8 pr-3 py-1.5 text-sm border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-orange-500 focus:border-transparent"
                                      autoFocus
                                      onClick={(e) => e.stopPropagation()}
                                    />
                                  </div>
                                </div>
                                
                                {/* Dropdown list */}
                                <div className="overflow-y-auto max-h-48">
                                  {filteredHeaders.length === 0 ? (
                                    <div className="p-4 text-center text-sm text-gray-500">
                                      No column headers found
                                    </div>
                                  ) : (
                                    <div className="divide-y divide-gray-200">
                                      {filteredHeaders.map((header) => {
                                        const isUsed = usedHeaders.has(header) && header !== currentMapping;
                                        const isSelected = currentMapping === header;
                                        
                                        return (
                                          <button
                                            key={header}
                                            type="button"
                                            onClick={(e) => {
                                              e.stopPropagation();
                                              if (isUsed) return;
                                              
                                              const newMapping = {
                                                ...columnMapping,
                                                [expectedHeader]: header
                                              };
                                              
                                              setColumnMapping(newMapping);
                                              
                                              // Save to backend
                                              if (selectedQuestionnaire) {
                                                fetch(`${API_BASE_URL}/api/questionnaire/map-columns`, {
                                                  method: 'POST',
                                                  headers: {
                                                    'Authorization': `Bearer ${localStorage.getItem('cognitive_dash_token')}`,
                                                    'Content-Type': 'application/json'
                                                  },
                                                  body: JSON.stringify({
                                                    questionnaireId: selectedQuestionnaire.id,
                                                    variableNames: variables.map(v => v.name),
                                                    dataHeaders: columnHeaders,
                                                    mapping: newMapping
                                                  })
                                                }).then(() => {
                                                  debouncedLoadFileInfo(500);
                                                });
                                              }
                                              
                                              setOpenDropdownForHeader(null);
                                              setDropdownSearch('');
                                            }}
                                            disabled={isUsed}
                                            className={`w-full text-left px-4 py-2 text-sm transition-colors ${
                                              isSelected 
                                                ? 'bg-orange-50 text-orange-700 font-medium' 
                                                : isUsed
                                                ? 'bg-gray-50 text-gray-400 cursor-not-allowed'
                                                : 'hover:bg-gray-50 text-gray-700'
                                            }`}
                                          >
                                            <div className="flex items-center justify-between">
                                              <span>{header}</span>
                                              {isSelected && (
                                                <span className="text-xs text-orange-600">✓</span>
                                              )}
                                              {isUsed && header !== currentMapping && (
                                                <span className="text-xs text-gray-400">Already mapped</span>
                                              )}
                                            </div>
                                          </button>
                                        );
                                      })}
                                    </div>
                                  )}
                                </div>
                              </div>
                            )}
                          </div>
                          
                          {currentMapping && (
                            <button
                              type="button"
                              onClick={async () => {
                                const newMapping = { ...columnMapping };
                                delete newMapping[expectedHeader];

                                setColumnMapping(newMapping);

                                // Save to backend
                                if (selectedQuestionnaire) {
                                  try {
                                    const response = await fetch(`${API_BASE_URL}/api/questionnaire/map-columns`, {
                                      method: 'POST',
                                      headers: {
                                        'Authorization': `Bearer ${localStorage.getItem('cognitive_dash_token')}`,
                                        'Content-Type': 'application/json'
                                      },
                                      body: JSON.stringify({
                                        questionnaireId: selectedQuestionnaire.id,
                                        variableNames: variables.map(v => v.name),
                                        dataHeaders: columnHeaders,
                                        mapping: newMapping
                                      })
                                    });
                                    if (response.ok) {
                                      // Wait a bit for the backend to persist, then reload
                                      await new Promise(resolve => setTimeout(resolve, 300));
                                      debouncedLoadFileInfo(500);
                                    } else {
                                      console.error('Failed to save mapping removal:', await response.text());
                                    }
                                  } catch (error) {
                                    console.error('Error saving mapping removal:', error);
                                  }
                                }
                              }}
                              className="px-3 py-2 text-xs text-red-600 hover:text-red-700 font-medium whitespace-nowrap"
                            >
                              Clear
                            </button>
                          )}
                        </div>
                      );
                    })}
                  </div>
                );
              })()}
            </div>
            
            {/* Footer */}
            <div className="border-t border-gray-200 p-4 flex items-center justify-end">
              <button
                onClick={() => {
                  setShowUnmappedQuestionMappingModal(false);
                  setSelectedUnmappedQuestion(null);
                  setOpenDropdownForHeader(null);
                  setDropdownSearch('');
                }}
                className="px-4 py-2 text-sm font-medium text-gray-700 bg-gray-100 rounded-md hover:bg-gray-200 transition-colors"
              >
                Close
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}
    </div>
    </>
  );
}
















































































