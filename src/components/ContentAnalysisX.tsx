import { API_BASE_URL } from '../config';
import React, { useEffect, useMemo, useState, useRef } from 'react';
import { createPortal } from 'react-dom';
import { useAuth } from '../contexts/AuthContext';
import { CloudArrowUpIcon, TrashIcon, CalendarIcon, UserGroupIcon, UserIcon, BookOpenIcon, BeakerIcon, LightBulbIcon, ChartBarIcon, TrophyIcon, ChatBubbleLeftRightIcon, ExclamationTriangleIcon, ExclamationCircleIcon, ArrowTrendingUpIcon, UsersIcon, DocumentMagnifyingGlassIcon, CheckCircleIcon, EllipsisHorizontalCircleIcon, DocumentTextIcon, ArrowDownTrayIcon } from '@heroicons/react/24/outline';
import { IconDeviceFloppy, IconFileArrowRight } from '@tabler/icons-react';
import { Document, Packer, Paragraph, TextRun, HeadingLevel, AlignmentType } from 'docx';
import ExcelJS from 'exceljs';
import { renderAsync } from 'docx-preview';

interface ContentAnalysisXProps {
  projects?: any[];
  onNavigate?: (route: string) => void;
  onNavigateToProject?: (project: any) => void;
  onProjectsChange?: () => void;
  analysisToLoad?: string | null;
  onAnalysisLoaded?: () => void;
}

export default function ContentAnalysisX({ projects = [], onNavigate, onNavigateToProject, onProjectsChange, analysisToLoad, onAnalysisLoaded }: ContentAnalysisXProps) {
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
  const [highlightedRespondentId, setHighlightedRespondentId] = useState<string | null>(null);
  const [showSuccessMessage, setShowSuccessMessage] = useState(false);
  const [showSaveSuccessMessage, setShowSaveSuccessMessage] = useState(false);
  const [copiedQuoteIndex, setCopiedQuoteIndex] = useState<number | null>(null);
  const [showQuotesModal, setShowQuotesModal] = useState(false);
  const [selectedQuotes, setSelectedQuotes] = useState<string[]>([]);
  const [selectedCellInfo, setSelectedCellInfo] = useState({ column: '', respondent: '', summary: '', sheet: '' });
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
  // Discussion guide modal state
  const [showDiscussionGuideModal, setShowDiscussionGuideModal] = useState(false);
  const docxContainerRef = useRef<HTMLDivElement>(null);
  // Transcript upload modal state
  const [showTranscriptUploadModal, setShowTranscriptUploadModal] = useState(false);
  const [transcriptFile, setTranscriptFile] = useState<File | null>(null);
  const [cleanTranscript, setCleanTranscript] = useState(true);
  const [checkForAEs, setCheckForAEs] = useState(false);
  const [aeReport, setAeReport] = useState<string | null>(null);
  const [hasAETraining, setHasAETraining] = useState<boolean | null>(null);
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

  // Check AE training when modal opens or analysis changes
  useEffect(() => {
    if (showTranscriptUploadModal && currentAnalysis?.projectId) {
      // Get client ID from the project data
      const clientId = currentAnalysis.clientId || currentAnalysis.client?.toLowerCase().replace(/\s+/g, '-');
      if (clientId) {
        checkAETraining(clientId).then(setHasAETraining);
      } else {
        setHasAETraining(false);
      }
    }
  }, [showTranscriptUploadModal, currentAnalysis?.projectId, currentAnalysis?.clientId, currentAnalysis?.client]);

  // Uncheck AE checkbox if training is not available
  useEffect(() => {
    if (hasAETraining === false) {
      setCheckForAEs(false);
    }
  }, [hasAETraining]);

  // Check if client has AE training data
  const checkAETraining = async (clientId: string) => {
    try {
      const response = await fetch(`${API_BASE_URL}/api/ae-training/${clientId}`, {
        headers: { 'Authorization': `Bearer ${localStorage.getItem('jaice_token')}` }
      });
      return response.ok;
    } catch (error) {
      console.error('Error checking AE training:', error);
      return false;
    }
  };

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

    // Add AE Report column if AE report is available
    if (aeReport) {
      headers.push('AE Report');
    }

    return headers;
  }, [currentAnalysis?.data, activeSheet, transcripts.length, aeReport]);

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

      // Get all column headers
      const headers = new Set<string>();
      sheetData.forEach((row: any) => {
        Object.keys(row).forEach(key => headers.add(key));
      });
      const headerArray = Array.from(headers);

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
  // Reusable function to reorder respondents by date
  const reorderRespondentsByDate = (data: any, quotes: any, context: any, transcripts: any) => {
    if (!data.Demographics || !Array.isArray(data.Demographics)) {
      return { data, quotes, context, transcripts };
    }

    // Sort by interview date ascending (earliest first)
    const sortedDemographics = [...data.Demographics].sort((a: any, b: any) => {
        const dateA = a['Interview Date'] || a['Date'] || '';
        const dateB = b['Interview Date'] || b['Date'] || '';

        if (dateA && dateB) {
          const parsedA = new Date(dateA);
          const parsedB = new Date(dateB);
          if (!isNaN(parsedA.getTime()) && !isNaN(parsedB.getTime())) {
          return parsedA.getTime() - parsedB.getTime();
          }
        }
        return 0;
      });

      // Create mapping from old IDs to new IDs
      const idMapping: Record<string, string> = {};
      sortedDemographics.forEach((row: any, index: number) => {
        const oldId = row['Respondent ID'] || row['respno'];
        if (oldId && String(oldId).startsWith('R')) {
          const newId = `R${String(index + 1).padStart(3, '0')}`;
          idMapping[oldId] = newId;
          row['Respondent ID'] = newId;
          if (row['respno']) row['respno'] = newId;
        }
      });

      // Update respondent IDs in all other sheets
    const updatedData = { ...data };
      Object.keys(updatedData).forEach(sheetName => {
        if (sheetName !== 'Demographics' && Array.isArray(updatedData[sheetName])) {
          updatedData[sheetName].forEach((row: any) => {
            const oldId = row['Respondent ID'] || row['respno'];
            if (oldId && idMapping[oldId]) {
              row['Respondent ID'] = idMapping[oldId];
              if (row['respno']) row['respno'] = idMapping[oldId];
            }
          });
        }
      });

    // Update the data with sorted demographics
    updatedData.Demographics = sortedDemographics;

      // Rebuild quotes with new IDs
      const updatedQuotes: any = {};
    Object.keys(quotes || {}).forEach(sheetName => {
        updatedQuotes[sheetName] = {};
      const sheetQuotes = quotes[sheetName] || {};
        Object.keys(sheetQuotes).forEach(oldId => {
            const newId = idMapping[oldId] || oldId;
            updatedQuotes[sheetName][newId] = sheetQuotes[oldId];
        });
      });

      // Rebuild context with new IDs
      const updatedContext: any = {};
    Object.keys(context || {}).forEach(sheetName => {
        updatedContext[sheetName] = {};
      const sheetContext = context[sheetName] || {};
        Object.keys(sheetContext).forEach(oldId => {
            const newId = idMapping[oldId] || oldId;
            updatedContext[sheetName][newId] = sheetContext[oldId];
        });
      });

      // Update transcripts with new IDs
    const updatedTranscripts = transcripts.map(t => {
          if (idMapping[t.respno]) {
            return { ...t, respno: idMapping[t.respno] };
          }
          return t;
        });

    return { data: updatedData, quotes: updatedQuotes, context: updatedContext, transcripts: updatedTranscripts };
  };

  const handleReorderByDate = async () => {
    if (!currentAnalysis) return;

    const { data, quotes, context, transcripts: updatedTranscripts } = reorderRespondentsByDate(
      currentAnalysis.data,
      currentAnalysis.quotes,
      currentAnalysis.context,
      transcripts
    );

    // Update the analysis
      setCurrentAnalysis({
        ...currentAnalysis,
      data,
      quotes,
      context
    });

    // Update transcripts
    setTranscripts(updatedTranscripts);

    // Save to localStorage
    const updatedAnalyses = savedAnalyses.map(a => 
      a.id === currentAnalysis.id 
        ? { ...currentAnalysis, data, quotes, context }
        : a
    );
    setSavedAnalyses(updatedAnalyses);
    localStorage.setItem('contentAnalyses', JSON.stringify(updatedAnalyses));
  };

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

    // Reorder remaining respondents by date
    const { data: reorderedData, quotes: reorderedQuotes, context: reorderedContext, transcripts: reorderedTranscripts } = reorderRespondentsByDate(
      updatedData,
      filteredQuotes,
      filteredContext,
      filteredTranscripts
    );

    // Update the analysis
    setCurrentAnalysis({
      ...currentAnalysis,
      data: reorderedData,
      quotes: reorderedQuotes,
      context: reorderedContext
    });

    // Update transcripts
    setTranscripts(reorderedTranscripts);

    // Save to localStorage
    const updatedAnalyses = savedAnalyses.map(a => 
      a.id === currentAnalysis.id 
        ? { ...currentAnalysis, data: reorderedData, quotes: reorderedQuotes, context: reorderedContext }
        : a
    );
    setSavedAnalyses(updatedAnalyses);
    localStorage.setItem('contentAnalyses', JSON.stringify(updatedAnalyses));

    // Auto-save if this is a saved analysis
    if (currentAnalysis.projectId) {
      try {
        await fetch(`${API_BASE_URL}/api/caX/update`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${localStorage.getItem('jaice_token')}` },
          body: JSON.stringify({
            id: currentAnalysis.id,
            data: reorderedData,
            quotes: reorderedQuotes,
            context: reorderedContext
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
            headers: { 'Authorization': `Bearer ${localStorage.getItem('jaice_token')}` }
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
        headers: { 'Authorization': `Bearer ${localStorage.getItem('jaice_token')}` }
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
        headers: { 'Authorization': `Bearer ${localStorage.getItem('jaice_token')}` }
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
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${localStorage.getItem('jaice_token')}` },
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

      // Create an AbortController with a long timeout for transcript processing
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 30 * 60 * 1000); // 30 minutes

      const response = await fetch(`${API_BASE_URL}/api/caX/process-transcript`, {
        method: 'POST',
        body: formData,
        headers: { 'Authorization': `Bearer ${localStorage.getItem('jaice_token')}` },
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

      const mergedContext = { ...currentAnalysis.context };
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
      console.log('🔍 cleanTranscript setting:', cleanTranscript);
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
          newTranscripts.push({
            id: Date.now().toString(),
            respno: result.respno,
            demographics,
            cleanedTranscript: result.cleanedTranscript || '',
            originalTranscript: result.originalTranscript || '',
            uploadedAt: new Date().toISOString()
          });
          setTranscripts(newTranscripts);
          console.log('🔍 Added transcript for respondent:', result.respno);
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
      }

      setCurrentAnalysis(updatedAnalysis);

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


      setShowSuccessMessage(true);
      setTimeout(() => setShowSuccessMessage(false), 3000);
    } catch (error) {
      console.error('Transcript processing error:', error);
      const errorMessage = error instanceof Error ? error.message : 'Transcript processing failed - please try again.';
      alert(errorMessage);
    } finally {
      setProcessingTranscript(false);
      if (e.target) {
        e.target.value = '';
      }
    }
  };

  const downloadTranscriptAsWord = async (transcript: any) => {
    try {
      // Determine which transcript to use - original if cleaning was disabled, cleaned if it was enabled
      const transcriptToUse = transcript.originalTranscript && transcript.originalTranscript !== transcript.cleanedTranscript 
        ? transcript.originalTranscript 
        : transcript.cleanedTranscript;
      
      // Parse the transcript to extract dialogue
      const lines = transcriptToUse.split('\n').filter((line: string) => line.trim());

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
          <div className="flex items-center justify-between pb-3">
            {viewMode === 'viewer' ? (
              <>
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
                              headers: { 'Authorization': `Bearer ${localStorage.getItem('jaice_token')}` }
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
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 text-white text-xs font-medium rounded-md hover:opacity-90 transition-colors cursor-pointer shadow-sm"
                      style={{ backgroundColor: '#2563eb' }}
                    >
                      <BookOpenIcon className="h-4 w-4" />
                      <span>View Discussion Guide</span>
                    </button>
                  )}
                  {/* Export to Excel button - always visible */}
                  <button
                    onClick={handleExportToExcel}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 text-white text-xs font-medium rounded-md hover:opacity-90 transition-colors cursor-pointer shadow-sm"
                    style={{ backgroundColor: '#16a34a' }}
                  >
                    <IconFileArrowRight className="h-4 w-4" />
                    <span>Export as Excel</span>
                  </button>
                </div>
              </>
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
              <div className="flex gap-2">
                {/* Show only save icon when generating analysis OR when analysis is complete but unsaved */}
                {(generatingAnalysis || currentAnalysis.id?.startsWith('temp-')) ? (
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
                    {/* Reorder by Date button - only show if there are multiple respondents */}
                    {currentAnalysis.data?.Demographics && Array.isArray(currentAnalysis.data.Demographics) && currentAnalysis.data.Demographics.length > 1 && (
                  <button
                        onClick={handleReorderByDate}
                        className="p-2 text-gray-600 hover:text-purple-600 hover:bg-purple-50 rounded-lg transition-colors"
                        title="Reorder respondents by interview date (earliest first)"
                      >
                        <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 10h16M4 14h16M4 18h16" />
                        </svg>
                  </button>
                    )}
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
              
              
              {/* Add Respondent Transcript button - only show for saved analyses on Demographics sheet */}
              {activeSheet === 'Demographics' && !currentAnalysis.id?.startsWith('temp-') && currentAnalysis.projectId && (
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
                    .filter((row: any) => {
                      if (activeSheet === 'Demographics') {
                        const respondentId = row['Respondent ID'] ?? row['respno'];
                        return respondentId !== undefined && String(respondentId).trim() !== '';
                      }
                      return Object.values(row).some(v => String(v ?? '').trim() !== '');
                    })
                    .sort((a: any, b: any) => {
                      // Sort by Interview Date ascending (earliest first) to match reorder function
                      const dateA = a['Interview Date'] || a['Date'] || '';
                      const dateB = b['Interview Date'] || b['Date'] || '';

                      if (dateA && dateB) {
                        const parsedA = new Date(dateA);
                        const parsedB = new Date(dateB);
                        if (!isNaN(parsedA.getTime()) && !isNaN(parsedB.getTime())) {
                          return parsedA.getTime() - parsedB.getTime();
                        }
                      }

                      // Fallback to sorting by respondent ID ascending
                      const getIdValue = (row: any) => {
                        const raw = row['Respondent ID'] ?? row['respno'];
                        if (!raw) return Infinity;
                        const match = String(raw).match(/\d+/);
                        return match ? parseInt(match[0], 10) : Infinity;
                      };
                      return getIdValue(a) - getIdValue(b);
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
                            return rid !== undefined && String(rid).trim() !== '';
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
                                        title={transcript.originalTranscript && transcript.originalTranscript !== transcript.cleanedTranscript 
                                          ? "Download original transcript" 
                                          : "Download cleaned transcript"}
                                      >
                                        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                                        </svg>
                                      </button>
                                    ) : null;
                                  })()
                                ) : k === 'AE Report' ? (
                                  // Show download button for AE Report
                                  aeReport ? (
                                    <button
                                      onClick={() => {
                                        // Create and download AE Report as Word document
                                        const blob = new Blob([aeReport], { type: 'text/plain' });
                                        const url = URL.createObjectURL(blob);
                                        const a = document.createElement('a');
                                        a.href = url;
                                        a.download = `AE_Report_${new Date().toISOString().split('T')[0]}.txt`;
                                        document.body.appendChild(a);
                                        a.click();
                                        document.body.removeChild(a);
                                        URL.revokeObjectURL(url);
                                      }}
                                      className="text-gray-600 hover:text-red-600 transition-colors inline-flex items-center justify-center gap-1"
                                      title="Download AE Report"
                                    >
                                      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                                      </svg>
                                    </button>
                                  ) : null
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
              {/* Summary Finding Section */}
              {selectedCellInfo.summary && (() => {
                // Create comprehensive key finding by combining cell value with supporting context
                const cellValue = (selectedCellInfo?.value || '').toString();
                const sheetContext = currentAnalysis.context?.[selectedCellInfo.sheet]?.[selectedCellInfo.respondent]?.[selectedCellInfo.column];
                
                let comprehensiveKeyFinding = cellValue;
                if (sheetContext && Array.isArray(sheetContext) && sheetContext.length > 0) {
                  // Extract all respondent quotes from context for comprehensive key finding
                  const allRespondentQuotes = [];
                  sheetContext.forEach((contextString) => {
                    const normalizedContext = contextString.replace(/\\n/g, '\n');
                    const lines = normalizedContext.split('\n');
                    lines.forEach(line => {
                      if (line.startsWith('Respondent:')) {
                        const text = line.replace('Respondent:', '').trim();
                        if (text.length > 0) {
                          allRespondentQuotes.push(text);
                        }
                      }
                    });
                  });
                  
                  if (allRespondentQuotes.length > 0) {
                    // Add additional context from the most relevant quotes
                    const relevantQuotes = allRespondentQuotes.slice(0, 3); // Get first 3 quotes for additional context
                    const additionalContext = relevantQuotes.join(' ').substring(0, 500); // Limit to 500 chars to avoid overwhelming
                    if (additionalContext && additionalContext !== cellValue) {
                      comprehensiveKeyFinding = `${cellValue}\n\nAdditional Context: ${additionalContext}`;
                    }
                  }
                }
                
                return (
                  <div className="bg-orange-50 border border-orange-200 rounded-lg p-4">
                    <h3 className="text-sm font-semibold text-orange-900 mb-2">Key Finding</h3>
                    <p className="text-sm text-gray-800 whitespace-pre-line">{comprehensiveKeyFinding}</p>
                  </div>
                );
              })()}

              {/* Context Section - Always show if available */}
              <div>
                <h3 className="text-sm font-semibold text-gray-700 mb-3">Supporting Context</h3>
                <div className="space-y-3">
                  {(() => {
                    // Debug logging
                    console.log('Debug context access:', {
                      sheet: selectedCellInfo.sheet,
                      respondent: selectedCellInfo.respondent,
                      column: selectedCellInfo.column,
                      currentAnalysis: currentAnalysis,
                      context: currentAnalysis?.context,
                      sheetContext: currentAnalysis?.context?.[selectedCellInfo.sheet],
                      respondentContext: currentAnalysis?.context?.[selectedCellInfo.sheet]?.[selectedCellInfo.respondent],
                      columnContext: currentAnalysis?.context?.[selectedCellInfo.sheet]?.[selectedCellInfo.respondent]?.[selectedCellInfo.column]
                    });
                    
                const sheetContext = currentAnalysis.context?.[selectedCellInfo.sheet]?.[selectedCellInfo.respondent]?.[selectedCellInfo.column];
                if (!sheetContext || !Array.isArray(sheetContext) || sheetContext.length === 0) {
                      return <p className="text-sm text-gray-500 text-center py-8">No supporting context available for this cell.</p>;
                    }
                    
                    const normalize = (s) => s.toLowerCase().replace(/[^a-z0-9\s]/gi, ' ').replace(/\s+/g, ' ').trim();
                    const cellValue = (selectedCellInfo?.value || '').toString();
                    const keyTokens = new Set(normalize(cellValue).split(' ').filter(w => w.length > 3));

                    const sentenceSplit = (text) => {
                      // Split by sentence enders while keeping reasonable chunks
                      const raw = text
                        .replace(/\u201c|\u201d|\u2019/g, '"')
                        .replace(/\s+/g, ' ')
                        .trim();
                      const parts = raw.split(/(?<=[\.!\?])\s+/);
                      // Further split overly long sentences into mid-length subspans
                      const out = [];
                      parts.forEach(p => {
                        if (p.length <= 260) {
                          out.push(p.trim());
                        } else {
                          // windowed chunks ~140-220 chars
                          let start = 0;
                          const step = 180;
                          while (start < p.length) {
                            const slice = p.slice(start, Math.min(start + step, p.length)).trim();
                            if (slice.length > 0) out.push(slice);
                            start += step;
                          }
                        }
                      });
                      return out.filter(Boolean);
                    };

                    const scoreSentence = (s) => {
                      const tokens = normalize(s).split(' ').filter(Boolean);
                      if (tokens.length === 0) return 0;
                      let overlap = 0;
                      tokens.forEach(t => { if (t.length > 3 && keyTokens.has(t)) overlap += 1; });
                      // Favor medium length and presence of indicative phrases
                      const lengthPenalty = Math.abs(s.length - 160) / 160; // closer to 160 chars is better
                      const phraseBoost = /(i feel|i think|i belong|facebook|group|community|because|so|that|which)/i.test(s) ? 0.25 : 0;
                      return overlap + phraseBoost - lengthPenalty * 0.35;
                    };

                    const candidates = [];
                    sheetContext.forEach((contextString) => {
                        const normalizedContext = contextString.replace(/\\n/g, '\n');
                      const lines = normalizedContext.split('\n');
                      lines.forEach(line => {
                        if (line.startsWith('Respondent:')) {
                          const text = line.replace('Respondent:', '').trim();
                          if (text.length > 0) {
                            sentenceSplit(text).forEach(snippet => {
                              if (snippet.length >= 40) {
                                candidates.push(snippet.trim());
                              }
                            });
                          }
                        }
                      });
                    });

                    // Deduplicate similar snippets
                    const deduped = [];
                    const seen = new Set();
                    candidates.forEach(sn => {
                      const key = normalize(sn).slice(0, 120); // coarse key
                      if (!seen.has(key)) { seen.add(key); deduped.push(sn); }
                    });

                    // Rank by relevance and select more comprehensive set
                    const ranked = deduped
                      .map(sn => ({ sn, score: scoreSentence(sn) }))
                      .sort((a, b) => b.score - a.score)
                      .map(x => x.sn);

                    // Show more quotes (up to 8 instead of 3) and don't truncate them as heavily
                    const topN = ranked.slice(0, Math.min(8, ranked.length));

                    // Less aggressive truncation - only trim if extremely long
                    const tidy = (s) => {
                      const maxLen = 800; // Increased from 240 to 800
                      if (s.length <= maxLen) return s;
                      const start = s.slice(0, 600).trimEnd();
                      const end = s.slice(-150).trimStart();
                      return `${start}... ${end}`;
                    };

                    const allQuotes = topN.length > 0 ? topN.map(tidy) : [];

                    // Parse the context to format speaker labels and add line breaks
                    const formatContext = (text) => {
                      return text.split('\n').map((line, lineIdx) => {
                        if (line.startsWith('Moderator:')) {
                                  return (
                            <div key={lineIdx} className="mb-2">
                              <span className="font-bold text-gray-900">Moderator:</span>
                              <span className="ml-2 text-gray-800">{line.replace('Moderator:', '').trim()}</span>
                            </div>
                          );
                        } else if (line.startsWith('Respondent:')) {
                          return (
                            <div key={lineIdx} className="mb-3">
                              <span className="font-bold text-blue-700">Respondent:</span>
                              <span className="ml-2 text-gray-800">{line.replace('Respondent:', '').trim()}</span>
                            </div>
                          );
                        } else if (line.trim()) {
                          return (
                            <div key={lineIdx} className="ml-4 text-gray-600 text-sm">
                              {line.trim()}
                            </div>
                          );
                        }
                        return null;
                      });
                    };

                    return (
                      <>
                        {/* Comprehensive Context Boxes - Show more context */}
                        {sheetContext.map((contextString, idx) => {
                          const normalizedContext = contextString.replace(/\\n/g, '\n');
                          return (
                            <div key={idx} className="bg-gray-50 rounded-lg p-4 border-l-4 border-blue-500 mb-4">
                              <div className="text-sm leading-relaxed">
                                {formatContext(normalizedContext)}
                            </div>
                          </div>
                        );
                      })}
                        
                       {/* Comprehensive Supporting Quotes Section */}
                       {allQuotes.length > 0 && (
                         <div className="mt-6">
                           <h3 className="text-sm font-semibold text-gray-700 mb-3">Key Supporting Quotes</h3>
                           <div className="space-y-4">
                             {allQuotes.map((quote, quoteIdx) => (
                               <div key={quoteIdx} className="bg-gray-50 rounded-lg p-4 border-l-4 border-blue-500 flex items-start justify-between gap-3">
                                 <p className="text-sm text-gray-800 italic flex-1 leading-relaxed">"{quote}"</p>
                                 <button
                                   onClick={() => {
                                     navigator.clipboard.writeText(`"${quote}"`);
                                     setCopiedQuoteIndex(quoteIdx);
                                     setTimeout(() => setCopiedQuoteIndex(null), 1500);
                                   }}
                                   className="text-gray-400 hover:text-gray-600 flex-shrink-0 transition-colors"
                                   title="Copy quote"
                                 >
                                   {copiedQuoteIndex === quoteIdx ? (
                                     <svg className="w-4 h-4 text-green-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                       <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                                     </svg>
                                   ) : (
                                     <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                       <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                                     </svg>
                                   )}
                                 </button>
                    </div>
                             ))}
                  </div>
                         </div>
                       )}
                      </>
                );
              })()}
                </div>
              </div>

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
          onClick={() => setShowTranscriptUploadModal(false)}
        >
          <div className="bg-white rounded-lg w-full max-w-2xl max-h-[85vh] flex flex-col overflow-hidden" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between p-4 border-b border-gray-200">
              <h3 className="text-lg font-semibold text-gray-900">Upload Transcript</h3>
              <button
                onClick={() => setShowTranscriptUploadModal(false)}
                className="text-gray-400 hover:text-gray-600 transition-colors"
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
                {/* File Upload Area */}
                <div className="border-2 border-dashed border-gray-300 rounded-lg p-8 text-center">
                  <CloudArrowUpIcon className="mx-auto h-12 w-12 text-gray-400" />
                  <div className="mt-4">
                    <label htmlFor="transcript-file" className="cursor-pointer">
                      <span className="mt-2 block text-sm font-medium text-gray-900">
                        {transcriptFile ? transcriptFile.name : 'Click to upload or drag and drop'}
                      </span>
                      <span className="mt-1 block text-sm text-gray-500">
                        TXT or DOCX files up to 10MB
                      </span>
                    </label>
                    <input
                      id="transcript-file"
                      type="file"
                      accept=".txt,.docx"
                      className="hidden"
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        if (file) {
                          setTranscriptFile(file);
                        }
                      }}
                    />
                  </div>
                </div>

                {/* Processing Options */}
                <div className="space-y-4">
                  <h4 className="text-sm font-medium text-gray-900">Processing Options</h4>
                  
                  {/* Clean Transcript Option */}
                  <div className="flex items-center">
                    <input
                      id="clean-transcript"
                      type="checkbox"
                      checked={cleanTranscript}
                      onChange={(e) => setCleanTranscript(e.target.checked)}
                      className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 rounded"
                    />
                    <label htmlFor="clean-transcript" className="ml-2 text-sm text-gray-700">
                      Clean and generate new transcript
                    </label>
                  </div>

                  {/* AE Check Option */}
                  <div className="flex items-center">
                    <input
                      id="check-aes"
                      type="checkbox"
                      checked={checkForAEs}
                      onChange={(e) => setCheckForAEs(e.target.checked)}
                      disabled={hasAETraining === false}
                      className={`h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 rounded ${
                        hasAETraining === false ? 'opacity-50 cursor-not-allowed' : ''
                      }`}
                    />
                    <label 
                      htmlFor="check-aes" 
                      className={`ml-2 text-sm ${
                        hasAETraining === false ? 'text-gray-400' : 'text-gray-700'
                      }`}
                      title={hasAETraining === false ? 'AE training not set up for this client. Visit Client Center to upload training materials.' : ''}
                    >
                      Check for AEs
                      {hasAETraining === false && (
                        <span className="ml-1 text-xs text-gray-400">(Not available)</span>
                      )}
                    </label>
                  </div>

                </div>
              </div>
            )}
            {!processingTranscript && (
              <div className="flex items-center justify-end space-x-3 p-4 border-t border-gray-200">
                <button
                  onClick={() => setShowTranscriptUploadModal(false)}
                  className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50"
                >
                  Cancel
                </button>
                <button
                  onClick={async () => {
                    if (!transcriptFile) return;
                    
                    setProcessingTranscript(true);
                    
                    try {
                      const formData = new FormData();
                      formData.append('transcript', transcriptFile);
                      formData.append('projectId', currentAnalysis.projectId || 'temp');
                      formData.append('analysisId', currentAnalysis.id);
                      formData.append('activeSheet', activeSheet);
                      formData.append('currentData', JSON.stringify(currentAnalysis.data));
                      formData.append('discussionGuide', currentAnalysis.rawGuideText || '');
                      formData.append('cleanTranscript', cleanTranscript.toString());
                      formData.append('checkForAEs', checkForAEs.toString());

                      const controller = new AbortController();
                      const timeoutId = setTimeout(() => controller.abort(), 30 * 60 * 1000);

                      const response = await fetch(`${API_BASE_URL}/api/caX/process-transcript`, {
                        method: 'POST',
                        body: formData,
                        headers: { 'Authorization': `Bearer ${localStorage.getItem('jaice_token')}` },
                        signal: controller.signal
                      });

                      clearTimeout(timeoutId);
                      const result = await response.json();

                      if (!response.ok) {
                        throw new Error(result?.error || 'Transcript processing failed');
                      }

                      // Update analysis with new data and context
                      if (result?.data) {
                        const updatedAnalysis = { ...currentAnalysis };
                        for (const [sheetName, sheetData] of Object.entries(result.data)) {
                          updatedAnalysis.data[sheetName] = sheetData;
                        }
                        
                        // Update context if available
                        if (result?.context) {
                          updatedAnalysis.context = result.context;
                        }
                        
                        setCurrentAnalysis(updatedAnalysis);
                      }

                      // Handle AE Report if available
                      if (result?.aeReport) {
                        setAeReport(result.aeReport);
                      }

                      setTranscriptFile(null);
                      setCleanTranscript(true);
                      setCheckForAEs(false);
                      setShowTranscriptUploadModal(false);
                    } catch (error) {
                      console.error('Transcript processing error:', error);
                      alert('Failed to process transcript: ' + (error as Error).message);
                    } finally {
                      setProcessingTranscript(false);
                    }
                  }}
                  disabled={!transcriptFile}
                  className="px-4 py-2 text-sm font-medium text-white bg-blue-600 border border-transparent rounded-md hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  Upload & Process
                </button>
              </div>
            )}
          </div>
        </div>,
        document.body
      )}

    </div>
  );
}








