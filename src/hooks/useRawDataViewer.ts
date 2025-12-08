import { useState, useCallback, useEffect, useRef } from 'react';
import { API_BASE_URL } from '../config';

interface UseRawDataViewerProps {
  selectedQuestionnaire?: any | null;
  qnrViewMode?: string;
  viewMode?: string;
  dataTabView?: string;
}

export const useRawDataViewer = (props?: UseRawDataViewerProps) => {
  const { selectedQuestionnaire, qnrViewMode, viewMode, dataTabView } = props || {};
  
  const [fullRawData, setFullRawData] = useState<{ columns: string[]; rows: any[] } | null>(null);
  const [loadingFullRawData, setLoadingFullRawData] = useState(false);
  const [rawDataPage, setRawDataPage] = useState(1);
  const [rawDataRowsPerPage] = useState(100);
  const [rawDataColumnStart, setRawDataColumnStart] = useState(0);
  const [rawDataColumnsPerPage] = useState(20);

  // Track if we've already attempted to load full raw data to prevent repeated failed requests
  const fullRawDataLoadAttemptedRef = useRef<Set<string>>(new Set());

  // Load full raw data function
  const loadFullRawData = useCallback(async (force = false) => {
    if (!selectedQuestionnaire) {
      return;
    }
    
    // Prevent multiple simultaneous requests for the same questionnaire
    const qnrId = selectedQuestionnaire.id;
    if (loadingFullRawData) {
      return;
    }
    
    // If not forcing and we've already attempted, skip
    if (!force && fullRawDataLoadAttemptedRef.current.has(qnrId)) {
      return;
    }
    
    // If forcing, clear the attempted flag
    if (force) {
      fullRawDataLoadAttemptedRef.current.delete(qnrId);
    }
    
    // Mark as attempted before making the request
    fullRawDataLoadAttemptedRef.current.add(qnrId);
    
    setLoadingFullRawData(true);
    try {
      const response = await fetch(`${API_BASE_URL}/api/questionnaire/raw-data/${selectedQuestionnaire.id}`, {
        headers: { 'Authorization': `Bearer ${localStorage.getItem('cognitive_dash_token')}` }
      });
      if (response.ok) {
        const data = await response.json();
        setFullRawData(data);
        // Remove from attempted set on success so it can be reloaded if needed
        fullRawDataLoadAttemptedRef.current.delete(qnrId);
      } else {
        setFullRawData(null);
        // Keep in attempted set on failure to prevent retry loop
      }
    } catch (error) {
      setFullRawData(null);
      // Keep in attempted set on failure to prevent retry loop
    } finally {
      setLoadingFullRawData(false);
    }
  }, [selectedQuestionnaire, loadingFullRawData]);

  // Clear full raw data when questionnaire changes
  useEffect(() => {
    setFullRawData(null);
    // Clear the attempted set when questionnaire changes to allow loading for new questionnaire
    fullRawDataLoadAttemptedRef.current.clear();
  }, [selectedQuestionnaire?.id]);

  // Load full raw data when viewing raw data tab OR variables tab with uploaded data
  // OR when on the tabs page (qnr view) - auto-load data when tabs page opens
  useEffect(() => {
    if (!selectedQuestionnaire || loadingFullRawData) {
      return;
    }

    // Don't reload if we already have data for this questionnaire
    if (fullRawData) {
      return;
    }

    // Don't retry if we've already attempted to load for this questionnaire
    if (fullRawDataLoadAttemptedRef.current.has(selectedQuestionnaire.id)) {
      return;
    }

    // Auto-load data when:
    // 1. Viewing variables tab (existing behavior)
    // 2. On the tabs page (qnr view) - load automatically when page opens
    // 3. Viewing raw data tab in the data section
    if (qnrViewMode === 'variables' || viewMode === 'qnr' || dataTabView === 'rawdata') {
      loadFullRawData();
    }
  }, [qnrViewMode, fullRawData, loadingFullRawData, selectedQuestionnaire, loadFullRawData, viewMode, dataTabView]);

  // Reset pagination when switching to raw data tab or when questionnaire changes
  useEffect(() => {
    setRawDataPage(1);
    setRawDataColumnStart(0);
  }, [qnrViewMode, selectedQuestionnaire?.id, fullRawData]);

  return {
    fullRawData,
    loadingFullRawData,
    rawDataPage,
    rawDataRowsPerPage,
    rawDataColumnStart,
    rawDataColumnsPerPage,
    loadFullRawData,
    setFullRawData,
    setLoadingFullRawData,
    setRawDataPage,
    setRawDataColumnStart,
  };
};
