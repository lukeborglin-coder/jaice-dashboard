// @ts-nocheck
import React, { useMemo, useState, useEffect, useRef, useCallback } from "react";
import { createPortal } from "react-dom";
import { API_BASE_URL } from './config';
import {
  Bars3Icon,
  PlusSmallIcon,
  PlusIcon,
  MagnifyingGlassIcon,
  CalendarIcon,
  ClipboardDocumentListIcon,
  DocumentChartBarIcon,
  PresentationChartBarIcon,
  Cog6ToothIcon,
  ArrowRightOnRectangleIcon,
  InboxStackIcon,
  CheckBadgeIcon,
  ArrowRightCircleIcon,
  WrenchScrewdriverIcon,
  DocumentArrowUpIcon,
  SparklesIcon,
  ArrowsUpDownIcon,
  CloudArrowUpIcon,
  FolderIcon,
  DocumentIcon,
  ChartBarIcon,
  ClipboardDocumentIcon,
  PencilIcon,
  HomeIcon,
  UserGroupIcon,
  UserPlusIcon,
  DocumentTextIcon,
  PlayIcon,
  RocketLaunchIcon,
  XMarkIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  ChevronDownIcon,
  ChevronUpIcon,
  ArchiveBoxIcon,
  TrashIcon,
  EllipsisVerticalIcon,
  ArchiveBoxArrowDownIcon,
  LightBulbIcon,
  ExclamationTriangleIcon,
  EyeIcon,
  BeakerIcon,
} from "@heroicons/react/24/outline";
import {
  RocketLaunchIcon as RocketLaunchIconSolid,
  PlayIcon as PlayIconSolid
} from "@heroicons/react/24/solid";
import { IconCalendarShare, IconCalendarWeek, IconBallAmericanFootball, IconRocket, IconFileAnalyticsFilled, IconLayoutSidebarFilled, IconTable, IconCheckbox, IconDatabaseExclamation, IconBook2, IconScript, IconChartBar, IconCode } from "@tabler/icons-react";
import ContentAnalysisX from "./components/ContentAnalysisX";
import Transcripts from "./components/Transcripts";
import Storytelling from "./components/Storytelling";
import QuestionnaireParser from "./components/QuestionnaireParser";
import StatTesting from "./components/StatTesting";
import OpenEndCoding from "./components/OpenEndCoding";
import AuthWrapper from "./components/AuthWrapper";
import TopBar from "./components/TopBar";
import Feedback from "./components/Feedback";
import ProjectSetupWizard from "./components/ProjectSetupWizard";
import UserSearch from "./components/UserSearch";
import CalendarPicker from "./components/CalendarPicker";
import SimpleCalendar from "./components/SimpleCalendar";
import NotificationBell from "./components/NotificationBell";
import NotificationCenter from "./components/NotificationCenter";
import { useAuth } from "./contexts/AuthContext";
import { notificationService } from "./services/notificationService";
import { Notification } from "./types/notifications";

const BRAND = { orange: "#D14A2D", gray: "#5D5F62", bg: "#F7F7F8" };

// Vendor Library Component
function VendorLibrary({ projects }: { projects: any[] }) {
  // Helper function to format dates consistently with the rest of the app
  const formatDateForDisplay = (dateString: string | undefined): string => {
    if (!dateString) return 'Invalid Date';

    try {
      // Parse the date string - handle YYYY-MM-DD format consistently using UTC
      const [year, month, day] = dateString.split('-');
      const date = new Date(Date.UTC(parseInt(year), parseInt(month) - 1, parseInt(day)));

      // Check if the date is valid
      if (isNaN(date.getTime())) {
        return 'Invalid Date';
      }

      // Format as M/D/YY using UTC methods to match key deadlines (no leading zeros)
      const monthNum = date.getUTCMonth() + 1;
      const dayNum = date.getUTCDate();
      const yearShort = date.getUTCFullYear().toString().slice(-2);

      return `${monthNum}/${dayNum}/${yearShort}`;
    } catch (error) {
      console.error('Error formatting date:', error);
      return 'Invalid Date';
    }
  };

  const [activeSection, setActiveSection] = useState<'moderators' | 'sampleVendors' | 'analytics'>('moderators');
  const [vendors, setVendors] = useState<any>({ moderators: [], sampleVendors: [], analytics: [] });
  const [loading, setLoading] = useState(true);
  const [moderatorDateRange, setModeratorDateRange] = useState('');
  const [showAddModal, setShowAddModal] = useState(false);
  const [showDetailsModal, setShowDetailsModal] = useState(false);
  const [selectedVendor, setSelectedVendor] = useState<any>(null);
  const [isEditing, setIsEditing] = useState(false);
  const [newVendor, setNewVendor] = useState({
    name: '',
    email: '',
    phone: '',
    company: '',
    specialties: [] as string[],
    notes: '',
    contacts: [] as Array<{ name: string; email: string }>
  });
  const [editingVendor, setEditingVendor] = useState({
    name: '',
    email: '',
    phone: '',
    company: '',
    specialties: [] as string[],
    notes: '',
    contacts: [] as Array<{ name: string; email: string }>
  });
  const [showScheduleModal, setShowScheduleModal] = useState(false);
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);
  const [conflictMessage, setConflictMessage] = useState('');
  const [successMessage, setSuccessMessage] = useState('');
  const [showInactiveProjects, setShowInactiveProjects] = useState(false);
  const [scheduleForm, setScheduleForm] = useState({
    startDate: '',
    endDate: '',
    type: 'booked', // 'booked' or 'pending'
    projectName: ''
  });

  const currentVendorSchedule = useMemo(() => {
    if (!selectedVendor) return [];
    if (selectedVendor.customSchedule && selectedVendor.customSchedule.length > 0) {
      return selectedVendor.customSchedule;
    }
    if (activeSection === 'moderators') {
      const match = vendors.moderators?.find((vendor: any) => vendor.id === selectedVendor.id);
      if (match?.customSchedule) {
        return match.customSchedule;
      }
    }
    return selectedVendor.customSchedule || [];
  }, [selectedVendor, vendors, activeSection]);

  const pendingDeletionEntry = useMemo(() => {
    if (!pendingDeleteId) return null;
    return currentVendorSchedule.find((entry: any) => {
      const entryId = entry.id || `${entry.startDate}-${entry.endDate}`;
      return entryId === pendingDeleteId;
    }) || null;
  }, [pendingDeleteId, currentVendorSchedule]);

  useEffect(() => {
    setPendingDeleteId(null);
    setConflictMessage('');
    setSuccessMessage('');
  }, [selectedVendor?.id]);

  // Helper: map section key to API path
  const getVendorsApiPath = (section: 'moderators' | 'sampleVendors' | 'analytics') => {
    if (section === 'moderators') return 'moderators';
    if (section === 'sampleVendors') return 'sample-vendors';
    return 'analytics';
  };

  // Load vendor data; prefer server always, fallback to localStorage if it fails
  const loadVendors = useCallback(async () => {
    setLoading(true);
    try {
      const token = localStorage.getItem('cognitive_dash_token');
      if (token) {
        const resp = await fetch(`${API_BASE_URL}/api/vendors`, {
          headers: { 'Authorization': `Bearer ${token}` }
        });
        if (resp.ok) {
          const serverData = await resp.json();
          const data = {
            moderators: serverData.moderators || [],
            sampleVendors: serverData.sampleVendors || [],
            analytics: serverData.analytics || []
          };
          localStorage.setItem('cognitive_dash_vendors', JSON.stringify(data));
          setVendors(data);
          return;
        }
      }
      // Fallback to local
      const storedVendors = localStorage.getItem('cognitive_dash_vendors');
      const fallbackData = storedVendors ? JSON.parse(storedVendors) : { moderators: [], sampleVendors: [], analytics: [] };
      setVendors(fallbackData);
    } catch (error) {
      console.error('Error loading vendors:', error);
      // Fallback to empty structure
      const initialData = {
        moderators: [],
        sampleVendors: [],
        analytics: []
      };
      setVendors(initialData);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadVendors();
  }, [loadVendors]);

  // Add new vendor (localStorage solution)
  const handleAddVendor = async () => {
    // Validation depends on vendor type
    if (activeSection === 'sampleVendors') {
      if (!newVendor.company) {
        alert('Company name is required');
        return;
      }
    } else {
      if (!newVendor.name || !newVendor.email) {
        alert('Name and email are required');
        return;
      }
    }

    try {
      const sectionKey = activeSection;
      const path = getVendorsApiPath(sectionKey as any);
      const token = localStorage.getItem('cognitive_dash_token');

      // Prepare payload based on vendor type
      const payload = activeSection === 'sampleVendors'
        ? { company: newVendor.company, contacts: newVendor.contacts, specialties: newVendor.specialties, notes: newVendor.notes }
        : newVendor;

      const resp = await fetch(`${API_BASE_URL}/api/vendors/${path}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { 'Authorization': `Bearer ${token}` } : {})
        },
        body: JSON.stringify(payload)
      });
      if (!resp.ok) {
        const err = await resp.json().catch(() => ({}));
        throw new Error(err.error || 'Failed to add vendor');
      }
      await loadVendors();
      setNewVendor({ name: '', email: '', phone: '', company: '', specialties: [], notes: '', contacts: [] });
      setShowAddModal(false);
    } catch (error) {
      console.error('Error adding vendor:', error);
      alert('Failed to add vendor');
    }
  };

  // Handle vendor click to show details
  const handleVendorClick = (vendor: any) => {
    setSelectedVendor(vendor);
    setEditingVendor({
      name: vendor.name || '',
      email: vendor.email || '',
      phone: vendor.phone || '',
      company: vendor.company || '',
      specialties: vendor.specialties || [],
      notes: vendor.notes || '',
      contacts: vendor.contacts || []
    });
    setIsEditing(false);
    setShowDetailsModal(true);
  };

  // Handle delete vendor
  const handleDeleteVendor = async () => {
    if (!selectedVendor || !confirm(`Are you sure you want to delete ${selectedVendor.name}? This action cannot be undone.`)) {
      return;
    }

    try {
      const sectionKey = activeSection;
      const path = getVendorsApiPath(sectionKey as any);
      const token = localStorage.getItem('cognitive_dash_token');
      const resp = await fetch(`${API_BASE_URL}/api/vendors/${path}/${selectedVendor.id}`, {
        method: 'DELETE',
        headers: {
          ...(token ? { 'Authorization': `Bearer ${token}` } : {})
        }
      });
      if (!resp.ok) {
        const err = await resp.json().catch(() => ({}));
        throw new Error(err.error || 'Failed to delete vendor');
      }
      await loadVendors();
      setShowDetailsModal(false);
      setSelectedVendor(null);
      setIsEditing(false);
    } catch (error) {
      console.error('Error deleting vendor:', error);
      alert('Failed to delete vendor');
    }
  };

  // Handle edit vendor
  const handleEditVendor = async () => {
    // Validation depends on vendor type
    if (activeSection === 'sampleVendors') {
      if (!editingVendor.company) {
        alert('Company name is required');
        return;
      }
    } else {
      if (!editingVendor.name || !editingVendor.email) {
        alert('Name and email are required');
        return;
      }
    }

    try {
      const sectionKey = activeSection;
      const path = getVendorsApiPath(sectionKey as any);
      const token = localStorage.getItem('cognitive_dash_token');

      // Prepare payload based on vendor type
      const payload = activeSection === 'sampleVendors'
        ? { company: editingVendor.company, contacts: editingVendor.contacts, specialties: editingVendor.specialties, notes: editingVendor.notes }
        : editingVendor;

      const resp = await fetch(`${API_BASE_URL}/api/vendors/${path}/${selectedVendor.id}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { 'Authorization': `Bearer ${token}` } : {})
        },
        body: JSON.stringify(payload)
      });
      if (!resp.ok) {
        const err = await resp.json().catch(() => ({}));
        throw new Error(err.error || 'Failed to update vendor');
      }
      await loadVendors();
      setIsEditing(false);
      setShowDetailsModal(false);
      setSelectedVendor(null);
    } catch (error) {
      console.error('Error updating vendor:', error);
      alert('Failed to update vendor');
    }
  };

  // Update vendor project history automatically
  const updateVendorProjectHistory = useCallback(() => {
    if (!projects || projects.length === 0) return;

    try {
      const storedVendors = localStorage.getItem('cognitive_dash_vendors');
      if (!storedVendors) return;

      const vendorData = JSON.parse(storedVendors);
      let hasUpdates = false;

      // Update each vendor section
      ['moderators', 'sampleVendors', 'analytics'].forEach(sectionKey => {
        vendorData[sectionKey].forEach((vendor: any) => {
          // Find projects this vendor worked on
          const vendorProjects: any[] = [];

          projects.forEach(project => {
            let isVendorInvolved = false;
            let role = '';

            if (sectionKey === 'moderators') {
              // Check if vendor is the moderator
              if (project.moderator && (
                project.moderator === vendor.id ||
                project.moderator === vendor.name ||
                project.moderator.toLowerCase() === vendor.name.toLowerCase()
              )) {
                isVendorInvolved = true;
                role = 'Moderator';
              }
            } else if (sectionKey === 'sampleVendors') {
              // Check if vendor is mentioned in project notes or other fields
              role = 'Sample Vendor';
            } else if (sectionKey === 'analytics') {
              // Check if vendor is mentioned for analytics work
              role = 'Analytics';
            }

            if (isVendorInvolved) {
              const fieldingSegment = project.segments?.find((seg: any) => seg.phase === 'Fielding');
              vendorProjects.push({
                id: project.id,
                name: project.name,
                client: project.client,
                role: role,
                startDate: fieldingSegment?.startDate || project.startDate,
                endDate: fieldingSegment?.endDate || project.endDate,
                phase: project.phase,
                methodologyType: project.methodologyType
              });
            }
          });

          // Update vendor's project history if different
          const currentHistory = vendor.projectHistory || [];
          if (JSON.stringify(currentHistory) !== JSON.stringify(vendorProjects)) {
            vendor.projectHistory = vendorProjects;
            hasUpdates = true;
          }
        });
      });

      // Save updates if any changes were made
      if (hasUpdates) {
        localStorage.setItem('cognitive_dash_vendors', JSON.stringify(vendorData));
        loadVendors(); // Refresh the vendors state
      }
    } catch (error) {
      console.error('Error updating vendor project history:', error);
    }
  }, [projects, loadVendors]);

  // Update vendor project history when projects change
  useEffect(() => {
    updateVendorProjectHistory();
  }, [updateVendorProjectHistory]);

  // Delete schedule entry for vendor
  const handleDeleteScheduleEntry = async (entryId: string) => {
    if (!selectedVendor) {
      return;
    }

    try {
      // Update on server: modify vendor's customSchedule
      const sectionKey = activeSection as 'moderators' | 'sampleVendors' | 'analytics';
      const path = getVendorsApiPath(sectionKey);
      const token = localStorage.getItem('cognitive_dash_token');

      const updatedSchedule = (selectedVendor.customSchedule || []).filter((entry: any) => {
        const key = entry.id || `${entry.startDate}-${entry.endDate}`;
        return key !== entryId;
      });
      const resp = await fetch(`${API_BASE_URL}/api/vendors/${path}/${selectedVendor.id}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { 'Authorization': `Bearer ${token}` } : {})
        },
        body: JSON.stringify({ customSchedule: updatedSchedule })
      });
      if (!resp.ok) {
        const err = await resp.json().catch(() => ({}));
        throw new Error(err.error || 'Failed to update schedule');
      }
      await loadVendors();
      setSelectedVendor((prev: any) => prev ? { ...prev, customSchedule: updatedSchedule } : prev);
      setPendingDeleteId(null);
      setSuccessMessage('Schedule entry removed.');
    } catch (error) {
      console.error('Error deleting schedule entry:', error);
      alert('Failed to delete schedule entry');
    }
  };

  // Add schedule entry for vendor
  const handleAddSchedule = async () => {
    if (!selectedVendor || !scheduleForm.startDate || !scheduleForm.endDate) {
      return;
    }

    // Check if date range is available
    const schedule = getModeratorSchedule(selectedVendor.id, selectedVendor.name);
    const newStart = new Date(scheduleForm.startDate);
    const newEnd = new Date(scheduleForm.endDate);

    // Check for conflicts with existing bookings
    const hasConflict = schedule.some(booking => {
      const bookingStart = new Date(booking.startDate);
      const bookingEnd = new Date(booking.endDate);
      return (newStart <= bookingEnd && newEnd >= bookingStart);
    });

    if (hasConflict) {
      setConflictMessage('This date range conflicts with existing bookings. Please select an available range.');
      setSuccessMessage('');
      return;
    }

    try {
      const sectionKey = activeSection as 'moderators' | 'sampleVendors' | 'analytics';
      const path = getVendorsApiPath(sectionKey);
      const token = localStorage.getItem('cognitive_dash_token');

      const scheduleEntry = {
        id: Date.now().toString(),
        startDate: scheduleForm.startDate,
        endDate: scheduleForm.endDate,
        type: scheduleForm.type,
        projectName: scheduleForm.projectName || (scheduleForm.type === 'pending' ? 'PENDING HOLD' : 'Other Project'),
        createdAt: new Date().toISOString()
      };

      const updatedSchedule = [ ...(selectedVendor.customSchedule || []), scheduleEntry ];
      const resp = await fetch(`${API_BASE_URL}/api/vendors/${path}/${selectedVendor.id}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { 'Authorization': `Bearer ${token}` } : {})
        },
        body: JSON.stringify({ customSchedule: updatedSchedule })
      });
      if (!resp.ok) {
        const err = await resp.json().catch(() => ({}));
        throw new Error(err.error || 'Failed to add schedule entry');
      }

      await loadVendors();
      setScheduleForm({ startDate: '', endDate: '', type: 'booked', projectName: '' });
      setConflictMessage('');
      setPendingDeleteId(null);
      setSuccessMessage('Schedule entry added successfully.');
    } catch (error) {
      console.error('Error adding schedule entry:', error);
    }
  };

  // Get moderator schedule from projects
  const getModeratorSchedule = (moderatorId: string, moderatorName: string) => {
    try {
      let projectsToCheck: any[] = [];

      // First, try to use the projects prop from the main app
      if (projects && projects.length > 0) {
        projectsToCheck = projects;
      } else {
        // Try different localStorage keys where projects might be stored
        const projectStorageKeys = ['cognitive_dash_projects', 'projects', 'project_data'];

        for (const key of projectStorageKeys) {
          const storedProjects = localStorage.getItem(key);
          if (storedProjects) {
            try {
              const parsedProjects = JSON.parse(storedProjects);
              if (Array.isArray(parsedProjects)) {
                projectsToCheck = parsedProjects;
                break;
              } else if (parsedProjects.projects && Array.isArray(parsedProjects.projects)) {
                projectsToCheck = parsedProjects.projects;
                break;
              }
            } catch (e) {
              // Continue to next key
            }
          }
        }
      }

      // If no projects found anywhere
      if (projectsToCheck.length === 0) {
        return [];
      }

      const schedule: any[] = [];

      projectsToCheck.forEach((project: any) => {
        // More comprehensive moderator matching
        const projectModerator = project.moderator;
        const isModeratorMatch = projectModerator && (
          projectModerator === moderatorId ||
          projectModerator === moderatorName ||
          (typeof projectModerator === 'string' && (
            projectModerator.toLowerCase() === moderatorName.toLowerCase() ||
            projectModerator.toLowerCase() === moderatorId.toLowerCase()
          ))
        );

        if (isModeratorMatch) {
          // Find the fielding segment for this project
          const fieldingSegment = project.segments?.find((seg: any) => seg.phase === 'Fielding');

          if (fieldingSegment) {
            const booking = {
              projectName: project.name || project.title,
              client: project.client,
              startDate: fieldingSegment.startDate,
              endDate: fieldingSegment.endDate,
              phase: project.phase || 'Unknown'
            };
            schedule.push(booking);
          }
        }
      });

      // Add custom schedule entries from vendor data
      try {
        const storedVendors = localStorage.getItem('cognitive_dash_vendors');
        if (storedVendors) {
          const vendorData = JSON.parse(storedVendors);
          const moderatorVendor = vendorData.moderators?.find((vendor: any) =>
            vendor.id === moderatorId || vendor.name === moderatorName ||
            vendor.name?.toLowerCase() === moderatorName.toLowerCase()
          );

          if (moderatorVendor && moderatorVendor.customSchedule) {
            moderatorVendor.customSchedule.forEach((customEntry: any) => {
              schedule.push({
                id: customEntry.id, // Include the ID so it can be deleted
                projectName: customEntry.projectName,
                client: customEntry.type === 'pending' ? 'PENDING' : 'Custom',
                startDate: customEntry.startDate,
                endDate: customEntry.endDate,
                phase: customEntry.type === 'pending' ? 'PENDING HOLD' : 'Booked',
                type: customEntry.type // Add type to distinguish pending vs booked
              });
            });
          }
        }
      } catch (error) {
        console.warn('Error loading custom schedule entries:', error);
      }

      // Sort by start date
      return schedule.sort((a, b) => new Date(a.startDate).getTime() - new Date(b.startDate).getTime());
    } catch (error) {
      console.error('Error getting moderator schedule:', error);
      return [];
    }
  };

  // Get vendor's active and archived projects
  const getVendorProjects = (vendorId: string, vendorCompany?: string) => {
    const activeProjects: any[] = [];
    const archivedProjects: any[] = [];

    projects.forEach((project: any) => {
      let isVendorInProject = false;

      // Check different vendor fields based on the active section
      if (activeSection === 'sampleVendors') {
        // For sample vendors, check if company matches or vendor ID is in sampleProvider field
        if (vendorCompany && (
          project.sampleProvider === vendorId ||
          project.sampleProvider === vendorCompany ||
          (typeof project.sampleProvider === 'string' &&
            project.sampleProvider.toLowerCase() === vendorCompany.toLowerCase())
        )) {
          isVendorInProject = true;
        }
      } else if (activeSection === 'moderators') {
        // For moderators, check moderator field
        if (project.moderator === vendorId ||
            (typeof project.moderator === 'string' &&
              project.moderator.toLowerCase() === (selectedVendor?.name || '').toLowerCase())) {
          isVendorInProject = true;
        }
      } else if (activeSection === 'analytics') {
        // For analytics, check analyticsPartner field
        if (project.analyticsPartner === vendorId ||
            (typeof project.analyticsPartner === 'string' &&
              project.analyticsPartner.toLowerCase() === (selectedVendor?.name || '').toLowerCase())) {
          isVendorInProject = true;
        }
      }

      if (isVendorInProject) {
        if (project.archived) {
          archivedProjects.push(project);
        } else {
          activeProjects.push(project);
        }
      }
    });

    return { activeProjects, archivedProjects };
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-gray-500">Loading vendor library...</div>
      </div>
    );
  }

  const currentVendors = vendors[activeSection] || [];

  return (
    <div className="space-y-6">
      {/* Section Navigation */}
      <div className="border-b border-gray-200">
        <nav className="-mb-px flex space-x-8">
          <button
            onClick={() => setActiveSection('moderators')}
            className={`py-2 px-1 border-b-2 font-medium text-sm ${
              activeSection === 'moderators'
                ? 'text-white'
                : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
            }`}
            style={activeSection === 'moderators' ? { borderBottomColor: BRAND.orange, color: BRAND.orange } : {}}
          >
            <div className="flex items-center gap-2">
              <UserGroupIcon className="w-5 h-5" />
              Moderators ({vendors.moderators?.length || 0})
            </div>
          </button>
          <button
            onClick={() => setActiveSection('sampleVendors')}
            className={`py-2 px-1 border-b-2 font-medium text-sm ${
              activeSection === 'sampleVendors'
                ? 'text-white'
                : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
            }`}
            style={activeSection === 'sampleVendors' ? { borderBottomColor: BRAND.orange, color: BRAND.orange } : {}}
          >
            <div className="flex items-center gap-2">
              <UserPlusIcon className="w-5 h-5" />
              Sample Vendors ({vendors.sampleVendors?.length || 0})
            </div>
          </button>
          <button
            onClick={() => setActiveSection('analytics')}
            className={`py-2 px-1 border-b-2 font-medium text-sm ${
              activeSection === 'analytics'
                ? 'text-white'
                : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
            }`}
            style={activeSection === 'analytics' ? { borderBottomColor: BRAND.orange, color: BRAND.orange } : {}}
          >
            <div className="flex items-center gap-2">
              <ChartBarIcon className="w-5 h-5" />
              Analytics ({vendors.analytics?.length || 0})
            </div>
          </button>
        </nav>
      </div>

      {/* Section Title with Add Button */}
      <div className="flex items-center gap-4">
        <h2 className="text-lg font-semibold text-gray-900">
          {activeSection === 'moderators' ? 'Moderators' :
           activeSection === 'sampleVendors' ? 'Sample Vendors' : 'Analytics Partners'}
        </h2>
        <button
          onClick={() => setShowAddModal(true)}
          className="flex items-center gap-1 rounded-lg px-3 py-1 text-xs shadow-sm transition-colors text-white hover:opacity-90"
          style={{ backgroundColor: BRAND.orange }}
        >
          <PlusSmallIcon className="h-4 w-4" />
          Add {activeSection === 'moderators' ? 'Moderator' :
               activeSection === 'sampleVendors' ? 'Sample Vendor' : 'Analytics Partner'}
        </button>
      </div>

      {/* Vendors Table */}
      <div className="bg-white shadow-sm border border-gray-200 rounded-lg overflow-hidden">
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                {activeSection === 'sampleVendors' ? (
                  <>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Company
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Contacts
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Specialties
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Added
                    </th>
                  </>
                ) : (
                  <>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Contact
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Company
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Email
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Phone
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Specialties
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Added
                    </th>
                  </>
                )}
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {currentVendors.length === 0 ? (
                <tr>
                  <td colSpan={activeSection === 'sampleVendors' ? 4 : 6} className="px-6 py-12 text-center">
                    <UserGroupIcon className="mx-auto h-12 w-12 text-gray-400" />
                    <h3 className="mt-2 text-sm font-medium text-gray-900">No vendors found</h3>
                    <p className="mt-1 text-sm text-gray-500">Get started by adding your first vendor.</p>
                  </td>
                </tr>
              ) : (
                currentVendors
                  .sort((a: any, b: any) => {
                    if (activeSection === 'moderators') {
                      return a.name.localeCompare(b.name);
                    }
                    return 0;
                  })
                  .map((vendor: any) => (
                  <tr
                    key={vendor.id}
                    className="hover:bg-gray-50 cursor-pointer"
                    onClick={() => handleVendorClick(vendor)}
                  >
                    {activeSection === 'sampleVendors' ? (
                      <>
                        <td className="px-6 py-4 whitespace-nowrap">
                          <div className="text-sm font-medium text-gray-900">{vendor.company}</div>
                        </td>
                        <td className="px-6 py-4">
                          <div className="text-sm text-gray-900">
                            {vendor.contacts && vendor.contacts.length > 0 ? (
                              <div className="space-y-1">
                                {vendor.contacts.slice(0, 2).map((contact: any, idx: number) => (
                                  <div key={idx}>{contact.name}</div>
                                ))}
                                {vendor.contacts.length > 2 && (
                                  <div className="text-xs text-gray-500">+{vendor.contacts.length - 2} more</div>
                                )}
                              </div>
                            ) : (
                              <span className="text-gray-500 italic">No contacts</span>
                            )}
                          </div>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap">
                          <div className="flex flex-wrap gap-1">
                            {vendor.specialties && vendor.specialties.length > 0 ? (
                              vendor.specialties.slice(0, 3).map((specialty: string, index: number) => (
                                <span key={index} className="px-0.5 sm:px-1 md:px-2 py-1 text-xs rounded-full text-white opacity-60" style={{ backgroundColor: '#3B82F6' }}>
                                  {specialty}
                                </span>
                              ))
                            ) : (
                              <span className="text-sm text-gray-500">-</span>
                            )}
                            {vendor.specialties && vendor.specialties.length > 3 && (
                              <span className="text-xs text-gray-500">+{vendor.specialties.length - 3} more</span>
                            )}
                          </div>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap">
                          <div className="text-sm text-gray-500">
                            {new Date(vendor.createdAt).toLocaleDateString()}
                          </div>
                        </td>
                      </>
                    ) : (
                      <>
                        <td className="px-6 py-4 whitespace-nowrap">
                          <div className="text-sm font-medium text-gray-900">{vendor.name}</div>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap">
                          <div className="text-sm text-gray-900">{vendor.company || '-'}</div>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap">
                          <div className="text-sm text-gray-900">{vendor.email}</div>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap">
                          <div className="text-sm text-gray-900">{vendor.phone || '-'}</div>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap">
                          <div className="flex flex-wrap gap-1">
                            {vendor.specialties && vendor.specialties.length > 0 ? (
                              vendor.specialties.slice(0, 3).map((specialty: string, index: number) => (
                                <span key={index} className="px-0.5 sm:px-1 md:px-2 py-1 text-xs rounded-full text-white opacity-60" style={{ backgroundColor: '#3B82F6' }}>
                                  {specialty}
                                </span>
                              ))
                            ) : (
                              <span className="text-sm text-gray-500">-</span>
                            )}
                            {vendor.specialties && vendor.specialties.length > 3 && (
                              <span className="text-xs text-gray-500">+{vendor.specialties.length - 3} more</span>
                            )}
                          </div>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap">
                          <div className="text-sm text-gray-500">
                            {new Date(vendor.createdAt).toLocaleDateString()}
                          </div>
                        </td>
                      </>
                    )}
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Moderator Schedule - only show for moderators section */}
      {activeSection === 'moderators' && (
        <div className="mt-6">
          <Card className="!p-0 overflow-hidden flex flex-col">
            {/* Full-width header bar inside card */}
            <div style={{ backgroundColor: BRAND.gray }} className="text-white">
              <div className="flex items-center justify-between px-4 py-2">
                <div className="flex items-center gap-2">
                  <UserGroupIcon className="h-6 w-6 text-white" />
                  <span className="text-lg font-semibold">Moderator Schedule</span>
                </div>
                <span className="text-sm font-medium italic text-white/90">{moderatorDateRange}</span>
              </div>
            </div>

            <div className="p-4">
              <ModeratorTimeline projects={projects} moderators={vendors?.moderators} onDateRangeChange={setModeratorDateRange} />
            </div>
          </Card>
        </div>
      )}


      {/* Add Vendor Modal */}
      {showAddModal && createPortal(
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-[10100]" style={{ margin: 0, padding: 0, top: 0, left: 0, right: 0, bottom: 0 }}>
          <div className="bg-white rounded-lg p-6 w-full max-h-[90vh] overflow-y-auto" style={{ maxWidth: activeSection === 'sampleVendors' ? '600px' : '500px', margin: '2rem' }}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold">Add New {activeSection === 'moderators' ? 'Moderator' : activeSection === 'sampleVendors' ? 'Sample Vendor' : 'Analytics Partner'}</h3>
              <button
                onClick={() => setShowAddModal(false)}
                className="text-gray-400 hover:text-gray-600"
              >
                <XMarkIcon className="w-5 h-5" />
              </button>
            </div>

            {activeSection === 'sampleVendors' ? (
              // Sample Vendor Form
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Company Name *</label>
                  <input
                    type="text"
                    value={newVendor.company}
                    onChange={(e) => setNewVendor(prev => ({ ...prev, company: e.target.value }))}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2"
                    style={{ '--tw-ring-color': BRAND.orange } as any}
                    placeholder="Company name"
                  />
                </div>

                <div>
                  <div className="flex items-center justify-between mb-2">
                    <label className="block text-sm font-medium text-gray-700">Contacts</label>
                    <button
                      type="button"
                      onClick={() => setNewVendor(prev => ({ ...prev, contacts: [...prev.contacts, { name: '', email: '' }] }))}
                      className="text-sm px-0.5 sm:px-1 md:px-2 py-1 rounded hover:bg-gray-100"
                      style={{ color: BRAND.orange }}
                    >
                      + Add Contact
                    </button>
                  </div>
                  <div className="space-y-3">
                    {newVendor.contacts.map((contact, index) => (
                      <div key={index} className="flex gap-2 items-start p-3 border border-gray-200 rounded-md">
                        <div className="flex-1 space-y-2">
                          <input
                            type="text"
                            value={contact.name}
                            onChange={(e) => {
                              const updated = [...newVendor.contacts];
                              updated[index].name = e.target.value;
                              setNewVendor(prev => ({ ...prev, contacts: updated }));
                            }}
                            className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2"
                            style={{ '--tw-ring-color': BRAND.orange } as any}
                            placeholder="Contact name"
                          />
                          <input
                            type="email"
                            value={contact.email}
                            onChange={(e) => {
                              const updated = [...newVendor.contacts];
                              updated[index].email = e.target.value;
                              setNewVendor(prev => ({ ...prev, contacts: updated }));
                            }}
                            className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2"
                            style={{ '--tw-ring-color': BRAND.orange } as any}
                            placeholder="Contact email"
                          />
                        </div>
                        <button
                          type="button"
                          onClick={() => {
                            const updated = newVendor.contacts.filter((_, i) => i !== index);
                            setNewVendor(prev => ({ ...prev, contacts: updated }));
                          }}
                          className="text-red-500 hover:text-red-700 p-1"
                        >
                          <XMarkIcon className="w-5 h-5" />
                        </button>
                      </div>
                    ))}
                  </div>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Specialties</label>
                  <div className="space-y-2">
                    <input
                      type="text"
                      placeholder="Add specialty and press Enter"
                      className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2"
                      style={{ '--tw-ring-color': BRAND.orange } as any}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && e.currentTarget.value.trim()) {
                          e.preventDefault();
                          const specialty = e.currentTarget.value.trim();
                          if (!newVendor.specialties.includes(specialty)) {
                            setNewVendor(prev => ({
                              ...prev,
                              specialties: [...prev.specialties, specialty]
                            }));
                          }
                          e.currentTarget.value = '';
                        }
                      }}
                    />
                    {newVendor.specialties.length > 0 && (
                      <div className="flex flex-wrap gap-2">
                        {newVendor.specialties.map((specialty, index) => (
                          <span
                            key={index}
                            className="inline-flex items-center gap-1 px-3 py-1 text-sm rounded-full text-white"
                            style={{ backgroundColor: '#3B82F6', opacity: 0.8 }}
                          >
                            {specialty}
                            <button
                              type="button"
                              onClick={() => {
                                setNewVendor(prev => ({
                                  ...prev,
                                  specialties: prev.specialties.filter((_, i) => i !== index)
                                }));
                              }}
                              className="ml-1 text-white hover:text-gray-200"
                            >
                              ×
                            </button>
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Notes</label>
                  <textarea
                    value={newVendor.notes}
                    onChange={(e) => setNewVendor(prev => ({ ...prev, notes: e.target.value }))}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2"
                    style={{ '--tw-ring-color': BRAND.orange } as any}
                    rows={3}
                    placeholder="Additional notes..."
                  />
                </div>
              </div>
            ) : (
              // Moderator/Analytics Form
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Name *</label>
                  <input
                    type="text"
                    value={newVendor.name}
                    onChange={(e) => setNewVendor(prev => ({ ...prev, name: e.target.value }))}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2"
                    style={{ '--tw-ring-color': BRAND.orange } as any}
                    placeholder="Vendor name"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Email *</label>
                  <input
                    type="email"
                    value={newVendor.email}
                    onChange={(e) => setNewVendor(prev => ({ ...prev, email: e.target.value }))}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2"
                    style={{ '--tw-ring-color': BRAND.orange } as any}
                    placeholder="vendor@example.com"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Phone</label>
                  <input
                    type="tel"
                    value={newVendor.phone}
                    onChange={(e) => setNewVendor(prev => ({ ...prev, phone: e.target.value }))}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2"
                    style={{ '--tw-ring-color': BRAND.orange } as any}
                    placeholder="Phone number"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Company</label>
                  <input
                    type="text"
                    value={newVendor.company}
                    onChange={(e) => setNewVendor(prev => ({ ...prev, company: e.target.value }))}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2"
                    style={{ '--tw-ring-color': BRAND.orange } as any}
                    placeholder="Company name"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Specialties</label>
                  <div className="space-y-2">
                    <input
                      type="text"
                      placeholder="Add specialty and press Enter"
                      className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2"
                      style={{ '--tw-ring-color': BRAND.orange } as any}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && e.currentTarget.value.trim()) {
                          e.preventDefault();
                          const specialty = e.currentTarget.value.trim();
                          if (!newVendor.specialties.includes(specialty)) {
                            setNewVendor(prev => ({
                              ...prev,
                              specialties: [...prev.specialties, specialty]
                            }));
                          }
                          e.currentTarget.value = '';
                        }
                      }}
                    />
                    {newVendor.specialties.length > 0 && (
                      <div className="flex flex-wrap gap-2">
                        {newVendor.specialties.map((specialty, index) => (
                          <span
                            key={index}
                            className="inline-flex items-center gap-1 px-3 py-1 text-sm rounded-full text-white"
                            style={{ backgroundColor: '#3B82F6', opacity: 0.8 }}
                          >
                            {specialty}
                            <button
                              type="button"
                              onClick={() => {
                                setNewVendor(prev => ({
                                  ...prev,
                                  specialties: prev.specialties.filter((_, i) => i !== index)
                                }));
                              }}
                              className="ml-1 text-white hover:text-gray-200"
                            >
                              ×
                            </button>
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Notes</label>
                  <textarea
                    value={newVendor.notes}
                    onChange={(e) => setNewVendor(prev => ({ ...prev, notes: e.target.value }))}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2"
                    style={{ '--tw-ring-color': BRAND.orange } as any}
                    rows={3}
                    placeholder="Additional notes..."
                  />
                </div>
              </div>
            )}

            <div className="flex justify-end gap-3 mt-6">
              <button
                type="button"
                onClick={() => setShowAddModal(false)}
                className="px-4 py-2 text-gray-700 border border-gray-300 rounded-md hover:bg-gray-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleAddVendor}
                className="px-4 py-2 text-white rounded-md hover:opacity-90 transition-colors"
                style={{ backgroundColor: BRAND.orange }}
              >
                Add Vendor
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}

      {/* Vendor Details Modal */}
      {showDetailsModal && selectedVendor && createPortal(
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-[10100]" style={{ margin: 0, padding: 0, top: 0, left: 0, right: 0, bottom: 0 }}>
          <div className="bg-white rounded-lg p-6 w-full h-full max-w-7xl max-h-[95vh] overflow-y-auto" style={{ margin: '2rem' }}>
            <div className="flex items-center justify-between mb-6">
              <h3 className="text-xl font-semibold text-gray-900">
                {activeSection === 'sampleVendors' ? selectedVendor.company : selectedVendor.name}
              </h3>
              <div className="flex items-center gap-2">
                {!isEditing && (
                  <button
                    onClick={() => setIsEditing(true)}
                    className="px-4 py-2 text-white rounded-md hover:opacity-90 transition-colors"
                    style={{ backgroundColor: BRAND.orange }}
                  >
                    Edit
                  </button>
                )}
                <button
                  onClick={() => {
                    setShowDetailsModal(false);
                    setSelectedVendor(null);
                    setIsEditing(false);
                  }}
                  className="text-gray-400 hover:text-gray-600"
                >
                  <XMarkIcon className="w-6 h-6" />
                </button>
              </div>
            </div>

            {/* Vendor Details */}
            <div className="space-y-6">
              {isEditing ? (
                // Edit Form
                <div className="space-y-4">
                  {activeSection === 'sampleVendors' ? (
                    // Sample Vendor Edit Form
                    <>
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">Company Name *</label>
                        <input
                          type="text"
                          value={editingVendor.company}
                          onChange={(e) => setEditingVendor(prev => ({ ...prev, company: e.target.value }))}
                          className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2"
                          style={{ '--tw-ring-color': BRAND.orange } as any}
                        />
                      </div>

                      <div>
                        <div className="flex items-center justify-between mb-2">
                          <label className="block text-sm font-medium text-gray-700">Contacts</label>
                          <button
                            type="button"
                            onClick={() => setEditingVendor(prev => ({ ...prev, contacts: [...prev.contacts, { name: '', email: '' }] }))}
                            className="text-sm px-0.5 sm:px-1 md:px-2 py-1 rounded hover:bg-gray-100"
                            style={{ color: BRAND.orange }}
                          >
                            + Add Contact
                          </button>
                        </div>
                        <div className="space-y-3">
                          {editingVendor.contacts.map((contact, index) => (
                            <div key={index} className="flex gap-2 items-start p-3 border border-gray-200 rounded-md">
                              <div className="flex-1 space-y-2">
                                <input
                                  type="text"
                                  value={contact.name}
                                  onChange={(e) => {
                                    const updated = [...editingVendor.contacts];
                                    updated[index].name = e.target.value;
                                    setEditingVendor(prev => ({ ...prev, contacts: updated }));
                                  }}
                                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2"
                                  style={{ '--tw-ring-color': BRAND.orange } as any}
                                  placeholder="Contact name"
                                />
                                <input
                                  type="email"
                                  value={contact.email}
                                  onChange={(e) => {
                                    const updated = [...editingVendor.contacts];
                                    updated[index].email = e.target.value;
                                    setEditingVendor(prev => ({ ...prev, contacts: updated }));
                                  }}
                                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2"
                                  style={{ '--tw-ring-color': BRAND.orange } as any}
                                  placeholder="Contact email"
                                />
                              </div>
                              <button
                                type="button"
                                onClick={() => {
                                  const updated = editingVendor.contacts.filter((_, i) => i !== index);
                                  setEditingVendor(prev => ({ ...prev, contacts: updated }));
                                }}
                                className="text-red-500 hover:text-red-700 p-1"
                              >
                                <XMarkIcon className="w-5 h-5" />
                              </button>
                            </div>
                          ))}
                        </div>
                      </div>
                    </>
                  ) : (
                    // Moderator/Analytics Edit Form
                    <>
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">Name *</label>
                        <input
                          type="text"
                          value={editingVendor.name}
                          onChange={(e) => setEditingVendor(prev => ({ ...prev, name: e.target.value }))}
                          className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2"
                          style={{ '--tw-ring-color': BRAND.orange } as any}
                        />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">Email *</label>
                        <input
                          type="email"
                          value={editingVendor.email}
                          onChange={(e) => setEditingVendor(prev => ({ ...prev, email: e.target.value }))}
                          className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2"
                          style={{ '--tw-ring-color': BRAND.orange } as any}
                        />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">Phone</label>
                        <input
                          type="tel"
                          value={editingVendor.phone}
                          onChange={(e) => setEditingVendor(prev => ({ ...prev, phone: e.target.value }))}
                          className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2"
                          style={{ '--tw-ring-color': BRAND.orange } as any}
                        />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">Company</label>
                        <input
                          type="text"
                          value={editingVendor.company}
                          onChange={(e) => setEditingVendor(prev => ({ ...prev, company: e.target.value }))}
                          className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2"
                          style={{ '--tw-ring-color': BRAND.orange } as any}
                        />
                      </div>
                    </>
                  )}

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Specialties</label>
                    <div className="space-y-2">
                      <input
                        type="text"
                        placeholder="Add specialty and press Enter"
                        className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2"
                        style={{ '--tw-ring-color': BRAND.orange } as any}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' && e.currentTarget.value.trim()) {
                            e.preventDefault();
                            const specialty = e.currentTarget.value.trim();
                            if (!editingVendor.specialties.includes(specialty)) {
                              setEditingVendor(prev => ({
                                ...prev,
                                specialties: [...prev.specialties, specialty]
                              }));
                            }
                            e.currentTarget.value = '';
                          }
                        }}
                      />
                      {editingVendor.specialties.length > 0 && (
                        <div className="flex flex-wrap gap-2">
                          {editingVendor.specialties.map((specialty, index) => (
                            <span
                              key={index}
                              className="inline-flex items-center gap-1 px-3 py-1 text-sm rounded-full text-white"
                              style={{ backgroundColor: '#3B82F6', opacity: 0.8 }}
                            >
                              {specialty}
                              <button
                                type="button"
                                onClick={() => {
                                  setEditingVendor(prev => ({
                                    ...prev,
                                    specialties: prev.specialties.filter((_, i) => i !== index)
                                  }));
                                }}
                                className="ml-1 text-white hover:text-gray-200"
                              >
                                ×
                              </button>
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Notes</label>
                    <textarea
                      value={editingVendor.notes}
                      onChange={(e) => setEditingVendor(prev => ({ ...prev, notes: e.target.value }))}
                      className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2"
                      style={{ '--tw-ring-color': BRAND.orange } as any}
                      rows={4}
                    />
                  </div>
                  <div className="flex justify-between">
                    <button
                      onClick={handleDeleteVendor}
                      className="px-4 py-2 text-white bg-red-600 rounded-md hover:bg-red-700 transition-colors"
                    >
                      Delete Contact
                    </button>
                    <div className="flex gap-3">
                      <button
                        onClick={() => setIsEditing(false)}
                        className="px-4 py-2 text-gray-700 border border-gray-300 rounded-md hover:bg-gray-50"
                      >
                        Cancel
                      </button>
                      <button
                        onClick={handleEditVendor}
                        className="px-4 py-2 text-white rounded-md hover:opacity-90 transition-colors"
                        style={{ backgroundColor: BRAND.orange }}
                      >
                        Save Changes
                      </button>
                    </div>
                  </div>
                </div>
              ) : (
                // View Details
                <div className="space-y-6">
                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                    <div className="space-y-6">
                      {/* Contact Information for Moderators/Analytics */}
                      {activeSection !== 'sampleVendors' && (
                        <div>
                          <h4 className="text-sm font-medium text-gray-600 uppercase tracking-wide mb-3">Contact Information</h4>
                          <div className="space-y-2">
                            <div>
                              <span className="text-sm font-medium text-gray-700">Email:</span>
                              <span className="ml-2 text-sm text-gray-900">{selectedVendor.email}</span>
                            </div>
                            <div>
                              <span className="text-sm font-medium text-gray-700">Phone:</span>
                              <span className={`ml-2 text-sm ${selectedVendor.phone ? 'text-gray-900' : 'text-gray-500 italic'}`}>
                                {selectedVendor.phone || 'N/A'}
                              </span>
                            </div>
                            <div>
                              <span className="text-sm font-medium text-gray-700">Company:</span>
                              <span className={`ml-2 text-sm ${selectedVendor.company ? 'text-gray-900' : 'text-gray-500 italic'}`}>
                                {selectedVendor.company || 'N/A'}
                              </span>
                            </div>
                          </div>
                        </div>
                      )}

                      {/* Contacts for Sample Vendors */}
                      {activeSection === 'sampleVendors' && (
                        <div>
                          <h4 className="text-sm font-medium text-gray-600 uppercase tracking-wide mb-3">Contacts</h4>
                          {selectedVendor.contacts && selectedVendor.contacts.length > 0 ? (
                            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                              {selectedVendor.contacts.map((contact: any, index: number) => (
                                <div key={index} className="rounded-lg border border-gray-200 bg-white p-3 shadow-sm">
                                  <div className="text-sm font-medium text-gray-900">{contact.name}</div>
                                  <a
                                    href={`mailto:${contact.email}`}
                                    className="text-xs text-blue-600 break-words hover:underline"
                                  >
                                    {contact.email}
                                  </a>
                                </div>
                              ))}
                            </div>
                          ) : (
                            <p className="text-sm text-gray-500 italic">No contacts added</p>
                          )}
                        </div>
                      )}

                      {/* Specialties */}
                      {selectedVendor.specialties && selectedVendor.specialties.length > 0 && (
                        <div>
                          <h4 className="text-sm font-medium text-gray-600 uppercase tracking-wide mb-3">Specialties</h4>
                          <div className="flex flex-wrap gap-2">
                            {selectedVendor.specialties.map((specialty: string, index: number) => (
                              <span
                                key={index}
                                className="px-3 py-1 text-sm rounded-full text-white"
                                style={{ backgroundColor: '#3B82F6', opacity: 0.8 }}
                              >
                                {specialty}
                              </span>
                            ))}
                          </div>
                        </div>
                      )}

                      {/* Notes */}
                      <div>
                        <h4 className="text-sm font-medium text-gray-600 uppercase tracking-wide mb-3">Notes</h4>
                        <div className="p-4 bg-gray-50 rounded-lg">
                          <p className={`text-sm whitespace-pre-wrap ${selectedVendor.notes ? 'text-gray-900' : 'text-gray-500 italic'}`}>
                            {selectedVendor.notes || 'No notes'}
                          </p>
                        </div>
                      </div>
                    </div>

                    {/* Right Column - Projects */}
                    <div className="space-y-6">
                      {(() => {
                        const { activeProjects, archivedProjects } = getVendorProjects(
                          selectedVendor.id,
                          selectedVendor.company
                        );

                        return (
                          <>
                            {/* Active Projects */}
                            <div>
                              <h4 className="text-sm font-medium text-gray-600 uppercase tracking-wide mb-3">
                                Active Projects ({activeProjects.length})
                              </h4>
                              {activeProjects.length > 0 ? (
                                <div className="space-y-2">
                                  {activeProjects.map((project: any) => (
                                    <div key={project.id} className="p-3 bg-green-50 border border-green-100 rounded-lg">
                                      <div className="text-sm font-medium text-gray-900">{project.name}</div>
                                      <div className="text-xs text-gray-600 mt-1">
                                        {project.client} • {project.methodologyType}
                                      </div>
                                      <div className="text-xs text-gray-500 mt-1">
                                        Phase: {getPhaseDisplayName(project.phase)}
                                      </div>
                                    </div>
                                  ))}
                                </div>
                              ) : (
                                <p className="text-sm text-gray-500 italic">No active projects</p>
                              )}
                            </div>

                            {/* Inactive/Archived Projects */}
                            <div>
                              <button
                                onClick={() => setShowInactiveProjects(!showInactiveProjects)}
                                className="flex items-center justify-between w-full text-left mb-3"
                              >
                                <h4 className="text-sm font-medium text-gray-600 uppercase tracking-wide">
                                  Inactive Projects ({archivedProjects.length})
                                </h4>
                                <svg
                                  className={`w-5 h-5 text-gray-500 transition-transform ${showInactiveProjects ? 'rotate-180' : ''}`}
                                  fill="none"
                                  stroke="currentColor"
                                  viewBox="0 0 24 24"
                                >
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                                </svg>
                              </button>
                              {showInactiveProjects && (
                                archivedProjects.length > 0 ? (
                                  <div className="space-y-2">
                                    {archivedProjects.map((project: any) => (
                                      <div key={project.id} className="p-3 bg-gray-100 border border-gray-200 rounded-lg">
                                        <div className="text-sm font-medium text-gray-700">{project.name}</div>
                                        <div className="text-xs text-gray-600 mt-1">
                                          {project.client} • {project.methodologyType}
                                        </div>
                                        <div className="text-xs text-gray-500 mt-1">
                                          Archived
                                        </div>
                                      </div>
                                    ))}
                                  </div>
                                ) : (
                                  <p className="text-sm text-gray-500 italic">No archived projects</p>
                                )
                              )}
                            </div>
                          </>
                        );
                      })()}
                    </div>
                  </div>

                  {/* Moderator Schedule (only for moderators) */}
                  {activeSection === 'moderators' && (
                    <div>
                      <div className="flex items-center justify-between mb-2">
                        <h4 className="text-sm font-medium text-gray-600 uppercase tracking-wide">Current Schedule</h4>
                        <button
                          onClick={() => { setConflictMessage(''); setSuccessMessage(''); setShowScheduleModal(true); }}
                          className="text-sm text-blue-600 hover:text-blue-800 underline"
                        >
                          Add to schedule
                        </button>
                      </div>
                      {(() => {
                        const schedule = getModeratorSchedule(selectedVendor.id, selectedVendor.name);
                        return schedule.length > 0 ? (
                          <div className="space-y-3">
                            {schedule.map((booking, index) => (
                              <div key={index} className="flex items-center justify-between p-3 bg-purple-50 rounded-lg">
                                <div>
                                  <div className="text-sm font-medium text-gray-900">{booking.projectName}</div>
                                  <div className="text-sm text-gray-600">{booking.client}</div>
                                </div>
                                <div className="flex items-center gap-3">
                                  <div className="text-right">
                                    <div className="text-sm font-medium text-gray-900">
                                      {formatDateForDisplay(booking.startDate)} - {formatDateForDisplay(booking.endDate)}
                                    </div>
                                  </div>
                                  {booking.type && (
                                    <button
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        setPendingDeleteId(booking.id || `${booking.startDate}-${booking.endDate}`);
                                        setSuccessMessage('');
                                        setConflictMessage('');
                                      }}
                                      className="p-1 text-red-600 hover:text-red-800 hover:bg-red-100 rounded"
                                      title="Remove from schedule"
                                    >
                                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                                      </svg>
                                    </button>
                                  )}
                                </div>
                              </div>
                            ))}
                          </div>
                        ) : (
                          <p className="text-sm text-gray-500 italic">No current bookings</p>
                        );
                      })()}
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>,
        document.body
      )}

      {/* Schedule Modal */}
      {showScheduleModal && selectedVendor && createPortal(
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-start justify-center overflow-y-auto py-8 z-[10100]">
          <div className="bg-white rounded-lg p-6 max-w-md w-full mx-4 my-auto">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold">Add to Schedule</h3>
              <button
                onClick={() => { setShowScheduleModal(false); setConflictMessage(''); setSuccessMessage(''); setPendingDeleteId(null); }}
                className="text-gray-400 hover:text-gray-600"
              >
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            <div className="space-y-4">
              <div className="text-sm text-gray-600 mb-4">
                Adding schedule entry for: <span className="font-medium">{selectedVendor.name}</span>
              </div>

              {conflictMessage && (
                <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-600">
                  {conflictMessage}
                </div>
              )}

              {successMessage && (
                <div className="rounded-md border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-700">
                  {successMessage}
                </div>
              )}

              {pendingDeletionEntry && (
                <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-3 text-sm text-amber-700 space-y-3">
                  <p>Remove the hold for <span className="font-semibold">{pendingDeletionEntry.projectName || 'this project'}</span> scheduled {formatDateForDisplay(pendingDeletionEntry.startDate)} - {formatDateForDisplay(pendingDeletionEntry.endDate)}?</p>
                  <div className="flex gap-3">
                    <button
                      onClick={() => { setPendingDeleteId(null); setSuccessMessage(''); }}
                      className="flex-1 rounded-md border border-amber-300 px-4 py-2 text-amber-700 hover:bg-amber-100 transition"
                    >
                      Keep Booking
                    </button>
                    <button
                      onClick={async () => { if (pendingDeleteId) { await handleDeleteScheduleEntry(pendingDeleteId); } }}
                      className="flex-1 rounded-md bg-red-600 px-4 py-2 text-white hover:bg-red-700 transition"
                    >
                      Remove Booking
                    </button>
                  </div>
                </div>
              )}

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Start Date</label>
                <input
                  type="date"
                  value={scheduleForm.startDate}
                  onChange={(e) => { setScheduleForm({ ...scheduleForm, startDate: e.target.value }); setConflictMessage(''); setSuccessMessage(''); }}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">End Date</label>
                <input
                  type="date"
                  value={scheduleForm.endDate}
                  onChange={(e) => { setScheduleForm({ ...scheduleForm, endDate: e.target.value }); setConflictMessage(''); setSuccessMessage(''); }}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Type</label>
                <select
                  value={scheduleForm.type}
                  onChange={(e) => { setScheduleForm({ ...scheduleForm, type: e.target.value }); setConflictMessage(''); setSuccessMessage(''); }}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <option value="booked">Place HOLD</option>
                  <option value="pending">Mark as unavailable</option>
                </select>
              </div>

              {scheduleForm.type === 'booked' && (
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Project</label>
                  <select
                    value={scheduleForm.projectName}
                    onChange={(e) => { setScheduleForm({ ...scheduleForm, projectName: e.target.value }); setConflictMessage(''); setSuccessMessage(''); }}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                  >
                    <option value="">Select a project</option>
                    {projects
                      .filter(project => project.methodologyType === 'Qualitative')
                      .map(project => (
                        <option key={project.id} value={project.name}>
                          {project.name}
                        </option>
                      ))
                    }
                  </select>
                </div>
              )}

              <div className="flex gap-3 pt-4">
                <button
                  onClick={() => { setShowScheduleModal(false); setConflictMessage(''); setSuccessMessage(''); setPendingDeleteId(null); }}
                  className="flex-1 px-4 py-2 text-gray-700 bg-gray-100 rounded-md hover:bg-gray-200 transition"
                >
                  Cancel
                </button>
                <button
                  onClick={handleAddSchedule}
                  className="flex-1 px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 transition"
                >
                  Add to Schedule
                </button>
              </div>
            </div>
          </div>
        </div>,
        document.body
      )}

      {/* Success Message Modal */}

    </div>
  );
}

// Admin Center Component
function AdminCenter({ onProjectUpdate }: { onProjectUpdate?: () => void }) {
  const { user } = useAuth();
  const [activeTab, setActiveTab] = useState<'users' | 'cost-tracker' | 'feature-requests' | 'bug-reports' | 'settings'>('users');
  const [users, setUsers] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreateUser, setShowCreateUser] = useState(false);
  const [newUser, setNewUser] = useState({
    name: '',
    email: '',
    password: '',
    role: 'user' as 'user' | 'admin' | 'oversight',
    company: 'None' as 'None' | 'Cognitive'
  });

  // Feature Requests and Bug Reports state
  const [featureRequests, setFeatureRequests] = useState<any[]>([]);
  const [bugReports, setBugReports] = useState<any[]>([]);
  const [selectedItem, setSelectedItem] = useState<any | null>(null);

  // Cost Tracker state
  const [costData, setCostData] = useState<any[]>([]);
  const [expandedProject, setExpandedProject] = useState<string | null>(null);
  const [costFilter, setCostFilter] = useState<'all' | 'active' | 'archived'>('all');

  // Settings state
  const [projects, setProjects] = useState<any[]>([]);
  const [selectedProjectId, setSelectedProjectId] = useState<string>('');
  const [isResettingTasks, setIsResettingTasks] = useState(false);
  const [isResettingAllTasks, setIsResettingAllTasks] = useState(false);
  const loadCostData = useCallback(async () => {
    try {
      const headers: any = { 'Authorization': `Bearer ${localStorage.getItem('cognitive_dash_token')}` };
      const resp = await fetch(`${API_BASE_URL}/api/costs`, { headers });
      if (resp.ok) {
        const data = await resp.json();
        setCostData(Array.isArray(data.costs) ? data.costs : []);
      }
    } catch (e) {
      console.error('Error loading cost data:', e);
      setCostData([]);
    }
  }, []);

  const loadProjects = useCallback(async () => {
    try {
      const headers: any = { 'Authorization': `Bearer ${localStorage.getItem('cognitive_dash_token')}` };
      const resp = await fetch(`${API_BASE_URL}/api/projects/all`, { headers });
      if (resp.ok) {
        const data = await resp.json();
        console.log('Settings: Loaded projects data:', data);
        setProjects(Array.isArray(data.projects) ? data.projects : []);
      } else {
        console.error('Settings: Failed to load projects:', resp.status, resp.statusText);
      }
    } catch (e) {
      console.error('Error loading projects:', e);
      setProjects([]);
    }
  }, []);

  const resetProjectTasks = useCallback(async (projectId: string) => {
    if (!projectId) {
      alert('Please select a project first.');
      return;
    }

    if (!confirm('Are you sure you want to reset all tasks for this project? This will clear all existing tasks and replace them with the appropriate task list based on the project type. This action cannot be undone.')) {
      return;
    }

    setIsResettingTasks(true);
    try {
      const headers: any = { 
        'Authorization': `Bearer ${localStorage.getItem('cognitive_dash_token')}`,
        'Content-Type': 'application/json'
      };
      
      const resp = await fetch(`${API_BASE_URL}/api/projects/${projectId}/reset-tasks`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ userId: user?.id })
      });
      
      console.log('Reset tasks response status:', resp.status);
      console.log('Reset tasks response headers:', resp.headers);
      
      if (resp.ok) {
        const responseData = await resp.json();
        console.log('Reset tasks success response:', responseData);
        alert(`Project tasks have been successfully reset! ${responseData.taskCount} ${responseData.projectType} tasks loaded.`);
        // Reload projects to get updated data
        loadProjects();
        // Also refresh the main app's project data
        if (onProjectUpdate) {
          onProjectUpdate();
        }
      } else {
        const responseText = await resp.text();
        console.log('Reset tasks error response:', responseText);
        try {
          const errorData = JSON.parse(responseText);
          alert(`Failed to reset tasks: ${errorData.error || 'Unknown error'}`);
        } catch (e) {
          alert(`Failed to reset tasks: Server returned ${resp.status} - ${responseText.substring(0, 100)}...`);
        }
      }
    } catch (e) {
      console.error('Error resetting project tasks:', e);
      alert('Error resetting project tasks. Please try again.');
    } finally {
      setIsResettingTasks(false);
    }
  }, [loadProjects]);

  const resetAllProjectsTasks = useCallback(async () => {
    if (!confirm('Are you sure you want to reset ALL active projects\' tasks? This will clear all existing tasks and replace them with the appropriate task lists based on each project type. This action cannot be undone.')) {
      return;
    }

    setIsResettingAllTasks(true);
    try {
      const headers: any = { 
        'Authorization': `Bearer ${localStorage.getItem('cognitive_dash_token')}`,
        'Content-Type': 'application/json'
      };

      let successCount = 0;
      let errorCount = 0;
      const errors: string[] = [];

      // Reset tasks for each active project
      for (const project of projects) {
        try {
          const resp = await fetch(`${API_BASE_URL}/api/projects/${project.id}/reset-tasks`, {
            method: 'POST',
            headers,
            body: JSON.stringify({ userId: user?.id })
          });
          
          if (resp.ok) {
            const responseData = await resp.json();
            console.log(`Successfully reset tasks for project: ${project.name}`);
            successCount++;
          } else {
            const responseText = await resp.text();
            console.error(`Failed to reset tasks for project: ${project.name}`);
            errorCount++;
            errors.push(`${project.name}: ${responseText.substring(0, 50)}...`);
          }
        } catch (e) {
          console.error(`Error resetting tasks for project: ${project.name}`, e);
          errorCount++;
          errors.push(`${project.name}: ${e}`);
        }
      }

      // Show results
      if (errorCount === 0) {
        alert(`Successfully reset tasks for all ${successCount} projects!`);
      } else {
        alert(`Reset completed with some errors:\n\nSuccess: ${successCount} projects\nErrors: ${errorCount} projects\n\nError details:\n${errors.join('\n')}`);
      }

      // Reload projects to get updated data
      loadProjects();
      // Also refresh the main app's project data
      if (onProjectUpdate) {
        onProjectUpdate();
      }
    } catch (e) {
      console.error('Error resetting all project tasks:', e);
      alert('Error resetting all project tasks. Please try again.');
    } finally {
      setIsResettingAllTasks(false);
    }
  }, [projects, loadProjects, user?.id, onProjectUpdate]);

  const loadAdminFeedback = useCallback(async () => {
    try {
      const headers: any = { 'Authorization': `Bearer ${localStorage.getItem('cognitive_dash_token')}` };
      const resp = await fetch(`${API_BASE_URL}/api/feedback`, { headers });
      if (resp.ok) {
        const data = await resp.json();
        setFeatureRequests(Array.isArray(data.featureRequests) ? data.featureRequests : []);
        setBugReports(Array.isArray(data.bugReports) ? data.bugReports : []);
      }
    } catch (e) {
      setFeatureRequests([]);
      setBugReports([]);
    }
  }, []);

  const updateFeedbackStatus = useCallback(async (id: string, updates: { status?: string; priority?: string }) => {
    try {
      const resp = await fetch(`${API_BASE_URL}/api/feedback/${id}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${localStorage.getItem('cognitive_dash_token')}`
        },
        body: JSON.stringify(updates)
      });
      if (resp.ok) {
        await loadAdminFeedback();
      }
    } catch (e) {}
  }, [loadAdminFeedback]);
  const [loadingRequests, setLoadingRequests] = useState(false);

  // Password management state
  const [editingPassword, setEditingPassword] = useState<string | null>(null);
  const [newPassword, setNewPassword] = useState('');
  const [visiblePasswords, setVisiblePasswords] = useState<Set<string>>(new Set());

  // Load users
  const loadUsers = useCallback(async () => {
    try {
      const response = await fetch(`${API_BASE_URL}/api/auth/users/with-passwords`, {
        headers: {
          'Authorization': `Bearer ${localStorage.getItem('cognitive_dash_token')}`
        }
      });
      if (response.ok) {
        const data = await response.json();
        setUsers(data.users || []);
      }
    } catch (error) {
      console.error('Error loading users:', error);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadUsers();
  }, [loadUsers]);

  useEffect(() => {
    if (activeTab === 'cost-tracker') {
      loadCostData();
    } else if (activeTab === 'feature-requests' || activeTab === 'bug-reports') {
      loadAdminFeedback();
    } else if (activeTab === 'settings') {
      loadProjects();
    }
  }, [activeTab, loadCostData, loadAdminFeedback, loadProjects]);

  // Create new user
  const handleCreateUser = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const response = await fetch(`${API_BASE_URL}/api/auth/users`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${localStorage.getItem('cognitive_dash_token')}`
        },
        body: JSON.stringify(newUser)
      });
      
      if (response.ok) {
        setNewUser({ name: '', email: '', password: '', role: 'user', company: 'None' });
        setShowCreateUser(false);
        loadUsers();
      } else {
        const errorData = await response.json();
        alert(`Error creating user: ${errorData.message || 'Please try again.'}`);
      }
    } catch (error) {
      console.error('Error creating user:', error);
      alert('Error creating user. Please try again.');
    }
  };

  // Update user role
  const handleUpdateRole = async (userId: string, newRole: 'user' | 'admin' | 'oversight') => {
    try {
      const response = await fetch(`${API_BASE_URL}/api/auth/users/${userId}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${localStorage.getItem('cognitive_dash_token')}`
        },
        body: JSON.stringify({ role: newRole })
      });
      
      if (response.ok) {
        loadUsers();
      } else {
        const errorData = await response.json();
        alert(`Error updating user role: ${errorData.message || 'Please try again.'}`);
      }
    } catch (error) {
      console.error('Error updating user role:', error);
      alert('Error updating user role. Please try again.');
    }
  };

  const handleUpdateCompany = async (userId: string, newCompany: 'None' | 'Cognitive') => {
    try {
      const response = await fetch(`${API_BASE_URL}/api/auth/users/${userId}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${localStorage.getItem('cognitive_dash_token')}`
        },
        body: JSON.stringify({ company: newCompany })
      });
      if (response.ok) {
        loadUsers();
      } else {
        const errorData = await response.json();
        alert(`Error updating user company: ${errorData.message || 'Please try again.'}`);
      }
    } catch (error) {
      console.error('Error updating user company:', error);
      alert('Error updating user company. Please try again.');
    }
  };

  // Delete user
  const handleDeleteUser = async (userId: string) => {
    if (!confirm('Are you sure you want to delete this user?')) return;
    
    try {
      const response = await fetch(`${API_BASE_URL}/api/auth/users/${userId}`, {
        method: 'DELETE',
        headers: {
          'Authorization': `Bearer ${localStorage.getItem('cognitive_dash_token')}`
        }
      });
      
      if (response.ok) {
        loadUsers();
      } else {
        const errorData = await response.json();
        alert(`Error deleting user: ${errorData.message || 'Please try again.'}`);
      }
    } catch (error) {
      console.error('Error deleting user:', error);
      alert('Error deleting user. Please try again.');
    }
  };

  // Change user password
  const handleChangePassword = async (userId: string) => {
    if (!newPassword || newPassword.length < 6) {
      alert('Password must be at least 6 characters long');
      return;
    }

    try {
      const response = await fetch(`${API_BASE_URL}/api/auth/users/${userId}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${localStorage.getItem('cognitive_dash_token')}`
        },
        body: JSON.stringify({ password: newPassword })
      });
      
      if (response.ok) {
        setEditingPassword(null);
        setNewPassword('');
        loadUsers();
        alert('Password updated successfully');
      } else {
        const errorData = await response.json();
        alert(`Error updating password: ${errorData.message || 'Please try again.'}`);
      }
    } catch (error) {
      console.error('Error updating password:', error);
      alert('Error updating password. Please try again.');
    }
  };

  // Toggle individual password visibility
  const togglePasswordVisibility = (userId: string) => {
    setVisiblePasswords(prev => {
      const newSet = new Set(prev);
      if (newSet.has(userId)) {
        newSet.delete(userId);
      } else {
        newSet.add(userId);
      }
      return newSet;
    });
  };

  // Load feature requests and bug reports (placeholder for now)
  const loadRequests = useCallback(async () => {
    setLoadingRequests(true);
    try {
      // TODO: Implement API endpoints for feature requests and bug reports
      // For now, using mock data
      setFeatureRequests([
        {
          id: '1',
          title: 'Add bulk user import functionality',
          description: 'Allow admins to import multiple users from CSV file',
          status: 'pending',
          priority: 'high',
          createdBy: 'Luke Borglin',
          createdAt: '2025-09-29T10:00:00Z',
          votes: 5
        },
        {
          id: '2',
          title: 'Add project templates',
          description: 'Create reusable project templates for common methodologies',
          status: 'in-progress',
          priority: 'medium',
          createdBy: 'Sarah Johnson',
          createdAt: '2025-09-28T14:30:00Z',
          votes: 3
        }
      ]);
      
      setBugReports([
        {
          id: '1',
          title: 'Content Analysis tab not loading on mobile',
          description: 'The content analysis interface is not responsive on mobile devices',
          status: 'open',
          priority: 'high',
          reportedBy: 'Michael Chen',
          createdAt: '2025-09-29T09:15:00Z',
          severity: 'critical'
        },
        {
          id: '2',
          title: 'User role changes not saving properly',
          description: 'Sometimes role changes in admin center revert after page refresh',
          status: 'investigating',
          priority: 'medium',
          reportedBy: 'Emily Rodriguez',
          createdAt: '2025-09-28T16:45:00Z',
          severity: 'medium'
        }
      ]);
    } catch (error) {
      console.error('Error loading requests:', error);
    } finally {
      setLoadingRequests(false);
    }
  }, []);

  // Load data based on active tab
  useEffect(() => {
    if (activeTab === 'users') {
      loadUsers();
    } else if (activeTab === 'feature-requests' || activeTab === 'bug-reports') {
      loadRequests();
    }
  }, [activeTab, loadUsers, loadRequests]);

  if (loading || loadingRequests) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-center">
          <div className="w-16 h-16 flex items-center justify-center mx-auto mb-4">
            <svg className="animate-spin" width="48" height="48" viewBox="0 0 48 48">
              <circle cx="24" cy="24" r="20" fill="none" stroke="#D14A2D" strokeWidth="4" strokeDasharray="50 75.4" strokeDashoffset="0" />
              <circle cx="24" cy="24" r="20" fill="none" stroke="#5D5F62" strokeWidth="4" strokeDasharray="50 75.4" strokeDashoffset="-62.7" />
            </svg>
          </div>
          <p className="text-gray-500">Loading...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Admin Center</h1>
          <p className="text-gray-600">Manage user accounts, feature requests, and bug reports</p>
        </div>
        {activeTab === 'users' && (
          <button
            onClick={() => setShowCreateUser(true)}
            className="flex items-center gap-2 px-4 py-2 text-white rounded-lg transition-colors"
            style={{ backgroundColor: '#D14A2D' }}
            onMouseEnter={(e) => (e.currentTarget as HTMLButtonElement).style.backgroundColor = '#B74227'}
            onMouseLeave={(e) => (e.currentTarget as HTMLButtonElement).style.backgroundColor = '#D14A2D'}
          >
            <UserPlusIcon className="h-5 w-5" />
            Create User
          </button>
        )}
      </div>

      {/* Tab Navigation */}
      <div className="border-b border-gray-200">
        <nav className="-mb-px flex space-x-8">
          <button
            onClick={() => setActiveTab('users')}
            className={`py-2 px-1 border-b-2 font-medium text-sm ${
              activeTab === 'users'
                ? 'text-gray-900'
                : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
            }`}
            style={activeTab === 'users' ? { borderBottomColor: '#D14A2D', color: '#D14A2D' } : {}}
          >
            <div className="flex items-center gap-2">
              <UserGroupIcon className="w-5 h-5" />
              User Management
            </div>
          </button>
          <button
            onClick={() => setActiveTab('cost-tracker')}
            className={`py-2 px-1 border-b-2 font-medium text-sm ${
              activeTab === 'cost-tracker'
                ? 'text-gray-900'
                : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
            }`}
            style={activeTab === 'cost-tracker' ? { borderBottomColor: '#D14A2D', color: '#D14A2D' } : {}}
          >
            <div className="flex items-center gap-2">
              <ChartBarIcon className="w-5 h-5" />
              Cost Tracker
            </div>
          </button>
          <button
            onClick={() => setActiveTab('feature-requests')}
            className={`py-2 px-1 border-b-2 font-medium text-sm ${
              activeTab === 'feature-requests'
                ? 'text-gray-900'
                : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
            }`}
            style={activeTab === 'feature-requests' ? { borderBottomColor: '#D14A2D', color: '#D14A2D' } : {}}
          >
            <div className="flex items-center gap-2">
              <LightBulbIcon className="w-5 h-5" />
              Feature Requests ({featureRequests.filter((r:any) => r.status === 'pending review').length})
            </div>
          </button>
          <button
            onClick={() => setActiveTab('bug-reports')}
            className={`py-2 px-1 border-b-2 font-medium text-sm ${
              activeTab === 'bug-reports'
                ? 'text-gray-900'
                : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
            }`}
            style={activeTab === 'bug-reports' ? { borderBottomColor: '#D14A2D', color: '#D14A2D' } : {}}
          >
            <div className="flex items-center gap-2">
              <ExclamationTriangleIcon className="w-5 h-5" />
              Bug Reports ({bugReports.filter((r:any) => r.status === 'pending review').length})
            </div>
          </button>
          <button
            onClick={() => setActiveTab('settings')}
            className={`py-2 px-1 border-b-2 font-medium text-sm ${
              activeTab === 'settings'
                ? 'text-gray-900'
                : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
            }`}
            style={activeTab === 'settings' ? { borderBottomColor: '#D14A2D', color: '#D14A2D' } : {}}
          >
            <div className="flex items-center gap-2">
              <Cog6ToothIcon className="w-5 h-5" />
              Settings
            </div>
          </button>
        </nav>
      </div>

      {/* Create User Modal */}
      {showCreateUser && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-start justify-center overflow-y-auto py-8 z-[9999]">
          <div className="bg-white rounded-lg p-6 w-full max-w-md">
            <h3 className="text-lg font-semibold mb-4">Create New User</h3>
            <form onSubmit={handleCreateUser} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Name</label>
                <input
                  type="text"
                  required
                  value={newUser.name}
                  onChange={(e) => setNewUser({ ...newUser, name: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:border-gray-300"
                  style={{ '--tw-ring-color': '#D14A2D' } as React.CSSProperties}
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Email</label>
                <input
                  type="email"
                  required
                  value={newUser.email}
                  onChange={(e) => setNewUser({ ...newUser, email: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:border-gray-300"
                  style={{ '--tw-ring-color': '#D14A2D' } as React.CSSProperties}
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Password</label>
                <input
                  type="password"
                  required
                  value={newUser.password}
                  onChange={(e) => setNewUser({ ...newUser, password: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:border-gray-300"
                  style={{ '--tw-ring-color': '#D14A2D' } as React.CSSProperties}
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Role</label>
                <select
                  value={newUser.role}
                  onChange={(e) => setNewUser({ ...newUser, role: e.target.value as 'user' | 'admin' | 'oversight' })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:border-gray-300"
                  style={{ '--tw-ring-color': '#D14A2D' } as React.CSSProperties}
                >
                  <option value="user">User</option>
                  <option value="admin">Admin</option>
                  <option value="oversight">Oversight</option>
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Company</label>
                <select
                  value={newUser.company}
                  onChange={(e) => setNewUser({ ...newUser, company: e.target.value as 'None' | 'Cognitive' })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:border-gray-300"
                  style={{ '--tw-ring-color': '#D14A2D' } as React.CSSProperties}
                >
                  <option value="None">None</option>
                  <option value="Cognitive">Cognitive</option>
                </select>
              </div>
              <div className="flex gap-3 pt-4">
                <button
                  type="submit"
                  className="flex-1 px-4 py-2 text-white rounded-lg transition-colors"
                  style={{ 
                    backgroundColor: '#D14A2D',
                  }}
                  onMouseEnter={(e) => (e.currentTarget as HTMLButtonElement).style.backgroundColor = '#B74227'}
                  onMouseLeave={(e) => (e.currentTarget as HTMLButtonElement).style.backgroundColor = '#D14A2D'}
                >
                  Create User
                </button>
                <button
                  type="button"
                  onClick={() => setShowCreateUser(false)}
                  className="flex-1 px-4 py-2 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 transition-colors"
                >
                  Cancel
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Tab Content */}
      {activeTab === 'users' && (
        /* Users List */
        <div className="bg-white rounded-lg shadow">
          <div className="px-6 py-4 border-b border-gray-200">
            <h3 className="text-lg font-medium text-gray-900">All Users ({users.length})</h3>
          </div>
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Name</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Email</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Password</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Role</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Company</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Created</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Actions</th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {users.map((user) => (
                  <tr key={user.id} className="hover:bg-gray-50">
                    <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">
                      {user.name}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                      {user.email}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                      {editingPassword === user.id ? (
                        <div className="flex items-center gap-2">
                          <input
                            type="password"
                            value={newPassword}
                            onChange={(e) => setNewPassword(e.target.value)}
                            placeholder="New password"
                            className="text-sm border border-gray-300 rounded px-0.5 sm:px-1 md:px-2 py-1 focus:ring-2 focus:border-gray-300 w-32"
                            style={{ '--tw-ring-color': '#D14A2D' } as React.CSSProperties}
                          />
                          <button
                            onClick={() => handleChangePassword(user.id)}
                            className="text-xs px-0.5 sm:px-1 md:px-2 py-1 bg-green-600 text-white rounded hover:bg-green-700"
                          >
                            Save
                          </button>
                          <button
                            onClick={() => {
                              setEditingPassword(null);
                              setNewPassword('');
                            }}
                            className="text-xs px-0.5 sm:px-1 md:px-2 py-1 bg-gray-500 text-white rounded hover:bg-gray-600"
                          >
                            Cancel
                          </button>
                        </div>
                      ) : (
                        <div className="flex items-center gap-2">
                          <span className="font-mono text-xs">
                            {visiblePasswords.has(user.id) ? (user.originalPassword || user.password) : '••••••••'}
                          </span>
                          <button
                            onClick={() => togglePasswordVisibility(user.id)}
                            className="text-gray-400 hover:text-gray-600 transition-colors"
                            title={visiblePasswords.has(user.id) ? 'Hide password' : 'Show password'}
                          >
                            <EyeIcon className="h-4 w-4" />
                          </button>
                          <button
                            onClick={() => setEditingPassword(user.id)}
                            className="text-xs text-blue-600 hover:text-blue-800 font-medium"
                          >
                            Change
                          </button>
                        </div>
                      )}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <select
                        value={user.role}
                        onChange={(e) => handleUpdateRole(user.id, e.target.value as 'user' | 'admin' | 'oversight')}
                        className="text-sm border border-gray-300 rounded px-0.5 sm:px-1 md:px-2 py-1 focus:ring-2 focus:border-gray-300"
                        style={{ '--tw-ring-color': '#D14A2D' } as React.CSSProperties}
                      >
                        <option value="user">User</option>
                        <option value="admin">Admin</option>
                        <option value="oversight">Oversight</option>
                      </select>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <select
                        value={(user as any).company || 'None'}
                        onChange={(e) => handleUpdateCompany(user.id, e.target.value as 'None' | 'Cognitive')}
                        className="text-sm border border-gray-300 rounded px-0.5 sm:px-1 md:px-2 py-1 focus:ring-2 focus:border-gray-300"
                        style={{ '--tw-ring-color': '#D14A2D' } as React.CSSProperties}
                      >
                        <option value="None">None</option>
                        <option value="Cognitive">Cognitive</option>
                      </select>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                      {new Date(user.createdAt).toLocaleDateString()}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                      <button
                        onClick={() => handleDeleteUser(user.id)}
                        className="text-red-600 hover:text-red-800 font-medium"
                      >
                        Delete
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {activeTab === 'feature-requests' && (
        <div className="bg-white shadow-sm rounded-lg border border-gray-200 p-6">
          <h3 className="text-lg font-semibold text-gray-900 mb-4">Feature Requests</h3>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {['pending review','working on it','done'].map((status) => (
              <div key={status} className="border rounded-lg p-3">
                <div className="text-sm font-semibold text-gray-800 mb-2 capitalize">{status}</div>
                <div className="space-y-2">
                  {featureRequests.filter((r:any) => r.status === status).map((item:any) => (
                    <div key={item.id} className="border rounded p-2 hover:bg-gray-50 transition-colors">
                      <div
                        className="cursor-pointer"
                        onClick={() => setSelectedItem(item)}
                      >
                        <div className="text-xs text-gray-500 mb-1">{new Date(item.createdAt).toLocaleString()}</div>
                        <div className="text-sm text-gray-900 font-medium hover:text-blue-600">{item.subject}</div>
                        <div className="text-xs text-gray-600 truncate">{item.body}</div>
                        {(() => { const submitter = (users || []).find((u:any) => u.id === item.createdBy); return (
                          <div className="text-xs text-gray-500 mt-1">Submitted by: {submitter?.name || item.createdBy}</div>
                        ); })()}
                      </div>
                      <div className="flex items-center justify-between mt-2">
                        <select
                          className="text-xs border rounded px-0.5 sm:px-1 md:px-2 py-1"
                          value={item.status}
                          onChange={(e) => updateFeedbackStatus(item.id, { status: e.target.value })}
                        >
                          <option value="pending review">Pending review</option>
                          <option value="working on it">Working on it</option>
                          <option value="done">Done</option>
                          <option value="archived">Archived</option>
                        </select>
                        <select
                          className="text-xs border rounded px-0.5 sm:px-1 md:px-2 py-1"
                          value={item.priority}
                          onChange={(e) => updateFeedbackStatus(item.id, { priority: e.target.value })}
                        >
                          <option value="low">Low</option>
                          <option value="medium">Medium</option>
                          <option value="high">High</option>
                        </select>
                      </div>
                    </div>
                  ))}
                  {featureRequests.filter((r:any) => r.status === status).length === 0 && (
                    <div className="text-xs text-gray-500 italic">No items</div>
                  )}
                </div>
              </div>
            ))}
          </div>
          {/* Archived toggle */}
          {featureRequests.some((r:any) => r.status === 'archived') && (
            <div className="mt-4">
              <div className="text-sm font-semibold text-gray-800 mb-2">Archived</div>
              <div className="grid md:grid-cols-3 gap-2">
                {featureRequests.filter((r:any) => r.status === 'archived').map((item:any) => (
                  <div key={item.id} className="border rounded p-2">
                    <div className="text-xs text-gray-500 mb-1">{new Date(item.updatedAt || item.createdAt).toLocaleString()}</div>
                    <div className="text-sm text-gray-900">{item.subject}</div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {activeTab === 'bug-reports' && (
        <div className="bg-white shadow-sm rounded-lg border border-gray-200 p-6">
          <h3 className="text-lg font-semibold text-gray-900 mb-4">Bug Reports</h3>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {['pending review','working on it','done'].map((status) => (
              <div key={status} className="border rounded-lg p-3">
                <div className="text-sm font-semibold text-gray-800 mb-2 capitalize">{status}</div>
                <div className="space-y-2">
                  {bugReports.filter((r:any) => r.status === status).map((item:any) => (
                    <div key={item.id} className="border rounded p-2 hover:bg-gray-50 transition-colors">
                      <div
                        className="cursor-pointer"
                        onClick={() => setSelectedItem(item)}
                      >
                        <div className="text-xs text-gray-500 mb-1">{new Date(item.createdAt).toLocaleString()}</div>
                        <div className="text-sm text-gray-900 font-medium hover:text-blue-600">{item.subject}</div>
                        <div className="text-xs text-gray-600 truncate">{item.body}</div>
                        {(() => { const submitter = (users || []).find((u:any) => u.id === item.createdBy); return (
                          <div className="text-xs text-gray-500 mt-1">Submitted by: {submitter?.name || item.createdBy}</div>
                        ); })()}
                      </div>
                      <div className="flex items-center justify-between mt-2">
                        <select
                          className="text-xs border rounded px-0.5 sm:px-1 md:px-2 py-1"
                          value={item.status}
                          onChange={(e) => updateFeedbackStatus(item.id, { status: e.target.value })}
                        >
                          <option value="pending review">Pending review</option>
                          <option value="working on it">Working on it</option>
                          <option value="done">Done</option>
                          <option value="archived">Archived</option>
                        </select>
                        <select
                          className="text-xs border rounded px-0.5 sm:px-1 md:px-2 py-1"
                          value={item.priority}
                          onChange={(e) => updateFeedbackStatus(item.id, { priority: e.target.value })}
                        >
                          <option value="low">Low</option>
                          <option value="medium">Medium</option>
                          <option value="high">High</option>
                        </select>
                      </div>
                    </div>
                  ))}
                  {bugReports.filter((r:any) => r.status === status).length === 0 && (
                    <div className="text-xs text-gray-500 italic">No items</div>
                  )}
                </div>
              </div>
            ))}
          </div>
          {bugReports.some((r:any) => r.status === 'archived') && (
            <div className="mt-4">
              <div className="text-sm font-semibold text-gray-800 mb-2">Archived</div>
              <div className="grid md:grid-cols-3 gap-2">
                {bugReports.filter((r:any) => r.status === 'archived').map((item:any) => (
                  <div key={item.id} className="border rounded p-2">
                    <div className="text-xs text-gray-500 mb-1">{new Date(item.updatedAt || item.createdAt).toLocaleString()}</div>
                    <div className="text-sm text-gray-900">{item.subject}</div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {activeTab === 'cost-tracker' && (
        <div className="bg-white shadow-sm rounded-lg border border-gray-200 p-6">
          <div className="flex items-center justify-between mb-6">
            <h3 className="text-lg font-semibold text-gray-900">API Cost Tracker</h3>
            <div className="flex items-center gap-3">
              <select
                value={costFilter}
                onChange={(e) => setCostFilter(e.target.value as 'all' | 'active' | 'archived')}
                className="text-sm border border-gray-300 rounded px-3 py-1.5 focus:ring-2 focus:border-gray-300"
                style={{ '--tw-ring-color': '#D14A2D' } as React.CSSProperties}
              >
                <option value="all">All Projects</option>
                <option value="active">Active Projects</option>
                <option value="archived">Archived Projects</option>
              </select>
            </div>
          </div>

          {costData.length === 0 ? (
            <div className="text-center py-12">
              <ChartBarIcon className="mx-auto h-12 w-12 text-gray-400" />
              <h3 className="mt-2 text-sm font-medium text-gray-900">No cost data yet</h3>
              <p className="mt-1 text-sm text-gray-500">
                Cost tracking will begin when API calls are made for projects.
              </p>
            </div>
          ) : (
            <div className="space-y-4">
              {/* Summary Stats */}
              <div className="grid grid-cols-3 gap-4 mb-6">
                <div className="bg-gray-50 p-4 rounded-lg">
                  <div className="text-sm text-gray-600">Total Projects</div>
                  <div className="text-2xl font-bold text-gray-900">
                    {costData.filter(p => costFilter === 'all' || (costFilter === 'active' && !p.archived) || (costFilter === 'archived' && p.archived)).length}
                  </div>
                </div>
                <div className="bg-gray-50 p-4 rounded-lg">
                  <div className="text-sm text-gray-600">Total Cost</div>
                  <div className="text-2xl font-bold" style={{ color: '#D14A2D' }}>
                    ${costData.filter(p => costFilter === 'all' || (costFilter === 'active' && !p.archived) || (costFilter === 'archived' && p.archived)).reduce((sum, p) => sum + p.total, 0).toFixed(2)}
                  </div>
                </div>
                <div className="bg-gray-50 p-4 rounded-lg">
                  <div className="text-sm text-gray-600">Total API Calls</div>
                  <div className="text-2xl font-bold text-gray-900">
                    {costData.filter(p => costFilter === 'all' || (costFilter === 'active' && !p.archived) || (costFilter === 'archived' && p.archived)).reduce((sum, p) => sum + p.entryCount, 0)}
                  </div>
                </div>
              </div>

              {/* Projects List */}
              <div className="space-y-3">
                {costData
                  .filter(project => {
                    if (costFilter === 'active') return !project.archived;
                    if (costFilter === 'archived') return project.archived;
                    return true;
                  })
                  .map((project) => (
                    <div key={project.projectId} className="border rounded-lg overflow-hidden">
                      <div
                        className="p-4 hover:bg-gray-50 cursor-pointer transition-colors"
                        onClick={() => setExpandedProject(expandedProject === project.projectId ? null : project.projectId)}
                      >
                        <div className="flex items-center justify-between">
                          <div className="flex-1">
                            <div className="flex items-center gap-2">
                              <h4 className="text-base font-medium text-gray-900">{project.projectName}</h4>
                              {project.archived && (
                                <span className="px-2 py-0.5 text-xs bg-gray-100 text-gray-600 rounded">Archived</span>
                              )}
                            </div>
                            <div className="text-sm text-gray-500 mt-1">
                              {project.entryCount} API call{project.entryCount !== 1 ? 's' : ''}
                              {project.lastUpdated && ` • Last updated ${new Date(project.lastUpdated).toLocaleString()}`}
                            </div>
                          </div>
                          <div className="flex items-center gap-4">
                            <div className="text-right">
                              <div className="text-lg font-bold" style={{ color: '#D14A2D' }}>
                                ${project.total.toFixed(2)}
                              </div>
                            </div>
                            <ChevronDownIcon
                              className={`w-5 h-5 text-gray-400 transition-transform ${
                                expandedProject === project.projectId ? 'transform rotate-180' : ''
                              }`}
                            />
                          </div>
                        </div>
                      </div>

                      {/* Expanded Details */}
                      {expandedProject === project.projectId && (
                        <div className="border-t bg-gray-50 p-4">
                          <h5 className="text-sm font-semibold text-gray-700 mb-3">Cost Breakdown by Category</h5>
                          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                            {Object.entries(project.breakdown).map(([category, cost]: [string, any]) => (
                              <div key={category} className="bg-white p-3 rounded border border-gray-200">
                                <div className="text-xs text-gray-600 mb-1">{category}</div>
                                <div className="text-lg font-semibold text-gray-900">${Number(cost).toFixed(4)}</div>
                              </div>
                            ))}
                          </div>
                          {Object.keys(project.breakdown).length === 0 && (
                            <div className="text-sm text-gray-500 text-center py-4">No cost breakdown available</div>
                          )}

                          {/* Raw entries table */}
                          {project.entries && project.entries.length > 0 && (
                            <div className="mt-4 bg-white rounded border border-gray-200 overflow-x-auto">
                              <table className="min-w-full text-xs">
                                <thead className="bg-gray-50">
                                  <tr>
                                    <th className="px-3 py-2 text-left text-gray-600 font-medium">Timestamp</th>
                                    <th className="px-3 py-2 text-left text-gray-600 font-medium">Category</th>
                                    <th className="px-3 py-2 text-left text-gray-600 font-medium">Model</th>
                                    <th className="px-3 py-2 text-right text-gray-600 font-medium">Input</th>
                                    <th className="px-3 py-2 text-right text-gray-600 font-medium">Output</th>
                                    <th className="px-3 py-2 text-right text-gray-600 font-medium">Cost</th>
                                    <th className="px-3 py-2 text-left text-gray-600 font-medium">Description</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {project.entries.map((e: any) => (
                                    <tr key={e.id} className="border-t">
                                      <td className="px-3 py-2 whitespace-nowrap">{new Date(e.timestamp).toLocaleString()}</td>
                                      <td className="px-3 py-2">{e.category}</td>
                                      <td className="px-3 py-2">{e.model}</td>
                                      <td className="px-3 py-2 text-right">{e.inputTokens}</td>
                                      <td className="px-3 py-2 text-right">{e.outputTokens}</td>
                                      <td className="px-3 py-2 text-right">${Number(e.cost).toFixed(4)}</td>
                                      <td className="px-3 py-2">{e.description || '-'}</td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            </div>
                          )}
                          {Object.keys(project.breakdown).length === 0 && (
                            <div className="text-sm text-gray-500 text-center py-4">No cost breakdown available</div>
                          )}
                        </div>
                      )}
                    </div>
                  ))}
              </div>

              {costData.filter(p => costFilter === 'all' || (costFilter === 'active' && !p.archived) || (costFilter === 'archived' && p.archived)).length === 0 && (
                <div className="text-center py-8">
                  <p className="text-sm text-gray-500">No projects match the selected filter</p>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {activeTab === 'settings' && (
        <div className="bg-white shadow-sm rounded-lg border border-gray-200 p-6">
          <div className="flex items-center justify-between mb-6">
            <h3 className="text-lg font-semibold text-gray-900">Project Task Management</h3>
          </div>
          
          <div className="space-y-6">
            <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4">
              <div className="flex items-start">
                <ExclamationTriangleIcon className="h-5 w-5 text-yellow-400 mt-0.5 mr-3" />
                <div>
                  <h4 className="text-sm font-medium text-yellow-800">Reset Project Tasks</h4>
                  <p className="text-sm text-yellow-700 mt-1">
                    This will clear all existing tasks for the selected project and replace them with the appropriate task list based on the project type (qualitative or quantitative). This action cannot be undone.
                  </p>
                </div>
              </div>
            </div>

            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Select Project
                </label>
                <select
                  value={selectedProjectId}
                  onChange={(e) => setSelectedProjectId(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:border-gray-300 focus:outline-none"
                  style={{ '--tw-ring-color': '#D14A2D' } as React.CSSProperties}
                >
                  <option value="">Choose a project...</option>
                  {projects.map((project) => (
                    <option key={project.id} value={project.id}>
                      {project.name} ({project.methodologyType || 'Unknown Type'})
                    </option>
                  ))}
                </select>
              </div>

              <div className="flex items-center gap-4">
                <button
                  onClick={() => resetProjectTasks(selectedProjectId)}
                  disabled={!selectedProjectId || isResettingTasks}
                  className={`px-4 py-2 rounded-lg font-medium transition-colors ${
                    !selectedProjectId || isResettingTasks
                      ? 'bg-gray-300 text-gray-500 cursor-not-allowed'
                      : 'bg-red-600 text-white hover:bg-red-700'
                  }`}
                >
                  {isResettingTasks ? (
                    <div className="flex items-center gap-2">
                      <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                      Resetting Tasks...
                    </div>
                  ) : (
                    'Reset Project Tasks'
                  )}
                </button>
                
                {selectedProjectId && (
                  <div className="text-sm text-gray-600">
                    Selected: {projects.find(p => p.id === selectedProjectId)?.name}
                  </div>
                )}
              </div>
            </div>

            {/* Bulk Reset Section */}
            <div className="border-t border-gray-200 pt-6">
              <div className="bg-red-50 border border-red-200 rounded-lg p-4 mb-4">
                <div className="flex items-start">
                  <ExclamationTriangleIcon className="h-5 w-5 text-red-400 mt-0.5 mr-3" />
                  <div>
                    <h4 className="text-sm font-medium text-red-800">Reset ALL Active Projects</h4>
                    <p className="text-sm text-red-700 mt-1">
                      This will reset tasks for ALL active projects at once. Each project will get the appropriate task list based on its type (qualitative or quantitative). This action cannot be undone.
                    </p>
                  </div>
                </div>
              </div>

              <div className="flex items-center gap-4">
                <button
                  onClick={resetAllProjectsTasks}
                  disabled={projects.length === 0 || isResettingAllTasks}
                  className={`px-6 py-3 rounded-lg font-medium transition-colors ${
                    projects.length === 0 || isResettingAllTasks
                      ? 'bg-gray-300 text-gray-500 cursor-not-allowed'
                      : 'bg-red-700 text-white hover:bg-red-800'
                  }`}
                >
                  {isResettingAllTasks ? (
                    <div className="flex items-center gap-2">
                      <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                      Resetting All Projects...
                    </div>
                  ) : (
                    `Reset All ${projects.length} Projects`
                  )}
                </button>
                
                {projects.length > 0 && (
                  <div className="text-sm text-gray-600">
                    {projects.length} active projects will be updated
                  </div>
                )}
              </div>
            </div>

            {projects.length === 0 && (
              <div className="text-center py-8">
                <p className="text-sm text-gray-500">No projects found. Please ensure you have access to projects.</p>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Full Details Modal */}
      {selectedItem && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-start justify-center overflow-y-auto py-8 z-[9999]" onClick={() => setSelectedItem(null)}>
          <div className="bg-white rounded-lg p-6 w-full max-w-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold text-gray-900">Full Details</h3>
              <button
                onClick={() => setSelectedItem(null)}
                className="text-gray-400 hover:text-gray-600 transition-colors"
              >
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Subject</label>
                <div className="text-base text-gray-900 font-medium">{selectedItem.subject}</div>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Details</label>
                <div className="text-sm text-gray-800 whitespace-pre-wrap bg-gray-50 p-4 rounded border border-gray-200">{selectedItem.body}</div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Submitted by</label>
                  <div className="text-sm text-gray-900">
                    {(() => {
                      const submitter = (users || []).find((u:any) => u.id === selectedItem.createdBy);
                      return submitter?.name || selectedItem.createdBy;
                    })()}
                  </div>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Date</label>
                  <div className="text-sm text-gray-900">{new Date(selectedItem.createdAt).toLocaleString()}</div>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Status</label>
                  <div className="text-sm text-gray-900 capitalize">{selectedItem.status}</div>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Priority</label>
                  <div className="text-sm text-gray-900 capitalize">{selectedItem.priority}</div>
                </div>
              </div>
            </div>
            <div className="mt-6 flex justify-end">
              <button
                onClick={() => setSelectedItem(null)}
                className="px-4 py-2 text-white rounded-lg transition-colors"
                style={{ backgroundColor: '#D14A2D' }}
                onMouseEnter={(e) => (e.currentTarget as HTMLButtonElement).style.backgroundColor = '#B74227'}
                onMouseLeave={(e) => (e.currentTarget as HTMLButtonElement).style.backgroundColor = '#D14A2D'}
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

const PHASES = [
  "Kickoff",
  "Pre-Field",
  "Fielding",
  "Post-Field Analysis",
  "Reporting",
] as const;

// Helper function to get display name for phases
const getPhaseDisplayName = (phase: string) => {
  return phase === 'Post-Field Analysis' ? 'Analysis' : phase;
};

// Helper function to get project status with special statuses
const getProjectStatus = (project: Project) => {
  const today = new Date();
  
  // Check if project is before KO date
  const kickoffDate = project.keyDeadlines?.find(kd => 
    kd.label.toLowerCase().includes('kickoff') || 
    kd.label.toLowerCase().includes('ko')
  )?.date;
  
  if (kickoffDate && kickoffDate !== 'Invalid Date') {
    const koDate = new Date(kickoffDate);
    if (today < koDate) {
      return { phase: 'Awaiting KO', color: '#9CA3AF' };
    }
  }
  
  // Check if project is after final report date
  const finalReportDate = project.keyDeadlines?.find(kd => 
    kd.label.toLowerCase().includes('final report') || 
    kd.label.toLowerCase().includes('report')
  )?.date;
  
  if (finalReportDate && finalReportDate !== 'Invalid Date') {
    const reportDate = new Date(finalReportDate);
    if (today > reportDate) {
      return { phase: 'Complete', color: '#10B981' };
    }
  }
  
  // Get current phase from project segments or fallback to stored phase
  const getCurrentPhase = (project: Project): string => {
    if (!project.segments || project.segments.length === 0) {
      return project.phase; // Fallback to stored phase
    }

    const today = new Date();
    const todayStr = today.toISOString().split('T')[0]; // YYYY-MM-DD format

    // Find which phase today falls into
    for (const segment of project.segments) {
      if (todayStr >= segment.startDate && todayStr <= segment.endDate) {
        return segment.phase;
      }
    }

    // If today is before the first phase, return the first phase
    if (todayStr < project.segments[0].startDate) {
      return project.segments[0].phase;
    }

    // If today is after the last phase, return the last phase
    if (todayStr > project.segments[project.segments.length - 1].endDate) {
      return project.segments[project.segments.length - 1].phase;
    }

    return project.phase; // Fallback
  };

  const currentPhase = getCurrentPhase(project);
  
  // Map phases to colors - use the existing PHASE_COLORS constant
  const phaseColors: { [key: string]: string } = {
    'Kickoff': PHASE_COLORS.Kickoff,
    'Pre-Field': PHASE_COLORS['Pre-Field'],
    'Fielding': PHASE_COLORS.Fielding,
    'Post-Field Analysis': PHASE_COLORS['Post-Field Analysis'],
    'Analysis': PHASE_COLORS['Post-Field Analysis'], // Analysis is the same as Post-Field Analysis
    'Reporting': PHASE_COLORS.Reporting,
    'Awaiting KO': PHASE_COLORS['Awaiting KO'],
    'Complete': PHASE_COLORS.Complete
  };
  
  return {
    phase: currentPhase,
    color: phaseColors[currentPhase] || '#6B7280'
  };
};

type Phase = typeof PHASES[number];
type ProjectPhase = Phase | "Awaiting KO" | "Complete";

const METHODOLOGIES = [
  "ATU (Awareness, Trial, Usage)",
  "Conjoint Analysis",
  "Qualitative Research",
  "Message Testing",
  "Brand Tracking",
  "Customer Satisfaction",
  "Market Segmentation",
  "Pricing Research",
  "Concept Testing",
  "Usability Testing",
  "Focus Groups",
  "In-Depth Interviews",
  "Online Surveys",
  "Mobile Surveys",
  "Ethnographic Research",
  "Other"
] as const;
type Methodology = typeof METHODOLOGIES[number];
const PHASE_COLORS: Record<string, string> = {
  Kickoff: "#6B7280", // Grey
  "Pre-Field": "#1D4ED8", // Blue
  Fielding: "#7C3AED", // Purple
  "Post-Field Analysis": "#F97316", // Orange-500 (lighter)
  Reporting: "#DC2626", // Red
  // Additional lifecycle statuses (not shown as tabs)
  "Awaiting KO": "#9CA3AF", // Neutral grey
  Complete: "#10B981", // Green
};

type TeamMember = {
  id: string;
  name: string;
  email: string;
};

type Task = {
  id: string;
  // New schema
  description?: string;
  assignedTo?: string[]; // Array of team member IDs
  status: 'pending' | 'in-progress' | 'completed';
  dueDate?: string;
  phase?: Phase;
  // Ongoing task support
  isOngoing?: boolean; // True for ongoing tasks that span the entire phase
  phaseStartDate?: string; // When the phase starts (for ongoing task assignment)
  phaseEndDate?: string; // When the phase ends (for ongoing task assignment)
  // Ongoing task assignment tracking
  ongoingAssignment?: {
    assignedTo: string[]; // Who it's assigned to during the phase
    phaseStart: string; // When the phase starts
    phaseEnd: string; // When the phase ends
    assignedDate: string; // When it was assigned
  };
  // Legacy schema compatibility
  content?: string;
  completed?: boolean;
  notes?: string;
  completedBy?: string | null;
  completedDate?: string | null;
};

type ProjectFile = {
  id: string;
  name: string;
  type: 'content-analysis' | 'qnr' | 'report' | 'other' | 'word' | 'excel' | 'powerpoint' | 'Word' | 'Excel' | 'PowerPoint' | 'PDF' | 'Other';
  uploadedAt?: string;
  size?: string;
  url: string;
};

type User = {
  id: string;
  name: string;
  email: string;
  role: 'admin' | 'user';
};

type Project = {
  id: string;
  name: string;
  client: string;
  phase: ProjectPhase;
  methodology: Methodology;
  startDate: string; // YYYY-MM-DD format
  endDate: string; // YYYY-MM-DD format
  // Numeric timeline (days from a reference) used across UI
  startDay: number;
  endDay: number;
  deadline: number;
  nextDeadline: string;
  keyDeadlines: Array<{ label: string; date: string }>;
  tasks: Array<Task>;
  teamMembers: Array<TeamMember>;
  files: Array<ProjectFile>;
  segments: Array<{ phase: ProjectPhase; startDate: string; endDate: string; startDay?: number; endDay?: number }>; // dates required, numeric optional
  notes: Array<{ id: string; title: string; body: string; createdAt: string; createdBy: string; isEditable: boolean; date?: string; postToProjectPage?: boolean; taggedMembers?: string[]; comments?: Array<{ id: string; text: string; author: string; createdAt: string }> }>;
  archivedNotes?: Array<{ id: string; title: string; body: string; createdAt: string; createdBy: string; isEditable: boolean; date?: string; postToProjectPage?: boolean; taggedMembers?: string[]; comments?: Array<{ id: string; text: string; author: string; createdAt: string }> }>;
  savedContentAnalyses?: Array<{ id: string; name: string; savedBy: string; savedDate: string; description: string; data: any }>;
  // Additional fields for comprehensive project summary
  methodologyType?: string;
  sampleDetails?: string;
  moderator?: string;
  createdBy?: string;
  archived?: boolean;
  archivedDate?: string;
};

const PROJECTS: Project[] = [
  // Mock projects removed - now using user-specific projects
];

const THIS_WEEK = { start: 15, end: 19 };

// Helper function to convert date formats
const formatDateForInput = (dateString: string): string => {
  if (!dateString) return "";
  
  // If already in YYYY-MM-DD format, return as is
  if (/^\d{4}-\d{2}-\d{2}$/.test(dateString)) {
    return dateString;
  }
  
  // If in MM/DD/YY format, convert to YYYY-MM-DD
  if (/^\d{2}\/\d{2}\/\d{2}$/.test(dateString)) {
    const [month, day, year] = dateString.split('/');
    const fullYear = `20${year}`; // Convert YY to 20YY
    return `${fullYear}-${month}-${day}`;
  }
  
  // If in M/D format, convert to YYYY-MM-DD
  if (/^\d{1,2}\/\d{1,2}$/.test(dateString)) {
    const [month, day] = dateString.split('/');
    const currentYear = new Date().getFullYear();
    return `${currentYear}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
  }
  
  return dateString;
};

const formatDateForDisplay = (dateString: string): string => {
  if (!dateString) return "";

  // If in YYYY-MM-DD format, convert to M/D/YY for display (no leading zeros)
  if (/^\d{4}-\d{2}-\d{2}$/.test(dateString)) {
    const [year, month, day] = dateString.split('-');
    const shortYear = year.slice(-2); // Get last 2 digits of year
    const monthNum = parseInt(month, 10);
    const dayNum = parseInt(day, 10);
    return `${monthNum}/${dayNum}/${shortYear}`;
  }

  return dateString;
};

// Helper function to check if a task is overdue
const isTaskOverdue = (task: Task): boolean => {
  if (!task.dueDate || task.status === 'completed') return false;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const dueDate = new Date(task.dueDate + 'T00:00:00');
  return dueDate < today;
};

// Helper function for getting initials
const getInitials = (name: string) => {
  if (!name || typeof name !== 'string') {
    return '?';
  }
  
  const words = name.trim().split(' ').filter(word => word.length > 0);
  if (words.length === 0) {
    return '?';
  }
  
  if (words.length === 1) {
    return words[0][0]?.toUpperCase() || '?';
  }
  
  // Put first initial in front, then remaining initials
  const firstInitial = words[0][0]?.toUpperCase() || '';
  const remainingInitials = words.slice(1)
    .map(n => n[0]?.toUpperCase() || '')
    .filter(Boolean)
    .join('');
  
  const result = (firstInitial + remainingInitials).toUpperCase();
  return result || '?';
};

// Helper function for getting member color (consistent across all contexts)
const getMemberColor = (memberId: string, teamMembers?: any[]) => {
  const colors = [
    '#3B82F6', // Blue
    '#10B981', // Green
    '#F59E0B', // Yellow
    '#EF4444', // Red
    '#8B5CF6', // Purple
    '#06B6D4', // Cyan
    '#F97316', // Orange
    '#84CC16', // Lime
    '#EC4899', // Pink
    '#6B7280'  // Gray
  ];

  // Handle undefined or null memberId
  if (!memberId || typeof memberId !== 'string') {
    return colors[0]; // Return first color as fallback
  }

  // If teamMembers array is provided, use sequential color assignment
  if (Array.isArray(teamMembers) && teamMembers.length > 0) {
    const memberIndex = teamMembers.findIndex(member => {
      if (!member) return false;
      const candidateId = typeof member === 'string' ? member : (member.id || member.email || member.name);
      return candidateId === memberId;
    });
    if (memberIndex !== -1) {
      return colors[memberIndex % colors.length];
    }
  }

  // Fallback to hash-based color for backward compatibility
  let hash = 0;
  for (let i = 0; i < memberId.length; i++) {
    const char = memberId.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // Convert to 32-bit integer
  }

  return colors[Math.abs(hash) % colors.length];
};

export default function App() {
  const { user, logout } = useAuth();
  const [sidebarOpen, setSidebarOpen] = useState(true);

  // Helper function for authentication headers
  const getAuthHeaders = useCallback(() => {
    const token = localStorage.getItem('cognitive_dash_token');
    return token ? { Authorization: `Bearer ${token}` } : { Authorization: '' };
  }, []);
  const [route, setRoute] = useState("Home");
  const [qualToolsDropdownOpen, setQualToolsDropdownOpen] = useState(true);
  const [quantToolsDropdownOpen, setQuantToolsDropdownOpen] = useState(true);
  const [projects, setProjects] = useState<Project[]>([]);
  const [loadingProjects, setLoadingProjects] = useState(false);
  const [currentAnalysisId, setCurrentAnalysisId] = useState<string | null>(null);
  const [currentProjectId, setCurrentProjectId] = useState<string | null>(null);
  const [analysisToLoad, setAnalysisToLoad] = useState<string | null>(null);
  const [isNavigatingToProject, setIsNavigatingToProject] = useState(false);
  const [projectToNavigate, setProjectToNavigate] = useState<Project | null>(null);
  const [isLoadingProjectFile, setIsLoadingProjectFile] = useState(false);
  const [savedContentAnalyses, setSavedContentAnalyses] = useState<any[]>([]);
  const [showProfileDropdown, setShowProfileDropdown] = useState(false);
  const [currentSelectedProject, setCurrentSelectedProject] = useState<Project | null>(null);
  const [isViewingProjectDetails, setIsViewingProjectDetails] = useState(false);

  // Reset viewing project details state when Project Hub route is loaded
  useEffect(() => {
    if (route === "Project Hub") {
      setIsViewingProjectDetails(false);
    }
  }, [route]);

  // Admin notification state
  const [adminNotificationCount, setAdminNotificationCount] = useState(0);
  const [allUsers, setAllUsers] = useState<any[]>([]);

  // Notification system state
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [showNotificationCenter, setShowNotificationCenter] = useState(false);

  // Close profile dropdown when clicking outside
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      const target = event.target as Element;
      if (!target.closest('[data-profile-dropdown]')) {
        setShowProfileDropdown(false);
      }
      if (!target.closest('.add-role-button') && !target.closest('.role-dropdown')) {
        setShowAddRoleDropdown(null);
      }
    }

    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, []);

  // Initialize notification system
  useEffect(() => {
    if (user?.id) {
      // Load notifications
      const loadedNotifications = notificationService.loadNotifications();
      setNotifications(loadedNotifications);

      // Subscribe to notification changes
      const unsubscribe = notificationService.subscribe((newNotifications) => {
        setNotifications(newNotifications);
      });

      // Check for overdue tasks periodically
      const checkOverdueInterval = setInterval(() => {
        if (projects.length > 0) {
          notificationService.checkOverdueTasks(projects, user.id);
        }
      }, 60000); // Check every minute

      // Cleanup old notifications
      notificationService.cleanupOldNotifications();

      return () => {
        unsubscribe();
        clearInterval(checkOverdueInterval);
      };
    }
  }, [user?.id, projects]);

  // Notification handlers
  const handleNotificationClick = (notification: Notification) => {
    // Navigate to the project
    const project = projects.find(p => p.id === notification.projectId);
    if (project) {
      setCurrentProjectId(notification.projectId);
      setRoute("Project Hub");
      setCurrentSelectedProject(project);
    }
  };

  const handleViewAllNotifications = () => {
    setShowNotificationCenter(true);
  };

  const handleMarkAsRead = () => {
    const unreadNotifications = notifications.filter(n => !n.read);
    if (unreadNotifications.length > 0) {
      const unreadIds = unreadNotifications.map(n => n.id);
      notificationService.markAsRead(unreadIds);
    }
  };

  const handleMarkAllAsRead = () => {
    notificationService.markAsRead();
  };

  // Test function for development
  const generateTestNotifications = async () => {
    if (user?.id) {
      const { generateTestNotifications } = await import('./utils/testNotifications');
      generateTestNotifications(user.id);
      // Reload notifications
      const loadedNotifications = notificationService.loadNotifications();
      setNotifications(loadedNotifications);
    }
  };

  // Load admin notification count
  useEffect(() => {
    const loadAdminNotifications = async () => {
      if (user?.role !== 'admin') return;

      try {
        const headers: any = { 'Authorization': `Bearer ${localStorage.getItem('cognitive_dash_token')}` };

        // Load feedback (bug reports & feature requests)
        const feedbackResp = await fetch(`${API_BASE_URL}/api/feedback`, { headers });
        let pendingFeedbackCount = 0;
        if (feedbackResp.ok) {
          const feedbackData = await feedbackResp.json();
          const pendingBugs = (feedbackData.bugReports || []).filter((r: any) => r.status === 'pending review').length;
          const pendingFeatures = (feedbackData.featureRequests || []).filter((r: any) => r.status === 'pending review').length;
          pendingFeedbackCount = pendingBugs + pendingFeatures;
        }

        // Load users with company = "None"
        const usersResp = await fetch(`${API_BASE_URL}/api/auth/users`, { headers });
        let unassignedUsersCount = 0;
        if (usersResp.ok) {
          const usersData = await usersResp.json();
          unassignedUsersCount = (usersData.users || []).filter((u: any) => u.company === 'None').length;
        }

        setAdminNotificationCount(pendingFeedbackCount + unassignedUsersCount);
      } catch (error) {
        console.error('Error loading admin notifications:', error);
      }
    };

    loadAdminNotifications();
    // Reload every 30 seconds
    const interval = setInterval(loadAdminNotifications, 30000);
    return () => clearInterval(interval);
  }, [user?.role]);

  // Function to format dates consistently across the app
  const formatDateForKeyDeadline = (dateString: string | undefined): string => {
    if (!dateString) return 'Invalid Date';

    try {
      // Parse the date string - handle YYYY-MM-DD format consistently using UTC
      const [year, month, day] = dateString.split('-');
      const date = new Date(Date.UTC(parseInt(year), parseInt(month) - 1, parseInt(day)));

      // Check if the date is valid
      if (isNaN(date.getTime())) {
        return 'Invalid Date';
      }

      // Format as M/D/YY using UTC methods to avoid timezone conversion (no leading zeros)
      const monthNum = date.getUTCMonth() + 1;
      const dayNum = date.getUTCDate();
      const yearNum = date.getUTCFullYear().toString().slice(-2);
      
      return `${monthNum}/${dayNum}/${yearNum}`;
    } catch (error) {
      console.warn('Error formatting date for key deadline:', dateString, error);
      return 'Invalid Date';
    }
  };

  // Function to format dates for display (consistent with key deadlines)
  const formatDateForDisplay = (dateString: string | undefined): string => {
    if (!dateString) return 'Invalid Date';

    try {
      // Parse the date string - handle YYYY-MM-DD format consistently using UTC
      const [year, month, day] = dateString.split('-');
      const date = new Date(Date.UTC(parseInt(year), parseInt(month) - 1, parseInt(day)));

      // Check if the date is valid
      if (isNaN(date.getTime())) {
        return 'Invalid Date';
      }

      // Format as M/D/YY using UTC methods to match key deadlines (no leading zeros)
      const monthNum = date.getUTCMonth() + 1;
      const dayNum = date.getUTCDate();
      const yearNum = date.getUTCFullYear().toString().slice(-2);
      
      return `${monthNum}/${dayNum}/${yearNum}`;
    } catch (error) {
      console.warn('Error formatting date for display:', dateString, error);
      return 'Invalid Date';
    }
  };

  const regenerateKeyDates = (project: Project): Project => {
    if (!project.segments || project.segments.length === 0) {
      return project;
    }

    const newKeyDeadlines = [
      { label: "Project Kickoff", date: formatDateForKeyDeadline(project.segments[0]?.startDate) },
      { label: "Fielding Start", date: formatDateForKeyDeadline(project.segments.find(s => s.phase === 'Fielding')?.startDate) },
      { label: "Final Report", date: formatDateForKeyDeadline(project.segments[project.segments.length - 1]?.endDate) }
    ].filter(deadline => deadline.date !== 'Invalid Date');

    return {
      ...project,
      keyDeadlines: newKeyDeadlines
    };
  };

  // Function to fix timezone issues in existing project segments
  const fixProjectSegments = (project: Project): Project => {
    if (!project.segments || project.segments.length === 0) {
      return project;
    }

    // Helper function to format dates without timezone issues
    const formatDateForSegment = (date: Date): string => {
      const year = date.getFullYear();
      const month = String(date.getMonth() + 1).padStart(2, '0');
      const day = String(date.getDate()).padStart(2, '0');
      return `${year}-${month}-${day}`;
    };

    // Just fix timezone issues in existing segments without recalculating
    const fixedSegments = project.segments.map(segment => ({
      ...segment,
      startDate: segment.startDate, // Keep original dates
      endDate: segment.endDate      // Keep original dates
    }));

    const fieldingSegment = fixedSegments.find(s => s.phase === 'Fielding');

    return {
      ...project,
      segments: fixedSegments,
      keyDeadlines: [
        { label: "Project Kickoff", date: formatDateForKeyDeadline(fixedSegments[0]?.startDate) },
        { label: "Fielding Start", date: formatDateForKeyDeadline(fixedSegments.find(s => s.phase === 'Fielding')?.startDate) },
        { label: "Final Report", date: formatDateForKeyDeadline(fixedSegments[fixedSegments.length - 1]?.endDate) }
      ].filter(deadline => deadline.date !== 'Invalid Date')
    };
  };

  // Load projects function
  const loadProjects = useCallback(async () => {
    if (!user?.id) {
      setProjects([]);
      return;
    }

    setLoadingProjects(true);
    try {
      // Fetch all projects across all users (not just current user's projects)
      // This allows Project Hub and Content Analysis to filter by team membership
      const response = await fetch(`${API_BASE_URL}/api/projects/all`, {
        headers: { 'Authorization': `Bearer ${localStorage.getItem('cognitive_dash_token')}` }
      });
      if (response.ok) {
        const data = await response.json();

        // Filter out "Project Creator" from all projects' team members
        const filterProjectCreator = (projects: Project[]) => {
          return projects.map(project => ({
            ...project,
            teamMembers: (project.teamMembers || []).filter(member => member.name !== 'Project Creator')
          }));
        };

        // Add demo saved content analyses to some projects
        const addDemoContentAnalyses = (projects: Project[]) => {
          return projects.map((project, index) => {
            if (index === 0) {
              // Add to first project
              return {
                ...project,
                savedContentAnalyses: [
                  {
                    id: '1',
                    name: 'Oncology Study - Patient Journey Post-Field Analysis',
                    savedBy: 'Sarah Johnson',
                    savedDate: '2024-01-15',
                    description: 'Comprehensive analysis of patient treatment journey and decision points',
                    data: { /* mock data */ }
                  }
                ]
              };
            } else if (index === 1) {
              // Add to second project
              return {
                ...project,
                savedContentAnalyses: [
                  {
                    id: '2',
                    name: 'HCP Insights - Treatment Preferences',
                    savedBy: 'You',
                    savedDate: '2024-01-20',
                    description: 'Healthcare provider perspectives on treatment protocols',
                    data: { /* mock data */ }
                  }
                ]
              };
            }
            return project;
          });
        };

        // Function to update existing projects with corrected task lists
        const updateProjectsWithCorrectedTasks = (projects: Project[]) => {
          console.log('🔄 updateProjectsWithCorrectedTasks called with', projects.length, 'projects');
          const UPDATED_TASK_LIST = {
            "Qualitative": {
              "Kickoff": [
                "Create Kick Off (KO) deck",
                "Create detailed timeline",
                "Hold Internal Pre-Kick Off: Talk through study overview, roles, deadlines, and any other key project info prior to KO with client.",
                "Create or review Proposal based on RFP (Request For Proposal)",
                "Bid project out to vendors/moderators",
                "Get moderator availability",
                "Create a job folder for the study in the 'Proposals' folder (within appropriate client folder)",
                "Save vendors' bids to job folder",
                "Ensure any new vendors have signed the NDA",
                "Create Internal Cost Worksheet, send to supervisor",
                "Move study docs from 'Proposals' folder to main client folder",
                "Update folder name with job #",
                "Add AE submission forms & contact info to job folder",
                "Set up Invoice Schedule & Worksheet",
                "Alert recruiter and moderator that project is moving forward",
                "Draft screener",
                "Draft discussion guide",
                "Start Discuss.io project",
                "Send screener to client",
                "Send discussion guide draft to client",
                "Schedule KO with moderator"
              ],
              "Pre-Field": [
                "Create respondent grid for recruiters",
                "Create shared/client respondent grid",
                "Get screener approval from client",
                "Alert moderator and confirm availability",
                "Submit first invoice request",
                "Ensure signed documents are saved to job folder",
                "Schedule DG walk-through with client and moderator",
                "Copy cost tracker shell to job folder",
                "Confirm attendee list with client",
                "Get final stimuli from client",
                "Monitor recruits and update quotas",
                "Create outlook invite template",
                "Create content analysis (CA)",
                "Send Outlook invites with respondent details and observer login info",
                "Create notetaking schedule and align team",
                "Send final stimuli/workbooks/guide to moderator",
                "Schedule client debrief after first 1-2 interviews"
              ],
              "Fielding": [
                "Create report shell based on discussion guide and objectives",
                "Schedule second client debrief (if needed)",
                "Submit AEs within 24 hours of interviews"
              ],
              "Post-Field Analysis": [
                "Clean project folder",
                "Internal download: all audio files, CA, transcripts, and notes",
                "Submit AE reconciliation (if needed)"
              ],
              "Reporting": [
                "Populate report shell with key fidings",
                "Clean and finalize report",
                "Have report proofed",
                "Final review of report",
                "Send report to client",
                "Request invoice (if needed)",
                "Save vendor invoices and submit to accounting",
                "Reconcile with client-specific finance process",
                "Fill out Cost Tracker"
              ]
            }
          };

          return projects.map(project => {
            // Clear ALL existing tasks and replace with correct ones
            if (project.tasks && project.tasks.length > 0) {
              // Determine project type
              const isQualitativeProject = project.methodologyType === 'Qualitative' || 
                project.methodologyType === 'Qual' ||
                (project.name && project.name.toLowerCase().includes('qual'));
              
              console.log(`🔄 Clearing and replacing tasks for ${isQualitativeProject ? 'qualitative' : 'quantitative'} project:`, project.name);

              // Get the appropriate tasks based on project type
              const tasksToUse = isQualitativeProject ? 
                Object.entries(UPDATED_TASK_LIST.Qualitative).flatMap(([phase, taskList]) => 
                  taskList.map((taskContent, index) => ({
                    id: `task-${String(index + 1).padStart(3, '0')}`,
                    task: taskContent,
                    phase: phase,
                    quantQual: 'Qual',
                    dateNotes: '',
                    notes: ''
                  }))
                ) : 
                // For quantitative projects, use a simple set of quantitative tasks
                // TODO: Load from jaice_tasks.json when we can use dynamic imports
                [
                  { id: 'task-001', task: 'Create project timeline', phase: 'Kickoff', quantQual: 'Quant', dateNotes: '', notes: '' },
                  { id: 'task-002', task: 'Set up data collection system', phase: 'Kickoff', quantQual: 'Quant', dateNotes: '', notes: '' },
                  { id: 'task-003', task: 'Design survey instrument', phase: 'Pre-Field', quantQual: 'Quant', dateNotes: '', notes: '' },
                  { id: 'task-004', task: 'Test survey instrument', phase: 'Pre-Field', quantQual: 'Quant', dateNotes: '', notes: '' },
                  { id: 'task-005', task: 'Launch data collection', phase: 'Fielding', quantQual: 'Quant', dateNotes: '', notes: '' },
                  { id: 'task-006', task: 'Monitor data collection', phase: 'Fielding', quantQual: 'Quant', dateNotes: '', notes: '' },
                  { id: 'task-007', task: 'Analyze quantitative data', phase: 'Post-Field Analysis', quantQual: 'Quant', dateNotes: '', notes: '' },
                  { id: 'task-008', task: 'Create final report', phase: 'Post-Field Analysis', quantQual: 'Quant', dateNotes: '', notes: '' }
                ];
              
              // Group tasks by phase
              const tasksByPhase = tasksToUse.reduce((acc: any, task: any) => {
                if (!acc[task.phase]) acc[task.phase] = [];
                acc[task.phase].push(task);
                return acc;
              }, {});

              // Create new tasks
              const newTasks: any[] = [];

              Object.entries(tasksByPhase).forEach(([phase, phaseTasks]: [string, any[]]) => {
                phaseTasks.forEach((taskData) => {
                  // Calculate due date only if dateNotes is not empty
                  let dueDate = null;
                  if (taskData.dateNotes && taskData.dateNotes.trim() !== '') {
                    if (project.segments && project.segments.length > 0) {
                      const phaseSegment = project.segments.find(s => s.phase === phase);
                      if (phaseSegment && phaseSegment.startDate) {
                        // Use the dateCalculator to properly calculate due dates
                        const { calculateTaskDueDate } = require('./lib/dateCalculator');
                        try {
                          dueDate = calculateTaskDueDate(phaseSegment.startDate, taskData.dateNotes);
                        } catch (error) {
                          console.log(`Could not calculate due date for task ${taskData.id}: ${taskData.dateNotes}`);
                        }
                      }
                    }
                  }

                  newTasks.push({
                    id: taskData.id,
                    description: taskData.task,
                    phase: taskData.phase,
                    status: 'pending',
                    assignedTo: [],
                    dueDate: dueDate,
                    notes: taskData.notes || '',
                    isOngoing: false,
                    dateNotes: taskData.dateNotes || '',
                    // No existing data - completely fresh
                  });
                });
              });

              console.log(`✅ Replaced ${project.tasks.length} old tasks with ${newTasks.length} new ${isQualitativeProject ? 'qualitative' : 'quantitative'} tasks for project: ${project.name}`);
              
              return {
                ...project,
                tasks: newTasks
              };
            }

            return project;
          });
        };

        // Migrate legacy task assignedTo from string to array
        const migrateTaskAssignees = (projects: Project[]) => {
          return projects.map(project => ({
            ...project,
            tasks: project.tasks.map((task: any) => {
              // If assignedTo is a string or null, convert to array
              if (typeof task.assignedTo === 'string') {
                return { ...task, assignedTo: [task.assignedTo] };
              } else if (task.assignedTo === null || task.assignedTo === undefined) {
                return { ...task, assignedTo: undefined };
              }
              // Already an array or undefined
              return task;
            })
          }));
        };

        // Mark ongoing tasks based on their descriptions from the JSON file
        const markOngoingTasks = (projects: Project[]) => {
          // Get ongoing task descriptions from the JSON file
          const ongoingTaskDescriptions = [
            "Keep internal team aligned on roles, deliverables, and client expectations throughout kickoff.",
            "Confirm all client expectations are documented before launch",
            "Ensure version control across QNR revisions",
            "Soft data quality check (10% of total sample), continue quality checks throughout",
            "Monitor completes and update quotas as needed",
            "Monitor open end comments for AEs and submit within 24 hours",
            "Ensure timely completion of field, troubleshoot as needed",
            "Confirm all deliverables are complete and documented for handoff to reporting",
            "Maintain consistent story flow and formatting across deliverables",
            "Ensure alignment between internal team, moderator, and recruiter on study objectives",
            "Ensure communication between client, recruiter, and moderator stays open and current",
            "Continue updating report shell with interview content",
            "Submit AE reports within 24 hours",
            "Manage stimuli changes",
            "Download audio files and transcripts daily",
            "Track high-level findings for client",
            "Ensure objectives are being met",
            "Engage with moderator and ask probes",
            "Document learnings and summarize key qualitative themes",
            "Focus on storytelling clarity and actionable insights",
            "Ensure findings tie back to research objectives"
          ];

          return projects.map(project => ({
            ...project,
            tasks: project.tasks.map((task: any) => {
              const taskDescription = task.description || task.content || '';
              const isOngoingTask = ongoingTaskDescriptions.some(ongoingDesc => 
                taskDescription.toLowerCase().includes(ongoingDesc.toLowerCase()) ||
                ongoingDesc.toLowerCase().includes(taskDescription.toLowerCase())
              );
              
              return {
                ...task,
                isOngoing: isOngoingTask || task.isOngoing || false
              };
            })
          }));
        };

        // Fix timezone issues and regenerate key dates for all projects
        const projectsFiltered = filterProjectCreator(data.projects || []);
        const projectsWithCA = addDemoContentAnalyses(projectsFiltered);
        const projectsWithMigratedTasks = migrateTaskAssignees(projectsWithCA);
        const projectsWithOngoingTasks = markOngoingTasks(projectsWithMigratedTasks);
        // DISABLED: const projectsWithCorrectedTasks = updateProjectsWithCorrectedTasks(projectsWithOngoingTasks);
        const projectsWithCorrectedTasks = projectsWithOngoingTasks;
        
        // Save updated projects to backend if any were modified
        const saveUpdatedProjects = async () => {
          try {
            const modifiedProjects = projectsWithCorrectedTasks.filter((project, index) => {
              const originalProject = projectsWithOngoingTasks[index];
              const isModified = JSON.stringify(project.tasks) !== JSON.stringify(originalProject.tasks);
              return isModified;
            });
            
            if (modifiedProjects.length > 0) {
              for (const project of modifiedProjects) {
                const response = await fetch(`${API_BASE_URL}/api/projects/${project.id}`, {
                  method: 'PUT',
                  headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${localStorage.getItem('cognitive_dash_token')}`
                  },
                  body: JSON.stringify({
                    userId: user?.id,
                    project: project
                  })
                });
              }
            } else {
              // Force save all qualitative projects if no modifications detected
              const qualitativeProjects = projectsWithCorrectedTasks.filter(project => {
                const isQualitativeProject = project.methodologyType === 'Qualitative' || 
                  project.methodologyType === 'Qual' ||
                  (project.name && project.name.toLowerCase().includes('qual'));
                return isQualitativeProject;
              });
              
              for (const project of qualitativeProjects) {
                const response = await fetch(`${API_BASE_URL}/api/projects/${project.id}`, {
                  method: 'PUT',
                  headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${localStorage.getItem('cognitive_dash_token')}`
                  },
                  body: JSON.stringify({
                    userId: user?.id,
                    project: project
                  })
                });
              }
            }
          } catch (error) {
            console.error('Error saving updated projects:', error);
          }
        };
        
        // DISABLED: Save updated projects in the background
        // saveUpdatedProjects();
        
        const updatedProjects = projectsWithCorrectedTasks.map(project => {
          const fixedProject = fixProjectSegments(project);
          const fixedFieldingSegment = fixedProject.segments?.find(s => s.phase === 'Fielding');
          const projectWithKeyDates = regenerateKeyDates(fixedProject);
          
          // Handle archived projects - set to Complete
          if (project.archived) {
            return {
              ...projectWithKeyDates,
              phase: 'Complete' as Phase
            };
          }
          
          // Check if project is before kickoff
          const kickoffDate = projectWithKeyDates.keyDeadlines?.find(kd => 
            kd.label.includes('Kickoff') || kd.label.includes('Project Kickoff')
          )?.date;
          
          if (kickoffDate && kickoffDate !== 'Invalid Date') {
            const today = new Date();
            const koDate = new Date(kickoffDate);
            
            // Check if before kickoff
            if (today < koDate) {
              return {
                ...projectWithKeyDates,
                phase: 'Awaiting KO' as Phase
              };
            }
          }
          
          // Check if project is overdue (past final report date)
          const finalReportDate = projectWithKeyDates.keyDeadlines?.find(kd => 
            kd.label.includes('Final Report') || kd.label.includes('Report')
          )?.date;
          
          if (finalReportDate && finalReportDate !== 'Invalid Date') {
            const today = new Date();
            const reportDate = new Date(finalReportDate);
            
            // Check if report date has passed
            if (reportDate < today) {
              // Project has passed its end date but hasn't been marked as complete
              return {
                ...projectWithKeyDates,
                phase: 'Reporting' as Phase // Set to final actual phase instead of artificial "Pending Completion"
              };
            }
          }
          
          return projectWithKeyDates;
        });
        setProjects(updatedProjects);
        
        // Update projects in backend with corrected key dates
        for (const project of updatedProjects) {
          try {
            await fetch(`${API_BASE_URL}/api/projects/${project.id}`, {
              method: 'PUT',
              headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${localStorage.getItem('cognitive_dash_token')}`
              },
              body: JSON.stringify({
                userId: user.id,
                project: project
              })
            });
          } catch (error) {
            console.error('Error updating project key dates:', error);
          }
        }
      } else {
        console.error('Failed to load projects');
        setProjects([]);
      }
    } catch (error) {
      console.error('Error loading projects:', error);
      setProjects([]);
    } finally {
      setLoadingProjects(false);
    }
  }, [user?.id]);

  // Load saved content analyses
  const loadSavedContentAnalyses = useCallback(async () => {
    try {
      const response = await fetch(`${API_BASE_URL}/api/caX/saved`, {
        headers: { 'Authorization': `Bearer ${localStorage.getItem('cognitive_dash_token')}` }
      });
      if (response.ok) {
        const analyses = await response.json();
        setSavedContentAnalyses(analyses);
      }
    } catch (error) {
      console.error('Error loading saved content analyses:', error);
    }
  }, []);

  // Load projects when user logs in
  useEffect(() => {
    try {
      const params = new URLSearchParams(window.location.search);
      const r = params.get('route');
      if (r) setRoute(r);
    } catch {}
    loadProjects();
    loadSavedContentAnalyses();
  }, [loadProjects, loadSavedContentAnalyses]);

  // Listen for project updates (e.g., when content analysis is saved)
  useEffect(() => {
    const handleProjectUpdate = () => {
      loadSavedContentAnalyses();
    };

    window.addEventListener('projectUpdated', handleProjectUpdate);
    return () => window.removeEventListener('projectUpdated', handleProjectUpdate);
  }, [loadSavedContentAnalyses]);

  // Force refresh function for debugging
  const forceRefreshProjects = useCallback(async () => {
    await loadProjects();
  }, [loadProjects]);

  const handleProjectCreated = (newProject: Project) => {
    setProjects(prev => [...prev, newProject]);
    // Reload projects from backend to ensure consistency
    loadProjects();
    // Redirect to Project Hub after successful creation
    setRoute('Project Hub');
  };

  const handleProjectView = (project: Project) => {
    console.log('handleProjectView called for:', project.name);
    // Show loading immediately and set the project to navigate to
    setIsNavigatingToProject(true);
    setProjectToNavigate(project);
    // Navigate to Project Hub
    setRoute("Project Hub");
    // Keep loading visible for the full transition duration
    setTimeout(() => {
      setIsNavigatingToProject(false);
      // Clear the project after navigation completes
      setTimeout(() => {
        setProjectToNavigate(null);
      }, 100);
    }, 1500);
  };

  const handleArchiveProject = async (projectId: string) => {
    if (!user?.id) {
      alert('User not authenticated. Please log in again.');
      return;
    }

    if (confirm('Are you sure you want to archive this project? It will be moved to archived projects.')) {
      try {
        const response = await fetch(`${API_BASE_URL}/api/projects/${projectId}/archive`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ userId: user.id }),
          credentials: 'include'
        });

        if (response.ok) {
          setProjects(projects.filter(p => p.id !== projectId));
          alert('Project archived successfully!');
        } else {
          console.error('Failed to archive project');
          alert('Failed to archive project. Please try again.');
        }
      } catch (error) {
        console.error('Error archiving project:', error);
        alert('Error archiving project. Please try again.');
      }
    }
  };

  const mainNav = useMemo(
    () => [
      { name: "Home", icon: HomeIcon },
      { name: "Project Hub", icon: FolderIcon },
      { name: "Vendor Library", icon: UserGroupIcon },
    ],
    []
  );

  const qualitativeTools = useMemo(
    () => [
      { name: "Transcripts", icon: IconScript },
      { name: "Content Analysis", icon: IconTable },
      { name: "Storytelling", icon: IconBook2 },
    ],
    []
  );

  const quantitativeTools = useMemo(
    () => [
      { name: "Stat Testing", icon: IconChartBar },
      { name: "Open-End Coding", icon: IconCode },
      { name: "QNR (Coming Soon)", icon: IconCheckbox, disabled: true },
      { name: "Data QA (Coming Soon)", icon: IconDatabaseExclamation, disabled: true },
    ],
    []
  );

  const adminNav = useMemo(
    () => user?.role === 'admin' ? [{ name: "Admin Center", icon: Cog6ToothIcon }] : [],
    [user?.role]
  );

  // Auto-open tools dropdown when a tool is selected
  useEffect(() => {
    if (qualitativeTools.some(item => route === item.name)) {
      setQualToolsDropdownOpen(true);
    }
    if (quantitativeTools.some(item => route === item.name)) {
      setQuantToolsDropdownOpen(true);
    }
  }, [route, qualitativeTools, quantitativeTools]);

  return (
    <AuthWrapper>
    <div className="min-h-screen w-full flex bg-gray-50 text-gray-800">
      {/* Top Header - Full Width */}
      <div className="fixed top-0 left-0 right-0 z-50 bg-white border-b border-gray-200" style={{ height: '80px' }}>
        <div className="h-full flex items-center">
          {/* Left side - Logo area (matches sidebar logo height) */}
          <div className={`flex items-center border-r border-gray-200 ${sidebarOpen ? 'pr-4' : ''}`} style={{ width: sidebarOpen ? '256px' : '80px', height: '80px' }}>
            <div className="flex items-center justify-center w-full">
              <img
                src={sidebarOpen ? "/CogDashLogo.png" : "/Circle.png"}
                alt="Cognitive Dash Logo"
                className={`object-contain transition-all cursor-pointer hover:opacity-70 ${sidebarOpen ? "h-16 w-full max-w-48" : "h-12 w-12"}`}
                onClick={() => setSidebarOpen(!sidebarOpen)}
              />
            </div>
          </div>
          
          {/* Right side - Header content */}
          <div className="flex-1 flex items-center justify-between px-6">
            {/* Page Title - show on all pages */}
            {route === "Home" && (
              <div className="flex items-center gap-3">
                <h1 className="text-2xl font-bold" style={{ color: BRAND.gray }}>Hello {user?.name?.split(' ')[0] || 'User'}!</h1>
              </div>
            )}
            {route === "Project Hub" && (
              <div className="flex items-center gap-3">
                {currentSelectedProject && isViewingProjectDetails ? (
                  <>
                    <h1 className="text-2xl font-bold" style={{ color: BRAND.gray }}>
                      {currentSelectedProject.name}
                    </h1>
                    <span className="px-3 py-1 rounded-full text-sm font-medium text-white shadow-sm opacity-60" style={{ background: getProjectStatus(currentSelectedProject).color }}>
                      {getPhaseDisplayName(getProjectStatus(currentSelectedProject).phase)}
                    </span>
                  </>
                ) : (
                  <h1 className="text-2xl font-bold" style={{ color: BRAND.gray }}>Project Hub</h1>
                )}
              </div>
            )}
            {route === "Vendor Library" && (
              <div className="flex items-center gap-3">
                <h1 className="text-2xl font-bold" style={{ color: BRAND.gray }}>Vendor Library</h1>
              </div>
            )}
            {route === "Transcripts" && (
              <div className="flex items-center gap-3">
                <h1 className="text-2xl font-bold" style={{ color: BRAND.gray }}>Transcripts</h1>
              </div>
            )}
            {route === "Content Analysis" && (
              <div className="flex items-center gap-3">
                <h1 className="text-2xl font-bold" style={{ color: BRAND.gray }}>Content Analysis</h1>
              </div>
            )}
            {route === "Storytelling" && (
              <div className="flex items-center gap-3">
                <h1 className="text-2xl font-bold" style={{ color: BRAND.gray }}>Storytelling</h1>
              </div>
            )}
            {route === "Stat Testing" && (
              <div className="flex items-center gap-3">
                <h1 className="text-2xl font-bold" style={{ color: BRAND.gray }}>Statistical Testing</h1>
              </div>
            )}
            {route === "Open-End Coding" && (
              <div className="flex items-center gap-3">
                <h1 className="text-2xl font-bold" style={{ color: BRAND.gray }}>Open-End Coding</h1>
              </div>
            )}
            
            {/* Spacer for non-Home pages to push icon to the right */}
            {route !== "Home" && route !== "Project Hub" && route !== "Vendor Library" && route !== "Transcripts" && route !== "Content Analysis" && route !== "Storytelling" && route !== "Stat Testing" && <div className="flex-grow"></div>}
            
            {/* Right side elements grouped together */}
            <div className="flex items-center gap-2">
              
              {/* Notification Bell */}
              <NotificationBell
                notifications={notifications}
                unreadCount={notificationService.getUnreadCount()}
                onNotificationClick={handleNotificationClick}
                onViewAllNotifications={handleViewAllNotifications}
                onMarkAsRead={handleMarkAsRead}
              />
              
              {/* User Profile Dropdown */}
            <div className="relative" data-profile-dropdown>
              <button
                onClick={() => setShowProfileDropdown(!showProfileDropdown)}
                className="w-10 h-10 rounded-full flex items-center justify-center hover:opacity-80 transition-opacity shadow-md" 
                style={{ backgroundColor: BRAND.orange }}
              >
                <span className="text-white text-base font-bold">
                  {user?.name ? user.name.split(' ').map(n => n.charAt(0)).join('') : 'U'}
                </span>
              </button>

              {/* Dropdown Menu */}
              {showProfileDropdown && (
                <div className="absolute right-0 mt-2 w-48 bg-white rounded-lg shadow-lg border border-gray-200 py-1 z-50">
                  <div className="px-4 py-2 border-b border-gray-100">
                    <div className="text-sm font-medium text-gray-900 truncate">{user?.name || 'User'}</div>
                    <div className="text-xs text-gray-500 truncate">{user?.email || 'user@example.com'}</div>
                  </div>
                  <button
                    onClick={() => {
                      logout();
                      setShowProfileDropdown(false);
                    }}
                    className="w-full text-left px-4 py-2 text-sm text-red-600 hover:bg-red-50 transition-colors flex items-center gap-2"
                  >
                    <ArrowRightOnRectangleIcon className="h-4 w-4" />
                    Sign out
                  </button>
                </div>
              )}
            </div>
            </div>
          </div>
        </div>
      </div>

      {/* Mobile backdrop overlay - only on very small screens */}
      {sidebarOpen && (
        <div 
          className="sm:hidden fixed inset-0 bg-black bg-opacity-50 z-30"
          onClick={() => setSidebarOpen(false)}
        />
      )}
      <aside
          className={`${sidebarOpen ? "w-64" : "w-20"} ${sidebarOpen ? "flex" : "hidden lg:flex"} flex-col border-r bg-white/90 backdrop-blur-sm sticky top-0 h-screen flex-shrink-0 z-40`}
          style={{ width: sidebarOpen ? 256 : 80, minWidth: sidebarOpen ? 256 : 80, top: '80px', height: 'calc(100vh - 80px)' }}
        >
        {/* Logo area removed from sidebar since it's now in the header */}
        <nav className="p-2 space-y-1 overflow-y-auto flex-1">
          {/* Main Navigation */}
          {mainNav.map((item) => (
            <button
              key={item.name}
              onClick={() => setRoute(item.name)}
              className={`w-full flex items-center gap-3 rounded-xl px-3 py-2 hover:bg-gray-100 transition ${
                route === item.name ? "bg-gray-100" : ""
              } ${!sidebarOpen ? 'justify-center' : ''}`}
            >
              <item.icon className="h-5 w-5" />
              {sidebarOpen && <span className="text-sm font-medium">{item.name}</span>}
            </button>
          ))}

          {/* Qualitative Tools Dropdown */}
          <div className="space-y-1">
            <button
              onClick={() => setQualToolsDropdownOpen(!qualToolsDropdownOpen)}
              className={`w-full flex items-center gap-3 rounded-xl px-3 py-2 hover:bg-gray-100 transition ${
                qualitativeTools.some(item => route === item.name) ? "bg-gray-100" : ""
              } ${!sidebarOpen ? 'justify-center' : ''}`}
            >
              <WrenchScrewdriverIcon className="h-5 w-5" />
              {sidebarOpen && (
                <>
                  <span className="text-sm font-medium">Qualitative Tools</span>
                  {qualToolsDropdownOpen ? (
                    <ChevronUpIcon className="h-4 w-4 ml-auto" />
                  ) : (
                    <ChevronDownIcon className="h-4 w-4 ml-auto" />
                  )}
                </>
              )}
            </button>
            
            {/* Qualitative Tools Dropdown Items */}
            {sidebarOpen && qualToolsDropdownOpen && (
              <div className="ml-4 space-y-1">
                {qualitativeTools.map((item) => (
                  <button
                    key={item.name}
                    onClick={() => setRoute(item.name)}
                    className={`w-full flex items-center gap-3 rounded-xl px-3 py-2 hover:bg-gray-100 transition ${
                      route === item.name ? "bg-gray-100" : ""
                    }`}
                  >
                    <item.icon className="h-4 w-4" />
                    <span className="text-sm font-medium">{item.name}</span>
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Quantitative Tools Dropdown */}
          <div className="space-y-1">
            <button
              onClick={() => setQuantToolsDropdownOpen(!quantToolsDropdownOpen)}
              className={`w-full flex items-center gap-3 rounded-xl px-3 py-2 hover:bg-gray-100 transition ${
                quantitativeTools.some(item => route === item.name) ? "bg-gray-100" : ""
              } ${!sidebarOpen ? 'justify-center' : ''}`}
            >
              <WrenchScrewdriverIcon className="h-5 w-5" />
              {sidebarOpen && (
                <>
                  <span className="text-sm font-medium">Quantitative Tools</span>
                  {quantToolsDropdownOpen ? (
                    <ChevronUpIcon className="h-4 w-4 ml-auto" />
                  ) : (
                    <ChevronDownIcon className="h-4 w-4 ml-auto" />
                  )}
                </>
              )}
            </button>
            
            {/* Quantitative Tools Dropdown Items */}
            {sidebarOpen && quantToolsDropdownOpen && (
              <div className="ml-4 space-y-1">
                {quantitativeTools.map((item) => (
                  <button
                    key={item.name}
                    onClick={() => !item.disabled && setRoute(item.name)}
                    disabled={item.disabled}
                    className={`w-full flex items-center gap-3 rounded-xl px-3 py-2 transition ${
                      item.disabled 
                        ? "opacity-50 cursor-not-allowed text-gray-400" 
                        : `hover:bg-gray-100 ${route === item.name ? "bg-gray-100" : ""}`
                    }`}
                  >
                    <item.icon className="h-4 w-4" />
                    <span className="text-sm font-medium">{item.name}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        </nav>
        
        {/* Admin Center - Bottom of sidebar */}
        {adminNav.length > 0 && (
          <div className="p-2 border-t">
            {adminNav.map((item) => (
              <button
                key={item.name}
                onClick={() => setRoute(item.name)}
                className={`w-full flex items-center gap-3 rounded-xl px-3 py-2 hover:bg-gray-100 transition relative ${
                  route === item.name ? "bg-gray-100" : ""
                } ${!sidebarOpen ? 'justify-center' : ''}`}
              >
                <item.icon className="h-5 w-5" />
                {sidebarOpen && <span className="text-sm font-medium">{item.name}</span>}
                {adminNotificationCount > 0 && (
                  <div
                    className="flex items-center justify-center text-white text-xs font-bold rounded-full min-w-[20px] h-5 px-1.5"
                    style={{
                      backgroundColor: '#D14A2D',
                      position: sidebarOpen ? 'relative' : 'absolute',
                      top: sidebarOpen ? 'auto' : '4px',
                      right: sidebarOpen ? 'auto' : '4px',
                      marginLeft: sidebarOpen ? 'auto' : '0'
                    }}
                  >
                    {adminNotificationCount}
                  </div>
                )}
              </button>
            ))}
          </div>
        )}
        
        {/* Report bug and feature request links */}
        <div className={`mt-auto p-3 border-t ${!sidebarOpen ? 'flex justify-center' : ''}`}>
          <div className={`flex items-center gap-3 ${!sidebarOpen ? 'mb-0' : ''}`}>
            {sidebarOpen && (
              <div className="flex-1 min-w-0">
                <div className="text-xs text-gray-600 space-x-3">
                  <button
                    className="underline hover:text-gray-800"
                    onClick={() => { try { window.history.replaceState(null, '', '?route=Feedback&type=bug'); } catch {} setRoute('Feedback'); }}
                  >
                    Report bug
                  </button>
                  <button
                    className="underline hover:text-gray-800"
                    onClick={() => { try { window.history.replaceState(null, '', '?route=Feedback&type=feature'); } catch {} setRoute('Feedback'); }}
                  >
                    Feature request
                  </button>
                </div>
              </div>
            )}
            {/* When collapsed, show only a small icon or indicator */}
            {!sidebarOpen && (
              <button
                className="w-8 h-8 rounded-full flex items-center justify-center hover:bg-gray-100 transition-colors"
                onClick={() => { try { window.history.replaceState(null, '', '?route=Feedback&type=bug'); } catch {} setRoute('Feedback'); }}
                title="Report bug"
              >
                <svg className="h-4 w-4 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L3.732 16.5c-.77.833.192 2.5 1.732 2.5z" />
                </svg>
              </button>
            )}
          </div>
        </div>
      </aside>

      {route === "Content Analysis" || route === "content-analysis" ? (
        <ContentAnalysisX 
          projects={projects} 
          onNavigate={setRoute} 
          onNavigateToProject={handleProjectView}
          analysisToLoad={analysisToLoad}
          onAnalysisLoaded={() => setAnalysisToLoad(null)}
          onNavigateToStorytelling={(analysisId, projectId) => {
            setCurrentAnalysisId(analysisId);
            setCurrentProjectId(projectId);
            setRoute("Storytelling");
          }}
          currentProjectId={currentProjectId}
        />
      ) : route === "Transcripts" || route === "transcripts" ? (
        <Transcripts onNavigate={setRoute} setAnalysisToLoad={setAnalysisToLoad} />
      ) : route === "Storytelling" || route === "storytelling" ? (
        <Storytelling analysisId={currentAnalysisId} projectId={currentProjectId} />
      ) : route === "Stat Testing" ? (
        <StatTesting />
      ) : route === "Open-End Coding" ? (
        <OpenEndCoding />
      ) : route === "QNR" || route === "qnr" ? (
        <QuestionnaireParser />
      ) : (
        <main className="flex-1 overflow-visible min-w-0" style={{ background: BRAND.bg, marginTop: '80px' }}>
          {/* Mobile menu button - only visible on very small screens */}
          <div className="sm:hidden fixed top-20 left-4 z-50">
            <button
              onClick={() => setSidebarOpen(!sidebarOpen)}
              className="p-2 bg-white rounded-lg shadow-lg border border-gray-200 hover:bg-gray-50 transition-colors"
            >
              <Bars3Icon className="h-6 w-6" style={{ color: BRAND.gray }} />
            </button>
          </div>
          <div className="p-5 overflow-y-auto w-full min-w-0" style={{ height: 'calc(100vh - 80px)' }}>
            {isNavigatingToProject || isLoadingProjectFile ? (
              <div className="flex items-center justify-center h-screen">
                <div className="text-center">
                  <div className="w-16 h-16 flex items-center justify-center mx-auto mb-4">
                    <svg className="animate-spin" width="48" height="48" viewBox="0 0 48 48">
                      <circle cx="24" cy="24" r="20" fill="none" stroke="#D14A2D" strokeWidth="4" strokeDasharray="50 75.4" strokeDashoffset="0" />
                      <circle cx="24" cy="24" r="20" fill="none" stroke="#5D5F62" strokeWidth="4" strokeDasharray="50 75.4" strokeDashoffset="-62.7" />
                    </svg>
                  </div>
                  <p className="text-gray-500">{isNavigatingToProject ? 'Loading project...' : 'Loading content...'}</p>
                </div>
              </div>
            ) : (
              <>
                {route === "Home" && user?.role === 'oversight' && <OversightDashboard projects={projects} loading={loadingProjects} onProjectCreated={handleProjectCreated} onNavigateToProject={handleProjectView} setRoute={setRoute} />}
                {route === "Home" && user?.role !== 'oversight' && <Dashboard projects={projects} loading={loadingProjects} onProjectCreated={handleProjectCreated} onNavigateToProject={handleProjectView} setRoute={setRoute} />}
                {route === "Feedback" && <Feedback defaultType={(new URLSearchParams(window.location.search).get('type') as any) || 'bug'} />}
                {route === "Project Hub" && <ProjectHub projects={projects} onProjectCreated={handleProjectCreated} onArchive={handleArchiveProject} setProjects={setProjects} savedContentAnalyses={savedContentAnalyses} setRoute={setRoute} setAnalysisToLoad={setAnalysisToLoad} setIsLoadingProjectFile={setIsLoadingProjectFile} initialProject={projectToNavigate} setCurrentSelectedProject={setCurrentSelectedProject} setIsViewingProjectDetails={setIsViewingProjectDetails} />}
              </>
            )}
            {route === "Vendor Library" && <VendorLibrary projects={projects} />}
            {route === "Admin Center" && <AdminCenter onProjectUpdate={loadProjects} />}
            {route === "QNR" && <QuestionnaireParser projects={projects} />}
            {route !== "Home" && route !== "Project Hub" && route !== "Content Analysis" && route !== "Vendor Library" && route !== "Admin Center" && route !== "Feedback" && route !== "QNR" && <Placeholder name={route} />}
          </div>
        </main>
      )}

      {/* Notification Center Modal */}
      {showNotificationCenter && (
        <NotificationCenter
          notifications={notifications}
          onNotificationClick={handleNotificationClick}
          onMarkAllAsRead={handleMarkAllAsRead}
          onClose={() => setShowNotificationCenter(false)}
        />
      )}
    </div>
    </AuthWrapper>
  );

}

// Dashboard component defined outside App
function Dashboard({ projects, loading, onProjectCreated, onNavigateToProject, setRoute }: { projects: Project[]; loading?: boolean; onProjectCreated?: (project: Project) => void; onNavigateToProject?: (project: Project) => void; setRoute?: (route: string) => void }) {
  const { user } = useAuth();
  const [showProjectWizard, setShowProjectWizard] = useState(false);
  const [allProjects, setAllProjects] = useState<Project[]>([]);
  const [loadingAllProjects, setLoadingAllProjects] = useState(false);
  const [showAllProjects, setShowAllProjects] = useState(false);
  const [showMyProjectsOnly, setShowMyProjectsOnly] = useState(true);
  const [moderatorDateRange, setModeratorDateRange] = useState('');
  const [vendorsData, setVendorsData] = useState<any>(null);
  
  // Calendar state
  const [currentMonth, setCurrentMonth] = useState(new Date().getMonth());
  const [currentYear, setCurrentYear] = useState(new Date().getFullYear());
  const [selectedDate, setSelectedDate] = useState<Date | null>(null);
  const [taskListStartDate, setTaskListStartDate] = useState<Date>(new Date());
  
  
  // Calendar navigation functions
  const navigateMonth = (direction: 'prev' | 'next') => {
    if (direction === 'prev') {
      if (currentMonth === 0) {
        setCurrentMonth(11);
        setCurrentYear(currentYear - 1);
      } else {
        setCurrentMonth(currentMonth - 1);
      }
    } else {
      if (currentMonth === 11) {
        setCurrentMonth(0);
        setCurrentYear(currentYear + 1);
      } else {
        setCurrentMonth(currentMonth + 1);
      }
    }
  };
  
  const handleDateClick = (day: number) => {
    const clickedDate = new Date(currentYear, currentMonth, day);
    setSelectedDate(clickedDate);
    setTaskListStartDate(clickedDate);
  };
  
  const [expandedTaskSections, setExpandedTaskSections] = useState<{
    todayMy: boolean;
    todayAdditional: boolean;
    laterMy: boolean;
    laterAdditional: boolean;
  }>({
    todayMy: false,
    todayAdditional: false,
    laterMy: false,
    laterAdditional: false
  });

  // Refs for dynamic task calculation
  const todayTasksRef = useRef<HTMLDivElement>(null);
  const laterWeekTasksRef = useRef<HTMLDivElement>(null);

  // Function to calculate maximum tasks based on container height
  const calculateMaxTasks = useCallback((containerRef: React.RefObject<HTMLDivElement>, fallbackMax: number = 8) => {
    if (!containerRef.current) return fallbackMax;
    
    const container = containerRef.current;
    const containerHeight = container.offsetHeight;
    const taskItemHeight = 24; // Approximate height of each task item (including padding and spacing)
    const padding = 16; // Account for container padding
    const availableHeight = containerHeight - padding;
    const maxTasks = Math.floor(availableHeight / taskItemHeight);
    
    return Math.max(1, Math.min(maxTasks, 20)); // Min 1, max 20 tasks
  }, []);

  // Function to calculate max tasks for fixed height containers (280px)
  const calculateMaxTasksFixed = useCallback((containerHeight: number = 280) => {
    // Conservative calculation to prevent text cutoff
    const headerHeight = 90; // Header height (icon + title + padding)
    const taskItemHeight = 32; // Height per task item (accounts for text wrapping)
    const padding = 32; // Container padding
    const availableHeight = containerHeight - headerHeight - padding;
    const maxTasks = Math.floor(availableHeight / taskItemHeight);
    
    return Math.max(1, maxTasks); // No hard maximum limit
  }, []);

  // Force re-render when window is resized to recalculate task limits
  const [, forceUpdate] = useState({});
  useEffect(() => {
    const handleResize = () => {
      forceUpdate({});
    };
    
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);
  const [sampleTooltip, setSampleTooltip] = useState<{ visible: boolean; x: number; y: number; items: string[] } | null>(null);

  // Fetch all projects across all users
  const loadAllProjects = useCallback(async () => {
    setLoadingAllProjects(true);
    try {
      const response = await fetch(`${API_BASE_URL}/api/projects/all`, {
        headers: { 'Authorization': `Bearer ${localStorage.getItem('cognitive_dash_token')}` }
      });
      if (response.ok) {
        const data = await response.json();
        setAllProjects(data.projects || []);
      } else {
        console.error('Failed to load all projects');
        setAllProjects([]);
      }
    } catch (error) {
      console.error('Error loading all projects:', error);
      setAllProjects([]);
    } finally {
      setLoadingAllProjects(false);
    }
  }, []);

  // Load vendors data
  const loadVendorsData = useCallback(async () => {
    try {
      const storedVendors = localStorage.getItem('cognitive_dash_vendors');
      if (storedVendors) {
        const data = JSON.parse(storedVendors);
        setVendorsData(data);
      } else {
        // If no vendors in localStorage, try to fetch from API
        const token = localStorage.getItem('cognitive_dash_token');
        if (token) {
          const resp = await fetch(`${API_BASE_URL}/api/vendors`, {
            headers: { 'Authorization': `Bearer ${token}` }
          });
          if (resp.ok) {
            const serverData = await resp.json();
            const data = {
              moderators: serverData.moderators || [],
              sampleVendors: serverData.sampleVendors || [],
              analytics: serverData.analytics || []
            };
            localStorage.setItem('cognitive_dash_vendors', JSON.stringify(data));
            setVendorsData(data);
          }
        }
      }
    } catch (error) {
      console.error('Error loading vendors data:', error);
    }
  }, []);

  // Load all projects when component mounts
  useEffect(() => {
    loadAllProjects();
    loadVendorsData();
  }, [loadAllProjects, loadVendorsData]);

  // When switching to "All Cognitive Projects", refresh from server to ensure latest
  useEffect(() => {
    if (!showMyProjectsOnly) {
      loadAllProjects();
    }
  }, [showMyProjectsOnly, loadAllProjects]);

  // Calculate project priorities and sort
  const prioritizedProjects = useMemo(() => {
    const now = new Date();
    // Include ALL projects regardless of phase - show Complete and Awaiting KO phases
    return projects
      .map(project => {
        // Get current phase based on timeline
        const getCurrentPhase = (project: Project): string => {
          if (!project.segments || project.segments.length === 0) {
            return project.phase; // Fallback to stored phase
          }
          const today = new Date();
          // Use UTC methods to get consistent date string
          const todayStr = today.getUTCFullYear() + '-' + 
                         String(today.getUTCMonth() + 1).padStart(2, '0') + '-' + 
                         String(today.getUTCDate()).padStart(2, '0');
          // Find which phase today falls into
          for (const segment of project.segments) {
            if (todayStr >= segment.startDate && todayStr <= segment.endDate) {
              return segment.phase;
            }
          }
          // If today is before the first phase, return the first phase
          if (todayStr < project.segments[0].startDate) {
            return project.segments[0].phase;
          }
          // If today is after the last phase, return the last phase
          if (todayStr > project.segments[project.segments.length - 1].endDate) {
            return project.segments[project.segments.length - 1].phase;
          }
          return project.phase; // Fallback
        };

        const currentPhase = getCurrentPhase(project);
        let priority = 0;
        let priorityReason = '';

        // Calculate deadline deltas for use in conditions below
        const endDate = new Date(project.endDate);
        const daysUntilDeadline = Math.ceil((endDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));

        // Phase-based priority
        if (currentPhase === 'Reporting') {
          priority = 100;
          priorityReason = 'Reporting phase - highest priority';
        } else if (currentPhase === 'Post-Field Analysis') {
          priority = 80;
          priorityReason = 'Post-field analysis - high priority';
        } else if (currentPhase === 'Fielding') {
          priority = 60;
          priorityReason = 'Fielding phase - medium-high priority';
        } else if (currentPhase === 'Pre-Field') {
          priority = 40;
          priorityReason = 'Pre-field phase - medium priority';
        } else if (currentPhase === 'Kickoff') {
          priority = 20;
          priorityReason = 'Kickoff phase - lower priority';
        } else if (currentPhase === 'Reporting' && daysUntilDeadline < 0) {
          priority = 90;
          priorityReason = 'Overdue project - high priority';
        } else if (currentPhase === 'Awaiting KO') {
          priority = 10;
          priorityReason = 'Awaiting kickoff - low priority';
        } else if (currentPhase === 'Complete') {
          priority = 0;
          priorityReason = 'Completed project - no priority';
        }
        
        // Dynamic reprioritization based on deadlines
        if (daysUntilDeadline <= 7) {
          priority += 50;
          priorityReason += ' - Deadline approaching';
        } else if (daysUntilDeadline <= 14) {
          priority += 25;
          priorityReason += ' - Deadline soon';
        }
        
        // Check for overdue tasks
        const overdueTasks = project.tasks.filter(task => {
          if (!task.dueDate) return false;
          const taskDueDate = new Date(task.dueDate);
          return taskDueDate < now && task.status !== 'completed';
        });
        
        if (overdueTasks.length > 0) {
          priority += 30;
          priorityReason += ' - Has overdue tasks';
        }
        
        return { ...project, phase: currentPhase, priority, priorityReason };
      })
      .sort((a, b) => b.priority - a.priority);
  }, [projects]);

  // Get tasks due this week
  const tasksThisWeek = useMemo(() => {
    const now = new Date();
    const weekFromNow = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
    
    return PROJECTS.flatMap(project => 
      project.tasks
        .filter(task => {
          if (!task.dueDate) return false;
          const taskDate = new Date(task.dueDate);
          return taskDate >= now && taskDate <= weekFromNow && task.status !== 'completed';
        })
        .map(task => ({ ...task, projectName: project.name, projectPhase: project.phase }))
    );
  }, []);

  // Get project deadlines this week
  const deadlinesThisWeek = useMemo(() => {
    const now = new Date();
    const weekFromNow = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
    
    return PROJECTS
      .filter(project => {
        const endDate = new Date(project.endDate);
        return endDate >= now && endDate <= weekFromNow;
      })
      .map(project => ({
        name: project.name,
        client: project.client,
        deadline: project.endDate,
        phase: project.phase
      }));
  }, []);

  const currentWeekLabel = useMemo(() => {
    const today = new Date();
    const dayOfWeek = today.getDay();
    const monday = new Date(today);
    monday.setDate(today.getDate() - dayOfWeek + (dayOfWeek === 0 ? -6 : 1));
    monday.setHours(0, 0, 0, 0);
    const friday = new Date(monday);
    friday.setDate(monday.getDate() + 4);
    const startText = monday.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    const endText = friday.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
    return `${startText} - ${endText}`;
  }, []);

  // Helper: Normalize date to YYYY-MM-DD
  const toYMD = (date: Date) => {
    const d = new Date(date);
    d.setHours(0, 0, 0, 0);
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  };

  

  // Resolve identifiers for current user to match task.assignedTo flexibly
  const myIdentifiers = useMemo(() => {
    if (!user) return [] as string[];
    const vals = [
      String((user as any)?.id || ''),
      String((user as any)?.email || ''),
      String((user as any)?.name || '')
    ]
      .filter(Boolean)
      .map(v => v.toLowerCase());
    return vals;
  }, [user]);

  const isAssignedToMe = useCallback((task: Task): boolean => {
    if (!task?.assignedTo || task.assignedTo.length === 0) return false;
    const normalize = (s: string) => String(s || '').trim().toLowerCase();
    const stripNonLetters = (s: string) => String(s || '').toLowerCase().replace(/[^a-z]/g, '');
    const extractEmail = (s: string) => {
      const m = String(s || '').match(/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/i);
      return m ? m[0].toLowerCase() : null;
    };
    const assigned = task.assignedTo.map(v => normalize(v));
    // Direct matches to my known identifiers
    if (myIdentifiers.some(id => assigned.includes(id))) return true;
    // Email embedded in string
    const myEmail = String((user as any)?.email || '').toLowerCase();
    if (myEmail) {
      for (const raw of task.assignedTo) {
        const email = extractEmail(String(raw));
        if (email && email === myEmail) return true;
      }
    }
    // Initials fallback (e.g., LB vs L.B.)
    const userName = String((user as any)?.name || '').trim();
    if (userName) {
      const myInitials = stripNonLetters(userName).split('').filter(Boolean).join('');
      if (myInitials) {
        for (const raw of task.assignedTo) {
          const candidate = stripNonLetters(String(raw));
          if (candidate && candidate === myInitials) return true;
        }
      }
    }
    return false;
  }, [myIdentifiers, user]);

  

  // Helper function to get final report date from project
  const getFinalReportDate = (project: Project): Date | null => {
    // First try to get from keyDeadlines
    const finalReportDeadline = project.keyDeadlines?.find(kd => 
      kd.label.toLowerCase().includes('final') || kd.label.toLowerCase().includes('report')
    );
    
    if (finalReportDeadline) {
      // Parse the MM/DD/YY format
      const [month, day, year] = finalReportDeadline.date.split('/').map(Number);
      const fullYear = year < 50 ? 2000 + year : 1900 + year;
      return new Date(fullYear, month - 1, day);
    }
    
    // Fallback to project end date
    if (project.endDate) {
      return new Date(project.endDate + 'T00:00:00');
    }
    
    return null;
  };

  // Filter projects based on user membership (by id, email, or name, or creator)
  const filteredProjects = useMemo(() => {
    if (showMyProjectsOnly) {
      if (!user) return allProjects; // fallback to avoid empty view when user not resolved
      const uid = String((user as any)?.id || '').toLowerCase();
      const uemail = String((user as any)?.email || '').toLowerCase();
      const uname = String((user as any)?.name || '').toLowerCase();
      return allProjects.filter(project => {
        const createdBy = String((project as any).createdBy || '').toLowerCase();
        const createdByMe = createdBy && (createdBy === uid || createdBy === uemail);
        const inTeam = (project.teamMembers || []).some((member: any) => {
          const mid = String(member?.id || '').toLowerCase();
          const memail = String(member?.email || '').toLowerCase();
          const mname = String(member?.name || '').toLowerCase();
          return (uid && mid === uid) || (uemail && memail === uemail) || (uname && mname === uname);
        });
        return createdByMe || inTeam;
      });
    }
    return allProjects;
  }, [allProjects, showMyProjectsOnly, user]);

  // Select which projects to source tasks from to stay live with edits
  const sourceProjects = useMemo(() => {
    return showMyProjectsOnly ? filteredProjects : allProjects;
  }, [showMyProjectsOnly, filteredProjects, allProjects]);

  // Sort projects by final report delivery date (closest first)
  const sortedProjects = useMemo(() => {
    return [...filteredProjects].sort((a, b) => {
      const dateA = getFinalReportDate(a);
      const dateB = getFinalReportDate(b);
      
      // If both have dates, sort by date (closest first)
      if (dateA && dateB) {
        return dateA.getTime() - dateB.getTime();
      }
      
      // If only one has a date, prioritize the one with a date
      if (dateA && !dateB) return -1;
      if (!dateA && dateB) return 1;
      
      // If neither has a date, maintain original order
      return 0;
    });
  }, [filteredProjects]);

  // Compute overdue, today's, and later-this-week tasks (after sourceProjects exists)
  const { overdueTasksAll, todayMyTasks, todayAdditionalTasks, laterWeekMyTasks, laterWeekAdditionalTasks, isNextWeek } = useMemo(() => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const todayYMD = toYMD(today);
    const dow = today.getDay(); // 0=Sunday, 1=Monday, ..., 5=Friday, 6=Saturday

    // Determine if we should show "Next Week" (Friday or later)
    const showNextWeek = dow >= 5; // Friday (5), Saturday (6), or Sunday (0 handled by >= 5)

    let endDate: Date;
    if (showNextWeek) {
      // Show next week Monday-Friday
      const nextMonday = new Date(today);
      const daysUntilNextMonday = dow === 0 ? 1 : (8 - dow); // Days until next Monday
      nextMonday.setDate(today.getDate() + daysUntilNextMonday);
      nextMonday.setHours(0, 0, 0, 0);

      endDate = new Date(nextMonday);
      endDate.setDate(nextMonday.getDate() + 4); // Friday of next week
      endDate.setHours(23, 59, 59, 999);
    } else {
      // Show "Later This Week" (after today up to Friday)
      endDate = new Date(today);
      const offsetToFriday = (dow === 0 ? 5 : 5 - dow); // Mon=1..Fri=5, Sun=0 -> 5
      endDate.setDate(today.getDate() + offsetToFriday);
      endDate.setHours(23, 59, 59, 999);
    }

    const overdue: any[] = [];
    const tMy: any[] = [];
    const tAdd: any[] = [];
    const lwMy: any[] = [];
    const lwAdd: any[] = [];

    const matchesUser = (task: any, project: any) => {
      // Fast path using direct helper
      if (isAssignedToMe(task)) return true;
      if (!task?.assignedTo || task.assignedTo.length === 0) return false;
      const normalize = (s: string) => String(s || '').trim().toLowerCase();
      const stripNonLetters = (s: string) => String(s || '').toLowerCase().replace(/[^a-z]/g, '');
      const assignedVals = task.assignedTo.map((v: any) => normalize(v));
      const myId = normalize(String((user as any)?.id || ''));
      const myEmail = normalize(String((user as any)?.email || ''));
      const myName = normalize(String((user as any)?.name || ''));
      const myInitials = myName ? stripNonLetters(myName) : '';
      for (const raw of assignedVals) {
        const val = raw;
        if (val && (val === myId || val === myEmail || val === myName || val === myInitials)) return true;
        // If looks like an email, compare to my email
        if (val.includes('@') && myEmail && val === myEmail) return true;
        // If this is a team member id, map to member and compare
        const member = (project?.teamMembers || []).find((m: any) => normalize(m?.id) === val || normalize(m?.name) === val || normalize(m?.email) === val);
        if (member) {
          const memName = normalize(String(member.name || ''));
          const memEmail = normalize(String(member.email || ''));
          if (memName && myName && memName === myName) return true;
          if (memEmail && myEmail && memEmail === myEmail) return true;
          const memInitials = memName ? stripNonLetters(memName) : '';
          if (memInitials && myInitials && memInitials === myInitials) return true;
        }
      }
      return false;
    };

    for (const project of sourceProjects) {
      for (const task of (project.tasks || [])) {
        if (!task?.dueDate) continue;
        const due = new Date(task.dueDate + 'T00:00:00');
        const dueYMD = toYMD(due);
        const isCompleted = task.status === 'completed';
        const mine = matchesUser(task, project);
        if (!isCompleted && due < today) {
          overdue.push({ ...task, projectName: project.name, mine });
          continue;
        }

        if (isCompleted) continue;

        // Today
        if (dueYMD === todayYMD) {
          (mine ? tMy : tAdd).push({ ...task, projectName: project.name, mine });
          continue;
        }

        // Later this week OR Next week
        if (showNextWeek) {
          // Next week: show Monday-Friday of next week
          const nextMonday = new Date(today);
          const daysUntilNextMonday = dow === 0 ? 1 : (8 - dow);
          nextMonday.setDate(today.getDate() + daysUntilNextMonday);
          nextMonday.setHours(0, 0, 0, 0);

          if (due >= nextMonday && due <= endDate) {
            (mine ? lwMy : lwAdd).push({ ...task, projectName: project.name, mine });
          }
        } else {
          // Later this week (after today up to Friday)
          if (due > today && due <= endDate) {
            (mine ? lwMy : lwAdd).push({ ...task, projectName: project.name, mine });
          }
        }
      }
    }

    // Sort for consistent display: by due time then project
    const byDueThenProj = (a: any, b: any) => {
      const da = new Date((a.dueDate || '') + 'T00:00:00').getTime();
      const db = new Date((b.dueDate || '') + 'T00:00:00').getTime();
      if (da !== db) return da - db;
      return String(a.projectName || '').localeCompare(String(b.projectName || ''));
    };

    tMy.sort(byDueThenProj);
    tAdd.sort(byDueThenProj);
    lwMy.sort(byDueThenProj);
    lwAdd.sort(byDueThenProj);

    // Overdue: prioritize my tasks first
    overdue.sort((a, b) => {
      const aMine = a.mine ? 0 : 1;
      const bMine = b.mine ? 0 : 1;
      if (aMine !== bMine) return aMine - bMine;
      return byDueThenProj(a, b);
    });

    return {
      overdueTasksAll: overdue,
      todayMyTasks: tMy,
      todayAdditionalTasks: tAdd,
      laterWeekMyTasks: lwMy,
      laterWeekAdditionalTasks: lwAdd,
      isNextWeek: showNextWeek
    };
  }, [sourceProjects, isAssignedToMe]);

  // Get projects to display (first 5 or all if showAllProjects is true)
  const displayedProjects = showAllProjects ? sortedProjects : sortedProjects.slice(0, 5);

  // State for the new design
  const [selectedProject, setSelectedProject] = useState<string | null>(null);

  // Get user's first name
  const firstName = user?.name?.split(' ')[0] || 'User';

  return (
    <div className="space-y-6 w-full max-w-full overflow-x-hidden">






      {/* Main Content Layout */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left Column - Key Dates, My Tasks, and Projects */}
        <div className="lg:col-span-2 flex flex-col gap-6">
            {/* My Tasks Section - Three Separate Boxes */}
            <div className="flex flex-col gap-4">
              {/* Overdue Tasks Box - Full Width - Only show if there are overdue tasks */}
              {(() => {
                const today = new Date();
                today.setHours(0, 0, 0, 0);

                // Group overdue tasks by project
                const overdueByProject = new Map<string, {
                  project: any;
                  tasks: Array<{
                    id: string;
                    description: string;
                    dueDate: string;
                    daysUntil: number;
                  }>;
                  totalCount: number;
                }>();

                projects.forEach(project => {
                  let projectOverdueTasks: Array<{
                    id: string;
                    description: string;
                    dueDate: string;
                    daysUntil: number;
                  }> = [];

                  project.tasks.forEach(task => {
                    const isAssignedToMe = task.assignedTo?.includes(user?.id || '') || false;

                    if (isAssignedToMe && task.status !== 'completed' && task.dueDate && !task.isOngoing) {
                      const taskDate = new Date(task.dueDate + 'T00:00:00');
                      const daysUntil = Math.ceil((taskDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));

                      if (daysUntil < 0) {
                        projectOverdueTasks.push({
                          id: task.id,
                          description: task.description || task.content || 'Untitled task',
                          dueDate: task.dueDate,
                          daysUntil: daysUntil
                        });
                      }
                    }
                  });

                  if (projectOverdueTasks.length > 0) {
                    overdueByProject.set(project.name, {
                      project: project,
                      tasks: projectOverdueTasks,
                      totalCount: projectOverdueTasks.length
                    });
                  }
                });

                // Only render the box if there are overdue tasks
                if (overdueByProject.size === 0) {
                  return null;
                }

                // Calculate total overdue tasks across all projects
                const totalOverdueTasks = Array.from(overdueByProject.values()).reduce((sum, project) => sum + project.totalCount, 0);

                return (
                  <div className="bg-red-50 rounded-lg border border-red-200 overflow-hidden flex flex-col flex-shrink-0">
                    <div className="flex items-center justify-between px-4 py-3 border-b border-red-200 flex-shrink-0 bg-red-100">
                      <h3 className="text-lg font-semibold text-red-700">Overdue Tasks ({totalOverdueTasks})</h3>
                    </div>
                    <div className="p-2 flex-1 min-h-0 overflow-hidden">
                      <div className="space-y-2">
                        {Array.from(overdueByProject.values()).map((projectData, index) => (
                          <div
                            key={`overdue-project-${projectData.project.id}-${index}`}
                            className="flex items-center justify-between p-3 bg-red-50 border border-red-100 rounded cursor-pointer hover:bg-red-100 transition-colors"
                            onClick={() => {
                              if (onNavigateToProject) {
                                onNavigateToProject(projectData.project);
                              }
                            }}
                          >
                            <div className="flex-1 min-w-0">
                              <div className="text-xs font-medium text-gray-900 truncate">
                                {projectData.project.name}
                              </div>
                              <div className="text-xs text-gray-500 truncate">
                                {projectData.project.client}
                              </div>
                            </div>
                            <div className="flex items-center gap-2 flex-shrink-0 ml-3">
                              <div className="bg-red-600 text-white text-xs font-bold px-2 py-1 rounded-full min-w-[20px] text-center">
                                {projectData.totalCount}
                              </div>
                              <svg className="w-4 h-4 text-red-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                              </svg>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                );
              })()}

              {/* Today's Tasks and Ongoing Tasks - Side by Side */}
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                {/* Today's Tasks Box */}
                <div className="bg-white rounded-lg border border-gray-200 overflow-hidden max-h-80 flex flex-col flex-shrink-0">
                  <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200 flex-shrink-0" style={{ backgroundColor: BRAND.orange }}>
                    <h3 className="text-lg font-semibold text-white">Today's Tasks</h3>
                  </div>
                  <div className="p-4 flex-1 min-h-0 overflow-hidden">
                    <div className="overflow-y-auto light-scrollbar h-full">
                      {(() => {
                        const today = new Date();
                        today.setHours(0, 0, 0, 0);

                        let todayTasks: Array<{
                          id: string;
                          description: string;
                          project: string;
                          dueDate?: string;
                        }> = [];

                        projects.forEach(project => {
                          project.tasks.forEach(task => {
                            const isAssignedToMe = task.assignedTo?.includes(user?.id || '') || false;

                            if (isAssignedToMe && task.status !== 'completed' && task.dueDate && !task.isOngoing) {
                              const taskDate = new Date(task.dueDate + 'T00:00:00');
                              const todayDate = new Date(today.getFullYear(), today.getMonth(), today.getDate());

                              if (taskDate.getTime() === todayDate.getTime()) {
                                todayTasks.push({
                                  id: task.id,
                                  description: task.description || task.content || 'Untitled task',
                                  project: project.name,
                                  dueDate: task.dueDate
                                });
                              }
                            }
                          });
                        });

                        todayTasks.sort((a, b) => {
                          if (a.dueDate && b.dueDate) {
                            return new Date(a.dueDate).getTime() - new Date(b.dueDate).getTime();
                          }
                          return 0;
                        });

                        if (todayTasks.length === 0) {
                          return (
                            <div className="flex items-center justify-center h-full text-gray-400 text-sm">
                              No tasks due today
                            </div>
                          );
                        }

                        return (
                          <div className="space-y-1">
                            {todayTasks.map((task, index) => (
                              <div
                                key={`today-${task.id}-${task.projectName}-${index}`}
                                className="p-2 bg-orange-50 border border-orange-100 rounded cursor-pointer hover:bg-orange-100 transition-colors"
                                onClick={() => {
                                  const project = projects.find(p => p.name === task.project);
                                  if (project && onNavigateToProject) {
                                    onNavigateToProject(project);
                                  }
                                }}
                              >
                                <div className="text-xs font-medium text-gray-900 truncate">
                                  {task.description}
                                </div>
                                <div className="text-[10px] text-gray-500 truncate mt-0.5">
                                  {task.project}
                                </div>
                              </div>
                            ))}
                          </div>
                        );
                      })()}
                    </div>
                  </div>
                </div>

                {/* Ongoing Tasks Box */}
                <div className="bg-white rounded-lg border border-gray-200 overflow-hidden max-h-80 flex flex-col flex-shrink-0">
                  <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200 flex-shrink-0" style={{ backgroundColor: '#1E40AF' }}>
                    <h3 className="text-lg font-semibold text-white">Ongoing Tasks</h3>
                  </div>
                  <div className="p-4 flex-1 min-h-0 overflow-hidden">
                    <div className="overflow-y-auto light-scrollbar h-full">
                      {(() => {
                        let ongoingTasks: Array<{
                          id: string;
                          description: string;
                          project: string;
                        }> = [];

                        projects.forEach(project => {
                          // Get current phase of the project
                          const getCurrentPhase = (project: Project) => {
                            if (!project.segments || project.segments.length === 0) {
                              return project.phase;
                            }

                            const today = new Date();
                            const todayStr = today.toISOString().split('T')[0];

                            const currentSegment = project.segments.find(segment =>
                              todayStr >= segment.startDate && todayStr <= segment.endDate
                            );

                            return currentSegment ? currentSegment.phase : project.phase;
                          };

                          const currentPhase = getCurrentPhase(project);

                          project.tasks.forEach(task => {
                            const isAssignedToMe = task.assignedTo?.includes(user?.id || '') || false;

                            if (isAssignedToMe && task.status !== 'completed' && task.isOngoing && task.phase === currentPhase) {
                              ongoingTasks.push({
                                id: task.id,
                                description: task.description || task.content || 'Untitled task',
                                project: project.name
                              });
                            }
                          });
                        });

                        if (ongoingTasks.length === 0) {
                          return (
                            <div className="flex items-center justify-center h-full text-gray-400 text-sm">
                              No ongoing tasks
                            </div>
                          );
                        }

                        return (
                          <div className="space-y-1">
                            {ongoingTasks.map((task, index) => (
                              <div
                                key={`ongoing-${task.id}-${task.projectName}-${index}`}
                                className="p-2 bg-blue-50 border border-blue-100 rounded cursor-pointer hover:bg-blue-100 transition-colors"
                                onClick={() => {
                                  const project = projects.find(p => p.name === task.project);
                                  if (project && onNavigateToProject) {
                                    onNavigateToProject(project);
                                  }
                                }}
                              >
                                <div className="text-xs font-medium text-gray-900 truncate">
                                  {task.description}
                                </div>
                                <div className="text-[10px] text-gray-500 truncate mt-0.5">
                                  {task.project}
                                </div>
                              </div>
                            ))}
                          </div>
                        );
                      })()}
                    </div>
                  </div>
                </div>
              </div>
            </div>

          {/* Current Projects Section */}
          <div className="flex flex-col h-full">
            <div className="bg-white rounded-lg border border-gray-200 overflow-hidden flex flex-col h-full">
              <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200 flex-shrink-0" style={{ backgroundColor: BRAND.gray }}>
                <h3 className="text-lg font-semibold text-white">Current Projects</h3>
                <button
                  onClick={() => setRoute('Project Hub')}
                  className="text-gray-200 hover:text-white transition-colors"
                  title="Go to Project Hub"
                >
                  <FolderIcon className="w-5 h-5" />
                </button>
          </div>

              <div className="flex-1 overflow-y-auto light-scrollbar">
                <table className="w-full">
                  <thead className="bg-gray-100">
                    <tr>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-600 uppercase tracking-wider border-b border-gray-300" style={{ borderRight: 'none' }}>Project</th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-600 uppercase tracking-wider border-b border-gray-300" style={{ borderRight: 'none' }}>Team</th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-600 uppercase tracking-wider border-b border-gray-300" style={{ borderRight: 'none' }}>Phase</th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-600 uppercase tracking-wider border-b border-gray-300 w-48">Progress</th>
                    </tr>
                  </thead>
                  <tbody className="bg-white divide-y divide-gray-200">
              {filteredProjects
                .map((project) => {
                  // Calculate progress using KO date and Report date from keyDeadlines
                  const today = new Date();
                  today.setHours(0, 0, 0, 0);
                  
                  let progress = 0;
                  
                  // Get KO date and Report date from keyDeadlines
                  const koDeadline = project.keyDeadlines?.find(d => 
                    d.label.toLowerCase().includes('kickoff') || 
                    d.label.toLowerCase().includes('ko')
                  );
                  const reportDeadline = project.keyDeadlines?.find(d => 
                    d.label.toLowerCase().includes('report') || 
                    d.label.toLowerCase().includes('final')
                  );
                  
                  if (koDeadline?.date && reportDeadline?.date) {
                    const startDate = new Date(koDeadline.date);
                    const endDate = new Date(reportDeadline.date);
                    startDate.setHours(0, 0, 0, 0);
                    endDate.setHours(0, 0, 0, 0);
                    
                    if (!isNaN(startDate.getTime()) && !isNaN(endDate.getTime())) {
                      if (today >= startDate && today < endDate) {
                        const totalDays = Math.ceil((endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24));
                        const daysElapsed = Math.ceil((today.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24));
                        progress = Math.min(100, Math.max(0, Math.round((daysElapsed / totalDays) * 100)));
                      } else if (today >= endDate) {
                        progress = 100;
                      }
                    }
                  } else {
                    // Fallback to phase-based progress if keyDeadlines not found
                    const phaseProgress: { [key: string]: number } = {
                      'Kickoff': 10,
                      'Pre-Field': 25,
                      'Fielding': 50,
                      'Post-Field Analysis': 75,
                      'Reporting': 90,
                      'Complete': 100,
                      'Awaiting KO': 5
                    };
                    progress = phaseProgress[project.phase] || 20;
                  }
                  
                  return { ...project, calculatedProgress: progress };
                })
                .sort((a, b) => {
                  // Get current phase using the same logic as Project Hub
                  const getCurrentPhase = (project: Project): string => {
                    if (!project.segments || project.segments.length === 0) {
                      return project.phase; // Fallback to stored phase
                    }

                    const today = new Date();
                    const todayStr = today.toISOString().split('T')[0]; // YYYY-MM-DD format

                    // Find which phase today falls into
                    for (const segment of project.segments) {
                      if (todayStr >= segment.startDate && todayStr <= segment.endDate) {
                        return segment.phase;
                      }
                    }

                    // If today is before the first phase, return the first phase
                    if (todayStr < project.segments[0].startDate) {
                      return project.segments[0].phase;
                    }

                    // If today is after the last phase, return the last phase
                    if (todayStr > project.segments[project.segments.length - 1].endDate) {
                      return project.segments[project.segments.length - 1].phase;
                    }

                    return project.phase; // Fallback
                  };

                  const aPhase = getCurrentPhase(a);
                  const bPhase = getCurrentPhase(b);
                  
                  const phaseOrder = {
                    'Awaiting KO': 0,
                    'Kickoff': 1,
                    'Pre-Field': 2,
                    'Fielding': 3,
                    'Post-Field Analysis': 4,
                    'Reporting': 5,
                    'Complete': 6
                  };
                  
                  const aPhaseOrder = phaseOrder[aPhase as keyof typeof phaseOrder] ?? 999;
                  const bPhaseOrder = phaseOrder[bPhase as keyof typeof phaseOrder] ?? 999;
                  
                  // Sort by phase (latest first)
                  if (aPhaseOrder !== bPhaseOrder) {
                    return bPhaseOrder - aPhaseOrder; // Reverse order for latest first
                  }
                  
                  // If same phase, sort by progress percentage (highest first)
                  return b.calculatedProgress - a.calculatedProgress;
                })
                      .map((project) => {
                // Use the already calculated progress from sorting
                const progress = project.calculatedProgress;
                
                // Get current phase using the same logic as Project Hub
                const getCurrentPhase = (project: Project): string => {
                  const today = new Date();
                  today.setHours(0, 0, 0, 0);
                  
                  // Check if project is completed (day after report deadline)
                  const reportDeadline = project.keyDeadlines?.find(d => 
                    d.label.toLowerCase().includes('report') || 
                    d.label.toLowerCase().includes('final')
                  );
                  
                  if (reportDeadline?.date) {
                    const reportDate = new Date(reportDeadline.date);
                    reportDate.setHours(0, 0, 0, 0);
                    
                    // If today is after the report deadline, project is complete
                    if (today > reportDate) {
                      return 'Complete';
                    }
                  }
                  
                  if (!project.segments || project.segments.length === 0) {
                    return project.phase; // Fallback to stored phase
                  }

                  const todayStr = today.toISOString().split('T')[0]; // YYYY-MM-DD format

                  // Find which phase today falls into
                  for (const segment of project.segments) {
                    if (todayStr >= segment.startDate && todayStr <= segment.endDate) {
                      return segment.phase;
                    }
                  }

                  // If today is before the first phase, return the first phase
                  if (todayStr < project.segments[0].startDate) {
                    return project.segments[0].phase;
                  }

                  // If today is after the last phase, return the last phase
                  if (todayStr > project.segments[project.segments.length - 1].endDate) {
                    return project.segments[project.segments.length - 1].phase;
                  }

                  return project.phase; // Fallback
                };

                const currentPhase = getCurrentPhase(project);
                
                // Get color based on current phase - match timeline view colors exactly
                const getPhaseColor = (phase: string) => {
                  const phaseColors: { [key: string]: string } = {
                    'Kickoff': '#6B7280',        // Grey - matches PHASE_COLORS
                    'Pre-Field': '#1D4ED8',      // Blue - matches PHASE_COLORS
                    'Fielding': '#7C3AED',       // Purple - matches PHASE_COLORS
                    'Post-Field Analysis': '#F97316', // Orange - matches PHASE_COLORS
                    'Reporting': '#DC2626',      // Red - matches PHASE_COLORS
                    'Complete': '#10B981',       // Green - matches PHASE_COLORS
                    'Awaiting KO': '#9CA3AF'     // Neutral grey - matches PHASE_COLORS
                  };
                  return phaseColors[phase] || '#6B7280';
                };
                
                        // Get team members for this project
                const teamMembers = project.teamMembers || [];

                  return (
                          <tr 
                    key={`project-${project.id}`}
                            className="hover:bg-gray-50 cursor-pointer transition-colors"
                    onClick={() => onNavigateToProject?.(project)}
                  >
                            {/* Project Column */}
                            <td className="px-4 py-4">
                              <div>
                                <div className="text-sm font-medium text-gray-900">{project.name}</div>
                                <div className="text-sm text-gray-500">{project.client}</div>
                            </div>
                            </td>
                            
                            {/* Team Column */}
                            <td className="px-4 py-4">
                          <div className="flex -space-x-1">
                            {teamMembers.slice(0, 4).map((member: any, i: number) => (
                              <div 
                                key={`project-${project.id}-member-${member.id || member.name || i}-${i}`} 
                                    className="w-6 h-6 rounded-full flex items-center justify-center text-white text-xs font-medium border border-white relative group"
                                style={{ 
                                  backgroundColor: getMemberColor(member.id || member.name, teamMembers),
                                  zIndex: teamMembers.length - i // Leftmost icon in front
                                }}
                                title={member.name}
                              >
                                {getInitials(member.name || member.email || 'U')}
                    </div>
                            ))}
                            {teamMembers.length > 4 && (
                                  <div className="w-6 h-6 rounded-full flex items-center justify-center text-gray-600 text-xs font-medium border border-white bg-gray-100">
                                +{teamMembers.length - 4}
                              </div>
                            )}
                    </div>
                            </td>
                            
                            {/* Phase Column */}
                            <td className="px-4 py-4">
                              <span
                                className="inline-flex items-center justify-center w-24 px-0.5 sm:px-1 md:px-2 py-1 rounded-full text-xs font-medium text-white"
                                style={{ 
                                  backgroundColor: getPhaseColor(currentPhase),
                                  opacity: 0.6
                                }}
                              >
                                {currentPhase === 'Post-Field Analysis' ? 'Analysis' : currentPhase}
                              </span>
                            </td>
                            
                            {/* Progress Column */}
                            <td className="px-4 py-4">
                              <div className="flex items-center">
                                <div className="flex-1 mr-3">
                                  <div className="relative">
                                    <div className="w-full bg-gray-200 rounded-full h-2">
                                      <div 
                                        className="h-2 rounded-full relative"
                                        style={{ 
                                          width: `${progress}%`,
                                          backgroundColor: getPhaseColor(currentPhase)
                                        }}
                                      >
                                        <div 
                                          className="absolute right-0 top-1/2 transform -translate-y-1/2 w-3 h-3 rounded-full"
                                          style={{ 
                                            backgroundColor: getPhaseColor(currentPhase),
                                            marginRight: '-6px'
                                          }}
                                        ></div>
                  </div>
                  </div>
                </div>
              </div>
                                <span className="text-sm font-medium" style={{ color: BRAND.gray }}>{progress}%</span>
                              </div>
                            </td>
                          </tr>
                );
              })}
                  </tbody>
                </table>

                {/* Empty State - No Projects Assigned */}
                {filteredProjects.length === 0 && (
                  <div className="flex flex-col items-center justify-center py-12 px-4">
                    <FolderIcon className="h-16 w-16 mb-4 text-gray-300" />
                    <h3 className="text-lg font-semibold text-gray-900 mb-2">No Projects Assigned</h3>
                    <p className="text-sm text-gray-500 mb-6 text-center">You're not currently assigned to any projects</p>
                    <div className="flex gap-3">
                      <button
                        onClick={() => setRoute('Project Hub')}
                        className="px-4 py-2 text-sm font-medium text-white rounded-lg transition-colors"
                        style={{ backgroundColor: BRAND.orange }}
                        onMouseEnter={(e) => e.currentTarget.style.backgroundColor = '#B8392A'}
                        onMouseLeave={(e) => e.currentTarget.style.backgroundColor = BRAND.orange}
                      >
                        Create a Project
                      </button>
                      <button
                        onClick={() => {
                          setRoute('Project Hub');
                          // Need to signal to Project Hub to change the filter
                          setTimeout(() => {
                            // This will be handled by setting a flag or URL param
                            const event = new CustomEvent('setProjectHubFilter', { detail: 'all' });
                            window.dispatchEvent(event);
                          }, 100);
                        }}
                        className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors"
                      >
                        View Other Cognitive Projects
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>

              </div>

        {/* Right Column - Sidebar */}
        <div className="lg:col-span-1">
          {/* Calendar Widget */}
          <div className="bg-white rounded-lg border border-gray-200 p-4">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold text-gray-900">
                {new Date(currentYear, currentMonth).toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}
              </h3>
              <div className="flex gap-2">
                <button 
                  onClick={() => navigateMonth('prev')}
                  className="w-6 h-6 flex items-center justify-center text-gray-400 hover:text-gray-600"
                >
                  <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                    <path fillRule="evenodd" d="M12.707 5.293a1 1 0 010 1.414L9.414 10l3.293 3.293a1 1 0 01-1.414 1.414l-4-4a1 1 0 010-1.414l4-4a1 1 0 011.414 0z" clipRule="evenodd" />
                  </svg>
                </button>
                <button 
                  onClick={() => navigateMonth('next')}
                  className="w-6 h-6 flex items-center justify-center text-gray-400 hover:text-gray-600"
                >
                  <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                    <path fillRule="evenodd" d="M7.293 14.707a1 1 0 010-1.414L10.586 10 7.293 6.707a1 1 0 011.414-1.414l4 4a1 1 0 010 1.414l-4 4a1 1 0 01-1.414 0z" clipRule="evenodd" />
                  </svg>
                </button>
              </div>
            </div>
            <div className="grid grid-cols-7 gap-1 text-xs">
              {['S', 'M', 'T', 'W', 'T', 'F', 'S'].map((day, index) => (
                <div key={`day-${index}`} className="text-center text-gray-500 py-1">{day}</div>
              ))}
              {(() => {
                const today = new Date();
                const todayDate = today.getDate();
                const todayMonth = today.getMonth();
                const todayYear = today.getFullYear();
                
                // Get first day of the month and how many days in the month
                const firstDay = new Date(currentYear, currentMonth, 1);
                const lastDay = new Date(currentYear, currentMonth + 1, 0);
                const daysInMonth = lastDay.getDate();
                const startingDayOfWeek = firstDay.getDay(); // 0 = Sunday, 1 = Monday, etc.
                
                // Create array of days for the month
                const days = [];
                
                // Add empty cells for days before the first day of the month
                for (let i = 0; i < startingDayOfWeek; i++) {
                  days.push(null);
                }
                
                // Add days of the month
                for (let day = 1; day <= daysInMonth; day++) {
                  days.push(day);
                }
                
                return days.map((day, index) => {
                  if (day === null) {
                    return <div key={`empty-${index}`} className="text-center py-1"></div>;
                  }
                  
                  const isToday = day === todayDate && currentMonth === todayMonth && currentYear === todayYear;
                  const isSelected = selectedDate && 
                    selectedDate.getDate() === day && 
                    selectedDate.getMonth() === currentMonth && 
                    selectedDate.getFullYear() === currentYear;
                  
                  // Determine if current date should be transparent (when another date is selected)
                  const isCurrentDateTransparent = isToday && selectedDate && !isSelected;
                  
                  return (
                    <div 
                      key={day} 
                      onClick={() => handleDateClick(day)}
                      className={`text-center py-1 rounded-full cursor-pointer transition-colors ${
                        isToday 
                          ? 'text-white font-semibold' 
                          : isSelected
                          ? 'text-white font-semibold'
                          : 'hover:bg-gray-100'
                      }`}
                      style={{
                        backgroundColor: isToday 
                          ? (isCurrentDateTransparent ? 'rgba(220, 38, 38, 0.5)' : '#DC2626') // 50% transparent red or solid red
                          : isSelected
                          ? '#D14A2D' // Branded orange
                          : 'transparent'
                      }}
                    >
                      {day}
                    </div>
                  );
                });
              })()}
            </div>
          </div>

          {/* Spacing between calendar and task list */}
          <div className="mt-4"></div>

          {/* Tasks Section */}
          <div className="bg-white rounded-lg border border-gray-200 p-4">
            <div className="space-y-4">
              {(() => {
                // Get all tasks from projects, sorted by due date - only tasks assigned to current user
                const allTasks = sourceProjects.flatMap(project => 
                  (project.tasks || [])
                    .filter(task => {
                      // Only include tasks with due date, not completed, and assigned to current user
                      if (!task.dueDate || task.status === 'completed') return false;
                      
                      // Check if task is assigned to current user
                      const isAssignedToMe = task.assignedTo?.includes(user?.id || '') || false;
                      return isAssignedToMe;
                    })
                    .map(task => ({
                      ...task,
                      projectName: project.name,
                      projectId: project.id
                    }))
                ).sort((a, b) => {
                  const dateA = new Date(a.dueDate! + 'T00:00:00');
                  const dateB = new Date(b.dueDate! + 'T00:00:00');
                  return dateA.getTime() - dateB.getTime();
                });

                // Group tasks by date
                const tasksByDate = allTasks.reduce((acc, task) => {
                  // Parse the date string properly to avoid timezone issues
                  const dueDate = new Date(task.dueDate! + 'T00:00:00');
                  const dateKey = dueDate.toLocaleDateString('en-US', { 
                    day: 'numeric', 
                    month: 'long' 
                  });
                  
                  if (!acc[dateKey]) {
                    acc[dateKey] = [];
                  }
                  acc[dateKey].push(task);
                  return acc;
                }, {} as Record<string, typeof allTasks>);

                // Generate the next 5 weekdays starting from selected date (or today if none selected)
                const startDate = taskListStartDate;
                const nextWeekdays = [];
                let currentDate = new Date(startDate);
                let daysAdded = 0;
                
                // Start from selected date and find the next 5 weekdays
                while (daysAdded < 5) {
                  const dayOfWeek = currentDate.getDay();
                  // Only include weekdays (Monday = 1, Tuesday = 2, ..., Friday = 5)
                  if (dayOfWeek >= 1 && dayOfWeek <= 5) {
                    const dateKey = currentDate.toLocaleDateString('en-US', { 
                      day: 'numeric', 
                      month: 'long' 
                    });
                    
                    const tasksForDate = tasksByDate[dateKey] || [];
                    nextWeekdays.push([dateKey, tasksForDate]);
                    daysAdded++;
                  }
                  // Move to next day
                  currentDate.setDate(currentDate.getDate() + 1);
                }

                if (nextWeekdays.length === 0) {
                  return (
                    <div className="text-center py-4 text-gray-500">
                      <p className="text-sm">No upcoming tasks</p>
            </div>
                  );
                }

                // Always show exactly 8 items total (tasks or "No tasks" notes)
                const maxContentItems = 8;
                let currentContentItemCount = 0;
                const finalRenderedBlocks: JSX.Element[] = [];

                let tempCurrentDate = new Date(startDate);
                let daysIterated = 0;
                const maxDaysToLookAhead = 20; // Safety limit to prevent infinite loops

                // Phase 1: Add actual tasks and "no tasks" for naturally empty days
                while (currentContentItemCount < maxContentItems && daysIterated < maxDaysToLookAhead) {
                  const dayOfWeek = tempCurrentDate.getDay();
                  if (dayOfWeek >= 1 && dayOfWeek <= 5) { // Only include weekdays (Monday-Friday)
                    const dateKey = tempCurrentDate.toLocaleDateString('en-US', {
                      day: 'numeric',
                      month: 'long'
                    });
                    const tasksForDate = tasksByDate[dateKey] || [];

                    const tasksForThisDayRender: JSX.Element[] = [];
                    let dayContentAddedCount = 0;

                    const remainingOverallSlots = maxContentItems - currentContentItemCount;

                    // Render tasks for this day, slicing to fit remaining slots
                    const tasksToConsider = tasksForDate.slice(0, remainingOverallSlots);
                    for (const task of tasksToConsider) {
                      const dueDate = new Date(task.dueDate! + 'T00:00:00');
                      const isOverdue = dueDate < new Date();

                      const project = sourceProjects.find(p => p.id === task.projectId);
                      const projectPhase = project?.phase || 'Kickoff';
                      const phaseColor = PHASE_COLORS[projectPhase] || PHASE_COLORS['Kickoff'];

                      
                      tasksForThisDayRender.push(
                        <div
                          key={`${task.id}-${task.projectId}-${dateKey}-${dayContentAddedCount}`}
                          className="flex items-center gap-3 p-1.5 rounded-lg cursor-pointer mb-1 hover:bg-gray-50"
                          onClick={() => {
                            if (project && onNavigateToProject) {
                              onNavigateToProject(project);
                            }
                          }}
                        >
                          <div
                            className="w-1 h-8 rounded-full"
                            style={{
                              backgroundColor: phaseColor,
                              opacity: 0.8
                            }}
                          ></div>
                          <div className="flex-1 min-w-0">
                            <div className="text-sm text-gray-900 truncate">
                              {task.content || task.description || 'Untitled task'}
                            </div>
                            <div className="text-xs text-gray-500 truncate">
                              {task.projectName}
                            </div>
                          </div>
                        </div>
                      );
                      dayContentAddedCount++;
                    }

                    // If no tasks were added for this day, and we still have slots, add a "No tasks" note
                    if (dayContentAddedCount === 0 && remainingOverallSlots > 0) {
                      tasksForThisDayRender.push(
                        <div key={`${dateKey}-no-tasks`} className="text-xs text-gray-400">
                          No tasks
                        </div>
                      );
                      dayContentAddedCount++;
                    }

                    // Only add the date block if it has content (tasks or "no tasks")
                    if (tasksForThisDayRender.length > 0) {
                      finalRenderedBlocks.push(
                        <div key={dateKey} className="space-y-2">
                          <div className="flex items-center justify-between">
                            <h4 className="text-sm font-medium text-gray-900">{dateKey}</h4>
                          </div>
                          <div>
                            {tasksForThisDayRender}
                          </div>
                        </div>
                      );
                      currentContentItemCount += dayContentAddedCount;
                    }
                  }
                  tempCurrentDate.setDate(tempCurrentDate.getDate() + 1);
                  daysIterated++;
                }

                // Phase 2: Fill remaining slots with "No tasks" notes under new weekday dates
                while (currentContentItemCount < maxContentItems) {
                  const dayOfWeek = tempCurrentDate.getDay();
                  if (dayOfWeek >= 1 && dayOfWeek <= 5) { // Only include weekdays
                    const dateKey = tempCurrentDate.toLocaleDateString('en-US', {
                      day: 'numeric',
                      month: 'long'
                    });

                    finalRenderedBlocks.push(
                      <div key={`${dateKey}-fill`} className="space-y-2">
                        <div className="flex items-center justify-between">
                          <h4 className="text-sm font-medium text-gray-900">{dateKey}</h4>
                        </div>
                        <div>
                          <div className="text-xs text-gray-400">
                            No tasks
                          </div>
                        </div>
                      </div>
                    );
                    currentContentItemCount++;
                  }
                  tempCurrentDate.setDate(tempCurrentDate.getDate() + 1);
                }

                return finalRenderedBlocks;
              })()}
            </div>
          </div>

        </div>
      </div>
    </div>
  );
}

// Oversight Dashboard Component
function OversightDashboard({ projects, loading, onProjectCreated, onNavigateToProject, setRoute }: { projects: Project[]; loading?: boolean; onProjectCreated?: (project: Project) => void; onNavigateToProject?: (project: Project) => void; setRoute?: (route: string) => void }) {
  const { user } = useAuth();
  const [allProjects, setAllProjects] = useState<Project[]>([]);
  const [loadingAllProjects, setLoadingAllProjects] = useState(false);
  const [selectedTeamMember, setSelectedTeamMember] = useState<string>('');
  const [selectedClient, setSelectedClient] = useState<string>('');
  const [selectedDate, setSelectedDate] = useState<Date | null>(null);
  const [projectUpdateModal, setProjectUpdateModal] = useState<{ show: boolean; project: Project | null; update: string | null }>({ show: false, project: null, update: null });
  const [hoveredProjectId, setHoveredProjectId] = useState<string | null>(null);
  const [expandedPhases, setExpandedPhases] = useState<Set<string>>(new Set());
  const [selectedPhaseFilter, setSelectedPhaseFilter] = useState<'active' | 'preField' | 'fielding' | 'reporting'>('active');

  // Calendar state
  const [currentMonth, setCurrentMonth] = useState(new Date().getMonth());
  const [currentYear, setCurrentYear] = useState(new Date().getFullYear());
  
  // Calendar navigation functions
  const navigateMonth = (direction: 'prev' | 'next') => {
    if (direction === 'prev') {
      if (currentMonth === 0) {
        setCurrentMonth(11);
        setCurrentYear(currentYear - 1);
      } else {
        setCurrentMonth(currentMonth - 1);
      }
    } else {
      if (currentMonth === 11) {
        setCurrentMonth(0);
        setCurrentYear(currentYear + 1);
      } else {
        setCurrentMonth(currentMonth + 1);
      }
    }
  };
  
  const handleDateClick = (day: number) => {
    const clickedDate = new Date(currentYear, currentMonth, day);
    setSelectedDate(clickedDate);
  };

  // Helper functions for phase colors
  const getPhaseBucket = (phase: string): string => {
    const phaseMap: { [key: string]: string } = {
      'Kickoff': 'Kickoff',
      'Pre-Field': 'Pre-Field',
      'Fielding': 'Fielding',
      'Post-Field Analysis': 'Post-Field Analysis',
      'Reporting': 'Reporting',
      'Complete': 'Complete',
      'Awaiting KO': 'Awaiting KO'
    };
    return phaseMap[phase] || phase;
  };

  const getBucketColor = (bucket: string): string => {
    const colors: { [key: string]: string } = {
      'Kickoff': '#6B7280',
      'Pre-Field': '#1D4ED8',
      'Fielding': '#7C3AED',
      'Post-Field Analysis': '#F97316',
      'Reporting': '#DC2626',
      'Complete': '#10B981',
      'Awaiting KO': '#9CA3AF'
    };
    return colors[bucket] || '#6B7280';
  };

  const getDarkBucketColor = (bucket: string): string => {
    const darkColors: { [key: string]: string } = {
      'Kickoff': '#4B5563',
      'Pre-Field': '#1E40AF',
      'Fielding': '#6D28D9',
      'Post-Field Analysis': '#EA580C',
      'Reporting': '#B91C1C',
      'Complete': '#059669',
      'Awaiting KO': '#6B7280'
    };
    return darkColors[bucket] || '#4B5563';
  };

  const getLightBucketColor = (bucket: string): string => {
    const lightColors: { [key: string]: string } = {
      'Kickoff': '#D1D5DB',
      'Pre-Field': '#BFDBFE',
      'Fielding': '#DDD6FE',
      'Post-Field Analysis': '#FED7AA',
      'Reporting': '#FECACA',
      'Complete': '#A7F3D0',
      'Awaiting KO': '#E5E7EB'
    };
    return lightColors[bucket] || '#E5E7EB';
  };

  const getBucketDisplayName = (bucket: string): string => {
    return bucket;
  };

  // Generate project update for Oversight role
  const handleGetProjectUpdate = (project: Project) => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    // Get current phase
    const getCurrentPhase = () => {
      if (!project.segments || project.segments.length === 0) {
        return { phase: project.phase, segment: null };
      }
      const todayStr = today.toISOString().split('T')[0];
      const currentSegment = project.segments.find(segment =>
        todayStr >= segment.startDate && todayStr <= segment.endDate
      );
      return currentSegment ? { phase: currentSegment.phase, segment: currentSegment } : { phase: project.phase, segment: null };
    };

    const currentPhaseData = getCurrentPhase();

    // Get next phase timeline
    const getNextPhaseTimeline = () => {
      if (!project.segments || project.segments.length === 0) return null;
      const todayStr = today.toISOString().split('T')[0];
      const futureSegments = project.segments.filter(segment => segment.startDate > todayStr);
      return futureSegments.length > 0 ? futureSegments[0] : null;
    };

    const nextPhase = getNextPhaseTimeline();

    // Get upcoming key dates (within next 2 weeks)
    const twoWeeksFromNow = new Date(today);
    twoWeeksFromNow.setDate(twoWeeksFromNow.getDate() + 14);
    const upcomingKeyDates = (project.keyDeadlines || []).filter(deadline => {
      const deadlineDate = new Date(deadline.date);
      return deadlineDate >= today && deadlineDate <= twoWeeksFromNow;
    }).sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

    // Get tasks assigned over next 2 weeks (for Oversight, include all tasks, not just today's)
    const tasksNext2Weeks = (project.tasks || []).filter(task => {
      if (!task.dueDate || task.status === 'completed') return false;
      const taskDate = new Date(task.dueDate);
      return taskDate > today && taskDate <= twoWeeksFromNow;
    }).sort((a, b) => new Date(a.dueDate!).getTime() - new Date(b.dueDate!).getTime());

    // Format date helper
    const formatDate = (dateStr: string) => {
      const date = new Date(dateStr);
      return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
    };

    // Build update text for Oversight role
    const teamMemberNames = (project.teamMembers || []).map(m => m.name).join(', ') || 'No team members assigned';
    let updateText = `**Team Members:** ${teamMemberNames}\n\n`;
    updateText += `**Client:** ${project.client}\n\n`;
    
    // Add moderator name for quals if available
    const moderatorForQuals = project.moderatorForQuals || 'Not assigned';
    updateText += `**Moderator:** ${moderatorForQuals}\n\n`;
    
    // Add sample details if available
    if (project.sampleDetails) {
      updateText += `**Sample Details:** ${project.sampleDetails}\n`;
    }

    if (nextPhase) {
      if (currentPhaseData.segment) {
        updateText += `[PHASE] Current Phase:|${currentPhaseData.phase}|${formatDate(currentPhaseData.segment.startDate)} - ${formatDate(currentPhaseData.segment.endDate)}\n`;
      } else {
        updateText += `[PHASE] Current Phase:|${currentPhaseData.phase}|No date range available\n`;
      }
      updateText += `[PHASE] Upcoming Phase:|${nextPhase.phase}|${formatDate(nextPhase.startDate)} - ${formatDate(nextPhase.endDate)}\n`;
    } else {
      if (currentPhaseData.segment) {
        updateText += `[PHASE] Current Phase:|${currentPhaseData.phase}|${formatDate(currentPhaseData.segment.startDate)} - ${formatDate(currentPhaseData.segment.endDate)}\n`;
      } else {
        updateText += `**Current Phase:** ${currentPhaseData.phase}\n`;
      }
    }

    setProjectUpdateModal({ show: true, project, update: updateText });
  };

  // Fetch all projects across all users
  const loadAllProjects = useCallback(async () => {
    setLoadingAllProjects(true);
    try {
      const response = await fetch(`${API_BASE_URL}/api/projects/all`, {
        headers: { 'Authorization': `Bearer ${localStorage.getItem('cognitive_dash_token')}` }
      });
      if (response.ok) {
        const data = await response.json();
        setAllProjects(data.projects || []);
      } else {
        console.error('Failed to load all projects');
        setAllProjects([]);
      }
    } catch (error) {
      console.error('Error loading all projects:', error);
      setAllProjects([]);
    } finally {
      setLoadingAllProjects(false);
    }
  }, []);

  // Load all projects when component mounts
  useEffect(() => {
    loadAllProjects();
  }, [loadAllProjects]);

  // Get unique team members and clients for filter dropdowns
  const teamMembers = useMemo(() => {
    const members = new Set<string>();
    allProjects.forEach(project => {
      if (project.teamMembers) {
        project.teamMembers.forEach(member => {
          if (member.name) members.add(member.name);
        });
      }
    });
    return Array.from(members).sort();
  }, [allProjects]);

  const clients = useMemo(() => {
    const clientSet = new Set<string>();
    allProjects.forEach(project => {
      if (project.client) clientSet.add(project.client);
    });
    return Array.from(clientSet).sort();
  }, [allProjects]);

  // Filter projects based on selected filters
  const filteredProjects = useMemo(() => {
    let filtered = allProjects.filter(project => project.phase !== 'Complete');
    
    if (selectedTeamMember) {
      filtered = filtered.filter(project => 
        project.teamMembers?.some(member => member.name === selectedTeamMember)
      );
    }
    
    if (selectedClient) {
      filtered = filtered.filter(project => project.client === selectedClient);
    }
    
    return filtered;
  }, [allProjects, selectedTeamMember, selectedClient]);

  // Calculate project counts by phase
  const projectCounts = useMemo(() => {
    const counts = {
      active: 0,
      preField: 0,
      fielding: 0,
      reporting: 0
    };
    
    const referenceDate = selectedDate || new Date();
    
    filteredProjects.forEach(project => {
      // Get current phase based on timeline
      const getCurrentPhase = (project: Project): string => {
        if (!project.segments || project.segments.length === 0) {
          return project.phase;
        }
        
        const refDateStr = referenceDate.toISOString().split('T')[0];
        
        for (const segment of project.segments) {
          if (refDateStr >= segment.startDate && refDateStr <= segment.endDate) {
            return segment.phase;
          }
        }
        
        if (refDateStr < project.segments[0].startDate) {
          return project.segments[0].phase;
        }
        
        if (refDateStr > project.segments[project.segments.length - 1].endDate) {
          return project.segments[project.segments.length - 1].phase;
        }
        
        return project.phase;
      };
      
      const currentPhase = getCurrentPhase(project);
      counts.active++;

      if (currentPhase === 'Pre-Field' || currentPhase === 'Kickoff' || currentPhase === 'Awaiting KO') {
        counts.preField++;
      } else if (currentPhase === 'Fielding') {
        counts.fielding++;
      } else if (currentPhase === 'Post-Field Analysis' || currentPhase === 'Reporting') {
        counts.reporting++;
      }
    });
    
    return counts;
  }, [filteredProjects, selectedDate]);

  // Filter projects for display based on selected phase filter
  const displayProjects = useMemo(() => {
    const referenceDate = selectedDate || new Date();

    return filteredProjects.filter(project => {
      // Get current phase based on timeline
      const getCurrentPhase = (project: Project): string => {
        if (!project.segments || project.segments.length === 0) {
          return project.phase;
        }

        const refDateStr = referenceDate.toISOString().split('T')[0];

        for (const segment of project.segments) {
          if (refDateStr >= segment.startDate && refDateStr <= segment.endDate) {
            return segment.phase;
          }
        }

        if (refDateStr < project.segments[0].startDate) {
          return project.segments[0].phase;
        }

        if (refDateStr > project.segments[project.segments.length - 1].endDate) {
          return project.segments[project.segments.length - 1].phase;
        }

        return project.phase;
      };

      const currentPhase = getCurrentPhase(project);

      if (selectedPhaseFilter === 'active') {
        return true; // Show all projects
      } else if (selectedPhaseFilter === 'preField') {
        return currentPhase === 'Pre-Field' || currentPhase === 'Kickoff' || currentPhase === 'Awaiting KO';
      } else if (selectedPhaseFilter === 'fielding') {
        return currentPhase === 'Fielding';
      } else if (selectedPhaseFilter === 'reporting') {
        return currentPhase === 'Post-Field Analysis' || currentPhase === 'Reporting';
      }

      return true;
    });
  }, [filteredProjects, selectedPhaseFilter, selectedDate]);

  // Get key dates for all projects
  const keyDates = useMemo(() => {
    const dates: Array<{
      date: string;
      type: 'kickoff' | 'fieldStart' | 'fieldEnd' | 'reportDue';
      projectName: string;
    }> = [];
    
    filteredProjects.forEach(project => {
      if (project.keyDeadlines) {
        project.keyDeadlines.forEach(deadline => {
          const label = deadline.label.toLowerCase();
          let type: 'kickoff' | 'fieldStart' | 'fieldEnd' | 'reportDue' | null = null;
          
          if (label.includes('kickoff') || label.includes('ko')) {
            type = 'kickoff';
          } else if (label.includes('field start')) {
            type = 'fieldStart';
          } else if (label.includes('field end')) {
            type = 'fieldEnd';
          } else if (label.includes('report') || label.includes('final')) {
            type = 'reportDue';
          }
          
          if (type && deadline.date) {
            dates.push({
              date: deadline.date,
              type,
              projectName: project.name
            });
          }
        });
      }
    });
    
    return dates.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
  }, [filteredProjects]);

  // Get user's first name
  const firstName = user?.name?.split(' ')[0] || 'User';

  return (
    <div className="space-y-6 w-full max-w-full overflow-x-hidden">
      {/* Main Content Layout */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left Column - Project List and Status Boxes */}
        <div className="lg:col-span-2 flex flex-col gap-6">
          {/* Status Boxes */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            {/* Active Projects Box */}
            <button
              onClick={() => setSelectedPhaseFilter('active')}
              className="bg-white rounded-lg border-2 p-4 relative text-left w-full transition-all"
              style={{
                backgroundColor: '#D14A2D',
                borderColor: selectedPhaseFilter === 'active' ? '#fff' : '#D14A2D',
                opacity: selectedPhaseFilter === 'active' ? 1 : 0.7
              }}
            >
              <div>
                <p className="text-sm font-medium text-white">Active Projects</p>
                <p className="text-2xl font-bold text-white">{projectCounts.active}</p>
              </div>
            </button>

            {/* Reporting Projects Box */}
            <button
              onClick={() => setSelectedPhaseFilter('reporting')}
              className="bg-white rounded-lg border-2 p-4 relative text-left w-full transition-all"
              style={{
                backgroundColor: 'rgba(220, 38, 38, 0.6)',
                borderColor: selectedPhaseFilter === 'reporting' ? '#fff' : 'rgba(220, 38, 38, 0.6)',
                opacity: selectedPhaseFilter === 'reporting' ? 1 : 0.7
              }}
            >
              <div>
                <p className="text-sm font-medium text-white">Reporting</p>
                <p className="text-2xl font-bold text-white">{projectCounts.reporting}</p>
              </div>
            </button>

            {/* Fielding Projects Box */}
            <button
              onClick={() => setSelectedPhaseFilter('fielding')}
              className="bg-white rounded-lg border-2 p-4 relative text-left w-full transition-all"
              style={{
                backgroundColor: 'rgba(124, 58, 237, 0.6)',
                borderColor: selectedPhaseFilter === 'fielding' ? '#fff' : 'rgba(124, 58, 237, 0.6)',
                opacity: selectedPhaseFilter === 'fielding' ? 1 : 0.7
              }}
            >
              <div>
                <p className="text-sm font-medium text-white">Fielding</p>
                <p className="text-2xl font-bold text-white">{projectCounts.fielding}</p>
              </div>
            </button>

            {/* Pre-Field Projects Box */}
            <button
              onClick={() => setSelectedPhaseFilter('preField')}
              className="bg-white rounded-lg border-2 p-4 relative text-left w-full transition-all"
              style={{
                backgroundColor: 'rgba(29, 78, 216, 0.6)',
                borderColor: selectedPhaseFilter === 'preField' ? '#fff' : 'rgba(29, 78, 216, 0.6)',
                opacity: selectedPhaseFilter === 'preField' ? 1 : 0.7
              }}
            >
              <div>
                <p className="text-sm font-medium text-white">Pre-Field</p>
                <p className="text-2xl font-bold text-white">{projectCounts.preField}</p>
              </div>
            </button>
          </div>

          {/* Projects List */}
          <div className="bg-white rounded-lg border border-gray-200 overflow-hidden flex flex-col h-full">
            <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200 flex-shrink-0" style={{ backgroundColor: BRAND.gray }}>
              <h3 className="text-lg font-semibold text-white">All Projects</h3>
            </div>

            <div className="flex-1 overflow-y-auto overflow-x-hidden light-scrollbar">
              <table className="w-full">
                <thead className="bg-gray-100">
                  <tr>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-600 uppercase tracking-wider" style={{ width: '250px' }}>Project</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-600 uppercase tracking-wider" style={{ width: '110px' }}>Team</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-600 uppercase tracking-wider" colSpan={2}>Progress</th>
                    <th className="px-4 py-3 text-center text-xs font-medium text-gray-600 uppercase tracking-wider" style={{ width: '60px' }}></th>
                    <th className="px-4 py-3 text-center text-xs font-medium text-gray-600 uppercase tracking-wider" style={{ width: '3rem' }}></th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-200">
                  {displayProjects
                    .map((project) => {
                      // Calculate progress using KO date and Report date from keyDeadlines
                      const today = new Date();
                      today.setHours(0, 0, 0, 0);
                      
                      let progress = 0;
                      
                      // Get KO date and Report date from keyDeadlines
                      const koDeadline = project.keyDeadlines?.find(d => 
                        d.label.toLowerCase().includes('kickoff') || 
                        d.label.toLowerCase().includes('ko')
                      );
                      const reportDeadline = project.keyDeadlines?.find(d => 
                        d.label.toLowerCase().includes('report') || 
                        d.label.toLowerCase().includes('final')
                      );
                      
                      if (koDeadline?.date && reportDeadline?.date) {
                        const startDate = new Date(koDeadline.date);
                        const endDate = new Date(reportDeadline.date);
                        startDate.setHours(0, 0, 0, 0);
                        endDate.setHours(0, 0, 0, 0);
                        
                        if (!isNaN(startDate.getTime()) && !isNaN(endDate.getTime())) {
                          if (today >= startDate && today < endDate) {
                            const totalDays = Math.ceil((endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24));
                            const daysElapsed = Math.ceil((today.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24));
                            progress = Math.min(100, Math.max(0, Math.round((daysElapsed / totalDays) * 100)));
                          } else if (today >= endDate) {
                            progress = 100;
                          }
                        }
                      } else {
                        // Fallback to phase-based progress if keyDeadlines not found
                        const phaseProgress: { [key: string]: number } = {
                          'Kickoff': 10,
                          'Pre-Field': 25,
                          'Fielding': 50,
                          'Post-Field Analysis': 75,
                          'Reporting': 90,
                          'Complete': 100,
                          'Awaiting KO': 5
                        };
                        progress = phaseProgress[project.phase] || 20;
                      }
                      
                      return { ...project, calculatedProgress: progress };
                    })
                    .sort((a, b) => {
                      // First, get current phase for both projects
                      const getPhaseForSort = (project: Project): string => {
                        const today = new Date();
                        today.setHours(0, 0, 0, 0);

                        if (!project.segments || project.segments.length === 0) {
                          return project.phase;
                        }

                        const todayStr = today.toISOString().split('T')[0];

                        for (const segment of project.segments) {
                          if (todayStr >= segment.startDate && todayStr <= segment.endDate) {
                            return segment.phase;
                          }
                        }

                        if (todayStr < project.segments[0].startDate) {
                          return project.segments[0].phase;
                        }

                        if (todayStr > project.segments[project.segments.length - 1].endDate) {
                          return project.segments[project.segments.length - 1].phase;
                        }

                        return project.phase;
                      };

                      const phaseA = getPhaseForSort(a);
                      const phaseB = getPhaseForSort(b);

                      // Phase order: Reporting (including Post-Field Analysis), Fielding, Pre-Field (including Kickoff/Awaiting KO), Complete
                      const phaseOrder: { [key: string]: number } = {
                        'Post-Field Analysis': 0,
                        'Reporting': 0,
                        'Fielding': 1,
                        'Awaiting KO': 2,
                        'Kickoff': 2,
                        'Pre-Field': 2,
                        'Complete': 3
                      };

                      const orderA = phaseOrder[phaseA] ?? 999;
                      const orderB = phaseOrder[phaseB] ?? 999;

                      // Sort by phase first
                      if (orderA !== orderB) {
                        return orderA - orderB;
                      }

                      // If same phase, sort by progress completion (higher % first)
                      return b.calculatedProgress - a.calculatedProgress;
                    })
                    .map((project) => {
                      const progress = project.calculatedProgress;

                      // Get current phase
                      const getCurrentPhase = (project: Project): string => {
                        const today = new Date();
                        today.setHours(0, 0, 0, 0);
                        
                        // Check if project is completed (day after report deadline)
                        const reportDeadline = project.keyDeadlines?.find(d => 
                          d.label.toLowerCase().includes('report') || 
                          d.label.toLowerCase().includes('final')
                        );
                        
                        if (reportDeadline?.date) {
                          const reportDate = new Date(reportDeadline.date);
                          reportDate.setHours(0, 0, 0, 0);
                          
                          if (today > reportDate) {
                            return 'Complete';
                          }
                        }
                        
                        if (!project.segments || project.segments.length === 0) {
                          return project.phase;
                        }

                        const todayStr = today.toISOString().split('T')[0];

                        for (const segment of project.segments) {
                          if (todayStr >= segment.startDate && todayStr <= segment.endDate) {
                            return segment.phase;
                          }
                        }

                        if (todayStr < project.segments[0].startDate) {
                          return project.segments[0].phase;
                        }

                        if (todayStr > project.segments[project.segments.length - 1].endDate) {
                          return project.segments[project.segments.length - 1].phase;
                        }

                        return project.phase;
                      };

                      const currentPhase = getCurrentPhase(project);
                      
                      // Get color based on current phase
                      const getPhaseColor = (phase: string) => {
                        const phaseColors: { [key: string]: string } = {
                          'Kickoff': '#6B7280',
                          'Pre-Field': '#1D4ED8',
                          'Fielding': '#7C3AED',
                          'Post-Field Analysis': '#F97316',
                          'Reporting': '#DC2626',
                          'Complete': '#10B981',
                          'Awaiting KO': '#9CA3AF'
                        };
                        return phaseColors[phase] || '#6B7280';
                      };
                      
                      const teamMembers = project.teamMembers || [];

                      return (
                        <tr
                          key={`project-${project.id}`}
                          className="shadow-sm hover:bg-gray-50 transition-colors duration-200"
                          onMouseEnter={() => setHoveredProjectId(project.id)}
                          onMouseLeave={() => setHoveredProjectId(null)}
                        >
                          {/* Project Column */}
                          <td className="px-4 py-4">
                            <div>
                              <div className="text-sm font-medium text-gray-900 truncate" title={project.name}>{project.name}</div>
                              <div className="text-sm text-gray-500 truncate" title={project.client}>{project.client}</div>
                            </div>
                          </td>
                          
                          {/* Team Column */}
                          <td className="px-4 py-4">
                            <div className="flex flex-nowrap gap-1">
                              {teamMembers.slice(0, 2).map((member, index) => {
                                const initials = member.name.split(' ').map(n => n[0]).join('').toUpperCase();
                                return (
                                  <span
                                    key={index}
                                    className="inline-flex items-center justify-center w-6 h-6 rounded-full text-xs font-medium text-white flex-shrink-0"
                                    style={{ backgroundColor: BRAND.orange }}
                                    title={member.name}
                                  >
                                    {initials}
                                  </span>
                                );
                              })}
                              {teamMembers.length > 2 && (
                                <span className="inline-flex items-center justify-center w-6 h-6 rounded-full text-xs font-medium bg-gray-100 text-gray-800 flex-shrink-0">
                                  +{teamMembers.length - 2}
                                </span>
                              )}
                            </div>
                          </td>

                          {/* Progress Column with Phase Label */}
                          <td className="px-4 py-4" colSpan={2}>
                            <div className="flex items-center gap-3">
                              {/* Phase Label */}
                              {(() => {
                                // Map phases to the 3 main categories
                                let displayPhase = currentPhase;
                                let displayColor = getPhaseColor(currentPhase);

                                if (currentPhase === 'Kickoff' || currentPhase === 'Awaiting KO') {
                                  displayPhase = 'Pre-Field';
                                  displayColor = getPhaseColor('Pre-Field');
                                } else if (currentPhase === 'Post-Field Analysis') {
                                  displayPhase = 'Reporting';
                                  displayColor = getPhaseColor('Reporting');
                                }

                                // Only show if it's one of the 3 main phases
                                if (['Pre-Field', 'Fielding', 'Reporting'].includes(displayPhase)) {
                                  return (
                                    <span
                                      className="inline-flex items-center justify-center px-2 py-1 rounded-full text-xs font-medium text-white whitespace-nowrap"
                                      style={{
                                        backgroundColor: displayColor + 'B3',
                                        width: '80px'
                                      }}
                                    >
                                      {displayPhase}
                                    </span>
                                  );
                                }
                                return null;
                              })()}

                              {/* Vertical grey line (chart base) */}
                              <div className="h-6 w-px bg-gray-300"></div>

                              {/* Progress Bar */}
                              <div className="flex-1 rounded-full h-5 flex">
                                {(() => {
                                  const today = new Date();
                                  today.setHours(0, 0, 0, 0);
                                  const todayStr = today.toISOString().split('T')[0];

                                  // Get all segments for the 3 main phases and combine them
                                  const preFieldSegments = project.segments?.filter(s =>
                                    s.phase === 'Pre-Field' || s.phase === 'Kickoff' || s.phase === 'Awaiting KO'
                                  ) || [];
                                  const fieldingSegments = project.segments?.filter(s => s.phase === 'Fielding') || [];
                                  const reportingSegments = project.segments?.filter(s =>
                                    s.phase === 'Reporting' || s.phase === 'Post-Field Analysis'
                                  ) || [];

                                  // Combine segments by finding earliest start and latest end
                                  const combineSegments = (segments: any[]) => {
                                    if (segments.length === 0) return null;
                                    const startDates = segments.map(s => s.startDate);
                                    const endDates = segments.map(s => s.endDate);
                                    return {
                                      startDate: startDates.sort()[0],
                                      endDate: endDates.sort().reverse()[0]
                                    };
                                  };

                                  const preFieldSegment = combineSegments(preFieldSegments);
                                  const fieldingSegment = combineSegments(fieldingSegments);
                                  const reportingSegment = combineSegments(reportingSegments);

                                  // Calculate weekdays between two dates
                                  const countWeekdays = (startDate: string, endDate: string) => {
                                    const start = new Date(startDate);
                                    const end = new Date(endDate);
                                    let count = 0;
                                    const current = new Date(start);

                                    while (current <= end) {
                                      const day = current.getDay();
                                      if (day !== 0 && day !== 6) { // Not Sunday (0) or Saturday (6)
                                        count++;
                                      }
                                      current.setDate(current.getDate() + 1);
                                    }
                                    return count;
                                  };

                                  // Calculate progress for each phase
                                  const calculatePhaseProgress = (segment: any) => {
                                    if (!segment) return 0;
                                    const start = new Date(segment.startDate);
                                    const end = new Date(segment.endDate);
                                    start.setHours(0, 0, 0, 0);
                                    end.setHours(0, 0, 0, 0);

                                    if (todayStr < segment.startDate) return 0;
                                    if (todayStr > segment.endDate) return 100;

                                    const total = end.getTime() - start.getTime();
                                    const elapsed = today.getTime() - start.getTime();
                                    return Math.min(100, Math.max(0, Math.round((elapsed / total) * 100)));
                                  };

                                  const preFieldProgress = calculatePhaseProgress(preFieldSegment);
                                  const fieldingProgress = calculatePhaseProgress(fieldingSegment);
                                  const reportingProgress = calculatePhaseProgress(reportingSegment);

                                  // Calculate weekdays for each phase
                                  const preFieldWeekdays = preFieldSegment ? countWeekdays(preFieldSegment.startDate, preFieldSegment.endDate) : 0;
                                  const fieldingWeekdays = fieldingSegment ? countWeekdays(fieldingSegment.startDate, fieldingSegment.endDate) : 0;
                                  const reportingWeekdays = reportingSegment ? countWeekdays(reportingSegment.startDate, reportingSegment.endDate) : 0;
                                  const totalWeekdays = preFieldWeekdays + fieldingWeekdays + reportingWeekdays;

                                  const phases = [
                                    {
                                      name: 'Pre-Field',
                                      progress: preFieldProgress,
                                      color: '#1D4ED8',
                                      lightColor: '#BFDBFE',
                                      width: totalWeekdays > 0 ? (preFieldWeekdays / totalWeekdays) * 100 : 33.33
                                    },
                                    {
                                      name: 'Fielding',
                                      progress: fieldingProgress,
                                      color: '#7C3AED',
                                      lightColor: '#DDD6FE',
                                      width: totalWeekdays > 0 ? (fieldingWeekdays / totalWeekdays) * 100 : 33.33
                                    },
                                    {
                                      name: 'Reporting',
                                      progress: reportingProgress,
                                      color: '#DC2626',
                                      lightColor: '#FECACA',
                                      width: totalWeekdays > 0 ? (reportingWeekdays / totalWeekdays) * 100 : 33.33
                                    }
                                  ];

                                  return phases.map((phase, index) => (
                                    <div
                                      key={phase.name}
                                      className="h-5 relative"
                                      style={{
                                        width: `${phase.width}%`,
                                        backgroundColor: phase.lightColor + '66',
                                        marginRight: index < phases.length - 1 ? '1px' : '0'
                                      }}
                                    >
                                      {/* Completed portion overlay */}
                                      {phase.progress > 0 && (
                                        <div
                                          className="absolute left-0 top-0 h-5 flex items-center justify-center"
                                          style={{
                                            width: `${phase.progress}%`,
                                            backgroundColor: phase.color + 'B3'
                                          }}
                                        >
                                          {phase.progress === 100 && (
                                            <svg
                                              className="w-3 h-3 text-white"
                                              fill="none"
                                              stroke="currentColor"
                                              strokeWidth="2"
                                              strokeLinecap="round"
                                              strokeLinejoin="round"
                                              viewBox="0 0 24 24"
                                            >
                                              <path d="M20 6L9 17l-5-5" />
                                            </svg>
                                          )}
                                        </div>
                                      )}
                                    </div>
                                  ));
                                })()}
                              </div>
                            </div>
                          </td>
                          
                          {/* Project Update Column */}
                          <td className="px-2 py-4 align-middle text-center">
                              <button
                                onClick={() => handleGetProjectUpdate(project)}
                                className="text-gray-600 hover:text-gray-800"
                                title="Get a project update"
                              >
                                <DocumentTextIcon className="w-6 h-6" />
                              </button>
                          </td>

                          {/* View Project Column */}
                          <td
                            className="p-0 relative overflow-hidden"
                            style={{
                              width: '3rem',
                              minWidth: '3rem'
                            }}
                          >
                            <div
                              className="absolute top-0 right-0 h-full transition-all duration-300 ease-in-out flex items-center justify-center"
                              style={{
                                width: hoveredProjectId === project.id ? '3rem' : '0.75rem',
                                background: (() => {
                                  let mappedPhase = currentPhase;
                                  if (currentPhase === 'Kickoff' || currentPhase === 'Awaiting KO') {
                                    mappedPhase = 'Pre-Field';
                                  } else if (currentPhase === 'Post-Field Analysis') {
                                    mappedPhase = 'Reporting';
                                  }
                                  return `linear-gradient(to right, ${getDarkBucketColor(getPhaseBucket(mappedPhase))}B3 0%, ${getBucketColor(getPhaseBucket(mappedPhase))}B3 25%, ${getBucketColor(getPhaseBucket(mappedPhase))}B3 100%)`;
                                })()
                              }}
                            >
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  onNavigateToProject?.(project);
                                }}
                                className="text-white hover:opacity-80 transition-opacity duration-200"
                                title="View project details"
                                style={{
                                  opacity: hoveredProjectId === project.id ? 1 : 0
                                }}
                              >
                                <EyeIcon className="w-6 h-6" />
                              </button>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                </tbody>
              </table>
            </div>
          </div>
        </div>

        {/* Right Column - Calendar and Key Dates */}
        <div className="flex flex-col gap-6">
          {/* Filter Dropdowns */}
          <div className="bg-white rounded-lg border border-gray-200 p-4">
            <h3 className="text-lg font-semibold text-gray-900 mb-4">Filters</h3>
            
            {/* Team Member Filter */}
            <div className="mb-4">
              <label className="block text-sm font-medium text-gray-700 mb-2">Team Member</label>
              <select
                value={selectedTeamMember}
                onChange={(e) => setSelectedTeamMember(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="">All Team Members</option>
                {teamMembers.map(member => (
                  <option key={member} value={member}>{member}</option>
                ))}
              </select>
            </div>
            
            {/* Client Filter */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Client</label>
              <select
                value={selectedClient}
                onChange={(e) => setSelectedClient(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="">All Clients</option>
                {clients.map(client => (
                  <option key={client} value={client}>{client}</option>
                ))}
              </select>
            </div>
          </div>

          {/* Calendar */}
          <div className="bg-white rounded-lg border border-gray-200 p-4">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold text-gray-900">Calendar</h3>
              <div className="flex items-center space-x-2">
                <button
                  onClick={() => navigateMonth('prev')}
                  className="p-1 hover:bg-gray-100 rounded"
                >
                  <ChevronLeftIcon className="w-4 h-4" />
                </button>
                <span className="text-sm font-medium">
                  {new Date(currentYear, currentMonth).toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}
                </span>
                <button
                  onClick={() => navigateMonth('next')}
                  className="p-1 hover:bg-gray-100 rounded"
                >
                  <ChevronRightIcon className="w-4 h-4" />
                </button>
              </div>
            </div>
            
            {/* Calendar Grid */}
            <div className="grid grid-cols-7 gap-1">
              {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map(day => (
                <div key={day} className="text-center text-xs font-medium text-gray-500 py-2">
                  {day}
                </div>
              ))}
              
              {Array.from({ length: new Date(currentYear, currentMonth, 0).getDate() }, (_, i) => {
                const day = i + 1;
                const date = new Date(currentYear, currentMonth, day);
                const isToday = date.toDateString() === new Date().toDateString();
                const isSelected = selectedDate && date.toDateString() === selectedDate.toDateString();
                
                return (
                  <button
                    key={day}
                    onClick={() => handleDateClick(day)}
                    className={`p-2 text-sm rounded hover:bg-gray-100 ${
                      isToday ? 'bg-blue-100 text-blue-600' : ''
                    } ${isSelected ? 'bg-blue-600 text-white' : ''}`}
                  >
                    {day}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Key Dates */}
          <div className="bg-white rounded-lg border border-gray-200 p-4">
            <h3 className="text-lg font-semibold text-gray-900 mb-4">Key Dates</h3>
            <div className="space-y-2 max-h-64 overflow-y-auto">
              {keyDates.length === 0 ? (
                <p className="text-gray-500 text-sm">No key dates found</p>
              ) : (
                keyDates.map((keyDate, index) => (
                  <div key={index} className="flex items-center justify-between p-2 bg-gray-50 rounded">
                    <div>
                      <div className="text-sm font-medium text-gray-900">
                        {keyDate.type === 'kickoff' ? 'Kickoff' :
                         keyDate.type === 'fieldStart' ? 'Field Start' :
                         keyDate.type === 'fieldEnd' ? 'Field End' :
                         'Report Due'}
                      </div>
                      <div className="text-xs text-gray-500">{keyDate.projectName}</div>
                    </div>
                    <div className="text-xs text-gray-600">
                      {new Date(keyDate.date).toLocaleDateString()}
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Project Update Modal */}
      {projectUpdateModal.show && projectUpdateModal.project && projectUpdateModal.update && createPortal(
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-[10101]" style={{ top: 0, left: 0, right: 0, bottom: 0 }}>
          <div className="bg-white rounded-lg shadow-xl max-w-2xl w-full mx-4 max-h-[80vh] overflow-hidden flex flex-col">
            <div className="px-6 py-4 border-b border-gray-200 flex items-center justify-between" style={{ backgroundColor: BRAND.orange }}>
              <h3 className="text-lg font-semibold text-white">Project Update: {projectUpdateModal.project.name}</h3>
              <button
                onClick={() => {
                  setProjectUpdateModal({ show: false, project: null, update: null });
                  setExpandedPhases(new Set());
                }}
                className="text-white hover:text-gray-200 transition-colors"
                aria-label="Close"
              >
                <XMarkIcon className="h-6 w-6" />
              </button>
            </div>
            <div className="px-6 py-4 overflow-y-auto flex-1">
              <div className="prose max-w-none">
                {projectUpdateModal.update.split('\n').map((line, index) => {
                  if (line.trim() === '') {
                    return <div key={index} className="h-2"></div>;
                  } else if (line.trim() === '[DIVIDER]') {
                    return <hr key={index} className="my-3 border-gray-300" />;
                  } else if (line.startsWith('[PHASE]')) {
                    // Skip phase lines - don't render them
                    return null;
                  } else if (line.startsWith('[TASK]')) {
                    const taskMatch = line.match(/\[TASK\]\s*(.+?)\|(.+?)\|(.+?)\|(.+)/);
                    if (taskMatch) {
                      const [, taskDescription, projectName, dueDate, assignedTo] = taskMatch;
                      return (
                        <div key={index} className="mb-2 p-2 bg-blue-50 border border-blue-200 rounded">
                          <div className="text-sm font-medium text-gray-900">{taskDescription}</div>
                          <div className="text-xs text-gray-600">Project: {projectName} • Due: {dueDate} • Assigned: {assignedTo}</div>
                        </div>
                      );
                    }
                  } else if (line.startsWith('[KEYDATE]')) {
                    const keyDateMatch = line.match(/\[KEYDATE\]\s*(.+?)\|(.+)/);
                    if (keyDateMatch) {
                      const [, label, date] = keyDateMatch;
                      return (
                        <div key={index} className="mb-2 p-2 bg-yellow-50 border border-yellow-200 rounded">
                          <div className="text-sm font-medium text-gray-900">{label}</div>
                          <div className="text-xs text-gray-600">Date: {date}</div>
                        </div>
                      );
                    }
                  } else if (line.startsWith('**') && line.endsWith('**')) {
                    return <h4 key={index} className="text-lg font-semibold text-gray-900 mt-4 mb-2">{line.replace(/\*\*/g, '')}</h4>;
                  } else {
                    // Handle inline bold markdown (**text**)
                    const parts = line.split(/(\*\*[^*]+\*\*)/g);
                    return (
                      <p key={index} className="text-sm text-gray-700 mb-2">
                        {parts.map((part, partIndex) => {
                          if (part.startsWith('**') && part.endsWith('**')) {
                            return <strong key={partIndex}>{part.replace(/\*\*/g, '')}</strong>;
                          }
                          return <span key={partIndex}>{part}</span>;
                        })}
                      </p>
                    );
                  }
                })}
              </div>
              {/* Phase Breakdown Section */}
              <div className="border-t border-gray-200 pt-4">
                {(() => {
                  const project = projectUpdateModal.project;
                  const phases = ['Pre-Field', 'Fielding', 'Reporting'];
                  const today = new Date();
                  today.setHours(0, 0, 0, 0);
                  const todayStr = today.toISOString().split('T')[0];

                  // Helper to get combined phase date range from segments
                  const getPhaseSegment = (phaseName: string) => {
                    let segments = [];
                    if (phaseName === 'Pre-Field') {
                      segments = project.segments?.filter(s =>
                        s.phase === 'Pre-Field' || s.phase === 'Kickoff' || s.phase === 'Awaiting KO'
                      ) || [];
                    } else if (phaseName === 'Reporting') {
                      segments = project.segments?.filter(s =>
                        s.phase === 'Reporting' || s.phase === 'Post-Field Analysis'
                      ) || [];
                    } else {
                      segments = project.segments?.filter(s => s.phase === phaseName) || [];
                    }

                    if (segments.length === 0) return null;

                    const startDates = segments.map(s => s.startDate);
                    const endDates = segments.map(s => s.endDate);
                    return {
                      startDate: startDates.sort()[0],
                      endDate: endDates.sort().reverse()[0]
                    };
                  };

                  // Helper to format date
                  const formatDate = (dateStr: string) => {
                    // Parse date string and create in local timezone to avoid UTC conversion issues
                    const [year, month, day] = dateStr.split('-').map(Number);
                    const date = new Date(year, month - 1, day);
                    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
                  };

                  // Helper to check if phase is completed
                  const isPhaseComplete = (phaseName: string) => {
                    const segment = getPhaseSegment(phaseName);
                    if (!segment) return false;
                    return todayStr > segment.endDate;
                  };

                  // Helper to determine which phase a date belongs to
                  const getPhaseForDate = (dateStr: string) => {
                    if (!project.segments) return null;
                    for (const segment of project.segments) {
                      if (dateStr >= segment.startDate && dateStr <= segment.endDate) {
                        // Map to the 3 main phases
                        if (segment.phase === 'Kickoff' || segment.phase === 'Awaiting KO' || segment.phase === 'Pre-Field') {
                          return 'Pre-Field';
                        } else if (segment.phase === 'Post-Field Analysis' || segment.phase === 'Reporting') {
                          return 'Reporting';
                        }
                        return segment.phase;
                      }
                    }
                    return null;
                  };

                  // Determine current phase
                  const getCurrentPhase = () => {
                    if (!project.segments || project.segments.length === 0) {
                      // Map project phase to main phases
                      if (project.phase === 'Kickoff' || project.phase === 'Awaiting KO' || project.phase === 'Pre-Field') {
                        return 'Pre-Field';
                      } else if (project.phase === 'Post-Field Analysis' || project.phase === 'Reporting') {
                        return 'Reporting';
                      }
                      return project.phase;
                    }

                    for (const segment of project.segments) {
                      if (todayStr >= segment.startDate && todayStr <= segment.endDate) {
                        // Map to the 3 main phases
                        if (segment.phase === 'Kickoff' || segment.phase === 'Awaiting KO' || segment.phase === 'Pre-Field') {
                          return 'Pre-Field';
                        } else if (segment.phase === 'Post-Field Analysis' || segment.phase === 'Reporting') {
                          return 'Reporting';
                        }
                        return segment.phase;
                      }
                    }

                    // If today is before all segments, return first phase
                    if (todayStr < project.segments[0].startDate) {
                      const firstPhase = project.segments[0].phase;
                      if (firstPhase === 'Kickoff' || firstPhase === 'Awaiting KO' || firstPhase === 'Pre-Field') {
                        return 'Pre-Field';
                      } else if (firstPhase === 'Post-Field Analysis' || firstPhase === 'Reporting') {
                        return 'Reporting';
                      }
                      return firstPhase;
                    }

                    // If today is after all segments, return last phase
                    const lastPhase = project.segments[project.segments.length - 1].phase;
                    if (lastPhase === 'Kickoff' || lastPhase === 'Awaiting KO' || lastPhase === 'Pre-Field') {
                      return 'Pre-Field';
                    } else if (lastPhase === 'Post-Field Analysis' || lastPhase === 'Reporting') {
                      return 'Reporting';
                    }
                    return lastPhase;
                  };

                  const currentPhase = getCurrentPhase();

                  return (
                    <div className="space-y-0">
                      {phases.map((phase, index) => {
                        const segment = getPhaseSegment(phase);
                        const phaseColor = PHASE_COLORS[phase] || '#6B7280';
                        const isComplete = isPhaseComplete(phase);
                        const isLast = index === phases.length - 1;
                        const isExpanded = expandedPhases.has(phase);
                        const isCurrentPhase = phase === currentPhase;

                        // Get incomplete tasks for this phase (only if it's the current phase)
                        const phaseTasks = isCurrentPhase ? (project.tasks || []).filter(task => {
                          if (!task.dueDate || task.status === 'completed') return false;
                          return getPhaseForDate(task.dueDate) === phase;
                        }).sort((a, b) => new Date(a.dueDate!).getTime() - new Date(b.dueDate!).getTime()) : [];

                        const tasksToShow = isExpanded ? phaseTasks : phaseTasks.slice(0, 3);
                        const hasMoreTasks = phaseTasks.length > 3;

                        return (
                          <div key={phase} className="flex">
                            {/* Circle and Line Column */}
                            <div className="flex flex-col items-center mr-3">
                              {/* Circle */}
                              <div
                                className="w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0"
                                style={{
                                  backgroundColor: isComplete
                                    ? phaseColor + '80'  // 50% opacity for completed
                                    : isCurrentPhase
                                      ? phaseColor + 'CC'  // 80% opacity for current
                                      : 'white',  // white for future phases
                                  border: `2px solid ${isComplete
                                    ? phaseColor + '66'  // 40% opacity for completed (lighter border)
                                    : isCurrentPhase
                                      ? phaseColor + 'CC'  // 80% opacity for current
                                      : phaseColor}`  // full opacity for future phases
                                }}
                              >
                                {isComplete && (
                                  <svg
                                    className="w-4 h-4 text-white"
                                    fill="none"
                                    stroke="currentColor"
                                    strokeWidth="3"
                                    strokeLinecap="round"
                                    strokeLinejoin="round"
                                    viewBox="0 0 24 24"
                                  >
                                    <path d="M20 6L9 17l-5-5" />
                                  </svg>
                                )}
                              </div>

                              {/* Connecting Line */}
                              {!isLast && (
                                <div
                                  className="w-0.5 flex-1"
                                  style={{
                                    backgroundColor: isComplete
                                      ? phaseColor + '80'  // 50% opacity for completed
                                      : isCurrentPhase
                                        ? phaseColor + 'CC'  // 80% opacity for current
                                        : phaseColor,  // full opacity for future phases
                                    minHeight: '40px'
                                  }}
                                />
                              )}
                            </div>

                            {/* Phase Info Column */}
                            <div className="flex-1 pb-4">
                              <h4 className={`text-base font-semibold ${isComplete ? 'text-gray-400' : 'text-gray-900'}`}>{phase}</h4>
                              {segment && (
                                <p className={`text-sm mt-1 ${isComplete ? 'text-gray-400' : isCurrentPhase ? 'text-gray-900 font-semibold' : 'text-gray-500'}`}>
                                  {formatDate(segment.startDate)} - {formatDate(segment.endDate)}
                                </p>
                              )}

                              {/* Tasks List */}
                              {tasksToShow.length > 0 && (
                                <div className="mt-3 space-y-2">
                                  {tasksToShow.map((task, idx) => (
                                    <div
                                      key={idx}
                                      className="bg-gray-50 rounded px-3 py-2 flex justify-between items-start"
                                      style={{
                                        borderLeft: `3px solid ${phaseColor}`
                                      }}
                                    >
                                      <span className="flex-1 text-sm text-gray-700">{task.description || task.content}</span>
                                      <span className="text-xs text-gray-500 ml-3 whitespace-nowrap">
                                        {task.dueDate ? formatDate(task.dueDate) : ''}
                                      </span>
                                    </div>
                                  ))}
                                </div>
                              )}

                              {/* Show More Button */}
                              {hasMoreTasks && !isExpanded && (
                                <button
                                  onClick={() => {
                                    const newExpanded = new Set(expandedPhases);
                                    newExpanded.add(phase);
                                    setExpandedPhases(newExpanded);
                                  }}
                                  className="mt-2 text-sm text-blue-600 hover:text-blue-800 font-medium"
                                >
                                  Show more ({phaseTasks.length - 3} remaining)
                                </button>
                              )}

                              {/* Show Less Button */}
                              {isExpanded && hasMoreTasks && (
                                <button
                                  onClick={() => {
                                    const newExpanded = new Set(expandedPhases);
                                    newExpanded.delete(phase);
                                    setExpandedPhases(newExpanded);
                                  }}
                                  className="mt-2 text-sm text-blue-600 hover:text-blue-800 font-medium"
                                >
                                  Show less
                                </button>
                              )}

                              {/* Only show "No remaining tasks" for current phase */}
                              {isCurrentPhase && phaseTasks.length === 0 && (
                                <p className="text-sm text-gray-500 italic mt-2">No remaining tasks</p>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  );
                })()}
              </div>
            </div>
          </div>
        </div>,
        document.body
      )}
    </div>
  );
}

// Project Timeline Component
function ProjectTimeline({ projects, onDateRangeChange, maxWeeks, onProjectClick }: { projects: Project[]; onDateRangeChange?: (dateRange: string) => void; maxWeeks?: number; onProjectClick?: (project: Project) => void }) {
  const [currentWeekOffset, setCurrentWeekOffset] = useState(0); // Start with current week like Moderator Schedule
  const [isScrolling, setIsScrolling] = useState(false);
  const [visibleWeeks, setVisibleWeeks] = useState(maxWeeks || 5);
  const timelineRef = useRef<HTMLDivElement>(null);

  // Helper function to check if a date is today
  const isToday = (date: Date) => {
    const today = new Date();
    return date.getUTCFullYear() === today.getUTCFullYear() &&
           date.getUTCMonth() === today.getUTCMonth() &&
           date.getUTCDate() === today.getUTCDate();
  };

  // Calculate number of weeks to show based on container width
  useEffect(() => {
    const updateVisibleWeeks = () => {
      if (timelineRef.current) {
        const containerWidth = timelineRef.current.offsetWidth;
        // Each week needs ~150px minimum to prevent overflow in split screen
        const weeksToShow = Math.max(2, Math.min(maxWeeks || 3, Math.floor(containerWidth / 150)));
        setVisibleWeeks(weeksToShow);
      }
    };

    updateVisibleWeeks();
    
    // Use ResizeObserver for better split screen detection
    const resizeObserver = new ResizeObserver(updateVisibleWeeks);
    if (timelineRef.current) {
      resizeObserver.observe(timelineRef.current);
    }
    
    window.addEventListener('resize', updateVisibleWeeks);
    return () => {
      window.removeEventListener('resize', updateVisibleWeeks);
      resizeObserver.disconnect();
    };
  }, [maxWeeks]);

  // Get current week start (Monday) - always start from Monday using UTC
  const getWeekStart = (weekOffset: number) => {
    const today = new Date();

    // Find the Monday of the current week using UTC
    const currentDay = today.getUTCDay();
    const daysToMonday = currentDay === 0 ? -6 : 1 - currentDay; // Sunday = 0, so go back 6 days to Monday

    // Get the Monday of the current week using UTC
    const currentMonday = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate() + daysToMonday));

    // Add the week offset (each offset is 7 days) using UTC
    const targetMonday = new Date(Date.UTC(
      currentMonday.getUTCFullYear(),
      currentMonday.getUTCMonth(),
      currentMonday.getUTCDate() + (weekOffset * 7)
    ));

    // Ensure we always get a Monday by checking and correcting if needed
    const targetDay = targetMonday.getUTCDay();
    if (targetDay !== 1) {
      // If it's not Monday, adjust to the nearest Monday
      const daysToNearestMonday = targetDay === 0 ? -6 : 1 - targetDay;
      const correctedMonday = new Date(Date.UTC(
        targetMonday.getUTCFullYear(),
        targetMonday.getUTCMonth(),
        targetMonday.getUTCDate() + daysToNearestMonday
      ));
      return correctedMonday;
    }

    return targetMonday;
  };

  // Generate weeks data - use visible weeks for fixed width timeline
  const totalWeeks = visibleWeeks; // Use the calculated visible weeks for fixed width
  const weeks = Array.from({ length: totalWeeks }, (_, i) => {
    const weekStart = getWeekStart(currentWeekOffset + i);
    const weekEnd = new Date(Date.UTC(weekStart.getUTCFullYear(), weekStart.getUTCMonth(), weekStart.getUTCDate() + 4)); // Only Monday-Friday (5 days)
    
    
    // Check if this week contains today's date (Monday-Friday only)
    const today = new Date();
    const todayStr = today.toISOString().split('T')[0]; // YYYY-MM-DD format
    const weekStartStr = weekStart.toISOString().split('T')[0];
    const weekEndStr = weekEnd.toISOString().split('T')[0];
    
    // Only highlight if today is a weekday (Monday-Friday) and within this work week
    const todayDay = today.getDay(); // 0 = Sunday, 1 = Monday, ..., 6 = Saturday
    const isWeekday = todayDay >= 1 && todayDay <= 5; // Monday = 1, Friday = 5
    
    // For weekend days, highlight the current work week (Monday-Friday)
    let isCurrentWeek = false;
    if (isWeekday) {
      isCurrentWeek = todayStr >= weekStartStr && todayStr <= weekEndStr;
    } else {
      // If it's weekend, check if this is the current work week
      // Find the Monday of the current week
      const currentMonday = new Date(today);
      const currentDay = today.getDay();
      const mondayOffset = currentDay === 0 ? -6 : 1 - currentDay;
      currentMonday.setDate(today.getDate() + mondayOffset);
      const currentMondayStr = currentMonday.toISOString().split('T')[0];
      isCurrentWeek = weekStartStr === currentMondayStr;
    }
    
    // Generate only Monday-Friday days - ensure we always start from Monday using UTC
    const days = Array.from({ length: 5 }, (_, dayIndex) => {
      // Use UTC components to avoid timezone issues
      const day = new Date(Date.UTC(weekStart.getUTCFullYear(), weekStart.getUTCMonth(), weekStart.getUTCDate() + dayIndex));
      
      
      return day;
    });
    
    
    
    return {
      start: weekStart,
      end: weekEnd,
      isCurrentWeek: isCurrentWeek,
      days: days
    };
  });

  // Update parent with date range whenever weeks change
  useEffect(() => {
    if (onDateRangeChange && weeks.length > 0) {
      const dateRange = `${weeks[0]?.start.toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric'
      })} - ${weeks[weeks.length - 1]?.end.toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
        year: 'numeric'
      })}`;
      onDateRangeChange(dateRange);
    }
  }, [weeks, onDateRangeChange]);

  // Get project phase for a specific date
  const getProjectPhaseForDate = (project: Project, date: Date): string | null => {
    if (!project.segments || project.segments.length === 0) {
      // Don't show yellow status phases in calendars
      if (project.phase === 'Awaiting KO' || project.phase === 'Complete') {
        return null;
      }
      return project.phase;
    }

    // Use UTC methods to get consistent date string
    const dateStr = date.getUTCFullYear() + '-' +
                   String(date.getUTCMonth() + 1).padStart(2, '0') + '-' +
                   String(date.getUTCDate()).padStart(2, '0');

    for (const segment of project.segments) {
      if (dateStr >= segment.startDate && dateStr <= segment.endDate) {
        return segment.phase;
      }
    }

    return null;
  };

  // Scroll functions
  const scrollLeft = () => {
    if (isScrolling) return;
    setIsScrolling(true);
    setCurrentWeekOffset(prev => Math.max(-15, prev - 1));
    setTimeout(() => setIsScrolling(false), 300);
  };

  const scrollRight = () => {
    if (isScrolling) return;
    setIsScrolling(true);
    setCurrentWeekOffset(prev => Math.min(15, prev + 1));
    setTimeout(() => setIsScrolling(false), 300);
  };

  const resetToCurrentWeek = () => {
    if (isScrolling) return;
    setIsScrolling(true);
    setCurrentWeekOffset(0);
    setTimeout(() => setIsScrolling(false), 300);
  };


  return (
    <div className="space-y-4">
      {/* Timeline Container */}
      <div ref={timelineRef} className="overflow-hidden select-none px-0.5 sm:px-1 md:px-2">
        <div className="w-full min-w-0 max-w-full">

          {/* Timeline Container */}
          <div className="relative transition-all duration-300 ease-out">
            {/* Month Labels and Navigation */}
            <div className="flex mb-2">
              {/* Project Name Column Header (empty space) */}
              <div className="w-24 sm:w-32 md:w-40 flex-shrink-0 pl-4"></div>
              
              {/* Left Arrow */}
              <button onClick={scrollLeft} disabled={isScrolling || currentWeekOffset <= -20} className="p-2 text-gray-500 hover:text-gray-700 disabled:opacity-50">
                <ChevronLeftIcon className="w-5 h-5" />
              </button>
              
              {/* Month Labels */}
              <div className="flex-1 flex items-center justify-center relative">
                {(() => {
                  const months = [];
                  const dividers = [];
                  
                  for (let i = 0; i < visibleWeeks; i++) {
                    const weekStart = getWeekStart(currentWeekOffset + i);
                    const month = weekStart.toLocaleDateString('en-US', { month: 'long' });
                    
                    // Check if this is the first week of a new month
                    if (i === 0 || weekStart.getUTCMonth() !== getWeekStart(currentWeekOffset + i - 1).getUTCMonth()) {
                      months.push({
                        name: month,
                        startWeek: i,
                        endWeek: i
                      });
                      
                      // Add divider before this month (except for the first month)
                      if (i > 0) {
                        dividers.push(i);
                      }
                    } else {
                      // Extend the current month
                      if (months.length > 0) {
                        months[months.length - 1].endWeek = i;
                      }
                    }
                  }
                  
                  return (
                    <>
                      {months.map((month, index) => (
                        <div key={index} className="flex items-center">
                          <span className="text-sm font-medium text-gray-700">{month.name}</span>
                          {index < months.length - 1 && (
                            <div className="w-px h-4 bg-gray-300 mx-2"></div>
                          )}
                        </div>
                      ))}
                    </>
                  );
                })()}
              </div>
              
              {/* Right Arrow */}
              <button onClick={scrollRight} disabled={isScrolling || currentWeekOffset >= 20} className="p-2 text-gray-500 hover:text-gray-700 disabled:opacity-50">
                <ChevronRightIcon className="w-5 h-5" />
              </button>
            </div>
            
            {/* Date Header Row */}
            <div className="flex mb-0 border-b border-gray-200">
              {/* Project Name Column Header (empty space) */}
              <div className="w-24 sm:w-32 md:w-40 flex-shrink-0 pl-4"></div>
              
              {/* Date Headers */}
              <div className="flex-1 flex relative overflow-hidden">
                {weeks.map((week, weekIndex) => (
                  <div key={weekIndex} className={`flex relative ${week.isCurrentWeek ? 'bg-orange-50' : ''}`} style={{ width: `${100 / weeks.length}%` }}>
                    {week.days.map((day, dayIndex) => {
                      const isTodayDate = isToday(day);
                      const dayNames = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'];
                      
                      return (
                        <div
                          key={`${weekIndex}-${dayIndex}`}
                          className={`h-10 flex flex-col justify-center items-center text-center relative ${
                            dayIndex < 4 ? 'border-r border-gray-200' : ''
                          } ${isTodayDate ? 'bg-orange-100' : ''}`}
                          style={{ width: `${100 / 5}%` }}
                        >
                          <div className={`text-xs font-medium ${isTodayDate ? 'text-orange-600 font-bold' : 'text-gray-700'}`}>
                            {day.getUTCMonth() + 1}/{day.getUTCDate()}
                          </div>
                          <div className={`text-[10px] ${isTodayDate ? 'text-orange-500 font-bold' : 'text-gray-500'}`}>
                            {dayNames[dayIndex]}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                ))}
                
                {/* Week divider lines in headers - positioned between weeks */}
                {weeks.map((week, weekIndex) => {
                  if (weekIndex < weeks.length - 1) {
                    const weekWidth = 100 / weeks.length;
                    const leftPosition = (weekIndex + 1) * weekWidth;
                    return (
                      <div
                        key={`header-week-divider-${weekIndex}`}
                        className="absolute top-0 bottom-0 w-0.5 bg-gray-300 z-30"
                        style={{ left: `${leftPosition}%` }}
                      ></div>
                    );
                  }
                  return null;
                })}
              </div>
            </div>

            {/* Project Rows */}
            <div className="space-y-0 overflow-y-auto">
              {projects.map((project, projectIndex) => (
                <div key={project.id} className="flex items-stretch border-b border-gray-100 hover:bg-gray-100 cursor-pointer transition-colors duration-150" onClick={() => onProjectClick?.(project)}>
                  {/* Project Name Column */}
                  <div className="w-24 sm:w-32 md:w-40 flex-shrink-0 py-3 flex flex-col justify-center">
                    <div className="text-sm font-medium text-gray-900 truncate">
                      {project.name}
                    </div>
                    <div className="text-xs text-gray-500 truncate">
                      {project.client}
                    </div>
                  </div>
                  
                  {/* Timeline Area */}
                  <div className="flex-1 flex items-center relative py-2">
                    {/* Background grid with vertical lines */}
                    <div className="absolute inset-0 flex overflow-hidden pointer-events-none">
                      {weeks.map((week, weekIndex) => (
                        <div key={weekIndex} className={`flex relative ${week.isCurrentWeek ? 'bg-orange-50' : ''}`} style={{ width: `${100 / weeks.length}%` }}>
                          {week.days.map((day, dayIndex) => {
                            const isTodayDate = isToday(day);
                            
                            return (
                              <div
                                key={`${weekIndex}-${dayIndex}`}
                                className={`h-full relative ${
                                  dayIndex < 4 ? 'border-r border-gray-200' : ''
                                } ${isTodayDate ? 'bg-orange-100' : ''}`}
                                style={{ width: `${100 / 5}%` }}
                              >
                              </div>
                            );
                          })}
                        </div>
                      ))}
                    </div>
                    
                    {/* Week divider lines in timeline content - positioned between weeks */}
                    {weeks.map((week, weekIndex) => {
                      if (weekIndex < weeks.length - 1) {
                        const weekWidth = 100 / weeks.length;
                        const leftPosition = (weekIndex + 1) * weekWidth;
                        return (
                          <div
                            key={`timeline-week-divider-${weekIndex}`}
                            className="absolute top-0 bottom-0 w-0.5 bg-gray-300 z-30 pointer-events-none"
                            style={{ left: `${leftPosition}%` }}
                          ></div>
                        );
                      }
                      return null;
                    })}
                    
                    {/* Project phase pills */}
                    {(() => {
                      // Get project phase for each day - use the same structure as the background grid
                      const allDays = weeks.flatMap(week => week.days);
                      const allPhases = allDays.map(day => getProjectPhaseForDate(project, day));
                      
                      // Group consecutive days with the same phase
                      const phaseRanges: { phase: string; startIndex: number; endIndex: number; color: string }[] = [];
                      let currentRange: { phase: string; startIndex: number; endIndex: number; color: string } | null = null;
                      
                      allPhases.forEach((phase, index) => {
                        if (phase && phase !== currentRange?.phase) {
                          // Start new range
                          if (currentRange) {
                            phaseRanges.push(currentRange);
                          }
                          currentRange = {
                            phase,
                            startIndex: index,
                            endIndex: index,
                            color: PHASE_COLORS[phase as keyof typeof PHASE_COLORS]
                          };
                        } else if (phase && currentRange) {
                          // Extend current range
                          currentRange.endIndex = index;
                        } else if (!phase && currentRange) {
                          // End current range
                          phaseRanges.push(currentRange);
                          currentRange = null;
                        }
                      });
                      
                      // Add the last range if it exists
                      if (currentRange) {
                        phaseRanges.push(currentRange);
                      }
                      
                      return (
                        <>
                          {/* Phase bars - positioned to align exactly with date cell boundaries */}
                          {phaseRanges.map((range, rangeIndex) => {
                            const totalDays = allDays.length;
                            const dayWidth = 100 / totalDays;
                            
                            // Calculate exact positioning to align with grid cells
                            const startDay = range.startIndex;
                            const endDay = range.endIndex;
                            
                            // Left position: start of the first day cell
                            const leftPercent = (startDay / totalDays) * 100;
                            
                            // Width: span from start of first day to end of last day
                            const widthPercent = ((endDay - startDay + 1) / totalDays) * 100;
                            
                            return (
                              <div
                                key={rangeIndex}
                                className="absolute rounded-full pointer-events-none"
                                style={{
                                  backgroundColor: range.color,
                                  opacity: 0.6,
                                  top: '50%',
                                  transform: 'translateY(-50%)',
                                  height: '32px',
                                  left: `${leftPercent}%`,
                                  width: `${widthPercent}%`,
                                  zIndex: 50
                                }}
                              />
                            );
                          })}
                          
                          {/* Phase icons positioned on specific dates */}
                          {allPhases.map((phase, dayIndex) => {
                            const totalDays = allDays.length;
                            const dayWidth = 100 / totalDays;
                            const leftPercent = (dayIndex / totalDays) * 100;
                            
                            // Calculate the center position of each day
                            const iconLeft = leftPercent + (dayWidth / 2);
                            
                            return (
                              <div key={`icon-${dayIndex}`} className="absolute top-1/2 z-[100]" style={{
                                left: `${iconLeft}%`,
                                transform: 'translateX(-50%) translateY(-50%)'
                              }}>
                                {phase === 'Kickoff' && (
                                  <IconBallAmericanFootball 
                                    className="w-6 h-6 text-white drop-shadow-lg" 
                                    style={{ opacity: 1 }}
                                  />
                                )}
                                {phase === 'Fielding' && (dayIndex === 0 || allPhases[dayIndex - 1] !== 'Fielding') && (
                                  <IconRocket 
                                    className="w-6 h-6 text-white drop-shadow-lg" 
                                    style={{ opacity: 1 }}
                                  />
                                )}
                                {phase === 'Reporting' && (dayIndex === allDays.length - 1 || allPhases[dayIndex + 1] !== 'Reporting') && (
                                  <IconFileAnalyticsFilled 
                                    className="w-6 h-6 text-white drop-shadow-lg" 
                                    style={{ opacity: 1 }}
                                  />
                                )}
                              </div>
                            );
                          })}
                        </>
                      );
                    })()}
                  </div>
            </div>
          ))}
                </div>
                
                
        </div>
        </div>
      </div>
      {/* Footer with phase key */}
      <div className="border-t border-gray-200 px-4 py-4">
        <div className="flex flex-wrap gap-4 text-xs justify-center">
          <div className="flex items-center gap-2">
            <div className="w-3 h-3 rounded" style={{ backgroundColor: PHASE_COLORS.Kickoff, opacity: 0.6 }}></div>
            <span className="text-gray-700">Kickoff</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-3 h-3 rounded" style={{ backgroundColor: PHASE_COLORS['Pre-Field'], opacity: 0.6 }}></div>
            <span className="text-gray-700">Pre-Field</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-3 h-3 rounded" style={{ backgroundColor: PHASE_COLORS.Fielding, opacity: 0.6 }}></div>
            <span className="text-gray-700">Fielding</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-3 h-3 rounded" style={{ backgroundColor: PHASE_COLORS['Post-Field Analysis'], opacity: 0.6 }}></div>
            <span className="text-gray-700">Analysis</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-3 h-3 rounded" style={{ backgroundColor: PHASE_COLORS.Reporting, opacity: 0.6 }}></div>
            <span className="text-gray-700">Reporting</span>
          </div>
        </div>
      </div>
    </div>
  );
}

// Moderator Timeline Component
function ModeratorTimeline({ projects, moderators, onDateRangeChange }: { projects: Project[]; moderators?: any[]; onDateRangeChange?: (dateRange: string) => void }) {
  const [currentWeekOffset, setCurrentWeekOffset] = useState(0);
  const [isScrolling, setIsScrolling] = useState(false);
  const [visibleWeeks, setVisibleWeeks] = useState(5);
  const timelineRef = useRef<HTMLDivElement>(null);

  // Helper function to check if a date is today
  const isToday = (date: Date) => {
    const today = new Date();
    return date.getUTCFullYear() === today.getUTCFullYear() &&
           date.getUTCMonth() === today.getUTCMonth() &&
           date.getUTCDate() === today.getUTCDate();
  };

  // Calculate number of weeks to show based on container width
  useEffect(() => {
    const updateVisibleWeeks = () => {
      if (timelineRef.current) {
        const containerWidth = timelineRef.current.offsetWidth;
        // Each week needs ~120px minimum for comfortable viewing (reduced from 180px)
        const weeksToShow = Math.max(2, Math.min(5, Math.floor(containerWidth / 120)));
        setVisibleWeeks(weeksToShow);
      }
    };

    updateVisibleWeeks();
    window.addEventListener('resize', updateVisibleWeeks);
    return () => window.removeEventListener('resize', updateVisibleWeeks);
  }, []);

  // Get current week start (Monday) - always start from Monday using UTC
  const getWeekStart = (weekOffset: number) => {
    const today = new Date();

    // Find the Monday of the current week using UTC
    const currentDay = today.getUTCDay();
    const daysToMonday = currentDay === 0 ? -6 : 1 - currentDay; // Sunday = 0, so go back 6 days to Monday

    // Get the Monday of the current week using UTC
    const currentMonday = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate() + daysToMonday));

    // Add the week offset (each offset is 7 days) using UTC
    const targetMonday = new Date(Date.UTC(
      currentMonday.getUTCFullYear(),
      currentMonday.getUTCMonth(),
      currentMonday.getUTCDate() + (weekOffset * 7)
    ));

    // Ensure we always get a Monday by checking and correcting if needed
    const targetDay = targetMonday.getUTCDay();
    if (targetDay !== 1) {
      // If it's not Monday, adjust to the nearest Monday
      const daysToNearestMonday = targetDay === 0 ? -6 : 1 - targetDay;
      const correctedMonday = new Date(Date.UTC(
        targetMonday.getUTCFullYear(),
        targetMonday.getUTCMonth(),
        targetMonday.getUTCDate() + daysToNearestMonday
      ));
      return correctedMonday;
    }

    return targetMonday;
  };

  // Generate weeks data - use visible weeks for fixed width timeline
  const totalWeeks = visibleWeeks; // Use the calculated visible weeks for fixed width
  const weeks = Array.from({ length: totalWeeks }, (_, i) => {
    const weekStart = getWeekStart(currentWeekOffset + i);
    const weekEnd = new Date(Date.UTC(weekStart.getUTCFullYear(), weekStart.getUTCMonth(), weekStart.getUTCDate() + 4)); // Only Monday-Friday (5 days)

    // Check if this week contains today's date (Monday-Friday only)
    const today = new Date();
    const todayStr = today.toISOString().split('T')[0]; // YYYY-MM-DD format
    const weekStartStr = weekStart.toISOString().split('T')[0];
    const weekEndStr = weekEnd.toISOString().split('T')[0];

    // Only highlight if today is a weekday (Monday-Friday) and within this work week
    const todayDay = today.getDay(); // 0 = Sunday, 1 = Monday, ..., 6 = Saturday
    const isWeekday = todayDay >= 1 && todayDay <= 5; // Monday = 1, Friday = 5

    // For weekend days, highlight the current work week (Monday-Friday)
    let isCurrentWeek = false;
    if (isWeekday) {
      isCurrentWeek = todayStr >= weekStartStr && todayStr <= weekEndStr;
    } else {
      // If it's weekend, check if this is the current work week
      // Find the Monday of the current week
      const currentMonday = new Date(today);
      const currentDay = today.getDay();
      const mondayOffset = currentDay === 0 ? -6 : 1 - currentDay;
      currentMonday.setDate(today.getDate() + mondayOffset);
      const currentMondayStr = currentMonday.toISOString().split('T')[0];
      isCurrentWeek = weekStartStr === currentMondayStr;
    }

    // Generate only Monday-Friday days - ensure we always start from Monday using UTC
    const days = Array.from({ length: 5 }, (_, dayIndex) => {
      // Use UTC components to avoid timezone issues
      const day = new Date(Date.UTC(weekStart.getUTCFullYear(), weekStart.getUTCMonth(), weekStart.getUTCDate() + dayIndex));
      return day;
    });

    return {
      start: weekStart,
      end: weekEnd,
      isCurrentWeek: isCurrentWeek,
      days: days
    };
  });

  // Update parent with date range whenever weeks change
  useEffect(() => {
    if (onDateRangeChange && weeks.length > 0) {
      const dateRange = `${weeks[0]?.start.toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric'
      })} - ${weeks[weeks.length - 1]?.end.toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
        year: 'numeric'
      })}`;
      onDateRangeChange(dateRange);
    }
  }, [weeks, onDateRangeChange]);

  // Use moderators from props, fallback to empty array
  const moderatorsList = moderators || [];

  // Navigation functions
  const goToPreviousWeek = () => {
    if (!isScrolling) {
      setCurrentWeekOffset(prev => prev - 1);
      setIsScrolling(true);
      setTimeout(() => setIsScrolling(false), 300);
    }
  };

  const goToNextWeek = () => {
    if (!isScrolling) {
      setCurrentWeekOffset(prev => prev + 1);
      setIsScrolling(true);
      setTimeout(() => setIsScrolling(false), 300);
    }
  };

  const goToCurrentWeek = () => {
    if (!isScrolling) {
      setCurrentWeekOffset(0);
      setIsScrolling(true);
      setTimeout(() => setIsScrolling(false), 300);
    }
  };

  return (
    <div className="space-y-4">

      {/* Timeline Container */}
      <div ref={timelineRef} className="overflow-hidden pb-4 select-none px-0.5 sm:px-1 md:px-2">
        <div className="w-full min-w-0 max-w-full">

          {/* Timeline Container with Continuous Lines */}
          <div className="relative">
            {/* Month Labels and Navigation */}
            <div className="flex mb-2">
              {/* Moderator Name Column Header (empty space) */}
              <div className="w-24 sm:w-32 md:w-40 flex-shrink-0 pl-4"></div>
              
              {/* Left Arrow */}
              <button onClick={goToPreviousWeek} disabled={isScrolling} className="p-2 text-gray-500 hover:text-gray-700 disabled:opacity-50">
                <ChevronLeftIcon className="w-5 h-5" />
              </button>
              
              {/* Month Labels */}
              <div className="flex-1 flex items-center justify-center relative">
                {(() => {
                  const months = [];
                  const dividers = [];
                  
                  for (let i = 0; i < visibleWeeks; i++) {
                    const weekStart = getWeekStart(currentWeekOffset + i);
                    const month = weekStart.toLocaleDateString('en-US', { month: 'long' });
                    
                    // Check if this is the first week of a new month
                    if (i === 0 || weekStart.getUTCMonth() !== getWeekStart(currentWeekOffset + i - 1).getUTCMonth()) {
                      months.push({
                        name: month,
                        startWeek: i,
                        endWeek: i
                      });
                      
                      // Add divider before this month (except for the first month)
                      if (i > 0) {
                        dividers.push(i);
                      }
                    } else {
                      // Extend the current month
                      if (months.length > 0) {
                        months[months.length - 1].endWeek = i;
                      }
                    }
                  }
                  
                  return (
                    <>
                      {months.map((month, index) => (
                        <div key={index} className="flex items-center">
                          <span className="text-sm font-medium text-gray-700">{month.name}</span>
                          {index < months.length - 1 && (
                            <div className="w-px h-4 bg-gray-300 mx-2"></div>
                          )}
                        </div>
                      ))}
                    </>
                  );
                })()}
              </div>
              
              {/* Right Arrow */}
              <button onClick={goToNextWeek} disabled={isScrolling} className="p-2 text-gray-500 hover:text-gray-700 disabled:opacity-50">
                <ChevronRightIcon className="w-5 h-5" />
              </button>
            </div>
            
            {/* Vertical divider lines - cover entire timeline */}
            {/* Day Headers */}
            <div className="flex mb-0">
              {/* Moderator Name Column Header (empty space) */}
              <div className="w-24 sm:w-32 md:w-40 flex-shrink-0 pl-4"></div>

              {/* Day Headers */}
              <div className="flex-1 flex relative">
                {weeks.map((week, weekIndex) => (
                  <div key={weekIndex} className={`flex-1 min-w-0 relative ${week.isCurrentWeek ? 'bg-orange-50' : ''}`}>
                    <div className={`flex relative z-20 ${week.isCurrentWeek ? '' : ''}`}>
                      {week.days.map((day, dayIndex) => {
                        const isTodayDate = isToday(day);
                        
                        return (
                          <div
                            key={`${weekIndex}-${dayIndex}`}
                            className={`flex-1 min-w-[20px] sm:min-w-[30px] md:min-w-[40px] text-center py-2 text-xs text-gray-600 ${
                              dayIndex < 4 ? 'border-r border-gray-200' : ''
                            } ${isTodayDate ? 'bg-orange-100' : (week.isCurrentWeek ? 'bg-orange-50' : 'bg-gray-50')}`}
                          >
                            <div className={`font-medium ${
                              isTodayDate ? 'font-bold' : ''
                            }`} style={{
                              color: isTodayDate ? '#DC2626' : undefined
                            }}>
                              {(day.getUTCMonth() + 1)}/{day.getUTCDate()}
                            </div>
                            <div className={`text-gray-500 ${
                              isTodayDate ? 'font-bold' : ''
                            }`} style={{
                              color: isTodayDate ? '#DC2626' : undefined
                            }}>
                              {['Mon', 'Tue', 'Wed', 'Thu', 'Fri'][dayIndex]}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ))}
                {/* Week divider lines in headers - positioned between weeks */}
                {weeks.map((week, weekIndex) => {
                  if (weekIndex < weeks.length - 1) {
                    const weekWidth = 100 / weeks.length;
                    const leftPosition = (weekIndex + 1) * weekWidth;
                    return (
                      <div
                        key={`header-week-divider-${weekIndex}`}
                        className="absolute top-0 bottom-0 w-0.5 bg-gray-300 z-30"
                        style={{ left: `${leftPosition}%` }}
                      ></div>
                    );
                  }
                  return null;
                })}
              </div>
            </div>

            {/* Moderator Rows */}
            <div className="space-y-0">
              {moderatorsList.length === 0 ? (
                <div className="flex items-center justify-center py-8 text-gray-500">
                  <div className="text-center">
                    <div className="text-sm">No moderators found</div>
                    <div className="text-xs mt-1">Add moderators in the Vendor Library to see their schedules</div>
                  </div>
                </div>
              ) : (
                moderatorsList.map((moderator: any) => (
                    <div key={moderator.id} className="flex items-stretch border-b border-gray-100 hover:bg-gray-50">
                    {/* Moderator Name Column */}
                    <div className="w-24 sm:w-32 md:w-40 flex-shrink-0 py-3 flex flex-col justify-center">
                      <div className="text-sm font-medium text-gray-900 truncate">
                        {moderator.name}
                      </div>
                      <div className="text-xs text-gray-500 truncate">
                        {moderator.company || moderator.email || 'No company'}
                      </div>
                    </div>

                    {/* Timeline Area */}
                    <div className="flex-1 flex items-center relative py-2">
                      {/* Background grid for reference */}
                      <div className="absolute inset-0 flex">
                        {weeks.map((week, weekIndex) => (
                          <div key={weekIndex} className={`flex relative ${week.isCurrentWeek ? 'bg-orange-50' : ''}`} style={{ width: `${100 / weeks.length}%` }}>
                            {week.days.map((day, dayIndex) => {
                              const isTodayDate = isToday(day);
                              
                              // Check if this day is covered by an unavailable period
                              const dayStr = day.getUTCFullYear() + '-' +
                                            String(day.getUTCMonth() + 1).padStart(2, '0') + '-' +
                                            String(day.getUTCDate()).padStart(2, '0');

                              const isUnavailable = (moderator.customSchedule || []).some((schedule: any) =>
                                schedule.type === 'pending' &&
                                dayStr >= schedule.startDate &&
                                dayStr <= schedule.endDate
                              );

                              return (
                                <div
                                  key={`${weekIndex}-${dayIndex}`}
                                  className={`h-full relative ${
                                    dayIndex < 4 ? 'border-r border-gray-200' : ''
                                  } ${isTodayDate ? 'bg-orange-100' : (isUnavailable ? 'bg-gray-300' : '')}`}
                                  style={{ width: `${100 / 5}%` }}
                                ></div>
                              );
                            })}
                          </div>
                        ))}
                        {/* Week divider lines - positioned between weeks */}
                        {weeks.map((week, weekIndex) => {
                          if (weekIndex < weeks.length - 1) {
                            const weekWidth = 100 / weeks.length;
                            const leftPosition = (weekIndex + 1) * weekWidth;
                            return (
                              <div
                                key={`week-divider-${weekIndex}`}
                                className="absolute top-0 bottom-0 w-0.5 bg-gray-300 z-10"
                                style={{ left: `${leftPosition}%` }}
                              ></div>
                            );
                          }
                          return null;
                        })}
                      </div>
                      

                      
                      {/* Moderator assignment pills */}
                      {(() => {
                        // Get projects assigned to this moderator
                        const moderatorProjects = projects.filter(project =>
                          project.moderator === moderator.id || project.moderator === moderator.name
                        );

                        // Get custom schedule entries for this moderator
                        const customSchedules = moderator.customSchedule || [];

                        // Combine project bookings and custom schedules
                        const allBookings = [
                          // Project-based bookings
                          ...moderatorProjects.map(project => ({
                            type: 'project',
                            project,
                            id: project.id,
                            name: project.name,
                            startDate: project.segments?.find(s => s.phase === 'Fielding')?.startDate,
                            endDate: project.segments?.find(s => s.phase === 'Fielding')?.endDate
                          })),
                          // Custom schedule entries
                          ...customSchedules.map((schedule: any) => ({
                            type: 'custom',
                            id: schedule.id,
                            name: schedule.projectName,
                            startDate: schedule.startDate,
                            endDate: schedule.endDate,
                            customType: schedule.type // 'booked' or 'pending'
                          }))
                        ];

                        return allBookings
                          .filter(booking => !(booking.type === 'custom' && booking.customType === 'pending')) // Skip unavailable dates (rendered as background)
                          .map((booking, bookingIndex) => {
                          // Handle different booking types
                          if (!booking.startDate || !booking.endDate) return null;

                          // Calculate position and width based on timeline dates
                          const startDate = new Date(booking.startDate + 'T00:00:00Z');
                          const endDate = new Date(booking.endDate + 'T00:00:00Z');
                          
                          // Use the actual visible timeline start (first Monday of visible weeks)
                          const timelineStart = weeks[0]?.start;
                          if (!timelineStart) return null;
                          
                          // Calculate days from timeline start to project start/end
                          // Use UTC date difference to avoid timezone issues
                          const timelineStartUTC = new Date(Date.UTC(timelineStart.getUTCFullYear(), timelineStart.getUTCMonth(), timelineStart.getUTCDate()));
                          const startDateUTC = new Date(Date.UTC(startDate.getUTCFullYear(), startDate.getUTCMonth(), startDate.getUTCDate()));
                          const endDateUTC = new Date(Date.UTC(endDate.getUTCFullYear(), endDate.getUTCMonth(), endDate.getUTCDate()));

                          // Use the same logic as ProjectTimeline - count actual days that fall within the fielding phase
                          const allDays = weeks.flatMap(week => week.days);
                          let visibleFieldingDays = 0;
                          let firstFieldingDayIndex = -1;
                          let lastFieldingDayIndex = -1;

                          allDays.forEach((day, dayIndex) => {
                            // Use same date string logic as ProjectTimeline
                            const dateStr = day.getUTCFullYear() + '-' +
                                           String(day.getUTCMonth() + 1).padStart(2, '0') + '-' +
                                           String(day.getUTCDate()).padStart(2, '0');

                            if (dateStr >= booking.startDate && dateStr <= booking.endDate) {
                              visibleFieldingDays++;
                              if (firstFieldingDayIndex === -1) firstFieldingDayIndex = dayIndex;
                              lastFieldingDayIndex = dayIndex;
                            }
                          });

                          // Only show if there are visible fielding days
                          if (visibleFieldingDays === 0 || firstFieldingDayIndex === -1) return null;

                          // Calculate total visible days (5 weeks * 5 days = 25 days)
                          const totalDays = 25;

                          // Calculate position and width as percentages
                          const leftPercent = firstFieldingDayIndex * (100 / totalDays);
                          const widthPercent = visibleFieldingDays * (100 / totalDays);

                          // Determine styling based on booking type
                          const isPending = booking.type === 'custom' && booking.customType === 'pending';
                          const isHold = booking.type === 'custom' && booking.customType === 'booked';

                          let pillStyle, displayName;

                          if (isPending) {
                            pillStyle = {
                              backgroundColor: 'white',
                              border: '2px dotted #6B7280',
                              color: '#374151'
                            };
                            displayName = 'UNAVAILABLE';
                          } else if (isHold) {
                            pillStyle = {
                              backgroundColor: 'white',
                              border: '2px dotted #6B7280',
                              color: '#374151'
                            };
                            displayName = `PENDING HOLD (${booking.name})`;
                          } else {
                            pillStyle = {
                              backgroundColor: PHASE_COLORS.Fielding, // Purple color for actual projects
                              opacity: 0.6,
                              color: 'white'
                            };
                            displayName = booking.name;
                          }

                          return (
                            <div
                              key={booking.id}
                              className="absolute flex items-center justify-center rounded-full"
                              style={{
                                ...pillStyle,
                                top: '50%',
                                transform: 'translateY(-50%)',
                                height: '24px',
                                left: `calc(${leftPercent}% + 2px)`,
                                width: `calc(${widthPercent}% - 4px)`,
                                zIndex: 50
                              }}
                              title={`${moderator.name} - ${displayName} - ${booking.startDate} to ${booking.endDate}`}
                            >
                              <span className={`text-xs font-medium truncate px-0.5 sm:px-1 md:px-2 ${(isPending || isHold) ? 'text-gray-700' : 'text-white'}`}>
                                {isHold ? (
                                  <>PENDING HOLD (<em>{booking.name}</em>)</>
                                ) : (
                                  displayName
                                )}
                              </span>
                            </div>
                          );
                        });
                      })()}
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function ContentAnalysis() {
  const [projectId, setProjectId] = useState('demo');
  const [data, setData] = useState<any>(null);
  const [sort, setSort] = useState({ sheet: 'Category Ranking', col: 'Rank', dir: 'asc' });
  const [busy, setBusy] = useState(false);

  // Mock data for demo purposes
  const mockData = {
    "Category Ranking": [
      { "Category": "Treatment A", "Rank": 1, "Mentions": 45, "Net Positive": 78, "Top Box": 65 },
      { "Category": "Treatment B", "Rank": 2, "Mentions": 38, "Net Positive": 72, "Top Box": 58 },
      { "Category": "Treatment C", "Rank": 3, "Mentions": 42, "Net Positive": 69, "Top Box": 62 },
      { "Category": "Treatment D", "Rank": 4, "Mentions": 35, "Net Positive": 64, "Top Box": 55 },
    ],
    "Background & SMA Management": [
      { "Topic": "Disease Understanding", "Rank": 1, "Mentions": 52, "Net Positive": 82, "Top Box": 70 },
      { "Topic": "Treatment History", "Rank": 2, "Mentions": 48, "Net Positive": 75, "Top Box": 63 },
      { "Topic": "Current Management", "Rank": 3, "Mentions": 44, "Net Positive": 71, "Top Box": 59 },
    ]
  };

  const handleLoadDemo = async () => {
    setBusy(true);
    try {
      // Try to fetch from backend first
      const response = await fetch(`${API_BASE_URL}/api/ca/${projectId}`, {
        headers: { 'Authorization': `Bearer ${localStorage.getItem('cognitive_dash_token')}` }
      });
      if (response.ok) {
        const data = await response.json();
        setData(data);
      } else {
        // Fallback to mock data
        setData(mockData);
      }
    } catch (error) {
      setData(mockData);
    }
    setBusy(false);
  };

  const toNum = (x: any) => {
    const n = Number(x);
    return Number.isFinite(n) ? n : -Infinity;
  };

  const handleFileUpload = (type: 'ca' | 'dg') => async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setBusy(true);
    try {
      const formData = new FormData();

      if (type === 'dg') {
        // Discussion Guide upload for AI generation
        formData.append('dg', file);
        const response = await fetch(`${API_BASE_URL}/api/ca/generate`, {
          method: 'POST',
          body: formData,
          headers: { 'Authorization': `Bearer ${localStorage.getItem('cognitive_dash_token')}` }
        });

        if (response.ok) {
          const result = await response.json();
          alert(`AI generation successful! Download: ${result.downloadUrl}`);
          if (result.downloadUrl) {
            window.open(`${API_BASE_URL}${result.downloadUrl}`, '_blank');
          }
        } else {
          const error = await response.json();
          alert(`AI generation failed: ${error.error}`);
        }
      } else {
        // Content Analysis Excel upload
        formData.append('file', file);
        formData.append('projectId', projectId);
        const response = await fetch(`${API_BASE_URL}/api/ca/upload`, {
          method: 'POST',
          body: formData,
          headers: { 'Authorization': `Bearer ${localStorage.getItem('cognitive_dash_token')}` }
        });

        if (response.ok) {
          const result = await response.json();
          alert('File uploaded successfully!');
          // Reload the data
          await handleLoadDemo();
        } else {
          const error = await response.json();
          alert(`Upload failed: ${error.error}`);
        }
      }
    } catch (error) {
      console.error('Upload error:', error);
      alert('Upload failed - make sure the backend server is running on port 3004');
    }
    setBusy(false);

    // Reset file input
    e.target.value = '';
  };

  const rankSorted = useMemo(() => {
    if (!data) return null;
    const sheet = data[sort.sheet] || [];
    const rows = [...sheet];
    rows.sort((a: any, b: any) => {
      const av = toNum(a[sort.col]);
      const bv = toNum(b[sort.col]);
      return sort.dir === 'asc' ? av - bv : bv - av;
    });
    return rows;
  }, [data, sort]);

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Modern Hero Section */}
      <section className="bg-white">
        <div className="max-w-7xl mx-auto px-6 py-16">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-12 items-center">
            {/* Left Side - Title, Subtitle, and View Button */}
            <div className="space-y-8">
              <div className="space-y-4">
                <h1 className="text-5xl font-bold text-gray-900 leading-tight">
                  Content Analysis
                  <span className="text-green-600"> Dashboard</span>
                </h1>
                <p className="text-xl text-gray-600 leading-relaxed">
                  Transform your research data into actionable insights with our powerful content analysis tools. Upload documents and generate comprehensive reports in minutes.
                </p>
              </div>
              
              <div className="flex flex-col sm:flex-row gap-4">
                <button
                  className="inline-flex items-center justify-center px-8 py-4 bg-green-600 text-white font-semibold rounded-xl hover:bg-green-700 transition-colors shadow-lg hover:shadow-xl"
                  onClick={handleLoadDemo}
                  disabled={busy}
                >
                  <ChartBarIcon className="h-5 w-5 mr-2" />
                  {busy ? 'Loading...' : 'View Analysis'}
                </button>
                <button
                  onClick={async () => {
                    try {
                      const resp = await fetch(`${API_BASE_URL}/api/ca/template`, {
                        headers: { 'Authorization': `Bearer ${localStorage.getItem('cognitive_dash_token')}` }
                      });
                      if (!resp.ok) throw new Error('Failed to download template');
                      const blob = await resp.blob();
                      const url = window.URL.createObjectURL(blob);
                      const a = document.createElement('a');
                      a.href = url;
                      a.download = 'CA_template_HCP.xlsx';
                      document.body.appendChild(a);
                      a.click();
                      a.remove();
                      window.URL.revokeObjectURL(url);
                    } catch (e) {
                      alert('Failed to download template');
                    }
                  }}
                  className="inline-flex items-center justify-center px-8 py-4 border-2 border-gray-300 text-gray-700 font-semibold rounded-xl hover:border-gray-400 hover:bg-gray-50 transition-colors"
                >
                  <DocumentArrowUpIcon className="h-5 w-5 mr-2" />
                  Download Template
                </button>
              </div>
            </div>

            {/* Right Side - Upload Cards */}
            <div className="space-y-6">
              {/* Word Document Upload Card */}
              <div className="bg-white rounded-2xl border-2 border-gray-100 p-8 hover:border-green-200 hover:shadow-lg transition-all duration-300">
                <div className="flex items-start space-x-4">
                  <div className="flex-shrink-0">
                    <div className="w-12 h-12 bg-blue-100 rounded-xl flex items-center justify-center">
                      <DocumentTextIcon className="h-6 w-6 text-blue-600" />
                    </div>
                  </div>
                  <div className="flex-1 min-w-0">
                    <h3 className="text-lg font-semibold text-gray-900 mb-2">Discussion Guide</h3>
                    <p className="text-gray-600 text-sm mb-4">
                      Upload a Word document (.docx) to generate a comprehensive content analysis automatically using AI.
                    </p>
                    <label className="inline-flex items-center px-4 py-2 bg-green-600 text-white text-sm font-medium rounded-lg hover:bg-green-700 transition-colors cursor-pointer">
                      <CloudArrowUpIcon className="h-4 w-4 mr-2" />
                      Upload Word Document
                      <input type="file" accept=".docx" className="hidden" onChange={handleFileUpload('dg')} />
                    </label>
                  </div>
                </div>
              </div>

              {/* Excel Document Upload Card */}
              <div className="bg-white rounded-2xl border-2 border-gray-100 p-8 hover:border-green-200 hover:shadow-lg transition-all duration-300">
                <div className="flex items-start space-x-4">
                  <div className="flex-shrink-0">
                    <div className="w-12 h-12 bg-green-100 rounded-xl flex items-center justify-center">
                      <DocumentChartBarIcon className="h-6 w-6 text-green-600" />
                    </div>
                  </div>
                  <div className="flex-1 min-w-0">
                    <h3 className="text-lg font-semibold text-gray-900 mb-2">Content Analysis</h3>
                    <p className="text-gray-600 text-sm mb-4">
                      Upload an Excel file (.xlsx) with your content analysis data to view and analyze results.
                    </p>
                    <label className="inline-flex items-center px-4 py-2 bg-green-600 text-white text-sm font-medium rounded-lg hover:bg-green-700 transition-colors cursor-pointer">
                      <CloudArrowUpIcon className="h-4 w-4 mr-2" />
                      Upload Excel File
                      <input type="file" accept=".xlsx" className="hidden" onChange={handleFileUpload('ca')} />
                    </label>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Control Cards - Only show when data is loaded */}
      {data && (
        <section className="max-w-7xl mx-auto px-6 py-8">
          <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
            <div className="bg-white rounded-2xl border border-gray-200 p-6 shadow-sm">
              <h3 className="text-lg font-semibold text-gray-900 mb-4">Project Settings</h3>
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">Project ID</label>
                  <input
                    className="w-full border border-gray-300 rounded-xl px-4 py-3 outline-none focus:ring-2 focus:ring-green-500 focus:border-green-500 transition-colors"
                    value={projectId}
                    onChange={e => setProjectId(e.target.value)}
                    placeholder="Enter project ID"
                  />
                </div>
                <button
                  className="w-full px-4 py-3 bg-green-600 text-white font-medium rounded-xl hover:bg-green-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                  onClick={handleLoadDemo}
                  disabled={busy}
                >
                  {busy ? 'Loading...' : 'Load Demo Data'}
                </button>
              </div>
            </div>

            <div className="bg-white rounded-2xl border border-gray-200 p-6 shadow-sm">
              <h3 className="text-lg font-semibold text-gray-900 mb-4">Analysis Controls</h3>
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">Sheet</label>
                  <select
                    className="w-full border border-gray-300 rounded-xl px-4 py-3 outline-none focus:ring-2 focus:ring-green-500 focus:border-green-500 transition-colors"
                    value={sort.sheet}
                    onChange={e => setSort(s => ({...s, sheet: e.target.value}))}
                  >
                    {["Category Ranking", "Category C", "Category S", "Background & SMA Management"].map(s =>
                      <option key={s} value={s}>{s}</option>
                    )}
                  </select>
                </div>
                <div className="flex gap-3">
                  <div className="flex-1">
                    <label className="block text-sm font-medium text-gray-700 mb-2">Sort By</label>
                    <select
                      className="w-full border border-gray-300 rounded-xl px-4 py-3 outline-none focus:ring-2 focus:ring-green-500 focus:border-green-500 transition-colors"
                      value={sort.col}
                      onChange={e => setSort(s => ({...s, col: e.target.value}))}
                    >
                      {["Rank", "Mentions", "Net Positive", "Top Box"].map(c =>
                        <option key={c} value={c}>{c}</option>
                      )}
                    </select>
                  </div>
                  <div className="flex items-end">
                    <button
                      className="px-4 py-3 border border-gray-300 rounded-xl hover:bg-gray-50 transition-colors flex items-center gap-2"
                      onClick={() => setSort(s => ({...s, dir: s.dir === 'asc' ? 'desc' : 'asc'}))}
                    >
                      <ArrowsUpDownIcon className="h-4 w-4" />
                      <span className="text-sm font-medium">{sort.dir.toUpperCase()}</span>
                    </button>
                  </div>
                </div>
              </div>
            </div>

            <div className="bg-white rounded-2xl border border-gray-200 p-6 shadow-sm">
              <h3 className="text-lg font-semibold text-gray-900 mb-4">Status</h3>
              <div className="space-y-3">
                <div className="flex items-center gap-3">
                  <div className={`h-3 w-3 rounded-full ${busy ? '0' : 'bg-green-500'}`} />
                  <span className="text-sm font-medium text-gray-700">{busy ? "Processing..." : "Ready"}</span>
                </div>
                <div className="text-sm text-gray-600">
                  Loaded sheets: <span className="font-semibold text-gray-900">{data ? Object.keys(data).length : 0}</span>
                </div>
                {data && (
                  <div className="text-sm text-gray-600">
                    Current: <span className="font-semibold text-gray-900">{sort.sheet}</span>
                  </div>
                )}
              </div>
            </div>
          </div>
        </section>
      )}

      {/* Data Table */}
      {data && (
        <section className="max-w-7xl mx-auto px-6 pb-16">
          <div className="bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden">
            <div className="px-6 py-4 border-b border-gray-200 bg-gray-50">
              <div className="flex items-center justify-between">
                <h3 className="text-lg font-semibold text-gray-900">
                  {sort.sheet} (sorted by {sort.col}, {sort.dir})
                </h3>
                <div className="text-sm text-gray-500">
                  {rankSorted?.length || 0} rows
                </div>
              </div>
            </div>
            <div className="overflow-auto">
              <table className="w-full">
                <thead className="bg-gray-50">
                  <tr>
                    {rankSorted?.[0] && Object.keys(rankSorted[0]).map(header => (
                      <th key={header} className="px-6 py-4 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                        {header}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-200">
                  {rankSorted?.map((row: any, i: number) => (
                    <tr key={i} className="hover:bg-gray-50 transition-colors">
                      {Object.keys(row).map(key => (
                        <td key={key} className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                          {key === 'Rank' && typeof row[key] === 'number' ? (
                            <span className="inline-flex items-center justify-center w-8 h-8 rounded-full text-sm font-semibold text-white bg-green-600">
                              {row[key]}
                            </span>
                          ) : (
                            String(row[key] ?? "")
                          )}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </section>
      )}

      {/* Empty State */}
      {!data && !busy && (
        <section className="max-w-7xl mx-auto px-6 py-16">
          <div className="bg-white rounded-2xl border border-gray-200 shadow-sm">
            <div className="text-center py-16">
              <div className="w-20 h-20 bg-gray-100 rounded-full flex items-center justify-center mx-auto mb-6">
                <DocumentChartBarIcon className="h-10 w-10 text-gray-400" />
              </div>
              <h3 className="text-2xl font-semibold text-gray-900 mb-3">No Content Analysis Data</h3>
              <p className="text-gray-600 mb-8 max-w-md mx-auto">
                Get started by uploading a document or loading demo data to see your content analysis in action.
              </p>
              <button
                className="inline-flex items-center px-6 py-3 bg-green-600 text-white font-semibold rounded-xl hover:bg-green-700 transition-colors shadow-lg hover:shadow-xl"
                onClick={handleLoadDemo}
              >
                <ChartBarIcon className="h-5 w-5 mr-2" />
                Load Demo Data
              </button>
            </div>
          </div>
        </section>
      )}
    </div>
  );
}

function Placeholder({ name }: { name: string }) {
  const isComingSoon = name === "QNR" || name === "Data QA";
  
  return (
    <Card>
      <h3 className="font-semibold mb-2">{name}</h3>
      {isComingSoon ? (
        <div className="text-center py-12">
          <div className="text-4xl font-bold text-gray-400 mb-4">COMING SOON</div>
          <div className="text-sm text-gray-600">This feature is currently in development.</div>
        </div>
      ) : (
      <div className="text-sm text-gray-600">This section is a visual placeholder in the preview build.</div>
      )}
    </Card>
  );
}

function Card({ children, className = "", onClick }: { children: React.ReactNode; className?: string; onClick?: () => void }) {
  return <div className={`rounded-3xl border bg-white p-4 shadow-sm ${className}`} onClick={onClick}>{children}</div>;
}

function TaskRow({ name, detail }: { name: string; detail: string }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <div className="flex items-center gap-3">
        <div className="h-9 w-9 rounded-2xl grid place-items-center" style={{ background: `${BRAND.orange}22`, color: BRAND.orange }}>
          <ClipboardDocumentListIcon className="h-5 w-5" />
        </div>
        <div>
          <div className="font-medium">{name}</div>
          <div className="text-xs text-gray-500">{detail}</div>
        </div>
      </div>
      <button className="text-sm rounded-xl px-3 py-1 border">Open</button>
    </div>
  );
}

function QuickAction({ icon: Icon, label }: { icon: React.ComponentType<React.SVGProps<SVGSVGElement>>; label: string }) {
  return (
    <button className="w-full flex items-center gap-3 rounded-2xl border px-4 py-3 hover:shadow-sm transition-shadow">
      <Icon className="h-5 w-5 flex-shrink-0" style={{ color: BRAND.orange }} />
      <span className="text-sm font-medium">{label}</span>
    </button>
  );
}

function KpiBox({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-2xl border p-3 bg-white">
      <div className="text-xs text-gray-500">{label}</div>
      <div className="text-2xl font-semibold" style={{ color: BRAND.gray }}>{value}</div>
    </div>
  );
}

function CalendarMini() {
  const days = ["S", "M", "T", "W", "T", "F", "S"];
  const d = Array.from({ length: 30 }, (_, i) => i + 1);
  return (
    <div className="rounded-xl border bg-white overflow-hidden">
      <div className="flex items-center justify-between px-3 py-2 text-sm border-b">
        <div className="font-medium">This Month</div>
        <div className="flex gap-2 text-gray-500">
          <span>◀</span>
          <span>▶</span>
        </div>
      </div>
      <div className="grid grid-cols-7 text-center text-xs text-gray-500 px-0.5 sm:px-1 md:px-2 py-2">
        {days.map((d) => (
          <div key={d} className="py-1">
            {d}
          </div>
        ))}
      </div>
      <div className="grid grid-cols-7 gap-1 px-0.5 sm:px-1 md:px-2 pb-3">
        {d.map((n) => (
          <div key={n} className={`py-2 rounded-lg ${n === 16 ? "bg-gray-900 text-white" : "bg-gray-50"}`}>
            {n}
          </div>
        ))}
      </div>
    </div>
  );
}

const PHASE_TOOLS: Record<Phase, string[]> = {
  "Kickoff": ["Project Setup", "Timeline", "Budget", "Stakeholders"],
  "Pre-Field": ["QNR Builder", "Survey Logic", "Pilot Test", "Programming", "QA Review", "Site Setup", "Training", "Launch Prep"],
  "Fielding": ["Field Monitor", "Data Quality", "Response Tracking", "Support"],
  "Post-Field Analysis": ["Analytics", "Statistical Test", "Charts", "Insights"],
  "Reporting": ["Report Builder", "Presentation", "Delivery", "Archive"],
  "Awaiting KO": [],
  "Complete": []
};

// Map deadline keywords to phases for coloring
const getDeadlinePhase = (deadlineLabel: string): Phase => {
  const label = deadlineLabel.toLowerCase();

  if (label.includes('kickoff') || label.includes('meeting') || label.includes('budget') || label.includes('protocol')) {
    return 'Kickoff';
  }
  if (label.includes('qnr') || label.includes('development') || label.includes('pilot') || label.includes('programming')) {
    return 'Pre-Field';
  }
  if (label.includes('approval') || label.includes('training') || label.includes('site') || label.includes('launch prep') || label.includes('final') && !label.includes('report')) {
    return 'Pre-Field';
  }
  if (label.includes('field') || label.includes('monitoring') || label.includes('response') || label.includes('recruitment') || label.includes('mid-field') || label.includes('checkpoint')) {
    return 'Fielding';
  }
  if (label.includes('analysis') || label.includes('statistical') || label.includes('chart') || label.includes('insight')) {
    return 'Post-Field Analysis';
  }
  if (label.includes('report') || label.includes('presentation') || label.includes('delivery') || label.includes('complete')) {
    return 'Reporting';
  }

  // Default to current project phase if no match
  return 'Kickoff';
};

function ProjectCard({ project, onView, savedContentAnalyses = [], setRoute }: { project: Project; onView?: (project: Project) => void; savedContentAnalyses?: any[]; setRoute?: (route: string) => void }) {
  const phaseColor = PHASE_COLORS[project.phase];

  // Helper function to generate mini calendar (weekdays only)
  const generateMiniCalendar = () => {
    const today = new Date();
    const year = today.getFullYear();
    const month = today.getMonth();
    const daysInMonth = new Date(year, month + 1, 0).getDate();

    const getPhaseForDay = (day: number) => {
      if (!project.segments) {
        // Don't show yellow status phases in calendars
        if (project.phase === 'Awaiting KO' || project.phase === 'Complete') {
          return null;
        }
        return project.phase;
      }
      const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;

      for (const segment of project.segments) {
        if (dateStr >= segment.startDate && dateStr <= segment.endDate) {
          return segment.phase;
        }
      }
      return null;
    };

    // Get weekdays for the month
    const weekdays = [];
    for (let day = 1; day <= daysInMonth; day++) {
      const date = new Date(year, month, day);
      const dayOfWeek = date.getDay();
      if (dayOfWeek >= 1 && dayOfWeek <= 5) {
        const isToday = day === today.getDate() && month === today.getMonth() && year === today.getFullYear();
        
        // Check if this day is in the current week
        const isCurrentWeek = (() => {
          const today = new Date();
          const currentWeekStart = new Date(today);
          const dayOfWeek = today.getDay();
          const diff = today.getDate() - dayOfWeek + (dayOfWeek === 0 ? -6 : 1); // Adjust when day is Sunday
          currentWeekStart.setDate(diff);
          const currentWeekEnd = new Date(currentWeekStart);
          currentWeekEnd.setDate(currentWeekStart.getDate() + 6);
          
          return date >= currentWeekStart && date <= currentWeekEnd;
        })();
        
        weekdays.push({
          day,
          phase: getPhaseForDay(day),
          isToday,
          isCurrentWeek
        });
      }
    }

    // Group consecutive days by phase to create pills
    const phaseRanges = [];
    let currentRange = null;

    weekdays.forEach((dayInfo, index) => {
      if (dayInfo.phase && dayInfo.phase !== currentRange?.phase) {
        // Start new range
        currentRange = {
          phase: dayInfo.phase,
          startIndex: index,
          endIndex: index,
          color: PHASE_COLORS[dayInfo.phase]
        };
        phaseRanges.push(currentRange);
      } else if (dayInfo.phase && dayInfo.phase === currentRange?.phase) {
        // Extend current range
        currentRange.endIndex = index;
      } else if (!dayInfo.phase) {
        // End current range
        currentRange = null;
      }
    });

    return { weekdays, phaseRanges };
  };

  return (
    <div
      className="bg-white rounded-lg shadow-sm overflow-hidden transition-all duration-300 hover:shadow-lg cursor-pointer border border-gray-200 relative w-full"
      onClick={() => onView?.(project)}
    >
      {/* Phase-colored header */}
      <div
        className="h-3"
        style={{ backgroundColor: phaseColor }}
      ></div>

      {/* Header section with project info and phase pill */}
      <div className="p-3 pb-2 relative">
        <div className="flex justify-between items-start">
          <div className="flex-1 pr-3">
            <div className="text-base font-bold mb-0.5">{project.name}</div>
            <div className="text-xs text-gray-600 italic">{project.client}</div>
          </div>
          <span
            className="inline-flex items-center justify-center w-20 py-0.5 rounded-full text-xs font-medium text-white flex-shrink-0 opacity-60"
            style={{ backgroundColor: phaseColor }}
          >
            {project.phase === 'Post-Field Analysis' ? 'Analysis' : project.phase}
          </span>
        </div>
      </div>

      {/* Body content - Calendar and Key Dates */}
      <div className="px-3 pb-2 pt-1">
        <div className="flex flex-col lg:flex-row gap-2">
          {/* Left side - Mini Calendar */}
          <div className="flex-1 min-w-0 flex-shrink-0">
            {/* Mini Calendar */}
            <div className="border border-gray-200 p-2 rounded-lg w-full max-w-xs shadow-sm h-36">
              {/* Month header */}
              <div className="text-center text-xs font-medium text-gray-700 mb-1">
                {new Date().toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}
              </div>

              {/* Weekday labels */}
              <div className="grid grid-cols-5 gap-0.5 justify-items-center mb-1">
                <div className="text-xs font-medium text-gray-600">M</div>
                <div className="text-xs font-medium text-gray-600">T</div>
                <div className="text-xs font-medium text-gray-600">W</div>
                <div className="text-xs font-medium text-gray-600">T</div>
                <div className="text-xs font-medium text-gray-600">F</div>
              </div>

              {/* Calendar days */}
              <div className="relative">
                {(() => {
                  const { weekdays, phaseRanges } = generateMiniCalendar();

                  return (
                    <div className="grid grid-cols-5 gap-0.5 justify-items-center">
                      {weekdays.map((dayInfo, index) => {
                        // Determine background color based on priority: today > current week > phase
                        let backgroundColor = 'transparent';
                        if (dayInfo.isToday) {
                          backgroundColor = '#fed7aa'; // Light orange for today
                        } else if (dayInfo.isCurrentWeek) {
                          backgroundColor = '#fff7ed'; // Very light orange for current week
                        } else if (dayInfo.phase) {
                          backgroundColor = `${PHASE_COLORS[dayInfo.phase]}30`;
                        }
                        
                        return (
                          <div
                            key={dayInfo.day}
                            className={`w-4 h-4 flex items-center justify-center text-xs font-medium ${dayInfo.isToday ? 'ring-1 ring-orange-400 font-bold' : ''}`}
                            style={{
                              color: dayInfo.isToday ? '#ea580c' : '#374151',
                              backgroundColor,
                              borderRadius: '3px'
                            }}
                          >
                            {dayInfo.day}
                          </div>
                        );
                      })}
                    </div>
                  );
                })()}
              </div>
            </div>
          </div>

          {/* Right side - Key Dates and Next Steps */}
          <div className="flex-1 min-w-0 flex flex-col h-36">
            {/* Key Dates */}
            <div className="mb-3">
              <h4 className="text-xs font-medium mb-1.5 text-gray-700">Key Dates</h4>
              <div className="space-y-1.5">
              {project.keyDeadlines.filter(deadline => {
                // Parse the deadline date (MM/DD/YY format)
                const [month, day, year] = deadline.date.split('/').map(Number);
                const fullYear = year < 50 ? 2000 + year : 1900 + year;
                const deadlineDate = new Date(fullYear, month - 1, day);

                // Get start of current week (Monday)
                const today = new Date();
                const currentDay = today.getDay();
                const mondayOffset = currentDay === 0 ? -6 : 1 - currentDay; // Handle Sunday as 0
                const startOfWeek = new Date(today);
                startOfWeek.setDate(today.getDate() + mondayOffset);
                startOfWeek.setHours(0, 0, 0, 0);

                // Check if deadline is from current week onwards
                return deadlineDate >= startOfWeek;
              }).slice(0, 3).map((deadline, idx) => {
                const deadlinePhase = getDeadlinePhase(deadline.label);
                const deadlineColor = PHASE_COLORS[deadlinePhase];

                // Simplify date format from MM/DD/YY to M/D/YY
                const simplifiedDate = deadline.date.replace(/^0(\d)\/0?(\d+)\//, '$1/$2/');

                return (
                  <div key={idx} className="text-xs flex items-start gap-1.5">
                    <div
                      className="px-1.5 py-0.5 rounded text-xs font-medium flex-shrink-0"
                      style={{
                        backgroundColor: `${deadlineColor}30`,
                        color: '#374151',
                        minWidth: '45px',
                        textAlign: 'center'
                      }}
                    >
                      {simplifiedDate}
                    </div>
                    <div className="text-gray-600 break-words text-xs">{deadline.label}</div>
                  </div>
                );
              })}
              </div>
            </div>

            {/* Next Steps */}
            <div className="flex-1 flex flex-col min-h-0">
              <h4 className="text-xs font-medium mb-1.5 text-gray-700 flex-shrink-0">Next Steps</h4>
              <div className="dynamic-task-list">
                {project.tasks
                  .filter(task => task.status !== 'completed')
                  .sort((a, b) => {
                    // Sort by status: pending first, then in-progress
                    const statusOrder: Record<Task['status'], number> = { 'pending': 0, 'in-progress': 1, 'completed': 2 };
                    return statusOrder[a.status] - statusOrder[b.status];
                  })
                  .slice(0, 5) // Show up to 5, CSS will hide extras based on screen size
                  .map((task, idx) => (
                  <div key={task.id} className="task-item text-xs text-gray-700 flex items-start gap-1.5">
                    <div className="w-2.5 h-2.5 border border-gray-300 rounded flex-shrink-0 mt-0.5"></div>
                    <span className="leading-tight text-xs overflow-hidden whitespace-nowrap text-ellipsis" style={{ 
                      maxWidth: 'calc(100% - 0.5rem)'
                    }}>
                      {task.description}
                    </span>
                  </div>
                ))}
              </div>
            </div>

          </div>
        </div>

      </div>
    </div>
  );
}

function LargeCard({
  title,
  badge,
  progress,
  gradientFrom = "#bbb",
  gradientTo = "#ddd",
}: {
  title: string;
  badge: string;
  progress?: number;
  gradientFrom?: string;
  gradientTo?: string;
}) {
  return (
    <div
      className="rounded-3xl p-5 text-white shadow-sm"
      style={{ background: `linear-gradient(135deg, ${gradientFrom}, ${gradientTo})` }}
    >
      <div className="text-xs bg-white/20 inline-block px-0.5 sm:px-1 md:px-2 py-1 rounded-full mb-2">{badge}</div>
      <div className="text-lg font-semibold leading-snug">{title}</div>
      <div className="mt-4 flex items-center gap-3">
        {typeof progress === "number" ? <ProgressRing value={progress} /> : <div className="h-12" />}
        {typeof progress === "number" && <div className="text-sm">{progress}% complete</div>}
      </div>
    </div>
  );
}

function ProgressRing({ value = 50, size = 56, stroke = 8 }: { value?: number; size?: number; stroke?: number }) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const offset = c - (value / 100) * c;
  return (
    <svg width={size} height={size}>
      <circle cx={size / 2} cy={size / 2} r={r} stroke="white" strokeOpacity="0.25" strokeWidth={stroke} fill="none" />
      <circle cx={size / 2} cy={size / 2} r={r} stroke="white" strokeWidth={stroke} fill="none" strokeDasharray={c} strokeDashoffset={offset} strokeLinecap="round" />
    </svg>
  );
}

function ProjectsTable() {
  const currentWeek = 0; // Assuming current week is day 0
  const activeProjects = PROJECTS.filter(p => {
    const currentPhaseSegment = p.segments?.find(s =>
      currentWeek >= s.startDay && currentWeek <= s.endDay
    );
    const isCurrentlyActive = !!currentPhaseSegment;
    const isWithinKickoffBuffer = p.segments?.[0] && currentWeek >= (p.segments[0].startDay - 7) && currentWeek <= (p.segments[0].endDay + 7);
    const lastSegment = p.segments?.[p.segments.length - 1];
    const isWithinCompletionBuffer = lastSegment && currentWeek >= (lastSegment.startDay - 7) && currentWeek <= (lastSegment.endDay + 7);

    return isCurrentlyActive || isWithinKickoffBuffer || isWithinCompletionBuffer;
  });

  const sortedProjects = [...activeProjects].sort((a, b) => a.startDay - b.startDay);

  return (
    <table className="w-full text-sm">
      <thead>
        <tr className="text-left text-gray-500">
          <th className="py-2" style={{ width: '200px' }}>Project</th>
          <th className="py-2">Client</th>
          <th className="py-2 text-center" style={{ width: '160px' }}>Phase</th>
        </tr>
      </thead>
      <tbody>
        {sortedProjects.map((p) => (
          <tr key={p.id} className="border-t">
            <td className="py-2 font-medium">{p.name}</td>
            <td className="py-2">{p.client}</td>
            <td className="py-2 text-center">
              <span
                className="inline-block px-3 py-1 rounded-full text-xs"
                style={{
                  background: `${PHASE_COLORS[p.phase]}22`,
                  color: PHASE_COLORS[p.phase],
                  minWidth: '140px'
                }}
              >
                {getPhaseDisplayName(p.phase)}
              </span>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function WeeklyTasksCard() {
  const items = PROJECTS
    .flatMap((p) => p.tasks.map((task) => ({ 
      ...task,
      project: p.name, 
      color: PHASE_COLORS[p.phase]
    })))
    .slice(0, 5); // Show first 5 tasks

  if (!items.length) return <div className="text-sm text-gray-500">No tasks available.</div>;

  return (
    <ul className="space-y-2">
      {items.map((task, idx) => (
        <li key={task.id} className="flex items-center gap-2">
          <span className="h-2 w-2 rounded-full" style={{ background: task.color }} />
          <span className="text-sm">
            {task.description} <span className="text-gray-500">— {task.project}</span>
          </span>
        </li>
      ))}
    </ul>
  );
}

// Day-level month timeline with per-phase segments
function TimelineGanttMonth() {
  // Initialize scroll to show current week (day 0) as the first visible date
  const weeksVisible = 10;
  const daysPerWeek = 7;
  const initialScrollOffset = 0; // Start with current week as first date

  const [scrollOffset, setScrollOffset] = React.useState(initialScrollOffset);
  const [isDragging, setIsDragging] = React.useState(false);
  const [dragStart, setDragStart] = React.useState(0);
  const [dragStartOffset, setDragStartOffset] = React.useState(0);

  // Calculate timeline bounds
  const minDay = Math.min(...PROJECTS.flatMap(p => p.segments?.map(s => s.startDay) || [p.startDay]));
  const maxDay = Math.max(...PROJECTS.flatMap(p => p.segments?.map(s => s.endDay) || [p.endDay]));
  const totalDays = maxDay - minDay + 1;
  const maxScrollForward = maxDay - (weeksVisible * daysPerWeek); // Can scroll forward to show end of projects
  const maxScrollBackward = minDay; // Can scroll backward to show start of projects

  const startDate = new Date(2024, 8, 22); // September 22, 2024 (current week = day 0)

  const viewportStartDay = scrollOffset;
  const viewportEndDay = viewportStartDay + (weeksVisible * daysPerWeek);
  const toPct = (d: number) => ((d - viewportStartDay) / (weeksVisible * daysPerWeek)) * 100;

  // Create a comprehensive timeline that includes past and future weeks
  const timelineStartDay = minDay - (weeksVisible * daysPerWeek); // Start before current viewport
  const timelineEndDay = maxDay + (weeksVisible * daysPerWeek); // End after current viewport
  const totalTimelineDays = timelineEndDay - timelineStartDay + 1;
  const totalTimelineWeeks = Math.ceil(totalTimelineDays / daysPerWeek);
  
  const allWeeks = Array.from({ length: totalTimelineWeeks }, (_, i) => {
    const weekDayIndex = timelineStartDay + (i * daysPerWeek);
    const weekStart = new Date(startDate);
    weekStart.setDate(startDate.getDate() + weekDayIndex);
    return {
      label: `${weekStart.getMonth() + 1}/${weekStart.getDate()}`,
      dayIndex: weekDayIndex,
      isCurrentWeek: weekDayIndex <= 0 && weekDayIndex + 6 >= 0
    };
  });

  // Removed wheel scrolling - only drag allowed

  const handleMouseDown = (e: React.MouseEvent) => {
    setIsDragging(true);
    setDragStart(e.clientX);
    setDragStartOffset(scrollOffset);
    e.preventDefault();
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (!isDragging) return;
    const deltaX = dragStart - e.clientX;
    const newOffset = Math.max(maxScrollBackward, Math.min(maxScrollForward, dragStartOffset + deltaX / 5));
    setScrollOffset(newOffset);
  };

  const handleMouseUp = () => {
    setIsDragging(false);
  };

  React.useEffect(() => {
    if (isDragging) {
      const handleGlobalMouseMove = (e: MouseEvent) => {
        const deltaX = dragStart - e.clientX;
        const newOffset = Math.max(maxScrollBackward, Math.min(maxScrollForward, dragStartOffset + deltaX / 5));
        setScrollOffset(newOffset);
      };
      const handleGlobalMouseUp = () => setIsDragging(false);

      document.addEventListener('mousemove', handleGlobalMouseMove);
      document.addEventListener('mouseup', handleGlobalMouseUp);

      return () => {
        document.removeEventListener('mousemove', handleGlobalMouseMove);
        document.removeEventListener('mouseup', handleGlobalMouseUp);
      };
    }
  }, [isDragging, dragStart, dragStartOffset, maxScrollForward, maxScrollBackward]);

  // Filter to show only active projects
  const currentWeek = 0;
  const activeProjects = PROJECTS.filter(p => {
    const currentPhaseSegment = p.segments?.find(s =>
      currentWeek >= s.startDay && currentWeek <= s.endDay
    );
    const isCurrentlyActive = !!currentPhaseSegment;
    const isWithinKickoffBuffer = p.segments?.[0] && currentWeek >= (p.segments[0].startDay - 7) && currentWeek <= (p.segments[0].endDay + 7);
    const lastSegment = p.segments?.[p.segments.length - 1];
    const isWithinCompletionBuffer = lastSegment && currentWeek >= (lastSegment.startDay - 7) && currentWeek <= (lastSegment.endDay + 7);

    return isCurrentlyActive || isWithinKickoffBuffer || isWithinCompletionBuffer;
  });

  const resetToCurrentWeek = () => {
    setScrollOffset(0); // Reset to current week (day 0)
  };

  return (
    <div className="relative">
      <div
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        className={`select-none ${isDragging ? 'cursor-grabbing' : 'cursor-grab'} relative`}
      >
      <div className="grid grid-cols-[180px,1fr] gap-2 text-xs text-gray-500 mb-2">
        <div></div>
        <div className="relative h-8 overflow-hidden">
          {/* Week date labels - use toPct for proper scrolling */}
          {allWeeks.map((week, i) => {
            const weekStartPos = toPct(week.dayIndex);
            const weekEndPos = toPct(week.dayIndex + 7); // Use 7 days for full week width
            
            // Only show if week is visible in viewport
            if (weekEndPos >= 0 && weekStartPos <= 100) {
              // Clamp the position to ensure it doesn't go outside viewport
              const clampedLeft = Math.max(0, weekStartPos);
              const clampedRight = Math.min(100, weekEndPos);
              const clampedWidth = clampedRight - clampedLeft;
              
              // Only render if there's enough space for the date
              if (clampedWidth > 0) {
                return (
                  <div
                    key={`week-label-${week.dayIndex}`}
                    className={`absolute top-0 bottom-0 flex items-center justify-center text-xs pointer-events-none ${week.isCurrentWeek ? 'font-bold text-orange-600' : 'text-gray-500'}`}
                    style={{
                      left: `${clampedLeft}%`,
                      width: `${clampedWidth}%`,
                      zIndex: 2,
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap'
                    }}
                  >
                    {week.label}
                  </div>
                );
              }
            }
            return null;
          })}
        </div>
      </div>

      {[...activeProjects].sort((a, b) => a.startDay - b.startDay).map((p) => {
        const segments = p.segments && p.segments.length
          ? p.segments
          : [{ phase: p.phase, startDay: p.startDay, endDay: p.endDay }];

        return (
          <div key={p.id} className="grid grid-cols-[180px,1fr] gap-2 items-center mb-3">
            <div className="text-sm">
              <div className="font-medium">{p.name}</div>
              <div className="text-gray-500">{p.client}</div>
            </div>
            <div className="relative h-8 overflow-hidden">
              {segments.map((s, idx) => {
                const left = toPct(s.startDay);
                const right = toPct(s.endDay);
                const segColor = PHASE_COLORS[s.phase];

                // Only render if segment is visible in current view
                if (right < 0 || left > 100) return null;

                const clampedLeft = Math.max(0, left);
                const clampedRight = Math.min(100, right);
                const width = clampedRight - clampedLeft;

                if (width <= 0) return null;

                return (
                  <div
                    key={`${p.id}-${idx}`}
                    className="absolute top-0 bottom-0 rounded-full flex items-center justify-center text-xs font-medium"
                    style={{
                      left: `${clampedLeft}%`,
                      width: `${width}%`,
                      background: `${segColor}22`,
                      color: segColor
                    }}
                    title={s.phase}
                  >
                    <span className="truncate px-1">{s.phase}</span>
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}

      {/* Continuous vertical lines */}
      <div className="absolute top-0 left-[188px] right-0 pointer-events-none overflow-hidden" style={{ height: '100%' }}>
        {allWeeks.map((week, i) => {
          const weekStartPos = toPct(week.dayIndex);
          
          // Only show if week is visible in viewport
          if (weekStartPos >= 0 && weekStartPos <= 100) {
            return (
              <div
                key={`week-divider-${week.dayIndex}`}
                className="absolute top-0 w-px bg-gray-300/40"
                style={{ 
                  left: `${weekStartPos}%`,
                  height: '100%'
                }}
              />
            );
          }
          return null;
        })}

        {/* Current week column background highlight */}
        {(() => {
          const currentWeek = allWeeks.find(week => week.isCurrentWeek);
          if (currentWeek) {
            const weekStartPos = toPct(currentWeek.dayIndex);
            const weekEndPos = toPct(currentWeek.dayIndex + 7); // Use 7 days for full week width
            const weekWidth = weekEndPos - weekStartPos;
            
            // Only show if current week is visible in viewport
            if (weekEndPos >= 0 && weekStartPos <= 100) {
              return (
                <div
                  className="absolute top-0 bottom-0 /20 pointer-events-none"
                  style={{
                    left: `${Math.max(0, weekStartPos)}%`,
                    width: `${Math.max(0, Math.min(100, weekWidth))}%`,
                    zIndex: 1
                  }}
                />
              );
            }
          }
          return null;
        })()}

      </div>

      <div className="flex flex-wrap gap-2 items-center justify-center mt-3 text-xs">
        {PHASES.map((ph) => (
          <span
            key={ph}
            className="px-0.5 sm:px-1 md:px-2 py-1 rounded-full"
            style={{
              background: `${PHASE_COLORS[ph]}22`,
              color: PHASE_COLORS[ph],
            }}
          >
            {getPhaseDisplayName(ph)}
          </span>
        ))}
      </div>
      </div>
    </div>
  );
}

interface ProjectHubProps {
  projects: Project[];
  onProjectCreated: (project: Project) => void;
  onArchive: (projectId: string) => void;
  setProjects: (projects: Project[] | ((prev: Project[]) => Project[])) => void;
  savedContentAnalyses?: any[];
  setRoute?: (route: string) => void;
  setAnalysisToLoad?: (analysisId: string | null) => void;
  setIsLoadingProjectFile?: (loading: boolean) => void;
  initialProject?: Project | null;
  setCurrentSelectedProject?: (project: Project | null) => void;
  setIsViewingProjectDetails?: (viewing: boolean) => void;
}

function ProjectHub({ projects, onProjectCreated, onArchive, setProjects, savedContentAnalyses = [], setRoute, setAnalysisToLoad, setIsLoadingProjectFile, initialProject = null, setCurrentSelectedProject, setIsViewingProjectDetails }: ProjectHubProps) {
  const { user } = useAuth();
  
  // Function to get current phase based on today's date
  const getCurrentPhase = (project: Project): string => {
    if (!project.segments || project.segments.length === 0) {
      return project.phase; // Fallback to stored phase
    }

    const today = new Date();
    const todayStr = today.toISOString().split('T')[0]; // YYYY-MM-DD format

    // Find which phase today falls into
    for (const segment of project.segments) {
      if (todayStr >= segment.startDate && todayStr <= segment.endDate) {
        return segment.phase;
      }
    }

    // If today is before the first phase, return the first phase
    if (todayStr < project.segments[0].startDate) {
      return project.segments[0].phase;
    }

    // If today is after the last phase, return the last phase
    if (todayStr > project.segments[project.segments.length - 1].endDate) {
      return project.segments[project.segments.length - 1].phase;
    }

    return project.phase; // Fallback
  };

  // Helper function to get solid phase colors (non-transparent) - matches PHASE_COLORS
  const getSolidPhaseColor = (phase: string): string => {
    return PHASE_COLORS[phase] || '#6B7280';
  };

  const [showProjectWizard, setShowProjectWizard] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  const [filterPhase, setFilterPhase] = useState<Phase | "All">("All");
  const [editingProject, setEditingProject] = useState<Project | null>(null);
  const [viewingProject, setViewingProject] = useState<Project | null>(null);

  // Handle initial project navigation
  useEffect(() => {
    if (initialProject) {
      console.log('ProjectHub: initialProject provided:', initialProject.name);
      // Filter out "Project Creator" from initialProject
      const cleanedInitialProject = {
        ...initialProject,
        teamMembers: (initialProject.teamMembers || []).filter(member => member.name !== 'Project Creator')
      };
      setSelectedProject(cleanedInitialProject);
      setShowDashboard(true);
      setIsTransitioning(false);

      // Update the main App component's current selected project
      if (setCurrentSelectedProject) {
        setCurrentSelectedProject(cleanedInitialProject);
      }
      
      // Update the main App component that we're viewing project details
      if (setIsViewingProjectDetails) {
        setIsViewingProjectDetails(true);
      }

      // Initialize team members with cleaned project team members (already filtered)
      setLocalTeamMembers(cleanedInitialProject.teamMembers || []);
    }
  }, [initialProject]);
  const [archivedProjects, setArchivedProjects] = useState<Project[]>([]);
  const [showArchivedProjects, setShowArchivedProjects] = useState(false);
  const [loadingArchived, setLoadingArchived] = useState(false);
  const [selectedProject, setSelectedProject] = useState<Project | null>(null);
  const [showDashboard, setShowDashboard] = useState(false);
  const [isTransitioning, setIsTransitioning] = useState(false);
  const [showAddTeamMember, setShowAddTeamMember] = useState(false);
  const [showAddRoleDropdown, setShowAddRoleDropdown] = useState<string | null>(null);
  const [localTeamMembers, setLocalTeamMembers] = useState<Array<{ id: string; name: string; role: string; email?: string }>>([]);
  const [activeTab, setActiveTab] = useState<'active' | 'archived'>('active');
  const [showMyProjectsOnly, setShowMyProjectsOnly] = useState(user?.role === 'oversight' ? false : true);
  const [vendorsData, setVendorsData] = useState<any>(null);
  const [viewMode, setViewMode] = useState<'list' | 'timeline'>('list');
  const [timelineWeekOffset, setTimelineWeekOffset] = useState(0);
  const [projectUpdateModal, setProjectUpdateModal] = useState<{ show: boolean; project: Project | null; update: string | null }>({ show: false, project: null, update: null });

  // Sorting and filtering state
  const [sortConfig, setSortConfig] = useState<{ key: string; direction: 'asc' | 'desc' } | null>(null);

  // Helper function for proper case formatting
  const toProperCase = (text: string): string => {
    return text.split(' ').map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase()).join(' ');
  };

  // Load vendors data
  const loadVendorsData = useCallback(async () => {
    try {
      const storedVendors = localStorage.getItem('cognitive_dash_vendors');
      if (storedVendors) {
        const data = JSON.parse(storedVendors);
        setVendorsData(data);
      } else {
        // If no vendors in localStorage, try to fetch from API
        const token = localStorage.getItem('cognitive_dash_token');
        if (token) {
          const resp = await fetch(`${API_BASE_URL}/api/vendors`, {
            headers: { 'Authorization': `Bearer ${token}` }
          });
          if (resp.ok) {
            const serverData = await resp.json();
            const data = {
              moderators: serverData.moderators || [],
              sampleVendors: serverData.sampleVendors || [],
              analytics: serverData.analytics || []
            };
            localStorage.setItem('cognitive_dash_vendors', JSON.stringify(data));
            setVendorsData(data);
          }
        }
      }
    } catch (error) {
      console.error('Error loading vendors data:', error);
    }
  }, []);


  // Load archived projects
  const loadArchivedProjects = async () => {
    if (!user?.id) return;

    setLoadingArchived(true);
    try {
      const response = await fetch(`${API_BASE_URL}/api/projects/archived?userId=${user.id}` , {
        headers: { 'Authorization': `Bearer ${localStorage.getItem('cognitive_dash_token')}` }
      });
      if (response.ok) {
        const data = await response.json();
        setArchivedProjects(data.projects || []);
      } else {
        console.error('Failed to load archived projects');
      }
    } catch (error) {
      console.error('Error loading archived projects:', error);
    } finally {
      setLoadingArchived(false);
    }
  };

  // Load archived projects count on mount
  useEffect(() => {
    loadArchivedProjects();
  }, [user?.id]);

  // Listen for event to change project filter from Dashboard
  useEffect(() => {
    const handleSetFilter = (event: CustomEvent) => {
      if (event.detail === 'all') {
        setShowMyProjectsOnly(false);
      }
    };

    window.addEventListener('setProjectHubFilter', handleSetFilter as EventListener);
    return () => {
      window.removeEventListener('setProjectHubFilter', handleSetFilter as EventListener);
    };
  }, []);

  // Close team member dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (showAddTeamMember) {
        const target = event.target as HTMLElement;
        // Check if click is outside the dropdown
        if (!target.closest('.team-member-dropdown') && !target.closest('.team-member-button')) {
          setShowAddTeamMember(false);
        }
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [showAddTeamMember]);

  // Close role dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (showAddRoleDropdown) {
        const target = event.target as HTMLElement;
        // Check if click is outside the role dropdown
        if (!target.closest('.role-dropdown') && !target.closest('.add-role-button')) {
          setShowAddRoleDropdown(null);
        }
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [showAddRoleDropdown]);

  // Load vendors data on mount
  useEffect(() => {
    loadVendorsData();
  }, [loadVendorsData]);


  // Helper function to get final report date from project
  const getFinalReportDate = (project: Project): Date | null => {
    // First try to get from keyDeadlines
    const finalReportDeadline = project.keyDeadlines?.find(kd => 
      kd.label.toLowerCase().includes('final') || kd.label.toLowerCase().includes('report')
    );
    
    if (finalReportDeadline) {
      // Parse the MM/DD/YY format
      const [month, day, year] = finalReportDeadline.date.split('/').map(Number);
      const fullYear = year < 50 ? 2000 + year : 1900 + year;
      return new Date(fullYear, month - 1, day);
    }
    
    // Fallback to project end date
    if (project.endDate) {
      return new Date(project.endDate + 'T00:00:00');
    }
    
    return null;
  };

  // Helper function to determine if project has started based on kickoff date
  const hasProjectStarted = (project: Project): boolean => {
    if (!project.segments || project.segments.length === 0) return true;

    const today = new Date();
    const kickoffDate = new Date(project.segments[0].startDate);
    return kickoffDate <= today;
  };

  // Helper function to get fieldwork date range
  const getFieldworkRange = (project: Project): string => {
    if (!project.segments) return '-';

    const fieldworkSegment = project.segments.find(segment => segment.phase === 'Fielding');
    if (!fieldworkSegment) return '-';

    const startDate = formatDateForDisplay(fieldworkSegment.startDate);
    const endDate = formatDateForDisplay(fieldworkSegment.endDate);
    return `${startDate} - ${endDate}`;
  };

  // Helper function to get final report date
  const getReportDate = (project: Project): string => {
    const reportDate = getFinalReportDate(project);
    if (!reportDate) return '-';
    return formatDateForDisplay(reportDate.toISOString().split('T')[0]);
  };

  // Categorize projects
  const proposalProjects = projects.filter(project => !hasProjectStarted(project));
  const activeProjects = projects.filter(project => hasProjectStarted(project) && !project.archived);
  const archivedProjectsList = [...archivedProjects];

  // Get filtered counts for display
  const getFilteredCounts = () => {
    const allActiveProjects = [...proposalProjects, ...activeProjects];
    const allArchivedProjects = [...archivedProjectsList];
    
    // Apply user filtering if enabled
    let filteredActive = allActiveProjects;
    let filteredArchived = allArchivedProjects;
    
    if (showMyProjectsOnly && user) {
      const uid = String((user as any)?.id || '').toLowerCase();
      const uemail = String((user as any)?.email || '').toLowerCase();
      const uname = String((user as any)?.name || '').toLowerCase();
      
      const filterByUser = (projectList: any[]) => {
        return projectList.filter(project => {
          const createdBy = String((project as any).createdBy || '').toLowerCase();
          const createdByMe = createdBy && (createdBy === uid || createdBy === uemail);
          const inTeam = (project.teamMembers || []).some((member: any) => {
            const mid = String(member?.id || '').toLowerCase();
            const memail = String(member?.email || '').toLowerCase();
            const mname = String(member?.name || '').toLowerCase();
            return (uid && mid === uid) || (uemail && memail === uemail) || (uname && mname === uname);
          });
          return createdByMe || inTeam;
        });
      };
      
      filteredActive = filterByUser(allActiveProjects);
      filteredArchived = filterByUser(allArchivedProjects);
    }
    
    return {
      active: filteredActive.length,
      archived: filteredArchived.length
    };
  };
  
  const filteredCounts = getFilteredCounts();

  // Get current tab projects
  const getCurrentTabProjects = () => {
    let tabProjects;
    switch (activeTab) {
      case 'active': tabProjects = [...proposalProjects, ...activeProjects]; break;
      case 'archived': tabProjects = archivedProjectsList; break;
      default: tabProjects = [...proposalProjects, ...activeProjects];
    }
    
    // Apply "My Projects Only" filter if enabled (by id/email/name or creator)
    if (showMyProjectsOnly) {
      // If user is not available, fall back to showing all to avoid empty state
      if (!user) return tabProjects;

      const uid = String((user as any)?.id || '').toLowerCase();
      const uemail = String((user as any)?.email || '').toLowerCase();
      const uname = String((user as any)?.name || '').toLowerCase();

      return tabProjects.filter(project => {
        const createdBy = String((project as any).createdBy || '').toLowerCase();
        const createdByMe = createdBy && (createdBy === uid || createdBy === uemail);

        const inTeam = (project.teamMembers || []).some((member: any) => {
          const mid = String(member?.id || '').toLowerCase();
          const memail = String(member?.email || '').toLowerCase();
          const mname = String(member?.name || '').toLowerCase();
          return (uid && mid === uid) || (uemail && memail === uemail) || (uname && mname === uname);
        });

        return createdByMe || inTeam;
      });
    }
    
    return tabProjects;
  };

  // Helper function to check if project belongs to current user
  const isUserProject = (project: Project) => {
    if (!user) return false;
    
    const uid = String((user as any)?.id || '').toLowerCase();
    const uemail = String((user as any)?.email || '').toLowerCase();
    const uname = String((user as any)?.name || '').toLowerCase();
    
    const createdBy = String((project as any).createdBy || '').toLowerCase();
    const createdByMe = createdBy && (createdBy === uid || createdBy === uemail);
    
    const inTeam = (project.teamMembers || []).some((member: any) => {
      const mid = String(member?.id || '').toLowerCase();
      const memail = String(member?.email || '').toLowerCase();
      const mname = String(member?.name || '').toLowerCase();
      return mid === uid || memail === uemail || mname === uname;
    });
    
    return createdByMe || inTeam;
  };

  // Helper function to get project status with special statuses
  const getProjectStatus = (project: Project) => {
    const today = new Date();
    
    // Check if project is before KO date
    const kickoffDate = project.keyDeadlines?.find(kd => 
      kd.label.toLowerCase().includes('kickoff') || 
      kd.label.toLowerCase().includes('ko')
    )?.date;
    
    if (kickoffDate && kickoffDate !== 'Invalid Date') {
      const koDate = new Date(kickoffDate);
      if (today < koDate) {
        return { phase: 'Awaiting KO', color: '#9CA3AF' };
      }
    }
    
    // Check if project is after final report date
    const finalReportDate = project.keyDeadlines?.find(kd => 
      kd.label.toLowerCase().includes('final') && kd.label.toLowerCase().includes('report')
    )?.date;
    
    if (finalReportDate && finalReportDate !== 'Invalid Date') {
      const reportDate = new Date(finalReportDate);
      if (today > reportDate) {
        return { phase: 'Complete', color: '#10B981' };
      }
    }
    
    // Default to current phase
    const currentPhase = getCurrentPhase(project);
    return { phase: currentPhase, color: PHASE_COLORS[currentPhase] || PHASE_COLORS['Kickoff'] };
  };

  // Helper function to get project data for filtering/sorting
  const getProjectData = (project: Project) => {
    const projectStatus = getProjectStatus(project);
    const currentPhase = projectStatus.phase;
    const phaseColor = projectStatus.color;
    
    // Get methodology type
    const methodologyType = project.methodologyType ||
                          (project.methodology?.includes('Focus') || project.methodology?.includes('Interview') || project.methodology?.includes('Ethnographic') || 
                           project.name?.toLowerCase().includes('qual') ? 'Qualitative' : 'Quantitative');
    
    const displayMethodologyType = methodologyType === 'Quantitative' ? 'Quant' : methodologyType === 'Qualitative' ? 'Qual' : methodologyType;

    // Get sample details
    let sampleDetails = 'TBD';
    if (project.sampleSize && project.sampleSize > 0) {
      const totalSample = project.sampleSize;
      const subgroups = project.subgroups || [];
      if (subgroups.length > 0) {
        const subgroupText = subgroups.map(sg => `${sg.name} (${sg.size})`).join(', ');
        sampleDetails = `n=${totalSample} (${subgroupText})`;
      } else {
        sampleDetails = `n=${totalSample}`;
      }
    }

    // Get moderator
    let moderator = 'TBD';
    if (project.moderator) {
      // First try to find by ID
      let moderatorData = vendorsData?.moderators?.find((m: any) => m.id === project.moderator);
      
      // If not found by ID, try to find by name (in case moderator is stored as name)
      if (!moderatorData) {
        moderatorData = vendorsData?.moderators?.find((m: any) => 
          m.name === project.moderator || 
          m.name?.toLowerCase() === project.moderator?.toLowerCase()
        );
      }
      
      if (moderatorData) {
        moderator = moderatorData.name;
      } else {
        // If vendorsData is not loaded yet, check if it looks like an ID (numeric) or name
        if (vendorsData === null) {
          // If vendors data not loaded yet, show "Loading..." instead of ID
          moderator = 'Loading...';
        } else {
          // If vendors data is loaded but no match found, show the stored value
          moderator = project.moderator;
        }
      }
    }
    if (methodologyType === 'Quantitative' && (moderator === 'TBD' || moderator === 'Loading...')) {
      moderator = '-';
    }
    if (moderator && moderator !== 'TBD' && moderator !== '-') {
      moderator = moderator.replace(/\s*\(internal\)/gi, '').trim();
    }

    // Get fieldwork range
    const fieldworkStart = project.keyDeadlines?.find(kd => kd.label.includes('Fieldwork'))?.date || 
                          project.keyDeadlines?.find(kd => kd.label.includes('Field'))?.date;
    const fieldworkEnd = project.keyDeadlines?.find(kd => kd.label.includes('Fieldwork End'))?.date || 
                        project.keyDeadlines?.find(kd => kd.label.includes('Field End'))?.date;
    const fieldworkRange = fieldworkStart && fieldworkEnd ? 
                          `${formatDateForDisplay(fieldworkStart)} - ${formatDateForDisplay(fieldworkEnd)}` : 
                          fieldworkStart ? formatDateForDisplay(fieldworkStart) : 'TBD';

    // Get report deadline
    const reportDeadline = project.keyDeadlines?.find(kd => kd.label.includes('Report'))?.date || 
                         project.keyDeadlines?.find(kd => kd.label.includes('Final'))?.date || 
                         new Date(project.endDate + 'T00:00:00Z').toLocaleDateString('en-US', { month: 'numeric', day: 'numeric', year: '2-digit' });

    return {
      ...project,
      phase: currentPhase,
      phaseColor,
      methodologyType: displayMethodologyType,
      sampleDetails,
      moderator,
      fieldworkRange,
      reportDeadline,
      teamMembersText: project.teamMembers?.map(m => m.name).join(', ') || 'No team'
    };
  };


  // Apply user filtering and sorting
  const filteredProjects = useMemo(() => {
    let projects = getCurrentTabProjects().map(getProjectData);

    // Apply user filtering if enabled
    if (showMyProjectsOnly && user) {
      const uid = String((user as any)?.id || '').toLowerCase();
      const uemail = String((user as any)?.email || '').toLowerCase();
      const uname = String((user as any)?.name || '').toLowerCase();
      
      projects = projects.filter(project => {
        const createdBy = String((project as any).createdBy || '').toLowerCase();
        const createdByMe = createdBy && (createdBy === uid || createdBy === uemail);
        const inTeam = (project.teamMembers || []).some((member: any) => {
          const mid = String(member?.id || '').toLowerCase();
          const memail = String(member?.email || '').toLowerCase();
          const mname = String(member?.name || '').toLowerCase();
          return (uid && mid === uid) || (uemail && memail === uemail) || (uname && mname === uname);
        });
        return createdByMe || inTeam;
      });
    }

    // Apply sorting
    if (sortConfig) {
      projects.sort((a, b) => {
        let aValue = a[sortConfig.key as keyof typeof a];
        let bValue = b[sortConfig.key as keyof typeof b];

        // Special handling for phase sorting
        if (sortConfig.key === 'phase') {
          const phaseOrder = {
            'Awaiting KO': 0,
            'Kickoff': 1,
            'Pre-Field': 2,
            'Fielding': 3,
            'Post-Field Analysis': 4,
            'Reporting': 5,
            'Complete': 6
          };
          
          const aPhaseOrder = phaseOrder[aValue as keyof typeof phaseOrder] ?? 999;
          const bPhaseOrder = phaseOrder[bValue as keyof typeof phaseOrder] ?? 999;
          
          if (aPhaseOrder < bPhaseOrder) {
            return sortConfig.direction === 'asc' ? -1 : 1;
          }
          if (aPhaseOrder > bPhaseOrder) {
            return sortConfig.direction === 'asc' ? 1 : -1;
          }
          return 0;
        }

        // Handle different data types for other columns
        if (typeof aValue === 'string' && typeof bValue === 'string') {
          aValue = aValue.toLowerCase();
          bValue = bValue.toLowerCase();
        }

        if (aValue < bValue) {
          return sortConfig.direction === 'asc' ? -1 : 1;
        }
        if (aValue > bValue) {
          return sortConfig.direction === 'asc' ? 1 : -1;
        }
        return 0;
      });
    } else {
      // Default sort: user projects first (by status), then other projects (by final report date)
      projects.sort((a, b) => {
        const aIsUserProject = isUserProject(a);
        const bIsUserProject = isUserProject(b);
        
        // If one is user project and other isn't, user project comes first
        if (aIsUserProject && !bIsUserProject) return -1;
        if (!aIsUserProject && bIsUserProject) return 1;
        
        // If both are user projects, sort by phase (latest first) then by progress
        if (aIsUserProject && bIsUserProject) {
          // Get current phase using the same logic as Dashboard
          const getCurrentPhase = (project: Project): string => {
            if (!project.segments || project.segments.length === 0) {
              return project.phase; // Fallback to stored phase
            }

            const today = new Date();
            const todayStr = today.toISOString().split('T')[0]; // YYYY-MM-DD format

            // Find which phase today falls into
            for (const segment of project.segments) {
              if (todayStr >= segment.startDate && todayStr <= segment.endDate) {
                return segment.phase;
              }
            }

            // If today is before the first phase, return the first phase
            if (todayStr < project.segments[0].startDate) {
              return project.segments[0].phase;
            }

            // If today is after the last phase, return the last phase
            if (todayStr > project.segments[project.segments.length - 1].endDate) {
              return project.segments[project.segments.length - 1].phase;
            }

            return project.phase; // Fallback
          };

          const aPhase = getCurrentPhase(a);
          const bPhase = getCurrentPhase(b);
          
          const phaseOrder = {
            'Awaiting KO': 0,
            'Kickoff': 1,
            'Pre-Field': 2,
            'Fielding': 3,
            'Post-Field Analysis': 4,
            'Reporting': 5,
            'Complete': 6
          };
          
          const aPhaseOrder = phaseOrder[aPhase as keyof typeof phaseOrder] ?? 999;
          const bPhaseOrder = phaseOrder[bPhase as keyof typeof phaseOrder] ?? 999;
          
          // Sort by phase (latest first)
          if (aPhaseOrder !== bPhaseOrder) {
            return bPhaseOrder - aPhaseOrder; // Reverse order for latest first
          }
          
          // If same phase, sort by progress percentage (highest first)
          const getProgressFromTimeline = (project: Project) => {
            const today = new Date();
            today.setHours(0, 0, 0, 0);
            
            // Get KO date and Report date from keyDeadlines
            const koDeadline = project.keyDeadlines?.find(d => 
              d.label.toLowerCase().includes('kickoff') || 
              d.label.toLowerCase().includes('ko')
            );
            const reportDeadline = project.keyDeadlines?.find(d => 
              d.label.toLowerCase().includes('report') || 
              d.label.toLowerCase().includes('final')
            );
            
            if (koDeadline?.date && reportDeadline?.date) {
              const startDate = new Date(koDeadline.date);
              const endDate = new Date(reportDeadline.date);
              startDate.setHours(0, 0, 0, 0);
              endDate.setHours(0, 0, 0, 0);
              
              if (!isNaN(startDate.getTime()) && !isNaN(endDate.getTime())) {
                if (today >= startDate && today < endDate) {
                  const totalDays = Math.ceil((endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24));
                  const daysElapsed = Math.ceil((today.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24));
                  return Math.min(100, Math.max(0, Math.round((daysElapsed / totalDays) * 100)));
                } else if (today >= endDate) {
                  return 100;
                }
              }
            }
            
            // Fallback to phase-based progress
            const phaseProgress: { [key: string]: number } = {
              'Kickoff': 10,
              'Pre-Field': 25,
              'Fielding': 50,
              'Post-Field Analysis': 75,
              'Reporting': 90,
              'Complete': 100,
              'Awaiting KO': 5
            };
            return phaseProgress[aPhase] || 20;
          };
          
          const aProgress = getProgressFromTimeline(a);
          const bProgress = getProgressFromTimeline(b);
          
          return bProgress - aProgress; // Highest progress first
        }
        
        // If neither are user projects, sort by final report date
        const dateA = getFinalReportDate(a);
        const dateB = getFinalReportDate(b);

        if (dateA && dateB) {
          return dateA.getTime() - dateB.getTime();
        }
        if (dateA && !dateB) return -1;
        if (!dateA && dateB) return 1;
        return 0;
      });
    }

    return projects;
  }, [getCurrentTabProjects, showMyProjectsOnly, sortConfig, vendorsData, user]);

  // Handle sorting
  const handleSort = (key: string) => {
    setSortConfig(prev => {
      if (prev?.key === key) {
        return prev.direction === 'asc' ? { key, direction: 'desc' } : null;
      }
      return { key, direction: 'asc' };
    });
  };



  const handleEditProject = (updatedProject: Project) => {
    if (setProjects) {
      setProjects(prevProjects => prevProjects.map(p => p.id === updatedProject.id ? updatedProject : p));
    }
  };

  const handleDeleteProject = async (projectId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (window.confirm('Are you sure you want to permanently delete this project? This action cannot be undone.')) {
      try {
      const response = await fetch(`${API_BASE_URL}/api/projects/${projectId}`, {
        method: 'DELETE',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${localStorage.getItem('cognitive_dash_token')}`
        },
        body: JSON.stringify({ userId: user?.id })
      });

        if (response.ok) {
          // Remove from both archived and main projects list
          setArchivedProjects(prev => prev.filter(p => p.id !== projectId));
          setProjects(prev => prev.filter(p => p.id !== projectId));
        } else {
          const errorText = await response.text();
          console.error('Failed to delete project:', response.status, errorText);
        }
      } catch (error) {
        console.error('Error deleting project:', error);
      }
    }
  };

  const handleArchiveProject = async (project: Project, e: React.MouseEvent) => {
    e.stopPropagation();
    if (window.confirm(`Are you sure you want to archive "${project.name}"?`)) {
      try {
      const response = await fetch(`${API_BASE_URL}/api/projects/${project.id}/archive`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${localStorage.getItem('cognitive_dash_token')}`
        },
        body: JSON.stringify({ userId: user?.id })
      });

        if (response.ok) {
          // Remove from current projects list
          setProjects && setProjects(prev => prev.filter(p => p.id !== project.id));
          // Add to archived projects list
          setArchivedProjects(prev => [...prev, { ...project, archived: true, archivedDate: new Date().toISOString() }]);
        } else {
          const errorText = await response.text();
          console.error('Failed to archive project:', response.status, errorText);
        }
      } catch (error) {
        console.error('Error archiving project:', error);
      }
    }
  };

  const handleUnarchiveProject = async (project: Project, e: React.MouseEvent) => {
    e.stopPropagation();
    if (window.confirm(`Are you sure you want to restore "${project.name}" to active status?`)) {
      try {
        const response = await fetch(`${API_BASE_URL}/api/projects/${project.id}/unarchive`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${localStorage.getItem('cognitive_dash_token')}`
          },
          body: JSON.stringify({ userId: user?.id })
        });

        if (response.ok) {
          // Remove from archived projects list
          setArchivedProjects(prev => prev.filter(p => p.id !== project.id));
          // Add back to active projects by updating the projects list
          setProjects && setProjects(prev => [...prev, { ...project, archived: false }]);
        } else {
          const errorText = await response.text();
          console.error('Failed to unarchive project:', response.status, errorText);
        }
      } catch (error) {
        console.error('Error unarchiving project:', error);
      }
    }
  };

  const handleProjectView = useCallback(async (project: Project) => {
    console.log('🔍 handleProjectView called for project:', project.name);
    console.log('📋 Project team members:', project.teamMembers);

    // Filter out "Project Creator" from the project before setting it
    const cleanedProject = {
      ...project,
      teamMembers: (project.teamMembers || []).filter(member => member.name !== 'Project Creator')
    };

    setSelectedProject(cleanedProject);
    setIsTransitioning(true);

    // Update the main App component's current selected project
    if (setCurrentSelectedProject) {
      setCurrentSelectedProject(cleanedProject);
    }

    // Initialize team members with project team members + creator
    console.log('🔄 Loading project team members:', project.teamMembers);
    const initialTeamMembers = (project.teamMembers || [])
      .filter(member => member.name !== 'Project Creator') // Filter out legacy "Project Creator" members
      .map(member => {
      console.log('👤 Processing team member:', member.name, 'Current roles:', member.roles, 'Old role:', member.role);
      console.log('🔍 Full member object:', member);
      console.log('🔍 Member roles array:', member.roles);
      console.log('🔍 Member roles type:', typeof member.roles);
      console.log('🔍 Member roles length:', member.roles?.length);
      
      // Handle migration from old role system to new roles array
      let roles = member.roles || [];

      // Only migrate if roles array is truly empty AND there's an old role field
      // AND the old role is not a default role
      if (roles.length === 0 && member.role &&
          member.role !== 'Team Member' &&
          member.role !== 'Project Creator') {
        // Migrate all roles including Project Manager
        console.log('🔄 Migrating old role to new roles array:', member.role);
        roles = [member.role];
      }

      return {
        ...member,
        roles: roles // Use the migrated roles
      };
    });

    console.log('🎯 Final initial team members:', initialTeamMembers);
    setLocalTeamMembers(initialTeamMembers);
    
    // Check if automatic task assignment is needed
    if (cleanedProject.tasks && cleanedProject.tasks.length > 0 && initialTeamMembers.length > 0) {
      // Check if any tasks are unassigned
      const hasUnassignedTasks = cleanedProject.tasks.some(task => 
        !task.assignedTo || task.assignedTo.length === 0
      );
      
      if (hasUnassignedTasks) {
        console.log('🔄 Project has unassigned tasks, triggering automatic assignment...');
        try {
          // Import and use the auto-assignment function
          const { autoAssignByRoles } = await import('./lib/autoAssignByRoles');
          
          // Convert team members to the expected format
          const teamWithRoles = initialTeamMembers.map(member => ({
            id: member.id,
            name: member.name,
            roles: member.roles || []
          }));

          console.log('🔄 Automatic task assignment triggered with team:', teamWithRoles);

          // Generate assignments
          const assignments = await autoAssignByRoles(cleanedProject.tasks || [], teamWithRoles);
          
          if (assignments && assignments.length > 0) {
            // Create a map for quick lookup of assignments by taskId
            const assignmentMap = new Map<string, string[]>();
            assignments.forEach(assignment => {
              if (!assignmentMap.has(assignment.taskId)) {
                assignmentMap.set(assignment.taskId, []);
              }
              assignmentMap.get(assignment.taskId)?.push(assignment.assignedTo);
            });

            // Update tasks with assignments
            const updatedTasks = cleanedProject.tasks?.map(task => {
              return {
                ...task,
                assignedTo: assignmentMap.get(task.id) || [] // Assign based on map
              };
            }) || [];

            // Update the project with assigned tasks
            const updatedProject = {
              ...cleanedProject,
              tasks: updatedTasks
            };

            // Save to backend
            const token = localStorage.getItem('cognitive_dash_token');
            const authHeaders = token ? { Authorization: `Bearer ${token}` } : { Authorization: '' };
            const response = await fetch(`${API_BASE_URL}/api/projects/${cleanedProject.id}`, {
              method: 'PUT',
              headers: {
                ...authHeaders,
                'Content-Type': 'application/json'
              },
              body: JSON.stringify({
                userId: user?.id,
                project: updatedProject
              })
            });

            if (response.ok) {
              console.log('✅ Tasks automatically assigned based on roles');
              setSelectedProject(updatedProject); // Update local state
            } else {
              console.error('Failed to save automatic task assignments');
            }
          }
        } catch (error) {
          console.error('Error in automatic task assignment:', error);
        }
      } else {
        console.log('✅ All tasks already assigned, skipping automatic assignment');
      }
    }

    // Start transition animation
    setTimeout(() => {
      setShowDashboard(true);
      setIsTransitioning(false);
      
      // Update the main App component that we're viewing project details
      if (setIsViewingProjectDetails) {
        setIsViewingProjectDetails(true);
      }
    }, 1500);
  }, [user, setCurrentSelectedProject, setIsViewingProjectDetails]);

  const handleReturnToHub = () => {
    setIsTransitioning(true);

    // Start transition animation
    setTimeout(() => {
      setShowDashboard(false);
      setSelectedProject(null);
      setIsTransitioning(false);

      // Clear the main App component's current selected project
      if (setCurrentSelectedProject) {
        setCurrentSelectedProject(null);
      }
      
      // Update the main App component that we're no longer viewing project details
      if (setIsViewingProjectDetails) {
        setIsViewingProjectDetails(false);
      }
    }, 300);
  };

  // Save team members to backend
  const saveTeamMembersToProject = async (updatedTeamMembers: Array<{ id: string; name: string; role: string; email?: string; roles?: string[] }>) => {
    if (!selectedProject || !user?.id) {
      console.error('❌ Cannot save team members - missing project or user:', { selectedProject: !!selectedProject, userId: user?.id });
      return;
    }

    console.log('💾 Saving team members to backend:', updatedTeamMembers);
    console.log('👤 User ID:', user.id);
    console.log('📋 Project ID:', selectedProject.id);
    
    // Debug: Show detailed role information for each member
    updatedTeamMembers.forEach(member => {
      console.log(`🔍 Saving member ${member.name}:`, {
        id: member.id,
        roles: member.roles,
        role: member.role,
        fullObject: member
      });
    });

    try {
      const updatedProject = {
        ...selectedProject,
        teamMembers: updatedTeamMembers
      };

      console.log('📤 Sending project update to backend:', {
        projectId: selectedProject.id,
        teamMembers: updatedProject.teamMembers
      });
      
      // Debug: Show what's being sent to backend
      console.log('🔍 Backend payload team members:', JSON.stringify(updatedProject.teamMembers, null, 2));

      const response = await fetch(`${API_BASE_URL}/api/projects/${selectedProject.id}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${localStorage.getItem('cognitive_dash_token')}`
        },
        body: JSON.stringify({
          userId: user.id,
          project: updatedProject
        })
      });

      console.log('📡 Backend response status:', response.status);
      
      if (response.ok) {
        const responseData = await response.json();
        console.log('✅ Team members saved successfully:', responseData);
        
        // Generate notifications for newly added team members
        const existingTeamMembers = selectedProject.teamMembers || [];
        const newTeamMembers = updatedTeamMembers.filter(newMember => 
          !existingTeamMembers.some(existing => existing.id === newMember.id)
        );
        
        newTeamMembers.forEach(newMember => {
          notificationService.generateTeamMemberNotification(
            selectedProject.id,
            selectedProject.name,
            newMember.id,
            newMember.name,
            user?.name || 'Unknown'
          );
        });
        
        // Update the project in the projects list
        setProjects(prevProjects =>
          prevProjects.map(p =>
            p.id === selectedProject.id
              ? { ...p, teamMembers: updatedTeamMembers }
              : p
          )
        );
        // Update the selected project
        setSelectedProject(prev => prev ? { ...prev, teamMembers: updatedTeamMembers } : null);
        
        // Update the main App component's current selected project
        if (setCurrentSelectedProject) {
          setCurrentSelectedProject(prev => prev ? { ...prev, teamMembers: updatedTeamMembers } : null);
        }
        
        // Also update localTeamMembers to ensure consistency
        setLocalTeamMembers(updatedTeamMembers);
        console.log('✅ Local state updated successfully');
      } else {
        console.error('❌ Failed to save team members:', response.status);
        const errorText = await response.text();
        console.error('Error details:', errorText);
        alert(`Failed to save team members: ${errorText}`);
      }
    } catch (error) {
      console.error('💥 Error saving team members:', error);
    }
  };

  // Team member management functions
  const handleAddTeamMember = async (user: User) => {
    const newTeamMember = {
      id: user.id,
      name: user.name,
      role: 'Team Member',
      roles: [], // Initialize with empty roles array
      email: user.email
    };

    // Check if user is already a team member
    const isAlreadyMember = selectedProject?.teamMembers?.some(member => member.id === user.id);
    if (!isAlreadyMember) {
      const updatedTeamMembers = [...(selectedProject?.teamMembers || []), newTeamMember];
      setLocalTeamMembers(updatedTeamMembers);
      setShowAddTeamMember(false);

      // Save to backend
      await saveTeamMembersToProject(updatedTeamMembers);
      console.log('Adding team member:', newTeamMember);
    }
  };

  const handleRemoveTeamMember = async (memberId: string) => {
    if (!selectedProject) return;
    
    const updatedTeamMembers = selectedProject.teamMembers?.filter(member => member.id !== memberId) || [];
    setLocalTeamMembers(updatedTeamMembers);

    // Update the selected project with new team members
    const updatedProject = {
      ...selectedProject,
      teamMembers: updatedTeamMembers
    };
    setSelectedProject(updatedProject);

    // Update the main App component's current selected project
    if (setCurrentSelectedProject) {
      setCurrentSelectedProject(updatedProject);
    }

    // Save to backend
    await saveTeamMembersToProject(updatedTeamMembers);
    
    // Reassign tasks after removing team member
    await reassignTasksByRoles(updatedTeamMembers);
    
    console.log('Removing team member:', memberId);
  };

  // Handle role toggle and automatic task reassignment
  const handleRoleToggle = async (memberId: string, role: string) => {
    if (!selectedProject) return;

    console.log('🔄 handleRoleToggle called:', { memberId, role, currentLocalTeamMembers: localTeamMembers });

    const updatedTeamMembers = localTeamMembers.map(member => {
      if (member.id === memberId) {
        const currentRoles = member.roles || [];
        const hasRole = currentRoles.includes(role);
        
        let newRoles;
        if (hasRole) {
          // Remove role
          newRoles = currentRoles.filter(r => r !== role);
          console.log(`🗑️ Removing role "${role}" from ${member.name}. New roles:`, newRoles);
        } else {
          // Add role
          newRoles = [...currentRoles, role];
          console.log(`➕ Adding role "${role}" to ${member.name}. New roles:`, newRoles);
        }

        // Update both roles array and legacy role field for backward compatibility
        const primaryRole = newRoles.length > 0 ? newRoles[0] : 'Team Member';
        return { 
          ...member, 
          roles: newRoles,
          role: primaryRole // Keep legacy role field in sync
        };
      }
      return member;
    });

    console.log('📝 Updated team members:', updatedTeamMembers);
    setLocalTeamMembers(updatedTeamMembers);

    // Update the selected project with new team members
    const updatedProject = {
      ...selectedProject,
      teamMembers: updatedTeamMembers
    };
    setSelectedProject(updatedProject);

    // Update the main App component's current selected project
    if (setCurrentSelectedProject) {
      setCurrentSelectedProject(updatedProject);
    }

    // Save team members to backend
    await saveTeamMembersToProject(updatedTeamMembers);

    // Only update tasks for the specific role that changed
    await updateTasksForRole(updatedTeamMembers, memberId, role);
  };

  // Update tasks only for a specific role that changed
  const updateTasksForRole = async (teamMembers: any[], memberId: string, changedRole: string) => {
    if (!selectedProject || !selectedProject.tasks) {
      console.log('Cannot update tasks: no project or tasks available');
      return;
    }

    try {
      console.log(`🎯 Updating tasks only for role: ${changedRole}`);
      
      // Find the member who had the role change
      const changedMember = teamMembers.find(m => m.id === memberId);
      if (!changedMember) {
        console.log('Member not found');
        return;
      }

      // Check if the member still has the role
      const hasRole = changedMember.roles && changedMember.roles.includes(changedRole);
      
      // Find all team members who currently have this role
      const membersWithRole = teamMembers.filter(member => 
        member.roles && member.roles.includes(changedRole)
      );

      console.log(`Members with role ${changedRole}:`, membersWithRole.map(m => m.name));
      
      // Update only tasks that have the changed role
      const updatedTasks = selectedProject.tasks.map(task => {
        // Only update tasks that match the changed role
        if (task.role !== changedRole) {
          console.log(`⏭️ Skipping task ${task.id} (role: ${task.role}) - not the changed role`);
          return task; // Keep existing task completely unchanged
        }

        console.log(`🔄 Updating task ${task.id} for role ${changedRole}`);
        
        // If no one has this role, remove all assignments
        if (membersWithRole.length === 0) {
          console.log(`❌ No members have role ${changedRole} - removing all assignments from task ${task.id}`);
          return { 
            ...task, 
            assignedTo: []
            // Keep all other properties including completion status
          };
        }

        // Get current assignments for this task
        const currentAssignments = task.assignedTo || [];
        let newAssignments = [...currentAssignments]; // Start with current assignments
        
        // If the changed member was removed from the role, remove them from assignments
        if (!hasRole) {
          newAssignments = currentAssignments.filter(assignment => assignment !== memberId);
          console.log(`🗑️ Removed ${changedMember.name} from task ${task.id} assignments`);
        } else {
          // If the changed member was added to the role, add them to assignments
          if (!currentAssignments.includes(memberId)) {
            newAssignments = [...currentAssignments, memberId];
            console.log(`➕ Added ${changedMember.name} to task ${task.id} assignments`);
          }
        }

        console.log(`✅ Task ${task.id} assigned to:`, newAssignments);
        
        return { 
          ...task, 
          assignedTo: newAssignments
          // Keep all other properties including completion status
        };
      });

      // Validate task updates before applying
      if (!Array.isArray(updatedTasks)) {
        console.error('Invalid task updates:', updatedTasks);
        return;
      }

      // Update the project with new task assignments
      const updatedProject = {
        ...selectedProject,
        tasks: updatedTasks,
        teamMembers: teamMembers
      };

      console.log('💾 Saving updated project with role-specific task changes');

      // Save to backend
      const response = await fetch(`${API_BASE_URL}/api/projects/${selectedProject.id}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${localStorage.getItem('cognitive_dash_token')}`
        },
        body: JSON.stringify({
          userId: user?.id,
          project: updatedProject
        })
      });

      if (response.ok) {
        // Update local state
        setTimeout(() => {
          setSelectedProject(updatedProject);
          
          if (setCurrentSelectedProject) {
            setCurrentSelectedProject(updatedProject);
          }
          
          if (setProjects) {
            setProjects(prevProjects =>
              prevProjects.map(p => p.id === selectedProject.id ? updatedProject : p)
            );
          }
          console.log(`Tasks updated for role: ${changedRole}`);
        }, 100);
      } else {
        console.error('Failed to update task assignments');
      }
    } catch (error) {
      console.error('Error updating tasks for role:', error);
    }
  };

  // Reassign tasks based on current role assignments
  const reassignTasksByRoles = async (teamMembers: any[]) => {
    if (!selectedProject || !selectedProject.tasks) {
      console.log('Cannot reassign tasks: no project or tasks available');
      return;
    }

    try {
      // Import the auto-assignment function
      const { autoAssignByRoles } = await import('./lib/autoAssignByRoles');
      
      // Convert team members to the expected format
      const teamWithRoles = teamMembers.map(member => ({
        id: member.id,
        name: member.name,
        roles: member.roles || []
      }));

      console.log('Team with roles for reassignment:', teamWithRoles);
      console.log('Project tasks sample:', selectedProject.tasks.slice(0, 5).map(t => ({ id: t.id, description: t.description })));

      // Get assignments based on roles
      const assignments = await autoAssignByRoles(selectedProject.tasks || [], teamWithRoles);
      console.log('Generated assignments:', assignments);
      
      // Debug: Show which roles are being processed
      teamWithRoles.forEach(member => {
        console.log(`Member ${member.name} has roles:`, member.roles);
      });

      // Update project tasks with new assignments
      const updatedTasks = selectedProject.tasks.map(task => {
        // Find assignments for this task - handle both t1/t2 format and task-001/task-002 format
        const taskAssignments = assignments.filter(a => {
          // Try exact match first
          if (a.taskId === task.id) {
            console.log(`Exact match: ${task.id} === ${a.taskId}`);
            return true;
          }
          
          // Convert t1, t2, t3... to task-001, task-002, task-003...
          const tMatch = task.id.match(/^t(\d+)$/);
          if (tMatch) {
            const taskNumber = tMatch[1].padStart(3, '0');
            const expectedTaskId = `task-${taskNumber}`;
            if (a.taskId === expectedTaskId) {
              console.log(`Converted match: ${task.id} -> ${expectedTaskId} === ${a.taskId}`);
              return true;
            }
          }
          
          // Convert task-001, task-002... to t1, t2...
          const taskMatch = task.id.match(/^task-(\d+)$/);
          if (taskMatch) {
            const taskNumber = parseInt(taskMatch[1]);
            const expectedTaskId = `t${taskNumber}`;
            if (a.taskId === expectedTaskId) {
              console.log(`Reverse match: ${task.id} -> ${expectedTaskId} === ${a.taskId}`);
              return true;
            }
          }
          
          return false;
        });
        
        if (taskAssignments.length > 0) {
          // Assign to members who have the role for this task
          const assignedTo = taskAssignments.map(a => a.assigneeId);
          console.log(`Assigning task ${task.id} to:`, assignedTo);
          console.log(`Task assignments for ${task.id}:`, taskAssignments.map(a => ({ role: a.role, assigneeId: a.assigneeId })));
          return { ...task, assignedTo };
        } else {
          // If no one has the role for this task, remove all assignments
          console.log(`No assignments for task ${task.id}`);
          return { ...task, assignedTo: [] };
        }
      });

      // Validate task updates before applying
      if (!Array.isArray(updatedTasks)) {
        console.error('Invalid task updates:', updatedTasks);
        return;
      }

      // Update the project with new task assignments AND ensure team members are up-to-date
      const updatedProject = {
        ...selectedProject,
        tasks: updatedTasks,
        teamMembers: teamMembers  // Use the passed-in team members to ensure roles are included
      };

      console.log('💾 Saving updated project with team members:', JSON.stringify(teamMembers, null, 2));

      // Save to backend
      const response = await fetch(`${API_BASE_URL}/api/projects/${selectedProject.id}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${localStorage.getItem('cognitive_dash_token')}`
        },
        body: JSON.stringify({
          userId: user?.id,
          project: updatedProject
        })
      });

      if (response.ok) {
        // Update local state with error handling and slight delay to prevent rapid updates
        try {
          // Use setTimeout to prevent rapid state updates
          setTimeout(() => {
            setSelectedProject(updatedProject);
            
            // Update the main App component's current selected project
            if (setCurrentSelectedProject) {
              setCurrentSelectedProject(updatedProject);
            }
            
            if (setProjects) {
              setProjects(prevProjects =>
                prevProjects.map(p => p.id === selectedProject.id ? updatedProject : p)
              );
            }
            console.log('Tasks reassigned based on role changes');
          }, 100);
        } catch (stateError) {
          console.error('Error updating state:', stateError);
        }
      } else {
        console.error('Failed to update task assignments');
      }
    } catch (error) {
      console.error('Error reassigning tasks:', error);
    }
  };

  // Generate project update
  const handleGetProjectUpdate = (project: Project) => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    // Get current phase
    const getCurrentPhase = () => {
      if (!project.segments || project.segments.length === 0) {
        return { phase: project.phase, segment: null };
      }
      const todayStr = today.toISOString().split('T')[0];
      const currentSegment = project.segments.find(segment =>
        todayStr >= segment.startDate && todayStr <= segment.endDate
      );
      return currentSegment ? { phase: currentSegment.phase, segment: currentSegment } : { phase: project.phase, segment: null };
    };

    const currentPhaseData = getCurrentPhase();

    // Get next phase timeline
    const getNextPhaseTimeline = () => {
      if (!project.segments || project.segments.length === 0) return null;
      const todayStr = today.toISOString().split('T')[0];
      const futureSegments = project.segments.filter(segment => segment.startDate > todayStr);
      return futureSegments.length > 0 ? futureSegments[0] : null;
    };

    const nextPhase = getNextPhaseTimeline();
    
    // Debug logging for phase detection
    console.log('Phase generation debug:', {
      hasNextPhase: !!nextPhase,
      nextPhaseName: nextPhase?.phase,
      currentPhase: currentPhaseData.phase,
      segments: project.segments?.map(s => ({ phase: s.phase, startDate: s.startDate, endDate: s.endDate }))
    });

    // Get upcoming key dates (within next 2 weeks)
    const twoWeeksFromNow = new Date(today);
    twoWeeksFromNow.setDate(twoWeeksFromNow.getDate() + 14);
    const upcomingKeyDates = (project.keyDeadlines || []).filter(deadline => {
      const deadlineDate = new Date(deadline.date);
      return deadlineDate >= today && deadlineDate <= twoWeeksFromNow;
    }).sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

    // Get tasks assigned today
    const todayStr = today.toISOString().split('T')[0];
    const tasksToday = (project.tasks || []).filter(task =>
      task.dueDate === todayStr && task.status !== 'completed'
    );

    // Get tasks assigned over next 2 weeks
    const tasksNext2Weeks = (project.tasks || []).filter(task => {
      if (!task.dueDate || task.status === 'completed') return false;
      const taskDate = new Date(task.dueDate);
      return taskDate > today && taskDate <= twoWeeksFromNow;
    }).sort((a, b) => new Date(a.dueDate!).getTime() - new Date(b.dueDate!).getTime());

    // Format date helper
    const formatDate = (dateStr: string) => {
      const date = new Date(dateStr);
      return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
    };

    // Build update text
    const teamMemberNames = (project.teamMembers || []).map(m => m.name).join(', ') || 'No team members assigned';
    let updateText = `**Team Members:** ${teamMemberNames}\n\n`;
    updateText += `**Client:** ${project.client}\n\n`;
    if (nextPhase) {
      // If there's an upcoming phase, always render current phase as [PHASE] for side-by-side display
      if (currentPhaseData.segment) {
        updateText += `[PHASE] Current Phase:|${currentPhaseData.phase}|${formatDate(currentPhaseData.segment.startDate)} - ${formatDate(currentPhaseData.segment.endDate)}\n`;
      } else {
        updateText += `[PHASE] Current Phase:|${currentPhaseData.phase}|No date range available\n`;
      }
      updateText += `[PHASE] Upcoming Phase:|${nextPhase.phase}|${formatDate(nextPhase.startDate)} - ${formatDate(nextPhase.endDate)}\n`;
    } else {
      // No upcoming phase, render current phase normally
      if (currentPhaseData.segment) {
        updateText += `[PHASE] Current Phase:|${currentPhaseData.phase}|${formatDate(currentPhaseData.segment.startDate)} - ${formatDate(currentPhaseData.segment.endDate)}\n`;
      } else {
        updateText += `**Current Phase:** ${currentPhaseData.phase}\n`;
      }
    }

    if (tasksToday.length > 0) {
      updateText += `**Tasks Due Today:**\n`;
      tasksToday.forEach(task => {
        const assignedNames = task.assignedTo?.map(id => {
          const member = project.teamMembers?.find(m => m.id === id);
          return member?.name || 'Not assigned';
        }).join(', ') || 'Not assigned';
        updateText += `[TASK] ${task.description || task.content}|${project.name}|${assignedNames}\n`;
      });
      updateText += `\n`;
    }

    if (tasksNext2Weeks.length > 0) {
      updateText += `[DIVIDER]\n`;
      updateText += `**Tasks Due in Next 2 Weeks:**\n`;
      tasksNext2Weeks.forEach(task => {
        const assignedNames = task.assignedTo?.map(id => {
          const member = project.teamMembers?.find(m => m.id === id);
          return member?.name || 'Not assigned';
        }).join(', ') || 'Not assigned';
        updateText += `[TASK] ${task.description || task.content}|${project.name}|${formatDate(task.dueDate!)}|${assignedNames}\n`;
      });
      updateText += `\n`;
    }

    if (upcomingKeyDates.length > 0) {
      updateText += `[DIVIDER]\n`;
      updateText += `**Key Dates Coming Up:**\n`;
      upcomingKeyDates.forEach(deadline => {
        updateText += `[KEYDATE] ${deadline.label}|${formatDate(deadline.date)}\n`;
      });
      updateText += `\n`;
    }

    // Add project files
    if (project.files && project.files.length > 0) {
      updateText += `**Project Files:**\n`;
      project.files.forEach(file => {
        updateText += `[FILE:${file.type}] ${file.name}|${file.url}\n`;
      });
    }

    setProjectUpdateModal({ show: true, project, update: updateText });
  };

  return (
    <div className="relative">
      {/* Loading Screen */}
      {isTransitioning && (
        <div className="flex items-center justify-center h-screen">
          <div className="text-center">
            <div className="w-16 h-16 flex items-center justify-center mx-auto mb-4">
              <svg className="animate-spin" width="48" height="48" viewBox="0 0 48 48">
                <circle cx="24" cy="24" r="20" fill="none" stroke="#D14A2D" strokeWidth="4" strokeDasharray="50 75.4" strokeDashoffset="0" />
                <circle cx="24" cy="24" r="20" fill="none" stroke="#5D5F62" strokeWidth="4" strokeDasharray="50 75.4" strokeDashoffset="-62.7" />
              </svg>
            </div>
            <p className="text-gray-500">Loading project...</p>
          </div>
        </div>
      )}

      {/* Dashboard View */}
      {showDashboard && selectedProject && !isTransitioning && (
        <div>
          {/* Dashboard Header with Return Button */}
          <div className="flex items-center justify-between mb-6">
            <div className="flex items-center gap-4">
              <button
                onClick={handleReturnToHub}
                className="flex items-center gap-2 px-4 py-2 text-gray-600 hover:text-gray-800 hover:bg-gray-100 rounded-lg transition-colors"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                </svg>
                Return to Project Hub
              </button>
            </div>

            {/* Team Members Section */}
            <div className="flex items-center gap-3 relative">
              <span className="text-gray-500 text-sm">Team Members</span>
              <div className="w-px h-4 bg-gray-300"></div>
              <div className="flex items-center gap-2">
                {selectedProject.teamMembers?.slice(0, 4).map((member, index) => {
                  console.log('Header team member:', member, 'ID:', member.id);
                  const initials = member.name.split(' ').map(n => n[0]).join('').toUpperCase();
                  return (
                    <div
                      key={member.id || `member-${index}`}
                      className="w-8 h-8 rounded-full flex items-center justify-center text-white text-xs font-medium relative group"
                      style={{ backgroundColor: getMemberColor(member.id, selectedProject.teamMembers) }}
                    >
                      {initials}
                      {/* Tooltip - Below the icon */}
                      <div className="absolute top-full left-1/2 transform -translate-x-1/2 mt-2 px-0.5 sm:px-1 md:px-2 py-1 bg-gray-800 text-white text-xs rounded shadow-lg opacity-0 group-hover:opacity-100 transition-opacity duration-200 pointer-events-none whitespace-nowrap z-50">
                        {member.name}
                        <div className="absolute bottom-full left-1/2 transform -translate-x-1/2 w-0 h-0 border-l-4 border-r-4 border-b-4 border-transparent border-b-gray-800"></div>
                      </div>
                    </div>
                  );
                })}
                <button
                  onClick={() => setShowAddTeamMember(!showAddTeamMember)}
                  className="team-member-button w-8 h-8 rounded-full flex items-center justify-center text-gray-400 hover:text-gray-600 transition-colors"
                  title="Manage team members"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
                  </svg>
                </button>
              </div>

              {/* Add Team Member Popup Dropdown */}
              {showAddTeamMember && (
                <>
                  {/* Modal - positioned right below the + button, right-aligned */}
                  <div className="team-member-dropdown absolute top-full right-0 mt-2 bg-white rounded-lg border shadow-lg z-[9999] w-80 max-h-[80vh] overflow-y-auto">
                  <div className="p-4">
                    <div className="flex items-center justify-between mb-3">
                      <h4 className="text-sm font-semibold text-gray-900">Manage Team Members</h4>
                      <button
                        onClick={() => setShowAddTeamMember(false)}
                        className="text-gray-400 hover:text-gray-600"
                      >
                        <XMarkIcon className="w-4 h-4" />
                      </button>
                    </div>

                    {/* Add New Member - Moved to top */}
                    <div className="mb-4">
                      <h5 className="text-xs font-medium text-gray-500 mb-2">Add New Member</h5>
                      <UserSearch
                        onUserSelect={handleAddTeamMember}
                        placeholder="Search for team members..."
                        className="text-sm"
                      />
                    </div>

                    {/* Current Team Members */}
                    <div>
                      <h5 className="text-xs font-medium text-gray-500 mb-2">Current Members</h5>
                      <div className="space-y-2 max-h-48 overflow-y-auto">
                        {localTeamMembers?.filter(member => {
                          console.log('Filtering member:', member);
                          return member && member.id && member.name;
                        }).map((member, index) => (
                          <div key={member.id || `modal-member-${index}`} className="p-2 bg-gray-50 rounded-lg relative">
                            <div className="flex items-center justify-between mb-2">
                              <div className="flex items-center gap-2">
                                <div
                                  className="w-6 h-6 rounded-full flex items-center justify-center text-white text-xs font-medium"
                                  style={{ backgroundColor: getMemberColor(member.id, localTeamMembers) }}
                                >
                                  {member.name.split(' ').map(n => n[0]).join('').toUpperCase()}
                                </div>
                                <span className="text-sm text-gray-900">{member.name}</span>
                              </div>
                              <button
                                onClick={() => {
                                  // Show confirmation dialog
                                  if (window.confirm(`Are you sure you want to remove ${member.name} from this project?`)) {
                                    handleRemoveTeamMember(member.id);
                                  }
                                }}
                                className="text-gray-400 hover:text-red-600 transition-colors"
                                title="Remove member"
                              >
                                <XMarkIcon className="w-4 h-4" />
                              </button>
                            </div>
                            
                            {/* Role Assignment */}
                            <div className="ml-8">
                              <div className="flex flex-wrap gap-1 items-center">
                                {(member.roles || []).map((role) => (
                                  <div
                                    key={role}
                                    className="flex items-center gap-1 px-2 py-1 text-xs rounded-full bg-orange-100 text-orange-800 border border-orange-200"
                                  >
                                    <span>{role}</span>
                                    <button
                                      onClick={() => handleRoleToggle(member.id, role)}
                                      className="text-orange-600 hover:text-orange-800 transition-colors"
                                      title={`Remove ${role} role`}
                                    >
                                      <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                                      </svg>
                                    </button>
                                  </div>
                                ))}
                                
                                {/* Add Role Button */}
                                <div className="relative">
                                  <button
                                    onClick={() => {
                                      const currentShowAddRole = showAddRoleDropdown;
                                      setShowAddRoleDropdown(currentShowAddRole === member.id ? null : member.id);
                                    }}
                                    className="add-role-button w-6 h-6 rounded-full border border-gray-300 flex items-center justify-center text-gray-500 hover:text-gray-700 hover:border-gray-400 transition-colors"
                                    title="Add role"
                                  >
                                    <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
                                    </svg>
                                  </button>
                                  
                                  {/* Role Dropdown */}
                                  {showAddRoleDropdown === member.id && (
                                    <div className="role-dropdown absolute top-full left-0 mt-1 bg-white border border-gray-300 rounded-lg shadow-xl z-[10001] min-w-[180px] max-h-[200px] overflow-y-auto">
                                      {['Project Manager', 'Logistics', 'Recruit Coordinator', 'AE Manager']
                                        .filter(role => !(member.roles || []).includes(role))
                                        .map(role => (
                                          <button
                                            key={role}
                                            onClick={() => {
                                              handleRoleToggle(member.id, role);
                                              setShowAddRoleDropdown(null);
                                            }}
                                            className="w-full px-3 py-2 text-left text-xs hover:bg-gray-100 first:rounded-t-lg last:rounded-b-lg"
                                          >
                                            {role}
                                          </button>
                                        ))}
                                      {['Project Manager', 'Logistics', 'Recruit Coordinator', 'AE Manager']
                                        .filter(role => !(member.roles || []).includes(role)).length === 0 && (
                                        <div className="px-3 py-2 text-xs text-gray-500">All roles assigned</div>
                                      )}
                                    </div>
                                  )}
                                </div>
                                
                                {(member.roles || []).length === 0 && (
                                  <span className="text-xs text-gray-400 italic">No roles assigned</span>
                                )}
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>

                  </div>
                </div>
                </>
              )}
            </div>
          </div>

          {/* Project Dashboard Content */}
          <ProjectDashboard
            project={selectedProject}
            onEdit={() => {
              setShowDashboard(false);
              setEditingProject(selectedProject);
            }}
            onArchive={onArchive}
            setProjects={setProjects}
            onProjectUpdate={(updatedProject) => {
              setSelectedProject(updatedProject);
              
              // Update the main App component's current selected project
              if (setCurrentSelectedProject) {
                setCurrentSelectedProject(updatedProject);
              }
            }}
            savedContentAnalyses={savedContentAnalyses}
            setRoute={setRoute}
            setAnalysisToLoad={setAnalysisToLoad}
            setIsLoadingProjectFile={setIsLoadingProjectFile}
          />
        </div>
      )}

      {/* Project Hub View */}
      {!showDashboard && !isTransitioning && (
      <div className="space-y-5">

        {/* Tabs and Controls */}
        <div className="border-b border-gray-200">
          <div className="flex items-center justify-between">
            <nav className="-mb-px flex space-x-8 items-center">
              <button
                onClick={() => setActiveTab('active')}
                className={`py-2 px-1 border-b-2 font-medium text-sm ${
                  activeTab === 'active'
                    ? 'text-white'
                    : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                }`}
                style={activeTab === 'active' ? { borderBottomColor: BRAND.orange, color: BRAND.orange } : {}}
              >
                Active ({filteredCounts.active})
              </button>
              <button
                onClick={() => setActiveTab('archived')}
                className={`py-2 px-1 border-b-2 font-medium text-sm ${
                  activeTab === 'archived'
                    ? 'text-white'
                    : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                }`}
                style={activeTab === 'archived' ? { borderBottomColor: BRAND.orange, color: BRAND.orange } : {}}
              >
                Archived ({filteredCounts.archived})
              </button>
              <button
                onClick={() => setShowProjectWizard(true)}
                className="flex items-center gap-1 rounded-lg px-3 py-1 text-xs shadow-sm transition-colors text-white hover:opacity-90 ml-4"
                style={{ backgroundColor: BRAND.orange }}
              >
                <PlusSmallIcon className="h-4 w-4" />
                New Project
              </button>
            </nav>
            
            {/* Right-aligned controls */}
            <div className="flex items-center gap-3">
              {/* View Mode Toggle */}
              <div className="flex items-center gap-2">
                <span className="text-sm text-gray-600">Current View:</span>
                <button
                  onClick={() => {
                    const newViewMode = viewMode === 'list' ? 'timeline' : 'list';
                    setViewMode(newViewMode);
                    // Clear filters when switching to timeline view except project name
                    if (newViewMode === 'timeline') {
                      setFilterPhase('All');
                      setSearchTerm('');
                    }
                  }}
                  className={`px-3 py-1 text-xs rounded-lg shadow-sm transition-colors ${
                    viewMode === 'timeline'
                      ? 'text-white hover:opacity-90'
                      : 'bg-white border border-gray-300 hover:bg-gray-50'
                  }`}
                  style={viewMode === 'timeline' ? { backgroundColor: BRAND.orange } : {}}
                >
                  {viewMode === 'list' ? 'List View' : 'Timeline View'}
                </button>
                {user?.role !== 'oversight' && (
                  <button
                    onClick={() => setShowMyProjectsOnly(!showMyProjectsOnly)}
                    className={`px-3 py-1 text-xs rounded-lg shadow-sm transition-colors ${
                      showMyProjectsOnly
                        ? 'bg-white border border-gray-300 hover:bg-gray-50'
                        : 'text-white hover:opacity-90'
                    }`}
                    style={showMyProjectsOnly ? {} : { backgroundColor: BRAND.orange }}
                  >
                    {showMyProjectsOnly ? 'Only My Projects' : 'All Cognitive Projects'}
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* Projects Table - List View */}
        {viewMode === 'list' && (
          <div className="bg-white shadow-sm border border-gray-200 rounded-lg mt-5" style={{ overflow: 'visible' }}>
          <div className="w-full" style={{ overflowX: 'auto', overflowY: 'visible', minHeight: '400px' }}>
            <table className="w-full divide-y divide-gray-200 table-fixed">
              <thead style={{ backgroundColor: BRAND.orange }}>
                {/* Header row with sortable columns */}
                <tr>
                  <th
                    className="px-0.5 sm:px-1 md:px-2 py-3 text-left text-xs font-medium text-white uppercase tracking-wider cursor-pointer hover:bg-orange-600"
                    style={{ width: '200px', minWidth: '200px' }}
                    onClick={() => handleSort('name')}
                  >
                    <div className="flex items-center gap-1">
                      Project
                      {sortConfig?.key === 'name' && (
                        <span className="text-white">
                          {sortConfig.direction === 'asc' ? '↑' : '↓'}
                        </span>
                      )}
                    </div>
                  </th>
                  <th
                    className="px-0.5 sm:px-1 md:px-2 py-3 text-left text-xs font-medium text-white uppercase tracking-wider cursor-pointer hover:bg-orange-600 w-[11%]"
                    onClick={() => handleSort('client')}
                  >
                    <div className="flex items-center gap-1">
                      Client
                      {sortConfig?.key === 'client' && (
                        <span className="text-white">
                          {sortConfig.direction === 'asc' ? '↑' : '↓'}
                        </span>
                      )}
                    </div>
                  </th>
                  <th
                    className="px-0.5 sm:px-1 md:px-2 py-3 text-left text-xs font-medium text-white uppercase tracking-wider cursor-pointer hover:bg-orange-600 w-[9%]"
                    onClick={() => handleSort('phase')}
                  >
                    <div className="flex items-center gap-1">
                      Status
                      {sortConfig?.key === 'phase' && (
                        <span className="text-white">
                          {sortConfig.direction === 'asc' ? '↑' : '↓'}
                        </span>
                      )}
                    </div>
                  </th>
                  <th
                    className="px-0.5 sm:px-1 md:px-2 py-3 text-left text-xs font-medium text-white uppercase tracking-wider cursor-pointer hover:bg-orange-600 w-[13%]"
                    onClick={() => handleSort('teamMembersText')}
                  >
                    <div className="flex items-center gap-1">
                      Team
                      {sortConfig?.key === 'teamMembersText' && (
                        <span className="text-white">
                          {sortConfig.direction === 'asc' ? '↑' : '↓'}
                        </span>
                      )}
                    </div>
                  </th>
                  <th
                    className="px-0.5 sm:px-1 md:px-2 py-3 text-left text-xs font-medium text-white uppercase tracking-wider cursor-pointer hover:bg-orange-600 w-[7%]"
                    onClick={() => handleSort('methodologyType')}
                  >
                    <div className="flex items-center gap-1">
                      Type
                      {sortConfig?.key === 'methodologyType' && (
                        <span className="text-white">
                          {sortConfig.direction === 'asc' ? '↑' : '↓'}
                        </span>
                      )}
                    </div>
                  </th>
                  <th
                    className="px-0.5 sm:px-1 md:px-2 py-3 text-left text-xs font-medium text-white uppercase tracking-wider cursor-pointer hover:bg-orange-600 w-[11%]"
                    onClick={() => handleSort('methodology')}
                  >
                    <div className="flex items-center gap-1">
                      Methodology
                      {sortConfig?.key === 'methodology' && (
                        <span className="text-white">
                          {sortConfig.direction === 'asc' ? '↑' : '↓'}
                        </span>
                      )}
                    </div>
                  </th>
                  <th
                    className="px-0.5 sm:px-1 md:px-2 py-3 text-left text-xs font-medium text-white uppercase tracking-wider cursor-pointer hover:bg-orange-600 w-[10%]"
                    onClick={() => handleSort('sampleDetails')}
                  >
                    <div className="flex items-center gap-1">
                      Sample
                      {sortConfig?.key === 'sampleDetails' && (
                        <span className="text-white">
                          {sortConfig.direction === 'asc' ? '↑' : '↓'}
                        </span>
                      )}
                    </div>
                  </th>
                  <th
                    className="px-0.5 sm:px-1 md:px-2 py-3 text-left text-xs font-medium text-white uppercase tracking-wider cursor-pointer hover:bg-orange-600 w-[9%]"
                    onClick={() => handleSort('moderator')}
                  >
                    <div className="flex items-center gap-1">
                      Moderator
                      {sortConfig?.key === 'moderator' && (
                        <span className="text-white">
                          {sortConfig.direction === 'asc' ? '↑' : '↓'}
                        </span>
                      )}
                    </div>
                  </th>
                  <th
                    className="px-0.5 sm:px-1 md:px-2 py-3 text-center text-xs font-medium text-white uppercase tracking-wider cursor-pointer hover:bg-orange-600 w-[7%]"
                    onClick={() => handleSort('fieldworkRange')}
                  >
                    <div className="flex items-center justify-center gap-1">
                      Fieldwork
                      {sortConfig?.key === 'fieldworkRange' && (
                        <span className="text-white">
                          {sortConfig.direction === 'asc' ? '↑' : '↓'}
                        </span>
                      )}
                    </div>
                  </th>
                  <th
                    className="px-0.5 sm:px-1 md:px-2 py-3 text-center text-xs font-medium text-white uppercase tracking-wider cursor-pointer hover:bg-orange-600 w-[6%]"
                    onClick={() => handleSort('reportDeadline')}
                  >
                    <div className="flex items-center justify-center gap-1">
                      Report
                      {sortConfig?.key === 'reportDeadline' && (
                        <span className="text-white">
                          {sortConfig.direction === 'asc' ? '↑' : '↓'}
                        </span>
                      )}
                    </div>
                  </th>
                  <th className="px-0.5 sm:px-1 md:px-2 py-3 text-center text-xs font-medium text-white uppercase tracking-wider w-[8%]">Actions</th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {filteredProjects.map((project) => {
                  // Use pre-computed data from getProjectData
                  const currentPhase = project.phase;
                  const phaseColor = project.phaseColor;
                  
                  // Use pre-computed data
                  const fieldworkRange = project.fieldworkRange;
                  const reportDeadline = project.reportDeadline;
                  const displayMethodologyType = project.methodologyType;
                  const sampleDetails = project.sampleDetails;
                  const moderator = project.moderator;

                  const isArchived = project.archived === true;
                  const isUserProjectRow = isUserProject(project);
                  // Only highlight user projects when NOT filtering by user's name
                  const shouldHighlightUserProject = isUserProjectRow && (!user || !showMyProjectsOnly);
                  
                  return (
                  <tr
                    key={project.id}
                      className={`hover:bg-gray-50 cursor-pointer ${isArchived ? 'opacity-60 bg-gray-50' : ''} ${shouldHighlightUserProject ? 'bg-orange-50' : ''}`}
                    onClick={() => handleProjectView(project)}
                  >
                      <td className="px-0.5 sm:px-1 md:px-2 py-3 text-sm font-medium text-gray-900 h-16 align-middle" style={{ width: '200px', minWidth: '200px' }}>
                      <div className="line-clamp-2">
                          {project.name}
                          {isArchived && <span className="ml-2 text-xs text-gray-500">(Archived)</span>}
                      </div>
                    </td>
                      <td className="px-0.5 sm:px-1 md:px-2 py-3 text-sm text-gray-500 italic w-[11%] h-16 align-middle">
                        <div className="truncate">{toProperCase(project.client)}</div>
                      </td>
                      <td className="px-0.5 sm:px-1 md:px-2 py-3 h-16 align-middle w-[9%]">
                        <span
                          className="inline-flex items-center justify-center w-24 px-0.5 sm:px-1 md:px-2 py-1 rounded-full text-xs font-medium text-white"
                          style={{ 
                            backgroundColor: isArchived ? '#6B7280' : phaseColor,
                            opacity: 0.6
                          }}
                        >
                          {isArchived ? 'Archived' : getPhaseDisplayName(currentPhase)}
                        </span>
                      </td>
                      <td className="px-0.5 sm:px-1 md:px-2 py-3 text-sm text-gray-500 h-16 align-middle w-[13%]">
                        <div className="flex items-center">
                          {project.teamMembers?.slice(0, 3).map((member, index) => (
                            <div
                              key={`${project.id}-${member.id}-${index}`}
                              className="w-6 h-6 rounded-full flex items-center justify-center text-white text-[10px] font-medium border-2 border-gray-100"
                            style={{
                              backgroundColor: getMemberColor(member.id || member.name, project.teamMembers),
                                marginLeft: index > 0 ? '-4px' : '0',
                              zIndex: 10 - index
                            }}
                            title={member.name}
                          >
                            {member.name.split(' ').map(n => n[0]).join('').toUpperCase()}
                          </div>
                        ))}
                          {project.teamMembers && project.teamMembers.length > 3 && (
                            <div
                              className="w-6 h-6 rounded-full flex items-center justify-center text-gray-700 text-[10px] font-medium border-2 border-gray-100 bg-gray-200"
                              style={{ marginLeft: '-4px', zIndex: 7 }}
                            >
                              +{project.teamMembers.length - 3}
                          </div>
                        )}
                          {(!project.teamMembers || project.teamMembers.length === 0) && (
                            <span className="text-gray-400">No team</span>
                          )}
                      </div>
                    </td>
                      <td className="px-0.5 sm:px-1 md:px-2 py-3 text-xs text-gray-500 w-[7%] h-16 align-middle">
                        <div className="truncate">{toProperCase(displayMethodologyType)}</div>
                    </td>
                      <td className="px-0.5 sm:px-1 md:px-2 py-3 text-xs text-gray-500 w-[11%] h-16 align-middle">
                        <div className="truncate">{toProperCase(project.methodology)}</div>
                    </td>
                      <td className="px-0.5 sm:px-1 md:px-2 py-3 text-xs text-gray-500 w-[10%] h-16 align-middle">
                        {(() => {
                          if (!sampleDetails || sampleDetails === 'TBD') {
                            return <div className="text-xs text-gray-500">TBD</div>;
                          }
                          const match = String(sampleDetails).match(/^(.+?)\s*\((.+?)\)$/);
                          const baseTotal = match ? match[1].trim() : String(sampleDetails);
                          // Normalize to display as n=XX
                          let displayTotal = baseTotal;
                          const nMatch = baseTotal.match(/n\s*=\s*(\d+)/i);
                          if (nMatch) {
                            displayTotal = `n=${nMatch[1]}`;
                          } else {
                            // If it doesn't start with n=, add it
                            const numMatch = baseTotal.match(/(\d+)/);
                            if (numMatch) {
                              displayTotal = `n=${numMatch[1]}`;
                            }
                          }
                          return (
                            <div className="text-xs text-gray-500">
                              <div className="truncate">{displayTotal}</div>
                              {match && (
                                <div className="text-[10px] text-gray-400 truncate">
                                  {match[2]}
                                </div>
                              )}
                            </div>
                          );
                        })()}
                    </td>
                      <td className="px-0.5 sm:px-1 md:px-2 py-3 text-xs text-gray-500 w-[9%] h-16 align-middle">
                        <div className="truncate">
                          {moderator === 'Loading...' ? (
                            <div className="flex items-center gap-1">
                              <div className="w-3 h-3 border border-gray-300 border-t-transparent rounded-full animate-spin"></div>
                              <span className="text-gray-400">Loading...</span>
                            </div>
                          ) : (
                            toProperCase(moderator)
                          )}
                        </div>
                      </td>
                      <td className="px-0.5 sm:px-1 md:px-2 py-3 text-xs text-gray-500 w-[7%] h-16 align-middle">
                        <div className="truncate text-center">{fieldworkRange}</div>
                      </td>
                      <td className="px-0.5 sm:px-1 md:px-2 py-3 text-xs text-gray-500 w-[6%] h-16 align-middle">
                        <div className="truncate text-center">{reportDeadline}</div>
                      </td>
                      <td className="px-0.5 sm:px-1 md:px-2 py-3 text-center text-sm font-medium h-16 align-middle w-[8%]">
                      <div className="flex items-center justify-center gap-2">
                        {activeTab === 'archived' ? (
                          <>
                            <button
                              onClick={(e) => handleUnarchiveProject(project, e)}
                              className="text-green-600 hover:text-green-800 p-1 rounded-lg hover:bg-green-50"
                              title="Restore to active"
                            >
                              <ArchiveBoxArrowDownIcon className="w-4 h-4" />
                            </button>
                            <button
                              onClick={(e) => handleDeleteProject(project.id, e)}
                              className="text-red-600 hover:text-red-800 p-1 rounded-lg hover:bg-red-50"
                              title="Permanently delete project"
                            >
                              <TrashIcon className="w-4 h-4" />
                            </button>
                          </>
                        ) : (
                          <>
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                handleGetProjectUpdate(project);
                              }}
                              className="text-blue-600 hover:text-blue-800 p-1 rounded-lg hover:bg-blue-50"
                              title="Get project update"
                            >
                              <DocumentTextIcon className="w-4 h-4" />
                            </button>
                            <button
                              onClick={(e) => handleArchiveProject(project, e)}
                              className="text-gray-600 hover:text-gray-800 p-1 rounded-lg hover:bg-gray-50"
                              title="Archive project"
                            >
                              <ArchiveBoxIcon className="w-4 h-4" />
                            </button>
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                  );
                })}
              </tbody>
            </table>
            
            {/* Empty State - Show inside the table container when no projects */}
            {filteredProjects.length === 0 && (
              <div className="text-center py-12">
                <FolderIcon className="h-16 w-16 mx-auto mb-4 text-gray-300" />
                <h3 className="text-lg font-medium mb-2">
                  No {activeTab} projects
                </h3>
                <p className="text-gray-600 mb-4">
                  {activeTab === 'active' && "No projects are currently active."}
                  {activeTab === 'archived' && "No projects have been archived yet."}
                </p>
                {activeTab !== 'archived' && (
                  <button
                    onClick={() => setShowProjectWizard(true)}
                    className="px-4 py-2 rounded-xl text-white"
                    style={{ background: BRAND.orange }}
                  >
                    Create Project
                  </button>
                )}
              </div>
            )}
          </div>
        </div>
        )}


      {/* Project Setup Wizard */}
      <ProjectSetupWizard
        isOpen={showProjectWizard}
        onClose={() => setShowProjectWizard(false)}
        onProjectCreated={(project) => {
          onProjectCreated(project);
          setShowProjectWizard(false);
        }}
        projects={projects}
        archivedProjects={archivedProjects}
      />

      {/* Project Detail View */}
      {viewingProject && (
        <ProjectDetailView
          project={viewingProject}
          onClose={() => setViewingProject(null)}
          onEdit={() => {
            setViewingProject(null);
            setEditingProject(viewingProject);
          }}
          onArchive={onArchive}
        />
      )}

      </div>
      )}

        {/* Timeline View */}
        {viewMode === 'timeline' && (
          <div className="bg-white shadow-sm border border-gray-200 rounded-lg mt-5" style={{ overflow: 'visible' }}>
            <div className="w-full" style={{ overflowX: 'auto', overflowY: 'visible', minHeight: '400px' }}>
              <table className="w-full divide-y divide-gray-200 table-fixed">
                <thead style={{ backgroundColor: BRAND.orange }}>
                  <tr>
                    <th className="px-0.5 sm:px-1 md:px-2 py-3 text-left text-xs font-medium text-white uppercase tracking-wider" style={{ width: '200px', minWidth: '200px' }}>
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-1">
                          Project
                        </div>
                        <div className="flex items-center gap-1">
                          <button
                            onClick={() => setTimelineWeekOffset(prev => prev - 1)}
                            className="p-1 hover:bg-orange-600 rounded transition-colors"
                            title="Previous Week"
                          >
                            <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                            </svg>
                          </button>
                          <button
                            onClick={() => setTimelineWeekOffset(prev => prev + 1)}
                            className="p-1 hover:bg-orange-600 rounded transition-colors"
                            title="Next Week"
                          >
                            <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                            </svg>
                          </button>
                        </div>
                      </div>
                    </th>
                    {(() => {
                      // Generate 3 weeks of dates (Monday-Friday only)
                      const getWeekStart = (weekOffset: number) => {
                        const today = new Date();
                        const currentDay = today.getDay(); // 0=Sunday, 1=Monday, ..., 6=Saturday
                        
                        // Calculate days to get to Monday of current week
                        let daysToMonday;
                        if (currentDay === 0) { // Sunday
                          daysToMonday = -6; // Go back 6 days to get to Monday
                        } else if (currentDay === 1) { // Monday
                          daysToMonday = 0; // Already Monday
                        } else { // Tuesday-Saturday
                          daysToMonday = 1 - currentDay; // Go back to Monday
                        }
                        
                        const currentMonday = new Date(today);
                        currentMonday.setDate(today.getDate() + daysToMonday);
                        currentMonday.setHours(0, 0, 0, 0); // Reset time to start of day
                        
                        // Add week offset (each week is 7 days) + timeline navigation offset
                        const targetMonday = new Date(currentMonday);
                        targetMonday.setDate(currentMonday.getDate() + ((weekOffset + timelineWeekOffset) * 7));
                        
                        return targetMonday;
                      };

                      const weeks = Array.from({ length: 3 }, (_, i) => {
                        const weekStart = getWeekStart(i);
                        
                        // Generate only Monday-Friday (5 weekdays)
                        const days = Array.from({ length: 5 }, (_, dayIndex) => {
                          const day = new Date(weekStart);
                          day.setDate(weekStart.getDate() + dayIndex);
                          return day;
                        });
                        return days;
                      });

                      const allDays = weeks.flat();
                      
                      return allDays.map((day, index) => {
                        const isWeekEnd = (index + 1) % 5 === 0; // Every 5th day (end of week)
                        const isNotLastDay = index < allDays.length - 1; // Not the last day overall
                        return (
                          <th key={index} className="px-1 py-3 text-center text-xs font-medium text-white uppercase tracking-wider w-[5.7%] relative">
                            <div className="text-[10px] font-bold">
                              {day.toLocaleDateString('en-US', { month: 'numeric', day: 'numeric' })}
                            </div>
                            {/* Daily divider line behind header (except for last day) */}
                            {isNotLastDay && (
                              <div className="absolute top-0 right-0 w-px h-full bg-white bg-opacity-20" style={{ zIndex: 0 }}></div>
                            )}
                          </th>
                        );
                      });
                    })()}
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-200">
                  {filteredProjects.length === 0 ? (
                    <tr>
                      <td colSpan={16} className="px-6 py-12 text-center">
                        <div className="text-gray-400 mb-4">
                          <svg className="mx-auto h-12 w-12" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M9 5H7a2 2 0 00-2 2v10a2 2 0 002 2h8a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
                          </svg>
                        </div>
                        <h3 className="text-lg font-medium text-gray-900 mb-2">No projects found</h3>
                        <p className="text-gray-500">
                          {searchTerm || filterPhase !== 'All' 
                            ? 'Try adjusting your search or filter criteria.' 
                            : 'Get started by creating your first project.'}
                        </p>
                      </td>
                    </tr>
                  ) : (
                    filteredProjects.map((project) => {
                      const currentPhase = project.phase;
                      const phaseColor = project.phaseColor;
                      const isArchived = project.archived === true;
                      const isUserProjectRow = isUserProject(project);
                      const shouldHighlightUserProject = isUserProjectRow && (!user || !showMyProjectsOnly);

                      // Generate the same date columns for each project row
                      const getWeekStart = (weekOffset: number) => {
                        const today = new Date();
                        const currentDay = today.getDay(); // 0=Sunday, 1=Monday, ..., 6=Saturday
                        
                        // Calculate days to get to Monday of current week
                        let daysToMonday;
                        if (currentDay === 0) { // Sunday
                          daysToMonday = -6; // Go back 6 days to get to Monday
                        } else if (currentDay === 1) { // Monday
                          daysToMonday = 0; // Already Monday
                        } else { // Tuesday-Saturday
                          daysToMonday = 1 - currentDay; // Go back to Monday
                        }
                        
                        const currentMonday = new Date(today);
                        currentMonday.setDate(today.getDate() + daysToMonday);
                        currentMonday.setHours(0, 0, 0, 0); // Reset time to start of day
                        
                        // Add week offset (each week is 7 days) + timeline navigation offset
                        const targetMonday = new Date(currentMonday);
                        targetMonday.setDate(currentMonday.getDate() + ((weekOffset + timelineWeekOffset) * 7));
                        
                        return targetMonday;
                      };

                      const weeks = Array.from({ length: 3 }, (_, i) => {
                        const weekStart = getWeekStart(i);
                        // Generate only Monday-Friday (5 weekdays)
                        const days = Array.from({ length: 5 }, (_, dayIndex) => {
                          const day = new Date(weekStart);
                          day.setDate(weekStart.getDate() + dayIndex);
                          return day;
                        });
                        return days;
                      });

                      const allDays = weeks.flat();

                      // Helper function to get project phase for a specific date
                      const getProjectPhaseForDate = (project: Project, date: Date): string => {
                        if (!project.segments || project.segments.length === 0) {
                          return '';
                        }

                        // Format date as YYYY-MM-DD using local timezone
                        const year = date.getFullYear();
                        const month = String(date.getMonth() + 1).padStart(2, '0');
                        const day = String(date.getDate()).padStart(2, '0');
                        const dateStr = `${year}-${month}-${day}`;
                        
                        for (const segment of project.segments) {
                          if (dateStr >= segment.startDate && dateStr <= segment.endDate) {
                            return segment.phase;
                          }
                        }

                        // Return empty string for dates outside project boundaries
                        return '';
                      };

                      return (
                        <tr
                          key={project.id}
                          className={`hover:bg-gray-50 cursor-pointer ${isArchived ? 'opacity-60 bg-gray-50' : ''} ${shouldHighlightUserProject ? 'bg-orange-50' : ''}`}
                          onClick={() => handleProjectView(project)}
                        >
                          <td className="px-0.5 sm:px-1 md:px-2 py-3 text-sm font-medium text-gray-900 h-16 align-middle" style={{ width: '200px', minWidth: '200px' }}>
                            <div className="line-clamp-2">
                              {project.name}
                              {isArchived && <span className="ml-2 text-xs text-gray-500">(Archived)</span>}
                            </div>
                          </td>
                          {allDays.map((day, index) => {
                            const phaseForDay = getProjectPhaseForDate(project, day);
                            const hasPhase = phaseForDay !== '';
                            const phaseColorForDay = PHASE_COLORS[phaseForDay] || '#6B7280';
                            const isToday = day.toDateString() === new Date().toDateString();
                            const isWeekEnd = (index + 1) % 5 === 0; // Every 5th day (end of week)
                            
                            // Check if this day is in the current week (Monday-Friday of this week)
                            const today = new Date();
                            const currentWeekStart = new Date(today);
                            const currentDay = today.getDay();
                            const daysToMonday = currentDay === 0 ? -6 : 1 - currentDay;
                            currentWeekStart.setDate(today.getDate() + daysToMonday);
                            currentWeekStart.setHours(0, 0, 0, 0);
                            
                            const currentWeekEnd = new Date(currentWeekStart);
                            currentWeekEnd.setDate(currentWeekStart.getDate() + 4); // Friday
                            currentWeekEnd.setHours(23, 59, 59, 999);
                            
                            const isCurrentWeek = day >= currentWeekStart && day <= currentWeekEnd;
                            
                            // Check if this is part of a consecutive phase group
                            const prevPhase = index > 0 ? getProjectPhaseForDate(project, allDays[index - 1]) : '';
                            const nextPhase = index < allDays.length - 1 ? getProjectPhaseForDate(project, allDays[index + 1]) : '';
                            
                            const isStartOfGroup = hasPhase && prevPhase !== phaseForDay;
                            const isEndOfGroup = hasPhase && nextPhase !== phaseForDay;
                            const isMiddleOfGroup = hasPhase && !isStartOfGroup && !isEndOfGroup;
                            
                            // Determine border radius based on position in group
                            let borderRadius = '';
                            if (hasPhase) {
                              if (isStartOfGroup && isEndOfGroup) {
                                borderRadius = 'rounded-full'; // Single day
                              } else if (isStartOfGroup) {
                                borderRadius = 'rounded-l-full'; // Start of group
                              } else if (isEndOfGroup) {
                                borderRadius = 'rounded-r-full'; // End of group
                              } else {
                                borderRadius = 'rounded-none'; // Middle of group
                              }
                            }
                            
                            return (
                              <td key={index} className="py-3 text-center h-16 align-middle w-[5.7%] relative" style={{ 
                                paddingLeft: isStartOfGroup ? '4px' : '0px', 
                                paddingRight: isEndOfGroup ? '4px' : '0px',
                                backgroundColor: isToday ? '#FEF3E2' : isCurrentWeek ? '#FFF7ED' : 'transparent' // Slightly darker orange for today, lighter for current week
                              }}>
                                {/* Daily divider line behind pills (except for last day) */}
                                {index < allDays.length - 1 && (
                                  <div className="absolute top-0 right-0 w-px h-full bg-gray-200" style={{ zIndex: 0 }}></div>
                                )}
                                {hasPhase ? (
                                  <div className="relative w-full h-8">
                                    {/* White background pill */}
                                    <div className={`absolute inset-0 w-full h-8 flex items-center justify-center text-[10px] font-medium ${borderRadius}`}
                                    style={{ 
                                      backgroundColor: '#FFFFFF',
                                      zIndex: 1
                                    }}>
                                    </div>
                                    {/* Transparent colored pill on top */}
                                    <div className={`absolute inset-0 w-full h-8 flex items-center justify-center text-[10px] font-medium ${borderRadius}`}
                                    style={{ 
                                      backgroundColor: isArchived ? '#6B7280' : `${getSolidPhaseColor(phaseForDay)}AA`,
                                      color: isArchived ? '#6B7280' : getSolidPhaseColor(phaseForDay),
                                      zIndex: 2 // Ensure colored pill appears above white background
                                    }}
                                    title={`${phaseForDay} - ${day.toLocaleDateString()}`}>
                                      {/* Key date icons */}
                                      {phaseForDay === 'Fielding' && isStartOfGroup && (
                                        <svg className="w-5 h-5 text-white drop-shadow-sm" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24">
                                          <path d="M4 13a8 8 0 0 1 7 7a6 6 0 0 0 3 -5a9 9 0 0 0 6 -8a3 3 0 0 0 -3 -3a9 9 0 0 0 -8 6a6 6 0 0 0 -5 3" />
                                          <path d="M7 14a6 6 0 0 0 -3 6a6 6 0 0 0 6 -3" />
                                        </svg>
                                      )}
                                      {phaseForDay === 'Reporting' && isEndOfGroup && (
                                        <svg className="w-5 h-5 text-white drop-shadow-sm" fill="currentColor" viewBox="0 0 24 24">
                                          <path d="M14,2H6A2,2 0 0,0 4,4V20A2,2 0 0,0 6,22H18A2,2 0 0,0 20,20V8L14,2M18,20H6V4H13V9H18V20Z"/>
                                        </svg>
                                      )}
                                    </div>
                                  </div>
                                ) : (
                                  <div className="w-full h-8"></div>
                                )}
                              </td>
                            );
                          })}
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>
      )}

        {/* Project Update Modal */}
        {projectUpdateModal.show && projectUpdateModal.project && projectUpdateModal.update && createPortal(
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-[10101]" style={{ top: 0, left: 0, right: 0, bottom: 0 }}>
            <div className="bg-white rounded-lg shadow-xl max-w-2xl w-full mx-4 max-h-[80vh] overflow-hidden flex flex-col">
              <div className="px-6 py-4 border-b border-gray-200 flex items-center justify-between" style={{ backgroundColor: BRAND.orange }}>
                <h3 className="text-lg font-semibold text-white">Project Update: {projectUpdateModal.project.name}</h3>
                <button
                  onClick={() => setProjectUpdateModal({ show: false, project: null, update: null })}
                  className="text-white hover:text-gray-200 transition-colors"
                  aria-label="Close"
                >
                  <XMarkIcon className="h-6 w-6" />
                </button>
              </div>
              <div className="px-6 py-4 overflow-y-auto flex-1">
                <div className="prose max-w-none">
                  {projectUpdateModal.update.split('\n').map((line, index) => {
                    if (line.trim() === '') {
                      // Empty lines
                      return <div key={index} className="h-2"></div>;
                    } else if (line.trim() === '[DIVIDER]') {
                      // Divider line
                      return <hr key={index} className="my-3 border-gray-300" />;
                    } else if (line.startsWith('[PHASE]')) {
                      // Phase lines with special styling
                      const phaseMatch = line.match(/\[PHASE\]\s*(.+?)\|(.+?)\|(.+)/);
                      if (phaseMatch) {
                        const [, phaseType, phaseName, dateRange] = phaseMatch;
                        const phaseColor = PHASE_COLORS[phaseName] || '#6B7280';
                        
                        // Check if this is the first phase (Current Phase) and if there's an upcoming phase next
                        const updateLines = projectUpdateModal.update.split('\n');
                        const nextLine = updateLines[index + 1];
                        const isCurrentPhase = phaseType.includes('Current');
                        
                        // Alternative approach: search for upcoming phase in the entire text
                        const upcomingPhaseLine = updateLines.find(line => 
                          line.startsWith('[PHASE]') && line.includes('Upcoming Phase')
                        );
                        const hasUpcomingPhase = isCurrentPhase && upcomingPhaseLine;
                        
                        // Debug logging
                        console.log('Phase rendering debug:', {
                          phaseType,
                          isCurrentPhase,
                          hasUpcomingPhase,
                          nextLine: nextLine?.substring(0, 100),
                          upcomingPhaseLine: upcomingPhaseLine?.substring(0, 100),
                          currentLine: line.substring(0, 100),
                          index,
                          totalLines: updateLines.length,
                          allLines: updateLines.slice(index - 1, index + 3)
                        });
                        
                        if (isCurrentPhase && hasUpcomingPhase) {
                          // Render both phases side by side
                          const upcomingMatch = upcomingPhaseLine.match(/\[PHASE\]\s*(.+?)\|(.+?)\|(.+)/);
                          const upcomingPhaseName = upcomingMatch ? upcomingMatch[2] : '';
                          const upcomingDateRange = upcomingMatch ? upcomingMatch[3] : '';
                          const upcomingPhaseColor = PHASE_COLORS[upcomingPhaseName] || '#6B7280';
                          
                          return (
                            <div key={index} className="flex gap-4 mb-2">
                              {/* Current Phase */}
                              <div className="flex-1 p-3 bg-gray-50 rounded-lg">
                                <div className="flex items-center gap-2 mb-1">
                                  <span className="text-sm font-medium text-gray-900">{phaseType}</span>
                                  <span
                                    className="inline-flex items-center justify-center w-24 px-0.5 sm:px-1 md:px-2 py-1 rounded-full text-xs font-medium text-white"
                                    style={{ 
                                      backgroundColor: phaseColor,
                                      opacity: 0.6
                                    }}
                                  >
                                    {getPhaseDisplayName(phaseName)}
                                  </span>
                                </div>
                                <div className="text-xs text-gray-600">{dateRange}</div>
                              </div>
                              
                              {/* Upcoming Phase */}
                              <div className="flex-1 p-3 bg-gray-50 rounded-lg">
                                <div className="flex items-center gap-2 mb-1">
                                  <span className="text-sm font-medium text-gray-900">Upcoming Phase</span>
                                  <span
                                    className="inline-flex items-center justify-center w-24 px-0.5 sm:px-1 md:px-2 py-1 rounded-full text-xs font-medium text-white"
                                    style={{ 
                                      backgroundColor: upcomingPhaseColor,
                                      opacity: 0.6
                                    }}
                                  >
                                    {getPhaseDisplayName(upcomingPhaseName)}
                                  </span>
                                </div>
                                <div className="text-xs text-gray-600">{upcomingDateRange}</div>
                              </div>
                            </div>
                          );
                        } else if (isCurrentPhase && !hasUpcomingPhase) {
                          // Only current phase, render normally
                          return (
                            <div key={index} className="flex items-center gap-3 p-3 bg-gray-50 rounded-lg mb-2">
                              <div className="flex-1">
                                <div className="flex items-center gap-2 mb-1">
                                  <span className="text-sm font-medium text-gray-900">{phaseType}</span>
                                  <span
                                    className="inline-flex items-center justify-center w-24 px-0.5 sm:px-1 md:px-2 py-1 rounded-full text-xs font-medium text-white"
                                    style={{ 
                                      backgroundColor: phaseColor,
                                      opacity: 0.6
                                    }}
                                  >
                                    {getPhaseDisplayName(phaseName)}
                                  </span>
                                </div>
                                <div className="text-xs text-gray-600">{dateRange}</div>
                              </div>
                            </div>
                          );
                        } else if (phaseType.includes('Upcoming')) {
                          // Skip upcoming phase as it's already rendered with current phase
                          return null;
                        }
                        
                        // Fallback for other cases
                        return (
                          <div key={index} className="flex items-center gap-3 p-3 bg-gray-50 rounded-lg mb-2">
                            <div className="flex-1">
                              <div className="flex items-center gap-2 mb-1">
                                <span className="text-sm font-medium text-gray-900">{phaseType}</span>
                                <span
                                  className="inline-flex items-center justify-center w-24 px-0.5 sm:px-1 md:px-2 py-1 rounded-full text-xs font-medium text-white"
                                  style={{ 
                                    backgroundColor: phaseColor,
                                    opacity: 0.6
                                  }}
                                >
                                  {getPhaseDisplayName(phaseName)}
                                </span>
                              </div>
                              <div className="text-xs text-gray-600">{dateRange}</div>
                            </div>
                          </div>
                        );
                      }
                    } else if (line.startsWith('[TASK]')) {
                      // Task lines with box styling
                      const taskMatch = line.match(/\[TASK\]\s*(.+?)\|(.+?)\|(.+?)\|(.+)/);
                      if (taskMatch) {
                        const [, description, projectName, dueDateOrAssigned, assigned] = taskMatch;
                        const assignedToShow = assigned || dueDateOrAssigned;
                        const dueDateToShow = assigned ? dueDateOrAssigned : null;

                        return (
                          <div key={index} className="flex items-center justify-between p-2 bg-gray-50 rounded-lg mb-1">
                            <div className="flex-1 min-w-0">
                              <div className="text-xs font-medium text-gray-900 truncate">
                                {description}
                              </div>
                              <div className="text-[10px] text-gray-500 truncate">
                                {assignedToShow}
                              </div>
                            </div>
                            {dueDateToShow && (
                              <div className="flex-shrink-0 ml-2 text-right">
                                <div className="text-xs text-gray-600">
                                  {dueDateToShow}
                                </div>
                              </div>
                            )}
                          </div>
                        );
                      }
                    } else if (line.startsWith('[KEYDATE]')) {
                      // Key date lines with task-like styling
                      const keyDateMatch = line.match(/\[KEYDATE\]\s*(.+?)\|(.+)/);
                      if (keyDateMatch) {
                        const [, label, date] = keyDateMatch;

                        return (
                          <div key={index} className="flex items-center justify-between p-2 bg-gray-50 rounded-lg mb-1">
                            <div className="flex-1 min-w-0">
                              <div className="text-xs font-medium text-gray-900 truncate">
                                {label}
                              </div>
                            </div>
                            <div className="flex-shrink-0 ml-2 text-right">
                              <div className="text-xs text-gray-600">
                                {date}
                              </div>
                            </div>
                          </div>
                        );
                      }
                    } else if (line.startsWith('[ICON:')) {
                      // Icon lines with special styling
                      const iconMatch = line.match(/\[ICON:(\w+)\]\s*(.+)/);
                      if (iconMatch) {
                        const [, iconType, content] = iconMatch;
                        let iconColor = 'text-blue-500';
                        if (iconType === 'kickoff') iconColor = 'text-gray-500';
                        else if (iconType === 'fieldwork') iconColor = 'text-purple-500';
                        else if (iconType === 'report') iconColor = 'text-red-500';
                        
                        return (
                          <div key={index} className="flex items-center gap-2 p-2 bg-gray-50 rounded-lg mb-1">
                            <div className={`w-2 h-2 rounded-full ${iconColor.replace('text-', 'bg-')}`}></div>
                            <span className="text-sm text-gray-700">{content}</span>
                          </div>
                        );
                      }
                    } else if (line.startsWith('http')) {
                      // File links
                      const fileUrl = line.trim();
                      const fileName = fileUrl.split('/').pop() || 'File';
                      const fileExtension = fileName.split('.').pop()?.toLowerCase() || '';
                      
                      let fileIcon;
                      switch (fileExtension) {
                        case 'pdf':
                          fileIcon = <DocumentIcon className="h-4 w-4 text-red-600" />;
                          break;
                        case 'doc':
                        case 'docx':
                          fileIcon = <DocumentIcon className="h-4 w-4 text-blue-600" />;
                          break;
                        case 'xls':
                        case 'xlsx':
                          fileIcon = <DocumentIcon className="h-4 w-4 text-green-600" />;
                          break;
                        case 'ppt':
                        case 'pptx':
                          fileIcon = <DocumentIcon className="h-4 w-4 text-orange-600" />;
                          break;
                        default:
                          fileIcon = <DocumentIcon className="h-4 w-4 text-gray-600" />;
                      }

                      return (
                        <a
                          key={index}
                          href={fileUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="flex items-center gap-2 p-2 bg-gray-50 rounded-lg hover:bg-gray-100 mb-1 transition-colors"
                        >
                          {fileIcon}
                          <span className="text-sm text-gray-900">{fileName}</span>
                          <ArrowTopRightOnSquareIcon className="h-3 w-3 text-gray-400 ml-auto" />
                        </a>
                      );
                    } else if (line.startsWith('*') && line.endsWith('*') && !line.includes('**')) {
                      // Italic lines (date ranges) - make sure it's not a bold line
                      const text = line.replace(/\*/g, '');
                      return <p key={index} className="text-xs italic text-gray-500 mb-1">{text}</p>;
                    } else if (line.includes('**')) {
                      // Line with bold text - parse inline bold
                      const parts = line.split('**');
                      return (
                        <p key={index} className="text-sm text-gray-700 mb-1">
                          {parts.map((part, i) => {
                            // Every odd index is bold (between ** markers)
                            if (i % 2 === 1) {
                              return <strong key={i} className="font-semibold text-black">{part}</strong>;
                            }
                            return <span key={i}>{part}</span>;
                          })}
                        </p>
                      );
                    } else if (line.startsWith('•')) {
                      // Bullet points
                      return <p key={index} className="text-sm text-gray-700 ml-4 mb-1">{line}</p>;
                    } else {
                      // Regular text
                      return <p key={index} className="text-sm text-gray-700 mb-1">{line}</p>;
                    }
                  })}
                </div>
              </div>
            </div>
          </div>
        , document.body)}
    </div>
  );
}

function ProjectForm({ 
  project, 
  onSave, 
  onCancel 
}: { 
  project: Project | null; 
  onSave: (project: Project) => void; 
  onCancel: () => void; 
}) {
  const [formData, setFormData] = useState({
    name: project?.name || "",
    client: project?.client || "",
    phase: project?.phase || "Kickoff" as Phase,
    methodology: project?.methodology || "ATU (Awareness, Trial, Usage)" as Methodology,
    startDay: project?.startDay || 0,
    endDay: project?.endDay || 30,
    deadline: project?.deadline || 30,
    nextDeadline: project?.nextDeadline || "",
    keyDeadlines: project?.keyDeadlines?.map(deadline => ({
      ...deadline,
      date: formatDateForInput(deadline.date)
    })) || [],
    tasks: project?.tasks || [],
    teamMembers: project?.teamMembers || [],
  });

  const [newDeadline, setNewDeadline] = useState({ label: "", date: "" });
  const [newTask, setNewTask] = useState<{ description: string; assignedTo: string[]; status: Task['status']; dueDate: string }>({ description: "", assignedTo: [], status: "pending", dueDate: "" });
  const [newTeamMember, setNewTeamMember] = useState({ name: "", email: "" });
  const [showNewDeadline, setShowNewDeadline] = useState(false);
  const [showNewTask, setShowNewTask] = useState(false);
  const [showNewTeamMember, setShowNewTeamMember] = useState(false);
  const [showDatePickerForTask, setShowDatePickerForTask] = useState(false);
  const [selectedTaskForDate, setSelectedTaskForDate] = useState<string | null>(null);
  const [showAssignmentDropdownForm, setShowAssignmentDropdownForm] = useState<string | null>(null);

  // Close assignment dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (showAssignmentDropdownForm) {
        const target = event.target as Element;
        if (!target.closest('.assignment-dropdown-form')) {
          setShowAssignmentDropdownForm(null);
        }
      }
    };

    if (showAssignmentDropdownForm) {
      document.addEventListener('mousedown', handleClickOutside);
    }

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [showAssignmentDropdownForm]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const projectData: Project = {
      id: project?.id || `P-${Date.now()}`,
      ...formData,
      keyDeadlines: formData.keyDeadlines.map(deadline => ({
        ...deadline,
        date: formatDateForDisplay(deadline.date)
      })),
      files: project?.files || []
    };
    onSave(projectData);
  };


  const addDeadline = () => {
    if (newDeadline.label.trim() && newDeadline.date.trim()) {
      setFormData(prev => ({
        ...prev,
        keyDeadlines: [...prev.keyDeadlines, newDeadline]
      }));
      setNewDeadline({ label: "", date: "" });
      setShowNewDeadline(false);
    }
  };

  const removeDeadline = (index: number) => {
    setFormData(prev => ({
      ...prev,
      keyDeadlines: prev.keyDeadlines.filter((_, i) => i !== index)
    }));
  };

  const addTask = () => {
    if (newTask.description.trim()) {
      const task: Task = {
        id: `task-${Date.now()}`,
        description: newTask.description,
        assignedTo: newTask.assignedTo.length > 0 ? newTask.assignedTo : undefined,
        status: newTask.status,
        dueDate: (newTask as any).isOngoing ? undefined : (newTask.dueDate && newTask.dueDate.trim() ? newTask.dueDate : null),
        isOngoing: (newTask as any).isOngoing || false
      };
      setFormData(prev => ({
        ...prev,
        tasks: [...prev.tasks, task]
      }));
      setNewTask({ description: "", assignedTo: [], status: "pending", dueDate: "", isOngoing: false });
      setShowNewTask(false);
    }
  };

  const removeTask = (taskId: string) => {
    setFormData(prev => ({
      ...prev,
      tasks: prev.tasks.filter(task => task.id !== taskId)
    }));
  };

  const addTeamMember = () => {
    if (newTeamMember.name.trim() && newTeamMember.email.trim()) {
      const teamMember: TeamMember = {
        id: `tm-${Date.now()}`,
        name: newTeamMember.name,
        email: newTeamMember.email
      };
      setFormData(prev => ({
        ...prev,
        teamMembers: [...prev.teamMembers, teamMember]
      }));
      setNewTeamMember({ name: "", email: "" });
      setShowNewTeamMember(false);
    }
  };

  const removeTeamMember = (memberId: string) => {
    setFormData(prev => ({
      ...prev,
      teamMembers: prev.teamMembers.filter(member => member.id !== memberId)
    }));
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-start justify-center overflow-y-auto py-8 z-[9999] p-4">
      <div className="bg-white rounded-3xl max-w-4xl w-full max-h-[90vh] overflow-y-auto">
        <div className="p-6">
          <div className="flex items-center justify-between mb-6">
            <h3 className="text-xl font-semibold">
              {project ? "Edit Project" : "Create New Project"}
            </h3>
            <button
              onClick={onCancel}
              className="text-gray-400 hover:text-gray-600"
            >
              <svg className="h-6 w-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          <form onSubmit={handleSubmit} className="space-y-6">
            {/* Basic Info */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium mb-2">Project Name</label>
                <input
                  type="text"
                  required
                  value={formData.name}
                  onChange={(e) => setFormData(prev => ({ ...prev, name: e.target.value }))}
                  className="w-full border rounded-xl px-3 py-2 outline-none focus:ring-2 focus:ring-orange-200"
                />
              </div>
              <div>
                <label className="block text-sm font-medium mb-2">Client</label>
                <input
                  type="text"
                  required
                  value={formData.client}
                  onChange={(e) => setFormData(prev => ({ ...prev, client: e.target.value }))}
                  className="w-full border rounded-xl px-3 py-2 outline-none focus:ring-2 focus:ring-orange-200"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 gap-4">
              <div>
                <label className="block text-sm font-medium mb-2">Methodology</label>
                <select
                  value={formData.methodology}
                  onChange={(e) => setFormData(prev => ({ ...prev, methodology: e.target.value as Methodology }))}
                  className="w-full border rounded-xl px-3 py-2 outline-none focus:ring-2 focus:ring-orange-200"
                >
                  {METHODOLOGIES.map(methodology => (
                    <option key={methodology} value={methodology}>{methodology}</option>
                  ))}
                </select>
              </div>
            </div>


            {/* Key Dates */}
            <div>
              <label className="block text-sm font-medium mb-2">Key Dates</label>
              <div className="space-y-2">
                {formData.keyDeadlines.map((deadline, index) => (
                  <div key={index} className="flex items-center gap-2">
                    <input
                      type="date"
                      value={deadline.date}
                      onChange={(e) => {
                        const newDeadlines = [...formData.keyDeadlines];
                        newDeadlines[index] = { ...deadline, date: e.target.value };
                        setFormData(prev => ({ ...prev, keyDeadlines: newDeadlines }));
                      }}
                      className="w-24 sm:w-32 md:w-40 border rounded-xl px-3 py-2 outline-none focus:ring-2 focus:ring-orange-200"
                    />
                    <input
                      type="text"
                      value={deadline.label}
                      onChange={(e) => {
                        const newDeadlines = [...formData.keyDeadlines];
                        newDeadlines[index] = { ...deadline, label: e.target.value };
                        setFormData(prev => ({ ...prev, keyDeadlines: newDeadlines }));
                      }}
                      placeholder="Deadline description..."
                      className="flex-1 border rounded-xl px-3 py-2 outline-none focus:ring-2 focus:ring-orange-200"
                    />
                    <button
                      type="button"
                      onClick={() => removeDeadline(index)}
                      className="text-red-500 hover:text-red-700"
                    >
                      <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                      </svg>
                    </button>
                  </div>
                ))}
                {showNewDeadline && (
                  <div className="flex items-center gap-2">
                    <input
                      type="date"
                      value={newDeadline.date}
                      onChange={(e) => setNewDeadline(prev => ({ ...prev, date: e.target.value }))}
                      className="w-24 sm:w-32 md:w-40 border rounded-xl px-3 py-2 outline-none focus:ring-2 focus:ring-orange-200"
                    />
                    <input
                      type="text"
                      value={newDeadline.label}
                      onChange={(e) => setNewDeadline(prev => ({ ...prev, label: e.target.value }))}
                      placeholder="New deadline description..."
                      className="flex-1 border rounded-xl px-3 py-2 outline-none focus:ring-2 focus:ring-orange-200"
                    />
                    <button
                      type="button"
                      onClick={addDeadline}
                      className="px-3 py-2 rounded-xl text-white"
                      style={{ background: BRAND.orange }}
                    >
                      Add
                    </button>
                  </div>
                )}
                <div className="flex justify-start">
                  <button
                    type="button"
                    onClick={() => setShowNewDeadline(true)}
                    className="px-4 py-2 text-sm border rounded-xl hover:bg-gray-50 transition-colors"
                  >
                    + Add Deadline
                  </button>
                </div>
              </div>
            </div>

            {/* Tasks */}
            <div>
              <label className="block text-sm font-medium mb-2">Tasks</label>
              <div className="space-y-2">
                {formData.tasks.map((task) => (
                  <div key={task.id} className="flex items-center gap-2">
                    <input
                      type="text"
                      value={task.description}
                      onChange={(e) => {
                        const newTasks = formData.tasks.map(t =>
                          t.id === task.id ? { ...t, description: e.target.value } : t
                        );
                        setFormData(prev => ({ ...prev, tasks: newTasks }));
                      }}
                      className="flex-1 border rounded-xl px-3 py-2 outline-none focus:ring-2 focus:ring-orange-200"
                    />
                    <div className="relative flex items-center gap-2 justify-self-center">
                      {task.assignedTo && task.assignedTo.filter(id => id && id.trim() !== '').length > 0 && (
                        <div className="flex items-center gap-1 flex-shrink-0">
                          {task.assignedTo.filter(id => id && id.trim() !== '').slice(0, 2).map((memberId) => (
                            <div key={memberId} className="w-6 h-6 rounded-full flex items-center justify-center text-white text-xs font-medium overflow-hidden" style={{ backgroundColor: getMemberColor(memberId, formData.teamMembers) }}>
                              <span className="truncate leading-none">{getInitials(formData.teamMembers.find(m => m.id === memberId)?.name || 'Unknown')}</span>
                            </div>
                          ))}
                          {task.assignedTo.filter(id => id && id.trim() !== '').length > 2 && (
                            <div className="relative group">
                              <span className="text-xs italic text-gray-500 ml-1 cursor-help">
                                +{task.assignedTo.filter(id => id && id.trim() !== '').length - 2}
                              </span>
                              <div className="absolute hidden group-hover:block bg-gray-800 text-white text-xs rounded p-2 whitespace-nowrap z-10 left-0 top-8">
                                {task.assignedTo.filter(id => id && id.trim() !== '').slice(2).map(id => formData.teamMembers.find(m => m.id === id)?.name || 'Unknown').join(', ')}
                              </div>
                            </div>
                          )}
                        </div>
                      )}
                      <button
                        type="button"
                        onClick={() => setShowAssignmentDropdownForm(showAssignmentDropdownForm === task.id ? null : task.id)}
                        className="w-6 h-6 rounded-full bg-white flex items-center justify-center text-gray-500 hover:text-gray-700 transition-colors"
                        title="Assign team members"
                      >
                        +
                      </button>
                      {showAssignmentDropdownForm === task.id && (
                        <div className="assignment-dropdown-form absolute left-0 top-10 z-50 bg-white border border-gray-300 rounded-lg shadow-lg p-2 min-w-[200px]">
                          <div className="space-y-1">
                            {formData.teamMembers.map(member => (
                              <label key={member.id} className="flex items-center gap-2 px-0.5 sm:px-1 md:px-2 py-1 hover:bg-gray-50 rounded cursor-pointer">
                                <input
                                  type="checkbox"
                                  checked={task.assignedTo?.includes(member.id) || false}
                                  onChange={(e) => {
                                    const currentAssigned = task.assignedTo || [];
                                    const newAssigned = e.target.checked
                                      ? [...currentAssigned, member.id]
                                      : currentAssigned.filter(id => id !== member.id);
                                    const newTasks = formData.tasks.map(t =>
                                      t.id === task.id ? { ...t, assignedTo: newAssigned.length > 0 ? newAssigned : undefined } : t
                                    );
                                    setFormData(prev => ({ ...prev, tasks: newTasks }));
                                  }}
                                  className="rounded border-gray-300"
                                />
                                <span className="text-sm">{member.name}</span>
                              </label>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                    <select
                      value={task.status}
                      onChange={(e) => {
                        const newTasks = formData.tasks.map(t =>
                          t.id === task.id ? { ...t, status: e.target.value as Task['status'] } : t
                        );
                        setFormData(prev => ({ ...prev, tasks: newTasks }));
                      }}
                      className="w-32 border rounded-xl px-3 py-2 outline-none focus:ring-2 focus:ring-orange-200"
                    >
                      <option value="pending">Pending</option>
                      <option value="in-progress">In Progress</option>
                      <option value="completed">Completed</option>
                    </select>
                    <button
                      type="button"
                      onClick={() => {
                        setSelectedTaskForDate(task.id);
                        setShowDatePickerForTask(true);
                      }}
                      className={`p-2 rounded-lg ${task.dueDate ? 'text-orange-600 ' : 'text-gray-400 hover:text-gray-600 hover:bg-gray-50'}`}
                      title={task.dueDate ? `Due: ${new Date(task.dueDate).toLocaleDateString()}` : 'Set due date'}
                    >
                      <CalendarIcon className="h-4 w-4" />
                    </button>
                    <button
                      type="button"
                      onClick={() => removeTask(task.id)}
                      className="text-red-500 hover:text-red-700"
                    >
                      <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                      </svg>
                    </button>
                  </div>
                ))}
                {showNewTask && (
                  <div className="flex items-center gap-2">
                    <input
                      type="text"
                      value={newTask.description}
                      onChange={(e) => setNewTask(prev => ({ ...prev, description: e.target.value }))}
                      placeholder="New task..."
                      className="flex-1 border rounded-xl px-3 py-2 outline-none focus:ring-2 focus:ring-orange-200"
                    />
                    <div className="relative flex items-center gap-2 justify-self-center">
                      {newTask.assignedTo && newTask.assignedTo.filter(id => id && id.trim() !== '').length > 0 && (
                        <div className="flex items-center gap-1 flex-shrink-0">
                          {newTask.assignedTo.filter(id => id && id.trim() !== '').slice(0, 2).map((memberId) => (
                            <div key={memberId} className="w-6 h-6 rounded-full flex items-center justify-center text-white text-xs font-medium overflow-hidden" style={{ backgroundColor: getMemberColor(memberId, formData.teamMembers) }}>
                              <span className="truncate leading-none">{getInitials(formData.teamMembers.find(m => m.id === memberId)?.name || 'Unknown')}</span>
                            </div>
                          ))}
                          {newTask.assignedTo.filter(id => id && id.trim() !== '').length > 2 && (
                            <div className="relative group">
                              <span className="text-xs italic text-gray-500 ml-1 cursor-help">
                                +{newTask.assignedTo.filter(id => id && id.trim() !== '').length - 2}
                              </span>
                              <div className="absolute hidden group-hover:block bg-gray-800 text-white text-xs rounded p-2 whitespace-nowrap z-10 left-0 top-8">
                                {newTask.assignedTo.filter(id => id && id.trim() !== '').slice(2).map(id => formData.teamMembers.find(m => m.id === id)?.name || 'Unknown').join(', ')}
                              </div>
                            </div>
                          )}
                        </div>
                      )}
                      <button
                        type="button"
                        onClick={() => setShowAssignmentDropdownForm(showAssignmentDropdownForm === 'newTask' ? null : 'newTask')}
                        className="w-6 h-6 rounded-full bg-white flex items-center justify-center text-gray-500 hover:text-gray-700 transition-colors"
                        title="Assign team members"
                      >
                        +
                      </button>
                      {showAssignmentDropdownForm === 'newTask' && (
                        <div className="assignment-dropdown-form absolute left-0 top-10 z-50 bg-white border border-gray-300 rounded-lg shadow-lg p-2 min-w-[200px]">
                          <div className="space-y-1">
                            {formData.teamMembers.map(member => (
                              <label key={member.id} className="flex items-center gap-2 px-0.5 sm:px-1 md:px-2 py-1 hover:bg-gray-50 rounded cursor-pointer">
                                <input
                                  type="checkbox"
                                  checked={newTask.assignedTo?.includes(member.id) || false}
                                  onChange={(e) => {
                                    const currentAssigned = newTask.assignedTo || [];
                                    const newAssigned = e.target.checked
                                      ? [...currentAssigned, member.id]
                                      : currentAssigned.filter(id => id !== member.id);
                                    setNewTask(prev => ({ ...prev, assignedTo: newAssigned }));
                                  }}
                                  className="rounded border-gray-300"
                                />
                                <span className="text-sm">{member.name}</span>
                              </label>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                    <select
                      value={newTask.status}
                      onChange={(e) => setNewTask(prev => ({ ...prev, status: e.target.value as Task['status'] }))}
                      className="w-32 border rounded-xl px-3 py-2 outline-none focus:ring-2 focus:ring-orange-200"
                    >
                      <option value="pending">Pending</option>
                      <option value="in-progress">In Progress</option>
                      <option value="completed">Completed</option>
                    </select>
                    <label className="flex items-center gap-1 text-xs">
                      <input
                        type="checkbox"
                        checked={(newTask as any).isOngoing || false}
                        onChange={(e) => setNewTask(prev => ({ ...prev, isOngoing: e.target.checked }))}
                        className="rounded"
                      />
                      <span>Ongoing</span>
                    </label>
                    {!((newTask as any).isOngoing) && (
                      <button
                        type="button"
                        onClick={() => {
                          setSelectedTaskForDate('newTask');
                          setShowDatePickerForTask(true);
                        }}
                        className={`p-2 rounded-lg ${newTask.dueDate ? 'text-orange-600 ' : 'text-gray-400 hover:text-gray-600 hover:bg-gray-50'}`}
                        title={newTask.dueDate ? `Due: ${new Date(newTask.dueDate).toLocaleDateString()}` : 'Set due date'}
                      >
                        <CalendarIcon className="h-4 w-4" />
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={addTask}
                      className="px-3 py-2 rounded-xl text-white"
                      style={{ background: BRAND.orange }}
                    >
                      Add
                    </button>
                  </div>
                )}
                <div className="flex justify-start">
                  <button
                    type="button"
                    onClick={() => setShowNewTask(true)}
                    className="px-4 py-2 text-sm border rounded-xl hover:bg-gray-50 transition-colors"
                  >
                    + Add Task
                  </button>
                </div>
              </div>
            </div>

            {/* Project Team */}
            <div>
              <label className="block text-sm font-medium mb-2">Project Team</label>
              <div className="space-y-2">
                {formData.teamMembers.map((member) => (
                  <div key={member.id} className="flex items-center gap-2">
                    <input
                      type="text"
                      value={member.name}
                      onChange={(e) => {
                        const newMembers = formData.teamMembers.map(m => 
                          m.id === member.id ? { ...m, name: e.target.value } : m
                        );
                        setFormData(prev => ({ ...prev, teamMembers: newMembers }));
                      }}
                      placeholder="Name"
                      className="w-24 sm:w-32 md:w-40 border rounded-xl px-3 py-2 outline-none focus:ring-2 focus:ring-orange-200"
                    />
                    <input
                      type="email"
                      value={member.email}
                      onChange={(e) => {
                        const newMembers = formData.teamMembers.map(m => 
                          m.id === member.id ? { ...m, email: e.target.value } : m
                        );
                        setFormData(prev => ({ ...prev, teamMembers: newMembers }));
                      }}
                      placeholder="Email"
                      className="flex-1 border rounded-xl px-3 py-2 outline-none focus:ring-2 focus:ring-orange-200"
                    />
                    <button
                      type="button"
                      onClick={() => removeTeamMember(member.id)}
                      className="text-red-500 hover:text-red-700"
                    >
                      <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                      </svg>
                    </button>
                  </div>
                ))}
                {showNewTeamMember && (
                  <div className="flex items-center gap-2">
                    <input
                      type="text"
                      value={newTeamMember.name}
                      onChange={(e) => setNewTeamMember(prev => ({ ...prev, name: e.target.value }))}
                      placeholder="Name"
                      className="w-24 sm:w-32 md:w-40 border rounded-xl px-3 py-2 outline-none focus:ring-2 focus:ring-orange-200"
                    />
                    <input
                      type="email"
                      value={newTeamMember.email}
                      onChange={(e) => setNewTeamMember(prev => ({ ...prev, email: e.target.value }))}
                      placeholder="Email"
                      className="flex-1 border rounded-xl px-3 py-2 outline-none focus:ring-2 focus:ring-orange-200"
                    />
                    <button
                      type="button"
                      onClick={addTeamMember}
                      className="px-3 py-2 rounded-xl text-white"
                      style={{ background: BRAND.orange }}
                    >
                      Add
                    </button>
                  </div>
                )}
                <div className="flex justify-start">
                  <button
                    type="button"
                    onClick={() => setShowNewTeamMember(true)}
                    className="px-4 py-2 text-sm border rounded-xl hover:bg-gray-50 transition-colors"
                  >
                    + Add Team Member
                  </button>
                </div>
              </div>
            </div>

            {/* Form Actions */}
            <div className="flex justify-end gap-3 pt-4 border-t">
              <button
                type="button"
                onClick={onCancel}
                className="px-4 py-2 border rounded-xl hover:bg-gray-50"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="px-4 py-2 rounded-xl text-white"
                style={{ background: BRAND.orange }}
              >
                {project ? "Update Project" : "Create Project"}
              </button>
            </div>
          </form>
        </div>
      </div>

      {/* Calendar Picker Modal for Tasks */}
      {showDatePickerForTask && selectedTaskForDate && (
        <CalendarPicker
          selectedDate={selectedTaskForDate === 'newTask' ? newTask.dueDate : (formData.tasks.find(t => t.id === selectedTaskForDate)?.dueDate || '')}
          onDateSelect={(date) => {
            if (selectedTaskForDate === 'newTask') {
              setNewTask(prev => ({ ...prev, dueDate: date }));
            } else {
              const newTasks = formData.tasks.map(t =>
                t.id === selectedTaskForDate ? { ...t, dueDate: date } : t
              );
              setFormData(prev => ({ ...prev, tasks: newTasks }));
            }
            setShowDatePickerForTask(false);
            setSelectedTaskForDate(null);
          }}
          onClose={() => {
                  setShowDatePickerForTask(false);
                  setSelectedTaskForDate(null);
                }}
          title="Set Due Date"
        />
      )}
    </div>
  );
}

function ProjectDashboard({ project, onEdit, onArchive, setProjects, onProjectUpdate, savedContentAnalyses = [], setRoute, setAnalysisToLoad, setIsLoadingProjectFile }: { project: Project; onEdit: () => void; onArchive: (projectId: string) => void; setProjects?: (projects: Project[] | ((prev: Project[]) => Project[])) => void; onProjectUpdate?: (project: Project) => void; savedContentAnalyses?: any[]; setRoute?: (route: string) => void; setAnalysisToLoad?: (analysisId: string | null) => void; setIsLoadingProjectFile?: (loading: boolean) => void }) {
  const { user } = useAuth();

  // Helper function for authentication headers
  const getAuthHeaders = useCallback(() => {
    const token = localStorage.getItem('cognitive_dash_token');
    return token ? { Authorization: `Bearer ${token}` } : { Authorization: '' };
  }, []);

  // Function to get current phase based on today's date
  const getCurrentPhase = (project: Project): string => {
    if (!project.segments || project.segments.length === 0) {
      return project.phase; // Fallback to stored phase
    }

    const today = new Date();
    const todayStr = today.toISOString().split('T')[0]; // YYYY-MM-DD format

    // Find which phase today falls into
    for (const segment of project.segments) {
      if (todayStr >= segment.startDate && todayStr <= segment.endDate) {
        return segment.phase;
      }
    }

    // If today is before the first phase, return the first phase
    if (todayStr < project.segments[0].startDate) {
      return project.segments[0].phase;
    }

    // If today is after the last phase, return the last phase
    if (todayStr > project.segments[project.segments.length - 1].endDate) {
      return project.segments[project.segments.length - 1].phase;
    }

    return project.phase; // Fallback
  };

  // Edit modal states
  const [showProjectNameEdit, setShowProjectNameEdit] = useState(false);
  const [showClientEdit, setShowClientEdit] = useState(false);
  const [showMethodologyEdit, setShowMethodologyEdit] = useState(false);
  const [showModeratorEdit, setShowModeratorEdit] = useState(false);
  const [showSampleDetailsEdit, setShowSampleDetailsEdit] = useState(false);
  
  // Client edit state
  const [selectedProjectName, setSelectedProjectName] = useState(project.name || '');
  const [existingClients, setExistingClients] = useState<string[]>([]);
  const [selectedClient, setSelectedClient] = useState(project.client || '');
  
  // Methodology edit state
  const [selectedMethodology, setSelectedMethodology] = useState(project.methodology || '');
  
  // Moderator edit state
  const [moderators, setModerators] = useState<any[]>([]);
  const [selectedModerator, setSelectedModerator] = useState(project.moderator || '');
  const [moderatorSearchTerm, setModeratorSearchTerm] = useState('');
  const [availableModerators, setAvailableModerators] = useState<any[]>([]);
  const [conflictedModerators, setConflictedModerators] = useState<any[]>([]);
  
  // Sample details edit state
  const [sampleSize, setSampleSize] = useState(project.sampleSize || 0);
  const [subgroups, setSubgroups] = useState<Array<{id: string, name: string, size: number}>>(project.subgroups || []);
  
  // Storytelling data state
  const [storytellingData, setStorytellingData] = useState<any>(null);
  const [storytellingLoading, setStorytellingLoading] = useState(false);

  // Load existing clients from all projects
  useEffect(() => {
    const loadExistingClients = async () => {
      try {
        const response = await fetch(`${API_BASE_URL}/api/projects/all`, {
          headers: { 'Authorization': `Bearer ${localStorage.getItem('cognitive_dash_token')}` }
        });
        if (response.ok) {
          const data = await response.json();
          const allProjects = data.projects || [];
          const clients = new Set<string>();
          
          allProjects.forEach((p: Project) => {
            if (p.client && p.client.trim()) {
              clients.add(p.client.trim());
            }
          });
          
          setExistingClients(Array.from(clients).sort());
        }
      } catch (error) {
        console.error('Error loading existing clients:', error);
      }
    };
    
    loadExistingClients();
  }, []);

  // Load moderators
  useEffect(() => {
    const loadModerators = async () => {
      try {
        const response = await fetch(`${API_BASE_URL}/api/moderators`, {
          headers: { 'Authorization': `Bearer ${localStorage.getItem('cognitive_dash_token')}` }
        });
        if (response.ok) {
          const data = await response.json();
          setModerators(data.moderators || []);
        }
      } catch (error) {
        console.error('Error loading moderators:', error);
      }
    };
    
    loadModerators();
  }, []);

  // Helper function to format dates consistently with the rest of the app
  const formatDateForDisplay = (dateString: string | undefined): string => {
    if (!dateString) return 'Invalid Date';

    try {
      // Parse the date string - handle YYYY-MM-DD format consistently using UTC
      const [year, month, day] = dateString.split('-');
      const date = new Date(Date.UTC(parseInt(year), parseInt(month) - 1, parseInt(day)));

      // Check if the date is valid
      if (isNaN(date.getTime())) {
        return 'Invalid Date';
      }

      // Format as M/D/YY using UTC methods to match key deadlines (no leading zeros)
      const monthNum = date.getUTCMonth() + 1;
      const dayNum = date.getUTCDate();
      const yearShort = date.getUTCFullYear().toString().slice(-2);

      return `${monthNum}/${dayNum}/${yearShort}`;
    } catch (error) {
      console.error('Error formatting date:', error);
      return 'Invalid Date';
    }
  };

  // Helper function to get start and end of current week
  const getThisWeekRange = () => {
    const today = new Date();
    const dayOfWeek = today.getDay();
    const diff = today.getDate() - dayOfWeek + (dayOfWeek === 0 ? -6 : 1); // Adjust when day is Sunday
    const monday = new Date(today.setDate(diff));
    monday.setHours(0, 0, 0, 0);

    const friday = new Date(monday);
    friday.setDate(monday.getDate() + 4);
    friday.setHours(23, 59, 59, 999);

    return { monday, friday };
  };

  // Helper function to get tasks due this week
  const getTasksDueThisWeek = () => {
    const { monday, friday } = getThisWeekRange();
    const todayStr = new Date().toISOString().split('T')[0];

    return projectTasks
      .filter(task => {
        if (!task.dueDate) return false;
        const taskDate = new Date(task.dueDate + 'T00:00:00');
        return taskDate >= monday && taskDate <= friday;
      })
      .sort((a, b) => {
        // Sort by: 1) Overdue first, 2) Today's tasks, 3) incomplete before completed, 4) date
        const aDate = new Date(a.dueDate! + 'T00:00:00');
        const bDate = new Date(b.dueDate! + 'T00:00:00');
        const aIsToday = a.dueDate === todayStr;
        const bIsToday = b.dueDate === todayStr;
        const aIsOverdue = isTaskOverdue(a);
        const bIsOverdue = isTaskOverdue(b);

        if (aIsOverdue && !bIsOverdue) return -1;
        if (!aIsOverdue && bIsOverdue) return 1;

        if (aIsToday && !bIsToday) return -1;
        if (!aIsToday && bIsToday) return 1;

        if (a.status === 'completed' && b.status !== 'completed') return 1;
        if (a.status !== 'completed' && b.status === 'completed') return -1;

        return aDate.getTime() - bDate.getTime();
      })
      .slice(0, 5);
  };

  // Helper function to get next phase
  const getNextPhase = () => {
    if (!project.segments || project.segments.length === 0) return null;

    const todayStr = new Date().toISOString().split('T')[0];
    const currentPhaseSegment = project.segments.find(
      segment => todayStr >= segment.startDate && todayStr <= segment.endDate
    );

    if (!currentPhaseSegment) return null;
    if (currentPhaseSegment.phase === 'Reporting') return null; // Don't show if in Reporting

    const currentIndex = project.segments.indexOf(currentPhaseSegment);
    if (currentIndex >= 0 && currentIndex < project.segments.length - 1) {
      const nextSegment = project.segments[currentIndex + 1];
      return {
        phase: nextSegment.phase,
        startDate: nextSegment.startDate
      };
    }

    return null;
  };

  // Helper function to get next key date
  const getNextKeyDate = () => {
    const todayStr = new Date().toISOString().split('T')[0];

    return projectKeyDates
      .map(keyDate => {
        // Safety check for keyDate.date
        if (!keyDate.date || typeof keyDate.date !== 'string') {
          console.warn('Invalid keyDate.date:', keyDate.date);
          return null;
        }
        
        let dateStr: string;

        if (keyDate.date.includes('/')) {
          // MM/DD/YY format - convert to YYYY-MM-DD
          const [month, day, year] = keyDate.date.split('/');
          const fullYear = parseInt(year) < 50 ? 2000 + parseInt(year) : 1900 + parseInt(year);
          dateStr = `${fullYear}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
        } else if (keyDate.date.includes('-')) {
          // Already in YYYY-MM-DD format
          dateStr = keyDate.date;
        } else {
          return null;
        }

        return { ...keyDate, dateStr };
      })
      .filter(keyDate => keyDate && keyDate.dateStr >= todayStr)
      .sort((a, b) => a!.dateStr.localeCompare(b!.dateStr))[0] || null;
  };

  const currentPhase = getCurrentPhase(project);
  const phaseColor = PHASE_COLORS[currentPhase] || PHASE_COLORS['Kickoff'];
  
  // Safety check to ensure project is valid
  if (!project || !project.id) {
    return <div className="p-4 text-center text-gray-500">Loading project...</div>;
  }
  const [showAddTask, setShowAddTask] = useState(false);
  const [newTask, setNewTask] = useState({ description: "", assignedTo: [] as string[], status: "pending" as Task['status'], dueDate: "" });
  const [currentMonth, setCurrentMonth] = useState(new Date());
  const [showFullCalendar, setShowFullCalendar] = useState(true);
  const [editingTimeline, setEditingTimeline] = useState(false);
  const [editingSegments, setEditingSegments] = useState(project.segments || []);
  const [activePhase, setActivePhase] = useState(getCurrentPhase(project));
  const [projectTasks, setProjectTasks] = useState(project.tasks || []);
  const [showAllTasks, setShowAllTasks] = useState(false);
  const [maxVisibleTasks, setMaxVisibleTasks] = useState(8);
  const taskContainerRef = useRef<HTMLDivElement>(null);
  const [showCalendarDropdown, setShowCalendarDropdown] = useState(false);
  const [selectedTaskForDate, setSelectedTaskForDate] = useState<string | null>(null);
  const [showDatePickerForTaskInDashboard, setShowDatePickerForTaskInDashboard] = useState(false);
  const [selectedTaskForDateInDashboard, setSelectedTaskForDateInDashboard] = useState<string | null>(null);
  const [showAssignmentDropdown, setShowAssignmentDropdown] = useState<string | null>(null);
  const [assignmentDropdownPosition, setAssignmentDropdownPosition] = useState<{top: number, left: number} | null>(null);
  const [calendarDropdownPosition, setCalendarDropdownPosition] = useState<{top: number, left: number} | null>(null);

  // Sync projectTasks with project.tasks when it changes
  useEffect(() => {
    if (project.tasks) {
      setProjectTasks(project.tasks);
    }
  }, [project.tasks]);

  // Close calendar dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (showCalendarDropdown) {
        const target = event.target as Element;
        // Don't close if clicking inside the calendar dropdown
        if (!target.closest('.calendar-dropdown')) {
          setShowCalendarDropdown(false);
        }
      }
    };

    if (showCalendarDropdown) {
      document.addEventListener('mousedown', handleClickOutside);
    }

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [showCalendarDropdown]);

  // Close assignment dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (showAssignmentDropdown) {
        const target = event.target as Element;
        // Don't close if clicking inside the assignment dropdown
        if (!target.closest('.assignment-dropdown')) {
          setShowAssignmentDropdown(null);
        }
      }
    };

    if (showAssignmentDropdown) {
      document.addEventListener('mousedown', handleClickOutside);
    }

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [showAssignmentDropdown]);

  // Function to calculate optimal number of tasks to display
  const calculateMaxTasks = useCallback(() => {
    if (!taskContainerRef.current) return 8;
    
    const container = taskContainerRef.current;
    const calendarHeight = 400; // Approximate height of calendar box
    const taskItemHeight = 48; // Approximate height of each task item (including padding)
    const maxTasks = Math.floor(calendarHeight / taskItemHeight);
    
    return Math.max(3, Math.min(maxTasks, 15)); // Min 3, max 15 tasks
  }, []);

  // Update max visible tasks when active phase changes
  useEffect(() => {
    setMaxVisibleTasks(calculateMaxTasks());
  }, [activePhase, calculateMaxTasks]);

  // Auto-save when tasks change
  useEffect(() => {
    const saveProject = async () => {
      const updatedProject = { 
        ...project, 
        tasks: projectTasks,
        keyDeadlines: projectKeyDates
      };
      try {
        const response = await fetch(`${API_BASE_URL}/api/projects/${project.id}`, {
          method: 'PUT',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${localStorage.getItem('cognitive_dash_token')}`
          },
          body: JSON.stringify({
            userId: user?.id,
            project: updatedProject
          })
        });
        
        if (response.ok) {
          // Update the main projects state
          if (setProjects) {
            setProjects(prevProjects => prevProjects.map(p => p.id === updatedProject.id ? updatedProject : p));
          }
        } else {
          const errorText = await response.text();
          console.error('Failed to auto-save project:', response.status, errorText);
        }
      } catch (error) {
        console.error('Error auto-saving project:', error);
      }
    };

    // Only save if tasks have actually changed from the initial project tasks
    if (JSON.stringify(projectTasks) !== JSON.stringify(project.tasks || [])) {
      saveProject();
    }
  }, [projectTasks, project.id, project.tasks || [], user?.id]);
  const [selectedDay, setSelectedDay] = useState<{ day: number; date: Date; phase: string; deadlines: string[]; notes: string[]; tasks: any[] } | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [showAddNote, setShowAddNote] = useState(false);
  const [showAllNotes, setShowAllNotes] = useState(false);
  const [showNotesModal, setShowNotesModal] = useState(false);
  const [modalSelectedNote, setModalSelectedNote] = useState<{ id: string; title: string; body: string; createdAt: string; createdBy: string; comments?: Array<{ id: string; text: string; author: string; createdAt: string }> } | null>(null);
  const [modalNewComment, setModalNewComment] = useState("");
  const [showTimelineEditor, setShowTimelineEditor] = useState(false);
  const [showMentionDropdown, setShowMentionDropdown] = useState(false);
  const [mentionQuery, setMentionQuery] = useState("");
  const [mentionPosition, setMentionPosition] = useState(0);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLDivElement>(null);
  const notesContainerRef = useRef<HTMLDivElement>(null);
  const [newNote, setNewNote] = useState({ title: "", body: "", postToProjectPage: false, date: "", taggedMembers: [] as string[] });
  const [editingNote, setEditingNote] = useState<string | null>(null);
  const [projectNotes, setProjectNotes] = useState(project.notes || []);
  const [selectedNote, setSelectedNote] = useState<{ id: string; title: string; body: string; createdAt: string; createdBy: string; comments?: Array<{ id: string; text: string; author: string; createdAt: string }> } | null>(null);
  const [newComment, setNewComment] = useState("");
  const [archivedNotes, setArchivedNotes] = useState<Array<{ id: string; title: string; body: string; createdAt: string; createdBy: string; comments?: Array<{ id: string; text: string; author: string; createdAt: string }> }>>(project.archivedNotes || []);

  // Project Files state
  const [projectFiles, setProjectFiles] = useState<Array<{ id: string; name: string; type: string; url: string }>>(project.files || []);
  const [showAddFileModal, setShowAddFileModal] = useState(false);
  const [newFileUrl, setNewFileUrl] = useState("");
  
  // Discussion guide modal state
  const [showDiscussionGuideModal, setShowDiscussionGuideModal] = useState(false);
  const [selectedDiscussionGuide, setSelectedDiscussionGuide] = useState<string | null>(null);
  const docxContainerRef = useRef<HTMLDivElement>(null);

  // Sync local state when project prop changes
  useEffect(() => {
    setProjectNotes(project.notes || []);
    setArchivedNotes(project.archivedNotes || []);
    setProjectFiles(project.files || []);
  }, [project.notes, project.archivedNotes, project.files]);

  // Load storytelling data when project changes
  useEffect(() => {
    const loadStorytellingData = async () => {
      if (!project?.id) return;
      
      setStorytellingLoading(true);
      try {
        // Check if project has analysisId (from storytelling API) or get it from saved content analyses
        let analysisId = (project as any).analysisId;
        
        // If no analysisId on project, try to get it from saved content analyses
        if (!analysisId && savedContentAnalyses && savedContentAnalyses.length > 0) {
          const projectCA = savedContentAnalyses.find(ca => ca.projectId === project.id);
          if (projectCA) {
            analysisId = projectCA.id;
            console.log('🔍 Found analysisId from saved content analyses:', analysisId);
          }
        }
        
        const url = analysisId 
          ? `${API_BASE_URL}/api/storytelling/${project.id}?analysisId=${analysisId}`
          : `${API_BASE_URL}/api/storytelling/${project.id}`;
        
        const response = await fetch(url, {
          headers: { 'Authorization': `Bearer ${localStorage.getItem('cognitive_dash_token')}` }
        });
        if (response.ok) {
          const data = await response.json();
          console.log('🔍 Storytelling data loaded:', data);
          console.log('🔍 Storyboards:', data.storyboards?.length || 0);
          console.log('🔍 Report data slides:', data.reportData?.slides?.length || 0);
          setStorytellingData(data);
        } else {
          console.log('❌ No storytelling data found for project:', project.id, 'Response status:', response.status);
          setStorytellingData(null);
        }
      } catch (error) {
        console.error('❌ Error loading storytelling data:', error);
        setStorytellingData(null);
      } finally {
        setStorytellingLoading(false);
      }
    };

    loadStorytellingData();
  }, [project?.id]);

  // Load discussion guide when modal opens
  useEffect(() => {
    if (showDiscussionGuideModal && selectedDiscussionGuide) {
      const analysis = savedContentAnalyses.find(a => a.id === selectedDiscussionGuide);
      if (analysis && analysis.projectId) {
        const loadDiscussionGuide = async () => {
          try {
            const response = await fetch(`${API_BASE_URL}/api/caX/discussion-guide/${analysis.projectId}/download`, {
              headers: { 'Authorization': `Bearer ${localStorage.getItem('cognitive_dash_token')}` }
            });
            if (response.ok) {
              const blob = await response.blob();
              if (docxContainerRef.current) {
                docxContainerRef.current.innerHTML = ''; // Clear previous content
                const { renderAsync } = await import('docx-preview');
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
        };
        loadDiscussionGuide();
      }
    }
  }, [showDiscussionGuideModal, selectedDiscussionGuide, savedContentAnalyses]);
  const [showArchivedNotes, setShowArchivedNotes] = useState(false);
  const [showAddKeyDate, setShowAddKeyDate] = useState(false);
  const [newKeyDate, setNewKeyDate] = useState({ label: "", date: "" });
  const [showAddTeamMember, setShowAddTeamMember] = useState(false);
  const [containerWidth, setContainerWidth] = useState(0);
  const [dynamicMaxVisible, setDynamicMaxVisible] = useState(3);
  const [localTeamMembers, setLocalTeamMembers] = useState(project.teamMembers);
  const [projectKeyDates, setProjectKeyDates] = useState(() => {
    // Ensure we have valid key dates and filter out any invalid ones
    const keyDates = project.keyDeadlines || [];
    return keyDates.filter(keyDate => {
      try {
        // Safety check for keyDate.date
        if (!keyDate.date || typeof keyDate.date !== 'string') {
          console.warn('Invalid keyDate.date:', keyDate.date);
          return false;
        }
        
        if (keyDate.date.includes('/')) {
          const [month, day, year] = keyDate.date.split('/');
          const fullYear = parseInt(year) < 50 ? 2000 + parseInt(year) : 1900 + parseInt(year);
          const testDate = new Date(fullYear, parseInt(month) - 1, parseInt(day));
          return !isNaN(testDate.getTime());
        } else if (keyDate.date.includes('-')) {
          const [year, month, day] = keyDate.date.split('-');
          const testDate = new Date(parseInt(year), parseInt(month) - 1, parseInt(day));
          return !isNaN(testDate.getTime());
        } else {
          const testDate = new Date(keyDate.date);
          return !isNaN(testDate.getTime());
        }
      } catch (error) {
        console.warn('Filtering out invalid key date:', keyDate.date);
        return false;
      }
    });
  });

  // Project editing state (only needed for moderator now)
  const [editValues, setEditValues] = useState({
    moderator: project.moderator || ''
  });
  const [showModeratorModal, setShowModeratorModal] = useState(false);
  const [localProject, setLocalProject] = useState(project);

  // Sync local project state with prop changes
  useEffect(() => {
    setLocalProject(project);
  }, [project]);

  // Load moderators from localStorage
  useEffect(() => {
    const loadModerators = () => {
      try {
        const storedVendors = localStorage.getItem('cognitive_dash_vendors');
        if (storedVendors) {
          const data = JSON.parse(storedVendors);
          setModerators(data.moderators || []);
        }
      } catch (error) {
        console.error('Error loading moderators:', error);
      }
    };
    loadModerators();
  }, []);

  // Check moderator availability during project field dates
  const getAvailableModerators = () => {
    // Only allow moderators for qualitative projects
    const methodologyType = project.methodologyType || 
                          (project.methodology?.includes('Focus') || project.methodology?.includes('Interview') || project.methodology?.includes('Ethnographic') || 
                           project.name?.toLowerCase().includes('qual') ? 'Qualitative' : 'Quantitative');
    
    if (methodologyType === 'Quantitative' || methodologyType === 'Quant') {
      return []; // No moderators for quantitative projects
    }

    if (!project.segments || project.segments.length === 0) {
      return moderators; // Return all if no field dates set
    }

    // Get all projects to check for conflicts
    const allProjects = JSON.parse(localStorage.getItem('cognitive_dash_projects') || '[]');

    // Find the fielding phase segment (actual fieldwork dates only)
    const fieldingSegment = project.segments.find(seg =>
      seg.phase === 'Fielding'
    );

    if (!fieldingSegment) {
      return moderators; // Return all if no fielding phase
    }

    return moderators.filter(moderator => {
      // Check if this moderator has conflicts during the field dates
      const hasConflict = allProjects.some((otherProject: any) => {
        if (otherProject.id === project.id) return false; // Skip current project
        if (!otherProject.moderator || (otherProject.moderator !== moderator.id && otherProject.moderator !== moderator.name)) return false;
        if (!otherProject.segments) return false;

        // Check if other project's fielding overlaps with our fielding
        const otherFielding = otherProject.segments.find((seg: any) =>
          seg.phase === 'Fielding'
        );

        if (!otherFielding) return false;

        // Check for date overlap using string comparison to avoid timezone issues
        const ourStart = fieldingSegment.startDate;
        const ourEnd = fieldingSegment.endDate;
        const otherStart = otherFielding.startDate;
        const otherEnd = otherFielding.endDate;

        return (ourStart <= otherEnd && ourEnd >= otherStart);
      });

      return !hasConflict;
    });
  };

  // Handle moderator assignment
  const handleModeratorAssignment = (moderatorId: string) => {

    if (moderatorId === '') {
      // Remove assignment

      // Update the project immediately for UI responsiveness
      const updatedProject = { ...project, moderator: '' };
      setLocalProject(updatedProject);

      // Update the main projects state
      if (setProjects) {
        setProjects(prevProjects => {
          const newProjects = prevProjects.map(p => p.id === updatedProject.id ? updatedProject : p);
          return newProjects;
        });
      }

      // Save to server
      saveProjectField('moderator', '');
      setEditValues(prev => ({ ...prev, moderator: '' }));
    } else {
      const selectedModerator = moderators.find(m => m.id === moderatorId);

      if (selectedModerator) {

        // Update the project immediately for UI responsiveness
        const updatedProject = { ...project, moderator: selectedModerator.name };
        setLocalProject(updatedProject);

        // Update the main projects state
        if (setProjects) {
          setProjects(prevProjects => {
            const newProjects = prevProjects.map(p => p.id === updatedProject.id ? updatedProject : p);
            return newProjects;
          });
        }

        // Save to server
        saveProjectField('moderator', selectedModerator.name);
        setEditValues(prev => ({ ...prev, moderator: selectedModerator.name }));
      } else {
      }
    }
    setShowModeratorModal(false);
  };

  // Save project field edits
  const saveProjectField = async (field: string, value: string) => {
    try {
      // Map field names to correct project properties
      const fieldMapping: Record<string, string> = {
        'sample': 'sampleDetails',
        'methodology': 'methodology',
        'moderator': 'moderator',
        'client': 'client',
        'name': 'name'
      };

      const projectField = fieldMapping[field] || field;
      const updatedProject = { ...project, [projectField]: value };

      const response = await fetch(`${API_BASE_URL}/api/projects/${project.id}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${localStorage.getItem('cognitive_dash_token')}`
        },
        body: JSON.stringify({
          userId: user?.id,
          project: updatedProject
        })
      });

      if (response.ok) {
        // Update the main projects state
        if (setProjects) {
          setProjects(prevProjects => prevProjects.map(p => p.id === updatedProject.id ? updatedProject : p));
        }
      } else {
        console.error('Failed to save project field:', response.status);
      }
    } catch (error) {
      console.error('Error saving project field:', error);
    }
  };


  // Helper function to get next workday
  const getNextWorkday = (date: string) => {
    const dateObj = new Date(date);
    dateObj.setDate(dateObj.getDate() + 1);
    
    // Skip weekends
    while (dateObj.getDay() === 0 || dateObj.getDay() === 6) {
      dateObj.setDate(dateObj.getDate() + 1);
    }
    
    return dateObj.toISOString().split('T')[0];
  };

  // Helper function to validate phase dates
  const validatePhaseDates = (segments: Array<{ phase: Phase; startDate: string; endDate: string }>) => {
    const errors: string[] = [];
    
    // Check for end date before start date
    segments.forEach((segment, index) => {
      if (segment.startDate > segment.endDate) {
        errors.push(`${segment.phase} phase: End date cannot be before start date`);
      }
    });
    
    // Check for overlaps
    for (let i = 0; i < segments.length; i++) {
      for (let j = i + 1; j < segments.length; j++) {
        const seg1 = segments[i];
        const seg2 = segments[j];
        
        if (seg1.startDate <= seg2.endDate && seg2.startDate <= seg1.endDate) {
          errors.push(`${seg1.phase} and ${seg2.phase} phases overlap`);
        }
      }
    }
    
    return errors;
  };

  const toggleTaskCompletion = (taskId: string) => {
    setProjectTasks(prevTasks =>
      prevTasks.map(task =>
        task.id === taskId
          ? { ...task, status: task.status === 'completed' ? 'pending' : 'completed' }
          : task
      )
    );
  };

  const updateTaskAssignment = (taskId: string, assignedTo: string[]) => {
    setProjectTasks(prevTasks =>
      prevTasks.map(task =>
        task.id === taskId
          ? { ...task, assignedTo: assignedTo.length > 0 ? assignedTo : undefined }
          : task
      )
    );
  };

  const handleAddTask = () => {
    if (newTask.description.trim()) {
      const task: Task = {
        id: `task-${Date.now()}`,
        description: newTask.description,
        assignedTo: newTask.assignedTo.length > 0 ? newTask.assignedTo : undefined,
        status: newTask.status,
        phase: activePhase,
        dueDate: (newTask as any).isOngoing ? undefined : (newTask.dueDate && newTask.dueDate.trim() ? newTask.dueDate : null),
        isOngoing: (newTask as any).isOngoing || false
      };
      setProjectTasks(prevTasks => [...prevTasks, task]);
      setNewTask({ description: "", assignedTo: [], status: "pending", dueDate: "", isOngoing: false });
      setShowAddTask(false);
    }
  };

  // Calendar helper functions
  const getDaysInMonth = (date: Date) => {
    return new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate();
  };

  const getFirstDayOfMonth = (date: Date) => {
    return new Date(date.getFullYear(), date.getMonth(), 1).getDay();
  };

  const getWorkWeekDays = (date: Date, fullCalendar: boolean = false) => {
    const year = date.getFullYear();
    const month = date.getMonth();
    const firstDay = new Date(year, month, 1);
    const lastDay = new Date(year, month + 1, 0);

    // Find the Monday of the current week (today's week)
    const today = new Date();
    const currentMonday = new Date(today);
    const todayDayOfWeek = today.getDay() || 7; // Convert Sunday (0) to 7
    currentMonday.setDate(today.getDate() - (todayDayOfWeek - 1));

    // Find the Monday of the week containing the first day of the month
    const firstMonday = new Date(firstDay);
    const firstDayOfWeek = firstDay.getDay() || 7; // Convert Sunday (0) to 7
    firstMonday.setDate(firstDay.getDate() - (firstDayOfWeek - 1));

    // Find the Friday of the week containing the last day of the month
    const lastFriday = new Date(lastDay);
    const lastDayOfWeek = lastDay.getDay() || 7; // Convert Sunday (0) to 7
    if (lastDayOfWeek <= 5) { // If last day is weekday
      lastFriday.setDate(lastDay.getDate() + (5 - lastDayOfWeek));
    } else { // If last day is weekend, go to previous Friday
      lastFriday.setDate(lastDay.getDate() - (lastDayOfWeek - 5));
    }

    // Start from the current week's Monday if not showing full calendar, otherwise start from first Monday of month
    const startMonday = fullCalendar ? firstMonday : (() => {
      // Always use the Monday of the week containing the currentMonth date
      const weekMonday = new Date(currentMonth);
      const dayOfWeek = currentMonth.getDay() || 7; // Convert Sunday (0) to 7
      weekMonday.setDate(currentMonth.getDate() - (dayOfWeek - 1));
      return weekMonday;
    })();
    
    // If showing current week, end at the current week's Friday, otherwise use the month's last Friday
    const endFriday = fullCalendar ? lastFriday : (() => {
      const currentFriday = new Date(startMonday);
      currentFriday.setDate(startMonday.getDate() + 4); // Friday is 4 days after Monday
      return currentFriday;
    })();

    const days = [];
    const current = new Date(startMonday);

    while (current <= endFriday) {
      const dayOfWeek = current.getDay();
      // Only include Monday (1) through Friday (5)
      if (dayOfWeek >= 1 && dayOfWeek <= 5) {
        days.push({
          date: new Date(current),
          day: current.getDate(),
          month: current.getMonth(),
          year: current.getFullYear(),
          isCurrentMonth: current.getMonth() === month
        });
      }
      current.setDate(current.getDate() + 1);
    }

    return days;
  };

  const getWeekGroups = (days: any[]) => {
    const weeks = [];
    let currentWeek = [];

    for (const dayObj of days) {
      const dayOfWeek = dayObj.date.getDay();

      // If it's Monday (1) and we have days in current week, start a new week
      if (dayOfWeek === 1 && currentWeek.length > 0) {
        weeks.push(currentWeek);
        currentWeek = [];
      }

      currentWeek.push(dayObj);
    }

    // Add the last week if it has days
    if (currentWeek.length > 0) {
      weeks.push(currentWeek);
    }

    return weeks;
  };

  const isDateInPhase = (dayObj: any, phase: { startDate: string; endDate: string }) => {
    // Use the date from the day object
    const currentDate = dayObj.date;
    const dateString = `${currentDate.getFullYear()}-${String(currentDate.getMonth() + 1).padStart(2, '0')}-${String(currentDate.getDate()).padStart(2, '0')}`;
    
    // Check if the date falls within the phase date range
    return dateString >= phase.startDate && dateString <= phase.endDate;
  };

  const isToday = (date: Date) => {
    const today = new Date();
    return date.getDate() === today.getDate() &&
           date.getMonth() === today.getMonth() &&
           date.getFullYear() === today.getFullYear();
  };
  
  // Convert day numbers to actual dates
  const getDateFromDay = (day: number) => {
    const today = new Date();
    const projectStart = new Date(today.getTime() + (day * 24 * 60 * 60 * 1000));
    return projectStart.toLocaleDateString('en-US', { 
      month: 'short', 
      day: 'numeric',
      year: 'numeric'
    });
  };
  
  const getFileIcon = (type: ProjectFile['type']) => {
    switch (type) {
      case 'content-analysis':
        return <ChartBarIcon className="h-5 w-5 text-blue-600" />;
      case 'qnr':
        return <ClipboardDocumentIcon className="h-5 w-5 text-green-600" />;
      case 'report':
        return <DocumentIcon className="h-5 w-5 text-purple-600" />;
      case 'word':
        return <DocumentIcon className="h-5 w-5 text-blue-600" />;
      case 'excel':
        return <ChartBarIcon className="h-5 w-5 text-green-600" />;
      case 'powerpoint':
        return <DocumentIcon className="h-5 w-5 text-orange-600" />;
      default:
        return <DocumentIcon className="h-5 w-5 text-gray-600" />;
    }
  };

  const getStatusColor = (status: Task['status']) => {
    switch (status) {
      case 'completed':
        return 'text-green-600 bg-green-100 opacity-60';
      case 'in-progress':
        return 'text-blue-600 bg-blue-100 opacity-60';
      case 'pending':
        return 'text-gray-600 bg-gray-100 opacity-60';
      default:
        return 'text-gray-600 bg-gray-100';
    }
  };

  // File upload handlers
  const handleFileUpload = (files: FileList) => {
    // Handle file upload logic here
    console.log('Files uploaded:', files);
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  };

  const handleDragEnter = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleFileDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const files = Array.from(e.dataTransfer.files);
    console.log('Files dropped:', files);
    // TODO: Implement file upload logic
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    console.log('Files selected:', files);
    // TODO: Implement file upload logic
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    handleFileDrop(e);
  };

  // SharePoint file helpers
  const parseSharePointLink = (url: string): { name: string; type: string } | null => {
    try {
      // Extract filename from SharePoint URL
      // Example: https://hypothesisconsulting.sharepoint.com/:x:/r/sites/cognitivedrive/_layouts/15/Doc.aspx?sourcedoc=%7B625425B1-25AB-4B0E-AE88-66EAB325EA79%7D&file=ProjectName_Project%20Checklist_110722.xlsx&action=default&mobileredirect=true
      const fileMatch = url.match(/[&?]file=([^&]+)/);
      if (!fileMatch) return null;

      let filename = decodeURIComponent(fileMatch[1]);

      // Extract extension
      const extMatch = filename.match(/\.([^.]+)$/);
      if (!extMatch) return null;

      const extension = extMatch[1].toLowerCase();

      // Remove extension and date pattern from filename
      let cleanName = filename.replace(/\.[^.]+$/, ''); // Remove extension
      cleanName = cleanName.replace(/_\d{6}$/, ''); // Remove _MMDDYY pattern
      cleanName = cleanName.replace(/_/g, ' '); // Replace underscores with spaces

      // Map extension to file type
      let type = 'Other';
      if (['xlsx', 'xls', 'xlsm'].includes(extension)) {
        type = 'Excel';
      } else if (['docx', 'doc'].includes(extension)) {
        type = 'Word';
      } else if (['pptx', 'ppt'].includes(extension)) {
        type = 'PowerPoint';
      } else if (extension === 'pdf') {
        type = 'PDF';
      }

      return { name: cleanName, type };
    } catch (error) {
      console.error('Error parsing SharePoint link:', error);
      return null;
    }
  };

  const getSharePointFileIcon = (type: string) => {
    const iconClass = "h-5 w-5";
    switch (type) {
      case 'Excel':
        return (
          <svg className={iconClass} fill="currentColor" viewBox="0 0 24 24" style={{ color: '#1D6F42' }}>
            <path d="M14 2H6c-1.1 0-2 .9-2 2v16c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V8l-6-6zM6 20V4h7v5h5v11H6zm7-11h-2l-1.5 3.5L8 9H6l2.5 4.5L6 18h2l1.5-3.5L11 18h2l-2.5-4.5L13 9z"/>
          </svg>
        );
      case 'Word':
        return (
          <svg className={iconClass} fill="currentColor" viewBox="0 0 24 24" style={{ color: '#2B579A' }}>
            <path d="M14 2H6c-1.1 0-2 .9-2 2v16c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V8l-6-6zM6 20V4h7v5h5v11H6zm2.5-9h1.1l.9 3.3.9-3.3h1.1l.9 3.3.9-3.3h1.1L14 15h-1.1l-.9-3-.9 3H10l-1.5-4z"/>
          </svg>
        );
      case 'PowerPoint':
        return (
          <svg className={iconClass} fill="currentColor" viewBox="0 0 24 24" style={{ color: '#D24726' }}>
            <path d="M14 2H6c-1.1 0-2 .9-2 2v16c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V8l-6-6zM6 20V4h7v5h5v11H6zm3-9h3c1.1 0 2 .9 2 2s-.9 2-2 2h-1v2H9v-6zm2 3c.6 0 1-.4 1-1s-.4-1-1-1h-1v2h1z"/>
          </svg>
        );
      case 'PDF':
        return (
          <svg className={iconClass} fill="currentColor" viewBox="0 0 24 24" style={{ color: '#F40F02' }}>
            <path d="M14 2H6c-1.1 0-2 .9-2 2v16c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V8l-6-6zM6 20V4h7v5h5v11H6zm2-9h2c1.1 0 2 .9 2 2v1c0 1.1-.9 2-2 2H8v2H7v-7zm1 1v3h1c.6 0 1-.4 1-1v-1c0-.6-.4-1-1-1H9z"/>
          </svg>
        );
      default:
        return <DocumentIcon className={iconClass + " text-gray-600"} />;
    }
  };

  const handleAddFile = async () => {
    if (!newFileUrl.trim()) return;

    const parsedFile = parseSharePointLink(newFileUrl);
    if (!parsedFile) {
      alert('Could not parse SharePoint link. Please check the URL format.');
      return;
    }

    const newFile: ProjectFile = {
      id: Date.now().toString(),
      name: parsedFile.name,
      type: parsedFile.type as ProjectFile['type'],
      url: newFileUrl
    };

    const updatedFiles: ProjectFile[] = [...projectFiles, newFile];
    setProjectFiles(updatedFiles);

    // Save to backend
    try {
      const response = await fetch(`${API_BASE_URL}/api/projects/${project.id}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${localStorage.getItem('cognitive_dash_token')}`
        },
        body: JSON.stringify({ files: updatedFiles })
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ error: 'Unknown error' }));
        console.error('Server error:', response.status, errorData);
        throw new Error(`Failed to save file: ${errorData.error || response.statusText}`);
      }

      // Update parent state
      if (setProjects) {
        setProjects((prev: Project[]) =>
          prev.map(p => p.id === project.id ? { ...p, files: updatedFiles } : p)
        );
      }

      setNewFileUrl('');
      setShowAddFileModal(false);
    } catch (error) {
      console.error('Error saving file:', error);
      alert('Failed to save file. Please try again.');
    }
  };

  const handleDeleteFile = async (fileId: string) => {
    if (!confirm('Are you sure you want to delete this file?')) return;

    const updatedFiles: ProjectFile[] = projectFiles.filter(f => f.id !== fileId);
    setProjectFiles(updatedFiles);

    // Save to backend
    try {
      const response = await fetch(`${API_BASE_URL}/api/projects/${project.id}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${localStorage.getItem('cognitive_dash_token')}`
        },
        body: JSON.stringify({ files: updatedFiles })
      });

      if (!response.ok) {
        throw new Error('Failed to delete file');
      }

      // Update parent state
      if (setProjects) {
        setProjects((prev: Project[]) =>
          prev.map(p => p.id === project.id ? { ...p, files: updatedFiles } : p)
        );
      }
    } catch (error) {
      console.error('Error deleting file:', error);
      alert('Failed to delete file. Please try again.');
      // Revert the local state on error
      setProjectFiles(projectFiles);
    }
  };

  // Day click handler for calendar
  const handleDayClick = (dayDate: Date) => {
    const currentDate = dayDate;
    // Use UTC methods to get consistent date string
    const dateString = currentDate.getUTCFullYear() + '-' + 
                      String(currentDate.getUTCMonth() + 1).padStart(2, '0') + '-' + 
                      String(currentDate.getUTCDate()).padStart(2, '0');
    
    // Find phase for this day
    const phaseForDay = project.segments?.find(segment => 
      dateString >= segment.startDate && dateString <= segment.endDate
    );
    
    // Find relevant key dates
    const relevantKeyDates = projectKeyDates.filter(keyDate => {
      try {
        // Safety check for keyDate.date
        if (!keyDate.date || typeof keyDate.date !== 'string') {
          console.warn('Invalid keyDate.date:', keyDate.date);
          return false;
        }
        
        // Handle different date formats
        let keyDateObj;
        
        if (keyDate.date.includes('/')) {
          // MM/DD/YY format
          const [month, day, year] = keyDate.date.split('/');
          const fullYear = parseInt(year) < 50 ? 2000 + parseInt(year) : 1900 + parseInt(year);
          keyDateObj = new Date(fullYear, parseInt(month) - 1, parseInt(day));
        } else if (keyDate.date.includes('-')) {
          // YYYY-MM-DD format
          const [year, month, day] = keyDate.date.split('-');
          keyDateObj = new Date(parseInt(year), parseInt(month) - 1, parseInt(day));
        } else {
          // Try parsing as is (avoid timezone issues)
          keyDateObj = new Date(keyDate.date);
        }
        
        // Check if the date is valid
        if (isNaN(keyDateObj.getTime())) {
          console.warn('Invalid key date:', keyDate.date);
          return false;
        }
        
        return keyDateObj.toDateString() === currentDate.toDateString();
      } catch (error) {
        console.warn('Error parsing key date:', keyDate.date, error);
        return false;
      }
    });
    
    // Find notes for this day
    const relevantNotes = getNotesForDay(dayDate.getDate());
    
    // Find tasks for this day
    const currentYear = dayDate.getFullYear();
    const currentMonthNum = dayDate.getMonth();
    const currentDay = dayDate.getDate();
    
    const relevantTasks = projectTasks.filter(task => {
      if (!task.dueDate) return false;
      
      try {
        const taskDate = new Date(task.dueDate + 'T00:00:00');
        if (isNaN(taskDate.getTime())) return false;

        return taskDate.getFullYear() === currentYear &&
               taskDate.getMonth() === currentMonthNum &&
               taskDate.getDate() === currentDay;
      } catch (error) {
        return false;
      }
    });
    
    setSelectedDay({
      day: dayDate.getDate(),
      date: dayDate,
      phase: phaseForDay?.phase || 'No phase',
      deadlines: relevantKeyDates.map(d => d.label),
      notes: relevantNotes.map(note => note.title),
      tasks: relevantTasks
    });
  };

  // Note handling functions
  const handleAddNote = async () => {
    if (newNote.title.trim() && newNote.body.trim()) {
      const note = {
        id: `note-${Date.now()}`,
        title: newNote.title,
        body: newNote.body,
        createdAt: new Date().toISOString(),
        createdBy: user?.id || 'unknown',
        isEditable: true,
        postToProjectPage: true, // Always post to project page for sticky notes
        date: undefined, // No date for sticky notes
        taggedMembers: newNote.taggedMembers || [],
        comments: []
      };
      
      const updatedNotes = [...projectNotes, note];
      setProjectNotes(updatedNotes);

      // Update the main project state
      const updatedProject = {
        ...project,
        notes: updatedNotes
      };

      // Update the projects list in the parent component
      if (setProjects) {
        setProjects((prev: Project[]) =>
          prev.map(p => p.id === project.id ? updatedProject : p)
        );
      }

      // Save to backend
      try {
        const response = await fetch(`${API_BASE_URL}/api/projects/${project.id}`, {
          method: 'PUT',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${localStorage.getItem('cognitive_dash_token')}`
          },
          body: JSON.stringify({
            userId: user?.id,
            project: updatedProject
          })
        });

        if (!response.ok) {
          console.error('Failed to save note to backend');
        }
      } catch (error) {
        console.error('Error saving note:', error);
      }

      setNewNote({ title: "", body: "", postToProjectPage: false, date: "", taggedMembers: [] });
      setShowAddNote(false);
    }
  };

  // Mention handling functions
  const handleTextareaChange = (e: React.FormEvent<HTMLDivElement>) => {
    const target = e.target as HTMLDivElement;
    const value = target.innerHTML;

    // Check which members are still in the content
    const mentionSpans = target.querySelectorAll('span[data-member-id]');
    const remainingMemberIds = Array.from(mentionSpans).map(span =>
      span.getAttribute('data-member-id')
    ).filter(id => id !== null);

    // Only update state if the content actually changed to avoid cursor jumping
    if (value !== newNote.body) {
      setNewNote(prev => ({
        ...prev,
        body: value,
        taggedMembers: remainingMemberIds
      }));
    }

    // Check for @ mentions
    const textContent = target.textContent || '';
    const selection = window.getSelection();
    const cursorPosition = selection ? getCaretPosition(target) : textContent.length;
    const textBeforeCursor = textContent.substring(0, cursorPosition);
    const atMatch = textBeforeCursor.match(/@(\w*)$/);

    if (atMatch) {
      setMentionQuery(atMatch[1]);
      setMentionPosition(cursorPosition - atMatch[1].length - 1);
      setShowMentionDropdown(true);
    } else {
      setShowMentionDropdown(false);
    }
  };

  const getCaretPosition = (element: HTMLDivElement) => {
    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0) return 0;
    
    const range = selection.getRangeAt(0);
    const preCaretRange = range.cloneRange();
    preCaretRange.selectNodeContents(element);
    preCaretRange.setEnd(range.endContainer, range.endOffset);
    return preCaretRange.toString().length;
  };

  const handleMentionSelect = (member: any) => {
    if (!textareaRef.current) return;

    const memberColor = getMemberColor(member.id, project.teamMembers);

    // Get current content and replace @query with styled mention
    const currentContent = textareaRef.current.innerHTML;
    const newContent = currentContent.replace(
      new RegExp(`@${mentionQuery}\\b`, 'g'),
      `<span contenteditable="false" data-member-id="${member.id}" style="font-weight: bold; color: ${memberColor}; background-color: ${memberColor}15; padding: 2px 6px; border-radius: 4px; margin: 0 2px; display: inline-block; cursor: pointer;">${member.name}</span>&nbsp;`
    );

    // Update the contentEditable div directly
    textareaRef.current.innerHTML = newContent;

    setNewNote(prev => ({
      ...prev,
      body: newContent,
      taggedMembers: [...prev.taggedMembers, member.id]
    }));

    setShowMentionDropdown(false);
    setMentionQuery("");

    // Focus back to textarea and place cursor at end
    textareaRef.current.focus();
    const range = document.createRange();
    const sel = window.getSelection();
    range.selectNodeContents(textareaRef.current);
    range.collapse(false);
    sel?.removeAllRanges();
    sel?.addRange(range);
  };

  const filteredMembers = project.teamMembers.filter(member =>
    member.name.toLowerCase().includes(mentionQuery.toLowerCase()) &&
    !newNote.taggedMembers.includes(member.id)
  );

  // Comment handling functions
  const handleAddComment = async (noteId: string) => {
    if (newComment.trim()) {
      const comment = {
        id: `comment-${Date.now()}`,
        text: newComment,
        author: user?.id || 'Unknown User',
        createdAt: new Date().toISOString()
      };

      const updatedNotes = projectNotes.map(note =>
        note.id === noteId
          ? { ...note, comments: [...(note.comments || []), comment] }
          : note
      );

      setProjectNotes(updatedNotes);

      // Update selectedNote if it's the note being commented on
      if (selectedNote && selectedNote.id === noteId) {
        setSelectedNote({
          ...selectedNote,
          comments: [...(selectedNote.comments || []), comment]
        });
      }

      // Update the main project state
      const updatedProject = {
        ...project,
        notes: updatedNotes,
        archivedNotes: archivedNotes
      };

      // Update the projects list in the parent component
      if (setProjects) {
        setProjects((prev: Project[]) =>
          prev.map(p => p.id === project.id ? updatedProject : p)
        );
      }

      // Save to backend
      try {
        await fetch(`${API_BASE_URL}/api/projects/${project.id}`, {
          method: 'PUT',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${localStorage.getItem('cognitive_dash_token')}`
          },
          body: JSON.stringify({
            userId: user?.id,
            project: updatedProject
          })
        });
      } catch (error) {
        console.error('Error saving comment:', error);
      }

      setNewComment("");
    }
  };

  const handleArchiveNote = async (noteId: string) => {
    const noteToArchive = projectNotes.find(note => note.id === noteId);
    if (noteToArchive) {
      const updatedNotes = projectNotes.filter(note => note.id !== noteId);
      const updatedArchivedNotes = [...archivedNotes, noteToArchive];
      
      setArchivedNotes(updatedArchivedNotes);
      setProjectNotes(updatedNotes);

      // Update the main project state
      const updatedProject = {
        ...project,
        notes: updatedNotes,
        archivedNotes: updatedArchivedNotes
      };

      // Update the projects list in the parent component
      if (setProjects) {
        setProjects((prev: Project[]) =>
          prev.map(p => p.id === project.id ? updatedProject : p)
        );
      }

      // Save to backend
      try {
        const response = await fetch(`${API_BASE_URL}/api/projects/${project.id}`, {
          method: 'PUT',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${localStorage.getItem('cognitive_dash_token')}`
          },
          body: JSON.stringify({
            userId: user?.id,
            project: updatedProject
          })
        });

        if (response.ok) {
          console.log('Successfully saved archived note to backend');
        } else {
          console.error('Failed to save archived note to backend');
        }
      } catch (error) {
        console.error('Error archiving note:', error);
      }
    }
  };

  const handleDeleteArchivedNote = async (noteId: string) => {
    const updatedArchivedNotes = archivedNotes.filter(note => note.id !== noteId);
    setArchivedNotes(updatedArchivedNotes);

    // Update the main project state
    const updatedProject = {
      ...project,
      notes: projectNotes,
      archivedNotes: updatedArchivedNotes
    };

    // Update the projects list in the parent component
    if (setProjects) {
      setProjects((prev: Project[]) =>
        prev.map(p => p.id === project.id ? updatedProject : p)
      );
    }

    // Save to backend
    try {
      const response = await fetch(`${API_BASE_URL}/api/projects/${project.id}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${localStorage.getItem('cognitive_dash_token')}`
        },
        body: JSON.stringify({
          userId: user?.id,
          project: updatedProject
        })
      });

      if (response.ok) {
        console.log('Successfully deleted archived note');
      } else {
        console.error('Failed to delete archived note');
      }
    } catch (error) {
      console.error('Error deleting archived note:', error);
    }
  };

  // Modal comment handler
  const handleModalAddComment = async (noteId: string) => {
    if (!modalNewComment.trim() || !user?.id) return;

    const comment = {
      id: Date.now().toString(),
      text: modalNewComment,
      author: user.id,
      createdAt: new Date().toISOString()
    };

    const updatedNotes = projectNotes.map(note =>
      note.id === noteId
        ? { ...note, comments: [...(note.comments || []), comment] }
        : note
    );

    setProjectNotes(updatedNotes);

    // Update modal selected note if it's the same note
    if (modalSelectedNote && modalSelectedNote.id === noteId) {
      setModalSelectedNote(prev => prev ? { ...prev, comments: [...(prev.comments || []), comment] } : null);
    }

    // Update the main project state
    const updatedProject = {
      ...project,
      notes: updatedNotes,
      archivedNotes: archivedNotes
    };

    // Update the projects list in the parent component
    if (setProjects) {
      setProjects((prev: Project[]) =>
        prev.map(p => p.id === project.id ? updatedProject : p)
      );
    }

    // Save to backend
    try {
      await fetch(`${API_BASE_URL}/api/projects/${project.id}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${localStorage.getItem('cognitive_dash_token')}`
        },
        body: JSON.stringify({
          userId: user?.id,
          project: updatedProject
        })
      });
    } catch (error) {
      console.error('Error saving comment:', error);
    }

    setModalNewComment("");
  };

  // Smart date update handler
  const handlePhaseDateChange = (phaseIndex: number, field: 'startDate' | 'endDate', newDate: string) => {
    const newSegments = [...editingSegments];
    const currentPhase = newSegments[phaseIndex];
    const phaseName = currentPhase.phase;
    
    // For Kickoff phase, always set end date same as start date
    if (phaseName === 'Kickoff' && field === 'startDate') {
      newSegments[phaseIndex].startDate = newDate;
      newSegments[phaseIndex].endDate = newDate;
    } else {
      newSegments[phaseIndex][field] = newDate;
    }
    
    // Smart updates based on phase relationships
    if (field === 'endDate') {
      // When ending a phase, update the next phase's start date
      if (phaseIndex < newSegments.length - 1) {
        const nextPhase = newSegments[phaseIndex + 1];
        const endDate = new Date(newDate);
        const nextStartDate = new Date(endDate);
        nextStartDate.setDate(nextStartDate.getDate() + 1);
        nextPhase.startDate = nextStartDate.toISOString().split('T')[0];
      }
    } else if (field === 'startDate') {
      // When starting a phase, update the previous phase's end date
      if (phaseIndex > 0) {
        const prevPhase = newSegments[phaseIndex - 1];
        const startDate = new Date(newDate);
        const prevEndDate = new Date(startDate);
        prevEndDate.setDate(prevEndDate.getDate() - 1);
        prevPhase.endDate = prevEndDate.toISOString().split('T')[0];
      }
    }
    
    // Update key dates that match phase names
    const updatedKeyDates = [...projectKeyDates];
    updatedKeyDates.forEach(keyDate => {
      if (keyDate.label.toLowerCase().includes(phaseName.toLowerCase())) {
        if (field === 'startDate' && keyDate.label.toLowerCase().includes('start')) {
          keyDate.date = newDate;
        } else if (field === 'endDate' && keyDate.label.toLowerCase().includes('end')) {
          keyDate.date = newDate;
        }
      }
    });
    
    setEditingSegments(newSegments);
    setProjectKeyDates(updatedKeyDates);
  };

  const formatShortDate = (dateString: string) => {
    const date = new Date(dateString);
    const dateStr = date.toLocaleDateString('en-US', { month: 'numeric', day: 'numeric' });
    const timeStr = date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
    return `${dateStr} ${timeStr}`;
  };

  // Calculate dynamic max visible notes based on container width
  const calculateMaxVisible = () => {
    if (!notesContainerRef.current) return 4;
    
    const containerWidth = notesContainerRef.current.offsetWidth;
    const noteWidth = 144; // w-36 = 144px
    const gap = 12; // gap-3 = 12px
    const addButtonWidth = 144; // Add button takes same space as a note when full size
    const thinButtonWidth = 32; // w-8 = 32px when thin
    
    // Calculate how many notes can fit with full add button
    const availableWidth = containerWidth - addButtonWidth - gap;
    const maxFitWithFullButton = Math.floor((availableWidth + gap) / (noteWidth + gap));
    
    // Calculate how many notes can fit with thin add button
    const availableWidthThin = containerWidth - thinButtonWidth - gap;
    const maxFitWithThinButton = Math.floor((availableWidthThin + gap) / (noteWidth + gap));
    
    // If we can fit 2 or more notes with full button, use that
    if (maxFitWithFullButton >= 2) {
      return maxFitWithFullButton;
    }
    
    // Otherwise, use thin button
    return Math.max(1, maxFitWithThinButton);
  };

  // Calculate optimal note width when thin button is active
  const calculateOptimalNoteWidth = () => {
    if (!notesContainerRef.current) return 144;
    
    const containerWidth = notesContainerRef.current.offsetWidth;
    const gap = 12; // gap-3 = 12px
    const thinButtonWidth = 32; // w-8 = 32px
    const availableWidth = containerWidth - thinButtonWidth - gap;
    const numNotes = Math.min(dynamicMaxVisible, projectNotes.filter(note => note.postToProjectPage).length);
    
    if (numNotes <= 0) return 144;
    
    // Calculate optimal width for even distribution
    const optimalWidth = Math.floor((availableWidth - (numNotes - 1) * gap) / numNotes);
    
    // Don't make them smaller than original size, but allow them to be wider
    return Math.max(144, optimalWidth);
  };

  // Check if we need to show "Show More" button
  const needsShowMore = () => {
    const filteredNotes = projectNotes.filter(note => note.postToProjectPage);
    return filteredNotes.length > dynamicMaxVisible;
  };

  // Update dynamic max visible on resize
  React.useEffect(() => {
    const updateMaxVisible = () => {
      const newMax = calculateMaxVisible();
      setDynamicMaxVisible(newMax);
    };

    updateMaxVisible();
    window.addEventListener('resize', updateMaxVisible);
    return () => window.removeEventListener('resize', updateMaxVisible);
  }, []);

  const formatShortTime = (dateString: string) => {
    const date = new Date(dateString);
    return date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true }).toLowerCase();
  };

  const handleEditNote = async (noteId: string, updatedNote: { title: string; body: string }) => {
    const updatedNotes = projectNotes.map(note => 
        note.id === noteId 
          ? { ...note, title: updatedNote.title, body: updatedNote.body }
          : note
    );
    
    setProjectNotes(updatedNotes);

    // Update the main project state
    const updatedProject = {
      ...project,
      notes: updatedNotes
    };

    // Update the projects list in the parent component
    if (setProjects) {
      setProjects((prev: Project[]) =>
        prev.map(p => p.id === project.id ? updatedProject : p)
      );
    }

    // Save to backend
    try {
      const response = await fetch(`${API_BASE_URL}/api/projects/${project.id}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${localStorage.getItem('cognitive_dash_token')}`
        },
        body: JSON.stringify({
          userId: user?.id,
          project: updatedProject
        })
      });

      if (!response.ok) {
        console.error('Failed to save edited note to backend');
      }
    } catch (error) {
      console.error('Error saving edited note:', error);
    }

    setEditingNote(null);
  };

  const handleDeleteNote = async (noteId: string) => {
    const updatedNotes = projectNotes.filter(note => note.id !== noteId);
    setProjectNotes(updatedNotes);

    // Update the main project state
    const updatedProject = {
      ...project,
      notes: updatedNotes
    };

    // Update the projects list in the parent component
    if (setProjects) {
      setProjects((prev: Project[]) =>
        prev.map(p => p.id === project.id ? updatedProject : p)
      );
    }

    // Save to backend
    try {
      const response = await fetch(`${API_BASE_URL}/api/projects/${project.id}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${localStorage.getItem('cognitive_dash_token')}`
        },
        body: JSON.stringify({
          userId: user?.id,
          project: updatedProject
        })
      });

      if (!response.ok) {
        console.error('Failed to save deleted note to backend');
      }
    } catch (error) {
      console.error('Error saving deleted note:', error);
    }
  };

  // Key date handling functions
  const handleAddKeyDate = () => {
    if (newKeyDate.label.trim() && newKeyDate.date.trim()) {
      // Parse the input date (YYYY-MM-DD from date input)
      const [year, month, day] = newKeyDate.date.split('-');
      const date = new Date(parseInt(year), parseInt(month) - 1, parseInt(day));

      // Format consistently as MM/DD/YY
      const formattedMonth = String(date.getMonth() + 1).padStart(2, '0');
      const formattedDay = String(date.getDate()).padStart(2, '0');
      const formattedYear = String(date.getFullYear()).slice(-2);

      const keyDate = {
        label: newKeyDate.label,
        date: `${formattedMonth}/${formattedDay}/${formattedYear}`
      };
      setProjectKeyDates(prev => [...prev, keyDate]);
      setNewKeyDate({ label: "", date: "" });
      setShowAddKeyDate(false);
    }
  };

  const handleDeleteKeyDate = (index: number) => {
    setProjectKeyDates(prev => prev.filter((_, i) => i !== index));
  };

  // Team member handling functions
  const handleAddTeamMember = (user: User) => {
    const newTeamMember = {
      id: user.id,
      name: user.name,
      role: 'Team Member' // Default role
    };
    
    // Check if user is already a team member
    const isAlreadyMember = project.teamMembers.some(member => member.id === user.id);
    if (!isAlreadyMember) {
      setLocalTeamMembers(prev => [...prev, newTeamMember]);
      setShowAddTeamMember(false);
      console.log('Adding team member:', newTeamMember);
    }
  };


  const hasKeyDateOnDay = (date: Date) => {
    const currentYear = date.getFullYear();
    const currentMonthNum = date.getMonth();
    const currentDay = date.getDate();
    
    return projectKeyDates.some(keyDate => {
      try {
        // Safety check for keyDate.date
        if (!keyDate.date || typeof keyDate.date !== 'string') {
          console.warn('Invalid keyDate.date:', keyDate.date);
          return false;
        }
        
        // Handle different date formats
        let keyDateObj;
        
        if (keyDate.date.includes('/')) {
          // MM/DD/YY format
          const [month, day, year] = keyDate.date.split('/');
          const fullYear = parseInt(year) < 50 ? 2000 + parseInt(year) : 1900 + parseInt(year);
          keyDateObj = new Date(fullYear, parseInt(month) - 1, parseInt(day));
        } else if (keyDate.date.includes('-')) {
          // YYYY-MM-DD format
          const [year, month, day] = keyDate.date.split('-');
          keyDateObj = new Date(parseInt(year), parseInt(month) - 1, parseInt(day));
        } else {
          // Try parsing as is
          keyDateObj = new Date(keyDate.date);
        }
        
        // Check if the date is valid
        if (isNaN(keyDateObj.getTime())) {
          console.warn('Invalid key date:', keyDate.date);
          return false;
        }
        
        // Compare year, month, and day directly
        return keyDateObj.getFullYear() === currentYear &&
               keyDateObj.getMonth() === currentMonthNum &&
               keyDateObj.getDate() === currentDay;
      } catch (error) {
        console.warn('Error parsing key date:', keyDate.date, error);
        return false;
      }
    });
  };

  const hasNoteOnDay = (date: Date) => {
    const currentYear = date.getFullYear();
    const currentMonthNum = date.getMonth();
    const currentDay = date.getDate();
    
    return projectNotes.some(note => {
      if (!note.date) return false;
      
      try {
        // Parse date consistently without timezone issues
        const noteDate = new Date(note.date);
        if (isNaN(noteDate.getTime())) return false;

        // Use UTC methods to avoid timezone shifts
        return noteDate.getUTCFullYear() === currentYear &&
               noteDate.getUTCMonth() === currentMonthNum &&
               noteDate.getUTCDate() === currentDay;
      } catch (error) {
        console.warn('Error parsing note date:', note.date, error);
        return false;
      }
    });
  };

  const hasTaskOnDay = (date: Date) => {
    const currentYear = date.getFullYear();
    const currentMonthNum = date.getMonth();
    const currentDay = date.getDate();
    
    return projectTasks.some(task => {
      if (!task.dueDate) return false;
      
      try {
        // Parse date consistently without timezone issues
        const taskDate = new Date(task.dueDate + 'T00:00:00');
        if (isNaN(taskDate.getTime())) return false;

        // Use local date methods to avoid timezone shifts
        return taskDate.getFullYear() === currentYear &&
               taskDate.getMonth() === currentMonthNum &&
               taskDate.getDate() === currentDay;
      } catch (error) {
        console.warn('Error parsing task date:', task.dueDate, error);
        return false;
      }
    });
  };

  const getTasksWithBothAssignmentAndDate = (date: Date) => {
    const currentYear = date.getFullYear();
    const currentMonthNum = date.getMonth();
    const currentDay = date.getDate();

    return projectTasks.filter(task => {
      if (!task.dueDate || !task.assignedTo || task.assignedTo.length === 0) return false;

      try {
        // Parse date consistently without timezone issues
        const taskDate = new Date(task.dueDate + 'T00:00:00');
        if (isNaN(taskDate.getTime())) return false;

        // Use local date methods to avoid timezone shifts
        return taskDate.getFullYear() === currentYear &&
               taskDate.getMonth() === currentMonthNum &&
               taskDate.getDate() === currentDay;
      } catch (error) {
        console.warn('Error parsing task date:', task.dueDate, error);
        return false;
      }
    });
  };

  const getTasksForDate = (date: Date) => {
    const currentYear = date.getFullYear();
    const currentMonthNum = date.getMonth();
    const currentDay = date.getDate();

    return projectTasks.filter(task => {
      if (!task.dueDate) return false;
      
      // Only include incomplete tasks
      if (task.status === 'completed') return false;

      try {
        // Parse date consistently without timezone issues
        const taskDate = new Date(task.dueDate + 'T00:00:00');
        if (isNaN(taskDate.getTime())) return false;

        // Use local date methods to avoid timezone shifts
        return taskDate.getFullYear() === currentYear &&
               taskDate.getMonth() === currentMonthNum &&
               taskDate.getDate() === currentDay;
      } catch (error) {
        console.warn('Error parsing task date:', task.dueDate, error);
        return false;
      }
    });
  };

  const getOverdueTasksForDate = (date: Date) => {
    const currentYear = date.getFullYear();
    const currentMonthNum = date.getMonth();
    const currentDay = date.getDate();

    return projectTasks.filter(task => {
      if (!task.dueDate) return false;
      
      // Only include incomplete tasks
      if (task.status === 'completed') return false;

      try {
        // Parse date consistently without timezone issues
        const taskDate = new Date(task.dueDate + 'T00:00:00');
        if (isNaN(taskDate.getTime())) return false;

        // Check if task is due on this date and is overdue
        const isDueOnThisDate = taskDate.getFullYear() === currentYear &&
                               taskDate.getMonth() === currentMonthNum &&
                               taskDate.getDate() === currentDay;
        
        const isOverdue = taskDate < new Date(new Date().setHours(0, 0, 0, 0));
        
        return isDueOnThisDate && isOverdue;
      } catch (error) {
        console.warn('Error parsing task date:', task.dueDate, error);
        return false;
      }
    });
  };

  const getNotesForDay = (day: number) => {
    const currentDate = new Date(currentMonth.getFullYear(), currentMonth.getMonth(), day);
    const currentYear = currentDate.getFullYear();
    const currentMonthNum = currentDate.getMonth();
    const currentDay = currentDate.getDate();
    
    return projectNotes.filter(note => {
      if (!note.date) return false;
      
      try {
        // Parse date consistently without timezone issues
        const noteDate = new Date(note.date);
        if (isNaN(noteDate.getTime())) return false;

        // Use UTC methods to avoid timezone shifts
        return noteDate.getUTCFullYear() === currentYear &&
               noteDate.getUTCMonth() === currentMonthNum &&
               noteDate.getUTCDate() === currentDay;
      } catch (error) {
        console.warn('Error parsing note date:', note.date, error);
        return false;
      }
    });
  };

  const getKeyDateTextForDay = (date: Date) => {
    const currentYear = date.getFullYear();
    const currentMonthNum = date.getMonth();
    const currentDay = date.getDate();


    const keyDate = projectKeyDates.find(keyDate => {
      try {
        // Safety check for keyDate.date
        if (!keyDate.date || typeof keyDate.date !== 'string') {
          console.warn('Invalid keyDate.date:', keyDate.date);
          return false;
        }
        
        // Handle different date formats
        let keyDateObj;
        
        if (keyDate.date.includes('/')) {
          // MM/DD/YY format
          const [month, day, year] = keyDate.date.split('/');
          const fullYear = parseInt(year) < 50 ? 2000 + parseInt(year) : 1900 + parseInt(year);
          keyDateObj = new Date(fullYear, parseInt(month) - 1, parseInt(day));
        } else if (keyDate.date.includes('-')) {
          // YYYY-MM-DD format
          const [year, month, day] = keyDate.date.split('-');
          keyDateObj = new Date(parseInt(year), parseInt(month) - 1, parseInt(day));
        } else {
          // Try parsing as is
          keyDateObj = new Date(keyDate.date);
        }
        
        // Check if the date is valid
        if (isNaN(keyDateObj.getTime())) {
          console.warn('Invalid key date:', keyDate.date);
          return false;
        }
        
        // Compare year, month, and day directly
        return keyDateObj.getFullYear() === currentYear &&
               keyDateObj.getMonth() === currentMonthNum &&
               keyDateObj.getDate() === currentDay;
      } catch (error) {
        console.warn('Error parsing key date:', keyDate.date, error);
        return false;
      }
    });
    return keyDate ? keyDate.label : null;
  };

  // Robust assignment matcher for current user within ProjectDashboard
  const isAssignedToCurrentUser = (task: Task): boolean => {
    if (!task?.assignedTo || task.assignedTo.length === 0) return false;
    const normalize = (s: string) => String(s || '').trim().toLowerCase();
    const stripNonLetters = (s: string) => String(s || '').toLowerCase().replace(/[^a-z]/g, '');
    const extractEmail = (s: string) => {
      const m = String(s || '').match(/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/i);
      return m ? m[0].toLowerCase() : null;
    };

    const myId = normalize(String((user as any)?.id || ''));
    const myEmail = normalize(String((user as any)?.email || ''));
    const myName = normalize(String((user as any)?.name || ''));
    const myInitials = myName ? stripNonLetters(myName) : '';

    for (const raw of task.assignedTo) {
      const val = normalize(String(raw));
      if (!val) continue;
      // direct comparisons
      if (val === myId || val === myEmail || val === myName || val === myInitials) return true;
      // embedded email
      const email = extractEmail(String(raw));
      if (email && email === myEmail) return true;
      // map via team members
      const member = (project.teamMembers || []).find(m => normalize(m?.id) === val || normalize(m?.name) === val || normalize(m?.email) === val);
      if (member) {
        const memName = normalize(String(member.name || ''));
        const memEmail = normalize(String(member.email || ''));
        const memInitials = memName ? stripNonLetters(memName) : '';
        if ((memName && memName === myName) || (memEmail && memEmail === myEmail) || (memInitials && memInitials === myInitials)) {
          return true;
        }
      }
    }
    return false;
  };

  // Handler Functions for Edit Modals
  const handleClientSave = async () => {
    if (!selectedClient || selectedClient.trim() === '') {
      alert('Please select a client');
      return;
    }

    try {
      const updatedProject = { ...project, client: selectedClient };
      
      const response = await fetch(`${API_BASE_URL}/api/projects/${project.id}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${localStorage.getItem('cognitive_dash_token')}`
        },
        body: JSON.stringify({
          userId: user?.id,
          project: updatedProject
        })
      });
      
      if (response.ok) {
        if (setProjects) {
          setProjects(prevProjects => prevProjects.map(p => p.id === updatedProject.id ? updatedProject : p));
        }
        if (onProjectUpdate) {
          onProjectUpdate(updatedProject);
        }
        setShowClientEdit(false);
      } else {
        alert('Failed to update client');
      }
    } catch (error) {
      console.error('Error updating client:', error);
      alert('Error updating client');
    }
  };

  const handleMethodologySave = async () => {
    if (!selectedMethodology || selectedMethodology.trim() === '') {
      alert('Please select a methodology');
      return;
    }

    try {
      const updatedProject = { ...project, methodology: selectedMethodology };
      
      const response = await fetch(`${API_BASE_URL}/api/projects/${project.id}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${localStorage.getItem('cognitive_dash_token')}`
        },
        body: JSON.stringify({
          userId: user?.id,
          project: updatedProject
        })
      });
      
      if (response.ok) {
        if (setProjects) {
          setProjects(prevProjects => prevProjects.map(p => p.id === updatedProject.id ? updatedProject : p));
        }
        if (onProjectUpdate) {
          onProjectUpdate(updatedProject);
        }
        setShowMethodologyEdit(false);
      } else {
        alert('Failed to update methodology');
      }
    } catch (error) {
      console.error('Error updating methodology:', error);
      alert('Error updating methodology');
    }
  };

  const handleModeratorSave = async () => {
    if (!selectedModerator || selectedModerator.trim() === '') {
      alert('Please select a moderator');
      return;
    }

    try {
      const updatedProject = { ...project, moderator: selectedModerator };
      
      const response = await fetch(`${API_BASE_URL}/api/projects/${project.id}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${localStorage.getItem('cognitive_dash_token')}`
        },
        body: JSON.stringify({
          userId: user?.id,
          project: updatedProject
        })
      });
      
      if (response.ok) {
        if (setProjects) {
          setProjects(prevProjects => prevProjects.map(p => p.id === updatedProject.id ? updatedProject : p));
        }
        if (onProjectUpdate) {
          onProjectUpdate(updatedProject);
        }
        setShowModeratorEdit(false);
      } else {
        alert('Failed to update moderator');
      }
    } catch (error) {
      console.error('Error updating moderator:', error);
      alert('Error updating moderator');
    }
  };

  const handleSampleDetailsSave = async () => {
    if (sampleSize <= 0) {
      alert('Sample size must be greater than 0');
      return;
    }

    // Validate subgroups
    if (subgroups.length > 0) {
      const subgroupTotal = subgroups.reduce((sum, sg) => sum + (sg.size || 0), 0);
      if (subgroupTotal !== sampleSize) {
        alert(`Subgroup total (${subgroupTotal}) must equal sample size (${sampleSize})`);
        return;
      }
    }

    try {
      const updatedProject = { ...project, sampleSize, subgroups };
      
      const response = await fetch(`${API_BASE_URL}/api/projects/${project.id}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${localStorage.getItem('cognitive_dash_token')}`
        },
        body: JSON.stringify({
          userId: user?.id,
          project: updatedProject
        })
      });
      
      if (response.ok) {
        if (setProjects) {
          setProjects(prevProjects => prevProjects.map(p => p.id === updatedProject.id ? updatedProject : p));
        }
        if (onProjectUpdate) {
          onProjectUpdate(updatedProject);
        }
        setShowSampleDetailsEdit(false);
      } else {
        alert('Failed to update sample details');
      }
    } catch (error) {
      console.error('Error updating sample details:', error);
      alert('Error updating sample details');
    }
  };

  return (
    <div className="space-y-6">
      {/* Main Layout with Sidebar */}
      <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
        {/* Main Content Area */}
        <div className="lg:col-span-3 space-y-6">
          {/* Overdue Tasks Box - Only show if there are overdue tasks */}
          {(() => {
            const today = new Date();
            today.setHours(0, 0, 0, 0);
            
            // Get overdue tasks for this project
            const overdueTasks = projectTasks.filter(task => {
              if (!task.dueDate) return false;
              if (task.status === 'completed') return false;
              if (task.isOngoing) return false;
              const taskDueDate = new Date(task.dueDate + 'T00:00:00');
              taskDueDate.setHours(0, 0, 0, 0);
              return taskDueDate.getTime() < today.getTime();
            });

            if (overdueTasks.length === 0) {
              return null;
            }

            return (
              <div className="mb-6">
                <Card className="!p-0 overflow-hidden rounded-none h-64">
                  <div className="px-3 py-2 flex items-center gap-2 bg-red-100">
                    <div className="flex-shrink-0">
                      <ExclamationTriangleIcon className="w-6 h-6 text-red-500" />
                    </div>
                    <div>
                      <h3 className="text-sm font-semibold text-red-700">Overdue Tasks ({overdueTasks.length})</h3>
                    </div>
                  </div>
                  <div className="border-b border-red-200"></div>
                  
                  <div className="px-3 pb-3 pt-2 h-52 overflow-hidden relative">
                    <div className="h-full overflow-y-auto">
                      <div className="space-y-1">
                        {overdueTasks.map(task => {
                          const isAssignedToMe = isAssignedToCurrentUser(task);
                          const assignedMembers = task.assignedTo && task.assignedTo.length > 0 
                            ? (() => {
                                const validMembers = task.assignedTo
                                  .map(id => project.teamMembers.find(member => member.id === id)?.name)
                                  .filter(name => name);
                                return validMembers.length > 0 ? validMembers.join(', ') : 'Not Assigned';
                              })()
                            : 'Not Assigned';

                          return (
                            <div
                              key={task.id}
                              className="p-1.5 bg-red-50 border border-red-100 rounded cursor-pointer hover:bg-red-100 transition-colors flex items-center justify-between"
                            >
                              <div className="flex-1 min-w-0">
                                <div className="text-xs font-medium text-red-900 truncate">
                                  {task.description || task.content || 'Untitled task'}
                                </div>
                                <div className="text-[10px] text-red-600 truncate mt-0.5">
                                  {assignedMembers}
                                </div>
                              </div>
                              <div className="flex-shrink-0 ml-2 text-right">
                                <div className="text-[10px] text-red-600 font-medium">
                                  {formatDateForDisplay(task.dueDate)}
                                </div>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                    <div className="absolute bottom-0 left-0 right-0 h-6 bg-gradient-to-t from-white to-transparent pointer-events-none"></div>
                  </div>
                </Card>
              </div>
            );
          })()}

          {/* Top Row: Today + Ongoing Tasks + Future Tasks */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {/* Today Box */}
            <Card className="!p-0 overflow-hidden rounded-none h-64">
          <div className="px-3 py-2 flex items-center justify-between" style={{ backgroundColor: BRAND.orange }}>
            <h3 className="text-base font-semibold text-red-200 uppercase">Today</h3>
            <span className="text-xs font-normal italic text-red-200">
              {new Date().toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}
            </span>
          </div>
          <div className="border-b border-gray-200"></div>

          {/* Tasks Due Today - Single List */}
          <div className="px-3 pb-3 pt-2 h-52 overflow-hidden relative">
            <div className="h-full overflow-y-auto">
              {(() => {
                const today = new Date();
                today.setHours(0, 0, 0, 0);
                const todayStr = today.toISOString().split('T')[0];

                // Get tasks due today only (exclude completed tasks, ongoing tasks, and overdue tasks)
                const allTasksToday = projectTasks.filter(task => {
                  if (!task.dueDate) return false;
                  if (task.status === 'completed') return false; // Exclude completed tasks
                  if (task.isOngoing) return false; // Exclude ongoing tasks
                  const taskDueDate = new Date(task.dueDate + 'T00:00:00');
                  taskDueDate.setHours(0, 0, 0, 0);
                  const isDueToday = taskDueDate.getTime() === today.getTime();
                  return isDueToday; // Only tasks due today, not overdue
                });

                // Sort with priority: assigned to me first, then others
                const sortedTasksToday = allTasksToday.sort((a, b) => {
                  // Assigned to me first
                  const aAssignedToMe = isAssignedToCurrentUser(a);
                  const bAssignedToMe = isAssignedToCurrentUser(b);
                  if (aAssignedToMe && !bAssignedToMe) return -1;
                  if (!aAssignedToMe && bAssignedToMe) return 1;
                  
                  return 0;
                });

                if (sortedTasksToday.length === 0) {
                  return <div className="text-xs italic text-gray-500">No tasks for today</div>;
                }

                // Limit to first 8 tasks to prevent overflow
                const maxTasks = 8;
                const tasksToShow = sortedTasksToday.slice(0, maxTasks);
                const remainingCount = sortedTasksToday.length - maxTasks;

                return (
                  <div className="space-y-1">
                    {tasksToShow.map(task => {
                      const taskDueDate = new Date(task.dueDate + 'T00:00:00');
                      const isOverdue = task.status !== 'completed' && taskDueDate.getTime() < today.getTime();
                      const isAssignedToMe = isAssignedToCurrentUser(task);
                      const isBold = isOverdue || isAssignedToMe;
                      
                      const assignedMembers = task.assignedTo && task.assignedTo.length > 0 
                        ? (() => {
                            const validMembers = task.assignedTo
                              .map(id => project.teamMembers.find(member => member.id === id)?.name)
                              .filter(name => name); // Remove undefined/null values
                            return validMembers.length > 0 ? validMembers.join(', ') : 'Not Assigned';
                          })()
                        : 'Not Assigned';

                      return (
                        <div
                          key={task.id}
                          className="p-1.5 bg-gray-50 border border-gray-100 rounded cursor-pointer hover:bg-gray-100 transition-colors"
                        >
                          <div className="text-xs font-medium text-gray-900 truncate">
                            {task.description || task.content || 'Untitled task'}
                          </div>
                          <div className="text-[10px] text-gray-500 truncate mt-0.5">
                            {assignedMembers}
                          </div>
                        </div>
                      );
                    })}
                    {remainingCount > 0 && (
                      <div className="text-[10px] text-gray-500 italic">
                        +{remainingCount} more tasks
                      </div>
                    )}
                  </div>
                );
              })()}
            </div>
            {/* Gradient overlay to indicate more content */}
            <div className="absolute bottom-0 left-0 right-0 h-6 bg-gradient-to-t from-white to-transparent pointer-events-none"></div>
          </div>
        </Card>

            {/* Ongoing Tasks Box */}
            <Card className="!p-0 overflow-hidden rounded-none h-64">
          <div className="px-3 py-2" style={{ backgroundColor: '#1E40AF' }}>
            <h3 className="text-base font-semibold text-blue-200 uppercase">Ongoing</h3>
          </div>
          <div className="border-b border-gray-200"></div>

          {/* Ongoing Tasks - Single List */}
          <div className="px-3 pb-3 pt-2 h-52 overflow-hidden relative">
            <div className="h-full overflow-y-auto">
              {(() => {
                // Get ongoing tasks for the current phase
                const ongoingTasks = projectTasks.filter(task => {
                  return task.isOngoing === true && 
                         task.phase === currentPhase && 
                         task.status !== 'completed' &&
                         task.assignedTo && task.assignedTo.length > 0;
                });

                // Sort with assigned to me first and bolded
                const sortedOngoingTasks = ongoingTasks.sort((a, b) => {
                  const aAssignedToMe = isAssignedToCurrentUser(a);
                  const bAssignedToMe = isAssignedToCurrentUser(b);
                  if (aAssignedToMe && !bAssignedToMe) return -1;
                  if (!aAssignedToMe && bAssignedToMe) return 1;
                  return 0;
                });

                if (sortedOngoingTasks.length === 0) {
                  return (
                    <div className="text-xs italic text-gray-500">
                      No ongoing tasks assigned
                    </div>
                  );
                }

                // Limit to first 8 tasks to prevent overflow
                const maxTasks = 8;
                const tasksToShow = sortedOngoingTasks.slice(0, maxTasks);
                const remainingCount = sortedOngoingTasks.length - maxTasks;

                return (
                  <div className="space-y-1">
                    {tasksToShow.map(task => {
                      const isAssignedToMe = isAssignedToCurrentUser(task);
                      const assignedMembers = task.assignedTo && task.assignedTo.length > 0 
                        ? (() => {
                            const validMembers = task.assignedTo
                              .map(id => project.teamMembers.find(member => member.id === id)?.name)
                              .filter(name => name); // Remove undefined/null values
                            return validMembers.length > 0 ? validMembers.join(', ') : 'Not Assigned';
                          })()
                        : 'Not Assigned';

                      return (
                        <div
                          key={task.id}
                          className="p-1.5 bg-gray-50 border border-gray-100 rounded cursor-pointer hover:bg-gray-100 transition-colors"
                        >
                          <div className="text-xs font-medium text-gray-900 truncate">
                            {task.description || task.content || 'Untitled task'}
                          </div>
                          <div className="text-[10px] text-gray-500 truncate mt-0.5">
                            {assignedMembers}
                          </div>
                        </div>
                      );
                    })}
                    {remainingCount > 0 && (
                      <div className="text-[10px] text-gray-500 text-center pt-1">
                        +{remainingCount} more ongoing task{remainingCount !== 1 ? 's' : ''}
                      </div>
                    )}
                  </div>
                );
              })()}
            </div>
            {/* Gradient overlay to indicate more content */}
            <div className="absolute bottom-0 left-0 right-0 h-6 bg-gradient-to-t from-white to-transparent pointer-events-none"></div>
          </div>
            </Card>

            {/* Future Tasks Box */}
            <Card className="!p-0 overflow-hidden rounded-none h-64">
          <div className="px-3 py-2 flex items-center justify-between" style={{ backgroundColor: '#5D5F62' }}>
            <h3 className="text-base font-semibold text-gray-200 uppercase">Future Tasks</h3>
            <span className="text-xs font-normal italic text-gray-200">(next 2 weeks)</span>
          </div>
          <div className="border-b border-gray-200"></div>

          {/* Future Tasks (next 2 weeks) - Single List */}
          <div className="px-3 pb-3 pt-2 h-52 overflow-hidden relative">
            <div className="h-full overflow-y-auto">
              {(() => {
                const today = new Date();
                today.setHours(0, 0, 0, 0);
                
                // Calculate 14 days from today
                const twoWeeksFromToday = new Date(today);
                twoWeeksFromToday.setDate(today.getDate() + 14);
                twoWeeksFromToday.setHours(23, 59, 59, 999);

                // Combine all tasks for the next 14 days (exclude ongoing tasks)
                const allFutureTasks = projectTasks.filter(task => {
                  if (task.status === 'completed') return false;
                  if (!task.dueDate) return false;
                  if (task.isOngoing) return false; // Exclude ongoing tasks

                  const taskDate = new Date(task.dueDate + 'T00:00:00');
                  taskDate.setHours(0, 0, 0, 0);

                  // Task must be after today AND within the next 14 days
                  const isAfterToday = taskDate.getTime() > today.getTime();
                  const isWithinTwoWeeks = taskDate.getTime() <= twoWeeksFromToday.getTime();

                  return isAfterToday && isWithinTwoWeeks;
                });

                // Sort by date (closest to furthest) and then by assigned to me
                const sortedFutureTasks = allFutureTasks.sort((a, b) => {
                  const aDate = new Date(a.dueDate + 'T00:00:00').getTime();
                  const bDate = new Date(b.dueDate + 'T00:00:00').getTime();
                  
                  // First sort by date (closest first)
                  if (aDate !== bDate) {
                    return aDate - bDate;
                  }
                  
                  // Then sort by assigned to me
                  const aAssignedToMe = isAssignedToCurrentUser(a);
                  const bAssignedToMe = isAssignedToCurrentUser(b);
                  if (aAssignedToMe && !bAssignedToMe) return -1;
                  if (!aAssignedToMe && bAssignedToMe) return 1;
                  return 0;
                });

                if (sortedFutureTasks.length === 0) {
                  return <div className="text-xs italic text-gray-500">No future tasks in the next 2 weeks</div>;
                }

                // Limit to first 8 tasks to prevent overflow
                const maxTasks = 8;
                const tasksToShow = sortedFutureTasks.slice(0, maxTasks);
                const remainingCount = sortedFutureTasks.length - maxTasks;

                return (
                  <div className="space-y-1">
                    {tasksToShow.map(task => {
                      const isAssignedToMe = isAssignedToCurrentUser(task);
                      const assignedMembers = task.assignedTo && task.assignedTo.length > 0 
                        ? (() => {
                            const validMembers = task.assignedTo
                              .map(id => project.teamMembers.find(member => member.id === id)?.name)
                              .filter(name => name); // Remove undefined/null values
                            return validMembers.length > 0 ? validMembers.join(', ') : 'Not Assigned';
                          })()
                        : 'Not Assigned';

                      return (
                        <div
                          key={task.id}
                          className="p-1.5 bg-gray-50 border border-gray-100 rounded cursor-pointer hover:bg-gray-100 transition-colors"
                        >
                          <div className="text-xs font-medium text-gray-900 truncate">
                            {task.description || task.content || 'Untitled task'}
                          </div>
                          <div className="text-[10px] text-gray-500 truncate mt-0.5">
                            {assignedMembers}
                          </div>
                        </div>
                      );
                    })}
                    {remainingCount > 0 && (
                      <div className="text-[10px] text-gray-500 italic">
                        +{remainingCount} more tasks
                      </div>
                    )}
                  </div>
                );
              })()}
            </div>
            {/* Gradient overlay to indicate more content */}
            <div className="absolute bottom-0 left-0 right-0 h-6 bg-gradient-to-t from-white to-transparent pointer-events-none"></div>
          </div>
        </Card>
          </div>

          {/* Main Content Area */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Tasks Section (container without white card) */}
            <div className="flex flex-col">
            {/* Phase Tabs */}
            <div className="mb-0">
              <div className="flex flex-wrap items-stretch w-full" style={{ marginRight: "-14px" }}>
                {PHASES.map((phase, index) => {
                  const phaseColor = PHASE_COLORS[phase as Phase];
                  const isActive = activePhase === phase;
                  return (
                    <button
                      key={phase}
                      className={`flex-1 px-3 py-1 text-xs font-medium transition-colors relative min-h-[32px] flex items-center justify-center ${
                        isActive
                          ? 'text-gray-900 z-10'
                          : 'text-gray-600 hover:text-gray-900 hover:bg-gray-50'
                      }`}
                      onClick={() => {
                        setActivePhase(phase as Phase);
                      }}
                      style={{
                          backgroundColor: isActive ? ((PHASE_COLORS[activePhase] || '#d1d5db') + '1A') : 'transparent',
                          borderTopLeftRadius: '6px',
                          borderTopRightRadius: '6px',
                          marginRight: '0',
                          marginLeft: index === 0 ? '0' : '-1px',
                          border: `1px solid ${isActive ? phaseColor : '#d1d5db'}`,
                          borderBottom: isActive ? 'none' : `1px solid ${PHASE_COLORS[activePhase] || '#d1d5db'}`,
                          position: 'relative',
                          zIndex: isActive ? 10 : 1,
                          minHeight: isActive ? '36px' : '32px',
                          paddingTop: isActive ? '6px' : '4px',
                          paddingBottom: isActive ? '6px' : '4px'
                      }}
                      >
                        {getPhaseDisplayName(phase)}
                      </button>
                  );
                })}
              </div>
            </div>

            {/* Tasks for Active Phase */}
            <div className="flex-1 flex flex-col min-h-0 border border-gray-200 border-t-0 rounded-b-lg bg-white" style={{ borderColor: PHASE_COLORS[activePhase] || '#d1d5db', overflow: 'visible' }}>
              {/* Column Headers (outside scroll) */}
              <div
                className="task-grid header-pad py-2"
                style={{ backgroundColor: ((PHASE_COLORS[activePhase] || '#d1d5db') + '24'), borderBottom: '0.5px solid #D1D5DB' }}
              >
                <div></div>
                <div className="min-w-0 flex items-center gap-2 -ml-1">
                  <span className="text-xs font-semibold text-gray-600 uppercase tracking-wide">Task</span>
                  {!showAddTask && (
                    <button
                      onClick={() => setShowAddTask(true)}
                      className="text-[11px] font-medium flex items-center gap-1 px-1 py-0.5 rounded"
                      title="Add task"
                      style={{ color: BRAND.orange, background: 'transparent' }}
                    >
                      + Add
                    </button>
                  )}
                </div>
                <div></div>
              </div>

              {/* Scrollable Task List (starts under headers) */}
              <div ref={taskContainerRef} className="h-96 overflow-y-auto thin-scrollbar px-3 pt-2 pb-3">
                {/* Add Task Form at top */}
                {showAddTask && (
                  <div className="mb-3 p-3 border rounded-lg bg-gray-50">
                    <div className="space-y-2">
                      <div className="flex gap-2 items-center">
                        <input
                          type="text"
                          value={newTask.description}
                          onChange={(e) => setNewTask(prev => ({ ...prev, description: e.target.value }))}
                          placeholder="Task description"
                          className="flex-1 text-xs border rounded px-0.5 sm:px-1 md:px-2 py-1 outline-none focus:ring-2 focus:ring-orange-200"
                        />
                        <select
                          value={newTask.assignedTo.length > 0 ? newTask.assignedTo[0] : ''}
                          onChange={(e) => {
                            const selectedValue = e.target.value;
                            if (selectedValue) {
                              setNewTask(prev => ({ ...prev, assignedTo: [selectedValue] }));
                            } else {
                              setNewTask(prev => ({ ...prev, assignedTo: [] }));
                            }
                          }}
                          className="text-xs border rounded px-0.5 sm:px-1 md:px-2 py-1 outline-none focus:ring-2 focus:ring-orange-200"
                        >
                          <option value="">Select assignee...</option>
                          {project.teamMembers.map(member => (
                            <option key={member.id} value={member.id}>{member.name}</option>
                          ))}
                        </select>
                      </div>
                      <div className="flex gap-2 items-center">
                        <label className="flex items-center gap-1 text-xs">
                          <input
                            type="checkbox"
                            checked={(newTask as any).isOngoing || false}
                            onChange={(e) => setNewTask(prev => ({ ...prev, isOngoing: e.target.checked }))}
                            className="rounded"
                          />
                          <span>Ongoing task (spans entire phase)</span>
                        </label>
                        {!((newTask as any).isOngoing) && (
                          <input
                            type="date"
                            value={(newTask as any).dueDate || ''}
                            onChange={(e) => setNewTask(prev => ({ ...prev, dueDate: e.target.value as any }))}
                            className="text-xs border rounded px-0.5 sm:px-1 md:px-2 py-1 outline-none focus:ring-2 focus:ring-orange-200"
                            title="Due date"
                          />
                        )}
                      </div>
                      <div className="flex gap-2 items-center">
                        {newTask.description.trim() && (
                          <button 
                            onClick={handleAddTask} 
                            className="px-2 py-1 text-xs text-white rounded hover:opacity-90 transition-colors"
                            style={{ backgroundColor: BRAND.orange }}
                          >
                            Add
                          </button>
                        )}
                        <button onClick={() => setShowAddTask(false)} className="px-2 py-1 text-xs border rounded hover:bg-gray-100">Cancel</button>
                      </div>
                    </div>
                  </div>
                )}
                <div className="space-y-2">
              {projectTasks
                .filter(task => task.phase === activePhase)
                .sort((a, b) => {
                  // Sort completed tasks to bottom
                  if (a.status === 'completed' && b.status !== 'completed') return 1;
                  if (a.status !== 'completed' && b.status === 'completed') return -1;

                  // Sort ongoing tasks to top (among non-completed tasks)
                  if (a.isOngoing && !b.isOngoing) return -1;
                  if (!a.isOngoing && b.isOngoing) return 1;

                  // Tasks with dates should come before tasks without dates
                  if (a.dueDate && !b.dueDate) return -1;
                  if (!a.dueDate && b.dueDate) return 1;

                  // If both have dates, sort by date ascending (earliest first)
                  if (a.dueDate && b.dueDate) {
                    return a.dueDate.localeCompare(b.dueDate);
                  }

                  return 0;
                })
                .map((task) => {
                  return (
                    <div key={task.id} className={`task-grid px-3 py-2 border rounded-lg ${isTaskOverdue(task) ? 'bg-red-50 hover:bg-red-100' : 'bg-gray-100 hover:bg-gray-50'}`}>
                      {/* Task Status Checkbox */}
                      <button
                        className={`w-3 h-3 rounded border-2 flex items-center justify-center text-[10px] ${
                          task.status === 'completed'
                            ? 'bg-green-500 border-green-500 text-white'
                            : 'border-gray-300 hover:border-gray-400'
                        }`}
                        onClick={() => toggleTaskCompletion(task.id)}
                      >
                        {task.status === 'completed' && '✓'}
                      </button>

                      {/* Task Description */}
                      <div className="min-w-0">
                        <div className={`text-[10px] flex items-center gap-2 ${task.status === 'completed' ? 'line-through text-gray-500' : 'text-gray-900'}`}>
                          <span>{task.description}</span>
                        </div>
                      </div>

                      {/* Assignment and Calendar Section */}
                      <div className="relative flex items-center justify-end ml-1">
                        {/* Team Member Avatars and Assignment Button */}
                        <div className="flex items-center gap-0.5">
                          {task.assignedTo && task.assignedTo.filter(id => id && id.trim() !== '').length > 0 && (
                            <div className="flex items-center flex-shrink-0">
                              {task.assignedTo.filter(id => id && id.trim() !== '').slice(0, 2).map((memberId, index) => (
                                <div key={memberId} className={`w-6 h-6 rounded-full flex items-center justify-center text-white text-[10px] font-medium overflow-hidden border-2 border-gray-100 ${index > 0 ? '-ml-1' : ''}`} style={{ backgroundColor: getMemberColor(memberId, project.teamMembers), zIndex: index === 0 ? 2 : 1 }}>
                                  <span className="truncate leading-none">{getInitials(project.teamMembers.find(m => m.id === memberId)?.name || 'Unknown')}</span>
                                </div>
                              ))}
                              {task.assignedTo.filter(id => id && id.trim() !== '').length > 2 && (
                                <div className="relative group flex items-center">
                                  <span className="text-[10px] italic text-gray-500 ml-0.5 mr-1 cursor-help">
                                    +{task.assignedTo.filter(id => id && id.trim() !== '').length - 2}
                                  </span>
                                  <div className="absolute hidden group-hover:block bg-gray-800 text-white text-xs rounded p-2 whitespace-nowrap z-10 left-0 top-8">
                                    {task.assignedTo.filter(id => id && id.trim() !== '').slice(2).map(id => project.teamMembers.find(m => m.id === id)?.name || 'Unknown').join(', ')}
                                  </div>
                                </div>
                              )}
                            </div>
                          )}

                          {/* Assignment Button */}
                          <button
                            onClick={(e) => {
                              const rect = e.currentTarget.getBoundingClientRect();
                              setAssignmentDropdownPosition({
                                top: rect.bottom + window.scrollY + 5,
                                left: rect.left + window.scrollX
                              });
                              setShowAssignmentDropdown(showAssignmentDropdown === task.id ? null : task.id);
                            }}
                            className="text-xs text-gray-400 hover:text-gray-600 transition-colors"
                            title="Assign team members"
                          >
                            +
                          </button>
                        </div>

                        {/* Calendar Icon for Due Date */}
                        <div className="ml-2">
                          {task.isOngoing ? (
                          <div className="px-1 py-0.5 rounded-full text-[8px] font-medium text-white"
                            style={{ backgroundColor: PHASE_COLORS[activePhase] || '#6B7280', opacity: 0.8 }}
                          >
                            Ongoing
                          </div>
                        ) : task.dueDate ? (
                          <div className="relative">
                            <div
                              className={`px-0.5 sm:px-1 md:px-2 py-1 rounded-full text-[8px] font-medium ${isTaskOverdue(task) ? 'text-red-600' : 'text-white opacity-60'}`}
                              style={{ backgroundColor: isTaskOverdue(task) ? 'rgba(239, 68, 68, 0.2)' : (PHASE_COLORS[activePhase] || '#6B7280') }}
                            >
                              {(() => {
                                const date = new Date(task.dueDate + 'T00:00:00');
                                const dateStr = `${date.getMonth() + 1}/${date.getDate()}`;
                                return dateStr;
                              })()}
                            </div>
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                const updatedTasks = projectTasks.map(t =>
                                  t.id === task.id ? { ...t, dueDate: undefined } : t
                                );
                                setProjectTasks(updatedTasks);
                                if (setProjects) {
                                  setProjects((prev: Project[]) =>
                                    prev.map(p =>
                                      p.id === project.id ? { ...p, tasks: updatedTasks } : p
                                    )
                                  );
                                }
                              }}
                              className="absolute text-xs text-gray-400 hover:text-red-500"
                              style={{ right: '-10px', top: '50%', transform: 'translateY(-50%)' }}
                              title="Remove due date"
                            >
                              ×
                            </button>
                          </div>
                        ) : (
                          <button
                            onClick={(e) => {
                              const rect = e.currentTarget.getBoundingClientRect();
                              setCalendarDropdownPosition({
                                top: rect.bottom + window.scrollY + 5,
                                left: rect.left + window.scrollX
                              });
                              setSelectedTaskForDate(task.id);
                              setShowCalendarDropdown(!showCalendarDropdown);
                            }}
                            className="p-1 rounded-lg transition-colors text-gray-400 hover:text-gray-600 hover:bg-gray-50"
                            title="Set due date"
                          >
                            <CalendarIcon className="h-3 w-3" />
                          </button>
                        )}
                        </div>

                        {/* Assignment Dropdown */}
                        {showAssignmentDropdown === task.id && createPortal(
                          <div className="assignment-dropdown fixed z-[9999] bg-white border border-gray-300 rounded-lg shadow-lg p-2 min-w-[200px]"
                            style={{
                              top: assignmentDropdownPosition?.top || '50%',
                              left: assignmentDropdownPosition?.left || '50%',
                              transform: assignmentDropdownPosition ? 'none' : 'translate(-50%, -50%)'
                            }}>
                            <div className="space-y-1">
                              {project.teamMembers.map(member => (
                                <label key={member.id} className="flex items-center gap-2 px-0.5 sm:px-1 md:px-2 py-1 hover:bg-gray-50 rounded cursor-pointer">
                                  <input
                                    type="checkbox"
                                    checked={task.assignedTo?.includes(member.id) || false}
                                    onChange={(e) => {
                                      const currentAssigned = task.assignedTo || [];
                                      const newAssigned = e.target.checked
                                        ? [...currentAssigned, member.id]
                                        : currentAssigned.filter(id => id !== member.id);
                                      updateTaskAssignment(task.id, newAssigned);
                                    }}
                                    className="rounded border-gray-300"
                                  />
                                  <span className="text-sm">{member.name}</span>
                                </label>
                              ))}
                            </div>
                          </div>,
                          document.body
                        )}
                        
                        {/* Calendar Dropdown */}
                        {showCalendarDropdown && selectedTaskForDate === task.id && createPortal(
                          <div 
                            className="calendar-dropdown fixed z-[9999] bg-white border rounded-lg shadow-lg p-4 w-80"
                            onClick={(e) => e.stopPropagation()}
                            style={{
                              top: calendarDropdownPosition?.top || '50%',
                              left: calendarDropdownPosition?.left || '50%',
                              transform: calendarDropdownPosition ? 'none' : 'translate(-50%, -50%)'
                            }}
                          >
                            <div className="flex justify-between items-center mb-3">
                              <h3 className="font-semibold text-sm">Select Due Date</h3>
                              <button
                                onClick={() => setShowCalendarDropdown(false)}
                                className="text-gray-400 hover:text-gray-600"
                              >
                                ×
                              </button>
                            </div>
                            <SimpleCalendar
                              selectedDate={task.dueDate || ''}
                              tasksWithDates={projectTasks
                                .filter(t => t.dueDate)
                                .map(t => ({ id: t.id, description: t.description, dueDate: t.dueDate! }))
                              }
                              onDateSelect={(date) => {
                                const updatedTasks = projectTasks.map(t =>
                                  t.id === task.id ? { ...t, dueDate: date } : t
                                );
                                setProjectTasks(updatedTasks);
                                if (setProjects) {
                                  setProjects((prev: Project[]) =>
                                    prev.map(p =>
                                      p.id === project.id ? { ...p, tasks: updatedTasks } : p
                                    )
                                  );
                                }
                                setShowCalendarDropdown(false);
                              }}
                              onTaskClick={(clickedTask) => {
                                const taskToShow = projectTasks.find(t => t.id === clickedTask.id);
                                if (taskToShow) {
                                  console.log('Task clicked:', taskToShow);
                                  setShowCalendarDropdown(false);
                                }
                              }}
                            />
                          </div>,
                          document.body
                        )}
                      </div>

                    </div>
                  );
                })}
                </div>

                {/* Show message if no tasks in this phase */}
                {projectTasks.filter(task => task.phase === activePhase).length === 0 && (
                  <div className="text-xs text-gray-500 py-1 text-center">
                    No tasks in {activePhase === 'Post-Field Analysis' ? 'Analysis' : activePhase} phase
                  </div>
                )}

                
              </div>
            </div>
            
            {/* Post-it Notes moved back under Calendar */}
          </div>

            {/* Right Half - Calendar, Key Dates, Files/Notes */}
            <div className="space-y-6">
          {/* Calendar */}
          <Card className="flex flex-col h-[500px] !p-0 overflow-hidden">
            {/* Calendar Navigation */}
            <div className="rounded-t-lg px-4 py-3 flex items-center justify-between" style={{ backgroundColor: BRAND.gray }}>
              <button
                onClick={() => {
                  setCurrentMonth(new Date(currentMonth.getFullYear(), currentMonth.getMonth() - 1));
                }}
                className="p-2 rounded-lg text-white hover:opacity-80"
              >
                <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                </svg>
              </button>
              <div className="flex items-center gap-3">
                <h4 className="text-lg font-semibold text-white">
                  {currentMonth.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}
                </h4>
              </div>
              <div className="flex items-center gap-2">
              <button
                onClick={() => {
                  setCurrentMonth(new Date(currentMonth.getFullYear(), currentMonth.getMonth() + 1));
                }}
                  className="p-2 rounded-lg text-white hover:opacity-80"
              >
                <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                </svg>
              </button>
                <button
                  onClick={() => setShowTimelineEditor(true)}
                  className="p-2 rounded-lg text-white hover:opacity-80"
                  title="Edit timeline"
                >
                  <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                </svg>
              </button>
              </div>
                  </div>

            {/* Phase Legend */}
            <div className="mb-4 text-center pt-4">
              <div className="flex flex-wrap justify-center gap-2">
                {project.segments?.map((segment, index) => (
                  <div key={`segment-${segment.phase}-${index}`} className="flex items-center gap-1">
                    <div
                      className="w-3 h-3 rounded-full opacity-60"
                      style={{ background: PHASE_COLORS[segment.phase] }}
                    />
                    <span className="text-xs text-gray-700">{getPhaseDisplayName(segment.phase)}</span>
                </div>
              ))}
            </div>
            </div>

            {/* Calendar Grid */}
            <div className="flex-1 p-4 flex flex-col">
              {/* Calendar grid */}
              {(() => {
                // Helper function to check if a date is in current week (Monday to Friday)
                const isCurrentWeek = (date: Date) => {
                  const today = new Date();
                  
                  // Get Monday of current week
                  const dayOfWeek = today.getDay();
                  const mondayOffset = dayOfWeek === 0 ? -6 : 1 - dayOfWeek; // Monday is day 1
                  const mondayOfWeek = new Date(today);
                  mondayOfWeek.setDate(today.getDate() + mondayOffset);
                  
                  // Get Friday of current week
                  const fridayOfWeek = new Date(mondayOfWeek);
                  fridayOfWeek.setDate(mondayOfWeek.getDate() + 4);
                  
                  // Reset time to start of day for accurate comparison
                  const dateStart = new Date(date.getFullYear(), date.getMonth(), date.getDate());
                  const mondayStart = new Date(mondayOfWeek.getFullYear(), mondayOfWeek.getMonth(), mondayOfWeek.getDate());
                  const fridayStart = new Date(fridayOfWeek.getFullYear(), fridayOfWeek.getMonth(), fridayOfWeek.getDate());
                  return dateStart >= mondayStart && dateStart <= fridayStart;
                };

                return getWeekGroups(getWorkWeekDays(currentMonth, true)).map((week, weekIndex) => (
                <div key={weekIndex} className="grid grid-cols-5 gap-1 flex-1 mb-2">
                  {Array.from({ length: 5 }, (_, dayIndex) => {
                    const dayObj = week[dayIndex];
                    if (!dayObj) {
                      return <div key={`${weekIndex}-${dayIndex}`} className="flex-1" />;
                    }

                    const dayDate = dayObj.date;
                    const isCurrentDay = isToday(dayDate);
                    const isCurrentWeekDay = isCurrentWeek(dayDate);
                    const isCurrentMonth = dayObj.isCurrentMonth;
                    const isPastDate = dayDate < new Date(new Date().setHours(0, 0, 0, 0));
                    
                    const phaseForDay = project.segments?.find(segment =>
                      isDateInPhase(dayObj, segment)
                    );
                    const hasKeyDate = hasKeyDateOnDay(dayObj.date);
                    const hasNote = hasNoteOnDay(dayObj.date);
                    const hasTask = hasTaskOnDay(dayObj.date);
                    const tasksForDate = getTasksForDate(dayObj.date);

                    return (
                      <div
                        key={`${weekIndex}-${dayIndex}`}
                        className={`relative p-3 text-center text-sm rounded-lg cursor-pointer hover:bg-gray-200 flex flex-col justify-between ${
                          isCurrentDay ? 'bg-gray-100' : isCurrentMonth ? 'bg-gray-100' : 'bg-white'
                        } ${isPastDate && !isCurrentWeekDay ? 'opacity-50' : ''}`}
                        style={{
                          backgroundColor: isCurrentWeekDay || isCurrentDay ? '#FED7AA40' : isCurrentMonth ? '#F3F4F6' : '#FFFFFF',
                          border: isCurrentDay ? '2px solid #D14A2D' : (!isCurrentMonth && !isCurrentWeekDay ? '1px solid #E5E7EB' : 'none'),
                          boxShadow: isCurrentDay ? '0 0 0 1px #D14A2D inset' : undefined
                        }}
                        title={phaseForDay ? `${phaseForDay.phase} phase` : 'No project activity'}
                        onClick={() => handleDayClick(dayDate)}
                      >
                        {/* Date number at top */}
                        <div className={`font-medium text-xs pt-1 relative z-10 ${
                          isCurrentDay ? 'text-gray-700' : isCurrentMonth ? 'text-gray-700' : isPastDate ? 'text-gray-500' : 'text-gray-400'
                        }`}>
                          {dayObj.day}
                        </div>

                        {/* Key date text in center */}
                        {hasKeyDate && (
                          <div className="absolute inset-0 flex items-center justify-center">
                            <div className={`text-[10px] italic truncate px-1 mt-2 ${
                              isCurrentMonth ? 'text-gray-600' : isPastDate ? 'text-gray-500' : 'text-gray-400'
                            }`}>
                              {getKeyDateTextForDay(dayObj.date)}
                            </div>
                          </div>
                        )}

                        {/* Note icon */}
                        {hasNote && (
                          <div className={`absolute top-1 right-1 z-10 ${isCurrentMonth ? 'opacity-60' : isPastDate ? 'opacity-40' : 'opacity-30'}`}>
                            <DocumentTextIcon
                              className="w-3 h-3"
                              style={{ color: phaseForDay ? PHASE_COLORS[phaseForDay.phase] : '#6B7280' }}
                            />
            </div>
          )}

                        {/* Task count indicator */}
                        {hasTask && tasksForDate.length > 0 && (() => {
                          const overdueTasks = getOverdueTasksForDate(dayObj.date);
                          const hasOverdue = overdueTasks.length > 0;
                          
                          return (
                          <div className={`absolute top-1 left-1 z-10 ${isCurrentMonth ? 'opacity-100' : isPastDate ? 'opacity-60' : 'opacity-50'}`}>
                            <div
                              className="w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-medium"
                              style={{
                                  color: hasOverdue ? '#DC2626' : '#374151',
                                  backgroundColor: hasOverdue ? '#FEE2E2' : (tasksForDate[0].phase ? (PHASE_COLORS[tasksForDate[0].phase] + '30') : '#9CA3AF30')
                              }}
                            >
                                {hasOverdue ? overdueTasks.length : tasksForDate.length}
                            </div>
            </div>
                          );
                        })()}

                        {/* Phase indicator pill at bottom */}
                        {phaseForDay && (
                          <div
                            className={`absolute bottom-1 left-1 right-1 h-2 rounded-full z-10 ${
                              isCurrentMonth ? 'opacity-60' : isPastDate ? 'opacity-40' : 'opacity-30'
                            }`}
                            style={{ background: PHASE_COLORS[phaseForDay.phase] }}
                          />
                        )}
                      </div>
                    );
                  })}
                </div>
              ));
              })()}
            </div>
        </Card>
            </div>
          </div>
        </div>

        {/* Project Details Sidebar - 4th Column */}
        <div className="lg:col-span-1">
          <Card className="!p-0 overflow-hidden rounded-none h-full">
            <div className="px-4 py-3 flex items-center gap-2" style={{ backgroundColor: BRAND.gray }}>
              <h3 className="text-lg font-semibold text-white">Project Details</h3>
            </div>
            <div className="flex-1 p-4 space-y-4">
              {/* Project Name */}
              <div className="pb-4 border-b border-gray-200">
                <div className="flex items-center justify-between mb-1">
                  <h4 className="text-sm font-semibold text-gray-600">Project Name</h4>
                  <button onClick={() => setShowProjectNameEdit(true)} className="text-gray-400 hover:text-gray-600 transition-colors" title="Edit project name">
                    <PencilIcon className="w-4 h-4" />
                  </button>
                </div>
                <p className="text-sm text-gray-700 break-words">{project.name || 'Untitled Project'}</p>
              </div>
              {/* Client */}
              <div className="pb-4 border-b border-gray-200">
                <div className="flex items-center justify-between mb-1">
                  <h4 className="text-sm font-semibold text-gray-600">Client</h4>
                  <button onClick={() => setShowClientEdit(true)} className="text-gray-400 hover:text-gray-600 transition-colors" title="Edit client">
                    <PencilIcon className="w-4 h-4" />
                  </button>
                </div>
                <p className="text-sm text-gray-700">{project.client || 'Not specified'}</p>
              </div>

              {/* Methodology */}
              <div className="pb-4 border-b border-gray-200">
                <div className="flex items-center justify-between mb-1">
                  <h4 className="text-sm font-semibold text-gray-600">Methodology</h4>
                  <button onClick={() => setShowMethodologyEdit(true)} className="text-gray-400 hover:text-gray-600 transition-colors" title="Edit methodology">
                    <PencilIcon className="w-4 h-4" />
                  </button>
                </div>
                <p className="text-sm text-gray-700">{project.methodology || 'Not specified'}</p>
              </div>

              {/* Moderator - Only for qualitative studies */}
              {(() => {
                const methodologyType = project.methodologyType ||
                  (project.methodology?.includes('Focus') || project.methodology?.includes('Interview') || project.methodology?.includes('Ethnographic') || 
                   project.name?.toLowerCase().includes('qual') ? 'Qualitative' : 'Quantitative');
                
                
                return methodologyType === 'Qualitative' || methodologyType === 'Qual';
              })() && (
                <div className="pb-4 border-b border-gray-200">
                  <div className="flex items-center justify-between mb-1">
                    <h4 className="text-sm font-semibold text-gray-600">Moderator</h4>
                    <button onClick={() => setShowModeratorEdit(true)} className="text-gray-400 hover:text-gray-600 transition-colors" title="Edit moderator">
                      <PencilIcon className="w-4 h-4" />
                    </button>
                  </div>
                  <p className="text-sm text-gray-700">
                    {localProject.moderator && localProject.moderator !== 'internal' && localProject.moderator !== 'external' && localProject.moderator !== 'vendor'
                      ? (moderators.find(m => m.id === localProject.moderator || m.name === localProject.moderator)?.name || localProject.moderator)
                      : 'Not assigned'}
                  </p>
                </div>
              )}

              {/* Sample Details */}
              <div className="pb-4 border-b border-gray-200">
                <div className="flex items-center justify-between mb-1">
                  <h4 className="text-sm font-semibold text-gray-600">Sample Details</h4>
                  <button onClick={() => setShowSampleDetailsEdit(true)} className="text-gray-400 hover:text-gray-600 transition-colors" title="Edit sample details">
                    <PencilIcon className="w-4 h-4" />
                  </button>
                </div>
                <div className="space-y-2">
                  <div>
                    <span className="text-xs font-medium text-gray-600">Total Sample: </span>
                    <span className="text-xs text-gray-700">
                      {project.sampleSize ? `n=${project.sampleSize}` : 'Not specified'}
                    </span>
                  </div>
                  <div>
                    <span className="text-xs font-medium text-gray-600 block mb-1">Subgroups:</span>
                    <div className="space-y-1">
                      {(() => {
                        if (project.subgroups && project.subgroups.length > 0) {
                          return project.subgroups.map((subgroup, idx) => (
                            <div key={idx} className="text-xs text-gray-700">
                              • {subgroup.name}: n={subgroup.size}
                            </div>
                          ));
                        }
                        return <p className="text-xs italic text-gray-500">No subgroups specified</p>;
                      })()}
                    </div>
                  </div>
                </div>
              </div>

              {/* Project Files */}
              <div className="pb-4 border-b border-gray-200">
                <div className="flex items-center justify-between mb-1">
                  <h4 className="text-sm font-semibold text-gray-600">Project Files</h4>
                </div>
                <div className="space-y-1">
                  {/* Transcripts - Only show if project has transcripts */}
                  {project.transcripts && project.transcripts.length > 0 && (
                    <button
                      onClick={() => {
                        // Show loading state
                        setIsLoadingProjectFile?.(true);
                        
                        setRoute?.('transcripts');
                        // Navigate directly to the first transcript for this project
                        if (project.transcripts.length > 0) {
                          window.dispatchEvent(new CustomEvent('openTranscript', { 
                            detail: { 
                              transcriptId: project.transcripts[0].id,
                              projectId: project.id 
                            } 
                          }));
                        }
                        
                        // Hide loading state after a short delay to allow navigation
                        setTimeout(() => {
                          setIsLoadingProjectFile?.(false);
                        }, 1500);
                      }}
                      className="w-full flex items-center gap-2 p-1 rounded hover:bg-gray-50 text-left"
                    >
                      <svg className="w-4 h-4 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                      </svg>
                      <span className="text-xs text-gray-700">Transcripts ({project.transcripts.length})</span>
                    </button>
                  )}
                  
                  {/* Content Analysis - Only show if project has content analyses */}
                  {savedContentAnalyses.filter(ca => ca.projectId === project.id).length > 0 && (
                    <button
                      onClick={() => {
                        // Show loading state
                        setIsLoadingProjectFile?.(true);
                        
                        // Set the current project ID for context
                        setCurrentProjectId(project.id);
                        
                        // Get the first content analysis for this project and navigate directly to it
                        const projectContentAnalyses = savedContentAnalyses.filter(ca => ca.projectId === project.id);
                        if (projectContentAnalyses.length > 0) {
                          const firstAnalysis = projectContentAnalyses[0];
                          setAnalysisToLoad?.(firstAnalysis.id);
                        }
                        setRoute?.('content-analysis');
                        
                        // Hide loading state after a short delay to allow navigation
                        setTimeout(() => {
                          setIsLoadingProjectFile?.(false);
                        }, 1500);
                      }}
                      className="w-full flex items-center gap-2 p-1 rounded hover:bg-gray-50 text-left"
                    >
                      <IconTable className="w-4 h-4 text-purple-600" />
                      <span className="text-xs text-gray-700">
                        {(() => {
                          const projectContentAnalyses = savedContentAnalyses.filter(ca => ca.projectId === project.id);
                          if (projectContentAnalyses.length > 0) {
                            return projectContentAnalyses[0].name || 'Content Analysis';
                          }
                          return 'Content Analysis';
                        })()}
                      </span>
                    </button>
                  )}
                  
                  {/* Storytelling - Only show if project has storytelling content */}
                  {project.storytelling && project.storytelling.length > 0 && (
                    <button
                      onClick={() => {
                        // Show loading state
                        setIsLoadingProjectFile?.(true);
                        
                        setRoute?.('storytelling');
                        // Navigate directly to the first storytelling content for this project
                        if (project.storytelling.length > 0) {
                          window.dispatchEvent(new CustomEvent('openStorytelling', { 
                            detail: { 
                              storytellingId: project.storytelling[0].id,
                              projectId: project.id 
                            } 
                          }));
                        }
                        
                        // Hide loading state after a short delay to allow navigation
                        setTimeout(() => {
                          setIsLoadingProjectFile?.(false);
                        }, 1500);
                      }}
                      className="w-full flex items-center gap-2 p-1 rounded hover:bg-gray-50 text-left"
                    >
                      <IconBook2 className="w-4 h-4 text-green-600" />
                      <span className="text-xs text-gray-700">Storytelling ({project.storytelling.length})</span>
                    </button>
                  )}
                  
                  {/* QNR - Only show if project has QNR content */}
                  {project.qnr && project.qnr.length > 0 && (
                    <button
                      onClick={() => {
                        // Show loading state
                        setIsLoadingProjectFile?.(true);
                        
                        setRoute?.('qnr');
                        // Navigate directly to the first QNR for this project
                        if (project.qnr.length > 0) {
                          window.dispatchEvent(new CustomEvent('openQNR', { 
                            detail: { 
                              qnrId: project.qnr[0].id,
                              projectId: project.id 
                            } 
                          }));
                        }
                        
                        // Hide loading state after a short delay to allow navigation
                        setTimeout(() => {
                          setIsLoadingProjectFile?.(false);
                        }, 1500);
                      }}
                      className="w-full flex items-center gap-2 p-1 rounded hover:bg-gray-50 text-left"
                    >
                      <svg className="w-4 h-4 text-orange-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v10a2 2 0 002 2h8a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-3 7h3m-3 4h3m-6-4h.01M9 16h.01" />
                      </svg>
                      <span className="text-xs text-gray-700">QNR ({project.qnr.length})</span>
                    </button>
                  )}
                  
                  {/* Discussion Guide - Only show if project has content analyses */}
                  {savedContentAnalyses.filter(ca => ca.projectId === project.id).length > 0 && (
                    <button
                      onClick={() => {
                        const projectContentAnalyses = savedContentAnalyses.filter(ca => ca.projectId === project.id);
                        if (projectContentAnalyses.length > 0) {
                          setSelectedDiscussionGuide(projectContentAnalyses[0].id);
                          setShowDiscussionGuideModal(true);
                        }
                      }}
                      className="w-full flex items-center gap-2 p-1 rounded hover:bg-gray-50 text-left"
                    >
                      <svg className="w-4 h-4 text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.746 0 3.332.477 4.5 1.253v13C19.832 18.477 18.246 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
                      </svg>
                      <span className="text-xs text-gray-700">Discussion Guide</span>
                    </button>
                  )}
                  
                  {/* Show message if no project files */}
                  {(!project.transcripts || project.transcripts.length === 0) &&
                   savedContentAnalyses.filter(ca => ca.projectId === project.id).length === 0 &&
                   (!project.storytelling || project.storytelling.length === 0) &&
                   (!project.qnr || project.qnr.length === 0) && (
                    <div className="text-xs text-gray-400 pl-3">
                      No project files yet
                    </div>
                  )}
                </div>
              </div>

            </div>
          </Card>
        </div>
      </div>



      {/* Add Key Date Modal */}
      {showAddKeyDate && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-start justify-center overflow-y-auto py-8 z-[9999] p-4" style={{ top: 0, left: 0, right: 0, bottom: 0 }}>
          <div className="bg-white rounded-2xl max-w-md w-full p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold">Add Key Date</h3>
              <button
                onClick={() => setShowAddKeyDate(false)}
                className="text-gray-400 hover:text-gray-600"
              >
                <svg className="h-6 w-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Date Label</label>
                <input
                  type="text"
                  value={newKeyDate.label}
                  onChange={(e) => setNewKeyDate(prev => ({ ...prev, label: e.target.value }))}
                  placeholder="e.g., Client Review, Internal Checkpoint..."
                  className="w-full border rounded-lg px-3 py-2 outline-none focus:ring-2 focus:ring-orange-200"
                />
              </div>
              
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Date</label>
                <input
                  type="date"
                  value={newKeyDate.date}
                  onChange={(e) => setNewKeyDate(prev => ({ ...prev, date: e.target.value }))}
                  className="w-full border rounded-lg px-3 py-2 outline-none focus:ring-2 focus:ring-orange-200"
                />
              </div>

              <div className="flex justify-end gap-2">
                <button
                  onClick={() => setShowAddKeyDate(false)}
                  className="px-4 py-2 text-sm border rounded-lg hover:bg-gray-50"
                >
                  Cancel
                </button>
                <button
                  onClick={handleAddKeyDate}
                  className="px-4 py-2 text-sm text-white rounded-lg"
                  style={{ backgroundColor: BRAND.orange }}
                  onMouseEnter={(e) => e.target.style.backgroundColor = '#e67e22'}
                  onMouseLeave={(e) => e.target.style.backgroundColor = BRAND.orange}
                >
                  Add Key Date
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Add Note Modal */}
      {showAddNote && createPortal(
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-[9999] p-4" style={{ margin: 0 }}>
          <div className="bg-white rounded-2xl max-w-md w-full p-6 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold">Add Project Note</h3>
              <button
                onClick={() => setShowAddNote(false)}
                className="text-gray-400 hover:text-gray-600"
              >
                <svg className="h-6 w-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Title</label>
                <input
                  type="text"
                  value={newNote.title}
                  onChange={(e) => setNewNote(prev => ({ ...prev, title: e.target.value }))}
                  placeholder="Note title..."
                  className="w-full border rounded-lg px-3 py-2 outline-none focus:ring-2"
                  style={{ '--tw-ring-color': `${BRAND.orange}33` } as React.CSSProperties}
                />
              </div>
              
              <div className="relative">
                <label className="block text-sm font-medium text-gray-700 mb-1">Note Body</label>
                <div
                  ref={textareaRef}
                  contentEditable
                  onInput={handleTextareaChange}
                  placeholder="Write your note here... Use @ to mention team members"
                  className="w-full border rounded-lg px-3 py-2 outline-none focus:ring-2 min-h-[100px]"
                  style={{ whiteSpace: 'pre-wrap', '--tw-ring-color': `${BRAND.orange}33` } as React.CSSProperties}
                  suppressContentEditableWarning={true}
                />
                
                {/* Mention Dropdown */}
                {showMentionDropdown && (
                  <div className="absolute z-10 mt-1 w-full bg-white border border-gray-300 rounded-lg shadow-lg max-h-40 overflow-y-auto">
                    {filteredMembers.length > 0 ? (
                      filteredMembers.map((member) => (
                        <button
                          key={member.id}
                          onClick={() => handleMentionSelect(member)}
                          className="w-full px-3 py-2 text-left hover:bg-gray-100 flex items-center gap-2"
                        >
                          <div className="w-6 h-6 rounded-full flex items-center justify-center text-white text-xs font-medium" style={{ backgroundColor: getMemberColor(member.id, project.teamMembers) }}>
                            {getInitials(member.name)}
              </div>
                          <span className="text-sm">{member.name}</span>
                        </button>
                      ))
                    ) : (
                      <div className="px-3 py-2 text-sm text-gray-500">No members found</div>
                    )}
                  </div>
                )}
              </div>


              <div className="flex justify-end gap-2">
                <button
                  onClick={() => setShowAddNote(false)}
                  className="px-4 py-2 text-sm border rounded-lg hover:bg-gray-50"
                >
                  Cancel
                </button>
                <button
                  onClick={handleAddNote}
                  className="px-4 py-2 text-sm text-white rounded-lg hover:opacity-90"
                  style={{ backgroundColor: BRAND.orange }}
                >
                  Add Note
                </button>
              </div>
            </div>
          </div>
        </div>,
        document.body
      )}

      {/* Add File Modal */}
      {showAddFileModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-start justify-center overflow-y-auto py-8 z-[9999] p-4">
          <div className="bg-white rounded-2xl max-w-md w-full p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold">Add Project File</h3>
              <button
                onClick={() => {
                  setShowAddFileModal(false);
                  setNewFileUrl('');
                }}
                className="text-gray-400 hover:text-gray-600"
              >
                <svg className="h-6 w-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">SharePoint Link</label>
                <p className="text-xs text-gray-500 mb-2">
                  Copy and paste the URL from the SharePoint file you want to upload
                </p>
                <input
                  type="text"
                  value={newFileUrl}
                  onChange={(e) => setNewFileUrl(e.target.value)}
                  placeholder="Paste SharePoint file link..."
                  className="w-full border rounded-lg px-3 py-2 outline-none focus:ring-2 focus:ring-orange-200"
                />
                <p className="text-xs text-gray-500 mt-1">
                  The file name and type will be automatically extracted from the link
                </p>
              </div>

              <div className="flex justify-end gap-2">
                <button
                  onClick={() => {
                    setShowAddFileModal(false);
                    setNewFileUrl('');
                  }}
                  className="px-4 py-2 text-sm border rounded-lg hover:bg-gray-50"
                >
                  Cancel
                </button>
                <button
                  onClick={handleAddFile}
                  className="px-4 py-2 text-sm text-white rounded-lg hover:opacity-90"
                  style={{ backgroundColor: BRAND.orange }}
                >
                  Add File
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Day Details Popup */}
      {selectedDay && (
        <div className="fixed inset-0 bg-black bg-opacity-30 flex items-center justify-center z-[9999]" style={{ margin: 0, padding: 0, top: 0, left: 0, right: 0, bottom: 0 }}>
          <div className="bg-white rounded-2xl max-w-2xl w-full mx-4 p-6 shadow-xl">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold">{selectedDay.date.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}</h3>
              <button
                onClick={() => setSelectedDay(null)}
                className="text-gray-400 hover:text-gray-600"
              >
                <svg className="h-6 w-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            
            <div className="space-y-4">
              <div>
                <h4 className="font-medium text-gray-900 mb-2">Phase</h4>
                <span className="px-3 py-1 rounded-full text-sm text-white opacity-60" style={{ background: PHASE_COLORS[selectedDay.phase as Phase] || '#6B7280' }}>
                  {selectedDay.phase}
                </span>
              </div>
              
              {selectedDay.deadlines.length > 0 && (
                <div>
                  <h4 className="font-medium text-gray-900 mb-2">Key Dates</h4>
                  <ul className="space-y-1">
                    {selectedDay.deadlines.map((deadline, index) => (
                      <li key={`selected-day-deadline-${deadline}-${index}`} className="text-sm text-gray-600 flex items-center gap-2">
                        <div className="w-2 h-2 0 rounded-full"></div>
                        {deadline}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              
              {selectedDay.notes.length > 0 && (
                <div>
                  <h4 className="font-medium text-gray-900 mb-2">Notes</h4>
                  <ul className="space-y-2">
                    {getNotesForDay(selectedDay.day).map((note, index) => (
                      <li key={note.id} className="text-sm">
                        <div className="font-medium text-gray-900">{note.title}</div>
                        <div className="text-gray-600 text-xs mt-1">{note.body}</div>
                        <div className="text-gray-400 text-xs mt-1">
                          {new Date(note.createdAt).toLocaleDateString()} by {note.createdBy}
                        </div>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              
              {selectedDay.tasks.length > 0 && (
                <div className="space-y-4">
                  {/* Incomplete Tasks */}
                  {selectedDay.tasks.filter(task => task.status !== 'completed').length > 0 && (
                <div>
                      <h4 className="font-medium text-gray-900 mb-2">Incomplete Tasks</h4>
                      <div className="space-y-2">
                        {selectedDay.tasks
                          .filter(task => task.status !== 'completed')
                          .sort((a, b) => {
                            const userAssignedToA = a.assignedTo && a.assignedTo.includes(user?.id);
                            const userAssignedToB = b.assignedTo && b.assignedTo.includes(user?.id);
                            const aIsSoloAssigned = a.assignedTo && a.assignedTo.length === 1 && userAssignedToA;
                            const bIsSoloAssigned = b.assignedTo && b.assignedTo.length === 1 && userAssignedToB;
                            const aIsMultiAssigned = a.assignedTo && a.assignedTo.length > 1 && userAssignedToA;
                            const bIsMultiAssigned = b.assignedTo && b.assignedTo.length > 1 && userAssignedToB;
                            
                            // Priority: Solo assigned to user > Multi assigned to user > Not assigned to user
                            if (aIsSoloAssigned && !bIsSoloAssigned) return -1;
                            if (!aIsSoloAssigned && bIsSoloAssigned) return 1;
                            if (aIsMultiAssigned && !bIsMultiAssigned && !bIsSoloAssigned) return -1;
                            if (!aIsMultiAssigned && bIsMultiAssigned && !aIsSoloAssigned) return 1;
                            return 0;
                          })
                          .map((task) => {
                          const isAssignedToUser = task.assignedTo && task.assignedTo.includes(user?.id);
                          const userColor = isAssignedToUser ? getMemberColor(user?.id || '', project.teamMembers) : null;
                          const isOverdue = task.status !== 'completed' && selectedDay.date < new Date(new Date().setHours(0, 0, 0, 0));
                          
                      return (
                            <div key={task.id} className={`grid grid-cols-12 gap-2 items-center p-3 rounded-lg ${
                              isAssignedToUser ? 'bg-opacity-20 border' : 'bg-gray-50'
                            }`} style={isAssignedToUser ? {
                              backgroundColor: userColor + '10',
                              borderColor: userColor
                            } : {}}>
                              {/* Checkbox - 1 column */}
                              <div className="col-span-1 flex justify-center">
                                <button
                                  onClick={() => {
                                    const updatedTasks = projectTasks.map(t =>
                                      t.id === task.id 
                                        ? { ...t, status: t.status === 'completed' ? 'incomplete' : 'completed' }
                                        : t
                                    );
                                    setProjectTasks(updatedTasks);
                                    if (setProjects) {
                                      setProjects((prev: Project[]) =>
                                        prev.map(p =>
                                          p.id === project.id ? { ...p, tasks: updatedTasks } : p
                                        )
                                      );
                                    }
                                    // Update the selectedDay tasks to reflect the change
                                    setSelectedDay(prev => prev ? {
                                      ...prev,
                                      tasks: prev.tasks.map(t =>
                                        t.id === task.id 
                                          ? { ...t, status: t.status === 'completed' ? 'incomplete' : 'completed' }
                                          : t
                                      )
                                    } : null);
                                  }}
                                  className="w-4 h-4 rounded border-2 border-gray-300 flex items-center justify-center hover:border-gray-400 transition-colors"
                                >
                                  {task.status === 'completed' ? (
                                    <svg className="w-3 h-3 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                                    </svg>
                                  ) : null}
                                </button>
                              </div>
                              
                              {/* Task Description - 7 columns */}
                              <div className="col-span-7">
                                <span className={`text-sm ${task.status === 'completed' ? 'line-through text-gray-500' : 'text-gray-900'}`}>
                                  {task.description}
                                </span>
                              </div>
                              
                              {/* Status - 2 columns */}
                              <div className="col-span-2 flex justify-center">
                                <span className={`px-3 py-1 rounded-full text-xs font-medium whitespace-nowrap ${
                                  isOverdue ? 'bg-red-100 text-red-800' :
                                  task.status === 'completed' ? 'bg-green-100 text-green-800' :
                                  task.status === 'in-progress' ? 'bg-blue-100 text-blue-800' :
                                  'bg-gray-100 text-gray-800'
                                }`}>
                                  {isOverdue ? 'overdue' : (task.status === 'pending' ? 'incomplete' : task.status.replace('-', ' '))}
                                </span>
                              </div>
                              
                              {/* Assigned Member Initials - 2 columns */}
                              <div className="col-span-2 flex justify-center">
                              {task.assignedTo && task.assignedTo.filter(id => id && id.trim() !== '').length > 0 ? (
                                <div className="flex items-center gap-1">
                                  {task.assignedTo.filter(id => id && id.trim() !== '').slice(0, 2).map((memberId) => {
                                    const assignedMember = project.teamMembers.find(m => m.id === memberId);
                                    return (
                                      <div key={memberId} className="w-6 h-6 rounded-full flex items-center justify-center text-white text-xs font-medium"
                                           style={{ backgroundColor: getMemberColor(memberId, project.teamMembers) }}>
                                        {getInitials(assignedMember?.name || 'Unknown')}
                                      </div>
                                    );
                                  })}
                                  {task.assignedTo.filter(id => id && id.trim() !== '').length > 2 && (
                                    <div className="relative group">
                                      <span className="text-xs italic text-gray-500 ml-1 cursor-help">
                                        +{task.assignedTo.filter(id => id && id.trim() !== '').length - 2}
                                      </span>
                                      <div className="absolute hidden group-hover:block bg-gray-800 text-white text-xs rounded p-2 whitespace-nowrap z-10 left-0 top-8">
                                        {task.assignedTo.filter(id => id && id.trim() !== '').slice(2).map(id => project.teamMembers.find(m => m.id === id)?.name || 'Unknown').join(', ')}
                                      </div>
                                    </div>
                                  )}
                                </div>
                              ) : (
                                  <div className="w-6 h-6"></div>
                                )}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  {/* Complete Tasks */}
                  {selectedDay.tasks.filter(task => task.status === 'completed').length > 0 && (
                    <div>
                      <h4 className="font-medium text-gray-900 mb-2">Complete Tasks</h4>
                      <div className="space-y-2">
                        {selectedDay.tasks
                          .filter(task => task.status === 'completed')
                          .sort((a, b) => {
                            const userAssignedToA = a.assignedTo && a.assignedTo.includes(user?.id);
                            const userAssignedToB = b.assignedTo && b.assignedTo.includes(user?.id);
                            const aIsSoloAssigned = a.assignedTo && a.assignedTo.length === 1 && userAssignedToA;
                            const bIsSoloAssigned = b.assignedTo && b.assignedTo.length === 1 && userAssignedToB;
                            const aIsMultiAssigned = a.assignedTo && a.assignedTo.length > 1 && userAssignedToA;
                            const bIsMultiAssigned = b.assignedTo && b.assignedTo.length > 1 && userAssignedToB;
                            
                            // Priority: Solo assigned to user > Multi assigned to user > Not assigned to user
                            if (aIsSoloAssigned && !bIsSoloAssigned) return -1;
                            if (!aIsSoloAssigned && bIsSoloAssigned) return 1;
                            if (aIsMultiAssigned && !bIsMultiAssigned && !bIsSoloAssigned) return -1;
                            if (!aIsMultiAssigned && bIsMultiAssigned && !aIsSoloAssigned) return 1;
                            return 0;
                          })
                          .map((task) => {
                          const isAssignedToUser = task.assignedTo && task.assignedTo.includes(user?.id);
                          const userColor = isAssignedToUser ? getMemberColor(user?.id || '', project.teamMembers) : null;
                          const isOverdue = task.status !== 'completed' && selectedDay.date < new Date(new Date().setHours(0, 0, 0, 0));
                          
                          return (
                            <div key={task.id} className={`grid grid-cols-12 gap-2 items-center p-3 rounded-lg ${
                              isAssignedToUser ? 'bg-opacity-20 border' : 'bg-gray-50'
                            }`} style={isAssignedToUser ? {
                              backgroundColor: userColor + '10',
                              borderColor: userColor
                            } : {}}>
                              {/* Checkbox - 1 column */}
                              <div className="col-span-1 flex justify-center">
                                <button
                                  onClick={() => {
                                    const updatedTasks = projectTasks.map(t =>
                                      t.id === task.id 
                                        ? { ...t, status: t.status === 'completed' ? 'incomplete' : 'completed' }
                                        : t
                                    );
                                    setProjectTasks(updatedTasks);
                                    if (setProjects) {
                                      setProjects((prev: Project[]) =>
                                        prev.map(p =>
                                          p.id === project.id ? { ...p, tasks: updatedTasks } : p
                                        )
                                      );
                                    }
                                    // Update the selectedDay tasks to reflect the change
                                    setSelectedDay(prev => prev ? {
                                      ...prev,
                                      tasks: prev.tasks.map(t =>
                                        t.id === task.id 
                                          ? { ...t, status: t.status === 'completed' ? 'incomplete' : 'completed' }
                                          : t
                                      )
                                    } : null);
                                  }}
                                  className="w-4 h-4 rounded border-2 border-gray-300 flex items-center justify-center hover:border-gray-400 transition-colors"
                                >
                                  {task.status === 'completed' ? (
                                    <svg className="w-3 h-3 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                                    </svg>
                                  ) : null}
                                </button>
                            </div>
                              
                              {/* Task Description - 7 columns */}
                              <div className="col-span-7">
                                <span className={`text-sm ${task.status === 'completed' ? 'line-through text-gray-500' : 'text-gray-900'}`}>
                                  {task.description}
                                </span>
                              </div>
                              
                              {/* Status - 2 columns */}
                              <div className="col-span-2 flex justify-center">
                                <span className={`px-3 py-1 rounded-full text-xs font-medium whitespace-nowrap ${
                                  isOverdue ? 'bg-red-100 text-red-800' :
                              task.status === 'completed' ? 'bg-green-100 text-green-800' :
                              task.status === 'in-progress' ? 'bg-blue-100 text-blue-800' :
                              'bg-gray-100 text-gray-800'
                            }`}>
                                  {isOverdue ? 'overdue' : (task.status === 'pending' ? 'incomplete' : task.status.replace('-', ' '))}
                            </span>
                          </div>
                              
                              {/* Assigned Member Initials - 2 columns */}
                              <div className="col-span-2 flex justify-center">
                                {task.assignedTo && task.assignedTo.filter(id => id && id.trim() !== '').length > 0 ? (
                                  <div className="flex items-center gap-1">
                                    {task.assignedTo.filter(id => id && id.trim() !== '').slice(0, 2).map((memberId) => {
                                      const assignedMember = project.teamMembers.find(m => m.id === memberId);
                                      return (
                                        <div key={memberId} className="w-6 h-6 rounded-full flex items-center justify-center text-white text-xs font-medium"
                                             style={{ backgroundColor: getMemberColor(memberId, project.teamMembers) }}>
                                          {getInitials(assignedMember?.name || 'Unknown')}
                                        </div>
                      );
                    })}
                                    {task.assignedTo.filter(id => id && id.trim() !== '').length > 2 && (
                                      <div className="relative group">
                                        <span className="text-xs italic text-gray-500 ml-1 cursor-help">
                                          +{task.assignedTo.filter(id => id && id.trim() !== '').length - 2}
                                        </span>
                                        <div className="absolute hidden group-hover:block bg-gray-800 text-white text-xs rounded p-2 whitespace-nowrap z-10 left-0 top-8">
                                          {task.assignedTo.filter(id => id && id.trim() !== '').slice(2).map(id => project.teamMembers.find(m => m.id === id)?.name || 'Unknown').join(', ')}
                                        </div>
                                      </div>
                                    )}
                                  </div>
                                ) : (
                                  <div className="w-6 h-6"></div>
                                )}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </div>
              )}
              
              {selectedDay.deadlines.length === 0 && selectedDay.notes.length === 0 && selectedDay.tasks.length === 0 && (
                <div className="text-sm text-gray-500 text-center py-4">
                  No key dates, notes, or tasks for this day
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Moderator Selection Modal */}
      {showModeratorModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-[9999]" style={{ margin: 0, padding: 0, top: 0, left: 0, right: 0, bottom: 0 }}>
          <div className="bg-white rounded-lg p-6 max-w-md w-full max-h-[80vh] overflow-y-auto" style={{ margin: '2rem' }}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold">Select Moderator</h3>
              <button
                onClick={() => setShowModeratorModal(false)}
                className="text-gray-400 hover:text-gray-600"
              >
                <XMarkIcon className="w-6 h-6" />
              </button>
            </div>

            {/* Field Date Info */}
            {project.segments && project.segments.find(seg => seg.phase === 'Fielding' || seg.phase === 'Pre-Field') && (
              <div className="mb-4 p-3 bg-gray-50 rounded-lg">
                <div className="text-sm font-medium text-gray-700 mb-1">Field Dates</div>
                <div className="text-sm text-gray-600">
                  {(() => {
                    const fieldingSegment = project.segments.find(seg => seg.phase === 'Fielding' || seg.phase === 'Pre-Field');
                    return fieldingSegment && fieldingSegment.startDate && fieldingSegment.endDate
                      ? `${formatDateForDisplay(fieldingSegment.startDate)} - ${formatDateForDisplay(fieldingSegment.endDate)}`
                      : 'Not set';
                  })()}
                </div>
              </div>
            )}

            {/* Remove Assignment Option */}
            {localProject.moderator && localProject.moderator !== 'internal' && localProject.moderator !== 'external' && localProject.moderator !== 'vendor' && (
              <div className="mb-4">
                <button
                  onClick={() => handleModeratorAssignment('')}
                  className="w-full p-3 text-left border border-red-200 rounded-lg bg-red-50 hover:bg-red-100 transition-colors"
                >
                  <div className="flex items-center gap-2">
                    <XMarkIcon className="w-4 h-4 text-red-600" />
                    <div>
                      <div className="font-medium text-red-900">Remove Current Assignment</div>
                      <div className="text-sm text-red-600">Unassign {localProject.moderator}</div>
                    </div>
                  </div>
                </button>
              </div>
            )}

            <div className="space-y-2">
              {(() => {
                const availableModerators = getAvailableModerators();
                const unavailableModerators = moderators.filter(m => !availableModerators.includes(m));

                return (
                  <>
                    {/* Available Moderators */}
                    {availableModerators.length > 0 && (
                      <>
                        <div className="text-sm font-medium text-gray-700 mb-2">Available During Field Dates</div>
                        {availableModerators.map((moderator) => (
                          <button
                            key={moderator.id}
                            onClick={() => handleModeratorAssignment(moderator.id)}
                            className="w-full p-3 text-left border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors"
                          >
                            <div className="font-medium text-gray-900">{moderator.name}</div>
                            <div className="text-sm text-gray-500">{moderator.company || moderator.email}</div>
                            {moderator.specialties && moderator.specialties.length > 0 && (
                              <div className="flex flex-wrap gap-1 mt-1">
                                {moderator.specialties.map((specialty: string, index: number) => (
                                  <span key={index} className="px-0.5 sm:px-1 md:px-2 py-0.5 bg-green-100 text-green-700 text-xs rounded opacity-60">
                                    {specialty}
                                  </span>
                                ))}
                              </div>
                            )}
                          </button>
                        ))}
                      </>
                    )}

                    {/* Unavailable Moderators */}
                    {unavailableModerators.length > 0 && (
                      <>
                        {availableModerators.length > 0 && <div className="border-t pt-4 mt-4"></div>}
                        <div className="text-sm font-medium text-gray-700 mb-2">
                          Unavailable (Scheduling Conflicts)
                        </div>
                        {unavailableModerators.map((moderator) => (
                          <button
                            key={moderator.id}
                            onClick={() => handleModeratorAssignment(moderator.id)}
                            className="w-full p-3 text-left border border-red-200 rounded-lg bg-red-50 hover:bg-red-100 transition-colors"
                          >
                            <div className="font-medium text-gray-900">{moderator.name}</div>
                            <div className="text-sm text-red-600">
                              {moderator.company || moderator.email} • Has conflicts
                            </div>
                            {moderator.specialties && moderator.specialties.length > 0 && (
                              <div className="flex flex-wrap gap-1 mt-1">
                                {moderator.specialties.map((specialty: string, index: number) => (
                                  <span key={index} className="px-0.5 sm:px-1 md:px-2 py-0.5 bg-red-200 text-red-700 text-xs rounded">
                                    {specialty}
                                  </span>
                                ))}
                              </div>
                            )}
                          </button>
                        ))}
                      </>
                    )}

                    {moderators.length === 0 && (
                      <div className="text-center py-8">
                        <UserGroupIcon className="mx-auto h-12 w-12 text-gray-400" />
                        <h3 className="mt-2 text-sm font-medium text-gray-900">No moderators found</h3>
                        <p className="mt-1 text-sm text-gray-500">Add moderators in the Vendor Library first.</p>
                      </div>
                    )}
                  </>
                );
              })()}
            </div>

            <div className="mt-6 flex justify-end">
              <button
                onClick={() => setShowModeratorModal(false)}
                className="px-4 py-2 text-sm text-gray-600 hover:text-gray-800"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Notes Modal */}
      {showNotesModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-start justify-center overflow-y-auto py-8 z-[10101]">
          <div className="bg-white rounded-lg shadow-xl max-w-4xl w-full mx-4 my-auto max-h-[80vh] overflow-hidden">
            <div className="flex items-center justify-between p-6 border-b">
              <h2 className="text-xl font-semibold text-gray-900">All Sticky Notes</h2>
              <button
                onClick={() => setShowNotesModal(false)}
                className="text-gray-400 hover:text-gray-600"
              >
                <XMarkIcon className="h-6 w-6" />
              </button>
            </div>
            
            <div className="p-6 overflow-y-auto max-h-[60vh]">
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {projectNotes
                  .filter(note => note.postToProjectPage)
                  .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
                  .map((note) => (
                    <div key={note.id} className="bg-yellow-100 p-4 rounded-lg shadow-lg border-l-4 border-yellow-300">
                      <div className="flex items-start justify-between mb-2">
                        <div className="flex items-center gap-2">
                          <div className="w-5 h-5 rounded-full flex items-center justify-center text-white text-xs font-medium" style={{ fontSize: '10px', backgroundColor: getMemberColor(note.createdBy, project.teamMembers) }}>
                            {getInitials(project.teamMembers.find(m => m.id === note.createdBy)?.name || note.createdBy)}
                          </div>
                          {/* Tagged members icons */}
                          {note.taggedMembers && note.taggedMembers.length > 0 && (
                            <div className="flex gap-1">
                              {note.taggedMembers.slice(0, 2).map((memberId, index) => {
                                const member = project.teamMembers.find(m => m.id === memberId);
                                const memberColor = member ? getMemberColor(memberId, project.teamMembers) : '#6B7280';
                                return member ? (
                                  <div key={memberId} className="w-5 h-5 rounded-full flex items-center justify-center text-white text-xs font-medium" style={{ zIndex: 10 - index, backgroundColor: memberColor, fontSize: '10px' }}>
                                    {getInitials(member.name)}
                                  </div>
                                ) : null;
                              })}
                              {note.taggedMembers.length > 2 && (
                                <div className="w-5 h-5 rounded-full bg-gray-400 flex items-center justify-center text-white text-xs font-medium" style={{ fontSize: '10px' }}>
                                  +{note.taggedMembers.length - 2}
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                        <div className="flex items-center gap-2">
                          <span className="text-xs text-gray-500 italic">{formatShortDate(note.createdAt)}</span>
                          <button
                            onClick={() => handleArchiveNote(note.id)}
                            className="text-xs text-gray-500 hover:text-red-500 transition-colors"
                            title="Archive note"
                          >
                            <ArchiveBoxIcon className="h-4 w-4" />
                          </button>
                        </div>
                      </div>
                      <p className="text-sm text-gray-700 leading-relaxed" dangerouslySetInnerHTML={{ __html: note.body }}></p>
                      
                      {/* Comments section */}
                      {note.comments && note.comments.length > 0 && (
                        <div className="mt-3 space-y-2">
                          {note.comments.map((comment) => (
                            <div key={comment.id} className="flex items-start gap-2 p-2 bg-yellow-50 rounded">
                              <div className="w-4 h-4 rounded-full flex items-center justify-center text-white text-xs font-medium flex-shrink-0" style={{ fontSize: '8px', backgroundColor: getMemberColor(comment.author, project.teamMembers) }}>
                                {getInitials(project.teamMembers.find(m => m.id === comment.author)?.name || comment.author)}
                              </div>
                              <div className="flex-1 min-w-0">
                                <p className="text-xs text-gray-700">{comment.text}</p>
                                <p className="text-xs text-gray-500 italic">{formatShortDate(comment.createdAt)}</p>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}

                      {/* Add comment section */}
                      <div className="mt-3 space-y-2">
                        <div className="flex gap-2">
                          <input
                            type="text"
                            value={modalSelectedNote?.id === note.id ? modalNewComment : ''}
                            onChange={(e) => {
                              if (modalSelectedNote?.id === note.id) {
                                setModalNewComment(e.target.value);
                              } else {
                                setModalSelectedNote(note);
                                setModalNewComment(e.target.value);
                              }
                            }}
                            placeholder="Add a comment..."
                            className="flex-1 text-xs border rounded px-0.5 sm:px-1 md:px-2 py-1 outline-none focus:ring-1 focus:ring-orange-200"
                            onClick={(e) => e.stopPropagation()}
                          />
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              handleModalAddComment(note.id);
                            }}
                            className="px-0.5 sm:px-1 md:px-2 py-1 text-xs 0 text-white rounded hover:bg-orange-600"
                          >
                            Post
                          </button>
                        </div>
                      </div>
                    </div>
                  ))}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Expanded Note Modal */}
      {selectedNote && createPortal(
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-[9999] p-4" style={{ margin: 0 }}>
          <div className="bg-yellow-100 rounded-lg shadow-xl max-w-2xl w-full p-6 border-l-4 border-yellow-300 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <div className="w-6 h-6 rounded-full flex items-center justify-center text-white text-xs font-medium" style={{ backgroundColor: getMemberColor(selectedNote.createdBy, project.teamMembers) }}>
                  {getInitials(project.teamMembers.find(m => m.id === selectedNote.createdBy)?.name || selectedNote.createdBy)}
                </div>
                <span className="text-xs text-gray-500 italic">{formatShortDate(selectedNote.createdAt)}</span>
              </div>
              <button
                onClick={() => setSelectedNote(null)}
                className="text-gray-400 hover:text-gray-600"
              >
                <XMarkIcon className="h-6 w-6" />
              </button>
            </div>

            <div className="mb-4">
              <p className="text-gray-700 leading-relaxed" dangerouslySetInnerHTML={{ __html: selectedNote.body }}></p>
            </div>

            {/* Comments section */}
            {selectedNote.comments && selectedNote.comments.length > 0 && (
              <div className="mb-4 space-y-2 max-h-48 overflow-y-auto">
                <h4 className="font-medium text-sm text-gray-900">Comments</h4>
                {selectedNote.comments.map((comment) => (
                  <div key={comment.id} className="flex items-start gap-2 p-2 bg-yellow-50 rounded">
                    <div className="w-5 h-5 rounded-full flex items-center justify-center text-white text-xs font-medium flex-shrink-0" style={{ fontSize: '10px', backgroundColor: getMemberColor(comment.author, project.teamMembers) }}>
                      {getInitials(project.teamMembers.find(m => m.id === comment.author)?.name || comment.author)}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm text-gray-700">{comment.text}</p>
                      <p className="text-xs text-gray-500 italic">{formatShortDate(comment.createdAt)}</p>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* Add comment input and archive button */}
            <div className="space-y-2">
              <div className="flex gap-2">
                <input
                  type="text"
                  value={newComment}
                  onChange={(e) => setNewComment(e.target.value)}
                  placeholder="Add a comment..."
                  className="flex-1 border rounded-lg px-3 py-2 outline-none focus:ring-2"
                  style={{ '--tw-ring-color': `${BRAND.orange}33` } as React.CSSProperties}
                />
                <button
                  onClick={() => handleAddComment(selectedNote.id)}
                  className="px-4 py-2 text-white rounded-lg hover:opacity-90"
                  style={{ backgroundColor: BRAND.orange }}
                >
                  Post
                </button>
              </div>
              <div className="flex justify-end">
                <button
                  onClick={() => {
                    handleArchiveNote(selectedNote.id);
                    setSelectedNote(null);
                  }}
                  className="text-sm text-gray-600 hover:text-red-600 flex items-center gap-1"
                >
                  <ArchiveBoxIcon className="h-4 w-4" />
                  Archive Note
                </button>
              </div>
            </div>
          </div>
        </div>,
        document.body
      )}

      {/* Timeline Editor Modal */}
      {showTimelineEditor && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-start justify-center overflow-y-auto py-8 z-[99999]" style={{ margin: 0, padding: 0, top: 0, left: 0, right: 0, bottom: 0 }}>
          <div className="bg-white rounded-lg shadow-xl max-w-4xl w-full mx-4 my-auto max-h-[80vh] overflow-hidden">
            <div className="flex items-center justify-between p-4 border-b">
              <h2 className="text-xl font-semibold text-gray-900">Edit Project Timeline</h2>
              <button
                onClick={() => setShowTimelineEditor(false)}
                className="text-gray-400 hover:text-gray-600"
              >
                <XMarkIcon className="h-6 w-6" />
              </button>
            </div>
            
            <div className="p-4 overflow-y-auto max-h-[60vh]">
              <div className="space-y-4">
                {/* Phase Segments */}
                <div>
                  <h3 className="text-lg font-semibold text-gray-900 mb-3">Project Phases</h3>
                  <div className="space-y-3">
                    {editingSegments.map((segment, index) => (
                      <div key={index} className="flex items-center gap-4 p-3 border rounded-lg">
                        <div className="flex items-center gap-2">
                        <span 
                          className="px-3 py-1 rounded-full text-sm font-medium text-white text-center whitespace-nowrap opacity-60"
                          style={{ 
                            backgroundColor: PHASE_COLORS[segment.phase],
                            minWidth: '140px'
                          }}
                        >
                          {getPhaseDisplayName(segment.phase)}
                        </span>
                        </div>
                        <div className="flex items-center gap-2">
                          <label className="text-sm text-gray-600">Start:</label>
                          <input
                            type="date"
                            value={segment.startDate}
                            onChange={(e) => handlePhaseDateChange(index, 'startDate', e.target.value)}
                            className="border rounded px-0.5 sm:px-1 md:px-2 py-1 text-sm"
                          />
                        </div>
                        {segment.phase !== 'Kickoff' && (
                          <div className="flex items-center gap-2">
                            <label className="text-sm text-gray-600">End:</label>
                            <input
                              type="date"
                              value={segment.endDate}
                              onChange={(e) => handlePhaseDateChange(index, 'endDate', e.target.value)}
                              className="border rounded px-0.5 sm:px-1 md:px-2 py-1 text-sm"
                            />
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </div>

              </div>
            </div>

            <div className="flex justify-end gap-3 p-4 border-t">
              <button
                onClick={() => setShowTimelineEditor(false)}
                className="px-4 py-2 text-sm text-gray-600 hover:text-gray-800"
              >
                Cancel
              </button>
              <button
                onClick={async () => {
                  // Update project with new segments and key dates
                  const updatedProject = {
                    ...project,
                    segments: editingSegments,
                    keyDeadlines: projectKeyDates
                  };

                  // Update local state
                  if (setProjects) {
                    setProjects((prev: Project[]) =>
                      prev.map(p => p.id === project.id ? updatedProject : p)
                    );
                  }

                  // Save to backend
                  try {
                    await fetch(`${API_BASE_URL}/api/projects/${project.id}`, {
                      method: 'PUT',
                      headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${localStorage.getItem('cognitive_dash_token')}`
                      },
                      body: JSON.stringify({
                        userId: user?.id,
                        project: updatedProject
                      })
                    });
                  } catch (error) {
                    console.error('Error saving timeline:', error);
                  }

                  setShowTimelineEditor(false);
                }}
                className="px-4 py-2 text-sm text-white rounded hover:bg-orange-600"
                style={{ backgroundColor: BRAND.orange }}
              >
                Save Timeline
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Client Edit Modal */}
      {showClientEdit && createPortal(
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-[10101]" style={{ top: 0, left: 0, right: 0, bottom: 0 }}>
          <div className="bg-white rounded-lg p-6 max-w-md w-full mx-4">
            <h3 className="text-lg font-semibold mb-4">Edit Client</h3>
            <select
              value={selectedClient}
              onChange={(e) => setSelectedClient(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2"
              style={{ '--tw-ring-color': BRAND.orange } as React.CSSProperties}
            >
              <option value="">Select client</option>
              {existingClients.map((client) => (
                <option key={client} value={client}>
                  {client}
                </option>
              ))}
            </select>
            <div className="flex gap-2 mt-4">
              <button
                onClick={handleClientSave}
                className="flex-1 px-4 py-2 text-white rounded-md transition"
                style={{ backgroundColor: BRAND.orange }}
              >
                Save
              </button>
              <button
                onClick={() => {
                  setShowClientEdit(false);
                  setSelectedClient(project.client || '');
                }}
                className="flex-1 px-4 py-2 bg-gray-200 rounded-md hover:bg-gray-300 transition"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}

      {/* Project Name Edit Modal */}
      {showProjectNameEdit && createPortal(
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-[10101]" style={{ top: 0, left: 0, right: 0, bottom: 0 }}>
          <div className="bg-white rounded-lg p-6 max-w-md w-full mx-4">
            <h3 className="text-lg font-semibold mb-4">Edit Project Name</h3>
            <input
              type="text"
              value={selectedProjectName}
              onChange={(e) => setSelectedProjectName(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2"
              style={{ '--tw-ring-color': BRAND.orange } as React.CSSProperties}
              placeholder="Enter project name"
            />
            <div className="flex gap-2 mt-4">
              <button
                onClick={async () => {
                  const trimmed = (selectedProjectName || '').trim();
                  if (!trimmed) { alert('Please enter a project name'); return; }
                  const updatedProject = { ...project, name: trimmed };
                  setLocalProject(updatedProject);
                  if (setProjects) {
                    setProjects(prev => prev.map(p => p.id === updatedProject.id ? updatedProject : p));
                  }
                  if (onProjectUpdate) {
                    onProjectUpdate(updatedProject);
                  }
                  await saveProjectField('name', trimmed);
                  setShowProjectNameEdit(false);
                }}
                className="flex-1 px-4 py-2 text-white rounded-md transition"
                style={{ backgroundColor: BRAND.orange }}
              >
                Save
              </button>
              <button
                onClick={() => { setShowProjectNameEdit(false); setSelectedProjectName(project.name || ''); }}
                className="flex-1 px-4 py-2 bg-gray-200 rounded-md hover:bg-gray-300 transition"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}

      {/* Methodology Edit Modal */}
      {showMethodologyEdit && createPortal(
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-[10101]" style={{ top: 0, left: 0, right: 0, bottom: 0 }}>
          <div className="bg-white rounded-lg p-6 max-w-md w-full mx-4">
            <h3 className="text-lg font-semibold mb-4">Edit Methodology</h3>
            <select
              value={selectedMethodology}
              onChange={(e) => setSelectedMethodology(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2"
              style={{ '--tw-ring-color': BRAND.orange } as React.CSSProperties}
            >
              {METHODOLOGIES.map((methodology) => (
                <option key={methodology} value={methodology}>
                  {methodology}
                </option>
              ))}
            </select>
            <div className="flex gap-2 mt-4">
              <button
                onClick={handleMethodologySave}
                className="flex-1 px-4 py-2 text-white rounded-md transition"
                style={{ backgroundColor: BRAND.orange }}
              >
                Save
              </button>
              <button
                onClick={() => {
                  setShowMethodologyEdit(false);
                  setSelectedMethodology(project.methodology || '');
                }}
                className="flex-1 px-4 py-2 bg-gray-200 rounded-md hover:bg-gray-300 transition"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}

      {/* Moderator Edit Modal */}
      {showModeratorEdit && createPortal(
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-[10101]" style={{ top: 0, left: 0, right: 0, bottom: 0 }}>
          <div className="bg-white rounded-lg p-6 max-w-md w-full mx-4">
            <h3 className="text-lg font-semibold mb-4">Edit Moderator</h3>
            <select
              value={selectedModerator}
              onChange={(e) => setSelectedModerator(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2"
              style={{ '--tw-ring-color': BRAND.orange } as React.CSSProperties}
            >
              <option value="">Select moderator</option>
              {moderators.map((mod: any) => (
                <option key={mod.id} value={mod.id}>
                  {mod.name}
                </option>
              ))}
            </select>
            <div className="flex gap-2 mt-4">
              <button
                onClick={handleModeratorSave}
                className="flex-1 px-4 py-2 text-white rounded-md transition"
                style={{ backgroundColor: BRAND.orange }}
              >
                Save
              </button>
              <button
                onClick={() => {
                  setShowModeratorEdit(false);
                  setSelectedModerator(project.moderator || '');
                }}
                className="flex-1 px-4 py-2 bg-gray-200 rounded-md hover:bg-gray-300 transition"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}

      {/* Sample Details Edit Modal */}
      {showSampleDetailsEdit && createPortal(
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-[10101]" style={{ top: 0, left: 0, right: 0, bottom: 0 }}>
          <div className="bg-white rounded-lg p-6 max-w-2xl w-full mx-4 max-h-[90vh] overflow-y-auto">
            <h3 className="text-lg font-semibold mb-4">Edit Sample Details</h3>
            
            {/* Sample Size */}
            <div className="mb-4">
              <label className="block text-sm font-medium mb-2">Total Sample Size</label>
              <input
                type="number"
                value={sampleSize}
                onChange={(e) => setSampleSize(parseInt(e.target.value) || 0)}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2"
                style={{ '--tw-ring-color': BRAND.orange } as React.CSSProperties}
                min="0"
              />
            </div>

            {/* Add Subgroup Button */}
            <button
              type="button"
              onClick={() => {
                if (sampleSize && sampleSize > 0) {
                  const newSubgroup = { id: Date.now().toString(), name: '', size: 0 };
                  setSubgroups([...subgroups, newSubgroup]);
                }
              }}
              disabled={!sampleSize || sampleSize <= 0}
              className="mb-4 px-4 py-2 text-white rounded-md transition disabled:bg-gray-300 disabled:cursor-not-allowed"
              style={{ backgroundColor: sampleSize > 0 ? BRAND.orange : undefined }}
            >
              Add Subgroup
            </button>

            {/* Subgroups Table */}
            {subgroups.length > 0 && (
              <div className="mb-4">
                <label className="block text-sm font-medium mb-2">
                  Subgroups (Total: {subgroups.reduce((sum, sg) => sum + (sg.size || 0), 0)} / {sampleSize})
                </label>
                <table className="min-w-full divide-y divide-gray-200 border">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="px-4 py-2 text-left text-xs font-medium text-gray-700">Subgroup Name</th>
                      <th className="px-4 py-2 text-left text-xs font-medium text-gray-700">Size</th>
                      <th className="px-4 py-2 text-left text-xs font-medium text-gray-700">Action</th>
                    </tr>
                  </thead>
                  <tbody className="bg-white divide-y divide-gray-200">
                    {subgroups.map((subgroup, index) => (
                      <tr key={subgroup.id}>
                        <td className="px-4 py-3">
                          <input
                            type="text"
                            value={subgroup.name}
                            onChange={(e) => {
                              const updatedSubgroups = [...subgroups];
                              updatedSubgroups[index] = { ...subgroup, name: e.target.value };
                              setSubgroups(updatedSubgroups);
                            }}
                            className="w-full px-2 py-1 border border-gray-300 rounded focus:outline-none focus:ring-1"
                            style={{ '--tw-ring-color': BRAND.orange } as React.CSSProperties}
                            placeholder="e.g., HCPs"
                          />
                        </td>
                        <td className="px-4 py-3">
                          <input
                            type="number"
                            value={subgroup.size || ''}
                            onChange={(e) => {
                              const updatedSubgroups = [...subgroups];
                              updatedSubgroups[index] = { ...subgroup, size: parseInt(e.target.value) || 0 };
                              setSubgroups(updatedSubgroups);
                            }}
                            className="w-full px-2 py-1 border border-gray-300 rounded focus:outline-none focus:ring-1"
                            style={{ '--tw-ring-color': BRAND.orange } as React.CSSProperties}
                            min="0"
                          />
                        </td>
                        <td className="px-4 py-3">
                          <button
                            type="button"
                            onClick={() => {
                              const updatedSubgroups = subgroups.filter((_, i) => i !== index);
                              setSubgroups(updatedSubgroups);
                            }}
                            className="text-red-600 hover:text-red-800 text-sm"
                          >
                            Remove
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            <div className="flex gap-2 mt-4">
              <button
                onClick={handleSampleDetailsSave}
                className="flex-1 px-4 py-2 text-white rounded-md transition"
                style={{ backgroundColor: BRAND.orange }}
              >
                Save
              </button>
              <button
                onClick={() => {
                  setShowSampleDetailsEdit(false);
                  setSampleSize(project.sampleSize || 0);
                  setSubgroups(project.subgroups || []);
                }}
                className="flex-1 px-4 py-2 bg-gray-200 rounded-md hover:bg-gray-300 transition"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}
      
      {/* Discussion Guide Modal */}
      {showDiscussionGuideModal && selectedDiscussionGuide && (() => {
        const analysis = savedContentAnalyses.find(a => a.id === selectedDiscussionGuide);
        if (!analysis || !analysis.projectId) return null;
        
        return createPortal(
          <div
            className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-[99999] p-4"
            onClick={() => setShowDiscussionGuideModal(false)}
          >
            <div className="bg-white rounded-lg w-full max-w-4xl max-h-[85vh] flex flex-col overflow-hidden" onClick={(e) => e.stopPropagation()}>
              <div className="flex items-center justify-between p-4 border-b border-gray-200">
                <h3 className="text-lg font-semibold text-gray-900">{analysis.name} - Discussion Guide</h3>
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
        );
      })()}
    </div>
  );
}


function ProjectDetailView({ project, onClose, onEdit, onArchive }: { project: Project; onClose: () => void; onEdit: () => void; onArchive: (projectId: string) => void }) {
  // Helper functions for calendar
  const hasNoteOnDay = (date: Date) => {
    const currentYear = date.getFullYear();
    const currentMonthNum = date.getMonth();
    const currentDay = date.getDate();

    return project.notes?.some(note => {
      if (!note.date) return false;
      try {
        const noteDate = new Date(note.date);
        return noteDate.getFullYear() === currentYear &&
               noteDate.getMonth() === currentMonthNum &&
               noteDate.getDate() === currentDay;
      } catch (error) {
        return false;
      }
    }) || false;
  };

  const hasKeyDateOnDay = (date: Date) => {
    const currentYear = date.getFullYear();
    const currentMonthNum = date.getMonth();
    const currentDay = date.getDate();
    
    return project.keyDeadlines?.some(keyDate => {
      try {
        // Safety check for keyDate.date
        if (!keyDate.date || typeof keyDate.date !== 'string') {
          console.warn('Invalid keyDate.date:', keyDate.date);
          return false;
        }
        
        // Handle different date formats
        let keyDateObj;
        
        if (keyDate.date.includes('/')) {
          // MM/DD/YY format
          const [month, day, year] = keyDate.date.split('/');
          const fullYear = parseInt(year) < 50 ? 2000 + parseInt(year) : 1900 + parseInt(year);
          keyDateObj = new Date(fullYear, parseInt(month) - 1, parseInt(day));
        } else if (keyDate.date.includes('-')) {
          // YYYY-MM-DD format
          const [year, month, day] = keyDate.date.split('-');
          keyDateObj = new Date(parseInt(year), parseInt(month) - 1, parseInt(day));
        } else {
          // Try parsing as is
          keyDateObj = new Date(keyDate.date);
        }
        
        // Check if the date is valid
        if (isNaN(keyDateObj.getTime())) {
          console.warn('Invalid key date:', keyDate.date);
          return false;
        }
        
        // Compare year, month, and day directly
        return keyDateObj.getFullYear() === currentYear &&
               keyDateObj.getMonth() === currentMonthNum &&
               keyDateObj.getDate() === currentDay;
      } catch (error) {
        console.warn('Error parsing key date:', keyDate.date, error);
        return false;
      }
    }) || false;
  };


  const getKeyDateTextForDay = (date: Date) => {
    const currentYear = date.getFullYear();
    const currentMonthNum = date.getMonth();
    const currentDay = date.getDate();

    const keyDate = project.keyDeadlines?.find(keyDate => {
      try {
        // Safety check for keyDate.date
        if (!keyDate.date || typeof keyDate.date !== 'string') {
          console.warn('Invalid keyDate.date:', keyDate.date);
          return false;
        }
        
        // Handle different date formats
        let keyDateObj;
        
        if (keyDate.date.includes('/')) {
          // MM/DD/YY format
          const [month, day, year] = keyDate.date.split('/');
          const fullYear = parseInt(year) < 50 ? 2000 + parseInt(year) : 1900 + parseInt(year);
          keyDateObj = new Date(fullYear, parseInt(month) - 1, parseInt(day));
        } else if (keyDate.date.includes('-')) {
          // YYYY-MM-DD format
          const [year, month, day] = keyDate.date.split('-');
          keyDateObj = new Date(parseInt(year), parseInt(month) - 1, parseInt(day));
        } else {
          // Try parsing as is
          keyDateObj = new Date(keyDate.date);
        }
        
        // Check if the date is valid
        if (isNaN(keyDateObj.getTime())) {
          console.warn('Invalid key date:', keyDate.date);
          return false;
        }
        
        // Compare year, month, and day directly
        return keyDateObj.getFullYear() === currentYear &&
               keyDateObj.getMonth() === currentMonthNum &&
               keyDateObj.getDate() === currentDay;
      } catch (error) {
        console.warn('Error parsing key date:', keyDate.date, error);
        return false;
      }
    });
    return keyDate ? keyDate.label : null;
  };

  const currentPhase = getCurrentPhase(project);
  const phaseColor = PHASE_COLORS[currentPhase];
  const [showAddTask, setShowAddTask] = useState(false);
  const [newTask, setNewTask] = useState({ description: "", assignedTo: [] as string[], status: "pending" as Task['status'], dueDate: "" });
  const [currentMonth, setCurrentMonth] = useState(new Date());
  const [editingTimeline, setEditingTimeline] = useState(false);
  const [editingSegments, setEditingSegments] = useState(project.segments || []);
  const [activePhase, setActivePhase] = useState(getCurrentPhase(project));
  const [projectTasks, setProjectTasks] = useState(project.tasks || []);
  const [maxVisibleTasks, setMaxVisibleTasks] = useState(8);
  const taskContainerRef = useRef<HTMLDivElement>(null);
  const [showAllTasks, setShowAllTasks] = useState(false);

  // Sync projectTasks with project.tasks when it changes (e.g., after role-based assignment)
  useEffect(() => {
    if (project.tasks) {
      setProjectTasks(project.tasks);
    }
  }, [project.tasks]);

  // Function to calculate optimal number of tasks to display
  const calculateMaxTasks = useCallback(() => {
    if (!taskContainerRef.current) return 8;
    
    const container = taskContainerRef.current;
    const calendarHeight = 300; // Smaller height for mobile
    const taskItemHeight = 48; // Approximate height of each task item (including padding)
    const maxTasks = Math.floor(calendarHeight / taskItemHeight);
    
    return Math.max(3, Math.min(maxTasks, 10)); // Min 3, max 10 tasks for mobile
  }, []);

  // Update max visible tasks when active phase changes
  useEffect(() => {
    setMaxVisibleTasks(calculateMaxTasks());
  }, [activePhase, calculateMaxTasks]);


  const getNotesForDay = (day: number) => {
    const currentDate = new Date(currentMonth.getFullYear(), currentMonth.getMonth(), day);
    const currentYear = currentDate.getFullYear();
    const currentMonthNum = currentDate.getMonth();
    const currentDay = currentDate.getDate();
    
    return project.notes?.filter(note => {
      if (!note.date) return false;
      
      try {
        // Parse date consistently without timezone issues
        const noteDate = new Date(note.date);
        if (isNaN(noteDate.getTime())) return false;

        // Use UTC methods to avoid timezone shifts
        return noteDate.getUTCFullYear() === currentYear &&
               noteDate.getUTCMonth() === currentMonthNum &&
               noteDate.getUTCDate() === currentDay;
      } catch (error) {
        console.warn('Error parsing note date:', note.date, error);
        return false;
      }
    }) || [];
  };

  // Helper function to get next workday
  const getNextWorkday = (date: string) => {
    const dateObj = new Date(date);
    dateObj.setDate(dateObj.getDate() + 1);
    
    // Skip weekends
    while (dateObj.getDay() === 0 || dateObj.getDay() === 6) {
      dateObj.setDate(dateObj.getDate() + 1);
    }
    
    return dateObj.toISOString().split('T')[0];
  };

  // Helper function to validate phase dates
  const validatePhaseDates = (segments: Array<{ phase: Phase; startDate: string; endDate: string }>) => {
    const errors: string[] = [];
    
    // Check for end date before start date
    segments.forEach((segment, index) => {
      if (segment.startDate > segment.endDate) {
        errors.push(`${segment.phase} phase: End date cannot be before start date`);
      }
    });
    
    // Check for overlaps
    for (let i = 0; i < segments.length; i++) {
      for (let j = i + 1; j < segments.length; j++) {
        const seg1 = segments[i];
        const seg2 = segments[j];
        
        if (seg1.startDate <= seg2.endDate && seg2.startDate <= seg1.endDate) {
          errors.push(`${seg1.phase} and ${seg2.phase} phases overlap`);
        }
      }
    }
    
    return errors;
  };

  const toggleTaskCompletion = (taskId: string) => {
    setProjectTasks(prevTasks =>
      prevTasks.map(task =>
        task.id === taskId
          ? { ...task, status: task.status === 'completed' ? 'pending' : 'completed' }
          : task
      )
    );
  };

  const updateTaskAssignment = (taskId: string, assignedTo: string[]) => {
    setProjectTasks(prevTasks =>
      prevTasks.map(task =>
        task.id === taskId
          ? { ...task, assignedTo: assignedTo.length > 0 ? assignedTo : undefined }
          : task
      )
    );
  };

  const handleAddTask = () => {
    if (newTask.description.trim()) {
      const task: Task = {
        id: `task-${Date.now()}`,
        description: newTask.description,
        assignedTo: newTask.assignedTo.length > 0 ? newTask.assignedTo : undefined,
        status: newTask.status,
        phase: activePhase,
        dueDate: (newTask as any).isOngoing ? undefined : (newTask.dueDate && newTask.dueDate.trim() ? newTask.dueDate : null),
        isOngoing: (newTask as any).isOngoing || false
      };
      setProjectTasks(prevTasks => [...prevTasks, task]);
      setNewTask({ description: "", assignedTo: [], status: "pending", dueDate: "", isOngoing: false });
      setShowAddTask(false);
    }
  };

  // Calendar helper functions
  const getDaysInMonth = (date: Date) => {
    return new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate();
  };

  const getFirstDayOfMonth = (date: Date) => {
    return new Date(date.getFullYear(), date.getMonth(), 1).getDay();
  };

  const getWorkWeekDays = (date: Date, fullCalendar: boolean = false) => {
    const year = date.getFullYear();
    const month = date.getMonth();
    const firstDay = new Date(year, month, 1);
    const lastDay = new Date(year, month + 1, 0);

    // Find the Monday of the current week (today's week)
    const today = new Date();
    const currentMonday = new Date(today);
    const todayDayOfWeek = today.getDay() || 7; // Convert Sunday (0) to 7
    currentMonday.setDate(today.getDate() - (todayDayOfWeek - 1));

    // Find the Monday of the week containing the first day of the month
    const firstMonday = new Date(firstDay);
    const firstDayOfWeek = firstDay.getDay() || 7; // Convert Sunday (0) to 7
    firstMonday.setDate(firstDay.getDate() - (firstDayOfWeek - 1));

    // Find the Friday of the week containing the last day of the month
    const lastFriday = new Date(lastDay);
    const lastDayOfWeek = lastDay.getDay() || 7; // Convert Sunday (0) to 7
    if (lastDayOfWeek <= 5) { // If last day is weekday
      lastFriday.setDate(lastDay.getDate() + (5 - lastDayOfWeek));
    } else { // If last day is weekend, go to previous Friday
      lastFriday.setDate(lastDay.getDate() - (lastDayOfWeek - 5));
    }

    // Start from the current week's Monday if not showing full calendar, otherwise start from first Monday of month
    const startMonday = fullCalendar ? firstMonday : (() => {
      // Always use the Monday of the week containing the currentMonth date
      const weekMonday = new Date(currentMonth);
      const dayOfWeek = currentMonth.getDay() || 7; // Convert Sunday (0) to 7
      weekMonday.setDate(currentMonth.getDate() - (dayOfWeek - 1));
      return weekMonday;
    })();
    
    // If showing current week, end at the current week's Friday, otherwise use the month's last Friday
    const endFriday = fullCalendar ? lastFriday : (() => {
      const currentFriday = new Date(startMonday);
      currentFriday.setDate(startMonday.getDate() + 4); // Friday is 4 days after Monday
      return currentFriday;
    })();

    const days = [];
    const current = new Date(startMonday);

    while (current <= endFriday) {
      const dayOfWeek = current.getDay();
      // Only include Monday (1) through Friday (5)
      if (dayOfWeek >= 1 && dayOfWeek <= 5) {
        days.push({
          date: new Date(current),
          day: current.getDate(),
          month: current.getMonth(),
          year: current.getFullYear(),
          isCurrentMonth: current.getMonth() === month
        });
      }
      current.setDate(current.getDate() + 1);
    }

    return days;
  };

  const getWeekGroups = (days: any[]) => {
    const weeks = [];
    let currentWeek = [];

    for (const dayObj of days) {
      const dayOfWeek = dayObj.date.getDay();

      // If it's Monday (1) and we have days in current week, start a new week
      if (dayOfWeek === 1 && currentWeek.length > 0) {
        weeks.push(currentWeek);
        currentWeek = [];
      }

      currentWeek.push(dayObj);
    }

    // Add the last week if it has days
    if (currentWeek.length > 0) {
      weeks.push(currentWeek);
    }

    return weeks;
  };

  const isDateInPhase = (dayObj: any, phase: { startDate: string; endDate: string }) => {
    // Use the date from the day object
    const currentDate = dayObj.date;
    const dateString = `${currentDate.getFullYear()}-${String(currentDate.getMonth() + 1).padStart(2, '0')}-${String(currentDate.getDate()).padStart(2, '0')}`;
    
    // Check if the date falls within the phase date range
    return dateString >= phase.startDate && dateString <= phase.endDate;
  };

  const isToday = (date: Date) => {
    const today = new Date();
    return date.getDate() === today.getDate() &&
           date.getMonth() === today.getMonth() &&
           date.getFullYear() === today.getFullYear();
  };
  
  // Convert day numbers to actual dates
  const getDateFromDay = (day: number) => {
    const today = new Date();
    const projectStart = new Date(today.getTime() + (day * 24 * 60 * 60 * 1000));
    return projectStart.toLocaleDateString('en-US', { 
      month: 'short', 
      day: 'numeric',
      year: 'numeric'
    });
  };
  
  const getFileIcon = (type: ProjectFile['type']) => {
    switch (type) {
      case 'content-analysis':
        return <ChartBarIcon className="h-5 w-5 text-blue-600" />;
      case 'qnr':
        return <ClipboardDocumentIcon className="h-5 w-5 text-green-600" />;
      case 'report':
        return <DocumentIcon className="h-5 w-5 text-purple-600" />;
      case 'word':
        return <DocumentIcon className="h-5 w-5 text-blue-600" />;
      case 'excel':
        return <ChartBarIcon className="h-5 w-5 text-green-600" />;
      case 'powerpoint':
        return <DocumentIcon className="h-5 w-5 text-orange-600" />;
      default:
        return <DocumentIcon className="h-5 w-5 text-gray-600" />;
    }
  };

  const getStatusColor = (status: Task['status']) => {
    switch (status) {
      case 'completed':
        return 'text-green-600 bg-green-100 opacity-60';
      case 'in-progress':
        return 'text-blue-600 bg-blue-100 opacity-60';
      case 'pending':
        return 'text-gray-600 bg-gray-100 opacity-60';
      default:
        return 'text-gray-600 bg-gray-100';
    }
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-start justify-center overflow-y-auto z-50 p-4" style={{ top: 0, left: 0, right: 0, bottom: 0 }}>
      <div className="bg-white rounded-3xl max-w-6xl w-full max-h-[90vh] flex flex-col overflow-hidden">
        <div className="p-6 overflow-y-auto flex-1">
          {/* Header */}
          <div className="flex items-center justify-between mb-6">
            <div>
              <h2 className="text-2xl font-bold" style={{ color: BRAND.gray }}>{project.name}</h2>
              <p className="text-gray-600">{project.client} • {project.methodology}</p>
            </div>
            <div className="flex items-center gap-3">
              <button
                onClick={onClose}
                className="text-gray-400 hover:text-gray-600"
              >
                <svg className="h-6 w-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
          </div>

          {/* Project Overview */}
          <div className="grid grid-cols-1 lg:grid-cols-4 gap-6 mb-6">
            <Card>
              <div className="flex items-center justify-between mb-3">
                <h3 className="font-semibold">Project Overview</h3>
                <button 
                  onClick={() => console.log('Edit Project Overview')}
                  className="text-xs text-blue-600 hover:text-blue-800 flex items-center gap-1"
                >
                  <PencilIcon className="h-3 w-3" />
                  edit
                </button>
              </div>
              <div className="space-y-2">
                <div className="flex justify-between">
                  <span className="text-gray-600">Phase:</span>
                  <span className="px-0.5 sm:px-1 md:px-2 py-1 rounded-full text-xs text-white opacity-60" style={{ background: phaseColor }}>
                    {currentPhase}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-600">Methodology:</span>
                  <span className="text-sm">{project.methodology}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-600">Duration:</span>
                  <span className="text-sm">{project.endDay - project.startDay} days</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-600">Team Members:</span>
                  <span className="text-sm">{project.teamMembers?.length || 0}</span>
                </div>
              </div>
            </Card>

            <Card>
              <div className="flex items-center justify-between mb-3">
                <h3 className="font-semibold">Ongoing Tasks</h3>
                <button 
                  onClick={() => console.log('Add Ongoing Task')}
                  className="text-xs text-blue-600 hover:text-blue-800 flex items-center gap-1"
                >
                  <PlusIcon className="h-3 w-3" />
                  add
                </button>
              </div>
              <div className="space-y-2">
                {(() => {
                  const ongoingTasks = project.tasks?.filter(task => task.isOngoing && task.phase === currentPhase) || [];
                  
                  if (ongoingTasks.length === 0) {
                    return (
                      <div className="text-center py-4 text-gray-500">
                        <p className="text-sm">No ongoing tasks for {currentPhase} phase</p>
                      </div>
                    );
                  }

                  return ongoingTasks.map((task, index) => {
                    const isAssignedToMe = task.assignedTo?.includes(user?.id || '');
                    const assignedMembers = task.assignedTo?.map(id => {
                      const member = project.teamMembers?.find(m => m.id === id);
                      return member?.name || 'Unknown';
                    }) || [];

                    return (
                      <div 
                        key={`${task.id}-${index}`}
                        className={`p-2 rounded-lg border cursor-pointer transition-colors ${
                          isAssignedToMe 
                            ? 'bg-orange-50 border-orange-200' 
                            : 'bg-gray-50 border-gray-200 hover:bg-gray-100'
                        }`}
                      >
                        <div className={`text-sm font-medium mb-1 ${isAssignedToMe ? 'text-orange-900' : 'text-gray-900'}`}>
                          {task.description || task.content}
                          {isAssignedToMe && <span className="ml-2 text-xs font-bold">(YOU)</span>}
                        </div>
                        {assignedMembers.length > 0 && (
                          <div className="text-xs text-gray-500">
                            Assigned to: {assignedMembers.join(', ')}
                          </div>
                        )}
                      </div>
                    );
                  });
                })()}
              </div>
            </Card>

            <Card>
              <div className="flex items-center justify-between mb-3">
                <h3 className="font-semibold">Key Dates</h3>
                <button 
                  onClick={() => console.log('Edit Key Deadlines')}
                  className="text-xs text-blue-600 hover:text-blue-800 flex items-center gap-1"
                >
                  <PencilIcon className="h-3 w-3" />
                  edit
                </button>
              </div>
              <div className="space-y-2">
                {project.keyDeadlines.map((deadline, index) => (
                  <div key={`project-deadline-${deadline.label}-${index}`} className="flex items-center justify-between">
                    <span className="text-sm">{deadline.label}</span>
                    <span className="text-xs text-gray-500">{deadline.date}</span>
                  </div>
                ))}
              </div>
            </Card>

            <Card>
              <div className="flex items-center justify-between mb-3">
                <h3 className="font-semibold">Saved Files</h3>
                <button
                  onClick={() => console.log('Edit Project Files')}
                  className="text-xs text-blue-600 hover:text-blue-800 flex items-center gap-1"
                >
                  <PlusIcon className="h-3 w-3" />
                  add
                </button>
              </div>
              <div className="space-y-2">
                {/* Project Files */}
                {project.files.map((file) => (
                  <div key={file.id} className="flex items-center gap-2">
                    {getFileIcon(file.type)}
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium truncate">{file.name}</div>
                      <div className="text-xs text-gray-500">{file.size} • {file.uploadedAt}</div>
                    </div>
                  </div>
                ))}

                {/* Saved Content Analyses */}
                {project.savedContentAnalyses && project.savedContentAnalyses.length > 0 && (
                  <>
                    {project.savedContentAnalyses.map((ca) => (
                      <div
                        key={ca.id}
                        className="flex items-center gap-2 cursor-pointer hover:bg-gray-50 p-1 rounded transition-colors"
                        onClick={() => {
                          // Navigate to Content Analysis with this CA loaded
                          window.dispatchEvent(new CustomEvent('navigateToCA', { detail: ca }));
                        }}
                      >
                        <IconTable className="w-4 h-4 text-purple-600 flex-shrink-0" />
                        <div className="flex-1 min-w-0">
                          <div className="text-sm font-medium truncate">{ca.name}</div>
                          <div className="text-xs text-gray-500">Content Analysis • {new Date(ca.savedDate).toLocaleDateString()}</div>
                        </div>
                        <svg className="w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                        </svg>
                      </div>
                    ))}
                  </>
                )}

                {/* Saved Storytelling */}
                {storytellingData && (storytellingData.storyboards?.length > 0 || storytellingData.reportData?.slides?.length > 0) && (
                  <div
                    className="flex items-center gap-2 cursor-pointer hover:bg-gray-50 p-1 rounded transition-colors"
                    onClick={() => {
                      // Navigate to Storytelling tab with this project selected
                      setRoute('storytelling');
                      // Dispatch event to select this project in storytelling
                      window.dispatchEvent(new CustomEvent('selectProjectInStorytelling', { 
                        detail: { 
                          projectId: project.id,
                          projectName: project.name
                        } 
                      }));
                    }}
                  >
                    <IconBook2 className="w-4 h-4 text-green-600 flex-shrink-0" />
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium truncate">Storytelling</div>
                      <div className="text-xs text-gray-500">
                        {storytellingData.storyboards?.length > 0 && storytellingData.reportData?.slides?.length > 0 
                          ? `${storytellingData.storyboards.length} storyboards, ${storytellingData.reportData.slides.length} reports`
                          : storytellingData.storyboards?.length > 0 
                            ? `${storytellingData.storyboards.length} storyboards`
                            : `${storytellingData.reportData.slides.length} reports`
                        }
                      </div>
                    </div>
                    <svg className="w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                    </svg>
                  </div>
                )}

                {project.files.length === 0 && (!project.savedContentAnalyses || project.savedContentAnalyses.length === 0) && (!storytellingData || (!storytellingData.storyboards?.length && !storytellingData.reportData?.slides?.length)) && (
                  <div className="text-sm text-gray-500 italic py-2">No files saved yet</div>
                )}
              </div>
            </Card>
          </div>

          {/* Tasks and Timeline */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <Card className="h-[500px] flex flex-col">
              
              {/* Phase Tabs */}
              <div className="mb-4">
                <div className="flex flex-wrap items-stretch border-b" style={{ marginRight: "-14px" }}>
                  {PHASES.map((phase, index) => {
                    const phaseColor = PHASE_COLORS[phase];
                    const isActive = activePhase === phase;
                    return (
                      <button
                        key={phase}
                        className={`flex-1 px-3 py-1 text-xs font-medium transition-colors relative min-h-[32px] flex items-center justify-center ${
                          isActive
                            ? 'text-gray-900 z-10'
                            : 'text-gray-600 hover:text-gray-900 hover:bg-gray-50'
                        }`}
                        onClick={() => setActivePhase(phase as Phase)}
                        style={{
                          backgroundColor: isActive ? (phaseColor + '1A') : 'transparent', // light tint
                          borderTopLeftRadius: '6px',
                          borderTopRightRadius: '6px',
                          marginRight: '0',
                          marginLeft: index === 0 ? '0' : '-1px',
                          border: `1px solid ${isActive ? phaseColor : '#d1d5db'}`,
                          borderBottom: isActive ? 'none' : `1px solid ${PHASE_COLORS[activePhase] || '#d1d5db'}`,
                          position: 'relative',
                          zIndex: isActive ? 10 : 1,
                          minHeight: isActive ? '36px' : '32px',
                          paddingTop: isActive ? '6px' : '4px',
                          paddingBottom: isActive ? '6px' : '4px'
                        }}
                      >
                        {getPhaseDisplayName(phase)}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Tasks for Active Phase */}
              <div ref={taskContainerRef} className="space-y-2 h-96 overflow-y-auto px-3 py-3 bg-white">
                {projectTasks
                  .filter(task => task.phase === activePhase)
                  .sort((a, b) => {
                    // Sort completed tasks to bottom
                    if (a.status === 'completed' && b.status !== 'completed') return 1;
                    if (a.status !== 'completed' && b.status === 'completed') return -1;

                    // Tasks with dates should come before tasks without dates
                    if (a.dueDate && !b.dueDate) return -1;
                    if (!a.dueDate && b.dueDate) return 1;

                    // If both have dates, sort by date ascending (earliest first)
                    if (a.dueDate && b.dueDate) {
                      return a.dueDate.localeCompare(b.dueDate);
                    }

                    return 0;
                  })
                  .map((task) => {
                    return (
                      <div key={task.id} className="task-grid px-3 py-2 border rounded-lg bg-gray-100 hover:bg-gray-50">
                        {/* Task Status Checkbox */}
                        <button
                          className={`w-4 h-4 rounded border-2 flex items-center justify-center text-xs ${
                            task.status === 'completed'
                              ? 'bg-green-500 border-green-500 text-white'
                              : 'border-gray-300 hover:border-gray-400'
                          }`}
                          onClick={() => toggleTaskCompletion(task.id)}
                        >
                          {task.status === 'completed' && '✓'}
                        </button>

                        {/* Task Description */}
                        <div className="flex-1 min-w-0">
                          <div className={`text-xs ${task.status === 'completed' ? 'line-through text-gray-500' : 'text-gray-900'}`}>
                            {task.description}
                          </div>
                        </div>

                        {/* Assignment Section */}
                        <div className="relative flex items-center gap-2 justify-self-center">
                          {task.assignedTo && task.assignedTo.filter(id => id && id.trim() !== '').length > 0 && (
                            <div className="flex items-center gap-1 flex-shrink-0">
                              {task.assignedTo.filter(id => id && id.trim() !== '').slice(0, 2).map((memberId) => (
                                <div key={memberId} className="w-6 h-6 rounded-full flex items-center justify-center text-white text-xs font-medium" style={{ backgroundColor: getMemberColor(memberId, project.teamMembers) }}>
                                  {getInitials(project.teamMembers.find(m => m.id === memberId)?.name || 'Unknown')}
                                </div>
                              ))}
                              {task.assignedTo.filter(id => id && id.trim() !== '').length > 2 && (
                                <div className="relative group">
                                  <span className="text-xs italic text-gray-500 ml-1 cursor-help">
                                    +{task.assignedTo.filter(id => id && id.trim() !== '').length - 2}
                                  </span>
                                  <div className="absolute hidden group-hover:block bg-gray-800 text-white text-xs rounded p-2 whitespace-nowrap z-10 left-0 top-8">
                                    {task.assignedTo.filter(id => id && id.trim() !== '').slice(2).map(id => project.teamMembers.find(m => m.id === id)?.name || 'Unknown').join(', ')}
                                  </div>
                                </div>
                              )}
                            </div>
                          )}
                          <button
                            onClick={() => setShowAssignmentDropdown(showAssignmentDropdown === task.id ? null : task.id)}
                            className="w-6 h-6 rounded-full bg-transparent flex items-center justify-center text-gray-500 hover:text-gray-700 transition-colors"
                            title="Assign team members"
                          >
                            +
                          </button>
                          {showAssignmentDropdown === task.id && createPortal(
                            <div className="assignment-dropdown fixed z-[9999] bg-white border border-gray-300 rounded-lg shadow-lg p-2 min-w-[200px]"
                              style={{
                                top: '50%',
                                left: '50%',
                                transform: 'translate(-50%, -50%)'
                              }}>
                              <div className="space-y-1">
                                {project.teamMembers.map(member => (
                                  <label key={member.id} className="flex items-center gap-2 px-0.5 sm:px-1 md:px-2 py-1 hover:bg-gray-50 rounded cursor-pointer">
                                    <input
                                      type="checkbox"
                                      checked={task.assignedTo?.includes(member.id) || false}
                                      onChange={(e) => {
                                        const currentAssigned = task.assignedTo || [];
                                        const newAssigned = e.target.checked
                                          ? [...currentAssigned, member.id]
                                          : currentAssigned.filter(id => id !== member.id);
                                        updateTaskAssignment(task.id, newAssigned);
                                      }}
                                      className="rounded border-gray-300"
                                    />
                                    <span className="text-sm">{member.name}</span>
                                  </label>
                                ))}
                              </div>
                            </div>,
                            document.body
                          )}
                        </div>
                      </div>
                    );
                  })}

                {/* Show message if no tasks in this phase */}
                {projectTasks.filter(task => task.phase === activePhase).length === 0 && (
                  <div className="text-xs text-gray-500 py-1 text-center">
                    No tasks in {activePhase === 'Post-Field Analysis' ? 'Analysis' : activePhase} phase
                  </div>
                )}


                {/* Add Task Button */}
                <div className="pt-0.5">
                  {!showAddTask ? (
                    <button
                      onClick={() => setShowAddTask(true)}
                      className="text-xs text-gray-500 hover:text-gray-700 flex items-center gap-1"
                    >
                      <PlusSmallIcon className="h-3 w-3" />
                      Add task to {activePhase === 'Post-Field Analysis' ? 'Analysis' : activePhase}
                    </button>
                  ) : (
                    <div className="p-2 border rounded-lg bg-gray-50">
                      <div className="flex gap-2 items-center">
                        <input
                          type="text"
                          value={newTask.description}
                          onChange={(e) => setNewTask(prev => ({ ...prev, description: e.target.value }))}
                          placeholder="Task description"
                          className="flex-1 text-xs border rounded px-0.5 sm:px-1 md:px-2 py-1 outline-none focus:ring-2 focus:ring-orange-200"
                        />
                        <input
                          type="date"
                          value={(newTask as any).dueDate || ''}
                          onChange={(e) => setNewTask(prev => ({ ...prev, dueDate: e.target.value as any }))}
                          className="text-xs border rounded px-0.5 sm:px-1 md:px-2 py-1 outline-none focus:ring-2 focus:ring-orange-200"
                          title="Due date"
                        />
                        <select
                          value={newTask.assignedTo.length > 0 ? newTask.assignedTo[0] : ''}
                          onChange={(e) => {
                            const selectedValue = e.target.value;
                            if (selectedValue) {
                              setNewTask(prev => ({ ...prev, assignedTo: [selectedValue] }));
                            } else {
                              setNewTask(prev => ({ ...prev, assignedTo: [] }));
                            }
                          }}
                          className="text-xs border rounded px-0.5 sm:px-1 md:px-2 py-1 outline-none focus:ring-2 focus:ring-orange-200"
                        >
                          <option value="">Select assignee...</option>
                          {project.teamMembers.map(member => (
                            <option key={member.id} value={member.id}>{member.name}</option>
                          ))}
                        </select>
                        {newTask.description.trim() && (
                          <button
                            onClick={handleAddTask}
                            className="px-2 py-1 text-xs text-white rounded hover:opacity-90 transition-colors"
                            style={{ backgroundColor: BRAND.orange }}
                          >
                            Add
                          </button>
                        )}
                        <button
                          onClick={() => setShowAddTask(false)}
                          className="px-2 py-1 text-xs border rounded hover:bg-gray-100"
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </Card>

            <Card>
              <div className="mb-3">
                <h3 className="font-semibold">Project Timeline</h3>
              </div>
              
              {/* Calendar Navigation */}
              <div className="flex items-center justify-between mb-4">
                <button
                  onClick={() => {
                    if (showFullCalendar) {
                      setCurrentMonth(new Date(currentMonth.getFullYear(), currentMonth.getMonth() - 1));
                    } else {
                      // Advance by one week
                      const newDate = new Date(currentMonth);
                      newDate.setDate(currentMonth.getDate() - 7);
                      setCurrentMonth(newDate);
                    }
                  }}
                  className="p-2 hover:bg-gray-100 rounded-lg"
                >
                  <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                  </svg>
                </button>
                <h4 className="font-medium">
                  {currentMonth.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}
                </h4>
                <button
                  onClick={() => {
                    if (showFullCalendar) {
                      setCurrentMonth(new Date(currentMonth.getFullYear(), currentMonth.getMonth() + 1));
                    } else {
                      // Advance by one week
                      const newDate = new Date(currentMonth);
                      newDate.setDate(currentMonth.getDate() + 7);
                      setCurrentMonth(newDate);
                    }
                  }}
                  className="p-2 hover:bg-gray-100 rounded-lg"
                >
                  <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                  </svg>
                </button>
              </div>

              {/* Phase Legend */}
              <div className="mb-4 text-center">
                <div className="flex flex-wrap justify-center gap-2">
                  {project.segments?.map((segment, index) => (
                    <div key={`detail-segment-${segment.phase}-${index}`} className="flex items-center gap-1">
                      <div
                        className="w-3 h-3 rounded-full opacity-60"
                        style={{ background: PHASE_COLORS[segment.phase] }}
                      />
                      <span className="text-xs text-gray-700">{segment.phase}</span>
                    </div>
                  ))}
                </div>
              </div>

              {/* Timeline Edit Mode */}
              {editingTimeline ? (
                <div className="space-y-4">
                  <div className="text-sm font-medium text-gray-700 mb-3">Edit Project Timeline</div>
                  
                  {/* Validation Errors */}
                  {validatePhaseDates(editingSegments).length > 0 && (
                    <div className="p-3 bg-red-50 border border-red-200 rounded-lg">
                      <div className="text-sm font-medium text-red-700 mb-2">Please fix the following errors:</div>
                      <ul className="text-xs text-red-600 space-y-1">
                        {validatePhaseDates(editingSegments).map((error, index) => (
                          <li key={`validation-error-${error}-${index}`}>• {error}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                  
                  {editingSegments.map((segment, index) => (
                    <div key={`editing-segment-${segment.phase}-${index}`} className="flex items-center gap-3 p-3 border rounded-lg">
                      <div className="flex-1">
                        <div className="flex items-center gap-2 mb-2">
                          <div 
                            className="w-4 h-4 rounded-full"
                            style={{ background: PHASE_COLORS[segment.phase] }}
                          />
                          <span className="font-medium text-sm">{getPhaseDisplayName(segment.phase)}</span>
                        </div>
                        <div className="grid grid-cols-2 gap-2">
                          <div>
                            <label className="text-xs text-gray-500">Start Date</label>
                            <input
                              type="date"
                              value={segment.startDate}
                              onChange={(e) => {
                                const newSegments = [...editingSegments];
                                newSegments[index].startDate = e.target.value;
                                
                                // Auto-set next phase start date if this is an end date change
                                if (index < newSegments.length - 1) {
                                  const nextWorkday = getNextWorkday(e.target.value);
                                  newSegments[index + 1].startDate = nextWorkday;
                                }
                                
                                setEditingSegments(newSegments);
                              }}
                              className="w-full text-xs border rounded px-0.5 sm:px-1 md:px-2 py-1"
                            />
                          </div>
                          <div>
                            <label className="text-xs text-gray-500">End Date</label>
                            <input
                              type="date"
                              value={segment.endDate}
                              onChange={(e) => {
                                const newSegments = [...editingSegments];
                                newSegments[index].endDate = e.target.value;
                                
                                // Auto-set next phase start date
                                if (index < newSegments.length - 1) {
                                  const nextWorkday = getNextWorkday(e.target.value);
                                  newSegments[index + 1].startDate = nextWorkday;
                                }
                                
                                setEditingSegments(newSegments);
                              }}
                              className="w-full text-xs border rounded px-0.5 sm:px-1 md:px-2 py-1"
                            />
                          </div>
                        </div>
                      </div>
                      <button
                        onClick={() => {
                          const newSegments = editingSegments.filter((_, i) => i !== index);
                          setEditingSegments(newSegments);
                        }}
                        className="text-red-500 hover:text-red-700 text-xs"
                      >
                        Remove
                      </button>
                    </div>
                  ))}
                  <button
                    onClick={() => {
                      const newSegment = {
                        phase: 'Kickoff' as Phase,
                        startDate: new Date().toISOString().split('T')[0],
                        endDate: new Date().toISOString().split('T')[0]
                      };
                      setEditingSegments([...editingSegments, newSegment]);
                    }}
                    className="w-full py-2 border-2 border-dashed border-gray-300 rounded-lg text-gray-500 hover:border-gray-400 hover:text-gray-600 text-sm"
                  >
                    + Add Phase
                  </button>
                  <div className="flex gap-2 pt-2">
                    <button
                      onClick={() => {
                        // Validate before saving
                        const errors = validatePhaseDates(editingSegments);
                        if (errors.length === 0) {
                          console.log('Saving timeline:', editingSegments);
                          setEditingTimeline(false);
                        }
                      }}
                      disabled={validatePhaseDates(editingSegments).length > 0}
                      className="px-4 py-2 0 text-white rounded-lg text-sm hover:bg-orange-600 disabled:bg-gray-300 disabled:cursor-not-allowed"
                    >
                      Save Timeline
                    </button>
                    <button
                      onClick={() => {
                        setEditingSegments(project.segments || []);
                        setEditingTimeline(false);
                      }}
                      className="px-4 py-2 border border-gray-300 rounded-lg text-sm hover:bg-gray-50"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              ) : (
                /* Work Week Calendar */
                <div className="space-y-2 max-h-80 overflow-y-auto">
                  {/* Week day headers */}
                  <div className="grid grid-cols-5 gap-1 text-xs font-medium text-gray-500">
                    {['Mon', 'Tue', 'Wed', 'Thu', 'Fri'].map(day => (
                      <div key={day} className="p-2 text-center">{day}</div>
                    ))}
                  </div>
                  
                  {/* Calendar days */}
                  {(() => {
                    // Helper function to check if a date is in current week
                    const isCurrentWeek = (date: Date) => {
                      const today = new Date();
                      const startOfWeek = new Date(today);
                      const dayOfWeek = today.getDay();
                      const diff = today.getDate() - dayOfWeek + (dayOfWeek === 0 ? -6 : 1); // Adjust when day is Sunday
                      startOfWeek.setDate(diff);
                      
                      const endOfWeek = new Date(startOfWeek);
                      endOfWeek.setDate(startOfWeek.getDate() + 6);
                      
                      return date >= startOfWeek && date <= endOfWeek;
                    };

                    return getWeekGroups(getWorkWeekDays(currentMonth, true)).map((week, weekIndex) => (
                    <div key={weekIndex} className="grid grid-cols-5 gap-1">
                      {Array.from({ length: 5 }, (_, dayIndex) => {
                        const dayObj = week[dayIndex];
                        if (!dayObj) {
                          return <div key={`${weekIndex}-${dayIndex}`} className="p-2"></div>;
                        }

                        const dayDate = dayObj.date;
                        const isCurrentMonth = dayObj.isCurrentMonth;
                        const isPastDate = dayDate < new Date(new Date().setHours(0, 0, 0, 0));

                        // Find which phase this day belongs to
                        const phaseForDay = project.segments?.find(segment =>
                          isDateInPhase(dayObj, segment)
                        );

                        const isTodayDate = isToday(dayDate);
                        const isCurrentWeekDay = isCurrentWeek(dayDate);
                        const hasKeyDate = hasKeyDateOnDay(dayObj.date);
                        const hasNote = hasNoteOnDay(dayObj.date);
                        const hasTask = hasTaskOnDay(dayObj.date);
                        const tasksForDate = getTasksForDate(dayObj.date);

                        return (
                          <div
                            key={`${weekIndex}-${dayIndex}`}
                            className={`relative p-2 text-center text-sm rounded-lg cursor-pointer hover:bg-gray-200 h-16 flex flex-col justify-between ${
                              isTodayDate ? 'bg-white' : isCurrentMonth ? 'bg-gray-100' : 'bg-white'
                            } ${isPastDate ? 'opacity-50' : ''}`}
                            style={{
                              // Slightly darker orange for the current date than other highlighted dates
                              backgroundColor: isTodayDate ? '#FDBA74A6' : (isCurrentWeekDay ? '#FED7AA40' : (isCurrentMonth ? '#F3F4F6' : '#FFFFFF')),
                              border: isTodayDate ? '2px solid #F97316' : (!isCurrentMonth && !isCurrentWeekDay ? '1px solid #E5E7EB' : 'none')
                            }}
                            title={phaseForDay ? `${phaseForDay.phase} phase` : 'No project activity'}
                          >
                            {/* Date number at top */}
                            <div className={`font-medium text-xs pt-1 relative z-10 ${
                              isTodayDate ? 'text-gray-700' : isCurrentMonth ? 'text-gray-700' : isPastDate ? 'text-gray-500' : 'text-gray-400'
                            }`}>
                              {dayObj.day}
                            </div>

                            {/* Key date text */}
                            {hasKeyDate && (
                              <div className="absolute inset-0 flex items-center justify-center">
                                <div className={`text-[10px] italic truncate px-1 mt-2 ${
                                  isCurrentMonth ? 'text-gray-600' : isPastDate ? 'text-gray-500' : 'text-gray-400'
                                }`}>
                                  {getKeyDateTextForDay(dayObj.date)}
                                </div>
                              </div>
                            )}

                            {/* Note icon */}
                            {hasNote && (
                              <div className={`absolute top-1 right-1 z-10 ${isCurrentMonth ? 'opacity-60' : isPastDate ? 'opacity-40' : 'opacity-30'}`}>
                                <DocumentTextIcon
                                  className="w-3 h-3"
                                  style={{ color: phaseForDay ? PHASE_COLORS[phaseForDay.phase] : '#6B7280' }}
                                />
                              </div>
                            )}

                            {/* Task count indicator */}
                            {hasTask && tasksForDate.length > 0 && (() => {
                              const overdueTasks = getOverdueTasksForDate(dayObj.date);
                              const hasOverdue = overdueTasks.length > 0;
                              
                              return (
                              <div className={`absolute top-1 left-1 z-10 ${isCurrentMonth ? 'opacity-100' : isPastDate ? 'opacity-60' : 'opacity-50'}`}>
                                <div
                                  className="w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-medium"
                                  style={{
                                      color: hasOverdue ? '#DC2626' : '#374151',
                                      backgroundColor: hasOverdue ? '#FEE2E2' : (tasksForDate[0].phase ? (PHASE_COLORS[tasksForDate[0].phase] + '30') : '#9CA3AF30')
                                  }}
                                >
                                    {hasOverdue ? overdueTasks.length : tasksForDate.length}
                                </div>
                              </div>
                              );
                            })()}
                            
                            {/* Phase pill at bottom */}
                            {phaseForDay && (
                              <div
                                className={`absolute bottom-1 left-1 right-1 h-2 rounded-full z-10 ${
                                  isCurrentMonth ? 'opacity-60' : isPastDate ? 'opacity-40' : 'opacity-30'
                                }`}
                                style={{ background: PHASE_COLORS[phaseForDay.phase] }}
                              />
                            )}
                          </div>
                        );
                      })}
                    </div>
                  ));
                  })()}
                </div>
              )}
            </Card>
          </div>

          {/* Post-it Notes Section */}
          {projectNotes && projectNotes.length > 0 ? (
            <div className="mt-6">
              <div className="flex gap-3 items-stretch h-48">
                <div className="flex-1 flex gap-3">
                  {projectNotes
                    .filter(note => note.postToProjectPage)
                    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
                    .slice(0, 3)
                    .map((note) => (
                      <div
                        key={note.id}
                        className="bg-yellow-100 p-3 rounded-lg border-l-4 border-yellow-300 shadow-sm flex-1 cursor-pointer hover:shadow-md transition-shadow"
                        onClick={() => setSelectedNote(note)}
                      >
                        <div className="flex items-start justify-between mb-2">
                          <div className="flex items-center gap-2">
                            <div className="w-5 h-5 rounded-full flex items-center justify-center text-white text-xs font-medium" style={{ fontSize: '10px', backgroundColor: getMemberColor(note.createdBy, project.teamMembers) }}>
                              {getInitials(project.teamMembers.find(m => m.id === note.createdBy)?.name || note.createdBy)}
                            </div>
                            {note.comments && note.comments.length > 0 && (
                              <div className="flex items-center gap-1 text-gray-500">
                                <svg className="h-3 w-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
                                </svg>
                                <span className="text-xs">{note.comments.length}</span>
                              </div>
                            )}
                          </div>
                          <span className="text-xs text-gray-500 italic">{formatShortDate(note.createdAt)}</span>
                        </div>
                        <p className="text-sm text-gray-700 leading-relaxed line-clamp-3" dangerouslySetInnerHTML={{ __html: note.body }}></p>
                      </div>
                    ))}
                </div>
                <div className="flex flex-col gap-3">
                  <button
                    onClick={() => setShowAddNote(true)}
                    className="border-2 border-dashed border-gray-300 rounded-lg text-gray-500 hover:border-gray-400 hover:text-gray-600 transition-colors flex items-center justify-center px-3 flex-1"
                  >
                    <PlusSmallIcon className="h-4 w-4" />
                  </button>
                  {projectNotes.filter(note => note.postToProjectPage).length > 3 && (
                    <button
                      onClick={() => setShowNotesModal(true)}
                      className="border-2 border-dashed border-gray-300 rounded-lg text-gray-500 hover:border-gray-400 hover:text-gray-600 transition-colors flex items-center justify-center px-3 h-10"
                    >
                      <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                      </svg>
                    </button>
                  )}
                </div>
              </div>
            </div>
          ) : (
            <div className="mt-6">
              <div className="h-48">
                <Card className="h-full flex items-center justify-center">
                  <button
                    onClick={() => setShowAddNote(true)}
                    className="w-full h-full border-2 border-dashed border-gray-300 rounded-lg text-gray-500 hover:border-gray-400 hover:text-gray-600 transition-colors flex items-center justify-center gap-2"
                  >
                    <PlusSmallIcon className="h-4 w-4" />
                    <span className="text-sm">Add Post-it Note</span>
                  </button>
                </Card>
              </div>
            </div>
          )}

          {/* Archive Button */}
          <div className="mt-6 pt-6 border-t border-gray-200">
            <button
              onClick={() => {
                onArchive(project.id);
                onClose();
              }}
              className="px-4 py-2 text-sm border border-orange-200 text-orange-600 rounded-xl hover: transition-colors"
            >
              Archive Project
            </button>
          </div>
      </div>
      </div>

      {/* Calendar Picker Modal for Tasks */}
      {showCalendarDropdown && selectedTaskForDate && (
        <CalendarPicker
          selectedDate={projectTasks.find(t => t.id === selectedTaskForDate)?.dueDate || ''}
          onDateSelect={(date) => {
            const updatedTasks = projectTasks.map(t =>
              t.id === selectedTaskForDate ? { ...t, dueDate: date } : t
            );
            setProjectTasks(updatedTasks);
            if (setProjects) {
              setProjects((prev: Project[]) =>
                prev.map(p =>
                  p.id === project.id ? { ...p, tasks: updatedTasks } : p
                )
              );
            }
            setShowCalendarDropdown(false);
            setSelectedTaskForDate(null);
          }}
          onClose={() => {
            setShowCalendarDropdown(false);
            setSelectedTaskForDate(null);
          }}
          title="Set Due Date"
        />
      )}

    </div>
  );
}









