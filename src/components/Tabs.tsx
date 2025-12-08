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
  ChevronRightIcon,
  PencilIcon,
  EyeIcon,
  FunnelIcon,
  CheckCircleIcon,
  TableCellsIcon,
  Cog6ToothIcon,
  ArrowDownTrayIcon,
  BugAntIcon,
  ClipboardDocumentIcon,
} from '@heroicons/react/24/outline';
import { IconTable, IconCheckbox } from '@tabler/icons-react';
import { API_BASE_URL } from '../config';
import { useAuth } from '../contexts/AuthContext';
import { useNavigate } from 'react-router-dom';
import * as XLSX from 'xlsx';
import ExcelJS from 'exceljs';
import { type BannerGroup, type BannerCut, type BannerConditionGroup } from '../types/dataTabulation';
import BannerBuilder from './BannerBuilder';
import CrossTabDisplay from './CrossTabDisplay';
import BannerFilterConfig from './BannerFilterConfig';
import { type ParsedDataFile } from '../utils/dataTabulationHelpers';
import { autoMatchHeaders } from '../utils/headerMatcher';

// Import hooks
import { useVariables } from '../hooks/useVariables';
import { useBanners } from '../hooks/useBanners';
import { useSummaryNets } from '../hooks/useSummaryNets';
import { useRawDataViewer } from '../hooks/useRawDataViewer';
import { useDataMapping } from '../hooks/useDataMapping';
import { useQuestionnaire } from '../hooks/useQuestionnaire';
import { useTableSelections } from '../hooks/useTableSelections';
import { useStatsSelections } from '../hooks/useStatsSelections';
import { usePreview } from '../hooks/usePreview';

// Import utilities
import { formatDescriptionWithBrackets } from '../utils/tabs/textFormatting';
import { normalizeCodeForComparison, getNumericCodeValueForMean } from '../utils/tabs/codeHelpers';
import { getBaseQuestionNumber, getDefaultSortFlagForVariable } from '../utils/tabs/questionHelpers';
import { createSerializedTableSelections, parseSerializedTableSelections } from '../utils/tabs/serialization';
import { isSignificant, isSignificantForMeans } from '../utils/tabs/statsCalculations';
import { 
  Variable, 
  VariableStatsSelection, 
  NetRange, 
  NetCodeSelection, 
  NetSummaryModalState,
  NET_SUMMARY_MODAL_DEFAULT,
  createDefaultStatsSelection,
  STAT_KEYS
} from '../utils/tabs/types';

// Import components
import { VariableListSidebar } from './tabs/VariableListSidebar';
import { TableSelector } from './tabs/TableSelector';
import { StatsSelector } from './tabs/StatsSelector';
import { BannerBuilderUI } from './tabs/BannerBuilderUI';
import { BannerFilterUI } from './tabs/BannerFilterUI';
import { SummaryNetsList } from './tabs/SummaryNetsList';
import { NetSummaryModal } from './tabs/NetSummaryModal';
import { DebugModal } from './tabs/DebugModal';
import { MappingModal } from './tabs/MappingModal';
import { ManualMappingModal } from './tabs/ManualMappingModal';
import { DataCutsView } from './tabs/DataCutsView';
import { RawDataViewer } from './tabs/RawDataViewer';
import { DataTab } from './tabs/DataTab';
import { VariableTablePlaceholders } from './tabs/VariableTablePlaceholders';
import { HomeView } from './tabs/HomeView';
import { ProjectView } from './tabs/ProjectView';
import { TabSpecsView } from './tabs/TabSpecsView';
import { VariablesView } from './tabs/VariablesView';
import { ConfigPopupModal } from './tabs/ConfigPopupModal';
import { SettingsPopupModal } from './tabs/SettingsPopupModal';
import { getTableOptionsForVariable } from '../utils/tabs/tableOptions';
import { 
  getDefaultTableSelectionsForVariable, 
  getDefaultStatsSelectionsForVariable, 
  getDefaultSortAndHoldForVariable 
} from '../utils/tabs/defaultSelections';
import { 
  getExpectedColumnHeadersForBase as getExpectedColumnHeadersForBaseUtil,
  getExpectedHeadersForQuestion as getExpectedHeadersForQuestionUtil
} from '../utils/tabs/expectedHeaders';

const BRAND_ORANGE = '#D14A2D';
const BRAND_BG = '#F7F7F8';
const BRAND_GRAY = '#5D5F62';

interface TabsProps {
  projects?: any[];
  onNavigateToProject?: (project: any) => void;
  onHeaderChange?: (header: string | null) => void;
}

export default function Tabs({ projects = [], onNavigateToProject, onHeaderChange }: TabsProps) {
  const { user } = useAuth();
  const navigate = useNavigate();
  
  // Page-level state (view routing, projects, etc.) - these stay in the component as they're page-level
  const [viewMode, setViewMode] = useState<'home' | 'project' | 'qnr'>('home');
  const [activeTab, setActiveTab] = useState<'active' | 'archived'>('active');
  const [showMyProjectsOnly, setShowMyProjectsOnly] = useState(true);
  const [selectedProject, setSelectedProject] = useState<any | null>(null);
  const [loading, setLoading] = useState(false);
  const [archivedProjects, setArchivedProjects] = useState<any[]>([]);
  const [qnrViewMode, setQnrViewMode] = useState<'tabSpecs' | 'variables' | 'data'>('tabSpecs');
  const [tabSpecsTypeFilter, setTabSpecsTypeFilter] = useState<string>('all');
  const [tabSpecsSubView, setTabSpecsSubView] = useState<'tables' | 'banners'>('tables');
  const [specsResetKey, setSpecsResetKey] = useState(0);
  const [showSettingsPopup, setShowSettingsPopup] = useState(false);
  const [significanceLevel, setSignificanceLevel] = useState<95 | 90>(95);
  const [percentageDecimals, setPercentageDecimals] = useState<0 | 1 | 2>(0);
  const [showConfigPopup, setShowConfigPopup] = useState(false);
  const [configPopupVariable, setConfigPopupVariable] = useState<Variable | null>(null);
  const [showNetPopup, setShowNetPopup] = useState<Record<string, boolean>>({});
  const [netPopupTableNames, setNetPopupTableNames] = useState<Record<string, string>>({});
  const [openNetDropdowns, setOpenNetDropdowns] = useState<Record<string, Set<number>>>({});
  const [showDebugInfoModal, setShowDebugInfoModal] = useState(false);
  const [debugInfoModalVariable, setDebugInfoModalVariable] = useState<Variable | null>(null);
  const [debugInfoModalTableName, setDebugInfoModalTableName] = useState<string | undefined>(undefined);
  const [showDataCutsView, setShowDataCutsView] = useState(false);
  const [dataCutsLoading, setDataCutsLoading] = useState(false);
  const [dataCutsReady, setDataCutsReady] = useState(false);
  const [showSingleSelectGridSummary, setShowSingleSelectGridSummary] = useState<Record<string, boolean>>({});
  const [selectedSummaryNets, setSelectedSummaryNets] = useState<Record<string, Set<string>>>({});
  const [savedSummaryTables, setSavedSummaryTables] = useState<Record<string, Array<{ id: string, selectedNets: string[], baseQuestionNumber: string, customName?: string }>>>({});
  const [showMappingInfoModal, setShowMappingInfoModal] = useState(false);
  const [showManualMappingModal, setShowManualMappingModal] = useState(false);
  const [selectedMappingHeader, setSelectedMappingHeader] = useState<string | null>(null);
  const [manualMappingSearch, setManualMappingSearch] = useState('');
  const [hasAttemptedMapping, setHasAttemptedMapping] = useState(false); // Track if mapping has been attempted
  const [mappingVariables, setMappingVariables] = useState(false); // Track if mapping is in progress

  // Initialize hooks that don't depend on others first
  const questionnaireHook = useQuestionnaire({
    selectedProject,
    onLoadingChange: setLoading,
  });

  const {
    questionnaires,
    selectedQuestionnaire,
    questionnaireQuestions,
    allQuestionnaires,
    loading: questionnaireLoading,
    loadQuestionnaires,
    getQNRCount,
    migrateOpenEndQuestions,
    setQuestionnaires,
    setSelectedQuestionnaire,
    setQuestionnaireQuestions,
    setAllQuestionnaires,
  } = questionnaireHook;

  // Initialize useRawDataViewer hook after we have selectedQuestionnaire
  const rawDataHook = useRawDataViewer({
    selectedQuestionnaire,
    qnrViewMode,
    viewMode,
  });

  const {
    fullRawData,
    loadingFullRawData,
    rawDataPage,
    rawDataRowsPerPage,
    rawDataColumnStart,
    rawDataColumnsPerPage,
    loadFullRawData,
    setFullRawData,
    setLoadingFullRawData,
    setRawDataPage,
    setRawDataColumnStart,
  } = rawDataHook;

  // Initialize useDataMapping hook after we have selectedQuestionnaire
  const dataMappingHook = useDataMapping({
    selectedQuestionnaire,
    qnrViewMode,
  });

  const {
    columnMapping,
    mappingFilter,
    datamapData,
    loadingDatamap,
    showColumnHeadersInfo,
    showMappingResultsModal,
    expandedDatamapRows,
    loadDatamap,
    setColumnMapping,
    setMappingFilter,
    setDatamapData,
    setLoadingDatamap,
    setShowColumnHeadersInfo,
    setShowMappingResultsModal,
    setExpandedDatamapRows,
  } = dataMappingHook;

  // Initialize useVariables hook after we have the data it needs
  const variablesHook = useVariables({
    questionnaireQuestions,
    fullRawData,
    columnMapping,
  });

  const {
    variables,
    selectedVariable,
    variableData,
    variableFilter,
    questionTypeFilter,
    showQuestionTypeFilter,
    customNetsMode,
    filteredVariables,
    getResponseCodesForVariable,
    getVariableDataFromRawData,
    getVariableDataByExpectedHeader,
    convertQuestionsToVariables,
    convertHiddenVariableToExpectedHeader,
    setVariables,
    setSelectedVariable,
    setVariableData,
    setVariableFilter,
    setQuestionTypeFilter,
    setShowQuestionTypeFilter,
    setCustomNetsMode,
  } = variablesHook;

  // Now initialize hooks that depend on variables and selectedQuestionnaire
  const bannersHook = useBanners({
    selectedQuestionnaire,
    variables,
  });
  const summaryNetsHook = useSummaryNets();
  const tableSelectionsHook = useTableSelections({ selectedQuestionnaireId: selectedQuestionnaire?.id });
  const statsSelectionsHook = useStatsSelections({ selectedQuestionnaireId: selectedQuestionnaire?.id });
  const previewHook = usePreview(); // Will need buildTabSpecsWorkbook and getTablesForVariable later

  const {
    newBannerGroups,
    showBannerBuilder,
    editingBannerGroup,
    selectedNewBannerGroupId,
    selectedNewBannerVariable,
    bannerFilterConditions,
    parsedFile,
    hiddenFromBanners,
    bannerSettingsOpenRef,
    bannerSpecsFileInputRef,
    handleClickImportBannerSpecs,
    handleBannerSpecsFileChange,
    handleBannerSave,
    handleBannerChange,
    handleBannerCancel,
    setNewBannerGroups,
    setShowBannerBuilder,
    setEditingBannerGroup,
    setSelectedNewBannerGroupId,
    setSelectedNewBannerVariable,
    setBannerFilterConditions,
    setParsedFile,
    setHiddenFromBanners,
  } = bannersHook;

  const {
    netSummaryTableRanges,
    netSummaryTableSelectedCodes,
    netSummaryModalState,
    tempNetRanges,
    tempNetCodes,
    handleAddInlineNumericNet,
    handleUpdateInlineNumericNet,
    handleRemoveInlineNumericNet,
    openNetSummaryModal,
    closeNetSummaryModal,
    handleNetSummaryModalFieldChange,
    handleNetSummaryModalCodeToggle,
    handleEditNetSummary,
    handleNetSummaryModalSave,
    setNetSummaryTableRanges,
    setNetSummaryTableSelectedCodes,
    setNetSummaryModalState,
    setTempNetRanges,
    setTempNetCodes,
  } = summaryNetsHook;

  const {
    variableTableSelections,
    summaryTableSortSelections,
    variableSortByFrequency,
    variableHoldResponseCodes,
    holdOptionsDropdownOpen,
    handleToggleIndividualTable,
    handleSelectTable,
    handleSelectAllIndividualTables,
    handleUnselectAllIndividualTables,
    removeSummarySortSelection,
    handleSummaryTableSortToggle,
    handleSortPreferenceChange,
    handleHoldOptionsToggle,
    handleHoldOptionSelection,
    applyHoldOrdering,
    openHoldOptionsDropdown,
    closeHoldOptionsDropdown,
    setVariableTableSelections,
    setSummaryTableSortSelections,
    setVariableSortByFrequency,
  } = tableSelectionsHook;

  const {
    variableStatsSelections,
    singleSelectSort,
    getStatsSelectionsForVariable,
    handleToggleStatSelection,
    setVariableStatsSelections,
    setSingleSelectSort,
  } = statsSelectionsHook;

  const {
    previewVariable,
    previewSectionsHtml,
    previewLoading,
    previewError,
    previewDebugInfo,
    variableRenderedTableCounts,
    setPreviewVariable,
    setPreviewSectionsHtml,
    setPreviewLoading,
    setPreviewError,
    setPreviewDebugInfo,
    setVariableRenderedTableCounts,
  } = previewHook;

  // Helper functions for project filtering (page-level logic)
  const isQuantitative = useCallback((project: any) => {
    const methodology = project?.methodologyType?.toLowerCase();
    if (!methodology) return false;
    return methodology.includes('quant') ||
           methodology.includes('survey') ||
           methodology.includes('quantitative') ||
           (!methodology.includes('qual') && 
            !methodology.includes('interview') && 
            !methodology.includes('focus group'));
  }, []);

  const quantActiveProjects = useMemo(() => projects.filter(isQuantitative), [projects, isQuantitative]);
  const quantArchivedProjects = useMemo(() => archivedProjects.filter(isQuantitative), [archivedProjects, isQuantitative]);

  const filterProjectsByUser = useCallback((list: any[]) => {
    if (!showMyProjectsOnly || !user) return list;
    const uid = String((user as any)?.id || '').toLowerCase();
    const uemail = String((user as any)?.email || '').toLowerCase();
    const uname = String((user as any)?.name || '').toLowerCase();
    return list.filter(project => {
      const createdBy = String((project as any)?.createdBy || '').toLowerCase();
      const createdByMe = !!createdBy && (createdBy === uid || createdBy === uemail);
      const teamMembers = Array.isArray((project as any)?.teamMembers) ? (project as any).teamMembers : [];
      const inTeam = teamMembers.some((member: any) => {
        const mid = String(member?.id || '').toLowerCase();
        const memail = String(member?.email || '').toLowerCase();
        const mname = String(member?.name || '').toLowerCase();
        return (uid && mid === uid) || (uemail && memail === uemail) || (uname && mname === uname);
      });
      return createdByMe || inTeam;
    });
  }, [showMyProjectsOnly, user]);

  const filteredActiveProjects = useMemo(() => filterProjectsByUser(quantActiveProjects), [filterProjectsByUser, quantActiveProjects]);
  const filteredArchivedProjects = useMemo(() => filterProjectsByUser(quantArchivedProjects), [filterProjectsByUser, quantArchivedProjects]);
  const displayProjects = activeTab === 'active' ? filteredActiveProjects : filteredArchivedProjects;

  // getQNRCount is now provided by the hook

  const handleProjectClick = useCallback((project: any) => {
    setSelectedProject(project);
    setViewMode('project');
    loadQuestionnaires(project.id);
  }, [loadQuestionnaires]);

  // filteredVariables is now provided by the hook

  // Get column headers from raw data
  const columnHeaders = useMemo(() => {
    return fullRawData?.columns || [];
  }, [fullRawData]);

  // Convert questionnaire questions to variables when questions or column headers change
  // This ensures variables are created for all questions, even if data hasn't been uploaded
  useEffect(() => {
    if (questionnaireQuestions.length > 0 && convertQuestionsToVariables) {
      convertQuestionsToVariables(questionnaireQuestions, columnHeaders);
    }
  }, [questionnaireQuestions, columnHeaders, convertQuestionsToVariables]);

  // Auto-create 7pt scale nets for single select questions and single select grids with "Scale (7pt)" tag
  useEffect(() => {
    if (!showConfigPopup || !configPopupVariable) return;
    
    const popupVariableName = configPopupVariable.name;
    const typeLower = configPopupVariable.type?.toLowerCase() || '';
    const isSingleSelect = typeLower.includes('single select') && !typeLower.includes('grid');
    const isSingleSelectGrid = typeLower.includes('single select grid');
    
    if (!isSingleSelect && !isSingleSelectGrid) return;
    
    const existingNets = netSummaryTableSelectedCodes[popupVariableName] || [];
    if (existingNets.length > 0) return; // Already has nets, don't auto-create
    
    const tags = (configPopupVariable as any)?.tags || [];
    const hasScale7ptTag = tags.some((tag: string) => /Scale\s*\(7pt\)/i.test(tag));
    if (!hasScale7ptTag) return;
    
    // Get response options
    // For single select grids, use responseOptions (columns)
    // For single select (non-grid), use codes
    const responseOptions: Array<{ code: string; text: string }> = [];
    
    if (isSingleSelectGrid) {
      // For single select grids, get responseOptions from matching question
      const baseQuestionNumber = popupVariableName.replace(/^Q/i, '').split('_')[0];
      const matchingQuestion = questionnaireQuestions.find(question => {
        const qNum = question.number || question.id;
        if (!qNum) return false;
        const qNumStr = String(qNum);
        const normalizedQNum = qNumStr.replace(/^Q/i, '');
        const normalizedBase = baseQuestionNumber.replace(/^Q/i, '');
        return (
          qNumStr === baseQuestionNumber ||
          normalizedQNum === normalizedBase ||
          `Q${normalizedQNum}` === baseQuestionNumber
        );
      });
      
      if (matchingQuestion && Array.isArray(matchingQuestion.responseOptions)) {
        matchingQuestion.responseOptions.forEach((opt: any, idx: number) => {
          if (typeof opt === 'string') {
            responseOptions.push({ code: `c${idx + 1}`, text: opt });
          } else {
            responseOptions.push({
              code: opt.code || `c${idx + 1}`,
              text: opt.text || opt.label || opt.value || opt.code || `Option ${idx + 1}`,
            });
          }
        });
      }
    } else {
      // For single select (non-grid), use codes
      if (configPopupVariable.codes && Object.keys(configPopupVariable.codes).length > 0) {
        Object.entries(configPopupVariable.codes).forEach(([code, text]) => {
          responseOptions.push({ code, text: String(text || code) });
        });
      } else {
        const baseQuestionNumber = popupVariableName.replace(/^Q/i, '').split('_')[0];
        const matchingQuestion = questionnaireQuestions.find(question => {
          const qNum = question.number || question.id;
          if (!qNum) return false;
          const qNumStr = String(qNum);
          const normalizedQNum = qNumStr.replace(/^Q/i, '');
          const normalizedBase = baseQuestionNumber.replace(/^Q/i, '');
          return (
            qNumStr === baseQuestionNumber ||
            normalizedQNum === normalizedBase ||
            `Q${normalizedQNum}` === baseQuestionNumber
          );
        });
        
        if (matchingQuestion && Array.isArray(matchingQuestion.responseOptions)) {
          matchingQuestion.responseOptions.forEach((opt: any, idx: number) => {
            if (typeof opt === 'string') {
              responseOptions.push({ code: `c${idx + 1}`, text: opt });
            } else {
              responseOptions.push({
                code: opt.code || `c${idx + 1}`,
                text: opt.text || opt.label || opt.value || opt.code || `Option ${idx + 1}`,
              });
            }
          });
        }
      }
    }
    
    if (responseOptions.length < 7) return; // Need at least 7 options for 7pt scale
    
    // Map numeric codes 1-7 to actual response option codes
    const getCodeForIndex = (index: number): string => {
      // Try to find response option at index (0-based, so index 0 = code 1, index 6 = code 7)
      if (responseOptions[index]) {
        return responseOptions[index].code;
      }
      // Fallback: try to find by numeric value
      const numericCode = String(index + 1);
      const found = responseOptions.find(opt => {
        const optCode = String(opt.code).replace(/^[rc]/i, '');
        return optCode === numericCode;
      });
      return found ? found.code : numericCode;
    };
    
    // Create the three nets: Top 2 Box (6-7), Middle 3 Box (3-5), Bottom 2 Box (1-2)
    const top2BoxCodes = [getCodeForIndex(5), getCodeForIndex(6)]; // codes 6-7 (indices 5-6)
    const middle3BoxCodes = [getCodeForIndex(2), getCodeForIndex(3), getCodeForIndex(4)]; // codes 3-5 (indices 2-4)
    const bottom2BoxCodes = [getCodeForIndex(0), getCodeForIndex(1)]; // codes 1-2 (indices 0-1)
    
    // For single select grids, nets should have context 'summary'
    // For single select (non-grid), no context needed (default behavior)
    const nets = [
      { name: 'Top 2 Box', codes: top2BoxCodes },
      { name: 'Middle 3 Box', codes: middle3BoxCodes },
      { name: 'Bottom 2 Box', codes: bottom2BoxCodes },
    ];
    
    setNetSummaryTableSelectedCodes(prev => ({
      ...prev,
      [popupVariableName]: nets,
    }));
    
    // Select all three nets by default
    const netTableIds = [
      `${popupVariableName}_NetSummaryTable_0`,
      `${popupVariableName}_NetSummaryTable_1`,
      `${popupVariableName}_NetSummaryTable_2`,
    ];
    setVariableTableSelections(prev => {
      const currentSet = prev[popupVariableName] ? new Set(prev[popupVariableName]) : new Set<string>();
      netTableIds.forEach(id => currentSet.add(id));
      return {
        ...prev,
        [popupVariableName]: currentSet,
      };
    });
  }, [showConfigPopup, configPopupVariable, netSummaryTableSelectedCodes, questionnaireQuestions, setNetSummaryTableSelectedCodes, setVariableTableSelections]);

  // Apply default selections when config popup opens (if no selections exist)
  useEffect(() => {
    if (!showConfigPopup || !configPopupVariable) return;
    
    const popupVariableName = configPopupVariable.name;
    
    // Check if there are already selections for this variable
    const currentSelections = variableTableSelections[popupVariableName];
    const hasExistingSelections = currentSelections && currentSelections.size > 0;
    
    // Only apply defaults if no selections exist
    if (hasExistingSelections) return;
    
    // Get default table selections
    const defaultTableSelections = getDefaultTableSelectionsForVariable(
      configPopupVariable,
      questionnaireQuestions
    );
    
    if (defaultTableSelections.size > 0) {
      setVariableTableSelections(prev => {
        const currentSet = prev[popupVariableName] ? new Set(prev[popupVariableName]) : new Set<string>();
        defaultTableSelections.forEach(id => currentSet.add(id));
        return {
          ...prev,
          [popupVariableName]: currentSet,
        };
      });
    }
    
    // Get default stats selections
    const defaultStats = getDefaultStatsSelectionsForVariable(configPopupVariable);
    const hasDefaultStats = Object.values(defaultStats).some(v => v === true);
    
    if (hasDefaultStats) {
      const currentStats = variableStatsSelections[popupVariableName];
      if (!currentStats) {
        setVariableStatsSelections(prev => ({
          ...prev,
          [popupVariableName]: defaultStats,
        }));
      }
    }
    
    // Get default sort and hold settings
    // Get response options for the variable
    const responseOptions: Array<{ code: string; text: string }> = [];
    if (configPopupVariable.codes && Object.keys(configPopupVariable.codes).length > 0) {
      Object.entries(configPopupVariable.codes).forEach(([code, text]) => {
        responseOptions.push({ code, text: String(text || code) });
      });
    } else {
      const baseQuestionNumber = popupVariableName.replace(/^Q/i, '').split('_')[0];
      const matchingQuestion = questionnaireQuestions.find(question => {
        const qNum = question.number || question.id;
        if (!qNum) return false;
        const qNumStr = String(qNum);
        const normalizedQNum = qNumStr.replace(/^Q/i, '');
        const normalizedBase = baseQuestionNumber.replace(/^Q/i, '');
        return (
          qNumStr === baseQuestionNumber ||
          normalizedQNum === normalizedBase ||
          `Q${normalizedQNum}` === baseQuestionNumber
        );
      });
      
      if (matchingQuestion && Array.isArray(matchingQuestion.responseOptions)) {
        matchingQuestion.responseOptions.forEach((opt: any, idx: number) => {
          if (typeof opt === 'string') {
            responseOptions.push({ code: `c${idx + 1}`, text: opt });
          } else {
            responseOptions.push({
              code: opt.code || `c${idx + 1}`,
              text: opt.text || opt.label || opt.value || opt.code || `Option ${idx + 1}`,
            });
          }
        });
      }
    }
    
    const { sortByFrequency, holdCodes } = getDefaultSortAndHoldForVariable(
      configPopupVariable,
      responseOptions
    );
    
    // Apply default sort setting if needed
    if (sortByFrequency) {
      const currentSort = variableSortByFrequency[popupVariableName];
      if (currentSort === undefined) {
        setVariableSortByFrequency(prev => ({
          ...prev,
          [popupVariableName]: true,
        }));
      }
    }
    
    // Apply default hold codes if needed
    if (holdCodes.length > 0) {
      const currentHold = variableHoldResponseCodes[popupVariableName];
      if (!currentHold || currentHold.length === 0) {
        handleHoldOptionsToggle(popupVariableName, true, holdCodes);
      }
    }
  }, [showConfigPopup, configPopupVariable, variableTableSelections, variableStatsSelections, variableSortByFrequency, variableHoldResponseCodes, questionnaireQuestions, setVariableTableSelections, setVariableStatsSelections, setVariableSortByFrequency, handleHoldOptionsToggle]);

  // Helper function to get expected column headers for a base question number
  // Use extracted helper functions
  const getExpectedColumnHeadersForBase = useCallback((baseQuestionNumber: string, allVariables: Variable[]): string[] => {
    return getExpectedColumnHeadersForBaseUtil(baseQuestionNumber, allVariables);
  }, []);

  const getExpectedHeadersForQuestion = useCallback((question: any, baseQuestionNumber?: string): string[] => {
    return getExpectedHeadersForQuestionUtil(question, baseQuestionNumber, variables, getExpectedColumnHeadersForBase);
  }, [variables, getExpectedColumnHeadersForBase]);

  // Data mapping memo for mapping status
  const dataMappingMemo = useMemo(() => {
    if (variables.length === 0) {
      return { filteredHeaders: [], mappingStatusMap: new Map<string, { isMapped: boolean; mappedColumnHeader: string; mappedVariableName: string }>() };
    }
    
    const mappingStatusMap = new Map<string, { isMapped: boolean; mappedColumnHeader: string; mappedVariableName: string }>();
    
    variables.forEach((variable) => {
      if (variable.name.endsWith('_Summary Tables') || 
          variable.name.endsWith('_T2B') || 
          variable.name.endsWith('_B2B') || 
          variable.name.endsWith('_M3B') ||
          (variable as any).isSummaryTable) {
        return;
      }
      
      const baseNumber = getBaseQuestionNumber(variable.name);
      const question = questionnaireQuestions.find(q => {
        const qNum = q.number || q.id;
        return qNum === baseNumber || 
               qNum === baseNumber.replace(/^Q/, '') ||
               String(qNum) === String(baseNumber);
      });
      
      if (question) {
        const expectedHeaders = getExpectedHeadersForQuestion(question, baseNumber);
        expectedHeaders.forEach(expectedHeader => {
          const mappedColumn = columnMapping[expectedHeader] || columnMapping[expectedHeader.replace(/^Q/, '')] || '';
          const isMapped: boolean = !!(mappedColumn && (
            columnHeaders.some(h => h.toLowerCase().trim() === mappedColumn.toLowerCase().trim()) ||
            (fullRawData?.columns && fullRawData.columns.some((c: string) => c.toLowerCase().trim() === mappedColumn.toLowerCase().trim()))
          ));
          
          mappingStatusMap.set(expectedHeader, {
            isMapped,
            mappedColumnHeader: mappedColumn,
            mappedVariableName: variable.name
          });
        });
      }
    });
    
    return { filteredHeaders: [], mappingStatusMap };
  }, [variables, questionnaireQuestions, columnMapping, columnHeaders, fullRawData, getExpectedHeadersForQuestion, getBaseQuestionNumber]);

  const tabSpecsTypeOptions = useMemo(() => {
    const types = new Set<string>();
    // Use questionnaireQuestions as primary source, fallback to variables if questions not available
    const source = questionnaireQuestions.length > 0 ? questionnaireQuestions : variables;
    source.forEach((item: any) => {
      const type = item.type || (item as Variable).type;
      if (type) types.add(type);
    });
    return Array.from(types).sort();
  }, [questionnaireQuestions, variables]);

  // Memoized saved coding themes from localStorage
  const savedCodingThemes = useMemo(() => {
    if (!selectedQuestionnaire?.id) return new Map<string, Array<{ code: number; theme: string }>>();
    const key = `openEndCodingThemes_${selectedQuestionnaire.id}`;
    const stored = localStorage.getItem(key);
    if (stored) {
      try {
        const parsed = JSON.parse(stored) as Array<[string, Array<{ code: number; theme: string }>]>;
        return new Map<string, Array<{ code: number; theme: string }>>(parsed);
      } catch (e) {
        return new Map<string, Array<{ code: number; theme: string }>>();
      }
    }
    return new Map<string, Array<{ code: number; theme: string }>>();
  }, [selectedQuestionnaire?.id]);

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

  // Load archived projects
  useEffect(() => {
    const loadArchivedProjects = async () => {
      if (!user?.id) return;
      try {
        const response = await fetch(`${API_BASE_URL}/api/projects/archived?userId=${user.id}`, {
          headers: { 'Authorization': `Bearer ${localStorage.getItem('cognitive_dash_token')}` }
        });
        if (response.ok) {
          const data = await response.json();
          const archived = Array.isArray(data?.projects) ? data.projects : [];
          setArchivedProjects(archived);
        } else {
          console.error('Failed to load archived projects');
          setArchivedProjects([]);
        }
      } catch (error) {
        console.error('Error loading archived projects:', error);
        setArchivedProjects([]);
      }
    };
    loadArchivedProjects();
  }, [user?.id]);

  // Check for project navigation from Project Hub
  useEffect(() => {
    try {
      const storedProjectId = sessionStorage.getItem('cognitive_dash_tabs_focus_project');
      const storedViewMode = sessionStorage.getItem('cognitive_dash_tabs_view_mode');
      if (storedProjectId && (projects.length > 0 || archivedProjects.length > 0)) {
        const allProjects = [...projects, ...archivedProjects];
        const targetProject = allProjects.find(p => p.id === storedProjectId);
        if (targetProject) {
          setSelectedProject(targetProject);
          if (storedViewMode === 'project') {
            setViewMode('project');
            loadQuestionnaires(targetProject.id);
          }
          if (targetProject.archived) {
            setActiveTab('archived');
          } else {
            setActiveTab('active');
          }
          sessionStorage.removeItem('cognitive_dash_tabs_focus_project');
          sessionStorage.removeItem('cognitive_dash_tabs_view_mode');
        }
      }
    } catch (error) {
      // Silent fail
    }
  }, [projects, archivedProjects, loadQuestionnaires]);

  return (
    <>
      <div className="flex-1 p-6 space-y-4 max-w-full overflow-y-auto" style={{ height: 'calc(100vh - 80px)', marginTop: '80px', backgroundColor: BRAND_BG }}>
        {/* Home View - Project List */}
        {viewMode === 'home' && (
          <HomeView
            activeTab={activeTab}
            onActiveTabChange={setActiveTab}
            filteredActiveProjects={filteredActiveProjects}
            filteredArchivedProjects={filteredArchivedProjects}
            displayProjects={displayProjects}
            showMyProjectsOnly={showMyProjectsOnly}
            onShowMyProjectsOnlyChange={setShowMyProjectsOnly}
            user={user}
            onProjectClick={handleProjectClick}
            getQNRCount={getQNRCount}
          />
        )}

        {/* Project View - Questionnaire List */}
        {viewMode === 'project' && selectedProject && (
          <ProjectView
            selectedProject={selectedProject}
            questionnaires={questionnaires}
            showMyProjectsOnly={showMyProjectsOnly}
            onShowMyProjectsOnlyChange={setShowMyProjectsOnly}
            user={user}
            onBackToHome={() => {
                    setViewMode('home');
                    setSelectedProject(null);
                    setQuestionnaires([]);
                    setSelectedQuestionnaire(null);
                    setVariables([]);
                    setSelectedVariable(null);
                  }}
            onQuestionnaireClick={(qnr) => {
                            setSelectedQuestionnaire(qnr);
                            setViewMode('qnr');
                          }}
          />
        )}

        {/* QNR View - Main Tab View */}
        {viewMode === 'qnr' && selectedQuestionnaire && selectedProject && (
          <>
            <div>
              <div className="flex items-center justify-between">
                <nav className="-mb-px flex space-x-8 items-center">
                  <button
                    onClick={() => setQnrViewMode('tabSpecs')}
                    className={`py-2 px-1 border-b-2 font-medium text-sm ${
                      qnrViewMode === 'tabSpecs'
                        ? 'text-white'
                        : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                    }`}
                    style={qnrViewMode === 'tabSpecs' ? { borderBottomColor: BRAND_ORANGE, color: BRAND_ORANGE } : {}}
                  >
                    Tab Specs
                  </button>
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
              </div>
              <div className="border-b border-gray-200"></div>
            </div>

            <div className="bg-white shadow-sm border border-gray-200 rounded-lg overflow-hidden">
              {qnrViewMode === 'tabSpecs' && (
                <TabSpecsView
                  tabSpecsSubView={tabSpecsSubView}
                  onTabSpecsSubViewChange={setTabSpecsSubView}
                  tabSpecsTypeFilter={tabSpecsTypeFilter}
                  onTabSpecsTypeFilterChange={setTabSpecsTypeFilter}
                  tabSpecsTypeOptions={tabSpecsTypeOptions}
                  specsResetKey={specsResetKey}
                  selectedQuestionnaire={selectedQuestionnaire}
                  questionnaireQuestions={questionnaireQuestions}
                  variables={variables}
                  variableTableSelections={variableTableSelections}
                  onQuestionClick={(question, displayVariable) => {
                    if (displayVariable) {
                      setConfigPopupVariable(displayVariable);
                    } else {
                                  const qNum = question.number || question.id;
                                  const qNumStr = String(qNum);
                                  const tags = question.tags || [];
                                  const questionText = question.text || question.question || question.description || qNumStr;
                                  const questionType = question.type || 'Unknown';
                                          const tempVariable: Variable = {
                                            name: qNumStr,
                                            description: questionText,
                                            type: questionType,
                                            codes: question.responseOptions ? Object.fromEntries(
                                              question.responseOptions.map((opt: any, idx: number) => {
                                                const code = typeof opt === 'string' ? `c${idx + 1}` : (opt.code || `c${idx + 1}`);
                                                const text = typeof opt === 'string' ? opt : (opt.text || opt.label || code);
                                                return [code, text];
                                              })
                                            ) : undefined,
                                            statements: question.statementOptions ? Object.fromEntries(
                                              question.statementOptions.map((stmt: any, idx: number) => {
                                                const code = typeof stmt === 'string' ? `r${idx + 1}` : (stmt.code || `r${idx + 1}`);
                                                const text = typeof stmt === 'string' ? stmt : (stmt.text || stmt.label || code);
                                                return [code, text];
                                              })
                                            ) : undefined,
                                            tags: tags,
                                          };
                                          setConfigPopupVariable(tempVariable);
                                        }
                                        setShowConfigPopup(true);
                                      }}
                  onShowSettingsPopup={() => setShowSettingsPopup(true)}
                  showBannerBuilder={showBannerBuilder}
                  selectedNewBannerGroupId={selectedNewBannerGroupId}
                  editingBannerGroup={editingBannerGroup}
                  newBannerGroups={newBannerGroups}
                  bannerFilterConditions={bannerFilterConditions}
                  fullRawData={fullRawData}
                          columnMapping={columnMapping}
                  getExpectedHeadersForQuestion={getExpectedHeadersForQuestion}
                  bannerSettingsOpenRef={bannerSettingsOpenRef}
                  bannerSpecsFileInputRef={bannerSpecsFileInputRef}
                  onBannerSpecsFileChange={handleBannerSpecsFileChange}
                  onHandleClickImportBannerSpecs={handleClickImportBannerSpecs}
                  onBannerEdit={(group) => {
                              setEditingBannerGroup(group);
                              setShowBannerBuilder(true);
                            }}
                  onBannerDelete={(groupId) => {
                              if (window.confirm('Are you sure you want to delete this banner group?')) {
                                setNewBannerGroups(prev => prev.filter(g => g.id !== groupId));
                              }
                            }}
                  onBannerChange={handleBannerChange}
                  onBannerSave={() => {
                    if (editingBannerGroup) {
                      handleBannerSave(editingBannerGroup);
                    }
                  }}
                  onBannerCancel={handleBannerCancel}
                  onBannerFilterConditionsChange={setBannerFilterConditions}
                />
              )}

                    {qnrViewMode === 'variables' && (
                      <VariablesView
                          variables={variables}
                          filteredVariables={filteredVariables}
                          selectedVariable={selectedVariable}
                        onSelectVariable={setSelectedVariable}
                        variableFilter={variableFilter}
                        onVariableFilterChange={setVariableFilter}
                          questionTypeFilter={questionTypeFilter || ''}
                          onQuestionTypeFilterChange={setQuestionTypeFilter}
                          showQuestionTypeFilter={showQuestionTypeFilter}
                          onToggleQuestionTypeFilter={() => setShowQuestionTypeFilter(!showQuestionTypeFilter)}
                          loading={loading || false}
                          loadingFullRawData={loadingFullRawData || false}
                          getVariableDataByExpectedHeader={getVariableDataByExpectedHeader}
                          questionnaireQuestions={questionnaireQuestions}
                          columnMapping={columnMapping}
                          columnHeaders={columnHeaders}
                          fullRawData={fullRawData}
                          datamapData={datamapData}
                          dataMappingMemo={dataMappingMemo}
                          hiddenFromBanners={hiddenFromBanners}
                          getExpectedHeadersForQuestion={getExpectedHeadersForQuestion}
                          convertHiddenVariableToExpectedHeader={convertHiddenVariableToExpectedHeader}
                          netSummaryTableSelectedCodes={netSummaryTableSelectedCodes}
                          variableTableSelections={variableTableSelections}
                          summaryTableSortSelections={summaryTableSortSelections}
                          variableSortByFrequency={variableSortByFrequency}
                          variableHoldResponseCodes={variableHoldResponseCodes}
                          getStatsSelectionsForVariable={getStatsSelectionsForVariable}
                      />
                    )}

                    {qnrViewMode === 'data' && (
                      <DataTab
                        selectedQuestionnaire={selectedQuestionnaire}
                        selectedProject={selectedProject}
                        fullRawData={fullRawData}
                        loadingFullRawData={loadingFullRawData}
                        rawDataPage={rawDataPage}
                        rawDataRowsPerPage={rawDataRowsPerPage}
                        rawDataColumnStart={rawDataColumnStart}
                        rawDataColumnsPerPage={rawDataColumnsPerPage}
                        onPageChange={setRawDataPage}
                        onColumnChange={setRawDataColumnStart}
                        columnMapping={columnMapping}
                        variables={variables}
                        questionnaireQuestions={questionnaireQuestions}
                        datamapData={datamapData}
                        loadingDatamap={loadingDatamap}
                        columnHeaders={columnHeaders}
                        hasAttemptedMapping={hasAttemptedMapping}
                        mappingVariables={mappingVariables}
                        getExpectedHeadersForQuestion={getExpectedHeadersForQuestion}
                        getExpectedColumnHeadersForBase={getExpectedColumnHeadersForBase}
                        dataMappingMemo={dataMappingMemo}
                        savedCodingThemes={savedCodingThemes || new Map()}
                        codedHeadersDebug={{}}
                        onDataUploaded={() => {
                          // Clear existing data and force reload raw data after upload
                          setFullRawData(null);
                          loadFullRawData(true);
                        }}
                        onDataDeleted={() => {
                          // Clear raw data after deletion
                          setFullRawData(null);
                        }}
                        onClearDatamap={() => {
                          // Clear datamap data after file deletion
                          setDatamapData(null);
                        }}
                        onColumnHeadersChange={(headers) => {
                          // Column headers come from fullRawData.columns
                        }}
                        onColumnMappingChange={(mapping) => {
                          setColumnMapping(mapping);
                        }}
                        onPerformAutomaticMapping={async (forceRemap: boolean) => {
                          if (!selectedQuestionnaire || !selectedProject) {
                            alert('Please select a questionnaire and project');
                            return;
                          }
                          
                          if (!fullRawData?.columns || fullRawData.columns.length === 0) {
                            alert('No data file columns found. Please upload a data file first.');
                            return;
                          }
                          
                          if (!questionnaireQuestions || questionnaireQuestions.length === 0) {
                            alert('No questionnaire questions found. Please sync with QNR first.');
                            return;
                          }

                          setMappingVariables(true);
                          const startTime = Date.now();
                          try {
                            // Generate expected headers from questionnaire questions (same as manual mapping)
                            const allExpectedHeaders: string[] = [];
                            const expectedHeadersSet = new Set<string>();
                            
                            questionnaireQuestions.forEach((question) => {
                              const expectedHeaders = getExpectedHeadersForQuestion(question);
                              expectedHeaders.forEach(header => {
                                if (!expectedHeadersSet.has(header)) {
                                  expectedHeadersSet.add(header);
                                  allExpectedHeaders.push(header);
                                }
                              });
                            });
                            
                            if (allExpectedHeaders.length === 0) {
                              alert('No expected headers generated from questionnaire. Please check your QNR questions.');
                              return;
                            }
                            
                            // Convert expected headers to variables format for autoMatchHeaders
                            const variablesForMatching = allExpectedHeaders.map(header => ({
                              name: header,
                              type: 'Unknown',
                              description: ''
                            }));
                            
                            const columnHeaders = fullRawData.columns;
                            
                            console.log('Auto-mapping:', { 
                              columnHeadersCount: columnHeaders.length, 
                              expectedHeadersCount: allExpectedHeaders.length,
                              variablesCount: variablesForMatching.length 
                            });
                            
                            // Get existing mapping if not forcing remap
                            let existingMapping = {};
                            if (!forceRemap && columnMapping && Object.keys(columnMapping).length > 0) {
                              existingMapping = columnMapping;
                            }
                            
                            // Perform automatic matching
                            const newMapping = autoMatchHeaders(variablesForMatching, columnHeaders);
                            
                            console.log('Matching results:', { 
                              newMatches: Object.keys(newMapping).length,
                              existingMappings: Object.keys(existingMapping).length
                            });
                            
                            // Merge with existing mapping (preserve manual mappings unless forceRemap)
                            const finalMapping = forceRemap 
                              ? newMapping 
                              : { ...existingMapping, ...newMapping };
                            
                            setColumnMapping(finalMapping);
                            setHasAttemptedMapping(true);
                            
                            // Save to server
                            if (selectedQuestionnaire) {
                              await fetch(`${API_BASE_URL}/api/questionnaire/column-mapping/${selectedQuestionnaire.id}`, {
                                method: 'PUT',
                                headers: {
                                  'Authorization': `Bearer ${localStorage.getItem('cognitive_dash_token')}`,
                                  'Content-Type': 'application/json'
                                },
                                body: JSON.stringify({ columnMapping: finalMapping })
                              }).catch(err => console.error('Error saving mapping:', err));
                            }
                            
                            // Ensure minimum 2-second delay
                            const elapsedTime = Date.now() - startTime;
                            const minDelay = 2000; // 2 seconds
                            if (elapsedTime < minDelay) {
                              await new Promise(resolve => setTimeout(resolve, minDelay - elapsedTime));
                            }
                          } catch (error: any) {
                            console.error('Error during auto-mapping:', error);
                            alert(`Failed to auto-map: ${error.message || 'Unknown error'}`);
                            
                            // Ensure minimum 2-second delay even on error
                            const elapsedTime = Date.now() - startTime;
                            const minDelay = 2000; // 2 seconds
                            if (elapsedTime < minDelay) {
                              await new Promise(resolve => setTimeout(resolve, minDelay - elapsedTime));
                            }
                          } finally {
                            setMappingVariables(false);
                          }
                        }}
                        onLoadDatamap={loadDatamap}
                        onSetQuestionnaireQuestions={setQuestionnaireQuestions}
                        onSetHasAttemptedMapping={setHasAttemptedMapping}
                        onSetMappingVariables={setMappingVariables}
                        onSetShowMappingInfoModal={() => setShowMappingInfoModal(true)}
                        onSetShowManualMappingModal={() => setShowManualMappingModal(true)}
                        onSetSelectedMappingHeader={setSelectedMappingHeader}
                        onSetManualMappingSearch={setManualMappingSearch}
                      />
                    )}

            </div>
          </>
        )}

        {/* Modals */}
        <NetSummaryModal
          isOpen={netSummaryModalState.isOpen}
          onClose={closeNetSummaryModal}
          state={netSummaryModalState}
          onChange={handleNetSummaryModalFieldChange}
          onCodeToggle={handleNetSummaryModalCodeToggle}
          onSave={handleNetSummaryModalSave}
          variable={variables.find(v => v.name === netSummaryModalState.variableName) || null}
        />

        <DebugModal
          isOpen={showDebugInfoModal}
          onClose={() => {
            setShowDebugInfoModal(false);
            setDebugInfoModalVariable(null);
            setDebugInfoModalTableName(undefined);
          }}
          variable={debugInfoModalVariable}
          tableName={debugInfoModalTableName}
          questionnaireQuestions={questionnaireQuestions}
          fullRawData={fullRawData}
          statsSelections={debugInfoModalVariable ? getStatsSelectionsForVariable(debugInfoModalVariable.name) : undefined}
          variableSortByFrequency={debugInfoModalVariable ? variableSortByFrequency[debugInfoModalVariable.name] : false}
          netSummaryTableSelectedCodes={debugInfoModalVariable ? (netSummaryTableSelectedCodes[debugInfoModalVariable.name] || []) : []}
          netSummaryTableRanges={debugInfoModalVariable ? (netSummaryTableRanges[debugInfoModalVariable.name] || []) : []}
        />

        <ManualMappingModal
          isOpen={showManualMappingModal}
          onClose={() => {
            setShowManualMappingModal(false);
            setSelectedMappingHeader(null);
            setManualMappingSearch('');
          }}
          selectedHeader={selectedMappingHeader}
          columnHeaders={columnHeaders}
          searchValue={manualMappingSearch}
          onSearchChange={setManualMappingSearch}
          onSelect={(expectedHeader, columnHeader) => {
            // Update the column mapping
            const newMapping = { ...columnMapping };
            newMapping[expectedHeader] = columnHeader;
            setColumnMapping(newMapping);
            
            // Save to server
            if (selectedQuestionnaire) {
              fetch(`${API_BASE_URL}/api/questionnaire/column-mapping/${selectedQuestionnaire.id}`, {
                method: 'PUT',
                headers: {
                  'Authorization': `Bearer ${localStorage.getItem('cognitive_dash_token')}`,
                  'Content-Type': 'application/json'
                },
                body: JSON.stringify({ columnMapping: newMapping })
              }).catch(err => console.error('Error saving mapping:', err));
            }
          }}
          onUnmap={(expectedHeader) => {
            // Remove the mapping
            const newMapping = { ...columnMapping };
            delete newMapping[expectedHeader];
            // Also try without Q prefix
            const headerWithoutQ = expectedHeader.replace(/^Q/, '');
            if (newMapping[headerWithoutQ]) {
              delete newMapping[headerWithoutQ];
            }
            setColumnMapping(newMapping);
            
            // Save to server
            if (selectedQuestionnaire) {
              fetch(`${API_BASE_URL}/api/questionnaire/column-mapping/${selectedQuestionnaire.id}`, {
                method: 'PUT',
                headers: {
                  'Authorization': `Bearer ${localStorage.getItem('cognitive_dash_token')}`,
                  'Content-Type': 'application/json'
                },
                body: JSON.stringify({ columnMapping: newMapping })
              }).catch(err => console.error('Error saving mapping:', err));
            }
          }}
          existingMapping={columnMapping}
        />

                <DataCutsView
                  isOpen={showDataCutsView}
                  onClose={() => setShowDataCutsView(false)}
                  data={null}
                  loading={dataCutsLoading}
                />

                {/* Settings Popup Modal */}
                <SettingsPopupModal
                  isOpen={showSettingsPopup}
                  onClose={() => setShowSettingsPopup(false)}
                  significanceLevel={significanceLevel}
                  onSignificanceLevelChange={setSignificanceLevel}
                  percentageDecimals={percentageDecimals}
                  onPercentageDecimalsChange={setPercentageDecimals}
                  variables={variables}
                  questionnaireQuestions={questionnaireQuestions}
                  selectedQuestionnaire={selectedQuestionnaire}
                  onResetSpecs={() => {
                              // Reset all selections to defaults by applying defaults for all variables
                              const newTableSelections: Record<string, Set<string>> = {};
                              const newStatsSelections: Record<string, VariableStatsSelection> = {};
                              const newSortByFrequency: Record<string, boolean> = {};
                              const newHoldResponseCodes: Record<string, string[]> = {};
                              const newNetSummaryTableSelectedCodes: Record<string, Array<{ name: string; codes: string[] }>> = {};
                              
                              // Apply defaults for each variable
                              variables.forEach(variable => {
                                const variableName = variable.name;
                                
                                // Get default table selections
                                const defaultTableSelections = getDefaultTableSelectionsForVariable(
                                  variable,
                                  questionnaireQuestions
                                );
                                if (defaultTableSelections.size > 0) {
                                  newTableSelections[variableName] = defaultTableSelections;
                                }
                                
                                // Get default stats selections
                                const defaultStats = getDefaultStatsSelectionsForVariable(variable);
                                const hasDefaultStats = Object.values(defaultStats).some(v => v === true);
                                if (hasDefaultStats) {
                                  newStatsSelections[variableName] = defaultStats;
                                }
                                
                                // Get default sort and hold settings
                                // Get response options for the variable
                                const responseOptions: Array<{ code: string; text: string }> = [];
                                if (variable.codes && Object.keys(variable.codes).length > 0) {
                                  Object.entries(variable.codes).forEach(([code, text]) => {
                                    responseOptions.push({ code, text: String(text || code) });
                                  });
                                } else {
                                  const baseQuestionNumber = variableName.replace(/^Q/i, '').split('_')[0];
                                  const matchingQuestion = questionnaireQuestions.find(question => {
                                    const qNum = question.number || question.id;
                                    if (!qNum) return false;
                                    const qNumStr = String(qNum);
                                    const normalizedQNum = qNumStr.replace(/^Q/i, '');
                                    const normalizedBase = baseQuestionNumber.replace(/^Q/i, '');
                                    return (
                                      qNumStr === baseQuestionNumber ||
                                      normalizedQNum === normalizedBase ||
                                      `Q${normalizedQNum}` === baseQuestionNumber
                                    );
                                  });
                                  
                                  if (matchingQuestion && Array.isArray(matchingQuestion.responseOptions)) {
                                    matchingQuestion.responseOptions.forEach((opt: any, idx: number) => {
                                      if (typeof opt === 'string') {
                                        responseOptions.push({ code: `c${idx + 1}`, text: opt });
                                      } else {
                                        responseOptions.push({
                                          code: opt.code || `c${idx + 1}`,
                                          text: opt.text || opt.label || opt.value || opt.code || `Option ${idx + 1}`,
                                        });
                                      }
                                    });
                                  }
                                }
                                
                                const { sortByFrequency, holdCodes } = getDefaultSortAndHoldForVariable(
                                  variable,
                                  responseOptions
                                );
                                
                                if (sortByFrequency) {
                                  newSortByFrequency[variableName] = true;
                                }
                                
                                if (holdCodes.length > 0) {
                                  newHoldResponseCodes[variableName] = holdCodes;
                                }
                                
                                // Create default 7pt scale nets for single select variables with Scale (7pt) tag
                                const varTypeLower = variable.type?.toLowerCase() || '';
                                const isVarSingleSelect = varTypeLower.includes('single select') && !varTypeLower.includes('grid');
                                const isVarSingleSelectGrid = varTypeLower.includes('single select grid');
                                
                                if ((isVarSingleSelect || isVarSingleSelectGrid)) {
                                  const varTags = (variable as any)?.tags || [];
                                  const hasScale7ptTag = varTags.some((tag: string) => /Scale\s*\(7pt\)/i.test(tag));
                                  
                                  if (hasScale7ptTag) {
                                    // Get response options for this variable
                                    const varResponseOptions: Array<{ code: string; text: string }> = [];
                                    
                                    if (isVarSingleSelectGrid) {
                                      // For single select grids, get responseOptions from matching question
                                      const varBaseQuestionNumber = variableName.replace(/^Q/i, '').split('_')[0];
                                      const varMatchingQuestion = questionnaireQuestions.find(question => {
              const qNum = question.number || question.id;
              if (!qNum) return false;
              const qNumStr = String(qNum);
              const normalizedQNum = qNumStr.replace(/^Q/i, '');
                                        const normalizedBase = varBaseQuestionNumber.replace(/^Q/i, '');
              return (
                                          qNumStr === varBaseQuestionNumber ||
                normalizedQNum === normalizedBase ||
                                          `Q${normalizedQNum}` === varBaseQuestionNumber
              );
            });
            
                                      if (varMatchingQuestion && Array.isArray(varMatchingQuestion.responseOptions)) {
                                        varMatchingQuestion.responseOptions.forEach((opt: any, idx: number) => {
                  if (typeof opt === 'string') {
                                            varResponseOptions.push({ code: `c${idx + 1}`, text: opt });
                                          } else {
                                            varResponseOptions.push({
                    code: opt.code || `c${idx + 1}`,
                    text: opt.text || opt.label || opt.value || opt.code || `Option ${idx + 1}`,
                                            });
                                          }
                                        });
                                      }
                                    } else {
                                      // For single select (non-grid), use codes
                                      if (variable.codes && Object.keys(variable.codes).length > 0) {
                                        Object.entries(variable.codes).forEach(([code, text]) => {
                                          varResponseOptions.push({ code, text: String(text || code) });
                                        });
                                      } else {
                                        const varBaseQuestionNumber = variableName.replace(/^Q/i, '').split('_')[0];
                                        const varMatchingQuestion = questionnaireQuestions.find(question => {
                                          const qNum = question.number || question.id;
                                          if (!qNum) return false;
                                          const qNumStr = String(qNum);
                                          const normalizedQNum = qNumStr.replace(/^Q/i, '');
                                          const normalizedBase = varBaseQuestionNumber.replace(/^Q/i, '');
                                          return (
                                            qNumStr === varBaseQuestionNumber ||
                                            normalizedQNum === normalizedBase ||
                                            `Q${normalizedQNum}` === varBaseQuestionNumber
                                          );
                                        });
                                        
                                        if (varMatchingQuestion && Array.isArray(varMatchingQuestion.responseOptions)) {
                                          varMatchingQuestion.responseOptions.forEach((opt: any, idx: number) => {
                  if (typeof opt === 'string') {
                                              varResponseOptions.push({ code: `c${idx + 1}`, text: opt });
                  } else {
                                              varResponseOptions.push({
                      code: opt.code || `c${idx + 1}`,
                                                text: opt.text || opt.label || opt.value || opt.code || `Option ${idx + 1}`,
                    });
                  }
                });
                                        }
                                      }
                                    }
                                    
                                    if (varResponseOptions.length >= 7) {
                                      // Map numeric codes 1-7 to actual response option codes
                                      const getCodeForIndex = (index: number): string => {
                                        if (varResponseOptions[index]) {
                                          return varResponseOptions[index].code;
                                        }
                                        const numericCode = String(index + 1);
                                        const found = varResponseOptions.find(opt => {
                                          const optCode = String(opt.code).replace(/^[rc]/i, '');
                                          return optCode === numericCode;
                                        });
                                        return found ? found.code : numericCode;
                                      };
                                      
                                      // Create the three nets: Top 2 Box (6-7), Middle 3 Box (3-5), Bottom 2 Box (1-2)
                                      const top2BoxCodes = [getCodeForIndex(5), getCodeForIndex(6)];
                                      const middle3BoxCodes = [getCodeForIndex(2), getCodeForIndex(3), getCodeForIndex(4)];
                                      const bottom2BoxCodes = [getCodeForIndex(0), getCodeForIndex(1)];
                                      
                                      newNetSummaryTableSelectedCodes[variableName] = [
                                        { name: 'Top 2 Box', codes: top2BoxCodes },
                                        { name: 'Middle 3 Box', codes: middle3BoxCodes },
                                        { name: 'Bottom 2 Box', codes: bottom2BoxCodes },
                                      ];
                                      
                                      // Select all three nets by default
                                      const netTableIds = [
                                        `${variableName}_NetSummaryTable_0`,
                                        `${variableName}_NetSummaryTable_1`,
                                        `${variableName}_NetSummaryTable_2`,
                                      ];
                                      netTableIds.forEach(id => {
                                        if (!newTableSelections[variableName]) {
                                          newTableSelections[variableName] = new Set<string>();
                                        }
                                        newTableSelections[variableName].add(id);
                                      });
                                    }
                                  }
                                }
                              });
                              
                              // Apply the new defaults
                              setVariableTableSelections(newTableSelections);
                              setVariableStatsSelections(newStatsSelections);
                              setVariableSortByFrequency(newSortByFrequency);
                              setNetSummaryTableSelectedCodes(newNetSummaryTableSelectedCodes);
                              
                              // Apply hold codes using the handler
                              Object.entries(newHoldResponseCodes).forEach(([varName, codes]) => {
                                handleHoldOptionsToggle(varName, true, codes);
                              });
                              
                              // Clear nets ranges and summary table sort selections (these don't have defaults)
                              setNetSummaryTableRanges({});
                              setSummaryTableSortSelections({});
                              
                              // Clear from localStorage
                              if (selectedQuestionnaire?.id) {
                                localStorage.removeItem(`variableTableSelections_${selectedQuestionnaire.id}`);
                                localStorage.removeItem(`variableStatsSelections_${selectedQuestionnaire.id}`);
                                localStorage.removeItem(`summaryTableSortSelections_${selectedQuestionnaire.id}`);
                                localStorage.removeItem(`variableSortByFrequency_${selectedQuestionnaire.id}`);
                                localStorage.removeItem(`variableHoldResponseCodes_${selectedQuestionnaire.id}`);
                                localStorage.removeItem(`holdSelections_${selectedQuestionnaire.id}`);
                                localStorage.removeItem(`netSummaryTableSelectedCodes_${selectedQuestionnaire.id}`);
                                localStorage.removeItem(`netSummaryTableRanges_${selectedQuestionnaire.id}`);
                              }
                              // Force re-render by changing key
                              setSpecsResetKey(prev => prev + 1);
                              setShowSettingsPopup(false);
                            }}
                />

        {/* Config Popup Modal */}
        <ConfigPopupModal
          isOpen={showConfigPopup}
                        variable={configPopupVariable}
          onClose={() => setShowConfigPopup(false)}
          questionnaireQuestions={questionnaireQuestions}
          variableTableSelections={variableTableSelections}
          summaryTableSortSelections={summaryTableSortSelections}
          variableSortByFrequency={variableSortByFrequency}
          variableHoldResponseCodes={variableHoldResponseCodes}
          holdOptionsDropdownOpen={holdOptionsDropdownOpen}
          netSummaryTableRanges={netSummaryTableRanges}
          netSummaryTableSelectedCodes={netSummaryTableSelectedCodes}
          getStatsSelectionsForVariable={getStatsSelectionsForVariable}
                        onToggleIndividualTable={handleToggleIndividualTable}
                        onSelectTable={handleSelectTable}
                        onRemoveSummarySortSelection={removeSummarySortSelection}
          onSummaryTableSortToggle={(varName, tableId, defaultOn) => {
            handleSummaryTableSortToggle(varName, tableId, defaultOn);
          }}
                        onHoldOptionsToggle={handleHoldOptionsToggle}
                        onOpenHoldOptionsDropdown={openHoldOptionsDropdown}
                        onCloseHoldOptionsDropdown={closeHoldOptionsDropdown}
                        onHoldOptionSelection={handleHoldOptionSelection}
          onOpenNetSummaryModal={(variableName, config) => {
            if (config) {
              openNetSummaryModal(variableName, config);
            } else {
              openNetSummaryModal(variableName, { mode: 'range' });
            }
          }}
          onEditNetSummary={(variableName, netMeta, responseOptions) => {
            handleEditNetSummary(variableName, netMeta, responseOptions);
          }}
                              onAddInlineNumericNet={handleAddInlineNumericNet}
          onUpdateInlineNumericNet={(variableName, globalIndex, key, value) => {
            if (key === 'low' || key === 'high') {
              handleUpdateInlineNumericNet(variableName, globalIndex, key, value);
            }
          }}
                              onRemoveInlineNumericNet={handleRemoveInlineNumericNet}
          onSortPreferenceChange={(variableName, value, persistFalse) => {
            handleSortPreferenceChange(variableName, value, persistFalse);
          }}
          onToggleStatSelection={handleToggleStatSelection}
        />
      </div>
    </>
  );
}

