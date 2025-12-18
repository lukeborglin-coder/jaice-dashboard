import React, { useEffect, useState, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';
import { CloudArrowUpIcon, DocumentTextIcon, TrashIcon, PlayIcon, ArrowPathIcon } from '@heroicons/react/24/outline';
import { useToast } from '../Toast';
import * as api from '../../services/dataQualityApi';

const BRAND_ORANGE = '#D14A2D';

interface DataUpload {
  id: string;
  filename: string;
  uploadedAt: string;
  respondentCount: number;
  respnos?: string[];
}

interface DataUploadTabProps {
  projectId: string;
  uploads: DataUpload[];
  loadingData: boolean;
  onUpload: (file: File) => Promise<any>;
  onDeleteUpload?: (uploadId: string) => Promise<void>;
  onRunQA?: (respondentIds?: string[], force?: boolean) => Promise<any>;
}

export default function DataUploadTab({
  projectId,
  uploads,
  loadingData,
  onUpload,
  onDeleteUpload,
  onRunQA
}: DataUploadTabProps) {
  const toast = useToast();
  const [searchParams, setSearchParams] = useSearchParams();
  const [uploading, setUploading] = useState(false);
  const [runningUploadIds, setRunningUploadIds] = useState<Set<string>>(new Set());
  const [ranUploadIds, setRanUploadIds] = useState<Set<string>>(new Set());
  const [previewLoading, setPreviewLoading] = useState(false);
  const [preview, setPreview] = useState<{
    upload: any;
    columns: string[];
    columnsMeta?: Array<{
      expectedHeader: string;
      planQuestionName: string;
      mappedHeader: string;
      matched: boolean;
      matchedFileHeader?: string | null;
    }>;
    rows: Array<{ respno: string; columns: Record<string, any> }>;
  } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const selectedUploadId = searchParams.get('uploadId');

  const handleFileUpload = async (file: File) => {
    const validExtensions = ['.csv', '.xlsx', '.xls'];
    const fileExt = file.name.toLowerCase().slice(file.name.lastIndexOf('.'));
    
    if (!validExtensions.includes(fileExt)) {
      toast.error('Please upload a CSV or Excel file (.csv, .xlsx, .xls)');
      return;
    }

    setUploading(true);
    try {
      await onUpload(file);
      toast.success(`Successfully uploaded ${file.name}`);
    } catch (error: any) {
      console.error('Error uploading file:', error);
      toast.error(error.response?.data?.error || 'Failed to upload data file');
    } finally {
      setUploading(false);
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    }
  };

  const handleFileSelect = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    await handleFileUpload(file);
  };

  const handleDeleteUpload = async (uploadId: string) => {
    if (!onDeleteUpload) return;
    if (!window.confirm('Are you sure you want to delete this upload? This will remove all associated respondent data.')) return;
    
    try {
      await onDeleteUpload(uploadId);
      toast.success('Upload deleted successfully');
    } catch (error) {
      console.error('Error deleting upload:', error);
      toast.error('Failed to delete upload');
    }
  };

  const handleRunQAForUpload = async (upload: DataUpload) => {
    if (!onRunQA) return;

    const respondentIds = Array.isArray(upload.respnos) ? upload.respnos : [];
    if (respondentIds.length === 0) {
      toast.error('This upload has no respondent IDs to run QA on.');
      return;
    }

    setRunningUploadIds((prev) => {
      const next = new Set(prev);
      next.add(upload.id);
      return next;
    });
    try {
      await onRunQA(respondentIds, false);
      setRanUploadIds((prev) => {
        const next = new Set(prev);
        next.add(upload.id);
        return next;
      });
      toast.success(`QA started for ${respondentIds.length.toLocaleString()} respondents`);
    } catch (error: any) {
      console.error('Error running QA for upload:', error);
      const status = error?.response?.status;
      const serverMsg = error?.response?.data?.error;
      const isTimeout =
        error?.code === 'ECONNABORTED' ||
        String(error?.message || '').toLowerCase().includes('timeout');

      if (isTimeout) {
        toast.error('QA run timed out (60s). Check server logs and try again.');
      } else if (status) {
        toast.error(serverMsg || `Failed to run QA checks (HTTP ${status})`);
      } else {
        toast.error(serverMsg || 'Failed to run QA checks for this upload');
      }
    } finally {
      setRunningUploadIds((prev) => {
        const next = new Set(prev);
        next.delete(upload.id);
        return next;
      });
    }
  };

  const handleSelectUpload = (upload: DataUpload) => {
    const next = new URLSearchParams(searchParams);
    next.set('uploadId', upload.id);
    setSearchParams(next);
  };

  const handleBackToList = () => {
    // Use browser history semantics: this should take you back to the list state.
    window.history.back();
  };

  // Load preview whenever the URL-selected upload changes
  useEffect(() => {
    if (!selectedUploadId) {
      setPreview(null);
      setPreviewLoading(false);
      return;
    }

    let cancelled = false;
    setPreviewLoading(true);
    setPreview(null);

    (async () => {
      try {
        const data = await api.qaDataApi.getUploadPreview(projectId, selectedUploadId);
        if (cancelled) return;
        setPreview(data);
      } catch (error: any) {
        console.error('Error loading upload preview:', error);
        if (!cancelled) {
          toast.error(error.response?.data?.error || 'Failed to load upload breakdown');
        }
      } finally {
        if (!cancelled) setPreviewLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [projectId, selectedUploadId, toast]);

  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    return date.toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  return (
    <div className="p-6">
      {/* "Sub-page" view: Upload Breakdown */}
      {selectedUploadId ? (
        <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
          <div className="px-4 py-3 border-b border-gray-200 bg-gray-50 flex items-center justify-between">
            <div>
              <h4 className="text-sm font-semibold text-gray-900">Upload Breakdown</h4>
              <p className="text-xs text-gray-500">
                Showing respno + columns referenced by the current Quality Plan
              </p>
            </div>
            <button
              onClick={handleBackToList}
              className="text-sm text-gray-600 hover:text-gray-900"
            >
              Back
            </button>
          </div>

          {previewLoading ? (
            <div className="p-4 text-sm text-gray-500">Loading breakdown…</div>
          ) : preview?.rows ? (
            <div className="w-full overflow-x-auto">
              <div className="max-h-[60vh] overflow-y-auto">
                <table className="min-w-full text-sm">
                  <thead className="sticky top-0 bg-white border-b border-gray-200">
                    <tr>
                      <th className="text-left px-3 py-2 font-medium text-gray-700 whitespace-nowrap">respno</th>
                      {(preview.columnsMeta && preview.columnsMeta.length > 0
                        ? preview.columnsMeta
                        : preview.columns.map((c) => ({ expectedHeader: c, planQuestionName: c, mappedHeader: c, matched: false }))
                      ).map((meta) => (
                        <th
                          key={meta.expectedHeader}
                          className={`text-left px-3 py-2 font-medium whitespace-nowrap ${
                            meta.matched ? 'text-green-800 bg-green-50' : 'text-gray-700'
                          }`}
                          title={
                            meta.mappedHeader
                              ? `Mapped to: ${meta.mappedHeader}${meta.matchedFileHeader ? ` (matched file header: ${meta.matchedFileHeader})` : ''}`
                              : undefined
                          }
                        >
                          {meta.planQuestionName} ({meta.expectedHeader})
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {preview.rows.map((row) => (
                      <tr key={row.respno} className="hover:bg-gray-50">
                        <td className="px-3 py-2 whitespace-nowrap font-medium text-gray-900">{row.respno}</td>
                        {preview.columns.map((col) => (
                          <td key={col} className="px-3 py-2 whitespace-nowrap text-gray-700">
                            {row.columns?.[col] === null || row.columns?.[col] === undefined ? '' : String(row.columns[col])}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ) : (
            <div className="p-4 text-sm text-gray-500">No breakdown data available.</div>
          )}
        </div>
      ) : (
        <>
          {/* Upload History */}
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-lg font-semibold">Upload History</h3>
            <div>
              <input
                ref={fileInputRef}
                type="file"
                accept=".csv,.xlsx,.xls"
                onChange={handleFileSelect}
                className="hidden"
                id="data-upload-input"
              />
              <label
                htmlFor="data-upload-input"
                className={`inline-flex items-center gap-2 px-4 py-2 text-white rounded-lg cursor-pointer transition-colors text-sm font-medium ${
                  uploading ? 'opacity-50 cursor-not-allowed' : ''
                }`}
                style={{ backgroundColor: BRAND_ORANGE }}
                onMouseOver={(e) => !uploading && (e.currentTarget.style.backgroundColor = '#B8402A')}
                onMouseOut={(e) => e.currentTarget.style.backgroundColor = BRAND_ORANGE}
              >
                <CloudArrowUpIcon className="w-4 h-4" />
                {uploading ? 'Uploading...' : 'Upload File'}
              </label>
            </div>
          </div>
          
          {loadingData ? (
            <div className="text-center py-8 text-gray-500">Loading uploads...</div>
          ) : uploads && uploads.length > 0 ? (
            <div className="bg-white rounded-lg border border-gray-200 divide-y divide-gray-200">
              {uploads.map((upload) => (
                <div 
                  key={upload.id} 
                  className={`flex items-center justify-between p-4 hover:bg-gray-50 transition-colors cursor-pointer ${
                    selectedUploadId === upload.id ? 'bg-gray-50' : ''
                  }`}
                  onClick={() => handleSelectUpload(upload)}
                >
                  <div className="flex items-center gap-4">
                    <div className="p-2 rounded-lg" style={{ backgroundColor: `${BRAND_ORANGE}15` }}>
                      <DocumentTextIcon className="w-6 h-6" style={{ color: BRAND_ORANGE }} />
                    </div>
                    <div>
                      <p className="font-medium text-gray-900">{upload.filename}</p>
                      <p className="text-sm text-gray-500">
                        Uploaded {formatDate(upload.uploadedAt)}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-4">
                    <div className="text-right">
                      <p className="text-lg font-semibold text-gray-900">
                        {upload.respondentCount.toLocaleString()}
                      </p>
                      <p className="text-xs text-gray-500">respondents</p>
                    </div>
    
                    {onRunQA && (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          handleRunQAForUpload(upload);
                        }}
                        disabled={runningUploadIds.has(upload.id)}
                        className="inline-flex items-center gap-2 px-3 py-2 text-white rounded-lg transition-colors text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed"
                        style={{ backgroundColor: BRAND_ORANGE }}
                        onMouseOver={(e) => !runningUploadIds.has(upload.id) && (e.currentTarget.style.backgroundColor = '#B8402A')}
                        onMouseOut={(e) => e.currentTarget.style.backgroundColor = BRAND_ORANGE}
                        title="Run QA checks for this upload"
                      >
                    {runningUploadIds.has(upload.id) ? (
                      <ArrowPathIcon className="w-4 h-4 animate-spin" />
                    ) : (
                      <PlayIcon className="w-4 h-4" />
                    )}
                    {runningUploadIds.has(upload.id) ? '' : (ranUploadIds.has(upload.id) ? 'Re-run' : 'Run QA')}
                      </button>
                    )}
    
                    {onDeleteUpload && (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          handleDeleteUpload(upload.id);
                        }}
                        className="p-2 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors"
                        title="Delete upload"
                      >
                        <TrashIcon className="w-5 h-5" />
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="bg-gray-50 rounded-lg border border-gray-200 p-8 text-center">
              <DocumentTextIcon className="w-12 h-12 text-gray-300 mx-auto mb-3" />
              <p className="text-gray-500 font-medium">No uploads yet</p>
              <p className="text-sm text-gray-400 mt-1">
                Click "Upload File" to get started
              </p>
            </div>
          )}
        </>
      )}
    </div>
  );
}
