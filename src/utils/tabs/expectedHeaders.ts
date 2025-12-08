import { Variable } from './types';
import { getBaseQuestionNumber } from './questionHelpers';

/**
 * Get expected column headers for a base question number from variables
 */
export const getExpectedColumnHeadersForBase = (baseQuestionNumber: string, allVariables: Variable[]): string[] => {
  const headers: string[] = [];
  const baseNum = baseQuestionNumber.replace(/^Q/i, '');
  
  allVariables.forEach(v => {
    if (v.name.endsWith('_Summary Tables') || 
        v.name.endsWith('_T2B') || 
        v.name.endsWith('_B2B') || 
        v.name.endsWith('_M3B') ||
        (v as any).isSummaryTable) {
      return;
    }
    
    const vBase = getBaseQuestionNumber(v.name);
    const vBaseNum = vBase.replace(/^Q/i, '');
    
    if (vBaseNum.toLowerCase() === baseNum.toLowerCase() || 
        vBase.toLowerCase() === baseQuestionNumber.toLowerCase()) {
      if (v.statements && Object.keys(v.statements).length > 0) {
        Object.keys(v.statements).forEach(stmtCode => {
          const normalized = /^r\d+/i.test(stmtCode) ? stmtCode : `r${stmtCode}`;
          headers.push(`Q${baseNum}${normalized}`);
        });
      } else if (v.codes && Object.keys(v.codes).length > 0) {
        headers.push(`Q${baseNum}`);
      } else {
        headers.push(`Q${baseNum}`);
      }
    }
  });
  
  return Array.from(new Set(headers));
};

/**
 * Generate expected headers for a question based on its type and structure
 */
export const getExpectedHeadersForQuestion = (
  question: any, 
  baseQuestionNumber: string | undefined,
  variables: Variable[],
  getExpectedColumnHeadersForBaseFn: (base: string, vars: Variable[]) => string[]
): string[] => {
  const qNum = question.number || question.id;
  const qNumStr = baseQuestionNumber || String(qNum);
  let questionType = question.type || '';
  
  const typeLower = questionType.toLowerCase();
  const expectedHeaders: string[] = [];
  
  // Check if question has statementOptions (rows) and responseOptions (columns) - Grid questions
  const hasStatementOptions = question.statementOptions && Array.isArray(question.statementOptions) && question.statementOptions.length > 0;
  const hasResponseOptions = question.responseOptions && Array.isArray(question.responseOptions) && question.responseOptions.length > 0;
  const hasOptions = question.options && Array.isArray(question.options) && question.options.length > 0;
  
  // Numeric Grid or Numeric List - has both rows and columns
  if (typeLower.includes('numeric grid') || typeLower.includes('numeric list')) {
    const rowCodes: string[] = [];
    const colCodes: string[] = [];
    
    if (hasStatementOptions) {
      question.statementOptions.forEach((stmt: any, idx: number) => {
        const code = typeof stmt === 'string' ? `r${idx + 1}` : (stmt.code || `r${idx + 1}`);
        rowCodes.push(code);
      });
    }
    
    if (hasResponseOptions) {
      question.responseOptions.forEach((resp: any, idx: number) => {
        const code = typeof resp === 'string' ? `c${idx + 1}` : (resp.code || `c${idx + 1}`);
        colCodes.push(code);
      });
    }
    
    // If no columns but has rows, add default column
    if (colCodes.length === 0) {
      colCodes.push('c1');
    }
    
    // Generate headers for each row/column combination
    if (rowCodes.length > 0 && colCodes.length > 0) {
      colCodes.forEach(colCode => {
        const colNum = colCode.match(/c?(\d+)/i)?.[1] || colCode.replace(/[^0-9]/g, '');
        rowCodes.forEach(rowCode => {
          const rowNum = rowCode.match(/r?(\d+)/i)?.[1] || rowCode.replace(/[^0-9]/g, '');
          expectedHeaders.push(`Q${qNumStr}r${rowNum}c${colNum}`);
        });
      });
    } else if (hasResponseOptions && rowCodes.length === 0) {
      // Numeric List - only has response options (columns), no rows
      question.responseOptions.forEach((resp: any, idx: number) => {
        const code = typeof resp === 'string' ? `r${idx + 1}` : (resp.code || `r${idx + 1}`);
        const rowNum = code.match(/r?(\d+)/i)?.[1] || code.replace(/[^0-9]/g, '');
        expectedHeaders.push(`Q${qNumStr}r${rowNum}`);
      });
    }
  }
  // Single Select Grid - only rows (no columns)
  else if (typeLower.includes('single select grid') || typeLower.includes('button single select grid')) {
    if (hasStatementOptions) {
      const rowCodes: string[] = [];
      
      question.statementOptions.forEach((stmt: any, idx: number) => {
        const code = typeof stmt === 'string' ? `r${idx + 1}` : (stmt.code || `r${idx + 1}`);
        rowCodes.push(code);
      });
      
      // Generate headers for each row only (no columns)
      rowCodes.forEach(rowCode => {
        const rowNum = rowCode.match(/r?(\d+)/i)?.[1] || rowCode.replace(/[^0-9]/g, '');
        expectedHeaders.push(`Q${qNumStr}r${rowNum}`);
      });
    }
  }
  // Multi-Select Grid - has both rows and columns
  else if (typeLower.includes('multi-select grid') || typeLower.includes('button multi-select')) {
    if (hasStatementOptions && hasResponseOptions) {
      const rowCodes: string[] = [];
      const colCodes: string[] = [];
      
      question.statementOptions.forEach((stmt: any, idx: number) => {
        const code = typeof stmt === 'string' ? `r${idx + 1}` : (stmt.code || `r${idx + 1}`);
        rowCodes.push(code);
      });
      
      question.responseOptions.forEach((resp: any, idx: number) => {
        const code = typeof resp === 'string' ? `c${idx + 1}` : (resp.code || `c${idx + 1}`);
        colCodes.push(code);
      });
      
      // Generate headers for each row/column combination
      colCodes.forEach(colCode => {
        const colNum = colCode.match(/c?(\d+)/i)?.[1] || colCode.replace(/[^0-9]/g, '');
        rowCodes.forEach(rowCode => {
          const rowNum = rowCode.match(/r?(\d+)/i)?.[1] || rowCode.replace(/[^0-9]/g, '');
          expectedHeaders.push(`Q${qNumStr}r${rowNum}c${colNum}`);
        });
      });
    }
  }
  // Multi-Select - has options, generates one header per option
  else if (typeLower.includes('multi-select') || typeLower.includes('multi select')) {
    if (hasOptions) {
      question.options.forEach((opt: any, idx: number) => {
        const code = typeof opt === 'string' ? `r${idx + 1}` : (opt.code || `r${idx + 1}`);
        const rowNum = code.match(/r?(\d+)/i)?.[1] || code.replace(/[^0-9]/g, '') || String(idx + 1);
        expectedHeaders.push(`Q${qNumStr}r${rowNum}`);
      });
    } else if (hasResponseOptions) {
      question.responseOptions.forEach((resp: any, idx: number) => {
        const code = typeof resp === 'string' ? `r${idx + 1}` : (resp.code || `r${idx + 1}`);
        const rowNum = code.match(/r?(\d+)/i)?.[1] || code.replace(/[^0-9]/g, '') || String(idx + 1);
        expectedHeaders.push(`Q${qNumStr}r${rowNum}`);
      });
    }
  }
  // Open End List - has responseOptions (list items)
  else if (typeLower.includes('open end list')) {
    if (hasResponseOptions) {
      question.responseOptions.forEach((resp: any, idx: number) => {
        const code = typeof resp === 'string' ? `r${idx + 1}` : (resp.code || `r${idx + 1}`);
        const rowNum = code.match(/r?(\d+)/i)?.[1] || code.replace(/[^0-9]/g, '') || String(idx + 1);
        expectedHeaders.push(`Q${qNumStr}r${rowNum}`);
      });
    }
  }
  // Single Select (non-grid) - just Q{number}
  else if (typeLower.includes('single select') && !typeLower.includes('grid')) {
    expectedHeaders.push(`Q${qNumStr}`);
  }
  // Open End (not Open End List) - just Q{number}
  else if (typeLower.includes('open end') || typeLower.includes('open-ended') || typeLower.includes('text')) {
    expectedHeaders.push(`Q${qNumStr}`);
  }
  // All other question types (Open End, Numeric, Button Rating, Rating Scale, Dropdown, etc.)
  // Generate at least one header - use Q{number} or Q{number}r1
  else {
    // Try to get from variables first (fallback to existing logic)
    const varHeaders = getExpectedColumnHeadersForBaseFn(qNumStr, variables);
    if (varHeaders.length > 0) {
      expectedHeaders.push(...varHeaders);
    } else {
      // If no variables found, generate default header
      // Check if question has any structure that suggests rows
      if (hasStatementOptions || hasResponseOptions || hasOptions) {
        // If it has structure, use r1
        expectedHeaders.push(`Q${qNumStr}r1`);
      } else {
        // Simple question, just use base number
        expectedHeaders.push(`Q${qNumStr}`);
      }
    }
  }
  
  // Ensure at least one header is always returned
  if (expectedHeaders.length === 0) {
    expectedHeaders.push(`Q${qNumStr}`);
  }
  
  return Array.from(new Set(expectedHeaders));
};

