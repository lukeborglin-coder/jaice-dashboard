import { API_BASE_URL } from '../config';
import React, { useEffect, useMemo, useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { CloudArrowUpIcon, TrashIcon, CalendarIcon, UserGroupIcon, UserIcon, BookOpenIcon, BeakerIcon, LightBulbIcon, ChartBarIcon, TrophyIcon, ChatBubbleLeftRightIcon } from '@heroicons/react/24/outline';

interface ContentAnalysisXProps {
  projects?: any[];
  onNavigate?: (route: string) => void;
}

export default function ContentAnalysisX({ projects = [] }: ContentAnalysisXProps) {
  const { user } = useAuth();
  const [showMyProjectsOnly, setShowMyProjectsOnly] = useState(true);
  const [savedAnalyses, setSavedAnalyses] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [viewMode, setViewMode] = useState<'home' | 'viewer'>('home');
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
  const handleRenameColumn = (oldName: string, newName: string) => {
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
  };

  // Handler for adding a new demographic column at a specific position
  const handleAddDemographicColumn = (afterColumnIndex: number) => {
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
  };

  // Handler for updating demographic data
  const handleDemographicChange = (respondentId: string, columnKey: string, value: string) => {
    if (!currentAnalysis || activeSheet !== 'Demographics') return;

    const updatedData = { ...currentAnalysis.data };

    // Find the actual row index in the Demographics data by respondent ID
    const actualRowIndex = updatedData.Demographics.findIndex((row: any) => {
      const rowRespondentId = row['Respondent ID'] || row['respno'];
      return rowRespondentId === respondentId;
    });

    if (actualRowIndex !== -1) {
      updatedData.Demographics[actualRowIndex][columnKey] = value;

      setCurrentAnalysis({
        ...currentAnalysis,
        data: updatedData
      });
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
    if (name.includes('demographic')) return UserIcon;
    if (name.includes('introduction')) return ChatBubbleLeftRightIcon;
    if (name.includes('background')) return BookOpenIcon;
    if (name.includes('awareness') || name.includes('perception')) return LightBulbIcon;
    if (name.includes('profile') || name.includes('review')) return BeakerIcon;
    if (name.includes('comparison') || name.includes('competitive')) return ChartBarIcon;
    if (name.includes('conclude') || name.includes('thank')) return TrophyIcon;
    return BookOpenIcon; // Default icon
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

    // Listen for custom event to load a specific content analysis
    const handleLoadAnalysis = (event: any) => {
      const { analysisId } = event.detail;
      const analysis = savedAnalyses.find(a => a.id === analysisId);
      if (analysis) {
        loadSavedAnalysis(analysis);
      }
    };

    window.addEventListener('loadContentAnalysis', handleLoadAnalysis);
    return () => window.removeEventListener('loadContentAnalysis', handleLoadAnalysis);
  }, []); // Remove savedAnalyses dependency to prevent infinite loop

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

  const loadSavedAnalysis = (analysis: any) => {
    setViewMode('viewer');
    setLoadingSavedView(true);
    setTimeout(() => {
      setCurrentAnalysis(analysis);
      const sheets = Object.keys(analysis?.data || {});
      if (sheets.length) setActiveSheet(sheets[0]);
      setLoadingSavedView(false);
    }, 1500);
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
        // Reload the saved analyses list
        await fetchSavedAnalyses();
        // Go back to home
        setViewMode('home');
        setCurrentAnalysis(null);
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

        // Update the current analysis with the new respondent data and quotes
        const updatedAnalysis = {
          ...currentAnalysis,
          data: result.data,
          quotes: result.quotes || currentAnalysis.quotes || {}
        };
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
                quotes: result.quotes || currentAnalysis.quotes || {}
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
    }
    setProcessingTranscript(false);

    // Reset file input
    e.target.value = '';
  };

  return (
    <div className="flex-1 p-6 space-y-6 max-w-full overflow-hidden">
      <div className="space-y-5">
        {/* Header */}
        <section className="flex items-center justify-between">
          <h2 className="text-2xl font-bold" style={{ color: '#5D5F62' }}>Content Analysis</h2>
          <div className="flex items-center gap-2">
            <span className="text-sm text-gray-600">Current View:</span>
            <button
              onClick={() => viewMode === 'home' && !uploading && setShowMyProjectsOnly(!showMyProjectsOnly)}
              disabled={viewMode !== 'home' || uploading}
              className={`px-3 py-1 text-xs rounded-lg shadow-sm transition-colors ${
                viewMode !== 'home' || uploading
                  ? 'bg-gray-200 text-gray-400 cursor-not-allowed'
                  : showMyProjectsOnly
                  ? 'text-white hover:opacity-90'
                  : 'bg-white border border-gray-300 hover:bg-gray-50'
              }`}
              style={viewMode === 'home' && !uploading && showMyProjectsOnly ? { backgroundColor: '#D14A2D' } : {}}
            >
              {showMyProjectsOnly ? 'Only My Projects' : 'All Cognitive Projects'}
            </button>
          </div>
        </section>

        {/* Title bar with Generate button */}
        <div className="border-b border-gray-200">
          <div className="flex items-center pb-3">
            <p className="text-sm text-gray-600">View and manage your saved content analyses</p>
            <label className={`flex items-center gap-1 rounded-lg px-3 py-1 text-xs shadow-sm transition-colors ml-4 ${viewMode === 'home' && !uploading ? 'text-white hover:opacity-90 cursor-pointer' : 'bg-gray-200 text-gray-400 cursor-not-allowed'}`} style={viewMode === 'home' && !uploading ? { backgroundColor: '#D14A2D' } : {}}>
              <CloudArrowUpIcon className="h-4 w-4" />
              {uploading ? 'Generating...' : 'Generate New'}
              {viewMode === 'home' && !uploading && <input type="file" accept=".docx" className="hidden" onChange={handleFileUpload} disabled={uploading} />}
            </label>
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
              <div className="text-lg font-semibold text-gray-900">{currentAnalysis.name}</div>
              <button className="text-xs text-gray-600 hover:text-gray-900" onClick={() => { setViewMode('home'); setCurrentAnalysis(null); }}>Back to list</button>
            </div>
            <div className="flex items-center justify-between">
              <div>
                <div className="text-xs text-gray-500">{getProjectName(currentAnalysis)} • Saved {currentAnalysis.savedDate || new Date(currentAnalysis.savedAt).toLocaleDateString()}</div>
                <div className="text-xs text-gray-500 mt-0.5">Current Tab/Section: <span className="font-medium capitalize">{activeSheet.toLowerCase()}</span></div>
              </div>
              <div className="flex items-center gap-2">
                {!currentAnalysis.projectId && (
                  <button
                    className="px-3 py-1 text-xs rounded-lg shadow-sm transition-colors text-white hover:opacity-90"
                    style={{ backgroundColor: '#D14A2D' }}
                    onClick={() => {
                      setSaveFormData({ projectId: '', name: '', description: '' });
                      setShowSaveModal(true);
                    }}
                  >
                    Save to Project
                  </button>
                )}
              </div>
            </div>
          </div>
          {/* Sheet tabs and table container */}
          {currentAnalysis.data && activeSheet && Array.isArray(currentAnalysis.data?.[activeSheet]) && (
            <div className="shadow-lg rounded-t-lg overflow-hidden">
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
              <div className="overflow-auto rounded-b-2xl min-h-[200px] bg-white max-w-full border-t-0">
              <table className="min-w-full text-[11px] leading-tight border-collapse">
                <thead style={{ backgroundColor: '#e5e7eb' }}>
                  <tr>
                    {Object.keys((currentAnalysis.data[activeSheet][0] || {})).map((h, idx) => (
                      <React.Fragment key={h}>
                        <th className="px-2 py-2 text-left font-medium border-r border-gray-300 last:border-r-0 align-top" style={{ whiteSpace: h === 'Respondent ID' ? 'nowrap' : 'normal', minWidth: h === 'Respondent ID' ? 'auto' : '120px', lineHeight: '1.3', width: h === 'Respondent ID' ? '1%' : 'auto' }}>
                          {activeSheet === 'Demographics' && h !== 'Respondent ID' && h !== 'respno' ? (
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
                        {/* Column divider with + button (only for Demographics, skip Respondent ID) */}
                        {activeSheet === 'Demographics' && h !== 'Respondent ID' && h !== 'respno' && (
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
                      // Only show rows with a respondent ID starting with 'R'
                      const respondentId = row['Respondent ID'] || row['respno'];
                      if (respondentId && String(respondentId).trim().startsWith('R')) return true;

                      // Filter out template rows (rows with empty values but defined keys)
                      return false;
                    })
                    .map((row: any, i: number) => {
                      // Check if this row has a respondent ID (real respondent vs template row)
                      const hasRespondentId = (row['Respondent ID'] && String(row['Respondent ID']).trim() && String(row['Respondent ID']).startsWith('R')) ||
                                             (row['respno'] && String(row['respno']).trim() && String(row['respno']).startsWith('R'));
                      // Check if any respondent exists in the sheet
                      const hasAnyRespondent = currentAnalysis.data[activeSheet].some((r: any) =>
                        (r['Respondent ID'] && String(r['Respondent ID']).trim().startsWith('R')) ||
                        (r['respno'] && String(r['respno']).trim().startsWith('R'))
                      );
                      return (
                      <tr key={i} className={i % 2 === 0 ? 'bg-white' : 'bg-gray-50'}>
                        {Object.keys(row).map((k, kidx) => {
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
                                {activeSheet === 'Demographics' && k !== 'Respondent ID' && k !== 'respno' ? (
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
                              {/* Empty spacer cell for column divider (only for Demographics, skip Respondent ID) */}
                              {activeSheet === 'Demographics' && k !== 'Respondent ID' && k !== 'respno' && (
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
                </tbody>
              </table>
              </div>

              {/* Footer with Add Respondent Transcript button */}
              {activeSheet === 'Demographics' && (
                <div className="mt-3 pb-2 flex justify-center">
                  {currentAnalysis.projectId ? (
                    <label className="inline-flex items-center gap-2 px-3 py-1.5 text-xs text-white rounded hover:opacity-90 transition-colors cursor-pointer" style={{ backgroundColor: '#D14A2D', opacity: processingTranscript ? 0.7 : 1 }}>
                      {processingTranscript ? (
                        <>
                          <img src="/Circle.png" alt="Loading" className="w-3 h-3 animate-spin" style={{ filter: 'brightness(0) invert(1)' }} />
                          Processing Transcript...
                        </>
                      ) : (
                        <>
                          <CloudArrowUpIcon className="h-3 w-3" />
                          Add Respondent Transcript
                        </>
                      )}
                      <input type="file" accept=".txt,.docx" className="hidden" onChange={handleTranscriptUpload} disabled={processingTranscript} />
                    </label>
                  ) : (
                    <div className="text-xs text-gray-500">
                      Save this analysis to a project before adding transcripts
                    </div>
                  )}
                </div>
              )}
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
                      .join(' • ');

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



