import React, { useMemo, useRef, useState } from 'react';
import { CloudArrowUpIcon, ArrowPathIcon, InformationCircleIcon, XMarkIcon } from '@heroicons/react/24/outline';
import { RawDataViewer } from './RawDataViewer';
import { classifyDatamapQuestionType, isOeTaggedName, detect7ptScale } from '../../utils/tabs/questionHelpers';

const BRAND_ORANGE = '#D14A2D';

export function TabPlanRawDataTab({
  planName,
  datamapData,
  rawData,
  loading,
  rawDataPage,
  rawDataRowsPerPage,
  rawDataColumnStart,
  rawDataColumnsPerPage,
  onPageChange,
  onColumnChange,
  onUpload,
  onRefresh,
}: {
  planName: string;
  datamapData: any;
  rawData: { columns: string[]; rows: any[] } | null;
  loading: boolean;
  rawDataPage: number;
  rawDataRowsPerPage: number;
  rawDataColumnStart: number;
  rawDataColumnsPerPage: number;
  onPageChange: (page: number) => void;
  onColumnChange: (start: number) => void;
  onUpload: (file: File) => Promise<void>;
  onRefresh: () => Promise<void>;
}) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [dataView, setDataView] = useState<'datamap' | 'rawdata'>('datamap');
  const [showQuestionTypeInfo, setShowQuestionTypeInfo] = useState(false);

  const datamapQuestions: any[] = useMemo(() => {
    const qs = datamapData?.parsedQuestions;
    return Array.isArray(qs)
      ? qs.filter((q: any) => !isOeTaggedName(String(q?.questionNumber || '')))
      : [];
  }, [datamapData]);

  const rawDataColumnsCount = rawData?.columns?.length || 0;
  const rawDataRowsCount = rawData?.rows?.length || 0;

  const classifyQuestionType = useMemo(() => {
    return (q: any) => {
      const baseType = classifyDatamapQuestionType(q || {});
      const responseOptions = Array.isArray(q?.responseOptions) ? q.responseOptions : [];
      const responseCodes = Array.isArray(q?.responseCodes) ? q.responseCodes : [];

      return baseType;
    };
  }, []);

  const generateTagsForQuestion = useMemo(() => {
    return (q: any) => {
      const tags: string[] = [];
      const responseType = String(q?.responseType || '').toLowerCase();

      // Get the classified question type (which now handles notes for grid detection)
      const questionType = classifyDatamapQuestionType(q);

      // Apply tagging logic based on question type
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

      // Auto-detect 7pt scale for single select and single select grids
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

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-semibold text-gray-900">Data (Raw upload)</h3>
          <p className="text-xs text-gray-500 mt-1">
            This plan is based on an Excel upload with a Data Map sheet: <span className="font-medium">{planName}</span>
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => fileInputRef.current?.click()}
            disabled={uploading}
            className="flex items-center gap-2 px-3 py-1.5 text-sm rounded-lg disabled:opacity-50 disabled:cursor-not-allowed text-white hover:opacity-90"
            style={{ backgroundColor: BRAND_ORANGE }}
          >
            <CloudArrowUpIcon className="h-4 w-4" />
            {uploading ? 'Uploading…' : 'Replace Data File'}
          </button>
          <button
            onClick={async () => {
              await onRefresh();
            }}
            disabled={uploading}
            className="flex items-center gap-2 px-3 py-1.5 text-sm rounded-lg disabled:opacity-50 disabled:cursor-not-allowed text-white hover:opacity-90"
            style={{ backgroundColor: BRAND_ORANGE }}
            title="Refresh datamap/raw data"
          >
            <ArrowPathIcon className="h-4 w-4" />
            Refresh
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept=".xlsx,.xls"
            className="hidden"
            onChange={async (e) => {
              const file = e.target.files?.[0];
              if (!file) return;
              setUploading(true);
              try {
                await onUpload(file);
              } finally {
                setUploading(false);
                if (e.target) e.target.value = '';
              }
            }}
          />
        </div>
      </div>

      {loading && (
        <div className="border border-gray-200 rounded-lg overflow-hidden">
          <div className="p-8 text-center">
            <div className="mx-auto mb-4 h-12 w-12 animate-spin rounded-full border-4 border-gray-200 border-t-[#D14A2D]"></div>
            <p className="text-sm text-gray-700">Loading data…</p>
          </div>
        </div>
      )}

      {/* View Tabs (Data Map / Raw Data) */}
      <div className="flex items-center gap-3">
        <button
          onClick={() => setDataView('datamap')}
          className={`text-sm font-semibold px-3 py-1.5 rounded transition-colors ${
            dataView === 'datamap'
              ? 'text-white cursor-pointer'
              : 'text-gray-900 bg-white border border-gray-300 hover:bg-gray-50 cursor-pointer'
          }`}
          style={dataView === 'datamap' ? { backgroundColor: BRAND_ORANGE } : {}}
        >
          Data Map {datamapQuestions.length > 0 ? <span className="font-normal text-xs ml-1">({datamapQuestions.length})</span> : ''}
        </button>
        <button
          onClick={() => setDataView('rawdata')}
          className={`text-sm font-semibold px-3 py-1.5 rounded transition-colors ${
            dataView === 'rawdata'
              ? 'text-white cursor-pointer'
              : 'text-gray-900 bg-white border border-gray-300 hover:bg-gray-50 cursor-pointer'
          }`}
          style={dataView === 'rawdata' ? { backgroundColor: BRAND_ORANGE } : {}}
        >
          Raw Data {rawDataColumnsCount > 0 ? <span className="font-normal text-xs ml-1">({rawDataColumnsCount})</span> : ''}
        </button>
      </div>

      <div className="border border-gray-200 rounded-lg overflow-hidden flex flex-col" style={{ height: 'calc(100vh - 250px)' }}>
        <div className="px-4 py-3 bg-gray-50 border-b border-gray-200">
          {dataView === 'datamap' ? (
            <>
              <div className="flex items-center justify-between gap-3">
                <div className="text-sm font-semibold text-gray-900">Data Map</div>
              </div>
              <div className="text-xs text-gray-500">
                {datamapQuestions.length ? `${datamapQuestions.length} questions` : 'No parsed questions yet'}
              </div>
            </>
          ) : (
            <>
              <div className="text-sm font-semibold text-gray-900">Raw Data</div>
              <div className="text-xs text-gray-500">
                {rawDataRowsCount ? `${rawDataRowsCount} rows • ${rawDataColumnsCount} columns` : 'No raw data loaded'}
              </div>
            </>
          )}
        </div>

        <div className="flex-1 min-h-0 overflow-auto">
          {dataView === 'datamap' ? (
            <div className="p-4 h-full">
              {datamapQuestions.length ? (
                <table className="w-full table-fixed text-sm">
                  <colgroup>
                    <col style={{ width: '7%' }} />
                    <col style={{ width: '12%' }} />
                    <col style={{ width: '12%' }} />
                    <col style={{ width: '8%' }} />
                    <col style={{ width: '20%' }} />
                    <col style={{ width: '20%' }} />
                    <col style={{ width: '21%' }} />
                  </colgroup>
                  <thead className="sticky top-0 bg-white z-10">
                    <tr className="border-b border-gray-200">
                      <th className="text-left py-2 pr-3 text-xs font-semibold text-gray-600">Q#</th>
                      <th className="text-left py-2 pr-3 text-xs font-semibold text-gray-600">Response value</th>
                      <th className="text-left py-2 pr-3 text-xs font-semibold text-gray-600">Question type</th>
                      <th className="text-left py-2 pr-3 text-xs font-semibold text-gray-600">Tags</th>
                      <th className="text-left py-2 pr-3 text-xs font-semibold text-gray-600">Text</th>
                      <th className="text-left py-2 pr-3 text-xs font-semibold text-gray-600">Response options</th>
                      <th className="text-left py-2 pr-3 text-xs font-semibold text-gray-600">Statements</th>
                    </tr>
                  </thead>
                  <tbody>
                    {datamapQuestions.map((q: any) => {
                      const rawOptions =
                        (Array.isArray(q?.responseCodes) && q.responseCodes) ||
                        (Array.isArray(q?.responseOptions) && q.responseOptions) ||
                        (Array.isArray(q?.statementOptions) && q.statementOptions) ||
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

                      const preview = normalizedOptions.slice(0, 8);
                      const remaining = Math.max(0, normalizedOptions.length - preview.length);

                      const baseType = classifyQuestionType(q);
                      const isNumericGridWithResponseOptions =
                        baseType === 'Numeric grid' && normalizedOptions.length > 0;
                      const displayQuestionType = isNumericGridWithResponseOptions ? 'Single select grid' : baseType;
                      const tags = isNumericGridWithResponseOptions ? [] : generateTagsForQuestion(q);

                      return (
                        <tr
                          key={q.questionNumber}
                          className="border-b border-gray-100 align-top"
                        >
                          <td className="py-2 pr-3 font-medium text-gray-900">
                            <div className="truncate" title={q.questionNumber}>{q.questionNumber}</div>
                          </td>
                          <td className="py-2 pr-3 text-xs text-gray-700">
                            <div className="truncate" title={q.responseType || 'Unknown'}>{q.responseType || 'Unknown'}</div>
                          </td>
                          <td className="py-2 pr-3 text-xs text-gray-700">
                            <div className="truncate" title={displayQuestionType}>{displayQuestionType}</div>
                          </td>
                          <td className="py-2 pr-3 text-xs text-gray-700">
                            {tags.length > 0 ? (
                              <div className="flex flex-wrap gap-1">
                                {tags.map((tag, idx) => (
                                  <span
                                    key={idx}
                                    className="inline-flex items-center px-1.5 py-0.5 rounded text-xs bg-blue-100 text-blue-800 whitespace-nowrap"
                                  >
                                    {tag}
                                  </span>
                                ))}
                              </div>
                            ) : (
                              <span className="text-gray-400">-</span>
                            )}
                          </td>
                          <td className="py-2 pr-3 text-xs text-gray-700">
                            <div className="line-clamp-3" title={q.description || '-'}>
                              {q.description || '-'}
                            </div>
                          </td>
                          <td className="py-2 pr-3 text-xs text-gray-700">
                            {normalizedOptions.length ? (
                              <div
                                className="space-y-0.5 overflow-hidden"
                                title={normalizedOptions.map((o) => (o.label ? `${o.code}: ${o.label}` : `${o.code}`)).join('\n')}
                              >
                                {preview.slice(0, 4).map((o, idx) => (
                                  <div key={`${o.code}-${idx}`} className="truncate">
                                    {o.label ? `${o.code}: ${o.label}` : `${o.code}`}
                                  </div>
                                ))}
                                {normalizedOptions.length > 4 ? <div className="text-gray-400 truncate">+{normalizedOptions.length - 4} more</div> : null}
                              </div>
                            ) : (
                              <span className="text-gray-400">-</span>
                            )}
                          </td>
                          <td className="py-2 pr-3 text-xs text-gray-700">
                            {Array.isArray(q?.notes) && q.notes.length > 0 ? (
                              <div className="space-y-0.5 overflow-hidden" title={q.notes.join('\n')}>
                                {q.notes.slice(0, 4).map((n: string, idx: number) => (
                                  <div key={`${idx}-${n}`} className="truncate">
                                    {n}
                                  </div>
                                ))}
                                {q.notes.length > 4 ? <div className="text-gray-400 truncate">+{q.notes.length - 4} more</div> : null}
                              </div>
                            ) : (
                              <span className="text-gray-400">-</span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              ) : (
                <div className="text-sm text-gray-500">No Data Map parsed. Ensure your upload includes a Data Map sheet.</div>
              )}
            </div>
          ) : (
            <div className="p-4">
              <RawDataViewer
                data={rawData}
                page={rawDataPage}
                rowsPerPage={rawDataRowsPerPage}
                columnStart={rawDataColumnStart}
                columnsPerPage={rawDataColumnsPerPage}
                onPageChange={onPageChange}
                onColumnChange={onColumnChange}
                loading={loading || uploading}
                showMappedHeaderRow={false}
              />
            </div>
          )}
        </div>
      </div>

    </div>
  );
}





