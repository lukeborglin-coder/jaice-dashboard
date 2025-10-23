import React, { useState, useEffect, useRef, useMemo } from 'react';
import {
  DocumentArrowUpIcon,
  PencilIcon,
  EyeIcon,
  CodeBracketIcon,
  PlusIcon,
  TrashIcon,
  ExclamationTriangleIcon,
  SparklesIcon,
  ArrowDownTrayIcon,
  ClipboardDocumentIcon,
  ChevronDownIcon,
  ChevronUpIcon,
  DocumentTextIcon,
  CheckCircleIcon,
  LightBulbIcon,
  ArrowLeftIcon
} from '@heroicons/react/24/outline';
import { API_BASE_URL } from '../config';
import { useAuth } from '../contexts/AuthContext';

const BRAND_ORANGE = '#D14A2D';
const BRAND_GRAY = '#5D5F62';
const BRAND_BG = '#F7F7F8';

type CostEstimate = {
  inputTokens: number;
  outputTokens: number;
  cost: number;
  formattedCost: string;
};

const MODEL_TOKEN_PRICING = {
  modelName: 'GPT-4o',
  inputPerMillion: 2.50,
  outputPerMillion: 10.00
};

interface QuestionnaireParserProps {
  projectId?: string;
  projects?: any[];
  onNavigate?: (route: string) => void;
}

interface Question {
  id: string;
  number: string;
  text: string;
  type: 'single-select' | 'multi-select' | 'scale' | 'open-end' | 'grid' | 'other';
  options: Array<string | { code: string; text: string; tags?: string[] }>;
  tags: string[];
  needsReview: boolean;
  logic?: string;
}

interface Questionnaire {
  id: string;
  name: string;
  questions: Question[];
  createdAt: string;
  projectId: string;
}

export default function QuestionnaireParser({ projectId, projects = [], onNavigate }: QuestionnaireParserProps) {
  const { user } = useAuth();
  const [activeTab, setActiveTab] = useState<'edit' | 'preview' | 'xml'>('edit');
  const [questionnaires, setQuestionnaires] = useState<Questionnaire[]>([]);
  const [selectedQuestionnaire, setSelectedQuestionnaire] = useState<Questionnaire | null>(null);
  const [showUploadModal, setShowUploadModal] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [editingQuestion, setEditingQuestion] = useState<Question | null>(null);
  const [xmlContent, setXmlContent] = useState('');
  const [questionnaireName, setQuestionnaireName] = useState('');
  const [selectedProjectId, setSelectedProjectId] = useState(projectId || '');
  const [costEstimate, setCostEstimate] = useState<CostEstimate | null>(null);
  const [viewMode, setViewMode] = useState<'list' | 'editor'>('list');
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Load questionnaires on component mount
  useEffect(() => {
    loadQuestionnaires();
  }, []);

  // Flat list of questionnaires with project context
  const qnrList = useMemo(() => {
    return questionnaires
      .map(qnr => {
        const project = projects.find(p => p.id === qnr.projectId);
        return {
          qnr,
          project,
          projectName: project?.name || '-',
          methodologyType: project?.methodologyType || '-',
          respondentCount: (project as any)?.respondentCount || (project as any)?.sample || '-',
          totalQuestions: qnr.questions?.length || 0
        };
      });
  }, [questionnaires, projects]);

  // Calculate cost estimate when file is selected
  const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      const estimate = calculateCostEstimate(file);
      setCostEstimate(estimate);
    } else {
      setCostEstimate(null);
    }
  };

  const loadQuestionnaires = async () => {
    try {
      // Load all questionnaires across all projects
      const response = await fetch(`${API_BASE_URL}/api/questionnaire/all`, {
        headers: { 'Authorization': `Bearer ${localStorage.getItem('cognitive_dash_token')}` }
      });
      if (response.ok) {
        const data = await response.json();
        setQuestionnaires(data);
      }
    } catch (error) {
      console.error('Error loading questionnaires:', error);
    }
  };

  // Calculate cost estimate based on file size - realistic for questionnaire parsing
  const calculateCostEstimateFromSize = (bytes: number, filename: string | undefined | null): CostEstimate | null => {
    if (!bytes || Number.isNaN(bytes)) {
      return null;
    }

    // For questionnaire parsing, we use a much more realistic approach
    // Based on your actual usage: 16k input, 11k output for a typical questionnaire
    // We'll use a more conservative estimation that's closer to reality
    
    const extension = (filename || '').toLowerCase();
    const isDocx = extension.endsWith('.docx');
    
    // Much more conservative token estimation for questionnaire parsing
    // DOCX files: ~6 characters per token (accounts for XML overhead and formatting)
    // Other files: ~4 characters per token
    const charsPerToken = isDocx ? 6.0 : 4.0;
    
    // Estimate input tokens with more realistic character-to-token ratio
    let estimatedInputTokens = Math.ceil(bytes / charsPerToken);
    
    // Cap input tokens at reasonable limits for questionnaire parsing
    // Most questionnaires won't exceed 30k tokens (very conservative)
    estimatedInputTokens = Math.min(estimatedInputTokens, 30000);
    
    // For questionnaire parsing, output is typically 60-70% of input
    // Based on your example: 16k input -> 11k output (about 0.69 ratio)
    const estimatedOutputTokens = Math.ceil(estimatedInputTokens * 0.69);

    const inputCostPerToken = MODEL_TOKEN_PRICING.inputPerMillion / 1_000_000;
    const outputCostPerToken = MODEL_TOKEN_PRICING.outputPerMillion / 1_000_000;

    const inputCost = estimatedInputTokens * inputCostPerToken;
    const outputCost = estimatedOutputTokens * outputCostPerToken;
    const totalCost = inputCost + outputCost;

    // Debug logging
    console.log('Cost calculation debug:', {
      fileSize: bytes,
      filename,
      estimatedInputTokens,
      estimatedOutputTokens,
      inputCost,
      outputCost,
      totalCost
    });

    return {
      inputTokens: estimatedInputTokens,
      outputTokens: estimatedOutputTokens,
      cost: totalCost,
      formattedCost: totalCost < 0.01 ? '< $0.01' : `$${totalCost.toFixed(2)}`
    };
  };

  // Calculate cost estimate based on file
  const calculateCostEstimate = (file: File) => {
    if (!file) return null;
    return calculateCostEstimateFromSize(file.size, file.name);
  };


  const generateXml = async (questionnaire: Questionnaire) => {
    try {
      const response = await fetch(`${API_BASE_URL}/api/questionnaire/xml`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${localStorage.getItem('cognitive_dash_token')}`
        },
        body: JSON.stringify(questionnaire)
      });

      if (response.ok) {
        const xml = await response.text();
        setXmlContent(xml);
      }
    } catch (error) {
      console.error('Error generating XML:', error);
    }
  };

  const copyXmlToClipboard = () => {
    navigator.clipboard.writeText(xmlContent);
    alert('XML copied to clipboard!');
  };

  const downloadXml = () => {
    const blob = new Blob([xmlContent], { type: 'text/xml' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${selectedQuestionnaire?.name || 'questionnaire'}.xml`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const updateQuestion = async (questionId: string, updates: Partial<Question>) => {
    if (!selectedQuestionnaire) return;
    
    const updatedQuestions = selectedQuestionnaire.questions.map(q => 
      q.id === questionId ? { ...q, ...updates } : q
    );
    
    const updatedQuestionnaire = {
      ...selectedQuestionnaire,
      questions: updatedQuestions
    };
    
    setSelectedQuestionnaire(updatedQuestionnaire);
    
    // Save to backend
    try {
      await fetch(`${API_BASE_URL}/api/questionnaire/${selectedQuestionnaire.id}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${localStorage.getItem('cognitive_dash_token')}`
        },
        body: JSON.stringify(updatedQuestionnaire)
      });
    } catch (error) {
      console.error('Error saving questionnaire:', error);
    }
  };

  const addQuestion = () => {
    if (!selectedQuestionnaire) return;
    
    const newQuestion: Question = {
      id: `q-${Date.now()}`,
      number: `Q${selectedQuestionnaire.questions.length + 1}`,
      text: 'New question text...',
      type: 'single-select',
      options: [
        { code: '1', text: 'Option 1', tags: [] },
        { code: '2', text: 'Option 2', tags: [] }
      ],
      tags: [],
      needsReview: false
    };
    
    setSelectedQuestionnaire({
      ...selectedQuestionnaire,
      questions: [...selectedQuestionnaire.questions, newQuestion]
    });
  };

  const improveQuestionWording = async (questionId: string) => {
    const question = selectedQuestionnaire?.questions.find(q => q.id === questionId);
    if (!question) return;

    try {
      const response = await fetch(`${API_BASE_URL}/api/questionnaire/improve-wording`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${localStorage.getItem('cognitive_dash_token')}`
        },
        body: JSON.stringify({ 
          text: question.text,
          projectId: selectedQuestionnaire?.projectId 
        })
      });

      if (response.ok) {
        const result = await response.json();
        updateQuestion(questionId, { text: result.improvedText });
      }
    } catch (error) {
      console.error('Error improving wording:', error);
    }
  };

  const suggestResponseOptions = async (questionId: string) => {
    const question = selectedQuestionnaire?.questions.find(q => q.id === questionId);
    if (!question) return;

    try {
      const response = await fetch(`${API_BASE_URL}/api/questionnaire/suggest-options`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${localStorage.getItem('cognitive_dash_token')}`
        },
        body: JSON.stringify({ 
          text: question.text,
          type: question.type,
          projectId: selectedQuestionnaire?.projectId 
        })
      });

      if (response.ok) {
        const result = await response.json();
        updateQuestion(questionId, { options: result.suggestedOptions });
      }
    } catch (error) {
      console.error('Error suggesting options:', error);
    }
  };

  const handleDeleteQuestionnaire = async (questionnaireId: string) => {
    if (!confirm('Are you sure you want to delete this questionnaire? This action cannot be undone.')) {
      return;
    }

    try {
      const response = await fetch(`${API_BASE_URL}/api/questionnaire/${questionnaireId}`, {
        method: 'DELETE',
        headers: {
          'Authorization': `Bearer ${localStorage.getItem('cognitive_dash_token')}`
        }
      });

      if (response.ok) {
        // Remove from local state
        setQuestionnaires(prev => prev.filter(q => q.id !== questionnaireId));
        
        // If this was the selected questionnaire, clear it
        if (selectedQuestionnaire?.id === questionnaireId) {
          setSelectedQuestionnaire(null);
        }
        
        alert('Questionnaire deleted successfully!');
      } else {
        const error = await response.json();
        alert(`Failed to delete questionnaire: ${error.error}`);
      }
    } catch (error) {
      console.error('Error deleting questionnaire:', error);
      alert('Failed to delete questionnaire - please try again');
    }
  };

  const deleteQuestion = (questionId: string) => {
    if (!selectedQuestionnaire) return;
    
    setSelectedQuestionnaire({
      ...selectedQuestionnaire,
      questions: selectedQuestionnaire.questions.filter(q => q.id !== questionId)
    });
  };

  const addOption = (questionId: string) => {
    const current = selectedQuestionnaire?.questions.find(q => q.id === questionId)?.options || [];
    const nextCode = (() => {
      // Find numeric max code and increment; fallback to sequential length+1
      const codes = current.map((o: any) => (typeof o === 'string' ? parseInt(o, 10) : parseInt((o?.code ?? ''), 10))).filter(n => !isNaN(n));
      const max = codes.length ? Math.max(...codes) : current.length;
      return String(max + 1);
    })();
    updateQuestion(questionId, {
      options: [...current, { code: nextCode, text: 'New option', tags: [] }]
    });
  };

  const removeOption = (questionId: string, optionIndex: number) => {
    const question = selectedQuestionnaire?.questions.find(q => q.id === questionId);
    if (!question) return;
    
    const newOptions = question.options.filter((_, index) => index !== optionIndex);
    updateQuestion(questionId, { options: newOptions });
  };

  const updateOption = (questionId: string, optionIndex: number, newValue: string, field: 'text' | 'code' | 'tags' = 'text') => {
    const question = selectedQuestionnaire?.questions.find(q => q.id === questionId);
    if (!question) return;
    const newOptions: any[] = question.options.map((opt, idx) => {
      if (idx !== optionIndex) return opt as any;
      const normalized = typeof opt === 'string' ? { code: String(idx + 1), text: opt, tags: [] } : { tags: [], ...opt };
      if (field === 'tags') {
        normalized[field] = JSON.parse(newValue);
      } else {
        normalized[field] = newValue;
      }
      return normalized;
    });
    updateQuestion(questionId, { options: newOptions });
  };

  const openQuestionnaire = (questionnaire: Questionnaire) => {
    setSelectedQuestionnaire(questionnaire);
    setViewMode('editor');
  };

  const backToList = () => {
    setViewMode('list');
    setSelectedQuestionnaire(null);
  };

  return (
    <main className="flex-1 overflow-y-auto" style={{ backgroundColor: BRAND_BG, height: 'calc(100vh - 80px)', marginTop: '80px' }}>
      <div className="flex-1 p-6 space-y-6 max-w-full">
        <section className="flex items-center justify-between">
          <div>
            <h2 className="text-2xl font-bold" style={{ color: BRAND_GRAY }}>Questionnaire Parser</h2>
            <p className="mt-1 text-sm text-gray-500">Upload, edit, and export survey questionnaires</p>
          </div>
          <div className="flex items-center gap-2">
            {viewMode === 'list' && (
              <button
                onClick={() => setShowUploadModal(true)}
                className="inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium text-white shadow-sm transition hover:opacity-90"
                style={{ backgroundColor: BRAND_ORANGE }}
              >
                <DocumentArrowUpIcon className="w-5 h-5" />
                Upload Questionnaire
              </button>
            )}
          </div>
        </section>

        {/* QNR List View */}
      {viewMode === 'list' && (
          <div className="bg-white shadow-sm border border-gray-200 rounded-lg overflow-hidden">
            {qnrList.length === 0 ? (
              <div className="p-12 text-center">
                <DocumentTextIcon className="mx-auto mb-4 h-16 w-16 text-gray-300" />
                <h3 className="text-lg font-semibold text-gray-900">No questionnaires found</h3>
                <p className="mt-2 text-gray-500">
                  Upload a questionnaire to get started.
                </p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="min-w-full divide-y divide-gray-200">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">QNR</th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Project</th>
                      <th className="px-6 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider">
                        Methodology
                      </th>
                      <th className="px-6 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider">
                        Questions
                      </th>
                      <th className="px-6 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider">Created</th>
                    </tr>
                  </thead>
                  <tbody className="bg-white divide-y divide-gray-200">
                    {qnrList.map((row: any) => (
                      <tr
                        key={row.qnr.id}
                        className="hover:bg-gray-50 cursor-pointer transition-colors"
                        onClick={() => openQuestionnaire(row.qnr)}
                      >
                        <td className="px-6 py-4">
                          <div className="text-sm font-medium text-gray-900">{row.qnr.name}</div>
                        </td>
                        <td className="px-6 py-4 text-sm text-gray-700">{row.projectName}</td>
                        <td className="px-6 py-4 text-center text-sm text-gray-700">{row.methodologyType}</td>
                        <td className="px-6 py-4 text-center text-sm text-gray-700">{row.totalQuestions}</td>
                        <td className="px-6 py-4 text-center text-sm text-gray-700">{new Date(row.qnr.createdAt).toLocaleDateString()}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
      )}

      {/* Questionnaire Editor View */}
      {viewMode === 'editor' && selectedQuestionnaire && (
        <div className="flex-1">
          {/* Top bar with back + title (styled like other pages, no white box) */}
          <div className="px-6 py-3 flex items-center justify-between">
            <button
              onClick={backToList}
              className="inline-flex items-center gap-2 text-sm font-medium text-gray-600 hover:text-gray-900 transition"
            >
              <ArrowLeftIcon className="w-4 h-4" />
              Back to List
            </button>
            <div className="text-sm text-gray-500">
              {selectedQuestionnaire.questions.length} questions • Created {new Date(selectedQuestionnaire.createdAt).toLocaleDateString()}
            </div>
          </div>

          {/* Tab Navigation - styled like Storytelling tabs */}
          <div className="border-b border-gray-200">
            <nav className="-mb-px flex space-x-8">
              {[
                { id: 'edit', label: 'Questionnaire View', icon: PencilIcon },
                { id: 'preview', label: 'Survey View', icon: EyeIcon },
                { id: 'xml', label: 'XML View', icon: CodeBracketIcon }
              ].map((tab) => (
                <button
                  key={tab.id}
                  onClick={() => {
                    setActiveTab(tab.id as any);
                    if (tab.id === 'xml') {
                      generateXml(selectedQuestionnaire);
                    }
                  }}
                  className={`py-2 px-1 border-b-2 font-medium text-sm flex items-center gap-2 ${
                    activeTab === tab.id
                      ? 'text-white'
                      : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                  }`}
                  style={activeTab === tab.id ? { borderBottomColor: '#D14A2D', color: '#D14A2D' } : {}}
                >
                  <tab.icon className="h-4 w-4" />
                  {tab.label}
                </button>
              ))}
            </nav>
          </div>

          {/* Main Content with sidebar and editor */}
          <div className="flex relative">
            {/* Question sidebar (left) - only show for edit tab */}
            {activeTab === 'edit' && (
              <aside className="w-60 border-r border-gray-200 bg-gray-50 h-screen overflow-y-auto absolute top-0 left-0 hidden md:block" style={{ zIndex: 5 }}>
                <div className="px-3 py-2 text-xs font-semibold text-gray-600">Survey Elements</div>
                <ol className="px-2 pb-4 space-y-1">
                  {selectedQuestionnaire.questions.map((q, idx) => (
                    <li key={q.id}>
                      <a
                        href={`#q-${q.id}`}
                        className="block text-sm text-gray-700 hover:text-gray-900 truncate rounded border border-dashed border-gray-300 bg-white px-2 py-1"
                        title={`${q.number} ${q.text}`}
                      >
                        <span className="mr-2 inline-block w-8 text-gray-500">{q.number || `Q${idx + 1}`}</span>
                        <span className="align-middle">{q.text}</span>
                      </a>
                    </li>
                  ))}
                </ol>
              </aside>
            )}

            {/* Tab Content */}
            <div className="flex-1 p-4 md:p-6 md:ml-60">
              {activeTab === 'edit' && (
                <EditView
                  questionnaire={selectedQuestionnaire}
                  onUpdateQuestion={updateQuestion}
                  onAddQuestion={addQuestion}
                  onDeleteQuestion={deleteQuestion}
                  onAddOption={addOption}
                  onRemoveOption={removeOption}
                  onUpdateOption={updateOption}
                  onEditingQuestion={setEditingQuestion}
                  onImproveWording={improveQuestionWording}
                  onSuggestOptions={suggestResponseOptions}
                />
              )}

              {activeTab === 'preview' && (
                <PreviewView questionnaire={selectedQuestionnaire} />
              )}

              {activeTab === 'xml' && (
                <XmlView
                  xmlContent={xmlContent}
                  onCopy={copyXmlToClipboard}
                  onDownload={downloadXml}
                />
              )}
            </div>
          </div>
        </div>
      )}

      {/* Upload Modal */}
      {showUploadModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-6 w-96">
            {uploading ? (
              <div className="text-center py-8">
                <div className="w-16 h-16 mx-auto mb-4">
                  <svg className="animate-spin w-16 h-16" fill="none" viewBox="0 0 24 24" style={{ color: BRAND_ORANGE }}>
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                  </svg>
                </div>
                <h3 className="text-lg font-semibold text-gray-900 mb-2">Parsing Questionnaire</h3>
                <div className="flex items-center justify-center space-x-2 text-sm text-gray-500">
                  <div className="w-2 h-2 rounded-full animate-bounce" style={{ backgroundColor: BRAND_ORANGE }}></div>
                  <div className="w-2 h-2 rounded-full animate-bounce" style={{ backgroundColor: BRAND_ORANGE, animationDelay: '0.1s' }}></div>
                  <div className="w-2 h-2 rounded-full animate-bounce" style={{ backgroundColor: BRAND_ORANGE, animationDelay: '0.2s' }}></div>
                </div>
                <p className="text-sm text-gray-600 mt-2">Using AI to analyze and structure your questionnaire...</p>
              </div>
            ) : (
              <>
                <h3 className="text-lg font-semibold mb-4">Upload Questionnaire</h3>
                <div className="space-y-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Select Project
                    </label>
                    <select
                      value={selectedProjectId}
                      onChange={(e) => setSelectedProjectId(e.target.value)}
                      className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-orange-500"
                      disabled={uploading}
                    >
                      <option value="">Choose a project...</option>
                      {projects.filter(project => project.methodologyType === 'Quantitative').map((project) => (
                        <option key={project.id} value={project.id}>
                          {project.name}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Questionnaire Name
                    </label>
                    <input
                      type="text"
                      value={questionnaireName}
                      onChange={(e) => setQuestionnaireName(e.target.value)}
                      className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-orange-500"
                      placeholder="e.g., US ATU W3 QNR"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Upload .docx File
                    </label>
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept=".docx"
                      onChange={handleFileChange}
                      className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-orange-500"
                      disabled={uploading}
                    />
                    {costEstimate && (
                      <div className="mt-2 text-xs text-red-600 italic">
                        Estimated Cost ({MODEL_TOKEN_PRICING.modelName}): {costEstimate.formattedCost}
                      </div>
                    )}
                  </div>
                </div>
                <div className="flex justify-end gap-3 mt-6">
                  <button
                    onClick={() => {
                      setShowUploadModal(false);
                      setCostEstimate(null);
                      setQuestionnaireName('');
                      setSelectedProjectId(projectId || '');
                      if (fileInputRef.current) {
                        fileInputRef.current.value = '';
                      }
                    }}
                    className="px-4 py-2 text-gray-600 hover:text-gray-800"
                    disabled={uploading}
                  >
                    Cancel
                  </button>
                  <button
                    onClick={async () => {
                      const file = fileInputRef.current?.files?.[0];
                      if (!file) {
                        alert('Please select a file first');
                        return;
                      }
                      if (!questionnaireName.trim()) {
                        alert('Please enter a questionnaire name');
                        return;
                      }
                      if (!selectedProjectId) {
                        alert('Please select a project');
                        return;
                      }
                      
                      setUploading(true);
                      try {
                        const formData = new FormData();
                        formData.append('file', file);
                        formData.append('projectId', selectedProjectId);
                        formData.append('name', questionnaireName);

                        console.log('Uploading questionnaire:', questionnaireName, 'File:', file.name, 'Project:', selectedProjectId);
                        
                        const response = await fetch(`${API_BASE_URL}/api/questionnaire/upload`, {
                          method: 'POST',
                          body: formData,
                          headers: { 'Authorization': `Bearer ${localStorage.getItem('cognitive_dash_token')}` }
                        });

                        if (response.ok) {
                          const result = await response.json();
                          // Reload all questionnaires to get the latest data
                          await loadQuestionnaires();
                          setSelectedQuestionnaire(result);
                          setShowUploadModal(false);
                          setQuestionnaireName('');
                          setSelectedProjectId(projectId || '');
                          setCostEstimate(null);
                          alert('Questionnaire uploaded and parsed successfully!');
                        } else {
                          const error = await response.json();
                          alert(`Upload failed: ${error.error}`);
                        }
                      } catch (error) {
                        console.error('Upload error:', error);
                        alert('Upload failed - please try again');
                      }
                      setUploading(false);
                      if (fileInputRef.current) {
                        fileInputRef.current.value = '';
                      }
                    }}
                    className="px-4 py-2 text-white rounded-md hover:opacity-90"
                    style={{ backgroundColor: BRAND_ORANGE }}
                    disabled={uploading}
                  >
                    Upload
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
      </div>
    </main>
  );
}

// Edit View Component
function EditView({
  questionnaire,
  onUpdateQuestion,
  onAddQuestion,
  onDeleteQuestion,
  onAddOption,
  onRemoveOption,
  onUpdateOption,
  onEditingQuestion,
  onImproveWording,
  onSuggestOptions
}: {
  questionnaire: Questionnaire;
  onUpdateQuestion: (id: string, updates: Partial<Question>) => void;
  onAddQuestion: () => void;
  onDeleteQuestion: (id: string) => void;
  onAddOption: (id: string) => void;
  onRemoveOption: (id: string, index: number) => void;
  onUpdateOption: (id: string, index: number, value: string, field?: 'text' | 'code') => void;
  onEditingQuestion: (question: Question | null) => void;
  onImproveWording: (id: string) => void;
  onSuggestOptions: (id: string) => void;
}) {
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-semibold text-gray-900">{questionnaire.name}</h2>
        <button
          onClick={onAddQuestion}
          className="flex items-center gap-2 px-4 py-2 text-white rounded-lg hover:opacity-90"
          style={{ backgroundColor: BRAND_ORANGE }}
        >
          <PlusIcon className="w-4 h-4" />
          Add Question
        </button>
      </div>

      <div className="space-y-2">
        {questionnaire.questions.map((question, index) => (
          <QuestionCard
            key={question.id}
            question={question}
            index={index}
            onUpdate={onUpdateQuestion}
            onDelete={onDeleteQuestion}
            onAddOption={onAddOption}
            onRemoveOption={onRemoveOption}
            onUpdateOption={onUpdateOption}
            onEdit={onEditingQuestion}
            onImproveWording={onImproveWording}
            onSuggestOptions={onSuggestOptions}
          />
        ))}
      </div>
    </div>
  );
}

// Question Card Component
function QuestionCard({
  question,
  index,
  onUpdate,
  onDelete,
  onAddOption,
  onRemoveOption,
  onUpdateOption,
  onEdit,
  onImproveWording,
  onSuggestOptions
}: {
  question: Question;
  index: number;
  onUpdate: (id: string, updates: Partial<Question>) => void;
  onDelete: (id: string) => void;
  onAddOption: (id: string) => void;
  onRemoveOption: (id: string, index: number) => void;
  onUpdateOption: (id: string, index: number, value: string, field?: 'text' | 'code') => void;
  onEdit: (question: Question | null) => void;
  onImproveWording: (id: string) => void;
  onSuggestOptions: (id: string) => void;
}) {
  const [isExpanded, setIsExpanded] = useState(false);

  return (
    <div id={`q-${question.id}`} className={`bg-white border rounded-lg p-3 ${
      question.needsReview ? 'border-red-300 bg-red-50' : 'border-gray-200'
    }`}>
      {/* Header with absolute action buttons that don't affect layout below */}
      <div className="relative mb-2">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium text-gray-900">{question.number}</span>
          {question.needsReview && (
            <div className="flex items-center gap-1 text-red-600 text-xs">
              <ExclamationTriangleIcon className="w-3 h-3" />
              <span>Needs Review</span>
            </div>
          )}
          <select
            value={question.type}
            onChange={(e) => onUpdate(question.id, { type: e.target.value as any })}
            className="text-xs border border-gray-300 rounded px-2 py-1"
          >
            <option value="single-select">Single Select</option>
            <option value="multi-select">Multi Select</option>
            <option value="scale">Scale</option>
            <option value="open-end">Open End</option>
            <option value="grid">Grid</option>
            <option value="other">Other</option>
          </select>
        </div>
        <div className="absolute inset-y-0 right-0 flex items-center gap-1 z-10">
          <div className="flex items-center gap-1">
            <button
              onClick={() => onImproveWording(question.id)}
              className="p-1.5 text-blue-600 hover:text-blue-700"
              title="Improve Wording"
            >
              <SparklesIcon className="w-3 h-3" />
            </button>
            <button
              onClick={() => onSuggestOptions(question.id)}
              className="p-1.5 text-green-600 hover:text-green-700"
              title="Suggest Options"
            >
              <LightBulbIcon className="w-3 h-3" />
            </button>
          </div>
          <button
            onClick={() => onDelete(question.id)}
            className="p-1.5 text-red-600 hover:text-red-700"
            title="Delete Question"
          >
            <TrashIcon className="w-3 h-3" />
          </button>
        </div>
      </div>
        
        {/* Question text - full width to the right edge */}
        <textarea
          value={question.text}
          onChange={(e) => onUpdate(question.id, { text: e.target.value })}
          className="w-full p-2 text-sm border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-orange-500 resize-none"
          rows={2}
          placeholder="Question text..."
        />

        {/* Response options - full width */}
        {question.type !== 'open-end' && question.options.length > 0 && (
          <div className="mt-2">
            <div className="flex items-center gap-2 mb-1">
              <span className="text-xs font-medium text-gray-700">Response Options</span>
              {/* Show only RANDOMIZE tags next to Response Options title */}
              {question.tags
                .filter(tag => ['RANDOMIZE', 'RANDOM'].includes(tag.toUpperCase()))
                .map((tag, tagIndex) => (
                  <span
                    key={tagIndex}
                    className="px-1.5 py-0.5 bg-blue-100 text-blue-700 text-xs rounded font-medium"
                  >
                    {tag}
                  </span>
                ))}
            </div>
            {/* Column headers */}
            <div className="flex items-center gap-2 mb-1">
              <div className="w-20">
                <span className="text-xs font-medium text-gray-500">Code</span>
              </div>
              <div className="flex-1">
                <span className="text-xs font-medium text-gray-500">Response Options</span>
              </div>
              <div className="w-8"></div>
            </div>
            <div className="space-y-1">
              {question.options.map((option, optionIndex) => {
                const opt = typeof option === 'string' ? { code: String(optionIndex + 1), text: option, tags: [] } : { tags: [], ...option };
                return (
                  <div key={optionIndex} className="flex items-center gap-2">
                    <input
                      type="text"
                      value={opt.code}
                      onChange={(e) => onUpdateOption(question.id, optionIndex, e.target.value, 'code')}
                      className="w-20 px-2 py-1 text-sm border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-orange-500"
                      placeholder="Code"
                    />
                    <div className="flex-1 flex items-center gap-2">
                      <input
                        type="text"
                        value={opt.text}
                        onChange={(e) => onUpdateOption(question.id, optionIndex, e.target.value, 'text')}
                        className="flex-1 px-2 py-1 text-sm border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-orange-500"
                        placeholder="Option text"
                      />
                      {/* Option-specific tag management */}
                      <div className="flex items-center gap-1">
                        {/* Add tag buttons */}
                        {!opt.tags?.includes('ANCHOR') && (
                          <button
                            onClick={() => {
                              const newTags = [...(opt.tags || []), 'ANCHOR'];
                              onUpdateOption(question.id, optionIndex, JSON.stringify(newTags), 'tags');
                            }}
                            className="px-1.5 py-0.5 text-xs bg-green-100 text-green-700 rounded hover:bg-green-200"
                            title="Add ANCHOR tag"
                          >
                            +A
                          </button>
                        )}
                        {!opt.tags?.includes('SPECIFY') && (
                          <button
                            onClick={() => {
                              const newTags = [...(opt.tags || []), 'SPECIFY'];
                              onUpdateOption(question.id, optionIndex, JSON.stringify(newTags), 'tags');
                            }}
                            className="px-1.5 py-0.5 text-xs bg-purple-100 text-purple-700 rounded hover:bg-purple-200"
                            title="Add SPECIFY tag"
                          >
                            +S
                          </button>
                        )}
                        {!opt.tags?.includes('EXCLUSIVE') && (
                          <button
                            onClick={() => {
                              const newTags = [...(opt.tags || []), 'EXCLUSIVE'];
                              onUpdateOption(question.id, optionIndex, JSON.stringify(newTags), 'tags');
                            }}
                            className="px-1.5 py-0.5 text-xs bg-orange-100 text-orange-700 rounded hover:bg-orange-200"
                            title="Add EXCLUSIVE tag"
                          >
                            +E
                          </button>
                        )}
                        {/* Show existing tags */}
                        {opt.tags?.map((tag, tagIndex) => (
                          <span
                            key={tagIndex}
                            className="px-1.5 py-0.5 text-xs rounded font-medium flex items-center gap-1"
                            style={{
                              backgroundColor: tag === 'ANCHOR' ? '#dcfce7' :
                                             tag === 'SPECIFY' ? '#f3e8ff' :
                                             tag === 'EXCLUSIVE' ? '#fed7aa' : '#f3f4f6',
                              color: tag === 'ANCHOR' ? '#166534' :
                                     tag === 'SPECIFY' ? '#7c3aed' :
                                     tag === 'EXCLUSIVE' ? '#ea580c' : '#374151'
                            }}
                          >
                            {tag}
                            <button
                              onClick={() => {
                                const newTags = (opt.tags || []).filter((_, idx) => idx !== (opt.tags || []).indexOf(tag));
                                onUpdateOption(question.id, optionIndex, JSON.stringify(newTags), 'tags');
                              }}
                              className="ml-1 hover:text-red-600"
                            >
                              ×
                            </button>
                          </span>
                        ))}
                      </div>
                    </div>
                    <button
                      onClick={() => onRemoveOption(question.id, optionIndex)}
                      className="text-red-600 hover:text-red-700"
                    >
                      <TrashIcon className="w-3 h-3" />
                    </button>
                  </div>
                );
              })}
            </div>
            <button
              onClick={() => onAddOption(question.id)}
              className="mt-2 text-xs text-orange-600 hover:text-orange-700"
            >
              + Add Option
            </button>
          </div>
        )}

        {/* Programming Tags Management */}
        <div className="mt-2">
          <div className="flex items-center gap-2 mb-1">
            <span className="text-xs font-medium text-gray-700">Programming Tags:</span>
            <div className="flex gap-1">
              {!question.tags.some(tag => ['RANDOMIZE', 'RANDOM'].includes(tag.toUpperCase())) && (
                <button
                  onClick={() => {
                    const newTags = [...question.tags, 'RANDOMIZE'];
                    onUpdate(question.id, { tags: newTags });
                  }}
                  className="px-2 py-1 text-xs bg-blue-100 text-blue-700 rounded hover:bg-blue-200"
                >
                  + RANDOMIZE
                </button>
              )}
            </div>
          </div>
          
          {/* Show existing programming tags */}
          {question.tags.filter(tag => ['RANDOMIZE', 'ANCHOR', 'SPECIFY', 'RANDOM', 'ANCHORED', 'EXCLUSIVE'].includes(tag.toUpperCase())).length > 0 && (
            <div className="flex flex-wrap gap-1">
              {question.tags
                .filter(tag => ['RANDOMIZE', 'ANCHOR', 'SPECIFY', 'RANDOM', 'ANCHORED', 'EXCLUSIVE'].includes(tag.toUpperCase()))
                .map((tag, tagIndex) => (
                  <span
                    key={tagIndex}
                    className="px-1.5 py-0.5 text-xs rounded font-medium flex items-center gap-1"
                    style={{
                      backgroundColor: tag.toUpperCase().includes('RANDOM') ? '#dbeafe' : 
                                     tag.toUpperCase().includes('ANCHOR') ? '#dcfce7' :
                                     tag.toUpperCase().includes('SPECIFY') ? '#f3e8ff' :
                                     tag.toUpperCase().includes('EXCLUSIVE') ? '#fed7aa' : '#f3f4f6',
                      color: tag.toUpperCase().includes('RANDOM') ? '#1e40af' : 
                             tag.toUpperCase().includes('ANCHOR') ? '#166534' :
                             tag.toUpperCase().includes('SPECIFY') ? '#7c3aed' :
                             tag.toUpperCase().includes('EXCLUSIVE') ? '#ea580c' : '#374151'
                    }}
                  >
                    {tag}
                    <button
                      onClick={() => {
                        const newTags = question.tags.filter((_, idx) => idx !== question.tags.indexOf(tag));
                        onUpdate(question.id, { tags: newTags });
                      }}
                      className="ml-1 hover:text-red-600"
                    >
                      ×
                    </button>
                  </span>
                ))}
            </div>
          )}
        </div>

        {/* Other Tags - full width (excluding programming tags) */}
        {question.tags.filter(tag => !['RANDOMIZE', 'ANCHOR', 'SPECIFY', 'RANDOM', 'ANCHORED', 'EXCLUSIVE'].includes(tag.toUpperCase())).length > 0 && (
          <div className="mt-2">
            <span className="text-xs font-medium text-gray-700">Other Tags: </span>
            <div className="flex flex-wrap gap-1 mt-1">
              {question.tags
                .filter(tag => !['RANDOMIZE', 'ANCHOR', 'SPECIFY', 'RANDOM', 'ANCHORED', 'EXCLUSIVE'].includes(tag.toUpperCase()))
                .map((tag, tagIndex) => (
                  <span
                    key={tagIndex}
                    className="px-1.5 py-0.5 bg-gray-100 text-gray-700 text-xs rounded"
                  >
                    {tag}
                  </span>
                ))}
            </div>
          </div>
        )}
    </div>
  );
}

// Preview View Component
function PreviewView({ questionnaire }: { questionnaire: Questionnaire }) {
  return (
    <div className="max-w-2xl mx-auto">
      <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
        <h2 className="text-xl font-semibold text-gray-900 mb-6">{questionnaire.name} - Preview</h2>
        
        <div className="space-y-6">
          {questionnaire.questions.map((question, index) => {
            const typeKey = String(question.type || '')
              .toLowerCase()
              .replace(/\s+/g, '-')
              .replace(/_+/g, '-');
            return (
            <div key={question.id} className="border-b border-gray-100 pb-6 last:border-b-0">
              <div className="mb-3">
                <span className="text-sm font-medium text-gray-600">{question.number}</span>
                <p className="text-gray-900 mt-1">{question.text}</p>
              </div>
              
              {typeKey === 'single-select' && question.options.length > 0 && (
                <div className="space-y-2">
                  {question.options.map((option, optionIndex) => {
                    const opt = typeof option === 'string' ? { code: String(optionIndex + 1), text: option } : option;
                    return (
                      <label key={optionIndex} className="flex items-center gap-3">
                        <input type="radio" name={`q${index}`} className="text-orange-600" disabled />
                        <span className="text-gray-700">{opt.text}</span>
                      </label>
                    );
                  })}
                </div>
              )}
              
              {typeKey === 'multi-select' && question.options.length > 0 && (
                <div className="space-y-2">
                  {question.options.map((option, optionIndex) => {
                    const opt = typeof option === 'string' ? { code: String(optionIndex + 1), text: option } : option;
                    return (
                      <label key={optionIndex} className="flex items-center gap-3">
                        <input type="checkbox" disabled className="text-orange-600" />
                        <span className="text-gray-700">{opt.text}</span>
                      </label>
                    );
                  })}
                </div>
              )}
              
              {typeKey === 'scale' && (
                <div className="flex items-center gap-4">
                  <span className="text-sm text-gray-600">1</span>
                  <div className="flex gap-2">
                    {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((value) => (
                      <label key={value} className="flex items-center gap-1">
                        <input type="radio" name={`scale${index}`} className="text-orange-600" disabled />
                        <span className="text-sm text-gray-600">{value}</span>
                      </label>
                    ))}
                  </div>
                  <span className="text-sm text-gray-600">10</span>
                </div>
              )}
              
              {typeKey === 'open-end' && (
                <textarea
                  className="w-full p-3 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-orange-500"
                  rows={3}
                  placeholder="Your answer here..."
                  disabled
                />
              )}
            </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// XML View Component
function XmlView({
  xmlContent,
  onCopy,
  onDownload
}: {
  xmlContent: string;
  onCopy: () => void;
  onDownload: () => void;
}) {
  const [showFullXml, setShowFullXml] = useState(false);
  
  const displayContent = showFullXml ? xmlContent : xmlContent.split('\n').slice(0, 20).join('\n');
  const hasMoreLines = xmlContent.split('\n').length > 20;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-semibold text-gray-900">XML Export</h2>
        <div className="flex gap-2">
          <button
            onClick={onCopy}
            className="flex items-center gap-2 px-4 py-2 text-gray-700 border border-gray-300 rounded-lg hover:bg-gray-50"
          >
            <ClipboardDocumentIcon className="w-4 h-4" />
            Copy All
          </button>
          <button
            onClick={onDownload}
            className="flex items-center gap-2 px-4 py-2 text-white rounded-lg hover:opacity-90"
            style={{ backgroundColor: BRAND_ORANGE }}
          >
            <ArrowDownTrayIcon className="w-4 h-4" />
            Download XML
          </button>
        </div>
      </div>

      <div className="bg-gray-900 rounded-lg p-4 text-green-400 font-mono text-sm overflow-x-auto">
        <pre className="whitespace-pre-wrap">{displayContent}</pre>
        {hasMoreLines && !showFullXml && (
          <div className="mt-4 pt-4 border-t border-gray-700">
            <button
              onClick={() => setShowFullXml(true)}
              className="text-orange-400 hover:text-orange-300 flex items-center gap-2"
            >
              <ChevronDownIcon className="w-4 h-4" />
              Show remaining {xmlContent.split('\n').length - 20} lines
            </button>
          </div>
        )}
        {showFullXml && hasMoreLines && (
          <div className="mt-4 pt-4 border-t border-gray-700">
            <button
              onClick={() => setShowFullXml(false)}
              className="text-orange-400 hover:text-orange-300 flex items-center gap-2"
            >
              <ChevronUpIcon className="w-4 h-4" />
              Show less
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
