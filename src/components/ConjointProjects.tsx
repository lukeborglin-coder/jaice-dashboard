import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { API_BASE_URL } from '../config';
import { useAuth } from '../contexts/AuthContext';
import { DocumentTextIcon, CalendarIcon, UserGroupIcon, UserIcon, ArrowLeftIcon, ChevronDownIcon } from '@heroicons/react/24/outline';
import { IconBook2, IconPlus } from '@tabler/icons-react';
import * as XLSX from 'xlsx';
import ConjointSimulator from './ConjointSimulator';
import ConjointAIWorkflow from './ConjointAIWorkflow';
import AIConjointSimulator from './AIConjointSimulator';

const BRAND_ORANGE = '#D14A2D';
const BRAND_ORANGE_LIGHT = '#FDE6DE';
const BRAND_ORANGE_BORDER = '#F3B29D';
const BRAND_GRAY = '#5D5F62';

interface ConjointProjectsProps {
  projects?: any[];
  onNavigateToProject?: (project: any) => void;
  onCreateProject?: () => void;
}

type AttributeRecord = Record<string, string | number>;

type NormalizedAttribute = {
  code: string;
  attributeNo: string;
  attributeText: string;
  levelNo: string;
  levelText: string;
};

type AttributeGroupLevel = {
  code: string;
  text: string;
  levelNo: number | null;
};

type AttributeGroup = {
  key: string;
  attributeNo: string;
  label: string;
  levels: AttributeGroupLevel[];
  levelCount: number;
};

type DesignCoverageLevel = {
  levelText: string;
  count: number;
};

type DesignCoverageEntry = {
  attributeNo: string;
  attributeText: string;
  total: number;
  levels: DesignCoverageLevel[];
};

type VersionSummary = {
  version: string;
  taskCount: number;
  minConceptsPerTask: number;
  maxConceptsPerTask: number;
  avgConceptsPerTask: number;
};

type DesignSummary = {
  attColumnCount: number;
  attColumns: string[];
  totalRows: number;
  versions: VersionSummary[];
  attributeCoverage: DesignCoverageEntry[];
};

type MarketShareProduct = {
  name: string;
  currentShare: number;
  newShare?: number;
};

type SurveySummary = {
  totalRespondents: number;
  tasksPerRespondent: number;
  choiceColumns: string[];
  versionCounts: Array<{ version: string; count: number }>;
  uniqueCodesInSurvey: string[];
  unmatchedCodes: string[];
  marketShareProducts?: MarketShareProduct[];
};

type EstimationSchemaAttribute = {
  name: string;
  levels: string[];
  reference?: string | null;
  label?: string | null;
};

type EstimationSchema = {
  attributes: EstimationSchemaAttribute[];
};

type EstimationUtilities = Record<string, Record<string, number>> | null;

type EstimationResult = {
  utilities: EstimationUtilities;
  intercept: number | null;
  diagnostics: Record<string, any>;
  warnings: string[];
  estimatedAt: string;
  schema: EstimationSchema | null;
  columns: string[];
};

const normalizeKey = (value: string) => value.replace(/\s+/g, '').toLowerCase();

const pickValue = (record: AttributeRecord, candidates: string[]): string => {
  for (const key of Object.keys(record)) {
    const normalizedKey = normalizeKey(key);
    for (const candidate of candidates) {
      if (normalizedKey === normalizeKey(candidate)) {
        const rawValue = record[key];
        if (rawValue === undefined || rawValue === null) {
          return '';
        }
        return String(rawValue).trim();
      }
    }
  }
  return '';
};

const getNormalizedMethodology = (project: any) => {
  const potentialValues = [
    project?.methodologyType,
    project?.methodology,
    project?.methodologyName,
    project?.methodologyLabel,
    project?.methodologyDetails?.name,
    project?.researchMethodology
  ];

  const normalized = potentialValues
    .filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
    .map(value => value.trim().toLowerCase());

  for (const value of normalized) {
    if (value.includes('conjoint') || value.includes('maxdiff') || value.includes('choice')) {
      return value;
    }
  }

  return normalized.length > 0 ? normalized[0] : '';
};

const isConjointProject = (project: any) => {
  const methodology = getNormalizedMethodology(project);

  if (!methodology) {
    // Check tags as a fallback
    const tags: string[] = Array.isArray(project?.tags) ? project.tags : [];
    return tags.some(tag =>
      typeof tag === 'string' &&
      ['conjoint', 'cbc', 'choice', 'maxdiff', 'choice-based', 'choice modelling', 'choice modeling'].some(keyword =>
        tag.toLowerCase().includes(keyword)
      )
    );
  }

  return [
    'conjoint',
    'cbc',
    'choice-based',
    'choice based',
    'conjoint analysis',
    'choice modeling',
    'choice modelling',
    'maxdiff',
    'max diff'
  ].some(keyword => methodology.includes(keyword));
};

const isArchivedFlag = (value: any) => {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (normalized === '') return false;
    return ['true', '1', 'yes', 'y', 'archived'].includes(normalized);
  }
  if (typeof value === 'number') {
    return value !== 0;
  }
  return false;
};

const formatDate = (value?: string | null) => {
  if (!value) return 'N/A';
  try {
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) {
      return 'N/A';
    }
    return parsed.toLocaleDateString(undefined, { month: 'numeric', day: 'numeric', year: '2-digit' });
  } catch {
    return 'N/A';
  }
};

const getClientName = (project: any) => {
  if (!project) return 'N/A';
  if (typeof project.client === 'string' && project.client.trim().length > 0) {
    return project.client;
  }
  if (project.client?.name) {
    return project.client.name;
  }
  if (typeof project.clientName === 'string' && project.clientName.trim().length > 0) {
    return project.clientName;
  }
  return 'N/A';
};

const getTeamSummary = (project: any) => {
  const members: any[] = Array.isArray(project?.teamMembers) ? project.teamMembers : [];
  if (!members.length) return 'Unassigned';
  const labels = members.map(member => member?.name || member?.email).filter(Boolean);
  if (!labels.length) return 'Unassigned';
  if (labels.length <= 3) return labels.join(', ');
  return `${labels.slice(0, 3).join(', ')} +${labels.length - 3}`;
};

const getConjointWorkflowCount = (project: any) => {
  if (!project) return 0;
  if (Array.isArray(project.conjointWorkflows)) {
    return project.conjointWorkflows.length;
  }
  if (Array.isArray(project.analyses)) {
    return project.analyses.filter((analysis: any) =>
      String(analysis?.type || '').toLowerCase().includes('conjoint')
    ).length;
  }
  if (typeof project.conjointAnalysisCount === 'number') {
    return project.conjointAnalysisCount;
  }
  if (project?.metadata?.conjointAnalysisCount) {
    return project.metadata.conjointAnalysisCount;
  }
  return 0;
};

export default function ConjointProjects({
  projects = [],
  onNavigateToProject,
  onCreateProject
}: ConjointProjectsProps) {
  const { user } = useAuth();

  const [archivedProjects, setArchivedProjects] = useState<any[]>([]);
  const [loadingArchived, setLoadingArchived] = useState(false);
  const [activeTab, setActiveTab] = useState<'active' | 'archived'>('active');
  const [showMyProjectsOnly, setShowMyProjectsOnly] = useState(false);
  const [viewMode, setViewMode] = useState<'home' | 'project'>('home');
  const [selectedProject, setSelectedProject] = useState<any | null>(null);
  const [workflowViewMode, setWorkflowViewMode] = useState<'list' | 'wizard' | 'simulator' | 'ai-workflow'>('list');
  const [selectedWorkflow, setSelectedWorkflow] = useState<any | null>(null);
  const [showWorkflowWizard, setShowWorkflowWizard] = useState(false);
  const [workflowWizardStep, setWorkflowWizardStep] = useState(1);
  const [workflowDesignFile, setWorkflowDesignFile] = useState<File | null>(null);
  const [attributeDataset, setAttributeDataset] = useState<AttributeRecord[]>([]);
  const [normalizedAttributes, setNormalizedAttributes] = useState<NormalizedAttribute[]>([]);
  const [designMatrix, setDesignMatrix] = useState<AttributeRecord[]>([]);
  const [designSummary, setDesignSummary] = useState<DesignSummary | null>(null);
  const [designIssues, setDesignIssues] = useState<string[]>([]);
  const [wizardError, setWizardError] = useState<string | null>(null);
  const [isParsingDesign, setIsParsingDesign] = useState(false);
  const [isSavingWorkflow, setIsSavingWorkflow] = useState(false);
  const [saveWorkflowError, setSaveWorkflowError] = useState<string | null>(null);
  const [saveWorkflowSuccess, setSaveWorkflowSuccess] = useState<{ workflowId: string; savedAt: string } | null>(null);
  const [projectWorkflows, setProjectWorkflows] = useState<Array<{
    id: string;
    createdAt: string;
    updatedAt?: string | null;
    warnings: string[];
    sourceFileName?: string | null;
    surveyUploadedAt?: string | null;
    surveySummary?: SurveySummary | null;
    estimationResult?: EstimationResult | null;
  }>>([]);
  const [loadingProjectWorkflows, setLoadingProjectWorkflows] = useState(false);
  const [loadProjectWorkflowsError, setLoadProjectWorkflowsError] = useState<string | null>(null);
  const [activeWorkflowId, setActiveWorkflowId] = useState<string | null>(null);
  const [surveyFile, setSurveyFile] = useState<File | null>(null);
  const [isUploadingSurvey, setIsUploadingSurvey] = useState(false);
  const [surveyError, setSurveyError] = useState<string | null>(null);
  const [surveySummary, setSurveySummary] = useState<SurveySummary | null>(null);
  const [surveyWarnings, setSurveyWarnings] = useState<string[]>([]);
  const [estimationResult, setEstimationResult] = useState<EstimationResult | null>(null);
  const [estimationError, setEstimationError] = useState<string | null>(null);
  const [isEstimating, setIsEstimating] = useState(false);
  const [showSimulator, setShowSimulator] = useState(false);
  const [expandedAttributes, setExpandedAttributes] = useState<Record<string, boolean>>({});
  const attributeGroups = useMemo<AttributeGroup[]>(() => {
    if (!normalizedAttributes.length) {
      return [];
    }

    const toNumber = (value: string) => {
      if (!value) {
        return null;
      }
      const parsed = Number(value);
      return Number.isFinite(parsed) ? parsed : null;
    };

    const groups = new Map<
      string,
      {
        key: string;
        attributeNo: string;
        label: string;
        levels: AttributeGroupLevel[];
      }
    >();

    normalizedAttributes.forEach((attr, index) => {
      const attributeNo = typeof attr.attributeNo === 'string' ? attr.attributeNo.trim() : String(attr.attributeNo || '').trim();
      const label = (attr.attributeText && attr.attributeText.trim()) || attr.code?.trim() || `Attribute ${index + 1}`;
      const key = attributeNo || label || attr.code?.trim() || `attribute-${index}`;

      let group = groups.get(key);
      if (!group) {
        group = {
          key,
          attributeNo,
          label,
          levels: []
        };
        groups.set(key, group);
      }

      const levelText = attr.levelText?.trim() || '';
      const levelCode = attr.code?.trim() || '';

      let levelNo: number | null = null;
      if (attr.levelNo !== undefined && attr.levelNo !== null && String(attr.levelNo).trim() !== '') {
        const parsedLevelNo = Number(attr.levelNo);
        levelNo = Number.isFinite(parsedLevelNo) ? parsedLevelNo : null;
      }

      const exists = group.levels.some(
        level =>
          (level.text && levelText && level.text.toLowerCase() === levelText.toLowerCase()) ||
          (level.code && levelCode && level.code === levelCode)
      );

      if (!exists) {
        group.levels.push({
          code: levelCode,
          text: levelText || levelCode || '',
          levelNo
        });
      }
    });

    const orderedGroups = Array.from(groups.values())
      .map(group => {
        const sortedLevels = [...group.levels].sort((a, b) => {
          if (a.levelNo !== null && b.levelNo !== null && a.levelNo !== b.levelNo) {
            return a.levelNo - b.levelNo;
          }
          if (a.levelNo !== null && b.levelNo === null) {
            return -1;
          }
          if (a.levelNo === null && b.levelNo !== null) {
            return 1;
          }
          if (a.text.toLowerCase() !== b.text.toLowerCase()) {
            return a.text.toLowerCase().localeCompare(b.text.toLowerCase());
          }
          return a.code.localeCompare(b.code);
        });

        return {
          key: group.key,
          attributeNo: group.attributeNo,
          label: group.label,
          levels: sortedLevels,
          levelCount: sortedLevels.length
        };
      })
      .sort((a, b) => {
        const numA = toNumber(a.attributeNo);
        const numB = toNumber(b.attributeNo);
        if (numA !== null && numB !== null && numA !== numB) {
          return numA - numB;
        }
        if (a.attributeNo && b.attributeNo && a.attributeNo !== b.attributeNo) {
          return a.attributeNo.localeCompare(b.attributeNo);
        }
        if (a.label.toLowerCase() !== b.label.toLowerCase()) {
          return a.label.toLowerCase().localeCompare(b.label.toLowerCase());
        }
        return a.key.localeCompare(b.key);
      });

    return orderedGroups;
  }, [normalizedAttributes]);
  const designHeaders = useMemo(
    () => (designMatrix.length > 0 ? Object.keys(designMatrix[0]) : []),
    [designMatrix]
  );
  useEffect(() => {
    if (!attributeGroups.length) {
      setExpandedAttributes(prev => {
        if (Object.keys(prev).length === 0) {
          return prev;
        }
        return {};
      });
      return;
    }

    setExpandedAttributes(prev => {
      const next: Record<string, boolean> = {};
      attributeGroups.forEach((group, index) => {
        const hasExisting = Object.prototype.hasOwnProperty.call(prev, group.key);
        next[group.key] = hasExisting ? prev[group.key] : index === 0;
      });

      const prevKeys = Object.keys(prev);
      let changed = prevKeys.length !== attributeGroups.length;
      if (!changed) {
        for (const key of Object.keys(next)) {
          if (prev[key] !== next[key]) {
            changed = true;
            break;
          }
        }
      }

      return changed ? next : prev;
    });
  }, [attributeGroups]);
  const getPrimaryButtonClass = useCallback(
    (disabled: boolean) =>
      `rounded-lg px-5 py-2 text-sm font-semibold transition-opacity ${
        disabled ? 'text-gray-600 cursor-not-allowed' : 'text-white hover:opacity-90'
      }`,
    []
  );
  const getPrimaryButtonStyle = useCallback(
    (disabled: boolean) => ({
      backgroundColor: disabled ? '#E5E7EB' : BRAND_ORANGE
    }),
    []
  );
  const designPreview = useMemo(
    () => designMatrix.slice(0, Math.min(designMatrix.length, 6)),
    [designMatrix]
  );
  const formattedUtilities = useMemo(() => {
    if (!estimationResult?.utilities) {
      return [];
    }

    const schemaAttributes = estimationResult.schema?.attributes || [];
    const utilitiesMap = estimationResult.utilities || {};

    const sourceAttributes = schemaAttributes.length
      ? schemaAttributes
      : Object.keys(utilitiesMap)
          .sort((a, b) => a.localeCompare(b))
          .map(name => ({
            name,
            label: name,
            levels: Object.keys(utilitiesMap[name] || []),
            reference: null
          }));

    return sourceAttributes
      .map(attribute => {
        const levelMap = utilitiesMap[attribute.name] || {};
        const baseRows = Object.entries(levelMap).map(([level, value]) => ({
          level,
          value: Number(value),
          isReference: false
        }));
        const rows = [...baseRows];
        const schemaLevels = Array.isArray(attribute.levels) ? attribute.levels : [];
        const referenceLevel =
          attribute.reference ||
          (schemaLevels.length ? schemaLevels[schemaLevels.length - 1] : null);

        if (referenceLevel && !rows.some(row => row.level === referenceLevel)) {
          const referenceValue = -rows.reduce((sum, row) => sum + row.value, 0);
          rows.push({
            level: referenceLevel,
            value: referenceValue,
            isReference: true
          });
        }

        const seen = new Set<string>();
        const orderedRows: Array<{ level: string; value: number; isReference: boolean }> = [];

        if (schemaLevels.length) {
          schemaLevels.forEach(level => {
            const match = rows.find(row => row.level === level);
            if (match) {
              orderedRows.push({ ...match, isReference: match.isReference || level === referenceLevel });
              seen.add(level);
            }
          });
        }

        rows.forEach(row => {
          if (!seen.has(row.level)) {
            orderedRows.push({ ...row });
            seen.add(row.level);
          }
        });

        return {
          name: attribute.name,
          label: attribute.label || attribute.name,
          rows: orderedRows
        };
      })
      .filter(attribute => attribute.rows.length > 0);
  }, [estimationResult]);
  const totalWizardSteps = 4;
  const formatNumber = useCallback((value: unknown, digits = 4) => {
    if (value === null || value === undefined) {
      return '—';
    }
    const num = Number(value);
    if (!Number.isFinite(num)) {
      return '—';
    }
    return num.toFixed(digits);
  }, []);
  const estimationDiagnostics = useMemo(() => {
    if (!estimationResult?.diagnostics) {
      return [];
    }

    const diag = estimationResult.diagnostics;
    const entries: Array<{ label: string; value: string }> = [];

    if (diag.pseudo_r2 !== undefined) {
      entries.push({ label: 'Pseudo R^2', value: formatNumber(diag.pseudo_r2, 3) });
    }
    if (diag.log_likelihood !== undefined) {
      entries.push({ label: 'Log likelihood', value: formatNumber(diag.log_likelihood, 2) });
    }
    if (diag.null_log_likelihood !== undefined) {
      entries.push({ label: 'Null log likelihood', value: formatNumber(diag.null_log_likelihood, 2) });
    }
    if (diag.aic !== undefined) {
      entries.push({ label: 'AIC', value: formatNumber(diag.aic, 1) });
    }
    if (diag.bic !== undefined) {
      entries.push({ label: 'BIC', value: formatNumber(diag.bic, 1) });
    }
    if (diag.n_observations !== undefined) {
      entries.push({ label: 'Observations', value: formatNumber(diag.n_observations, 0) });
    }
    if (diag.n_parameters !== undefined) {
      entries.push({ label: 'Parameters', value: formatNumber(diag.n_parameters, 0) });
    }
    if (diag.iterations !== undefined) {
      entries.push({ label: 'Iterations', value: formatNumber(diag.iterations, 0) });
    }
    if (diag.method) {
      entries.push({ label: 'Method', value: String(diag.method) });
    }
    if (diag.converged !== undefined) {
      entries.push({ label: 'Converged', value: diag.converged ? 'Yes' : 'No' });
    }

    return entries;
  }, [estimationResult, formatNumber]);
  const interceptDisplay =
    estimationResult?.intercept !== null && estimationResult?.intercept !== undefined
      ? formatNumber(estimationResult.intercept, 4)
      : '—';
  const estimationTimestamp = estimationResult?.estimatedAt
    ? new Date(estimationResult.estimatedAt).toLocaleString()
    : null;
  const canLaunchSimulator = Boolean(
    estimationResult?.utilities && estimationResult?.schema?.attributes && estimationResult.schema.attributes.length > 0
  );
  const stepOneDisabled =
    attributeDataset.length === 0 || designMatrix.length === 0 || !!wizardError || isParsingDesign;
  const saveDraftDisabled = isSavingWorkflow;
  const validateSurveyDisabled = !surveyFile || isUploadingSurvey || !activeWorkflowId;
  const estimateDisabled = !surveySummary || isEstimating || !activeWorkflowId;

  useEffect(() => {
    if (!user?.id) {
      setArchivedProjects([]);
      return;
    }

    let cancelled = false;

    const fetchArchived = async () => {
      try {
        setLoadingArchived(true);
        const response = await fetch(`${API_BASE_URL}/api/projects/archived?userId=${user.id}`, {
          headers: { Authorization: `Bearer ${localStorage.getItem('cognitive_dash_token')}` }
        });

        if (!response.ok) {
          throw new Error(`Archived projects request failed with status ${response.status}`);
        }

        const data = await response.json();
        if (!cancelled) {
          const archivedList = Array.isArray(data?.projects) ? data.projects : [];
          setArchivedProjects(archivedList);
        }
      } catch (error) {
        if (!cancelled) {
          console.error('Failed to load archived projects for Conjoint view:', error);
          setArchivedProjects([]);
        }
      } finally {
        if (!cancelled) {
          setLoadingArchived(false);
        }
      }
    };

    fetchArchived();
    return () => {
      cancelled = true;
    };
  }, [user?.id]);

  const filterProjectsByUser = useCallback(
    (list: any[]) => {
      if (!showMyProjectsOnly || !user) return list;

      const uid = String((user as any)?.id || '').toLowerCase();
      const uemail = String((user as any)?.email || '').toLowerCase();
      const uname = String((user as any)?.name || '').toLowerCase();

      return list.filter(project => {
        const createdBy = String(project?.createdBy || '').toLowerCase();
        const createdByMe = createdBy && (createdBy === uid || createdBy === uemail);

        const teamMembers = Array.isArray(project?.teamMembers) ? project.teamMembers : [];
        const inTeam = teamMembers.some((member: any) => {
          const mid = String(member?.id || '').toLowerCase();
          const memail = String(member?.email || '').toLowerCase();
          const mname = String(member?.name || '').toLowerCase();
          return (uid && mid === uid) || (uemail && memail === uemail) || (uname && mname === uname);
        });

        return createdByMe || inTeam;
      });
    },
    [showMyProjectsOnly, user]
  );

  const conjointActiveProjects = useMemo(() => {
    return projects.filter(project => !isArchivedFlag(project?.archived) && isConjointProject(project));
  }, [projects]);

  const conjointArchivedProjects = useMemo(() => {
    return archivedProjects.filter(project => isConjointProject(project));
  }, [archivedProjects]);

  const filteredActiveProjects = useMemo(
    () => filterProjectsByUser(conjointActiveProjects),
    [filterProjectsByUser, conjointActiveProjects]
  );

  const filteredArchivedProjects = useMemo(
    () => filterProjectsByUser(conjointArchivedProjects),
    [filterProjectsByUser, conjointArchivedProjects]
  );

  const displayProjects = activeTab === 'archived' ? filteredArchivedProjects : filteredActiveProjects;
  const showSpinner = activeTab === 'archived' && loadingArchived;

  const loadProjectWorkflowDrafts = useCallback(async (projectId: string) => {
    setLoadingProjectWorkflows(true);
    setLoadProjectWorkflowsError(null);
    try {
      const token = typeof window !== 'undefined' ? localStorage.getItem('cognitive_dash_token') : null;
      const response = await fetch(`${API_BASE_URL}/api/conjoint/workflows?projectId=${encodeURIComponent(projectId)}`, {
        headers: {
          ...(token ? { Authorization: `Bearer ${token}` } : {})
        }
      });
      if (!response.ok) {
        let detail = 'Failed to load workflow drafts.';
        try {
          const payload = await response.json();
          if (payload?.detail) {
            detail = payload.detail;
          }
        } catch {
          // ignore parse errors
        }
        throw new Error(detail);
      }

      const data = await response.json();
      const workflows = Array.isArray(data?.workflows) ? data.workflows : [];
      setProjectWorkflows(
        workflows.map((draft: any) => ({
          id: draft?.id,
          createdAt: draft?.createdAt || draft?.updatedAt || '',
          updatedAt: draft?.updatedAt || null,
          warnings: Array.isArray(draft?.warnings) ? draft.warnings : [],
          sourceFileName: draft?.sourceFileName || null,
          surveyUploadedAt: draft?.survey?.uploadedAt || null,
          surveySummary: draft?.survey?.summary || null,
          aiGenerated: draft?.aiGenerated || false,
          aiAnalysis: draft?.aiAnalysis || null,
          estimationResult: draft?.estimation
            ? {
                utilities: draft.estimation.utilities || null,
                intercept:
                  draft.estimation.intercept !== undefined && draft.estimation.intercept !== null
                    ? Number(draft.estimation.intercept)
                    : null,
                diagnostics: draft.estimation.diagnostics || {},
                warnings: Array.isArray(draft.estimation.warnings) ? draft.estimation.warnings : [],
                estimatedAt:
                  draft.estimation.estimatedAt ||
                  draft.updatedAt ||
                  draft.createdAt ||
                  new Date().toISOString(),
                schema: draft.estimation.schema || null,
                columns: Array.isArray(draft.estimation.columns) ? draft.estimation.columns : []
              }
            : null
        }))
      );
    } catch (error) {
      console.error('Failed to load workflow drafts:', error);
      setProjectWorkflows([]);
      setLoadProjectWorkflowsError(error instanceof Error ? error.message : 'Failed to load workflow drafts.');
    } finally {
      setLoadingProjectWorkflows(false);
    }
  }, []);

  const resetWorkflowWizard = useCallback(() => {
    setWorkflowWizardStep(1);
    setWorkflowDesignFile(null);
    setAttributeDataset([]);
    setNormalizedAttributes([]);
    setDesignMatrix([]);
    setDesignSummary(null);
    setDesignIssues([]);
    setWizardError(null);
    setIsParsingDesign(false);
    setIsSavingWorkflow(false);
    setSaveWorkflowError(null);
    setSaveWorkflowSuccess(null);
    setActiveWorkflowId(null);
    setSurveyFile(null);
    setSurveySummary(null);
    setSurveyWarnings([]);
    setSurveyError(null);
    setIsUploadingSurvey(false);
    setEstimationResult(null);
    setEstimationError(null);
    setIsEstimating(false);
    setShowSimulator(false);
  }, []);

  useEffect(() => {
    if (!showWorkflowWizard) {
      resetWorkflowWizard();
    }
  }, [showWorkflowWizard, resetWorkflowWizard]);

  useEffect(() => {
    if (viewMode === 'project' && selectedProject?.id) {
      loadProjectWorkflowDrafts(selectedProject.id);
    } else {
      setProjectWorkflows([]);
      setLoadProjectWorkflowsError(null);
    }
  }, [viewMode, selectedProject?.id, loadProjectWorkflowDrafts]);

  const openWorkflowWizard = useCallback(() => {
    // Manual workflow wizard is disabled - only AI workflow is available
    alert('Manual workflow creation is currently disabled. Please use the AI Workflow option above.');
    return;
    resetWorkflowWizard();
    setShowWorkflowWizard(true);
  }, [resetWorkflowWizard]);

  const closeWorkflowWizard = useCallback(() => {
    setShowWorkflowWizard(false);
    setShowSimulator(false);
  }, []);

  const handleDesignFile = useCallback(async (file: File | null) => {
    if (!file) {
      setWorkflowDesignFile(null);
      setAttributeDataset([]);
      setNormalizedAttributes([]);
      setDesignMatrix([]);
      setDesignSummary(null);
      setDesignIssues([]);
      setWizardError(null);
      setSaveWorkflowError(null);
      setSaveWorkflowSuccess(null);
      return;
    }

    setIsParsingDesign(true);
    setWizardError(null);

    try {
      const buffer = await file.arrayBuffer();
      const workbook = XLSX.read(buffer, { type: 'array' });
      const attributesSheet =
        workbook.Sheets['Attributes'] ||
        workbook.Sheets['attributes'] ||
        workbook.Sheets['ATTRIBUTES'];

      if (!attributesSheet) {
        throw new Error('The workbook needs an "Attributes" sheet (case-sensitive).');
      }

      const rawAttributeRows = XLSX.utils.sheet_to_json<AttributeRecord>(attributesSheet, {
        defval: '',
        raw: false
      });

      const cleanedAttributes = rawAttributeRows.filter(row =>
        Object.values(row || {}).some(value => {
          if (value === null || value === undefined) return false;
          if (typeof value === 'string') return value.trim().length > 0;
          return true;
        })
      );

      if (!cleanedAttributes.length) {
        throw new Error('The Attributes sheet appears to be empty.');
      }

      const normalizedAttributes = cleanedAttributes
        .map(row => ({
          code: pickValue(row, ['CODE']),
          attributeNo: pickValue(row, ['ATTRIBUTE NO', 'ATTRIBUTENO']),
          attributeText: pickValue(row, ['ATTRIBUTE TEXT', 'ATTRIBUTETEXT', 'ATTRIBUTE']),
          levelNo: pickValue(row, ['LEVEL NO', 'LEVELNO']),
          levelText: pickValue(row, ['LEVEL TEXT', 'LEVELTEXT'])
        }))
        .filter(entry => entry.code && entry.attributeText && entry.levelText);

      if (!normalizedAttributes.length) {
        throw new Error('Could not normalize attribute rows. Please verify the column headers match the template.');
      }

      const designSheet =
        workbook.Sheets['Design'] ||
        workbook.Sheets['design'] ||
        workbook.Sheets['DESIGN'];

      if (!designSheet) {
        throw new Error('The workbook needs a "Design" sheet (case-sensitive).');
      }

      const rawDesignRows = XLSX.utils.sheet_to_json<AttributeRecord>(designSheet, {
        defval: '',
        raw: false
      });

      if (!rawDesignRows.length) {
        throw new Error('The Design sheet appears to be empty.');
      }

      const attColumns = Object.keys(rawDesignRows[0] || {}).filter(key => /^att\d+$/i.test(normalizeKey(key)));

      if (!attColumns.length) {
        throw new Error('The Design sheet must include columns named Att1, Att2, ... representing concept positions.');
      }

      const designRows = rawDesignRows.filter(row =>
        attColumns.some(column => {
          const value = row[column];
          return value !== undefined && value !== null && String(value).trim() !== '';
        })
      );

      if (!designRows.length) {
        throw new Error('The Design sheet does not contain any data rows.');
      }

      const attributeLookup = new Map<string, NormalizedAttribute>();
      normalizedAttributes.forEach(attr => {
        attributeLookup.set(String(attr.code).trim(), attr);
      });

      const coverageMap = new Map<
        string,
        {
          attributeNo: string;
          attributeText: string;
          levels: Map<string, number>;
        }
      >();

      normalizedAttributes.forEach(attr => {
        const key = attr.attributeNo || attr.attributeText || attr.code;
        let entry = coverageMap.get(key);
        if (!entry) {
          entry = {
            attributeNo: attr.attributeNo,
            attributeText: attr.attributeText || `Attribute ${attr.attributeNo || key}`,
            levels: new Map<string, number>()
          };
          coverageMap.set(key, entry);
        }
        const levelLabel = attr.levelText || `Level ${attr.levelNo || attr.code}`;
        if (!entry.levels.has(levelLabel)) {
          entry.levels.set(levelLabel, 0);
        }
      });

      const versionTaskConceptMap = new Map<string, Map<string, Set<string>>>();
      const missingCodes = new Set<string>();

      designRows.forEach((row, index) => {
        const versionValue = pickValue(row, ['Version']);
        const versionKey = versionValue || '1';
        let taskMap = versionTaskConceptMap.get(versionKey);
        if (!taskMap) {
          taskMap = new Map<string, Set<string>>();
          versionTaskConceptMap.set(versionKey, taskMap);
        }

        const taskValue = pickValue(row, ['Task']);
        const taskKey = taskValue || `Task ${index + 1}`;
        let conceptSet = taskMap.get(taskKey);
        if (!conceptSet) {
          conceptSet = new Set<string>();
          taskMap.set(taskKey, conceptSet);
        }

        const conceptValue = pickValue(row, ['Concept']);
        if (conceptValue) {
          conceptSet.add(conceptValue);
        }

        attColumns.forEach(column => {
          const rawValue = row[column];
          if (rawValue === undefined || rawValue === null) return;
          const codeKey = String(rawValue).trim();
          if (!codeKey) return;

          const attributeMeta = attributeLookup.get(codeKey);
          if (!attributeMeta) {
            missingCodes.add(codeKey);
            return;
          }

          const coverageKey = attributeMeta.attributeNo || attributeMeta.attributeText || attributeMeta.code;
          const coverageEntry = coverageMap.get(coverageKey);
          if (!coverageEntry) {
            return;
          }

          const levelLabel = attributeMeta.levelText || `Level ${attributeMeta.levelNo || attributeMeta.code}`;
          coverageEntry.levels.set(levelLabel, (coverageEntry.levels.get(levelLabel) || 0) + 1);
        });
      });

      const attributeCoverage: DesignCoverageEntry[] = Array.from(coverageMap.values()).map(entry => {
        const levels = Array.from(entry.levels.entries()).map(([levelText, count]) => ({
          levelText,
          count
        }));
        const total = levels.reduce((sum, level) => sum + level.count, 0);
        return {
          attributeNo: entry.attributeNo,
          attributeText: entry.attributeText,
          total,
          levels
        };
      });

      attributeCoverage.sort((a, b) => {
        const aNo = parseInt(a.attributeNo || '', 10);
        const bNo = parseInt(b.attributeNo || '', 10);
        if (!Number.isNaN(aNo) && !Number.isNaN(bNo) && aNo !== bNo) {
          return aNo - bNo;
        }
        return a.attributeText.localeCompare(b.attributeText);
      });

      const versionSummaries: VersionSummary[] = Array.from(versionTaskConceptMap.entries()).map(
        ([version, taskMap]) => {
          const conceptCounts = Array.from(taskMap.values()).map(set => set.size || 0);
          const taskCount = taskMap.size;
          const minConcepts = conceptCounts.length ? Math.min(...conceptCounts) : 0;
          const maxConcepts = conceptCounts.length ? Math.max(...conceptCounts) : 0;
          const avgConcepts = conceptCounts.length
            ? Number((conceptCounts.reduce((sum, count) => sum + count, 0) / conceptCounts.length).toFixed(2))
            : 0;

          return {
            version,
            taskCount,
            minConceptsPerTask: minConcepts,
            maxConceptsPerTask: maxConcepts,
            avgConceptsPerTask: avgConcepts
          };
        }
      );

      versionSummaries.sort((a, b) => a.version.localeCompare(b.version, undefined, { numeric: true }));

      const issues: string[] = [];

      versionSummaries.forEach(summary => {
        if (summary.taskCount === 0) {
          issues.push(`Version ${summary.version} does not contain any tasks.`);
        }
        if (summary.minConceptsPerTask !== summary.maxConceptsPerTask) {
          issues.push(
            `Version ${summary.version} has inconsistent concept counts across tasks (min ${summary.minConceptsPerTask}, max ${summary.maxConceptsPerTask}).`
          );
        }
      });

      if (missingCodes.size > 0) {
        const missingList = Array.from(missingCodes).sort();
        const preview = missingList.slice(0, 15).join(', ');
        const suffix = missingList.length > 15 ? '...' : '';
        issues.push(
          `Design references ${missingList.length} code(s) not found in the attribute sheet: ${preview}${suffix}`
        );
      }

      const unusedLevels = attributeCoverage
        .flatMap(entry =>
          entry.levels
            .filter(level => level.count === 0)
            .map(level => `${entry.attributeText} - ${level.levelText}`)
        );

      if (unusedLevels.length) {
        const preview = unusedLevels.slice(0, 10).join('; ');
        const suffix = unusedLevels.length > 10 ? '...' : '';
        issues.push(`The design never uses ${unusedLevels.length} level(s): ${preview}${suffix}`);
      }

      setWorkflowDesignFile(file);
      setAttributeDataset(cleanedAttributes);
      setNormalizedAttributes(normalizedAttributes);
      setDesignMatrix(designRows);
      setDesignSummary({
        attColumnCount: attColumns.length,
        attColumns,
        totalRows: designRows.length,
        versions: versionSummaries,
        attributeCoverage
      });
      setDesignIssues(issues);
      setSaveWorkflowError(null);
      setSaveWorkflowSuccess(null);
    } catch (error) {
      console.error('Failed to parse design file:', error);
      setWorkflowDesignFile(null);
      setAttributeDataset([]);
      setNormalizedAttributes([]);
      setDesignMatrix([]);
      setDesignSummary(null);
      setDesignIssues([]);
      setWizardError(
        error instanceof Error
          ? error.message
          : 'Could not read the design file. Please make sure it is a valid Excel workbook.'
      );
    } finally {
      setIsParsingDesign(false);
    }
  }, []);

  const handleSaveWorkflowDraft = useCallback(async () => {
    if (!selectedProject || !selectedProject.id) {
      setSaveWorkflowError('Select a project before saving the workflow draft.');
      return;
    }

    if (!normalizedAttributes.length || !designMatrix.length || !designSummary) {
      setSaveWorkflowError('Upload a valid attribute list and design matrix before saving.');
      return;
    }

    setIsSavingWorkflow(true);
    setSaveWorkflowError(null);
    setSaveWorkflowSuccess(null);

    try {
      const token = typeof window !== 'undefined' ? localStorage.getItem('cognitive_dash_token') : null;
      const response = await fetch(`${API_BASE_URL}/api/conjoint/workflows`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {})
        },
        body: JSON.stringify({
          projectId: selectedProject.id,
          attributes: normalizedAttributes,
          designMatrix,
          designSummary,
          warnings: designIssues,
          sourceFileName: workflowDesignFile?.name || null
        })
      });

      if (!response.ok) {
        let detail = 'Failed to save workflow draft.';
        try {
          const payload = await response.json();
          if (payload?.detail) {
            detail = payload.detail;
          } else if (payload?.message) {
            detail = payload.message;
          }
        } catch {
          // ignore parse errors
        }
        throw new Error(detail);
      }

      const data = await response.json();
      setSaveWorkflowSuccess(data);
      setActiveWorkflowId(data?.workflowId || null);
      setSurveyFile(null);
      setSurveySummary(null);
      setSurveyWarnings([]);
      setSurveyError(null);
      setEstimationResult(null);
      setEstimationError(null);
      setIsEstimating(false);
      if (selectedProject?.id) {
        await loadProjectWorkflowDrafts(selectedProject.id);
      }
      setWorkflowWizardStep(3);
    } catch (error) {
      console.error('Failed to save conjoint workflow draft:', error);
      setSaveWorkflowError(error instanceof Error ? error.message : 'Failed to save workflow draft.');
    } finally {
      setIsSavingWorkflow(false);
    }
  }, [
    selectedProject,
    normalizedAttributes,
    designMatrix,
    designSummary,
    designIssues,
    workflowDesignFile,
    loadProjectWorkflowDrafts
  ]);

  const handleSurveyFileChange = useCallback((file: File | null) => {
    setSurveyFile(file);
    setSurveyError(null);
    setSurveySummary(null);
    setSurveyWarnings([]);
    setEstimationResult(null);
    setEstimationError(null);
  }, []);

  const handleUploadSurvey = useCallback(async () => {
    if (!activeWorkflowId) {
      setSurveyError('Save the workflow draft before uploading survey data.');
      return;
    }
    if (!surveyFile) {
      setSurveyError('Choose a survey export workbook to upload.');
      return;
    }

    setIsUploadingSurvey(true);
    setSurveyError(null);
    try {
      const token = typeof window !== 'undefined' ? localStorage.getItem('cognitive_dash_token') : null;
      const formData = new FormData();
      formData.append('file', surveyFile);

      const response = await fetch(
        `${API_BASE_URL}/api/conjoint/workflows/${activeWorkflowId}/survey`,
        {
          method: 'POST',
          headers: {
            ...(token ? { Authorization: `Bearer ${token}` } : {})
          },
          body: formData
        }
      );

      if (!response.ok) {
        let detail = 'Failed to validate survey export.';
        try {
          const payload = await response.json();
          if (payload?.detail) {
            detail = payload.detail;
          } else if (payload?.message) {
            detail = payload.message;
          }
        } catch {
          // ignore parse errors
        }
        throw new Error(detail);
      }

      const data = await response.json();
      setSurveySummary(data?.summary || null);
      setSurveyWarnings(Array.isArray(data?.warnings) ? data.warnings : []);
      if (selectedProject?.id) {
        await loadProjectWorkflowDrafts(selectedProject.id);
      }
    } catch (error) {
      console.error('Failed to upload conjoint survey export:', error);
      setSurveyError(error instanceof Error ? error.message : 'Failed to validate survey export.');
      setSurveySummary(null);
    } finally {
      setIsUploadingSurvey(false);
    }
  }, [activeWorkflowId, surveyFile, selectedProject?.id, loadProjectWorkflowDrafts]);

  const handleEstimateUtilities = useCallback(async () => {
    if (!activeWorkflowId) {
      setEstimationError('Save the workflow draft before estimating utilities.');
      return;
    }

    setIsEstimating(true);
    setEstimationError(null);
    try {
      const token = typeof window !== 'undefined' ? localStorage.getItem('cognitive_dash_token') : null;

      const response = await fetch(
        `${API_BASE_URL}/api/conjoint/workflows/${activeWorkflowId}/estimate`,
        {
          method: 'POST',
          headers: {
            ...(token ? { Authorization: `Bearer ${token}` } : {})
          }
        }
      );

      if (!response.ok) {
        let detail = 'Failed to Estimate utilities.';
        try {
          const payload = await response.json();
          if (payload?.detail) {
            detail = payload.detail;
          } else if (payload?.message) {
            detail = payload.message;
          }
        } catch {
          // ignore parse errors
        }
        throw new Error(detail);
      }

      const data = await response.json();
      setShowSimulator(false);
      setEstimationResult({
        utilities: data?.utilities || null,
        intercept:
          data?.intercept !== undefined && data?.intercept !== null ? Number(data.intercept) : null,
        diagnostics: data?.diagnostics || {},
        warnings: Array.isArray(data?.warnings) ? data.warnings : [],
        estimatedAt: data?.estimatedAt || new Date().toISOString(),
        schema: data?.schema || null,
        columns: Array.isArray(data?.columns) ? data.columns : []
      });
      if (selectedProject?.id) {
        await loadProjectWorkflowDrafts(selectedProject.id);
      }
    } catch (error) {
      console.error('Failed to Estimate utilities:', error);
      setEstimationError(error instanceof Error ? error.message : 'Failed to Estimate utilities.');
      setEstimationResult(null);
    } finally {
      setIsEstimating(false);
    }
  }, [activeWorkflowId, selectedProject?.id, loadProjectWorkflowDrafts]);

  return (
    <div className="flex-1 p-6 space-y-4 max-w-full overflow-y-auto" style={{ height: 'calc(100vh - 80px)', marginTop: '80px' }}>
      <div className="space-y-3">
        {viewMode === 'home' && (
          <>
            <header>
              <div>
                <h1 className="text-xl font-semibold" style={{ color: BRAND_GRAY }}>Conjoint Projects</h1>
                <p className="mt-1 text-sm text-gray-500">
                  Browse every project that is configured for conjoint and quickly jump into the workflow.
                </p>
              </div>
            </header>

            <div>
              <div className="flex items-center justify-between">
                <nav className="-mb-px flex space-x-8 items-center">
                  <button
                    onClick={() => setActiveTab('active')}
                    className={`py-2 px-1 border-b-2 font-medium text-sm ${
                      activeTab === 'active'
                        ? 'text-white'
                        : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                    }`}
                    style={activeTab === 'active' ? { borderBottomColor: BRAND_ORANGE, color: BRAND_ORANGE } : {}}
                  >
                    Active Projects ({filteredActiveProjects.length})
                  </button>
                  <button
                    onClick={() => setActiveTab('archived')}
                    className={`py-2 px-1 border-b-2 font-medium text-sm ${
                      activeTab === 'archived'
                        ? 'text-white'
                        : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                    }`}
                    style={activeTab === 'archived' ? { borderBottomColor: BRAND_ORANGE, color: BRAND_ORANGE } : {}}
                  >
                    Archived Projects ({filteredArchivedProjects.length})
                  </button>
                </nav>
              </div>
              <div className="border-b border-gray-200"></div>
            </div>

            <div className="bg-white shadow-sm border border-gray-200 rounded-lg overflow-hidden">
              <div className="overflow-x-auto">
                {showSpinner ? (
                  <div className="p-12 text-center">
                    <div className="mx-auto mb-4 h-10 w-10 animate-spin rounded-full border-4 border-gray-200 border-t-[#D14A2D]"></div>
                    <p className="text-sm text-gray-500">Loading archived projects...</p>
                  </div>
                ) : displayProjects.length === 0 ? (
                  <div className="p-12 text-center">
                    <DocumentTextIcon className="mx-auto mb-4 h-16 w-16 text-gray-300" />
                    <h3 className="text-lg font-semibold text-gray-900">
                      {activeTab === 'archived' ? 'No archived conjoint projects' : 'No active conjoint projects'}
                    </h3>
                    <p className="mt-2 text-gray-500">
                      {activeTab === 'archived'
                        ? 'Archived conjoint projects will appear here.'
                        : 'Create a project with a conjoint methodology to get started.'}
                    </p>
                  </div>
                ) : (
                  <table className="min-w-full divide-y divide-gray-200">
                    <thead className="bg-gray-50">
                      <tr>
                        <th className="pl-6 pr-2 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider w-0 whitespace-nowrap">
                          Project
                        </th>
                        <th className="pl-2 pr-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider w-32">
                          Client
                        </th>
                        <th className="px-6 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider w-32">
                          Workflows
                        </th>
                      </tr>
                    </thead>
                    <tbody className="bg-white divide-y divide-gray-200">
                      {displayProjects.map(project => (
                        <tr
                          key={project.id}
                          className="hover:bg-gray-50 cursor-pointer transition-colors"
                          onClick={() => {
                            setSelectedProject(project);
                            setViewMode('project');
                          }}
                        >
                          <td className="pl-6 pr-2 py-4 whitespace-nowrap w-0">
                            <div className="inline-block text-sm font-medium text-gray-900">{project.name}</div>
                            <div className="text-xs text-gray-500 mt-1">
                              {project.methodologyType || project.methodology || 'Conjoint'}
                            </div>
                          </td>
                          <td className="pl-2 pr-6 py-4 whitespace-nowrap w-32">
                            <div className="text-sm text-gray-900 truncate">{getClientName(project)}</div>
                            <div className="text-xs text-gray-500 mt-1">{getTeamSummary(project)}</div>
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap text-center w-32">
                            <div className="flex items-center justify-center gap-1 text-sm text-gray-900">
                              <IconBook2 className="h-4 w-4 text-gray-400" />
                              {getConjointWorkflowCount(project)}
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            </div>
          </>
        )}

        {viewMode === 'project' && selectedProject && (
          <div className="bg-white shadow-sm border border-gray-200 rounded-lg overflow-hidden">
            <div className="px-6 py-4 border-b border-gray-200 bg-gray-50">
              <div className="flex items-center justify-between">
                <button
                  onClick={() => {
                    setViewMode('home');
                    setSelectedProject(null);
                  }}
                  className="flex items-center gap-2 text-sm text-gray-600 hover:text-gray-800 hover:bg-gray-100 px-3 py-1 rounded-lg transition-colors"
                >
                  <ArrowLeftIcon className="h-4 w-4" />
                  Back to Projects
                </button>
              </div>
            </div>

            <div className="px-6 py-6 space-y-6">
              {workflowViewMode === 'ai-workflow' ? (
                <section>
                  <div className="mb-4">
                    <button
                      onClick={() => setWorkflowViewMode('list')}
                      className="flex items-center gap-2 text-sm text-gray-600 hover:text-gray-800 hover:bg-gray-100 px-3 py-1 rounded-lg transition-colors"
                    >
                      <ArrowLeftIcon className="h-4 w-4" />
                      Back to Workflows
                    </button>
                  </div>
                  <ConjointAIWorkflow
                    projectId={selectedProject?.id || ''}
                    onWorkflowCreated={(workflowId) => {
                      loadProjectWorkflowDrafts(selectedProject?.id);
                      setWorkflowViewMode('list');
                    }}
                  />
                </section>
              ) : workflowViewMode === 'simulator' && selectedWorkflow ? (
                <section>
                  <div className="mb-4">
                    <button
                      onClick={() => {
                        setWorkflowViewMode('list');
                        setSelectedWorkflow(null);
                      }}
                      className="flex items-center gap-2 text-sm text-gray-600 hover:text-gray-800 hover:bg-gray-100 px-3 py-1 rounded-lg transition-colors"
                    >
                      <ArrowLeftIcon className="h-4 w-4" />
                      Back to Workflows
                    </button>
                  </div>
                  {selectedWorkflow.aiGenerated ? (
                    <>
                      {console.log('Rendering AIConjointSimulator with workflow:', selectedWorkflow)}
                      <AIConjointSimulator
                        workflow={selectedWorkflow}
                        onClose={() => {
                          setWorkflowViewMode('list');
                          setSelectedWorkflow(null);
                        }}
                      />
                    </>
                  ) : (
                    <>
                      <h3 className="text-sm font-semibold text-gray-700 uppercase tracking-wide mb-3">
                        Simulator - Workflow {selectedWorkflow.id}
                      </h3>
                      <ConjointSimulator
                        embedded
                        initialModel={{
                          intercept:
                            selectedWorkflow.estimationResult?.intercept !== null &&
                            selectedWorkflow.estimationResult?.intercept !== undefined
                              ? Number(selectedWorkflow.estimationResult.intercept)
                              : 0,
                          utilities: selectedWorkflow.estimationResult?.utilities || {},
                          schema: selectedWorkflow.estimationResult?.schema || { attributes: [] }
                        }}
                        currentProducts={selectedWorkflow.surveySummary?.marketShareProducts || []}
                      />
                    </>
                  )}
                </section>
              ) : (() => {
                const workflowCount = projectWorkflows.length;
                const aiWorkflows = projectWorkflows.filter(w => w.aiGenerated);
                const manualWorkflows = projectWorkflows.filter(w => !w.aiGenerated);
                
                return (
                  <>
                    {/* AI Workflow Section */}
                    <section className="rounded-lg border-2 border-blue-200 bg-blue-50 p-5">
                      <div className="flex items-start justify-between mb-3">
                        <div>
                          <h3 className="text-sm font-semibold text-blue-900 uppercase tracking-wide">AI Workflow (Beta)</h3>
                          <p className="text-xs text-blue-700 mt-1">
                            Let AI automatically configure your conjoint workflow from your questionnaire
                          </p>
                        </div>
                        <button
                          onClick={() => setWorkflowViewMode('ai-workflow')}
                          className="px-4 py-2 rounded-lg bg-blue-600 text-white text-sm font-semibold hover:bg-blue-700 transition"
                        >
                          Start AI Workflow
                        </button>
                      </div>
                      
                      {/* AI Workflows List */}
                      {aiWorkflows.length > 0 && (
                        <div className="mt-4 space-y-2">
                          <h4 className="text-sm font-medium text-blue-800">Your AI Workflows:</h4>
                          <div className="space-y-2">
                            {aiWorkflows.map(workflow => (
                              <div
                                key={workflow.id}
                                className="flex items-center justify-between p-3 bg-white rounded-lg border border-blue-200 hover:bg-blue-25 transition-colors cursor-pointer"
                                onClick={() => {
                                  if (workflow.estimationResult) {
                                    setSelectedWorkflow(workflow);
                                    setWorkflowViewMode('simulator');
                                  }
                                }}
                              >
                                <div className="flex-1">
                                  <div className="flex items-center gap-2">
                                    <span className="text-sm font-medium text-gray-900">
                                      AI Workflow {workflow.id}
                                    </span>
                                    {workflow.estimationResult && (
                                      <span className="inline-flex items-center gap-1 rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-700">
                                        <span className="h-2 w-2 rounded-full bg-green-500" />
                                        Ready
                                      </span>
                                    )}
                                    {workflow.aiGenerated && !workflow.estimationResult && (
                                      <span className="inline-flex items-center gap-1 rounded-full bg-blue-100 px-2 py-0.5 text-xs font-medium text-blue-700">
                                        <span className="h-2 w-2 rounded-full bg-blue-500" />
                                        AI Workflow
                                      </span>
                                    )}
                                  </div>
                                  <div className="text-xs text-gray-500 mt-1">
                                    Created {new Date(workflow.createdAt).toLocaleString()}
                                  </div>
                                </div>
                                <div className="flex items-center gap-2">
                                  {/* Show Launch Simulator button for AI workflows - ALWAYS available */}
                                  {workflow.aiGenerated && (
                                    <button
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        console.log('Workflow debug:', {
                                          id: workflow.id,
                                          aiGenerated: workflow.aiGenerated,
                                          temporary: workflow.temporary,
                                          hasAiAnalysis: !!workflow.aiAnalysis,
                                          hasAttributes: !!workflow.aiAnalysis?.attributes,
                                          hasEstimation: !!workflow.estimationResult,
                                          surveyUploaded: !!workflow.surveyUploadedAt
                                        });
                                        
                                        // Always allow launching simulator for AI workflows
                                        // The simulator can handle missing data gracefully
                                        setSelectedWorkflow(workflow);
                                        setWorkflowViewMode('simulator');
                                      }}
                                      className="px-3 py-1 bg-blue-600 text-white text-xs font-semibold rounded hover:bg-blue-700 transition"
                                      title="Launch Simulator"
                                    >
                                      Launch Simulator
                                    </button>
                                  )}
                                  
                                  {/* Upload Data button for AI workflows that need survey data */}
                                  {workflow.aiGenerated && workflow.temporary && !workflow.surveyUploadedAt && (
                                    <button
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        const input = document.createElement('input');
                                        input.type = 'file';
                                        input.accept = '.xlsx,.xls';
                                        input.onchange = async (event) => {
                                          const file = (event.target as HTMLInputElement).files?.[0];
                                          if (!file) return;
                                          
                                          try {
                                            const formData = new FormData();
                                            formData.append('file', file);
                                            formData.append('workflowId', workflow.id);

                                            const token = localStorage.getItem('cognitive_dash_token');
                                            const response = await fetch(`${API_BASE_URL}/api/conjoint/ai-workflow/process-data`, {
                                              method: 'POST',
                                              headers: {
                                                'Authorization': `Bearer ${token}`
                                              },
                                              body: formData
                                            });

                                            if (!response.ok) {
                                              const errorData = await response.json();
                                              throw new Error(errorData.detail || 'Failed to upload survey data');
                                            }

                                            // Refresh the workflow list
                                            loadProjectWorkflowDrafts(selectedProject.id);
                                            alert('Survey data uploaded successfully! You can now launch the simulator.');
                                          } catch (error) {
                                            console.error('Upload error:', error);
                                            alert(`Failed to upload survey data: ${error.message}`);
                                          }
                                        };
                                        input.click();
                                      }}
                                      className="px-3 py-1 bg-purple-600 text-white text-xs font-semibold rounded hover:bg-purple-700 transition"
                                      title="Upload survey data for this workflow"
                                    >
                                      Upload Data
                                    </button>
                                  )}
                                  
                                  <button
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      if (window.confirm(`Delete AI workflow ${workflow.id}?`)) {
                                        fetch(`${API_BASE_URL}/api/conjoint/workflows/${workflow.id}`, {
                                          method: 'DELETE',
                                          headers: { Authorization: `Bearer ${localStorage.getItem('cognitive_dash_token') || localStorage.getItem('token') || ''}` }
                                        }).then(() => {
                                          loadProjectWorkflowDrafts(selectedProject.id);
                                        }).catch(err => {
                                          console.error('Error deleting workflow:', err);
                                          alert('Failed to delete workflow');
                                        });
                                      }
                                    }}
                                    className="text-red-600 hover:text-red-800 hover:underline text-xs"
                                  >
                                    Delete
                                  </button>
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                    </section>

                    {/* Manual Workflows Section - DISABLED */}
                    <section className="opacity-50 pointer-events-none">
                      <h3 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-3">Manual Workflows (Disabled)</h3>
                    {manualWorkflows.length > 0 ? (
                      <div className="rounded-lg border border-gray-200 bg-white p-5 space-y-4">
                        <div>
                          <p className="text-sm text-gray-700">
                            You currently have <span className="font-semibold">{manualWorkflows.length}</span>{' '}
                            saved manual {manualWorkflows.length === 1 ? 'workflow' : 'workflows'} for this project.
                          </p>
                          <p className="mt-2 text-xs text-gray-500">
                            We&apos;ll surface editing and reporting controls here as soon as additional workflow stages are implemented.
                          </p>
                        </div>
                        <div className="overflow-x-auto">
                          <table className="min-w-full divide-y divide-gray-200 text-left text-sm text-gray-700">
                            <thead className="bg-gray-50">
                              <tr>
                                <th className="px-3 py-2 font-semibold uppercase tracking-wide text-gray-500">Workflow ID</th>
                                <th className="px-3 py-2 font-semibold uppercase tracking-wide text-gray-500">Saved</th>
                                <th className="px-3 py-2 font-semibold uppercase tracking-wide text-gray-500">Warnings</th>
                                <th className="px-3 py-2 font-semibold uppercase tracking-wide text-gray-500">Source</th>
                                <th className="px-3 py-2 font-semibold uppercase tracking-wide text-gray-500">Survey</th>
                                <th className="px-3 py-2 font-semibold uppercase tracking-wide text-gray-500">Estimation</th>
                                <th className="px-3 py-2 font-semibold uppercase tracking-wide text-gray-500">Actions</th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-gray-100 bg-white">
                              {manualWorkflows.slice(0, 5).map(workflow => (
                                <tr
                                  key={workflow.id}
                                  className="hover:bg-gray-50 cursor-pointer transition-colors"
                                  onClick={() => {
                                    if (workflow.estimationResult) {
                                      setSelectedWorkflow(workflow);
                                      setWorkflowViewMode('simulator');
                                    }
                                  }}
                                >
                                  <td className="px-3 py-2 font-mono text-xs text-gray-800">{workflow.id}</td>
                                  <td className="px-3 py-2 text-sm text-gray-700">
                                    {workflow.updatedAt
                                      ? new Date(workflow.updatedAt).toLocaleString()
                                      : new Date(workflow.createdAt).toLocaleString()}
                                  </td>
                                  <td className="px-3 py-2 text-sm text-gray-700">
                                    {workflow.warnings.length > 0 ? (
                                      <span className="inline-flex items-center gap-1 rounded-full bg-yellow-100 px-2 py-0.5 text-xs text-yellow-700">
                                        {workflow.warnings.length} warning{workflow.warnings.length === 1 ? '' : 's'}
                                      </span>
                                    ) : (
                                      <span className="text-xs text-green-700">None</span>
                                    )}
                                  </td>
                                  <td className="px-3 py-2 text-sm text-gray-700">
                                    {workflow.sourceFileName ? workflow.sourceFileName : <span className="text-xs text-gray-500">N/A</span>}
                                  </td>
                                  <td className="px-3 py-2 text-sm text-gray-700">
                                    {workflow.surveyUploadedAt ? (
                                      <span className="inline-flex items-center gap-1 rounded-full bg-green-100 px-2.5 py-0.5 text-xs font-medium text-green-700">
                                        <span className="h-2 w-2 rounded-full bg-green-500" />
                                        Survey validated {new Date(workflow.surveyUploadedAt).toLocaleDateString()}
                                      </span>
                                    ) : (
                                      <span className="text-xs text-gray-500">Not uploaded</span>
                                    )}
                                  </td>
                                  <td className="px-3 py-2 text-sm text-gray-700">
                                    {workflow.estimationResult?.estimatedAt ? (
                                      <div className="flex flex-col gap-1">
                                        <span className="inline-flex items-center gap-1 rounded-full bg-blue-100 px-2.5 py-0.5 text-xs font-medium text-blue-700">
                                          <span className="h-2 w-2 rounded-full bg-blue-500" />
                                          Estimated {new Date(workflow.estimationResult.estimatedAt).toLocaleDateString()}
                                        </span>
                                        {workflow.estimationResult.diagnostics?.pseudo_r2 !== undefined && (
                                          <span className="text-xs text-gray-600">
                                            Pseudo R^2 = {formatNumber(workflow.estimationResult.diagnostics.pseudo_r2, 3)}
                                          </span>
                                        )}
                                        {workflow.estimationResult.diagnostics?.converged !== undefined && (
                                          <span className={`text-xs ${workflow.estimationResult.diagnostics.converged ? 'text-green-600' : 'text-red-600'}`}>
                                            {workflow.estimationResult.diagnostics.converged ? 'Converged' : 'Not converged'}
                                          </span>
                                        )}
                                      </div>
                                    ) : (
                                      <span className="text-xs text-gray-500">Not estimated</span>
                                    )}
                                  </td>
                                  <td className="px-3 py-2 text-sm text-gray-700">
                                    <div className="flex items-center gap-2">
                                      <button
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          if (window.confirm(`Delete workflow ${workflow.id}?`)) {
                                            fetch(`${API_BASE_URL}/api/conjoint/workflows/${workflow.id}`, {
                                              method: 'DELETE',
                                              headers: { Authorization: `Bearer ${localStorage.getItem('cognitive_dash_token') || localStorage.getItem('token') || ''}` }
                                            }).then(() => {
                                              loadProjectWorkflowDrafts(selectedProject.id);
                                            }).catch(err => {
                                              console.error('Error deleting workflow:', err);
                                              alert('Failed to delete workflow');
                                            });
                                          }
                                        }}
                                        className="text-red-600 hover:text-red-800 hover:underline text-xs"
                                      >
                                        Delete
                                      </button>
                                    </div>
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                        <button
                          onClick={openWorkflowWizard}
                          className="inline-flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium shadow-sm transition-opacity text-gray-400 cursor-not-allowed"
                          style={{ backgroundColor: '#d1d5db' }}
                          disabled
                        >
                          <IconPlus className="h-4 w-4" />
                          Add Another Workflow (Disabled)
                        </button>
                      </div>
                    ) : (
                      <div
                        className="rounded-lg border border-dashed p-5"
                        style={{ borderColor: BRAND_ORANGE_BORDER, backgroundColor: BRAND_ORANGE_LIGHT }}
                      >
                        <p className="text-sm text-gray-700">
                          No conjoint workflow has been created for this project yet. Use the AI Workflow option above to automatically configure your conjoint analysis from your questionnaire files.
                        </p>
                        <div className="mt-4 flex flex-wrap items-center gap-3">
                          <button
                            onClick={openWorkflowWizard}
                            className="inline-flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium shadow-sm transition-opacity text-gray-400 cursor-not-allowed"
                            style={{ backgroundColor: '#d1d5db' }}
                            disabled
                          >
                            <IconPlus className="h-4 w-4" />
                            Start Conjoint Workflow (Disabled)
                          </button>
                          <a
                            href="/assets/MOCK%20Conjoint%20Design.xlsx"
                            target="_blank"
                            rel="noreferrer"
                            className="text-sm underline transition-opacity hover:opacity-80"
                            style={{ color: BRAND_ORANGE }}
                          >
                            View sample design workbook
                          </a>
                        </div>
                      </div>
                    )}
                    {loadProjectWorkflowsError && (
                      <p className="mt-3 text-sm text-red-600">{loadProjectWorkflowsError}</p>
                    )}
                    {loadingProjectWorkflows && workflowCount === 0 && (
                      <p className="mt-3 text-sm text-gray-500">Loading existing workflow drafts...</p>
                    )}
                  </section>

                  <section>
                    <h2 className="text-lg font-semibold" style={{ color: BRAND_GRAY }}>{selectedProject.name}</h2>
                    <p className="mt-1 text-sm text-gray-500">
                      {selectedProject.description || 'This project is ready to move through the conjoint workflow.'}
                    </p>
                  </section>

                  <section>
                    <h3 className="text-sm font-semibold text-gray-700 uppercase tracking-wide mb-3">Project Overview</h3>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 text-sm text-gray-600">
                  <div className="flex items-start gap-2">
                    <CalendarIcon className="h-5 w-5 text-gray-400" />
                    <div>
                      <p className="text-xs uppercase tracking-wide text-gray-500">Start Date</p>
                      <p className="font-medium text-gray-900">{formatDate(selectedProject.startDate || selectedProject.kickoffDate)}</p>
                    </div>
                  </div>
                  <div className="flex items-start gap-2">
                    <IconBook2 className="h-5 w-5 text-gray-400" />
                    <div>
                      <p className="text-xs uppercase tracking-wide text-gray-500">Conjoint Workflows</p>
                      <p className="font-medium text-gray-900">{projectWorkflows.length}</p>
                    </div>
                  </div>
                  <div className="flex items-start gap-2">
                    <UserIcon className="h-5 w-5 text-gray-400" />
                    <div>
                      <p className="text-xs uppercase tracking-wide text-gray-500">Client</p>
                      <p className="font-medium text-gray-900">{getClientName(selectedProject)}</p>
                    </div>
                  </div>
                </div>
              </section>

              <section>
                <h3 className="text-sm font-semibold text-gray-700 uppercase tracking-wide mb-3">Team</h3>
                <div className="flex items-center gap-3 text-sm text-gray-700">
                  <UserGroupIcon className="h-5 w-5 text-gray-400" />
                  <span>{getTeamSummary(selectedProject)}</span>
                </div>
              </section>

              <section className="border border-dashed border-gray-300 rounded-lg p-5 bg-gray-50">
                <h3 className="text-sm font-semibold text-gray-700 uppercase tracking-wide mb-2">Conjoint Workspace</h3>
                <p className="text-sm text-gray-600">
                  The multi-step conjoint workflow (setup -&gt; data upload -&gt; estimation -&gt; simulation -&gt; reporting) will live here.
                  Start by reviewing project inputs and outlining the steps you want to capture.
                </p>
                <p className="text-xs text-gray-400 mt-3">
                  Future steps: attach survey design files, map attributes, ingest choice data, and generate share simulations directly from this workspace.
                </p>
              </section>
                  </>
                );
              })()}
            </div>
          </div>
        )}
      </div>
      {showWorkflowWizard &&
        createPortal(
          <div className="fixed inset-0 z-[1200] flex items-start justify-center overflow-y-auto bg-black/60 px-4 py-8">
            <div className="relative w-full max-w-3xl overflow-hidden rounded-2xl bg-white shadow-xl">
              <div className="flex items-center justify-between border-b border-gray-200 px-6 py-4">
                <div>
                  <p className="text-xs uppercase tracking-wide text-gray-500">
                    Step {workflowWizardStep} of {totalWizardSteps}
                  </p>
                  <h2 className="text-lg font-semibold text-gray-900">Create Conjoint Workflow</h2>
                </div>
                <button
                  onClick={closeWorkflowWizard}
                  className="rounded-full p-2 text-gray-400 hover:bg-gray-100 hover:text-gray-600 transition-colors"
                  aria-label="Close"
                >
                  X
                </button>
              </div>

              <div className="max-h-[70vh] overflow-y-auto px-6 py-5">
                {workflowWizardStep === 1 && (
                <div className="space-y-5">
                  <div>
                    <h3 className="text-sm font-semibold text-gray-800">Upload attribute code list</h3>
                    <p className="mt-2 text-sm text-gray-600">
                      Select the Excel workbook that contains your attribute codes. We will look for a sheet named
                      <span className="font-medium text-gray-800"> Attributes</span> with the standard columns:
                    </p>
                    <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-gray-600">
                      <li>
                        <span className="font-medium text-gray-800">CODE</span> - unique numeric code for every attribute level (matches the design matrix)
                      </li>
                      <li>
                        <span className="font-medium text-gray-800">ATTRIBUTE NO / ATTRIBUTE TEXT</span> - ordinal and label for each attribute
                      </li>
                      <li>
                        <span className="font-medium text-gray-800">LEVEL NO / LEVEL TEXT</span> - ordinal and text for each level
                      </li>
                    </ul>
                  </div>

                  {!activeWorkflowId && (
                    <div className="rounded-lg border border-yellow-200 bg-yellow-50 px-4 py-3 text-sm text-yellow-800">
                      Save the workflow draft before uploading survey data.
                    </div>
                  )}

                  <div className="rounded-lg border-2 border-dashed border-gray-300 bg-gray-50 p-6 text-center hover:border-gray-400 transition-colors">
                    <input
                      id="conjoint-attribute-upload"
                      type="file"
                      accept=".xlsx,.xls"
                      className="hidden"
                      onChange={event => handleDesignFile(event.target.files?.[0] ?? null)}
                      disabled={isParsingDesign}
                    />
                    <label htmlFor="conjoint-attribute-upload" className="block cursor-pointer">
                      <IconPlus className="mx-auto h-8 w-8 text-gray-400" />
                      <p className="mt-2 text-sm font-medium" style={{ color: BRAND_ORANGE }}>
                        {workflowDesignFile ? workflowDesignFile.name : 'Click to upload or drag and drop'}
                      </p>
                      <p className="mt-1 text-xs text-gray-500">
                        Excel workbooks (.xlsx or .xls). Use the sample workbook if you need a template.
                      </p>
                    </label>
                  </div>

                  {isParsingDesign && (
                    <div className="flex items-center gap-2 rounded-lg border border-gray-200 bg-gray-50 px-4 py-3 text-sm text-gray-600">
                      <svg className="h-4 w-4 animate-spin" style={{ color: BRAND_ORANGE }} viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                        <path
                          className="opacity-75"
                          fill="currentColor"
                          d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                        />
                      </svg>
                      Reading workbook...
                    </div>
                  )}

                  {wizardError && (
                    <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                      {wizardError}
                    </div>
                  )}

                  {attributeGroups.length > 0 && (
                    <div className="space-y-3">
                      <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
                        <h4 className="text-sm font-semibold text-gray-800">Parsed attributes</h4>
                        <span className="text-xs text-gray-500">
                          {attributeGroups.length} attribute{attributeGroups.length === 1 ? '' : 's'} detected
                        </span>
                      </div>
                      <p className="text-xs text-gray-500">Click an attribute to review every level captured from the workbook.</p>
                      <div className="space-y-2">
                        {attributeGroups.map((group, groupIndex) => {
                          const isOpen = expandedAttributes[group.key] ?? false;
                          const attributeNumber = group.attributeNo || String(groupIndex + 1);
                          const attributeTitle = `${attributeNumber} | ${group.label || `Attribute ${attributeNumber}`}`;
                          const levelSummary = group.levelCount === 1 ? '1 level detected' : `${group.levelCount} levels detected`;

                          return (
                            <div key={group.key} className="overflow-hidden rounded-lg border border-gray-200 bg-white">
                              <button
                                type="button"
                                onClick={() =>
                                  setExpandedAttributes(prev => ({
                                    ...prev,
                                    [group.key]: !isOpen
                                  }))
                                }
                                className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left hover:bg-gray-50"
                              >
                                <span className="min-w-0 flex-1 text-left">
                                  <p className="truncate text-sm font-semibold text-gray-800">{attributeTitle}</p>
                                  <p className="mt-0.5 text-xs text-gray-500">{levelSummary}</p>
                                </span>
                                <ChevronDownIcon
                                  className={`h-4 w-4 flex-shrink-0 text-gray-500 transition-transform ${isOpen ? '-rotate-180' : 'rotate-0'}`}
                                />
                              </button>
                              {isOpen && (
                                <div className="border-t border-gray-100 px-4 py-3">
                                  <ul className="space-y-1 text-sm text-gray-700">
                                    {group.levels.map((level, levelIndex) => {
                                      const displayNumber =
                                        level.levelNo !== null && Number.isFinite(level.levelNo) ? level.levelNo : levelIndex + 1;
                                      const displayText = level.text || level.code || 'Untitled level';

                                      return (
                                        <li
                                          key={`${group.key}-${level.code || level.text || levelIndex}`}
                                          className="flex items-center gap-3 rounded-md bg-gray-50 px-3 py-2 text-sm text-gray-700"
                                        >
                                          <span className="w-10 flex-shrink-0 text-center font-semibold text-gray-600">{displayNumber}</span>
                                          <span className="flex-1 leading-snug">{displayText}</span>
                                        </li>
                                      );
                                    })}
                                  </ul>
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </div>
              )}

              {workflowWizardStep === 2 && (
                <div className="space-y-5">
                  {designSummary ? (
                    <>
                      <div className="rounded-lg border border-gray-200 bg-white p-5 text-sm text-gray-700">
                        <h3 className="text-sm font-semibold text-gray-800">Design structure overview</h3>
                        <p className="mt-2">
                          Detected <strong>{designSummary.attColumnCount}</strong> concept positions per task (
                          {designSummary.attColumns.join(', ')}) across{' '}
                          <strong>{designSummary.totalRows}</strong> rows.
                        </p>
                        <div className="mt-4 grid gap-3 sm:grid-cols-2">
                          {designSummary.versions.map(summary => (
                            <div
                              key={summary.version}
                              className="rounded-lg border border-gray-100 bg-gray-50 px-4 py-3 text-sm text-gray-700"
                            >
                              <p className="font-semibold text-gray-800">Version {summary.version}</p>
                              <p className="mt-1">
                                Tasks: <strong>{summary.taskCount}</strong>
                              </p>
                              <p className="mt-1">
                                Concepts per task (avg/min/max):{' '}
                                <strong>
                                  {summary.avgConceptsPerTask} / {summary.minConceptsPerTask} / {summary.maxConceptsPerTask}
                                </strong>
                              </p>
                            </div>
                          ))}
                        </div>
                      </div>

                      {designIssues.length > 0 && (
                        <div className="rounded-lg border border-yellow-200 bg-yellow-50 px-4 py-3 text-sm text-yellow-800">
                          <p className="font-semibold">Warnings detected</p>
                          <ul className="mt-2 list-disc space-y-1 pl-5">
                            {designIssues.map((issue, index) => (
                              <li key={index}>{issue}</li>
                            ))}
                          </ul>
                        </div>
                      )}

                      <div className="rounded-lg border border-gray-200 bg-white p-5">
                        <h4 className="text-sm font-semibold text-gray-800">Attribute coverage</h4>
                        <p className="mt-1 text-xs text-gray-500">
                          Counts reflect how often each level is used across every Att column in the design file.
                        </p>
                        <div className="mt-3 overflow-x-auto">
                          <table className="min-w-full divide-y divide-gray-200 text-left text-sm text-gray-700">
                            <thead className="bg-gray-50">
                              <tr>
                                <th className="px-3 py-2 font-semibold uppercase tracking-wide text-gray-500">Attribute</th>
                                <th className="px-3 py-2 text-center font-semibold uppercase tracking-wide text-gray-500">
                                  Placements
                                </th>
                                <th className="px-3 py-2 font-semibold uppercase tracking-wide text-gray-500">Level coverage</th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-gray-100 bg-white">
                              {designSummary.attributeCoverage.map(entry => (
                                <tr key={`${entry.attributeNo}-${entry.attributeText}`}>
                                  <td className="whitespace-nowrap px-3 py-2 text-sm font-medium text-gray-900">
                                    {entry.attributeText}
                                  </td>
                                  <td className="px-3 py-2 text-center text-sm text-gray-800">
                                    <strong>{entry.total}</strong>
                                  </td>
                                  <td className="px-3 py-2 text-sm text-gray-700">
                                    <div className="flex flex-wrap gap-2">
                                      {entry.levels.map(level => (
                                        <span
                                          key={`${entry.attributeText}-${level.levelText}`}
                                          className="inline-flex items-center gap-1 rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-700"
                                        >
                                          {level.levelText}: <strong>{level.count}</strong>
                                        </span>
                                      ))}
                                    </div>
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </div>

                      {designSummary && designPreview.length > 0 && (
                        <div>
                          <h4 className="text-sm font-semibold text-gray-800">
                            Design preview (first {designPreview.length} rows)
                          </h4>
                          <div className="mt-2 max-h-64 overflow-auto rounded-lg border border-gray-200">
                            <table className="min-w-full divide-y divide-gray-200 text-left text-xs text-gray-700">
                              <thead className="bg-gray-50">
                                <tr>
                                  {designHeaders.map(header => (
                                    <th key={header} className="px-3 py-2 font-semibold uppercase tracking-wide text-gray-500">
                                      {header}
                                    </th>
                                  ))}
                                </tr>
                              </thead>
                              <tbody className="divide-y divide-gray-100 bg-white">
                                {designPreview.map((row, index) => (
                                  <tr key={index}>
                                    {designHeaders.map(header => (
                                      <td key={header} className="whitespace-nowrap px-3 py-2">
                                        {String(row[header] ?? '')}
                                      </td>
                                    ))}
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        </div>
                      )}

                      <div className="rounded-lg border border-gray-200 bg-gray-50 px-4 py-3 text-sm text-gray-600">
                        <p className="font-medium text-gray-800">What&apos;s coming next:</p>
                        <ul className="mt-2 list-disc space-y-1 pl-5">
                          <li>Attach the full design matrix to finalize experiment validation.</li>
                          <li>Map choice task exports so estimation can auto-detect the structure.</li>
                          <li>Pre-build simulator scenarios once utilities are estimated.</li>
                        </ul>
                      </div>
                      {saveWorkflowSuccess && (
                        <div className="rounded-lg border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-700">
                          Workflow draft saved. ID <strong>{saveWorkflowSuccess.workflowId}</strong>
                        </div>
                      )}
                    </>
                  ) : (
                    <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                      Upload a design workbook in step 1 to review coverage metrics.
                    </div>
                  )}
                  {saveWorkflowError && (
                    <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                      {saveWorkflowError}
                    </div>
                  )}
                </div>
              )}

              {workflowWizardStep === 3 && (
                <div className="space-y-5">
                  <div>
                    <h3 className="text-sm font-semibold text-gray-800">Upload choice task survey export</h3>
                    <p className="mt-2 text-sm text-gray-600">
                      Provide the raw conjoint survey export (wide format). We&apos;ll validate that task selections and attribute codes
                      align with the saved design matrix.
                    </p>
                    <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-gray-600">
                      <li>Ensure the workbook still contains the QC1_N columns for each task.</li>
                      <li>All hATTR_* columns will be checked against the codes defined in your design.</li>
                      <li>Large files may take a few seconds to process.</li>
                    </ul>
                  </div>

                  {!activeWorkflowId && (
                    <div className="rounded-lg border border-yellow-200 bg-yellow-50 px-4 py-3 text-sm text-yellow-800">
                      Save the workflow draft before uploading survey data.
                    </div>
                  )}

                  <div className="rounded-lg border-2 border-dashed border-gray-300 bg-gray-50 p-6 text-center hover:border-gray-400 transition-colors">
                    <input
                      id="conjoint-survey-upload"
                      type="file"
                      accept=".xlsx,.xls"
                      className="hidden"
                      onChange={event => handleSurveyFileChange(event.target.files?.[0] ?? null)}
                      disabled={isUploadingSurvey}
                    />
                    <label htmlFor="conjoint-survey-upload" className="block cursor-pointer">
                      <IconPlus className="mx-auto h-8 w-8 text-gray-400" />
                      <p className="mt-2 text-sm font-medium" style={{ color: BRAND_ORANGE }}>
                        {surveyFile ? surveyFile.name : 'Click to upload or drag and drop'}
                      </p>
                      <p className="mt-1 text-xs text-gray-500">Excel workbooks (.xlsx or .xls).</p>
                    </label>
                  </div>

                  {surveyError && (
                    <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                      {surveyError}
                    </div>
                  )}

                  {isUploadingSurvey && (
                    <div className="flex items-center gap-2 rounded-lg border border-gray-200 bg-gray-50 px-4 py-3 text-sm text-gray-600">
                      <svg className="h-4 w-4 animate-spin" style={{ color: BRAND_ORANGE }} viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                        <path
                          className="opacity-75"
                          fill="currentColor"
                          d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                        ></path>
                      </svg>
                      Validating survey export...
                    </div>
                  )}

                  {surveyWarnings.length > 0 && (
                    <div className="rounded-lg border border-yellow-200 bg-yellow-50 px-4 py-3 text-sm text-yellow-800">
                      <p className="font-semibold">Warnings</p>
                      <ul className="mt-2 list-disc space-y-1 pl-5">
                        {surveyWarnings.map((warning, idx) => (
                          <li key={idx}>{warning}</li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {surveySummary && (
                    <div className="rounded-lg border border-gray-200 bg-white p-5 space-y-4 text-sm text-gray-700">
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                        <div>
                          Respondents: <span className="font-semibold">{surveySummary.totalRespondents}</span>
                        </div>
                        <div>
                          Tasks per respondent: <span className="font-semibold">{surveySummary.tasksPerRespondent}</span>
                        </div>
                        <div>
                          Choice columns:{' '}
                          <span className="font-mono text-xs">
                            {surveySummary.choiceColumns.length ? surveySummary.choiceColumns.join(', ') : 'None detected'}
                          </span>
                        </div>
                        <div>
                          Unique codes detected:{' '}
                          <span className="font-mono text-xs">{surveySummary.uniqueCodesInSurvey.length}</span>
                        </div>
                      </div>

                      {surveySummary.versionCounts.length > 0 && (
                        <div>
                          <h4 className="text-sm font-semibold text-gray-800">Versions</h4>
                          <ul className="mt-1 list-disc space-y-1 pl-5">
                            {surveySummary.versionCounts.map(({ version, count }) => (
                              <li key={version}>
                                Version {version}: {count} rows
                              </li>
                            ))}
                          </ul>
                        </div>
                      )}

                      {surveySummary.unmatchedCodes.length > 0 && (
                        <div>
                          <h4 className="text-sm font-semibold text-gray-800">Codes not in design</h4>
                          <p className="mt-1 text-xs text-red-600">
                            {surveySummary.unmatchedCodes.slice(0, 30).join(', ')}
                            {surveySummary.unmatchedCodes.length > 30 ? '...' : ''}
                          </p>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}

              {workflowWizardStep === 4 && showSimulator && estimationResult && (
                <div className="space-y-5">
                  <div className="flex items-center justify-between">
                    <h3 className="text-sm font-semibold text-gray-800">Conjoint Simulator</h3>
                    <button
                      type="button"
                      onClick={() => setShowSimulator(false)}
                      className="text-xs text-gray-600 hover:text-gray-800 underline"
                    >
                      Back to utilities
                    </button>
                  </div>
                  <ConjointSimulator
                    embedded
                    initialModel={{
                      intercept:
                        estimationResult.intercept !== null && estimationResult.intercept !== undefined
                          ? Number(estimationResult.intercept)
                          : 0,
                      utilities: estimationResult.utilities || {},
                      schema: estimationResult.schema || { attributes: [] }
                    }}
                    currentProducts={surveySummary?.marketShareProducts || []}
                  />
                </div>
              )}

              {workflowWizardStep === 4 && !showSimulator && (
                <div className="space-y-5">
                  <div>
                    <h3 className="text-sm font-semibold text-gray-800">Estimate utilities</h3>
                    <p className="mt-2 text-sm text-gray-600">
                      Run the estimation model to calculate part-worth utilities from the survey responses. The estimation process will:
                    </p>
                    <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-gray-600">
                      <li>Use multinomial logit regression to estimate utility values for each attribute level</li>
                      <li>Calculate an intercept term and diagnostic metrics (e.g., pseudo R^2)</li>
                      <li>Validate convergence and provide warnings for potential issues</li>
                    </ul>
                  </div>

                  {!surveySummary && (
                    <div className="rounded-lg border border-yellow-200 bg-yellow-50 px-4 py-3 text-sm text-yellow-800">
                      Please upload and validate survey data in Step 3 before estimating utilities.
                    </div>
                  )}

                  {estimationError && (
                    <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                      {estimationError}
                    </div>
                  )}

                  {isEstimating && (
                    <div className="flex items-center gap-2 rounded-lg border border-gray-200 bg-gray-50 px-4 py-3 text-sm text-gray-600">
                      <svg className="h-4 w-4 animate-spin" style={{ color: BRAND_ORANGE }} viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                        <path
                          className="opacity-75"
                          fill="currentColor"
                          d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                        ></path>
                      </svg>
                      Estimating utilities... This may take a few moments.
                    </div>
                  )}

                  {estimationResult && (
                    <div className="rounded-lg border border-gray-200 bg-white p-5 space-y-5 text-sm text-gray-700">
                      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                        <div>
                          <h4 className="text-sm font-semibold text-gray-800">Estimation summary</h4>
                          {estimationTimestamp && (
                            <p className="text-xs text-gray-500">Estimated {estimationTimestamp}</p>
                          )}
                        </div>
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="rounded-full bg-gray-100 px-3 py-1 text-xs font-medium text-gray-700">
                            Intercept {interceptDisplay}
                          </span>
                          <button
                            type="button"
                            onClick={() => setShowSimulator(true)}
                            disabled={!canLaunchSimulator}
                            className={`rounded-lg px-3 py-2 text-xs font-semibold transition-opacity ${
                              canLaunchSimulator ? 'text-white hover:opacity-90' : 'text-gray-500 cursor-not-allowed'
                            }`}
                            style={{
                              backgroundColor: canLaunchSimulator ? BRAND_ORANGE : '#E5E7EB'
                            }}
                          >
                            Launch simulator
                          </button>
                        </div>
                      </div>

                      {estimationDiagnostics.length > 0 && (
                        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                          {estimationDiagnostics.map(item => (
                            <div key={item.label} className="rounded-lg border border-gray-100 bg-gray-50 px-3 py-2">
                              <p className="text-xs uppercase tracking-wide text-gray-500">{item.label}</p>
                              <p className="text-sm font-semibold text-gray-800">{item.value}</p>
                            </div>
                          ))}
                        </div>
                      )}

                      {formattedUtilities.length > 0 && (
                        <div className="space-y-3">
                          <h5 className="text-sm font-semibold text-gray-800">Part-worth utilities</h5>
                          <div className="space-y-3">
                            {formattedUtilities.map(attribute => (
                              <div key={attribute.name} className="rounded-lg border border-gray-100">
                                <div className="flex items-center justify-between border-b border-gray-100 bg-gray-50 px-3 py-2">
                                  <span className="text-sm font-medium text-gray-800">{attribute.label}</span>
                                  <span className="text-[11px] uppercase tracking-wide text-gray-500">
                                    {attribute.rows.length} level{attribute.rows.length === 1 ? '' : 's'}
                                  </span>
                                </div>
                                <div className="overflow-x-auto">
                                  <table className="min-w-full text-left text-xs">
                                    <tbody>
                                      {attribute.rows.map(row => (
                                        <tr key={row.level} className="border-t border-gray-100">
                                          <td className="px-3 py-2 font-medium text-gray-700">
                                            {row.level}
                                            {row.isReference && (
                                              <span className="ml-2 rounded-full bg-gray-200 px-2 py-0.5 text-[11px] uppercase tracking-wide text-gray-600">
                                                Reference
                                              </span>
                                            )}
                                          </td>
                                          <td className="px-3 py-2 text-right font-mono text-gray-800">
                                            {formatNumber(row.value, 4)}
                                          </td>
                                        </tr>
                                      ))}
                                    </tbody>
                                  </table>
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}

                      {estimationResult.warnings.length > 0 && (
                        <div className="rounded-lg border border-yellow-200 bg-yellow-50 px-4 py-3 text-sm text-yellow-800">
                          <p className="font-semibold">Warnings</p>
                          <ul className="mt-2 list-disc space-y-1 pl-5">
                            {estimationResult.warnings.map((warning, idx) => (
                              <li key={idx}>{warning}</li>
                            ))}
                          </ul>
                        </div>
                      )}

                      <p className="text-xs text-gray-500">
                        Utilities, diagnostics, and metadata are saved with this workflow. Use the simulator to model share outcomes for custom product configurations.
                      </p>
                    </div>
                  )}

                  {!estimationResult && surveySummary && (
                    <div className="rounded-lg border border-gray-200 bg-gray-50 px-4 py-3 text-sm text-gray-600">
                      <p className="font-medium text-gray-800">Ready to estimate</p>
                      <p className="mt-1">
                        Click &quot;Estimate Utilities&quot; below to run the estimation model.
                      </p>
                    </div>
                  )}
                </div>
              )}
            </div>

            <div className="flex items-center justify-between border-t border-gray-200 px-6 py-4">
              <button
                onClick={() => {
                  if (workflowWizardStep === 1) {
                    closeWorkflowWizard();
                  } else {
                    setWorkflowWizardStep(step => Math.max(1, step - 1));
                  }
                }}
                className="rounded-lg border border-gray-300 px-4 py-2 text-sm text-gray-600 hover:bg-gray-50 transition-colors"
              >
                {workflowWizardStep === 1 ? 'Cancel' : 'Back'}
              </button>

              <div className="flex items-center gap-2">
                {workflowWizardStep === 1 && (
                  <button
                    onClick={() => setWorkflowWizardStep(step => Math.min(totalWizardSteps, step + 1))}
                    disabled={stepOneDisabled}
                    className={getPrimaryButtonClass(stepOneDisabled)}
                    style={getPrimaryButtonStyle(stepOneDisabled)}
                  >
                    Next
                  </button>
                )}
                {workflowWizardStep === 2 && (
                  <button
                    onClick={handleSaveWorkflowDraft}
                    disabled={saveDraftDisabled}
                    className={getPrimaryButtonClass(saveDraftDisabled)}
                    style={getPrimaryButtonStyle(saveDraftDisabled)}
                  >
                    {isSavingWorkflow ? 'Saving...' : 'Save Workflow Draft'}
                  </button>
                )}
                {workflowWizardStep === 3 && (
                  <>
                    <button
                      onClick={handleUploadSurvey}
                      disabled={validateSurveyDisabled}
                      className={getPrimaryButtonClass(validateSurveyDisabled)}
                      style={getPrimaryButtonStyle(validateSurveyDisabled)}
                    >
                      {isUploadingSurvey ? 'Validating...' : 'Validate Survey Export'}
                    </button>
                    {surveySummary && !isUploadingSurvey && (
                      <button
                        onClick={() => {
                          setEstimationResult(null);
                          setEstimationError(null);
                          setWorkflowWizardStep(4);
                        }}
                        className={getPrimaryButtonClass(false)}
                        style={getPrimaryButtonStyle(false)}
                      >
                        Next
                      </button>
                    )}
                  </>
                )}
                {workflowWizardStep === 4 && (
                  <>
                    <button
                      onClick={handleEstimateUtilities}
                      disabled={estimateDisabled}
                      className={getPrimaryButtonClass(estimateDisabled)}
                      style={getPrimaryButtonStyle(estimateDisabled)}
                    >
                      {isEstimating ? 'Estimating...' : estimationResult ? 'Re-estimate utilities' : 'Estimate utilities'}
                    </button>
                    {estimationResult && !isEstimating && (
                      <button
                        onClick={closeWorkflowWizard}
                        className="rounded-lg border border-gray-300 px-5 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-50 transition-colors"
                      >
                        Finish
                      </button>
                    )}
                  </>
                )}
              </div>
            </div>
          </div>
        </div>,
        document.body
        )
      }
    </div>
  );
}












