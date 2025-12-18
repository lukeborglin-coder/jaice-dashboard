import { Variable, VariableStatsSelection, createDefaultStatsSelection } from './types';
import { getTableOptionsForVariable } from './tableOptions';
import { getBaseQuestionNumber } from './questionHelpers';

/**
 * Returns default table IDs that should be selected for a variable based on its question type
 */
export function getDefaultTableSelectionsForVariable(
  variable: Variable,
  questionnaireQuestions: any[]
): Set<string> {
  const variableName = variable.name;
  const typeLower = variable.type?.toLowerCase() || '';
  const tags = (variable as any)?.tags || [];
  const hasPercentTag = tags.includes('%');
  const hasNumberTag = tags.includes('Number');
  const startsWithH = variableName?.toLowerCase().startsWith('h');

  const isNumericGrid = typeLower.includes('numeric grid');
  const isSingleSelect = typeLower.includes('single select') && !typeLower.includes('grid');
  const isMultiSelectGrid = typeLower.includes('multi-select grid');
  const isSingleSelectGrid = typeLower.includes('single select grid');
  const isMultiSelect = typeLower.includes('multi-select') && !typeLower.includes('grid');
  const isNumericQuestion = typeLower.includes('numeric') && !typeLower.includes('grid') && !typeLower.includes('list');
  const isOpenEndListType = typeLower.includes('open end list');
  const isOpenEndType = typeLower.includes('open end') && !isOpenEndListType;

  const defaultSelections = new Set<string>();

  // Variables starting with "H": show in specs but do not pre-select any tables
  if (startsWithH) {
    return defaultSelections;
  }

  // Check if question number contains any numerical digit
  // If not, do NOT pre-select any tables by default
  const baseQuestionNumber = getBaseQuestionNumber(variableName);
  const normalizedBase = baseQuestionNumber.replace(/^Q/i, '');
  const matchingQuestion = questionnaireQuestions.find(question => {
    const qNum = question.number || question.id;
    if (!qNum) return false;
    const qNumStr = String(qNum);
    const normalizedQNum = qNumStr.replace(/^Q/i, '');
    return (
      qNumStr === baseQuestionNumber ||
      normalizedQNum === normalizedBase ||
      `Q${normalizedQNum}` === baseQuestionNumber
    );
  });

  const questionIdentifier = String(
    matchingQuestion?.number ??
    matchingQuestion?.id ??
    baseQuestionNumber ??
    ''
  ).trim();

  // Multi-select (non-grid): frequency table - ALWAYS show for multi-selects
  if (isMultiSelect) {
    defaultSelections.add(variableName);
    return defaultSelections;
  }

  // If the Q# does NOT contain any digit, return empty set (no default tables)
  // This check comes AFTER multi-select to ensure multi-selects always get tables
  if (!/\d/.test(questionIdentifier)) {
    return defaultSelections;
  }

  // Get all available table options to determine what to select
  const tableOptions = getTableOptionsForVariable(variable, questionnaireQuestions, {});

  // Single select (non-grid): frequency table
  if (isSingleSelect) {
    defaultSelections.add(variableName);
  }

  // Single select grid: all individual statement tables; Mean Summary only if not 7pt scale
  const hasScale7ptTag = tags.some((t: string) => /scale\s*\(7pt\)/i.test(t));
  if (isSingleSelectGrid) {
    const hasStatements = variable.statements && Object.keys(variable.statements).length > 0;
    if (hasStatements && variable.statements) {
      if (!hasScale7ptTag) {
        Object.keys(variable.statements).forEach((code) => {
          defaultSelections.add(`${variableName}_${code}`);
        });
      }
    }
    // Add Mean Summary Table only when not marked as a 7pt scale
    if (!hasScale7ptTag) {
      defaultSelections.add(`${variableName}_MeanSummaryTable`);
    }
  }
  
  // Multi-select grid: all summary tables
  if (isMultiSelectGrid) {
    tableOptions
      .filter(opt => opt.type === 'summary')
      .forEach(opt => defaultSelections.add(opt.id));
  }
  
  // Numeric (non-grid): frequency distribution table only
  if (isNumericQuestion) {
    defaultSelections.add(variableName);
  }
  
  // Numeric grid: depends on tags
  if (isNumericGrid) {
    // Default to summaries based on tags, no individual tables by default
    if (hasPercentTag) {
      defaultSelections.add(`${variableName}_MeanSummaryTable`);
    } else if (hasNumberTag) {
      defaultSelections.add(`${variableName}_MeanSummaryTable`);
      defaultSelections.add(`${variableName}_SumSummaryTable`);
    } else {
      // Default: both Mean and Sum Summary Tables
      defaultSelections.add(`${variableName}_MeanSummaryTable`);
      defaultSelections.add(`${variableName}_SumSummaryTable`);
    }
    return defaultSelections;
  }
  
  // Open end (non-list): include frequency distribution table by default
  if (isOpenEndType) {
    defaultSelections.add(variableName);
  }
  
  // Open end list: nothing (empty set). Tables remain visible in specs.
  // No defaults for these types
  
  return defaultSelections;
}

/**
 * Returns default stats selections for a variable based on its question type and tags
 */
export function getDefaultStatsSelectionsForVariable(variable: Variable): VariableStatsSelection {
  const defaultStats = createDefaultStatsSelection();
  const typeLower = variable.type?.toLowerCase() || '';
  const tags = (variable as any)?.tags || [];
  const hasPercentTag = tags.includes('%');
  const hasNumberTag = tags.includes('Number');
  
  const isNumericQuestion = typeLower.includes('numeric') && !typeLower.includes('grid') && !typeLower.includes('list');
  const isNumericGrid = typeLower.includes('numeric grid');
  
  // Numeric (not grid) with % tag: mean and meanNoOutliers
  if (isNumericQuestion && hasPercentTag) {
    defaultStats.mean = true;
    defaultStats.meanNoOutliers = true;
  }
  
  // Numeric (not grid) with Number tag: mean, meanNoOutliers, sum, sumNoOutliers
  if (isNumericQuestion && hasNumberTag) {
    defaultStats.mean = true;
    defaultStats.meanNoOutliers = true;
    defaultStats.sum = true;
    defaultStats.sumNoOutliers = true;
  }
  
  // Numeric grid with % tag: mean and meanNoOutliers (same as numeric question with % tag)
  if (isNumericGrid && hasPercentTag) {
    defaultStats.mean = true;
    defaultStats.meanNoOutliers = true;
  }
  
  // Numeric grid with Number tag: mean, meanNoOutliers, sum, sumNoOutliers (same as numeric question with Number tag)
  if (isNumericGrid && hasNumberTag) {
    defaultStats.mean = true;
    defaultStats.meanNoOutliers = true;
    defaultStats.sum = true;
    defaultStats.sumNoOutliers = true;
  }
  
  return defaultStats;
}

/**
 * Returns default sort and hold settings for a variable
 */
export function getDefaultSortAndHoldForVariable(
  variable: Variable,
  responseOptions: Array<{ code: string; text: string }>
): { sortByFrequency: boolean; holdCodes: string[] } {
  const typeLower = variable.type?.toLowerCase() || '';
  const isMultiSelect = typeLower.includes('multi-select') && !typeLower.includes('grid');
  const isMultiSelectGrid = typeLower.includes('multi-select grid');
  
  // Multi-select (non-grid) and multi-select grid: sort enabled, hold codes 90-99
  if (isMultiSelect || isMultiSelectGrid) {
    const holdCodes = responseOptions
      .map(opt => opt.code)
      .filter(code => {
        const numeric = parseInt(String(code).replace(/[^0-9-]/g, ''), 10);
        return !isNaN(numeric) && numeric >= 90 && numeric <= 99;
      });
    
    return {
      sortByFrequency: true,
      holdCodes,
    };
  }
  
  // All other types: no sort, no hold codes
  return {
    sortByFrequency: false,
    holdCodes: [],
  };
}

