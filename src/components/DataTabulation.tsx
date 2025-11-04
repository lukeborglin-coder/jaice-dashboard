import React, { useState, useEffect, useMemo, useCallback } from 'react';
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
  PlusCircleIcon
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
  const generateFrequencyTable = useCallback(() => {
    if (!parsedFile || !selectedVariable) {
      setFrequencyTable(null);
      return;
    }

    const counts: Record<string, number> = {};
    let base = 0;

    // Get the variable definition to access all codes
    const variableDef = parsedFile.variables.find(v => v.name === selectedVariable);
    const allCodes = variableDef && (variableDef.type === 'categorical' || variableDef.type === 'multi-select' || variableDef.type === 'grid')
      ? Object.keys(variableDef.codes)
      : [];

    // Initialize all codes with 0 count
    if (allCodes.length > 0) {
      allCodes.forEach(code => {
        counts[code] = 0;
      });
    }

    // Build a reverse lookup map: label -> code (for faster matching)
    const labelToCodeMap = new Map<string, string>();
    if (variableDef && (variableDef.type === 'categorical' || variableDef.type === 'multi-select' || variableDef.type === 'grid')) {
      Object.keys(variableDef.codes).forEach(code => {
        const label = variableDef.codes[code];
        if (label) {
          // Store normalized label as key, code as value
          const normalizedLabel = label.trim().toLowerCase();
          labelToCodeMap.set(normalizedLabel, code);
        }
      });
      
      // Debug: log the mapping for troubleshooting
      console.log(`Label to Code Map for "${selectedVariable}":`, Array.from(labelToCodeMap.entries()));
      console.log(`Defined codes:`, Object.keys(variableDef.codes));
      console.log(`Code definitions:`, variableDef.codes);
    }

    // Count occurrences in data
    // Handle different question types differently
    if (variableDef?.type === 'multi-select') {
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
            const normalizedLabel = optionLabel.trim().toLowerCase();
            let matchingCode = labelToCodeMap.get(normalizedLabel);
            
            // If exact match fails, try fuzzy matching
            if (!matchingCode) {
              let bestMatch: { code: string; similarity: number } | null = null;
              
              labelToCodeMap.forEach((code, normalizedCodeLabel) => {
                // Check if one contains the other (case-insensitive)
                if (normalizedCodeLabel.includes(normalizedLabel) || normalizedLabel.includes(normalizedCodeLabel)) {
                  const similarity = Math.min(normalizedLabel.length, normalizedCodeLabel.length) / Math.max(normalizedLabel.length, normalizedCodeLabel.length);
                  if (!bestMatch || similarity > bestMatch.similarity) {
                    bestMatch = { code, similarity };
                  }
                } else {
                  // Also check for word overlap
                  const labelWords = normalizedLabel.split(/\s+/);
                  const codeWords = normalizedCodeLabel.split(/\s+/);
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
                matchingCode = bestMatch.code;
                console.log(`[${selectedVariable}] Fuzzy matched "${optionLabel}" to code "${matchingCode}" (similarity: ${(bestMatch.similarity * 100).toFixed(1)}%)`);
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
    } else if (variableDef?.type === 'grid') {
      // For grid: find all columns that start with "variableName - "
      // Each column represents one statement, values are response codes (1, 2, 3, etc.)
      const gridColumns: string[] = [];

      // Find all columns for this grid question
      if (parsedFile.data.length > 0) {
        const firstRow = parsedFile.data[0];
        const prefix = `${selectedVariable} - `;
        Object.keys(firstRow).forEach(colName => {
          if (colName.startsWith(prefix)) {
            gridColumns.push(colName);
          }
        });
      }

      // Count base (total number of responses across all statements)
      base = parsedFile.data.length * gridColumns.length;

      // Count response codes across all grid statements
      parsedFile.data.forEach(row => {
        gridColumns.forEach(colName => {
          const value = row[colName];
          if (value !== null && value !== undefined && value !== '') {
            const codeStr = String(value);
            if (counts.hasOwnProperty(codeStr)) {
              counts[codeStr] = (counts[codeStr] || 0) + 1;
            }
          }
        });
      });
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
              let bestMatch: { code: string; similarity: number } | null = null;

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
                counts[bestMatch.code] = (counts[bestMatch.code] || 0) + 1;
                console.log(`[${selectedVariable}] Fuzzy matched "${codeStr}" to code "${bestMatch.code}" (similarity: ${(bestMatch.similarity * 100).toFixed(1)}%)`);
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
    if (variableDef && (variableDef.type === 'categorical' || variableDef.type === 'multi-select' || variableDef.type === 'grid')) {
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
      
      if (variableDef && (variableDef.type === 'categorical' || variableDef.type === 'multi-select' || variableDef.type === 'grid') && allCodes.length > 0) {
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

    let rows: FrequencyTableRow[] = allCodeKeys.map(code => ({
      code,
      label: getCodeLabel(parsedFile.variables, selectedVariable, code),
      count: counts[code] || 0,
      percentage: base > 0 ? ((counts[code] || 0) / base) * 100 : 0
    }));

    // Filter out 0% frequencies if option is enabled for this variable
    if (hideZeroFrequencies[selectedVariable]) {
      rows = rows.filter(row => row.count > 0);
    }

    // Get sort option for this variable (default to 'qnr' if not set)
    const sortOption = sortOptions[selectedVariable] || 'qnr';
    
    // Get code order for sorting (already have variableDef from above)
    const codeOrder = variableDef && (variableDef.type === 'categorical' || variableDef.type === 'multi-select' || variableDef.type === 'grid')
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

    setFrequencyTable({
      variable: selectedVariable,
      base,
      rows
    });
  }, [parsedFile, selectedVariable, sortOptions, hideZeroFrequencies]);

  // Auto-generate frequency table when variable is selected or sort changes
  useEffect(() => {
    if (viewMode === 'viewer' && selectedVariable && parsedFile) {
      generateFrequencyTable();
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

  // Calculate base for each variable
  const getVariableBase = useCallback((variableName: string) => {
    if (!parsedFile) return 0;
    let base = 0;
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
    return base;
  }, [parsedFile]);

  const filteredVariables = useMemo(() => {
    if (!parsedFile) return [];
    
    return parsedFile.variables.filter(v => {
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
        return false;
      }
      // Hide variables with "Term" in the name
      if (v.name.toLowerCase().includes('term')) {
        return false;
      }
      // Apply filter options
      if (hideOpenEnds && v.type === 'open-text') {
        return false;
      }
      
      if (hideZeroBase) {
        const base = getVariableBase(v.name);
        if (base === 0) {
          return false;
        }
      }
      
      // Apply search filter
      return v.name.toLowerCase().includes(variableFilter.toLowerCase()) ||
             v.description.toLowerCase().includes(variableFilter.toLowerCase());
    });
  }, [parsedFile, hideOpenEnds, hideZeroBase, variableFilter, getVariableBase]);

  return (
    <div className="flex-1 overflow-y-auto" style={{ backgroundColor: BRAND_BG, minHeight: 'calc(100vh - 80px)', marginTop: '80px' }}>
      <div className={`max-w-7xl mx-auto ${viewMode === 'viewer' ? 'flex flex-col p-6' : 'p-6 space-y-6'}`} style={viewMode === 'viewer' ? { height: 'calc(100vh - 128px)', minHeight: 'calc(100vh - 128px)' } : {}}>
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
          <div className="flex flex-col flex-1" style={{ minHeight: 0 }}>
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
                  {frequencyTable && (
                    <button
                      onClick={exportToExcel}
                      className="flex items-center gap-2 px-3 py-2 text-sm text-white rounded-md hover:opacity-90 transition-opacity"
                      style={{ backgroundColor: BRAND_ORANGE }}
                    >
                      <DocumentArrowDownIcon className="h-4 w-4" />
                      Export to Excel
                    </button>
                  )}
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
            <div className="flex-shrink-0 mb-4">
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

            {/* Main Content Area Box - Sidebar + Frequency Table */}
            {activeSubTab === 'tables' && (
            <div className="bg-white shadow-sm border border-gray-200 rounded-lg flex-1 flex flex-col overflow-hidden" style={{ minHeight: 0 }}>
              <div className="flex flex-1 overflow-hidden" style={{ minHeight: 0 }}>
              {/* Variables Sidebar - 1/4 width */}
              <div className="w-1/4 border-r border-gray-200 flex flex-col">
                <div className="p-4 border-b border-gray-200">
                  <div className="flex items-center justify-between mb-2">
                    <h3 className="text-sm font-semibold text-gray-900">Variables</h3>
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
                
                <div className="flex-1 overflow-y-auto p-2">
                  {filteredVariables.map(variable => {
                    const base = getVariableBase(variable.name);
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
                              variable.type === 'grid' ? 'bg-orange-100 text-orange-800' :
                              variable.type === 'categorical' ? 'bg-blue-100 text-blue-800' :
                              variable.type === 'open-numeric' ? 'bg-green-100 text-green-800' :
                              'bg-gray-100 text-gray-800'
                            }`}>
                              {variable.type === 'multi-select' ? 'Multi-Select' :
                               variable.type === 'grid' ? 'Grid' :
                               variable.type === 'categorical' ? 'Single Select' :
                               variable.type === 'open-numeric' ? 'Numeric' :
                               variable.type === 'open-text' ? 'Open End' :
                               variable.type}
                            </span>
                          </div>
                          <p className={`text-xs line-clamp-2 ${isDisabled ? 'text-gray-400' : 'text-gray-600'}`}>
                            {variable.description}
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
              <div className="flex-1 flex flex-col relative">
                {selectedVariable ? (
                  frequencyTable ? (
                    <div className="flex-1 flex flex-col p-6 overflow-y-auto relative">
                      <div className="mb-4">
                        {/* Header row with variable name and options toggle */}
                        <div className="flex items-center justify-between mb-2">
                          <h3 className="text-lg font-semibold text-gray-900">{selectedVariable}</h3>
                          <button
                            onClick={() => setShowVariableOptions(!showVariableOptions)}
                            className="flex items-center gap-2 px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-100 rounded-md transition-colors"
                          >
                            <span>Options</span>
                            {showVariableOptions ? (
                              <ChevronLeftIcon className="h-4 w-4" />
                            ) : (
                              <ChevronRightIcon className="h-4 w-4" />
                            )}
                          </button>
                        </div>
                        {/* Question text and base - full width */}
                        <div className="w-full">
                          <p className="text-sm text-gray-600">
                            {parsedFile.variables.find(v => v.name === selectedVariable)?.description}
                          </p>
                          <p className="text-sm text-gray-500 mt-2">
                            Base: {frequencyTable.base}
                            {frequencyTable.base < 15 && (
                              <span className="text-red-600 ml-1">*</span>
                            )}
                          </p>
                        </div>
                      </div>
                      
                      <div className="flex-1 overflow-auto border border-gray-200 rounded-lg">
                        <table className="min-w-full divide-y divide-gray-200">
                          <thead className="bg-gray-50 sticky top-0">
                            <tr>
                              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Code</th>
                              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Label</th>
                              <th className="px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider">Count</th>
                              <th className="px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider">Percentage</th>
                            </tr>
                          </thead>
                          <tbody className="bg-white divide-y divide-gray-200">
                            {frequencyTable.rows.map((row, idx) => (
                              <tr key={idx} className="hover:bg-gray-50">
                                <td className="px-4 py-3 text-sm text-gray-900">{row.code}</td>
                                <td className="px-4 py-3 text-sm text-gray-900">{row.label || '(no label)'}</td>
                                <td className="px-4 py-3 text-sm text-gray-900 text-center">{row.count}</td>
                                <td className="px-4 py-3 text-sm text-gray-900 text-center">{row.percentage.toFixed(1)}%</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  ) : (
                    <div className="flex-1 flex items-center justify-center">
                      <div className="text-center">
                        <div className="mx-auto mb-4 h-8 w-8 animate-spin rounded-full border-4 border-gray-200 border-t-[#D14A2D]"></div>
                        <p className="text-sm text-gray-500">Generating frequency table...</p>
                      </div>
                    </div>
                  )
                ) : (
                  <div className="flex-1 flex items-center justify-center">
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
            </div>
            )}

            {/* Banners Tab Content */}
            {activeSubTab === 'banners' && (
              <div className="bg-white shadow-sm border border-gray-200 rounded-lg flex-1 flex flex-col">
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
        )}
      </div>
    </div>
  );
}
