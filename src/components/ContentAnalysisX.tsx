import { API_BASE_URL } from '../config';
import React, { useEffect, useMemo, useState, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { useAuth } from '../contexts/AuthContext';
import { CloudArrowUpIcon, TrashIcon, CalendarIcon, UserGroupIcon, UserIcon, BookOpenIcon, BeakerIcon, LightBulbIcon, ChartBarIcon, TrophyIcon, ChatBubbleLeftRightIcon, ExclamationTriangleIcon, ExclamationCircleIcon, ArrowTrendingUpIcon, UsersIcon, DocumentMagnifyingGlassIcon, CheckCircleIcon, EllipsisHorizontalCircleIcon, DocumentTextIcon, ArrowDownTrayIcon } from '@heroicons/react/24/outline';
import { IconDeviceFloppy, IconFileArrowRight, IconBook2, IconScript } from '@tabler/icons-react';
import { Document, Packer, Paragraph, TextRun, HeadingLevel, AlignmentType } from 'docx';
import ExcelJS from 'exceljs';
import { renderAsync } from 'docx-preview';
import StoryboardModal from './StoryboardModal';
import { normalizeAnalysisRespnos, buildTranscriptDisplayName } from '../utils/respnoUtils';

const BRAND_ORANGE = '#D14A2D';
const BRAND_GRAY = '#5D5F62';

type CostEstimate = {
  inputTokens: number;
  outputTokens: number;
  cost: number;
  formattedCost: string;
};

interface ContentAnalysisXProps {
  projects?: any[];
  onNavigate?: (route: string) => void;
  onNavigateToProject?: (project: any) => void;
  onProjectsChange?: () => void;
  analysisToLoad?: string | null;
  onAnalysisLoaded?: () => void;
  onNavigateToStorytelling?: (analysisId: string, projectId: string) => void;
}

interface VerbatimQuote {
  text: string;
  context: string;
}

interface VerbatimQuotesSectionProps {
  analysisId: string;
  respondentId: string;
  columnName: string;
  sheetName: string;
  keyFinding: string;
  onRefreshQuotes?: () => void;
}

// Helper function to format quote text with bold speaker tags
function formatQuoteText(text: string) {
  // First, split by lines
  const lines = text.split('\n');
  const allElements: JSX.Element[] = [];
  let key = 0;

  lines.forEach((line, lineIndex) => {
    // Check if line contains multiple speakers (e.g., "Moderator: ... Respondent: ...")
    const speakerPattern = /(Moderator|Respondent|Interviewer|Participant):\s*/gi;
    const matches = [...line.matchAll(speakerPattern)];
    
    if (matches.length > 1) {
      // Multiple speakers on same line - split them
      let lastIndex = 0;
      matches.forEach((match, matchIndex) => {
        const speaker = match[1];
        const startPos = match.index!;
        const endPos = matchIndex < matches.length - 1 ? matches[matchIndex + 1].index! : line.length;
        const content = line.substring(startPos + match[0].length, endPos).trim();
        
        // Add line break before each speaker except the first
        if (matchIndex > 0) {
          allElements.push(<br key={key++} />);
        }
        
        allElements.push(
          <React.Fragment key={key++}>
            <strong>{speaker.charAt(0).toUpperCase() + speaker.slice(1).toLowerCase()}:</strong> <em>{content}</em>
          </React.Fragment>
        );
      });
    } else if (matches.length === 1) {
      // Single speaker on line
      const match = matches[0];
      const speaker = match[1];
      const content = line.substring(match[0].length).trim();
      
      allElements.push(
        <React.Fragment key={key++}>
          <strong>{speaker.charAt(0).toUpperCase() + speaker.slice(1).toLowerCase()}:</strong> <em>{content}</em>
        </React.Fragment>
      );
    } else {
      // No speaker pattern - regular text
      allElements.push(
        <React.Fragment key={key++}>
          {line}
        </React.Fragment>
      );
    }
    
    // Add line break between different lines
    if (lineIndex < lines.length - 1) {
      allElements.push(<br key={key++} />);
    }
  });

  return <>{allElements}</>;
}

// Verbatim Quotes Section Component
function VerbatimQuotesSection({ analysisId, respondentId, columnName, sheetName, keyFinding, onRefreshQuotes }: VerbatimQuotesSectionProps) {
  const [quotes, setQuotes] = useState<VerbatimQuote[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [transcriptType, setTranscriptType] = useState<string>('');
  const [noAdditionalQuotes, setNoAdditionalQuotes] = useState(false);
  const [showNoAdditionalNote, setShowNoAdditionalNote] = useState(false);

  useEffect(() => {
    if (analysisId && respondentId && columnName && sheetName && keyFinding) {
      fetchVerbatimQuotes();
    }
  }, [analysisId, respondentId, columnName, sheetName, keyFinding]);

  const fetchVerbatimQuotes = async (excludePrevious = false) => {
    setLoading(true);
    setError(null);
    
    try {
      const response = await fetch(`${API_BASE_URL}/api/caX/get-verbatim-quotes`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${localStorage.getItem('cognitive_dash_token')}`
        },
        body: JSON.stringify({
          analysisId,
          respondentId,
          columnName,
          sheetName,
          keyFinding,
          excludePrevious: excludePrevious,
          previouslyShownQuotes: excludePrevious ? quotes : []
        })
      });

      if (response.ok) {
        const data = await response.json();
        setQuotes(data.quotes || []);
        setTranscriptType(data.transcriptType || '');
        
        // Handle no additional quotes flag
        if (data.noAdditionalQuotes) {
          setNoAdditionalQuotes(true);
          setShowNoAdditionalNote(true);
          // Clear the note after 5 seconds
          setTimeout(() => {
            setShowNoAdditionalNote(false);
          }, 5000);
        } else {
          setNoAdditionalQuotes(false);
          setShowNoAdditionalNote(false);
        }
      } else {
        const errorData = await response.json();
        setError(errorData.error || 'Failed to fetch quotes');
      }
    } catch (err) {
      setError('Network error while fetching quotes');
      console.error('Error fetching verbatim quotes:', err);
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
        <h3 className="text-sm font-semibold text-blue-900 mb-2">Loading Supporting Quotes...</h3>
        <div className="flex items-center space-x-2">
          <div className="w-4 h-4 border-2 border-blue-600 border-t-transparent rounded-full animate-spin"></div>
          <span className="text-sm text-gray-600">Finding relevant quotes from transcript...</span>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-red-50 border border-red-200 rounded-lg p-4">
        <h3 className="text-sm font-semibold text-red-900 mb-2">Error Loading Quotes</h3>
        <p className="text-sm text-red-700">{error}</p>
        <button
          onClick={() => fetchVerbatimQuotes()}
          className="mt-2 text-xs text-red-600 hover:text-red-800 underline"
        >
          Try Again
        </button>
      </div>
    );
  }

  if (quotes.length === 0) {
    return (
      <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4">
        <h3 className="text-sm font-semibold text-yellow-900 mb-2">No Supporting Quotes Found</h3>
        <p className="text-sm text-gray-600">
          No relevant quotes were found in the transcript for this key finding.
        </p>
        {transcriptType && (
          <p className="text-xs text-gray-500 mt-1">
            Source: {transcriptType} transcript
          </p>
        )}
      </div>
    );
  }

  return (
    <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <h3 className="text-sm font-semibold text-blue-900">Supporting Quotes</h3>
          {showNoAdditionalNote && (
            <span className="text-xs text-red-600 font-medium animate-pulse">
              No additional quotes available
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {transcriptType && (
            <span className="text-xs text-blue-600 bg-blue-100 px-2 py-1 rounded">
              {transcriptType} transcript
            </span>
          )}
           {onRefreshQuotes && (
             <button
               onClick={() => {
                 fetchVerbatimQuotes(true);
               }}
               disabled={noAdditionalQuotes}
               className={`text-xs px-3 py-1 rounded transition-colors ${
                 noAdditionalQuotes 
                   ? 'bg-gray-400 text-gray-200 cursor-not-allowed' 
                   : 'bg-blue-600 text-white hover:bg-blue-700'
               }`}
             >
               {noAdditionalQuotes ? 'No More Quotes' : 'Load New Quotes'}
             </button>
           )}
        </div>
      </div>
      
      <div className="space-y-4">
        {quotes.map((quote, index) => (
          <div key={index} className="bg-white rounded-lg p-4 border-l-4 border-blue-500">
            <div className="text-sm text-gray-800 leading-relaxed">
              {formatQuoteText(quote.text)}
            </div>
            {quote.context && (
              <div className="mt-2 text-xs text-gray-600 italic">
                {quote.context}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

export default function ContentAnalysisX({ projects = [], onNavigate, onNavigateToProject, onProjectsChange, analysisToLoad, onAnalysisLoaded, onNavigateToStorytelling }: ContentAnalysisXProps) {
  const { user } = useAuth();
  const [showMyProjectsOnly, setShowMyProjectsOnly] = useState(true);
  const [archivedProjects, setArchivedProjects] = useState<any[]>([]);
  const [activeTab, setActiveTab] = useState<'active' | 'archived'>('active');
  const [savedAnalyses, setSavedAnalyses] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [viewMode, setViewMode] = useState<'home' | 'viewer' | 'create' | 'project'>('home');
  const [loadingSavedView, setLoadingSavedView] = useState(false);
  const [currentAnalysis, setCurrentAnalysis] = useState<any | null>(null);
  const [selectedProject, setSelectedProject] = useState<any | null>(null);
  const [activeSheet, setActiveSheet] = useState<string>('');
  const [uploading, setUploading] = useState(false);
  const [showSaveModal, setShowSaveModal] = useState(false);
  const [saveFormData, setSaveFormData] = useState({ projectId: '', name: '', description: '' });
  const [saving, setSaving] = useState(false);
  const [processingTranscript, setProcessingTranscript] = useState(false);
  const [fillingContentAnalysis, setFillingContentAnalysis] = useState(false);
  const [highlightedRespondentId, setHighlightedRespondentId] = useState<string | null>(null);
  const [showSuccessMessage, setShowSuccessMessage] = useState(false);
  const [showSaveSuccessMessage, setShowSaveSuccessMessage] = useState(false);
  const [copiedQuoteIndex, setCopiedQuoteIndex] = useState<number | null>(null);
  const [showQuotesModal, setShowQuotesModal] = useState(false);
  const [selectedQuotes, setSelectedQuotes] = useState<string[]>([]);
  const [selectedCellInfo, setSelectedCellInfo] = useState({ column: '', respondent: '', summary: '', sheet: '' });
  const [editingColumnName, setEditingColumnName] = useState<string | null>(null);
  const [editingColumnValue, setEditingColumnValue] = useState<string>('');
  const [hoveredColumnDivider, setHoveredColumnDivider] = useState<number | null>(null);
  // Header edit state
  const [editingHeader, setEditingHeader] = useState(false);
  const [editAnalysisName, setEditAnalysisName] = useState('');
  const [editProjectId, setEditProjectId] = useState('');
  const [editingTitle, setEditingTitle] = useState(false);
  const [editingProject, setEditingProject] = useState(false);
  // Create form state
  const [createFormData, setCreateFormData] = useState({ title: '', projectId: '', discussionGuide: null as File | null });
  const [generatingAnalysis, setGeneratingAnalysis] = useState(false);
  // Discussion guide modal state
  const [showDiscussionGuideModal, setShowDiscussionGuideModal] = useState(false);
  const docxContainerRef = useRef<HTMLDivElement>(null);
  const transcriptFileInputRef = useRef<HTMLInputElement | null>(null);
  // Transcript upload modal state
  const [showTranscriptUploadModal, setShowTranscriptUploadModal] = useState(false);
  // Storyboard modal state
  const [showStoryboardModal, setShowStoryboardModal] = useState(false);
  const [generatingStoryboard, setGeneratingStoryboard] = useState(false);
  const [transcriptFile, setTranscriptFile] = useState<File | null>(null);
  // Transcripts state - stores cleaned transcripts with demographic info
  const [transcripts, setTranscripts] = useState<Array<{
    id: string;
    respno: string;
    demographics: Record<string, string>;
    cleanedTranscript: string;
    originalTranscript: string;
    uploadedAt: string;
    originalFilePath?: string;
    cleanedFilePath?: string;
    sourceTranscriptId?: string | null;
  }>>(currentAnalysis?.transcripts || []);
  const [projectTranscriptsForUpload, setProjectTranscriptsForUpload] = useState<Array<{
    id: string;
    originalFilename: string;
    cleanedFilename?: string | null;
    originalSize?: number;
    cleanedSize?: number;
    hasCleanedVersion: boolean;
    uploadedAt: number;
    respno?: string | null;
    interviewDate?: string | null;
    interviewTime?: string | null;
  }>>([]);
  const [loadingProjectTranscripts, setLoadingProjectTranscripts] = useState(false);
  const [projectTranscriptFetchError, setProjectTranscriptFetchError] = useState<string | null>(null);
  const [selectedExistingTranscriptId, setSelectedExistingTranscriptId] = useState('');
  const [existingTranscriptCostEstimate, setExistingTranscriptCostEstimate] = useState<CostEstimate | null>(null);
  
  // File paths for download
  const [transcriptFilePaths, setTranscriptFilePaths] = useState<{
    original: string | null;
    cleaned: string | null;
  }>({ original: null, cleaned: null });
  
  const fetchProjectTranscripts = useCallback(async (projectId: string) => {
    setLoadingProjectTranscripts(true);
    setProjectTranscriptFetchError(null);
    try {
      const response = await fetch(`${API_BASE_URL}/api/transcripts/all`, {
        headers: { 'Authorization': `Bearer ${localStorage.getItem('cognitive_dash_token')}` }
      });

      if (response.ok) {
        const data = await response.json();
        const items = Array.isArray(data?.[projectId]) ? data[projectId] : [];
        const sorted = items
          .slice()
          .sort((a: any, b: any) => (b?.uploadedAt || 0) - (a?.uploadedAt || 0));

        setProjectTranscriptsForUpload(sorted.map((item: any) => ({
          id: item.id,
          originalFilename: item.originalFilename,
          cleanedFilename: item.cleanedFilename,
          originalSize: item.originalSize,
          cleanedSize: item.cleanedSize,
          hasCleanedVersion: Boolean(item.cleanedPath),
          uploadedAt: item.uploadedAt || 0,
          respno: item.respno,
          interviewDate: item.interviewDate || item['Interview Date'] || null,
          interviewTime: item.interviewTime || item['Interview Time'] || null
        })));
      } else {
        setProjectTranscriptFetchError('Failed to load project transcripts');
        setProjectTranscriptsForUpload([]);
      }
    } catch (error) {
      console.error('Failed to load project transcripts:', error);
      setProjectTranscriptFetchError('Failed to load project transcripts');
      setProjectTranscriptsForUpload([]);
    } finally {
      setLoadingProjectTranscripts(false);
    }
  }, []);

  // Content Analysis generation state
  const [selectedTranscriptType, setSelectedTranscriptType] = useState<'original' | 'cleaned'>('cleaned');
  // Removed showGenerateModal - upload now directly populates CA

  // Sync transcripts when currentAnalysis changes
  useEffect(() => {
    console.log('🔄 Syncing transcripts from currentAnalysis:', currentAnalysis?.transcripts);
    if (currentAnalysis?.transcripts) {
      setTranscripts(currentAnalysis.transcripts);
    } else {
      setTranscripts([]);
    }
  }, [currentAnalysis]);

  // Transcripts already linked to ANY content analysis for this project
  // Disable them in the picker so a single project transcript cannot be
  // added to multiple content analyses
  const allProjectLinkedTranscriptIds = useMemo(() => {
    const ids = new Set<string>();
    const projectId = currentAnalysis?.projectId;
    if (!projectId) return ids;

    // Look across all saved analyses for this project
    (savedAnalyses || [])
      .filter(a => a?.projectId === projectId)
      .forEach(analysis => {
        (analysis?.transcripts || []).forEach((t: any) => {
          if (t?.sourceTranscriptId) ids.add(String(t.sourceTranscriptId));
          if (t?.id) ids.add(String(t.id));
        });
      });
    return ids;
  }, [savedAnalyses, currentAnalysis?.projectId]);

  const projectTranscriptsById = useMemo(() => {
    const map = new Map<string, {
      id: string;
      originalFilename: string;
      cleanedFilename?: string | null;
      originalSize?: number;
      cleanedSize?: number;
      hasCleanedVersion: boolean;
      uploadedAt: number;
      respno?: string | null;
      interviewDate?: string | null;
      interviewTime?: string | null;
    }>();
    projectTranscriptsForUpload.forEach(record => {
      map.set(record.id, record);
    });
    return map;
  }, [projectTranscriptsForUpload]);

  // Project filtering logic (same as Transcripts tab)
  const isQualitative = (project: any) => {
    const methodology = project?.methodologyType?.toLowerCase();
    console.log('🔍 CA - Checking project:', project?.name, 'methodology:', methodology);
    
    // If no methodology type, assume it's qualitative (for backward compatibility)
    if (!methodology) {
      console.log('🔍 CA - No methodology type, assuming qualitative');
      return true;
    }
    
    const isQual = methodology?.includes('qualitative') || 
           methodology?.includes('qual') ||
           methodology?.includes('interview') ||
           methodology?.includes('focus group') ||
           methodology?.includes('ethnography') ||
           methodology?.includes('observation');
    console.log('🔍 CA - Is qualitative:', isQual);
    return isQual;
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
    (list: any[]) => {
      if (!showMyProjectsOnly || !user) return list;

      const uid = String((user as any)?.id || '').toLowerCase();
      const uemail = String((user as any)?.email || '').toLowerCase();
      const uname = String((user as any)?.name || '').toLowerCase();

      return list.filter(project => {
        // Check if user is assigned to the project via team members
        const teamMembers = Array.isArray((project as any)?.teamMembers)
          ? (project as any).teamMembers
          : [];

        const inTeam = teamMembers.some((member: any) => {
          const mid = String(member?.id || '').toLowerCase();
          const memail = String(member?.email || '').toLowerCase();
          const mname = String(member?.name || '').toLowerCase();
          return (uid && mid === uid) || (uemail && memail === uemail) || (uname && mname === uname);
        });

        // Also check if user is the creator (for backward compatibility)
        const createdBy = String((project as any)?.createdBy || '').toLowerCase();
        const createdByMe = !!createdBy && (createdBy === uid || createdBy === uemail);

        return inTeam || createdByMe;
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

  const displayProjects = activeTab === 'active' ? filteredActiveProjects : filteredArchivedProjects;

  const currentProjectName = useMemo(() => {
    if (currentAnalysis?.projectName) return currentAnalysis.projectName;
    if (currentAnalysis?.projectId && Array.isArray(projects)) {
      const match = projects.find((p: any) => p?.id === currentAnalysis.projectId);
      if (match?.name) return match.name;
    }
    return '';
  }, [currentAnalysis?.projectName, currentAnalysis?.projectId, projects]);

  const transcriptDropdownOptions = useMemo(() => {
    return projectTranscriptsForUpload.map(record => {
      const disabled = allProjectLinkedTranscriptIds.has(record.id);
      const labelParts = [
        buildTranscriptDisplayName({
          projectName: currentProjectName,
          respno: record.respno,
          interviewDate: record.interviewDate,
          interviewTime: record.interviewTime,
          fallbackFilename: record.originalFilename
        }) || record.originalFilename || 'Transcript'
      ];
      if (record.hasCleanedVersion) {
        labelParts.push('cleaned available');
      }
      if (disabled) {
        labelParts.push('already imported');
      }
      return {
        id: record.id,
        label: labelParts.join(' - '),
        disabled
      };
    });
  }, [projectTranscriptsForUpload, allProjectLinkedTranscriptIds]);

  useEffect(() => {
    if (!showTranscriptUploadModal || !currentAnalysis?.projectId) {
      return;
    }
    fetchProjectTranscripts(currentAnalysis.projectId);
  }, [showTranscriptUploadModal, currentAnalysis?.projectId, fetchProjectTranscripts]);

  useEffect(() => {
    if (selectedExistingTranscriptId && allProjectLinkedTranscriptIds.has(selectedExistingTranscriptId)) {
      setSelectedExistingTranscriptId('');
    }
  }, [selectedExistingTranscriptId, allProjectLinkedTranscriptIds]);

  useEffect(() => {
    if (!selectedExistingTranscriptId) {
      setExistingTranscriptCostEstimate(null);
      return;
    }

    const record = projectTranscriptsById.get(selectedExistingTranscriptId);
    if (!record) {
      setExistingTranscriptCostEstimate(null);
      return;
    }

    const preferredFilename = record.hasCleanedVersion && record.cleanedFilename ? record.cleanedFilename : record.originalFilename;
    const sizeToUse = record.hasCleanedVersion && record.cleanedSize ? record.cleanedSize : record.originalSize;

    if (sizeToUse) {
      const estimate = calculateCostEstimateFromSize(sizeToUse, preferredFilename || record.originalFilename || 'transcript.txt');
      setExistingTranscriptCostEstimate(estimate);
    } else {
      setExistingTranscriptCostEstimate(null);
    }
  }, [selectedExistingTranscriptId, projectTranscriptsById]);

  // Load archived projects
  useEffect(() => {
    const loadArchivedProjects = async () => {
      if (!user?.id) return;
      try {
        const response = await fetch(`${API_BASE_URL}/api/projects/archived?userId=${user.id}`, {
          headers: { 'Authorization': `Bearer ${localStorage.getItem('cognitive_dash_token')}` }
        });
        if (response.ok) {
          const data = await response.json();
          setArchivedProjects(data.projects || []);
        }
      } catch (error) {
        console.error('Failed to load archived projects:', error);
      }
    };
    loadArchivedProjects();
  }, [user?.id]);

  // Dynamic headers: union of keys across all rows for the active sheet
  const dynamicHeaders = useMemo(() => {
    if (activeSheet === 'Demographics') {
      // For Demographics sheet, start with specific columns
      const baseHeaders = ['Respondent ID', 'Interview Date', 'Interview Time'];
      
      // Get all columns from the data to include any added columns
      const rows = (currentAnalysis?.data?.[activeSheet] as any[]) || [];
      const allColumns = new Set<string>();
      for (const r of rows) {
        Object.keys(r || {}).forEach((k) => allColumns.add(k));
      }
      
      // Start with base headers, then add any additional columns that aren't in the base set
      const additionalColumns = Array.from(allColumns).filter(col =>
        !baseHeaders.includes(col) &&
        col !== 'Original Transcript' &&
        col !== 'Cleaned Transcript' &&
        col !== 'Populate C.A.' &&
        col !== 'respno' && // Exclude respno since we're using Respondent ID
        col !== 'transcriptId' // Exclude transcriptId (internal metadata)
      );
      
      return [...baseHeaders, ...additionalColumns];
    }
    
    // For other sheets, use the original logic
    const rows = (currentAnalysis?.data?.[activeSheet] as any[]) || [];
    const set = new Set<string>();
    for (const r of rows) {
      Object.keys(r || {}).forEach((k) => set.add(k));
    }
    const headers = Array.from(set);

    // Remove duplicate respno column if Respondent ID exists
    if (headers.includes('Respondent ID') && headers.includes('respno')) {
      const respnoIndex = headers.indexOf('respno');
      headers.splice(respnoIndex, 1);
    }

    return headers;
  }, [currentAnalysis?.data, activeSheet, transcripts.length]);

  // Handler for deleting a demographic column
  const handleDeleteDemographicColumn = async (columnName: string) => {
    if (!currentAnalysis || activeSheet !== 'Demographics') return;
    if (columnName === 'Respondent ID' || columnName === 'respno') return; // Don't delete respondent ID

    const updatedData = { ...currentAnalysis.data };
    const demographicsData = updatedData.Demographics;

    // Remove the column from all rows
    const updatedRows = demographicsData.map((row: any) => {
      const newRow = { ...row };
      delete newRow[columnName];
      return newRow;
    });

    updatedData.Demographics = updatedRows;

    setCurrentAnalysis({
      ...currentAnalysis,
      data: updatedData
    });

    // Auto-save if this is a saved analysis
    if (currentAnalysis.projectId && !currentAnalysis.id?.startsWith('temp-')) {
      try {
        const response = await fetch(`${API_BASE_URL}/api/caX/update`, {
          method: 'PUT',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${localStorage.getItem('cognitive_dash_token')}`
          },
          body: JSON.stringify({
            id: currentAnalysis.id,
            data: updatedData,
            quotes: currentAnalysis.quotes || {}
          })
        });

        if (!response.ok) {
          console.error('Auto-save failed for demographic column deletion');
        }
      } catch (error) {
        console.error('Failed to auto-save demographic column deletion:', error);
      }
    }
  };

  // Handler for renaming a demographic column
  const handleRenameColumn = async (oldName: string, newName: string) => {
    if (!currentAnalysis || activeSheet !== 'Demographics') return;
    if (oldName === 'Respondent ID' || oldName === 'respno') return; // Don't rename respondent ID
    if (!newName.trim() || newName === oldName) {
      setEditingColumnName(null);
      return;
    }

    const updatedData = { ...currentAnalysis.data };
    const demographicsData = updatedData.Demographics;

    // Rename the column in all rows
    const updatedRows = demographicsData.map((row: any) => {
      const newRow: any = {};
      Object.keys(row).forEach(key => {
        if (key === oldName) {
          newRow[newName] = row[key];
        } else {
          newRow[key] = row[key];
        }
      });
      return newRow;
    });

    updatedData.Demographics = updatedRows;

    setCurrentAnalysis({
      ...currentAnalysis,
      data: updatedData
    });
    setEditingColumnName(null);

    // Auto-save if this is a saved analysis
    if (currentAnalysis.projectId && !currentAnalysis.id?.startsWith('temp-')) {
      try {
        const response = await fetch(`${API_BASE_URL}/api/caX/update`, {
          method: 'PUT',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${localStorage.getItem('cognitive_dash_token')}`
          },
          body: JSON.stringify({
            id: currentAnalysis.id,
            data: updatedData,
            quotes: currentAnalysis.quotes || {}
          })
        });

        if (!response.ok) {
          console.error('Auto-save failed for column rename');
        }
      } catch (error) {
        console.error('Failed to auto-save column rename:', error);
      }
    }
  };

  // Handler for adding a new demographic column at a specific position
  const handleAddDemographicColumn = async (afterColumnIndex: number) => {
    if (!currentAnalysis || activeSheet !== 'Demographics') return;

    const updatedData = { ...currentAnalysis.data };
    const demographicsData = updatedData.Demographics;

    // Get existing columns
    const existingColumns = Object.keys(demographicsData[0] || {});

    // Generate new column name
    let columnNumber = 1;
    let newColumnName = `New Column ${columnNumber}`;
    while (existingColumns.includes(newColumnName)) {
      columnNumber++;
      newColumnName = `New Column ${columnNumber}`;
    }

    // Add the new column to all rows at the specified position
    const updatedRows = demographicsData.map((row: any) => {
      const rowKeys = Object.keys(row);
      const newRow: any = {};

      // Insert columns in order, adding new column after the specified index
      rowKeys.forEach((key, index) => {
        newRow[key] = row[key];
        // Insert new column after this position
        if (index === afterColumnIndex) {
          newRow[newColumnName] = '';
        }
      });

      return newRow;
    });

    updatedData.Demographics = updatedRows;

    setCurrentAnalysis({
      ...currentAnalysis,
      data: updatedData
    });

    // Auto-save if this is a saved analysis
    if (currentAnalysis.projectId && !currentAnalysis.id?.startsWith('temp-')) {
      try {
        const response = await fetch(`${API_BASE_URL}/api/caX/update`, {
          method: 'PUT',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${localStorage.getItem('cognitive_dash_token')}`
          },
          body: JSON.stringify({
            id: currentAnalysis.id,
            data: updatedData,
            quotes: currentAnalysis.quotes || {}
          })
        });

        if (!response.ok) {
          console.error('Auto-save failed for new demographic column');
        }
      } catch (error) {
        console.error('Failed to auto-save new demographic column:', error);
      }
    }
  };

  // Handler for updating demographic data
  const handleDemographicChange = async (respondentId: string, columnKey: string, value: string) => {
    if (!currentAnalysis || activeSheet !== 'Demographics') return;

    const updatedData = { ...currentAnalysis.data };

    // Find the actual row index in the Demographics data by respondent ID
    const actualRowIndex = updatedData.Demographics.findIndex((row: any) => {
      const rowRespondentId = row['Respondent ID'] || row['respno'];
      return rowRespondentId === respondentId;
    });

    if (actualRowIndex !== -1) {
      updatedData.Demographics[actualRowIndex][columnKey] = value;

      // Also update the corresponding transcript demographics if it exists
      const updatedTranscripts = transcripts.map(transcript => {
        if (transcript.respno === respondentId) {
          return {
            ...transcript,
            demographics: {
              ...transcript.demographics,
              [columnKey]: value
            }
          };
        }
        return transcript;
      });

      setTranscripts(updatedTranscripts);

      setCurrentAnalysis({
        ...currentAnalysis,
        data: updatedData,
        transcripts: updatedTranscripts
      });

      // Auto-save if this is a saved analysis
      if (currentAnalysis.projectId && !currentAnalysis.id?.startsWith('temp-')) {
        try {
          const response = await fetch(`${API_BASE_URL}/api/caX/update`, {
            method: 'PUT',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${localStorage.getItem('cognitive_dash_token')}`
            },
            body: JSON.stringify({
              id: currentAnalysis.id,
              data: updatedData,
              quotes: currentAnalysis.quotes || {},
              transcripts: updatedTranscripts
            })
          });

          if (!response.ok) {
            console.error('Auto-save failed for demographic change');
          }
        } catch (error) {
          console.error('Failed to auto-save demographic change:', error);
        }
      }
    }
  };

  // Extract context from transcript around a quote
  const extractContext = (transcript: string, quote: string): { context: string; matchedQuote: string } | null => {
    if (!transcript || !quote) return null;

    // Clean the quote for better matching
    const cleanQuote = quote.trim().toLowerCase();
    if (cleanQuote.length < 10) return null; // Skip very short quotes

    // Split transcript into lines
    const lines = transcript.split('\n');
    let contextLines: string[] = [];
    let foundQuote = false;
    let matchedQuoteText = '';

    // Extract quote words for matching
    const quoteWords = cleanQuote.split(/\s+/).filter(w => w.length > 3);

    // Find the quote in the transcript - look for the best match
    let bestMatchIndex = -1;
    let bestMatchLength = 0;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line) continue;

      // Skip moderator lines for quote matching
      if (line.startsWith('Moderator:')) continue;

      const lineLower = line.toLowerCase();

      // Check if this line contains a significant portion of the quote
      // Look for at least 70% of the quote text
      const lineWords = lineLower.split(/\s+/);

      let matchingWords = 0;
      for (const qWord of quoteWords) {
        if (lineWords.some(lWord => lWord.includes(qWord) || qWord.includes(lWord))) {
          matchingWords++;
        }
      }

      const matchPercentage = quoteWords.length > 0 ? matchingWords / quoteWords.length : 0;

      if (matchPercentage > 0.5 && matchingWords > bestMatchLength) {
        bestMatchLength = matchingWords;
        bestMatchIndex = i;
      }
    }

    if (bestMatchIndex === -1) {
      // Fallback: simple contains check
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim();
        if (line && line.toLowerCase().includes(cleanQuote.substring(0, Math.min(50, cleanQuote.length)))) {
          bestMatchIndex = i;
          break;
        }
      }
    }

    if (bestMatchIndex !== -1) {
      foundQuote = true;
      const i = bestMatchIndex;

      // Extract the matched quote line (remove "Respondent:" prefix if present)
      matchedQuoteText = lines[i].trim();
      if (matchedQuoteText.startsWith('Respondent:')) {
        matchedQuoteText = matchedQuoteText.substring('Respondent:'.length).trim();
      }

      // Collect extended topical context
      // Find the start: look back for moderator question that introduced this topic
      let startIdx = Math.max(0, i - 3);
      for (let j = i - 1; j >= Math.max(0, i - 12); j--) {
        if (lines[j].trim().startsWith('Moderator:')) {
          startIdx = j;
          break;
        }
      }

      // Find the end: continue forward through the topical discussion
      // Include all follow-up Q&A that contains key topic words from the quote
      let endIdx = i;
      const topicWords = quoteWords.slice(0, 3); // Use top 3 words from quote as topic indicators

      for (let j = i + 1; j < Math.min(lines.length, i + 40); j++) {
        const line = lines[j].trim();
        if (!line) continue;

        const lineLower = line.toLowerCase();

        // Check if this line is still about the same topic
        const hasTopicWords = topicWords.some(word => lineLower.includes(word));

        if (line.startsWith('Moderator:') || line.startsWith('Respondent:')) {
          // If the line mentions topic words OR is within 5 lines of last topic mention, include it
          if (hasTopicWords || (j - endIdx <= 5)) {
            endIdx = j;
          } else {
            // We've moved to a different topic
            break;
          }
        }
      }

      // Collect the context lines
      for (let j = startIdx; j <= endIdx; j++) {
        const contextLine = lines[j].trim();
        if (contextLine) {
          contextLines.push(contextLine);
        }
      }
    }

    return foundQuote ? { context: contextLines.join('\n'), matchedQuote: matchedQuoteText } : null;
  };

  // Export content analysis to Excel
  const handleExportToExcel = async () => {
    if (!currentAnalysis || !currentAnalysis.data) return;

    const workbook = new ExcelJS.Workbook();

    // Get all sheet names from the data
    const sheetNames = Object.keys(currentAnalysis.data);

    sheetNames.forEach((sheetName) => {
      const sheetData = currentAnalysis.data[sheetName];
      if (!Array.isArray(sheetData) || sheetData.length === 0) return;

      // Filter out rows that are mostly empty or have "New Column" entries
      const filteredRows = sheetData.filter(row => {
        const hasData = Object.values(row).some(value => 
          value && 
          value.toString().trim() !== '' && 
          !value.toString().startsWith('New Column')
        );
        return hasData;
      });

      if (filteredRows.length === 0) return;

      // Get all possible columns from filtered rows, excluding "New Column" entries and internal metadata
      const allCols = new Set<string>();
      filteredRows.forEach((row: any) => {
        Object.keys(row).forEach(key => {
          if (!key.startsWith('New Column') && key !== 'transcriptId') {
            allCols.add(key);
          }
        });
      });

      // Remove "Respondent ID" if "respno" exists, and ensure "respno" is first
      const cols = Array.from(allCols);
      let headerArray = cols;

      if (cols.includes('respno')) {
        // Remove "Respondent ID" if it exists
        headerArray = cols.filter(col => col !== 'Respondent ID');
        // Move "respno" to the front
        const respnoIndex = headerArray.indexOf('respno');
        if (respnoIndex > -1) {
          headerArray.splice(respnoIndex, 1);
          headerArray.unshift('respno');
        }
      }

      // Create worksheet with truncated name (Excel limit is 31 chars)
      const truncatedSheetName = sheetName.length > 31 ? sheetName.substring(0, 31) : sheetName;
      const worksheet = workbook.addWorksheet(truncatedSheetName);

      // Add header row
      worksheet.addRow(headerArray);

      // Style header row
      const headerRow = worksheet.getRow(1);
      headerRow.font = { bold: true };
      headerRow.fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'FFD3D3D3' }
      };
      headerRow.alignment = { vertical: 'middle', horizontal: 'left' };

      // Add data rows - only include summary text (first line before newline)
      sheetData.forEach((row: any) => {
        const rowData = headerArray.map(header => {
          const value = row[header];
          if (typeof value === 'string') {
            // Extract only the summary (first line or text before double newline)
            const summaryMatch = value.split('\n\n')[0] || value.split('\n')[0] || value;
            return summaryMatch.trim();
          }
          return value || '';
        });
        worksheet.addRow(rowData);
      });

      // Set column widths and apply text wrapping
      worksheet.columns.forEach((column, index) => {
        const header = headerArray[index];

        if (sheetName === 'Demographics') {
          // For Demographics: auto-fit all columns
          let maxWidth = header?.length || 10;
          column.eachCell?.({ includeEmpty: false }, (cell) => {
            const cellLength = String(cell.value || '').length;
            maxWidth = Math.max(maxWidth, cellLength);
          });
          column.width = Math.min(maxWidth + 2, 50);
        } else {
          // For other sheets: respno column auto-fit, others standard width of 50
          if (header === 'respno' || header === 'Respondent ID') {
            let maxWidth = header?.length || 10;
            column.eachCell?.({ includeEmpty: false }, (cell) => {
              const cellLength = String(cell.value || '').length;
              maxWidth = Math.max(maxWidth, cellLength);
            });
            column.width = maxWidth + 2;
          } else {
            column.width = 50;
          }

          // Apply text wrapping to all data cells (not header)
          column.eachCell?.({ includeEmpty: false }, (cell, rowNumber) => {
            if (rowNumber > 1) { // Skip header row
              cell.alignment = { wrapText: true, vertical: 'top', horizontal: 'left' };
            }
          });
        }
      });
    });

    // Generate filename
    const filename = `${currentAnalysis.name || 'Content_Analysis'}_${new Date().toISOString().split('T')[0]}.xlsx`;

    // Download file
    const buffer = await workbook.xlsx.writeBuffer();
    const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    const url = window.URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    link.click();
    window.URL.revokeObjectURL(url);
  };


  // Handler for storyboard generation
  const handleGenerateStoryboard = async (selectedFiles: string[], costEstimate: CostEstimate) => {
    console.log('🚀 Starting storyboard generation with files:', selectedFiles);
    setGeneratingStoryboard(true);
    try {
      const response = await fetch(`${API_BASE_URL}/api/caX/generate-storyboard`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${localStorage.getItem('cognitive_dash_token')}`
        },
        body: JSON.stringify({
          analysisId: currentAnalysis?.id,
          projectId: currentAnalysis?.projectId,
          selectedFiles,
          costEstimate
        })
      });

      console.log('📡 Storyboard response status:', response.status);
      
      if (response.ok) {
        console.log('✅ Storyboard generated successfully');
        const blob = await response.blob();
        const url = window.URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = `Storyboard_${currentAnalysis?.name || 'Analysis'}_${new Date().toISOString().split('T')[0]}.docx`;
        link.click();
        window.URL.revokeObjectURL(url);
        
        setShowStoryboardModal(false);
      } else {
        const errorText = await response.text();
        console.error('❌ Failed to generate storyboard:', response.status, errorText);
        alert(`Failed to generate storyboard: ${response.status} ${errorText}`);
      }
    } catch (error) {
      console.error('❌ Error generating storyboard:', error);
      alert(`Error generating storyboard: ${error.message}`);
    } finally {
      console.log('🏁 Storyboard generation finished');
      setGeneratingStoryboard(false);
    }
  };

  // Handler for cell click to show quotes
  const handleCellClick = (row: any, columnKey: string) => {
    // Skip Demographics and respno column
    if (activeSheet === 'Demographics' || columnKey === 'Respondent ID' || columnKey === 'respno') return;

    const respondentId = row['Respondent ID'] || row['respno'] || 'Unknown';

    // Get quotes from the analysis data (if stored)
    const quotes = currentAnalysis?.quotes?.[activeSheet]?.[respondentId]?.[columnKey] || [];

    // Get the cell value (summary finding)
    const cellValue = row[columnKey] || '';

    // Show modal even if no quotes (will display "No quotes available" message)
    setSelectedQuotes(quotes);
    setSelectedCellInfo({ column: columnKey, respondent: respondentId, summary: cellValue, sheet: activeSheet });
    setShowQuotesModal(true);
  };

  // Handler for deleting a respondent


  const handleDeleteRespondent = async (respondentId: string) => {
    if (!currentAnalysis) return;

    if (!confirm("Delete this respondent? This cannot be undone.")) {
      return;
    }

    const updatedData = { ...currentAnalysis.data };

    // Remove the respondent from all sheets by matching respondent ID
    Object.keys(updatedData).forEach(sheetName => {
      if (Array.isArray(updatedData[sheetName])) {
        updatedData[sheetName] = updatedData[sheetName].filter((row: any) => {
          const rowRespondentId = row['Respondent ID'] || row['respno'];
          return rowRespondentId !== respondentId;
        });

        // Don't add empty placeholder rows - let the sheet be empty
        // Column structure will be preserved when new data is added
      }
    });

    // Filter out quotes and context for deleted respondent
    const filteredQuotes: any = {};
    Object.keys(currentAnalysis.quotes || {}).forEach(sheetName => {
      filteredQuotes[sheetName] = {};
      const sheetQuotes = currentAnalysis.quotes[sheetName] || {};
      Object.keys(sheetQuotes).forEach(oldId => {
        if (oldId !== respondentId) {
          filteredQuotes[sheetName][oldId] = sheetQuotes[oldId];
        }
      });
    });

    const filteredContext: any = {};
    Object.keys(currentAnalysis.context || {}).forEach(sheetName => {
      filteredContext[sheetName] = {};
      const sheetContext = currentAnalysis.context[sheetName] || {};
      Object.keys(sheetContext).forEach(oldId => {
        if (oldId !== respondentId) {
          filteredContext[sheetName][oldId] = sheetContext[oldId];
        }
      });
    });

    // Filter out transcripts for deleted respondent
    const filteredTranscripts = transcripts.filter(t => t.respno !== respondentId);

    // Update the analysis with transcripts (no reordering - maintain upload order)
    const updatedAnalysis = {
      ...currentAnalysis,
      data: updatedData,
      quotes: filteredQuotes,
      context: filteredContext,
      transcripts: filteredTranscripts
    };

    const normalizedAnalysis = normalizeAnalysisRespnos(updatedAnalysis, projectTranscriptsForUpload);

    setCurrentAnalysis(normalizedAnalysis);

    // Update transcripts
    setTranscripts(normalizedAnalysis.transcripts || []);

    // Save to localStorage
    const updatedAnalyses = savedAnalyses.map(a =>
      a.id === currentAnalysis.id
        ? normalizedAnalysis
        : a
    );
    setSavedAnalyses(updatedAnalyses);
    localStorage.setItem('contentAnalyses', JSON.stringify(updatedAnalyses));

    // Auto-save if this is a saved analysis
    if (currentAnalysis.projectId) {
      try {
        await fetch(`${API_BASE_URL}/api/caX/update`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${localStorage.getItem('cognitive_dash_token')}` },
          body: JSON.stringify({
            id: currentAnalysis.id,
            data: normalizedAnalysis.data,
            quotes: normalizedAnalysis.quotes || filteredQuotes,
            context: normalizedAnalysis.context || filteredContext,
            transcripts: normalizedAnalysis.transcripts || []
          })
        });
      } catch (error) {
        console.error('Auto-save error:', error);
      }
    }
  };

  // Function to get icon for sheet name
  const getSheetIcon = (sheetName: string) => {
    const name = sheetName.toLowerCase();

    // Demographics and personal info
    if (name.includes('demographic')) return UserIcon;
    if (name.includes('introduction') || name.includes('intro')) return ChatBubbleLeftRightIcon;
    if (name.includes('background')) return BookOpenIcon;

    // Attitudes and perceptions
    if (name.includes('awareness') || name.includes('perception') || name.includes('attitude')) return LightBulbIcon;
    if (name.includes('opinion') || name.includes('thought')) return ChatBubbleLeftRightIcon;

    // Barriers and challenges
    if (name.includes('barrier') || name.includes('challenge') || name.includes('unmet')) return ExclamationTriangleIcon;
    if (name.includes('concern') || name.includes('worry')) return ExclamationCircleIcon;

    // Motivations and future
    if (name.includes('motivation') || name.includes('future') || name.includes('consideration')) return ArrowTrendingUpIcon;
    if (name.includes('goal') || name.includes('aspiration')) return TrophyIcon;

    // Community and engagement
    if (name.includes('community') || name.includes('engagement') || name.includes('info') || name.includes('source')) return UserGroupIcon;
    if (name.includes('social') || name.includes('network')) return UsersIcon;

    // Treatment and medical
    if (name.includes('treatment') || name.includes('therapy')) return BeakerIcon;
    if (name.includes('medication') || name.includes('drug')) return BeakerIcon;

    // Analysis and comparison
    if (name.includes('comparison') || name.includes('competitive')) return ChartBarIcon;
    if (name.includes('analysis') || name.includes('review')) return DocumentMagnifyingGlassIcon;

    // Closing
    if (name.includes('conclude') || name.includes('thank') || name.includes('closing')) return CheckCircleIcon;
    if (name.includes('misc') || name.includes('other') || name.includes('additional')) return EllipsisHorizontalCircleIcon;

    // Use a simple hash to pick a varied icon for unknown sheets
    const hash = sheetName.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0);
    const icons = [ChatBubbleLeftRightIcon, LightBulbIcon, BeakerIcon, ChartBarIcon, DocumentTextIcon];
    return icons[hash % icons.length];
  };

  const fetchSavedAnalyses = async () => {
    setLoading(true);
    try {
      // Add timeout to prevent hanging
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 5000); // 5 second timeout
      
      const res = await fetch(`${API_BASE_URL}/api/caX/saved`, {
        signal: controller.signal,
        headers: { 'Authorization': `Bearer ${localStorage.getItem('cognitive_dash_token')}` }
      });
      clearTimeout(timeoutId);
      
      if (!res.ok) {
        throw new Error(`HTTP error! status: ${res.status}`);
      }
      const json = await res.json();
      const normalized = Array.isArray(json)
        ? json.map((analysis: any) => normalizeAnalysisRespnos(analysis, projectTranscriptsForUpload))
        : [];
      setSavedAnalyses(normalized);
    } catch (e) {
      console.error('Failed to load saved analyses:', e);
      // Set empty array and stop loading even if server is not available
      setSavedAnalyses([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchSavedAnalyses();
  }, []);

  // Load specific analysis when analysisToLoad prop changes
  useEffect(() => {
    if (analysisToLoad && savedAnalyses.length > 0) {
      const analysis = savedAnalyses.find(a => a.id === analysisToLoad);
      if (analysis) {
        loadSavedAnalysis(analysis);
        onAnalysisLoaded?.();
      }
    }
  }, [analysisToLoad, savedAnalyses]);

  // Separate effect for event listener that depends on savedAnalyses
  useEffect(() => {
    const handleLoadAnalysis = (event: any) => {
      const { analysisId } = event.detail;
      console.log('handleLoadAnalysis called with analysisId:', analysisId);
      console.log('savedAnalyses:', savedAnalyses);

      // If savedAnalyses is empty, wait and retry
      if (savedAnalyses.length === 0) {
        console.log('savedAnalyses is empty, retrying in 200ms...');
        setTimeout(() => {
          const analysis = savedAnalyses.find((a: any) => a.id === analysisId);
          if (analysis) {
            loadSavedAnalysis(analysis);
          } else {
            console.log('No analysis found after retry with id:', analysisId);
          }
        }, 200);
        return;
      }

      const analysis = savedAnalyses.find(a => a.id === analysisId);
      console.log('Found analysis:', analysis);
      if (analysis) {
        loadSavedAnalysis(analysis);
      } else {
        console.log('No analysis found with id:', analysisId);
      }
    };

    const handleOpenDiscussionGuide = async () => {
      setShowDiscussionGuideModal(true);
      // Fetch and render the discussion guide
      setTimeout(async () => {
        if (!currentAnalysis?.projectId) return;
        try {
          const response = await fetch(`${API_BASE_URL}/api/caX/discussion-guide/${currentAnalysis.projectId}/download`, {
            headers: { 'Authorization': `Bearer ${localStorage.getItem('cognitive_dash_token')}` }
          });
          if (response.ok) {
            const blob = await response.blob();
            if (docxContainerRef.current) {
              docxContainerRef.current.innerHTML = ''; // Clear previous content
              await renderAsync(blob, docxContainerRef.current);
            }
          } else {
            console.error('Discussion guide not found');
            if (docxContainerRef.current) {
              docxContainerRef.current.innerHTML = '<div class="p-8 text-center text-gray-500">No discussion guide found for this project</div>';
            }
          }
        } catch (error) {
          console.error('Error loading discussion guide:', error);
          if (docxContainerRef.current) {
            docxContainerRef.current.innerHTML = '<div class="p-8 text-center text-red-500">Error loading discussion guide</div>';
          }
        }
      }, 100);
    };

    window.addEventListener('loadContentAnalysis', handleLoadAnalysis);
    window.addEventListener('openDiscussionGuide', handleOpenDiscussionGuide);
    return () => {
      window.removeEventListener('loadContentAnalysis', handleLoadAnalysis);
      window.removeEventListener('openDiscussionGuide', handleOpenDiscussionGuide);
    };
  }, [savedAnalyses]); // Now properly includes savedAnalyses

  const withProjectOnly = useMemo(() => (savedAnalyses || []).filter(a => !!a.projectId), [savedAnalyses]);

  const getProjectName = (analysis: any) => (
    analysis.project || analysis.projectName || projects.find(p => p.id === analysis.projectId)?.name || 'Unknown Project'
  );

  const matchesUserMembership = useCallback(
    (project: any) => {
      if (!showMyProjectsOnly || !user) return true;

      const uid = String((user as any)?.id || '').toLowerCase();
      const uemail = String((user as any)?.email || '').toLowerCase();
      const uname = String((user as any)?.name || '').toLowerCase();

      const createdBy = String((project as any)?.createdBy || '').toLowerCase();
      const createdByMe =
        createdBy && (createdBy === uid || createdBy === uemail);

      const teamMembers = Array.isArray(project?.teamMembers)
        ? project.teamMembers
        : [];

      const inTeam = teamMembers.some((member: any) => {
        const mid = String(member?.id || '').toLowerCase();
        const memail = String(member?.email || '').toLowerCase();
        const mname = String(member?.name || '').toLowerCase();
        return (uid && mid === uid) || (uemail && memail === uemail) || (uname && mname === uname);
      });

      return createdByMe || inTeam;
    },
    [showMyProjectsOnly, user]
  );

  const filtered = useMemo(
    () =>
      withProjectOnly.filter((analysis: any) => {
        const project = projects.find((p: any) => p.id === analysis.projectId);
        return project ? matchesUserMembership(project) : false;
      }),
    [withProjectOnly, projects, matchesUserMembership]
  );

  const filteredProjects = useMemo(() => {
    const qualProjects = projects.filter(
      p => !p.archived && p.methodologyType === 'Qualitative'
    );

    return qualProjects.filter(matchesUserMembership);
  }, [projects, matchesUserMembership]);

  const getRespondentCount = (analysis: any) => {
    if (!analysis.data || !analysis.data.Demographics) return 0;
    if (!Array.isArray(analysis.data.Demographics)) return 0;

    // Count only rows with valid respondent IDs (starting with 'R' or having a valid respno)
    const validRespondents = analysis.data.Demographics.filter((row: any) => {
      const respondentId = row['Respondent ID'] || row['respno'];
      return respondentId && String(respondentId).trim().startsWith('R');
    });

    return validRespondents.length;
  };

  const loadSavedAnalysis = async (analysis: any) => {
    setViewMode('viewer');
    setLoadingSavedView(true);
    try {
      const token = localStorage.getItem('cognitive_dash_token');
      // Try to fetch full analysis (including quotes) by id
      const resp = await fetch(`${API_BASE_URL}/api/caX/saved/${analysis.id}`, {
        headers: token ? { 'Authorization': `Bearer ${token}` } : undefined,
      });
      if (resp.ok) {
        const full = await resp.json();
        
        // Load project transcripts directly for normalization
        let projectTranscripts = [];
        if (analysis.projectId) {
          try {
            const response = await fetch(`${API_BASE_URL}/api/transcripts/all`, {
              headers: { 'Authorization': `Bearer ${localStorage.getItem('cognitive_dash_token')}` }
            });
            if (response.ok) {
              const data = await response.json();
              const projectTranscriptsData = Array.isArray(data?.[analysis.projectId]) ? data[analysis.projectId] : [];
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
        
        console.log('🔍 Project transcripts for normalization:', projectTranscripts);
        console.log('🔍 Analysis demographics before normalization:', full?.data?.Demographics);
        
        const normalizedFull = normalizeAnalysisRespnos(full || analysis, projectTranscripts);
        
        console.log('🔍 Normalizing analysis with transcripts:', {
          analysisId: analysis.id,
          projectTranscriptsCount: projectTranscripts?.length || 0,
          demographicsBefore: full?.data?.Demographics?.map((r: any) => ({
            respno: r['Respondent ID'] || r['respno'],
            date: r['Interview Date'] || r['Date'],
            time: r['Interview Time'] || r['Time']
          })),
          demographicsAfter: normalizedFull?.data?.Demographics?.map((r: any) => ({
            respno: r['Respondent ID'] || r['respno'],
            date: r['Interview Date'] || r['Date'],
            time: r['Interview Time'] || r['Time']
          }))
        });
        
        console.log('🔍 Analysis demographics after normalization:', normalizedFull?.data?.Demographics);
        setCurrentAnalysis(normalizedFull);
        setTranscripts(normalizedFull?.transcripts || []);
        const sheets = Object.keys(normalizedFull?.data || {});
        if (sheets.length) setActiveSheet(sheets[0]);
      } else {
        // Fallback to provided object
        const normalizedFallback = normalizeAnalysisRespnos(analysis, projectTranscriptsForUpload);
        setCurrentAnalysis(normalizedFallback);
        setTranscripts(normalizedFallback?.transcripts || []);
        const sheets = Object.keys(normalizedFallback?.data || {});
        if (sheets.length) setActiveSheet(sheets[0]);
      }
    } catch (e) {
      // Network/endpoint not available; fallback to provided object
      const normalizedFallback = normalizeAnalysisRespnos(analysis, projectTranscriptsForUpload);
      setCurrentAnalysis(normalizedFallback);
      setTranscripts(normalizedFallback?.transcripts || []);
      const sheets = Object.keys(normalizedFallback?.data || {});
      if (sheets.length) setActiveSheet(sheets[0]);
    } finally {
      setLoadingSavedView(false);
    }
  };

  const deleteSavedAnalysis = async (id: string, name: string) => {
    if (!confirm(`Delete content analysis "${name}"?`)) return;
    try {
      await fetch(`${API_BASE_URL}/api/caX/delete/${id}`, { method: 'DELETE', headers: { 'Authorization': `Bearer ${localStorage.getItem('cognitive_dash_token')}` } });
      setSavedAnalyses(prev => prev.filter(a => a.id !== id));
      // Reload projects to update the project hub
      onProjectsChange?.();
    } catch (e) {
      console.error('Failed to delete analysis', e);
    }
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setUploading(true);
    try {
      const formData = new FormData();
      formData.append('dg', file);

      const response = await fetch(`${API_BASE_URL}/api/caX/preview`, {
        method: 'POST',
        body: formData,
        headers: { 'Authorization': `Bearer ${localStorage.getItem('cognitive_dash_token')}` }
      });

      if (response.ok) {
        const result = await response.json();
        console.log('Upload response - originalDocxId:', result.originalDocxId);

        // Create a new analysis with the generated data
        const newAnalysis = {
          id: `temp-${Date.now()}`,
          name: result.fileName?.replace('.docx', '') || 'New Content Analysis',
          projectId: null,
          projectName: 'No Project',
          data: result.data,
          quotes: {},
          rawGuideText: result.rawGuideText,
          originalDocxId: result.originalDocxId,
          savedAt: new Date().toISOString(),
          savedBy: 'You'
        };
        console.log('New analysis created with originalDocxId:', newAnalysis.originalDocxId);

        // Switch to viewer mode with the new analysis
        setCurrentAnalysis(newAnalysis);
        const sheets = Object.keys(newAnalysis.data);
        if (sheets.length) setActiveSheet(sheets[0]);
        setViewMode('viewer');
      } else {
        const error = await response.json();
        alert(`Generation failed: ${error.error}`);
      }
    } catch (error) {
      console.error('Upload error:', error);
      alert('Upload failed - make sure the backend server is running');
    }
    setUploading(false);

    // Reset file input
    e.target.value = '';
  };

  const handleCreateFormSubmit = async () => {
    if (!createFormData.title || !createFormData.discussionGuide) {
      alert('Please enter a title and upload a discussion guide');
      return;
    }

    setGeneratingAnalysis(true);
    try {
      const formData = new FormData();
      formData.append('dg', createFormData.discussionGuide);

      const response = await fetch(`${API_BASE_URL}/api/caX/preview`, {
        method: 'POST',
        body: formData,
        headers: { 'Authorization': `Bearer ${localStorage.getItem('cognitive_dash_token')}` }
      });

      if (response.ok) {
        const result = await response.json();
        console.log('Generate from Project response - originalDocxId:', result.originalDocxId);

        // Create a new analysis with the generated data
        const newAnalysis = {
          id: `temp-${Date.now()}`,
          name: createFormData.title,
          projectId: createFormData.projectId || null,
          projectName: createFormData.projectId ? projects.find(p => p.id === createFormData.projectId)?.name || 'Unknown Project' : 'No Project',
          data: result.data,
          quotes: {},
          rawGuideText: result.rawGuideText,
          originalDocxId: result.originalDocxId,
          savedAt: new Date().toISOString(),
          savedBy: 'You'
        };
        console.log('New analysis from project created with originalDocxId:', newAnalysis.originalDocxId);

        // Switch to viewer mode with the new analysis
        setCurrentAnalysis(newAnalysis);
        const sheets = Object.keys(newAnalysis.data);
        if (sheets.length) setActiveSheet(sheets[0]);
        setViewMode('viewer');

        // Auto-save if project is selected
        if (createFormData.projectId) {
          try {
            const selectedProject = projects.find(p => p.id === createFormData.projectId);
            console.log('Auto-saving content analysis with originalDocxId:', newAnalysis.originalDocxId);
            const saveResponse = await fetch(`${API_BASE_URL}/api/caX/save`, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${localStorage.getItem('cognitive_dash_token')}`
              },
              body: JSON.stringify({
                projectId: createFormData.projectId,
                name: createFormData.title,
                description: `Content analysis generated from discussion guide`,
                data: newAnalysis.data,
                quotes: newAnalysis.quotes,
                rawGuideText: newAnalysis.rawGuideText,
                originalDocxId: newAnalysis.originalDocxId
              })
            });

            if (saveResponse.ok) {
              const savedResult = await saveResponse.json();
              console.log('Auto-save successful:', savedResult);
              
              // Update the analysis with the saved ID
              setCurrentAnalysis((prev: any) => prev ? { ...prev, id: savedResult.id } : null);
              
              // Show success message
              setShowSaveSuccessMessage(true);
              setTimeout(() => setShowSaveSuccessMessage(false), 3000);
            } else {
              console.error('Auto-save failed');
            }
          } catch (saveError) {
            console.error('Auto-save error:', saveError);
          }
        }

        // Reset create form
        setCreateFormData({ title: '', projectId: '', discussionGuide: null });
      } else {
        const error = await response.json();
        alert(`Generation failed: ${error.error}`);
      }
    } catch (error) {
      console.error('Generation error:', error);
      alert('Generation failed - make sure the backend server is running');
    }
    setGeneratingAnalysis(false);
  };

  const handleSaveToProject = async () => {
    if (!saveFormData.projectId || !saveFormData.name) {
      alert('Please select a project and enter a name');
      return;
    }

    setSaving(true);
    try {
      const selectedProject = projects.find(p => p.id === saveFormData.projectId);
      console.log('Saving content analysis with originalDocxId:', currentAnalysis?.originalDocxId);
      const response = await fetch(`${API_BASE_URL}/api/caX/save`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${localStorage.getItem('cognitive_dash_token')}` },
        body: JSON.stringify({
          projectId: saveFormData.projectId,
          projectName: selectedProject?.name || 'Unknown Project',
          name: saveFormData.name,
          data: currentAnalysis?.data,
          quotes: currentAnalysis?.quotes || {},
          discussionGuide: currentAnalysis?.rawGuideText,
          originalDocxId: currentAnalysis?.originalDocxId
        })
      });

      if (response.ok) {
        const result = await response.json();
        setShowSaveModal(false);
        setSaveFormData({ projectId: '', name: '', description: '' });

        // Update current analysis with saved ID and info
        setCurrentAnalysis({
          ...currentAnalysis,
          id: result.id,
          name: saveFormData.name,
          projectId: saveFormData.projectId,
          projectName: selectedProject?.name || 'Unknown Project',
          savedAt: new Date().toISOString(),
          savedBy: 'You'
        });

        // Reload the saved analyses list
        await fetchSavedAnalyses();

        // Show success message
        setShowSaveSuccessMessage(true);
        setTimeout(() => setShowSaveSuccessMessage(false), 3000);
      } else {
        const error = await response.json();
        alert(`Save failed: ${error.error}`);
      }
    } catch (error) {
      console.error('Save error:', error);
      alert('Save failed - make sure the backend server is running');
    }
    setSaving(false);
  };


  const handleDownloadOriginal = async () => {
    if (transcriptFilePaths.original) {
      const filename = transcriptFilePaths.original.split('/').pop() || 'transcript.docx';
      const downloadUrl = `${API_BASE_URL}/api/caX/download/original/${filename}`;
      
      try {
        const response = await fetch(downloadUrl, {
          headers: {
            'Authorization': `Bearer ${localStorage.getItem('cognitive_dash_token')}`
          }
        });
        
        if (response.ok) {
          const blob = await response.blob();
          const url = window.URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url;
          a.download = filename;
          document.body.appendChild(a);
          a.click();
          window.URL.revokeObjectURL(url);
          document.body.removeChild(a);
        } else {
          const error = await response.json();
          alert(`Download failed: ${error.error}`);
        }
      } catch (error) {
        console.error('Download error:', error);
        alert('Download failed - please try again');
      }
    }
  };

  const handleDownloadCleaned = async () => {
    if (transcriptFilePaths.cleaned) {
      const filename = transcriptFilePaths.cleaned.split('/').pop() || 'transcript_cleaned.docx';
      const downloadUrl = `${API_BASE_URL}/api/caX/download/cleaned/${filename}`;
      
      try {
        const response = await fetch(downloadUrl, {
          headers: {
            'Authorization': `Bearer ${localStorage.getItem('cognitive_dash_token')}`
          }
        });
        
        if (response.ok) {
          const blob = await response.blob();
          const url = window.URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url;
          a.download = filename;
          document.body.appendChild(a);
          a.click();
          window.URL.revokeObjectURL(url);
          document.body.removeChild(a);
        } else {
          const error = await response.json();
          alert(`Download failed: ${error.error}`);
        }
      } catch (error) {
        console.error('Download error:', error);
        alert('Download failed - please try again');
      }
    }
  };

  const handleTranscriptUpload = async ({ file, existingTranscriptId }: { file?: File | null; existingTranscriptId?: string }) => {
    if (!currentAnalysis?.data || !activeSheet) {
      alert('No active analysis or sheet');
      return;
    }

    if (!file && !existingTranscriptId) {
      alert('Select a transcript to upload');
      return;
    }

    setProcessingTranscript(true);
    try {
      const formData = new FormData();
      if (file) {
        formData.append('transcript', file);
      } else if (existingTranscriptId) {
        formData.append('transcriptId', existingTranscriptId);
        formData.append('preferCleanedTranscript', 'true');
      }
      formData.append('projectId', currentAnalysis.projectId || 'temp');
      formData.append('analysisId', currentAnalysis.id);
      formData.append('activeSheet', activeSheet);
      formData.append('currentData', JSON.stringify(currentAnalysis.data));
      formData.append('discussionGuide', currentAnalysis.rawGuideText || '');
      // Removed cleanTranscript - now directly populates CA

      // Create an AbortController with a long timeout for transcript processing
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 30 * 60 * 1000); // 30 minutes

      const response = await fetch(`${API_BASE_URL}/api/caX/process-transcript`, {
        method: 'POST',
        body: formData,
        headers: { 'Authorization': `Bearer ${localStorage.getItem('cognitive_dash_token')}` },
        signal: controller.signal
      });

      clearTimeout(timeoutId);

      const initialResult: any = await response.json();

      if (!response.ok) {
        throw new Error(initialResult?.error || 'Transcript processing failed');
      }

      let result: any = initialResult;

      if (!result?.data) {
        throw new Error('Transcript processing completed without returning updated data.');
      }

      console.log('=== TRANSCRIPT UPLOAD RESULT ===');
      console.log('Sheets in result.data:', Object.keys(result.data || {}));
      console.log('Current analysis sheets before update:', Object.keys(currentAnalysis.data || {}));

      for (const [sheetName, sheetData] of Object.entries(result.data || {})) {
        console.log(`Sheet "${sheetName}": ${Array.isArray(sheetData) ? sheetData.length : 0} rows`);
      }


      const mergedQuotes = { ...currentAnalysis.quotes };
      if (result.quotes) {
        for (const [sheetName, sheetQuotes] of Object.entries(result.quotes)) {
          if (!mergedQuotes[sheetName]) mergedQuotes[sheetName] = {};
          mergedQuotes[sheetName] = { ...mergedQuotes[sheetName], ...(sheetQuotes as any) };
        }
      }

      const mergedContext = currentAnalysis?.context ? { ...currentAnalysis.context } : {};
      console.log('🔍 Frontend received result.context:', result.context);
      console.log('🔍 Context keys:', result.context ? Object.keys(result.context) : 'NO CONTEXT');
      if (result.context) {
        for (const [sheetName, sheetContext] of Object.entries(result.context)) {
          console.log(`🔍 Processing context for sheet "${sheetName}":`, sheetContext);
          if (!mergedContext[sheetName]) mergedContext[sheetName] = {};
          mergedContext[sheetName] = { ...mergedContext[sheetName], ...(sheetContext as any) };
        }
      }
      console.log('🔍 Final mergedContext:', mergedContext);

      console.log('🔍 TRANSCRIPT DEBUG:');
      console.log('🔍 result.cleanedTranscript:', result.cleanedTranscript);
      console.log('🔍 result.originalTranscript:', result.originalTranscript);
      console.log('🔍 result.respno:', result.respno);

      const newTranscripts = [...transcripts];
      if (result.respno) {
        const demographicsRow = result.data.Demographics?.find((row: any) =>
          (row['Respondent ID'] || row['respno']) === result.respno
        );

        const demographics: Record<string, string> = {};
        if (demographicsRow) {
          Object.keys(demographicsRow).forEach(key => {
            if (key !== 'Respondent ID' && key !== 'respno') {
              demographics[key] = demographicsRow[key] || '';
            }
          });
        }

        // Use cleaned transcript if available, otherwise use original
        const transcriptToUse = result.cleanedTranscript || result.originalTranscript || '';

        if (transcriptToUse) {
          // Generate a temporary respondent ID if none exists
          const respnoToUse = result.respno || `TEMP_${Date.now()}`;

          newTranscripts.push({
            id: Date.now().toString(),
            respno: respnoToUse,
            demographics,
            cleanedTranscript: result.cleanedTranscript || '',
            originalTranscript: result.originalTranscript || '',
            uploadedAt: new Date().toISOString(),
            originalFilePath: result.filePaths?.original || undefined,
            cleanedFilePath: result.filePaths?.cleaned || undefined,
            sourceTranscriptId: result.usedTranscriptId || existingTranscriptId || null
          });
          setTranscripts(newTranscripts);
          console.log('🔍 Added transcript for respondent:', respnoToUse);
          console.log('🔍 File paths - original:', result.filePaths?.original, 'cleaned:', result.filePaths?.cleaned);
        } else {
          console.log('🔍 No transcript content found for respondent:', result.respno);
        }
      }

      if (result.respno) {
        setHighlightedRespondentId(result.respno);
        setTimeout(() => setHighlightedRespondentId(null), 6000);
      }

      const updatedAnalysis = {
        ...currentAnalysis,
        data: result.data,
        quotes: mergedQuotes,
        context: mergedContext,
        transcripts: newTranscripts
      };

      console.log('Updated analysis sheets:', Object.keys(updatedAnalysis.data || {}));
      for (const [sheetName, sheetData] of Object.entries(updatedAnalysis.data || {})) {
        console.log(`Updated Sheet "${sheetName}": ${Array.isArray(sheetData) ? sheetData.length : 0} rows`);
        if (sheetName === 'Demographics' && Array.isArray(sheetData)) {
          console.log('Demographics rows:', sheetData.map((row, idx) => ({
            index: idx,
            id: row['Respondent ID'] || row['respno'],
            date: row['Interview Date'] || row['Date'],
            time: row['Interview Time'] || row['Time']
          })));
        }
      }

      const normalizedAnalysis = normalizeAnalysisRespnos(updatedAnalysis, projectTranscriptsForUpload);
      setCurrentAnalysis(normalizedAnalysis);
      setTranscripts(normalizedAnalysis?.transcripts || []);
      setSavedAnalyses(prev =>
        Array.isArray(prev)
          ? prev.map(a => (a.id === normalizedAnalysis.id ? normalizedAnalysis : a))
          : prev
      );
      
      // Store file paths for download
      if (result.filePaths) {
        setTranscriptFilePaths({
          original: result.filePaths.original,
          cleaned: result.filePaths.cleaned
        });
      }

      if (currentAnalysis.projectId) {
        try {
          const saveResponse = await fetch(`${API_BASE_URL}/api/caX/update`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${localStorage.getItem('cognitive_dash_token')}` },
            body: JSON.stringify({
              id: currentAnalysis.id,
              data: normalizedAnalysis.data,
              quotes: normalizedAnalysis.quotes || mergedQuotes,
              transcripts: normalizedAnalysis.transcripts || [],
              context: normalizedAnalysis.context || mergedContext
            })
          });

          if (!saveResponse.ok) {
            console.error('Auto-save failed');
          }
        } catch (saveError) {
          console.error('Auto-save error:', saveError);
        }
      }


      if (currentAnalysis?.projectId) {
        try {
          await fetchProjectTranscripts(currentAnalysis.projectId);
        } catch (refreshError) {
          console.warn('Failed to refresh project transcripts after upload:', refreshError);
        }
      }

      setTranscriptFile(null);
      setSelectedExistingTranscriptId('');
      setExistingTranscriptCostEstimate(null);

      setShowSuccessMessage(true);
      setTimeout(() => setShowSuccessMessage(false), 3000);
      setShowTranscriptUploadModal(false);
    } catch (error) {
      console.error('Transcript processing error:', error);
      const errorMessage = error instanceof Error ? error.message : 'Transcript processing failed - please try again.';
      alert(errorMessage);
    } finally {
      setProcessingTranscript(false);
      if (file && transcriptFileInputRef.current) {
        transcriptFileInputRef.current.value = '';
      }
    }
  };

  const MODEL_TOKEN_PRICING = {
    modelName: 'GPT-4o',
    inputPerMillion: 2.50,
    outputPerMillion: 10.00
  };

  const calculateCostEstimateFromSize = (bytes: number, filename: string | undefined | null): CostEstimate | null => {
    if (!bytes || Number.isNaN(bytes)) {
      return null;
    }

    const extension = (filename || '').toLowerCase();
    const isDocx = extension.endsWith('.docx');
    const charsPerToken = isDocx ? 3 : 4;

    const estimatedInputTokens = Math.max(1, Math.ceil(bytes / charsPerToken));
    const estimatedOutputTokens = Math.ceil(estimatedInputTokens * 0.75);

    const inputCostPerToken = MODEL_TOKEN_PRICING.inputPerMillion / 1_000_000;
    const outputCostPerToken = MODEL_TOKEN_PRICING.outputPerMillion / 1_000_000;

    const inputCost = estimatedInputTokens * inputCostPerToken;
    const outputCost = estimatedOutputTokens * outputCostPerToken;
    const totalCost = inputCost + outputCost;

    return {
      inputTokens: estimatedInputTokens,
      outputTokens: estimatedOutputTokens,
      cost: totalCost,
      formattedCost: totalCost < 0.01 ? '< $0.01' : `$${totalCost.toFixed(2)}`
    };
  };

  // Calculate cost estimate based on file size
  const calculateCostEstimate = (file: File) => {
    if (!file) return null;
    return calculateCostEstimateFromSize(file.size, file.name);
  };

  const fillContentAnalysisFromTranscript = async (transcriptId: string) => {
    if (!currentAnalysis?.id) return;
    
    setFillingContentAnalysis(true);
    try {
      const response = await fetch(`${API_BASE_URL}/api/caX/fill-content-analysis`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${localStorage.getItem('cognitive_dash_token')}`
        },
        body: JSON.stringify({
          analysisId: currentAnalysis.id,
          transcriptId: transcriptId,
          projectId: currentAnalysis.projectId,
          activeSheet: activeSheet,
          discussionGuide: currentAnalysis.rawGuideText,
          guideMap: currentAnalysis.guideMap
        })
      });

      if (response.ok) {
        const result = await response.json();
        console.log('Content analysis filled successfully:', result);
        
        // Update the current analysis with the filled data
        const updatedAnalysis = {
          ...currentAnalysis,
          data: result.data,
          quotes: result.quotes,
          context: result.context
        };
        
        setCurrentAnalysis(updatedAnalysis);
        
        // Reload the analysis from the server to ensure we have the latest saved data with context
        if (currentAnalysis?.id) {
          try {
            const token = localStorage.getItem('token');
            const reloadResponse = await fetch(`${API_BASE_URL}/api/caX/saved/${currentAnalysis.id}`, {
              headers: token ? { 'Authorization': `Bearer ${token}` } : undefined,
            });
            if (reloadResponse.ok) {
              const reloadedAnalysis = await reloadResponse.json();
              console.log('Reloaded analysis with context:', reloadedAnalysis);
              setCurrentAnalysis(reloadedAnalysis);
            }
          } catch (e) {
            console.error('Failed to reload analysis:', e);
          }
        }
        
        // Show success message
        setShowSuccessMessage(true);
        setTimeout(() => setShowSuccessMessage(false), 3000);
      } else {
        const error = await response.json();
        alert(`Failed to fill content analysis: ${error.error}`);
      }
    } catch (error) {
      console.error('Error filling content analysis:', error);
      alert('Failed to fill content analysis - make sure the backend server is running');
    }
    setFillingContentAnalysis(false);
  };

  const downloadTranscriptAsWord = async (transcript: any) => {
    try {
      // Determine which transcript to use - cleaned if available, otherwise original
      const transcriptToUse = transcript.cleanedTranscript && transcript.cleanedTranscript.trim().length > 0
        ? transcript.cleanedTranscript 
        : transcript.originalTranscript;
      
      // Debug logging
      console.log('🔍 DOWNLOAD DEBUG:');
      console.log('🔍 transcript.cleanedTranscript length:', transcript.cleanedTranscript?.length || 0);
      console.log('🔍 transcript.originalTranscript length:', transcript.originalTranscript?.length || 0);
      console.log('🔍 transcriptToUse length:', transcriptToUse?.length || 0);
      console.log('🔍 transcriptToUse preview (first 500 chars):', transcriptToUse?.substring(0, 500));
      console.log('🔍 transcriptToUse preview (last 500 chars):', transcriptToUse?.substring(Math.max(0, transcriptToUse.length - 500)));
      
      // Parse the transcript to extract dialogue
      const lines = transcriptToUse.split('\n').filter((line: string) => line.trim());
      
      console.log('🔍 Total lines to process:', lines.length);

      // Create paragraphs for the document
      const paragraphs: Paragraph[] = [];

      // Add title with PROJECT name + "Transcript"
      const projectName = currentAnalysis?.projectName || 'Interview';
      const title = `${projectName} Transcript`;
      paragraphs.push(
        new Paragraph({
          children: [
            new TextRun({
              text: title,
              font: 'Trebuchet MS',
              size: 32, // 16pt (size is in half-points)
              bold: true
            })
          ],
          alignment: AlignmentType.CENTER,
          spacing: { after: 100 }
        })
      );

      // Add date and time as italic subtitle (smaller text)
      const dateTimeParts: string[] = [];

      // Get date from demographics (check multiple possible column names)
      const dateValue = transcript.demographics['Interview Date'] ||
                       transcript.demographics['Date'] ||
                       transcript.demographics['date'];

      // Get time from demographics (check multiple possible column names)
      const timeValue = transcript.demographics['Interview Time'] ||
                       transcript.demographics['Time (ET)'] ||
                       transcript.demographics['Time'] ||
                       transcript.demographics['time'];

      if (dateValue) dateTimeParts.push(dateValue);
      if (timeValue) dateTimeParts.push(timeValue);

      if (dateTimeParts.length > 0) {
        paragraphs.push(
          new Paragraph({
            children: [
              new TextRun({
                text: dateTimeParts.join(' | '),
                font: 'Trebuchet MS',
                size: 20, // 10pt
                italics: true
              })
            ],
            alignment: AlignmentType.CENTER,
            spacing: { after: 400 }
          })
        );
      } else {
        // If no date/time, add spacing anyway
        paragraphs.push(
          new Paragraph({
            text: '',
            spacing: { after: 400 }
          })
        );
      }

      // Add transcript content
      for (const line of lines) {
        if (line.trim()) {
          // Check if line starts with speaker label
          const speakerMatch = line.match(/^(Moderator|Respondent):\s*(.*)$/);

          if (speakerMatch) {
            const [, speaker, text] = speakerMatch;
            paragraphs.push(
              new Paragraph({
                children: [
                  new TextRun({
                    text: `${speaker}: `,
                    bold: true,
                    font: 'Trebuchet MS',
                    size: 22 // 11pt
                  }),
                  new TextRun({
                    text: text,
                    font: 'Trebuchet MS',
                    size: 22 // 11pt
                  })
                ],
                spacing: { after: 200 } // Double line break (increased from 100)
              })
            );
          } else {
            // If no speaker label, just add as regular paragraph
            paragraphs.push(
              new Paragraph({
                children: [
                  new TextRun({
                    text: line,
                    font: 'Trebuchet MS',
                    size: 22 // 11pt
                  })
                ],
                spacing: { after: 200 } // Double line break (increased from 100)
              })
            );
          }
        }
      }

      // Create document
      const doc = new Document({
        sections: [{
          properties: {},
          children: paragraphs
        }]
      });

      console.log('🔍 Document created with', paragraphs.length, 'paragraphs');
      console.log('🔍 Last few paragraphs preview:', paragraphs.slice(-3).map(p => {
        const firstChild = p.children?.[0];
        return firstChild && 'text' in firstChild ? firstChild.text?.substring(0, 100) || 'No text' : 'No text';
      }));

      // Generate and download
      const blob = await Packer.toBlob(doc);
      console.log('🔍 Blob size:', blob.size, 'bytes');
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;

      // Build filename: [ProjectName] Transcript_[Date]_[Time]
      // Format: "2025 SMA Adult Activation Qual Transcript_Oct 1 2025_300pm"
      let filename = projectName.replace(/[/\\?%*:|"<>]/g, '-'); // Remove invalid filename chars
      filename += ' Transcript';

      if (dateValue) {
        // Clean up date for filename (remove commas, etc.)
        const cleanDate = dateValue.replace(/,/g, '').replace(/\s+/g, ' ');
        filename += `_${cleanDate}`;
      }

      if (timeValue) {
        // Clean up time for filename (remove spaces, colons, convert to format like "300pm")
        const cleanTime = timeValue.replace(/\s+/g, '').replace(/:/g, '').toLowerCase();
        filename += `_${cleanTime}`;
      }

      a.download = `${filename}.docx`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (error) {
      console.error('Error generating Word document:', error);
      alert('Failed to generate Word document');
    }
  };

  return (
    <div className="flex-1 p-6 space-y-4 max-w-full overflow-hidden">
      <div className="space-y-3">
        {/* Header */}
        <section className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-2xl font-bold" style={{ color: BRAND_GRAY }}>Content Analysis</h2>
            <p className="mt-1 text-sm text-gray-500">
              View and manage your saved content analyses
            </p>
          </div>
          <div className="flex items-center gap-3">
            {onNavigate && currentAnalysis?.projectId && !currentAnalysis.id?.startsWith('temp-') && (
              <button
                onClick={() => {
                  try {
                    sessionStorage.setItem('cognitive_dash_transcripts_focus_project', currentAnalysis.projectId);
                  } catch (err) {
                    console.warn('Unable to persist transcripts navigation target', err);
                  }
                  onNavigate('Transcripts');
                }}
                className="flex items-center justify-center h-8 w-8 rounded-full transition-colors"
                style={{ backgroundColor: 'rgba(37, 99, 235, 0.65)' }}
                title="Open Transcripts"
                aria-label="Open Transcripts"
              >
                <IconScript className="h-4 w-4 text-white" />
              </button>
            )}
            {onNavigateToStorytelling && currentAnalysis?.id && !currentAnalysis.id.startsWith('temp-') && (
              <button
                onClick={() => onNavigateToStorytelling(currentAnalysis.id, currentAnalysis.projectId)}
                className="flex items-center justify-center h-8 w-8 rounded-full transition-colors"
                style={{ backgroundColor: 'rgba(37, 99, 235, 0.65)' }}
                title="Open Storytelling"
              >
                <IconBook2 className="h-4 w-4 text-white" />
              </button>
            )}
            {viewMode !== 'viewer' && (
              <div className="flex items-center gap-2">
                <span className="text-sm text-gray-600">Current View:</span>
                <button
                  onClick={() => (viewMode === 'home' || viewMode === 'create') && !uploading && !generatingAnalysis && setShowMyProjectsOnly(!showMyProjectsOnly)}
                  disabled={(viewMode !== 'home' && viewMode !== 'create') || uploading || generatingAnalysis}
                  className={`px-3 py-1 text-xs rounded-lg shadow-sm transition-colors ${
                    (viewMode !== 'home' && viewMode !== 'create') || uploading || generatingAnalysis
                      ? 'bg-gray-200 text-gray-400 cursor-not-allowed'
                      : showMyProjectsOnly
                      ? 'bg-white border border-gray-300 hover:bg-gray-50'
                      : 'text-white hover:opacity-90'
                  }`}
                  style={(viewMode === 'home' || viewMode === 'create') && !uploading && !generatingAnalysis && !showMyProjectsOnly ? { backgroundColor: '#D14A2D' } : {}}
                >
                  {showMyProjectsOnly ? 'Only My Projects' : 'All Cognitive Projects'}
                </button>
              </div>
            )}
          </div>
        </section>

        {/* Viewer mode action bar */}
        {viewMode === 'viewer' && (
          <div className="flex items-center justify-between">
            <button
              onClick={() => { setViewMode('home'); setCurrentAnalysis(null); }}
              className="flex items-center gap-2 text-xs hover:opacity-80 transition-colors"
              style={{ color: '#D14A2D' }}
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
              </svg>
              Back to list
            </button>
            
            {/* Action buttons - View Discussion Guide and Export as Excel */}
            <div className="flex items-center gap-2">
              {/* View Discussion Guide button - only show if discussion guide exists */}
              {currentAnalysis?.projectId && (
                <button
                  onClick={async () => {
                    setShowDiscussionGuideModal(true);
                    // Fetch and render the discussion guide
                    setTimeout(async () => {
                      try {
                        const response = await fetch(`${API_BASE_URL}/api/caX/discussion-guide/${currentAnalysis.projectId}/download`, {
                          headers: { 'Authorization': `Bearer ${localStorage.getItem('cognitive_dash_token')}` }
                        });
                        if (response.ok) {
                          const blob = await response.blob();
                          if (docxContainerRef.current) {
                            docxContainerRef.current.innerHTML = ''; // Clear previous content
                            await renderAsync(blob, docxContainerRef.current);
                          }
                        } else {
                          console.error('Discussion guide not found');
                          if (docxContainerRef.current) {
                            docxContainerRef.current.innerHTML = '<div class="p-8 text-center text-gray-500">No discussion guide found for this project</div>';
                          }
                        }
                      } catch (error) {
                        console.error('Error loading discussion guide:', error);
                        if (docxContainerRef.current) {
                          docxContainerRef.current.innerHTML = '<div class="p-8 text-center text-red-500">Error loading discussion guide</div>';
                        }
                      }
                    }, 100);
                  }}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-gray-700 text-xs font-medium rounded-md hover:bg-gray-50 transition-colors cursor-pointer shadow-sm border border-gray-300"
                  style={{ backgroundColor: 'white' }}
                >
                  <BookOpenIcon className="h-4 w-4" />
                  <span>View Discussion Guide</span>
                </button>
              )}
              {/* Export to Excel button - always visible */}
              <button
                onClick={handleExportToExcel}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-gray-700 text-xs font-medium rounded-md hover:bg-gray-50 transition-colors cursor-pointer shadow-sm border border-gray-300"
                style={{ backgroundColor: 'white' }}
              >
                <IconFileArrowRight className="h-4 w-4" />
                <span>Export as Excel</span>
              </button>
            </div>
          </div>
        )}


        {/* Tabs - only show on home view */}
        {viewMode === 'home' && (
          <div>
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
            </div>
            <div className="border-b border-gray-200"></div>
          </div>
        )}

      {/* Body: table list, spinner, or analysis */}
      {viewMode === 'home' && (
        <div className="bg-white shadow-sm border border-gray-200 rounded-lg overflow-hidden">
          <div className="overflow-x-auto">
            {loading ? (
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
                    : 'Create a qualitative project to start content analysis.'}
                </p>
              </div>
            ) : (
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
                    <th className="px-6 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider w-32">
                      Analyses
                    </th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-200">
                  {displayProjects.map(project => {
                    const projectAnalyses = savedAnalyses.filter(a => a.projectId === project.id);
                    return (
                      <tr
                        key={project.id}
                        className="hover:bg-gray-50 cursor-pointer transition-colors"
                        onClick={() => {
                          setSelectedProject(project);
                          setViewMode('project');
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
                        <td className="px-6 py-4 whitespace-nowrap text-center w-32">
                          <div className="flex items-center justify-center gap-1 text-sm text-gray-900">
                            <IconBook2 className="h-4 w-4 text-gray-400" />
                            {projectAnalyses.length}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
        </div>
      )}

      {/* Project View - Content Analyses for Selected Project */}
      {viewMode === 'project' && selectedProject && (
        <div className="bg-white shadow-sm border border-gray-200 rounded-lg overflow-hidden">
          {/* Project Header */}
          <div className="px-6 py-4 border-b border-gray-200 bg-gray-50">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <button
                  onClick={() => {
                    setViewMode('home');
                    setSelectedProject(null);
                  }}
                  className="flex items-center gap-2 text-sm text-gray-600 hover:text-gray-800 hover:bg-gray-100 px-3 py-1 rounded-lg transition-colors"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                  </svg>
                  Back to Projects
                </button>
                <div>
                  <h2 className="text-lg font-semibold" style={{ color: '#5D5F62' }}>{selectedProject.name}</h2>
                </div>
              </div>
              <button
                onClick={() => {
                  setCreateFormData(prev => ({ ...prev, projectId: selectedProject.id }));
                  setViewMode('create');
                }}
                className="flex items-center gap-1 rounded-lg px-3 py-1 text-xs shadow-sm transition-colors text-white hover:opacity-90 cursor-pointer"
                style={{ backgroundColor: '#D14A2D' }}
              >
                <CloudArrowUpIcon className="h-4 w-4" />
                Generate New
              </button>
            </div>
          </div>

          {/* Content Analyses Table */}
          <div className="overflow-x-auto">
            {(() => {
              const projectAnalyses = savedAnalyses.filter(a => a.projectId === selectedProject.id);
              return projectAnalyses.length === 0 ? (
                <div className="p-8 text-center">
                  <IconBook2 className="h-12 w-12 text-gray-400 mx-auto mb-4" />
                  <h3 className="text-lg font-medium text-gray-900 mb-2">No Content Analyses</h3>
                  <p className="text-gray-600 mb-4">This project doesn't have any content analyses yet.</p>
                  <button
                    onClick={() => {
                      setCreateFormData(prev => ({ ...prev, projectId: selectedProject.id }));
                      setViewMode('create');
                    }}
                    className="flex items-center gap-1 rounded-lg px-4 py-2 text-sm shadow-sm transition-colors text-white hover:opacity-90 mx-auto"
                    style={{ backgroundColor: '#D14A2D' }}
                  >
                    <CloudArrowUpIcon className="h-4 w-4" />
                    Create First Analysis
                  </button>
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
                        Respondents
                      </th>
                    </tr>
                  </thead>
                  <tbody className="bg-white divide-y divide-gray-200">
                    {projectAnalyses.map((analysis) => (
                      <tr 
                        key={analysis.id} 
                        className="hover:bg-gray-50 cursor-pointer transition-colors"
                        onClick={() => loadSavedAnalysis(analysis)}
                      >
                        <td className="px-6 py-4 whitespace-nowrap">
                          <div className="text-sm font-medium text-gray-900">{analysis.name || 'Untitled Analysis'}</div>
                          {analysis.description && (
                            <div className="text-sm text-gray-500 truncate max-w-xs">{analysis.description}</div>
                          )}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                          {analysis.createdAt ? new Date(analysis.createdAt).toLocaleDateString() : '-'}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-center">
                          <div className="flex items-center justify-center gap-1 text-sm text-gray-900">
                            <svg className="h-4 w-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" />
                            </svg>
                            {analysis.data ? (() => {
                              const allData = Object.values(analysis.data).flat();
                              const uniqueRespondents = new Set(allData.map((item: any) => item.respno).filter(Boolean));
                              return uniqueRespondents.size;
                            })() : 0}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              );
            })()}
          </div>
        </div>
      )}

      {/* Create Form View */}
      {viewMode === 'create' && (
        <div className="bg-white shadow-sm border border-gray-200 rounded-lg p-8 max-w-2xl mx-auto">
          <div className="flex items-center justify-between mb-6">
            <h3 className="text-xl font-semibold text-gray-900">Create New Content Analysis</h3>
            <button
              onClick={() => {
                setViewMode('home');
                setCreateFormData({ title: '', projectId: '', discussionGuide: null });
              }}
              className="text-sm text-gray-600 hover:text-gray-900"
              disabled={generatingAnalysis}
            >
              Cancel
            </button>
          </div>

          {generatingAnalysis ? (
            <div className="flex-1 flex items-center justify-center p-8">
              <div className="text-center">
                <div className="w-16 h-16 mx-auto mb-4">
                  <svg className="animate-spin w-16 h-16" fill="none" viewBox="0 0 24 24" style={{ color: '#D14A2D' }}>
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                  </svg>
                </div>
                <h3 className="text-lg font-semibold text-gray-900 mb-2">Generating Content Analysis</h3>
                <div className="flex items-center justify-center space-x-2 text-sm text-gray-500">
                  <div className="w-2 h-2 rounded-full animate-bounce" style={{ backgroundColor: '#D14A2D' }}></div>
                  <div className="w-2 h-2 rounded-full animate-bounce" style={{ backgroundColor: '#D14A2D', animationDelay: '0.1s' }}></div>
                  <div className="w-2 h-2 rounded-full animate-bounce" style={{ backgroundColor: '#D14A2D', animationDelay: '0.2s' }}></div>
                </div>
              </div>
            </div>
          ) : (
            <div className="space-y-6">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Title <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  value={createFormData.title}
                  onChange={(e) => setCreateFormData({ ...createFormData, title: e.target.value })}
                  placeholder="Enter content analysis title..."
                  className="w-full border border-gray-300 rounded-lg px-4 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-500"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Project (Optional)
                </label>
                <select
                  value={createFormData.projectId}
                  onChange={(e) => setCreateFormData({ ...createFormData, projectId: e.target.value })}
                  className="w-full border border-gray-300 rounded-lg px-4 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-500"
                >
                  <option value="">Select a project...</option>
                  {filteredProjects.map(project => (
                    <option key={project.id} value={project.id}>{project.name}</option>
                  ))}
                </select>
                <p className="mt-1 text-xs text-gray-500">
                  {showMyProjectsOnly ? 'Showing only your Qualitative projects' : 'Showing all Qualitative projects'}
                </p>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Discussion Guide <span className="text-red-500">*</span>
                </label>
                <div className="border-2 border-dashed border-gray-300 rounded-lg p-6 text-center hover:border-gray-400 transition-colors">
                  <input
                    type="file"
                    accept=".docx"
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (file) {
                        setCreateFormData({ ...createFormData, discussionGuide: file });
                      }
                    }}
                    className="hidden"
                    id="discussion-guide-upload"
                  />
                  <label htmlFor="discussion-guide-upload" className="cursor-pointer">
                    <CloudArrowUpIcon className="mx-auto h-12 w-12 text-gray-400" />
                    <p className="mt-2 text-sm text-gray-600">
                      {createFormData.discussionGuide ? (
                        <span className="font-medium text-gray-900">{createFormData.discussionGuide.name}</span>
                      ) : (
                        <>
                          <span className="text-orange-600 font-medium">Click to upload</span> or drag and drop
                        </>
                      )}
                    </p>
                    <p className="mt-1 text-xs text-gray-500">DOCX files only</p>
                  </label>
                </div>
              </div>

              <div className="flex justify-end pt-4">
                <button
                  onClick={handleCreateFormSubmit}
                  disabled={!createFormData.title || !createFormData.discussionGuide}
                  className="px-6 py-2 text-sm text-white rounded-lg hover:opacity-90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                  style={{ backgroundColor: '#D14A2D' }}
                >
                  Generate Analysis
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {viewMode === 'viewer' && loadingSavedView && (
        <div className="p-8 flex items-center justify-center">
          <div className="w-5 h-5 border-2 border-orange-600 border-t-transparent rounded-full animate-spin"></div>
          <span className="ml-2 text-sm text-gray-700">Loading analysis...</span>
        </div>
      )}

      {viewMode === 'viewer' && !loadingSavedView && currentAnalysis && (
        <div className="flex flex-col h-[calc(100vh-200px)]">
          <div className="mb-3">
            <div className="flex items-center justify-between mb-1">
              <div className="flex items-center gap-2">
                {editingTitle ? (
                  <input
                    value={editAnalysisName}
                    onChange={(e) => setEditAnalysisName(e.target.value)}
                    onBlur={async () => {
                      try {
                        const token = localStorage.getItem('cognitive_dash_token');
                        await fetch(`${API_BASE_URL}/api/caX/update`, {
                          method: 'PUT',
                          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
                          body: JSON.stringify({ id: currentAnalysis.id, data: currentAnalysis.data, quotes: currentAnalysis.quotes || {}, name: editAnalysisName, transcripts: currentAnalysis.transcripts || [] })
                        });
                        setCurrentAnalysis({ ...currentAnalysis, name: editAnalysisName });
                        setEditingTitle(false);
                      } catch (e) { console.error('Failed to update title', e); }
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
                      if (e.key === 'Escape') { setEditingTitle(false); setEditAnalysisName(currentAnalysis.name || ''); }
                    }}
                    autoFocus
                    className="text-lg font-semibold text-gray-900 border border-orange-300 rounded px-2 py-1 focus:outline-none focus:ring-1 focus:ring-orange-400"
                  />
                ) : (
                  <>
                    <div className="text-lg font-semibold text-gray-900">{currentAnalysis.name}</div>
                    {!currentAnalysis.id?.startsWith('temp-') && (
                      <button onClick={() => { setEditingTitle(true); setEditAnalysisName(currentAnalysis.name || ''); }} className="text-gray-400 hover:text-orange-600 transition-colors">
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
                        </svg>
                      </button>
                    )}
                  </>
                )}
              </div>
              <div className="flex gap-2">
                {/* Show only save icon when generating analysis OR when analysis is complete but unsaved (and no project selected for auto-save) */}
                {(generatingAnalysis || (currentAnalysis.id?.startsWith('temp-') && !currentAnalysis.projectId)) ? (
                  <button
                    onClick={() => {
                      setSaveFormData({
                        projectId: currentAnalysis.projectId || '',
                        name: currentAnalysis.name || '',
                        description: ''
                      });
                      setShowSaveModal(true);
                    }}
                    className="text-orange-600 hover:text-orange-700 transition-colors"
                    title="Save Analysis"
                  >
                    <IconDeviceFloppy className="h-7 w-7" />
                  </button>
                ) : (
                  <>
                  </>
                )}
              </div>
            </div>
            <div className="flex items-center justify-between">
              <div>
                <div className="flex items-center gap-2 text-xs">
                  {editingProject ? (
                    <select
                      value={editProjectId}
                      onChange={async (e) => {
                        const newProjectId = e.target.value;
                        try {
                          const token = localStorage.getItem('cognitive_dash_token');
                          const proj = projects.find(p => p.id === newProjectId);
                          await fetch(`${API_BASE_URL}/api/caX/update`, {
                            method: 'PUT',
                            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
                            body: JSON.stringify({
                              id: currentAnalysis.id,
                              data: currentAnalysis.data,
                              quotes: currentAnalysis.quotes || {},
                              projectId: newProjectId,
                              projectName: proj?.name || '',
                              transcripts: currentAnalysis.transcripts || []
                            })
                          });
                          setCurrentAnalysis({ ...currentAnalysis, projectId: newProjectId, projectName: proj?.name || '' });
                          setEditingProject(false);
                        } catch (e) { console.error('Failed to update project', e); }
                      }}
                      onBlur={() => setEditingProject(false)}
                      autoFocus
                      className="border border-orange-300 rounded px-2 py-1 focus:outline-none focus:ring-1 focus:ring-orange-400"
                    >
                      <option value="">Unassigned</option>
                      {projects.filter(p => p.methodologyType === 'Qualitative').map(p => (<option key={p.id} value={p.id}>{p.name}</option>))}
                    </select>
                  ) : (
                    <>
                      {currentAnalysis.projectId && projects.length > 0 ? (
                        <button
                          onClick={() => {
                            const project = projects.find(p => p.id === currentAnalysis.projectId);
                            if (project && onNavigateToProject) {
                              onNavigateToProject(project);
                            }
                          }}
                          className="text-gray-700 hover:text-orange-600 underline font-medium"
                        >
                          {getProjectName(currentAnalysis)}
                        </button>
                      ) : (
                        <span className="text-gray-700 font-medium">{getProjectName(currentAnalysis)}</span>
                      )}
                      {!currentAnalysis.id?.startsWith('temp-') && (
                        <button onClick={() => { setEditingProject(true); setEditProjectId(currentAnalysis.projectId || ''); }} className="text-gray-400 hover:text-orange-600 transition-colors">
                          <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
                          </svg>
                        </button>
                      )}
                    </>
                  )}
                </div>
                {!currentAnalysis.id?.startsWith('temp-') && (
                  <div className="text-xs text-gray-500 italic mt-0.5">
                    Saved {currentAnalysis.savedDate || new Date(currentAnalysis.savedAt).toLocaleDateString()}
                  </div>
                )}
                <div className="text-xs text-gray-500 mt-0.5">Current Tab/Section: <span className="font-medium capitalize">{activeSheet.toLowerCase()}</span></div>
              </div>
              
              
              {/* Add Respondent Transcript button - only allows selecting existing transcripts */}
              {!currentAnalysis.id?.startsWith('temp-') && currentAnalysis.projectId && (
                <div className="flex items-center">
                  <button
                    onClick={() => {
                      setShowTranscriptUploadModal(true);
                    }}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 text-white text-xs font-medium rounded-md hover:opacity-90 transition-colors cursor-pointer shadow-sm"
                    style={{ backgroundColor: '#D14A2D' }}
                    disabled={processingTranscript}
                  >
                    {processingTranscript ? (
                      <>
                        <div className="w-3 h-3 flex items-center justify-center">
                          <svg className="animate-spin" width="12" height="12" viewBox="0 0 48 48">
                            <circle cx="24" cy="24" r="20" fill="none" stroke="white" strokeWidth="4" strokeDasharray="50 75.4" strokeDashoffset="0" />
                            <circle cx="24" cy="24" r="20" fill="none" stroke="rgba(255,255,255,0.3)" strokeWidth="4" strokeDasharray="50 75.4" strokeDashoffset="-62.7" />
                          </svg>
                        </div>
                        Processing...
                      </>
                    ) : (
                      <>
                        <CloudArrowUpIcon className="h-4 w-4" />
                        Add Transcript
                      </>
                    )}
                  </button>
                </div>
              )}
            </div>
          </div>
          {/* Sheet tabs and table container */}
          {currentAnalysis.data && activeSheet && Array.isArray(currentAnalysis.data?.[activeSheet]) && (
            <div className="overflow-hidden flex-1 flex flex-col">
              <div className="flex w-full">
                {Object.keys(currentAnalysis.data).map((sheet, idx) => {
                  const SheetIcon = getSheetIcon(sheet);
                  return (
                    <button
                      key={sheet}
                      onClick={() => setActiveSheet(sheet)}
                      className={`relative pl-2 pr-4 py-1 text-xs font-semibold transition-all duration-150 group flex-1 ${activeSheet === sheet ? 'text-gray-800 z-10' : 'text-gray-500 hover:text-gray-700'}`}
                      style={{
                        backgroundColor: activeSheet === sheet ? '#e5e7eb' : '#f3f4f6',
                        borderTopLeftRadius: '10px',
                        borderTopRightRadius: '10px',
                        borderTop: '1px solid #d1d5db',
                        borderLeft: '1px solid #d1d5db',
                        borderRight: '1px solid #d1d5db',
                        borderBottom: 'none',
                        position: 'relative',
                        overflow: 'hidden',
                        whiteSpace: 'nowrap',
                        textTransform: 'capitalize'
                      }}
                      title={sheet}
                    >
                      <span className="flex items-center gap-2 text-left w-full" style={{ overflow: 'hidden', whiteSpace: 'nowrap' }}>
                        <SheetIcon className="h-3 w-3 flex-shrink-0" />
                        <span style={{ overflow: 'hidden', textOverflow: 'clip' }}>{sheet.toLowerCase()}</span>
                      </span>
                      <span className="absolute right-0 top-0 bottom-0 w-8 pointer-events-none" style={{
                        background: `linear-gradient(to right, transparent, ${activeSheet === sheet ? '#e5e7eb' : '#f3f4f6'})`
                      }}></span>
                    </button>
                  );
                })}
              </div>

              {/* Active sheet table */}
              <div className="overflow-hidden shadow-lg flex-1">
                <div className="overflow-auto h-full bg-white max-w-full border-l border-r border-b border-gray-300">
                  <table className="min-w-full text-[11px] leading-tight border-collapse">
                <thead style={{ backgroundColor: '#e5e7eb' }}>
                  <tr>
                    {dynamicHeaders.map((h, idx) => (
                      <React.Fragment key={h}>
                        <th className={`px-2 py-2 font-medium border-r border-gray-300 last:border-r-0 align-top ${h === 'Original Transcript' || h === 'Cleaned Transcript' || h === 'Populate C.A.' ? 'text-center' : 'text-left'}`} style={{ whiteSpace: (h === 'Respondent ID' || h === 'Original Transcript' || h === 'Cleaned Transcript' || h === 'Populate C.A.') ? 'nowrap' : 'normal', minWidth: (h === 'Original Transcript' || h === 'Cleaned Transcript' || h === 'Populate C.A.') ? 'auto' : (h === 'Respondent ID' ? 'auto' : '180px'), lineHeight: '1.3', width: (h === 'Respondent ID' || h === 'Original Transcript' || h === 'Cleaned Transcript' || h === 'Populate C.A.') ? '1%' : 'auto' }}>
                          {activeSheet === 'Demographics' && h !== 'Respondent ID' && h !== 'respno' && h !== 'Interview Date' && h !== 'Interview Time' && h !== 'Original Transcript' && h !== 'Cleaned Transcript' && h !== 'Populate C.A.' ? (
                            <div className="flex items-center gap-1">
                              {editingColumnName === h ? (
                                <input
                                  type="text"
                                  value={editingColumnValue}
                                  onChange={(e) => setEditingColumnValue(e.target.value)}
                                  onBlur={() => handleRenameColumn(h, editingColumnValue)}
                                  onKeyDown={(e) => {
                                    if (e.key === 'Enter') {
                                      handleRenameColumn(h, editingColumnValue);
                                    } else if (e.key === 'Escape') {
                                      setEditingColumnName(null);
                                    }
                                  }}
                                  autoFocus
                                  className="flex-1 px-1 py-0.5 border border-orange-300 rounded text-xs focus:outline-none focus:ring-1 focus:ring-orange-400"
                                />
                              ) : (
                                <div
                                  className="flex-1 cursor-pointer hover:bg-gray-200 rounded px-1"
                                  onClick={() => {
                                    setEditingColumnName(h);
                                    setEditingColumnValue(h);
                                  }}
                                  style={{ display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}
                                >
                                  {h}
                                </div>
                              )}
                              <button
                                onClick={() => handleDeleteDemographicColumn(h)}
                                className="text-gray-400 hover:text-red-500 transition-colors"
                                title="Delete column"
                              >
                                <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                                </svg>
                              </button>
                            </div>
                          ) : (
                            <div style={{ display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
                              {h === 'Respondent ID' ? 'respno' : h}
                            </div>
                          )}
                        </th>
                        {/* Column divider with + button (only for Demographics, after last column) */}
                        {activeSheet === 'Demographics' && idx === dynamicHeaders.length - 1 && (
                          <th
                            className="relative p-0 border-r-0"
                            style={{ width: '8px', cursor: 'pointer' }}
                            onMouseEnter={() => setHoveredColumnDivider(idx)}
                            onMouseLeave={() => setHoveredColumnDivider(null)}
                          >
                            <div className="absolute inset-0 flex items-center justify-center" style={{ left: '-4px' }}>
                              {hoveredColumnDivider === idx && (
                                <button
                                  onClick={() => handleAddDemographicColumn(idx)}
                                  className="bg-gray-400 text-white rounded-full w-5 h-5 flex items-center justify-center hover:bg-gray-500 transition-colors shadow-md z-10"
                                  title="Add column here"
                                >
                                  <span className="text-xs font-bold">+</span>
                                </button>
                              )}
                            </div>
                          </th>
                        )}
                      </React.Fragment>
                    ))}
                    {activeSheet === 'Demographics' && currentAnalysis.data[activeSheet].some((row: any) =>
                      (row['Respondent ID'] && String(row['Respondent ID']).trim().startsWith('R')) ||
                      (row['respno'] && String(row['respno']).trim().startsWith('R'))
                    ) && (
                      <th className="px-2 py-2 text-center font-medium border-gray-200" style={{ width: '40px' }}>
                      </th>
                    )}
                  </tr>
                </thead>
                <tbody>
                  {currentAnalysis.data[activeSheet]
                    .filter((row: any) => {
                      if (activeSheet === 'Demographics') {
                        const respondentId = row['Respondent ID'] ?? row['respno'];
                        return respondentId !== undefined && String(respondentId).trim() !== '';
                      }
                      return Object.values(row).some(v => String(v ?? '').trim() !== '');
                    })
                    .map((row: any, i: number) => {
                      const rowRespondentId = row['Respondent ID'] || row['respno'];
                      const stringRespondentId = rowRespondentId !== undefined && rowRespondentId !== null ? String(rowRespondentId) : '';
                      const isHighlighted = highlightedRespondentId ? stringRespondentId === highlightedRespondentId : false;
                      // Check if this row has a respondent ID (real respondent vs template row)
                      const hasRespondentId = stringRespondentId.trim().startsWith('R');
                      // Check if any respondent exists in the sheet
                      const hasAnyRespondent = activeSheet === 'Demographics'
                        ? currentAnalysis.data[activeSheet].some((r: any) => {
                            const rid = r['Respondent ID'] || r['respno'];
                            return rid !== undefined && String(rid).trim().startsWith('R');
                          })
                        : true;
                      return (
                      <tr
                        key={i}
                        className={`${i % 2 === 0 ? 'bg-white' : 'bg-gray-50'} ${isHighlighted ? 'bg-orange-50 ring-1 ring-orange-300' : ''}`}
                      >
                        {dynamicHeaders.map((k, kidx) => {
                          const respondentId = row['Respondent ID'] || row['respno'];
                          const hasQuotes = currentAnalysis?.quotes?.[activeSheet]?.[respondentId]?.[k]?.length > 0;


                          return (
                            <React.Fragment key={k}>
                              <td
                                className={`px-2 py-1 text-gray-900 align-top border-r border-gray-300 last:border-r-0 border-b-0 ${activeSheet !== 'Demographics' && k !== 'Respondent ID' && k !== 'respno' ? 'cursor-pointer hover:bg-blue-50' : ''}`}
                                style={{ whiteSpace: k === 'Respondent ID' ? 'nowrap' : 'pre-wrap', width: k === 'Respondent ID' ? '1%' : 'auto' }}
                                onClick={(e) => {
                                  // Don't trigger click if clicking on an input field
                                  if ((e.target as HTMLElement).tagName === 'INPUT') return;
                                  handleCellClick(row, k);
                                }}
                              >
                                {activeSheet === 'Demographics' && k !== 'Respondent ID' && k !== 'respno' && k !== 'Original Transcript' && k !== 'Cleaned Transcript' && k !== 'Populate C.A.' && k !== 'Interview Date' && k !== 'Interview Time' ? (
                                  <input
                                    type="text"
                                    value={String(row[k] ?? '')}
                                    onChange={(e) => {
                                      const respondentId = row['Respondent ID'] || row['respno'];
                                      handleDemographicChange(respondentId, k, e.target.value);
                                    }}
                                    onKeyDown={(e) => {
                                      if (e.key === 'Enter') {
                                        e.preventDefault();
                                        (e.target as HTMLInputElement).blur();
                                      }
                                    }}
                                    className="w-full border bg-gray-100 focus:bg-white focus:outline-none focus:ring-1 focus:ring-orange-300 rounded px-1"
                                    style={{ minHeight: '20px' }}
                                  />
                                ) : k === 'Original Transcript' || k === 'Cleaned Transcript' ? (
                                  <div className="flex items-center justify-center gap-2">
                                    {(() => {
                                      // Try to find transcript by exact match first, then by any transcript if only one exists
                                      let transcript = transcripts.find(t => t.respno === rowRespondentId);
                                      if (!transcript && transcripts.length === 1) {
                                        transcript = transcripts[0];
                                      }
                                      if (!transcript) return <span className="text-gray-400 text-xs">No transcript</span>;
                                      
                                      const isOriginal = k === 'Original Transcript';
                                      const hasContent = isOriginal ? transcript.originalTranscript : transcript.cleanedTranscript;

                                      if (!hasContent) {
                                        return <span className="text-gray-400 text-xs">No {isOriginal ? 'original' : 'cleaned'} transcript</span>;
                                      }

                                      // Get the file path from the transcript object
                                      const filePath = isOriginal ? transcript.originalFilePath : transcript.cleanedFilePath;

                                      if (!filePath) {
                                        return <span className="text-gray-400 text-xs">File not available</span>;
                                      }

                                      const filename = filePath.split(/[\\/]/).pop() || 'transcript.docx';

                                      return (
                                        <button
                                          onClick={async () => {
                                            const downloadUrl = isOriginal ?
                                              `${API_BASE_URL}/api/caX/download/original/${filename}` :
                                              `${API_BASE_URL}/api/caX/download/cleaned/${filename}`;

                                            try {
                                              const response = await fetch(downloadUrl, {
                                                headers: {
                                                  'Authorization': `Bearer ${localStorage.getItem('cognitive_dash_token')}`
                                                }
                                              });

                                              if (response.ok) {
                                                const blob = await response.blob();
                                                const url = window.URL.createObjectURL(blob);
                                                const a = document.createElement('a');
                                                a.href = url;
                                                a.download = filename;
                                                document.body.appendChild(a);
                                                a.click();
                                                window.URL.revokeObjectURL(url);
                                                document.body.removeChild(a);
                                              } else {
                                                const error = await response.json();
                                                alert(`Download failed: ${error.error}`);
                                              }
                                            } catch (error) {
                                              console.error('Download error:', error);
                                              alert('Download failed - please try again');
                                            }
                                          }}
                                          className="px-2 py-1 text-xs bg-white text-gray-700 border border-gray-300 rounded hover:bg-gray-50 transition-colors flex items-center gap-1"
                                        >
                                          <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                                          </svg>
                                          Download
                                        </button>
                                      );
                                    })()}
                                  </div>
                                ) : k === 'Interview Date' ? (
                                  (() => {
                                    const dateValue = row[k];
                                    if (!dateValue) return '-';
                                    try {
                                      // Handle YYYY-MM-DD format directly to avoid timezone issues
                                      if (/^\d{4}-\d{2}-\d{2}$/.test(dateValue)) {
                                        const [year, month, day] = dateValue.split('-').map(Number);
                                        const shortYear = year.toString().slice(-2);
                                        return `${month}/${day}/${shortYear}`;
                                      }
                                      
                                      // For other formats, try parsing with Date
                                      const date = new Date(dateValue);
                                      if (isNaN(date.getTime())) return dateValue;
                                      const month = date.getMonth() + 1;
                                      const day = date.getDate();
                                      const year = date.getFullYear().toString().slice(-2);
                                      return `${month}/${day}/${year}`;
                                    } catch (error) {
                                      return dateValue;
                                    }
                                  })()
                                ) : k === 'Interview Time' ? (
                                  (() => {
                                    const timeValue = row[k];
                                    if (!timeValue) return '-';
                                    try {
                                      // If it's already in the correct format, return it
                                      if (/^\d{1,2}:\d{2}\s*(AM|PM)$/i.test(timeValue)) {
                                        return timeValue.toUpperCase();
                                      }
                                      
                                      // Try to parse and convert to standard format
                                      const time = new Date(`2000-01-01 ${timeValue}`);
                                      if (isNaN(time.getTime())) return timeValue;
                                      
                                      const hours = time.getHours();
                                      const minutes = time.getMinutes();
                                      const ampm = hours >= 12 ? 'PM' : 'AM';
                                      const displayHours = hours % 12 || 12;
                                      const displayMinutes = minutes.toString().padStart(2, '0');
                                      
                                      return `${displayHours}:${displayMinutes} ${ampm}`;
                                    } catch (error) {
                                      return timeValue;
                                    }
                                  })()
                                ) : (
                                  String(row[k] ?? '')
                                )}
                              </td>
                              {/* Empty spacer cell for column divider (only for Demographics, after last column) */}
                              {activeSheet === 'Demographics' && kidx === dynamicHeaders.length - 1 && (
                                <td className="p-0 border-r-0" style={{ width: '8px' }}></td>
                              )}
                            </React.Fragment>
                          );
                        })}
                        {activeSheet === 'Demographics' && hasAnyRespondent && (
                          <td className="px-2 py-1 text-center border-b-0">
                            {hasRespondentId && (
                              <button
                                onClick={() => handleDeleteRespondent(stringRespondentId)}
                                className="text-red-500 hover:text-red-700 hover:bg-red-50 rounded p-1 transition-colors"
                                title="Delete respondent"
                              >
                                <TrashIcon className="h-4 w-4" />
                              </button>
                            )}
                          </td>
                        )}
                      </tr>
                      );
                    })}
                </tbody>
              </table>
                </div>
              </div>


            </div>
          )}
        </div>
      )}
      </div>

      {/* Save to Project Modal */}
      {showSaveModal && createPortal(
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-[99999]">
          <div className="bg-white rounded-lg p-6 w-full max-w-md">
            <h3 className="text-lg font-semibold text-gray-900 mb-4">Save Content Analysis to Project</h3>

            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Project</label>
                <select
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-500"
                  value={saveFormData.projectId}
                  onChange={(e) => setSaveFormData({ ...saveFormData, projectId: e.target.value })}
                >
                  <option value="">Select a project...</option>
                  {projects.filter(p => !p.archived).map(project => (
                    <option key={project.id} value={project.id}>{project.name}</option>
                  ))}
                </select>
              </div>

              {saveFormData.projectId && (
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Content Analysis Name</label>
                  <input
                    type="text"
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-500"
                    value={saveFormData.name}
                    onChange={(e) => setSaveFormData({ ...saveFormData, name: e.target.value })}
                    placeholder="Enter analysis name..."
                  />
                </div>
              )}
            </div>

            <div className="flex items-center justify-end gap-2 mt-6">
              <button
                className="px-4 py-2 text-sm text-gray-700 bg-gray-100 rounded-lg hover:bg-gray-200 transition-colors"
                onClick={() => {
                  setShowSaveModal(false);
                  setSaveFormData({ projectId: '', name: '', description: '' });
                }}
                disabled={saving}
              >
                Cancel
              </button>
              <button
                className="px-4 py-2 text-sm text-white rounded-lg hover:opacity-90 transition-colors disabled:opacity-50"
                style={{ backgroundColor: '#D14A2D' }}
                onClick={handleSaveToProject}
                disabled={saving}
              >
                {saving ? 'Saving...' : 'Save'}
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}

      {/* Download Links - Simple notification */}
      {showSuccessMessage && (
        <div className="fixed top-4 right-4 bg-white border border-gray-200 px-4 py-3 rounded-lg shadow-lg z-50">
          <div className="flex items-center gap-3">
            <div className="text-sm text-gray-600">Transcript processed:</div>
            <div className="flex gap-2">
              {transcriptFilePaths.original && (
                <button
                  onClick={handleDownloadOriginal}
                  className="px-3 py-1 bg-blue-500 text-white rounded text-sm font-medium hover:bg-blue-600 transition-colors"
                >
                  📄 Original
                </button>
              )}
              {transcriptFilePaths.cleaned && (
                <button
                  onClick={handleDownloadCleaned}
                  className="px-3 py-1 bg-green-500 text-white rounded text-sm font-medium hover:bg-green-600 transition-colors"
                >
                  📝 Cleaned
                </button>
              )}
            </div>
            <button
              onClick={() => setShowSuccessMessage(false)}
              className="text-gray-400 hover:text-gray-600 ml-2"
            >
              ✕
            </button>
          </div>
        </div>
      )}

      {/* Save Success Message Toast */}
      {showSaveSuccessMessage && (
        <div className="fixed top-4 right-4 bg-green-500 text-white px-6 py-3 rounded-lg shadow-lg z-50 flex items-center gap-2">
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
          </svg>
          <span className="font-medium">Content analysis saved successfully!</span>
        </div>
      )}


      {/* Quotes Modal */}
      {showQuotesModal && createPortal(
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-[99999] p-4" onClick={() => setShowQuotesModal(false)}>
          <div className="bg-white rounded-lg p-6 w-full max-w-4xl max-h-[85vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-start justify-between mb-4">
              <div>
                <p className="text-sm text-gray-900 font-bold">
                  {activeSheet.split(' ').map(word => word.charAt(0) + word.slice(1).toLowerCase()).join(' ')}
                </p>
                <p className="text-sm text-gray-600 italic mt-1">
                  {selectedCellInfo.column}
                </p>
              </div>
              <button
                onClick={() => setShowQuotesModal(false)}
                className="text-gray-400 hover:text-gray-600"
              >
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            <div className="space-y-6 overflow-y-auto flex-1">
              {/* Key Finding Section - Simplified */}
              {selectedCellInfo.summary && (
                <div className="bg-orange-50 border border-orange-200 rounded-lg p-4">
                  <h3 className="text-sm font-semibold text-orange-900 mb-2">Key Finding</h3>
                  <p className="text-sm text-gray-800 whitespace-pre-line leading-relaxed">{selectedCellInfo.summary}</p>
                </div>
              )}

              {/* Verbatim Quotes Section - Shows actual transcript quotes */}
              <VerbatimQuotesSection 
                analysisId={currentAnalysis?.id}
                respondentId={selectedCellInfo.respondent}
                columnName={selectedCellInfo.column}
                sheetName={selectedCellInfo.sheet}
                keyFinding={selectedCellInfo.summary}
                onRefreshQuotes={async () => {
                  try {
                    // Clear the cache for this specific cell
                    const response = await fetch(`${API_BASE_URL}/api/caX/clear-quotes-cache`, {
                      method: 'POST',
                      headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${localStorage.getItem('cognitive_dash_token')}`
                      },
                      body: JSON.stringify({
                        analysisId: currentAnalysis?.id,
                        respondentId: selectedCellInfo.respondent,
                        columnName: selectedCellInfo.column,
                        sheetName: selectedCellInfo.sheet
                      })
                    });
                    
                    if (response.ok) {
                      // Close and reopen the modal to refresh quotes
                      setShowQuotesModal(false);
                      setTimeout(() => setShowQuotesModal(true), 100);
                    }
                  } catch (error) {
                    console.error('Error clearing quotes cache:', error);
                  }
                }}
              />

            </div>

            {/* Demographics Footer */}
            {selectedCellInfo.respondent && currentAnalysis?.data?.Demographics && (
              <div className="mt-4 pt-4 border-t border-gray-200 flex items-center justify-between">
                <div className="text-xs text-gray-600">
                  {(() => {
                    const demoRow = currentAnalysis.data.Demographics.find((row: any) =>
                      (row['Respondent ID'] || row['respno']) === selectedCellInfo.respondent
                    );
                    if (!demoRow) return null;

                    const demographics = Object.entries(demoRow)
                      .filter(([key, value]) => {
                        const keyLower = key.toLowerCase();
                        // Show all demographic fields except system ones
                        return value &&
                               value.toString().trim() !== '' &&
                               key !== 'Respondent ID' &&
                               key !== 'respno' &&
                               key !== 'transcriptId' &&
                               !keyLower.includes('original transcript') &&
                               !keyLower.includes('cleaned transcript') &&
                               !keyLower.includes('populate c.a.') &&
                               !keyLower.includes('new column');
                      })
                      .map(([key, value]) => {
                        // Format Interview Date to short format (MM/DD/YY)
                        if (key === 'Interview Date' && value) {
                          try {
                            const dateStr = value.toString();
                            // Parse YYYY-MM-DD format
                            if (/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
                              const [year, month, day] = dateStr.split('-');
                              const shortYear = year.slice(-2);
                              return `${key}: ${month}/${day}/${shortYear}`;
                            }
                          } catch (error) {
                            console.error('Error formatting date:', error);
                          }
                        }
                        return `${key}: ${value}`;
                      })
                      .join(' | ');

                    return demographics || null;
                  })()}
                </div>
                <div className="text-xs text-gray-500">
                  {selectedCellInfo.respondent}
                </div>
              </div>
            )}
          </div>
        </div>,
        document.body
      )}

      {/* End viewer */}
      {/* Discussion Guide Modal */}
      {showDiscussionGuideModal && createPortal(
        <div
          className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-[99999] p-4"
          onClick={() => setShowDiscussionGuideModal(false)}
        >
          <div className="bg-white rounded-lg w-full max-w-4xl max-h-[85vh] flex flex-col overflow-hidden" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between p-4 border-b border-gray-200">
              <h3 className="text-lg font-semibold text-gray-900">{currentAnalysis?.name} - Discussion Guide</h3>
              <button
                onClick={() => setShowDiscussionGuideModal(false)}
                className="text-gray-400 hover:text-gray-600 transition-colors"
              >
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            <div className="flex-1 overflow-y-auto flex items-start">
              <div
                ref={docxContainerRef}
                className="docx-preview-container w-full"
              />
            </div>
          </div>
        </div>,
        document.body
      )}

      {/* Transcript Upload Modal */}
      {showTranscriptUploadModal && createPortal(
        <div
          className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-[99999] p-4"
          onClick={() => !processingTranscript && setShowTranscriptUploadModal(false)}
        >
          <div className="bg-white rounded-lg w-full max-w-2xl max-h-[85vh] flex flex-col overflow-hidden" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between p-4 border-b border-gray-200">
              <h3 className="text-lg font-semibold text-gray-900">Upload Transcript</h3>
              <button
                onClick={() => !processingTranscript && setShowTranscriptUploadModal(false)}
                disabled={processingTranscript}
                className={`text-gray-400 hover:text-gray-600 transition-colors ${processingTranscript ? 'opacity-50 cursor-not-allowed' : ''}`}
              >
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            {processingTranscript ? (
              /* Loading Screen */
              <div className="flex-1 flex items-center justify-center p-8">
                <div className="text-center">
                  <div className="w-16 h-16 mx-auto mb-4">
                    <svg className="animate-spin w-16 h-16" fill="none" viewBox="0 0 24 24" style={{ color: '#D14A2D' }}>
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                    </svg>
                  </div>
                  <h3 className="text-lg font-semibold text-gray-900 mb-2">Processing Transcript</h3>
                  <p className="text-gray-600 mb-4">This may take a few minutes. Please keep this page open.</p>
                  <div className="flex items-center justify-center space-x-2 text-sm text-gray-500">
                    <div className="w-2 h-2 rounded-full animate-bounce" style={{ backgroundColor: '#D14A2D' }}></div>
                    <div className="w-2 h-2 rounded-full animate-bounce" style={{ backgroundColor: '#D14A2D', animationDelay: '0.1s' }}></div>
                    <div className="w-2 h-2 rounded-full animate-bounce" style={{ backgroundColor: '#D14A2D', animationDelay: '0.2s' }}></div>
                  </div>
                </div>
              </div>
            ) : (
              <div className="flex-1 overflow-y-auto p-4 space-y-6">
                {currentAnalysis?.projectId && (
                  <div className="rounded-lg border border-gray-200 p-4 text-left">
                    <h4 className="text-sm font-semibold text-gray-900">Use an existing project transcript</h4>
                    <p className="mt-1 text-sm text-gray-500">
                      Choose a transcript from the Transcripts tab. Already imported transcripts are disabled.
                    </p>
                    {loadingProjectTranscripts ? (
                      <div className="mt-4 flex items-center text-sm text-gray-500">
                        <svg className="h-4 w-4 animate-spin text-gray-400" viewBox="0 0 24 24">
                          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0c-5.373 0-10 4.627-10 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                        </svg>
                        <span className="ml-3">Loading project transcripts...</span>
                      </div>
                    ) : projectTranscriptFetchError ? (
                      <p className="mt-3 text-sm text-red-600">{projectTranscriptFetchError}</p>
                    ) : transcriptDropdownOptions.length === 0 ? (
                      <p className="mt-3 text-sm text-gray-500">
                        No transcripts from this project are available yet.
                      </p>
                    ) : (
                      <div className="mt-3 space-y-3">
                        <select
                          value={selectedExistingTranscriptId}
                          onChange={(e) => {
                            const value = e.target.value;
                            setSelectedExistingTranscriptId(value);
                            if (value) {
                              setTranscriptFile(null);
                              if (transcriptFileInputRef.current) {
                                transcriptFileInputRef.current.value = '';
                              }
                            }
                          }}
                          className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#D14A2D]"
                        >
                          <option value="">Select a transcript...</option>
                          {transcriptDropdownOptions.map(option => (
                            <option key={option.id} value={option.id} disabled={option.disabled}>
                              {option.label}
                            </option>
                          ))}
                        </select>
                        <p className="text-xs text-gray-500">
                          We'll reuse the stored file and process it with {MODEL_TOKEN_PRICING.modelName}.
                        </p>
                      </div>
                    )}
                  </div>
                )}

              </div>
            )}
            {!processingTranscript && (
              <div className="flex items-center justify-between p-4 border-t border-gray-200">
                {(() => {
                  if (transcriptFile) {
                    const estimate = calculateCostEstimate(transcriptFile);
                    return estimate ? (
                      <div className="text-xs text-red-600 italic">
                        Estimated Cost ({MODEL_TOKEN_PRICING.modelName}): {estimate.formattedCost}
                      </div>
                    ) : (
                      <div className="text-xs text-gray-400 italic">
                        Unable to estimate cost for this file.
                      </div>
                    );
                  }

                  if (selectedExistingTranscriptId) {
                    return existingTranscriptCostEstimate ? (
                      <div className="text-xs text-red-600 italic">
                        Estimated Cost ({MODEL_TOKEN_PRICING.modelName}): {existingTranscriptCostEstimate.formattedCost}
                      </div>
                    ) : (
                      <div className="text-xs text-gray-500 italic">
                        Using stored transcript. {MODEL_TOKEN_PRICING.modelName} pricing applies (~$2.50 per 1M input tokens).
                      </div>
                    );
                  }

                  return (
                    <div className="text-xs text-gray-400 italic">
                      Select a file or existing transcript to see cost estimate
                    </div>
                  );
                })()}
                <div className="flex items-center space-x-3">
                  <button
                    onClick={() => {
                      setShowTranscriptUploadModal(false);
                      setTranscriptFile(null);
                      setSelectedExistingTranscriptId('');
                      setExistingTranscriptCostEstimate(null);
                      if (transcriptFileInputRef.current) {
                        transcriptFileInputRef.current.value = '';
                      }
                    }}
                    className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50"
                  >
                    Cancel
                  </button>
                <button
                  onClick={async () => {
                    if (processingTranscript) return;
                    await handleTranscriptUpload({
                      file: transcriptFile || undefined,
                      existingTranscriptId: selectedExistingTranscriptId || undefined
                    });
                  }}
                  disabled={processingTranscript || (!transcriptFile && !selectedExistingTranscriptId)}
                  className="px-4 py-2 text-sm font-medium text-white bg-blue-600 border border-transparent rounded-md hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {transcriptFile ? 'Upload & Process' : 'Import & Process'}
                </button>
                </div>
              </div>
            )}
          </div>
        </div>,
        document.body
      )}

      {/* Removed Populate CA Modal - upload now directly populates CA */}
      {false && createPortal(
        <div
          className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-[99999] p-4"
          onClick={() => setShowGenerateModal(false)}
        >
          <div className="bg-white rounded-lg w-full max-w-md" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between p-4 border-b border-gray-200">
              <h3 className="text-lg font-semibold text-gray-900">Generate Content Analysis</h3>
              <button
                onClick={() => setShowGenerateModal(false)}
                className="text-gray-400 hover:text-gray-600 transition-colors"
              >
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            <div className="p-4">
              {generatingAnalysis ? (
                <div className="flex items-center justify-center py-8">
                  <div className="text-center">
                    <div className="w-16 h-16 mx-auto mb-4">
                      <svg className="animate-spin w-16 h-16" fill="none" viewBox="0 0 24 24" style={{ color: '#D14A2D' }}>
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                      </svg>
                    </div>
                    <h3 className="text-lg font-semibold text-gray-900 mb-2">Populating Content Analysis</h3>
                    <p className="text-gray-600 mb-4">This may take a few minutes. Please keep this page open.</p>
                    <div className="flex items-center justify-center space-x-2 text-sm text-gray-500">
                      <div className="w-2 h-2 rounded-full animate-bounce" style={{ backgroundColor: '#D14A2D' }}></div>
                      <div className="w-2 h-2 rounded-full animate-bounce" style={{ backgroundColor: '#D14A2D', animationDelay: '0.1s' }}></div>
                      <div className="w-2 h-2 rounded-full animate-bounce" style={{ backgroundColor: '#D14A2D', animationDelay: '0.2s' }}></div>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="space-y-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Which transcript do you want to use to generate or populate the content analysis?
                    </label>
                    <select
                      value={selectedTranscriptType}
                      onChange={(e) => setSelectedTranscriptType(e.target.value as 'original' | 'cleaned')}
                      className="w-full border rounded px-3 py-2"
                    >
                      <option value="cleaned">Cleaned Transcript (Recommended)</option>
                      <option value="original">Original Transcript</option>
                    </select>
                  </div>
                  <div className="text-sm text-gray-600">
                    <p>This will populate content analysis using the {selectedTranscriptType} transcript for all respondents.</p>
                    <p className="mt-1">Found {transcripts.length} transcript(s) to process.</p>
                  </div>
                  <div className="flex justify-end gap-2">
                    <button
                      onClick={() => setShowGenerateModal(false)}
                      className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50"
                    >
                      Cancel
                    </button>
                    <button
                      onClick={async () => {
                        setGeneratingAnalysis(true);

                      try {
                        // Call the content analysis generation API
                        const response = await fetch(`${API_BASE_URL}/api/caX/generate-from-transcripts`, {
                          method: 'POST',
                          headers: {
                            'Content-Type': 'application/json',
                            'Authorization': `Bearer ${localStorage.getItem('cognitive_dash_token')}`
                          },
                          body: JSON.stringify({
                            projectId: currentAnalysis?.projectId,
                            analysisId: currentAnalysis?.id,
                            transcriptType: selectedTranscriptType,
                            transcripts: transcripts
                          })
                        });

                        if (response.ok) {
                          const result = await response.json();
                          // Reload the analysis with the new data
                          try {
                            const token = localStorage.getItem('token');
                            const reloadResponse = await fetch(`${API_BASE_URL}/api/caX/saved/${currentAnalysis.id}`, {
                              headers: token ? { 'Authorization': `Bearer ${token}` } : undefined,
                            });
                            if (reloadResponse.ok) {
                              const reloadedAnalysis = await reloadResponse.json();
                              const normalizedReloaded = normalizeAnalysisRespnos(reloadedAnalysis, projectTranscriptsForUpload);
                              setCurrentAnalysis(normalizedReloaded);
                              setTranscripts(normalizedReloaded?.transcripts || []);
                            }
                          } catch (e) {
                            console.error('Failed to reload analysis:', e);
                          }
                          setShowGenerateModal(false);
                          setShowSuccessMessage(true);
                          setTimeout(() => setShowSuccessMessage(false), 3000);
                        } else {
                          const error = await response.json();
                          alert(`Content analysis generation failed: ${error.error}`);
                        }
                      } catch (error) {
                        console.error('Content analysis generation error:', error);
                        alert('Content analysis generation failed - please try again');
                      } finally {
                        setGeneratingAnalysis(false);
                      }
                    }}
                    disabled={generatingAnalysis}
                    className="px-4 py-2 text-sm font-medium text-white border border-transparent rounded-md hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed transition-opacity"
                    style={{ backgroundColor: '#D14A2D' }}
                  >
                    {generatingAnalysis ? 'Populating...' : 'Populate C.A.'}
                  </button>
                </div>
              </div>
              )}
            </div>
          </div>
        </div>,
        document.body
      )}

      {/* Storyboard Modal */}
      <StoryboardModal
        isOpen={showStoryboardModal}
        onClose={() => setShowStoryboardModal(false)}
        onGenerate={handleGenerateStoryboard}
        currentAnalysis={currentAnalysis}
        projectTranscripts={projectTranscriptsForUpload}
        discussionGuidePath={
          currentAnalysis?.projectId && projects.find(p => p.id === currentAnalysis.projectId)?.hasDiscussionGuide
            ? `/api/caX/discussion-guide/${currentAnalysis.projectId}/download`
            : undefined
        }
        generating={generatingStoryboard}
      />

    </div>
  );
}
