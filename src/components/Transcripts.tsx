import React, { useCallback, useEffect, useMemo, useState, useRef } from 'react';
import { createPortal } from 'react-dom';
import {
  DocumentTextIcon,
  CloudArrowUpIcon,
  ArrowDownTrayIcon,
  TrashIcon,
  ArrowLeftIcon,
  CheckCircleIcon,
  ExclamationTriangleIcon,
  PencilIcon,
  MagnifyingGlassIcon,
  XMarkIcon
} from '@heroicons/react/24/outline';
import { IconScript, IconTable } from '@tabler/icons-react';
import { API_BASE_URL } from '../config';
import { useAuth } from '../contexts/AuthContext';
import { normalizeTranscriptList, buildTranscriptDisplayName } from '../utils/respnoUtils';

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
  const [viewMode, setViewMode] = useState<'home' | 'project'>('home');
  const [selectedContentAnalysis, setSelectedContentAnalysis] = useState<any | null>(null);
  const [openDropdownTranscriptId, setOpenDropdownTranscriptId] = useState<string | null>(null);
  const dropdownButtonRefs = useRef<Map<string, HTMLElement>>(new Map());
  const [dropdownPosition, setDropdownPosition] = useState<{ top: number; left: number; width: number } | null>(null);
  const [isResettingRespnos, setIsResettingRespnos] = useState(false);
  const [transcripts, setTranscripts] = useState<ProjectTranscripts>({});
  const [showUploadModal, setShowUploadModal] = useState(false);
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [cleanTranscript, setCleanTranscript] = useState(true);
  const [isProcessing, setIsProcessing] = useState(false);
  const [isLoadingProjects, setIsLoadingProjects] = useState(false);
  const [isLoadingArchived, setIsLoadingArchived] = useState(false);
  const [savedAnalyses, setSavedAnalyses] = useState<any[]>([]);
  const [addingTranscriptIds, setAddingTranscriptIds] = useState<Set<string>>(new Set());
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
  const [parsedModerator, setParsedModerator] = useState<string>('');
  const [parsedRespondent, setParsedRespondent] = useState<string>('');
  const [processingStage, setProcessingStage] = useState<'cleaning' | 'adding' | null>(null);
  const [isSavingDateTime, setIsSavingDateTime] = useState(false);
  const [removingTranscriptIds, setRemovingTranscriptIds] = useState<Set<string>>(new Set());
  
  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (openDropdownTranscriptId) {
        const buttonElement = dropdownButtonRefs.current.get(openDropdownTranscriptId);
        if (buttonElement) {
          const target = event.target as HTMLElement;
          // Check if click is outside both button and dropdown
          // The dropdown is rendered via portal, so check if it contains the target
          const dropdownElement = document.querySelector('[data-dropdown-ca-selection]');
          if (!buttonElement.contains(target) && 
              !(dropdownElement && dropdownElement.contains(target))) {
            setOpenDropdownTranscriptId(null);
            setDropdownPosition(null);
          }
        }
      }
    };

    if (openDropdownTranscriptId) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => {
        document.removeEventListener('mousedown', handleClickOutside);
      };
    }
  }, [openDropdownTranscriptId]);
  
  // Date/time editing state
  const [editingTranscriptId, setEditingTranscriptId] = useState<string | null>(null);
  const [editingField, setEditingField] = useState<'date' | 'time' | null>(null);
  const [editingValue, setEditingValue] = useState<string>('');

  // Date formatting utilities
  const formatDateToShort = (dateStr: string | undefined): string => {
    if (!dateStr) return '-';
    try {
      // Clean up any prefixes like "Qual", "Qualitative", "Transcript"
      let cleaned = dateStr.trim();
      cleaned = cleaned.replace(/^Qual(itative)?\s*/i, '').trim();
      cleaned = cleaned.replace(/^Transcript\s*/i, '').trim();
      
      // Handle YYYY-MM-DD format directly to avoid timezone issues
      if (/^\d{4}-\d{2}-\d{2}$/.test(cleaned)) {
        const [year, month, day] = cleaned.split('-').map(Number);
        const shortYear = year.toString().slice(-2);
        return `${month}/${day}/${shortYear}`;
      }
      
      // For other formats, try parsing with Date
      const date = new Date(cleaned);
      if (isNaN(date.getTime())) {
        // If parsing fails, try to extract just the date part
        const dateMatch = cleaned.match(/(\w+\s+\d{1,2},?\s+\d{4})/);
        if (dateMatch) {
          const extractedDate = new Date(dateMatch[1]);
          if (!isNaN(extractedDate.getTime())) {
            const month = extractedDate.getMonth() + 1;
            const day = extractedDate.getDate();
            const year = extractedDate.getFullYear().toString().slice(-2);
            return `${month}/${day}/${year}`;
          }
        }
        return cleaned; // Return cleaned version if can't parse
      }
      
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
      const response = await fetch(`${API_BASE_URL}/api/caX/saved`, {
        headers: getAuthHeaders()
      });
      if (response.ok) {
        const data = await response.json();
        
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
              
              // Do not normalize in transcripts view; use server data as-is
              return analysis;
            }))
          : [];
        setSavedAnalyses(normalizedAnalyses);
        
        // Update selectedContentAnalysis if it exists - refresh it with the latest data
        if (selectedContentAnalysis && normalizedAnalyses.length > 0) {
          const updatedAnalysis = normalizedAnalyses.find((a: any) => a.id === selectedContentAnalysis.id);
          if (updatedAnalysis) {
            setSelectedContentAnalysis(updatedAnalysis);
          }
        }
        
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

  // Ensure respnos are gapless/chronological on page open and project change
  // No respno renumbering; keep respnos locked at project level

  const isTranscriptInAnalysis = (transcriptId: string): boolean => {
    // ONLY check analyses that belong to the current project
    const projectAnalyses = savedAnalyses.filter(analysis => analysis.projectId === selectedProject?.id);

    const result = projectAnalyses.some(analysis => {
      // Check if the transcript ID exists in any CA row (not respno, which can change)
      if (analysis.data) {
        let foundInData = false;
        if (analysis.data.Demographics && Array.isArray(analysis.data.Demographics)) {
          const hasTranscript = analysis.data.Demographics.some((row: any) => row.transcriptId === transcriptId);
          if (hasTranscript) foundInData = true;
        }
        if (!foundInData) {
          Object.entries(analysis.data).forEach(([_, sheetData]) => {
            if (Array.isArray(sheetData)) {
              const hasTranscript = sheetData.some((row: any) => row.transcriptId === transcriptId);
              if (hasTranscript) foundInData = true;
            }
          });
        }
        if (foundInData) return true;
      }
      return false;
    });

    return result;
  };

  const getCANameForProject = (projectId: string): string | null => {
    const analysis = savedAnalyses.find(a => a.projectId === projectId);
    return analysis ? analysis.name : null;
  };

  // Check if a transcript is assigned to any content analysis for a project
  const isTranscriptInAnyCA = useCallback((transcriptId: string, projectId: string): boolean => {
    const projectAnalyses = savedAnalyses.filter(analysis => analysis.projectId === projectId);
    
    const result = projectAnalyses.some(analysis => {
      if (analysis.data) {
        // Check Demographics sheet
        if (analysis.data.Demographics && Array.isArray(analysis.data.Demographics)) {
          const hasTranscript = analysis.data.Demographics.some((row: any) => {
            // Ensure both values are strings for comparison
            const rowTranscriptId = row.transcriptId ? String(row.transcriptId) : null;
            const checkId = String(transcriptId);
            const match = rowTranscriptId === checkId;
            
            return match;
          });
          
          if (hasTranscript) {
            return true;
          }
        }
        
        // Check other sheets
        for (const [sheetName, sheetData] of Object.entries(analysis.data)) {
          if (Array.isArray(sheetData)) {
            const hasTranscript = sheetData.some((row: any) => {
              // Ensure both values are strings for comparison
              const rowTranscriptId = row.transcriptId ? String(row.transcriptId) : null;
              const checkId = String(transcriptId);
              return rowTranscriptId === checkId;
            });
            if (hasTranscript) {
              return true;
            }
          }
        }
      }
      return false;
    });
    
    return result;
  }, [savedAnalyses]);

  const handleNavigateToCA = (transcriptId: string) => {
    if (!selectedProject || !onNavigate || !setAnalysisToLoad) return;
    
    // Find the specific analysis that contains this transcript
    const analysis = savedAnalyses.find(a => {
      if (a.projectId !== selectedProject.id) return false;
      
      // Check if transcript is in this analysis
      if (a.data) {
        // Check all sheets including Demographics
        for (const [sheetName, sheetData] of Object.entries(a.data)) {
          if (Array.isArray(sheetData)) {
            const hasTranscript = sheetData.some((row: any) =>
              row.transcriptId === transcriptId
            );
            if (hasTranscript) return true;
          }
        }
      }
      
      // Also check transcripts array as fallback
      if (a.transcripts && Array.isArray(a.transcripts)) {
        const hasTranscript = a.transcripts.some((t: any) =>
          t.id === transcriptId || t.sourceTranscriptId === transcriptId
        );
        if (hasTranscript) return true;
      }
      
      return false;
    });
    
    if (analysis) {
      // Set the specific analysis to load
      setAnalysisToLoad(analysis.id);
      // Navigate to Content Analysis
      onNavigate('Content Analysis');
    } else {
      alert('No content analysis found containing this transcript.');
    }
  };

  const analysesForSelectedProject = useMemo(
    () =>
      savedAnalyses.filter(
        analysis => analysis.projectId === selectedProject?.id
      ),
    [savedAnalyses, selectedProject?.id]
  );

  // Debug: Create array of all transcripts with their CA assignments
  // This must be at the top level (unconditionally) to follow Rules of Hooks
  const debugTranscriptAssignments = useMemo(() => {
    const assignments: Array<{
      transcriptId: string;
      projectId: string;
      respno: string | null;
      contentAnalysisId: string | null;
      contentAnalysisName: string | null;
    }> = [];

    // Iterate through all projects and their transcripts
    Object.entries(transcripts).forEach(([projectId, projectTranscripts]) => {
      if (!Array.isArray(projectTranscripts)) return;

      projectTranscripts.forEach((transcript: any) => {
        // Find which CA (if any) contains this transcript
        let assignedCAId: string | null = null;
        let assignedCAName: string | null = null;

        // If transcript has no respno, it's definitely not assigned to any CA
        // (respno is only assigned when added to a CA)
        const hasRespno = transcript.respno && String(transcript.respno).trim() !== '';
        
        if (hasRespno) {
          // Normalize transcript ID for comparison
          const normalizedTranscriptId = String(transcript.id).trim();

          const projectAnalyses = savedAnalyses.filter(a => a.projectId === projectId);
          for (const analysis of projectAnalyses) {
            // Check if transcript is in this analysis
            if (analysis.data) {
              for (const [sheetName, sheetData] of Object.entries(analysis.data)) {
                if (Array.isArray(sheetData)) {
                  const hasTranscript = sheetData.some((row: any) => {
                    const rowTranscriptId = row?.transcriptId ? String(row.transcriptId).trim() : null;
                    return rowTranscriptId === normalizedTranscriptId;
                  });
                  if (hasTranscript) {
                    assignedCAId = analysis.id;
                    assignedCAName = analysis.name || 'Untitled';
                    break;
                  }
                }
              }
            }
            // Also check analysis.transcripts array
            if (!assignedCAId && Array.isArray(analysis.transcripts)) {
              const hasTranscript = analysis.transcripts.some((t: any) => {
                const tid = t?.id || t?.sourceTranscriptId;
                return String(tid).trim() === normalizedTranscriptId;
              });
              if (hasTranscript) {
                assignedCAId = analysis.id;
                assignedCAName = analysis.name || 'Untitled';
                break;
              }
            }
            if (assignedCAId) break;
          }
        }
        // If no respno, assignedCAId and assignedCAName remain null (not assigned)

        assignments.push({
          transcriptId: transcript.id,
          projectId: projectId,
          respno: transcript.respno || null,
          contentAnalysisId: assignedCAId,
          contentAnalysisName: assignedCAName
        });
      });
    });

    return assignments.sort((a, b) => {
      // Sort by projectId, then by CA assignment status (unassigned first), then by transcriptId
      if (a.projectId !== b.projectId) return a.projectId.localeCompare(b.projectId);
      if (!!a.contentAnalysisId !== !!b.contentAnalysisId) {
        return a.contentAnalysisId ? 1 : -1; // Unassigned first
      }
      return a.transcriptId.localeCompare(b.transcriptId);
    });
  }, [transcripts, savedAnalyses]);

  // Get transcripts that belong to a specific content analysis
  const getTranscriptsForAnalysis = useCallback((analysis: any, projectTranscripts: Transcript[], currentProjectId?: string): Transcript[] => {
    if (!analysis || !analysis.data) {
      return [];
    }
    
    const transcriptIds = new Set<string>();
    // Collect only from sheet rows (authoritative source). Ignore analysis.transcripts to avoid stale items.
    Object.values(analysis.data).forEach((sheetData: any) => {
      if (Array.isArray(sheetData)) {
        sheetData.forEach((row: any) => {
          if (row?.transcriptId) {
            const tid = String(row.transcriptId).trim();
            transcriptIds.add(tid);
          }
        });
      }
    });
    
    const matchingTranscripts = projectTranscripts.filter(t => {
      const normalizedId = String(t.id).trim();
      return transcriptIds.has(normalizedId);
    });
    
    return matchingTranscripts;
  }, []);

  // Build per-CA respno map so Uploaded list shows R01.. in CA order
  const caRespnoByTranscriptId = useMemo(() => {
    const map = new Map<string, string>();
    if (!selectedContentAnalysis || !selectedContentAnalysis.data) return map;
    const demoRows = Array.isArray(selectedContentAnalysis.data.Demographics) ? selectedContentAnalysis.data.Demographics : [];
    let orderedIds: string[] = [];
    if (demoRows.length > 0) {
      orderedIds = demoRows
        .map((r: any) => r?.transcriptId)
        .filter((id: any) => typeof id === 'string' && id.trim() !== '');
    } else {
      // Fallback: collect from any sheet rows
      const ids = new Set<string>();
      Object.values(selectedContentAnalysis.data).forEach((rows: any) => {
        if (Array.isArray(rows)) rows.forEach((r: any) => { if (r?.transcriptId) ids.add(String(r.transcriptId)); });
      });
      orderedIds = Array.from(ids);
    }
    orderedIds.forEach((tid, idx) => {
      const n = idx + 1;
      const r = n < 100 ? `R${String(n).padStart(2, '0')}` : `R${n}`;
      map.set(String(tid), r);
    });
    return map;
  }, [selectedContentAnalysis?.id, selectedContentAnalysis?.data]);


  const handleAddToCA = async (transcript: Transcript, analysisId?: string) => {
    if (!selectedProject) return;

    // Prevent adding if already in progress
    if (addingTranscriptIds.has(transcript.id)) {
      return;
    }

    // If analysisId is provided, use it directly
    // Otherwise, check if there's only one CA (auto-add) or show modal
    let analysisIdToUse = analysisId;
    
    if (!analysisIdToUse) {
      const projectAnalyses = savedAnalyses.filter(a => a.projectId === selectedProject.id);
      
      if (projectAnalyses.length === 0) {
        alert('No Content Analysis found for this project. Please create one first.');
        return;
      } else if (projectAnalyses.length === 1) {
        // Only one CA - auto-add
        analysisIdToUse = projectAnalyses[0].id;
      } else {
        // Multiple CAs - show dropdown (handled by button click event)
        return;
      }
    }

    const analysis = savedAnalyses.find(a => a.id === analysisIdToUse);

    if (!analysis) {
      alert('Content Analysis not found.');
      return;
    }

    // Add transcript ID to loading set
    setAddingTranscriptIds(prev => new Set(prev).add(transcript.id));

    try {
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
        // Refresh analyses and transcripts - ensure both complete before continuing
        await Promise.all([
          loadTranscripts(),
          loadSavedAnalyses()
        ]);
        // Do NOT call updateContentAnalysisOrdering here; server already persists ordering.
        // Avoid overwriting server-added rows with stale client state.
      } else {
        const error = await response.json();
        alert(`Failed to add transcript to CA: ${error.error || 'Unknown error'}`);
      }
    } catch (error) {
      console.error('Failed to add transcript to CA:', error);
      alert('Failed to add transcript to CA');
    } finally {
      // Remove transcript ID from loading set
      setAddingTranscriptIds(prev => {
        const next = new Set(prev);
        next.delete(transcript.id);
        return next;
      });
      // Close dropdown if open
      setOpenDropdownTranscriptId(null);
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

      // Search through all transcripts for this project
      for (const transcript of projectTranscripts) {
        try {
          // Download the transcript content as plain text - prefer cleaned version if available
          const preferCleaned = transcript.isCleaned ? 'preferCleaned=true&' : '';
          const response = await fetch(
            `${API_BASE_URL}/api/transcripts/download/${selectedProject.id}/${transcript.id}?${preferCleaned}asText=true`,
            { headers: getAuthHeaders() }
          );

          if (!response.ok) {
            continue;
          }

          const text = await response.text();

          // Check if the search query exists anywhere in the full text (ignoring line breaks)
          const fullTextLower = text.toLowerCase();
          const queryInFullText = fullTextLower.includes(query);

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
        } catch (error) {
          // Error searching transcript - skip it
        }
      }

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
    loadSavedAnalyses();
  }, []);

  // Refresh saved analyses and transcripts every time the component mounts or project changes
  useEffect(() => {
    if (selectedProject) {
      loadSavedAnalyses();
      loadTranscripts();
    }
  }, [selectedProject?.id]);

  // Also refresh when component becomes visible (additional safety)
  useEffect(() => {
    const handleVisibilityChange = () => {
      if (!document.hidden) {
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
      if (selectedProject?.id) formData.append('projectId', selectedProject.id);

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
        if (data?.moderatorName) setParsedModerator(data.moderatorName);
        if (data?.respondentName) setParsedRespondent(data.respondentName);

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

    setProcessingStage('cleaning');
    setIsProcessing(true);

    try {
      const formData = new FormData();
      formData.append('transcript', uploadFile);
      formData.append('projectId', selectedProject.id);
      formData.append('cleanTranscript', cleanTranscript.toString());
      if (parsedModerator) formData.append('moderatorName', parsedModerator);
      if (parsedRespondent) formData.append('respondentName', parsedRespondent);

      const response = await fetch(`${API_BASE_URL}/api/transcripts/upload`, {
        method: 'POST',
        headers: getAuthHeaders(),
        body: formData
      });

      if (response.ok) {
        const uploadedTranscript = await response.json();
        // Transcript uploaded - it will appear in the un-assigned section
        // User must manually add it to a CA if desired

        const normalized = await loadTranscripts();
        await loadSavedAnalyses(normalized || undefined);


        setShowUploadModal(false);
        setUploadFile(null);
        setCleanTranscript(true);
        setParsedModerator('');
        setParsedRespondent('');
        setProcessingStage(null);
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

  // Helper function to sort transcripts chronologically OR by respno order
  const sortTranscriptsChronologically = (transcriptList: Transcript[]): Transcript[] => {
    const sorted = [...transcriptList].sort((a, b) => {
      // First, if both have respnos, sort by respno order (R01, R02, etc.)
      // This ensures the transcripts list matches the CA order after respnos are reset
      const respnoA = a.respno || '';
      const respnoB = b.respno || '';
      
      if (respnoA && respnoB) {
        // Extract numeric part from respno (e.g., "R01" -> 1, "R02" -> 2)
        const numMatchA = respnoA.match(/R(\d+)/i);
        const numMatchB = respnoB.match(/R(\d+)/i);
        
        if (numMatchA && numMatchB) {
          const numA = parseInt(numMatchA[1], 10);
          const numB = parseInt(numMatchB[1], 10);
          if (!isNaN(numA) && !isNaN(numB)) {
            return numA - numB;
          }
        }
        // If respno format is unexpected, fall back to string comparison
        return respnoA.localeCompare(respnoB);
      }
      
      // If only one has respno, prioritize it
      if (respnoA && !respnoB) return -1;
      if (respnoB && !respnoA) return 1;
      
      // If neither has respno, sort chronologically
      const dateA = a.interviewDate || '';
      const dateB = b.interviewDate || '';

      if (!dateA && !dateB) {
        // If both lack dates, sort by time
        const timeA = a.interviewTime || '';
        const timeB = b.interviewTime || '';
        if (!timeA && !timeB) return 0;
        if (!timeA) return 1;
        if (!timeB) return -1;
        return timeA.localeCompare(timeB);
      }
      if (!dateA) return 1;
      if (!dateB) return -1;

      try {
        const parsedA = new Date(dateA);
        const parsedB = new Date(dateB);

        if (!isNaN(parsedA.getTime()) && !isNaN(parsedB.getTime())) {
          const dateCompare = parsedA.getTime() - parsedB.getTime();
          if (dateCompare !== 0) return dateCompare;
          
          // If dates are equal, compare times
          const timeA = a.interviewTime || '';
          const timeB = b.interviewTime || '';
          if (timeA && timeB) {
            return timeA.localeCompare(timeB);
          }
          return 0;
        }
      } catch (e) {
        // If date parsing fails, maintain current order
      }

      return 0;
    });

    return sorted;
  };

  const handleResetCARespnos = async (analysisId: string, analysisName: string) => {
    if (!selectedProject) return;

    const confirmed = window.confirm(
      `This will reset respnos for all transcripts in "${analysisName}" based on their chronological order (by interview date/time).\n\nTranscripts will be renumbered starting from R01.\n\nContinue?`
    );

    if (!confirmed) return;

    setIsResettingRespnos(true);
    try {
      const response = await fetch(`${API_BASE_URL}/api/caX/reset-respnos`, {
        method: 'POST',
        headers: {
          ...getAuthHeaders(),
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          projectId: selectedProject.id,
          analysisId: analysisId
        })
      });

      if (response.ok) {
        alert(`Respnos have been reset for "${analysisName}"!`);
        await loadTranscripts();
        await loadSavedAnalyses();
      } else {
        const error = await response.json();
        alert(`Failed to reset respnos: ${error.error || 'Unknown error'}`);
      }
    } catch (error) {
      console.error('Failed to reset respnos:', error);
      alert('Failed to reset respnos');
    } finally {
      setIsResettingRespnos(false);
    }
  };

  const handleReassignRespnos = async () => {
    if (!selectedProject) return;

    const confirmed = window.confirm(
      `This will reassign respnos for all transcripts in "${selectedProject.name}" based on their chronological order (by interview date/time).\n\nAny transcripts with missing respnos will be assigned new ones.\n\nContinue?`
    );

    if (!confirmed) return;

    try {
      const response = await fetch(`${API_BASE_URL}/api/transcripts/reassign/${selectedProject.id}`, {
        method: 'POST',
        headers: getAuthHeaders()
      });

      if (response.ok) {
        alert('Respnos have been reassigned successfully!');
        // Reload transcripts to see the updated respnos
        await loadTranscripts();
        await loadSavedAnalyses();
      } else {
        const error = await response.json();
        alert(`Failed to reassign respnos: ${error.error || 'Unknown error'}`);
      }
    } catch (error) {
      console.error('Failed to reassign respnos:', error);
      alert('Failed to reassign respnos');
    }
  };

  const handleSyncRespnos = async () => {
    if (!selectedProject) return;

    const confirmed = window.confirm(
      `This will sync respnos in all content analyses for "${selectedProject.name}".\n\nIt will update Demographics data to match the respnos stored in each analysis's transcripts array.\n\nThis fixes respnos that are null/undefined in your existing content analyses.\n\nContinue?`
    );

    if (!confirmed) return;

    try {
      const response = await fetch(`${API_BASE_URL}/api/caX/sync-respnos`, {
        method: 'POST',
        headers: {
          ...getAuthHeaders(),
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ projectId: selectedProject.id })
      });

      if (response.ok) {
        const result = await response.json();
        alert(`Respnos synced successfully!\n\n${result.analysesUpdated} content analysis/analyses updated\n${result.totalRowsUpdated} total rows updated`);
        // Reload to see the updated respnos
        await loadSavedAnalyses();
      } else {
        const error = await response.json();
        alert(`Failed to sync respnos: ${error.error || 'Unknown error'}`);
      }
    } catch (error) {
      console.error('Failed to sync respnos:', error);
      alert('Failed to sync respnos');
    }
  };

  const handleDownload = async (transcript: Transcript, preferCleaned: boolean = false) => {
    if (!selectedProject) return;

    try {
      const fallbackFileName = preferCleaned && transcript.isCleaned && transcript.cleanedFilename
          ? transcript.cleanedFilename
          : transcript.originalFilename;

      const downloadName = buildTranscriptDisplayName({
        projectName: selectedProject.name,
        respno: transcript.respno,
        interviewDate: transcript.interviewDate,
        interviewTime: transcript.interviewTime,
        fallbackFilename: fallbackFileName
      });

      const url = `${API_BASE_URL}/api/transcripts/download/${selectedProject.id}/${transcript.id}?preferCleaned=${preferCleaned ? 'true' : 'false'}`;
      const response = await fetch(url, { headers: getAuthHeaders() });

      if (response.ok) {
        const blob = await response.blob();
        const objectUrl = window.URL.createObjectURL(blob);
        const anchor = document.createElement('a');
        anchor.href = objectUrl;
        anchor.download = downloadName || fallbackFileName || 'transcript.txt';
        document.body.appendChild(anchor);
        anchor.click();
        window.URL.revokeObjectURL(objectUrl);
        document.body.removeChild(anchor);
      } else {
        alert('Failed to download transcript');
      }
    } catch (error) {
      console.error('Failed to download transcript:', error);
      alert('Failed to download transcript');
    }
  };

  const handleRemoveFromCA = async (transcriptId: string, analysisId: string) => {
    if (!selectedProject) return;

    // Prevent removing if already in progress
    if (removingTranscriptIds.has(transcriptId)) {
      return;
    }

    setRemovingTranscriptIds(prev => new Set(prev).add(transcriptId));

    try {
      const response = await fetch(
        `${API_BASE_URL}/api/caX/remove-transcript`,
        {
          method: 'POST',
          headers: {
            ...getAuthHeaders(),
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            projectId: selectedProject.id,
            analysisId: analysisId,
            transcriptId: transcriptId
          })
        }
      );

      if (response.ok) {
        // Refresh transcripts and analyses
        const normalized = await loadTranscripts();
        await loadSavedAnalyses(normalized || undefined);
      } else {
        const error = await response.json();
        alert(`Failed to remove transcript from CA: ${error.error || 'Unknown error'}`);
      }
    } catch (error) {
      console.error('Failed to remove transcript from CA:', error);
      alert('Failed to remove transcript from CA');
    } finally {
      setRemovingTranscriptIds(prev => {
        const next = new Set(prev);
        next.delete(transcriptId);
        return next;
      });
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

  // Project view - show transcripts organized by CA boxes
  if (selectedProject && viewMode === 'project') {
    const projectAnalyses = analysesForSelectedProject;
    const projectTranscripts = transcripts[selectedProject.id] || [];
    const duplicateIds = findDuplicateInterviewTimes(projectTranscripts);
    
    // Get un-assigned transcripts (not in any CA)
    // Primary check: If transcript has no respno, it's unassigned (respno is only assigned when added to CA)
    // Secondary check: Verify it's not in any CA's data sheets
    const orphanedTranscripts = projectTranscripts.filter(t => {
      // If transcript has no respno, it's definitely unassigned
      if (!t.respno || String(t.respno).trim() === '') {
        return true;
      }
      
      // If no savedAnalyses, all transcripts are unassigned
      if (savedAnalyses.length === 0) {
        return true;
      }
      
      // Check if this transcript is assigned to any CA (even if it has a respno, verify it's actually in a CA)
      const projectAnalyses = savedAnalyses.filter(a => a.projectId === selectedProject.id);
      const normalizedTranscriptId = String(t.id).trim();
      let isAssigned = false;
      
      for (const analysis of projectAnalyses) {
        // Check if transcript is in this analysis's data sheets
        if (analysis.data) {
          for (const [sheetName, sheetData] of Object.entries(analysis.data)) {
            if (Array.isArray(sheetData)) {
              const hasTranscript = sheetData.some((row: any) => {
                const rowTranscriptId = row?.transcriptId ? String(row.transcriptId).trim() : null;
                return rowTranscriptId === normalizedTranscriptId;
              });
              if (hasTranscript) {
                isAssigned = true;
                break;
              }
            }
          }
        }
        // Also check analysis.transcripts array
        if (!isAssigned && Array.isArray(analysis.transcripts)) {
          const hasTranscript = analysis.transcripts.some((transcript: any) => {
            const tid = transcript?.id || transcript?.sourceTranscriptId;
            return String(tid).trim() === normalizedTranscriptId;
          });
          if (hasTranscript) {
            isAssigned = true;
            break;
          }
      }
      if (isAssigned) break;
    }
    
    return !isAssigned;
  });
  
  const sortedOrphanedTranscripts = sortTranscriptsChronologically(orphanedTranscripts);

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
            <div className="flex items-center gap-2 self-end">
              <button
                onClick={() => setShowSearchModal(true)}
                disabled={addingTranscriptIds.size > 0 || isResettingRespnos}
                className="inline-flex items-center justify-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium shadow-sm transition bg-white border border-gray-300 hover:bg-gray-50 text-gray-700 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <MagnifyingGlassIcon className="h-4 w-4" />
                Search
              </button>
              <button
                onClick={() => setShowUploadModal(true)}
                disabled={addingTranscriptIds.size > 0 || isResettingRespnos}
                className="inline-flex items-center justify-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium text-white shadow-sm transition hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed"
                style={{ backgroundColor: BRAND_ORANGE }}
              >
                <CloudArrowUpIcon className="h-4 w-4" />
                Upload
              </button>
            </div>
          </section>

          {/* Un-Assigned Transcripts Box */}
          {sortedOrphanedTranscripts.length > 0 && (
            <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4 mb-6">
              <div className="flex items-start justify-between mb-4">
                <div>
                  <h3 className="text-sm font-semibold text-yellow-900">
                    Un-Assigned Transcripts
                  </h3>
                  <p className="mt-1 text-xs text-yellow-700">
                    {sortedOrphanedTranscripts.length} transcript{sortedOrphanedTranscripts.length === 1 ? '' : 's'} uploaded to this project but not assigned to any content analysis
                  </p>
                </div>
              </div>
              <div className="bg-white shadow-sm border border-gray-200 rounded-lg overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="min-w-full divide-y divide-gray-200">
                    <thead className="bg-gray-50">
                      <tr>
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
                          Actions
                        </th>
                      </tr>
                    </thead>
                    <tbody className="bg-white divide-y divide-gray-200">
                      {sortedOrphanedTranscripts.map(transcript => {
                        const displayName = buildTranscriptDisplayName({
                          projectName: selectedProject?.name,
                          respno: null,
                          interviewDate: transcript.interviewDate,
                          interviewTime: transcript.interviewTime,
                          fallbackFilename: transcript.originalFilename
                        });

                        return (
                          <tr
                            key={transcript.id}
                            className="hover:bg-gray-50 transition-colors"
                          >
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
                                      disabled={isSavingDateTime || addingTranscriptIds.size > 0}
                                    />
                                  </div>
                                ) : (
                                  <div className="flex items-center gap-1">
                                    <span>{formatDateToShort(transcript.interviewDate)}</span>
                                    <button
                                      onClick={() => handleStartEditing(transcript.id, 'date', formatDateToShort(transcript.interviewDate))}
                                      className="text-gray-400 hover:text-gray-600 p-0.5 rounded"
                                      title="Edit date (MM/DD/YY format)"
                                      disabled={isSavingDateTime || addingTranscriptIds.size > 0}
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
                                      disabled={isSavingDateTime || addingTranscriptIds.size > 0}
                                    />
                                  </div>
                                ) : (
                                  <div className="flex items-center gap-1">
                                    <span>{formatTimeToStandard(transcript.interviewTime)}</span>
                                    <button
                                      onClick={() => handleStartEditing(transcript.id, 'time', formatTimeToStandard(transcript.interviewTime))}
                                      className="text-gray-400 hover:text-gray-600 p-0.5 rounded"
                                      title="Edit time (HH:MM AM/PM format)"
                                      disabled={isSavingDateTime || addingTranscriptIds.size > 0}
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
                                onClick={() => handleDownload(transcript, false)}
                                disabled={addingTranscriptIds.size > 0}
                                className="text-blue-600 hover:text-blue-800 p-1 rounded-lg hover:bg-blue-50 mx-auto disabled:opacity-50 disabled:cursor-not-allowed"
                                title="Download Original"
                              >
                                <DocumentTextIcon className="h-5 w-5" />
                              </button>
                            </td>
                            <td className="px-3 py-4 whitespace-nowrap text-center">
                              {transcript.isCleaned ? (
                                <button
                                  onClick={() => handleDownload(transcript, true)}
                                  disabled={addingTranscriptIds.size > 0}
                                  className="text-blue-600 hover:text-blue-800 p-1 rounded-lg hover:bg-blue-50 mx-auto disabled:opacity-50 disabled:cursor-not-allowed"
                                  title="Download Cleaned"
                                >
                                  <DocumentTextIcon className="h-5 w-5" />
                                </button>
                              ) : (
                                <span className="text-sm text-gray-400">-</span>
                              )}
                            </td>
                            <td className="px-3 py-4 whitespace-nowrap text-center relative">
                              {addingTranscriptIds.has(transcript.id) ? (
                                <div className="flex items-center justify-center gap-1 text-xs text-gray-500">
                                  <div className="h-4 w-4 animate-spin rounded-full border-2 border-gray-300 border-t-[#D14A2D]"></div>
                                  <span>Adding...</span>
                                </div>
                              ) : (
                                <>
                                  <div className="flex items-center justify-center gap-2">
                                    <button
                                      ref={(el) => {
                                        if (el) {
                                          dropdownButtonRefs.current.set(transcript.id, el);
                                        } else {
                                          dropdownButtonRefs.current.delete(transcript.id);
                                        }
                                      }}
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        e.preventDefault();
                                        const projectAnalyses = savedAnalyses.filter(a => a.projectId === selectedProject?.id);
                                        
                                        if (projectAnalyses.length === 0) {
                                          alert('No Content Analysis found for this project. Please create one first.');
                                          return;
                                        } else if (projectAnalyses.length === 1) {
                                          // Only one CA - auto-add
                                          handleAddToCA(transcript, projectAnalyses[0].id);
                                        } else {
                                          // Multiple CAs - toggle dropdown
                                          if (openDropdownTranscriptId === transcript.id) {
                                            setOpenDropdownTranscriptId(null);
                                            setDropdownPosition(null);
                                          } else {
                                            // Calculate button position for dropdown
                                            const buttonElement = dropdownButtonRefs.current.get(transcript.id);
                                            if (buttonElement) {
                                              const rect = buttonElement.getBoundingClientRect();
                                              setDropdownPosition({
                                                top: rect.top - 10, // Position above button
                                                left: rect.right - 256, // Align right edge (256px = w-64)
                                                width: 256 // w-64 = 256px
                                              });
                                            }
                                            setOpenDropdownTranscriptId(transcript.id);
                                          }
                                        }
                                      }}
                                      disabled={addingTranscriptIds.size > 0 || removingTranscriptIds.has(transcript.id)}
                                      className="text-[#D14A2D] hover:text-[#A03824] text-xs font-medium whitespace-nowrap disabled:opacity-50 disabled:cursor-not-allowed"
                                    >
                                      Add to CA
                                    </button>
                                    <button
                                      onClick={() => handleDeleteTranscript(transcript.id)}
                                      disabled={addingTranscriptIds.size > 0 || removingTranscriptIds.has(transcript.id)}
                                      className="text-red-600 hover:text-red-800 p-1 rounded-lg hover:bg-red-50 disabled:opacity-50 disabled:cursor-not-allowed"
                                      title="Delete"
                                    >
                                      <TrashIcon className="h-4 w-4" />
                                    </button>
                                  </div>
                                  
                                  {/* Dropdown for CA selection - rendered via portal */}
                                  {openDropdownTranscriptId === transcript.id && dropdownPosition && createPortal(
                                    <div
                                      data-dropdown-ca-selection
                                      className="fixed z-[999999] bg-white rounded-lg shadow-lg border border-gray-200 overflow-hidden"
                                      style={{
                                        top: `${dropdownPosition.top}px`,
                                        left: `${dropdownPosition.left}px`,
                                        width: `${dropdownPosition.width}px`,
                                        maxHeight: '400px',
                                        overflowY: 'auto'
                                      }}
                                    >
                                      <div className="py-1">
                                        {savedAnalyses
                                          .filter(a => a.projectId === selectedProject?.id)
                                          .map((analysis) => (
                                            <button
                                              key={analysis.id}
                                              onClick={(e) => {
                                                e.stopPropagation();
                                                e.preventDefault();
                                                handleAddToCA(transcript, analysis.id);
                                                setOpenDropdownTranscriptId(null);
                                                setDropdownPosition(null);
                                              }}
                                              disabled={addingTranscriptIds.has(transcript.id)}
                                              className="w-full text-left px-4 py-2 text-sm text-gray-700 hover:bg-orange-50 hover:text-[#D14A2D] transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                                            >
                                              <div className="font-medium">{analysis.name || 'Untitled Analysis'}</div>
                                              {analysis.description && (
                                                <div className="text-xs text-gray-500 mt-0.5 truncate">{analysis.description}</div>
                                              )}
                                            </button>
                                          ))}
                                      </div>
                                    </div>,
                                    document.body
                                  )}
                                </>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}

          {/* Content Analysis Boxes */}
          {projectAnalyses.length === 0 ? (
            <div className="bg-white shadow-sm border border-gray-200 rounded-lg p-8 text-center">
              <DocumentTextIcon className="h-12 w-12 text-gray-400 mx-auto mb-4" />
              <h3 className="text-lg font-medium text-gray-900 mb-2">No Content Analyses</h3>
              <p className="text-gray-600 mb-4">This project doesn't have any content analyses yet.</p>
              <p className="text-sm text-gray-500">
                Create a content analysis in the Content Analysis tab to organize transcripts by analysis.
              </p>
            </div>
          ) : (
            (() => {
              // First pass: build a map of transcriptId -> analysisId
              // If a transcript appears in multiple CAs (data inconsistency), assign it to the first CA we encounter
              const transcriptToAnalysisMap = new Map<string, string>();
              projectAnalyses.forEach((analysis) => {
                // Double-check that CA belongs to current project (safety check)
                if (analysis.projectId !== selectedProject?.id) {
                  console.warn(`⚠️ Skipping CA ${analysis.id} (${analysis.name}) - projectId mismatch: CA has ${analysis.projectId}, selected project is ${selectedProject?.id}`);
                  return;
                }
                
                const analysisTranscripts = getTranscriptsForAnalysis(analysis, projectTranscripts, selectedProject?.id);
                console.log(`🔍 First pass - CA ${analysis.id} (${analysis.name}) found ${analysisTranscripts.length} transcripts:`, analysisTranscripts.map(t => t.id));
                
                analysisTranscripts.forEach((transcript) => {
                  const tid = String(transcript.id).trim();
                  if (!transcriptToAnalysisMap.has(tid)) {
                    transcriptToAnalysisMap.set(tid, analysis.id);
                  } else {
                    // Transcript already assigned to another CA - skip it
                  }
                });
              });
              
              // Second pass: render each CA box with only transcripts assigned to it
              return projectAnalyses.map((analysis) => {
                const analysisTranscripts = getTranscriptsForAnalysis(analysis, projectTranscripts, selectedProject?.id);
                
                // Filter to only include transcripts that are assigned to THIS CA (prevent duplicates)
                const filteredTranscripts = analysisTranscripts.filter((transcript) => {
                  const tid = String(transcript.id).trim();
                  const assignedCAId = transcriptToAnalysisMap.get(tid);
                  const isAssignedToThisCA = assignedCAId === analysis.id;
                  return isAssignedToThisCA;
                });
                
                const sortedAnalysisTranscripts = sortTranscriptsChronologically(filteredTranscripts);
              
              return (
                <div key={analysis.id} className="bg-white shadow-sm border border-gray-200 rounded-lg overflow-hidden">
                  <div className="bg-gray-50 px-6 py-4 border-b border-gray-200">
                    <div className="flex items-center justify-between">
                      <div>
                        <h3 className="text-lg font-semibold text-gray-900">{analysis.name || 'Untitled Analysis'}</h3>
                        {analysis.description && (
                          <p className="mt-1 text-sm text-gray-500">{analysis.description}</p>
                        )}
                        <p className="mt-1 text-xs text-gray-500">
                          {sortedAnalysisTranscripts.length} transcript{sortedAnalysisTranscripts.length === 1 ? '' : 's'}
                        </p>
                      </div>
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => {
                            if (onNavigate && setAnalysisToLoad) {
                              setAnalysisToLoad(analysis.id);
                              onNavigate('Content Analysis');
                            }
                          }}
                          className="inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium shadow-sm transition bg-white border border-gray-300 hover:bg-gray-50 text-gray-700"
                          title="Open Content Analysis"
                        >
                          <IconTable className="h-4 w-4" />
                          Open CA
                        </button>
                        <button
                          onClick={() => handleResetCARespnos(analysis.id, analysis.name || 'Untitled Analysis')}
                          disabled={isResettingRespnos || sortedAnalysisTranscripts.length === 0}
                          className="inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium shadow-sm transition bg-gray-700 hover:bg-gray-800 text-white disabled:opacity-50 disabled:cursor-not-allowed"
                          title="Reset respnos for this CA based on chronological order"
                        >
                          Reset Respnos
                        </button>
                      </div>
                    </div>
                  </div>
                  {sortedAnalysisTranscripts.length === 0 ? (
                    <div className="p-8 text-center">
                      <p className="text-sm text-gray-500">No transcripts assigned to this content analysis yet.</p>
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
                            <th className="px-3 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider w-20">
                              Actions
                            </th>
                          </tr>
                        </thead>
                        <tbody className="bg-white divide-y divide-gray-200">
                          {sortedAnalysisTranscripts.map(transcript => {
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
                                  {transcript.respno ? (
                                    <span className="inline-flex items-center rounded-md bg-blue-100 px-2 py-0.5 text-xs font-semibold text-blue-700">
                                      {transcript.respno}
                                    </span>
                                  ) : (
                                    <span className="text-sm text-gray-400">-</span>
                                  )}
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
                                          disabled={isSavingDateTime || addingTranscriptIds.size > 0}
                                        />
                                      </div>
                                    ) : (
                                      <div className="flex items-center gap-1">
                                        <span>{formatDateToShort(transcript.interviewDate)}</span>
                                        <button
                                          onClick={() => handleStartEditing(transcript.id, 'date', formatDateToShort(transcript.interviewDate))}
                                          className="text-gray-400 hover:text-gray-600 p-0.5 rounded"
                                          title="Edit date (MM/DD/YY format)"
                                          disabled={isSavingDateTime || addingTranscriptIds.size > 0}
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
                                          disabled={isSavingDateTime || addingTranscriptIds.size > 0}
                                        />
                                      </div>
                                    ) : (
                                      <div className="flex items-center gap-1">
                                        <span>{formatTimeToStandard(transcript.interviewTime)}</span>
                                        <button
                                          onClick={() => handleStartEditing(transcript.id, 'time', formatTimeToStandard(transcript.interviewTime))}
                                          className="text-gray-400 hover:text-gray-600 p-0.5 rounded"
                                          title="Edit time (HH:MM AM/PM format)"
                                          disabled={isSavingDateTime || addingTranscriptIds.size > 0}
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
                                    onClick={() => handleDownload(transcript, false)}
                                    disabled={addingTranscriptIds.size > 0}
                                    className="text-blue-600 hover:text-blue-800 p-1 rounded-lg hover:bg-blue-50 mx-auto disabled:opacity-50 disabled:cursor-not-allowed"
                                    title="Download Original"
                                  >
                                    <DocumentTextIcon className="h-5 w-5" />
                                  </button>
                                </td>
                                <td className="px-3 py-4 whitespace-nowrap text-center">
                                  {transcript.isCleaned ? (
                                    <button
                                      onClick={() => handleDownload(transcript, true)}
                                      disabled={addingTranscriptIds.size > 0}
                                      className="text-blue-600 hover:text-blue-800 p-1 rounded-lg hover:bg-blue-50 mx-auto disabled:opacity-50 disabled:cursor-not-allowed"
                                      title="Download Cleaned"
                                    >
                                      <DocumentTextIcon className="h-5 w-5" />
                                    </button>
                                  ) : (
                                    <span className="text-sm text-gray-400">-</span>
                                  )}
                                </td>
                                <td className="px-3 py-4 whitespace-nowrap text-center">
                                  <div className="flex items-center justify-center gap-2">
                                    <button
                                      onClick={() => handleRemoveFromCA(transcript.id, analysis.id)}
                                      disabled={addingTranscriptIds.size > 0 || removingTranscriptIds.has(transcript.id)}
                                      className="text-orange-600 hover:text-orange-800 p-1 rounded-lg hover:bg-orange-50 disabled:opacity-50 disabled:cursor-not-allowed"
                                      title="Remove from CA"
                                    >
                                      {removingTranscriptIds.has(transcript.id) ? (
                                        <div className="h-4 w-4 animate-spin rounded-full border-2 border-orange-300 border-t-orange-600"></div>
                                      ) : (
                                        <XMarkIcon className="h-4 w-4" />
                                      )}
                                    </button>
                                    <button
                                      onClick={() => handleDeleteTranscript(transcript.id)}
                                      disabled={addingTranscriptIds.size > 0 || removingTranscriptIds.has(transcript.id)}
                                      className="text-red-600 hover:text-red-800 p-1 rounded-lg hover:bg-red-50 disabled:opacity-50 disabled:cursor-not-allowed"
                                      title="Delete"
                                    >
                                      <TrashIcon className="h-4 w-4" />
                                    </button>
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
              );
              });
            })()
          )}

          {/* Upload Modal */}
          {showUploadModal && (
            <div className="fixed inset-0 z-[999999] flex items-center justify-center bg-black/50 px-4" style={{ top: 0, left: 0, right: 0, bottom: 0 }}>
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
                          {processingStage === 'adding'
                            ? 'Adding to Content Analysis'
                            : cleanTranscript ? 'Cleaning Transcript' : 'Uploading Transcript'}
                        </h3>
                        <p className="mt-1 text-sm text-gray-500">
                          This may take a moment...
                        </p>
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
                            handleFileSelect(e.target.files?.[0] || null)
                          }
                          className="block w-full cursor-pointer rounded-lg border border-gray-300 bg-gray-50 text-sm text-gray-900 focus:outline-none file:mr-4 file:py-2 file:px-4 file:rounded-l-lg file:border-0 file:text-sm file:font-medium file:bg-orange-50 file:text-orange-700 hover:file:bg-orange-100"
                        />
                        <p className="mt-2 text-xs text-gray-500">
                          Supported formats: .docx and .txt
                        </p>
                      </div>

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

                      {uploadStep === 'options' && uploadFile && !isParsingFile && (
                        <>
                          {parsedDateTime && (
                            <div className="bg-blue-50 border border-blue-200 rounded-lg p-3">
                              <h4 className="text-sm font-medium text-blue-900 mb-2">Detected Interview Information:</h4>
                              <div className="text-sm text-blue-800">
                                <p><strong>Date:</strong> {parsedDateTime.date}</p>
                                <p><strong>Time:</strong> {parsedDateTime.time}</p>
                              </div>
                            </div>
                          )}

                          {(parsedModerator || parsedRespondent) && (
                            <div className="bg-green-50 border border-green-200 rounded-lg p-3">
                              <h4 className="text-sm font-medium text-green-900 mb-2">Detected Speaker Names:</h4>
                              <div className="space-y-2 text-sm text-green-800">
                                <div className="flex items-center gap-2">
                                  <span><strong>Moderator:</strong> {parsedModerator || 'Not detected'}</span>
                                </div>
                                <div className="flex items-center gap-2">
                                  <span><strong>Respondent:</strong> {parsedRespondent || 'Not detected'}</span>
                                </div>
                                {parsedModerator && parsedRespondent && (
                                  <button
                                    type="button"
                                    onClick={() => {
                                      const temp = parsedModerator;
                                      setParsedModerator(parsedRespondent);
                                      setParsedRespondent(temp);
                                    }}
                                    className="mt-2 inline-flex items-center gap-1.5 rounded px-2.5 py-1 text-xs font-medium text-green-700 bg-green-100 hover:bg-green-200 transition-colors"
                                  >
                                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16V4m0 0L3 8m4-4l4 4m6 0v12m0 0l4-4m-4 4l-4-4" />
                                    </svg>
                                    Swap Moderator ↔ Respondent
                                  </button>
                                )}
                              </div>
                            </div>
                          )}

                          {duplicateWarning && (
                            <div className="bg-yellow-50 border border-yellow-400 rounded-lg p-3">
                              <div className="flex items-start gap-2">
                                <ExclamationTriangleIcon className="h-5 w-5 text-yellow-600 flex-shrink-0 mt-0.5" />
                                <div>
                                  <h4 className="text-sm font-medium text-yellow-800">Possible Duplicate</h4>
                                  <p className="text-xs text-yellow-700 mt-1">
                                    A transcript with the same interview date and time already exists in this project.
                                  </p>
                                </div>
                              </div>
                            </div>
                          )}

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
                    <div></div>
                    <div className="flex gap-3">
                      <button
                        onClick={() => {
                          setShowUploadModal(false);
                          setUploadFile(null);
                          setCleanTranscript(true);
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

          {/* Search Modal */}
          {showSearchModal && (
            <div className="fixed inset-0 z-[999999] bg-black bg-opacity-50 flex items-center justify-center p-4" style={{ top: 0, left: 0, right: 0, bottom: 0 }}>
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

                          {result.contextBefore && (
                            <div className="text-sm text-gray-500 italic pl-4 border-l-2 border-gray-200">
                              {result.contextBefore}
                            </div>
                          )}

                          <div className="text-sm text-gray-900 pl-4 border-l-2" style={{ borderColor: BRAND_ORANGE }}>
                            <span dangerouslySetInnerHTML={{ __html: formatSearchResultText(result.highlightedText) }} />
                          </div>

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

        </div>
      </main>
    );
  }

  // Home view - show list of projects
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
                    // Count total transcripts for this project (includes un-assigned and all CA transcripts)
                    const projectTranscripts = transcripts[project.id] || [];
                    const totalUploads = projectTranscripts.length;
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
                            {totalUploads}
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
