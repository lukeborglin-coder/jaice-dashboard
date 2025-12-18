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

/**
 * Returns true when a question/variable name is "oe" tagged at the end.
 * Examples we want to hide:
 * - Q12oe, S3oe (letter/digit suffix)
 * - Q12_oe, S3_oe (underscore suffix)
 */
export const isOeTaggedName = (name: string): boolean => {
  const s = String(name || '').trim();
  if (!s) return false;
  const lower = s.toLowerCase();
  return /_oe$/.test(lower) || /[0-9]oe$/.test(lower);
};

/**
 * Classifies a question type from a Data Map-style "responseType" + response options/codes.
 * Used for raw-upload tab plans so Data Map / Tab Specs / Variables stay in sync.
 */
export const classifyDatamapQuestionType = (q: {
  responseType?: string;
  responseCodes?: any[];
  responseOptions?: any[];
  statementOptions?: any[];
  notes?: any[];
}): string => {
  const responseType = String(q?.responseType || 'Unknown');
  const lowerType = responseType.toLowerCase();

  // ID type (respondent ID column)
  if (lowerType === 'id') return 'ID';

  const responseCodes = Array.isArray(q?.responseCodes) ? q.responseCodes : [];
  const responseOptions = Array.isArray(q?.responseOptions) ? q.responseOptions : [];
  const statementOptions = Array.isArray(q?.statementOptions) ? q.statementOptions : [];
  const notes = Array.isArray(q?.notes) ? q.notes : [];
  const hasAnyResponseOptions = responseCodes.length > 0 || responseOptions.length > 0 || statementOptions.length > 0;
  const hasExplicitResponseOptions = responseCodes.length > 0 || responseOptions.length > 0;

  const normalizedOptions: Array<{ code: string; label: string }> = (() => {
    const raw =
      (Array.isArray(q?.responseCodes) && q.responseCodes) ||
      (Array.isArray(q?.responseOptions) && q.responseOptions) ||
      (Array.isArray(q?.statementOptions) && q.statementOptions) ||
      [];

    return raw
      .map((opt: any, idx: number) => {
        if (opt == null) return null;
        if (typeof opt === 'string' || typeof opt === 'number') {
          return { code: String(opt), label: '' };
        }
        const code = opt.code ?? opt.value ?? idx + 1;
        const label = opt.label ?? opt.text ?? opt.name ?? '';
        return { code: String(code), label: String(label) };
      })
      .filter(Boolean) as Array<{ code: string; label: string }>;
  })();

  const looksLikeCheckedUncheckedBinary = (() => {
    const normalized = normalizedOptions.map((o) => ({
      code: String(o.code ?? '').trim().toLowerCase(),
      label: String(o.label ?? '').trim().toLowerCase(),
    }));

    const hasUnchecked0 = normalized.some((o) => o.code === '0' && o.label.includes('unchecked'));
    const hasChecked1 = normalized.some((o) => o.code === '1' && o.label.includes('checked'));
    return hasUnchecked0 && hasChecked1;
  })();

  const hasBracketsInResponseCodes = (codes: any[]): boolean => {
    return codes.some((codeItem: any) => {
      const codeStr = String(codeItem?.code ?? codeItem ?? '').trim();
      return /\[([^\]]+)\]|\(([^)]+)\)/.test(codeStr);
    });
  };

  // Open text → Open end
  if (lowerType.includes('open text')) return 'Open end';

  // Open numeric → Numeric (but check notes for grid classification below)
  if (lowerType.includes('open numeric')) {
    // If there are multiple notes rows, it's likely a numeric grid
    if (notes.length > 1) {
      return 'Numeric grid';
    }
    return 'Numeric';
  }

  // Values: 0-1:
  // - Multi-select ONLY when options look like 0=Unchecked and 1=Checked
  // - Otherwise, if options exist OR has multiple notes rows, treat as Numeric grid
  // - Otherwise, treat as Numeric
  if (lowerType.match(/values?:\s*0\s*-\s*1/i)) {
    if (looksLikeCheckedUncheckedBinary) return 'Multi-select';
    if (hasAnyResponseOptions || notes.length > 1) return 'Numeric grid';
    return 'Numeric';
  }

  // Values: x-y
  const valuesMatch = lowerType.match(/values?:\s*(\d+)\s*-\s*(\d+)/i);
  if (valuesMatch) {
    const min = parseInt(valuesMatch[1], 10);
    const max = parseInt(valuesMatch[2], 10);
    if (!isNaN(min) && !isNaN(max)) {
      // Values 1-99 → Check if it's a grid or single select
      if (min >= 1 && max <= 99) {
        // If has statements/notes AND response options, it's a single select grid
        if ((notes.length > 1 || statementOptions.length > 0) && hasAnyResponseOptions) {
          return 'Single select grid';
        }
        return 'Single select';
      }
      // Outside 1-99 → Numeric (but check notes for grid classification)
      if (notes.length > 1) {
        return 'Numeric grid';
      }
      return 'Numeric';
    }
  }

  // Values: n
  const singleValueMatch = lowerType.match(/values?:\s*(\d+)/i);
  if (singleValueMatch) {
    const value = parseInt(singleValueMatch[1], 10);
    if (!isNaN(value)) {
      // Values 1-99 → Check if it's a grid or single select
      if (value >= 1 && value <= 99) {
        // If has statements/notes AND response options, it's a single select grid
        if ((notes.length > 1 || statementOptions.length > 0) && hasAnyResponseOptions) {
          return 'Single select grid';
        }
        return 'Single select';
      }
      // Outside 1-99 → Numeric (but check notes for grid classification)
      if (notes.length > 1) {
        return 'Numeric grid';
      }
      return 'Numeric';
    }
  }

  // Numeric grid heuristic: numeric + (has codes OR multiple notes rows)
  if (lowerType.includes('numeric') && (responseCodes.length > 0 || notes.length > 1)) {
    return 'Numeric grid';
  }

  // Single select + brackets → Single select grid
  if (
    lowerType.match(/values?:\s*\d+/i) &&
    responseCodes.length > 0 &&
    hasBracketsInResponseCodes(responseCodes)
  ) {
    return 'Single select grid';
  }

  // Debug: QC7/S4 classification info
  const qNumDebug = String(q?.questionNumber || q?.id || '').toLowerCase();
  if (qNumDebug === 'qc7' || qNumDebug === 's4') {
    console.log(`[DEBUG ${qNumDebug.toUpperCase()} classify]`, {
      lowerType,
      responseOptionsLen: responseOptions.length,
      responseCodesLen: responseCodes.length,
      notesLen: notes.length,
    });
  }

  return 'Unknown';
};

/**
 * Detects if a single select question should have a "Scale (7pt)" tag
 * Returns { hasScale: boolean, optOutCode: string | null }
 */
export const detect7ptScale = (responseCodes: Array<{ code: string; text: string }>): { hasScale: boolean; optOutCode: string | null } => {
  const result: { hasScale: boolean; optOutCode: string | null } = { hasScale: false, optOutCode: null };

  if (!Array.isArray(responseCodes) || responseCodes.length < 7) {
    return result;
  }

  // Extract numeric codes
  const codeNumbers = responseCodes.map(rc => {
    const numCode = parseInt(String(rc.code).replace(/[^0-9-]/g, ''), 10);
    return { original: rc.code, numeric: isNaN(numCode) ? null : numCode, text: rc.text };
  }).filter(c => c.numeric !== null);

  if (codeNumbers.length < 7) {
    return result;
  }

  // Check if codes 1-7 exist
  const has1to7 = [1, 2, 3, 4, 5, 6, 7].every(num =>
    codeNumbers.some(c => c.numeric === num)
  );

  if (!has1to7) {
    return result;
  }

  // Get codes 1-7 for number/text check
  const codes1to7 = codeNumbers.filter(c => c.numeric! >= 1 && c.numeric! <= 7);

  // Check if any response text clearly carries the numeric scale indicator (leading or trailing the text)
  const hasNumericMarker = codes1to7.some(c => {
    const text = String(c.text || '').trim();
    const num = c.numeric!;
    // Starts with number, ends with number, or contains the number as a token
    const startsWithNumber = /^\d/.test(text);
    const endsWithNumber = /\d$/.test(text);
    const tokenRegex = new RegExp(`(^|\\s|\\W)${num}(\\s|\\W|$)`);
    return startsWithNumber || endsWithNumber || tokenRegex.test(text);
  });

  if (!hasNumericMarker) {
    return result;
  }

  // Case 1: Exactly 7 codes
  if (responseCodes.length === 7) {
    result.hasScale = true;
    return result;
  }

  // Case 2: More than 7 codes
  // Get codes outside 1-7
  const additionalCodes = codeNumbers.filter(c => c.numeric! < 1 || c.numeric! > 7);

  // If more than 1 additional code, no scale tag
  if (additionalCodes.length > 1) {
    return result;
  }

  // If exactly 1 additional code, mark as opt-out and add scale tag
  if (additionalCodes.length === 1) {
    result.hasScale = true;
    result.optOutCode = additionalCodes[0].original;
    return result;
  }

  return result;
};
