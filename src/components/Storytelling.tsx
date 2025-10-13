import React, { useEffect, useState, useMemo } from 'react';
import {
  SparklesIcon,
  DocumentTextIcon,
  ChatBubbleLeftRightIcon,
  ArrowLeftIcon,
  ArrowDownTrayIcon,
  PlusIcon,
  TrashIcon
} from '@heroicons/react/24/outline';
import { API_BASE_URL } from '../config';
import { useAuth } from '../contexts/AuthContext';

const BRAND_ORANGE = '#D14A2D';
const BRAND_BG = '#F7F7F8';
const BRAND_GRAY = '#5D5F62';

interface Project {
  id: string;
  name: string;
  methodologyType?: string;
  archived?: boolean;
  client?: string;
}

interface Finding {
  question: string;
  answer: string;
  quotes: string[];
  insight: string;
}

interface Storyboard {
  id: string;
  title: string;
  generatedAt: string;
  detailLevel: string;
  quoteLevel: string;
  sections: Array<{
    title: string;
    content: string;
  }>;
}

interface ChatMessage {
  id: string;
  question: string;
  answer: string;
  quotes?: string[];
  confidence?: string;
  note?: string;
  timestamp: string;
}

export default function Storytelling() {
  const { user } = useAuth();
  const [projects, setProjects] = useState<Project[]>([]);
  const [selectedProject, setSelectedProject] = useState<Project | null>(null);
  const [activeTab, setActiveTab] = useState<'key-findings' | 'storyboard' | 'ask'>('key-findings');
  const [loading, setLoading] = useState(false);

  // Storytelling data
  const [strategicQuestions, setStrategicQuestions] = useState<string[]>([]);
  const [keyFindings, setKeyFindings] = useState<{ findings: Finding[]; generatedAt?: string } | null>(null);
  const [storyboards, setStoryboards] = useState<Storyboard[]>([]);
  const [chatHistory, setChatHistory] = useState<ChatMessage[]>([]);

  // UI state
  const [generatingFindings, setGeneratingFindings] = useState(false);
  const [generatingStoryboard, setGeneratingStoryboard] = useState(false);
  const [askingQuestion, setAskingQuestion] = useState(false);
  const [showCostModal, setShowCostModal] = useState(false);
  const [costEstimate, setCostEstimate] = useState<any>(null);
  const [pendingAction, setPendingAction] = useState<'findings' | 'storyboard' | 'question' | null>(null);

  // Form state
  const [newQuestion, setNewQuestion] = useState('');
  const [editingQuestions, setEditingQuestions] = useState(false);
  const [tempQuestions, setTempQuestions] = useState<string[]>([]);
  const [detailLevel, setDetailLevel] = useState<'straightforward' | 'moderate' | 'max'>('moderate');
  const [quoteLevel, setQuoteLevel] = useState<'none' | 'few' | 'moderate' | 'many'>('moderate');
  const [currentQuestion, setCurrentQuestion] = useState('');
  const [showOldStoryboards, setShowOldStoryboards] = useState(false);

  const qualProjects = useMemo(
    () => projects.filter(p => (p.methodologyType || '').toLowerCase() === 'qualitative' && !p.archived),
    [projects]
  );

  const getAuthHeaders = () => {
    const token = localStorage.getItem('jaice_token');
    return token ? { Authorization: `Bearer ${token}` } : {};
  };

  const loadProjects = async () => {
    try {
      setLoading(true);
      const response = await fetch(`${API_BASE_URL}/api/projects/all`, {
        headers: getAuthHeaders()
      });
      if (response.ok) {
        const data = await response.json();
        setProjects(Array.isArray(data.projects) ? data.projects : []);
      }
    } catch (error) {
      console.error('Failed to load projects:', error);
    } finally {
      setLoading(false);
    }
  };

  const loadStorytellingData = async (projectId: string) => {
    try {
      const response = await fetch(`${API_BASE_URL}/api/storytelling/${projectId}`, {
        headers: getAuthHeaders()
      });
      if (response.ok) {
        const data = await response.json();
        setStrategicQuestions(data.strategicQuestions || []);
        setKeyFindings(data.keyFindings);
        setStoryboards(data.storyboards || []);
        setChatHistory(data.chatHistory || []);
      }
    } catch (error) {
      console.error('Failed to load storytelling data:', error);
    }
  };

  useEffect(() => {
    loadProjects();
  }, []);

  useEffect(() => {
    if (selectedProject) {
      loadStorytellingData(selectedProject.id);
    }
  }, [selectedProject]);

  const handleSaveQuestions = async () => {
    if (!selectedProject) return;

    try {
      const response = await fetch(`${API_BASE_URL}/api/storytelling/${selectedProject.id}/strategic-questions`, {
        method: 'POST',
        headers: {
          ...getAuthHeaders(),
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ questions: tempQuestions })
      });

      if (response.ok) {
        setStrategicQuestions(tempQuestions);
        setEditingQuestions(false);
      } else {
        alert('Failed to save questions');
      }
    } catch (error) {
      console.error('Failed to save questions:', error);
      alert('Failed to save questions');
    }
  };

  const estimateCost = async () => {
    if (!selectedProject) return;

    console.log('💰 Estimating cost for project:', selectedProject.id);
    console.log('💰 API URL:', `${API_BASE_URL}/api/storytelling/${selectedProject.id}/estimate`);

    try {
      const response = await fetch(`${API_BASE_URL}/api/storytelling/${selectedProject.id}/estimate`, {
        method: 'POST',
        headers: {
          ...getAuthHeaders(),
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ detailLevel, quoteLevel })
      });

      console.log('💰 Cost estimate response status:', response.status);

      if (response.ok) {
        const estimate = await response.json();
        console.log('💰 Cost estimate received:', estimate);
        setCostEstimate(estimate);
        setShowCostModal(true);
      } else {
        const errorText = await response.text();
        console.error('💰 Cost estimate failed:', response.status, errorText);
      }
    } catch (error) {
      console.error('Failed to estimate cost:', error);
    }
  };

  const handleGenerateFindings = async () => {
    setPendingAction('findings');
    await estimateCost();
  };

  const confirmGenerateFindings = async () => {
    if (!selectedProject) return;

    setShowCostModal(false);
    setGeneratingFindings(true);

    try {
      const response = await fetch(`${API_BASE_URL}/api/storytelling/${selectedProject.id}/key-findings/generate`, {
        method: 'POST',
        headers: getAuthHeaders()
      });

      if (response.ok) {
        const findings = await response.json();
        setKeyFindings(findings);
      } else {
        const error = await response.json();
        alert(`Failed to generate findings: ${error.error}`);
      }
    } catch (error) {
      console.error('Failed to generate findings:', error);
      alert('Failed to generate findings');
    } finally {
      setGeneratingFindings(false);
    }
  };

  const handleGenerateStoryboard = async () => {
    console.log('🎬 Generate Storyboard clicked');
    setPendingAction('storyboard');
    await estimateCost();
  };

  const confirmGenerateStoryboard = async () => {
    if (!selectedProject) return;

    setShowCostModal(false);
    setGeneratingStoryboard(true);

    try {
      const response = await fetch(`${API_BASE_URL}/api/storytelling/${selectedProject.id}/storyboard/generate`, {
        method: 'POST',
        headers: {
          ...getAuthHeaders(),
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ detailLevel, quoteLevel })
      });

      if (response.ok) {
        const storyboard = await response.json();
        setStoryboards([storyboard, ...storyboards]);
      } else {
        const error = await response.json();
        alert(`Failed to generate storyboard: ${error.error}`);
      }
    } catch (error) {
      console.error('Failed to generate storyboard:', error);
      alert('Failed to generate storyboard');
    } finally {
      setGeneratingStoryboard(false);
    }
  };

  const handleAskQuestion = async () => {
    setPendingAction('question');
    await estimateCost();
  };

  const confirmAskQuestion = async () => {
    if (!selectedProject || !currentQuestion.trim()) return;

    setShowCostModal(false);
    setAskingQuestion(true);

    try {
      const response = await fetch(`${API_BASE_URL}/api/storytelling/${selectedProject.id}/ask`, {
        method: 'POST',
        headers: {
          ...getAuthHeaders(),
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ question: currentQuestion, detailLevel, quoteLevel })
      });

      if (response.ok) {
        await loadStorytellingData(selectedProject.id);
        setCurrentQuestion('');
      } else {
        const error = await response.json();
        alert(`Failed to answer question: ${error.error}`);
      }
    } catch (error) {
      console.error('Failed to ask question:', error);
      alert('Failed to ask question');
    } finally {
      setAskingQuestion(false);
    }
  };

  const handleDownloadStoryboard = async (storyboard: Storyboard) => {
    if (!selectedProject) return;

    try {
      const response = await fetch(
        `${API_BASE_URL}/api/storytelling/${selectedProject.id}/storyboard/${storyboard.id}/download`,
        { headers: getAuthHeaders() }
      );

      if (response.ok) {
        const blob = await response.blob();
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `Storyboard_${new Date(storyboard.generatedAt).toLocaleDateString()}.docx`;
        document.body.appendChild(a);
        a.click();
        window.URL.revokeObjectURL(url);
        document.body.removeChild(a);
      } else {
        alert('Failed to download storyboard');
      }
    } catch (error) {
      console.error('Failed to download:', error);
      alert('Failed to download storyboard');
    }
  };

  if (selectedProject) {
    return (
      <main className="flex-1 overflow-y-auto" style={{ backgroundColor: BRAND_BG }}>
        <div className="flex-1 p-6 space-y-6 max-w-full overflow-hidden">
          <section className="flex items-center justify-between">
            <div>
              <button
                onClick={() => setSelectedProject(null)}
                className="inline-flex items-center gap-2 text-sm font-medium text-gray-600 hover:text-gray-900 transition mb-2"
              >
                <ArrowLeftIcon className="h-4 w-4" />
                Back to Projects
              </button>
              <h2 className="text-2xl font-bold" style={{ color: BRAND_GRAY }}>
                {selectedProject.name} - Storytelling
              </h2>
              <p className="mt-1 text-sm text-gray-500">
                {selectedProject.client && <span>{selectedProject.client} • </span>}
                AI-powered research insights
              </p>
            </div>
          </section>

          {/* Tabs */}
          <div className="border-b border-gray-200">
            <nav className="-mb-px flex space-x-8">
              {[
                { id: 'key-findings', label: 'Key Findings', icon: SparklesIcon },
                { id: 'storyboard', label: 'Storyboard', icon: DocumentTextIcon },
                { id: 'ask', label: 'Ask a Question', icon: ChatBubbleLeftRightIcon }
              ].map(tab => (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id as any)}
                  className={`py-2 px-1 border-b-2 font-medium text-sm flex items-center gap-2 ${
                    activeTab === tab.id
                      ? 'text-white'
                      : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                  }`}
                  style={activeTab === tab.id ? { borderBottomColor: BRAND_ORANGE, color: BRAND_ORANGE } : {}}
                >
                  <tab.icon className="h-4 w-4" />
                  {tab.label}
                </button>
              ))}
            </nav>
          </div>

          {/* Key Findings Tab */}
          {activeTab === 'key-findings' && (
            <div className="space-y-4">
              <div className="bg-white shadow-sm border border-gray-200 rounded-lg p-6">
                <div className="flex items-center justify-between mb-4">
                  <h3 className="text-lg font-semibold text-gray-900">Strategic Questions</h3>
                  <button
                    onClick={() => {
                      setEditingQuestions(!editingQuestions);
                      setTempQuestions([...strategicQuestions]);
                    }}
                    className="text-sm text-gray-600 hover:text-gray-900"
                  >
                    {editingQuestions ? 'Cancel' : 'Edit Questions'}
                  </button>
                </div>

                {editingQuestions ? (
                  <div className="space-y-3">
                    {tempQuestions.map((q, idx) => (
                      <div key={idx} className="flex items-center gap-2">
                        <input
                          type="text"
                          value={q}
                          onChange={e => {
                            const updated = [...tempQuestions];
                            updated[idx] = e.target.value;
                            setTempQuestions(updated);
                          }}
                          className="flex-1 border border-gray-300 rounded px-3 py-2 text-sm"
                        />
                        <button
                          onClick={() => setTempQuestions(tempQuestions.filter((_, i) => i !== idx))}
                          className="text-red-600 hover:text-red-800"
                        >
                          <TrashIcon className="h-5 w-5" />
                        </button>
                      </div>
                    ))}
                    <button
                      onClick={() => setTempQuestions([...tempQuestions, ''])}
                      className="flex items-center gap-2 text-sm text-gray-600 hover:text-gray-900"
                    >
                      <PlusIcon className="h-4 w-4" />
                      Add Question
                    </button>
                    <button
                      onClick={handleSaveQuestions}
                      className="mt-4 px-4 py-2 rounded-lg text-white text-sm font-medium"
                      style={{ backgroundColor: BRAND_ORANGE }}
                    >
                      Save Questions
                    </button>
                  </div>
                ) : (
                  <div className="space-y-2">
                    {strategicQuestions.length === 0 ? (
                      <p className="text-sm text-gray-500">No strategic questions defined yet. Click "Edit Questions" to add some.</p>
                    ) : (
                      strategicQuestions.map((q, idx) => (
                        <p key={idx} className="text-sm text-gray-700">
                          {idx + 1}. {q}
                        </p>
                      ))
                    )}
                  </div>
                )}
              </div>

              {strategicQuestions.length > 0 && (
                <div className="flex items-center justify-between">
                  <button
                    onClick={handleGenerateFindings}
                    disabled={generatingFindings}
                    className="px-6 py-3 rounded-lg text-white font-medium flex items-center gap-2 disabled:opacity-50"
                    style={{ backgroundColor: BRAND_ORANGE }}
                  >
                    {generatingFindings ? 'Generating...' : 'Generate Key Findings'}
                    <SparklesIcon className="h-5 w-5" />
                  </button>
                </div>
              )}

              {keyFindings && keyFindings.findings && (
                <div className="space-y-4">
                  {keyFindings.generatedAt && (
                    <p className="text-xs text-gray-500">
                      Last updated: {new Date(keyFindings.generatedAt).toLocaleString()}
                    </p>
                  )}
                  {keyFindings.findings.map((finding, idx) => (
                    <div key={idx} className="bg-white shadow-sm border border-gray-200 rounded-lg p-6">
                      <h4 className="font-semibold text-gray-900 mb-2">{finding.question}</h4>
                      <p className="text-sm text-gray-700 mb-3">{finding.answer}</p>
                      {finding.quotes && finding.quotes.length > 0 && (
                        <div className="border-l-4 border-gray-300 pl-4 mb-3 space-y-2">
                          {finding.quotes.map((quote, qidx) => (
                            <p key={qidx} className="text-sm italic text-gray-600">"{quote}"</p>
                          ))}
                        </div>
                      )}
                      {finding.insight && (
                        <div className="mt-3 p-3 bg-orange-50 rounded">
                          <p className="text-sm font-medium" style={{ color: BRAND_ORANGE }}>
                            💡 Insight: {finding.insight}
                          </p>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Storyboard Tab */}
          {activeTab === 'storyboard' && (
            <div className="space-y-4">
              <div className="bg-white shadow-sm border border-gray-200 rounded-lg p-6">
                <h3 className="text-lg font-semibold text-gray-900 mb-4">Generate New Storyboard</h3>

                <div className="grid grid-cols-2 gap-4 mb-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">Detail Level</label>
                    <select
                      value={detailLevel}
                      onChange={e => setDetailLevel(e.target.value as any)}
                      className="w-full border border-gray-300 rounded px-3 py-2 text-sm"
                    >
                      <option value="straightforward">Straightforward</option>
                      <option value="moderate">Moderate</option>
                      <option value="max">Max Detail</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">Quotes</label>
                    <select
                      value={quoteLevel}
                      onChange={e => setQuoteLevel(e.target.value as any)}
                      className="w-full border border-gray-300 rounded px-3 py-2 text-sm"
                    >
                      <option value="none">None</option>
                      <option value="few">A Few</option>
                      <option value="moderate">Moderate</option>
                      <option value="many">Many</option>
                    </select>
                  </div>
                </div>

                <button
                  onClick={handleGenerateStoryboard}
                  disabled={generatingStoryboard}
                  className="px-6 py-3 rounded-lg text-white font-medium flex items-center gap-2 disabled:opacity-50"
                  style={{ backgroundColor: BRAND_ORANGE }}
                >
                  {generatingStoryboard ? 'Generating...' : 'Generate Storyboard'}
                  <DocumentTextIcon className="h-5 w-5" />
                </button>
              </div>

              {storyboards.length > 0 && (
                <div className="space-y-4">
                  <div className="bg-white shadow-sm border border-gray-200 rounded-lg p-6">
                    <div className="flex items-center justify-between mb-4">
                      <h4 className="font-semibold text-gray-900">Latest Storyboard</h4>
                      <button
                        onClick={() => handleDownloadStoryboard(storyboards[0])}
                        className="flex items-center gap-2 text-sm text-gray-600 hover:text-gray-900"
                      >
                        <ArrowDownTrayIcon className="h-4 w-4" />
                        Download Word
                      </button>
                    </div>
                    <p className="text-xs text-gray-500 mb-4">
                      Generated: {new Date(storyboards[0].generatedAt).toLocaleString()} • {storyboards[0].detailLevel} detail • {storyboards[0].quoteLevel} quotes
                    </p>
                    <div className="prose prose-sm max-w-none">
                      {storyboards[0].sections?.map((section, idx) => (
                        <div key={idx} className="mb-6">
                          <h3 className="text-base font-bold text-gray-900 mb-2">{section.title}</h3>
                          <div className="text-sm text-gray-700 whitespace-pre-wrap">{section.content}</div>
                        </div>
                      ))}
                    </div>
                  </div>

                  {storyboards.length > 1 && (
                    <div>
                      <button
                        onClick={() => setShowOldStoryboards(!showOldStoryboards)}
                        className="text-sm text-gray-600 hover:text-gray-900 mb-3"
                      >
                        {showOldStoryboards ? 'Hide' : 'Show'} Old Storyboards ({storyboards.length - 1})
                      </button>

                      {showOldStoryboards && (
                        <div className="space-y-3">
                          {storyboards.slice(1).map(sb => (
                            <div key={sb.id} className="bg-white shadow-sm border border-gray-200 rounded-lg p-4">
                              <div className="flex items-center justify-between">
                                <div>
                                  <p className="text-sm font-medium text-gray-900">{sb.title}</p>
                                  <p className="text-xs text-gray-500">
                                    {new Date(sb.generatedAt).toLocaleString()} • {sb.detailLevel} detail • {sb.quoteLevel} quotes
                                  </p>
                                </div>
                                <button
                                  onClick={() => handleDownloadStoryboard(sb)}
                                  className="text-sm text-gray-600 hover:text-gray-900"
                                >
                                  <ArrowDownTrayIcon className="h-4 w-4" />
                                </button>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Ask Question Tab */}
          {activeTab === 'ask' && (
            <div className="space-y-4">
              <div className="bg-white shadow-sm border border-gray-200 rounded-lg p-6">
                <h3 className="text-lg font-semibold text-gray-900 mb-4">Ask a Question</h3>

                <div className="grid grid-cols-2 gap-4 mb-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">Detail Level</label>
                    <select
                      value={detailLevel}
                      onChange={e => setDetailLevel(e.target.value as any)}
                      className="w-full border border-gray-300 rounded px-3 py-2 text-sm"
                    >
                      <option value="straightforward">Straightforward</option>
                      <option value="moderate">Moderate</option>
                      <option value="max">Max Detail</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">Quotes</label>
                    <select
                      value={quoteLevel}
                      onChange={e => setQuoteLevel(e.target.value as any)}
                      className="w-full border border-gray-300 rounded px-3 py-2 text-sm"
                    >
                      <option value="none">None</option>
                      <option value="few">A Few</option>
                      <option value="moderate">Moderate</option>
                      <option value="many">Many</option>
                    </select>
                  </div>
                </div>

                <div className="flex gap-2">
                  <input
                    type="text"
                    value={currentQuestion}
                    onChange={e => setCurrentQuestion(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && !askingQuestion && handleAskQuestion()}
                    placeholder="Ask a question about your research..."
                    className="flex-1 border border-gray-300 rounded px-4 py-3 text-sm"
                    disabled={askingQuestion}
                  />
                  <button
                    onClick={handleAskQuestion}
                    disabled={askingQuestion || !currentQuestion.trim()}
                    className="px-6 py-3 rounded-lg text-white font-medium disabled:opacity-50"
                    style={{ backgroundColor: BRAND_ORANGE }}
                  >
                    {askingQuestion ? 'Asking...' : 'Ask'}
                  </button>
                </div>
              </div>

              <div className="space-y-3">
                {chatHistory.slice().reverse().map(msg => (
                  <div key={msg.id} className="bg-white shadow-sm border border-gray-200 rounded-lg p-6">
                    <p className="font-semibold text-gray-900 mb-2">Q: {msg.question}</p>
                    <p className="text-sm text-gray-700 mb-3">A: {msg.answer}</p>
                    {msg.quotes && msg.quotes.length > 0 && (
                      <div className="border-l-4 border-gray-300 pl-4 mb-3 space-y-1">
                        {msg.quotes.map((quote, idx) => (
                          <p key={idx} className="text-xs italic text-gray-600">"{quote}"</p>
                        ))}
                      </div>
                    )}
                    <div className="flex items-center justify-between text-xs text-gray-500">
                      <span>{new Date(msg.timestamp).toLocaleString()}</span>
                      {msg.confidence && <span>Confidence: {msg.confidence}</span>}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Cost Estimate Modal */}
        {showCostModal && costEstimate && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4">
            <div className="w-full max-w-md rounded-xl bg-white shadow-xl p-6">
              <h3 className="text-lg font-bold text-gray-900 mb-4">Cost Estimate</h3>
              <div className="space-y-3 mb-6">
                <div className="flex justify-between text-sm">
                  <span className="text-gray-600">Input tokens:</span>
                  <span className="font-medium">{costEstimate.inputTokens.toLocaleString()}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-gray-600">Output tokens:</span>
                  <span className="font-medium">{costEstimate.outputTokens.toLocaleString()}</span>
                </div>
                <div className="flex justify-between text-lg font-bold border-t pt-3">
                  <span>Estimated Cost:</span>
                  <span style={{ color: BRAND_ORANGE }}>{costEstimate.formattedCost}</span>
                </div>
              </div>
              <div className="flex gap-3">
                <button
                  onClick={() => setShowCostModal(false)}
                  className="flex-1 px-4 py-2 rounded-lg border border-gray-300 text-gray-700 hover:bg-gray-50"
                >
                  Cancel
                </button>
                <button
                  onClick={() => {
                    if (pendingAction === 'findings') confirmGenerateFindings();
                    else if (pendingAction === 'storyboard') confirmGenerateStoryboard();
                    else if (pendingAction === 'question') confirmAskQuestion();
                  }}
                  className="flex-1 px-4 py-2 rounded-lg text-white"
                  style={{ backgroundColor: BRAND_ORANGE }}
                >
                  Confirm
                </button>
              </div>
            </div>
          </div>
        )}
      </main>
    );
  }

  return (
    <main className="flex-1 overflow-y-auto" style={{ backgroundColor: BRAND_BG }}>
      <div className="flex-1 p-6 space-y-6 max-w-full overflow-hidden">
        <section className="flex items-center justify-between">
          <div>
            <h2 className="text-2xl font-bold" style={{ color: BRAND_GRAY }}>
              Storytelling
            </h2>
            <p className="mt-1 text-sm text-gray-500">
              AI-powered insights from qualitative research
            </p>
          </div>
        </section>

        <div className="bg-white shadow-sm border border-gray-200 rounded-lg overflow-hidden">
          {loading ? (
            <div className="p-12 text-center">
              <div className="mx-auto mb-4 h-10 w-10 animate-spin rounded-full border-4 border-gray-200 border-t-[#D14A2D]"></div>
              <p className="text-sm text-gray-500">Loading projects...</p>
            </div>
          ) : qualProjects.length === 0 ? (
            <div className="p-12 text-center">
              <DocumentTextIcon className="mx-auto mb-4 h-16 w-16 text-gray-300" />
              <h3 className="text-lg font-semibold text-gray-900">No qualitative projects</h3>
              <p className="mt-2 text-gray-500">
                Create a qualitative project to start using storytelling features.
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-200">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Project
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Client
                    </th>
                    <th className="px-6 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Actions
                    </th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-200">
                  {qualProjects.map(project => (
                    <tr
                      key={project.id}
                      className="hover:bg-gray-50 cursor-pointer transition-colors"
                      onClick={() => setSelectedProject(project)}
                    >
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div className="text-sm font-medium text-gray-900">{project.name}</div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div className="text-sm text-gray-900">{project.client || '-'}</div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-center">
                        <button
                          onClick={e => {
                            e.stopPropagation();
                            setSelectedProject(project);
                          }}
                          className="text-sm font-medium"
                          style={{ color: BRAND_ORANGE }}
                        >
                          Open
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </main>
  );
}
