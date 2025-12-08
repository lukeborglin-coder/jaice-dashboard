import { useState, useEffect, useMemo, useCallback } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { API_BASE_URL } from '../config';

interface Project {
  id: string;
  name: string;
  methodologyType?: string;
  archived?: boolean;
  client?: string;
  createdBy?: string;
  teamMembers?: Array<{ id?: string; email?: string; name?: string }>;
  [key: string]: any;
}

interface UseQualProjectsOptions {
  /**
   * Filter projects to only qualitative ones
   */
  filterQualitative?: boolean;
  /**
   * Initial active tab state
   */
  initialActiveTab?: 'active' | 'archived';
  /**
   * Session storage key for project navigation
   */
  sessionStorageKey?: string;
}

interface UseQualProjectsReturn {
  // Project lists
  projects: Project[];
  archivedProjects: Project[];
  
  // Filtered lists
  filteredActiveProjects: Project[];
  filteredArchivedProjects: Project[];
  displayProjects: Project[];
  
  // Selection state
  selectedProject: Project | null;
  setSelectedProject: (project: Project | null) => void;
  
  // Tab state
  activeTab: 'active' | 'archived';
  setActiveTab: (tab: 'active' | 'archived') => void;
  
  // Filter state
  showMyProjectsOnly: boolean;
  setShowMyProjectsOnly: (show: boolean) => void;
  
  // Loading states
  isLoadingProjects: boolean;
  isLoadingArchived: boolean;
  
  // Error state
  error: string | null;
  
  // Helper functions
  loadActiveProjects: () => Promise<void>;
  loadArchivedProjects: () => Promise<void>;
  refreshProjects: () => Promise<void>;
}

/**
 * Custom hook for managing projects in qualitative tools (Content Analysis, Transcripts, Storytelling)
 * Consolidates project loading, filtering, and selection logic
 */
export function useQualProjects(options: UseQualProjectsOptions = {}): UseQualProjectsReturn {
  const {
    filterQualitative = true,
    initialActiveTab = 'active',
    sessionStorageKey
  } = options;

  const { user } = useAuth();
  const [projects, setProjects] = useState<Project[]>([]);
  const [archivedProjects, setArchivedProjects] = useState<Project[]>([]);
  const [selectedProject, setSelectedProject] = useState<Project | null>(null);
  const [activeTab, setActiveTab] = useState<'active' | 'archived'>(initialActiveTab);
  const [showMyProjectsOnly, setShowMyProjectsOnly] = useState(true);
  const [isLoadingProjects, setIsLoadingProjects] = useState(false);
  const [isLoadingArchived, setIsLoadingArchived] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const getAuthHeaders = useCallback(() => {
    const token = localStorage.getItem('cognitive_dash_token');
    return token ? { Authorization: `Bearer ${token}` } : {};
  }, []);

  // Check if project is qualitative
  const isQualitative = useCallback((project: Project): boolean => {
    if (!filterQualitative) return true;
    
    const methodology = project?.methodologyType?.toLowerCase();
    
    // If no methodology type, assume it's qualitative (for backward compatibility)
    if (!methodology) {
      return true;
    }
    
    return methodology.includes('qual') ||
           methodology.includes('interview') ||
           methodology.includes('focus group') ||
           methodology.includes('ethnography') ||
           methodology.includes('observation');
  }, [filterQualitative]);

  // Filter projects by user
  const filterProjectsByUser = useCallback(
    (list: Project[]): Project[] => {
      if (!showMyProjectsOnly || !user) return list;

      const uid = String((user as any)?.id || '').toLowerCase();
      const uemail = String((user as any)?.email || '').toLowerCase();
      const uname = String((user as any)?.name || '').toLowerCase();

      return list.filter(project => {
        // Check if user is assigned to the project via team members
        const teamMembers = Array.isArray(project?.teamMembers)
          ? project.teamMembers
          : [];

        const inTeam = teamMembers.some((member: any) => {
          const mid = String(member?.id || '').toLowerCase();
          const memail = String(member?.email || '').toLowerCase();
          const mname = String(member?.name || '').toLowerCase();
          return (uid && mid === uid) || (uemail && memail === uemail) || (uname && mname === uname);
        });

        // Also check if user is the creator (for backward compatibility)
        const createdBy = String(project?.createdBy || '').toLowerCase();
        const createdByMe = !!createdBy && (createdBy === uid || createdBy === uemail);

        return inTeam || createdByMe;
      });
    },
    [showMyProjectsOnly, user]
  );

  // Load active projects
  const loadActiveProjects = useCallback(async () => {
    try {
      setIsLoadingProjects(true);
      setError(null);
      const response = await fetch(`${API_BASE_URL}/api/projects/all`, {
        headers: getAuthHeaders()
      });
      if (response.ok) {
        const data = await response.json();
        const items = Array.isArray(data.projects) ? data.projects : [];
        setProjects(items);
      } else {
        const errorText = await response.text();
        console.error('Failed to load projects', errorText);
        setError('Failed to load projects');
      }
    } catch (err) {
      console.error('Failed to load projects:', err);
      setError('Failed to load projects');
    } finally {
      setIsLoadingProjects(false);
    }
  }, [getAuthHeaders]);

  // Load archived projects
  const loadArchivedProjects = useCallback(async () => {
    if (!user?.id) return;
    
    try {
      setIsLoadingArchived(true);
      setError(null);
      const response = await fetch(
        `${API_BASE_URL}/api/projects/archived?userId=${encodeURIComponent(user.id)}`,
        { headers: getAuthHeaders() }
      );
      if (response.ok) {
        const data = await response.json();
        const items = Array.isArray(data.projects) ? data.projects : [];
        setArchivedProjects(items);
      } else {
        const errorText = await response.text();
        console.error('Failed to load archived projects', errorText);
        setError('Failed to load archived projects');
        setArchivedProjects([]);
      }
    } catch (err) {
      console.error('Failed to load archived projects:', err);
      setError('Failed to load archived projects');
      setArchivedProjects([]);
    } finally {
      setIsLoadingArchived(false);
    }
  }, [user?.id, getAuthHeaders]);

  // Refresh all projects
  const refreshProjects = useCallback(async () => {
    await Promise.all([loadActiveProjects(), loadArchivedProjects()]);
  }, [loadActiveProjects, loadArchivedProjects]);

  // Filter projects by methodology
  const qualActiveProjects = useMemo(
    () => projects.filter(isQualitative),
    [projects, isQualitative]
  );

  const qualArchivedProjects = useMemo(
    () => archivedProjects.filter(isQualitative),
    [archivedProjects, isQualitative]
  );

  // Filter by user
  const filteredActiveProjects = useMemo(
    () => filterProjectsByUser(qualActiveProjects),
    [filterProjectsByUser, qualActiveProjects]
  );

  const filteredArchivedProjects = useMemo(
    () => filterProjectsByUser(qualArchivedProjects),
    [filterProjectsByUser, qualArchivedProjects]
  );

  // Display projects based on active tab
  const displayProjects = useMemo(
    () => activeTab === 'active' ? filteredActiveProjects : filteredArchivedProjects,
    [activeTab, filteredActiveProjects, filteredArchivedProjects]
  );

  // Load projects on mount and when showMyProjectsOnly changes
  useEffect(() => {
    loadActiveProjects();
  }, [loadActiveProjects, showMyProjectsOnly]);

  useEffect(() => {
    if (user?.id) {
      loadArchivedProjects();
    }
  }, [user?.id, loadArchivedProjects]);

  // Handle project navigation from session storage
  useEffect(() => {
    if (!sessionStorageKey) return;
    
    try {
      const storedProjectId = sessionStorage.getItem(`${sessionStorageKey}_focus_project`);
      const storedViewMode = sessionStorage.getItem(`${sessionStorageKey}_view_mode`);
      
      if (storedProjectId && (projects.length > 0 || archivedProjects.length > 0) && !selectedProject) {
        const allProjects = [...filteredActiveProjects, ...filteredArchivedProjects];
        const targetProject = allProjects.find(p => p.id === storedProjectId);
        if (targetProject) {
          setSelectedProject(targetProject);
          if (targetProject.archived) {
            setActiveTab('archived');
          } else {
            setActiveTab('active');
          }
          // Clear sessionStorage after using it
          sessionStorage.removeItem(`${sessionStorageKey}_focus_project`);
          sessionStorage.removeItem(`${sessionStorageKey}_view_mode`);
        }
      }
    } catch (err) {
      console.warn('Unable to read navigation target from session storage', err);
    }
  }, [projects, archivedProjects, filteredActiveProjects, filteredArchivedProjects, selectedProject, sessionStorageKey]);

  return {
    projects,
    archivedProjects,
    filteredActiveProjects,
    filteredArchivedProjects,
    displayProjects,
    selectedProject,
    setSelectedProject,
    activeTab,
    setActiveTab,
    showMyProjectsOnly,
    setShowMyProjectsOnly,
    isLoadingProjects,
    isLoadingArchived,
    error,
    loadActiveProjects,
    loadArchivedProjects,
    refreshProjects
  };
}

