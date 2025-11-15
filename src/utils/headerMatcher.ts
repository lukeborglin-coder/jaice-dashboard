/**
 * Automatic header matching utility
 * Matches questionnaire variables to data file column headers without using AI
 */

interface Variable {
  name: string;
  type?: string;
  description?: string;
}

/**
 * Normalize a string for matching (lowercase, trim, remove extra spaces)
 */
function normalize(str: string): string {
  return str.trim().toLowerCase().replace(/\s+/g, ' ');
}

/**
 * Extract base variable name (remove Q prefix if present)
 */
function extractBaseName(varName: string): string {
  const normalized = normalize(varName);
  // Remove Q prefix if present (e.g., QS1 -> S1, QA7 -> A7)
  if (normalized.startsWith('q') && normalized.length > 1) {
    const rest = normalized.substring(1);
    // Check if the rest starts with a letter (not a number)
    if (/^[a-z]/.test(rest)) {
      return rest;
    }
  }
  return normalized;
}

/**
 * Extract the variable name part from a column header (before " - " separator)
 */
function extractColumnBase(columnHeader: string): string {
  const parts = columnHeader.split(' - ');
  return normalize(parts[0]);
}

/**
 * Check if a variable name matches a column header using various patterns
 */
function matchesVariable(varName: string, columnHeader: string): boolean {
  const varNormalized = normalize(varName);
  const colNormalized = normalize(columnHeader);
  const varBase = extractBaseName(varName);
  const colBase = extractColumnBase(columnHeader);

  // 1. Exact match
  if (varNormalized === colNormalized) return true;
  if (varBase === colBase) return true;

  // 2. Column starts with variable name (with or without Q prefix)
  if (colBase.startsWith(varBase) || colBase.startsWith('q' + varBase)) return true;
  if (colNormalized.startsWith(varNormalized) || colNormalized.startsWith('q' + varNormalized)) return true;

  // 3. Variable starts with column base (for cases like "S1" matching "QS1 - ...")
  if (varBase.startsWith(colBase.replace(/^q/, ''))) return true;

  return false;
}

/**
 * Match numeric grid cell variables (e.g., S11r1c1, S11_r1_c1, S11c1r1)
 */
function matchGridCellVariable(varName: string, columnHeader: string): boolean {
  // Pattern: {question}r{row}c{column} or {question}_r{row}_c{column}
  // Also handle column-first: {question}c{column}r{row}
  const varNormalized = normalize(varName);
  const colNormalized = normalize(columnHeader);

  // Extract base question and cell coordinates
  const rowFirstPattern = /^([a-z0-9]+)[_\-]?r(\d+)[_\-]?c(\d+)$/i;
  const colFirstPattern = /^([a-z0-9]+)[_\-]?c(\d+)[_\-]?r(\d+)$/i;

  const varRowFirst = varNormalized.match(rowFirstPattern);
  const varColFirst = varNormalized.match(colFirstPattern);
  const colRowFirst = colNormalized.match(rowFirstPattern);
  const colColFirst = colNormalized.match(colFirstPattern);

  // Match row-first patterns
  if (varRowFirst && colRowFirst) {
    const [, varQ, varR, varC] = varRowFirst;
    const [, colQ, colR, colC] = colRowFirst;
    if (varQ === colQ && varR === colR && varC === colC) return true;
  }

  // Match column-first patterns
  if (varColFirst && colColFirst) {
    const [, varQ, varC, varR] = varColFirst;
    const [, colQ, colC, colR] = colColFirst;
    if (varQ === colQ && varR === colR && varC === colC) return true;
  }

  // Match row-first variable with column-first column (and vice versa)
  if (varRowFirst && colColFirst) {
    const [, varQ, varR, varC] = varRowFirst;
    const [, colQ, colC, colR] = colColFirst;
    if (varQ === colQ && varR === colR && varC === colC) return true;
  }

  if (varColFirst && colRowFirst) {
    const [, varQ, varC, varR] = varColFirst;
    const [, colQ, colR, colC] = colRowFirst;
    if (varQ === colQ && varR === colR && varC === colC) return true;
  }

  return false;
}

/**
 * Match numeric grid column variables (e.g., S11_c1, S11_c2)
 */
function matchGridColumnVariable(varName: string, columnHeader: string): boolean {
  const varNormalized = normalize(varName);
  const colNormalized = normalize(columnHeader);
  const colBase = extractColumnBase(columnHeader);

  // Pattern: {question}_c{column} or {question}c{column}
  const varPattern = /^([a-z0-9]+)[_\-]?c(\d+)$/i;
  const varMatch = varNormalized.match(varPattern);

  if (varMatch) {
    const [, varQ, varC] = varMatch;
    // Check if column starts with question and contains column reference
    if (colBase.startsWith(varQ) || colBase.startsWith('q' + varQ)) {
      // Check if column number is mentioned in the header
      const colNumMatch = colNormalized.match(/[_\-\s]c(\d+)/i) || colNormalized.match(/c(\d+)/i);
      if (colNumMatch && colNumMatch[1] === varC) return true;
      // Also check if it's just the base pattern
      if (colBase === varQ + 'c' + varC || colBase === varQ + '_c' + varC) return true;
    }
  }

  return false;
}

/**
 * Match grid row variables (e.g., C1_r1, C1_r2)
 */
function matchGridRowVariable(varName: string, columnHeader: string): boolean {
  const varNormalized = normalize(varName);
  const colNormalized = normalize(columnHeader);
  const colBase = extractColumnBase(columnHeader);

  // Pattern: {question}_r{row}
  const varPattern = /^([a-z0-9]+)[_\-]?r(\d+)$/i;
  const varMatch = varNormalized.match(varPattern);

  if (varMatch) {
    const [, varQ, varR] = varMatch;
    // Check if column starts with question and contains row reference
    if (colBase.startsWith(varQ) || colBase.startsWith('q' + varQ)) {
      const rowNumMatch = colNormalized.match(/[_\-\s]r(\d+)/i) || colNormalized.match(/r(\d+)/i);
      if (rowNumMatch && rowNumMatch[1] === varR) return true;
      // Also check if it's just the base pattern
      if (colBase === varQ + 'r' + varR || colBase === varQ + '_r' + varR) return true;
    }
  }

  return false;
}

/**
 * Match multi-select response variables (e.g., B8r1, B8r2, D1Ar1)
 */
function matchMultiSelectVariable(varName: string, columnHeader: string): boolean {
  const varNormalized = normalize(varName);
  const colNormalized = normalize(columnHeader);
  const colBase = extractColumnBase(columnHeader);

  // Pattern: {question}r{option} or {question}_r{option} or {question}-{option}
  const varPattern = /^([a-z0-9]+)[_\-]?r(\d+)$/i;
  const varMatch = varNormalized.match(varPattern);

  if (varMatch) {
    const [, varQ, varR] = varMatch;
    // Check various formats: B8r1, B8_r1, B8-1, QB8r1, QB8 - Option 1
    if (colBase === varQ + 'r' + varR || 
        colBase === varQ + '_r' + varR ||
        colBase === varQ + '-' + varR ||
        colBase === 'q' + varQ + 'r' + varR ||
        colBase === 'q' + varQ + '_r' + varR) {
      return true;
    }
    // Check if column contains the option number
    const optionMatch = colNormalized.match(/[_\-\s]r(\d+)/i) || colNormalized.match(/r(\d+)/i) || colNormalized.match(/[_\-\s](\d+)$/);
    if (optionMatch && optionMatch[1] === varR) {
      // Verify the question part matches
      if (colBase.startsWith(varQ) || colBase.startsWith('q' + varQ)) {
        return true;
      }
    }
  }

  return false;
}

/**
 * Automatically match variables to column headers
 * Returns a mapping of variable names to column headers
 */
export function autoMatchHeaders(
  variables: Variable[],
  columnHeaders: string[]
): Record<string, string> {
  const mapping: Record<string, string> = {};
  const usedHeaders = new Set<string>();

  // Filter out summary/computed variables
  const variablesToMatch = variables.filter(v => {
    const name = v.name.toLowerCase();
    // Skip summary table variables
    if (name.includes('_mean summary') || 
        name.includes('summary') && (v as any).isSummaryTable) {
      return false;
    }
    // Skip scale summary variables
    if ((v as any).isScaleSummary) {
      return false;
    }
    return true;
  });

  // First pass: Try exact and simple matches
  for (const variable of variablesToMatch) {
    if (mapping[variable.name]) continue; // Already matched

    for (const header of columnHeaders) {
      if (usedHeaders.has(header)) continue; // Header already used

      // Try simple variable matching
      if (matchesVariable(variable.name, header)) {
        mapping[variable.name] = header;
        usedHeaders.add(header);
        break;
      }
    }
  }

  // Second pass: Try specialized patterns for unmatched variables
  for (const variable of variablesToMatch) {
    if (mapping[variable.name]) continue; // Already matched

    for (const header of columnHeaders) {
      if (usedHeaders.has(header)) continue; // Header already used

      // Try grid cell matching
      if (matchGridCellVariable(variable.name, header)) {
        mapping[variable.name] = header;
        usedHeaders.add(header);
        break;
      }

      // Try grid column matching
      if (matchGridColumnVariable(variable.name, header)) {
        mapping[variable.name] = header;
        usedHeaders.add(header);
        break;
      }

      // Try grid row matching
      if (matchGridRowVariable(variable.name, header)) {
        mapping[variable.name] = header;
        usedHeaders.add(header);
        break;
      }

      // Try multi-select matching
      if (matchMultiSelectVariable(variable.name, header)) {
        mapping[variable.name] = header;
        usedHeaders.add(header);
        break;
      }
    }
  }

  return mapping;
}









