import { getBaseQuestionNumber } from './questionHelpers';
import type { Variable } from './types';

export type NumericGridSummaryType = 'mean' | 'sum' | 'meanNoOutliers' | 'sumNoOutliers';

export type NumericGridStatement = { code: string; text: string };

export type NumericGridColumnOption = { code: string; text: string };

export interface NumericGridSummaryRow {
  code: string;
  text: string;
  base: number;
  columnValues: Record<string, number>;
  columnBases: Record<string, number>;
  columnStdDevs?: Record<string, number>;
}

export interface NumericGridSummaryModel {
  summaryType: NumericGridSummaryType;
  isMeanSummaryTable: boolean;
  tableName: string;
  columnsToUse: string[];
  columnLabels: Record<string, string>;
  rows: NumericGridSummaryRow[];
  totalValuesByColumn: Record<string, number>;
  allBasesEqual: boolean;
}

function normalizeCol(code: string): string {
  const trimmed = String(code || '').trim();
  if (!trimmed) return '';
  const lower = trimmed.toLowerCase();
  return lower.startsWith('c') ? lower : `c${lower}`;
}

function extractColumnCodeFromOptionId(id: string): string | null {
  const match = id.match(/_(c\d+)[^_]*SummaryTable$/i);
  if (match && match[1]) return match[1].toLowerCase();
  return null;
}

function parseNumericValue(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const numValue = parseFloat(String(value));
  if (Number.isNaN(numValue)) return null;
  return numValue;
}

function makeRespondentIndexAllowFn(respondentFilter: Set<number> | null | undefined): (idx: number) => boolean {
  if (!respondentFilter) return () => true;
  return (idx) => respondentFilter.has(idx);
}

function collectNumericValuesForVarNames(
  possibleVariableNames: string[],
  getVariableDataByExpectedHeader: (expectedHeader: string) => any,
  allowRespondentIndex: (idx: number) => boolean
): Array<{ value: number; respondentIndex: number }> {
  for (const varName of possibleVariableNames) {
    const data = getVariableDataByExpectedHeader(varName);
    if (!data || !Array.isArray(data.values)) continue;

    const out: Array<{ value: number; respondentIndex: number }> = [];
    data.values.forEach((v: unknown, idx: number) => {
      if (!allowRespondentIndex(idx)) return;
      const num = parseNumericValue(v);
      if (num === null) return;
      out.push({ value: num, respondentIndex: idx });
    });
    return out;
  }
  return [];
}

function calcMean(values: number[]): number {
  if (values.length === 0) return 0;
  const sum = values.reduce((acc, v) => acc + v, 0);
  return sum / values.length;
}

function calcStdDev(values: number[], mean: number): number {
  if (values.length === 0) return 0;
  const variance = values.reduce((acc, v) => acc + Math.pow(v - mean, 2), 0) / values.length;
  return Math.sqrt(variance);
}

function calcSampleStdDev(values: number[], mean: number): number {
  if (values.length <= 1) return 0;
  const variance = values.reduce((acc, v) => acc + Math.pow(v - mean, 2), 0) / (values.length - 1);
  return Math.sqrt(Math.max(0, variance));
}

function computeNumericCellStats(args: {
  variableName: string;
  statementCode: string;
  columnCode: string;
  summaryType: NumericGridSummaryType;
  getVariableDataByExpectedHeader: (expectedHeader: string) => any;
  allowRespondentIndex: (idx: number) => boolean;
}): { value: number; base: number; stdDev: number } {
  const { variableName, statementCode, columnCode, summaryType, getVariableDataByExpectedHeader, allowRespondentIndex } =
    args;

  const baseQuestionNumber = getBaseQuestionNumber(variableName);
  const possibleVariableNames = [
    `${baseQuestionNumber}_${statementCode}_${columnCode}`,
    `${baseQuestionNumber}${statementCode}${columnCode}`,
    `${baseQuestionNumber}_${statementCode}_${columnCode.replace(/^c/i, '')}`,
    `${baseQuestionNumber}${statementCode}${columnCode.replace(/^c/i, '')}`,
  ];

  const pairs = collectNumericValuesForVarNames(possibleVariableNames, getVariableDataByExpectedHeader, allowRespondentIndex);
  if (pairs.length === 0) return { value: 0, base: 0, stdDev: 0 };

  const allValues = pairs.map((p) => p.value);
  const base = allValues.length;

  // Outlier removal is calculated *per column* (matches prior behavior)
  if (summaryType === 'meanNoOutliers' || summaryType === 'sumNoOutliers') {
    const mean = calcMean(allValues);
    const stdDev = calcStdDev(allValues, mean);
    const valuesNoOutliers = allValues.filter((v) => Math.abs(v - mean) <= 2 * stdDev);
    if (valuesNoOutliers.length === 0) return { value: 0, base: 0, stdDev: 0 };

    if (summaryType === 'meanNoOutliers') {
      const m = calcMean(valuesNoOutliers);
      return { value: m, base: valuesNoOutliers.length, stdDev: calcSampleStdDev(valuesNoOutliers, m) };
    }
    // sumNoOutliers
    const s = valuesNoOutliers.reduce((acc, v) => acc + v, 0);
    const m = valuesNoOutliers.length > 0 ? s / valuesNoOutliers.length : 0;
    return { value: s, base: valuesNoOutliers.length, stdDev: calcSampleStdDev(valuesNoOutliers, m) };
  }

  if (summaryType === 'mean') {
    const m = calcMean(allValues);
    return { value: m, base, stdDev: calcSampleStdDev(allValues, m) };
  }
  // sum
  const s = allValues.reduce((acc, v) => acc + v, 0);
  const m = base > 0 ? s / base : 0;
  return { value: s, base, stdDev: calcSampleStdDev(allValues, m) };
}

function computeColumnsAndLabels(args: {
  variable: Variable;
  variableName: string;
  optionId: string;
  responseOptions: NumericGridColumnOption[];
}): { columnsToUse: string[]; columnLabels: Record<string, string> } {
  const { variable, variableName, optionId, responseOptions } = args;

  const selectedColumnCode = extractColumnCodeFromOptionId(optionId);
  const columnFromVarMatch = variableName.match(/c\d+/i);
  const columnFromVar = columnFromVarMatch ? normalizeCol(columnFromVarMatch[0]) : null;

  const columnCodesRaw: string[] = [];
  const columnLabels: Record<string, string> = {};

  if (variable.codes && Object.keys(variable.codes).length > 0) {
    Object.entries(variable.codes).forEach(([code, label]) => {
      columnCodesRaw.push(code);
      columnLabels[normalizeCol(code)] = String(label || code);
    });
  } else {
    responseOptions.forEach((opt) => {
      if (opt.code.startsWith('c') || /^\d+$/.test(opt.code)) {
        columnCodesRaw.push(opt.code);
        columnLabels[normalizeCol(opt.code)] = opt.text;
      }
    });
  }

  let normalizedColumns = columnCodesRaw.map(normalizeCol).filter(Boolean);
  if (columnFromVar && !normalizedColumns.includes(columnFromVar)) {
    normalizedColumns = [...normalizedColumns, columnFromVar];
  }

  let columnsToUse: string[] = normalizedColumns;
  if (selectedColumnCode && normalizedColumns.some((c) => c === normalizeCol(selectedColumnCode))) {
    columnsToUse = normalizedColumns.filter((c) => c === normalizeCol(selectedColumnCode));
  } else if (columnFromVar && normalizedColumns.some((c) => c === columnFromVar)) {
    columnsToUse = normalizedColumns.filter((c) => c === columnFromVar);
  } else if (columnFromVar) {
    columnsToUse = [columnFromVar];
  }

  return { columnsToUse, columnLabels };
}

function applySortAndHold(args: {
  rows: NumericGridSummaryRow[];
  columnsToUse: string[];
  sortByFrequency: boolean;
  holdCodes: string[];
}): NumericGridSummaryRow[] {
  const { rows, columnsToUse, sortByFrequency, holdCodes } = args;

  let sorted =
    sortByFrequency && columnsToUse.length > 0
      ? [...rows].sort((a, b) => (b.columnValues[columnsToUse[0]] || 0) - (a.columnValues[columnsToUse[0]] || 0))
      : [...rows];

  if (sortByFrequency && holdCodes.length > 0) {
    const holdSet = new Set(holdCodes);
    const remaining: NumericGridSummaryRow[] = [];
    const held: NumericGridSummaryRow[] = [];

    sorted.forEach((r) => {
      if (holdSet.has(r.code)) held.push(r);
      else remaining.push(r);
    });

    const heldOrdered: NumericGridSummaryRow[] = [];
    holdCodes.forEach((code) => {
      const match = held.find((r) => r.code === code);
      if (match) heldOrdered.push(match);
    });

    sorted = [...remaining, ...heldOrdered];
  }

  return sorted;
}

export function buildNumericGridSummaryModel(args: {
  variable: Variable;
  variableName: string;
  optionId: string;
  summaryType: NumericGridSummaryType;
  statements: NumericGridStatement[];
  responseOptions: NumericGridColumnOption[];
  getVariableDataByExpectedHeader: (expectedHeader: string) => any;
  respondentFilter?: Set<number> | null;
  sortByFrequency: boolean;
  holdCodes: string[];
}): NumericGridSummaryModel {
  const {
    variable,
    variableName,
    optionId,
    summaryType,
    statements,
    responseOptions,
    getVariableDataByExpectedHeader,
    respondentFilter,
    sortByFrequency,
    holdCodes,
  } = args;

  const allowRespondentIndex = makeRespondentIndexAllowFn(respondentFilter);

  const { columnsToUse, columnLabels } = computeColumnsAndLabels({
    variable,
    variableName,
    optionId,
    responseOptions,
  });

  const rowsUnsorted: NumericGridSummaryRow[] = statements.map((stmt) => {
    const baseQuestionNumber = getBaseQuestionNumber(variableName);

    // Base calculation per statement:
    // - Regular: any numeric value in any column
    // - Outliers removed: base counts respondents with at least one non-outlier value where outliers are defined
    //   using mean/std-dev across all values for this statement across columns
    let base = 0;

    if (summaryType === 'meanNoOutliers' || summaryType === 'sumNoOutliers') {
      const allValuesForStatement: Array<{ value: number; respondentIndex: number }> = [];

      columnsToUse.forEach((columnCode) => {
        const possibleVariableNames = [
          `${baseQuestionNumber}_${stmt.code}_${columnCode}`,
          `${baseQuestionNumber}${stmt.code}${columnCode}`,
          `${baseQuestionNumber}_${stmt.code}_${columnCode.replace(/^c/i, '')}`,
          `${baseQuestionNumber}${stmt.code}${columnCode.replace(/^c/i, '')}`,
        ];
        allValuesForStatement.push(
          ...collectNumericValuesForVarNames(possibleVariableNames, getVariableDataByExpectedHeader, allowRespondentIndex)
        );
      });

      if (allValuesForStatement.length > 0) {
        const values = allValuesForStatement.map((p) => p.value);
        const mean = calcMean(values);
        const stdDev = calcStdDev(values, mean);

        const respondentsWithNonOutliers = new Set<number>();
        allValuesForStatement.forEach(({ value, respondentIndex }) => {
          if (Math.abs(value - mean) <= 2 * stdDev) {
            respondentsWithNonOutliers.add(respondentIndex);
          }
        });
        base = respondentsWithNonOutliers.size;
      } else {
        base = 0;
      }
    } else {
      const statementRespondentSet = new Set<number>();

      columnsToUse.forEach((columnCode) => {
        const possibleVariableNames = [
          `${baseQuestionNumber}_${stmt.code}_${columnCode}`,
          `${baseQuestionNumber}${stmt.code}${columnCode}`,
          `${baseQuestionNumber}_${stmt.code}_${columnCode.replace(/^c/i, '')}`,
          `${baseQuestionNumber}${stmt.code}${columnCode.replace(/^c/i, '')}`,
        ];

        const pairs = collectNumericValuesForVarNames(possibleVariableNames, getVariableDataByExpectedHeader, allowRespondentIndex);
        pairs.forEach((p) => statementRespondentSet.add(p.respondentIndex));
      });

      base = statementRespondentSet.size;
    }

    const columnValues: Record<string, number> = {};
    const columnBases: Record<string, number> = {};
    const columnStdDevs: Record<string, number> = {};
    columnsToUse.forEach((colCode) => {
      const stats = computeNumericCellStats({
        variableName,
        statementCode: stmt.code,
        columnCode: colCode,
        summaryType,
        getVariableDataByExpectedHeader,
        allowRespondentIndex,
      });
      columnValues[colCode] = stats.value;
      columnBases[colCode] = stats.base;
      columnStdDevs[colCode] = stats.stdDev;
    });

    const isMeanSummaryTable = summaryType === 'mean' || summaryType === 'meanNoOutliers';
    return {
      code: stmt.code,
      text: stmt.text,
      base,
      columnValues,
      columnBases,
      columnStdDevs: isMeanSummaryTable ? columnStdDevs : undefined,
    };
  });

  const rows = applySortAndHold({ rows: rowsUnsorted, columnsToUse, sortByFrequency, holdCodes });

  const totalValuesByColumn: Record<string, number> = {};
  columnsToUse.forEach((colCode) => {
    totalValuesByColumn[colCode] = rows.reduce((sum, r) => sum + (r.columnValues[colCode] || 0), 0);
  });

  const allBasesEqual = rows.length > 0 && rows.every((r) => r.base === rows[0].base);
  const isMeanSummaryTable = summaryType === 'mean' || summaryType === 'meanNoOutliers';
  const tableName =
    summaryType === 'mean'
      ? 'Mean Summary'
      : summaryType === 'sum'
        ? 'Sum Summary'
        : summaryType === 'meanNoOutliers'
          ? 'Mean (Outliers Removed) Summary'
          : 'Sum (Outliers Removed) Summary';

  return {
    summaryType,
    isMeanSummaryTable,
    tableName,
    columnsToUse,
    columnLabels,
    rows,
    totalValuesByColumn,
    allBasesEqual,
  };
}

