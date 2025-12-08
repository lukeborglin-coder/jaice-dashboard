import { Variable } from './types';
import { getBaseQuestionNumber } from './questionHelpers';

export interface TableOption {
  id: string;
  label: string;
  type: 'individual' | 'summary' | 'net';
  pill?: string;
}

export function getTableOptionsForVariable(
  variable: Variable,
  questionnaireQuestions: any[],
  netSummaryTableSelectedCodes: Record<string, Array<{ name: string; codes: string[] }>>
): TableOption[] {
  const variableName = variable.name;
  const typeLower = variable.type?.toLowerCase() || '';
  const isNumericGrid = typeLower.includes('numeric grid');
  const isSingleSelect = typeLower.includes('single select') && !typeLower.includes('grid');
  const isMultiSelectGrid = typeLower.includes('multi-select grid');
  const isSingleSelectGrid = typeLower.includes('single select grid');
  const isMultiSelect = typeLower.includes('multi-select') && !typeLower.includes('grid');
  const isNumericQuestion = typeLower.includes('numeric') && !typeLower.includes('grid') && !typeLower.includes('list');
  const isOpenEndListType = typeLower.includes('open end list');
  const isOpenEndType = typeLower.includes('open end') && !isOpenEndListType;
  
  const baseQuestionNumber = getBaseQuestionNumber(variableName);
  const matchingQuestion = questionnaireQuestions.find(question => {
    const qNum = question.number || question.id;
    if (!qNum) return false;
    const qNumStr = String(qNum);
    const normalizedQNum = qNumStr.replace(/^Q/i, '');
    const normalizedBase = baseQuestionNumber.replace(/^Q/i, '');
    return (
      qNumStr === baseQuestionNumber ||
      normalizedQNum === normalizedBase ||
      `Q${normalizedQNum}` === baseQuestionNumber
    );
  });

  const netCodeSelections = netSummaryTableSelectedCodes[variableName] || [];

  // Build individual table options
  const individualTableOptions: TableOption[] = [];
  if (!isNumericGrid && !isMultiSelectGrid && !isOpenEndListType && !isSingleSelectGrid) {
    const baseLabel = (isSingleSelect || isMultiSelect || isOpenEndType)
      ? 'Frequency Table'
      : (isNumericQuestion ? 'Frequency Distribution Table' : 'Overall Table');
    const displayLabel = isOpenEndType ? 'Frequency Distribution Table' : baseLabel;
    individualTableOptions.push({ 
      id: variableName, 
      label: displayLabel,
      type: 'individual'
    });
  }

  const hasStatements = variable.statements && Object.keys(variable.statements).length > 0;
  // For numeric questions (not grids) and numeric grids, add individual tables for each statement
  if (hasStatements && !isOpenEndListType && (isNumericQuestion || isNumericGrid) && variable.statements) {
    Object.entries(variable.statements).forEach((entry) => {
      const [code, label] = entry;
      individualTableOptions.push({
        id: `${variableName}_${code}`,
        label: String(label || code),
        type: 'individual'
      });
    });
  }

  if (isSingleSelectGrid && hasStatements && variable.statements) {
    Object.entries(variable.statements).forEach((entry) => {
      const [code, label] = entry;
      individualTableOptions.push({
        id: `${variableName}_${code}`,
        label: String(label || code),
        type: 'individual'
      });
    });
  }

  // Build summary table options
  const summaryTableOptions: TableOption[] = [];
  if (isNumericGrid) {
    summaryTableOptions.push(
      { 
        id: `${variableName}_MeanSummaryTable`, 
        label: `${baseQuestionNumber}: Mean Summary Table`, 
        pill: 'Mean',
        type: 'summary'
      },
      { 
        id: `${variableName}_SumSummaryTable`, 
        label: `${baseQuestionNumber}: Sum Summary Table`, 
        pill: 'Sum',
        type: 'summary'
      },
      { 
        id: `${variableName}_MeanNoOutliersSummaryTable`, 
        label: `${baseQuestionNumber}: Mean (Outliers Removed) Summary Table`, 
        pill: 'Mean (Outliers Removed)',
        type: 'summary'
      },
      { 
        id: `${variableName}_SumNoOutliersSummaryTable`, 
        label: `${baseQuestionNumber}: Sum (Outliers Removed) Summary Table`, 
        pill: 'Sum (Outliers Removed)',
        type: 'summary'
      }
    );
  }
  if (isSingleSelectGrid) {
    summaryTableOptions.push({
      id: `${variableName}_MeanSummaryTable`,
      label: `${baseQuestionNumber}: Mean Summary Table`,
      pill: 'Mean',
      type: 'summary'
    });
    
    // Add net summary tables for single select grids
    if (netCodeSelections.length > 0) {
      netCodeSelections.forEach((net: { name: string; codes: string[] }, idx: number) => {
        summaryTableOptions.push({
          id: `${variableName}_NetSummaryTable_${idx}`,
          label: `${baseQuestionNumber}: ${net.name || `Net ${idx + 1}`}`,
          pill: 'Net',
          type: 'summary'
        });
      });
    }
  }
  
  // For multi-select grids, add summary table options - one for each response option (column)
  if (isMultiSelectGrid) {
    // Get response options (columns) from variable or matching question
    const responseOptions: Array<{ code: string; label: string }> = [];
    
    if (variable.codes && Object.keys(variable.codes).length > 0) {
      // Use codes (response options/columns) from variable
      Object.entries(variable.codes).forEach(([code, label]) => {
        responseOptions.push({
          code,
          label: String(label || code)
        });
      });
    } else if (matchingQuestion && Array.isArray(matchingQuestion.responseOptions)) {
      // Fallback to responseOptions from questionnaire
      matchingQuestion.responseOptions.forEach((opt: any, idx: number) => {
        if (typeof opt === 'string') {
          responseOptions.push({
            code: `c${idx + 1}`,
            label: opt
          });
        } else {
          responseOptions.push({
            code: opt.code || `c${idx + 1}`,
            label: opt.text || opt.label || opt.value || opt.code || `Column ${idx + 1}`
          });
        }
      });
    }
    
    // Create one summary table option for each response option (column)
    responseOptions.forEach((opt) => {
      summaryTableOptions.push({
        id: `${variableName}_${opt.code}_SummaryTable`,
        label: `${baseQuestionNumber}: ${opt.label} Summary Table`,
        pill: 'Summary',
        type: 'summary'
      });
    });
  }
  
  // For open end list, add summary table options - one frequency distribution table for each response option
  if (isOpenEndListType) {
    // Get response options (list items) from variable or matching question
    const responseOptionsForSummary: Array<{ code: string; label: string }> = [];
    
    if (variable.codes && Object.keys(variable.codes).length > 0) {
      // Use codes (response options) from variable
      Object.entries(variable.codes).forEach(([code, label]) => {
        responseOptionsForSummary.push({
          code,
          label: String(label || code)
        });
      });
    } else if (matchingQuestion && Array.isArray(matchingQuestion.responseOptions)) {
      // Fallback to responseOptions from questionnaire
      matchingQuestion.responseOptions.forEach((opt: any, idx: number) => {
        if (typeof opt === 'string') {
          responseOptionsForSummary.push({
            code: `c${idx + 1}`,
            label: opt
          });
        } else {
          responseOptionsForSummary.push({
            code: opt.code || `c${idx + 1}`,
            label: opt.text || opt.label || opt.value || opt.code || `Option ${idx + 1}`
          });
        }
      });
    }
    
    // Create one frequency distribution table option for each response option
    responseOptionsForSummary.forEach((opt) => {
      summaryTableOptions.push({
        id: `${variableName}_${opt.code}_FrequencyDistributionTable`,
        label: `${baseQuestionNumber}: ${opt.label} Frequency Distribution Table`,
        type: 'summary'
      });
    });
  }

  // Note: Single select nets are no longer returned as table options
  // They are shown as stat pills in the variables view instead

  // Combine all table options (excluding single select nets)
  return [...individualTableOptions, ...summaryTableOptions];
}

