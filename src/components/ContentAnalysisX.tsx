import { API_BASE_URL } from '../config';
import React, { useEffect, useMemo, useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { CloudArrowUpIcon, TrashIcon, CalendarIcon, UserGroupIcon, UserIcon, BookOpenIcon, BeakerIcon, LightBulbIcon, ChartBarIcon, TrophyIcon, ChatBubbleLeftRightIcon, ExclamationTriangleIcon, ExclamationCircleIcon, ArrowTrendingUpIcon, UsersIcon, DocumentMagnifyingGlassIcon, CheckCircleIcon, EllipsisHorizontalCircleIcon, DocumentTextIcon } from '@heroicons/react/24/outline';
import { Document, Packer, Paragraph, TextRun, HeadingLevel, AlignmentType } from 'docx';

interface ContentAnalysisXProps {
  projects?: any[];
  onNavigate?: (route: string) => void;
  onNavigateToProject?: (project: any) => void;
}

export default function ContentAnalysisX({ projects = [], onNavigate, onNavigateToProject }: ContentAnalysisXProps) {
  const { user } = useAuth();
  const [showMyProjectsOnly, setShowMyProjectsOnly] = useState(true);
  const [savedAnalyses, setSavedAnalyses] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [viewMode, setViewMode] = useState<'home' | 'viewer' | 'create'>('home');
  const [loadingSavedView, setLoadingSavedView] = useState(false);
  const [currentAnalysis, setCurrentAnalysis] = useState<any | null>(null);
  const [activeSheet, setActiveSheet] = useState<string>('');
  const [uploading, setUploading] = useState(false);
  const [showSaveModal, setShowSaveModal] = useState(false);
  const [saveFormData, setSaveFormData] = useState({ projectId: '', name: '', description: '' });
  const [saving, setSaving] = useState(false);
  const [processingTranscript, setProcessingTranscript] = useState(false);
  const [showSuccessMessage, setShowSuccessMessage] = useState(false);
  const [showSaveSuccessMessage, setShowSaveSuccessMessage] = useState(false);
  const [showQuotesModal, setShowQuotesModal] = useState(false);
  const [selectedQuotes, setSelectedQuotes] = useState<string[]>([]);
  const [selectedCellInfo, setSelectedCellInfo] = useState({ column: '', respondent: '' });
  const [copiedQuoteIndex, setCopiedQuoteIndex] = useState<number | null>(null);
  const [hoveredColumnDivider, setHoveredColumnDivider] = useState<number | null>(null);
  const [editingColumnName, setEditingColumnName] = useState<string | null>(null);
  const [editingColumnValue, setEditingColumnValue] = useState<string>('');
  // Header edit state
  const [editingHeader, setEditingHeader] = useState(false);
  const [editAnalysisName, setEditAnalysisName] = useState('');
  const [editProjectId, setEditProjectId] = useState('');
  const [editingTitle, setEditingTitle] = useState(false);
  const [editingProject, setEditingProject] = useState(false);
  // Create form state
  const [createFormData, setCreateFormData] = useState({ title: '', projectId: '', discussionGuide: null as File | null });
  const [generatingAnalysis, setGeneratingAnalysis] = useState(false);
  // Transcripts state - stores cleaned transcripts with demographic info
  const [transcripts, setTranscripts] = useState<Array<{
    id: string;
    respno: string;
    demographics: Record<string, string>;
    cleanedTranscript: string;
    originalTranscript: string;
    uploadedAt: string;
  }>>(currentAnalysis?.transcripts || []);

  // Sync transcripts when currentAnalysis changes
  useEffect(() => {
    if (currentAnalysis?.transcripts) {
      setTranscripts(currentAnalysis.transcripts);
    } else {
      setTranscripts([]);
    }
  }, [currentAnalysis]);

  // Dynamic headers: union of keys across all rows for the active sheet
  const dynamicHeaders = useMemo(() => {
    const rows = (currentAnalysis?.data?.[activeSheet] as any[]) || [];
    const set = new Set<string>();
    for (const r of rows) {
      Object.keys(r || {}).forEach((k) => set.add(k));
    }
    const headers = Array.from(set);

    // Add Transcript column for Demographics sheet if there are any transcripts
    if (activeSheet === 'Demographics' && transcripts.length > 0) {
      headers.push('Transcript');
    }

    return headers;
  }, [currentAnalysis?.data, activeSheet, transcripts.length]);

  // Handler for deleting a demographic column
  const handleDeleteDemographicColumn = (columnName: string) => {
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
            'Authorization': `Bearer ${localStorage.getItem('jaice_token')}`
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

      let insertedNewColumn = false;
      rowKeys.forEach((key, index) => {
        newRow[key] = row[key];
        // Insert new column after the specified position
        if (index === afterColumnIndex) {
          newRow[newColumnName] = '';
          insertedNewColumn = true;
        }
      });

      // If position is at the end, add it there
      if (!insertedNewColumn) {
        newRow[newColumnName] = '';
      }

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
            'Authorization': `Bearer ${localStorage.getItem('jaice_token')}`
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
              'Authorization': `Bearer ${localStorage.getItem('jaice_token')}`
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

  // Handler for cell click to show quotes
  const handleCellClick = (row: any, columnKey: string) => {
    // Skip Demographics and respno column
    if (activeSheet === 'Demographics' || columnKey === 'Respondent ID' || columnKey === 'respno') return;

    const respondentId = row['Respondent ID'] || row['respno'] || 'Unknown';

    // Get quotes from the analysis data (if stored)
    const quotes = currentAnalysis?.quotes?.[activeSheet]?.[respondentId]?.[columnKey] || [];


    // Show modal even if no quotes (will display "No quotes available" message)
    setSelectedQuotes(quotes);
    setSelectedCellInfo({ column: columnKey, respondent: respondentId });
    setShowQuotesModal(true);
  };

  // Handler for deleting a respondent
  const handleDeleteRespondent = async (rowIndex: number) => {
    if (!currentAnalysis) return;

    if (!confirm("Delete this respondent? This cannot be undone.")) {
      return;
    }

    const updatedData = { ...currentAnalysis.data };

    // Get the respondent ID before deletion
    const respondentId = updatedData.Demographics[rowIndex]['Respondent ID'] || updatedData.Demographics[rowIndex]['respno'];

    // Remove the respondent from all sheets
    Object.keys(updatedData).forEach(sheetName => {
      if (Array.isArray(updatedData[sheetName])) {
        updatedData[sheetName] = updatedData[sheetName].filter((row: any, idx: number) => {
          if (sheetName === 'Demographics') {
            return idx !== rowIndex;
          } else {
            // For other sheets, match by respondent ID
            const rowRespondentId = row['Respondent ID'] || row['respno'];
            return rowRespondentId !== respondentId;
          }
        });
      }
    });

    // Update quotes to remove deleted respondent
    const updatedQuotes = { ...currentAnalysis.quotes };
    Object.keys(updatedQuotes).forEach(sheetName => {
      if (updatedQuotes[sheetName] && updatedQuotes[sheetName][respondentId]) {
        delete updatedQuotes[sheetName][respondentId];
      }
    });

    setCurrentAnalysis({
      ...currentAnalysis,
      data: updatedData,
      quotes: updatedQuotes
    });

    // Auto-save if this is a saved analysis
    if (currentAnalysis.projectId) {
      try {
        await fetch(`${API_BASE_URL}/api/caX/update`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${localStorage.getItem('jaice_token')}` },
          body: JSON.stringify({
            id: currentAnalysis.id,
            data: updatedData,
            quotes: updatedQuotes
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
        headers: { 'Authorization': `Bearer ${localStorage.getItem('jaice_token')}` }
      });
      clearTimeout(timeoutId);
      
      if (!res.ok) {
        throw new Error(`HTTP error! status: ${res.status}`);
      }
      const json = await res.json();
      setSavedAnalyses(Array.isArray(json) ? json : []);
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

  // Separate effect for event listener that depends on savedAnalyses
  useEffect(() => {
    const handleLoadAnalysis = (event: any) => {
      const { analysisId } = event.detail;
      const analysis = savedAnalyses.find(a => a.id === analysisId);
      if (analysis) {
        loadSavedAnalysis(analysis);
      }
    };

    window.addEventListener('loadContentAnalysis', handleLoadAnalysis);
    return () => window.removeEventListener('loadContentAnalysis', handleLoadAnalysis);
  }, [savedAnalyses]); // Now properly includes savedAnalyses

  const withProjectOnly = useMemo(() => (savedAnalyses || []).filter(a => !!a.projectId), [savedAnalyses]);

  const getProjectName = (analysis: any) => (
    analysis.project || analysis.projectName || projects.find(p => p.id === analysis.projectId)?.name || 'Unknown Project'
  );

  const filtered = useMemo(() => {
    if (!showMyProjectsOnly) return withProjectOnly;
    const uid = user?.id;
    const uemail = (user as any)?.email?.toLowerCase?.();
    const uname = (user as any)?.name?.toLowerCase?.();
    return withProjectOnly.filter((a: any) => {
      const p = projects.find((p: any) => p.id === a.projectId);
      if (!p) return false;
      const createdByMe = (p as any).createdBy && (p as any).createdBy === uid;
      const inTeam = (p.teamMembers || []).some((m: any) =>
        m?.id === uid ||
        (m?.email && uemail && String(m.email).toLowerCase() === uemail) ||
        (m?.name && uname && String(m.name).toLowerCase() === uname)
      );
      return createdByMe || inTeam;
    });
  }, [showMyProjectsOnly, withProjectOnly, projects, user?.id]);

  const filteredProjects = useMemo(() => {
    // Filter for qualitative projects only
    const qualProjects = projects.filter(p => !p.archived && p.methodologyType === 'Qualitative');

    if (!showMyProjectsOnly) return qualProjects;

    const uid = user?.id;
    const uemail = (user as any)?.email?.toLowerCase?.();
    const uname = (user as any)?.name?.toLowerCase?.();

    return qualProjects.filter((p: any) => {
      const createdByMe = p.createdBy && p.createdBy === uid;
      const inTeam = (p.teamMembers || []).some((m: any) =>
        m?.id === uid ||
        (m?.email && uemail && String(m.email).toLowerCase() === uemail) ||
        (m?.name && uname && String(m.name).toLowerCase() === uname)
      );
      return createdByMe || inTeam;
    });
  }, [showMyProjectsOnly, projects, user?.id]);

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
      const token = localStorage.getItem('jaice_token');
      // Try to fetch full analysis (including quotes) by id
      const resp = await fetch(`${API_BASE_URL}/api/caX/saved/${analysis.id}`, {
        headers: token ? { 'Authorization': `Bearer ${token}` } : undefined,
      });
      if (resp.ok) {
        const full = await resp.json();
        setCurrentAnalysis(full || analysis);
        const sheets = Object.keys((full || analysis)?.data || {});
        if (sheets.length) setActiveSheet(sheets[0]);
      } else {
        // Fallback to provided object
        setCurrentAnalysis(analysis);
        const sheets = Object.keys(analysis?.data || {});
        if (sheets.length) setActiveSheet(sheets[0]);
      }
    } catch (e) {
      // Network/endpoint not available; fallback to provided object
      setCurrentAnalysis(analysis);
      const sheets = Object.keys(analysis?.data || {});
      if (sheets.length) setActiveSheet(sheets[0]);
    } finally {
      setLoadingSavedView(false);
    }
  };

  const deleteSavedAnalysis = async (id: string, name: string) => {
    if (!confirm(`Delete content analysis "${name}"?`)) return;
    try {
      await fetch(`${API_BASE_URL}/api/caX/delete/${id}`, { method: 'DELETE', headers: { 'Authorization': `Bearer ${localStorage.getItem('jaice_token')}` } });
      setSavedAnalyses(prev => prev.filter(a => a.id !== id));
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
        headers: { 'Authorization': `Bearer ${localStorage.getItem('jaice_token')}` }
      });

      if (response.ok) {
        const result = await response.json();

        // Create a new analysis with the generated data
        const newAnalysis = {
          id: `temp-${Date.now()}`,
          name: result.fileName?.replace('.docx', '') || 'New Content Analysis',
          projectId: null,
          projectName: 'No Project',
          data: result.data,
          quotes: {},
          rawGuideText: result.rawGuideText,
          savedAt: new Date().toISOString(),
          savedBy: 'You'
        };

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
        headers: { 'Authorization': `Bearer ${localStorage.getItem('jaice_token')}` }
      });

      if (response.ok) {
        const result = await response.json();

        // Create a new analysis with the generated data
        const newAnalysis = {
          id: `temp-${Date.now()}`,
          name: createFormData.title,
          projectId: createFormData.projectId || null,
          projectName: createFormData.projectId ? projects.find(p => p.id === createFormData.projectId)?.name || 'Unknown Project' : 'No Project',
          data: result.data,
          quotes: {},
          rawGuideText: result.rawGuideText,
          savedAt: new Date().toISOString(),
          savedBy: 'You'
        };

        // Switch to viewer mode with the new analysis
        setCurrentAnalysis(newAnalysis);
        const sheets = Object.keys(newAnalysis.data);
        if (sheets.length) setActiveSheet(sheets[0]);
        setViewMode('viewer');

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
      const response = await fetch(`${API_BASE_URL}/api/caX/save`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${localStorage.getItem('jaice_token')}` },
        body: JSON.stringify({
          projectId: saveFormData.projectId,
          projectName: selectedProject?.name || 'Unknown Project',
          name: saveFormData.name,
          data: currentAnalysis?.data,
          quotes: currentAnalysis?.quotes || {},
          discussionGuide: currentAnalysis?.rawGuideText
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

  const handleTranscriptUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!currentAnalysis?.data || !activeSheet) {
      alert('No active analysis or sheet');
      return;
    }

    setProcessingTranscript(true);
    try {
      const formData = new FormData();
      formData.append('transcript', file);
      formData.append('projectId', currentAnalysis.projectId || 'temp');
      formData.append('analysisId', currentAnalysis.id);
      formData.append('activeSheet', activeSheet);
      formData.append('currentData', JSON.stringify(currentAnalysis.data));
      formData.append('discussionGuide', currentAnalysis.rawGuideText || '');

      const response = await fetch(`${API_BASE_URL}/api/caX/process-transcript`, {
        method: 'POST',
        body: formData,
        headers: { 'Authorization': `Bearer ${localStorage.getItem('jaice_token')}` }
      });

      if (response.ok) {
        const result = await response.json();

        console.log('=== TRANSCRIPT UPLOAD RESULT ===');
        console.log('Sheets in result.data:', Object.keys(result.data || {}));
        console.log('Current analysis sheets before update:', Object.keys(currentAnalysis.data || {}));

        // Log each sheet's row count
        for (const [sheetName, sheetData] of Object.entries(result.data || {})) {
          console.log(`Sheet "${sheetName}": ${Array.isArray(sheetData) ? sheetData.length : 0} rows`);
        }

        // Update the current analysis with the new respondent data and quotes
        // Merge quotes properly - don't replace, but merge sheet by sheet
        const mergedQuotes = { ...currentAnalysis.quotes };
        if (result.quotes) {
          for (const [sheetName, sheetQuotes] of Object.entries(result.quotes)) {
            if (!mergedQuotes[sheetName]) mergedQuotes[sheetName] = {};
            mergedQuotes[sheetName] = { ...mergedQuotes[sheetName], ...(sheetQuotes as any) };
          }
        }

        // Add cleaned transcript to transcripts array
        const newTranscripts = [...transcripts];
        if (result.cleanedTranscript && result.respno) {
          // Get demographics for this respondent
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

          newTranscripts.push({
            id: Date.now().toString(),
            respno: result.respno,
            demographics,
            cleanedTranscript: result.cleanedTranscript,
            originalTranscript: result.originalTranscript || '',
            uploadedAt: new Date().toISOString()
          });
          setTranscripts(newTranscripts);
        }

        const updatedAnalysis = {
          ...currentAnalysis,
          data: result.data,
          quotes: mergedQuotes,
          transcripts: newTranscripts
        };

        console.log('Updated analysis sheets:', Object.keys(updatedAnalysis.data || {}));
        for (const [sheetName, sheetData] of Object.entries(updatedAnalysis.data || {})) {
          console.log(`Updated Sheet "${sheetName}": ${Array.isArray(sheetData) ? sheetData.length : 0} rows`);
        }

        setCurrentAnalysis(updatedAnalysis);

        // Auto-save if this is a saved analysis (has projectId)
        if (currentAnalysis.projectId) {
          try {
            const saveResponse = await fetch(`${API_BASE_URL}/api/caX/update`, {
              method: 'PUT',
              headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${localStorage.getItem('jaice_token')}` },
              body: JSON.stringify({
                id: currentAnalysis.id,
                data: result.data,
                quotes: mergedQuotes,
                transcripts: newTranscripts
              })
            });

            if (!saveResponse.ok) {
              console.error('Auto-save failed');
            }
          } catch (saveError) {
            console.error('Auto-save error:', saveError);
          }
        }

        // Show success message
        setShowSuccessMessage(true);
        setTimeout(() => setShowSuccessMessage(false), 3000);
      } else {
        const error = await response.json();
        alert(`Transcript processing failed: ${error.error}`);
      }
    } catch (error) {
      console.error('Transcript processing error:', error);
      alert('Transcript processing failed - make sure the backend server is running');
    } finally {
      setProcessingTranscript(false);

      // Reset file input to allow re-uploading the same file
      e.target.value = '';
    }
  };

  // Helper function to download transcript as Word document
  const downloadTranscriptAsWord = async (transcript: any) => {
    try {
      // Parse the cleaned transcript to extract dialogue
      const lines = transcript.cleanedTranscript.split('\n').filter((line: string) => line.trim());

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

      // Generate and download
      const blob = await Packer.toBlob(doc);
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
    <div className="flex-1 p-6 space-y-6 max-w-full overflow-hidden">
      <div className="space-y-5">
        {/* Header */}
        <section className="flex items-center justify-between">
          <h2 className="text-2xl font-bold" style={{ color: '#5D5F62' }}>Content Analysis</h2>
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
                    ? 'text-white hover:opacity-90'
                    : 'bg-white border border-gray-300 hover:bg-gray-50'
                }`}
                style={(viewMode === 'home' || viewMode === 'create') && !uploading && !generatingAnalysis && showMyProjectsOnly ? { backgroundColor: '#D14A2D' } : {}}
              >
                {showMyProjectsOnly ? 'Only My Projects' : 'All Cognitive Projects'}
              </button>
            </div>
          )}
        </section>

        {/* Title bar with Generate button */}
        <div className="border-b border-gray-200">
          <div className="flex items-center pb-3">
            {viewMode === 'viewer' ? (
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
            ) : (
              <>
                <p className="text-sm text-gray-600">View and manage your saved content analyses</p>
                <button
                  onClick={() => setViewMode('create')}
                  disabled={viewMode !== 'home'}
                  className={`flex items-center gap-1 rounded-lg px-3 py-1 text-xs shadow-sm transition-colors ml-4 ${viewMode === 'home' ? 'text-white hover:opacity-90 cursor-pointer' : 'bg-gray-200 text-gray-400 cursor-not-allowed'}`}
                  style={viewMode === 'home' ? { backgroundColor: '#D14A2D' } : {}}
                >
                  <CloudArrowUpIcon className="h-4 w-4" />
                  Generate New
                </button>
              </>
            )}
          </div>
        </div>

      {/* Body: table list, spinner, or analysis */}
      {viewMode === 'home' && (
        <div className="bg-white shadow-sm border border-gray-200 rounded-lg overflow-hidden">
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Analysis</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Project</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Saved</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Respondents</th>
                  <th className="px-6 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider">Actions</th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {loading ? (
                  <tr>
                    <td colSpan={5} className="px-6 py-6">
                      <div className="flex items-center gap-2 text-gray-700">
                        <img src="/Circle.png" alt="Loading" className="w-4 h-4 animate-spin" />
                        <span className="text-sm">Loading...</span>
                      </div>
                    </td>
                  </tr>
                ) : filtered.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="px-6 py-10 text-center text-gray-500">No content analyses found</td>
                  </tr>
                ) : (
                  filtered.map((a) => (
                    <tr key={a.id} className="hover:bg-gray-50 cursor-pointer" onClick={() => loadSavedAnalysis(a)}>
                      <td className="px-6 py-4 text-sm font-medium text-gray-900 truncate" title={a.name}>{a.name}</td>
                      <td className="px-6 py-4 text-sm text-gray-700">{getProjectName(a)}</td>
                      <td className="px-6 py-4 text-sm text-gray-500">{a.savedDate || new Date(a.savedAt).toLocaleDateString()}</td>
                      <td className="px-6 py-4 text-sm text-gray-700">{getRespondentCount(a)}</td>
                      <td className="px-6 py-4 text-center">
                        <button
                          onClick={(e) => { e.stopPropagation(); deleteSavedAnalysis(a.id, a.name); }}
                          className="inline-flex items-center gap-1 text-xs text-gray-500 hover:text-red-600"
                          title="Delete analysis"
                        >
                          <TrashIcon className="w-4 h-4" /> Delete
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
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
            <div className="py-16 flex flex-col items-center justify-center gap-4">
              <div className="w-16 h-16 flex items-center justify-center mx-auto">
                <svg className="animate-spin" width="48" height="48" viewBox="0 0 48 48">
                  <circle cx="24" cy="24" r="20" fill="none" stroke="#D14A2D" strokeWidth="4" strokeDasharray="50 75.4" strokeDashoffset="0" />
                  <circle cx="24" cy="24" r="20" fill="none" stroke="#5D5F62" strokeWidth="4" strokeDasharray="50 75.4" strokeDashoffset="-62.7" />
                </svg>
              </div>
              <p className="text-gray-600">Generating content analysis...</p>
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
          <img src="/Circle.png" alt="Loading" className="w-5 h-5 animate-spin" />
          <span className="ml-2 text-sm text-gray-700">Loading analysis...</span>
        </div>
      )}

      {viewMode === 'viewer' && !loadingSavedView && currentAnalysis && (
        <div>
          <div className="mb-3">
            <div className="flex items-center justify-between mb-1">
              <div className="flex items-center gap-2">
                {editingTitle ? (
                  <input
                    value={editAnalysisName}
                    onChange={(e) => setEditAnalysisName(e.target.value)}
                    onBlur={async () => {
                      try {
                        const token = localStorage.getItem('jaice_token');
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
              {currentAnalysis.id?.startsWith('temp-') && (
                <button
                  onClick={() => {
                    setSaveFormData({
                      projectId: currentAnalysis.projectId || '',
                      name: currentAnalysis.name || '',
                      description: ''
                    });
                    setShowSaveModal(true);
                  }}
                  className="px-4 py-1.5 text-sm text-white rounded-lg hover:opacity-90 transition-colors"
                  style={{ backgroundColor: '#D14A2D' }}
                >
                  Save
                </button>
              )}
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
                          const token = localStorage.getItem('jaice_token');
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
            </div>
          </div>
          {/* Sheet tabs and table container */}
          {currentAnalysis.data && activeSheet && Array.isArray(currentAnalysis.data?.[activeSheet]) && (
            <div className="overflow-hidden">
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
              <div className="overflow-hidden shadow-lg">
                <div className="overflow-auto min-h-[200px] bg-white max-w-full border-l border-r border-b border-gray-300">
                  <table className="min-w-full text-[11px] leading-tight border-collapse">
                <thead style={{ backgroundColor: '#e5e7eb' }}>
                  <tr>
                    {dynamicHeaders.map((h, idx) => (
                      <React.Fragment key={h}>
                        <th className={`px-2 py-2 font-medium border-r border-gray-300 last:border-r-0 align-top ${h === 'Transcript' ? 'text-center' : 'text-left'}`} style={{ whiteSpace: (h === 'Respondent ID' || h === 'Transcript') ? 'nowrap' : 'normal', minWidth: h === 'Transcript' ? 'auto' : (h === 'Respondent ID' ? 'auto' : '120px'), lineHeight: '1.3', width: (h === 'Respondent ID' || h === 'Transcript') ? '1%' : 'auto' }}>
                          {activeSheet === 'Demographics' && h !== 'Respondent ID' && h !== 'respno' && h !== 'Transcript' ? (
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
                        {/* Column divider with + button (only for Demographics) */}
                        {activeSheet === 'Demographics' && (
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
                    .filter((row: any) => { if (activeSheet === 'Demographics') { const respondentId = row['Respondent ID'] ?? row['respno']; return respondentId !== undefined && String(respondentId).trim() !== ''; } return Object.values(row).some(v => String(v ?? '').trim() !== ''); })
                    .map((row: any, i: number) => {
                      // Check if this row has a respondent ID (real respondent vs template row)
                      const hasRespondentId = (row['Respondent ID'] && String(row['Respondent ID']).trim() && String(row['Respondent ID']).startsWith('R')) ||
                                             (row['respno'] && String(row['respno']).trim() && String(row['respno']).startsWith('R'));
                      // Check if any respondent exists in the sheet
                      const hasAnyRespondent = activeSheet === 'Demographics' ? currentAnalysis.data[activeSheet].some((r: any) => (r['Respondent ID'] && String(r['Respondent ID']).trim() !== '') || (r['respno'] && String(r['respno']).trim() !== '')) : true;
                      return (
                      <tr key={i} className={i % 2 === 0 ? 'bg-white' : 'bg-gray-50'}>
                        {dynamicHeaders.map((k, kidx) => {
                          const respondentId = row['Respondent ID'] || row['respno'];
                          const hasQuotes = currentAnalysis?.quotes?.[activeSheet]?.[respondentId]?.[k]?.length > 0;


                          return (
                            <React.Fragment key={k}>
                              <td
                                className={`px-2 py-1 text-gray-900 ${k === 'Transcript' ? 'align-middle text-center' : 'align-top'} border-r border-gray-300 last:border-r-0 border-b-0 ${activeSheet !== 'Demographics' && k !== 'Respondent ID' && k !== 'respno' ? 'cursor-pointer hover:bg-blue-50' : ''}`}
                                style={{ whiteSpace: k === 'Respondent ID' ? 'nowrap' : 'pre-wrap', width: k === 'Respondent ID' ? '1%' : 'auto' }}
                                onClick={(e) => {
                                  // Don't trigger click if clicking on an input field
                                  if ((e.target as HTMLElement).tagName === 'INPUT') return;
                                  handleCellClick(row, k);
                                }}
                              >
                                {k === 'Transcript' ? (
                                  // Show download button for transcript
                                  (() => {
                                    const respondentId = row['Respondent ID'] || row['respno'];
                                    const transcript = transcripts.find(t => t.respno === respondentId);
                                    return transcript ? (
                                      <button
                                        onClick={() => downloadTranscriptAsWord(transcript)}
                                        className="text-gray-600 hover:text-orange-600 transition-colors inline-flex items-center justify-center gap-1"
                                        title="Download cleaned transcript"
                                      >
                                        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                                        </svg>
                                      </button>
                                    ) : null;
                                  })()
                                ) : activeSheet === 'Demographics' && k !== 'Respondent ID' && k !== 'respno' ? (
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
                                ) : (
                                  String(row[k] ?? '')
                                )}
                              </td>
                              {/* Empty spacer cell for column divider (only for Demographics) */}
                              {activeSheet === 'Demographics' && (
                                <td className="p-0 border-r-0" style={{ width: '8px' }}></td>
                              )}
                            </React.Fragment>
                          );
                        })}
                        {activeSheet === 'Demographics' && hasAnyRespondent && (
                          <td className="px-2 py-1 text-center border-b-0">
                            {hasRespondentId && (
                              <button
                                onClick={() => handleDeleteRespondent(i)}
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
                  {/* Add Respondent Transcript row - only show for saved analyses on Demographics sheet */}
                  {activeSheet === 'Demographics' && !currentAnalysis.id?.startsWith('temp-') && currentAnalysis.projectId && (
                    <tr className="bg-gray-50 hover:bg-gray-100">
                      <td colSpan={999} className="px-2 py-2 text-center border-b-0">
                        <label className="inline-flex items-center gap-2 px-3 py-1.5 text-xs text-gray-600 hover:text-gray-900 transition-colors cursor-pointer">
                          {processingTranscript ? (
                            <>
                              <div className="w-3 h-3 flex items-center justify-center">
                                <svg className="animate-spin" width="12" height="12" viewBox="0 0 48 48">
                                  <circle cx="24" cy="24" r="20" fill="none" stroke="#D14A2D" strokeWidth="4" strokeDasharray="50 75.4" strokeDashoffset="0" />
                                  <circle cx="24" cy="24" r="20" fill="none" stroke="#5D5F62" strokeWidth="4" strokeDasharray="50 75.4" strokeDashoffset="-62.7" />
                                </svg>
                              </div>
                              Processing Transcript (this may take a couple of minutes, please keep this page open)...
                            </>
                          ) : (
                            <>
                              <CloudArrowUpIcon className="h-4 w-4" />
                              Add Respondent Transcript
                            </>
                          )}
                          <input type="file" accept=".txt,.docx" className="hidden" onChange={handleTranscriptUpload} disabled={processingTranscript} />
                        </label>
                      </td>
                    </tr>
                  )}
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
      {showSaveModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
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
        </div>
      )}

      {/* Success Message Toast */}
      {showSuccessMessage && (
        <div className="fixed top-4 right-4 bg-green-500 text-white px-6 py-3 rounded-lg shadow-lg z-50 flex items-center gap-2">
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
          </svg>
          <span className="font-medium">Transcript processed successfully!</span>
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
      {showQuotesModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50" onClick={() => setShowQuotesModal(false)}>
          <div className="bg-white rounded-lg p-6 w-full max-w-2xl max-h-[80vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
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

            <div className="space-y-3 overflow-y-auto flex-1">
              {selectedQuotes.length > 0 ? (
                selectedQuotes.map((quote, idx) => (
                  <div key={idx} className="bg-gray-50 rounded-lg p-4 border-l-4 border-blue-500 flex items-start justify-between gap-3">
                    <p className="text-sm text-gray-800 italic flex-1">"{quote}"</p>
                    <button
                      onClick={() => {
                        navigator.clipboard.writeText(quote);
                        setCopiedQuoteIndex(idx);
                        setTimeout(() => setCopiedQuoteIndex(null), 2000);
                      }}
                      className="text-gray-400 hover:text-gray-600 flex-shrink-0 relative"
                      title="Copy quote"
                    >
                      {copiedQuoteIndex === idx ? (
                        <svg className="w-5 h-5 text-green-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                        </svg>
                      ) : (
                        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                        </svg>
                      )}
                    </button>
                  </div>
                ))
              ) : (
                <p className="text-sm text-gray-500 text-center py-8">No quotes available for this cell.</p>
              )}
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
                        return value &&
                               !keyLower.includes('respondent') &&
                               !keyLower.includes('respno') &&
                               !keyLower.includes('date') &&
                               !keyLower.includes('time');
                      })
                      .map(([key, value]) => `${key}: ${value}`)
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
        </div>
      )}

      {/* End viewer */}
    </div>
  );
}








