// Data Quality Types

export type CheckTypeId = 'open_end' | 'straightlining' | 'speeding' | 'logic_consistency' | 'custom';
export type QuestionType = 'single' | 'multi' | 'open_end' | 'numeric' | 'grid' | 'ranking';
export type QACategory = 'good' | 'questionable' | 'remove';
export type FlagSeverity = 'low' | 'medium' | 'high';

export interface RuleConfig {
  threshold?: number;
  minLength?: number;
  maxLength?: number;
  validRange?: { min: number; max: number };
  [key: string]: unknown;
}

export interface QualityRule {
  id: string;
  questionNumber: string;
  questionText: string;
  questionType: QuestionType;
  checkTypeId: CheckTypeId;
  enabled: boolean;
  config: RuleConfig;
  createdAt?: string;
  updatedAt?: string;
}

export interface GlobalAggressiveness {
  openEndAggressiveness: number;
  straightliningAggressiveness: number;
  speedingAggressiveness: number;
  logicAggressiveness: number;
}

export interface QualityPlan {
  projectId: string;
  rules: QualityRule[];
  globalAggressiveness: GlobalAggressiveness;
  createdAt?: string;
  updatedAt?: string;
}

export interface QAFlag {
  checkTypeId: CheckTypeId;
  questionNumber?: string;
  severity: FlagSeverity;
  message: string;
  score: number;
  details?: Record<string, unknown>;
}

export interface QAResult {
  respno: string;
  projectId: string;
  category: QACategory;
  score: number;
  flags: QAFlag[];
  statusLocked: boolean;
  checkedAt?: string;
  updatedAt?: string;
}

export interface QAResultsSummary {
  total: number;
  byCategory: {
    good: number;
    questionable: number;
    remove: number;
  };
  percentages: {
    good: string;
    questionable: string;
    remove: string;
  };
}

export interface QADataRow {
  respno: string;
  projectId: string;
  columns: Record<string, unknown>;
  uploadedAt?: string;
}

export interface DataUpload {
  id: string;
  projectId: string;
  filename: string;
  uploadedAt: string;
  respondentCount: number;
}

export interface PaginatedResponse<T> {
  data: T[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

export interface QAResultsResponse {
  results: QAResult[];
  summary: QAResultsSummary;
  total: number;
  page: number;
  limit: number;
}

