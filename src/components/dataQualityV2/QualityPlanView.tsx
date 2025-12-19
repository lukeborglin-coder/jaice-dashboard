import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Cog6ToothIcon, XMarkIcon, ClockIcon, CalculatorIcon, Bars3Icon, ChatBubbleBottomCenterTextIcon, PlayIcon } from '@heroicons/react/24/outline';
import type { QualityPlan, QualityRule, QuestionType, CheckTypeId } from '../../types/dataQuality';
import { classifyDatamapQuestionType } from '../../utils/tabs/questionHelpers';

const BRAND_ORANGE = '#D14A2D';

export type DQV2RespondentResult = {
  respondentId: string;
  rowIndex: number;
  score: number; // 0-100
  baseScore?: number; // before confidence weighting
  applicableChecks?: number; // count of answered+checked rows for confidence
  confidenceWeight?: number; // 0-1 multiplier applied to baseScore
  flagCount: number;
  totalWeight: number;
  maxPossibleWeight: number;
  flagNames: string[];
};

export type DQV2RunResultsPayload = {
  results: DQV2RespondentResult[];
  enabledRules: QualityRule[];
};

type DatamapParsedQuestion = {
  questionNumber?: string;
  description?: string;
  responseType?: string;
  responseCodes?: Array<{ code?: string; label?: string; text?: string }>;
  responseOptions?: Array<{ code?: string; label?: string; text?: string; value?: string }>;
  statementOptions?: Array<{ code?: string; label?: string; text?: string; value?: string }>;
  notes?: string[];
};

type QualityPlanCardId = 'speeding' | 'straightlining' | 'numeric_grids' | 'open_end';

const QUALITY_PLAN_CARDS: Array<{ id: QualityPlanCardId; label: string }> = [
  { id: 'speeding', label: 'Speeding' },
  { id: 'straightlining', label: 'Straight-Lining' },
  { id: 'numeric_grids', label: 'Numeric Grids' },
  { id: 'open_end', label: 'Open-End Quality' },
];

const normalizeOptions = (q: DatamapParsedQuestion): Array<{ code: string; label: string }> => {
  const candidates = [q.responseCodes, q.responseOptions, q.statementOptions];
  const src = candidates.find((c) => Array.isArray(c) && c.length > 0) as any[] | undefined;
  if (!src) return [];
  return src
    .map((opt: any, idx: number) => {
      if (opt == null) return null;
      if (typeof opt === 'string' || typeof opt === 'number') {
        return { code: String(opt), label: '' };
      }
      const code = opt.code ?? opt.value ?? idx + 1;
      const label = opt.label ?? opt.text ?? opt.name ?? '';
      return { code: String(code), label: String(label) };
    })
    .filter(Boolean) as Array<{ code: string; label: string }>;
};

function hasBracketsInResponseCodes(options: ReturnType<typeof normalizeOptions>): boolean {
  return Array.isArray(options) && options.some((rc) => /\[([^\]]+)\]|\(([^)]+)\)/.test(String(rc?.code || '').trim()));
}

function normalizeQuestionNumberKey(value: unknown): string {
  // Normalize aggressively so plan rules and Data Map rows match even if formatting differs.
  // Examples:
  // - "Q12" / "q12" / "12" -> "12"
  // - "Q12a" / "Q12A" -> "12a"
  // - "Q12." / "Q12:" -> "12"
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/^q/i, '')
    .replace(/[^a-z0-9]/g, '');
}

function parseNumericGridColumnQuestionNumber(questionNumber: string): { baseQuestionNumber: string; columnIndex: number } | null {
  // Numeric grids may be exported as separate question numbers per column:
  //   QS11c1, QS11c2, QS11c3...
  // We treat QS11 as the base grid question and cN as the grid column.
  const raw = String(questionNumber || '').trim();
  if (!raw) return null;
  const m = raw.match(/^(.*?)(?:[_-])?c(\d+)$/i);
  if (!m) return null;
  const base = String(m[1] || '').trim();
  const idx = parseInt(String(m[2] || ''), 10);
  if (!base) return null;
  if (!Number.isFinite(idx) || idx <= 0) return null;
  return { baseQuestionNumber: base, columnIndex: idx };
}

function isNumericGridQuestionFromDatamap(parsedQuestions: DatamapParsedQuestion[], questionNumber: string): boolean {
  const target = normalizeQuestionNumberKey(questionNumber);
  if (!target) return false;

  const match = (parsedQuestions || []).find((q) => normalizeQuestionNumberKey(q?.questionNumber) === target);
  if (!match) return false;

  const rt = String(match?.responseType || '').toLowerCase();
  const options = normalizeOptions(match);
  const hasOptions = Array.isArray(options) && options.length > 0;
  const hasNumericCodes = options.some((opt) => /^\d+(\.\d+)?$/.test(String(opt.code || '').trim()));
  const hasBracketed = hasBracketsInResponseCodes(options);

  // Explicit label support (e.g., "Numeric grid" or "Open numeric grid")
  if (rt.includes('numeric grid')) return true;

  // Open numeric + any options => numeric grid
  if (rt.includes('open numeric') && hasOptions) return true;

  // Response type mentions numeric and the options look numeric or bracketed => numeric grid
  if (rt.includes('numeric') && hasOptions && (hasNumericCodes || hasBracketed)) return true;

  // Values + bracketed codes (common grid export)
  if (rt.includes('values') && hasBracketed) return true;

  // Fallback: options look numeric/bracketed even if responseType is missing/ambiguous.
  if (hasOptions && (hasNumericCodes || hasBracketed)) return true;

  return false;
}

function isHiddenQuestionNumber(questionNumber: string): boolean {
  const qn = String(questionNumber || '').trim().toLowerCase();
  if (!qn) return false;
  if (qn === 'qinfo') return true;
  if (!qn.startsWith('q')) return true;
  if (qn.includes('term') || qn.includes('hid')) return true;
  return false;
}

function extractBracketTokens(value: string): string[] {
  const tokens: string[] = [];
  const patterns = [/\[([^\]]+)\]/g, /\(([^)]+)\)/g];
  patterns.forEach((pattern) => {
    let match: RegExpExecArray | null;
    pattern.lastIndex = 0;
    while ((match = pattern.exec(value)) !== null) {
      const t = String(match[1] || '').trim();
      if (t) tokens.push(t);
    }
  });
  return tokens;
}

function countStatementsFromDatamapQuestion(q: DatamapParsedQuestion): number {
  const options = normalizeOptions(q);
  if (!Array.isArray(options) || options.length === 0) {
    // Fallback to notes length if present
    if (Array.isArray(q.notes)) return q.notes.length;
    return 0;
  }
  const tokens = new Set<string>();
  options.forEach((rc) => {
    const code = String(rc?.code || '').trim();
    if (!code) return;
    extractBracketTokens(code).forEach((t) => tokens.add(t));
  });
  // Fallback: if nothing bracketed, use option count
  return tokens.size || options.length;
}

function normalizeHeaderKey(value: unknown) {
  return String(value || '')
    .toLowerCase()
    .trim()
    // Normalize aggressively so Data Map tokens match uploaded headers even if separators differ.
    // e.g. "hQS11Mask.c1.sum" vs "hQS11Mask_c1_sum"
    .replace(/[^a-z0-9]/g, '');
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function getStraightlineColumnNamesForQuestion(allColumnNames: string[], questionNumber: string) {
  const qn = String(questionNumber || '').trim().toLowerCase();
  if (!qn) return [];

  const prefixes = [qn];
  // Allow matching without leading "q" for question numbers like "Q1"
  if (qn.startsWith('q') && qn.length > 1) prefixes.push(qn.slice(1));

  const patterns = prefixes.map((p) => new RegExp(`^${escapeRegExp(p)}(?:_)?r\\d+`, 'i'));
  const patternsDash = prefixes.map((p) => new RegExp(`^${escapeRegExp(p)}-r\\d+`, 'i'));

  return allColumnNames.filter((col) => {
    const c = String(col || '').trim();
    if (!c) return false;
    return patterns.some((re) => re.test(c)) || patternsDash.some((re) => re.test(c));
  });
}

type Grid2DCellInfo = { column: string; r: number; c: number };

function getGrid2DCellInfosForQuestion(allColumnNames: string[], questionNumber: string): Grid2DCellInfo[] {
  const qn = String(questionNumber || '').trim().toLowerCase();
  if (!qn) return [];

  const prefixes = [qn];
  // Allow matching without leading "q" for question numbers like "Q1"
  if (qn.startsWith('q') && qn.length > 1) prefixes.push(qn.slice(1));

  // Accept: Q12r1c1, Q12_r1_c1, Q12-r1-c1, and mixed separators
  const patterns = prefixes.map(
    (p) => new RegExp(`^${escapeRegExp(p)}(?:[_-])?r(\\d+)(?:[_-])?c(\\d+)`, 'i')
  );

  const out: Grid2DCellInfo[] = [];
  allColumnNames.forEach((col) => {
    const raw = String(col || '').trim();
    if (!raw) return;

    for (const re of patterns) {
      const m = re.exec(raw);
      if (!m) continue;
      const r = parseInt(String(m[1] || ''), 10);
      const c = parseInt(String(m[2] || ''), 10);
      if (!Number.isFinite(r) || !Number.isFinite(c)) break;
      out.push({ column: raw, r, c });
      break;
    }
  });

  return out;
}

function normalizeOpenEndText(value: string) {
  return String(value || '')
    .toLowerCase()
    .trim()
    .replace(/[^\p{L}\p{N}\s]+/gu, '') // strip punctuation
    .replace(/\s+/g, ' ')
    .trim();
}

function tokenizeOpenEnd(value: string) {
  const norm = normalizeOpenEndText(value);
  if (!norm) return [];
  return norm.split(' ').filter(Boolean);
}

function jaccardSimilarity(aTokens: string[], bTokens: string[]) {
  if (aTokens.length === 0 || bTokens.length === 0) return 0;
  const a = new Set(aTokens);
  const b = new Set(bTokens);
  let inter = 0;
  a.forEach((t) => { if (b.has(t)) inter += 1; });
  const union = a.size + b.size - inter;
  return union > 0 ? inter / union : 0;
}

function getRowValueLoose(row: any, header: string) {
  if (!row || !header) return undefined;
  if (Object.prototype.hasOwnProperty.call(row, header)) return row[header];
  const target = normalizeHeaderKey(header);
  const key = Object.keys(row).find((k) => normalizeHeaderKey(k) === target);
  return key ? row[key] : undefined;
}

function computeMeanNoOutliers(values: number[]) {
  const clean = values.filter((v) => Number.isFinite(v));
  if (clean.length === 0) {
    return {
      mean: null as number | null,
      meanNoOutliers: null as number | null,
      median: null as number | null,
      medianNoOutliers: null as number | null,
      stdDev: null as number | null,
      stdDevNoOutliers: null as number | null,
      n: 0,
      nNoOutliers: 0,
    };
  }

  const medianOf = (arr: number[]) => {
    if (!arr || arr.length === 0) return null as number | null;
    const s = arr.slice().sort((a, b) => a - b);
    const mid = Math.floor(s.length / 2);
    if (s.length % 2 === 1) return s[mid];
    return (s[mid - 1] + s[mid]) / 2;
  };

  const mean = clean.reduce((a, b) => a + b, 0) / clean.length;
  const median = medianOf(clean);

  // Outliers: remove values farther than 2 "std dev" away from the MEDIAN (RMS deviation from median).
  const stdDevFromMedian = (() => {
    if (!Number.isFinite(median as any)) return null as number | null;
    const squaredDiffs = clean.map((v) => Math.pow(v - (median as number), 2));
    const avgSquaredDiff = squaredDiffs.reduce((a, b) => a + b, 0) / clean.length;
    const sd = Math.sqrt(avgSquaredDiff);
    return Number.isFinite(sd) ? sd : null;
  })();

  if (!Number.isFinite(stdDevFromMedian as any) || (stdDevFromMedian as number) === 0 || !Number.isFinite(median as any)) {
    return {
      mean,
      meanNoOutliers: mean,
      median,
      medianNoOutliers: median,
      stdDev: stdDevFromMedian,
      stdDevNoOutliers: stdDevFromMedian,
      n: clean.length,
      nNoOutliers: clean.length,
    };
  }

  const noOutliers = clean.filter((v) => Math.abs(v - (median as number)) <= 2 * (stdDevFromMedian as number));
  const medianNoOutliers = medianOf(noOutliers);
  const meanNoOutliers = noOutliers.length > 0
    ? (noOutliers.reduce((a, b) => a + b, 0) / noOutliers.length)
    : mean;

  const stdDevNoOutliers = (() => {
    if (noOutliers.length === 0) return null as number | null;
    if (!Number.isFinite(medianNoOutliers as any)) return null as number | null;
    const squared = noOutliers.map((v) => Math.pow(v - (medianNoOutliers as number), 2));
    const avg = squared.reduce((a, b) => a + b, 0) / noOutliers.length;
    const s = Math.sqrt(avg);
    return Number.isFinite(s) ? s : null;
  })();

  return {
    mean,
    meanNoOutliers,
    median,
    medianNoOutliers,
    stdDev: stdDevFromMedian,
    stdDevNoOutliers,
    n: clean.length,
    nNoOutliers: noOutliers.length,
  };
}

function computeDefaultSpeedingUnderSeconds(qtimeStats: {
  mean: number | null;
  meanNoOutliers: number | null;
  median?: number | null;
  medianNoOutliers?: number | null;
  stdDev: number | null;
  stdDevNoOutliers: number | null;
  max?: number | null;
}) {
  const loiSeconds = (qtimeStats.medianNoOutliers ?? qtimeStats.median ?? qtimeStats.meanNoOutliers ?? qtimeStats.mean);
  if (!Number.isFinite(loiSeconds as any)) return null;

  // Under default: 50% of LOI (median, no-outliers if available).
  let candidate = (loiSeconds as number) * 0.5;
  if (!Number.isFinite(candidate)) return null;
  candidate = Math.max(0, candidate);

  const max = (qtimeStats.max ?? null);
  if (Number.isFinite(max as any)) candidate = Math.min(candidate, max as number);

  return Math.round(candidate);
}

function computeDefaultSpeedingOverSeconds(qtimeStats: {
  mean: number | null;
  meanNoOutliers: number | null;
  median?: number | null;
  medianNoOutliers?: number | null;
  stdDev: number | null;
  stdDevNoOutliers: number | null;
  max?: number | null;
}) {
  const medianAllSeconds = (qtimeStats.median ?? qtimeStats.meanNoOutliers ?? qtimeStats.mean);
  if (!Number.isFinite(medianAllSeconds as any)) return null;

  // Over default: 2x the ALL-ROWS median.
  let candidate = (medianAllSeconds as number) * 2;
  if (!Number.isFinite(candidate)) return null;
  candidate = Math.max(0, candidate);

  const max = (qtimeStats.max ?? null);
  if (Number.isFinite(max as any)) candidate = Math.min(candidate, max as number);

  return Math.round(candidate);
}

function inferQuestionTypeFromDatamap(q: DatamapParsedQuestion): { questionType: QuestionType; forStraightlining: boolean; forOpenEnd: boolean } {
  const rt = String(q.responseType || '').toLowerCase();
  const options = normalizeOptions(q);
  const hasCodes = options.length > 0;
  const hasNumericCodes = options.some((opt) => /^\d+(\.\d+)?$/.test(String(opt.code || '').trim()));
  const hasBracketed = hasBracketsInResponseCodes(options);

  // Open text → open_end rule
  if (rt.includes('open text')) {
    return { questionType: 'open_end', forStraightlining: false, forOpenEnd: true };
  }

  // Numeric grid: explicit "numeric grid" or numeric-ish options on numeric response types
  if (rt.includes('numeric grid')) {
    return { questionType: 'grid', forStraightlining: true, forOpenEnd: false };
  }
  if (rt.includes('open numeric') && hasCodes) {
    return { questionType: 'grid', forStraightlining: true, forOpenEnd: false };
  }
  if (rt.includes('numeric') && hasCodes && (hasNumericCodes || hasBracketed)) {
    return { questionType: 'grid', forStraightlining: true, forOpenEnd: false };
  }
  if (rt.includes('values') && hasBracketed) {
    return { questionType: 'grid', forStraightlining: true, forOpenEnd: false };
  }
  if (hasCodes && (hasNumericCodes || hasBracketed)) {
    return { questionType: 'grid', forStraightlining: true, forOpenEnd: false };
  }

  // Open numeric (non-grid)
  if (rt.includes('open numeric')) {
    return { questionType: 'numeric', forStraightlining: false, forOpenEnd: false };
  }

  // Multi-select (0-1)
  if (rt.match(/values?:\s*0\s*-\s*1/i)) {
    return { questionType: 'multi', forStraightlining: false, forOpenEnd: false };
  }

  // Single-select grids: values range + evidence of rows (brackets OR statementOptions/notes)
  if (rt.includes('values:') && hasCodes) {
    const hasStatementsMeta =
      (Array.isArray(q.statementOptions) && q.statementOptions.length > 0) ||
      (Array.isArray(q.notes) && q.notes.length > 0);
    if (hasBracketsInResponseCodes(options) || hasStatementsMeta) {
      return { questionType: 'grid', forStraightlining: true, forOpenEnd: false };
    }
    // Otherwise treat as simple single-select
    return { questionType: 'single', forStraightlining: false, forOpenEnd: false };
  }

  // Default fallback
  return { questionType: 'single', forStraightlining: false, forOpenEnd: false };
}

function createPlanFromDatamap(projectId: string, parsedQuestions: DatamapParsedQuestion[]): QualityPlan {
  const now = new Date().toISOString();

  const rules: QualityRule[] = [];

  const includeOtherSpecifyOpenEnds = (() => {
    try {
      const raw = localStorage.getItem(getSettingsKey(projectId));
      if (!raw) return false;
      const parsed = JSON.parse(raw);
      return Boolean(parsed?.openEndIncludeOtherSpecify);
    } catch {
      return false;
    }
  })();
  const includeOpenEnds = (() => {
    try {
      const raw = localStorage.getItem(getSettingsKey(projectId));
      if (!raw) return true;
      const parsed = JSON.parse(raw);
      // default true if unset
      if (parsed?.openEndEnabled === undefined) return true;
      return Boolean(parsed?.openEndEnabled);
    } catch {
      return true;
    }
  })();
  const straightliningSettings = (() => {
    try {
      const raw = localStorage.getItem(getSettingsKey(projectId));
      const parsed = raw ? JSON.parse(raw) : {};
      const minStatements = Number(parsed?.straightliningMinStatements);
      return {
        minStatementsRequired: Number.isFinite(minStatements) && minStatements > 0 ? minStatements : 4,
        // Auto-derived later in the UI based on the uploaded data; these are placeholders for initial plan creation.
        weightReferenceStatements: 10,
        maxWeight: 20,
      };
    } catch {
      return { minStatementsRequired: 4, weightReferenceStatements: 10, maxWeight: 20 };
    }
  })();

  // Always add a global speeding rule (mirrors backend plan generation)
  rules.push({
    id: `GLOBAL_speeding_${Date.now()}`,
    questionNumber: 'qtime',
    questionText: 'Completion time (seconds)',
    questionType: 'numeric',
    checkTypeId: 'speeding',
    enabled: true,
    config: {},
    createdAt: now,
    updatedAt: now,
  });

  parsedQuestions.forEach((q, idx) => {
    const qNum = String(q.questionNumber || '').trim();
    if (!qNum) return;
    const rtLower = String(q.responseType || '').toLowerCase();

    // Exclude hidden questions (matches Data Map "Hidden" column rule)
    if (isHiddenQuestionNumber(qNum)) {
      return;
    }

    const inferred = inferQuestionTypeFromDatamap(q);
    const isGrid = inferred.questionType === 'grid';
    const isOpenNumericGrid = rtLower.includes('open numeric') || rtLower.includes('numeric grid');

    if (inferred.forOpenEnd) {
      const qnLower = qNum.toLowerCase();
      const isOtherSpecify = qnLower.includes('oe');
      const enabled = includeOpenEnds && (isOtherSpecify ? includeOtherSpecifyOpenEnds : true);
      rules.push({
        id: `${qNum}_open_end_${Date.now()}_${idx}`,
        questionNumber: qNum,
        questionText: String(q.description || ''),
        questionType: 'open_end',
        checkTypeId: 'open_end',
        enabled,
        config: { minLength: 2, maxLength: 500, isOtherSpecify },
        createdAt: now,
        updatedAt: now,
      });
    }

    if (isGrid) {
      const statementCount = countStatementsFromDatamapQuestion(q);
      const gridMode = isOpenNumericGrid ? 'numeric_grid' : 'single_select_grid';

      rules.push({
        id: `${qNum}_straightlining_${Date.now()}_${idx}`,
        questionNumber: qNum,
        questionText: String(q.description || ''),
        questionType: inferred.questionType,
        checkTypeId: 'straightlining',
        enabled: true, // include all single-select grids by default
        config: {
          threshold: 80,
          statementCount,
          minAnsweredStatements: straightliningSettings.minStatementsRequired,
          weightReferenceStatements: straightliningSettings.weightReferenceStatements,
          maxWeight: straightliningSettings.maxWeight,
          gridMode,
        },
        createdAt: now,
        updatedAt: now,
      });
    }
  });

  return {
    projectId,
    rules,
    globalAggressiveness: {
      openEndAggressiveness: 50,
      straightliningAggressiveness: 50,
      speedingAggressiveness: 50,
      logicAggressiveness: 50,
    },
    createdAt: now,
    updatedAt: now,
  };
}

function getStorageKey(projectId: string) {
  return `dqv2_qualityPlan_${projectId}`;
}

function getSettingsKey(projectId: string) {
  return `dqv2_qualityPlanSettings_${projectId}`;
}

const isNumericGridCandidate = (rtLower: string, options: Array<{ code: string; label: string }>): boolean => {
  if (rtLower.includes('numeric')) return true;
  const hasNumericCodes = options.some((opt) => /^\d+(\.\d+)?$/.test(String(opt.code || '').trim()));
  if (rtLower.includes('values') && hasNumericCodes) return true;
  const hasBracketed = hasBracketsInResponseCodes(options);
  if (rtLower.includes('values') && hasBracketed) return true;
  return false;
};

export function QualityPlanView({
  projectId,
  datamapData,
  fullRawData,
  onResultsReady,
}: {
  projectId: string;
  datamapData: any;
  fullRawData?: { columns: string[]; rows: any[] } | null;
  onResultsReady?: (payload: DQV2RunResultsPayload) => void;
}) {
  const parsedQuestions: DatamapParsedQuestion[] = useMemo(() => {
    const arr = datamapData?.parsedQuestions;
    return Array.isArray(arr) ? arr : [];
  }, [datamapData?.parsedQuestions]);

  const getGridDotColor = (questionNumber: string): 'blue' | 'green' | null => {
    const key = normalizeQuestionNumberKey(questionNumber);
    if (!key) return null;
    const match = (parsedQuestions || []).find((q) => normalizeQuestionNumberKey(q?.questionNumber) === key);
    if (!match) return null;
    const qt = classifyDatamapQuestionType(match);
    if (qt === 'Numeric grid') return 'green';
    if (qt === 'Single select grid') return 'blue';
    return null;
  };

  const getStatementCountForQuestionNumber = (questionNumber: string): number | null => {
    const key = normalizeQuestionNumberKey(questionNumber);
    if (!key) return null;
    const match = (parsedQuestions || []).find((q) => normalizeQuestionNumberKey(q?.questionNumber) === key);
    if (!match) return null;
    const c = countStatementsFromDatamapQuestion(match);
    return Number.isFinite(c as any) ? c : null;
  };

  const repeatNumericsBaseKeysFromDatamap = useMemo(() => new Set<string>(), [parsedQuestions]);

  const [plan, setPlan] = useState<QualityPlan | null>(null);
  type SettingsModalId = 'speeding' | 'straightlining' | 'numeric_grids' | 'open_end' | null;
  const [settingsCheckType, setSettingsCheckType] = useState<SettingsModalId>(null);
  const [speedingThresholdMinutes, setSpeedingThresholdMinutes] = useState<number>(0);
  const [speedingUpperEnabled, setSpeedingUpperEnabled] = useState<boolean>(false);
  const [speedingUpperThresholdMinutes, setSpeedingUpperThresholdMinutes] = useState<number>(0);
  const [straightliningMinStatements, setStraightliningMinStatements] = useState<number>(4);
  const [straightliningMinStatementsInput, setStraightliningMinStatementsInput] = useState<string>('4');
  const [straightliningWeightReferenceStatements, setStraightliningWeightReferenceStatements] = useState<number>(10);
  const [straightliningWeightReferenceStatementsInput, setStraightliningWeightReferenceStatementsInput] = useState<string>('10');
  const [straightliningMaxWeight, setStraightliningMaxWeight] = useState<number>(20);
  const [straightliningMaxWeightInput, setStraightliningMaxWeightInput] = useState<string>('20');
  const [repeatNumericsMinValuesPerColumn, setRepeatNumericsMinValuesPerColumn] = useState<number>(2);
  const [repeatNumericsMinValuesPerColumnInput, setRepeatNumericsMinValuesPerColumnInput] = useState<string>('2');
  const [repeatNumericsMinConstantColumnsToFlag, setRepeatNumericsMinConstantColumnsToFlag] = useState<number>(1);
  const [repeatNumericsMinConstantColumnsToFlagInput, setRepeatNumericsMinConstantColumnsToFlagInput] = useState<string>('1');
  const [repeatNumericsMaxWeight, setRepeatNumericsMaxWeight] = useState<number>(20);
  const [repeatNumericsMaxWeightInput, setRepeatNumericsMaxWeightInput] = useState<string>('20');
  const [numericIncludeRepeat, setNumericIncludeRepeat] = useState<boolean>(true);
  const [numericIncludeOutliers, setNumericIncludeOutliers] = useState<boolean>(true);
  const [numericMinStatements, setNumericMinStatements] = useState<number>(3);
  const [numericMinStatementsInput, setNumericMinStatementsInput] = useState<string>('3');
  const [openEndEnabled, setOpenEndEnabled] = useState<boolean>(true);
  const [openEndEnabledInput, setOpenEndEnabledInput] = useState<boolean>(true);
  const [openEndIncludeOtherSpecify, setOpenEndIncludeOtherSpecify] = useState<boolean>(false);
  const [openEndIncludeOtherSpecifyInput, setOpenEndIncludeOtherSpecifyInput] = useState<boolean>(false);
  const [runningChecks, setRunningChecks] = useState(false);
  const [autoGeneratedOnce, setAutoGeneratedOnce] = useState(false);

  const qtimeStats = useMemo(() => {
    const rows = fullRawData?.rows || [];
    const values: number[] = [];
    rows.forEach((row: any) => {
      const raw = getRowValueLoose(row, 'qtime');
      if (raw === null || raw === undefined || raw === '') return;
      const num = typeof raw === 'number' ? raw : parseFloat(String(raw));
      if (Number.isFinite(num)) values.push(num);
    });
    const stats = computeMeanNoOutliers(values);
    const max = values.length > 0 ? Math.max(...values) : null;
    return { ...stats, max };
  }, [fullRawData?.rows]);

  const straightliningStatementCounts = useMemo(() => {
    const rules = plan?.rules || [];
    const cols = (fullRawData?.columns || []) as string[];
    const counts: number[] = [];

    const getStatementCountFromFile = (questionNumber: string) => {
      if (!Array.isArray(cols) || cols.length === 0) return null as number | null;
      const qn = String(questionNumber || '').trim();
      if (!qn) return null;

      const grid2d = getGrid2DCellInfosForQuestion(cols, qn);
      if (grid2d.length > 0) {
        return new Set(grid2d.map((c) => c.r)).size;
      }
      return getStraightlineColumnNamesForQuestion(cols, qn).length;
    };

    rules.forEach((r: any) => {
      if (r?.checkTypeId !== 'straightlining') return;
      const mode = String((r?.config as any)?.gridMode || '').toLowerCase();
      const numericGridColumns = (r?.config as any)?.numericGridColumns;
      const isRepeatNumerics = mode === 'numeric_grid' || (Array.isArray(numericGridColumns) && numericGridColumns.length > 0);
      if (isRepeatNumerics) return;

      const qNum = String(r?.questionNumber || '').trim();
      if (!qNum) return;

      const fromFile = getStatementCountFromFile(qNum);
      const fallback = Number((r?.config as any)?.statementCount);
      const count = Number.isFinite(fromFile as any) ? (fromFile as number) : (Number.isFinite(fallback) ? fallback : null);
      if (Number.isFinite(count as any) && (count as number) > 0) counts.push(Math.floor(count as number));
    });

    return counts;
  }, [plan?.rules, fullRawData?.columns]);

  const derivedStraightliningSettings = useMemo(() => {
    const minReq = Number.isFinite(straightliningMinStatements) && straightliningMinStatements > 0 ? straightliningMinStatements : 4;
    const eligible = straightliningStatementCounts.filter((c) => Number.isFinite(c) && c >= minReq);

    const referenceStatements = eligible.length > 0
      ? Math.ceil(eligible.reduce((a, b) => a + b, 0) / eligible.length)
      : minReq;
    const maxStatements = eligible.length > 0 ? Math.max(...eligible) : minReq;

    return { minReq, referenceStatements, maxStatements };
  }, [straightliningMinStatements, straightliningStatementCounts]);

  // Load local plan
  useEffect(() => {
    try {
      const stored = localStorage.getItem(getStorageKey(projectId));
      if (stored) {
        const parsed = JSON.parse(stored);
        if (parsed && typeof parsed === 'object') {
          setPlan(parsed);
          return;
        }
      }
    } catch {}
    setPlan(null);
  }, [projectId]);

  // Ensure all grid questions from the Data Map have straight-lining rules (including numeric grids).
  useEffect(() => {
    if (!plan) return;
    if (!parsedQuestions || parsedQuestions.length === 0) return;

    const existingKeys = new Set(
      (plan.rules || [])
        .filter((r) => r.checkTypeId === 'straightlining')
        .map((r) => normalizeQuestionNumberKey(r.questionNumber))
    );

    const additions: QualityRule[] = [];
    const now = new Date().toISOString();

    parsedQuestions.forEach((q, idx) => {
      const qNum = String(q.questionNumber || '').trim();
      if (!qNum) return;
      if (isHiddenQuestionNumber(qNum)) return;

      const inferred = inferQuestionTypeFromDatamap(q);
      if (inferred.questionType !== 'grid') return;

      const key = normalizeQuestionNumberKey(qNum);
      if (!key || existingKeys.has(key)) return;

      const rtLower = String(q.responseType || '').toLowerCase();
      const isOpenNumericGrid = rtLower.includes('open numeric') || rtLower.includes('numeric grid');
      const gridMode = isOpenNumericGrid ? 'numeric_grid' : 'single_select_grid';
      const statementCount = countStatementsFromDatamapQuestion(q);

      additions.push({
        id: `${qNum}_straightlining_${Date.now()}_${idx}_auto`,
        questionNumber: qNum,
        questionText: String(q.description || ''),
        questionType: 'grid',
        checkTypeId: 'straightlining',
        enabled: true,
        config: {
          threshold: 80,
          statementCount,
          minAnsweredStatements: straightliningMinStatements,
          weightReferenceStatements: straightliningWeightReferenceStatements,
          maxWeight: straightliningMaxWeight,
          gridMode,
        },
        createdAt: now,
        updatedAt: now,
      });
    });

    if (additions.length === 0) return;

    const nextPlan: QualityPlan = { ...plan, updatedAt: now, rules: [...(plan.rules || []), ...additions] };
    setPlan(nextPlan);
    try {
      localStorage.setItem(getStorageKey(projectId), JSON.stringify(nextPlan));
    } catch {}
  }, [plan, parsedQuestions, straightliningMinStatements, straightliningWeightReferenceStatements, straightliningMaxWeight, projectId]);

  // Ensure numeric grid questions have a selectable rule (gridMode=numeric_grid) for the Numeric Grids card.
  useEffect(() => {
    if (!plan) return;
    if (!parsedQuestions || parsedQuestions.length === 0) return;

    const existingNumericKeys = new Set(
      (plan.rules || [])
        .filter((r) => r.checkTypeId === 'straightlining')
        .filter((r) => String((r.config as any)?.gridMode || '').toLowerCase() === 'numeric_grid')
        .map((r) => normalizeQuestionNumberKey(r.questionNumber))
    );

    const additions: QualityRule[] = [];
    const now = new Date().toISOString();

    parsedQuestions.forEach((q, idx) => {
      const qNum = String(q.questionNumber || '').trim();
      if (!qNum) return;
      if (isHiddenQuestionNumber(qNum)) return;
      if (getGridDotColor(qNum) !== 'green') return;
      const stmtCount = countStatementsFromDatamapQuestion(q);

      const key = normalizeQuestionNumberKey(qNum);
      if (!key || existingNumericKeys.has(key)) return;

      const statementCount = countStatementsFromDatamapQuestion(q);

      additions.push({
        id: `${qNum}_numericGrid_${Date.now()}_${idx}`,
        questionNumber: qNum,
        questionText: String(q.description || ''),
        questionType: 'grid',
        checkTypeId: 'straightlining',
        enabled: Number.isFinite(stmtCount as any) ? (stmtCount as number) >= (numericMinStatements || 3) : true,
        config: {
          threshold: 80,
          statementCount,
          minAnsweredStatements: numericMinStatements || straightliningMinStatements,
          weightReferenceStatements: straightliningWeightReferenceStatements,
          maxWeight: straightliningMaxWeight,
          numericIncludeRepeat,
          numericIncludeOutliers,
          numericMinStatements: numericMinStatements || 3,
          gridMode: 'numeric_grid',
        },
        createdAt: now,
        updatedAt: now,
      });
    });

    if (additions.length === 0) return;

    const nextPlan: QualityPlan = { ...plan, updatedAt: now, rules: [...(plan.rules || []), ...additions] };
    setPlan(nextPlan);
    try {
      localStorage.setItem(getStorageKey(projectId), JSON.stringify(nextPlan));
    } catch {}
  }, [plan, parsedQuestions, projectId, straightliningMinStatements, straightliningWeightReferenceStatements, straightliningMaxWeight]);

  // Auto-generate a plan as soon as we have a Data Map (no button click needed).
  // Only runs when there is no stored plan yet (or it was cleared on new upload).
  useEffect(() => {
    if (autoGeneratedOnce) return;
    if (plan) return;
    if (!parsedQuestions || parsedQuestions.length === 0) return;

    const nextBase = createPlanFromDatamap(projectId, parsedQuestions);
    const now = new Date().toISOString();
    const defaultUnder = computeDefaultSpeedingUnderSeconds(qtimeStats as any);

    const next: QualityPlan = {
      ...nextBase,
      updatedAt: now,
      rules: (nextBase.rules || []).map((r) => {
        const isSpeedingQtime = r.checkTypeId === 'speeding' && String(r.questionNumber || '').toLowerCase() === 'qtime';
        if (!isSpeedingQtime) return r;
        // If we have a good default, persist it into the plan so "Run" works immediately
        if (defaultUnder === null) return r;
        return {
          ...r,
          updatedAt: now,
          config: {
            ...(r.config || {}),
            speedingThresholdSeconds: defaultUnder,
            // leave upper as-is unless user sets it
            ...(Object.prototype.hasOwnProperty.call(r.config || {}, 'speedingUpperThresholdSeconds') ? {} : { speedingUpperThresholdSeconds: null }),
          },
        };
      }),
    };

    setPlan(next);
    try {
      localStorage.setItem(getStorageKey(projectId), JSON.stringify(next));
    } catch {}
    setAutoGeneratedOnce(true);
  }, [autoGeneratedOnce, plan, parsedQuestions, projectId, qtimeStats]);

  // Reset the one-shot guard when project changes (so new projects can auto-generate)
  useEffect(() => {
    setAutoGeneratedOnce(false);
  }, [projectId]);

  // Load local settings (dqv2 only)
  useEffect(() => {
    try {
      const stored = localStorage.getItem(getSettingsKey(projectId));
      if (stored) {
        const parsed = JSON.parse(stored);

        const v = Number(parsed?.straightliningMinStatements);
        if (Number.isFinite(v) && v > 0) {
          setStraightliningMinStatements(v);
          setStraightliningMinStatementsInput(String(v));
        }

        const ref = Number(parsed?.straightliningWeightReferenceStatements);
        if (Number.isFinite(ref) && ref > 0) {
          setStraightliningWeightReferenceStatements(ref);
          setStraightliningWeightReferenceStatementsInput(String(ref));
        } else {
          setStraightliningWeightReferenceStatements(10);
          setStraightliningWeightReferenceStatementsInput('10');
        }

        const mw = Number(parsed?.straightliningMaxWeight);
        if (Number.isFinite(mw) && mw > 0) {
          setStraightliningMaxWeight(mw);
          setStraightliningMaxWeightInput(String(mw));
        } else {
          setStraightliningMaxWeight(20);
          setStraightliningMaxWeightInput('20');
        }

        const rnMin = Number(parsed?.repeatNumericsMinValuesPerColumn);
        if (Number.isFinite(rnMin) && rnMin > 0) {
          setRepeatNumericsMinValuesPerColumn(rnMin);
          setRepeatNumericsMinValuesPerColumnInput(String(rnMin));
        } else {
          setRepeatNumericsMinValuesPerColumn(2);
          setRepeatNumericsMinValuesPerColumnInput('2');
        }

        const rnCols = Number(parsed?.repeatNumericsMinConstantColumnsToFlag);
        if (Number.isFinite(rnCols) && rnCols > 0) {
          setRepeatNumericsMinConstantColumnsToFlag(rnCols);
          setRepeatNumericsMinConstantColumnsToFlagInput(String(rnCols));
        } else {
          setRepeatNumericsMinConstantColumnsToFlag(1);
          setRepeatNumericsMinConstantColumnsToFlagInput('1');
        }

        const rnMw = Number(parsed?.repeatNumericsMaxWeight);
        if (Number.isFinite(rnMw) && rnMw > 0) {
          setRepeatNumericsMaxWeight(rnMw);
          setRepeatNumericsMaxWeightInput(String(rnMw));
        } else {
          setRepeatNumericsMaxWeight(20);
          setRepeatNumericsMaxWeightInput('20');
        }

        if (parsed?.numericIncludeRepeat !== undefined) setNumericIncludeRepeat(!!parsed.numericIncludeRepeat);
        if (parsed?.numericIncludeOutliers !== undefined) setNumericIncludeOutliers(!!parsed.numericIncludeOutliers);
        const nm = Number(parsed?.numericMinStatements);
        if (Number.isFinite(nm) && nm > 0) {
          setNumericMinStatements(nm);
          setNumericMinStatementsInput(String(nm));
        } else {
          setNumericMinStatements(3);
          setNumericMinStatementsInput('3');
        }

        const oeEnabled = parsed?.openEndEnabled === undefined ? true : Boolean(parsed?.openEndEnabled);
        setOpenEndEnabled(oeEnabled);
        setOpenEndEnabledInput(oeEnabled);

        const includeOE = Boolean(parsed?.openEndIncludeOtherSpecify);
        setOpenEndIncludeOtherSpecify(includeOE);
        setOpenEndIncludeOtherSpecifyInput(includeOE);
        return;
      }
    } catch {}
    setStraightliningMinStatements(4);
    setStraightliningMinStatementsInput('4');
    setStraightliningWeightReferenceStatements(10);
    setStraightliningWeightReferenceStatementsInput('10');
    setStraightliningMaxWeight(20);
    setStraightliningMaxWeightInput('20');
    setRepeatNumericsMinValuesPerColumn(2);
    setRepeatNumericsMinValuesPerColumnInput('2');
    setRepeatNumericsMinConstantColumnsToFlag(1);
    setRepeatNumericsMinConstantColumnsToFlagInput('1');
    setRepeatNumericsMaxWeight(20);
    setRepeatNumericsMaxWeightInput('20');
    setNumericIncludeRepeat(true);
    setNumericIncludeOutliers(true);
    setNumericMinStatements(3);
    setNumericMinStatementsInput('3');
    setOpenEndEnabled(true);
    setOpenEndEnabledInput(true);
    setOpenEndIncludeOtherSpecify(false);
    setOpenEndIncludeOtherSpecifyInput(false);
  }, [projectId]);

  const rulesByCard = useMemo(() => {
    const rules = plan?.rules || [];

    const numericGridCandidates = Array.isArray(parsedQuestions)
      ? parsedQuestions.map((q) => {
          const qNum = String(q?.questionNumber || '').trim();
          const hidden = isHiddenQuestionNumber(qNum);
          const dot = getGridDotColor(qNum);
          return { q, qNum, hidden, dot };
        })
      : [];

    const speeding = rules.filter((r) => r.checkTypeId === 'speeding');
    const open_end = rules.filter((r) => r.checkTypeId === 'open_end');
    const straightlining = rules
      .filter((r) => r.checkTypeId === 'straightlining')
      .filter((r) => getGridDotColor(r.questionNumber) === 'blue');

    // Numeric grids: use plan rules when available; fallback to Data Map green-dot questions (display-only).
    const planNumericRules = rules
      .filter((r) => r.checkTypeId === 'straightlining')
      .filter((r) => String((r.config as any)?.gridMode || '').toLowerCase() === 'numeric_grid')
      .filter((r) => getGridDotColor(r.questionNumber) === 'green');

    let numeric_grids: any[] = planNumericRules;

    if (numeric_grids.length === 0) {
      numeric_grids = numericGridCandidates
        .filter((item) => {
          if (!item.qNum) return false;
          if (item.hidden) return false;
          return item.dot === 'green';
        })
        .map((item, idx) => {
          const stmtCount = countStatementsFromDatamapQuestion(item.q);
          const minReq = numericMinStatements || 3;
          const meetsMin = !Number.isFinite(stmtCount as any) || (stmtCount as number) >= minReq;
          return {
            id: `numeric_grid_${idx}_${item.qNum || 'q'}`,
            questionNumber: item.qNum,
            questionText: String(item.q?.description || ''),
            enabled: meetsMin,
            displayOnly: true,
            statementCount: stmtCount,
          };
        }) as any[];

      try {
        const allParsed = Array.isArray(parsedQuestions) ? parsedQuestions.length : 0;
        console.debug('[DQ][QP] Numeric grid build (fallback)', {
          parsedQuestions: allParsed,
          numericGridCount: numeric_grids.length,
          sampleNumericGrids: numeric_grids.slice(0, 5).map((n) => n.questionNumber),
        });
      } catch {
        /* noop */
      }
    } else {
      try {
        console.debug('[DQ][QP] Numeric grid build (plan rules)', {
          numericGridCount: numeric_grids.length,
          sampleNumericGrids: numeric_grids.slice(0, 5).map((n) => n.questionNumber),
        });
      } catch {
        /* noop */
      }
    }

    try {
      // Debug counts for numeric grids to diagnose missing items
      const allParsed = Array.isArray(parsedQuestions) ? parsedQuestions.length : 0;
      const hiddenCount = numericGridCandidates.filter((c) => c.hidden).length;
      const numericFlagged = numericGridCandidates.filter((c) => c.dot === 'green').length;
      const rtCounts = new Map<string, number>();
      numericGridCandidates.forEach((c) => {
        const rt = String(c.q?.responseType || '').toLowerCase();
        rtCounts.set(rt, (rtCounts.get(rt) || 0) + 1);
      });
      const responseTypeSummary = Array.from(rtCounts.entries())
        .sort((a, b) => b[1] - a[1])
        .slice(0, 10)
        .map(([rt, n]) => `${rt || '(empty)'}: ${n}`);

      const sampleNumericRTs = numericGridCandidates
        .filter((c) => c.dot === 'green')
        .slice(0, 5)
        .map((c) => ({
          q: c.qNum,
          rt: String(c.q?.responseType || ''),
          codes: (normalizeOptions(c.q || {}).slice(0, 3) || []).map((o) => o.code),
          statements: getStatementCountForQuestionNumber(c.qNum),
        }));

      const sampleNonNumeric = numericGridCandidates
        .filter((c) => c.dot !== 'green' && !c.hidden)
        .slice(0, 5)
        .map((c) => ({
          q: c.qNum,
          rt: String(c.q?.responseType || ''),
          codes: (normalizeOptions(c.q || {}).slice(0, 3) || []).map((o) => o.code),
          statements: getStatementCountForQuestionNumber(c.qNum),
        }));

      console.debug('[DQ][QP] Numeric grid build', {
        parsedQuestions: allParsed,
        numericGridCount: numeric_grids.length,
        numericFlagged,
        hiddenCount,
        minStatementsRequired: numericMinStatements || 3,
        sampleNumericGrids: numeric_grids.slice(0, 5).map((n) => n.questionNumber),
        sampleNumericRTs,
        sampleNonNumeric,
        responseTypeSummary,
      });
    } catch {
      /* noop */
    }

    return { speeding, open_end, straightlining, numeric_grids };
  }, [plan?.rules, parsedQuestions, fullRawData?.columns, repeatNumericsBaseKeysFromDatamap, numericMinStatements]);

  const numericGridEligibilityByRuleId = useMemo(() => {
    return new Map<string, { included: boolean; reason: string | null }>();
  }, [rulesByCard.numeric_grids, fullRawData?.columns]);

  // Enforce numeric grid min statements: auto-disable any numeric grid rule below the min.
  useEffect(() => {
    if (!plan) return;
    if (!Array.isArray(plan.rules) || plan.rules.length === 0) return;
    const minReq = numericMinStatements || 3;
    const now = new Date().toISOString();

    let changed = false;
    const nextRules = plan.rules.map((r) => {
      if (r.checkTypeId !== 'straightlining') return r;
      const mode = String((r.config as any)?.gridMode || '').toLowerCase();
      if (mode !== 'numeric_grid') return r;
      const dot = getGridDotColor(r.questionNumber);
      if (dot !== 'green') return r;
      const stmtCount = getStatementCountForQuestionNumber(r.questionNumber);
      if (Number.isFinite(stmtCount as any)) {
        const meets = (stmtCount as number) >= minReq;
        if (!meets && r.enabled) {
          changed = true;
          return { ...r, enabled: false, updatedAt: now };
        }
        if (meets && !r.enabled) {
          changed = true;
          return { ...r, enabled: true, updatedAt: now };
        }
      }
      return r;
    });

    if (!changed) return;
    const nextPlan: QualityPlan = { ...plan, updatedAt: now, rules: nextRules };
    setPlan(nextPlan);
    try {
      localStorage.setItem(getStorageKey(projectId), JSON.stringify(nextPlan));
    } catch {}
  }, [plan, numericMinStatements, parsedQuestions, projectId]);

  // Enforce: numeric grids that are not included cannot be enabled
  const numericGridEligibilityAppliedRef = useRef(false);
  useEffect(() => {
    if (numericGridEligibilityAppliedRef.current) return;
    if (!plan) return;
    if (!Array.isArray(plan.rules) || plan.rules.length === 0) return;
    if (!numericGridEligibilityByRuleId || numericGridEligibilityByRuleId.size === 0) return;

    let changed = false;
    const now = new Date().toISOString();
    const nextRules = plan.rules.map((r) => {
      if (r.checkTypeId !== 'straightlining') return r;
      const eligibility = numericGridEligibilityByRuleId.get(r.id);
      if (!eligibility) return r;
      if (eligibility.included) return r;
      if (!r.enabled) return r;
      changed = true;
      return { ...r, enabled: false, updatedAt: now };
    });

    numericGridEligibilityAppliedRef.current = true;
    if (!changed) return;

    const nextPlan: QualityPlan = { ...plan, updatedAt: now, rules: nextRules };
    setPlan(nextPlan);
    try {
      localStorage.setItem(getStorageKey(projectId), JSON.stringify(nextPlan));
    } catch {}
  }, [plan, numericGridEligibilityByRuleId, projectId]);

  const countsByCard = useMemo(() => {
    return {
      speeding: rulesByCard.speeding.length,
      open_end: rulesByCard.open_end.length,
      straightlining: rulesByCard.straightlining.length,
      numeric_grids: rulesByCard.numeric_grids.length,
    };
  }, [rulesByCard]);

  const getCardMeta = (id: QualityPlanCardId) => {
    if (id === 'speeding') return { icon: ClockIcon, bgClass: 'bg-red-100 border border-red-200', color: '#EF4444' };
    if (id === 'numeric_grids') return { icon: CalculatorIcon, bgClass: 'bg-orange-100 border border-orange-200', color: BRAND_ORANGE };
    if (id === 'straightlining') return { icon: Bars3Icon, bgClass: 'bg-amber-100 border border-amber-200', color: '#F59E0B' };
    if (id === 'open_end') return { icon: ChatBubbleBottomCenterTextIcon, bgClass: 'bg-purple-100 border border-purple-200', color: '#8B5CF6' };
    return { icon: null, bgClass: 'bg-gray-100 border border-gray-200', color: '#6B7280' };
  };

  const handleGenerate = () => {
    const nextBase = createPlanFromDatamap(projectId, parsedQuestions);
    const now = new Date().toISOString();

    const defaultUnder = computeDefaultSpeedingUnderSeconds(qtimeStats as any);
    const next: QualityPlan = {
      ...nextBase,
      updatedAt: now,
      rules: (nextBase.rules || []).map((r) => {
        const isSpeedingQtime = r.checkTypeId === 'speeding' && String(r.questionNumber || '').toLowerCase() === 'qtime';
        if (!isSpeedingQtime) return r;
        // If we have a good default, persist it into the plan so "Run" works immediately
        if (defaultUnder === null) return r;
        return {
          ...r,
          updatedAt: now,
          config: {
            ...(r.config || {}),
            speedingThresholdSeconds: defaultUnder,
            // leave upper as-is unless user sets it
            ...(Object.prototype.hasOwnProperty.call(r.config || {}, 'speedingUpperThresholdSeconds') ? {} : { speedingUpperThresholdSeconds: null }),
          },
        };
      }),
    };

    setPlan(next);
    try {
      localStorage.setItem(getStorageKey(projectId), JSON.stringify(next));
    } catch {}
  };

  const handleToggleRule = (ruleId: string) => {
    if (!plan) return;
    const now = new Date().toISOString();
    const next: QualityPlan = {
      ...plan,
      updatedAt: now,
      rules: (plan.rules || []).map((r) => (r.id === ruleId ? { ...r, enabled: !r.enabled, updatedAt: now } : r)),
    };
    setPlan(next);
    try {
      localStorage.setItem(getStorageKey(projectId), JSON.stringify(next));
    } catch {}
  };

  const speedingRule = useMemo(() => {
    if (!plan?.rules) return null;
    return plan.rules.find((r) => r.checkTypeId === 'speeding' && String(r.questionNumber || '').toLowerCase() === 'qtime') || null;
  }, [plan?.rules]);

  const openSpeedingSettings = () => {
    setSettingsCheckType('speeding');

    const currentSeconds = (speedingRule?.config as any)?.speedingThresholdSeconds;
    const hasCurrentUnder = currentSeconds !== undefined && currentSeconds !== null && Number.isFinite(Number(currentSeconds));
    if (hasCurrentUnder) setSpeedingThresholdMinutes(Number(currentSeconds) / 60);

    const currentUpperSeconds = (speedingRule?.config as any)?.speedingUpperThresholdSeconds;
    const hasCurrentUpper = currentUpperSeconds !== undefined && currentUpperSeconds !== null && Number.isFinite(Number(currentUpperSeconds));
    if (hasCurrentUpper) {
      setSpeedingUpperEnabled(true);
      setSpeedingUpperThresholdMinutes(Number(currentUpperSeconds) / 60);
    } else {
      setSpeedingUpperEnabled(false);
    }

    // Under default
    if (!hasCurrentUnder) {
      const defaultSeconds = computeDefaultSpeedingUnderSeconds(qtimeStats as any);
      setSpeedingThresholdMinutes(Number.isFinite(defaultSeconds as any) ? Number(defaultSeconds) / 60 : 0);
    }

    // Over default (only if no saved upper)
    if (!hasCurrentUpper) {
      const defaultUpperSeconds = computeDefaultSpeedingOverSeconds(qtimeStats as any);
      setSpeedingUpperThresholdMinutes(Number.isFinite(defaultUpperSeconds as any) ? Number(defaultUpperSeconds) / 60 : 0);
    }

    // Clamp sliders to their computed maxima (if available):
    // - Under: 60% of ALL-ROWS median
    // - Over: 3x ALL-ROWS median
    const medianAllSeconds = (qtimeStats as any)?.median ?? null;
    const medianAllMinutes = Number.isFinite(Number(medianAllSeconds)) ? Number(medianAllSeconds) / 60 : null;
    const underMaxMinutes = medianAllMinutes !== null && Number.isFinite(medianAllMinutes) && medianAllMinutes > 0 ? medianAllMinutes * 0.6 : null;
    const overMinMinutes = medianAllMinutes !== null && Number.isFinite(medianAllMinutes) && medianAllMinutes > 0 ? medianAllMinutes * 1.6 : null;

    const overMaxMinutes = medianAllMinutes !== null && Number.isFinite(medianAllMinutes) && medianAllMinutes > 0 ? medianAllMinutes * 3 : null;

    if (underMaxMinutes !== null) {
      setSpeedingThresholdMinutes((v) => (Number.isFinite(v) ? Math.min(v, underMaxMinutes) : v));
    }
    if (overMaxMinutes !== null) {
      setSpeedingUpperThresholdMinutes((v) => {
        if (!Number.isFinite(v)) return v;
        let next = Math.min(v, overMaxMinutes);
        if (overMinMinutes !== null) next = Math.max(next, overMinMinutes);
        return next;
      });
    }
  };

  const openStraightliningSettings = () => {
    setSettingsCheckType('straightlining');
    setStraightliningMinStatementsInput(String(straightliningMinStatements || 4));
    setStraightliningWeightReferenceStatementsInput(String(derivedStraightliningSettings.referenceStatements));
    setStraightliningMaxWeightInput(String(derivedStraightliningSettings.maxStatements));
  };
  const openNumericGridSettings = () => {
    setSettingsCheckType('numeric_grids');
  };

  const openOpenEndSettings = () => {
    setSettingsCheckType('open_end');
    setOpenEndEnabledInput(!!openEndEnabled);
    setOpenEndIncludeOtherSpecifyInput(!!openEndIncludeOtherSpecify);
  };

  const saveNumericGridSettings = () => {
    const parsedMin = Number(numericMinStatementsInput);
    const nextMin = Number.isFinite(parsedMin) && parsedMin > 0 ? Math.floor(parsedMin) : 3;
    setNumericMinStatements(nextMin);
    setNumericMinStatementsInput(String(nextMin));

    try {
      const existingRaw = localStorage.getItem(getSettingsKey(projectId));
      const existing = existingRaw ? JSON.parse(existingRaw) : {};
      localStorage.setItem(
        getSettingsKey(projectId),
        JSON.stringify({
          ...(existing || {}),
          numericIncludeRepeat,
          numericIncludeOutliers,
          numericMinStatements: nextMin,
        })
      );
    } catch {
      try {
        localStorage.setItem(
          getSettingsKey(projectId),
          JSON.stringify({
            numericIncludeRepeat,
            numericIncludeOutliers,
            numericMinStatements: nextMin,
          })
        );
      } catch {}
    }
    setSettingsCheckType(null);
  };

  const saveOpenEndSettings = () => {
    const nextEnabled = !!openEndEnabledInput;
    const nextInclude = !!openEndIncludeOtherSpecifyInput;
    setOpenEndEnabled(nextEnabled);
    setOpenEndIncludeOtherSpecify(nextInclude);

    try {
      const existingRaw = localStorage.getItem(getSettingsKey(projectId));
      const existing = existingRaw ? JSON.parse(existingRaw) : {};
      localStorage.setItem(
        getSettingsKey(projectId),
        JSON.stringify({ ...(existing || {}), openEndEnabled: nextEnabled, openEndIncludeOtherSpecify: nextInclude })
      );
    } catch {
      try {
        localStorage.setItem(getSettingsKey(projectId), JSON.stringify({ openEndEnabled: nextEnabled, openEndIncludeOtherSpecify: nextInclude }));
      } catch {}
    }

    // Re-apply to existing open_end rules (bulk enable/disable + OE other/specify behavior)
    if (plan) {
      const now = new Date().toISOString();
      const nextPlan: QualityPlan = {
        ...plan,
        updatedAt: now,
        rules: plan.rules.map((r) => {
          if (r.checkTypeId !== 'open_end') return r;
          const qn = String(r.questionNumber || '').toLowerCase();
          const isOtherSpecify = qn.includes('oe');
          return {
            ...r,
            updatedAt: now,
            enabled: nextEnabled && (isOtherSpecify ? nextInclude : true),
            config: { ...(r.config || {}), isOtherSpecify },
          };
        }),
      };

      setPlan(nextPlan);
      try {
        localStorage.setItem(getStorageKey(projectId), JSON.stringify(nextPlan));
      } catch {}
    }

    setSettingsCheckType(null);
  };

  const saveStraightliningSettings = () => {
    const parsed = Number(straightliningMinStatementsInput);
    if (!Number.isFinite(parsed) || parsed <= 0) {
      alert('Please enter a valid number of statements.');
      return;
    }

    const nextMin = Math.floor(parsed);

    // Recompute derived settings using the NEW min requirement.
    const eligible = straightliningStatementCounts.filter((c) => Number.isFinite(c) && c >= nextMin);
    const nextRef = eligible.length > 0 ? Math.ceil(eligible.reduce((a, b) => a + b, 0) / eligible.length) : nextMin;
    const nextMaxWeight = eligible.length > 0 ? Math.max(...eligible) : nextMin;

    setStraightliningMinStatements(nextMin);
    setStraightliningWeightReferenceStatements(nextRef);
    setStraightliningMaxWeight(nextMaxWeight);
    setStraightliningWeightReferenceStatementsInput(String(nextRef));
    setStraightliningMaxWeightInput(String(nextMaxWeight));
    try {
      const existingRaw = localStorage.getItem(getSettingsKey(projectId));
      const existing = existingRaw ? JSON.parse(existingRaw) : {};
      localStorage.setItem(
        getSettingsKey(projectId),
        JSON.stringify({
          ...(existing || {}),
          straightliningMinStatements: nextMin,
        })
      );
    } catch {}

    // Re-apply threshold to existing straightlining rules (bulk enable/disable by statement count)
    if (plan) {
      const now = new Date().toISOString();
      const countsByQnum = new Map<string, number>();
      parsedQuestions.forEach((q) => {
        const qNum = String(q.questionNumber || '').trim();
        if (!qNum) return;
        countsByQnum.set(qNum, countStatementsFromDatamapQuestion(q));
      });
      const cols = (fullRawData?.columns || []) as string[];

      const statementCountFromFile = (questionNumber: string) => {
        if (!Array.isArray(cols) || cols.length === 0) return null as number | null;
        const qn = String(questionNumber || '').trim();
        if (!qn) return null;
        const grid2d = getGrid2DCellInfosForQuestion(cols, qn);
        if (grid2d.length > 0) return new Set(grid2d.map((c) => c.r)).size;
        return getStraightlineColumnNamesForQuestion(cols, qn).length;
      };

      const nextPlan: QualityPlan = {
        ...plan,
        updatedAt: now,
        rules: plan.rules.map((r) => {
          if (r.checkTypeId !== 'straightlining') return r;
          const mode = String((r.config as any)?.gridMode || '').toLowerCase();
          const numericGridColumns = (r.config as any)?.numericGridColumns;
          const isRepeatNumerics = mode === 'numeric_grid' || (Array.isArray(numericGridColumns) && numericGridColumns.length > 0);
          if (isRepeatNumerics) return r;

          const qn = String(r.questionNumber || '').trim();
          const countFromFile = statementCountFromFile(qn);
          const count = Number.isFinite(countFromFile as any)
            ? (countFromFile as number)
            : (countsByQnum.get(qn) ?? (r.config as any)?.statementCount ?? 0);
          return {
            ...r,
            updatedAt: now,
            enabled: Number(count) >= nextMin,
            config: {
              ...(r.config || {}),
              statementCount: count,
              minAnsweredStatements: nextMin,
              weightReferenceStatements: nextRef,
              maxWeight: nextMaxWeight,
            },
          };
        }),
      };

      setPlan(nextPlan);
      try {
        localStorage.setItem(getStorageKey(projectId), JSON.stringify(nextPlan));
      } catch {}
    }

    setSettingsCheckType(null);
  };

  const saveRepeatNumericsSettings = () => {
    const parsedMinValues = Number(repeatNumericsMinValuesPerColumnInput);
    if (!Number.isFinite(parsedMinValues) || parsedMinValues <= 0) {
      alert('Please enter a valid minimum values-per-column.');
      return;
    }

    const parsedMinCols = Number(repeatNumericsMinConstantColumnsToFlagInput);
    if (!Number.isFinite(parsedMinCols) || parsedMinCols <= 0) {
      alert('Please enter a valid minimum constant-columns-to-flag.');
      return;
    }

    const parsedMaxWeight = Number(repeatNumericsMaxWeightInput);
    if (!Number.isFinite(parsedMaxWeight) || parsedMaxWeight <= 0) {
      alert('Please enter a valid max weight.');
      return;
    }

    const nextMinValues = Math.floor(parsedMinValues);
    const nextMinCols = Math.floor(parsedMinCols);
    const nextMaxWeight = Math.floor(parsedMaxWeight);

    setRepeatNumericsMinValuesPerColumn(nextMinValues);
    setRepeatNumericsMinConstantColumnsToFlag(nextMinCols);
    setRepeatNumericsMaxWeight(nextMaxWeight);

    try {
      const existingRaw = localStorage.getItem(getSettingsKey(projectId));
      const existing = existingRaw ? JSON.parse(existingRaw) : {};
      localStorage.setItem(
        getSettingsKey(projectId),
        JSON.stringify({
          ...(existing || {}),
          repeatNumericsMinValuesPerColumn: nextMinValues,
          repeatNumericsMinConstantColumnsToFlag: nextMinCols,
          repeatNumericsMaxWeight: nextMaxWeight,
        })
      );
    } catch {}

    // Re-apply to existing Repeat Numerics rules (bulk update)
    if (plan) {
      const now = new Date().toISOString();
      const allCols = fullRawData?.columns || [];
      const nextPlan: QualityPlan = {
        ...plan,
        updatedAt: now,
        rules: (plan.rules || []).map((r) => {
          if (r.checkTypeId !== 'straightlining') return r;
          const mode = String((r.config as any)?.gridMode || '').toLowerCase();
          const cols = (r.config as any)?.numericGridColumns;
          const isGrouped = mode === 'numeric_grid' && Array.isArray(cols) && cols.length > 0;
          const isLegacy2D = Array.isArray(allCols) && allCols.length > 0
            ? getGrid2DCellInfosForQuestion(allCols, String(r.questionNumber || '')).length > 0
            : false;
          if (!isGrouped && !isLegacy2D) return r;
          return {
            ...r,
            updatedAt: now,
            config: {
              ...(r.config || {}),
              minValuesPerColumn: nextMinValues,
              minConstantColumnsToFlag: nextMinCols,
              maxWeight: nextMaxWeight,
            },
          };
        }),
      };

      setPlan(nextPlan);
      try {
        localStorage.setItem(getStorageKey(projectId), JSON.stringify(nextPlan));
      } catch {}
    }

    setSettingsCheckType(null);
  };

  const saveSpeedingSettings = () => {
    if (!plan || !speedingRule) {
      setSettingsCheckType(null);
      return;
    }

    const minutes = Number(speedingThresholdMinutes);
    if (!Number.isFinite(minutes) || minutes < 0) {
      alert('Please choose a valid threshold.');
      return;
    }
    const parsedSeconds = Math.round(minutes * 60);

    let parsedUpperSeconds: number | null = null;
    if (speedingUpperEnabled) {
      const upperMinutes = Number(speedingUpperThresholdMinutes);
      if (!Number.isFinite(upperMinutes) || upperMinutes < 0) {
        alert('Please choose a valid upper threshold.');
        return;
      }
      parsedUpperSeconds = Math.round(upperMinutes * 60);
    }

    const now = new Date().toISOString();
    const next: QualityPlan = {
      ...plan,
      updatedAt: now,
      rules: plan.rules.map((r) => {
        if (r.id !== speedingRule.id) return r;
        return {
          ...r,
          updatedAt: now,
          config: {
            ...(r.config || {}),
            speedingThresholdSeconds: parsedSeconds,
            speedingUpperThresholdSeconds: parsedUpperSeconds,
          },
        };
      }),
    };

    setPlan(next);
    try {
      localStorage.setItem(getStorageKey(projectId), JSON.stringify(next));
    } catch {}

    setSettingsCheckType(null);
  };

  const runQualityChecks = async () => {
    if (!plan) return;
    const rows = fullRawData?.rows || [];
    if (rows.length === 0) return;
    const columns = fullRawData?.columns || [];

    setRunningChecks(true);
    // Small delay so the spinner is visible even on fast runs
    await new Promise((r) => setTimeout(r, 150));

    try {
      const enabledRules = (plan.rules || []).filter((r) => r.enabled);

      const getCellValue = (row: any, header: string) => {
        // Rows can be objects OR arrays aligned to fullRawData.columns
        if (Array.isArray(row)) {
          const target = normalizeHeaderKey(header);
          const idx = columns.findIndex((c) => normalizeHeaderKey(c) === target);
          return idx >= 0 ? row[idx] : undefined;
        }
        // Some pipelines store values under { columns: { ... } }
        if (row && typeof row === 'object' && row.columns && typeof row.columns === 'object') {
          return getRowValueLoose(row.columns, header);
        }
        return getRowValueLoose(row, header);
      };

      const extractDataMapHeaderTokens = (value: string): string[] => {
        const out: string[] = [];
        const raw = String(value || '').trim();
        if (!raw) return out;

        // Existing bracket/paren token extraction
        extractBracketTokens(raw).forEach((t) => out.push(t));

        // ${token} tokens
        const re = /\$\{([^}]+)\}/g;
        let m: RegExpExecArray | null;
        re.lastIndex = 0;
        while ((m = re.exec(raw)) !== null) {
          const t = String(m[1] || '').trim();
          if (t) out.push(t);
        }

        // Header-like raw strings (only if they contain letters + separators)
        if (/[a-z]/i.test(raw) && /[._]/.test(raw)) out.push(raw);
        return out;
      };

      const getNumericGridRowHeadersForSubQuestion = (candidateCols: string[], subQ: string): string[] => {
        const subKey = normalizeQuestionNumberKey(subQ);
        const dm = (parsedQuestions || []).find((q) => normalizeQuestionNumberKey(q?.questionNumber) === subKey) || null;
        const tokens: string[] = [];
        (dm?.responseCodes || []).forEach((rc) => {
          const parts = [rc?.code, rc?.label, rc?.text].map((v) => String(v || '')).filter(Boolean);
          parts.forEach((p) => extractDataMapHeaderTokens(p).forEach((t) => tokens.push(t)));
        });

        const uniq = Array.from(new Set(tokens.map((t) => String(t || '').trim()).filter(Boolean)));
        if (uniq.length > 0) {
          const colKeys = new Set(candidateCols.map((c) => normalizeHeaderKey(c)));
          const present = uniq.filter((t) => colKeys.has(normalizeHeaderKey(t)));
          return present.length > 0 ? present : uniq;
        }

        // Legacy fallback: headers like QS11c1r1, QS11c1r2...
        return getStraightlineColumnNamesForQuestion(candidateCols, subQ);
      };

      // Speeding thresholds are stored on the global qtime speeding rule config (defaults if missing)
      const speedingRule = enabledRules.find(
        (r) => r.checkTypeId === 'speeding' && String(r.questionNumber || '').toLowerCase() === 'qtime'
      );

      const loiSecondsForSpeeding = (() => {
        const v = (qtimeStats as any)?.median ?? (qtimeStats as any)?.meanNoOutliers ?? (qtimeStats as any)?.mean ?? null;
        return Number.isFinite(Number(v)) ? Number(v) : null;
      })();
      const hardMaxSpeedingOverSeconds = loiSecondsForSpeeding !== null ? Math.round(loiSecondsForSpeeding * 3) : null;

      const underFromConfig = Number((speedingRule?.config as any)?.speedingThresholdSeconds);
      const defaultUnder = computeDefaultSpeedingUnderSeconds(qtimeStats as any);
      const speedingUnderSeconds = Number.isFinite(underFromConfig) && underFromConfig > 0
        ? underFromConfig
        : (defaultUnder ?? NaN);

      const overFromConfig = (speedingRule?.config as any)?.speedingUpperThresholdSeconds;
      const defaultOver = computeDefaultSpeedingOverSeconds(qtimeStats as any);
      const speedingOverSecondsNum = overFromConfig === null || overFromConfig === undefined
        ? null
        : Number(overFromConfig);

      // Detect "common" straight-lining flags (>= 90% of eligible respondents flagged) and suppress them globally.
      // Eligible = respondent has >= minAnsweredStatements for that SL question.
      const COMMON_SL_RATE = 0.9;
      const slStatsByRuleId = new Map<string, { eligible: number; triggered: number }>();
      enabledRules.forEach((r) => {
        if (r.checkTypeId !== 'straightlining') return;
        const mode = String((r.config as any)?.gridMode || '').toLowerCase();
        const numericGridColumns = (r.config as any)?.numericGridColumns;
        const isGroupedRepeatNumerics = mode === 'numeric_grid' && Array.isArray(numericGridColumns) && numericGridColumns.length > 0;
        const is2DRepeatNumerics = Array.isArray(columns) && columns.length > 0
          ? getGrid2DCellInfosForQuestion(columns, String(r.questionNumber || '')).length > 0
          : false;
        // Repeat Numerics should NOT be part of "common straightlining suppression"
        if (isGroupedRepeatNumerics || is2DRepeatNumerics) return;
        slStatsByRuleId.set(r.id, { eligible: 0, triggered: 0 });
      });

      enabledRules.forEach((rule) => {
        if (rule.checkTypeId !== 'straightlining') return;
        const qNum = String(rule.questionNumber || '').trim();
        if (!qNum) return;

        const stat = slStatsByRuleId.get(rule.id);
        if (!stat) return;

        rows.forEach((row) => {
          const candidateCols = Array.isArray(row) ? columns : Object.keys(row || {});

          // If this looks like a 2D numeric grid (r#c#), evaluate repeats by COLUMN (cN).
          const grid2d = getGrid2DCellInfosForQuestion(candidateCols, qNum);
          if (grid2d.length > 0) {
            const minValuesPerColumn = Number((rule.config as any)?.minValuesPerColumn ?? 2);
            const minConstantColumnsToFlag = Number((rule.config as any)?.minConstantColumnsToFlag ?? 1);
            if (!Number.isFinite(minValuesPerColumn) || minValuesPerColumn <= 0) return;
            if (!Number.isFinite(minConstantColumnsToFlag) || minConstantColumnsToFlag <= 0) return;

            const valuesByC = new Map<number, number[]>();
            const allC = new Set<number>();

            grid2d.forEach((cell) => {
              allC.add(cell.c);
              const rawVal = getCellValue(row, cell.column);
              if (rawVal === null || rawVal === undefined || rawVal === '') return;
              const num = typeof rawVal === 'number' ? rawVal : parseFloat(String(rawVal));
              if (!Number.isFinite(num)) return;
              const arr = valuesByC.get(cell.c) || [];
              arr.push(num);
              valuesByC.set(cell.c, arr);
            });

            // Eligible if any column has enough numeric values
            const eligibleColumns = Array.from(allC).filter((c) => (valuesByC.get(c) || []).length >= minValuesPerColumn);
            if (eligibleColumns.length === 0) return;
            stat.eligible += 1;

            const constantColumns = eligibleColumns.filter((c) => {
              const vals = valuesByC.get(c) || [];
              if (vals.length < minValuesPerColumn) return false;
              const first = vals[0];
              return vals.every((v) => Math.abs(v - first) < 1e-9);
            });

            if (constantColumns.length >= minConstantColumnsToFlag) stat.triggered += 1;
            return;
          }

          // Default: existing 1D straight-lining behavior
          const threshold = Number((rule.config as any)?.threshold ?? 80);
          const minAnswered = Number((rule.config as any)?.minAnsweredStatements ?? straightliningMinStatements ?? 4);
          if (!Number.isFinite(threshold) || threshold <= 0) return;
          if (!Number.isFinite(minAnswered) || minAnswered <= 0) return;

          const cols = getStraightlineColumnNamesForQuestion(candidateCols, qNum);
          if (cols.length === 0) return;

          const values = cols
            .map((col) => {
              const v = getCellValue(row, col);
              return v === null || v === undefined || v === '' ? null : String(v).trim();
            })
            .filter((v) => v !== null) as string[];

          if (values.length < minAnswered) return;
          stat.eligible += 1;

          const valueCounts: Record<string, number> = {};
          values.forEach((v) => { valueCounts[v] = (valueCounts[v] || 0) + 1; });
          const maxCount = Math.max(...Object.values(valueCounts));
          const percent = (maxCount / values.length) * 100;
          if (percent >= threshold) stat.triggered += 1;
        });
      });

      const commonStraightlineRuleIds = new Set<string>();
      slStatsByRuleId.forEach((s, ruleId) => {
        const rate = s.eligible > 0 ? (s.triggered / s.eligible) : 0;
        if (s.eligible > 0 && rate >= COMMON_SL_RATE) commonStraightlineRuleIds.add(ruleId);
      });

      const MIN_CONFIDENCE_WEIGHT = 0.5; // lowest-coverage respondents get half-weighted score

      // Ensure the payload contains the effective thresholds (so the drilldown shows them)
      const enabledRulesForPayload: QualityRule[] = enabledRules.map((r) => {
        const isSpeedingQtime = r.checkTypeId === 'speeding' && String(r.questionNumber || '').toLowerCase() === 'qtime';
        const isCommonSL = r.checkTypeId === 'straightlining' && commonStraightlineRuleIds.has(r.id);
        const nextConfig: any = { ...(r.config || {}) };

        if (isSpeedingQtime) {
          nextConfig.speedingThresholdSeconds = Number.isFinite(speedingUnderSeconds) ? speedingUnderSeconds : null;
          nextConfig.speedingUpperThresholdSeconds =
            (speedingOverSecondsNum !== null && Number.isFinite(speedingOverSecondsNum) && speedingOverSecondsNum > 0)
              ? speedingOverSecondsNum
              : ((r.config as any)?.speedingUpperThresholdSeconds ?? null);
        }

        if (isCommonSL) {
          const stats = slStatsByRuleId.get(r.id);
          const eligible = stats?.eligible ?? 0;
          const triggered = stats?.triggered ?? 0;
          const rate = eligible > 0 ? triggered / eligible : 0;
          nextConfig.commonStraightlineSuppressed = true;
          nextConfig.commonStraightlineSuppressedRate = rate;
          nextConfig.commonStraightlineSuppressedEligible = eligible;
          nextConfig.commonStraightlineSuppressedTriggered = triggered;
        }

        // Avoid unnecessary object churn
        if (!isSpeedingQtime && !isCommonSL) return r;
        return { ...r, config: nextConfig };
      });

      // If plan is missing the under-threshold, persist the computed default once so future runs are consistent
      if (speedingRule && (!Number.isFinite(underFromConfig) || underFromConfig <= 0) && defaultUnder !== null) {
        try {
          const now = new Date().toISOString();
          const patched: QualityPlan = {
            ...plan,
            updatedAt: now,
            rules: plan.rules.map((r) => {
              const isSpeedingQtime = r.checkTypeId === 'speeding' && String(r.questionNumber || '').toLowerCase() === 'qtime';
              if (!isSpeedingQtime) return r;
              return {
                ...r,
                updatedAt: now,
                config: { ...(r.config || {}), speedingThresholdSeconds: defaultUnder, speedingUpperThresholdSeconds: (r.config as any)?.speedingUpperThresholdSeconds ?? null },
              };
            }),
          };
          setPlan(patched);
          localStorage.setItem(getStorageKey(projectId), JSON.stringify(patched));
        } catch {}
      }

      const unweightedResults: DQV2RespondentResult[] = rows.map((row: any, idx: number) => {
        const recordRaw = getCellValue(row, 'record');
        const respondentId = String(recordRaw ?? '').trim() || `row_${idx + 1}`;

        let totalWeight = 0;
        let flagCount = 0;
        let maxPossibleWeight = 0;
        let applicableChecks = 0;
        const flagNames: string[] = [];
        const openEndAnswered: Array<{ ruleId: string; questionNumber: string; text: string }> = [];

        const addFlag = (weight: number, name: string) => {
          const w = Number(weight);
          if (!Number.isFinite(w) || w <= 0) return;
          totalWeight += w;
          flagCount += 1;
          if (name) flagNames.push(name);
        };

        const addPotential = (weight: number) => {
          const w = Number(weight);
          if (!Number.isFinite(w) || w <= 0) return;
          maxPossibleWeight += w;
        };

        const addApplicable = () => {
          applicableChecks += 1;
        };

        enabledRules.forEach((rule) => {
          if (rule.checkTypeId === 'speeding') {
            // Only evaluate on qtime rule
            if (String(rule.questionNumber || '').toLowerCase() !== 'qtime') return;
            const qtimeRaw = getCellValue(row, 'qtime');
            const qtimeSeconds = qtimeRaw === null || qtimeRaw === undefined || qtimeRaw === ''
              ? null
              : (typeof qtimeRaw === 'number' ? qtimeRaw : parseFloat(String(qtimeRaw)));
            if (!Number.isFinite(qtimeSeconds as any)) return;

            addApplicable();

            // Potential max weights for this respondent (if thresholds exist)
            if (Number.isFinite(speedingUnderSeconds) && speedingUnderSeconds > 0) addPotential(15);
            // "Over" can be triggered either by a saved upper threshold OR by the hard cap (2x median LOI).
            if (
              (Number.isFinite(speedingOverSecondsNum as any) && (speedingOverSecondsNum as number) > 0) ||
              (Number.isFinite(hardMaxSpeedingOverSeconds as any) && (hardMaxSpeedingOverSeconds as number) > 0)
            ) {
              addPotential(10);
            }

            // Under threshold
            if (Number.isFinite(speedingUnderSeconds) && speedingUnderSeconds > 0 && (qtimeSeconds as number) < speedingUnderSeconds) {
              addFlag(15, 'Speeding (under)');
            }
            // Over threshold (optional)
            const overBySaved =
              (Number.isFinite(speedingOverSecondsNum as any) && (speedingOverSecondsNum as number) > 0 && (qtimeSeconds as number) > (speedingOverSecondsNum as number));
            const overByHardMax =
              (Number.isFinite(hardMaxSpeedingOverSeconds as any) && (hardMaxSpeedingOverSeconds as number) > 0 && (qtimeSeconds as number) > (hardMaxSpeedingOverSeconds as number));
            if (overBySaved || overByHardMax) {
              addFlag(10, 'Speeding (over)');
            }
            return;
          }

          if (rule.checkTypeId === 'open_end') {
            const val = getCellValue(row, rule.questionNumber);
            if (val === null || val === undefined) return;
            const text = String(val).trim();
            if (!text) return;
            const minLength = Number((rule.config as any)?.minLength ?? 2);
            // Potential weight only if the respondent has a non-empty value to evaluate
            addPotential(5);
            addApplicable();
            if (Number.isFinite(minLength) && text.length < minLength) {
              addFlag(5, `Open-end (${rule.questionNumber})`);
            }
            openEndAnswered.push({ ruleId: rule.id, questionNumber: String(rule.questionNumber || ''), text });
            return;
          }

          if (rule.checkTypeId === 'straightlining') {
            // Suppress "common" SL flags globally (they do not contribute to score or flags)
            if (commonStraightlineRuleIds.has(rule.id)) return;
            const qNum = String(rule.questionNumber || '').trim();
            if (!qNum) return;

            const candidateCols = Array.isArray(row) ? columns : Object.keys(row || {});

            // Repeat Numerics (grouped): base question (QS11) with internal columns (QS11c1..QS11cN)
            const gridMode = String((rule.config as any)?.gridMode || '').toLowerCase();
            const numericGridColumns = (rule.config as any)?.numericGridColumns;
            const isGroupedRepeatNumerics = gridMode === 'numeric_grid' && Array.isArray(numericGridColumns) && numericGridColumns.length > 0;
            if (isGroupedRepeatNumerics) {
              const minValuesPerColumn = Number((rule.config as any)?.minValuesPerColumn ?? 2);
              const minConstantColumnsToFlag = Number((rule.config as any)?.minConstantColumnsToFlag ?? 1);
              if (!Number.isFinite(minValuesPerColumn) || minValuesPerColumn <= 0) return;
              if (!Number.isFinite(minConstantColumnsToFlag) || minConstantColumnsToFlag <= 0) return;

              let eligibleAny = false;
              let eligibleCols = 0;
              const constantColumns: number[] = [];
              const allColumns: number[] = [];

              (numericGridColumns as any[]).forEach((colDef) => {
                const subQ = String(colDef?.questionNumber || '').trim();
                const cIdx = Number(colDef?.columnIndex);
                if (!subQ) return;
                const columnIndex = Number.isFinite(cIdx) && cIdx > 0 ? Math.floor(cIdx) : null;
                if (columnIndex !== null) allColumns.push(columnIndex);

                const rowHeaders = getNumericGridRowHeadersForSubQuestion(candidateCols, subQ);
                if (rowHeaders.length === 0) return;

                const nums: number[] = [];
                rowHeaders.forEach((h) => {
                  const rawVal = getCellValue(row, h);
                  if (rawVal === null || rawVal === undefined || rawVal === '') return;
                  const num = typeof rawVal === 'number' ? rawVal : parseFloat(String(rawVal));
                  if (!Number.isFinite(num)) return;
                  nums.push(num);
                });

                if (nums.length < minValuesPerColumn) return;
                eligibleAny = true;
                eligibleCols += 1;
                const first = nums[0];
                const isConstant = nums.every((v) => Math.abs(v - first) < 1e-9);
                if (isConstant && columnIndex !== null) constantColumns.push(columnIndex);
              });

              if (!eligibleAny || eligibleCols === 0) return;
              addApplicable();

              // Repeat Numerics: weight scales by % of eligible columns that are constant
              const maxWeight = Number((rule.config as any)?.maxWeight ?? 20);
              const baseMax = Number.isFinite(maxWeight) && maxWeight > 0 ? maxWeight : 20;
              addPotential(baseMax);

              if (constantColumns.length >= minConstantColumnsToFlag) {
                const denom = Math.max(1, eligibleCols);
                const ratio = constantColumns.length / denom;
                const weight = baseMax * ratio;
                const colsLabel = constantColumns.slice().sort((a, b) => a - b).map((c) => `c${c}`).join(',');
                addFlag(weight, `Repeat Numerics (${rule.questionNumber}: ${colsLabel})`);
              }
              return;
            }

            // If this looks like a 2D numeric grid (r#c#), evaluate repeats by COLUMN (cN).
            const grid2d = getGrid2DCellInfosForQuestion(candidateCols, qNum);
            if (grid2d.length > 0) {
              const minValuesPerColumn = Number((rule.config as any)?.minValuesPerColumn ?? 2);
              const minConstantColumnsToFlag = Number((rule.config as any)?.minConstantColumnsToFlag ?? 1);
              if (!Number.isFinite(minValuesPerColumn) || minValuesPerColumn <= 0) return;
              if (!Number.isFinite(minConstantColumnsToFlag) || minConstantColumnsToFlag <= 0) return;

              const valuesByC = new Map<number, number[]>();
              const allC = new Set<number>();
              let totalNumeric = 0;

              grid2d.forEach((cell) => {
                allC.add(cell.c);
                const rawVal = getCellValue(row, cell.column);
                if (rawVal === null || rawVal === undefined || rawVal === '') return;
                const num = typeof rawVal === 'number' ? rawVal : parseFloat(String(rawVal));
                if (!Number.isFinite(num)) return;
                const arr = valuesByC.get(cell.c) || [];
                arr.push(num);
                valuesByC.set(cell.c, arr);
                totalNumeric += 1;
              });

              // Must have at least some numeric data
              if (totalNumeric === 0) return;

              // Eligible if any column has enough numeric values
              const eligibleColumns = Array.from(allC).filter((c) => (valuesByC.get(c) || []).length >= minValuesPerColumn);
              if (eligibleColumns.length === 0) return;

              addApplicable();

              const constantColumns = eligibleColumns.filter((c) => {
                const vals = valuesByC.get(c) || [];
                if (vals.length < minValuesPerColumn) return false;
                const first = vals[0];
                return vals.every((v) => Math.abs(v - first) < 1e-9);
              });

              // Potential max weight for this respondent for this rule (cap stays the same)
              const maxWeight = Number((rule.config as any)?.maxWeight ?? 20);
              const baseMax = Number.isFinite(maxWeight) && maxWeight > 0 ? maxWeight : 20;
              addPotential(baseMax);

              if (constantColumns.length >= minConstantColumnsToFlag) {
                const totalColumns = Math.max(1, allC.size);
                const ratio = constantColumns.length / totalColumns; // 0-1
                const weight = baseMax * ratio;
                const colsLabel = constantColumns
                  .slice()
                  .sort((a, b) => a - b)
                  .map((c) => `c${c}`)
                  .join(',');
                addFlag(weight, `Repeat Numerics (${rule.questionNumber}: ${colsLabel})`);
              }
              return;
            }

            // Default: existing 1D straight-lining behavior
            const cols = getStraightlineColumnNamesForQuestion(candidateCols, qNum);

            const values = cols
              .map((col) => {
                const v = getCellValue(row, col);
                return v === null || v === undefined || v === '' ? null : String(v).trim();
              })
              .filter((v) => v !== null) as string[];

            const minAnswered = Number((rule.config as any)?.minAnsweredStatements ?? straightliningMinStatements ?? 4);
            if (!Number.isFinite(minAnswered) || minAnswered <= 0) return;
            if (values.length < minAnswered) return; // not enough answered statements to evaluate

            addApplicable();

            const valueCounts: Record<string, number> = {};
            values.forEach((v) => {
              valueCounts[v] = (valueCounts[v] || 0) + 1;
            });

            const maxCount = Math.max(...Object.values(valueCounts));
            const percent = (maxCount / values.length) * 100;
            const threshold = Number((rule.config as any)?.threshold ?? 80);
            if (!Number.isFinite(threshold) || threshold <= 0) return;

            // Potential max weight for this respondent for this rule
            const maxWeight = Number((rule.config as any)?.maxWeight ?? 20);
            const refStatements = Number((rule.config as any)?.weightReferenceStatements ?? 10);
            const statements = values.length;
            const statementScale = Number.isFinite(refStatements) && refStatements > 0
              ? Math.min(1, statements / refStatements)
              : 1;
            const baseMax = (Number.isFinite(maxWeight) && maxWeight > 0 ? maxWeight : 20) * statementScale;
            addPotential(baseMax);

            if (percent >= threshold) {
              const extent = Math.max(0, Math.min(1, (percent - threshold) / Math.max(1, (100 - threshold))));
              const weight = baseMax * (0.3 + 0.7 * extent);
              addFlag(weight, `Straight-lining (${rule.questionNumber})`);
            }
            return;
          }
        });

        // Open-end similarity check (across all answered OEs)
        if (openEndAnswered.length >= 2) {
          const SIM_MAX_WEIGHT = 8;
          // potential: if respondent could be exact-duplicate across all OEs, every OE would trigger at max
          openEndAnswered.forEach(() => addPotential(SIM_MAX_WEIGHT));

          const norms = openEndAnswered.map((oe) => normalizeOpenEndText(oe.text));
          const allSame = norms.every((n) => n && n === norms[0]);

          if (allSame) {
            openEndAnswered.forEach((oe) => {
              addFlag(SIM_MAX_WEIGHT, `Open-end similarity (${oe.questionNumber}): Exact`);
            });
          } else {
            // If not all exact, flag any exact duplicates and high partial similarity
            const tokens = openEndAnswered.map((oe) => tokenizeOpenEnd(oe.text));

            // Exact duplicates among any two
            const groups = new Map<string, number[]>();
            norms.forEach((n, i) => {
              if (!n) return;
              const arr = groups.get(n) || [];
              arr.push(i);
              groups.set(n, arr);
            });
            const exactIdx = new Set<number>();
            groups.forEach((idxs) => {
              if (idxs.length >= 2) idxs.forEach((i) => exactIdx.add(i));
            });

            exactIdx.forEach((i) => {
              const oe = openEndAnswered[i];
              addFlag(SIM_MAX_WEIGHT, `Open-end similarity (${oe.questionNumber}): Exact`);
            });

            // Partial similarity (only for non-exact entries)
            for (let i = 0; i < openEndAnswered.length; i++) {
              if (exactIdx.has(i)) continue;
              let best = 0;
              for (let j = 0; j < openEndAnswered.length; j++) {
                if (i === j) continue;
                best = Math.max(best, jaccardSimilarity(tokens[i], tokens[j]));
              }
              if (best >= 0.85) {
                const oe = openEndAnswered[i];
                const w = Math.round(SIM_MAX_WEIGHT * best);
                addFlag(w, `Open-end similarity (${oe.questionNumber}): Partial`);
              }
            }
          }
        }

        const baseScore = maxPossibleWeight > 0
          ? Math.min(100, Math.max(0, Math.round((totalWeight / maxPossibleWeight) * 100)))
          : 0;

        return {
          respondentId,
          rowIndex: idx,
          score: baseScore,
          baseScore,
          applicableChecks,
          confidenceWeight: 1,
          flagCount,
          totalWeight,
          maxPossibleWeight,
          flagNames
        };
      });

      const minApplicable = unweightedResults.reduce((acc, r) => Math.min(acc, r.applicableChecks ?? 0), Number.POSITIVE_INFINITY);
      const maxApplicable = unweightedResults.reduce((acc, r) => Math.max(acc, r.applicableChecks ?? 0), 0);
      const denom = Math.max(1, maxApplicable - minApplicable);

      const results: DQV2RespondentResult[] = unweightedResults.map((r) => {
        const a = r.applicableChecks ?? 0;
        const normalized = denom > 0 ? (a - minApplicable) / denom : 1;
        const confidenceWeight = maxApplicable === minApplicable ? 1 : (MIN_CONFIDENCE_WEIGHT + (1 - MIN_CONFIDENCE_WEIGHT) * Math.max(0, Math.min(1, normalized)));
        const base = Number(r.baseScore ?? r.score ?? 0);
        const weightedScore = Math.min(100, Math.max(0, Math.round(base * confidenceWeight)));
        return { ...r, confidenceWeight, score: weightedScore };
      });

      results.sort((a, b) => b.score - a.score);
      onResultsReady?.({ results, enabledRules: enabledRulesForPayload });
    } finally {
      setRunningChecks(false);
    }
  };

  const resetPlanToDefaults = () => {
    if (runningChecks) return;

    // Clear locally-stored v2 plan + settings
    try { localStorage.removeItem(getStorageKey(projectId)); } catch {}
    try { localStorage.removeItem(getSettingsKey(projectId)); } catch {}

    // Reset UI state defaults
    setStraightliningMinStatements(4);
    setStraightliningMinStatementsInput('4');
    setRepeatNumericsMinValuesPerColumn(2);
    setRepeatNumericsMinValuesPerColumnInput('2');
    setRepeatNumericsMinConstantColumnsToFlag(1);
    setRepeatNumericsMinConstantColumnsToFlagInput('1');
    setRepeatNumericsMaxWeight(20);
    setRepeatNumericsMaxWeightInput('20');
    setNumericIncludeRepeat(true);
    setNumericIncludeOutliers(true);
    setNumericMinStatements(3);
    setNumericMinStatementsInput('3');
    setOpenEndEnabled(true);
    setOpenEndEnabledInput(true);
    setOpenEndIncludeOtherSpecify(false);
    setOpenEndIncludeOtherSpecifyInput(false);

    // Regenerate plan from Data Map with defaults
    if (!parsedQuestions || parsedQuestions.length === 0) {
      setPlan(null);
      return;
    }

    const now = new Date().toISOString();
    const base = createPlanFromDatamap(projectId, parsedQuestions);

    // Ensure speeding under threshold is persisted so "Run" works immediately.
    const defaultUnder = computeDefaultSpeedingUnderSeconds(qtimeStats as any);
    let nextPlan: QualityPlan = {
      ...base,
      updatedAt: now,
      rules: (base.rules || []).map((r) => {
        const isSpeedingQtime = r.checkTypeId === 'speeding' && String(r.questionNumber || '').toLowerCase() === 'qtime';
        if (!isSpeedingQtime) return r;
        if (defaultUnder === null) return r;
        return {
          ...r,
          updatedAt: now,
          config: {
            ...(r.config || {}),
            speedingThresholdSeconds: defaultUnder,
            ...(Object.prototype.hasOwnProperty.call(r.config || {}, 'speedingUpperThresholdSeconds') ? {} : { speedingUpperThresholdSeconds: null }),
          },
        };
      }),
    };

    // Apply derived straight-lining weights based on uploaded file data (defaults: minStatements=4).
    try {
      const cols = (fullRawData?.columns || []) as string[];
      const minReq = 4;
      const statementCounts: number[] = [];

      const statementCountFromFile = (questionNumber: string) => {
        if (!Array.isArray(cols) || cols.length === 0) return null as number | null;
        const qn = String(questionNumber || '').trim();
        if (!qn) return null;
        const grid2d = getGrid2DCellInfosForQuestion(cols, qn);
        if (grid2d.length > 0) return new Set(grid2d.map((c) => c.r)).size;
        return getStraightlineColumnNamesForQuestion(cols, qn).length;
      };

      (nextPlan.rules || []).forEach((r: any) => {
        if (r?.checkTypeId !== 'straightlining') return;
        const mode = String((r?.config as any)?.gridMode || '').toLowerCase();
        const numericGridColumns = (r?.config as any)?.numericGridColumns;
        const isRepeatNumerics = mode === 'numeric_grid' || (Array.isArray(numericGridColumns) && numericGridColumns.length > 0);
        if (isRepeatNumerics) return;
        const qn = String(r?.questionNumber || '').trim();
        const c = statementCountFromFile(qn);
        if (Number.isFinite(c as any) && (c as number) > 0) statementCounts.push(Math.floor(c as number));
      });

      const eligible = statementCounts.filter((c) => c >= minReq);
      const ref = eligible.length > 0 ? Math.ceil(eligible.reduce((a, b) => a + b, 0) / eligible.length) : minReq;
      const maxW = eligible.length > 0 ? Math.max(...eligible) : minReq;
      setStraightliningWeightReferenceStatements(ref);
      setStraightliningWeightReferenceStatementsInput(String(ref));
      setStraightliningMaxWeight(maxW);
      setStraightliningMaxWeightInput(String(maxW));

      nextPlan = {
        ...nextPlan,
        updatedAt: now,
        rules: (nextPlan.rules || []).map((r) => {
          if (r.checkTypeId !== 'straightlining') return r;
          const mode = String((r.config as any)?.gridMode || '').toLowerCase();
          const numericGridColumns = (r.config as any)?.numericGridColumns;
          const isRepeatNumerics = mode === 'numeric_grid' || (Array.isArray(numericGridColumns) && numericGridColumns.length > 0);
          if (isRepeatNumerics) return r;
          const qn = String(r.questionNumber || '').trim();
          const countFromFile = statementCountFromFile(qn);
          const count = Number.isFinite(countFromFile as any) ? (countFromFile as number) : Number((r.config as any)?.statementCount ?? 0);
          return {
            ...r,
            updatedAt: now,
            enabled: Number(count) >= minReq,
            config: {
              ...(r.config || {}),
              statementCount: count,
              minAnsweredStatements: minReq,
              weightReferenceStatements: ref,
              maxWeight: maxW,
            },
          };
        }),
      };
    } catch {}

    setPlan(nextPlan);
    try { localStorage.setItem(getStorageKey(projectId), JSON.stringify(nextPlan)); } catch {}
    setAutoGeneratedOnce(true);
  };

  // When a (new) data file is loaded, automatically reset everything to defaults
  // so the plan always starts from a clean slate for that file.
  const lastLoadedFullRawDataRef = useRef<any>(null);
  const pendingAutoResetRef = useRef(false);

  useEffect(() => {
    const rowsLen = fullRawData?.rows?.length ?? 0;
    if (rowsLen <= 0) return;
    if (lastLoadedFullRawDataRef.current === fullRawData) return;
    lastLoadedFullRawDataRef.current = fullRawData;
    pendingAutoResetRef.current = true;
  }, [fullRawData]);

  useEffect(() => {
    if (!pendingAutoResetRef.current) return;
    if (runningChecks) return;
    if (!parsedQuestions || parsedQuestions.length === 0) return;
    resetPlanToDefaults();
    pendingAutoResetRef.current = false;
  }, [parsedQuestions, projectId, runningChecks]);

  return (
    <div className="pt-0 pb-6 px-0">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h3 className="text-lg font-semibold text-gray-900">Quality Plan</h3>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={resetPlanToDefaults}
            disabled={runningChecks || !parsedQuestions || parsedQuestions.length === 0}
            className="px-3 py-1.5 text-sm rounded-md border border-gray-300 bg-white text-gray-700 hover:bg-gray-50 disabled:opacity-50 transition-colors"
            title="Reset the plan + settings to defaults"
          >
            Reset to defaults
          </button>
          <button
            onClick={runQualityChecks}
            disabled={!plan || runningChecks || !((fullRawData?.rows?.length ?? 0) > 0)}
            className="px-3 py-1.5 text-sm text-white rounded-md disabled:opacity-50 transition-colors flex items-center gap-2"
            style={{ backgroundColor: BRAND_ORANGE }}
            title={(fullRawData?.rows?.length ?? 0) <= 0 ? 'Upload a data file first' : 'Run quality checks'}
          >
            {runningChecks ? (
              <span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-white/40 border-t-white" />
            ) : (
              <PlayIcon className="h-4 w-4 text-white" />
            )}
            Run Quality Check
          </button>
        </div>
      </div>

      {!plan ? (
        <div className="border border-gray-200 rounded-lg p-6 text-center text-sm text-gray-600">
          Generating plan from Data Map…
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          {QUALITY_PLAN_CARDS.map((ct) => {
            const rules =
              ct.id === 'speeding'
                ? rulesByCard.speeding
                : ct.id === 'open_end'
                  ? rulesByCard.open_end
                  : ct.id === 'numeric_grids'
                    ? rulesByCard.numeric_grids
                    : rulesByCard.straightlining;
            const isNumericGridCard = ct.id === 'numeric_grids';

            return (
              <div key={ct.id} className="bg-white rounded-lg border border-gray-200 overflow-hidden flex flex-col min-h-[420px] max-h-[580px] overflow-x-hidden">
                <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between" style={{ backgroundColor: getCardMeta(ct.id).color ? `${getCardMeta(ct.id).color}14` : `${BRAND_ORANGE}08` }}>
                  <div className="flex items-center gap-2">
                    {(() => {
                      const meta = getCardMeta(ct.id);
                      const Icon = meta.icon as any;
                      return Icon ? (
                        <span className={`inline-flex items-center justify-center h-7 w-7 rounded-full ${meta.bgClass || ''}`}>
                          <Icon className="w-4 h-4" style={{ color: meta.color || BRAND_ORANGE }} />
                        </span>
                      ) : null;
                    })()}
                    <div>
                      <div className="text-sm font-semibold text-gray-900">{ct.label}</div>
                      <div className="text-xs text-gray-500">{countsByCard[ct.id] || 0} {ct.id === 'numeric_grids' ? 'item(s)' : 'rule(s)'}</div>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        if (ct.id === 'speeding') openSpeedingSettings();
                        if (ct.id === 'straightlining') openStraightliningSettings();
                        if (ct.id === 'numeric_grids') openNumericGridSettings();
                        if (ct.id === 'open_end') openOpenEndSettings();
                      }}
                      disabled={ct.id !== 'speeding' && ct.id !== 'straightlining' && ct.id !== 'numeric_grids' && ct.id !== 'open_end'}
                      className="p-1.5 rounded-lg hover:bg-gray-100 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                      title={(ct.id === 'speeding' || ct.id === 'straightlining' || ct.id === 'numeric_grids' || ct.id === 'open_end') ? 'Edit settings' : 'Settings coming soon'}
                    >
                      <Cog6ToothIcon className="w-4 h-4 text-gray-600" />
                    </button>
                  </div>
                </div>
                <div className="divide-y divide-gray-100 flex-1 overflow-y-auto overflow-x-hidden">
                  {rules.length === 0 ? (
                    <div className="px-4 py-6 text-center text-sm text-gray-400">No {isNumericGridCard ? 'items' : 'rules'}</div>
                  ) : (
                    rules.map((r) => {
                      if (isNumericGridCard) {
                        const isDisplayOnly = (r as any)?.displayOnly;
                        const enabled = !!r.enabled;
                        const handleNumericToggle = () => {
                          if (isDisplayOnly) return;
                          handleToggleRule(r.id);
                        };

                        return (
                          <div
                            key={r.id}
                            className="px-4 py-2 flex items-center justify-between hover:bg-gray-50 cursor-pointer"
                            onClick={handleNumericToggle}
                            role="button"
                            tabIndex={0}
                            onKeyDown={(e) => {
                              if (isDisplayOnly) return;
                              if (e.key === 'Enter' || e.key === ' ') {
                                e.preventDefault();
                                handleNumericToggle();
                              }
                            }}
                          >
                            <div className="flex items-center gap-3">
                              <input
                                type="radio"
                              className="h-4 w-4 text-green-600 border-gray-300 cursor-pointer"
                              style={{ accentColor: '#16a34a' }}
                              checked={enabled}
                              onChange={(e) => {
                                e.stopPropagation();
                                handleNumericToggle();
                              }}
                              onClick={(e) => e.stopPropagation()}
                                disabled={isDisplayOnly}
                              />
                              <div className="min-w-0">
                              <div className="text-xs font-medium text-gray-900 truncate">{r.questionNumber}</div>
                                {!!r.questionText && (
                                  <div className="text-[11px] text-gray-500 truncate">{r.questionText}</div>
                                )}
                              </div>
                            </div>
                          </div>
                        );
                      }

                      const handleToggle = () => {
                        handleToggleRule(r.id);
                      };
                      return (
                        <div
                          key={r.id}
                          className="px-4 py-2 flex items-center justify-between hover:bg-gray-50 cursor-pointer"
                          onClick={handleToggle}
                          role="button"
                          tabIndex={0}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter' || e.key === ' ') {
                              e.preventDefault();
                              handleToggle();
                            }
                          }}
                        >
                          <div className="flex items-center gap-3">
                            <input
                              type="radio"
                              className="h-4 w-4 text-green-600 border-gray-300 cursor-pointer"
                              style={{ accentColor: '#16a34a' }}
                              checked={!!r.enabled}
                              onChange={(e) => {
                                e.stopPropagation();
                                handleToggle();
                              }}
                              onClick={(e) => e.stopPropagation()}
                            />
                            <div className="min-w-0">
                              <div className="text-xs font-medium text-gray-900 truncate">{r.questionNumber}</div>
                              {!!r.questionText && (
                                <div className="text-[11px] text-gray-500 truncate">{r.questionText}</div>
                              )}
                            </div>
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Numeric Grids Settings Modal */}
      {settingsCheckType === 'numeric_grids' && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-lg mx-4">
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200">
              <h3 className="text-lg font-semibold text-gray-900">Numeric Grids Settings</h3>
              <button
                type="button"
                onClick={() => setSettingsCheckType(null)}
                className="text-gray-400 hover:text-gray-600 transition-colors"
              >
                <XMarkIcon className="w-6 h-6" />
              </button>
            </div>

            <div className="p-6 space-y-4">
              <div className="bg-white rounded-lg border border-gray-200 p-4">
                <label className="flex items-center gap-2 text-sm text-gray-700">
                  <input
                    type="checkbox"
                    className="h-4 w-4"
                    checked={numericIncludeRepeat}
                    onChange={(e) => setNumericIncludeRepeat(e.target.checked)}
                  />
                  Repeat numerics
                </label>
                <div className="mt-3">
                  <label className="block text-sm text-gray-700 mb-1">Min statements required</label>
                  <input
                    type="number"
                    min={1}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-gray-200 focus:outline-none"
                    value={numericMinStatementsInput}
                    onChange={(e) => setNumericMinStatementsInput(e.target.value)}
                    placeholder="e.g., 3"
                  />
                  <p className="mt-1 text-xs text-gray-500">Numeric grids with fewer statements will be excluded.</p>
                </div>
              </div>

              <div className="bg-white rounded-lg border border-gray-200 p-4">
                <label className="flex items-center gap-2 text-sm text-gray-700">
                  <input
                    type="checkbox"
                    className="h-4 w-4"
                    checked={numericIncludeOutliers}
                    onChange={(e) => setNumericIncludeOutliers(e.target.checked)}
                  />
                  Outliers
                </label>
              </div>
            </div>

            <div className="flex justify-end gap-3 px-6 py-4 border-t border-gray-200 bg-gray-50">
              <button
                type="button"
                onClick={() => setSettingsCheckType(null)}
                className="px-4 py-2 text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={saveNumericGridSettings}
                className="px-4 py-2 text-white rounded-lg transition-colors"
                style={{ backgroundColor: BRAND_ORANGE }}
              >
                Save
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Speeding Settings Modal (v2) */}
      {settingsCheckType === 'speeding' && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-lg mx-4">
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200">
              <h3 className="text-lg font-semibold text-gray-900">Speeding Settings</h3>
              <button
                type="button"
                onClick={() => setSettingsCheckType(null)}
                className="text-gray-400 hover:text-gray-600 transition-colors"
              >
                <XMarkIcon className="w-6 h-6" />
              </button>
            </div>

            <div className="p-6 space-y-5">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="bg-white rounded-lg border border-gray-200 p-3">
                  <div className="text-xs text-gray-500">Median (all rows)</div>
                  <div className="text-sm text-gray-900">
                    {qtimeStats.median !== null ? `${(qtimeStats.median / 60).toFixed(1)} min` : '—'}
                  </div>
                  <div className="text-xs text-gray-500 mt-0.5">N = {qtimeStats.n}</div>
                </div>

                <div className="bg-white rounded-lg border border-gray-200 p-3">
                  <div className="text-xs text-gray-500">Median (no outliers)</div>
                  <div className="text-sm text-gray-900">
                    {qtimeStats.medianNoOutliers !== null ? `${(qtimeStats.medianNoOutliers / 60).toFixed(1)} min` : '—'}
                  </div>
                  <div className="text-xs text-gray-500 mt-0.5">N = {qtimeStats.nNoOutliers}</div>
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Flag if completion time is under (minutes)
                </label>

                {(() => {
                  const maxMinutes = qtimeStats.max !== null ? Math.max(0, qtimeStats.max / 60) : 0;
                  const medianAllMinutes =
                    qtimeStats.median !== null && qtimeStats.median !== undefined
                      ? Math.max(0, qtimeStats.median / 60)
                      : null;
                  // Under slider max: 60% of the ALL-ROWS median (in minutes).
                  const sliderMax =
                    medianAllMinutes !== null && Number.isFinite(medianAllMinutes) && medianAllMinutes > 0
                      ? medianAllMinutes * 0.6
                      : maxMinutes;
                  const safeMax = Number.isFinite(sliderMax) && sliderMax > 0 ? sliderMax : 0;

                  return (
                    <div className="mt-2">
                      <div className="relative">
                        <input
                          type="range"
                          min={0}
                          max={safeMax > 0 ? safeMax : 1}
                          step={0.1}
                          value={Number.isFinite(speedingThresholdMinutes) ? Math.min(speedingThresholdMinutes, safeMax > 0 ? safeMax : 1) : 0}
                          onChange={(e) => setSpeedingThresholdMinutes(Number(e.target.value))}
                          disabled={safeMax <= 0}
                          className="w-full"
                        />
                      </div>

                      <div className="mt-1 flex items-center justify-between text-xs text-gray-500">
                        <div>0 min</div>
                        <div>{safeMax > 0 ? `${safeMax.toFixed(1)} min` : '—'}</div>
                      </div>
                    </div>
                  );
                })()}
              </div>

              <div className="pt-2">
                <label className="flex items-center gap-2 text-sm text-gray-700">
                  <input
                    type="checkbox"
                    className="h-4 w-4"
                    checked={speedingUpperEnabled}
                    onChange={(e) => setSpeedingUpperEnabled(e.target.checked)}
                  />
                  Also flag if completion time is above a threshold
                </label>

                {speedingUpperEnabled && (
                  <div className="mt-3">
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Flag if completion time is over (minutes)
                    </label>

                    {(() => {
                      const maxMinutes = qtimeStats.max !== null ? Math.max(0, qtimeStats.max / 60) : 0;
                      const loiMinutes =
                        qtimeStats.medianNoOutliers !== null && qtimeStats.medianNoOutliers !== undefined
                          ? Math.max(0, qtimeStats.medianNoOutliers / 60)
                          : (qtimeStats.median !== null && qtimeStats.median !== undefined ? Math.max(0, qtimeStats.median / 60) : null);
                      const medianAllMinutes =
                        qtimeStats.median !== null && qtimeStats.median !== undefined
                          ? Math.max(0, qtimeStats.median / 60)
                          : null;
                      // Over slider min: 60% greater than ALL-ROWS median (in minutes).
                      const minMinutes =
                        medianAllMinutes !== null && Number.isFinite(medianAllMinutes) && medianAllMinutes > 0
                          ? medianAllMinutes * 1.6
                          : 0;
                      const sliderMax = medianAllMinutes !== null && Number.isFinite(medianAllMinutes) && medianAllMinutes > 0 ? medianAllMinutes * 3 : maxMinutes;
                      const safeMax = Number.isFinite(sliderMax) && sliderMax > 0 ? sliderMax : 0;

                      return (
                        <div className="mt-2">
                          <div className="relative">
                            <input
                              type="range"
                              min={minMinutes}
                              max={safeMax > 0 ? safeMax : 1}
                              step={0.1}
                              value={
                                Number.isFinite(speedingUpperThresholdMinutes)
                                  ? Math.min(Math.max(speedingUpperThresholdMinutes, minMinutes), safeMax > 0 ? safeMax : 1)
                                  : minMinutes
                              }
                              onChange={(e) => setSpeedingUpperThresholdMinutes(Number(e.target.value))}
                              disabled={safeMax <= 0}
                              className="w-full"
                            />
                          </div>

                          <div className="mt-1 flex items-center justify-between text-xs text-gray-500">
                            <div>{minMinutes > 0 ? `${minMinutes.toFixed(1)} min` : '0 min'}</div>
                            <div>{safeMax > 0 ? `${safeMax.toFixed(1)} min` : '—'}</div>
                          </div>
                        </div>
                      );
                    })()}
                  </div>
                )}
              </div>
            </div>

            <div className="flex items-center justify-between gap-3 px-6 py-4 border-t border-gray-200 bg-gray-50">
              <div className="text-xs text-gray-600">
                Under:{' '}
                <span className="text-gray-900 font-medium">
                  {Number.isFinite(speedingThresholdMinutes) ? speedingThresholdMinutes.toFixed(1) : '—'} min
                </span>
                {speedingUpperEnabled && (
                  <>
                    <span className="mx-2 text-gray-300">|</span>
                    Over:{' '}
                    <span className="text-gray-900 font-medium">
                      {Number.isFinite(speedingUpperThresholdMinutes) ? speedingUpperThresholdMinutes.toFixed(1) : '—'} min
                    </span>
                  </>
                )}
              </div>
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={() => setSettingsCheckType(null)}
                  className="px-4 py-2 text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={saveSpeedingSettings}
                  className="px-4 py-2 text-white rounded-lg transition-colors"
                  style={{ backgroundColor: BRAND_ORANGE }}
                >
                  Save
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Straight-Lining Settings Modal (v2) */}
      {settingsCheckType === 'straightlining' && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-lg mx-4">
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200">
              <h3 className="text-lg font-semibold text-gray-900">Straight-Lining Settings</h3>
              <button
                type="button"
                onClick={() => setSettingsCheckType(null)}
                className="text-gray-400 hover:text-gray-600 transition-colors"
              >
                <XMarkIcon className="w-6 h-6" />
              </button>
            </div>

            <div className="p-6 space-y-4">
              <div className="bg-white rounded-lg border border-gray-200 p-4">
                <div className="text-sm font-medium text-gray-900">Minimum statements required</div>
                <div className="mt-1 text-xs text-gray-500">
                  Straight-lining checks will be enabled only for grid questions with at least this many statements.
                </div>

                <div className="mt-4">
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    # of statements
                  </label>
                  <input
                    type="number"
                    min={1}
                    step={1}
                    value={straightliningMinStatementsInput}
                    onChange={(e) => setStraightliningMinStatementsInput(e.target.value)}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:outline-none focus:border-gray-400"
                  />
                </div>
              </div>

              <div className="bg-white rounded-lg border border-gray-200 p-4">
                <div className="text-sm font-medium text-gray-900">Scoring strength (weighted)</div>
                <div className="mt-1 text-xs text-gray-500">
                  Used to weight straight-lining flags based on how many statements are in the grid (more statements ⇒ stronger weight).
                </div>

                <div className="mt-4 space-y-2 text-sm text-gray-700">
                  <div className="flex items-center justify-between">
                    <span className="text-gray-600">Statement range (eligible)</span>
                    <span className="font-medium text-gray-900">
                      {derivedStraightliningSettings.minReq}–{derivedStraightliningSettings.maxStatements}
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-gray-600">Reference statements (avg, rounded up)</span>
                    <span className="font-medium text-gray-900">{derivedStraightliningSettings.referenceStatements}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-gray-600">Max weight (max statements)</span>
                    <span className="font-medium text-gray-900">{derivedStraightliningSettings.maxStatements}</span>
                  </div>
                </div>
              </div>
            </div>

            <div className="flex justify-end gap-3 px-6 py-4 border-t border-gray-200 bg-gray-50">
              <button
                type="button"
                onClick={() => setSettingsCheckType(null)}
                className="px-4 py-2 text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={saveStraightliningSettings}
                className="px-4 py-2 text-white rounded-lg transition-colors"
                style={{ backgroundColor: BRAND_ORANGE }}
              >
                Save
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Open-End Quality Settings Modal (v2) */}
      {settingsCheckType === 'open_end' && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-lg mx-4">
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200">
              <h3 className="text-lg font-semibold text-gray-900">Open-End Quality Settings</h3>
              <button
                type="button"
                onClick={() => setSettingsCheckType(null)}
                className="text-gray-400 hover:text-gray-600 transition-colors"
              >
                <XMarkIcon className="w-6 h-6" />
              </button>
            </div>

            <div className="p-6 space-y-4">
              <div className="bg-white rounded-lg border border-gray-200 p-4">
                <label className="flex items-center gap-2 text-sm text-gray-700">
                  <input
                    type="checkbox"
                    className="h-4 w-4"
                    checked={openEndEnabledInput}
                    onChange={(e) => {
                      const checked = e.target.checked;
                      setOpenEndEnabledInput(checked);
                      if (!checked) setOpenEndIncludeOtherSpecifyInput(false);
                    }}
                  />
                  Include open ends
                </label>
                <div className="mt-1 text-xs text-gray-500">
                  When unchecked, Open-End checks will not be included in the run.
                </div>
              </div>

              <div className="bg-white rounded-lg border border-gray-200 p-4">
                <label className="flex items-center gap-2 text-sm text-gray-700">
                  <input
                    type="checkbox"
                    className="h-4 w-4"
                    checked={openEndEnabledInput && openEndIncludeOtherSpecifyInput}
                    onChange={(e) => setOpenEndIncludeOtherSpecifyInput(e.target.checked)}
                    disabled={!openEndEnabledInput}
                  />
                  Include other (specify) open ends
                </label>
                <div className="mt-1 text-xs text-gray-500">
                  When unchecked, open-end questions whose question # contains <span className="font-medium">“oe”</span> will be disabled by default.
                </div>
              </div>
            </div>

            <div className="flex justify-end gap-3 px-6 py-4 border-t border-gray-200 bg-gray-50">
              <button
                type="button"
                onClick={() => setSettingsCheckType(null)}
                className="px-4 py-2 text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={saveOpenEndSettings}
                className="px-4 py-2 text-white rounded-lg transition-colors"
                style={{ backgroundColor: BRAND_ORANGE }}
              >
                Save
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}






