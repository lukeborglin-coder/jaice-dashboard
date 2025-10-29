import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  DocumentTextIcon,
  CloudArrowUpIcon,
  ArrowDownTrayIcon,
  TrashIcon,
  ArrowLeftIcon,
  CheckCircleIcon,
  ExclamationTriangleIcon,
  PencilIcon,
  MagnifyingGlassIcon
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
  const [viewMode, setViewMode] = useState<'home' | 'project' | 'transcripts-by-ca'>('home');
  const [selectedContentAnalysis, setSelectedContentAnalysis] = useState<any | null>(null);
  const [transcripts, setTranscripts] = useState<ProjectTranscripts>({});
  const [showUploadModal, setShowUploadModal] = useState(false);
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [cleanTranscript, setCleanTranscript] = useState(false);
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
  const [showSearchModal, setShowSearchModal] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<any[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [isParsingFile, setIsParsingFile] = useState(false);
  
  // Date/time editing state
  const [editingTranscriptId, setEditingTranscriptId] = useState<string | null>(null);
  const [editingField, setEditingField] = useState<'date' | 'time' | null>(null);
  const [editingValue, setEditingValue] = useState<string>('');
  const [isSavingDateTime, setIsSavingDateTime] = useState(false);

  // Date formatting utilities
  const formatDateToShort = (dateStr: string | undefined): string => {
    if (!dateStr) return '-';
    try {
      // Handle YYYY-MM-DD format directly to avoid timezone issues
      if (/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
        const [year, month, day] = dateStr.split('-').map(Number);
        const shortYear = year.toString().slice(-2);
        return `${month}/${day}/${shortYear}`;
      }
      
      // For other formats, try parsing with Date
      const date = new Date(dateStr);
      if (isNaN(date.getTime())) return dateStr; // Return original if can't parse
      
      const month = date.getMonth() + 1;
      const day = date.getDate();
      const year = date.getFullYear().toString().slice(-2);
      
      return `${month}/${day}/${year}`;
    } catch (error) {
      return dateStr; // Return original if parsing fails
    }
  };

  const validateShortDate = (dateStr: string): boolean => {
    // Check if it matches MM/DD/YY or M/D/YY format
    const shortDateRegex = /^\d{1,2}\/\d{1,2}\/\d{2}$/;
    if (!shortDateRegex.test(dateStr)) return false;
    
    const [month, day, year] = dateStr.split('/').map(Number);
    const fullYear = year < 50 ? 2000 + year : 1900 + year;
    
    // Validate the date
    const date = new Date(fullYear, month - 1, day);
    return date.getFullYear() === fullYear && 
           date.getMonth() === month - 1 && 
           date.getDate() === day;
  };

  const formatTimeToStandard = (timeStr: string | undefined): string => {
    if (!timeStr) return '-';
    try {
      // If it's already in the correct format, return it
      if (/^\d{1,2}:\d{2}\s*(AM|PM)$/i.test(timeStr)) {
        return timeStr.toUpperCase();
      }
      
      // Try to parse various time formats and convert to standard
      const time = new Date(`2000-01-01 ${timeStr}`);
      if (isNaN(time.getTime())) return timeStr; // Return original if can't parse
      
      const hours = time.getHours();
      const minutes = time.getMinutes();
      const ampm = hours >= 12 ? 'PM' : 'AM';
      const displayHours = hours % 12 || 12;
      const displayMinutes = minutes.toString().padStart(2, '0');
      
      return `${displayHours}:${displayMinutes} ${ampm}`;
    } catch (error) {
      return timeStr; // Return original if parsing fails
    }
  };

  const validateTimeFormat = (timeStr: string): boolean => {
    // Check if it matches HH:MM AM/PM format
    const timeRegex = /^\d{1,2}:\d{2}\s*(AM|PM)$/i;
    if (!timeRegex.test(timeStr)) return false;
    
    const [timePart, ampm] = timeStr.split(/\s+/);
    const [hours, minutes] = timePart.split(':').map(Number);
    
    // Validate hours (1-12) and minutes (0-59)
    return hours >= 1 && hours <= 12 && minutes >= 0 && minutes <= 59;
  };

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
        
        // Note: Content analysis ordering is now handled on-demand
        // when transcripts are added to CA or when specifically needed
        
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
    // ONLY check analyses that belong to the current project
    const projectAnalyses = savedAnalyses.filter(analysis => analysis.projectId === selectedProject?.id);

    console.log('🔍 isTranscriptInAnalysis called for transcriptId:', transcriptId);
    console.log('🔍 Project analyses found:', projectAnalyses.length);
    console.log('🔍 Current project:', selectedProject?.id);

    const result = projectAnalyses.some(analysis => {
      // Check if the transcript ID exists in any CA row (not respno, which can change)
      if (analysis.data) {
        let foundInData = false;
        
        // First check Demographics sheet specifically (where transcriptId is stored)
        if (analysis.data.Demographics && Array.isArray(analysis.data.Demographics)) {
          console.log('🔍 Checking Demographics sheet for transcriptId:', transcriptId);
          console.log('🔍 Demographics rows:', analysis.data.Demographics.map((r: any) => ({ transcriptId: r.transcriptId, respno: r['Respondent ID'] })));
          
          const hasTranscript = analysis.data.Demographics.some((row: any) =>
            row.transcriptId === transcriptId
          );
          if (hasTranscript) {
            console.log('✅ Found transcript in Demographics sheet');
            foundInData = true;
          }
        }
        
        // If not found in Demographics, check other sheets as fallback
        if (!foundInData) {
          Object.entries(analysis.data).forEach(([sheetName, sheetData]) => {
            if (Array.isArray(sheetData)) {
              // Check by transcript ID first (preferred method)
              const hasTranscript = sheetData.some((row: any) =>
                row.transcriptId === transcriptId
              );
              if (hasTranscript) {
                console.log(`✅ Found transcript in ${sheetName} sheet`);
                foundInData = true;
              }
            }
          });
        }
        
        if (foundInData) {
          return true;
        }
      }

      // If no data found, don't consider it added
      return false;
    });

    console.log('🔍 isTranscriptInAnalysis result:', result);
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

  // Get transcripts that belong to a specific content analysis
  const getTranscriptsForAnalysis = useCallback((analysis: any, projectTranscripts: Transcript[]): Transcript[] => {
    if (!analysis || !analysis.data) return [];
    
    const transcriptIds = new Set<string>();
    
    // Collect all transcript IDs from the analysis data
    Object.values(analysis.data).forEach((sheetData: any) => {
      if (Array.isArray(sheetData)) {
        sheetData.forEach((row: any) => {
          if (row.transcriptId) {
            transcriptIds.add(row.transcriptId);
          }
        });
      }
    });
    
    // Also check the transcripts array in the analysis object
    if (analysis.transcripts && Array.isArray(analysis.transcripts)) {
      analysis.transcripts.forEach((t: any) => {
        if (t.id || t.sourceTranscriptId) {
          transcriptIds.add(t.id || t.sourceTranscriptId);
        }
      });
    }
    
    // Filter project transcripts to only include those in this analysis
    return projectTranscripts.filter(t => transcriptIds.has(t.id));
  }, []);


  const handleAddToCA = async (transcript: Transcript) => {
    if (!selectedProject) return;

    setIsAddingToCA(true);
    try {
      console.log('🔍 handleAddToCA called');
      console.log('🔍 selectedProject.id:', selectedProject.id);
      console.log('🔍 transcript.id:', transcript.id);
      console.log('🔍 savedAnalyses:', savedAnalyses.map(a => ({ id: a.id, projectId: a.projectId, name: a.name })));

      // Find the analysis for this project
      const analysis = savedAnalyses.find(a => a.projectId === selectedProject.id);

      if (!analysis) {
        console.log('❌ No analysis found for project:', selectedProject.id);
        alert('No Content Analysis found for this project. Please create one first.');
        setIsAddingToCA(false);
        setShowAddToCAModal(false);
        setSelectedTranscriptForCA(null);
        return;
      }

      console.log('✅ Found analysis:', { id: analysis.id, projectId: analysis.projectId, name: analysis.name });

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
        // Refresh the saved analyses to get the updated data
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

  const handleSearch = async () => {
    if (!selectedProject || !searchQuery.trim()) return;

    setIsSearching(true);
    setSearchResults([]);

    try {
      const results: any[] = [];
      const query = searchQuery.toLowerCase();
      const projectTranscripts = transcripts[selectedProject.id] || [];

      console.log(`🔎 Starting search for: "${searchQuery}"`);
      console.log(`📊 Searching through ${projectTranscripts.length} transcripts`);

      // Search through all transcripts for this project
      for (const transcript of projectTranscripts) {
        try {
          // Download the transcript content as plain text - prefer cleaned version if available
          const preferCleaned = transcript.isCleaned ? 'preferCleaned=true&' : '';
          console.log(`🔍 Searching transcript ${transcript.respno || transcript.id}, isCleaned: ${transcript.isCleaned}`);
          const response = await fetch(
            `${API_BASE_URL}/api/transcripts/download/${selectedProject.id}/${transcript.id}?${preferCleaned}asText=true`,
            { headers: getAuthHeaders() }
          );

          if (!response.ok) {
            console.log(`❌ Failed to download transcript ${transcript.respno || transcript.id}`);
            continue;
          }

          const text = await response.text();
          console.log(`📄 Downloaded ${text.length} characters from ${transcript.respno || transcript.id}`);

          // Log a sample of the transcript to see what we're searching
          const sampleLines = text.split('\n').slice(0, 10);
          console.log(`📝 First 10 lines of ${transcript.respno || transcript.id}:`, sampleLines);

          // Check if the search query exists anywhere in the full text (ignoring line breaks)
          const fullTextLower = text.toLowerCase();
          const queryInFullText = fullTextLower.includes(query);
          console.log(`🔍 Does "${searchQuery}" exist in full text (ignoring line breaks)? ${queryInFullText}`);

          const lines = text.split('\n');

          // Search through each line
          let matchCount = 0;
          for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            const lowerLine = line.toLowerCase();

            if (lowerLine.includes(query)) {
              matchCount++;
              // Found a match
              const contextBefore = i > 0 ? lines[i - 1].trim() : null;
              const contextAfter = i < lines.length - 1 ? lines[i + 1].trim() : null;

              // Create highlighted version of the matched line
              const regex = new RegExp(`(${searchQuery.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi');
              const highlightedText = line.replace(regex, '<mark style="background-color: #FEF3C7; font-weight: 600;">$1</mark>');

              results.push({
                respno: transcript.respno,
                interviewDate: transcript.interviewDate,
                interviewTime: transcript.interviewTime,
                matchedLine: line.trim(),
                highlightedText,
                contextBefore,
                contextAfter,
                transcriptId: transcript.id
              });
            }
          }
          console.log(`✅ Found ${matchCount} matches in ${transcript.respno || transcript.id}`);
        } catch (error) {
          console.error(`Error searching transcript ${transcript.id}:`, error);
        }
      }

      console.log(`🎯 Search complete: ${results.length} total matches found`);
      setSearchResults(results);
    } catch (error) {
      console.error('Search error:', error);
      alert('Failed to search transcripts');
    } finally {
      setIsSearching(false);
    }
  };

  // Helper function to format search result text - keeps "Respondent:" bold but removes bolding from actual text
  const formatSearchResultText = (htmlText: string) => {
    // Check if text starts with "Respondent:" (case insensitive)
    // We need to handle this carefully since htmlText may contain HTML tags like <mark>
    // First, check if "Respondent:" is already wrapped in <strong>
    if (htmlText.match(/^<strong>Respondent:/i)) {
      // Already formatted, return as is
      return htmlText;
    }
    
    // Try to match "Respondent:" at the start (may be followed by space or directly by HTML)
    const respondentMatch = htmlText.match(/^(Respondent:\s*)(.*)$/i);
    if (respondentMatch) {
      // Wrap "Respondent: " in <strong>, rest stays normal (may contain <mark> tags)
      return `<strong>${respondentMatch[1]}</strong>${respondentMatch[2]}`;
    }
    
    // If no "Respondent:" prefix, return as is
    return htmlText;
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

  // Refresh saved analyses and transcripts every time the component mounts or project changes
  useEffect(() => {
    if (selectedProject) {
      console.log('🔄 Refreshing saved analyses and transcripts for project:', selectedProject.id);
      loadSavedAnalyses();
      loadTranscripts();
    }
  }, [selectedProject?.id]);

  // Also refresh when component becomes visible (additional safety)
  useEffect(() => {
    const handleVisibilityChange = () => {
      if (!document.hidden) {
        console.log('🔄 Refreshing saved analyses and transcripts on visibility change');
        loadSavedAnalyses();
        loadTranscripts();
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, []);

  // Refresh transcripts when returning to home view to ensure accurate counts
  useEffect(() => {
    if (viewMode === 'home') {
      console.log('🔄 Refreshing transcripts for accurate counts on home view');
      loadTranscripts();
    }
  }, [viewMode]);

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
      const response = await fetch(`${API_BASE_URL}/api/transcripts/parse-datetime`, {
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


        setShowUploadModal(false);
        setUploadFile(null);
        setCleanTranscript(false);
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

  // Date/time editing functions
  const handleStartEditing = (transcriptId: string, field: 'date' | 'time', currentValue: string) => {
    setEditingTranscriptId(transcriptId);
    setEditingField(field);
    setEditingValue(currentValue || '');
  };

  const handleCancelEditing = () => {
    setEditingTranscriptId(null);
    setEditingField(null);
    setEditingValue('');
  };

  const handleSaveDateTime = async (transcriptId: string, field: 'date' | 'time', newValue: string) => {
    if (!selectedProject || !newValue.trim()) return;

    // Validate date format if it's a date field
    if (field === 'date' && !validateShortDate(newValue.trim())) {
      alert('Please enter date in MM/DD/YY format (e.g., 8/21/25)');
      return;
    }

    // Validate time format if it's a time field
    if (field === 'time' && !validateTimeFormat(newValue.trim())) {
      alert('Please enter time in HH:MM AM/PM format (e.g., 2:30 PM)');
      return;
    }

    setIsSavingDateTime(true);
    try {
      // Update the transcript in the database
      const response = await fetch(
        `${API_BASE_URL}/api/transcripts/${selectedProject.id}/${transcriptId}/datetime`,
        {
          method: 'PUT',
          headers: {
            ...getAuthHeaders(),
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            field: field,
            value: newValue.trim()
          })
        }
      );

      if (response.ok) {
        // Reload transcripts to get updated data
        const updatedTranscripts = await loadTranscripts();

        // Reload saved analyses to get current CA data
        await loadSavedAnalyses();

        // Update content analysis if this transcript is in an analysis
        await updateContentAnalysisDateTime(transcriptId, field, newValue.trim());

        // Update content analysis ordering with the backend-sorted transcripts
        if (selectedProject && updatedTranscripts) {
          const projectTranscripts = updatedTranscripts[selectedProject.id] || [];
          await updateContentAnalysisOrdering(selectedProject.id, projectTranscripts);
        }

        handleCancelEditing();
      } else {
        const error = await response.json();
        alert(`Failed to update ${field}: ${error.error || 'Unknown error'}`);
      }
    } catch (error) {
      console.error(`Failed to update ${field}:`, error);
      alert(`Failed to update ${field}`);
    } finally {
      setIsSavingDateTime(false);
    }
  };

  const updateContentAnalysisDateTime = async (transcriptId: string, field: 'date' | 'time', newValue: string) => {
    try {
      // Update all saved analyses that contain this transcript
      for (const analysis of savedAnalyses) {
        if (analysis.data?.Demographics) {
          const demographics = analysis.data.Demographics;
          // Find row by transcriptId instead of respno (respno changes when date changes)
          const rowIndex = demographics.findIndex((row: any) =>
            row.transcriptId === transcriptId
          );

          if (rowIndex !== -1) {
            const columnName = field === 'date' ? 'Interview Date' : 'Interview Time';
            demographics[rowIndex][columnName] = newValue;
            
            // Save the updated analysis
            await fetch(`${API_BASE_URL}/api/caX/saved/${analysis.id}`, {
              method: 'PUT',
              headers: {
                ...getAuthHeaders(),
                'Content-Type': 'application/json'
              },
              body: JSON.stringify(analysis)
            });
          }
        }
      }
    } catch (error) {
      console.error('Failed to update content analysis:', error);
    }
  };


  const updateContentAnalysisOrdering = async (projectId: string, sortedTranscripts: Transcript[]) => {
    try {
      console.log('🔄 updateContentAnalysisOrdering called for project:', projectId);
      console.log('Sorted transcripts:', sortedTranscripts.map(t => ({ id: t.id, respno: t.respno, date: t.interviewDate })));

      // CRITICAL: Only update analyses that belong to the specified project
      const projectAnalyses = savedAnalyses.filter(analysis => analysis.projectId === projectId);
      console.log('🔍 Project analyses found:', projectAnalyses.length);
      console.log('🔍 Project analyses:', projectAnalyses.map(a => ({ id: a.id, projectId: a.projectId, name: a.name })));

      // Update only the analyses for this specific project
      for (const analysis of projectAnalyses) {
        if (analysis.data?.Demographics && analysis.data.Demographics.length > 0) {
          const demographics = analysis.data.Demographics;
          console.log('Current demographics before update:', demographics.map((r: any) => ({ transcriptId: r.transcriptId, respno: r['Respondent ID'], date: r['Interview Date'] })));

          // Create a map of transcriptId to new respno
          const transcriptIdToRespno = new Map();
          sortedTranscripts.forEach((transcript) => {
            if (transcript.id && transcript.respno) {
              transcriptIdToRespno.set(transcript.id, transcript.respno);
            }
          });
          console.log('TranscriptId to Respno mapping:', Array.from(transcriptIdToRespno.entries()));

          // Update respnos in all demographics rows based on transcriptId
          const updatedDemographics = demographics.map((row: any) => {
            if (row.transcriptId) {
              const newRespno = transcriptIdToRespno.get(row.transcriptId);
              console.log(`Row ${row.transcriptId}: old respno=${row['Respondent ID']}, new respno=${newRespno}`);
              if (newRespno) {
                return {
                  ...row,
                  'Respondent ID': newRespno,
                  respno: newRespno
                };
              }
            }
            return row;
          });

          // Sort demographics by the new respno order
          updatedDemographics.sort((a: any, b: any) => {
            const respnoA = a['Respondent ID'] || a['respno'];
            const respnoB = b['Respondent ID'] || b['respno'];
            const numA = parseInt(respnoA?.replace(/\D/g, '') || '999');
            const numB = parseInt(respnoB?.replace(/\D/g, '') || '999');
            return numA - numB;
          });

          // Update the analysis with updated demographics
          const updatedAnalysis = {
            ...analysis,
            data: {
              ...analysis.data,
              Demographics: updatedDemographics
            }
          };

          // Save the updated analysis using the correct endpoint
          const response = await fetch(`${API_BASE_URL}/api/caX/update`, {
            method: 'PUT',
            headers: {
              ...getAuthHeaders(),
              'Content-Type': 'application/json'
            },
            body: JSON.stringify(updatedAnalysis)
          });
          
          if (response.ok) {
            console.log('✅ Successfully updated content analysis ordering for analysis:', analysis.id);
            console.log('Updated demographics after reordering:', updatedDemographics.map((r: any) => ({ transcriptId: r.transcriptId, respno: r['Respondent ID'], date: r['Interview Date'] })));
          } else {
            console.error('❌ Failed to update content analysis ordering:', await response.text());
          }
        }
      }
    } catch (error) {
      console.error('Failed to update content analysis ordering:', error);
    }
  };

  // Project view - show list of content analyses
  if (selectedProject && viewMode === 'project') {
    const projectAnalyses = analysesForSelectedProject;

    return (
      <main
        className="flex-1 overflow-y-auto"
        style={{ backgroundColor: BRAND_BG, height: 'calc(100vh - 80px)', marginTop: '80px' }}
      >
        <div className="flex-1 p-6 space-y-6 max-w-full">
          <section className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex-1">
              <div className="flex items-center justify-between mb-2">
                <button
                  onClick={() => {
                    setSelectedProject(null);
                    setViewMode('home');
                    setSelectedContentAnalysis(null);
                  }}
                  className="inline-flex items-center gap-2 text-sm font-medium text-gray-600 hover:text-gray-900 transition"
                >
                  <ArrowLeftIcon className="h-4 w-4" />
                  Back to Projects
                </button>
              </div>
              <h2
                className="text-2xl font-bold"
                style={{ color: BRAND_GRAY }}
              >
                {selectedProject.name}
              </h2>
              <p className="mt-1 text-sm text-gray-500">
                {projectAnalyses.length}{' '}
                {projectAnalyses.length === 1 ? 'content analysis' : 'content analyses'}
                {selectedProject.archived && ' • Archived'}
              </p>
            </div>
          </section>

          <div className="bg-white shadow-sm border border-gray-200 rounded-lg overflow-hidden">
            {/* Content Analyses Table */}
            <div className="overflow-x-auto">
              {projectAnalyses.length === 0 ? (
                <div className="p-8 text-center">
                  <DocumentTextIcon className="h-12 w-12 text-gray-400 mx-auto mb-4" />
                  <h3 className="text-lg font-medium text-gray-900 mb-2">No Content Analyses</h3>
                  <p className="text-gray-600 mb-4">This project doesn't have any content analyses yet.</p>
                  <p className="text-sm text-gray-500">
                    Create a content analysis in the Content Analysis tab to organize transcripts by analysis.
                  </p>
                </div>
              ) : (
                <table className="min-w-full divide-y divide-gray-200">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                        Analysis Name
                      </th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                        Created
                      </th>
                      <th className="px-6 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider">
                        Transcripts
                      </th>
                      <th className="px-6 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider">
                        Actions
                      </th>
                    </tr>
                  </thead>
                  <tbody className="bg-white divide-y divide-gray-200">
                    {projectAnalyses.map((analysis) => {
                      const projectTranscripts = transcripts[selectedProject.id] || [];
                      const analysisTranscripts = getTranscriptsForAnalysis(analysis, projectTranscripts);
                      return (
                        <tr 
                          key={analysis.id} 
                          className="hover:bg-gray-50 cursor-pointer transition-colors"
                          onClick={() => {
                            setViewMode('transcripts-by-ca');
                            setSelectedContentAnalysis(analysis);
                          }}
                        >
                          <td className="px-6 py-4 whitespace-nowrap">
                            <div className="text-sm font-medium text-gray-900">{analysis.name || 'Untitled Analysis'}</div>
                            {analysis.description && (
                              <div className="text-sm text-gray-500 truncate max-w-xs">{analysis.description}</div>
                            )}
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                            {analysis.savedAt ? new Date(analysis.savedAt).toLocaleDateString() : (analysis.createdAt ? new Date(analysis.createdAt).toLocaleDateString() : '-')}
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap text-center">
                            <div className="flex items-center justify-center gap-1 text-sm text-gray-900">
                              <IconScript className="h-4 w-4 text-gray-400" />
                              {analysisTranscripts.length}
                            </div>
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap text-center">
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                setViewMode('transcripts-by-ca');
                                setSelectedContentAnalysis(analysis);
                              }}
                              className="text-blue-600 hover:text-blue-800 text-sm font-medium"
                            >
                              View Transcripts
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        </div>
      </main>
    );
  }

  // Transcripts view - show transcripts organized by content analysis
  // Only show transcripts if a content analysis is selected
  if (selectedProject && viewMode === 'transcripts-by-ca') {
    // If no content analysis is selected, redirect back to project view
    if (!selectedContentAnalysis) {
      return (
        <main
          className="flex-1 overflow-y-auto"
          style={{ backgroundColor: BRAND_BG, height: 'calc(100vh - 80px)', marginTop: '80px' }}
        >
          <div className="flex-1 p-6 space-y-6 max-w-full">
            <div className="text-center py-12">
              <p className="text-gray-600 mb-4">Please select a content analysis to view transcripts.</p>
              <button
                onClick={() => {
                  setViewMode('project');
                  setSelectedContentAnalysis(null);
                }}
                className="inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium text-white shadow-sm transition hover:opacity-90"
                style={{ backgroundColor: BRAND_ORANGE }}
              >
                <ArrowLeftIcon className="h-4 w-4" />
                Back to Content Analyses
              </button>
            </div>
          </div>
        </main>
      );
    }

    const projectTranscripts = transcripts[selectedProject.id] || [];
    // Backend now handles the sorting, so we use the transcripts as they come
    const duplicateIds = findDuplicateInterviewTimes(projectTranscripts);

    // Filter transcripts based on selected content analysis
    const displayedTranscripts = getTranscriptsForAnalysis(selectedContentAnalysis, projectTranscripts);

    return (
      <main
        className="flex-1 overflow-y-auto"
        style={{ backgroundColor: BRAND_BG, height: 'calc(100vh - 80px)', marginTop: '80px' }}
      >
        <div className="flex-1 p-6 space-y-6 max-w-full">
          <section className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
            <div className="flex-1">
              <div className="flex items-center justify-between mb-2">
              <button
                  onClick={() => {
                    setViewMode('project');
                    setSelectedContentAnalysis(null);
                  }}
                  className="inline-flex items-center gap-2 text-sm font-medium text-gray-600 hover:text-gray-900 transition"
              >
                <ArrowLeftIcon className="h-4 w-4" />
                Back to {selectedContentAnalysis.name || 'Content Analyses'}
              </button>
              </div>
              <h2
                className="text-2xl font-bold"
                style={{ color: BRAND_GRAY }}
              >
                {selectedProject.name}
              </h2>
              <p className="mt-1 text-sm text-gray-500">
                {displayedTranscripts.length} of {projectTranscripts.length}{' '}
                {displayedTranscripts.length === 1 ? 'transcript' : 'transcripts'} in {selectedContentAnalysis.name || 'this analysis'}
                {selectedProject.archived && ' • Archived'}
              </p>
            </div>
            <div className="flex items-center gap-2 self-end">
              <button
                onClick={() => setShowSearchModal(true)}
                className="inline-flex items-center justify-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium shadow-sm transition bg-white border border-gray-300 hover:bg-gray-50 text-gray-700"
              >
                <MagnifyingGlassIcon className="h-4 w-4" />
                Search
              </button>
              <button
                onClick={() => setShowUploadModal(true)}
                className="inline-flex items-center justify-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium text-white shadow-sm transition hover:opacity-90"
                style={{ backgroundColor: BRAND_ORANGE }}
              >
                <CloudArrowUpIcon className="h-4 w-4" />
                Upload
              </button>
            </div>
          </section>

          <div className="bg-white shadow-sm border border-gray-200 rounded-lg overflow-hidden">
            {displayedTranscripts.length === 0 ? (
              <div className="p-12 text-center">
                <DocumentTextIcon className="mx-auto mb-4 h-16 w-16 text-gray-300" />
                <h3 className="text-lg font-semibold text-gray-900">
                  {projectTranscripts.length === 0 
                    ? 'No transcripts yet'
                    : selectedContentAnalysis
                      ? `No transcripts in ${selectedContentAnalysis.name || 'this content analysis'}`
                      : 'No transcripts found'}
                </h3>
                <p className="mt-2 text-gray-500">
                  {projectTranscripts.length === 0 
                    ? 'Upload a transcript to get started.'
                    : selectedContentAnalysis
                      ? 'This content analysis doesn\'t have any transcripts yet. Add transcripts to this analysis from the Content Analysis tab.'
                      : 'No transcripts match the current filter.'}
                </p>
                {projectTranscripts.length === 0 && (
                <button
                  onClick={() => setShowUploadModal(true)}
                  className="mt-6 inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium text-white shadow-sm transition hover:opacity-90"
                  style={{ backgroundColor: BRAND_ORANGE }}
                >
                  <CloudArrowUpIcon className="h-5 w-5" />
                  Upload Transcript
                </button>
                )}
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
                    {displayedTranscripts.map(transcript => {
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
                              {editingTranscriptId === transcript.id && editingField === 'date' ? (
                                <div className="flex items-center gap-1">
                                  <input
                                    type="text"
                                    value={editingValue}
                                    onChange={(e) => setEditingValue(e.target.value)}
                                    onKeyDown={(e) => {
                                      if (e.key === 'Enter') {
                                        handleSaveDateTime(transcript.id, 'date', editingValue);
                                      } else if (e.key === 'Escape') {
                                        handleCancelEditing();
                                      }
                                    }}
                                    onBlur={() => handleSaveDateTime(transcript.id, 'date', editingValue)}
                                    className="text-sm border border-gray-300 rounded px-2 py-1 w-24 text-center"
                                    placeholder="MM/DD/YY"
                                    autoFocus
                                    disabled={isSavingDateTime}
                                  />
                                </div>
                              ) : (
                                <div className="flex items-center gap-1">
                                  <span>{formatDateToShort(transcript.interviewDate)}</span>
                                  <button
                                    onClick={() => handleStartEditing(transcript.id, 'date', formatDateToShort(transcript.interviewDate))}
                                    className="text-gray-400 hover:text-gray-600 p-0.5 rounded"
                                    title="Edit date (MM/DD/YY format)"
                                    disabled={isSavingDateTime}
                                  >
                                    <PencilIcon className="h-3 w-3" />
                                  </button>
                                  {duplicateIds.has(transcript.id) && (
                                    <ExclamationTriangleIcon className="h-4 w-4 text-red-600" />
                                  )}
                                </div>
                              )}
                            </div>
                          </td>
                          <td className="px-3 py-4 whitespace-nowrap text-center">
                            <div className={`text-sm flex items-center justify-center gap-1 ${
                              duplicateIds.has(transcript.id) ? 'text-red-600' : 'text-gray-900'
                            }`}>
                              {editingTranscriptId === transcript.id && editingField === 'time' ? (
                                <div className="flex items-center gap-1">
                                  <input
                                    type="text"
                                    value={editingValue}
                                    onChange={(e) => setEditingValue(e.target.value)}
                                    onKeyDown={(e) => {
                                      if (e.key === 'Enter') {
                                        handleSaveDateTime(transcript.id, 'time', editingValue);
                                      } else if (e.key === 'Escape') {
                                        handleCancelEditing();
                                      }
                                    }}
                                    onBlur={() => handleSaveDateTime(transcript.id, 'time', editingValue)}
                                    className="text-sm border border-gray-300 rounded px-2 py-1 w-24 text-center"
                                    placeholder="HH:MM AM/PM"
                                    autoFocus
                                    disabled={isSavingDateTime}
                                  />
                                </div>
                              ) : (
                                <div className="flex items-center gap-1">
                                  <span>{formatTimeToStandard(transcript.interviewTime)}</span>
                                  <button
                                    onClick={() => handleStartEditing(transcript.id, 'time', formatTimeToStandard(transcript.interviewTime))}
                                    className="text-gray-400 hover:text-gray-600 p-0.5 rounded"
                                    title="Edit time (HH:MM AM/PM format)"
                                    disabled={isSavingDateTime}
                                  >
                                    <PencilIcon className="h-3 w-3" />
                                  </button>
                                  {duplicateIds.has(transcript.id) && (
                                    <ExclamationTriangleIcon className="h-4 w-4 text-red-600" />
                                  )}
                                </div>
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
                        {cleanTranscript
                          ? 'Cleaning Transcript'
                          : 'Uploading Transcript'}
                      </h3>
                      <p className="mt-1 text-sm text-gray-500">
                        This may take a moment...
                      </p>
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
                        </div>

                      </>
                    )}
                  </div>
                )}
              </div>

              {!isProcessing && (
                <div className="flex items-center justify-between border-t border-gray-200 px-6 py-4">
                  <div>
                  </div>
                  <div className="flex gap-3">
                    <button
                      onClick={() => {
                        setShowUploadModal(false);
                        setUploadFile(null);
                        setCleanTranscript(false);
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

        {/* Search Modal */}
        {showSearchModal && (
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-[99999] p-4">
            <div className="bg-white rounded-lg w-full max-w-4xl max-h-[85vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
              <div className="flex items-center justify-between p-6 border-b border-gray-200">
                <h3 className="text-lg font-semibold text-gray-900">Search Transcripts</h3>
                <button
                  onClick={() => {
                    setShowSearchModal(false);
                    setSearchQuery('');
                    setSearchResults([]);
                  }}
                  className="text-gray-400 hover:text-gray-600 transition-colors"
                >
                  <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>

              <div className="p-6 space-y-4">
                <div className="relative">
                  <input
                    type="text"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && searchQuery.trim()) {
                        handleSearch();
                      }
                    }}
                    placeholder="Enter a quote or phrase to search..."
                    className="w-full border border-gray-300 rounded-lg px-4 py-3 pr-12 text-sm focus:outline-none focus:ring-2 focus:ring-orange-500"
                  />
                  <button
                    onClick={handleSearch}
                    disabled={!searchQuery.trim() || isSearching}
                    className="absolute right-2 top-1/2 -translate-y-1/2 p-2 rounded-md transition disabled:opacity-50 disabled:cursor-not-allowed hover:bg-gray-100"
                    style={{ color: BRAND_ORANGE }}
                  >
                    <MagnifyingGlassIcon className="h-5 w-5" />
                  </button>
                </div>

                {isSearching && (
                  <div className="text-center py-8">
                    <div className="mx-auto mb-4 h-10 w-10 animate-spin rounded-full border-4 border-gray-200" style={{ borderTopColor: BRAND_ORANGE }}></div>
                    <p className="text-sm text-gray-500">Searching transcripts...</p>
                  </div>
                )}

                {!isSearching && searchResults.length === 0 && searchQuery && (
                  <div className="text-center py-8">
                    <DocumentTextIcon className="mx-auto mb-4 h-16 w-16 text-gray-300" />
                    <h3 className="text-lg font-semibold text-gray-900 mb-2">No matches found</h3>
                    <p className="text-sm text-gray-500">Try searching with different keywords</p>
                  </div>
                )}

                {!isSearching && searchResults.length > 0 && (
                  <div className="space-y-4 overflow-y-auto max-h-[50vh]">
                    <p className="text-sm text-gray-600">Found {searchResults.length} {searchResults.length === 1 ? 'match' : 'matches'}</p>
                    {searchResults.map((result, index) => (
                      <div key={index} className="border border-gray-200 rounded-lg p-4 space-y-2 hover:bg-gray-50 transition-colors">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-3">
                            <span className="inline-flex items-center rounded-md bg-blue-100 px-2 py-0.5 text-xs font-semibold text-blue-700">
                              {result.respno || 'No Respno'}
                            </span>
                            {result.interviewDate && (
                              <span className="text-xs text-gray-500">{result.interviewDate}</span>
                            )}
                            {result.interviewTime && (
                              <span className="text-xs text-gray-500">{result.interviewTime}</span>
                            )}
                          </div>
                        </div>

                        {/* Context: Line before */}
                        {result.contextBefore && (
                          <div className="text-sm text-gray-500 italic pl-4 border-l-2 border-gray-200">
                            {result.contextBefore}
                          </div>
                        )}

                        {/* Matched line with highlighting */}
                        <div className="text-sm text-gray-900 pl-4 border-l-2" style={{ borderColor: BRAND_ORANGE }}>
                          <span dangerouslySetInnerHTML={{ __html: formatSearchResultText(result.highlightedText) }} />
                        </div>

                        {/* Context: Line after */}
                        {result.contextAfter && (
                          <div className="text-sm text-gray-500 italic pl-4 border-l-2 border-gray-200">
                            {result.contextAfter}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
      </main>
    );
  }

  return (
    <main
      className="flex-1 overflow-y-auto"
      style={{ backgroundColor: BRAND_BG, height: 'calc(100vh - 80px)', marginTop: '80px' }}
    >
      <div className="flex-1 p-6 space-y-6 max-w-full">
        {/* Tabs */}
        <div className="border-b border-gray-200">
          <div className="flex items-center justify-between">
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
            <div className="flex items-center gap-3">
              {user?.role !== 'oversight' && (
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
              )}
            </div>
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
                          setViewMode('project');
                          setSelectedContentAnalysis(null);
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
