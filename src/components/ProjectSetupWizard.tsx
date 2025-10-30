import { API_BASE_URL } from '../config';
import React, { useState, useEffect } from 'react';
import { XMarkIcon, ChevronLeftIcon, ChevronRightIcon, PlusIcon, TrashIcon, InformationCircleIcon, CalendarDaysIcon } from '@heroicons/react/24/outline';
import { useAuth } from '../contexts/AuthContext';
import UserSearch from './UserSearch';
import { createPortal } from 'react-dom';
import { checkModeratorAvailability, formatConflicts } from '../services/moderatorAvailability';
import type { TeamMemberWithRoles } from '../types/roles';
import { autoAssignByRoles } from '../lib/autoAssignByRoles';
import { calculateTaskDueDate, type ProjectTimeline } from '../lib/dateCalculator';
import jaiceRoles from '../data/jaice_roles.json';
import jaiceTasks from '../data/jaice_tasks.json';

// Import Task type from App.tsx
type Task = {
  id: string;
  description?: string;
  assignedTo?: string[];
  status: 'pending' | 'in-progress' | 'completed';
  dueDate?: string;
  phase?: string;
  isOngoing?: boolean;
  phaseStartDate?: string;
  notes?: string;
  dateNotes?: string;
  role?: string;
};

const BRAND = { orange: "#D14A2D", red: "#B83D1A" };

// Helper function for getting member color (consistent across all contexts)
const getMemberColor = (memberId: string) => {
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

type User = {
  id: string;
  name: string;
  email: string;
  role: 'admin' | 'user';
};

// Task list data from Cognitive_Dash_TaskList_ByPhase.json
const TASK_LIST_BY_PHASE = {
  "Quantitative": {
    "Kickoff": [
      "Create Kick Off (KO) deck",
      "Create detailed timeline",
      "Hold Internal Pre-Kick Off: Talk through study overview, roles, deadlines, and any other key project info prior to KO with client.",
      "Create or review Proposal based on RFP (Request For Proposal)",
      "Bid project out to vendors",
      "Create a job folder for the study in the 'Proposals' folder (within appropriate client folder)",
      "Save vendors' bids to job folder",
      "Ensure any new vendors you are bringing on board have signed the NDA",
      "Create Internal Cost Worksheet, send to supervisor",
      "Move study docs from 'Proposals' folder to main client folder",
      "Set up Invoice Schedule & Worksheet (Reference PO/SOW for client specific invoice timeline)",
      "Alert sample/programming vendor that the project is moving forward",
      "After client KO call, confirm final sample quotas with vendor"
    ],
    "Pre-Field": [
      "Draft QNR",
      "Proof QNR",
      "Send QNR to client",
      "Add AE submission forms & contact info to job folder",
      "Update folder name with job #",
      "Submit first client invoice request to accounting",
      "Make necessary revisions to QNR from client review",
      "Send final QNR to vendor (after client sign off)",
      "If advanced analytics needed: create specs & engage statistician",
      "Ensure signed/final documents are saved to job folder",
      "Test survey program",
      "If translations: review translations in survey program",
      "Send translations to client-approved translators",
      "If requested: send tested survey link to client",
      "Coordinate translation comments",
      "Create data quality check plan",
      "Create AE check plan",
      "Approve survey for soft launch"
    ],
    "Fielding": [
      "Soft data quality check (10% of total sample), continue quality checks throughout",
      "Create report shell based on questionnaire, proposal, feedback from client",
      "Share fielding updates with client - minimum of twice a week",
      "Copy cost tracker shell to job folder and update",
      "Create tab banner plan",
      "Have tab banner plan reviewed",
      "Send tab banner plan to vendor",
      "If coding: share questions and required codes with vendor",
      "Monitor open end comments for AEs and submit within 24 hours",
      "Request invoice if required by client schedule",
      "Monitor completes and update quotas as needed",
      "Ensure timely completion of field, troubleshoot as needed",
      "Request prelim tables (if needed)",
      "Check prelim tables (if needed)"
    ],
    "Post-Field Analysis": [
      "Clean project folder, delete old drafts, save finals",
      "Save vendor invoices, compare to bids, send to accounting",
      "Download & proof banner tables",
      "Submit AE Reconciliation",
      "Internal download: lessons learned and notes",
      "Download and review verbatim file",
      "Write findings & exec summary, team review",
      "Send SPSS file to statistician if applicable"
    ],
    "Reporting": [
      "Post data into report shell",
      "Write findings & exec summary",
      "Have data proofed",
      "Have exec summary and headlines proofed",
      "Have full final report proofed",
      "Send report to client",
      "Update report based on client comments",
      "Approve final vendor invoices",
      "Fill out Cost Tracker with final invoices from vendors"
    ]
  },
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

interface ProjectSetupWizardProps {
  isOpen: boolean;
  onClose: () => void;
  onProjectCreated: (project: any) => void;
  projects?: any[];
  archivedProjects?: any[];
}

const METHODOLOGIES = {
  "Quantitative": [
    "ATU (Awareness, Trial, Usage)",
    "Conjoint Analysis",
    "Message Testing",
    "Brand Tracking",
    "Customer Satisfaction",
    "Market Segmentation",
    "Pricing Research",
    "Concept Testing",
    "Online Surveys",
    "Mobile Surveys",
    "Other Quantitative"
  ],
  "Qualitative": [
    "Focus Groups",
    "In-Depth Interviews",
    "Ethnographic Research",
    "Usability Testing",
    "Other Qualitative"
  ]
};

const PHASES = [
  "Kickoff",
  "Pre-Field",
  "Fielding",
  "Post-Field Analysis",
  "Reporting"
];

// Phase colors for visual differentiation
const PHASE_COLORS: Record<string, string> = {
  "Kickoff": "#6B7280", // Grey
  "Pre-Field": "#059669", // Green
  "Fielding": "#7C3AED", // Purple
  "Post-Field Analysis": "#DC2626", // Red
  "Reporting": "#1D4ED8" // Blue
};

interface CalendarTimelineProps {
  phaseTimeline: Record<string, {start: string, end: string}>;
  currentPhase: string;
  isSelectingStart: boolean;
  onDateSelect: (date: string) => void;
}

const CalendarTimeline: React.FC<CalendarTimelineProps> = ({
  phaseTimeline,
  currentPhase,
  isSelectingStart,
  onDateSelect
}) => {
  const today = new Date();
  const [currentMonth, setCurrentMonth] = useState(today.getMonth());
  const [currentYear, setCurrentYear] = useState(today.getFullYear());
  const [forceUpdate, setForceUpdate] = useState(0);

  // Force re-render when phaseTimeline changes
  useEffect(() => {
    setForceUpdate(prev => prev + 1);
  }, [phaseTimeline]);

  const monthNames = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'
  ];

  const workDayNames = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'];

  // Get work week days for current month (Monday to Friday only)
  const getWorkWeekDays = (date: Date) => {
    const year = date.getFullYear();
    const month = date.getMonth();
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const workDays = [];

    for (let day = 1; day <= daysInMonth; day++) {
      const currentDate = new Date(year, month, day);
      const dayOfWeek = currentDate.getDay();
      // Only include Monday (1) to Friday (5)
      if (dayOfWeek >= 1 && dayOfWeek <= 5) {
        workDays.push(day);
      }
    }
    return workDays;
  };

  // Group work days into weeks
  const getWeekGroups = (workDays: number[]) => {
    const weeks = [];
    for (let i = 0; i < workDays.length; i += 5) {
      weeks.push(workDays.slice(i, i + 5));
    }
    return weeks;
  };

  const isToday = (day: number) => {
    return false; // Disabled today highlighting
  };

  const getPhaseForDay = (day: number) => {
    // Create date string without timezone conversion
    const dateStr = `${currentYear}-${String(currentMonth + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    
    for (const [phase, timeline] of Object.entries(phaseTimeline)) {
      if (timeline.start) {
        // Show pill if date is within the phase range (start to end, or just start if no end yet)
        const endDate = timeline.end || timeline.start;
        if (dateStr >= timeline.start && dateStr <= endDate) {
          return { phase, color: PHASE_COLORS[phase] };
        }
      }
    }
    return null;
  };

  const handleDayClick = (day: number) => {
    // Create date string without timezone conversion
    const dateStr = `${currentYear}-${String(currentMonth + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    onDateSelect(dateStr);
  };

  const workDays = getWorkWeekDays(new Date(currentYear, currentMonth));
  const weekGroups = getWeekGroups(workDays);

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

  return (
    <div className="space-y-3">
      {/* Month/Year header with navigation */}
      <div className="flex items-center justify-between">
        <button
          onClick={() => navigateMonth('prev')}
          className="p-2 hover:bg-gray-100 rounded-lg"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
        </button>
        <h3 className="text-base font-semibold text-gray-900">
          {monthNames[currentMonth]} {currentYear}
        </h3>
        <button
          onClick={() => navigateMonth('next')}
          className="p-2 hover:bg-gray-100 rounded-lg"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
          </svg>
        </button>
      </div>

      {/* Work day names header */}
      <div className="grid grid-cols-5 gap-1 mb-2">
        {workDayNames.map(day => (
          <div key={day} className="h-8 flex items-center justify-center text-xs font-medium text-gray-500">
            {day}
          </div>
        ))}
      </div>

      {/* Work week calendar grid */}
      <div className="space-y-1">
        {weekGroups.map((week, weekIndex) => (
          <div key={weekIndex} className="grid grid-cols-5 gap-1">
            {week.map((day, dayIndex) => {
              const phaseForDay = getPhaseForDay(day);
              const isTodayDate = isToday(day);
              
              return (
                <div
                  key={dayIndex}
                  className={`relative p-1 text-center text-xs rounded cursor-pointer hover:bg-gray-200 h-12 flex flex-col justify-between ${
                    isTodayDate ? 'bg-orange-100 border-2 border-orange-400' : 'bg-gray-100'
                  }`}
                  onClick={() => handleDayClick(day)}
                  title={phaseForDay ? `${phaseForDay.phase} phase` : 'No project activity'}
                >
                  {/* Date number at top */}
                  <div className={`font-medium text-xs pt-1 ${
                    isTodayDate ? 'text-orange-700' : 'text-gray-700'
                  }`}>
                    {day}
                  </div>
                  
                  {/* Phase pill at bottom */}
                  {phaseForDay && (
                    <div 
                      className="absolute bottom-1 left-1 right-1 h-2 rounded-full"
                      style={{ background: phaseForDay.color }}
                    />
                  )}
                </div>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
};

const ProjectSetupWizard: React.FC<ProjectSetupWizardProps> = ({ isOpen, onClose, onProjectCreated, projects = [], archivedProjects = [] }) => {
  const { user } = useAuth();
  const [currentStep, setCurrentStep] = useState(1);
  
  // Client-related state
  const [existingClients, setExistingClients] = useState<string[]>([]);
  const [showAddClient, setShowAddClient] = useState(false);
  const [newClientName, setNewClientName] = useState('');

  // Function to format dates for key deadlines (same as in App.tsx)
  const formatDateForKeyDeadline = (dateString: string | undefined): string => {
    if (!dateString) return 'Invalid Date';

    try {
      // Parse the date string using UTC to avoid timezone issues
      const [year, month, day] = dateString.split('-');
      const date = new Date(Date.UTC(parseInt(year), parseInt(month) - 1, parseInt(day)));

      // Check if the date is valid
      if (isNaN(date.getTime())) {
        return 'Invalid Date';
      }

      // Format as MM/DD/YY using UTC methods to avoid timezone conversion
      const formattedMonth = String(date.getUTCMonth() + 1).padStart(2, '0');
      const formattedDay = String(date.getUTCDate()).padStart(2, '0');
      const formattedYear = String(date.getUTCFullYear()).slice(-2);
      
      return `${formattedMonth}/${formattedDay}/${formattedYear}`;
    } catch (error) {
      console.warn('Error formatting date for key deadline:', dateString, error);
      return 'Invalid Date';
    }
  };
  const [phaseTimeline, setPhaseTimeline] = useState<Record<string, {start: string, end: string}>>({});
  const [currentPhaseIndex, setCurrentPhaseIndex] = useState(0);
  const [isSelectingStart, setIsSelectingStart] = useState(true);
  
  // New simplified timeline state
  const [timelineDates, setTimelineDates] = useState({
    kickoffDate: '',
    fieldworkStartDate: '',
    fieldworkEndDate: '',
    reportDeadlineDate: ''
  });

  // Helper function to ensure a date is a weekday (Monday-Friday)
  const ensureWeekday = (date: Date): Date => {
    const dayOfWeek = date.getDay();
    if (dayOfWeek === 0) { // Sunday - move to Monday
      date.setDate(date.getDate() + 1);
    } else if (dayOfWeek === 6) { // Saturday - move to Monday
      date.setDate(date.getDate() + 2);
    }
    return date;
  };

  // Function to calculate phase timeline based on the 4 key dates
  const calculatePhaseTimeline = (dates: typeof timelineDates): Record<string, {start: string, end: string}> => {
    const { kickoffDate, fieldworkStartDate, fieldworkEndDate, reportDeadlineDate } = dates;

    if (!kickoffDate || !fieldworkStartDate || !fieldworkEndDate || !reportDeadlineDate) {
      return {};
    }

    // Parse dates using UTC to avoid timezone issues (like home page pills fix)
    const parseDate = (dateString: string) => {
      const [year, month, day] = dateString.split('-').map(Number);
      return new Date(Date.UTC(year, month - 1, day));
    };

    // Helper to ensure a date is a weekday (Monday-Friday) using UTC
    const ensureWeekdayUTC = (date: Date): Date => {
      const dayOfWeek = date.getUTCDay();
      if (dayOfWeek === 0) { // Sunday - move to Monday
        date.setUTCDate(date.getUTCDate() + 1);
      } else if (dayOfWeek === 6) { // Saturday - move to Monday
        date.setUTCDate(date.getUTCDate() + 2);
      }
      return date;
    };

    // Helper to go back to previous weekday
    const previousWeekdayUTC = (date: Date): Date => {
      const dayOfWeek = date.getUTCDay();
      if (dayOfWeek === 0) { // Sunday - move to Friday
        date.setUTCDate(date.getUTCDate() - 2);
      } else if (dayOfWeek === 6) { // Saturday - move to Friday
        date.setUTCDate(date.getUTCDate() - 1);
      }
      return date;
    };

    const koDate = parseDate(kickoffDate);
    const fieldStartDate = parseDate(fieldworkStartDate);
    const fieldEndDate = parseDate(fieldworkEndDate);
    const reportDate = parseDate(reportDeadlineDate);

    // Calculate reporting week (full week leading up to report deadline)
    const reportDayOfWeek = reportDate.getUTCDay(); // 0 = Sunday, 1 = Monday, etc.
    const daysToSubtract = reportDayOfWeek === 0 ? 6 : reportDayOfWeek - 1; // Monday = 0, Sunday = 6
    let reportingStartDate = new Date(Date.UTC(
      reportDate.getUTCFullYear(),
      reportDate.getUTCMonth(),
      reportDate.getUTCDate() - daysToSubtract
    ));
    // Ensure reporting start is a weekday
    reportingStartDate = ensureWeekdayUTC(reportingStartDate);

    // Calculate pre-field phase (day after KO to day before fieldwork start)
    let preFieldStartDate = new Date(Date.UTC(
      koDate.getUTCFullYear(),
      koDate.getUTCMonth(),
      koDate.getUTCDate() + 1
    ));
    preFieldStartDate = ensureWeekdayUTC(preFieldStartDate);

    let preFieldEndDate = new Date(Date.UTC(
      fieldStartDate.getUTCFullYear(),
      fieldStartDate.getUTCMonth(),
      fieldStartDate.getUTCDate() - 1
    ));
    preFieldEndDate = previousWeekdayUTC(preFieldEndDate);

    // Calculate post-field phase (day after fieldwork end to day before reporting start)
    let postFieldStartDate = new Date(Date.UTC(
      fieldEndDate.getUTCFullYear(),
      fieldEndDate.getUTCMonth(),
      fieldEndDate.getUTCDate() + 1
    ));
    postFieldStartDate = ensureWeekdayUTC(postFieldStartDate);

    let postFieldEndDate = new Date(Date.UTC(
      reportingStartDate.getUTCFullYear(),
      reportingStartDate.getUTCMonth(),
      reportingStartDate.getUTCDate() - 1
    ));
    postFieldEndDate = previousWeekdayUTC(postFieldEndDate);

    // Format dates as YYYY-MM-DD using UTC methods
    const formatDate = (date: Date) => {
      const year = date.getUTCFullYear();
      const month = String(date.getUTCMonth() + 1).padStart(2, '0');
      const day = String(date.getUTCDate()).padStart(2, '0');
      return `${year}-${month}-${day}`;
    };

    return {
      'Kickoff': {
        start: formatDate(koDate),
        end: formatDate(koDate) // Kickoff is just one day
      },
      'Pre-Field': {
        start: formatDate(preFieldStartDate),
        end: formatDate(preFieldEndDate)
      },
      'Fielding': {
        start: formatDate(fieldStartDate),
        end: formatDate(fieldEndDate)
      },
      'Post-Field Analysis': {
        start: formatDate(postFieldStartDate),
        end: formatDate(postFieldEndDate)
      },
      'Reporting': {
        start: formatDate(reportingStartDate),
        end: formatDate(reportDate)
      }
    };
  };
  const [teamMembers, setTeamMembers] = useState<TeamMemberWithRoles[]>([]);
  const [showAddTeamMember, setShowAddTeamMember] = useState(false);
  const [showAllTeamMembers, setShowAllTeamMembers] = useState(false);
  const [saveTimeout, setSaveTimeout] = useState<NodeJS.Timeout | null>(null);
  const [showRoleInfoModal, setShowRoleInfoModal] = useState(false);

  // Cleanup timeout on unmount
  useEffect(() => {
    return () => {
      if (saveTimeout) {
        clearTimeout(saveTimeout);
      }
    };
  }, [saveTimeout]);
  
  const initialFormData = {
    // Step 1: Basic Info
    name: '',
    client: '',
    methodologyType: '', // Quantitative or Qualitative
    methodology: '',
    startDate: '',
    endDate: '',

    // Step 2: Details
    background: '',
    objectives: '',
    kickoffDeck: null as File | null,

    // Step 4: Sample Details & Team & Resources
    sampleSize: 0,
    subgroups: [] as Array<{id: string, name: string, size: number}>,
    moderator: '',
    sampleProvider: '',
    requireAdvancedAnalytics: false,
    analyticsPartner: '',

    // Step 5: Configuration
    usePreloadedTasks: true,
    customTasks: [] as string[]
  };
  
  const [formData, setFormData] = useState(initialFormData);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  // Moderator-related state
  const [moderators, setModerators] = useState<any[]>([]);
  const [showAddModerator, setShowAddModerator] = useState(false);
  const [newModerator, setNewModerator] = useState({
    name: '',
    email: '',
    phone: '',
    company: '',
    specialties: [] as string[],
    notes: ''
  });
  const [loadingModerators, setLoadingModerators] = useState(false);

  // Sample Provider and Analytics state
  const [sampleProviders, setSampleProviders] = useState<any[]>([]);
  const [analyticsPartners, setAnalyticsPartners] = useState<any[]>([]);
  const [showAddSampleProvider, setShowAddSampleProvider] = useState(false);
  const [showAddAnalyticsPartner, setShowAddAnalyticsPartner] = useState(false);
  const [newSampleProvider, setNewSampleProvider] = useState({
    name: '',
    company: '',
    specialties: [] as string[],
    notes: ''
  });
  const [newAnalyticsPartner, setNewAnalyticsPartner] = useState({
    name: '',
    company: '',
    specialties: [] as string[],
    notes: ''
  });

  const resetWizard = () => {
    setFormData(initialFormData);
    setPhaseTimeline({});
    setCurrentPhaseIndex(0);
    setIsSelectingStart(true);
    setTimelineDates({
      kickoffDate: '',
      fieldworkStartDate: '',
      fieldworkEndDate: '',
      reportDeadlineDate: ''
    });
    setCurrentStep(1);
    setError('');
    // Reset team members but keep current user
    if (user) {
      setTeamMembers([{
        id: user.id,
        name: user.name || 'Current User',
        role: '',
        roles: []
      }]);
    } else {
      setTeamMembers([]);
    }
    setShowAddTeamMember(false);
    setShowAllTeamMembers(false);
    setShowAddModerator(false);
    setNewModerator({
      name: '',
      email: '',
      phone: '',
      company: '',
      specialties: [],
      notes: ''
    });
    setShowAddClient(false);
    setNewClientName('');
    localStorage.removeItem('cognitive_dash_project_draft');
  };

  // Reset wizard when opening
  useEffect(() => {
    if (isOpen) {
      resetWizard();
    }
  }, [isOpen]);

  // Auto-save function
  const autoSave = () => {
    if (saveTimeout) {
      clearTimeout(saveTimeout);
    }
    
    const timeout = setTimeout(() => {
      // Save current form data and team members to localStorage
      const projectData = {
        ...formData,
        teamMembers: teamMembers,
        phaseTimeline: phaseTimeline,
        currentPhaseIndex: currentPhaseIndex
      };
      
      localStorage.setItem('cognitive_dash_project_draft', JSON.stringify(projectData));
      }, 1000); // Save after 1 second of inactivity
    
    setSaveTimeout(timeout);
  };

  // Team member handling functions
  const handleAddTeamMember = (user: User) => {
    const newTeamMember: TeamMemberWithRoles = {
      id: user.id,
      name: user.name,
      role: '', // Keep for backward compatibility
      roles: [] // New: multiple role assignment
    };
    
    // Check if user is already a team member
    const isAlreadyMember = teamMembers.some(member => member.id === user.id);
    if (!isAlreadyMember) {
      setTeamMembers(prev => [...prev, newTeamMember]);
      setShowAddTeamMember(false);
      autoSave(); // Trigger auto-save
    }
  };

  const handleRemoveTeamMember = (memberId: string) => {
    // Prevent removing the current user
    if (memberId === user?.id) {
      return;
    }
    setTeamMembers(prev => prev.filter(member => member.id !== memberId));
    autoSave(); // Trigger auto-save
  };

  const handleCancel = () => {
    resetWizard();
    onClose();
  };

  const handleInputChange = (field: string, value: any) => {
    setFormData(prev => ({
      ...prev,
      [field]: value
    }));
    autoSave(); // Trigger auto-save
  };

  const handleTimelineDateChange = (field: keyof typeof timelineDates, value: string) => {
    const newTimelineDates = {
      ...timelineDates,
      [field]: value
    };
    
    // Clear subsequent dates when an earlier date is changed
    if (field === 'kickoffDate') {
      newTimelineDates.fieldworkStartDate = '';
      newTimelineDates.fieldworkEndDate = '';
      newTimelineDates.reportDeadlineDate = '';
    } else if (field === 'fieldworkStartDate') {
      newTimelineDates.fieldworkEndDate = '';
      newTimelineDates.reportDeadlineDate = '';
    } else if (field === 'fieldworkEndDate') {
      newTimelineDates.reportDeadlineDate = '';
    }
    
    setTimelineDates(newTimelineDates);
    // Do not render or update calculated timeline during wizard step 3
    // Final timeline is calculated on submit only
    setPhaseTimeline({});

    autoSave(); // Trigger auto-save
  };

  const handleNext = () => {
    // Validate dates when leaving step 2
    if (currentStep === 2) {
      // Check if all 4 key dates are provided
      const { kickoffDate, fieldworkStartDate, fieldworkEndDate, reportDeadlineDate } = timelineDates;
      
      if (!kickoffDate || !fieldworkStartDate || !fieldworkEndDate || !reportDeadlineDate) {
        setError('Please provide all required dates: Kickoff, Fieldwork Start, Fieldwork End, and Report Deadline');
        return;
      }

      // Validate date order using UTC to avoid timezone issues
      const parseDateForValidation = (dateString: string) => {
        const [year, month, day] = dateString.split('-').map(Number);
        return new Date(Date.UTC(year, month - 1, day));
      };
      
      const koDate = parseDateForValidation(kickoffDate);
      const fieldStartDate = parseDateForValidation(fieldworkStartDate);
      const fieldEndDate = parseDateForValidation(fieldworkEndDate);
      const reportDate = parseDateForValidation(reportDeadlineDate);

      if (fieldStartDate <= koDate) {
        setError('Fieldwork start date must be after kickoff date');
        return;
      }

      if (fieldEndDate <= fieldStartDate) {
        setError('Fieldwork end date must be after fieldwork start date');
        return;
      }

      if (reportDate <= fieldEndDate) {
        setError('Report deadline must be after fieldwork end date');
        return;
      }

      // If validation passes, clear any errors
      setError('');
    }
    
    // Validate sample details step (step 4)
    if (currentStep === 3) {
      if (formData.sampleSize && formData.sampleSize > 0 && formData.subgroups && formData.subgroups.length > 0) {
        if (!validateSubgroups(formData.subgroups, formData.sampleSize)) {
          const subgroupTotal = formData.subgroups.reduce((sum, sg) => sum + (sg.size || 0), 0);
          setError(`Subgroup total (${subgroupTotal}) must equal sample size (${formData.sampleSize})`);
          return;
        }
      }
      // If validation passes, clear any errors
      setError('');
    }
    
    if (currentStep < 4) {
      setCurrentStep(currentStep + 1);
      // Scroll to top of content area
      setTimeout(() => {
        const contentArea = document.querySelector('.wizard-content');
        if (contentArea) {
          contentArea.scrollTop = 0;
        }
      }, 100);
    }
  };

  const handlePrevious = () => {
    if (currentStep > 1) {
      setError(''); // Clear any errors when going back
      setCurrentStep(currentStep - 1);
      // Scroll to top of content area
      setTimeout(() => {
        const contentArea = document.querySelector('.wizard-content');
        if (contentArea) {
          contentArea.scrollTop = 0;
        }
      }, 100);
    }
  };

  const handleDateSelect = (date: string) => {
    const currentPhase = PHASES[currentPhaseIndex];
    const newTimeline = { ...phaseTimeline };

    if (!newTimeline[currentPhase]) {
      newTimeline[currentPhase] = { start: '', end: '' };
    }

    if (currentPhase === "Kickoff") {
      // For Kickoff phase, handle both start and end dates
      if (isSelectingStart) {
        newTimeline[currentPhase].start = date;
        setIsSelectingStart(false);
      } else {
        // Validate end date is after start date
        if (newTimeline[currentPhase].start && date <= newTimeline[currentPhase].start) {
          alert('End date must be after start date');
          return;
        }
        
        newTimeline[currentPhase].end = date;
        
        // Auto-advance to next phase and set its start date
        if (currentPhaseIndex < PHASES.length - 1) {
          const nextPhase = PHASES[currentPhaseIndex + 1];
          const endDate = new Date(date + 'T00:00:00');
          const nextStartDate = new Date(endDate);
          nextStartDate.setDate(endDate.getDate() + 1);
          
          // Skip weekends for next start date - keep going until we hit a weekday
          while (nextStartDate.getDay() === 0 || nextStartDate.getDay() === 6) {
            nextStartDate.setDate(nextStartDate.getDate() + 1);
          }
          
          // Format date string without timezone conversion
          const nextStartDateStr = `${nextStartDate.getFullYear()}-${String(nextStartDate.getMonth() + 1).padStart(2, '0')}-${String(nextStartDate.getDate()).padStart(2, '0')}`;
          
          if (!newTimeline[nextPhase]) {
            newTimeline[nextPhase] = { start: '', end: '' };
          }
          newTimeline[nextPhase].start = nextStartDateStr;
          
          setCurrentPhaseIndex(currentPhaseIndex + 1);
          setIsSelectingStart(false); // Next phase starts with end date selection
        }
      }
    } else {
      // For all other phases, only handle end dates
      // Validate end date is after start date
      if (newTimeline[currentPhase].start && date <= newTimeline[currentPhase].start) {
        alert('End date must be after start date');
        return;
      }
      
      // Validate no overlap with previous phases
      for (let i = 0; i < currentPhaseIndex; i++) {
        const prevPhase = PHASES[i];
        const prevTimeline = newTimeline[prevPhase];
        if (prevTimeline?.start && prevTimeline?.end) {
          if (date >= prevTimeline.start && date <= prevTimeline.end) {
            alert(`End date cannot overlap with ${prevPhase} phase`);
            return;
          }
        }
      }
      
      newTimeline[currentPhase].end = date;
      
      // Auto-advance to next phase and set its start date
      if (currentPhaseIndex < PHASES.length - 1) {
        const nextPhase = PHASES[currentPhaseIndex + 1];
        const endDate = new Date(date + 'T00:00:00');
        const nextStartDate = new Date(endDate);
        nextStartDate.setDate(endDate.getDate() + 1);
        
        // Skip weekends for next start date - keep going until we hit a weekday
        while (nextStartDate.getDay() === 0 || nextStartDate.getDay() === 6) {
          nextStartDate.setDate(nextStartDate.getDate() + 1);
        }
        
        // Format date string without timezone conversion
        const nextStartDateStr = `${nextStartDate.getFullYear()}-${String(nextStartDate.getMonth() + 1).padStart(2, '0')}-${String(nextStartDate.getDate()).padStart(2, '0')}`;
        
        if (!newTimeline[nextPhase]) {
          newTimeline[nextPhase] = { start: '', end: '' };
        }
        newTimeline[nextPhase].start = nextStartDateStr;
        
        setCurrentPhaseIndex(currentPhaseIndex + 1);
        setIsSelectingStart(false); // Next phase starts with end date selection
      }
    }

    setPhaseTimeline(newTimeline);
    autoSave(); // Trigger auto-save
  };

  // Load moderators from localStorage
  const loadModerators = async () => {
    setLoadingModerators(true);
    try {
      const storedVendors = localStorage.getItem('cognitive_dash_vendors');
      if (storedVendors) {
        const data = JSON.parse(storedVendors);
        setModerators(data.moderators || []);
        setSampleProviders(data.sampleVendors || []);
        setAnalyticsPartners(data.analytics || []);
      } else {
        setModerators([]);
        setSampleProviders([]);
        setAnalyticsPartners([]);
      }
    } catch (error) {
      console.error('Error loading vendors:', error);
      setModerators([]);
      setSampleProviders([]);
      setAnalyticsPartners([]);
    } finally {
      setLoadingModerators(false);
    }
  };

  // Add new moderator (localStorage solution)
  const handleAddModerator = async () => {
    if (!newModerator.name || !newModerator.email) {
      setError('Name and email are required for moderator');
      return;
    }

    try {
      // Get current vendors from localStorage
      const storedVendors = localStorage.getItem('cognitive_dash_vendors');
      const currentVendors = storedVendors ? JSON.parse(storedVendors) : {
        moderators: [],
        sampleVendors: [],
        analytics: []
      };

      // Check if moderator already exists
      const existingModerator = currentVendors.moderators.find((m: any) => m.email === newModerator.email);
      if (existingModerator) {
        setError('Moderator with this email already exists');
        return;
      }

      // Create new moderator
      const newModeratorData = {
        id: Date.now().toString(),
        ...newModerator,
        pastProjects: [],
        createdAt: new Date().toISOString()
      };

      // Add to moderators
      currentVendors.moderators.push(newModeratorData);

      // Save back to localStorage
      localStorage.setItem('cognitive_dash_vendors', JSON.stringify(currentVendors));

      // Update local state
      setModerators(prev => [...prev, newModeratorData]);
      setFormData(prev => ({ ...prev, moderator: newModeratorData.id }));
      setNewModerator({
        name: '',
        email: '',
        phone: '',
        company: '',
        specialties: [],
        notes: ''
      });
      setShowAddModerator(false);
      setError('');
    } catch (error) {
      console.error('Error adding moderator:', error);
      setError('Failed to add moderator');
    }
  };

  // Extract unique clients from both active and archived projects
  const extractClientsFromProjects = () => {
    const clients = new Set<string>();
    
    // Add clients from active projects
    projects.forEach(project => {
      if (project.client && project.client.trim()) {
        clients.add(project.client.trim());
      }
    });
    
    // Add clients from archived projects
    archivedProjects.forEach(project => {
      if (project.client && project.client.trim()) {
        clients.add(project.client.trim());
      }
    });
    
    return Array.from(clients).sort();
  };

  // Handle adding new client
  const handleAddNewClient = () => {
    if (newClientName.trim()) {
      const trimmedName = newClientName.trim();
      if (!existingClients.includes(trimmedName)) {
        setExistingClients(prev => [...prev, trimmedName].sort());
        setFormData(prev => ({ ...prev, client: trimmedName }));
      }
      setNewClientName('');
      setShowAddClient(false);
    }
  };

  // Get current timeline guidance message
  const getTimelineGuidance = () => {
    const currentPhase = PHASES[currentPhaseIndex];
    const currentPhaseTimeline = phaseTimeline[currentPhase];
    
    if (!currentPhase) return "Please select the Kickoff start date";
    
    if (currentPhase === "Kickoff") {
      if (isSelectingStart) {
        return "Please select the Kickoff start date";
      } else {
        return "Please select the Kickoff end date";
      }
    } else {
      // For all other phases, we only need end dates
      return `Please select the ${currentPhase} end date`;
    }
  };

  // Validate that subgroups add up to total sample size
  const validateSubgroups = (subgroups: Array<{id: string, name: string, size: number}>, totalSize: number) => {
    const subgroupTotal = subgroups.reduce((sum, subgroup) => sum + (subgroup.size || 0), 0);
    return subgroupTotal === totalSize;
  };

  // Format sample details for display
  const formatSampleDetails = (sampleSize: number, subgroups: Array<{id: string, name: string, size: number}>) => {
    if (!sampleSize || sampleSize === 0) return '';
    
    let display = `Total: n=${sampleSize}`;
    
    if (subgroups && subgroups.length > 0) {
      const validSubgroups = subgroups.filter(sg => sg.name.trim() && sg.size > 0);
      if (validSubgroups.length > 0) {
        const subgroupText = validSubgroups.map(sg => `${sg.name}: n=${sg.size}`).join(', ');
        display += ` (${subgroupText})`;
      }
    }
    
    return display;
  };

  // Add new sample provider
  const handleAddSampleProvider = async () => {
    if (!newSampleProvider.company) {
      setError('Company name is required for sample provider');
      return;
    }

    try {
      // Get current vendors from localStorage
      const storedVendors = localStorage.getItem('cognitive_dash_vendors');
      const currentVendors = storedVendors ? JSON.parse(storedVendors) : {
        moderators: [],
        sampleVendors: [],
        analytics: []
      };

      // Generate provider name from company name
      const providerName = newSampleProvider.company;

      // Check if sample provider already exists
      const existingProvider = currentVendors.sampleVendors.find((p: any) => p.name === providerName);
      if (existingProvider) {
        setError('Sample provider with this company name already exists');
        return;
      }

      // Create new sample provider
      const newProviderData = {
        id: `sp-${Date.now()}`,
        name: providerName,
        company: newSampleProvider.company,
        specialties: [],
        notes: '',
        pastProjects: [],
        createdAt: new Date().toISOString()
      };

      // Add to sample providers
      currentVendors.sampleVendors.push(newProviderData);

      // Save back to localStorage
      localStorage.setItem('cognitive_dash_vendors', JSON.stringify(currentVendors));

      // Update local state
      setSampleProviders(prev => [...prev, newProviderData]);
      setFormData(prev => ({ ...prev, sampleProvider: newProviderData.id }));
      setNewSampleProvider({
        name: '',
        company: '',
        specialties: [],
        notes: ''
      });
      setShowAddSampleProvider(false);
      setError('');
    } catch (error) {
      console.error('Error adding sample provider:', error);
      setError('Failed to add sample provider');
    }
  };

  // Add new analytics partner
  const handleAddAnalyticsPartner = async () => {
    if (!newAnalyticsPartner.name || !newAnalyticsPartner.company) {
      setError('Name and company are required for analytics partner');
      return;
    }

    try {
      // Get current vendors from localStorage
      const storedVendors = localStorage.getItem('cognitive_dash_vendors');
      const currentVendors = storedVendors ? JSON.parse(storedVendors) : {
        moderators: [],
        sampleVendors: [],
        analytics: []
      };

      // Check if analytics partner already exists
      const existingPartner = currentVendors.analytics.find((p: any) => p.name === newAnalyticsPartner.name);
      if (existingPartner) {
        setError('Analytics partner with this name already exists');
        return;
      }

      // Create new analytics partner
      const newPartnerData = {
        id: `ap-${Date.now()}`,
        name: newAnalyticsPartner.name,
        company: newAnalyticsPartner.company,
        specialties: newAnalyticsPartner.specialties,
        notes: newAnalyticsPartner.notes,
        pastProjects: [],
        createdAt: new Date().toISOString()
      };

      // Add to analytics partners
      currentVendors.analytics.push(newPartnerData);

      // Save back to localStorage
      localStorage.setItem('cognitive_dash_vendors', JSON.stringify(currentVendors));

      // Update local state
      setAnalyticsPartners(prev => [...prev, newPartnerData]);
      setFormData(prev => ({ ...prev, analyticsPartner: newPartnerData.id }));
      setNewAnalyticsPartner({
        name: '',
        company: '',
        specialties: [],
        notes: ''
      });
      setShowAddAnalyticsPartner(false);
      setError('');
    } catch (error) {
      console.error('Error adding analytics partner:', error);
      setError('Failed to add analytics partner');
    }
  };

  // Load moderators and clients when component mounts
  useEffect(() => {
    loadModerators();
    setExistingClients(extractClientsFromProjects());
  }, [projects, archivedProjects]);

  // Add current user as team member when wizard opens
  useEffect(() => {
    if (isOpen && user && teamMembers.length === 0) {
      const currentUserMember: TeamMemberWithRoles = {
        id: user.id,
        name: user.name || 'Current User',
        role: '', // No default role
        roles: [] // No default roles
      };
      setTeamMembers([currentUserMember]);
    }
  }, [isOpen, user, teamMembers.length]);

  // Handle role updates for team members
  const handleUpdateMemberRoles = (memberId: string, roles: string[]) => {
    setTeamMembers(prev => prev.map(member => 
      member.id === memberId 
        ? { ...member, roles, role: roles[0] || '' } // Update roles and set primary role
        : member
    ));
    autoSave(); // Trigger auto-save
  };

  // Get sample tasks for a specific role
  const getSampleTasksForRole = (roleName: string): string[] => {
    return jaiceTasks
      .filter(task => task.role === roleName && task.task && task.task.trim())
      .slice(0, 3) // Get up to 3 sample tasks
      .map(task => task.task);
  };

  const handleSubmit = async () => {
    setLoading(true);
    setError('');

    try {
      // Ensure timeline is calculated from the input dates
      const calculatedTimeline = calculatePhaseTimeline(timelineDates);
      if (Object.keys(calculatedTimeline).length === 0) {
        throw new Error('Project timeline is incomplete');
      }
      
      // Update the phase timeline with calculated values
      setPhaseTimeline(calculatedTimeline);
      
      // Get project start and end dates from phase timeline
      const kickoffPhase = calculatedTimeline['Kickoff'];
      const reportingPhase = calculatedTimeline['Reporting'];
      
      if (!kickoffPhase?.start || !reportingPhase?.end) {
        throw new Error('Project timeline is incomplete');
      }

      const projectStartDate = kickoffPhase.start;
      const projectEndDate = reportingPhase.end;

      // Create project object
      const project = {
        ...formData,
        id: `P-${Date.now()}`,
        phase: 'Kickoff',
        methodologyDisplay: `${formData.methodologyType} - ${formData.methodology}`,
        phaseTimeline: calculatedTimeline,
        deadline: Math.ceil((new Date(projectEndDate + 'T00:00:00').getTime() - new Date().getTime()) / (1000 * 60 * 60 * 24)),
        nextDeadline: `Project kickoff: ${new Date(projectStartDate + 'T00:00:00').toLocaleDateString()}`,
        keyDeadlines: [
          { label: "Project Kickoff", date: formatDateForKeyDeadline(projectStartDate) },
          { label: "Fielding Start", date: formatDateForKeyDeadline(calculatedTimeline['Fielding']?.start) },
          { label: "Final Report", date: formatDateForKeyDeadline(projectEndDate) }
        ],
        tasks: await (async () => {
          const tasks: Task[] = formData.usePreloadedTasks ? getDefaultTasks(formData.methodologyType, calculatedTimeline, formData.requireAdvancedAnalytics) : [];
          
          // Determine current phase and mark tasks from previous phases as complete
          const now = new Date();
          now.setHours(0, 0, 0, 0); // Normalize to start of day for comparison
          
          const currentPhase = (() => {
            const koEnd = calculatedTimeline['Kickoff']?.end ? new Date(calculatedTimeline['Kickoff'].end + 'T00:00:00') : null;
            const preFieldEnd = calculatedTimeline['Pre-Field']?.end ? new Date(calculatedTimeline['Pre-Field'].end + 'T00:00:00') : null;
            const fieldingEnd = calculatedTimeline['Fielding']?.end ? new Date(calculatedTimeline['Fielding'].end + 'T00:00:00') : null;
            const postFieldEnd = calculatedTimeline['Post-Field Analysis']?.end ? new Date(calculatedTimeline['Post-Field Analysis'].end + 'T00:00:00') : null;
            
            if (!koEnd) return 'Kickoff';
            koEnd.setHours(0, 0, 0, 0);
            if (now <= koEnd) return 'Kickoff';
            
            if (!preFieldEnd) return 'Pre-Field';
            preFieldEnd.setHours(0, 0, 0, 0);
            if (now <= preFieldEnd) return 'Pre-Field';
            
            if (!fieldingEnd) return 'Fielding';
            fieldingEnd.setHours(0, 0, 0, 0);
            if (now <= fieldingEnd) return 'Fielding';
            
            if (!postFieldEnd) return 'Post-Field Analysis';
            postFieldEnd.setHours(0, 0, 0, 0);
            if (now <= postFieldEnd) return 'Post-Field Analysis';
            
            return 'Reporting';
          })();
          
          console.log('Current phase:', currentPhase, 'Current date:', now.toISOString());
          
          // Mark tasks from completed phases as complete
          const phaseOrder = ['Kickoff', 'Pre-Field', 'Fielding', 'Post-Field Analysis', 'Reporting'];
          const currentPhaseIndex = phaseOrder.indexOf(currentPhase);
          
          console.log('Current phase index:', currentPhaseIndex);
          
          for (const task of tasks) {
            const taskPhase = task.phase || '';
            const taskPhaseIndex = phaseOrder.indexOf(taskPhase);
            const shouldComplete = taskPhaseIndex >= 0 && taskPhaseIndex < currentPhaseIndex;
            if (shouldComplete) {
              task.status = 'completed';
              console.log(`Marking task '${task.description}' as complete (phase: ${taskPhase}, index: ${taskPhaseIndex} < ${currentPhaseIndex})`);
            }
          }
          
          // Debug: Check for duplicate task IDs
          const taskIds = tasks.map(t => t.id);
          const uniqueIds = new Set(taskIds);
          if (taskIds.length !== uniqueIds.size) {
            console.log('Duplicate task IDs found:', taskIds.filter((id, index) => taskIds.indexOf(id) !== index));
          }
          
          // Debug: Check for task-057 specifically
          const task057 = tasks.find(t => t.id === 'task-057');
          if (task057) {
            console.log('Found task-057 in final tasks:', task057);
          }

          // Apply auto-assignment based on team member roles
          if (formData.usePreloadedTasks && teamMembers.length > 0) {
            try {
              console.log('Starting auto-assignment with team members:', teamMembers);
              const assignments = await autoAssignByRoles(tasks, teamMembers);
              console.log('Generated assignments:', assignments);
              
              // Create a map of taskId to assignedTo for quick lookup
              const assignmentMap = new Map<string, string>();
              assignments.forEach(assignment => {
                assignmentMap.set(assignment.taskId, assignment.assignedTo);
              });

              console.log('Assignment map:', assignmentMap);
              console.log('Tasks before assignment:', tasks);

              // Update tasks with assignments
              for (const task of tasks) {
                const assigneeId = assignmentMap.get(task.id);
                if (assigneeId) {
                  task.assignedTo = [assigneeId]; // assignedTo should be an array
                  console.log(`Assigned task ${task.id} to ${assigneeId}`);
                  
                  // Generate notification for task assignment
                  const { notificationService } = await import('../services/notificationService');
                  notificationService.generateTaskAssignedNotification(
                    project.id,
                    project.name,
                    assigneeId,
                    task.id,
                    task.description || task.content || 'Untitled Task',
                    task.dueDate
                  );
                }
              }

              console.log('Auto-assigned tasks:', assignments.length, 'assignments made');
              console.log('Final tasks with assignments:', tasks.filter(t => t.assignedTo).length, 'out of', tasks.length);
              console.log('Final tasks with due dates:', tasks.filter(t => t.dueDate).length, 'out of', tasks.length);
              console.log('Sample final tasks:', tasks.slice(0, 3).map(t => ({ 
                id: t.id, 
                description: t.description, 
                assignedTo: t.assignedTo, 
                dueDate: t.dueDate,
                phase: t.phase 
              })));
            } catch (error) {
              console.warn('Auto-assignment failed:', error);
              // Continue without auto-assignment if it fails
            }
          } else {
            console.log('Auto-assignment skipped:', { usePreloadedTasks: formData.usePreloadedTasks, teamMembersLength: teamMembers.length });
          }

          return tasks;
        })(),
        teamMembers: teamMembers,
        sampleDetails: formatSampleDetails(formData.sampleSize, formData.subgroups),
        files: [],
        segments: generateProjectSegments(projectStartDate, projectEndDate)
      };

      // Enforce moderator availability if a moderator is selected and methodology is Qual
      const isQual = (project.methodologyType || '').toLowerCase().startsWith('qual');
      if (isQual && project.moderator) {
        const selectedMod = moderators.find((m: any) => m.id === project.moderator || m.name === project.moderator);
        if (selectedMod) {
          const fieldSeg = (project.segments || []).find((s: any) => s.phase === 'Fielding');
          const allProjects = JSON.parse(localStorage.getItem('cognitive_dash_projects') || '[]');
          const availability = checkModeratorAvailability(
            selectedMod,
            fieldSeg?.startDate,
            fieldSeg?.endDate,
            allProjects,
            { treatPendingAsBlocking: true }
          );
          if (!availability.ok) {
            setError(`Selected moderator is unavailable for the fieldwork dates.\n\n${formatConflicts(availability.conflicts)}`);
            throw new Error('Moderator unavailable');
          }
          // Ensure we save moderator by ID
          project.moderator = selectedMod.id;
        }
      }

      // Debug: Log team members with roles before save
      console.log('📋 Team members before save:', teamMembers);
      console.log('📋 Team members with roles:', teamMembers.map(m => ({
        id: m.id,
        name: m.name,
        roles: m.roles,
        role: m.role
      })));

      // Debug: Log tasks with assignments before save
      const tasksWithAssignments = project.tasks.filter(t => t.assignedTo && t.assignedTo.length > 0);
      console.log(`📋 Tasks with assignments: ${tasksWithAssignments.length} out of ${project.tasks.length}`);
      console.log('📋 Sample assigned tasks:', tasksWithAssignments.slice(0, 5).map(t => ({
        id: t.id,
        description: t.description,
        assignedTo: t.assignedTo
      })));

      // Check user authentication
      if (!user?.id) {
        throw new Error('User not authenticated');
      }

      // Save to backend
      const token = localStorage.getItem('cognitive_dash_token');
      if (!token) {
        throw new Error('You are not authenticated. Please log in again.');
      }

      const response = await fetch(`${API_BASE_URL}/api/projects`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify({
          userId: user.id,
          project: project
        })
      });

      if (!response.ok) {
        const status = response.status;
        let message = 'Failed to save project to server';
        try {
          const data = await response.json();
          if (data?.error || data?.message) message = `${message} (${status}): ${data.error || data.message}`;
        } catch (_) {
          try {
            const text = await response.text();
            if (text) message = `${message} (${status}): ${text}`;
          } catch {}
        }
        throw new Error(message);
      }

      const result = await response.json();
      console.log('Project created successfully:', result);
      
      // Call the callback with the created project
      onProjectCreated(project);
      onClose();
      
    } catch (err) {
      console.error('Error creating project:', err);
      setError(err instanceof Error ? err.message : 'Failed to create project. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const getDefaultTasks = (methodologyType: string, timeline: any, requireAdvancedAnalytics: boolean = false): Task[] => {
    console.log('getDefaultTasks called with methodologyType:', methodologyType);
    if (!methodologyType) {
      console.log('No methodology type, returning empty array');
      return [];
    }
    
    // Filter JAICE tasks by methodology type (Quant/Qual)
    const filteredTasks = jaiceTasks.filter(task => {
      if (!task.quantQual) return true; // Include tasks without quantQual field
      
      // Handle different methodology type formats
      const taskType = task.quantQual.toLowerCase();
      const methodology = methodologyType.toLowerCase();
      
      // Map different variations to standard types
      if (methodology === 'quantitative' || methodology === 'quant') {
        return taskType === 'quant';
      } else if (methodology === 'qualitative' || methodology === 'qual') {
        return taskType === 'qual';
      }
      
      return taskType === methodology;
    });

    console.log('Filtered tasks for methodology:', filteredTasks.length, 'tasks');

    // Filter out advanced analytics tasks if not required
    const analyticsTaskKeywords = [
      'statistician',
      'SPSS'
    ];
    
    const filteredByAnalytics = filteredTasks.filter(task => {
      if (!requireAdvancedAnalytics) {
        // If advanced analytics is NOT required, exclude tasks containing these keywords
        const taskLower = task.task?.toLowerCase() || '';
        return !analyticsTaskKeywords.some(keyword => taskLower.includes(keyword));
      }
      // If advanced analytics IS required, include all tasks
      return true;
    });

    console.log('Filtered by analytics requirement:', filteredByAnalytics.length, 'tasks');

    // Create project timeline for date calculation
    const projectTimeline: ProjectTimeline = {
      koDate: timeline['Kickoff']?.start || '',
      fieldworkStart: timeline['Fielding']?.start || '',
      fieldworkEnd: timeline['Fielding']?.end || '',
      reportDue: timeline['Reporting']?.end || ''
    };

    // Convert JAICE tasks to the expected format with calculated due dates
    const convertedTasks = filteredByAnalytics
      .filter(task => task.task && task.task.trim() !== '') // Filter out tasks with empty descriptions
      .map((task, index) => {
        // Calculate due date based on dateNotes and project timeline
        const dueDate = calculateTaskDueDate(task, projectTimeline);
        
        // Check if task is ongoing
        const isOngoing = task.dateNotes?.toLowerCase().includes('ongoing') || false;

        return {
          id: task.id, // Use the JAICE task ID for role mapping
          description: task.task,
          assignedTo: [] as string[], // Will be set by auto-assignment (array format)
          status: 'pending' as const,
          phase: task.phase,
          dueDate: dueDate || undefined,
          isOngoing: isOngoing,
          dateNotes: task.dateNotes,
          notes: task.notes,
          role: task.role // Preserve the role field for auto-assignment
        };
      });

    console.log('Converted tasks:', convertedTasks.length, 'tasks');
    console.log('Sample converted tasks:', convertedTasks.slice(0, 3).map(t => ({ id: t.id, description: t.description, phase: t.phase })));
    return convertedTasks;
  };

  // Helper function to format dates using UTC methods to avoid timezone issues
  const formatDateForSegment = (date: Date): string => {
    const year = date.getUTCFullYear();
    const month = String(date.getUTCMonth() + 1).padStart(2, '0');
    const day = String(date.getUTCDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  };

  const generateProjectSegments = (startDate: string, endDate: string) => {
    // Use the calculated timeline instead of percentage-based calculation
    // This ensures consistency with the wizard preview
    const calculatedTimeline = calculatePhaseTimeline(timelineDates);
    
    return [
      { phase: "Kickoff", startDate: calculatedTimeline['Kickoff']?.start || startDate, endDate: calculatedTimeline['Kickoff']?.end || startDate },
      { phase: "Pre-Field", startDate: calculatedTimeline['Pre-Field']?.start || startDate, endDate: calculatedTimeline['Pre-Field']?.end || startDate },
      { phase: "Fielding", startDate: calculatedTimeline['Fielding']?.start || startDate, endDate: calculatedTimeline['Fielding']?.end || startDate },
      { phase: "Post-Field Analysis", startDate: calculatedTimeline['Post-Field Analysis']?.start || startDate, endDate: calculatedTimeline['Post-Field Analysis']?.end || startDate },
      { phase: "Reporting", startDate: calculatedTimeline['Reporting']?.start || startDate, endDate: calculatedTimeline['Reporting']?.end || endDate }
    ];
  };

  if (!isOpen) return null;

  return createPortal(
    <div
      className="fixed inset-0 bg-black bg-opacity-50 flex items-start justify-center overflow-y-auto py-8 z-[9999] p-4"
    >
      <div className="bg-white rounded-lg shadow-xl w-full max-w-4xl max-h-[90vh] overflow-hidden flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b">
          <div>
            <h2 className="text-2xl font-bold text-gray-900">Create New Project</h2>
            <p className="text-sm text-gray-600">Step {currentStep} of 4</p>
          </div>
          <button
            onClick={handleCancel}
            className="text-gray-400 hover:text-gray-600"
          >
            <XMarkIcon className="h-6 w-6" />
          </button>
        </div>

        {/* Progress Bar */}
        <div className="px-6 py-4 bg-gray-50">
          <div className="flex items-center">
            {[1, 2, 3, 4].map((step) => (
              <div key={step} className="flex items-center">
                <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-medium ${
                  step <= currentStep
                    ? 'text-white'
                    : 'bg-gray-200 text-gray-600'
                }`}
                style={step <= currentStep ? { backgroundColor: BRAND.orange } : {}}
                >
                  {step}
                </div>
                {step < 4 && (
                  <div className={`w-12 h-1 mx-2 ${
                    step < currentStep ? '' : 'bg-gray-200'
                  }`}
                  style={step < currentStep ? { backgroundColor: BRAND.orange } : {}}
                  />
                )}
              </div>
            ))}
          </div>
        </div>

        {/* Content */}
        <div className="wizard-content p-4 overflow-y-auto flex-1">
          {currentStep === 1 && (
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Project Name
                </label>
                <input
                  type="text"
                  value={formData.name}
                  onChange={(e) => handleInputChange('name', e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2"
                  style={{ '--tw-ring-color': BRAND.orange } as React.CSSProperties}
                  placeholder="e.g., 2025 SMA ATU W8"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Client
                  </label>
                
                <select
                  value={formData.client}
                  onChange={(e) => {
                    const selectedValue = e.target.value;
                    if (selectedValue === '_add_new_') {
                      setShowAddClient(true);
                      // Reset to empty so the dropdown doesn't show "Add New Client" as selected
                      handleInputChange('client', '');
                    } else {
                      handleInputChange('client', selectedValue);
                    }
                  }}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2"
                  style={{ '--tw-ring-color': BRAND.orange } as React.CSSProperties}
                >
                  <option value="">Select client</option>
                  {existingClients.map((client) => (
                    <option key={client} value={client}>
                      {client}
                    </option>
                  ))}
                  <option value="_add_new_">+ Add New Client...</option>
                </select>
              </div>

              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Methodology Type
                  </label>
                  <select
                    value={formData.methodologyType}
                    onChange={(e) => {
                      handleInputChange('methodologyType', e.target.value);
                      handleInputChange('methodology', '');
                    }}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2"
                  style={{ '--tw-ring-color': BRAND.orange } as React.CSSProperties}
                  >
                    <option value="">Select methodology type</option>
                    <option value="Quantitative">Quantitative</option>
                    <option value="Qualitative">Qualitative</option>
                  </select>
                </div>

                {formData.methodologyType && (
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Specific Methodology
                    </label>
                    <select
                      value={formData.methodology}
                      onChange={(e) => handleInputChange('methodology', e.target.value)}
                      className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2"
                  style={{ '--tw-ring-color': BRAND.orange } as React.CSSProperties}
                    >
                      <option value="">Select specific methodology</option>
                      {METHODOLOGIES[formData.methodologyType as keyof typeof METHODOLOGIES]?.map((method) => (
                        <option key={method} value={method}>{method}</option>
                      ))}
                    </select>
                  </div>
                )}
              </div>

                </div>
          )}


          {currentStep === 2 && (
            <div className="space-y-4">
              <div>
                <div className="mb-6">
                  
                  {/* Team Members List - Table Format */}
                  <div className="min-h-[60px]">
                {/* Add Team Member Search */}
                {showAddTeamMember && (
                      <div className="mb-3 p-3 border border-gray-200 rounded-lg bg-gray-50">
                    <UserSearch
                      onUserSelect={handleAddTeamMember}
                      placeholder="Search for team members..."
                      className="text-sm"
                          excludedUserIds={teamMembers.map(m => m.id)}
                    />
                    <button
                      onClick={() => setShowAddTeamMember(false)}
                      className="mt-2 text-xs text-gray-500 hover:text-gray-700"
                    >
                      Cancel
                    </button>
                  </div>
                )}
                  {teamMembers.length > 0 && (
                      <div className="border border-gray-200 rounded-lg overflow-hidden">
                        <table className="w-full">
                          <thead className="bg-gray-50">
                            <tr>
                              <th className="px-3 py-2 text-left text-xs font-medium text-gray-700">
                                <div className="flex items-center gap-2">
                                  <span>Team Member</span>
                                  {!showAddTeamMember && (
                                    <button
                                      type="button"
                                      onClick={() => setShowAddTeamMember(true)}
                                      className="inline-flex items-center gap-1 text-xs font-medium"
                                      style={{ color: BRAND.orange }}
                                      onMouseEnter={(e) => (e.target as HTMLButtonElement).style.color = '#B83D1A'}
                                      onMouseLeave={(e) => (e.target as HTMLButtonElement).style.color = BRAND.orange}
                                    >
                                      <PlusIcon className="w-3 h-3" />
                                      add
                                    </button>
                                  )}
                                </div>
                              </th>
                              <th className="px-3 py-2 text-right text-xs font-medium text-gray-700">
                                <div className="flex items-center justify-end gap-1">
                                  <span>Roles</span>
                                  <button
                                    onClick={() => setShowRoleInfoModal(true)}
                                    className="text-gray-400 hover:text-blue-600 transition-colors"
                                    title="View role descriptions"
                                  >
                                    <InformationCircleIcon className="w-4 h-4" />
                                  </button>
                                </div>
                              </th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-gray-200">
                            {teamMembers.map((member) => {
                          const isCurrentUser = member.id === user?.id;
                              const currentRoles = member.roles || [];
                              
                          return (
                                <tr key={member.id}>
                                  <td className="px-3 py-2">
                                    <div className="flex items-center gap-2">
                              <div className="w-6 h-6 rounded-full flex items-center justify-center text-white text-xs font-medium" style={{ backgroundColor: getMemberColor(member.id) }}>
                                {member.name.split(' ').map(n => n[0]).join('').toUpperCase()}
                              </div>
                                      <div className="flex items-center gap-2">
                              <span className="text-sm font-medium text-gray-700">
                                {member.name}
                                {isCurrentUser && <span className="text-xs text-blue-600 ml-1">(You)</span>}
                              </span>
                              {!isCurrentUser && (
                                <button
                                  onClick={() => handleRemoveTeamMember(member.id)}
                                            className="text-red-600 hover:text-red-800 p-1 rounded hover:bg-red-50"
                                            title="Remove team member"
                                >
                                            <TrashIcon className="w-4 h-4" />
                                </button>
                              )}
                            </div>
                      </div>
                                  </td>
                                  <td className="px-3 py-2">
                                    <div className="flex items-center justify-end gap-2">
                                      {jaiceRoles.map((roleItem) => {
                                        const hasRole = currentRoles.includes(roleItem.role);
                                        return (
                        <button
                                            key={roleItem.role}
                                            type="button"
                                            onClick={() => {
                                              if (hasRole) {
                                                const updatedRoles = currentRoles.filter(r => r !== roleItem.role);
                                                handleUpdateMemberRoles(member.id, updatedRoles);
                                              } else {
                                                const updatedRoles = [...currentRoles, roleItem.role];
                                                handleUpdateMemberRoles(member.id, updatedRoles);
                                              }
                                            }}
                                            className={`text-xs px-3 py-1.5 rounded-full border transition-colors ${
                                              hasRole
                                                ? 'bg-orange-100 text-orange-800 border-orange-300 font-medium'
                                                : 'bg-gray-50 text-gray-600 border-gray-300 hover:bg-gray-100'
                                            }`}
                                          >
                                            {roleItem.role}
                        </button>
                                        );
                                      })}
                                    </div>
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                    </div>
                  )}
                </div>
              </div>

                <div className="border-t pt-4 mt-4">
                <h3 className="text-lg font-semibold text-gray-900">Project Timeline</h3>
                </div>
              </div>

              {/* Simplified Date Inputs */}
              <div className="space-y-4">
                {/* Kickoff Date */}
                <div>
                  <div className="flex items-center gap-2 mb-2">
                    <label className="block text-sm font-medium text-gray-700">
                    When is your project KO date?
                  </label>
                    <div className="flex items-center gap-2 relative">
                  <input
                    type="date"
                    value={timelineDates.kickoffDate}
                        ref={(el) => {
                          if (el) {
                            // Position the input absolutely so it doesn't take space but is still rendered
                            el.style.position = 'absolute';
                            el.style.opacity = '0';
                            el.style.width = '1px';
                            el.style.height = '1px';
                            el.style.pointerEvents = 'none';
                          }
                        }}
                    onChange={(e) => {
                      const dateString = e.target.value;
                      if (!dateString) return;
                      
                      // Parse date string directly to avoid timezone issues
                      const [year, month, day] = dateString.split('-').map(Number);
                      const selectedDate = new Date(year, month - 1, day);
                      const dayOfWeek = selectedDate.getDay();
                      
                      // Prevent weekend selection
                      if (dayOfWeek === 0 || dayOfWeek === 6) { // Sunday or Saturday
                        return; // Don't update the date
                      }
                      
                      handleTimelineDateChange('kickoffDate', dateString);
                    }}
                      />
                      {timelineDates.kickoffDate ? (
                        <div className="inline-flex items-center gap-1 px-3 py-1 bg-orange-100 text-orange-800 border border-orange-300 rounded-full text-sm font-medium">
                          <span
                            onClick={(e) => {
                              const input = e.currentTarget.parentElement?.parentElement?.querySelector('input[type="date"]') as HTMLInputElement;
                              if (input?.showPicker) {
                                input.showPicker();
                              } else {
                                input?.focus();
                                input?.click();
                              }
                            }}
                            className="cursor-pointer"
                          >
                            {(() => {
                              const [year, month, day] = timelineDates.kickoffDate.split('-').map(Number);
                              const date = new Date(year, month - 1, day);
                              return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
                            })()}
                          </span>
                          <button
                            type="button"
                            onClick={() => handleTimelineDateChange('kickoffDate', '')}
                            className="hover:bg-orange-200 rounded-full p-0.5 transition-colors"
                          >
                            <XMarkIcon className="w-4 h-4" />
                          </button>
                        </div>
                      ) : (
                        <button
                          type="button"
                          onClick={(e) => {
                            const input = e.currentTarget.parentElement?.querySelector('input[type="date"]') as HTMLInputElement;
                            if (input?.showPicker) {
                              input.showPicker();
                            } else {
                              input?.focus();
                              input?.click();
                            }
                          }}
                          className="cursor-pointer hover:text-gray-600 transition-colors"
                        >
                          <CalendarDaysIcon className="w-5 h-5 text-gray-400" />
                        </button>
                      )}
                    </div>
                  </div>
                </div>

                {/* Fieldwork Start Date */}
                <div>
                  <div className="flex items-center gap-2 mb-2">
                    <label className={`block text-sm font-medium ${!timelineDates.kickoffDate ? 'text-gray-400' : 'text-gray-700'}`}>
                    When is your targeted fieldwork START date?
                  </label>
                    <div className="flex items-center gap-2 relative">
                  <input
                    type="date"
                    value={timelineDates.fieldworkStartDate}
                        ref={(el) => {
                          if (el) {
                            el.style.position = 'absolute';
                            el.style.opacity = '0';
                            el.style.width = '1px';
                            el.style.height = '1px';
                            el.style.pointerEvents = 'none';
                          }
                        }}
                    onChange={(e) => {
                      const dateString = e.target.value;
                      if (!dateString) return;
                      
                      // Parse date string directly to avoid timezone issues
                      const [year, month, day] = dateString.split('-').map(Number);
                      const selectedDate = new Date(year, month - 1, day);
                      const dayOfWeek = selectedDate.getDay();
                      
                      // Prevent weekend selection
                      if (dayOfWeek === 0 || dayOfWeek === 6) { // Sunday or Saturday
                        return; // Don't update the date
                      }
                      
                      handleTimelineDateChange('fieldworkStartDate', dateString);
                    }}
                    onFocus={(e) => {
                      // Set min date to day after KO date
                      if (timelineDates.kickoffDate) {
                        const koDate = new Date(timelineDates.kickoffDate);
                        koDate.setDate(koDate.getDate() + 1);
                        const minDateString = `${koDate.getFullYear()}-${String(koDate.getMonth() + 1).padStart(2, '0')}-${String(koDate.getDate()).padStart(2, '0')}`;
                        e.target.min = minDateString;
                            e.target.setAttribute('min', minDateString);
                      }
                    }}
                        min={timelineDates.kickoffDate ? (() => {
                          const koDate = new Date(timelineDates.kickoffDate);
                          koDate.setDate(koDate.getDate() + 1);
                          return `${koDate.getFullYear()}-${String(koDate.getMonth() + 1).padStart(2, '0')}-${String(koDate.getDate()).padStart(2, '0')}`;
                        })() : undefined}
                    disabled={!timelineDates.kickoffDate}
                      />
                      {timelineDates.fieldworkStartDate ? (
                        <div className="inline-flex items-center gap-1 px-3 py-1 bg-orange-100 text-orange-800 border border-orange-300 rounded-full text-sm font-medium">
                          <span
                            onClick={(e) => {
                              if (!timelineDates.kickoffDate) return;
                              const input = e.currentTarget.parentElement?.parentElement?.querySelector('input[type="date"]') as HTMLInputElement;
                              if (input?.showPicker) {
                                input.showPicker();
                              } else {
                                input?.focus();
                                input?.click();
                              }
                            }}
                            className="cursor-pointer"
                          >
                            {(() => {
                              const [year, month, day] = timelineDates.fieldworkStartDate.split('-').map(Number);
                              const date = new Date(year, month - 1, day);
                              return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
                            })()}
                          </span>
                          <button
                            type="button"
                            onClick={() => handleTimelineDateChange('fieldworkStartDate', '')}
                            className="hover:bg-orange-200 rounded-full p-0.5 transition-colors"
                          >
                            <XMarkIcon className="w-4 h-4" />
                          </button>
                        </div>
                      ) : (
                        <button
                          type="button"
                          onClick={(e) => {
                            if (!timelineDates.kickoffDate) return;
                            const input = e.currentTarget.parentElement?.querySelector('input[type="date"]') as HTMLInputElement;
                            if (input?.showPicker) {
                              input.showPicker();
                            } else {
                              input?.focus();
                              input?.click();
                            }
                          }}
                          className={`cursor-pointer hover:text-gray-600 transition-colors ${!timelineDates.kickoffDate ? 'cursor-not-allowed opacity-50' : ''}`}
                          disabled={!timelineDates.kickoffDate}
                        >
                          <CalendarDaysIcon className={`w-5 h-5 ${!timelineDates.kickoffDate ? 'text-gray-300' : 'text-gray-400'}`} />
                        </button>
                      )}
                    </div>
                  </div>
                </div>

                {/* Fieldwork End Date */}
                <div>
                  <div className="flex items-center gap-2 mb-2">
                    <label className={`block text-sm font-medium ${!timelineDates.fieldworkStartDate ? 'text-gray-400' : 'text-gray-700'}`}>
                    When is your targeted fieldwork END date?
                  </label>
                    <div className="flex items-center gap-2 relative">
                  <input
                    type="date"
                    value={timelineDates.fieldworkEndDate}
                        ref={(el) => {
                          if (el) {
                            el.style.position = 'absolute';
                            el.style.opacity = '0';
                            el.style.width = '1px';
                            el.style.height = '1px';
                            el.style.pointerEvents = 'none';
                          }
                        }}
                    onChange={(e) => {
                      const dateString = e.target.value;
                      if (!dateString) return;
                      
                      // Parse date string directly to avoid timezone issues
                      const [year, month, day] = dateString.split('-').map(Number);
                      const selectedDate = new Date(year, month - 1, day);
                      const dayOfWeek = selectedDate.getDay();
                      
                      // Prevent weekend selection
                      if (dayOfWeek === 0 || dayOfWeek === 6) { // Sunday or Saturday
                        return; // Don't update the date
                      }
                      
                      handleTimelineDateChange('fieldworkEndDate', dateString);
                    }}
                    onFocus={(e) => {
                          // Set min date to day after fieldwork start date
                      if (timelineDates.fieldworkStartDate) {
                            const startDate = new Date(timelineDates.fieldworkStartDate);
                            startDate.setDate(startDate.getDate() + 1);
                            const minDateString = `${startDate.getFullYear()}-${String(startDate.getMonth() + 1).padStart(2, '0')}-${String(startDate.getDate()).padStart(2, '0')}`;
                            e.target.min = minDateString;
                            e.target.setAttribute('min', minDateString);
                          }
                        }}
                        min={timelineDates.fieldworkStartDate ? (() => {
                          const startDate = new Date(timelineDates.fieldworkStartDate);
                          startDate.setDate(startDate.getDate() + 1);
                          return `${startDate.getFullYear()}-${String(startDate.getMonth() + 1).padStart(2, '0')}-${String(startDate.getDate()).padStart(2, '0')}`;
                        })() : undefined}
                    disabled={!timelineDates.fieldworkStartDate}
                      />
                      {timelineDates.fieldworkEndDate ? (
                        <div className="inline-flex items-center gap-1 px-3 py-1 bg-orange-100 text-orange-800 border border-orange-300 rounded-full text-sm font-medium">
                          <span
                            onClick={(e) => {
                              if (!timelineDates.fieldworkStartDate) return;
                              const input = e.currentTarget.parentElement?.parentElement?.querySelector('input[type="date"]') as HTMLInputElement;
                              if (input?.showPicker) {
                                input.showPicker();
                              } else {
                                input?.focus();
                                input?.click();
                              }
                            }}
                            className="cursor-pointer"
                          >
                            {(() => {
                              const [year, month, day] = timelineDates.fieldworkEndDate.split('-').map(Number);
                              const date = new Date(year, month - 1, day);
                              return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
                            })()}
                          </span>
                          <button
                            type="button"
                            onClick={() => handleTimelineDateChange('fieldworkEndDate', '')}
                            className="hover:bg-orange-200 rounded-full p-0.5 transition-colors"
                          >
                            <XMarkIcon className="w-4 h-4" />
                          </button>
                        </div>
                      ) : (
                        <button
                          type="button"
                          onClick={(e) => {
                            if (!timelineDates.fieldworkStartDate) return;
                            const input = e.currentTarget.parentElement?.querySelector('input[type="date"]') as HTMLInputElement;
                            if (input?.showPicker) {
                              input.showPicker();
                            } else {
                              input?.focus();
                              input?.click();
                            }
                          }}
                          className={`cursor-pointer hover:text-gray-600 transition-colors ${!timelineDates.fieldworkStartDate ? 'cursor-not-allowed opacity-50' : ''}`}
                          disabled={!timelineDates.fieldworkStartDate}
                        >
                          <CalendarDaysIcon className={`w-5 h-5 ${!timelineDates.fieldworkStartDate ? 'text-gray-300' : 'text-gray-400'}`} />
                        </button>
                      )}
                    </div>
                  </div>
                </div>

                {/* Report Deadline Date */}
                <div>
                  <div className="flex items-center gap-2 mb-2">
                    <label className={`block text-sm font-medium ${!timelineDates.fieldworkEndDate ? 'text-gray-400' : 'text-gray-700'}`}>
                    When is your final report deadline?
                  </label>
                    <div className="flex items-center gap-2 relative">
                  <input
                    type="date"
                    value={timelineDates.reportDeadlineDate}
                        ref={(el) => {
                          if (el) {
                            el.style.position = 'absolute';
                            el.style.opacity = '0';
                            el.style.width = '1px';
                            el.style.height = '1px';
                            el.style.pointerEvents = 'none';
                          }
                        }}
                    onChange={(e) => {
                      const dateString = e.target.value;
                      if (!dateString) return;
                      
                      // Parse date string directly to avoid timezone issues
                      const [year, month, day] = dateString.split('-').map(Number);
                      const selectedDate = new Date(year, month - 1, day);
                      const dayOfWeek = selectedDate.getDay();
                      
                      // Prevent weekend selection
                      if (dayOfWeek === 0 || dayOfWeek === 6) { // Sunday or Saturday
                        return; // Don't update the date
                      }
                      
                      handleTimelineDateChange('reportDeadlineDate', dateString);
                    }}
                    onFocus={(e) => {
                          // Set min date to day after fieldwork end date
                      if (timelineDates.fieldworkEndDate) {
                            const endDate = new Date(timelineDates.fieldworkEndDate);
                            endDate.setDate(endDate.getDate() + 1);
                            const minDateString = `${endDate.getFullYear()}-${String(endDate.getMonth() + 1).padStart(2, '0')}-${String(endDate.getDate()).padStart(2, '0')}`;
                            e.target.min = minDateString;
                            e.target.setAttribute('min', minDateString);
                          }
                        }}
                        min={timelineDates.fieldworkEndDate ? (() => {
                          const endDate = new Date(timelineDates.fieldworkEndDate);
                          endDate.setDate(endDate.getDate() + 1);
                          return `${endDate.getFullYear()}-${String(endDate.getMonth() + 1).padStart(2, '0')}-${String(endDate.getDate()).padStart(2, '0')}`;
                        })() : undefined}
                    disabled={!timelineDates.fieldworkEndDate}
                      />
                      {timelineDates.reportDeadlineDate ? (
                        <div className="inline-flex items-center gap-1 px-3 py-1 bg-orange-100 text-orange-800 border border-orange-300 rounded-full text-sm font-medium">
                          <span
                            onClick={(e) => {
                              if (!timelineDates.fieldworkEndDate) return;
                              const input = e.currentTarget.parentElement?.parentElement?.querySelector('input[type="date"]') as HTMLInputElement;
                              if (input?.showPicker) {
                                input.showPicker();
                              } else {
                                input?.focus();
                                input?.click();
                              }
                            }}
                            className="cursor-pointer"
                          >
                            {(() => {
                              const [year, month, day] = timelineDates.reportDeadlineDate.split('-').map(Number);
                              const date = new Date(year, month - 1, day);
                              return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
                            })()}
                          </span>
                          <button
                            type="button"
                            onClick={() => handleTimelineDateChange('reportDeadlineDate', '')}
                            className="hover:bg-orange-200 rounded-full p-0.5 transition-colors"
                          >
                            <XMarkIcon className="w-4 h-4" />
                          </button>
                        </div>
                      ) : (
                        <button
                          type="button"
                          onClick={(e) => {
                            if (!timelineDates.fieldworkEndDate) return;
                            const input = e.currentTarget.parentElement?.querySelector('input[type="date"]') as HTMLInputElement;
                            if (input?.showPicker) {
                              input.showPicker();
                            } else {
                              input?.focus();
                              input?.click();
                            }
                          }}
                          className={`cursor-pointer hover:text-gray-600 transition-colors ${!timelineDates.fieldworkEndDate ? 'cursor-not-allowed opacity-50' : ''}`}
                          disabled={!timelineDates.fieldworkEndDate}
                        >
                          <CalendarDaysIcon className={`w-5 h-5 ${!timelineDates.fieldworkEndDate ? 'text-gray-300' : 'text-gray-400'}`} />
                        </button>
                      )}
                    </div>
                  </div>
                </div>

              </div>

              {/* Removed calculated timeline preview per requirements */}
            </div>
          )}

          {currentStep === 3 && (
            <div className="space-y-6">
              {/* Sample Details Section */}
              <div>
                <h3 className="text-lg font-semibold text-gray-900 mb-4">Sample Details</h3>
                    
                    <div className="border border-gray-200 rounded-lg overflow-hidden">
                  <table className="w-full divide-y divide-gray-200">
                        <thead className="bg-gray-50">
                          <tr>
                        <th className="px-4 py-3 text-left text-xs font-medium text-gray-700 uppercase tracking-wider w-64">
                          Quota Name
                            </th>
                        <th className="px-4 py-3 text-left text-xs font-medium text-gray-700 uppercase tracking-wider w-32">
                              Sample Size
                            </th>
                        <th className="px-4 py-3 text-left text-xs font-medium text-gray-700 uppercase tracking-wider w-16">
                          &nbsp;
                            </th>
                          </tr>
                        </thead>
                        <tbody className="bg-white divide-y divide-gray-200">
                      {/* Total Row - Always present */}
                      <tr>
                        <td className="px-4 py-3 text-sm font-medium text-gray-700">
                          Total
                        </td>
                        <td className="px-4 py-3">
                          <input
                            type="number"
                            value={formData.sampleSize > 0 ? formData.sampleSize : ''}
                            onChange={(e) => handleInputChange('sampleSize', e.target.value === '' ? 0 : parseInt(e.target.value) || 0)}
                            className="w-20 px-2 py-1 border border-gray-300 rounded focus:outline-none focus:ring-1 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                            style={{ '--tw-ring-color': BRAND.orange } as React.CSSProperties}
                            placeholder="0"
                          />
                        </td>
                        <td className="px-4 py-3">
                          {/* Empty cell for Total row */}
                        </td>
                      </tr>

                      {/* Subgroups */}
                          {(formData.subgroups || []).map((subgroup, index) => (
                            <tr key={subgroup.id}>
                              <td className="px-4 py-3">
                                <input
                                  type="text"
                                  value={subgroup.name}
                                  onChange={(e) => {
                                    const updatedSubgroups = [...(formData.subgroups || [])];
                                    updatedSubgroups[index] = { ...subgroup, name: e.target.value };
                                    handleInputChange('subgroups', updatedSubgroups);
                                  }}
                                  className="w-full px-2 py-1 border border-gray-300 rounded focus:outline-none focus:ring-1"
                                  style={{ '--tw-ring-color': BRAND.orange } as React.CSSProperties}
                                  placeholder="e.g., HCP, Patient"
                                />
                              </td>
                              <td className="px-4 py-3">
                                <input
                                  type="number"
                                  value={subgroup.size || ''}
                                  onChange={(e) => {
                                    const updatedSubgroups = [...(formData.subgroups || [])];
                                    updatedSubgroups[index] = { ...subgroup, size: parseInt(e.target.value) || 0 };
                                    handleInputChange('subgroups', updatedSubgroups);
                                  }}
                              className="w-20 px-2 py-1 border border-gray-300 rounded focus:outline-none focus:ring-1 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                                  style={{ '--tw-ring-color': BRAND.orange } as React.CSSProperties}
                              placeholder="0"
                                />
                              </td>
                              <td className="px-4 py-3">
                                <button
                                  type="button"
                                  onClick={() => {
                                    const updatedSubgroups = (formData.subgroups || []).filter((_, i) => i !== index);
                                    handleInputChange('subgroups', updatedSubgroups);
                                  }}
                              className="text-red-600 hover:text-red-800"
                              title="Remove"
                                >
                              <TrashIcon className="w-4 h-4" />
                                </button>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
              </div>

                {/* Add Subgroup Button */}
                <div className="mt-3">
                    <button
                      type="button"
                    onClick={() => {
                      if (formData.sampleSize && formData.sampleSize > 0) {
                        const newSubgroup = { id: Date.now().toString(), name: '', size: 0 };
                        handleInputChange('subgroups', [...(formData.subgroups || []), newSubgroup]);
                      }
                    }}
                    disabled={!formData.sampleSize || formData.sampleSize <= 0}
                    className={`inline-flex items-center gap-1 text-sm px-3 py-2 rounded-md border ${
                      formData.sampleSize && formData.sampleSize > 0
                        ? 'text-orange-600 border-orange-300 hover:bg-orange-50 cursor-pointer'
                        : 'text-gray-400 border-gray-300 cursor-not-allowed'
                    }`}
                    >
                      <PlusIcon className="w-4 h-4" />
                    Add Subgroup
                    </button>
                </div>
                  </div>

              {formData.methodologyType === 'Qualitative' && (
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Moderator <span className="text-gray-500 font-normal">(optional)</span>
                  </label>

                  <select
                    value={formData.moderator}
                    onChange={(e) => {
                      const selectedValue = e.target.value;
                      if (selectedValue === '_add_new_moderator_') {
                        setShowAddModerator(true);
                        // Reset to empty so the dropdown doesn't show "Add New" as selected
                        handleInputChange('moderator', '');
                      } else {
                        handleInputChange('moderator', selectedValue);
                      }
                    }}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2"
                  style={{ '--tw-ring-color': BRAND.orange } as React.CSSProperties}
                  >
                    <option value="">Select moderator</option>
                    {moderators.map((moderator) => (
                      <option key={moderator.id} value={moderator.id}>
                        {moderator.name} ({moderator.company || moderator.email})
                      </option>
                    ))}
                    <option value="_add_new_moderator_">+ Add New Moderator...</option>
                  </select>

                  {/* Add New Moderator Modal */}
                  {showAddModerator && (
                    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-[99999]">
                      <div className="bg-white rounded-lg p-6 max-w-md w-full mx-4">
                        <div className="flex items-center justify-between mb-4">
                          <h3 className="text-lg font-semibold">Add New Moderator</h3>
                          <button
                            onClick={() => setShowAddModerator(false)}
                            className="text-gray-400 hover:text-gray-600"
                          >
                            <XMarkIcon className="w-5 h-5" />
                          </button>
                        </div>

                        <div className="space-y-4">
                          <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">
                              Name
                            </label>
                            <input
                              type="text"
                              value={newModerator.name}
                              onChange={(e) => setNewModerator(prev => ({ ...prev, name: e.target.value }))}
                              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2"
                  style={{ '--tw-ring-color': BRAND.orange } as React.CSSProperties}
                              placeholder="Moderator name"
                            />
                          </div>

                          <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">
                              Email
                            </label>
                            <input
                              type="email"
                              value={newModerator.email}
                              onChange={(e) => setNewModerator(prev => ({ ...prev, email: e.target.value }))}
                              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2"
                  style={{ '--tw-ring-color': BRAND.orange } as React.CSSProperties}
                              placeholder="moderator@example.com"
                            />
                          </div>

                          <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">
                              Phone
                            </label>
                            <input
                              type="tel"
                              value={newModerator.phone}
                              onChange={(e) => setNewModerator(prev => ({ ...prev, phone: e.target.value }))}
                              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2"
                  style={{ '--tw-ring-color': BRAND.orange } as React.CSSProperties}
                              placeholder="Phone number"
                            />
                          </div>

                          <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">
                              Company
                            </label>
                            <input
                              type="text"
                              value={newModerator.company}
                              onChange={(e) => setNewModerator(prev => ({ ...prev, company: e.target.value }))}
                              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2"
                  style={{ '--tw-ring-color': BRAND.orange } as React.CSSProperties}
                              placeholder="Company name"
                            />
                          </div>

                          <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">
                              Notes
                            </label>
                            <textarea
                              value={newModerator.notes}
                              onChange={(e) => setNewModerator(prev => ({ ...prev, notes: e.target.value }))}
                              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2"
                  style={{ '--tw-ring-color': BRAND.orange } as React.CSSProperties}
                              rows={3}
                              placeholder="Additional notes..."
                            />
                          </div>
                        </div>

                        <div className="flex justify-end gap-3 mt-6">
                          <button
                            type="button"
                            onClick={() => setShowAddModerator(false)}
                            className="px-4 py-2 text-gray-700 border border-gray-300 rounded-md hover:bg-gray-50"
                          >
                            Cancel
                          </button>
                          <button
                            type="button"
                            onClick={handleAddModerator}
                            className="px-4 py-2 text-white rounded-md"
                            style={{ backgroundColor: BRAND.orange }}
                            onMouseEnter={(e) => (e.target as HTMLButtonElement).style.backgroundColor = '#B83D1A'}
                            onMouseLeave={(e) => (e.target as HTMLButtonElement).style.backgroundColor = BRAND.orange}
                          >
                            Add Moderator
                          </button>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              )}


              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                    Sample Provider <span className="text-gray-500 font-normal">(optional)</span>
                  </label>
                
                <select
                  value={formData.sampleProvider}
                  onChange={(e) => {
                    const selectedValue = e.target.value;
                    if (selectedValue === '_add_new_sample_provider_') {
                      setShowAddSampleProvider(true);
                      // Reset to empty so the dropdown doesn't show "Add New" as selected
                      handleInputChange('sampleProvider', '');
                    } else {
                      handleInputChange('sampleProvider', selectedValue);
                    }
                  }}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2"
                  style={{ '--tw-ring-color': BRAND.orange } as React.CSSProperties}
                >
                  <option value="">Select sample provider</option>
                  {sampleProviders.map((provider) => (
                    <option key={provider.id} value={provider.id}>
                      {provider.company}
                    </option>
                  ))}
                  <option value="_add_new_sample_provider_">+ Add New Sample Provider...</option>
                </select>
              </div>

              {/* Advanced Analytics Section - show only for Quantitative */}
              {formData.methodologyType === 'Quantitative' && (
                <div className="space-y-4">
                  <div className="flex items-center">
                    <input
                      type="checkbox"
                      id="requireAdvancedAnalytics"
                      checked={formData.requireAdvancedAnalytics}
                      onChange={(e) => handleInputChange('requireAdvancedAnalytics', e.target.checked)}
                      className="mr-3"
                    />
                    <label htmlFor="requireAdvancedAnalytics" className="text-sm font-medium text-gray-700">
                      Require advanced analytics
                    </label>
                  </div>

                  {formData.requireAdvancedAnalytics && (
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">
                          Analytics Partner
                        </label>
                      
                      <select
                        value={formData.analyticsPartner}
                        onChange={(e) => {
                          const selectedValue = e.target.value;
                          if (selectedValue === '_add_new_analytics_partner_') {
                            setShowAddAnalyticsPartner(true);
                            // Reset to empty so the dropdown doesn't show "Add New" as selected
                            handleInputChange('analyticsPartner', '');
                          } else {
                            handleInputChange('analyticsPartner', selectedValue);
                          }
                        }}
                        className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2"
                        style={{ '--tw-ring-color': BRAND.orange } as React.CSSProperties}
                      >
                        <option value="">Select analytics partner</option>
                        {analyticsPartners.map((partner) => (
                          <option key={partner.id} value={partner.id}>
                            {partner.name} ({partner.company})
                          </option>
                        ))}
                        <option value="_add_new_analytics_partner_">+ Add New Analytics Partner...</option>
                      </select>
                    </div>
                  )}
                </div>
              )}

            </div>
          )}


          {currentStep === 4 && (() => {
            const calculatedTimeline = calculatePhaseTimeline(timelineDates);
            
            // Helper to format dates for display
            const formatDisplayDate = (dateString: string) => {
              if (!dateString) return '';
              const [year, month, day] = dateString.split('-').map(Number);
              const date = new Date(year, month - 1, day);
              return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
            };

            // Helper to format week dates
            const formatWeekDisplay = (weekString: string) => {
              if (!weekString) return '';
              const parts = weekString.split('/');
              return `${parts[0]}/${parts[1]}`;
            };

            // Helper to format short date (MM/DD)
            const formatShortDate = (dateString: string) => {
              if (!dateString) return '';
              const [year, month, day] = dateString.split('-').map(Number);
              return `${month}/${day}`;
            };

            // Generate week headers for the Gantt chart
            const generateWeekHeaders = () => {
              if (!calculatedTimeline['Kickoff']?.start || !calculatedTimeline['Reporting']?.end) {
                return [];
              }

              // Parse dates as local dates
              const [koYear, koMonth, koDay] = calculatedTimeline['Kickoff'].start.split('-').map(Number);
              const [reportYear, reportMonth, reportDay] = calculatedTimeline['Reporting'].end.split('-').map(Number);
              
              const koDate = new Date(koYear, koMonth - 1, koDay);
              const reportDate = new Date(reportYear, reportMonth - 1, reportDay);
              const weeks: string[] = [];
              const current = new Date(koDate);
              
              // Find the Monday of the week containing the kickoff date
              const dayOfWeek = current.getDay();
              const daysToMonday = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
              current.setDate(current.getDate() + daysToMonday);
              
              while (current <= reportDate) {
                const year = current.getFullYear();
                const month = current.getMonth() + 1;
                const day = current.getDate();
                weeks.push(`${month}/${day}/${year}`);
                current.setDate(current.getDate() + 7);
              }
              
              return weeks;
            };

            const weekHeaders = generateWeekHeaders();

            // Helper to get the week number a date falls into
            const getWeekIndex = (dateString: string) => {
              if (!dateString) return 0;
              
              // Parse dates as local dates (YYYY-MM-DD format)
              const parseLocalDate = (dateStr: string) => {
                const [year, month, day] = dateStr.split('-').map(Number);
                return new Date(year, month - 1, day);
              };
              
              const koDate = parseLocalDate(calculatedTimeline['Kickoff']?.start || '');
              const targetDate = parseLocalDate(dateString);
              
              // Find Monday of the week for KO date
              const koDay = koDate.getDay();
              const koDaysToMonday = koDay === 0 ? -6 : 1 - koDay;
              koDate.setDate(koDate.getDate() + koDaysToMonday);
              
              // Find Monday of the week for the target date
              const targetDay = targetDate.getDay();
              const targetDaysToMonday = targetDay === 0 ? -6 : 1 - targetDay;
              targetDate.setDate(targetDate.getDate() + targetDaysToMonday);
              
              const diffTime = targetDate.getTime() - koDate.getTime();
              const diffWeeks = Math.floor(diffTime / (7 * 24 * 60 * 60 * 1000));
              
              return diffWeeks;
            };

            // Helper to calculate span for a phase
            const getPhaseSpan = (phaseName: string) => {
              const phase = calculatedTimeline[phaseName];
              if (!phase?.start || !phase?.end) return { start: 0, span: 0 };
              
              const start = getWeekIndex(phase.start);
              const end = getWeekIndex(phase.end);
              const span = Math.max(1, end - start + 1);
              
              return { start, span };
            };

            return (
            <div className="space-y-6">
                <h3 className="text-lg font-semibold text-gray-900">Project Summary</h3>

                {/* Project Details */}
                <div className="bg-gray-50 rounded-lg p-4 space-y-3">
                  <div className="grid grid-cols-2 gap-4">
              <div>
                      <p className="text-xs font-medium text-gray-500 uppercase">Project Name</p>
                      <p className="text-sm font-semibold text-gray-900">{formData.name}</p>
                    </div>
                    <div>
                      <p className="text-xs font-medium text-gray-500 uppercase">Client</p>
                      <p className="text-sm font-semibold text-gray-900">{formData.client}</p>
                    </div>
                    <div>
                      <p className="text-xs font-medium text-gray-500 uppercase">Methodology</p>
                      <p className="text-sm font-semibold text-gray-900">
                        {formData.methodologyType} - {formData.methodology}
                </p>
              </div>
                    <div>
                      <p className="text-xs font-medium text-gray-500 uppercase">Date Range</p>
                      <p className="text-sm font-semibold text-gray-900">
                        {formatDisplayDate(calculatedTimeline['Kickoff']?.start || '')} - {formatDisplayDate(calculatedTimeline['Reporting']?.end || '')}
                      </p>
                    </div>
                  </div>
                </div>

                {/* Gantt Chart Timeline */}
                <div className="overflow-x-auto">
                  <p className="text-sm font-medium text-gray-700 mb-3">TIMELINE</p>
                  <div className="border border-gray-200 rounded-lg overflow-hidden" style={{ minWidth: `${(weekHeaders.length * 60) + 160}px` }}>
                    {/* Week Header */}
                    <div className="text-white text-sm font-semibold flex border-b" style={{ backgroundColor: BRAND.red, borderColor: '#9a2e1a', minWidth: `${(weekHeaders.length * 60) + 160}px` }}>
                      <div className="w-40 border-r px-3 py-2 flex-shrink-0" style={{ borderColor: '#9a2e1a' }}>Week of</div>
                      <div className="flex-1 flex">
                        {weekHeaders.map((week, idx) => (
                          <div key={idx} className="px-2 py-2 text-xs text-center border-r flex-grow" style={{ flexBasis: 0, minWidth: '60px', borderColor: '#9a2e1a' }}>
                            {formatWeekDisplay(week)}
                                </div>
                              ))}
                            </div>
                    </div>

                    {/* Phase Rows */}
                    {PHASES.map((phaseName) => {
                      const { start, span } = getPhaseSpan(phaseName);
                      const phaseDates = calculatedTimeline[phaseName];
                      
                      return (
                        <div key={phaseName} className="flex border-b border-gray-200 last:border-b-0 bg-white" style={{ minWidth: `${(weekHeaders.length * 60) + 160}px` }}>
                          {/* Phase Label */}
                          <div className="w-40 border-r border-gray-200 bg-gray-50 px-3 py-3 text-sm font-medium text-gray-700 flex-shrink-0">
                            {phaseName}
                          </div>
                          
                          {/* Timeline Grid */}
                          <div className="flex-1 flex relative bg-white" style={{ height: '42px' }}>
                            {weekHeaders.map((_, idx) => (
                              <div key={idx} className="flex-grow border-r border-gray-100" style={{ flexBasis: 0, minWidth: '60px' }} />
                            ))}
                            
                            {/* Phase Bar */}
                            {phaseDates && start >= 0 && span > 0 && start + span <= weekHeaders.length && (
                              <div 
                                className="absolute h-6 rounded shadow-sm flex items-center justify-center text-white text-xs font-medium"
                                style={{ 
                                  left: `${(start / weekHeaders.length) * 100}%`,
                                  width: `${(span / weekHeaders.length) * 100}%`,
                                  top: '9px',
                                  backgroundColor: BRAND.orange,
                                  opacity: 0.5
                                }}
                              >
                                {(phaseName === 'Kickoff' || phaseName === 'Reporting') && (
                                  <span style={{ color: 'white', fontWeight: 'normal', fontStyle: 'italic' }}>{formatShortDate(phaseName === 'Kickoff' ? phaseDates.start : phaseDates.end)}</span>
                                )}
                            </div>
                          )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>

            </div>
            );
          })()}

          {error && (
            <div className="text-red-600 text-sm bg-red-50 p-3 rounded-md">
              {error}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between p-3 border-t bg-gray-50">
          <button
            onClick={handlePrevious}
            disabled={currentStep === 1}
            className="flex items-center px-3 py-1.5 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <ChevronLeftIcon className="h-4 w-4 mr-2" />
            Previous
          </button>

          <div className="flex space-x-3">
            <button
              onClick={handleCancel}
              className="px-3 py-1.5 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50"
            >
              Cancel
            </button>
            
            {currentStep === 4 ? (
              <button
                onClick={handleSubmit}
                disabled={loading || !formData.name || !formData.client || !formData.methodologyType || !formData.methodology || !timelineDates.kickoffDate || !timelineDates.fieldworkStartDate || !timelineDates.fieldworkEndDate || !timelineDates.reportDeadlineDate}
                className="px-6 py-2 text-sm font-medium text-white rounded-md disabled:opacity-50 disabled:cursor-not-allowed"
                style={{ backgroundColor: BRAND.orange }}
                onMouseEnter={(e) => (e.target as HTMLButtonElement).style.backgroundColor = '#B83D1A'}
                onMouseLeave={(e) => (e.target as HTMLButtonElement).style.backgroundColor = BRAND.orange}
              >
                {loading ? 'Creating...' : 'Create Project'}
              </button>
            ) : (
              <button
                onClick={handleNext}
                disabled={!formData.name || !formData.client || !formData.methodologyType || !formData.methodology}
                className="flex items-center px-4 py-2 text-sm font-medium text-white rounded-md disabled:opacity-50 disabled:cursor-not-allowed"
                style={{ backgroundColor: BRAND.orange }}
                onMouseEnter={(e) => (e.target as HTMLButtonElement).style.backgroundColor = '#B83D1A'}
                onMouseLeave={(e) => (e.target as HTMLButtonElement).style.backgroundColor = BRAND.orange}
              >
                Next
                <ChevronRightIcon className="h-4 w-4 ml-2" />
              </button>
            )}
          </div>
        </div>
      </div>
      
      {/* Role Information Modal */}
      {showRoleInfoModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-[99999]">
          <div className="bg-white rounded-lg shadow-xl max-w-2xl w-full mx-4 overflow-hidden">
            <div className="flex items-center justify-between px-4 py-3 border-b">
              <h3 className="text-base font-semibold text-gray-900">Role Descriptions</h3>
              <button
                onClick={() => setShowRoleInfoModal(false)}
                className="text-gray-400 hover:text-gray-600"
              >
                <XMarkIcon className="w-5 h-5" />
              </button>
            </div>
            <div className="px-4 py-3">
              <div className="grid grid-cols-2 gap-4">
                {jaiceRoles.map((roleItem) => {
                  const sampleTasks = getSampleTasksForRole(roleItem.role);
                  return (
                    <div key={roleItem.role} className="border border-gray-200 rounded p-3 bg-gray-50">
                      <h4 className="text-sm font-semibold text-gray-900 mb-1">{roleItem.role}</h4>
                      <p className="text-xs text-gray-600 mb-2">{roleItem.description}</p>
                      {sampleTasks.length > 0 && (
                        <div>
                          <p className="text-xs font-medium text-gray-500 mb-1">Example tasks:</p>
                          <ul className="space-y-0.5">
                            {sampleTasks.map((task, idx) => (
                              <li key={idx} className="text-xs text-gray-600">
                                • {task}
                              </li>
                            ))}
                          </ul>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </div>
      )}
      
      {/* Add New Client Modal */}
      {showAddClient && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-[99999]">
          <div className="bg-white rounded-lg p-6 max-w-md w-full mx-4">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold">Add New Client</h3>
              <button
                onClick={() => setShowAddClient(false)}
                className="text-gray-400 hover:text-gray-600"
              >
                <XMarkIcon className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Client Name
                </label>
                <input
                  type="text"
                  value={newClientName}
                  onChange={(e) => setNewClientName(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2"
                  style={{ '--tw-ring-color': BRAND.orange } as React.CSSProperties}
                  placeholder="Enter client name"
                  onKeyPress={(e) => {
                    if (e.key === 'Enter') {
                      handleAddNewClient();
                    }
                  }}
                />
              </div>
            </div>

            <div className="flex justify-end gap-3 mt-6">
              <button
                type="button"
                onClick={() => setShowAddClient(false)}
                className="px-4 py-2 text-gray-700 border border-gray-300 rounded-md hover:bg-gray-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleAddNewClient}
                className="px-4 py-2 text-white rounded-md"
                style={{ backgroundColor: BRAND.orange }}
                onMouseEnter={(e) => (e.target as HTMLButtonElement).style.backgroundColor = '#B83D1A'}
                onMouseLeave={(e) => (e.target as HTMLButtonElement).style.backgroundColor = BRAND.orange}
              >
                Add Client
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Add New Sample Provider Modal */}
      {showAddSampleProvider && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-[99999]">
          <div className="bg-white rounded-lg p-6 max-w-md w-full mx-4">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold">Add New Sample Provider</h3>
              <button
                onClick={() => setShowAddSampleProvider(false)}
                className="text-gray-400 hover:text-gray-600"
              >
                <XMarkIcon className="w-5 h-5" />
              </button>
            </div>
            
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Company Name
                </label>
                <input
                  type="text"
                  value={newSampleProvider.company}
                  onChange={(e) => setNewSampleProvider(prev => ({ ...prev, company: e.target.value }))}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2"
                  style={{ '--tw-ring-color': BRAND.orange } as React.CSSProperties}
                  placeholder="Company name"
                />
              </div>
            </div>
            
            <div className="flex justify-end gap-3 mt-6">
              <button
                type="button"
                onClick={() => setShowAddSampleProvider(false)}
                className="px-4 py-2 text-gray-700 bg-gray-100 hover:bg-gray-200 rounded-md transition-colors"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleAddSampleProvider}
                className="px-4 py-2 text-white rounded-md"
                style={{ backgroundColor: BRAND.orange }}
                onMouseEnter={(e) => (e.target as HTMLButtonElement).style.backgroundColor = '#B83D1A'}
                onMouseLeave={(e) => (e.target as HTMLButtonElement).style.backgroundColor = BRAND.orange}
              >
                Add Provider
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Add New Analytics Partner Modal */}
      {showAddAnalyticsPartner && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-[99999]">
          <div className="bg-white rounded-lg p-6 max-w-md w-full mx-4">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold">Add New Analytics Partner</h3>
              <button
                onClick={() => setShowAddAnalyticsPartner(false)}
                className="text-gray-400 hover:text-gray-600"
              >
                <XMarkIcon className="w-5 h-5" />
              </button>
            </div>
            
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Partner Name
                </label>
                <input
                  type="text"
                  value={newAnalyticsPartner.name}
                  onChange={(e) => setNewAnalyticsPartner(prev => ({ ...prev, name: e.target.value }))}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2"
                  style={{ '--tw-ring-color': BRAND.orange } as React.CSSProperties}
                  placeholder="Partner name"
                />
              </div>
              
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Company
                </label>
                <input
                  type="text"
                  value={newAnalyticsPartner.company}
                  onChange={(e) => setNewAnalyticsPartner(prev => ({ ...prev, company: e.target.value }))}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2"
                  style={{ '--tw-ring-color': BRAND.orange } as React.CSSProperties}
                  placeholder="Company name"
                />
              </div>
              
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Notes
                </label>
                <textarea
                  value={newAnalyticsPartner.notes}
                  onChange={(e) => setNewAnalyticsPartner(prev => ({ ...prev, notes: e.target.value }))}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2"
                  style={{ '--tw-ring-color': BRAND.orange } as React.CSSProperties}
                  rows={3}
                  placeholder="Additional notes..."
                />
              </div>
            </div>
            
            <div className="flex justify-end gap-3 mt-6">
              <button
                type="button"
                onClick={() => setShowAddAnalyticsPartner(false)}
                className="px-4 py-2 text-gray-700 bg-gray-100 hover:bg-gray-200 rounded-md transition-colors"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleAddAnalyticsPartner}
                className="px-4 py-2 text-white rounded-md"
                style={{ backgroundColor: BRAND.orange }}
                onMouseEnter={(e) => (e.target as HTMLButtonElement).style.backgroundColor = '#B83D1A'}
                onMouseLeave={(e) => (e.target as HTMLButtonElement).style.backgroundColor = BRAND.orange}
              >
                Add Partner
              </button>
            </div>
          </div>
        </div>
      )}
    </div>,
    document.body
  );
};

export default ProjectSetupWizard;
