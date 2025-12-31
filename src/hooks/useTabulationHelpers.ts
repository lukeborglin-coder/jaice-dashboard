import { useCallback } from 'react';
import { BannerConditionGroup } from '../types/dataTabulation';
import { Variable } from '../utils/tabs/types';
import { getBaseQuestionNumber, getDefaultSortFlagForVariable } from '../utils/tabs/questionHelpers';
import { getNumericCodeValueForMean, normalizeCodeForComparison } from '../utils/tabs/codeHelpers';

interface UseTabulationHelpersProps {
  fullRawData: any;
  columnMapping: Record<string, string>;
  questionnaireQuestions: any[];
  variables: Variable[];
  bannerFilterConditions: BannerConditionGroup[] | null;
  getVariableDataByExpectedHeader: (variableName: string) => any;
  percentageDecimals: number;
  variableSortByFrequency: Record<string, boolean>;
}

export const useTabulationHelpers = (props: UseTabulationHelpersProps) => {
  const {
    fullRawData,
    columnMapping,
    questionnaireQuestions,
    variables,
    bannerFilterConditions,
    getVariableDataByExpectedHeader,
    percentageDecimals,
    variableSortByFrequency,
  } = props;

  const formatPercentage = useCallback((value: number): string => {
    return `${value.toFixed(percentageDecimals)}%`;
  }, [percentageDecimals]);
  const getCodeValueForMean = useCallback((variableRef: Variable | { name?: string } | string | null, code: string, fallback?: string): number | null => {
    const directValue = getNumericCodeValueForMean(code, fallback);
    if (directValue !== null) return directValue;
    if (!variableRef) return null;

    const variableName = typeof variableRef === 'string' ? variableRef : variableRef?.name;
    if (!variableName) return null;

    const baseQuestionNumber = getBaseQuestionNumber(variableName);
    const normalizedBase = baseQuestionNumber.replace(/^Q/i, '');
    const question = questionnaireQuestions.find((q: any) => {
      const qNum = q.number || q.id;
      if (!qNum) return false;
      const qStr = String(qNum);
      const normalizedQ = qStr.replace(/^Q/i, '');
      return qStr === baseQuestionNumber ||
             normalizedQ === normalizedBase ||
             qStr === normalizedBase ||
             `Q${normalizedQ}` === baseQuestionNumber;
    });

    const tryParseCandidate = (candidate?: string | number): number | null => {
      if (candidate === null || candidate === undefined || candidate === '') return null;
      if (typeof candidate === 'number' && Number.isFinite(candidate)) {
        if (candidate >= 90 && candidate <= 99) return null;
        return candidate;
      }
      return getNumericCodeValueForMean(String(candidate));
    };

    const deriveValueFromOption = (option: any): number | null => {
      if (!option) return null;
      const fromCode = tryParseCandidate(option.code);
      if (fromCode !== null) return fromCode;
      const fromDisplay = tryParseCandidate(option.displayCode);
      if (fromDisplay !== null) return fromDisplay;
      const fromValue = tryParseCandidate(option.value);
      if (fromValue !== null) return fromValue;
      const fromOrder = tryParseCandidate(option.order);
      if (fromOrder !== null) return fromOrder;
      return null;
    };

    const normalizedTarget = normalizeCodeForComparison(code) || normalizeCodeForComparison(fallback);
    const labelValue = typeof variableRef === 'object' ? (variableRef as Variable)?.codes?.[code] : undefined;
    const normalizedLabel = typeof labelValue === 'string' ? labelValue.trim().toLowerCase() : '';

    const findMatchingOption = (options?: any[]) => {
      if (!options || options.length === 0) return null;
      return options.find((opt: any) => {
        if (normalizedTarget) {
          const optionCandidates = [
            opt?.code,
            opt?.value,
            opt?.displayCode,
            typeof opt?.order === 'number' ? opt.order : undefined
          ];
          if (optionCandidates.some((candidate) => candidate !== undefined && normalizeCodeForComparison(candidate) === normalizedTarget)) {
            return true;
          }
        }
        if (normalizedLabel) {
          const potentialLabels = [opt?.text, opt?.label, opt?.description]
            .filter(Boolean)
            .map((val: any) => String(val).trim().toLowerCase());
          if (potentialLabels.some(label => label === normalizedLabel)) {
            return true;
          }
        }
        return false;
      }) || null;
    };

    const variableCodesOrder = typeof variableRef === 'object' ? Object.keys((variableRef as Variable)?.codes || {}) : [];

    if (question && Array.isArray(question.responseOptions) && question.responseOptions.length > 0) {
      const optionMatch = findMatchingOption(question.responseOptions);
      if (optionMatch) {
        const derived = deriveValueFromOption(optionMatch);
        if (derived !== null) return derived;
        const optionIndex = question.responseOptions.indexOf(optionMatch);
        if (optionIndex >= 0) {
          const positionValue = getNumericCodeValueForMean(String(optionIndex + 1));
          if (positionValue !== null) return positionValue;
        }
      }

      if (variableCodesOrder.length > 0 && variableCodesOrder.length === question.responseOptions.length) {
        const idx = variableCodesOrder.indexOf(code);
        if (idx >= 0) {
          const option = question.responseOptions[idx];
          const derived = deriveValueFromOption(option);
          if (derived !== null) return derived;
        }
      }
    }

    if (variableCodesOrder.length > 0) {
      const idx = variableCodesOrder.indexOf(code);
      if (idx >= 0) {
        const fallbackFromOrder = getNumericCodeValueForMean(String(idx + 1));
        if (fallbackFromOrder !== null) return fallbackFromOrder;
      }
    }

    return null;
  }, [questionnaireQuestions, getBaseQuestionNumber]);
  const rowMatchesFilterConditions = useCallback((row: any, filterConditions: BannerConditionGroup[] | null): boolean => {
    if (!filterConditions || filterConditions.length === 0) {
      return true; // No filter, include all rows
    }

    const group = filterConditions[0];
    const conditions = group.conditions;
    const operator = group.operator;

    if (conditions.length === 0) {
      return true;
    }

    // Helper to get column header for a variable
    const getColumnHeader = (varName: string): string | null => {
      const variations = [
        varName,
        varName.startsWith('Q') ? varName : `Q${varName}`,
        varName.startsWith('Q') ? varName.substring(1) : varName
      ];

      for (const variation of variations) {
        if (columnMapping?.[variation]) {
          return columnMapping[variation];
        }
        const matchingKey = Object.keys(columnMapping || {}).find(
          key => key.toLowerCase() === variation.toLowerCase()
        );
        if (matchingKey) {
          return columnMapping![matchingKey];
        }
      }
      return null;
    };

    // Helper to check if a row matches a single condition
    const rowMatchesCondition = (cond: any): boolean => {
      if (!cond.variableName || cond.codes.length === 0) return false;

      const colHeader = getColumnHeader(cond.variableName);
      if (!colHeader) return false;

      const val = row[colHeader];
      if (val === null || val === undefined || val === '') return false;
      const valStr = String(val).trim();
      const numVal = Number(valStr);

      // Check if variable is numeric
      const v = variables.find(variable => variable.name === cond.variableName);
      const hasCodes = v?.codes && Object.keys(v.codes).length > 0;
      const isNumericType = v?.type?.toLowerCase().includes('numeric') && !v?.type?.toLowerCase().includes('grid');
      const isNumeric = !hasCodes && isNumericType;

      if (isNumeric && cond.codes.length === 1) {
        const condition = cond.codes[0];
        // Between format
        const betweenMatch = condition.match(/^(\d+(?:\.\d+)?)-(\d+(?:\.\d+)?)$/);
        if (betweenMatch) {
          const min = parseFloat(betweenMatch[1]);
          const max = parseFloat(betweenMatch[2]);
          return !isNaN(numVal) && numVal >= min && numVal <= max;
        }
        // Operator format
        const opMatch = condition.match(/^(>=|<=|>|<|=)(\d+(?:\.\d+)?)$/);
        if (opMatch) {
          const op = opMatch[1];
          const compareVal = parseFloat(opMatch[2]);
          if (isNaN(numVal)) return false;
          switch (op) {
            case '>=': return numVal >= compareVal;
            case '<=': return numVal <= compareVal;
            case '>': return numVal > compareVal;
            case '<': return numVal < compareVal;
            case '=': return numVal === compareVal;
          }
        }
        return false;
      } else {
        // Categorical
        for (const code of cond.codes) {
          if (valStr === code) return true;
          if (!isNaN(numVal) && String(numVal) === code) return true;
          const codeNoC = code.replace(/^c/i, '');
          if (valStr === codeNoC || (!isNaN(numVal) && !isNaN(Number(codeNoC)) && numVal === Number(codeNoC))) {
            return true;
          }
        }
        return false;
      }
    };

    // Apply operator (AND or OR)
    if (operator === 'OR') {
      return conditions.some(cond => rowMatchesCondition(cond));
    } else {
      return conditions.every(cond => rowMatchesCondition(cond));
    }
  }, [variables, columnMapping]);
  const calculateBannerTableDataForVariable = useCallback((
    variable: any,
    selectedBannerVariable: string,
    bannerGroup: any
  ): any => {
    // console.log(` calculateBannerTableDataForVariable CALLED for ${selectedBannerVariable}:`, {
    //   variableType: variable.type,
    //   hasVariable: !!variable,
    //   hasBannerGroup: !!bannerGroup,
    //   hasFullRawData: !!fullRawData,
    //   hasRows: !!fullRawData?.rows,
    //   rowCount: fullRawData?.rows?.length || 0,
    //   hasColumnMapping: !!columnMapping,
    //   columnMappingSize: columnMapping ? Object.keys(columnMapping).length : 0,
    //   hasFilter: !!bannerFilterConditions
    // });

    if (!bannerGroup || !fullRawData || !fullRawData.rows || fullRawData.rows.length === 0 || !columnMapping) {
      // console.log(` calculateBannerTableDataForVariable EARLY RETURN for ${selectedBannerVariable}: Missing required data`);
      return {};
    }

    // Apply filter conditions to rows
    const filteredRows = bannerFilterConditions
      ? fullRawData.rows.filter((row: any) => rowMatchesFilterConditions(row, bannerFilterConditions))
      : fullRawData.rows;

    if (filteredRows.length === 0) {
      // console.log(` calculateBannerTableDataForVariable: No rows match filter conditions`);
      return {};
    }

    // Helper to get column header (same as in render)
    const getColumnHeader = (varName: string): string | null => {
      const variations = [
        varName,
        varName.startsWith('Q') ? varName : `Q${varName}`,
        varName.startsWith('Q') ? varName.substring(1) : varName
      ];

      // First, try columnMapping
      for (const variation of variations) {
        if (columnMapping[variation]) {
          return columnMapping[variation];
        }
        // Try case-insensitive
        const matchingKey = Object.keys(columnMapping).find(
          key => key.toLowerCase() === variation.toLowerCase()
        );
        if (matchingKey) {
          return columnMapping[matchingKey];
        }
      }
      
      // If not found in columnMapping, try direct match in fullRawData.columns
      if (fullRawData.columns) {
        for (const variation of variations) {
          const directMatch = fullRawData.columns.find(
            col => col.toLowerCase() === variation.toLowerCase()
          );
          if (directMatch) {
            return directMatch;
          }
        }
      }
      
      return null;
    };

    // Check if this is a summary table with statements (numeric grid summary)
    let isSummaryTable = (variable as any).isSummaryTable && variable.statements;
    
    // Check if this is a numeric grid with Number tag or % tag (should be treated as summary table)
    // With Number tag: shows sum and mean % rows
    // With both Number and % tags: shows sum and percentage of total rows
    // With % tag only: shows mean summary table
    if (!isSummaryTable && variable.statements) {
      const isNumericGrid = variable.type?.toLowerCase().includes('numeric grid');
      if (isNumericGrid) {
        // Check variable tags first
        let hasNumberTag = (variable as any).tags && Array.isArray((variable as any).tags) && (variable as any).tags.includes('Number');
        let hasPercentTag = (variable as any).tags && Array.isArray((variable as any).tags) && (variable as any).tags.includes('%');
        
        // If not found, check question tags (we need questionnaireQuestions which is passed in context)
        // For now, we'll rely on the variable tags, but this could be enhanced
        if (hasNumberTag || hasPercentTag) {
          isSummaryTable = true;
        }
      }
    }
    
    // Check if this is a scale summary table (T2B, M3B, B2B)
    const isScaleSummary = (variable as any).isScaleSummary && variable.statements;
    
    // For scale summary tables, return empty data (handled separately in rendering)
    if (isScaleSummary) {
      return {};
    }
    
    // Check if this is a numeric question (not a grid, not a summary table, not a list)
    const isNumericQuestion = variable.type?.toLowerCase().includes('numeric') &&
                             !variable.type?.toLowerCase().includes('grid') &&
                             !variable.type?.toLowerCase().includes('list') &&
                             !isSummaryTable &&
                             !isScaleSummary;
    const isMultiSelectGridQuestion = variable.type?.toLowerCase().includes('multi-select grid');

    // console.log(` Question type check for ${selectedBannerVariable}:`, {
    //   variableType: variable.type,
    //   isNumericQuestion,
    //   isSummaryTable,
    //   isScaleSummary
    // });
    
    // For regular variables, we need the stub column header
    // For summary tables, we don't need it (we calculate from statement variables directly)
    // For numeric questions, try to find the column header using the variable name directly
    let stubColumnHeader: string | null = null;
    if (!isSummaryTable) {
      if (isNumericQuestion && selectedBannerVariable) {
        // For numeric questions, use the same logic as getVariableDataFromRawData
        let lookupName = selectedBannerVariable;
        
        // Try variations: original name, with Q prefix, with r1 suffix
        const variations = [
          lookupName,
          lookupName.startsWith('Q') ? lookupName : `Q${lookupName}`,
          lookupName.startsWith('Q') ? lookupName.substring(1) : lookupName,
          `${lookupName}r1`,
          `Q${lookupName}r1`,
          lookupName.startsWith('Q') ? `${lookupName.substring(1)}r1` : `${lookupName}r1`
        ];
        
        // Try to find expected header in columnMapping
        let expectedHeader: string | undefined = undefined;
        for (const variation of variations) {
          if (columnMapping[variation]) {
            expectedHeader = variation;
            break;
          }
          // Try case-insensitive
          const matchingKey = Object.keys(columnMapping).find(
            key => key.toLowerCase() === variation.toLowerCase()
          );
          if (matchingKey) {
            expectedHeader = matchingKey;
            break;
          }
        }
        
        // If found expected header, get the column header
        if (expectedHeader && columnMapping[expectedHeader]) {
          stubColumnHeader = columnMapping[expectedHeader];
        } else if (fullRawData.columns) {
          // Try direct match in fullRawData.columns
          for (const variation of variations) {
            const directMatch = fullRawData.columns.find(
              col => col.toLowerCase() === variation.toLowerCase()
            );
            if (directMatch) {
              stubColumnHeader = directMatch;
              break;
            }
          }
        }
      } else {
        stubColumnHeader = getColumnHeader(selectedBannerVariable);
      }
    }
    
    // For numeric questions and multi-select questions, don't return early if stubColumnHeader is null
    // We'll handle it in their respective blocks
    const isMultiSelectCheck = variable.type?.toLowerCase().includes('multi-select') &&
                               !variable.type?.toLowerCase().includes('grid');

    if (!isSummaryTable && !isNumericQuestion && !isMultiSelectCheck && !isMultiSelectGridQuestion && !stubColumnHeader) {
      // console.log(` Early return for ${selectedBannerVariable}: No stubColumnHeader found`);
      // Return empty object instead of null so the table still renders
      return {};
    }

    // Build column filters
    const columns: Array<{
      id: string;
      title: string;
      filterFn: (row: Record<string, any>) => boolean;
    }> = [
      {
        id: 'total',
        title: 'Total',
        filterFn: () => true // Total includes all rows
      }
    ];

    // Helper: build a predicate for a BannerCut supporting AND/OR and numeric/categorical comparisons
    const makeCutPredicate = (cut: any): ((row: Record<string, any>) => boolean) => {
      const parseNumeric = (s: any): number | null => {
        if (s === null || s === undefined || s === '') return null;
        const n = Number(String(s).trim());
        return isNaN(n) ? null : n;
      };
      const buildNumericChecker = (condStr: string): ((n: number | null) => boolean) => {
        const s = condStr.trim();
        const range = s.match(/^(-?\d+(?:\.\d+)?)\s*-\s*(-?\d+(?:\.\d+)?)$/);
        if (range) {
          const a = Number(range[1]);
          const b = Number(range[2]);
          return (n) => n !== null && n >= a && n <= b;
        }
        const left = s.match(/^(-?\d+(?:\.\d+)?)\s*-\s*$/);
        if (left) {
          const a = Number(left[1]);
          return (n) => n !== null && n >= a;
        }
        const right = s.match(/^\s*-\s*(-?\d+(?:\.\d+)?)$/);
        if (right) {
          const b = Number(right[1]);
          return (n) => n !== null && n <= b;
        }
        const cmp = s.match(/^(>=|<=|>|<|=)\s*(-?\d+(?:\.\d+)?)$/);
        if (cmp) {
          const op = cmp[1];
          const value = Number(cmp[2]);
          return (n) => {
            if (n === null) return false;
            switch (op) {
              case '>=': return n >= value;
              case '<=': return n <= value;
              case '>': return n > value;
              case '<': return n < value;
              case '=': return n === value;
              default: return false;
            }
          };
        }
        const exact = Number(s);
        if (!isNaN(exact)) return (n) => n !== null && n === exact;
        return () => false;
      };
      const matchesCategorical = (row: any, varName: string, codes: string[], isDebug = false): boolean => {
        const header = getColumnHeader(varName);
        if (!header) {
          if (isDebug) console.log(`  ❌ No header found for varName: ${varName}`);
          return false;
        }
        const val = row[header];
        if (val === null || val === undefined || val === '') {
          if (isDebug) console.log(`  ❌ Value is null/undefined/empty for header: ${header}`);
          return false;
        }
        const s = String(val).trim();
        const n = Number(s);
        for (const code of codes) {
          const codeStr = String(code).trim();
          if (s === codeStr) {
            if (isDebug) console.log(`  ✅ Matched: ${s} === ${codeStr}`);
            return true;
          }
          const codeNoC = codeStr.replace(/^[rc]/i, '');
          if (s === codeNoC) {
            if (isDebug) console.log(`  ✅ Matched: ${s} === ${codeNoC} (code without prefix)`);
            return true;
          }
          if (!isNaN(n) && String(n) === codeNoC) {
            if (isDebug) console.log(`  ✅ Matched: ${n} === ${codeNoC} (numeric)`);
            return true;
          }
        }
        if (isDebug) console.log(`  ❌ No match found for value "${s}" against codes:`, codes);
        return false;
      };
      const matchesNumeric = (row: any, varName: string, condStr: string): boolean => {
        const header = getColumnHeader(varName);
        if (!header) return false;
        const val = parseNumeric(row[header]);
        const check = buildNumericChecker(condStr);
        return check(val);
      };
      // Use conditionGroups if present
      if (cut.conditionGroups && Array.isArray(cut.conditionGroups) && cut.conditionGroups.length > 0) {
        const group = cut.conditionGroups[0];
        const op = (group.operator || 'OR').toUpperCase();
        const conds = group.conditions || [];
        let debugRowCount = 0;
        return (row: any) => {
          const isDebug = debugRowCount < 3;
          if (isDebug) {
            debugRowCount++;
            console.log(`🔍 Evaluating cut "${cut.title}" (${op}) on row ${debugRowCount}:`, { operator: op, conditions: conds });
          }
          if (op === 'AND') {
            return conds.every((c: any) => {
              const c0 = c.codes?.[0] || '';
              const isNumericCond = !!c.numericCondition || (/^(>=|<=|>|<|=)/.test(c0) || /^\d+-\d+/.test(c0) || /^\d+-/.test(c0));
              if (isNumericCond) {
                const expr = c.numericCondition || c0;
                return matchesNumeric(row, c.variableName, expr);
              }
              return matchesCategorical(row, c.variableName, c.codes || [], isDebug);
            });
          } else {
            return conds.some((c: any) => {
              const c0 = c.codes?.[0] || '';
              const isNumericCond = !!c.numericCondition || (/^(>=|<=|>|<|=)/.test(c0) || /^\d+-\d+/.test(c0) || /^\d+-/.test(c0));
              if (isNumericCond) {
                const expr = c.numericCondition || c0;
                return matchesNumeric(row, c.variableName, expr);
              }
              return matchesCategorical(row, c.variableName, c.codes || [], isDebug);
            });
          }
        };
      }
      // Fallback: single variable + codes
      if (cut.variableName && Array.isArray(cut.codes) && cut.codes.length > 0) {
        let debugRowCount = 0;
        return (row: any) => {
          const isDebug = debugRowCount < 3;
          if (isDebug) {
            debugRowCount++;
            console.log(`🔍 Evaluating cut "${cut.title}" (fallback) on row ${debugRowCount}:`, { variableName: cut.variableName, codes: cut.codes });
          }
          return matchesCategorical(row, cut.variableName, cut.codes, isDebug);
        };
      }
      // No conditions: never match
      return () => false;
    };

    // Add filters for each banner cut
    bannerGroup.groups?.forEach((group: any) => {
      group.cuts.forEach((cut: any) => {
        console.log(`📊 Creating predicate for banner cut:`, {
          cutId: cut.id,
          cutTitle: cut.title,
          hasConditionGroups: !!cut.conditionGroups,
          conditionGroupsLength: cut.conditionGroups?.length || 0,
          conditionGroups: cut.conditionGroups,
          hasVariableName: !!cut.variableName,
          variableName: cut.variableName,
          codes: cut.codes
        });
        const predicate = makeCutPredicate(cut);
        columns.push({
          id: cut.id,
          title: cut.title,
          filterFn: (row: Record<string, any>) => {
            const result = predicate(row);
            return result;
          }
        });
      });
    });

    // Handle summary tables (numeric grid summaries)
    if (isSummaryTable && variable.statements) {
      const statementData: Record<string, Record<string, { sum: number; mean: number; base: number }>> = {};
      
      const baseName = variable.name.endsWith('_Summary') 
        ? variable.name.replace('_Summary', '') 
        : variable.name;
      
      // For numeric grids, extract column code if present, otherwise default to 'c1'
      const columnMatch = baseName.match(/^([A-Z0-9]+)_(c\d+)$/i);
      const baseQNum = columnMatch ? columnMatch[1] : baseName;
      const columnCode = columnMatch ? columnMatch[2] : 'c1'; // Default to c1 for numeric grids
      
      // For numeric grids with Number tag, we need to sum across ALL response columns
      // Find the question to get all responseOptions
      const isNumericGrid = variable.type?.toLowerCase().includes('numeric grid');
      let allColumnCodes: string[] = [columnCode]; // Default to just the one column
      
      if (isNumericGrid) {
        // Try to find the question to get all responseOptions
        const question = questionnaireQuestions.find(q => {
          const qNum = q.number || q.id;
          return qNum === baseQNum || 
                 qNum === baseQNum.replace(/^Q/, '') ||
                 String(qNum) === String(baseQNum);
        });
        
        if (question && question.responseOptions && Array.isArray(question.responseOptions)) {
          // Generate column codes from responseOptions (c1, c2, c3, etc.)
          allColumnCodes = question.responseOptions.map((_: any, idx: number) => `c${idx + 1}`);
        } else {
          // Fallback: try to find all column codes from columnMapping or fullRawData.columns
          // Look for patterns like Q{baseQNum}r{stmtCode}c{number}
          const foundColumnCodes = new Set<string>();
          if (fullRawData.columns) {
            fullRawData.columns.forEach((col: string) => {
              const match = col.match(new RegExp(`Q?${baseQNum}r\\d+(c\\d+)`, 'i'));
              if (match && match[1]) {
                foundColumnCodes.add(match[1].toLowerCase());
              }
            });
          }
          if (foundColumnCodes.size > 0) {
            allColumnCodes = Array.from(foundColumnCodes).sort((a, b) => {
              const aNum = parseInt(a.replace(/^c/i, ''));
              const bNum = parseInt(b.replace(/^c/i, ''));
              return aNum - bNum;
            });
          }
        }
      }
      
      Object.entries(variable.statements).forEach(([stmtCode, stmtText]) => {
        statementData[stmtCode] = {};
        
        // Normalize statement code (add 'r' prefix if needed)
        let normalizedStmtCode = stmtCode;
        if (!/^r\d+/i.test(stmtCode) && /^\d+$/.test(stmtCode)) {
          normalizedStmtCode = `r${stmtCode}`;
        }
        
        // For numeric grids with Number tag, sum across ALL response columns
        // Find all column headers for this statement across all response columns
        const allStatementColumnHeaders: string[] = [];
        
        allColumnCodes.forEach(colCode => {
          const cellHeader = `Q${baseQNum}${normalizedStmtCode}${colCode}`;
          const variations = [
            cellHeader,
            cellHeader.replace(/^Q/, ''),
            `${baseQNum}${normalizedStmtCode}${colCode}`,
            // Also try underscore format
            `${baseQNum}_${normalizedStmtCode}_${colCode}`,
            `Q${baseQNum}_${normalizedStmtCode}_${colCode}`,
            // Try without 'r' prefix
            `Q${baseQNum}${stmtCode}${colCode}`,
            `${baseQNum}${stmtCode}${colCode}`,
          ];
          
          let statementColumnHeader: string | null = null;
          
          // Try getColumnHeader first
          for (const variation of variations) {
            statementColumnHeader = getColumnHeader(variation);
            if (statementColumnHeader) break;
          }
          
          // If still not found, try direct lookup in columnMapping
          if (!statementColumnHeader) {
            for (const variation of variations) {
              if (columnMapping[variation]) {
                statementColumnHeader = columnMapping[variation];
                break;
              }
              const match = Object.keys(columnMapping).find(k => k.toLowerCase() === variation.toLowerCase());
              if (match) {
                statementColumnHeader = columnMapping[match];
                break;
              }
            }
          }
          
          // If still not found, try direct lookup in fullRawData.columns
          if (!statementColumnHeader && fullRawData.columns) {
            for (const variation of variations) {
              const found = fullRawData.columns.find((c: string) => c.toLowerCase() === variation.toLowerCase());
              if (found) {
                statementColumnHeader = found;
                break;
              }
            }
          }
          
          if (statementColumnHeader) {
            allStatementColumnHeaders.push(statementColumnHeader);
          }
        });
        
        if (allStatementColumnHeaders.length === 0) {
          // Debug: Log missing column header
          if (Object.keys(variable.statements).indexOf(stmtCode) === 0) {
            // console.log(`calculateBannerTableDataForVariable - Missing column header for statement "${stmtCode}":`, {
            //   baseName,
            //   baseQNum,
            //   columnCode,
            //   normalizedStmtCode,
            //   allColumnCodes,
            //   availableColumns: fullRawData.columns?.slice(0, 30).filter((c: string) => c.toLowerCase().includes(baseQNum.toLowerCase()))
            // });
          }
          return;
        }
        
        columns.forEach(column => {
          let base = 0;
          let sum = 0;
          const values: number[] = [];

          filteredRows.forEach((row: any) => {
            const matchesColumn = column.filterFn(row);
            if (!matchesColumn) return;

            // Sum across ALL response columns for this statement
            let rowHasResponse = false;
            allStatementColumnHeaders.forEach(statementColumnHeader => {
              const value = row[statementColumnHeader];
              if (value !== null && value !== undefined && value !== '') {
                const numValue = parseFloat(String(value));
                if (!isNaN(numValue)) {
                  rowHasResponse = true;
                  sum += numValue;
                  values.push(numValue);
                }
              }
            });
            
            // Count base: a row is counted if it has at least one response across all columns
            if (rowHasResponse) {
              base++;
            }
          });

          const mean = values.length > 0 ? sum / values.length : 0;

          statementData[stmtCode][column.id] = {
            sum,
            mean,
            base
          };
        });
      });

      return statementData;
    }

    // Handle numeric questions
    if (isNumericQuestion) {
      if (!stubColumnHeader) {
        return {};
      }
      
      const uniqueNumericValues = new Set<number>();
      
      filteredRows.forEach((row: any) => {
        const stubValue = row[stubColumnHeader];
        if (stubValue !== null && stubValue !== undefined && stubValue !== '') {
          const numValue = parseFloat(String(stubValue));
          if (!isNaN(numValue)) {
            uniqueNumericValues.add(numValue);
          }
        }
      });
      
      const sortedNumericValues = Array.from(uniqueNumericValues).sort((a, b) => a - b);
      const numericData: Record<string, Record<string, { count: number; percentage: number; base: number }>> = {};
      
      sortedNumericValues.forEach(numericValue => {
        const valueKey = String(numericValue);
        numericData[valueKey] = {};
        
        columns.forEach(column => {
          let base = 0;
          let count = 0;

          filteredRows.forEach((row: any) => {
            const matchesColumn = column.filterFn(row);
            if (!matchesColumn) return;

            const stubValue = row[stubColumnHeader];
            if (stubValue !== null && stubValue !== undefined && stubValue !== '') {
              base++;
              
              const numValue = parseFloat(String(stubValue));
              if (!isNaN(numValue) && numValue === numericValue) {
                count++;
              }
            }
          });

          numericData[valueKey][column.id] = {
            count,
            percentage: base > 0 ? (count / base) * 100 : 0,
            base
          };
        });
      });
      
      return numericData;
    }

    // Handle multi-select questions (not grids)
    const isMultiSelectQuestion = variable.type?.toLowerCase().includes('multi-select') &&
                                 !variable.type?.toLowerCase().includes('grid');

    const isMultiSelectGrid = variable.type?.toLowerCase().includes('multi-select grid') ||
                             (variable.type?.toLowerCase().includes('multi-select') &&
                              variable.type?.toLowerCase().includes('grid'));

    const getMultiSelectNoteItems = (variableRef: any): Array<{ code: string; text: string }> => {
      const baseQuestionNumber = getBaseQuestionNumber(variableRef?.name || selectedBannerVariable);
      const normalizedBase = baseQuestionNumber.replace(/^Q/i, '');
      const question = questionnaireQuestions.find((q: any) => {
        const qNum = q.number || q.id;
        if (!qNum) return false;
        const qStr = String(qNum);
        const normalizedQ = qStr.replace(/^Q/i, '');
        return qStr === baseQuestionNumber ||
               normalizedQ === normalizedBase ||
               qStr === normalizedBase ||
               `Q${normalizedQ}` === baseQuestionNumber;
      });
      const notes = (question as any)?.notes;
      if (!Array.isArray(notes) || notes.length === 0) return [];
      const items: Array<{ code: string; text: string }> = [];
      notes.forEach((n: any) => {
        const s = String(n || '').trim();
        if (!s) return;
        const match = s.match(/^\[([^\]]+)\]\s*(.*)$/);
        if (!match) return;
        const id = String(match[1] || '').trim();
        const label = String(match[2] || '').trim();
        if (!id) return;
        items.push({ code: id, text: label || id });
      });
      const seen = new Set<string>();
      return items.filter((it) => {
        const key = it.code.toLowerCase();
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
    };

    const multiSelectNoteItems = isMultiSelectQuestion ? getMultiSelectNoteItems(variable) : [];
    const multiSelectCodes = multiSelectNoteItems.length > 0
      ? multiSelectNoteItems.map((item) => item.code)
      : Object.keys(variable.codes || {});

    // console.log(` Multi-select check for ${selectedBannerVariable}:`, {
    //   variableType: variable.type,
    //   isMultiSelectQuestion,
    //   hasCodes: !!variable.codes,
    //   codesCount: multiSelectCodes.length,
    //   hasNoteItems: multiSelectNoteItems.length > 0,
    //   willEnterMultiSelectBlock: isMultiSelectQuestion && multiSelectCodes.length > 0
    // });

    if (isMultiSelectQuestion && multiSelectCodes.length > 0) {
      const codeData: Record<string, Record<string, { count: number; percentage: number; base: number }>> = {};
      // Use the variable name directly (e.g., "G7") - don't extract base number
      const variableName = selectedBannerVariable.replace(/^Q/, '');

      // console.log(` MULTI-SELECT calculateBannerTableDataForVariable - ${selectedBannerVariable}:`, {
      //   variableName,
      //   variableCodes: multiSelectCodes,
      //   hasColumnMapping: !!columnMapping && Object.keys(columnMapping).length > 0,
      //   columnMappingSize: columnMapping ? Object.keys(columnMapping).length : 0,
      //   hasFullRawData: !!fullRawData && !!fullRawData.columns,
      //   fullRawDataColumnsCount: fullRawData?.columns?.length || 0,
      //   sampleColumnMapping: Object.keys(columnMapping).filter(k => k.toLowerCase().includes(variableName.toLowerCase())).slice(0, 20),
      //   sampleRawColumns: fullRawData.columns?.filter((c: string) => c.toLowerCase().includes(variableName.toLowerCase())).slice(0, 30)
      // });

      const multiSelectColMap: Record<string, string | null> = {};
      multiSelectCodes.forEach(code => {
        const rawCode = String(code || '').trim();
        if (!rawCode) return;
        const baseQuestionNumber = getBaseQuestionNumber(variableName);
        const normalizedBase = baseQuestionNumber.replace(/^Q/i, '');
        const codeNum = rawCode.replace(/^[rc]/i, '');
        const isNumericCode = /^\d+$/.test(rawCode);

        const variations = new Set<string>();
        const add = (value?: string) => {
          if (!value) return;
          variations.add(value);
        };
        const addDirect = (prefix: string) => {
          add(`${prefix}${rawCode}`);
          add(`${prefix}_${rawCode}`);
        };
        const prefixes = [variableName, baseQuestionNumber, normalizedBase, `Q${normalizedBase}`]
          .filter(Boolean);
        const startsWithKnownPrefix = prefixes.some((prefix) =>
          rawCode.toLowerCase().startsWith(String(prefix).toLowerCase())
        );

        add(rawCode);
        add(rawCode.replace(/^Q/i, ''));
        if (!rawCode.startsWith('Q')) {
          add(`Q${rawCode}`);
        }
        if (!startsWithKnownPrefix) {
          addDirect(variableName);
          addDirect(baseQuestionNumber);
          addDirect(normalizedBase);
          addDirect(`Q${normalizedBase}`);
        }

        if (rawCode !== codeNum) {
          add(`${variableName}r${codeNum}`);
          add(`${variableName}c${codeNum}`);
          add(`${baseQuestionNumber}r${codeNum}`);
          add(`${baseQuestionNumber}c${codeNum}`);
          add(`Q${normalizedBase}r${codeNum}`);
          add(`Q${normalizedBase}c${codeNum}`);
          add(`${normalizedBase}r${codeNum}`);
          add(`${normalizedBase}c${codeNum}`);
        } else if (isNumericCode) {
          add(`${variableName}r${rawCode}`);
          add(`${variableName}c${rawCode}`);
          add(`${baseQuestionNumber}r${rawCode}`);
          add(`${baseQuestionNumber}c${rawCode}`);
          add(`Q${normalizedBase}r${rawCode}`);
          add(`Q${normalizedBase}c${rawCode}`);
          add(`${normalizedBase}r${rawCode}`);
          add(`${normalizedBase}c${rawCode}`);
        }

        let colHeader: string | null = null;

        // First, try columnMapping (this is the data map)
        for (const v of variations) {
          if (columnMapping[v]) {
            colHeader = columnMapping[v];
            break;
          }
          // Case-insensitive match in columnMapping keys
          const match = Object.keys(columnMapping).find(k => k.toLowerCase() === v.toLowerCase());
          if (match) {
            colHeader = columnMapping[match];
            break;
          }
        }
        
        // Fallback: search in raw data columns if not found in columnMapping
        if (!colHeader && fullRawData.columns) {
          for (const v of variations) {
            const found = fullRawData.columns.find((c: string) => c.toLowerCase() === v.toLowerCase());
            if (found) {
              colHeader = found;
              break;
            }
          }
        }
        
        multiSelectColMap[code] = colHeader;

        if (code === multiSelectCodes[0]) {
          console.log(` MULTI-SELECT COLUMN MAPPING - ${selectedBannerVariable}, Code "${code}":`, {
            code,
            codeNum,
            variations: Array.from(variations),
            foundColHeader: colHeader,
            columnMappingHasKey: Array.from(variations).some(v => columnMapping[v]),
            columnMappingKeys: Object.keys(columnMapping).filter(k => {
              const lower = k.toLowerCase();
              return Array.from(variations).some(v => lower.includes(v.toLowerCase()));
            }),
            rawColumnsMatch: fullRawData.columns?.some((c: string) => Array.from(variations).some(v => c.toLowerCase() === v.toLowerCase()))
          });
        }
      });
      
      const foundColumns = Object.values(multiSelectColMap).filter(h => h !== null);
      // console.log(` MULTI-SELECT COLUMN MAPPING SUMMARY - ${selectedBannerVariable}:`, {
      //   totalCodes: multiSelectCodes.length,
      //   foundColumns: foundColumns.length,
      //   foundColumnHeaders: foundColumns,
      //   missingColumns: Object.entries(multiSelectColMap).filter(([code, header]) => !header).map(([code]) => code),
      //   columnMappingSample: Object.keys(columnMapping).filter(k => k.toLowerCase().includes(variableName.toLowerCase())).slice(0, 10)
      // });

      const validRowIndices = new Set<number>();
      const firstCode = multiSelectCodes[0];
      const firstHeader = firstCode ? multiSelectColMap[firstCode] : null;
      if (firstHeader) {
        const firstCellData = getVariableDataByExpectedHeader(firstHeader);
        if (firstCellData && firstCellData.values && Array.isArray(firstCellData.values)) {
          firstCellData.values.forEach((v: any, idx: number) => {
            if (v !== null && v !== undefined && v !== '' && String(v).trim() !== '') {
              validRowIndices.add(idx);
            }
          });
        }
      }

      if (foundColumns.length === 0) {
        const baseQuestionNumber = getBaseQuestionNumber(variable.name);
        const normalizedBase = baseQuestionNumber.replace(/^Q/i, '');
        const stubColumnHeader = getColumnHeader(selectedBannerVariable)
          || getColumnHeader(variable.name)
          || getColumnHeader(baseQuestionNumber)
          || getColumnHeader(normalizedBase);
        if (!stubColumnHeader) {
          return {};
        }

        const valueToCodeMap: Record<string, string> = {};
        multiSelectCodes.forEach((code, idx) => {
          const codeStr = String(code);
          valueToCodeMap[codeStr] = codeStr;
          valueToCodeMap[codeStr.toLowerCase()] = codeStr;
          valueToCodeMap[codeStr.toUpperCase()] = codeStr;
          const numericMatch = codeStr.match(/(\d+)$/);
          if (numericMatch) {
            const numericPart = numericMatch[1];
            valueToCodeMap[numericPart] = codeStr;
            valueToCodeMap[String(parseInt(numericPart, 10))] = codeStr;
          }
          valueToCodeMap[String(idx + 1)] = codeStr;
        });

        const mapTokensToCodes = (val: any): string[] => {
          const tokens: string[] = [];
          if (Array.isArray(val)) {
            val.forEach(item => {
              const s = String(item ?? '').trim();
              if (s) tokens.push(s);
            });
          } else {
            const s = String(val ?? '').trim();
            if (!s) return tokens;
            if (s.includes(',')) {
              s.split(',').map(part => part.trim()).filter(Boolean).forEach(part => tokens.push(part));
            } else {
              tokens.push(s);
            }
          }
          return tokens.map(t => valueToCodeMap[t] || valueToCodeMap[t.toLowerCase()] || valueToCodeMap[t.toUpperCase()] || t);
        };

        const columnsList = columns;
        columnsList.forEach(column => {
          let base = 0;
          const counts: Record<string, number> = {};
          multiSelectCodes.forEach(code => { counts[code] = 0; });

          filteredRows.forEach(row => {
            const matchesColumn = column.filterFn(row);
            if (!matchesColumn) return;
            const rawVal = row[stubColumnHeader];
            if (rawVal === null || rawVal === undefined || rawVal === '') return;
            const selections = mapTokensToCodes(rawVal);
            if (selections.length === 0) return;
            base++;
            selections.forEach(sel => {
              if (counts.hasOwnProperty(sel)) {
                counts[sel]++;
              }
            });
          });

          multiSelectCodes.forEach(code => {
            if (!codeData[code]) codeData[code] = {};
            codeData[code][column.id] = {
              count: counts[code] || 0,
              percentage: base > 0 ? (counts[code] / base) * 100 : 0,
              base
            };
          });
        });

        return codeData;
      }

      multiSelectCodes.forEach(code => {
        codeData[code] = {};
        const codeColHeader = multiSelectColMap[code];

        columns.forEach(column => {
          let base = 0;
          let count = 0;

          filteredRows.forEach((row: any, rowIdx: number) => {
            if (validRowIndices.size > 0 && !validRowIndices.has(rowIdx)) return;

            const matchesColumn = column.filterFn(row);
            if (!matchesColumn) return;

            let respondentAnswered = false;
            multiSelectCodes.forEach(c => {
              const colHeader = multiSelectColMap[c];
              if (colHeader) {
                const val = row[colHeader];
                if (val !== null && val !== undefined && val !== '') {
                  respondentAnswered = true;
                }
              }
            });

            if (respondentAnswered) {
              base++;
              if (codeColHeader) {
                const val = row[codeColHeader];
                if (val === 1 || val === '1' || val === true) {
                  count++;
                }
              }
            }
          });

          codeData[code][column.id] = {
            count,
            percentage: base > 0 ? (count / base) * 100 : 0,
            base
          };
        });
      });
      
      // Debug: Log data calculation results
      const codesWithData = Object.keys(codeData).filter(code => {
        const codeDataEntry = codeData[code];
        return Object.values(codeDataEntry).some(colData => colData.count > 0 || colData.base > 0);
      });
      // console.log(` MULTI-SELECT DATA CALCULATION - ${selectedBannerVariable}:`, {
      //   totalCodes: multiSelectCodes.length,
      //   codesWithData: codesWithData.length,
      //   codesWithDataList: codesWithData,
      //   sampleCodeData: codesWithData.length > 0 ? codeData[codesWithData[0]] : null,
      //   totalDataEntries: Object.keys(codeData).length
      // });

      return codeData;
    }

    // Handle multi-select grids
    if (isMultiSelectGrid && variable.statements && variable.codes) {
      const gridData: Record<string, Record<string, Record<string, { count: number; percentage: number; base: number }>>> = {};
      const baseNumber = selectedBannerVariable.replace(/^Q/, '');

      Object.keys(variable.codes).forEach(colCode => {
        gridData[colCode] = {};

        const gridColMap: Record<string, string | null> = {};
        Object.keys(variable.statements || {}).forEach(stmtCode => {
          const cellHeader = `Q${baseNumber}${stmtCode}${colCode}`;
          let colHeader: string | null = null;
          const variations = [cellHeader, cellHeader.replace(/^Q/, '')];
          for (const v of variations) {
            if (columnMapping[v]) { colHeader = columnMapping[v]; break; }
            const match = Object.keys(columnMapping).find(k => k.toLowerCase() === v.toLowerCase());
            if (match) { colHeader = columnMapping[match]; break; }
          }
          if (!colHeader && fullRawData.columns) {
            for (const v of variations) {
              const found = fullRawData.columns.find((c: string) => c.toLowerCase() === v.toLowerCase());
              if (found) { colHeader = found; break; }
            }
          }
          gridColMap[stmtCode] = colHeader;
        });

        const validRowIndices = new Set<number>();
        const firstStmtCode = Object.keys(variable.statements || {})[0];
        if (firstStmtCode) {
          const firstCellHeader = `Q${baseNumber}${firstStmtCode}${colCode}`;
          const firstCellData = getVariableDataByExpectedHeader(firstCellHeader);
          if (firstCellData && firstCellData.values && Array.isArray(firstCellData.values)) {
            firstCellData.values.forEach((v: any, idx: number) => {
              if (v !== null && v !== undefined && v !== '' && String(v).trim() !== '') {
                validRowIndices.add(idx);
              }
            });
          }
        }

        Object.keys(variable.statements || {}).forEach(stmtCode => {
          gridData[colCode][stmtCode] = {};
          const stmtColHeader = gridColMap[stmtCode];

          columns.forEach(column => {
            let base = 0;
            let count = 0;

            filteredRows.forEach((row: any, rowIdx: number) => {
              if (validRowIndices.size > 0 && !validRowIndices.has(rowIdx)) return;

              const matchesColumn = column.filterFn(row);
              if (!matchesColumn) return;

              let respondentAnswered = false;
              Object.keys(variable.statements || {}).forEach(sc => {
                const colHeader = gridColMap[sc];
                if (colHeader) {
                  const val = row[colHeader];
                  if (val !== null && val !== undefined && val !== '') {
                    respondentAnswered = true;
                  }
                }
              });

              if (respondentAnswered) {
                base++;
                if (stmtColHeader) {
                  const val = row[stmtColHeader];
                  if (val === 1 || val === '1' || val === true) {
                    count++;
                  }
                }
              }
            });

            gridData[colCode][stmtCode][column.id] = {
              count,
              percentage: base > 0 ? (count / base) * 100 : 0,
              base
            };
          });
        });
      });

      return gridData;
    }

    // Handle regular categorical variables
    const codeData: Record<string, Record<string, { count: number; percentage: number; base: number }>> = {};
    const baseQuestionNumber = getBaseQuestionNumber(variable.name);
    const normalizedBase = baseQuestionNumber.replace(/^Q/i, '');
    const matchingQuestion = questionnaireQuestions.find((q: any) => {
      const qNum = q.number || q.id;
      if (!qNum) return false;
      const qStr = String(qNum);
      const normalizedQ = qStr.replace(/^Q/i, '');
      return qStr === baseQuestionNumber ||
             normalizedQ === normalizedBase ||
             qStr === normalizedBase ||
             `Q${normalizedQ}` === baseQuestionNumber;
    });
    const codeSource: Record<string, string> = (() => {
      if (variable.codes && Object.keys(variable.codes).length > 0) {
        return variable.codes as Record<string, string>;
      }
      if (matchingQuestion && Array.isArray(matchingQuestion.responseOptions)) {
        const fallback: Record<string, string> = {};
        matchingQuestion.responseOptions.forEach((opt: any, idx: number) => {
          if (typeof opt === 'string') {
            const code = `c${idx + 1}`;
            fallback[code] = opt;
            return;
          }
          const code = opt.code || `c${idx + 1}`;
          const label = opt.text || opt.label || opt.value || opt.code || code;
          fallback[String(code)] = String(label);
        });
        return fallback;
      }
      return {};
    })();
    const codeKeys = Object.keys(codeSource);

    if (codeKeys.length > 0) {
      // Debug: Log first few values to understand data format
      const debugValues = new Set<string>();
      if (stubColumnHeader && filteredRows.length > 0) {
        filteredRows.slice(0, 10).forEach((row: any) => {
          const val = row[stubColumnHeader];
          if (val !== null && val !== undefined && val !== '') {
            debugValues.add(String(val));
          }
        });
        if (debugValues.size > 0 && selectedBannerVariable === 'S1') {
          // console.log(`Code matching debug for ${selectedBannerVariable}: Sample values in data:`, Array.from(debugValues));
          // console.log(`Code matching debug for ${selectedBannerVariable}: Codes we're looking for:`, Object.keys(variable.codes));
        }
      }
      
      codeKeys.forEach(code => {
        codeData[code] = {};

        columns.forEach(column => {
          let base = 0;
          let count = 0;

          filteredRows.forEach((row: any) => {
            const matchesColumn = column.filterFn(row);
            if (!matchesColumn) return;

            // Base should only increment if the question was answered (stub value is not null/undefined/empty)
            const stubValue = stubColumnHeader ? row[stubColumnHeader] : null;
            if (stubValue !== null && stubValue !== undefined && stubValue !== '') {
              base++;

              const stubValueStr = String(stubValue).trim();

              // Try multiple matching strategies
              let matches = false;
              
              // Direct match
              if (stubValueStr === code || String(stubValue) === code) {
                matches = true;
              }
              // Numeric match
              else if (!isNaN(Number(stubValue)) && !isNaN(Number(code)) && Number(stubValue) === Number(code)) {
                matches = true;
              }
              // Match code without prefix (e.g., "c1" matches "1")
              else {
                const codeWithoutPrefix = code.replace(/^[rc]/i, '');
                const stubNum = Number(stubValueStr);
                const codeNum = Number(codeWithoutPrefix);
                if (!isNaN(stubNum) && !isNaN(codeNum) && stubNum === codeNum) {
                  matches = true;
                }
                // Match stub value with prefix to code (e.g., "1" matches "c1" or "r1")
                else if (!isNaN(stubNum) && (stubValueStr === `c${codeWithoutPrefix}` || stubValueStr === `r${codeWithoutPrefix}` || stubValueStr === `C${codeWithoutPrefix}` || stubValueStr === `R${codeWithoutPrefix}`)) {
                  matches = true;
                }
                // Match code label
                else {
                  const codeLabel = codeSource?.[code];
                  if (codeLabel && String(codeLabel).trim() === stubValueStr) {
                    matches = true;
                  }
                }
              }
              
              if (matches) {
                count++;
              }
            }
          });

          codeData[code][column.id] = {
            count,
            percentage: base > 0 ? (count / base) * 100 : 0,
            base
          };
        });
      });
    }

    return codeData;
  }, [fullRawData, columnMapping, variables, getVariableDataByExpectedHeader, bannerFilterConditions, rowMatchesFilterConditions, questionnaireQuestions]);
  const getEffectiveSortByFrequency = useCallback((variable: Variable): boolean => {
    const stored = variableSortByFrequency[variable.name];
    return stored !== undefined ? stored : getDefaultSortFlagForVariable(variable);
  }, [variableSortByFrequency]);

  return {
    formatPercentage,
    getCodeValueForMean,
    rowMatchesFilterConditions,
    calculateBannerTableDataForVariable,
    getEffectiveSortByFrequency,
  };
};
