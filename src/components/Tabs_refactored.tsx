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
  EyeSlashIcon,
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

// Import components (placeholders for now)
import { VariableListSidebar } from './tabs/VariableListSidebar';
import { TableSelector } from './tabs/TableSelector';
import { StatsSelector } from './tabs/StatsSelector';
import { BannerBuilderUI } from './tabs/BannerBuilderUI';
import { BannerFilterUI } from './tabs/BannerFilterUI';
import { SummaryNetsList } from './tabs/SummaryNetsList';
import { NetSummaryModal } from './tabs/NetSummaryModal';
import { DebugModal } from './tabs/DebugModal';
import { MappingModal } from './tabs/MappingModal';
import { DataCutsView } from './tabs/DataCutsView';
import { RawDataViewer } from './tabs/RawDataViewer';

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
  const [qnrViewMode, setQnrViewMode] = useState<'tabSpecs' | 'variables' | 'data' | 'datamap'>('tabSpecs');
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

  // Initialize all hooks
  const variablesHook = useVariables();
  const bannersHook = useBanners();
  const summaryNetsHook = useSummaryNets();
  const rawDataHook = useRawDataViewer();
  const dataMappingHook = useDataMapping();
  const questionnaireHook = useQuestionnaire();
  const tableSelectionsHook = useTableSelections();
  const statsSelectionsHook = useStatsSelections();
  const previewHook = usePreview();

  // Destructure hook values for easier access
  const {
    variables,
    selectedVariable,
    variableData,
    variableFilter,
    questionTypeFilter,
    showQuestionTypeFilter,
    customNetsMode,
    setVariables,
    setSelectedVariable,
    setVariableData,
    setVariableFilter,
    setQuestionTypeFilter,
    setShowQuestionTypeFilter,
    setCustomNetsMode,
  } = variablesHook;

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
    fullRawData,
    loadingFullRawData,
    rawDataPage,
    rawDataRowsPerPage,
    rawDataColumnStart,
    rawDataColumnsPerPage,
    setFullRawData,
    setLoadingFullRawData,
    setRawDataPage,
    setRawDataColumnStart,
  } = rawDataHook;

  const {
    columnMapping,
    mappingFilter,
    datamapData,
    loadingDatamap,
    showColumnHeadersInfo,
    showMappingResultsModal,
    expandedDatamapRows,
    setColumnMapping,
    setMappingFilter,
    setDatamapData,
    setLoadingDatamap,
    setShowColumnHeadersInfo,
    setShowMappingResultsModal,
    setExpandedDatamapRows,
  } = dataMappingHook;

  const {
    questionnaires,
    selectedQuestionnaire,
    questionnaireQuestions,
    allQuestionnaires,
    setQuestionnaires,
    setSelectedQuestionnaire,
    setQuestionnaireQuestions,
    setAllQuestionnaires,
  } = questionnaireHook;

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

  const getQNRCount = useCallback((projectId: string) => {
    return allQuestionnaires.filter(q => q.projectId === projectId).length;
  }, [allQuestionnaires]);

  const handleProjectClick = useCallback((project: any) => {
    setSelectedProject(project);
    setViewMode('project');
    loadQuestionnaires(project.id);
  }, [loadQuestionnaires]);

  // Filter variables (using hook state)
  const filteredVariables = useMemo(() => {
    let filtered = [...variables];
    if (variableFilter) {
      const filter = variableFilter.toLowerCase();
      filtered = filtered.filter(v => 
        v.name.toLowerCase().includes(filter) ||
        (v.description && v.description.toLowerCase().includes(filter))
      );
    }
    if (questionTypeFilter) {
      filtered = filtered.filter(v => v.type === questionTypeFilter);
    }
    return filtered;
  }, [variables, variableFilter, questionTypeFilter]);

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
                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Project</th>
                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Client</th>
                        <th className="px-6 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider">QNRs</th>
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
                            <div className="text-xs text-gray-500 mt-1">{project.methodologyType || 'Quantitative'}</div>
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

        {/* Project View - Questionnaire List */}
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
                  <h3 className="text-lg font-semibold text-gray-900">No QNRs found</h3>
                  <p className="mt-2 text-gray-500">Upload data to a QNR to view tabs.</p>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="min-w-full divide-y divide-gray-200">
                    <thead className="bg-gray-50">
                      <tr>
                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">QNR Name</th>
                        <th className="px-6 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider">Questions</th>
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
                            <div className="text-sm text-gray-900">{qnr.questions?.length || 0}</div>
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
                <div className="p-6">
                  <div className="mb-4 flex items-start justify-between">
                    <div>
                      <h2 className="text-lg font-semibold text-gray-900 mb-2">Table Specifications</h2>
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => setTabSpecsSubView('tables')}
                          className={`px-3 py-1.5 text-xs sm:text-sm font-medium rounded-md border transition-colors ${
                            tabSpecsSubView === 'tables'
                              ? 'text-white'
                              : 'text-gray-900 bg-white border-gray-300 hover:bg-gray-50'
                          }`}
                          style={tabSpecsSubView === 'tables' ? { backgroundColor: BRAND_ORANGE, borderColor: BRAND_ORANGE } : {}}
                        >
                          Tables
                        </button>
                        <button
                          onClick={() => setTabSpecsSubView('banners')}
                          className={`px-3 py-1.5 text-xs sm:text-sm font-medium rounded-md border transition-colors ${
                            tabSpecsSubView === 'banners'
                              ? 'text-white'
                              : 'text-gray-900 bg-white border-gray-300 hover:bg-gray-50'
                          }`}
                          style={tabSpecsSubView === 'banners' ? { backgroundColor: BRAND_ORANGE, borderColor: BRAND_ORANGE } : {}}
                        >
                          Banners
                        </button>
                      </div>
                    </div>
                  </div>
                  {tabSpecsSubView === 'tables' ? (
                    <div>
                      {/* Tables subview - VariableListSidebar, TableSelector, StatsSelector components would go here */}
                      <p className="text-gray-500">Tables view - Component extraction in progress</p>
                    </div>
                  ) : (
                    <div>
                      {/* Banners subview - BannerBuilderUI, BannerFilterUI components would go here */}
                      <p className="text-gray-500">Banners view - Component extraction in progress</p>
                    </div>
                  )}
                </div>
              )}

              {qnrViewMode === 'data' && (
                <div className="p-6">
                  <RawDataViewer
                    data={fullRawData}
                    page={rawDataPage}
                    rowsPerPage={rawDataRowsPerPage}
                    columnStart={rawDataColumnStart}
                    columnsPerPage={rawDataColumnsPerPage}
                    onPageChange={setRawDataPage}
                    onColumnChange={setRawDataColumnStart}
                    loading={loadingFullRawData}
                  />
                </div>
              )}

              {qnrViewMode === 'datamap' && (
                <div className="p-6">
                  <p className="text-gray-500">Data mapping view - Component extraction in progress</p>
                </div>
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
        />

        <DataCutsView
          isOpen={showDataCutsView}
          onClose={() => setShowDataCutsView(false)}
          data={null}
          loading={dataCutsLoading}
        />
      </div>
    </>
  );
}

