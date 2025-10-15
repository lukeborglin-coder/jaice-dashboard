import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  DocumentTextIcon,
  CloudArrowUpIcon,
  ArrowDownTrayIcon,
  TrashIcon,
  ArrowLeftIcon,
  CheckCircleIcon
} from '@heroicons/react/24/outline';
import { IconScript } from '@tabler/icons-react';
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
  archivedDate?: string;
  client?: string;
  createdBy?: string;
  teamMembers?: Array<{ id?: string; email?: string; name?: string }>;
}

interface Transcript {
  id: string;
  originalFilename: string;
  cleanedFilename?: string;
  originalPath: string;
  cleanedPath?: string;
  uploadedAt: number;
  isCleaned: boolean;
  originalSize?: number;
  cleanedSize?: number;
  respno?: string;
  interviewDate?: string;
  interviewTime?: string;
}

type ProjectTranscripts = Record<string, Transcript[]>;

const isQualitative = (project: Project) => {
  const methodologyType = (project.methodologyType || '').toLowerCase();
  return methodologyType === 'qualitative' || methodologyType === 'qual';
};

const formatTimestamp = (value: number) => {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return '-';
  }
  return date.toLocaleDateString();
};

// Estimate cost for GPT-4o transcript cleaning
// GPT-4o pricing: $2.50 per 1M input tokens, $10.00 per 1M output tokens
const estimateCleaningCost = (fileSize: number): string => {
  // Rough estimate: 1 character ≈ 0.4 tokens
  const estimatedInputTokens = fileSize * 0.4;
  // Output is typically similar length to input for transcript cleaning
  const estimatedOutputTokens = estimatedInputTokens * 0.9;

  const inputCost = (estimatedInputTokens / 1_000_000) * 2.50;
  const outputCost = (estimatedOutputTokens / 1_000_000) * 10.00;
  const totalCost = inputCost + outputCost;

  // Round down to 2 decimal places and format with 2 decimal places
  const roundedCost = Math.floor(totalCost * 100) / 100;
  return `$${roundedCost.toFixed(2)}`;
};

export default function Transcripts() {
  const { user } = useAuth();
  const [projects, setProjects] = useState<Project[]>([]);
  const [archivedProjects, setArchivedProjects] = useState<Project[]>([]);
  const [activeTab, setActiveTab] = useState<'active' | 'archived'>('active');
  const [selectedProject, setSelectedProject] = useState<Project | null>(null);
  const [transcripts, setTranscripts] = useState<ProjectTranscripts>({});
  const [showUploadModal, setShowUploadModal] = useState(false);
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [cleanTranscript, setCleanTranscript] = useState(false);
  const [addToCA, setAddToCA] = useState(false);
  const [selectedAnalysisId, setSelectedAnalysisId] = useState<string>('');
  const [isProcessing, setIsProcessing] = useState(false);
  const [isLoadingProjects, setIsLoadingProjects] = useState(false);
  const [isLoadingArchived, setIsLoadingArchived] = useState(false);
  const [savedAnalyses, setSavedAnalyses] = useState<any[]>([]);
  const [showAddToCAModal, setShowAddToCAModal] = useState(false);
  const [selectedTranscriptForCA, setSelectedTranscriptForCA] = useState<Transcript | null>(null);
  const [isAddingToCA, setIsAddingToCA] = useState(false);
  const [showMyProjectsOnly, setShowMyProjectsOnly] = useState(true);

  const qualActiveProjects = useMemo(
    () => projects.filter(isQualitative),
    [projects]
  );
  const qualArchivedProjects = useMemo(
    () => archivedProjects.filter(isQualitative),
    [archivedProjects]
  );

  const filterProjectsByUser = useCallback(
    (list: Project[]) => {
      if (!showMyProjectsOnly || !user) return list;

      const uid = String((user as any)?.id || '').toLowerCase();
      const uemail = String((user as any)?.email || '').toLowerCase();
      const uname = String((user as any)?.name || '').toLowerCase();

      return list.filter(project => {
        const createdBy = String((project as any)?.createdBy || '').toLowerCase();
        const createdByMe =
          !!createdBy && (createdBy === uid || createdBy === uemail);

        const teamMembers = Array.isArray((project as any)?.teamMembers)
          ? (project as any).teamMembers
          : [];

        const inTeam = teamMembers.some((member: any) => {
          const mid = String(member?.id || '').toLowerCase();
          const memail = String(member?.email || '').toLowerCase();
          const mname = String(member?.name || '').toLowerCase();
          return (uid && mid === uid) || (uemail && memail === uemail) || (uname && mname === uname);
        });

        return createdByMe || inTeam;
      });
    },
    [showMyProjectsOnly, user]
  );

  const filteredActiveProjects = useMemo(
    () => filterProjectsByUser(qualActiveProjects),
    [filterProjectsByUser, qualActiveProjects]
  );

  const filteredArchivedProjects = useMemo(
    () => filterProjectsByUser(qualArchivedProjects),
    [filterProjectsByUser, qualArchivedProjects]
  );

  const allVisibleProjects = useMemo(
    () => [...filteredActiveProjects, ...filteredArchivedProjects],
    [filteredActiveProjects, filteredArchivedProjects]
  );

  const displayProjects =
    activeTab === 'active' ? filteredActiveProjects : filteredArchivedProjects;
  const isLoadingCurrentTab =
    activeTab === 'active' ? isLoadingProjects : isLoadingArchived;

  const getAuthHeaders = () => {
    const token = localStorage.getItem('jaice_token');
    return token ? { Authorization: `Bearer ${token}` } : {};
  };

  const loadActiveProjects = async () => {
    try {
      setIsLoadingProjects(true);
      const response = await fetch(`${API_BASE_URL}/api/projects/all`, {
        headers: getAuthHeaders()
      });
      if (response.ok) {
        const data = await response.json();
        const items = Array.isArray(data.projects) ? data.projects : [];
        setProjects(items);
      } else {
        console.error('Failed to load projects', await response.text());
      }
    } catch (error) {
      console.error('Failed to load projects:', error);
    } finally {
      setIsLoadingProjects(false);
    }
  };

  const loadArchivedProjects = async (userId: string) => {
    try {
      setIsLoadingArchived(true);
      const response = await fetch(
        `${API_BASE_URL}/api/projects/archived?userId=${encodeURIComponent(
          userId
        )}`,
        { headers: getAuthHeaders() }
      );
      if (response.ok) {
        const data = await response.json();
        const items = Array.isArray(data.projects) ? data.projects : [];
        setArchivedProjects(items);
      } else {
        console.error('Failed to load archived projects', await response.text());
        setArchivedProjects([]);
      }
    } catch (error) {
      console.error('Failed to load archived projects:', error);
      setArchivedProjects([]);
    } finally {
      setIsLoadingArchived(false);
    }
  };

  const loadTranscripts = async () => {
    try {
      const response = await fetch(`${API_BASE_URL}/api/transcripts/all`, {
        headers: getAuthHeaders()
      });
      if (response.ok) {
        const data = await response.json();
        setTranscripts(data || {});
      } else {
        console.error('Failed to load transcripts', await response.text());
      }
    } catch (error) {
      console.error('Failed to load transcripts:', error);
    }
  };

  const loadSavedAnalyses = async () => {
    try {
      const response = await fetch(`${API_BASE_URL}/api/caX/saved`, {
        headers: getAuthHeaders()
      });
      if (response.ok) {
        const data = await response.json();
        setSavedAnalyses(data || []);
      } else {
        console.error('Failed to load saved analyses', await response.text());
      }
    } catch (error) {
      console.error('Failed to load saved analyses:', error);
    }
  };

  const isTranscriptInAnalysis = (transcriptId: string): boolean => {
    return savedAnalyses.some(analysis => {
      // Check if transcript is in the transcripts array (primary method)
      if (analysis.transcripts?.some((t: any) => t.id === transcriptId || t.sourceTranscriptId === transcriptId)) {
        return true;
      }
      
      // Check if transcript's respno exists in the analysis data (fallback method)
      if (analysis.data) {
        const transcript = transcripts[selectedProject?.id || '']?.find(t => t.id === transcriptId);
        if (transcript?.respno) {
          // Check if this respno exists in any sheet of the analysis data
          return Object.values(analysis.data).some((sheetData: any) => 
            Array.isArray(sheetData) && sheetData.some((row: any) => 
              row.respno === transcript.respno || row['Respondent ID'] === transcript.respno
            )
          );
        }
      }
      
      return false;
    });
  };

  const getCANameForProject = (projectId: string): string | null => {
    const analysis = savedAnalyses.find(a => a.projectId === projectId);
    return analysis ? analysis.name : null;
  };

  const analysesForSelectedProject = useMemo(
    () =>
      savedAnalyses.filter(
        analysis => analysis.projectId === selectedProject?.id
      ),
    [savedAnalyses, selectedProject?.id]
  );

  const canAddTranscriptToCA = analysesForSelectedProject.length > 0;

  const handleAddToCA = async (transcript: Transcript) => {
    if (!selectedProject) return;

    setIsAddingToCA(true);
    try {
      // Find the analysis for this project
      const analysis = savedAnalyses.find(a => a.projectId === selectedProject.id);

      if (!analysis) {
        alert('No Content Analysis found for this project. Please create one first.');
        setIsAddingToCA(false);
        setShowAddToCAModal(false);
        setSelectedTranscriptForCA(null);
        return;
      }

      const response = await fetch(
        `${API_BASE_URL}/api/caX/process-transcript`,
        {
          method: 'POST',
          headers: {
            ...getAuthHeaders(),
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            projectId: selectedProject.id,
            transcriptId: transcript.id,
            analysisId: analysis.id,
            activeSheet: analysis.activeSheet || 'Demographics',
            currentData: JSON.stringify(analysis.data || {}),
            discussionGuide: analysis.rawGuideText || '',
            guideMap: analysis.guideMap || {},
            preferCleanedTranscript: true
          })
        }
      );

      if (response.ok) {
        await loadSavedAnalyses();
        setShowAddToCAModal(false);
        setSelectedTranscriptForCA(null);
      } else {
        const error = await response.json();
        alert(`Failed to add transcript to CA: ${error.error || 'Unknown error'}`);
      }
    } catch (error) {
      console.error('Failed to add transcript to CA:', error);
      alert('Failed to add transcript to CA');
    } finally {
      setIsAddingToCA(false);
    }
  };

  useEffect(() => {
    loadActiveProjects();
    loadTranscripts();
    loadSavedAnalyses();
  }, [showMyProjectsOnly]);

  useEffect(() => {
    if (user?.id) {
      loadArchivedProjects(user.id);
    } else {
      setArchivedProjects([]);
    }
  }, [user?.id]);

  useEffect(() => {
    if (!selectedProject) return;
    const updated = allVisibleProjects.find(
      project => project.id === selectedProject.id
    );
    if (!updated) {
      setSelectedProject(null);
      return;
    }
    if (updated !== selectedProject) {
      setSelectedProject(updated);
    }
  }, [allVisibleProjects, selectedProject?.id]);

  useEffect(() => {
    if (!canAddTranscriptToCA && addToCA) {
      setAddToCA(false);
      setSelectedAnalysisId('');
    }
  }, [canAddTranscriptToCA, addToCA]);

  const handleUploadTranscript = async () => {
    if (!uploadFile || !selectedProject) {
      alert('Please select a project and choose a file to upload');
      return;
    }

    if (addToCA && !selectedAnalysisId) {
      alert('Please select a Content Analysis to add the transcript to');
      return;
    }

    setIsProcessing(true);

    try {
      const formData = new FormData();
      formData.append('transcript', uploadFile);
      formData.append('projectId', selectedProject.id);
      formData.append('cleanTranscript', cleanTranscript.toString());

      const response = await fetch(`${API_BASE_URL}/api/transcripts/upload`, {
        method: 'POST',
        headers: getAuthHeaders(),
        body: formData
      });

      if (response.ok) {
        const uploadedTranscript = await response.json();
        await loadTranscripts();
        await loadSavedAnalyses();

        // If "Add to CA" is checked, add the transcript to the selected analysis
        if (addToCA && selectedAnalysisId) {
          const analysis = savedAnalyses.find(a => a.id === selectedAnalysisId);
          if (analysis) {
            const caResponse = await fetch(
              `${API_BASE_URL}/api/caX/process-transcript`,
              {
                method: 'POST',
                headers: {
                  ...getAuthHeaders(),
                  'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                  projectId: selectedProject.id,
                  transcriptId: uploadedTranscript.id,
                  analysisId: analysis.id,
                  activeSheet: analysis.activeSheet || 'Demographics',
                  currentData: JSON.stringify(analysis.data || {}),
                  discussionGuide: analysis.rawGuideText || '',
                  guideMap: analysis.guideMap || {},
                  preferCleanedTranscript: cleanTranscript
                })
              }
            );

            if (!caResponse.ok) {
              const error = await caResponse.json();
              alert(`Transcript uploaded but failed to add to CA: ${error.error || 'Unknown error'}`);
            } else {
              // Refresh saved analyses to update the checkbox state
              await loadSavedAnalyses();
            }
          }
        }

        setShowUploadModal(false);
        setUploadFile(null);
        setCleanTranscript(false);
        setAddToCA(false);
        setSelectedAnalysisId('');
      } else {
        const error = await response.json();
        alert(`Failed to upload transcript: ${error.error || 'Unknown error'}`);
      }
    } catch (error) {
      console.error('Failed to upload transcript:', error);
      alert('Failed to upload transcript');
    } finally {
      setIsProcessing(false);
    }
  };

  const handleDownload = async (transcript: Transcript) => {
    if (!selectedProject) return;

    try {
      const filename =
        transcript.isCleaned && transcript.cleanedFilename
          ? transcript.cleanedFilename
          : transcript.originalFilename;

      const response = await fetch(
        `${API_BASE_URL}/api/transcripts/download/${selectedProject.id}/${transcript.id}`,
        { headers: getAuthHeaders() }
      );

      if (response.ok) {
        const blob = await response.blob();
        const url = window.URL.createObjectURL(blob);
        const anchor = document.createElement('a');
        anchor.href = url;
        anchor.download = filename || 'transcript.txt';
        document.body.appendChild(anchor);
        anchor.click();
        window.URL.revokeObjectURL(url);
        document.body.removeChild(anchor);
      } else {
        alert('Failed to download transcript');
      }
    } catch (error) {
      console.error('Failed to download transcript:', error);
      alert('Failed to download transcript');
    }
  };

  const handleDeleteTranscript = async (transcriptId: string) => {
    if (!selectedProject) return;

    if (!window.confirm('Are you sure you want to delete this transcript?')) {
      return;
    }

    try {
      const response = await fetch(
        `${API_BASE_URL}/api/transcripts/${selectedProject.id}/${transcriptId}`,
        {
          method: 'DELETE',
          headers: getAuthHeaders()
        }
      );

      if (response.ok) {
        await loadTranscripts();
        await loadSavedAnalyses();
      } else {
        alert('Failed to delete transcript');
      }
    } catch (error) {
      console.error('Failed to delete transcript:', error);
      alert('Failed to delete transcript');
    }
  };

  if (selectedProject) {
    const projectTranscripts = transcripts[selectedProject.id] || [];

    return (
      <main
        className="flex-1 overflow-y-auto"
        style={{ backgroundColor: BRAND_BG }}
      >
        <div className="flex-1 p-6 space-y-6 max-w-full overflow-hidden">
          <section className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <button
                onClick={() => setSelectedProject(null)}
                className="inline-flex items-center gap-2 text-sm font-medium text-gray-600 hover:text-gray-900 transition mb-2"
              >
                <ArrowLeftIcon className="h-4 w-4" />
                Back to Projects
              </button>
              <h2
                className="text-2xl font-bold"
                style={{ color: BRAND_GRAY }}
              >
                {selectedProject.name}
              </h2>
              <p className="mt-1 text-sm text-gray-500">
                {selectedProject.client && <span>{selectedProject.client}</span>}
                {selectedProject.client && ' • '}
                {projectTranscripts.length}{' '}
                {projectTranscripts.length === 1 ? 'transcript' : 'transcripts'}
                {selectedProject.archived && ' • Archived'}
              </p>
            </div>
            <button
              onClick={() => setShowUploadModal(true)}
              className="inline-flex items-center justify-center gap-2 rounded-lg px-4 py-2 text-sm font-medium text-white shadow-sm transition hover:opacity-90"
              style={{ backgroundColor: BRAND_ORANGE }}
            >
              <CloudArrowUpIcon className="h-5 w-5" />
              Upload Transcript
            </button>
          </section>

          <div className="bg-white shadow-sm border border-gray-200 rounded-lg overflow-hidden">
            {projectTranscripts.length === 0 ? (
              <div className="p-12 text-center">
                <DocumentTextIcon className="mx-auto mb-4 h-16 w-16 text-gray-300" />
                <h3 className="text-lg font-semibold text-gray-900">
                  No transcripts yet
                </h3>
                <p className="mt-2 text-gray-500">
                  Upload a transcript to get started.
                </p>
                <button
                  onClick={() => setShowUploadModal(true)}
                  className="mt-6 inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium text-white shadow-sm transition hover:opacity-90"
                  style={{ backgroundColor: BRAND_ORANGE }}
                >
                  <CloudArrowUpIcon className="h-5 w-5" />
                  Upload Transcript
                </button>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="min-w-full divide-y divide-gray-200">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="pl-6 pr-2 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                        Respno
                      </th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                        Filename
                      </th>
                      <th className="px-3 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider w-32">
                        Interview Date
                      </th>
                      <th className="px-3 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider w-28">
                        Interview Time
                      </th>
                      <th className="px-3 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider w-20">
                        Original
                      </th>
                      <th className="px-3 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider w-20">
                        Cleaned
                      </th>
                      <th className="px-3 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider w-28">
                        Added to CA
                      </th>
                      <th className="px-3 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider w-20">
                        Actions
                      </th>
                    </tr>
                  </thead>
                  <tbody className="bg-white divide-y divide-gray-200">
                    {projectTranscripts.map(transcript => {
                      const displayName = selectedProject ?
                        transcript.originalFilename :
                        transcript.originalFilename;

                      return (
                        <tr
                          key={transcript.id}
                          className="hover:bg-gray-50 transition-colors"
                        >
                          <td className="pl-6 pr-2 py-4 whitespace-nowrap">
                            {transcript.respno && (
                              <span className="inline-flex items-center rounded-md bg-blue-100 px-2 py-0.5 text-xs font-semibold text-blue-700">
                                {transcript.respno}
                              </span>
                            )}
                            {!transcript.respno && <span className="text-sm text-gray-400">-</span>}
                          </td>
                          <td className="px-4 py-4 whitespace-nowrap">
                            <div className="text-sm text-gray-900">{displayName}</div>
                          </td>
                          <td className="px-3 py-4 whitespace-nowrap text-center">
                            <div className="text-sm text-gray-900">
                              {transcript.interviewDate || '-'}
                            </div>
                          </td>
                          <td className="px-3 py-4 whitespace-nowrap text-center">
                            <div className="text-sm text-gray-900">
                              {transcript.interviewTime || '-'}
                            </div>
                          </td>
                          <td className="px-3 py-4 whitespace-nowrap text-center">
                            <button
                              onClick={() => handleDownload(transcript)}
                              className="text-blue-600 hover:text-blue-800 p-1 rounded-lg hover:bg-blue-50 mx-auto"
                              title="Download Original"
                            >
                              <DocumentTextIcon className="h-5 w-5" />
                            </button>
                          </td>
                          <td className="px-3 py-4 whitespace-nowrap text-center">
                            {transcript.isCleaned ? (
                              <button
                                onClick={() => handleDownload(transcript)}
                                className="text-blue-600 hover:text-blue-800 p-1 rounded-lg hover:bg-blue-50 mx-auto"
                                title="Download Cleaned"
                              >
                                <DocumentTextIcon className="h-5 w-5" />
                              </button>
                            ) : (
                              <span className="text-sm text-gray-400">-</span>
                            )}
                          </td>
                          <td className="px-3 py-4 whitespace-nowrap text-center">
                            {isTranscriptInAnalysis(transcript.id) ? (
                              <CheckCircleIcon className="h-5 w-5 text-green-600 mx-auto" />
                            ) : (
                              <button
                                onClick={() => {
                                  setSelectedTranscriptForCA(transcript);
                                  setShowAddToCAModal(true);
                                }}
                                className="text-[#D14A2D] hover:text-[#A03824] text-xs font-medium whitespace-nowrap"
                              >
                                Add to CA
                              </button>
                            )}
                          </td>
                          <td className="px-3 py-4 whitespace-nowrap text-center">
                            <button
                              onClick={() => handleDeleteTranscript(transcript.id)}
                              className="text-red-600 hover:text-red-800 p-1 rounded-lg hover:bg-red-50 mx-auto"
                              title="Delete"
                            >
                              <TrashIcon className="h-4 w-4" />
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>

        {showUploadModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4">
            <div className="w-full max-w-lg rounded-xl bg-white shadow-xl">
              <div className="border-b border-gray-200 px-6 py-4">
                <h2 className="text-xl font-bold text-gray-900">
                  Upload Transcript
                </h2>
                <p className="mt-1 text-sm text-gray-500">
                  Upload .docx or .txt files for {selectedProject.name}
                </p>
              </div>

              <div className="px-6 py-5">
                {isProcessing ? (
                  <div className="flex flex-col items-center justify-center gap-4 py-8 text-center">
                    <div
                      className="h-12 w-12 animate-spin rounded-full border-4 border-gray-200"
                      style={{ borderTopColor: BRAND_ORANGE }}
                    ></div>
                    <div>
                      <h3 className="text-lg font-semibold text-gray-900">
                        {cleanTranscript && addToCA
                          ? 'Cleaning Transcript and Updating Content Analysis'
                          : cleanTranscript
                          ? 'Cleaning Transcript'
                          : 'Uploading Transcript'}
                      </h3>
                      <p className="mt-1 text-sm text-gray-500">
                        {cleanTranscript && addToCA
                          ? 'This may take a few minutes. Please keep this page open.'
                          : 'This may take a moment...'}
                      </p>
                      {cleanTranscript && addToCA && (
                        <div className="flex items-center justify-center space-x-2 mt-2">
                          <div className="w-2 h-2 rounded-full animate-bounce" style={{ backgroundColor: '#D14A2D' }}></div>
                          <div className="w-2 h-2 rounded-full animate-bounce" style={{ backgroundColor: '#D14A2D', animationDelay: '0.1s' }}></div>
                          <div className="w-2 h-2 rounded-full animate-bounce" style={{ backgroundColor: '#D14A2D', animationDelay: '0.2s' }}></div>
                        </div>
                      )}
                    </div>
                  </div>
                ) : (
                  <div className="space-y-5">
                    <div>
                      <label className="mb-2 block text-sm font-medium text-gray-700">
                        Select transcript file
                      </label>
                      <input
                        type="file"
                        accept=".docx,.txt"
                        onChange={e =>
                          setUploadFile(e.target.files?.[0] || null)
                        }
                        className="block w-full cursor-pointer rounded-lg border border-gray-300 bg-gray-50 text-sm text-gray-900 focus:outline-none file:mr-4 file:py-2 file:px-4 file:rounded-l-lg file:border-0 file:text-sm file:font-medium file:bg-orange-50 file:text-orange-700 hover:file:bg-orange-100"
                      />
                      <p className="mt-2 text-xs text-gray-500">
                        Supported formats: .docx and .txt
                      </p>
                    </div>

                    <div>
                      <label className="flex items-center gap-2 text-sm text-gray-700">
                        <input
                          type="checkbox"
                          checked={cleanTranscript}
                          onChange={e => setCleanTranscript(e.target.checked)}
                          className="h-4 w-4 rounded border-gray-300"
                          style={{ accentColor: BRAND_ORANGE }}
                        />
                        Clean this transcript (remove timestamps, tidy formatting)
                      </label>
                      {cleanTranscript && uploadFile && (
                        <p className="mt-2 text-xs text-red-600 font-medium">
                          Estimated cost: {estimateCleaningCost(uploadFile.size)}
                        </p>
                      )}
                    </div>

                    <div>
                      <label
                        className={`flex items-center gap-2 text-sm ${
                          canAddTranscriptToCA ? 'text-gray-700' : 'text-gray-400'
                        }`}
                      >
                        <input
                          type="checkbox"
                          checked={addToCA}
                          onChange={e => {
                            setAddToCA(e.target.checked);
                            if (!e.target.checked) {
                              setSelectedAnalysisId('');
                            }
                          }}
                          disabled={!canAddTranscriptToCA}
                          className={`h-4 w-4 rounded border-gray-300 ${
                            !canAddTranscriptToCA ? 'cursor-not-allowed opacity-40' : ''
                          }`}
                          style={{ accentColor: BRAND_ORANGE }}
                        />
                        Add to Content Analysis
                      </label>
                      {!canAddTranscriptToCA && selectedProject && (
                        <p className="mt-2 text-xs text-gray-500">
                          No Content Analysis Found For {selectedProject.name}. Please visit the Content Analysis page to generate one.
                        </p>
                      )}
                      {addToCA && canAddTranscriptToCA && (
                        <div className="mt-3 space-y-2">
                          <div>
                            <label className="block text-xs font-medium text-gray-700 mb-1">
                              Select Content Analysis
                            </label>
                            <select
                              value={selectedAnalysisId}
                              onChange={e => setSelectedAnalysisId(e.target.value)}
                              className="block w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:border-orange-500 focus:outline-none focus:ring-1 focus:ring-orange-500"
                            >
                              <option value="">Select an analysis...</option>
                              {analysesForSelectedProject.map(analysis => (
                                <option key={analysis.id} value={analysis.id}>
                                  {analysis.name}
                                </option>
                              ))}
                            </select>
                          </div>
                          {uploadFile && (
                            <p className="text-xs text-red-600 font-medium">
                              Estimated cost: {estimateCleaningCost(uploadFile.size)}
                            </p>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>

              {!isProcessing && (
                <div className="flex items-center justify-between border-t border-gray-200 px-6 py-4">
                  <div>
                    {cleanTranscript && addToCA && uploadFile && (
                      <p className="text-sm font-semibold text-red-600">
                        Total estimated cost: {(() => {
                          const cleanCost = uploadFile.size * 0.4 * (2.50 + 10.00 * 0.9) / 1_000_000;
                          const caCost = uploadFile.size * 0.4 * (2.50 + 10.00 * 0.9) / 1_000_000;
                          const total = cleanCost + caCost;
                          const roundedTotal = Math.floor(total * 100) / 100;
                          return `$${roundedTotal.toFixed(2)}`;
                        })()}
                      </p>
                    )}
                  </div>
                  <div className="flex gap-3">
                    <button
                      onClick={() => {
                        setShowUploadModal(false);
                        setUploadFile(null);
                        setCleanTranscript(false);
                        setAddToCA(false);
                        setSelectedAnalysisId('');
                      }}
                      className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 transition hover:bg-gray-50"
                    >
                      Cancel
                    </button>
                    <button
                      onClick={handleUploadTranscript}
                      disabled={!uploadFile}
                      className="rounded-lg px-4 py-2 text-sm font-medium text-white transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
                      style={{ backgroundColor: BRAND_ORANGE }}
                    >
                      Upload
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {showAddToCAModal && selectedTranscriptForCA && selectedProject && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4">
            <div className="w-full max-w-lg rounded-xl bg-white shadow-xl">
              <div className="border-b border-gray-200 px-6 py-4">
                <h2 className="text-xl font-bold text-gray-900">
                  Add Transcript to Content Analysis
                </h2>
              </div>

              <div className="px-6 py-5">
                {isAddingToCA ? (
                  <div className="flex flex-col items-center justify-center gap-4 py-8 text-center">
                    <div
                      className="h-12 w-12 animate-spin rounded-full border-4 border-gray-200"
                      style={{ borderTopColor: BRAND_ORANGE }}
                    ></div>
                    <div>
                      <h3 className="text-lg font-semibold text-gray-900">
                        Adding transcript to CA
                      </h3>
                      <p className="mt-1 text-sm text-gray-500">
                        This may take a moment...
                      </p>
                    </div>
                  </div>
                ) : (
                  <div className="space-y-4">
                    <p className="text-sm text-gray-700">
                      Are you sure you want to add this transcript to the Content Analysis?
                    </p>
                    <div className="rounded-lg bg-gray-50 p-4">
                      <p className="text-sm font-medium text-gray-900">
                        Content Analysis: {getCANameForProject(selectedProject.id) || 'Default CA'}
                      </p>
                      <p className="mt-1 text-sm text-gray-600">
                        Transcript: {selectedProject.name} - {selectedTranscriptForCA.respno || 'Transcript'} Transcript
                      </p>
                    </div>
                  </div>
                )}
              </div>

              {!isAddingToCA && (
                <div className="flex justify-end gap-3 border-t border-gray-200 px-6 py-4">
                  <button
                    onClick={() => {
                      setShowAddToCAModal(false);
                      setSelectedTranscriptForCA(null);
                    }}
                    className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 transition hover:bg-gray-50"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={() => handleAddToCA(selectedTranscriptForCA)}
                    className="rounded-lg px-4 py-2 text-sm font-medium text-white transition hover:opacity-90"
                    style={{ backgroundColor: BRAND_ORANGE }}
                  >
                    Confirm
                  </button>
                </div>
              )}
            </div>
          </div>
        )}
      </main>
    );
  }

  return (
    <main
      className="flex-1 overflow-y-auto"
      style={{ backgroundColor: BRAND_BG }}
    >
      <div className="flex-1 p-6 space-y-6 max-w-full overflow-hidden">
        <section className="flex items-center justify-between">
          <div>
            <h2
              className="text-2xl font-bold"
              style={{ color: BRAND_GRAY }}
            >
              Transcripts
            </h2>
            <p className="mt-1 text-sm text-gray-500">
              Manage transcripts for qualitative projects
            </p>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-sm text-gray-600">Current View:</span>
            <button
              onClick={() => setShowMyProjectsOnly(!showMyProjectsOnly)}
              className={`px-3 py-1 text-xs rounded-lg shadow-sm transition-colors ${
                showMyProjectsOnly
                  ? 'text-white hover:opacity-90'
                  : 'bg-white border border-gray-300 hover:bg-gray-50'
              }`}
              style={showMyProjectsOnly ? { backgroundColor: BRAND_ORANGE } : {}}
            >
              {showMyProjectsOnly ? 'Only My Projects' : 'All Cognitive Projects'}
            </button>
          </div>
        </section>

        {/* Tabs */}
        <div className="border-b border-gray-200">
          <div className="flex items-center">
            <nav className="-mb-px flex space-x-8 items-center">
              <button
                onClick={() => setActiveTab('active')}
                className={`py-2 px-1 border-b-2 font-medium text-sm ${
                  activeTab === 'active'
                    ? 'text-white'
                    : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                }`}
                style={activeTab === 'active' ? { borderBottomColor: BRAND_ORANGE, color: BRAND_ORANGE } : {}}
              >
                Active Projects ({qualActiveProjects.length})
              </button>
              <button
                onClick={() => setActiveTab('archived')}
                className={`py-2 px-1 border-b-2 font-medium text-sm ${
                  activeTab === 'archived'
                    ? 'text-white'
                    : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                }`}
                style={activeTab === 'archived' ? { borderBottomColor: BRAND_ORANGE, color: BRAND_ORANGE } : {}}
              >
                Archived Projects ({qualArchivedProjects.length})
              </button>
            </nav>
          </div>
        </div>

        {/* Projects Table */}
        <div className="bg-white shadow-sm border border-gray-200 rounded-lg overflow-hidden">
          {isLoadingCurrentTab ? (
            <div className="p-12 text-center">
              <div className="mx-auto mb-4 h-10 w-10 animate-spin rounded-full border-4 border-gray-200 border-t-[#D14A2D]"></div>
              <p className="text-sm text-gray-500">Loading projects...</p>
            </div>
          ) : displayProjects.length === 0 ? (
            <div className="p-12 text-center">
              <DocumentTextIcon className="mx-auto mb-4 h-16 w-16 text-gray-300" />
              <h3 className="text-lg font-semibold text-gray-900">
                {activeTab === 'archived'
                  ? 'No archived qualitative projects'
                  : 'No active qualitative projects'}
              </h3>
              <p className="mt-2 text-gray-500">
                {activeTab === 'archived'
                  ? 'Archived qualitative projects will appear here.'
                  : 'Create a qualitative project to start managing transcripts.'}
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-200">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="pl-6 pr-2 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider w-0 whitespace-nowrap">
                      Project
                    </th>
                    <th className="pl-2 pr-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider w-32">
                      Client
                    </th>
                    <th className="px-6 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider w-24">
                      Methodology
                    </th>
                    <th className="px-6 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider w-20">
                      Transcripts
                    </th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-200">
                  {displayProjects.map(project => {
                    const projectTranscripts = transcripts[project.id] || [];
                    return (
                      <tr
                        key={project.id}
                        className="hover:bg-gray-50 cursor-pointer transition-colors"
                        onClick={() => setSelectedProject(project)}
                      >
                        <td className="pl-6 pr-2 py-4 whitespace-nowrap w-0">
                          <div className="inline-block text-sm font-medium text-gray-900">{project.name}</div>
                        </td>
                        <td className="pl-2 pr-6 py-4 whitespace-nowrap w-32">
                          <div className="text-sm text-gray-900 truncate">{project.client || '-'}</div>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-center w-24">
                          <div className="text-sm text-gray-900">{project.methodologyType || '-'}</div>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-center w-20">
                          <div className="flex items-center justify-center gap-1 text-sm text-gray-900">
                            <IconScript className="h-4 w-4 text-gray-400" />
                            {projectTranscripts.length}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </main>
  );
}
