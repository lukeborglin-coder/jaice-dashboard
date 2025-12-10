import { useState, useEffect, useCallback } from 'react';
import * as api from '../services/dataQualityApi';

interface QualityPlan {
  projectId: string;
  rules: any[];
  globalAggressiveness: {
    openEndAggressiveness: number;
    straightliningAggressiveness: number;
    speedingAggressiveness: number;
    logicAggressiveness: number;
  };
  createdAt?: string;
  updatedAt?: string;
}

interface UseDataQualityProps {
  projectId: string | null;
}

export function useDataQuality({ projectId }: UseDataQualityProps) {
  const [qualityPlan, setQualityPlan] = useState<QualityPlan | null>(null);
  const [loadingPlan, setLoadingPlan] = useState(false);
  const [qaData, setQaData] = useState<any[]>([]);
  const [loadingData, setLoadingData] = useState(false);
  const [qaResults, setQaResults] = useState<any[]>([]);
  const [loadingResults, setLoadingResults] = useState(false);
  const [resultsSummary, setResultsSummary] = useState<any>(null);

  // Load quality plan
  const loadQualityPlan = useCallback(async () => {
    if (!projectId) return;
    
    setLoadingPlan(true);
    try {
      const plan = await api.qualityPlanApi.get(projectId);
      setQualityPlan(plan);
    } catch (error: any) {
      if (error.response?.status !== 404) {
        console.error('Error loading quality plan:', error);
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
    try {
      const saved = await api.qualityPlanApi.save(projectId, plan);
      setQualityPlan(saved);
      return saved;
    } catch (error) {
      console.error('Error saving quality plan:', error);
      throw error;
    } finally {
      setLoadingPlan(false);
    }
  }, [projectId]);

  // Load QA data
  const loadQAData = useCallback(async (page: number = 1, limit: number = 50) => {
    if (!projectId) return;
    
    setLoadingData(true);
    try {
      const response = await api.qaDataApi.get(projectId, page, limit);
      setQaData(response.data);
      return response;
    } catch (error) {
      console.error('Error loading QA data:', error);
      throw error;
    } finally {
      setLoadingData(false);
    }
  }, [projectId]);

  // Upload QA data
  const uploadQAData = useCallback(async (file: File, questionnaireId?: string) => {
    if (!projectId) return;
    
    setLoadingData(true);
    try {
      const result = await api.qaDataApi.upload(projectId, file, questionnaireId);
      // Reload data after upload
      await loadQAData(1, 50);
      return result;
    } catch (error) {
      console.error('Error uploading QA data:', error);
      throw error;
    } finally {
      setLoadingData(false);
    }
  }, [projectId, loadQAData]);

  // Load QA results
  const loadQAResults = useCallback(async (filters?: { category?: string; checkType?: string; page?: number; limit?: number }) => {
    if (!projectId) return;
    
    setLoadingResults(true);
    try {
      const response = await api.qaResultsApi.get(projectId, filters);
      setQaResults(response.results);
      setResultsSummary(response.summary);
      return response;
    } catch (error) {
      console.error('Error loading QA results:', error);
      throw error;
    } finally {
      setLoadingResults(false);
    }
  }, [projectId]);

  // Run QA checks
  const runQA = useCallback(async (respondentIds?: string[], force: boolean = false, questionnaireId?: string) => {
    if (!projectId) return;
    
    setLoadingResults(true);
    try {
      const result = await api.qaResultsApi.run(projectId, respondentIds, force, questionnaireId);
      // Reload results after running QA
      await loadQAResults();
      return result;
    } catch (error) {
      console.error('Error running QA:', error);
      throw error;
    } finally {
      setLoadingResults(false);
    }
  }, [projectId, loadQAResults]);

  // Update QA result
  const updateQAResult = useCallback(async (respno: string, updates: { category?: string; statusLocked?: boolean; score?: number }) => {
    if (!projectId) return;
    
    try {
      const updated = await api.qaResultsApi.update(projectId, respno, updates);
      // Update local state
      setQaResults((prev) =>
        prev.map((r) => (r.respno === respno ? updated : r))
      );
      return updated;
    } catch (error) {
      console.error('Error updating QA result:', error);
      throw error;
    }
  }, [projectId]);

  // Load plan on mount
  useEffect(() => {
    loadQualityPlan();
  }, [loadQualityPlan]);

  return {
    qualityPlan,
    loadingPlan,
    qaData,
    loadingData,
    qaResults,
    loadingResults,
    resultsSummary,
    loadQualityPlan,
    saveQualityPlan,
    loadQAData,
    uploadQAData,
    loadQAResults,
    runQA,
    updateQAResult
  };
}


