/**
 * Data Tabulation Type Definitions
 */

// A single condition (variable + codes/condition)
export interface BannerCondition {
  id: string;
  variableName: string;
  codes: string[]; // For categorical: code values; For numeric: condition like ">=50"
}

// A condition group that can be combined with AND/OR
export interface BannerConditionGroup {
  conditions: BannerCondition[];
  operator: 'AND' | 'OR';
}

// SUM aggregation for numeric variables
export interface BannerSumCondition {
  id: string;
  type: 'SUM';
  variables: string[]; // Variable names to sum
  condition: string; // Condition like ">=50", "<100"
}

export interface BannerCut {
  id: string;
  title: string;
  // Legacy single variable support (for backwards compatibility)
  variableName: string;
  codes: string[];
  // New compound condition support
  conditionGroups?: BannerConditionGroup[];
  sumCondition?: BannerSumCondition;
}

export interface BannerSubGroup {
  id: string;
  title: string;
  cuts: BannerCut[];
}

export interface BannerGroup {
  id: string;
  title: string;
  groups: BannerSubGroup[];
  confidenceLevel?: 95 | 90 | 80; // Stat testing confidence level, default 95
  includeTotal?: boolean; // Whether to include Total column in banner tables, default true
}
