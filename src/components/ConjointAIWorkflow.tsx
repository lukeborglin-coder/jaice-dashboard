import { useState } from "react";
import axios from "axios";
import { API_BASE_URL } from '../config';

const API_BASE = `${API_BASE_URL}/api/conjoint`;

interface ConjointAIWorkflowProps {
  projectId: string;
  onWorkflowCreated?: (workflowId: string) => void;
}

interface Step1Analysis {
  conjointSection: string;
  sectionDescription: string;
  products: string[];
  marketShareQuestion: string;
}

interface Step2Analysis {
  attributes: Array<{
    attributeNo: string;
    attributeText: string;
    levels: Array<{
      code: string;
      levelNo: string;
      levelText: string;
    }>;
  }>;
  totalAttributeLevels: number;
  normalizedAttributes: any[];
}

interface Step3Analysis {
  designSummary: {
    totalRows: number;
    attColumnCount: number;
    attColumns?: string[];
    versions: any[];
    attributeCoverage: any[];
    allColumns?: string[];
    identifiedColumns?: {
      taskColumn: string | null;
      conceptColumn: string | null;
      versionColumn: string | null;
      conceptValues?: string[]; // Concept numbers detected in the design matrix
    };
    sampleRows?: any[];
  };
}

export default function ConjointAIWorkflow({ projectId, onWorkflowCreated }: ConjointAIWorkflowProps) {
  const [currentStep, setCurrentStep] = useState(1);
  const [questionnaireFile, setQuestionnaireFile] = useState<File | null>(null);
  const [attributeListFile, setAttributeListFile] = useState<File | null>(null);
  const [designFile, setDesignFile] = useState<File | null>(null);
  
  const [analyzingStep1, setAnalyzingStep1] = useState(false);
  const [analyzingStep2, setAnalyzingStep2] = useState(false);
  const [analyzingStep3, setAnalyzingStep3] = useState(false);
  
  const [step1Result, setStep1Result] = useState<Step1Analysis | null>(null);
  const [step2Result, setStep2Result] = useState<Step2Analysis | null>(null);
  const [step3Result, setStep3Result] = useState<Step3Analysis | null>(null);
  
  const [error, setError] = useState<string | null>(null);
  const [finalizing, setFinalizing] = useState(false);
  const [workflowName, setWorkflowName] = useState('');
  const [tempWorkflowId, setTempWorkflowId] = useState<string | null>(null);

  async function handleAnalyzeStep1() {
    if (!questionnaireFile) {
      setError("Please upload a questionnaire file");
      return;
    }

    setAnalyzingStep1(true);
    setError(null);

    try {
      const formData = new FormData();
      formData.append('questionnaire', questionnaireFile);
      formData.append('projectId', projectId);

      const response = await axios.post(`${API_BASE}/ai-workflow/analyze-questionnaire`, formData, {
        headers: {
          'Content-Type': 'multipart/form-data',
          Authorization: `Bearer ${localStorage.getItem('cognitive_dash_token') || localStorage.getItem('token') || ''}`
        }
      });

      if (response.data.success && response.data.analysis) {
        setStep1Result(response.data.analysis);
        setError(null);
      } else {
        throw new Error(response.data.message || 'Analysis failed');
      }
    } catch (err: any) {
      console.error('Error analyzing questionnaire:', err);
      setError(err?.response?.data?.detail || err?.response?.data?.message || err.message || 'Failed to analyze questionnaire file');
    } finally {
      setAnalyzingStep1(false);
    }
  }

  async function handleAnalyzeStep2() {
    if (!attributeListFile) {
      setError("Please upload an attribute list file");
      return;
    }

    setAnalyzingStep2(true);
    setError(null);

    try {
      const formData = new FormData();
      formData.append('attributeList', attributeListFile);
      formData.append('projectId', projectId);

      const response = await axios.post(`${API_BASE}/ai-workflow/analyze-attributes`, formData, {
        headers: {
          'Content-Type': 'multipart/form-data',
          Authorization: `Bearer ${localStorage.getItem('cognitive_dash_token') || localStorage.getItem('token') || ''}`
        }
      });

      if (response.data.success && response.data.analysis) {
        setStep2Result(response.data.analysis);
        setError(null);
      } else {
        throw new Error(response.data.message || 'Analysis failed');
      }
    } catch (err: any) {
      console.error('Error analyzing attributes:', err);
      setError(err?.response?.data?.detail || err?.response?.data?.message || err.message || 'Failed to analyze attribute list file');
    } finally {
      setAnalyzingStep2(false);
    }
  }

  async function handleAnalyzeStep3() {
    if (!designFile) {
      setError("Please upload a design file");
      return;
    }

    setAnalyzingStep3(true);
    setError(null);

    try {
      const formData = new FormData();
      formData.append('designFile', designFile);
      formData.append('projectId', projectId);
      formData.append('questionnaireAnalysis', JSON.stringify({ analysis: step1Result }));
      formData.append('attributeAnalysis', JSON.stringify(step2Result));

      const response = await axios.post(`${API_BASE}/ai-workflow/analyze-design`, formData, {
        headers: {
          'Content-Type': 'multipart/form-data',
          Authorization: `Bearer ${localStorage.getItem('cognitive_dash_token') || localStorage.getItem('token') || ''}`
        }
      });

      if (response.data.success && response.data.tempWorkflowId) {
        setStep3Result(response.data.analysis);
        setTempWorkflowId(response.data.tempWorkflowId);
        setError(null);
      } else {
        throw new Error(response.data.message || 'Analysis failed');
      }
    } catch (err: any) {
      console.error('Error analyzing design:', err);
      setError(err?.response?.data?.detail || err?.response?.data?.message || err.message || 'Failed to analyze design file');
    } finally {
      setAnalyzingStep3(false);
    }
  }

  async function handleFinalize() {
    if (!tempWorkflowId) {
      setError("No workflow to finalize");
      return;
    }

    if (!workflowName.trim()) {
      setError("Please enter a workflow name");
      return;
    }

    setFinalizing(true);
    setError(null);
    try {
      const token = localStorage.getItem('cognitive_dash_token');
      const response = await fetch(`${API_BASE_URL}/api/conjoint/ai-workflow/finalize`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({
          tempWorkflowId: tempWorkflowId,
          name: workflowName.trim()
        })
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.detail || 'Failed to finalize workflow');
      }

      const result = await response.json();
      
      // Call the callback to notify parent component
      if (onWorkflowCreated) {
        onWorkflowCreated(result.workflow.id);
      }

      // Reset form
      setQuestionnaireFile(null);
      setAttributeListFile(null);
      setDesignFile(null);
      setStep1Result(null);
      setStep2Result(null);
      setStep3Result(null);
      setTempWorkflowId(null);
      setWorkflowName('');
      setError(null);
      setCurrentStep(1);

      alert('Workflow created successfully! You can now find it in the Conjoint Simulator tab.');

    } catch (error: any) {
      console.error('Finalization error:', error);
      setError(error.message || 'Failed to finalize workflow');
    } finally {
      setFinalizing(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="bg-white rounded-2xl p-6 shadow">
        <div className="mb-6">
          <h2 className="text-xl font-semibold text-gray-900">AI-Powered Conjoint Workflow</h2>
          <p className="text-sm text-gray-600 mt-2">
            Upload your files step by step. AI will analyze each file and show you the results for confirmation before proceeding.
          </p>
        </div>

        {/* Step Progress Indicator */}
        <div className="mb-6 flex items-center justify-between">
          <div className={`flex items-center ${currentStep >= 1 ? 'text-blue-600' : 'text-gray-400'}`}>
            <div className={`w-8 h-8 rounded-full flex items-center justify-center font-semibold ${currentStep >= 1 ? 'bg-blue-600 text-white' : 'bg-gray-200 text-gray-500'}`}>
              {step1Result ? '✓' : '1'}
            </div>
            <span className="ml-2 text-sm font-medium">Questionnaire</span>
          </div>
          <div className={`flex-1 h-0.5 mx-4 ${currentStep >= 2 ? 'bg-blue-600' : 'bg-gray-200'}`} />
          <div className={`flex items-center ${currentStep >= 2 ? 'text-blue-600' : 'text-gray-400'}`}>
            <div className={`w-8 h-8 rounded-full flex items-center justify-center font-semibold ${currentStep >= 2 ? 'bg-blue-600 text-white' : 'bg-gray-200 text-gray-500'}`}>
              {step2Result ? '✓' : '2'}
            </div>
            <span className="ml-2 text-sm font-medium">Attributes</span>
          </div>
          <div className={`flex-1 h-0.5 mx-4 ${currentStep >= 3 ? 'bg-blue-600' : 'bg-gray-200'}`} />
          <div className={`flex items-center ${currentStep >= 3 ? 'text-blue-600' : 'text-gray-400'}`}>
            <div className={`w-8 h-8 rounded-full flex items-center justify-center font-semibold ${currentStep >= 3 ? 'bg-blue-600 text-white' : 'bg-gray-200 text-gray-500'}`}>
              {step3Result ? '✓' : '3'}
            </div>
            <span className="ml-2 text-sm font-medium">Design</span>
          </div>
        </div>

        {/* Error Display */}
        {error && (
          <div className="mb-4 p-4 bg-red-50 border border-red-200 rounded-lg">
            <p className="text-sm text-red-800 font-semibold">Error</p>
            <p className="text-sm text-red-700 mt-1">{error}</p>
          </div>
        )}

        {/* Step 1: Questionnaire */}
        {currentStep === 1 && (
          <div className="space-y-4">
            <div className="border border-gray-300 rounded-lg p-4">
              <label className="block text-sm font-semibold text-gray-700 mb-2">
                Step 1: Upload Questionnaire (Word Document)
              </label>
              <p className="text-xs text-gray-500 mb-3">
                Upload your questionnaire Word document. AI will identify the conjoint section and extract product/question details.
              </p>
              <input
                type="file"
                accept=".doc,.docx"
                onChange={e => {
                  setQuestionnaireFile(e.target.files?.[0] || null);
                  setStep1Result(null);
                  setError(null);
                }}
                className="block w-full text-sm text-gray-600 file:mr-4 file:py-2 file:px-4 file:rounded-lg file:border-0 file:text-sm file:font-semibold file:bg-blue-50 file:text-blue-700 hover:file:bg-blue-100"
              />
              {questionnaireFile && (
                <div className="mt-2 text-xs text-green-600 flex items-center gap-1">
                  <span>✓</span>
                  <span>{questionnaireFile.name}</span>
                </div>
              )}
            </div>

            <button
              onClick={handleAnalyzeStep1}
              disabled={analyzingStep1 || !questionnaireFile}
              className="w-full px-6 py-3 rounded-xl bg-black text-white font-semibold disabled:opacity-50 disabled:cursor-not-allowed hover:bg-gray-800 transition"
            >
              {analyzingStep1 ? "Analyzing with AI..." : "Analyze Questionnaire"}
            </button>

            {/* Step 1 Results */}
            {step1Result && (
              <div className="mt-4 p-4 bg-green-50 border border-green-200 rounded-lg">
                <h3 className="text-sm font-semibold text-green-800 mb-3">✓ Analysis Complete - Step 1</h3>

                <div className="space-y-3 text-sm">
                  <div>
                    <p className="font-semibold text-gray-700">Conjoint Section:</p>
                    <p className="text-gray-600 mt-1">{step1Result.conjointSection}</p>
                  </div>

                  {step1Result.sectionDescription && (
                    <div>
                      <p className="font-semibold text-gray-700">Description:</p>
                      <p className="text-gray-600 mt-1">{step1Result.sectionDescription}</p>
                    </div>
                  )}

                  {step1Result.products && step1Result.products.length > 0 && (
                    <div>
                      <p className="font-semibold text-gray-700">Products Found ({step1Result.products.length}):</p>
                      <ul className="text-gray-600 list-disc list-inside mt-1 space-y-1">
                        {step1Result.products.map((product: any, i: number) => (
                          <li key={i}>{typeof product === 'string' ? product : product.name || product}</li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {step1Result.marketShareQuestion && (
                    <div>
                      <p className="font-semibold text-gray-700">Market Share Question:</p>
                      <p className="text-gray-600 mt-1">{step1Result.marketShareQuestion}</p>
                    </div>
                  )}
                </div>

                <div className="mt-4 flex gap-2">
                  <button
                    onClick={() => {
                      setQuestionnaireFile(null);
                      setStep1Result(null);
                    }}
                    className="px-4 py-2 text-sm border border-gray-300 rounded-lg hover:bg-gray-50 transition"
                  >
                    Re-upload File
                  </button>
                  <button
                    onClick={() => {
                      setCurrentStep(2);
                      setError(null);
                    }}
                    className="flex-1 px-4 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition"
                  >
                    Continue to Step 2 →
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Step 2: Attribute List */}
        {currentStep === 2 && (
          <div className="space-y-4">
            <div className="border border-gray-300 rounded-lg p-4">
              <label className="block text-sm font-semibold text-gray-700 mb-2">
                Step 2: Upload Attribute List (Excel)
              </label>
              <p className="text-xs text-gray-500 mb-3">
                Upload the Excel file containing your attribute definitions and levels.
              </p>
              <input
                type="file"
                accept=".xlsx,.xls"
                onChange={e => {
                  setAttributeListFile(e.target.files?.[0] || null);
                  setStep2Result(null);
                  setError(null);
                }}
                className="block w-full text-sm text-gray-600 file:mr-4 file:py-2 file:px-4 file:rounded-lg file:border-0 file:text-sm file:font-semibold file:bg-blue-50 file:text-blue-700 hover:file:bg-blue-100"
              />
              {attributeListFile && (
                <div className="mt-2 text-xs text-green-600 flex items-center gap-1">
                  <span>✓</span>
                  <span>{attributeListFile.name}</span>
                </div>
              )}
            </div>

            <button
              onClick={handleAnalyzeStep2}
              disabled={analyzingStep2 || !attributeListFile}
              className="w-full px-6 py-3 rounded-xl bg-black text-white font-semibold disabled:opacity-50 disabled:cursor-not-allowed hover:bg-gray-800 transition"
            >
              {analyzingStep2 ? "Analyzing with AI..." : "Analyze Attribute List"}
            </button>

            {/* Step 2 Results */}
            {step2Result && (
              <div className="mt-4 p-4 bg-green-50 border border-green-200 rounded-lg">
                <h3 className="text-sm font-semibold text-green-800 mb-3">✓ Analysis Complete - Step 2</h3>

                <div className="space-y-3 text-sm">
                  <div>
                    <p className="font-semibold text-gray-700">Attributes Found:</p>
                    <p className="text-gray-600 mt-1">{step2Result.attributes.length} attributes, {step2Result.totalAttributeLevels} total levels</p>
                  </div>

                  <div className="max-h-64 overflow-y-auto">
                    <div className="space-y-2">
                      {step2Result.attributes.map((attr: any, i: number) => (
                        <div key={i} className="border-l-2 border-blue-200 pl-2 py-1">
                          <div className="font-medium text-gray-700">
                            Attribute {attr.attributeNo}: {attr.attributeText}
                          </div>
                          {attr.levels && attr.levels.length > 0 && (
                            <div className="ml-2 mt-1 text-gray-500 text-xs">
                              <div className="mb-1">{attr.levels.length} levels:</div>
                              <ul className="list-disc list-inside space-y-0.5">
                                {attr.levels.slice(0, 3).map((level: any, j: number) => (
                                  <li key={j}>
                                    {level.levelText || level.name || level}
                                  </li>
                                ))}
                                {attr.levels.length > 3 && (
                                  <li className="text-gray-400">
                                    ... and {attr.levels.length - 3} more levels
                                  </li>
                                )}
                              </ul>
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                </div>

                <div className="mt-4 flex gap-2">
                  <button
                    onClick={() => {
                      setCurrentStep(1);
                      setError(null);
                    }}
                    className="px-4 py-2 text-sm border border-gray-300 rounded-lg hover:bg-gray-50 transition"
                  >
                    ← Back to Step 1
                  </button>
                  <button
                    onClick={() => {
                      setAttributeListFile(null);
                      setStep2Result(null);
                    }}
                    className="px-4 py-2 text-sm border border-gray-300 rounded-lg hover:bg-gray-50 transition"
                  >
                    Re-upload File
                  </button>
                  <button
                    onClick={() => {
                      setCurrentStep(3);
                      setError(null);
                    }}
                    className="flex-1 px-4 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition"
                  >
                    Continue to Step 3 →
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Step 3: Design Matrix */}
        {currentStep === 3 && (
          <div className="space-y-4">
            <div className="border border-gray-300 rounded-lg p-4">
              <label className="block text-sm font-semibold text-gray-700 mb-2">
                Step 3: Upload Design Matrix (Excel)
              </label>
              <p className="text-xs text-gray-500 mb-3">
                Upload the Excel file containing your conjoint design matrix. The file should have a second sheet with Task/Concept/Attribute columns.
              </p>
              <input
                type="file"
                accept=".xlsx,.xls"
                onChange={e => {
                  setDesignFile(e.target.files?.[0] || null);
                  setStep3Result(null);
                  setTempWorkflowId(null);
                  setError(null);
                }}
                className="block w-full text-sm text-gray-600 file:mr-4 file:py-2 file:px-4 file:rounded-lg file:border-0 file:text-sm file:font-semibold file:bg-blue-50 file:text-blue-700 hover:file:bg-blue-100"
              />
              {designFile && (
                <div className="mt-2 text-xs text-green-600 flex items-center gap-1">
                  <span>✓</span>
                  <span>{designFile.name}</span>
                </div>
              )}
            </div>

            <button
              onClick={handleAnalyzeStep3}
              disabled={analyzingStep3 || !designFile}
              className="w-full px-6 py-3 rounded-xl bg-black text-white font-semibold disabled:opacity-50 disabled:cursor-not-allowed hover:bg-gray-800 transition"
            >
              {analyzingStep3 ? "Analyzing with AI..." : "Analyze Design Matrix"}
            </button>

            {/* Step 3 Results */}
            {step3Result && tempWorkflowId && (
              <div className="mt-4 p-4 bg-green-50 border border-green-200 rounded-lg">
                <h3 className="text-sm font-semibold text-green-800 mb-3">✓ Analysis Complete - Step 3</h3>

                <div className="space-y-4 text-sm mb-4">
                  {/* Basic Summary */}
                  <div>
                    <p className="font-semibold text-gray-700 mb-2">Design Matrix Summary:</p>
                    <div className="text-gray-600 space-y-1 bg-gray-50 p-3 rounded border border-gray-200">
                      <p>• <span className="font-medium">Total Rows:</span> {step3Result.designSummary?.totalRows || 0}</p>
                      <p>• <span className="font-medium">Attribute Columns Found:</span> {step3Result.designSummary?.attColumnCount || 0}</p>
                      <p>• <span className="font-medium">Versions:</span> {step3Result.designSummary?.versions?.length || 0}</p>
                    </div>
                  </div>

                  {/* Identified Columns */}
                  {step3Result.designSummary?.identifiedColumns && (
                    <div>
                      <p className="font-semibold text-gray-700 mb-2">Identified Columns:</p>
                      <div className="text-gray-600 space-y-1 bg-blue-50 p-3 rounded border border-blue-200">
                        {step3Result.designSummary.identifiedColumns.taskColumn && (
                          <p>• <span className="font-medium">Task Column:</span> {step3Result.designSummary.identifiedColumns.taskColumn}</p>
                        )}
                        {step3Result.designSummary.identifiedColumns.conceptColumn && (
                          <div>
                            <p>• <span className="font-medium">Concept Column:</span> {step3Result.designSummary.identifiedColumns.conceptColumn}</p>
                            {step3Result.designSummary.identifiedColumns.conceptValues && 
                             Array.isArray(step3Result.designSummary.identifiedColumns.conceptValues) &&
                             step3Result.designSummary.identifiedColumns.conceptValues.length > 0 && (
                              <div className="ml-4 mt-1">
                                <p className="text-xs font-medium text-blue-800">Concept Numbers Detected:</p>
                                <div className="flex flex-wrap gap-1 mt-1">
                                  {step3Result.designSummary.identifiedColumns.conceptValues.map((val: string, i: number) => (
                                    <span key={i} className="px-2 py-0.5 bg-blue-200 text-blue-900 rounded text-xs font-mono font-semibold">
                                      {val}
                                    </span>
                                  ))}
                                </div>
                                <p className="text-xs text-blue-700 mt-1">
                                  These concept numbers will be used when matching scenarios to survey data.
                                </p>
                              </div>
                            )}
                          </div>
                        )}
                        {step3Result.designSummary.identifiedColumns.versionColumn && (
                          <p>• <span className="font-medium">Version Column:</span> {step3Result.designSummary.identifiedColumns.versionColumn}</p>
                        )}
                        {!step3Result.designSummary.identifiedColumns.taskColumn && 
                         !step3Result.designSummary.identifiedColumns.conceptColumn && 
                         !step3Result.designSummary.identifiedColumns.versionColumn && (
                          <p className="text-amber-600">⚠ No Task/Concept/Version columns identified</p>
                        )}
                      </div>
                    </div>
                  )}

                  {/* Attribute Columns */}
                  {step3Result.designSummary?.attColumns && step3Result.designSummary.attColumns.length > 0 && (
                    <div>
                      <p className="font-semibold text-gray-700 mb-2">Attribute Columns Found ({step3Result.designSummary.attColumns.length}):</p>
                      <div className="bg-green-50 p-3 rounded border border-green-200">
                        <div className="flex flex-wrap gap-2">
                          {step3Result.designSummary.attColumns.map((col: string, i: number) => (
                            <span key={i} className="text-xs px-2 py-1 bg-green-100 text-green-800 rounded font-mono">
                              {col}
                            </span>
                          ))}
                        </div>
                      </div>
                    </div>
                  )}

                  {/* All Columns */}
                  {step3Result.designSummary?.allColumns && (
                    <div>
                      <p className="font-semibold text-gray-700 mb-2">All Columns in Design Matrix ({step3Result.designSummary.allColumns.length}):</p>
                      <div className="bg-gray-50 p-3 rounded border border-gray-200 max-h-32 overflow-y-auto">
                        <div className="flex flex-wrap gap-2">
                          {step3Result.designSummary.allColumns.map((col: string, i: number) => (
                            <span key={i} className="text-xs px-2 py-1 bg-white text-gray-700 rounded border border-gray-300 font-mono">
                              {col}
                            </span>
                          ))}
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Versions Details */}
                  {step3Result.designSummary?.versions && Array.isArray(step3Result.designSummary.versions) && step3Result.designSummary.versions.length > 0 && (
                    <div>
                      <p className="font-semibold text-gray-700 mb-2">Version Details:</p>
                      <div className="space-y-2">
                        {step3Result.designSummary.versions.map((version: any, i: number) => (
                          <div key={i} className="bg-purple-50 p-3 rounded border border-purple-200">
                            <p className="font-medium text-purple-800">Version: {String(version?.version || 'N/A')}</p>
                            <div className="text-xs text-purple-700 mt-1 space-y-0.5">
                              <p>• Tasks: {String(version?.taskCount || 0)}</p>
                              {version?.taskCount > 0 && (
                                <>
                                  <p>• Concepts per task: {String(version?.minConceptsPerTask || 0)} - {String(version?.maxConceptsPerTask || 0)} (avg: {version?.avgConceptsPerTask ? Number(version.avgConceptsPerTask).toFixed(1) : '0'})</p>
                                </>
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Attribute Coverage */}
                  {step3Result.designSummary?.attributeCoverage && Array.isArray(step3Result.designSummary.attributeCoverage) && step3Result.designSummary.attributeCoverage.length > 0 && (
                    <div>
                      <p className="font-semibold text-gray-700 mb-2">Attribute Coverage:</p>
                      <div className="max-h-48 overflow-y-auto space-y-2">
                        {step3Result.designSummary.attributeCoverage.slice(0, 5).map((attr: any, i: number) => (
                          <div key={i} className="bg-yellow-50 p-2 rounded border border-yellow-200">
                            <p className="text-xs font-medium text-yellow-800">
                              Attribute {String(attr?.attributeNo || 'N/A')}: {String(attr?.attributeText || '')}
                            </p>
                            {attr?.levels && Array.isArray(attr.levels) && attr.levels.length > 0 && (
                              <div className="mt-1 text-xs text-yellow-700">
                                <p>Levels found: {String(attr.levels.length)}</p>
                                <div className="mt-1 space-y-0.5">
                                  {attr.levels.slice(0, 3).map((level: any, j: number) => (
                                    <p key={j} className="pl-2">
                                      • {String(level?.levelText || '')}: {String(level?.count || 0)} occurrences
                                    </p>
                                  ))}
                                  {attr.levels.length > 3 && (
                                    <p className="pl-2 text-yellow-600">... and {String(attr.levels.length - 3)} more levels</p>
                                  )}
                                </div>
                              </div>
                            )}
                          </div>
                        ))}
                        {step3Result.designSummary.attributeCoverage.length > 5 && (
                          <p className="text-xs text-gray-500 italic">
                            ... and {String(step3Result.designSummary.attributeCoverage.length - 5)} more attributes
                          </p>
                        )}
                      </div>
                    </div>
                  )}

                  {/* Sample Rows */}
                  {step3Result.designSummary?.sampleRows && step3Result.designSummary.sampleRows.length > 0 && (
                    <div>
                      <p className="font-semibold text-gray-700 mb-2">Sample Rows (First 3):</p>
                      <div className="overflow-x-auto bg-gray-50 p-3 rounded border border-gray-200">
                        <table className="min-w-full text-xs">
                          <thead>
                            <tr className="border-b border-gray-300">
                              {Object.keys(step3Result.designSummary.sampleRows[0]).slice(0, 10).map((col: string) => (
                                <th key={col} className="px-2 py-1 text-left font-semibold text-gray-700 bg-gray-100">
                                  {col}
                                </th>
                              ))}
                              {Object.keys(step3Result.designSummary.sampleRows[0]).length > 10 && (
                                <th className="px-2 py-1 text-left font-semibold text-gray-500">
                                  ... +{Object.keys(step3Result.designSummary.sampleRows[0]).length - 10} more
                                </th>
                              )}
                            </tr>
                          </thead>
                          <tbody>
                            {step3Result.designSummary.sampleRows.map((row: any, i: number) => (
                              <tr key={i} className="border-b border-gray-200">
                                {Object.keys(row).slice(0, 10).map((col: string) => (
                                  <td key={col} className="px-2 py-1 text-gray-600 font-mono">
                                    {String(row[col] || '').substring(0, 20)}
                                    {String(row[col] || '').length > 20 ? '...' : ''}
                                  </td>
                                ))}
                                {Object.keys(row).length > 10 && (
                                  <td className="px-2 py-1 text-gray-400">...</td>
                                )}
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )}

                  {/* Show summary from previous steps */}
                  {step1Result && (
                    <div className="p-3 bg-blue-50 rounded border border-blue-200">
                      <p className="font-semibold text-blue-800 text-xs mb-2">From Step 1:</p>
                      <p className="text-blue-700 text-xs">Section: {step1Result.conjointSection}</p>
                      <p className="text-blue-700 text-xs">Products: {step1Result.products?.length || 0} found</p>
                    </div>
                  )}

                  {step2Result && (
                    <div className="p-3 bg-blue-50 rounded border border-blue-200">
                      <p className="font-semibold text-blue-800 text-xs mb-2">From Step 2:</p>
                      <p className="text-blue-700 text-xs">Attributes: {step2Result.attributes?.length || 0} found</p>
                      <p className="text-blue-700 text-xs">Total Levels: {step2Result.totalAttributeLevels || 0}</p>
                    </div>
                  )}
                </div>

                {/* Finalize Workflow */}
                <div className="mt-4 p-4 bg-white rounded-lg border border-blue-300">
                  <p className="text-sm font-semibold text-blue-800 mb-3">Ready to Create Workflow</p>
                  
                  <div className="mb-3">
                    <label className="block text-xs font-semibold text-gray-700 mb-1">
                      Workflow Name
                    </label>
                    <input
                      type="text"
                      value={workflowName}
                      onChange={(e) => setWorkflowName(e.target.value)}
                      placeholder="Enter workflow name..."
                      className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                  </div>
                  
                  <div className="flex gap-2">
                    <button
                      onClick={() => {
                        setCurrentStep(2);
                        setError(null);
                      }}
                      className="px-4 py-2 text-sm border border-gray-300 rounded-lg hover:bg-gray-50 transition"
                    >
                      ← Back to Step 2
                    </button>
                    <button
                      onClick={() => {
                        setDesignFile(null);
                        setStep3Result(null);
                        setTempWorkflowId(null);
                      }}
                      className="px-4 py-2 text-sm border border-gray-300 rounded-lg hover:bg-gray-50 transition"
                    >
                      Re-upload File
                    </button>
                    <button
                      onClick={handleFinalize}
                      disabled={finalizing || !workflowName.trim()}
                      className="flex-1 px-4 py-2 bg-blue-600 text-white text-sm font-semibold rounded-lg disabled:opacity-50 disabled:cursor-not-allowed hover:bg-blue-700 transition"
                    >
                      {finalizing ? "Creating Workflow..." : "Create Workflow"}
                    </button>
                  </div>
                  
                  <p className="text-xs text-gray-500 mt-2">
                    This will save your workflow and make it available in the Conjoint Simulator tab.
                  </p>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}