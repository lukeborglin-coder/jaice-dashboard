import React, { useEffect, useMemo, useRef, useState, forwardRef, useImperativeHandle } from 'react';
import {
  CloudArrowUpIcon,
  TrashIcon,
  MagnifyingGlassIcon,
  CheckCircleIcon,
  XMarkIcon,
  ChatBubbleBottomCenterTextIcon,
  Bars3Icon,
  ClockIcon,
  CalculatorIcon,
  PlayIcon,
  ArrowLeftIcon,
} from '@heroicons/react/24/outline';
import * as XLSX from 'xlsx';
import { classifyDatamapQuestionType, detect7ptScale } from '../../utils/tabs/questionHelpers';
import { API_BASE_URL } from '../../config';
import { RawDataViewer } from '../tabs/RawDataViewer';
import { QualityPlanView, type DQV2RespondentResult, type DQV2RunResultsPayload } from './QualityPlanView';
import type { QualityRule } from '../../types/dataQuality';

const BRAND_ORANGE = '#D14A2D';

interface UploadedFileInfo {
  fileName: string;
  uploadedAt: string;
}

interface DataQualityV2DataTabProps {
  selectedProject: any | null;
  selectedQuestionnaire: any | null;
  hideUploadBox?: boolean;
  initialUploadedFileInfo?: UploadedFileInfo | null;

  fullRawData: { columns: string[]; rows: any[] } | null;
  loadingFullRawData: boolean;
  rawDataPage: number;
  rawDataRowsPerPage: number;
  rawDataColumnStart: number;
  rawDataColumnsPerPage: number;
  onPageChange: (page: number) => void;
  onColumnChange: (start: number) => void;

  datamapData: any;
  loadingDatamap: boolean;

  onDataUploaded?: () => void | Promise<void>;
  onDataDeleted?: () => void;
  onLoadDatamap?: (force?: boolean) => void;
  onEnsureRawData?: (force?: boolean) => void;
  onClearDatamap?: () => void;
  onBackToFiles?: () => void;
  showBackButton?: boolean;
}

export interface DataQualityV2UploadHandle {
  openUploadPicker: () => void;
}

const DataQualityV2DataTabComponent = ({
  selectedProject,
  selectedQuestionnaire,
  initialUploadedFileInfo,
  fullRawData,
  loadingFullRawData,
  rawDataPage,
  rawDataRowsPerPage,
  rawDataColumnStart,
  rawDataColumnsPerPage,
  onPageChange,
  onColumnChange,
  datamapData,
  loadingDatamap,
  onDataUploaded,
  onDataDeleted,
  onLoadDatamap,
  onEnsureRawData,
  onClearDatamap,
  onBackToFiles,
  showBackButton = false,
  hideUploadBox = false,
}, ref: React.Ref<DataQualityV2UploadHandle>) => {
  const getResultsStorageKey = (projectId: string) => `dqv2_qualityResults_${projectId}`;

  const normalizeHeaderKey = (value: unknown) => String(value || '').toLowerCase().trim().replace(/[^a-z0-9]/g, '');

  const isHiddenQuestionNumber = (questionNumber: string) => {
    const qn = String(questionNumber || '').trim().toLowerCase();
    if (!qn) return false;
    if (qn === 'qinfo') return true;
    if (!qn.startsWith('q')) return true;
    // Treat Term/HID rows as hidden even if they start with Q
    if (qn.includes('term') || qn.includes('hid')) return true;
    return false;
  };

  const [uploadedFileInfo, setUploadedFileInfo] = useState<UploadedFileInfo | null>(null);
  const [uploadingFile, setUploadingFile] = useState(false);
  const [dataTabView, setDataTabView] = useState<'datamap' | 'rawdata' | 'qualityPlan' | 'results'>('datamap');
  const [datamapSearch, setDatamapSearch] = useState('');
  const [showHiddenRows, setShowHiddenRows] = useState(false);
  const [expandedDatamapRows, setExpandedDatamapRows] = useState<Set<number>>(new Set());
  const [qualityPlanResetKey, setQualityPlanResetKey] = useState(0);
  const [dqv2Results, setDqv2Results] = useState<DQV2RespondentResult[] | null>(null);
  const [hasResultsTab, setHasResultsTab] = useState(false);
  const [dqv2EnabledRules, setDqv2EnabledRules] = useState<QualityRule[] | null>(null);
  const [selectedResult, setSelectedResult] = useState<DQV2RespondentResult | null>(null);
  const [expandedResultRuleIds, setExpandedResultRuleIds] = useState<Set<string>>(new Set());

  const fileInputRef = useRef<HTMLInputElement>(null);
  const isUploadingNewFileRef = useRef(false);

  const validRespondentCount = useMemo(() => {
    const rows = fullRawData?.rows || [];
    if (!Array.isArray(rows) || rows.length === 0) return 0;
    const columns = fullRawData?.columns || [];
    const recordKey = 'record';
    const recordIdx = Array.isArray(columns) && columns.length > 0
      ? columns.findIndex((c) => normalizeHeaderKey(c) === recordKey)
      : -1;

    let count = 0;
    rows.forEach((row: any) => {
      let rawVal: any = undefined;

      if (Array.isArray(row)) {
        if (recordIdx < 0) return;
        rawVal = row[recordIdx];
      } else if (row && typeof row === 'object') {
        const source = (row.columns && typeof row.columns === 'object') ? row.columns : row;
        const key = Object.keys(source).find((k) => normalizeHeaderKey(k) === recordKey) || null;
        rawVal = key ? (source as any)[key] : undefined;
      }

      const v = rawVal === null || rawVal === undefined ? '' : String(rawVal).trim();
      if (v.length >= 1) count += 1;
    });

    return count;
  }, [fullRawData?.rows, fullRawData?.columns]);

  const generateTagsForQuestion = useMemo(() => {
    return (q: any) => {
      const tags: string[] = [];
      const responseType = String(q?.responseType || '').toLowerCase();
      const questionType = classifyDatamapQuestionType(q || {});

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

      const isSingleSelectLike = questionType === 'Single select' || questionType === 'Single select grid';
      const hasScaleTag = tags.some(tag => /scale\s*\(7pt\)/i.test(tag));
      if (isSingleSelectLike && !hasScaleTag) {
        const responseCodes = Array.isArray(q?.responseCodes) ? q.responseCodes : [];
        const responseOptions = responseCodes.map((c: any, idx: number) => ({
          code: String(c?.code ?? idx + 1),
          text: String(c?.text ?? c?.label ?? c?.code ?? idx + 1),
        }));
        const detection = detect7ptScale(responseOptions);
        if (detection.hasScale) {
          tags.push('Scale (7pt)');
        }
      }

      return tags;
    };
  }, []);

  // Never trigger parent state updates during render.
  // If we have a questionnaire + uploaded file but no datamap yet, load it here.
  useEffect(() => {
    if (!selectedQuestionnaire) return;
    if (!uploadedFileInfo) return;
    if (loadingDatamap) return;
    if (datamapData) return;
    onLoadDatamap?.();
  }, [selectedQuestionnaire?.id, uploadedFileInfo?.uploadedAt, loadingDatamap, datamapData]);

  // Raw Data is used for checks but hidden from the UI.
  useEffect(() => {
    if (dataTabView === 'rawdata') setDataTabView('qualityPlan');
  }, [dataTabView]);

  // Restore persisted results (if they match the currently loaded data file)
  useEffect(() => {
    const projectId = selectedProject?.id;
    const questionnaireId = selectedQuestionnaire?.id;
    if (!projectId || !questionnaireId) return;
    if (!uploadedFileInfo) return;
    if (isUploadingNewFileRef.current) return;

    try {
      const raw = localStorage.getItem(getResultsStorageKey(projectId));
      if (!raw) return;
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== 'object') return;
      if (parsed.projectId !== projectId) return;
      if (parsed.questionnaireId !== questionnaireId) return;

      // Basic file match guard: prefer uploadedAt, fall back to fileName
      const sameUploadedAt = parsed.uploadedAt && parsed.uploadedAt === uploadedFileInfo.uploadedAt;
      const sameFileName = parsed.fileName && parsed.fileName === uploadedFileInfo.fileName;
      if (!sameUploadedAt && !sameFileName) return;

      if (Array.isArray(parsed.results)) {
        setDqv2Results(parsed.results);
        setHasResultsTab(true);
      }
      if (Array.isArray(parsed.enabledRules)) {
        setDqv2EnabledRules(parsed.enabledRules);
      }
    } catch {
      // ignore
    }
  }, [selectedProject?.id, selectedQuestionnaire?.id, uploadedFileInfo?.uploadedAt, uploadedFileInfo?.fileName]);

  // Load file info when questionnaire changes
  useEffect(() => {
    if (!selectedQuestionnaire) {
      setUploadedFileInfo(null);
      return;
    }

    let cancelled = false;

    const loadFileInfo = async () => {
      try {
        const response = await fetch(`${API_BASE_URL}/api/questionnaire/data-file-info/${selectedQuestionnaire.id}`, {
          headers: { 'Authorization': `Bearer ${localStorage.getItem('cognitive_dash_token')}` }
        });

        if (cancelled) return;

        if (response.ok) {
          const data = await response.json();
          if (cancelled) return;
          if (data.fileName) {
            setUploadedFileInfo({
              fileName: data.originalFileName || data.fileName || 'Unknown',
              uploadedAt: data.uploadedAt || new Date().toISOString(),
            });

            // If a data file already exists (e.g. after refresh), do NOT auto-load full raw data.
            // Datamap is cheap and is cached in localStorage; raw data can be large and is loaded on-demand.
            if (!isUploadingNewFileRef.current) {
              onLoadDatamap?.();
            }
          } else {
            setUploadedFileInfo(null);
          }
        } else {
          if (cancelled) return;
          setUploadedFileInfo(null);
        }
      } catch (error) {
        if (cancelled) return;
        setUploadedFileInfo(null);
      }
    };

    void loadFileInfo();
    return () => {
      cancelled = true;
    };
  }, [selectedQuestionnaire?.id]);

  // Seed uploaded file info from parent (e.g., list view) to avoid disabled tabs while fetching
  useEffect(() => {
    if (uploadedFileInfo) return;
    if (!initialUploadedFileInfo) return;
    setUploadedFileInfo(initialUploadedFileInfo);
  }, [initialUploadedFileInfo, uploadedFileInfo]);

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    console.debug('[DQ-UPLOAD] handleFileUpload called');
    const file = e.target.files?.[0];
    if (!file || !selectedQuestionnaire) return;

    isUploadingNewFileRef.current = true;

    try {
      setUploadingFile(true);
      console.debug('[DQ-UPLOAD] Starting local header parse', { fileName: file.name });

      // Parse headers locally first (same behavior as Tabs)
      await new Promise<string[]>((resolve, reject) => {
        const reader = new FileReader();
        const isCSV = file.name.toLowerCase().endsWith('.csv');

        reader.onload = (evt) => {
          try {
            let workbook: XLSX.WorkBook;
            if (isCSV) {
              const text = evt.target?.result as string;
              workbook = XLSX.read(text, { type: 'string' });
            } else {
              const data = new Uint8Array(evt.target?.result as ArrayBuffer);
              workbook = XLSX.read(data, { type: 'array' });
            }

            const firstSheetName = workbook.SheetNames[0];
            const worksheet = workbook.Sheets[firstSheetName];
            const headerRange = XLSX.utils.decode_range(worksheet['!ref'] || 'A1');
            const headers: string[] = [];
            for (let col = headerRange.s.c; col <= headerRange.e.c; col++) {
              const cellAddress = XLSX.utils.encode_cell({ r: 0, c: col });
              const cell = worksheet[cellAddress];
              if (cell && cell.v !== undefined && cell.v !== null) {
                headers.push(String(cell.v).trim());
              } else {
                headers.push('');
              }
            }
            resolve(headers.filter(h => h.length > 0));
          } catch (err) {
            reject(err);
          }
        };

        reader.onerror = () => reject(new Error('Failed to read file'));
        if (isCSV) reader.readAsText(file);
        else reader.readAsArrayBuffer(file);
      });
      console.debug('[DQ-UPLOAD] Finished local header parse');

      // Upload to server (questionnaire-backed)
      const formData = new FormData();
      formData.append('file', file);
      formData.append('questionnaireId', selectedQuestionnaire.id);

      console.debug('[DQ-UPLOAD] Uploading to server', { questionnaireId: selectedQuestionnaire.id, fileName: file.name });
      const response = await fetch(`${API_BASE_URL}/api/questionnaire/upload-data-file`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${localStorage.getItem('cognitive_dash_token')}`
        },
        body: formData
      });

      if (response.ok) {
        const result = await response.json();
        console.debug('[DQ-UPLOAD] Upload success', { fileName: result.originalFileName || result.fileName || file.name });
        setUploadedFileInfo({
          fileName: result.originalFileName || result.fileName || file.name,
          uploadedAt: new Date().toISOString(),
        });

        // New file => clear old v2 plan so it regenerates from the new Data Map
        try {
          if (selectedProject?.id) {
            localStorage.removeItem(`dqv2_qualityPlan_${selectedProject.id}`);
          }
        } catch {}
        // Force QualityPlanView to remount (clears any in-memory state/modals)
        setQualityPlanResetKey((k) => k + 1);

        // New file => clear old results tab
        setDqv2Results(null);
        setHasResultsTab(false);
        setDqv2EnabledRules(null);
        setSelectedResult(null);
        setExpandedResultRuleIds(new Set());
        try {
          if (selectedProject?.id) localStorage.removeItem(getResultsStorageKey(selectedProject.id));
        } catch {}

        // Kick off the upstream loads (raw data + datamap). Keep the spinner up until they finish.
        console.debug('[DQ-UPLOAD] Calling onDataUploaded');
        await Promise.resolve(onDataUploaded?.());
        // Fallback: if caller didn't implement onDataUploaded, at least refresh the datamap.
        if (!onDataUploaded) {
          console.debug('[DQ-UPLOAD] No onDataUploaded handler, triggering loadDatamap');
          onLoadDatamap?.(true);
        }
        // Stay on Data Map (do not auto-switch to Raw Data)
        setDataTabView('datamap');

        // Keep the loading UI up until both sources are finished (or we time out).
        const waitForPostUploadLoads = async (timeoutMs: number) => {
          console.debug('[DQ-UPLOAD] Waiting for datamap/raw data to finish loading');
          const start = Date.now();
          // Wait for loading flags to settle.
          while (Date.now() - start < timeoutMs) {
            const datamapDone = !loadingDatamap;
            const rawDone = !loadingFullRawData;
            if (datamapDone && rawDone) return;
            await new Promise((r) => setTimeout(r, 100));
          }
        };
        await waitForPostUploadLoads(120_000);
        console.debug('[DQ-UPLOAD] Post-upload loads finished or timed out');
      } else {
        const error = await response.json().catch(() => ({}));
        console.error('[DQ-UPLOAD] Failed to upload file', error);
        alert(`Failed to upload file: ${error.error || 'Unknown error'}`);
      }
    } catch (error: any) {
      console.error('[DQ-UPLOAD] Error uploading file:', error);
      alert(`Failed to upload file: ${error?.message || 'Unknown error'}`);
    } finally {
      setUploadingFile(false);
      isUploadingNewFileRef.current = false;
      console.debug('[DQ-UPLOAD] Upload flow complete (finally)');
      if (e.target) {
        e.target.value = '';
      }
    }
  };

  const handleDeleteFile = async () => {
    if (!selectedQuestionnaire) return;

    if (!confirm('Are you sure you want to delete this data file permanently? You will need to upload a new file.')) {
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
        setUploadedFileInfo(null);
        // Reset local UI state so no stale views/data appear
        setDataTabView('datamap');
        setDatamapSearch('');
        setExpandedDatamapRows(new Set());

        // Clear the v2 quality plan for this project (stored locally)
        try {
          if (selectedProject?.id) {
            localStorage.removeItem(`dqv2_qualityPlan_${selectedProject.id}`);
          }
        } catch {}
        // Force QualityPlanView to remount (clears any in-memory state/modals)
        setQualityPlanResetKey((k) => k + 1);

        // Clear any previously computed results
        setDqv2Results(null);
        setHasResultsTab(false);
        setDqv2EnabledRules(null);
        setSelectedResult(null);
        setExpandedResultRuleIds(new Set());
        try {
          if (selectedProject?.id) localStorage.removeItem(getResultsStorageKey(selectedProject.id));
        } catch {}

        onClearDatamap?.();
        onDataDeleted?.();
      } else {
        const error = await response.json().catch(() => ({}));
        alert(`Failed to delete file: ${error.error || 'Unknown error'}`);
      }
    } catch (error: any) {
      console.error('Error deleting file:', error);
      alert(`Failed to delete file: ${error?.message || 'Unknown error'}`);
    }
  };

  const canShowDataViews = !!uploadedFileInfo;
  const hasResults = Array.isArray(dqv2Results) && dqv2Results.length > 0;
  const canShowResultsTab = hasResults;
  const canClickResultsTab = hasResults;
  const columnHeaders = fullRawData?.columns || [];

  const flagCountStats = useMemo(() => {
    const rows = Array.isArray(dqv2Results) ? dqv2Results : [];
    const counts = rows.map((r: any) => Number(r?.flagCount)).filter((n) => Number.isFinite(n));
    if (counts.length === 0) return { mean: null as number | null, stdDev: null as number | null };
    const mean = counts.reduce((a, b) => a + b, 0) / counts.length;
    const avgSq = counts.reduce((acc, v) => acc + Math.pow(v - mean, 2), 0) / counts.length;
    const stdDev = Math.sqrt(avgSq);
    return { mean, stdDev: Number.isFinite(stdDev) ? stdDev : null };
  }, [dqv2Results]);

  useEffect(() => {
    if (dataTabView === 'results' && !hasResults) {
      setDataTabView('qualityPlan');
    }
  }, [dataTabView, hasResults]);

  const isFlagCountOutlier = (flagCount: unknown) => {
    const n = Number(flagCount);
    const mean = flagCountStats.mean;
    const sd = flagCountStats.stdDev;
    if (!Number.isFinite(n) || mean === null || sd === null || sd === 0) return false;
    return Math.abs(n - mean) >= 2 * sd;
  };


  const groupedResults = useMemo(() => {
    const rows = Array.isArray(dqv2Results) ? [...dqv2Results] : [];
    rows.sort((a, b) => Number(b?.score || 0) - Number(a?.score || 0));
    const buckets: Record<'bad' | 'moderate' | 'good', DQV2RespondentResult[]> = {
      bad: [],
      moderate: [],
      good: [],
    };
    rows.forEach((r) => {
      const s = Number(r?.score || 0);
      const flaggedOutlier = isFlagCountOutlier(r.flagCount);
      if (s >= 41) buckets.bad.push(r);
      else if (s >= 21) buckets.moderate.push(r);
      else if (flaggedOutlier) buckets.moderate.push(r);
      else buckets.good.push(r);
    });
    return buckets;
  }, [dqv2Results, isFlagCountOutlier]);

  const ensureRawDataIfNeeded = (force?: boolean) => {
    if (loadingFullRawData) return;
    if (fullRawData && Array.isArray(fullRawData.rows) && fullRawData.rows.length > 0) return;
    onEnsureRawData?.(force);
  };

  useImperativeHandle(ref, () => ({
    openUploadPicker: () => {
      console.debug('[DQ] openUploadPicker invoked');
      fileInputRef.current?.click();
    }
  }), []);

  return (
    <div className="p-6 pt-0 h-full flex flex-col min-h-0">
      {/* Always keep the file input mounted for programmatic picker opens */}
      <input
        ref={fileInputRef}
        type="file"
        id="dqv2-data-file-upload"
        accept=".xlsx,.xls,.csv"
        onChange={handleFileUpload}
        className="hidden"
      />

      <div className="mt-0 mb-3 sticky top-0 z-30 py-2" style={{ backgroundColor: '#f8f9fb' }}>
        <div className="flex items-center justify-between">
          <nav className="-mb-px flex space-x-8 items-center">
            <button
              onClick={() => {
                if (!canShowDataViews) return;
                setDataTabView('datamap');
              }}
              disabled={!canShowDataViews}
              className={`py-2 px-1 border-b-2 font-medium text-sm ${
                dataTabView === 'datamap'
                  ? 'text-white'
                  : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
              } ${!canShowDataViews ? 'cursor-not-allowed text-gray-400' : ''}`}
              style={dataTabView === 'datamap' && canShowDataViews ? { borderBottomColor: BRAND_ORANGE, color: BRAND_ORANGE } : {}}
            >
              Data Map
            </button>
            <button
              onClick={() => {
                if (!canShowDataViews) return;
                ensureRawDataIfNeeded(false);
                setDataTabView('qualityPlan');
              }}
              disabled={!canShowDataViews}
              className={`py-2 px-1 border-b-2 font-medium text-sm ${
                dataTabView === 'qualityPlan'
                  ? 'text-white'
                  : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
              } ${!canShowDataViews ? 'cursor-not-allowed text-gray-400' : ''}`}
              style={dataTabView === 'qualityPlan' && canShowDataViews ? { borderBottomColor: BRAND_ORANGE, color: BRAND_ORANGE } : {}}
            >
              Quality Plan
            </button>
            {canShowResultsTab && (
              <button
                onClick={() => {
                  if (!canClickResultsTab) return;
                  ensureRawDataIfNeeded(false);
                  setDataTabView('results');
                }}
                disabled={!canClickResultsTab}
                className={`py-2 px-1 border-b-2 font-medium text-sm ${
                  dataTabView === 'results'
                    ? 'text-white'
                    : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                } ${!canClickResultsTab ? 'cursor-not-allowed text-gray-400' : ''}`}
                style={dataTabView === 'results' && canClickResultsTab ? { borderBottomColor: BRAND_ORANGE, color: BRAND_ORANGE } : {}}
                title={!canShowDataViews ? 'Upload a data file first' : (!canClickResultsTab ? 'Run Quality Check to see results' : 'View results')}
              >
                Results
              </button>
            )}
          </nav>
          {showBackButton && onBackToFiles && (
            <button
              onClick={onBackToFiles}
              className="flex items-center gap-2 text-sm text-gray-600 hover:text-gray-800 hover:bg-gray-100 px-3 py-1 rounded-lg transition-colors"
            >
              <ArrowLeftIcon className="h-4 w-4" />
              Back to data files
            </button>
          )}
        </div>
        <div className="border-b border-gray-200"></div>
      </div>

        {dataTabView === 'datamap' && (
          <div className="flex-1 min-h-0 flex flex-col gap-3">
            {/* Data File box (only when no file is uploaded) */}
            {!uploadedFileInfo && !hideUploadBox && (
              <div className="mb-6">
                <div className="flex items-center gap-3 mb-4">
                  <h3 className="text-lg font-semibold text-gray-900">Data File</h3>
                  <button
                    onClick={() => fileInputRef.current?.click()}
                    disabled={uploadingFile || !selectedProject}
                    className="flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium text-white rounded shadow-sm transition-colors hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed"
                    style={{ backgroundColor: BRAND_ORANGE }}
                  >
                    <CloudArrowUpIcon className="h-3.5 w-3.5" />
                    {uploadingFile ? 'Uploading...' : 'Upload Data File'}
                  </button>
                </div>

                {uploadingFile && (
                  <div className="border border-gray-200 rounded-lg overflow-hidden">
                    <div className="p-8 text-center">
                      <div className="mx-auto mb-4 h-12 w-12 animate-spin rounded-full border-4 border-gray-200 border-t-[#D14A2D]"></div>
                      <p className="text-sm text-gray-700">Uploading and processing data file...</p>
                    </div>
                  </div>
                )}

                {!uploadingFile && (
                  <div className="text-left mb-4">
                    <p className="text-sm text-gray-500">No data file uploaded</p>
                    <p className="text-xs text-gray-400 mt-2">Click the "Upload Data File" button to get started</p>
                  </div>
                )}

              </div>
            )}

            {!uploadingFile && !!uploadedFileInfo && (
              <div className="flex items-center gap-3">
                <div className="relative flex-1">
                  <MagnifyingGlassIcon className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-gray-400" />
                  <input
                    type="text"
                    id="dqv2-datamap-search"
                    name="dqv2-datamap-search"
                    placeholder="Search questions, descriptions, column headers..."
                    value={datamapSearch}
                    onChange={(e) => setDatamapSearch(e.target.value)}
                    className="w-full pl-10 pr-4 py-2 text-sm border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-orange-500 focus:border-transparent"
                  />
                </div>
              </div>
            )}

            <div className="flex-1 min-h-0">
              {(() => {
                if (loadingDatamap && !datamapData) {
                  // While uploading, the upload box is the only loading UI we want to show here.
                  if (uploadingFile) return null;
                  return <div className="text-center py-8 text-gray-500">Loading datamap...</div>;
                }

                if (!datamapData || !datamapData.parsedQuestions || datamapData.parsedQuestions.length === 0) {
                  // If there is no uploaded file, don't show a "missing datamap" message.
                  if (!uploadedFileInfo) return null;
                  return (
                    <div className="text-center py-8">
                      <p className="text-sm text-gray-500">No data map available. Upload a data file with a datamap sheet to see the data structure.</p>
                    </div>
                  );
                }

                const searchLower = datamapSearch.toLowerCase().trim();
                const filteredQuestions = datamapSearch
                  ? (datamapData.parsedQuestions || []).filter((question: any) => {
                      const questionNumber = String(question.questionNumber || '').toLowerCase();
                      const description = String(question.description || '').toLowerCase();
                      const responseType = String(question.responseType || '').toLowerCase();
                      const columnNames = (question.columnDefinitions || [])
                        .map((def: any) => String(def.columnName || '').toLowerCase())
                        .join(' ');
                      const responseCodes = (question.responseCodes || [])
                        .map((code: any) => String(code.code || '') + ' ' + String(code.label || code.text || ''))
                        .join(' ')
                        .toLowerCase();

                      return questionNumber.includes(searchLower) ||
                        description.includes(searchLower) ||
                        responseType.includes(searchLower) ||
                        columnNames.includes(searchLower) ||
                        responseCodes.includes(searchLower);
                    })
                  : (datamapData.parsedQuestions || []);

                const visibleQuestions = showHiddenRows
                  ? filteredQuestions
                  : filteredQuestions.filter((q: any) => !isHiddenQuestionNumber(String(q.questionNumber || '').trim()));

                return (
                  <div className="h-full overflow-y-auto overflow-x-hidden border border-gray-200 rounded-lg bg-white">
                    <table className="w-full table-fixed text-sm">
                      <colgroup>
                        <col style={{ width: '7%' }} />
                        <col style={{ width: '12%' }} />
                        <col style={{ width: '12%' }} />
                        <col style={{ width: '8%' }} />
                        <col style={{ width: '20%' }} />
                        <col style={{ width: '20%' }} />
                        <col style={{ width: '14%' }} />
                        <col style={{ width: '7%' }} />
                      </colgroup>
                      <thead className="bg-gray-50 sticky top-0 z-10">
                        <tr>
                          <th className="px-3 py-2 text-left text-xs font-medium text-gray-700 uppercase tracking-wider">Q#</th>
                          <th className="px-3 py-2 text-left text-xs font-medium text-gray-700 uppercase tracking-wider whitespace-nowrap">Response value</th>
                          <th className="px-3 py-2 text-left text-xs font-medium text-gray-700 uppercase tracking-wider whitespace-nowrap">Question type</th>
                          <th className="px-3 py-2 text-left text-xs font-medium text-gray-700 uppercase tracking-wider">Tags</th>
                          <th className="px-3 py-2 text-left text-xs font-medium text-gray-700 uppercase tracking-wider">Text</th>
                          <th className="px-3 py-2 text-left text-xs font-medium text-gray-700 uppercase tracking-wider whitespace-nowrap">Response options</th>
                          <th className="px-3 py-2 text-left text-xs font-medium text-gray-700 uppercase tracking-wider">Statements</th>
                          <th
                            className="px-3 py-2 text-center text-xs font-medium text-gray-700 uppercase tracking-wider cursor-pointer select-none"
                            style={{ width: '70px' }}
                            onClick={() => setShowHiddenRows((prev) => !prev)}
                            title={showHiddenRows ? 'Hide hidden rows' : 'Show hidden rows'}
                          >
                            <div className="leading-tight">
                              <div>Hidden</div>
                              <div className="text-[10px] font-normal text-gray-500">
                                {showHiddenRows ? 'Showing' : 'Filtered'}
                              </div>
                            </div>
                          </th>
                        </tr>
                      </thead>
                      <tbody className="bg-white divide-y divide-gray-200">
                        {visibleQuestions.map((question: any, idx: number) => {
                          const questionNumberRaw = String(question.questionNumber || '').trim();
                          const questionNumberDisplay = questionNumberRaw;
                          const isHidden = isHiddenQuestionNumber(questionNumberRaw);
                          const responseType = question.responseType || 'Unknown';
                          const questionType = classifyDatamapQuestionType(question || {});
                          const tags = generateTagsForQuestion(question || {});

                          const rawOptions =
                            (Array.isArray(question?.responseCodes) && question.responseCodes) ||
                            (Array.isArray(question?.responseOptions) && question.responseOptions) ||
                            (Array.isArray(question?.statementOptions) && question.statementOptions) ||
                            [];

                          const normalizedOptions: Array<{ code: string; label: string }> = rawOptions
                            .map((opt: any, optIdx: number) => {
                              if (opt == null) return null;
                              if (typeof opt === 'string' || typeof opt === 'number') {
                                return { code: String(opt), label: '' };
                              }
                              const code = opt.code ?? opt.value ?? optIdx + 1;
                              const label = opt.label ?? opt.text ?? opt.name ?? '';
                              return { code: String(code), label: String(label) };
                            })
                            .filter(Boolean) as Array<{ code: string; label: string }>;

                          const previewOptions = normalizedOptions.slice(0, 6);
                          const remainingOptions = Math.max(0, normalizedOptions.length - previewOptions.length);

                          const notes = Array.isArray(question?.notes) ? question.notes : [];
                          return (
                            <tr
                              key={idx}
                              className="border-b border-gray-100 align-top"
                            >
                              <td className="px-3 py-2 text-xs text-gray-900 font-medium">
                                <div className="truncate" title={questionNumberDisplay}>{questionNumberDisplay}</div>
                              </td>
                              <td className="px-3 py-2 text-xs text-gray-700">
                                <div className="truncate" title={responseType}>{responseType}</div>
                              </td>
                          <td className="px-3 py-2 text-xs text-gray-700">
                            <div className="truncate" title={questionType}>{questionType}</div>
                          </td>
                              <td className="px-3 py-2 text-xs text-gray-700">
                                {tags.length ? (
                                  <div className="flex flex-wrap gap-1">
                                    {tags.map((tag, tIdx) => (
                                      <span key={`${tag}-${tIdx}`} className="inline-flex items-center px-1.5 py-0.5 rounded text-[11px] bg-blue-100 text-blue-800 whitespace-nowrap">
                                        {tag}
                                      </span>
                                    ))}
                                  </div>
                                ) : (
                                  <span className="text-gray-300">-</span>
                                )}
                              </td>
                              <td className="px-3 py-2 text-xs text-gray-700">
                                <div className="line-clamp-3" title={question.description || '-'}>
                                  {question.description || '-'}
                                </div>
                              </td>
                              <td className="px-3 py-2 text-xs text-gray-700">
                                {normalizedOptions.length ? (
                                  <div className="space-y-0.5 overflow-hidden" title={normalizedOptions.map((o) => (o.label ? `${o.code}: ${o.label}` : `${o.code}`)).join('\n')}>
                                    {previewOptions.map((o, oIdx) => (
                                      <div key={`${o.code}-${oIdx}`} className="truncate">
                                        {o.label ? `${o.code}: ${o.label}` : `${o.code}`}
                                      </div>
                                    ))}
                                    {remainingOptions > 0 ? <div className="text-gray-400 truncate">+{remainingOptions} more</div> : null}
                                  </div>
                                ) : (
                                  <span className="text-gray-300">-</span>
                                )}
                              </td>
                              <td className="px-3 py-2 text-xs text-gray-700">
                                {notes.length ? (
                                  <div className="space-y-0.5 overflow-hidden" title={notes.join('\n')}>
                                    {notes.slice(0, 4).map((n: string, nIdx: number) => (
                                      <div key={`${nIdx}-${n}`} className="truncate">
                                        {n}
                                      </div>
                                    ))}
                                    {notes.length > 4 ? <div className="text-gray-400 truncate">+{notes.length - 4} more</div> : null}
                                  </div>
                                ) : (
                                  <span className="text-gray-300">-</span>
                                )}
                              </td>
                              <td className="px-3 py-2 text-center">
                                {isHidden ? (
                                  <CheckCircleIcon className="h-5 w-5 text-green-500 mx-auto" title="Hidden (not Q / contains Term / contains HID)" />
                                ) : (
                                  <span className="text-gray-300">-</span>
                                )}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                );
              })()}
            </div>
          </div>
        )}

        {dataTabView === 'qualityPlan' && selectedProject?.id && (
          <QualityPlanView
            key={`${selectedProject.id}-${qualityPlanResetKey}`}
            projectId={selectedProject.id}
            datamapData={datamapData}
            fullRawData={fullRawData}
            onResultsReady={(payload: DQV2RunResultsPayload) => {
              setDqv2Results(payload.results);
              setDqv2EnabledRules(payload.enabledRules);
              setHasResultsTab(true);
              setDataTabView('results');

              // Persist results so the Results tab survives refresh
              try {
                localStorage.setItem(
                  getResultsStorageKey(selectedProject.id),
                  JSON.stringify({
                    version: 1,
                    projectId: selectedProject.id,
                    questionnaireId: selectedQuestionnaire?.id || null,
                    fileName: uploadedFileInfo?.fileName || null,
                    uploadedAt: uploadedFileInfo?.uploadedAt || null,
                    createdAt: new Date().toISOString(),
                    results: payload.results,
                    enabledRules: payload.enabledRules,
                  })
                );
              } catch {}
            }}
          />
        )}

        {dataTabView === 'results' && (
          <div className="bg-gray-50">
            {!dqv2Results ? (
              <div className="p-6 text-sm text-gray-500">No results yet. Run Quality Check from the Quality Plan tab.</div>
            ) : dqv2Results.length === 0 ? (
              <div className="p-6 text-sm text-gray-500">No respondents found.</div>
            ) : (
              <div className="space-y-4 p-0">
                {[
                  { id: 'bad', label: 'Bad (Remove)', headerClass: 'bg-red-100 text-red-900 border-b border-red-200', chip: 'bg-red-200 text-red-900' },
                  { id: 'moderate', label: 'Moderate (Review)', headerClass: 'bg-yellow-100 text-yellow-900 border-b border-yellow-200', chip: 'bg-yellow-200 text-yellow-900' },
                  { id: 'good', label: 'Good', headerClass: 'bg-green-100 text-green-900 border-b border-green-200', chip: 'bg-green-200 text-green-900' },
                ].map((group) => {
                  const items = (groupedResults as any)[group.id] || [];
                  return (
                    <div key={group.id} className="rounded-lg border border-gray-200 bg-white">
                      <div className={`px-3 py-2 flex items-center justify-between ${group.headerClass}`}>
                        <div className="text-sm font-semibold">{group.label}</div>
                        <div className="text-xs text-gray-600">{items.length} respondent(s)</div>
                      </div>
                      {items.length === 0 ? (
                        <div className="px-3 py-4 text-sm text-gray-500">None</div>
                      ) : (
                        <div className="max-h-64 overflow-y-auto divide-y divide-gray-200/70">
                          <div className="sticky top-0 bg-white border-b border-gray-200/70 px-3 py-1">
                            <div className="grid grid-cols-[1fr_auto_auto] gap-3 text-[11px] font-semibold text-gray-700 uppercase tracking-wide">
                              <div className="text-left">Record</div>
                              <div className="text-center w-[70px]">Flags</div>
                              <div className="text-center w-[70px]">Score</div>
                            </div>
                          </div>
                          {items.map((r: DQV2RespondentResult) => (
                            <div
                              key={`${r.respondentId}-${r.rowIndex}`}
                              className="px-3 py-2 cursor-pointer grid grid-cols-[1fr_auto_auto] gap-3 items-center"
                              onClick={() => {
                                setSelectedResult(r);
                                setExpandedResultRuleIds(new Set());
                              }}
                              title="Click for details"
                            >
                              <div className="min-w-0">
                                <div className="text-sm font-medium text-gray-900 truncate">{r.respondentId}</div>
                                <div className="text-xs text-gray-600 truncate">
                                  {(r.flagNames || []).join(', ') || '—'}
                                </div>
                              </div>
                          <div className={`text-sm tabular-nums text-center w-[70px] ${isFlagCountOutlier(r.flagCount) ? 'text-red-700 font-bold' : 'text-gray-700'}`}>
                            {r.flagCount}
                            {isFlagCountOutlier(r.flagCount) ? '*' : ''}
                          </div>
                          <div className="flex justify-center w-[70px]">
                            <span
                              className={[
                                'inline-flex items-center justify-center min-w-[70px] px-2 py-0.5 rounded-full text-xs font-semibold tabular-nums',
                                Number(r.score) >= 41
                                  ? 'bg-red-200 text-red-900'
                                  : Number(r.score) >= 21
                                    ? 'bg-yellow-200 text-yellow-900'
                                    : 'bg-green-200 text-green-900',
                              ].join(' ')}
                            >
                              {Number.isFinite(Number(r.score)) ? Number(r.score).toFixed(1) : String(r.score ?? '')}
                            </span>
                          </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* Results drilldown modal */}
        {selectedResult && dataTabView === 'results' && (
          <ResultsDetailModal
            result={selectedResult}
            fullRawData={fullRawData}
            datamapData={datamapData}
            enabledRules={dqv2EnabledRules}
            expandedRuleIds={expandedResultRuleIds}
            onToggleRule={(ruleId) => {
              setExpandedResultRuleIds((prev) => {
                // Only allow one expanded row at a time.
                return prev.has(ruleId) ? new Set() : new Set([ruleId]);
              });
            }}
            onClose={() => {
              setSelectedResult(null);
              setExpandedResultRuleIds(new Set());
            }}
          />
        )}
    </div>
  );
};

export const DataQualityV2DataTab = forwardRef<DataQualityV2UploadHandle, DataQualityV2DataTabProps>(DataQualityV2DataTabComponent);

export default DataQualityV2DataTab;

function ResultsDetailModal({
  result,
  fullRawData,
  datamapData,
  enabledRules,
  expandedRuleIds,
  onToggleRule,
  onClose,
}: {
  result: DQV2RespondentResult;
  fullRawData: { columns: string[]; rows: any[] } | null;
  datamapData: any;
  enabledRules: QualityRule[] | null;
  expandedRuleIds: Set<string>;
  onToggleRule: (ruleId: string) => void;
  onClose: () => void;
}) {
  const columns = fullRawData?.columns || [];
  const rows = fullRawData?.rows || [];

  const normalizeHeaderKey = (value: unknown) =>
    String(value || '').toLowerCase().trim().replace(/[^a-z0-9]/g, '');

  const normalizeQuestionNumberKey = (value: unknown) =>
    String(value || '')
      .trim()
      .toLowerCase()
      .replace(/^q/i, '')
      .replace(/[^a-z0-9]/g, '');

  const parsedQuestions = useMemo(() => {
    const arr = datamapData?.parsedQuestions;
    return Array.isArray(arr) ? arr : [];
  }, [datamapData?.parsedQuestions]);

  const extractBracketTokens = (value: string): string[] => {
    const tokens: string[] = [];
    const patterns = [/\[([^\]]+)\]/g, /\(([^)]+)\)/g];
    patterns.forEach((pattern) => {
      let match: RegExpExecArray | null;
      pattern.lastIndex = 0;
      while ((match = pattern.exec(value)) !== null) {
        const t = String(match[1] || '').trim();
        if (t) tokens.push(t);
      }
    });
    return tokens;
  };

  const extractDataMapHeaderTokens = (value: string): string[] => {
    const out: string[] = [];
    const raw = String(value || '').trim();
    if (!raw) return out;

    extractBracketTokens(raw).forEach((t) => out.push(t));

    const re = /\$\{([^}]+)\}/g;
    let m: RegExpExecArray | null;
    re.lastIndex = 0;
    while ((m = re.exec(raw)) !== null) {
      const t = String(m[1] || '').trim();
      if (t) out.push(t);
    }

    if (/[a-z]/i.test(raw) && /[._]/.test(raw)) out.push(raw);
    return out;
  };

  const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

  const getStraightlineColumnNamesForQuestion = (allColumnNames: string[], questionNumber: string) => {
    const qn = String(questionNumber || '').trim().toLowerCase();
    if (!qn) return [];
    const prefixes = [qn];
    if (qn.startsWith('q') && qn.length > 1) prefixes.push(qn.slice(1));
    const patterns = prefixes.map((p) => new RegExp(`^${escapeRegExp(p)}(?:_)?r\\d+`, 'i'));
    const patternsDash = prefixes.map((p) => new RegExp(`^${escapeRegExp(p)}-r\\d+`, 'i'));
    return allColumnNames.filter((c) => patterns.some((re) => re.test(c)) || patternsDash.some((re) => re.test(c)));
  };

  type Grid2DCellInfo = { column: string; r: number; c: number };

  const getGrid2DCellInfosForQuestion = (allColumnNames: string[], questionNumber: string): Grid2DCellInfo[] => {
    const qn = String(questionNumber || '').trim().toLowerCase();
    if (!qn) return [];
    const prefixes = [qn];
    if (qn.startsWith('q') && qn.length > 1) prefixes.push(qn.slice(1));

    const patterns = prefixes.map((p) => new RegExp(`^${escapeRegExp(p)}(?:[_-])?r(\\d+)(?:[_-])?c(\\d+)`, 'i'));

    const out: Grid2DCellInfo[] = [];
    allColumnNames.forEach((col) => {
      const raw = String(col || '').trim();
      if (!raw) return;
      for (const re of patterns) {
        const m = re.exec(raw);
        if (!m) continue;
        const r = parseInt(String(m[1] || ''), 10);
        const c = parseInt(String(m[2] || ''), 10);
        if (!Number.isFinite(r) || !Number.isFinite(c)) break;
        out.push({ column: raw, r, c });
        break;
      }
    });
    return out;
  };

  const getCellValue = (r: any, header: string) => {
    if (!r || !header) return undefined;
    if (Array.isArray(r)) {
      const target = normalizeHeaderKey(header);
      const idx = columns.findIndex((c) => normalizeHeaderKey(c) === target);
      return idx >= 0 ? r[idx] : undefined;
    }
    if (r && typeof r === 'object' && r.columns && typeof r.columns === 'object') {
      const target = normalizeHeaderKey(header);
      const key = Object.keys(r.columns).find((k) => normalizeHeaderKey(k) === target);
      return key ? r.columns[key] : undefined;
    }
    const target = normalizeHeaderKey(header);
    const key = Object.keys(r).find((k) => normalizeHeaderKey(k) === target);
    return key ? r[key] : undefined;
  };

  const resolvedRow = useMemo(() => {
    if (!rows || rows.length === 0) return null;
    // Prefer stored rowIndex, but verify it matches the record.
    const candidate = rows[result.rowIndex];
    if (candidate) {
      const rec = String(getCellValue(candidate, 'record') ?? '').trim();
      if (rec && rec === String(result.respondentId || '').trim()) return candidate;
    }
    // Fallback: find by record
    const target = String(result.respondentId || '').trim();
    if (!target) return candidate || null;
    const found = rows.find((r) => String(getCellValue(r, 'record') ?? '').trim() === target);
    return found || candidate || null;
  }, [rows, result.rowIndex, result.respondentId]);

  const ruleRows = useMemo(() => {
    const rules = enabledRules || [];
    if (!resolvedRow || rules.length === 0) return [];

    // Precompute open-end similarity across all answered OEs for this respondent (for notes + triggered state)
    const openEndRules = rules.filter((r) => r.checkTypeId === 'open_end');
    const openEndAnswered = openEndRules
      .map((r) => {
        const val = getCellValue(resolvedRow, r.questionNumber);
        const text = val === null || val === undefined ? '' : String(val).trim();
        return { rule: r, text };
      })
      .filter((x) => x.text.length > 0);

    const normalizeText = (value: string) =>
      String(value || '').toLowerCase().trim().replace(/[^\p{L}\p{N}\s]+/gu, '').replace(/\s+/g, ' ').trim();

    const tokenize = (value: string) => {
      const norm = normalizeText(value);
      return norm ? norm.split(' ').filter(Boolean) : [];
    };

    const jaccard = (aTokens: string[], bTokens: string[]) => {
      if (aTokens.length === 0 || bTokens.length === 0) return 0;
      const a = new Set(aTokens);
      const b = new Set(bTokens);
      let inter = 0;
      a.forEach((t) => { if (b.has(t)) inter += 1; });
      const union = a.size + b.size - inter;
      return union > 0 ? inter / union : 0;
    };

    const oeSimilarityByRuleId = (() => {
      const out = new Map<string, { flagged: boolean; note: string | null }>();
      if (openEndAnswered.length < 2) return out;

      const norms = openEndAnswered.map((x) => normalizeText(x.text));
      const allSame = norms.every((n) => n && n === norms[0]);
      if (allSame) {
        openEndAnswered.forEach((x) => out.set(x.rule.id, { flagged: true, note: 'Exact' }));
        return out;
      }

      const tokens = openEndAnswered.map((x) => tokenize(x.text));
      // Exact duplicates among any two
      const groups = new Map<string, number[]>();
      norms.forEach((n, i) => {
        if (!n) return;
        const arr = groups.get(n) || [];
        arr.push(i);
        groups.set(n, arr);
      });
      const exactIdx = new Set<number>();
      groups.forEach((idxs) => {
        if (idxs.length >= 2) idxs.forEach((i) => exactIdx.add(i));
      });
      exactIdx.forEach((i) => out.set(openEndAnswered[i].rule.id, { flagged: true, note: 'Exact' }));

      for (let i = 0; i < openEndAnswered.length; i++) {
        if (exactIdx.has(i)) continue;
        let best = 0;
        for (let j = 0; j < openEndAnswered.length; j++) {
          if (i === j) continue;
          best = Math.max(best, jaccard(tokens[i], tokens[j]));
        }
        if (best >= 0.85) out.set(openEndAnswered[i].rule.id, { flagged: true, note: 'Partial' });
      }

      return out;
    })();

    return rules.map((rule) => {
      if (rule.checkTypeId === 'speeding') {
        const qtimeRaw = getCellValue(resolvedRow, 'qtime');
        const qtimeSeconds = qtimeRaw === null || qtimeRaw === undefined || qtimeRaw === ''
          ? null
          : (typeof qtimeRaw === 'number' ? qtimeRaw : parseFloat(String(qtimeRaw)));
        const answered = Number.isFinite(qtimeSeconds as any);

        const underSeconds = Number((rule.config as any)?.speedingThresholdSeconds);
        const overSecondsRaw = (rule.config as any)?.speedingUpperThresholdSeconds;
        const overSeconds = overSecondsRaw === null || overSecondsRaw === undefined ? null : Number(overSecondsRaw);

        const triggeredUnder = answered && Number.isFinite(underSeconds) && underSeconds > 0 && (qtimeSeconds as number) < underSeconds;
        const triggeredOver = answered && Number.isFinite(overSeconds as any) && (overSeconds as number) > 0 && (qtimeSeconds as number) > (overSeconds as number);

        return {
          id: rule.id,
          checkTypeId: rule.checkTypeId,
          label: 'Speeding (qtime)',
          answered,
          triggered: triggeredUnder || triggeredOver,
          details: {
            qtimeSeconds,
            qtimeMinutes: Number.isFinite(qtimeSeconds as any) ? (qtimeSeconds as number) / 60 : null,
            underSeconds: Number.isFinite(underSeconds) ? underSeconds : null,
            underMinutes: Number.isFinite(underSeconds) ? underSeconds / 60 : null,
            overSeconds: Number.isFinite(overSeconds as any) ? (overSeconds as number) : null,
            overMinutes: Number.isFinite(overSeconds as any) ? (overSeconds as number) / 60 : null,
            triggeredUnder,
            triggeredOver,
          },
        };
      }

      if (rule.checkTypeId === 'open_end') {
        const val = getCellValue(resolvedRow, rule.questionNumber);
        const text = val === null || val === undefined ? '' : String(val).trim();
        const answered = text.length > 0;
        const minLength = Number((rule.config as any)?.minLength ?? 2);
        const lengthTriggered = answered && Number.isFinite(minLength) && text.length < minLength;
        const sim = oeSimilarityByRuleId.get(rule.id);
        const similarityTriggered = answered && !!sim?.flagged;
        const triggered = lengthTriggered || similarityTriggered;
        return {
          id: rule.id,
          checkTypeId: rule.checkTypeId,
          label: `Open-end (${rule.questionNumber})`,
          answered,
          triggered,
          details: {
            answer: text,
            length: text.length,
            minLength: Number.isFinite(minLength) ? minLength : null,
            lengthTriggered,
            similarityTriggered,
            similarityNote: sim?.note || null,
          },
        };
      }

      if (rule.checkTypeId === 'straightlining') {
        const qNum = String(rule.questionNumber || '').trim();
        const candidateCols = Array.isArray(resolvedRow) ? columns : Object.keys(resolvedRow || {});

        const commonSuppressed = !!(rule.config as any)?.commonStraightlineSuppressed;
        const commonRateRaw = (rule.config as any)?.commonStraightlineSuppressedRate;
        const commonRate = commonRateRaw === null || commonRateRaw === undefined ? null : Number(commonRateRaw);

        // Repeat Numerics (grouped): base question (QS11) with internal columns (QS11c1..QS11cN)
        const gridMode = String((rule.config as any)?.gridMode || '').toLowerCase();
        const numericGridColumns = (rule.config as any)?.numericGridColumns;
        if (gridMode === 'numeric_grid' && Array.isArray(numericGridColumns) && numericGridColumns.length > 0) {
          const minValuesPerColumn = Number((rule.config as any)?.minValuesPerColumn ?? 2);
          const minConstantColumnsToFlag = Number((rule.config as any)?.minConstantColumnsToFlag ?? 1);

          const valuesByC = new Map<number, number[]>();
          const allC = new Set<number>();
          const headerByRC = new Map<string, string>();
          let totalNumeric = 0;

          (numericGridColumns as any[]).forEach((colDef) => {
            const subQ = String(colDef?.questionNumber || '').trim();
            const cIdxRaw = Number(colDef?.columnIndex);
            const cIdx = Number.isFinite(cIdxRaw) && cIdxRaw > 0 ? Math.floor(cIdxRaw) : null;
            if (!subQ || cIdx === null) return;
            allC.add(cIdx);

            // Prefer Data Map response-code tokens for row headers (works for QS11c1-style exports),
            // fallback to legacy qNr# headers when needed.
            const dm = parsedQuestions.find((q: any) => normalizeQuestionNumberKey(q?.questionNumber) === normalizeQuestionNumberKey(subQ)) || null;
            const rowHeaders: string[] = (() => {
              if (dm && Array.isArray(dm.responseCodes) && dm.responseCodes.length > 0) {
                const colKeys = new Set(candidateCols.map((c) => normalizeHeaderKey(c)));
                return dm.responseCodes.map((rc: any) => {
                  const parts = [rc?.code, rc?.label, rc?.text].map((v) => String(v || '')).filter(Boolean);
                  const tokens = parts.flatMap((p) => extractDataMapHeaderTokens(p));
                  const unique = Array.from(new Set(tokens.map((t) => String(t || '').trim()).filter(Boolean)));
                  const present = unique.find((t) => colKeys.has(normalizeHeaderKey(t))) || null;
                  return present || unique[0] || '';
                });
              }

              const legacy = getStraightlineColumnNamesForQuestion(candidateCols, subQ);
              const ordered = legacy
                .map((h) => {
                  const m = String(h || '').match(/r(\d+)/i);
                  const rIdx = m ? parseInt(String(m[1] || ''), 10) : NaN;
                  return { h, rIdx };
                })
                .filter((x) => Number.isFinite(x.rIdx) && x.rIdx > 0)
                .sort((a, b) => (a.rIdx as number) - (b.rIdx as number))
                .map((x) => String(x.h || ''));
              return ordered;
            })();

            rowHeaders.forEach((h, i) => {
              const rIdx = i + 1;
              if (!headerByRC.has(`${rIdx}_${cIdx}`)) headerByRC.set(`${rIdx}_${cIdx}`, h);

              if (!h) return;
              const rawVal = getCellValue(resolvedRow, h);
              if (rawVal === null || rawVal === undefined || rawVal === '') return;
              const num = typeof rawVal === 'number' ? rawVal : parseFloat(String(rawVal));
              if (!Number.isFinite(num)) return;
              const arr = valuesByC.get(cIdx) || [];
              arr.push(num);
              valuesByC.set(cIdx, arr);
              totalNumeric += 1;
            });
          });

          const answeredAny = totalNumeric > 0;
          const eligibleColumns = Number.isFinite(minValuesPerColumn) && minValuesPerColumn > 0
            ? Array.from(allC).filter((c) => (valuesByC.get(c) || []).length >= minValuesPerColumn)
            : [];
          const eligible = eligibleColumns.length > 0;

          const constantColumns = eligibleColumns.filter((c) => {
            const vals = valuesByC.get(c) || [];
            if (vals.length < (Number.isFinite(minValuesPerColumn) ? minValuesPerColumn : 2)) return false;
            const first = vals[0];
            return vals.every((v) => Math.abs(v - first) < 1e-9);
          });

          const triggeredCandidate =
            eligible &&
            Number.isFinite(minConstantColumnsToFlag) &&
            minConstantColumnsToFlag > 0 &&
            constantColumns.length >= minConstantColumnsToFlag;

          const triggered = commonSuppressed ? false : triggeredCandidate;

          const maxWeight = Number((rule.config as any)?.maxWeight ?? 20);
          const baseMax = Number.isFinite(maxWeight) && maxWeight > 0 ? maxWeight : 20;
          const denom = Math.max(1, eligibleColumns.length);
          const ratio = constantColumns.length / denom;
          const weight = triggered ? baseMax * ratio : 0;

          const colsLabel = constantColumns
            .slice()
            .sort((a, b) => a - b)
            .map((c) => `c${c}`)
            .join(',') || null;

          const matrix = (() => {
            const colsSorted = Array.from(allC).filter((n) => Number.isFinite(n)).sort((a, b) => a - b);
            const maxRows = colsSorted.length > 0
              ? Math.max(
                  0,
                  ...colsSorted.map((cIdx) => {
                    let i = 1;
                    while (headerByRC.has(`${i}_${cIdx}`)) i += 1;
                    return i - 1;
                  })
                )
              : 0;
            const rowsSorted = Array.from({ length: maxRows }, (_, i) => i + 1);
            const cells: Record<string, string> = {};
            rowsSorted.forEach((rIdx) => {
              colsSorted.forEach((cIdx) => {
                const header = headerByRC.get(`${rIdx}_${cIdx}`) || null;
                if (!header) {
                  cells[`${rIdx}_${cIdx}`] = '';
                  return;
                }
                const v = getCellValue(resolvedRow, header);
                const raw = v === null || v === undefined ? '' : String(v).trim();
                cells[`${rIdx}_${cIdx}`] = raw;
              });
            });
            return { rows: rowsSorted, cols: colsSorted, cells };
          })();

          return {
            id: rule.id,
            checkTypeId: rule.checkTypeId,
            label: `Repeat Numerics (${rule.questionNumber})`,
            answered: answeredAny,
            triggered,
            details: {
              mode: 'grid2d_columns',
              minValuesPerColumn: Number.isFinite(minValuesPerColumn) ? minValuesPerColumn : null,
              minConstantColumnsToFlag: Number.isFinite(minConstantColumnsToFlag) ? minConstantColumnsToFlag : null,
              totalNumeric,
              totalColumns: allC.size,
              eligibleColumnsCount: eligibleColumns.length,
              constantColumns: constantColumns.slice().sort((a, b) => a - b),
              constantColumnsLabel: colsLabel,
              matrix,
              baseMax,
              weight,
              eligible,
              commonSuppressed,
              commonSuppressedRate: Number.isFinite(commonRate as any) ? (commonRate as number) : null,
            },
          };
        }

        // If this is a 2D numeric grid (r#c#), evaluate repeats by column.
        const grid2d = getGrid2DCellInfosForQuestion(candidateCols, qNum);
        if (grid2d.length > 0) {
          const minValuesPerColumn = Number((rule.config as any)?.minValuesPerColumn ?? 3);
          const minConstantColumnsToFlag = Number((rule.config as any)?.minConstantColumnsToFlag ?? 1);

          const valuesByC = new Map<number, number[]>();
          const allC = new Set<number>();
          const allR = new Set<number>();
          const headerByRC = new Map<string, string>();
          let totalNumeric = 0;

          grid2d.forEach((cell) => {
            allC.add(cell.c);
            allR.add(cell.r);
            headerByRC.set(`${cell.r}_${cell.c}`, cell.column);
            const rawVal = getCellValue(resolvedRow, cell.column);
            if (rawVal === null || rawVal === undefined || rawVal === '') return;
            const num = typeof rawVal === 'number' ? rawVal : parseFloat(String(rawVal));
            if (!Number.isFinite(num)) return;
            const arr = valuesByC.get(cell.c) || [];
            arr.push(num);
            valuesByC.set(cell.c, arr);
            totalNumeric += 1;
          });

          const answeredAny = totalNumeric > 0;
          const eligibleColumns = Number.isFinite(minValuesPerColumn) && minValuesPerColumn > 0
            ? Array.from(allC).filter((c) => (valuesByC.get(c) || []).length >= minValuesPerColumn)
            : [];
          const eligible = eligibleColumns.length > 0;

          const constantColumns = eligibleColumns.filter((c) => {
            const vals = valuesByC.get(c) || [];
            if (vals.length < (Number.isFinite(minValuesPerColumn) ? minValuesPerColumn : 3)) return false;
            const first = vals[0];
            return vals.every((v) => Math.abs(v - first) < 1e-9);
          });

          const triggeredCandidate =
            eligible &&
            Number.isFinite(minConstantColumnsToFlag) &&
            minConstantColumnsToFlag > 0 &&
            constantColumns.length >= minConstantColumnsToFlag;

          const triggered = commonSuppressed ? false : triggeredCandidate;

          const maxWeight = Number((rule.config as any)?.maxWeight ?? 20);
          const baseMax = Number.isFinite(maxWeight) && maxWeight > 0 ? maxWeight : 20;
          const denom = Math.max(1, eligibleColumns.length);
          const ratio = constantColumns.length / denom;
          const weight = triggered ? baseMax * ratio : 0;

          const colsLabel = constantColumns
            .slice()
            .sort((a, b) => a - b)
            .map((c) => `c${c}`)
            .join(',') || null;

          const columnsDetails = Array.from(allC)
            .sort((a, b) => a - b)
            .map((c) => {
              const vals = valuesByC.get(c) || [];
              const answeredCount = vals.length;
              const isEligible = Number.isFinite(minValuesPerColumn) && minValuesPerColumn > 0 ? answeredCount >= minValuesPerColumn : false;
              const isConstant = isEligible && answeredCount > 0 ? vals.every((v) => Math.abs(v - vals[0]) < 1e-9) : false;
              return {
                c,
                answeredCount,
                isEligible,
                isConstant,
                value: isConstant && answeredCount > 0 ? vals[0] : null,
              };
            });

          const matrix = (() => {
            const rowsSorted = Array.from(allR).filter((n) => Number.isFinite(n)).sort((a, b) => a - b);
            const colsSorted = Array.from(allC).filter((n) => Number.isFinite(n)).sort((a, b) => a - b);
            const cells: Record<string, string> = {};
            rowsSorted.forEach((rIdx) => {
              colsSorted.forEach((cIdx) => {
                const header = headerByRC.get(`${rIdx}_${cIdx}`) || null;
                if (!header) {
                  cells[`${rIdx}_${cIdx}`] = '';
                  return;
                }
                const v = getCellValue(resolvedRow, header);
                const raw = v === null || v === undefined ? '' : String(v).trim();
                cells[`${rIdx}_${cIdx}`] = raw;
              });
            });
            return { rows: rowsSorted, cols: colsSorted, cells };
          })();

          return {
            id: rule.id,
            checkTypeId: rule.checkTypeId,
            label: `Repeat Numerics (${rule.questionNumber})`,
            answered: answeredAny,
            triggered,
            details: {
              mode: 'grid2d_columns',
              minValuesPerColumn: Number.isFinite(minValuesPerColumn) ? minValuesPerColumn : null,
              minConstantColumnsToFlag: Number.isFinite(minConstantColumnsToFlag) ? minConstantColumnsToFlag : null,
              totalNumeric,
              totalColumns: allC.size,
              constantColumns: constantColumns.slice().sort((a, b) => a - b),
              constantColumnsLabel: colsLabel,
              columns: columnsDetails,
              matrix,
              baseMax,
              weight,
              eligible,
              commonSuppressed,
              commonSuppressedRate: Number.isFinite(commonRate as any) ? (commonRate as number) : null,
            },
          };
        }

        // Default 1D straight-lining behavior
        const cols = getStraightlineColumnNamesForQuestion(candidateCols, qNum);

        const pairs = cols.map((col) => {
          const v = getCellValue(resolvedRow, col);
          const raw = v === null || v === undefined ? '' : String(v).trim();
          return { column: String(col), value: raw, displayValue: raw === '' ? '-' : raw };
        });

        const valuesForCalc = pairs.filter((p) => p.value !== '').map((p) => p.value);
        const answeredAny = valuesForCalc.length > 0;
        const minAnswered = Number((rule.config as any)?.minAnsweredStatements ?? 4);
        const eligible = Number.isFinite(minAnswered) && minAnswered > 0
          ? valuesForCalc.length >= minAnswered
          : answeredAny;

        const valueCounts: Record<string, number> = {};
        valuesForCalc.forEach((v) => { valueCounts[v] = (valueCounts[v] || 0) + 1; });
        const maxCount = valuesForCalc.length > 0 ? Math.max(...Object.values(valueCounts)) : 0;
        const mostCommon = Object.keys(valueCounts).find((k) => valueCounts[k] === maxCount) || null;
        const percent = valuesForCalc.length > 0 ? (maxCount / valuesForCalc.length) * 100 : 0;
        const threshold = Number((rule.config as any)?.threshold ?? 80);
        const triggeredCandidate = eligible && Number.isFinite(threshold) && percent >= threshold;
        const triggered = commonSuppressed ? false : triggeredCandidate;

        const maxWeight = Number((rule.config as any)?.maxWeight ?? 20);
        const refStatements = Number((rule.config as any)?.weightReferenceStatements ?? 10);
        const statements = valuesForCalc.length;
        const statementScale = Number.isFinite(refStatements) && refStatements > 0 ? Math.min(1, statements / refStatements) : 1;
        const baseMax = (Number.isFinite(maxWeight) && maxWeight > 0 ? maxWeight : 20) * statementScale;
        const extent = Number.isFinite(threshold) ? Math.max(0, Math.min(1, (percent - threshold) / Math.max(1, (100 - threshold)))) : 0;
        const weight = triggered ? baseMax * (0.3 + 0.7 * extent) : 0;

        return {
          id: rule.id,
          checkTypeId: rule.checkTypeId,
          label: `Straight-lining (${rule.questionNumber})`,
          answered: answeredAny,
          triggered,
          details: {
            mode: 'grid1d',
            responses: pairs,
            mostCommon,
            maxCount,
            n: valuesForCalc.length,
            percent,
            threshold: Number.isFinite(threshold) ? threshold : null,
            baseMax,
            weight,
            minAnsweredStatements: Number.isFinite(minAnswered) ? minAnswered : null,
            answeredCount: valuesForCalc.length,
            eligible,
            commonSuppressed,
            commonSuppressedRate: Number.isFinite(commonRate as any) ? (commonRate as number) : null,
          },
        };
      }

      return { id: rule.id, checkTypeId: rule.checkTypeId, label: `${rule.checkTypeId} (${rule.questionNumber})`, answered: false, triggered: false, details: {} };
    });
  }, [enabledRules, resolvedRow, columns]);

  const groupedRuleRows = useMemo(() => {
    const rows = ruleRows as any[];
    const isRepeatNumerics = (rr: any) => String(rr?.label || '').startsWith('Repeat Numerics');

    const speeding = rows.filter((rr) => rr?.checkTypeId === 'speeding');
    const open_end = rows.filter((rr) => rr?.checkTypeId === 'open_end');
    const repeat_numerics = rows.filter((rr) => rr?.checkTypeId === 'straightlining' && isRepeatNumerics(rr));
    const straightlining = rows.filter((rr) => rr?.checkTypeId === 'straightlining' && !isRepeatNumerics(rr));
    const other = rows.filter((rr) => !['speeding', 'open_end', 'straightlining'].includes(String(rr?.checkTypeId || '')));

    const sortByLabel = (a: any, b: any) => String(a?.label || '').localeCompare(String(b?.label || ''));
    return {
      speeding: speeding.slice().sort(sortByLabel),
      repeat_numerics: repeat_numerics.slice().sort(sortByLabel),
      straightlining: straightlining.slice().sort(sortByLabel),
      open_end: open_end.slice().sort(sortByLabel),
      other: other.slice().sort(sortByLabel),
    };
  }, [ruleRows]);

  const scoreBreakdown = useMemo(() => {
    const totalWeight = Number((result as any)?.totalWeight ?? 0);
    const maxPossibleWeight = Number((result as any)?.maxPossibleWeight ?? 0);
    const baseScore = Number((result as any)?.baseScore ?? (result as any)?.score ?? 0);
    const confidenceWeight = Number((result as any)?.confidenceWeight ?? 1);
    const finalScore = Number((result as any)?.score ?? 0);

    const ratio = maxPossibleWeight > 0 ? totalWeight / maxPossibleWeight : 0;
    const computedBase = maxPossibleWeight > 0 ? Math.round(ratio * 100) : 0;
    const computedFinal = Math.round(computedBase * (Number.isFinite(confidenceWeight) ? confidenceWeight : 1));

    return {
      totalWeight,
      maxPossibleWeight,
      ratio,
      baseScore,
      computedBase,
      confidenceWeight,
      finalScore,
      computedFinal,
      applicableChecks: Number((result as any)?.applicableChecks ?? 0),
      flagCount: Number((result as any)?.flagCount ?? 0),
    };
  }, [result]);

  const flagCountsByCategory = useMemo(() => {
    const rows = (ruleRows as any[]) || [];
    const isRepeatNumerics = (rr: any) => String(rr?.label || '').startsWith('Repeat Numerics');
    const isSuppressedOrNotChecked = (rr: any) => rr?.details?.eligible === false || rr?.details?.commonSuppressed === true;

    const counts = {
      speeding: 0,
      repeat_numerics: 0,
      straightlining: 0,
      open_end: 0,
      other: 0,
      total: 0,
    };

    rows.forEach((rr) => {
      if (!rr?.triggered) return;
      if (isSuppressedOrNotChecked(rr)) return;

      counts.total += 1;
      if (rr.checkTypeId === 'speeding') counts.speeding += 1;
      else if (rr.checkTypeId === 'open_end') counts.open_end += 1;
      else if (rr.checkTypeId === 'straightlining' && isRepeatNumerics(rr)) counts.repeat_numerics += 1;
      else if (rr.checkTypeId === 'straightlining') counts.straightlining += 1;
      else counts.other += 1;
    });

    return counts;
  }, [ruleRows]);

  const FlagCountRow = ({
    label,
    value,
    color,
    icon: Icon,
    iconColor,
  }: { label: string; value: number; color: string; icon?: React.ComponentType<{ className?: string }>; iconColor?: string }) => (
    <div className={`flex items-center justify-between rounded px-2 py-1 ${color}`}>
      <span className="text-sm flex items-center gap-2">
        {Icon && <Icon className="w-4 h-4" style={{ color: iconColor || '#374151' }} />}
        {label}
      </span>
      <span className="font-semibold tabular-nums">{value}</span>
    </div>
  );

  const RuleTableSection = ({
    title,
    items,
    showHeader = true,
    icon: Icon,
    color,
    headerIconBg,
    headerIconBorder,
  }: {
    title: string;
    items: any[];
    showHeader?: boolean;
    icon?: React.ComponentType<{ className?: string; style?: React.CSSProperties }>;
    color?: string;
    headerIconBg?: string;
    headerIconBorder?: string;
  }) => {
    const [showAll, setShowAll] = useState(false);

    const sortByLabel = (a: any, b: any) => String(a?.label || '').localeCompare(String(b?.label || ''));

    const isHiddenByDefault = (rr: any) =>
      !rr?.answered || rr?.details?.eligible === false || rr?.details?.commonSuppressed === true;

    const visibleDefaultItems = useMemo(
      () => items.filter((rr) => !isHiddenByDefault(rr)).slice().sort(sortByLabel),
      [items]
    );
    const hiddenItems = useMemo(
      () => items.filter((rr) => isHiddenByDefault(rr)).slice().sort(sortByLabel),
      [items]
    );
    const hiddenCount = hiddenItems.length;

    const visibleItems = useMemo(() => {
      if (showAll) return [...visibleDefaultItems, ...hiddenItems];
      return visibleDefaultItems;
    }, [visibleDefaultItems, hiddenItems, showAll]);

    return (
      <div className="border border-gray-200 rounded-lg overflow-hidden bg-white">
        <div
          className="px-4 py-3 border-b border-gray-100 flex items-center justify-between"
          style={color ? { backgroundColor: `${color}14` } : { backgroundColor: '#F9FAFB' }}
        >
          <div className="flex items-center gap-2 min-w-0">
            {Icon && (
              <span
                className={`inline-flex items-center justify-center h-7 w-7 rounded-full ${
                  title === 'Speeding'
                    ? 'bg-red-100 border border-red-200'
                    : title === 'Repeat Numerics'
                      ? 'bg-orange-100 border border-orange-200'
                      : title === 'Straight-Lining'
                        ? 'bg-amber-100 border border-amber-200'
                        : title === 'Open-End Quality'
                          ? 'bg-purple-100 border border-purple-200'
                          : 'bg-gray-100 border border-gray-200'
                }`}
              >
                <Icon className="w-4 h-4 flex-shrink-0" style={{ color: color || '#4B5563' }} />
              </span>
            )}
            <div className="text-sm font-semibold text-gray-900 truncate">{title}</div>
          </div>
          <div className="flex items-center gap-3">
            {hiddenCount > 0 && (
              <button
                type="button"
                className="text-xs text-gray-700 hover:text-gray-900 underline underline-offset-2"
                onClick={() => setShowAll((v) => !v)}
              >
                {showAll ? 'Hide' : 'Show all'}
              </button>
            )}
            <div className="text-xs font-medium px-2 py-0.5 rounded-full bg-white/70 text-gray-700 border border-gray-200">
              {visibleItems.length}
            </div>
          </div>
        </div>

        {visibleItems.length === 0 ? (
          <div className="p-4 text-sm text-gray-500">None</div>
        ) : (
          <div className="overflow-hidden">
            <table className="w-full table-fixed divide-y divide-gray-200">
              {showHeader && (
                <thead className="bg-white">
                  <tr>
                    <th className="px-3 py-2 text-left text-xs font-medium text-gray-700 uppercase tracking-wider w-[50%]">Quality check</th>
                    <th className="px-3 py-2 text-left text-xs font-medium text-gray-700 uppercase tracking-wider w-[15%]">Flag</th>
                    <th className="px-3 py-2 text-left text-xs font-medium text-gray-700 uppercase tracking-wider w-[15%]">Answered</th>
                    <th className="px-3 py-2 text-left text-xs font-medium text-gray-700 uppercase tracking-wider w-[20%]">Notes</th>
                  </tr>
                </thead>
              )}
              <tbody className="bg-white divide-y divide-gray-100">
                {visibleItems.map((rr: any) => {
                  const isExpanded = expandedRuleIds.has(rr.id);
                  const notChecked = rr.details?.commonSuppressed === true || rr.details?.eligible === false;
                  const canExpand = !!rr.answered && !notChecked;
                  return (
                    <React.Fragment key={rr.id}>
                      <tr
                        className={`${canExpand ? 'cursor-pointer hover:bg-gray-50' : ''}`}
                        onClick={() => {
                          if (!canExpand) return;
                          onToggleRule(rr.id);
                        }}
                        title={canExpand ? 'Click to expand' : (rr.answered ? 'Not checked' : 'No data for this check')}
                      >
                        <td className="px-3 py-2 text-sm text-gray-900 truncate">{rr.label}</td>
                        <td className="px-3 py-2 text-sm text-gray-700">
                          {rr.triggered ? <span className="font-medium text-red-600">Yes</span> : 'No'}
                        </td>
                        <td className="px-3 py-2 text-sm text-gray-700">
                          {rr.answered ? <CheckCircleIcon className="h-5 w-5 text-green-500" /> : <span className="text-gray-300">-</span>}
                        </td>
                        <td className="px-3 py-2 text-xs text-gray-500 truncate">
                          {rr.checkTypeId === 'straightlining' && rr.details ? (
                            rr.details.commonSuppressed === true && rr.answered ? (
                              <span className="text-[11px] text-gray-600 italic">
                                Common SL{Number.isFinite(rr.details.commonSuppressedRate) ? ` (${Math.round(rr.details.commonSuppressedRate * 100)}%)` : ''}
                              </span>
                            ) : rr.details.eligible === false && rr.answered ? (
                              <span className="text-[11px] text-red-600 italic">
                                Not checked —{' '}
                                {rr.details.mode === 'grid2d_columns'
                                  ? `needs ≥${rr.details.minValuesPerColumn ?? '—'} numeric values in a column`
                                  : `needs ≥${rr.details.minAnsweredStatements ?? '—'} answered (has ${rr.details.answeredCount ?? 0})`}
                              </span>
                            ) : rr.details.mode === 'grid2d_columns' && rr.answered ? (
                              rr.details.constantColumnsLabel
                                ? <span className="text-[11px] text-gray-600 italic">Repeated: {rr.details.constantColumnsLabel}</span>
                                : <span className="text-[11px] text-gray-400 italic">No repeats</span>
                            ) : (rr.answered && rr.details.n !== undefined ? `${rr.details.maxCount ?? 0} of ${rr.details.n ?? 0}` : '')
                          ) : rr.checkTypeId === 'speeding' && rr.answered && rr.details ? (
                            Number.isFinite(rr.details.qtimeMinutes)
                              ? <span className="text-[11px] text-gray-600 italic">{rr.details.qtimeMinutes.toFixed(1)} min</span>
                              : ''
                          ) : rr.checkTypeId === 'open_end' && rr.details ? (
                            rr.answered ? (
                              (() => {
                                const lengthFlag = !!rr.details.lengthTriggered;
                                const simFlag = !!rr.details.similarityTriggered;
                                const simNote = String(rr.details.similarityNote || '').toLowerCase();

                                if (!lengthFlag && !simFlag) {
                                  return <span className="text-[11px] text-gray-400 italic">No flags</span>;
                                }

                                if (simFlag && simNote === 'exact' && lengthFlag) {
                                  return <span className="text-[11px] text-gray-600 italic">Length + repeated verbatim</span>;
                                }
                                if (simFlag && simNote === 'exact') {
                                  return <span className="text-[11px] text-gray-600 italic">Repeated verbatim</span>;
                                }
                                if (simFlag && simNote === 'partial' && lengthFlag) {
                                  return <span className="text-[11px] text-gray-600 italic">Length + repeated (partial)</span>;
                                }
                                if (simFlag && simNote === 'partial') {
                                  return <span className="text-[11px] text-gray-600 italic">Repeated (partial)</span>;
                                }
                                if (lengthFlag) {
                                  return <span className="text-[11px] text-gray-600 italic">Length flag</span>;
                                }
                                return <span className="text-[11px] text-gray-600 italic">Flag</span>;
                              })()
                            ) : (
                              <span className="text-[11px] text-gray-400 italic">No response</span>
                            )
                          ) : (!rr.answered ? <span className="text-[11px] text-gray-400 italic">No response</span> : '')}
                        </td>
                      </tr>

                      {isExpanded && rr.answered && (
                        <tr className="bg-gray-50">
                          <td className="px-3 py-3 text-sm text-gray-800" colSpan={4}>
                            {(rr.label.startsWith('Straight-lining') || rr.label.startsWith('Repeat Numerics')) && (
                              <div className="space-y-3">
                                {rr.details.commonSuppressed === true && (
                                  <div className="text-xs text-gray-700">
                                    Not evaluated because this is a common straight-line across respondents
                                    {Number.isFinite(rr.details.commonSuppressedRate) ? ` (${Math.round(rr.details.commonSuppressedRate * 100)}% flagged).` : '.'}
                                  </div>
                                )}
                                {rr.details.eligible === false && (
                                  <div className="text-xs text-gray-700">
                                    {rr.details.mode === 'grid2d_columns'
                                      ? (
                                        <>
                                          Not evaluated because no column has at least{' '}
                                          <span className="font-medium text-gray-900">{rr.details.minValuesPerColumn ?? '—'}</span>{' '}
                                          numeric values.
                                        </>
                                      )
                                      : (
                                        <>
                                          Not evaluated because this respondent has only{' '}
                                          <span className="font-medium text-gray-900">{rr.details.answeredCount ?? 0}</span>{' '}
                                          answered statements (minimum required: {rr.details.minAnsweredStatements ?? '—'}).
                                        </>
                                      )}
                                  </div>
                                )}
                                {(rr.details.commonSuppressed === true || rr.details.eligible === false) ? null : rr.details.mode === 'grid2d_columns' ? (
                                  <>
                                    <div className="text-xs text-gray-600">
                                      Constant columns: <span className="font-medium text-gray-900">{(rr.details.constantColumns || []).length}</span>
                                      {rr.details.totalColumns ? ` of ${rr.details.totalColumns}` : ''}{' '}
                                      {rr.details.constantColumnsLabel ? `(${rr.details.constantColumnsLabel})` : ''}
                                    </div>
                                    <div className="text-xs text-gray-600">
                                      Weight: <span className="font-medium text-gray-900">{Number(rr.details.weight || 0).toFixed(1)}</span> / max {Number(rr.details.baseMax || 0).toFixed(1)}
                                    </div>
                                    <div className="overflow-auto border border-gray-200 rounded bg-white">
                                      <table className="min-w-full table-auto divide-y divide-gray-200">
                                        <thead className="bg-white sticky top-0">
                                          <tr>
                                            <th className="px-2 py-1 text-left text-[11px] font-medium text-gray-600 whitespace-nowrap"> </th>
                                            {(rr.details.matrix?.cols || []).map((cIdx: number) => (
                                              <th key={cIdx} className="px-2 py-1 text-center text-[11px] font-medium text-gray-600 whitespace-nowrap">{`c${cIdx}`}</th>
                                            ))}
                                          </tr>
                                        </thead>
                                        <tbody className="bg-white divide-y divide-gray-100">
                                          {(rr.details.matrix?.rows || []).map((rIdx: number) => (
                                            <tr key={rIdx}>
                                              <td className="px-2 py-1 text-xs text-gray-700 font-medium whitespace-nowrap">{`r${rIdx}`}</td>
                                              {(rr.details.matrix?.cols || []).map((cIdx: number) => {
                                                const raw = String(rr.details.matrix?.cells?.[`${rIdx}_${cIdx}`] ?? '');
                                                const has = raw.trim().length > 0;
                                                return (
                                                  <td
                                                    key={`${rIdx}_${cIdx}`}
                                                    className={[
                                                      'px-2 py-1 text-xs whitespace-nowrap tabular-nums text-center',
                                                      has ? 'text-gray-900' : 'text-gray-300',
                                                    ].join(' ')}
                                                  >
                                                    {has ? raw : '—'}
                                                  </td>
                                                );
                                              })}
                                            </tr>
                                          ))}
                                        </tbody>
                                      </table>
                                    </div>
                                  </>
                                ) : (
                                  <>
                                    <div className="text-xs text-gray-600">
                                      Most common: <span className="font-medium text-gray-900">{rr.details.mostCommon ?? '—'}</span> |{' '}
                                      {rr.details.maxCount} of {rr.details.n} ({rr.details.percent.toFixed(1)}%) | Threshold: {rr.details.threshold ?? '—'}%
                                    </div>
                                    <div className="text-xs text-gray-600">
                                      Weight: <span className="font-medium text-gray-900">{rr.details.weight.toFixed(1)}</span> / max {rr.details.baseMax.toFixed(1)}
                                    </div>
                                    <div className="overflow-auto border border-gray-200 rounded">
                                      <table className="w-full table-fixed divide-y divide-gray-200">
                                        <thead className="bg-white">
                                          <tr>
                                            <th className="px-2 py-1 text-left text-[11px] font-medium text-gray-600 w-[50%]">Column</th>
                                            <th className="px-2 py-1 text-left text-[11px] font-medium text-gray-600 w-[50%]">Value</th>
                                          </tr>
                                        </thead>
                                        <tbody className="bg-white divide-y divide-gray-100">
                                          {rr.details.responses.map((p: any, i: number) => (
                                            <tr key={i}>
                                              <td className="px-2 py-1 text-xs text-gray-700 truncate">{p.column}</td>
                                              <td className="px-2 py-1 text-xs text-gray-900 truncate">{p.displayValue ?? p.value ?? '-'}</td>
                                            </tr>
                                          ))}
                                        </tbody>
                                      </table>
                                    </div>
                                  </>
                                )}
                              </div>
                            )}

                            {rr.label.startsWith('Open-end') && (
                              <div className="space-y-2">
                                <div className="text-xs text-gray-600">
                                  Length: <span className="font-medium text-gray-900">{rr.details.length}</span> | Min length: {rr.details.minLength ?? '—'}
                                </div>
                                {rr.details.similarityTriggered && (
                                  <div className="text-xs text-gray-600">
                                    Similarity: <span className="font-medium text-gray-900">{rr.details.similarityNote || 'Similar'}</span>
                                  </div>
                                )}
                                <div className="text-sm text-gray-900 whitespace-pre-wrap border border-gray-200 rounded p-2 bg-white">
                                  {rr.details.answer || '—'}
                                </div>
                              </div>
                            )}

                            {rr.label.startsWith('Speeding') && (
                              <div className="space-y-2 text-xs text-gray-700">
                                <div>
                                  qtime: <span className="font-medium text-gray-900">{rr.details.qtimeSeconds ?? '—'}s</span>
                                  {Number.isFinite(rr.details.qtimeMinutes) ? ` (${rr.details.qtimeMinutes.toFixed(1)} min)` : ''}
                                </div>
                                <div>
                                  Under threshold: {rr.details.underSeconds !== null ? `${rr.details.underSeconds}s (${rr.details.underMinutes.toFixed(1)} min)` : '—'} | Triggered: {rr.details.triggeredUnder ? 'Yes' : 'No'}
                                </div>
                                <div>
                                  Over threshold: {rr.details.overSeconds !== null ? `${rr.details.overSeconds}s (${rr.details.overMinutes.toFixed(1)} min)` : '—'} | Triggered: {rr.details.triggeredOver ? 'Yes' : 'No'}
                                </div>
                              </div>
                            )}
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-4xl mx-4 max-h-[85vh] overflow-hidden flex flex-col">
        <div
          className={[
            'flex items-center justify-between px-6 py-4 border-b border-gray-200',
            result.score >= 41 ? 'bg-red-50' : result.score >= 21 ? 'bg-yellow-50' : 'bg-green-50',
          ].join(' ')}
        >
          <div>
            <div className="text-lg font-semibold text-gray-900 flex items-center gap-2">
              <span>Record {result.respondentId}</span>
              <span
                className={[
                  'inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold whitespace-nowrap',
                  result.score >= 41
                    ? 'bg-red-200 text-red-900'
                    : result.score >= 21
                      ? 'bg-yellow-200 text-yellow-900'
                      : 'bg-green-200 text-green-900',
                ].join(' ')}
              >
                {result.score >= 41 ? 'BAD' : result.score >= 21 ? 'MODERATE' : 'GOOD'} ({result.score})
              </span>
            </div>
            <div className="text-xs text-gray-500">Click an answered check to expand</div>
          </div>
          <button type="button" onClick={onClose} className="text-gray-400 hover:text-gray-600 transition-colors">
            <XMarkIcon className="w-6 h-6" />
          </button>
        </div>

        <div className="p-4 overflow-auto">
          {!resolvedRow ? (
            <div className="text-sm text-gray-500">Row data not found for this record.</div>
          ) : (
            <div className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div className="mt-1 flex flex-col gap-2 text-sm">
                  <FlagCountRow label="Speeding" value={flagCountsByCategory.speeding} color="bg-red-100 text-red-900 border border-red-200" icon={ClockIcon} iconColor="#EF4444" />
                  <FlagCountRow label="Open-End" value={flagCountsByCategory.open_end} color="bg-purple-100 text-purple-900 border border-purple-200" icon={ChatBubbleBottomCenterTextIcon} iconColor="#8B5CF6" />
                  <FlagCountRow label="Straight-Lining" value={flagCountsByCategory.straightlining} color="bg-amber-100 text-amber-900 border border-amber-200" icon={Bars3Icon} iconColor="#F59E0B" />
                  <FlagCountRow label="Repeat Numerics" value={flagCountsByCategory.repeat_numerics} color="bg-orange-100 text-orange-900 border border-orange-200" icon={CalculatorIcon} iconColor={BRAND_ORANGE} />
                  {!!flagCountsByCategory.other && (
                    <FlagCountRow label="Other" value={flagCountsByCategory.other} color="bg-gray-100 text-gray-900 border border-gray-200" />
                  )}
                </div>

                <div className="border border-gray-200 rounded-lg bg-white p-3">
                  <div className="text-xs font-semibold text-gray-700 uppercase tracking-wide">Score calculation</div>
                  <div className="mt-2 text-sm text-gray-700 space-y-1">
                    <div className="flex items-center justify-between">
                      <span>Weights</span>
                      <span className="font-medium text-gray-900 tabular-nums">
                        {scoreBreakdown.totalWeight.toFixed(1)} / {scoreBreakdown.maxPossibleWeight.toFixed(1)}
                      </span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span>Base score</span>
                      <span className="font-medium text-gray-900 tabular-nums">
                        {scoreBreakdown.computedBase}%
                      </span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span>Confidence weight</span>
                      <span className="font-medium text-gray-900 tabular-nums">
                        {Number.isFinite(scoreBreakdown.confidenceWeight) ? scoreBreakdown.confidenceWeight.toFixed(2) : '—'}
                      </span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span>Final score</span>
                      <span className="font-semibold text-gray-900 tabular-nums">
                        {Number.isFinite(scoreBreakdown.finalScore) ? scoreBreakdown.finalScore : scoreBreakdown.computedFinal}
                      </span>
                    </div>
                    <div className="pt-1 text-xs text-gray-500">
                      Flags: {scoreBreakdown.flagCount} • Applicable checks: {scoreBreakdown.applicableChecks}
                    </div>
                  </div>
                </div>
              </div>

              <RuleTableSection
                title="Speeding"
                items={(groupedRuleRows as any).speeding || []}
                icon={ClockIcon}
                color="#EF4444"
                headerIconBg="bg-red-100 border border-red-200"
              />
              <RuleTableSection
                title="Repeat Numerics"
                items={(groupedRuleRows as any).repeat_numerics || []}
                icon={CalculatorIcon}
                color={BRAND_ORANGE}
                headerIconBg="bg-orange-100 border border-orange-200"
              />
              <RuleTableSection
                title="Straight-Lining"
                items={(groupedRuleRows as any).straightlining || []}
                icon={Bars3Icon}
                color="#F59E0B"
                headerIconBg="bg-amber-100 border border-amber-200"
              />
              <RuleTableSection
                title="Open-End Quality"
                items={(groupedRuleRows as any).open_end || []}
                icon={ChatBubbleBottomCenterTextIcon}
                color="#8B5CF6"
                headerIconBg="bg-purple-100 border border-purple-200"
              />
              {!!((groupedRuleRows as any).other || []).length && (
                <RuleTableSection title="Other" items={(groupedRuleRows as any).other || []} />
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
