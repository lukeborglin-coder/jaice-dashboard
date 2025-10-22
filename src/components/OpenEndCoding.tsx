import React, { useState } from 'react';
import { ArrowUpTrayIcon } from '@heroicons/react/24/outline';
import { API_BASE_URL } from '../config';

interface Theme {
  code: number;
  theme: string;
  description?: string;
}

interface FrequencyItem {
  code: number;
  theme: string;
  frequency: number;
  percentage: string;
}

interface RawDataItem {
  respondentId: string;
  response: string;
  codes: number[];
}

interface QuestionResult {
  question: string;
  themes: Theme[];
  frequencyTable: FrequencyItem[];
  rawData: RawDataItem[];
}

interface ProcessingResults {
  idColumn: string;
  questions: QuestionResult[];
  totalTokens: number;
  totalCost: number;
}

const OpenEndCoding: React.FC = () => {
  const [file, setFile] = useState<File | null>(null);
  const [processing, setProcessing] = useState(false);
  const [results, setResults] = useState<ProcessingResults | null>(null);
  const [error, setError] = useState<string>('');
  const [activeTab, setActiveTab] = useState<'summary' | 'codebook' | 'raw'>('summary');
  const [selectedQuestion, setSelectedQuestion] = useState<number>(0);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      setFile(e.target.files[0]);
      setError('');
      setResults(null);
    }
  };

  const handleUpload = async () => {
    if (!file) {
      setError('Please select a file first');
      return;
    }

    setProcessing(true);
    setError('');

    try {
      const formData = new FormData();
      formData.append('file', file);

      const token = localStorage.getItem('cognitive_dash_token');
      const response = await fetch(`${API_BASE_URL}/api/openend/process`, {
        method: 'POST',
        body: formData,
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to process file');
      }

      const data = await response.json();
      setResults(data);
      setSelectedQuestion(0);
      setActiveTab('summary');

    } catch (err) {
      console.error('Upload error:', err);
      setError(err instanceof Error ? err.message : 'An error occurred while processing the file');
    } finally {
      setProcessing(false);
    }
  };

  const currentQuestion = results?.questions[selectedQuestion];

  return (
    <div className="h-full flex flex-col bg-[#F7F7F8]">
      {/* Header */}
      <div className="bg-white border-b border-gray-200 px-6 py-4">
        <h1 className="text-2xl font-bold text-gray-900">Open-End Coding</h1>
        <p className="text-sm text-gray-600 mt-1">
          Upload an Excel file with open-ended survey responses to automatically generate themes and codes
        </p>
      </div>

      {/* Upload Section */}
      <div className="bg-white border-b border-gray-200 px-6 py-4">
        <div className="flex items-center gap-4">
          <div className="flex-1">
            <label className="block">
              <div className="flex items-center justify-center w-full px-4 py-3 border-2 border-dashed border-gray-300 rounded-lg cursor-pointer hover:border-[#D14A2D] transition-colors">
                <ArrowUpTrayIcon className="h-5 w-5 text-gray-400 mr-2" />
                <span className="text-sm text-gray-600">
                  {file ? file.name : 'Choose Excel file (.xlsx, .xls, .csv)'}
                </span>
                <input
                  type="file"
                  className="hidden"
                  accept=".xlsx,.xls,.csv"
                  onChange={handleFileChange}
                  disabled={processing}
                />
              </div>
            </label>
          </div>
          <button
            onClick={handleUpload}
            disabled={!file || processing}
            className="px-6 py-3 bg-[#D14A2D] text-white rounded-lg hover:bg-[#B83E25] disabled:bg-gray-300 disabled:cursor-not-allowed transition-colors font-medium"
          >
            {processing ? 'Processing...' : 'Process File'}
          </button>
        </div>

        {error && (
          <div className="mt-4 p-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">
            {error}
          </div>
        )}

        {processing && (
          <div className="mt-4 p-3 bg-blue-50 border border-blue-200 rounded-lg text-blue-700 text-sm">
            Processing your file... This may take a few minutes depending on the number of responses.
          </div>
        )}

        {results && (
          <div className="mt-4 p-3 bg-green-50 border border-green-200 rounded-lg text-green-700 text-sm">
            Processing complete! Analyzed {results.questions.length} question(s) using {results.totalTokens.toLocaleString()} tokens (${results.totalCost.toFixed(4)})
          </div>
        )}
      </div>

      {/* File Format Instructions */}
      {!results && (
        <div className="flex-1 flex items-center justify-center p-6">
          <div className="max-w-2xl bg-white rounded-lg shadow-sm border border-gray-200 p-6">
            <h3 className="text-lg font-semibold text-gray-900 mb-4">File Format Requirements</h3>
            <div className="space-y-3 text-sm text-gray-600">
              <div className="flex items-start">
                <span className="font-medium text-[#D14A2D] mr-2">1.</span>
                <span>First column should contain respondent IDs</span>
              </div>
              <div className="flex items-start">
                <span className="font-medium text-[#D14A2D] mr-2">2.</span>
                <span>Each subsequent column represents a survey question</span>
              </div>
              <div className="flex items-start">
                <span className="font-medium text-[#D14A2D] mr-2">3.</span>
                <span>Column headers will be used as question text</span>
              </div>
              <div className="flex items-start">
                <span className="font-medium text-[#D14A2D] mr-2">4.</span>
                <span>Each row represents a respondent's answers</span>
              </div>
              <div className="flex items-start">
                <span className="font-medium text-[#D14A2D] mr-2">5.</span>
                <span>Cells contain the actual open-ended text responses</span>
              </div>
            </div>
            <div className="mt-6 p-4 bg-gray-50 rounded border border-gray-200">
              <p className="text-xs font-medium text-gray-700 mb-2">Example Structure:</p>
              <div className="overflow-x-auto">
                <table className="text-xs border-collapse">
                  <thead>
                    <tr className="bg-gray-100">
                      <th className="border border-gray-300 px-2 py-1">Respondent_ID</th>
                      <th className="border border-gray-300 px-2 py-1">What do you like most?</th>
                      <th className="border border-gray-300 px-2 py-1">What needs improvement?</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr>
                      <td className="border border-gray-300 px-2 py-1">001</td>
                      <td className="border border-gray-300 px-2 py-1">Great quality and value</td>
                      <td className="border border-gray-300 px-2 py-1">Shipping is too expensive</td>
                    </tr>
                    <tr>
                      <td className="border border-gray-300 px-2 py-1">002</td>
                      <td className="border border-gray-300 px-2 py-1">Easy to use interface</td>
                      <td className="border border-gray-300 px-2 py-1">Need better customer support</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Results Section */}
      {results && results.questions.length > 0 && (
        <div className="flex-1 flex flex-col overflow-hidden">
          {/* Question Selector */}
          {results.questions.length > 1 && (
            <div className="bg-white border-b border-gray-200 px-6 py-3">
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Select Question:
              </label>
              <select
                value={selectedQuestion}
                onChange={(e) => setSelectedQuestion(Number(e.target.value))}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#D14A2D] focus:border-transparent"
              >
                {results.questions.map((q, idx) => (
                  <option key={idx} value={idx}>
                    {q.question}
                  </option>
                ))}
              </select>
            </div>
          )}

          {/* Tabs */}
          <div className="bg-white border-b border-gray-200 px-6">
            <div className="flex gap-6">
              <button
                onClick={() => setActiveTab('summary')}
                className={`py-3 text-sm font-medium transition-colors relative ${
                  activeTab === 'summary'
                    ? 'text-[#D14A2D]'
                    : 'text-gray-600 hover:text-gray-900'
                }`}
              >
                Summary
                {activeTab === 'summary' && (
                  <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-[#D14A2D]" />
                )}
              </button>
              <button
                onClick={() => setActiveTab('codebook')}
                className={`py-3 text-sm font-medium transition-colors relative ${
                  activeTab === 'codebook'
                    ? 'text-[#D14A2D]'
                    : 'text-gray-600 hover:text-gray-900'
                }`}
              >
                Codebook
                {activeTab === 'codebook' && (
                  <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-[#D14A2D]" />
                )}
              </button>
              <button
                onClick={() => setActiveTab('raw')}
                className={`py-3 text-sm font-medium transition-colors relative ${
                  activeTab === 'raw'
                    ? 'text-[#D14A2D]'
                    : 'text-gray-600 hover:text-gray-900'
                }`}
              >
                Raw Codes
                {activeTab === 'raw' && (
                  <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-[#D14A2D]" />
                )}
              </button>
            </div>
          </div>

          {/* Tab Content */}
          <div className="flex-1 overflow-auto p-6">
            {currentQuestion && (
              <>
                {/* Summary Tab */}
                {activeTab === 'summary' && (
                  <div className="bg-white rounded-lg shadow-sm border border-gray-200">
                    <div className="px-6 py-4 border-b border-gray-200">
                      <h3 className="text-lg font-semibold text-gray-900">
                        {currentQuestion.question}
                      </h3>
                      <p className="text-sm text-gray-600 mt-1">
                        Total responses coded: {currentQuestion.rawData.filter(r => r.codes.length > 0).length}
                      </p>
                    </div>
                    <div className="overflow-x-auto">
                      <table className="w-full">
                        <thead className="bg-gray-50">
                          <tr>
                            <th className="px-6 py-3 text-left text-xs font-medium text-gray-700 uppercase tracking-wider">
                              Code
                            </th>
                            <th className="px-6 py-3 text-left text-xs font-medium text-gray-700 uppercase tracking-wider">
                              Theme
                            </th>
                            <th className="px-6 py-3 text-right text-xs font-medium text-gray-700 uppercase tracking-wider">
                              Frequency
                            </th>
                            <th className="px-6 py-3 text-right text-xs font-medium text-gray-700 uppercase tracking-wider">
                              Percentage
                            </th>
                          </tr>
                        </thead>
                        <tbody className="bg-white divide-y divide-gray-200">
                          {currentQuestion.frequencyTable.map((item) => (
                            <tr key={item.code} className="hover:bg-gray-50">
                              <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">
                                {item.code}
                              </td>
                              <td className="px-6 py-4 text-sm text-gray-900">
                                {item.theme}
                              </td>
                              <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900 text-right">
                                {item.frequency}
                              </td>
                              <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900 text-right">
                                {item.percentage}%
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}

                {/* Codebook Tab */}
                {activeTab === 'codebook' && (
                  <div className="bg-white rounded-lg shadow-sm border border-gray-200">
                    <div className="px-6 py-4 border-b border-gray-200">
                      <h3 className="text-lg font-semibold text-gray-900">
                        Codebook: {currentQuestion.question}
                      </h3>
                      <p className="text-sm text-gray-600 mt-1">
                        {currentQuestion.themes.length} themes identified
                      </p>
                    </div>
                    <div className="overflow-x-auto">
                      <table className="w-full">
                        <thead className="bg-gray-50">
                          <tr>
                            <th className="px-6 py-3 text-left text-xs font-medium text-gray-700 uppercase tracking-wider">
                              Code #
                            </th>
                            <th className="px-6 py-3 text-left text-xs font-medium text-gray-700 uppercase tracking-wider">
                              Theme
                            </th>
                            <th className="px-6 py-3 text-left text-xs font-medium text-gray-700 uppercase tracking-wider">
                              Description
                            </th>
                          </tr>
                        </thead>
                        <tbody className="bg-white divide-y divide-gray-200">
                          {currentQuestion.themes.map((theme) => (
                            <tr key={theme.code} className="hover:bg-gray-50">
                              <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">
                                {theme.code}
                              </td>
                              <td className="px-6 py-4 text-sm font-semibold text-gray-900">
                                {theme.theme}
                              </td>
                              <td className="px-6 py-4 text-sm text-gray-600">
                                {theme.description || '-'}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}

                {/* Raw Codes Tab */}
                {activeTab === 'raw' && (
                  <div className="bg-white rounded-lg shadow-sm border border-gray-200">
                    <div className="px-6 py-4 border-b border-gray-200">
                      <h3 className="text-lg font-semibold text-gray-900">
                        Raw Codes: {currentQuestion.question}
                      </h3>
                      <p className="text-sm text-gray-600 mt-1">
                        Individual respondent codes
                      </p>
                    </div>
                    <div className="overflow-x-auto">
                      <table className="w-full">
                        <thead className="bg-gray-50">
                          <tr>
                            <th className="px-6 py-3 text-left text-xs font-medium text-gray-700 uppercase tracking-wider">
                              {results.idColumn}
                            </th>
                            <th className="px-6 py-3 text-left text-xs font-medium text-gray-700 uppercase tracking-wider">
                              Response
                            </th>
                            <th className="px-6 py-3 text-left text-xs font-medium text-gray-700 uppercase tracking-wider">
                              Codes Assigned
                            </th>
                          </tr>
                        </thead>
                        <tbody className="bg-white divide-y divide-gray-200">
                          {currentQuestion.rawData.map((item, idx) => (
                            <tr key={idx} className="hover:bg-gray-50">
                              <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">
                                {item.respondentId}
                              </td>
                              <td className="px-6 py-4 text-sm text-gray-900 max-w-md">
                                {item.response || <span className="text-gray-400 italic">No response</span>}
                              </td>
                              <td className="px-6 py-4 text-sm text-gray-900">
                                {item.codes.length > 0 ? (
                                  <div className="flex flex-wrap gap-1">
                                    {item.codes.map((code) => (
                                      <span
                                        key={code}
                                        className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-[#D14A2D] text-white"
                                      >
                                        {code}
                                      </span>
                                    ))}
                                  </div>
                                ) : (
                                  <span className="text-gray-400 italic">No codes</span>
                                )}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export default OpenEndCoding;
