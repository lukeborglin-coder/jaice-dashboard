import React, { useState, useRef } from 'react';
import { CloudArrowUpIcon } from '@heroicons/react/24/outline';
import * as api from '../../services/dataQualityApi';

interface DataUploadTabProps {
  projectId: string;
  qaData: any[];
  loadingData: boolean;
  onUpload: (file: File, questionnaireId?: string) => Promise<any>;
  onLoadData: (page?: number, limit?: number) => Promise<any>;
}

export default function DataUploadTab({
  projectId,
  qaData,
  loadingData,
  onUpload,
  onLoadData
}: DataUploadTabProps) {
  const [uploading, setUploading] = useState(false);
  const [questionnaireId, setQuestionnaireId] = useState<string>('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileSelect = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    setUploading(true);
    try {
      await onUpload(file, questionnaireId || undefined);
      alert('Data uploaded successfully!');
      await onLoadData(1, 50);
    } catch (error: any) {
      console.error('Error uploading file:', error);
      alert(error.response?.data?.error || 'Failed to upload data file');
    } finally {
      setUploading(false);
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    }
  };

  return (
    <div className="p-6">
      <div className="mb-6">
        <h2 className="text-xl font-semibold mb-4">Data Upload</h2>
        
        {/* Upload Area */}
        <div className="border-2 border-dashed border-gray-300 rounded-lg p-8 text-center">
          <CloudArrowUpIcon className="w-12 h-12 text-gray-400 mx-auto mb-4" />
          <p className="text-gray-600 mb-2">Upload CSV or Excel data file</p>
          <p className="text-sm text-gray-500 mb-4">
            The file should contain RESPNO and columns needed for quality checks
          </p>
          
          <div className="mb-4">
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Questionnaire ID (optional, for column mapping):
            </label>
            <input
              type="text"
              value={questionnaireId}
              onChange={(e) => setQuestionnaireId(e.target.value)}
              placeholder="Enter questionnaire ID"
              className="px-3 py-2 border border-gray-300 rounded-lg w-64"
            />
          </div>
          
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
            className={`inline-block px-6 py-3 bg-orange-500 text-white rounded-lg cursor-pointer hover:bg-orange-600 ${
              uploading ? 'opacity-50 cursor-not-allowed' : ''
            }`}
          >
            {uploading ? 'Uploading...' : 'Select File'}
          </label>
        </div>
      </div>

      {/* Data Preview */}
      {qaData && qaData.length > 0 && (
        <div className="mt-6">
          <h3 className="text-lg font-semibold mb-4">Data Preview</h3>
          <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-200">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase sticky left-0 bg-gray-50">
                      RESPNO
                    </th>
                    {Object.keys(qaData[0]?.columns || {}).slice(0, 9).map((col) => (
                      <th key={col} className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                        {col}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-200">
                  {qaData.slice(0, 20).map((row, idx) => (
                    <tr key={idx} className="hover:bg-gray-50">
                      <td className="px-4 py-3 text-sm font-medium text-gray-900 sticky left-0 bg-white">
                        {row.respno}
                      </td>
                      {Object.keys(row.columns || {}).slice(0, 9).map((col) => (
                        <td key={col} className="px-4 py-3 text-sm text-gray-500">
                          {String(row.columns[col] || '-')}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {qaData.length > 20 && (
              <div className="px-4 py-3 bg-gray-50 text-sm text-gray-500 text-center">
                Showing first 20 of {qaData.length} rows
              </div>
            )}
          </div>
        </div>
      )}

      {loadingData && (
        <div className="text-center py-8 text-gray-500">Loading data...</div>
      )}
    </div>
  );
}


