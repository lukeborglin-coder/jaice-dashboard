import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  DocumentTextIcon,
  CloudArrowUpIcon,
  ArrowDownTrayIcon,
  TrashIcon,
  ArrowLeftIcon,
  CheckCircleIcon,
  ExclamationTriangleIcon
} from '@heroicons/react/24/outline';
import { IconScript } from '@tabler/icons-react';
import { API_BASE_URL } from '../config';
import { useAuth } from '../contexts/AuthContext';
import { normalizeTranscriptList, normalizeAnalysisRespnos, buildTranscriptDisplayName } from '../utils/respnoUtils';

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

// Function to detect duplicate interview dates/times
const findDuplicateInterviewTimes = (transcripts: Transcript[]) => {
  const timeMap = new Map<string, Transcript[]>();
  
  transcripts.forEach(transcript => {
    const date = transcript.interviewDate || '';
    const time = transcript.interviewTime || '';
    const key = `${date}|${time}`;
    
    if (date && time) {
      if (!timeMap.has(key)) {
        timeMap.set(key, []);
      }
      timeMap.get(key)!.push(transcript);
    }
  });
  
  const duplicates = new Set<string>();
  timeMap.forEach((transcripts, key) => {
    if (transcripts.length > 1) {
      transcripts.forEach(transcript => {
        duplicates.add(transcript.id);
      });
    }
  });
  
  return duplicates;
};

const normalizeTranscriptMapByProject = (data: Record<string, Transcript[]> | null | undefined): ProjectTranscripts => {
  if (!data || typeof data !== 'object') {
    return {};
  }

  const normalized: ProjectTranscripts = {};

  Object.entries(data).forEach(([projectId, list]) => {
    if (Array.isArray(list)) {
      const { orderedAsc } = normalizeTranscriptList(list as Transcript[]);
      normalized[projectId] = orderedAsc;
    } else {
      normalized[projectId] = [];
    }
  });

  return normalized;
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

interface TranscriptsProps {
  onNavigate?: (route: string) => void;
  setAnalysisToLoad?: (analysisId: string | null) => void;
}

export default function Transcripts({ onNavigate, setAnalysisToLoad }: TranscriptsProps) {
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
  const [pendingProjectNavigation, setPendingProjectNavigation] = useState<string | null>(null);
  const [parsedDateTime, setParsedDateTime] = useState<{ date: string; time: string } | null>(null);
  const [duplicateWarning, setDuplicateWarning] = useState<boolean>(false);
  const [uploadStep, setUploadStep] = useState<'select' | 'options'>('select');
  const [isParsingFile, setIsParsingFile] = useState(false);

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
    const token = localStorage.getItem('cognitive_dash_token');
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

  const loadTranscripts = async (): Promise<ProjectTranscripts | null> => {
    try {
      const response = await fetch(`${API_BASE_URL}/api/transcripts/all`, {
        headers: getAuthHeaders()
      });
      if (response.ok) {
        const data = await response.json();
        const normalized = normalizeTranscriptMapByProject(data || {});
        setTranscripts(normalized);
        return normalized;
      } else {
        console.error('Failed to load transcripts', await response.text());
        setTranscripts({});
      }
    } catch (error) {
      console.error('Failed to load transcripts:', error);
      setTranscripts({});
    }
    return null;
  };

  const loadSavedAnalyses = async (
    transcriptMapOverride?: ProjectTranscripts
  ): Promise<any[] | null> => {
    try {
      console.log('🔄 Loading saved analyses...');
      const response = await fetch(`${API_BASE_URL}/api/caX/saved`, {
        headers: getAuthHeaders()
      });
      if (response.ok) {
        const data = await response.json();
        console.log('📊 Raw saved analyses data:', data);
        const currentTranscriptsMap = transcriptMapOverride || transcripts;
        const normalizedAnalyses = Array.isArray(data)
          ? await Promise.all(data.map(async (analysis: any) => {
              // Load project transcripts for this specific analysis
              let projectTranscripts = currentTranscriptsMap[analysis.projectId] || [];
              
              // If we don't have transcripts for this project, fetch them
              if (projectTranscripts.length === 0 && analysis.projectId) {
                try {
                  const transcriptResponse = await fetch(`${API_BASE_URL}/api/transcripts/all`, {
                    headers: getAuthHeaders()
                  });
                  if (transcriptResponse.ok) {
                    const transcriptData = await transcriptResponse.json();
                    const projectTranscriptsData = Array.isArray(transcriptData?.[analysis.projectId]) ? transcriptData[analysis.projectId] : [];
                    projectTranscripts = projectTranscriptsData.map((item: any) => ({
                      id: item.id,
                      respno: item.respno,
                      interviewDate: item.interviewDate || item['Interview Date'] || null,
                      interviewTime: item.interviewTime || item['Interview Time'] || null
                    }));
                  }
                } catch (error) {
                  console.error('Failed to load project transcripts for normalization:', error);
                }
              }
              
              const normalized = normalizeAnalysisRespnos(analysis, projectTranscripts);
              console.log('🔍 Normalizing analysis in transcripts view:', {
                analysisId: analysis.id,
                projectId: analysis.projectId,
                projectTranscriptsCount: projectTranscripts.length,
                demographicsBefore: analysis?.data?.Demographics?.map((r: any) => ({
                  respno: r['Respondent ID'] || r['respno'],
                  date: r['Interview Date'] || r['Date'],
                  time: r['Interview Time'] || r['Time']
                })),
                demographicsAfter: normalized?.data?.Demographics?.map((r: any) => ({
                  respno: r['Respondent ID'] || r['respno'],
                  date: r['Interview Date'] || r['Date'],
                  time: r['Interview Time'] || r['Time']
                }))
              });
              return normalized;
            }))
          : [];
        console.log('📊 Normalized saved analyses:', normalizedAnalyses);
        setSavedAnalyses(normalizedAnalyses);
        return normalizedAnalyses;
      } else {
        console.error('Failed to load saved analyses', await response.text());
        setSavedAnalyses([]);
      }
    } catch (error) {
      console.error('Failed to load saved analyses:', error);
      setSavedAnalyses([]);
    }
    return null;
  };

  const isTranscriptInAnalysis = (transcriptId: string): boolean => {
    const transcript = transcripts[selectedProject?.id || '']?.find(t => t.id === transcriptId);
    const respno = transcript?.respno;
    
    // ONLY check analyses that belong to the current project
    const projectAnalyses = savedAnalyses.filter(analysis => analysis.projectId === selectedProject?.id);
    
    const result = projectAnalyses.some(analysis => {
      // ONLY consider it added if there's actual analysis data with the respno
      if (analysis.data && respno) {
        let foundInData = false;
        Object.entries(analysis.data).forEach(([sheetName, sheetData]) => {
          if (Array.isArray(sheetData)) {
            const hasRespno = sheetData.some((row: any) => 
              row.respno === respno || row['Respondent ID'] === respno
            );
            if (hasRespno) {
              foundInData = true;
            }
          }
        });
        if (foundInData) {
          return true;
        }
      }
      
      // If no data found, don't consider it added even if it's in transcripts array
      return false;
    });
    
    return result;
  };

  const getCANameForProject = (projectId: string): string | null => {
    const analysis = savedAnalyses.find(a => a.projectId === projectId);
    return analysis ? analysis.name : null;
  };

  const handleNavigateToCA = (transcriptId: string) => {
    if (!selectedProject || !onNavigate || !setAnalysisToLoad) return;
    
    // Find the analysis that contains this transcript
    const analysis = savedAnalyses.find(a => a.projectId === selectedProject.id);
    if (analysis) {
      console.log('🔄 Navigating to Content Analysis for transcript:', transcriptId, 'analysis:', analysis.id);
      // Set the specific analysis to load
      setAnalysisToLoad(analysis.id);
      // Navigate to Content Analysis
      onNavigate('Content Analysis');
    } else {
      console.log('❌ No analysis found for project:', selectedProject.id);
      alert('No content analysis found for this project. Please create a content analysis first.');
    }
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
    (async () => {
      const normalized = await loadTranscripts();
      await loadSavedAnalyses(normalized || undefined);
    })();
  }, [showMyProjectsOnly]);

  // Always refresh saved analyses when component mounts (ensures fresh CA status)
  useEffect(() => {
    console.log('🔄 Component mounted, refreshing saved analyses');
    loadSavedAnalyses();
  }, []);

  // Refresh saved analyses every time the component mounts or project changes
  useEffect(() => {
    if (selectedProject) {
      console.log('🔄 Refreshing saved analyses for project:', selectedProject.id);
      loadSavedAnalyses();
    }
  }, [selectedProject?.id]);

  // Also refresh when component becomes visible (additional safety)
  useEffect(() => {
    const handleVisibilityChange = () => {
      if (!document.hidden && selectedProject) {
        console.log('🔄 Refreshing saved analyses on visibility change');
        loadSavedAnalyses();
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [selectedProject]);

  useEffect(() => {
    if (pendingProjectNavigation === null) {
      try {
        const stored = sessionStorage.getItem('cognitive_dash_transcripts_focus_project');
        if (stored) {
          setPendingProjectNavigation(stored);
        }
      } catch (error) {
        console.warn('Unable to read transcripts navigation target', error);
      }
    }
  }, [pendingProjectNavigation]);

  useEffect(() => {
    if (!pendingProjectNavigation) return;

    const combinedProjects = [...projects, ...archivedProjects];
    const targetProject = combinedProjects.find(project => project.id === pendingProjectNavigation);

    if (!targetProject) {
      return;
    }

    if (targetProject.archived) {
      setActiveTab('archived');
    } else {
      setActiveTab('active');
    }

    setSelectedProject(targetProject);

    try {
      sessionStorage.removeItem('cognitive_dash_transcripts_focus_project');
    } catch (error) {
      console.warn('Unable to clear transcripts navigation target', error);
    }

    setPendingProjectNavigation(null);
  }, [pendingProjectNavigation, projects, archivedProjects]);

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

  const handleFileSelect = async (file: File | null) => {
    console.log('handleFileSelect called with file:', file?.name);

    if (!file || !selectedProject) {
      setUploadFile(null);
      setParsedDateTime(null);
      setDuplicateWarning(false);
      setUploadStep('select');
      setIsParsingFile(false);
      return;
    }

    console.log('Starting file parsing...');
    setUploadFile(file);
    setIsParsingFile(true);
    setParsedDateTime(null);
    setDuplicateWarning(false);
    setUploadStep('select'); // Still on select step while parsing

    // Parse date/time from the file
    try {
      const formData = new FormData();
      formData.append('file', file);

      console.log('Fetching /api/transcripts/parse-datetime...');
      const response = await fetch('/api/transcripts/parse-datetime', {
        method: 'POST',
        headers: getAuthHeaders(),
        body: formData
      });

      console.log('Response status:', response.status);

      if (response.ok) {
        const data = await response.json();
        setParsedDateTime(data);

        // Check for duplicate
        const projectTranscripts = transcripts[selectedProject.id] || [];
        const isDuplicate = projectTranscripts.some(t =>
          t.interviewDate === data.date && t.interviewTime === data.time
        );
        setDuplicateWarning(isDuplicate);

        // Move to options step
        setUploadStep('options');

        // Auto-select CA if only one exists
        if (analysesForSelectedProject.length === 1) {
          setSelectedAnalysisId(analysesForSelectedProject[0].id);
        }
      } else {
        // If parsing fails, still allow upload
        setUploadStep('options');
      }
    } catch (error) {
      console.error('Error parsing date/time:', error);
      // Still allow upload even if parsing fails
      setUploadStep('options');
    } finally {
      setIsParsingFile(false);
    }
  };

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
        const normalized = await loadTranscripts();
        await loadSavedAnalyses(normalized || undefined);

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
      const fallbackFileName =
        transcript.isCleaned && transcript.cleanedFilename
          ? transcript.cleanedFilename
          : transcript.originalFilename;

      const downloadName = buildTranscriptDisplayName({
        projectName: selectedProject.name,
        respno: transcript.respno,
        interviewDate: transcript.interviewDate,
        interviewTime: transcript.interviewTime,
        fallbackFilename: fallbackFileName
      });

      const response = await fetch(
        `${API_BASE_URL}/api/transcripts/download/${selectedProject.id}/${transcript.id}`,
        { headers: getAuthHeaders() }
      );

      if (response.ok) {
        const blob = await response.blob();
        const url = window.URL.createObjectURL(blob);
        const anchor = document.createElement('a');
        anchor.href = url;
        anchor.download = downloadName || fallbackFileName || 'transcript.txt';
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
        const normalized = await loadTranscripts();
        await loadSavedAnalyses(normalized || undefined);
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
    const duplicateIds = findDuplicateInterviewTimes(projectTranscripts);

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
                      <th className="px-3 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider w-28 whitespace-nowrap">
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
                      const displayName = buildTranscriptDisplayName({
                        projectName: selectedProject?.name,
                        respno: transcript.respno,
                        interviewDate: transcript.interviewDate,
                        interviewTime: transcript.interviewTime,
                        fallbackFilename: transcript.originalFilename
                      });

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
                            <div className={`text-sm flex items-center justify-center gap-1 ${
                              duplicateIds.has(transcript.id) ? 'text-red-600' : 'text-gray-900'
                            }`}>
                              {transcript.interviewDate || '-'}
                              {duplicateIds.has(transcript.id) && (
                                <ExclamationTriangleIcon className="h-4 w-4 text-red-600" />
                              )}
                            </div>
                          </td>
                          <td className="px-3 py-4 whitespace-nowrap text-center">
                            <div className={`text-sm flex items-center justify-center gap-1 ${
                              duplicateIds.has(transcript.id) ? 'text-red-600' : 'text-gray-900'
                            }`}>
                              {transcript.interviewTime || '-'}
                              {duplicateIds.has(transcript.id) && (
                                <ExclamationTriangleIcon className="h-4 w-4 text-red-600" />
                              )}
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
                              <button
                                onClick={() => handleNavigateToCA(transcript.id)}
                                className="text-green-600 hover:text-green-800 p-1 rounded-lg hover:bg-green-50 mx-auto transition-colors"
                                title="Click to view in Content Analysis"
                              >
                                <CheckCircleIcon className="h-5 w-5" />
                              </button>
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
                    {/* Step 1: File Selection */}
                    <div>
                      <label className="mb-2 block text-sm font-medium text-gray-700">
                        Select transcript file
                      </label>
                      <input
                        type="file"
                        accept=".docx,.txt"
                        onChange={e =>
                          handleFileSelect(e.target.files?.[0] || null)
                        }
                        className="block w-full cursor-pointer rounded-lg border border-gray-300 bg-gray-50 text-sm text-gray-900 focus:outline-none file:mr-4 file:py-2 file:px-4 file:rounded-l-lg file:border-0 file:text-sm file:font-medium file:bg-orange-50 file:text-orange-700 hover:file:bg-orange-100"
                      />
                      <p className="mt-2 text-xs text-gray-500">
                        Supported formats: .docx and .txt
                      </p>
                    </div>

                    {/* Parsing Loading State */}
                    {isParsingFile && uploadFile && (
                      <div className="bg-gray-50 border border-gray-200 rounded-lg p-4">
                        <div className="flex items-center gap-3">
                          <div
                            className="h-5 w-5 animate-spin rounded-full border-2 border-gray-300"
                            style={{ borderTopColor: BRAND_ORANGE }}
                          ></div>
                          <p className="text-sm text-gray-600">Parsing interview date and time...</p>
                        </div>
                      </div>
                    )}

                    {/* Step 2: Show parsed date/time and options */}
                    {uploadStep === 'options' && uploadFile && !isParsingFile && (
                      <>
                        {/* Parsed Date/Time Display */}
                        {parsedDateTime && (
                          <div className="bg-blue-50 border border-blue-200 rounded-lg p-3">
                            <h4 className="text-sm font-medium text-blue-900 mb-2">Detected Interview Information:</h4>
                            <div className="text-sm text-blue-800">
                              <p><strong>Date:</strong> {parsedDateTime.date}</p>
                              <p><strong>Time:</strong> {parsedDateTime.time}</p>
                            </div>
                          </div>
                        )}

                        {/* Duplicate Warning */}
                        {duplicateWarning && (
                          <div className="bg-yellow-50 border border-yellow-400 rounded-lg p-3">
                            <div className="flex items-start gap-2">
                              <svg className="h-5 w-5 text-yellow-600 flex-shrink-0 mt-0.5" fill="currentColor" viewBox="0 0 20 20">
                                <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
                              </svg>
                              <div>
                                <h4 className="text-sm font-medium text-yellow-800">Possible Duplicate</h4>
                                <p className="text-xs text-yellow-700 mt-1">
                                  A transcript with the same interview date and time already exists in this project.
                                </p>
                              </div>
                            </div>
                          </div>
                        )}

                        {/* Clean Transcript Option */}
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

                        {/* Add to CA Option */}
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
                      </>
                    )}
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
                        setParsedDateTime(null);
                        setDuplicateWarning(false);
                        setUploadStep('select');
                        setIsParsingFile(false);
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
                  ? 'bg-white border border-gray-300 hover:bg-gray-50'
                  : 'text-white hover:opacity-90'
              }`}
              style={showMyProjectsOnly ? {} : { backgroundColor: BRAND_ORANGE }}
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
                Active Projects ({filteredActiveProjects.length})
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
                Archived Projects ({filteredArchivedProjects.length})
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
                        onClick={() => {
                          setSelectedProject(project);
                          console.log('🔄 Project clicked, refreshing saved analyses for:', project.id);
                          loadSavedAnalyses();
                        }}
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
