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

export default function Tabs({ projects = [], onNavigateToProject }: TabsProps) {
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
      let statements: Record<string, string> | undefined = undefined;
      if (question.statementOptions && Array.isArray(question.statementOptions)) {
        statements = {};
        question.statementOptions.forEach((stmt: any, idx: number) => {
          const code = typeof stmt === 'string' 
            ? (isNumericGrid ? `c${idx + 1}` : `r${idx + 1}`)
            : (stmt.code || (isNumericGrid ? `c${idx + 1}` : `r${idx + 1}`));
          const text = typeof stmt === 'string' ? stmt : stmt.text;
          if (statements) {
            statements[code] = text;
          }
        });
      }
      
      // Convert responseOptions to codes object
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
      
      // For numeric grids: summary table first, then individual statement variables
      if (isNumericGrid && statements && Object.keys(statements).length > 0) {
        // Summary table first
        vars.push({
                      name: questionNumber,
                      description: question.text || '',
          type: questionType,
                      statements: statements,
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
            type: 'Numeric',
            tags: question.tags || [],
            isSummaryTable: false,
            isScaleSummary: false
          });
        });
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
        
        // Then main grid variable
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
      // For other grids: main grid first, then individual statement variables
      else if (isGrid && statements && codes && Object.keys(statements).length > 0 && Object.keys(codes).length > 0) {
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
      const response = await fetch(`${API_BASE_URL}/api/questionnaire/${selectedQuestionnaire.id}/processed-data`, {
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
  useEffect(() => {
    if (questionnaireQuestions.length > 0) {
      console.log('Converting questions to variables:', questionnaireQuestions.length);
      convertQuestionsToVariables(questionnaireQuestions);
    }
  }, [questionnaireQuestions, variableData, convertQuestionsToVariables]);

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
          <div className="bg-white shadow-sm border border-gray-200 rounded-lg overflow-hidden">
            <div className="px-6 py-4 border-b border-gray-200 bg-gray-50">
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
                <h2 className="text-xl font-semibold text-gray-900">{selectedProject.name}</h2>
                <div></div>
              </div>
            </div>

            <div className="px-6 py-6">
              {questionnaires.length === 0 ? (
                <div className="text-center py-12">
                  <IconTable className="mx-auto mb-4 h-16 w-16 text-gray-300" />
                  <h3 className="text-lg font-semibold text-gray-900 mb-2">No QNRs found</h3>
                  <p className="text-gray-500">Upload data to a QNR to view tabs.</p>
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
                            {qnr.questions?.length || 0} questions
                          </p>
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
        <div className="bg-white shadow-sm border border-gray-200 rounded-lg overflow-hidden">
          <div className="px-6 py-4 border-b border-gray-200 bg-gray-50">
            <div className="flex items-center justify-between">
                <button
                  onClick={() => {
                    setViewMode('project');
                    setSelectedQuestionnaire(null);
                  setSelectedVariable(null);
                  }}
                  className="flex items-center gap-2 text-sm text-gray-600 hover:text-gray-800 hover:bg-gray-100 px-3 py-1 rounded-lg transition-colors"
                >
                  <ArrowLeftIcon className="h-4 w-4" />
                Back to QNRs
                </button>
                <h2 className="text-xl font-semibold text-gray-900">{selectedQuestionnaire.name}</h2>
              <div className="flex items-center gap-2">
                {/* View Mode Tabs */}
                <div className="flex items-center gap-1 bg-gray-100 rounded-lg p-1">
                <button
                    onClick={() => setQnrViewMode('variables')}
                    className={`px-4 py-2 text-sm font-medium rounded-md transition-colors ${
                      qnrViewMode === 'variables'
                        ? 'bg-white text-gray-900 shadow-sm'
                        : 'text-gray-600 hover:text-gray-900'
                    }`}
                >
                  Variables
                </button>
                <button
                    onClick={() => setQnrViewMode('data')}
                    className={`px-4 py-2 text-sm font-medium rounded-md transition-colors ${
                      qnrViewMode === 'data'
                        ? 'bg-white text-gray-900 shadow-sm'
                        : 'text-gray-600 hover:text-gray-900'
                    }`}
                >
                  Data
                </button>
            </div>
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
          </div>

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
                        const hasData = varData && (
                          (varData.count && varData.count > 0) ||
                          (varData.frequencies && Object.keys(varData.frequencies).length > 0) ||
                          (varData.values && Array.isArray(varData.values) && varData.values.length > 0)
                        );
                    
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
                  const hasData = varData && (
                    (varData.count && varData.count > 0) ||
                    (varData.frequencies && Object.keys(varData.frequencies).length > 0) ||
                    (varData.values && Array.isArray(varData.values) && varData.values.length > 0)
                  );
                  
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
                            <p className="text-sm text-gray-600 mt-1">{variable.description}</p>
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
                              return (
                                <div className="flex flex-wrap gap-4">
                                  <div className="flex-1 min-w-[120px] border border-gray-200 rounded-lg p-4 bg-white text-center">
                                    <p className="text-xs text-gray-500 mb-2">Mean</p>
                                    <p className="text-sm font-semibold text-gray-900">
                                      {varData?.mean !== undefined ? varData.mean.toFixed(2) : '-'}
                                    </p>
                                  </div>
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
                              );
                                  })()}
                              </div>
                            )}

                        {/* Summary Table for numeric grids */}
                        {(variable as any).isSummaryTable && variable.statements && (
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
                                      Object.keys(variable.statements || {}).forEach((stmtCode) => {
                                        const statementVarName = `${variable.name}_${stmtCode}`;
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
                                            const statementVarName = `${variable.name}_${code}`;
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
                                  
                                  let totalSum = 0;
                                  let totalCount = 0;
                                  let sumOfMeans = 0;
                                  let statementCount = 0;
                                  
                                  Object.keys(variable.statements || {}).forEach((stmtCode) => {
                                    const statementVarName = `${variable.name}_${stmtCode}`;
                                    const statementData = variableData[statementVarName];
                                    
                                    if (statementData) {
                                      if (statementData.sum !== undefined) {
                                        totalSum += statementData.sum;
                                      }
                                      if (statementData.count !== undefined) {
                                        totalCount += statementData.count;
                                      }
                                      if (statementData.mean !== undefined) {
                                        sumOfMeans += statementData.mean;
                                        statementCount++;
                                      }
                                    }
                                  });
                                  
                                  const totalMean = statementCount > 0 ? (sumOfMeans / statementCount) : undefined;
                                  
                                  return (
                                    <tr className="bg-gray-50 font-semibold border-t-2 border-gray-300">
                                      <td className="px-2 py-2 text-sm text-gray-900" colSpan={2}>Total</td>
                                      <td className="px-4 py-2 text-sm text-gray-900 text-center" style={{ width: '5rem' }}>
                                        {totalMean !== undefined 
                                          ? (hasPercentTag ? `${totalMean.toFixed(1)}%` : totalMean.toFixed(2))
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

                        {/* Response Options for categorical variables */}
                        {variable.codes && Object.keys(variable.codes).length > 0 && !(variable as any).isSummaryTable && (
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
                                  {Object.entries(variable.codes).map(([code, label]) => {
                                        const varData = variableData[variable.name];
                                    const count = varData?.frequencies?.[code] || 0;
                                    const total = varData?.count || 0;
                                    const percentage = total > 0 ? (count / total) * 100 : 0;
                                        
                                        return (
                                      <tr key={code}>
                                        <td className="px-2 py-2 text-sm font-mono text-gray-700 text-center" style={{ width: '2.5rem' }}>{code}</td>
                                        <td className="px-4 py-2 text-sm text-gray-900">{label}</td>
                                        <td className="px-4 py-2 text-sm text-gray-900 text-center" style={{ width: '5rem' }}>{count}</td>
                                        <td className="px-4 py-2 text-sm text-gray-900 text-center" style={{ width: '5rem' }}>{total > 0 ? `${percentage.toFixed(1)}%` : '-'}</td>
                                          </tr>
                                        );
                                      })}
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
                                          <table className="min-w-full divide-y divide-gray-200">
                                            <thead className="bg-gray-50">
                                              <tr>
                            <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">File Name</th>
                            <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Date Uploaded</th>
                            <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Mapped</th>
                            <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Uploaded</th>
                            <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Actions</th>
                                              </tr>
                                            </thead>
                                            <tbody className="bg-white divide-y divide-gray-200">
                          <tr>
                            <td className="px-4 py-3 text-sm text-gray-900 font-mono">{uploadedFileInfo.fileName}</td>
                            <td className="px-4 py-3 text-sm text-gray-500">
                              {new Date(uploadedFileInfo.uploadedAt).toLocaleDateString()} {new Date(uploadedFileInfo.uploadedAt).toLocaleTimeString()}
                                                  </td>
                            <td className="px-4 py-3 text-sm">
                              {uploadedFileInfo.processed ? (
                                <span className="px-2 py-1 text-xs font-medium rounded bg-green-100 text-green-800">Mapped</span>
                              ) : (
                                <button
                                  onClick={async () => {
                                    if (!selectedQuestionnaire || columnHeaders.length === 0 || variables.length === 0) {
                                      alert('Please ensure column headers and QNR variables are loaded');
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
                                        alert('Variables mapped successfully!');
                                      } else {
                                        const error = await response.json();
                                        alert(error.error || 'Failed to map variables');
                                      }
                                    } catch (error) {
                                      console.error('Error mapping variables:', error);
                                      alert('Failed to map variables. Please try again.');
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
                            </td>
                            <td className="px-4 py-3 text-sm">
                              {dataUploaded ? (
                                <span className="inline-flex items-center gap-1 px-2 py-1 text-xs font-medium rounded bg-green-100 text-green-800">
                                  Uploaded
                                            <button
                                              onClick={() => {
                                      if (!confirm('Are you sure you want to remove the uploaded data? You can upload it again using the button below.')) {
                                        return;
                                      }
                                      setDataUploaded(false);
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
                                      alert('Please select a questionnaire');
                                      return;
                                    }
                                    
                                    if (!uploadedFileInfo.processed || Object.keys(columnMapping).length === 0) {
                                      alert('Please map variables to QNR first');
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
                                        // Switch to variables view to see the data
                                        setQnrViewMode('variables');
                                        // Also reload processed data after a delay to ensure it's persisted
                                        setTimeout(() => {
                                          console.log('Reloading processed data after upload to verify persistence...');
                                          loadProcessedData();
                                          loadFileInfo();
                                        }, 2000);
                                        alert(`Data uploaded successfully! Processed ${result.rowsProcessed || 0} rows. You can now view the data in the Variables tab.`);
                                      } else {
                                        const error = await response.json();
                                        alert(error.error || 'Failed to upload data');
                                      }
                                    } catch (error) {
                                      console.error('Error uploading data:', error);
                                      alert('Failed to upload data. Please try again.');
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
                            </td>
                            <td className="px-4 py-3 text-sm">
                        <button
                          onClick={async () => {
                                    if (!selectedQuestionnaire) {
                                      alert('Please select a questionnaire');
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
                                        // Reset file input
                                        const fileInput = document.getElementById('data-file-upload') as HTMLInputElement;
                                        if (fileInput) fileInput.value = '';
                                        alert('Data file deleted successfully');
                                    } else {
                                        const error = await response.json();
                                        alert(error.error || 'Failed to delete data file');
                                      }
                                    } catch (error) {
                                      console.error('Error deleting data file:', error);
                                      alert('Failed to delete data file. Please try again.');
                                    }
                                  }}
                                  className="flex items-center gap-1 px-3 py-1.5 text-xs font-medium text-red-600 hover:text-red-700 hover:bg-red-50 rounded transition-colors"
                                  title="Delete data file permanently from server"
                                >
                                  <TrashIcon className="h-4 w-4" />
                                  Delete
                                </button>
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
                              alert(error.error || 'Failed to upload data file');
                            }
                          } catch (error) {
                            console.error('Error parsing headers or uploading file:', error);
                            alert('Failed to parse file headers or upload file. Please make sure the file is a valid Excel or CSV file.');
                          } finally {
                            setUploadingFile(false);
                          }
                        } else if (file && !selectedQuestionnaire) {
                          alert('Please select a questionnaire first');
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
                          <table className="min-w-full divide-y divide-gray-200">
                            <thead className="bg-gray-50">
                              <tr>
                                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider" style={{ width: '3rem' }}>#</th>
                                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Column Name</th>
                              </tr>
                            </thead>
                          </table>
                          <div className="overflow-y-auto" style={{ maxHeight: 'calc(10 * 3rem)' }}>
                            <table className="min-w-full divide-y divide-gray-200">
                              <tbody className="bg-white divide-y divide-gray-200">
                                {columnHeaders.length > 0 ? (
                                  columnHeaders.map((header, index) => (
                                    <tr key={index}>
                                      <td className="px-4 py-3 text-sm text-gray-500">{index + 1}</td>
                                      <td className="px-4 py-3 text-sm text-gray-900 font-mono truncate max-w-xs whitespace-nowrap" title={header}>{header}</td>
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
                        <table className="min-w-full divide-y divide-gray-200">
                          <thead className="bg-gray-50">
                            <tr>
                                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">QNR Variable</th>
                                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Column Header Match</th>
                                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Status</th>
                                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Data Status</th>
                            </tr>
                          </thead>
                          </table>
                          <div className="overflow-y-auto" style={{ maxHeight: 'calc(10 * 3rem)' }}>
                            <table className="min-w-full divide-y divide-gray-200">
                          <tbody className="bg-white divide-y divide-gray-200">
                                {variables.length > 0 ? (
                                  variables.map((variable) => {
                                    const mappedColumn = columnMapping[variable.name] || '';
                                    const isMapped = mappedColumn && mappedColumn.trim() !== '';
                                    
                                    // Check if variable has data
                                    const varData = variableData[variable.name];
                                    const hasData = varData && (
                                      (varData.count && varData.count > 0) ||
                                      (varData.frequencies && Object.keys(varData.frequencies).length > 0) ||
                                      (varData.values && Array.isArray(varData.values) && varData.values.length > 0)
                                    );
                                  
                                  return (
                                      <tr key={variable.name}>
                                        <td className="px-4 py-3 text-sm text-gray-900 font-mono truncate max-w-xs whitespace-nowrap" title={variable.name}>{variable.name}</td>
                                        <td className="px-4 py-3 text-sm text-gray-900 font-mono truncate max-w-xs whitespace-nowrap" title={isMapped ? mappedColumn : '-'}>{isMapped ? mappedColumn : '-'}</td>
                                        <td className="px-4 py-3 text-sm">
                                          {isMapped ? (
                                            <span className="px-2 py-1 text-xs font-medium rounded bg-green-100 text-green-800">Mapped</span>
                                          ) : (
                                            <span className="px-2 py-1 text-xs font-medium rounded bg-gray-100 text-gray-600">Unmapped</span>
                                        )}
                                      </td>
                                        <td className="px-4 py-3 text-sm">
                                          {hasData ? (
                                            <span className="px-2 py-1 text-xs font-medium rounded bg-green-100 text-green-800">Has Data</span>
                                          ) : (
                                            <span className="px-2 py-1 text-xs font-medium rounded bg-red-100 text-red-800">No Data</span>
                                        )}
                                      </td>
                                    </tr>
                                  );
                                  })
                            ) : (
                              <tr>
                                    <td colSpan={4} className="px-4 py-8 text-center text-sm text-gray-500">
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
      )}
    </div>
  );
}






















