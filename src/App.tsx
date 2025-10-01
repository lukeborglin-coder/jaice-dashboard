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
} from "@heroicons/react/24/outline";
import {
  RocketLaunchIcon as RocketLaunchIconSolid,
  PlayIcon as PlayIconSolid
} from "@heroicons/react/24/solid";
import ContentAnalysisX from "./components/ContentAnalysisX";
import AuthWrapper from "./components/AuthWrapper";
import TopBar from "./components/TopBar";
import ProjectSetupWizard from "./components/ProjectSetupWizard";
import UserSearch from "./components/UserSearch";
import CalendarPicker from "./components/CalendarPicker";
import SimpleCalendar from "./components/SimpleCalendar";
import { useAuth } from "./contexts/AuthContext";

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
    notes: ''
  });
  const [editingVendor, setEditingVendor] = useState({
    name: '',
    email: '',
    phone: '',
    company: '',
    specialties: [] as string[],
    notes: ''
  });
  const [showScheduleModal, setShowScheduleModal] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deleteTargetId, setDeleteTargetId] = useState<string | null>(null);
  const [showSuccessMessage, setShowSuccessMessage] = useState(false);
  const [showConflictMessage, setShowConflictMessage] = useState(false);
  const [scheduleForm, setScheduleForm] = useState({
    startDate: '',
    endDate: '',
    type: 'booked', // 'booked' or 'pending'
    projectName: ''
  });

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
      const token = localStorage.getItem('jaice_token');
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
          localStorage.setItem('jaice_vendors', JSON.stringify(data));
          setVendors(data);
          return;
        }
      }
      // Fallback to local
      const storedVendors = localStorage.getItem('jaice_vendors');
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
    if (!newVendor.name || !newVendor.email) {
      alert('Name and email are required');
      return;
    }

    try {
      const sectionKey = activeSection;
      const path = getVendorsApiPath(sectionKey as any);
      const token = localStorage.getItem('jaice_token');
      const resp = await fetch(`${API_BASE_URL}/api/vendors/${path}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { 'Authorization': `Bearer ${token}` } : {})
        },
        body: JSON.stringify(newVendor)
      });
      if (!resp.ok) {
        const err = await resp.json().catch(() => ({}));
        throw new Error(err.error || 'Failed to add vendor');
      }
      await loadVendors();
      setNewVendor({ name: '', email: '', phone: '', company: '', specialties: [], notes: '' });
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
      name: vendor.name,
      email: vendor.email,
      phone: vendor.phone || '',
      company: vendor.company || '',
      specialties: vendor.specialties || [],
      notes: vendor.notes || ''
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
      const token = localStorage.getItem('jaice_token');
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
    if (!selectedVendor || !editingVendor.name || !editingVendor.email) {
      alert('Name and email are required');
      return;
    }

    try {
      const sectionKey = activeSection;
      const path = getVendorsApiPath(sectionKey as any);
      const token = localStorage.getItem('jaice_token');
      const resp = await fetch(`${API_BASE_URL}/api/vendors/${path}/${selectedVendor.id}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { 'Authorization': `Bearer ${token}` } : {})
        },
        body: JSON.stringify(editingVendor)
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
      const storedVendors = localStorage.getItem('jaice_vendors');
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
        localStorage.setItem('jaice_vendors', JSON.stringify(vendorData));
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
      const token = localStorage.getItem('jaice_token');

      const updatedSchedule = (selectedVendor.customSchedule || []).filter((entry: any) => entry.id !== entryId);
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
      setShowConflictMessage(true);
      return;
    }

    try {
      const sectionKey = activeSection as 'moderators' | 'sampleVendors' | 'analytics';
      const path = getVendorsApiPath(sectionKey);
      const token = localStorage.getItem('jaice_token');

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
      setShowScheduleModal(false);
      setShowSuccessMessage(true);
      setTimeout(() => setShowSuccessMessage(false), 3000);
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
        const projectStorageKeys = ['jaice_projects', 'projects', 'project_data'];

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
        const storedVendors = localStorage.getItem('jaice_vendors');
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
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold" style={{ color: BRAND.gray }}>Vendor Library</h1>
          <p className="text-gray-600">Manage your network of moderators, sample vendors, and analytics partners</p>
        </div>
      </div>

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

      {/* Tab-specific Add Button */}
      <div className="flex justify-between items-center">
        <h2 className="text-lg font-semibold text-gray-900">
          {activeSection === 'moderators' ? 'Moderators' :
           activeSection === 'sampleVendors' ? 'Sample Vendors' : 'Analytics Partners'}
        </h2>
        <button
          onClick={() => setShowAddModal(true)}
          className="flex items-center gap-2 px-4 py-2 text-white rounded-lg hover:opacity-90 transition-colors"
          style={{ backgroundColor: BRAND.orange }}
        >
          <PlusIcon className="h-5 w-5" />
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
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {currentVendors.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-6 py-12 text-center">
                    <UserGroupIcon className="mx-auto h-12 w-12 text-gray-400" />
                    <h3 className="mt-2 text-sm font-medium text-gray-900">No vendors found</h3>
                    <p className="mt-1 text-sm text-gray-500">Get started by adding your first vendor.</p>
                  </td>
                </tr>
              ) : (
                currentVendors.map((vendor: any) => (
                  <tr
                    key={vendor.id}
                    className="hover:bg-gray-50 cursor-pointer"
                    onClick={() => handleVendorClick(vendor)}
                  >
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
                            <span key={index} className="px-2 py-1 text-xs rounded-full text-white opacity-60" style={{ backgroundColor: '#3B82F6' }}>
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
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Add Vendor Modal */}
      {showAddModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-start justify-center overflow-y-auto py-8 z-[9999]">
          <div className="bg-white rounded-lg p-6 max-w-md w-full mx-4 my-auto">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold">Add New {activeSection === 'moderators' ? 'Moderator' : activeSection === 'sampleVendors' ? 'Sample Vendor' : 'Analytics Partner'}</h3>
              <button
                onClick={() => setShowAddModal(false)}
                className="text-gray-400 hover:text-gray-600"
              >
                <XMarkIcon className="w-5 h-5" />
              </button>
            </div>

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
        </div>
      )}

      {/* Vendor Details Modal */}
      {showDetailsModal && selectedVendor && createPortal(
        <div className="fixed top-0 left-0 right-0 bottom-0 bg-black bg-opacity-50 flex items-start justify-center z-[9999] overflow-y-auto py-8" style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0, 0, 0, 0.5)' }}>
          <div className="bg-white rounded-lg p-6 max-w-2xl w-full mx-4 my-auto">
            <div className="flex items-center justify-between mb-6">
              <h3 className="text-xl font-semibold text-gray-900">
                {selectedVendor.name}
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
                <div className="space-y-4">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <h4 className="text-sm font-medium text-gray-600 uppercase tracking-wide mb-2">Contact Information</h4>
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
                  </div>

                  {/* Specialties */}
                  {selectedVendor.specialties && selectedVendor.specialties.length > 0 && (
                    <div>
                      <h4 className="text-sm font-medium text-gray-600 uppercase tracking-wide mb-2">Specialties</h4>
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
                    <h4 className="text-sm font-medium text-gray-600 uppercase tracking-wide mb-2">Notes</h4>
                    <div className="p-4 bg-gray-50 rounded-lg">
                      <p className={`text-sm whitespace-pre-wrap ${selectedVendor.notes ? 'text-gray-900' : 'text-gray-500 italic'}`}>
                        {selectedVendor.notes || 'N/A'}
                      </p>
                    </div>
                  </div>

                  {/* Moderator Schedule (only for moderators) */}
                  {activeSection === 'moderators' && (
                    <div>
                      <div className="flex items-center justify-between mb-2">
                        <h4 className="text-sm font-medium text-gray-600 uppercase tracking-wide">Current Schedule</h4>
                        <button
                          onClick={() => setShowScheduleModal(true)}
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
                                        setDeleteTargetId(booking.id || `${booking.startDate}-${booking.endDate}`);
                                        setShowDeleteConfirm(true);
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
      {showScheduleModal && selectedVendor && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-start justify-center overflow-y-auto py-8 z-[9999]">
          <div className="bg-white rounded-lg p-6 max-w-md w-full mx-4 my-auto">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold">Add to Schedule</h3>
              <button
                onClick={() => setShowScheduleModal(false)}
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

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Start Date</label>
                <input
                  type="date"
                  value={scheduleForm.startDate}
                  onChange={(e) => setScheduleForm({ ...scheduleForm, startDate: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">End Date</label>
                <input
                  type="date"
                  value={scheduleForm.endDate}
                  onChange={(e) => setScheduleForm({ ...scheduleForm, endDate: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Type</label>
                <select
                  value={scheduleForm.type}
                  onChange={(e) => setScheduleForm({ ...scheduleForm, type: e.target.value })}
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
                    onChange={(e) => setScheduleForm({ ...scheduleForm, projectName: e.target.value })}
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
                  onClick={() => setShowScheduleModal(false)}
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
        </div>
      )}

      {/* Delete Confirmation Modal */}
      {showDeleteConfirm && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-start justify-center overflow-y-auto py-8 z-[10000]">
          <div className="bg-white rounded-lg p-6 max-w-sm w-full mx-4 my-auto">
            <h3 className="text-lg font-semibold mb-4">Confirm Deletion</h3>
            <p className="text-gray-600 mb-6">Are you sure you want to remove this schedule entry?</p>
            <div className="flex gap-3">
              <button
                onClick={() => {
                  setShowDeleteConfirm(false);
                  setDeleteTargetId(null);
                }}
                className="flex-1 px-4 py-2 text-gray-700 bg-gray-100 rounded-md hover:bg-gray-200 transition"
              >
                Cancel
              </button>
              <button
                onClick={() => {
                  if (deleteTargetId) {
                    handleDeleteScheduleEntry(deleteTargetId);
                  }
                  setShowDeleteConfirm(false);
                  setDeleteTargetId(null);
                }}
                className="flex-1 px-4 py-2 bg-red-600 text-white rounded-md hover:bg-red-700 transition"
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Success Message Modal */}
      {showSuccessMessage && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-start justify-center overflow-y-auto py-8 z-[10000]">
          <div className="bg-white rounded-lg p-6 max-w-sm w-full mx-4 my-auto">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 rounded-full bg-green-100 flex items-center justify-center">
                <svg className="w-6 h-6 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
              </div>
              <h3 className="text-lg font-semibold">Success!</h3>
            </div>
            <p className="text-gray-600 mb-6">Schedule entry has been added successfully.</p>
            <button
              onClick={() => setShowSuccessMessage(false)}
              className="w-full px-4 py-2 bg-green-600 text-white rounded-md hover:bg-green-700 transition"
            >
              OK
            </button>
          </div>
        </div>
      )}

      {/* Conflict Message Modal */}
      {showConflictMessage && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-start justify-center overflow-y-auto py-8 z-[10000]">
          <div className="bg-white rounded-lg p-6 max-w-sm w-full mx-4 my-auto">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 rounded-full bg-red-100 flex items-center justify-center">
                <svg className="w-6 h-6 text-red-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                </svg>
              </div>
              <h3 className="text-lg font-semibold">Schedule Conflict</h3>
            </div>
            <p className="text-gray-600 mb-6">This date range conflicts with existing bookings. Please select an available range.</p>
            <button
              onClick={() => setShowConflictMessage(false)}
              className="w-full px-4 py-2 bg-red-600 text-white rounded-md hover:bg-red-700 transition"
            >
              OK
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// Admin Center Component
function AdminCenter() {
  const [activeTab, setActiveTab] = useState<'users' | 'feature-requests' | 'bug-reports'>('users');
  const [users, setUsers] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreateUser, setShowCreateUser] = useState(false);
  const [newUser, setNewUser] = useState({
    name: '',
    email: '',
    password: '',
    role: 'user' as 'user' | 'admin',
    company: 'None' as 'None' | 'Cognitive'
  });

  // Feature Requests and Bug Reports state
  const [featureRequests, setFeatureRequests] = useState<any[]>([]);
  const [bugReports, setBugReports] = useState<any[]>([]);
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
          'Authorization': `Bearer ${localStorage.getItem('jaice_token')}`
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

  // Create new user
  const handleCreateUser = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const response = await fetch(`${API_BASE_URL}/api/auth/users`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${localStorage.getItem('jaice_token')}`
        },
        body: JSON.stringify(newUser)
      });
      
      if (response.ok) {
        setNewUser({ name: '', email: '', password: '', role: 'user' });
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
  const handleUpdateRole = async (userId: string, newRole: 'user' | 'admin') => {
    try {
      const response = await fetch(`${API_BASE_URL}/api/auth/users/${userId}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${localStorage.getItem('jaice_token')}`
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
          'Authorization': `Bearer ${localStorage.getItem('jaice_token')}`
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
          'Authorization': `Bearer ${localStorage.getItem('jaice_token')}`
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
          'Authorization': `Bearer ${localStorage.getItem('jaice_token')}`
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
            style={{ 
              backgroundColor: '#F37021',
            }}
            onMouseEnter={(e) => (e.currentTarget as HTMLButtonElement).style.backgroundColor = '#E55A1A'}
            onMouseLeave={(e) => (e.currentTarget as HTMLButtonElement).style.backgroundColor = '#F37021'}
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
                ? 'text-orange-600'
                : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
            }`}
            style={activeTab === 'users' ? { borderBottomColor: '#F37021' } : {}}
          >
            <div className="flex items-center gap-2">
              <UserGroupIcon className="w-5 h-5" />
              User Management
            </div>
          </button>
          <button
            onClick={() => setActiveTab('feature-requests')}
            className={`py-2 px-1 border-b-2 font-medium text-sm ${
              activeTab === 'feature-requests'
                ? 'text-orange-600'
                : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
            }`}
            style={activeTab === 'feature-requests' ? { borderBottomColor: '#F37021' } : {}}
          >
            <div className="flex items-center gap-2">
              <LightBulbIcon className="w-5 h-5" />
              Feature Requests
            </div>
          </button>
          <button
            onClick={() => setActiveTab('bug-reports')}
            className={`py-2 px-1 border-b-2 font-medium text-sm ${
              activeTab === 'bug-reports'
                ? 'text-orange-600'
                : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
            }`}
            style={activeTab === 'bug-reports' ? { borderBottomColor: '#F37021' } : {}}
          >
            <div className="flex items-center gap-2">
              <ExclamationTriangleIcon className="w-5 h-5" />
              Bug Reports
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
                  style={{ '--tw-ring-color': '#F37021' } as React.CSSProperties}
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
                  style={{ '--tw-ring-color': '#F37021' } as React.CSSProperties}
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
                  style={{ '--tw-ring-color': '#F37021' } as React.CSSProperties}
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Role</label>
                <select
                  value={newUser.role}
                  onChange={(e) => setNewUser({ ...newUser, role: e.target.value as 'user' | 'admin' })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:border-gray-300"
                  style={{ '--tw-ring-color': '#F37021' } as React.CSSProperties}
                >
                  <option value="user">User</option>
                  <option value="admin">Admin</option>
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Company</label>
                <select
                  value={newUser.company}
                  onChange={(e) => setNewUser({ ...newUser, company: e.target.value as 'None' | 'Cognitive' })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:border-gray-300"
                  style={{ '--tw-ring-color': '#F37021' } as React.CSSProperties}
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
                    backgroundColor: '#F37021',
                  }}
                  onMouseEnter={(e) => (e.currentTarget as HTMLButtonElement).style.backgroundColor = '#E55A1A'}
                  onMouseLeave={(e) => (e.currentTarget as HTMLButtonElement).style.backgroundColor = '#F37021'}
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
                            className="text-sm border border-gray-300 rounded px-2 py-1 focus:ring-2 focus:border-gray-300 w-32"
                            style={{ '--tw-ring-color': '#F37021' } as React.CSSProperties}
                          />
                          <button
                            onClick={() => handleChangePassword(user.id)}
                            className="text-xs px-2 py-1 bg-green-600 text-white rounded hover:bg-green-700"
                          >
                            Save
                          </button>
                          <button
                            onClick={() => {
                              setEditingPassword(null);
                              setNewPassword('');
                            }}
                            className="text-xs px-2 py-1 bg-gray-500 text-white rounded hover:bg-gray-600"
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
                        onChange={(e) => handleUpdateRole(user.id, e.target.value as 'user' | 'admin')}
                        className="text-sm border border-gray-300 rounded px-2 py-1 focus:ring-2 focus:border-gray-300"
                        style={{ '--tw-ring-color': '#F37021' } as React.CSSProperties}
                      >
                        <option value="user">User</option>
                        <option value="admin">Admin</option>
                      </select>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <select
                        value={(user as any).company || 'None'}
                        onChange={(e) => handleUpdateCompany(user.id, e.target.value as 'None' | 'Cognitive')}
                        className="text-sm border border-gray-300 rounded px-2 py-1 focus:ring-2 focus:border-gray-300"
                        style={{ '--tw-ring-color': '#F37021' } as React.CSSProperties}
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
        /* Feature Requests View */
        <div className="space-y-6">
          <div className="bg-white shadow-sm rounded-lg border border-gray-200 p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold text-gray-900">Feature Requests ({featureRequests.length})</h3>
              <button
                className="flex items-center gap-2 px-4 py-2 text-white rounded-lg transition-colors"
                style={{ 
                  backgroundColor: '#F37021',
                }}
                onMouseEnter={(e) => (e.currentTarget as HTMLButtonElement).style.backgroundColor = '#E55A1A'}
                onMouseLeave={(e) => (e.currentTarget as HTMLButtonElement).style.backgroundColor = '#F37021'}
              >
                <PlusIcon className="h-4 w-4" />
                New Request
              </button>
            </div>

            {featureRequests.length === 0 ? (
              <div className="text-center py-8">
                <LightBulbIcon className="mx-auto h-12 w-12 text-gray-400" />
                <h3 className="mt-2 text-sm font-medium text-gray-900">No feature requests yet</h3>
                <p className="mt-1 text-sm text-gray-500">Users can submit feature requests through the system.</p>
              </div>
            ) : (
              <div className="space-y-4">
                {featureRequests.map((request) => (
                  <div key={request.id} className="border border-gray-200 rounded-lg p-4 hover:bg-gray-50">
                    <div className="flex items-start justify-between">
                      <div className="flex-1">
                        <div className="flex items-center gap-3 mb-2">
                          <h4 className="text-sm font-medium text-gray-900">{request.title}</h4>
                          <span className={`px-2 py-1 text-xs rounded-full ${
                            request.status === 'pending' ? 'bg-yellow-100 text-yellow-800' :
                            request.status === 'in-progress' ? 'bg-blue-100 text-blue-800' :
                            'bg-green-100 text-green-800'
                          }`}>
                            {request.status}
                          </span>
                          <span className={`px-2 py-1 text-xs rounded-full ${
                            request.priority === 'high' ? 'bg-red-100 text-red-800' :
                            request.priority === 'medium' ? 'bg-yellow-100 text-yellow-800' :
                            'bg-green-100 text-green-800'
                          }`}>
                            {request.priority}
                          </span>
                        </div>
                        <p className="text-sm text-gray-600 mb-2">{request.description}</p>
                        <div className="flex items-center gap-4 text-xs text-gray-500">
                          <span>By: {request.createdBy}</span>
                          <span>•</span>
                          <span>{new Date(request.createdAt).toLocaleDateString()}</span>
                          <span>•</span>
                          <span>{request.votes} votes</span>
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {activeTab === 'bug-reports' && (
        /* Bug Reports View */
        <div className="space-y-6">
          <div className="bg-white shadow-sm rounded-lg border border-gray-200 p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold text-gray-900">Bug Reports ({bugReports.length})</h3>
              <button
                className="flex items-center gap-2 px-4 py-2 text-white rounded-lg transition-colors"
                style={{ 
                  backgroundColor: '#F37021',
                }}
                onMouseEnter={(e) => (e.currentTarget as HTMLButtonElement).style.backgroundColor = '#E55A1A'}
                onMouseLeave={(e) => (e.currentTarget as HTMLButtonElement).style.backgroundColor = '#F37021'}
              >
                <PlusIcon className="h-4 w-4" />
                New Report
              </button>
            </div>

            {bugReports.length === 0 ? (
              <div className="text-center py-8">
                <ExclamationTriangleIcon className="mx-auto h-12 w-12 text-gray-400" />
                <h3 className="mt-2 text-sm font-medium text-gray-900">No bug reports yet</h3>
                <p className="mt-1 text-sm text-gray-500">Users can submit bug reports through the system.</p>
              </div>
            ) : (
              <div className="space-y-4">
                {bugReports.map((report) => (
                  <div key={report.id} className="border border-gray-200 rounded-lg p-4 hover:bg-gray-50">
                    <div className="flex items-start justify-between">
                      <div className="flex-1">
                        <div className="flex items-center gap-3 mb-2">
                          <h4 className="text-sm font-medium text-gray-900">{report.title}</h4>
                          <span className={`px-2 py-1 text-xs rounded-full ${
                            report.status === 'open' ? 'bg-red-100 text-red-800' :
                            report.status === 'investigating' ? 'bg-yellow-100 text-yellow-800' :
                            'bg-green-100 text-green-800'
                          }`}>
                            {report.status}
                          </span>
                          <span className={`px-2 py-1 text-xs rounded-full ${
                            report.severity === 'critical' ? 'bg-red-100 text-red-800' :
                            report.severity === 'high' ? 'bg-orange-100 text-orange-800' :
                            report.severity === 'medium' ? 'bg-yellow-100 text-yellow-800' :
                            'bg-green-100 text-green-800'
                          }`}>
                            {report.severity}
                          </span>
                        </div>
                        <p className="text-sm text-gray-600 mb-2">{report.description}</p>
                        <div className="flex items-center gap-4 text-xs text-gray-500">
                          <span>Reported by: {report.reportedBy}</span>
                          <span>•</span>
                          <span>{new Date(report.createdAt).toLocaleDateString()}</span>
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
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
type Phase = typeof PHASES[number];

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
  assignedTo?: string; // Team member ID
  status: 'pending' | 'in-progress' | 'completed';
  dueDate?: string;
  phase?: Phase;
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
  type: 'content-analysis' | 'qnr' | 'report' | 'other' | 'word' | 'excel' | 'powerpoint';
  uploadedAt: string;
  size: string;
  url?: string;
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
  phase: Phase;
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
  segments: Array<{ phase: Phase; startDate: string; endDate: string; startDay?: number; endDay?: number }>; // dates required, numeric optional
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

// Helper function for getting initials
const getInitials = (name: string) => {
  const words = name.split(' ');
  if (words.length === 1) {
    return words[0][0].toUpperCase();
  }
  // Put first initial in front, then remaining initials
  const firstInitial = words[0][0];
  const remainingInitials = words.slice(1).map(n => n[0]).join('');
  return (firstInitial + remainingInitials).toUpperCase();
};

// Helper function for getting member color (consistent across all contexts)
const getMemberColor = (memberId: string, projectId?: string) => {
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
  
  // Use only memberId for consistent colors across all contexts
  // This ensures the same person always gets the same color regardless of project
  const identifier = memberId;
  
  // Simple hash function to get consistent color for each member
  let hash = 0;
  for (let i = 0; i < identifier.length; i++) {
    const char = identifier.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // Convert to 32-bit integer
  }
  
  return colors[Math.abs(hash) % colors.length];
};

export default function App() {
  const { user, logout } = useAuth();
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [route, setRoute] = useState("Home");
  const [toolsDropdownOpen, setToolsDropdownOpen] = useState(false);
  const [projects, setProjects] = useState<Project[]>([]);
  const [loadingProjects, setLoadingProjects] = useState(false);
  const [isNavigatingToProject, setIsNavigatingToProject] = useState(false);
  const [projectToNavigate, setProjectToNavigate] = useState<Project | null>(null);
  const [savedContentAnalyses, setSavedContentAnalyses] = useState<any[]>([]);

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
      // Force refresh by adding timestamp to prevent caching
      const response = await fetch(`${API_BASE_URL}/api/projects?userId=${user.id}&t=${Date.now()}`, {
        headers: { 'Authorization': `Bearer ${localStorage.getItem('jaice_token')}` }
      });
      if (response.ok) {
        const data = await response.json();

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
                    name: 'Oncology Study - Patient Journey Analysis',
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
                "Copy Cost Tracker shell to job folder",
                "Coordinate discussion guide updates from client",
                "Confirm attendee list with client",
                "Get and finalize stimuli",
                "Monitor recruits and update quotas",
                "Create invite template",
                "Create Content Analysis (CA)",
                "Send Outlook invites with respondent details and observer login info",
                "Brief moderator",
                "Create notetaking schedule and align team",
                "Set up ShareFile folder",
                "Send final stimuli/workbooks/guide to moderator",
                "Schedule client debrief after first 1-2 interviews"
              ],
              "Fielding": [
                "Create report shell based on discussion guide and objectives",
                "Engage transcriptionist (if needed)",
                "Request invoice (if needed)",
                "Continue updating report shell with interview content",
                "Submit AE reports within 24 hours",
                "Download audio files and transcripts daily",
                "Manage stimuli changes",
                "Track high-level findings for client",
                "Ensure objectives are being met",
                "Engage with moderator and ask probes",
                "Schedule second client debrief (if needed)"
              ],
              "Post-Field Analysis": [
                "Clean project folder",
                "Internal download: all audio files, CA, transcripts, lessons, and notes",
                "Submit AE reconciliation (if needed)"
              ],
              "Reporting": [
                "Write findings",
                "Write executive summary",
                "Have report proofed",
                "Have report reviewed internally",
                "Send report to client",
                "Update report based on client comments",
                "Request invoice (if needed)",
                "Save vendor invoices and submit to accounting",
                "Reconcile with client-specific finance process",
                "Fill out Cost Tracker"
              ]
            }
          };

          return projects.map(project => {
            // Only update Qualitative projects that have outdated task counts
            if (project.methodologyType === 'Qualitative' && project.tasks) {
              const kickoffTasks = project.tasks.filter((task: any) => task.phase === 'Kickoff');
              const reportingTasks = project.tasks.filter((task: any) => task.phase === 'Reporting');

              // Check if project has outdated task lists (less than expected tasks)
              const needsUpdate = kickoffTasks.length < 21 || reportingTasks.length < 10;

              if (needsUpdate) {

                // Keep completed tasks and non-Qualitative tasks
                const nonQualTasks = project.tasks.filter((task: any) =>
                  !['Kickoff', 'Pre-Field', 'Fielding', 'Post-Field Analysis', 'Reporting'].includes(task.phase)
                );

                // Create all new tasks for each phase
                const newTasks: any[] = [];

                Object.entries(UPDATED_TASK_LIST.Qualitative).forEach(([phase, taskList]) => {
                  taskList.forEach((taskContent, index) => {
                    // Check if this exact task already exists and is completed
                    const existingTask = project.tasks.find((task: any) =>
                      task.phase === phase && task.content === taskContent && task.completed
                    );

                    newTasks.push({
                      id: existingTask?.id || `${phase.toLowerCase()}-${project.id}-${index}`,
                      content: taskContent,
                      phase: phase,
                      completed: existingTask?.completed || false,
                      assignedTo: existingTask?.assignedTo || null,
                      dueDate: existingTask?.dueDate || null,
                      notes: existingTask?.notes || '',
                      completedBy: existingTask?.completedBy || null,
                      completedDate: existingTask?.completedDate || null
                    });
                  });
                });

                return {
                  ...project,
                  tasks: [...nonQualTasks, ...newTasks]
                };
              }
            }

            return project;
          });
        };

        // Fix timezone issues and regenerate key dates for all projects
        const projectsWithCA = addDemoContentAnalyses(data.projects || []);
        const projectsWithCorrectedTasks = updateProjectsWithCorrectedTasks(projectsWithCA);
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
                'Authorization': `Bearer ${localStorage.getItem('jaice_token')}`
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
        headers: { 'Authorization': `Bearer ${localStorage.getItem('jaice_token')}` }
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

  const toolsNav = useMemo(
    () => [
      { name: "Content Analysis", icon: DocumentChartBarIcon },
      { name: "QNR", icon: ClipboardDocumentListIcon },
      { name: "Data QA", icon: CheckBadgeIcon },
    ],
    []
  );

  const adminNav = useMemo(
    () => user?.role === 'admin' ? [{ name: "Admin Center", icon: Cog6ToothIcon }] : [],
    [user?.role]
  );

  // Auto-open tools dropdown when a tool is selected
  useEffect(() => {
    if (toolsNav.some(item => route === item.name)) {
      setToolsDropdownOpen(true);
    }
  }, [route, toolsNav]);

  return (
    <AuthWrapper>
    <div className="min-h-screen w-full flex bg-gray-50 text-gray-800">
      <aside
          className={`${sidebarOpen ? "w-64" : "w-20"} hidden md:flex flex-col border-r bg-white/90 backdrop-blur-sm sticky top-0 h-screen`}
          style={{ width: sidebarOpen ? 256 : 80 }}
        >
        <div className={`flex items-center border-b p-3 ${sidebarOpen ? 'justify-between' : 'justify-center'}`}>
          <div className="flex items-center">
            <img
              src={sidebarOpen ? "/Jaice_Logo_Transparent.png" : "/Circle.png"}
              alt="Jaice Logo"
              className={`object-contain transition-all ${sidebarOpen ? "h-8" : "h-8 w-8 cursor-pointer hover:opacity-70"}`}
              onClick={() => !sidebarOpen && setSidebarOpen(true)}
            />
          </div>
          {sidebarOpen && (
            <button
              className="p-1.5 hover:bg-gray-100 rounded-lg transition-colors"
              onClick={() => setSidebarOpen(false)}
            >
              <svg className="h-5 w-5 text-gray-600" fill="none" viewBox="0 0 24 24">
                <rect x="3" y="3" width="18" height="18" rx="2" stroke="currentColor" strokeWidth="2" fill="none"/>
                <rect x="3" y="3" width="6" height="18" rx="2" fill="currentColor" opacity="0.3"/>
                <line x1="9" y1="3" x2="9" y2="21" stroke="currentColor" strokeWidth="2"/>
              </svg>
            </button>
          )}
        </div>
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

          {/* Tools Dropdown */}
          <div className="space-y-1">
            <button
              onClick={() => setToolsDropdownOpen(!toolsDropdownOpen)}
              className={`w-full flex items-center gap-3 rounded-xl px-3 py-2 hover:bg-gray-100 transition ${
                toolsNav.some(item => route === item.name) ? "bg-gray-100" : ""
              } ${!sidebarOpen ? 'justify-center' : ''}`}
            >
              <WrenchScrewdriverIcon className="h-5 w-5" />
              {sidebarOpen && (
                <>
                  <span className="text-sm font-medium">Tools</span>
                  {toolsDropdownOpen ? (
                    <ChevronUpIcon className="h-4 w-4 ml-auto" />
                  ) : (
                    <ChevronDownIcon className="h-4 w-4 ml-auto" />
                  )}
                </>
              )}
            </button>
            
            {/* Tools Dropdown Items */}
            {sidebarOpen && toolsDropdownOpen && (
              <div className="ml-4 space-y-1">
                {toolsNav.map((item) => (
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
        </nav>
        
        {/* Admin Center - Bottom of sidebar */}
        {adminNav.length > 0 && (
          <div className="p-2 border-t">
            {adminNav.map((item) => (
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
          </div>
        )}
        
        {/* User info and sign out */}
        <div className={`mt-auto p-3 border-t ${!sidebarOpen ? 'flex justify-center' : ''}`}>
          <div className={`flex items-center gap-3 mb-3 ${!sidebarOpen ? 'mb-0' : ''}`}>
            <div className="w-8 h-8 rounded-full flex items-center justify-center" style={{ backgroundColor: BRAND.orange }}>
              <span className="text-white text-sm font-bold">
                {getInitials(user?.name || 'User')}
              </span>
            </div>
            {sidebarOpen && (
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium text-gray-900 truncate">
                  {user?.name || 'User'}
                </div>
                <div className="text-xs text-gray-500 truncate">
                  {user?.email || 'user@example.com'}
                </div>
                <div 
                  className="text-xs text-red-600 cursor-pointer hover:text-red-700 transition mt-1"
                  onClick={logout}
                >
                  Sign out
                </div>
              </div>
            )}
          </div>
        </div>
      </aside>

      {route === "Content Analysis" ? (
        <ContentAnalysisX projects={projects} onNavigate={setRoute} />
      ) : (
        <main className="flex-1 overflow-visible" style={{ background: BRAND.bg }}>
          <div className="p-5 overflow-y-auto h-screen max-w-full">
            {isNavigatingToProject ? (
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
            ) : (
              <>
                {route === "Home" && <Dashboard projects={projects} loading={loadingProjects} onProjectCreated={handleProjectCreated} onNavigateToProject={handleProjectView} />}
                {route === "Project Hub" && <ProjectHub projects={projects} onProjectCreated={handleProjectCreated} onArchive={handleArchiveProject} setProjects={setProjects} savedContentAnalyses={savedContentAnalyses} setRoute={setRoute} initialProject={projectToNavigate} />}
              </>
            )}
            {route === "Vendor Library" && <VendorLibrary projects={projects} />}
            {route === "Admin Center" && <AdminCenter />}
            {route !== "Home" && route !== "Project Hub" && route !== "Content Analysis" && route !== "Vendor Library" && route !== "Admin Center" && <Placeholder name={route} />}
          </div>
        </main>
      )}
    </div>
    </AuthWrapper>
  );

}

// Dashboard component defined outside App
function Dashboard({ projects, loading, onProjectCreated, onNavigateToProject }: { projects: Project[]; loading?: boolean; onProjectCreated?: (project: Project) => void; onNavigateToProject?: (project: Project) => void }) {
  const { user } = useAuth();
  const [showProjectWizard, setShowProjectWizard] = useState(false);
  const [allProjects, setAllProjects] = useState<Project[]>([]);
  const [loadingAllProjects, setLoadingAllProjects] = useState(false);
  const [showAllProjects, setShowAllProjects] = useState(false);
  const [showMyProjectsOnly, setShowMyProjectsOnly] = useState(true);
  const [moderatorDateRange, setModeratorDateRange] = useState('');
  const [projectTimelineDateRange, setProjectTimelineDateRange] = useState('');
  const [vendorsData, setVendorsData] = useState<any>(null);

  // Fetch all projects across all users
  const loadAllProjects = useCallback(async () => {
    setLoadingAllProjects(true);
    try {
      const response = await fetch(`${API_BASE_URL}/api/projects/all`, {
        headers: { 'Authorization': `Bearer ${localStorage.getItem('jaice_token')}` }
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
  const loadVendorsData = useCallback(() => {
    try {
      const storedVendors = localStorage.getItem('jaice_vendors');
      if (storedVendors) {
        const data = JSON.parse(storedVendors);
        setVendorsData(data);
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
    const currentWeek = 0;
    const now = new Date();
    
    return projects
      .filter(p => {
        const currentPhaseSegment = p.segments?.find(s =>
          currentWeek >= s.startDay && currentWeek <= s.endDay
        );
        const isCurrentlyActive = !!currentPhaseSegment;
        const isWithinKickoffBuffer = p.segments?.[0] && currentWeek >= (p.segments[0].startDay - 7) && currentWeek <= (p.segments[0].endDay + 7);
        const lastSegment = p.segments?.[p.segments.length - 1];
        const isWithinCompletionBuffer = lastSegment && currentWeek >= (lastSegment.startDay - 7) && currentWeek <= (lastSegment.endDay + 7);

        return isCurrentlyActive || isWithinKickoffBuffer || isWithinCompletionBuffer;
      })
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
      const uid = user?.id;
      const uemail = (user as any)?.email?.toLowerCase?.();
      const uname = (user as any)?.name?.toLowerCase?.();
      return allProjects.filter(project => {
        const createdByMe = (project as any).createdBy && (project as any).createdBy === uid;
        const inTeam = (project.teamMembers || []).some((member: any) =>
          member?.id === uid ||
          (member?.email && uemail && String(member.email).toLowerCase() === uemail) ||
          (member?.name && uname && String(member.name).toLowerCase() === uname)
        );
        return createdByMe || inTeam;
      });
    }
    return allProjects;
  }, [allProjects, showMyProjectsOnly, user?.id]);

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

  // Get projects to display (first 5 or all if showAllProjects is true)
  const displayedProjects = showAllProjects ? sortedProjects : sortedProjects.slice(0, 5);

  return (
    <div className="space-y-6 w-full max-w-full overflow-x-hidden">
      {/* Global Filter Controls */}
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-bold" style={{ color: BRAND.gray }}>Project Dashboard</h2>
        <div className="flex items-center gap-2">
          <span className="text-sm text-gray-600">Current View:</span>
          <button
            onClick={() => setShowMyProjectsOnly(!showMyProjectsOnly)}
            className={`px-3 py-1 text-xs rounded-lg shadow-sm transition-colors ${
              showMyProjectsOnly
                ? 'text-white hover:opacity-90'
                : 'bg-white border border-gray-300 hover:bg-gray-50'
            }`}
            style={showMyProjectsOnly ? { backgroundColor: BRAND.orange } : {}}
          >
            {showMyProjectsOnly ? 'Only My Projects' : 'All Cognitive Projects'}
          </button>
        </div>
      </div>

      {/* All Projects Summary Table */}
      <div className="bg-white shadow-sm border border-gray-200 rounded-lg overflow-hidden">
        {loadingAllProjects ? (
          <div className="text-center py-8">
            <div className="w-8 h-8 flex items-center justify-center mx-auto mb-2">
              <svg className="animate-spin" width="32" height="32" viewBox="0 0 48 48">
                <circle cx="24" cy="24" r="20" fill="none" stroke="#D14A2D" strokeWidth="4" strokeDasharray="50 75.4" strokeDashoffset="0" />
                <circle cx="24" cy="24" r="20" fill="none" stroke="#5D5F62" strokeWidth="4" strokeDasharray="50 75.4" strokeDashoffset="-62.7" />
              </svg>
            </div>
            <p className="text-sm text-gray-500">Loading projects...</p>
            </div>
        ) : filteredProjects.length === 0 ? (
          <div className="text-center py-8">
            <div className="w-12 h-12 bg-gray-100 rounded-full flex items-center justify-center mx-auto mb-3">
              <FolderIcon className="h-6 w-6 text-gray-400" />
                  </div>
            <p className="text-sm text-gray-500">
              {showMyProjectsOnly ? 'No projects found where you are a team member' : 'No active projects found'}
            </p>
              </div>
        ) : (
          <>
            <div className="overflow-x-auto w-full">
              <table className="w-full divide-y divide-gray-200">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-2 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Project Name</th>
                    <th className="px-2 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Client</th>
                    <th className="px-2 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Status</th>
                    <th className="px-2 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Team</th>
                    <th className="px-2 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Type</th>
                    <th className="px-2 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Methodology</th>
                    <th className="px-2 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Sample</th>
                    <th className="px-2 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Moderator</th>
                    <th className="px-2 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Fieldwork</th>
                    <th className="px-2 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Report</th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-200">
                  {displayedProjects.map((project) => {
                    // Get current phase
                    const getCurrentPhase = (project: Project): string => {
                      if (!project.segments || project.segments.length === 0) {
                        return project.phase;
                      }
                      const today = new Date();
                      const todayStr = today.toISOString().split('T')[0]; // YYYY-MM-DD format
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
                    const phaseColor = PHASE_COLORS[currentPhase] || PHASE_COLORS['Kickoff'];
                    
                    // Get fieldwork range
                    const fieldworkSegment = project.segments?.find(s => s.phase === 'Fielding');
                    const fieldworkRange = fieldworkSegment && fieldworkSegment.startDate && fieldworkSegment.endDate
                      ? `${formatDateForDisplay(fieldworkSegment.startDate)} - ${formatDateForDisplay(fieldworkSegment.endDate)}`
                      : 'TBD';

                    // Get report deadline
                    const reportDeadline = project.keyDeadlines?.find(kd => kd.label.includes('Report'))?.date || 
                                         project.keyDeadlines?.find(kd => kd.label.includes('Final'))?.date || 
                                         new Date(project.endDate + 'T00:00:00Z').toLocaleDateString('en-US', { month: 'numeric', day: 'numeric', year: '2-digit' });

                    // Get methodology type
                    const methodologyType = project.methodologyType ||
                                          (project.methodology?.includes('Focus') || project.methodology?.includes('Interview') ? 'Qualitative' : 'Quantitative');
                    const displayMethodologyType = methodologyType === 'Quantitative' ? 'Quant' : methodologyType === 'Qualitative' ? 'Qual' : methodologyType;

                    // Get sample details (placeholder - you may need to add this field to projects)
                    const sampleDetails = project.sampleDetails || 'TBD';

                    // Get moderator - look up by ID to get the name
                    let moderator = 'TBD';
                    if (project.moderator) {
                      // First try to find by ID (new format)
                      const moderatorData = vendorsData?.moderators?.find((m: any) => m.id === project.moderator);
                      if (moderatorData) {
                        moderator = moderatorData.name;
                      } else {
                        // Fallback to direct name for old projects
                        moderator = project.moderator;
                      }
                    }
                    // Show '-' for Quant projects instead of 'TBD'
                    if (methodologyType === 'Quantitative' && moderator === 'TBD') {
                      moderator = '-';
                    }
                    // Remove 'internal' tag from moderator names
                    if (moderator && moderator !== 'TBD' && moderator !== '-') {
                      moderator = moderator.replace(/\s*\(internal\)/gi, '').trim();
                    }

                    const isArchived = project.archived === true;
                    
                    return (
                      <tr 
                        key={project.id} 
                        className={`hover:bg-gray-50 cursor-pointer ${isArchived ? 'opacity-60 bg-gray-50' : ''}`}
                        onClick={() => onNavigateToProject?.(project)}
                      >
                        <td className="px-2 py-3 text-sm font-medium text-gray-900 max-w-[180px]">
                          <div>
                            {project.name}
                            {isArchived && <span className="ml-2 text-xs text-gray-500">(Archived)</span>}
                          </div>
                        </td>
                        <td className="px-2 py-3 text-sm text-gray-500 italic max-w-[150px]">
                          <div className="truncate">{project.client}</div>
                        </td>
                        <td className="px-2 py-3">
                          <span
                            className="inline-flex items-center justify-center w-24 px-2 py-1 rounded-full text-xs font-medium text-white opacity-60"
                            style={{ backgroundColor: isArchived ? '#6B7280' : phaseColor }}
                          >
                            {isArchived ? 'Archived' : currentPhase}
                          </span>
                        </td>
                        <td className="px-2 py-3 text-sm text-gray-500">
                          <div className="flex items-center">
                            {project.teamMembers?.slice(0, 3).map((member, index) => (
                              <div
                                key={`${project.id}-${member.id}-${index}`}
                                className="w-6 h-6 rounded-full flex items-center justify-center text-white text-[10px] font-medium border-2 border-white"
                                style={{
                                  backgroundColor: '#6B7280',
                                  marginLeft: index > 0 ? '-4px' : '0',
                                  zIndex: 10 - index
                                }}
                              >
                                {member.name.split(' ').map(n => n[0]).join('').toUpperCase()}
                              </div>
                            ))}
                            {project.teamMembers && project.teamMembers.length > 3 && (
                              <div
                                className="w-6 h-6 rounded-full flex items-center justify-center text-white text-[10px] font-medium border-2 border-white bg-gray-500"
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
                        <td className="px-2 py-3 text-sm text-gray-500 max-w-[100px]">
                          <div className="truncate">{displayMethodologyType}</div>
                        </td>
                        <td className="px-2 py-3 text-sm text-gray-500 max-w-[120px]">
                          <div>{project.methodology}</div>
                        </td>
                        <td className="px-2 py-3 text-sm text-gray-500 max-w-[150px]">
                          {(() => {
                            if (!sampleDetails || sampleDetails === 'TBD') {
                              return <div className="text-sm text-gray-500">TBD</div>;
                            }
                            const match = String(sampleDetails).match(/^(.+?)\s*\((.+?)\)$/);
                            const totalText = match ? match[1].trim() : String(sampleDetails);
                            const subgroupText = match ? match[2] : '';
                            const subgroups = subgroupText ? subgroupText.split(',').map(s => s.trim()) : [];
                            return (
                              <div className="relative group inline-block">
                                <div className="text-sm text-gray-700 font-medium">{totalText}</div>
                                {subgroups.length > 0 && (
                                  <div className="absolute left-0 mt-1 hidden group-hover:block z-50 bg-white border border-gray-200 shadow-lg rounded-md p-2 w-56">
                                    <div className="text-xs font-semibold text-gray-600 mb-1">Sub-groups</div>
                                    <ul className="list-disc list-inside space-y-0.5 text-xs text-gray-700">
                                      {subgroups.map((sg, idx) => (
                                        <li key={idx}>{sg}</li>
                                      ))}
                                    </ul>
                                  </div>
                                )}
                              </div>
                            );
                          })()}
                        </td>
                        <td className="px-2 py-3 text-sm text-gray-500 max-w-[120px]">
                          <div className="truncate">{moderator}</div>
                        </td>
                        <td className="px-2 py-3 text-sm text-gray-500">{fieldworkRange}</td>
                        <td className="px-2 py-3 text-sm text-gray-500">{reportDeadline}</td>
                      </tr>
                    );
                  })}
              </tbody>
            </table>
          </div>
          
          {/* Show More/Less Button */}
          {filteredProjects.length > 5 && (
            <div className="mt-4 text-center">
              <button
                onClick={() => setShowAllProjects(!showAllProjects)}
                className="bg-gray-100 hover:bg-gray-200 text-gray-700 px-4 py-2 rounded-lg text-sm font-medium transition-colors"
              >
                {showAllProjects ? 'Show Less' : `Show More (${filteredProjects.length - 5} more)`}
              </button>
            </div>
          )}
          </>
        )}
      </div>

      {/* Project Timeline */}
      <Card>
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-semibold text-lg">Project Timeline</h3>
          <div className="flex flex-wrap gap-3 text-xs">
            <div className="flex items-center gap-2">
              <div className="w-3 h-3 rounded" style={{ backgroundColor: PHASE_COLORS.Kickoff, opacity: 0.6 }}></div>
              <span>Kickoff</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-3 h-3 rounded" style={{ backgroundColor: PHASE_COLORS['Pre-Field'], opacity: 0.6 }}></div>
              <span>Pre-Field</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-3 h-3 rounded" style={{ backgroundColor: PHASE_COLORS.Fielding, opacity: 0.6 }}></div>
              <span>Fielding</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-3 h-3 rounded" style={{ backgroundColor: PHASE_COLORS['Post-Field Analysis'], opacity: 0.6 }}></div>
              <span>Post-Field Analysis</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-3 h-3 rounded" style={{ backgroundColor: PHASE_COLORS.Reporting, opacity: 0.6 }}></div>
              <span>Reporting</span>
            </div>
          </div>
        </div>

        <ProjectTimeline projects={sortedProjects} onDateRangeChange={setProjectTimelineDateRange} />
      </Card>

      {/* Moderator Schedule */}
      <Card>
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-semibold text-lg">Moderator Schedule</h3>
          <div className="text-sm text-gray-600">
            {moderatorDateRange}
          </div>
        </div>

        <ModeratorTimeline projects={sortedProjects} onDateRangeChange={setModeratorDateRange} />
      </Card>

          </div>
  );
}

// Project Timeline Component
function ProjectTimeline({ projects, onDateRangeChange }: { projects: Project[]; onDateRangeChange?: (dateRange: string) => void }) {
  const [currentWeekOffset, setCurrentWeekOffset] = useState(0); // Start with current week like Moderator Schedule
  const [isScrolling, setIsScrolling] = useState(false);
  const [visibleWeeks, setVisibleWeeks] = useState(5);
  const timelineRef = useRef<HTMLDivElement>(null);

  // Calculate number of weeks to show based on container width
  useEffect(() => {
    const updateVisibleWeeks = () => {
      if (timelineRef.current) {
        const containerWidth = timelineRef.current.offsetWidth;
        // Each week needs ~180px minimum for comfortable viewing
        const weeksToShow = Math.max(2, Math.min(5, Math.floor(containerWidth / 180)));
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

  // Generate weeks data
  const weeks = Array.from({ length: visibleWeeks }, (_, i) => {
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

  // Smooth scroll functions
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
    <div className="relative">



      {/* Timeline Container */}
      <div ref={timelineRef} className="overflow-x-auto pb-4 select-none px-2">
        <div className="min-w-full transition-all duration-300 ease-out">
          {/* Timeline Headers */}
          <div className="flex mb-0 transition-all duration-300 ease-out">
            {/* Navigation Controls - inline with month headers */}
            <div className="w-40 flex-shrink-0 pr-6 flex items-center gap-1">
              <button onClick={scrollLeft} disabled={isScrolling || currentWeekOffset <= -20} className="p-2 text-gray-500 hover:text-gray-700 disabled:opacity-50">
                <ChevronLeftIcon className="w-5 h-5" />
              </button>
              <button onClick={resetToCurrentWeek} disabled={isScrolling} className="px-4 py-1 text-xs bg-gray-100 hover:bg-gray-200 rounded-md transition-colors disabled:opacity-50 whitespace-nowrap">
                This Week
              </button>
              <button onClick={scrollRight} disabled={isScrolling || currentWeekOffset >= 20} className="p-2 text-gray-500 hover:text-gray-700 disabled:opacity-50">
                <ChevronRightIcon className="w-5 h-5" />
              </button>
            </div>

            {/* Month Headers */}
            <div className="flex-1 flex">
              {(() => {
                // Group all days by month
                const allDays = weeks.flatMap(week => week.days);
                const monthGroups: { month: string; days: Date[]; startIndex: number; endIndex: number }[] = [];
                
                let currentMonth = '';
                let currentGroup: Date[] = [];
                let startIndex = 0;
                
                allDays.forEach((day, index) => {
                  const month = day.toLocaleDateString('en-US', { month: 'long' });
                  
                  if (month !== currentMonth) {
                    // Save previous group if it exists
                    if (currentGroup.length > 0) {
                      monthGroups.push({
                        month: currentMonth,
                        days: currentGroup,
                        startIndex: startIndex,
                        endIndex: startIndex + currentGroup.length - 1
                      });
                    }
                    
                    // Start new group
                    currentMonth = month;
                    currentGroup = [day];
                    startIndex = index;
                  } else {
                    currentGroup.push(day);
                  }
                });
                
                // Add the last group
                if (currentGroup.length > 0) {
                  monthGroups.push({
                    month: currentMonth,
                    days: currentGroup,
                    startIndex: startIndex,
                    endIndex: startIndex + currentGroup.length - 1
                  });
                }
                
                return monthGroups.map((group, groupIndex) => (
                  <div
                    key={groupIndex}
                    className="text-center py-1 text-sm font-semibold text-gray-700 bg-gray-100 border-r border-gray-200 last:border-r-0"
                    style={{
                      flex: `${group.days.length} 0 0`,
                      minWidth: `${group.days.length * 28}px`
                    }}
                  >
                    {group.month}
                      </div>
                ));
              })()}
              </div>
                    </div>

          {/* Timeline Container with Continuous Lines */}
          <div className="relative transition-all duration-300 ease-out">
            {/* Vertical divider lines - cover entire timeline */}
            <div className="absolute top-0 left-40 right-0 pointer-events-none z-40" style={{ height: '100%' }}>
              <div className="flex h-full">
                {weeks.map((week, weekIndex) => (
                  <div key={weekIndex} className="flex-1 flex min-w-[140px] relative">
                    {week.days.map((day, dayIndex) => (
                      <div key={`${weekIndex}-${dayIndex}`} className="flex-1 relative">
                        {dayIndex < 4 && (
                          <div className="absolute top-0 bottom-0 right-0 w-px bg-gray-200"></div>
                        )}
                      </div>
                    ))}
                    {/* Week divider line - between Friday and Monday */}
                    {weekIndex < weeks.length - 1 && (
                      <div className="absolute top-0 bottom-0 right-0 w-px bg-gray-200"></div>
                    )}
                  </div>
                ))}
                  </div>
                </div>
            {/* Day Headers */}
            <div className="flex mb-0">
              {/* Project Name Column Header (empty space) */}
              <div className="w-40 flex-shrink-0 pl-4"></div>
              
              {/* Day Headers */}
              <div className="flex-1 flex">
                {weeks.map((week, weekIndex) => (
                  <div key={weekIndex} className="flex-1 min-w-[140px] relative">
                    <div className={`flex relative z-20 ${week.isCurrentWeek ? 'bg-orange-50' : ''}`}>
                      {week.days.map((day, dayIndex) => (
                        <div key={`${weekIndex}-${dayIndex}`} className={`flex-1 text-center py-2 text-xs text-gray-600 border-r border-gray-200 last:border-r-0 ${
                          week.isCurrentWeek ? 'bg-orange-50' : 'bg-gray-50'
                        }`}>
                          <div className="font-medium">
{(day.getUTCMonth() + 1)}/{day.getUTCDate()}
                  </div>
                          <div className="text-gray-500">
                            {['Mon', 'Tue', 'Wed', 'Thu', 'Fri'][dayIndex]}
                </div>
              </div>
                      ))}
            </div>
        </div>
                ))}
        </div>
              </div>

            {/* Project Rows */}
            <div className="space-y-0 relative transition-all duration-300 ease-out">
              {/* Current week highlighting overlay - extends full height through all projects */}
              {weeks.map((week, weekIndex) => (
                week.isCurrentWeek && (
                  <div
                    key={`highlight-${weekIndex}`}
                    className="absolute top-0 bottom-0 bg-orange-50 pointer-events-none z-0"
                    style={{
                      left: `calc(160px + ${weekIndex} * (100% - 160px) / ${weeks.length})`, // 160px for project name column + proportional width
                      width: `calc((100% - 160px) / ${weeks.length})`, // Proportional width for one week
                    }}
                  ></div>
                )
              ))}

              
              {/* Horizontal line above first project */}
              <div className="border-b border-gray-200 relative z-10"></div>
              
              {projects.map((project, projectIndex) => (
                <div key={project.id} className={`flex relative z-50 ${projectIndex < projects.length - 1 ? 'border-b border-gray-200' : ''}`}>
                  {/* Project Name */}
                  <div className="w-40 flex-shrink-0 py-2">
                    <div className="text-sm font-medium text-gray-900 truncate">
                      {project.name}
                    </div>
                    <div className="text-xs text-gray-500 truncate">
                      {project.client}
                    </div>
                  </div>
                  
                  {/* Timeline Pills */}
                  <div className="flex-1 flex items-center">
                    {(() => {
                      // Create a flattened array of all days across all weeks for proper phase boundary detection
                      const allDays = weeks.flatMap(week => week.days);
                      const allPhases = allDays.map(day => getProjectPhaseForDate(project, day));
                      
                      return weeks.map((week, weekIndex) => (
                        <div key={weekIndex} className="flex-1 flex">
                          {week.days.map((day, dayIndex) => {
                            const globalDayIndex = weeks.slice(0, weekIndex).reduce((acc, w) => acc + w.days.length, 0) + dayIndex;
                            const phase = allPhases[globalDayIndex];
                            const phaseColor = phase ? PHASE_COLORS[phase as keyof typeof PHASE_COLORS] : 'transparent';
                            
                            // Check phase boundaries across all weeks
                            const prevPhase = globalDayIndex > 0 ? allPhases[globalDayIndex - 1] : null;
                            const nextPhase = globalDayIndex < allPhases.length - 1 ? allPhases[globalDayIndex + 1] : null;
                            
                            const isPhaseStart = phase && phase !== prevPhase;
                            const isPhaseEnd = phase && phase !== nextPhase;
                            
                            
                            // Check if this day has any key deadlines
                            const keyDeadline = project.keyDeadlines?.find(kd => {
                              // Parse the key deadline date (MM/DD/YY format)
                              const [month, dayNum, year] = kd.date.split('/').map(Number);
                              
                              // Handle 2-digit year properly
                              const fullYear = year < 50 ? 2000 + year : 1900 + year;
                              const kdDate = new Date(fullYear, month - 1, dayNum);
                              
                              // Compare with the timeline day (use UTC methods consistently)
                              const dayYear = day.getUTCFullYear();
                              const dayMonth = day.getUTCMonth();
                              const dayDate = day.getUTCDate();

                              // Normalize both dates to midnight UTC to avoid timezone issues
                              const normalizedKdDate = new Date(Date.UTC(kdDate.getFullYear(), kdDate.getMonth(), kdDate.getDate()));
                              const normalizedDay = new Date(Date.UTC(dayYear, dayMonth, dayDate));
                              
                              
                              return normalizedKdDate.getTime() === normalizedDay.getTime();
                            });
                            
                            return (
                              <div key={`${weekIndex}-${dayIndex}`} className="flex-1 h-8 relative flex items-center">
                                {phase && (
                                  <div
                                    className={`absolute opacity-60 ${
                                      isPhaseStart && isPhaseEnd ? 'rounded-full' : // Single day phase - full circle
                                      isPhaseStart ? 'rounded-l-full' : // Start of phase - left half circle
                                      isPhaseEnd ? 'rounded-r-full' : // End of phase - right half circle
                                      'rounded-none' // Middle of phase
                                    }`}
                                    style={{
                                      backgroundColor: phaseColor,
                                      top: '2px',
                                      bottom: '2px',
                                      left: isPhaseStart ? '2px' : '0px',
                                      right: isPhaseEnd ? '2px' : '0px'
                                    }}
                                    title={`${project.name} - ${phase} - ${day.toLocaleDateString()}`}
                                  />
                                )}
                                
                                {/* Key deadline indicators */}
                                {keyDeadline && (
                                  <div className="absolute inset-0 flex items-center justify-center z-10" title={`${keyDeadline.label} - ${keyDeadline.date}`}>
                                    {keyDeadline.label.toLowerCase().includes('report') || keyDeadline.label.toLowerCase().includes('final') ? (
                                      <svg className="w-5 h-5 text-white drop-shadow-sm" fill="currentColor" viewBox="0 0 20 20">
                                        <path fillRule="evenodd" d="M4 4a2 2 0 012-2h4.586A2 2 0 0112 2.586L15.414 6A2 2 0 0116 7.414V16a2 2 0 01-2 2H6a2 2 0 01-2-2V4zm2 6a1 1 0 011-1h6a1 1 0 110 2H7a1 1 0 01-1-1zm1 3a1 1 0 100 2h6a1 1 0 100-2H7z" clipRule="evenodd" />
                                      </svg>
                                    ) : keyDeadline.label.toLowerCase().includes('fielding') || keyDeadline.label.toLowerCase().includes('field') ? (
                                      <RocketLaunchIconSolid className="w-5 h-5 text-white drop-shadow-sm" />
                                    ) : keyDeadline.label.toLowerCase().includes('kickoff') ? (
                                      <PlayIconSolid className="w-5 h-5 text-white drop-shadow-sm" />
                                    ) : (
                                      <svg className="w-5 h-5 text-white drop-shadow-sm" fill="currentColor" viewBox="0 0 20 20">
                                        <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clipRule="evenodd" />
                                      </svg>
                                    )}
                                  </div>
                                )}
                  </div>
                            );
                          })}
                  </div>
                      ));
                    })()}
                  </div>
            </div>
          ))}
                </div>
                
        </div>
        </div>
      </div>
    </div>
  );
}

// Moderator Timeline Component
function ModeratorTimeline({ projects, onDateRangeChange }: { projects: Project[]; onDateRangeChange?: (dateRange: string) => void }) {
  const [currentWeekOffset, setCurrentWeekOffset] = useState(0);
  const [isScrolling, setIsScrolling] = useState(false);
  const [visibleWeeks, setVisibleWeeks] = useState(5);
  const timelineRef = useRef<HTMLDivElement>(null);

  // Calculate number of weeks to show based on container width
  useEffect(() => {
    const updateVisibleWeeks = () => {
      if (timelineRef.current) {
        const containerWidth = timelineRef.current.offsetWidth;
        // Each week needs ~180px minimum for comfortable viewing
        const weeksToShow = Math.max(2, Math.min(5, Math.floor(containerWidth / 180)));
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

  // Generate weeks data
  const weeks = Array.from({ length: visibleWeeks }, (_, i) => {
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

  // Load moderators from localStorage
  const loadModerators = () => {
    try {
      const vendorsData = localStorage.getItem('jaice_vendors');
      if (vendorsData) {
        const vendors = JSON.parse(vendorsData);
        return vendors.moderators || [];
      }
      return [];
    } catch (error) {
      console.error('Error loading moderators:', error);
      return [];
    }
  };

  const moderators = loadModerators();

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
      <div ref={timelineRef} className="overflow-x-auto pb-4 select-none px-2">
        <div className="min-w-full">
          {/* Timeline Headers */}
          <div className="flex mb-0">
            {/* Navigation Controls - inline with month headers */}
            <div className="w-40 flex-shrink-0 pr-6 flex items-center gap-1">
              <button onClick={goToPreviousWeek} disabled={isScrolling} className="p-2 text-gray-500 hover:text-gray-700 disabled:opacity-50">
                <ChevronLeftIcon className="w-5 h-5" />
              </button>
              <button onClick={goToCurrentWeek} disabled={isScrolling} className="px-4 py-1 text-xs bg-gray-100 hover:bg-gray-200 rounded-md transition-colors disabled:opacity-50 whitespace-nowrap">
                This Week
              </button>
              <button onClick={goToNextWeek} disabled={isScrolling} className="p-2 text-gray-500 hover:text-gray-700 disabled:opacity-50">
                <ChevronRightIcon className="w-5 h-5" />
              </button>
            </div>

            {/* Month Headers */}
            <div className="flex-1 flex">
              {(() => {
                // Group all days by month
                const allDays = weeks.flatMap(week => week.days);
                const monthGroups: { month: string; days: Date[]; startIndex: number; endIndex: number }[] = [];

                let currentMonth = '';
                let currentGroup: Date[] = [];
                let startIndex = 0;

                allDays.forEach((day, index) => {
                  const month = day.toLocaleDateString('en-US', { month: 'long' });

                  if (month !== currentMonth) {
                    // Save previous group if it exists
                    if (currentGroup.length > 0) {
                      monthGroups.push({
                        month: currentMonth,
                        days: currentGroup,
                        startIndex: startIndex,
                        endIndex: startIndex + currentGroup.length - 1
                      });
                    }

                    // Start new group
                    currentMonth = month;
                    currentGroup = [day];
                    startIndex = index;
                  } else {
                    currentGroup.push(day);
                  }
                });

                // Add the last group
                if (currentGroup.length > 0) {
                  monthGroups.push({
                    month: currentMonth,
                    days: currentGroup,
                    startIndex: startIndex,
                    endIndex: startIndex + currentGroup.length - 1
                  });
                }

                return monthGroups.map((group, groupIndex) => (
                  <div
                    key={groupIndex}
                    className="text-center py-1 text-sm font-semibold text-gray-700 bg-gray-100 border-r border-gray-200 last:border-r-0"
                    style={{
                      flex: `${group.days.length} 0 0`,
                      minWidth: `${group.days.length * 28}px`
                    }}
                  >
                    {group.month}
                  </div>
                ));
              })()}
            </div>
          </div>

          {/* Timeline Container with Continuous Lines */}
          <div className="relative">
            {/* Vertical divider lines - cover entire timeline */}
            <div className="absolute top-0 left-40 right-0 pointer-events-none z-40" style={{ height: '100%' }}>
              <div className="flex h-full">
                {weeks.map((week, weekIndex) => (
                  <div key={weekIndex} className="flex-1 flex min-w-[140px] relative">
                    {week.days.map((day, dayIndex) => (
                      <div key={`${weekIndex}-${dayIndex}`} className="flex-1 relative">
                        {dayIndex < 4 && (
                          <div className="absolute top-0 bottom-0 right-0 w-px bg-gray-200"></div>
                        )}
                      </div>
                    ))}
                    {/* Week divider line - between Friday and Monday */}
                    {weekIndex < weeks.length - 1 && (
                      <div className="absolute top-0 bottom-0 right-0 w-px bg-gray-200"></div>
                    )}
                  </div>
                ))}
              </div>
            </div>
            {/* Day Headers */}
            <div className="flex mb-0">
              {/* Moderator Name Column Header (empty space) */}
              <div className="w-40 flex-shrink-0 pl-4"></div>

              {/* Day Headers */}
              <div className="flex-1 flex">
                {weeks.map((week, weekIndex) => (
                  <div key={weekIndex} className="flex-1 min-w-[140px] relative">
                    <div className={`flex relative z-20 ${week.isCurrentWeek ? 'bg-orange-50' : ''}`}>
                      {week.days.map((day, dayIndex) => (
                        <div
                          key={`${weekIndex}-${dayIndex}`}
                          className={`flex-1 text-center py-2 text-xs text-gray-600 border-r border-gray-200 last:border-r-0 ${
                            week.isCurrentWeek ? 'bg-orange-50' : 'bg-gray-50'
                          }`}
                        >
                          <div className="font-medium">
{(day.getUTCMonth() + 1)}/{day.getUTCDate()}
                          </div>
                          <div className="text-gray-500">
                            {['Mon', 'Tue', 'Wed', 'Thu', 'Fri'][dayIndex]}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Moderator Rows */}
            <div className="space-y-0 border-t border-gray-200">
              {moderators.length === 0 ? (
                <div className="flex items-center justify-center py-8 text-gray-500">
                  <div className="text-center">
                    <div className="text-sm">No moderators found</div>
                    <div className="text-xs mt-1">Add moderators in the Vendor Library to see their schedules</div>
                  </div>
                </div>
              ) : (
                moderators.map((moderator: any) => (
                    <div key={moderator.id} className="flex items-stretch border-b border-gray-100 hover:bg-gray-25">
                    {/* Moderator Name Column */}
                    <div className="w-40 flex-shrink-0 py-3 flex flex-col justify-center">
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
                          <div key={weekIndex} className="flex-1 flex">
                            {week.days.map((day, dayIndex) => {
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
                                  className={`flex-1 h-full relative ${
                                    dayIndex < 4 ? 'border-r border-gray-100' : ''
                                  } ${isUnavailable ? 'bg-gray-300' : week.isCurrentWeek ? 'bg-orange-50' : ''}`}
                                ></div>
                              );
                            })}
                          </div>
                        ))}
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
                              <span className={`text-xs font-medium truncate px-2 ${(isPending || isHold) ? 'text-gray-700' : 'text-white'}`}>
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
        headers: { 'Authorization': `Bearer ${localStorage.getItem('jaice_token')}` }
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
          headers: { 'Authorization': `Bearer ${localStorage.getItem('jaice_token')}` }
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
          headers: { 'Authorization': `Bearer ${localStorage.getItem('jaice_token')}` }
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
                        headers: { 'Authorization': `Bearer ${localStorage.getItem('jaice_token')}` }
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
                  <div className={`h-3 w-3 rounded-full ${busy ? 'bg-orange-500' : 'bg-green-500'}`} />
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
      <div className="grid grid-cols-7 text-center text-xs text-gray-500 px-2 py-2">
        {days.map((d) => (
          <div key={d} className="py-1">
            {d}
          </div>
        ))}
      </div>
      <div className="grid grid-cols-7 gap-1 px-2 pb-3">
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
        weekdays.push({
          day,
          phase: getPhaseForDay(day),
          isToday: day === today.getDate() && month === today.getMonth() && year === today.getFullYear()
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
            {project.phase}
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
                      {weekdays.map((dayInfo, index) => (
                        <div
                          key={dayInfo.day}
                          className={`w-4 h-4 flex items-center justify-center text-xs font-medium ${dayInfo.isToday ? 'ring-1 ring-gray-600' : ''}`}
                          style={{
                            color: '#374151',
                            backgroundColor: dayInfo.phase ? `${PHASE_COLORS[dayInfo.phase]}30` : 'transparent',
                            borderRadius: '3px'
                          }}
                        >
                          {dayInfo.day}
                        </div>
                      ))}
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
      <div className="text-xs bg-white/20 inline-block px-2 py-1 rounded-full mb-2">{badge}</div>
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
                {p.phase}
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
                  className="absolute top-0 bottom-0 bg-orange-100/20 pointer-events-none"
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
            className="px-2 py-1 rounded-full"
            style={{
              background: `${PHASE_COLORS[ph]}22`,
              color: PHASE_COLORS[ph],
            }}
          >
            {ph}
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
  initialProject?: Project | null;
}

function ProjectHub({ projects, onProjectCreated, onArchive, setProjects, savedContentAnalyses = [], setRoute, initialProject = null }: ProjectHubProps) {
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

  const [showProjectWizard, setShowProjectWizard] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  const [filterPhase, setFilterPhase] = useState<Phase | "All">("All");
  const [editingProject, setEditingProject] = useState<Project | null>(null);
  const [viewingProject, setViewingProject] = useState<Project | null>(null);

  // Handle initial project navigation
  useEffect(() => {
    if (initialProject) {
      console.log('ProjectHub: initialProject provided:', initialProject.name);
      setSelectedProject(initialProject);
      setShowDashboard(true);
      setIsTransitioning(false);

      // Initialize team members with project team members + creator
      const creator = initialProject.teamMembers?.find((m: any) => m.id === initialProject.createdBy);
      const allMembers = creator
        ? initialProject.teamMembers
        : [...(initialProject.teamMembers || []), { id: initialProject.createdBy, name: 'Project Creator', role: 'Owner' }];

      setLocalTeamMembers(allMembers || []);
    }
  }, [initialProject]);
  const [archivedProjects, setArchivedProjects] = useState<Project[]>([]);
  const [showArchivedProjects, setShowArchivedProjects] = useState(false);
  const [loadingArchived, setLoadingArchived] = useState(false);
  const [selectedProject, setSelectedProject] = useState<Project | null>(null);
  const [showDashboard, setShowDashboard] = useState(false);
  const [isTransitioning, setIsTransitioning] = useState(false);
  const [showAddTeamMember, setShowAddTeamMember] = useState(false);
  const [localTeamMembers, setLocalTeamMembers] = useState<Array<{ id: string; name: string; role: string; email?: string }>>([]);
  const [activeTab, setActiveTab] = useState<'active' | 'archived'>('active');
  const [showMyProjectsOnly, setShowMyProjectsOnly] = useState(true);

  // Load archived projects
  const loadArchivedProjects = async () => {
    if (!user?.id) return;

    setLoadingArchived(true);
    try {
      const response = await fetch(`${API_BASE_URL}/api/projects/archived?userId=${user.id}` , {
        headers: { 'Authorization': `Bearer ${localStorage.getItem('jaice_token')}` }
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
      const uid = user?.id;
      const uemail = (user as any)?.email?.toLowerCase?.();
      const uname = (user as any)?.name?.toLowerCase?.();
      return tabProjects.filter(project => {
        const createdByMe = (project as any).createdBy && (project as any).createdBy === uid;
        const inTeam = (project.teamMembers || []).some((member: any) =>
          member?.id === uid ||
          (member?.email && uemail && String(member.email).toLowerCase() === uemail) ||
          (member?.name && uname && String(member.name).toLowerCase() === uname)
        );
        return createdByMe || inTeam;
      });
    }
    
    return tabProjects;
  };

  // Show all projects with calculated current phase and sort by final report date
  const filteredProjects = getCurrentTabProjects()
    .map(project => ({
    ...project,
    phase: getCurrentPhase(project) // Use calculated current phase
    }))
    .sort((a, b) => {
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
          'Authorization': `Bearer ${localStorage.getItem('jaice_token')}`
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
          'Authorization': `Bearer ${localStorage.getItem('jaice_token')}`
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
            'Content-Type': 'application/json'
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

  const handleProjectView = (project: Project) => {
    setSelectedProject(project);
    setIsTransitioning(true);

    // Initialize team members with project team members + creator
    const initialTeamMembers = [...(project.teamMembers || [])];

    // Add project creator if not already in team members
    if (user && !initialTeamMembers.some(member => member.id === user.id)) {
      initialTeamMembers.unshift({
        id: user.id,
        name: user.name,
        role: 'Project Creator',
        email: user.email
      });
    }

    setLocalTeamMembers(initialTeamMembers);

    // Start transition animation
    setTimeout(() => {
      setShowDashboard(true);
      setIsTransitioning(false);
    }, 1500);
  };

  const handleReturnToHub = () => {
    setIsTransitioning(true);
    
    // Start transition animation
    setTimeout(() => {
      setShowDashboard(false);
      setSelectedProject(null);
      setIsTransitioning(false);
    }, 300);
  };

  // Save team members to backend
  const saveTeamMembersToProject = async (updatedTeamMembers: Array<{ id: string; name: string; role: string; email?: string }>) => {
    if (!selectedProject || !user?.id) return;

    try {
      const updatedProject = {
        ...selectedProject,
        teamMembers: updatedTeamMembers
      };

      const response = await fetch(`${API_BASE_URL}/api/projects/${selectedProject.id}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${localStorage.getItem('jaice_token')}`
        },
        body: JSON.stringify({
          userId: user.id,
          project: updatedProject
        })
      });

      if (response.ok) {
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
        console.log('Team members saved successfully');
      } else {
        console.error('Failed to save team members');
      }
    } catch (error) {
      console.error('Error saving team members:', error);
    }
  };

  // Team member management functions
  const handleAddTeamMember = async (user: User) => {
    const newTeamMember = {
      id: user.id,
      name: user.name,
      role: 'Team Member',
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
    const updatedTeamMembers = selectedProject?.teamMembers?.filter(member => member.id !== memberId) || [];
    setLocalTeamMembers(updatedTeamMembers);

    // Save to backend
    await saveTeamMembersToProject(updatedTeamMembers);
    console.log('Removing team member:', memberId);
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
              <div className="h-6 w-px bg-gray-300"></div>
              <div className="flex items-center gap-3">
                <h2 className="text-2xl font-bold" style={{ color: "#5D5F62" }}>
                  {selectedProject.name}
                </h2>
                <span className="px-3 py-1 rounded-full text-sm font-medium text-white shadow-sm opacity-60" style={{ background: PHASE_COLORS[getCurrentPhase(selectedProject)] }}>
                  {getCurrentPhase(selectedProject)}
                </span>
              </div>
            </div>

            {/* Team Members Section */}
            <div className="flex items-center gap-3">
              <span className="text-gray-500 text-sm">Team Members</span>
              <div className="w-px h-4 bg-gray-300"></div>
              <div className="flex items-center gap-2">
                {selectedProject.teamMembers?.slice(0, 4).map((member, index) => {
                  const initials = member.name.split(' ').map(n => n[0]).join('').toUpperCase();
                  return (
                    <div
                      key={member.id}
                      className="w-8 h-8 rounded-full flex items-center justify-center text-white text-xs font-medium relative group"
                      style={{ backgroundColor: getMemberColor(member.id) }}
                    >
                      {initials}
                      {/* Tooltip */}
                      <div className="absolute bottom-full left-1/2 transform -translate-x-1/2 mb-2 px-2 py-1 bg-gray-800 text-white text-xs rounded shadow-lg opacity-0 group-hover:opacity-100 transition-opacity duration-200 pointer-events-none whitespace-nowrap z-50">
                        {member.name}
                        <div className="absolute top-full left-1/2 transform -translate-x-1/2 w-0 h-0 border-l-4 border-r-4 border-t-4 border-transparent border-t-gray-800"></div>
                      </div>
                    </div>
                  );
                })}
                <button
                  onClick={() => setShowAddTeamMember(true)}
                  className="w-8 h-8 rounded-full border-2 border-dashed border-gray-300 flex items-center justify-center text-gray-400 hover:border-gray-400 hover:text-gray-600 transition-colors"
                  title="Add team member"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
                  </svg>
                </button>
              </div>
            </div>
          </div>

          {/* Add Team Member Search */}
          {showAddTeamMember && (
            <div className="mb-6 bg-white p-4 rounded-lg border shadow-sm">
              <h4 className="text-sm font-medium mb-3">Add Team Member</h4>
              <UserSearch
                onUserSelect={handleAddTeamMember}
                placeholder="Search for team members..."
                className="text-sm"
              />
              <div className="flex justify-end gap-2 mt-3">
                <button
                  onClick={() => setShowAddTeamMember(false)}
                  className="px-3 py-1 text-xs text-gray-500 hover:text-gray-700"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}

          {/* Project Dashboard Content */}
          <ProjectDashboard
            project={selectedProject}
            onEdit={() => {
              setShowDashboard(false);
              setEditingProject(selectedProject);
            }}
            onArchive={onArchive}
            setProjects={setProjects}
            savedContentAnalyses={savedContentAnalyses}
            setRoute={setRoute}
          />
        </div>
      )}

      {/* Project Hub View */}
      {!showDashboard && !isTransitioning && (
      <div className="space-y-5">
        {/* Header */}
        <section className="flex items-center justify-between">
          <h2 className="text-2xl font-bold" style={{ color: BRAND.gray }}>Project Hub</h2>
          <div className="flex items-center gap-2">
            <span className="text-sm text-gray-600">Current View:</span>
            <button
              onClick={() => setShowMyProjectsOnly(!showMyProjectsOnly)}
              className={`px-3 py-1 text-xs rounded-lg shadow-sm transition-colors ${
                showMyProjectsOnly
                  ? 'text-white hover:opacity-90'
                  : 'bg-white border border-gray-300 hover:bg-gray-50'
              }`}
              style={showMyProjectsOnly ? { backgroundColor: BRAND.orange } : {}}
            >
              {showMyProjectsOnly ? 'Only My Projects' : 'All Cognitive Projects'}
            </button>
          </div>
        </section>

        {/* Tabs and New Project Button */}
        <div className="border-b border-gray-200">
          <div className="flex items-center">
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
              Active ({proposalProjects.length + activeProjects.length})
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
              Archived ({archivedProjects.length})
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
          </div>
        </div>

        {/* Projects Table */}
        <div className="bg-white shadow-sm border border-gray-200 rounded-lg overflow-hidden">
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Project
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Team
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Status
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Fieldwork
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Report
                  </th>
                  <th className="px-6 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {filteredProjects.map((project) => (
                  <tr
                    key={project.id}
                    className="hover:bg-gray-50 cursor-pointer"
                    onClick={() => handleProjectView(project)}
                  >
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div>
                        <div className="text-sm font-medium text-gray-900">{project.name}</div>
                        <div className="text-sm text-gray-500">{project.client}</div>
                      </div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className="flex -space-x-2">
                        {project.teamMembers?.slice(0, 4).map((member, index) => (
                          <div
                            key={`${project.id}-${member.id || member.name}-${index}`}
                            className="w-8 h-8 rounded-full border-2 border-white flex items-center justify-center text-xs font-medium text-white"
                            style={{ backgroundColor: getMemberColor(member.id || member.name) }}
                            title={member.name}
                          >
                            {member.name.split(' ').map(n => n[0]).join('').toUpperCase()}
                          </div>
                        ))}
                        {project.teamMembers && project.teamMembers.length > 4 && (
                          <div className="w-8 h-8 rounded-full bg-gray-300 border-2 border-white flex items-center justify-center text-xs font-medium text-gray-600">
                            +{project.teamMembers.length - 4}
                          </div>
                        )}
                      </div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <span className={`inline-flex items-center justify-center w-20 px-2 py-1 rounded-full text-xs font-medium text-white opacity-60 ${
                        project.phase === 'Kickoff' ? 'bg-gray-500' :
                        project.phase === 'Pre-Field' ? 'bg-blue-500' :
                        project.phase === 'Fielding' ? 'bg-purple-500' :
                        project.phase === 'Post-Field Analysis' ? 'bg-orange-500' :
                        project.phase === 'Reporting' ? 'bg-red-500' :
                        project.phase === 'Awaiting KO' ? 'bg-yellow-500' :
                        project.phase === 'Complete' ? 'bg-green-500' :
                        'bg-gray-500'
                      }`}>
                        {project.phase === 'Post-Field Analysis' ? 'Post-Field' : project.phase}
                      </span>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                      {getFieldworkRange(project)}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                      {getReportDate(project)}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
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
                          <button
                            onClick={(e) => handleArchiveProject(project, e)}
                            className="text-gray-600 hover:text-gray-800 p-1 rounded-lg hover:bg-gray-50"
                            title="Archive project"
                          >
                            <ArchiveBoxIcon className="w-4 h-4" />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* Empty State */}
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
  const [newTask, setNewTask] = useState<{ description: string; assignedTo: string; status: Task['status'] }>({ description: "", assignedTo: "", status: "pending" });
  const [newTeamMember, setNewTeamMember] = useState({ name: "", email: "" });
  const [showNewDeadline, setShowNewDeadline] = useState(false);
  const [showNewTask, setShowNewTask] = useState(false);
  const [showNewTeamMember, setShowNewTeamMember] = useState(false);
  const [showDatePickerForTask, setShowDatePickerForTask] = useState(false);
  const [selectedTaskForDate, setSelectedTaskForDate] = useState<string | null>(null);

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
        assignedTo: newTask.assignedTo || undefined,
        status: newTask.status
      };
      setFormData(prev => ({
        ...prev,
        tasks: [...prev.tasks, task]
      }));
      setNewTask({ description: "", assignedTo: "", status: "pending" });
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
                      className="w-40 border rounded-xl px-3 py-2 outline-none focus:ring-2 focus:ring-orange-200"
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
                      className="w-40 border rounded-xl px-3 py-2 outline-none focus:ring-2 focus:ring-orange-200"
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
                    <select
                      value={task.assignedTo || ""}
                      onChange={(e) => {
                        const newTasks = formData.tasks.map(t =>
                          t.id === task.id ? { ...t, assignedTo: e.target.value || undefined } : t
                        );
                        setFormData(prev => ({ ...prev, tasks: newTasks }));
                      }}
                      className="w-40 border rounded-xl px-3 py-2 outline-none focus:ring-2 focus:ring-orange-200"
                    >
                      <option value="">Unassigned</option>
                      {formData.teamMembers.map(member => (
                        <option key={member.id} value={member.id}>{member.name}</option>
                      ))}
                    </select>
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
                      className={`p-2 rounded-lg ${task.dueDate ? 'text-orange-600 bg-orange-50' : 'text-gray-400 hover:text-gray-600 hover:bg-gray-50'}`}
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
                    <select
                      value={newTask.assignedTo}
                      onChange={(e) => setNewTask(prev => ({ ...prev, assignedTo: e.target.value }))}
                      className="w-40 border rounded-xl px-3 py-2 outline-none focus:ring-2 focus:ring-orange-200"
                    >
                      <option value="">Unassigned</option>
                      {formData.teamMembers.map(member => (
                        <option key={member.id} value={member.id}>{member.name}</option>
                      ))}
                    </select>
                    <select
                      value={newTask.status}
                      onChange={(e) => setNewTask(prev => ({ ...prev, status: e.target.value as Task['status'] }))}
                      className="w-32 border rounded-xl px-3 py-2 outline-none focus:ring-2 focus:ring-orange-200"
                    >
                      <option value="pending">Pending</option>
                      <option value="in-progress">In Progress</option>
                      <option value="completed">Completed</option>
                    </select>
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
                      className="w-40 border rounded-xl px-3 py-2 outline-none focus:ring-2 focus:ring-orange-200"
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
                      className="w-40 border rounded-xl px-3 py-2 outline-none focus:ring-2 focus:ring-orange-200"
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
          selectedDate={formData.tasks.find(t => t.id === selectedTaskForDate)?.dueDate || ''}
          onDateSelect={(date) => {
                const newTasks = formData.tasks.map(t =>
              t.id === selectedTaskForDate ? { ...t, dueDate: date } : t
                );
                setFormData(prev => ({ ...prev, tasks: newTasks }));
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

function ProjectDashboard({ project, onEdit, onArchive, setProjects, savedContentAnalyses = [], setRoute }: { project: Project; onEdit: () => void; onArchive: (projectId: string) => void; setProjects?: (projects: Project[] | ((prev: Project[]) => Project[])) => void; savedContentAnalyses?: any[]; setRoute?: (route: string) => void }) {
  const { user } = useAuth();

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

  const currentPhase = getCurrentPhase(project);
  const phaseColor = PHASE_COLORS[currentPhase] || PHASE_COLORS['Kickoff'];
  const [showAddTask, setShowAddTask] = useState(false);
  const [newTask, setNewTask] = useState({ description: "", assignedTo: "", status: "pending" as Task['status'] });
  const [currentMonth, setCurrentMonth] = useState(new Date());
  const [showFullCalendar, setShowFullCalendar] = useState(true);
  const [editingTimeline, setEditingTimeline] = useState(false);
  const [editingSegments, setEditingSegments] = useState(project.segments || []);
  const [activePhase, setActivePhase] = useState(project.phase);
  const [projectTasks, setProjectTasks] = useState(project.tasks);
  const [showAllTasks, setShowAllTasks] = useState(false);
  const [maxVisibleTasks, setMaxVisibleTasks] = useState(8);
  const taskContainerRef = useRef<HTMLDivElement>(null);
  const [showCalendarDropdown, setShowCalendarDropdown] = useState(false);
  const [selectedTaskForDate, setSelectedTaskForDate] = useState<string | null>(null);
  const [showDatePickerForTaskInDashboard, setShowDatePickerForTaskInDashboard] = useState(false);
  const [selectedTaskForDateInDashboard, setSelectedTaskForDateInDashboard] = useState<string | null>(null);

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
            'Authorization': `Bearer ${localStorage.getItem('jaice_token')}`
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
    if (JSON.stringify(projectTasks) !== JSON.stringify(project.tasks)) {
      saveProject();
    }
  }, [projectTasks, project.id, project.tasks, user?.id]);
  const [selectedDay, setSelectedDay] = useState<{ day: number; phase: string; deadlines: string[]; notes: string[]; tasks: any[] } | null>(null);
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

  // Sync local state when project prop changes
  useEffect(() => {
    setProjectNotes(project.notes || []);
    setArchivedNotes(project.archivedNotes || []);
  }, [project.notes, project.archivedNotes]);
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
  const [moderators, setModerators] = useState<any[]>([]);
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
        const storedVendors = localStorage.getItem('jaice_vendors');
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
                          (project.methodology?.includes('Focus') || project.methodology?.includes('Interview') ? 'Qualitative' : 'Quantitative');
    
    if (methodologyType === 'Quantitative') {
      return []; // No moderators for quantitative projects
    }

    if (!project.segments || project.segments.length === 0) {
      return moderators; // Return all if no field dates set
    }

    // Get all projects to check for conflicts
    const allProjects = JSON.parse(localStorage.getItem('jaice_projects') || '[]');

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
        'client': 'client'
      };

      const projectField = fieldMapping[field] || field;
      const updatedProject = { ...project, [projectField]: value };

      const response = await fetch(`${API_BASE_URL}/api/projects/${project.id}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${localStorage.getItem('jaice_token')}`
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

  const updateTaskAssignment = (taskId: string, assignedTo: string) => {
    setProjectTasks(prevTasks =>
      prevTasks.map(task =>
        task.id === taskId
          ? { ...task, assignedTo: assignedTo || undefined }
          : task
      )
    );
  };

  const handleAddTask = () => {
    if (newTask.description.trim()) {
      const task: Task = {
        id: `task-${Date.now()}`,
        description: newTask.description,
        assignedTo: newTask.assignedTo || undefined,
        status: newTask.status,
        phase: activePhase,
        dueDate: null
      };
      setProjectTasks(prevTasks => [...prevTasks, task]);
      setNewTask({ description: "", assignedTo: "", status: "pending" });
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
            'Authorization': `Bearer ${localStorage.getItem('jaice_token')}`
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
    
    // Only update state if the content actually changed to avoid cursor jumping
    if (value !== newNote.body) {
      setNewNote(prev => ({ ...prev, body: value }));
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
    
    const memberColor = getMemberColor(member.id, project.id);
    const firstName = member.name.split(' ')[0];
    
    // Get current content and replace @query with styled mention
    const currentContent = textareaRef.current.innerHTML;
    const newContent = currentContent.replace(
      new RegExp(`@${mentionQuery}\\b`, 'g'),
      `<span style="font-weight: bold; color: ${memberColor};">${firstName}</span>`
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
            'Authorization': `Bearer ${localStorage.getItem('jaice_token')}`
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
            'Authorization': `Bearer ${localStorage.getItem('jaice_token')}`
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
          'Authorization': `Bearer ${localStorage.getItem('jaice_token')}`
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
          'Authorization': `Bearer ${localStorage.getItem('jaice_token')}`
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
          'Authorization': `Bearer ${localStorage.getItem('jaice_token')}`
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
          'Authorization': `Bearer ${localStorage.getItem('jaice_token')}`
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

  const handleRemoveTeamMember = (memberId: string) => {
    setLocalTeamMembers(prev => prev.filter(member => member.id !== memberId));
    console.log('Removing team member:', memberId);
  };

  const hasKeyDateOnDay = (date: Date) => {
    const currentYear = date.getFullYear();
    const currentMonthNum = date.getMonth();
    const currentDay = date.getDate();
    
    return projectKeyDates.some(keyDate => {
      try {
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
      if (!task.dueDate || !task.assignedTo) return false;
      
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

  return (
    <div className="space-y-6">
      {/* Project Overview Boxes - Spanning Top */}
      <div className={`grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 ${project.methodologyType === 'Qualitative' ? 'xl:grid-cols-5' : 'xl:grid-cols-4'} gap-4`}>
        {/* Methodology Box */}
        <Card className="py-3">
          <div className="mb-2">
            <span className="text-sm font-bold text-gray-600 uppercase tracking-wide">METHODOLOGY</span>
          </div>
          <p className="text-sm text-gray-600 leading-relaxed">{project.methodology || 'Not specified'}</p>
        </Card>

        {/* Sample Details Box */}
        <Card className="py-3">
          <div className="mb-2">
            <span className="text-sm font-bold text-gray-600 uppercase tracking-wide">SAMPLE</span>
          </div>
          {(() => {
            const sampleDetails = project.sampleDetails || 'Not specified';
            
            // Check if sample details contain subgroups in parentheses
            const subgroupMatch = sampleDetails.match(/^(.+?)\s*\((.+?)\)$/);
            
            if (subgroupMatch) {
              const [, mainText, subgroups] = subgroupMatch;
              return (
                <div>
                  <p className="text-sm text-gray-600 leading-relaxed">{mainText.trim()}</p>
                  <p className="text-xs text-gray-500 italic mt-1 leading-relaxed">({subgroups})</p>
                </div>
              );
            }
            
            // If no subgroups found, display as normal
            return <p className="text-sm text-gray-600 leading-relaxed">{sampleDetails}</p>;
          })()}
        </Card>

        {/* Moderator Box - Only for Qualitative projects */}
        {project.methodologyType === 'Qualitative' && (
          <Card className="hover:shadow-md transition-shadow py-3">
            <div className="mb-2">
              <span className="text-sm font-bold text-gray-600 uppercase tracking-wide">MODERATOR</span>
            </div>
            {localProject.moderator && localProject.moderator !== 'internal' && localProject.moderator !== 'external' && localProject.moderator !== 'vendor' ? (
              <div className="flex items-center justify-between">
                <p className="text-sm text-gray-600 leading-relaxed">
                  {moderators.find(m => m.id === localProject.moderator || m.name === localProject.moderator)?.name || localProject.moderator}
                </p>
                <button
                  onClick={() => setShowModeratorModal(true)}
                  className="text-xs text-orange-600 hover:text-orange-700 underline"
                >
                  Change
                </button>
              </div>
            ) : (
              <button
                onClick={() => setShowModeratorModal(true)}
                className="flex items-center gap-1 px-3 py-1 text-xs bg-white text-gray-600 border border-gray-300 rounded-md hover:bg-gray-50 transition-colors"
              >
                <PlusIcon className="w-3 h-3" />
                Add Moderator
              </button>
            )}
          </Card>
        )}

        {/* Fieldwork Box */}
        <Card className="hover:shadow-md transition-shadow cursor-pointer py-3" onClick={() => console.log('Edit Fieldwork Dates - Use timeline editor')}>
          <div className="mb-2">
            <span className="text-sm font-bold text-gray-600 uppercase tracking-wide">FIELDWORK</span>
          </div>
          <p className="text-sm text-gray-600 leading-relaxed">
            {(() => {
              const fieldingSegment = localProject.segments?.find(s => s.phase === 'Fielding');
              return fieldingSegment && fieldingSegment.startDate && fieldingSegment.endDate
                ? `${formatDateForDisplay(fieldingSegment.startDate)} - ${formatDateForDisplay(fieldingSegment.endDate)}`
                : 'Not specified';
            })()}
          </p>
        </Card>

        {/* Client Box */}
        <Card className="py-3">
          <div className="mb-2">
            <span className="text-sm font-bold text-gray-600 uppercase tracking-wide">CLIENT</span>
          </div>
          <p className="text-sm text-gray-600 leading-relaxed">{project.client || 'Not specified'}</p>
        </Card>
      </div>

      {/* Main Layout: Left side (Tasks + Post-it Notes) and Right side (Calendar + Key Dates + Files/Notes) */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Left Half - Tasks and Post-it Notes */}
        <div className="space-y-6 flex flex-col">
          {/* Tasks Section */}
          <Card className="h-[500px] flex flex-col">
            <div className="mb-4 flex items-center justify-between">
              <h3 className="text-lg font-semibold text-gray-900">Tasks</h3>
              {!showAddTask && (
                <button
                  onClick={() => setShowAddTask(true)}
                  className="text-xs text-gray-500 hover:text-gray-700 flex items-center gap-1 px-2 py-1 rounded hover:bg-gray-100"
                >
                  <PlusSmallIcon className="h-3 w-3" />
                  Add task
                </button>
              )}
            </div>
            {/* Phase Tabs */}
            <div className="mb-4">
              <div className="flex flex-wrap items-stretch border-b">
                {PHASES.map((phase, index) => {
                  const phaseColor = PHASE_COLORS[phase as Phase];
                  const isActive = activePhase === phase;
                  return (
                    <button
                      key={phase}
                      className={`flex-1 px-3 py-1 text-xs font-medium transition-colors relative min-h-[32px] flex items-center justify-center ${
                        isActive
                          ? 'text-gray-900 shadow-sm z-10'
                          : 'text-gray-600 hover:text-gray-900 hover:bg-gray-50'
                      }`}
                      onClick={() => setActivePhase(phase as Phase)}
                      style={{
                        backgroundColor: isActive ? phaseColor + '20' : 'transparent',
                        borderTopLeftRadius: '6px',
                        borderTopRightRadius: '6px',
                        marginRight: '1px',
                        marginLeft: index === 0 ? '0' : '-1px',
                        border: '1px solid #d1d5db',
                        borderBottom: isActive ? 'none' : '1px solid #d1d5db',
                        position: 'relative',
                        zIndex: isActive ? 10 : 1,
                        borderColor: isActive ? phaseColor : '#d1d5db'
                      }}
                    >
                      {phase}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Tasks for Active Phase */}
            <div ref={taskContainerRef} className="space-y-2 flex-1 overflow-y-auto">
              {projectTasks
                .filter(task => task.phase === activePhase)
                .sort((a, b) => {
                  // Sort completed tasks to bottom
                  if (a.status === 'completed' && b.status !== 'completed') return 1;
                  if (a.status !== 'completed' && b.status === 'completed') return -1;
                  return 0;
                })
                .map((task) => {
                  return (
                    <div key={task.id} className="flex items-center gap-2 p-2 border rounded-lg hover:bg-gray-50">
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

                      {/* Calendar Icon for Due Date */}
                      <div className="relative">
                        {task.dueDate ? (
                          <div className="flex items-center gap-1">
                            <div 
                              className="px-2 py-1 rounded-full text-xs font-medium text-white opacity-60"
                              style={{ backgroundColor: PHASE_COLORS[activePhase] || '#6B7280' }}
                            >
                              {(() => {
                                const date = new Date(task.dueDate + 'T00:00:00');
                                return `${date.getMonth() + 1}/${date.getDate()}`;
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
                              className="text-xs text-gray-400 hover:text-red-500"
                              title="Remove due date"
                            >
                              ×
                            </button>
                          </div>
                        ) : (
                          <button
                            onClick={() => {
                              setSelectedTaskForDate(task.id);
                              setShowCalendarDropdown(!showCalendarDropdown);
                            }}
                            className="p-1.5 rounded-lg transition-colors text-gray-400 hover:text-gray-600 hover:bg-gray-50"
                            title="Set due date"
                          >
                            <CalendarIcon className="h-4 w-4" />
                          </button>
                        )}
                        
                        {/* Calendar Dropdown */}
                        {showCalendarDropdown && selectedTaskForDate === task.id && (
                          <div 
                            className="calendar-dropdown absolute top-10 right-0 z-50 bg-white border rounded-lg shadow-lg p-4 w-80"
                            onClick={(e) => e.stopPropagation()}
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
                          </div>
                        )}
                      </div>

                      {/* Assignment Section */}
                      <div className="flex items-center gap-2">
                        {task.assignedTo ? (
                          <div className="flex items-center gap-1">
                            <div className="w-6 h-6 rounded-full flex items-center justify-center text-white text-xs font-medium" style={{ backgroundColor: getMemberColor(task.assignedTo, project.id) }}>
                              {getInitials(project.teamMembers.find(m => m.id === task.assignedTo)?.name || 'Unknown')}
                            </div>
                            <button
                              onClick={() => updateTaskAssignment(task.id, '')}
                              className="text-xs text-gray-400 hover:text-red-500"
                            >
                              ×
                            </button>
                          </div>
                        ) : (
                          <select
                            onChange={(e) => updateTaskAssignment(task.id, e.target.value)}
                            className="w-20 h-6 rounded border border-gray-300 hover:border-gray-400 hover:text-gray-600 transition-colors appearance-none bg-white text-xs cursor-pointer px-2"
                            defaultValue=""
                          >
                            <option value="" disabled className="text-gray-600">Assign</option>
                            {project.teamMembers.map(member => (
                              <option key={member.id} value={member.id} className="text-gray-900">
                                {member.name}
                              </option>
                            ))}
                          </select>
                        )}
                      </div>
                    </div>
                  );
                })}

              {/* Show message if no tasks in this phase */}
              {projectTasks.filter(task => task.phase === activePhase).length === 0 && (
                <div className="text-xs text-gray-500 py-4 text-center">
                  No tasks in {activePhase} phase
                </div>
              )}

              {/* Add Task Form - Show in header area when active */}
              {showAddTask && (
                <div className="mb-4 p-3 border rounded-lg bg-gray-50">
                  <div className="space-y-2">
                    <input
                      type="text"
                      value={newTask.description}
                      onChange={(e) => setNewTask(prev => ({ ...prev, description: e.target.value }))}
                      placeholder="Task description"
                      className="w-full text-xs border rounded px-2 py-1 outline-none focus:ring-2 focus:ring-orange-200"
                    />
                    <div className="flex gap-2">
                      <select
                        value={newTask.assignedTo}
                        onChange={(e) => setNewTask(prev => ({ ...prev, assignedTo: e.target.value }))}
                        className="text-xs border rounded px-2 py-1 outline-none focus:ring-2 focus:ring-orange-200"
                      >
                        <option value="">Unassigned</option>
                        {project.teamMembers.map(member => (
                          <option key={member.id} value={member.id}>{member.name}</option>
                        ))}
                      </select>
                      <button
                        onClick={handleAddTask}
                        className="px-2 py-1 text-xs bg-orange-500 text-white rounded hover:bg-orange-600"
                      >
                        Add
                      </button>
                      <button
                        onClick={() => setShowAddTask(false)}
                        className="px-2 py-1 text-xs border rounded hover:bg-gray-100"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </Card>

          {/* Post-it Notes */}
          {projectNotes.filter(note => note.postToProjectPage).length > 0 ? (
            <div className="flex-1 flex gap-3 items-stretch">
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
                          <div className="w-5 h-5 rounded-full flex items-center justify-center text-white text-xs font-medium" style={{ fontSize: '10px', backgroundColor: getMemberColor(note.createdBy, project.id) }}>
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
          ) : (
            <Card className="flex-1 flex items-center justify-center">
              <button
                onClick={() => setShowAddNote(true)}
                className="w-full h-full border-2 border-dashed border-gray-300 rounded-lg text-gray-500 hover:border-gray-400 hover:text-gray-600 transition-colors flex items-center justify-center gap-2"
              >
                <PlusSmallIcon className="h-4 w-4" />
                <span className="text-sm">Add Post-it Note</span>
              </button>
            </Card>
          )}
        </div>

        {/* Right Half - Calendar, Key Dates, Files/Notes */}
        <div className="space-y-6">
          {/* Calendar at top right */}
        <Card>
            <div className="mb-3">
          </div>
          
            {/* Calendar Navigation */}
            <div className="flex items-center justify-between mb-4">
              <button
                onClick={() => {
                  setCurrentMonth(new Date(currentMonth.getFullYear(), currentMonth.getMonth() - 1));
                }}
                className="p-2 hover:bg-gray-100 rounded-lg"
              >
                <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                </svg>
              </button>
              <div className="flex items-center gap-3">
                <h4 className="text-lg font-semibold">
                  {currentMonth.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}
                </h4>
                <button
                  onClick={() => setShowTimelineEditor(true)}
                  className="text-xs text-orange-600 hover:text-orange-800 underline"
                >
                  Edit
                </button>
              </div>
              <button
                onClick={() => {
                  setCurrentMonth(new Date(currentMonth.getFullYear(), currentMonth.getMonth() + 1));
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
                  <div key={`segment-${segment.phase}-${index}`} className="flex items-center gap-1">
                    <div
                      className="w-3 h-3 rounded-full opacity-60"
                      style={{ background: PHASE_COLORS[segment.phase] }}
                    />
                    <span className="text-xs text-gray-700">{segment.phase}</span>
                </div>
              ))}
            </div>
            </div>

            {/* Calendar Grid */}
            <div className="space-y-1">
              {/* Day names header */}
              <div className="grid grid-cols-5 gap-1 mb-2">
                {['Mon', 'Tue', 'Wed', 'Thu', 'Fri'].map(day => (
                  <div key={day} className="h-8 flex items-center justify-center text-xs font-medium text-gray-500">
                    {day}
                  </div>
                ))}
              </div>
              {/* Calendar grid */}
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
                      return <div key={`${weekIndex}-${dayIndex}`} className="h-16" />;
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
                    const tasksWithBoth = getTasksWithBothAssignmentAndDate(dayObj.date);

                    return (
                      <div
                        key={`${weekIndex}-${dayIndex}`}
                        className={`relative p-2 text-center text-sm rounded-lg cursor-pointer hover:bg-gray-200 h-16 flex flex-col justify-between ${
                          isCurrentDay ? 'bg-gray-100' : isCurrentMonth ? 'bg-gray-100' : 'bg-white'
                        } ${isPastDate ? 'opacity-50' : ''}`}
                        style={{
                          backgroundColor: isCurrentWeekDay ? '#FED7AA40' : isCurrentDay ? '#F3F4F6' : isCurrentMonth ? '#F3F4F6' : '#FFFFFF',
                          border: isCurrentDay ? '2px solid #F97316' : !isCurrentMonth && !isCurrentWeekDay ? '1px solid #E5E7EB' : 'none'
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

                        {/* Task icon */}
                        {hasTask && (
                          <div className={`absolute top-1 left-1 z-10 ${isCurrentMonth ? 'opacity-60' : isPastDate ? 'opacity-40' : 'opacity-30'}`}>
                            {tasksWithBoth.length > 0 ? (
                              // Show initials when both assignment and date exist
                              <div 
                                className="w-4 h-4 rounded-full flex items-center justify-center text-white text-xs font-medium"
                                style={{ 
                                  backgroundColor: getMemberColor(tasksWithBoth[0].assignedTo, project.id),
                                  fontSize: '8px'
                                }}
                              >
                                {getInitials(project.teamMembers.find(m => m.id === tasksWithBoth[0].assignedTo)?.name || 'Unknown')}
                              </div>
                            ) : (
                              // Show note icon when only date exists
                              <DocumentTextIcon 
                                className="w-3 h-3" 
                                style={{ color: phaseForDay ? PHASE_COLORS[phaseForDay.phase] : '#6B7280' }}
                              />
                            )}
            </div>
          )}

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

          {/* Content Analysis and Key Dates side by side */}
          <div className={`grid grid-cols-1 gap-4 ${project.methodologyType === 'Qualitative' ? 'lg:grid-cols-2' : 'lg:grid-cols-1'}`}>
            {/* Content Analysis Box - Only for Qualitative projects */}
            {project.methodologyType === 'Qualitative' && (
              <Card>
                <div className="flex items-center justify-between mb-3">
                  <h3 className="font-semibold">Content Analysis</h3>
                </div>
                <div className="space-y-2">
                  {(() => {
                    const projectAnalyses = savedContentAnalyses.filter(analysis => analysis.projectId === project.id);
                    
                    if (projectAnalyses.length === 0) {
                      return (
                        <>
                          <div className="text-xs text-gray-500">
                            No content analysis yet
                          </div>
                          <button
                            onClick={() => setRoute && setRoute('Content Analysis')}
                            className="text-xs text-orange-600 hover:text-orange-800 flex items-center gap-1"
                          >
                            <PlusSmallIcon className="h-3 w-3" />
                            Add Content Analysis
                          </button>
                        </>
                      );
                    }
                    
                    return (
                      <>
                        {projectAnalyses.map((analysis) => {
                          // Count respondents only in Demographics sheet with IDs starting with 'R'
                          const respondentCount = analysis.data?.Demographics ?
                            analysis.data.Demographics.filter((row: any) => {
                              const respondentId = row['Respondent ID'] || row['respno'];
                              return respondentId && String(respondentId).trim().startsWith('R');
                            }).length : 0;

                          return (
                            <div
                              key={analysis.id}
                              className="text-xs cursor-pointer hover:bg-gray-50 p-1.5 rounded -mx-1.5 transition-colors"
                              onClick={() => {
                                setRoute && setRoute('Content Analysis');
                                // Navigate to the content analysis and load this specific analysis
                                setTimeout(() => {
                                  const event = new CustomEvent('loadContentAnalysis', { detail: { analysisId: analysis.id } });
                                  window.dispatchEvent(event);
                                }, 100);
                              }}
                            >
                              <div className="font-medium text-gray-900 truncate" title={analysis.name}>
                                {analysis.name}
                              </div>
                              <div className="text-gray-500">
                                {respondentCount} respondent{respondentCount !== 1 ? 's' : ''}
                              </div>
                            </div>
                          );
                        })}
                        <button
                          onClick={() => setRoute && setRoute('Content Analysis')}
                          className="text-xs text-orange-600 hover:text-orange-800 flex items-center gap-1 mt-1"
                        >
                          <PlusSmallIcon className="h-3 w-3" />
                          Add Another
                        </button>
                      </>
                    );
                  })()}
                </div>
              </Card>
            )}

            {/* Key Dates */}
            <Card>
              <div className="flex items-center justify-between mb-3">
                  <h3 className="font-semibold">Key Dates</h3>
                <button
                    onClick={() => setShowAddKeyDate(true)}
                  className="text-xs text-orange-600 hover:text-orange-800 flex items-center gap-1"
                >
                  <PlusSmallIcon className="h-3 w-3" />
                    Add
                </button>
              </div>
                <div className="space-y-2">
                  {/* Main project dates */}
                  {projectKeyDates.filter(date =>
                    ['Project Kickoff', 'Fielding Start', 'Final Report'].includes(date.label)
                  ).map((deadline, index) => (
                    <div key={`main-deadline-${deadline.label}-${index}`} className="flex items-center justify-between">
                      <span className="text-sm">{deadline.label}</span>
                      <span className="text-xs text-gray-500">{deadline.date}</span>
                    </div>
                  ))}

                  {/* Custom key dates */}
                  {projectKeyDates.filter(date =>
                    !['Project Kickoff', 'Fielding Start', 'Final Report'].includes(date.label)
                  ).map((deadline, index) => (
                    <div key={`custom-${index}`} className="flex items-center justify-between group">
                      <span className="text-sm">{deadline.label}</span>
                      <div className="flex items-center gap-2">
                        <span className="text-xs text-gray-500">{deadline.date}</span>
                        <button
                          onClick={() => handleDeleteKeyDate(projectKeyDates.findIndex(d => d.label === deadline.label && d.date === deadline.date))}
                          className="text-xs text-red-600 hover:text-red-800 opacity-0 group-hover:opacity-100 transition-opacity"
                        >
                          ×
                        </button>
                      </div>
                    </div>
                  ))}

                  {projectKeyDates.length === 0 && (
                    <div className="text-xs text-gray-500 py-2 text-center">
                      No key dates yet
                    </div>
                  )}
                </div>
              </Card>
          </div>
        </div>
      </div>

      {/* Archived Notes Section */}
      {archivedNotes.length > 0 && (
        <div className="mt-8">
          <Card>
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-semibold">Archived Notes</h3>
              <button
                onClick={() => setShowArchivedNotes(!showArchivedNotes)}
                className="text-xs text-gray-500 hover:text-gray-700 flex items-center gap-1"
              >
                {showArchivedNotes ? 'Hide' : 'Show'} ({archivedNotes.length})
                <svg className={`h-4 w-4 transition-transform ${showArchivedNotes ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                </svg>
              </button>
            </div>
            
            {showArchivedNotes && (
          <div className="space-y-2 max-h-64 overflow-y-auto">
                {archivedNotes.map((note) => (
                  <div key={note.id} className="flex items-start gap-3 p-3 bg-gray-50 rounded-lg group">
                    <div className="w-6 h-6 rounded-full flex items-center justify-center text-white text-xs font-medium flex-shrink-0" style={{ fontSize: '10px', backgroundColor: getMemberColor(note.createdBy, project.id) }}>
                      {getInitials(project.teamMembers.find(m => m.id === note.createdBy)?.name || note.createdBy)}
                    </div>
                <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <h4 className="text-sm font-medium text-gray-900 truncate">{note.title}</h4>
                        <span className="text-xs text-gray-500 italic">{formatShortDate(note.createdAt)}</span>
                </div>
                      <p className="text-xs text-gray-600 leading-relaxed" dangerouslySetInnerHTML={{ __html: note.body }}></p>
                      {note.comments && note.comments.length > 0 && (
                        <div className="mt-2 text-xs text-gray-500">
                          {note.comments.length} comment{note.comments.length !== 1 ? 's' : ''}
                        </div>
                      )}
                </div>
                    <button
                      onClick={() => handleDeleteArchivedNote(note.id)}
                      className="text-gray-400 hover:text-red-500 transition-colors opacity-0 group-hover:opacity-100"
                    >
                      <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                      </svg>
                    </button>
              </div>
            ))}
              </div>
            )}
        </Card>
      </div>
      )}


      {/* Add Key Date Modal */}
      {showAddKeyDate && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-start justify-center overflow-y-auto py-8 z-[9999] p-4">
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
                  className="px-4 py-2 text-sm bg-orange-500 text-white rounded-lg hover:bg-orange-600"
                >
                  Add Key Date
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Add Note Modal */}
      {showAddNote && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-start justify-center overflow-y-auto py-8 z-[9999] p-4">
          <div className="bg-white rounded-2xl max-w-md w-full p-6">
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
                  className="w-full border rounded-lg px-3 py-2 outline-none focus:ring-2 focus:ring-orange-200"
                />
              </div>
              
              <div className="relative">
                <label className="block text-sm font-medium text-gray-700 mb-1">Note Body</label>
                <div
                  ref={textareaRef}
                  contentEditable
                  onInput={handleTextareaChange}
                  placeholder="Write your note here... Use @ to mention team members"
                  className="w-full border rounded-lg px-3 py-2 outline-none focus:ring-2 focus:ring-orange-200 min-h-[100px]"
                  style={{ whiteSpace: 'pre-wrap' }}
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
                          <div className="w-6 h-6 rounded-full flex items-center justify-center text-white text-xs font-medium" style={{ backgroundColor: getMemberColor(member.id) }}>
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
                  className="px-4 py-2 text-sm bg-orange-500 text-white rounded-lg hover:bg-orange-600"
                >
                  Add Note
                </button>
              </div>
            </div>
          </div>
        </div>
      )}


      {/* Day Details Popup */}
      {selectedDay && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-start justify-center overflow-y-auto py-8 z-[9999] p-4">
          <div className="bg-white rounded-2xl max-w-md w-full p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold">Day {selectedDay.day} Details</h3>
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
                        <div className="w-2 h-2 bg-orange-500 rounded-full"></div>
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
                <div>
                  <h4 className="font-medium text-gray-900 mb-2">Tasks</h4>
                  <ul className="space-y-2">
                    {selectedDay.tasks.map((task) => {
                      const assignedMember = project.teamMembers.find(m => m.id === task.assignedTo);
                      return (
                        <li key={task.id} className="text-sm p-2 bg-gray-50 rounded-lg">
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-2">
                              {task.assignedTo ? (
                                <div className="w-6 h-6 rounded-full flex items-center justify-center text-white text-xs font-medium" 
                                     style={{ backgroundColor: getMemberColor(task.assignedTo, project.id) }}>
                                  {getInitials(assignedMember?.name || 'Unknown')}
                                </div>
                              ) : (
                                <button
                                  onClick={() => {
                                    const updatedTasks = projectTasks.map(t =>
                                      t.id === task.id 
                                        ? { ...t, status: t.status === 'completed' ? 'pending' : 'completed' }
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
                                          ? { ...t, status: t.status === 'completed' ? 'pending' : 'completed' }
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
                              )}
                              <span className="text-gray-900">{task.description}</span>
                            </div>
                            <span className={`px-2 py-1 rounded-full text-xs font-medium ${
                              task.status === 'completed' ? 'bg-green-100 text-green-800' :
                              task.status === 'in-progress' ? 'bg-blue-100 text-blue-800' :
                              'bg-gray-100 text-gray-800'
                            }`}>
                              {task.status.replace('-', ' ')}
                            </span>
                          </div>
                        </li>
                      );
                    })}
                  </ul>
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
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-start justify-center overflow-y-auto py-8 z-[9999]">
          <div className="bg-white rounded-lg p-6 max-w-md w-full mx-4 my-auto max-h-[80vh] overflow-y-auto">
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
                                  <span key={index} className="px-2 py-0.5 bg-green-100 text-green-700 text-xs rounded opacity-60">
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
                                  <span key={index} className="px-2 py-0.5 bg-red-200 text-red-700 text-xs rounded">
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
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-start justify-center overflow-y-auto py-8 z-50">
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
                          <div className="w-5 h-5 rounded-full flex items-center justify-center text-white text-xs font-medium" style={{ fontSize: '10px', backgroundColor: getMemberColor(note.createdBy, project.id) }}>
                            {getInitials(project.teamMembers.find(m => m.id === note.createdBy)?.name || note.createdBy)}
                          </div>
                          {/* Tagged members icons */}
                          {note.taggedMembers && note.taggedMembers.length > 0 && (
                            <div className="flex gap-1">
                              {note.taggedMembers.slice(0, 2).map((memberId, index) => {
                                const member = project.teamMembers.find(m => m.id === memberId);
                                const memberColor = member ? getMemberColor(memberId, project.id) : '#6B7280';
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
                              <div className="w-4 h-4 rounded-full flex items-center justify-center text-white text-xs font-medium flex-shrink-0" style={{ fontSize: '8px', backgroundColor: getMemberColor(comment.author, project.id) }}>
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
                            className="flex-1 text-xs border rounded px-2 py-1 outline-none focus:ring-1 focus:ring-orange-200"
                            onClick={(e) => e.stopPropagation()}
                          />
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              handleModalAddComment(note.id);
                            }}
                            className="px-2 py-1 text-xs bg-orange-500 text-white rounded hover:bg-orange-600"
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
      {selectedNote && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-start justify-center overflow-y-auto py-8 z-50">
          <div className="bg-yellow-100 rounded-lg shadow-xl max-w-2xl w-full mx-4 p-6 border-l-4 border-yellow-300">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <div className="w-6 h-6 rounded-full flex items-center justify-center text-white text-xs font-medium" style={{ backgroundColor: getMemberColor(selectedNote.createdBy, project.id) }}>
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
                    <div className="w-5 h-5 rounded-full flex items-center justify-center text-white text-xs font-medium flex-shrink-0" style={{ fontSize: '10px', backgroundColor: getMemberColor(comment.author, project.id) }}>
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
                  className="flex-1 border rounded-lg px-3 py-2 outline-none focus:ring-2 focus:ring-orange-200"
                />
                <button
                  onClick={() => handleAddComment(selectedNote.id)}
                  className="px-4 py-2 bg-orange-500 text-white rounded-lg hover:bg-orange-600"
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
        </div>
      )}

      {/* Timeline Editor Modal */}
      {showTimelineEditor && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-start justify-center overflow-y-auto py-8 z-50">
          <div className="bg-white rounded-lg shadow-xl max-w-4xl w-full mx-4 my-auto max-h-[80vh] overflow-hidden">
            <div className="flex items-center justify-between p-6 border-b">
              <h2 className="text-xl font-semibold text-gray-900">Edit Project Timeline</h2>
              <button
                onClick={() => setShowTimelineEditor(false)}
                className="text-gray-400 hover:text-gray-600"
              >
                <XMarkIcon className="h-6 w-6" />
              </button>
            </div>
            
            <div className="p-6 overflow-y-auto max-h-[60vh]">
              <div className="space-y-6">
                {/* Phase Segments */}
                <div>
                  <h3 className="text-lg font-semibold text-gray-900 mb-4">Project Phases</h3>
                  <div className="space-y-4">
                    {editingSegments.map((segment, index) => (
                      <div key={index} className="flex items-center gap-4 p-4 border rounded-lg">
                        <div className="flex items-center gap-2">
                          <div
                            className="w-4 h-4 rounded-full"
                            style={{ backgroundColor: PHASE_COLORS[segment.phase] }}
                          />
                          <span className="font-medium text-gray-900">{segment.phase}</span>
                        </div>
                        <div className="flex items-center gap-2">
                          <label className="text-sm text-gray-600">Start:</label>
                          <input
                            type="date"
                            value={segment.startDate}
                            onChange={(e) => handlePhaseDateChange(index, 'startDate', e.target.value)}
                            className="border rounded px-2 py-1 text-sm"
                          />
                        </div>
                        {segment.phase !== 'Kickoff' && (
                          <div className="flex items-center gap-2">
                            <label className="text-sm text-gray-600">End:</label>
                            <input
                              type="date"
                              value={segment.endDate}
                              onChange={(e) => handlePhaseDateChange(index, 'endDate', e.target.value)}
                              className="border rounded px-2 py-1 text-sm"
                            />
                          </div>
                        )}
                        <button
                          onClick={() => {
                            const newSegments = editingSegments.filter((_, i) => i !== index);
                            setEditingSegments(newSegments);
                          }}
                          className="text-red-500 hover:text-red-700 ml-auto"
                        >
                          <TrashIcon className="h-4 w-4" />
                        </button>
                      </div>
                    ))}
                  </div>
                  <button
                    onClick={() => {
                      const newSegment = {
                        phase: 'Kickoff' as Phase,
                        startDate: new Date().toISOString().split('T')[0],
                        endDate: new Date().toISOString().split('T')[0]
                      };
                      setEditingSegments([...editingSegments, newSegment]);
                    }}
                    className="mt-4 text-sm text-orange-600 hover:text-orange-800 flex items-center gap-1"
                  >
                    <PlusSmallIcon className="h-4 w-4" />
                    Add Phase
                  </button>
                </div>

                {/* Key Dates */}
                <div>
                  <h3 className="text-lg font-semibold text-gray-900 mb-4">Key Dates</h3>
                  <div className="space-y-3">
                    {projectKeyDates.map((keyDate, index) => (
                      <div key={index} className="flex items-center gap-4 p-3 border rounded-lg">
                        <input
                          type="text"
                          value={keyDate.label}
                          onChange={(e) => {
                            const newKeyDates = [...projectKeyDates];
                            newKeyDates[index].label = e.target.value;
                            setProjectKeyDates(newKeyDates);
                          }}
                          className="flex-1 border rounded px-2 py-1 text-sm"
                          placeholder="Key date label"
                        />
                        <input
                          type="date"
                          value={keyDate.date}
                          onChange={(e) => {
                            const newKeyDates = [...projectKeyDates];
                            newKeyDates[index].date = e.target.value;
                            setProjectKeyDates(newKeyDates);
                          }}
                          className="border rounded px-2 py-1 text-sm"
                        />
                        <button
                          onClick={() => {
                            const newKeyDates = projectKeyDates.filter((_, i) => i !== index);
                            setProjectKeyDates(newKeyDates);
                          }}
                          className="text-red-500 hover:text-red-700"
                        >
                          <TrashIcon className="h-4 w-4" />
                        </button>
                      </div>
                    ))}
                  </div>
                  <button
                    onClick={() => {
                      const newKeyDate = {
                        label: '',
                        date: new Date().toISOString().split('T')[0]
                      };
                      setProjectKeyDates([...projectKeyDates, newKeyDate]);
                    }}
                    className="mt-3 text-sm text-orange-600 hover:text-orange-800 flex items-center gap-1"
                  >
                    <PlusSmallIcon className="h-4 w-4" />
                    Add Key Date
                  </button>
                </div>
              </div>
            </div>

            <div className="flex justify-end gap-3 p-6 border-t">
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
                        'Authorization': `Bearer ${localStorage.getItem('jaice_token')}`
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
                className="px-4 py-2 text-sm bg-orange-500 text-white rounded hover:bg-orange-600"
              >
                Save Timeline
              </button>
            </div>
          </div>
        </div>
      )}
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

  const currentPhase = getCurrentPhase(project);
  const phaseColor = PHASE_COLORS[currentPhase];
  const [showAddTask, setShowAddTask] = useState(false);
  const [newTask, setNewTask] = useState({ description: "", assignedTo: "", status: "pending" as Task['status'] });
  const [currentMonth, setCurrentMonth] = useState(new Date());
  const [editingTimeline, setEditingTimeline] = useState(false);
  const [editingSegments, setEditingSegments] = useState(project.segments || []);
  const [activePhase, setActivePhase] = useState(project.phase);
  const [projectTasks, setProjectTasks] = useState(project.tasks);
  const [maxVisibleTasks, setMaxVisibleTasks] = useState(8);
  const taskContainerRef = useRef<HTMLDivElement>(null);
  const [showAllTasks, setShowAllTasks] = useState(false);

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

  const updateTaskAssignment = (taskId: string, assignedTo: string) => {
    setProjectTasks(prevTasks =>
      prevTasks.map(task =>
        task.id === taskId
          ? { ...task, assignedTo: assignedTo || undefined }
          : task
      )
    );
  };

  const handleAddTask = () => {
    if (newTask.description.trim()) {
      const task: Task = {
        id: `task-${Date.now()}`,
        description: newTask.description,
        assignedTo: newTask.assignedTo || undefined,
        status: newTask.status,
        phase: activePhase,
        dueDate: null
      };
      setProjectTasks(prevTasks => [...prevTasks, task]);
      setNewTask({ description: "", assignedTo: "", status: "pending" });
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
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-start justify-center overflow-y-auto py-8 z-50 p-4">
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
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-6">
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
                  <span className="px-2 py-1 rounded-full text-xs text-white opacity-60" style={{ background: phaseColor }}>
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
                        <svg className="w-4 h-4 text-purple-600 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                        </svg>
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

                {project.files.length === 0 && (!project.savedContentAnalyses || project.savedContentAnalyses.length === 0) && (
                  <div className="text-sm text-gray-500 italic py-2">No files saved yet</div>
                )}
              </div>
            </Card>
          </div>

          {/* Tasks and Timeline */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <Card>
              {/* Tasks Title */}
              <div className="mb-4">
                <h3 className="text-lg font-semibold text-gray-900 mb-3">Tasks</h3>
              </div>
              
              {/* Phase Tabs */}
              <div className="mb-4">
                <div className="flex flex-wrap items-stretch border-b">
                  {PHASES.map((phase, index) => {
                    const phaseColor = PHASE_COLORS[phase];
                    const isActive = activePhase === phase;
                    return (
                      <button
                        key={phase}
                        className={`flex-1 px-3 py-1 text-xs font-medium transition-colors relative min-h-[32px] flex items-center justify-center ${
                          isActive
                            ? 'text-gray-900 shadow-sm z-10'
                            : 'text-gray-600 hover:text-gray-900 hover:bg-gray-50'
                        }`}
                        onClick={() => setActivePhase(phase as Phase)}
                        style={{
                          backgroundColor: isActive ? phaseColor + '20' : 'transparent', // 20% opacity for light color
                          borderTopLeftRadius: '6px',
                          borderTopRightRadius: '6px',
                          marginRight: '1px',
                          marginLeft: index === 0 ? '0' : '-1px',
                          border: '1px solid #d1d5db',
                          borderBottom: isActive ? 'none' : '1px solid #d1d5db',
                          position: 'relative',
                          zIndex: isActive ? 10 : 1,
                          borderColor: isActive ? phaseColor : '#d1d5db'
                        }}
                      >
                        {phase}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Tasks for Active Phase */}
              <div ref={taskContainerRef} className="space-y-2 max-h-80 overflow-y-auto">
                {projectTasks
                  .filter(task => task.phase === activePhase)
                  .sort((a, b) => {
                    // Sort completed tasks to bottom
                    if (a.status === 'completed' && b.status !== 'completed') return 1;
                    if (a.status !== 'completed' && b.status === 'completed') return -1;
                    return 0;
                  })
                  .map((task) => {
                    const assignedMember = project.teamMembers.find(m => m.id === task.assignedTo);
                    return (
                      <div key={task.id} className="flex items-center gap-2 p-2 border rounded-lg hover:bg-gray-50">
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
                        <div className="flex items-center gap-2">
                          {task.assignedTo ? (
                            <div className="flex items-center gap-1">
                              <div className="w-6 h-6 rounded-full flex items-center justify-center text-white text-xs font-medium" style={{ backgroundColor: getMemberColor(task.assignedTo, project.id) }}>
                                {getInitials(project.teamMembers.find(m => m.id === task.assignedTo)?.name || 'Unknown')}
                              </div>
                              <button
                                onClick={() => updateTaskAssignment(task.id, '')}
                                className="text-xs text-gray-400 hover:text-red-500"
                              >
                                ×
                              </button>
                            </div>
                          ) : (
                            <select
                              onChange={(e) => updateTaskAssignment(task.id, e.target.value)}
                              className="w-20 h-6 rounded border border-gray-300 hover:border-gray-400 hover:text-gray-600 transition-colors appearance-none bg-white text-xs cursor-pointer px-2"
                              defaultValue=""
                            >
                              <option value="" disabled className="text-gray-600">Assign</option>
                              {project.teamMembers.map(member => (
                                <option key={member.id} value={member.id} className="text-gray-900">
                                  {member.name}
                                </option>
                              ))}
                            </select>
                          )}
                        </div>
                      </div>
                    );
                  })}

                {/* Show message if no tasks in this phase */}
                {projectTasks.filter(task => task.phase === activePhase).length === 0 && (
                  <div className="text-xs text-gray-500 py-4 text-center">
                    No tasks in {activePhase} phase
                  </div>
                )}


                {/* Add Task Button */}
                <div className="pt-2">
                  {!showAddTask ? (
                    <button
                      onClick={() => setShowAddTask(true)}
                      className="text-xs text-gray-500 hover:text-gray-700 flex items-center gap-1"
                    >
                      <PlusSmallIcon className="h-3 w-3" />
                      Add task to {activePhase}
                    </button>
                  ) : (
                    <div className="space-y-2 p-2 border rounded-lg bg-gray-50">
                      <input
                        type="text"
                        value={newTask.description}
                        onChange={(e) => setNewTask(prev => ({ ...prev, description: e.target.value }))}
                        placeholder="Task description"
                        className="w-full text-xs border rounded px-2 py-1 outline-none focus:ring-2 focus:ring-orange-200"
                      />
                      <div className="flex gap-2">
                        <select
                          value={newTask.assignedTo}
                          onChange={(e) => setNewTask(prev => ({ ...prev, assignedTo: e.target.value }))}
                          className="text-xs border rounded px-2 py-1 outline-none focus:ring-2 focus:ring-orange-200"
                        >
                          <option value="">Unassigned</option>
                          {project.teamMembers.map(member => (
                            <option key={member.id} value={member.id}>{member.name}</option>
                          ))}
                        </select>
                        <button
                          onClick={handleAddTask}
                          className="px-2 py-1 text-xs bg-orange-500 text-white rounded hover:bg-orange-600"
                        >
                          Add
                        </button>
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
                          <span className="font-medium text-sm">{segment.phase}</span>
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
                              className="w-full text-xs border rounded px-2 py-1"
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
                              className="w-full text-xs border rounded px-2 py-1"
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
                      className="px-4 py-2 bg-orange-500 text-white rounded-lg text-sm hover:bg-orange-600 disabled:bg-gray-300 disabled:cursor-not-allowed"
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
                <div className="space-y-2">
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

                        return (
                          <div
                            key={`${weekIndex}-${dayIndex}`}
                            className={`relative p-2 text-center text-sm rounded-lg cursor-pointer hover:bg-gray-200 h-16 flex flex-col justify-between ${
                              isTodayDate ? 'bg-gray-100' : isCurrentMonth ? 'bg-gray-100' : 'bg-white'
                            } ${isPastDate ? 'opacity-50' : ''}`}
                            style={{
                              backgroundColor: isCurrentWeekDay ? '#FED7AA40' : isTodayDate ? '#F3F4F6' : isCurrentMonth ? '#F3F4F6' : '#FFFFFF',
                              border: isTodayDate ? '2px solid #F97316' : !isCurrentMonth && !isCurrentWeekDay ? '1px solid #E5E7EB' : 'none'
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


          {/* Archive Button */}
          <div className="mt-6 pt-6 border-t border-gray-200">
            <button
              onClick={() => {
                onArchive(project.id);
                onClose();
              }}
              className="px-4 py-2 text-sm border border-orange-200 text-orange-600 rounded-xl hover:bg-orange-50 transition-colors"
            >
              Archive Project
            </button>
          </div>
      </div>
      </div>

    </div>
  );
}
