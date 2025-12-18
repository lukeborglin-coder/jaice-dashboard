import { useState, useCallback } from 'react';
import * as api from '../services/dataQualityApi';
import type {
  QualityPlan,
  QAResult,
  QAResultsSummary,
  DataUpload,
  QACategory,
} from '../types/dataQuality';

interface UseDataQualityProps {
  projectId: string | null;
}

interface QAResultFilters {
  category?: QACategory;
  checkType?: string;
  page?: number;
  limit?: number;
}

interface QAResultUpdate {
  category?: QACategory;
  statusLocked?: boolean;
  score?: number;
}

interface PaginationState {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

const defaultPagination: PaginationState = {
  page: 1,
  limit: 50,
  total: 0,
  totalPages: 0,
};

export function useDataQuality({ projectId }: UseDataQualityProps) {
  const [qualityPlan, setQualityPlan] = useState<QualityPlan | null>(null);
  const [loadingPlan, setLoadingPlan] = useState(false);
  const [uploads, setUploads] = useState<DataUpload[]>([]);
  const [loadingUploads, setLoadingUploads] = useState(false);
  const [qaResults, setQaResults] = useState<QAResult[]>([]);
  const [loadingResults, setLoadingResults] = useState(false);
  const [resultsPagination, setResultsPagination] = useState<PaginationState>(defaultPagination);
  const [resultsSummary, setResultsSummary] = useState<QAResultsSummary | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Load quality plan
  const loadQualityPlan = useCallback(async () => {
    if (!projectId) return;
    
    setLoadingPlan(true);
    setError(null);
    try {
      const plan = await api.qualityPlanApi.get(projectId);
      setQualityPlan(plan);
    } catch (err: any) {
      if (err.response?.status !== 404) {
        console.error('Error loading quality plan:', err);
        setError('Failed to load quality plan');
      }
      setQualityPlan(null);
    } finally {
      setLoadingPlan(false);
    }
  }, [projectId]);

  // Save quality plan
  const saveQualityPlan = useCallback(async (plan: QualityPlan) => {
    if (!projectId) return;
    
    setLoadingPlan(true);
    setError(null);
    try {
      const saved = await api.qualityPlanApi.save(projectId, plan);
      setQualityPlan(saved);
      return saved;
    } catch (err) {
      console.error('Error saving quality plan:', err);
      setError('Failed to save quality plan');
      throw err;
    } finally {
      setLoadingPlan(false);
    }
  }, [projectId]);

  // Load uploads
  const loadUploads = useCallback(async () => {
    if (!projectId) return;
    
    setLoadingUploads(true);
    setError(null);
    try {
      const response = await api.qaDataApi.getUploads(projectId);
      setUploads(response.uploads || []);
      return response;
    } catch (err: any) {
      // Silently handle 404 - endpoint may not exist yet on backend
      if (err.response?.status === 404) {
        setUploads([]);
        return { uploads: [] };
      }
      console.error('Error loading uploads:', err);
      setError('Failed to load uploads');
      throw err;
    } finally {
      setLoadingUploads(false);
    }
  }, [projectId]);

  // Upload QA data
  const uploadQAData = useCallback(async (file: File) => {
    if (!projectId) return;
    
    setLoadingUploads(true);
    setError(null);
    try {
      const result = await api.qaDataApi.upload(projectId, file);
      // Try to reload uploads after upload (may not exist yet)
      try {
        await loadUploads();
      } catch {
        // Silently ignore if uploads endpoint doesn't exist
      }
      return result;
    } catch (err) {
      console.error('Error uploading QA data:', err);
      setError('Failed to upload QA data');
      throw err;
    } finally {
      setLoadingUploads(false);
    }
  }, [projectId, loadUploads]);

  // Delete upload
  const deleteUpload = useCallback(async (uploadId: string) => {
    if (!projectId) return;
    
    setError(null);
    try {
      await api.qaDataApi.deleteUpload(projectId, uploadId);
      // Reload uploads after delete
      await loadUploads();
    } catch (err: any) {
      // Silently handle 404 - endpoint may not exist yet
      if (err.response?.status === 404) {
        return;
      }
      console.error('Error deleting upload:', err);
      setError('Failed to delete upload');
      throw err;
    }
  }, [projectId, loadUploads]);

  // Load QA results
  const loadQAResults = useCallback(async (filters?: QAResultFilters) => {
    if (!projectId) return;
    
    setLoadingResults(true);
    setError(null);
    try {
      const response = await api.qaResultsApi.get(projectId, filters);
      setQaResults(response.results || []);
      setResultsSummary(response.summary);
      setResultsPagination({
        page: response.page || filters?.page || 1,
        limit: response.limit || filters?.limit || 50,
        total: response.total || 0,
        totalPages: response.totalPages || Math.ceil((response.total || 0) / (filters?.limit || 50)),
      });
      return response;
    } catch (err) {
      console.error('Error loading QA results:', err);
      setError('Failed to load QA results');
      throw err;
    } finally {
      setLoadingResults(false);
    }
  }, [projectId]);

  // Run QA checks
  const runQA = useCallback(async (respondentIds?: string[], force: boolean = false, questionnaireId?: string) => {
    if (!projectId) return;
    
    setLoadingResults(true);
    setError(null);
    try {
      const result = await api.qaResultsApi.run(projectId, respondentIds, force, questionnaireId);
      // Reload results after running QA
      await loadQAResults();
      return result;
    } catch (err) {
      console.error('Error running QA:', err);
      setError('Failed to run QA checks');
      throw err;
    } finally {
      setLoadingResults(false);
    }
  }, [projectId, loadQAResults]);

  // Update QA result
  const updateQAResult = useCallback(async (respno: string, updates: QAResultUpdate) => {
    if (!projectId) return;
    
    setError(null);
    try {
      const updated = await api.qaResultsApi.update(projectId, respno, updates);
      // Update local state
      setQaResults((prev) =>
        prev.map((r) => (r.respno === respno ? updated : r))
      );
      return updated;
    } catch (err) {
      console.error('Error updating QA result:', err);
      setError('Failed to update QA result');
      throw err;
    }
  }, [projectId]);

  // Bulk update QA results
  const bulkUpdateQAResults = useCallback(async (respnos: string[], updates: QAResultUpdate) => {
    if (!projectId || respnos.length === 0) return;
    
    setError(null);
    try {
      const results = await Promise.all(
        respnos.map((respno) => api.qaResultsApi.update(projectId, respno, updates))
      );
      // Reload results after bulk update
      await loadQAResults();
      return results;
    } catch (err) {
      console.error('Error bulk updating QA results:', err);
      setError('Failed to bulk update QA results');
      throw err;
    }
  }, [projectId, loadQAResults]);

  return {
    qualityPlan,
    loadingPlan,
    uploads,
    loadingUploads,
    qaResults,
    loadingResults,
    resultsPagination,
    resultsSummary,
    error,
    loadQualityPlan,
    saveQualityPlan,
    loadUploads,
    uploadQAData,
    deleteUpload,
    loadQAResults,
    runQA,
    updateQAResult,
    bulkUpdateQAResults,
  };
}
