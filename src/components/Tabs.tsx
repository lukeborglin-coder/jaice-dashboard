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
} from '@heroicons/react/24/outline';
import { IconTable } from '@tabler/icons-react';
import { API_BASE_URL } from '../config';
import { useAuth } from '../contexts/AuthContext';
import { useNavigate } from 'react-router-dom';
import * as XLSX from 'xlsx';
import { type BannerGroup, type BannerCut } from '../types/dataTabulation';
import BannerBuilder from './BannerBuilder';
import CrossTabDisplay from './CrossTabDisplay';
import { parseDataFile, type ParsedDataFile } from '../utils/dataTabulationParser';
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
  const [allQuestionnaires, setAllQuestionnaires] = useState<any[]>([]);
  const [qnrViewMode, setQnrViewMode] = useState<'variables' | 'banners' | 'data'>('variables');
  const [bannerGroups, setBannerGroups] = useState<BannerGroup[]>([]);
  const [showBannerBuilder, setShowBannerBuilder] = useState(false);
  const [editingBannerGroup, setEditingBannerGroup] = useState<BannerGroup | null>(null);
  const [selectedBannerGroupId, setSelectedBannerGroupId] = useState<string | null>(null);
  const [selectedStubVariables, setSelectedStubVariables] = useState<Record<string, string>>({});
  const [parsedFile, setParsedFile] = useState<ParsedDataFile | null>(null);
  const [mappingFilter, setMappingFilter] = useState<'all' | 'mapped' | 'unmapped'>('all');

  // Load banner groups from localStorage when questionnaire changes
  useEffect(() => {
    if (selectedQuestionnaire?.id) {
      const key = `bannerGroups_${selectedQuestionnaire.id}`;
      const stored = localStorage.getItem(key);
      if (stored) {
        try {
          const parsed = JSON.parse(stored);
          setBannerGroups(parsed.groups || []);
          setSelectedStubVariables(parsed.selectedStubVariables || {});
        } catch (e) {
          console.error('Error loading banner groups:', e);
        }
      } else {
        setBannerGroups([]);
        setSelectedStubVariables({});
      }
    } else {
      setBannerGroups([]);
      setSelectedStubVariables({});
    }
  }, [selectedQuestionnaire?.id]);

  // Save banner groups to localStorage when they change
  useEffect(() => {
    if (selectedQuestionnaire?.id && (bannerGroups.length > 0 || Object.keys(selectedStubVariables).length > 0)) {
      const key = `bannerGroups_${selectedQuestionnaire.id}`;
      const data = {
        groups: bannerGroups,
        selectedStubVariables: selectedStubVariables
      };
      localStorage.setItem(key, JSON.stringify(data));
    }
  }, [bannerGroups, selectedStubVariables, selectedQuestionnaire?.id]);
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
      const questionType = question.type || '';
      const isNumericGrid = questionType.toLowerCase().includes('numeric grid');
      const isNumericList = questionType.toLowerCase().includes('numeric list');
      const isSingleSelectGrid = questionType.toLowerCase().includes('single select grid');
      const isMultiSelectGrid = questionType.toLowerCase().includes('multi-select grid');
      const isGrid = isNumericGrid || isSingleSelectGrid || isMultiSelectGrid;
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
        
        // For single select grids: summary tables variable first, then individual statement variables
        // Summary tables variable - contains summary tables for each response option
        vars.push({
          name: `${questionNumber}_Summary Tables`,
          description: question.text || '',
          type: questionType,
          statements: statements,
          codes: codes,
          tags: question.tags || [],
          isSummaryTable: true,
          isScaleSummary: false
        });
        
        processedQuestionNumbers.add(questionNumber);
        
        // Then individual statement variables
        Object.entries(statements).forEach(([stmtCode, stmtText]) => {
          const statementVarName = `${questionNumber}_${stmtCode}`;
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
      // For single select grids without scale tag: summary tables variable first, then individual statement variables
      else if (isSingleSelectGrid && statements && codes && Object.keys(statements).length > 0 && Object.keys(codes).length > 0) {
        // Summary tables variable - contains summary tables for each response option
        vars.push({
          name: `${questionNumber}_Summary Tables`,
          description: question.text || '',
          type: questionType,
          statements: statements,
          codes: codes,
          tags: question.tags || [],
          isSummaryTable: true,
          isScaleSummary: false
        });
        
        processedQuestionNumbers.add(questionNumber);
        
        // Then individual statement variables
        Object.entries(statements).forEach(([stmtCode, stmtText]) => {
          const statementVarName = `${questionNumber}_${stmtCode}`;
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
          const statementVarName = `${questionNumber}_${stmtCode}`;
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
      // For numeric list questions: create individual variables for each option
      else if (isNumericList && codes && Object.keys(codes).length > 0) {
        processedQuestionNumbers.add(questionNumber);
        
        // Create individual variables for each option
        Object.entries(codes).forEach(([optionCode, optionText]) => {
          const optionVarName = `${questionNumber}_${optionCode}`;
          vars.push({
            name: optionVarName,
            description: `${question.text || questionNumber}\n${optionText}`,
            type: 'Numeric',
            tags: question.tags || [],
            isSummaryTable: false,
            isScaleSummary: false
          });
        });
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

  // Generate expected column headers for a base question (all variables with that base)
  const getExpectedColumnHeadersForBase = useCallback((baseQuestionNumber: string, allVariables: Variable[]): string[] => {
    // Find all variables that belong to this base question
    const relatedVariables = allVariables.filter(v => {
      const base = getBaseQuestionNumber(v.name);
      return base === baseQuestionNumber;
    });

    // Check the original question data to see if it has statements
    const question = questionnaireQuestions.find(q => (q.number || q.id) === baseQuestionNumber);
    const questionType = question?.type || '';
    const isNumericList = questionType.toLowerCase().includes('numeric list');
    const isNumericGrid = questionType.toLowerCase().includes('numeric grid');
    const isNumericOnly = questionType.toLowerCase() === 'numeric' || (questionType.toLowerCase().includes('numeric') && !isNumericList && !isNumericGrid);
    
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
      if (rowCodes.length > 0) {
        rowCodes.forEach(rowCode => {
          const rowNumberMatch = rowCode.match(/r?(\d+)/i);
          const rowNum = rowNumberMatch ? rowNumberMatch[1] : rowCode.replace(/[^0-9]/g, '');
          
          if (colCodes.length > 0) {
            colCodes.forEach(colCode => {
              const colNumberMatch = colCode.match(/c?(\d+)/i);
              const colNum = colNumberMatch ? colNumberMatch[1] : colCode.replace(/[^0-9]/g, '');
              expectedHeaders.push(`Q${baseQuestionNumber}r${rowNum}c${colNum}`);
            });
          } else {
            // If no columns found, still add row with c1 (fallback)
            expectedHeaders.push(`Q${baseQuestionNumber}r${rowNum}c1`);
          }
        });
      }
      
      if (expectedHeaders.length > 0) {
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
      } else {
        // For non-numeric lists and non-numeric grids, handle statement variables with underscore pattern (e.g., S5_r1)
        const statementWithUnderscorePattern = new RegExp(`^${baseQuestionNumber}_r(\\d+)$`, 'i');
        const match = variable.name.match(statementWithUnderscorePattern);
        if (match) {
          // Convert S5_r1 -> QS5r1
          expectedHeaders.push(`Q${baseQuestionNumber}r${match[1]}`);
        } else {
          // Add "Q" prefix to variable name as-is
          expectedHeaders.push(`Q${variable.name}`);
        }
      }
    });

    // Sort to ensure consistent ordering
    return expectedHeaders.sort();
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
    if (!hasAttemptedMapping || variables.length === 0) {
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
      const headers = getExpectedColumnHeadersForBase(group.baseNumber, group.variables);
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
      
      // Final fallback: if column header value matches expected header exactly, consider it mapped
      // This handles edge cases where the variable name might not match but the column header does
      if (!isMapped) {
        for (const [varName, colHeader] of Object.entries(columnMapping)) {
          if (!colHeader || colHeader.trim() === '') continue;
          
          const colHeaderNormalized = colHeader.toLowerCase().trim();
          // Direct match check - if column header exactly matches expected header (with Q variations)
          if (colHeaderNormalized === expectedNormalized ||
              (colHeaderNormalized.startsWith('q') && colHeaderNormalized.substring(1) === expectedWithoutQ) ||
              (!colHeaderNormalized.startsWith('q') && 'q' + colHeaderNormalized === expectedWithQ)) {
            isMapped = true;
            mappedColumnHeader = colHeader;
            mappedVariableName = varName;
            break;
          }
        }
      }
      
      // Additional check: if expected header exactly matches any column header in the data file, consider it mapped
      // This handles cases where the column header exists in the data but hasn't been explicitly mapped yet
      if (!isMapped) {
        for (const colHeader of columnHeaders) {
          if (!colHeader || colHeader.trim() === '') continue;
          
          const colHeaderNormalized = colHeader.toLowerCase().trim();
          // Exact match (case-insensitive)
          if (colHeaderNormalized === expectedNormalized) {
            isMapped = true;
            mappedColumnHeader = colHeader; // Use the actual column header as it appears in the file
            mappedVariableName = expectedHeader; // Use expected header as the variable name
            break;
          }
        }
      }
      
      statusMap.set(expectedHeader, { isMapped, mappedColumnHeader, mappedVariableName });
    });
    
    return { filteredHeaders: filtered, mappingStatusMap: statusMap };
  }, [hasAttemptedMapping, variables, questionnaireQuestions, qnrVariableSearch, columnMapping, columnHeaders]);

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
      const headers = getExpectedColumnHeadersForBase(group.baseNumber, group.variables);
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
    const multiselectBaseQuestions = new Map<string, Variable>(); // baseQuestion -> first response variable (for metadata)
    
    variables.forEach(v => {
      const match = v.name.match(/^(.+?)r(\d+)$/i);
      if (match && v.type?.toLowerCase().includes('multi-select')) {
        const baseQuestion = match[1];
        multiselectResponseVars.add(v.name);
        if (!multiselectBaseQuestions.has(baseQuestion)) {
          // Store the first response variable to get metadata
          multiselectBaseQuestions.set(baseQuestion, v);
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
    
    // Add synthetic base question variables for multiselect questions
    multiselectBaseQuestions.forEach((firstRespVar, baseQuestion) => {
      // Check if base question variable already exists (it shouldn't for multiselects)
      const baseExists = filtered.some(v => v.name === baseQuestion);
      if (!baseExists) {
        // Create a synthetic variable for the base question
        // Use the question text from the first response variable's description
        const description = firstRespVar.description?.split(' - ')[0] || baseQuestion;
        filtered.push({
          name: baseQuestion,
          description: description,
          type: 'Multi-Select',
          codes: { '0': 'Not Selected', '1': 'Selected' }, // Binary codes for multiselect options
          tags: firstRespVar.tags || [],
          isSummaryTable: false,
          isScaleSummary: false
        });
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
    
    return filtered;
  }, [variables, variableFilter]);

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
                        <IconTable className="h-4 w-4 text-gray-400" />
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
                        const varData = variableData[v.name];
                        
                        // For summary tables (numeric grids), check if the table has any data to display
                        let hasData = false;
                        if ((v as any).isSummaryTable && v.statements) {
                          // Check if this is a column summary table (e.g., S4_c1_Summary)
                          const columnMatch = v.name.match(/^([A-Z0-9]+)_(c\d+)(?:_Summary)?$/i);
                          const isNumericGridColumnSummary = columnMatch && v.type?.toLowerCase().includes('numeric');
                          
                          if (isNumericGridColumnSummary) {
                            // For column summary tables, check if any rows have data (mean or sum)
                            const baseName = columnMatch![1];
                            const columnCode = columnMatch![2];
                            
                            hasData = Object.keys(v.statements).some((stmtCode) => {
                              // Try to find data for this row in this column
                              let hasRowData = false;
                              
                              // Check cell variables first
                              const cellVarNames = [
                                // Without Q prefix
                                `${baseName}${stmtCode}${columnCode}`,
                                `${baseName}_${stmtCode}_${columnCode}`,
                                `${baseName}${stmtCode}_${columnCode}`,
                                `${baseName}_${stmtCode}${columnCode}`,
                                // With Q prefix (data often stored with Q prefix)
                                `Q${baseName}${stmtCode}${columnCode}`,
                                `Q${baseName}_${stmtCode}_${columnCode}`,
                                `Q${baseName}${stmtCode}_${columnCode}`,
                                `Q${baseName}_${stmtCode}${columnCode}`,
                              ];
                              
                              for (const cellVarName of cellVarNames) {
                                const cellData = variableData[cellVarName];
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
                                const statementVarName = `${baseName}_${stmtCode}`;
                                const statementData = variableData[statementVarName];
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
                              const statementVarName = `${baseName}_${stmtCode}`;
                              const statementData = variableData[statementVarName];
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
                              const cellData = variableData[cellVarName];
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
                                const respVarData = variableData[respVar.name];
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
                            
                            Object.entries(v.codes || {}).forEach(([code]) => {
                              const count = getCount(code);
                              const percentage = total > 0 ? (count / total) * 100 : 0;
                              totalPercentage += percentage;
                            });
                            
                            if (total > 0 && totalPercentage > 0 && Math.abs(totalPercentage - 100) > 0.1) {
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
                                  
                                  // Find the question to get response option text
                                  const question = questionnaireQuestions.find(q => {
                                    const qNum = q.number || q.id;
                                    return qNum === baseQuestionNumber || 
                                           qNum === baseQuestionNumber.replace(/^Q/, '') ||
                                           String(qNum) === String(baseQuestionNumber);
                                  });
                                  
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
                              {hasPercentageError ? (
                                <InformationCircleIcon className="h-4 w-4 text-red-500 flex-shrink-0" title="Percentages don't sum to 100% - check response codes" />
                              ) : !hasData ? (
                                <InformationCircleIcon className="h-4 w-4 text-red-500 flex-shrink-0" title="No data available for this variable" />
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
                    
                    // DEBUG: Log the selected variable
                    if (variable) {
                      console.log(`[Numeric Grid Debug] Selected variable:`, {
                        name: variable.name,
                        type: variable.type,
                        hasNumeric: variable.type?.toLowerCase().includes('numeric'),
                        hasGrid: variable.type?.toLowerCase().includes('grid'),
                        matchesColumnPattern: /^([A-Z0-9]+)_(c\d+)$/i.test(variable.name),
                        columnMatch: variable.name.match(/^([A-Z0-9]+)_(c\d+)$/i)
                      });
                    }
                    if (!variable) {
                      return <div className="text-center py-12 text-gray-500">Variable not found</div>;
                    }
                  
                  const varData = variableData[variable.name];
                  
                  // Check if percentages don't sum to 100% (for single-select questions)
                  let hasPercentageError = false;
                  if (variable.codes && Object.keys(variable.codes).length > 0 && 
                      !variable.statements && !(variable as any).isSummaryTable && 
                      !variable.type?.toLowerCase().includes('numeric grid')) {
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
                      
                      Object.entries(variable.codes || {}).forEach(([code]) => {
                        const count = getCount(code);
                        const percentage = total > 0 ? (count / total) * 100 : 0;
                        totalPercentage += percentage;
                      });
                      
                      if (total > 0 && totalPercentage > 0 && Math.abs(totalPercentage - 100) > 0.1) {
                        hasPercentageError = true;
                      }
                    }
                  }
                  
                  // For summary tables (numeric grids), check if the table has any data to display
                  let hasData = false;
                  if ((variable as any).isSummaryTable && variable.statements) {
                    // Check if this is a column summary table (e.g., S4_c1_Summary)
                    const columnMatch = variable.name.match(/^([A-Z0-9]+)_(c\d+)(?:_Summary)?$/i);
                    const isNumericGridColumnSummary = columnMatch && variable.type?.toLowerCase().includes('numeric');
                    
                    if (isNumericGridColumnSummary) {
                      // For column summary tables, check if any rows have data (mean or sum)
                      const baseName = columnMatch![1];
                      const columnCode = columnMatch![2];
                      
                      hasData = Object.keys(variable.statements).some((stmtCode) => {
                        // Try to find data for this row in this column
                        let hasRowData = false;
                        
                        // Check cell variables first
                        const cellVarNames = [
                          // Without Q prefix
                          `${baseName}${stmtCode}${columnCode}`,
                          `${baseName}_${stmtCode}_${columnCode}`,
                          `${baseName}${stmtCode}_${columnCode}`,
                          `${baseName}_${stmtCode}${columnCode}`,
                          // With Q prefix (data often stored with Q prefix)
                          `Q${baseName}${stmtCode}${columnCode}`,
                          `Q${baseName}_${stmtCode}_${columnCode}`,
                          `Q${baseName}${stmtCode}_${columnCode}`,
                          `Q${baseName}_${stmtCode}${columnCode}`,
                        ];
                        
                        for (const cellVarName of cellVarNames) {
                          const cellData = variableData[cellVarName];
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
                          const statementVarName = `${baseName}_${stmtCode}`;
                          const statementData = variableData[statementVarName];
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
                        const statementVarName = `${baseName}_${stmtCode}`;
                        const statementData = variableData[statementVarName];
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
                        const cellData = variableData[cellVarName];
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
                      const columnVarData = variableData[variable.name];
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
                        const mappedColumnName = columnMapping[variable.name];
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
                            const cellData = variableData[cellVarName];
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
                        hasData = varData && (
                          (varData.count && varData.count > 0) ||
                          (varData.frequencies && Object.keys(varData.frequencies || {}).length > 0) ||
                          (varData.values && Array.isArray(varData.values) && varData.values.length > 0)
                        );
                          }
                        }
                      }
                    } else {
                      // Regular numeric variable, check direct data
                      hasData = varData && (
                        (varData.count && varData.count > 0) ||
                        (varData.frequencies && Object.keys(varData.frequencies || {}).length > 0) ||
                        (varData.values && Array.isArray(varData.values) && varData.values.length > 0)
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
                          const respVarData = variableData[v.name];
                          return respVarData && (
                            (respVarData.count && respVarData.count > 0) ||
                            (respVarData.frequencies && Object.keys(respVarData.frequencies || {}).length > 0) ||
                            (respVarData.values && Array.isArray(respVarData.values) && respVarData.values.length > 0)
                          );
                        }
                        return false;
                      });
                  } else {
                    // For regular variables, check the variable itself
                    hasData = varData && (
                      (varData.count && varData.count > 0) ||
                      (varData.frequencies && Object.keys(varData.frequencies || {}).length > 0) ||
                      (varData.values && Array.isArray(varData.values) && varData.values.length > 0)
                    );
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
                            // Check if this is a numeric grid column summary (e.g., S11_c1_Summary)
                            const columnSummaryMatch = variable.name.match(/^([A-Z0-9]+)_(c\d+)_Summary$/i);
                            if (columnSummaryMatch && (variable as any).isSummaryTable) {
                              const baseQuestionNumber = columnSummaryMatch[1];
                              const columnCode = columnSummaryMatch[2]; // e.g., "c1"
                              
                              // Find the question to get response option text
                              const question = questionnaireQuestions.find(q => {
                                const qNum = q.number || q.id;
                                return qNum === baseQuestionNumber || 
                                       qNum === baseQuestionNumber.replace(/^Q/, '') ||
                                       String(qNum) === String(baseQuestionNumber);
                              });
                              
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
                            <button
                              onClick={async () => {
                                setLoadingQuestion(true);
                                setShowQuestionModal(true);
                                
                                // Simulate loading for 1 second
                                await new Promise(resolve => setTimeout(resolve, 1000));
                                
                                try {
                                  // Fetch questionnaire data
                                  const response = await fetch(`${API_BASE_URL}/api/questionnaire/${selectedProject?.id}`, {
                                    headers: { 'Authorization': `Bearer ${localStorage.getItem('cognitive_dash_token')}` }
                                  });
                                  
                                  if (response.ok) {
                                    const questionnaires = await response.json();
                                    // Find the question that matches this variable
                                    // Extract base variable name (remove statement suffix if present)
                                    const statementMatch = variable.name.match(/^(.+)_(\d+)$/);
                                    const baseVarName = statementMatch ? statementMatch[1] : variable.name;
                                    
                                    // Find question in any questionnaire
                                    let foundQuestion = null;
                                    for (const qnr of questionnaires) {
                                      foundQuestion = qnr.questions?.find((q: any) => 
                                        (q.number || q.id) === baseVarName
                                      );
                                      if (foundQuestion) break;
                                    }
                                    
                                    setQuestionData(foundQuestion);
                                  }
                                } catch (error) {
                                  console.error('Error loading question:', error);
                                  setQuestionData(null);
                                } finally {
                                  setLoadingQuestion(false);
                                }
                              }}
                              className="flex items-center justify-center p-1.5 text-gray-600 hover:text-gray-900 hover:bg-gray-100 rounded transition-colors"
                              title="View Question from QNR"
                            >
                              <InformationCircleIcon className="h-5 w-5" />
                            </button>
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
                        {!hasData && (
                          <div className="bg-red-50 border border-red-200 rounded-lg p-4 flex items-start gap-3">
                            <InformationCircleIcon className="h-5 w-5 text-red-500 flex-shrink-0 mt-0.5" />
                            <div>
                              <h4 className="text-sm font-medium text-red-800 mb-1">No Data Available</h4>
                              <p className="text-sm text-red-700">
                                This variable has no data or mapping. This could mean:
                              </p>
                              <ul className="text-sm text-red-700 mt-2 list-disc list-inside space-y-1">
                                <li>The column mapping for this variable was not found in the uploaded data file</li>
                                <li>No data was extracted for this variable during processing</li>
                                <li>The variable name in the QNR doesn't match the column headers in your data file</li>
                              </ul>
                      </div>
                          </div>
                        )}

                        {/* Statistics section for numeric questions */}
                        {variable.type?.toLowerCase().includes('numeric') && !variable.type?.toLowerCase().includes('grid') && (
                        <div className="mb-4">
                                  {(() => {
                              const varData = variableData[variable.name];
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
                          // DEBUG: Check if condition matches
                          const hasNumeric = variable.type?.toLowerCase().includes('numeric');
                          const hasGrid = variable.type?.toLowerCase().includes('grid');
                          const conditionMatches = hasNumeric && !hasGrid;
                          const columnMatch = variable.name.match(/^([A-Z0-9]+)_(c\d+)$/i);
                          
                          console.log(`[Numeric Grid Debug] Checking condition for "${variable.name}":`, {
                            hasNumeric,
                            hasGrid,
                            conditionMatches,
                            columnMatch: !!columnMatch,
                            willEnter: conditionMatches && !!columnMatch
                          });
                          
                          if (!conditionMatches || !columnMatch) {
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
                              // DEBUG: Log the variable we're processing
                              console.log(`[Numeric Grid Debug] Processing column variable: ${variable.name}, baseName: ${baseName}, columnCode: ${columnCode}`);
                              
                              // DEBUG: Find all variableData keys that match this base question
                              const matchingKeys = Object.keys(variableData).filter(key => 
                                key.toLowerCase().includes(baseName.toLowerCase())
                              );
                              console.log(`[Numeric Grid Debug] Found ${matchingKeys.length} variableData keys matching baseName "${baseName}":`, matchingKeys.slice(0, 20));
                              
                              // The data is likely stored in statement variables (S11_r1, S11_r2, etc.)
                              // Each statement variable should have frequencies keyed by column codes (c1, c2, c3)
                              // OR the data might be in cell variables (S11_r1_c1, S11_r1_c2, etc.)
                              
                              // Build table showing all statements (rows) for this column
                              const statementRows = Object.entries(mainGridVar.statements).map(([stmtCode, stmtText]) => {
                                let value: number | undefined = undefined;
                                
                                // DEBUG: Log which row we're processing
                                console.log(`[Numeric Grid Debug] Processing row: stmtCode=${stmtCode}, stmtText=${stmtText}`);
                                
                                // Strategy 1: Check if statement variable exists (S11_r1) and has frequencies with column code
                                const statementVarName = `${baseName}_${stmtCode}`;
                                const statementVarData = variableData[statementVarName];
                                
                                // DEBUG: Check Strategy 1
                                console.log(`[Numeric Grid Debug] Strategy 1: Checking statementVarName="${statementVarName}"`, {
                                  exists: !!statementVarData,
                                  hasFrequencies: !!statementVarData?.frequencies,
                                  frequencies: statementVarData?.frequencies
                                });
                                
                                if (statementVarData && statementVarData.frequencies) {
                                  // Try to find the column code in frequencies
                                  if (statementVarData.frequencies[columnCode] !== undefined) {
                                    value = statementVarData.frequencies[columnCode];
                                    console.log(`[Numeric Grid Debug] ✅ Strategy 1 found value: ${value} using columnCode="${columnCode}"`);
                                  } else {
                                    // Try without "c" prefix (c1 -> 1)
                                    const colCodeWithoutPrefix = columnCode.replace(/^c/i, '');
                                    if (statementVarData.frequencies[colCodeWithoutPrefix] !== undefined) {
                                      value = statementVarData.frequencies[colCodeWithoutPrefix];
                                      console.log(`[Numeric Grid Debug] ✅ Strategy 1 found value: ${value} using colCodeWithoutPrefix="${colCodeWithoutPrefix}"`);
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
                                
                                // Strategy 2: Try cell variable formats (S11_r1_c1, etc.)
                                if (value === undefined) {
                                  // Get mapped column name if available
                                  const mappedColumnName = columnMapping[variable.name];
                                  
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
                                    mappedColumnName ? `${mappedColumnName.replace(/^Q/i, '')}${stmtCode}${columnCode}` : null,
                                    mappedColumnName ? `${mappedColumnName}_${stmtCode}_${columnCode}` : null,
                                    mappedColumnName ? `${mappedColumnName}${stmtCode}${columnCode}` : null
                                  ].filter(Boolean) as string[];
                                  
                                  // DEBUG: Log what we're trying
                                  console.log(`[Numeric Grid Debug] Strategy 2: Trying ${cellVarNames.length} cell variable names for row ${stmtCode}:`, cellVarNames);
                                  
                                  for (const cellVarName of cellVarNames) {
                                    const cellData = variableData[cellVarName];
                                    if (cellData) {
                                      console.log(`[Numeric Grid Debug] ✅ FOUND data for "${cellVarName}":`, {
                                        sum: cellData.sum,
                                        mean: cellData.mean,
                                        count: cellData.count,
                                        valuesLength: cellData.values?.length
                                      });
                                      if (cellData.sum !== undefined) {
                                        value = cellData.sum;
                                        break;
                                      } else if (cellData.mean !== undefined) {
                                        value = cellData.mean;
                                        break;
                                      } else if (cellData.values && Array.isArray(cellData.values) && cellData.values.length > 0) {
                                        // Sum up all numeric values
                                        value = cellData.values.reduce((sum: number, val: any) => {
                                          const numVal = parseFloat(val);
                                          return sum + (isNaN(numVal) ? 0 : numVal);
                                        }, 0);
                                        break;
                                      } else if (cellData.count !== undefined && cellData.count > 0) {
                                        // Use count as value if it's a frequency count
                                        value = cellData.count;
                                        break;
                                      }
                                    }
                                  }
                                  
                                  if (value === undefined) {
                                    console.log(`[Numeric Grid Debug] ❌ No data found for row ${stmtCode} in Strategy 2`);
                                  }
                                }
                                
                                // Strategy 3: Check if column variable exists (S11_c1) with statement codes as keys
                                if (value === undefined) {
                                  const columnVarData = variableData[variable.name];
                                  
                                  // DEBUG: Check Strategy 3
                                  console.log(`[Numeric Grid Debug] Strategy 3: Checking columnVarName="${variable.name}"`, {
                                    exists: !!columnVarData,
                                    hasFrequencies: !!columnVarData?.frequencies,
                                    frequencies: columnVarData?.frequencies
                                  });
                                  
                                  if (columnVarData && columnVarData.frequencies) {
                                    if (columnVarData.frequencies[stmtCode] !== undefined) {
                                      value = columnVarData.frequencies[stmtCode];
                                      console.log(`[Numeric Grid Debug] ✅ Strategy 3 found value: ${value} using stmtCode="${stmtCode}"`);
                                    } else {
                                      const codeWithoutPrefix = stmtCode.replace(/^[rc]/i, '');
                                      if (columnVarData.frequencies[codeWithoutPrefix] !== undefined) {
                                        value = columnVarData.frequencies[codeWithoutPrefix];
                                        console.log(`[Numeric Grid Debug] ✅ Strategy 3 found value: ${value} using codeWithoutPrefix="${codeWithoutPrefix}"`);
                                      }
                                    }
                                  }
                                  
                                  // Also check mapped column name
                                  if (value === undefined) {
                                    const mappedColumnName = columnMapping[variable.name];
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
                                
                                // DEBUG: Log final result for this row
                                if (value !== undefined) {
                                  console.log(`[Numeric Grid Debug] ✅ Final value for row ${stmtCode}: ${value}`);
                                } else {
                                  console.log(`[Numeric Grid Debug] ❌ No value found for row ${stmtCode} after all strategies`);
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
                          
                          const varData = variableData[variable.name];
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

                        {/* Summary Tables for single select grids - one table per response option */}
                        {(variable as any).isSummaryTable && variable.statements && variable.codes && variable.name.endsWith('_Summary Tables') && (() => {
                          // Extract base question number
                          const baseName = variable.name.replace('_Summary Tables', '');
                          
                          // Check if any statement variables have data
                          const hasData = Object.keys(variable.statements || {}).some((stmtCode) => {
                            const statementVarName = `${baseName}_${stmtCode}`;
                            const statementData = variableData[statementVarName];
                            return statementData && (
                              (statementData.count && statementData.count > 0) ||
                              (statementData.frequencies && Object.keys(statementData.frequencies || {}).length > 0) ||
                              (statementData.values && Array.isArray(statementData.values) && statementData.values.length > 0)
                            );
                          });
                          
                          if (!hasData) return null;
                          
                          // For each response option, create a summary table
                          return Object.entries(variable.codes || {}).map(([responseCode, responseLabel]) => {
                            // Calculate total count for this response option across all statements
                            let totalCount = 0;
                            const statementCounts: Array<{code: string, text: string, count: number}> = [];
                            
                            Object.entries(variable.statements || {}).forEach(([stmtCode, stmtText]) => {
                              const statementVarName = `${baseName}_${stmtCode}`;
                              const statementData = variableData[statementVarName];
                              
                              if (statementData) {
                                let count = 0;
                                
                                // Try to get count for this response code
                                if (statementData.frequencies) {
                                  // Try exact code match
                                  count = statementData.frequencies[responseCode] || 0;
                                  
                                  // Try without prefix
                                  if (count === 0) {
                                    const codeWithoutPrefix = responseCode.replace(/^[rc]/i, '');
                                    count = statementData.frequencies[codeWithoutPrefix] || 0;
                                  }
                                  
                                  // Try with prefix
                                  if (count === 0 && !responseCode.match(/^[rc]/i)) {
                                    count = statementData.frequencies[`c${responseCode}`] || 0;
                                    if (count === 0) {
                                      count = statementData.frequencies[`r${responseCode}`] || 0;
                                    }
                                  }
                                  
                                  // Try label match
                                  if (count === 0 && responseLabel) {
                                    const labelLower = String(responseLabel).toLowerCase().trim();
                                    const exactMatchKey = Object.keys(statementData.frequencies).find(key => 
                                      String(key).toLowerCase().trim() === labelLower
                                    );
                                    if (exactMatchKey) {
                                      count = statementData.frequencies[exactMatchKey] || 0;
                                    }
                                  }
                                }
                                
                                // Fallback to values array
                                if (count === 0 && statementData.values && Array.isArray(statementData.values) && responseLabel) {
                                  const labelLower = String(responseLabel).toLowerCase().trim();
                                  const codeWithoutPrefix = responseCode.replace(/^[rc]/i, '');
                                  count = statementData.values.filter((val: any) => {
                                    const valStr = String(val).toLowerCase().trim();
                                    return valStr === labelLower || 
                                           valStr === codeWithoutPrefix ||
                                           valStr === responseCode.toLowerCase();
                                  }).length;
                                }
                                
                                statementCounts.push({
                                  code: stmtCode,
                                  text: String(stmtText),
                                  count: count
                                });
                                totalCount += count;
                              } else {
                                statementCounts.push({
                                  code: stmtCode,
                                  text: String(stmtText),
                                  count: 0
                                });
                              }
                            });
                            
                            // Only show table if there's data
                            if (totalCount === 0) return null;
                            
                            const displayCode = responseCode.replace(/^[rc]/i, '');
                            
                            return (
                              <div key={responseCode} className="mt-4 bg-white border border-gray-200 rounded-lg overflow-hidden">
                                <div className="overflow-x-auto">
                                  <table className="min-w-full divide-y divide-gray-200">
                                    <thead className="bg-gray-50">
                                      <tr>
                                        <th colSpan={2} className="px-4 py-2 text-left text-sm font-semibold text-gray-900">
                                          {responseLabel} (Code: {displayCode})
                                        </th>
                                        <th className="px-4 py-2 text-center text-xs font-medium text-gray-500 uppercase tracking-wider whitespace-nowrap" style={{ width: '5rem' }}>Count</th>
                                        <th className="px-4 py-2 text-center text-xs font-medium text-gray-500 uppercase tracking-wider whitespace-nowrap" style={{ width: '5rem' }}>%</th>
                                      </tr>
                                    </thead>
                                    <tbody className="bg-white divide-y divide-gray-200">
                                      {statementCounts.map(({code, text, count}) => {
                                        const percent = totalCount > 0 ? ((count / totalCount) * 100) : 0;
                                        const displayStmtCode = code.replace(/^[rc]/i, '');
                                        
                                        return (
                                          <tr key={code}>
                                            <td className="px-2 py-2 text-sm font-mono text-gray-700 text-center" style={{ width: '2.5rem' }}>{displayStmtCode}</td>
                                            <td className="px-4 py-2 text-sm text-gray-900">{text}</td>
                                            <td className="px-4 py-2 text-sm text-gray-900 text-center" style={{ width: '5rem' }}>{count}</td>
                                            <td className="px-4 py-2 text-sm text-gray-900 text-center" style={{ width: '5rem' }}>{totalCount > 0 ? `${percent.toFixed(1)}%` : '-'}</td>
                                          </tr>
                                        );
                                      })}
                                      {/* Total row */}
                                      <tr className="bg-gray-50 font-semibold border-t-2 border-gray-300">
                                        <td className="px-2 py-2 text-sm text-gray-900" colSpan={2}>Total</td>
                                        <td className="px-4 py-2 text-sm text-gray-900 text-center" style={{ width: '5rem' }}>{totalCount}</td>
                                        <td className="px-4 py-2 text-sm text-gray-900 text-center" style={{ width: '5rem' }}>100%</td>
                                      </tr>
                                    </tbody>
                                  </table>
                                </div>
                              </div>
                            );
                          });
                        })()}

                        {/* Summary Table for numeric grids */}
                        {(variable as any).isSummaryTable && variable.statements && !variable.name.endsWith('_Summary Tables') && (
                          <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
                            <div className="overflow-x-auto">
                            <table className="min-w-full divide-y divide-gray-200">
                                <thead className="bg-gray-50">
                                  <tr>
                                    <th colSpan={2} className="px-4 py-2 text-left text-sm font-semibold text-gray-900">Summary Table</th>
                                    {!(variable as any).isScaleSummary && (
                                      <>
                                        <th className="px-4 py-2 text-center text-xs font-medium text-gray-500 uppercase tracking-wider whitespace-nowrap" style={{ width: '5rem' }}>Mean</th>
                                        {((variable as any).tags && Array.isArray((variable as any).tags) && (variable as any).tags.includes('Number')) && (
                                          <>
                                            <th className="px-4 py-2 text-center text-xs font-medium text-gray-500 uppercase tracking-wider whitespace-nowrap" style={{ width: '5rem' }}>Sum</th>
                                            <th className="px-4 py-2 text-center text-xs font-medium text-gray-500 uppercase tracking-wider whitespace-nowrap" style={{ width: '5rem' }}>%</th>
                                          </>
                                        )}
                                      </>
                                    )}
                                    {(variable as any).isScaleSummary && (
                                      <>
                                        <th className="px-4 py-2 text-center text-xs font-medium text-gray-500 uppercase tracking-wider whitespace-nowrap" style={{ width: '5rem' }}>Count</th>
                                        <th className="px-4 py-2 text-center text-xs font-medium text-gray-500 uppercase tracking-wider whitespace-nowrap" style={{ width: '5rem' }}>%</th>
                                      </>
                                    )}
                                  </tr>
                                </thead>
                              <tbody className="bg-white divide-y divide-gray-200">
                                  {(() => {
                                    // Check if this is a numeric grid column summary table
                                    // Pattern: {baseName}_c{number}_Summary or {baseName}_c{number} with isSummaryTable
                                    const columnMatch = variable.name.match(/^([A-Z0-9]+)_(c\d+)(?:_Summary)?$/i);
                                    const isNumericGridColumnSummary = columnMatch && variable.type?.toLowerCase().includes('numeric');
                                    
                                    // Calculate total sum for numeric summary tables BEFORE rendering rows
                                    const hasNumberTag = (variable as any).tags && Array.isArray((variable as any).tags) && (variable as any).tags.includes('Number');
                                    let totalSumForPercentage = 0;
                                    
                                    if ((variable as any).isSummaryTable && !(variable as any).isScaleSummary && hasNumberTag) {
                                      // For summary tables, extract base question number (remove "_Summary" suffix)
                                      const baseName = variable.name.endsWith('_Summary') 
                                        ? variable.name.replace('_Summary', '') 
                                        : variable.name;
                                      Object.keys(variable.statements || {}).forEach((stmtCode) => {
                                        const statementVarName = `${baseName}_${stmtCode}`;
                                        const statementData = variableData[statementVarName];
                                        if (statementData && statementData.sum !== undefined) {
                                          totalSumForPercentage += statementData.sum;
                                        }
                                      });
                                    }
                                    
                                    // For numeric grid column summary tables, show mean for each response option (row) in that column
                                    if (isNumericGridColumnSummary && !(variable as any).isScaleSummary) {
                                      const baseName = columnMatch![1];
                                      const columnCode = columnMatch![2]; // e.g., "c1"
                                      
                                      // DEBUG: Log summary table processing
                                      console.log(`[Summary Table Debug] Processing summary table: ${variable.name}, baseName: ${baseName}, columnCode: ${columnCode}`);
                                      
                                      // Get the column variable data (e.g., S14_c1)
                                      const columnVarName = `${baseName}_${columnCode}`;
                                      const columnData = variableData[columnVarName];
                                      
                                      // DEBUG: Check available variableData keys
                                      const matchingKeys = Object.keys(variableData).filter(key => 
                                        key.toLowerCase().includes(baseName.toLowerCase())
                                      );
                                      console.log(`[Summary Table Debug] Found ${matchingKeys.length} variableData keys matching baseName "${baseName}":`, matchingKeys.slice(0, 30));
                                      
                                      // Calculate total sum for percentage calculation
                                      // First, try to get it from column variable
                                      let totalSumForColumn = 0;
                                      if (columnData && columnData.sum !== undefined) {
                                        totalSumForColumn = columnData.sum;
                                      } else {
                                        // Calculate from individual row sums - try all cell variable patterns
                                        Object.keys(variable.statements || {}).forEach((stmtCode) => {
                                          let rowSum: number | undefined = undefined;
                                          
                                          // Try all cell variable name patterns (same as Strategy 2)
                                          const cellVarNames = [
                                            // Without Q prefix - row first format
                                            `${baseName}${stmtCode}${columnCode}`,    // S4r1c1 (row first, then column - preferred format)
                                            `${baseName}_${stmtCode}_${columnCode}`,  // S4_r1_c1
                                            `${baseName}${stmtCode}_${columnCode}`,   // S4r1_c1
                                            `${baseName}_${stmtCode}${columnCode}`,   // S4_r1c1
                                            // Without Q prefix - column first format (backward compatibility)
                                            `${baseName}${columnCode}${stmtCode}`,    // S4c1r1 (column first, then row - backward compatibility)
                                            `${baseName}_${columnCode}_${stmtCode}`,  // S4_c1_r1
                                            `${baseName}${columnCode}_${stmtCode}`,   // S4c1_r1
                                            `${baseName}_${columnCode}${stmtCode}`,   // S4_c1r1
                                            // With Q prefix - row first format
                                            `Q${baseName}${stmtCode}${columnCode}`,    // QS4r1c1
                                            `Q${baseName}_${stmtCode}_${columnCode}`,  // QS4_r1_c1
                                            `Q${baseName}${stmtCode}_${columnCode}`,   // QS4r1_c1
                                            `Q${baseName}_${stmtCode}${columnCode}`,   // QS4_r1c1
                                            // With Q prefix - column first format
                                            `Q${baseName}${columnCode}${stmtCode}`,    // QS4c1r1
                                            `Q${baseName}_${columnCode}_${stmtCode}`,  // QS4_c1_r1
                                            `Q${baseName}${columnCode}_${stmtCode}`,   // QS4c1_r1
                                            `Q${baseName}_${columnCode}${stmtCode}`,   // QS4_c1r1
                                          ];
                                          
                                          // First, try to get data from mapped column headers
                                          // Note: columnMapping uses expected headers as keys (e.g., "QS11r1c1"), not variable names
                                          for (const cellVarName of cellVarNames) {
                                            // Try variable name directly first (for backward compatibility)
                                            let mappedColumnHeader = columnMapping[cellVarName];
                                            
                                            // If not found, try generating expected header and checking that
                                            if (!mappedColumnHeader || mappedColumnHeader.trim() === '') {
                                              // Generate expected header: add Q prefix and normalize format
                                              const normalized = cellVarName.replace(/[_-]/g, ''); // Remove underscores/dashes
                                              const expectedHeader = normalized.startsWith('Q') ? normalized : `Q${normalized}`;
                                              mappedColumnHeader = columnMapping[expectedHeader];
                                              
                                              // Also try with Q prefix variations
                                              if (!mappedColumnHeader || mappedColumnHeader.trim() === '') {
                                                // Try with Q prefix added to base
                                                const baseMatch = normalized.match(/^([A-Z0-9]+)(r\d+)(c\d+)$/i);
                                                if (baseMatch) {
                                                  const [, base, row, col] = baseMatch;
                                                  const altExpectedHeader = `Q${base}${row}${col}`;
                                                  mappedColumnHeader = columnMapping[altExpectedHeader];
                                                }
                                              }
                                            }
                                            
                                            if (mappedColumnHeader && mappedColumnHeader.trim() !== '') {
                                              const cellData = variableData[mappedColumnHeader];
                                              if (cellData && cellData.sum !== undefined) {
                                                rowSum = cellData.sum;
                                                break;
                                              } else if (cellData && cellData.values && Array.isArray(cellData.values) && cellData.values.length > 0) {
                                                // Calculate sum from values if sum is not directly available
                                                const numericValues = cellData.values
                                                  .map((v: any) => parseFloat(v))
                                                  .filter((v: number) => !isNaN(v));
                                                if (numericValues.length > 0) {
                                                  rowSum = numericValues.reduce((sum: number, val: number) => sum + val, 0);
                                                  break;
                                                }
                                              }
                                            }
                                          }
                                          
                                          // Fallback: try variable names directly if mapped column headers didn't work
                                          if (rowSum === undefined) {
                                            for (const cellVarName of cellVarNames) {
                                              const cellData = variableData[cellVarName];
                                              if (cellData && cellData.sum !== undefined) {
                                                rowSum = cellData.sum;
                                                break;
                                              } else if (cellData && cellData.values && Array.isArray(cellData.values) && cellData.values.length > 0) {
                                                // Calculate sum from values if sum is not directly available
                                                const numericValues = cellData.values
                                                  .map((v: any) => parseFloat(v))
                                                  .filter((v: number) => !isNaN(v));
                                                if (numericValues.length > 0) {
                                                  rowSum = numericValues.reduce((sum: number, val: number) => sum + val, 0);
                                                  break;
                                                }
                                              }
                                            }
                                          }
                                          
                                          // If cell variable not found, try statement variable with frequencies
                                          if (rowSum === undefined) {
                                            const statementVarName = `${baseName}_${stmtCode}`;
                                            const statementData = variableData[statementVarName];
                                            if (statementData) {
                                              if (statementData.frequencies && statementData.frequencies[columnCode] !== undefined) {
                                                rowSum = statementData.frequencies[columnCode];
                                              } else if (statementData.frequencies) {
                                                const colCodeWithoutPrefix = columnCode.replace(/^c/i, '');
                                                if (statementData.frequencies[colCodeWithoutPrefix] !== undefined) {
                                                  rowSum = statementData.frequencies[colCodeWithoutPrefix];
                                                }
                                              } else if (statementData.sum !== undefined) {
                                                // Use statement sum as fallback (might be across all columns though)
                                                // Only use this if we can't find column-specific data
                                                // For multi-column grids, this would be wrong, so we skip it
                                              }
                                            }
                                          }
                                          
                                          if (rowSum !== undefined) {
                                            totalSumForColumn += rowSum;
                                          }
                                        });
                                      }
                                      
                                      const hasPercentTag = (variable as any).tags && Array.isArray((variable as any).tags) && (variable as any).tags.includes('%');
                                      const hasNumberTag = (variable as any).tags && Array.isArray((variable as any).tags) && (variable as any).tags.includes('Number');
                                      
                                      // First pass: collect all row data and calculate total sum
                                      const rowDataArray: Array<{code: string; text: string; mean: number | undefined; sum: number | undefined; mappedColumnHeader: string | undefined}> = [];
                                      let totalSum = 0;
                                      let sumOfMeans = 0;
                                      
                                      Object.entries(variable.statements || {}).forEach(([stmtCode, stmtText]) => {
                                        const displayCode = stmtCode.replace(/^[rc]/i, '');
                                        
                                        // DEBUG: Log which row we're processing
                                        console.log(`[Summary Table Debug] Processing row: stmtCode=${stmtCode}, stmtText=${stmtText}`);
                                        
                                        // Try multiple strategies to get the mean for this row in this column
                                        // (Same strategies as used in the statement table for column variables)
                                        let mean: number | undefined = undefined;
                                        let sum: number | undefined = undefined;
                                        let mappedColumnHeader: string | undefined = undefined;
                                        
                                        // Build all possible cell variable name patterns first
                                        const cellVarNames = [
                                          // Without Q prefix
                                          `${baseName}${stmtCode}${columnCode}`,    // S11r1c1 (row first, then column - preferred format)
                                          `${baseName}_${stmtCode}_${columnCode}`,  // S11_r1_c1
                                          `${baseName}${stmtCode}_${columnCode}`,   // S11r1_c1
                                          `${baseName}_${stmtCode}${columnCode}`,   // S11_r1c1
                                          `${baseName}${columnCode}${stmtCode}`,    // S11c1r5 (column first, then row - backward compatibility)
                                          `${baseName}_${columnCode}_${stmtCode}`,  // S11_c1_r5
                                          `${baseName}${columnCode}_${stmtCode}`,   // S11c1_r5
                                          `${baseName}_${columnCode}${stmtCode}`,   // S11_c1r5
                                          // With Q prefix
                                          `Q${baseName}${stmtCode}${columnCode}`,    // QS11r1c1
                                          `Q${baseName}_${stmtCode}_${columnCode}`,  // QS11_r1_c1
                                          `Q${baseName}${stmtCode}_${columnCode}`,   // QS11r1_c1
                                          `Q${baseName}_${stmtCode}${columnCode}`,   // QS11_r1c1
                                          `Q${baseName}${columnCode}${stmtCode}`,    // QS11c1r5
                                          `Q${baseName}_${columnCode}_${stmtCode}`,  // QS11_c1_r5
                                          `Q${baseName}${columnCode}_${stmtCode}`,   // QS11c1_r5
                                          `Q${baseName}_${columnCode}${stmtCode}`,   // QS11_c1r5
                                        ];
                                        
                                        // DEBUG: Log what we're trying
                                        console.log(`[Summary Table Debug] Trying ${cellVarNames.length} cell variable names for row ${stmtCode}:`, cellVarNames);
                                        
                                        // First, find the mapped column header for this cell variable
                                        // columnMapping uses expected headers as keys (e.g., "QS4r1c1"), and values are the actual column headers from the data file
                                        let foundExpectedHeader: string | undefined = undefined;
                                        for (const cellVarName of cellVarNames) {
                                          // Generate expected header: normalize format and add Q prefix if needed
                                          const normalized = cellVarName.replace(/[_-]/g, ''); // Remove underscores/dashes
                                          const expectedHeader = normalized.startsWith('Q') ? normalized : `Q${normalized}`;
                                          
                                          // Check if this expected header has a mapping
                                          const mappedHeader = columnMapping[expectedHeader];
                                          if (mappedHeader && mappedHeader.trim() !== '') {
                                            mappedColumnHeader = mappedHeader;
                                            foundExpectedHeader = expectedHeader;
                                            console.log(`[Summary Table Debug] Found mapping: expectedHeader="${expectedHeader}" -> mappedColumnHeader="${mappedColumnHeader}"`);
                                            break; // Found the mapping, use this one
                                          }
                                        }
                                        
                                        // If we found a mapping, try both the expected header and mapped header to get the data
                                        // Data might be stored under either the expected header key or the mapped header value
                                        if (foundExpectedHeader && mappedColumnHeader) {
                                          // Try expected header first (data is often stored under the mapping key)
                                          let cellData = variableData[foundExpectedHeader];
                                          if (cellData) {
                                            console.log(`[Summary Table Debug] ✅ Found data using expectedHeader="${foundExpectedHeader}"`);
                                          } else {
                                            // Try mapped header (data might be stored under the actual column header)
                                            cellData = variableData[mappedColumnHeader];
                                            if (cellData) {
                                              console.log(`[Summary Table Debug] ✅ Found data using mappedColumnHeader="${mappedColumnHeader}"`);
                                            }
                                          }
                                          
                                          if (cellData) {
                                            if (mean === undefined && cellData.mean !== undefined) {
                                              mean = cellData.mean;
                                            }
                                            if (sum === undefined && cellData.sum !== undefined) {
                                              sum = cellData.sum;
                                            }
                                            if (mean === undefined && cellData.values && Array.isArray(cellData.values) && cellData.values.length > 0) {
                                              const numericValues = cellData.values
                                                .map((v: any) => parseFloat(v))
                                                .filter((v: number) => !isNaN(v));
                                              if (numericValues.length > 0) {
                                                mean = numericValues.reduce((sum: number, val: number) => sum + val, 0) / numericValues.length;
                                              }
                                            }
                                            if (sum === undefined && cellData.values && Array.isArray(cellData.values) && cellData.values.length > 0) {
                                              const numericValues = cellData.values
                                                .map((v: any) => parseFloat(v))
                                                .filter((v: number) => !isNaN(v));
                                              if (numericValues.length > 0) {
                                                sum = numericValues.reduce((sum: number, val: number) => sum + val, 0);
                                              }
                                            }
                                          }
                                        }
                                        
                                        // Strategy 1: Check if statement variable exists (S14_r1) and has frequencies with column code
                                        const statementVarName = `${baseName}_${stmtCode}`;
                                        const statementVarData = variableData[statementVarName];
                                        
                                        if (statementVarData && statementVarData.frequencies) {
                                          // Try to find the column code in frequencies
                                          if (statementVarData.frequencies[columnCode] !== undefined) {
                                            // This is a frequency count - use it as the value (could be sum or mean depending on data structure)
                                            mean = statementVarData.frequencies[columnCode];
                                            // Also try to get sum from statement variable
                                            if (sum === undefined && statementVarData.sum !== undefined) {
                                              sum = statementVarData.sum;
                                            }
                                          } else {
                                            // Try without "c" prefix (c1 -> 1)
                                            const colCodeWithoutPrefix = columnCode.replace(/^c/i, '');
                                            if (statementVarData.frequencies[colCodeWithoutPrefix] !== undefined) {
                                              mean = statementVarData.frequencies[colCodeWithoutPrefix];
                                              // Also try to get sum from statement variable
                                              if (sum === undefined && statementVarData.sum !== undefined) {
                                                sum = statementVarData.sum;
                                              }
                                            }
                                          }
                                        }
                                        
                                        // Also try to get sum from statement variable if we haven't gotten it yet
                                        if (sum === undefined && statementVarData && statementVarData.sum !== undefined) {
                                          sum = statementVarData.sum;
                                        }
                                        
                                        // Strategy 2: Try cell variable formats
                                        // Format: {base}{row}{column} e.g., S11r1c1 (row first, then column - preferred format)
                                        // Also try: {base}{column}{row} for backward compatibility
                                        // IMPORTANT: First check if there's a mapped column header for this cell variable
                                        if (mean === undefined || sum === undefined) {
                                          // First, try to get data from mapped column headers
                                          for (const cellVarName of cellVarNames) {
                                            // Try variable name directly first (for backward compatibility)
                                            let mappedHeader = columnMapping[cellVarName];
                                            let currentExpectedHeader: string | undefined = undefined;
                                            
                                            // If not found, try generating expected header and checking that
                                            if (!mappedHeader || mappedHeader.trim() === '') {
                                              // Generate expected header: add Q prefix and normalize format
                                              const normalized = cellVarName.replace(/[_-]/g, ''); // Remove underscores/dashes
                                              const expectedHeader = normalized.startsWith('Q') ? normalized : `Q${normalized}`;
                                              mappedHeader = columnMapping[expectedHeader];
                                              
                                              if (mappedHeader && mappedHeader.trim() !== '') {
                                                currentExpectedHeader = expectedHeader;
                                              } else {
                                                // Also try with Q prefix variations
                                                // Try with Q prefix added to base
                                                const baseMatch = normalized.match(/^([A-Z0-9]+)(r\d+)(c\d+)$/i);
                                                if (baseMatch) {
                                                  const [, base, row, col] = baseMatch;
                                                  const altExpectedHeader = `Q${base}${row}${col}`;
                                                  mappedHeader = columnMapping[altExpectedHeader];
                                                  if (mappedHeader && mappedHeader.trim() !== '') {
                                                    currentExpectedHeader = altExpectedHeader;
                                                  }
                                                }
                                              }
                                            } else {
                                              currentExpectedHeader = cellVarName;
                                            }
                                            
                                            // Even if there's no mappedHeader, try to generate expected header and check variableData directly
                                            if (!currentExpectedHeader) {
                                              const normalized = cellVarName.replace(/[_-]/g, '');
                                              currentExpectedHeader = normalized.startsWith('Q') ? normalized : `Q${normalized}`;
                                            }
                                            
                                            // Try checking variableData directly with expected header format (even without mapping)
                                            if (currentExpectedHeader && !mean && !sum) {
                                              const directData = variableData[currentExpectedHeader];
                                              if (directData) {
                                                console.log(`[Summary Table Debug] ✅ Found data directly for expectedHeader="${currentExpectedHeader}" (no mapping needed)`);
                                                if (mean === undefined && directData.mean !== undefined) {
                                                  mean = directData.mean;
                                                }
                                                if (sum === undefined && directData.sum !== undefined) {
                                                  sum = directData.sum;
                                                }
                                                if ((mean !== undefined || sum !== undefined) && !mappedColumnHeader) {
                                                  mappedColumnHeader = currentExpectedHeader;
                                                }
                                              }
                                            }
                                            
                                            if (mappedHeader && mappedHeader.trim() !== '') {
                                              // Track which mapped column header we're using (if not already set)
                                              if (!mappedColumnHeader) {
                                                mappedColumnHeader = mappedHeader;
                                              }
                                              
                                              // The backend stores data under the variable name, not the column header
                                              // When we upload, we convert expected headers to variable names
                                              // So we need to use the variable name (cellVarName) to look up the data
                                              // The mappedHeader tells us which column was used, but data is stored under variable name
                                              let dataKey: string | undefined = undefined;
                                              
                                              // Try multiple keys in order of preference:
                                              // 1. Cell variable name directly (e.g., "S11r1c1") - this is what backend uses
                                              if (variableData[cellVarName]) {
                                                console.log(`[Summary Table Debug] ✅ Found data for cellVarName="${cellVarName}"`);
                                                dataKey = cellVarName;
                                              }
                                              
                                              // 2. Expected header without Q prefix (variable name format)
                                              if (!dataKey && currentExpectedHeader) {
                                                const varNameFromExpected = currentExpectedHeader.startsWith('Q') ? currentExpectedHeader.substring(1) : currentExpectedHeader;
                                                if (variableData[varNameFromExpected]) {
                                                  dataKey = varNameFromExpected;
                                                }
                                              }
                                              
                                              // 3. Expected header itself
                                              if (!dataKey && currentExpectedHeader && variableData[currentExpectedHeader]) {
                                                dataKey = currentExpectedHeader;
                                              }
                                              
                                              // 4. Mapped header (column header) as fallback
                                              if (!dataKey && variableData[mappedHeader]) {
                                                dataKey = mappedHeader;
                                              }
                                              
                                              // 5. Try the expected header format directly in variableData (even if not in columnMapping)
                                              if (!dataKey && currentExpectedHeader && variableData[currentExpectedHeader]) {
                                                console.log(`[Summary Table Debug] ✅ Found data for expectedHeader="${currentExpectedHeader}" (not in columnMapping)`);
                                                dataKey = currentExpectedHeader;
                                              }
                                              
                                              const cellData = dataKey ? variableData[dataKey] : undefined;
                                              if (cellData) {
                                                // Get mean if not already set
                                                if (mean === undefined) {
                                                  if (cellData.mean !== undefined) {
                                                    mean = cellData.mean;
                                                  } else if (cellData.sum !== undefined && cellData.count !== undefined && cellData.count > 0) {
                                                    mean = cellData.sum / cellData.count;
                                                  } else if (cellData.values && Array.isArray(cellData.values) && cellData.values.length > 0) {
                                                    const numericValues = cellData.values
                                                      .map((v: any) => parseFloat(v))
                                                      .filter((v: number) => !isNaN(v));
                                                    if (numericValues.length > 0) {
                                                      mean = numericValues.reduce((sum: number, val: number) => sum + val, 0) / numericValues.length;
                                                    }
                                                  }
                                                }
                                                
                                                // Get sum if not already set
                                                if (sum === undefined && cellData.sum !== undefined) {
                                                  sum = cellData.sum;
                                                } else if (sum === undefined && cellData.values && Array.isArray(cellData.values) && cellData.values.length > 0) {
                                                  // Calculate sum from values if sum is not directly available
                                                  const numericValues = cellData.values
                                                    .map((v: any) => parseFloat(v))
                                                    .filter((v: number) => !isNaN(v));
                                                  if (numericValues.length > 0) {
                                                    sum = numericValues.reduce((sum: number, val: number) => sum + val, 0);
                                                  }
                                                }
                                                
                                                // If we have both mean and sum, we can break
                                                if (mean !== undefined && sum !== undefined) {
                                                  break;
                                                }
                                              }
                                            }
                                          }
                                          
                                          // Fallback: try variable names directly if mapped column headers didn't work
                                          for (const cellVarName of cellVarNames) {
                                            const cellData = variableData[cellVarName];
                                            if (cellData) {
                                              console.log(`[Summary Table Debug] ✅ Found data in fallback for cellVarName="${cellVarName}"`);
                                              // Get mean if not already set
                                              if (mean === undefined) {
                                                if (cellData.mean !== undefined) {
                                                  mean = cellData.mean;
                                                } else if (cellData.sum !== undefined && cellData.count !== undefined && cellData.count > 0) {
                                                  mean = cellData.sum / cellData.count;
                                                } else if (cellData.values && Array.isArray(cellData.values) && cellData.values.length > 0) {
                                                  const numericValues = cellData.values
                                                    .map((v: any) => parseFloat(v))
                                                    .filter((v: number) => !isNaN(v));
                                                  if (numericValues.length > 0) {
                                                    mean = numericValues.reduce((sum: number, val: number) => sum + val, 0) / numericValues.length;
                                                  }
                                                }
                                              }
                                              
                                              // Get sum if not already set
                                              if (sum === undefined && cellData.sum !== undefined) {
                                                sum = cellData.sum;
                                              } else if (sum === undefined && cellData.values && Array.isArray(cellData.values) && cellData.values.length > 0) {
                                                // Calculate sum from values if sum is not directly available
                                                const numericValues = cellData.values
                                                  .map((v: any) => parseFloat(v))
                                                  .filter((v: number) => !isNaN(v));
                                                if (numericValues.length > 0) {
                                                  sum = numericValues.reduce((sum: number, val: number) => sum + val, 0);
                                                }
                                              }
                                              
                                              // If we have both mean and sum, we can break
                                              if (mean !== undefined && sum !== undefined) {
                                                break;
                                              }
                                            }
                                          }
                                        }
                                        
                                        // Strategy 3: Check if column variable exists (S14_c1) with statement codes as keys
                                        if (mean === undefined && columnData) {
                                          if (columnData.frequencies) {
                                            if (columnData.frequencies[stmtCode] !== undefined) {
                                              mean = columnData.frequencies[stmtCode];
                                            } else {
                                              const codeWithoutPrefix = stmtCode.replace(/^[rc]/i, '');
                                              if (columnData.frequencies[codeWithoutPrefix] !== undefined) {
                                                mean = columnData.frequencies[codeWithoutPrefix];
                                              }
                                            }
                                          }
                                          // If column variable has mean, that's the overall mean for the column, not per-row
                                          // But we can use it as a fallback if we can't find row-specific data
                                          if (mean === undefined && columnData.mean !== undefined) {
                                            // This is the overall column mean, not row-specific, but use as last resort
                                            mean = columnData.mean;
                                          }
                                          if (sum === undefined && columnData.sum !== undefined) {
                                            // This is the total sum for the column
                                            // We can't easily split it per row, but we'll use it for percentage calculation
                                          }
                                        }
                                        
                                        // Strategy 4: Check column variable's values array
                                        // If column variable has values, we can calculate mean from it
                                        // Note: This assumes the values array contains all values for this column
                                        if (mean === undefined && columnData && columnData.values && Array.isArray(columnData.values) && columnData.values.length > 0) {
                                          const numericValues = columnData.values
                                            .map((v: any) => parseFloat(v))
                                            .filter((v: number) => !isNaN(v));
                                          if (numericValues.length > 0) {
                                            // This gives us the overall mean for the column
                                            // We can't easily split it per row, but we'll use it as a fallback
                                            mean = numericValues.reduce((sum: number, val: number) => sum + val, 0) / numericValues.length;
                                          }
                                        }
                                        
                                        // Strategy 5: Use statement variable's mean/sum as fallback (but this might be across all columns)
                                        if (mean === undefined && statementVarData) {
                                          if (statementVarData.mean !== undefined) {
                                            mean = statementVarData.mean;
                                          }
                                          if (statementVarData.sum !== undefined) {
                                            sum = statementVarData.sum;
                                          }
                                        }
                                        
                                        // Calculate sum if we have mean but not sum (for percentage calculation)
                                        if (mean !== undefined && sum === undefined) {
                                          // Try to get sum from cell data - try multiple formats
                                          const cellVarNamesToTry = [
                                            `${baseName}_${stmtCode}_${columnCode}`,  // S4_r1_c1
                                            `${baseName}${stmtCode}${columnCode}`,    // S4r1c1
                                            `Q${baseName}_${stmtCode}_${columnCode}`, // QS4_r1_c1
                                            `Q${baseName}${stmtCode}${columnCode}`,   // QS4r1c1
                                          ];
                                          
                                          for (const cellVarName of cellVarNamesToTry) {
                                            const cellData = variableData[cellVarName];
                                            if (cellData && cellData.sum !== undefined) {
                                              sum = cellData.sum;
                                              break;
                                            }
                                          }
                                          
                                          if (sum === undefined && statementVarData && statementVarData.sum !== undefined) {
                                            sum = statementVarData.sum;
                                          } else if (sum === undefined && columnData && columnData.sum !== undefined) {
                                            // Column sum divided by number of statements (rough estimate)
                                            const stmtCount = Object.keys(variable.statements || {}).length;
                                            if (stmtCount > 0) {
                                              sum = columnData.sum / stmtCount;
                                            }
                                          }
                                        }
                                        
                                        // Accumulate totals
                                        if (sum !== undefined) {
                                          totalSum += sum;
                                        }
                                        if (mean !== undefined) {
                                          sumOfMeans += mean;
                                        }
                                        
                                        // Store row data for second pass
                                        // DEBUG: Log final result for this row
                                        if (mean !== undefined || sum !== undefined) {
                                          console.log(`[Summary Table Debug] ✅ Final values for row ${stmtCode}: mean=${mean}, sum=${sum}, mappedColumnHeader=${mappedColumnHeader}`);
                                        } else {
                                          console.log(`[Summary Table Debug] ❌ No data found for row ${stmtCode} after all strategies`);
                                        }
                                        
                                        rowDataArray.push({ code: stmtCode, text: stmtText, mean, sum, mappedColumnHeader });
                                      });
                                      
                                      // Second pass: render rows with percentages calculated using total sum
                                      const rows = rowDataArray.map(({ code: stmtCode, text: stmtText, mean, sum, mappedColumnHeader }) => {
                                        const displayCode = stmtCode.replace(/^[rc]/i, '');
                                        
                                        // Calculate percentage: (row sum / total sum of all rows) * 100
                                        const rowPercentage = totalSum > 0 && sum !== undefined 
                                          ? (sum / totalSum) * 100 
                                          : undefined;
                                        
                                        return (
                                          <tr key={stmtCode}>
                                            <td className="px-2 py-2 text-sm font-mono text-gray-700 text-center" style={{ width: '2.5rem' }}>{displayCode}</td>
                                            <td className="px-4 py-2 text-sm text-gray-900">
                                              {stmtText}
                                              {mappedColumnHeader ? (
                                                <span className="text-gray-500 text-xs ml-1">({mappedColumnHeader})</span>
                                              ) : (
                                                <span className="text-gray-400 text-xs ml-1 italic">(no mapping)</span>
                                              )}
                                            </td>
                                            <td className="px-4 py-2 text-sm text-gray-900 text-center" style={{ width: '5rem' }}>
                                              {mean !== undefined 
                                                ? (hasPercentTag ? `${mean.toFixed(1)}%` : mean.toFixed(2))
                                                : (hasPercentTag ? '-%' : '-')}
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
                                      
                                      // Add total row
                                      const totalPercentage = totalSum > 0 ? 100 : undefined;
                                      
                                      return (
                                        <>
                                          {rows}
                                          <tr className="bg-gray-50 font-semibold border-t-2 border-gray-300">
                                            <td className="px-2 py-2 text-sm text-gray-900" colSpan={2}>Total</td>
                                            <td className="px-4 py-2 text-sm text-gray-900 text-center" style={{ width: '5rem' }}>
                                              {sumOfMeans > 0
                                                ? (hasPercentTag ? `${sumOfMeans.toFixed(1)}%` : sumOfMeans.toFixed(2))
                                                : (hasPercentTag ? '-%' : '-')}
                                            </td>
                                            {hasNumberTag && (
                                              <>
                                                <td className="px-4 py-2 text-sm text-gray-900 text-center" style={{ width: '5rem' }}>
                                                  {totalSum > 0 ? totalSum.toFixed(0) : '-'}
                                                </td>
                                                <td className="px-4 py-2 text-sm text-gray-900 text-center" style={{ width: '5rem' }}>
                                                  {totalPercentage !== undefined ? `${totalPercentage.toFixed(1)}%` : '-'}
                                                </td>
                                              </>
                                            )}
                                          </tr>
                                        </>
                                      );
                                    }
                                    
                                    // For non-column summary tables, show one row per statement (original behavior)
                                    return Object.entries(variable.statements || {}).map(([code, text]) => {
                                  const displayCode = code.replace(/^[rc]/i, '');
                                  const hasNumberTag = (variable as any).tags && Array.isArray((variable as any).tags) && (variable as any).tags.includes('Number');
                                  const hasPercentTag = (variable as any).tags && Array.isArray((variable as any).tags) && (variable as any).tags.includes('%');
                                      
                                  return (
                                    <tr key={code}>
                                          <td className="px-2 py-2 text-sm font-mono text-gray-700 text-center" style={{ width: '2.5rem' }}>{displayCode}</td>
                                      <td className="px-4 py-2 text-sm text-gray-900">{text}</td>
                                          {(variable as any).isSummaryTable && !(variable as any).isScaleSummary && (() => {
                                            // For summary tables, extract base question number (remove "_Summary" suffix)
                                            const baseName = variable.name.endsWith('_Summary') 
                                              ? variable.name.replace('_Summary', '') 
                                              : variable.name;
                                            const statementVarName = `${baseName}_${code}`;
                                            const statementData = variableData[statementVarName];
                                            
                                            if (!statementData) {
                                              return (
                                                <>
                                                  <td className="px-4 py-2 text-sm text-gray-900 text-center">-</td>
                                                  {hasNumberTag && (
                                                    <>
                                                      <td className="px-4 py-2 text-sm text-gray-900 text-center">-</td>
                                                      <td className="px-4 py-2 text-sm text-gray-900 text-center">-</td>
                                                    </>
                                                  )}
                                                </>
                                              );
                                            }
                                            
                                            const mean = statementData.mean;
                                            const sum = statementData.sum;
                                            
                                            // Calculate percentage: (row sum / total sum of all rows) * 100
                                            const rowPercentage = totalSumForPercentage > 0 && sum !== undefined 
                                              ? (sum / totalSumForPercentage) * 100 
                                              : undefined;
                                            
                                            return (
                                              <>
                                                <td className="px-4 py-2 text-sm text-gray-900 text-center" style={{ width: '5rem' }}>
                                                  {mean !== undefined 
                                                    ? (hasPercentTag ? `${mean.toFixed(1)}%` : mean.toFixed(2))
                                                    : (hasPercentTag ? '-%' : '-')}
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
                                              </>
                                            );
                                          })()}
                                      {(variable as any).isScaleSummary && (() => {
                                        // Scale summary tables (T2B, M3B, B2B) need to calculate from individual statement variables
                                        const baseMatch = variable.name.match(/^([A-Z0-9]+)_(T2B|M3B|B2B)$/i);
                                        if (!baseMatch) {
                                          return (
                                            <>
                                              <td className="px-4 py-2 text-sm text-gray-900 text-center" style={{ width: '5rem' }}>-</td>
                                              <td className="px-4 py-2 text-sm text-gray-900 text-center" style={{ width: '5rem' }}>-</td>
                                            </>
                                          );
                                        }
                                        
                                        const baseVar = baseMatch[1];
                                        const netType = baseMatch[2].toUpperCase();
                                        
                                        // Find the individual statement variable (e.g., "S4_r1")
                                        const statementVarName = `${baseVar}_${code}`;
                                        const statementData = variableData[statementVarName];
                                        
                                        if (!statementData || !statementData.frequencies) {
                                          return (
                                            <>
                                              <td className="px-4 py-2 text-sm text-gray-900 text-center" style={{ width: '5rem' }}>-</td>
                                              <td className="px-4 py-2 text-sm text-gray-900 text-center" style={{ width: '5rem' }}>-</td>
                                            </>
                                          );
                                        }
                                        
                                        // Find the parent grid question to get response options
                                            const parentQuestion = questionnaireQuestions.find(q => 
                                          (q.number === baseVar || q.id === baseVar) && 
                                          q.type?.toLowerCase().includes('single select') &&
                                          q.type?.toLowerCase().includes('grid')
                                        );
                                        
                                        if (!parentQuestion || !parentQuestion.responseOptions) {
                                          return (
                                            <>
                                              <td className="px-4 py-2 text-sm text-gray-900 text-center" style={{ width: '5rem' }}>-</td>
                                              <td className="px-4 py-2 text-sm text-gray-900 text-center" style={{ width: '5rem' }}>-</td>
                                            </>
                                          );
                                        }
                                        
                                        // Determine which response codes to include based on net type
                                        const responseOptions = parentQuestion.responseOptions;
                                        let codesToInclude: string[] = [];
                                        
                                        if (netType === 'T2B') {
                                          codesToInclude = responseOptions.slice(-2).map((opt: any) => {
                                            if (typeof opt === 'string') return opt;
                                            return opt.code || String(responseOptions.indexOf(opt) + 1);
                                          });
                                        } else if (netType === 'B2B') {
                                          codesToInclude = responseOptions.slice(0, 2).map((opt: any) => {
                                            if (typeof opt === 'string') return opt;
                                            return opt.code || String(responseOptions.indexOf(opt) + 1);
                                          });
                                            } else if (netType === 'M3B' && responseOptions.length === 7) {
                                          codesToInclude = responseOptions.slice(2, 5).map((opt: any) => {
                                            if (typeof opt === 'string') return opt;
                                            return opt.code || String(responseOptions.indexOf(opt) + 1);
                                          });
                                        }
                                        
                                        // Calculate count by summing frequencies for the included codes
                                        let count = 0;
                                        const frequencies = statementData.frequencies;
                                        codesToInclude.forEach(codeToMatch => {
                                          let codeCount = frequencies[codeToMatch] ?? 0;
                                          if (codeCount === 0 || frequencies[codeToMatch] === undefined) {
                                            const codeWithPrefix = codeToMatch.startsWith('c') ? codeToMatch : `c${codeToMatch}`;
                                            codeCount += frequencies[codeWithPrefix] ?? 0;
                                            if (codeCount === 0 || frequencies[codeWithPrefix] === undefined) {
                                              const codeWithoutPrefix = codeToMatch.replace(/^[rc]/i, '');
                                              codeCount += frequencies[codeWithoutPrefix] ?? 0;
                                            }
                                          }
                                          const numericIndex = responseOptions.findIndex((opt: any) => {
                                            if (typeof opt === 'string') return opt === codeToMatch;
                                            return (opt.code || String(responseOptions.indexOf(opt) + 1)) === codeToMatch;
                                          });
                                          if (numericIndex >= 0 && codeCount === 0) {
                                            codeCount += frequencies[String(numericIndex + 1)] ?? 0;
                                            codeCount += frequencies[`c${numericIndex + 1}`] ?? 0;
                                          }
                                          count += codeCount;
                                        });
                                        
                                        const totalCount = statementData.count ?? 0;
                                        const percent = totalCount > 0 ? ((count / totalCount) * 100) : 0;
                                        
                                        return (
                                          <>
                                            <td className="px-4 py-2 text-sm text-gray-900 text-center" style={{ width: '5rem' }}>
                                              {totalCount > 0 ? count : '-'}
                                            </td>
                                            <td className="px-4 py-2 text-sm text-gray-900 text-center" style={{ width: '5rem' }}>
                                              {totalCount > 0 ? `${percent.toFixed(1)}%` : '-'}
                                            </td>
                                          </>
                                        );
                                      })()}
                                    </tr>
                                  );
                                    });
                                  })()}
                                {/* Total row for scale summary tables */}
                                {(variable as any).isScaleSummary && (() => {
                                    const baseMatch = variable.name.match(/^([A-Z0-9]+)_(T2B|M3B|B2B)$/i);
                                    if (!baseMatch) return null;
                                    
                                    const baseVar = baseMatch[1];
                                    const netType = baseMatch[2].toUpperCase();
                                    
                                  let totalCount = 0;
                                  let totalNetCount = 0;
                                  
                                  Object.keys(variable.statements || {}).forEach((stmtCode) => {
                                      const statementVarName = `${baseVar}_${stmtCode}`;
                                      const statementData = variableData[statementVarName];
                                      
                                      if (statementData) {
                                        const stmtTotalCount = statementData.count ?? 0;
                                        totalCount += stmtTotalCount;
                                        
                                        const parentQuestion = questionnaireQuestions.find(q => 
                                          (q.number === baseVar || q.id === baseVar) && 
                                          q.type?.toLowerCase().includes('single select') &&
                                          q.type?.toLowerCase().includes('grid')
                                        );
                                        
                                        if (parentQuestion && parentQuestion.responseOptions) {
                                          const responseOptions = parentQuestion.responseOptions;
                                          let codesToInclude: string[] = [];
                                          
                                          if (netType === 'T2B') {
                                            codesToInclude = responseOptions.slice(-2).map((opt: any) => {
                                              if (typeof opt === 'string') return opt;
                                              return opt.code || String(responseOptions.indexOf(opt) + 1);
                                            });
                                          } else if (netType === 'B2B') {
                                            codesToInclude = responseOptions.slice(0, 2).map((opt: any) => {
                                              if (typeof opt === 'string') return opt;
                                              return opt.code || String(responseOptions.indexOf(opt) + 1);
                                            });
                                          } else if (netType === 'M3B' && responseOptions.length === 7) {
                                            codesToInclude = responseOptions.slice(2, 5).map((opt: any) => {
                                              if (typeof opt === 'string') return opt;
                                              return opt.code || String(responseOptions.indexOf(opt) + 1);
                                            });
                                          }
                                          
                                          const frequencies = statementData.frequencies || {};
                                          codesToInclude.forEach(codeToMatch => {
                                            let codeCount = frequencies[codeToMatch] ?? 0;
                                            if (codeCount === 0 || frequencies[codeToMatch] === undefined) {
                                              const codeWithPrefix = codeToMatch.startsWith('c') ? codeToMatch : `c${codeToMatch}`;
                                              codeCount += frequencies[codeWithPrefix] ?? 0;
                                              if (codeCount === 0 || frequencies[codeWithPrefix] === undefined) {
                                                const codeWithoutPrefix = codeToMatch.replace(/^[rc]/i, '');
                                                codeCount += frequencies[codeWithoutPrefix] ?? 0;
                                              }
                                            }
                                            totalNetCount += codeCount;
                                          });
                                      }
                                    }
                                  });
                                  
                                  const totalPercent = totalCount > 0 ? ((totalNetCount / totalCount) * 100) : 0;
                                  
                                  return (
                                    <tr className="bg-gray-50 font-semibold border-t-2 border-gray-300">
                                      <td className="px-2 py-2 text-sm text-gray-900" colSpan={2}>Total</td>
                                      <td className="px-4 py-2 text-sm text-gray-900 text-center" style={{ width: '5rem' }}>
                                        {totalCount > 0 ? totalNetCount : '-'}
                                      </td>
                                      <td className="px-4 py-2 text-sm text-gray-900 text-center" style={{ width: '5rem' }}>
                                        {totalCount > 0 ? `${totalPercent.toFixed(1)}%` : '-'}
                                      </td>
                                    </tr>
                                  );
                                })()}
                                {/* Total row for numeric summary tables with Number or % tag */}
                                {/* Exclude column summary tables (e.g., S4_c1_Summary) as they have their own total row */}
                                {(variable as any).isSummaryTable && !(variable as any).isScaleSummary &&
                                 (variable as any).tags && 
                                 Array.isArray((variable as any).tags) && 
                                 ((variable as any).tags.includes('Number') || (variable as any).tags.includes('%')) &&
                                 !(variable.name.match(/^([A-Z0-9]+)_(c\d+)(?:_Summary)?$/i) && variable.type?.toLowerCase().includes('numeric')) && (() => {
                                  const hasPercentTag = (variable as any).tags && Array.isArray((variable as any).tags) && (variable as any).tags.includes('%');
                                  const hasNumberTag = (variable as any).tags && Array.isArray((variable as any).tags) && (variable as any).tags.includes('Number');
                                  
                                  // For summary tables, extract base question number (remove "_Summary" suffix)
                                  let baseName = variable.name;
                                  if (variable.name.endsWith('_Summary')) {
                                    baseName = variable.name.replace('_Summary', '');
                                  }
                                  
                                  let totalSum = 0;
                                  let sumOfMeans = 0;
                                  
                                  Object.keys(variable.statements || {}).forEach((stmtCode) => {
                                    const statementVarName = `${baseName}_${stmtCode}`;
                                    const statementData = variableData[statementVarName];
                                    
                                    if (statementData) {
                                      if (statementData.sum !== undefined) {
                                        totalSum += statementData.sum;
                                      }
                                      if (statementData.mean !== undefined) {
                                        sumOfMeans += statementData.mean;
                                      }
                                    }
                                  });
                                  
                                  return (
                                    <tr className="bg-gray-50 font-semibold border-t-2 border-gray-300">
                                      <td className="px-2 py-2 text-sm text-gray-900" colSpan={2}>Total</td>
                                      <td className="px-4 py-2 text-sm text-gray-900 text-center" style={{ width: '5rem' }}>
                                        {sumOfMeans > 0
                                          ? (hasPercentTag ? `${sumOfMeans.toFixed(1)}%` : sumOfMeans.toFixed(2))
                                          : (hasPercentTag ? '-%' : '-')}
                                      </td>
                                      {hasNumberTag && (
                                        <>
                                          <td className="px-4 py-2 text-sm text-gray-900 text-center" style={{ width: '5rem' }}>
                                            {totalSum > 0 ? totalSum.toFixed(0) : '-'}
                                          </td>
                                          <td className="px-4 py-2 text-sm text-gray-900 text-center" style={{ width: '5rem' }}>
                                            100%
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
                      )}

                        {/* Summary Table with Outliers Removed for numeric grids */}
                        {(variable as any).isSummaryTable && variable.statements && !(variable as any).isScaleSummary && (() => {
                          // For summary tables, extract base question number (remove "_Summary" suffix)
                          const baseName = variable.name.endsWith('_Summary') 
                            ? variable.name.replace('_Summary', '') 
                            : variable.name;
                          
                          // Check if any statement variables have meanNoOutliers data
                          const hasNoOutliersData = Object.keys(variable.statements || {}).some((stmtCode) => {
                            const statementVarName = `${baseName}_${stmtCode}`;
                            const statementData = variableData[statementVarName];
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
                                      let totalSumNoOutliersForPercentage = 0;
                                      
                                      if (hasNumberTag) {
                                        Object.keys(variable.statements || {}).forEach((stmtCode) => {
                                          const statementVarName = `${baseName}_${stmtCode}`;
                                          const statementData = variableData[statementVarName];
                                          if (statementData && statementData.sumNoOutliers !== undefined && statementData.sumNoOutliers !== null) {
                                            totalSumNoOutliersForPercentage += statementData.sumNoOutliers;
                                          }
                                        });
                                      }
                                      
                                      return Object.entries(variable.statements || {}).map(([code, text]) => {
                                        const displayCode = code.replace(/^[rc]/i, '');
                                        const hasNumberTag = (variable as any).tags && Array.isArray((variable as any).tags) && (variable as any).tags.includes('Number');
                                        const hasPercentTag = (variable as any).tags && Array.isArray((variable as any).tags) && (variable as any).tags.includes('%');
                                        
                                        const statementVarName = `${baseName}_${code}`;
                                        const statementData = variableData[statementVarName];
                                        
                                        if (!statementData) {
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
                                        
                                        // Use meanNoOutliers and sumNoOutliers - this is the outliers removed table
                                        const meanNoOutliers = statementData.meanNoOutliers;
                                        const sumNoOutliers = statementData.sumNoOutliers;
                                        
                                        // Calculate percentage: (row sumNoOutliers / total sumNoOutliers of all rows) * 100
                                        const rowPercentage = totalSumNoOutliersForPercentage > 0 && sumNoOutliers !== undefined && sumNoOutliers !== null
                                          ? (sumNoOutliers / totalSumNoOutliersForPercentage) * 100 
                                          : undefined;
                                        
                                        return (
                                          <tr key={code}>
                                            <td className="px-2 py-2 text-sm font-mono text-gray-700 text-center" style={{ width: '2.5rem' }}>{displayCode}</td>
                                            <td className="px-4 py-2 text-sm text-gray-900">{text}</td>
                                            <td className="px-4 py-2 text-sm text-gray-900 text-center" style={{ width: '5rem' }}>
                                              {meanNoOutliers !== undefined && meanNoOutliers !== null
                                                ? (hasPercentTag ? `${meanNoOutliers.toFixed(1)}%` : meanNoOutliers.toFixed(2))
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
                                      
                                      let sumOfMeansNoOutliers = 0;
                                      let totalSumNoOutliers = 0;
                                      
                                      Object.keys(variable.statements || {}).forEach((stmtCode) => {
                                        const statementVarName = `${baseName}_${stmtCode}`;
                                        const statementData = variableData[statementVarName];
                                        
                                        if (statementData && statementData.meanNoOutliers !== undefined && statementData.meanNoOutliers !== null) {
                                          sumOfMeansNoOutliers += statementData.meanNoOutliers;
                                        }
                                        if (statementData && statementData.sumNoOutliers !== undefined && statementData.sumNoOutliers !== null) {
                                          totalSumNoOutliers += statementData.sumNoOutliers;
                                        }
                                      });
                                      
                                      // Total percentage should be 100% since it's the sum of all rows in the table
                                      const totalPercentage = totalSumNoOutliers > 0 ? 100 : undefined;
                                      
                                      return (
                                        <tr className="bg-gray-50 font-semibold border-t-2 border-gray-300">
                                          <td className="px-2 py-2 text-sm text-gray-900" colSpan={2}>Total</td>
                                          <td className="px-4 py-2 text-sm text-gray-900 text-center" style={{ width: '5rem' }}>
                                            {sumOfMeansNoOutliers > 0
                                              ? (hasPercentTag ? `${sumOfMeansNoOutliers.toFixed(1)}%` : sumOfMeansNoOutliers.toFixed(2))
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
                                          const cellData = variableData[cellVarName];
                                          
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
                         !variable.type?.toLowerCase().includes('numeric grid') && (() => {
                            const varData = variableData[variable.name];
                            
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
                            
                            Object.entries(variable.codes || {}).forEach(([code, label]) => {
                              const count = getCount(code, label);
                              const percentage = total > 0 ? (count / total) * 100 : 0;
                              totalPercentage += percentage;
                            });
                            
                            // Use a slightly larger threshold (0.1%) to account for floating point precision issues
                            // Also ensure we have a total > 0 and totalPercentage > 0 (not 0.0%)
                            if (total > 0 && totalPercentage > 0 && Math.abs(totalPercentage - 100) > 0.1) {
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
                              const firstRespVarData = variableData[firstRespVar.name];
                              
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
                                const respVarData = variableData[respVar.name];
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
                                const varData = variableData[variable.name];
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
                                    <th colSpan={2} className="px-4 py-2 text-left text-sm font-semibold text-gray-900">Response Options</th>
                                    <th className="px-4 py-2 text-center text-xs font-medium text-gray-500 uppercase tracking-wider whitespace-nowrap" style={{ width: '5rem' }}>Count</th>
                                    <th className="px-4 py-2 text-center text-xs font-medium text-gray-500 uppercase tracking-wider whitespace-nowrap" style={{ width: '5rem' }}>%</th>
                                  </tr>
                                </thead>
                              <tbody className="bg-white divide-y divide-gray-200">
                                  {(() => {
                                    const varData = variableData[variable.name];
                                    
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
                                    
                                    // First pass: calculate totals
                                    Object.entries(variable.codes).forEach(([code, label]) => {
                                      const count = getCount(code, label);
                                      totalCount += count;
                                      const percentage = total > 0 ? (count / total) * 100 : 0;
                                      totalPercentage += percentage;
                                    });
                                    
                                    return (
                                      <>
                                        {Object.entries(variable.codes).map(([code, label]) => {
                                          // Try multiple code formats to find the frequency
                                          // Data might be stored with "c1" or "1", or even with text labels
                                          const count = getCount(code, label);
                                          const percentage = total > 0 ? (count / total) * 100 : 0;
                                          
                                          // Display code without prefix (c1 -> 1, r1 -> 1) for the first column
                                          const displayCode = code.replace(/^[rc]/i, '');
                                          
                                          return (
                                            <tr key={code}>
                                              <td className="px-2 py-2 text-sm font-mono text-gray-700 text-center" style={{ width: '2.5rem' }}>{displayCode}</td>
                                              <td className="px-4 py-2 text-sm text-gray-900">{label}</td>
                                              <td className="px-4 py-2 text-sm text-gray-900 text-center" style={{ width: '5rem' }}>{count}</td>
                                              <td className="px-4 py-2 text-sm text-gray-900 text-center" style={{ width: '5rem' }}>{total > 0 ? `${percentage.toFixed(1)}%` : '-'}</td>
                                            </tr>
                                          );
                                        })}
                                        {/* Total row */}
                                        <tr className="bg-gray-50 font-semibold border-t-2 border-gray-300">
                                          <td className="px-2 py-2 text-sm text-gray-900" colSpan={2}>Total</td>
                                          <td className="px-4 py-2 text-sm text-gray-900 text-center" style={{ width: '5rem' }}>{totalCount}</td>
                                          <td className={`px-4 py-2 text-sm text-center font-semibold ${Math.abs(totalPercentage - 100) > 0.01 ? 'text-red-600' : 'text-gray-900'}`} style={{ width: '5rem' }}>
                                            {total > 0 ? `${totalPercentage.toFixed(1)}%` : '-'}
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

                        {/* Frequency table for open end questions */}
                        {variable.type?.toLowerCase().includes('open end') && 
                         !variable.codes && 
                         !variable.statements && 
                         !(variable as any).isSummaryTable && (() => {
                          const varData = variableData[variable.name];
                          if (!varData) return null;
                          
                          // Build frequency map from values array or frequencies object
                          const frequencyMap = new Map<string, number>();
                          let totalCount = 0;
                          
                          // If frequencies object exists, use it (pre-aggregated)
                          if (varData.frequencies && typeof varData.frequencies === 'object') {
                            Object.entries(varData.frequencies).forEach(([key, count]) => {
                              if (typeof count === 'number' && count > 0) {
                                const keyStr = String(key).trim();
                                if (keyStr) {
                                  frequencyMap.set(keyStr, count);
                                  totalCount += count;
                                }
                              }
                            });
                          } 
                          // Otherwise, calculate from values array
                          else if (Array.isArray(varData.values)) {
                            varData.values.forEach((val: any) => {
                              if (val !== null && val !== undefined && val !== '') {
                                const valStr = String(val).trim();
                                if (valStr) {
                                  frequencyMap.set(valStr, (frequencyMap.get(valStr) || 0) + 1);
                                  totalCount++;
                                }
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
                          
                          // Sort by count (descending), then alphabetically
                          const sortedFrequencies = Array.from(frequencyMap.entries())
                            .sort((a, b) => {
                              if (b[1] !== a[1]) {
                                return b[1] - a[1]; // Sort by count descending
                              }
                              return a[0].localeCompare(b[0]); // Then alphabetically
                            });
                          
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
                                        <th className="px-4 py-2 text-left text-sm font-semibold text-gray-900">Response</th>
                                        <th className="px-4 py-2 text-center text-xs font-medium text-gray-500 uppercase tracking-wider whitespace-nowrap" style={{ width: '5rem' }}>Count</th>
                                        <th className="px-4 py-2 text-center text-xs font-medium text-gray-500 uppercase tracking-wider whitespace-nowrap" style={{ width: '5rem' }}>%</th>
                                      </tr>
                                    </thead>
                                    <tbody className="bg-white divide-y divide-gray-200">
                                      {sortedFrequencies.map(([response, count], index) => {
                                        const percent = totalCount > 0 ? ((count / totalCount) * 100) : 0;
                                        
                                        return (
                                          <tr key={index}>
                                            <td className="px-4 py-2 text-sm text-gray-900 break-words max-w-md">{response}</td>
                                            <td className="px-4 py-2 text-sm text-gray-900 text-center" style={{ width: '5rem' }}>{count}</td>
                                            <td className="px-4 py-2 text-sm text-gray-900 text-center" style={{ width: '5rem' }}>{percent.toFixed(1)}%</td>
                                          </tr>
                                        );
                                      })}
                                      {/* Total row */}
                                      <tr className="bg-gray-50 font-semibold border-t-2 border-gray-300">
                                        <td className="px-4 py-2 text-sm text-gray-900">Total</td>
                                        <td className="px-4 py-2 text-sm text-gray-900 text-center" style={{ width: '5rem' }}>{totalCount}</td>
                                        <td className="px-4 py-2 text-sm text-gray-900 text-center" style={{ width: '5rem' }}>100.0%</td>
                                      </tr>
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
            /* Banners View */
            <div className="bg-white shadow-sm rounded-lg flex flex-col" style={{ minHeight: 0, borderRadius: 0 }}>
              {showBannerBuilder ? (
                <BannerBuilder
                  parsedFile={(() => {
                    // Create a parsedFile from the existing variables and variableData
                    // Convert Variable[] to VariableDefinition[] format
                    const variableDefinitions = variables
                      .filter(v => {
                        // Only include categorical variables (single select, multi-select, etc.)
                        // Exclude numeric grids, numeric lists, and summary tables
                        const type = v.type?.toLowerCase() || '';
                        return !type.includes('numeric') && 
                               !(v as any).isSummaryTable && 
                               !(v as any).isScaleSummary &&
                               (v.codes && Object.keys(v.codes).length > 0);
                      })
                      .map(v => {
                        // Determine the variable type
                        let varType: 'categorical' | 'multi-select' | 'grid' | 'grid-single-select' | 'grid-multi-select' = 'categorical';
                        const type = v.type?.toLowerCase() || '';
                        
                        if (type.includes('multi-select')) {
                          if (v.statements && Object.keys(v.statements).length > 0) {
                            varType = 'grid-multi-select';
                          } else {
                            varType = 'multi-select';
                          }
                        } else if (type.includes('single select grid') || type.includes('single-select grid')) {
                          varType = 'grid-single-select';
                        } else if (v.statements && Object.keys(v.statements).length > 0) {
                          varType = 'grid';
                        }
                        
                        return {
                          name: v.name,
                          description: v.description || '',
                          type: varType,
                          codes: v.codes || {},
                          statements: v.statements
                        };
                      });
                    
                    return {
                      variables: variableDefinitions,
                      data: [], // Not needed for banner builder
                      rowCount: 0,
                      metadata: {
                        fileName: '',
                        uploadedAt: new Date(),
                        sheetNames: []
                      }
                    };
                  })()}
                  editingGroup={editingBannerGroup}
                  onSave={(group) => {
                    if (editingBannerGroup) {
                      setBannerGroups(bannerGroups.map(g => g.id === group.id ? group : g));
                    } else {
                      setBannerGroups([...bannerGroups, group]);
                    }
                    setShowBannerBuilder(false);
                    setEditingBannerGroup(null);
                  }}
                  onCancel={() => {
                    setShowBannerBuilder(false);
                    setEditingBannerGroup(null);
                  }}
                />
              ) : selectedBannerGroupId ? (
                // Show banner group with variable sidebar
                (() => {
                  const selectedGroup = bannerGroups.find(g => g.id === selectedBannerGroupId);
                  if (!selectedGroup) {
                    setSelectedBannerGroupId(null);
                    return null;
                  }

                  // Get categorical variables for the sidebar
                  const categoricalVariables = variables.filter(v => {
                    const type = v.type?.toLowerCase() || '';
                    return !type.includes('numeric') && 
                           !(v as any).isSummaryTable && 
                           !(v as any).isScaleSummary &&
                           (v.codes && Object.keys(v.codes).length > 0);
                  });

                  // Get selected stub variable for this banner group
                  const currentStubVariable = selectedStubVariables[selectedGroup.id] || '';

                  // Create parsedFile for CrossTabDisplay
                  const createParsedFile = (): ParsedDataFile | null => {
                    if (variables.length === 0 || Object.keys(variableData).length === 0) {
                      return null;
                    }

                    // Convert Variable[] to VariableDefinition[] format
                    const variableDefinitions = categoricalVariables.map(v => {
                      let varType: 'categorical' | 'multi-select' | 'grid' | 'grid-single-select' | 'grid-multi-select' = 'categorical';
                      const type = v.type?.toLowerCase() || '';
                      
                      if (type.includes('multi-select')) {
                        if (v.statements && Object.keys(v.statements).length > 0) {
                          varType = 'grid-multi-select';
                        } else {
                          varType = 'multi-select';
                        }
                      } else if (type.includes('single select grid') || type.includes('single-select grid')) {
                        varType = 'grid-single-select';
                      } else if (v.statements && Object.keys(v.statements).length > 0) {
                        varType = 'grid';
                      }
                      
                      return {
                        name: v.name,
                        description: v.description || '',
                        type: varType,
                        codes: v.codes || {},
                        statements: v.statements
                      };
                    });

                    // Reconstruct row data from frequencies
                    // This is a simplified approach - we create rows based on the frequencies
                    // For proper crosstabs, we'd need the actual raw data file
                    const dataRows: Record<string, any>[] = [];
                    const maxCount = Math.max(...Object.values(variableData).map((v: any) => v?.count || 0), 0);
                    
                    // Create rows by reconstructing from frequencies
                    // This is a workaround - ideally we'd have the raw data file
                    for (let i = 0; i < maxCount; i++) {
                      const row: Record<string, any> = {};
                      variableDefinitions.forEach(v => {
                        const varData = variableData[v.name];
                        if (varData?.frequencies) {
                          // For each code, assign values based on frequency distribution
                          const codes = Object.keys(varData.frequencies);
                          const total = varData.count || 0;
                          let assigned = false;
                          for (const code of codes) {
                            const freq = varData.frequencies[code] || 0;
                            const ratio = total > 0 ? freq / total : 0;
                            const expectedCount = Math.round(ratio * maxCount);
                            const currentIndex = Math.floor(i * (codes.length / maxCount));
                            if (currentIndex < codes.length && !assigned) {
                              row[v.name] = codes[currentIndex];
                              assigned = true;
                            }
                          }
                          if (!assigned && codes.length > 0) {
                            row[v.name] = codes[0];
                          }
                        }
                      });
                      if (Object.keys(row).length > 0) {
                        dataRows.push(row);
                      }
                    }

                    return {
                      variables: variableDefinitions,
                      data: dataRows,
                      rowCount: dataRows.length,
                      metadata: {
                        fileName: uploadedFileInfo?.fileName || '',
                        uploadedAt: uploadedFileInfo?.uploadedAt ? new Date(uploadedFileInfo.uploadedAt) : new Date(),
                        sheetNames: []
                      }
                    };
                  };

                  const currentParsedFile = createParsedFile();

                  return (
                    <div className="flex h-[calc(100vh-200px)]">
                      {/* Variables Sidebar */}
                      <div className="w-80 border-r border-gray-200 flex flex-col" style={{ height: '100%', overflow: 'hidden' }}>
                        <div className="p-4 border-b border-gray-200 flex-shrink-0">
                          <div className="flex items-center justify-between mb-2">
                            <button
                              onClick={() => setSelectedBannerGroupId(null)}
                              className="flex items-center gap-1 text-sm text-gray-600 hover:text-gray-900"
                            >
                              <ArrowLeftIcon className="h-4 w-4" />
                              Back
                            </button>
                          </div>
                          <h3 className="text-sm font-semibold text-gray-900 mt-2">{selectedGroup.title}</h3>
                        </div>
                        <div className="flex-1 overflow-y-auto p-2" style={{ minHeight: 0 }}>
                          {categoricalVariables.length === 0 ? (
                            <div className="text-center py-8 text-gray-500 text-sm">
                              No categorical variables available
                            </div>
                          ) : (
                            <div className="space-y-1">
                              {categoricalVariables.map((v) => {
                                const varData = variableData[v.name];
                                const hasData = varData && (
                                  (varData.count && varData.count > 0) ||
                                  (varData.frequencies && Object.keys(varData.frequencies || {}).length > 0)
                                );

                                return (
                                  <button
                                    key={v.name}
                                    onClick={() => {
                                      setSelectedStubVariables({
                                        ...selectedStubVariables,
                                        [selectedGroup.id]: v.name
                                      });
                                    }}
                                    className={`w-full text-left px-3 py-2 rounded-lg text-sm transition-colors ${
                                      currentStubVariable === v.name
                                        ? 'bg-orange-100 text-orange-900'
                                        : 'hover:bg-gray-100 text-gray-700'
                                    }`}
                                  >
                                    <div className="flex items-center gap-2 w-full">
                                      <span className="font-medium">{v.name}</span>
                                      {!hasData && (
                                        <InformationCircleIcon className="h-4 w-4 text-red-500 flex-shrink-0" title="No data available for this variable" />
                                      )}
                                    </div>
                                    {v.description && (
                                      <div className="text-xs text-gray-500 mt-1 truncate">{v.description}</div>
                                    )}
                                  </button>
                                );
                              })}
                            </div>
                          )}
                        </div>
                      </div>

                      {/* Main Content Area - Cross Tab Display */}
                      <div className="flex-1 flex flex-col" style={{ minHeight: 0, overflow: 'hidden' }}>
                        {currentParsedFile ? (
                          <div className="flex-1 overflow-auto p-6">
                            <CrossTabDisplay
                              parsedFile={currentParsedFile}
                              bannerGroup={selectedGroup}
                              selectedStubVariable={currentStubVariable}
                              onStubVariableChange={(variableName) => {
                                setSelectedStubVariables({
                                  ...selectedStubVariables,
                                  [selectedGroup.id]: variableName
                                });
                              }}
                              hideStubVariableDropdown={true}
                              hideOpenEnds={true}
                              hideZeroBase={false}
                              getVariableBase={(variableName: string) => {
                                const varData = variableData[variableName];
                                return varData?.count || 0;
                              }}
                              hideInCrosstabs={{}}
                              sortOptions={{}}
                              hideZeroFrequencies={{}}
                              allBannerGroups={bannerGroups}
                              currentBannerGroupIndex={bannerGroups.findIndex(g => g.id === selectedBannerGroupId)}
                              onEdit={() => {
                                setEditingBannerGroup(selectedGroup);
                                setShowBannerBuilder(true);
                              }}
                            />
                          </div>
                        ) : (
                          <div className="flex-1 flex items-center justify-center">
                            <div className="text-center">
                              <p className="text-gray-600 mb-2">No data available</p>
                              <p className="text-sm text-gray-500">Please upload a data file to view cross tabs</p>
                            </div>
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })()
              ) : (
                // Show list of banner groups
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
                  {bannerGroups.length === 0 ? (
                    <div className="flex-1 flex items-center justify-center">
                      <div className="text-center">
                        <IconTable className="h-16 w-16 text-gray-300 mx-auto mb-4" />
                        <h3 className="text-lg font-medium text-gray-900 mb-2">No Banner Groups</h3>
                        <p className="text-gray-600 mb-4">Create banner groups to add cross tab cuts</p>
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
                    </div>
                  ) : (
                    <div className="grid grid-cols-1 gap-4">
                      {bannerGroups.map((group) => (
                        <div
                          key={group.id}
                          className="border border-gray-200 rounded-lg p-4 hover:border-gray-300 hover:shadow-md transition-all cursor-pointer"
                          onClick={() => setSelectedBannerGroupId(group.id)}
                        >
                          <div className="flex items-center justify-between">
                            <div className="flex-1">
                              <h4 className="text-md font-semibold text-gray-900 mb-1">{group.title}</h4>
                              <p className="text-sm text-gray-600">
                                {group.groups && group.groups.length > 0 ? (
                                  <>
                                    {group.groups.length} {group.groups.length === 1 ? 'group' : 'groups'} • {' '}
                                    {group.groups.reduce((sum, g) => sum + g.cuts.length, 0)} {group.groups.reduce((sum, g) => sum + g.cuts.length, 0) === 1 ? 'cut' : 'cuts'}
                                  </>
                                ) : (group as any).cuts ? (
                                  <>
                                    {(group as any).cuts.length} {(group as any).cuts.length === 1 ? 'cut' : 'cuts'}
                                  </>
                                ) : (
                                  'No cuts'
                                )}
                              </p>
                            </div>
                            <div className="flex items-center gap-2">
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  if (confirm('Are you sure you want to delete this banner group?')) {
                                    setBannerGroups(bannerGroups.filter(g => g.id !== group.id));
                                    if (selectedBannerGroupId === group.id) {
                                      setSelectedBannerGroupId(null);
                                    }
                                  }
                                }}
                                className="p-2 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                                title="Delete banner group"
                              >
                                <TrashIcon className="h-5 w-5" />
                              </button>
                              <svg 
                                className="w-5 h-5 text-gray-400" 
                                fill="none" 
                                stroke="currentColor" 
                                viewBox="0 0 24 24"
                              >
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                              </svg>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
                            </div>
            ) : (
            /* Data Upload View */
            <div className="p-6">
                <div className="bg-white border border-gray-200 rounded-lg p-6">
                  <h3 className="text-lg font-semibold text-gray-900 mb-4">Upload Data File</h3>
                  
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
                                <span className="px-2 py-1.5 text-xs font-medium rounded bg-green-100 text-green-800">Mapped</span>
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
                                        const expectedHeaders = getExpectedColumnHeadersForBase(group.baseNumber, group.variables);
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
                                        
                                        for (const group of baseQuestionMap.values()) {
                                          if (foundVariable) break; // Already found
                                          
                                          // Check each variable in this group
                                          for (const variable of group.variables) {
                                            if (foundVariable) break; // Already found
                                            
                                            // Generate expected headers for this variable
                                            const headers = getExpectedColumnHeadersForBase(group.baseNumber, [variable]);
                                            if (headers.includes(expectedHeader)) {
                                              foundVariable = variable;
                                              break;
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
                    <>
                      <p className="text-sm text-gray-600 mb-6">
                        Upload an Excel (.xlsx, .xls) or CSV file containing your survey data. The system will parse the column headers.
                      </p>
                      
                      <div className="border-2 border-dashed border-gray-300 rounded-lg p-8 text-center">
                    <input
                      type="file"
                      id="data-file-upload"
                      accept=".xlsx,.xls,.csv"
                      onChange={async (e) => {
                        const file = e.target.files?.[0];
                        if (file && selectedQuestionnaire) {
                          setDataFile(file);
                          setDataUploadSuccess(false);
                          // Don't clear column headers - we want to keep them visible
                          setShowAllHeaders(false);
                          
                          // Parse headers from the file locally
                          try {
                            setUploadingFile(true);
                            const parsedHeaders = await parseFileHeaders(file);
                            
                            // Auto-upload the file after parsing headers
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
                              // Set file info immediately from the response - always set processed to false for new uploads
                              setUploadedFileInfo({
                                fileName: result.originalFileName || result.fileName || file.name,
                                uploadedAt: new Date().toISOString(),
                                processed: false  // New uploads are never mapped initially
                              });
                              // Save column headers to metadata using the parsed headers directly
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
                                  // Continue anyway - headers are already in state
                                }
                              }
                              // Clear the selected file since it's now uploaded
                              setDataFile(null);
                              // Reset file input
                              const fileInput = document.getElementById('data-file-upload') as HTMLInputElement;
                              if (fileInput) fileInput.value = '';
                              // Reload file info after a short delay to ensure everything is saved
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
                        } else if (file && !selectedQuestionnaire) {
                          // Silently return if no questionnaire selected
                        }
                      }}
                      className="hidden"
                    />
                    <label htmlFor="data-file-upload" className="cursor-pointer">
                      <CloudArrowUpIcon className="mx-auto h-12 w-12 text-gray-400 mb-4" />
                      <div className="text-sm text-gray-600">
                        {dataFile ? (
                          <span className="font-medium text-gray-900">{dataFile.name}</span>
                        ) : (
                          <>
                            <span className="font-medium text-orange-600">Click to upload</span> or drag and drop
                          </>
                  )}
                </div>
                          <p className="text-xs text-gray-500 mt-2">Excel (.xlsx, .xls) or CSV files only</p>
                        </label>
                        </div>
                    </>
                  )}

                  {uploadingFile && (
                    <div className="mt-4 text-center text-sm text-gray-500">
                      {columnHeaders.length > 0 ? 'Uploading file...' : 'Parsing column headers...'}
                        </div>
                      )}
                      

                  {/* Three Boxes: QNR Variables, Column Headers, Data Mapping */}
                  <div className="mt-6">
                    {uploadedFileInfo ? (
                      <div className={`grid gap-6 ${Object.keys(columnMapping).length > 0 ? 'grid-cols-3' : 'grid-cols-2'}`}>
                        {/* QNR Variables Box */}
                        <div className="flex flex-col">
                          <div className="flex items-center justify-between mb-3">
                            <h4 className="text-sm font-semibold text-gray-900">
                              QNR Variables {variables.length > 0 ? (() => {
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
                                    // Get the question type from the original question data
                                    const question = questionnaireQuestions.find(q => (q.number || q.id) === baseNumber);
                                    const questionType = question?.type || variable.type || '';
                                    
                                    baseQuestionMap.set(baseNumber, {
                                      baseNumber,
                                      type: questionType,
                                      variables: []
                                    });
                                  }
                                  baseQuestionMap.get(baseNumber)!.variables.push(variable);
                                });
                                return `(${baseQuestionMap.size})`;
                              })() : ''}
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
                            <table className="w-full divide-y divide-gray-200" style={{ tableLayout: 'fixed' }}>
                              <thead className="bg-gray-50">
                                <tr>
                                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider whitespace-nowrap" style={{ width: '80px' }}>Q#</th>
                                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider" style={{ width: '30%' }}>Question Type</th>
                                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Expected Headers</th>
                                </tr>
                              </thead>
                            </table>
                            <div className="overflow-y-auto overflow-x-hidden" style={{ maxHeight: 'calc(10 * 3rem)' }}>
                              <table className="w-full divide-y divide-gray-200" style={{ tableLayout: 'fixed' }}>
                                <tbody className="bg-white divide-y divide-gray-200">
                                  {variables.length > 0 ? (() => {
                                    // Group variables by base question number
                                    const baseQuestionMap = new Map<string, { baseNumber: string; type: string; variables: Variable[] }>();
                                    
                                    variables.forEach((variable) => {
                                      // Filter out summary table variables
                                      if (variable.name.endsWith('_Summary Tables') || 
                                          variable.name.endsWith('_T2B') || 
                                          variable.name.endsWith('_B2B') || 
                                          variable.name.endsWith('_M3B') ||
                                          (variable as any).isSummaryTable) {
                                        return;
                                      }
                                      
                                      const baseNumber = getBaseQuestionNumber(variable.name);
                                      if (!baseQuestionMap.has(baseNumber)) {
                                        // Get the question type from the original question data
                                        // Try multiple formats for question number matching
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
                                    
                                    // After grouping, update types for numeric grids and numeric lists
                                    baseQuestionMap.forEach((group) => {
                                      // Check if any variable in the group has a grid type
                                      const hasGridType = group.variables.some(v => 
                                        v.type && v.type.toLowerCase().includes('grid')
                                      );
                                      
                                      if (hasGridType) {
                                        // Find the grid type
                                        const gridVar = group.variables.find(v => 
                                          v.type && v.type.toLowerCase().includes('grid')
                                        );
                                        if (gridVar) {
                                          group.type = gridVar.type;
                                        }
                                      } else {
                                        // Check if variables have the pattern of a numeric grid (both r and c codes)
                                        const hasGridPattern = group.variables.some(v => {
                                          const hasRowCode = /r\d+/i.test(v.name);
                                          const hasColCode = /c\d+/i.test(v.name);
                                          return hasRowCode && hasColCode;
                                        });
                                        
                                        if (hasGridPattern && group.type === 'Numeric') {
                                          group.type = 'Numeric Grid';
                                        } else {
                                          // Check if this is a numeric list pattern
                                          // Numeric lists can have:
                                          // 1. Variables with _r codes but no _c codes (e.g., S5_r1, S5_r2)
                                          // 2. Variables with just numeric codes after underscore (e.g., S14B_1, S14B_2)
                                          const hasNumericListPattern = group.variables.some(v => {
                                            // Check for _r1, _r2 pattern
                                            const hasUnderscoreRowCode = /_[rR]\d+/i.test(v.name);
                                            // Check for _1, _2 pattern (just a number after underscore at the end)
                                            const hasNumericCode = /_\d+$/.test(v.name);
                                            const hasColCode = /[cC]\d+/i.test(v.name);
                                            return (hasUnderscoreRowCode || hasNumericCode) && !hasColCode;
                                          });
                                          
                                          // If we detect numeric list pattern, try to get the correct type from the question
                                          if (hasNumericListPattern) {
                                            const question = questionnaireQuestions.find(q => {
                                              const qNum = q.number || q.id;
                                              return qNum === group.baseNumber || qNum === group.baseNumber.replace(/^Q/, '');
                                            });
                                            if (question && question.type && question.type.toLowerCase().includes('numeric list')) {
                                              group.type = question.type;
                                            } else if (group.type === 'Numeric') {
                                              // Fallback: if type is still 'Numeric' but pattern suggests numeric list, update it
                                              group.type = 'Numeric List';
                                            }
                                          }
                                        }
                                      }
                                    });
                                    
                                    // Convert to array and filter
                                    let groupedQuestions = Array.from(baseQuestionMap.values());
                                    
                                    // Apply search filter
                                    if (qnrVariableSearch.trim()) {
                                      const searchLower = qnrVariableSearch.toLowerCase();
                                      groupedQuestions = groupedQuestions.filter(group => {
                                        const matchesBase = group.baseNumber.toLowerCase().includes(searchLower);
                                        const matchesType = group.type.toLowerCase().includes(searchLower);
                                        const expectedHeaders = getExpectedColumnHeadersForBase(group.baseNumber, variables);
                                        const matchesExpected = expectedHeaders.some(h => h.toLowerCase().includes(searchLower));
                                        return matchesBase || matchesType || matchesExpected;
                                      });
                                    }
                                    
                                    return groupedQuestions.map((group) => {
                                      const expectedHeaders = getExpectedColumnHeadersForBase(group.baseNumber, variables);
                                      
                                      return (
                                        <tr key={group.baseNumber}>
                                          <td className="px-4 py-3 text-xs font-medium text-gray-500 tracking-wider whitespace-nowrap" style={{ width: '80px' }} title={group.baseNumber}>{group.baseNumber}</td>
                                          <td className="px-4 py-3 text-xs font-medium text-gray-500 tracking-wider truncate" style={{ width: '30%' }} title={group.type || '-'}>{group.type || '-'}</td>
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
                                        No variables available. Sync with QNR to load variables.
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
                        {hasAttemptedMapping && (
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
                                            {isMapped ? mappedColumnHeader : <span className="text-gray-400 italic">Not mapped</span>}
                                          </td>
                                          <td className="px-4 py-3 text-right whitespace-nowrap">
                                            {isMapped ? (
                                              <button
                                                onClick={async (e) => {
                                                  e.stopPropagation();
                                                  // Remove mapping for this variable
                                                  const newMapping = { ...columnMapping };
                                                  delete newMapping[mappedVariableName];
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
                                                        debouncedLoadFileInfo(500);
                                                      }
                                                    } catch (error) {
                                                      console.error('Error saving mapping:', error);
                                                    }
                                                  }
                                                }}
                                                className="inline-flex items-center gap-1 px-2 py-1 text-xs font-medium rounded-full bg-green-100 text-green-700 hover:bg-green-200 transition-colors"
                                                title={`Mapped to: ${mappedColumnHeader}`}
                                              >
                                                <span>Mapped</span>
                                                <svg className="w-3 h-3 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                                                </svg>
                                              </button>
                                            ) : (
                                              <button
                                                onClick={() => {
                                                  setSelectedUnmappedExpectedHeader(expectedHeader);
                                                  setShowUnmappedHeaderMappingModal(true);
                                                }}
                                                className="inline-flex items-center px-2 py-1 text-xs font-medium rounded-full bg-red-100 text-red-700 hover:bg-red-200 transition-colors cursor-pointer"
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
                            QNR Variables {variables.length > 0 ? (() => {
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
                                  // Get the question type from the original question data
                                  const question = questionnaireQuestions.find(q => (q.number || q.id) === baseNumber);
                                  const questionType = question?.type || variable.type || '';
                                  
                                  baseQuestionMap.set(baseNumber, {
                                    baseNumber,
                                    type: questionType,
                                    variables: []
                                  });
                                }
                                baseQuestionMap.get(baseNumber)!.variables.push(variable);
                              });
                              return `(${baseQuestionMap.size})`;
                            })() : ''}
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
                          <table className="w-full divide-y divide-gray-200" style={{ tableLayout: 'fixed' }}>
                            <thead className="bg-gray-50">
                              <tr>
                                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider whitespace-nowrap" style={{ width: '80px' }}>Q#</th>
                                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider" style={{ width: '30%' }}>Question Type</th>
                                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Expected Headers</th>
                              </tr>
                            </thead>
                          </table>
                          <div className="overflow-y-auto overflow-x-hidden" style={{ maxHeight: 'calc(10 * 3rem)' }}>
                            <table className="w-full divide-y divide-gray-200" style={{ tableLayout: 'fixed' }}>
                              <tbody className="bg-white divide-y divide-gray-200">
                                {variables.length > 0 ? (() => {
                                  // Group variables by base question number
                                  const baseQuestionMap = new Map<string, { baseNumber: string; type: string; variables: Variable[] }>();
                                  
                                  variables.forEach((variable) => {
                                    // Filter out summary table variables
                                    if (variable.name.endsWith('_Summary Tables') || 
                                        variable.name.endsWith('_T2B') || 
                                        variable.name.endsWith('_B2B') || 
                                        variable.name.endsWith('_M3B') ||
                                        (variable as any).isSummaryTable) {
                                      return;
                                    }
                                    
                                    const baseNumber = getBaseQuestionNumber(variable.name);
                                    if (!baseQuestionMap.has(baseNumber)) {
                                      // Get the question type from the original question data
                                      const question = questionnaireQuestions.find(q => (q.number || q.id) === baseNumber);
                                      const questionType = question?.type || variable.type || '';
                                      
                                      baseQuestionMap.set(baseNumber, {
                                        baseNumber,
                                        type: questionType,
                                        variables: []
                                      });
                                    }
                                    baseQuestionMap.get(baseNumber)!.variables.push(variable);
                                  });
                                  
                                  // After grouping, update types for numeric grids and numeric lists
                                  baseQuestionMap.forEach((group) => {
                                    // Check if any variable in the group has a grid type
                                    const hasGridType = group.variables.some(v => 
                                      v.type && v.type.toLowerCase().includes('grid')
                                    );
                                    
                                    if (hasGridType) {
                                      // Find the grid type
                                      const gridVar = group.variables.find(v => 
                                        v.type && v.type.toLowerCase().includes('grid')
                                      );
                                      if (gridVar) {
                                        group.type = gridVar.type;
                                      }
                                    } else {
                                      // Check if variables have the pattern of a numeric grid (both r and c codes)
                                      const hasGridPattern = group.variables.some(v => {
                                        const hasRowCode = /r\d+/i.test(v.name);
                                        const hasColCode = /c\d+/i.test(v.name);
                                        return hasRowCode && hasColCode;
                                      });
                                      
                                      if (hasGridPattern && group.type === 'Numeric') {
                                        group.type = 'Numeric Grid';
                                      } else {
                                        // Check if this is a numeric list pattern (variables with _r codes but no _c codes)
                                        const hasNumericListPattern = group.variables.some(v => {
                                          const hasUnderscoreRowCode = /_[rR]\d+/i.test(v.name);
                                          const hasColCode = /[cC]\d+/i.test(v.name);
                                          return hasUnderscoreRowCode && !hasColCode;
                                        });
                                        
                                        // If we detect numeric list pattern, try to get the correct type from the question
                                        if (hasNumericListPattern) {
                                          const question = questionnaireQuestions.find(q => {
                                            const qNum = q.number || q.id;
                                            return qNum === group.baseNumber || qNum === group.baseNumber.replace(/^Q/, '');
                                          });
                                          if (question && question.type && question.type.toLowerCase().includes('numeric list')) {
                                            group.type = question.type;
                                          } else if (group.type === 'Numeric') {
                                            // Fallback: if type is still 'Numeric' but pattern suggests numeric list, update it
                                            group.type = 'Numeric List';
                                          }
                                        }
                                      }
                                    }
                                  });
                                  
                                  // Convert to array and filter
                                  let groupedQuestions = Array.from(baseQuestionMap.values());
                                  
                                  // Apply search filter
                                  if (qnrVariableSearch.trim()) {
                                    const searchLower = qnrVariableSearch.toLowerCase();
                                    groupedQuestions = groupedQuestions.filter(group => {
                                      const matchesBase = group.baseNumber.toLowerCase().includes(searchLower);
                                      const matchesType = group.type.toLowerCase().includes(searchLower);
                                      const expectedHeaders = getExpectedColumnHeadersForBase(group.baseNumber, variables);
                                      const matchesExpected = expectedHeaders.some(h => h.toLowerCase().includes(searchLower));
                                      return matchesBase || matchesType || matchesExpected;
                                    });
                                  }
                                  
                                  return groupedQuestions.map((group) => {
                                    const expectedHeaders = getExpectedColumnHeadersForBase(group.baseNumber, variables);
                                    
                                    return (
                                      <tr key={group.baseNumber}>
                                        <td className="px-4 py-3 text-xs font-medium text-gray-500 tracking-wider whitespace-nowrap" style={{ width: '80px' }} title={group.baseNumber}>{group.baseNumber}</td>
                                        <td className="px-4 py-3 text-xs font-medium text-gray-500 tracking-wider truncate" style={{ width: '30%' }} title={group.type || '-'}>{group.type || '-'}</td>
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
                                      No variables available. Sync with QNR to load variables.
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
              <button
                onClick={() => {
                  setShowQuestionModal(false);
                  setQuestionData(null);
                }}
                className="text-gray-400 hover:text-gray-600"
              >
                <XMarkIcon className="h-6 w-6" />
              </button>
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
                      <h4 className="text-sm font-medium text-gray-700 mb-2">Statements (Rows):</h4>
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
                      <h4 className="text-sm font-medium text-gray-700 mb-2">Response Options (Columns):</h4>
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
              ) : (
                <div className="text-center py-12">
                  <p className="text-gray-500">Question not found in QNR</p>
                </div>
              )}
            </div>
            
            {/* Bottom: Programming logic and actions */}
            {questionData && (
              <div className="border-t border-gray-200 p-6 space-y-4">
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
                  // Find the questionnaire that contains this question from the already loaded questionnaires
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
                          // Store project and QNR IDs in sessionStorage for QNR component to pick up
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
                              debouncedLoadFileInfo(500);
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
                const expectedHeaders = getExpectedColumnHeadersForBase(selectedUnmappedQuestion.baseNumber, selectedUnmappedQuestion.variables);
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
                              onClick={() => {
                                const newMapping = { ...columnMapping };
                                delete newMapping[expectedHeader];
                                
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
















































































