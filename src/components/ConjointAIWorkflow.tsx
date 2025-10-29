import { useState } from "react";
import axios from "axios";
import { API_BASE_URL } from '../config';

const API_BASE = `${API_BASE_URL}/api/conjoint`;

interface ConjointAIWorkflowProps {
  projectId: string;
  onWorkflowCreated?: (workflowId: string) => void;
}

export default function ConjointAIWorkflow({ projectId, onWorkflowCreated }: ConjointAIWorkflowProps) {
  const [questionnaireFile, setQuestionnaireFile] = useState<File | null>(null);
  const [attributeListFile, setAttributeListFile] = useState<File | null>(null);
  const [designFile, setDesignFile] = useState<File | null>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [analysisResult, setAnalysisResult] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);
  const [finalizing, setFinalizing] = useState(false);
  const [workflowName, setWorkflowName] = useState('');

  async function handleAnalyze() {
    if (!questionnaireFile || !attributeListFile || !designFile) {
      alert("Please upload all 3 required files");
      return;
    }

    setAnalyzing(true);
    setError(null);

    try {
      const formData = new FormData();
      formData.append('questionnaire', questionnaireFile);
      formData.append('attributeList', attributeListFile);
      formData.append('designFile', designFile);
      formData.append('projectId', projectId);

      const response = await axios.post(`${API_BASE}/ai-workflow/analyze`, formData, {
        headers: {
          'Content-Type': 'multipart/form-data',
          Authorization: `Bearer ${localStorage.getItem('cognitive_dash_token') || localStorage.getItem('token') || ''}`
        }
      });

      setAnalysisResult(response.data);

      if (response.data.workflowId && onWorkflowCreated) {
        onWorkflowCreated(response.data.workflowId);
      }
    } catch (err: any) {
      console.error('Error analyzing files:', err);
      setError(err?.response?.data?.detail || err.message || 'Failed to analyze files');
    } finally {
      setAnalyzing(false);
    }
  }

  async function handleFinalize() {
    if (!analysisResult?.tempWorkflowId) {
      alert("No workflow to finalize");
      return;
    }

    if (!workflowName.trim()) {
      alert("Please enter a workflow name");
      return;
    }

    setFinalizing(true);
    try {
      const token = localStorage.getItem('cognitive_dash_token');
      const response = await fetch('http://localhost:3005/api/conjoint/ai-workflow/finalize', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({
          tempWorkflowId: analysisResult.tempWorkflowId,
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

      // Refresh the page to show the new workflow
      window.location.reload();

      // Reset form
      setQuestionnaireFile(null);
      setAttributeListFile(null);
      setDesignFile(null);
      setAnalysisResult(null);
      setWorkflowName('');
      setError(null);

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
        <div className="mb-4">
          <h2 className="text-xl font-semibold text-gray-900">AI-Powered Conjoint Workflow</h2>
          <p className="text-sm text-gray-600 mt-2">
            Upload your questionnaire, attribute list, and design file. AI will automatically analyze your conjoint exercise
            and set up the simulator with the correct product names, attributes, and market share structure.
          </p>
        </div>

        <div className="space-y-4">
          {/* Questionnaire Upload */}
          <div className="border border-gray-300 rounded-lg p-4">
            <label className="block text-sm font-semibold text-gray-700 mb-2">
              1. Questionnaire (Word Document)
            </label>
            <p className="text-xs text-gray-500 mb-2">
              Upload your questionnaire Word document. AI will identify the conjoint section and extract product/question details.
            </p>
            <input
              type="file"
              accept=".doc,.docx"
              onChange={e => setQuestionnaireFile(e.target.files?.[0] || null)}
              className="block w-full text-sm text-gray-600 file:mr-4 file:py-2 file:px-4 file:rounded-lg file:border-0 file:text-sm file:font-semibold file:bg-blue-50 file:text-blue-700 hover:file:bg-blue-100"
            />
            {questionnaireFile && (
              <div className="mt-2 text-xs text-green-600 flex items-center gap-1">
                <span>✓</span>
                <span>{questionnaireFile.name}</span>
              </div>
            )}
          </div>

          {/* Attribute List Upload */}
          <div className="border border-gray-300 rounded-lg p-4">
            <label className="block text-sm font-semibold text-gray-700 mb-2">
              2. Attribute List (Excel)
            </label>
            <p className="text-xs text-gray-500 mb-2">
              Upload the Excel file containing your attribute definitions and levels.
            </p>
            <input
              type="file"
              accept=".xlsx,.xls"
              onChange={e => setAttributeListFile(e.target.files?.[0] || null)}
              className="block w-full text-sm text-gray-600 file:mr-4 file:py-2 file:px-4 file:rounded-lg file:border-0 file:text-sm file:font-semibold file:bg-blue-50 file:text-blue-700 hover:file:bg-blue-100"
            />
            {attributeListFile && (
              <div className="mt-2 text-xs text-green-600 flex items-center gap-1">
                <span>✓</span>
                <span>{attributeListFile.name}</span>
              </div>
            )}
          </div>

          {/* Design File Upload */}
          <div className="border border-gray-300 rounded-lg p-4">
            <label className="block text-sm font-semibold text-gray-700 mb-2">
              3. Design File (Excel)
            </label>
            <p className="text-xs text-gray-500 mb-2">
              Upload the Excel file containing your conjoint design matrix.
            </p>
            <input
              type="file"
              accept=".xlsx,.xls"
              onChange={e => setDesignFile(e.target.files?.[0] || null)}
              className="block w-full text-sm text-gray-600 file:mr-4 file:py-2 file:px-4 file:rounded-lg file:border-0 file:text-sm file:font-semibold file:bg-blue-50 file:text-blue-700 hover:file:bg-blue-100"
            />
            {designFile && (
              <div className="mt-2 text-xs text-green-600 flex items-center gap-1">
                <span>✓</span>
                <span>{designFile.name}</span>
              </div>
            )}
          </div>

          {/* Analyze Button */}
          <button
            onClick={handleAnalyze}
            disabled={analyzing || !questionnaireFile || !attributeListFile || !designFile}
            className="w-full px-6 py-3 rounded-xl bg-black text-white font-semibold disabled:opacity-50 disabled:cursor-not-allowed hover:bg-gray-800 transition"
          >
            {analyzing ? "Analyzing with AI..." : "Analyze & Create Workflow"}
          </button>
        </div>

        {/* Error Display */}
        {error && (
          <div className="mt-4 p-4 bg-red-50 border border-red-200 rounded-lg">
            <p className="text-sm text-red-800 font-semibold">Error</p>
            <p className="text-sm text-red-700 mt-1">{error}</p>
          </div>
        )}

        {/* Analysis Result Display */}
        {analysisResult && (
          <div className="mt-6 p-4 bg-green-50 border border-green-200 rounded-lg">
            <h3 className="text-sm font-semibold text-green-800 mb-2">Analysis Complete!</h3>

            {analysisResult.conjointSection && (
              <div className="mb-3">
                <p className="text-xs font-semibold text-gray-700">Conjoint Section Identified:</p>
                <p className="text-xs text-gray-600 mt-1">{analysisResult.conjointSection}</p>
              </div>
            )}

            {analysisResult.products && analysisResult.products.length > 0 && (
              <div className="mb-3">
                <p className="text-xs font-semibold text-gray-700">Products Found:</p>
                <ul className="text-xs text-gray-600 list-disc list-inside mt-1">
                  {analysisResult.products.map((product: any, i: number) => (
                    <li key={i}>{product.name || product}</li>
                  ))}
                </ul>
              </div>
            )}

            {analysisResult.attributes && analysisResult.attributes.length > 0 && (
              <div className="mb-3">
                <p className="text-xs font-semibold text-gray-700">Attributes Found:</p>
                <div className="text-xs text-gray-600 mt-1 space-y-2">
                  {analysisResult.attributes.map((attr: any, i: number) => (
                    <div key={i} className="border-l-2 border-blue-200 pl-2">
                      <div className="font-medium">
                        {attr.attributeText || attr.name} (Attribute {attr.attributeNo || i + 1})
                      </div>
                      {attr.levels && attr.levels.length > 0 && (
                        <div className="ml-2 mt-1 text-gray-500">
                          <div className="text-xs mb-1">{attr.levels.length} levels:</div>
                          <ul className="list-disc list-inside space-y-0.5">
                            {attr.levels.slice(0, 3).map((level: any, j: number) => (
                              <li key={j} className="text-xs">
                                {level.levelText || level.name || level}
                              </li>
                            ))}
                            {attr.levels.length > 3 && (
                              <li className="text-xs text-gray-400">
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
            )}

            {analysisResult.tempWorkflowId && (
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
                
                <button
                  onClick={handleFinalize}
                  disabled={finalizing || !workflowName.trim()}
                  className="w-full px-4 py-2 bg-blue-600 text-white text-sm font-semibold rounded-lg disabled:opacity-50 disabled:cursor-not-allowed hover:bg-blue-700 transition"
                >
                  {finalizing ? "Creating Workflow..." : "Create Workflow"}
                </button>
                
                <p className="text-xs text-gray-500 mt-2">
                  This will save your workflow and make it available in the Conjoint Simulator tab.
                </p>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
