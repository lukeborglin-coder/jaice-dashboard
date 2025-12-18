// API Configuration
// Debug logging to troubleshoot URL issue
console.log('🔧 Config Debug:', {
  hostname: window.location.hostname,
  isProduction: window.location.hostname === 'cognitive-dash.onrender.com'
});

const isProduction = window.location.hostname === 'cognitive-dash.onrender.com';
const backendURL = isProduction
  ? 'https://jaice-dashboard-backend.onrender.com'
  : 'http://localhost:3005';

console.log('🌐 API_BASE_URL set to:', backendURL);

export const API_BASE_URL = backendURL;

// Conjoint backend feature flag
// Default is disabled. Enable by setting: VITE_CONJOINT_BACKEND_ENABLED=true
export const CONJOINT_BACKEND_ENABLED =
  (import.meta as any)?.env?.VITE_CONJOINT_BACKEND_ENABLED === 'true';

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
