import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
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
import { getBaseQuestionNumber, getDefaultSortFlagForVariable, classifyDatamapQuestionType, isOeTaggedName, detect7ptScale } from '../utils/tabs/questionHelpers';
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
import { TabPlansProjectView } from './tabs/TabPlansProjectView';
import { CreateTabPlanWizard } from './tabs/CreateTabPlanWizard';
import { TabPlanRawDataTab } from './tabs/TabPlanRawDataTab';
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
import { useTabPlans, type TabPlan } from '../hooks/useTabPlans';

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
  const [qnrViewMode, setQnrViewMode] = useState<'variables' | 'tableSpecs' | 'bannerSpecs' | 'data'>('variables');
  const [tabSpecsTypeFilter, setTabSpecsTypeFilter] = useState<string>('all');
  const [specsResetKey, setSpecsResetKey] = useState(0);
  const [showSettingsPopup, setShowSettingsPopup] = useState(false);
  const [significanceLevel, setSignificanceLevel] = useState<95 | 90>(95);
  const [percentageDecimals, setPercentageDecimals] = useState<0 | 1 | 2>(0);
  const [showIncludedQuestions, setShowIncludedQuestions] = useState(false);
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

  const [activeTabPlan, setActiveTabPlan] = useState<TabPlan | null>(null);
  const [showCreateTabPlanWizard, setShowCreateTabPlanWizard] = useState(false);
  const [exportingBannerId, setExportingBannerId] = useState<string | null>(null);

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
    migrateOpenEndQuestions,
    setQuestionnaires,
    setSelectedQuestionnaire,
    setQuestionnaireQuestions,
    setAllQuestionnaires,
  } = questionnaireHook;

  const tabPlansHook = useTabPlans();
  const { plans: tabPlans, loadingPlans, listByProject, createPlan, uploadDataFile, getPlan, updatePlan, deletePlan, getDatamap, getRawData } = tabPlansHook;

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

  const tabSpecsStorageKey = String(activeTabPlan?.id || selectedQuestionnaire?.id || '');

  // Now initialize hooks that depend on variables and selectedQuestionnaire
  const bannersHook = useBanners({
    selectedQuestionnaire,
    variables,
    storageKey: tabSpecsStorageKey || undefined,
    isRawPlan: activeTabPlan?.sourceType === 'raw',
    projectName: selectedProject?.name || activeTabPlan?.name,
  });
  const summaryNetsHook = useSummaryNets();
  const tableSelectionsHook = useTableSelections({ selectedQuestionnaireId: selectedQuestionnaire?.id, storageKey: tabSpecsStorageKey || undefined });
  const statsSelectionsHook = useStatsSelections({ selectedQuestionnaireId: selectedQuestionnaire?.id, storageKey: tabSpecsStorageKey || undefined });
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
    setVariableHoldResponseCodes,
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

  // Helper function to get selected tables for a variable
  const getTablesForVariable = useCallback((variable: Variable): string[] => {
    const varName = variable.name;
    const selections = variableTableSelections[varName];
    if (!selections || selections.size === 0) return [];
    return Array.from(selections);
  }, [variableTableSelections]);

  // --- Tab Plan persistence (server) ---
  const isPlanScoped = !!activeTabPlan?.id;
  const loadedPlanIdRef = useRef<string | null>(null);
  const hydratingPlanRef = useRef(false);
  const saveTimerRef = useRef<number | null>(null);
  const defaultSelectionsInitializedRef = useRef<Set<string>>(new Set());
  const pendingSpecsResetRef = useRef(false);

  // Clear default selections tracking when questionnaire changes
  useEffect(() => {
    defaultSelectionsInitializedRef.current.clear();
  }, [selectedQuestionnaire?.id]);

  const requestSpecsReset = useCallback(() => {
    pendingSpecsResetRef.current = true;
  }, []);

  const resetSpecsToDefaults = useCallback(
    (options?: { closeSettingsPopup?: boolean }) => {
      if (!variables || variables.length === 0) {
        if (options?.closeSettingsPopup) {
          setShowSettingsPopup(false);
        }
        pendingSpecsResetRef.current = false;
        return;
      }

      const newTableSelections: Record<string, Set<string>> = {};
      const newStatsSelections: Record<string, VariableStatsSelection> = {};
      const newSortByFrequency: Record<string, boolean> = {};
      const newHoldResponseCodes: Record<string, string[]> = {};
      const newNetSummaryTableSelectedCodes: Record<string, Array<{ name: string; codes: string[] }>> = {};
      
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
              
              const top2BoxCodes = [getCodeForIndex(5), getCodeForIndex(6)];
              const middle3BoxCodes = [getCodeForIndex(2), getCodeForIndex(3), getCodeForIndex(4)];
              const bottom2BoxCodes = [getCodeForIndex(0), getCodeForIndex(1)];
              
              newNetSummaryTableSelectedCodes[variableName] = [
                { name: 'Top 2 Box', codes: top2BoxCodes },
                { name: 'Middle 3 Box', codes: middle3BoxCodes },
                { name: 'Bottom 2 Box', codes: bottom2BoxCodes },
              ];
              
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
      
      setVariableTableSelections(newTableSelections);
      setVariableStatsSelections(newStatsSelections);
      setVariableSortByFrequency(newSortByFrequency);
      setNetSummaryTableSelectedCodes(newNetSummaryTableSelectedCodes);
      
      Object.entries(newHoldResponseCodes).forEach(([varName, codes]) => {
        handleHoldOptionsToggle(varName, true, codes);
      });
      
      setNetSummaryTableRanges({});
      setSummaryTableSortSelections({});
      
      const resetKeyBase = String(tabSpecsStorageKey || '');
      if (resetKeyBase) {
        localStorage.removeItem(`variableTableSelections_${resetKeyBase}`);
        localStorage.removeItem(`variableStatsSelections_${resetKeyBase}`);
        localStorage.removeItem(`summaryTableSortSelections_${resetKeyBase}`);
        localStorage.removeItem(`variableSortByFrequency_${resetKeyBase}`);
        localStorage.removeItem(`variableHoldResponseCodes_${resetKeyBase}`);
        localStorage.removeItem(`holdSelections_${resetKeyBase}`);
        localStorage.removeItem(`netSummaryTableSelectedCodes_${resetKeyBase}`);
        localStorage.removeItem(`netSummaryTableRanges_${resetKeyBase}`);
        localStorage.removeItem(`newBannerGroups_${resetKeyBase}`);
        localStorage.removeItem(`bannerFilterConditions_${resetKeyBase}`);
        localStorage.removeItem(`hiddenFromBanners_${resetKeyBase}`);
      }
      setSpecsResetKey(prev => prev + 1);
      if (options?.closeSettingsPopup) {
        setShowSettingsPopup(false);
      }
      pendingSpecsResetRef.current = false;
    },
    [
      handleHoldOptionsToggle,
      questionnaireQuestions,
      setNetSummaryTableRanges,
      setNetSummaryTableSelectedCodes,
      setShowSettingsPopup,
      setSpecsResetKey,
      setSummaryTableSortSelections,
      setVariableSortByFrequency,
      setVariableStatsSelections,
      setVariableTableSelections,
      tabSpecsStorageKey,
      variables,
    ]
  );

  // Reset plan-load guard when leaving plan context
  useEffect(() => {
    if (!activeTabPlan?.id) {
      loadedPlanIdRef.current = null;
    }
  }, [activeTabPlan?.id]);

  // Load plan specs from server when a tab plan is active
  useEffect(() => {
    const planId = activeTabPlan?.id;
    if (!planId) return;
    if (loadedPlanIdRef.current === planId) return;

    let cancelled = false;
    (async () => {
      try {
        const serverPlan = await getPlan(planId);
        if (cancelled) return;
        loadedPlanIdRef.current = planId;
        setActiveTabPlan(serverPlan);

        const specs = serverPlan?.specs || {};
        hydratingPlanRef.current = true;

        try {
          if (specs.variableTableSelections) {
            setVariableTableSelections(parseSerializedTableSelections(specs.variableTableSelections));
          }
          if (specs.summaryTableSortSelections) {
            setSummaryTableSortSelections(parseSerializedTableSelections(specs.summaryTableSortSelections));
          }
          if (specs.variableStatsSelections) {
            setVariableStatsSelections(specs.variableStatsSelections || {});
          }
          if (specs.singleSelectSort) {
            setSingleSelectSort(specs.singleSelectSort || {});
          }
          if (specs.variableSortByFrequency) {
            setVariableSortByFrequency(specs.variableSortByFrequency || {});
          }
          if (specs.variableHoldResponseCodes) {
            setVariableHoldResponseCodes(specs.variableHoldResponseCodes || {});
          }

          if (specs.newBannerGroups) {
            setNewBannerGroups(Array.isArray(specs.newBannerGroups) ? specs.newBannerGroups : []);
          }
          if (Object.prototype.hasOwnProperty.call(specs, 'bannerFilterConditions')) {
            setBannerFilterConditions(specs.bannerFilterConditions || null);
          }
          if (specs.hiddenFromBanners) {
            setHiddenFromBanners(new Set(Array.isArray(specs.hiddenFromBanners) ? specs.hiddenFromBanners : []));
          }

          if (specs.netSummaryTableSelectedCodes) {
            setNetSummaryTableSelectedCodes(specs.netSummaryTableSelectedCodes || {});
          }
          if (specs.netSummaryTableRanges) {
            setNetSummaryTableRanges(specs.netSummaryTableRanges || {});
          }

          if (specs.settings) {
            const nextSig = specs.settings.significanceLevel;
            const nextPct = specs.settings.percentageDecimals;
            if (nextSig === 90 || nextSig === 95) setSignificanceLevel(nextSig);
            if (nextPct === 0 || nextPct === 1 || nextPct === 2) setPercentageDecimals(nextPct);
          }
        } finally {
          // allow one tick before enabling saves, to avoid accidental save loops
          setTimeout(() => {
            hydratingPlanRef.current = false;
          }, 0);
        }
      } catch (e) {
        // If plan load fails, keep UI functional with local cache
        loadedPlanIdRef.current = planId;
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [
    activeTabPlan?.id,
    getPlan,
    setActiveTabPlan,
    setVariableTableSelections,
    setSummaryTableSortSelections,
    setVariableStatsSelections,
    setSingleSelectSort,
    setVariableSortByFrequency,
    setVariableHoldResponseCodes,
    setNewBannerGroups,
    setBannerFilterConditions,
    setHiddenFromBanners,
    setNetSummaryTableSelectedCodes,
    setNetSummaryTableRanges,
    setSignificanceLevel,
    setPercentageDecimals,
  ]);

  const planSpecsToPersist = useMemo(() => {
    if (!isPlanScoped) return null;
    return {
      variableTableSelections: createSerializedTableSelections(variableTableSelections),
      variableStatsSelections,
      summaryTableSortSelections: createSerializedTableSelections(summaryTableSortSelections),
      variableSortByFrequency,
      variableHoldResponseCodes,
      singleSelectSort,
      newBannerGroups,
      bannerFilterConditions,
      hiddenFromBanners: Array.from(hiddenFromBanners || new Set()),
      netSummaryTableSelectedCodes,
      netSummaryTableRanges,
      settings: {
        significanceLevel,
        percentageDecimals,
      },
    };
  }, [
    isPlanScoped,
    variableTableSelections,
    variableStatsSelections,
    summaryTableSortSelections,
    variableSortByFrequency,
    variableHoldResponseCodes,
    singleSelectSort,
    newBannerGroups,
    bannerFilterConditions,
    hiddenFromBanners,
    netSummaryTableSelectedCodes,
    netSummaryTableRanges,
    significanceLevel,
    percentageDecimals,
  ]);

  const planSpecsToPersistJson = useMemo(() => (planSpecsToPersist ? JSON.stringify(planSpecsToPersist) : null), [planSpecsToPersist]);

  // Debounced save to server while editing a tab plan
  useEffect(() => {
    const planId = activeTabPlan?.id;
    if (!planId) return;
    if (!planSpecsToPersist) return;
    if (hydratingPlanRef.current) return;

    if (saveTimerRef.current) {
      window.clearTimeout(saveTimerRef.current);
    }

    saveTimerRef.current = window.setTimeout(() => {
      updatePlan(planId, { specs: planSpecsToPersist }).catch(() => {});
    }, 800);

    return () => {
      if (saveTimerRef.current) {
        window.clearTimeout(saveTimerRef.current);
        saveTimerRef.current = null;
      }
    };
  }, [activeTabPlan?.id, planSpecsToPersistJson, planSpecsToPersist, updatePlan]);

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

  const buildTabSpecsWorkbook = useCallback(async (variablesSubset: Variable[], bannerGroupOverride?: BannerGroup): Promise<{ workbook: ExcelJS.Workbook; sampleSize: number; debugInfo: Record<string, TableDebugEntry> }> => {
    if (!fullRawData || !variablesSubset.length) {
      throw new Error('Data not available for export. Please ensure data is loaded.');
    }

    try {
      const workbook = new ExcelJS.Workbook();

      // Statistical testing function for proportions/percentages
      const isSignificant = (p1: number, n1: number, p2: number, n2: number): { is95: boolean; is90: boolean } => {
        if (!n1 || !n2 || n1 <= 0 || n2 <= 0) return { is95: false, is90: false };
        const prop1 = p1 / 100;
        const prop2 = p2 / 100;
        const pooledProp = (prop1 * n1 + prop2 * n2) / (n1 + n2);
        const se = Math.sqrt(pooledProp * (1 - pooledProp) * (1/n1 + 1/n2));
        if (se === 0) return { is95: false, is90: false };
        const z = Math.abs(prop1 - prop2) / se;
        return { is95: z > 1.96, is90: z > 1.645 && z <= 1.96 };
      };

      // Statistical testing function for means (two-sample z-test with pooled variance)
      const isSignificantForMeans = (mean1: number, n1: number, stdDev1: number, mean2: number, n2: number, stdDev2: number, confidenceLevel: 95 | 90 | 80 = 95): { is95: boolean; is90: boolean } => {
        if (!n1 || !n2 || n1 <= 0 || n2 <= 0) return { is95: false, is90: false };
        
        // If both standard deviations are 0 or very small, and means are equal, no significance
        const meanDiff = Math.abs(mean1 - mean2);
        if (meanDiff < 0.0001) return { is95: false, is90: false };
        
        // Use a small epsilon to avoid division by zero when standard deviations are very small
        const epsilon = 0.0001;
        const adjustedStdDev1 = Math.max(stdDev1, epsilon);
        const adjustedStdDev2 = Math.max(stdDev2, epsilon);
        
        // Calculate pooled standard deviation
        const variance1 = adjustedStdDev1 * adjustedStdDev1;
        const variance2 = adjustedStdDev2 * adjustedStdDev2;
        const pooledVariance = ((n1 - 1) * variance1 + (n2 - 1) * variance2) / (n1 + n2 - 2);
        const pooledStdDev = Math.sqrt(Math.max(pooledVariance, epsilon * epsilon));
        
        // Standard error of the difference between means
        const se = pooledStdDev * Math.sqrt(1/n1 + 1/n2);
        if (se === 0 || se < epsilon) return { is95: false, is90: false };
        
        // Calculate z-score
        const z = meanDiff / se;
        
        // Get z-critical values based on confidence level
        const zCritical95 = confidenceLevel === 95 ? 1.96 : confidenceLevel === 90 ? 1.645 : 1.282;
        const zCritical90 = 1.645;
        
        return { 
          is95: z > zCritical95, 
          is90: z > zCritical90 && z <= zCritical95 
        };
      };

      // Debug helpers
      let currentStatDebugVar = '';
      let currentStatDebugCode = '';
      const shouldDebugStats = () => {
        const globalFlag = (globalThis as any).__TABEXPORT_DEBUG_STATS === true;
        return !!globalFlag || showStatDebug;
      };
      const logStatDebug = (...args: any[]) => {
        if (shouldDebugStats()) {
          // eslint-disable-next-line no-console
          console.warn('[STAT DEBUG]', ...args);
          // Mirror into UI panel
          try {
            appendStatLog(String(args?.[0] ?? ''), args?.[1]);
          } catch {}
        }
      };

      // Yield helpers to keep UI responsive during heavy loops
      const makeYielder = (interval: number) => {
        let counter = 0;
        return async () => {
          counter++;
          if (counter % interval === 0) {
            await new Promise<void>((resolve) => {
              // Give the browser a frame to paint
              requestAnimationFrame(() => resolve());
            });
          }
        };
      };
      const yieldPerVariable = makeYielder(1);   // yield each variable
      const yieldPerTable = makeYielder(2);      // yield every 2 tables

      // Helper to get column header
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

      // Build a row predicate from a BannerCut (supports AND/OR condition groups, numeric and categorical)
      const makeCutPredicate = (cut: BannerCut): ((row: any) => boolean) => {
        const parseNumeric = (s: any): number | null => {
          if (s === null || s === undefined || s === '') return null;
          const n = Number(String(s).trim());
          return isNaN(n) ? null : n;
        };
        const buildNumericChecker = (condStr: string): ((n: number | null) => boolean) => {
          const s = condStr.trim();
          // range "a-b"
          const range = s.match(/^(-?\d+(?:\.\d+)?)\s*-\s*(-?\d+(?:\.\d+)?)$/);
          if (range) {
            const a = Number(range[1]);
            const b = Number(range[2]);
            return (n) => n !== null && n >= a && n <= b;
          }
          // open-ended "a-" or "-b"
          const left = s.match(/^(-?\d+(?:\.\d+)?)\s*-\s*$/);
          if (left) {
            const a = Number(left[1]);
            return (n) => n !== null && n >= a;
          }
          const right = s.match(/^\s*-\s*(-?\d+(?:\.\d+)?)$/);
          if (right) {
            const b = Number(right[1]);
            return (n) => n !== null && n <= b;
          }
          // comparators
          const cmp = s.match(/^(>=|<=|>|<|=)\s*(-?\d+(?:\.\d+)?)$/);
          if (cmp) {
            const op = cmp[1];
            const value = Number(cmp[2]);
            return (n) => {
              if (n === null) return false;
              switch (op) {
                case '>=': return n >= value;
                case '<=': return n <= value;
                case '>': return n > value;
                case '<': return n < value;
                case '=': return n === value;
                default: return false;
              }
            };
          }
          // fallback: exact number
          const exact = Number(s);
          if (!isNaN(exact)) {
            return (n) => n !== null && n === exact;
          }
          // unknown, never matches
          return () => false;
        };
        const matchesCategorical = (row: any, varName: string, codes: string[]): boolean => {
          const header = getColumnHeader(varName);
          if (!header) return false;
          const val = row[header];
          if (val === null || val === undefined || val === '') return false;
          const s = String(val).trim();
          const n = Number(s);
          for (const code of codes) {
            if (s === code) return true;
            const codeNoC = code.replace(/^c/i, '');
            if (s === codeNoC) return true;
            if (!isNaN(n) && String(n) === codeNoC) return true;
          }
          return false;
        };
        const matchesNumeric = (row: any, varName: string, condStr: string): boolean => {
          const header = getColumnHeader(varName);
          if (!header) return false;
          const val = parseNumeric(row[header]);
          const check = buildNumericChecker(condStr);
          return check(val);
        };
        // If conditionGroups present, honor them
        if ((cut as any).conditionGroups && (cut as any).conditionGroups.length > 0) {
          const group = (cut as any).conditionGroups[0] as BannerConditionGroup;
          const op = (group.operator || 'OR').toUpperCase() as 'OR' | 'AND';
          const conds = group.conditions || [];
          return (row: any) => {
            if (op === 'AND') {
              return conds.every((c: any) => {
                if (c.codes && c.codes.length > 0) return matchesCategorical(row, c.variableName, c.codes);
                if (c.codes && c.codes[0] && /^[><=]/.test(c.codes[0])) return matchesNumeric(row, c.variableName, c.codes[0]);
                if (c.numericCondition) return matchesNumeric(row, c.variableName, c.numericCondition);
                return false;
              });
            } else {
              return conds.some((c: any) => {
                if (c.codes && c.codes.length > 0) return matchesCategorical(row, c.variableName, c.codes);
                if (c.codes && c.codes[0] && /^[><=]/.test(c.codes[0])) return matchesNumeric(row, c.variableName, c.codes[0]);
                if (c.numericCondition) return matchesNumeric(row, c.variableName, c.numericCondition);
                return false;
              });
            }
          };
        }
        // Fallback to legacy single-variable + codes
        if (cut.variableName && (cut.codes?.length || 0) > 0) {
          return (row: any) => matchesCategorical(row, cut.variableName, cut.codes!);
        }
        // No conditions: never filter (treat as Total-like)
        return () => false;
      };

      // Get the selected banner group (use override or first banner)
      const selectedBannerGroup = bannerGroupOverride || newBannerGroups[0];
      if (!selectedBannerGroup) {
        throw new Error('No banner group found. Please create a banner in the Banners tab first.');
      }
      // Only log for B8 to reduce console noise
      const isB8Variable = variablesSubset.some(v => v.name === 'B8');
      if (isB8Variable && ((globalThis as any).__TABEXPORT_DEBUG_STATS === true || showStatDebug)) {
        appendStatLog('export start', {
          bannerTitle: selectedBannerGroup.title,
          variablesCount: (variablesSubset?.length ?? 0)
        });
      }

      // Filter variables that should be exported
      const variablesToExport = variablesSubset.filter(v => {
        // Exclude summary table variables
        if (v.name.endsWith('_Summary Tables') || ((v as any).isSummaryTable && !(v as any).isScaleSummary)) {
          return false;
        }
        
        // Only include variables that have tables explicitly selected in Tab Specs
        const tables = getTablesForVariable(v);
        if (tables.length === 0) {
          return false;
        }
        
        // Check if variable is mapped (has a column mapping)
        // For grid variables, check if at least some cells are mapped
        const isGridVariable = v.type?.toLowerCase().includes('grid');
        const baseColHeader = getColumnHeader(v.name);
        
        // Check if this is a multi-select question (not grid)
        const isMultiSelectQuestion = v.type?.toLowerCase().includes('multi-select') && !v.type?.toLowerCase().includes('grid');
        // Check if this is a multi-select grid
        const isMultiSelectGridVariable = v.type?.toLowerCase().includes('multi-select grid');
        
        if (!baseColHeader && isGridVariable) {
          // For grid variables, check if any grid cells are mapped
          let hasMappedCells = false;
          if (v.statements && questionnaireQuestions) {
            const baseNumber = v.name.replace(/^Q/, '');
            const question = questionnaireQuestions.find(q => {
              const qNum = q.number || q.id;
              return qNum === baseNumber || qNum === baseNumber.replace(/^Q/, '') || String(qNum) === String(baseNumber);
            });
            
            if (question && question.responseOptions) {
              const columnCodes: string[] = [];
              question.responseOptions.forEach((_: any, respIdx: number) => {
                columnCodes.push(`c${respIdx + 1}`);
              });
              
              // Check if at least one statement+column combination is mapped
              for (const [stmtCode] of Object.entries(v.statements)) {
                let normalizedCode = stmtCode;
                if (!/^r\d+/i.test(stmtCode) && /^\d+$/.test(stmtCode)) {
                  normalizedCode = `r${stmtCode}`;
                }
                for (const columnCode of columnCodes) {
                  const cellHeader = `Q${v.name}${normalizedCode}${columnCode}`;
                  const variations = [cellHeader, cellHeader.replace(/^Q/, ''), `${v.name}${normalizedCode}${columnCode}`];
                  for (const variation of variations) {
                    if (columnMapping[variation]) {
                      hasMappedCells = true;
                      break;
                    }
                    const match = Object.keys(columnMapping).find(k => k.toLowerCase() === variation.toLowerCase());
                    if (match) {
                      hasMappedCells = true;
                      break;
                    }
                  }
                  if (hasMappedCells) break;
                }
                if (hasMappedCells) break;
              }
            }
          }
          
          if (!hasMappedCells) {
            // Grid variable has no mapped cells, exclude it
            return false;
          }
        } else if (!baseColHeader && isMultiSelectQuestion) {
          // For multi-select questions, check if any response columns are mapped (QB8r1, QB8r2, etc.)
          let hasMappedResponseColumns = false;
          const baseNumber = v.name.replace(/^Q/, '');
          
          if (v.codes) {
            // Check each response code for a mapped column
            for (const code of Object.keys(v.codes)) {
              const codeNum = code.replace(/^[rc]/i, '');
              // Multi-select columns use 'r' prefix (e.g., QB8r1, QB8r2)
              const expectedHeaders = [
                `Q${baseNumber}r${codeNum}`,
                `${baseNumber}r${codeNum}`,
                `QB${baseNumber}r${codeNum}`,
                `B${baseNumber}r${codeNum}`
              ];
              
              for (const expectedHeader of expectedHeaders) {
                // Check column mapping
                if (columnMapping[expectedHeader]) {
                  hasMappedResponseColumns = true;
                  break;
                }
                // Case-insensitive check
                const match = Object.keys(columnMapping).find(k => k.toLowerCase() === expectedHeader.toLowerCase());
                if (match) {
                  hasMappedResponseColumns = true;
                  break;
                }
                // Check if column exists directly in raw data
                if (fullRawData?.columns) {
                  const directMatch = fullRawData.columns.find((col: string) => col.toLowerCase() === expectedHeader.toLowerCase());
                  if (directMatch) {
                    hasMappedResponseColumns = true;
                    break;
                  }
                }
              }
              if (hasMappedResponseColumns) break;
            }
          }
          
          if (!hasMappedResponseColumns) {
            // Multi-select variable has no mapped response columns, exclude it
            return false;
          }
        } else if (!baseColHeader && isMultiSelectGridVariable) {
          // For multi-select grids, check if any cell columns are mapped (QB2r1c1, QB2r1c2, etc.)
          // Multi-select grids have statements (rows) and codes (columns)
          let hasMappedCells = false;
          const baseNumber = v.name.replace(/^Q/, '');
          
          if (v.statements && v.codes) {
            // Check some statement+column combinations for mapped cells
            const stmtCodes = Object.keys(v.statements).slice(0, 3); // Check first 3 statements
            const colCodes = Object.keys(v.codes).slice(0, 3); // Check first 3 columns
            
            for (const stmtCode of stmtCodes) {
              let normalizedStmtCode = stmtCode;
              if (!/^r\d+/i.test(stmtCode) && /^\d+$/.test(stmtCode)) {
                normalizedStmtCode = `r${stmtCode}`;
              }
              
              for (const colCode of colCodes) {
                // Multi-select grid cell headers: QB2r1c1
                const expectedHeaders = [
                  `Q${baseNumber}${normalizedStmtCode}${colCode}`,
                  `${baseNumber}${normalizedStmtCode}${colCode}`,
                  `Q${v.name}${normalizedStmtCode}${colCode}`,
                  `${v.name}${normalizedStmtCode}${colCode}`
                ];
                
                for (const expectedHeader of expectedHeaders) {
                  if (columnMapping[expectedHeader]) {
                    hasMappedCells = true;
                    break;
                  }
                  const match = Object.keys(columnMapping).find(k => k.toLowerCase() === expectedHeader.toLowerCase());
                  if (match) {
                    hasMappedCells = true;
                    break;
                  }
                  if (fullRawData?.columns) {
                    const directMatch = fullRawData.columns.find((col: string) => col.toLowerCase() === expectedHeader.toLowerCase());
                    if (directMatch) {
                      hasMappedCells = true;
                      break;
                    }
                  }
                }
                if (hasMappedCells) break;
              }
              if (hasMappedCells) break;
            }
          }
          
          if (!hasMappedCells) {
            // Multi-select grid has no mapped cells, exclude it
            return false;
          }
        } else if (!baseColHeader) {
          // Non-grid, non-multi-select variable is not mapped, exclude it
          return false;
        }
        
        return true;
      });

      let tableNumber = 1;
      const tableDebugInfo: Record<string, TableDebugEntry> = {};
      const findFirstBannerRowWithBase = (data: Record<string, any> | null | undefined): Record<string, any> | null => {
        if (!data) return null;
        const queue: any[] = Object.values(data);
        while (queue.length) {
          const node = queue.shift();
          if (!node || typeof node !== 'object') {
            continue;
          }
          if (node.total && typeof node.total.base === 'number') {
            return node;
          }
          Object.values(node).forEach(child => {
            if (child && typeof child === 'object') {
              queue.push(child);
            }
          });
        }
        return null;
      };

      // Helper to calculate frequency table data
      const calculateFrequencyData = (variable: Variable, tableName: string) => {
        const colHeader = getColumnHeader(variable.name);
        if (!colHeader || !fullRawData.rows) return null;

        const frequencyMap: Record<string, number> = {};
        let totalCount = 0;

        fullRawData.rows.forEach((row: any) => {
          const value = row[colHeader];
          if (value !== null && value !== undefined && value !== '') {
            const strValue = String(value).trim();
            if (strValue) {
              frequencyMap[strValue] = (frequencyMap[strValue] || 0) + 1;
              totalCount++;
            }
          }
        });

        // Get codes from variable or generate from data
        let codes: Array<{ code: string; text: string }> = [];
        if (variable.codes) {
          codes = Object.entries(variable.codes).map(([code, text]) => ({ code, text }));
        } else {
          codes = Object.keys(frequencyMap).map(code => ({ code, text: code }));
        }

        // Check if sorting by frequency is enabled
        const isSortedByFrequency = getEffectiveSortByFrequency(variable);
        if (isSortedByFrequency) {
          codes.sort((a, b) => (frequencyMap[b.code] || 0) - (frequencyMap[a.code] || 0));
          codes = applyHoldOrdering(codes, variable.name, (item) => item.code);
        }

        return { frequencyMap, totalCount, codes };
      };

      // Helper to calculate stats for numeric data
      const calculateStats = (values: number[]) => {
        if (values.length === 0) return null;

        const sum = values.reduce((a, b) => a + b, 0);
        const mean = sum / values.length;
        const sorted = [...values].sort((a, b) => a - b);
        const median = sorted.length % 2 === 0
          ? (sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2
          : sorted[Math.floor(sorted.length / 2)];

        const modeMap: Record<number, number> = {};
        values.forEach(v => {
          modeMap[v] = (modeMap[v] || 0) + 1;
        });
        const maxFreq = Math.max(...Object.values(modeMap));
        const mode = Number(Object.keys(modeMap).find(k => modeMap[Number(k)] === maxFreq));

        const variance = values.reduce((acc, val) => acc + Math.pow(val - mean, 2), 0) / values.length;
        const stdDev = Math.sqrt(variance);
        const max = Math.max(...values);
        const min = Math.min(...values);

        return { sum, mean, median, mode, stdDev, max, min };
      };

      // Build banner columns structure with group information
      const bannerGroup = selectedBannerGroup;
      const bannerCols: Array<{ id: string; title: string; groupTitle: string; groupIdx: number; colHeader?: string; codes: string[]; matchesRow: (row:any)=>boolean }> = [];
      const groupStructure: Array<{ title: string; cutCount: number; startIdx: number }> = [];
      if (bannerGroup.groups) {
        let cutIdx = 0;
        bannerGroup.groups.forEach((g, gIdx) => {
          const groupStartIdx = cutIdx;
          const groupCutCount = g.cuts.length;
          groupStructure.push({
            title: g.title,
            cutCount: groupCutCount,
            startIdx: groupStartIdx
          });
          g.cuts.forEach(cut => {
            bannerCols.push({
              id: cut.id,
              title: cut.title,
              groupTitle: g.title,
              groupIdx: gIdx,
              colHeader: getColumnHeader(cut.variableName),
              codes: cut.codes || [],
              matchesRow: makeCutPredicate(cut as any)
            });
            cutIdx++;
          });
        });
      }
      // Only log for B8 to reduce console noise (reuse isB8Variable declared above)
      if (isB8Variable && shouldDebugStats()) {
        try {
          appendStatLog('banner cuts', {
            count: bannerCols.length,
            letters: bannerCols.map((c, i) => `${String.fromCharCode(65 + i)}:${c.title}`),
            ids: bannerCols.map(c => c.id),
            groups: groupStructure.map(g => ({ title: g.title, cuts: g.cutCount }))
          });
        } catch {}
      }

      // Create Table of Contents worksheet
      const tocWorksheet = workbook.addWorksheet('Table of Contents');

      // Create Data Cuts worksheet
      const dataCutsWorksheet = workbook.addWorksheet('Data Cuts');
      let currentRow = 1;

      // Track table positions for TOC
      const tablePositions: Array<{ tableNumber: number; tableName: string; rowNumber: number; variable: Variable }> = [];

      for (const variable of variablesToExport) {
        const isS6Variable = variable.name === 'S6';
        if (isS6Variable && ((globalThis as any).__TABEXPORT_DEBUG_STATS === true || showStatDebug)) {
          // eslint-disable-next-line no-console
          console.warn('[STAT DEBUG S6] variable begin', { variable: variable.name, type: variable.type });
          appendStatLog('[S6] variable begin', { variable: variable.name, type: variable.type });
        }
        await yieldPerVariable();
        const tables = getTablesForVariable(variable);
        
        // Debug: Log tables for preview mode (when only one variable is being exported)
        const isPreviewMode = variablesSubset.length === 1 && variablesSubset[0] === variable;
        const isMultiSelectQuestion = variable.type?.toLowerCase().includes('multi-select') && !variable.type?.toLowerCase().includes('grid');
        const isB8Debug = variable.name === 'B8';
        if (isB8Debug) {
          appendStatLog('[B8] Variable info', { variable: variable.name, type: variable.type, isMultiSelect: isMultiSelectQuestion, tables, selections: variableTableSelections[variable.name] ? Array.from(variableTableSelections[variable.name]) : 'none' });
        }
        
        if (isS6Variable && ((globalThis as any).__TABEXPORT_DEBUG_STATS === true || showStatDebug)) {
          // eslint-disable-next-line no-console
          console.warn('[STAT DEBUG S6] tables selected', { variable: variable.name, tables });
          appendStatLog('[S6] tables selected', { variable: variable.name, tables });
        }

                          for (const tableName of tables) {
          // Debug: Log when processing each table for B8
          if (isB8Debug) {
            appendStatLog('[B8] Processing table', { tableName, variable: variable.name, type: variable.type });
          }
          const isS6Debug = variable.name === 'S6' && ((globalThis as any).__TABEXPORT_DEBUG_STATS === true || showStatDebug);
          if (isS6Debug) {
            // eslint-disable-next-line no-console
            console.warn('[STAT DEBUG S6] building table', { variable: variable.name, tableName });
            appendStatLog('[S6] building table', { variable: variable.name, tableName });
          }
          await yieldPerTable();
          // Check if this is a NetSummaryTable for single select grid
          const isSingleSelectGrid = variable.type?.toLowerCase().includes('single select grid');
          const isNetSummaryTable = isSingleSelectGrid && tableName.includes('_NetSummaryTable');
          const isVerbatimSummary = tableName.endsWith('_VerbatimSummary');
          
          // Add spacing between tables (except for first table)
          if (tableNumber > 1) {
            currentRow += 3;
          }

          const tableStartRow = currentRow;

          // Check if this is a mean or sum summary table for numeric grids (must be declared before use)
          const isNumericGrid = variable.type?.toLowerCase().includes('numeric grid');
          const isMeanSummaryTable = isNumericGrid && tableName.endsWith('_MeanSummaryTable');
          const isSumSummaryTable = isNumericGrid && tableName.endsWith('_SumSummaryTable');
          const isNumericGridSummaryTable = isMeanSummaryTable || isSumSummaryTable;
          
          // Check if this is a single select grid individual table (must be declared before use at line 12117)
          const isSingleSelectGridIndividualTable = variable.type?.toLowerCase().includes('single select grid') && 
            variable.statements && 
            Object.keys(variable.statements).length > 0 &&
            !tableName.endsWith('_MeanSummaryTable');
          
          // Handle Verbatim Summary table for coded open ends
          if (isVerbatimSummary) {
            // Record position for TOC
            tablePositions.push({ tableNumber, tableName, rowNumber: currentRow, variable });
            // Title
            const baseQuestionNumber = getBaseQuestionNumber(variable.name);
            const tableTitle = `Table ${tableNumber}: ${baseQuestionNumber}: Verbatim Summary`;
            const titleRow = dataCutsWorksheet.getRow(currentRow++);
            titleRow.getCell(2).value = tableTitle;
            titleRow.getCell(2).font = { bold: true, size: 12 };
            // Question text
            const questionRow = dataCutsWorksheet.getRow(currentRow++);
            questionRow.getCell(2).value = variable.description || variable.name;
            questionRow.getCell(2).font = { size: 11 };

            // Build 3-row header (Total + banner groups)
            const headerStartRow = currentRow;
            const groupTitleRow = headerStartRow;
            const cutTitleRow = headerStartRow + 1;
            const statLetterRow = headerStartRow + 2;
            let currentCol = 2;
            // Row label cell
            const rowLabelCell = dataCutsWorksheet.getRow(groupTitleRow).getCell(currentCol);
            rowLabelCell.value = '';
            rowLabelCell.border = { top:{style:'thin'}, bottom:{style:'thin'}, left:{style:'thin'}, right:{style:'thin'} };
            dataCutsWorksheet.mergeCells(groupTitleRow, currentCol, statLetterRow, currentCol);
            [cutTitleRow, statLetterRow].forEach(r => {
              const cell = dataCutsWorksheet.getRow(r).getCell(currentCol);
              cell.border = { top:{style:'thin'}, bottom:{style:'thin'}, left:{style:'thin'}, right:{style:'thin'} };
            });
            currentCol++;
            // Total column
            const totalGroupCell = dataCutsWorksheet.getRow(groupTitleRow).getCell(currentCol);
            totalGroupCell.value = 'Total';
            totalGroupCell.alignment = { horizontal: 'center', vertical: 'middle' };
            totalGroupCell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
            totalGroupCell.fill = { type:'pattern', pattern:'solid', fgColor:{ argb:'FFD14A2D' } };
            totalGroupCell.border = { top:{style:'thin'}, bottom:{style:'thin'}, left:{style:'thin'}, right:{style:'thin'} };
            dataCutsWorksheet.mergeCells(groupTitleRow, currentCol, cutTitleRow, currentCol);
            const totalCutCell = dataCutsWorksheet.getRow(cutTitleRow).getCell(currentCol);
            totalCutCell.fill = { type:'pattern', pattern:'solid', fgColor:{ argb:'FFD14A2D' } };
            totalCutCell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
            totalCutCell.border = { top:{style:'thin'}, bottom:{style:'thin'}, left:{style:'thin'}, right:{style:'thin'} };
            const totalStatCell = dataCutsWorksheet.getRow(statLetterRow).getCell(currentCol);
            totalStatCell.value = '';
            totalStatCell.alignment = { horizontal:'center', vertical:'middle' };
            totalStatCell.fill = { type:'pattern', pattern:'solid', fgColor:{ argb:'FFD14A2D' } };
            totalStatCell.border = { top:{style:'thin'}, bottom:{style:'thin'}, left:{style:'thin'}, right:{style:'thin'} };
            currentCol++;
            // Banner groups
            groupStructure.forEach((group) => {
              const groupStartCol = currentCol;
              const groupCell = dataCutsWorksheet.getRow(groupTitleRow).getCell(groupStartCol);
              groupCell.value = group.title;
              groupCell.alignment = { horizontal:'center', vertical:'middle' };
              groupCell.font = { bold:true, color:{ argb:'FFFFFFFF' } };
              groupCell.fill = { type:'pattern', pattern:'solid', fgColor:{ argb:'FFD14A2D' } };
              groupCell.border = { top:{style:'thin'}, bottom:{style:'thin'}, left:{style:'thin'}, right:{style:'thin'} };
              if (group.cutCount > 1) {
                dataCutsWorksheet.mergeCells(groupTitleRow, groupStartCol, groupTitleRow, groupStartCol + group.cutCount - 1);
              }
              for (let i=0;i<group.cutCount;i++) {
                const cutCol = groupStartCol + i;
                const bannerCol = bannerCols[group.startIdx + i];
                const cutCell = dataCutsWorksheet.getRow(cutTitleRow).getCell(cutCol);
                cutCell.value = bannerCol.title;
                cutCell.alignment = { horizontal:'center', vertical:'middle' };
                cutCell.font = { bold:true, color:{ argb:'FFFFFFFF' } };
                cutCell.fill = { type:'pattern', pattern:'solid', fgColor:{ argb:'FFD14A2D' } };
                cutCell.border = { top:{style:'thin'}, bottom:{style:'thin'}, left:{style:'thin'}, right:{style:'thin'} };
                const statCell = dataCutsWorksheet.getRow(statLetterRow).getCell(cutCol);
                const statLetter = String.fromCharCode(65 + group.startIdx + i);
                statCell.value = `(${statLetter})`;
                statCell.alignment = { horizontal:'center', vertical:'middle' };
                statCell.font = { bold:true, color:{ argb:'FFFFFFFF' } };
                statCell.fill = { type:'pattern', pattern:'solid', fgColor:{ argb:'FFD14A2D' } };
                statCell.border = { top:{style:'thin'}, bottom:{style:'thin'}, left:{style:'thin'}, right:{style:'thin'} };
              }
              currentCol += group.cutCount;
            });
            currentRow += 3;

            // Gather coded columns and theme labels
            const baseLower = variable.name.replace(/^Q/, '').toLowerCase();
            const codeColumns = (fullRawData.columns || []).filter(col => {
              const cl = String(col).toLowerCase();
              return (cl.startsWith(baseLower + 'r') || cl.startsWith('q' + baseLower + 'r')) && /r\d+$/.test(cl);
            });
            const savedThemes = savedCodingThemes.get(variable.name) || [];
            const themeMap = new Map<number, string>(savedThemes.map(t => [t.code, t.theme]));
            const parseCodeNum = (col: string) => {
              const m = col.match(/r(\d+)$/i);
              return m ? parseInt(m[1], 10) : NaN;
            };
            const sortedCodeCols = [...codeColumns].sort((a,b) => (parseCodeNum(a) || 0) - (parseCodeNum(b) || 0));
            // Helper for coded value truthiness
            const isCodedValue = (val: any): boolean => {
              if (val === null || val === undefined) return false;
              if (typeof val === 'number') return val >= 1;
              if (typeof val === 'boolean') return val === true;
              const s = String(val).trim().toLowerCase();
              return s === '1' || s === '1.0' || s === 'true' || s === 'yes' || s === 'y';
            };
            // Compute total responding (any code) overall and per cut
            let totalRespondingOverall = 0;
            const totalRespondingByCut: Record<string, number> = {};
            bannerCols.forEach(col => { totalRespondingByCut[col.id] = 0; });
            fullRawData.rows.forEach(r => {
              const hasAny = sortedCodeCols.some(c => isCodedValue(r[c]));
              if (!hasAny) return;
              totalRespondingOverall++;
              bannerCols.forEach(col => {
                if (col.matchesRow(r)) {
                  totalRespondingByCut[col.id]++;
                }
              });
            });
            // Base row (total responding) - styled same as other questions
            {
              const baseRow = dataCutsWorksheet.getRow(currentRow++);
              // Label cell (column B)
              const labelCell = baseRow.getCell(2);
              labelCell.value = 'Base (total answering):';
              labelCell.alignment = { horizontal: 'left', vertical: 'middle' };
              labelCell.font = { bold: true };
              labelCell.border = { top:{style:'thin'}, bottom:{style:'thin'}, left:{style:'thin'}, right:{style:'thin'} };
              labelCell.fill = { type:'pattern', pattern:'solid', fgColor:{ argb:'FFF2F2F2' } };
              // Total column (column C)
              let bc = 3;
              const totalCell = baseRow.getCell(bc++);
              totalCell.value = totalRespondingOverall;
              totalCell.alignment = { horizontal: 'center', vertical: 'middle' };
              totalCell.border = { top:{style:'thin'}, bottom:{style:'thin'}, left:{style:'thin'}, right:{style:'thin'} };
              totalCell.fill = { type:'pattern', pattern:'solid', fgColor:{ argb:'FFF2F2F2' } };
              // One cell per banner cut
              bannerCols.forEach(col => {
                const cell = baseRow.getCell(bc++);
                cell.value = totalRespondingByCut[col.id] || 0;
                cell.alignment = { horizontal: 'center', vertical: 'middle' };
                cell.border = { top:{style:'thin'}, bottom:{style:'thin'}, left:{style:'thin'}, right:{style:'thin'} };
                cell.fill = { type:'pattern', pattern:'solid', fgColor:{ argb:'FFF2F2F2' } };
              });
            }
            // For each code: count row + percentage row
            sortedCodeCols.forEach(colName => {
              const codeNum = parseCodeNum(colName);
              if (isNaN(codeNum)) return;
              const rowLabel = themeMap.get(codeNum) || `Code ${codeNum}`;
              // Count row
              const countRow = dataCutsWorksheet.getRow(currentRow++);
              let c = 2;
              const labelCell = countRow.getCell(c++);
              labelCell.value = rowLabel;
              labelCell.border = { top:{style:'thin'}, bottom:{style:'thin'}, left:{style:'thin'}, right:{style:'thin'} };
              let totalCount = 0;
              fullRawData.rows.forEach(r => { if (isCodedValue(r[colName])) totalCount++; });
              const totalCell = countRow.getCell(c++);
              totalCell.value = totalCount;
              totalCell.alignment = { horizontal:'center' };
              totalCell.border = { top:{style:'thin'}, bottom:{style:'thin'}, left:{style:'thin'}, right:{style:'thin'} };
              const cutCounts: Record<string, number> = {};
              groupStructure.forEach(group => {
                for (let i=0;i<group.cutCount;i++) {
                  const banner = bannerCols[group.startIdx + i];
                  let cutCount = 0;
              fullRawData.rows.forEach(r => {
                if (!isCodedValue(r[colName])) return;
                if (banner.matchesRow(r)) {
                  cutCount++;
                }
              });
                  cutCounts[banner.id] = cutCount;
                  const cutCell = countRow.getCell(c++);
                  cutCell.value = cutCount;
                  cutCell.alignment = { horizontal:'center' };
                  cutCell.border = { top:{style:'thin'}, bottom:{style:'thin'}, left:{style:'thin'}, right:{style:'thin'} };
                }
              });
              // Percentage row
              const pctRow = dataCutsWorksheet.getRow(currentRow++);
              let pc = 2;
              const pctLabelCell = pctRow.getCell(pc++);
              pctLabelCell.value = '';
              pctLabelCell.border = { top:{style:'thin'}, bottom:{style:'thin'}, left:{style:'thin'}, right:{style:'thin'} };
              const totalPctCell = pctRow.getCell(pc++);
              const totalPct = totalRespondingOverall > 0 ? totalCount / totalRespondingOverall : 0;
              totalPctCell.value = totalPct;
              totalPctCell.numFmt = percentageDecimals === 0 ? '0%' : percentageDecimals === 1 ? '0.0%' : '0.00%';
              totalPctCell.alignment = { horizontal:'center' };
              totalPctCell.border = { top:{style:'thin'}, bottom:{style:'thin'}, left:{style:'thin'}, right:{style:'thin'} };
              bannerCols.forEach(col => {
                const cutBase = totalRespondingByCut[col.id] || 0;
                const cutPct = cutBase > 0 ? (cutCounts[col.id] || 0) / cutBase : 0;
                const cell = pctRow.getCell(pc++);
                cell.value = cutPct;
                cell.numFmt = percentageDecimals === 0 ? '0%' : percentageDecimals === 1 ? '0.0%' : '0.00%';
                cell.alignment = { horizontal:'center' };
                cell.border = { top:{style:'thin'}, bottom:{style:'thin'}, left:{style:'thin'}, right:{style:'thin'} };
              });

              // Stat letters row for verbatim summary (compare cut percentages within each group)
              // Build per-cut percents (0-100)
              const cutPercents: Record<string, number> = {};
              bannerCols.forEach(col => {
                const base = totalRespondingByCut[col.id] || 0;
                cutPercents[col.id] = base > 0 ? ((cutCounts[col.id] || 0) / base) * 100 : 0;
              });
              const statLettersByColIdx: Record<number, string> = {};
              bannerCols.forEach((thisCol, thisIdx) => {
                const letters: string[] = [];
                bannerCols.forEach((otherCol, otherIdx) => {
                  if (otherIdx === thisIdx) return;
                  if (otherCol.groupIdx !== thisCol.groupIdx) return;
                  const n1 = totalRespondingByCut[thisCol.id] || 0;
                  const n2 = totalRespondingByCut[otherCol.id] || 0;
                  const p1 = cutPercents[thisCol.id] || 0;
                  const p2 = cutPercents[otherCol.id] || 0;
                  if (p1 <= p2) return;
                  if (!n1 || !n2) return;
                  const prop1 = p1 / 100;
                  const prop2 = p2 / 100;
                  const pooled = (prop1 * n1 + prop2 * n2) / (n1 + n2);
                  const se = Math.sqrt(pooled * (1 - pooled) * (1 / n1 + 1 / n2));
                  if (se === 0) return;
                  const z = Math.abs(prop1 - prop2) / se;
                  const is95 = z > 1.96;
                  const is90 = z > 1.645 && z <= 1.96;
                  if (significanceLevel === 95) {
                    if (is95) letters.push(String.fromCharCode(65 + otherIdx));
                  } else {
                    if (is95) {
                      letters.push(String.fromCharCode(65 + otherIdx));
                    } else if (is90) {
                      letters.push(String.fromCharCode(97 + otherIdx));
                    }
                  }
                });
                if (letters.length > 0) {
                  statLettersByColIdx[thisIdx] = letters.join('');
                }
              });
              if (Object.keys(statLettersByColIdx).length > 0) {
                const statRow = dataCutsWorksheet.getRow(currentRow++);
                let sc = 2;
                const label = statRow.getCell(sc++);
                label.value = '';
                label.border = { top:{style:'thin'}, bottom:{style:'thin'}, left:{style:'thin'}, right:{style:'thin'} };
                const totalStat = statRow.getCell(sc++);
                totalStat.value = '';
                totalStat.border = { top:{style:'thin'}, bottom:{style:'thin'}, left:{style:'thin'}, right:{style:'thin'} };
                bannerCols.forEach((_, colIdx) => {
                  const cell = statRow.getCell(sc++);
                  const letters = statLettersByColIdx[colIdx] || '';
                  cell.value = letters;
                  cell.alignment = { horizontal:'center', vertical:'middle' };
                  // Blue, bold stat letters
                  cell.font = { color: { argb: 'FF0000FF' }, bold: true };
                  // Light blue background on stat letter cell
                  cell.fill = { type:'pattern', pattern:'solid', fgColor:{ argb:'FFDBEAFE' } };
                  cell.border = { top:{style:'thin'}, bottom:{style:'thin'}, left:{style:'thin'}, right:{style:'thin'} };
                  // Also highlight corresponding Count and % cells for this response row
                  if (letters) {
                    // Count row is currentRow - 2, pct row is currentRow - 1
                    const countCell = dataCutsWorksheet.getRow(currentRow - 2).getCell(2 + colIdx + 1); // +1 to offset total column
                    const pctCell = dataCutsWorksheet.getRow(currentRow - 1).getCell(2 + colIdx + 1);
                    [countCell, pctCell].forEach(target => {
                      target.fill = { type:'pattern', pattern:'solid', fgColor:{ argb:'FFDBEAFE' } };
                    });
                  }
                });
              }
            });

            tableNumber++;
            continue;
          }

          // Handle NetSummaryTable for single select grids
          if (isNetSummaryTable) {
            // Extract net index from table name (e.g., "QB3_NetSummaryTable_0" -> 0)
            const netIndexMatch = tableName.match(/_NetSummaryTable_(\d+)$/);
            const netIndex = netIndexMatch ? parseInt(netIndexMatch[1], 10) : -1;
            const baseName = variable.name;
            const netCodeSelections = netSummaryTableSelectedCodes[baseName] || [];
            const net = netIndex >= 0 && netIndex < netCodeSelections.length ? netCodeSelections[netIndex] : null;
            
            if (!net || !net.codes || net.codes.length === 0) {
              tableNumber++;
              continue;
            }

          // Record position for TOC
          tablePositions.push({
            tableNumber,
            tableName,
            rowNumber: currentRow,
            variable
          });

            // Table title
            const baseQuestionNumber = getBaseQuestionNumber(variable.name);
            const tableTitle = `Table ${tableNumber}: ${baseQuestionNumber}: ${net.name}`;
            const titleRow = dataCutsWorksheet.getRow(currentRow++);
            titleRow.getCell(2).value = tableTitle;
            titleRow.getCell(2).font = { bold: true, size: 12 };
            
            // Question text
            const questionRow = dataCutsWorksheet.getRow(currentRow++);
            questionRow.getCell(2).value = variable.description || variable.name;
            questionRow.getCell(2).font = { size: 11 };
            
            // Calculate banner table data for this variable
            const bannerTableData = calculateBannerTableDataForVariable(variable, variable.name, bannerGroup);
            
            // Extract bases from banner table data
            let totalBase = 0;
            const cutBases: Record<string, number> = {};
            bannerCols.forEach(col => { cutBases[col.id] = 0; });
            
            // Get bases from the first statement entry
            const statementEntries = variable.statements ? Object.entries(variable.statements) : [];
            if (statementEntries.length > 0) {
              const firstStmtCode = statementEntries[0][0];
              const firstStmtData = (bannerTableData as any)?.[firstStmtCode];
              if (firstStmtData && firstStmtData.total && typeof firstStmtData.total.base === 'number') {
                totalBase = firstStmtData.total.base;
              }
              bannerCols.forEach(col => {
                const baseValue = firstStmtData?.[col.id]?.base;
                if (typeof baseValue === 'number') {
                  cutBases[col.id] = baseValue;
                }
              });
            }
            
            // Build 3-row header structure (same as other summary tables)
            const headerStartRow = currentRow;
            const groupTitleRow = headerStartRow;
            const cutTitleRow = headerStartRow + 1;
            const statLetterRow = headerStartRow + 2;
            let currentCol = 2; // Start at column B
            
            // Row label cell (merged across all 3 rows)
            const rowLabelCell = dataCutsWorksheet.getRow(groupTitleRow).getCell(currentCol);
            rowLabelCell.value = '';
            rowLabelCell.border = {
              top: { style: 'thin' },
              bottom: { style: 'thin' },
              left: { style: 'thin' },
              right: { style: 'thin' }
            };
            dataCutsWorksheet.mergeCells(groupTitleRow, currentCol, statLetterRow, currentCol);
            [cutTitleRow, statLetterRow].forEach(row => {
              const cell = dataCutsWorksheet.getRow(row).getCell(currentCol);
              cell.border = {
                top: { style: 'thin' },
                bottom: { style: 'thin' },
                left: { style: 'thin' },
                right: { style: 'thin' }
              };
            });
            currentCol++;
            
            // Total column
            const totalGroupCell = dataCutsWorksheet.getRow(groupTitleRow).getCell(currentCol);
            totalGroupCell.value = 'Total';
            totalGroupCell.alignment = { horizontal: 'center', vertical: 'middle' };
            totalGroupCell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
            totalGroupCell.fill = {
              type: 'pattern',
              pattern: 'solid',
              fgColor: { argb: 'FFD14A2D' }
            };
            totalGroupCell.border = {
              top: { style: 'thin' },
              bottom: { style: 'thin' },
              left: { style: 'thin' },
              right: { style: 'thin' }
            };
            dataCutsWorksheet.mergeCells(groupTitleRow, currentCol, cutTitleRow, currentCol);
            const totalCutCell = dataCutsWorksheet.getRow(cutTitleRow).getCell(currentCol);
            totalCutCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFD14A2D' } };
            totalCutCell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
            totalCutCell.border = {
              top: { style: 'thin' },
              bottom: { style: 'thin' },
              left: { style: 'thin' },
              right: { style: 'thin' }
            };
            const totalStatCell = dataCutsWorksheet.getRow(statLetterRow).getCell(currentCol);
            totalStatCell.value = '';
            totalStatCell.alignment = { horizontal: 'center', vertical: 'middle' };
            totalStatCell.fill = {
              type: 'pattern',
              pattern: 'solid',
              fgColor: { argb: 'FFD14A2D' }
            };
            totalStatCell.border = {
              top: { style: 'thin' },
              bottom: { style: 'thin' },
              left: { style: 'thin' },
              right: { style: 'thin' }
            };
            currentCol++;
            
            // Banner group titles and cut columns
            groupStructure.forEach((group, groupIdx) => {
              const groupStartCol = currentCol;
              
              // Group title
              const groupCell = dataCutsWorksheet.getRow(groupTitleRow).getCell(groupStartCol);
              groupCell.value = group.title;
              groupCell.alignment = { horizontal: 'center', vertical: 'middle' };
              groupCell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
              groupCell.fill = {
                type: 'pattern',
                pattern: 'solid',
                fgColor: { argb: 'FFD14A2D' }
              };
              groupCell.border = {
                top: { style: 'thin' },
                bottom: { style: 'thin' },
                left: { style: 'thin' },
                right: { style: 'thin' }
              };
              if (group.cutCount > 1) {
                dataCutsWorksheet.mergeCells(groupTitleRow, groupStartCol, groupTitleRow, groupStartCol + group.cutCount - 1);
              }
              
              // Individual cut titles and stat letters
              for (let i = 0; i < group.cutCount; i++) {
                const cutCol = groupStartCol + i;
                const bannerCol = bannerCols[group.startIdx + i];
                
                // Cut title
                const cutCell = dataCutsWorksheet.getRow(cutTitleRow).getCell(cutCol);
                cutCell.value = bannerCol.title;
                cutCell.alignment = { horizontal: 'center', vertical: 'middle' };
                cutCell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
                cutCell.fill = {
                  type: 'pattern',
                  pattern: 'solid',
                  fgColor: { argb: 'FFD14A2D' }
                };
                cutCell.border = {
                  top: { style: 'thin' },
                  bottom: { style: 'thin' },
                  left: { style: 'thin' },
                  right: { style: 'thin' }
                };
                
                // Stat letter
                const statCell = dataCutsWorksheet.getRow(statLetterRow).getCell(cutCol);
                const statLetter = String.fromCharCode(65 + group.startIdx + i);
                statCell.value = `(${statLetter})`;
                statCell.alignment = { horizontal: 'center', vertical: 'middle' };
                statCell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
                statCell.fill = {
                  type: 'pattern',
                  pattern: 'solid',
                  fgColor: { argb: 'FFD14A2D' }
                };
                statCell.border = {
                  top: { style: 'thin' },
                  bottom: { style: 'thin' },
                  left: { style: 'thin' },
                  right: { style: 'thin' }
                };
              }
              
              currentCol += group.cutCount;
            });
            
            currentRow += 3; // Move past 3 header rows
            
            // First pass: Calculate all statement bases to check if they're all the same
            interface StatementData {
              stmtCode: string;
              stmtLabel: string;
              stmtColHeader: string | null;
              stmtTotalBase: number;
              stmtCutBases: Record<string, number>;
              netTotalCount: number;
              netCutCounts: Record<string, number>;
            }
            
            const statementDataList: StatementData[] = [];
            
            statementEntries.forEach(([stmtCode, stmtLabel]) => {
              // Build column header for this statement
              const baseNumber = variable.name.replace(/^Q/, '');
              const stmtHeader = `Q${baseNumber}${stmtCode}`;
              let stmtColHeader: string | null = null;
              const variations = [stmtHeader, stmtHeader.replace(/^Q/, ''), baseNumber + stmtCode];
              for (const v of variations) {
                if (columnMapping[v]) { stmtColHeader = columnMapping[v]; break; }
                const match = Object.keys(columnMapping).find(k => k.toLowerCase() === v.toLowerCase());
                if (match) { stmtColHeader = columnMapping[match]; break; }
              }
              if (!stmtColHeader && fullRawData.columns) {
                for (const v of variations) {
                  const found = fullRawData.columns.find((c: string) => c.toLowerCase() === v.toLowerCase());
                  if (found) { stmtColHeader = found; break; }
                }
              }
              
              if (!stmtColHeader) return; // Skip if we can't find the column
              
              // Calculate statement-specific base (total responding for this statement)
              let stmtTotalBase = 0;
              const stmtCutBases: Record<string, number> = {};
              bannerCols.forEach(col => { stmtCutBases[col.id] = 0; });
              
              // Calculate net totals by counting rows that match any of the net codes
              let netTotalCount = 0;
              const netCutCounts: Record<string, number> = {};
              bannerCols.forEach(col => { netCutCounts[col.id] = 0; });
              
              // Process all rows
              fullRawData.rows.forEach((row: any) => {
                const val = row[stmtColHeader!];
                if (val === null || val === undefined || val === '') return;
                
                // Count this row in the statement base (any response counts)
                stmtTotalBase++;
                
                // Check which banner cuts this row matches for base calculation
                const matchedCuts: string[] = [];
                bannerCols.forEach(col => {
                  if (!col.colHeader) return;
                  const bannerVal = row[col.colHeader];
                  if (bannerVal === null || bannerVal === undefined || bannerVal === '') return;
                  const bannerValStr = String(bannerVal).trim();
                  const numBannerVal = Number(bannerValStr);
                  for (const cutCode of col.codes) {
                    let matches = false;
                    if (bannerValStr === cutCode) matches = true;
                    else if (!isNaN(numBannerVal) && String(numBannerVal) === cutCode) matches = true;
                    else {
                      const codeNoC = cutCode.replace(/^c/i, '');
                      if (bannerValStr === codeNoC || (!isNaN(numBannerVal) && !isNaN(Number(codeNoC)) && numBannerVal === Number(codeNoC))) {
                        matches = true;
                      }
                    }
                    if (matches) {
                      matchedCuts.push(col.id);
                      stmtCutBases[col.id]++;
                      break;
                    }
                  }
                });
                
                const valStr = String(val).trim();
                
                // Check if this value matches any of the net codes
                let matchesNet = false;
                net.codes.forEach(netCode => {
                  const normalizedNetCode = netCode.replace(/^c/i, '');
                  // Check various formats
                  if (valStr === netCode || 
                      valStr === normalizedNetCode || 
                      String(Number(valStr)) === normalizedNetCode ||
                      (!isNaN(Number(valStr)) && !isNaN(Number(normalizedNetCode)) && Number(valStr) === Number(normalizedNetCode))) {
                    matchesNet = true;
                  }
                });
                
                if (matchesNet) {
                  // Count this row in the net total
                  netTotalCount++;
                  // Add to net cut counts
                  matchedCuts.forEach(cutId => {
                    netCutCounts[cutId]++;
                  });
                }
              });
              
              statementDataList.push({
                stmtCode,
                stmtLabel,
                stmtColHeader,
                stmtTotalBase,
                stmtCutBases,
                netTotalCount,
                netCutCounts
              });
            });
            
            // Check if sorting by frequency/percentage is enabled
            const isSortedByFrequency = getEffectiveSortByFrequency(variable);
            
            // Sort statements by total percentage (descending) if sorting is enabled
            if (isSortedByFrequency) {
              statementDataList.sort((a, b) => {
                const aPct = a.stmtTotalBase > 0 ? (a.netTotalCount / a.stmtTotalBase) * 100 : 0;
                const bPct = b.stmtTotalBase > 0 ? (b.netTotalCount / b.stmtTotalBase) * 100 : 0;
                return bPct - aPct; // Descending order
              });
            }
            
            // Check if all total bases are the same
            const allBasesSame = statementDataList.length > 0 &&
              statementDataList.every(data => data.stmtTotalBase === statementDataList[0].stmtTotalBase);

            // Calculate stat letters for all statements before rendering
            const allStatLettersNetSummary: Record<string, Record<number, { letter: string; is95: boolean }[]>> = {};

            statementDataList.forEach((data) => {
              const { stmtCode, stmtCutBases, netCutCounts } = data;
              const codeStatLetters: Record<number, { letter: string; is95: boolean }[]> = {};

              bannerCols.forEach((thisCol, colIdx) => {
                const thisBase = stmtCutBases[thisCol.id] || 0;
                const thisCount = netCutCounts[thisCol.id] || 0;
                const thisPct = thisBase > 0 ? (thisCount / thisBase) * 100 : 0;
                const statLettersForCol: { letter: string; is95: boolean }[] = [];

                // Within-group comparisons ONLY
                bannerCols.forEach((otherCol, otherIdx) => {
                  if (otherIdx === colIdx) return;
                  if (otherCol.groupIdx !== thisCol.groupIdx) return;

                  const otherBase = stmtCutBases[otherCol.id] || 0;
                  const otherCount = netCutCounts[otherCol.id] || 0;
                  const otherPct = otherBase > 0 ? (otherCount / otherBase) * 100 : 0;

                  if (thisPct > otherPct) {
                    const { is95, is90 } = isSignificant(thisPct, thisBase, otherPct, otherBase);

                    if (significanceLevel === 95) {
                      if (is95) statLettersForCol.push({ letter: String.fromCharCode(65 + otherIdx), is95: true });
                    } else {
                      if (is95) {
                        statLettersForCol.push({ letter: String.fromCharCode(65 + otherIdx), is95: true });
                      } else if (is90) {
                        statLettersForCol.push({ letter: String.fromCharCode(97 + otherIdx), is95: false });
                      }
                    }
                  }
                });

                codeStatLetters[colIdx] = statLettersForCol;
              });

              allStatLettersNetSummary[stmtCode] = codeStatLetters;
            });

            // Second pass: Render statements
            statementDataList.forEach((data, idx) => {
              const { stmtCode, stmtLabel, stmtTotalBase, stmtCutBases, netTotalCount, netCutCounts } = data;
              
              // Add Base (total responding) row for this statement
              // Only show if bases differ, or if this is the first statement when bases are the same
              const shouldShowBase = !allBasesSame || idx === 0;
              
              if (shouldShowBase) {
                const STATS_GREY = 'FFE8E8E8';
                const stmtBaseRow = dataCutsWorksheet.getRow(currentRow++);
                stmtBaseRow.getCell(2).value = 'Base (total responding):';
                stmtBaseRow.getCell(2).font = { bold: true };
                stmtBaseRow.getCell(2).fill = {
                  type: 'pattern',
                  pattern: 'solid',
                  fgColor: { argb: STATS_GREY }
                };
                stmtBaseRow.getCell(2).border = {
                  top: { style: 'thin' },
                  bottom: { style: 'thin' },
                  left: { style: 'thin' },
                  right: { style: 'thin' }
                };
                stmtBaseRow.getCell(3).value = stmtTotalBase;
                stmtBaseRow.getCell(3).alignment = { horizontal: 'center' };
                stmtBaseRow.getCell(3).fill = {
                  type: 'pattern',
                  pattern: 'solid',
                  fgColor: { argb: STATS_GREY }
                };
                stmtBaseRow.getCell(3).border = {
                  top: { style: 'thin' },
                  bottom: { style: 'thin' },
                  left: { style: 'thin' },
                  right: { style: 'thin' }
                };
                let baseCol = 4;
                bannerCols.forEach(bannerCol => {
                  stmtBaseRow.getCell(baseCol).value = stmtCutBases[bannerCol.id] || 0;
                  stmtBaseRow.getCell(baseCol).alignment = { horizontal: 'center' };
                  stmtBaseRow.getCell(baseCol).fill = {
                    type: 'pattern',
                    pattern: 'solid',
                    fgColor: { argb: STATS_GREY }
                  };
                  stmtBaseRow.getCell(baseCol).border = {
                    top: { style: 'thin' },
                    bottom: { style: 'thin' },
                    left: { style: 'thin' },
                    right: { style: 'thin' }
                  };
                  baseCol++;
                });
              }
              
              // Count row
              const countRow = dataCutsWorksheet.getRow(currentRow++);
              countRow.getCell(2).value = String(stmtLabel);
              countRow.getCell(2).border = {
                top: { style: 'thin' },
                bottom: { style: 'thin' },
                left: { style: 'thin' },
                right: { style: 'thin' }
              };
              countRow.getCell(3).value = netTotalCount;
              countRow.getCell(3).alignment = { horizontal: 'center' };
              countRow.getCell(3).border = {
                top: { style: 'thin' },
                bottom: { style: 'thin' },
                left: { style: 'thin' },
                right: { style: 'thin' }
              };
              let col = 4;
              bannerCols.forEach((bannerCol, colIdx) => {
                const countCell = countRow.getCell(col);
                countCell.value = netCutCounts[bannerCol.id] || 0;
                countCell.alignment = { horizontal: 'center' };

                // Add blue highlighting if this cell has stat letters
                const statLettersForCode = allStatLettersNetSummary[stmtCode] || {};
                const statLetters = statLettersForCode[colIdx] || [];
                if (statLetters.length > 0) {
                  countCell.fill = {
                    type: 'pattern',
                    pattern: 'solid',
                    fgColor: { argb: 'FFE6F3FF' }
                  };
                }

                countCell.border = {
                  top: { style: 'thin' },
                  bottom: { style: 'thin' },
                  left: { style: 'thin' },
                  right: { style: 'thin' }
                };
                col++;
              });
              
              // Percentage row (use statement-specific base)
              const pctRow = dataCutsWorksheet.getRow(currentRow++);
              pctRow.getCell(2).value = '';
              pctRow.getCell(2).border = {
                top: { style: 'thin' },
                bottom: { style: 'thin' },
                left: { style: 'thin' },
                right: { style: 'thin' }
              };
              const totalPct = stmtTotalBase > 0 ? (netTotalCount / stmtTotalBase) * 100 : 0;
              const totalPctCell = pctRow.getCell(3);
              totalPctCell.value = totalPct / 100; // Store as decimal for percentage format
              totalPctCell.numFmt = percentageDecimals === 0 ? '0%' : percentageDecimals === 1 ? '0.0%' : '0.00%';
              totalPctCell.alignment = { horizontal: 'center' };
              totalPctCell.border = {
                top: { style: 'thin' },
                bottom: { style: 'thin' },
                left: { style: 'thin' },
                right: { style: 'thin' }
              };
              col = 4;
              bannerCols.forEach((bannerCol, colIdx) => {
                const cutPct = stmtCutBases[bannerCol.id] > 0 ? (netCutCounts[bannerCol.id] / stmtCutBases[bannerCol.id]) * 100 : 0;
                const cutPctCell = pctRow.getCell(col);
                cutPctCell.value = cutPct / 100; // Store as decimal for percentage format
                cutPctCell.numFmt = percentageDecimals === 0 ? '0%' : percentageDecimals === 1 ? '0.0%' : '0.00%';
                cutPctCell.alignment = { horizontal: 'center' };

                // Add blue highlighting if this cell has stat letters
                const statLettersForCode = allStatLettersNetSummary[stmtCode] || {};
                const statLetters = statLettersForCode[colIdx] || [];
                if (statLetters.length > 0) {
                  cutPctCell.fill = {
                    type: 'pattern',
                    pattern: 'solid',
                    fgColor: { argb: 'FFE6F3FF' }
                  };
                }

                cutPctCell.border = {
                  top: { style: 'thin' },
                  bottom: { style: 'thin' },
                  left: { style: 'thin' },
                  right: { style: 'thin' }
                };
                col++;
              });

              // Stat letters row
              const statLettersForCode = allStatLettersNetSummary[stmtCode] || {};
              const hasAnyStatLettersForCode = Object.values(statLettersForCode).some(arr => arr && arr.length > 0);

              if (hasAnyStatLettersForCode) {
                const statRow = dataCutsWorksheet.getRow(currentRow++);
                statRow.getCell(2).value = '';
                statRow.getCell(2).border = {
                  top: { style: 'thin' },
                  bottom: { style: 'thin' },
                  left: { style: 'thin' },
                  right: { style: 'thin' }
                };

                statRow.getCell(3).value = '';
                statRow.getCell(3).border = {
                  top: { style: 'thin' },
                  bottom: { style: 'thin' },
                  left: { style: 'thin' },
                  right: { style: 'thin' }
                };

                col = 4;
                bannerCols.forEach((bannerCol, colIdx) => {
                  const statLetters = statLettersForCode[colIdx] || [];
                  const statLettersStr = statLetters.map(s => s.letter).join('');
                  const statCell = statRow.getCell(col);
                  statCell.value = statLettersStr;
                  statCell.alignment = { horizontal: 'center', vertical: 'middle' };
                  if (statLetters.length > 0) {
                    statCell.fill = {
                      type: 'pattern',
                      pattern: 'solid',
                      fgColor: { argb: 'FFE6F3FF' }
                    };
                  }
                  statCell.border = {
                    top: { style: 'thin' },
                    bottom: { style: 'thin' },
                    left: { style: 'thin' },
                    right: { style: 'thin' }
                  };
                  col++;
                });
              }
            });

            // Add comparison groups details section
            // Build comparison groups string based on banner groups
            const groupMapNetSummary = new Map<number, number[]>();
            bannerCols.forEach((col, idx) => {
              const groupIdx = col.groupIdx;
              if (!groupMapNetSummary.has(groupIdx)) {
                groupMapNetSummary.set(groupIdx, []);
              }
              groupMapNetSummary.get(groupIdx)!.push(idx);
            });

            const comparisonGroupsNetSummary = Array.from(groupMapNetSummary.values())
              .map(colIndices =>
                colIndices.map(idx => String.fromCharCode(65 + idx)).join('')
              )
              .join('/');

            // Comparison groups row
            const compGroupsRowNetSummary = dataCutsWorksheet.getRow(currentRow++);
            compGroupsRowNetSummary.getCell(2).value = `Comparison Groups: ${comparisonGroupsNetSummary}`;
            compGroupsRowNetSummary.getCell(2).font = { size: 9, italic: true };

            // Uppercase explanation row
            const upperRowNetSummary = dataCutsWorksheet.getRow(currentRow++);
            upperRowNetSummary.getCell(2).value = 'Uppercase letters indicate significance at the 95% level.';
            upperRowNetSummary.getCell(2).font = { size: 9, italic: true };

            // Lowercase explanation row (only if significance level is 90)
            if (significanceLevel === 90) {
              const lowerRowNetSummary = dataCutsWorksheet.getRow(currentRow++);
              lowerRowNetSummary.getCell(2).value = 'Lowercase letters indicate significance at the 90% level.';
              lowerRowNetSummary.getCell(2).font = { size: 9, italic: true };
            }

            tableNumber++;
            continue;
          }

          // Handle MeanSummaryTable for single select grids
          const isMeanSummaryTableForSSG = isSingleSelectGrid && tableName.endsWith('_MeanSummaryTable');
          if (isMeanSummaryTableForSSG) {
            const baseName = variable.name;
            const statementEntries = variable.statements ? Object.entries(variable.statements) : [];

            if (statementEntries.length === 0) {
              tableNumber++;
              continue;
            }

            // Record position for TOC
            tablePositions.push({
              tableNumber,
              tableName,
              rowNumber: currentRow,
              variable
            });

            // Table title
            const baseQuestionNumber = getBaseQuestionNumber(variable.name);
            const tableTitle = `Table ${tableNumber}: ${baseQuestionNumber}: Mean Summary Table`;
            const titleRow = dataCutsWorksheet.getRow(currentRow++);
            titleRow.getCell(2).value = tableTitle;
            titleRow.getCell(2).font = { bold: true, size: 12 };

            // Question text
            const questionRow = dataCutsWorksheet.getRow(currentRow++);
            questionRow.getCell(2).value = variable.description || variable.name;
            questionRow.getCell(2).font = { size: 11 };

            // Build 3-row header structure
            const headerStartRow = currentRow;
            const groupTitleRow = headerStartRow;
            const cutTitleRow = headerStartRow + 1;
            const statLetterRow = headerStartRow + 2;
            let currentCol = 2;

            // Row label cell (merged across all 3 rows)
            const rowLabelCell = dataCutsWorksheet.getRow(groupTitleRow).getCell(currentCol);
            rowLabelCell.value = '';
            rowLabelCell.border = {
              top: { style: 'thin' },
              bottom: { style: 'thin' },
              left: { style: 'thin' },
              right: { style: 'thin' }
            };
            dataCutsWorksheet.mergeCells(groupTitleRow, currentCol, statLetterRow, currentCol);
            [cutTitleRow, statLetterRow].forEach(row => {
              const cell = dataCutsWorksheet.getRow(row).getCell(currentCol);
              cell.border = {
                top: { style: 'thin' },
                bottom: { style: 'thin' },
                left: { style: 'thin' },
                right: { style: 'thin' }
              };
            });
            currentCol++;

            // Total column
            const totalGroupCell = dataCutsWorksheet.getRow(groupTitleRow).getCell(currentCol);
            totalGroupCell.value = 'Total';
            totalGroupCell.alignment = { horizontal: 'center', vertical: 'middle' };
            totalGroupCell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
            totalGroupCell.fill = {
              type: 'pattern',
              pattern: 'solid',
              fgColor: { argb: 'FFD14A2D' }
            };
            totalGroupCell.border = {
              top: { style: 'thin' },
              bottom: { style: 'thin' },
              left: { style: 'thin' },
              right: { style: 'thin' }
            };
            dataCutsWorksheet.mergeCells(groupTitleRow, currentCol, cutTitleRow, currentCol);
            const totalCutCell = dataCutsWorksheet.getRow(cutTitleRow).getCell(currentCol);
            totalCutCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFD14A2D' } };
            totalCutCell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
            totalCutCell.border = {
              top: { style: 'thin' },
              bottom: { style: 'thin' },
              left: { style: 'thin' },
              right: { style: 'thin' }
            };
            const totalStatCell = dataCutsWorksheet.getRow(statLetterRow).getCell(currentCol);
            totalStatCell.value = '';
            totalStatCell.alignment = { horizontal: 'center', vertical: 'middle' };
            totalStatCell.fill = {
              type: 'pattern',
              pattern: 'solid',
              fgColor: { argb: 'FFD14A2D' }
            };
            totalStatCell.border = {
              top: { style: 'thin' },
              bottom: { style: 'thin' },
              left: { style: 'thin' },
              right: { style: 'thin' }
            };
            currentCol++;

            // Banner group titles and cut columns
            groupStructure.forEach((group, groupIdx) => {
              const groupStartCol = currentCol;

              // Group title
              const groupCell = dataCutsWorksheet.getRow(groupTitleRow).getCell(groupStartCol);
              groupCell.value = group.title;
              groupCell.alignment = { horizontal: 'center', vertical: 'middle' };
              groupCell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
              groupCell.fill = {
                type: 'pattern',
                pattern: 'solid',
                fgColor: { argb: 'FFD14A2D' }
              };
              groupCell.border = {
                top: { style: 'thin' },
                bottom: { style: 'thin' },
                left: { style: 'thin' },
                right: { style: 'thin' }
              };
              if (group.cutCount > 1) {
                dataCutsWorksheet.mergeCells(groupTitleRow, groupStartCol, groupTitleRow, groupStartCol + group.cutCount - 1);
              }

              // Individual cut titles and stat letters
              for (let i = 0; i < group.cutCount; i++) {
                const cutCol = groupStartCol + i;
                const bannerCol = bannerCols[group.startIdx + i];

                // Cut title
                const cutCell = dataCutsWorksheet.getRow(cutTitleRow).getCell(cutCol);
                cutCell.value = bannerCol.title;
                cutCell.alignment = { horizontal: 'center', vertical: 'middle' };
                cutCell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
                cutCell.fill = {
                  type: 'pattern',
                  pattern: 'solid',
                  fgColor: { argb: 'FFD14A2D' }
                };
                cutCell.border = {
                  top: { style: 'thin' },
                  bottom: { style: 'thin' },
                  left: { style: 'thin' },
                  right: { style: 'thin' }
                };

                // Stat letter
                const statCell = dataCutsWorksheet.getRow(statLetterRow).getCell(cutCol);
                const statLetter = String.fromCharCode(65 + group.startIdx + i);
                statCell.value = `(${statLetter})`;
                statCell.alignment = { horizontal: 'center', vertical: 'middle' };
                statCell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
                statCell.fill = {
                  type: 'pattern',
                  pattern: 'solid',
                  fgColor: { argb: 'FFD14A2D' }
                };
                statCell.border = {
                  top: { style: 'thin' },
                  bottom: { style: 'thin' },
                  left: { style: 'thin' },
                  right: { style: 'thin' }
                };
              }

              currentCol += group.cutCount;
            });

            currentRow += 3; // Move past 3 header rows

            // First pass: Calculate means and standard deviations for all statements
            interface StatementMeanData {
              stmtCode: string;
              stmtLabel: string;
              totalMean: number;
              totalStdDev: number;
              totalCount: number;
              cutMeans: Record<string, number>;
              cutStdDevs: Record<string, number>;
              cutCounts: Record<string, number>;
            }

            const statementMeanDataList: StatementMeanData[] = [];

            statementEntries.forEach(([stmtCode, stmtLabel]) => {
              // Build column header for this statement
              const baseNumber = variable.name.replace(/^Q/, '');
              const stmtHeader = `Q${baseNumber}${stmtCode}`;
              let stmtColHeader: string | null = null;
              const variations = [stmtHeader, stmtHeader.replace(/^Q/, ''), baseNumber + stmtCode];
              for (const v of variations) {
                if (columnMapping[v]) { stmtColHeader = columnMapping[v]; break; }
                const match = Object.keys(columnMapping).find(k => k.toLowerCase() === v.toLowerCase());
                if (match) { stmtColHeader = columnMapping[match]; break; }
              }
              if (!stmtColHeader && fullRawData.columns) {
                for (const v of variations) {
                  const found = fullRawData.columns.find((c: string) => c.toLowerCase() === v.toLowerCase());
                  if (found) { stmtColHeader = found; break; }
                }
              }

              if (!stmtColHeader) return;

              // Calculate mean and std dev
              let totalSum = 0;
              let totalCount = 0;
              const totalValues: number[] = [];
              const cutSums: Record<string, number> = {};
              const cutCounts: Record<string, number> = {};
              const cutValues: Record<string, number[]> = {};
              bannerCols.forEach(col => {
                cutSums[col.id] = 0;
                cutCounts[col.id] = 0;
                cutValues[col.id] = [];
              });

              fullRawData.rows.forEach((row: any) => {
                const val = row[stmtColHeader!];
                if (val === null || val === undefined || val === '') return;

                const codeValue = getCodeValueForMean(variable, String(val));
                if (codeValue === null) return;

                totalSum += codeValue;
                totalCount++;
                totalValues.push(codeValue);

                // Check banner cuts
                bannerCols.forEach(col => {
                  if (!col.colHeader) return;
                  const bannerVal = row[col.colHeader];
                  if (bannerVal === null || bannerVal === undefined || bannerVal === '') return;
                  const bannerValStr = String(bannerVal).trim();
                  const numBannerVal = Number(bannerValStr);
                  for (const cutCode of col.codes) {
                    let matches = false;
                    if (bannerValStr === cutCode) matches = true;
                    else if (!isNaN(numBannerVal) && String(numBannerVal) === cutCode) matches = true;
                    else {
                      const codeNoC = cutCode.replace(/^c/i, '');
                      if (bannerValStr === codeNoC || (!isNaN(numBannerVal) && !isNaN(Number(codeNoC)) && numBannerVal === Number(codeNoC))) {
                        matches = true;
                      }
                    }
                    if (matches) {
                      cutSums[col.id] += codeValue;
                      cutCounts[col.id]++;
                      cutValues[col.id].push(codeValue);
                      break;
                    }
                  }
                });
              });

              const totalMean = totalCount > 0 ? totalSum / totalCount : 0;
              const totalStdDev = totalCount > 1 ? Math.sqrt(totalValues.reduce((acc, val) => acc + Math.pow(val - totalMean, 2), 0) / (totalCount - 1)) : 0;

              const cutMeans: Record<string, number> = {};
              const cutStdDevs: Record<string, number> = {};
              bannerCols.forEach(col => {
                const mean = cutCounts[col.id] > 0 ? cutSums[col.id] / cutCounts[col.id] : 0;
                cutMeans[col.id] = mean;
                cutStdDevs[col.id] = cutCounts[col.id] > 1
                  ? Math.sqrt(cutValues[col.id].reduce((acc, val) => acc + Math.pow(val - mean, 2), 0) / (cutCounts[col.id] - 1))
                  : 0;
              });

              statementMeanDataList.push({
                stmtCode,
                stmtLabel: String(stmtLabel),
                totalMean,
                totalStdDev,
                totalCount,
                cutMeans,
                cutStdDevs,
                cutCounts
              });
            });

            // Calculate stat letters for all statements
            const allStatLettersMean: Record<string, Record<number, { letter: string; is95: boolean }[]>> = {};

            statementMeanDataList.forEach((data) => {
              const { stmtCode, cutMeans, cutStdDevs, cutCounts } = data;
              const codeStatLetters: Record<number, { letter: string; is95: boolean }[]> = {};

              bannerCols.forEach((thisCol, colIdx) => {
                const thisMean = cutMeans[thisCol.id] || 0;
                const thisStdDev = cutStdDevs[thisCol.id] || 0;
                const thisCount = cutCounts[thisCol.id] || 0;
                const statLettersForCol: { letter: string; is95: boolean }[] = [];

                // Within-group comparisons ONLY
                bannerCols.forEach((otherCol, otherIdx) => {
                  if (otherIdx === colIdx) return;
                  if (otherCol.groupIdx !== thisCol.groupIdx) return;

                  const otherMean = cutMeans[otherCol.id] || 0;
                  const otherStdDev = cutStdDevs[otherCol.id] || 0;
                  const otherCount = cutCounts[otherCol.id] || 0;

                  if (thisMean > otherMean) {
                    const { is95, is90 } = isSignificantForMeans(thisMean, thisCount, thisStdDev, otherMean, otherCount, otherStdDev);

                    if (significanceLevel === 95) {
                      if (is95) statLettersForCol.push({ letter: String.fromCharCode(65 + otherIdx), is95: true });
                    } else {
                      if (is95) {
                        statLettersForCol.push({ letter: String.fromCharCode(65 + otherIdx), is95: true });
                      } else if (is90) {
                        statLettersForCol.push({ letter: String.fromCharCode(97 + otherIdx), is95: false });
                      }
                    }
                  }
                });

                codeStatLetters[colIdx] = statLettersForCol;
              });

              allStatLettersMean[stmtCode] = codeStatLetters;
            });

            // Second pass: Render statements with stat letters
            statementMeanDataList.forEach((data) => {
              const { stmtCode, stmtLabel, totalMean, cutMeans } = data;

              // Mean row
              const meanRow = dataCutsWorksheet.getRow(currentRow++);
              meanRow.getCell(2).value = String(stmtLabel);
              meanRow.getCell(2).border = {
                top: { style: 'thin' },
                bottom: { style: 'thin' },
                left: { style: 'thin' },
                right: { style: 'thin' }
              };

              meanRow.getCell(3).value = totalMean;
              meanRow.getCell(3).numFmt = '0.00';
              meanRow.getCell(3).alignment = { horizontal: 'center' };
              meanRow.getCell(3).border = {
                top: { style: 'thin' },
                bottom: { style: 'thin' },
                left: { style: 'thin' },
                right: { style: 'thin' }
              };

              let col = 4;
              bannerCols.forEach((bannerCol, colIdx) => {
                const cutMean = cutMeans[bannerCol.id] || 0;
                const meanCell = meanRow.getCell(col);
                meanCell.value = cutMean;
                meanCell.numFmt = '0.00';
                meanCell.alignment = { horizontal: 'center' };

                // Add blue highlighting if this cell has stat letters
                const statLettersForCode = allStatLettersMean[stmtCode] || {};
                const statLetters = statLettersForCode[colIdx] || [];
                if (statLetters.length > 0) {
                  meanCell.fill = {
                    type: 'pattern',
                    pattern: 'solid',
                    fgColor: { argb: 'FFE6F3FF' }
                  };
                }

                meanCell.border = {
                  top: { style: 'thin' },
                  bottom: { style: 'thin' },
                  left: { style: 'thin' },
                  right: { style: 'thin' }
                };
                col++;
              });

              // Stat letters row
              const statLettersForCode = allStatLettersMean[stmtCode] || {};
              const hasAnyStatLettersForCode = Object.values(statLettersForCode).some(arr => arr && arr.length > 0);

              if (hasAnyStatLettersForCode) {
                const statRow = dataCutsWorksheet.getRow(currentRow++);
                statRow.getCell(2).value = '';
                statRow.getCell(2).border = {
                  top: { style: 'thin' },
                  bottom: { style: 'thin' },
                  left: { style: 'thin' },
                  right: { style: 'thin' }
                };

                statRow.getCell(3).value = '';
                statRow.getCell(3).border = {
                  top: { style: 'thin' },
                  bottom: { style: 'thin' },
                  left: { style: 'thin' },
                  right: { style: 'thin' }
                };

                col = 4;
                bannerCols.forEach((bannerCol, colIdx) => {
                  const statLetters = statLettersForCode[colIdx] || [];
                  const statLettersStr = statLetters.map(s => s.letter).join('');
                  const statCell = statRow.getCell(col);
                  statCell.value = statLettersStr;
                  statCell.alignment = { horizontal: 'center', vertical: 'middle' };
                  if (statLetters.length > 0) {
                    statCell.fill = {
                      type: 'pattern',
                      pattern: 'solid',
                      fgColor: { argb: 'FFE6F3FF' }
                    };
                    statCell.font = { bold: true };
                  }
                  statCell.border = {
                    top: { style: 'thin' },
                    bottom: { style: 'thin' },
                    left: { style: 'thin' },
                    right: { style: 'thin' }
                  };
                  col++;
                });
              }
            });

            // Add comparison groups and significance explanation rows
            const groupMapMeanSummary = new Map<number, number[]>();
            bannerCols.forEach((col, idx) => {
              if (!groupMapMeanSummary.has(col.groupIdx)) {
                groupMapMeanSummary.set(col.groupIdx, []);
              }
              groupMapMeanSummary.get(col.groupIdx)!.push(idx);
            });

            const comparisonGroupsMeanSummary = Array.from(groupMapMeanSummary.values())
              .map(colIndices =>
                colIndices.map(idx => String.fromCharCode(65 + idx)).join('')
              )
              .join('/');

            // Comparison groups row
            const compGroupsRowMeanSummary = dataCutsWorksheet.getRow(currentRow++);
            compGroupsRowMeanSummary.getCell(2).value = `Comparison Groups: ${comparisonGroupsMeanSummary}`;
            compGroupsRowMeanSummary.getCell(2).font = { size: 9, italic: true };

            // Uppercase explanation row
            const upperRowMeanSummary = dataCutsWorksheet.getRow(currentRow++);
            upperRowMeanSummary.getCell(2).value = 'Uppercase letters indicate significance at the 95% level.';
            upperRowMeanSummary.getCell(2).font = { size: 9, italic: true };

            // Lowercase explanation row (only if significance level is 90)
            if (significanceLevel === 90) {
              const lowerRowMeanSummary = dataCutsWorksheet.getRow(currentRow++);
              lowerRowMeanSummary.getCell(2).value = 'Lowercase letters indicate significance at the 90% level.';
              lowerRowMeanSummary.getCell(2).font = { size: 9, italic: true };
            }

            tableNumber++;
            continue;
          }

          // Check if this is a regular numeric question (not a grid) - handle BEFORE creating title/question rows
          const isNumericQuestion = variable.type?.toLowerCase().includes('numeric') && 
                                    !variable.type?.toLowerCase().includes('grid') &&
                                    !variable.type?.toLowerCase().includes('list');
          
          // Handle numeric questions - create frequency distribution table
          // MUST be done BEFORE creating title/question rows, as it creates its own structure
          if (isNumericQuestion && tableName === variable.name) {
            if (isB8Debug) {
              appendStatLog('[B8] Entering numeric question handling block (first location)', { tableName, variable: variable.name });
            }
            
            // Calculate banner table data for this variable (needed for banner cuts matching)
            const bannerTableData = calculateBannerTableDataForVariable(variable, variable.name, bannerGroup);
            
            // Find the column header for this numeric variable
            // Check base variable name first (e.g., "S9" or "QS9")
            let numericColHeader = getColumnHeader(variable.name);
            
            // If not found and variable has statements, try statement-specific mappings (e.g., "S9r1" or "QS9r1")
            if (!numericColHeader && variable.statements && Object.keys(variable.statements).length > 0) {
              // Try each statement code
              for (const stmtCode of Object.keys(variable.statements)) {
                // Try variations: baseName + stmtCode (e.g., "S9r1", "QS9r1")
                const baseName = variable.name;
                const variations = [
                  `${baseName}${stmtCode}`,
                  `Q${baseName}${stmtCode}`,
                  baseName.startsWith('Q') ? `${baseName}${stmtCode}` : `Q${baseName}${stmtCode}`,
                  baseName.startsWith('Q') ? `${baseName.substring(1)}${stmtCode}` : `${baseName}${stmtCode}`
                ];
                
                for (const variation of variations) {
                  if (columnMapping[variation]) {
                    numericColHeader = columnMapping[variation];
                    break;
                  }
                  const matchingKey = Object.keys(columnMapping).find(
                    key => key.toLowerCase() === variation.toLowerCase()
                  );
                  if (matchingKey) {
                    numericColHeader = columnMapping[matchingKey];
                    break;
                  }
                  
                  // Also check direct column match
                  if (fullRawData.columns) {
                    const directMatch = fullRawData.columns.find(
                      col => col.toLowerCase() === variation.toLowerCase()
                    );
                    if (directMatch) {
                      numericColHeader = directMatch;
                      break;
                    }
                  }
                }
                
                if (numericColHeader) break;
              }
            }
            
            if (!numericColHeader) {
              if (isB8Debug) {
                appendStatLog('[B8] ERROR: No column header found for numeric variable', { variable: variable.name, statements: variable.statements ? Object.keys(variable.statements) : 'none' });
              }
              // Skip this table if not mapped
              tableNumber++;
              continue;
            }
            
            // Collect all unique numeric values and build frequency distribution
            const uniqueNumericValues = new Set<number>();
            const frequencyMap: Record<number, { total: number; cuts: Record<string, number> }> = {};
            let totalBase = 0;
            const cutBases: Record<string, number> = {};
            bannerCols.forEach(col => { cutBases[col.id] = 0; });
            
            // First pass: collect all unique numeric values
            if (fullRawData && fullRawData.rows) {
              fullRawData.rows.forEach((row: any) => {
                const val = row[numericColHeader];
                if (val !== null && val !== undefined && val !== '') {
                  const numVal = parseFloat(String(val));
                  if (!isNaN(numVal)) {
                    uniqueNumericValues.add(numVal);
                  }
                }
              });
            }
            
            // Sort numeric values
            const sortedNumericValues = Array.from(uniqueNumericValues).sort((a, b) => a - b);
            
            // Initialize frequency map for each numeric value
            sortedNumericValues.forEach(numVal => {
              frequencyMap[numVal] = { total: 0, cuts: {} };
              bannerCols.forEach(col => { frequencyMap[numVal].cuts[col.id] = 0; });
            });
            
            // Second pass: count frequencies and match banner cuts
            if (fullRawData && fullRawData.rows) {
              fullRawData.rows.forEach((row: any) => {
                const val = row[numericColHeader];
                if (val === null || val === undefined || val === '') return;
                const numVal = parseFloat(String(val));
                if (isNaN(numVal)) return;
                
                totalBase++;
                frequencyMap[numVal].total++;
                
                // Check which banner cuts this row matches
                bannerCols.forEach(col => {
                  if (col.matchesRow(row)) {
                    cutBases[col.id]++;
                    frequencyMap[numVal].cuts[col.id]++;
                  }
                });
              });
            }
            
            
            // Record position for TOC
            tablePositions.push({ tableNumber, tableName, rowNumber: currentRow, variable });
            
            // Table title
            const baseQuestionNumber = getBaseQuestionNumber(variable.name);
            const tableTitle = `Table ${tableNumber}: ${baseQuestionNumber}`;
            const titleRow = dataCutsWorksheet.getRow(currentRow++);
            titleRow.getCell(2).value = tableTitle;
            titleRow.getCell(2).font = { bold: true, size: 12 };
            
            // Question text
            const questionRow = dataCutsWorksheet.getRow(currentRow++);
            questionRow.getCell(2).value = variable.description || variable.name;
            questionRow.getCell(2).font = { size: 11 };
            
            // Build 3-row header (Total + banner groups) - same as other tables
            const headerStartRow = currentRow;
            const groupTitleRow = headerStartRow;
            const cutTitleRow = headerStartRow + 1;
            const statLetterRow = headerStartRow + 2;
            let currentCol = 2;
            
            // Row label cell (merged across all 3 rows)
            const rowLabelCell = dataCutsWorksheet.getRow(groupTitleRow).getCell(currentCol);
            rowLabelCell.value = '';
            rowLabelCell.border = {
              top: { style: 'thin' },
              bottom: { style: 'thin' },
              left: { style: 'thin' },
              right: { style: 'thin' }
            };
            dataCutsWorksheet.mergeCells(groupTitleRow, currentCol, statLetterRow, currentCol);
            [cutTitleRow, statLetterRow].forEach(r => {
              const cell = dataCutsWorksheet.getRow(r).getCell(currentCol);
              cell.border = {
                top: { style: 'thin' },
                bottom: { style: 'thin' },
                left: { style: 'thin' },
                right: { style: 'thin' }
              };
            });
            currentCol++;
            
            // Total column
            const totalGroupCell = dataCutsWorksheet.getRow(groupTitleRow).getCell(currentCol);
            totalGroupCell.value = 'Total';
            totalGroupCell.alignment = { horizontal: 'center', vertical: 'middle' };
            totalGroupCell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
            totalGroupCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFD14A2D' } };
            totalGroupCell.border = {
              top: { style: 'thin' },
              bottom: { style: 'thin' },
              left: { style: 'thin' },
              right: { style: 'thin' }
            };
            dataCutsWorksheet.mergeCells(groupTitleRow, currentCol, cutTitleRow, currentCol);
            const totalCutCell = dataCutsWorksheet.getRow(cutTitleRow).getCell(currentCol);
            totalCutCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFD14A2D' } };
            totalCutCell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
            totalCutCell.border = {
              top: { style: 'thin' },
              bottom: { style: 'thin' },
              left: { style: 'thin' },
              right: { style: 'thin' }
            };
            const totalStatCell = dataCutsWorksheet.getRow(statLetterRow).getCell(currentCol);
            totalStatCell.value = '';
            totalStatCell.alignment = { horizontal: 'center', vertical: 'middle' };
            totalStatCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFD14A2D' } };
            totalStatCell.border = {
              top: { style: 'thin' },
              bottom: { style: 'thin' },
              left: { style: 'thin' },
              right: { style: 'thin' }
            };
            currentCol++;
            
            // Banner groups
            groupStructure.forEach((group) => {
              const groupStartCol = currentCol;
              const groupCell = dataCutsWorksheet.getRow(groupTitleRow).getCell(groupStartCol);
              groupCell.value = group.title;
              groupCell.alignment = { horizontal: 'center', vertical: 'middle' };
              groupCell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
              groupCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFD14A2D' } };
              groupCell.border = {
                top: { style: 'thin' },
                bottom: { style: 'thin' },
                left: { style: 'thin' },
                right: { style: 'thin' }
              };
              if (group.cutCount > 1) {
                dataCutsWorksheet.mergeCells(groupTitleRow, groupStartCol, groupTitleRow, groupStartCol + group.cutCount - 1);
              }
              for (let i = 0; i < group.cutCount; i++) {
                const cutCol = groupStartCol + i;
                const bannerCol = bannerCols[group.startIdx + i];
                const cutCell = dataCutsWorksheet.getRow(cutTitleRow).getCell(cutCol);
                cutCell.value = bannerCol.title;
                cutCell.alignment = { horizontal: 'center', vertical: 'middle' };
                cutCell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
                cutCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFD14A2D' } };
                cutCell.border = {
                  top: { style: 'thin' },
                  bottom: { style: 'thin' },
                  left: { style: 'thin' },
                  right: { style: 'thin' }
                };
                const statCell = dataCutsWorksheet.getRow(statLetterRow).getCell(cutCol);
                const statLetter = String.fromCharCode(65 + group.startIdx + i);
                statCell.value = `(${statLetter})`;
                statCell.alignment = { horizontal: 'center', vertical: 'middle' };
                statCell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
                statCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFD14A2D' } };
                statCell.border = {
                  top: { style: 'thin' },
                  bottom: { style: 'thin' },
                  left: { style: 'thin' },
                  right: { style: 'thin' }
                };
              }
              currentCol += group.cutCount;
            });
            currentRow += 3;
            
            // Base row
            const baseRow = dataCutsWorksheet.getRow(currentRow++);
            baseRow.getCell(2).value = 'Base (total responding):';
            baseRow.getCell(2).font = { bold: true };
            baseRow.getCell(2).fill = {
              type: 'pattern',
              pattern: 'solid',
              fgColor: { argb: 'FFE8E8E8' }
            };
            baseRow.getCell(2).border = {
              top: { style: 'thin' },
              bottom: { style: 'thin' },
              left: { style: 'thin' },
              right: { style: 'thin' }
            };
            baseRow.getCell(3).value = totalBase;
            baseRow.getCell(3).alignment = { horizontal: 'center' };
            baseRow.getCell(3).fill = {
              type: 'pattern',
              pattern: 'solid',
              fgColor: { argb: 'FFE8E8E8' }
            };
            baseRow.getCell(3).border = {
              top: { style: 'thin' },
              bottom: { style: 'thin' },
              left: { style: 'thin' },
              right: { style: 'thin' }
            };
            let baseCol = 4;
            bannerCols.forEach(bannerCol => {
              baseRow.getCell(baseCol).value = cutBases[bannerCol.id] || 0;
              baseRow.getCell(baseCol).alignment = { horizontal: 'center' };
              baseRow.getCell(baseCol).fill = {
                type: 'pattern',
                pattern: 'solid',
                fgColor: { argb: 'FFE8E8E8' }
              };
              baseRow.getCell(baseCol).border = {
                top: { style: 'thin' },
                bottom: { style: 'thin' },
                left: { style: 'thin' },
                right: { style: 'thin' }
              };
              baseCol++;
            });
            
            // Render frequency distribution rows
            sortedNumericValues.forEach(numVal => {
              const valueKey = numVal.toString();
              const valueData = numericData[valueKey];
              if (!valueData) return;
              
              // Count row
              const countRow = dataCutsWorksheet.getRow(currentRow++);
              countRow.getCell(2).value = numVal;
              countRow.getCell(2).border = {
                top: { style: 'thin' },
                bottom: { style: 'thin' },
                left: { style: 'thin' },
                right: { style: 'thin' }
              };
              
              // Total count
              const totalCount = valueData['total']?.count || 0;
              countRow.getCell(3).value = totalCount;
              countRow.getCell(3).alignment = { horizontal: 'center' };
              countRow.getCell(3).border = {
                top: { style: 'thin' },
                bottom: { style: 'thin' },
                left: { style: 'thin' },
                right: { style: 'thin' }
              };
              
              // Banner cut counts
              let col = 4;
              bannerCols.forEach(bannerCol => {
                const cutCount = valueData[bannerCol.id]?.count || 0;
                countRow.getCell(col).value = cutCount;
                countRow.getCell(col).alignment = { horizontal: 'center' };
                countRow.getCell(col).border = {
                  top: { style: 'thin' },
                  bottom: { style: 'thin' },
                  left: { style: 'thin' },
                  right: { style: 'thin' }
                };
                col++;
              });
              
              // Percentage row
              const pctRow = dataCutsWorksheet.getRow(currentRow++);
              pctRow.getCell(2).value = '';
              pctRow.getCell(2).border = {
                top: { style: 'thin' },
                bottom: { style: 'thin' },
                left: { style: 'thin' },
                right: { style: 'thin' }
              };
              
              // Total percentage
              const totalPct = valueData['total']?.percentage || 0;
              pctRow.getCell(3).value = totalPct / 100;
              pctRow.getCell(3).numFmt = percentageDecimals === 0 ? '0%' : percentageDecimals === 1 ? '0.0%' : '0.00%';
              pctRow.getCell(3).alignment = { horizontal: 'center' };
              pctRow.getCell(3).border = {
                top: { style: 'thin' },
                bottom: { style: 'thin' },
                left: { style: 'thin' },
                right: { style: 'thin' }
              };
              
              // Banner cut percentages
              col = 4;
              bannerCols.forEach(bannerCol => {
                const cutBase = cutBases[bannerCol.id] || 0;
                const cutPct = valueData[bannerCol.id]?.percentage || 0;
                pctRow.getCell(col).value = cutPct / 100;
                pctRow.getCell(col).numFmt = percentageDecimals === 0 ? '0%' : percentageDecimals === 1 ? '0.0%' : '0.00%';
                pctRow.getCell(col).alignment = { horizontal: 'center' };
                pctRow.getCell(col).border = {
                  top: { style: 'thin' },
                  bottom: { style: 'thin' },
                  left: { style: 'thin' },
                  right: { style: 'thin' }
                };
                col++;
              });
            });
            
            // Add stats rows if enabled
            const statsKey = variable.name;
            const statsSelections = getStatsSelectionsForVariable(statsKey);
            const isNumeric = variable.type?.toLowerCase().includes('numeric');
            if (isNumeric && Object.values(statsSelections).some(v => v)) {
              // Calculate stats from frequency distribution
              let totalCount = 0;
              let sum = 0;
              let sumSquares = 0;
              let min = Infinity;
              let max = -Infinity;
              let modeValue: number | null = null;
              let modeCount = -1;
              
              sortedNumericValues.forEach(numVal => {
                const valueKey = numVal.toString();
                const count = numericData[valueKey]?.['total']?.count || 0;
                totalCount += count;
                sum += numVal * count;
                sumSquares += numVal * numVal * count;
                if (numVal < min) min = numVal;
                if (numVal > max) max = numVal;
                if (count > modeCount) {
                  modeCount = count;
                  modeValue = numVal;
                }
              });
              
              if (totalCount > 0) {
                const mean = sum / totalCount;
                const variance = Math.max(sumSquares / totalCount - mean * mean, 0);
                const stdDev = Math.sqrt(variance);
                const sorted = [...sortedNumericValues];
                const median = sorted.length % 2 === 0
                  ? (sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2
                  : sorted[Math.floor(sorted.length / 2)];
                
                const statsRows = [
                  { label: 'Mean', key: 'mean', value: mean },
                  { label: 'Sum', key: 'sum', value: sum },
                  { label: 'Median', key: 'median', value: median },
                  { label: 'Mode', key: 'mode', value: modeValue },
                  { label: 'Std Dev', key: 'stdDev', value: stdDev },
                  { label: 'Min', key: 'min', value: min },
                  { label: 'Max', key: 'max', value: max },
                ];
                
                statsRows.forEach(stat => {
                  if (statsSelections[stat.key]) {
                    const statRow = dataCutsWorksheet.getRow(currentRow++);
                    statRow.getCell(2).value = stat.label + ':';
                    statRow.getCell(2).font = { bold: true, italic: true };
                    statRow.getCell(2).fill = {
                      type: 'pattern',
                      pattern: 'solid',
                      fgColor: { argb: 'FFE8E8E8' }
                    };
                    statRow.getCell(2).border = {
                      top: { style: 'thin' },
                      bottom: { style: 'thin' },
                      left: { style: 'thin' },
                      right: { style: 'thin' }
                    };
                    
                    // Total stat value
                    statRow.getCell(3).value = stat.value;
                    statRow.getCell(3).numFmt = stat.key === 'sum' ? '0' : '0.00';
                    statRow.getCell(3).alignment = { horizontal: 'center' };
                    statRow.getCell(3).fill = {
                      type: 'pattern',
                      pattern: 'solid',
                      fgColor: { argb: 'FFE8E8E8' }
                    };
                    statRow.getCell(3).border = {
                      top: { style: 'thin' },
                      bottom: { style: 'thin' },
                      left: { style: 'thin' },
                      right: { style: 'thin' }
                    };
                    
                    // Banner cut stats (calculate per cut)
                    let col = 4;
                    bannerCols.forEach(bannerCol => {
                      const cutBase = cutBases[bannerCol.id] || 0;
                      let cutStatValue: number = 0;
                      
                      if (cutBase > 0) {
                        if (stat.key === 'mean') {
                          let cutSum = 0;
                          sortedNumericValues.forEach(numVal => {
                            const valueKey = numVal.toString();
                            cutSum += numVal * (numericData[valueKey]?.[bannerCol.id]?.count || 0);
                          });
                          cutStatValue = cutSum / cutBase;
                        } else if (stat.key === 'sum') {
                          sortedNumericValues.forEach(numVal => {
                            const valueKey = numVal.toString();
                            cutStatValue += numVal * (numericData[valueKey]?.[bannerCol.id]?.count || 0);
                          });
                        } else if (stat.key === 'median') {
                          const cutValues: number[] = [];
                          sortedNumericValues.forEach(numVal => {
                            const valueKey = numVal.toString();
                            const count = numericData[valueKey]?.[bannerCol.id]?.count || 0;
                            for (let i = 0; i < count; i++) {
                              cutValues.push(numVal);
                            }
                          });
                          cutValues.sort((a, b) => a - b);
                          cutStatValue = cutValues.length % 2 === 0
                            ? (cutValues[cutValues.length / 2 - 1] + cutValues[cutValues.length / 2]) / 2
                            : cutValues[Math.floor(cutValues.length / 2)];
                        } else if (stat.key === 'mode') {
                          let cutModeCount = -1;
                          sortedNumericValues.forEach(numVal => {
                            const valueKey = numVal.toString();
                            const count = numericData[valueKey]?.[bannerCol.id]?.count || 0;
                            if (count > cutModeCount) {
                              cutModeCount = count;
                              cutStatValue = numVal;
                            }
                          });
                        } else if (stat.key === 'stdDev') {
                          let cutSum = 0;
                          let cutSumSquares = 0;
                          sortedNumericValues.forEach(numVal => {
                            const valueKey = numVal.toString();
                            const count = numericData[valueKey]?.[bannerCol.id]?.count || 0;
                            cutSum += numVal * count;
                            cutSumSquares += numVal * numVal * count;
                          });
                          const cutMean = cutSum / cutBase;
                          const cutVariance = Math.max(cutSumSquares / cutBase - cutMean * cutMean, 0);
                          cutStatValue = Math.sqrt(cutVariance);
                        } else if (stat.key === 'min') {
                          cutStatValue = Infinity;
                          sortedNumericValues.forEach(numVal => {
                            const valueKey = numVal.toString();
                            if ((numericData[valueKey]?.[bannerCol.id]?.count || 0) > 0 && numVal < cutStatValue) {
                              cutStatValue = numVal;
                            }
                          });
                        } else if (stat.key === 'max') {
                          cutStatValue = -Infinity;
                          sortedNumericValues.forEach(numVal => {
                            const valueKey = numVal.toString();
                            if ((numericData[valueKey]?.[bannerCol.id]?.count || 0) > 0 && numVal > cutStatValue) {
                              cutStatValue = numVal;
                            }
                          });
                        }
                      }
                      
                      statRow.getCell(col).value = cutStatValue;
                      statRow.getCell(col).numFmt = stat.key === 'sum' ? '0' : '0.00';
                      statRow.getCell(col).alignment = { horizontal: 'center' };
                      statRow.getCell(col).fill = {
                        type: 'pattern',
                        pattern: 'solid',
                        fgColor: { argb: 'FFE8E8E8' }
                      };
                      statRow.getCell(col).border = {
                        top: { style: 'thin' },
                        bottom: { style: 'thin' },
                        left: { style: 'thin' },
                        right: { style: 'thin' }
                      };
                      col++;
                    });
                  }
                });
              }
            }
            
            tableNumber++;
            continue;
          }

          // Only create title/question rows here for SUMMARY tables (Mean/Sum Summary Tables)
          // Regular tables (including multi-select) will have their title created later
          if (isNumericGridSummaryTable) {
            // Record position for TOC
            tablePositions.push({
              tableNumber,
              tableName,
              rowNumber: currentRow,
              variable
            });
            
            // Table title - format appropriately for summary tables
            let displayTableName = tableName;
            if (isMeanSummaryTable) {
              const baseQuestionNumber = getBaseQuestionNumber(variable.name);
              displayTableName = `${baseQuestionNumber}: Mean Summary Table`;
            } else if (isSumSummaryTable) {
              const baseQuestionNumber = getBaseQuestionNumber(variable.name);
              displayTableName = `${baseQuestionNumber}: Sum Summary Table`;
            }
            const tableTitle = `Table ${tableNumber}: ${displayTableName}`;
            const titleRow = dataCutsWorksheet.getRow(currentRow++);
            titleRow.getCell(2).value = tableTitle;
            titleRow.getCell(2).font = { bold: true, size: 12 };
            
            // Question text
            const questionRow = dataCutsWorksheet.getRow(currentRow++);
            questionRow.getCell(2).value = variable.description || variable.name;
            questionRow.getCell(2).font = { size: 11 };
          }

          // Calculate banner table data for this variable
          const bannerTableData = calculateBannerTableDataForVariable(variable, variable.name, bannerGroup);

          // Debug: Log for B8 only
          if (isB8Debug) {
            appendStatLog('[B8] Banner table data calculated', {
              tableName,
              variableType: variable.type,
              isNumericQuestion,
              tableNameMatches: tableName === variable.name,
              bannerTableData: bannerTableData ? {
                hasData: true,
                keys: Object.keys(bannerTableData),
                keysLength: Object.keys(bannerTableData).length,
                sampleEntry: bannerTableData[Object.keys(bannerTableData)[0]]
              } : 'null or empty',
              currentRow
            });
          }
          
          // Handle numeric questions - create frequency distribution table
          // MUST be done BEFORE building headers, as it creates its own structure
          if (isNumericQuestion && tableName === variable.name) {
            if (isB8Debug) {
              appendStatLog('[B8] Entering numeric question handling block (second location)', { tableName, variable: variable.name });
            }
            
            // Use calculateBannerTableDataForVariable to get frequency distribution (same as Variables tab)
            const numericData = calculateBannerTableDataForVariable(variable, variable.name, bannerGroup);
            
            if (!numericData || Object.keys(numericData).length === 0) {
              if (isB8Debug) {
                appendStatLog('[B8] ERROR: No data returned from calculateBannerTableDataForVariable', { variable: variable.name });
              }
              // Skip this table if no data
              tableNumber++;
              continue;
            }
            
            // Extract sorted numeric values from the data keys
            const sortedNumericValues = Object.keys(numericData)
              .map(v => parseFloat(v))
              .filter(v => !isNaN(v))
              .sort((a, b) => a - b);
            
            // Get bases from the data structure
            const totalBase = numericData[sortedNumericValues[0]?.toString() || '']?.['total']?.base || 0;
            const cutBases: Record<string, number> = {};
            bannerCols.forEach(col => {
              cutBases[col.id] = numericData[sortedNumericValues[0]?.toString() || '']?.[col.id]?.base || 0;
            });
            
            if (isPreviewMode) {
              // eslint-disable-next-line no-console
              console.log('[Preview Debug - buildTabSpecsWorkbook] Frequency distribution from calculateBannerTableDataForVariable:', {
                uniqueValues: sortedNumericValues.length,
                sortedValues: sortedNumericValues.slice(0, 10),
                totalBase,
                cutBases,
                sampleData: sortedNumericValues.slice(0, 3).map(v => ({
                  value: v,
                  total: numericData[v.toString()]?.['total'],
                  sampleCut: numericData[v.toString()]?.[bannerCols[0]?.id]
                }))
              });
            }
            
            // Record position for TOC
            tablePositions.push({ tableNumber, tableName, rowNumber: currentRow, variable });
            
            // Table title
            const baseQuestionNumber = getBaseQuestionNumber(variable.name);
            const tableTitle = `Table ${tableNumber}: ${baseQuestionNumber}`;
            const titleRow = dataCutsWorksheet.getRow(currentRow++);
            titleRow.getCell(2).value = tableTitle;
            titleRow.getCell(2).font = { bold: true, size: 12 };
            
            // Question text
            const questionRow = dataCutsWorksheet.getRow(currentRow++);
            questionRow.getCell(2).value = variable.description || variable.name;
            questionRow.getCell(2).font = { size: 11 };
            
            // Build 3-row header (Total + banner groups) - same as other tables
            const headerStartRow = currentRow;
            const groupTitleRow = headerStartRow;
            const cutTitleRow = headerStartRow + 1;
            const statLetterRow = headerStartRow + 2;
            let currentCol = 2;
            
            // Row label cell (merged across all 3 rows)
            const rowLabelCell = dataCutsWorksheet.getRow(groupTitleRow).getCell(currentCol);
            rowLabelCell.value = '';
            rowLabelCell.border = {
              top: { style: 'thin' },
              bottom: { style: 'thin' },
              left: { style: 'thin' },
              right: { style: 'thin' }
            };
            dataCutsWorksheet.mergeCells(groupTitleRow, currentCol, statLetterRow, currentCol);
            [cutTitleRow, statLetterRow].forEach(r => {
              const cell = dataCutsWorksheet.getRow(r).getCell(currentCol);
              cell.border = {
                top: { style: 'thin' },
                bottom: { style: 'thin' },
                left: { style: 'thin' },
                right: { style: 'thin' }
              };
            });
            currentCol++;
            
            // Total column
            const totalGroupCell = dataCutsWorksheet.getRow(groupTitleRow).getCell(currentCol);
            totalGroupCell.value = 'Total';
            totalGroupCell.alignment = { horizontal: 'center', vertical: 'middle' };
            totalGroupCell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
            totalGroupCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFD14A2D' } };
            totalGroupCell.border = {
              top: { style: 'thin' },
              bottom: { style: 'thin' },
              left: { style: 'thin' },
              right: { style: 'thin' }
            };
            dataCutsWorksheet.mergeCells(groupTitleRow, currentCol, cutTitleRow, currentCol);
            const totalCutCell = dataCutsWorksheet.getRow(cutTitleRow).getCell(currentCol);
            totalCutCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFD14A2D' } };
            totalCutCell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
            totalCutCell.border = {
              top: { style: 'thin' },
              bottom: { style: 'thin' },
              left: { style: 'thin' },
              right: { style: 'thin' }
            };
            const totalStatCell = dataCutsWorksheet.getRow(statLetterRow).getCell(currentCol);
            totalStatCell.value = '';
            totalStatCell.alignment = { horizontal: 'center', vertical: 'middle' };
            totalStatCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFD14A2D' } };
            totalStatCell.border = {
              top: { style: 'thin' },
              bottom: { style: 'thin' },
              left: { style: 'thin' },
              right: { style: 'thin' }
            };
            currentCol++;
            
            // Banner groups
            groupStructure.forEach((group) => {
              const groupStartCol = currentCol;
              const groupCell = dataCutsWorksheet.getRow(groupTitleRow).getCell(groupStartCol);
              groupCell.value = group.title;
              groupCell.alignment = { horizontal: 'center', vertical: 'middle' };
              groupCell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
              groupCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFD14A2D' } };
              groupCell.border = {
                top: { style: 'thin' },
                bottom: { style: 'thin' },
                left: { style: 'thin' },
                right: { style: 'thin' }
              };
              if (group.cutCount > 1) {
                dataCutsWorksheet.mergeCells(groupTitleRow, groupStartCol, groupTitleRow, groupStartCol + group.cutCount - 1);
              }
              for (let i = 0; i < group.cutCount; i++) {
                const cutCol = groupStartCol + i;
                const bannerCol = bannerCols[group.startIdx + i];
                const cutCell = dataCutsWorksheet.getRow(cutTitleRow).getCell(cutCol);
                cutCell.value = bannerCol.title;
                cutCell.alignment = { horizontal: 'center', vertical: 'middle' };
                cutCell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
                cutCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFD14A2D' } };
                cutCell.border = {
                  top: { style: 'thin' },
                  bottom: { style: 'thin' },
                  left: { style: 'thin' },
                  right: { style: 'thin' }
                };
                const statCell = dataCutsWorksheet.getRow(statLetterRow).getCell(cutCol);
                const statLetter = String.fromCharCode(65 + group.startIdx + i);
                statCell.value = `(${statLetter})`;
                statCell.alignment = { horizontal: 'center', vertical: 'middle' };
                statCell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
                statCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFD14A2D' } };
                statCell.border = {
                  top: { style: 'thin' },
                  bottom: { style: 'thin' },
                  left: { style: 'thin' },
                  right: { style: 'thin' }
                };
              }
              currentCol += group.cutCount;
            });
            currentRow += 3;
            
            // Base row
            const baseRow = dataCutsWorksheet.getRow(currentRow++);
            baseRow.getCell(2).value = 'Base (total responding):';
            baseRow.getCell(2).font = { bold: true };
            baseRow.getCell(2).fill = {
              type: 'pattern',
              pattern: 'solid',
              fgColor: { argb: 'FFE8E8E8' }
            };
            baseRow.getCell(2).border = {
              top: { style: 'thin' },
              bottom: { style: 'thin' },
              left: { style: 'thin' },
              right: { style: 'thin' }
            };
            baseRow.getCell(3).value = totalBase;
            baseRow.getCell(3).alignment = { horizontal: 'center' };
            baseRow.getCell(3).fill = {
              type: 'pattern',
              pattern: 'solid',
              fgColor: { argb: 'FFE8E8E8' }
            };
            baseRow.getCell(3).border = {
              top: { style: 'thin' },
              bottom: { style: 'thin' },
              left: { style: 'thin' },
              right: { style: 'thin' }
            };
            let baseCol = 4;
            bannerCols.forEach(bannerCol => {
              baseRow.getCell(baseCol).value = cutBases[bannerCol.id] || 0;
              baseRow.getCell(baseCol).alignment = { horizontal: 'center' };
              baseRow.getCell(baseCol).fill = {
                type: 'pattern',
                pattern: 'solid',
                fgColor: { argb: 'FFE8E8E8' }
              };
              baseRow.getCell(baseCol).border = {
                top: { style: 'thin' },
                bottom: { style: 'thin' },
                left: { style: 'thin' },
                right: { style: 'thin' }
              };
              baseCol++;
            });
            
            // Render frequency distribution rows
            sortedNumericValues.forEach(numVal => {
              const valueKey = numVal.toString();
              const valueData = numericData[valueKey];
              if (!valueData) return;
              
              // Count row
              const countRow = dataCutsWorksheet.getRow(currentRow++);
              countRow.getCell(2).value = numVal;
              countRow.getCell(2).border = {
                top: { style: 'thin' },
                bottom: { style: 'thin' },
                left: { style: 'thin' },
                right: { style: 'thin' }
              };
              
              // Total count
              const totalCount = valueData['total']?.count || 0;
              countRow.getCell(3).value = totalCount;
              countRow.getCell(3).alignment = { horizontal: 'center' };
              countRow.getCell(3).border = {
                top: { style: 'thin' },
                bottom: { style: 'thin' },
                left: { style: 'thin' },
                right: { style: 'thin' }
              };
              
              // Banner cut counts
              let col = 4;
              bannerCols.forEach(bannerCol => {
                const cutCount = valueData[bannerCol.id]?.count || 0;
                countRow.getCell(col).value = cutCount;
                countRow.getCell(col).alignment = { horizontal: 'center' };
                countRow.getCell(col).border = {
                  top: { style: 'thin' },
                  bottom: { style: 'thin' },
                  left: { style: 'thin' },
                  right: { style: 'thin' }
                };
                col++;
              });
              
              // Percentage row
              const pctRow = dataCutsWorksheet.getRow(currentRow++);
              pctRow.getCell(2).value = '';
              pctRow.getCell(2).border = {
                top: { style: 'thin' },
                bottom: { style: 'thin' },
                left: { style: 'thin' },
                right: { style: 'thin' }
              };
              
              // Total percentage
              const totalPct = valueData['total']?.percentage || 0;
              pctRow.getCell(3).value = totalPct / 100;
              pctRow.getCell(3).numFmt = percentageDecimals === 0 ? '0%' : percentageDecimals === 1 ? '0.0%' : '0.00%';
              pctRow.getCell(3).alignment = { horizontal: 'center' };
              pctRow.getCell(3).border = {
                top: { style: 'thin' },
                bottom: { style: 'thin' },
                left: { style: 'thin' },
                right: { style: 'thin' }
              };
              
              // Banner cut percentages
              col = 4;
              bannerCols.forEach(bannerCol => {
                const cutBase = cutBases[bannerCol.id] || 0;
                const cutPct = valueData[bannerCol.id]?.percentage || 0;
                pctRow.getCell(col).value = cutPct / 100;
                pctRow.getCell(col).numFmt = percentageDecimals === 0 ? '0%' : percentageDecimals === 1 ? '0.0%' : '0.00%';
                pctRow.getCell(col).alignment = { horizontal: 'center' };
                pctRow.getCell(col).border = {
                  top: { style: 'thin' },
                  bottom: { style: 'thin' },
                  left: { style: 'thin' },
                  right: { style: 'thin' }
                };
                col++;
              });
            });
            
            // Add stats rows if enabled
            const statsKey = variable.name;
            const statsSelections = getStatsSelectionsForVariable(statsKey);
            const isNumeric = variable.type?.toLowerCase().includes('numeric');
            if (isNumeric && Object.values(statsSelections).some(v => v)) {
              // Calculate stats from frequency distribution
              let totalCount = 0;
              let sum = 0;
              let sumSquares = 0;
              let min = Infinity;
              let max = -Infinity;
              let modeValue: number | null = null;
              let modeCount = -1;
              
              sortedNumericValues.forEach(numVal => {
                const valueKey = numVal.toString();
                const count = numericData[valueKey]?.['total']?.count || 0;
                totalCount += count;
                sum += numVal * count;
                sumSquares += numVal * numVal * count;
                if (numVal < min) min = numVal;
                if (numVal > max) max = numVal;
                if (count > modeCount) {
                  modeCount = count;
                  modeValue = numVal;
                }
              });
              
              if (totalCount > 0) {
                const mean = sum / totalCount;
                const variance = Math.max(sumSquares / totalCount - mean * mean, 0);
                const stdDev = Math.sqrt(variance);
                const sorted = [...sortedNumericValues];
                const median = sorted.length % 2 === 0
                  ? (sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2
                  : sorted[Math.floor(sorted.length / 2)];
                
                const statsRows = [
                  { label: 'Mean', key: 'mean', value: mean },
                  { label: 'Sum', key: 'sum', value: sum },
                  { label: 'Median', key: 'median', value: median },
                  { label: 'Mode', key: 'mode', value: modeValue },
                  { label: 'Std Dev', key: 'stdDev', value: stdDev },
                  { label: 'Min', key: 'min', value: min },
                  { label: 'Max', key: 'max', value: max },
                ];
                
                statsRows.forEach(stat => {
                  if (statsSelections[stat.key]) {
                    const statRow = dataCutsWorksheet.getRow(currentRow++);
                    statRow.getCell(2).value = stat.label + ':';
                    statRow.getCell(2).font = { bold: true, italic: true };
                    statRow.getCell(2).fill = {
                      type: 'pattern',
                      pattern: 'solid',
                      fgColor: { argb: 'FFE8E8E8' }
                    };
                    statRow.getCell(2).border = {
                      top: { style: 'thin' },
                      bottom: { style: 'thin' },
                      left: { style: 'thin' },
                      right: { style: 'thin' }
                    };
                    
                    // Total stat value
                    statRow.getCell(3).value = stat.value;
                    statRow.getCell(3).numFmt = stat.key === 'sum' ? '0' : '0.00';
                    statRow.getCell(3).alignment = { horizontal: 'center' };
                    statRow.getCell(3).fill = {
                      type: 'pattern',
                      pattern: 'solid',
                      fgColor: { argb: 'FFE8E8E8' }
                    };
                    statRow.getCell(3).border = {
                      top: { style: 'thin' },
                      bottom: { style: 'thin' },
                      left: { style: 'thin' },
                      right: { style: 'thin' }
                    };
                    
                    // Banner cut stats (calculate per cut)
                    let col = 4;
                    bannerCols.forEach(bannerCol => {
                      const cutBase = cutBases[bannerCol.id] || 0;
                      let cutStatValue: number = 0;
                      
                      if (cutBase > 0) {
                        if (stat.key === 'mean') {
                          let cutSum = 0;
                          sortedNumericValues.forEach(numVal => {
                            const valueKey = numVal.toString();
                            cutSum += numVal * (numericData[valueKey]?.[bannerCol.id]?.count || 0);
                          });
                          cutStatValue = cutSum / cutBase;
                        } else if (stat.key === 'sum') {
                          sortedNumericValues.forEach(numVal => {
                            const valueKey = numVal.toString();
                            cutStatValue += numVal * (numericData[valueKey]?.[bannerCol.id]?.count || 0);
                          });
                        } else if (stat.key === 'median') {
                          const cutValues: number[] = [];
                          sortedNumericValues.forEach(numVal => {
                            const valueKey = numVal.toString();
                            const count = numericData[valueKey]?.[bannerCol.id]?.count || 0;
                            for (let i = 0; i < count; i++) {
                              cutValues.push(numVal);
                            }
                          });
                          cutValues.sort((a, b) => a - b);
                          cutStatValue = cutValues.length % 2 === 0
                            ? (cutValues[cutValues.length / 2 - 1] + cutValues[cutValues.length / 2]) / 2
                            : cutValues[Math.floor(cutValues.length / 2)];
                        } else if (stat.key === 'mode') {
                          let cutModeCount = -1;
                          sortedNumericValues.forEach(numVal => {
                            const valueKey = numVal.toString();
                            const count = numericData[valueKey]?.[bannerCol.id]?.count || 0;
                            if (count > cutModeCount) {
                              cutModeCount = count;
                              cutStatValue = numVal;
                            }
                          });
                        } else if (stat.key === 'stdDev') {
                          let cutSum = 0;
                          let cutSumSquares = 0;
                          sortedNumericValues.forEach(numVal => {
                            const valueKey = numVal.toString();
                            const count = numericData[valueKey]?.[bannerCol.id]?.count || 0;
                            cutSum += numVal * count;
                            cutSumSquares += numVal * numVal * count;
                          });
                          const cutMean = cutSum / cutBase;
                          const cutVariance = Math.max(cutSumSquares / cutBase - cutMean * cutMean, 0);
                          cutStatValue = Math.sqrt(cutVariance);
                        } else if (stat.key === 'min') {
                          cutStatValue = Infinity;
                          sortedNumericValues.forEach(numVal => {
                            const valueKey = numVal.toString();
                            if ((numericData[valueKey]?.[bannerCol.id]?.count || 0) > 0 && numVal < cutStatValue) {
                              cutStatValue = numVal;
                            }
                          });
                        } else if (stat.key === 'max') {
                          cutStatValue = -Infinity;
                          sortedNumericValues.forEach(numVal => {
                            const valueKey = numVal.toString();
                            if ((numericData[valueKey]?.[bannerCol.id]?.count || 0) > 0 && numVal > cutStatValue) {
                              cutStatValue = numVal;
                            }
                          });
                        }
                      }
                      
                      statRow.getCell(col).value = cutStatValue;
                      statRow.getCell(col).numFmt = stat.key === 'sum' ? '0' : '0.00';
                      statRow.getCell(col).alignment = { horizontal: 'center' };
                      statRow.getCell(col).fill = {
                        type: 'pattern',
                        pattern: 'solid',
                        fgColor: { argb: 'FFE8E8E8' }
                      };
                      statRow.getCell(col).border = {
                        top: { style: 'thin' },
                        bottom: { style: 'thin' },
                        left: { style: 'thin' },
                        right: { style: 'thin' }
                      };
                      col++;
                    });
                  }
                });
              }
            }
            
            tableNumber++;
            continue;
          }

          const isMultiSelectGridVariable = variable.type?.toLowerCase().includes('multi-select grid');
          const extractGridColumnCode = (): string | null => {
            if (!isMultiSelectGridVariable) return null;
            const prefix = `${variable.name}_`;
            if (!tableName.startsWith(prefix)) return null;
            const remainder = tableName.slice(prefix.length);
            const parenIndex = remainder.indexOf(' (');
            const rawCode = parenIndex >= 0 ? remainder.slice(0, parenIndex) : remainder;
            return rawCode.trim() || null;
          };
          const activeGridColumnCode = extractGridColumnCode();
          const activeGridColumnData = activeGridColumnCode ? (bannerTableData as any)[activeGridColumnCode] : null;
          const isMultiSelectGridColumnTable = !!activeGridColumnData && typeof activeGridColumnData === 'object';
          
          // Declare sampleStatements at this scope so it can be used in tableDebugInfo
          let sampleStatements: Array<{
            key: string;
            label: string;
            totalCount: number;
            totalPercentage: number;
            totalBase: number;
            cutCounts: Array<{ title: string; count: number; percentage: number }>;
          }> | undefined = undefined;
          
          if (isMultiSelectGridColumnTable) {
            sampleStatements = Object.entries(activeGridColumnData || {})
              .filter(([stmtKey, stmtData]) => stmtKey !== 'total' && stmtData && typeof stmtData === 'object')
              .slice(0, 5)
              .map(([stmtKey, stmtData]) => {
                const normalizedKey = stmtKey.replace(/^r/i, '');
                const label =
                  variable.statements?.[stmtKey] ||
                  (normalizedKey ? variable.statements?.[normalizedKey] : undefined) ||
                  stmtKey;
                const totalData = (stmtData as any)['total'] || { count: 0, percentage: 0, base: 0 };
                const cutCounts = bannerCols.map(col => ({
                  title: col.title,
                  count: (stmtData as any)?.[col.id]?.count || 0,
                  percentage: (stmtData as any)?.[col.id]?.percentage || 0,
                }));
                return {
                  key: stmtKey,
                  label,
                  totalCount: totalData.count || 0,
                  totalPercentage: totalData.percentage || 0,
                  totalBase: totalData.base || 0,
                  cutCounts,
                };
              });
          }

          // Record position for TOC (for regular tables)
          // Also define tableTitle here for use in tableDebugInfo
          let tableTitle = '';
          if (!isNumericGridSummaryTable && !isNetSummaryTable && !isMeanSummaryTableForSSG && !isVerbatimSummary && !isSingleSelectGridIndividualTable && !isNumericQuestion) {
            tablePositions.push({ tableNumber, tableName, rowNumber: currentRow, variable });
            
            // Write table title for regular tables
            const baseQuestionNumber = getBaseQuestionNumber(variable.name);
            
            // For multi-select grid column tables, format as "QuestionNumber_ColumnCode (ColumnLabel)"
            // Must match getTablesForVariable format: `${baseName}_${colCode} (${colLabel})`
            if (isMultiSelectGridColumnTable && activeGridColumnCode && variable.codes) {
              const columnLabel = variable.codes[activeGridColumnCode] || activeGridColumnCode;
              tableTitle = `Table ${tableNumber}: ${baseQuestionNumber}_${activeGridColumnCode} (${columnLabel})`;
            } else {
              tableTitle = `Table ${tableNumber}: ${baseQuestionNumber}`;
            }
            
            const titleRow = dataCutsWorksheet.getRow(currentRow++);
            titleRow.getCell(2).value = tableTitle;
            titleRow.getCell(2).font = { bold: true, size: 12 };
            
            // Question text
            const questionRow = dataCutsWorksheet.getRow(currentRow++);
            questionRow.getCell(2).value = variable.description || variable.name;
            questionRow.getCell(2).font = { size: 11 };
          } else if (isNumericGridSummaryTable) {
            // For summary tables, tableTitle was already set above
            const baseQuestionNumber = getBaseQuestionNumber(variable.name);
            if (isMeanSummaryTable) {
              tableTitle = `Table ${tableNumber}: ${baseQuestionNumber}: Mean Summary Table`;
            } else if (isSumSummaryTable) {
              tableTitle = `Table ${tableNumber}: ${baseQuestionNumber}: Sum Summary Table`;
            }
          } else {
            // For other table types, use a generic title
            const baseQuestionNumber = getBaseQuestionNumber(variable.name);
            tableTitle = `Table ${tableNumber}: ${baseQuestionNumber}`;
          }
          
          // Record debug info for this table
          if (isMultiSelectGridColumnTable && sampleStatements) {
            tableDebugInfo[tableTitle] = {
              tableTitle,
              variableName: variable.name,
              variableType: variable.type,
              isMultiSelectGridColumn: true,
              columnCode: activeGridColumnCode || null,
              sampleStatements,
            };
          } else if (tableTitle && !tableDebugInfo[tableTitle]) {
            tableDebugInfo[tableTitle] = {
              tableTitle,
              variableName: variable.name,
              variableType: variable.type,
              isMultiSelectGridColumn: false,
            };
          }

          // Extract bases from banner table data
          let totalBase = 0;
          const cutBases: Record<string, number> = {};
          bannerCols.forEach(col => { cutBases[col.id] = 0; });

          // Get bases from the first entry that actually contains base data
          const firstCodeData = isMultiSelectGridColumnTable
            ? findFirstBannerRowWithBase(activeGridColumnData)
            : findFirstBannerRowWithBase(bannerTableData);
          if (firstCodeData) {
            if (firstCodeData.total && typeof firstCodeData.total.base === 'number') {
              totalBase = firstCodeData.total.base;
            }
            bannerCols.forEach(col => {
              const baseValue = firstCodeData[col.id]?.base;
              if (typeof baseValue === 'number') {
                cutBases[col.id] = baseValue;
              }
            });
          }

          // Debug for B8: Check if we have codes to render
          if (isB8Debug) {
            appendStatLog('[B8] Before building headers', {
              totalBase,
              cutBasesCount: Object.keys(cutBases).length,
              firstCodeDataExists: !!firstCodeData,
              bannerTableDataKeys: Object.keys(bannerTableData),
              isMultiSelectGridColumnTable
            });
          }

          // Build 3-row header structure
          // Row 1: Empty | Total | Group Titles (merged across cuts)
          // Row 2: Empty | Total | Cut Titles
          // Row 3: Empty | Empty | Stat Letters (A), (B), (C)...
          const headerStartRow = currentRow;
          const groupTitleRow = headerStartRow;
          const cutTitleRow = headerStartRow + 1;
          const statLetterRow = headerStartRow + 2;
          let currentCol = 2; // Start at column B

          // Row label cell (merged across all 3 rows)
          const rowLabelCell = dataCutsWorksheet.getRow(groupTitleRow).getCell(currentCol);
          rowLabelCell.value = '';
          rowLabelCell.border = {
            top: { style: 'thin' },
            bottom: { style: 'thin' },
            left: { style: 'thin' },
            right: { style: 'thin' }
          };
          dataCutsWorksheet.mergeCells(groupTitleRow, currentCol, statLetterRow, currentCol);
          // Apply borders to all rows of merged cell
          [cutTitleRow, statLetterRow].forEach(row => {
            const cell = dataCutsWorksheet.getRow(row).getCell(currentCol);
            cell.border = {
              top: { style: 'thin' },
              bottom: { style: 'thin' },
              left: { style: 'thin' },
              right: { style: 'thin' }
            };
          });
          currentCol++;

          // Total column (merged across first 2 rows, with empty stat letter row)
          const totalGroupCell = dataCutsWorksheet.getRow(groupTitleRow).getCell(currentCol);
          totalGroupCell.value = 'Total';
          totalGroupCell.alignment = { horizontal: 'center', vertical: 'middle' };
          totalGroupCell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
          totalGroupCell.fill = {
            type: 'pattern',
            pattern: 'solid',
            fgColor: { argb: 'FFD14A2D' }
          };
          totalGroupCell.border = {
            top: { style: 'thin' },
            bottom: { style: 'thin' },
            left: { style: 'thin' },
            right: { style: 'thin' }
          };
          dataCutsWorksheet.mergeCells(groupTitleRow, currentCol, cutTitleRow, currentCol);
          // Apply same formatting to cut title row
          const totalCutCell = dataCutsWorksheet.getRow(cutTitleRow).getCell(currentCol);
          totalCutCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFD14A2D' } };
          totalCutCell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
          totalCutCell.border = {
            top: { style: 'thin' },
            bottom: { style: 'thin' },
            left: { style: 'thin' },
            right: { style: 'thin' }
          };

          // Empty stat letter cell for Total column
          const totalStatCell = dataCutsWorksheet.getRow(statLetterRow).getCell(currentCol);
          totalStatCell.value = '';
          totalStatCell.alignment = { horizontal: 'center', vertical: 'middle' };
          totalStatCell.fill = {
            type: 'pattern',
            pattern: 'solid',
            fgColor: { argb: 'FFD14A2D' }
          };
          totalStatCell.border = {
            top: { style: 'thin' },
            bottom: { style: 'thin' },
            left: { style: 'thin' },
            right: { style: 'thin' }
          };
          currentCol++;

          // Banner group titles and cut columns
          groupStructure.forEach((group, groupIdx) => {
            const groupStartCol = currentCol;

            // Group title (merged across all cuts in this group)
            const groupCell = dataCutsWorksheet.getRow(groupTitleRow).getCell(groupStartCol);
            groupCell.value = group.title;
            groupCell.alignment = { horizontal: 'center', vertical: 'middle' };
            groupCell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
            groupCell.fill = {
              type: 'pattern',
              pattern: 'solid',
              fgColor: { argb: 'FFD14A2D' }
            };
            groupCell.border = {
              top: { style: 'thin' },
              bottom: { style: 'thin' },
              left: { style: 'thin' },
              right: { style: 'thin' }
            };
            if (group.cutCount > 1) {
              dataCutsWorksheet.mergeCells(groupTitleRow, groupStartCol, groupTitleRow, groupStartCol + group.cutCount - 1);
            }

            // Individual cut titles and stat letters for this group
            for (let i = 0; i < group.cutCount; i++) {
              const cutCol = groupStartCol + i;
              const bannerCol = bannerCols[group.startIdx + i];

              // Cut title (row 2)
              const cutCell = dataCutsWorksheet.getRow(cutTitleRow).getCell(cutCol);
              cutCell.value = bannerCol.title;
              cutCell.alignment = { horizontal: 'center', vertical: 'middle' };
              cutCell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
              cutCell.fill = {
                type: 'pattern',
                pattern: 'solid',
                fgColor: { argb: 'FFD14A2D' }
              };
              cutCell.border = {
                top: { style: 'thin' },
                bottom: { style: 'thin' },
                left: { style: 'thin' },
                right: { style: 'thin' }
              };

              // Stat letter (row 3) - starts at (A) for first cut
              const statCell = dataCutsWorksheet.getRow(statLetterRow).getCell(cutCol);
              const statLetter = String.fromCharCode(65 + group.startIdx + i); // A, B, C, etc.
              statCell.value = `(${statLetter})`;
              statCell.alignment = { horizontal: 'center', vertical: 'middle' };
              statCell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
              statCell.fill = {
                type: 'pattern',
                pattern: 'solid',
                fgColor: { argb: 'FFD14A2D' }
              };
              statCell.border = {
                top: { style: 'thin' },
                bottom: { style: 'thin' },
                left: { style: 'thin' },
                right: { style: 'thin' }
              };
            }

            currentCol += group.cutCount;
          });

          currentRow += 3; // Move past 3 header rows

          // Check if this is a single select grid individual table (will render base row later)
          const isSingleSelectGridForBase = variable.type?.toLowerCase().includes('single select grid');
          const isSingleSelectGridIndividualTableForBase = isSingleSelectGridForBase && 
            variable.statements && 
            Object.keys(variable.statements).length > 0 &&
            !tableName.endsWith('_MeanSummaryTable');
          
          // Add Base (total responding) row (skip for single select grid individual tables - they render it later)
          if (!isSingleSelectGridIndividualTableForBase) {
            const STATS_GREY = 'FFE8E8E8'; // Lighter grey for base and stats rows
            const baseRespondingRow = dataCutsWorksheet.getRow(currentRow++);
            baseRespondingRow.getCell(2).value = 'Base (total responding):';
            baseRespondingRow.getCell(2).font = { bold: true };
            baseRespondingRow.getCell(2).fill = {
              type: 'pattern',
              pattern: 'solid',
              fgColor: { argb: STATS_GREY }
            };
            baseRespondingRow.getCell(2).border = {
              top: { style: 'thin' },
              bottom: { style: 'thin' },
              left: { style: 'thin' },
              right: { style: 'thin' }
            };

            // Total base
            baseRespondingRow.getCell(3).value = totalBase;
            baseRespondingRow.getCell(3).alignment = { horizontal: 'center' };
            baseRespondingRow.getCell(3).fill = {
              type: 'pattern',
              pattern: 'solid',
              fgColor: { argb: STATS_GREY }
            };
            baseRespondingRow.getCell(3).border = {
              top: { style: 'thin' },
              bottom: { style: 'thin' },
              left: { style: 'thin' },
              right: { style: 'thin' }
            };

            // Banner cut bases
            let baseCol = 4;
            bannerCols.forEach(bannerCol => {
              baseRespondingRow.getCell(baseCol).value = cutBases[bannerCol.id];
              baseRespondingRow.getCell(baseCol).alignment = { horizontal: 'center' };
              baseRespondingRow.getCell(baseCol).fill = {
                type: 'pattern',
                pattern: 'solid',
                fgColor: { argb: STATS_GREY }
              };
              baseRespondingRow.getCell(baseCol).border = {
                top: { style: 'thin' },
                bottom: { style: 'thin' },
                left: { style: 'thin' },
                right: { style: 'thin' }
              };
              baseCol++;
            });
          }

          const resolveGridStatementKey = (code: string) => {
            if (!isMultiSelectGridColumnTable) return code;
            const baseCode = code.replace(/^r/i, '');
            const variations = [code, baseCode && code !== baseCode ? baseCode : null, baseCode ? `r${baseCode}` : null].filter(Boolean) as string[];
            for (const variant of variations) {
              if (activeGridColumnData && Object.prototype.hasOwnProperty.call(activeGridColumnData, variant)) {
                return variant;
              }
            }
            return code;
          };

          const getCodeDataForRow = (code: string) => {
            if (isMultiSelectGridColumnTable) {
              const resolvedKey = resolveGridStatementKey(code);
              return (activeGridColumnData as any)?.[resolvedKey] || {};
            }
            return (bannerTableData as any)?.[code] || {};
          };

          const getRowLabelForCode = (code: string) => {
            if (isMultiSelectGridColumnTable) {
              const resolvedKey = resolveGridStatementKey(code);
              return variable.statements?.[code] || variable.statements?.[resolvedKey] || code;
            }
            return variable.codes?.[code] || code;
          };

          // Handle numeric grid summary tables (mean or sum)
          if (isNumericGridSummaryTable && variable.statements) {
            const baseName = variable.name;
            const baseNumber = baseName.replace(/^Q/, '');
            const question = questionnaireQuestions.find(q => {
              const qNum = q.number || q.id;
              return qNum === baseNumber ||
                     qNum === baseNumber.replace(/^Q/, '') ||
                     String(qNum) === String(baseNumber);
            });

            // Build column map for all columns
            const statementEntries = Object.entries(variable.statements || {});
            const gridColMap: Record<string, Record<string, string | null>> = {}; // [stmtCode][columnCode] -> colHeader
            
            // Get all column codes from question response options
            const columnCodes: string[] = [];
            if (question && question.responseOptions && Array.isArray(question.responseOptions)) {
              question.responseOptions.forEach((respOpt, respIdx) => {
                const columnCode = `c${respIdx + 1}`;
                columnCodes.push(columnCode);
              });
            } else {
              // Default to c1 if no response options
              columnCodes.push('c1');
            }

            // Build column map for each statement and column
            statementEntries.forEach(([stmtCode]) => {
              gridColMap[stmtCode] = {};
              let normalizedCode = stmtCode;
              if (!/^r\d+/i.test(stmtCode) && /^\d+$/.test(stmtCode)) {
                normalizedCode = `r${stmtCode}`;
              }
              columnCodes.forEach(columnCode => {
                const cellHeader = `Q${baseName}${normalizedCode}${columnCode}`;
                let colHeader: string | null = null;
                const variations = [cellHeader, cellHeader.replace(/^Q/, ''), `${baseName}${normalizedCode}${columnCode}`];
                for (const v of variations) {
                  if (columnMapping[v]) { colHeader = columnMapping[v]; break; }
                  const match = Object.keys(columnMapping).find(k => k.toLowerCase() === v.toLowerCase());
                  if (match) { colHeader = columnMapping[match]; break; }
                }
                if (!colHeader && fullRawData.columns) {
                  for (const v of variations) {
                    const found = fullRawData.columns.find((c: string) => c.toLowerCase() === v.toLowerCase());
                    if (found) { colHeader = found; break; }
                  }
                }
                gridColMap[stmtCode][columnCode] = colHeader;
              });
            });

            // Calculate grid data for all statements across all columns
            const gridData: Record<string, { total: { sum: number; base: number; mean: number; stdDev: number }; cuts: Record<string, { sum: number; base: number; mean: number; stdDev: number; values: number[] }> }> = {};
            let totalSumAll = 0;
            const cutSumsAll: Record<string, number> = {};
            bannerCols.forEach(col => { cutSumsAll[col.id] = 0; });

            statementEntries.forEach(([stmtCode]) => {
              gridData[stmtCode] = { total: { sum: 0, base: 0, mean: 0, stdDev: 0 }, cuts: {} };
              bannerCols.forEach(col => { gridData[stmtCode].cuts[col.id] = { sum: 0, base: 0, mean: 0, stdDev: 0, values: [] }; });
              const totalValues: number[] = [];

              // Sum across all columns for this statement
              columnCodes.forEach(columnCode => {
                const stmtColHeader = gridColMap[stmtCode]?.[columnCode];
                if (!stmtColHeader) return;

                fullRawData.rows.forEach((row: any) => {
                  const val = row[stmtColHeader];
                  if (val === null || val === undefined || val === '') return;
                  const numVal = parseFloat(String(val));
                  if (isNaN(numVal)) return;

                  // Add to total
                  gridData[stmtCode].total.sum += numVal;
                  gridData[stmtCode].total.base++;
                  totalSumAll += numVal;
                  totalValues.push(numVal);

                  // Check which banner cuts this row matches
                  bannerCols.forEach(col => {
                    // Find the cut from banner group to get colHeader and codes
                    let cut: any = null;
                    if (bannerGroup.groups) {
                      for (const g of bannerGroup.groups) {
                        const foundCut = g.cuts.find((c: any) => c.id === col.id);
                        if (foundCut) {
                          cut = foundCut;
                          break;
                        }
                      }
                    }
                    if (!cut) return;
                    
                    const colHeader = getColumnHeader(cut.variableName);
                    if (!colHeader) return;
                    
                    const bannerVal = row[colHeader];
                    if (bannerVal === null || bannerVal === undefined || bannerVal === '') return;
                    const bannerValStr = String(bannerVal).trim();
                    const numBannerVal = Number(bannerValStr);
                    const codes = cut.codes || [];
                    for (const cutCode of codes) {
                      let matches = false;
                      if (bannerValStr === cutCode) matches = true;
                      else if (!isNaN(numBannerVal) && String(numBannerVal) === cutCode) matches = true;
                      else {
                        const codeNoC = cutCode.replace(/^c/i, '');
                        if (bannerValStr === codeNoC || (!isNaN(numBannerVal) && !isNaN(Number(codeNoC)) && numBannerVal === Number(codeNoC))) {
                          matches = true;
                        }
                      }
                      if (matches) {
                        gridData[stmtCode].cuts[col.id].sum += numVal;
                        gridData[stmtCode].cuts[col.id].base++;
                        cutSumsAll[col.id] += numVal;
                        gridData[stmtCode].cuts[col.id].values.push(numVal);
                        break;
                      }
                    }
                  });
                });
              });

              // Calculate means and standard deviations
              if (gridData[stmtCode].total.base > 0) {
                gridData[stmtCode].total.mean = gridData[stmtCode].total.sum / gridData[stmtCode].total.base;
                if (totalValues.length > 1) {
                  const variance = totalValues.reduce((acc, val) => acc + Math.pow(val - gridData[stmtCode].total.mean, 2), 0) / totalValues.length;
                  gridData[stmtCode].total.stdDev = Math.sqrt(variance);
                }
              }
              bannerCols.forEach(col => {
                const cutData = gridData[stmtCode].cuts[col.id];
                if (cutData.base > 0) {
                  cutData.mean = cutData.sum / cutData.base;
                  if (cutData.values.length > 1) {
                    const variance = cutData.values.reduce((acc, val) => acc + Math.pow(val - cutData.mean, 2), 0) / cutData.values.length;
                    cutData.stdDev = Math.sqrt(variance);
                  } else if (cutData.values.length === 1) {
                    cutData.stdDev = 0;
                  }
                }
              });
            });

            // Calculate stat letters for all statements before rendering
            const allStatLettersSummary: Record<string, Record<number, { letter: string; is95: boolean }[]>> = {};

            statementEntries.forEach(([stmtCode]) => {
              const data = gridData[stmtCode];
              if (!data) return;

              const codeStatLetters: Record<number, { letter: string; is95: boolean }[]> = {};

              bannerCols.forEach((thisCol, colIdx) => {
                // For sum summary: use percentage values for testing
                // For mean summary: use mean values for testing
                const thisValue = isSumSummaryTable
                  ? (cutSumsAll[thisCol.id] > 0 ? (data.cuts[thisCol.id].sum / cutSumsAll[thisCol.id]) * 100 : 0)
                  : data.cuts[thisCol.id].mean;
                const thisBase = data.cuts[thisCol.id].base;
                const thisStdDev = isMeanSummaryTable ? data.cuts[thisCol.id].stdDev : 0;
                const statLettersForCol: { letter: string; is95: boolean }[] = [];
                const confidenceLevel = bannerGroup.confidenceLevel || 95;

                // Within-group comparisons ONLY
                bannerCols.forEach((otherCol, otherIdx) => {
                  if (otherIdx === colIdx) return;
                  if (otherCol.groupIdx !== thisCol.groupIdx) return;

                  const otherValue = isSumSummaryTable
                    ? (cutSumsAll[otherCol.id] > 0 ? (data.cuts[otherCol.id].sum / cutSumsAll[otherCol.id]) * 100 : 0)
                    : data.cuts[otherCol.id].mean;
                  const otherBase = data.cuts[otherCol.id].base;
                  const otherStdDev = isMeanSummaryTable ? data.cuts[otherCol.id].stdDev : 0;

                  if (thisValue > otherValue) {
                    // Use appropriate statistical test based on table type
                    const { is95, is90 } = isMeanSummaryTable
                      ? isSignificantForMeans(thisValue, thisBase, thisStdDev, otherValue, otherBase, otherStdDev, confidenceLevel)
                      : isSignificant(thisValue, thisBase, otherValue, otherBase);

                    if (significanceLevel === 95) {
                      if (is95) statLettersForCol.push({ letter: String.fromCharCode(65 + otherIdx), is95: true });
                    } else {
                      if (is95) {
                        statLettersForCol.push({ letter: String.fromCharCode(65 + otherIdx), is95: true });
                      } else if (is90) {
                        statLettersForCol.push({ letter: String.fromCharCode(97 + otherIdx), is95: false });
                      }
                    }
                  }
                });

                codeStatLetters[colIdx] = statLettersForCol;
              });

              allStatLettersSummary[stmtCode] = codeStatLetters;
            });

            // Render summary table rows
            statementEntries.forEach(([stmtCode, stmtLabel]) => {
              const data = gridData[stmtCode];
              if (!data) return;

              if (isSumSummaryTable) {
                // Sum Summary Table: Show sum and percentage rows
                const sumRow = dataCutsWorksheet.getRow(currentRow++);
                sumRow.getCell(2).value = String(stmtLabel);
                sumRow.getCell(2).border = {
                  top: { style: 'thin' },
                  bottom: { style: 'thin' },
                  left: { style: 'thin' },
                  right: { style: 'thin' }
                };

                // Total sum
                sumRow.getCell(3).value = data.total.sum;
                sumRow.getCell(3).numFmt = '0';
                sumRow.getCell(3).alignment = { horizontal: 'center' };
                sumRow.getCell(3).border = {
                  top: { style: 'thin' },
                  bottom: { style: 'thin' },
                  left: { style: 'thin' },
                  right: { style: 'thin' }
                };

                // Banner cut sums
                let col = 4;
                bannerCols.forEach(bannerCol => {
                  sumRow.getCell(col).value = data.cuts[bannerCol.id].sum;
                  sumRow.getCell(col).numFmt = '0';
                  sumRow.getCell(col).alignment = { horizontal: 'center' };
                  sumRow.getCell(col).border = {
                    top: { style: 'thin' },
                    bottom: { style: 'thin' },
                    left: { style: 'thin' },
                    right: { style: 'thin' }
                  };
                  col++;
                });

                // Percentage row
                const pctRow = dataCutsWorksheet.getRow(currentRow++);
                pctRow.getCell(2).value = '';
                pctRow.getCell(2).border = {
                  top: { style: 'thin' },
                  bottom: { style: 'thin' },
                  left: { style: 'thin' },
                  right: { style: 'thin' }
                };

                // Total percentage
                const totalPct = totalSumAll > 0 ? (data.total.sum / totalSumAll) * 100 : 0;
                const totalPctCell = pctRow.getCell(3);
                totalPctCell.value = totalPct / 100; // Store as decimal for percentage format
                totalPctCell.numFmt = percentageDecimals === 0 ? '0%' : percentageDecimals === 1 ? '0.0%' : '0.00%';
                totalPctCell.alignment = { horizontal: 'center' };
                totalPctCell.border = {
                  top: { style: 'thin' },
                  bottom: { style: 'thin' },
                  left: { style: 'thin' },
                  right: { style: 'thin' }
                };

                // Banner cut percentages
                col = 4;
                bannerCols.forEach((bannerCol, colIdx) => {
                  const cutTotalSum = cutSumsAll[bannerCol.id] || 0;
                  const cutPct = cutTotalSum > 0 ? (data.cuts[bannerCol.id].sum / cutTotalSum) * 100 : 0;
                  const cutPctCell = pctRow.getCell(col);
                  cutPctCell.value = cutPct / 100; // Store as decimal for percentage format
                  cutPctCell.numFmt = percentageDecimals === 0 ? '0%' : percentageDecimals === 1 ? '0.0%' : '0.00%';
                  cutPctCell.alignment = { horizontal: 'center' };

                  // Add blue highlighting if this cell has stat letters
                  const statLettersForCode = allStatLettersSummary[stmtCode] || {};
                  const statLetters = statLettersForCode[colIdx] || [];
                  if (statLetters.length > 0) {
                    cutPctCell.fill = {
                      type: 'pattern',
                      pattern: 'solid',
                      fgColor: { argb: 'FFE6F3FF' }
                    };
                  }

                  cutPctCell.border = {
                    top: { style: 'thin' },
                    bottom: { style: 'thin' },
                    left: { style: 'thin' },
                    right: { style: 'thin' }
                  };
                  col++;
                });

                // Stat letters row
                const statLettersForCode = allStatLettersSummary[stmtCode] || {};
                const hasAnyStatLettersForCode = Object.values(statLettersForCode).some(arr => arr && arr.length > 0);

                if (hasAnyStatLettersForCode) {
                  const statRow = dataCutsWorksheet.getRow(currentRow++);
                  statRow.getCell(2).value = '';
                  statRow.getCell(2).border = {
                    top: { style: 'thin' },
                    bottom: { style: 'thin' },
                    left: { style: 'thin' },
                    right: { style: 'thin' }
                  };

                  statRow.getCell(3).value = '';
                  statRow.getCell(3).border = {
                    top: { style: 'thin' },
                    bottom: { style: 'thin' },
                    left: { style: 'thin' },
                    right: { style: 'thin' }
                  };

                  col = 4;
                  bannerCols.forEach((bannerCol, colIdx) => {
                    const statLetters = statLettersForCode[colIdx] || [];
                    const statLettersStr = statLetters.map(s => s.letter).join('');
                    const statCell = statRow.getCell(col);
                    statCell.value = statLettersStr;
                    statCell.alignment = { horizontal: 'center', vertical: 'middle' };
                    if (statLetters.length > 0) {
                      statCell.fill = {
                        type: 'pattern',
                        pattern: 'solid',
                        fgColor: { argb: 'FFE6F3FF' }
                      };
                    }
                    statCell.border = {
                      top: { style: 'thin' },
                      bottom: { style: 'thin' },
                      left: { style: 'thin' },
                      right: { style: 'thin' }
                    };
                    col++;
                  });
                }
              } else if (isMeanSummaryTable) {
                // Mean Summary Table: Show single row with mean
                const meanRow = dataCutsWorksheet.getRow(currentRow++);
                meanRow.getCell(2).value = String(stmtLabel);
                meanRow.getCell(2).border = {
                  top: { style: 'thin' },
                  bottom: { style: 'thin' },
                  left: { style: 'thin' },
                  right: { style: 'thin' }
                };

                // Total mean
                meanRow.getCell(3).value = data.total.mean;
                meanRow.getCell(3).numFmt = '0.00';
                meanRow.getCell(3).alignment = { horizontal: 'center' };
                meanRow.getCell(3).border = {
                  top: { style: 'thin' },
                  bottom: { style: 'thin' },
                  left: { style: 'thin' },
                  right: { style: 'thin' }
                };

                // Banner cut means
                let col = 4;
                bannerCols.forEach((bannerCol, colIdx) => {
                  const meanCell = meanRow.getCell(col);
                  meanCell.value = data.cuts[bannerCol.id].mean;
                  meanCell.numFmt = '0.00';
                  meanCell.alignment = { horizontal: 'center' };

                  // Add blue highlighting if this cell has stat letters
                  const statLettersForCode = allStatLettersSummary[stmtCode] || {};
                  const statLetters = statLettersForCode[colIdx] || [];
                  if (statLetters.length > 0) {
                    meanCell.fill = {
                      type: 'pattern',
                      pattern: 'solid',
                      fgColor: { argb: 'FFE6F3FF' }
                    };
                  }

                  meanCell.border = {
                    top: { style: 'thin' },
                    bottom: { style: 'thin' },
                    left: { style: 'thin' },
                    right: { style: 'thin' }
                  };
                  col++;
                });

                // Stat letters row
                const statLettersForCode = allStatLettersSummary[stmtCode] || {};
                const hasAnyStatLettersForCode = Object.values(statLettersForCode).some(arr => arr && arr.length > 0);

                if (hasAnyStatLettersForCode) {
                  const statRow = dataCutsWorksheet.getRow(currentRow++);
                  statRow.getCell(2).value = '';
                  statRow.getCell(2).border = {
                    top: { style: 'thin' },
                    bottom: { style: 'thin' },
                    left: { style: 'thin' },
                    right: { style: 'thin' }
                  };

                  statRow.getCell(3).value = '';
                  statRow.getCell(3).border = {
                    top: { style: 'thin' },
                    bottom: { style: 'thin' },
                    left: { style: 'thin' },
                    right: { style: 'thin' }
                  };

                  col = 4;
                  bannerCols.forEach((bannerCol, colIdx) => {
                    const statLetters = statLettersForCode[colIdx] || [];
                    const statLettersStr = statLetters.map(s => s.letter).join('');
                    const statCell = statRow.getCell(col);
                    statCell.value = statLettersStr;
                    statCell.alignment = { horizontal: 'center', vertical: 'middle' };
                    if (statLetters.length > 0) {
                      statCell.fill = {
                        type: 'pattern',
                        pattern: 'solid',
                        fgColor: { argb: 'FFE6F3FF' }
                      };
                    }
                    statCell.border = {
                      top: { style: 'thin' },
                      bottom: { style: 'thin' },
                      left: { style: 'thin' },
                      right: { style: 'thin' }
                    };
                    col++;
                  });
                }
              }
            });

            // Add comparison groups details section
            // Build comparison groups string based on banner groups
            const groupMapSummary = new Map<number, number[]>();
            bannerCols.forEach((col, idx) => {
              const groupIdx = col.groupIdx;
              if (!groupMapSummary.has(groupIdx)) {
                groupMapSummary.set(groupIdx, []);
              }
              groupMapSummary.get(groupIdx)!.push(idx);
            });

            const comparisonGroupsSummary = Array.from(groupMapSummary.values())
              .map(colIndices =>
                colIndices.map(idx => String.fromCharCode(65 + idx)).join('')
              )
              .join('/');

            // Comparison groups row
            const compGroupsRowSummary = dataCutsWorksheet.getRow(currentRow++);
            compGroupsRowSummary.getCell(2).value = `Comparison Groups: ${comparisonGroupsSummary}`;
            compGroupsRowSummary.getCell(2).font = { size: 9, italic: true };

            // Uppercase explanation row
            const upperRowSummary = dataCutsWorksheet.getRow(currentRow++);
            upperRowSummary.getCell(2).value = 'Uppercase letters indicate significance at the 95% level.';
            upperRowSummary.getCell(2).font = { size: 9, italic: true };

            // Lowercase explanation row (only if significance level is 90)
            if (significanceLevel === 90) {
              const lowerRowSummary = dataCutsWorksheet.getRow(currentRow++);
              lowerRowSummary.getCell(2).value = 'Lowercase letters indicate significance at the 90% level.';
              lowerRowSummary.getCell(2).font = { size: 9, italic: true };
            }

            // Skip regular response code processing for summary tables
            tableNumber++;
            continue;
          }

          // Check if this is an individual numeric grid table (e.g., "S14r1c1 (Statement text)")
          const isIndividualNumericGridTable = isNumericGrid && !isNumericGridSummaryTable && 
            tableName.match(/r\d+c\d+\s*\(/i);
          
          // Handle individual numeric grid tables as frequency distributions
          if (isIndividualNumericGridTable) {
            // Extract statement and column codes from table name (e.g., "S14r1c1" -> stmt="r1", col="c1")
            const match = tableName.match(/^([A-Z0-9]+)(r\d+)(c\d+)\s*\(/i);
            if (match) {
              const baseName = match[1];
              const stmtCode = match[2];
              const colCode = match[3];
              
              // Build column header for this specific statement/column combination
              let normalizedStmtCode = stmtCode;
              if (!/^r\d+/i.test(stmtCode) && /^\d+$/.test(stmtCode)) {
                normalizedStmtCode = `r${stmtCode}`;
              }
              const cellHeader = `Q${baseName}${normalizedStmtCode}${colCode}`;
              let colHeader: string | null = null;
              const variations = [cellHeader, cellHeader.replace(/^Q/, ''), `${baseName}${normalizedStmtCode}${colCode}`];
              for (const v of variations) {
                if (columnMapping[v]) { colHeader = columnMapping[v]; break; }
                const matchKey = Object.keys(columnMapping).find(k => k.toLowerCase() === v.toLowerCase());
                if (matchKey) { colHeader = columnMapping[matchKey]; break; }
              }
              if (!colHeader && fullRawData.columns) {
                for (const v of variations) {
                  const found = fullRawData.columns.find((c: string) => c.toLowerCase() === v.toLowerCase());
                  if (found) { colHeader = found; break; }
                }
              }
              
              if (colHeader && fullRawData.rows) {
                // Calculate frequency distribution from raw data
                const frequencyMap: Record<number, { total: number; cuts: Record<string, number> }> = {};
                let totalBase = 0;
                const cutBases: Record<string, number> = {};
                bannerCols.forEach(col => { cutBases[col.id] = 0; });
                
                fullRawData.rows.forEach((row: any) => {
                  const val = row[colHeader!];
                  if (val === null || val === undefined || val === '') return;
                  const numVal = parseFloat(String(val));
                  if (isNaN(numVal)) return;
                  
                  // Round to nearest integer for frequency distribution
                  const roundedVal = Math.round(numVal);
                  
                  // Initialize if needed
                  if (!frequencyMap[roundedVal]) {
                    frequencyMap[roundedVal] = { total: 0, cuts: {} };
                    bannerCols.forEach(col => { frequencyMap[roundedVal].cuts[col.id] = 0; });
                  }
                  
                  frequencyMap[roundedVal].total++;
                  totalBase++;
                  
                  // Check which banner cuts this row matches
                  bannerCols.forEach(col => {
                    // Find the cut from banner group
                    let cut: any = null;
                    if (bannerGroup.groups) {
                      for (const g of bannerGroup.groups) {
                        const foundCut = g.cuts.find((c: any) => c.id === col.id);
                        if (foundCut) {
                          cut = foundCut;
                          break;
                        }
                      }
                    }
                    if (!cut) return;
                    
                    const cutColHeader = getColumnHeader(cut.variableName);
                    if (!cutColHeader) return;
                    
                    const bannerVal = row[cutColHeader];
                    if (bannerVal === null || bannerVal === undefined || bannerVal === '') return;
                    const bannerValStr = String(bannerVal).trim();
                    const numBannerVal = Number(bannerValStr);
                    const codes = cut.codes || [];
                    for (const cutCode of codes) {
                      let matches = false;
                      if (bannerValStr === cutCode) matches = true;
                      else if (!isNaN(numBannerVal) && String(numBannerVal) === cutCode) matches = true;
                      else {
                        const codeNoC = cutCode.replace(/^c/i, '');
                        if (bannerValStr === codeNoC || (!isNaN(numBannerVal) && !isNaN(Number(codeNoC)) && numBannerVal === Number(codeNoC))) {
                          matches = true;
                        }
                      }
                      if (matches) {
                        frequencyMap[roundedVal].cuts[col.id]++;
                        cutBases[col.id]++;
                        break;
                      }
                    }
                  });
                });
                
                // Sort values numerically
                const sortedValues = Object.keys(frequencyMap).map(Number).sort((a, b) => a - b);
                
                // Render frequency distribution rows
                sortedValues.forEach(value => {
                  const freqData = frequencyMap[value];
                  
                  // Value row
                  const valueRow = dataCutsWorksheet.getRow(currentRow++);
                  valueRow.getCell(2).value = value;
                  valueRow.getCell(2).border = {
                    top: { style: 'thin' },
                    bottom: { style: 'thin' },
                    left: { style: 'thin' },
                    right: { style: 'thin' }
                  };
                  
                  // Total count
                  valueRow.getCell(3).value = freqData.total;
                  valueRow.getCell(3).alignment = { horizontal: 'center' };
                  valueRow.getCell(3).border = {
                    top: { style: 'thin' },
                    bottom: { style: 'thin' },
                    left: { style: 'thin' },
                    right: { style: 'thin' }
                  };
                  
                  // Banner cut counts
                  let col = 4;
                  bannerCols.forEach(bannerCol => {
                    valueRow.getCell(col).value = freqData.cuts[bannerCol.id] || 0;
                    valueRow.getCell(col).alignment = { horizontal: 'center' };
                    valueRow.getCell(col).border = {
                      top: { style: 'thin' },
                      bottom: { style: 'thin' },
                      left: { style: 'thin' },
                      right: { style: 'thin' }
                    };
                    col++;
                  });
                  
                  // Percentage row
                  const pctRow = dataCutsWorksheet.getRow(currentRow++);
                  pctRow.getCell(2).value = '';
                  pctRow.getCell(2).border = {
                    top: { style: 'thin' },
                    bottom: { style: 'thin' },
                    left: { style: 'thin' },
                    right: { style: 'thin' }
                  };
                  
                  // Total percentage
                  const totalPct = valueData['total']?.percentage || 0;
                  const totalPctCell = pctRow.getCell(3);
                  totalPctCell.value = totalPct / 100; // Store as decimal for percentage format
                  totalPctCell.numFmt = percentageDecimals === 0 ? '0%' : percentageDecimals === 1 ? '0.0%' : '0.00%';
                  totalPctCell.alignment = { horizontal: 'center' };
                  totalPctCell.border = {
                    top: { style: 'thin' },
                    bottom: { style: 'thin' },
                    left: { style: 'thin' },
                    right: { style: 'thin' }
                  };
                  
                  // Banner cut percentages
                  col = 4;
                  bannerCols.forEach(bannerCol => {
                    const cutBase = cutBases[bannerCol.id] || 0;
                    const cutPct = cutBase > 0 ? ((freqData.cuts[bannerCol.id] || 0) / cutBase) * 100 : 0;
                    const cutPctCell = pctRow.getCell(col);
                    cutPctCell.value = cutPct / 100; // Store as decimal for percentage format
                    cutPctCell.numFmt = percentageDecimals === 0 ? '0%' : percentageDecimals === 1 ? '0.0%' : '0.00%';
                    cutPctCell.alignment = { horizontal: 'center' };
                    cutPctCell.border = {
                      top: { style: 'thin' },
                      bottom: { style: 'thin' },
                      left: { style: 'thin' },
                      right: { style: 'thin' }
                    };
                    col++;
                  });
                });
                
                // Update totalBase for stats calculation
                totalBase = totalBase;
                
                // Add stats rows if enabled (same as numeric questions)
                const statsKey = variable.name;
                const statsSelections = getStatsSelectionsForVariable(statsKey);
                const isNumericForStats = true; // This is a numeric grid table
                
                if (isNumericForStats && Object.values(statsSelections).some(v => v)) {
                  // Calculate stats from frequency distribution
                  let totalCount = 0;
                  let sum = 0;
                  let sumSquares = 0;
                  let min = Infinity;
                  let max = -Infinity;
                  let modeValue: number | null = null;
                  let modeCount = -1;
                  
                  sortedValues.forEach(value => {
                    const count = frequencyMap[value].total;
                    totalCount += count;
                    sum += value * count;
                    sumSquares += value * value * count;
                    if (value < min) min = value;
                    if (value > max) max = value;
                    if (count > modeCount) {
                      modeCount = count;
                      modeValue = value;
                    }
                  });
                  
                  if (totalCount > 0) {
                    const mean = sum / totalCount;
                    const variance = Math.max(sumSquares / totalCount - mean * mean, 0);
                    const stdDev = Math.sqrt(variance);
                    
                    // Calculate median
                    const target1 = Math.floor((totalCount - 1) / 2);
                    const target2 = Math.floor(totalCount / 2);
                    let cumulative = 0;
                    let medianVal1: number | null = null;
                    let medianVal2: number | null = null;
                    sortedValues.forEach(value => {
                      const count = frequencyMap[value].total;
                      const prev = cumulative;
                      cumulative += count;
                      if (medianVal1 === null && target1 < cumulative) {
                        medianVal1 = value;
                      }
                      if (medianVal2 === null && target2 < cumulative) {
                        medianVal2 = value;
                      }
                    });
                    const median = totalCount % 2 === 0 && medianVal1 !== null && medianVal2 !== null
                      ? (medianVal1 + medianVal2) / 2
                      : (medianVal2 ?? medianVal1 ?? 0);
                    
                    // Calculate mean/sum without outliers
                    let sumNoOutliers = sum;
                    let meanNoOutliers = mean;
                    if (stdDev > 0) {
                      let filteredSum = 0;
                      let filteredCount = 0;
                      const threshold = 2 * stdDev;
                      sortedValues.forEach(value => {
                        const count = frequencyMap[value].total;
                        if (Math.abs(value - mean) <= threshold) {
                          filteredSum += value * count;
                          filteredCount += count;
                        }
                      });
                      if (filteredCount > 0) {
                        sumNoOutliers = filteredSum;
                        meanNoOutliers = filteredSum / filteredCount;
                      }
                    }
                    
                    const statsToShow = [
                      { key: 'sum', label: 'Sum', value: sum, format: '0' },
                      { key: 'mean', label: 'Mean', value: mean, format: '0.00' },
                      { key: 'meanNoOutliers', label: 'Mean (Outliers Removed)', value: meanNoOutliers, format: '0.00' },
                      { key: 'sumNoOutliers', label: 'Sum (Outliers Removed)', value: sumNoOutliers, format: '0' },
                      { key: 'median', label: 'Median', value: median, format: '0.00' },
                      { key: 'mode', label: 'Mode', value: modeValue ?? 0, format: '0' },
                      { key: 'stdDev', label: 'Std Dev', value: stdDev, format: '0.00' },
                      { key: 'max', label: 'Max', value: max, format: '0' },
                      { key: 'min', label: 'Min', value: min, format: '0' }
                    ];
                    
                    const STATS_GREY = 'FFE8E8E8';
                    statsToShow.forEach(stat => {
                      if (statsSelections[stat.key]) {
                        const statRow = dataCutsWorksheet.getRow(currentRow++);
                        statRow.getCell(2).value = stat.label;
                        statRow.getCell(2).font = { bold: true };
                        statRow.getCell(2).fill = {
                          type: 'pattern',
                          pattern: 'solid',
                          fgColor: { argb: STATS_GREY }
                        };
                        statRow.getCell(2).border = {
                          top: { style: 'thin' },
                          bottom: { style: 'thin' },
                          left: { style: 'thin' },
                          right: { style: 'thin' }
                        };
                        
                        statRow.getCell(3).value = stat.value;
                        statRow.getCell(3).numFmt = stat.format;
                        statRow.getCell(3).alignment = { horizontal: 'center' };
                        statRow.getCell(3).fill = {
                          type: 'pattern',
                          pattern: 'solid',
                          fgColor: { argb: STATS_GREY }
                        };
                        statRow.getCell(3).border = {
                          top: { style: 'thin' },
                          bottom: { style: 'thin' },
                          left: { style: 'thin' },
                          right: { style: 'thin' }
                        };
                        
                        // Banner cut stats (calculate per cut)
                        let col = 4;
                        bannerCols.forEach(bannerCol => {
                          // Calculate stats for this cut
                          let cutTotalCount = 0;
                          let cutSum = 0;
                          let cutMin = Infinity;
                          let cutMax = -Infinity;
                          
                          sortedValues.forEach(value => {
                            const count = frequencyMap[value].cuts[bannerCol.id] || 0;
                            cutTotalCount += count;
                            cutSum += value * count;
                            if (count > 0) {
                              if (value < cutMin) cutMin = value;
                              if (value > cutMax) cutMax = value;
                            }
                          });
                          
                          let cutStatValue = 0;
                          if (cutTotalCount > 0) {
                            switch (stat.key) {
                              case 'sum':
                                cutStatValue = cutSum;
                                break;
                              case 'mean':
                                cutStatValue = cutSum / cutTotalCount;
                                break;
                              case 'min':
                                cutStatValue = cutMin === Infinity ? 0 : cutMin;
                                break;
                              case 'max':
                                cutStatValue = cutMax === -Infinity ? 0 : cutMax;
                                break;
                              default:
                                // For other stats, calculate similarly
                                if (stat.key === 'median' || stat.key === 'mode' || stat.key === 'stdDev' || 
                                    stat.key === 'meanNoOutliers' || stat.key === 'sumNoOutliers') {
                                  // Simplified: use mean for complex stats per cut
                                  cutStatValue = cutSum / cutTotalCount;
                                }
                            }
                          }
                          
                          statRow.getCell(col).value = cutStatValue;
                          statRow.getCell(col).numFmt = stat.format;
                          statRow.getCell(col).alignment = { horizontal: 'center' };
                          statRow.getCell(col).fill = {
                            type: 'pattern',
                            pattern: 'solid',
                            fgColor: { argb: STATS_GREY }
                          };
                          statRow.getCell(col).border = {
                            top: { style: 'thin' },
                            bottom: { style: 'thin' },
                            left: { style: 'thin' },
                            right: { style: 'thin' }
                          };
                          col++;
                        });
                      }
                    });
                  }
                }
                
                // Skip regular response code processing for individual numeric grid tables
                tableNumber++;
                continue;
              }
            }
          }

          // Handle single select grid individual tables (isSingleSelectGridIndividualTable already declared earlier)
          if (isSingleSelectGridIndividualTable) {
            // Extract statement text from table name (e.g., "S14_Statement 1" -> "Statement 1")
            const baseName = variable.name;
            const baseNumber = baseName.replace(/^Q/, '');
            let matchedStmtCode: string | null = null;
            let matchedStmtText: string | null = null;
            
            // Find the statement that matches the table name
            // Table names use format: baseName_stmtCode (e.g., "S14_r1") to match Tab Specs UI
            // Also try matching with statement text format (e.g., "S14_Statement 1") for backward compatibility
            Object.entries(variable.statements).forEach(([stmtCode, stmtText]) => {
              const expectedTableNameByCode = `${baseName}_${stmtCode}`;
              const expectedTableNameByText = `${baseName}_${stmtText}`;
              if (tableName === expectedTableNameByCode || tableName === expectedTableNameByText) {
                matchedStmtCode = stmtCode;
                matchedStmtText = String(stmtText);
              }
            });
            
            if (matchedStmtCode && matchedStmtText) {
              // Get column header for this statement
              let normalizedStmtCode = matchedStmtCode;
              if (!/^r\d+/i.test(matchedStmtCode) && /^\d+$/.test(matchedStmtCode)) {
                normalizedStmtCode = `r${matchedStmtCode}`;
              }
              
              // Get response option values from the question (e.g., 1, 2, 3, 4, 5)
              const question = questionnaireQuestions.find(q => {
                const qNum = q.number || q.id;
                return qNum === baseNumber ||
                       qNum === baseNumber.replace(/^Q/, '') ||
                       String(qNum) === String(baseNumber);
              });
              
              // Get response options from question or variable.codes
              let responseOptionValues: Array<{ code: string; text: string }> = [];
              if (question && question.responseOptions && Array.isArray(question.responseOptions)) {
                responseOptionValues = question.responseOptions.map((opt: any, idx: number) => {
                  if (typeof opt === 'string') {
                    // Extract code from string (e.g., "1: Option 1" -> code: "1", text: "Option 1")
                    const codeMatch = opt.match(/^(\d+):?\s+(.+)$/);
                    if (codeMatch) {
                      return { code: codeMatch[1], text: codeMatch[2].trim() };
                    }
                    return { code: String(idx + 1), text: opt };
                  }
                  const code = opt.code || String(idx + 1);
                  // Remove 'c' prefix if present (e.g., "c1" -> "1")
                  const cleanCode = code.replace(/^c/i, '');
                  return { code: cleanCode, text: opt.text || opt.label || code };
                });
              } else if (variable.codes) {
                // Fallback to variable.codes if question not found
                responseOptionValues = Object.entries(variable.codes).map(([code, text]) => {
                  const cleanCode = code.replace(/^c/i, '');
                  return { code: cleanCode, text: String(text) };
                });
              }
              
              // Get all column codes (c1, c2, c3, etc.) for this statement
              const columnCodes: string[] = [];
              if (variable.codes) {
                columnCodes.push(...Object.keys(variable.codes));
              } else if (question && question.responseOptions && Array.isArray(question.responseOptions)) {
                question.responseOptions.forEach((_, idx) => {
                  columnCodes.push(`c${idx + 1}`);
                });
              }
              
              // Calculate frequency distribution from raw data
              // For single select grids, the column header is like 'QB3r1' (statement code only, no column code)
              // The values in that column indicate which response option was selected
              const frequencyMap: Record<string, { total: number; cuts: Record<string, number> }> = {};
              let totalBase = 0;
              const cutBases: Record<string, number> = {};
              bannerCols.forEach(col => { cutBases[col.id] = 0; });
              
              // Initialize frequency map for all response options
              responseOptionValues.forEach((respOpt) => {
                const cuts: Record<string, number> = {};
                bannerCols.forEach(col => { 
                  cuts[col.id] = 0; 
                });
                frequencyMap[respOpt.code] = { total: 0, cuts };
              });
              
              // Find the column header for this statement (e.g., 'QB3r1')
              const stmtHeader = `Q${baseName}${normalizedStmtCode}`;
              let stmtColHeader: string | null = getColumnHeader(stmtHeader);
              if (!stmtColHeader) {
                // Try variations
                const variations = [stmtHeader, stmtHeader.replace(/^Q/, ''), `${baseName}${normalizedStmtCode}`];
                for (const v of variations) {
                  if (columnMapping[v]) { stmtColHeader = columnMapping[v]; break; }
                  const matchKey = Object.keys(columnMapping).find(k => k.toLowerCase() === v.toLowerCase());
                  if (matchKey) { stmtColHeader = columnMapping[matchKey]; break; }
                }
                if (!stmtColHeader && fullRawData.columns) {
                  for (const v of variations) {
                    const found = fullRawData.columns.find((c: string) => c.toLowerCase() === v.toLowerCase());
                    if (found) { stmtColHeader = found; break; }
                  }
                }
              }
              
              // Process rows if we found the column header
              if (stmtColHeader && fullRawData && fullRawData.rows) {
                fullRawData.rows.forEach((row: any) => {
                  const val = row[stmtColHeader!];
                  if (val === null || val === undefined || val === '') return;
                  const strValue = String(val).trim();
                  
                  // First, determine which banner cuts this row matches (for base calculation)
                  const matchedCuts: string[] = [];
                  bannerCols.forEach(col => {
                    if (!col.colHeader) return;
                    const bannerVal = row[col.colHeader];
                    if (bannerVal === null || bannerVal === undefined || bannerVal === '') return;
                    const bannerValStr = String(bannerVal).trim();
                    const numBannerVal = Number(bannerValStr);
                    for (const cutCode of col.codes) {
                      let matches = false;
                      if (bannerValStr === cutCode) matches = true;
                      else if (!isNaN(numBannerVal) && String(numBannerVal) === cutCode) matches = true;
                      else {
                        const codeNoC = cutCode.replace(/^c/i, '');
                        if (bannerValStr === codeNoC || (!isNaN(numBannerVal) && !isNaN(Number(codeNoC)) && numBannerVal === Number(codeNoC))) {
                          matches = true;
                        }
                      }
                      if (matches) {
                        matchedCuts.push(col.id);
                        cutBases[col.id]++;
                        break;
                      }
                    }
                  });
                  
                  // Count this row in the base (all rows with values count toward base)
                  totalBase++;
                  
                  // Now match value to response option code for frequency counting
                  let matchedCode: string | null = null;
                  for (const respOpt of responseOptionValues) {
                    // Direct match
                    if (strValue === respOpt.code) {
                      matchedCode = respOpt.code;
                      break;
                    }
                    // Try numeric match
                    const numVal = /^\d+$/.test(strValue) ? parseInt(strValue, 10) : null;
                    if (numVal !== null && String(numVal) === respOpt.code) {
                      matchedCode = respOpt.code;
                      break;
                    }
                    // Try matching column code format (c1 -> 1, c2 -> 2, etc.)
                    const colCodeMatch = strValue.match(/^c?(\d+)$/i);
                    if (colCodeMatch) {
                      const numFromCode = colCodeMatch[1];
                      if (respOpt.code === numFromCode) {
                        matchedCode = respOpt.code;
                        break;
                      }
                    }
                  }
                  
                  // If matched to a response option, increment frequency
                  if (matchedCode && frequencyMap[matchedCode]) {
                    frequencyMap[matchedCode].total++;
                    // Increment cut frequencies for matched cuts
                    matchedCuts.forEach(cutId => {
                      frequencyMap[matchedCode!].cuts[cutId]++;
                    });
                  }
                });
              }

              // Calculate stat letters for all response options
              const allStatLettersDataCuts: Record<string, Record<number, { letter: string; is95: boolean }[]>> = {};

              responseOptionValues.forEach((respOpt) => {
                const freqData = frequencyMap[respOpt.code] || { total: 0, cuts: {} };
                const totalPct = valueData['total']?.percentage || 0;

                // Set debug context
                currentStatDebugVar = variable.name;
                currentStatDebugCode = `${normalizedStmtCode}_${respOpt.code}`;

                // Only debug first code of each statement AND only for S6
                const isFirstCode = responseOptionValues[0]?.code === respOpt.code;
                const isS6 = variable.name === 'S6';
                if (shouldDebugStats() && isFirstCode && isS6) {
                  appendStatLog('≡ƒÜÇ STATEMENT START (Data&Cuts SSG)', {
                    variable: variable.name,
                    statement: normalizedStmtCode,
                    totalBase
                  });

                  // Show cutBases for debugging
                  const cutBasesInfo: Record<string, any> = {};
                  bannerCols.forEach((col, idx) => {
                    cutBasesInfo[`col${idx}_${col.title}`] = cutBases[col.id] || 0;
                  });
                  appendStatLog('≡ƒôè cutBases (Data&Cuts SSG)', cutBasesInfo);
                }

                const codeStatLetters: Record<number, { letter: string; is95: boolean }[]> = {};

                bannerCols.forEach((col, colIdx) => {
                  const cutCount = freqData.cuts[col.id] || 0;
                  const cutBase = cutBases[col.id] || 0;
                  const cutPct = cutBase > 0 ? (cutCount / cutBase) * 100 : 0;

                  const statLettersForCol: { letter: string; is95: boolean }[] = [];
                  const thisCol = bannerCols[colIdx];

                  // Compare against other columns in the same group
                  let comparisonsMade = 0;
                  let comparisonsSkippedDiffGroup = 0;

                  bannerCols.forEach((otherCol, otherIdx) => {
                    if (otherIdx === colIdx) return;
                    if (otherCol.groupIdx !== thisCol.groupIdx) {
                      comparisonsSkippedDiffGroup++;
                      return;
                    }

                    const otherCount = freqData.cuts[otherCol.id] || 0;
                    const otherBase = cutBases[otherCol.id] || 0;
                    const otherPct = otherBase > 0 ? (otherCount / otherBase) * 100 : 0;

                    if (cutPct > otherPct) {
                      comparisonsMade++;
                      const { is95, is90 } = isSignificant(cutPct, cutBase, otherPct, otherBase);

                      if (significanceLevel === 95) {
                        if (is95) statLettersForCol.push({ letter: String.fromCharCode(65 + otherIdx), is95: true });
                      } else {
                        if (is95) {
                          statLettersForCol.push({ letter: String.fromCharCode(65 + otherIdx), is95: true });
                        } else if (is90) {
                          statLettersForCol.push({ letter: String.fromCharCode(97 + otherIdx), is95: false });
                        }
                      }
                    }
                  });

                  // Fallback: compare across all cuts if no letters found
                  if (statLettersForCol.length === 0) {
                    bannerCols.forEach((otherCol, otherIdx) => {
                      if (otherIdx === colIdx) return;

                      const otherCount = freqData.cuts[otherCol.id] || 0;
                      const otherBase = cutBases[otherCol.id] || 0;
                      const otherPct = otherBase > 0 ? (otherCount / otherBase) * 100 : 0;

                      if (cutPct > otherPct) {
                        const { is95, is90 } = isSignificant(cutPct, cutBase, otherPct, otherBase);

                        if (significanceLevel === 95) {
                          if (is95) statLettersForCol.push({ letter: String.fromCharCode(65 + otherIdx), is95: true });
                        } else {
                          if (is95) {
                            statLettersForCol.push({ letter: String.fromCharCode(65 + otherIdx), is95: true });
                          } else if (is90) {
                            statLettersForCol.push({ letter: String.fromCharCode(97 + otherIdx), is95: false });
                          }
                        }
                      }
                    });
                  }

                  codeStatLetters[colIdx] = statLettersForCol;
                });

                if (shouldDebugStats() && isFirstCode && isS6) {
                  const letterStrings: Record<string, string> = {};
                  let hasAnyLetters = false;
                  Object.keys(codeStatLetters).forEach(k => {
                    const letters = codeStatLetters[Number(k)] || [];
                    const letterStr = letters.map(l => l.letter).join('');
                    if (letterStr) {
                      letterStrings[`col${k}_${bannerCols[Number(k)]?.title}`] = letterStr;
                      hasAnyLetters = true;
                    }
                  });
                  if (hasAnyLetters) {
                    appendStatLog('Γ£à Stat letters found (Data&Cuts SSG)', letterStrings);
                  } else {
                    appendStatLog('Γ¥î NO stat letters (Data&Cuts SSG)', {
                      statement: normalizedStmtCode,
                      code: respOpt.code
                    });
                  }
                }

                allStatLettersDataCuts[respOpt.code] = codeStatLetters;
              });

              // Add Base (total responding) row BEFORE rendering response options
              const STATS_GREY_SELECT_GRID = 'FFE8E8E8'; // Lighter grey for base and stats rows
              const baseRespondingRow = dataCutsWorksheet.getRow(currentRow++);
              baseRespondingRow.getCell(2).value = 'Base (total responding):';
              baseRespondingRow.getCell(2).font = { bold: true };
              baseRespondingRow.getCell(2).fill = {
                type: 'pattern',
                pattern: 'solid',
                fgColor: { argb: STATS_GREY_SELECT_GRID }
              };
              baseRespondingRow.getCell(2).border = {
                top: { style: 'thin' },
                bottom: { style: 'thin' },
                left: { style: 'thin' },
                right: { style: 'thin' }
              };

              // Total base
              baseRespondingRow.getCell(3).value = totalBase;
              baseRespondingRow.getCell(3).alignment = { horizontal: 'center' };
              baseRespondingRow.getCell(3).fill = {
                type: 'pattern',
                pattern: 'solid',
                fgColor: { argb: STATS_GREY_SELECT_GRID }
              };
              baseRespondingRow.getCell(3).border = {
                top: { style: 'thin' },
                bottom: { style: 'thin' },
                left: { style: 'thin' },
                right: { style: 'thin' }
              };

              // Banner cut bases
              let baseCol = 4;
              bannerCols.forEach(bannerCol => {
                baseRespondingRow.getCell(baseCol).value = cutBases[bannerCol.id] || 0;
                baseRespondingRow.getCell(baseCol).alignment = { horizontal: 'center' };
                baseRespondingRow.getCell(baseCol).fill = {
                  type: 'pattern',
                  pattern: 'solid',
                  fgColor: { argb: STATS_GREY_SELECT_GRID }
                };
                baseRespondingRow.getCell(baseCol).border = {
                  top: { style: 'thin' },
                  bottom: { style: 'thin' },
                  left: { style: 'thin' },
                  right: { style: 'thin' }
                };
                baseCol++;
              });
              
              // Render frequency distribution table with all response options
              // Use responseOptionValues to ensure all options are shown, even if frequency is 0
              responseOptionValues.forEach((respOpt) => {
                const freqData = frequencyMap[respOpt.code] || { total: 0, cuts: {} };
                const codeLabel = respOpt.text;
                
                // Count row
                const countRow = dataCutsWorksheet.getRow(currentRow++);
                countRow.getCell(2).value = codeLabel;
                countRow.getCell(2).border = {
                  top: { style: 'thin' },
                  bottom: { style: 'thin' },
                  left: { style: 'thin' },
                  right: { style: 'thin' }
                };
                
                // Total count
                countRow.getCell(3).value = freqData.total;
                countRow.getCell(3).alignment = { horizontal: 'center' };
                countRow.getCell(3).border = {
                  top: { style: 'thin' },
                  bottom: { style: 'thin' },
                  left: { style: 'thin' },
                  right: { style: 'thin' }
                };
                
                // Banner cut counts
                let col = 4;
                bannerCols.forEach(bannerCol => {
                  countRow.getCell(col).value = freqData.cuts[bannerCol.id] || 0;
                  countRow.getCell(col).alignment = { horizontal: 'center' };
                  countRow.getCell(col).border = {
                    top: { style: 'thin' },
                    bottom: { style: 'thin' },
                    left: { style: 'thin' },
                    right: { style: 'thin' }
                  };
                  col++;
                });
                
                // Percentage row
                const pctRow = dataCutsWorksheet.getRow(currentRow++);
                pctRow.getCell(2).value = '';
                pctRow.getCell(2).border = {
                  top: { style: 'thin' },
                  bottom: { style: 'thin' },
                  left: { style: 'thin' },
                  right: { style: 'thin' }
                };
                
                // Total percentage
                const totalPct = valueData['total']?.percentage || 0;
                const totalPctCell = pctRow.getCell(3);
                totalPctCell.value = totalPct / 100; // Store as decimal for percentage format
                totalPctCell.numFmt = percentageDecimals === 0 ? '0%' : percentageDecimals === 1 ? '0.0%' : '0.00%';
                totalPctCell.alignment = { horizontal: 'center' };
                totalPctCell.border = {
                  top: { style: 'thin' },
                  bottom: { style: 'thin' },
                  left: { style: 'thin' },
                  right: { style: 'thin' }
                };
                
                // Banner cut percentages
                col = 4;
                bannerCols.forEach(bannerCol => {
                  const cutBase = cutBases[bannerCol.id] || 0;
                  const cutPct = cutBase > 0 ? ((freqData.cuts[bannerCol.id] || 0) / cutBase) * 100 : 0;
                  const cutPctCell = pctRow.getCell(col);
                  cutPctCell.value = cutPct / 100; // Store as decimal for percentage format
                  cutPctCell.numFmt = percentageDecimals === 0 ? '0%' : percentageDecimals === 1 ? '0.0%' : '0.00%';
                  cutPctCell.alignment = { horizontal: 'center' };
                  cutPctCell.border = {
                    top: { style: 'thin' },
                    bottom: { style: 'thin' },
                    left: { style: 'thin' },
                    right: { style: 'thin' }
                  };
                  col++;
                });

                // Stat letters row (if any stat letters exist for this response option)
                const statLettersForCode = allStatLettersDataCuts[respOpt.code] || {};
                const hasAnyStatLettersForCode = Object.values(statLettersForCode).some(arr => arr && arr.length > 0);

                if (hasAnyStatLettersForCode) {
                  const statRow = dataCutsWorksheet.getRow(currentRow++);
                  statRow.getCell(2).value = '';
                  statRow.getCell(2).border = {
                    top: { style: 'thin' },
                    bottom: { style: 'thin' },
                    left: { style: 'thin' },
                    right: { style: 'thin' }
                  };

                  // Total column - no stat letters for total
                  statRow.getCell(3).value = '';
                  statRow.getCell(3).border = {
                    top: { style: 'thin' },
                    bottom: { style: 'thin' },
                    left: { style: 'thin' },
                    right: { style: 'thin' }
                  };

                  // Banner cut stat letters
                  col = 4;
                  bannerCols.forEach((bannerCol, colIdx) => {
                    const statLetters = statLettersForCode[colIdx] || [];
                    const statLettersStr = statLetters.map(s => s.letter).join('');
                    const statCell = statRow.getCell(col);
                    statCell.value = statLettersStr;
                    statCell.alignment = { horizontal: 'center', vertical: 'middle' };
                    statCell.font = { color: { argb: 'FF0000FF' }, bold: true };
                    if (statLetters.length > 0) {
                      statCell.fill = {
                        type: 'pattern',
                        pattern: 'solid',
                        fgColor: { argb: 'FFE6F3FF' }
                      };
                    }
                    statCell.border = {
                      top: { style: 'thin' },
                      bottom: { style: 'thin' },
                      left: { style: 'thin' },
                      right: { style: 'thin' }
                    };
                    col++;
                  });
                }
              });
              
              // Update totalBase for display
              totalBase = totalBase;
              
              // Add nets as stats rows for single select grid individual tables
              const netCodes = netSummaryTableSelectedCodes[baseName] || [];
              if (netCodes.length > 0) {
                netCodes.forEach(net => {
                  if (net.codes && net.codes.length > 0) {
                    // Calculate net totals from frequencyMap
                    let netTotalCount = 0;
                    const netCutCounts: Record<string, number> = {};
                    bannerCols.forEach(col => { netCutCounts[col.id] = 0; });
                    
                    net.codes.forEach(code => {
                      // Match code to responseOptionValues
                      const matchedRespOpt = responseOptionValues.find(opt => {
                        const optCode = opt.code || '';
                        return optCode === code || optCode.replace(/^c/i, '') === code.replace(/^c/i, '');
                      });
                      if (matchedRespOpt) {
                        const freqData = frequencyMap[matchedRespOpt.code] || { total: 0, cuts: {} };
                        netTotalCount += freqData.total;
                        bannerCols.forEach(col => {
                          netCutCounts[col.id] += freqData.cuts[col.id] || 0;
                        });
                      }
                    });
                    
                    // Count row
                    const countRow = dataCutsWorksheet.getRow(currentRow++);
                    countRow.getCell(2).value = `NET: ${net.name}`;
                    countRow.getCell(2).font = { bold: true };
                    countRow.getCell(2).fill = {
                      type: 'pattern',
                      pattern: 'solid',
                      fgColor: { argb: STATS_GREY_SELECT_GRID }
                    };
                    countRow.getCell(2).border = {
                      top: { style: 'thin' },
                      bottom: { style: 'thin' },
                      left: { style: 'thin' },
                      right: { style: 'thin' }
                    };
                    
                    // Total count
                    countRow.getCell(3).value = netTotalCount;
                    countRow.getCell(3).alignment = { horizontal: 'center' };
                    countRow.getCell(3).fill = {
                      type: 'pattern',
                      pattern: 'solid',
                      fgColor: { argb: STATS_GREY_SELECT_GRID }
                    };
                    countRow.getCell(3).border = {
                      top: { style: 'thin' },
                      bottom: { style: 'thin' },
                      left: { style: 'thin' },
                      right: { style: 'thin' }
                    };
                    
                    // Banner cut counts
                    let col = 4;
                    bannerCols.forEach(bannerCol => {
                      countRow.getCell(col).value = netCutCounts[bannerCol.id];
                      countRow.getCell(col).alignment = { horizontal: 'center' };
                      countRow.getCell(col).fill = {
                        type: 'pattern',
                        pattern: 'solid',
                        fgColor: { argb: STATS_GREY_SELECT_GRID }
                      };
                      countRow.getCell(col).border = {
                        top: { style: 'thin' },
                        bottom: { style: 'thin' },
                        left: { style: 'thin' },
                        right: { style: 'thin' }
                      };
                      col++;
                    });
                    
                    // Percentage row
                    const pctRow = dataCutsWorksheet.getRow(currentRow++);
                    pctRow.getCell(2).value = '';
                    pctRow.getCell(2).fill = {
                      type: 'pattern',
                      pattern: 'solid',
                      fgColor: { argb: STATS_GREY_SELECT_GRID }
                    };
                    pctRow.getCell(2).border = {
                      top: { style: 'thin' },
                      bottom: { style: 'thin' },
                      left: { style: 'thin' },
                      right: { style: 'thin' }
                    };
                    
                    // Total percentage
                    const totalPct = totalBase > 0 ? (netTotalCount / totalBase) * 100 : 0;
                    const totalPctCell = pctRow.getCell(3);
                    totalPctCell.value = totalPct / 100; // Store as decimal for percentage format
                    totalPctCell.numFmt = percentageDecimals === 0 ? '0%' : percentageDecimals === 1 ? '0.0%' : '0.00%';
                    totalPctCell.alignment = { horizontal: 'center' };
                    totalPctCell.fill = {
                      type: 'pattern',
                      pattern: 'solid',
                      fgColor: { argb: STATS_GREY_SELECT_GRID }
                    };
                    totalPctCell.border = {
                      top: { style: 'thin' },
                      bottom: { style: 'thin' },
                      left: { style: 'thin' },
                      right: { style: 'thin' }
                    };
                    
                    // Banner cut percentages
                    col = 4;
                    bannerCols.forEach(bannerCol => {
                      const cutBase = cutBases[bannerCol.id] || 0;
                      const cutPct = cutBase > 0 ? (netCutCounts[bannerCol.id] / cutBase) * 100 : 0;
                      const cutPctCell = pctRow.getCell(col);
                      cutPctCell.value = cutPct / 100; // Store as decimal for percentage format
                      cutPctCell.numFmt = percentageDecimals === 0 ? '0%' : percentageDecimals === 1 ? '0.0%' : '0.00%';
                      cutPctCell.alignment = { horizontal: 'center' };
                      cutPctCell.fill = {
                        type: 'pattern',
                        pattern: 'solid',
                        fgColor: { argb: STATS_GREY_SELECT_GRID }
                      };
                      pctRow.getCell(col).border = {
                        top: { style: 'thin' },
                        bottom: { style: 'thin' },
                        left: { style: 'thin' },
                        right: { style: 'thin' }
                      };
                      col++;
                    });
                  }
                });
              }

              // Add mean statistic for single select grid individual tables (Excel export)
              const statsSelections = getStatsSelectionsForVariable(baseName);
              if (statsSelections.mean) {
                // Calculate mean from response codes
                let totalSum = 0;
                let totalCount = 0;
                const cutSums: Record<string, number> = {};
                const cutCounts: Record<string, number> = {};
                bannerCols.forEach(col => {
                  cutSums[col.id] = 0;
                  cutCounts[col.id] = 0;
                });

                responseOptionValues.forEach(respOpt => {
                  const codeValue = getCodeValueForMean(variable, respOpt.code);
                  if (codeValue === null) return;

                  const freqData = frequencyMap[respOpt.code] || { total: 0, cuts: {} };
                  totalSum += codeValue * freqData.total;
                  totalCount += freqData.total;

                  bannerCols.forEach(col => {
                    const cutCount = freqData.cuts[col.id] || 0;
                    cutSums[col.id] += codeValue * cutCount;
                    cutCounts[col.id] += cutCount;
                  });
                });

                const totalMean = totalCount > 0 ? totalSum / totalCount : 0;

                // Mean row
                const meanRow = dataCutsWorksheet.getRow(currentRow++);
                meanRow.getCell(2).value = 'Mean';
                meanRow.getCell(2).font = { bold: true };
                meanRow.getCell(2).fill = {
                  type: 'pattern',
                  pattern: 'solid',
                  fgColor: { argb: STATS_GREY_SELECT_GRID }
                };
                meanRow.getCell(2).border = {
                  top: { style: 'thin' },
                  bottom: { style: 'thin' },
                  left: { style: 'thin' },
                  right: { style: 'thin' }
                };

                // Total mean
                meanRow.getCell(3).value = totalMean;
                meanRow.getCell(3).numFmt = '0.00';
                meanRow.getCell(3).alignment = { horizontal: 'center' };
                meanRow.getCell(3).fill = {
                  type: 'pattern',
                  pattern: 'solid',
                  fgColor: { argb: STATS_GREY_SELECT_GRID }
                };
                meanRow.getCell(3).border = {
                  top: { style: 'thin' },
                  bottom: { style: 'thin' },
                  left: { style: 'thin' },
                  right: { style: 'thin' }
                };

                // Banner cut means
                let col = 4;
                bannerCols.forEach(bannerCol => {
                  const cutMean = cutCounts[bannerCol.id] > 0 ? cutSums[bannerCol.id] / cutCounts[bannerCol.id] : 0;
                  meanRow.getCell(col).value = cutMean;
                  meanRow.getCell(col).numFmt = '0.00';
                  meanRow.getCell(col).alignment = { horizontal: 'center' };
                  meanRow.getCell(col).fill = {
                    type: 'pattern',
                    pattern: 'solid',
                    fgColor: { argb: STATS_GREY_SELECT_GRID }
                  };
                  meanRow.getCell(col).border = {
                    top: { style: 'thin' },
                    bottom: { style: 'thin' },
                    left: { style: 'thin' },
                    right: { style: 'thin' }
                  };
                  col++;
                });
              }

              // Skip regular response code processing for single select grid individual tables
              tableNumber++;
              continue;
            }
          }

          // Check if this is an open end question - use frequency distribution from raw data
          const isOpenEndType = variable.type?.toLowerCase().includes('open end') &&
                                !variable.type?.toLowerCase().includes('list');

          // For open end questions, calculate frequency distribution from raw data
          if (isOpenEndType) {
            const freqData = calculateFrequencyData(variable, tableName);
            if (freqData && freqData.codes.length > 0) {
              // Pre-calculate all counts, bases, and percentages for stat testing
              const openEndData: Record<string, { count: number; base: number; pct: number; cutData: Record<string, { count: number; base: number; pct: number }> }> = {};

              freqData.codes.forEach((codeItem) => {
                const code = codeItem.code;
                const codeLabel = codeItem.text;

                openEndData[code] = {
                  count: freqData.frequencyMap[code] || 0,
                  base: freqData.totalCount,
                  pct: freqData.totalCount > 0 ? ((freqData.frequencyMap[code] || 0) / freqData.totalCount) * 100 : 0,
                  cutData: {}
                };

                // Calculate cut data for each banner column
                bannerCols.forEach(bannerCol => {
                  let cut: any = null;
                  if (bannerGroup.groups) {
                    for (const g of bannerGroup.groups) {
                      const foundCut = g.cuts.find((c: any) => c.id === bannerCol.id);
                      if (foundCut) {
                        cut = foundCut;
                        break;
                      }
                    }
                  }

                  let cutCount = 0;
                  let cutBase = 0;

                  if (cut && fullRawData.rows) {
                    const cutColHeader = getColumnHeader(cut.variableName);
                    const varColHeader = getColumnHeader(variable.name);
                    if (cutColHeader && varColHeader) {
                      fullRawData.rows.forEach((row: any) => {
                        const value = row[varColHeader];
                        if (value !== null && value !== undefined && value !== '') {
                          const bannerVal = row[cutColHeader];
                          if (bannerVal !== null && bannerVal !== undefined && bannerVal !== '') {
                            const bannerValStr = String(bannerVal).trim();
                            const numBannerVal = Number(bannerValStr);
                            const codes = cut.codes || [];
                            for (const cutCode of codes) {
                              let matches = false;
                              if (bannerValStr === cutCode) matches = true;
                              else if (!isNaN(numBannerVal) && String(numBannerVal) === cutCode) matches = true;
                              else {
                                const codeNoC = cutCode.replace(/^c/i, '');
                                if (bannerValStr === codeNoC || (!isNaN(numBannerVal) && !isNaN(Number(codeNoC)) && numBannerVal === Number(codeNoC))) {
                                  matches = true;
                                }
                              }
                              if (matches) {
                                cutBase++;
                                const strValue = String(value).trim();
                                if (strValue === code || strValue === codeLabel) {
                                  cutCount++;
                                }
                                break;
                              }
                            }
                          }
                        }
                      });
                    }
                  }

                  openEndData[code].cutData[bannerCol.id] = {
                    count: cutCount,
                    base: cutBase,
                    pct: cutBase > 0 ? (cutCount / cutBase) * 100 : 0
                  };
                });
              });

              // Calculate stat letters for all codes
              const allStatLettersOpenEnd: Record<string, Record<number, { letter: string; is95: boolean }[]>> = {};

              freqData.codes.forEach((codeItem) => {
                const code = codeItem.code;
                const codeStatLetters: Record<number, { letter: string; is95: boolean }[]> = {};

                bannerCols.forEach((thisCol, colIdx) => {
                  const thisPct = openEndData[code].cutData[thisCol.id]?.pct || 0;
                  const thisBase = openEndData[code].cutData[thisCol.id]?.base || 0;
                  const statLettersForCol: { letter: string; is95: boolean }[] = [];

                  // Within-group comparisons ONLY
                  bannerCols.forEach((otherCol, otherIdx) => {
                    if (otherIdx === colIdx) return;
                    if (otherCol.groupIdx !== thisCol.groupIdx) return;

                    const otherPct = openEndData[code].cutData[otherCol.id]?.pct || 0;
                    const otherBase = openEndData[code].cutData[otherCol.id]?.base || 0;

                    if (thisPct > otherPct) {
                      const { is95, is90 } = isSignificant(thisPct, thisBase, otherPct, otherBase);

                      if (significanceLevel === 95) {
                        if (is95) statLettersForCol.push({ letter: String.fromCharCode(65 + otherIdx), is95: true });
                      } else {
                        if (is95) {
                          statLettersForCol.push({ letter: String.fromCharCode(65 + otherIdx), is95: true });
                        } else if (is90) {
                          statLettersForCol.push({ letter: String.fromCharCode(97 + otherIdx), is95: false });
                        }
                      }
                    }
                  });

                  codeStatLetters[colIdx] = statLettersForCol;
                });

                allStatLettersOpenEnd[code] = codeStatLetters;
              });

              // Render frequency distribution table for open end
              freqData.codes.forEach((codeItem) => {
                const code = codeItem.code;
                const codeLabel = codeItem.text;
                const frequency = freqData.frequencyMap[code] || 0;
                const percentage = freqData.totalCount > 0 ? (frequency / freqData.totalCount) * 100 : 0;
                
                // Count row
                const countRow = dataCutsWorksheet.getRow(currentRow++);
                countRow.getCell(2).value = codeLabel;
                countRow.getCell(2).border = {
                  top: { style: 'thin' },
                  bottom: { style: 'thin' },
                  left: { style: 'thin' },
                  right: { style: 'thin' }
                };
                
                // Total count
                countRow.getCell(3).value = frequency;
                countRow.getCell(3).alignment = { horizontal: 'center' };
                countRow.getCell(3).border = {
                  top: { style: 'thin' },
                  bottom: { style: 'thin' },
                  left: { style: 'thin' },
                  right: { style: 'thin' }
                };
                
                // Banner cut counts - use pre-calculated data
                let col = 4;
                bannerCols.forEach((bannerCol, colIdx) => {
                  const cutCount = openEndData[code].cutData[bannerCol.id]?.count || 0;
                  const countCell = countRow.getCell(col);
                  countCell.value = cutCount;
                  countCell.alignment = { horizontal: 'center' };

                  // Add blue highlighting if this cell has stat letters
                  const statLettersForCode = allStatLettersOpenEnd[code] || {};
                  const statLetters = statLettersForCode[colIdx] || [];
                  if (statLetters.length > 0) {
                    countCell.fill = {
                      type: 'pattern',
                      pattern: 'solid',
                      fgColor: { argb: 'FFE6F3FF' }
                    };
                  }

                  countCell.border = {
                    top: { style: 'thin' },
                    bottom: { style: 'thin' },
                    left: { style: 'thin' },
                    right: { style: 'thin' }
                  };
                  col++;
                });
                
                // Percentage row
                const pctRow = dataCutsWorksheet.getRow(currentRow++);
                pctRow.getCell(2).value = '';
                pctRow.getCell(2).border = {
                  top: { style: 'thin' },
                  bottom: { style: 'thin' },
                  left: { style: 'thin' },
                  right: { style: 'thin' }
                };
                
                // Total percentage
                const totalPctCell = pctRow.getCell(3);
                totalPctCell.value = percentage / 100; // Store as decimal for percentage format
                totalPctCell.numFmt = percentageDecimals === 0 ? '0%' : percentageDecimals === 1 ? '0.0%' : '0.00%';
                totalPctCell.alignment = { horizontal: 'center' };
                totalPctCell.border = {
                  top: { style: 'thin' },
                  bottom: { style: 'thin' },
                  left: { style: 'thin' },
                  right: { style: 'thin' }
                };
                
                // Banner cut percentages - use pre-calculated data
                col = 4;
                bannerCols.forEach((bannerCol, colIdx) => {
                  const cutPct = openEndData[code].cutData[bannerCol.id]?.pct || 0;
                  const cutPctCell = pctRow.getCell(col);
                  cutPctCell.value = cutPct / 100; // Store as decimal for percentage format
                  cutPctCell.numFmt = percentageDecimals === 0 ? '0%' : percentageDecimals === 1 ? '0.0%' : '0.00%';
                  cutPctCell.alignment = { horizontal: 'center' };

                  // Add blue highlighting if this cell has stat letters
                  const statLettersForCode = allStatLettersOpenEnd[code] || {};
                  const statLetters = statLettersForCode[colIdx] || [];
                  if (statLetters.length > 0) {
                    cutPctCell.fill = {
                      type: 'pattern',
                      pattern: 'solid',
                      fgColor: { argb: 'FFE6F3FF' }
                    };
                  }

                  cutPctCell.border = {
                    top: { style: 'thin' },
                    bottom: { style: 'thin' },
                    left: { style: 'thin' },
                    right: { style: 'thin' }
                  };
                  col++;
                });

                // Stat letters row (if any stat letters exist for this code)
                const statLettersForCode = allStatLettersOpenEnd[code] || {};
                const hasAnyStatLettersForCode = Object.values(statLettersForCode).some(arr => arr && arr.length > 0);

                if (hasAnyStatLettersForCode) {
                  const statRow = dataCutsWorksheet.getRow(currentRow++);
                  statRow.getCell(2).value = '';
                  statRow.getCell(2).border = {
                    top: { style: 'thin' },
                    bottom: { style: 'thin' },
                    left: { style: 'thin' },
                    right: { style: 'thin' }
                  };

                  // Total column - no stat letters for total
                  statRow.getCell(3).value = '';
                  statRow.getCell(3).border = {
                    top: { style: 'thin' },
                    bottom: { style: 'thin' },
                    left: { style: 'thin' },
                    right: { style: 'thin' }
                  };

                  // Banner cut stat letters
                  col = 4;
                  bannerCols.forEach((bannerCol, colIdx) => {
                    const statLetters = statLettersForCode[colIdx] || [];
                    const statLettersStr = statLetters.map(s => s.letter).join('');
                    const statCell = statRow.getCell(col);
                    statCell.value = statLettersStr;
                    statCell.alignment = { horizontal: 'center', vertical: 'middle' };
                    if (statLetters.length > 0) {
                      statCell.fill = {
                        type: 'pattern',
                        pattern: 'solid',
                        fgColor: { argb: 'FFE6F3FF' }
                      };
                    }
                    statCell.border = {
                      top: { style: 'thin' },
                      bottom: { style: 'thin' },
                      left: { style: 'thin' },
                      right: { style: 'thin' }
                    };
                    col++;
                  });
                }
              });

              // Add comparison groups details section
              // Build comparison groups string based on banner groups
              const groupMapOpenEnd = new Map<number, number[]>();
              bannerCols.forEach((col, idx) => {
                const groupIdx = col.groupIdx;
                if (!groupMapOpenEnd.has(groupIdx)) {
                  groupMapOpenEnd.set(groupIdx, []);
                }
                groupMapOpenEnd.get(groupIdx)!.push(idx);
              });

              const comparisonGroupsOpenEnd = Array.from(groupMapOpenEnd.values())
                .map(colIndices =>
                  colIndices.map(idx => String.fromCharCode(65 + idx)).join('')
                )
                .join('/');

              // Comparison groups row
              const compGroupsRowOpenEnd = dataCutsWorksheet.getRow(currentRow++);
              compGroupsRowOpenEnd.getCell(2).value = `Comparison Groups: ${comparisonGroupsOpenEnd}`;
              compGroupsRowOpenEnd.getCell(2).font = { size: 9, italic: true };

              // Uppercase explanation row
              const upperRowOpenEnd = dataCutsWorksheet.getRow(currentRow++);
              upperRowOpenEnd.getCell(2).value = 'Uppercase letters indicate significance at the 95% level.';
              upperRowOpenEnd.getCell(2).font = { size: 9, italic: true };

              // Lowercase explanation row (only if significance level is 90)
              if (significanceLevel === 90) {
                const lowerRowOpenEnd = dataCutsWorksheet.getRow(currentRow++);
                lowerRowOpenEnd.getCell(2).value = 'Lowercase letters indicate significance at the 90% level.';
                lowerRowOpenEnd.getCell(2).font = { size: 9, italic: true };
              }

              // Skip regular response code processing for open end questions
              tableNumber++;
              continue;
            }
          }

          // Check if this is a regular numeric question (not a grid)
          // Handle numeric questions - create frequency distribution table
          if (isNumericQuestion && tableName === variable.name) {
            if (isB8Debug) {
              appendStatLog('[B8] Entering numeric question handling block (third location)', { tableName, variable: variable.name });
            }
            // Find the column header for this numeric variable
            // Check base variable name first (e.g., "S9" or "QS9")
            let numericColHeader = getColumnHeader(variable.name);
            
            // If not found and variable has statements, try statement-specific mappings (e.g., "S9r1" or "QS9r1")
            if (!numericColHeader && variable.statements && Object.keys(variable.statements).length > 0) {
              // Try each statement code
              for (const stmtCode of Object.keys(variable.statements)) {
                // Try variations: baseName + stmtCode (e.g., "S9r1", "QS9r1")
                const baseName = variable.name;
                const variations = [
                  `${baseName}${stmtCode}`,
                  `Q${baseName}${stmtCode}`,
                  baseName.startsWith('Q') ? `${baseName}${stmtCode}` : `Q${baseName}${stmtCode}`,
                  baseName.startsWith('Q') ? `${baseName.substring(1)}${stmtCode}` : `${baseName}${stmtCode}`
                ];
                
                for (const variation of variations) {
                  if (columnMapping[variation]) {
                    numericColHeader = columnMapping[variation];
                    break;
                  }
                  const matchingKey = Object.keys(columnMapping).find(
                    key => key.toLowerCase() === variation.toLowerCase()
                  );
                  if (matchingKey) {
                    numericColHeader = columnMapping[matchingKey];
                    break;
                  }
                  
                  // Also check direct column match
                  if (fullRawData.columns) {
                    const directMatch = fullRawData.columns.find(
                      col => col.toLowerCase() === variation.toLowerCase()
                    );
                    if (directMatch) {
                      numericColHeader = directMatch;
                      break;
                    }
                  }
                }
                
                if (numericColHeader) break;
              }
            }
            
            // Use calculateBannerTableDataForVariable to get frequency distribution (same as Variables tab)
            const numericData = calculateBannerTableDataForVariable(variable, variable.name, bannerGroup);
            
            if (!numericData || Object.keys(numericData).length === 0) {
              if (isB8Debug) {
                appendStatLog('[B8] ERROR: No numeric data returned', { variable: variable.name });
              }
              // Skip this table if no data
              tableNumber++;
              continue;
            }
            
            // Extract sorted numeric values from the data keys
            const sortedNumericValues = Object.keys(numericData)
              .map(v => parseFloat(v))
              .filter(v => !isNaN(v))
              .sort((a, b) => a - b);
            
            // Get bases from the data structure
            const totalBase = numericData[sortedNumericValues[0]?.toString() || '']?.['total']?.base || 0;
            const cutBases: Record<string, number> = {};
            bannerCols.forEach(col => {
              cutBases[col.id] = numericData[sortedNumericValues[0]?.toString() || '']?.[col.id]?.base || 0;
            });
            
            if (isPreviewMode) {
              // eslint-disable-next-line no-console
              console.log('[Preview Debug - buildTabSpecsWorkbook] Frequency distribution from calculateBannerTableDataForVariable:', {
                uniqueValues: sortedNumericValues.length,
                sortedValues: sortedNumericValues.slice(0, 10),
                totalBase,
                cutBases,
                sampleData: sortedNumericValues.slice(0, 3).map(v => ({
                  value: v,
                  total: numericData[v.toString()]?.['total'],
                  sampleCut: numericData[v.toString()]?.[bannerCols[0]?.id]
                }))
              });
            }
            
            // Record position for TOC
            tablePositions.push({ tableNumber, tableName, rowNumber: currentRow, variable });
            
            // Table title
            const baseQuestionNumber = getBaseQuestionNumber(variable.name);
            const tableTitle = `Table ${tableNumber}: ${baseQuestionNumber}`;
            const titleRow = dataCutsWorksheet.getRow(currentRow++);
            titleRow.getCell(2).value = tableTitle;
            titleRow.getCell(2).font = { bold: true, size: 12 };
            
            // Question text
            const questionRow = dataCutsWorksheet.getRow(currentRow++);
            questionRow.getCell(2).value = variable.description || variable.name;
            questionRow.getCell(2).font = { size: 11 };
            
            // Build 3-row header (Total + banner groups) - same as other tables
            const headerStartRow = currentRow;
            const groupTitleRow = headerStartRow;
            const cutTitleRow = headerStartRow + 1;
            const statLetterRow = headerStartRow + 2;
            let currentCol = 2;
            
            // Row label cell (merged across all 3 rows)
            const rowLabelCell = dataCutsWorksheet.getRow(groupTitleRow).getCell(currentCol);
            rowLabelCell.value = '';
            rowLabelCell.border = {
              top: { style: 'thin' },
              bottom: { style: 'thin' },
              left: { style: 'thin' },
              right: { style: 'thin' }
            };
            dataCutsWorksheet.mergeCells(groupTitleRow, currentCol, statLetterRow, currentCol);
            [cutTitleRow, statLetterRow].forEach(r => {
              const cell = dataCutsWorksheet.getRow(r).getCell(currentCol);
              cell.border = {
                top: { style: 'thin' },
                bottom: { style: 'thin' },
                left: { style: 'thin' },
                right: { style: 'thin' }
              };
            });
            currentCol++;
            
            // Total column
            const totalGroupCell = dataCutsWorksheet.getRow(groupTitleRow).getCell(currentCol);
            totalGroupCell.value = 'Total';
            totalGroupCell.alignment = { horizontal: 'center', vertical: 'middle' };
            totalGroupCell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
            totalGroupCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFD14A2D' } };
            totalGroupCell.border = {
              top: { style: 'thin' },
              bottom: { style: 'thin' },
              left: { style: 'thin' },
              right: { style: 'thin' }
            };
            dataCutsWorksheet.mergeCells(groupTitleRow, currentCol, cutTitleRow, currentCol);
            const totalCutCell = dataCutsWorksheet.getRow(cutTitleRow).getCell(currentCol);
            totalCutCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFD14A2D' } };
            totalCutCell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
            totalCutCell.border = {
              top: { style: 'thin' },
              bottom: { style: 'thin' },
              left: { style: 'thin' },
              right: { style: 'thin' }
            };
            const totalStatCell = dataCutsWorksheet.getRow(statLetterRow).getCell(currentCol);
            totalStatCell.value = '';
            totalStatCell.alignment = { horizontal: 'center', vertical: 'middle' };
            totalStatCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFD14A2D' } };
            totalStatCell.border = {
              top: { style: 'thin' },
              bottom: { style: 'thin' },
              left: { style: 'thin' },
              right: { style: 'thin' }
            };
            currentCol++;
            
            // Banner groups
            groupStructure.forEach((group) => {
              const groupStartCol = currentCol;
              const groupCell = dataCutsWorksheet.getRow(groupTitleRow).getCell(groupStartCol);
              groupCell.value = group.title;
              groupCell.alignment = { horizontal: 'center', vertical: 'middle' };
              groupCell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
              groupCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFD14A2D' } };
              groupCell.border = {
                top: { style: 'thin' },
                bottom: { style: 'thin' },
                left: { style: 'thin' },
                right: { style: 'thin' }
              };
              if (group.cutCount > 1) {
                dataCutsWorksheet.mergeCells(groupTitleRow, groupStartCol, groupTitleRow, groupStartCol + group.cutCount - 1);
              }
              for (let i = 0; i < group.cutCount; i++) {
                const cutCol = groupStartCol + i;
                const bannerCol = bannerCols[group.startIdx + i];
                const cutCell = dataCutsWorksheet.getRow(cutTitleRow).getCell(cutCol);
                cutCell.value = bannerCol.title;
                cutCell.alignment = { horizontal: 'center', vertical: 'middle' };
                cutCell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
                cutCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFD14A2D' } };
                cutCell.border = {
                  top: { style: 'thin' },
                  bottom: { style: 'thin' },
                  left: { style: 'thin' },
                  right: { style: 'thin' }
                };
                const statCell = dataCutsWorksheet.getRow(statLetterRow).getCell(cutCol);
                const statLetter = String.fromCharCode(65 + group.startIdx + i);
                statCell.value = `(${statLetter})`;
                statCell.alignment = { horizontal: 'center', vertical: 'middle' };
                statCell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
                statCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFD14A2D' } };
                statCell.border = {
                  top: { style: 'thin' },
                  bottom: { style: 'thin' },
                  left: { style: 'thin' },
                  right: { style: 'thin' }
                };
              }
              currentCol += group.cutCount;
            });
            currentRow += 3;
            
            // Base row
            const baseRow = dataCutsWorksheet.getRow(currentRow++);
            baseRow.getCell(2).value = 'Base (total responding):';
            baseRow.getCell(2).font = { bold: true };
            baseRow.getCell(2).fill = {
              type: 'pattern',
              pattern: 'solid',
              fgColor: { argb: 'FFE8E8E8' }
            };
            baseRow.getCell(2).border = {
              top: { style: 'thin' },
              bottom: { style: 'thin' },
              left: { style: 'thin' },
              right: { style: 'thin' }
            };
            baseRow.getCell(3).value = totalBase;
            baseRow.getCell(3).alignment = { horizontal: 'center' };
            baseRow.getCell(3).fill = {
              type: 'pattern',
              pattern: 'solid',
              fgColor: { argb: 'FFE8E8E8' }
            };
            baseRow.getCell(3).border = {
              top: { style: 'thin' },
              bottom: { style: 'thin' },
              left: { style: 'thin' },
              right: { style: 'thin' }
            };
            let baseCol = 4;
            bannerCols.forEach(bannerCol => {
              baseRow.getCell(baseCol).value = cutBases[bannerCol.id] || 0;
              baseRow.getCell(baseCol).alignment = { horizontal: 'center' };
              baseRow.getCell(baseCol).fill = {
                type: 'pattern',
                pattern: 'solid',
                fgColor: { argb: 'FFE8E8E8' }
              };
              baseRow.getCell(baseCol).border = {
                top: { style: 'thin' },
                bottom: { style: 'thin' },
                left: { style: 'thin' },
                right: { style: 'thin' }
              };
              baseCol++;
            });
            
            // Render frequency distribution rows using data from calculateBannerTableDataForVariable
            sortedNumericValues.forEach(numVal => {
              const valueKey = numVal.toString();
              const valueData = numericData[valueKey];
              if (!valueData) return;
              
              // Count row
              const countRow = dataCutsWorksheet.getRow(currentRow++);
              countRow.getCell(2).value = numVal;
              countRow.getCell(2).border = {
                top: { style: 'thin' },
                bottom: { style: 'thin' },
                left: { style: 'thin' },
                right: { style: 'thin' }
              };
              
              // Total count
              const totalCount = valueData['total']?.count || 0;
              countRow.getCell(3).value = totalCount;
              countRow.getCell(3).alignment = { horizontal: 'center' };
              countRow.getCell(3).border = {
                top: { style: 'thin' },
                bottom: { style: 'thin' },
                left: { style: 'thin' },
                right: { style: 'thin' }
              };
              
              // Banner cut counts
              let col = 4;
              bannerCols.forEach(bannerCol => {
                const cutCount = valueData[bannerCol.id]?.count || 0;
                countRow.getCell(col).value = cutCount;
                countRow.getCell(col).alignment = { horizontal: 'center' };
                countRow.getCell(col).border = {
                  top: { style: 'thin' },
                  bottom: { style: 'thin' },
                  left: { style: 'thin' },
                  right: { style: 'thin' }
                };
                col++;
              });
              
              // Percentage row
              const pctRow = dataCutsWorksheet.getRow(currentRow++);
              pctRow.getCell(2).value = '';
              pctRow.getCell(2).border = {
                top: { style: 'thin' },
                bottom: { style: 'thin' },
                left: { style: 'thin' },
                right: { style: 'thin' }
              };
              
              // Total percentage (already calculated in calculateBannerTableDataForVariable)
              const totalPct = valueData['total']?.percentage || 0;
              pctRow.getCell(3).value = totalPct / 100;
              pctRow.getCell(3).numFmt = percentageDecimals === 0 ? '0%' : percentageDecimals === 1 ? '0.0%' : '0.00%';
              pctRow.getCell(3).alignment = { horizontal: 'center' };
              pctRow.getCell(3).border = {
                top: { style: 'thin' },
                bottom: { style: 'thin' },
                left: { style: 'thin' },
                right: { style: 'thin' }
              };
              
              // Banner cut percentages (already calculated in calculateBannerTableDataForVariable)
              col = 4;
              bannerCols.forEach(bannerCol => {
                const cutPct = valueData[bannerCol.id]?.percentage || 0;
                pctRow.getCell(col).value = cutPct / 100;
                pctRow.getCell(col).numFmt = percentageDecimals === 0 ? '0%' : percentageDecimals === 1 ? '0.0%' : '0.00%';
                pctRow.getCell(col).alignment = { horizontal: 'center' };
                pctRow.getCell(col).border = {
                  top: { style: 'thin' },
                  bottom: { style: 'thin' },
                  left: { style: 'thin' },
                  right: { style: 'thin' }
                };
                col++;
              });
            });
            
            // Add stats rows if enabled
            const statsKey = variable.name;
            const statsSelections = getStatsSelectionsForVariable(statsKey);
            if (isNumeric && Object.values(statsSelections).some(v => v)) {
              // Calculate stats from frequency distribution
              let totalCount = 0;
              let sum = 0;
              let sumSquares = 0;
              let min = Infinity;
              let max = -Infinity;
              let modeValue: number | null = null;
              let modeCount = -1;
              
              sortedNumericValues.forEach(numVal => {
                const valueKey = numVal.toString();
                const count = numericData[valueKey]?.['total']?.count || 0;
                totalCount += count;
                sum += numVal * count;
                sumSquares += numVal * numVal * count;
                if (numVal < min) min = numVal;
                if (numVal > max) max = numVal;
                if (count > modeCount) {
                  modeCount = count;
                  modeValue = numVal;
                }
              });
              
              if (totalCount > 0) {
                const mean = sum / totalCount;
                const variance = Math.max(sumSquares / totalCount - mean * mean, 0);
                const stdDev = Math.sqrt(variance);
                const sorted = [...sortedNumericValues];
                const median = sorted.length % 2 === 0
                  ? (sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2
                  : sorted[Math.floor(sorted.length / 2)];
                
                const statsRows = [
                  { label: 'Mean', key: 'mean', value: mean },
                  { label: 'Sum', key: 'sum', value: sum },
                  { label: 'Median', key: 'median', value: median },
                  { label: 'Mode', key: 'mode', value: modeValue },
                  { label: 'Std Dev', key: 'stdDev', value: stdDev },
                  { label: 'Min', key: 'min', value: min },
                  { label: 'Max', key: 'max', value: max },
                ];
                
                statsRows.forEach(stat => {
                  if (statsSelections[stat.key]) {
                    const statRow = dataCutsWorksheet.getRow(currentRow++);
                    statRow.getCell(2).value = stat.label + ':';
                    statRow.getCell(2).font = { bold: true, italic: true };
                    statRow.getCell(2).fill = {
                      type: 'pattern',
                      pattern: 'solid',
                      fgColor: { argb: 'FFE8E8E8' }
                    };
                    statRow.getCell(2).border = {
                      top: { style: 'thin' },
                      bottom: { style: 'thin' },
                      left: { style: 'thin' },
                      right: { style: 'thin' }
                    };
                    
                    // Total stat value
                    statRow.getCell(3).value = stat.value;
                    statRow.getCell(3).numFmt = stat.key === 'sum' ? '0' : '0.00';
                    statRow.getCell(3).alignment = { horizontal: 'center' };
                    statRow.getCell(3).fill = {
                      type: 'pattern',
                      pattern: 'solid',
                      fgColor: { argb: 'FFE8E8E8' }
                    };
                    statRow.getCell(3).border = {
                      top: { style: 'thin' },
                      bottom: { style: 'thin' },
                      left: { style: 'thin' },
                      right: { style: 'thin' }
                    };
                    
                    // Banner cut stats (calculate per cut)
                    let col = 4;
                    bannerCols.forEach(bannerCol => {
                      const cutBase = cutBases[bannerCol.id] || 0;
                      let cutStatValue: number = 0;
                      
                      if (cutBase > 0) {
                        if (stat.key === 'mean') {
                          let cutSum = 0;
                          sortedNumericValues.forEach(numVal => {
                            const valueKey = numVal.toString();
                            cutSum += numVal * (numericData[valueKey]?.[bannerCol.id]?.count || 0);
                          });
                          cutStatValue = cutSum / cutBase;
                        } else if (stat.key === 'sum') {
                          sortedNumericValues.forEach(numVal => {
                            const valueKey = numVal.toString();
                            cutStatValue += numVal * (numericData[valueKey]?.[bannerCol.id]?.count || 0);
                          });
                        } else if (stat.key === 'median') {
                          const cutValues: number[] = [];
                          sortedNumericValues.forEach(numVal => {
                            const valueKey = numVal.toString();
                            const count = numericData[valueKey]?.[bannerCol.id]?.count || 0;
                            for (let i = 0; i < count; i++) {
                              cutValues.push(numVal);
                            }
                          });
                          cutValues.sort((a, b) => a - b);
                          cutStatValue = cutValues.length % 2 === 0
                            ? (cutValues[cutValues.length / 2 - 1] + cutValues[cutValues.length / 2]) / 2
                            : cutValues[Math.floor(cutValues.length / 2)];
                        } else if (stat.key === 'mode') {
                          let cutModeCount = -1;
                          sortedNumericValues.forEach(numVal => {
                            const valueKey = numVal.toString();
                            const count = numericData[valueKey]?.[bannerCol.id]?.count || 0;
                            if (count > cutModeCount) {
                              cutModeCount = count;
                              cutStatValue = numVal;
                            }
                          });
                        } else if (stat.key === 'stdDev') {
                          let cutSum = 0;
                          let cutSumSquares = 0;
                          sortedNumericValues.forEach(numVal => {
                            const valueKey = numVal.toString();
                            const count = numericData[valueKey]?.[bannerCol.id]?.count || 0;
                            cutSum += numVal * count;
                            cutSumSquares += numVal * numVal * count;
                          });
                          const cutMean = cutSum / cutBase;
                          const cutVariance = Math.max(cutSumSquares / cutBase - cutMean * cutMean, 0);
                          cutStatValue = Math.sqrt(cutVariance);
                        } else if (stat.key === 'min') {
                          cutStatValue = Infinity;
                          sortedNumericValues.forEach(numVal => {
                            const valueKey = numVal.toString();
                            if ((numericData[valueKey]?.[bannerCol.id]?.count || 0) > 0 && numVal < cutStatValue) {
                              cutStatValue = numVal;
                            }
                          });
                        } else if (stat.key === 'max') {
                          cutStatValue = -Infinity;
                          sortedNumericValues.forEach(numVal => {
                            const valueKey = numVal.toString();
                            if ((numericData[valueKey]?.[bannerCol.id]?.count || 0) > 0 && numVal > cutStatValue) {
                              cutStatValue = numVal;
                            }
                          });
                        }
                      }
                      
                      statRow.getCell(col).value = cutStatValue;
                      statRow.getCell(col).numFmt = stat.key === 'sum' ? '0' : '0.00';
                      statRow.getCell(col).alignment = { horizontal: 'center' };
                      statRow.getCell(col).fill = {
                        type: 'pattern',
                        pattern: 'solid',
                        fgColor: { argb: 'FFE8E8E8' }
                      };
                      statRow.getCell(col).border = {
                        top: { style: 'thin' },
                        bottom: { style: 'thin' },
                        left: { style: 'thin' },
                        right: { style: 'thin' }
                      };
                      col++;
                    });
                  }
                });
              }
            }
            
            tableNumber++;
            continue;
          }
          
          // Get response codes from banner table data or statements (for grid columns)
          const isMultiSelectQuestionForCodes = variable.type?.toLowerCase().includes('multi-select') && !variable.type?.toLowerCase().includes('grid');
          let responseCodes: string[] = (() => {
            if (isMultiSelectGridColumnTable) {
              if (variable.statements && Object.keys(variable.statements).length > 0) {
                return Object.keys(variable.statements);
              }
              return Object.keys(activeGridColumnData || {});
            }
            // For multi-select questions, also check variable.codes if bannerTableData is empty
            const codes = Object.keys(bannerTableData).filter(key => key !== 'total');
            if (codes.length === 0 && isMultiSelectQuestionForCodes && variable.codes && Object.keys(variable.codes).length > 0) {
              // Fall back to variable.codes if bannerTableData is empty
              const fallbackCodes = Object.keys(variable.codes);
              if (isB8Debug) {
                appendStatLog('[B8] Using fallback codes from variable.codes', {
                  variableName: variable.name,
                  fallbackCodes,
                  fallbackCodesLength: fallbackCodes.length
                });
              }
              return fallbackCodes;
            }
            // Debug for B8 only
            if (isB8Debug) {
              appendStatLog('[B8] Getting response codes', {
                variableName: variable.name,
                variableType: variable.type,
                isMultiSelectQuestion: isMultiSelectQuestionForCodes,
                bannerTableDataKeys: Object.keys(bannerTableData),
                codesReturned: codes,
                codesLength: codes.length,
                bannerTableDataEmpty: !bannerTableData || Object.keys(bannerTableData).length === 0,
                variableCodesKeys: variable.codes ? Object.keys(variable.codes) : [],
                firstCodeSample: codes.length > 0 ? getCodeDataForRow(codes[0]) : 'no codes'
              });
            }
            return codes;
          })();

          // Sort codes by frequency if enabled
          const isSortedByFrequency = getEffectiveSortByFrequency(variable);
          if (isSortedByFrequency) {
            responseCodes.sort((a, b) => {
              const aTotal = getCodeDataForRow(a)?.['total']?.count || 0;
              const bTotal = getCodeDataForRow(b)?.['total']?.count || 0;
              return bTotal - aTotal;
            });
            responseCodes = applyHoldOrdering(responseCodes, variable.name, code => code);
          }

          // Check for nets (will be added after response rows, before stats)
          const netCodes = isMultiSelectGridColumnTable ? [] : (netSummaryTableSelectedCodes[variable.name] || []);
          const firstEntry = Object.entries(isMultiSelectGridColumnTable ? (activeGridColumnData || {}) : bannerTableData)[0];

          // Calculate stat letters for all codes before rendering (for regular Single/Multi Select tables)
          const allStatLettersRegular: Record<string, Record<number, { letter: string; is95: boolean }[]>> = {};
          const isS6DebugRegular = variable.name === 'S6';

          if (isS6DebugRegular && shouldDebugStats()) {
            appendStatLog('[S6] ≡ƒÜÇ Starting stat letter calculation', {
              variable: variable.name,
              type: variable.type,
              totalBase,
              codesCount: responseCodes.length
            });

            // Show cutBases for debugging
            const cutBasesInfo: Record<string, any> = {};
            bannerCols.forEach((col, idx) => {
              cutBasesInfo[`col${idx}_${col.title}`] = cutBases[col.id] || 0;
            });
            appendStatLog('[S6] ≡ƒôè cutBases', cutBasesInfo);
          }

          responseCodes.forEach(code => {
            const codeData = getCodeDataForRow(code);
            const totalPct = codeData['total']?.percentage || 0;
            const totalCount = codeData['total']?.count || 0;

            if (isS6DebugRegular && shouldDebugStats()) {
              appendStatLog('[S6] ≡ƒôè Processing code', {
                code,
                label: getRowLabelForCode(code),
                totalPct,
                totalCount,
                totalBase
              });
            }

            const codeStatLetters: Record<number, { letter: string; is95: boolean }[]> = {};

            bannerCols.forEach((thisCol, colIdx) => {
              const thisPct = codeData[thisCol.id]?.percentage || 0;
              const thisCount = codeData[thisCol.id]?.count || 0;
              const thisBase = cutBases[thisCol.id] || 0;

              const statLettersForCol: { letter: string; is95: boolean }[] = [];

              // Within-group comparisons ONLY
              bannerCols.forEach((otherCol, otherIdx) => {
                if (otherIdx === colIdx) return;
                if (otherCol.groupIdx !== thisCol.groupIdx) return;

                const otherPct = codeData[otherCol.id]?.percentage || 0;
                const otherBase = cutBases[otherCol.id] || 0;

                if (thisPct > otherPct) {
                  const { is95, is90 } = isSignificant(thisPct, thisBase, otherPct, otherBase);

                  if (isS6DebugRegular && shouldDebugStats()) {
                    appendStatLog('[S6] Γ£à within-group comparison', {
                      code,
                      thisCol: thisCol.title,
                      otherCol: otherCol.title,
                      thisPct,
                      thisBase,
                      otherPct,
                      otherBase,
                      is95,
                      is90,
                      letterWouldBe: String.fromCharCode(65 + otherIdx)
                    });
                  }

                  if (significanceLevel === 95) {
                    if (is95) statLettersForCol.push({ letter: String.fromCharCode(65 + otherIdx), is95: true });
                  } else {
                    if (is95) {
                      statLettersForCol.push({ letter: String.fromCharCode(65 + otherIdx), is95: true });
                    } else if (is90) {
                      statLettersForCol.push({ letter: String.fromCharCode(97 + otherIdx), is95: false });
                    }
                  }
                }
              });

              codeStatLetters[colIdx] = statLettersForCol;
            });

            allStatLettersRegular[code] = codeStatLetters;

            if (isS6DebugRegular && shouldDebugStats()) {
              const letterStrings: Record<string, string> = {};
              let hasAnyLetters = false;
              Object.keys(codeStatLetters).forEach(k => {
                const letters = codeStatLetters[Number(k)] || [];
                const letterStr = letters.map(l => l.letter).join('');
                if (letterStr) {
                  letterStrings[`col${k}_${bannerCols[Number(k)]?.title}`] = letterStr;
                  hasAnyLetters = true;
                }
              });
              if (hasAnyLetters) {
                appendStatLog(`[S6] Γ£à Stat letters found for code ${code}`, letterStrings);
              } else {
                appendStatLog(`[S6] Γ¥î NO stat letters for code ${code}`, { code, label: getRowLabelForCode(code) });
              }
            }
          });

          // Add regular response rows (count + percentage rows for each response)
          // Ensure we have codes to write - if responseCodes is empty but variable has codes, use them
          if (responseCodes.length === 0 && isMultiSelectQuestionForCodes && variable.codes && Object.keys(variable.codes).length > 0) {
            responseCodes = Object.keys(variable.codes);
            if (isB8Debug) {
              appendStatLog('[B8] Using variable.codes as fallback for responseCodes', {
                variableName: variable.name,
                responseCodes: responseCodes
              });
            }
          }
          
          responseCodes.forEach(code => {
            const codeData = getCodeDataForRow(code);
            const codeLabel = getRowLabelForCode(code);

            // Count row
            const countRow = dataCutsWorksheet.getRow(currentRow++);
            countRow.getCell(2).value = codeLabel;
            countRow.getCell(2).border = {
              top: { style: 'thin' },
              bottom: { style: 'thin' },
              left: { style: 'thin' },
              right: { style: 'thin' }
            };

            // Total count
            const totalCount = codeData['total']?.count || 0;
            countRow.getCell(3).value = totalCount;
            countRow.getCell(3).alignment = { horizontal: 'center' };
            countRow.getCell(3).border = {
              top: { style: 'thin' },
              bottom: { style: 'thin' },
              left: { style: 'thin' },
              right: { style: 'thin' }
            };

            // Banner cut counts
            let col = 4;
            bannerCols.forEach((bannerCol, colIdx) => {
              const cutCount = codeData[bannerCol.id]?.count || 0;
              const countCell = countRow.getCell(col);
              countCell.value = cutCount;
              countCell.alignment = { horizontal: 'center' };

              // Add blue highlighting if this cell has stat letters
              const statLettersForCode = allStatLettersRegular[code] || {};
              const statLetters = statLettersForCode[colIdx] || [];
              if (statLetters.length > 0) {
                countCell.fill = {
                  type: 'pattern',
                  pattern: 'solid',
                  fgColor: { argb: 'FFE6F3FF' }
                };
              }

              countCell.border = {
                top: { style: 'thin' },
                bottom: { style: 'thin' },
                left: { style: 'thin' },
                right: { style: 'thin' }
              };
              col++;
            });

            // Percentage row
            const pctRow = dataCutsWorksheet.getRow(currentRow++);
            pctRow.getCell(2).value = '';
            pctRow.getCell(2).border = {
              top: { style: 'thin' },
              bottom: { style: 'thin' },
              left: { style: 'thin' },
              right: { style: 'thin' }
            };

            // Total percentage
            const totalPct = codeData['total']?.percentage || 0;
            const totalPctCell = pctRow.getCell(3);
            totalPctCell.value = totalPct / 100; // Store as decimal for percentage format
            totalPctCell.numFmt = percentageDecimals === 0 ? '0%' : percentageDecimals === 1 ? '0.0%' : '0.00%';
            totalPctCell.alignment = { horizontal: 'center' };
            totalPctCell.border = {
              top: { style: 'thin' },
              bottom: { style: 'thin' },
              left: { style: 'thin' },
              right: { style: 'thin' }
            };

            // Banner cut percentages
            col = 4;
            bannerCols.forEach((bannerCol, colIdx) => {
              const cutPct = codeData[bannerCol.id]?.percentage || 0;
              const cutPctCell = pctRow.getCell(col);
              cutPctCell.value = cutPct / 100; // Store as decimal for percentage format
              cutPctCell.numFmt = percentageDecimals === 0 ? '0%' : percentageDecimals === 1 ? '0.0%' : '0.00%';
              cutPctCell.alignment = { horizontal: 'center' };

              // Add blue highlighting if this cell has stat letters
              const statLettersForCode = allStatLettersRegular[code] || {};
              const statLetters = statLettersForCode[colIdx] || [];
              if (statLetters.length > 0) {
                cutPctCell.fill = {
                  type: 'pattern',
                  pattern: 'solid',
                  fgColor: { argb: 'FFE6F3FF' }
                };
              }

              cutPctCell.border = {
                top: { style: 'thin' },
                bottom: { style: 'thin' },
                left: { style: 'thin' },
                right: { style: 'thin' }
              };
              col++;
            });

            // Stat letters row (if any stat letters exist for this code)
            const statLettersForCode = allStatLettersRegular[code] || {};
            const hasAnyStatLettersForCode = Object.values(statLettersForCode).some(arr => arr && arr.length > 0);

            if (hasAnyStatLettersForCode) {
              const statRow = dataCutsWorksheet.getRow(currentRow++);
              statRow.getCell(2).value = '';
              statRow.getCell(2).border = {
                top: { style: 'thin' },
                bottom: { style: 'thin' },
                left: { style: 'thin' },
                right: { style: 'thin' }
              };

              // Total column - no stat letters for total
              statRow.getCell(3).value = '';
              statRow.getCell(3).border = {
                top: { style: 'thin' },
                bottom: { style: 'thin' },
                left: { style: 'thin' },
                right: { style: 'thin' }
              };

              // Banner cut stat letters
              col = 4;
              bannerCols.forEach((bannerCol, colIdx) => {
                const statLetters = statLettersForCode[colIdx] || [];
                const statLettersStr = statLetters.map(s => s.letter).join('');
                const statCell = statRow.getCell(col);
                statCell.value = statLettersStr;
                statCell.alignment = { horizontal: 'center', vertical: 'middle' };
                if (statLetters.length > 0) {
                  statCell.fill = {
                    type: 'pattern',
                    pattern: 'solid',
                    fgColor: { argb: 'FFE6F3FF' }
                  };
                }
                statCell.border = {
                  top: { style: 'thin' },
                  bottom: { style: 'thin' },
                  left: { style: 'thin' },
                  right: { style: 'thin' }
                };
                col++;
              });
            }
          });

          // Calculate stat letters for nets before rendering
          const allStatLettersNets: Record<string, Record<number, { letter: string; is95: boolean }[]>> = {};

          netCodes.forEach(net => {
            if (net.codes && net.codes.length > 0) {
              // Calculate net totals
              let netTotalCount = 0;
              const netCutCounts: Record<string, number> = {};
              bannerCols.forEach(col => { netCutCounts[col.id] = 0; });

              net.codes.forEach(code => {
                const codeData = getCodeDataForRow(code);
                if (codeData) {
                  netTotalCount += codeData['total']?.count || 0;
                  bannerCols.forEach(col => {
                    netCutCounts[col.id] += codeData[col.id]?.count || 0;
                  });
                }
              });

              // Calculate stat letters for this net
              const codeStatLetters: Record<number, { letter: string; is95: boolean }[]> = {};

              bannerCols.forEach((thisCol, colIdx) => {
                const thisCount = netCutCounts[thisCol.id] || 0;
                const thisBase = cutBases[thisCol.id] || 0;
                const thisPct = thisBase > 0 ? (thisCount / thisBase) * 100 : 0;
                const statLettersForCol: { letter: string; is95: boolean }[] = [];

                // Within-group comparisons ONLY
                bannerCols.forEach((otherCol, otherIdx) => {
                  if (otherIdx === colIdx) return;
                  if (otherCol.groupIdx !== thisCol.groupIdx) return;

                  const otherCount = netCutCounts[otherCol.id] || 0;
                  const otherBase = cutBases[otherCol.id] || 0;
                  const otherPct = otherBase > 0 ? (otherCount / otherBase) * 100 : 0;

                  if (thisPct > otherPct) {
                    const { is95, is90 } = isSignificant(thisPct, thisBase, otherPct, otherBase);

                    if (significanceLevel === 95) {
                      if (is95) statLettersForCol.push({ letter: String.fromCharCode(65 + otherIdx), is95: true });
                    } else {
                      if (is95) {
                        statLettersForCol.push({ letter: String.fromCharCode(65 + otherIdx), is95: true });
                      } else if (is90) {
                        statLettersForCol.push({ letter: String.fromCharCode(97 + otherIdx), is95: false });
                      }
                    }
                  }
                });

                codeStatLetters[colIdx] = statLettersForCol;
              });

              allStatLettersNets[net.name] = codeStatLetters;
            }
          });

          // Add net rows after response rows, before stats
          netCodes.forEach(net => {
            if (net.codes && net.codes.length > 0) {
              // Count row
              const countRow = dataCutsWorksheet.getRow(currentRow++);
              countRow.getCell(2).value = `NET: ${net.name}`;
              countRow.getCell(2).font = { bold: true };
              countRow.getCell(2).border = {
                top: { style: 'thin' },
                bottom: { style: 'thin' },
                left: { style: 'thin' },
                right: { style: 'thin' }
              };

              // Calculate net totals
              let netTotalCount = 0;
              const netCutCounts: Record<string, number> = {};
              bannerCols.forEach(col => { netCutCounts[col.id] = 0; });

              net.codes.forEach(code => {
                const codeData = getCodeDataForRow(code);
                if (codeData) {
                  netTotalCount += codeData['total']?.count || 0;
                  bannerCols.forEach(col => {
                    netCutCounts[col.id] += codeData[col.id]?.count || 0;
                  });
                }
              });

              // Total count
              countRow.getCell(3).value = netTotalCount;
              countRow.getCell(3).alignment = { horizontal: 'center' };
              countRow.getCell(3).border = {
                top: { style: 'thin' },
                bottom: { style: 'thin' },
                left: { style: 'thin' },
                right: { style: 'thin' }
              };

              // Banner cut counts
              let col = 4;
              bannerCols.forEach((bannerCol, colIdx) => {
                const countCell = countRow.getCell(col);
                countCell.value = netCutCounts[bannerCol.id];
                countCell.alignment = { horizontal: 'center' };

                // Add blue highlighting if this cell has stat letters
                const statLettersForCode = allStatLettersNets[net.name] || {};
                const statLetters = statLettersForCode[colIdx] || [];
                if (statLetters.length > 0) {
                  countCell.fill = {
                    type: 'pattern',
                    pattern: 'solid',
                    fgColor: { argb: 'FFE6F3FF' }
                  };
                }

                countCell.border = {
                  top: { style: 'thin' },
                  bottom: { style: 'thin' },
                  left: { style: 'thin' },
                  right: { style: 'thin' }
                };
                col++;
              });

              // Percentage row
              const pctRow = dataCutsWorksheet.getRow(currentRow++);
              pctRow.getCell(2).value = '';
              pctRow.getCell(2).border = {
                top: { style: 'thin' },
                bottom: { style: 'thin' },
                left: { style: 'thin' },
                right: { style: 'thin' }
              };

              // Total percentage
              const totalPct = totalBase > 0 ? (netTotalCount / totalBase) * 100 : 0;
              const totalPctCell = pctRow.getCell(3);
              totalPctCell.value = totalPct / 100; // Store as decimal for percentage format
              totalPctCell.numFmt = percentageDecimals === 0 ? '0%' : percentageDecimals === 1 ? '0.0%' : '0.00%';
              totalPctCell.alignment = { horizontal: 'center' };
              totalPctCell.border = {
                top: { style: 'thin' },
                bottom: { style: 'thin' },
                left: { style: 'thin' },
                right: { style: 'thin' }
              };

              // Banner cut percentages
              col = 4;
              bannerCols.forEach((bannerCol, colIdx) => {
                const cutPct = cutBases[bannerCol.id] > 0 ? (netCutCounts[bannerCol.id] / cutBases[bannerCol.id]) * 100 : 0;
                const cutPctCell = pctRow.getCell(col);
                cutPctCell.value = cutPct / 100; // Store as decimal for percentage format
                cutPctCell.numFmt = percentageDecimals === 0 ? '0%' : percentageDecimals === 1 ? '0.0%' : '0.00%';
                cutPctCell.alignment = { horizontal: 'center' };

                // Add blue highlighting if this cell has stat letters
                const statLettersForCode = allStatLettersNets[net.name] || {};
                const statLetters = statLettersForCode[colIdx] || [];
                if (statLetters.length > 0) {
                  cutPctCell.fill = {
                    type: 'pattern',
                    pattern: 'solid',
                    fgColor: { argb: 'FFE6F3FF' }
                  };
                }

                cutPctCell.border = {
                  top: { style: 'thin' },
                  bottom: { style: 'thin' },
                  left: { style: 'thin' },
                  right: { style: 'thin' }
                };
                col++;
              });

              // Stat letters row
              const statLettersForCode = allStatLettersNets[net.name] || {};
              const hasAnyStatLettersForCode = Object.values(statLettersForCode).some(arr => arr && arr.length > 0);

              if (hasAnyStatLettersForCode) {
                const statRow = dataCutsWorksheet.getRow(currentRow++);
                statRow.getCell(2).value = '';
                statRow.getCell(2).border = {
                  top: { style: 'thin' },
                  bottom: { style: 'thin' },
                  left: { style: 'thin' },
                  right: { style: 'thin' }
                };

                statRow.getCell(3).value = '';
                statRow.getCell(3).border = {
                  top: { style: 'thin' },
                  bottom: { style: 'thin' },
                  left: { style: 'thin' },
                  right: { style: 'thin' }
                };

                col = 4;
                bannerCols.forEach((bannerCol, colIdx) => {
                  const statLetters = statLettersForCode[colIdx] || [];
                  const statLettersStr = statLetters.map(s => s.letter).join('');
                  const statCell = statRow.getCell(col);
                  statCell.value = statLettersStr;
                  statCell.alignment = { horizontal: 'center', vertical: 'middle' };
                  if (statLetters.length > 0) {
                    statCell.fill = {
                      type: 'pattern',
                      pattern: 'solid',
                      fgColor: { argb: 'FFE6F3FF' }
                    };
                  }
                  statCell.border = {
                    top: { style: 'thin' },
                    bottom: { style: 'thin' },
                    left: { style: 'thin' },
                    right: { style: 'thin' }
                  };
                  col++;
                });
              }
            }
          });

          // Add stats rows if enabled
          const statsKey = variable.name;
          const statsSelections = getStatsSelectionsForVariable(statsKey);
          const isNumeric = variable.type?.toLowerCase().includes('numeric');
          const isSingleSelect = variable.type?.toLowerCase().includes('single select') &&
                                 !variable.type?.toLowerCase().includes('grid');

          // Numeric stats helper (for numeric questions)
          const getNumericStatsForColumn = (columnId: string): NumericStatsSummary | null => {
            if (!isNumeric) return null;
            const entries = Object.entries(bannerTableData || {});
            const numericEntries = entries
              .map(([valueKey, valueData]) => {
                const numericValue = parseFloat(valueKey);
                if (isNaN(numericValue)) return null;
                const columnData = columnId === 'total'
                  ? (valueData as any)['total']
                  : (valueData as any)[columnId];
                const count = columnData?.count || 0;
                return count > 0 ? { value: numericValue, count } : null;
              })
              .filter((entry): entry is { value: number; count: number } => !!entry)
              .sort((a, b) => a.value - b.value);
            if (!numericEntries.length) return null;

            let totalCount = 0;
            let sum = 0;
            let sumSquares = 0;
            let min = Infinity;
            let max = -Infinity;
            let modeValue: number | null = null;
            let modeCount = -1;

            numericEntries.forEach(({ value, count }) => {
              totalCount += count;
              sum += value * count;
              sumSquares += value * value * count;
              if (value < min) min = value;
              if (value > max) max = value;
              if (count > modeCount) {
                modeCount = count;
                modeValue = value;
              }
            });
            if (totalCount === 0) return null;

            const mean = sum / totalCount;
            const variance = Math.max(sumSquares / totalCount - mean * mean, 0);
            const stdDev = Math.sqrt(variance);

            const target1 = Math.floor((totalCount - 1) / 2);
            const target2 = Math.floor(totalCount / 2);
            let cumulative = 0;
            let medianVal1: number | null = null;
            let medianVal2: number | null = null;
            numericEntries.forEach(({ value, count }) => {
              const prev = cumulative;
              cumulative += count;
              if (medianVal1 === null && target1 < cumulative) {
                medianVal1 = value;
              }
              if (medianVal2 === null && target2 < cumulative) {
                medianVal2 = value;
              }
            });
            const median = totalCount % 2 === 0 && medianVal1 !== null && medianVal2 !== null
              ? (medianVal1 + medianVal2) / 2
              : (medianVal2 ?? medianVal1 ?? 0);

            let sumNoOutliers = sum;
            let meanNoOutliers = mean;
            if (stdDev > 0) {
              let filteredSum = 0;
              let filteredCount = 0;
              const threshold = 2 * stdDev;
              numericEntries.forEach(({ value, count }) => {
                if (Math.abs(value - mean) <= threshold) {
                  filteredSum += value * count;
                  filteredCount += count;
                }
              });
              if (filteredCount > 0) {
                sumNoOutliers = filteredSum;
                meanNoOutliers = filteredSum / filteredCount;
              }
            }

            return {
              sum,
              mean,
              median,
              mode: modeValue ?? 0,
              stdDev,
              max,
              min,
              meanNoOutliers,
              sumNoOutliers,
            };
          };
          const totalNumericStats = isNumeric ? getNumericStatsForColumn('total') : null;
          const cutNumericStats: Record<string, NumericStatsSummary | null> = {};
          if (isNumeric) {
            bannerCols.forEach(col => {
              cutNumericStats[col.id] = getNumericStatsForColumn(col.id);
            });
          }

          // Show stats for numeric questions OR single select questions (which can have numeric codes)
          if ((isNumeric || isSingleSelect) && Object.values(statsSelections).some(v => v)) {
            const STATS_GREY = 'FFE8E8E8'; // Lighter grey for base and stats rows
            
            // Define stats to show (exclude sum for single select)
            const statsToShow = [
              { key: 'sum', label: 'Sum', format: '0' },
              { key: 'mean', label: 'Mean', format: '0.00' },
              { key: 'meanNoOutliers', label: 'Mean (Outliers Removed)', format: '0.00' },
              { key: 'sumNoOutliers', label: 'Sum (Outliers Removed)', format: '0' },
              { key: 'median', label: 'Median', format: '0.00' },
              { key: 'mode', label: 'Mode', format: '0' },
              { key: 'stdDev', label: 'Std Dev', format: '0.00' },
              { key: 'max', label: 'Max', format: '0' },
              { key: 'min', label: 'Min', format: '0' }
            ].filter(stat => {
              // Exclude sum and sumNoOutliers for single select questions
              if (isSingleSelect && (stat.key === 'sum' || stat.key === 'sumNoOutliers')) {
                return false;
              }
              return true;
            });

            // Helper to calculate weighted mean for single select tables
            const calculateSingleSelectMean = (tableData: any, cutId?: string): number => {
              if (!tableData) return 0;

              let totalWeightedValue = 0;
              let totalCount = 0;

              const codes = variable.codes ? Object.keys(variable.codes) : Object.keys(tableData || {});

              codes.forEach(code => {
                const codeValue = getCodeValueForMean(variable, code);
                if (codeValue === null) {
                  return;
                }
                const codeEntry = tableData[code];
                const count = cutId ? (codeEntry?.[cutId]?.count || 0) : (codeEntry?.total?.count || 0);
                totalWeightedValue += codeValue * count;
                totalCount += count;
              });

              return totalCount > 0 ? totalWeightedValue / totalCount : 0;
            };

            // Add each selected stat as a row
            statsToShow.forEach(stat => {
              if (statsSelections[stat.key]) {
                const statRow = dataCutsWorksheet.getRow(currentRow++);

                // Stat label
                statRow.getCell(2).value = stat.label;
                statRow.getCell(2).font = { bold: true };
                statRow.getCell(2).fill = {
                  type: 'pattern',
                  pattern: 'solid',
                  fgColor: { argb: STATS_GREY }
                };
                statRow.getCell(2).border = {
                  top: { style: 'thin' },
                  bottom: { style: 'thin' },
                  left: { style: 'thin' },
                  right: { style: 'thin' }
                };

                // Calculate stat value for Total
                let totalStatValue: number;
                if (isNumeric) {
                  totalStatValue = totalNumericStats ? (totalNumericStats[stat.key as keyof typeof totalNumericStats] as number ?? 0) : 0;
                } else if (isSingleSelect && stat.key === 'mean') {
                  totalStatValue = calculateSingleSelectMean(bannerTableData);
                } else {
                  // Get from banner table data for numeric questions or other stats
                  totalStatValue = firstEntry && firstEntry[1] ? (firstEntry[1] as any)['total']?.[stat.key] || 0 : 0;
                }

                statRow.getCell(3).value = totalStatValue;
                statRow.getCell(3).numFmt = stat.format;
                statRow.getCell(3).alignment = { horizontal: 'center' };
                statRow.getCell(3).fill = {
                  type: 'pattern',
                  pattern: 'solid',
                  fgColor: { argb: STATS_GREY }
                };
                statRow.getCell(3).border = {
                  top: { style: 'thin' },
                  bottom: { style: 'thin' },
                  left: { style: 'thin' },
                  right: { style: 'thin' }
                };

                // Banner cut stats
                let col = 4;
                bannerCols.forEach(bannerCol => {
                  let cutStatValue: number;

                  if (isNumeric) {
                    const colStats = cutNumericStats[bannerCol.id];
                    cutStatValue = colStats ? (colStats[stat.key as keyof typeof colStats] as number ?? 0) : 0;
                  } else if (isSingleSelect && stat.key === 'mean') {
                    cutStatValue = calculateSingleSelectMean(bannerTableData, bannerCol.id);
                  } else {
                    // Get from banner table data
                    cutStatValue = firstEntry && firstEntry[1] ? (firstEntry[1] as any)[bannerCol.id]?.[stat.key] || 0 : 0;
                  }

                  statRow.getCell(col).value = cutStatValue;
                  statRow.getCell(col).numFmt = stat.format;
                  statRow.getCell(col).alignment = { horizontal: 'center' };
                  statRow.getCell(col).fill = {
                    type: 'pattern',
                    pattern: 'solid',
                    fgColor: { argb: STATS_GREY }
                  };
                  statRow.getCell(col).border = {
                    top: { style: 'thin' },
                    bottom: { style: 'thin' },
                    left: { style: 'thin' },
                    right: { style: 'thin' }
                  };
                  col++;
                });
              }
            });
          }

          // Add comparison groups details section
          // Build comparison groups string based on banner groups
          const groupMap = new Map<number, number[]>();
          bannerCols.forEach((col, idx) => {
            const groupIdx = col.groupIdx;
            if (!groupMap.has(groupIdx)) {
              groupMap.set(groupIdx, []);
            }
            groupMap.get(groupIdx)!.push(idx);
          });

          const comparisonGroups = Array.from(groupMap.values())
            .map(colIndices =>
              colIndices.map(idx => String.fromCharCode(65 + idx)).join('')
            )
            .join('/');

          // Comparison groups row
          const compGroupsRow = dataCutsWorksheet.getRow(currentRow++);
          compGroupsRow.getCell(2).value = `Comparison Groups: ${comparisonGroups}`;
          compGroupsRow.getCell(2).font = { size: 9, italic: true };

          // Uppercase explanation row
          const upperRow = dataCutsWorksheet.getRow(currentRow++);
          upperRow.getCell(2).value = 'Uppercase letters indicate significance at the 95% level.';
          upperRow.getCell(2).font = { size: 9, italic: true };

          // Lowercase explanation row (only if significance level is 90)
          if (significanceLevel === 90) {
            const lowerRow = dataCutsWorksheet.getRow(currentRow++);
            lowerRow.getCell(2).value = 'Lowercase letters indicate significance at the 90% level.';
            lowerRow.getCell(2).font = { size: 9, italic: true };
          }

          tableNumber++;
        }
      }

      // Set column widths for Data Cuts
      dataCutsWorksheet.getColumn(1).width = 5; // Empty column A
      dataCutsWorksheet.getColumn(2).width = 40; // Response labels
      dataCutsWorksheet.getColumn(3).width = 15; // Total column
      // Banner cut columns
      for (let i = 0; i < bannerCols.length; i++) {
        dataCutsWorksheet.getColumn(4 + i).width = 15;
      }

      // Populate Table of Contents
      // Set column widths: A: 2.29, B: 14.29, C: 39.29, D: 59.29
      // IMPORTANT: Set all column widths BEFORE positioning the logo
      tocWorksheet.getColumn(1).width = 2.29;
      tocWorksheet.getColumn(2).width = 14.29;
      tocWorksheet.getColumn(3).width = 39.29;
      tocWorksheet.getColumn(4).width = 59.29;
      
      // Merge cells B1:C3 for title and project name
      tocWorksheet.mergeCells(1, 2, 3, 3); // Merge B1:C3 (row 1-3, col 2-3)
      const titleBlockCell = tocWorksheet.getRow(1).getCell(2);
      const projectName = selectedProject?.name || '';
      
      // Use rich text to format title and project name differently
      if (projectName) {
        titleBlockCell.value = {
          richText: [
            { text: 'Table of Contents', font: { bold: true, size: 14 } },
            { text: '\n' },
            { text: projectName, font: { italic: true, size: 12, bold: false } }
          ]
        };
      } else {
        titleBlockCell.value = 'Table of Contents';
        titleBlockCell.font = { bold: true, size: 14 };
      }
      
      titleBlockCell.alignment = { 
        vertical: 'top', 
        horizontal: 'left',
        wrapText: true 
      };
      titleBlockCell.fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'FFFFFFFF' }
      };
      
      // Merge cells D1:D3 for logo
      tocWorksheet.mergeCells(1, 4, 3, 4); // Merge D1:D3 (row 1-3, col 4)
      const logoCell = tocWorksheet.getRow(1).getCell(4);
      logoCell.fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'FFFFFFFF' }
      };
      
      // Add logo to the merged cell D1:D3 (top right aligned)
      let logoImageId: number | null = null;
      try {
        const logoResponse = await fetch('/CogDashLogo.png');
        if (logoResponse.ok) {
          // Resize the image to target dimensions without heavy compression
          const logoBlob = await logoResponse.blob();
          const img = new Image();
          const imgUrl = URL.createObjectURL(logoBlob);
          
          await new Promise((resolve, reject) => {
            img.onload = resolve;
            img.onerror = reject;
            img.src = imgUrl;
          });
          
          // Create canvas to resize (not compress heavily)
          const canvas = document.createElement('canvas');
          const ctx = canvas.getContext('2d');
          if (!ctx) throw new Error('Could not get canvas context');
          
          // Set canvas size to target dimensions (2.02 x 0.52 inches at 96 DPI)
          const logoWidthPx = 2.02 * 96;
          const logoHeightPx = 0.52 * 96;
          canvas.width = logoWidthPx;
          canvas.height = logoHeightPx;
          
          // Use high-quality image rendering
          ctx.imageSmoothingEnabled = true;
          ctx.imageSmoothingQuality = 'high';
          
          // Draw and resize the image
          ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
          
          // Convert to PNG blob with high quality (minimal compression)
          const resizedBlob = await new Promise<Blob>((resolve, reject) => {
            canvas.toBlob((blob) => {
              if (blob) resolve(blob);
              else reject(new Error('Failed to resize image'));
            }, 'image/png', 1.0); // Maximum quality
          });
          
          URL.revokeObjectURL(imgUrl);
          
          // Convert resized blob to buffer
          const logoBuffer = await resizedBlob.arrayBuffer();
          const buffer = typeof Buffer !== 'undefined' 
            ? Buffer.from(logoBuffer) 
            : new Uint8Array(logoBuffer);
          
          logoImageId = workbook.addImage({
            buffer: buffer as any,
            extension: 'png',
          });
          
          // Position logo so its right edge aligns with the end of column D
          // Column widths: A: 2.29, B: 14.29, C: 39.29, D: 59.29
          // Total width to end of column D: 115.16 column units
          const colAWidth = tocWorksheet.getColumn(1).width || 2.29;
          const colBWidth = tocWorksheet.getColumn(2).width || 14.29;
          const colCWidth = tocWorksheet.getColumn(3).width || 39.29;
          const colDWidth = tocWorksheet.getColumn(4).width || 59.29;
          
          // ExcelJS positioning: ext.width is in pixels, col positioning uses column indices (can be fractional)
          // Excel column width: 1 unit = width of one character in default font (Calibri 11pt)
          // At 96 DPI: 1 column unit Γëê 7 pixels (this is the standard Excel conversion)
          
          // Calculate total pixel width to end of column D
          const totalWidthToEndOfDInColumnUnits = colAWidth + colBWidth + colCWidth + colDWidth;
          const totalWidthToEndOfDInPixels = totalWidthToEndOfDInColumnUnits * 7;
          
          // Calculate where the left edge of the logo should be (in pixels from start)
          const logoLeftEdgeInPixels = totalWidthToEndOfDInPixels - logoWidthPx;
          
          // Convert pixel position to column index
          // Column indices: A=0-1, B=1-2, C=2-3, D=3-4
          // Each column's pixel width = column width * 7
          let accumulatedPixels = 0;
          let leftEdgeCol = 0;
          
          // Check which column contains the left edge
          const colAPixels = colAWidth * 7;
          if (logoLeftEdgeInPixels <= accumulatedPixels + colAPixels) {
            // Logo starts in column A
            leftEdgeCol = 0 + (logoLeftEdgeInPixels - accumulatedPixels) / colAPixels;
          } else {
            accumulatedPixels += colAPixels;
            const colBPixels = colBWidth * 7;
            if (logoLeftEdgeInPixels <= accumulatedPixels + colBPixels) {
              // Logo starts in column B
              leftEdgeCol = 1 + (logoLeftEdgeInPixels - accumulatedPixels) / colBPixels;
            } else {
              accumulatedPixels += colBPixels;
              const colCPixels = colCWidth * 7;
              if (logoLeftEdgeInPixels <= accumulatedPixels + colCPixels) {
                // Logo starts in column C
                leftEdgeCol = 2 + (logoLeftEdgeInPixels - accumulatedPixels) / colCPixels;
              } else {
                accumulatedPixels += colCPixels;
                const colDPixels = colDWidth * 7;
                // Logo starts in column D
                leftEdgeCol = 3 + (logoLeftEdgeInPixels - accumulatedPixels) / colDPixels;
              }
            }
          }
          
          tocWorksheet.addImage(logoImageId, {
            tl: { col: leftEdgeCol, row: 0 }, // Top-left positioned so right edge aligns with col 4.0 (D/E border)
            ext: { width: logoWidthPx, height: logoHeightPx },
          });
        }
      } catch (err) {
        console.error('Error loading logo:', err);
      }
      
      // Set row heights for title block
      tocWorksheet.getRow(1).height = 20;
      tocWorksheet.getRow(2).height = 20;
      tocWorksheet.getRow(3).height = 20;
      
      let tocRow = 4; // Start at row 4 (rows 1-3 are title block)

      // TOC Headers
      const tocHeaderRow = tocWorksheet.getRow(tocRow++);
      tocHeaderRow.getCell(2).value = 'Table #'; // Shifted to column 2
      tocHeaderRow.getCell(3).value = 'Table Name'; // Shifted to column 3
      tocHeaderRow.getCell(4).value = 'Description'; // Shifted to column 4
      [2, 3, 4].forEach(col => {
        tocHeaderRow.getCell(col).font = { bold: true };
        tocHeaderRow.getCell(col).fill = {
          type: 'pattern',
          pattern: 'solid',
          fgColor: { argb: 'FFD14A2D' }
        };
        tocHeaderRow.getCell(col).font = { bold: true, color: { argb: 'FFFFFFFF' } };
        tocHeaderRow.getCell(col).border = {
          top: { style: 'thin' },
          bottom: { style: 'thin' },
          left: { style: 'thin' },
          right: { style: 'thin' }
        };
      });

      // TOC Entries with hyperlinks
      tablePositions.forEach(({ tableNumber, tableName, rowNumber, variable }) => {
        const tocEntryRow = tocWorksheet.getRow(tocRow++);

        // Table number with hyperlink
        tocEntryRow.getCell(2).value = { // Shifted to column 2
          text: `Table ${tableNumber}`,
          hyperlink: `#'Data Cuts'!A${rowNumber}`,
          tooltip: `Go to Table ${tableNumber}`
        };
        tocEntryRow.getCell(2).font = { color: { argb: 'FF0000FF' }, underline: true };
        tocEntryRow.getCell(2).fill = {
          type: 'pattern',
          pattern: 'solid',
          fgColor: { argb: 'FFFFFFFF' }
        };

        // Table name
        tocEntryRow.getCell(3).value = tableName; // Shifted to column 3
        tocEntryRow.getCell(3).fill = {
          type: 'pattern',
          pattern: 'solid',
          fgColor: { argb: 'FFFFFFFF' }
        };

        // Description
        const descriptionCell = tocEntryRow.getCell(4);
        descriptionCell.value = variable.description || variable.name; // Shifted to column 4
        descriptionCell.fill = {
          type: 'pattern',
          pattern: 'solid',
          fgColor: { argb: 'FFFFFFFF' }
        };

        // Column E - add space to stop text from overlapping
        tocEntryRow.getCell(5).value = ' ';
        tocEntryRow.getCell(5).fill = {
          type: 'pattern',
          pattern: 'solid',
          fgColor: { argb: 'FFFFFFFF' }
        };

        // Set borders only for columns 2-4 (not column E)
        [2, 3, 4].forEach(col => {
          tocEntryRow.getCell(col).border = {
            top: { style: 'thin' },
            bottom: { style: 'thin' },
            left: { style: 'thin' },
            right: { style: 'thin' }
          };
        });
      });

      // Set white fill for all cells in columns A-E (1-5) from row 1 to row after last table entry
      const lastTableRow = tocRow - 1; // Last row with table data
      const rowAfterLastTable = lastTableRow + 1; // Row after last table
      const headerRowNumber = tocHeaderRow.number;
      for (let rowNum = 1; rowNum <= rowAfterLastTable; rowNum++) {
        const row = tocWorksheet.getRow(rowNum);
        // Skip header row (it should stay red)
        if (rowNum !== headerRowNumber) {
          // Set white fill for columns 1-5 (A-E)
          for (let col = 1; col <= 5; col++) {
            const cell = row.getCell(col);
            cell.fill = {
              type: 'pattern',
              pattern: 'solid',
              fgColor: { argb: 'FFFFFFFF' }
            };
          }
        }
      }

      // Column widths already set above before logo positioning
      // Column E width left at default (don't change it)

      const sampleSize = fullRawData.rows.filter((row: any) => {
        const recordValue = row['record'] ?? row['respno'] ?? row['Record'] ?? row['Respno'] ?? row['RECORD'] ?? row['RESPNO'];
        return recordValue !== null && recordValue !== undefined && recordValue !== '' &&
               !(typeof recordValue === 'string' && recordValue.trim() === '');
      }).length;

      return { workbook, sampleSize, debugInfo: tableDebugInfo };
    } catch (error) {
      console.error('Error generating workbook:', error);
      throw error;
    }
  }, [fullRawData, variableStatsSelections, variableSortByFrequency, netSummaryTableSelectedCodes, netSummaryTableRanges, hiddenFromBanners, questionnaireQuestions, selectedQuestionnaire, columnMapping, newBannerGroups, calculateBannerTableDataForVariable, getTablesForVariable, getEffectiveSortByFrequency, applyHoldOrdering, formatPercentage, significanceLevel, selectedProject, percentageDecimals, showStatDebug, appendStatLog]);

  // Export banner tables to Excel
  const handleExportBannerToExcel = useCallback(async (bannerId: string) => {
    const bannerGroup = newBannerGroups.find(b => b.id === bannerId);
    if (!bannerGroup) {
      alert('Selected banner group not found.');
      return;
    }

    if (!variables.length) {
      alert('No variables available for export.');
      return;
    }

    setExportingBannerId(bannerId);

    try {
      // Use the same buildTabSpecsWorkbook function that generates the UI tables
      // This ensures the export matches exactly what's shown in the UI
      const { workbook } = await buildTabSpecsWorkbook(variables, bannerGroup);

      // Generate and download the file
      const buffer = await workbook.xlsx.writeBuffer();
      const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${bannerGroup.title.replace(/[^a-zA-Z0-9]/g, '_')}_Banner.xlsx`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (error) {
      console.error('Error exporting banner:', error);
      alert(`Failed to export banner: ${error instanceof Error ? error.message : 'Unknown error'}`);
    } finally {
      setExportingBannerId(null);
    }
  }, [newBannerGroups, variables, buildTabSpecsWorkbook]);

  const filteredActiveProjects = useMemo(() => filterProjectsByUser(quantActiveProjects), [filterProjectsByUser, quantActiveProjects]);
  const filteredArchivedProjects = useMemo(() => filterProjectsByUser(quantArchivedProjects), [filterProjectsByUser, quantArchivedProjects]);
  const displayProjects = activeTab === 'active' ? filteredActiveProjects : filteredArchivedProjects;

  const handleProjectClick = useCallback((project: any) => {
    setSelectedProject(project);
    setViewMode('project');
    loadQuestionnaires(project.id);
  }, [loadQuestionnaires]);

  const qnrNameById = useMemo(() => {
    const map: Record<string, string> = {};
    const all = []
      .concat(Array.isArray(allQuestionnaires) ? allQuestionnaires : [])
      .concat(Array.isArray(questionnaires) ? questionnaires : []);
    all.forEach((q: any) => {
      if (!q?.id) return;
      if (selectedProject?.id && String(q.projectId) !== String(selectedProject.id)) return;
      map[String(q.id)] = String(q.name || q.title || q.id);
    });
    return map;
  }, [allQuestionnaires, questionnaires, selectedProject?.id]);

  const buildAutoColumnMapping = useCallback((columns: string[]) => {
    const mapping: Record<string, string> = {};
    (columns || []).forEach((col) => {
      const trimmed = String(col || '').trim();
      if (!trimmed) return;
      mapping[trimmed] = trimmed;
      if (!/^Q/i.test(trimmed)) {
        mapping[`Q${trimmed}`] = trimmed;
      } else {
        mapping[trimmed.replace(/^Q/i, '')] = trimmed;
      }
    });
    return mapping;
  }, []);

  const openRawTabPlan = useCallback(async (plan: TabPlan) => {
    if (!plan?.id) return;
    // Make a synthetic questionnaire shell so the existing Tabs editor can function
    setSelectedQuestionnaire({
      id: `tabplan_${plan.id}`,
      name: plan.name,
      questions: [],
      projectId: selectedProject?.id,
    } as any);

    setQnrViewMode('variables');
    setViewMode('qnr');

    setLoadingFullRawData(true);
    setLoadingDatamap(true);
    setFullRawData(null);
    setDatamapData(null);
    setColumnMapping({});
    setQuestionnaireQuestions([]);

    try {
      const [dm, rd] = await Promise.all([
        getDatamap(plan.id),
        getRawData(plan.id),
      ]);

      setDatamapData(dm);
      setFullRawData({ columns: rd?.columns || [], rows: rd?.rows || [] });
      setColumnMapping(buildAutoColumnMapping(rd?.columns || []));

      const parsedQuestions = Array.isArray(dm?.parsedQuestions) ? dm.parsedQuestions : [];
      const inferredQuestions = parsedQuestions.map((pq: any) => {
        const rawNum = String(pq?.questionNumber || '').trim();
        const normalizedNum = rawNum.replace(/^Q/i, '');
        const responseCodes = Array.isArray(pq?.responseCodes) ? pq.responseCodes : [];
        const notes = Array.isArray(pq?.notes) ? pq.notes : [];

        // Use shared classifier so Data Map / Tab Specs / Variables are consistent
        const baseQuestionType = classifyDatamapQuestionType({
          responseType: pq?.responseType,
          responseCodes: pq?.responseCodes,
          responseOptions: pq?.responseOptions,
          statementOptions: pq?.statementOptions,
          notes: notes,
        });

        // Match Data Map display: numeric grids with explicit response options should appear as single select grids
        const rawOptions =
          (Array.isArray(pq?.responseCodes) && pq.responseCodes) ||
          (Array.isArray(pq?.responseOptions) && pq.responseOptions) ||
          (Array.isArray(pq?.statementOptions) && pq.statementOptions) ||
          [];

        const normalizedOptions: Array<{ code: string; label: string }> = rawOptions
          .map((opt: any, idx: number) => {
            if (opt == null) return null;
            if (typeof opt === 'string' || typeof opt === 'number') {
              return { code: String(opt), label: '' };
            }
            const code = opt.code ?? opt.value ?? idx + 1;
            const label = opt.label ?? opt.text ?? opt.name ?? '';
            return { code: String(code), label: String(label) };
          })
          .filter(Boolean) as Array<{ code: string; label: string }>;

        const isNumericGridWithResponseOptions =
          baseQuestionType === 'Numeric grid' && normalizedOptions.length > 0;

        const questionType = isNumericGridWithResponseOptions ? 'Single select grid' : baseQuestionType;

        // Generate tags based on classification
        const tags: string[] = [];
        const responseType = String(pq?.responseType || '').toLowerCase();
        const isNumericGrid = questionType === 'Numeric grid';
        const isNumeric = questionType === 'Numeric';
        const hasValues01 = responseType.match(/values?:\s*0\s*-\s*1/i);

        if (isNumericGrid || isNumeric) {
          if (hasValues01) {
            tags.push('%');
          } else {
            tags.push('Number');
          }
        }

        // Check for 7pt scale tag (Single select questions and single select grids)
        let optOutCode: string | null = null;
        if ((questionType === 'Single select' || questionType === 'Single select grid') && responseCodes.length >= 7) {
          const scaleDetection = detect7ptScale(responseCodes.map((c: any) => ({
            code: String(c?.code ?? ''),
            text: String(c?.text ?? c?.label ?? c?.code ?? ''),
          })));

          if (scaleDetection.hasScale) {
            tags.push('Scale (7pt)');
            optOutCode = scaleDetection.optOutCode;
          }
        }

        // For numeric grids and single select grids, convert notes to statementOptions if not already present
        const isSingleSelectGrid = questionType === 'Single select grid';
        let statementOptions: any[] = [];
        if ((isNumericGrid || isSingleSelectGrid) && notes.length > 0 && !pq?.statementOptions) {
          // Convert notes to statement options (each note is a row)
          // Remove bracketed prefixes like "[QS5r1c1] " from the text
          statementOptions = notes.map((note: string, idx: number) => {
            const cleanText = String(note).replace(/^\[.*?\]\s*/, '').trim();
            return {
              code: `r${idx + 1}`,
              text: cleanText,
            };
          });
        } else if (pq?.statementOptions) {
          // Also clean existing statementOptions
          statementOptions = pq.statementOptions.map((stmt: any) => {
            if (typeof stmt === 'string') {
              const cleanText = stmt.replace(/^\[.*?\]\s*/, '').trim();
              return cleanText;
            } else {
              const cleanText = String(stmt.text || stmt.label || '').replace(/^\[.*?\]\s*/, '').trim();
              return {
                ...stmt,
                text: cleanText,
              };
            }
          });
        }

        // Build response options (columns)
        let finalResponseOptions = responseCodes.map((c: any) => ({
          code: String(c?.code ?? ''),
          text: String(c?.text ?? c?.label ?? c?.code ?? ''),
        })).filter((c: any) => c.code || c.text);

        // For numeric grids without response options, create a default c1 column
        if (isNumericGrid && finalResponseOptions.length === 0) {
          const columnLabel = hasValues01 ? '%' : '#';
          finalResponseOptions = [{ code: 'c1', text: columnLabel }];
        }

        return {
          id: rawNum || normalizedNum,
          number: rawNum || normalizedNum,
          text: pq?.description || rawNum,
          // Keep "Type" (raw responseType) available for Data Map display/debugging
          responseType: pq?.responseType,
          type: questionType,
          notes: notes,
          tags: isNumericGridWithResponseOptions ? [] : tags,
          responseOptions: finalResponseOptions,
          statementOptions: statementOptions.length > 0 ? statementOptions : undefined,
          optOutCode: optOutCode,
        };
      });

      setQuestionnaireQuestions(inferredQuestions);
    } finally {
      setLoadingFullRawData(false);
      setLoadingDatamap(false);
    }
  }, [
    buildAutoColumnMapping,
    getDatamap,
    getRawData,
    selectedProject?.id,
    setColumnMapping,
    setDatamapData,
    setFullRawData,
    setLoadingDatamap,
    setLoadingFullRawData,
    setQnrViewMode,
    setQuestionnaireQuestions,
    setSelectedQuestionnaire,
    setViewMode,
  ]);

  // Load tab plans when a project is opened in Tabs
  useEffect(() => {
    if (viewMode !== 'project') return;
    if (!selectedProject?.id) return;
    listByProject(String(selectedProject.id)).catch(() => {});
  }, [viewMode, selectedProject?.id, listByProject]);

  // filteredVariables is now provided by the hook

  // Get column headers from raw data
  const columnHeaders = useMemo(() => {
    return fullRawData?.columns || [];
  }, [fullRawData]);

  const questionnaireQuestionsNoOe = useMemo(() => {
    return (questionnaireQuestions || []).filter((q: any) => {
      const qNum = q?.number || q?.id || '';
      const qType = q?.type || '';
      // Filter out OE tagged questions and ID questions
      return !isOeTaggedName(String(qNum)) && qType !== 'ID';
    });
  }, [questionnaireQuestions]);

  const variablesNoOe = useMemo(() => {
    return (variables || []).filter((v: any) => !isOeTaggedName(String(v?.name || '')));
  }, [variables]);

  const filteredVariablesNoOe = useMemo(() => {
    return (filteredVariables || []).filter((v: any) => !isOeTaggedName(String(v?.name || '')));
  }, [filteredVariables]);

  const variableHasSelectedTables = useCallback((variable: Variable) => {
    const varName = variable?.name || '';
    if (!varName) return false;

    // Direct match on variable name
    const directSelections = variableTableSelections[varName];
    if (directSelections && directSelections.size > 0) return true;

    // Check by base question number (with/without Q prefix)
    const base = getBaseQuestionNumber(varName);
    const normalizedBase = base ? base.replace(/^Q/, '') : '';
    const keysToCheck = [base, normalizedBase, normalizedBase ? `Q${normalizedBase}` : ''].filter(Boolean);
    for (const key of keysToCheck) {
      const selections = variableTableSelections[key];
      if (selections && selections.size > 0) return true;
    }

    // Fallback: see if any selected table IDs reference this variable/question
    for (const selections of Object.values(variableTableSelections || {})) {
      if (!selections || selections.size === 0) continue;
      for (const tableId of selections) {
        if (
          (varName && tableId.startsWith(varName)) ||
          (base && tableId.startsWith(base)) ||
          (normalizedBase && tableId.startsWith(normalizedBase)) ||
          (normalizedBase && tableId.startsWith(`Q${normalizedBase}`))
        ) {
          return true;
        }
      }
    }

    return false;
  }, [variableTableSelections]);

  const variablesWithSelectedTables = useMemo(() => {
    return variablesNoOe.filter(variableHasSelectedTables);
  }, [variablesNoOe, variableHasSelectedTables]);

  const filteredVariablesWithSelectedTables = useMemo(() => {
    return filteredVariablesNoOe.filter(variableHasSelectedTables);
  }, [filteredVariablesNoOe, variableHasSelectedTables]);

  useEffect(() => {
    if (selectedVariable && isOeTaggedName(String(selectedVariable))) {
      setSelectedVariable(null);
    }
  }, [selectedVariable]);

  useEffect(() => {
    if (!selectedVariable) return;
    const stillVisible = variablesWithSelectedTables.some((v) => v.name === selectedVariable);
    if (!stillVisible) {
      setSelectedVariable(null);
    }
  }, [selectedVariable, variablesWithSelectedTables, setSelectedVariable]);

  // Convert questionnaire questions to variables when questions or column headers change
  // This ensures variables are created for all questions, even if data hasn't been uploaded
  useEffect(() => {
    if (questionnaireQuestionsNoOe.length > 0 && convertQuestionsToVariables) {
      convertQuestionsToVariables(questionnaireQuestionsNoOe, columnHeaders);
    }
  }, [questionnaireQuestionsNoOe, columnHeaders, convertQuestionsToVariables]);

  // Initialize default table selections and stats selections for all variables after they're created
  useEffect(() => {
    if (variablesNoOe.length === 0) return;

    const newTableSelections: Record<string, Set<string>> = {};
    const newStatsSelections: Record<string, any> = {};
    const newNetSummaryTableSelectedCodes: Record<string, Array<{ name: string; codes: string[] }>> = {};

    variablesNoOe.forEach(variable => {
      const variableName = variable.name;

      // Skip if we've already initialized defaults for this variable
      if (defaultSelectionsInitializedRef.current.has(variableName)) return;

      // Get default table selections for this variable
      const defaultTableSelections = getDefaultTableSelectionsForVariable(
        variable,
        questionnaireQuestions
      );

      if (defaultTableSelections.size > 0) {
        newTableSelections[variableName] = defaultTableSelections;
      }

      // Get default stats selections for this variable
      const defaultStats = getDefaultStatsSelectionsForVariable(variable);
      const hasDefaultStats = Object.values(defaultStats).some(v => v === true);

      if (hasDefaultStats) {
        newStatsSelections[variableName] = defaultStats;
      }

      // Create default 7pt scale nets for single select grids with "Scale (7pt)" tag
      const varTypeLower = variable.type?.toLowerCase() || '';
      const isSingleSelectGrid = varTypeLower.includes('single select grid');

      if (isSingleSelectGrid) {
        const varTags = (variable as any)?.tags || [];
        const hasScale7ptTag = varTags.some((tag: string) => /Scale\s*\(7pt\)/i.test(tag));

        if (hasScale7ptTag) {
          // Get response options for this variable
          const varResponseOptions: Array<{ code: string; text: string }> = [];

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

          if (varResponseOptions.length >= 7) {
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

            const top2BoxCodes = [getCodeForIndex(5), getCodeForIndex(6)];
            const middle3BoxCodes = [getCodeForIndex(2), getCodeForIndex(3), getCodeForIndex(4)];
            const bottom2BoxCodes = [getCodeForIndex(0), getCodeForIndex(1)];

            newNetSummaryTableSelectedCodes[variableName] = [
              { name: 'Top 2 Box', codes: top2BoxCodes },
              { name: 'Middle 3 Box', codes: middle3BoxCodes },
              { name: 'Bottom 2 Box', codes: bottom2BoxCodes },
            ];

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

      // Mark as initialized
      if (defaultTableSelections.size > 0 || hasDefaultStats || newTableSelections[variableName]?.size > 0) {
        defaultSelectionsInitializedRef.current.add(variableName);
      }
    });

    // Apply all default table selections at once
    if (Object.keys(newTableSelections).length > 0) {
      setVariableTableSelections(prev => {
        // Only add if the variable doesn't already have selections
        const finalSelections: Record<string, Set<string>> = {};
        Object.entries(newTableSelections).forEach(([varName, selections]) => {
          if (!prev[varName] || prev[varName].size === 0) {
            finalSelections[varName] = selections;
          }
        });

        if (Object.keys(finalSelections).length === 0) return prev;

        return {
          ...prev,
          ...finalSelections,
        };
      });
    }

    // Apply all default stats selections at once
    if (Object.keys(newStatsSelections).length > 0) {
      setVariableStatsSelections(prev => {
        // Only add if the variable doesn't already have stats selections
        const finalStats: Record<string, any> = {};
        Object.entries(newStatsSelections).forEach(([varName, stats]) => {
          if (!prev[varName]) {
            finalStats[varName] = stats;
          }
        });

        if (Object.keys(finalStats).length === 0) return prev;

        return {
          ...prev,
          ...finalStats,
        };
      });
    }

    // Apply all default net summary table codes at once
    if (Object.keys(newNetSummaryTableSelectedCodes).length > 0) {
      setNetSummaryTableSelectedCodes(prev => {
        // Only add if the variable doesn't already have net codes
        const finalNetCodes: Record<string, Array<{ name: string; codes: string[] }>> = {};
        Object.entries(newNetSummaryTableSelectedCodes).forEach(([varName, nets]) => {
          if (!prev[varName] || prev[varName].length === 0) {
            finalNetCodes[varName] = nets;
          }
        });

        if (Object.keys(finalNetCodes).length === 0) return prev;

        return {
          ...prev,
          ...finalNetCodes,
        };
      });
    }
  }, [variablesNoOe, questionnaireQuestions, setVariableTableSelections, setVariableStatsSelections, setNetSummaryTableSelectedCodes]);

  // Auto-select the first table when opening the variables view
  useEffect(() => {
    if (qnrViewMode === 'variables' && !selectedVariable && filteredVariablesWithSelectedTables.length > 0) {
      setSelectedVariable(filteredVariablesWithSelectedTables[0].name);
    }
  }, [qnrViewMode, selectedVariable, filteredVariablesWithSelectedTables, setSelectedVariable]);

  useEffect(() => {
    if (!pendingSpecsResetRef.current) return;
    if (loadingFullRawData) return;
    if (!fullRawData) return;
    if (!variables || variables.length === 0) return;

    resetSpecsToDefaults();
  }, [variables, fullRawData, loadingFullRawData, resetSpecsToDefaults]);

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
    // Use variables as primary source since they now include properly grouped multi-select grids
    variables.forEach((variable: Variable) => {
      const type = variable.type;
      // Filter out "ID" type from the dropdown
      if (type && type !== 'ID') {
        types.add(type);
      }
    });
    return Array.from(types).sort();
  }, [variables]);

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
          />
        )}

        {/* Project View - Questionnaire List */}
        {viewMode === 'project' && selectedProject && (
          <TabPlansProjectView
            selectedProject={selectedProject}
            plans={tabPlans}
            loading={loadingPlans}
            qnrNameById={qnrNameById}
            onBackToProjects={() => {
              setViewMode('home');
              setSelectedProject(null);
              setActiveTabPlan(null);
              setQuestionnaires([]);
              setSelectedQuestionnaire(null);
              setVariables([]);
              setSelectedVariable(null);
            }}
            onCreateNewPlan={() => {
              setShowCreateTabPlanWizard(true);
            }}
            onDeletePlan={async (plan) => {
              await deletePlan(plan.id);
              if (activeTabPlan?.id === plan.id) {
                setActiveTabPlan(null);
              }
              if (selectedProject?.id) {
                await listByProject(String(selectedProject.id));
              }
            }}
            onOpenPlan={(plan) => {
              setActiveTabPlan(plan);
              if (plan.sourceType === 'qnr' && plan.qnrId) {
                const match = questionnaires.find((q) => String(q.id) === String(plan.qnrId))
                  || allQuestionnaires.find((q) => String(q.id) === String(plan.qnrId));
                if (match) {
                  setSelectedQuestionnaire(match);
                  setViewMode('qnr');
                  return;
                }
                alert('This plan is linked to a QNR that is not available in this project.');
                return;
              }
              if (plan.sourceType === 'raw') {
                openRawTabPlan(plan).catch((e) => {
                  alert(e?.message || 'Failed to open raw-data tab plan');
                });
                return;
              }
              alert('Unable to open tab plan.');
            }}
          />
        )}

        {/* QNR View - Main Tab View */}
        {viewMode === 'qnr' && selectedQuestionnaire && selectedProject && (
          <>
            {(loadingFullRawData || loadingDatamap) && (
              <div className="flex flex-col items-center justify-center py-20">
                <div className="mx-auto h-12 w-12 animate-spin rounded-full border-4 border-gray-200 border-t-[#D14A2D]" />
                <div className="mt-3 text-sm text-gray-600">Loading tab plan…</div>
              </div>
            )}
            {!(loadingFullRawData || loadingDatamap) && (
              questionnaireQuestionsNoOe.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-16">
                  <div className="mx-auto h-12 w-12 animate-spin rounded-full border-4 border-gray-200 border-t-[#D14A2D]" />
                  <div className="mt-3 text-sm text-gray-600">Loading…</div>
                </div>
              ) : (
              <React.Fragment>
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
                    Tables
                  </button>
                  <button
                    onClick={() => setQnrViewMode('tableSpecs')}
                    className={`py-2 px-1 border-b-2 font-medium text-sm ${
                      qnrViewMode === 'tableSpecs'
                        ? 'text-white'
                        : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                    }`}
                    style={qnrViewMode === 'tableSpecs' ? { borderBottomColor: BRAND_ORANGE, color: BRAND_ORANGE } : {}}
                  >
                    Table Specs
                  </button>
                  <button
                    onClick={() => setQnrViewMode('bannerSpecs')}
                    className={`py-2 px-1 border-b-2 font-medium text-sm ${
                      qnrViewMode === 'bannerSpecs'
                        ? 'text-white'
                        : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                    }`}
                    style={qnrViewMode === 'bannerSpecs' ? { borderBottomColor: BRAND_ORANGE, color: BRAND_ORANGE } : {}}
                  >
                    Banner Specs
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
                <button
                  onClick={() => setViewMode('project')}
                  className="px-2 py-1 text-[11px] sm:text-xs font-medium rounded border border-gray-300 text-gray-700 hover:bg-gray-50 transition-colors"
                  title="Back to tab plans"
                >
                  Back to tab plans
                </button>
              </div>
              <div className="border-b border-gray-200"></div>
            </div>

            <div className="bg-white shadow-sm border border-gray-200 rounded-lg overflow-hidden">
              {qnrViewMode === 'tableSpecs' && (
                <TabSpecsView
                  viewType="tables"
                  tabSpecsTypeFilter={tabSpecsTypeFilter}
                  onTabSpecsTypeFilterChange={setTabSpecsTypeFilter}
                  tabSpecsTypeOptions={tabSpecsTypeOptions}
                  specsResetKey={specsResetKey}
                  onBackToTabPlans={() => setViewMode('project')}
                  selectedQuestionnaire={selectedQuestionnaire}
                  questionnaireQuestions={questionnaireQuestionsNoOe}
                  variables={variablesNoOe}
                  variableTableSelections={variableTableSelections}
                  showIncludedQuestions={showIncludedQuestions}
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
                  getTablesForVariable={getTablesForVariable}
                  projectName={selectedProject?.name || activeTabPlan?.name}
                  onBannerExport={handleExportBannerToExcel}
                  exportingBannerId={exportingBannerId}
                />
              )}

              {qnrViewMode === 'bannerSpecs' && (
                <TabSpecsView
                  viewType="banners"
                  tabSpecsTypeFilter={tabSpecsTypeFilter}
                  onTabSpecsTypeFilterChange={setTabSpecsTypeFilter}
                  tabSpecsTypeOptions={tabSpecsTypeOptions}
                  specsResetKey={specsResetKey}
                  onBackToTabPlans={() => setViewMode('project')}
                  selectedQuestionnaire={selectedQuestionnaire}
                  questionnaireQuestions={questionnaireQuestionsNoOe}
                  variables={variablesNoOe}
                  variableTableSelections={variableTableSelections}
                  showIncludedQuestions={showIncludedQuestions}
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
                  getTablesForVariable={getTablesForVariable}
                  projectName={selectedProject?.name || activeTabPlan?.name}
                  onBannerExport={handleExportBannerToExcel}
                  exportingBannerId={exportingBannerId}
                />
              )}

                    {qnrViewMode === 'variables' && (
                      <VariablesView
                          variables={variablesWithSelectedTables}
                          filteredVariables={filteredVariablesWithSelectedTables}
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
                          questionnaireQuestions={questionnaireQuestionsNoOe}
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
                          isRawPlan={activeTabPlan?.sourceType === 'raw'}
                      />
                    )}

                    {qnrViewMode === 'data' && (
                      activeTabPlan?.sourceType === 'raw' ? (
                        <TabPlanRawDataTab
                          planName={activeTabPlan.name}
                          datamapData={datamapData}
                          rawData={fullRawData}
                          loading={loadingFullRawData || loadingDatamap}
                          rawDataPage={rawDataPage}
                          rawDataRowsPerPage={rawDataRowsPerPage}
                          rawDataColumnStart={rawDataColumnStart}
                          rawDataColumnsPerPage={rawDataColumnsPerPage}
                          onPageChange={setRawDataPage}
                          onColumnChange={setRawDataColumnStart}
                          onUpload={async (file) => {
                            await uploadDataFile(activeTabPlan.id, file);
                            await openRawTabPlan(activeTabPlan);
                            requestSpecsReset();
                          }}
                          onRefresh={async () => {
                            await openRawTabPlan(activeTabPlan);
                          }}
                        />
                      ) : (
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
                          variables={variablesNoOe}
                          questionnaireQuestions={questionnaireQuestionsNoOe}
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
                          onDataUploaded={async () => {
                            setFullRawData(null);
                            requestSpecsReset();
                            await loadFullRawData(true);
                          }}
                          onDataDeleted={() => {
                            setFullRawData(null);
                          }}
                          onClearDatamap={() => {
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
                              
                              const variablesForMatching = allExpectedHeaders.map(header => ({
                                name: header,
                                type: 'Unknown',
                                description: ''
                              }));
                              
                              const columnHeaders = fullRawData.columns;
                              
                              // Get existing mapping if not forcing remap
                              let existingMapping = {};
                              if (!forceRemap && columnMapping && Object.keys(columnMapping).length > 0) {
                                existingMapping = columnMapping;
                              }
                              
                              // Perform automatic matching
                              const newMapping = autoMatchHeaders(variablesForMatching, columnHeaders);
                              
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
                              const minDelay = 2000;
                              if (elapsedTime < minDelay) {
                                await new Promise(resolve => setTimeout(resolve, minDelay - elapsedTime));
                              }
                            } catch (error: any) {
                              console.error('Error during auto-mapping:', error);
                              alert(`Failed to auto-map: ${error.message || 'Unknown error'}`);
                              
                              const elapsedTime = Date.now() - startTime;
                              const minDelay = 2000;
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
                      )
                    )}

            </div>
              </React.Fragment>
              )
            )}
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
                  showIncludedQuestions={showIncludedQuestions}
                  onShowIncludedQuestionsChange={setShowIncludedQuestions}
                  variables={variables}
                  questionnaireQuestions={questionnaireQuestions}
                  selectedQuestionnaire={selectedQuestionnaire}
                  onResetSpecs={() => {
                              resetSpecsToDefaults({ closeSettingsPopup: true });
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

        <CreateTabPlanWizard
          isOpen={showCreateTabPlanWizard}
          projectId={String(selectedProject?.id || '')}
          questionnaires={questionnaires}
          onClose={() => setShowCreateTabPlanWizard(false)}
          onCreatePlan={createPlan}
          onUploadRawFile={uploadDataFile}
          onCreated={(plan) => {
            setActiveTabPlan(plan);
            // Refresh list
            if (selectedProject?.id) {
              listByProject(String(selectedProject.id)).catch(() => {});
            }
            if (plan.sourceType === 'qnr' && plan.qnrId) {
              const match = questionnaires.find((q) => String(q.id) === String(plan.qnrId))
                || allQuestionnaires.find((q) => String(q.id) === String(plan.qnrId));
              if (match) {
                setSelectedQuestionnaire(match);
                setViewMode('qnr');
              }
              return;
            }
            if (plan.sourceType === 'raw') {
              openRawTabPlan(plan)
                .then(() => {
                  requestSpecsReset();
                })
                .catch((e) => {
                  alert(e?.message || 'Failed to open raw-data tab plan');
                });
            }
          }}
        />
      </div>
    </>
  );
}
