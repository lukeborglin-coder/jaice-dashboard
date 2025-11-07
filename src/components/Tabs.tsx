import React, { useState, useEffect, useMemo, useCallback } from 'react';
import {
  ArrowLeftIcon,
  MagnifyingGlassIcon,
  ArrowPathIcon,
  CloudArrowUpIcon,
  TrashIcon,
  XMarkIcon,
  InformationCircleIcon,
} from '@heroicons/react/24/outline';
import { IconTable } from '@tabler/icons-react';
import { API_BASE_URL } from '../config';
import { useAuth } from '../contexts/AuthContext';
import { useNavigate } from 'react-router-dom';
import * as XLSX from 'xlsx';

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
  const [qnrViewMode, setQnrViewMode] = useState<'variables' | 'data'>('variables');
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
  const [uploadingData, setUploadingData] = useState(false);
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
      
      // For numeric grids: mean summary table first, then main grid (if has responseOptions), then individual column variables (if has columns) or statement variables (if no columns)
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
        
        // Mean summary table first - shows means for each statement
        vars.push({
          name: `${questionNumber}_Mean Summary`,
          description: question.text || '',
          type: questionType,
          statements: statements,
          tags: question.tags || [],
          isSummaryTable: true,
          isScaleSummary: false
        });
        
        // If numeric grid has responseOptions (columns), create main grid variable to show both statements and response options
        if (codes && Object.keys(codes).length > 0) {
          console.log(`✅ Creating main grid variable for ${questionNumber} with both statements and codes:`, {
            statementsCount: Object.keys(statements).length,
            codesCount: Object.keys(codes).length,
            statements: statements,
            codes: codes
          });
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
        } else {
          // Debug: If no codes but we expect them for numeric grids, log it
          console.warn(`⚠️ Numeric Grid ${questionNumber} has no responseOptions/codes. Only statements found.`, {
            question: question,
            statements: statements,
            codes: codes,
            statementOptions: question.statementOptions,
            responseOptions: question.responseOptions,
            options: question.options
          });
        }
        
        processedQuestionNumbers.add(questionNumber);
        
        // For numeric grids with responseOptions (columns), create individual variables for each column
        // For numeric grids without responseOptions, create individual variables for each statement (row)
        if (codes && Object.keys(codes).length > 0) {
          // Create individual variables for each column (response option)
          Object.entries(codes).forEach(([responseCode, responseText]) => {
            const columnVarName = `${questionNumber}_${responseCode}`;
            vars.push({
              name: columnVarName,
              description: `${question.text || questionNumber} - ${responseText}`,
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
              description: `${question.text || questionNumber} - ${stmtText}`,
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
            description: `${question.text || questionNumber} - ${stmtText}`,
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
            description: `${question.text || questionNumber} - ${stmtText}`,
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
      // Regular questions (non-grid)
      else {
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
    if (!variableFilter) return variables;
    const filter = variableFilter.toLowerCase();
    return variables.filter(v => 
      v.name.toLowerCase().includes(filter) ||
      v.description?.toLowerCase().includes(filter)
    );
  }, [variables, variableFilter]);

  const variable = variables.find((v: any) => v.name === selectedVariable);

  return (
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
              <div className="w-80 border-r border-gray-200 overflow-y-auto">
                <div className="p-4 border-b border-gray-200">
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
                <div className="p-2">
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
                        
                        // For summary tables (numeric grids), check if any child statement variables have data
                        let hasData = false;
                        if ((v as any).isSummaryTable && v.statements) {
                          // For summary tables, extract base question number (remove "_Mean Summary" or "_Summary Tables" suffix)
                          let baseName = v.name;
                          if (v.name.endsWith('_Mean Summary')) {
                            baseName = v.name.replace('_Mean Summary', '');
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
                          hasData = varData && (
                            (varData.count && varData.count > 0) ||
                            (varData.frequencies && Object.keys(varData.frequencies || {}).length > 0) ||
                            (varData.values && Array.isArray(varData.values) && varData.values.length > 0)
                          );
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
                            <div className="flex items-center gap-2">
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

              {/* Variable Detail View */}
              <div className="flex-1 overflow-y-auto p-6">
              {selectedVariable ? (
                (() => {
                    const variable = variables.find((v: any) => v.name === selectedVariable);
                    if (!variable) {
                      return <div className="text-center py-12 text-gray-500">Variable not found</div>;
                    }
                  
                  const varData = variableData[variable.name];
                  
                  // For summary tables (numeric grids), check if any child statement variables have data
                  let hasData = false;
                  if ((variable as any).isSummaryTable && variable.statements) {
                    // Check if any of the child statement variables have data
                    // For summary tables, extract base question number (remove "_Mean Summary" or "_Summary Tables" suffix)
                    let baseName = variable.name;
                    if (variable.name.endsWith('_Mean Summary')) {
                      baseName = variable.name.replace('_Mean Summary', '');
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
                            `${baseName}${stmtCode}_${columnCode}`    // S11r1_c1
                          ];
                          
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
                    } else {
                      // Regular numeric variable, check direct data
                      hasData = varData && (
                        (varData.count && varData.count > 0) ||
                        (varData.frequencies && Object.keys(varData.frequencies || {}).length > 0) ||
                        (varData.values && Array.isArray(varData.values) && varData.values.length > 0)
                      );
                    }
                  } else {
                    // For regular variables, check the variable itself
                    hasData = varData && (
                      (varData.count && varData.count > 0) ||
                      (varData.frequencies && Object.keys(varData.frequencies || {}).length > 0) ||
                      (varData.values && Array.isArray(varData.values) && varData.values.length > 0)
                    );
                  }
                  
                  return (
                      <div className="space-y-6">
                        {/* Variable Header */}
                    <div>
                        <div className="flex items-center gap-2 flex-wrap">
                        <h3 className="text-lg font-semibold text-gray-900">{variable.name}</h3>
                          <span className="text-xs px-2 py-1 rounded text-white" style={{ backgroundColor: BRAND_ORANGE }}>
                          {variable.type || 'Unknown'}
                        </span>
                          {variable.tags && variable.tags.map((tag, idx) => (
                              <span
                              key={idx}
                              className="text-xs px-2 py-1 bg-gray-100 text-gray-700 rounded"
                              >
                                {tag}
                              </span>
                            ))}
                        </div>
                          {variable.description && (
                            <p className="text-sm text-gray-600 mt-1">
                              {formatDescriptionWithBrackets(variable.description)}
                            </p>
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
                                  const cellVarNames = [
                                    `${baseName}_${stmtCode}_${columnCode}`,  // S11_r1_c1
                                    `${baseName}${stmtCode}${columnCode}`,    // S11r1c1
                                    `${baseName}_${stmtCode}${columnCode}`,   // S11_r1c1
                                    `${baseName}${stmtCode}_${columnCode}`    // S11r1_c1
                                  ];
                                  
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
                          // 1. Numeric grid statement variables (name pattern: {questionNumber}_r{number}) - rows, not columns
                          // 2. Regular numeric questions (name pattern: just {questionNumber}, no underscore)
                          const isNumericGridRow = /^[A-Z0-9]+_r\d+$/i.test(variable.name);
                          const isRegularNumeric = /^[A-Z0-9]+$/i.test(variable.name) && !variable.name.includes('_');
                          
                          if (!isNumericGridRow && !isRegularNumeric) return null;
                          
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
                          
                          // Calculate mean and stdDev to identify outliers
                          const mean = varData.mean;
                          const stdDev = varData.stdDev || varData.stddev || varData.standardDeviation || varData.sd;
                          
                          // Sort by numeric value
                          const sortedFrequencies = Array.from(frequencyMap.entries())
                            .sort((a, b) => a[0] - b[0]);
                          
                          return (
                            <div className="mt-4 bg-white border border-gray-200 rounded-lg overflow-hidden">
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
                                    // Calculate total sum for numeric summary tables BEFORE rendering rows
                                    const hasNumberTag = (variable as any).tags && Array.isArray((variable as any).tags) && (variable as any).tags.includes('Number');
                                    let totalSumForPercentage = 0;
                                    
                                    if ((variable as any).isSummaryTable && !(variable as any).isScaleSummary && hasNumberTag) {
                                      // For mean summary tables, extract base question number (remove "_Mean Summary" suffix)
                                      const baseName = variable.name.endsWith('_Mean Summary') 
                                        ? variable.name.replace('_Mean Summary', '') 
                                        : variable.name;
                                      Object.keys(variable.statements || {}).forEach((stmtCode) => {
                                        const statementVarName = `${baseName}_${stmtCode}`;
                                        const statementData = variableData[statementVarName];
                                        if (statementData && statementData.sum !== undefined) {
                                          totalSumForPercentage += statementData.sum;
                                        }
                                      });
                                    }
                                    
                                    return Object.entries(variable.statements || {}).map(([code, text]) => {
                                  const displayCode = code.replace(/^[rc]/i, '');
                                  const hasNumberTag = (variable as any).tags && Array.isArray((variable as any).tags) && (variable as any).tags.includes('Number');
                                  const hasPercentTag = (variable as any).tags && Array.isArray((variable as any).tags) && (variable as any).tags.includes('%');
                                      
                                  return (
                                    <tr key={code}>
                                          <td className="px-2 py-2 text-sm font-mono text-gray-700 text-center" style={{ width: '2.5rem' }}>{displayCode}</td>
                                      <td className="px-4 py-2 text-sm text-gray-900">{text}</td>
                                          {(variable as any).isSummaryTable && !(variable as any).isScaleSummary && (() => {
                                            // For mean summary tables, extract base question number (remove "_Mean Summary" suffix)
                                            const baseName = variable.name.endsWith('_Mean Summary') 
                                              ? variable.name.replace('_Mean Summary', '') 
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
                                {(variable as any).isSummaryTable && !(variable as any).isScaleSummary &&
                                 (variable as any).tags && 
                                 Array.isArray((variable as any).tags) && 
                                 ((variable as any).tags.includes('Number') || (variable as any).tags.includes('%')) && (() => {
                                  const hasPercentTag = (variable as any).tags && Array.isArray((variable as any).tags) && (variable as any).tags.includes('%');
                                  const hasNumberTag = (variable as any).tags && Array.isArray((variable as any).tags) && (variable as any).tags.includes('Number');
                                  
                                  // For summary tables, extract base question number (remove "_Mean Summary" suffix)
                                  let baseName = variable.name;
                                  if (variable.name.endsWith('_Mean Summary')) {
                                    baseName = variable.name.replace('_Mean Summary', '');
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
                          // For mean summary tables, extract base question number (remove "_Mean Summary" suffix)
                          const baseName = variable.name.endsWith('_Mean Summary') 
                            ? variable.name.replace('_Mean Summary', '') 
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

                        {/* Response Options for categorical variables */}
                        {variable.codes && 
                         Object.keys(variable.codes).length > 0 && 
                         !variable.statements && 
                         !(variable as any).isSummaryTable && 
                         !variable.type?.toLowerCase().includes('numeric grid') && (
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
                                    const total = varData?.count || 0;
                                    
                                    // Calculate total count and sum of percentages by summing all frequencies
                                    let totalCount = 0;
                                    let totalPercentage = 0;
                                    
                                    // Helper function to get count for a code/label pair
                                    const getCount = (code: string, label: string): number => {
                                      let count = 0;
                                      let matchedKey: string | null = null;
                                      
                                      if (varData?.frequencies) {
                                        // Try exact code match first
                                        if (varData.frequencies[code] !== undefined) {
                                          count = varData.frequencies[code];
                                          matchedKey = code;
                                        }
                                        
                                        // If no match, try without prefix (c1 -> 1)
                                        if (count === 0) {
                                          const codeWithoutPrefix = code.replace(/^[rc]/i, '');
                                          if (varData.frequencies[codeWithoutPrefix] !== undefined) {
                                            count = varData.frequencies[codeWithoutPrefix];
                                            matchedKey = codeWithoutPrefix;
                                          }
                                        }
                                        
                                        // If still no match, try with prefix (1 -> c1, but only if code doesn't already have prefix)
                                        if (count === 0 && !code.match(/^[rc]/i)) {
                                          if (varData.frequencies[`c${code}`] !== undefined) {
                                            count = varData.frequencies[`c${code}`];
                                            matchedKey = `c${code}`;
                                          } else if (varData.frequencies[`r${code}`] !== undefined) {
                                            count = varData.frequencies[`r${code}`];
                                            matchedKey = `r${code}`;
                                          }
                                        }
                                        
                                        // If still no match, try matching by label text (case-insensitive, exact match only)
                                        // Only use label matching as a last resort and be very strict about it
                                        if (count === 0 && label) {
                                          const labelLower = String(label).toLowerCase().trim();
                                          
                                          // First try exact label match
                                          if (varData.frequencies[label] !== undefined) {
                                            count = varData.frequencies[label];
                                            matchedKey = label;
                                          } else {
                                            // Try case-insensitive exact match
                                            const exactMatchKey = Object.keys(varData.frequencies).find(key => 
                                              String(key).toLowerCase().trim() === labelLower
                                            );
                                            if (exactMatchKey) {
                                              count = varData.frequencies[exactMatchKey];
                                              matchedKey = exactMatchKey;
                                            }
                                          }
                                        }
                                      }
                                      
                                      // Fallback: If frequencies don't match, calculate from values array
                                      // Only match by exact label or code, not partial matches
                                      if (count === 0 && varData?.values && Array.isArray(varData.values) && label) {
                                        const labelLower = String(label).toLowerCase().trim();
                                        const codeWithoutPrefix = code.replace(/^[rc]/i, '');
                                        
                                        count = varData.values.filter((val: any) => {
                                          const valStr = String(val).toLowerCase().trim();
                                          // Try exact matches first
                                          return valStr === labelLower || 
                                                 valStr === codeWithoutPrefix ||
                                                 valStr === code.toLowerCase();
                                        }).length;
                                      }
                                      
                                      // Debug logging to help identify matching issues
                                      if (variable.name && varData?.frequencies && Object.keys(varData.frequencies).length > 0) {
                                        console.log(`[${variable.name}] Code: "${code}", Label: "${label}", Matched Key: "${matchedKey}", Count: ${count}`);
                                        console.log(`  Available frequency keys:`, Object.keys(varData.frequencies));
                                        console.log(`  Frequency values:`, Object.entries(varData.frequencies).map(([k, v]) => `${k}: ${v}`).join(', '));
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
                      )}
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
                    <div className="mt-6 grid grid-cols-2 gap-6">
                      {/* Column Headers Table */}
                      <div className="flex flex-col">
                        <h4 className="text-sm font-semibold text-gray-900 mb-3">
                          Column Headers ({columnHeaders.length} total)
                        </h4>
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
                                  columnHeaders.map((header, index) => (
                                    <tr key={index}>
                                      <td className="px-4 py-3 text-xs font-medium text-gray-500 tracking-wider" style={{ width: '3rem' }}>{index + 1}</td>
                                      <td className="px-4 py-3 text-xs font-medium text-gray-500 tracking-wider truncate" style={{ width: 'calc(100% - 3rem)' }} title={header}>{header}</td>
                                    </tr>
                                  ))
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
                        <h4 className="text-sm font-semibold text-gray-900 mb-3">
                          QNR Mapping
                  </h4>
                        <div className="border border-gray-200 rounded-lg overflow-hidden flex flex-col">
                        <table className="w-full divide-y divide-gray-200" style={{ tableLayout: 'fixed' }}>
                          <thead className="bg-gray-50">
                            <tr>
                                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider" style={{ width: '15%' }}>QNR Variable</th>
                                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider" style={{ width: '50%' }}>Column Header Match</th>
                                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider" style={{ width: '35%' }}></th>
                            </tr>
                          </thead>
                          </table>
                          <div className="overflow-y-auto overflow-x-hidden" style={{ maxHeight: 'calc(10 * 3rem)' }}>
                            <table className="w-full divide-y divide-gray-200" style={{ tableLayout: 'fixed' }}>
                          <tbody className="bg-white divide-y divide-gray-200">
                                {variables.length > 0 ? (
                                  variables.map((variable) => {
                                    const mappedColumn = columnMapping[variable.name] || '';
                                    const isMapped = mappedColumn && mappedColumn.trim() !== '';
                                    
                                    // Check if variable has data
                                    const varData = variableData[variable.name];
                                    
                                    // For summary tables (numeric grids), check if any child statement variables have data
                                    let hasData = false;
                                    if ((variable as any).isSummaryTable && variable.statements) {
                                      // For summary tables, extract base question number (remove "_Mean Summary" suffix)
                                      let baseName = variable.name;
                                      if (variable.name.endsWith('_Mean Summary')) {
                                        baseName = variable.name.replace('_Mean Summary', '');
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
                                        <td className="px-4 py-3 text-xs font-medium text-gray-500 tracking-wider truncate whitespace-nowrap" style={{ width: '15%' }} title={variable.name}>{variable.name}</td>
                                        <td className="px-4 py-3 text-xs font-medium text-gray-500 tracking-wider truncate" style={{ width: '50%' }} title={isMapped ? mappedColumn : '-'}>{isMapped ? mappedColumn : '-'}</td>
                                        <td className="px-4 py-3 text-xs font-medium text-gray-500 tracking-wider whitespace-nowrap text-right" style={{ width: '35%' }}>
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
                  )}
                      
              </div>
            </div>
          )}
          </div>
        </>
      )}
    </div>
  );
}















































