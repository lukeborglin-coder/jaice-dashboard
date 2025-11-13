import React, { useState, useCallback } from 'react';
import { ArrowUpTrayIcon } from '@heroicons/react/24/outline';
import { type VariableDefinition, type ParsedDataFile } from '../utils/dataTabulationHelpers';

const BRAND_ORANGE = '#D14A2D';
const BRAND_BG = '#F7F7F8';
const BRAND_GRAY = '#5D5F62';

/**
 * Convert variable type to a more readable question type label
 */
function getQuestionTypeLabel(variable: VariableDefinition): string {
  if (variable.type === 'multi-select') {
    return 'Multi-Select';
  } else if (variable.type === 'grid') {
    return 'Select One Grid';
  } else if (variable.type === 'categorical') {
    return 'Single Select';
  } else if (variable.type === 'open-numeric') {
    return 'Numeric';
  } else if (variable.type === 'open-text') {
    return 'Open End';
  }
  return 'Unknown';
}

export default function TabTesting() {
  const [uploadedFile, setUploadedFile] = useState<File | null>(null);
  const [parsedFile, setParsedFile] = useState<ParsedDataFile | null>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string>('');

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

  return (
    <div className="flex-1 overflow-y-auto" style={{ backgroundColor: BRAND_BG, minHeight: 'calc(100vh - 80px)', marginTop: '80px' }}>
      <div className="max-w-7xl mx-auto p-6 space-y-6">
        <div className="bg-white shadow-sm border border-gray-200 rounded-lg p-8">
          <h2 className="text-2xl font-semibold text-gray-900 mb-6">Tab Testing</h2>
          
          {/* File Upload Section */}
          <div className="mb-8">
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
                id="file-upload-testing"
              />
              <label
                htmlFor="file-upload-testing"
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

          {/* Variables Display */}
          {parsedFile && parsedFile.variables.length > 0 && (
            <div className="space-y-6">
              <h3 className="text-lg font-semibold text-gray-900">
                Recognized Questions/Variables ({parsedFile.variables.length})
              </h3>
              
              <div className="grid grid-cols-1 gap-6">
                {parsedFile.variables.map((variable, index) => (
                  <div
                    key={variable.name}
                    className="border border-gray-200 rounded-lg p-6 bg-white shadow-sm"
                  >
                    {/* Variable Label */}
                    <div className="mb-4">
                      <h4 className="text-base font-semibold text-gray-900 mb-1">
                        {variable.name}
                      </h4>
                      
                      {/* Variable Text (Description) */}
                      <p className="text-sm text-gray-600 mb-3">
                        {variable.description || '(No description)'}
                      </p>
                      
                      {/* Question Type */}
                      <div className="flex items-center gap-2 mb-4">
                        <span className="text-xs font-medium text-gray-500">Question Type:</span>
                        <span className={`text-xs px-2 py-1 rounded ${
                          variable.type === 'multi-select' ? 'bg-purple-100 text-purple-800' :
                          variable.type === 'grid' ? 'bg-orange-100 text-orange-800' :
                          variable.type === 'categorical' ? 'bg-blue-100 text-blue-800' :
                          variable.type === 'open-numeric' ? 'bg-green-100 text-green-800' :
                          'bg-gray-100 text-gray-800'
                        }`}>
                          {getQuestionTypeLabel(variable)}
                        </span>
                      </div>
                    </div>

                    {/* Response Codes and Text Table */}
                    {(variable.type === 'categorical' || variable.type === 'multi-select' || variable.type === 'grid') && Object.keys(variable.codes).length > 0 ? (
                      <div className="border-t border-gray-200 pt-4">
                        <h5 className="text-sm font-medium text-gray-700 mb-3">
                          {variable.type === 'multi-select' ? 'Response Options (Multi-Select)' :
                           variable.type === 'grid' ? 'Response Codes (Apply to each statement)' :
                           'Response Options'}
                        </h5>
                        <div className="overflow-x-auto">
                          <table className="min-w-full divide-y divide-gray-200">
                            <thead className="bg-gray-50">
                              <tr>
                                <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                                  Response Code
                                </th>
                                <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                                  Response Text
                                </th>
                              </tr>
                            </thead>
                            <tbody className="bg-white divide-y divide-gray-200">
                              {Object.entries(variable.codes).map(([code, label]) => (
                                <tr key={code} className="hover:bg-gray-50">
                                  <td className="px-4 py-2 text-sm text-gray-900 font-mono">
                                    {code}
                                  </td>
                                  <td className="px-4 py-2 text-sm text-gray-900">
                                    {label || '(no label)'}
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    ) : variable.type === 'categorical' || variable.type === 'multi-select' || variable.type === 'grid' ? (
                      <div className="border-t border-gray-200 pt-4">
                        <p className="text-sm text-gray-500 italic">
                          No response codes defined for this {variable.type === 'multi-select' ? 'multi-select' :
                            variable.type === 'grid' ? 'grid' : 'categorical'} variable
                        </p>
                      </div>
                    ) : (
                      <div className="border-t border-gray-200 pt-4">
                        <p className="text-sm text-gray-500 italic">
                          {variable.type === 'open-numeric'
                            ? 'Numeric variable - no response codes'
                            : 'Open text variable - no response codes'}
                        </p>
                      </div>
                    )}

                    {/* Grid Statements (for grid questions only) */}
                    {variable.type === 'grid' && variable.statements && Object.keys(variable.statements).length > 0 && (
                      <div className="border-t border-gray-200 pt-4 mt-4">
                        <h5 className="text-sm font-medium text-gray-700 mb-3">
                          Grid Statements
                        </h5>
                        <div className="overflow-x-auto">
                          <table className="min-w-full divide-y divide-gray-200">
                            <thead className="bg-gray-50">
                              <tr>
                                <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                                  Statement #
                                </th>
                                <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                                  Statement Text
                                </th>
                              </tr>
                            </thead>
                            <tbody className="bg-white divide-y divide-gray-200">
                              {Object.entries(variable.statements).map(([num, statement]) => (
                                <tr key={num} className="hover:bg-gray-50">
                                  <td className="px-4 py-2 text-sm text-gray-900 font-mono">
                                    {num}
                                  </td>
                                  <td className="px-4 py-2 text-sm text-gray-900">
                                    {statement || '(no statement)'}
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    )}
                    
                    {/* Show indicator if this is a multi-select option sub-variable */}
                    {variable.isMultiSelectOption && variable.parentMultiSelect && (
                      <div className="border-t border-gray-200 pt-4 mt-4">
                        <p className="text-xs text-gray-500 italic">
                          This is a sub-variable of multi-select question: <span className="font-medium">{variable.parentMultiSelect}</span>
                        </p>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Empty State */}
          {!parsedFile && !uploading && !error && (
            <div className="text-center py-12">
              <p className="text-gray-500">Upload a data file to see recognized questions and variables</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

