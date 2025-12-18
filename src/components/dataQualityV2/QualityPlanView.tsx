import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Cog6ToothIcon, XMarkIcon } from '@heroicons/react/24/outline';
import type { QualityPlan, QualityRule, QuestionType, CheckTypeId } from '../../types/dataQuality';

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
};

type QualityPlanCardId = 'speeding' | 'straightlining' | 'numeric_grids' | 'open_end';

const QUALITY_PLAN_CARDS: Array<{ id: QualityPlanCardId; label: string }> = [
  { id: 'speeding', label: 'Speeding' },
  { id: 'straightlining', label: 'Straight-Lining (non-numeric grids)' },
  { id: 'numeric_grids', label: 'Repeat Numerics' },
  { id: 'open_end', label: 'Open-End Quality' },
];

function hasBracketsInResponseCodes(responseCodes: DatamapParsedQuestion['responseCodes']): boolean {
  return Array.isArray(responseCodes) && responseCodes.some((rc) => /\[([^\]]+)\]|\(([^)]+)\)/.test(String(rc?.code || '').trim()));
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

  const rt = String(match?.responseType || '').toLowerCase();
  const hasCodes = Array.isArray(match?.responseCodes) && match!.responseCodes!.length > 0;
  // Mirrors inference in this file + Data Map view: open numeric + response codes => numeric grid
  return rt.includes('open numeric') && hasCodes;
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
  const rcs = q.responseCodes || [];
  if (!Array.isArray(rcs) || rcs.length === 0) return 0;
  const tokens = new Set<string>();
  rcs.forEach((rc) => {
    const code = String(rc?.code || '').trim();
    if (!code) return;
    extractBracketTokens(code).forEach((t) => tokens.add(t));
  });
  // Fallback: if nothing bracketed, treat as unknown (0)
  return tokens.size;
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
  const hasCodes = Array.isArray(q.responseCodes) && q.responseCodes.length > 0;

  // Open text → open_end rule
  if (rt.includes('open text')) {
    return { questionType: 'open_end', forStraightlining: false, forOpenEnd: true };
  }

  // Numeric grid: open numeric + response codes
  if (rt.includes('open numeric') && hasCodes) {
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

  // Single-select grids: values range + bracket-coded response codes
  if (rt.includes('values:') && hasCodes && hasBracketsInResponseCodes(q.responseCodes)) {
    return { questionType: 'grid', forStraightlining: true, forOpenEnd: false };
  }

  // Single select (values range)
  if (rt.includes('values:')) {
    return { questionType: 'single', forStraightlining: false, forOpenEnd: false };
  }

  // Default fallback
  return { questionType: 'single', forStraightlining: false, forOpenEnd: false };
}

function createPlanFromDatamap(projectId: string, parsedQuestions: DatamapParsedQuestion[]): QualityPlan {
  const now = new Date().toISOString();

  const rules: QualityRule[] = [];
  const numericGridGroups = new Map<string, {
    baseQuestionNumber: string;
    baseKey: string;
    columns: Array<{ questionNumber: string; columnIndex: number; questionText: string }>;
    statementCount: number;
  }>();
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

  const repeatNumericsSettings = (() => {
    try {
      const raw = localStorage.getItem(getSettingsKey(projectId));
      const parsed = raw ? JSON.parse(raw) : {};
      const minValuesPerColumn = Number(parsed?.repeatNumericsMinValuesPerColumn);
      const minConstantColumnsToFlag = Number(parsed?.repeatNumericsMinConstantColumnsToFlag);
      const maxWeight = Number(parsed?.repeatNumericsMaxWeight);
      return {
        minValuesPerColumn: Number.isFinite(minValuesPerColumn) && minValuesPerColumn > 0 ? Math.floor(minValuesPerColumn) : 2,
        minConstantColumnsToFlag:
          Number.isFinite(minConstantColumnsToFlag) && minConstantColumnsToFlag > 0 ? Math.floor(minConstantColumnsToFlag) : 1,
        maxWeight: Number.isFinite(maxWeight) && maxWeight > 0 ? Math.floor(maxWeight) : 20,
      };
    } catch {
      return { minValuesPerColumn: 2, minConstantColumnsToFlag: 1, maxWeight: 20 };
    }
  })();

  // Pre-count c# column variants so we only group when there are 2+ columns
  // (prevents false positives for question numbers that coincidentally end with "c1").
  const numericGridBaseCounts = (() => {
    const counts = new Map<string, number>();
    parsedQuestions.forEach((q) => {
      const qNum = String(q?.questionNumber || '').trim();
      if (!qNum) return;
      if (isHiddenQuestionNumber(qNum)) return;
      const parsedCol = parseNumericGridColumnQuestionNumber(qNum);
      if (!parsedCol) return;
      const baseKey = normalizeQuestionNumberKey(parsedCol.baseQuestionNumber);
      if (!baseKey) return;
      counts.set(baseKey, (counts.get(baseKey) || 0) + 1);
    });
    return counts;
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

    // Exclude hidden questions (matches Data Map "Hidden" column rule)
    if (isHiddenQuestionNumber(qNum)) {
      return;
    }

    const inferred = inferQuestionTypeFromDatamap(q);

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

    if (inferred.forStraightlining) {
      const statementCount = countStatementsFromDatamapQuestion(q);

      // If numeric grids are exported as QS11c1, QS11c2, ... group them under QS11
      const parsedCol = parseNumericGridColumnQuestionNumber(qNum);
      if (parsedCol) {
        const baseQuestionNumber = parsedCol.baseQuestionNumber;
        const baseKey = normalizeQuestionNumberKey(baseQuestionNumber);
        const baseCount = baseKey ? (numericGridBaseCounts.get(baseKey) || 0) : 0;
        if (baseKey && baseCount >= 2) {
          const existing = numericGridGroups.get(baseKey) || {
            baseQuestionNumber,
            baseKey,
            columns: [],
            statementCount,
          };
          existing.columns.push({
            questionNumber: qNum,
            columnIndex: parsedCol.columnIndex,
            questionText: String(q.description || ''),
          });
          existing.statementCount = Math.max(existing.statementCount || 0, statementCount || 0);
          // Preserve a nicer base label if we see one later
          if (!existing.baseQuestionNumber) existing.baseQuestionNumber = baseQuestionNumber;
          numericGridGroups.set(baseKey, existing);
          return;
        }
      }

      rules.push({
        id: `${qNum}_straightlining_${Date.now()}_${idx}`,
        questionNumber: qNum,
        questionText: String(q.description || ''),
        questionType: inferred.questionType,
        checkTypeId: 'straightlining',
        enabled: statementCount >= straightliningSettings.minStatementsRequired,
        config: {
          threshold: 80,
          statementCount,
          minAnsweredStatements: straightliningSettings.minStatementsRequired,
          weightReferenceStatements: straightliningSettings.weightReferenceStatements,
          maxWeight: straightliningSettings.maxWeight,
        },
        createdAt: now,
        updatedAt: now,
      });
    }
  });

  // Add one Repeat Numerics rule per grouped numeric grid (QS11c1..QS11cN => QS11)
  numericGridGroups.forEach((g, key) => {
    if (!g.columns || g.columns.length < 2) {
      // Not truly multi-column; add as an individual straight-lining rule.
      const only = g.columns && g.columns[0];
      if (only) {
        rules.push({
          id: `${only.questionNumber}_straightlining_${Date.now()}`,
          questionNumber: only.questionNumber,
          questionText: String(only.questionText || ''),
          questionType: 'grid',
          checkTypeId: 'straightlining',
          enabled: Number(g.statementCount || 0) >= straightliningSettings.minStatementsRequired,
          config: {
            threshold: 80,
            statementCount: g.statementCount || 0,
            minAnsweredStatements: straightliningSettings.minStatementsRequired,
            weightReferenceStatements: straightliningSettings.weightReferenceStatements,
            maxWeight: straightliningSettings.maxWeight,
          },
          createdAt: now,
          updatedAt: now,
        });
      }
      return;
    }

    const baseQuestionNumber = g.baseQuestionNumber || key;
    const cols = g.columns
      .slice()
      .sort((a, b) => a.columnIndex - b.columnIndex)
      .map((c) => ({ questionNumber: c.questionNumber, columnIndex: c.columnIndex }));

    const statementCount = Number(g.statementCount || 0);
    const enabled = Number.isFinite(statementCount) ? statementCount >= 2 : true;

    rules.push({
      id: `${baseQuestionNumber}_repeat_numerics_${Date.now()}`,
      questionNumber: baseQuestionNumber,
      questionText: String(g.columns.find((c) => c.questionText)?.questionText || ''),
      questionType: 'grid',
      checkTypeId: 'straightlining',
      enabled,
      config: {
        gridMode: 'numeric_grid',
        numericGridColumns: cols,
        // Repeat Numerics checks for constant numeric values down each column.
        minValuesPerColumn: repeatNumericsSettings.minValuesPerColumn,
        minConstantColumnsToFlag: repeatNumericsSettings.minConstantColumnsToFlag,
        maxWeight: repeatNumericsSettings.maxWeight,
        statementCount: Number.isFinite(statementCount) ? statementCount : null,
      },
      createdAt: now,
      updatedAt: now,
    });
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

  const repeatNumericsBaseKeysFromDatamap = useMemo(() => {
    // baseKey -> count of c# variants in Data Map
    const counts = new Map<string, number>();
    parsedQuestions.forEach((q) => {
      const qNum = String(q?.questionNumber || '').trim();
      if (!qNum) return;
      const parsedCol = parseNumericGridColumnQuestionNumber(qNum);
      if (!parsedCol) return;
      const baseKey = normalizeQuestionNumberKey(parsedCol.baseQuestionNumber);
      if (!baseKey) return;
      counts.set(baseKey, (counts.get(baseKey) || 0) + 1);
    });
    // Only treat as grouped numeric grid if it has multiple columns
    const out = new Set<string>();
    counts.forEach((n, k) => { if (n >= 2) out.add(k); });
    return out;
  }, [parsedQuestions]);

  const [plan, setPlan] = useState<QualityPlan | null>(null);
  type SettingsModalId = 'speeding' | 'straightlining' | 'repeat_numerics' | 'open_end' | null;
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

  // Backfill / migrate Repeat Numerics rules:
  // - If Data Map has QS11c1..QS11cN, collapse those into ONE rule QS11 (gridMode=numeric_grid, numericGridColumns=[...])
  // - Also tag legacy 2D numeric grids (r#c#) as gridMode=numeric_grid for UI grouping.
  const numericGridBackfillDoneRef = useRef(false);
  useEffect(() => {
    if (!plan) return;
    if (!Array.isArray(plan.rules) || plan.rules.length === 0) return;
    if (!Array.isArray(parsedQuestions) || parsedQuestions.length === 0) return;

    // If the plan still contains QS11c1/QS11c2-style rules for a base that has 2+ columns,
    // rerun the backfill even if we've run before (covers hot reload + old stored plans).
    const needsCollapse = (() => {
      const straightliningRules = (plan.rules || []).filter((r) => r.checkTypeId === 'straightlining');
      const counts = new Map<string, number>();
      straightliningRules.forEach((r) => {
        const parsedCol = parseNumericGridColumnQuestionNumber(String(r.questionNumber || '').trim());
        if (!parsedCol) return;
        const baseKey = normalizeQuestionNumberKey(parsedCol.baseQuestionNumber);
        if (!baseKey) return;
        if (!repeatNumericsBaseKeysFromDatamap.has(baseKey)) return;
        counts.set(baseKey, (counts.get(baseKey) || 0) + 1);
      });
      // If any base has 2+ column rules still present, we should collapse.
      for (const [, n] of counts.entries()) {
        if (n >= 2) return true;
      }
      return false;
    })();

    if (numericGridBackfillDoneRef.current && !needsCollapse) return;

    const allCols = fullRawData?.columns || [];
    const now = new Date().toISOString();

    // Build Data Map numeric-grid groups: baseKey -> { baseQuestionNumber, columns[] }
    const groups = new Map<string, { baseQuestionNumber: string; baseKey: string; columns: Array<{ questionNumber: string; columnIndex: number }> }>();
    parsedQuestions.forEach((q) => {
      const qNum = String(q.questionNumber || '').trim();
      if (!qNum) return;
      if (isHiddenQuestionNumber(qNum)) return;
      const parsedCol = parseNumericGridColumnQuestionNumber(qNum);
      if (!parsedCol) return;
      const baseKey = normalizeQuestionNumberKey(parsedCol.baseQuestionNumber);
      if (!baseKey) return;
      const existing = groups.get(baseKey) || { baseQuestionNumber: parsedCol.baseQuestionNumber, baseKey, columns: [] };
      existing.columns.push({ questionNumber: qNum, columnIndex: parsedCol.columnIndex });
      groups.set(baseKey, existing);
    });

    let nextRules = [...plan.rules];
    let changed = false;

    // If Data Map doesn't contain the column-question rows (or parsing differs),
    // fall back to grouping from the plan's own straightlining rules.
    const planStraightliningRules = nextRules.filter((r) => r.checkTypeId === 'straightlining');
    const planGroups = new Map<string, { baseQuestionNumber: string; baseKey: string; columns: Array<{ questionNumber: string; columnIndex: number }> }>();
    planStraightliningRules.forEach((r) => {
      const qNum = String(r.questionNumber || '').trim();
      if (!qNum) return;
      const parsedCol = parseNumericGridColumnQuestionNumber(qNum);
      if (!parsedCol) return;
      const baseKey = normalizeQuestionNumberKey(parsedCol.baseQuestionNumber);
      if (!baseKey) return;
      if (!repeatNumericsBaseKeysFromDatamap.has(baseKey)) return;
      const existing = planGroups.get(baseKey) || { baseQuestionNumber: parsedCol.baseQuestionNumber, baseKey, columns: [] };
      existing.columns.push({ questionNumber: qNum, columnIndex: parsedCol.columnIndex });
      planGroups.set(baseKey, existing);
    });
    planGroups.forEach((g, baseKey) => {
      const existing = groups.get(baseKey);
      if (existing) return;
      if (!g.columns || g.columns.length < 2) return;
      groups.set(baseKey, g);
    });

    // Collapse QS11c# rules into a single QS11 Repeat Numerics rule
    groups.forEach((g) => {
      const cols = g.columns.slice().sort((a, b) => a.columnIndex - b.columnIndex);
      if (cols.length < 2) return; // not a multi-column grid

      const colKeySet = new Set(cols.map((c) => normalizeQuestionNumberKey(c.questionNumber)));
      const baseKey = g.baseKey;

      const straightliningRules = nextRules.filter((r) => r.checkTypeId === 'straightlining');
      const baseRule = straightliningRules.find((r) => normalizeQuestionNumberKey(r.questionNumber) === baseKey) || null;
      const columnRules = straightliningRules.filter((r) => colKeySet.has(normalizeQuestionNumberKey(r.questionNumber)));

      if (!baseRule && columnRules.length === 0) return;

      // Choose the primary rule we will keep (prefer existing base rule; otherwise convert first column rule into base)
      const primary: QualityRule = (baseRule || columnRules[0]) as any;
      const enabled = (baseRule?.enabled ?? false) || columnRules.some((r) => r.enabled);

      const nextConfig: any = {
        ...(primary.config || {}),
        gridMode: 'numeric_grid',
        numericGridColumns: cols,
        minValuesPerColumn: Number.isFinite(Number((primary.config as any)?.minValuesPerColumn)) ? Number((primary.config as any)?.minValuesPerColumn) : 2,
        minConstantColumnsToFlag: Number.isFinite(Number((primary.config as any)?.minConstantColumnsToFlag)) ? Number((primary.config as any)?.minConstantColumnsToFlag) : 1,
      };

      const updatedPrimary: QualityRule = {
        ...primary,
        updatedAt: now,
        enabled,
        questionNumber: g.baseQuestionNumber,
        questionType: 'grid',
        config: nextConfig,
      };

      // Remove all column rules and base rule (except primary), then add updatedPrimary
      const idsToRemove = new Set<string>();
      columnRules.forEach((r) => { if (r.id !== primary.id) idsToRemove.add(r.id); });
      if (baseRule && baseRule.id !== primary.id) idsToRemove.add(baseRule.id);

      const beforeLen = nextRules.length;
      nextRules = nextRules.filter((r) => !idsToRemove.has(r.id)).map((r) => (r.id === primary.id ? updatedPrimary : r));
      if (nextRules.length !== beforeLen || idsToRemove.size > 0) changed = true;

      // If primary wasn't already in the list as baseRule/columnRule (shouldn't happen), ensure it's included
      if (!nextRules.some((r) => r.id === updatedPrimary.id)) {
        nextRules.push(updatedPrimary);
        changed = true;
      }
    });

    // Tag any remaining legacy numeric grids (open numeric + codes OR r#c# columns) with gridMode=numeric_grid
    nextRules = nextRules.map((r) => {
      if (r.checkTypeId !== 'straightlining') return r;
      const mode = String((r.config as any)?.gridMode || '').toLowerCase();
      if (mode === 'numeric_grid') return r;

      const looksNumericByDatamap = isNumericGridQuestionFromDatamap(parsedQuestions, r.questionNumber);
      const looks2DByHeaders = Array.isArray(allCols) && allCols.length > 0 && getGrid2DCellInfosForQuestion(allCols, r.questionNumber).length > 0;
      if (!looksNumericByDatamap && !looks2DByHeaders) return r;

      changed = true;
      return { ...r, updatedAt: now, config: { ...(r.config || {}), gridMode: 'numeric_grid' } };
    });

    numericGridBackfillDoneRef.current = true;
    if (!changed) return;

    const nextPlan: QualityPlan = { ...plan, updatedAt: now, rules: nextRules };
    setPlan(nextPlan);
    try {
      localStorage.setItem(getStorageKey(projectId), JSON.stringify(nextPlan));
    } catch {}
  }, [plan, parsedQuestions, projectId, fullRawData?.columns]);

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
    setOpenEndEnabled(true);
    setOpenEndEnabledInput(true);
    setOpenEndIncludeOtherSpecify(false);
    setOpenEndIncludeOtherSpecifyInput(false);
  }, [projectId]);

  const rulesByCard = useMemo(() => {
    const rules = plan?.rules || [];

    const speeding = rules.filter((r) => r.checkTypeId === 'speeding');
    const open_end = rules.filter((r) => r.checkTypeId === 'open_end');

    const straightliningAll = rules.filter((r) => r.checkTypeId === 'straightlining');
    const isRepeatNumericsRule = (r: QualityRule) => {
      const cfg = (r as any)?.config ?? (r as any)?.settings ?? {};
      const mode = String(cfg?.gridMode || '').toLowerCase();
      if (mode === 'numeric_grid') return true;
      if (Array.isArray(cfg?.numericGridColumns) && cfg.numericGridColumns.length > 0) return true;

      // Exact match: QS11c1 itself is a numeric grid column-question
      if (isNumericGridQuestionFromDatamap(parsedQuestions, r.questionNumber)) return true;

      // Column-question match: QS11c1 should be treated as Repeat Numerics if its base QS11 has multiple columns.
      const parsedCol = parseNumericGridColumnQuestionNumber(String(r.questionNumber || '').trim());
      if (parsedCol) {
        const baseKey = normalizeQuestionNumberKey(parsedCol.baseQuestionNumber);
        if (baseKey && repeatNumericsBaseKeysFromDatamap.has(baseKey)) return true;
      }

      // Base match: QS11 should be treated as Repeat Numerics if Data Map contains QS11c1..QS11cN
      const baseKey = normalizeQuestionNumberKey(r.questionNumber);
      if (baseKey && repeatNumericsBaseKeysFromDatamap.has(baseKey)) return true;

      // Legacy 2D exports: Qxxr#c#
      if (Array.isArray(fullRawData?.columns) && fullRawData!.columns!.length > 0) {
        return getGrid2DCellInfosForQuestion(fullRawData!.columns!, r.questionNumber).length > 0;
      }
      return false;
    };

    const numeric_grids = straightliningAll.filter(isRepeatNumericsRule);
    const straightlining = straightliningAll.filter((r) => !numeric_grids.includes(r));

    return { speeding, open_end, straightlining, numeric_grids };
  }, [plan?.rules, parsedQuestions, fullRawData?.columns, repeatNumericsBaseKeysFromDatamap]);

  const numericGridEligibilityByRuleId = useMemo(() => {
    const map = new Map<string, { included: boolean; reason: string | null }>();
    const cols = fullRawData?.columns || [];
    // If we don't have headers yet, we cannot determine eligibility reliably.
    // Avoid disabling rules prematurely while data is still loading.
    if (!Array.isArray(cols) || cols.length === 0) return map;

    (rulesByCard.numeric_grids || []).forEach((r) => {
      const gridMode = String((r.config as any)?.gridMode || '').toLowerCase();
      const numericGridColumns = (r.config as any)?.numericGridColumns;

      // Grouped numeric grids: base question with internal column questions (QS11c1..)
      if (gridMode === 'numeric_grid' && Array.isArray(numericGridColumns) && numericGridColumns.length > 0) {
        const rowCountsKnown: number[] = [];
        let hasUnknown = false;

        const getRowCountForSubQuestion = (subQ: string): number | null => {
          const subKey = normalizeQuestionNumberKey(subQ);
          const dm = (parsedQuestions || []).find((q) => normalizeQuestionNumberKey(q?.questionNumber) === subKey) || null;

          // Prefer Data Map responseCodes: in many exports, the "rows" live here, not in the raw headers.
          if (dm && Array.isArray(dm.responseCodes) && dm.responseCodes.length > 0) {
            const rSet = new Set<number>();
            dm.responseCodes.forEach((rc) => {
              const candidates = [rc?.code, rc?.label, rc?.text].map((v) => String(v || '')).filter(Boolean);
              candidates.forEach((t) => {
                const m = t.match(/r(\d+)/gi);
                if (!m) return;
                m.forEach((hit) => {
                  const n = parseInt(String(hit || '').replace(/[^0-9]/g, ''), 10);
                  if (Number.isFinite(n) && n > 0) rSet.add(n);
                });
              });
            });
            if (rSet.size > 0) return rSet.size;
            // Fallback: if no explicit r# markers, use the count of response codes as "rows"
            return dm.responseCodes.length;
          }

          // Fallback to parsing from raw headers (legacy exports like Qxxc1r1, Qxxc1r2...)
          const headers = Array.isArray(cols) && cols.length > 0 ? getStraightlineColumnNamesForQuestion(cols, subQ) : [];
          if (headers.length > 0) {
            const rSet = new Set<number>();
            headers.forEach((h) => {
              const m = String(h || '').match(/r(\d+)/i);
              if (!m) return;
              const ri = parseInt(String(m[1] || ''), 10);
              if (Number.isFinite(ri) && ri > 0) rSet.add(ri);
            });
            return rSet.size;
          }

          return null;
        };

        (numericGridColumns as any[]).forEach((colDef) => {
          const subQ = String(colDef?.questionNumber || '').trim();
          if (!subQ) return;
          const count = getRowCountForSubQuestion(subQ);
          if (count === null) {
            hasUnknown = true;
            return;
          }
          rowCountsKnown.push(count);
        });

        // If we can't confidently compute row counts (unknown formats), don't disable.
        if (rowCountsKnown.length === 0 && hasUnknown) {
          map.set(r.id, { included: true, reason: null });
          return;
        }

        if (rowCountsKnown.length === 0) {
          map.set(r.id, { included: false, reason: 'Not included (unable to determine rows per column)' });
          return;
        }

        const allKnownHaveOneOrLess = rowCountsKnown.every((n) => n <= 1);
        // Only disable when we're confident every column has ≤1 row (i.e., no unknowns).
        if (allKnownHaveOneOrLess && !hasUnknown) {
          map.set(r.id, { included: false, reason: 'Not included (≤1 row per column)' });
          return;
        }

        map.set(r.id, { included: true, reason: null });
        return;
      }

      // Legacy 2D numeric grids: r#c# columns
      const cells = Array.isArray(cols) && cols.length > 0 ? getGrid2DCellInfosForQuestion(cols, r.questionNumber) : [];
      if (cells.length === 0) {
        map.set(r.id, { included: false, reason: 'Not included (no numeric-grid columns found)' });
        return;
      }

      const rowsByC = new Map<number, Set<number>>();
      cells.forEach((cell) => {
        const set = rowsByC.get(cell.c) || new Set<number>();
        set.add(cell.r);
        rowsByC.set(cell.c, set);
      });

      const counts = Array.from(rowsByC.values()).map((s) => s.size);
      const hasAnyColumns = counts.length > 0;
      const allColumnsHaveOneOrLess = hasAnyColumns && counts.every((n) => n <= 1);

      if (allColumnsHaveOneOrLess) {
        map.set(r.id, { included: false, reason: 'Not included (≤1 row per column)' });
        return;
      }

      map.set(r.id, { included: true, reason: null });
    });

    return map;
  }, [rulesByCard.numeric_grids, fullRawData?.columns]);

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

  const openRepeatNumericsSettings = () => {
    setSettingsCheckType('repeat_numerics');
    setRepeatNumericsMinValuesPerColumnInput(String(repeatNumericsMinValuesPerColumn || 2));
    setRepeatNumericsMinConstantColumnsToFlagInput(String(repeatNumericsMinConstantColumnsToFlag || 1));
    setRepeatNumericsMaxWeightInput(String(repeatNumericsMaxWeight || 20));
  };

  const openOpenEndSettings = () => {
    setSettingsCheckType('open_end');
    setOpenEndEnabledInput(!!openEndEnabled);
    setOpenEndIncludeOtherSpecifyInput(!!openEndIncludeOtherSpecify);
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
    <div className="py-6 px-0">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h3 className="text-lg font-semibold text-gray-900">Quality Plan</h3>
          <p className="text-xs text-gray-500 mt-1">
            Generated from your Data Map (not QNR). Stored locally for Data Quality v2 only.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={resetPlanToDefaults}
            disabled={runningChecks || !parsedQuestions || parsedQuestions.length === 0}
            className="px-4 py-2 rounded-lg border border-gray-300 bg-white text-gray-700 hover:bg-gray-50 disabled:opacity-50 transition-colors"
            title="Reset the plan + settings to defaults"
          >
            Reset to defaults
          </button>
          <button
            onClick={runQualityChecks}
            disabled={!plan || runningChecks || !((fullRawData?.rows?.length ?? 0) > 0)}
            className="px-4 py-2 text-white rounded-lg disabled:opacity-50 transition-colors flex items-center gap-2"
            style={{ backgroundColor: '#111827' }}
            title={(fullRawData?.rows?.length ?? 0) <= 0 ? 'Upload a data file first' : 'Run quality checks'}
          >
            {runningChecks && (
              <span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-white/40 border-t-white" />
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

            return (
              <div key={ct.id} className="bg-white rounded-lg border border-gray-200 overflow-hidden flex flex-col min-h-[360px]">
                <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between" style={{ backgroundColor: `${BRAND_ORANGE}08` }}>
                  <div>
                    <div className="text-sm font-semibold text-gray-900">{ct.label}</div>
                    <div className="text-xs text-gray-500">{countsByCard[ct.id] || 0} rule(s)</div>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        if (ct.id === 'speeding') openSpeedingSettings();
                        if (ct.id === 'straightlining') openStraightliningSettings();
                        if (ct.id === 'numeric_grids') openRepeatNumericsSettings();
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
                <div className="divide-y divide-gray-100 flex-1 overflow-y-auto">
                  {rules.length === 0 ? (
                    <div className="px-4 py-6 text-center text-sm text-gray-400">No rules</div>
                  ) : (
                    rules.map((r) => (
                      <div key={r.id} className="px-4 py-2.5 flex items-center justify-between hover:bg-gray-50">
                        <div className="min-w-0">
                          <div className="text-sm font-medium text-gray-900 truncate">{r.questionNumber}</div>
                          {!!r.questionText && (
                            <div className="text-xs text-gray-500 truncate">{r.questionText}</div>
                          )}
                          {ct.id === 'numeric_grids' && (
                            <div className="text-[11px] text-gray-500 mt-0.5 truncate">
                              {(() => {
                                const eligibility = numericGridEligibilityByRuleId.get(r.id);
                                if (!eligibility) return '—';
                                return eligibility.included ? 'Included' : (eligibility.reason || 'Not included');
                              })()}
                            </div>
                          )}
                        </div>
                        <button
                          type="button"
                          onClick={() => {
                            if (ct.id === 'numeric_grids') {
                              const eligibility = numericGridEligibilityByRuleId.get(r.id);
                              if (eligibility && !eligibility.included) return;
                            }
                            handleToggleRule(r.id);
                          }}
                          role="switch"
                          aria-checked={!!r.enabled}
                          aria-disabled={ct.id === 'numeric_grids' && !!numericGridEligibilityByRuleId.get(r.id) && !numericGridEligibilityByRuleId.get(r.id)!.included}
                          disabled={ct.id === 'numeric_grids' && !!numericGridEligibilityByRuleId.get(r.id) && !numericGridEligibilityByRuleId.get(r.id)!.included}
                          className={`ml-3 relative inline-flex h-6 w-11 flex-shrink-0 items-center rounded-full border border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-orange-500 ${
                            (ct.id === 'numeric_grids' && !!numericGridEligibilityByRuleId.get(r.id) && !numericGridEligibilityByRuleId.get(r.id)!.included)
                              ? 'bg-gray-200 cursor-not-allowed opacity-60'
                              : (r.enabled ? 'bg-green-500 cursor-pointer' : 'bg-gray-300 cursor-pointer')
                          }`}
                          title={(ct.id === 'numeric_grids' && !!numericGridEligibilityByRuleId.get(r.id) && !numericGridEligibilityByRuleId.get(r.id)!.included)
                            ? (numericGridEligibilityByRuleId.get(r.id)!.reason || 'Not included')
                            : (r.enabled ? 'Enabled (click to disable)' : 'Disabled (click to enable)')}
                        >
                          <span
                            aria-hidden="true"
                            className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${
                              r.enabled ? 'translate-x-5' : 'translate-x-1'
                            }`}
                          />
                        </button>
                      </div>
                    ))
                  )}
                </div>
              </div>
            );
          })}
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

      {/* Repeat Numerics Settings Modal (v2) */}
      {settingsCheckType === 'repeat_numerics' && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-lg mx-4">
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200">
              <h3 className="text-lg font-semibold text-gray-900">Repeat Numerics Settings</h3>
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
                <div className="text-sm font-medium text-gray-900">What this check does</div>
                <div className="mt-1 text-xs text-gray-500">
                  For each numeric grid column (c1, c2, …), it looks at the numeric values across rows (r1..rN) for a respondent.
                  If all numeric values in a column are identical (and there are enough values), that column is “constant”.
                  A respondent is flagged if enough columns are constant.
                </div>
              </div>

              <div className="bg-white rounded-lg border border-gray-200 p-4">
                <div className="text-sm font-medium text-gray-900">Eligibility / minimums</div>
                <div className="mt-1 text-xs text-gray-500">
                  Helps avoid flagging when there isn’t enough numeric data in a column.
                </div>

                <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Min numeric values per column
                    </label>
                    <input
                      type="number"
                      min={1}
                      step={1}
                      value={repeatNumericsMinValuesPerColumnInput}
                      onChange={(e) => setRepeatNumericsMinValuesPerColumnInput(e.target.value)}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:outline-none focus:border-gray-400"
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Min constant columns to flag
                    </label>
                    <input
                      type="number"
                      min={1}
                      step={1}
                      value={repeatNumericsMinConstantColumnsToFlagInput}
                      onChange={(e) => setRepeatNumericsMinConstantColumnsToFlagInput(e.target.value)}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:outline-none focus:border-gray-400"
                    />
                  </div>
                </div>
              </div>

              <div className="bg-white rounded-lg border border-gray-200 p-4">
                <div className="text-sm font-medium text-gray-900">Scoring strength</div>
                <div className="mt-1 text-xs text-gray-500">
                  Max weight for this check for a respondent. Actual weight scales by the % of eligible columns that are constant.
                </div>

                <div className="mt-4">
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Max weight
                  </label>
                  <input
                    type="number"
                    min={1}
                    step={1}
                    value={repeatNumericsMaxWeightInput}
                    onChange={(e) => setRepeatNumericsMaxWeightInput(e.target.value)}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:outline-none focus:border-gray-400"
                  />
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
                onClick={saveRepeatNumericsSettings}
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






