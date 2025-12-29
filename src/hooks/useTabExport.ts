import { useCallback } from 'react';
import ExcelJS from 'exceljs';
import { Variable } from '../utils/tabs/types';
import { BannerGroup } from '../types/dataTabulation';
import { getBaseQuestionNumber } from '../utils/tabs/questionHelpers';
import { buildNumericGridSummaryModel, type NumericGridSummaryType } from '../utils/tabs/gridNumericSummary';
import { getExpectedColumnHeadersForBase, getExpectedHeadersForQuestion } from '../utils/tabs/expectedHeaders';

// console.log('🚀🚀🚀 useTabExport.ts MODULE LOADED - NEW CODE VERSION 2025-12-29 🚀🚀🚀');

interface TableDebugEntry {
  tableTitle: string;
  variableName: string;
  variableType: string;
  isMultiSelectGridColumn: boolean;
  columnCode?: string | null;
  sampleStatements?: Array<{
    key: string;
    label: string;
    totalCount: number;
    totalPercentage: number;
    totalBase: number;
    cutCounts: Array<{ title: string; count: number; percentage: number }>;
  }>;
}

type BuildWorkbookOptions = {
  includeToc?: boolean;
  workbook?: ExcelJS.Workbook;
  sheetName?: string;
};

interface UseTabExportProps {
  fullRawData: any;
  variableStatsSelections: any;
  variableSortByFrequency: Record<string, boolean>;
  netSummaryTableSelectedCodes: Record<string, Array<{ name: string; codes: string[] }>>;
  netSummaryTableRanges: any;
  hiddenFromBanners: Set<string>;
  questionnaireQuestions: any[];
  selectedQuestionnaire: any;
  columnMapping: Record<string, string>;
  newBannerGroups: BannerGroup[];
  calculateBannerTableDataForVariable: any;
  getTablesForVariable: (variable: Variable) => string[];
  getEffectiveSortByFrequency: (variable: Variable) => boolean;
  getCodeValueForMean: (variableRef: Variable | { name?: string } | string | null, code: string, fallback?: string) => number | null;
  getStatsSelectionsForVariable: (variableName: string) => any;
  applyHoldOrdering: any;
  formatPercentage: (value: number) => string;
  significanceLevel: 95 | 90 | 80;
  selectedProject: any;
  percentageDecimals: number;
  showStatDebug: boolean;
  appendStatLog: (msg: string, data?: any) => void;
}

export const useTabExport = (props: UseTabExportProps) => {
  const {
    fullRawData,
    variableStatsSelections,
    variableSortByFrequency,
    netSummaryTableSelectedCodes,
    netSummaryTableRanges,
    hiddenFromBanners,
    questionnaireQuestions,
    selectedQuestionnaire,
    columnMapping,
    newBannerGroups,
    calculateBannerTableDataForVariable,
    getTablesForVariable,
    getEffectiveSortByFrequency,
    getCodeValueForMean,
    getStatsSelectionsForVariable,
    applyHoldOrdering,
    formatPercentage,
    significanceLevel,
    selectedProject,
    percentageDecimals,
    showStatDebug,
    appendStatLog,
  } = props;

  const buildWorkbook = useCallback(async (
    variablesSubset: Variable[],
    bannerGroupOverride?: BannerGroup,
    options?: BuildWorkbookOptions
  ): Promise<{ workbook: ExcelJS.Workbook; sampleSize: number; debugInfo: Record<string, TableDebugEntry> }> => {
    console.log('🔵 buildWorkbook CALLED with', variablesSubset.length, 'variables, sheet:', options?.sheetName);
    if (!fullRawData || !variablesSubset.length) {
      throw new Error('Data not available for export. Please ensure data is loaded.');
    }

    try {
      const workbook = options?.workbook ?? new ExcelJS.Workbook();
      const getSafeSheetName = (name: string): string => {
        const trimmed = String(name || '').trim() || 'Tables';
        const cleaned = trimmed.replace(/[:\\/?*[\]]/g, '_');
        return cleaned.length > 31 ? cleaned.slice(0, 31) : cleaned;
      };
      const baseSheetName = getSafeSheetName(options?.sheetName || 'Data Cuts');
      let sheetName = baseSheetName;
      let suffix = 2;
      while (workbook.getWorksheet(sheetName)) {
        const suffixText = ` (${suffix})`;
        const maxBase = Math.max(1, 31 - suffixText.length);
        sheetName = `${baseSheetName.slice(0, maxBase)}${suffixText}`;
        suffix += 1;
      }

      // Statistical testing function for proportions/percentages
      const isSignificant = (p1: number, n1: number, p2: number, n2: number): { is95: boolean; is90: boolean } => {
        if (!n1 || !n2 || n1 <= 0 || n2 <= 0) return { is95: false, is90: false };
        const prop1 = p1 / 100;
        const prop2 = p2 / 100;
        const pooledProp = (prop1 * n1 + prop2 * n2) / (n1 + n2);
        const se = Math.sqrt(pooledProp * (1 - pooledProp) * (1/n1 + 1/n2));
        if (se === 0) return { is95: false, is90: false };
        const z = Math.abs(prop1 - prop2) / se;
        return { is95: z > 1.96, is90: z > 1.645 && z <= 1.96 };
      };

      // Statistical testing function for means (two-sample z-test with pooled variance)
      const isSignificantForMeans = (mean1: number, n1: number, stdDev1: number, mean2: number, n2: number, stdDev2: number, confidenceLevel: 95 | 90 | 80 = 95): { is95: boolean; is90: boolean } => {
        if (!n1 || !n2 || n1 <= 0 || n2 <= 0) return { is95: false, is90: false };
        
        // If both standard deviations are 0 or very small, and means are equal, no significance
        const meanDiff = Math.abs(mean1 - mean2);
        if (meanDiff < 0.0001) return { is95: false, is90: false };
        
        // Use a small epsilon to avoid division by zero when standard deviations are very small
        const epsilon = 0.0001;
        const adjustedStdDev1 = Math.max(stdDev1, epsilon);
        const adjustedStdDev2 = Math.max(stdDev2, epsilon);
        
        // Calculate pooled standard deviation
        const variance1 = adjustedStdDev1 * adjustedStdDev1;
        const variance2 = adjustedStdDev2 * adjustedStdDev2;
        const pooledVariance = ((n1 - 1) * variance1 + (n2 - 1) * variance2) / (n1 + n2 - 2);
        const pooledStdDev = Math.sqrt(Math.max(pooledVariance, epsilon * epsilon));
        
        // Standard error of the difference between means
        const se = pooledStdDev * Math.sqrt(1/n1 + 1/n2);
        if (se === 0 || se < epsilon) return { is95: false, is90: false };
        
        // Calculate z-score
        const z = meanDiff / se;
        
        // Get z-critical values based on confidence level
        const zCritical95 = confidenceLevel === 95 ? 1.96 : confidenceLevel === 90 ? 1.645 : 1.282;
        const zCritical90 = 1.645;
        
        return { 
          is95: z > zCritical95, 
          is90: z > zCritical90 && z <= zCritical95 
        };
      };

      // Debug helpers
      let currentStatDebugVar = '';
      let currentStatDebugCode = '';
      const shouldDebugStats = () => {
        const globalFlag = (globalThis as any).__TABEXPORT_DEBUG_STATS === true;
        return !!globalFlag || showStatDebug;
      };
      const logStatDebug = (...args: any[]) => {
        if (shouldDebugStats()) {
          // eslint-disable-next-line no-console
          console.warn('[STAT DEBUG]', ...args);
          // Mirror into UI panel
          try {
            appendStatLog(String(args?.[0] ?? ''), args?.[1]);
          } catch {}
        }
      };

      // Yield helpers to keep UI responsive during heavy loops
      const makeYielder = (interval: number) => {
        let counter = 0;
        return async () => {
          counter++;
          if (counter % interval === 0) {
            await new Promise<void>((resolve) => {
              // Give the browser a frame to paint
              requestAnimationFrame(() => resolve());
            });
          }
        };
      };
      const yieldPerVariable = makeYielder(1);   // yield each variable
      const yieldPerTable = makeYielder(2);      // yield every 2 tables

      // Helper to get column header
      const getColumnHeader = (varName: string): string | null => {
        const variations = [
          varName,
          varName.startsWith('Q') ? varName : `Q${varName}`,
          varName.startsWith('Q') ? varName.substring(1) : varName
        ];

        return getColumnHeaderByCandidates(variations);
      };

      const getColumnHeaderByCandidates = (candidates: string[]): string | null => {
        for (const candidate of candidates) {
          if (!candidate) continue;
          if (columnMapping[candidate]) {
            return columnMapping[candidate];
          }
          const matchingKey = Object.keys(columnMapping).find(
            key => key.toLowerCase() === candidate.toLowerCase()
          );
          if (matchingKey) {
            return columnMapping[matchingKey];
          }
        }

        if (fullRawData.columns) {
          for (const candidate of candidates) {
            if (!candidate) continue;
            const directMatch = fullRawData.columns.find(
              col => col.toLowerCase() === candidate.toLowerCase()
            );
            if (directMatch) {
              return directMatch;
            }
          }
        }

        return null;
      };

      const getVariableDataByExpectedHeader = (expectedHeader: string) => {
        if (!expectedHeader || !fullRawData?.rows) return null;
        const candidates = [
          expectedHeader,
          expectedHeader.startsWith('Q') ? expectedHeader.substring(1) : `Q${expectedHeader}`
        ];
        const resolved = getColumnHeaderByCandidates(candidates);
        if (!resolved) return null;
        const values = fullRawData.rows.map((row: any) => row[resolved]);
        return { values };
      };

      const getQuestionForVariable = (variable: Variable) => {
        const baseQuestionNumber = getBaseQuestionNumber(variable.name);
        const normalizedBase = baseQuestionNumber.replace(/^Q/i, '');
        return questionnaireQuestions.find((q: any) => {
          const qNum = q.number || q.id;
          if (!qNum) return false;
          const qStr = String(qNum);
          const normalizedQ = qStr.replace(/^Q/i, '');
          return qStr === baseQuestionNumber ||
            normalizedQ === normalizedBase ||
            qStr === normalizedBase ||
            `Q${normalizedQ}` === baseQuestionNumber;
        }) || null;
      };

      const normalizeNumericGridColumnCode = (code: string): string => {
        const trimmed = String(code || '').trim();
        if (!trimmed) return '';
        if (/^c\d+/i.test(trimmed)) return trimmed.toLowerCase();
        if (/^\d+$/.test(trimmed)) return `c${trimmed}`;
        return trimmed.toLowerCase();
      };

      const getNumericGridResponseOptions = (variable: Variable): Array<{ code: string; text: string }> => {
        const question = getQuestionForVariable(variable);
        if (question && Array.isArray(question.responseOptions)) {
          return question.responseOptions.map((opt: any, idx: number) => {
            if (typeof opt === 'string') {
              const match = opt.match(/^([^:]+):\s*(.*)$/);
              if (match) {
                return { code: String(match[1]).trim(), text: String(match[2]).trim() };
              }
              return { code: `c${idx + 1}`, text: opt };
            }
            const code = opt.code ?? opt.value ?? opt.id ?? `c${idx + 1}`;
            const text = opt.text ?? opt.label ?? String(code);
            return { code: String(code), text: String(text) };
          });
        }
        if (variable.codes && Object.keys(variable.codes).length > 0) {
          return Object.entries(variable.codes).map(([code, text]) => ({
            code: String(code),
            text: String(text),
          }));
        }
        return [{ code: 'c1', text: 'c1' }];
      };

      const getColumnHeaderFromQuestion = (variable: Variable): string | null => {
        const baseQuestionNumber = getBaseQuestionNumber(variable.name);
        const matchingQuestion = questionnaireQuestions.find(question => {
          const qNum = question.number || question.id;
          if (!qNum) return false;
          const qNumStr = String(qNum);
          const normalizedQNum = qNumStr.replace(/^Q/i, '');
          const normalizedBase = baseQuestionNumber.replace(/^Q/i, '');
          return (
            qNumStr === baseQuestionNumber ||
            normalizedQNum === normalizedBase ||
            `Q${normalizedQNum}` === baseQuestionNumber ||
            `Q${normalizedBase}` === qNumStr
          );
        });

        if (!matchingQuestion) return null;

        const questionNumber = String(
          matchingQuestion.number ??
          matchingQuestion.id ??
          baseQuestionNumber
        ).trim();
        const expectedHeaders = getExpectedHeadersForQuestion(
          matchingQuestion,
          questionNumber,
          variablesSubset,
          getExpectedColumnHeadersForBase
        );
        const candidates = new Set<string>();
        expectedHeaders.forEach((header) => {
          const base = String(header || '').trim();
          if (!base) return;
          candidates.add(base);
          if (!base.startsWith('Q')) {
            candidates.add(`Q${base}`);
          } else {
            candidates.add(base.substring(1));
          }
          candidates.add(`${base}c1`);
          candidates.add(`${base}r1`);
          candidates.add(`${base}r1c1`);
          const withQ = base.startsWith('Q') ? base : `Q${base}`;
          candidates.add(`${withQ}c1`);
          candidates.add(`${withQ}r1`);
          candidates.add(`${withQ}r1c1`);
        });
        for (const header of candidates) {
          const resolved = getColumnHeaderByCandidates([header]);
          if (resolved) return resolved;
        }
        return null;
      };

      const getMultiSelectNoteItems = (variable: Variable): Array<{ code: string; text: string }> => {
        const baseQuestionNumber = getBaseQuestionNumber(variable.name);
        const normalizedBase = baseQuestionNumber.replace(/^Q/i, '');
        const question = questionnaireQuestions.find((q: any) => {
          const qNum = q.number || q.id;
          if (!qNum) return false;
          const qStr = String(qNum);
          const normalizedQ = qStr.replace(/^Q/i, '');
          return qStr === baseQuestionNumber ||
                 normalizedQ === normalizedBase ||
                 qStr === normalizedBase ||
                 `Q${normalizedQ}` === baseQuestionNumber;
        });
        const notes = (question as any)?.notes;
        if (!Array.isArray(notes) || notes.length === 0) return [];
        const items: Array<{ code: string; text: string }> = [];
        notes.forEach((n: any) => {
          const s = String(n || '').trim();
          if (!s) return;
          const match = s.match(/^\[([^\]]+)\]\s*(.*)$/);
          if (!match) return;
          const id = String(match[1] || '').trim();
          const label = String(match[2] || '').trim();
          if (!id) return;
          items.push({ code: id, text: label || id });
        });
        const seen = new Set<string>();
        return items.filter((it) => {
          const key = it.code.toLowerCase();
          if (seen.has(key)) return false;
          seen.add(key);
          return true;
        });
      };

      // Build a row predicate from a BannerCut (supports AND/OR condition groups, numeric and categorical)
      const makeCutPredicate = (cut: BannerCut): ((row: any) => boolean) => {
        const parseNumeric = (s: any): number | null => {
          if (s === null || s === undefined || s === '') return null;
          const n = Number(String(s).trim());
          return isNaN(n) ? null : n;
        };
        const buildNumericChecker = (condStr: string): ((n: number | null) => boolean) => {
          const s = condStr.trim();
          // range "a-b"
          const range = s.match(/^(-?\d+(?:\.\d+)?)\s*-\s*(-?\d+(?:\.\d+)?)$/);
          if (range) {
            const a = Number(range[1]);
            const b = Number(range[2]);
            return (n) => n !== null && n >= a && n <= b;
          }
          // open-ended "a-" or "-b"
          const left = s.match(/^(-?\d+(?:\.\d+)?)\s*-\s*$/);
          if (left) {
            const a = Number(left[1]);
            return (n) => n !== null && n >= a;
          }
          const right = s.match(/^\s*-\s*(-?\d+(?:\.\d+)?)$/);
          if (right) {
            const b = Number(right[1]);
            return (n) => n !== null && n <= b;
          }
          // comparators
          const cmp = s.match(/^(>=|<=|>|<|=)\s*(-?\d+(?:\.\d+)?)$/);
          if (cmp) {
            const op = cmp[1];
            const value = Number(cmp[2]);
            return (n) => {
              if (n === null) return false;
              switch (op) {
                case '>=': return n >= value;
                case '<=': return n <= value;
                case '>': return n > value;
                case '<': return n < value;
                case '=': return n === value;
                default: return false;
              }
            };
          }
          // fallback: exact number
          const exact = Number(s);
          if (!isNaN(exact)) {
            return (n) => n !== null && n === exact;
          }
          // unknown, never matches
          return () => false;
        };
        const matchesCategorical = (row: any, varName: string, codes: string[]): boolean => {
          const header = getColumnHeader(varName);
          if (!header) return false;
          const val = row[header];
          if (val === null || val === undefined || val === '') return false;
          const s = String(val).trim();
          const n = Number(s);
          for (const code of codes) {
            if (s === code) return true;
            const codeNoC = code.replace(/^c/i, '');
            if (s === codeNoC) return true;
            if (!isNaN(n) && String(n) === codeNoC) return true;
          }
          return false;
        };
        const matchesNumeric = (row: any, varName: string, condStr: string): boolean => {
          const header = getColumnHeader(varName);
          if (!header) return false;
          const val = parseNumeric(row[header]);
          const check = buildNumericChecker(condStr);
          return check(val);
        };
        // If conditionGroups present, honor them
        if ((cut as any).conditionGroups && (cut as any).conditionGroups.length > 0) {
          const group = (cut as any).conditionGroups[0] as BannerConditionGroup;
          const op = (group.operator || 'OR').toUpperCase() as 'OR' | 'AND';
          const conds = group.conditions || [];
          return (row: any) => {
            if (op === 'AND') {
              return conds.every((c: any) => {
                if (c.codes && c.codes.length > 0) return matchesCategorical(row, c.variableName, c.codes);
                if (c.codes && c.codes[0] && /^[><=]/.test(c.codes[0])) return matchesNumeric(row, c.variableName, c.codes[0]);
                if (c.numericCondition) return matchesNumeric(row, c.variableName, c.numericCondition);
                return false;
              });
            } else {
              return conds.some((c: any) => {
                if (c.codes && c.codes.length > 0) return matchesCategorical(row, c.variableName, c.codes);
                if (c.codes && c.codes[0] && /^[><=]/.test(c.codes[0])) return matchesNumeric(row, c.variableName, c.codes[0]);
                if (c.numericCondition) return matchesNumeric(row, c.variableName, c.numericCondition);
                return false;
              });
            }
          };
        }
        // Fallback to legacy single-variable + codes
        if (cut.variableName && (cut.codes?.length || 0) > 0) {
          return (row: any) => matchesCategorical(row, cut.variableName, cut.codes!);
        }
        // No conditions: never filter (treat as Total-like)
        return () => false;
      };

      // Get the selected banner group (use override or first banner)
      const selectedBannerGroup = bannerGroupOverride || newBannerGroups[0];
      if (!selectedBannerGroup) {
        throw new Error('No banner group found. Please create a banner in the Banners tab first.');
      }
      // Only log for B8 to reduce console noise
      const isB8Variable = variablesSubset.some(v => v.name === 'B8');
      if (isB8Variable && ((globalThis as any).__TABEXPORT_DEBUG_STATS === true || showStatDebug)) {
        appendStatLog('export start', {
          bannerTitle: selectedBannerGroup.title,
          variablesCount: (variablesSubset?.length ?? 0)
        });
      }

      // Filter variables that should be exported
      const variablesToExport = variablesSubset.filter(v => {
        // Exclude summary table variables
        if (v.name.endsWith('_Summary Tables') || ((v as any).isSummaryTable && !(v as any).isScaleSummary)) {
          return false;
        }
        
        // Only include variables that have tables explicitly selected in Tab Specs
        const tables = getTablesForVariable(v);
        if (tables.length === 0) {
          return false;
        }
        
        return true;
      });

      let tableNumber = 1;
      const tableDebugInfo: Record<string, TableDebugEntry> = {};
      const findFirstBannerRowWithBase = (data: Record<string, any> | null | undefined): Record<string, any> | null => {
        if (!data) return null;
        const queue: any[] = Object.values(data);
        while (queue.length) {
          const node = queue.shift();
          if (!node || typeof node !== 'object') {
            continue;
          }
          if (node.total && typeof node.total.base === 'number') {
            return node;
          }
          Object.values(node).forEach(child => {
            if (child && typeof child === 'object') {
              queue.push(child);
            }
          });
        }
        return null;
      };

      const levenshteinDistance = (str1: string, str2: string): number => {
        const len1 = str1.length;
        const len2 = str2.length;
        const matrix: number[][] = Array.from({ length: len1 + 1 }, () => Array(len2 + 1).fill(0));

        for (let i = 0; i <= len1; i++) {
          matrix[i][0] = i;
        }
        for (let j = 0; j <= len2; j++) {
          matrix[0][j] = j;
        }

        for (let i = 1; i <= len1; i++) {
          for (let j = 1; j <= len2; j++) {
            const cost = str1[i - 1] === str2[j - 1] ? 0 : 1;
            matrix[i][j] = Math.min(
              matrix[i - 1][j] + 1,
              matrix[i][j - 1] + 1,
              matrix[i - 1][j - 1] + cost
            );
          }
        }
        return matrix[len1][len2];
      };

      const areOpenEndSimilar = (str1: string, str2: string): boolean => {
        const normalized1 = str1.toLowerCase().trim();
        const normalized2 = str2.toLowerCase().trim();
        if (normalized1 === normalized2) return true;
        const lenDiff = Math.abs(normalized1.length - normalized2.length);
        const maxLen = Math.max(normalized1.length, normalized2.length);
        if (maxLen === 0) return true;
        if (lenDiff / maxLen > 0.2) return false;
        const distance = levenshteinDistance(normalized1, normalized2);
        const maxDistance = Math.ceil(maxLen * 0.15);
        return distance <= maxDistance;
      };

      // Helper to calculate frequency table data
      const calculateFrequencyData = (variable: Variable, tableName: string) => {
        const isOpenEndType = variable.type?.toLowerCase().includes('open end') &&
          !variable.type?.toLowerCase().includes('list');

        if (isOpenEndType) {
          // Check if this is an individual statement table (e.g., S12_r1)
          const statementMatch = tableName.match(/_([rR]\d+)$/);
          const statementCode = statementMatch ? statementMatch[1] : null;

          let variableData;
          if (statementCode) {
            // Individual statement table - look up the specific column (e.g., QS12r1)
            const baseName = variable.name;
            let normalizedCode = statementCode;
            if (!/^r/i.test(normalizedCode) && /^\d+$/.test(normalizedCode)) {
              normalizedCode = `r${normalizedCode}`;
            }

            // Try variations: QS12r1, S12r1, etc.
            const variations = [
              `Q${baseName}${normalizedCode}`,
              `${baseName}${normalizedCode}`,
              baseName.startsWith('Q') ? `${baseName}${normalizedCode}` : `Q${baseName}${normalizedCode}`
            ];

            let colHeader: string | null = null;
            for (const variation of variations) {
              if (columnMapping[variation]) {
                colHeader = columnMapping[variation];
                break;
              }
              const matchingKey = Object.keys(columnMapping).find(
                key => key.toLowerCase() === variation.toLowerCase()
              );
              if (matchingKey) {
                colHeader = columnMapping[matchingKey];
                break;
              }
            }

            if (colHeader && fullRawData?.rows) {
              variableData = { values: fullRawData.rows.map((row: any) => row[colHeader]) };
            }
          } else {
            // Base table - use the variable name
            variableData = getVariableDataByExpectedHeader(variable.name);
            if ((!variableData || !Array.isArray(variableData.values)) && fullRawData?.rows) {
              const fallbackHeader = getColumnHeaderFromQuestion(variable) || getColumnHeader(variable.name);
              if (fallbackHeader) {
                variableData = { values: fullRawData.rows.map((row: any) => row[fallbackHeader]) };
              }
            }
          }

          if (!variableData || !Array.isArray(variableData.values)) return null;

          const rawCounts: Record<string, number> = {};
          const responseTexts: string[] = [];

          variableData.values.forEach((value: any) => {
            if (value === null || value === undefined || value === '') return;
            const text = String(value).trim();
            if (!text) return;
            if (!rawCounts[text]) {
              responseTexts.push(text);
            }
            rawCounts[text] = (rawCounts[text] || 0) + 1;
          });

          const grouped: Array<{ text: string; count: number; originalTexts: string[] }> = [];
          const processed = new Set<string>();

          responseTexts.forEach(text => {
            if (processed.has(text)) return;
            const similarTexts: string[] = [text];
            let totalCount = rawCounts[text];
            let representativeText = text;
            let maxCount = rawCounts[text];

            responseTexts.forEach(otherText => {
              if (otherText === text || processed.has(otherText)) return;
              if (areOpenEndSimilar(text, otherText)) {
                similarTexts.push(otherText);
                totalCount += rawCounts[otherText];
                if (rawCounts[otherText] > maxCount) {
                  maxCount = rawCounts[otherText];
                  representativeText = otherText;
                }
              }
            });

            similarTexts.forEach(t => processed.add(t));
            grouped.push({
              text: representativeText,
              count: totalCount,
              originalTexts: similarTexts
            });
          });

          const groupedSorted = grouped
            .map(({ text, count, originalTexts }) => ({ text, count, originalTexts }))
            .sort((a, b) => b.count - a.count);

          const frequencyMap: Record<string, number> = {};
          groupedSorted.forEach(item => { frequencyMap[item.text] = item.count; });
          const totalCount = groupedSorted.reduce((sum, item) => sum + item.count, 0);
          const codes = groupedSorted.map(item => ({ code: item.text, text: item.text }));
          const originalTextMap: Record<string, string[]> = {};
          groupedSorted.forEach(item => { originalTextMap[item.text] = item.originalTexts; });

          return { frequencyMap, totalCount, codes, originalTextMap };
        }

        const colHeader = getColumnHeader(variable.name);
        if (!colHeader || !fullRawData.rows) return null;

        const frequencyMap: Record<string, number> = {};
        let totalCount = 0;

        fullRawData.rows.forEach((row: any) => {
          const value = row[colHeader];
          if (value !== null && value !== undefined && value !== '') {
            const strValue = String(value).trim();
            if (strValue) {
              frequencyMap[strValue] = (frequencyMap[strValue] || 0) + 1;
              totalCount++;
            }
          }
        });

        // Get codes from variable or generate from data
        let codes: Array<{ code: string; text: string }> = [];
        if (variable.codes) {
          codes = Object.entries(variable.codes).map(([code, text]) => ({ code, text }));
        } else {
          codes = Object.keys(frequencyMap).map(code => ({ code, text: code }));
        }

        // Check if sorting by frequency is enabled
        const isSortedByFrequency = getEffectiveSortByFrequency(variable);
        if (isSortedByFrequency) {
          codes.sort((a, b) => (frequencyMap[b.code] || 0) - (frequencyMap[a.code] || 0));
          codes = applyHoldOrdering(codes, variable.name, (item) => item.code);
        }

        return { frequencyMap, totalCount, codes };
      };

      // Helper to calculate stats for numeric data
      const calculateStats = (values: number[]) => {
        if (values.length === 0) return null;

        const sum = values.reduce((a, b) => a + b, 0);
        const mean = sum / values.length;
        const sorted = [...values].sort((a, b) => a - b);
        const median = sorted.length % 2 === 0
          ? (sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2
          : sorted[Math.floor(sorted.length / 2)];

        const modeMap: Record<number, number> = {};
        values.forEach(v => {
          modeMap[v] = (modeMap[v] || 0) + 1;
        });
        const maxFreq = Math.max(...Object.values(modeMap));
        const mode = Number(Object.keys(modeMap).find(k => modeMap[Number(k)] === maxFreq));

        const variance = values.reduce((acc, val) => acc + Math.pow(val - mean, 2), 0) / values.length;
        const stdDev = Math.sqrt(variance);
        const max = Math.max(...values);
        const min = Math.min(...values);

        return { sum, mean, median, mode, stdDev, max, min };
      };

      // Build banner columns structure with group information
      const bannerGroup = selectedBannerGroup;
      const bannerCols: Array<{ id: string; title: string; groupTitle: string; groupIdx: number; colHeader?: string; codes: string[]; matchesRow: (row:any)=>boolean }> = [];
      const groupStructure: Array<{ title: string; cutCount: number; startIdx: number }> = [];
      if (bannerGroup.groups) {
        let cutIdx = 0;
        bannerGroup.groups.forEach((g, gIdx) => {
          const groupStartIdx = cutIdx;
          const groupCutCount = g.cuts.length;
          groupStructure.push({
            title: g.title,
            cutCount: groupCutCount,
            startIdx: groupStartIdx
          });
          g.cuts.forEach(cut => {
            bannerCols.push({
              id: cut.id,
              title: cut.title,
              groupTitle: g.title,
              groupIdx: gIdx,
              colHeader: getColumnHeader(cut.variableName),
              codes: cut.codes || [],
              matchesRow: makeCutPredicate(cut as any)
            });
            cutIdx++;
          });
        });
      }
      // Only log for B8 to reduce console noise (reuse isB8Variable declared above)
      if (isB8Variable && shouldDebugStats()) {
        try {
          appendStatLog('banner cuts', {
            count: bannerCols.length,
            letters: bannerCols.map((c, i) => `${String.fromCharCode(65 + i)}:${c.title}`),
            ids: bannerCols.map(c => c.id),
            groups: groupStructure.map(g => ({ title: g.title, cuts: g.cutCount }))
          });
        } catch {}
      }

      const includeToc = options?.includeToc !== false;
      // Create Table of Contents worksheet
      const tocWorksheet = includeToc ? workbook.addWorksheet('Table of Contents') : null;

      // Create Data Cuts worksheet
      const dataCutsWorksheet = workbook.addWorksheet(sheetName);
      let currentRow = 1;

      // Track table positions for TOC
      const tablePositions: Array<{ tableNumber: number; tableName: string; rowNumber: number; variable: Variable }> = [];

      for (const variable of variablesToExport) {
        const isS6Variable = variable.name === 'S6';
        if (isS6Variable && ((globalThis as any).__TABEXPORT_DEBUG_STATS === true || showStatDebug)) {
          // eslint-disable-next-line no-console
          console.warn('[STAT DEBUG S6] variable begin', { variable: variable.name, type: variable.type });
          appendStatLog('[S6] variable begin', { variable: variable.name, type: variable.type });
        }
        await yieldPerVariable();
        let tables = getTablesForVariable(variable);

        // Sort tables for numeric grids: summary tables first, then individual statement tables
        const isNumericGridVariable = variable.type?.toLowerCase().includes('numeric grid');
        if (isNumericGridVariable) {
          tables = [...tables].sort((a, b) => {
            const aIsSummary = a.endsWith('_MeanSummaryTable') || a.endsWith('_SumSummaryTable') ||
                               a.endsWith('_MeanNoOutliersSummaryTable') || a.endsWith('_SumNoOutliersSummaryTable');
            const bIsSummary = b.endsWith('_MeanSummaryTable') || b.endsWith('_SumSummaryTable') ||
                               b.endsWith('_MeanNoOutliersSummaryTable') || b.endsWith('_SumNoOutliersSummaryTable');

            // Summary tables come first
            if (aIsSummary && !bIsSummary) return -1;
            if (!aIsSummary && bIsSummary) return 1;

            // Maintain original order within each group
            return 0;
          });
        }

        // Debug: Log tables for preview mode (when only one variable is being exported)
        const isPreviewMode = variablesSubset.length === 1 && variablesSubset[0] === variable;
        const isMultiSelectQuestion = variable.type?.toLowerCase().includes('multi-select') && !variable.type?.toLowerCase().includes('grid');
        const isB8Debug = variable.name === 'B8';
        if (isB8Debug) {
          appendStatLog('[B8] Variable info', { variable: variable.name, type: variable.type, isMultiSelect: isMultiSelectQuestion, tables, selections: variableTableSelections[variable.name] ? Array.from(variableTableSelections[variable.name]) : 'none' });
        }
        
        if (isS6Variable && ((globalThis as any).__TABEXPORT_DEBUG_STATS === true || showStatDebug)) {
          // eslint-disable-next-line no-console
          console.warn('[STAT DEBUG S6] tables selected', { variable: variable.name, tables });
          appendStatLog('[S6] tables selected', { variable: variable.name, tables });
        }

                          for (const tableName of tables) {
          // Debug: Log when processing each table for B8
          if (isB8Debug) {
            appendStatLog('[B8] Processing table', { tableName, variable: variable.name, type: variable.type });
          }
          const isS6Debug = variable.name === 'S6' && ((globalThis as any).__TABEXPORT_DEBUG_STATS === true || showStatDebug);
          if (isS6Debug) {
            // eslint-disable-next-line no-console
            console.warn('[STAT DEBUG S6] building table', { variable: variable.name, tableName });
            appendStatLog('[S6] building table', { variable: variable.name, tableName });
          }
          await yieldPerTable();
          // Check if this is a NetSummaryTable for single select grid
          const isSingleSelectGrid = variable.type?.toLowerCase().includes('single select grid');

          // TEMPORARY: Skip ALL single select grid tables completely
          if (isSingleSelectGrid) {
            console.log('🔴 SKIPPING ALL SSG - Fresh start:', tableName);
            tableNumber++;
            continue;
          }

          const isNetSummaryTable = isSingleSelectGrid && tableName.includes('_NetSummaryTable');
          const isVerbatimSummary = tableName.endsWith('_VerbatimSummary');
          
          // Add spacing between tables (except for first table)
          if (tableNumber > 1) {
            currentRow += 1;
          }

          const tableStartRow = currentRow;

          // Check if this is a mean or sum summary table for numeric grids (must be declared before use)
          const isNumericGrid = variable.type?.toLowerCase().includes('numeric grid');
          const isMeanSummaryTable = isNumericGrid && tableName.endsWith('_MeanSummaryTable') && !tableName.endsWith('_MeanNoOutliersSummaryTable');
          const isSumSummaryTable = isNumericGrid && tableName.endsWith('_SumSummaryTable') && !tableName.endsWith('_SumNoOutliersSummaryTable');
          const isMeanNoOutliersSummaryTable = isNumericGrid && tableName.endsWith('_MeanNoOutliersSummaryTable');
          const isSumNoOutliersSummaryTable = isNumericGrid && tableName.endsWith('_SumNoOutliersSummaryTable');
          const isNumericGridSummaryTable = isMeanSummaryTable || isSumSummaryTable || isMeanNoOutliersSummaryTable || isSumNoOutliersSummaryTable;

          if (isNumericGridSummaryTable) {
            // console.log('🟡 Processing NUMERIC GRID SUMMARY TABLE:', tableName, 'isMean:', isMeanSummaryTable, 'isSum:', isSumSummaryTable);
          }

          // Handle Verbatim Summary table for coded open ends
          if (isVerbatimSummary) {
            // Gather coded columns and theme labels first to check if data exists
            const baseLower = variable.name.replace(/^Q/, '').toLowerCase();
            const codeColumns = (fullRawData.columns || []).filter(col => {
              const cl = String(col).toLowerCase();
              return (cl.startsWith(baseLower + 'r') || cl.startsWith('q' + baseLower + 'r')) && /r\d+$/.test(cl);
            });
            const savedThemes = savedCodingThemes.get(variable.name) || [];
            const themeMap = new Map<number, string>(savedThemes.map(t => [t.code, t.theme]));
            const parseCodeNum = (col: string) => {
              const m = col.match(/r(\d+)$/i);
              return m ? parseInt(m[1], 10) : NaN;
            };
            const sortedCodeCols = [...codeColumns].sort((a,b) => (parseCodeNum(a) || 0) - (parseCodeNum(b) || 0));
            // Helper for coded value truthiness
            const isCodedValue = (val: any): boolean => {
              if (val === null || val === undefined) return false;
              if (typeof val === 'number') return val >= 1;
              if (typeof val === 'boolean') return val === true;
              const s = String(val).trim().toLowerCase();
              return s === '1' || s === '1.0' || s === 'true' || s === 'yes' || s === 'y';
            };
            // Compute total responding (any code) overall and per cut
            let totalRespondingOverall = 0;
            const totalRespondingByCut: Record<string, number> = {};
            bannerCols.forEach(col => { totalRespondingByCut[col.id] = 0; });
            fullRawData.rows.forEach(r => {
              const hasAny = sortedCodeCols.some(c => isCodedValue(r[c]));
              if (!hasAny) return;
              totalRespondingOverall++;
              bannerCols.forEach(col => {
                if (col.matchesRow(r)) {
                  totalRespondingByCut[col.id]++;
                }
              });
            });

            // Skip table if there are no data rows (no coded columns)
            if (sortedCodeCols.length === 0) {
              tableNumber++;
              continue;
            }

            // Record position for TOC
            tablePositions.push({ tableNumber, tableName, rowNumber: currentRow, variable });
            // Title
            const baseQuestionNumber = getBaseQuestionNumber(variable.name);
            const tableTitle = `Table ${tableNumber}: ${baseQuestionNumber}: Verbatim Summary`;
            const titleRow = dataCutsWorksheet.getRow(currentRow++);
            titleRow.getCell(2).value = tableTitle;
            titleRow.getCell(2).font = { bold: true, size: 12 };
            // Question text
            const questionRow = dataCutsWorksheet.getRow(currentRow++);
            questionRow.getCell(2).value = variable.description || variable.name;
            questionRow.getCell(2).font = { size: 11 };

            // Build 3-row header (Total + banner groups)
            const headerStartRow = currentRow;
            const groupTitleRow = headerStartRow;
            const cutTitleRow = headerStartRow + 1;
            const statLetterRow = headerStartRow + 2;
            let currentCol = 2;
            // Row label cell
            const rowLabelCell = dataCutsWorksheet.getRow(groupTitleRow).getCell(currentCol);
            rowLabelCell.value = '';
            rowLabelCell.border = { top:{style:'thin'}, bottom:{style:'thin'}, left:{style:'thin'}, right:{style:'thin'} };
            dataCutsWorksheet.mergeCells(groupTitleRow, currentCol, statLetterRow, currentCol);
            [cutTitleRow, statLetterRow].forEach(r => {
              const cell = dataCutsWorksheet.getRow(r).getCell(currentCol);
              cell.border = { top:{style:'thin'}, bottom:{style:'thin'}, left:{style:'thin'}, right:{style:'thin'} };
            });
            currentCol++;
            // Total column
            const totalGroupCell = dataCutsWorksheet.getRow(groupTitleRow).getCell(currentCol);
            totalGroupCell.value = 'Total';
            totalGroupCell.alignment = { horizontal: 'center', vertical: 'middle' };
            totalGroupCell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
            totalGroupCell.fill = { type:'pattern', pattern:'solid', fgColor:{ argb:'FFD14A2D' } };
            totalGroupCell.border = { top:{style:'thin'}, bottom:{style:'thin'}, left:{style:'thin'}, right:{style:'thin'} };
            dataCutsWorksheet.mergeCells(groupTitleRow, currentCol, cutTitleRow, currentCol);
            const totalCutCell = dataCutsWorksheet.getRow(cutTitleRow).getCell(currentCol);
            totalCutCell.fill = { type:'pattern', pattern:'solid', fgColor:{ argb:'FFD14A2D' } };
            totalCutCell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
            totalCutCell.border = { top:{style:'thin'}, bottom:{style:'thin'}, left:{style:'thin'}, right:{style:'thin'} };
            const totalStatCell = dataCutsWorksheet.getRow(statLetterRow).getCell(currentCol);
            totalStatCell.value = '';
            totalStatCell.alignment = { horizontal:'center', vertical:'middle' };
            totalStatCell.fill = { type:'pattern', pattern:'solid', fgColor:{ argb:'FFD14A2D' } };
            totalStatCell.border = { top:{style:'thin'}, bottom:{style:'thin'}, left:{style:'thin'}, right:{style:'thin'} };
            currentCol++;
            // Banner groups
            groupStructure.forEach((group) => {
              const groupStartCol = currentCol;
              const groupCell = dataCutsWorksheet.getRow(groupTitleRow).getCell(groupStartCol);
              groupCell.value = group.title;
              groupCell.alignment = { horizontal:'center', vertical:'middle' };
              groupCell.font = { bold:true, color:{ argb:'FFFFFFFF' } };
              groupCell.fill = { type:'pattern', pattern:'solid', fgColor:{ argb:'FFD14A2D' } };
              groupCell.border = { top:{style:'thin'}, bottom:{style:'thin'}, left:{style:'thin'}, right:{style:'thin'} };
              if (group.cutCount > 1) {
                dataCutsWorksheet.mergeCells(groupTitleRow, groupStartCol, groupTitleRow, groupStartCol + group.cutCount - 1);
              }
              for (let i=0;i<group.cutCount;i++) {
                const cutCol = groupStartCol + i;
                const bannerCol = bannerCols[group.startIdx + i];
                const cutCell = dataCutsWorksheet.getRow(cutTitleRow).getCell(cutCol);
                cutCell.value = bannerCol.title;
                cutCell.alignment = { horizontal:'center', vertical:'middle' };
                cutCell.font = { bold:true, color:{ argb:'FFFFFFFF' } };
                cutCell.fill = { type:'pattern', pattern:'solid', fgColor:{ argb:'FFD14A2D' } };
                cutCell.border = { top:{style:'thin'}, bottom:{style:'thin'}, left:{style:'thin'}, right:{style:'thin'} };
                const statCell = dataCutsWorksheet.getRow(statLetterRow).getCell(cutCol);
                const statLetter = String.fromCharCode(65 + group.startIdx + i);
                statCell.value = `(${statLetter})`;
                statCell.alignment = { horizontal:'center', vertical:'middle' };
                statCell.font = { bold:true, color:{ argb:'FFFFFFFF' } };
                statCell.fill = { type:'pattern', pattern:'solid', fgColor:{ argb:'FFD14A2D' } };
                statCell.border = { top:{style:'thin'}, bottom:{style:'thin'}, left:{style:'thin'}, right:{style:'thin'} };
              }
              currentCol += group.cutCount;
            });
            currentRow += 3;
            // Base row (total responding) - styled same as other questions
            {
              const baseRow = dataCutsWorksheet.getRow(currentRow++);
              // Label cell (column B)
              const labelCell = baseRow.getCell(2);
              labelCell.value = 'Base (total answering):';
              labelCell.alignment = { horizontal: 'left', vertical: 'middle' };
              labelCell.font = { italic: true, size: 9 };
              labelCell.border = { top:{style:'thin'}, bottom:{style:'thin'}, left:{style:'thin'}, right:{style:'thin'} };
              labelCell.fill = { type:'pattern', pattern:'solid', fgColor:{ argb:'FFF2F2F2' } };
              // Total column (column C)
              let bc = 3;
              const totalCell = baseRow.getCell(bc++);
              totalCell.value = totalRespondingOverall;
              totalCell.alignment = { horizontal: 'center', vertical: 'middle' };
              totalCell.font = { italic: true, size: 9 };
              totalCell.border = { top:{style:'thin'}, bottom:{style:'thin'}, left:{style:'thin'}, right:{style:'thin'} };
              totalCell.fill = { type:'pattern', pattern:'solid', fgColor:{ argb:'FFF2F2F2' } };
              // One cell per banner cut
              bannerCols.forEach(col => {
                const cell = baseRow.getCell(bc++);
                cell.value = totalRespondingByCut[col.id] || 0;
                cell.alignment = { horizontal: 'center', vertical: 'middle' };
                cell.font = { italic: true, size: 9 };
                cell.border = { top:{style:'thin'}, bottom:{style:'thin'}, left:{style:'thin'}, right:{style:'thin'} };
                cell.fill = { type:'pattern', pattern:'solid', fgColor:{ argb:'FFF2F2F2' } };
              });
            }
            // For each code: count row + percentage row
            sortedCodeCols.forEach(colName => {
              const codeNum = parseCodeNum(colName);
              if (isNaN(codeNum)) return;
              const rowLabel = themeMap.get(codeNum) || `Code ${codeNum}`;
              // Count row
              const countRow = dataCutsWorksheet.getRow(currentRow++);
              let c = 2;
              const labelCell = countRow.getCell(c++);
              labelCell.value = rowLabel;
              labelCell.border = { top:{style:'thin'}, bottom:{style:'thin'}, left:{style:'thin'}, right:{style:'thin'} };
              let totalCount = 0;
              fullRawData.rows.forEach(r => { if (isCodedValue(r[colName])) totalCount++; });
              const totalCell = countRow.getCell(c++);
              // If total base is 0, show "-" instead of count
              totalCell.value = totalRespondingOverall === 0 ? '-' : totalCount;
              totalCell.alignment = { horizontal:'center' };
              totalCell.border = { top:{style:'thin'}, bottom:{style:'thin'}, left:{style:'thin'}, right:{style:'thin'} };
              const cutCounts: Record<string, number> = {};
              groupStructure.forEach(group => {
                for (let i=0;i<group.cutCount;i++) {
                  const banner = bannerCols[group.startIdx + i];
                  let cutCount = 0;
              fullRawData.rows.forEach(r => {
                if (!isCodedValue(r[colName])) return;
                if (banner.matchesRow(r)) {
                  cutCount++;
                }
              });
                  cutCounts[banner.id] = cutCount;
                  const cutBase = totalRespondingByCut[banner.id] || 0;
                  const cutCell = countRow.getCell(c++);
                  // If base size is 0, show "-" instead of count
                  cutCell.value = cutBase === 0 ? '-' : cutCount;
                  cutCell.alignment = { horizontal:'center' };
                  cutCell.border = { top:{style:'thin'}, bottom:{style:'thin'}, left:{style:'thin'}, right:{style:'thin'} };
                }
              });
              // Percentage row
              const pctRow = dataCutsWorksheet.getRow(currentRow++);
              let pc = 2;
              const pctLabelCell = pctRow.getCell(pc++);
              pctLabelCell.value = '';
              pctLabelCell.border = { top:{style:'thin'}, bottom:{style:'thin'}, left:{style:'thin'}, right:{style:'thin'} };
              const totalPctCell = pctRow.getCell(pc++);
              const totalPct = totalRespondingOverall > 0 ? totalCount / totalRespondingOverall : 0;
              // If total base is 0, show "-" instead of percentage
              if (totalRespondingOverall === 0) {
                totalPctCell.value = '-';
              } else {
                totalPctCell.value = totalPct;
                totalPctCell.numFmt = percentageDecimals === 0 ? '0%' : percentageDecimals === 1 ? '0.0%' : '0.00%';
              }
              totalPctCell.alignment = { horizontal:'center' };
              totalPctCell.border = { top:{style:'thin'}, bottom:{style:'thin'}, left:{style:'thin'}, right:{style:'thin'} };
              bannerCols.forEach(col => {
                const cutBase = totalRespondingByCut[col.id] || 0;
                const cutPct = cutBase > 0 ? (cutCounts[col.id] || 0) / cutBase : 0;
                const cell = pctRow.getCell(pc++);
                // If base size is 0, show "-" instead of percentage
                if (cutBase === 0) {
                  cell.value = '-';
                } else {
                  cell.value = cutPct;
                  cell.numFmt = percentageDecimals === 0 ? '0%' : percentageDecimals === 1 ? '0.0%' : '0.00%';
                }
                cell.alignment = { horizontal:'center' };
                cell.border = { top:{style:'thin'}, bottom:{style:'thin'}, left:{style:'thin'}, right:{style:'thin'} };
              });

              // Stat letters row for verbatim summary (compare cut percentages within each group)
              // Build per-cut percents (0-100)
              const cutPercents: Record<string, number> = {};
              bannerCols.forEach(col => {
                const base = totalRespondingByCut[col.id] || 0;
                cutPercents[col.id] = base > 0 ? ((cutCounts[col.id] || 0) / base) * 100 : 0;
              });
              const statLettersByColIdx: Record<number, string> = {};
              bannerCols.forEach((thisCol, thisIdx) => {
                const letters: string[] = [];
                bannerCols.forEach((otherCol, otherIdx) => {
                  if (otherIdx === thisIdx) return;
                  if (otherCol.groupIdx !== thisCol.groupIdx) return;
                  const n1 = totalRespondingByCut[thisCol.id] || 0;
                  const n2 = totalRespondingByCut[otherCol.id] || 0;
                  const p1 = cutPercents[thisCol.id] || 0;
                  const p2 = cutPercents[otherCol.id] || 0;
                  if (p1 <= p2) return;
                  if (!n1 || !n2) return;
                  const prop1 = p1 / 100;
                  const prop2 = p2 / 100;
                  const pooled = (prop1 * n1 + prop2 * n2) / (n1 + n2);
                  const se = Math.sqrt(pooled * (1 - pooled) * (1 / n1 + 1 / n2));
                  if (se === 0) return;
                  const z = Math.abs(prop1 - prop2) / se;
                  const is95 = z > 1.96;
                  const is90 = z > 1.645 && z <= 1.96;
                  if (significanceLevel === 95) {
                    if (is95) letters.push(String.fromCharCode(65 + otherIdx));
                  } else {
                    if (is95) {
                      letters.push(String.fromCharCode(65 + otherIdx));
                    } else if (is90) {
                      letters.push(String.fromCharCode(97 + otherIdx));
                    }
                  }
                });
                if (letters.length > 0) {
                  statLettersByColIdx[thisIdx] = letters.join('');
                }
              });
              if (Object.keys(statLettersByColIdx).length > 0) {
                const statRow = dataCutsWorksheet.getRow(currentRow++);
                let sc = 2;
                const label = statRow.getCell(sc++);
                label.value = '';
                label.border = { top:{style:'thin'}, bottom:{style:'thin'}, left:{style:'thin'}, right:{style:'thin'} };
                const totalStat = statRow.getCell(sc++);
                totalStat.value = '';
                totalStat.border = { top:{style:'thin'}, bottom:{style:'thin'}, left:{style:'thin'}, right:{style:'thin'} };
                bannerCols.forEach((_, colIdx) => {
                  const cell = statRow.getCell(sc++);
                  const letters = statLettersByColIdx[colIdx] || '';
                  cell.value = letters;
                  cell.alignment = { horizontal:'center', vertical:'middle' };
                  // Blue, bold stat letters
                  cell.font = { color: { argb: 'FF0000FF' }, bold: true };
                  // Light blue background on stat letter cell
                  cell.fill = { type:'pattern', pattern:'solid', fgColor:{ argb:'FFDBEAFE' } };
                  cell.border = { top:{style:'thin'}, bottom:{style:'thin'}, left:{style:'thin'}, right:{style:'thin'} };
                  // Also highlight corresponding Count and % cells for this response row
                  if (letters) {
                    // Count row is currentRow - 2, pct row is currentRow - 1
                    const countCell = dataCutsWorksheet.getRow(currentRow - 2).getCell(2 + colIdx + 1); // +1 to offset total column
                    const pctCell = dataCutsWorksheet.getRow(currentRow - 1).getCell(2 + colIdx + 1);
                    [countCell, pctCell].forEach(target => {
                      target.fill = { type:'pattern', pattern:'solid', fgColor:{ argb:'FFDBEAFE' } };
                    });
                  }
                });
              }
            });

            tableNumber++;
            continue;
          }

          // Handle NetSummaryTable for single select grids
          if (isNetSummaryTable) {
            // Extract net index from table name (e.g., "QB3_NetSummaryTable_0" -> 0)
            const netIndexMatch = tableName.match(/_NetSummaryTable_(\d+)$/);
            const netIndex = netIndexMatch ? parseInt(netIndexMatch[1], 10) : -1;
            const baseName = variable.name;
            const netCodeSelections = netSummaryTableSelectedCodes[baseName] || [];
            const net = netIndex >= 0 && netIndex < netCodeSelections.length ? netCodeSelections[netIndex] : null;
            
            if (!net || !net.codes || net.codes.length === 0) {
              tableNumber++;
              continue;
            }

          // Record position for TOC
          tablePositions.push({
            tableNumber,
            tableName,
            rowNumber: currentRow,
            variable
          });

            // Table title
            const baseQuestionNumber = getBaseQuestionNumber(variable.name);
            const tableTitle = `Table ${tableNumber}: ${baseQuestionNumber}: ${net.name}`;
            const titleRow = dataCutsWorksheet.getRow(currentRow++);
            titleRow.getCell(2).value = tableTitle;
            titleRow.getCell(2).font = { bold: true, size: 12 };
            
            // Question text
            const questionRow = dataCutsWorksheet.getRow(currentRow++);
            questionRow.getCell(2).value = variable.description || variable.name;
            questionRow.getCell(2).font = { size: 11 };
            
            // Calculate banner table data for this variable
            const bannerTableData = calculateBannerTableDataForVariable(variable, variable.name, bannerGroup);
            
            // Extract bases from banner table data
            let totalBase = 0;
            const cutBases: Record<string, number> = {};
            bannerCols.forEach(col => { cutBases[col.id] = 0; });
            
            // Get bases from the first statement entry
            const statementEntries = variable.statements ? Object.entries(variable.statements) : [];
            if (statementEntries.length > 0) {
              const firstStmtCode = statementEntries[0][0];
              const firstStmtData = (bannerTableData as any)?.[firstStmtCode];
              if (firstStmtData && firstStmtData.total && typeof firstStmtData.total.base === 'number') {
                totalBase = firstStmtData.total.base;
              }
              bannerCols.forEach(col => {
                const baseValue = firstStmtData?.[col.id]?.base;
                if (typeof baseValue === 'number') {
                  cutBases[col.id] = baseValue;
                }
              });
            }
            
            // Build 3-row header structure (same as other summary tables)
            const headerStartRow = currentRow;
            const groupTitleRow = headerStartRow;
            const cutTitleRow = headerStartRow + 1;
            const statLetterRow = headerStartRow + 2;
            let currentCol = 2; // Start at column B
            
            // Row label cell (merged across all 3 rows)
            const rowLabelCell = dataCutsWorksheet.getRow(groupTitleRow).getCell(currentCol);
            rowLabelCell.value = '';
            rowLabelCell.border = {
              top: { style: 'thin' },
              bottom: { style: 'thin' },
              left: { style: 'thin' },
              right: { style: 'thin' }
            };
            dataCutsWorksheet.mergeCells(groupTitleRow, currentCol, statLetterRow, currentCol);
            [cutTitleRow, statLetterRow].forEach(row => {
              const cell = dataCutsWorksheet.getRow(row).getCell(currentCol);
              cell.border = {
                top: { style: 'thin' },
                bottom: { style: 'thin' },
                left: { style: 'thin' },
                right: { style: 'thin' }
              };
            });
            currentCol++;
            
            // Total column
            const totalGroupCell = dataCutsWorksheet.getRow(groupTitleRow).getCell(currentCol);
            totalGroupCell.value = 'Total';
            totalGroupCell.alignment = { horizontal: 'center', vertical: 'middle' };
            totalGroupCell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
            totalGroupCell.fill = {
              type: 'pattern',
              pattern: 'solid',
              fgColor: { argb: 'FFD14A2D' }
            };
            totalGroupCell.border = {
              top: { style: 'thin' },
              bottom: { style: 'thin' },
              left: { style: 'thin' },
              right: { style: 'thin' }
            };
            dataCutsWorksheet.mergeCells(groupTitleRow, currentCol, cutTitleRow, currentCol);
            const totalCutCell = dataCutsWorksheet.getRow(cutTitleRow).getCell(currentCol);
            totalCutCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFD14A2D' } };
            totalCutCell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
            totalCutCell.border = {
              top: { style: 'thin' },
              bottom: { style: 'thin' },
              left: { style: 'thin' },
              right: { style: 'thin' }
            };
            const totalStatCell = dataCutsWorksheet.getRow(statLetterRow).getCell(currentCol);
            totalStatCell.value = '';
            totalStatCell.alignment = { horizontal: 'center', vertical: 'middle' };
            totalStatCell.fill = {
              type: 'pattern',
              pattern: 'solid',
              fgColor: { argb: 'FFD14A2D' }
            };
            totalStatCell.border = {
              top: { style: 'thin' },
              bottom: { style: 'thin' },
              left: { style: 'thin' },
              right: { style: 'thin' }
            };
            currentCol++;
            
            // Banner group titles and cut columns
            groupStructure.forEach((group, groupIdx) => {
              const groupStartCol = currentCol;
              
              // Group title
              const groupCell = dataCutsWorksheet.getRow(groupTitleRow).getCell(groupStartCol);
              groupCell.value = group.title;
              groupCell.alignment = { horizontal: 'center', vertical: 'middle' };
              groupCell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
              groupCell.fill = {
                type: 'pattern',
                pattern: 'solid',
                fgColor: { argb: 'FFD14A2D' }
              };
              groupCell.border = {
                top: { style: 'thin' },
                bottom: { style: 'thin' },
                left: { style: 'thin' },
                right: { style: 'thin' }
              };
              if (group.cutCount > 1) {
                dataCutsWorksheet.mergeCells(groupTitleRow, groupStartCol, groupTitleRow, groupStartCol + group.cutCount - 1);
              }
              
              // Individual cut titles and stat letters
              for (let i = 0; i < group.cutCount; i++) {
                const cutCol = groupStartCol + i;
                const bannerCol = bannerCols[group.startIdx + i];
                
                // Cut title
                const cutCell = dataCutsWorksheet.getRow(cutTitleRow).getCell(cutCol);
                cutCell.value = bannerCol.title;
                cutCell.alignment = { horizontal: 'center', vertical: 'middle' };
                cutCell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
                cutCell.fill = {
                  type: 'pattern',
                  pattern: 'solid',
                  fgColor: { argb: 'FFD14A2D' }
                };
                cutCell.border = {
                  top: { style: 'thin' },
                  bottom: { style: 'thin' },
                  left: { style: 'thin' },
                  right: { style: 'thin' }
                };
                
                // Stat letter
                const statCell = dataCutsWorksheet.getRow(statLetterRow).getCell(cutCol);
                const statLetter = String.fromCharCode(65 + group.startIdx + i);
                statCell.value = `(${statLetter})`;
                statCell.alignment = { horizontal: 'center', vertical: 'middle' };
                statCell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
                statCell.fill = {
                  type: 'pattern',
                  pattern: 'solid',
                  fgColor: { argb: 'FFD14A2D' }
                };
                statCell.border = {
                  top: { style: 'thin' },
                  bottom: { style: 'thin' },
                  left: { style: 'thin' },
                  right: { style: 'thin' }
                };
              }
              
              currentCol += group.cutCount;
            });
            
            currentRow += 3; // Move past 3 header rows
            
            // First pass: Calculate all statement bases to check if they're all the same
            interface StatementData {
              stmtCode: string;
              stmtLabel: string;
              stmtColHeader: string | null;
              stmtTotalBase: number;
              stmtCutBases: Record<string, number>;
              netTotalCount: number;
              netCutCounts: Record<string, number>;
            }
            
            const statementDataList: StatementData[] = [];
            
            statementEntries.forEach(([stmtCode, stmtLabel]) => {
              // Build column header for this statement
              const baseNumber = variable.name.replace(/^Q/, '');
              const stmtHeader = `Q${baseNumber}${stmtCode}`;
              let stmtColHeader: string | null = null;
              const variations = [stmtHeader, stmtHeader.replace(/^Q/, ''), baseNumber + stmtCode];
              for (const v of variations) {
                if (columnMapping[v]) { stmtColHeader = columnMapping[v]; break; }
                const match = Object.keys(columnMapping).find(k => k.toLowerCase() === v.toLowerCase());
                if (match) { stmtColHeader = columnMapping[match]; break; }
              }
              if (!stmtColHeader && fullRawData.columns) {
                for (const v of variations) {
                  const found = fullRawData.columns.find((c: string) => c.toLowerCase() === v.toLowerCase());
                  if (found) { stmtColHeader = found; break; }
                }
              }
              
              if (!stmtColHeader) return; // Skip if we can't find the column
              
              // Calculate statement-specific base (total responding for this statement)
              let stmtTotalBase = 0;
              const stmtCutBases: Record<string, number> = {};
              bannerCols.forEach(col => { stmtCutBases[col.id] = 0; });
              
              // Calculate net totals by counting rows that match any of the net codes
              let netTotalCount = 0;
              const netCutCounts: Record<string, number> = {};
              bannerCols.forEach(col => { netCutCounts[col.id] = 0; });
              
              // Process all rows
              fullRawData.rows.forEach((row: any) => {
                const val = row[stmtColHeader!];
                if (val === null || val === undefined || val === '') return;
                
                // Count this row in the statement base (any response counts)
                stmtTotalBase++;
                
                // Check which banner cuts this row matches for base calculation
                const matchedCuts: string[] = [];
                bannerCols.forEach(col => {
                  if (!col.colHeader) return;
                  const bannerVal = row[col.colHeader];
                  if (bannerVal === null || bannerVal === undefined || bannerVal === '') return;
                  const bannerValStr = String(bannerVal).trim();
                  const numBannerVal = Number(bannerValStr);
                  for (const cutCode of col.codes) {
                    let matches = false;
                    if (bannerValStr === cutCode) matches = true;
                    else if (!isNaN(numBannerVal) && String(numBannerVal) === cutCode) matches = true;
                    else {
                      const codeNoC = cutCode.replace(/^c/i, '');
                      if (bannerValStr === codeNoC || (!isNaN(numBannerVal) && !isNaN(Number(codeNoC)) && numBannerVal === Number(codeNoC))) {
                        matches = true;
                      }
                    }
                    if (matches) {
                      matchedCuts.push(col.id);
                      stmtCutBases[col.id]++;
                      break;
                    }
                  }
                });
                
                const valStr = String(val).trim();
                
                // Check if this value matches any of the net codes
                let matchesNet = false;
                net.codes.forEach(netCode => {
                  const normalizedNetCode = netCode.replace(/^c/i, '');
                  // Check various formats
                  if (valStr === netCode || 
                      valStr === normalizedNetCode || 
                      String(Number(valStr)) === normalizedNetCode ||
                      (!isNaN(Number(valStr)) && !isNaN(Number(normalizedNetCode)) && Number(valStr) === Number(normalizedNetCode))) {
                    matchesNet = true;
                  }
                });
                
                if (matchesNet) {
                  // Count this row in the net total
                  netTotalCount++;
                  // Add to net cut counts
                  matchedCuts.forEach(cutId => {
                    netCutCounts[cutId]++;
                  });
                }
              });
              
              statementDataList.push({
                stmtCode,
                stmtLabel,
                stmtColHeader,
                stmtTotalBase,
                stmtCutBases,
                netTotalCount,
                netCutCounts
              });
            });
            
            // Check if sorting by frequency/percentage is enabled
            const isSortedByFrequency = getEffectiveSortByFrequency(variable);
            
            // Sort statements by total percentage (descending) if sorting is enabled
            if (isSortedByFrequency) {
              statementDataList.sort((a, b) => {
                const aPct = a.stmtTotalBase > 0 ? (a.netTotalCount / a.stmtTotalBase) * 100 : 0;
                const bPct = b.stmtTotalBase > 0 ? (b.netTotalCount / b.stmtTotalBase) * 100 : 0;
                return bPct - aPct; // Descending order
              });
            }
            
            // Check if all total bases are the same
            const allBasesSame = statementDataList.length > 0 &&
              statementDataList.every(data => data.stmtTotalBase === statementDataList[0].stmtTotalBase);

            // Calculate stat letters for all statements before rendering
            const allStatLettersNetSummary: Record<string, Record<number, { letter: string; is95: boolean }[]>> = {};

            statementDataList.forEach((data) => {
              const { stmtCode, stmtCutBases, netCutCounts } = data;
              const codeStatLetters: Record<number, { letter: string; is95: boolean }[]> = {};

              bannerCols.forEach((thisCol, colIdx) => {
                const thisBase = stmtCutBases[thisCol.id] || 0;
                const thisCount = netCutCounts[thisCol.id] || 0;
                const thisPct = thisBase > 0 ? (thisCount / thisBase) * 100 : 0;
                const statLettersForCol: { letter: string; is95: boolean }[] = [];

                // Within-group comparisons ONLY
                bannerCols.forEach((otherCol, otherIdx) => {
                  if (otherIdx === colIdx) return;
                  if (otherCol.groupIdx !== thisCol.groupIdx) return;

                  const otherBase = stmtCutBases[otherCol.id] || 0;
                  const otherCount = netCutCounts[otherCol.id] || 0;
                  const otherPct = otherBase > 0 ? (otherCount / otherBase) * 100 : 0;

                  if (thisPct > otherPct) {
                    const { is95, is90 } = isSignificant(thisPct, thisBase, otherPct, otherBase);

                    if (significanceLevel === 95) {
                      if (is95) statLettersForCol.push({ letter: String.fromCharCode(65 + otherIdx), is95: true });
                    } else {
                      if (is95) {
                        statLettersForCol.push({ letter: String.fromCharCode(65 + otherIdx), is95: true });
                      } else if (is90) {
                        statLettersForCol.push({ letter: String.fromCharCode(97 + otherIdx), is95: false });
                      }
                    }
                  }
                });

                codeStatLetters[colIdx] = statLettersForCol;
              });

              allStatLettersNetSummary[stmtCode] = codeStatLetters;
            });

            // Second pass: Render statements
            statementDataList.forEach((data, idx) => {
              const { stmtCode, stmtLabel, stmtTotalBase, stmtCutBases, netTotalCount, netCutCounts } = data;
              
              // Add Base (total responding) row for this statement
              // Only show if bases differ, or if this is the first statement when bases are the same
              const shouldShowBase = !allBasesSame || idx === 0;
              
              if (shouldShowBase) {
                const STATS_GREY = 'FFE8E8E8';
                const stmtBaseRow = dataCutsWorksheet.getRow(currentRow++);
                stmtBaseRow.getCell(2).value = 'Base (total responding):';
                stmtBaseRow.getCell(2).font = { italic: true, size: 9 };
                stmtBaseRow.getCell(2).fill = {
                  type: 'pattern',
                  pattern: 'solid',
                  fgColor: { argb: STATS_GREY }
                };
                stmtBaseRow.getCell(2).border = {
                  top: { style: 'thin' },
                  bottom: { style: 'thin' },
                  left: { style: 'thin' },
                  right: { style: 'thin' }
                };
                stmtBaseRow.getCell(3).value = stmtTotalBase;
                stmtBaseRow.getCell(3).alignment = { horizontal: 'center' };
                stmtBaseRow.getCell(3).font = { italic: true, size: 9 };
                stmtBaseRow.getCell(3).fill = {
                  type: 'pattern',
                  pattern: 'solid',
                  fgColor: { argb: STATS_GREY }
                };
                stmtBaseRow.getCell(3).border = {
                  top: { style: 'thin' },
                  bottom: { style: 'thin' },
                  left: { style: 'thin' },
                  right: { style: 'thin' }
                };
                let baseCol = 4;
                bannerCols.forEach(bannerCol => {
                  stmtBaseRow.getCell(baseCol).value = stmtCutBases[bannerCol.id] || 0;
                  stmtBaseRow.getCell(baseCol).alignment = { horizontal: 'center' };
                  stmtBaseRow.getCell(baseCol).font = { italic: true, size: 9 };
                  stmtBaseRow.getCell(baseCol).fill = {
                    type: 'pattern',
                    pattern: 'solid',
                    fgColor: { argb: STATS_GREY }
                  };
                  stmtBaseRow.getCell(baseCol).border = {
                    top: { style: 'thin' },
                    bottom: { style: 'thin' },
                    left: { style: 'thin' },
                    right: { style: 'thin' }
                  };
                  baseCol++;
                });
              }
              
              // Count row
              const countRow = dataCutsWorksheet.getRow(currentRow++);
              countRow.getCell(2).value = String(stmtLabel);
              countRow.getCell(2).border = {
                top: { style: 'thin' },
                bottom: { style: 'thin' },
                left: { style: 'thin' },
                right: { style: 'thin' }
              };
              // If total base is 0, show "-" instead of count
              countRow.getCell(3).value = stmtTotalBase === 0 ? '-' : netTotalCount;
              countRow.getCell(3).alignment = { horizontal: 'center' };
              countRow.getCell(3).border = {
                top: { style: 'thin' },
                bottom: { style: 'thin' },
                left: { style: 'thin' },
                right: { style: 'thin' }
              };
              let col = 4;
              bannerCols.forEach((bannerCol, colIdx) => {
                const cutBase = stmtCutBases[bannerCol.id] || 0;
                const countCell = countRow.getCell(col);
                // If base size is 0, show "-" instead of count
                countCell.value = cutBase === 0 ? '-' : (netCutCounts[bannerCol.id] || 0);
                countCell.alignment = { horizontal: 'center' };

                // Add blue highlighting if this cell has stat letters
                const statLettersForCode = allStatLettersNetSummary[stmtCode] || {};
                const statLetters = statLettersForCode[colIdx] || [];
                if (statLetters.length > 0) {
                  countCell.fill = {
                    type: 'pattern',
                    pattern: 'solid',
                    fgColor: { argb: 'FFE6F3FF' }
                  };
                }

                countCell.border = {
                  top: { style: 'thin' },
                  bottom: { style: 'thin' },
                  left: { style: 'thin' },
                  right: { style: 'thin' }
                };
                col++;
              });
              
              // Percentage row (use statement-specific base)
              const pctRow = dataCutsWorksheet.getRow(currentRow++);
              pctRow.getCell(2).value = '';
              pctRow.getCell(2).border = {
                top: { style: 'thin' },
                bottom: { style: 'thin' },
                left: { style: 'thin' },
                right: { style: 'thin' }
              };
              const totalPct = stmtTotalBase > 0 ? (netTotalCount / stmtTotalBase) * 100 : 0;
              const totalPctCell = pctRow.getCell(3);
              // If total base is 0, show "-" instead of percentage
              if (stmtTotalBase === 0) {
                totalPctCell.value = '-';
              } else {
                totalPctCell.value = totalPct / 100; // Store as decimal for percentage format
                totalPctCell.numFmt = percentageDecimals === 0 ? '0%' : percentageDecimals === 1 ? '0.0%' : '0.00%';
              }
              totalPctCell.alignment = { horizontal: 'center' };
              totalPctCell.border = {
                top: { style: 'thin' },
                bottom: { style: 'thin' },
                left: { style: 'thin' },
                right: { style: 'thin' }
              };
              col = 4;
              bannerCols.forEach((bannerCol, colIdx) => {
                const cutBase = stmtCutBases[bannerCol.id] || 0;
                const cutPct = cutBase > 0 ? (netCutCounts[bannerCol.id] / cutBase) * 100 : 0;
                const cutPctCell = pctRow.getCell(col);
                // If base size is 0, show "-" instead of percentage
                if (cutBase === 0) {
                  cutPctCell.value = '-';
                } else {
                  cutPctCell.value = cutPct / 100; // Store as decimal for percentage format
                  cutPctCell.numFmt = percentageDecimals === 0 ? '0%' : percentageDecimals === 1 ? '0.0%' : '0.00%';
                }
                cutPctCell.alignment = { horizontal: 'center' };

                // Add blue highlighting if this cell has stat letters
                const statLettersForCode = allStatLettersNetSummary[stmtCode] || {};
                const statLetters = statLettersForCode[colIdx] || [];
                if (statLetters.length > 0) {
                  cutPctCell.fill = {
                    type: 'pattern',
                    pattern: 'solid',
                    fgColor: { argb: 'FFE6F3FF' }
                  };
                }

                cutPctCell.border = {
                  top: { style: 'thin' },
                  bottom: { style: 'thin' },
                  left: { style: 'thin' },
                  right: { style: 'thin' }
                };
                col++;
              });

              // Stat letters row
              const statLettersForCode = allStatLettersNetSummary[stmtCode] || {};
              const hasAnyStatLettersForCode = Object.values(statLettersForCode).some(arr => arr && arr.length > 0);

              if (hasAnyStatLettersForCode) {
                const statRow = dataCutsWorksheet.getRow(currentRow++);
                statRow.getCell(2).value = '';
                statRow.getCell(2).border = {
                  top: { style: 'thin' },
                  bottom: { style: 'thin' },
                  left: { style: 'thin' },
                  right: { style: 'thin' }
                };

                statRow.getCell(3).value = '';
                statRow.getCell(3).border = {
                  top: { style: 'thin' },
                  bottom: { style: 'thin' },
                  left: { style: 'thin' },
                  right: { style: 'thin' }
                };

                col = 4;
                bannerCols.forEach((bannerCol, colIdx) => {
                  const statLetters = statLettersForCode[colIdx] || [];
                  const statLettersStr = statLetters.map(s => s.letter).join('');
                  const statCell = statRow.getCell(col);
                  statCell.value = statLettersStr;
                  statCell.alignment = { horizontal: 'center', vertical: 'middle' };
                  if (statLetters.length > 0) {
                    statCell.fill = {
                      type: 'pattern',
                      pattern: 'solid',
                      fgColor: { argb: 'FFE6F3FF' }
                    };
                  }
                  statCell.border = {
                    top: { style: 'thin' },
                    bottom: { style: 'thin' },
                    left: { style: 'thin' },
                    right: { style: 'thin' }
                  };
                  col++;
                });
              }
            });

            if (bannerCols.length > 0) {
              // Add comparison groups details section
              // Build comparison groups string based on banner groups
              const groupMapNetSummary = new Map<number, number[]>();
              bannerCols.forEach((col, idx) => {
                const groupIdx = col.groupIdx;
                if (!groupMapNetSummary.has(groupIdx)) {
                  groupMapNetSummary.set(groupIdx, []);
                }
                groupMapNetSummary.get(groupIdx)!.push(idx);
              });

              const comparisonGroupsNetSummary = Array.from(groupMapNetSummary.values())
                .map(colIndices =>
                  colIndices.map(idx => String.fromCharCode(65 + idx)).join('')
                )
                .join('/');

              // Comparison groups row
              const compGroupsRowNetSummary = dataCutsWorksheet.getRow(currentRow++);
              compGroupsRowNetSummary.getCell(2).value = `Comparison Groups: ${comparisonGroupsNetSummary}`;
              compGroupsRowNetSummary.getCell(2).font = { size: 9, italic: true };

              // Uppercase explanation row
              const upperRowNetSummary = dataCutsWorksheet.getRow(currentRow++);
              upperRowNetSummary.getCell(2).value = 'Uppercase letters indicate significance at the 95% level.';
              upperRowNetSummary.getCell(2).font = { size: 9, italic: true };

              // Lowercase explanation row (only if significance level is 90)
              if (significanceLevel === 90) {
                const lowerRowNetSummary = dataCutsWorksheet.getRow(currentRow++);
                lowerRowNetSummary.getCell(2).value = 'Lowercase letters indicate significance at the 90% level.';
                lowerRowNetSummary.getCell(2).font = { size: 9, italic: true };
              }
            }

            tableNumber++;
            continue;
          }

          // Single select grid summary tables removed - only individual tables are exported
          const isMeanSummaryTableForSSG = false;
          const isSumSummaryTableForSSG = false;

          // Calculate banner table data for this variable
          const bannerTableData = calculateBannerTableDataForVariable(variable, variable.name, bannerGroup);

          // Check if this is a regular numeric question (not a grid)
          const isNumericQuestion = variable.type?.toLowerCase().includes('numeric') &&
                                    !variable.type?.toLowerCase().includes('grid') &&
                                    !variable.type?.toLowerCase().includes('list');

          const isMultiSelectGridVariable = variable.type?.toLowerCase().includes('multi-select grid');
          const extractGridColumnCode = (): string | null => {
            if (!isMultiSelectGridVariable) return null;
            const prefix = `${variable.name}_`;
            if (!tableName.startsWith(prefix)) return null;
            const remainder = tableName.slice(prefix.length);
            const summarySuffix = remainder.endsWith('_SummaryTable')
              ? remainder.replace(/_SummaryTable$/i, '')
              : remainder;
            const parenIndex = remainder.indexOf(' (');
            const rawCode = parenIndex >= 0 ? remainder.slice(0, parenIndex) : summarySuffix;
            return rawCode.trim() || null;
          };
          const activeGridColumnCode = extractGridColumnCode();
          const resolvedGridColumnCode = (() => {
            if (!activeGridColumnCode || !bannerTableData) return null;
            if ((bannerTableData as any)[activeGridColumnCode]) return activeGridColumnCode;
            const lower = activeGridColumnCode.toLowerCase();
            const match = Object.keys(bannerTableData).find(k => k.toLowerCase() === lower);
            if (match) return match;
            const normalize = (value: string) => value.replace(/^c/i, '').trim().toLowerCase();
            const normalizedTarget = normalize(activeGridColumnCode);
            if (normalizedTarget) {
              const normalizedMatch = Object.keys(bannerTableData).find(k => normalize(k) === normalizedTarget);
              if (normalizedMatch) return normalizedMatch;
            }
            const keys = Object.keys(bannerTableData);
            if (keys.length === 1) return keys[0];
            return null;
          })();
          const activeGridColumnData = resolvedGridColumnCode ? (bannerTableData as any)[resolvedGridColumnCode] : null;
          const isMultiSelectGridColumnTable = !!activeGridColumnData && typeof activeGridColumnData === 'object';
          
          // Declare sampleStatements at this scope so it can be used in tableDebugInfo
          let sampleStatements: Array<{
            key: string;
            label: string;
            totalCount: number;
            totalPercentage: number;
            totalBase: number;
            cutCounts: Array<{ title: string; count: number; percentage: number }>;
          }> | undefined = undefined;
          
          if (isMultiSelectGridColumnTable) {
            sampleStatements = Object.entries(activeGridColumnData || {})
              .filter(([stmtKey, stmtData]) => stmtKey !== 'total' && stmtData && typeof stmtData === 'object')
              .slice(0, 5)
              .map(([stmtKey, stmtData]) => {
                const normalizedKey = stmtKey.replace(/^r/i, '');
                const label =
                  variable.statements?.[stmtKey] ||
                  (normalizedKey ? variable.statements?.[normalizedKey] : undefined) ||
                  stmtKey;
                const totalData = (stmtData as any)['total'] || { count: 0, percentage: 0, base: 0 };
                const cutCounts = bannerCols.map(col => ({
                  title: col.title,
                  count: (stmtData as any)?.[col.id]?.count || 0,
                  percentage: (stmtData as any)?.[col.id]?.percentage || 0,
                }));
                return {
                  key: stmtKey,
                  label,
                  totalCount: totalData.count || 0,
                  totalPercentage: totalData.percentage || 0,
                  totalBase: totalData.base || 0,
                  cutCounts,
                };
              });
          }

          // Record position for TOC (for regular tables)
          // Also define tableTitle here for use in tableDebugInfo
          let tableTitle = '';

          // Check if this is an individual numeric grid table
          const numericGridStatementMatch = isNumericGrid && !isNumericGridSummaryTable
            ? tableName.match(/(r\d+)/i)
            : null;
          const isIndividualNumericGridTableForTitle = !!numericGridStatementMatch;

          // Check if this is an individual open end table (e.g., S12_r1)
          const isOpenEndType = variable.type?.toLowerCase().includes('open end') &&
                                !variable.type?.toLowerCase().includes('list');
          const openEndStatementMatch = isOpenEndType ? tableName.match(/_(r\d+)$/i) : null;
          const isIndividualOpenEndTable = !!openEndStatementMatch;

          // EARLY CHECK: Skip empty open end tables BEFORE creating title/headers
          if (isOpenEndType) {
            const freqData = calculateFrequencyData(variable, tableName);
            // console.log('🔍 EARLY Open End Check:', tableName, 'hasData:', !!freqData, 'codes:', freqData?.codes.length || 0, 'total:', freqData?.totalCount || 0);
            if (!freqData || freqData.codes.length === 0 || freqData.totalCount === 0) {
              console.log('🟠 EARLY SKIP - Empty open end table:', tableName);
              tableNumber++;
              continue;
            }
          }

          if (!isNumericGridSummaryTable && !isNetSummaryTable && !isMeanSummaryTableForSSG && !isSumSummaryTableForSSG && !isVerbatimSummary && !isNumericQuestion) {
            tablePositions.push({ tableNumber, tableName, rowNumber: currentRow, variable });

            // Write table title for regular tables
            const baseQuestionNumber = getBaseQuestionNumber(variable.name);

            // For individual numeric grid tables, include statement code and name
            if (isIndividualNumericGridTableForTitle && variable.statements) {
              const stmtCode = numericGridStatementMatch[1];
              const stmtText = variable.statements[stmtCode] || variable.statements[stmtCode.replace(/^r/i, '')];
              tableTitle = `Table ${tableNumber}: ${baseQuestionNumber}_${stmtCode} (${stmtText || stmtCode})`;
            }
            // For individual open end tables, include statement code and name
            else if (isIndividualOpenEndTable && variable.statements) {
              const stmtCode = openEndStatementMatch[1];
              const stmtText = variable.statements[stmtCode] || variable.statements[stmtCode.replace(/^r/i, '')];
              tableTitle = `Table ${tableNumber}: ${baseQuestionNumber}_${stmtCode} (${stmtText || stmtCode})`;
            }
            // For multi-select grid column tables, format as "QuestionNumber_ColumnCode (ColumnLabel)"
            // Must match getTablesForVariable format: `${baseName}_${colCode} (${colLabel})`
            else if (isMultiSelectGridColumnTable && (resolvedGridColumnCode || activeGridColumnCode) && variable.codes) {
              const columnCodeForLabel = resolvedGridColumnCode || activeGridColumnCode || '';
              const normalizedColumnCode = columnCodeForLabel.replace(/^c/i, '').trim().toLowerCase();
              const fallbackCode = Object.keys(variable.codes).find(
                code => code.replace(/^c/i, '').trim().toLowerCase() === normalizedColumnCode
              );
              const columnLabel = variable.codes[columnCodeForLabel]
                || (fallbackCode ? variable.codes[fallbackCode] : undefined)
                || columnCodeForLabel;
              tableTitle = `Table ${tableNumber}: ${baseQuestionNumber}_${columnCodeForLabel} (${columnLabel})`;
            } else {
              tableTitle = `Table ${tableNumber}: ${baseQuestionNumber}`;
            }
            
            const titleRow = dataCutsWorksheet.getRow(currentRow++);
            titleRow.getCell(2).value = tableTitle;
            titleRow.getCell(2).font = { bold: true, size: 12 };
            
            // Question text
            const questionRow = dataCutsWorksheet.getRow(currentRow++);
            questionRow.getCell(2).value = variable.description || variable.name;
            questionRow.getCell(2).font = { size: 11 };
          } else if (isNumericGridSummaryTable) {
            // For summary tables, tableTitle was already set above
            const baseQuestionNumber = getBaseQuestionNumber(variable.name);
            if (isMeanSummaryTable) {
              tableTitle = `Table ${tableNumber}: ${baseQuestionNumber}: Mean Summary Table`;
            } else if (isSumSummaryTable) {
              tableTitle = `Table ${tableNumber}: ${baseQuestionNumber}: Sum Summary Table`;
            } else if (isMeanNoOutliersSummaryTable) {
              tableTitle = `Table ${tableNumber}: ${baseQuestionNumber}: Mean (Outliers Removed) Summary Table`;
            } else if (isSumNoOutliersSummaryTable) {
              tableTitle = `Table ${tableNumber}: ${baseQuestionNumber}: Sum (Outliers Removed) Summary Table`;
            }
          } else {
            // For other table types, use a generic title
            // Note: Numeric questions will skip generic rendering and use their dedicated handler
            const baseQuestionNumber = getBaseQuestionNumber(variable.name);
            tableTitle = `Table ${tableNumber}: ${baseQuestionNumber}`;
          }

          // Record debug info for this table
          if (isMultiSelectGridColumnTable && sampleStatements) {
            tableDebugInfo[tableTitle] = {
              tableTitle,
              variableName: variable.name,
              variableType: variable.type,
              isMultiSelectGridColumn: true,
              columnCode: resolvedGridColumnCode || activeGridColumnCode || null,
              sampleStatements,
            };
          } else if (tableTitle && !tableDebugInfo[tableTitle]) {
            tableDebugInfo[tableTitle] = {
              tableTitle,
              variableName: variable.name,
              variableType: variable.type,
              isMultiSelectGridColumn: false,
            };
          }

          const numericGridSummaryType: NumericGridSummaryType | null = isMeanSummaryTable
            ? 'mean'
            : isSumSummaryTable
              ? 'sum'
              : isMeanNoOutliersSummaryTable
                ? 'meanNoOutliers'
                : isSumNoOutliersSummaryTable
                  ? 'sumNoOutliers'
                  : null;

          if (isNumericGridSummaryTable && numericGridSummaryType && bannerCols.length === 0 && variable.statements) {
            const statements = Object.entries(variable.statements).map(([code, text]) => ({
              code,
              text: String(text),
            }));
            if (statements.length === 0) {
              tableNumber++;
              continue;
            }
            const responseOptions = getNumericGridResponseOptions(variable);
            const sortByFrequency = getEffectiveSortByFrequency(variable);

            const model = buildNumericGridSummaryModel({
              variable,
              variableName: variable.name,
              optionId: tableName,
              summaryType: numericGridSummaryType,
              statements,
              responseOptions,
              getVariableDataByExpectedHeader,
              respondentFilter: null,
              sortByFrequency,
              holdCodes: [],
            });

            const orderedRows = applyHoldOrdering(model.rows, variable.name, (row: any) => row.code);
            const columnsToUse = model.columnsToUse;
            const columnLabels = model.columnLabels;
            const totalValuesByColumn = model.totalValuesByColumn;
            const allBasesEqual = model.allBasesEqual;
            const isMeanSummaryLayout = model.isMeanSummaryTable;

            // Skip empty tables (no data rows)
            if (orderedRows.length === 0) {
              console.log('🟠 SKIPPING EMPTY TABLE - No data rows for:', tableName);
              tableNumber++;
              continue;
            }

            // Record position for TOC
            tablePositions.push({
              tableNumber,
              tableName,
              rowNumber: currentRow,
              variable
            });

            // Table title - format appropriately for summary tables
            const baseQuestionNumber = getBaseQuestionNumber(variable.name);
            let displayTableName = tableName;
            if (isMeanSummaryTable) {
              displayTableName = `${baseQuestionNumber}: Mean Summary Table`;
            } else if (isSumSummaryTable) {
              displayTableName = `${baseQuestionNumber}: Sum Summary Table`;
            } else if (isMeanNoOutliersSummaryTable) {
              displayTableName = `${baseQuestionNumber}: Mean (Outliers Removed) Summary Table`;
            } else if (isSumNoOutliersSummaryTable) {
              displayTableName = `${baseQuestionNumber}: Sum (Outliers Removed) Summary Table`;
            }
            const tableTitle = `Table ${tableNumber}: ${displayTableName}`;
            const titleRow = dataCutsWorksheet.getRow(currentRow++);
            titleRow.getCell(2).value = tableTitle;
            titleRow.getCell(2).font = { bold: true, size: 12 };

            // Question text
            const questionRow = dataCutsWorksheet.getRow(currentRow++);
            questionRow.getCell(2).value = variable.description || variable.name;
            questionRow.getCell(2).font = { size: 11 };

            // Build 3-row header structure (matching standard table format)
            const headerStartRow = currentRow;
            const headerRow1 = headerStartRow;
            const headerRow2 = headerStartRow + 1;
            const headerRow3 = headerStartRow + 2;

            // Row label cell (white, merged across all 3 rows)
            const rowLabelCell = dataCutsWorksheet.getRow(headerRow1).getCell(2);
            rowLabelCell.value = '';
            rowLabelCell.border = {
              top: { style: 'thin' },
              bottom: { style: 'thin' },
              left: { style: 'thin' },
              right: { style: 'thin' }
            };
            dataCutsWorksheet.mergeCells(headerRow1, 2, headerRow3, 2);
            // Apply borders to all rows of merged cell
            [headerRow2, headerRow3].forEach(row => {
              const cell = dataCutsWorksheet.getRow(row).getCell(2);
              cell.border = {
                top: { style: 'thin' },
                bottom: { style: 'thin' },
                left: { style: 'thin' },
                right: { style: 'thin' }
              };
            });

            // Total column (orange, merged across first 2 rows)
            const totalCell = dataCutsWorksheet.getRow(headerRow1).getCell(3);
            totalCell.value = 'Total';
            totalCell.alignment = { horizontal: 'center', vertical: 'middle' };
            totalCell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
            totalCell.fill = {
              type: 'pattern',
              pattern: 'solid',
              fgColor: { argb: 'FFD14A2D' }
            };
            totalCell.border = {
              top: { style: 'thin' },
              bottom: { style: 'thin' },
              left: { style: 'thin' },
              right: { style: 'thin' }
            };
            dataCutsWorksheet.mergeCells(headerRow1, 3, headerRow2, 3);
            // Apply same formatting to row 2
            const totalCell2 = dataCutsWorksheet.getRow(headerRow2).getCell(3);
            totalCell2.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFD14A2D' } };
            totalCell2.font = { bold: true, color: { argb: 'FFFFFFFF' } };
            totalCell2.border = {
              top: { style: 'thin' },
              bottom: { style: 'thin' },
              left: { style: 'thin' },
              right: { style: 'thin' }
            };

            // Empty stat letter cell for Total column (row 3)
            const totalCell3 = dataCutsWorksheet.getRow(headerRow3).getCell(3);
            totalCell3.value = '';
            totalCell3.alignment = { horizontal: 'center', vertical: 'middle' };
            totalCell3.fill = {
              type: 'pattern',
              pattern: 'solid',
              fgColor: { argb: 'FFD14A2D' }
            };
            totalCell3.border = {
              top: { style: 'thin' },
              bottom: { style: 'thin' },
              left: { style: 'thin' },
              right: { style: 'thin' }
            };

            // Response columns (c1, c2, c3, etc.) - orange, merged across all 3 rows
            // Skip the first column (index 0) which is the "#" column
            let headerCol = 4;
            columnsToUse.forEach((colCode, idx) => {
              // Skip the first column (the "#" column)
              if (idx === 0) return;

              const label = columnLabels[colCode] || colCode;

              // Row 1
              const colCell1 = dataCutsWorksheet.getRow(headerRow1).getCell(headerCol);
              colCell1.value = label;
              colCell1.alignment = { horizontal: 'center', vertical: 'middle' };
              colCell1.font = { bold: true, color: { argb: 'FFFFFFFF' } };
              colCell1.fill = {
                type: 'pattern',
                pattern: 'solid',
                fgColor: { argb: 'FFD14A2D' }
              };
              colCell1.border = {
                top: { style: 'thin' },
                bottom: { style: 'thin' },
                left: { style: 'thin' },
                right: { style: 'thin' }
              };

              dataCutsWorksheet.mergeCells(headerRow1, headerCol, headerRow3, headerCol);

              // Apply formatting to rows 2 and 3
              [headerRow2, headerRow3].forEach(row => {
                const cell = dataCutsWorksheet.getRow(row).getCell(headerCol);
                cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFD14A2D' } };
                cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
                cell.border = {
                  top: { style: 'thin' },
                  bottom: { style: 'thin' },
                  left: { style: 'thin' },
                  right: { style: 'thin' }
                };
              });

              headerCol++;
            });

            currentRow += 3;

            const STATS_GREY = 'FFE8E8E8';
            orderedRows.forEach((stmt, idx) => {
              // console.log('🟣 Total-only path - Processing statement:', stmt.text, 'base:', stmt.base);
              const showBaseRow = !allBasesEqual || idx === 0;
              if (showBaseRow) {
                const baseRow = dataCutsWorksheet.getRow(currentRow++);
                const baseLabelCell = baseRow.getCell(2);
                baseLabelCell.value = 'Base (total responding):';
                baseLabelCell.font = { italic: true, size: 9 };
                baseLabelCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: STATS_GREY } };
                baseLabelCell.border = {
                  top: { style: 'thin' },
                  bottom: { style: 'thin' },
                  left: { style: 'thin' },
                  right: { style: 'thin' }
                };

                // Total base (column 3)
                const totalBaseCell = baseRow.getCell(3);
                totalBaseCell.value = stmt.base;
                totalBaseCell.alignment = { horizontal: 'center' };
                totalBaseCell.font = { italic: true, size: 9 };
                totalBaseCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: STATS_GREY } };
                totalBaseCell.border = {
                  top: { style: 'thin' },
                  bottom: { style: 'thin' },
                  left: { style: 'thin' },
                  right: { style: 'thin' }
                };

                // Response column bases (columns 4+)
                let baseCol = 4;
                columnsToUse.forEach((colCode, colIdx) => {
                  // Skip the first column (the "#" column)
                  if (colIdx === 0) return;

                  const valueCell = baseRow.getCell(baseCol++);
                  valueCell.value = stmt.base;
                  valueCell.alignment = { horizontal: 'center' };
                  valueCell.font = { italic: true, size: 9 };
                  valueCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: STATS_GREY } };
                  valueCell.border = {
                    top: { style: 'thin' },
                    bottom: { style: 'thin' },
                    left: { style: 'thin' },
                    right: { style: 'thin' }
                  };
                });
              }

              // Count/mean row for this statement
              const stmtRow = dataCutsWorksheet.getRow(currentRow++);
              const stmtLabelCell = stmtRow.getCell(2);
              stmtLabelCell.value = stmt.text;
              stmtLabelCell.border = {
                top: { style: 'thin' },
                bottom: { style: 'thin' },
                left: { style: 'thin' },
                right: { style: 'thin' }
              };

              // Total count/mean (column 3)
              const totalValueForStmt = columnsToUse.reduce((sum, colCode) => sum + (stmt.columnValues[colCode] || 0), 0);
              const totalCell = stmtRow.getCell(3);
              // If base is 0, show "-" instead of value
              if (stmt.base === 0) {
                // console.log('🔴 ZERO BASE - Total column - Setting to dash for:', stmt.text);
                totalCell.value = '-';
              } else {
                totalCell.value = totalValueForStmt;
                totalCell.numFmt = isMeanSummaryLayout ? '0.00' : '0';
              }
              totalCell.alignment = { horizontal: 'center' };
              totalCell.border = {
                top: { style: 'thin' },
                bottom: { style: 'thin' },
                left: { style: 'thin' },
                right: { style: 'thin' }
              };

              // Response column counts/means (columns 4+)
              let stmtCol = 4;
              columnsToUse.forEach((colCode, colIdx) => {
                // Skip the first column (the "#" column)
                if (colIdx === 0) return;

                const value = stmt.columnValues[colCode] || 0;
                const valueCell = stmtRow.getCell(stmtCol++);
                // If base is 0, show "-" instead of value
                if (stmt.base === 0) {
                  console.log('🔴 ZERO BASE - Response column', colCode, '- Setting to dash');
                  valueCell.value = '-';
                } else {
                  valueCell.value = value;
                  valueCell.numFmt = isMeanSummaryLayout ? '0.00' : '0';
                }
                valueCell.alignment = { horizontal: 'center' };
                valueCell.border = {
                  top: { style: 'thin' },
                  bottom: { style: 'thin' },
                  left: { style: 'thin' },
                  right: { style: 'thin' }
                };
              });

              // Percentage row for this statement (only for sum tables)
              if (!isMeanSummaryLayout) {
                const pctRow = dataCutsWorksheet.getRow(currentRow++);
                const pctLabelCell = pctRow.getCell(2);
                pctLabelCell.value = '';
                pctLabelCell.border = {
                  top: { style: 'thin' },
                  bottom: { style: 'thin' },
                  left: { style: 'thin' },
                  right: { style: 'thin' }
                };

                // Total percentage (column 3)
                const totalStmtSum = columnsToUse.reduce((sum, colCode) => sum + (stmt.columnValues[colCode] || 0), 0);
                const totalAllSum = columnsToUse.reduce((sum, colCode) => sum + (totalValuesByColumn[colCode] || 0), 0);
                const totalPct = totalAllSum > 0 ? totalStmtSum / totalAllSum : 0;
                const totalPctCell = pctRow.getCell(3);
                // If base is 0, show "-" instead of percentage
                if (stmt.base === 0) {
                  console.log('🔴 ZERO BASE - Total % - Setting to dash');
                  totalPctCell.value = '-';
                } else {
                  totalPctCell.value = totalPct;
                  totalPctCell.numFmt = percentageDecimals === 0 ? '0%' : percentageDecimals === 1 ? '0.0%' : '0.00%';
                }
                totalPctCell.alignment = { horizontal: 'center' };
                totalPctCell.border = {
                  top: { style: 'thin' },
                  bottom: { style: 'thin' },
                  left: { style: 'thin' },
                  right: { style: 'thin' }
                };

                // Response column percentages (columns 4+)
                let pctCol = 4;
                columnsToUse.forEach((colCode, colIdx) => {
                  // Skip the first column (the "#" column)
                  if (colIdx === 0) return;

                  const value = stmt.columnValues[colCode] || 0;
                  const totalColValue = totalValuesByColumn[colCode] || 0;
                  const pct = totalColValue > 0 ? value / totalColValue : 0;
                  const pctCell = pctRow.getCell(pctCol++);
                  // If base is 0, show "-" instead of percentage
                  if (stmt.base === 0) {
                    console.log('🔴 ZERO BASE - Response column % - Setting to dash');
                    pctCell.value = '-';
                  } else {
                    pctCell.value = pct;
                    pctCell.numFmt = percentageDecimals === 0 ? '0%' : percentageDecimals === 1 ? '0.0%' : '0.00%';
                  }
                  pctCell.alignment = { horizontal: 'center' };
                  pctCell.border = {
                    top: { style: 'thin' },
                    bottom: { style: 'thin' },
                    left: { style: 'thin' },
                    right: { style: 'thin' }
                  };
                });
              }
            });

            if (!isMeanSummaryLayout) {
              // Total count row
              const totalRow = dataCutsWorksheet.getRow(currentRow++);
              const totalLabelCell = totalRow.getCell(2);
              totalLabelCell.value = 'Total';
              totalLabelCell.font = { size: 11 };
              totalLabelCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: STATS_GREY } };
              totalLabelCell.border = {
                top: { style: 'thin' },
                bottom: { style: 'thin' },
                left: { style: 'thin' },
                right: { style: 'thin' }
              };

              // Total sum (column 3)
              const grandTotal = columnsToUse.reduce((sum, colCode) => sum + (totalValuesByColumn[colCode] || 0), 0);
              const grandTotalCell = totalRow.getCell(3);
              // If total is 0, show "-" instead of 0
              if (grandTotal === 0) {
                console.log('🔴 ZERO TOTAL - Grand total is 0, setting to dash');
                grandTotalCell.value = '-';
              } else {
                grandTotalCell.value = grandTotal;
                grandTotalCell.numFmt = '0';
              }
              grandTotalCell.alignment = { horizontal: 'center' };
              grandTotalCell.font = { size: 11 };
              grandTotalCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: STATS_GREY } };
              grandTotalCell.border = {
                top: { style: 'thin' },
                bottom: { style: 'thin' },
                left: { style: 'thin' },
                right: { style: 'thin' }
              };

              // Response column totals (columns 4+)
              let totalCol = 4;
              columnsToUse.forEach((colCode, colIdx) => {
                // Skip the first column (the "#" column)
                if (colIdx === 0) return;

                const totalValue = totalValuesByColumn[colCode] || 0;
                const valueCell = totalRow.getCell(totalCol++);
                // If total is 0, show "-" instead of 0
                if (totalValue === 0) {
                  console.log('🔴 ZERO TOTAL - Column total is 0, setting to dash');
                  valueCell.value = '-';
                } else {
                  valueCell.value = totalValue;
                  valueCell.numFmt = '0';
                }
                valueCell.alignment = { horizontal: 'center' };
                valueCell.font = { size: 11 };
                valueCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: STATS_GREY } };
                valueCell.border = {
                  top: { style: 'thin' },
                  bottom: { style: 'thin' },
                  left: { style: 'thin' },
                  right: { style: 'thin' }
                };
              });

              // Total percentage row
              const totalPctRow = dataCutsWorksheet.getRow(currentRow++);
              const totalPctLabelCell = totalPctRow.getCell(2);
              totalPctLabelCell.value = '';
              totalPctLabelCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: STATS_GREY } };
              totalPctLabelCell.border = {
                top: { style: 'thin' },
                bottom: { style: 'thin' },
                left: { style: 'thin' },
                right: { style: 'thin' }
              };

              // Total percentage for Total column (column 3) - 100% or "-" if total is 0
              const totalPctCellTotal = totalPctRow.getCell(3);
              if (grandTotal === 0) {
                console.log('🔴 ZERO TOTAL - Total % is 0, setting to dash');
                totalPctCellTotal.value = '-';
              } else {
                totalPctCellTotal.value = 1;
                totalPctCellTotal.numFmt = '0%';
              }
              totalPctCellTotal.alignment = { horizontal: 'center' };
              totalPctCellTotal.font = { size: 11 };
              totalPctCellTotal.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: STATS_GREY } };
              totalPctCellTotal.border = {
                top: { style: 'thin' },
                bottom: { style: 'thin' },
                left: { style: 'thin' },
                right: { style: 'thin' }
              };

              // Response column percentages (columns 4+) - all 100% or "-" if total is 0
              let totalPctCol = 4;
              columnsToUse.forEach((colCode, colIdx) => {
                // Skip the first column (the "#" column)
                if (colIdx === 0) return;

                const totalValue = totalValuesByColumn[colCode] || 0;
                const pctCell = totalPctRow.getCell(totalPctCol++);
                if (totalValue === 0) {
                  console.log('🔴 ZERO TOTAL - Column % is 0, setting to dash');
                  pctCell.value = '-';
                } else {
                  pctCell.value = 1;
                  pctCell.numFmt = '0%';
                }
                pctCell.alignment = { horizontal: 'center' };
                pctCell.font = { size: 11 };
                pctCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: STATS_GREY } };
                pctCell.border = {
                  top: { style: 'thin' },
                  bottom: { style: 'thin' },
                  left: { style: 'thin' },
                  right: { style: 'thin' }
                };
              });
            }

            tableNumber++;
            continue;
          }

          // Extract bases from banner table data
          let totalBase = 0;
          const cutBases: Record<string, number> = {};
          bannerCols.forEach(col => { cutBases[col.id] = 0; });

          // Get bases from the first entry that actually contains base data
          const firstCodeData = isMultiSelectGridColumnTable
            ? findFirstBannerRowWithBase(activeGridColumnData)
            : findFirstBannerRowWithBase(bannerTableData);
          if (firstCodeData) {
            if (firstCodeData.total && typeof firstCodeData.total.base === 'number') {
              totalBase = firstCodeData.total.base;
            }
            bannerCols.forEach(col => {
              const baseValue = firstCodeData[col.id]?.base;
              if (typeof baseValue === 'number') {
                cutBases[col.id] = baseValue;
              }
            });
          }

          // Debug for B8: Check if we have codes to render
          if (isB8Debug) {
            appendStatLog('[B8] Before building headers', {
              totalBase,
              cutBasesCount: Object.keys(cutBases).length,
              firstCodeDataExists: !!firstCodeData,
              bannerTableDataKeys: Object.keys(bannerTableData),
              isMultiSelectGridColumnTable
            });
          }

          // Define helper variables and functions (needed by both generic and numeric question rendering)
          const isMultiSelectQuestionForCodes = variable.type?.toLowerCase().includes('multi-select') && !variable.type?.toLowerCase().includes('grid');
          const multiSelectNoteItems = isMultiSelectQuestionForCodes ? getMultiSelectNoteItems(variable) : [];
          const multiSelectNoteMap = new Map<string, string>(multiSelectNoteItems.map((item) => [item.code, item.text]));

          const resolveGridStatementKey = (code: string) => {
            if (!isMultiSelectGridColumnTable) return code;
            const baseCode = code.replace(/^r/i, '');
            const variations = [code, baseCode && code !== baseCode ? baseCode : null, baseCode ? `r${baseCode}` : null].filter(Boolean) as string[];
            for (const variant of variations) {
              if (activeGridColumnData && Object.prototype.hasOwnProperty.call(activeGridColumnData, variant)) {
                return variant;
              }
            }
            return code;
          };

          const getCodeDataForRow = (code: string) => {
            if (isMultiSelectGridColumnTable) {
              const resolvedKey = resolveGridStatementKey(code);
              return (activeGridColumnData as any)?.[resolvedKey] || {};
            }
            return (bannerTableData as any)?.[code] || {};
          };

          const getRowLabelForCode = (code: string) => {
            if (isMultiSelectGridColumnTable) {
              const resolvedKey = resolveGridStatementKey(code);
              return variable.statements?.[code] || variable.statements?.[resolvedKey] || code;
            }
            if (isMultiSelectQuestionForCodes && multiSelectNoteMap.has(code)) {
              return multiSelectNoteMap.get(code) || code;
            }
            return variable.codes?.[code] || code;
          };

          // Build 3-row header structure (skip for numeric questions - they have dedicated rendering later)
          if (!isNumericQuestion || tableName !== variable.name) {
          // console.log('📊 CREATING HEADERS for table:', tableName, 'at row:', currentRow);
          // Build 3-row header structure for non-numeric-question tables
          // Row 1: Empty | Total | Group Titles (merged across cuts)
          // Row 2: Empty | Total | Cut Titles
          // Row 3: Empty | Empty | Stat Letters (A), (B), (C)...
          const headerStartRow = currentRow;
          const groupTitleRow = headerStartRow;
          const cutTitleRow = headerStartRow + 1;
          const statLetterRow = headerStartRow + 2;
          let currentCol = 2; // Start at column B

          // Row label cell (merged across all 3 rows)
          const rowLabelCell = dataCutsWorksheet.getRow(groupTitleRow).getCell(currentCol);
          rowLabelCell.value = '';
          rowLabelCell.border = {
            top: { style: 'thin' },
            bottom: { style: 'thin' },
            left: { style: 'thin' },
            right: { style: 'thin' }
          };
          dataCutsWorksheet.mergeCells(groupTitleRow, currentCol, statLetterRow, currentCol);
          // Apply borders to all rows of merged cell
          [cutTitleRow, statLetterRow].forEach(row => {
            const cell = dataCutsWorksheet.getRow(row).getCell(currentCol);
            cell.border = {
              top: { style: 'thin' },
              bottom: { style: 'thin' },
              left: { style: 'thin' },
              right: { style: 'thin' }
            };
          });
          currentCol++;

          // Total column (merged across first 2 rows, with empty stat letter row)
          const totalGroupCell = dataCutsWorksheet.getRow(groupTitleRow).getCell(currentCol);
          totalGroupCell.value = 'Total';
          totalGroupCell.alignment = { horizontal: 'center', vertical: 'middle' };
          totalGroupCell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
          totalGroupCell.fill = {
            type: 'pattern',
            pattern: 'solid',
            fgColor: { argb: 'FFD14A2D' }
          };
          totalGroupCell.border = {
            top: { style: 'thin' },
            bottom: { style: 'thin' },
            left: { style: 'thin' },
            right: { style: 'thin' }
          };
          dataCutsWorksheet.mergeCells(groupTitleRow, currentCol, cutTitleRow, currentCol);
          // Apply same formatting to cut title row
          const totalCutCell = dataCutsWorksheet.getRow(cutTitleRow).getCell(currentCol);
          totalCutCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFD14A2D' } };
          totalCutCell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
          totalCutCell.border = {
            top: { style: 'thin' },
            bottom: { style: 'thin' },
            left: { style: 'thin' },
            right: { style: 'thin' }
          };

          // Empty stat letter cell for Total column
          const totalStatCell = dataCutsWorksheet.getRow(statLetterRow).getCell(currentCol);
          totalStatCell.value = '';
          totalStatCell.alignment = { horizontal: 'center', vertical: 'middle' };
          totalStatCell.fill = {
            type: 'pattern',
            pattern: 'solid',
            fgColor: { argb: 'FFD14A2D' }
          };
          totalStatCell.border = {
            top: { style: 'thin' },
            bottom: { style: 'thin' },
            left: { style: 'thin' },
            right: { style: 'thin' }
          };
          currentCol++;

          // Banner group titles and cut columns
          groupStructure.forEach((group, groupIdx) => {
            const groupStartCol = currentCol;

            // Group title (merged across all cuts in this group)
            const groupCell = dataCutsWorksheet.getRow(groupTitleRow).getCell(groupStartCol);
            groupCell.value = group.title;
            groupCell.alignment = { horizontal: 'center', vertical: 'middle' };
            groupCell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
            groupCell.fill = {
              type: 'pattern',
              pattern: 'solid',
              fgColor: { argb: 'FFD14A2D' }
            };
            groupCell.border = {
              top: { style: 'thin' },
              bottom: { style: 'thin' },
              left: { style: 'thin' },
              right: { style: 'thin' }
            };
            if (group.cutCount > 1) {
              dataCutsWorksheet.mergeCells(groupTitleRow, groupStartCol, groupTitleRow, groupStartCol + group.cutCount - 1);
            }

            // Individual cut titles and stat letters for this group
            for (let i = 0; i < group.cutCount; i++) {
              const cutCol = groupStartCol + i;
              const bannerCol = bannerCols[group.startIdx + i];

              // Cut title (row 2)
              const cutCell = dataCutsWorksheet.getRow(cutTitleRow).getCell(cutCol);
              cutCell.value = bannerCol.title;
              cutCell.alignment = { horizontal: 'center', vertical: 'middle' };
              cutCell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
              cutCell.fill = {
                type: 'pattern',
                pattern: 'solid',
                fgColor: { argb: 'FFD14A2D' }
              };
              cutCell.border = {
                top: { style: 'thin' },
                bottom: { style: 'thin' },
                left: { style: 'thin' },
                right: { style: 'thin' }
              };

              // Stat letter (row 3) - starts at (A) for first cut
              const statCell = dataCutsWorksheet.getRow(statLetterRow).getCell(cutCol);
              const statLetter = String.fromCharCode(65 + group.startIdx + i); // A, B, C, etc.
              statCell.value = `(${statLetter})`;
              statCell.alignment = { horizontal: 'center', vertical: 'middle' };
              statCell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
              statCell.fill = {
                type: 'pattern',
                pattern: 'solid',
                fgColor: { argb: 'FFD14A2D' }
              };
              statCell.border = {
                top: { style: 'thin' },
                bottom: { style: 'thin' },
                left: { style: 'thin' },
                right: { style: 'thin' }
              };
            }

            currentCol += group.cutCount;
          });

          currentRow += 3; // Move past 3 header rows

          // Check if this is an individual table (will render base row later)
          const numericGridStatementMatchForBase = isNumericGrid && !isNumericGridSummaryTable
            ? tableName.match(/(r\d+)/i)
            : null;
          const isIndividualNumericGridTableForBase = !!numericGridStatementMatchForBase;
          const isOpenEndForBase = variable.type?.toLowerCase().includes('open end') &&
            !variable.type?.toLowerCase().includes('list');

          // Add Base (total responding) row (skip for individual tables - they render it later)
          if (!isIndividualNumericGridTableForBase && !isOpenEndForBase) {
            const STATS_GREY = 'FFE8E8E8'; // Lighter grey for base and stats rows
            const baseRespondingRow = dataCutsWorksheet.getRow(currentRow++);
            baseRespondingRow.getCell(2).value = 'Base (total responding):';
            baseRespondingRow.getCell(2).font = { italic: true, size: 9 };
            baseRespondingRow.getCell(2).fill = {
              type: 'pattern',
              pattern: 'solid',
              fgColor: { argb: STATS_GREY }
            };
            baseRespondingRow.getCell(2).border = {
              top: { style: 'thin' },
              bottom: { style: 'thin' },
              left: { style: 'thin' },
              right: { style: 'thin' }
            };

            // Total base
            baseRespondingRow.getCell(3).value = totalBase;
            baseRespondingRow.getCell(3).alignment = { horizontal: 'center' };
            baseRespondingRow.getCell(3).font = { italic: true, size: 9 };
            baseRespondingRow.getCell(3).fill = {
              type: 'pattern',
              pattern: 'solid',
              fgColor: { argb: STATS_GREY }
            };
            baseRespondingRow.getCell(3).border = {
              top: { style: 'thin' },
              bottom: { style: 'thin' },
              left: { style: 'thin' },
              right: { style: 'thin' }
            };

            // Banner cut bases
            let baseCol = 4;
            bannerCols.forEach(bannerCol => {
              baseRespondingRow.getCell(baseCol).value = cutBases[bannerCol.id];
              baseRespondingRow.getCell(baseCol).alignment = { horizontal: 'center' };
              baseRespondingRow.getCell(baseCol).font = { italic: true, size: 9 };
              baseRespondingRow.getCell(baseCol).fill = {
                type: 'pattern',
                pattern: 'solid',
                fgColor: { argb: STATS_GREY }
              };
              baseRespondingRow.getCell(baseCol).border = {
                top: { style: 'thin' },
                bottom: { style: 'thin' },
                left: { style: 'thin' },
                right: { style: 'thin' }
              };
              baseCol++;
            });
          }

          // Handle numeric grid summary tables (mean or sum)
          if (isNumericGridSummaryTable && variable.statements) {
            const baseName = variable.name;
            const baseNumber = baseName.replace(/^Q/, '');
            const question = questionnaireQuestions.find(q => {
              const qNum = q.number || q.id;
              return qNum === baseNumber ||
                     qNum === baseNumber.replace(/^Q/, '') ||
                     String(qNum) === String(baseNumber);
            });

            // Build column map for all columns
            const statementEntries = Object.entries(variable.statements || {});
            const gridColMap: Record<string, Record<string, string | null>> = {}; // [stmtCode][columnCode] -> colHeader
            
            // Get all column codes from question response options
            const columnCodes: string[] = [];
            if (question && question.responseOptions && Array.isArray(question.responseOptions)) {
              question.responseOptions.forEach((respOpt, respIdx) => {
                const columnCode = `c${respIdx + 1}`;
                columnCodes.push(columnCode);
              });
            } else {
              // Default to c1 if no response options
              columnCodes.push('c1');
            }

            // Build column map for each statement and column
            statementEntries.forEach(([stmtCode]) => {
              gridColMap[stmtCode] = {};
              let normalizedCode = stmtCode;
              if (!/^r\d+/i.test(stmtCode) && /^\d+$/.test(stmtCode)) {
                normalizedCode = `r${stmtCode}`;
              }
              columnCodes.forEach(columnCode => {
                const cellHeader = `Q${baseName}${normalizedCode}${columnCode}`;
                let colHeader: string | null = null;
                const variations = [cellHeader, cellHeader.replace(/^Q/, ''), `${baseName}${normalizedCode}${columnCode}`];
                for (const v of variations) {
                  if (columnMapping[v]) { colHeader = columnMapping[v]; break; }
                  const match = Object.keys(columnMapping).find(k => k.toLowerCase() === v.toLowerCase());
                  if (match) { colHeader = columnMapping[match]; break; }
                }
                if (!colHeader && fullRawData.columns) {
                  for (const v of variations) {
                    const found = fullRawData.columns.find((c: string) => c.toLowerCase() === v.toLowerCase());
                    if (found) { colHeader = found; break; }
                  }
                }
                gridColMap[stmtCode][columnCode] = colHeader;
              });
            });

            // Calculate grid data for all statements across all columns
            const gridData: Record<string, { total: { sum: number; base: number; mean: number; stdDev: number }; cuts: Record<string, { sum: number; base: number; mean: number; stdDev: number; values: number[] }> }> = {};
            let totalSumAll = 0;
            const cutSumsAll: Record<string, number> = {};
            bannerCols.forEach(col => { cutSumsAll[col.id] = 0; });

            statementEntries.forEach(([stmtCode]) => {
              gridData[stmtCode] = { total: { sum: 0, base: 0, mean: 0, stdDev: 0 }, cuts: {} };
              bannerCols.forEach(col => { gridData[stmtCode].cuts[col.id] = { sum: 0, base: 0, mean: 0, stdDev: 0, values: [] }; });
              const totalValues: number[] = [];

              // Sum across all columns for this statement
              columnCodes.forEach(columnCode => {
                const stmtColHeader = gridColMap[stmtCode]?.[columnCode];
                if (!stmtColHeader) return;

                fullRawData.rows.forEach((row: any) => {
                  const val = row[stmtColHeader];
                  if (val === null || val === undefined || val === '') return;
                  const numVal = parseFloat(String(val));
                  if (isNaN(numVal)) return;

                  // Add to total
                  gridData[stmtCode].total.sum += numVal;
                  gridData[stmtCode].total.base++;
                  totalSumAll += numVal;
                  totalValues.push(numVal);

                  // Check which banner cuts this row matches
                  bannerCols.forEach(col => {
                    // Find the cut from banner group to get colHeader and codes
                    let cut: any = null;
                    if (bannerGroup.groups) {
                      for (const g of bannerGroup.groups) {
                        const foundCut = g.cuts.find((c: any) => c.id === col.id);
                        if (foundCut) {
                          cut = foundCut;
                          break;
                        }
                      }
                    }
                    if (!cut) return;
                    
                    const colHeader = getColumnHeader(cut.variableName);
                    if (!colHeader) return;
                    
                    const bannerVal = row[colHeader];
                    if (bannerVal === null || bannerVal === undefined || bannerVal === '') return;
                    const bannerValStr = String(bannerVal).trim();
                    const numBannerVal = Number(bannerValStr);
                    const codes = cut.codes || [];
                    for (const cutCode of codes) {
                      let matches = false;
                      if (bannerValStr === cutCode) matches = true;
                      else if (!isNaN(numBannerVal) && String(numBannerVal) === cutCode) matches = true;
                      else {
                        const codeNoC = cutCode.replace(/^c/i, '');
                        if (bannerValStr === codeNoC || (!isNaN(numBannerVal) && !isNaN(Number(codeNoC)) && numBannerVal === Number(codeNoC))) {
                          matches = true;
                        }
                      }
                      if (matches) {
                        gridData[stmtCode].cuts[col.id].sum += numVal;
                        gridData[stmtCode].cuts[col.id].base++;
                        cutSumsAll[col.id] += numVal;
                        gridData[stmtCode].cuts[col.id].values.push(numVal);
                        break;
                      }
                    }
                  });
                });
              });

              // Calculate means and standard deviations
              if (gridData[stmtCode].total.base > 0) {
                gridData[stmtCode].total.mean = gridData[stmtCode].total.sum / gridData[stmtCode].total.base;
                if (totalValues.length > 1) {
                  const variance = totalValues.reduce((acc, val) => acc + Math.pow(val - gridData[stmtCode].total.mean, 2), 0) / totalValues.length;
                  gridData[stmtCode].total.stdDev = Math.sqrt(variance);
                }
              }
              bannerCols.forEach(col => {
                const cutData = gridData[stmtCode].cuts[col.id];
                if (cutData.base > 0) {
                  cutData.mean = cutData.sum / cutData.base;
                  if (cutData.values.length > 1) {
                    const variance = cutData.values.reduce((acc, val) => acc + Math.pow(val - cutData.mean, 2), 0) / cutData.values.length;
                    cutData.stdDev = Math.sqrt(variance);
                  } else if (cutData.values.length === 1) {
                    cutData.stdDev = 0;
                  }
                }
              });
            });

            // Calculate stat letters for all statements before rendering
            const allStatLettersSummary: Record<string, Record<number, { letter: string; is95: boolean }[]>> = {};

            statementEntries.forEach(([stmtCode]) => {
              const data = gridData[stmtCode];
              if (!data) return;

              const codeStatLetters: Record<number, { letter: string; is95: boolean }[]> = {};

              bannerCols.forEach((thisCol, colIdx) => {
                // For sum summary: use percentage values for testing
                // For mean summary: use mean values for testing
                const thisValue = isSumSummaryTable
                  ? (cutSumsAll[thisCol.id] > 0 ? (data.cuts[thisCol.id].sum / cutSumsAll[thisCol.id]) * 100 : 0)
                  : data.cuts[thisCol.id].mean;
                const thisBase = data.cuts[thisCol.id].base;
                const thisStdDev = isMeanSummaryTable ? data.cuts[thisCol.id].stdDev : 0;
                const statLettersForCol: { letter: string; is95: boolean }[] = [];
                const confidenceLevel = bannerGroup.confidenceLevel || 95;

                // Within-group comparisons ONLY
                bannerCols.forEach((otherCol, otherIdx) => {
                  if (otherIdx === colIdx) return;
                  if (otherCol.groupIdx !== thisCol.groupIdx) return;

                  const otherValue = isSumSummaryTable
                    ? (cutSumsAll[otherCol.id] > 0 ? (data.cuts[otherCol.id].sum / cutSumsAll[otherCol.id]) * 100 : 0)
                    : data.cuts[otherCol.id].mean;
                  const otherBase = data.cuts[otherCol.id].base;
                  const otherStdDev = isMeanSummaryTable ? data.cuts[otherCol.id].stdDev : 0;

                  if (thisValue > otherValue) {
                    // Use appropriate statistical test based on table type
                    const { is95, is90 } = isMeanSummaryTable
                      ? isSignificantForMeans(thisValue, thisBase, thisStdDev, otherValue, otherBase, otherStdDev, confidenceLevel)
                      : isSignificant(thisValue, thisBase, otherValue, otherBase);

                    if (significanceLevel === 95) {
                      if (is95) statLettersForCol.push({ letter: String.fromCharCode(65 + otherIdx), is95: true });
                    } else {
                      if (is95) {
                        statLettersForCol.push({ letter: String.fromCharCode(65 + otherIdx), is95: true });
                      } else if (is90) {
                        statLettersForCol.push({ letter: String.fromCharCode(97 + otherIdx), is95: false });
                      }
                    }
                  }
                });

                codeStatLetters[colIdx] = statLettersForCol;
              });

              allStatLettersSummary[stmtCode] = codeStatLetters;
            });

            // Render summary table rows
            statementEntries.forEach(([stmtCode, stmtLabel]) => {
              const data = gridData[stmtCode];
              if (!data) return;

              if (isSumSummaryTable) {
                // Sum Summary Table: Show sum and percentage rows
                const sumRow = dataCutsWorksheet.getRow(currentRow++);
                sumRow.getCell(2).value = String(stmtLabel);
                sumRow.getCell(2).border = {
                  top: { style: 'thin' },
                  bottom: { style: 'thin' },
                  left: { style: 'thin' },
                  right: { style: 'thin' }
                };

                // Total sum
                const totalSumCell = sumRow.getCell(3);
                // If total base is 0, show "-" instead of sum
                if (data.total.base === 0) {
                  totalSumCell.value = '-';
                } else {
                  totalSumCell.value = data.total.sum;
                  totalSumCell.numFmt = '0';
                }
                totalSumCell.alignment = { horizontal: 'center' };
                totalSumCell.border = {
                  top: { style: 'thin' },
                  bottom: { style: 'thin' },
                  left: { style: 'thin' },
                  right: { style: 'thin' }
                };

                // Banner cut sums
                let col = 4;
                bannerCols.forEach(bannerCol => {
                  const cutBase = data.cuts[bannerCol.id].base || 0;
                  const sumCell = sumRow.getCell(col);
                  // If base size is 0, show "-" instead of sum
                  if (cutBase === 0) {
                    sumCell.value = '-';
                  } else {
                    sumCell.value = data.cuts[bannerCol.id].sum;
                    sumCell.numFmt = '0';
                  }
                  sumCell.alignment = { horizontal: 'center' };
                  sumCell.border = {
                    top: { style: 'thin' },
                    bottom: { style: 'thin' },
                    left: { style: 'thin' },
                    right: { style: 'thin' }
                  };
                  col++;
                });

                // Percentage row
                const pctRow = dataCutsWorksheet.getRow(currentRow++);
                pctRow.getCell(2).value = '';
                pctRow.getCell(2).border = {
                  top: { style: 'thin' },
                  bottom: { style: 'thin' },
                  left: { style: 'thin' },
                  right: { style: 'thin' }
                };

                // Total percentage
                const totalPct = totalSumAll > 0 ? (data.total.sum / totalSumAll) * 100 : 0;
                const totalPctCell = pctRow.getCell(3);
                // If total base is 0, show "-" instead of percentage
                if (data.total.base === 0) {
                  totalPctCell.value = '-';
                } else {
                  totalPctCell.value = totalPct / 100; // Store as decimal for percentage format
                  totalPctCell.numFmt = percentageDecimals === 0 ? '0%' : percentageDecimals === 1 ? '0.0%' : '0.00%';
                }
                totalPctCell.alignment = { horizontal: 'center' };
                totalPctCell.border = {
                  top: { style: 'thin' },
                  bottom: { style: 'thin' },
                  left: { style: 'thin' },
                  right: { style: 'thin' }
                };

                // Banner cut percentages
                col = 4;
                bannerCols.forEach((bannerCol, colIdx) => {
                  const cutBase = data.cuts[bannerCol.id].base || 0;
                  const cutTotalSum = cutSumsAll[bannerCol.id] || 0;
                  const cutPct = cutTotalSum > 0 ? (data.cuts[bannerCol.id].sum / cutTotalSum) * 100 : 0;
                  const cutPctCell = pctRow.getCell(col);
                  // If base size is 0, show "-" instead of percentage
                  if (cutBase === 0) {
                    cutPctCell.value = '-';
                  } else {
                    cutPctCell.value = cutPct / 100; // Store as decimal for percentage format
                    cutPctCell.numFmt = percentageDecimals === 0 ? '0%' : percentageDecimals === 1 ? '0.0%' : '0.00%';
                  }
                  cutPctCell.alignment = { horizontal: 'center' };

                  // Add blue highlighting if this cell has stat letters
                  const statLettersForCode = allStatLettersSummary[stmtCode] || {};
                  const statLetters = statLettersForCode[colIdx] || [];
                  if (statLetters.length > 0) {
                    cutPctCell.fill = {
                      type: 'pattern',
                      pattern: 'solid',
                      fgColor: { argb: 'FFE6F3FF' }
                    };
                  }

                  cutPctCell.border = {
                    top: { style: 'thin' },
                    bottom: { style: 'thin' },
                    left: { style: 'thin' },
                    right: { style: 'thin' }
                  };
                  col++;
                });

                // Stat letters row
                const statLettersForCode = allStatLettersSummary[stmtCode] || {};
                const hasAnyStatLettersForCode = Object.values(statLettersForCode).some(arr => arr && arr.length > 0);

                if (hasAnyStatLettersForCode) {
                  const statRow = dataCutsWorksheet.getRow(currentRow++);
                  statRow.getCell(2).value = '';
                  statRow.getCell(2).border = {
                    top: { style: 'thin' },
                    bottom: { style: 'thin' },
                    left: { style: 'thin' },
                    right: { style: 'thin' }
                  };

                  statRow.getCell(3).value = '';
                  statRow.getCell(3).border = {
                    top: { style: 'thin' },
                    bottom: { style: 'thin' },
                    left: { style: 'thin' },
                    right: { style: 'thin' }
                  };

                  col = 4;
                  bannerCols.forEach((bannerCol, colIdx) => {
                    const statLetters = statLettersForCode[colIdx] || [];
                    const statLettersStr = statLetters.map(s => s.letter).join('');
                    const statCell = statRow.getCell(col);
                    statCell.value = statLettersStr;
                    statCell.alignment = { horizontal: 'center', vertical: 'middle' };
                    if (statLetters.length > 0) {
                      statCell.fill = {
                        type: 'pattern',
                        pattern: 'solid',
                        fgColor: { argb: 'FFE6F3FF' }
                      };
                    }
                    statCell.border = {
                      top: { style: 'thin' },
                      bottom: { style: 'thin' },
                      left: { style: 'thin' },
                      right: { style: 'thin' }
                    };
                    col++;
                  });
                }
              } else if (isMeanSummaryTable) {
                // Mean Summary Table: Show single row with mean
                const meanRow = dataCutsWorksheet.getRow(currentRow++);
                meanRow.getCell(2).value = String(stmtLabel);
                meanRow.getCell(2).border = {
                  top: { style: 'thin' },
                  bottom: { style: 'thin' },
                  left: { style: 'thin' },
                  right: { style: 'thin' }
                };

                // Total mean
                const totalMeanCell = meanRow.getCell(3);
                console.log('🟣 Mean row - statement:', stmt.text, 'total.base:', data.total.base, 'total.mean:', data.total.mean);
                // If total base is 0, show "-" instead of mean
                if (data.total.base === 0) {
                  console.log('🔴 ZERO BASE DETECTED - Setting mean to dash for:', stmt.text, 'base:', data.total.base);
                  totalMeanCell.value = '-';
                } else {
                  totalMeanCell.value = data.total.mean;
                  totalMeanCell.numFmt = '0.00';
                }
                totalMeanCell.alignment = { horizontal: 'center' };
                totalMeanCell.border = {
                  top: { style: 'thin' },
                  bottom: { style: 'thin' },
                  left: { style: 'thin' },
                  right: { style: 'thin' }
                };

                // Banner cut means
                let col = 4;
                bannerCols.forEach((bannerCol, colIdx) => {
                  const cutBase = data.cuts[bannerCol.id].base || 0;
                  const meanCell = meanRow.getCell(col);
                  console.log('🟣 Banner cut - col:', bannerCol.title, 'base:', cutBase, 'mean:', data.cuts[bannerCol.id].mean);
                  // If base size is 0, show "-" instead of mean
                  if (cutBase === 0) {
                    console.log('🔴 ZERO BASE in banner cut - col:', bannerCol.title, 'base:', cutBase);
                    meanCell.value = '-';
                  } else {
                    meanCell.value = data.cuts[bannerCol.id].mean;
                    meanCell.numFmt = '0.00';
                  }
                  meanCell.alignment = { horizontal: 'center' };

                  // Add blue highlighting if this cell has stat letters
                  const statLettersForCode = allStatLettersSummary[stmtCode] || {};
                  const statLetters = statLettersForCode[colIdx] || [];
                  if (statLetters.length > 0) {
                    meanCell.fill = {
                      type: 'pattern',
                      pattern: 'solid',
                      fgColor: { argb: 'FFE6F3FF' }
                    };
                  }

                  meanCell.border = {
                    top: { style: 'thin' },
                    bottom: { style: 'thin' },
                    left: { style: 'thin' },
                    right: { style: 'thin' }
                  };
                  col++;
                });

                // Stat letters row
                const statLettersForCode = allStatLettersSummary[stmtCode] || {};
                const hasAnyStatLettersForCode = Object.values(statLettersForCode).some(arr => arr && arr.length > 0);

                if (hasAnyStatLettersForCode) {
                  const statRow = dataCutsWorksheet.getRow(currentRow++);
                  statRow.getCell(2).value = '';
                  statRow.getCell(2).border = {
                    top: { style: 'thin' },
                    bottom: { style: 'thin' },
                    left: { style: 'thin' },
                    right: { style: 'thin' }
                  };

                  statRow.getCell(3).value = '';
                  statRow.getCell(3).border = {
                    top: { style: 'thin' },
                    bottom: { style: 'thin' },
                    left: { style: 'thin' },
                    right: { style: 'thin' }
                  };

                  col = 4;
                  bannerCols.forEach((bannerCol, colIdx) => {
                    const statLetters = statLettersForCode[colIdx] || [];
                    const statLettersStr = statLetters.map(s => s.letter).join('');
                    const statCell = statRow.getCell(col);
                    statCell.value = statLettersStr;
                    statCell.alignment = { horizontal: 'center', vertical: 'middle' };
                    if (statLetters.length > 0) {
                      statCell.fill = {
                        type: 'pattern',
                        pattern: 'solid',
                        fgColor: { argb: 'FFE6F3FF' }
                      };
                    }
                    statCell.border = {
                      top: { style: 'thin' },
                      bottom: { style: 'thin' },
                      left: { style: 'thin' },
                      right: { style: 'thin' }
                    };
                    col++;
                  });
                }
              }
            });

            if (bannerCols.length > 0) {
              // Add comparison groups details section
              // Build comparison groups string based on banner groups
              const groupMapSummary = new Map<number, number[]>();
              bannerCols.forEach((col, idx) => {
                const groupIdx = col.groupIdx;
                if (!groupMapSummary.has(groupIdx)) {
                  groupMapSummary.set(groupIdx, []);
                }
                groupMapSummary.get(groupIdx)!.push(idx);
              });

              const comparisonGroupsSummary = Array.from(groupMapSummary.values())
                .map(colIndices =>
                  colIndices.map(idx => String.fromCharCode(65 + idx)).join('')
                )
                .join('/');

              // Comparison groups row
              const compGroupsRowSummary = dataCutsWorksheet.getRow(currentRow++);
              compGroupsRowSummary.getCell(2).value = `Comparison Groups: ${comparisonGroupsSummary}`;
              compGroupsRowSummary.getCell(2).font = { size: 9, italic: true };

              // Uppercase explanation row
              const upperRowSummary = dataCutsWorksheet.getRow(currentRow++);
              upperRowSummary.getCell(2).value = 'Uppercase letters indicate significance at the 95% level.';
              upperRowSummary.getCell(2).font = { size: 9, italic: true };

              // Lowercase explanation row (only if significance level is 90)
              if (significanceLevel === 90) {
                const lowerRowSummary = dataCutsWorksheet.getRow(currentRow++);
                lowerRowSummary.getCell(2).value = 'Lowercase letters indicate significance at the 90% level.';
                lowerRowSummary.getCell(2).font = { size: 9, italic: true };
              }
            }

            // Skip regular response code processing for summary tables
            tableNumber++;
            continue;
          }

          const numericGridStatementInfo = (() => {
            if (!isNumericGrid || isNumericGridSummaryTable || !variable.statements) return null;
            const match = tableName.match(/(r\d+)/i);
            if (match) {
              const stmtCode = match[1];
              const stmtText = variable.statements?.[stmtCode] || variable.statements?.[stmtCode.replace(/^r/i, '')];
              return { stmtCode, stmtText: stmtText ? String(stmtText) : null };
            }
            const tableLower = tableName.toLowerCase();
            for (const [stmtCode, stmtText] of Object.entries(variable.statements)) {
              const expectedByCode = `${variable.name}_${stmtCode}`.toLowerCase();
              if (tableLower === expectedByCode || tableLower === `${variable.name}${stmtCode}`.toLowerCase()) {
                return { stmtCode, stmtText: String(stmtText) };
              }
              if (stmtText && tableLower.includes(String(stmtText).toLowerCase())) {
                return { stmtCode, stmtText: String(stmtText) };
              }
            }
            return null;
          })();
          const isIndividualNumericGridTable = !!numericGridStatementInfo;

          if (isIndividualNumericGridTable) {
            const stmtCode = numericGridStatementInfo?.stmtCode || '';
            if (!stmtCode) {
              tableNumber++;
              continue;
            }

            const baseQuestionNumber = getBaseQuestionNumber(variable.name);
            let normalizedStmtCode = stmtCode;
            if (!/^r\d+/i.test(stmtCode) && /^\d+$/.test(stmtCode)) {
              normalizedStmtCode = `r${stmtCode}`;
            }

            const responseOptions = getNumericGridResponseOptions(variable);
            const columnCodesRaw = variable.codes && Object.keys(variable.codes).length > 0
              ? Object.keys(variable.codes)
              : responseOptions.map((opt) => opt.code);
            const normalizedColumns = columnCodesRaw.map(normalizeNumericGridColumnCode).filter(Boolean);
            const columnFromVarMatch = variable.name.match(/c\d+/i);
            const columnFromVariableName = columnFromVarMatch ? normalizeNumericGridColumnCode(columnFromVarMatch[0]) : null;
            const columnsToUse = columnFromVariableName
              ? [columnFromVariableName]
              : (normalizedColumns.length > 0 ? normalizedColumns : ['c1']);

            const headersToUse = columnsToUse.map((col) => `${baseQuestionNumber}${normalizedStmtCode}${col}`);

            const cutRespondentIndexSets: Record<string, Set<number>> = {};
            bannerCols.forEach((col) => { cutRespondentIndexSets[col.id] = new Set<number>(); });
            if (bannerCols.length > 0 && fullRawData?.rows) {
              fullRawData.rows.forEach((row: any, idx: number) => {
                bannerCols.forEach((col) => {
                  if (col.matchesRow(row)) {
                    cutRespondentIndexSets[col.id].add(idx);
                  }
                });
              });
            }

            const totalValues: number[] = [];
            const totalRespondentSet = new Set<number>();
            const cutValuesMap: Record<string, number[]> = {};
            const cutRespondentSets: Record<string, Set<number>> = {};
            bannerCols.forEach((col) => {
              cutValuesMap[col.id] = [];
              cutRespondentSets[col.id] = new Set<number>();
            });

            headersToUse.forEach((header) => {
              const data = getVariableDataByExpectedHeader(header);
              if (!data || !Array.isArray(data.values)) return;
              data.values.forEach((value: any, idx: number) => {
                if (value === null || value === undefined || value === '') return;
                const numVal = parseFloat(String(value));
                if (isNaN(numVal)) return;
                totalValues.push(numVal);
                totalRespondentSet.add(idx);
                bannerCols.forEach((col) => {
                  if (cutRespondentIndexSets[col.id]?.has(idx)) {
                    cutValuesMap[col.id].push(numVal);
                    cutRespondentSets[col.id].add(idx);
                  }
                });
              });
            });

            const frequencyMap: Record<number, { total: number; cuts: Record<string, number> }> = {};
            const addToFrequency = (numVal: number, cutId?: string) => {
              const roundedVal = Math.round(numVal);
              if (!frequencyMap[roundedVal]) {
                frequencyMap[roundedVal] = { total: 0, cuts: {} };
                bannerCols.forEach(col => { frequencyMap[roundedVal].cuts[col.id] = 0; });
              }
              if (cutId) {
                frequencyMap[roundedVal].cuts[cutId] = (frequencyMap[roundedVal].cuts[cutId] || 0) + 1;
              } else {
                frequencyMap[roundedVal].total++;
              }
            };

            totalValues.forEach((val) => addToFrequency(val));
            bannerCols.forEach((col) => {
              (cutValuesMap[col.id] || []).forEach((val) => addToFrequency(val, col.id));
            });

            const totalBase = totalRespondentSet.size;
            const cutBases: Record<string, number> = {};
            bannerCols.forEach((col) => { cutBases[col.id] = cutRespondentSets[col.id]?.size || 0; });

            const STATS_GREY = 'FFE8E8E8';
            const baseRow = dataCutsWorksheet.getRow(currentRow++);
            baseRow.getCell(2).value = 'Base (total responding):';
            baseRow.getCell(2).font = { italic: true, size: 9 };
            baseRow.getCell(2).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: STATS_GREY } };
            baseRow.getCell(2).border = {
              top: { style: 'thin' },
              bottom: { style: 'thin' },
              left: { style: 'thin' },
              right: { style: 'thin' }
            };
            baseRow.getCell(3).value = totalBase;
            baseRow.getCell(3).alignment = { horizontal: 'center' };
            baseRow.getCell(3).font = { italic: true, size: 9 };
            baseRow.getCell(3).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: STATS_GREY } };
            baseRow.getCell(3).border = {
              top: { style: 'thin' },
              bottom: { style: 'thin' },
              left: { style: 'thin' },
              right: { style: 'thin' }
            };
            let baseCol = 4;
            bannerCols.forEach((bannerCol) => {
              baseRow.getCell(baseCol).value = cutBases[bannerCol.id] || 0;
              baseRow.getCell(baseCol).alignment = { horizontal: 'center' };
              baseRow.getCell(baseCol).font = { italic: true, size: 9 };
              baseRow.getCell(baseCol).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: STATS_GREY } };
              baseRow.getCell(baseCol).border = {
                top: { style: 'thin' },
                bottom: { style: 'thin' },
                left: { style: 'thin' },
                right: { style: 'thin' }
              };
              baseCol++;
            });

            const sortedValues = Object.keys(frequencyMap).map(Number).sort((a, b) => a - b);
            sortedValues.forEach(value => {
              const freqData = frequencyMap[value];
              if (!freqData) return;

              const valueRow = dataCutsWorksheet.getRow(currentRow++);
              valueRow.getCell(2).value = value;
              valueRow.getCell(2).border = {
                top: { style: 'thin' },
                bottom: { style: 'thin' },
                left: { style: 'thin' },
                right: { style: 'thin' }
              };

              // If total base is 0, show "-" instead of count
              valueRow.getCell(3).value = totalBase === 0 ? '-' : freqData.total;
              valueRow.getCell(3).alignment = { horizontal: 'center' };
              valueRow.getCell(3).border = {
                top: { style: 'thin' },
                bottom: { style: 'thin' },
                left: { style: 'thin' },
                right: { style: 'thin' }
              };

              let col = 4;
              bannerCols.forEach(bannerCol => {
                const cutBase = cutBases[bannerCol.id] || 0;
                const cutCount = freqData.cuts[bannerCol.id] || 0;
                // If base size is 0, show "-" instead of the count
                valueRow.getCell(col).value = cutBase === 0 ? '-' : cutCount;
                valueRow.getCell(col).alignment = { horizontal: 'center' };
                valueRow.getCell(col).border = {
                  top: { style: 'thin' },
                  bottom: { style: 'thin' },
                  left: { style: 'thin' },
                  right: { style: 'thin' }
                };
                col++;
              });

              const pctRow = dataCutsWorksheet.getRow(currentRow++);
              pctRow.getCell(2).value = '';
              pctRow.getCell(2).border = {
                top: { style: 'thin' },
                bottom: { style: 'thin' },
                left: { style: 'thin' },
                right: { style: 'thin' }
              };

              const totalPct = totalBase > 0 ? (freqData.total / totalBase) * 100 : 0;
              const totalPctCell = pctRow.getCell(3);
              // If total base is 0, show "-" instead of percentage
              if (totalBase === 0) {
                totalPctCell.value = '-';
              } else {
                totalPctCell.value = totalPct / 100;
                totalPctCell.numFmt = percentageDecimals === 0 ? '0%' : percentageDecimals === 1 ? '0.0%' : '0.00%';
              }
              totalPctCell.alignment = { horizontal: 'center' };
              totalPctCell.border = {
                top: { style: 'thin' },
                bottom: { style: 'thin' },
                left: { style: 'thin' },
                right: { style: 'thin' }
              };

              col = 4;
              bannerCols.forEach(bannerCol => {
                const cutBase = cutBases[bannerCol.id] || 0;
                const cutCount = freqData.cuts[bannerCol.id] || 0;
                const cutPct = cutBase > 0 ? (cutCount / cutBase) * 100 : 0;
                const cutPctCell = pctRow.getCell(col);
                // If base size is 0, show "-" instead of percentage
                if (cutBase === 0) {
                  cutPctCell.value = '-';
                } else {
                  cutPctCell.value = cutPct / 100;
                  cutPctCell.numFmt = percentageDecimals === 0 ? '0%' : percentageDecimals === 1 ? '0.0%' : '0.00%';
                }
                cutPctCell.alignment = { horizontal: 'center' };
                cutPctCell.border = {
                  top: { style: 'thin' },
                  bottom: { style: 'thin' },
                  left: { style: 'thin' },
                  right: { style: 'thin' }
                };
                col++;
              });
            });

            const computeStatsForValues = (vals: number[]) => {
              if (!vals.length) return null;
              const sorted = [...vals].sort((a, b) => a - b);
              const sum = vals.reduce((acc, val) => acc + val, 0);
              const mean = sum / vals.length;
              const variance = vals.reduce((acc, val) => acc + Math.pow(val - mean, 2), 0) / vals.length;
              const stdDev = Math.sqrt(variance);
              const median = sorted.length % 2 === 0
                ? (sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2
                : sorted[Math.floor(sorted.length / 2)];
              const freqMap: Record<number, number> = {};
              vals.forEach(v => {
                const rounded = Math.round(v);
                freqMap[rounded] = (freqMap[rounded] || 0) + 1;
              });
              const modeEntry = Object.entries(freqMap).reduce((max, [val, count]) =>
                count > max[1] ? [val, count] : max, ['0', 0]
              );
              const mode = parseFloat(modeEntry[0]);
              const min = sorted[0];
              const max = sorted[sorted.length - 1];

              const lowerBound = mean - 2 * stdDev;
              const upperBound = mean + 2 * stdDev;
              const valsNoOutliers = vals.filter(v => v >= lowerBound && v <= upperBound);
              const sumNoOutliers = valsNoOutliers.reduce((acc, val) => acc + val, 0);
              const meanNoOutliers = valsNoOutliers.length > 0 ? sumNoOutliers / valsNoOutliers.length : 0;

              return {
                mean,
                meanNoOutliers,
                sum,
                sumNoOutliers,
                stdDev,
                median,
                mode,
                min,
                max,
              };
            };

            const statsSelections = getStatsSelectionsForVariable(variable.name);
            if (Object.values(statsSelections).some(v => v)) {
              const totalStats = computeStatsForValues(totalValues);
              const cutStats: Record<string, any> = {};
              bannerCols.forEach((col) => {
                cutStats[col.id] = computeStatsForValues(cutValuesMap[col.id] || []);
              });

              const statsToShow = [
                { key: 'sum', label: 'Sum', format: '0' },
                { key: 'mean', label: 'Mean', format: '0.00' },
                { key: 'meanNoOutliers', label: 'Mean (Outliers Removed)', format: '0.00' },
                { key: 'sumNoOutliers', label: 'Sum (Outliers Removed)', format: '0' },
                { key: 'median', label: 'Median', format: '0.00' },
                { key: 'mode', label: 'Mode', format: '0' },
                { key: 'stdDev', label: 'Std Dev', format: '0.00' },
                { key: 'max', label: 'Max', format: '0' },
                { key: 'min', label: 'Min', format: '0' }
              ];

              statsToShow.forEach(stat => {
                if (!statsSelections[stat.key]) return;
                const statRow = dataCutsWorksheet.getRow(currentRow++);
                statRow.getCell(2).value = stat.label;
                statRow.getCell(2).font = { bold: false };
                statRow.getCell(2).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: STATS_GREY } };
                statRow.getCell(2).border = {
                  top: { style: 'thin' },
                  bottom: { style: 'thin' },
                  left: { style: 'thin' },
                  right: { style: 'thin' }
                };

                const totalStatValue = totalStats ? totalStats[stat.key] ?? 0 : 0;
                statRow.getCell(3).value = totalStatValue;
                statRow.getCell(3).numFmt = stat.format;
                statRow.getCell(3).alignment = { horizontal: 'center' };
                statRow.getCell(3).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: STATS_GREY } };
                statRow.getCell(3).border = {
                  top: { style: 'thin' },
                  bottom: { style: 'thin' },
                  left: { style: 'thin' },
                  right: { style: 'thin' }
                };

                let col = 4;
                bannerCols.forEach(bannerCol => {
                  const cutStatValue = cutStats[bannerCol.id] ? cutStats[bannerCol.id][stat.key] ?? 0 : 0;
                  statRow.getCell(col).value = cutStatValue;
                  statRow.getCell(col).numFmt = stat.format;
                  statRow.getCell(col).alignment = { horizontal: 'center' };
                  statRow.getCell(col).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: STATS_GREY } };
                  statRow.getCell(col).border = {
                    top: { style: 'thin' },
                    bottom: { style: 'thin' },
                    left: { style: 'thin' },
                    right: { style: 'thin' }
                  };
                  col++;
                });
              });
            }

            tableNumber++;
            continue;
          }


          // Check if this is an open end question - use frequency distribution from raw data
          const isOpenEndType = variable.type?.toLowerCase().includes('open end') &&
                                !variable.type?.toLowerCase().includes('list');

          // For open end questions, calculate frequency distribution from raw data
          if (isOpenEndType) {
            const freqData = calculateFrequencyData(variable, tableName);
            console.log('🔍 Open End Table Check:', tableName, 'hasFreqData:', !!freqData, 'codesLength:', freqData?.codes.length || 0, 'totalCount:', freqData?.totalCount || 0);
            // Skip empty open end tables (no codes or no responses)
            if (!freqData || freqData.codes.length === 0 || freqData.totalCount === 0) {
              console.log('🟠 SKIPPING EMPTY OPEN END TABLE:', tableName);
              tableNumber++;
              continue;
            }
            if (freqData && freqData.codes.length > 0) {
              const openEndOriginalTextMap = (freqData as any).originalTextMap as Record<string, string[]> | undefined;
              // Pre-calculate all counts, bases, and percentages for stat testing
              const openEndData: Record<string, { count: number; base: number; pct: number; cutData: Record<string, { count: number; base: number; pct: number }> }> = {};

              freqData.codes.forEach((codeItem) => {
                const code = codeItem.code;
                const codeLabel = codeItem.text;

                openEndData[code] = {
                  count: freqData.frequencyMap[code] || 0,
                  base: freqData.totalCount,
                  pct: freqData.totalCount > 0 ? ((freqData.frequencyMap[code] || 0) / freqData.totalCount) * 100 : 0,
                  cutData: {}
                };

                // Calculate cut data for each banner column
                bannerCols.forEach(bannerCol => {
                  let cut: any = null;
                  if (bannerGroup.groups) {
                    for (const g of bannerGroup.groups) {
                      const foundCut = g.cuts.find((c: any) => c.id === bannerCol.id);
                      if (foundCut) {
                        cut = foundCut;
                        break;
                      }
                    }
                  }

                  let cutCount = 0;
                  let cutBase = 0;

                  if (cut && fullRawData.rows) {
                    const cutColHeader = getColumnHeader(cut.variableName);
                    const varColHeader = getColumnHeader(variable.name) || getColumnHeaderFromQuestion(variable);
                    if (cutColHeader && varColHeader) {
                      fullRawData.rows.forEach((row: any) => {
                        const value = row[varColHeader];
                        if (value !== null && value !== undefined && value !== '') {
                          const bannerVal = row[cutColHeader];
                          if (bannerVal !== null && bannerVal !== undefined && bannerVal !== '') {
                            const bannerValStr = String(bannerVal).trim();
                            const numBannerVal = Number(bannerValStr);
                            const codes = cut.codes || [];
                            for (const cutCode of codes) {
                              let matches = false;
                              if (bannerValStr === cutCode) matches = true;
                              else if (!isNaN(numBannerVal) && String(numBannerVal) === cutCode) matches = true;
                              else {
                                const codeNoC = cutCode.replace(/^c/i, '');
                                if (bannerValStr === codeNoC || (!isNaN(numBannerVal) && !isNaN(Number(codeNoC)) && numBannerVal === Number(codeNoC))) {
                                  matches = true;
                                }
                              }
                              if (matches) {
                                cutBase++;
                                const strValue = String(value).trim();
                                const originals = openEndOriginalTextMap?.[code] || [];
                                const matchesGrouped = originals.includes(strValue) || areOpenEndSimilar(strValue, codeLabel) || areOpenEndSimilar(strValue, code);
                                if (matchesGrouped) {
                                  cutCount++;
                                }
                                break;
                              }
                            }
                          }
                        }
                      });
                    }
                  }

                  openEndData[code].cutData[bannerCol.id] = {
                    count: cutCount,
                    base: cutBase,
                    pct: cutBase > 0 ? (cutCount / cutBase) * 100 : 0
                  };
                });
              });

              const STATS_GREY_OPEN = 'FFE8E8E8';
              const baseRow = dataCutsWorksheet.getRow(currentRow++);
              baseRow.getCell(2).value = 'Base (total responding):';
              baseRow.getCell(2).font = { italic: true, size: 9 };
              baseRow.getCell(2).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: STATS_GREY_OPEN } };
              baseRow.getCell(2).border = {
                top: { style: 'thin' },
                bottom: { style: 'thin' },
                left: { style: 'thin' },
                right: { style: 'thin' }
              };

              baseRow.getCell(3).value = freqData.totalCount;
              baseRow.getCell(3).alignment = { horizontal: 'center' };
              baseRow.getCell(3).font = { italic: true, size: 9 };
              baseRow.getCell(3).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: STATS_GREY_OPEN } };
              baseRow.getCell(3).border = {
                top: { style: 'thin' },
                bottom: { style: 'thin' },
                left: { style: 'thin' },
                right: { style: 'thin' }
              };

              let baseCol = 4;
              const firstCode = freqData.codes[0]?.code;
              bannerCols.forEach((bannerCol) => {
                const cutBase = firstCode ? (openEndData[firstCode]?.cutData[bannerCol.id]?.base || 0) : 0;
                baseRow.getCell(baseCol).value = cutBase;
                baseRow.getCell(baseCol).alignment = { horizontal: 'center' };
                baseRow.getCell(baseCol).font = { italic: true, size: 9 };
                baseRow.getCell(baseCol).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: STATS_GREY_OPEN } };
                baseRow.getCell(baseCol).border = {
                  top: { style: 'thin' },
                  bottom: { style: 'thin' },
                  left: { style: 'thin' },
                  right: { style: 'thin' }
                };
                baseCol++;
              });

              // Calculate stat letters for all codes
              const allStatLettersOpenEnd: Record<string, Record<number, { letter: string; is95: boolean }[]>> = {};

              freqData.codes.forEach((codeItem) => {
                const code = codeItem.code;
                const codeStatLetters: Record<number, { letter: string; is95: boolean }[]> = {};

                bannerCols.forEach((thisCol, colIdx) => {
                  const thisPct = openEndData[code].cutData[thisCol.id]?.pct || 0;
                  const thisBase = openEndData[code].cutData[thisCol.id]?.base || 0;
                  const statLettersForCol: { letter: string; is95: boolean }[] = [];

                  // Within-group comparisons ONLY
                  bannerCols.forEach((otherCol, otherIdx) => {
                    if (otherIdx === colIdx) return;
                    if (otherCol.groupIdx !== thisCol.groupIdx) return;

                    const otherPct = openEndData[code].cutData[otherCol.id]?.pct || 0;
                    const otherBase = openEndData[code].cutData[otherCol.id]?.base || 0;

                    if (thisPct > otherPct) {
                      const { is95, is90 } = isSignificant(thisPct, thisBase, otherPct, otherBase);

                      if (significanceLevel === 95) {
                        if (is95) statLettersForCol.push({ letter: String.fromCharCode(65 + otherIdx), is95: true });
                      } else {
                        if (is95) {
                          statLettersForCol.push({ letter: String.fromCharCode(65 + otherIdx), is95: true });
                        } else if (is90) {
                          statLettersForCol.push({ letter: String.fromCharCode(97 + otherIdx), is95: false });
                        }
                      }
                    }
                  });

                  codeStatLetters[colIdx] = statLettersForCol;
                });

                allStatLettersOpenEnd[code] = codeStatLetters;
              });

              // Render frequency distribution table for open end
              freqData.codes.forEach((codeItem) => {
                const code = codeItem.code;
                const codeLabel = codeItem.text;
                const frequency = freqData.frequencyMap[code] || 0;
                const percentage = freqData.totalCount > 0 ? (frequency / freqData.totalCount) * 100 : 0;
                
                // Count row
                const countRow = dataCutsWorksheet.getRow(currentRow++);
                countRow.getCell(2).value = codeLabel;
                countRow.getCell(2).border = {
                  top: { style: 'thin' },
                  bottom: { style: 'thin' },
                  left: { style: 'thin' },
                  right: { style: 'thin' }
                };
                
                // Total count
                countRow.getCell(3).value = frequency;
                countRow.getCell(3).alignment = { horizontal: 'center' };
                countRow.getCell(3).border = {
                  top: { style: 'thin' },
                  bottom: { style: 'thin' },
                  left: { style: 'thin' },
                  right: { style: 'thin' }
                };
                
                // Banner cut counts - use pre-calculated data
                let col = 4;
                bannerCols.forEach((bannerCol, colIdx) => {
                  const cutCount = openEndData[code].cutData[bannerCol.id]?.count || 0;
                  const countCell = countRow.getCell(col);
                  countCell.value = cutCount;
                  countCell.alignment = { horizontal: 'center' };

                  // Add blue highlighting if this cell has stat letters
                  const statLettersForCode = allStatLettersOpenEnd[code] || {};
                  const statLetters = statLettersForCode[colIdx] || [];
                  if (statLetters.length > 0) {
                    countCell.fill = {
                      type: 'pattern',
                      pattern: 'solid',
                      fgColor: { argb: 'FFE6F3FF' }
                    };
                  }

                  countCell.border = {
                    top: { style: 'thin' },
                    bottom: { style: 'thin' },
                    left: { style: 'thin' },
                    right: { style: 'thin' }
                  };
                  col++;
                });
                
                // Percentage row
                const pctRow = dataCutsWorksheet.getRow(currentRow++);
                pctRow.getCell(2).value = '';
                pctRow.getCell(2).border = {
                  top: { style: 'thin' },
                  bottom: { style: 'thin' },
                  left: { style: 'thin' },
                  right: { style: 'thin' }
                };
                
                // Total percentage
                const totalPctCell = pctRow.getCell(3);
                totalPctCell.value = percentage / 100; // Store as decimal for percentage format
                totalPctCell.numFmt = percentageDecimals === 0 ? '0%' : percentageDecimals === 1 ? '0.0%' : '0.00%';
                totalPctCell.alignment = { horizontal: 'center' };
                totalPctCell.border = {
                  top: { style: 'thin' },
                  bottom: { style: 'thin' },
                  left: { style: 'thin' },
                  right: { style: 'thin' }
                };
                
                // Banner cut percentages - use pre-calculated data
                col = 4;
                bannerCols.forEach((bannerCol, colIdx) => {
                  const cutPct = openEndData[code].cutData[bannerCol.id]?.pct || 0;
                  const cutPctCell = pctRow.getCell(col);
                  cutPctCell.value = cutPct / 100; // Store as decimal for percentage format
                  cutPctCell.numFmt = percentageDecimals === 0 ? '0%' : percentageDecimals === 1 ? '0.0%' : '0.00%';
                  cutPctCell.alignment = { horizontal: 'center' };

                  // Add blue highlighting if this cell has stat letters
                  const statLettersForCode = allStatLettersOpenEnd[code] || {};
                  const statLetters = statLettersForCode[colIdx] || [];
                  if (statLetters.length > 0) {
                    cutPctCell.fill = {
                      type: 'pattern',
                      pattern: 'solid',
                      fgColor: { argb: 'FFE6F3FF' }
                    };
                  }

                  cutPctCell.border = {
                    top: { style: 'thin' },
                    bottom: { style: 'thin' },
                    left: { style: 'thin' },
                    right: { style: 'thin' }
                  };
                  col++;
                });

                // Stat letters row (if any stat letters exist for this code)
                const statLettersForCode = allStatLettersOpenEnd[code] || {};
                const hasAnyStatLettersForCode = Object.values(statLettersForCode).some(arr => arr && arr.length > 0);

                if (hasAnyStatLettersForCode) {
                  const statRow = dataCutsWorksheet.getRow(currentRow++);
                  statRow.getCell(2).value = '';
                  statRow.getCell(2).border = {
                    top: { style: 'thin' },
                    bottom: { style: 'thin' },
                    left: { style: 'thin' },
                    right: { style: 'thin' }
                  };

                  // Total column - no stat letters for total
                  statRow.getCell(3).value = '';
                  statRow.getCell(3).border = {
                    top: { style: 'thin' },
                    bottom: { style: 'thin' },
                    left: { style: 'thin' },
                    right: { style: 'thin' }
                  };

                  // Banner cut stat letters
                  col = 4;
                  bannerCols.forEach((bannerCol, colIdx) => {
                    const statLetters = statLettersForCode[colIdx] || [];
                    const statLettersStr = statLetters.map(s => s.letter).join('');
                    const statCell = statRow.getCell(col);
                    statCell.value = statLettersStr;
                    statCell.alignment = { horizontal: 'center', vertical: 'middle' };
                    if (statLetters.length > 0) {
                      statCell.fill = {
                        type: 'pattern',
                        pattern: 'solid',
                        fgColor: { argb: 'FFE6F3FF' }
                      };
                    }
                    statCell.border = {
                      top: { style: 'thin' },
                      bottom: { style: 'thin' },
                      left: { style: 'thin' },
                      right: { style: 'thin' }
                    };
                    col++;
                  });
                }
              });

              if (bannerCols.length > 0) {
                // Add comparison groups details section
                // Build comparison groups string based on banner groups
                const groupMapOpenEnd = new Map<number, number[]>();
                bannerCols.forEach((col, idx) => {
                  const groupIdx = col.groupIdx;
                  if (!groupMapOpenEnd.has(groupIdx)) {
                    groupMapOpenEnd.set(groupIdx, []);
                  }
                  groupMapOpenEnd.get(groupIdx)!.push(idx);
                });

                const comparisonGroupsOpenEnd = Array.from(groupMapOpenEnd.values())
                  .map(colIndices =>
                    colIndices.map(idx => String.fromCharCode(65 + idx)).join('')
                  )
                  .join('/');

                // Comparison groups row
                const compGroupsRowOpenEnd = dataCutsWorksheet.getRow(currentRow++);
                compGroupsRowOpenEnd.getCell(2).value = `Comparison Groups: ${comparisonGroupsOpenEnd}`;
                compGroupsRowOpenEnd.getCell(2).font = { size: 9, italic: true };

                // Uppercase explanation row
                const upperRowOpenEnd = dataCutsWorksheet.getRow(currentRow++);
                upperRowOpenEnd.getCell(2).value = 'Uppercase letters indicate significance at the 95% level.';
                upperRowOpenEnd.getCell(2).font = { size: 9, italic: true };

                // Lowercase explanation row (only if significance level is 90)
                if (significanceLevel === 90) {
                  const lowerRowOpenEnd = dataCutsWorksheet.getRow(currentRow++);
                  lowerRowOpenEnd.getCell(2).value = 'Lowercase letters indicate significance at the 90% level.';
                  lowerRowOpenEnd.getCell(2).font = { size: 9, italic: true };
                }
              }

              // Skip regular response code processing for open end questions
              tableNumber++;
              continue;
            }
          }
          } // End of generic table rendering (skipped for numeric questions)

          // Check if this is a regular numeric question (not a grid)
          // Handle numeric questions - create frequency distribution table
          if (isNumericQuestion && tableName === variable.name) {
            if (isB8Debug) {
              appendStatLog('[B8] Entering numeric question handling block (third location)', { tableName, variable: variable.name });
            }

            // Define isNumeric for use in stats calculations later in this block
            const isNumeric = variable.type?.toLowerCase().includes('numeric');

            // Find the column header for this numeric variable
            // Check base variable name first (e.g., "S9" or "QS9")
            let numericColHeader = getColumnHeader(variable.name);
            
            // If not found and variable has statements, try statement-specific mappings (e.g., "S9r1" or "QS9r1")
            if (!numericColHeader && variable.statements && Object.keys(variable.statements).length > 0) {
              // Try each statement code
              for (const stmtCode of Object.keys(variable.statements)) {
                // Try variations: baseName + stmtCode (e.g., "S9r1", "QS9r1")
                const baseName = variable.name;
                const variations = [
                  `${baseName}${stmtCode}`,
                  `Q${baseName}${stmtCode}`,
                  baseName.startsWith('Q') ? `${baseName}${stmtCode}` : `Q${baseName}${stmtCode}`,
                  baseName.startsWith('Q') ? `${baseName.substring(1)}${stmtCode}` : `${baseName}${stmtCode}`
                ];
                
                for (const variation of variations) {
                  if (columnMapping[variation]) {
                    numericColHeader = columnMapping[variation];
                    break;
                  }
                  const matchingKey = Object.keys(columnMapping).find(
                    key => key.toLowerCase() === variation.toLowerCase()
                  );
                  if (matchingKey) {
                    numericColHeader = columnMapping[matchingKey];
                    break;
                  }
                  
                  // Also check direct column match
                  if (fullRawData.columns) {
                    const directMatch = fullRawData.columns.find(
                      col => col.toLowerCase() === variation.toLowerCase()
                    );
                    if (directMatch) {
                      numericColHeader = directMatch;
                      break;
                    }
                  }
                }
                
                if (numericColHeader) break;
              }
            }

            if (!numericColHeader) {
              numericColHeader = getColumnHeaderFromQuestion(variable);
            }
            
            // Use calculateBannerTableDataForVariable to get frequency distribution (same as Variables tab)
            const numericData = calculateBannerTableDataForVariable(variable, variable.name, bannerGroup);

            // Extract sorted numeric values from the data keys
            const sortedNumericValues = (!numericData || Object.keys(numericData).length === 0)
              ? []
              : Object.keys(numericData)
                  .map(v => parseFloat(v))
                  .filter(v => !isNaN(v))
                  .sort((a, b) => a - b);

            // Get bases from the data structure (will be 0 if no data)
            const totalBase = numericData?.[sortedNumericValues[0]?.toString() || '']?.['total']?.base || 0;
            const cutBases: Record<string, number> = {};
            bannerCols.forEach(col => {
              cutBases[col.id] = numericData?.[sortedNumericValues[0]?.toString() || '']?.[col.id]?.base || 0;
            });
            
            if (isPreviewMode) {
              // eslint-disable-next-line no-console
              console.log('[Preview Debug - buildTabSpecsWorkbook] Frequency distribution from calculateBannerTableDataForVariable:', {
                uniqueValues: sortedNumericValues.length,
                sortedValues: sortedNumericValues.slice(0, 10),
                totalBase,
                cutBases,
                sampleData: sortedNumericValues.slice(0, 3).map(v => ({
                  value: v,
                  total: numericData[v.toString()]?.['total'],
                  sampleCut: numericData[v.toString()]?.[bannerCols[0]?.id]
                }))
              });
            }

            // Skip table if there are no data rows (not even a base row)
            if (sortedNumericValues.length === 0) {
              tableNumber++;
              continue;
            }

            // Record position for TOC
            tablePositions.push({ tableNumber, tableName, rowNumber: currentRow, variable });
            
            // Table title
            const baseQuestionNumber = getBaseQuestionNumber(variable.name);
            const tableTitle = `Table ${tableNumber}: ${baseQuestionNumber}`;
            const titleRow = dataCutsWorksheet.getRow(currentRow++);
            titleRow.getCell(2).value = tableTitle;
            titleRow.getCell(2).font = { bold: true, size: 12 };
            
            // Question text
            const questionRow = dataCutsWorksheet.getRow(currentRow++);
            questionRow.getCell(2).value = variable.description || variable.name;
            questionRow.getCell(2).font = { size: 11 };
            
            // Build 3-row header (Total + banner groups) - same as other tables
            const headerStartRow = currentRow;
            const groupTitleRow = headerStartRow;
            const cutTitleRow = headerStartRow + 1;
            const statLetterRow = headerStartRow + 2;
            let currentCol = 2;
            
            // Row label cell (merged across all 3 rows)
            const rowLabelCell = dataCutsWorksheet.getRow(groupTitleRow).getCell(currentCol);
            rowLabelCell.value = '';
            rowLabelCell.border = {
              top: { style: 'thin' },
              bottom: { style: 'thin' },
              left: { style: 'thin' },
              right: { style: 'thin' }
            };
            dataCutsWorksheet.mergeCells(groupTitleRow, currentCol, statLetterRow, currentCol);
            [cutTitleRow, statLetterRow].forEach(r => {
              const cell = dataCutsWorksheet.getRow(r).getCell(currentCol);
              cell.border = {
                top: { style: 'thin' },
                bottom: { style: 'thin' },
                left: { style: 'thin' },
                right: { style: 'thin' }
              };
            });
            currentCol++;
            
            // Total column
            const totalGroupCell = dataCutsWorksheet.getRow(groupTitleRow).getCell(currentCol);
            totalGroupCell.value = 'Total';
            totalGroupCell.alignment = { horizontal: 'center', vertical: 'middle' };
            totalGroupCell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
            totalGroupCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFD14A2D' } };
            totalGroupCell.border = {
              top: { style: 'thin' },
              bottom: { style: 'thin' },
              left: { style: 'thin' },
              right: { style: 'thin' }
            };
            dataCutsWorksheet.mergeCells(groupTitleRow, currentCol, cutTitleRow, currentCol);
            const totalCutCell = dataCutsWorksheet.getRow(cutTitleRow).getCell(currentCol);
            totalCutCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFD14A2D' } };
            totalCutCell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
            totalCutCell.border = {
              top: { style: 'thin' },
              bottom: { style: 'thin' },
              left: { style: 'thin' },
              right: { style: 'thin' }
            };
            const totalStatCell = dataCutsWorksheet.getRow(statLetterRow).getCell(currentCol);
            totalStatCell.value = '';
            totalStatCell.alignment = { horizontal: 'center', vertical: 'middle' };
            totalStatCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFD14A2D' } };
            totalStatCell.border = {
              top: { style: 'thin' },
              bottom: { style: 'thin' },
              left: { style: 'thin' },
              right: { style: 'thin' }
            };
            currentCol++;
            
            // Banner groups
            groupStructure.forEach((group) => {
              const groupStartCol = currentCol;
              const groupCell = dataCutsWorksheet.getRow(groupTitleRow).getCell(groupStartCol);
              groupCell.value = group.title;
              groupCell.alignment = { horizontal: 'center', vertical: 'middle' };
              groupCell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
              groupCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFD14A2D' } };
              groupCell.border = {
                top: { style: 'thin' },
                bottom: { style: 'thin' },
                left: { style: 'thin' },
                right: { style: 'thin' }
              };
              if (group.cutCount > 1) {
                dataCutsWorksheet.mergeCells(groupTitleRow, groupStartCol, groupTitleRow, groupStartCol + group.cutCount - 1);
              }
              for (let i = 0; i < group.cutCount; i++) {
                const cutCol = groupStartCol + i;
                const bannerCol = bannerCols[group.startIdx + i];
                const cutCell = dataCutsWorksheet.getRow(cutTitleRow).getCell(cutCol);
                cutCell.value = bannerCol.title;
                cutCell.alignment = { horizontal: 'center', vertical: 'middle' };
                cutCell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
                cutCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFD14A2D' } };
                cutCell.border = {
                  top: { style: 'thin' },
                  bottom: { style: 'thin' },
                  left: { style: 'thin' },
                  right: { style: 'thin' }
                };
                const statCell = dataCutsWorksheet.getRow(statLetterRow).getCell(cutCol);
                const statLetter = String.fromCharCode(65 + group.startIdx + i);
                statCell.value = `(${statLetter})`;
                statCell.alignment = { horizontal: 'center', vertical: 'middle' };
                statCell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
                statCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFD14A2D' } };
                statCell.border = {
                  top: { style: 'thin' },
                  bottom: { style: 'thin' },
                  left: { style: 'thin' },
                  right: { style: 'thin' }
                };
              }
              currentCol += group.cutCount;
            });
            currentRow += 3;
            
            // Base row
            const baseRow = dataCutsWorksheet.getRow(currentRow++);
            baseRow.getCell(2).value = 'Base (total responding):';
            baseRow.getCell(2).font = { italic: true, size: 9 };
            baseRow.getCell(2).fill = {
              type: 'pattern',
              pattern: 'solid',
              fgColor: { argb: 'FFE8E8E8' }
            };
            baseRow.getCell(2).border = {
              top: { style: 'thin' },
              bottom: { style: 'thin' },
              left: { style: 'thin' },
              right: { style: 'thin' }
            };
            baseRow.getCell(3).value = totalBase;
            baseRow.getCell(3).alignment = { horizontal: 'center' };
            baseRow.getCell(3).font = { italic: true, size: 9 };
            baseRow.getCell(3).fill = {
              type: 'pattern',
              pattern: 'solid',
              fgColor: { argb: 'FFE8E8E8' }
            };
            baseRow.getCell(3).border = {
              top: { style: 'thin' },
              bottom: { style: 'thin' },
              left: { style: 'thin' },
              right: { style: 'thin' }
            };
            let baseCol = 4;
            bannerCols.forEach(bannerCol => {
              baseRow.getCell(baseCol).value = cutBases[bannerCol.id] || 0;
              baseRow.getCell(baseCol).alignment = { horizontal: 'center' };
              baseRow.getCell(baseCol).font = { italic: true, size: 9 };
              baseRow.getCell(baseCol).fill = {
                type: 'pattern',
                pattern: 'solid',
                fgColor: { argb: 'FFE8E8E8' }
              };
              baseRow.getCell(baseCol).border = {
                top: { style: 'thin' },
                bottom: { style: 'thin' },
                left: { style: 'thin' },
                right: { style: 'thin' }
              };
              baseCol++;
            });
            
            // Render frequency distribution rows using data from calculateBannerTableDataForVariable
            sortedNumericValues.forEach(numVal => {
              const valueKey = numVal.toString();
              const valueData = numericData[valueKey];
              if (!valueData) return;
              
              // Count row
              const countRow = dataCutsWorksheet.getRow(currentRow++);
              countRow.getCell(2).value = numVal;
              countRow.getCell(2).border = {
                top: { style: 'thin' },
                bottom: { style: 'thin' },
                left: { style: 'thin' },
                right: { style: 'thin' }
              };
              
              // Total count
              const totalCount = valueData['total']?.count || 0;
              countRow.getCell(3).value = totalCount;
              countRow.getCell(3).alignment = { horizontal: 'center' };
              countRow.getCell(3).border = {
                top: { style: 'thin' },
                bottom: { style: 'thin' },
                left: { style: 'thin' },
                right: { style: 'thin' }
              };
              
              // Banner cut counts
              let col = 4;
              bannerCols.forEach(bannerCol => {
                const cutCount = valueData[bannerCol.id]?.count || 0;
                countRow.getCell(col).value = cutCount;
                countRow.getCell(col).alignment = { horizontal: 'center' };
                countRow.getCell(col).border = {
                  top: { style: 'thin' },
                  bottom: { style: 'thin' },
                  left: { style: 'thin' },
                  right: { style: 'thin' }
                };
                col++;
              });
              
              // Percentage row
              const pctRow = dataCutsWorksheet.getRow(currentRow++);
              pctRow.getCell(2).value = '';
              pctRow.getCell(2).border = {
                top: { style: 'thin' },
                bottom: { style: 'thin' },
                left: { style: 'thin' },
                right: { style: 'thin' }
              };
              
              // Total percentage (already calculated in calculateBannerTableDataForVariable)
              const totalPct = valueData['total']?.percentage || 0;
              pctRow.getCell(3).value = totalPct / 100;
              pctRow.getCell(3).numFmt = percentageDecimals === 0 ? '0%' : percentageDecimals === 1 ? '0.0%' : '0.00%';
              pctRow.getCell(3).alignment = { horizontal: 'center' };
              pctRow.getCell(3).border = {
                top: { style: 'thin' },
                bottom: { style: 'thin' },
                left: { style: 'thin' },
                right: { style: 'thin' }
              };
              
              // Banner cut percentages (already calculated in calculateBannerTableDataForVariable)
              col = 4;
              bannerCols.forEach(bannerCol => {
                const cutPct = valueData[bannerCol.id]?.percentage || 0;
                pctRow.getCell(col).value = cutPct / 100;
                pctRow.getCell(col).numFmt = percentageDecimals === 0 ? '0%' : percentageDecimals === 1 ? '0.0%' : '0.00%';
                pctRow.getCell(col).alignment = { horizontal: 'center' };
                pctRow.getCell(col).border = {
                  top: { style: 'thin' },
                  bottom: { style: 'thin' },
                  left: { style: 'thin' },
                  right: { style: 'thin' }
                };
                col++;
              });
            });
            
            // Add stats rows if enabled
            const statsKey = variable.name;
            const statsSelections = getStatsSelectionsForVariable(statsKey);
            if (isNumeric && Object.values(statsSelections).some(v => v)) {
              // Calculate stats from frequency distribution
              let totalCount = 0;
              let sum = 0;
              let sumSquares = 0;
              let min = Infinity;
              let max = -Infinity;
              let modeValue: number | null = null;
              let modeCount = -1;
              
              sortedNumericValues.forEach(numVal => {
                const valueKey = numVal.toString();
                const count = numericData[valueKey]?.['total']?.count || 0;
                totalCount += count;
                sum += numVal * count;
                sumSquares += numVal * numVal * count;
                if (numVal < min) min = numVal;
                if (numVal > max) max = numVal;
                if (count > modeCount) {
                  modeCount = count;
                  modeValue = numVal;
                }
              });
              
              if (totalCount > 0) {
                const mean = sum / totalCount;
                const variance = Math.max(sumSquares / totalCount - mean * mean, 0);
                const stdDev = Math.sqrt(variance);
                const sorted = [...sortedNumericValues];
                const median = sorted.length % 2 === 0
                  ? (sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2
                  : sorted[Math.floor(sorted.length / 2)];
                
                let sumNoOutliers = sum;
                let meanNoOutliers = mean;
                if (stdDev > 0) {
                  let filteredSum = 0;
                  let filteredCount = 0;
                  const threshold = 2 * stdDev;
                  sortedNumericValues.forEach(numVal => {
                    const valueKey = numVal.toString();
                    const count = numericData[valueKey]?.['total']?.count || 0;
                    if (Math.abs(numVal - mean) <= threshold) {
                      filteredSum += numVal * count;
                      filteredCount += count;
                    }
                  });
                  if (filteredCount > 0) {
                    sumNoOutliers = filteredSum;
                    meanNoOutliers = filteredSum / filteredCount;
                  }
                }

                const statsRows = [
                  { label: 'Mean', key: 'mean', value: mean },
                  { label: 'Mean (Outliers Removed)', key: 'meanNoOutliers', value: meanNoOutliers },
                  { label: 'Sum', key: 'sum', value: sum },
                  { label: 'Sum (Outliers Removed)', key: 'sumNoOutliers', value: sumNoOutliers },
                  { label: 'Median', key: 'median', value: median },
                  { label: 'Mode', key: 'mode', value: modeValue },
                  { label: 'Std Dev', key: 'stdDev', value: stdDev },
                  { label: 'Min', key: 'min', value: min },
                  { label: 'Max', key: 'max', value: max },
                ];
                
                statsRows.forEach(stat => {
                  if (statsSelections[stat.key]) {
                    const statRow = dataCutsWorksheet.getRow(currentRow++);
                    statRow.getCell(2).value = stat.label + ':';
                    statRow.getCell(2).font = { bold: false };
                    statRow.getCell(2).fill = {
                      type: 'pattern',
                      pattern: 'solid',
                      fgColor: { argb: 'FFE8E8E8' }
                    };
                    statRow.getCell(2).border = {
                      top: { style: 'thin' },
                      bottom: { style: 'thin' },
                      left: { style: 'thin' },
                      right: { style: 'thin' }
                    };
                    
                    // Total stat value
                    statRow.getCell(3).value = stat.value;
                    statRow.getCell(3).numFmt = (stat.key === 'sum' || stat.key === 'sumNoOutliers') ? '0' : '0.00';
                    statRow.getCell(3).alignment = { horizontal: 'center' };
                    statRow.getCell(3).fill = {
                      type: 'pattern',
                      pattern: 'solid',
                      fgColor: { argb: 'FFE8E8E8' }
                    };
                    statRow.getCell(3).border = {
                      top: { style: 'thin' },
                      bottom: { style: 'thin' },
                      left: { style: 'thin' },
                      right: { style: 'thin' }
                    };
                    
                    // Banner cut stats (calculate per cut)
                    let col = 4;
                    bannerCols.forEach(bannerCol => {
                      const cutBase = cutBases[bannerCol.id] || 0;
                      let cutStatValue: number = 0;
                      
                      if (cutBase > 0) {
                        if (stat.key === 'mean') {
                          let cutSum = 0;
                          sortedNumericValues.forEach(numVal => {
                            const valueKey = numVal.toString();
                            cutSum += numVal * (numericData[valueKey]?.[bannerCol.id]?.count || 0);
                          });
                          cutStatValue = cutSum / cutBase;
                        } else if (stat.key === 'sum') {
                          sortedNumericValues.forEach(numVal => {
                            const valueKey = numVal.toString();
                            cutStatValue += numVal * (numericData[valueKey]?.[bannerCol.id]?.count || 0);
                          });
                        } else if (stat.key === 'meanNoOutliers' || stat.key === 'sumNoOutliers') {
                          let cutTotalCount = 0;
                          let cutSum = 0;
                          let cutSumSquares = 0;
                          sortedNumericValues.forEach(numVal => {
                            const valueKey = numVal.toString();
                            const count = numericData[valueKey]?.[bannerCol.id]?.count || 0;
                            cutTotalCount += count;
                            cutSum += numVal * count;
                            cutSumSquares += numVal * numVal * count;
                          });
                          if (cutTotalCount > 0) {
                            const cutMean = cutSum / cutTotalCount;
                            const cutVariance = Math.max(cutSumSquares / cutTotalCount - cutMean * cutMean, 0);
                            const cutStdDev = Math.sqrt(cutVariance);
                            if (cutStdDev > 0) {
                              let filteredSum = 0;
                              let filteredCount = 0;
                              const threshold = 2 * cutStdDev;
                              sortedNumericValues.forEach(numVal => {
                                const valueKey = numVal.toString();
                                const count = numericData[valueKey]?.[bannerCol.id]?.count || 0;
                                if (Math.abs(numVal - cutMean) <= threshold) {
                                  filteredSum += numVal * count;
                                  filteredCount += count;
                                }
                              });
                              if (stat.key === 'sumNoOutliers') {
                                cutStatValue = filteredSum;
                              } else {
                                cutStatValue = filteredCount > 0 ? filteredSum / filteredCount : 0;
                              }
                            } else {
                              cutStatValue = stat.key === 'sumNoOutliers' ? cutSum : (cutTotalCount > 0 ? cutSum / cutTotalCount : 0);
                            }
                          }
                        } else if (stat.key === 'median') {
                          const cutValues: number[] = [];
                          sortedNumericValues.forEach(numVal => {
                            const valueKey = numVal.toString();
                            const count = numericData[valueKey]?.[bannerCol.id]?.count || 0;
                            for (let i = 0; i < count; i++) {
                              cutValues.push(numVal);
                            }
                          });
                          cutValues.sort((a, b) => a - b);
                          cutStatValue = cutValues.length % 2 === 0
                            ? (cutValues[cutValues.length / 2 - 1] + cutValues[cutValues.length / 2]) / 2
                            : cutValues[Math.floor(cutValues.length / 2)];
                        } else if (stat.key === 'mode') {
                          let cutModeCount = -1;
                          sortedNumericValues.forEach(numVal => {
                            const valueKey = numVal.toString();
                            const count = numericData[valueKey]?.[bannerCol.id]?.count || 0;
                            if (count > cutModeCount) {
                              cutModeCount = count;
                              cutStatValue = numVal;
                            }
                          });
                        } else if (stat.key === 'stdDev') {
                          let cutSum = 0;
                          let cutSumSquares = 0;
                          sortedNumericValues.forEach(numVal => {
                            const valueKey = numVal.toString();
                            const count = numericData[valueKey]?.[bannerCol.id]?.count || 0;
                            cutSum += numVal * count;
                            cutSumSquares += numVal * numVal * count;
                          });
                          const cutMean = cutSum / cutBase;
                          const cutVariance = Math.max(cutSumSquares / cutBase - cutMean * cutMean, 0);
                          cutStatValue = Math.sqrt(cutVariance);
                        } else if (stat.key === 'min') {
                          cutStatValue = Infinity;
                          sortedNumericValues.forEach(numVal => {
                            const valueKey = numVal.toString();
                            if ((numericData[valueKey]?.[bannerCol.id]?.count || 0) > 0 && numVal < cutStatValue) {
                              cutStatValue = numVal;
                            }
                          });
                        } else if (stat.key === 'max') {
                          cutStatValue = -Infinity;
                          sortedNumericValues.forEach(numVal => {
                            const valueKey = numVal.toString();
                            if ((numericData[valueKey]?.[bannerCol.id]?.count || 0) > 0 && numVal > cutStatValue) {
                              cutStatValue = numVal;
                            }
                          });
                        }
                      }
                      
                      statRow.getCell(col).value = cutStatValue;
                      statRow.getCell(col).numFmt = (stat.key === 'sum' || stat.key === 'sumNoOutliers') ? '0' : '0.00';
                      statRow.getCell(col).alignment = { horizontal: 'center' };
                      statRow.getCell(col).fill = {
                        type: 'pattern',
                        pattern: 'solid',
                        fgColor: { argb: 'FFE8E8E8' }
                      };
                      statRow.getCell(col).border = {
                        top: { style: 'thin' },
                        bottom: { style: 'thin' },
                        left: { style: 'thin' },
                        right: { style: 'thin' }
                      };
                      col++;
                    });
                  }
                });
              }
            }
            
            tableNumber++;
            continue;
          }
          
          // Get response codes from banner table data or statements (for grid columns)
          let responseCodes: string[] = (() => {
            if (isMultiSelectGridColumnTable) {
              if (variable.statements && Object.keys(variable.statements).length > 0) {
                return Object.keys(variable.statements);
              }
              return Object.keys(activeGridColumnData || {});
            }
            if (isMultiSelectQuestionForCodes && multiSelectNoteItems.length > 0) {
              const bannerCodes = Object.keys(bannerTableData).filter(key => key !== 'total');
              return bannerCodes.length > 0 ? bannerCodes : multiSelectNoteItems.map((item) => item.code);
            }
            // For multi-select questions, also check variable.codes if bannerTableData is empty
            const codes = Object.keys(bannerTableData).filter(key => key !== 'total');
            if (codes.length === 0 && isMultiSelectQuestionForCodes && variable.codes && Object.keys(variable.codes).length > 0) {
              // Fall back to variable.codes if bannerTableData is empty
              const fallbackCodes = Object.keys(variable.codes);
              if (isB8Debug) {
                appendStatLog('[B8] Using fallback codes from variable.codes', {
                  variableName: variable.name,
                  fallbackCodes,
                  fallbackCodesLength: fallbackCodes.length
                });
              }
              return fallbackCodes;
            }
            // Debug for B8 only
            if (isB8Debug) {
              appendStatLog('[B8] Getting response codes', {
                variableName: variable.name,
                variableType: variable.type,
                isMultiSelectQuestion: isMultiSelectQuestionForCodes,
                bannerTableDataKeys: Object.keys(bannerTableData),
                codesReturned: codes,
                codesLength: codes.length,
                bannerTableDataEmpty: !bannerTableData || Object.keys(bannerTableData).length === 0,
                variableCodesKeys: variable.codes ? Object.keys(variable.codes) : [],
                firstCodeSample: codes.length > 0 ? getCodeDataForRow(codes[0]) : 'no codes'
              });
            }
            return codes;
          })();

          // Sort codes by frequency if enabled
          const isSortedByFrequency = getEffectiveSortByFrequency(variable);
          if (isSortedByFrequency) {
            responseCodes.sort((a, b) => {
              const aTotal = getCodeDataForRow(a)?.['total']?.count || 0;
              const bTotal = getCodeDataForRow(b)?.['total']?.count || 0;
              return bTotal - aTotal;
            });
            responseCodes = applyHoldOrdering(responseCodes, variable.name, code => code);
          }

          // Check for nets (will be added after response rows, before stats)
          const netCodes = isMultiSelectGridColumnTable ? [] : (netSummaryTableSelectedCodes[variable.name] || []);
          const firstEntry = Object.entries(isMultiSelectGridColumnTable ? (activeGridColumnData || {}) : bannerTableData)[0];

          // Calculate stat letters for all codes before rendering (for regular Single/Multi Select tables)
          const allStatLettersRegular: Record<string, Record<number, { letter: string; is95: boolean }[]>> = {};
          const isS6DebugRegular = variable.name === 'S6';

          if (isS6DebugRegular && shouldDebugStats()) {
            appendStatLog('[S6] ≡ƒÜÇ Starting stat letter calculation', {
              variable: variable.name,
              type: variable.type,
              totalBase,
              codesCount: responseCodes.length
            });

            // Show cutBases for debugging
            const cutBasesInfo: Record<string, any> = {};
            bannerCols.forEach((col, idx) => {
              cutBasesInfo[`col${idx}_${col.title}`] = cutBases[col.id] || 0;
            });
            appendStatLog('[S6] ≡ƒôè cutBases', cutBasesInfo);
          }

          responseCodes.forEach(code => {
            const codeData = getCodeDataForRow(code);
            const totalPct = codeData['total']?.percentage || 0;
            const totalCount = codeData['total']?.count || 0;

            if (isS6DebugRegular && shouldDebugStats()) {
              appendStatLog('[S6] ≡ƒôè Processing code', {
                code,
                label: getRowLabelForCode(code),
                totalPct,
                totalCount,
                totalBase
              });
            }

            const codeStatLetters: Record<number, { letter: string; is95: boolean }[]> = {};

            bannerCols.forEach((thisCol, colIdx) => {
              const thisPct = codeData[thisCol.id]?.percentage || 0;
              const thisCount = codeData[thisCol.id]?.count || 0;
              const thisBase = cutBases[thisCol.id] || 0;

              const statLettersForCol: { letter: string; is95: boolean }[] = [];

              // Within-group comparisons ONLY
              bannerCols.forEach((otherCol, otherIdx) => {
                if (otherIdx === colIdx) return;
                if (otherCol.groupIdx !== thisCol.groupIdx) return;

                const otherPct = codeData[otherCol.id]?.percentage || 0;
                const otherBase = cutBases[otherCol.id] || 0;

                if (thisPct > otherPct) {
                  const { is95, is90 } = isSignificant(thisPct, thisBase, otherPct, otherBase);

                  if (isS6DebugRegular && shouldDebugStats()) {
                    appendStatLog('[S6] Γ£à within-group comparison', {
                      code,
                      thisCol: thisCol.title,
                      otherCol: otherCol.title,
                      thisPct,
                      thisBase,
                      otherPct,
                      otherBase,
                      is95,
                      is90,
                      letterWouldBe: String.fromCharCode(65 + otherIdx)
                    });
                  }

                  if (significanceLevel === 95) {
                    if (is95) statLettersForCol.push({ letter: String.fromCharCode(65 + otherIdx), is95: true });
                  } else {
                    if (is95) {
                      statLettersForCol.push({ letter: String.fromCharCode(65 + otherIdx), is95: true });
                    } else if (is90) {
                      statLettersForCol.push({ letter: String.fromCharCode(97 + otherIdx), is95: false });
                    }
                  }
                }
              });

              codeStatLetters[colIdx] = statLettersForCol;
            });

            allStatLettersRegular[code] = codeStatLetters;

            if (isS6DebugRegular && shouldDebugStats()) {
              const letterStrings: Record<string, string> = {};
              let hasAnyLetters = false;
              Object.keys(codeStatLetters).forEach(k => {
                const letters = codeStatLetters[Number(k)] || [];
                const letterStr = letters.map(l => l.letter).join('');
                if (letterStr) {
                  letterStrings[`col${k}_${bannerCols[Number(k)]?.title}`] = letterStr;
                  hasAnyLetters = true;
                }
              });
              if (hasAnyLetters) {
                appendStatLog(`[S6] Γ£à Stat letters found for code ${code}`, letterStrings);
              } else {
                appendStatLog(`[S6] Γ¥î NO stat letters for code ${code}`, { code, label: getRowLabelForCode(code) });
              }
            }
          });

          // Add regular response rows (count + percentage rows for each response)
          // Ensure we have codes to write - if responseCodes is empty but variable has codes, use them
          if (responseCodes.length === 0 && isMultiSelectQuestionForCodes && variable.codes && Object.keys(variable.codes).length > 0) {
            responseCodes = Object.keys(variable.codes);
            if (isB8Debug) {
              appendStatLog('[B8] Using variable.codes as fallback for responseCodes', {
                variableName: variable.name,
                responseCodes: responseCodes
              });
            }
          }
          
          responseCodes.forEach(code => {
            const codeData = getCodeDataForRow(code);
            const codeLabel = getRowLabelForCode(code);

            // Count row
            const countRow = dataCutsWorksheet.getRow(currentRow++);
            countRow.getCell(2).value = codeLabel;
            countRow.getCell(2).border = {
              top: { style: 'thin' },
              bottom: { style: 'thin' },
              left: { style: 'thin' },
              right: { style: 'thin' }
            };

            // Total count
            const totalCount = codeData['total']?.count || 0;
            countRow.getCell(3).value = totalCount;
            countRow.getCell(3).alignment = { horizontal: 'center' };
            countRow.getCell(3).border = {
              top: { style: 'thin' },
              bottom: { style: 'thin' },
              left: { style: 'thin' },
              right: { style: 'thin' }
            };

            // Banner cut counts
            let col = 4;
            bannerCols.forEach((bannerCol, colIdx) => {
              const cutCount = codeData[bannerCol.id]?.count || 0;
              const countCell = countRow.getCell(col);
              countCell.value = cutCount;
              countCell.alignment = { horizontal: 'center' };

              // Add blue highlighting if this cell has stat letters
              const statLettersForCode = allStatLettersRegular[code] || {};
              const statLetters = statLettersForCode[colIdx] || [];
              if (statLetters.length > 0) {
                countCell.fill = {
                  type: 'pattern',
                  pattern: 'solid',
                  fgColor: { argb: 'FFE6F3FF' }
                };
              }

              countCell.border = {
                top: { style: 'thin' },
                bottom: { style: 'thin' },
                left: { style: 'thin' },
                right: { style: 'thin' }
              };
              col++;
            });

            // Percentage row
            const pctRow = dataCutsWorksheet.getRow(currentRow++);
            pctRow.getCell(2).value = '';
            pctRow.getCell(2).border = {
              top: { style: 'thin' },
              bottom: { style: 'thin' },
              left: { style: 'thin' },
              right: { style: 'thin' }
            };

            // Total percentage
            const totalPct = codeData['total']?.percentage || 0;
            const totalPctCell = pctRow.getCell(3);
            totalPctCell.value = totalPct / 100; // Store as decimal for percentage format
            totalPctCell.numFmt = percentageDecimals === 0 ? '0%' : percentageDecimals === 1 ? '0.0%' : '0.00%';
            totalPctCell.alignment = { horizontal: 'center' };
            totalPctCell.border = {
              top: { style: 'thin' },
              bottom: { style: 'thin' },
              left: { style: 'thin' },
              right: { style: 'thin' }
            };

            // Banner cut percentages
            col = 4;
            bannerCols.forEach((bannerCol, colIdx) => {
              const cutPct = codeData[bannerCol.id]?.percentage || 0;
              const cutPctCell = pctRow.getCell(col);
              cutPctCell.value = cutPct / 100; // Store as decimal for percentage format
              cutPctCell.numFmt = percentageDecimals === 0 ? '0%' : percentageDecimals === 1 ? '0.0%' : '0.00%';
              cutPctCell.alignment = { horizontal: 'center' };

              // Add blue highlighting if this cell has stat letters
              const statLettersForCode = allStatLettersRegular[code] || {};
              const statLetters = statLettersForCode[colIdx] || [];
              if (statLetters.length > 0) {
                cutPctCell.fill = {
                  type: 'pattern',
                  pattern: 'solid',
                  fgColor: { argb: 'FFE6F3FF' }
                };
              }

              cutPctCell.border = {
                top: { style: 'thin' },
                bottom: { style: 'thin' },
                left: { style: 'thin' },
                right: { style: 'thin' }
              };
              col++;
            });

            // Stat letters row (if any stat letters exist for this code)
            const statLettersForCode = allStatLettersRegular[code] || {};
            const hasAnyStatLettersForCode = Object.values(statLettersForCode).some(arr => arr && arr.length > 0);

            if (hasAnyStatLettersForCode) {
              const statRow = dataCutsWorksheet.getRow(currentRow++);
              statRow.getCell(2).value = '';
              statRow.getCell(2).border = {
                top: { style: 'thin' },
                bottom: { style: 'thin' },
                left: { style: 'thin' },
                right: { style: 'thin' }
              };

              // Total column - no stat letters for total
              statRow.getCell(3).value = '';
              statRow.getCell(3).border = {
                top: { style: 'thin' },
                bottom: { style: 'thin' },
                left: { style: 'thin' },
                right: { style: 'thin' }
              };

              // Banner cut stat letters
              col = 4;
              bannerCols.forEach((bannerCol, colIdx) => {
                const statLetters = statLettersForCode[colIdx] || [];
                const statLettersStr = statLetters.map(s => s.letter).join('');
                const statCell = statRow.getCell(col);
                statCell.value = statLettersStr;
                statCell.alignment = { horizontal: 'center', vertical: 'middle' };
                if (statLetters.length > 0) {
                  statCell.fill = {
                    type: 'pattern',
                    pattern: 'solid',
                    fgColor: { argb: 'FFE6F3FF' }
                  };
                }
                statCell.border = {
                  top: { style: 'thin' },
                  bottom: { style: 'thin' },
                  left: { style: 'thin' },
                  right: { style: 'thin' }
                };
                col++;
              });
            }
          });

          // Calculate stat letters for nets before rendering
          const allStatLettersNets: Record<string, Record<number, { letter: string; is95: boolean }[]>> = {};

          netCodes.forEach(net => {
            if (net.codes && net.codes.length > 0) {
              // Calculate net totals
              let netTotalCount = 0;
              const netCutCounts: Record<string, number> = {};
              bannerCols.forEach(col => { netCutCounts[col.id] = 0; });

              net.codes.forEach(code => {
                const codeData = getCodeDataForRow(code);
                if (codeData) {
                  netTotalCount += codeData['total']?.count || 0;
                  bannerCols.forEach(col => {
                    netCutCounts[col.id] += codeData[col.id]?.count || 0;
                  });
                }
              });

              // Calculate stat letters for this net
              const codeStatLetters: Record<number, { letter: string; is95: boolean }[]> = {};

              bannerCols.forEach((thisCol, colIdx) => {
                const thisCount = netCutCounts[thisCol.id] || 0;
                const thisBase = cutBases[thisCol.id] || 0;
                const thisPct = thisBase > 0 ? (thisCount / thisBase) * 100 : 0;
                const statLettersForCol: { letter: string; is95: boolean }[] = [];

                // Within-group comparisons ONLY
                bannerCols.forEach((otherCol, otherIdx) => {
                  if (otherIdx === colIdx) return;
                  if (otherCol.groupIdx !== thisCol.groupIdx) return;

                  const otherCount = netCutCounts[otherCol.id] || 0;
                  const otherBase = cutBases[otherCol.id] || 0;
                  const otherPct = otherBase > 0 ? (otherCount / otherBase) * 100 : 0;

                  if (thisPct > otherPct) {
                    const { is95, is90 } = isSignificant(thisPct, thisBase, otherPct, otherBase);

                    if (significanceLevel === 95) {
                      if (is95) statLettersForCol.push({ letter: String.fromCharCode(65 + otherIdx), is95: true });
                    } else {
                      if (is95) {
                        statLettersForCol.push({ letter: String.fromCharCode(65 + otherIdx), is95: true });
                      } else if (is90) {
                        statLettersForCol.push({ letter: String.fromCharCode(97 + otherIdx), is95: false });
                      }
                    }
                  }
                });

                codeStatLetters[colIdx] = statLettersForCol;
              });

              allStatLettersNets[net.name] = codeStatLetters;
            }
          });

          // Add net rows after response rows, before stats
          netCodes.forEach(net => {
            if (net.codes && net.codes.length > 0) {
              const STATS_GREY = 'FFE8E8E8';
              // Count row
              const countRow = dataCutsWorksheet.getRow(currentRow++);
              countRow.getCell(2).value = `NET: ${net.name}`;
              countRow.getCell(2).font = { bold: false };
              countRow.getCell(2).fill = {
                type: 'pattern',
                pattern: 'solid',
                fgColor: { argb: STATS_GREY }
              };
              countRow.getCell(2).border = {
                top: { style: 'thin' },
                bottom: { style: 'thin' },
                left: { style: 'thin' },
                right: { style: 'thin' }
              };

              // Calculate net totals
              let netTotalCount = 0;
              const netCutCounts: Record<string, number> = {};
              bannerCols.forEach(col => { netCutCounts[col.id] = 0; });

              net.codes.forEach(code => {
                const codeData = getCodeDataForRow(code);
                if (codeData) {
                  netTotalCount += codeData['total']?.count || 0;
                  bannerCols.forEach(col => {
                    netCutCounts[col.id] += codeData[col.id]?.count || 0;
                  });
                }
              });

              // Total count
              countRow.getCell(3).value = netTotalCount;
              countRow.getCell(3).alignment = { horizontal: 'center' };
              countRow.getCell(3).fill = {
                type: 'pattern',
                pattern: 'solid',
                fgColor: { argb: STATS_GREY }
              };
              countRow.getCell(3).border = {
                top: { style: 'thin' },
                bottom: { style: 'thin' },
                left: { style: 'thin' },
                right: { style: 'thin' }
              };

              // Banner cut counts
              let col = 4;
              bannerCols.forEach((bannerCol, colIdx) => {
                const countCell = countRow.getCell(col);
                countCell.value = netCutCounts[bannerCol.id];
                countCell.alignment = { horizontal: 'center' };
                countCell.fill = {
                  type: 'pattern',
                  pattern: 'solid',
                  fgColor: { argb: STATS_GREY }
                };

                // Add blue highlighting if this cell has stat letters
                const statLettersForCode = allStatLettersNets[net.name] || {};
                const statLetters = statLettersForCode[colIdx] || [];
                if (statLetters.length > 0) {
                  countCell.fill = {
                    type: 'pattern',
                    pattern: 'solid',
                    fgColor: { argb: 'FFE6F3FF' }
                  };
                }

                countCell.border = {
                  top: { style: 'thin' },
                  bottom: { style: 'thin' },
                  left: { style: 'thin' },
                  right: { style: 'thin' }
                };
                col++;
              });

              // Percentage row
              const pctRow = dataCutsWorksheet.getRow(currentRow++);
              pctRow.getCell(2).value = '';
              pctRow.getCell(2).fill = {
                type: 'pattern',
                pattern: 'solid',
                fgColor: { argb: STATS_GREY }
              };
              pctRow.getCell(2).border = {
                top: { style: 'thin' },
                bottom: { style: 'thin' },
                left: { style: 'thin' },
                right: { style: 'thin' }
              };

              // Total percentage
              const totalPct = totalBase > 0 ? (netTotalCount / totalBase) * 100 : 0;
              const totalPctCell = pctRow.getCell(3);
              totalPctCell.value = totalPct / 100; // Store as decimal for percentage format
              totalPctCell.numFmt = percentageDecimals === 0 ? '0%' : percentageDecimals === 1 ? '0.0%' : '0.00%';
              totalPctCell.alignment = { horizontal: 'center' };
              totalPctCell.fill = {
                type: 'pattern',
                pattern: 'solid',
                fgColor: { argb: STATS_GREY }
              };
              totalPctCell.border = {
                top: { style: 'thin' },
                bottom: { style: 'thin' },
                left: { style: 'thin' },
                right: { style: 'thin' }
              };

              // Banner cut percentages
              col = 4;
              bannerCols.forEach((bannerCol, colIdx) => {
                const cutPct = cutBases[bannerCol.id] > 0 ? (netCutCounts[bannerCol.id] / cutBases[bannerCol.id]) * 100 : 0;
                const cutPctCell = pctRow.getCell(col);
                cutPctCell.value = cutPct / 100; // Store as decimal for percentage format
                cutPctCell.numFmt = percentageDecimals === 0 ? '0%' : percentageDecimals === 1 ? '0.0%' : '0.00%';
                cutPctCell.alignment = { horizontal: 'center' };
                cutPctCell.fill = {
                  type: 'pattern',
                  pattern: 'solid',
                  fgColor: { argb: STATS_GREY }
                };

                // Add blue highlighting if this cell has stat letters
                const statLettersForCode = allStatLettersNets[net.name] || {};
                const statLetters = statLettersForCode[colIdx] || [];
                if (statLetters.length > 0) {
                  cutPctCell.fill = {
                    type: 'pattern',
                    pattern: 'solid',
                    fgColor: { argb: 'FFE6F3FF' }
                  };
                }

                cutPctCell.border = {
                  top: { style: 'thin' },
                  bottom: { style: 'thin' },
                  left: { style: 'thin' },
                  right: { style: 'thin' }
                };
                col++;
              });

              // Stat letters row
              const statLettersForCode = allStatLettersNets[net.name] || {};
              const hasAnyStatLettersForCode = Object.values(statLettersForCode).some(arr => arr && arr.length > 0);

              if (hasAnyStatLettersForCode) {
                const statRow = dataCutsWorksheet.getRow(currentRow++);
                statRow.getCell(2).value = '';
                statRow.getCell(2).border = {
                  top: { style: 'thin' },
                  bottom: { style: 'thin' },
                  left: { style: 'thin' },
                  right: { style: 'thin' }
                };

                statRow.getCell(3).value = '';
                statRow.getCell(3).border = {
                  top: { style: 'thin' },
                  bottom: { style: 'thin' },
                  left: { style: 'thin' },
                  right: { style: 'thin' }
                };

                col = 4;
                bannerCols.forEach((bannerCol, colIdx) => {
                  const statLetters = statLettersForCode[colIdx] || [];
                  const statLettersStr = statLetters.map(s => s.letter).join('');
                  const statCell = statRow.getCell(col);
                  statCell.value = statLettersStr;
                  statCell.alignment = { horizontal: 'center', vertical: 'middle' };
                  if (statLetters.length > 0) {
                    statCell.fill = {
                      type: 'pattern',
                      pattern: 'solid',
                      fgColor: { argb: 'FFE6F3FF' }
                    };
                  }
                  statCell.border = {
                    top: { style: 'thin' },
                    bottom: { style: 'thin' },
                    left: { style: 'thin' },
                    right: { style: 'thin' }
                  };
                  col++;
                });
              }
            }
          });

          // Add stats rows if enabled
          const statsKey = variable.name;
          const statsSelections = getStatsSelectionsForVariable(statsKey);
          const isNumeric = variable.type?.toLowerCase().includes('numeric');
          const isSingleSelect = variable.type?.toLowerCase().includes('single select') &&
                                 !variable.type?.toLowerCase().includes('grid');

          // Numeric stats helper (for numeric questions)
          const getNumericStatsForColumn = (columnId: string): NumericStatsSummary | null => {
            if (!isNumeric) return null;
            const entries = Object.entries(bannerTableData || {});
            const numericEntries = entries
              .map(([valueKey, valueData]) => {
                const numericValue = parseFloat(valueKey);
                if (isNaN(numericValue)) return null;
                const columnData = columnId === 'total'
                  ? (valueData as any)['total']
                  : (valueData as any)[columnId];
                const count = columnData?.count || 0;
                return count > 0 ? { value: numericValue, count } : null;
              })
              .filter((entry): entry is { value: number; count: number } => !!entry)
              .sort((a, b) => a.value - b.value);
            if (!numericEntries.length) return null;

            let totalCount = 0;
            let sum = 0;
            let sumSquares = 0;
            let min = Infinity;
            let max = -Infinity;
            let modeValue: number | null = null;
            let modeCount = -1;

            numericEntries.forEach(({ value, count }) => {
              totalCount += count;
              sum += value * count;
              sumSquares += value * value * count;
              if (value < min) min = value;
              if (value > max) max = value;
              if (count > modeCount) {
                modeCount = count;
                modeValue = value;
              }
            });
            if (totalCount === 0) return null;

            const mean = sum / totalCount;
            const variance = Math.max(sumSquares / totalCount - mean * mean, 0);
            const stdDev = Math.sqrt(variance);

            const target1 = Math.floor((totalCount - 1) / 2);
            const target2 = Math.floor(totalCount / 2);
            let cumulative = 0;
            let medianVal1: number | null = null;
            let medianVal2: number | null = null;
            numericEntries.forEach(({ value, count }) => {
              const prev = cumulative;
              cumulative += count;
              if (medianVal1 === null && target1 < cumulative) {
                medianVal1 = value;
              }
              if (medianVal2 === null && target2 < cumulative) {
                medianVal2 = value;
              }
            });
            const median = totalCount % 2 === 0 && medianVal1 !== null && medianVal2 !== null
              ? (medianVal1 + medianVal2) / 2
              : (medianVal2 ?? medianVal1 ?? 0);

            let sumNoOutliers = sum;
            let meanNoOutliers = mean;
            if (stdDev > 0) {
              let filteredSum = 0;
              let filteredCount = 0;
              const threshold = 2 * stdDev;
              numericEntries.forEach(({ value, count }) => {
                if (Math.abs(value - mean) <= threshold) {
                  filteredSum += value * count;
                  filteredCount += count;
                }
              });
              if (filteredCount > 0) {
                sumNoOutliers = filteredSum;
                meanNoOutliers = filteredSum / filteredCount;
              }
            }

            return {
              sum,
              mean,
              median,
              mode: modeValue ?? 0,
              stdDev,
              max,
              min,
              meanNoOutliers,
              sumNoOutliers,
            };
          };
          const totalNumericStats = isNumeric ? getNumericStatsForColumn('total') : null;
          const cutNumericStats: Record<string, NumericStatsSummary | null> = {};
          if (isNumeric) {
            bannerCols.forEach(col => {
              cutNumericStats[col.id] = getNumericStatsForColumn(col.id);
            });
          }

          // Show stats for numeric questions OR single select questions (which can have numeric codes)
          if ((isNumeric || isSingleSelect) && Object.values(statsSelections).some(v => v)) {
            const STATS_GREY = 'FFE8E8E8'; // Lighter grey for base and stats rows
            
            // Define stats to show (exclude sum for single select)
            const statsToShow = [
              { key: 'sum', label: 'Sum', format: '0' },
              { key: 'mean', label: 'Mean', format: '0.00' },
              { key: 'meanNoOutliers', label: 'Mean (Outliers Removed)', format: '0.00' },
              { key: 'sumNoOutliers', label: 'Sum (Outliers Removed)', format: '0' },
              { key: 'median', label: 'Median', format: '0.00' },
              { key: 'mode', label: 'Mode', format: '0' },
              { key: 'stdDev', label: 'Std Dev', format: '0.00' },
              { key: 'max', label: 'Max', format: '0' },
              { key: 'min', label: 'Min', format: '0' }
            ].filter(stat => {
              // Exclude sum and sumNoOutliers for single select questions
              if (isSingleSelect && (stat.key === 'sum' || stat.key === 'sumNoOutliers')) {
                return false;
              }
              return true;
            });

            // Helper to calculate weighted mean for single select tables
            const calculateSingleSelectMean = (tableData: any, cutId?: string): number => {
              if (!tableData) return 0;

              let totalWeightedValue = 0;
              let totalCount = 0;

              const codes = variable.codes ? Object.keys(variable.codes) : Object.keys(tableData || {});

              codes.forEach(code => {
                const codeValue = getCodeValueForMean(variable, code);
                if (codeValue === null) {
                  return;
                }
                const codeEntry = tableData[code];
                const count = cutId ? (codeEntry?.[cutId]?.count || 0) : (codeEntry?.total?.count || 0);
                totalWeightedValue += codeValue * count;
                totalCount += count;
              });

              return totalCount > 0 ? totalWeightedValue / totalCount : 0;
            };

            // Add each selected stat as a row
            statsToShow.forEach(stat => {
              if (statsSelections[stat.key]) {
                const statRow = dataCutsWorksheet.getRow(currentRow++);

                // Stat label
                statRow.getCell(2).value = stat.label;
                statRow.getCell(2).font = { bold: false };
                statRow.getCell(2).fill = {
                  type: 'pattern',
                  pattern: 'solid',
                  fgColor: { argb: STATS_GREY }
                };
                statRow.getCell(2).border = {
                  top: { style: 'thin' },
                  bottom: { style: 'thin' },
                  left: { style: 'thin' },
                  right: { style: 'thin' }
                };

                // Calculate stat value for Total
                let totalStatValue: number;
                if (isNumeric) {
                  totalStatValue = totalNumericStats ? (totalNumericStats[stat.key as keyof typeof totalNumericStats] as number ?? 0) : 0;
                } else if (isSingleSelect && stat.key === 'mean') {
                  totalStatValue = calculateSingleSelectMean(bannerTableData);
                } else {
                  // Get from banner table data for numeric questions or other stats
                  totalStatValue = firstEntry && firstEntry[1] ? (firstEntry[1] as any)['total']?.[stat.key] || 0 : 0;
                }

                statRow.getCell(3).value = totalStatValue;
                statRow.getCell(3).numFmt = stat.format;
                statRow.getCell(3).alignment = { horizontal: 'center' };
                statRow.getCell(3).fill = {
                  type: 'pattern',
                  pattern: 'solid',
                  fgColor: { argb: STATS_GREY }
                };
                statRow.getCell(3).border = {
                  top: { style: 'thin' },
                  bottom: { style: 'thin' },
                  left: { style: 'thin' },
                  right: { style: 'thin' }
                };

                // Banner cut stats
                let col = 4;
                bannerCols.forEach(bannerCol => {
                  let cutStatValue: number;

                  if (isNumeric) {
                    const colStats = cutNumericStats[bannerCol.id];
                    cutStatValue = colStats ? (colStats[stat.key as keyof typeof colStats] as number ?? 0) : 0;
                  } else if (isSingleSelect && stat.key === 'mean') {
                    cutStatValue = calculateSingleSelectMean(bannerTableData, bannerCol.id);
                  } else {
                    // Get from banner table data
                    cutStatValue = firstEntry && firstEntry[1] ? (firstEntry[1] as any)[bannerCol.id]?.[stat.key] || 0 : 0;
                  }

                  statRow.getCell(col).value = cutStatValue;
                  statRow.getCell(col).numFmt = stat.format;
                  statRow.getCell(col).alignment = { horizontal: 'center' };
                  statRow.getCell(col).fill = {
                    type: 'pattern',
                    pattern: 'solid',
                    fgColor: { argb: STATS_GREY }
                  };
                  statRow.getCell(col).border = {
                    top: { style: 'thin' },
                    bottom: { style: 'thin' },
                    left: { style: 'thin' },
                    right: { style: 'thin' }
                  };
                  col++;
                });
              }
            });
          }

          if (bannerCols.length > 0) {
            // Add comparison groups details section
            // Build comparison groups string based on banner groups
            const groupMap = new Map<number, number[]>();
            bannerCols.forEach((col, idx) => {
              const groupIdx = col.groupIdx;
              if (!groupMap.has(groupIdx)) {
                groupMap.set(groupIdx, []);
              }
              groupMap.get(groupIdx)!.push(idx);
            });

            const comparisonGroups = Array.from(groupMap.values())
              .map(colIndices =>
                colIndices.map(idx => String.fromCharCode(65 + idx)).join('')
              )
              .join('/');

            // Comparison groups row
            const compGroupsRow = dataCutsWorksheet.getRow(currentRow++);
            compGroupsRow.getCell(2).value = `Comparison Groups: ${comparisonGroups}`;
            compGroupsRow.getCell(2).font = { size: 9, italic: true };

            // Uppercase explanation row
            const upperRow = dataCutsWorksheet.getRow(currentRow++);
            upperRow.getCell(2).value = 'Uppercase letters indicate significance at the 95% level.';
            upperRow.getCell(2).font = { size: 9, italic: true };

            // Lowercase explanation row (only if significance level is 90)
            if (significanceLevel === 90) {
              const lowerRow = dataCutsWorksheet.getRow(currentRow++);
              lowerRow.getCell(2).value = 'Lowercase letters indicate significance at the 90% level.';
              lowerRow.getCell(2).font = { size: 9, italic: true };
            }
          }

          tableNumber++;
        }
      }

      // Set column widths for Data Cuts
      dataCutsWorksheet.getColumn(1).width = 5; // Empty column A
      dataCutsWorksheet.getColumn(2).width = 40; // Response labels
      dataCutsWorksheet.getColumn(3).width = 15; // Total column
      // Banner cut columns
      for (let i = 0; i < bannerCols.length; i++) {
        dataCutsWorksheet.getColumn(4 + i).width = 15;
      }

      // Populate Table of Contents
      if (includeToc && tocWorksheet) {
        // Set column widths: A: 2.29, B: 14.29, C: 39.29, D: 59.29
        // IMPORTANT: Set all column widths BEFORE positioning the logo
        tocWorksheet.getColumn(1).width = 2.29;
        tocWorksheet.getColumn(2).width = 14.29;
        tocWorksheet.getColumn(3).width = 39.29;
        tocWorksheet.getColumn(4).width = 59.29;
      
      // Merge cells B1:C3 for title and project name
      tocWorksheet.mergeCells(1, 2, 3, 3); // Merge B1:C3 (row 1-3, col 2-3)
      const titleBlockCell = tocWorksheet.getRow(1).getCell(2);
      const projectName = selectedProject?.name || '';
      
      // Use rich text to format title and project name differently
      if (projectName) {
        titleBlockCell.value = {
          richText: [
            { text: 'Table of Contents', font: { bold: true, size: 14 } },
            { text: '\n' },
            { text: projectName, font: { italic: true, size: 12, bold: false } }
          ]
        };
      } else {
        titleBlockCell.value = 'Table of Contents';
        titleBlockCell.font = { bold: true, size: 14 };
      }
      
      titleBlockCell.alignment = { 
        vertical: 'top', 
        horizontal: 'left',
        wrapText: true 
      };
      titleBlockCell.fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'FFFFFFFF' }
      };
      
      // Merge cells D1:D3 for logo
      tocWorksheet.mergeCells(1, 4, 3, 4); // Merge D1:D3 (row 1-3, col 4)
      const logoCell = tocWorksheet.getRow(1).getCell(4);
      logoCell.fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'FFFFFFFF' }
      };
      
      // Add logo to the merged cell D1:D3 (top right aligned)
      let logoImageId: number | null = null;
      try {
        const logoResponse = await fetch('/CogDashLogo.png');
        if (logoResponse.ok) {
          // Resize the image to target dimensions without heavy compression
          const logoBlob = await logoResponse.blob();
          const img = new Image();
          const imgUrl = URL.createObjectURL(logoBlob);
          
          await new Promise((resolve, reject) => {
            img.onload = resolve;
            img.onerror = reject;
            img.src = imgUrl;
          });
          
          // Create canvas to resize (not compress heavily)
          const canvas = document.createElement('canvas');
          const ctx = canvas.getContext('2d');
          if (!ctx) throw new Error('Could not get canvas context');
          
          // Set canvas size to target dimensions (2.02 x 0.52 inches at 96 DPI)
          const logoWidthPx = 2.02 * 96;
          const logoHeightPx = 0.52 * 96;
          canvas.width = logoWidthPx;
          canvas.height = logoHeightPx;
          
          // Use high-quality image rendering
          ctx.imageSmoothingEnabled = true;
          ctx.imageSmoothingQuality = 'high';
          
          // Draw and resize the image
          ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
          
          // Convert to PNG blob with high quality (minimal compression)
          const resizedBlob = await new Promise<Blob>((resolve, reject) => {
            canvas.toBlob((blob) => {
              if (blob) resolve(blob);
              else reject(new Error('Failed to resize image'));
            }, 'image/png', 1.0); // Maximum quality
          });
          
          URL.revokeObjectURL(imgUrl);
          
          // Convert resized blob to buffer
          const logoBuffer = await resizedBlob.arrayBuffer();
          const buffer = typeof Buffer !== 'undefined' 
            ? Buffer.from(logoBuffer) 
            : new Uint8Array(logoBuffer);
          
          logoImageId = workbook.addImage({
            buffer: buffer as any,
            extension: 'png',
          });
          
          // Position logo so its right edge aligns with the end of column D
          // Column widths: A: 2.29, B: 14.29, C: 39.29, D: 59.29
          // Total width to end of column D: 115.16 column units
          const colAWidth = tocWorksheet.getColumn(1).width || 2.29;
          const colBWidth = tocWorksheet.getColumn(2).width || 14.29;
          const colCWidth = tocWorksheet.getColumn(3).width || 39.29;
          const colDWidth = tocWorksheet.getColumn(4).width || 59.29;
          
          // ExcelJS positioning: ext.width is in pixels, col positioning uses column indices (can be fractional)
          // Excel column width: 1 unit = width of one character in default font (Calibri 11pt)
          // At 96 DPI: 1 column unit Γëê 7 pixels (this is the standard Excel conversion)
          
          // Calculate total pixel width to end of column D
          const totalWidthToEndOfDInColumnUnits = colAWidth + colBWidth + colCWidth + colDWidth;
          const totalWidthToEndOfDInPixels = totalWidthToEndOfDInColumnUnits * 7;
          
          // Calculate where the left edge of the logo should be (in pixels from start)
          const logoLeftEdgeInPixels = totalWidthToEndOfDInPixels - logoWidthPx;
          
          // Convert pixel position to column index
          // Column indices: A=0-1, B=1-2, C=2-3, D=3-4
          // Each column's pixel width = column width * 7
          let accumulatedPixels = 0;
          let leftEdgeCol = 0;
          
          // Check which column contains the left edge
          const colAPixels = colAWidth * 7;
          if (logoLeftEdgeInPixels <= accumulatedPixels + colAPixels) {
            // Logo starts in column A
            leftEdgeCol = 0 + (logoLeftEdgeInPixels - accumulatedPixels) / colAPixels;
          } else {
            accumulatedPixels += colAPixels;
            const colBPixels = colBWidth * 7;
            if (logoLeftEdgeInPixels <= accumulatedPixels + colBPixels) {
              // Logo starts in column B
              leftEdgeCol = 1 + (logoLeftEdgeInPixels - accumulatedPixels) / colBPixels;
            } else {
              accumulatedPixels += colBPixels;
              const colCPixels = colCWidth * 7;
              if (logoLeftEdgeInPixels <= accumulatedPixels + colCPixels) {
                // Logo starts in column C
                leftEdgeCol = 2 + (logoLeftEdgeInPixels - accumulatedPixels) / colCPixels;
              } else {
                accumulatedPixels += colCPixels;
                const colDPixels = colDWidth * 7;
                // Logo starts in column D
                leftEdgeCol = 3 + (logoLeftEdgeInPixels - accumulatedPixels) / colDPixels;
              }
            }
          }
          
          tocWorksheet.addImage(logoImageId, {
            tl: { col: leftEdgeCol, row: 0 }, // Top-left positioned so right edge aligns with col 4.0 (D/E border)
            ext: { width: logoWidthPx, height: logoHeightPx },
          });
        }
      } catch (err) {
        console.error('Error loading logo:', err);
      }
      
      // Set row heights for title block
      tocWorksheet.getRow(1).height = 20;
      tocWorksheet.getRow(2).height = 20;
      tocWorksheet.getRow(3).height = 20;
      
      let tocRow = 4; // Start at row 4 (rows 1-3 are title block)

      // TOC Headers
      const tocHeaderRow = tocWorksheet.getRow(tocRow++);
      tocHeaderRow.getCell(2).value = 'Table #'; // Shifted to column 2
      tocHeaderRow.getCell(3).value = 'Table Name'; // Shifted to column 3
      tocHeaderRow.getCell(4).value = 'Description'; // Shifted to column 4
      [2, 3, 4].forEach(col => {
        tocHeaderRow.getCell(col).font = { bold: true };
        tocHeaderRow.getCell(col).fill = {
          type: 'pattern',
          pattern: 'solid',
          fgColor: { argb: 'FFD14A2D' }
        };
        tocHeaderRow.getCell(col).font = { bold: true, color: { argb: 'FFFFFFFF' } };
        tocHeaderRow.getCell(col).border = {
          top: { style: 'thin' },
          bottom: { style: 'thin' },
          left: { style: 'thin' },
          right: { style: 'thin' }
        };
      });

      // TOC Entries with hyperlinks
      tablePositions.forEach(({ tableNumber, tableName, rowNumber, variable }) => {
        const tocEntryRow = tocWorksheet.getRow(tocRow++);

        // Table number with hyperlink
        tocEntryRow.getCell(2).value = { // Shifted to column 2
          text: `Table ${tableNumber}`,
          hyperlink: `#'Data Cuts'!A${rowNumber}`,
          tooltip: `Go to Table ${tableNumber}`
        };
        tocEntryRow.getCell(2).font = { color: { argb: 'FF0000FF' }, underline: true };
        tocEntryRow.getCell(2).fill = {
          type: 'pattern',
          pattern: 'solid',
          fgColor: { argb: 'FFFFFFFF' }
        };

        // Table name
        tocEntryRow.getCell(3).value = tableName; // Shifted to column 3
        tocEntryRow.getCell(3).fill = {
          type: 'pattern',
          pattern: 'solid',
          fgColor: { argb: 'FFFFFFFF' }
        };

        // Description
        const descriptionCell = tocEntryRow.getCell(4);
        descriptionCell.value = variable.description || variable.name; // Shifted to column 4
        descriptionCell.fill = {
          type: 'pattern',
          pattern: 'solid',
          fgColor: { argb: 'FFFFFFFF' }
        };

        // Column E - add space to stop text from overlapping
        tocEntryRow.getCell(5).value = ' ';
        tocEntryRow.getCell(5).fill = {
          type: 'pattern',
          pattern: 'solid',
          fgColor: { argb: 'FFFFFFFF' }
        };

        // Set borders only for columns 2-4 (not column E)
        [2, 3, 4].forEach(col => {
          tocEntryRow.getCell(col).border = {
            top: { style: 'thin' },
            bottom: { style: 'thin' },
            left: { style: 'thin' },
            right: { style: 'thin' }
          };
        });
      });

      // Set white fill for all cells in columns A-E (1-5) from row 1 to row after last table entry
      const lastTableRow = tocRow - 1; // Last row with table data
      const rowAfterLastTable = lastTableRow + 1; // Row after last table
      const headerRowNumber = tocHeaderRow.number;
        for (let rowNum = 1; rowNum <= rowAfterLastTable; rowNum++) {
          const row = tocWorksheet.getRow(rowNum);
          // Skip header row (it should stay red)
          if (rowNum !== headerRowNumber) {
            // Set white fill for columns 1-5 (A-E)
            for (let col = 1; col <= 5; col++) {
              const cell = row.getCell(col);
              cell.fill = {
                type: 'pattern',
                pattern: 'solid',
                fgColor: { argb: 'FFFFFFFF' }
              };
            }
          }
        }
      }

      // Column widths already set above before logo positioning
      // Column E width left at default (don't change it)

      const sampleSize = fullRawData.rows.filter((row: any) => {
        const recordValue = row['record'] ?? row['respno'] ?? row['Record'] ?? row['Respno'] ?? row['RECORD'] ?? row['RESPNO'];
        return recordValue !== null && recordValue !== undefined && recordValue !== '' &&
               !(typeof recordValue === 'string' && recordValue.trim() === '');
      }).length;

      return { workbook, sampleSize, debugInfo: tableDebugInfo };
    } catch (error) {
      console.error('Error generating workbook:', error);
      throw error;
    }
  }, [fullRawData, variableStatsSelections, variableSortByFrequency, netSummaryTableSelectedCodes, netSummaryTableRanges, hiddenFromBanners, questionnaireQuestions, selectedQuestionnaire, columnMapping, newBannerGroups, calculateBannerTableDataForVariable, getTablesForVariable, getEffectiveSortByFrequency, getCodeValueForMean, getStatsSelectionsForVariable, applyHoldOrdering, formatPercentage, significanceLevel, selectedProject, percentageDecimals, showStatDebug, appendStatLog]);

  const buildTabSpecsWorkbook = useCallback(
    (variablesSubset: Variable[], bannerGroupOverride?: BannerGroup) =>
      buildWorkbook(variablesSubset, bannerGroupOverride, { includeToc: true }),
    [buildWorkbook]
  );

  const buildTablesOnlyWorkbook = useCallback(
    async (variablesSubset: Variable[]) => {
      console.log('🟢 buildTablesOnlyWorkbook CALLED with', variablesSubset.length, 'variables');
      const totalOnlyBanner: BannerGroup = {
        id: '__total_only__',
        title: 'Total',
        groups: [],
        includeTotal: true,
        confidenceLevel: significanceLevel,
      };
      const workbook = new ExcelJS.Workbook();
      const byType = new Map<string, Variable[]>();
      variablesSubset.forEach((variable) => {
        const type = variable.type || 'Unknown';
        if (!byType.has(type)) {
          byType.set(type, []);
        }
        byType.get(type)!.push(variable);
      });
      const orderedTypes = Array.from(byType.keys()).sort((a, b) => a.localeCompare(b));
      let sampleSize = 0;
      let debugInfo: Record<string, TableDebugEntry> = {};
      for (const type of orderedTypes) {
        // Skip "Unknown" type from export
        if (type === 'Unknown') continue;

        const varsForType = byType.get(type) || [];
        if (varsForType.length === 0) continue;
        const result = await buildWorkbook(varsForType, totalOnlyBanner, {
          includeToc: false,
          workbook,
          sheetName: type,
        });
        sampleSize = result.sampleSize;
        debugInfo = { ...debugInfo, ...result.debugInfo };
      }
      return { workbook, sampleSize, debugInfo };
    },
    [buildWorkbook, significanceLevel]
  );

  return {
    buildTabSpecsWorkbook,
    buildTablesOnlyWorkbook,
  };
};
