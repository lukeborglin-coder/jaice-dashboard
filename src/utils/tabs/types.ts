export interface Variable {
  name: string;
  description: string;
  type: string;
  codes?: Record<string, string>;
  statements?: Record<string, string>;
  tags?: string[];
  isSummaryTable?: boolean;
  isScaleSummary?: boolean;
}

export type VariableStatsSelection = {
  t2b: boolean;
  m3b: boolean;
  mb: boolean;
  b2b: boolean;
  b3b: boolean;
  t3b: boolean;
  rated9_10: boolean;
  rated7_8: boolean;
  rated0_6: boolean;
  sum: boolean;
  mean: boolean;
  median: boolean;
  mode: boolean;
  stdDev: boolean;
  max: boolean;
  min: boolean;
  summaryTable: boolean;
  meanNoOutliers: boolean;
  sumNoOutliers: boolean;
};

export interface NetRange {
  name: string;
  low: string;
  high: string;
  enabled?: boolean;
  context?: 'stats' | 'summary';
}

export interface NetCodeSelection {
  name: string;
  codes: string[];
  enabled?: boolean;
}

export interface NetSummaryModalState {
  variableName: string | null;
  isOpen: boolean;
  name: string;
  low: string;
  high: string;
  error?: string;
  mode: 'range' | 'codes';
  responseOptions: Array<{ code: string; text: string }>;
  selectedCodes: string[];
  editingIndex: number | null;
}

export interface TableDebugEntry {
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

export type NumericStatsSummary = {
  sum: number;
  mean: number;
  median: number;
  mode: number;
  stdDev: number;
  max: number;
  min: number;
  meanNoOutliers: number;
  sumNoOutliers: number;
};

export interface PreviewTableSection {
  title: string;
  question: string;
  base: string;
  tableHtml: string;
}

export const NET_SUMMARY_MODAL_DEFAULT: NetSummaryModalState = {
  variableName: null,
  isOpen: false,
  name: '',
  low: '',
  high: '',
  mode: 'range',
  responseOptions: [],
  selectedCodes: [],
  editingIndex: null,
};

export const createDefaultStatsSelection = (): VariableStatsSelection => ({
  t2b: false,
  m3b: false,
  mb: false,
  b2b: false,
  b3b: false,
  t3b: false,
  rated9_10: false,
  rated7_8: false,
  rated0_6: false,
  sum: false,
  mean: false,
  median: false,
  mode: false,
  stdDev: false,
  max: false,
  min: false,
  summaryTable: false,
  meanNoOutliers: false,
  sumNoOutliers: false,
});

export const STAT_KEYS = Object.keys(createDefaultStatsSelection()) as (keyof VariableStatsSelection)[];

