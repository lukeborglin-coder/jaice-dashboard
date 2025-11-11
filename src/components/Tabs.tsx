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
  const [columnMapping, setColumnMapping] = useState<Record<string, string>>({});
  const [columnHeaderSearch, setColumnHeaderSearch] = useState('');
  const [qnrVariableSearch, setQnrVariableSearch] = useState('');
  const [showMappingModal, setShowMappingModal] = useState(false);
  const [selectedColumnHeader, setSelectedColumnHeader] = useState<string | null>(null);
  const [selectedVariableForMapping, setSelectedVariableForMapping] = useState<string>('');
  const [uploadingData, setUploadingData] = useState(false);
  const [showQuestionModal, setShowQuestionModal] = useState(false);
  const [showColumnHeaderModal, setShowColumnHeaderModal] = useState(false);
  const [selectedQuestionForMapping, setSelectedQuestionForMapping] = useState<string | null>(null);
  const [columnHeaderModalSearch, setColumnHeaderModalSearch] = useState('');
  const [loadingQuestion, setLoadingQuestion] = useState(false);
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
        // Debug logging for numeric grids
        if (questionNumber === 'S14' || questionNumber.includes('S14')) {
          console.log(`🔍 Numeric Grid ${questionNumber}:`, {
            statementOptions: question.statementOptions,
            responseOptions: question.responseOptions,
            options: question.options,
            statements: statements,
            codes: codes,
            hasStatements: !!statements && Object.keys(statements).length > 0,
            hasCodes: !!codes && Object.keys(codes).length > 0
          });
        }
        
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
          console.log(`[Multiselect ${questionNumber}] Creating response variables:`, {
            codes: Object.keys(codes),
            codesObject: codes,
            questionType
          });
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
            console.log(`[Multiselect ${questionNumber}] Creating variable: ${responseVarName} from code ${optionCode}`);
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
          console.warn(`[Multiselect ${questionNumber}] No codes found, creating main variable instead. Codes:`, codes);
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

  // Load questionnaire details function
  const loadQuestionnaireDetails = useCallback(async () => {
    if (!selectedQuestionnaire) {
      console.log('No questionnaire selected');
      return;
    }
    
    // First check if the questionnaire already has questions
    if (selectedQuestionnaire.questions && selectedQuestionnaire.questions.length > 0) {
      console.log('Using questions from selected questionnaire:', selectedQuestionnaire.questions.length);
      setQuestionnaireQuestions(selectedQuestionnaire.questions);
      return;
    }
    
    // If not, try to find it in allQuestionnaires
    if (allQuestionnaires.length > 0) {
      const fullQnr = allQuestionnaires.find(q => q.id === selectedQuestionnaire.id);
      if (fullQnr && fullQnr.questions && fullQnr.questions.length > 0) {
        console.log('Found questionnaire in allQuestionnaires:', fullQnr.questions.length);
        setQuestionnaireQuestions(fullQnr.questions);
      return;
      }
    }
    
    // If still not found, try to load from the project's questionnaires
    if (selectedProject) {
      setLoading(true);
      try {
        console.log('Loading questionnaires for project:', selectedProject.id);
        const response = await fetch(`${API_BASE_URL}/api/questionnaire/${selectedProject.id}`, {
          headers: { 'Authorization': `Bearer ${localStorage.getItem('cognitive_dash_token')}` }
        });
      if (response.ok) {
          const projectQuestionnaires = await response.json();
          const fullQnr = projectQuestionnaires.find((q: any) => q.id === selectedQuestionnaire.id);
          if (fullQnr && fullQnr.questions && fullQnr.questions.length > 0) {
            console.log('Found questionnaire in project questionnaires:', fullQnr.questions.length);
            setQuestionnaireQuestions(fullQnr.questions);
          } else {
            console.log('Questionnaire not found or has no questions');
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
      console.log('Loading processed data for questionnaire:', selectedQuestionnaire.id);
      const response = await fetch(`${API_BASE_URL}/api/questionnaire/processed-data/${selectedQuestionnaire.id}`, {
          headers: { 'Authorization': `Bearer ${localStorage.getItem('cognitive_dash_token')}` }
        });
      if (response.ok) {
        const data = await response.json();
        console.log('Processed data loaded successfully:', {
          variableCount: Object.keys(data || {}).length,
          sampleVariables: Object.keys(data || {}).slice(0, 5),
          sampleData: Object.keys(data || {}).slice(0, 2).reduce((acc, key) => {
            acc[key] = {
              count: data[key]?.count,
              numeric: data[key]?.numeric,
              hasFrequencies: !!data[key]?.frequencies,
              hasMean: data[key]?.mean !== undefined,
              frequenciesKeys: data[key]?.frequencies ? Object.keys(data[key].frequencies).slice(0, 5) : []
            };
            return acc;
          }, {} as any)
        });
        // Always set the data, even if it's an empty object
        if (data && typeof data === 'object') {
          setVariableData(data);
          console.log('✅ Variable data state updated with', Object.keys(data).length, 'variables');
          // Log a sample to verify data structure
          const sampleVar = Object.keys(data)[0];
          if (sampleVar) {
            console.log(`   Sample variable "${sampleVar}":`, {
              count: data[sampleVar]?.count,
              hasFrequencies: !!data[sampleVar]?.frequencies,
              numeric: data[sampleVar]?.numeric
            });
          }
        } else {
          console.warn('⚠️ Received invalid data format:', data);
          setVariableData({});
        }
      } else {
        const errorData = await response.json().catch(() => ({ error: 'Unknown error' }));
        console.log('No processed data found (HTTP', response.status, '):', errorData);
        // Don't clear existing data on 404 - it might just not exist yet
        // Only clear if we get a 404 and we don't have any data already
        // This prevents clearing data during race conditions
      }
    } catch (error) {
      // It's okay if processed data doesn't exist yet
      console.error('Error loading processed data:', error);
      // Don't clear on error - might be a temporary network issue
    }
  }, [selectedQuestionnaire]);

  // Load file info function
  const loadFileInfo = useCallback(async () => {
    if (!selectedQuestionnaire) {
      setUploadedFileInfo(null);
      setColumnMapping({});
      setColumnHeaders([]);
      setDataUploaded(false);
      return;
    }
    try {
      console.log('Loading file info for questionnaire:', selectedQuestionnaire.id);
      const response = await fetch(`${API_BASE_URL}/api/questionnaire/data-file-info/${selectedQuestionnaire.id}`, {
        headers: { 'Authorization': `Bearer ${localStorage.getItem('cognitive_dash_token')}` }
      });
      if (response.ok) {
        const data = await response.json();
        console.log('File info loaded:', data);
        // Check if column mapping exists to determine if it's been mapped
        const isMapped = !!(data.columnMapping && Object.keys(data.columnMapping).length > 0);
        // Check if data has been processed/uploaded
        const isUploaded = !!data.processedAt;
        setUploadedFileInfo({
          fileName: data.originalFileName || data.fileName || 'Unknown',
          uploadedAt: data.uploadedAt || new Date().toISOString(),
          processed: isMapped
        });
        setDataUploaded(isUploaded);
        // Load the column mapping if it exists
        if (data.columnMapping) {
          setColumnMapping(data.columnMapping);
          console.log('Column mapping loaded:', Object.keys(data.columnMapping).length, 'variables');
        } else {
          setColumnMapping({});
        }
        // Load column headers if they exist in metadata
        if (data.columnHeaders && Array.isArray(data.columnHeaders) && data.columnHeaders.length > 0) {
          setColumnHeaders(data.columnHeaders);
          console.log('Column headers loaded:', data.columnHeaders.length, 'headers');
      } else {
          // If no column headers in metadata, clear them
          setColumnHeaders([]);
        }
      } else {
        console.log('No file info found (404)');
        setUploadedFileInfo(null);
        setColumnMapping({});
        setColumnHeaders([]);
        setDataUploaded(false);
      }
    } catch (error) {
      console.log('No file info found (this is normal if no file has been uploaded yet):', error);
      setUploadedFileInfo(null);
      setColumnMapping({});
      setColumnHeaders([]);
      setDataUploaded(false);
    }
  }, [selectedQuestionnaire]);

  // Load questionnaire details and processed data when questionnaire is selected
  useEffect(() => {
    if (selectedQuestionnaire) {
      console.log('Questionnaire selected, loading data...', selectedQuestionnaire.id);
      // Always load questionnaire details to get questions/variables
      loadQuestionnaireDetails();
      // Also try to load processed data if it exists - this ensures data persists when navigating back
      // This is critical for page refreshes - data must be loaded from backend
      loadProcessedData();
      // Load file info for data view
      loadFileInfo();
    } else {
      // Only clear data when explicitly switching away from a questionnaire
      // Don't clear during initial render or when questionnaire is temporarily undefined
      if (viewMode === 'home' || viewMode === 'project') {
        setVariableData({});
      }
    }
  }, [selectedQuestionnaire, loadQuestionnaireDetails, loadProcessedData, loadFileInfo, viewMode]);
  
  // Load file info when switching to data view if questionnaire is already selected
  useEffect(() => {
    if (qnrViewMode === 'data' && selectedQuestionnaire) {
      loadFileInfo();
      // Don't reload processed data here - it's already loaded when questionnaire is selected
      // This prevents unnecessary API calls and potential race conditions
    }
  }, [qnrViewMode, selectedQuestionnaire, loadFileInfo]);

  // Convert questions to variables when both questions and variableData are available
  // This must run whenever either questions or variableData changes to ensure variables
  // are properly populated on page refresh when data loads asynchronously
  useEffect(() => {
    if (questionnaireQuestions.length > 0) {
      console.log('Converting questions to variables:', {
        questionCount: questionnaireQuestions.length,
        variableDataCount: Object.keys(variableData).length,
        hasVariableData: Object.keys(variableData).length > 0
      });
      // Always call convertQuestionsToVariables when we have questions
      // It will use the current variableData (even if empty initially, then re-run when data loads)
      convertQuestionsToVariables(questionnaireQuestions);
    } else if (Object.keys(variableData).length > 0) {
      // If we have variableData but no questions yet, we still want to show variables
      // This handles edge cases where data exists but questions haven't loaded
      console.log('Converting variableData to variables (no questions yet):', {
        variableDataCount: Object.keys(variableData).length
      });
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
                                `${baseName}${stmtCode}${columnCode}`,
                                `${baseName}_${stmtCode}_${columnCode}`,
                                `${baseName}${stmtCode}_${columnCode}`,
                                `${baseName}_${stmtCode}${columnCode}`,
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
                              <span className="font-medium">{v.name}</span>
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
                          `${baseName}${stmtCode}${columnCode}`,
                          `${baseName}_${stmtCode}_${columnCode}`,
                          `${baseName}${stmtCode}_${columnCode}`,
                          `${baseName}_${stmtCode}${columnCode}`,
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
                            `${baseName}_${stmtCode}_${columnCode}`,  // S11_r1_c1
                            `${baseName}${stmtCode}${columnCode}`,    // S11r1c1
                            `${baseName}_${stmtCode}${columnCode}`,   // S11_r1c1
                                `${baseName}${stmtCode}_${columnCode}`,   // S11r1_c1
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
                        <h3 className="text-lg font-semibold text-gray-900">{variable.name}</h3>
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
                        {variable.type?.toLowerCase().includes('numeric') && !variable.type?.toLowerCase().includes('grid') && (() => {
                          // Check if this is a numeric grid column variable (pattern: {questionNumber}_c{number})
                          const columnMatch = variable.name.match(/^([A-Z0-9]+)_(c\d+)$/i);
                          if (columnMatch) {
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
                            
                            // Debug: Find all variables that match this base name
                            const allBaseVariables = Object.keys(variableData).filter(k => k.startsWith(baseName));
                            console.log(`🔍 Checking column variable ${variable.name}:`, {
                              baseName,
                              columnCode,
                              allBaseVariables: allBaseVariables, // Show all
                              totalMatching: allBaseVariables.length,
                              variableDataKeys: Object.keys(variableData).filter(k => k.includes(baseName) && k.includes(columnCode)),
                              // Check main grid variable data
                              mainGridData: variableData[baseName] ? {
                                count: variableData[baseName].count,
                                hasFrequencies: !!variableData[baseName].frequencies,
                                frequenciesKeys: variableData[baseName].frequencies ? Object.keys(variableData[baseName].frequencies) : null,
                                hasValues: !!variableData[baseName].values,
                                valuesLength: variableData[baseName].values?.length
                              } : null,
                              // Sample of statement variable data
                              sampleStatementData: variableData[`${baseName}_r1`] ? {
                                count: variableData[`${baseName}_r1`].count,
                                hasFrequencies: !!variableData[`${baseName}_r1`].frequencies,
                                frequenciesKeys: variableData[`${baseName}_r1`].frequencies ? Object.keys(variableData[`${baseName}_r1`].frequencies) : null,
                                hasValues: !!variableData[`${baseName}_r1`].values,
                                valuesLength: variableData[`${baseName}_r1`].values?.length,
                                sum: variableData[`${baseName}_r1`].sum,
                                mean: variableData[`${baseName}_r1`].mean
                              } : null
                            });
                            
                            // Find the main grid variable to get statements
                            const mainGridVar = variables.find((v: any) => v.name === baseName && v.type?.toLowerCase().includes('numeric grid'));
                            
                            console.log(`🔍 Main grid variable for ${baseName}:`, {
                              found: !!mainGridVar,
                              hasStatements: mainGridVar && !!mainGridVar.statements,
                              statements: mainGridVar && mainGridVar.statements
                            });
                            
                            if (mainGridVar && mainGridVar.statements) {
                              // The data is likely stored in statement variables (S11_r1, S11_r2, etc.)
                              // Each statement variable should have frequencies keyed by column codes (c1, c2, c3)
                              // OR the data might be in cell variables (S11_r1_c1, S11_r1_c2, etc.)
                              
                              // Build table showing all statements (rows) for this column
                              const statementRows = Object.entries(mainGridVar.statements).map(([stmtCode, stmtText]) => {
                                let value: number | undefined = undefined;
                                
                                // Strategy 1: Check if statement variable exists (S11_r1) and has frequencies with column code
                                const statementVarName = `${baseName}_${stmtCode}`;
                                const statementVarData = variableData[statementVarName];
                                
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
                                
                                // Strategy 2: Try cell variable formats (S11_r1_c1, etc.)
                                if (value === undefined) {
                                  // Get mapped column name if available
                                  const mappedColumnName = columnMapping[variable.name];
                                  
                                  const cellVarNames = [
                                    `${baseName}_${stmtCode}_${columnCode}`,  // S11_r1_c1
                                    `${baseName}${stmtCode}${columnCode}`,    // S11r1c1
                                    `${baseName}_${stmtCode}${columnCode}`,   // S11_r1c1
                                    `${baseName}${stmtCode}_${columnCode}`,   // S11r1_c1
                                    // Also try with mapped column names if available
                                    mappedColumnName ? `${mappedColumnName.replace(/^Q/i, '')}_${stmtCode}_${columnCode}` : null,
                                    mappedColumnName ? `${mappedColumnName.replace(/^Q/i, '')}${stmtCode}${columnCode}` : null,
                                    mappedColumnName ? `${mappedColumnName}_${stmtCode}_${columnCode}` : null,
                                    mappedColumnName ? `${mappedColumnName}${stmtCode}${columnCode}` : null
                                  ].filter(Boolean) as string[];
                                  
                                  for (const cellVarName of cellVarNames) {
                                    const cellData = variableData[cellVarName];
                                    if (cellData) {
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
                                }
                                
                                // Strategy 3: Check if column variable exists (S11_c1) with statement codes as keys
                                if (value === undefined) {
                                  const columnVarData = variableData[variable.name];
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
                                
                                console.log(`🔍 Statement ${stmtCode} for column ${variable.name}:`, {
                                  statementVarName,
                                  statementVarData: statementVarData ? {
                                    count: statementVarData.count,
                                    hasFrequencies: !!statementVarData.frequencies,
                                    frequencies: statementVarData.frequencies,
                                    hasValues: !!statementVarData.values,
                                    valuesLength: statementVarData.values?.length,
                                    sum: statementVarData.sum,
                                    mean: statementVarData.mean,
                                    allKeys: Object.keys(statementVarData)
                                  } : null,
                                  columnCode,
                                  value: value
                                });
                                
                                return {
                                  code: stmtCode,
                                  text: stmtText,
                                  value: value
                                };
                              });
                              
                              console.log(`🔍 Statement rows for ${variable.name}:`, statementRows);
                              
                              // Check if any rows have data
                              const hasData = statementRows.some(row => row.value !== undefined);
                              console.log(`🔍 Has data for ${variable.name}:`, hasData);
                              
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
                          }
                          
                          return null;
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
                                      
                                      // Get the column variable data (e.g., S14_c1)
                                      const columnVarName = `${baseName}_${columnCode}`;
                                      const columnData = variableData[columnVarName];
                                      
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
                                            `${baseName}${stmtCode}${columnCode}`,    // S4r1c1 (row first, then column - preferred format)
                                            `${baseName}_${stmtCode}_${columnCode}`,  // S4_r1_c1
                                            `${baseName}${stmtCode}_${columnCode}`,   // S4r1_c1
                                            `${baseName}_${stmtCode}${columnCode}`,   // S4_r1c1
                                            `${baseName}${columnCode}${stmtCode}`,    // S4c1r1 (column first, then row - backward compatibility)
                                            `${baseName}_${columnCode}_${stmtCode}`,  // S4_c1_r1
                                            `${baseName}${columnCode}_${stmtCode}`,   // S4c1_r1
                                            `${baseName}_${columnCode}${stmtCode}`,   // S4_c1r1
                                          ];
                                          
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
                                      const rowDataArray: Array<{code: string; text: string; mean: number | undefined; sum: number | undefined}> = [];
                                      let totalSum = 0;
                                      let sumOfMeans = 0;
                                      
                                      Object.entries(variable.statements || {}).forEach(([stmtCode, stmtText]) => {
                                        const displayCode = stmtCode.replace(/^[rc]/i, '');
                                        
                                        // Try multiple strategies to get the mean for this row in this column
                                        // (Same strategies as used in the statement table for column variables)
                                        let mean: number | undefined = undefined;
                                        let sum: number | undefined = undefined;
                                        
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
                                        if (mean === undefined || sum === undefined) {
                                          const cellVarNames = [
                                            `${baseName}${stmtCode}${columnCode}`,    // S11r1c1 (row first, then column - preferred format)
                                            `${baseName}_${stmtCode}_${columnCode}`,  // S11_r1_c1
                                            `${baseName}${stmtCode}_${columnCode}`,   // S11r1_c1
                                            `${baseName}_${stmtCode}${columnCode}`,   // S11_r1c1
                                            `${baseName}${columnCode}${stmtCode}`,    // S11c1r5 (column first, then row - backward compatibility)
                                            `${baseName}_${columnCode}_${stmtCode}`,  // S11_c1_r5
                                            `${baseName}${columnCode}_${stmtCode}`,   // S11c1_r5
                                            `${baseName}_${columnCode}${stmtCode}`,   // S11_c1r5
                                          ];
                                          
                                          for (const cellVarName of cellVarNames) {
                                            const cellData = variableData[cellVarName];
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
                                          // Try to get sum from cell data
                                          const cellVarName = `${baseName}_${stmtCode}_${columnCode}`;
                                          const cellData = variableData[cellVarName];
                                          if (cellData && cellData.sum !== undefined) {
                                            sum = cellData.sum;
                                          } else if (statementVarData && statementVarData.sum !== undefined) {
                                            sum = statementVarData.sum;
                                          } else if (columnData && columnData.sum !== undefined) {
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
                                        rowDataArray.push({ code: stmtCode, text: stmtText, mean, sum });
                                      });
                                      
                                      // Second pass: render rows with percentages calculated using total sum
                                      const rows = rowDataArray.map(({ code: stmtCode, text: stmtText, mean, sum }) => {
                                        const displayCode = stmtCode.replace(/^[rc]/i, '');
                                        
                                        // Calculate percentage: (row sum / total sum of all rows) * 100
                                        const rowPercentage = totalSum > 0 && sum !== undefined 
                                          ? (sum / totalSum) * 100 
                                          : undefined;
                                        
                                        return (
                                          <tr key={stmtCode}>
                                            <td className="px-2 py-2 text-sm font-mono text-gray-700 text-center" style={{ width: '2.5rem' }}>{displayCode}</td>
                                            <td className="px-4 py-2 text-sm text-gray-900">{stmtText}</td>
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
                        {(() => {
                          // Debug logging for numeric grids
                          if (variable.type?.toLowerCase().includes('numeric grid') && !(variable as any).isSummaryTable) {
                            console.log(`🔍 Grid Table Check for ${variable.name}:`, {
                              hasStatements: !!variable.statements,
                              statementsCount: variable.statements ? Object.keys(variable.statements).length : 0,
                              statements: variable.statements,
                              hasCodes: !!variable.codes,
                              codesCount: variable.codes ? Object.keys(variable.codes).length : 0,
                              codes: variable.codes,
                              isSummaryTable: (variable as any).isSummaryTable,
                              willShow: variable.type?.toLowerCase().includes('numeric grid') && 
                                       variable.statements && 
                                       variable.codes && 
                                       Object.keys(variable.statements).length > 0 && 
                                       Object.keys(variable.codes).length > 0 && 
                                       !(variable as any).isSummaryTable
                            });
                          }
                          return false; // Don't render anything from this IIFE
                        })()}
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
                                      console.log(`[${variable.name}] Generating frequencies from values array (marked as numeric but has codes)`);
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
                                      console.log(`[${variable.name}] Generated frequencies:`, frequencies);
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
                                      
                                      // Debug logging to help identify matching issues (only log if no match found)
                                      if (count === 0 && variable.name && frequencies && Object.keys(frequencies).length > 0) {
                                        console.warn(`[${variable.name}] No match found for Code: "${code}", Label: "${label}"`);
                                        console.warn(`  Available frequency keys:`, Object.keys(frequencies));
                                        console.warn(`  Frequency values:`, Object.entries(frequencies).map(([k, v]) => `${k}: ${v}`).join(', '));
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
                                      
                                      const variableNames = variablesToMap.map(v => v.name);
                                      
                                      console.log(`📋 Filtered variables: ${variableNames.length} variables to map (from ${variables.length} total)`);
                                      
                                      const response = await fetch(`${API_BASE_URL}/api/questionnaire/map-columns`, {
                                        method: 'POST',
                                        headers: {
                                          'Authorization': `Bearer ${localStorage.getItem('cognitive_dash_token')}`,
                                          'Content-Type': 'application/json'
                                        },
                                        body: JSON.stringify({
                                          questionnaireId: selectedQuestionnaire.id,
                                          variableNames: variableNames,
                                          variables: variablesToMap, // Include full variable info with types
                                          dataHeaders: columnHeaders
                                        })
                                      });
                                      
                                      if (response.ok) {
                                        const result = await response.json();
                                        // Update the column mapping with the result
                                        if (result.mapping) {
                                          setColumnMapping(result.mapping);
                                        }
                                        // Update file info to show as processed
                                        setUploadedFileInfo({
                                          ...uploadedFileInfo,
                                          processed: true
                                        });
                                        // Reload file info to get latest status
                                        setTimeout(() => {
                                          loadFileInfo();
                                        }, 500);
                                      } else {
                                        const error = await response.json();
                                        console.error('Failed to map variables:', error.error || 'Unknown error');
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
                                      const response = await fetch(`${API_BASE_URL}/api/questionnaire/upload-data`, {
                                  method: 'POST',
                                  headers: {
                                          'Authorization': `Bearer ${localStorage.getItem('cognitive_dash_token')}`,
                                          'Content-Type': 'application/json'
                                        },
                                        body: JSON.stringify({
                                          questionnaireId: selectedQuestionnaire.id,
                                          columnMapping: columnMapping
                                        })
                                      });
                                      
                                      if (response.ok) {
                                        const result = await response.json();
                                        console.log('Data upload response:', result);
                                        console.log('Data from upload response:', {
                                          variableCount: result.data ? Object.keys(result.data).length : 0,
                                          sampleVariables: result.data ? Object.keys(result.data).slice(0, 5) : [],
                                          sampleData: result.data ? Object.entries(result.data).slice(0, 2).map(([key, val]: [string, any]) => ({
                                            variable: key,
                                            count: val?.count,
                                            hasFrequencies: !!val?.frequencies,
                                            numeric: val?.numeric
                                          })) : []
                                        });
                                        
                                        // Use the data directly from the response if available
                                        if (result.data && typeof result.data === 'object') {
                                          console.log('Setting variable data directly from upload response');
                                          setVariableData(result.data);
                                        }
                                        
                                        setDataUploaded(true);
                                        // Also reload processed data after a delay to ensure it's persisted
                                        setTimeout(() => {
                                          console.log('Reloading processed data after upload to verify persistence...');
                                          loadProcessedData();
                                          loadFileInfo();
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
                                  if (saveResponse.ok) {
                                    console.log('Column headers saved successfully:', parsedHeaders.length, 'headers');
                                  } else {
                                    console.error('Failed to save column headers');
                                  }
                                } catch (error) {
                                  console.error('Error saving column headers:', error);
                                  // Continue anyway - headers are already in state
                                }
                            } else {
                                console.warn('No column headers to save or no questionnaire selected');
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
                      
                  {uploadedFileInfo && (
                    <>
                      {/* Unmapped Questions Table */}
                      {(() => {
                        // Get unmapped questions
                        const unmappedQuestions = questionnaireQuestions.filter((question) => {
                          const questionNumber = question.number || question.id;
                          if (!questionNumber) return false;
                          
                          const questionType = question.type || '';
                          
                          // Debug logging for specific questions
                          const debugQuestion = questionNumber === 'A7' || questionNumber === 'S11';
                          if (debugQuestion) {
                            console.log(`🔍 [Unmapped Filter] Checking question ${questionNumber}:`, {
                              questionType,
                              columnMappingExists: questionNumber in columnMapping,
                              mappedColumn: columnMapping[questionNumber],
                              allMappingKeys: Object.keys(columnMapping).filter(k => k.includes(questionNumber)).slice(0, 10),
                              allMappingEntries: Object.entries(columnMapping).filter(([k, v]) => 
                                k.includes(questionNumber) || (typeof v === 'string' && v.includes(questionNumber))
                              ).slice(0, 10)
                            });
                          }
                          
                          // First, check if the main variable for this question is mapped
                          // Check exact match first
                          let mappedColumn = columnMapping[questionNumber] || '';
                          let isMapped = mappedColumn && mappedColumn.trim() !== '';
                          
                          // If not found, check for case-insensitive match
                          if (!isMapped) {
                            const matchingKey = Object.keys(columnMapping).find(k => 
                              k.toLowerCase() === questionNumber.toLowerCase()
                            );
                            if (matchingKey) {
                              mappedColumn = columnMapping[matchingKey] || '';
                              isMapped = mappedColumn && mappedColumn.trim() !== '';
                            }
                          }
                          
                          // If still not found, check if any mapping value contains the question number
                          // (e.g., if column header is "QA7 - Some text" and we're looking for A7)
                          if (!isMapped) {
                            const matchingEntry = Object.entries(columnMapping).find(([key, value]) => {
                              if (typeof value === 'string') {
                                // Check if the value (column header) starts with the question number
                                // or if the key starts with the question number
                                const valueNormalized = value.trim().toLowerCase();
                                const questionNormalized = questionNumber.toLowerCase();
                                return valueNormalized.startsWith(questionNormalized) || 
                                       valueNormalized.startsWith(`q${questionNormalized}`) ||
                                       key.toLowerCase() === questionNormalized;
                              }
                              return false;
                            });
                            if (matchingEntry) {
                              mappedColumn = matchingEntry[1] as string;
                              isMapped = mappedColumn && mappedColumn.trim() !== '';
                            }
                          }
                          
                          if (debugQuestion) {
                            console.log(`🔍 [Unmapped Filter] ${questionNumber} - isMapped:`, isMapped, 'mappedColumn:', mappedColumn);
                          }
                          
                          // If it's mapped, don't show as unmapped
                          if (isMapped) {
                            return false;
                          }
                          
                          // For numeric grids with both rows and columns, check if cell variables are mapped
                          // If cell variables exist and are mapped, don't show the base question as unmapped
                          const isNumericGrid = questionType.toLowerCase().includes('numeric grid');
                          const hasStatements = question.statementOptions && question.statementOptions.length > 0;
                          const hasResponseOptions = question.responseOptions && question.responseOptions.length > 0;
                          
                          if (isNumericGrid && hasStatements && hasResponseOptions) {
                            // Check if any cell variables are mapped (format: S11r1c1, S11r2c1, etc.)
                            const hasMappedCellVariables = Object.keys(columnMapping).some(varName => {
                              // Check if this variable name matches the pattern {questionNumber}r{number}c{number}
                              const cellVarPattern = new RegExp(`^${questionNumber.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}r\\d+c\\d+$`, 'i');
                              return cellVarPattern.test(varName) && columnMapping[varName] && columnMapping[varName].trim() !== '';
                            });
                            
                            if (debugQuestion) {
                              console.log(`🔍 [Unmapped Filter] ${questionNumber} - isNumericGrid with cell vars:`, hasMappedCellVariables);
                            }
                            
                            // If cell variables are mapped, don't show the base question
                            if (hasMappedCellVariables) {
                              return false;
                            }
                          }
                          
                          // For multiselect questions, check if all response option variables are mapped
                          const isMultiSelect = questionType.toLowerCase().includes('multi-select') && !questionType.toLowerCase().includes('grid');
                          if (isMultiSelect) {
                            // First, check if this question has been broken out into response variables
                            // (e.g., B8 -> B8r1, B8r2, etc.)
                            const hasResponseVariables = variables.some(v => {
                              const responseMatch = v.name.match(/^(.+?)r\d+$/i);
                              return responseMatch && responseMatch[1] === questionNumber;
                            });
                            
                            if (hasResponseVariables) {
                              // Question has been broken out into response variables (B8r1, B8r2, etc.)
                              // Don't show the main question (B8) in unmapped questions table
                              return false;
                            }
                            
                            // Not broken out yet, check using response options
                            const responseOptions = question?.responseOptions && Array.isArray(question.responseOptions) 
                              ? question.responseOptions 
                              : (question?.options && Array.isArray(question.options) ? question.options : []);
                            
                            if (responseOptions.length > 0) {
                              // Check if all response option variables are mapped
                              const allMapped = responseOptions.every((option: any, index: number) => {
                                const optionNumber = index + 1;
                                const varName1 = `${questionNumber}_${optionNumber}`;
                                const varName2 = `${questionNumber}_${String(optionNumber).padStart(2, '0')}`;
                                const varName3 = `${questionNumber}r${optionNumber}`;
                                const varName4 = `${questionNumber}-${optionNumber}`;
                                
                                return Object.keys(columnMapping).some(varName => {
                                  return (varName === varName1 || varName === varName2 || varName === varName3 || varName === varName4) &&
                                         columnMapping[varName] && columnMapping[varName].trim() !== '';
                                });
                              });
                              
                              // If all response variables are mapped, don't show this question
                              return !allMapped;
                            }
                          }
                          
                          // For grid questions (not numeric grids with cell variables - those are handled above)
                          // If any variable starting with questionNumber_ is mapped, consider it mapped
                          const isGridQuestion = questionType.toLowerCase().includes('grid') && !isNumericGrid;
                          if (isGridQuestion) {
                            const hasMappedGridVariable = Object.keys(columnMapping).some(varName => {
                              return varName.startsWith(`${questionNumber}_`) && columnMapping[varName] && columnMapping[varName].trim() !== '';
                            });
                            return !hasMappedGridVariable;
                          }
                          
                          // For all other questions (regular single select, etc.), show as unmapped if not mapped
                          if (debugQuestion) {
                            console.log(`🔍 [Unmapped Filter] ${questionNumber} - Final result: showing as unmapped`);
                          }
                          return true;
                        });

                        if (unmappedQuestions.length === 0) {
                          return null;
                        }

                        return (
                          <div className="mt-6 mb-6">
                            <div className="flex items-center justify-between mb-3">
                              <h4 className="text-sm font-semibold text-gray-900">
                                Unmapped Questions ({unmappedQuestions.length})
                              </h4>
                            </div>
                            <div className="border border-gray-200 rounded-lg overflow-hidden">
                              <div className="overflow-hidden">
                                <div style={{ maxHeight: 'calc(5 * 3.5rem + 3rem)', overflowY: 'auto', overflowX: 'hidden' }}>
                                  <table className="w-full divide-y divide-gray-200" style={{ tableLayout: 'fixed' }}>
                                    <thead className="bg-gray-50 sticky top-0 z-10">
                                      <tr>
                                        <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider whitespace-nowrap" style={{ width: '100px' }}>Question</th>
                                        <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider" style={{ width: 'auto' }}></th>
                                        <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider whitespace-nowrap" style={{ width: '180px' }}></th>
                                      </tr>
                                    </thead>
                                    <tbody className="bg-white divide-y divide-gray-200">
                                      {unmappedQuestions.map((question) => {
                                        const questionNumber = question.number || question.id;
                                        const selectedHeader = columnMapping[questionNumber] || '';

                                        return (
                                          <tr key={questionNumber}>
                                            <td className="px-4 py-3 text-xs font-medium text-gray-500 tracking-wider whitespace-nowrap" style={{ width: '100px' }}>
                                              {questionNumber}
                                            </td>
                                            <td className="px-4 py-3 text-xs font-medium text-gray-500 tracking-wider" style={{ width: 'auto' }}>
                                              <div className="truncate" title={question.text || ''}>
                                                {question.text || '-'}
                                              </div>
                                            </td>
                                          <td className="px-2 py-1 text-xs font-medium text-gray-500 tracking-wider text-right whitespace-nowrap" style={{ width: '180px' }}>
                                            <button
                                              type="button"
                                              onClick={() => {
                                                setSelectedQuestionForMapping(questionNumber);
                                                setColumnHeaderModalSearch('');
                                                setShowColumnHeaderModal(true);
                                              }}
                                              className="px-2 py-1 text-xs font-medium text-white rounded focus:outline-none focus:ring-2 focus:ring-orange-500 focus:ring-offset-1 transition-colors hover:opacity-90 whitespace-nowrap"
                                              style={{ backgroundColor: BRAND_ORANGE }}
                                            >
                                              Manually Map
                                            </button>
                                          </td>
                                          </tr>
                                        );
                                      })}
                                    </tbody>
                                  </table>
                                </div>
                              </div>
                            </div>
                          </div>
                        );
                      })()}
                      
                    <div className="mt-6 grid grid-cols-2 gap-6">
                      {/* Column Headers Table */}
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
                                          onClick={() => {
                                            setSelectedColumnHeader(header);
                                            setShowMappingModal(true);
                                            setSelectedVariableForMapping('');
                                          }}
                                          className={`cursor-pointer hover:bg-gray-50 transition-colors ${isMapped ? 'bg-green-50' : ''}`}
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

                      {/* QNR Mapping Table */}
                      <div className="flex flex-col">
                        <div className="flex items-center justify-between mb-3">
                          <h4 className="text-sm font-semibold text-gray-900">
                            QNR Mapping
                          </h4>
                        </div>
                        <div className="mb-3">
                          <div className="relative">
                            <MagnifyingGlassIcon className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-gray-400" />
                            <input
                              type="text"
                              placeholder="Search QNR variables..."
                              value={qnrVariableSearch}
                              onChange={(e) => setQnrVariableSearch(e.target.value)}
                              className="w-full pl-10 pr-4 py-2 text-sm border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-orange-500 focus:border-transparent"
                            />
                          </div>
                        </div>
                        <div className="border border-gray-200 rounded-lg overflow-hidden flex flex-col">
                          <div className="overflow-y-auto overflow-x-hidden" style={{ maxHeight: 'calc(10 * 3rem)' }}>
                            <table className="w-full divide-y divide-gray-200">
                              <thead className="bg-gray-50 sticky top-0 z-10">
                            <tr>
                                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider whitespace-nowrap">QNR Variable</th>
                                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider" style={{ width: '50%' }}>Column Header Match</th>
                                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider" style={{ width: '30%' }}></th>
                            </tr>
                          </thead>
                          <tbody className="bg-white divide-y divide-gray-200">
                                {variables.length > 0 ? (
                                  variables
                                    .filter((variable) => {
                                      // Filter out summary table variables
                                      if (variable.name.endsWith('_Summary Tables') || 
                                          variable.name.endsWith('_T2B') || 
                                          variable.name.endsWith('_B2B') || 
                                          variable.name.endsWith('_M3B') ||
                                          (variable as any).isSummaryTable) {
                                        return false;
                                      }
                                      
                                      // Apply search filter
                                      if (qnrVariableSearch.trim()) {
                                        const searchLower = qnrVariableSearch.toLowerCase();
                                        const matchesName = variable.name.toLowerCase().includes(searchLower);
                                        const matchesDescription = variable.description?.toLowerCase().includes(searchLower) || false;
                                        const mappedColumn = columnMapping[variable.name] || '';
                                        const matchesMappedColumn = mappedColumn.toLowerCase().includes(searchLower);
                                        if (!matchesName && !matchesDescription && !matchesMappedColumn) {
                                          return false;
                                        }
                                      }
                                      
                                      // Only show mapped variables
                                        const mappedColumn = columnMapping[variable.name] || '';
                                        const isMapped = mappedColumn && mappedColumn.trim() !== '';
                                      if (!isMapped) {
                                        return false;
                                      }
                                      
                                      return true;
                                    })
                                    .map((variable) => {
                                    const mappedColumn = columnMapping[variable.name] || '';
                                    const isMapped = mappedColumn && mappedColumn.trim() !== '';
                                    
                                    // Check if variable has data
                                    const varData = variableData[variable.name];
                                    
                                    // For summary tables (numeric grids), check if any child statement variables have data
                                    let hasData = false;
                                    if ((variable as any).isSummaryTable && variable.statements) {
                                      // For summary tables, extract base question number (remove "_Summary" suffix)
                                      let baseName = variable.name;
                                      if (variable.name.endsWith('_Summary')) {
                                        baseName = variable.name.replace('_Summary', '');
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
                                    } else {
                                      hasData = varData && (
                                        (varData.count && varData.count > 0) ||
                                        (varData.frequencies && Object.keys(varData.frequencies || {}).length > 0) ||
                                        (varData.values && Array.isArray(varData.values) && varData.values.length > 0)
                                      );
                                    }
                                  
                                  return (
                                      <tr key={variable.name}>
                                        <td className="px-4 py-3 text-xs font-medium text-gray-500 tracking-wider truncate whitespace-nowrap" style={{ width: 'auto' }} title={variable.name}>{variable.name}</td>
                                        <td className="px-4 py-3 text-xs font-medium text-gray-500 tracking-wider truncate" style={{ width: '50%' }} title={isMapped ? mappedColumn : '-'}>{isMapped ? mappedColumn : '-'}</td>
                                        <td className="px-4 py-3 text-xs font-medium text-gray-500 tracking-wider whitespace-nowrap text-right" style={{ width: '30%' }}>
                                          <div className="inline-flex items-center gap-2">
                                            {isMapped ? (
                                              <span className="inline-block text-xs font-medium rounded bg-green-100 text-green-800 text-center" style={{ width: '80px' }}>Mapped</span>
                                            ) : (
                                              <span className="inline-block text-xs font-medium rounded bg-gray-100 text-gray-600 text-center" style={{ width: '80px' }}>Unmapped</span>
                                            )}
                                            {hasData ? (
                                              <span className="inline-block text-xs font-medium rounded bg-green-100 text-green-800 text-center" style={{ width: '80px' }}>Has Data</span>
                                            ) : (
                                              <span className="inline-block text-xs font-medium rounded bg-red-100 text-red-800 text-center" style={{ width: '80px' }}>No Data</span>
                                            )}
                                          </div>
                                      </td>
                                    </tr>
                                  );
                                  })
                            ) : (
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
                    </div>
                    </>
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

      {/* Column Header Mapping Modal */}
      {showMappingModal && selectedColumnHeader && selectedQuestionnaire && createPortal(
        <div 
          className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50"
          onClick={(e) => {
            if (e.target === e.currentTarget) {
              setShowMappingModal(false);
              setSelectedColumnHeader(null);
              setSelectedVariableForMapping('');
            }
          }}
        >
          <div 
            className="bg-white rounded-lg shadow-xl max-w-md w-full mx-4 max-h-[80vh] flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="px-6 py-4 border-b border-gray-200 flex items-center justify-between">
              <h3 className="text-lg font-semibold text-gray-900">Map Column Header</h3>
              <button
                onClick={() => {
                  setShowMappingModal(false);
                  setSelectedColumnHeader(null);
                  setSelectedVariableForMapping('');
                }}
                className="text-gray-400 hover:text-gray-600"
              >
                <XMarkIcon className="h-5 w-5" />
              </button>
            </div>
            
            <div className="px-6 py-4 flex-1 overflow-y-auto">
              <div className="mb-4">
                <p className="text-sm text-gray-600 mb-2">
                  <span className="font-medium">Column Header:</span> {selectedColumnHeader}
                </p>
                <p className="text-sm text-gray-500">
                  Select a QNR variable to map this column header to:
                </p>
              </div>
              
              <div className="mb-4">
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  QNR Variable
                </label>
                <select
                  value={selectedVariableForMapping}
                  onChange={(e) => setSelectedVariableForMapping(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-orange-500 focus:border-transparent"
                >
                  <option value="">-- Select a variable --</option>
                  {variables
                    .filter((variable) => {
                      // Filter out summary table variables
                      if (variable.name.endsWith('_Summary Tables') || 
                          variable.name.endsWith('_T2B') || 
                          variable.name.endsWith('_B2B') || 
                          variable.name.endsWith('_M3B') ||
                          (variable as any).isSummaryTable) {
                        return false;
                      }
                      
                      // Only show unmapped variables
                      const mappedColumn = columnMapping[variable.name] || '';
                      return !mappedColumn || mappedColumn.trim() === '';
                    })
                    .map((variable) => (
                      <option key={variable.name} value={variable.name}>
                        {variable.name} {variable.description ? `- ${variable.description.split('\n')[0]}` : ''}
                      </option>
                    ))}
                </select>
              </div>
            </div>
            
            <div className="px-6 py-4 border-t border-gray-200 flex items-center justify-end gap-3">
              <button
                onClick={() => {
                  setShowMappingModal(false);
                  setSelectedColumnHeader(null);
                  setSelectedVariableForMapping('');
                }}
                className="px-4 py-2 text-sm font-medium text-gray-700 bg-gray-100 rounded-md hover:bg-gray-200 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={async () => {
                  if (!selectedVariableForMapping || !selectedColumnHeader || !selectedQuestionnaire) {
                    return;
                  }
                  
                  try {
                    // Update local state
                    const newMapping = {
                      ...columnMapping,
                      [selectedVariableForMapping]: selectedColumnHeader
                    };
                    setColumnMapping(newMapping);
                    
                    // Save to backend
                    const variableNames = variables.map(v => v.name);
                    const response = await fetch(`${API_BASE_URL}/api/questionnaire/map-columns`, {
                      method: 'POST',
                      headers: {
                        'Authorization': `Bearer ${localStorage.getItem('cognitive_dash_token')}`,
                        'Content-Type': 'application/json'
                      },
                      body: JSON.stringify({
                        questionnaireId: selectedQuestionnaire.id,
                        variableNames: variableNames,
                        dataHeaders: columnHeaders,
                        mapping: newMapping
                      })
                    });
                    
                    if (response.ok) {
                      const result = await response.json();
                      if (result.mapping) {
                        setColumnMapping(result.mapping);
                      }
                      // Reload file info to get latest status
                      setTimeout(() => {
                        loadFileInfo();
                      }, 500);
                    } else {
                      console.error('Failed to save mapping');
                      // Revert local state on error
                      setColumnMapping(columnMapping);
                    }
                    
                    setShowMappingModal(false);
                    setSelectedColumnHeader(null);
                    setSelectedVariableForMapping('');
                  } catch (error) {
                    console.error('Error saving mapping:', error);
                    // Revert local state on error
                    setColumnMapping(columnMapping);
                  }
                }}
                disabled={!selectedVariableForMapping}
                className="px-4 py-2 text-sm font-medium text-white rounded-md transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                style={{ backgroundColor: BRAND_ORANGE }}
              >
                Save Mapping
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
















































































