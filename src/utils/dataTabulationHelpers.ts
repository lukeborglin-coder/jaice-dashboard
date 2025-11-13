/**
 * Data Tabulation Helper Types and Functions
 * Minimal types and utilities for CrossTabDisplay and BannerBuilder components
 */

export interface VariableDefinition {
  name: string;
  description: string;
  type: 'categorical' | 'open-numeric' | 'open-text' | 'multi-select' | 'grid' | 'grid-numeric' | 'grid-verbatim' | 'grid-single-select' | 'grid-multi-select';
  codes: Record<string, string>;
  statements?: Record<string, string>;
  isMultiSelectOption?: boolean;
  parentMultiSelect?: string;
}

export interface ParsedDataFile {
  variables: VariableDefinition[];
  data: Record<string, any>[];
  rowCount: number;
  metadata: {
    fileName: string;
    uploadedAt: Date;
    sheetNames: string[];
  };
}

/**
 * Get variable definition by name
 */
export function getVariableDefinition(variables: VariableDefinition[], varName: string): VariableDefinition | undefined {
  return variables.find(v => v.name === varName);
}

/**
 * Get code label for a variable and code value
 */
export function getCodeLabel(variables: VariableDefinition[], varName: string, codeValue: string | number | null | undefined): string {
  if (codeValue === null || codeValue === undefined || codeValue === '') {
    return 'Missing';
  }

  const varDef = getVariableDefinition(variables, varName);
  if (!varDef) {
    return String(codeValue);
  }

  // Handle categorical, multi-select, and grid types (all have codes)
  if (varDef.type === 'categorical' || varDef.type === 'multi-select' ||
      varDef.type === 'grid' || varDef.type === 'grid-single-select' ||
      varDef.type === 'grid-multi-select') {
    const codeStr = String(codeValue);
    return varDef.codes[codeStr] || codeStr;
  }

  return String(codeValue);
}
