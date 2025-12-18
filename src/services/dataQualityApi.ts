import axios from 'axios';
import { API_BASE_URL } from '../config';

const getAuthHeaders = () => {
  const token = localStorage.getItem('cognitive_dash_token');
  return {
    'Authorization': `Bearer ${token}`,
    'Content-Type': 'application/json'
  };
};

// Quality Plan APIs
export const qualityPlanApi = {
  get: async (projectId: string) => {
    const response = await axios.get(
      `${API_BASE_URL}/api/data-quality/${projectId}/plan`,
      { headers: getAuthHeaders() }
    );
    return response.data;
  },

  save: async (projectId: string, plan: any) => {
    const response = await axios.post(
      `${API_BASE_URL}/api/data-quality/${projectId}/plan`,
      plan,
      { headers: getAuthHeaders() }
    );
    return response.data;
  },

  updateRule: async (projectId: string, ruleId: string, ruleData: any) => {
    const response = await axios.put(
      `${API_BASE_URL}/api/data-quality/${projectId}/plan/rules/${ruleId}`,
      ruleData,
      { headers: getAuthHeaders() }
    );
    return response.data;
  },

  deleteRule: async (projectId: string, ruleId: string) => {
    const response = await axios.delete(
      `${API_BASE_URL}/api/data-quality/${projectId}/plan/rules/${ruleId}`,
      { headers: getAuthHeaders() }
    );
    return response.data;
  },

  generate: async (projectId: string, questionnaireId?: string) => {
    const response = await axios.post(
      `${API_BASE_URL}/api/data-quality/${projectId}/plan/generate`,
      { questionnaireId },
      { headers: getAuthHeaders() }
    );
    return response.data;
  },

  addRule: async (projectId: string, ruleData: any) => {
    const response = await axios.post(
      `${API_BASE_URL}/api/data-quality/${projectId}/plan/rules`,
      ruleData,
      { headers: getAuthHeaders() }
    );
    return response.data;
  },

  updateSettings: async (projectId: string, settings: any) => {
    const response = await axios.put(
      `${API_BASE_URL}/api/data-quality/${projectId}/plan/settings`,
      settings,
      { headers: getAuthHeaders() }
    );
    return response.data;
  }
};

// QA Data APIs
export const qaDataApi = {
  upload: async (projectId: string, file: File) => {
    const formData = new FormData();
    formData.append('file', file);

    const token = localStorage.getItem('cognitive_dash_token');
    const response = await axios.post(
      `${API_BASE_URL}/api/data-quality/${projectId}/data/upload`,
      formData,
      {
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'multipart/form-data'
        }
      }
    );
    return response.data;
  },

  getUploads: async (projectId: string) => {
    const response = await axios.get(
      `${API_BASE_URL}/api/data-quality/${projectId}/data/uploads`,
      { headers: getAuthHeaders() }
    );
    return response.data;
  },

  deleteUpload: async (projectId: string, uploadId: string) => {
    const response = await axios.delete(
      `${API_BASE_URL}/api/data-quality/${projectId}/data/uploads/${uploadId}`,
      { headers: getAuthHeaders() }
    );
    return response.data;
  },

  getUploadPreview: async (projectId: string, uploadId: string) => {
    const response = await axios.get(
      `${API_BASE_URL}/api/data-quality/${projectId}/data/uploads/${uploadId}/preview`,
      { headers: getAuthHeaders() }
    );
    return response.data;
  },

  get: async (projectId: string, page: number = 1, limit: number = 50) => {
    const response = await axios.get(
      `${API_BASE_URL}/api/data-quality/${projectId}/data`,
      {
        params: { page, limit },
        headers: getAuthHeaders() }
    );
    return response.data;
  }
};

// QA Results APIs
export const qaResultsApi = {
  run: async (projectId: string, respondentIds?: string[], force: boolean = false, questionnaireId?: string) => {
    const response = await axios.post(
      `${API_BASE_URL}/api/data-quality/${projectId}/qa/run`,
      { respondentIds, force, questionnaireId },
      {
        headers: getAuthHeaders(),
        // Prevent UI from hanging forever if the server stalls
        timeout: 60000
      }
    );
    return response.data;
  },

  get: async (projectId: string, filters?: { category?: string; checkType?: string; page?: number; limit?: number }) => {
    const response = await axios.get(
      `${API_BASE_URL}/api/data-quality/${projectId}/qa/results`,
      {
        params: filters,
        headers: getAuthHeaders() }
    );
    return response.data;
  },

  update: async (projectId: string, respno: string, updates: { category?: string; statusLocked?: boolean; score?: number }) => {
    const response = await axios.put(
      `${API_BASE_URL}/api/data-quality/${projectId}/qa/results/${respno}`,
      updates,
      { headers: getAuthHeaders() }
    );
    return response.data;
  }
};




