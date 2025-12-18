import React from 'react';
import { VariableListSidebar } from './VariableListSidebar';
import { VariableTablePlaceholders } from './VariableTablePlaceholders';
import { Variable } from '../../utils/tabs/types';
import { getTableOptionsForVariable } from '../../utils/tabs/tableOptions';
import { getBaseQuestionNumber, detect7ptScale } from '../../utils/tabs/questionHelpers';
import {
  buildResponseValueMap,
  countCheckedForItemColumn,
  countRespondentsWithData,
  getMultiSelectResponseCounts,
  parseMultiSelectNotes,
} from '../../utils/tabs/chartHelpers';

interface VariablesViewProps {
  variables: Variable[];
  filteredVariables: Variable[];
  selectedVariable: string | null;
  onSelectVariable: (variableName: string | null) => void;
  variableFilter: string;
  onVariableFilterChange: (filter: string) => void;
  questionTypeFilter: string;
  onQuestionTypeFilterChange: (filter: string) => void;
  showQuestionTypeFilter: boolean;
  onToggleQuestionTypeFilter: () => void;
  loading: boolean;
  loadingFullRawData: boolean;
  getVariableDataByExpectedHeader: (expectedHeader: string) => any;
  questionnaireQuestions: any[];
  columnMapping: Record<string, string>;
  columnHeaders: string[];
  fullRawData: any;
  datamapData: any;
  dataMappingMemo: any;
  hiddenFromBanners: Set<string>;
  getExpectedHeadersForQuestion: (question: any, baseQuestionNumber?: string) => string[];
  convertHiddenVariableToExpectedHeader: (variableName: string) => string | null;
  netSummaryTableSelectedCodes: Record<string, Array<{ name: string; codes: string[] }>>;
  variableTableSelections: Record<string, Set<string>>;
  summaryTableSortSelections: Record<string, Set<string>>;
  variableSortByFrequency: Record<string, boolean>;
  variableHoldResponseCodes: Record<string, string[]>;
  getStatsSelectionsForVariable: (variableName: string) => any;
  isRawPlan?: boolean;
}

const BRAND_ORANGE = '#D14A2D';
const LIGHT_BRAND_ORANGE = '#F6B8A5';
const B2B_GRAY = '#9CA3AF';
const DARK_TEXT = '#111827';
// Custom palette for stacked bars (first is top). Brand Orange full, then 80%, 60%; then Brand Gray 60%, 80%, 100%; then Blue full/80/60; then Green full/80/60; then Red full/80/60.
const GRID_BAR_COLORS = [
  '#D14A2D', 'rgba(209, 74, 45, 0.8)', 'rgba(209, 74, 45, 0.6)',
  'rgba(93, 95, 98, 0.6)', 'rgba(93, 95, 98, 0.8)', '#5D5F62',
  '#2563EB', 'rgba(37, 99, 235, 0.8)', 'rgba(37, 99, 235, 0.6)',
  '#16A34A', 'rgba(22, 163, 74, 0.8)', 'rgba(22, 163, 74, 0.6)',
  '#DC2626', 'rgba(220, 38, 38, 0.8)', 'rgba(220, 38, 38, 0.6)',
];

export const VariablesView: React.FC<VariablesViewProps> = ({
  variables,
  filteredVariables,
  selectedVariable,
  onSelectVariable,
  variableFilter,
  onVariableFilterChange,
  questionTypeFilter,
  onQuestionTypeFilterChange,
  showQuestionTypeFilter,
  onToggleQuestionTypeFilter,
  loading,
  loadingFullRawData,
  getVariableDataByExpectedHeader,
  questionnaireQuestions,
  columnMapping,
  columnHeaders,
  fullRawData,
  datamapData,
  dataMappingMemo,
  hiddenFromBanners,
  getExpectedHeadersForQuestion,
  convertHiddenVariableToExpectedHeader,
  netSummaryTableSelectedCodes,
  variableTableSelections,
  summaryTableSortSelections,
  variableSortByFrequency,
  variableHoldResponseCodes,
  getStatsSelectionsForVariable,
  isRawPlan = false,
}) => {
  const [tableVariable, setTableVariable] = React.useState<string | null>(selectedVariable);
  const [isPending, startTransition] = React.useTransition();
  const [chartStatus, setChartStatus] = React.useState<'table' | 'loading' | 'chart'>('table');
  const [cachedCharts, setCachedCharts] = React.useState<Record<string, boolean>>({});
  const [hasJustCopied, setHasJustCopied] = React.useState(false);
  const chartTimerRef = React.useRef<number | null>(null);

  React.useEffect(() => {
    startTransition(() => {
      setTableVariable(selectedVariable);
    });
  }, [selectedVariable]);

  React.useEffect(() => {
    if (chartTimerRef.current) {
      window.clearTimeout(chartTimerRef.current);
      chartTimerRef.current = null;
    }
    setChartStatus('table');
  }, [selectedVariable]);

  React.useEffect(() => {
    return () => {
      if (chartTimerRef.current) {
        window.clearTimeout(chartTimerRef.current);
      }
    };
  }, []);

  const startChartGeneration = () => {
    if (!selectedVariable) return;
    if (cachedCharts[selectedVariable]) {
      setChartStatus('chart');
      return;
    }

    if (chartTimerRef.current) {
      window.clearTimeout(chartTimerRef.current);
    }
    setChartStatus('loading');
    chartTimerRef.current = window.setTimeout(() => {
      setChartStatus('chart');
      setCachedCharts(prev => ({
        ...prev,
        [selectedVariable]: true,
      }));
      chartTimerRef.current = null;
    }, 1500);
  };

  const selectedVar = selectedVariable ? variables.find(v => v.name === selectedVariable) : null;
  const tableVar = tableVariable ? variables.find(v => v.name === tableVariable) : null;
  const tableOptions = tableVar
    ? getTableOptionsForVariable(tableVar, questionnaireQuestions, netSummaryTableSelectedCodes)
    : [];
  const statsSelections = tableVar ? getStatsSelectionsForVariable(tableVar.name) : null;
  const typeLower = selectedVar?.type?.toLowerCase() || '';
  const isMultiSelectGrid = typeLower.includes('multi-select grid');
  const isOpenEndListType = typeLower.includes('open end list');
  const isNumericGrid = typeLower.includes('numeric grid');
  const isMultiSelect = typeLower.includes('multi-select') && !typeLower.includes('grid');
  const isSingleSelectGrid = typeLower.includes('single select grid');
  const isSingleSelectQuestion =
    typeLower.includes('single select') && !typeLower.includes('grid') && !isMultiSelect;
  const summarySortDefaultsToOn = isMultiSelectGrid || isOpenEndListType;
  const baseQuestionNumber = selectedVar ? getBaseQuestionNumber(selectedVar.name) : '';

  const matchingQuestion = React.useMemo(() => {
    if (!selectedVar) return null;
    return questionnaireQuestions.find(question => {
      const qNum = question.number || question.id;
      if (!qNum) return false;
      const qNumStr = String(qNum);
      const normalizedQNum = qNumStr.replace(/^Q/i, '');
      const normalizedBase = baseQuestionNumber.replace(/^Q/i, '');
      return (
        qNumStr === baseQuestionNumber ||
        normalizedQNum === normalizedBase ||
        `Q${normalizedQNum}` === baseQuestionNumber ||
        `Q${normalizedBase}` === qNumStr
      );
    });
  }, [selectedVar, questionnaireQuestions, baseQuestionNumber]);

  const columnCodeMatch = selectedVar?.name.match(/c\d+/i);
  const columnCode = columnCodeMatch ? columnCodeMatch[0].toLowerCase() : '';
  const columnCount = (() => {
    if (selectedVar?.codes && Object.keys(selectedVar.codes).length > 0) {
      return Object.keys(selectedVar.codes).length;
    }
    if (matchingQuestion?.responseOptions && Array.isArray(matchingQuestion.responseOptions)) {
      return matchingQuestion.responseOptions.length;
    }
    return 0;
  })();

  const columnStatementsFromNotes = React.useMemo(() => {
    if (!matchingQuestion || !Array.isArray(matchingQuestion.notes) || matchingQuestion.notes.length === 0) {
      return [];
    }
    const baseNormalized = baseQuestionNumber.replace(/^Q/i, '').toLowerCase();
    const statementsMap = new Map<string, { code: string; text: string }>();

    matchingQuestion.notes.forEach((note: any) => {
      if (!note || typeof note !== 'string') return;
      const match = note.match(/^\[Q?([^\]]+)\]\s*(.*)$/i);
      if (!match) return;
      const codePart = match[1] || '';
      const text = (match[2] || '').trim();
      const normalizedCode = codePart.replace(/^Q/i, '');
      const noteBase = normalizedCode.replace(/r\d+/gi, '').replace(/c\d+/gi, '').toLowerCase();
      if (!noteBase) return;
      if (baseNormalized && noteBase !== baseNormalized && noteBase.replace(/^q/i, '') !== baseNormalized) {
        return;
      }
      const rowMatch = normalizedCode.match(/r\d+/i);
      const rowCode = rowMatch ? rowMatch[0].toLowerCase() : '';
      const noteColumnMatch = normalizedCode.match(/c\d+/i);
      const noteColumn = noteColumnMatch ? noteColumnMatch[0].toLowerCase() : '';
      if (columnCode && noteColumn && noteColumn !== columnCode) return;
      if (!rowCode) return;

      if (!statementsMap.has(rowCode)) {
        statementsMap.set(rowCode, {
          code: rowCode,
          text: text || rowCode,
        });
      }
    });

    return Array.from(statementsMap.values()).sort((a, b) => {
      const aNum = parseInt(a.code.replace(/[^\d]/g, ''), 10);
      const bNum = parseInt(b.code.replace(/[^\d]/g, ''), 10);
      if (!isNaN(aNum) && !isNaN(bNum)) {
        return aNum - bNum;
      }
      return a.code.localeCompare(b.code);
    });
  }, [matchingQuestion, columnCode, baseQuestionNumber]);

  const responseOptions = React.useMemo(() => {
    if (!selectedVar) return [];
    if (selectedVar.codes && Object.keys(selectedVar.codes).length > 0) {
      return Object.entries(selectedVar.codes).map(([code, text]) => ({
        code,
        text: String(text || code),
      }));
    }

    if (matchingQuestion && Array.isArray(matchingQuestion.responseOptions)) {
      return matchingQuestion.responseOptions.map((opt: any, idx: number) => {
        if (typeof opt === 'string') {
          return { code: `c${idx + 1}`, text: opt };
        }
        return {
          code: opt.code || `c${idx + 1}`,
          text: opt.text || opt.label || opt.value || opt.code || `Option ${idx + 1}`,
        };
      });
    }
    return [];
  }, [selectedVar, matchingQuestion]);

  const responseValueMap = React.useMemo(() => buildResponseValueMap(responseOptions), [responseOptions]);
  const scaleDetection = React.useMemo(() => detect7ptScale(responseOptions), [responseOptions]);
  const datamapMatchesForSelected = React.useMemo(() => {
    if (!datamapData?.parsedQuestions || !selectedVar) return [];
    const base = baseQuestionNumber.replace(/^Q/i, '').toLowerCase();
    const columnCodes = new Set(
      responseOptions.map(opt => String(opt.code || '').replace(/^c/i, '').toLowerCase()).filter(Boolean)
    );

    const allMatches = datamapData.parsedQuestions.filter((q: any) => {
      const qnum = String(q?.questionNumber || q?.id || '').replace(/^Q/i, '').toLowerCase();
      return qnum.startsWith(base);
    });

    if (columnCodes.size === 0) return allMatches;

    const filtered = allMatches.filter((q: any) => {
      const qnum = String(q?.questionNumber || '').toLowerCase();
      return Array.from(columnCodes).some(code => qnum.includes(`c${code}`) || qnum.endsWith(code));
    });

    return filtered.length > 0 ? filtered : allMatches;
  }, [datamapData?.parsedQuestions, selectedVar, baseQuestionNumber, responseOptions]);

  const multiSelectGridQuestionTexts = React.useMemo(() => {
    if (!isMultiSelectGrid || datamapMatchesForSelected.length === 0) return [];
    const seen = new Set<string>();
    const texts = datamapMatchesForSelected
      .map((q: any) => q.questionText || q.text || q.description || q.question || '')
      .filter(Boolean)
      .map((t: string) => t.trim());
    return texts.filter(t => {
      const key = t.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }, [datamapMatchesForSelected, isMultiSelectGrid]);

  const multiSelectGridQuestionLines = React.useMemo(() => {
    if (!isMultiSelectGrid || multiSelectGridQuestionTexts.length === 0) return null;
    return multiSelectGridQuestionTexts.map((text, idx) => ({
      key: `qline-${idx}`,
      fullText: text.trim(),
    }));
  }, [isMultiSelectGrid, multiSelectGridQuestionTexts]);
  const multiGridColumnHeaderOverrides = React.useMemo(() => {
    if (!isMultiSelectGrid || !Array.isArray(multiSelectGridQuestionLines)) return undefined;
    return multiSelectGridQuestionLines.reduce((acc: Record<string, string>, line, idx) => {
      const opt = responseOptions[idx];
      if (opt && line.fullText) {
        acc[opt.code] = line.fullText;
        acc[opt.text] = line.fullText;
      }
      return acc;
    }, {});
  }, [isMultiSelectGrid, multiSelectGridQuestionLines, responseOptions]);
  const formatGridColumnLabel = React.useCallback((raw: string | undefined | null) => {
    const headerLabel = raw || '';
    const parts = headerLabel.split(' - ');
    return parts.length >= 2 ? parts.slice(0, -1).join(' - ') : headerLabel;
  }, []);
  const multiSelectGridStatements = React.useMemo(() => {
    const fromNotes = columnStatementsFromNotes;
    if (fromNotes.length > 0) {
      return fromNotes.map((row, idx) => ({
        code: String(row.code ?? `r${idx + 1}`),
        text: String(row.text ?? row.code ?? `Row ${idx + 1}`),
      }));
    }

    if (selectedVar?.statements && Object.keys(selectedVar.statements).length > 0) {
      return Object.entries(selectedVar.statements).map(([code, text]) => ({
        code: String(code),
        text: String(text ?? code),
      }));
    }

    if (Array.isArray((matchingQuestion as any)?.statementOptions) && (matchingQuestion as any)?.statementOptions.length > 0) {
      return (matchingQuestion as any).statementOptions.map((opt: any, idx: number) => ({
        code: String(opt.code ?? opt.id ?? `r${idx + 1}`),
        text: String(opt.text ?? opt.label ?? opt.value ?? opt.name ?? `Row ${idx + 1}`),
      }));
    }

    return [{ code: 'r1', text: selectedVar?.name || 'Row 1' }];
  }, [columnStatementsFromNotes, matchingQuestion, selectedVar?.name, selectedVar?.statements]);
  const debugMultiSelectGridMeta = React.useMemo(() => {
    return {
      questionText: matchingQuestion?.text || matchingQuestion?.question || matchingQuestion?.description || '',
      statements: multiSelectGridStatements,
      responseOptions: responseOptions.map(opt => ({ code: opt.code, text: opt.text })),
    };
  }, [matchingQuestion?.description, matchingQuestion?.question, matchingQuestion?.text, multiSelectGridStatements, responseOptions]);

  const getTotalRespondents = React.useCallback(() => {
    const rows = fullRawData?.rows;
    if (Array.isArray(rows) && rows.length > 0) {
      const valid = rows.filter((r: any) => {
        const recordValue = r?.record ?? r?.respno ?? r?.respNo ?? r?.Record ?? r?.Respno ?? r?.RECORD ?? r?.RESPNO;
        if (recordValue === null || recordValue === undefined) return true;
        if (typeof recordValue === 'string') return recordValue.trim() !== '';
        return true;
      });
      return valid.length || rows.length;
    }
    return countRespondentsWithData(selectedVar?.name || '', getVariableDataByExpectedHeader);
  }, [countRespondentsWithData, fullRawData, getVariableDataByExpectedHeader, selectedVar?.name]);

  const singleSelectChartPayload = React.useMemo(() => {
    if (!selectedVar || !getVariableDataByExpectedHeader || !isSingleSelectQuestion || responseOptions.length === 0) {
      return { rows: [], base: 0 };
    }
    const variableData = getVariableDataByExpectedHeader(selectedVar.name);
    const values = Array.isArray(variableData?.values) ? variableData.values : [];

    const counts: Record<string, number> = {};
    responseOptions.forEach(opt => {
      counts[opt.code] = 0;
    });

    values.forEach(value => {
      if (value === null || value === undefined) return;
      const str = String(value).trim();
      if (str === '') return;

      let matched = responseValueMap[str];
      if (!matched) {
        const lower = str.toLowerCase();
        const upper = str.toUpperCase();
        matched = responseValueMap[lower] ?? responseValueMap[upper];
      }
      if (!matched) {
        const numericValue = parseFloat(str);
        if (!isNaN(numericValue)) {
          const numericStr = String(Math.round(numericValue));
          matched = responseValueMap[numericStr];
        }
      }
      if (matched && counts.hasOwnProperty(matched)) {
        counts[matched] += 1;
      }
    });

    const totalResponses = Object.values(counts).reduce((sum, value) => sum + value, 0);

    return {
      rows: responseOptions
        .map(opt => {
          const count = counts[opt.code] || 0;
          const percent = totalResponses > 0 ? (count / totalResponses) * 100 : 0;
          return {
            code: opt.code,
            label: opt.text,
            count,
            percent,
          };
        })
        .sort((a, b) => {
          if (b.percent !== a.percent) return b.percent - a.percent;
          return b.count - a.count;
        }),
      base: totalResponses,
    };
  }, [selectedVar, responseOptions, isSingleSelectQuestion, getVariableDataByExpectedHeader, responseValueMap]);
  const multiSelectNoteItems = React.useMemo(
    () => parseMultiSelectNotes(matchingQuestion?.notes),
    [matchingQuestion?.notes]
  );

  /**
   * Calculate the base for multi-select questions by counting only respondents
   * who have at least one 0 or 1 value across all response options
   */
  const getMultiSelectBase = React.useCallback((responseItems: Array<{ code: string; text: string }>) => {
    if (!selectedVar || !getVariableDataByExpectedHeader) return 0;

    // Collect all values arrays for each response option
    const allValuesArrays: Array<any[]> = [];

    for (const item of responseItems) {
      const baseQuestionNumber = getBaseQuestionNumber(selectedVar.name);
      const possibleHeaders = [
        item.code,
        `${selectedVar.name}_${item.code}`,
        `${selectedVar.name}${item.code}`,
        `${baseQuestionNumber}${item.code}`,
        `${baseQuestionNumber}_${item.code}`,
      ];

      // Try to get data for this response option
      for (const header of possibleHeaders) {
        const data = getVariableDataByExpectedHeader(header);
        if (data && Array.isArray(data.values) && data.values.length > 0) {
          allValuesArrays.push(data.values);
          break;
        }
      }
    }

    if (allValuesArrays.length === 0) return 0;

    // Count respondents who have at least one valid value (0 or 1) across all options
    const maxLength = Math.max(...allValuesArrays.map(arr => arr.length));
    let validRespondents = 0;

    for (let i = 0; i < maxLength; i++) {
      let hasAnswer = false;

      // Check if this respondent has a 0 or 1 for any response option
      for (const valuesArray of allValuesArrays) {
        if (i < valuesArray.length) {
          const value = valuesArray[i];
          // Check if value is 0 or 1 (answered the question)
          if (value === 0 || value === 1 || value === '0' || value === '1' || value === false || value === true) {
            hasAnswer = true;
            break;
          }
        }
      }

      if (hasAnswer) {
        validRespondents++;
      }
    }

    return validRespondents;
  }, [selectedVar, getVariableDataByExpectedHeader, getBaseQuestionNumber]);

  const multiSelectChartPayload = React.useMemo(() => {
    if (!selectedVar || !getVariableDataByExpectedHeader || !isMultiSelect) {
      return { rows: [], base: 0 };
    }

    if (multiSelectNoteItems.length > 0) {
      const base = getMultiSelectBase(multiSelectNoteItems);
      const rows = multiSelectNoteItems
        .map(item => {
          const baseQuestionNumber = getBaseQuestionNumber(selectedVar.name);
          const fallbackHeaders = [
            selectedVar.name,
            `${selectedVar.name}_${item.code}`,
            `${selectedVar.name}${item.code}`,
            `${baseQuestionNumber}${item.code}`,
            `${baseQuestionNumber}_${item.code}`,
          ].filter(Boolean);
          const count = countCheckedForItemColumn(item.code, getVariableDataByExpectedHeader, fallbackHeaders);
          const percent = base > 0 ? (count / base) * 100 : 0;
          return {
            code: item.code,
            label: item.text,
            count,
            percent,
          };
        })
        .sort((a, b) => {
          if (b.percent !== a.percent) return b.percent - a.percent;
          return b.count - a.count;
        });
      return { rows, base };
    }

    if (responseOptions.length === 0) {
      return { rows: [], base: 0 };
    }

    const base = getMultiSelectBase(responseOptions);
    const { counts } = getMultiSelectResponseCounts(selectedVar.name, responseOptions, getVariableDataByExpectedHeader);
    return {
      rows: responseOptions
        .map(opt => {
          const count = counts[opt.code] || 0;
          const percent = base > 0 ? (count / base) * 100 : 0;
          return {
            code: opt.code,
            label: opt.text,
            count,
            percent,
          };
        })
        .sort((a, b) => {
          if (b.percent !== a.percent) return b.percent - a.percent;
          return b.count - a.count;
        }),
      base,
    };
  }, [
    selectedVar,
    responseOptions,
    isMultiSelect,
    getVariableDataByExpectedHeader,
    multiSelectNoteItems,
    getMultiSelectBase,
  ]);

  const hasSingleSelectChartData = singleSelectChartPayload.rows.some(row => row.count > 0);
  const hasMultiSelectChartData = multiSelectChartPayload.rows.some(row => row.count > 0);

  const stripNumbersFromText = React.useCallback((text: string | null | undefined) => {
    if (!text) return '';
    return String(text)
      .replace(/\d+/g, '')
      .replace(/^[\s\-\.:]+/, '')
      .replace(/\s{2,}/g, ' ')
      .trim();
  }, []);

  const scaleLabelTexts = React.useMemo(() => {
    const getOptionLabelForNumericCode = (num: number): string | null => {
      if (!Array.isArray(responseOptions) || responseOptions.length === 0) return null;
      const numericMatch = responseOptions.find(opt => {
        const numericCode = parseInt(String(opt.code).replace(/[^0-9-]/g, ''), 10);
        return numericCode === num;
      });
      const fallbackByIndex = responseOptions[num - 1];
      const rawText = numericMatch?.text || fallbackByIndex?.text;
      const cleaned = stripNumbersFromText(rawText);
      return cleaned || null;
    };

    return {
      first: getOptionLabelForNumericCode(1),
      seventh: getOptionLabelForNumericCode(7),
    };
  }, [responseOptions, stripNumbersFromText]);

  const multiSelectGridChartPayload = React.useMemo(() => {
    if (!isMultiSelectGrid || !selectedVar || !getVariableDataByExpectedHeader) {
      return { rows: [], base: 0, columns: [] as Array<{ key: string; label: string; base?: number }> };
    }

    const columns = responseOptions.map(opt => {
      const override = multiGridColumnHeaderOverrides?.[opt.code] || multiGridColumnHeaderOverrides?.[opt.text];
      const rawLabel = override || opt.text || opt.code || '';
      return {
        key: String(opt.code),
        label: formatGridColumnLabel(String(rawLabel)),
      };
    });
    if (columns.length === 0) {
      return { rows: [], base: 0, columns: [] as Array<{ key: string; label: string; base?: number }> };
    }

    const statements = multiSelectGridStatements;

    const normalizeRow = (code: string) => {
      const trimmed = String(code || '').trim();
      if (!trimmed) return '';
      if (/^r\d+/i.test(trimmed)) return trimmed;
      const digits = trimmed.match(/\d+/);
      return digits ? `r${digits[0]}` : trimmed;
    };
    const normalizeCol = (code: string) => {
      const trimmed = String(code || '').trim();
      if (!trimmed) return '';
      if (/^c\d+/i.test(trimmed)) return trimmed;
      const digits = trimmed.match(/\d+/);
      return digits ? `c${digits[0]}` : trimmed;
    };

    const getValuesForCandidates = (candidates: string[]) => {
      for (const header of candidates) {
        const data = getVariableDataByExpectedHeader(header);
        if (data && Array.isArray(data.values) && data.values.length > 0) {
          return data.values;
        }
      }
      return null;
    };

    const buildCandidates = (rowCode: string, colCode: string) => {
      const baseQuestionNumber = getBaseQuestionNumber(selectedVar.name);
      const baseNormalized = baseQuestionNumber.replace(/^Q/i, '');
      const row = normalizeRow(rowCode);
      const col = normalizeCol(colCode);
      const rowNoPrefix = row.replace(/^r/i, '');
      const colNoPrefix = col.replace(/^c/i, '');

      const prefixes = [baseQuestionNumber, baseNormalized, selectedVar.name];
      const candidates: string[] = [];
      prefixes.forEach(prefix => {
        if (!prefix) return;
        candidates.push(
          `${prefix}_${row}_${col}`,
          `${prefix}${row}${col}`,
          `${prefix}_${row}_${colNoPrefix}`,
          `${prefix}${row}${colNoPrefix}`,
          `${prefix}_${rowNoPrefix}_${colNoPrefix}`,
          `${prefix}${rowNoPrefix}${colNoPrefix}`,
          `${prefix}_${row}`,
          `${prefix}${row}`,
          `${prefix}_${col}`,
          `${prefix}${col}`
        );
      });
      candidates.push(
        `${row}_${col}`,
        `${row}${col}`,
        `${rowNoPrefix}${colNoPrefix}`
      );
      return Array.from(new Set(candidates)).filter(Boolean);
    };

    const rows = statements.map((stmt, rowIdx) => {
      const rowValuesByRespondent: any[][] = [];
      const columnValuesMap = new Map<string, any[] | null>();

      columns.forEach((col) => {
        const headers = buildCandidates(stmt.code, col.key);
        const values = getValuesForCandidates(headers);
        columnValuesMap.set(col.key, values);
        if (values && values.length > 0) {
          rowValuesByRespondent.push(values);
        }
      });

      // Base: respondents with any valid (0/1/true/false) answer across this statement's columns
      let rowBase = 0;
      if (rowValuesByRespondent.length > 0) {
        const maxLen = Math.max(...rowValuesByRespondent.map(v => v.length));
        for (let i = 0; i < maxLen; i++) {
          let hasAnswer = false;
          for (const arr of rowValuesByRespondent) {
            if (i < arr.length) {
              const v = arr[i];
              if (v === 0 || v === 1 || v === false || v === true) {
                hasAnswer = true;
                break;
              }
              const s = String(v ?? '').trim().toLowerCase();
              if (s === '0' || s === '1' || s === 'checked' || s === 'unchecked' || s === 'yes' || s === 'no' || s === 'true' || s === 'false') {
                hasAnswer = true;
                break;
              }
            }
          }
          if (hasAnswer) rowBase += 1;
        }
      }

      const columnCounts: Array<{ columnKey: string; count: number; percent: number }> = [];
      columns.forEach((col) => {
        const values = columnValuesMap.get(col.key);
        let count = 0;
        if (values && values.length > 0) {
          values.forEach(v => {
            const s = String(v ?? '').trim().toLowerCase();
            if (v === 1 || v === true || s === '1' || s === 'yes' || s === 'true' || s === 'checked') {
              count += 1;
            }
          });
        }
        columnCounts.push({ columnKey: col.key, count, percent: 0 });
      });

      return {
        rowKey: stmt.code || stmt.text || `r${rowIdx + 1}`,
        rowLabel: stmt.text || stmt.code || selectedVar.name,
        base: rowBase,
        columns: columnCounts,
      };
    });

    // Column bases: respondents who selected this column on any statement
    const columnBases: Record<string, number> = {};
    const baseQ = getBaseQuestionNumber(selectedVar.name);
    columns.forEach(col => {
      const respondentSet = new Set<number>();
      statements.forEach(stmt => {
        const possibleVariableNames = [
          `${baseQ}_${stmt.code}_${col.key}`,
          `${baseQ}${stmt.code}${col.key}`,
          `${baseQ}_${stmt.code}_${String(col.key).replace(/^c/i, '')}`,
          `${baseQ}${stmt.code}${String(col.key).replace(/^c/i, '')}`,
        ];

        let values: any[] | null = null;
        for (const varName of possibleVariableNames) {
          const data = getVariableDataByExpectedHeader(varName);
          if (data && Array.isArray(data.values) && data.values.length > 0) {
            values = data.values;
            break;
          }
        }

        if (values && values.length > 0) {
          values.forEach((v: any, idx: number) => {
            const s = String(v ?? '').trim().toLowerCase();
            if (v === 1 || v === true || s === '1' || s === 'yes' || s === 'true') {
              respondentSet.add(idx);
            }
          });
        }
      });
      columnBases[col.key] = respondentSet.size;
    });

    const overallBase = Math.max(...Object.values(columnBases), ...rows.map(r => r.base), 0);
    const columnsWithBase = columns.map(col => ({
      ...col,
      base: columnBases[col.key] ?? 0,
    }));

    // Update first-column percents using column base
    const firstColKey = columns[0]?.key;
    const rowsWithPercents = rows
      .map(row => ({
        ...row,
        columns: row.columns.map((col) => {
          const baseForCol = columnBases[col.columnKey] ?? 0;
          if (baseForCol > 0) {
            return { ...col, percent: (col.count / baseForCol) * 100 };
          }
          return col;
        }),
      }))
      .sort((a, b) => {
        const aPct = a.columns[0]?.percent ?? 0;
        const bPct = b.columns[0]?.percent ?? 0;
        return bPct - aPct;
      });

    if (typeof window !== 'undefined') {
      console.debug('MultiSelectGridChart base debug', {
        variable: selectedVar.name,
        columnBases,
        rowsBase: rows.map(r => ({ row: r.rowKey, base: r.base })),
        overallBase,
        meta: debugMultiSelectGridMeta,
      });
    }

    return { rows: rowsWithPercents, base: overallBase, columns: columnsWithBase };
  }, [columnStatementsFromNotes, getVariableDataByExpectedHeader, isMultiSelectGrid, responseOptions, selectedVar, matchingQuestion, multiSelectGridStatements, multiGridColumnHeaderOverrides, formatGridColumnLabel]);

  const getTagsWithScaleDetection = React.useCallback(
    (question: any, variable: Variable | null) => {
      const baseTags: string[] = (question?.tags || variable?.tags || []).slice();
      const hasScaleTag = baseTags.some(tag => /scale\s*\(7pt\)/i.test(tag));
      if (hasScaleTag) return baseTags;

      const typeLower = (question?.type || variable?.type || '').toLowerCase();
      const isSingleSelectLike = typeLower.includes('single select');
      if (!isSingleSelectLike) return baseTags;

      const responseOptions: Array<{ code: string; text: string }> = [];
      if (question?.responseOptions && Array.isArray(question.responseOptions)) {
        question.responseOptions.forEach((opt: any, idx: number) => {
          if (typeof opt === 'string') {
            responseOptions.push({ code: `c${idx + 1}`, text: opt });
          } else {
            responseOptions.push({
              code: String(opt.code ?? `c${idx + 1}`),
              text: String(opt.text ?? opt.label ?? opt.value ?? opt.code ?? `c${idx + 1}`),
            });
          }
        });
      } else if (variable?.codes) {
        Object.entries(variable.codes).forEach(([code, text]) => {
          responseOptions.push({ code: String(code), text: String(text ?? code) });
        });
      }

      const detection = detect7ptScale(responseOptions);
      if (detection.hasScale) {
        return [...baseTags, 'Scale (7pt)'];
      }
      return baseTags;
    },
    []
  );

  const tagsWithScaleDetection = React.useMemo(
    () => getTagsWithScaleDetection(matchingQuestion, selectedVar || null),
    [getTagsWithScaleDetection, matchingQuestion, selectedVar]
  );
  const hasScale7ptTag = React.useMemo(
    () => tagsWithScaleDetection.some(tag => /scale\s*\(7pt\)/i.test(tag)) || scaleDetection.hasScale,
    [scaleDetection.hasScale, tagsWithScaleDetection]
  );
  const hasPercentTag = tagsWithScaleDetection.some(tag => String(tag).trim() === '%');
  const hasNumberTag = tagsWithScaleDetection.some(tag => String(tag).trim().toLowerCase() === 'number');
  const isNumericGridPercentTag = isNumericGrid && hasPercentTag;
  const isNumericGridNumberTag = isNumericGrid && hasNumberTag;

  const formatNumberWithCommas = React.useCallback((value: number | null | undefined) => {
    if (value === null || value === undefined || isNaN(Number(value))) return '0';
    return Number(value).toLocaleString('en-US');
  }, []);
  const isChartSupported =
    isSingleSelectQuestion ||
    isMultiSelect ||
    isMultiSelectGrid ||
    (isSingleSelectGrid && hasScale7ptTag) ||
    isNumericGridPercentTag ||
    isNumericGridNumberTag;

  const singleSelectGridScaleChartData = React.useMemo(() => {
    if (!isSingleSelectGrid || !hasScale7ptTag || !selectedVar || !getVariableDataByExpectedHeader) return null;
    if (!scaleDetection.hasScale) return null;

    const statements = multiSelectGridStatements;
    if (!statements.length) return null;

    const baseQuestionNumber = getBaseQuestionNumber(selectedVar.name);
    const baseNum = baseQuestionNumber.replace(/^Q/i, '');
    const optOutCode = scaleDetection.optOutCode ? String(scaleDetection.optOutCode).trim().toLowerCase() : null;

    const aggregateBuckets = { b2b: 0, m3b: 0, t2b: 0 };
    let aggregateTotal = 0;

    const rows = statements.map((stmt, idx) => {
      const candidates = [
        `Q${baseNum}${stmt.code}`,
        `Q${baseNum}_${stmt.code}`,
        `${baseQuestionNumber}${stmt.code}`,
        `${baseQuestionNumber}_${stmt.code}`,
        `${selectedVar.name}${stmt.code}`,
        `${selectedVar.name}_${stmt.code}`,
      ];

      let values: any[] | null = null;
      for (const header of candidates) {
        const data = getVariableDataByExpectedHeader(header);
        if (data && Array.isArray(data.values) && data.values.length > 0) {
          values = data.values;
          break;
        }
      }

      if (!values) {
        return {
          rowKey: stmt.code || `r${idx + 1}`,
          rowLabel: stmt.text || stmt.code || `Row ${idx + 1}`,
          base: 0,
          segments: [],
        };
      }

      let base = 0;
      const buckets = { b2b: 0, m3b: 0, t2b: 0 };

      values.forEach(v => {
        if (v === null || v === undefined || v === '') return;
        const raw = String(v).trim();
        if (optOutCode && raw.toLowerCase() === optOutCode) return;
        const numericCode = parseInt(raw.replace(/[^0-9-]/g, ''), 10);
        if (isNaN(numericCode) || numericCode < 1 || numericCode > 7) return;

        base += 1;
        if (numericCode <= 2) buckets.b2b += 1;
        else if (numericCode <= 5) buckets.m3b += 1;
        else buckets.t2b += 1;
      });

      aggregateBuckets.b2b += buckets.b2b;
      aggregateBuckets.m3b += buckets.m3b;
      aggregateBuckets.t2b += buckets.t2b;
      aggregateTotal += base;

      const toPercent = (count: number) => (base > 0 ? (count / base) * 100 : 0);
      const segments = [
        { key: 'b2b', label: 'Bottom 2 Box', percent: toPercent(buckets.b2b), color: B2B_GRAY },
        { key: 'm3b', label: 'Middle 3 Box', percent: toPercent(buckets.m3b), color: LIGHT_BRAND_ORANGE },
        { key: 't2b', label: 'Top 2 Box', percent: toPercent(buckets.t2b), color: BRAND_ORANGE },
      ];

      const withRounded = segments.map(seg => ({ ...seg, percentRounded: Math.round(seg.percent) }));
      const displaySegments = withRounded.some(seg => seg.percentRounded > 0)
        ? withRounded.filter(seg => seg.percentRounded > 0)
        : withRounded;

      return {
        rowKey: stmt.code || `r${idx + 1}`,
        rowLabel: stmt.text || stmt.code || `Row ${idx + 1}`,
        base,
        segments: displaySegments,
      };
    });

    const legendSegments = (() => {
      if (aggregateTotal === 0) {
        return [
          { key: 'b2b', label: 'Bottom 2 Box', percentRounded: 0, color: B2B_GRAY },
          { key: 'm3b', label: 'Middle 3 Box', percentRounded: 0, color: LIGHT_BRAND_ORANGE },
          { key: 't2b', label: 'Top 2 Box', percentRounded: 0, color: BRAND_ORANGE },
        ];
      }
      const toPercent = (count: number) => Math.round((count / aggregateTotal) * 100);
      return [
        { key: 'b2b', label: 'Bottom 2 Box', percentRounded: toPercent(aggregateBuckets.b2b), color: B2B_GRAY },
        { key: 'm3b', label: 'Middle 3 Box', percentRounded: toPercent(aggregateBuckets.m3b), color: LIGHT_BRAND_ORANGE },
        { key: 't2b', label: 'Top 2 Box', percentRounded: toPercent(aggregateBuckets.t2b), color: BRAND_ORANGE },
      ].filter(seg => seg.percentRounded > 0);
    })();

    const rowsWithData = rows.filter(r => r.base > 0);
    const sortedRows = [...rowsWithData].sort((a, b) => {
      const t2bA = a.segments.find(seg => seg.key === 't2b')?.percent ?? 0;
      const t2bB = b.segments.find(seg => seg.key === 't2b')?.percent ?? 0;
      return t2bB - t2bA;
    });
    return {
      rows: sortedRows,
      legendSegments,
      base: Math.max(...rowsWithData.map(r => r.base), 0),
    };
  }, [getVariableDataByExpectedHeader, hasScale7ptTag, isSingleSelectGrid, multiSelectGridStatements, scaleDetection.hasScale, scaleDetection.optOutCode, selectedVar]);

  const numericGridPercentChartData = React.useMemo(() => {
    if (!isNumericGridPercentTag || !selectedVar || !getVariableDataByExpectedHeader) return null;
    const statements = multiSelectGridStatements;
    if (!statements.length) return null;

    const baseQuestionNumber = getBaseQuestionNumber(selectedVar.name);

    // Determine which column(s) to use: prefer column code embedded in variable name, else variable.codes/responseOptions
    const columnCodesRaw: string[] = [];
    const columnFromVarMatch = selectedVar.name.match(/c\d+/i);
    if (columnFromVarMatch) {
      columnCodesRaw.push(columnFromVarMatch[0]);
    }
    if (selectedVar.codes && Object.keys(selectedVar.codes).length > 0) {
      Object.keys(selectedVar.codes).forEach(code => columnCodesRaw.push(code));
    } else if (matchingQuestion?.responseOptions && Array.isArray(matchingQuestion.responseOptions)) {
      matchingQuestion.responseOptions.forEach((opt: any, idx: number) => {
        if (typeof opt === 'string') {
          columnCodesRaw.push(`c${idx + 1}`);
        } else {
          columnCodesRaw.push(opt.code || `c${idx + 1}`);
        }
      });
    }
    const normalizeCol = (code: string) => {
      const trimmed = String(code || '').trim();
      if (!trimmed) return '';
      if (/^c\d+/i.test(trimmed)) return trimmed;
      if (/^\d+$/.test(trimmed)) return `c${trimmed}`;
      return trimmed;
    };
    const normalizedColumns = columnCodesRaw.map(normalizeCol).filter(Boolean);
    const columnCodes = normalizedColumns.length > 0 ? [normalizedColumns[0]] : ['c1'];

    const rows = statements.map((stmt, idx) => {
      const header = `${baseQuestionNumber}${stmt.code}${columnCodes[0]}`;
      const data = getVariableDataByExpectedHeader(header);
      const values = Array.isArray(data?.values) ? data.values : [];
      const numericValues = values
        .map(v => parseFloat(String(v)))
        .filter(v => !isNaN(v));
      const base = numericValues.length;
      const mean = base > 0 ? numericValues.reduce((sum, v) => sum + v, 0) / base : 0;
      return {
        key: stmt.code || `row-${idx}`,
        label: stmt.text || stmt.code || `Row ${idx + 1}`,
        mean,
        base,
      };
    }).filter(row => row.base > 0 || row.mean !== 0);

    if (!rows.length) return null;

    const totalMean = rows.reduce((sum, row) => sum + row.mean, 0);
    const sumsTo100 = Math.abs(totalMean - 100) <= 1;

    return {
      rows,
      sumsTo100,
      base: Math.max(...rows.map(r => r.base), 0),
    };
  }, [isNumericGridPercentTag, selectedVar, getVariableDataByExpectedHeader, multiSelectGridStatements, matchingQuestion?.responseOptions]);

  const numericGridNumberChartData = React.useMemo(() => {
    if (!isNumericGridNumberTag || !selectedVar || !getVariableDataByExpectedHeader) return null;
    const statements = multiSelectGridStatements;
    if (!statements.length) return null;

    const baseQuestionNumber = getBaseQuestionNumber(selectedVar.name);

    const columnCodesRaw: string[] = [];
    const columnFromVarMatch = selectedVar.name.match(/c\d+/i);
    if (columnFromVarMatch) {
      columnCodesRaw.push(columnFromVarMatch[0]);
    }
    if (selectedVar.codes && Object.keys(selectedVar.codes).length > 0) {
      Object.keys(selectedVar.codes).forEach(code => columnCodesRaw.push(code));
    } else if (matchingQuestion?.responseOptions && Array.isArray(matchingQuestion.responseOptions)) {
      matchingQuestion.responseOptions.forEach((opt: any, idx: number) => {
        if (typeof opt === 'string') {
          columnCodesRaw.push(`c${idx + 1}`);
        } else {
          columnCodesRaw.push(opt.code || `c${idx + 1}`);
        }
      });
    }
    const normalizeCol = (code: string) => {
      const trimmed = String(code || '').trim();
      if (!trimmed) return '';
      if (/^c\d+/i.test(trimmed)) return trimmed;
      if (/^\d+$/.test(trimmed)) return `c${trimmed}`;
      return trimmed;
    };
    const normalizedColumns = columnCodesRaw.map(normalizeCol).filter(Boolean);
    const columnCode = normalizedColumns.length > 0 ? normalizedColumns[0] : 'c1';

    const columnRespondentSet = new Set<number>();

    const rows = statements.map((stmt, idx) => {
      const possibleHeaders = [
        `${baseQuestionNumber}_${stmt.code}_${columnCode}`,
        `${baseQuestionNumber}${stmt.code}${columnCode}`,
        `${baseQuestionNumber}_${stmt.code}_${columnCode.replace(/^c/i, '')}`,
        `${baseQuestionNumber}${stmt.code}${columnCode.replace(/^c/i, '')}`,
      ];

      const numericValues: number[] = [];
      const rowRespondentSet = new Set<number>();
      for (const header of possibleHeaders) {
        const data = getVariableDataByExpectedHeader(header);
        if (data && Array.isArray(data.values)) {
          data.values.forEach((v: any, valueIdx: number) => {
            if (v === null || v === undefined || v === '') return;
            const num = parseFloat(String(v));
            if (!isNaN(num)) {
              numericValues.push(num);
              rowRespondentSet.add(valueIdx);
              columnRespondentSet.add(valueIdx);
            }
          });
          if (numericValues.length > 0) break;
        }
      }

      const sum = numericValues.reduce((acc, v) => acc + v, 0);
      return {
        key: stmt.code || `row-${idx}`,
        label: stmt.text || stmt.code || `Row ${idx + 1}`,
        sum,
        base: rowRespondentSet.size,
      };
    }).filter(row => row.base > 0 || row.sum !== 0);

    if (!rows.length) return null;

    const columnTotal = rows.reduce((acc, row) => acc + row.sum, 0);
    if (columnTotal === 0) return null;

    const rowsWithPercent = rows.map(row => ({
      ...row,
      percent: (row.sum / columnTotal) * 100,
    }));

    const totalPercent = rowsWithPercent.reduce((acc, row) => acc + row.percent, 0);
    const sumsTo100 = Math.abs(totalPercent - 100) <= 1;

    return {
      rows: rowsWithPercent,
      sumsTo100,
      base: columnRespondentSet.size,
      totalSum: columnTotal,
    };
  }, [getVariableDataByExpectedHeader, isNumericGridNumberTag, matchingQuestion?.responseOptions, multiSelectGridStatements, selectedVar]);

  const scale7ptChartData = React.useMemo(() => {
    if (!isSingleSelectQuestion) return null;
    if (!hasScale7ptTag) return null;
    if (!singleSelectChartPayload.rows.length) return null;

    const optOutCode = scaleDetection.optOutCode ? String(scaleDetection.optOutCode).trim().toLowerCase() : null;

    const buckets = { b2b: 0, m3b: 0, t2b: 0 };
    let total = 0;

    singleSelectChartPayload.rows.forEach(row => {
      const normalizedCode = String(row.code ?? '').trim().toLowerCase();
      if (optOutCode && normalizedCode === optOutCode) return;

      const numericCode = parseInt(String(row.code).replace(/[^0-9-]/g, ''), 10);
      if (isNaN(numericCode) || numericCode < 1 || numericCode > 7) return;

      const count = row.count || 0;
      total += count;

      if (numericCode <= 2) {
        buckets.b2b += count;
      } else if (numericCode <= 5) {
        buckets.m3b += count;
      } else {
        buckets.t2b += count;
      }
    });

    if (total === 0) return null;
    const toPercent = (value: number) => (value / total) * 100;

    const segments = [
      { key: 'b2b', label: 'Bottom 2 Box', count: buckets.b2b, percent: toPercent(buckets.b2b), color: B2B_GRAY, textColor: DARK_TEXT },
      { key: 'm3b', label: 'Middle 3 Box', count: buckets.m3b, percent: toPercent(buckets.m3b), color: LIGHT_BRAND_ORANGE, textColor: '#7C2D12' },
      { key: 't2b', label: 'Top 2 Box', count: buckets.t2b, percent: toPercent(buckets.t2b), color: BRAND_ORANGE, textColor: '#FFFFFF' },
    ];

    const legendSegments = segments
      .map(seg => ({ ...seg, percentRounded: Math.round(seg.percent) }))
      .map(seg => ({ ...seg, percentRounded: Math.max(seg.percentRounded, 0) }));

    const displaySegments = legendSegments
      .filter(seg => seg.percentRounded > 0);

    if (displaySegments.length === 0) return null;

    return {
      total,
      legendSegments,
      segments: displaySegments,
    };
  }, [hasScale7ptTag, isSingleSelectQuestion, scaleDetection.optOutCode, singleSelectChartPayload.rows]);

  return (
    <div className="flex h-[calc(100vh-200px)]">
      <VariableListSidebar
        variables={variables}
        filteredVariables={filteredVariables}
        selectedVariable={selectedVariable}
        onSelect={onSelectVariable}
        filter={variableFilter}
        onFilterChange={onVariableFilterChange}
        questionTypeFilter={questionTypeFilter}
        onQuestionTypeFilterChange={onQuestionTypeFilterChange}
        showQuestionTypeFilter={showQuestionTypeFilter}
        onToggleQuestionTypeFilter={onToggleQuestionTypeFilter}
        loading={loading}
        loadingFullRawData={loadingFullRawData}
        getVariableDataByExpectedHeader={getVariableDataByExpectedHeader}
        questionnaireQuestions={questionnaireQuestions}
        columnMapping={columnMapping}
        columnHeaders={columnHeaders}
        fullRawData={fullRawData}
        datamapData={datamapData}
        dataMappingMemo={dataMappingMemo}
        hiddenFromBanners={hiddenFromBanners}
        getExpectedHeadersForQuestion={getExpectedHeadersForQuestion}
        convertHiddenVariableToExpectedHeader={convertHiddenVariableToExpectedHeader}
        netSummaryTableSelectedCodes={netSummaryTableSelectedCodes}
      />
      {/* Variable Detail View */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {selectedVariable ? (() => {
          const selectedVar = variables.find(v => v.name === selectedVariable);
          const tableVar = variables.find(v => v.name === tableVariable) || null;
          const tableOptions = tableVar 
            ? getTableOptionsForVariable(tableVar, questionnaireQuestions, netSummaryTableSelectedCodes)
            : [];
          const statsSelections = tableVariable ? getStatsSelectionsForVariable(tableVariable) : null;
          const typeLower = selectedVar?.type?.toLowerCase() || '';
          const isMultiSelectGrid = typeLower.includes('multi-select grid');
          const isOpenEndListType = typeLower.includes('open end list');
          const isNumericGrid = typeLower.includes('numeric grid');
          const isMultiSelect = typeLower.includes('multi-select') && !typeLower.includes('grid');
          const isSingleSelectQuestion =
            typeLower.includes('single select') && !typeLower.includes('grid') && !isMultiSelect;
          const summarySortDefaultsToOn = isMultiSelectGrid || isOpenEndListType;
          
          // Find matching question for the selected variable
          const baseQuestionNumber = selectedVar ? getBaseQuestionNumber(selectedVar.name) : '';

          const questionNumber = matchingQuestion
            ? (matchingQuestion.number || matchingQuestion.id || baseQuestionNumber)
            : baseQuestionNumber;
          const multiGridHeaderText = (() => {
            if (multiSelectGridQuestionLines && multiSelectGridQuestionLines.length > 0) {
              return multiSelectGridQuestionLines;
            }
            if (!isMultiSelectGrid || datamapMatchesForSelected.length === 0) return null;
            const texts = datamapMatchesForSelected
              .map((q: any) => q.questionText || q.text || q.description || q.question || '')
              .filter(Boolean);
            if (texts.length === 0) return null;
            const seen = new Set<string>();
            const uniqueTexts = texts.filter(t => {
              const key = t.trim().toLowerCase();
              if (seen.has(key)) return false;
              seen.add(key);
              return true;
            });
            return uniqueTexts.map((t: string, idx: number) => ({ key: `fb-${idx}`, fullText: t.trim() }));
          })();
          const questionText = Array.isArray(multiGridHeaderText)
            ? (() => {
                // Extract only the question portion (after " - ") and de-duplicate, showing once
                const questionParts = multiGridHeaderText
                  .map(line => {
                    const parts = line.fullText.split(' - ');
                    return parts.length >= 2 ? parts.slice(-1).join(' - ').trim() : line.fullText.trim();
                  })
                  .filter(Boolean);
                const seen = new Set<string>();
                const unique = questionParts.filter(q => {
                  const key = q.toLowerCase();
                  if (seen.has(key)) return false;
                  seen.add(key);
                  return true;
                });
                return unique[0] || '';
              })()
            : (matchingQuestion
              ? (matchingQuestion.text || matchingQuestion.question || matchingQuestion.description || String(questionNumber))
              : '');
          const headerQuestionText = questionText || selectedVar?.description || '';
          const questionType = matchingQuestion
            ? (matchingQuestion.type || 'Unknown')
            : (selectedVar?.type || 'Unknown');
          const tags = tagsWithScaleDetection;
          const displayVariableName = selectedVar?.name || questionNumber;
          const chartTitleText = isNumericGridNumberTag ? 'Sum Distribution Table' : 'Frequency Table';
          const chartBase = isSingleSelectQuestion
            ? (scale7ptChartData?.total ?? singleSelectChartPayload.base)
            : isSingleSelectGrid && singleSelectGridScaleChartData
            ? singleSelectGridScaleChartData.base
            : isMultiSelectGrid
            ? multiSelectGridChartPayload.base
            : isNumericGridPercentTag
            ? (numericGridPercentChartData?.base ?? 0)
            : isNumericGridNumberTag
            ? (numericGridNumberChartData?.base ?? 0)
            : multiSelectChartPayload.base;
          const shouldShowScaleStackedChart = isSingleSelectQuestion && !!scale7ptChartData;
  const formatLegendLabel = (text: string) => {
    const parts = text.split(' - ');
    return parts.length >= 2 ? parts.slice(0, -1).join(' - ') : text;
  };

  const getChartClipboardData = (): string | null => {
    const rows: Array<{ label: string; value: string }> = [];

    if (isSingleSelectQuestion) {
      if (shouldShowScaleStackedChart && scale7ptChartData?.segments) {
        scale7ptChartData.segments.forEach(seg => {
          rows.push({ label: seg.label, value: `${seg.percentRounded}%` });
        });
      } else if (hasSingleSelectChartData) {
        singleSelectChartPayload.rows.forEach(row => {
          rows.push({ label: row.label, value: `${row.percent.toFixed(1)}%` });
        });
      }
    } else if (isSingleSelectGrid && singleSelectGridScaleChartData) {
      singleSelectGridScaleChartData.rows.forEach(row => {
        const t2b = row.segments.find(seg => seg.key === 't2b');
        rows.push({ label: row.rowLabel, value: t2b ? `${Math.round(t2b.percent ?? 0)}%` : '0%' });
      });
    } else if (isNumericGridPercentTag && numericGridPercentChartData) {
      numericGridPercentChartData.rows.forEach(row => {
        rows.push({ label: row.label, value: `${row.mean.toFixed(1)}%` });
      });
    } else if (isNumericGridNumberTag && numericGridNumberChartData) {
      numericGridNumberChartData.rows.forEach(row => {
        rows.push({ label: row.label, value: `${row.percent.toFixed(1)}%` });
      });
    } else if (isMultiSelectGrid && multiSelectGridChartPayload.rows.length > 0) {
      multiSelectGridChartPayload.rows.forEach(row => {
        row.columns.forEach(col => {
          rows.push({ label: `${row.rowLabel} - ${formatLegendLabel(col.label)}`, value: `${col.percent.toFixed(0)}%` });
        });
      });
    } else if (isMultiSelect && hasMultiSelectChartData) {
      multiSelectChartPayload.rows.forEach(row => {
        rows.push({ label: row.label, value: `${row.percent.toFixed(1)}%` });
      });
    }

    if (!rows.length) return null;
    const lines = rows.map(r => `${r.label}\t${r.value}`);
    return lines.join('\n');
  };

  const handleCopyChartData = () => {
    const data = getChartClipboardData();
    if (!data) return;
    if (navigator?.clipboard?.writeText) {
      navigator.clipboard.writeText(data).then(() => {
        setHasJustCopied(true);
        setTimeout(() => setHasJustCopied(false), 1200);
      }).catch(() => {});
    }
  };
          
          return (
            <>
              {/* Sticky Header with Question Number and Text */}
              <div className="sticky top-0 z-10 bg-white border-b border-gray-200 px-6 py-4 shadow-sm">
                <div className="flex flex-col gap-2">
                  {/* Top row: Q# and tags/buttons */}
                  <div className="flex items-center justify-between gap-4">
                    <div className="flex items-center gap-2">
                      <span className="text-lg font-semibold text-gray-900">
                        {displayVariableName}
                      </span>
                      {(() => {
                        // Check if question has 0 mapped variables
                        if (isRawPlan) return null;
                        if (matchingQuestion) {
                          const expectedHeaders = getExpectedHeadersForQuestion(matchingQuestion, questionNumber);
                          const mappedCount = expectedHeaders.filter(expectedHeader => {
                            const mappedColumn = columnMapping[expectedHeader] || columnMapping[expectedHeader.replace(/^Q/, '')] || '';
                            return !!mappedColumn;
                          }).length;

                          if (mappedCount === 0 && expectedHeaders.length > 0) {
                            return (
                              <span className="text-xs px-2 py-1 bg-red-100 text-red-700 rounded">
                                Unmapped
                              </span>
                            );
                          }
                        }
                        return null;
                      })()}
                    </div>
                    <div className="flex items-center gap-2 flex-shrink-0">
                      {tags.length > 0 && tags.map((tag: string, idx: number) => (
                        <span
                          key={idx}
                          className="text-xs px-2 py-1 rounded bg-blue-100 text-blue-800"
                        >
                          {tag}
                        </span>
                      ))}
                      <span className="text-xs px-2 py-1 rounded bg-blue-100 text-blue-800" style={{ minWidth: '80px', textAlign: 'center' }}>
                        {questionType}
                      </span>
                      {isChartSupported && chartStatus !== 'chart' && (
                        <button
                          type="button"
                          onClick={startChartGeneration}
                          className="text-xs px-3 py-1 rounded bg-blue-600 text-white hover:bg-blue-700 disabled:bg-blue-200 disabled:text-blue-500 transition"
                          disabled={chartStatus === 'loading'}
                        >
                          {cachedCharts[selectedVariable || ''] ? 'View chart' : 'Generate chart'}
                        </button>
                      )}
                      {chartStatus === 'chart' && (
                        <button
                          type="button"
                          onClick={() => setChartStatus('table')}
                          className="text-xs px-3 py-1 rounded border border-blue-300 text-blue-700 hover:bg-blue-50 transition"
                        >
                          View tables
                        </button>
                      )}
                    </div>
                  </div>
                  {/* Full width question text below */}
                  {headerQuestionText ? (
                    <span className="text-base text-gray-700 whitespace-pre-line">
                      {headerQuestionText}
                    </span>
                  ) : null}
                  {isNumericGrid && columnStatementsFromNotes.length > 0 && columnCount > 1 && (
                    <div className="text-sm text-gray-600 space-y-0.5">
                      {columnStatementsFromNotes.map((stmt) => (
                        <div key={`statement-${stmt.code}`} className="truncate">
                          {stmt.text}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
              {/* Scrollable Content */}
              <div className="flex-1 overflow-y-auto p-6">
                {chartStatus === 'table' && tableVar && (
                  <div className={isMultiSelectGrid ? 'multi-grid-table-wrapper' : undefined}>
                    <VariableTablePlaceholders
                      variable={tableVar}
                      tableOptions={tableOptions}
                      statsSelections={statsSelections || getStatsSelectionsForVariable(tableVar.name)}
                      summaryTableSortSelections={summaryTableSortSelections}
                      summarySortDefaultsToOn={summarySortDefaultsToOn}
                      variableTableSelections={variableTableSelections}
                      variableSortByFrequency={variableSortByFrequency}
                      variableHoldResponseCodes={variableHoldResponseCodes}
                      netSummaryTableSelectedCodes={netSummaryTableSelectedCodes}
                      getVariableDataByExpectedHeader={getVariableDataByExpectedHeader}
                      fullRawData={fullRawData}
                      columnMapping={columnMapping}
                      questionnaireQuestions={questionnaireQuestions}
                      disableMappingIndicators={isRawPlan}
                      columnHeaderOverrides={multiGridColumnHeaderOverrides}
                    />
                  </div>
                )}
                {chartStatus === 'loading' && (
                  <div className="flex h-full min-h-[240px] w-full flex-col items-center justify-center gap-3">
                    <div className="flex items-center gap-2">
                      <div
                        className="h-6 w-6 rounded-full border-2 border-gray-200 animate-spin"
                        style={{ borderTopColor: BRAND_ORANGE }}
                      />
                      <div className="text-sm font-medium text-gray-700 animate-pulse">Generating chart</div>
                    </div>
                  </div>
                )}
                {chartStatus === 'chart' && (
                  <div className="flex h-full min-h-[240px] w-full flex-col gap-4 pt-2 pb-0 px-0">
                    <div className="flex flex-col gap-1 w-full">
                      <div className="flex items-center justify-between gap-3">
                        <h3 className="text-base font-semibold text-gray-900">
                          {`${questionNumber || displayVariableName}: ${chartTitleText}`}
                        </h3>
                        <button
                          type="button"
                          onClick={handleCopyChartData}
                          className={`text-xs px-2 py-1 rounded border ${
                            hasJustCopied
                              ? 'border-green-300 text-green-700 bg-green-50'
                              : 'border-gray-300 text-gray-700 hover:bg-gray-50'
                          } transition flex items-center gap-1`}
                        >
                          {hasJustCopied ? 'Copied' : 'Copy data'}
                          {hasJustCopied && (
                            <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                            </svg>
                          )}
                        </button>
                      </div>
                    <span className="text-sm text-gray-600 italic">
                        {isMultiSelectGrid
                          ? `Base by column: ${multiSelectGridChartPayload.columns
                              .map(col => `${formatLegendLabel(col.label)} n=${col.base ?? 0}`)
                              .join(' | ')}`
                          : isSingleSelectGrid && singleSelectGridScaleChartData
                          ? (() => {
                              const bases = singleSelectGridScaleChartData.rows.map(r => r.base);
                              const allEqual = bases.length > 0 && bases.every(b => b === bases[0]);
                              if (allEqual) {
                                return `Base: n=${bases[0] ?? 0}`;
                              }
                              return 'Base size varies';
                            })()
                          : isNumericGridNumberTag && numericGridNumberChartData
                          ? `Base: n=${numericGridNumberChartData.base ?? 0} (Sum: ${formatNumberWithCommas(Math.round(numericGridNumberChartData.totalSum ?? 0))})`
                          : `(Base: n=${chartBase})`}
                      </span>
                      {shouldShowScaleStackedChart && (
                        <div className="mt-1 flex flex-wrap items-center gap-4 text-xs text-gray-700">
                          {(scale7ptChartData?.legendSegments || scale7ptChartData?.segments || []).map(seg => {
                            const legendLabel =
                              seg.key === 'b2b' && scaleLabelTexts.first
                                ? `${seg.label} (${scaleLabelTexts.first})`
                                : seg.key === 't2b' && scaleLabelTexts.seventh
                                ? `${seg.label} (${scaleLabelTexts.seventh})`
                                : seg.label;
                            return (
                              <div key={seg.key} className="flex items-center gap-1">
                                <span
                                  className="h-3 w-3 rounded-sm border border-gray-300"
                                  style={{ backgroundColor: seg.color }}
                                />
                                <span>{legendLabel}</span>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                    {isSingleSelectQuestion ? (
                      shouldShowScaleStackedChart ? (
                        <div className="space-y-4">
                          <div className="overflow-hidden rounded-md border border-gray-200 bg-gray-50">
                            <div className="flex h-12 w-full">
                              {scale7ptChartData?.segments.map(seg => (
                                <div
                                  key={seg.key}
                                  className="relative flex items-center justify-center px-2 text-xs font-semibold whitespace-nowrap"
                                  style={{
                                    width: `${Math.max(seg.percent, 0)}%`,
                                    backgroundColor: seg.color,
                                    color: seg.textColor,
                                  }}
                                >
                                  {`${seg.percentRounded}%`}
                                </div>
                              ))}
                            </div>
                          </div>
                        </div>
                      ) : hasSingleSelectChartData ? (
                        <div className="space-y-4">
                          {singleSelectChartPayload.rows.map((row) => (
                            <div key={row.code}>
                              <div className="flex items-center justify-between text-sm text-gray-800">
                                <span className="font-medium">{row.label}</span>
                                <span>{row.percent.toFixed(1)}%</span>
                              </div>
                              <div className="mt-1 h-3 w-full rounded-full bg-gray-200">
                                <div
                                  className="h-full rounded-full"
                                  style={{
                                    width: `${Math.min(100, Math.max(0, row.percent))}%`,
                                    backgroundColor: BRAND_ORANGE,
                                  }}
                                />
                              </div>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <div className="text-center text-sm text-gray-500">
                          No responses yet to build a chart for {displayVariableName}.
                        </div>
                      )
                    ) : isSingleSelectGrid && singleSelectGridScaleChartData ? (
                      singleSelectGridScaleChartData.rows.some(r => r.base > 0) ? (
                        (() => {
                          const ssgBases = singleSelectGridScaleChartData.rows.map(r => r.base);
                          const ssgAllEqual = ssgBases.length > 0 && ssgBases.every(b => b === ssgBases[0]);
                          return (
                            <div className="space-y-4">
                              <div className="flex flex-wrap items-center gap-4 text-xs text-gray-700">
                                {(singleSelectGridScaleChartData.legendSegments.length > 0
                                  ? singleSelectGridScaleChartData.legendSegments
                                  : [
                                      { key: 'b2b', label: 'Bottom 2 Box', percentRounded: 0, color: B2B_GRAY },
                                      { key: 'm3b', label: 'Middle 3 Box', percentRounded: 0, color: LIGHT_BRAND_ORANGE },
                                      { key: 't2b', label: 'Top 2 Box', percentRounded: 0, color: BRAND_ORANGE },
                                    ]
                                ).map(seg => {
                                  const legendLabel =
                                    seg.key === 'b2b' && scaleLabelTexts.first
                                      ? `${seg.label} (${scaleLabelTexts.first})`
                                      : seg.key === 't2b' && scaleLabelTexts.seventh
                                      ? `${seg.label} (${scaleLabelTexts.seventh})`
                                      : seg.label;
                                  return (
                                    <div key={seg.key} className="flex items-center gap-1">
                                      <span
                                        className="h-3 w-3 rounded-sm border border-gray-300"
                                        style={{ backgroundColor: seg.color }}
                                      />
                                      <span>{legendLabel}</span>
                                    </div>
                                  );
                                })}
                              </div>
                              <div className="space-y-3">
                                {singleSelectGridScaleChartData.rows.map((row, idx) => (
                                  <div key={`ssg-row-${row.rowKey || idx}`} className="space-y-1.5">
                                    <div className="flex items-center justify-between text-sm text-gray-800">
                                      <span className="truncate max-w-full font-normal" title={row.rowLabel}>
                                        {row.rowLabel}
                                      </span>
                                      {!ssgAllEqual && (
                                        <span className="text-xs text-gray-500">n={row.base}</span>
                                      )}
                                    </div>
                                    <div className="overflow-hidden rounded-md border border-gray-200 bg-gray-50">
                                      <div className="flex h-8 w-full">
                                        {row.segments.map(seg => (
                                          <div
                                            key={`${row.rowKey}-${seg.key}`}
                                            className="relative flex items-center justify-center px-2 text-[11px] font-semibold whitespace-nowrap"
                                            style={{
                                              width: `${Math.max(seg.percent || 0, 0)}%`,
                                              backgroundColor: seg.color,
                                              color: seg.key === 't2b' ? '#FFFFFF' : '#111827',
                                            }}
                                          >
                                            <span>{Math.round(seg.percent ?? 0)}%</span>
                                          </div>
                                        ))}
                                      </div>
                                    </div>
                                  </div>
                                ))}
                              </div>
                            </div>
                          );
                        })()
                      ) : (
                        <div className="text-center text-sm text-gray-500">
                          No responses yet to build a chart for {displayVariableName}.
                        </div>
                      )
                    ) : isNumericGridPercentTag && numericGridPercentChartData ? (
                      numericGridPercentChartData.rows.length > 0 ? (
                        numericGridPercentChartData.sumsTo100 ? (
                          <>
                            <div className="flex gap-4 items-stretch min-h-[280px] h-full">
                              <div className="relative flex-[0.5] min-w-[200px] h-full min-h-[280px] border border-gray-200 bg-gray-50 rounded-md overflow-hidden flex flex-col">
                                {numericGridPercentChartData.rows.map((row, idx) => {
                                  const color = GRID_BAR_COLORS[idx % GRID_BAR_COLORS.length];
                                  const textColor = '#FFFFFF';
                                  return (
                                    <div
                                      key={row.key}
                                      className="relative flex items-center justify-center px-2 text-xs font-semibold whitespace-nowrap"
                                      style={{
                                        height: `${Math.max(row.mean, 0)}%`,
                                        backgroundColor: color,
                                        color: textColor,
                                        minHeight: row.mean > 0 ? '6px' : '0px',
                                      }}
                                    >
                                      {`${Math.round(row.mean)}%`}
                                    </div>
                                  );
                                })}
                              </div>
                              <div className="min-w-[180px] flex-1 flex flex-col gap-2 text-xs text-gray-700">
                                {numericGridPercentChartData.rows.map((row, idx) => {
                                  const color = GRID_BAR_COLORS[idx % GRID_BAR_COLORS.length];
                                  return (
                                    <div key={row.key} className="flex items-center gap-2">
                                      <span
                                        className="h-3 w-3 rounded-sm border border-gray-300 flex-shrink-0"
                                        style={{ backgroundColor: color }}
                                      />
                                      <span className="leading-tight">{row.label}</span>
                                    </div>
                                  );
                                })}
                              </div>
                            </div>
                          </>
                        ) : (
                          <div className="space-y-4">
                            {numericGridPercentChartData.rows.map((row, idx) => (
                              <div key={row.key}>
                                <div className="flex items-center justify-between text-sm text-gray-800">
                                  <span className="font-medium">{row.label}</span>
                                  <span>{row.mean.toFixed(1)}%</span>
                                </div>
                                <div className="mt-1 h-3 w-full rounded-full bg-gray-200">
                                  <div
                                    className="h-full rounded-full"
                                    style={{
                                      width: `${Math.min(100, Math.max(0, row.mean))}%`,
                                      backgroundColor: GRID_BAR_COLORS[idx % GRID_BAR_COLORS.length],
                                    }}
                                  />
                                </div>
                              </div>
                            ))}
                          </div>
                        )
                      ) : (
                        <div className="text-center text-sm text-gray-500">
                          No responses yet to build a chart for {displayVariableName}.
                        </div>
                      )
                    ) : isNumericGridNumberTag && numericGridNumberChartData ? (
                      numericGridNumberChartData.rows.length > 0 ? (
                        numericGridNumberChartData.sumsTo100 ? (
                          <>
                            <div className="flex gap-4 items-stretch min-h-[280px] h-full">
                              <div className="relative flex-[0.5] min-w-[200px] h-full min-h-[280px] border border-gray-200 bg-gray-50 rounded-md overflow-hidden flex flex-col">
                                {numericGridNumberChartData.rows.map((row, idx) => {
                                  const color = GRID_BAR_COLORS[idx % GRID_BAR_COLORS.length];
                                  const textColor = '#FFFFFF';
                                  return (
                                    <div
                                      key={row.key}
                                      className="relative flex items-center justify-center px-2 text-xs font-semibold whitespace-nowrap"
                                      style={{
                                        height: `${Math.max(row.percent, 0)}%`,
                                        backgroundColor: color,
                                        color: textColor,
                                        minHeight: row.percent > 0 ? '6px' : '0px',
                                      }}
                                    >
                                      {`${Math.round(row.percent)}%`}
                                    </div>
                                  );
                                })}
                              </div>
                              <div className="min-w-[180px] flex-1 flex flex-col gap-2 text-xs text-gray-700">
                                {numericGridNumberChartData.rows.map((row, idx) => {
                                  const color = GRID_BAR_COLORS[idx % GRID_BAR_COLORS.length];
                                  return (
                                    <div key={row.key} className="flex items-center gap-2">
                                      <span
                                        className="h-3 w-3 rounded-sm border border-gray-300 flex-shrink-0"
                                        style={{ backgroundColor: color }}
                                      />
                                      <span className="leading-tight">{row.label}</span>
                                    </div>
                                  );
                                })}
                              </div>
                            </div>
                          </>
                        ) : (
                          <div className="space-y-4">
                            {numericGridNumberChartData.rows.map((row, idx) => (
                              <div key={row.key}>
                                <div className="flex items-center justify-between text-sm text-gray-800">
                                  <span className="font-medium">{row.label}</span>
                                  <span>{row.percent.toFixed(1)}%</span>
                                </div>
                                <div className="mt-1 h-3 w-full rounded-full bg-gray-200">
                                  <div
                                    className="h-full rounded-full"
                                    style={{
                                      width: `${Math.min(100, Math.max(0, row.percent))}%`,
                                      backgroundColor: GRID_BAR_COLORS[idx % GRID_BAR_COLORS.length],
                                    }}
                                  />
                                </div>
                              </div>
                            ))}
                          </div>
                        )
                      ) : (
                        <div className="text-center text-sm text-gray-500">
                          No responses yet to build a chart for {displayVariableName}.
                        </div>
                      )
                    ) : isMultiSelectGrid ? (
                      multiSelectGridChartPayload.columns.length > 0 ? (
                        <div className="space-y-4">
                          <div className="flex flex-wrap items-center gap-4 text-xs text-gray-700">
                            {multiSelectGridChartPayload.columns.map((col, idx) => (
                              <div key={`legend-${col.key}`} className="flex items-center gap-1">
                                <span
                                  className="h-3 w-3 rounded-sm border border-gray-300"
                                  style={{ backgroundColor: GRID_BAR_COLORS[idx % GRID_BAR_COLORS.length] }}
                                />
                                <span className="font-normal" title={col.label}>
                                  {formatLegendLabel(col.label)}
                                </span>
                              </div>
                            ))}
                          </div>
                          <div className="space-y-3">
                            {multiSelectGridChartPayload.rows.length > 0 ? (
                              multiSelectGridChartPayload.rows.map((row, idx) => (
                                <div key={`row-${row.rowKey || idx}`} className="space-y-2">
                                  <div className="flex items-center justify-between text-sm text-gray-800">
                                    <span className="truncate max-w-full font-normal" title={row.rowLabel}>
                                      {row.rowLabel}
                                    </span>
                                  </div>
                                  <div className="space-y-2">
                                    {row.columns.map((col, colIdx) => {
                                      const color = GRID_BAR_COLORS[colIdx % GRID_BAR_COLORS.length];
                                      return (
                                        <div key={`${row.rowKey || idx}-${col.columnKey}`} className="flex items-center gap-2 text-xs text-gray-700">
                                          <div className="flex-1 h-3 rounded-full bg-gray-200">
                                            <div
                                              className="h-full rounded-full"
                                              style={{
                                                width: `${Math.min(100, Math.max(0, col.percent))}%`,
                                                backgroundColor: color,
                                              }}
                                            />
                                          </div>
                                          <span className="w-10 text-left font-normal">{col.percent.toFixed(0)}%</span>
                                        </div>
                                      );
                                    })}
                                  </div>
                                </div>
                              ))
                            ) : (
                              <div className="text-center text-sm text-gray-500">
                                No responses yet to build a chart for {displayVariableName}.
                              </div>
                            )}
                          </div>
                        </div>
                      ) : (
                        <div className="text-center text-sm text-gray-500">
                          No responses yet to build a chart for {displayVariableName}.
                        </div>
                      )
                    ) : isMultiSelect ? (
                      hasMultiSelectChartData ? (
                        <div className="space-y-4">
                          {multiSelectChartPayload.rows.map((row) => (
                            <div key={row.code}>
                              <div className="flex items-center justify-between text-sm text-gray-800">
                                <span className="font-medium">{row.label}</span>
                                <span>{row.percent.toFixed(1)}%</span>
                              </div>
                              <div className="mt-1 h-3 w-full rounded-full bg-gray-200">
                                <div
                                  className="h-full rounded-full"
                                  style={{
                                    width: `${Math.min(100, Math.max(0, row.percent))}%`,
                                    backgroundColor: BRAND_ORANGE,
                                  }}
                                />
                              </div>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <div className="text-center text-sm text-gray-500">
                          No responses yet to build a chart for {displayVariableName}.
                        </div>
                      )
                    ) : (
                      <div className="text-center text-sm text-gray-500">
                        Chart generation currently supports single-select, single-select grids with 7pt scale, and multi-select questions only.
                      </div>
                    )}
                  </div>
                )}
              </div>
            </>
          );
        })() : (
          <div className="flex-1 flex items-center justify-center">
            <div className="text-center py-12 text-gray-500">Select a variable to view tables</div>
          </div>
        )}
      </div>
    </div>
  );
};
