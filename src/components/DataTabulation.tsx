import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { 
  ArrowUpTrayIcon, 
  DocumentArrowDownIcon,
  XMarkIcon,
  PlusIcon,
  TrashIcon,
  MagnifyingGlassIcon,
  CloudArrowUpIcon,
  DocumentTextIcon,
  FunnelIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  PlusCircleIcon,
  Cog6ToothIcon,
  InformationCircleIcon
} from '@heroicons/react/24/outline';
import { IconTable } from '@tabler/icons-react';
import { parseDataFile, getCodeLabel, type VariableDefinition, type ParsedDataFile } from '../utils/dataTabulationParser';
import { type BannerGroup, type BannerCut } from '../types/dataTabulation';
import BannerBuilder from './BannerBuilder';
import CrossTabDisplay from './CrossTabDisplay';
import { API_BASE_URL } from '../config';
import { useAuth } from '../contexts/AuthContext';
import * as XLSX from 'xlsx';

const BRAND_ORANGE = '#D14A2D';
const BRAND_BG = '#F7F7F8';
const BRAND_GRAY = '#5D5F62';

interface FrequencyTableRow {
  code: string;
  label: string;
  count: number;
  percentage: number;
}

interface FrequencyTable {
  variable: string;
  base: number;
  rows: FrequencyTableRow[];
  statementTables?: Array<{ statementNumber: string; statementLabel: string; variable: string; base: number; rows: FrequencyTableRow[] }>;
}

interface NetDefinition {
  id: string;
  variable: string;
  codes: string[];
}


interface DataTabulationProps {
  projects?: any[];
  onHeaderChange?: (header: string | null) => void;
}

interface SavedTabulation {
  id: string;
  projectId: string;
  projectName: string;
  name: string;
  description: string;
  parsedData: ParsedDataFile;
  bannerGroups?: BannerGroup[];
  selectedStubVariables?: Record<string, string>;
  hideInCrosstabs?: Record<string, boolean>;
  savedAt: string;
  savedBy: string;
}

export default function DataTabulation({ projects = [], onHeaderChange }: DataTabulationProps) {
  const { user } = useAuth();
  const [viewMode, setViewMode] = useState<'home' | 'project' | 'create' | 'viewer'>('home');
  const [activeTab, setActiveTab] = useState<'active' | 'archived'>('active');
  const [showMyProjectsOnly, setShowMyProjectsOnly] = useState(true);
  const [selectedProject, setSelectedProject] = useState<any | null>(null);
  const [savedTabulations, setSavedTabulations] = useState<SavedTabulation[]>([]);
  const [loading, setLoading] = useState(false);
  const [archivedProjects, setArchivedProjects] = useState<any[]>([]);
  
  // Create mode states
  const [uploadedFile, setUploadedFile] = useState<File | null>(null);
  const [parsedFile, setParsedFile] = useState<ParsedDataFile | null>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string>('');
  const [createFormData, setCreateFormData] = useState({ name: '' });
  
  // Viewer mode states
  const [currentTabulation, setCurrentTabulation] = useState<SavedTabulation | null>(null);
  const [selectedVariable, setSelectedVariable] = useState<string>('');
  const [frequencyTable, setFrequencyTable] = useState<FrequencyTable | null>(null);
  const [isGeneratingTable, setIsGeneratingTable] = useState(false);
  const baseCacheRef = useRef<Record<string, number>>({});
  const [variableFilter, setVariableFilter] = useState('');
  const [nets, setNets] = useState<NetDefinition[]>([]);
  const [showNetBuilder, setShowNetBuilder] = useState(false);
  const [sortOptions, setSortOptions] = useState<Record<string, 'qnr' | 'asc' | 'desc'>>({});
  const [hideOpenEnds, setHideOpenEnds] = useState(true);
  const [hideZeroBase, setHideZeroBase] = useState(false);
  const [showFilterDropdown, setShowFilterDropdown] = useState(false);
  const [showVariableOptions, setShowVariableOptions] = useState(false);
  const [hideZeroFrequencies, setHideZeroFrequencies] = useState<Record<string, boolean>>({});
  const [hideInCrosstabs, setHideInCrosstabs] = useState<Record<string, boolean>>({});
  const [activeSubTab, setActiveSubTab] = useState<'tables' | 'banners'>('tables');
  const [bannerGroups, setBannerGroups] = useState<BannerGroup[]>([]);
  const [showBannerBuilder, setShowBannerBuilder] = useState(false);
  const [editingBannerGroup, setEditingBannerGroup] = useState<BannerGroup | null>(null);
  const [selectedBannerGroupId, setSelectedBannerGroupId] = useState<string | null>(null);
  const [selectedStubVariables, setSelectedStubVariables] = useState<Record<string, string>>({}); // groupId -> variableName (empty string = 'Show all')
  const [debugVariable, setDebugVariable] = useState<VariableDefinition | null>(null);
  const [showDebugModal, setShowDebugModal] = useState(false);
  const [debugVariableName, setDebugVariableName] = useState<string>(''); // Track the actual variable name being debugged (e.g., QS13_1)

  // Close filter dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as Element;
      if (showFilterDropdown && !target.closest('[data-filter-dropdown]')) {
        setShowFilterDropdown(false);
      }
    };
    
    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [showFilterDropdown]);

  // Reset header when viewMode changes
  useEffect(() => {
    if (!onHeaderChange) return;
    
    if (viewMode === 'home') {
      onHeaderChange(null);
    } else if (viewMode === 'project' && selectedProject) {
      onHeaderChange(selectedProject.name);
    } else if (viewMode === 'viewer' && currentTabulation) {
      onHeaderChange(`${currentTabulation.name} • ${currentTabulation.parsedData.rowCount} respondents`);
    }
  }, [viewMode, selectedProject, currentTabulation, onHeaderChange]);

  // Load saved tabulations
  const loadSavedTabulations = useCallback(async () => {
    try {
      const response = await fetch(`${API_BASE_URL}/api/dataTabulation/saved`, {
        headers: { 'Authorization': `Bearer ${localStorage.getItem('cognitive_dash_token')}` }
      });
      if (response.ok) {
        const data = await response.json();
        setSavedTabulations(data);
      }
    } catch (error) {
      console.error('Error loading saved tabulations:', error);
    }
  }, []);

  useEffect(() => {
    loadSavedTabulations();
    // Load archived projects
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
  }, [loadSavedTabulations, user?.id]);

  // Filter for quantitative projects
  const isQuantitative = (project: any) => {
    const methodology = project?.methodologyType?.toLowerCase();
    if (!methodology) {
      return false; // Default to false if no methodology
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

  // Check for project navigation from Project Hub
  useEffect(() => {
    try {
      const storedProjectId = sessionStorage.getItem('cognitive_dash_data_tabulation_focus_project');
      const storedViewMode = sessionStorage.getItem('cognitive_dash_data_tabulation_view_mode');
      
      if (storedProjectId && projects.length > 0 && !selectedProject) {
        const project = [...filteredActiveProjects, ...filteredArchivedProjects].find(p => p.id === storedProjectId);
        if (project) {
          setSelectedProject(project);
          if (storedViewMode === 'project') {
            setViewMode('project');
            // Update header to project name
            if (onHeaderChange) {
              onHeaderChange(project.name);
            }
          }
          // Clear sessionStorage after using it
          sessionStorage.removeItem('cognitive_dash_data_tabulation_focus_project');
          sessionStorage.removeItem('cognitive_dash_data_tabulation_view_mode');
        }
      }
    } catch (error) {
      console.warn('Unable to read data tabulation navigation target', error);
    }
  }, [projects, filteredActiveProjects, filteredArchivedProjects, selectedProject, onHeaderChange]);

  // Handle file upload
  const handleFileUpload = useCallback(async (file: File | null) => {
    if (!file) {
      setParsedFile(null);
      return;
    }

    if (!file.name.toLowerCase().endsWith('.xlsx')) {
      setError('Please upload an Excel file (.xlsx)');
      return;
    }

    setUploading(true);
    setError('');

    try {
      const parsed = await parseDataFile(file);
      setParsedFile(parsed);
      setUploadedFile(file);
    } catch (err: any) {
      setError(err.message || 'Failed to parse file');
      setParsedFile(null);
    } finally {
      setUploading(false);
    }
  }, []);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      handleFileUpload(e.target.files[0]);
    }
  };

  const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      handleFileUpload(e.dataTransfer.files[0]);
    }
  };

  const handleDragOver = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
  };

  // Save tabulation
  const handleSaveTabulation = async () => {
    if (!parsedFile || !selectedProject) {
      setError('Please upload a file');
      return;
    }

    setUploading(true);
    try {
      const response = await fetch(`${API_BASE_URL}/api/dataTabulation/save`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${localStorage.getItem('cognitive_dash_token')}`
        },
        body: JSON.stringify({
          projectId: selectedProject.id,
          projectName: selectedProject.name || 'Unknown Project',
          name: createFormData.name || 'Untitled Tabulation',
          description: '',
          parsedData: parsedFile,
          bannerGroups: bannerGroups,
          selectedStubVariables: selectedStubVariables,
          hideInCrosstabs: hideInCrosstabs
        })
      });

      if (response.ok) {
        await loadSavedTabulations();
        setViewMode('project');
        setParsedFile(null);
        setUploadedFile(null);
        setCreateFormData({ name: '' });
        // Update header back to project name
        if (onHeaderChange && selectedProject) {
          onHeaderChange(selectedProject.name);
        }
      } else {
        const errorData = await response.json();
        setError(errorData.error || 'Failed to save tabulation');
      }
    } catch (err: any) {
      setError(err.message || 'Failed to save tabulation');
    } finally {
      setUploading(false);
    }
  };

  // Load tabulation
  const loadTabulation = (tabulation: SavedTabulation) => {
    setCurrentTabulation(tabulation);
    setParsedFile(tabulation.parsedData);
    setBannerGroups(tabulation.bannerGroups || []);
    setSelectedStubVariables(tabulation.selectedStubVariables || {});
    setHideInCrosstabs(tabulation.hideInCrosstabs || {});
    setViewMode('viewer');
  };

  // Save banner groups to existing tabulation
  const saveBannerGroups = useCallback(async () => {
    if (!currentTabulation) return;

    try {
      const response = await fetch(`${API_BASE_URL}/api/dataTabulation/${currentTabulation.id}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${localStorage.getItem('cognitive_dash_token')}`
        },
        body: JSON.stringify({
          ...currentTabulation,
          bannerGroups: bannerGroups,
          selectedStubVariables: selectedStubVariables,
          hideInCrosstabs: hideInCrosstabs
        })
      });

      if (response.ok) {
        const updated = await response.json();
        setCurrentTabulation(updated);
        await loadSavedTabulations();
      }
    } catch (error) {
      console.error('Error saving banner groups:', error);
    }
  }, [currentTabulation, bannerGroups, selectedStubVariables, hideInCrosstabs, loadSavedTabulations]);

  // Auto-save banner groups when they change
  useEffect(() => {
    if (currentTabulation && viewMode === 'viewer') {
      // Don't auto-save on initial load
      const hasExistingBannerGroups = currentTabulation.bannerGroups && currentTabulation.bannerGroups.length > 0;
      if (!hasExistingBannerGroups && bannerGroups.length === 0) {
        return;
      }

      const timeoutId = setTimeout(() => {
        saveBannerGroups();
      }, 1000); // Debounce: save 1 second after last change

      return () => clearTimeout(timeoutId);
    }
  }, [bannerGroups, selectedStubVariables, hideInCrosstabs, currentTabulation?.id, viewMode, saveBannerGroups]);

  // Delete tabulation
  const deleteTabulation = async (id: string) => {
    if (!confirm('Are you sure you want to delete this tabulation?')) return;
    
    try {
      const response = await fetch(`${API_BASE_URL}/api/dataTabulation/${id}`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${localStorage.getItem('cognitive_dash_token')}` }
      });
      
      if (response.ok) {
        await loadSavedTabulations();
        if (currentTabulation?.id === id) {
          setViewMode('project');
          setCurrentTabulation(null);
          // Update header back to project name
          if (onHeaderChange && selectedProject) {
            onHeaderChange(selectedProject.name);
          }
        }
      }
    } catch (error) {
      console.error('Error deleting tabulation:', error);
    }
  };

  // Generate frequency table
  const generateFrequencyTable = useCallback(async () => {
    if (!parsedFile || !selectedVariable) {
      setFrequencyTable(null);
      setIsGeneratingTable(false);
      return;
    }
    
    // Loading state should already be set by the useEffect
    // Record start time to ensure minimum loading time of 1 second
    const startTime = Date.now();
    
    // Use setTimeout to allow UI to update before heavy computation
    await new Promise(resolve => setTimeout(resolve, 50));

    interface MatchResult {
      code: string;
      similarity: number;
    }

    const counts: Record<string, number> = {};
    let base = 0;

    // Check if this is a statement variable (e.g., QS13_1)
    const statementMatch = selectedVariable.match(/^(.+)_(\d+)$/);
    let variableDef: VariableDefinition | undefined;
    let parentVarName: string | undefined;
    let statementNum: string | undefined;
    
    if (statementMatch) {
      // This is a statement variable - get the parent variable
      [, parentVarName, statementNum] = statementMatch;
      variableDef = parsedFile.variables.find(v => v.name === parentVarName);
    } else {
      // Regular variable
      variableDef = parsedFile.variables.find(v => v.name === selectedVariable);
    }

    const allCodes = variableDef && (variableDef.type === 'categorical' || variableDef.type === 'multi-select' || 
                                    variableDef.type === 'grid' || variableDef.type === 'grid-single-select' || 
                                    variableDef.type === 'grid-multi-select')
      ? Object.keys(variableDef.codes)
      : [];

    // Initialize all codes with 0 count
    if (allCodes.length > 0) {
      allCodes.forEach(code => {
        counts[code] = 0;
      });
    }

    // Build a reverse lookup map: label -> code (for faster matching)
    // For multi-select, also create a map from column name patterns to codes
    const labelToCodeMap = new Map<string, string>();
    const columnLabelToCodeMap = new Map<string, string>(); // For multi-select: column label -> code
    
    if (variableDef && (variableDef.type === 'categorical' || variableDef.type === 'multi-select' || 
                       variableDef.type === 'grid' || variableDef.type === 'grid-single-select' || 
                       variableDef.type === 'grid-multi-select')) {
      Object.keys(variableDef.codes).forEach(code => {
        const label = variableDef.codes[code];
        if (label) {
          // Store normalized label as key, code as value
          const normalizedLabel = label.trim().toLowerCase();
          labelToCodeMap.set(normalizedLabel, code);
          
          // For multi-select, also store variations (all caps, title case, etc.)
          if (variableDef.type === 'multi-select') {
            // Store all variations for better matching
            columnLabelToCodeMap.set(normalizedLabel, code);
            columnLabelToCodeMap.set(label.trim().toUpperCase(), code); // All caps
            columnLabelToCodeMap.set(label.trim(), code); // Original case
            // Also try title case
            const titleCase = label.trim().split(/\s+/).map(word => 
              word.charAt(0).toUpperCase() + word.slice(1).toLowerCase()
            ).join(' ');
            columnLabelToCodeMap.set(titleCase.toLowerCase(), code);
          }
        }
      });
      
      // Debug: log the mapping for troubleshooting
      console.log(`Label to Code Map for "${selectedVariable}":`, Array.from(labelToCodeMap.entries()));
      console.log(`Defined codes:`, Object.keys(variableDef.codes));
      console.log(`Code definitions:`, variableDef.codes);
    }

    // Count occurrences in data
    // Handle different question types differently
    // IMPORTANT: Check for statement variables FIRST, before grid type checks
    // This is because statement variables (e.g., QS13_1) need special handling
    if (statementMatch && variableDef && statementNum) {
      // Check if this is a grid type that supports statements with response codes
      const gridType = variableDef.type as string;
      const isSingleSelectGrid = gridType === 'grid-single-select' || gridType === 'grid';
      const isMultiSelectGrid = gridType === 'grid-multi-select';
      
      if (isSingleSelectGrid) {
      // Handle statement variables (e.g., QS13_1) for single-select grids
      const statementLabel = (variableDef as any).statements?.[statementNum];
      if (statementLabel && parentVarName) {
        // Find the column that matches this statement
        const prefix = `${parentVarName} - `;
        const normalizedStatementLabel = String(statementLabel).toLowerCase();
        
        // Find matching column once (outside loop)
        let matchingColumn: string | null = null;
        if (parsedFile.data.length > 0) {
          const firstRow = parsedFile.data[0];
          
          // First try exact match
          matchingColumn = Object.keys(firstRow).find(colName => {
            if (colName.startsWith(prefix)) {
              let colLabel = colName.substring(prefix.length).trim();
              
              // Handle format: "Statement(sample: ResponseLabel)" or "Statement - ResponseLabel"
              // Extract just the statement part before "(sample:" or before " - "
              const parenMatch = colLabel.match(/^(.+?)\s*\(sample:/i);
              if (parenMatch) {
                colLabel = parenMatch[1].trim();
              } else {
                // Check for format with dashes (might be "Statement - ResponseLabel")
                // But we only want to split if there's a response code/label after
                // For now, try to match the full label first
                const dashParts = colLabel.split(' - ');
                // If it looks like "Statement - Response", try matching just the statement part
                // But be careful - the statement itself might contain " - "
                // So we'll try to match the longest possible statement match
                if (dashParts.length > 1) {
                  // Try matching with each possible statement part
                  for (let i = 1; i <= dashParts.length; i++) {
                    const potentialStatement = dashParts.slice(0, i).join(' - ').trim();
                    if (potentialStatement.toLowerCase() === normalizedStatementLabel) {
                      colLabel = potentialStatement;
                      break;
                    }
                  }
                }
              }
              
              // Column should match the statement (case-insensitive)
              return colLabel.toLowerCase() === normalizedStatementLabel;
            }
            return false;
          }) || null;
          
          // If exact match failed, try fuzzy matching (contains check)
          if (!matchingColumn) {
            matchingColumn = Object.keys(firstRow).find(colName => {
              if (colName.startsWith(prefix)) {
                let colLabel = colName.substring(prefix.length).trim();
                
                // Extract statement part
                const parenMatch = colLabel.match(/^(.+?)\s*\(sample:/i);
                if (parenMatch) {
                  colLabel = parenMatch[1].trim();
                }
                
                // Check if statement label is contained in column label or vice versa
                const normalizedColLabel = colLabel.toLowerCase();
                return normalizedColLabel.includes(normalizedStatementLabel) || 
                       normalizedStatementLabel.includes(normalizedColLabel);
              }
              return false;
            }) || null;
          }
          
          console.log(`[${selectedVariable}] Looking for statement "${statementLabel}" (normalized: "${normalizedStatementLabel}")`);
          console.log(`[${selectedVariable}] Available columns starting with "${prefix}":`, 
            Object.keys(firstRow).filter(col => col.startsWith(prefix)));
        }
        
        if (!matchingColumn) {
          console.warn(`[${selectedVariable}] No matching column found for statement "${statementLabel}"`);
        }
        
        if (matchingColumn) {
          console.log(`[${selectedVariable}] Found matching column: "${matchingColumn}" for statement "${statementLabel}"`);
          
          // Count responses for this statement
          let rowCount = 0;
          parsedFile.data.forEach(row => {
            const value = row[matchingColumn!];
            if (value !== null && value !== undefined && value !== '') {
              base++;
              const codeStr = String(value);
              // Log first 5 rows for debugging
              if (rowCount < 5) {
                console.log(`[${selectedVariable}] Row ${rowCount + 1} value: "${codeStr}"`);
              }
              rowCount++;
              
              // The value might be a label or a code - try to match it
              // First try exact code match
              if (counts.hasOwnProperty(codeStr)) {
                counts[codeStr] = (counts[codeStr] || 0) + 1;
              } else {
                // Try matching as a label
                const normalizedValue = codeStr.trim().toLowerCase();
                if (labelToCodeMap.has(normalizedValue)) {
                  const matchedCode = labelToCodeMap.get(normalizedValue)!;
                  counts[matchedCode] = (counts[matchedCode] || 0) + 1;
                  console.log(`[${selectedVariable}] Mapped label "${codeStr}" to code "${matchedCode}"`);
                } else {
                  // Try fuzzy matching
                  let bestMatch: MatchResult | null = null;
                  labelToCodeMap.forEach((code, normalizedLabel) => {
                    if (normalizedValue.includes(normalizedLabel) || normalizedLabel.includes(normalizedValue)) {
                      const similarity = Math.min(normalizedValue.length, normalizedLabel.length) / Math.max(normalizedValue.length, normalizedLabel.length);
                      if (!bestMatch || similarity > bestMatch.similarity) {
                        bestMatch = { code, similarity };
                      }
                    } else {
                      // Check word overlap
                      const valueWords = normalizedValue.split(/\s+/);
                      const labelWords = normalizedLabel.split(/\s+/);
                      const commonWords = valueWords.filter(w => labelWords.includes(w));
                      if (commonWords.length > 0) {
                        const maxWords = Math.max(valueWords.length, labelWords.length);
                        const similarity = commonWords.length / maxWords;
                        if (!bestMatch || similarity > bestMatch.similarity) {
                          bestMatch = { code, similarity };
                        }
                      }
                    }
                  });
                  
                  if (bestMatch !== null) {
                    const match = bestMatch as MatchResult;
                    if (match.similarity > 0.5) {
                      counts[match.code] = (counts[match.code] || 0) + 1;
                      console.log(`[${selectedVariable}] Fuzzy matched "${codeStr}" to code "${match.code}" (similarity: ${(match.similarity * 100).toFixed(1)}%)`);
                    }
                  } else {
                    // If no match, count as-is (might be a code we don't recognize)
                    counts[codeStr] = (counts[codeStr] || 0) + 1;
                    console.warn(`[${selectedVariable}] No match found for "${codeStr}" in column "${matchingColumn}"`);
                  }
                }
              }
            }
          });
          
          console.log(`[${selectedVariable}] Processed ${rowCount} rows with values. Base: ${base}. Counts:`, counts);
        } else {
          console.warn(`[${selectedVariable}] Cannot process data - no matching column found`);
        }
      } else if (isMultiSelectGrid) {
        // Handle statement variables (e.g., QS5_1) for multi-select grids
        const statementLabel = (variableDef as any).statements?.[statementNum];
        if (statementLabel && parentVarName) {
          // For multi-select grids, find all columns that match this statement
          // Format: "QS5 - Statement - ResponseOption" with values 0 or 1
          const prefix = `${parentVarName} - `;
          const normalizedStatementLabel = String(statementLabel).toLowerCase();
          
          // Find all columns for this statement
          const multiSelectColumns: Array<{ columnName: string; optionLabel: string }> = [];
          if (parsedFile.data.length > 0) {
            const firstRow = parsedFile.data[0];
            
            Object.keys(firstRow).forEach(colName => {
              if (colName.startsWith(prefix)) {
                // Extract the statement and option from column name
                // Format: "QS5 - Statement - Option" or "QS5 - Statement (sample: Option)"
                let colLabel = colName.substring(prefix.length).trim();
                
                // Check for format with parentheses: "Statement (sample: Option)"
                let statementPart = colLabel;
                let optionPart: string | null = null;
                
                const parenMatch = colLabel.match(/^(.+?)\s*\(sample:\s*(.+?)\)$/i);
                if (parenMatch) {
                  statementPart = parenMatch[1].trim();
                  optionPart = parenMatch[2].trim();
                } else {
                  // Check for format with dashes: "Statement - Option"
                  const dashParts = colLabel.split(' - ');
                  if (dashParts.length >= 2) {
                    // Try to match the statement part
                    // The statement might be the first part or multiple parts
                    // We need to find where the statement ends and the option begins
                    for (let i = 1; i <= dashParts.length; i++) {
                      const potentialStatement = dashParts.slice(0, i).join(' - ').trim();
                      if (potentialStatement.toLowerCase() === normalizedStatementLabel) {
                        statementPart = potentialStatement;
                        optionPart = dashParts.slice(i).join(' - ').trim();
                        break;
                      }
                    }
                  }
                }
                
                // Check if this column matches the statement
                if (statementPart.toLowerCase() === normalizedStatementLabel && optionPart) {
                  multiSelectColumns.push({
                    columnName: colName,
                    optionLabel: optionPart
                  });
                }
              }
            });
          }
          
          console.log(`[${selectedVariable}] Found ${multiSelectColumns.length} columns for statement "${statementLabel}"`);
          console.log(`[${selectedVariable}] Columns:`, multiSelectColumns.map(c => c.columnName));
          
          // Count base (respondents who saw this question)
          base = parsedFile.data.length;
          
          // Count how many checked each option
          parsedFile.data.forEach(row => {
            multiSelectColumns.forEach(({ columnName, optionLabel }) => {
              const value = row[columnName];
              if (value === 1 || value === '1') {
                // Match the option label to the code definitions
                // Try multiple normalization strategies for better matching
                const normalizedLabel = optionLabel.trim().toLowerCase();
                const upperLabel = optionLabel.trim().toUpperCase();
                const titleLabel = optionLabel.trim().split(/\s+/).map(word => 
                  word.charAt(0).toUpperCase() + word.slice(1).toLowerCase()
                ).join(' ').toLowerCase();
                
                // Try exact match first (case-insensitive)
                let matchingCode = labelToCodeMap.get(normalizedLabel) || 
                                  columnLabelToCodeMap.get(normalizedLabel) ||
                                  columnLabelToCodeMap.get(upperLabel) ||
                                  columnLabelToCodeMap.get(titleLabel);
                
                // If exact match fails, try fuzzy matching
                if (!matchingCode) {
                  let bestMatch: MatchResult | null = null as MatchResult | null;
                  
                  labelToCodeMap.forEach((code, normalizedCodeLabel) => {
                    // Check if one contains the other (case-insensitive)
                    if (normalizedCodeLabel.includes(normalizedLabel) || normalizedLabel.includes(normalizedCodeLabel)) {
                      const similarity = Math.min(normalizedLabel.length, normalizedCodeLabel.length) / Math.max(normalizedLabel.length, normalizedCodeLabel.length);
                      if (!bestMatch || similarity > bestMatch.similarity) {
                        bestMatch = { code, similarity };
                      }
                    } else {
                      // Also check for word overlap
                      const labelWords = normalizedLabel.split(/\s+/).filter(w => w.length > 0);
                      const codeWords = normalizedCodeLabel.split(/\s+/).filter(w => w.length > 0);
                      const commonWords = labelWords.filter(w => codeWords.includes(w));
                      if (commonWords.length > 0) {
                        const maxWords = Math.max(labelWords.length, codeWords.length);
                        const similarity = commonWords.length / maxWords;
                        if (!bestMatch || similarity > bestMatch.similarity) {
                          bestMatch = { code, similarity };
                        }
                      }
                    }
                  });
                  
                  if (bestMatch && bestMatch.similarity > 0.5) {
                    const match = bestMatch as MatchResult;
                    matchingCode = match.code;
                    console.log(`[${selectedVariable}] Fuzzy matched "${optionLabel}" to code "${matchingCode}" (similarity: ${(match.similarity * 100).toFixed(1)}%)`);
                  }
                }
                
                if (matchingCode) {
                  counts[matchingCode] = (counts[matchingCode] || 0) + 1;
                } else {
                  // Log when we can't match - this helps debug issues
                  console.warn(`[${selectedVariable}] Could not match multi-select option label "${optionLabel}" from column "${columnName}" to any code definition. Available codes:`, Array.from(labelToCodeMap.entries()));
                }
              }
            });
          });
          
          console.log(`[${selectedVariable}] Processed multi-select grid statement. Base: ${base}. Counts:`, counts);
        }
      }
      }
    } else if (variableDef?.type === 'multi-select') {
      // For multi-select: find all columns that start with "variableName - "
      // Each column represents one option, values are 0 (unchecked) or 1 (checked)
      const multiSelectColumns: Array<{ columnName: string; optionLabel: string }> = [];

      // Find all columns for this multi-select question
      if (parsedFile.data.length > 0) {
        const firstRow = parsedFile.data[0];
        const prefix = `${selectedVariable} - `;
        Object.keys(firstRow).forEach(colName => {
          if (colName.startsWith(prefix)) {
            const optionLabel = colName.substring(prefix.length).trim();
            multiSelectColumns.push({ columnName: colName, optionLabel });
          }
        });
      }

      // Count base (respondents who saw this question)
      base = parsedFile.data.length;

      // Count how many checked each option
      parsedFile.data.forEach(row => {
        multiSelectColumns.forEach(({ columnName, optionLabel }) => {
          const value = row[columnName];
          if (value === 1 || value === '1') {
            // Match the option label to the code definitions
            // Try multiple normalization strategies for better matching
            const normalizedLabel = optionLabel.trim().toLowerCase();
            const upperLabel = optionLabel.trim().toUpperCase();
            const titleLabel = optionLabel.trim().split(/\s+/).map(word => 
              word.charAt(0).toUpperCase() + word.slice(1).toLowerCase()
            ).join(' ').toLowerCase();
            
            // Try exact match first (case-insensitive)
            let matchingCode = labelToCodeMap.get(normalizedLabel) || 
                              columnLabelToCodeMap.get(normalizedLabel) ||
                              columnLabelToCodeMap.get(upperLabel) ||
                              columnLabelToCodeMap.get(titleLabel);
            
            // If exact match fails, try fuzzy matching
            if (!matchingCode) {
              let bestMatch: MatchResult | null = null as MatchResult | null;
              
              labelToCodeMap.forEach((code, normalizedCodeLabel) => {
                // Check if one contains the other (case-insensitive)
                if (normalizedCodeLabel.includes(normalizedLabel) || normalizedLabel.includes(normalizedCodeLabel)) {
                  const similarity = Math.min(normalizedLabel.length, normalizedCodeLabel.length) / Math.max(normalizedLabel.length, normalizedCodeLabel.length);
                  if (!bestMatch || similarity > bestMatch.similarity) {
                    bestMatch = { code, similarity };
                  }
                } else {
                  // Also check for word overlap
                  const labelWords = normalizedLabel.split(/\s+/).filter(w => w.length > 0);
                  const codeWords = normalizedCodeLabel.split(/\s+/).filter(w => w.length > 0);
                  const commonWords = labelWords.filter(w => codeWords.includes(w));
                  if (commonWords.length > 0) {
                    const maxWords = Math.max(labelWords.length, codeWords.length);
                    const similarity = commonWords.length / maxWords;
                    if (!bestMatch || similarity > bestMatch.similarity) {
                      bestMatch = { code, similarity };
                    }
                  }
                }
              });
              
              if (bestMatch && bestMatch.similarity > 0.5) {
                const match = bestMatch as MatchResult;
                matchingCode = match.code;
                console.log(`[${selectedVariable}] Fuzzy matched "${optionLabel}" to code "${matchingCode}" (similarity: ${(match.similarity * 100).toFixed(1)}%)`);
              }
            }
            
            if (matchingCode) {
              counts[matchingCode] = (counts[matchingCode] || 0) + 1;
            } else {
              // Log when we can't match - this helps debug issues
              console.warn(`[${selectedVariable}] Could not match multi-select option label "${optionLabel}" from column "${columnName}" to any code definition. Available codes:`, Array.from(labelToCodeMap.entries()));
              console.warn(`[${selectedVariable}] Code definitions:`, variableDef?.codes);
            }
          }
        });
      });
    } else if (variableDef?.type === 'grid' || variableDef?.type === 'grid-numeric' || variableDef?.type === 'grid-verbatim' || 
               variableDef?.type === 'grid-single-select' || variableDef?.type === 'grid-multi-select') {
      // For grid: find all columns that start with "variableName - "
      // Grid can have multiple types:
      // 1. Numeric grid: Each column is a statement, values are numeric counts/amounts
      // 2. Verbatim grid: Each column is a statement, values are text
      // 3. Single Select Grid: Each column is a statement, values are response codes (1, 2, 3, etc.), one per statement
      // 4. Multi-Select Grid: Each column is a statement-row combination, values are 0-1 (checked/unchecked)
      
      const gridColumns: Array<{ columnName: string; statementLabel: string; responseCode?: string; responseLabel?: string }> = [];
      const hasResponseCodes = variableDef.codes && Object.keys(variableDef.codes).length > 0;
      const isNumericGrid = variableDef.type === 'grid-numeric';
      const isVerbatimGrid = variableDef.type === 'grid-verbatim';
      const isSingleSelectGrid = variableDef.type === 'grid-single-select';
      const isMultiSelectGrid = variableDef.type === 'grid-multi-select';

      // Find all columns for this grid question
      if (parsedFile.data.length > 0) {
        const firstRow = parsedFile.data[0];
        const prefix = `${selectedVariable} - `;
        Object.keys(firstRow).forEach(colName => {
          if (colName.startsWith(prefix)) {
            // For single-select grids, columns may have format:
            // "QS13 - Statement - ResponseLabel" or "QS13 - Statement (sample: ResponseLabel)"
            // For numeric/verbatim grids, columns are just "QS4 - Statement" or "QS4 - Statement (sample: 65)"
            let statementLabel = colName.substring(prefix.length).trim();
            let responseCode: string | null = null;
            let responseLabel: string | null = null;
            
            // For numeric/verbatim grids, strip out "(sample: ...)" if present
            if (isNumericGrid || isVerbatimGrid) {
              const sampleMatch = statementLabel.match(/^(.+?)\s*\(sample:\s*.+?\)$/i);
              if (sampleMatch) {
                statementLabel = sampleMatch[1].trim();
              }
            }
            
            if (isSingleSelectGrid || isMultiSelectGrid) {
              // For single-select and multi-select grids, parse the response part
              // Check for format with parentheses: "Statement (sample: ResponseLabel)"
              const parenMatch = statementLabel.match(/^(.+?)\s*\(sample:\s*(.+?)\)$/i);
              if (parenMatch) {
                statementLabel = parenMatch[1].trim();
                responseLabel = parenMatch[2].trim();
                // Try to match response label to a code
                if (variableDef.codes) {
                                    const matchedCode = Object.entries(variableDef.codes).find(
                                      ([code, label]) => responseLabel && String(label).trim().toLowerCase() === responseLabel.toLowerCase()
                                    );
                  if (matchedCode) {
                    responseCode = matchedCode[0];
                  }
                }
              } else {
                // Check for format with dashes: "Statement - ResponseLabel" or "Statement - ResponseCode"
                const parts = statementLabel.split(' - ');
                if (parts.length >= 2) {
                  // Last part might be response code or label
                  const lastPart = parts[parts.length - 1].trim();
                  statementLabel = parts.slice(0, -1).join(' - ').trim();
                  
                  // Check if last part is a numeric code
                  if (/^\d+$/.test(lastPart)) {
                    responseCode = lastPart;
                    responseLabel = variableDef.codes?.[lastPart] || null;
                  } else {
                    // Last part is likely a label
                    responseLabel = lastPart;
                    // Try to match to a code
                    if (variableDef.codes) {
                      const matchedCode = Object.entries(variableDef.codes).find(
                        ([code, label]) => String(label).trim().toLowerCase() === lastPart.toLowerCase()
                      );
                      if (matchedCode) {
                        responseCode = matchedCode[0];
                      }
                    }
                  }
                }
              }
            }
            
            // Try to match to defined statements if available
            let matchedStatement = statementLabel;
            if (variableDef.statements) {
              // Try to find matching statement by comparing labels
              const statementEntries = Object.entries(variableDef.statements);
              const matchingStatement = statementEntries.find(([num, stmt]) => {
                const normalizedStmt = String(stmt).trim().toLowerCase();
                const normalizedLabel = statementLabel.trim().toLowerCase();
                return normalizedStmt === normalizedLabel || 
                       normalizedLabel.includes(normalizedStmt) || 
                       normalizedStmt.includes(normalizedLabel);
              });
              if (matchingStatement) {
                matchedStatement = matchingStatement[1];
              }
            }
            
            gridColumns.push({ 
              columnName: colName, 
              statementLabel: matchedStatement,
              responseCode: responseCode || undefined,
              responseLabel: responseLabel || undefined
            });
          }
        });
      }

      if (isSingleSelectGrid && hasResponseCodes) {
        // Single Select Grid: Create a separate frequency table for each statement
        // Each statement gets its own table showing response code frequencies
        // We'll generate statement tables separately below in the post-processing section
        base = parsedFile.data.length;
      } else if (isMultiSelectGrid && hasResponseCodes) {
        // Multi-Select Grid: Similar to regular multi-select but with statements
        // Each statement can have multiple responses checked (0-1 values)
        base = parsedFile.data.length;
        
      parsedFile.data.forEach(row => {
          gridColumns.forEach(({ columnName, statementLabel }) => {
            const value = row[columnName];
            if (value === 1 || value === '1') {
              // Find which response code this column represents
              // Multi-select grids might have columns like "QS5 - Statement 1 - Option 1"
              // For now, we'll need to parse the column name structure
              // This is more complex and may need refinement based on actual data structure
              const columnParts = columnName.split(' - ');
              if (columnParts.length >= 3) {
                // Format: "QS5 - Statement - Option"
                const optionLabel = columnParts.slice(2).join(' - ');
                // Match to response codes
                Object.entries(variableDef.codes).forEach(([code, label]) => {
                  if (label.toLowerCase() === optionLabel.toLowerCase()) {
                    counts[code] = (counts[code] || 0) + 1;
                  }
                });
              }
            }
          });
        });
      } else if (isNumericGrid) {
        // Numeric grid: Show statements with aggregated statistics
        // Each statement becomes a row showing sum, mean, etc.
        
        // Use the gridColumns array which has already matched statements from column names
        // This handles cases where datamap statements (e.g., "[QA2r1c1]") don't match column names (e.g., "QA2 - Unable to walk at all")
        // The gridColumns parsing already extracts statement labels from column names and matches them to datamap statements
        const allStatementColumns = new Map<string, string>();
        
        // Build a map from matched statement text (from datamap) to column names
        // gridColumns already has the matchedStatement which is the datamap statement text
        gridColumns.forEach(({ columnName, statementLabel }) => {
          // statementLabel here is the matched statement from the datamap (after fuzzy matching)
          if (statementLabel) {
            allStatementColumns.set(statementLabel, columnName);
          }
        });
        
        // Also create a reverse map: datamap statement text -> column name
        // This ensures we can look up columns by the statement text from variableDef.statements
        const datamapStatementToColumn = new Map<string, string>();
        gridColumns.forEach(({ columnName, statementLabel }) => {
          if (statementLabel) {
            datamapStatementToColumn.set(statementLabel, columnName);
          }
        });
        
        // Collect values for each statement, but only count rows where all statements have values
        // This ensures means sum to 100% for percentage grids
        if (variableDef.statements) {
          const statementValuesMap = new Map<string, number[]>();
          Object.entries(variableDef.statements).forEach(([statementNum, statementText]) => {
            const statementLabel = String(statementText);
            statementValuesMap.set(statementLabel, []);
          });
          
          // Count rows with complete data for base calculation
          // Base = respondents who saw the question (have at least one statement with data)
          let rowsWithAnyData = 0;
          let completeDataRows = 0;
          
          // Process data: only include rows where all statements have valid values for statistics
          // But check if respondent saw the question (has at least one value)
          parsedFile.data.forEach(row => {
            // First check if respondent saw the question (has at least one statement with data)
            let hasAnyData = false;
            let hasCompleteData = true;
            const rowValues = new Map<string, number>();
            
            for (const [statementLabel, columnName] of allStatementColumns.entries()) {
              const value = row[columnName];
          if (value !== null && value !== undefined && value !== '') {
                const numValue = typeof value === 'number' ? value : parseFloat(String(value));
                if (!isNaN(numValue)) {
                  hasAnyData = true; // Respondent saw the question
                  rowValues.set(statementLabel, numValue);
                } else {
                  hasCompleteData = false;
                }
              } else {
                hasCompleteData = false;
              }
            }
            
            // Count in base if respondent saw the question (has at least one value)
            if (hasAnyData) {
              rowsWithAnyData++;
            }
            
            // Only add values to statistics if row has complete data for all statements
            if (hasCompleteData) {
              completeDataRows++;
              for (const [statementLabel, value] of rowValues.entries()) {
                statementValuesMap.get(statementLabel)?.push(value);
              }
            }
          });
          
          // Update base to only count rows where respondent saw the question (has at least one value)
          base = rowsWithAnyData;
          
          // Now create rows for each statement
          Object.entries(variableDef.statements).forEach(([statementNum, statementText]) => {
            const statementLabel = String(statementText);
            const statementValues = statementValuesMap.get(statementLabel) || [];
            
            // Always create a row for each statement, even if no data
            // Use statement label as the "code" for display purposes
            const statementKey = statementLabel;
            counts[statementKey] = statementValues.length;
            
            // Store additional stats in a special format for display
            // We'll use a special prefix to indicate this is a statement row
            const sum = statementValues.reduce((a, b) => a + b, 0);
            const mean = statementValues.length > 0 ? sum / statementValues.length : 0;
            const max = statementValues.length > 0 ? Math.max(...statementValues) : 0;
            const min = statementValues.length > 0 ? Math.min(...statementValues) : 0;
            
            // Store stats in a way we can access later
            (counts as any)[`__STATS_${statementKey}`] = {
              sum,
              mean,
              max,
              min,
              count: statementValues.length
            };
          });
        } else {
          // Fallback: if no statements defined, use columns found (old behavior)
          gridColumns.forEach(({ columnName, statementLabel }) => {
            const statementValues: number[] = [];
            
            parsedFile.data.forEach(row => {
              const value = row[columnName];
              if (value !== null && value !== undefined && value !== '') {
                const numValue = typeof value === 'number' ? value : parseFloat(String(value));
                if (!isNaN(numValue)) {
                  statementValues.push(numValue);
                }
              }
            });
            
            if (statementValues.length > 0) {
              // Use statement label as the "code" for display purposes
              const statementKey = statementLabel;
              counts[statementKey] = statementValues.length;
              
              // Store additional stats in a special format for display
              // We'll use a special prefix to indicate this is a statement row
              const sum = statementValues.reduce((a, b) => a + b, 0);
              const mean = sum / statementValues.length;
              const max = Math.max(...statementValues);
              const min = Math.min(...statementValues);
              
              // Store stats in a way we can access later
              (counts as any)[`__STATS_${statementKey}`] = {
                sum,
                mean,
                max,
                min,
                count: statementValues.length
              };
            }
          });
        }
      } else if (isVerbatimGrid) {
        // Verbatim grid: Show statements with response counts (text responses)
        // Each statement becomes a row showing response count
        base = parsedFile.data.length;
        
        gridColumns.forEach(({ columnName, statementLabel }) => {
          let responseCount = 0;
          
          parsedFile.data.forEach(row => {
            const value = row[columnName];
            if (value !== null && value !== undefined && value !== '') {
              const strValue = String(value).trim();
              if (strValue.length > 0) {
                responseCount++;
              }
            }
          });
          
          if (responseCount > 0) {
            const statementKey = statementLabel;
            counts[statementKey] = responseCount;
            
            // Store count for verbatim grids
            (counts as any)[`__STATS_${statementKey}`] = {
              count: responseCount
            };
          }
        });
      }
    } else {
      // For categorical/single-select: original logic
      parsedFile.data.forEach(row => {
        // Try exact match first
        let value = row[selectedVariable];
        // If key doesn't exist, try case-insensitive match
        if (!(selectedVariable in row)) {
          const matchingKey = Object.keys(row).find(
            key => key.trim().toLowerCase() === selectedVariable.trim().toLowerCase()
          );
          if (matchingKey) {
            value = row[matchingKey];
          }
        }
        if (value !== null && value !== undefined && value !== '') {
          base++;
          const codeStr = String(value);

          // Try exact code match first (if data contains codes like "1", "2", "3")
          if (counts.hasOwnProperty(codeStr)) {
            counts[codeStr] = (counts[codeStr] || 0) + 1;
          } else {
            const normalizedValue = codeStr.trim().toLowerCase();
            if (labelToCodeMap.has(normalizedValue)) {
              // Check if it's a label that matches a defined code label
              // Map the label to its numeric code
              const matchedCode = labelToCodeMap.get(normalizedValue)!;
              counts[matchedCode] = (counts[matchedCode] || 0) + 1;
              // IMPORTANT: Do NOT add the label string itself to counts

              // Debug logging
              console.log(`[${selectedVariable}] Mapped label "${codeStr}" to code "${matchedCode}"`);
            } else {
              // Try fuzzy/partial matching - check if the value contains or is contained in any label
              let bestMatch: MatchResult | null = null as MatchResult | null;

              labelToCodeMap.forEach((code, normalizedLabel) => {
                const value = normalizedValue;
                const label = normalizedLabel;

                // Check if one contains the other (case-insensitive)
                if (value.includes(label) || label.includes(value)) {
                  const similarity = Math.min(value.length, label.length) / Math.max(value.length, label.length);
                  if (!bestMatch || similarity > bestMatch.similarity) {
                    bestMatch = { code, similarity };
                  }
                } else {
                  // Also check for word overlap (split by spaces and check if any words match)
                  const valueWords = value.split(/\s+/);
                  const labelWords = label.split(/\s+/);
                  const commonWords = valueWords.filter(w => labelWords.includes(w));
                  if (commonWords.length > 0) {
                    // Calculate similarity based on common words
                    const maxWords = Math.max(valueWords.length, labelWords.length);
                    const similarity = commonWords.length / maxWords;
                    if (!bestMatch || similarity > bestMatch.similarity) {
                      bestMatch = { code, similarity };
                    }
                  }
                }
              });

              if (bestMatch && bestMatch.similarity > 0.5) {
                // If we found a reasonable match (at least 50% similarity), use it
                const match = bestMatch as MatchResult;
                counts[match.code] = (counts[match.code] || 0) + 1;
                console.log(`[${selectedVariable}] Fuzzy matched "${codeStr}" to code "${match.code}" (similarity: ${(match.similarity * 100).toFixed(1)}%)`);
              } else {
                // If no match found, it's an unexpected value - still count it as-is
                counts[codeStr] = (counts[codeStr] || 0) + 1;

                // Debug logging
                console.log(`[${selectedVariable}] No match found for "${codeStr}" in label map. Available labels:`, Array.from(labelToCodeMap.keys()));
              }
            }
          }
        }
      });
    }

    // Create rows from all codes (definition codes first, then any extra codes from data)
    // Exclude label strings that correspond to defined codes (they've been mapped)
    const allCodeKeys = [...allCodes];
    
    // Build set of label strings that correspond to defined codes
    const labelStrings = new Set<string>();
    if (variableDef && (variableDef.type === 'categorical' || variableDef.type === 'multi-select' || 
                       variableDef.type === 'grid' || variableDef.type === 'grid-single-select' || 
                       variableDef.type === 'grid-multi-select')) {
      Object.values(variableDef.codes).forEach(label => {
        if (label) {
          labelStrings.add(label.trim().toLowerCase());
        }
      });
    }
    
    // Add any codes from counts that aren't already in allCodeKeys
    // BUT exclude:
    // 1. Label strings that match defined code labels (they've been mapped to codes)
    // 2. Any string values that aren't numeric codes (for categorical variables, we only want defined codes)
    Object.keys(counts).forEach(key => {
      const normalizedKey = key.trim().toLowerCase();
      const isLabelString = labelStrings.has(normalizedKey);
      
      // For categorical variables, only include:
      // - Defined numeric codes (already in allCodes)
      // - String values that match defined labels (already mapped, so skip)
      // - For non-categorical or undefined variables, include everything
      
      if (variableDef && (variableDef.type === 'categorical' || variableDef.type === 'multi-select' || 
                         variableDef.type === 'grid' || variableDef.type === 'grid-single-select' || 
                         variableDef.type === 'grid-multi-select') && allCodes.length > 0) {
        // For categorical with defined codes, only show defined codes
        // Don't add unmatched string values
        if (!allCodeKeys.includes(key) && !isLabelString) {
          // Only add if it's a numeric string that might be a valid code
          // or if it's not a label string
          const isNumeric = /^\d+$/.test(key.trim());
          if (!isNumeric) {
            // Skip non-numeric strings that don't match labels (unmatched values)
            return;
          }
          allCodeKeys.push(key);
        }
      } else {
        // For non-categorical or undefined, include everything except mapped labels
        if (!allCodeKeys.includes(key) && !isLabelString) {
          allCodeKeys.push(key);
        }
      }
    });

    // Check if this is a numeric or verbatim grid (no response codes, but has statements)
    const isNumericGrid = variableDef?.type === 'grid-numeric';
    const isVerbatimGrid = variableDef?.type === 'grid-verbatim';
    const isSingleSelectGrid = variableDef?.type === 'grid-single-select';
    const isOpenEndedGrid = isNumericGrid || isVerbatimGrid;
    
    let rows: FrequencyTableRow[] = [];
    
    if (isOpenEndedGrid) {
      // For numeric and verbatim grids, show statements with statistics or counts
      const statementKeys = Object.keys(counts).filter(key => !key.startsWith('__STATS_'));
      
      statementKeys.forEach(statementKey => {
        const stats = (counts as any)[`__STATS_${statementKey}`];
        if (stats) {
          if (isVerbatimGrid) {
            // Verbatim grid: show response count
            rows.push({
              code: statementKey,
              label: statementKey, // Statement label is the "label"
              count: stats.count, // Show response count
              percentage: base > 0 ? (stats.count / base) * 100 : 0 // Show response rate as percentage
            });
          } else {
            // Numeric grid: show sum as count
            rows.push({
              code: statementKey,
              label: statementKey, // Statement label is the "label"
              count: stats.sum, // Show sum as the "count"
              percentage: base > 0 ? (stats.count / base) * 100 : 0 // Show response rate as percentage
            });
          }
        }
      });
      
      // Sort by statement number if available, otherwise alphabetically
      if (variableDef && variableDef.statements) {
        const statementOrder = Object.entries(variableDef.statements)
          .sort(([a], [b]) => parseInt(a) - parseInt(b))
          .map(([num, stmt]) => String(stmt));
        
        rows.sort((a, b) => {
          const aIndex = statementOrder.indexOf(a.label);
          const bIndex = statementOrder.indexOf(b.label);
          if (aIndex >= 0 && bIndex >= 0) return aIndex - bIndex;
          if (aIndex >= 0) return -1;
          if (bIndex >= 0) return 1;
          return a.label.localeCompare(b.label);
        });
      }
    } else {
      // Standard categorical display
      const varNameForCodeLabel = statementMatch && parentVarName ? parentVarName : selectedVariable;
      rows = allCodeKeys.map(code => ({
      code,
        label: getCodeLabel(parsedFile.variables, varNameForCodeLabel, code),
      count: counts[code] || 0,
      percentage: base > 0 ? ((counts[code] || 0) / base) * 100 : 0
    }));
    }

    // Filter out 0% frequencies if option is enabled for this variable
    if (hideZeroFrequencies[selectedVariable]) {
      rows = rows.filter(row => row.count > 0);
    }

    // Get sort option for this variable (default to 'qnr' if not set)
    const sortOption = sortOptions[selectedVariable] || 'qnr';
    
    // Get code order for sorting (already have variableDef from above)
    const codeOrder = variableDef && (variableDef.type === 'categorical' || variableDef.type === 'multi-select' || 
                                     variableDef.type === 'grid' || variableDef.type === 'grid-single-select' || 
                                     variableDef.type === 'grid-multi-select')
      ? Object.keys(variableDef.codes)
      : [];
    
    // Apply sorting
    rows = rows.sort((a, b) => {
      if (sortOption === 'qnr') {
        // QNR: sort by original order from the data file (code definition order)
        const aIndex = codeOrder.indexOf(a.code);
        const bIndex = codeOrder.indexOf(b.code);
        // If code not found in order, put it at the end
        if (aIndex === -1 && bIndex === -1) return 0;
        if (aIndex === -1) return 1;
        if (bIndex === -1) return -1;
        return aIndex - bIndex;
      } else if (sortOption === 'asc') {
        // Ascending: sort by percentage (ascending)
        return a.percentage - b.percentage;
      } else if (sortOption === 'desc') {
        // Descending: sort by percentage (descending)
        return b.percentage - a.percentage;
      }
      return 0;
    });

    // Store statement stats for numeric grids
    const statementStats: Record<string, { sum: number; mean: number; max: number; min: number; count: number }> = {};
    if (isNumericGrid) {
      const statementKeys = Object.keys(counts).filter(key => !key.startsWith('__STATS_'));
      statementKeys.forEach(key => {
        const stats = (counts as any)[`__STATS_${key}`];
        if (stats) {
          statementStats[key] = stats;
        }
      });
    }


    const tableData = {
      variable: selectedVariable,
      base,
      rows,
      ...(isNumericGrid && { statementStats })
    } as FrequencyTable & { 
      statementStats?: Record<string, { sum: number; mean: number; max: number; min: number; count: number }>;
    };
    
    // Calculate elapsed time and ensure minimum 1 second loading time
    const elapsedTime = Date.now() - startTime;
    const minLoadingTime = 1000; // 1 second minimum
    const remainingTime = Math.max(0, minLoadingTime - elapsedTime);
    
    // Wait for remaining time if needed, then set the table and hide loading
    await new Promise(resolve => setTimeout(resolve, remainingTime));
    
    setFrequencyTable(tableData);
    setIsGeneratingTable(false);
  }, [parsedFile, selectedVariable, sortOptions, hideZeroFrequencies]);

  // Clear cache when parsed file changes
  useEffect(() => {
    baseCacheRef.current = {};
  }, [parsedFile]);

  // Auto-generate frequency table when variable is selected or sort changes (lazy loading)
  useEffect(() => {
    if (viewMode === 'viewer' && selectedVariable && parsedFile) {
      // Clear previous table and set loading state immediately
      setFrequencyTable(null);
      setIsGeneratingTable(true);
      
      // Use a small delay to ensure UI updates before heavy computation
      const timer = setTimeout(() => {
      generateFrequencyTable();
      }, 10);
      
      return () => clearTimeout(timer);
    } else {
      setFrequencyTable(null);
      setIsGeneratingTable(false);
    }
  }, [selectedVariable, parsedFile, viewMode, sortOptions, generateFrequencyTable]);

  // Export to Excel
  const exportToExcel = () => {
    if (!frequencyTable) return;

    const wb = XLSX.utils.book_new();
    const wsData = [
      ['Variable', frequencyTable.variable],
      ['Base', frequencyTable.base],
      [],
      ['Code', 'Label', 'Count', 'Percentage']
    ];

    frequencyTable.rows.forEach(row => {
      wsData.push([
        row.code,
        row.label,
        row.count,
        `${row.percentage.toFixed(1)}%`
      ]);
    });

    const ws = XLSX.utils.aoa_to_sheet(wsData);
    XLSX.utils.book_append_sheet(wb, ws, 'Frequency Table');
    
    XLSX.writeFile(wb, `frequency_table_${frequencyTable.variable}_${Date.now()}.xlsx`);
  };

  // Calculate base for each variable (with caching using ref to avoid re-renders)
  const getVariableBase = useCallback((variableName: string, useCache = true) => {
    if (!parsedFile) return 0;
    
    // Check cache first (using ref)
    if (useCache && baseCacheRef.current[variableName] !== undefined) {
      return baseCacheRef.current[variableName];
    }
    
    let base = 0;
    
    // Check if this is a statement variable (e.g., QS13_1)
    const statementMatch = variableName.match(/^(.+)_(\d+)$/);
    if (statementMatch) {
      const [, parentVarName, statementNum] = statementMatch;
      const parentVar = parsedFile.variables.find(v => v.name === parentVarName);
      
      if (parentVar && (parentVar.type === 'grid-single-select' || parentVar.type === 'grid-multi-select') && parentVar.statements) {
        const statementLabel = parentVar.statements[statementNum];
        if (statementLabel) {
          // For multi-select grids, base is total number of rows (all respondents)
          if (parentVar.type === 'grid-multi-select') {
            base = parsedFile.data.length;
            if (useCache) {
              baseCacheRef.current[variableName] = base;
            }
            return base;
          }
          
          // For single-select grids, count rows that have data for this statement
          // Find the column that matches this statement
          const prefix = `${parentVarName} - `;
          const normalizedStatementLabel = String(statementLabel).toLowerCase();
          
          // Find matching column once (outside loop)
          let matchingColumn: string | null = null;
          if (parsedFile.data.length > 0) {
            const firstRow = parsedFile.data[0];
            matchingColumn = Object.keys(firstRow).find(colName => {
              if (colName.startsWith(prefix)) {
                const colLabel = colName.substring(prefix.length).trim();
                // Check if column matches statement (remove response part if present)
                const cleanColLabel = colLabel.replace(/\s*\(sample:.*?\)$/i, '').trim();
                const parts = cleanColLabel.split(' - ');
                const statementPart = parts[0].trim();
                return statementPart.toLowerCase() === normalizedStatementLabel;
              }
              return false;
            }) || null;
          }
          
          if (matchingColumn) {
            parsedFile.data.forEach(row => {
              const value = row[matchingColumn!];
              if (value !== null && value !== undefined && value !== '') {
                base++;
              }
            });
          }
        }
      }
    } else {
      // Regular variable lookup
    parsedFile.data.forEach(row => {
      // Try exact match first
      let value = row[variableName];
      // If key doesn't exist, try case-insensitive match
      if (!(variableName in row)) {
        const matchingKey = Object.keys(row).find(
          key => key.trim().toLowerCase() === variableName.trim().toLowerCase()
        );
        if (matchingKey) {
          value = row[matchingKey];
        }
      }
      // Count non-empty values
      if (value !== null && value !== undefined && value !== '') {
        base++;
      }
    });
    }
    
    // Cache the result in ref (doesn't cause re-render)
    if (useCache) {
      baseCacheRef.current[variableName] = base;
    }
    
    return base;
  }, [parsedFile]);

  const filteredVariables = useMemo(() => {
    if (!parsedFile) return [];
    
    const expandedVariables: VariableDefinition[] = [];
    
    parsedFile.variables.forEach(v => {
      // Exclude system variables
      const excludeList = [
        'disposition', 'status', 'record', 'uuid', 'date', 'markers',
        'listsource', 'qhidstage', 'qhidlivetrack',
        'id', 'identifier', 'qinfo', 'sesskey', 'pcid', 'shghash', 'cnt',
        'session', 'url', 'dcua', 'useragent', 'list', 'declang', 'source',
        'vdropout', 'start_date', 'vmobileos', 'vmobiledevice', 'vbrowser',
        'vbrowserr15oe', 'vosr15oe', 'vos', 'vdeclang', 'qtime', 'vcnt',
        'vpcid', 'vqinfo', 'vlist', 'vqtime',
        'pmassist1', 'pmassist2', 'pmassist3', 'pmassist4', 'pmassist5'
      ];
      if (excludeList.includes(v.name.toLowerCase())) {
        return;
      }
      // Hide variables with "Term" in the name
      if (v.name.toLowerCase().includes('term')) {
        return;
      }
      // Apply filter options
      if (hideOpenEnds && v.type === 'open-text') {
        return;
      }
      
      // For single-select grids, expand into statement-level variables
      if (v.type === 'grid-single-select' && v.statements && Object.keys(v.statements).length > 0) {
        // Create a virtual variable for each statement
        Object.entries(v.statements).forEach(([statementNum, statementLabel]) => {
          const statementVarName = `${v.name}_${statementNum}`;
          
          // Apply search filter
          const matchesFilter = statementVarName.toLowerCase().includes(variableFilter.toLowerCase()) ||
                                String(statementLabel).toLowerCase().includes(variableFilter.toLowerCase()) ||
                                v.description.toLowerCase().includes(variableFilter.toLowerCase());
          
          if (!matchesFilter) {
            return;
          }
          
          // Check base if needed (lazy - only when hideZeroBase is enabled)
      if (hideZeroBase) {
            // For statement variables, base is the number of rows with data for that statement
            const base = getVariableBase(statementVarName, true);
        if (base === 0) {
              return;
            }
          }
          
          // Create virtual variable definition for this statement
          expandedVariables.push({
            name: statementVarName,
            description: String(statementLabel),
            type: 'categorical', // Treat each statement as a categorical variable
            codes: v.codes || {}, // Use the parent grid's response codes
            parentGrid: v.name, // Keep reference to parent
            statementNumber: statementNum
          } as VariableDefinition & { parentGrid?: string; statementNumber?: string });
        });
      } else if (v.type === 'grid-multi-select' && v.statements && Object.keys(v.statements).length > 0) {
        // For multi-select grids, expand into statement-level variables
        Object.entries(v.statements).forEach(([statementNum, statementLabel]) => {
          const statementVarName = `${v.name}_${statementNum}`;
      
      // Apply search filter
          const matchesFilter = statementVarName.toLowerCase().includes(variableFilter.toLowerCase()) ||
                                String(statementLabel).toLowerCase().includes(variableFilter.toLowerCase()) ||
             v.description.toLowerCase().includes(variableFilter.toLowerCase());
          
          if (!matchesFilter) {
            return;
          }
          
          // Check base if needed (lazy - only when hideZeroBase is enabled)
          if (hideZeroBase) {
            // For statement variables, base is the number of rows with data for that statement
            const base = getVariableBase(statementVarName, true);
            if (base === 0) {
              return;
            }
          }
          
          // Create virtual variable definition for this statement
          expandedVariables.push({
            name: statementVarName,
            description: String(statementLabel),
            type: 'multi-select', // Treat each statement as a multi-select variable
            codes: v.codes || {}, // Use the parent grid's response codes
            parentGrid: v.name, // Keep reference to parent
            statementNumber: statementNum
          } as VariableDefinition & { parentGrid?: string; statementNumber?: string });
        });
      } else {
        // Regular variable - apply filters
        if (hideZeroBase) {
          const base = getVariableBase(v.name, true);
          if (base === 0) {
            return;
          }
        }
        
        // Apply search filter
        const matchesFilter = v.name.toLowerCase().includes(variableFilter.toLowerCase()) ||
                             v.description.toLowerCase().includes(variableFilter.toLowerCase());
        
        if (!matchesFilter) {
          return;
        }
        
        expandedVariables.push(v);
      }
    });
    
    return expandedVariables;
  }, [parsedFile, hideOpenEnds, hideZeroBase, variableFilter, getVariableBase]);

  // Auto-select first variable when switching to tables tab if none is selected or current selection is invalid
  useEffect(() => {
    if (activeSubTab === 'tables' && parsedFile && filteredVariables.length > 0) {
      // If no variable is selected, or the selected variable is not in the filtered list, select the first one
      if (!selectedVariable || !filteredVariables.some(v => v.name === selectedVariable)) {
        const firstVariable = filteredVariables.find(v => v.type !== 'open-text');
        if (firstVariable) {
          setSelectedVariable(firstVariable.name);
        }
      }
    }
  }, [activeSubTab, parsedFile, filteredVariables, selectedVariable]);

  return (
    <div className={`flex-1 ${viewMode === 'viewer' && activeSubTab === 'tables' ? 'overflow-hidden' : 'overflow-y-auto'}`} style={{ backgroundColor: BRAND_BG, minHeight: 'calc(100vh - 80px)', marginTop: '80px', display: 'flex', flexDirection: 'column', height: viewMode === 'viewer' && activeSubTab === 'tables' ? 'calc(100vh - 80px)' : 'auto', maxHeight: viewMode === 'viewer' && activeSubTab === 'banners' ? 'calc(100vh - 80px)' : 'auto' }}>
      <div className={`${viewMode === 'viewer' ? 'flex flex-col w-full' : viewMode === 'home' || viewMode === 'project' ? 'flex-1 p-6 space-y-6 max-w-full' : 'max-w-7xl mx-auto p-6 space-y-6'}`} style={viewMode === 'viewer' ? { padding: '24px 0 0 0', display: 'flex', flexDirection: 'column', width: '100%' } : {}}>
        {/* Home View - Project List */}
        {viewMode === 'home' && (
          <div>
            <div className="flex items-center justify-between mb-4">
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
                    {showMyProjectsOnly ? 'Only My Projects' : 'All Cognitive Projects'}
                  </button>
                )}
              </div>
            </div>
            <div className="border-b border-gray-200 mb-4"></div>

            <div className="bg-white shadow-sm border border-gray-200 rounded-lg overflow-hidden">
              <div className="overflow-x-auto">
                {loading ? (
                  <div className="p-12 text-center">
                    <div className="mx-auto mb-4 h-10 w-10 animate-spin rounded-full border-4 border-gray-200 border-t-[#D14A2D]"></div>
                    <p className="text-sm text-gray-500">Loading projects...</p>
                  </div>
                ) : displayProjects.length === 0 ? (
                  <div className="p-12 text-center">
                    <DocumentTextIcon className="mx-auto mb-4 h-16 w-16 text-gray-300" />
                    <h3 className="text-lg font-semibold text-gray-900">
                      {activeTab === 'archived'
                        ? 'No archived quantitative projects'
                        : 'No active quantitative projects'}
                    </h3>
                    <p className="mt-2 text-gray-500">
                      {activeTab === 'archived'
                        ? 'Archived quantitative projects will appear here.'
                        : 'Create a quantitative project to start data tabulation.'}
                    </p>
                  </div>
                ) : (
                  <table className="min-w-full divide-y divide-gray-200">
                    <thead className="bg-gray-50">
                      <tr>
                        <th className="pl-6 pr-2 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider w-0 whitespace-nowrap">
                          Project
                        </th>
                        <th className="pl-2 pr-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider w-32">
                          Client
                        </th>
                        <th className="px-6 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider w-32">
                          Tabulations
                        </th>
                      </tr>
                    </thead>
                    <tbody className="bg-white divide-y divide-gray-200">
                      {displayProjects.map(project => {
                        const projectTabulations = savedTabulations.filter(t => t.projectId === project.id);
                        return (
                          <tr
                            key={project.id}
                            className="hover:bg-gray-50 cursor-pointer transition-colors"
                            onClick={() => {
                              setSelectedProject(project);
                              setViewMode('project');
                              // Update header to project name
                              if (onHeaderChange) {
                                onHeaderChange(project.name);
                              }
                            }}
                          >
                            <td className="pl-6 pr-2 py-4 whitespace-nowrap w-0">
                              <div className="inline-block text-sm font-medium text-gray-900">{project.name}</div>
                            </td>
                            <td className="pl-2 pr-6 py-4 whitespace-nowrap w-32">
                              <div className="text-sm text-gray-900 truncate">{project.client || '-'}</div>
                            </td>
                            <td className="px-6 py-4 whitespace-nowrap text-center w-32">
                              <div className="flex items-center justify-center gap-1 text-sm text-gray-900">
                                <IconTable className="h-4 w-4 text-gray-400" />
                                {projectTabulations.length}
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                )}
              </div>
            </div>
          </div>
        )}

        {/* Project View - Tabulations List */}
        {viewMode === 'project' && selectedProject && (
          <div className="bg-white shadow-sm border border-gray-200 rounded-lg overflow-hidden">
            <div className="px-6 py-4 border-b border-gray-200 bg-gray-50">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <button
                    onClick={() => {
                      setViewMode('home');
                      setSelectedProject(null);
                      // Reset header to default
                      if (onHeaderChange) {
                        onHeaderChange(null);
                      }
                    }}
                    className="flex items-center gap-2 text-sm text-gray-600 hover:text-gray-800 hover:bg-gray-100 px-3 py-1 rounded-lg transition-colors"
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                    </svg>
                    Back to Projects
                  </button>
                  <div>
                    <h2 className="text-lg font-semibold" style={{ color: BRAND_GRAY }}>{selectedProject.name}</h2>
                  </div>
                </div>
                <button
                  onClick={() => {
                    setViewMode('create');
                  }}
                  className="flex items-center gap-1 rounded-lg px-3 py-1 text-xs shadow-sm transition-colors text-white hover:opacity-90 cursor-pointer"
                  style={{ backgroundColor: BRAND_ORANGE }}
                >
                  <CloudArrowUpIcon className="h-4 w-4" />
                  Create New
                </button>
              </div>
            </div>

            <div className="overflow-x-auto">
              {(() => {
                const projectTabulations = savedTabulations.filter(t => t.projectId === selectedProject.id);
                return projectTabulations.length === 0 ? (
                  <div className="p-8 text-center">
                    <IconTable className="h-12 w-12 text-gray-400 mx-auto mb-4" />
                    <h3 className="text-lg font-medium text-gray-900 mb-2">No Data Tabulations</h3>
                    <p className="text-gray-600 mb-4">This project doesn't have any data tabulations yet.</p>
                    <button
                      onClick={() => {
                        setViewMode('create');
                      }}
                      className="flex items-center gap-1 rounded-lg px-4 py-2 text-sm shadow-sm transition-colors text-white hover:opacity-90 mx-auto"
                      style={{ backgroundColor: BRAND_ORANGE }}
                    >
                      <CloudArrowUpIcon className="h-4 w-4" />
                      Create First Tabulation
                    </button>
                  </div>
                ) : (
                  <table className="min-w-full divide-y divide-gray-200">
                    <thead className="bg-gray-50">
                      <tr>
                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                          Tabulation Name
                        </th>
                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                          Created
                        </th>
                        <th className="px-6 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider">
                          Variables
                        </th>
                        <th className="px-6 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider">
                          Respondents
                        </th>
                        <th className="px-6 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider">
                          Actions
                        </th>
                      </tr>
                    </thead>
                    <tbody className="bg-white divide-y divide-gray-200">
                      {projectTabulations.map((tabulation) => (
                        <tr 
                          key={tabulation.id} 
                          className="hover:bg-gray-50 cursor-pointer transition-colors"
                          onClick={() => loadTabulation(tabulation)}
                        >
                          <td className="px-6 py-4 whitespace-nowrap">
                            <div className="text-sm font-medium text-gray-900">{tabulation.name}</div>
                            {tabulation.description && (
                              <div className="text-sm text-gray-500 truncate max-w-xs">{tabulation.description}</div>
                            )}
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                            {new Date(tabulation.savedAt).toLocaleDateString()}
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap text-center">
                            <div className="flex items-center justify-center gap-1 text-sm text-gray-900">
                              <IconTable className="h-4 w-4 text-gray-400" />
                              {tabulation.parsedData?.variables?.length || 0}
                            </div>
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap text-center text-sm text-gray-900">
                            {tabulation.parsedData?.rowCount || 0}
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap text-center">
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                deleteTabulation(tabulation.id);
                              }}
                              className="text-red-600 hover:text-red-800 p-1 rounded-lg hover:bg-red-50 transition-colors"
                              title="Delete Tabulation"
                            >
                              <TrashIcon className="h-4 w-4" />
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                );
              })()}
            </div>
          </div>
        )}

        {/* Create View - File Upload */}
        {viewMode === 'create' && (
          <div className="bg-white shadow-sm border border-gray-200 rounded-lg p-8 max-w-2xl mx-auto">
            <div className="flex items-center justify-between mb-6">
              <h3 className="text-xl font-semibold text-gray-900">Create New Data Tabulation</h3>
              <button
                onClick={() => {
                  setViewMode(selectedProject ? 'project' : 'home');
                  setCreateFormData({ name: '' });
                  setParsedFile(null);
                  setUploadedFile(null);
                  setError('');
                  // Update header based on view mode
                  if (onHeaderChange) {
                    if (selectedProject) {
                      onHeaderChange(selectedProject.name);
                    } else {
                      onHeaderChange(null);
                    }
                  }
                }}
                className="text-sm text-gray-600 hover:text-gray-900"
                disabled={uploading}
              >
                Cancel
              </button>
            </div>

            <div className="space-y-6">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Tabulation Name <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  value={createFormData.name}
                  onChange={(e) => setCreateFormData({ ...createFormData, name: e.target.value })}
                  placeholder="Enter tabulation name..."
                  className="w-full border border-gray-300 rounded-lg px-4 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-500"
                />
              </div>


              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Data File <span className="text-red-500">*</span>
                </label>
                <div
                  onDrop={handleDrop}
                  onDragOver={handleDragOver}
                  className="border-2 border-dashed border-gray-300 rounded-lg p-8 text-center hover:border-gray-400 transition-colors"
                >
                  <ArrowUpTrayIcon className="mx-auto h-12 w-12 text-gray-400 mb-4" />
                  <p className="text-sm text-gray-600 mb-2">
                    Drag and drop your Excel file here, or click to browse
                  </p>
                  <input
                    type="file"
                    accept=".xlsx"
                    onChange={handleFileChange}
                    className="hidden"
                    id="file-upload"
                  />
                  <label
                    htmlFor="file-upload"
                    className="inline-block px-4 py-2 bg-white border border-gray-300 rounded-md text-sm font-medium text-gray-700 hover:bg-gray-50 cursor-pointer"
                    style={{ borderColor: BRAND_ORANGE }}
                  >
                    Select File
                  </label>
                  <p className="text-xs text-gray-500 mt-2">
                    Expected format: First sheet contains data, second sheet contains datamap
                  </p>
                  {uploadedFile && (
                    <p className="text-sm text-green-600 mt-2">✓ {uploadedFile.name}</p>
                  )}
                </div>
                
                {uploading && (
                  <div className="mt-4 text-center">
                    <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-gray-900"></div>
                    <p className="mt-2 text-sm text-gray-600">Parsing file...</p>
                  </div>
                )}
                
                {error && (
                  <div className="mt-4 p-4 bg-red-50 border border-red-200 rounded-md">
                    <p className="text-sm text-red-800">{error}</p>
                  </div>
                )}
                
                {parsedFile && (
                  <div className="mt-4 p-4 bg-green-50 border border-green-200 rounded-md">
                    <p className="text-sm text-green-800">
                      Successfully loaded {parsedFile.rowCount} rows with {parsedFile.variables.length} variables
                    </p>
                  </div>
                )}
              </div>

              <button
                onClick={handleSaveTabulation}
                disabled={!parsedFile || !createFormData.name || uploading}
                className="w-full px-4 py-2 text-white rounded-lg text-sm font-medium hover:opacity-90 transition-opacity disabled:opacity-50 disabled:cursor-not-allowed"
                style={{ backgroundColor: BRAND_ORANGE }}
              >
                {uploading ? 'Saving...' : 'Save Tabulation'}
              </button>
            </div>
          </div>
        )}

        {/* Viewer Mode - Tabulation Interface */}
        {viewMode === 'viewer' && currentTabulation && parsedFile && (
          <div className="flex flex-col overflow-hidden" style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
            {/* Sticky Header: Back Button and Tabs */}
            <div className="sticky top-0 z-10 bg-white pb-4 pt-2 flex-shrink-0 px-6" style={{ backgroundColor: BRAND_BG }}>
              {/* Back Button and Export Button - Only show when not viewing a specific banner */}
              {!selectedBannerGroupId && (
                <div className="flex-shrink-0 mb-4">
                  <div className="flex items-center justify-between">
                    <button
                      onClick={() => {
                        setViewMode('project');
                        setCurrentTabulation(null);
                        setParsedFile(null);
                        setFrequencyTable(null);
                        setSelectedVariable('');
                        // Update header back to project name
                        if (onHeaderChange && selectedProject) {
                          onHeaderChange(selectedProject.name);
                        }
                      }}
                      className="flex items-center gap-2 text-sm text-gray-600 hover:text-gray-800 hover:bg-gray-100 px-3 py-1 rounded-lg transition-colors"
                    >
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                      </svg>
                      Back to {currentTabulation.projectName}
                    </button>
                  </div>
                </div>
              )}

              {/* Back Button for Banner View - Above Subtabs */}
              {selectedBannerGroupId && (
                <div className="flex-shrink-0 mb-4">
                  <button
                    onClick={() => setSelectedBannerGroupId(null)}
                    className="flex items-center gap-2 text-sm text-gray-600 hover:text-gray-800 hover:bg-gray-100 px-3 py-1 rounded-lg transition-colors"
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                    </svg>
                    Back to Banner Groups
                  </button>
                </div>
              )}

              {/* Sub-tabs */}
              <div className="flex-shrink-0">
                <nav className="flex space-x-3">
                  <button
                    onClick={() => {
                      setActiveSubTab('tables');
                      setSelectedBannerGroupId(null);
                    }}
                    className={`px-4 py-2 font-medium text-sm border border-gray-300 rounded transition-colors ${
                      activeSubTab === 'tables'
                        ? 'text-white'
                        : 'bg-white text-gray-700 hover:bg-gray-50'
                    }`}
                    style={activeSubTab === 'tables' ? { backgroundColor: BRAND_ORANGE, borderColor: BRAND_ORANGE } : {}}
                  >
                    Tables
                  </button>
                  <button
                    onClick={() => {
                      setActiveSubTab('banners');
                      setSelectedBannerGroupId(null);
                    }}
                    className={`px-4 py-2 font-medium text-sm border border-gray-300 rounded transition-colors ${
                      activeSubTab === 'banners'
                        ? 'text-white'
                        : 'bg-white text-gray-700 hover:bg-gray-50'
                    }`}
                    style={activeSubTab === 'banners' ? { backgroundColor: BRAND_ORANGE, borderColor: BRAND_ORANGE } : {}}
                  >
                    Banners
                  </button>
                </nav>
              </div>
            </div>

            {/* Main Content Area Box - Sidebar + Frequency Table */}
            <div className={`flex-1 ${activeSubTab === 'tables' ? 'overflow-hidden' : 'overflow-y-auto'}`} style={{ minHeight: 0, flex: '1 1 0%', display: 'flex', flexDirection: 'column', height: activeSubTab === 'tables' ? 'calc(100vh - 200px)' : 'auto', maxHeight: activeSubTab === 'tables' ? 'calc(100vh - 200px)' : 'none' }}>
            {activeSubTab === 'tables' && (
            <div className="bg-white shadow-sm flex flex-row flex-1" style={{ minHeight: 0, borderRadius: 0, position: 'relative', alignItems: 'flex-start', height: '100%', overflow: 'hidden' }}>
              {/* Variables Sidebar - 1/4 width, fixed height and scrollable */}
              <div className="w-1/4 border-r border-gray-200 flex flex-col flex-shrink-0 bg-white" style={{ height: '100%', overflow: 'hidden' }}>
                <div className="border-b border-gray-200 flex-shrink-0" style={{ marginLeft: '-24px', marginRight: 0, width: 'calc(100% + 24px)' }}>
                  <div className="py-4 px-2" style={{ paddingLeft: '56px' }}>
                    <div className="flex items-center justify-between mb-2">
                      <h3 className="text-sm font-semibold text-gray-900">Variables ({filteredVariables.length})</h3>
                      <div className="relative" data-filter-dropdown>
                        <button
                          onClick={() => setShowFilterDropdown(!showFilterDropdown)}
                          className="p-1.5 hover:bg-gray-100 rounded-md transition-colors"
                          title="Filter variables"
                        >
                          <FunnelIcon className="h-4 w-4 text-gray-600" />
                        </button>
                        {showFilterDropdown && (
                          <div className="absolute right-0 top-full mt-2 w-56 bg-white border border-gray-200 rounded-lg shadow-lg z-10 p-3">
                            <label className="flex items-center space-x-2 cursor-pointer mb-3">
                              <input
                                type="checkbox"
                                checked={hideOpenEnds}
                                onChange={(e) => setHideOpenEnds(e.target.checked)}
                                className="rounded border-gray-300"
                              />
                              <span className="text-sm text-gray-700">Hide open ends</span>
                            </label>
                            <label className="flex items-center space-x-2 cursor-pointer">
                              <input
                                type="checkbox"
                                checked={hideZeroBase}
                                onChange={(e) => setHideZeroBase(e.target.checked)}
                                className="rounded border-gray-300"
                              />
                              <span className="text-sm text-gray-700">Hide n=0 base questions</span>
                            </label>
                          </div>
                        )}
                      </div>
                    </div>
                    <div className="relative">
                      <MagnifyingGlassIcon className="absolute left-2 top-1/2 transform -translate-y-1/2 h-4 w-4 text-gray-400" />
                      <input
                        type="text"
                        placeholder="Search..."
                        value={variableFilter}
                        onChange={(e) => setVariableFilter(e.target.value)}
                        className="pl-8 pr-3 py-1.5 w-full border border-gray-300 rounded-md text-sm"
                      />
                    </div>
                  </div>
                </div>
                
                <div className="flex-1 overflow-y-auto p-2 pl-6" style={{ minHeight: 0 }}>
                  {filteredVariables.map(variable => {
                    // Only calculate base from cache if available, otherwise skip (lazy loading)
                    const base = baseCacheRef.current[variable.name];
                    const hasNoData = base === 0;
                    const isOpenText = variable.type === 'open-text';
                    // Only disable open-text variables (they can't be tabulated)
                    const isDisabled = isOpenText;
                    
                    return (
                      <div
                        key={variable.name}
                        className={`border border-gray-200 rounded-lg p-3 mb-2 transition-colors ${
                          isDisabled 
                            ? 'opacity-50 cursor-not-allowed' 
                            : 'hover:border-gray-300 cursor-pointer'
                        }`}
                        onClick={() => {
                          if (!isDisabled) {
                            setSelectedVariable(variable.name);
                          }
                        }}
                        style={{
                          borderColor: selectedVariable === variable.name ? BRAND_ORANGE : undefined,
                          backgroundColor: selectedVariable === variable.name ? '#FFF5F3' : 'white'
                        }}
                      >
                        <div className="flex flex-col">
                          <div className="flex items-center justify-between mb-1">
                            <div className="flex items-center gap-2 flex-1 min-w-0">
                              {hideInCrosstabs[variable.name] && (
                                <div className="flex-shrink-0 w-5 h-5 rounded-full bg-gray-400 flex items-center justify-center">
                                  <span className="text-xs font-semibold text-white">H</span>
                                </div>
                              )}
                              <h4 className={`font-semibold text-sm flex-1 min-w-0 truncate ${isDisabled ? 'text-gray-400' : 'text-gray-900'}`}>
                                {variable.name}
                              </h4>
                            </div>
                            <span className={`text-xs px-1.5 py-0.5 rounded flex-shrink-0 ml-2 ${
                              isDisabled ? 'bg-gray-100 text-gray-400' :
                              variable.type === 'multi-select' ? 'bg-purple-100 text-purple-800' :
                              variable.type === 'grid' || variable.type === 'grid-numeric' || variable.type === 'grid-verbatim' || 
                              variable.type === 'grid-single-select' || variable.type === 'grid-multi-select' ? 'bg-orange-100 text-orange-800' :
                              variable.type === 'categorical' ? 'bg-blue-100 text-blue-800' :
                              variable.type === 'open-numeric' ? 'bg-green-100 text-green-800' :
                              'bg-gray-100 text-gray-800'
                            }`}>
                              {variable.type === 'multi-select' ? 'Multi-Select' :
                               variable.type === 'grid-numeric' ? 'Numeric Grid' :
                               variable.type === 'grid-verbatim' ? 'Verbatim Grid' :
                               variable.type === 'grid-single-select' ? 'Single Select Grid' :
                               variable.type === 'grid-multi-select' ? 'Multi-Select Grid' :
                               variable.type === 'grid' ? 'Grid' :
                               variable.type === 'categorical' ? 'Single Select' :
                               variable.type === 'open-numeric' ? 'Numeric' :
                               variable.type === 'open-text' ? 'Open End' :
                               variable.type}
                            </span>
                          </div>
                          <p className={`text-xs line-clamp-2 ${isDisabled ? 'text-gray-400' : 'text-gray-600'}`}>
                            {(() => {
                              // For statement variables, show both parent question and statement
                              const statementMatch = variable.name.match(/^(.+)_(\d+)$/);
                              if (statementMatch) {
                                const [, parentVarName] = statementMatch;
                                const parentVar = parsedFile.variables.find(v => v.name === parentVarName);
                                if (parentVar) {
                                  return (
                                    <>
                                      <span className="font-medium">{variable.description}</span>
                                      {parentVar.description && (
                                        <span className="block mt-1 text-gray-500">{parentVar.description}</span>
                                      )}
                                    </>
                                  );
                                }
                              }
                              return variable.description;
                            })()}
                          </p>
                          {hasNoData && (
                            <div className="mt-1">
                              <span className="text-xs text-red-600 italic">No data (base: 0)</span>
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Frequency Table Area - 3/4 width */}
              <div className="flex-1 flex flex-col relative min-w-0 overflow-hidden pr-6" style={{ height: '100%' }}>
                {selectedVariable ? (
                  (isGeneratingTable || !frequencyTable || frequencyTable.variable !== selectedVariable) ? (
                    <div className="flex-1 flex items-center justify-center h-full">
                      <div className="text-center">
                        <div className="mx-auto mb-4 h-8 w-8 animate-spin rounded-full border-4 border-gray-200 border-t-[#D14A2D]"></div>
                        <p className="text-sm text-gray-500">Generating frequency table...</p>
                      </div>
                    </div>
                  ) : frequencyTable ? (
                    <div className="flex flex-col h-full overflow-hidden">
                      <div className="p-6 pb-4 flex-shrink-0">
                        {/* Header row with variable name and options toggle */}
                        <div className="flex items-center justify-between mb-2">
                          <h3 className="text-lg font-semibold text-gray-900">{selectedVariable}</h3>
                          <div className="flex items-center gap-2">
                            <button
                              onClick={() => {
                                // Always use the selectedVariable (e.g., QS13_1) for debug
                                // We'll handle statement-specific filtering in the modal
                                const statementMatch = selectedVariable.match(/^(.+)_(\d+)$/);
                                let varDef;
                                if (statementMatch) {
                                  const [, parentVarName] = statementMatch;
                                  varDef = parsedFile.variables.find(v => v.name === parentVarName);
                                } else {
                                  varDef = parsedFile.variables.find(v => v.name === selectedVariable);
                                }
                                if (varDef) {
                                  setDebugVariable(varDef);
                                  setDebugVariableName(selectedVariable); // Store the actual variable name being debugged
                                  setShowDebugModal(true);
                                }
                              }}
                              className="flex items-center justify-center p-2 text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50 transition-colors"
                              title="Debug Info"
                            >
                              <InformationCircleIcon className="h-5 w-5" />
                            </button>
                            <button
                              onClick={exportToExcel}
                              className="flex items-center justify-center p-2 text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50 transition-colors"
                              title="Export to Excel"
                            >
                              <DocumentArrowDownIcon className="h-5 w-5" />
                            </button>
                            <button
                              onClick={() => setShowVariableOptions(!showVariableOptions)}
                              className="flex items-center justify-center p-2 text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50 transition-colors"
                              title="Options"
                            >
                              <Cog6ToothIcon className="h-5 w-5" />
                            </button>
                          </div>
                        </div>
                        {/* Question text and base - full width */}
                        <div className="w-full">
                          <p className="text-sm text-gray-600">
                            {(() => {
                              // Check if this is a statement variable (e.g., QS13_1)
                              const statementMatch = selectedVariable.match(/^(.+)_(\d+)$/);
                              if (statementMatch) {
                                const [, parentVarName] = statementMatch;
                                const parentVar = parsedFile.variables.find(v => v.name === parentVarName);
                                const varDef = filteredVariables.find(v => v.name === selectedVariable);
                                // Show parent question text and statement label
                                return (
                                  <>
                                    {parentVar?.description && (
                                      <span>{parentVar.description}</span>
                                    )}
                                    {varDef?.description && (
                                      <span className="block mt-1 font-medium">{varDef.description}</span>
                                    )}
                                  </>
                                );
                              }
                              return parsedFile.variables.find(v => v.name === selectedVariable)?.description;
                            })()}
                          </p>
                          <p className="text-sm text-gray-500 mt-2">
                            Base: {frequencyTable.base}
                            {frequencyTable.base < 15 && (
                              <span className="text-red-600 ml-1">*</span>
                            )}
                          </p>
                        </div>
                      </div>
                      
                      <div className="flex-1 overflow-y-auto border border-gray-200 rounded-lg m-6 mt-0" style={{ minHeight: 0 }}>
                        {(() => {
                          const varDef = parsedFile.variables.find(v => v.name === selectedVariable);
                          const isNumericGrid = varDef?.type === 'grid-numeric';
                          const isVerbatimGrid = varDef?.type === 'grid-verbatim';
                          const isOpenEndedGrid = isNumericGrid || isVerbatimGrid;
                          
                          if (isOpenEndedGrid) {
                            // For numeric and verbatim grids, show a different table format
                            if (isVerbatimGrid) {
                              // Verbatim grid: Show statements with response counts
                              return (
                        <table className="min-w-full divide-y divide-gray-200">
                          <thead className="bg-gray-50 sticky top-0">
                            <tr>
                                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider w-20">Code</th>
                                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Statement</th>
                                      <th className="px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider w-24">Responses</th>
                                    </tr>
                                  </thead>
                                  <tbody className="bg-white divide-y divide-gray-200">
                                    {frequencyTable.rows.map((row, idx) => {
                                      // Find the statement number from the variable definition
                                      const statementNumber = varDef?.statements 
                                        ? Object.entries(varDef.statements).find(([num, stmt]) => String(stmt) === row.label)?.[0]
                                        : null;
                                      return (
                                        <tr key={idx} className="hover:bg-gray-50">
                                          <td className="px-4 py-3 text-sm text-gray-900 w-20">{statementNumber || row.code}</td>
                                          <td className="px-4 py-3 text-sm text-gray-900">{row.label || '(no label)'}</td>
                                          <td className="px-4 py-3 text-sm text-gray-900 text-center w-24">{row.count.toLocaleString()}</td>
                                        </tr>
                                      );
                                    })}
                                  </tbody>
                                </table>
                              );
                            } else {
                              // Numeric grid: Show statements with statistics
                              // Calculate totals and averages for the sum and average rows
                              let totalSum = 0;
                              let totalMeanSum = 0;
                              let rowCount = 0;
                              
                              frequencyTable.rows.forEach((row) => {
                                const stats = (frequencyTable as any).statementStats?.[row.label];
                                if (stats) {
                                  totalSum += stats.sum || 0; // Sum of all totals
                                  totalMeanSum += stats.mean || 0; // Sum of all means
                                  rowCount++;
                                }
                              });
                              
                              const avgTotal = rowCount > 0 ? totalSum / rowCount : 0;
                              const avgMean = rowCount > 0 ? totalMeanSum / rowCount : 0;
                              
                              return (
                                <table className="min-w-full divide-y divide-gray-200">
                                  <thead className="bg-gray-50 sticky top-0">
                                    <tr>
                                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider w-20">Code</th>
                                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Statement</th>
                                      <th className="px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider w-24">Total</th>
                                      <th className="px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider w-20">Mean</th>
                                    </tr>
                                  </thead>
                                  <tbody className="bg-white divide-y divide-gray-200">
                                    {frequencyTable.rows.map((row, idx) => {
                                      // Get stats from the counts object
                                      const stats = (frequencyTable as any).statementStats?.[row.label];
                                      // Find the statement number from the variable definition
                                      const statementNumber = varDef?.statements 
                                        ? Object.entries(varDef.statements).find(([num, stmt]) => String(stmt) === row.label)?.[0]
                                        : null;
                                      
                                      return (
                                        <tr key={idx} className="hover:bg-gray-50">
                                          <td className="px-4 py-3 text-sm text-gray-900 w-20">{statementNumber || row.code}</td>
                                          <td className="px-4 py-3 text-sm text-gray-900">{row.label || '(no label)'}</td>
                                          <td className="px-4 py-3 text-sm text-gray-900 text-center w-24">{(stats?.sum || 0).toLocaleString()}</td>
                                          <td className="px-4 py-3 text-sm text-gray-900 text-center w-20">
                                            {stats?.mean ? stats.mean.toFixed(1) : '-'}
                                          </td>
                                        </tr>
                                      );
                                    })}
                                    {/* Sum row */}
                                    <tr className="bg-gray-50 font-semibold border-t-2 border-gray-300">
                                      <td className="px-4 py-3 text-sm text-gray-900 w-20"></td>
                                      <td className="px-4 py-3 text-sm text-gray-900">Sum</td>
                                      <td className="px-4 py-3 text-sm text-gray-900 text-center w-24">{totalSum.toLocaleString()}</td>
                                      <td className="px-4 py-3 text-sm text-gray-900 text-center w-20">
                                        {totalMeanSum > 0 ? totalMeanSum.toFixed(1) : '-'}
                                      </td>
                                    </tr>
                                    {/* Average row */}
                                    <tr className="bg-gray-50 font-semibold border-t border-gray-300">
                                      <td className="px-4 py-3 text-sm text-gray-900 w-20"></td>
                                      <td className="px-4 py-3 text-sm text-gray-900">Average</td>
                                      <td className="px-4 py-3 text-sm text-gray-900 text-center w-24">
                                        {avgTotal > 0 ? avgTotal.toFixed(1) : '-'}
                                      </td>
                                      <td className="px-4 py-3 text-sm text-gray-900 text-center w-20">
                                        {avgMean > 0 ? avgMean.toFixed(1) : '-'}
                                      </td>
                                    </tr>
                                  </tbody>
                                </table>
                              );
                            }
                          } else {
                            // Standard categorical display
                            return (
                              <table className="min-w-full divide-y divide-gray-200">
                                <thead className="bg-gray-50 sticky top-0">
                                  <tr>
                                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider w-20">Code</th>
                              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Label</th>
                                    <th className="px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider w-24">Count</th>
                                    <th className="px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider w-28">Percentage</th>
                            </tr>
                          </thead>
                          <tbody className="bg-white divide-y divide-gray-200">
                            {frequencyTable.rows.map((row, idx) => (
                              <tr key={idx} className="hover:bg-gray-50">
                                      <td className="px-4 py-3 text-sm text-gray-900 w-20">{row.code}</td>
                                <td className="px-4 py-3 text-sm text-gray-900">{row.label || '(no label)'}</td>
                                      <td className="px-4 py-3 text-sm text-gray-900 text-center w-24">{row.count}</td>
                                      <td className="px-4 py-3 text-sm text-gray-900 text-center w-28">{row.percentage.toFixed(1)}%</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                            );
                          }
                        })()}
                      </div>
                    </div>
                  ) : (
                    <div className="flex-1 flex items-center justify-center h-full">
                      <div className="text-center">
                        <div className="mx-auto mb-4 h-8 w-8 animate-spin rounded-full border-4 border-gray-200 border-t-[#D14A2D]"></div>
                        <p className="text-sm text-gray-500">Generating frequency table...</p>
                      </div>
                    </div>
                  )
                ) : (
                  <div className="flex-1 flex items-center justify-center h-full">
                    <div className="text-center">
                      <IconTable className="h-16 w-16 text-gray-300 mx-auto mb-4" />
                      <h3 className="text-lg font-medium text-gray-900 mb-2">Select a Variable</h3>
                      <p className="text-gray-600">Choose a variable from the sidebar to view its frequency table</p>
                    </div>
                  </div>
                )}

                {/* Variable Options Sidebar */}
                {showVariableOptions && selectedVariable && (
                  <div className="absolute right-0 top-0 h-full w-80 bg-white border-l border-gray-200 shadow-lg z-20">
                      <div className="p-4 border-b border-gray-200">
                        <div className="flex items-center justify-between">
                          <h3 className="text-sm font-semibold text-gray-900">Variable Options</h3>
                          <button
                            onClick={() => setShowVariableOptions(false)}
                            className="text-gray-400 hover:text-gray-600"
                          >
                            <XMarkIcon className="h-5 w-5" />
                          </button>
                        </div>
                      </div>
                      <div className="p-4 space-y-6 overflow-y-auto" style={{ height: 'calc(100% - 60px)' }}>
                        {/* Sort Options */}
                        <div>
                          <label className="text-sm font-medium text-gray-700 mb-2 block">Sort by:</label>
                          <select
                            value={sortOptions[selectedVariable] || 'qnr'}
                            onChange={(e) => {
                              const newSortOptions = { ...sortOptions };
                              newSortOptions[selectedVariable] = e.target.value as 'qnr' | 'asc' | 'desc';
                              setSortOptions(newSortOptions);
                            }}
                            className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-500"
                          >
                            <option value="qnr">QNR</option>
                            <option value="asc">Ascending</option>
                            <option value="desc">Descending</option>
                          </select>
                        </div>

                        {/* Hide Zero Frequencies */}
                        <div>
                          <label className="flex items-center space-x-2 cursor-pointer">
                            <input
                              type="checkbox"
                              checked={hideZeroFrequencies[selectedVariable] || false}
                              onChange={(e) => {
                                const newHideZeroFrequencies = { ...hideZeroFrequencies };
                                newHideZeroFrequencies[selectedVariable] = e.target.checked;
                                setHideZeroFrequencies(newHideZeroFrequencies);
                              }}
                              className="rounded border-gray-300"
                            />
                            <span className="text-sm text-gray-700">Hide frequencies of 0</span>
                          </label>
                        </div>

                        {/* Hide in Crosstabs */}
                        <div>
                          <label className="flex items-center gap-2 cursor-pointer">
                            <input
                              type="checkbox"
                              checked={hideInCrosstabs[selectedVariable] || false}
                              onChange={(e) => {
                                const newHideInCrosstabs = { ...hideInCrosstabs };
                                newHideInCrosstabs[selectedVariable] = e.target.checked;
                                setHideInCrosstabs(newHideInCrosstabs);
                              }}
                              className="rounded border-gray-300"
                            />
                            <span className="text-sm text-gray-700">Do not show table in crosstabs</span>
                          </label>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Banners Tab Content */}
            {activeSubTab === 'banners' && (
              <div className="bg-white shadow-sm rounded-lg flex flex-col" style={{ minHeight: 0, borderRadius: 0 }}>
                {showBannerBuilder ? (
                  <BannerBuilder
                    parsedFile={parsedFile}
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
                  // Show specific banner group crosstab
                  (() => {
                    const selectedGroup = bannerGroups.find(g => g.id === selectedBannerGroupId);
                    if (!selectedGroup) {
                      setSelectedBannerGroupId(null);
                      return null;
                    }
                    return (
                      <div className="flex flex-col flex-1 p-6">
                        {parsedFile && (
                          <CrossTabDisplay
                            parsedFile={parsedFile}
                            bannerGroup={selectedGroup}
                            selectedStubVariable={selectedStubVariables[selectedGroup.id] || ''}
                            onStubVariableChange={(variableName) => {
                              setSelectedStubVariables({
                                ...selectedStubVariables,
                                [selectedGroup.id]: variableName
                              });
                            }}
                            hideOpenEnds={hideOpenEnds}
                            hideZeroBase={hideZeroBase}
                            getVariableBase={getVariableBase}
                            hideInCrosstabs={hideInCrosstabs}
                            sortOptions={sortOptions}
                            hideZeroFrequencies={hideZeroFrequencies}
                            allBannerGroups={bannerGroups}
                            currentBannerGroupIndex={bannerGroups.findIndex(g => g.id === selectedBannerGroupId)}
                            onEdit={() => {
                              setEditingBannerGroup(selectedGroup);
                              setShowBannerBuilder(true);
                            }}
                          />
                        )}
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
                        className="border border-gray-200 rounded-lg p-4 hover:border-gray-300 hover:shadow-md transition-all"
                      >
                        <div className="flex items-center justify-between">
                          <div 
                            className="flex-1 cursor-pointer"
                            onClick={() => setSelectedBannerGroupId(group.id)}
                          >
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
                              className="w-5 h-5 text-gray-400 cursor-pointer" 
                              fill="none" 
                              stroke="currentColor" 
                              viewBox="0 0 24 24"
                              onClick={() => setSelectedBannerGroupId(group.id)}
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
            )}
            </div>
          </div>
        )}

        {/* Debug Modal */}
        {showDebugModal && debugVariable && parsedFile && (
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
            <div className="bg-white rounded-lg shadow-xl max-w-4xl w-full max-h-[90vh] overflow-hidden flex flex-col">
              <div className="flex items-center justify-between p-6 border-b border-gray-200 flex-shrink-0">
                <h2 className="text-xl font-semibold text-gray-900">
                  Debug Information: {debugVariableName || debugVariable.name}
                </h2>
                <div className="flex items-center gap-2">
                  <button
                    onClick={async (e) => {
                      const button = e.currentTarget;
                      const originalText = button.textContent || 'Copy Debug Info';
                      
                      try {
                        // Build comprehensive debug info
                        const firstRow = parsedFile.data.length > 0 ? parsedFile.data[0] : {};
                        
                        // Check if this is a statement variable
                        const statementMatch = debugVariableName.match(/^(.+)_(\d+)$/);
                        let matchingColumns: string[] = [];
                        let statementNum: string | undefined;
                        let statementLabel: string | undefined;
                        
                        if (statementMatch) {
                          const [, parentVarName, stmtNum] = statementMatch;
                          statementNum = stmtNum;
                          statementLabel = debugVariable.statements?.[stmtNum];
                          
                          // Find columns that match this specific statement
                          const prefix = `${parentVarName} - `;
                          const normalizedStatementLabel = String(statementLabel).toLowerCase();
                          
                          matchingColumns = Object.keys(firstRow).filter(colName => {
                            if (colName.startsWith(prefix)) {
                              const colLabel = colName.substring(prefix.length).trim();
                              // Column should match the statement exactly
                              return colLabel.toLowerCase() === normalizedStatementLabel;
                            }
                            return false;
                          });
                        } else {
                          // Regular variable - get all matching columns
                          const prefix = `${debugVariable.name} - `;
                          matchingColumns = Object.keys(firstRow).filter(colName => 
                            colName.startsWith(prefix) || colName === debugVariable.name
                          );
                        }
                        
                        const debugInfo = {
                          question: {
                            number: debugVariableName || debugVariable.name,
                            type: statementMatch ? 'categorical' : debugVariable.type,
                            description: statementLabel || debugVariable.description,
                            base: getVariableBase(debugVariableName || debugVariable.name),
                            isMultiSelectOption: debugVariable.isMultiSelectOption,
                            parentMultiSelect: debugVariable.parentMultiSelect,
                            ...(statementMatch && {
                              parentGrid: debugVariable.name,
                              statementNumber: statementNum
                            })
                          },
                          responseCodes: debugVariable.codes ? Object.entries(debugVariable.codes).map(([code, label]) => ({
                            code,
                            label
                          })) : [],
                          gridStatements: (() => {
                            // For statement variables, only show the specific statement
                            if (statementMatch && statementNum && debugVariable.statements) {
                              return [{
                                number: statementNum,
                                statement: debugVariable.statements[statementNum]
                              }];
                            }
                            // For parent grid variables, show all statements
                            return (debugVariable.type === 'grid' || debugVariable.type === 'grid-numeric' || 
                                    debugVariable.type === 'grid-verbatim' || debugVariable.type === 'grid-single-select' || 
                                    debugVariable.type === 'grid-multi-select') && debugVariable.statements 
                              ? Object.entries(debugVariable.statements).map(([num, statement]) => ({
                                  number: num,
                                  statement
                                }))
                              : [];
                          })(),
                          dataColumns: matchingColumns.map(colName => {
                            // For single-select grids, parse the column name to extract statement and response
                            // Remove "(sample: ...)" from column names for cleaner display
                            let cleanColumnName = colName.replace(/\s*\(sample:\s*[^)]+\)/gi, '');
                            let displayColumnName = cleanColumnName;
                            let parsedCode: string | undefined;
                            let parsedStatement: string | undefined;
                            
                            if (debugVariable.type === 'grid-single-select' || debugVariable.type === 'grid-multi-select') {
                              const prefix = `${debugVariable.name} - `;
                              if (cleanColumnName.startsWith(prefix)) {
                                let statementLabel = cleanColumnName.substring(prefix.length).trim();
                                
                                // Check for format with parentheses: "Statement (sample: ResponseLabel)"
                                const parenMatch = statementLabel.match(/^(.+?)\s*\(sample:\s*(.+?)\)$/i);
                                if (parenMatch) {
                                  parsedStatement = parenMatch[1].trim();
                                  const responseLabel = parenMatch[2].trim();
                                  // Try to match response label to a code
                                  if (debugVariable.codes) {
                                    const matchedCode = Object.entries(debugVariable.codes).find(
                                      ([code, label]) => String(label).trim().toLowerCase() === responseLabel.toLowerCase()
                                    );
                                    if (matchedCode) {
                                      parsedCode = matchedCode[0];
                                      displayColumnName = `${parsedStatement} (Code: ${parsedCode})`;
                                    }
                                  }
                                } else {
                                  // Check for format with dashes: "Statement - ResponseLabel"
                                  const parts = statementLabel.split(' - ');
                                  if (parts.length >= 2) {
                                    parsedStatement = parts.slice(0, -1).join(' - ').trim();
                                    const lastPart = parts[parts.length - 1].trim();
                                    
                                    // Check if last part is a numeric code
                                    if (/^\d+$/.test(lastPart)) {
                                      parsedCode = lastPart;
                                      displayColumnName = `${parsedStatement} (Code: ${parsedCode})`;
                                    } else {
                                      // Last part is likely a label
                                      if (debugVariable.codes) {
                                        const matchedCode = Object.entries(debugVariable.codes).find(
                                          ([code, label]) => String(label).trim().toLowerCase() === lastPart.toLowerCase()
                                        );
                                        if (matchedCode) {
                                          parsedCode = matchedCode[0];
                                          displayColumnName = `${parsedStatement} (Code: ${parsedCode})`;
                                        }
                                      }
                                    }
                                  }
                                }
                              }
                            }
                            
                            return {
                              columnName: displayColumnName,
                              statement: parsedStatement,
                              code: parsedCode,
                              sampleValue: firstRow[colName] !== null && firstRow[colName] !== undefined 
                                ? String(firstRow[colName]) 
                                : 'null'
                            };
                          }),
                          rawVariableDefinition: debugVariable
                        };
                        
                        const debugText = JSON.stringify(debugInfo, null, 2);
                        await navigator.clipboard.writeText(debugText);
                        
                        // Show temporary success feedback
                        if (button.textContent !== null) {
                          button.textContent = 'Copied!';
                        }
                        button.classList.add('bg-green-100', 'text-green-800');
                        setTimeout(() => {
                          if (button.textContent !== null) {
                            button.textContent = originalText;
                          }
                          button.classList.remove('bg-green-100', 'text-green-800');
                        }, 2000);
                      } catch (err) {
                        console.error('Failed to copy:', err);
                        alert('Failed to copy debug information. Please try again.');
                        // Reset button state on error
                        if (button.textContent !== null) {
                          button.textContent = originalText;
                        }
                        button.classList.remove('bg-green-100', 'text-green-800');
                      }
                    }}
                    className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50 transition-colors"
                  >
                    Copy Debug Info
                  </button>
                  <button
                    onClick={() => {
                      setShowDebugModal(false);
                      setDebugVariable(null);
                    }}
                    className="text-gray-400 hover:text-gray-600"
                  >
                    <XMarkIcon className="h-6 w-6" />
                  </button>
      </div>
    </div>
              
              <div className="flex-1 overflow-y-auto p-6 space-y-6">
                {/* Basic Info */}
                <div>
                  <h3 className="text-sm font-semibold text-gray-700 mb-3">Basic Information</h3>
                  <div className="bg-gray-50 rounded-lg p-4 space-y-2">
                    <div className="flex">
                      <span className="font-medium text-gray-700 w-32">Question #:</span>
                      <span className="text-gray-900">{debugVariableName || debugVariable.name}</span>
                    </div>
                    {(() => {
                      const statementMatch = debugVariableName.match(/^(.+)_(\d+)$/);
                      if (statementMatch) {
                        const [, parentVarName] = statementMatch;
                        const statementNum = statementMatch[2];
                        const statementLabel = debugVariable.statements?.[statementNum];
                        return (
                          <>
                            <div className="flex">
                              <span className="font-medium text-gray-700 w-32">Parent Grid:</span>
                              <span className="text-gray-900">{parentVarName}</span>
                            </div>
                            <div className="flex">
                              <span className="font-medium text-gray-700 w-32">Statement #:</span>
                              <span className="text-gray-900">{statementNum}</span>
                            </div>
                            <div className="flex">
                              <span className="font-medium text-gray-700 w-32">Question Type:</span>
                              <span className="text-gray-900">categorical (from grid-single-select)</span>
                            </div>
                            <div className="flex">
                              <span className="font-medium text-gray-700 w-32">Statement Text:</span>
                              <span className="text-gray-900 flex-1">{statementLabel || '(no statement)'}</span>
                            </div>
                            <div className="flex">
                              <span className="font-medium text-gray-700 w-32">Parent Question:</span>
                              <span className="text-gray-900 flex-1">{debugVariable.description || '(no description)'}</span>
                            </div>
                          </>
                        );
                      }
                      return (
                        <>
                          <div className="flex">
                            <span className="font-medium text-gray-700 w-32">Question Type:</span>
                            <span className="text-gray-900">{debugVariable.type}</span>
                          </div>
                          <div className="flex">
                            <span className="font-medium text-gray-700 w-32">Question Text:</span>
                            <span className="text-gray-900 flex-1">{debugVariable.description || '(no description)'}</span>
                          </div>
                        </>
                      );
                    })()}
                    <div className="flex">
                      <span className="font-medium text-gray-700 w-32">Base:</span>
                      <span className="text-gray-900">{getVariableBase(debugVariableName || debugVariable.name)}</span>
                    </div>
                    {debugVariable.isMultiSelectOption && (
                      <div className="flex">
                        <span className="font-medium text-gray-700 w-32">Parent:</span>
                        <span className="text-gray-900">{debugVariable.parentMultiSelect || 'N/A'}</span>
                      </div>
                    )}
                  </div>
                </div>

                {/* Grid Statements */}
                {(() => {
                  // Check if this is a statement variable
                  const statementMatch = debugVariableName.match(/^(.+)_(\d+)$/);
                  let statementsToShow: Array<[string, string]> = [];
                  
                  if (statementMatch && debugVariable.statements) {
                    // For statement variables, only show the specific statement
                    const statementNum = statementMatch[2];
                    const statementLabel = debugVariable.statements[statementNum];
                    if (statementLabel) {
                      statementsToShow = [[statementNum, statementLabel]];
                    }
                  } else if ((debugVariable.type === 'grid' || debugVariable.type === 'grid-numeric' || 
                             debugVariable.type === 'grid-verbatim' || debugVariable.type === 'grid-single-select' || 
                             debugVariable.type === 'grid-multi-select') && debugVariable.statements) {
                    // For parent grid variables, show all statements
                    statementsToShow = Object.entries(debugVariable.statements);
                  }
                  
                  return statementsToShow.length > 0 ? (
                    <div>
                      <h3 className="text-sm font-semibold text-gray-700 mb-3">
                        {statementMatch ? 'Grid Statement' : `Grid Statements (${statementsToShow.length})`}
                      </h3>
                      <div className="bg-gray-50 rounded-lg overflow-hidden">
                        <table className="min-w-full divide-y divide-gray-200">
                          <thead className="bg-gray-100">
                            <tr>
                              <th className="px-4 py-2 text-left text-xs font-medium text-gray-700 uppercase">Code</th>
                              <th className="px-4 py-2 text-left text-xs font-medium text-gray-700 uppercase">Label</th>
                            </tr>
                          </thead>
                          <tbody className="bg-white divide-y divide-gray-200">
                            {statementsToShow.map(([num, statement]) => (
                              <tr key={num}>
                                <td className="px-4 py-2 text-sm text-gray-900 font-mono">{num}</td>
                                <td className="px-4 py-2 text-sm text-gray-900">{statement || '(no label)'}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  ) : null;
                })()}

                {/* Response Codes */}
                {debugVariable.codes && Object.keys(debugVariable.codes).length > 0 && (
                  <div>
                    <h3 className="text-sm font-semibold text-gray-700 mb-3">
                      Response Codes ({Object.keys(debugVariable.codes).length})
                    </h3>
                    <div className="bg-gray-50 rounded-lg overflow-hidden">
                      <table className="min-w-full divide-y divide-gray-200">
                        <thead className="bg-gray-100">
                          <tr>
                            <th className="px-4 py-2 text-left text-xs font-medium text-gray-700 uppercase">Code</th>
                            <th className="px-4 py-2 text-left text-xs font-medium text-gray-700 uppercase">Label</th>
                          </tr>
                        </thead>
                        <tbody className="bg-white divide-y divide-gray-200">
                          {Object.entries(debugVariable.codes).map(([code, label]) => (
                            <tr key={code}>
                              <td className="px-4 py-2 text-sm text-gray-900 font-mono">{code}</td>
                              <td className="px-4 py-2 text-sm text-gray-900">{label || '(no label)'}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}

                {/* Data Columns */}
                {parsedFile.data.length > 0 && (
                  <div>
                    <h3 className="text-sm font-semibold text-gray-700 mb-3">Data Columns</h3>
                    <div className="bg-gray-50 rounded-lg p-4">
                      {(() => {
                        const firstRow = parsedFile.data[0];
                        
                        // Check if this is a statement variable
                        const statementMatch = debugVariableName.match(/^(.+)_(\d+)$/);
                        let matchingColumns: string[] = [];
                        let prefixToShow = '';
                        
                        if (statementMatch) {
                          const [, parentVarName] = statementMatch;
                          const statementNum = statementMatch[2];
                          const statementLabel = debugVariable.statements?.[statementNum];
                          
                          // Find columns that match this specific statement
                          const prefix = `${parentVarName} - `;
                          const normalizedStatementLabel = String(statementLabel).toLowerCase();
                          prefixToShow = `${prefix}${statementLabel}`;
                          
                          matchingColumns = Object.keys(firstRow).filter(colName => {
                            if (colName.startsWith(prefix)) {
                              const colLabel = colName.substring(prefix.length).trim();
                              // Column should match the statement exactly
                              return colLabel.toLowerCase() === normalizedStatementLabel;
                            }
                            return false;
                          });
                        } else {
                          // Regular variable - get all matching columns
                          const prefix = `${debugVariable.name} - `;
                          prefixToShow = prefix;
                          matchingColumns = Object.keys(firstRow).filter(colName => 
                            colName.startsWith(prefix) || colName === debugVariable.name
                          );
                        }
                        
                        if (matchingColumns.length === 0) {
                          return (
                            <p className="text-sm text-gray-500 italic">
                              No matching columns found in data. Tried: "{debugVariableName || debugVariable.name}" and "{prefixToShow}*"
                            </p>
                          );
                        }
                        
                        return (
                          <div className="space-y-1 max-h-60 overflow-y-auto">
                            {matchingColumns.map(colName => {
                              const sampleValue = firstRow[colName];
                              return (
                                <div key={colName} className="text-sm">
                                  <span className="font-mono text-gray-900">{colName}</span>
                                  <span className="text-gray-500 ml-2">
                                    (sample: {sampleValue !== null && sampleValue !== undefined ? String(sampleValue) : 'null'})
                                  </span>
                                </div>
                              );
                            })}
                          </div>
                        );
                      })()}
                    </div>
                  </div>
                )}

                {/* Raw Variable Definition */}
                <div>
                  <h3 className="text-sm font-semibold text-gray-700 mb-3">Raw Variable Definition (JSON)</h3>
                  <div className="bg-gray-50 rounded-lg p-4 overflow-auto max-h-60">
                    <pre className="text-xs text-gray-800 whitespace-pre-wrap">
                      {JSON.stringify(debugVariable, null, 2)}
                    </pre>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
