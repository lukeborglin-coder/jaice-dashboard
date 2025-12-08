import { useState, useCallback, useEffect, useRef } from 'react';
import { API_BASE_URL } from '../config';

interface UseDataMappingProps {
  selectedQuestionnaire?: any | null;
  qnrViewMode?: string;
}

export const useDataMapping = (props?: UseDataMappingProps) => {
  const { selectedQuestionnaire, qnrViewMode } = props || {};
  
  const [columnMapping, setColumnMappingState] = useState<Record<string, string>>({});
  const [mappingFilter, setMappingFilter] = useState<'all' | 'mapped' | 'unmapped'>('all');
  const [datamapData, setDatamapData] = useState<{
    sheetName: string;
    questions: any[];
    totalQuestions: number;
    columnDefinitions?: Array<{ columnName: string; description: string }>;
    parsedQuestions?: Array<{ 
      questionNumber: string; 
      description: string; 
      responseType: string;
      responseCodes?: Array<{ code: string; text: string }>;
      isOpenResponse?: boolean;
    }>;
    rawData?: any[];
    warning?: string;
    error?: string;
    availableSheets?: string[];
  } | null>(null);
  const [loadingDatamap, setLoadingDatamap] = useState(false);
  const [showColumnHeadersInfo, setShowColumnHeadersInfo] = useState(false);
  const [showMappingResultsModal, setShowMappingResultsModal] = useState(false);
  const [expandedDatamapRows, setExpandedDatamapRows] = useState<Set<number>>(new Set());

  // Track if we've already attempted to load datamap to prevent repeated failed requests
  const datamapLoadAttemptedRef = useRef<Set<string>>(new Set());

  // Wrapper to track all columnMapping changes and persist to localStorage
  const setColumnMapping = useCallback((mapping: Record<string, string> | ((prev: Record<string, string>) => Record<string, string>)) => {
    setColumnMappingState((prev) => {
      const next = typeof mapping === 'function' ? mapping(prev) : mapping;
      try {
        // Persist mapping to localStorage per questionnaire for durability across refreshes
        if (selectedQuestionnaire && selectedQuestionnaire.id) {
          const storageKey = `columnMapping_${selectedQuestionnaire.id}`;
          localStorage.setItem(storageKey, JSON.stringify(next));
        }
      } catch (e) {
        console.warn('Failed to persist mapping to localStorage', e);
      }
      return next;
    });
  }, [selectedQuestionnaire]);

  // Load datamap function
  const loadDatamap = useCallback(async (force = false) => {
    if (!selectedQuestionnaire) {
      return Promise.resolve();
    }
    
    // Prevent multiple simultaneous requests for the same questionnaire
    const qnrId = selectedQuestionnaire.id;
    if (loadingDatamap) {
      return Promise.resolve();
    }
    
    // If not forcing and we've already attempted, skip
    if (!force && datamapLoadAttemptedRef.current.has(qnrId)) {
      return Promise.resolve();
    }
    
    // If forcing, clear the attempted flag
    if (force) {
      datamapLoadAttemptedRef.current.delete(qnrId);
    }
    
    setLoadingDatamap(true);
    datamapLoadAttemptedRef.current.add(qnrId);
    
    try {
      const response = await fetch(`${API_BASE_URL}/api/questionnaire/datamap/${selectedQuestionnaire.id}`, {
        headers: { 'Authorization': `Bearer ${localStorage.getItem('cognitive_dash_token')}` }
      });
      if (response.ok) {
        const data = await response.json();
        setDatamapData(data);
        // Remove from attempted set on success so it can be reloaded if needed
        datamapLoadAttemptedRef.current.delete(qnrId);
      } else {
        const errorData = await response.json().catch(() => ({ error: 'Unknown error' }));
        
        // Still set the data if it has rawData for debugging
        if (errorData.rawData || errorData.availableSheets) {
          setDatamapData({
            sheetName: errorData.sheetName || 'Unknown',
            questions: [],
            totalQuestions: 0,
            columnDefinitions: errorData.columnDefinitions || [],
            rawData: errorData.rawData || [],
            error: errorData.error,
            warning: errorData.warning,
            availableSheets: errorData.availableSheets
          });
          // Remove from attempted set so it can be reloaded
          datamapLoadAttemptedRef.current.delete(qnrId);
        } else {
          // For 404 or other errors without data, set to null and keep in attempted set
          setDatamapData(null);
          // Only keep in attempted set if it's a 404 (expected error)
          if (response.status !== 404) {
            // For other errors, allow retry
            datamapLoadAttemptedRef.current.delete(qnrId);
          }
        }
      }
    } catch (error) {
      // Only allow retry if it's not a network error that might be temporary
      if (error instanceof TypeError && error.message.includes('fetch')) {
        // Network error, allow retry
        datamapLoadAttemptedRef.current.delete(qnrId);
      }
      setDatamapData(null);
      // Allow retry on catch errors
      datamapLoadAttemptedRef.current.delete(qnrId);
    } finally {
      setLoadingDatamap(false);
    }
  }, [selectedQuestionnaire, loadingDatamap]);

  // Clear datamap data when questionnaire changes
  useEffect(() => {
    setDatamapData(null);
    // Clear the attempted set when questionnaire changes to allow loading for new questionnaire
    datamapLoadAttemptedRef.current.clear();
  }, [selectedQuestionnaire?.id]);

  // Preload column mapping from localStorage quickly on questionnaire change
  useEffect(() => {
    if (!selectedQuestionnaire) return;
    // If we already have a mapping in memory, don't override it
    if (columnMapping && Object.keys(columnMapping).length > 0) return;
    try {
      const storageKey = `columnMapping_${selectedQuestionnaire.id}`;
      const stored = localStorage.getItem(storageKey);
      if (stored) {
        const parsed = JSON.parse(stored);
        if (parsed && typeof parsed === 'object' && Object.keys(parsed).length > 0) {
          setColumnMapping(parsed);
        }
      }
    } catch {}
  }, [selectedQuestionnaire, columnMapping, setColumnMapping]);

  return {
    columnMapping,
    mappingFilter,
    datamapData,
    loadingDatamap,
    showColumnHeadersInfo,
    showMappingResultsModal,
    expandedDatamapRows,
    loadDatamap,
    setColumnMapping,
    setMappingFilter,
    setDatamapData,
    setLoadingDatamap,
    setShowColumnHeadersInfo,
    setShowMappingResultsModal,
    setExpandedDatamapRows,
  };
};
