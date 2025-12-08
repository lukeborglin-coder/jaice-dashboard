import { Variable } from '../utils/tabs/types';
import { getBaseQuestionNumber } from '../utils/tabs/questionHelpers';

/**
 * Normalizes a question number by removing Q prefix and handling variations
 */
export function normalizeQuestionNumber(qNum: string | number): string {
  const str = String(qNum);
  return str.replace(/^Q/i, '');
}

/**
 * Gets expected column headers for a base question number
 * Extracted from RawDataViewer.tsx and Tabs.tsx
 */
export function getExpectedColumnHeadersForBase(
  baseQuestionNumber: string,
  variables: Variable[]
): string[] {
  const headers: string[] = [];
  const baseNum = normalizeQuestionNumber(baseQuestionNumber);

  variables.forEach((v) => {
    if (
      v.name.endsWith('_Summary Tables') ||
      v.name.endsWith('_T2B') ||
      v.name.endsWith('_B2B') ||
      v.name.endsWith('_M3B') ||
      (v as any).isSummaryTable
    ) {
      return;
    }

    const vBase = getBaseQuestionNumber(v.name);
    const vBaseNum = normalizeQuestionNumber(vBase);

    if (
      vBaseNum.toLowerCase() === baseNum.toLowerCase() ||
      vBase.toLowerCase() === baseQuestionNumber.toLowerCase()
    ) {
      if (v.statements && Object.keys(v.statements).length > 0) {
        Object.keys(v.statements).forEach((stmtCode) => {
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
}

/**
 * Gets expected column headers for a specific question
 */
export function getQuestionColumns(
  questionNumber: string | number,
  questionType: string,
  variables: Variable[]
): string[] {
  const baseNumber = String(questionNumber);
  const headers = getExpectedColumnHeadersForBase(baseNumber, variables);

  // If no headers found, generate default based on question type
  if (headers.length === 0) {
    const qNumStr = normalizeQuestionNumber(baseNumber);
    const isGrid = questionType?.toLowerCase().includes('grid');
    const isMultiSelect = questionType?.toLowerCase().includes('multi-select');

    if (isGrid || isMultiSelect) {
      // For grids, default to r1
      headers.push(`Q${qNumStr}r1`);
    } else {
      // Simple question, just use base number
      headers.push(`Q${qNumStr}`);
    }
  }

  return headers;
}

/**
 * Gets all columns needed for a set of questions
 */
export function getAllColumnsForQuestions(
  questions: Array<{ number?: string | number; id?: string | number; type?: string }>,
  variables: Variable[]
): string[] {
  const allHeaders: string[] = [];
  const headersSet = new Set<string>();
  const processedBaseNumbers = new Set<string>();

  questions.forEach((question) => {
    const qNum = question.number || question.id;
    if (!qNum) return;

    const baseNumber = String(qNum);
    if (processedBaseNumbers.has(baseNumber)) {
      return;
    }
    processedBaseNumbers.add(baseNumber);

    const expectedHeaders = getExpectedColumnHeadersForBase(baseNumber, variables);
    expectedHeaders.forEach((header) => {
      if (!headersSet.has(header)) {
        headersSet.add(header);
        allHeaders.push(header);
      }
    });
  });

  return allHeaders;
}

