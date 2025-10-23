import React, { useState } from 'react';
import { ArrowUpTrayIcon } from '@heroicons/react/24/outline';
import { API_BASE_URL } from '../config';

interface Theme {
  code: number;
  theme: string;
  description?: string;
  combinedFrom?: number[]; // Track which codes were merged into this one
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
  const [activeTab, setActiveTab] = useState<'summary' | 'codebook' | 'raw' | 'combine'>('summary');
  const [selectedQuestion, setSelectedQuestion] = useState<number>(0);
  const [selectedCodes, setSelectedCodes] = useState<number[]>([]);
  const [newCodeName, setNewCodeName] = useState<string>('');
  const [originalThemes, setOriginalThemes] = useState<Map<number, Theme[]>>(new Map());

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

  const handleCombineCodes = () => {
    if (!results || selectedCodes.length < 2) {
      setError('Please select at least 2 codes to combine');
      return;
    }

    if (!newCodeName.trim()) {
      setError('Please enter a name for the combined code');
      return;
    }

    const updatedResults = { ...results };
    const question = updatedResults.questions[selectedQuestion];

    // Get the first selected code as the primary code
    const primaryCode = Math.min(...selectedCodes);
    const codesToMerge = selectedCodes.filter(c => c !== primaryCode);

    // Store original themes before combining (for undo functionality)
    const themesToStore = selectedCodes
      .map(c => question.themes.find(t => t.code === c))
      .filter(Boolean) as Theme[];

    setOriginalThemes(prev => {
      const newMap = new Map(prev);
      newMap.set(primaryCode, themesToStore);
      return newMap;
    });

    // Update theme name for primary code
    const primaryTheme = question.themes.find(t => t.code === primaryCode);
    if (primaryTheme) {
      primaryTheme.theme = newCodeName.trim();
      primaryTheme.description = `Combined from codes: ${selectedCodes.join(', ')}`;
      primaryTheme.combinedFrom = [...selectedCodes]; // Track which codes were combined
    }

    // Remove merged themes
    question.themes = question.themes.filter(t => !codesToMerge.includes(t.code));

    // Update raw data: replace all merged codes with primary code, ensuring no duplicates per respondent
    question.rawData = question.rawData.map(item => {
      const hasMergedCode = item.codes.some(c => selectedCodes.includes(c));
      if (hasMergedCode) {
        // Remove all selected codes and add primary code once
        const filteredCodes = item.codes.filter(c => !selectedCodes.includes(c));
        return {
          ...item,
          codes: [...filteredCodes, primaryCode]
        };
      }
      return item;
    });

    // Recalculate frequency table
    const frequencies: Record<number, number> = {};
    const uniqueRespondents: Record<number, Set<string>> = {};

    question.themes.forEach(t => {
      frequencies[t.code] = 0;
      uniqueRespondents[t.code] = new Set();
    });

    question.rawData.forEach(item => {
      item.codes.forEach(code => {
        uniqueRespondents[code]?.add(item.respondentId);
      });
    });

    question.themes.forEach(t => {
      frequencies[t.code] = uniqueRespondents[t.code]?.size || 0;
    });

    const totalResponses = question.rawData.filter(r => r.codes.length > 0).length;

    question.frequencyTable = question.themes.map(t => ({
      code: t.code,
      theme: t.theme,
      frequency: frequencies[t.code] || 0,
      percentage: totalResponses > 0
        ? ((frequencies[t.code] || 0) / totalResponses * 100).toFixed(1)
        : '0.0'
    }));

    setResults(updatedResults);
    setSelectedCodes([]);
    setNewCodeName('');
    setError('');
    setActiveTab('summary');
  };

  const handleUndoCombine = (code: number) => {
    if (!results) return;

    const updatedResults = { ...results };
    const question = updatedResults.questions[selectedQuestion];
    const originalThemesForCode = originalThemes.get(code);

    if (!originalThemesForCode) return;

    // Remove the combined theme
    question.themes = question.themes.filter(t => t.code !== code);

    // Restore original themes
    question.themes.push(...originalThemesForCode.map(t => ({ ...t, combinedFrom: undefined })));
    question.themes.sort((a, b) => a.code - b.code);

    // Update raw data: split the combined code back to original codes
    question.rawData = question.rawData.map(item => {
      if (item.codes.includes(code)) {
        // Remove the combined code
        const filteredCodes = item.codes.filter(c => c !== code);

        // Find which original codes this respondent had
        const originalCodes = originalThemesForCode.map(t => t.code);

        // Add back the original codes (respondent gets all codes they originally had)
        return {
          ...item,
          codes: [...filteredCodes, ...originalCodes]
        };
      }
      return item;
    });

    // Recalculate frequencies
    const frequencies: Record<number, number> = {};
    const uniqueRespondents: Record<number, Set<string>> = {};

    question.themes.forEach(t => {
      frequencies[t.code] = 0;
      uniqueRespondents[t.code] = new Set();
    });

    question.rawData.forEach(item => {
      item.codes.forEach(c => {
        uniqueRespondents[c]?.add(item.respondentId);
      });
    });

    question.themes.forEach(t => {
      frequencies[t.code] = uniqueRespondents[t.code]?.size || 0;
    });

    const totalResponses = question.rawData.filter(r => r.codes.length > 0).length;

    question.frequencyTable = question.themes.map(t => ({
      code: t.code,
      theme: t.theme,
      frequency: frequencies[t.code] || 0,
      percentage: totalResponses > 0
        ? ((frequencies[t.code] || 0) / totalResponses * 100).toFixed(1)
        : '0.0'
    }));

    // Remove from originalThemes map
    setOriginalThemes(prev => {
      const newMap = new Map(prev);
      newMap.delete(code);
      return newMap;
    });

    setResults(updatedResults);
    setError('');
  };

  const toggleCodeSelection = (code: number) => {
    setSelectedCodes(prev => {
      const newSelection = prev.includes(code) ? prev.filter(c => c !== code) : [...prev, code];

      // Auto-generate combined name when we have 2+ codes selected
      if (newSelection.length >= 2 && currentQuestion) {
        const sortedCodes = [...newSelection].sort((a, b) => a - b);
        const themeNames = sortedCodes
          .map(c => currentQuestion.themes.find(t => t.code === c)?.theme)
          .filter(Boolean);
        setNewCodeName(themeNames.join(' / '));
      } else {
        setNewCodeName('');
      }

      return newSelection;
    });
  };

  const currentQuestion = results?.questions[selectedQuestion];

  return (
    <main className="flex-1 flex flex-col bg-[#F7F7F8] overflow-y-auto" style={{ height: 'calc(100vh - 80px)', marginTop: '80px' }}>
      {/* Upload Section */}
      {!processing && !results && (
        <div className="flex-1 flex items-center justify-center p-6">
          <div className="w-full max-w-3xl">
            <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-8">
              <h2 className="text-xl font-semibold text-gray-900 mb-6 text-center">Upload Your File</h2>

              <label className="block mb-4">
                <div className="flex flex-col items-center justify-center w-full px-6 py-12 border-2 border-dashed border-gray-300 rounded-lg cursor-pointer hover:border-[#D14A2D] transition-colors">
                  <ArrowUpTrayIcon className="h-12 w-12 text-gray-400 mb-3" />
                  <span className="text-sm font-medium text-gray-700 mb-1">
                    {file ? file.name : 'Choose a file to upload'}
                  </span>
                  <span className="text-xs text-gray-500">
                    Excel (.xlsx, .xls) or CSV
                  </span>
                  <input
                    type="file"
                    className="hidden"
                    accept=".xlsx,.xls,.csv"
                    onChange={handleFileChange}
                  />
                </div>
              </label>

              <button
                onClick={handleUpload}
                disabled={!file}
                className="w-full px-6 py-3 bg-[#D14A2D] text-white rounded-lg hover:bg-[#B83E25] disabled:bg-gray-300 disabled:cursor-not-allowed transition-colors font-medium"
              >
                Process File
              </button>

              {error && (
                <div className="mt-4 p-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">
                  {error}
                </div>
              )}

              <div className="mt-6 pt-6 border-t border-gray-200">
                <h3 className="text-sm font-semibold text-gray-900 mb-3">File Format Requirements:</h3>
                <ul className="space-y-2 text-xs text-gray-600 mb-4">
                  <li className="flex items-start">
                    <span className="text-[#D14A2D] mr-2">•</span>
                    <span>First column: Respondent IDs (labeled "record")</span>
                  </li>
                  <li className="flex items-start">
                    <span className="text-[#D14A2D] mr-2">•</span>
                    <span>Each column: A survey question</span>
                  </li>
                  <li className="flex items-start">
                    <span className="text-[#D14A2D] mr-2">•</span>
                    <span>Column headers: Question text</span>
                  </li>
                  <li className="flex items-start">
                    <span className="text-[#D14A2D] mr-2">•</span>
                    <span>Cells: Open-ended text responses</span>
                  </li>
                </ul>

                <div className="mt-4 p-4 bg-gray-50 rounded border border-gray-200">
                  <p className="text-xs font-medium text-gray-700 mb-2">Example Structure:</p>
                  <div className="overflow-x-auto">
                    <table className="text-xs border-collapse w-full">
                      <thead>
                        <tr className="bg-gray-100">
                          <th className="border border-gray-300 px-2 py-1 text-left">record</th>
                          <th className="border border-gray-300 px-2 py-1 text-left">What do you like most?</th>
                          <th className="border border-gray-300 px-2 py-1 text-left">What needs improvement?</th>
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
          </div>
        </div>
      )}

      {/* Loading Screen */}
      {processing && (
        <div className="flex-1 flex items-center justify-center p-6">
          <div className="text-center">
            <div className="flex justify-center items-center space-x-2 mb-4">
              <div className="w-3 h-3 bg-[#D14A2D] rounded-full animate-bounce" style={{ animationDelay: '0ms' }}></div>
              <div className="w-3 h-3 bg-[#D14A2D] rounded-full animate-bounce" style={{ animationDelay: '150ms' }}></div>
              <div className="w-3 h-3 bg-[#D14A2D] rounded-full animate-bounce" style={{ animationDelay: '300ms' }}></div>
            </div>
            <h3 className="text-lg font-semibold text-gray-900 mb-2">Processing Your File</h3>
            <p className="text-sm text-gray-600">
              Analyzing open-ended responses and generating themes...
            </p>
            <p className="text-xs text-gray-500 mt-2">
              This may take a few minutes depending on the number of responses
            </p>
          </div>
        </div>
      )}


      {/* Results Section */}
      {results && results.questions.length > 0 && (
        <div className="flex-1 flex flex-col">
          {/* Question Selector */}
          {results.questions.length > 1 && (
            <div className="px-6 py-3 bg-[#F7F7F8]">
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Select Question:
              </label>
              <select
                value={selectedQuestion}
                onChange={(e) => setSelectedQuestion(Number(e.target.value))}
                className="w-full px-3 py-2 bg-white border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#D14A2D] focus:border-transparent"
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
          <div className="border-b border-gray-200 px-6 bg-[#F7F7F8]">
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
              <button
                onClick={() => setActiveTab('combine')}
                className={`py-3 text-sm font-medium transition-colors relative ${
                  activeTab === 'combine'
                    ? 'text-[#D14A2D]'
                    : 'text-gray-600 hover:text-gray-900'
                }`}
              >
                Combine Codes
                {activeTab === 'combine' && (
                  <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-[#D14A2D]" />
                )}
              </button>
            </div>
          </div>

          {/* Tab Content */}
          <div className="p-6">
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
                            <th className="pl-6 pr-2 py-3 text-left text-xs font-medium text-gray-700 uppercase tracking-wider w-16">
                              Code
                            </th>
                            <th className="pr-4 py-3 text-left text-xs font-medium text-gray-700 uppercase tracking-wider w-auto">
                              Theme
                            </th>
                            <th className="px-4 py-3 text-center text-xs font-medium text-gray-700 uppercase tracking-wider w-24">
                              Frequency
                            </th>
                            <th className="px-6 py-3 text-center text-xs font-medium text-gray-700 uppercase tracking-wider w-24">
                              Percentage
                            </th>
                          </tr>
                        </thead>
                        <tbody className="bg-white divide-y divide-gray-200">
                          {currentQuestion.frequencyTable.map((item) => (
                            <tr key={item.code} className="hover:bg-gray-50">
                              <td className="pl-6 pr-2 py-4 whitespace-nowrap text-sm font-medium text-gray-900">
                                <span className="inline-flex items-center justify-center w-8 h-6 rounded-full text-xs font-medium bg-[#D14A2D] text-white">
                                  {item.code}
                                </span>
                              </td>
                              <td className="pr-4 py-4 text-sm text-gray-900">
                                {item.theme}
                              </td>
                              <td className="px-4 py-4 whitespace-nowrap text-sm text-gray-900 text-center">
                                {item.frequency}
                              </td>
                              <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900 text-center">
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
                            <th className="pl-6 pr-2 py-3 text-left text-xs font-medium text-gray-700 uppercase tracking-wider w-16">
                              Code
                            </th>
                            <th className="px-2 py-3 text-left text-xs font-medium text-gray-700 uppercase tracking-wider">
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
                              <td className="pl-6 pr-2 py-4 whitespace-nowrap text-sm font-medium text-gray-900">
                                <span className="inline-flex items-center justify-center w-8 h-6 rounded-full text-xs font-medium bg-[#D14A2D] text-white">
                                  {theme.code}
                                </span>
                              </td>
                              <td className="px-2 py-4 text-sm text-gray-900">
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
                            <th className="pl-6 pr-2 py-3 text-left text-xs font-medium text-gray-700 uppercase tracking-wider">
                              {results.idColumn}
                            </th>
                            <th className="px-2 py-3 text-left text-xs font-medium text-gray-700 uppercase tracking-wider">
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
                              <td className="pl-6 pr-2 py-4 whitespace-nowrap text-sm font-medium text-gray-900">
                                {item.respondentId}
                              </td>
                              <td className="px-2 py-4 text-sm text-gray-900 max-w-md">
                                {item.response || <span className="text-gray-400 italic">No response</span>}
                              </td>
                              <td className="px-6 py-4 text-sm text-gray-900">
                                {item.codes.length > 0 ? (
                                  <div className="flex flex-wrap gap-1">
                                    {item.codes.map((code) => (
                                      <span
                                        key={code}
                                        className="inline-flex items-center justify-center w-8 h-6 rounded-full text-xs font-medium bg-[#D14A2D] text-white"
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

                {/* Combine Codes Tab */}
                {activeTab === 'combine' && (
                  <div className="bg-white rounded-lg shadow-sm border border-gray-200">
                    <div className="px-6 py-4 border-b border-gray-200">
                      <h3 className="text-lg font-semibold text-gray-900">
                        Combine Similar Codes
                      </h3>
                      <p className="text-sm text-gray-600 mt-1">
                        Select codes to merge. Respondents will only be counted once if they mentioned any of the merged codes.
                      </p>
                    </div>

                    <div className="p-6 space-y-6">
                      {/* Code Selection */}
                      <div>
                        <h4 className="text-sm font-medium text-gray-900 mb-3">
                          Select codes to combine (minimum 2):
                        </h4>
                        <div className="space-y-2">
                          {currentQuestion.themes.map((theme) => (
                            <label
                              key={theme.code}
                              className="flex items-start p-3 border border-gray-200 rounded-lg hover:bg-gray-50 cursor-pointer"
                            >
                              <input
                                type="checkbox"
                                checked={selectedCodes.includes(theme.code)}
                                onChange={() => toggleCodeSelection(theme.code)}
                                className="h-4 w-4 text-[#D14A2D] focus:ring-[#D14A2D] border-gray-300 rounded mt-0.5"
                              />
                              <span className="inline-flex items-center justify-center w-8 h-6 rounded-full text-xs font-medium bg-[#D14A2D] text-white ml-3">
                                {theme.code}
                              </span>
                              <div className="ml-2 flex-1">
                                <div className="flex items-center justify-between">
                                  <span className="text-sm font-medium text-gray-900">
                                    {theme.theme}
                                  </span>
                                  {theme.combinedFrom && theme.combinedFrom.length > 1 && (
                                    <button
                                      onClick={(e) => {
                                        e.preventDefault();
                                        e.stopPropagation();
                                        handleUndoCombine(theme.code);
                                      }}
                                      className="ml-2 px-2 py-1 text-xs font-medium text-[#D14A2D] bg-red-50 border border-[#D14A2D] rounded hover:bg-red-100"
                                    >
                                      Undo Combine
                                    </button>
                                  )}
                                </div>
                                {theme.description && (
                                  <p className="text-xs text-gray-500 mt-1">
                                    {theme.description}
                                  </p>
                                )}
                              </div>
                            </label>
                          ))}
                        </div>
                      </div>

                      {/* Selected codes summary */}
                      {selectedCodes.length > 0 && (
                        <div className="bg-gray-50 p-4 rounded-lg">
                          <p className="text-sm font-medium text-gray-900 mb-2">
                            Selected codes ({selectedCodes.length}):
                          </p>
                          <div className="flex flex-wrap gap-2">
                            {selectedCodes.map(code => {
                              const theme = currentQuestion.themes.find(t => t.code === code);
                              return (
                                <span
                                  key={code}
                                  className="inline-flex items-center px-3 py-1 rounded-full text-sm bg-[#D14A2D] text-white"
                                >
                                  {code}: {theme?.theme}
                                </span>
                              );
                            })}
                          </div>
                        </div>
                      )}

                      {/* New code name input */}
                      {selectedCodes.length >= 2 && (
                        <div>
                          <label className="block text-sm font-medium text-gray-900 mb-2">
                            Enter name for combined code:
                          </label>
                          <input
                            type="text"
                            value={newCodeName}
                            onChange={(e) => setNewCodeName(e.target.value)}
                            placeholder="e.g., Evrysdi / Risdiplam"
                            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#D14A2D] focus:border-transparent"
                          />
                          <p className="text-xs text-gray-500 mt-1">
                            This will be the new name for code {Math.min(...selectedCodes)}. The other selected codes will be merged into it.
                          </p>
                        </div>
                      )}

                      {/* Combine button */}
                      <div className="flex justify-end gap-3">
                        <button
                          onClick={() => {
                            setSelectedCodes([]);
                            setNewCodeName('');
                            setError('');
                          }}
                          className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50"
                        >
                          Clear Selection
                        </button>
                        <button
                          onClick={handleCombineCodes}
                          disabled={selectedCodes.length < 2 || !newCodeName.trim()}
                          className="px-4 py-2 text-sm font-medium text-white bg-[#D14A2D] rounded-lg hover:bg-[#B13A1D] disabled:bg-gray-300 disabled:cursor-not-allowed"
                        >
                          Combine Codes
                        </button>
                      </div>
                    </div>
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      )}
    </main>
  );
};

export default OpenEndCoding;
