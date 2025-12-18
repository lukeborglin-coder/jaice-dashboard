import { useCallback, useState } from 'react';
import { API_BASE_URL } from '../config';

export type TabPlanSourceType = 'qnr' | 'raw';

export type TabPlan = {
  id: string;
  projectId: string;
  name: string;
  sourceType: TabPlanSourceType;
  qnrId?: string;
  createdAt: string;
  updatedAt: string;
  specs?: any;
};

function authHeaders(extra?: Record<string, string>) {
  return {
    Authorization: `Bearer ${localStorage.getItem('cognitive_dash_token')}`,
    ...(extra || {}),
  };
}

export function useTabPlans() {
  const [plans, setPlans] = useState<TabPlan[]>([]);
  const [loadingPlans, setLoadingPlans] = useState(false);

  const listByProject = useCallback(async (projectId: string) => {
    if (!projectId) return [];
    setLoadingPlans(true);
    try {
      const res = await fetch(`${API_BASE_URL}/api/tab-plans/project/${projectId}`, {
        headers: authHeaders(),
      });
      if (!res.ok) {
        setPlans([]);
        return [];
      }
      const data = (await res.json()) as TabPlan[];
      setPlans(Array.isArray(data) ? data : []);
      return Array.isArray(data) ? data : [];
    } finally {
      setLoadingPlans(false);
    }
  }, []);

  const createPlan = useCallback(async (payload: { projectId: string; name: string; sourceType: TabPlanSourceType; qnrId?: string }) => {
    const res = await fetch(`${API_BASE_URL}/api/tab-plans`, {
      method: 'POST',
      headers: authHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err?.error || 'Failed to create tab plan');
    }
    return (await res.json()) as TabPlan;
  }, []);

  const getPlan = useCallback(async (planId: string) => {
    const res = await fetch(`${API_BASE_URL}/api/tab-plans/${planId}`, {
      headers: authHeaders(),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err?.error || 'Failed to load tab plan');
    }
    return (await res.json()) as TabPlan;
  }, []);

  const updatePlan = useCallback(async (planId: string, payload: { name?: string; specs?: any }) => {
    const res = await fetch(`${API_BASE_URL}/api/tab-plans/${planId}`, {
      method: 'PUT',
      headers: authHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err?.error || 'Failed to update tab plan');
    }
    return (await res.json()) as TabPlan;
  }, []);

  const deletePlan = useCallback(async (planId: string) => {
    const res = await fetch(`${API_BASE_URL}/api/tab-plans/${planId}`, {
      method: 'DELETE',
      headers: authHeaders(),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err?.error || 'Failed to delete tab plan');
    }
    return await res.json();
  }, []);

  const uploadDataFile = useCallback(async (planId: string, file: File) => {
    const formData = new FormData();
    formData.append('file', file);
    const res = await fetch(`${API_BASE_URL}/api/tab-plans/${planId}/upload-data-file`, {
      method: 'POST',
      headers: authHeaders(),
      body: formData,
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err?.error || 'Failed to upload data file');
    }
    return await res.json();
  }, []);

  const getDatamap = useCallback(async (planId: string) => {
    const res = await fetch(`${API_BASE_URL}/api/tab-plans/${planId}/datamap`, {
      headers: authHeaders(),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err?.error || 'Failed to load datamap');
    }
    return await res.json();
  }, []);

  const getRawData = useCallback(async (planId: string) => {
    const res = await fetch(`${API_BASE_URL}/api/tab-plans/${planId}/raw-data`, {
      headers: authHeaders(),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err?.error || 'Failed to load raw data');
    }
    return await res.json();
  }, []);

  return {
    plans,
    loadingPlans,
    setPlans,
    listByProject,
    createPlan,
    getPlan,
    updatePlan,
    deletePlan,
    uploadDataFile,
    getDatamap,
    getRawData,
  };
}





