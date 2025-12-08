import React, { useState, useEffect, useRef } from 'react';
import { CloudArrowUpIcon, TrashIcon, MagnifyingGlassIcon, ArrowPathIcon, CheckCircleIcon } from '@heroicons/react/24/outline';
import { API_BASE_URL } from '../../config';
import { RawDataViewer } from './RawDataViewer';
import { Variable } from '../../utils/tabs/types';
import * as XLSX from 'xlsx';

const BRAND_ORANGE = '#D14A2D';

interface DataTabProps {
  selectedQuestionnaire: any | null;
  selectedProject: any | null;
  fullRawData: { columns: string[]; rows: any[] } | null;
  loadingFullRawData: boolean;
  rawDataPage: number;
  rawDataRowsPerPage: number;
  rawDataColumnStart: number;
  rawDataColumnsPerPage: number;
  onPageChange: (page: number) => void;
  onColumnChange: (start: number) => void;
  columnMapping: Record<string, string>;
  variables: Variable[];
  questionnaireQuestions: any[];
  datamapData: any;
  loadingDatamap: boolean;
  columnHeaders: string[];
  hasAttemptedMapping: boolean;
  mappingVariables: boolean;
  getExpectedHeadersForQuestion: (question: any, baseQuestionNumber?: string) => string[];
  getExpectedColumnHeadersForBase: (baseQuestionNumber: string, allVariables: Variable[]) => string[];
  dataMappingMemo: { filteredHeaders: string[]; mappingStatusMap: Map<string, { isMapped: boolean; mappedColumnHeader: string; mappedVariableName: string }> };
  savedCodingThemes?: Map<string, Array<{ code: number; theme: string }>>;
  codedHeadersDebug?: Record<string, string[]>;
  onDataUploaded?: () => void;
  onDataDeleted?: () => void;
  onColumnHeadersChange?: (headers: string[]) => void;
  onColumnMappingChange?: (mapping: Record<string, string>) => void;
  onPerformAutomaticMapping?: (forceRemap: boolean) => void;
  onLoadDatamap?: (force?: boolean) => void;
  onClearDatamap?: () => void;
  onSetQuestionnaireQuestions?: (questions: any[]) => void;
  onSetHasAttemptedMapping?: (value: boolean) => void;
  onSetMappingVariables?: (value: boolean) => void;
  onSetShowMappingInfoModal?: (value: boolean) => void;
  onSetShowManualMappingModal?: (value: boolean) => void;
  onSetSelectedMappingHeader?: (header: string | null) => void;
  onSetManualMappingSearch?: (search: string) => void;
}

interface UploadedFileInfo {
  fileName: string;
  uploadedAt: string;
  processed: boolean;
}

export const DataTab: React.FC<DataTabProps> = ({
  selectedQuestionnaire,
  selectedProject,
  fullRawData,
  loadingFullRawData,
  rawDataPage,
  rawDataRowsPerPage,
  rawDataColumnStart,
  rawDataColumnsPerPage,
  onPageChange,
  onColumnChange,
  columnMapping,
  variables,
  questionnaireQuestions,
  datamapData,
  loadingDatamap,
  columnHeaders,
  hasAttemptedMapping,
  mappingVariables,
  getExpectedHeadersForQuestion,
  getExpectedColumnHeadersForBase,
  dataMappingMemo,
  savedCodingThemes = new Map(),
  codedHeadersDebug = {},
  onDataUploaded,
  onDataDeleted,
  onColumnHeadersChange,
  onColumnMappingChange,
  onPerformAutomaticMapping,
  onLoadDatamap,
  onClearDatamap,
  onSetQuestionnaireQuestions,
  onSetHasAttemptedMapping,
  onSetMappingVariables,
  onSetShowMappingInfoModal,
  onSetShowManualMappingModal,
  onSetSelectedMappingHeader,
  onSetManualMappingSearch,
}) => {
  const [uploadedFileInfo, setUploadedFileInfo] = useState<UploadedFileInfo | null>(null);
  const [uploadingFile, setUploadingFile] = useState(false);
  const [dataFile, setDataFile] = useState<File | null>(null);
  const [dataTabView, setDataTabView] = useState<'variables' | 'rawdata' | 'datamap'>('variables');
  const [qnrVariableSearch, setQnrVariableSearch] = useState('');
  const [datamapSearch, setDatamapSearch] = useState('');
  const [expandedDatamapRows, setExpandedDatamapRows] = useState<Set<number>>(new Set());
  const fileInputRef = useRef<HTMLInputElement>(null);
  const isUploadingNewFileRef = useRef(false);
  const fullRawDataRef = useRef(fullRawData);

  // Keep ref in sync with prop
  useEffect(() => {
    fullRawDataRef.current = fullRawData;
  }, [fullRawData]);

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
          const isMapped = !!(data.columnMapping && Object.keys(data.columnMapping).length > 0);
          
          if (cancelled) return;
          
          setUploadedFileInfo({
            fileName: data.originalFileName || data.fileName || 'Unknown',
            uploadedAt: data.uploadedAt || new Date().toISOString(),
            processed: isMapped
          });

          // Load column headers if available
          if (data.columnHeaders && Array.isArray(data.columnHeaders) && data.columnHeaders.length > 0) {
            onColumnHeadersChange?.(data.columnHeaders);
          }

          // Load column mapping if available and not uploading a new file
          if (!isUploadingNewFileRef.current && data.columnMapping && Object.keys(data.columnMapping).length > 0) {
            onColumnMappingChange?.(data.columnMapping);
          }
        } else {
          if (cancelled) return;
          setUploadedFileInfo(null);
        }
      } catch (error) {
        if (cancelled) return;
        // Only log if it's not a cancelled request
        if (error instanceof Error && error.name !== 'AbortError') {
          console.error('Error loading file info:', error);
        }
        setUploadedFileInfo(null);
      }
    };

    loadFileInfo();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedQuestionnaire?.id]);

  // Update file info when fullRawData loads (to update respondents count)
  useEffect(() => {
    if (uploadedFileInfo && fullRawData?.rows && fullRawData.rows.length > 0 && !uploadingFile) {
      // The file info is already set, and fullRawData has loaded
      // The respondents count will automatically update because it reads from fullRawData?.rows?.length
      // This effect just ensures the component re-renders when data loads
    }
  }, [fullRawData?.rows?.length, uploadedFileInfo, uploadingFile]);

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !selectedQuestionnaire) {
      return;
    }

    setDataFile(file);
    isUploadingNewFileRef.current = true;

    // Clear mapping state when uploading a new file
    onColumnMappingChange?.({});

    try {
      setUploadingFile(true);
      
      // Parse headers first to get column headers immediately
      const parsedHeaders = await new Promise<string[]>((resolve, reject) => {
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
            resolve(filteredHeaders);
          } catch (error) {
            reject(error);
          }
        };
        
        reader.onerror = () => {
          reject(new Error('Failed to read file'));
        };
        
        if (isCSV) {
          reader.readAsText(file);
        } else {
          reader.readAsArrayBuffer(file);
        }
      });
      
      if (parsedHeaders.length > 0) {
        onColumnHeadersChange?.(parsedHeaders);
      }

      // Upload file to server
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
        
        // Update file info immediately (will show 0 initially, will update when data loads)
        setUploadedFileInfo({
          fileName: result.originalFileName || result.fileName || file.name,
          uploadedAt: new Date().toISOString(),
          processed: false
        });

        // Clear mapping since this is a new file
        onColumnMappingChange?.({});

        // Notify parent that data was uploaded (this will trigger fullRawData reload)
        onDataUploaded?.();
        
        // Automatically load datamap after file upload
        onLoadDatamap?.(true);
        
        // Automatically switch to raw data tab after upload
        setDataTabView('rawdata');
        
        // Wait for minimum 1 second to show loading spinner
        await new Promise(resolve => setTimeout(resolve, 1000));
      } else {
        const error = await response.json();
        alert(`Failed to upload file: ${error.error || 'Unknown error'}`);
      }
    } catch (error: any) {
      console.error('Error uploading file:', error);
      alert(`Failed to upload file: ${error.message || 'Unknown error'}`);
    } finally {
      setUploadingFile(false);
      isUploadingNewFileRef.current = false;
      
      // Reset file input
      if (e.target) {
        e.target.value = '';
      }
    }
  };

  const handleDeleteFile = async () => {
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
        onColumnHeadersChange?.([]);
        onColumnMappingChange?.({});
        
        // Clear datamap when file is deleted
        onClearDatamap?.();
        
        // Notify parent that data was deleted
        onDataDeleted?.();
      } else {
        const error = await response.json();
        alert(`Failed to delete file: ${error.error || 'Unknown error'}`);
      }
    } catch (error: any) {
      console.error('Error deleting file:', error);
      alert(`Failed to delete file: ${error.message || 'Unknown error'}`);
    }
  };

  return (
    <div className="p-6">
      {/* File Upload Section */}
      <div className="mb-6">
        <div className="flex items-center gap-3 mb-4">
          <h3 className="text-lg font-semibold text-gray-900">Data File</h3>
          {!uploadedFileInfo && (
            <button
              onClick={() => fileInputRef.current?.click()}
              disabled={uploadingFile}
              className="flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium text-white rounded shadow-sm transition-colors hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed"
              style={{ backgroundColor: BRAND_ORANGE }}
            >
              <CloudArrowUpIcon className="h-3.5 w-3.5" />
              {uploadingFile ? 'Uploading...' : 'Upload Data File'}
            </button>
          )}
        </div>

        {uploadingFile && (
          <div className="border border-gray-200 rounded-lg overflow-hidden">
            <div className="p-8 text-center">
              <div className="mx-auto mb-4 h-12 w-12 animate-spin rounded-full border-4 border-gray-200 border-t-[#D14A2D]"></div>
              <p className="text-sm text-gray-700">Uploading and processing data file...</p>
            </div>
          </div>
        )}

        {!uploadedFileInfo && !uploadingFile && (
          <div className="text-left mb-4">
            <p className="text-sm text-gray-500">No data file uploaded</p>
            <p className="text-xs text-gray-400 mt-2">Click the "Upload Data File" button to get started</p>
          </div>
        )}

        {uploadedFileInfo && !uploadingFile && (
          <div className="border border-gray-200 rounded-lg overflow-hidden">
            <table className="w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">File Name</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Date Uploaded</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Respondents</th>
                  <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider whitespace-nowrap"></th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                <tr>
                  <td className="px-4 py-3 text-sm text-gray-500 truncate" title={uploadedFileInfo.fileName}>
                    {uploadedFileInfo.fileName}
                  </td>
                  <td className="px-4 py-3 text-sm text-gray-500">
                    {new Date(uploadedFileInfo.uploadedAt).toLocaleDateString()} {new Date(uploadedFileInfo.uploadedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                  </td>
                  <td className="px-4 py-3 text-sm text-gray-500">
                    {fullRawData?.rows?.length ?? (loadingFullRawData ? 'Loading...' : 0)}
                  </td>
                  <td className="px-4 py-3 text-sm text-right whitespace-nowrap">
                    <div className="flex items-center justify-end gap-2">
                      <button
                        onClick={handleDeleteFile}
                        className="flex items-center justify-center p-1 text-red-600 hover:text-red-700 hover:bg-red-50 rounded transition-colors"
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
        )}

        {/* Hidden file input */}
        <input
          ref={fileInputRef}
          type="file"
          id="data-file-upload"
          accept=".xlsx,.xls,.csv"
          onChange={handleFileUpload}
          className="hidden"
        />
      </div>

      {/* Three Views: QNR Variables, Data Map, Raw Data */}
      <div className="mt-6">
        {/* View Tabs */}
        <div className="flex items-center gap-3 mb-3">
          <button
            onClick={() => setDataTabView('variables')}
            className={`text-sm font-semibold px-3 py-1.5 rounded cursor-pointer transition-colors ${
              dataTabView === 'variables'
                ? 'text-white'
                : 'text-gray-900 bg-white border border-gray-300 hover:bg-gray-50'
            }`}
            style={dataTabView === 'variables' ? { backgroundColor: BRAND_ORANGE } : {}}
          >
            QNR Variables {questionnaireQuestions.length > 0 ? <span className="font-normal text-xs ml-1">({questionnaireQuestions.length})</span> : variables.length > 0 ? <span className="font-normal text-xs ml-1">({variables.length})</span> : ''}
          </button>
          <button
            onClick={() => uploadedFileInfo && setDataTabView('datamap')}
            disabled={!uploadedFileInfo}
            className={`text-sm font-semibold px-3 py-1.5 rounded transition-colors ${
              !uploadedFileInfo
                ? 'text-gray-400 bg-gray-100 border border-gray-200 cursor-not-allowed'
                : dataTabView === 'datamap'
                ? 'text-white cursor-pointer'
                : 'text-gray-900 bg-white border border-gray-300 hover:bg-gray-50 cursor-pointer'
            }`}
            style={dataTabView === 'datamap' && uploadedFileInfo ? { backgroundColor: BRAND_ORANGE } : {}}
          >
            Data Map {datamapData?.parsedQuestions?.length > 0 ? <span className="font-normal text-xs ml-1">({datamapData.parsedQuestions.length})</span> : ''}
          </button>
          <button
            onClick={() => uploadedFileInfo && setDataTabView('rawdata')}
            disabled={!uploadedFileInfo}
            className={`text-sm font-semibold px-3 py-1.5 rounded transition-colors ${
              !uploadedFileInfo
                ? 'text-gray-400 bg-gray-100 border border-gray-200 cursor-not-allowed'
                : dataTabView === 'rawdata'
                ? 'text-white cursor-pointer'
                : 'text-gray-900 bg-white border border-gray-300 hover:bg-gray-50 cursor-pointer'
            }`}
            style={dataTabView === 'rawdata' && uploadedFileInfo ? { backgroundColor: BRAND_ORANGE } : {}}
          >
            Raw Data {columnHeaders.length > 0 ? <span className="font-normal text-xs ml-1">({columnHeaders.length})</span> : ''}
          </button>
        </div>

          {/* QNR Variables View */}
          {dataTabView === 'variables' && (
            <>
              <div className="mb-3 flex items-center gap-3">
                <div className="relative flex-1">
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
                <button
                  onClick={async () => {
                    // Automatically map by finding matches
                    if (selectedQuestionnaire && selectedProject && uploadedFileInfo) {
                      // Perform automatic mapping (handles minimum 2-second delay internally)
                      if (onPerformAutomaticMapping) {
                        await onPerformAutomaticMapping(true);
                      } else {
                        console.error('onPerformAutomaticMapping is not defined');
                        alert('Mapping function not available');
                      }
                    } else {
                      if (!uploadedFileInfo) {
                        alert('Please upload a data file first');
                      } else if (!selectedQuestionnaire) {
                        alert('Please select a questionnaire');
                      } else if (!selectedProject) {
                        alert('Please select a project');
                      }
                    }
                  }}
                  disabled={mappingVariables || !selectedQuestionnaire || !selectedProject || !uploadedFileInfo}
                  className="flex items-center gap-2 px-3 py-1.5 text-sm rounded-lg disabled:opacity-50 disabled:cursor-not-allowed transition-colors whitespace-nowrap text-white hover:opacity-90"
                  style={{ backgroundColor: BRAND_ORANGE }}
                  title="Automatically map QNR variables to data file columns by finding matches"
                >
                  <ArrowPathIcon className={`h-4 w-4 ${mappingVariables ? 'animate-spin' : ''}`} />
                  {mappingVariables ? 'Mapping...' : 'Map'}
                </button>
              </div>
              <div className="border border-gray-200 rounded-lg overflow-hidden flex flex-col">
                <div className="overflow-y-auto overflow-x-auto" style={{ maxHeight: '600px' }}>
                  {(() => {
                    // Calculate total counts by simulating the exact rendering logic
                    // This ensures the count matches exactly what's displayed (yellow vs green pills)
                    let totalMappedCount = 0;
                    let totalUnmappedCount = 0;
                    
                    if (questionnaireQuestions.length > 0) {
                      let questionsToCount = [...questionnaireQuestions];
                      
                      // Apply same search filter if active (same as rendering)
                      if (qnrVariableSearch.trim()) {
                        const searchLower = qnrVariableSearch.toLowerCase();
                        questionsToCount = questionsToCount.filter(question => {
                          const qNum = question.number || question.id;
                          const qNumStr = String(qNum);
                          let questionType = question.type || '';
                          
                          // Convert numeric lists to numeric grids
                          if (questionType.toLowerCase().includes('numeric list')) {
                            questionType = 'Numeric grid';
                          }
                          
                          const expectedHeaders = getExpectedHeadersForQuestion(question);
                          
                          const matchesBase = qNumStr.toLowerCase().includes(searchLower);
                          const matchesType = questionType.toLowerCase().includes(searchLower);
                          const matchesExpected = expectedHeaders.some(h => h.toLowerCase().includes(searchLower));
                          return matchesBase || matchesType || matchesExpected;
                        });
                      }
                      
                      // Process each question exactly as it's rendered
                      questionsToCount.forEach(question => {
                        const qNum = question.number || question.id;
                        const qNumStr = String(qNum);
                        let questionType = question.type || '';
                        const baseQuestionNumber = qNumStr.replace(/^Q/i, '');
                        const baseLower = baseQuestionNumber.toLowerCase();
                        
                        // Get expected headers (same as rendering)
                        let expectedHeaders = getExpectedHeadersForQuestion(question, baseQuestionNumber);
                        
                        // Apply same logic as rendering for open end questions with coded themes
                        try {
                          const isOpenEndType = questionType.toLowerCase().includes('open end') && !questionType.toLowerCase().includes('list');
                          const savedThemesArr =
                            (savedCodingThemes?.get(qNumStr.replace(/^Q/, '')) ||
                             savedCodingThemes?.get(`Q${qNumStr.replace(/^Q/, '')}`) ||
                             []) as Array<{ code: number; theme: string }>;
                          const hasSavedThemes = Array.isArray(savedThemesArr) && savedThemesArr.length > 0;
                          
                          if (isOpenEndType && hasSavedThemes) {
                            const headersSource: string[] = (fullRawData && fullRawData.columns && fullRawData.columns.length > 0)
                              ? fullRawData.columns : columnHeaders;
                            const codedCols = headersSource.filter(col => {
                              const cl = String(col).toLowerCase();
                              return (cl.startsWith(baseLower + 'r') || cl.startsWith('q' + baseLower + 'r')) && /r\d+$/.test(cl);
                            });
                            if (codedCols.length > 0) {
                              const qPrefixed = codedCols.map(c => (String(c).startsWith('Q') || String(c).startsWith('q')) ? String(c).replace(/^q/i, 'Q') : `Q${c}`);
                              const set = new Set(expectedHeaders.map(h => h.replace(/_/g, '')));
                              qPrefixed.forEach(h => {
                                const norm = h.replace(/_/g, '');
                                if (!set.has(norm)) {
                                  set.add(norm);
                                  expectedHeaders.push(h);
                                }
                              });
                            }
                            const codedFromVars = codedHeadersDebug?.[`Q${qNumStr}`] || codedHeadersDebug?.[String(qNumStr)] || codedHeadersDebug?.[baseLower] || [];
                            if (codedFromVars.length > 0) {
                              const set = new Set(expectedHeaders.map(h => h.replace(/_/g, '')));
                              codedFromVars.forEach(h => {
                                const norm = h.replace(/_/g, '');
                                if (!set.has(norm)) {
                                  set.add(norm);
                                  expectedHeaders.push(h);
                                }
                              });
                            }
                          }
                        } catch {}
                        
                        // Count each header using exact same logic as rendering
                        expectedHeaders.forEach(expectedHeader => {
                          // Use exact same mapping check as rendering (line 795)
                          const mappedColumn = columnMapping[expectedHeader] || columnMapping[expectedHeader.replace(/^Q/, '')] || '';
                          const isMapped = !!mappedColumn;

                          if (isMapped) {
                            totalMappedCount++;
                          } else {
                            totalUnmappedCount++;
                          }
                        });
                      });
                    }
                    
                    return (
                      <table className="w-full table-fixed border-collapse border border-gray-300">
                        <thead className="bg-gray-50 sticky top-0">
                          <tr>
                            <th className="px-4 py-2 text-left text-xs font-medium text-gray-700 uppercase tracking-wider border border-gray-300" style={{ width: '15%' }}>Q#</th>
                            <th className="px-4 py-2 text-left text-xs font-medium text-gray-700 uppercase tracking-wider border border-gray-300" style={{ width: '20%' }}>Question Type</th>
                            <th className="px-4 py-2 text-left text-xs font-medium text-gray-700 uppercase tracking-wider border border-gray-300" style={{ width: '32.5%' }}>
                              Expected Variables (Unmapped: {totalUnmappedCount})
                            </th>
                            <th className="px-4 py-2 text-left text-xs font-medium text-gray-700 uppercase tracking-wider border border-gray-300" style={{ width: '32.5%' }}>
                              Mapped ({totalMappedCount})
                            </th>
                          </tr>
                        </thead>
                        <tbody className="bg-white">
                          {questionnaireQuestions.length > 0 ? (() => {
                            // Iterate through all questions from the QNR
                            let questionsToShow = [...questionnaireQuestions];

                            // Apply search filter
                            if (qnrVariableSearch.trim()) {
                              const searchLower = qnrVariableSearch.toLowerCase();
                              questionsToShow = questionsToShow.filter(question => {
                                const qNum = question.number || question.id;
                                const qNumStr = String(qNum);
                                let questionType = question.type || '';
                                
                                // Convert numeric lists to numeric grids
                                const typeLower = questionType.toLowerCase();
                                if (typeLower.includes('numeric list')) {
                                  questionType = 'Numeric Grid';
                                } else if (typeLower.includes('numeric grid')) {
                                  questionType = 'Numeric Grid';
                                }
                                
                                // For numeric grids, generate expected headers from QNR: rows × columns
                                let expectedHeaders: string[] = [];
                                const isNumericGrid = typeLower.includes('numeric grid') || typeLower.includes('numeric list');
                                
                                if (isNumericGrid) {
                                  // Get row codes (statementOptions)
                                  const rowCodes: string[] = [];
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
                                  
                                  // Get column codes (responseOptions)
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
                                    if (colCodes.length > 0) {
                                      // Sort columns numerically
                                      const sortedColCodes = [...colCodes].sort((a, b) => {
                                        const aNum = parseInt(a.match(/c?(\d+)/i)?.[1] || '0', 10);
                                        const bNum = parseInt(b.match(/c?(\d+)/i)?.[1] || '0', 10);
                                        return aNum - bNum;
                                      });
                                      
                                      // Generate headers grouped by column: all c1 first, then all c2, etc.
                                      sortedColCodes.forEach(colCode => {
                                        const colNumberMatch = colCode.match(/c?(\d+)/i);
                                        const colNum = colNumberMatch ? colNumberMatch[1] : colCode.replace(/[^0-9]/g, '');
                                        
                                        // Sort rows numerically within each column
                                        const sortedRowCodes = [...rowCodes].sort((a, b) => {
                                          const aNum = parseInt(a.match(/r?(\d+)/i)?.[1] || '0', 10);
                                          const bNum = parseInt(b.match(/r?(\d+)/i)?.[1] || '0', 10);
                                          return aNum - bNum;
                                        });
                                        
                                        sortedRowCodes.forEach(rowCode => {
                                          const rowNumberMatch = rowCode.match(/r?(\d+)/i);
                                          const rowNum = rowNumberMatch ? rowNumberMatch[1] : rowCode.replace(/[^0-9]/g, '');
                                          expectedHeaders.push(`Q${qNumStr}r${rowNum}c${colNum}`);
                                        });
                                      });
                                    } else {
                                      // If no columns found, still add row with c1 (fallback)
                                      rowCodes.forEach(rowCode => {
                                        const rowNumberMatch = rowCode.match(/r?(\d+)/i);
                                        const rowNum = rowNumberMatch ? rowNumberMatch[1] : rowCode.replace(/[^0-9]/g, '');
                                        expectedHeaders.push(`Q${qNumStr}r${rowNum}c1`);
                                      });
                                    }
                                  }
                                } else {
                                  // For non-numeric grids, use the existing function
                                  expectedHeaders = getExpectedColumnHeadersForBase(qNumStr, variables);
                                }
                                
                                const matchesBase = qNumStr.toLowerCase().includes(searchLower);
                                const matchesType = questionType.toLowerCase().includes(searchLower);
                                const matchesExpected = expectedHeaders.some(h => h.toLowerCase().includes(searchLower));
                                return matchesBase || matchesType || matchesExpected;
                              });
                            }

                            return questionsToShow.map((question) => {
                              const qNum = question.number || question.id;
                              const qNumStr = String(qNum);
                              let questionType = question.type || '';
                              
                              // Normalize question type
                              const typeLower = questionType.toLowerCase();
                              if (typeLower.includes('numeric list')) {
                                questionType = 'Numeric Grid';
                              } else if (typeLower.includes('numeric grid')) {
                                questionType = 'Numeric Grid';
                              }
                              
                              // Use the same function as variables tab to generate expected headers
                              let expectedHeaders = getExpectedHeadersForQuestion(question, qNumStr);
                              
                              // Augment expected headers with coded columns ONLY for open ends WITH saved coding themes
                              try {
                                const baseLower = qNumStr.replace(/^Q/i, '').toLowerCase();
                                const isOpenEndType = questionType.toLowerCase().includes('open end') && !questionType.toLowerCase().includes('list');
                                const savedThemesArr =
                                  (savedCodingThemes?.get(qNumStr.replace(/^Q/, '')) ||
                                   savedCodingThemes?.get(`Q${qNumStr.replace(/^Q/, '')}`) ||
                                   []) as Array<{ code: number; theme: string }>;
                                const hasSavedThemes = Array.isArray(savedThemesArr) && savedThemesArr.length > 0;
                                
                                if (isOpenEndType && hasSavedThemes) {
                                  const headersSource: string[] = (fullRawData && fullRawData.columns && fullRawData.columns.length > 0)
                                    ? fullRawData.columns : columnHeaders;
                                  const codedCols = headersSource.filter(col => {
                                    const cl = String(col).toLowerCase();
                                    return (cl.startsWith(baseLower + 'r') || cl.startsWith('q' + baseLower + 'r')) && /r\d+$/.test(cl);
                                  });
                                  if (codedCols.length > 0) {
                                    const qPrefixed = codedCols.map(c => (String(c).startsWith('Q') || String(c).startsWith('q')) ? String(c).replace(/^q/i, 'Q') : `Q${c}`);
                                    const set = new Set(expectedHeaders.map(h => h.replace(/_/g, '')));
                                    qPrefixed.forEach(h => {
                                      const norm = h.replace(/_/g, '');
                                      if (!set.has(norm)) {
                                        set.add(norm);
                                        expectedHeaders.push(h);
                                      }
                                    });
                                  }
                                  const codedFromVars = codedHeadersDebug?.[`Q${qNumStr}`] || codedHeadersDebug?.[String(qNumStr)] || codedHeadersDebug?.[baseLower] || [];
                                  if (codedFromVars.length > 0) {
                                    const set = new Set(expectedHeaders.map(h => h.replace(/_/g, '')));
                                    codedFromVars.forEach(h => {
                                      const norm = h.replace(/_/g, '');
                                      if (!set.has(norm)) {
                                        set.add(norm);
                                        expectedHeaders.push(h);
                                      }
                                    });
                                  }
                                }
                              } catch {}

                              // Separate expected headers into mapped and unmapped
                              // Keep all headers in unmapped list, but track which are mapped
                              const allHeaders: Array<{ header: string; isMapped: boolean; mappedColumn: string }> = [];

                              expectedHeaders.forEach(expectedHeader => {
                                // Check if mapped using columnMapping directly (most up-to-date)
                                const mappedColumn = columnMapping[expectedHeader] || columnMapping[expectedHeader.replace(/^Q/, '')] || '';
                                const isMapped = !!mappedColumn;
                                allHeaders.push({ header: expectedHeader, isMapped, mappedColumn });
                              });

                              // Create one row per expected header
                              if (allHeaders.length === 0) {
                                return (
                                  <tr key={qNumStr} className="hover:bg-yellow-50">
                                    <td className="px-4 py-2 text-xs text-gray-700 border border-gray-300">{qNumStr}</td>
                                    <td className="px-4 py-2 text-xs text-gray-700 border border-gray-300">{questionType || '-'}</td>
                                    <td className="px-4 py-2 text-xs border border-gray-300">-</td>
                                    <td className="px-4 py-2 text-xs border border-gray-300">-</td>
                                  </tr>
                                );
                              }

                              return allHeaders.map((headerInfo, headerIdx) => {
                                const { header, isMapped, mappedColumn } = headerInfo;
                                const isFirstRow = headerIdx === 0;
                                
                                return (
                                  <tr key={`${qNumStr}-${headerIdx}`} className="hover:bg-yellow-50">
                                    <td className="px-4 py-2 text-xs text-gray-700 border border-gray-300">
                                      {isFirstRow ? qNumStr : ''}
                                    </td>
                                    <td className="px-4 py-2 text-xs text-gray-700 border border-gray-300">
                                      {isFirstRow ? (questionType || '-') : ''}
                                    </td>
                                    <td className="px-4 py-2 text-xs border border-gray-300">
                                      {isMapped ? (
                                        <button
                                          onClick={() => {
                                            onSetSelectedMappingHeader?.(header);
                                            onSetManualMappingSearch?.('');
                                            onSetShowManualMappingModal?.(true);
                                          }}
                                          className="px-2 py-1 bg-green-100 hover:bg-green-200 text-green-800 rounded text-xs font-medium transition-colors cursor-pointer text-left w-full"
                                          title="Click to edit or unmap this variable"
                                        >
                                          {header}
                                        </button>
                                      ) : (
                                        <button
                                          onClick={() => {
                                            onSetSelectedMappingHeader?.(header);
                                            onSetManualMappingSearch?.('');
                                            onSetShowManualMappingModal?.(true);
                                          }}
                                          className="px-2 py-1 bg-yellow-100 hover:bg-yellow-200 text-yellow-800 rounded text-xs font-medium transition-colors cursor-pointer text-left w-full"
                                          title="Click to manually map this variable"
                                        >
                                          {header}
                                        </button>
                                      )}
                                    </td>
                                    <td className="px-4 py-2 text-xs border border-gray-300">
                                      {isMapped ? (
                                        <span className="text-xs text-gray-700" title={`Mapped to: ${mappedColumn}`}>
                                          {mappedColumn || '-'}
                                        </span>
                                      ) : (
                                        <span className="text-xs text-gray-400">-</span>
                                      )}
                                    </td>
                                  </tr>
                                );
                              });
                            });
                          })() : (
                            <tr>
                              <td colSpan={4} className="px-4 py-8 text-center text-sm text-gray-500 border border-gray-300">
                                No questions available. Sync with QNR to load questions.
                              </td>
                            </tr>
                          )}
                        </tbody>
                      </table>
                    );
                  })()}
                </div>
              </div>
            </>
          )}

          {/* Data Map View */}
          {dataTabView === 'datamap' && (
            <div>
              <div className="mb-3 flex items-center gap-3">
                <div className="relative flex-1">
                  <MagnifyingGlassIcon className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-gray-400" />
                  <input
                    type="text"
                    id="datamap-search"
                    name="datamap-search"
                    placeholder="Search questions, descriptions, column headers..."
                    value={datamapSearch}
                    onChange={(e) => setDatamapSearch(e.target.value)}
                    className="w-full pl-10 pr-4 py-2 text-sm border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-orange-500 focus:border-transparent"
                  />
                </div>
              </div>

              <div>
                {(() => {
                  // Load datamap if not already loaded
                  if (!datamapData && !loadingDatamap && selectedQuestionnaire) {
                    onLoadDatamap?.();
                    return <div className="text-center py-8 text-gray-500">Loading datamap...</div>;
                  }

                  if (loadingDatamap) {
                    return <div className="text-center py-8 text-gray-500">Loading datamap...</div>;
                  }

                  if (!datamapData || !datamapData.parsedQuestions || datamapData.parsedQuestions.length === 0) {
                    return (
                      <div className="text-center py-8">
                        <p className="text-sm text-gray-500">No data map available. Upload a data file with a datamap sheet to see the data structure.</p>
                      </div>
                    );
                  }

                  // Filter parsedQuestions based on search
                  const searchLower = datamapSearch.toLowerCase().trim();
                  const filteredQuestions = datamapSearch
                    ? (datamapData.parsedQuestions || []).filter((question: any) => {
                        // Search in question number
                        const questionNumber = String(question.questionNumber || '').toLowerCase();
                        // Search in description
                        const description = String(question.description || '').toLowerCase();
                        // Search in response type
                        const responseType = String(question.responseType || '').toLowerCase();
                        // Search in column names
                        const columnNames = (question.columnDefinitions || [])
                          .map((def: any) => String(def.columnName || '').toLowerCase())
                          .join(' ');
                        // Search in response codes
                        const responseCodes = (question.responseCodes || [])
                          .map((code: any) => String(code.code || '') + ' ' + String(code.label || ''))
                          .join(' ')
                          .toLowerCase();

                        return questionNumber.includes(searchLower) ||
                               description.includes(searchLower) ||
                               responseType.includes(searchLower) ||
                               columnNames.includes(searchLower) ||
                               responseCodes.includes(searchLower);
                      })
                    : (datamapData.parsedQuestions || []);

                  return (
                    <div className="overflow-auto border border-gray-200 rounded-lg" style={{ maxHeight: '600px' }}>
                      <table className="w-full table-fixed divide-y divide-gray-200">
                        <thead className="bg-gray-50 sticky top-0">
                          <tr>
                            <th className="px-4 py-2 text-left text-xs font-medium text-gray-700 uppercase tracking-wider" style={{ width: '12%' }}>
                              Question #
                            </th>
                            <th className="px-4 py-2 text-left text-xs font-medium text-gray-700 uppercase tracking-wider" style={{ width: '20%' }}>
                              Description
                            </th>
                            <th className="px-4 py-2 text-left text-xs font-medium text-gray-700 uppercase tracking-wider" style={{ width: '14%' }}>
                              Response Type
                            </th>
                            <th className="px-4 py-2 text-left text-xs font-medium text-gray-700 uppercase tracking-wider" style={{ width: '12%' }}>
                              Q Type
                            </th>
                            <th className="px-4 py-2 text-left text-xs font-medium text-gray-700 uppercase tracking-wider" style={{ width: '22%' }}>
                              Response Codes
                            </th>
                            <th className="px-4 py-2 text-left text-xs font-medium text-gray-700 uppercase tracking-wider" style={{ width: '20%' }}>
                              Column headers
                            </th>
                            <th className="px-4 py-2 text-center text-xs font-medium text-gray-700 uppercase tracking-wider" style={{ width: '8%' }}>
                              In QNR
                            </th>
                          </tr>
                        </thead>
                        <tbody className="bg-white divide-y divide-gray-200">
                          {filteredQuestions.map((question: any, idx: number) => {
                            // Determine response type styling first (needed for question type detection)
                            const responseType = question.responseType || 'Unknown';

                            // Determine question type based on response type
                            const getQuestionType = (type: string): string => {
                              const lowerType = type.toLowerCase();

                              // Open text → Open end
                              if (lowerType.includes('open text')) {
                                return 'Open end';
                              }

                              // Open numeric → Numeric
                              if (lowerType.includes('open numeric')) {
                                return 'Numeric';
                              }

                              // Values: 0-1 → Multi-select
                              if (lowerType.match(/values?:\s*0\s*-\s*1/i)) {
                                return 'Multi-select';
                              }

                              // Check for values range
                              const valuesMatch = lowerType.match(/values?:\s*(\d+)\s*-\s*(\d+)/i);
                              if (valuesMatch) {
                                const min = parseInt(valuesMatch[1]);
                                const max = parseInt(valuesMatch[2]);

                                // Values 1-99 → Single select
                                if (min >= 1 && max <= 99) {
                                  return 'Single select';
                                }

                                // Values outside 1-99 → Numeric
                                return 'Numeric';
                              }

                              // Check for single number pattern
                              const singleValueMatch = lowerType.match(/values?:\s*(\d+)/i);
                              if (singleValueMatch) {
                                const value = parseInt(singleValueMatch[1]);
                                if (value >= 1 && value <= 99) {
                                  return 'Single select';
                                }
                                return 'Numeric';
                              }

                              return 'Unknown';
                            };

                            let questionType = getQuestionType(responseType);

                            // If question type is Numeric and has response codes, re-classify as "Numeric grid"
                            if (questionType === 'Numeric' && question.responseCodes && question.responseCodes.length > 0) {
                              questionType = 'Numeric grid';
                            }

                            // Helper function to check if response codes have brackets
                            const hasBracketsInResponseCodes = (responseCodes: any[]): boolean => {
                              return responseCodes.some((codeItem: any) => {
                                const codeStr = String(codeItem.code || '').trim();
                                return /\[([^\]]+)\]|\(([^)]+)\)/.test(codeStr);
                              });
                            };

                            // If it's a Single select with value range AND has brackets in response codes, re-classify as "Single select grid"
                            if (questionType === 'Single select' &&
                                question.responseCodes &&
                                question.responseCodes.length > 0 &&
                                responseType &&
                                responseType.toLowerCase().match(/values?:\s*\d+/i) &&
                                hasBracketsInResponseCodes(question.responseCodes)) {
                              questionType = 'Single select grid';
                            }

                            // Find matching column headers for this question
                            let matchingColumns: string[] = [];

                            // Helper function to extract column headers from brackets in response codes
                            const extractColumnHeadersFromResponseCodes = (responseCodes: any[]): string[] => {
                              const extractedColumnNames: string[] = [];

                              responseCodes.forEach((codeItem: any) => {
                                const codeStr = String(codeItem.code || '').trim();

                                // Extract values from brackets: [QS3r1] -> QS3r1
                                const bracketPatterns = [
                                  /\[([^\]]+)\]/g,  // [QS3r1]
                                  /\(([^)]+)\)/g,   // (QS3r1) - parentheses
                                ];

                                bracketPatterns.forEach(pattern => {
                                  let match;
                                  pattern.lastIndex = 0;
                                  while ((match = pattern.exec(codeStr)) !== null) {
                                    extractedColumnNames.push(match[1].trim());
                                  }
                                });
                              });

                              return extractedColumnNames;
                            };

                            // Check if it's a multi-select by question type OR by response type pattern
                            const isMultiSelect = questionType === 'Multi-select' ||
                                                 (responseType && responseType.toLowerCase().match(/values?:\s*0\s*-\s*1/i));

                            if ((isMultiSelect || questionType === 'Numeric grid' || questionType === 'Single select grid') && question.responseCodes && question.responseCodes.length > 0) {
                              // For multi-select, numeric grid, and single select grid questions, extract column headers directly from brackets in response codes
                              matchingColumns = extractColumnHeadersFromResponseCodes(question.responseCodes);
                            } else {
                              // For other question types, use the original matching logic
                              const qNum = question.questionNumber || '';

                              // Check if this is an Open Text response type
                              const isOpenText = responseType && responseType.toLowerCase().includes('open text');

                              // For open end questions, also check for Q prefix variations and columns with additional text
                              const isOpenEnd = questionType === 'Open end' || questionType === 'Numeric';

                              let columnsToCheck = datamapData.columnDefinitions || [];

                              // If no matches found in columnDefinitions for Open Text, try to find any column that matches
                              matchingColumns = columnsToCheck
                                ?.filter((def: any) => {
                                  if (!def.columnName) return false;

                                  const colName = def.columnName;
                                  const colNameLower = colName.toLowerCase();
                                  const qNumLower = qNum.toLowerCase();

                                  // For Open Text questions, the column header should always match the Question # exactly
                                  if (isOpenText) {
                                    const qNumWithQ = qNumLower.startsWith('q') ? qNumLower : 'q' + qNumLower;
                                    const qNumWithoutQ = qNumLower.startsWith('q') ? qNumLower.substring(1) : qNumLower;

                                    if (colNameLower === qNumLower || colNameLower === qNumWithQ || colNameLower === qNumWithoutQ) {
                                      return true;
                                    }

                                    if (colNameLower.startsWith(qNumWithQ)) {
                                      const afterMatch = colNameLower.substring(qNumWithQ.length);
                                      if (!afterMatch || afterMatch.match(/^[\s\-]/)) {
                                        return true;
                                      }
                                    }

                                    if (colNameLower.startsWith(qNumWithoutQ)) {
                                      const afterMatch = colNameLower.substring(qNumWithoutQ.length);
                                      if (!afterMatch || afterMatch.match(/^[\s\-]/)) {
                                        return true;
                                      }
                                    }

                                    if (qNumWithQ.length > 0 && colNameLower.includes(qNumWithQ)) {
                                      const index = colNameLower.indexOf(qNumWithQ);
                                      if (index === 0 || (index > 0 && !/[a-z0-9]/.test(colNameLower[index - 1]))) {
                                        const afterMatch = colNameLower.substring(index + qNumWithQ.length);
                                        if (!afterMatch || afterMatch.match(/^[\s\-]/)) {
                                          return true;
                                        }
                                      }
                                    }

                                    if (qNumWithoutQ.length > 0 && colNameLower.includes(qNumWithoutQ)) {
                                      const index = colNameLower.indexOf(qNumWithoutQ);
                                      if (index === 0 || (index > 0 && !/[a-z0-9]/.test(colNameLower[index - 1]))) {
                                        const afterMatch = colNameLower.substring(index + qNumWithoutQ.length);
                                        if (!afterMatch || afterMatch.match(/^[\s\-]/)) {
                                          return true;
                                        }
                                      }
                                    }

                                    return false;
                                  }

                                  // For other question types, use the original matching logic
                                  if (colNameLower === qNumLower) return true;

                                  const qNumWithQ = qNumLower.startsWith('q') ? qNumLower : 'q' + qNumLower;
                                  const qNumWithoutQ = qNumLower.startsWith('q') ? qNumLower.substring(1) : qNumLower;

                                  if (colNameLower === qNumWithQ || colNameLower === qNumWithoutQ) return true;

                                  // For open end questions, also match columns that start with the question number
                                  if (isOpenEnd) {
                                    if (colNameLower.startsWith(qNumWithQ) || colNameLower.startsWith(qNumWithoutQ)) {
                                      const afterMatch = colNameLower.substring(
                                        colNameLower.startsWith(qNumWithQ) ? qNumWithQ.length : qNumWithoutQ.length
                                      );
                                      if (!afterMatch || afterMatch.match(/^[\s\-]/) || afterMatch.length === 0) {
                                        return true;
                                      }
                                    }
                                  }

                                  // Match columns that start with the question number followed by row/column indicators
                                  return (
                                    colNameLower.startsWith(qNumLower + 'r') ||
                                    colNameLower.startsWith(qNumLower + 'c') ||
                                    colNameLower.startsWith(qNumLower + '_r') ||
                                    colNameLower.startsWith(qNumLower + '_c') ||
                                    colNameLower.startsWith(qNumLower + '-') ||
                                    colNameLower.startsWith(qNumWithQ + 'r') ||
                                    colNameLower.startsWith(qNumWithQ + 'c') ||
                                    colNameLower.startsWith(qNumWithQ + '_r') ||
                                    colNameLower.startsWith(qNumWithQ + '_c') ||
                                    colNameLower.startsWith(qNumWithQ + '-')
                                  );
                                })
                                .map((def: any) => def.columnName) || [];

                              // For Open Text questions, if no matching columns were found in columnDefinitions,
                              // use the question number itself as the expected column header
                              if (isOpenText && matchingColumns.length === 0 && qNum) {
                                matchingColumns = [qNum];
                              }
                            }

                            const getResponseTypeStyle = (type: string) => {
                              const lowerType = type.toLowerCase();
                              if (lowerType.includes('open numeric')) {
                                return 'bg-blue-100 text-blue-800';
                              } else if (lowerType.includes('open text')) {
                                return 'bg-cyan-100 text-cyan-800';
                              } else if (lowerType.match(/values?:\s*0\s*-\s*1/i)) {
                                return 'bg-green-100 text-green-800';
                              } else if (lowerType.includes('values:')) {
                                return 'bg-orange-100 text-orange-800';
                              } else {
                                return 'bg-gray-100 text-gray-800';
                              }
                            };

                            const isExpanded = expandedDatamapRows.has(idx);
                            const toggleExpand = () => {
                              setExpandedDatamapRows(prev => {
                                const newSet = new Set(prev);
                                if (newSet.has(idx)) {
                                  newSet.delete(idx);
                                } else {
                                  newSet.add(idx);
                                }
                                return newSet;
                              });
                            };

                            return (
                              <tr
                                key={idx}
                                className="hover:bg-yellow-50 cursor-pointer"
                                onClick={toggleExpand}
                              >
                                <td className="px-4 py-2 text-xs text-gray-700" style={isExpanded ? {} : { maxHeight: '3rem', overflow: 'hidden' }}>
                                  <div style={isExpanded ? {} : { display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
                                    {question.questionNumber}
                                  </div>
                                </td>
                                <td className="px-4 py-2 text-xs text-gray-700" style={isExpanded ? {} : { maxHeight: '3rem', overflow: 'hidden' }}>
                                  <div style={isExpanded ? {} : { display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
                                    {question.description || '-'}
                                  </div>
                                </td>
                                <td className="px-4 py-2 text-xs text-gray-700" style={isExpanded ? {} : { maxHeight: '3rem', overflow: 'hidden' }}>
                                  <div style={isExpanded ? {} : { display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
                                    <span className={`px-2 py-1 rounded text-xs font-medium ${getResponseTypeStyle(responseType)}`}>
                                      {responseType}
                                    </span>
                                  </div>
                                </td>
                                <td className="px-4 py-2 text-xs text-gray-700" style={isExpanded ? {} : { maxHeight: '3rem', overflow: 'hidden' }}>
                                  <div style={isExpanded ? {} : { display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
                                    {questionType}
                                  </div>
                                </td>
                                <td className="px-4 py-2 text-xs text-gray-600" style={isExpanded ? {} : { maxHeight: '3rem', overflow: 'hidden' }}>
                                  {question.responseCodes && question.responseCodes.length > 0 ? (
                                    <div style={isExpanded ? {} : { display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
                                      {question.responseCodes.map((codeItem: any, codeIdx: number) => (
                                        <span key={codeIdx}>
                                          {codeItem.code}: {codeItem.text || codeItem.label}
                                          {codeIdx < question.responseCodes.length - 1 ? ', ' : ''}
                                        </span>
                                      ))}
                                    </div>
                                  ) : (
                                    <span className="text-gray-400 italic">-</span>
                                  )}
                                </td>
                                <td className="px-4 py-2 text-xs text-gray-600" style={isExpanded ? {} : { maxHeight: '3rem', overflow: 'hidden' }}>
                                  {matchingColumns.length > 0 ? (
                                    <div style={isExpanded ? {} : { display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
                                      {matchingColumns.join(', ')}
                                    </div>
                                  ) : (
                                    <span className="text-gray-400 italic">-</span>
                                  )}
                                </td>
                                <td className="px-4 py-2 text-center">
                                  {(() => {
                                    // Check if this question exists in questionnaireQuestions
                                    const datamapQuestionNumber = question.questionNumber || '';
                                    const isInQNR = questionnaireQuestions.some((qnrQuestion: any) => {
                                      const qnrNumber = String(qnrQuestion.number || qnrQuestion.id || '');
                                      const datamapNormalized = datamapQuestionNumber.toLowerCase().trim();
                                      const qnrNormalized = qnrNumber.toLowerCase().trim();

                                      if (datamapNormalized === qnrNormalized) return true;

                                      const datamapWithQ = datamapNormalized.startsWith('q') ? datamapNormalized : 'q' + datamapNormalized;
                                      const datamapWithoutQ = datamapNormalized.startsWith('q') ? datamapNormalized.substring(1) : datamapNormalized;
                                      const qnrWithQ = qnrNormalized.startsWith('q') ? qnrNormalized : 'q' + qnrNormalized;
                                      const qnrWithoutQ = qnrNormalized.startsWith('q') ? qnrNormalized.substring(1) : qnrNormalized;

                                      return datamapWithQ === qnrWithQ ||
                                             datamapWithQ === qnrWithoutQ ||
                                             datamapWithoutQ === qnrWithQ ||
                                             datamapWithoutQ === qnrWithoutQ;
                                    });

                                    return isInQNR ? (
                                      <CheckCircleIcon className="h-5 w-5 text-green-500 mx-auto" title="This question is in the QNR" />
                                    ) : (
                                      <span className="text-gray-300">-</span>
                                    );
                                  })()}
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

          {/* Raw Data View */}
          {dataTabView === 'rawdata' && (
            <RawDataViewer
              data={fullRawData}
              page={rawDataPage}
              rowsPerPage={rawDataRowsPerPage}
              columnStart={rawDataColumnStart}
              columnsPerPage={rawDataColumnsPerPage}
              onPageChange={onPageChange}
              onColumnChange={onColumnChange}
              loading={loadingFullRawData}
              columnMapping={columnMapping}
              variables={variables}
              questionnaireQuestions={questionnaireQuestions}
            />
          )}
      </div>
    </div>
  );
};

