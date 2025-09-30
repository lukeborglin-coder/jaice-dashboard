// API Configuration
// In production, VITE_API_URL will be set in Render environment variables
// In development, it falls back to localhost
export const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:3005';

// API endpoints
export const API_ENDPOINTS = {
  auth: {
    users: `${API_BASE_URL}/api/auth/users`,
    usersWithPasswords: `${API_BASE_URL}/api/auth/users/with-passwords`,
  },
  projects: {
    base: `${API_BASE_URL}/api/projects`,
    all: `${API_BASE_URL}/api/projects/all`,
    archived: `${API_BASE_URL}/api/projects/archived`,
  },
  contentAnalysis: {
    base: `${API_BASE_URL}/api/ca`,
    generate: `${API_BASE_URL}/api/ca/generate`,
    upload: `${API_BASE_URL}/api/ca/upload`,
    template: `${API_BASE_URL}/api/ca/template`,
  },
  contentAnalysisX: {
    saved: `${API_BASE_URL}/api/caX/saved`,
    generate: `${API_BASE_URL}/api/caX/generate`,
  },
};
