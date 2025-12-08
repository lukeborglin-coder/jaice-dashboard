import { Variable } from './types';

export const getBaseQuestionNumber = (variableName: string): string => {
  let base = variableName;

  base = base.replace(/_Summary Tables$/, '');
  base = base.replace(/_Summary$/, '');
  base = base.replace(/_T2B$/, '');
  base = base.replace(/_B2B$/, '');
  base = base.replace(/_M3B$/, '');
  base = base.replace(/_\d+$/, '');
  base = base.replace(/_[rR]\d+$/i, '');
  base = base.replace(/_[cC]\d+$/, '');
  
  // Remove row codes (r1, r2, etc.) - these appear after the base question number
  base = base.replace(/[rR]\d+/gi, '');
  
  // Remove column codes (c1, c2, etc.) but preserve question numbers that start with C
  // Question numbers like C1, C2A, C6B should be preserved
  // Column codes appear as lowercase 'c' or uppercase 'C' followed by digits, but NOT at the start
  // Check if base starts with Q prefix
  const hasQPrefix = /^Q/i.test(base);
  const baseWithoutQ = hasQPrefix ? base.substring(1) : base;
  
  if (baseWithoutQ.length > 0) {
    // Remove column codes (c/C followed by digits) but only if they're NOT at the start
    // This preserves question numbers like C1, C2A, C6B
    let processed = '';
    let i = 0;
    while (i < baseWithoutQ.length) {
      const match = baseWithoutQ.substring(i).match(/^[cC]\d+/);
      if (match && i === 0) {
        // This is at the start - it's part of the question number, keep it
        processed += match[0];
        i += match[0].length;
      } else if (match) {
        // This is a column code later in the string, skip it
        i += match[0].length;
      } else {
        // Not a column code, keep the character
        processed += baseWithoutQ[i];
        i++;
      }
    }
    base = hasQPrefix ? 'Q' + processed : processed;
  }
  
  base = base.replace(/_+$/, '');

  return base;
};

export const getDefaultSortFlagForVariable = (variable: Variable): boolean => {
  const typeLower = variable.type?.toLowerCase() || '';
  const isMultiSelectType = typeLower.includes('multi-select') && !typeLower.includes('grid');
  const isMultiSelectGridType = typeLower.includes('multi-select grid');
  const isOpenEndType = typeLower.includes('open end') && !typeLower.includes('list');
  return isMultiSelectType || isMultiSelectGridType || isOpenEndType;
};

