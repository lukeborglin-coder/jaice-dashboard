import React from 'react';
import { VariableListSidebar } from './VariableListSidebar';
import { VariableTablePlaceholders } from './VariableTablePlaceholders';
import { GridNumericCrosstabTables } from './GridNumericCrosstabTables';
import { Variable } from '../../utils/tabs/types';
import { getTableOptionsForVariable } from '../../utils/tabs/tableOptions';
import { getBaseQuestionNumber, detect7ptScale } from '../../utils/tabs/questionHelpers';
import { buildNumericGridSummaryModel, type NumericGridSummaryType } from '../../utils/tabs/gridNumericSummary';
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
  const [showCrosstabModal, setShowCrosstabModal] = React.useState(false);
  const [crosstabTarget, setCrosstabTarget] = React.useState<string | null>(null);
  const [crosstabActiveTarget, setCrosstabActiveTarget] = React.useState<string | null>(null);
  const [crosstabLoading, setCrosstabLoading] = React.useState(false);
  const [showCrosstabSummary, setShowCrosstabSummary] = React.useState(false as boolean | { bucketIndex: number });
  const chartTimerRef = React.useRef<number | null>(null);
  const crosstabTimerRef = React.useRef<number | null>(null);
  const crosstabModalRef = React.useRef<HTMLDivElement | null>(null);
  const crosstabSummaryRef = React.useRef<HTMLDivElement | null>(null);

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
    if (crosstabTimerRef.current) {
      window.clearTimeout(crosstabTimerRef.current);
      crosstabTimerRef.current = null;
    }
    setChartStatus('table');
    setCrosstabActiveTarget(null);
    setCrosstabLoading(false);
    setShowCrosstabModal(false);
  }, [selectedVariable]);

  React.useEffect(() => {
    return () => {
    if (chartTimerRef.current) {
      window.clearTimeout(chartTimerRef.current);
    }
    if (crosstabTimerRef.current) {
      window.clearTimeout(crosstabTimerRef.current);
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

  const startCrosstabRun = () => {
    if (!selectedVariable || !crosstabTarget) return;
    setShowCrosstabModal(false);
    setCrosstabLoading(true);
    if (crosstabTimerRef.current) {
      window.clearTimeout(crosstabTimerRef.current);
    }
    setChartStatus('loading');
    crosstabTimerRef.current = window.setTimeout(() => {
      setChartStatus('table');
      setCrosstabLoading(false);
      setCrosstabActiveTarget(crosstabTarget);
      crosstabTimerRef.current = null;
    }, 1500);
  };

  const handleCrosstabButtonClick = () => {
    if (crosstabActiveTarget) {
      setCrosstabActiveTarget(null);
      setCrosstabLoading(false);
      setChartStatus('table');
      setShowCrosstabSummary(false);
      return;
    }
    const firstEligible = variables.find((v) => {
      const tl = v.type?.toLowerCase() || '';
      const tags = Array.isArray((v as any).tags) ? (v as any).tags : [];
      const hasScale = tags.some((t: string) => /scale\s*\(7pt\)/i.test(String(t)));
      const isSsg = tl.includes('single select grid');
      const isSs = tl.includes('single select') && !tl.includes('grid');
      return v.name !== selectedVariable && (isSs || (isSsg && hasScale));
    });
    setCrosstabTarget(firstEligible?.name || null);
    setShowCrosstabSummary(false);
    setShowCrosstabModal(true);
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
  const questionNumber = matchingQuestion
    ? (matchingQuestion.number || matchingQuestion.id || baseQuestionNumber)
    : baseQuestionNumber;
  const headerQuestionTextGlobal =
    (matchingQuestion?.text ||
      (matchingQuestion as any)?.question ||
      matchingQuestion?.description ||
      selectedVar?.description ||
      '') ?? '';

  const columnCodeMatch = selectedVar?.name.match(/c\d+/i);
  const columnCode = columnCodeMatch ? columnCodeMatch[0].toLowerCase() : '';
  const selectedVarColumnSuffix = columnCodeMatch ? columnCodeMatch[0] : '';
  const columnCount = (() => {
    if (selectedVar?.codes && Object.keys(selectedVar.codes).length > 0) {
      return Object.keys(selectedVar.codes).length;
    }
    if (matchingQuestion?.responseOptions && Array.isArray(matchingQuestion.responseOptions)) {
      return matchingQuestion.responseOptions.length;
    }
    return 0;
  })();

  const selectedVarTableSelections = React.useMemo(() => {
    const direct = selectedVar ? variableTableSelections[selectedVar.name] : undefined;
    if (direct) return direct;
    if (!selectedVar) return new Set<string>();
    const baseKey = getBaseQuestionNumber(selectedVar.name);
    return variableTableSelections[baseKey] || new Set<string>();
  }, [selectedVar, variableTableSelections]);

  const columnStatementsFromNotes = React.useMemo(() => {
    if (!matchingQuestion || !Array.isArray(matchingQuestion.notes) || matchingQuestion.notes.length === 0) {
      return [];
    }
    const baseNormalized = baseQuestionNumber.replace(/^Q/i, '').toLowerCase();
    const statementsMap = new Map<string, { code: string; text: string; headerCode?: string }>();

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
          headerCode: match[1],
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

  // Map row code -> raw header code (parsed from data map notes like [QS11r1c1] ...)
  const statementHeaderHints = React.useMemo(() => {
    const map: Record<string, string> = {};
    columnStatementsFromNotes.forEach((row) => {
      if (row.code && row.headerCode) {
        map[row.code.toLowerCase()] = row.headerCode;
      }
    });
    return map;
  }, [columnStatementsFromNotes]);

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
      return fromNotes.map((row, idx) => {
        const rawText = String(row.text ?? row.code ?? `Row ${idx + 1}`);
        const cleanedText = rawText.replace(/^\s*\[[^\]]+\]\s*/, '');
        return {
          code: String(row.code ?? `r${idx + 1}`),
          text: cleanedText || rawText,
        };
      });
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
  const hasPercentTag = tagsWithScaleDetection.some(tag => /%|percent/i.test(String(tag)));
  const hasNumberTag = tagsWithScaleDetection.some(tag => String(tag).trim().toLowerCase() === 'number');
  const isNumericGridPercentTag = isNumericGrid && hasPercentTag;
  const isNumericGridNumberTag = isNumericGrid && hasNumberTag;
  const useScaleBuckets = isSingleSelectGrid && hasScale7ptTag;
  const scaleBucketOptions = React.useMemo(
    () => [
      { code: 't2b', text: 'Top 2 Box' },
      { code: 'm3b', text: 'Middle 3 Box' },
      { code: 'b2b', text: 'Bottom 2 Box' },
    ],
    []
  );
  const getScaleBucketCode = React.useCallback((val: any) => {
    const n = Number(val);
    if (Number.isNaN(n)) return '';
    if (n <= 2) return 'b2b';
    if (n <= 5) return 'm3b';
    return 't2b';
  }, []);
  const singleSelectGridStatements = React.useMemo(() => {
    if (columnStatementsFromNotes.length > 0) {
      return columnStatementsFromNotes.map((row, idx) => ({
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
    return [];
  }, [columnStatementsFromNotes, matchingQuestion, selectedVar?.statements]);

  const crosstabTargetQuestion = React.useMemo(() => {
    if (!crosstabActiveTarget) return null;
    const targetVar = variables.find(v => v.name === crosstabActiveTarget);
    if (!targetVar) return null;
    const baseNum = getBaseQuestionNumber(targetVar.name) || targetVar.name;
    const match = questionnaireQuestions.find((q) => {
      const qNum = q.number || q.id;
      if (!qNum) return false;
      const qStr = String(qNum);
      const normQ = qStr.replace(/^Q/i, '');
      const normBase = baseNum.replace(/^Q/i, '');
      return (
        qStr === baseNum ||
        normQ === normBase ||
        `Q${normQ}` === baseNum ||
        `Q${normBase}` === qStr
      );
    });
    return {
      number: baseNum,
      text: match?.text || match?.question || match?.description || '',
    };
  }, [crosstabActiveTarget, questionnaireQuestions, variables]);

  const getQuestionMetaForVar = React.useCallback(
    (v: Variable) => {
      const baseNum = getBaseQuestionNumber(v.name) || v.name;
      const match = questionnaireQuestions.find((q) => {
        const qNum = q.number || q.id;
        if (!qNum) return false;
        const qStr = String(qNum);
        const normQ = qStr.replace(/^Q/i, '');
        const normBase = baseNum.replace(/^Q/i, '');
        return (
          qStr === baseNum ||
          normQ === normBase ||
          `Q${normQ}` === baseNum ||
          `Q${normBase}` === qStr
        );
      });
      return {
        number: baseNum,
        text: match?.text || match?.question || match?.description || '',
        type: v.type || '',
      };
    },
    [questionnaireQuestions]
  );

  const isCrosstabSupported = isSingleSelectQuestion || isSingleSelectGrid || isNumericGrid;

  React.useEffect(() => {
    if (!isCrosstabSupported) {
      setCrosstabActiveTarget(null);
      setShowCrosstabModal(false);
      setCrosstabTarget(null);
      setShowCrosstabSummary(false);
    }
  }, [isCrosstabSupported]);

  React.useEffect(() => {
    const handleOutsideClick = (e: MouseEvent) => {
      const target = e.target as Node | null;
      if (showCrosstabModal && crosstabModalRef.current && target && !crosstabModalRef.current.contains(target)) {
        setShowCrosstabModal(false);
      }
      if (showCrosstabSummary && crosstabSummaryRef.current && target && !crosstabSummaryRef.current.contains(target)) {
        setShowCrosstabSummary(false);
      }
    };
    document.addEventListener('mousedown', handleOutsideClick);
    return () => document.removeEventListener('mousedown', handleOutsideClick);
  }, [showCrosstabModal, showCrosstabSummary]);

  const crosstabSummary = React.useMemo(() => {
    if (!crosstabActiveTarget) return null;
    if (!selectedVar || !isCrosstabSupported || !getVariableDataByExpectedHeader) return null;

    console.log('🔵 [CROSSTAB] Starting crosstab calculation', {
      selectedVariable: selectedVar.name,
      selectedVarType: selectedVar.type,
      crosstabTarget: crosstabActiveTarget,
      isNumericGrid,
      isSingleSelectGrid,
      isSingleSelectQuestion
    });

    const targetVar = variables.find((v) => v.name === crosstabActiveTarget);
    if (!targetVar) {
      console.log('🔴 [CROSSTAB] Target variable not found:', crosstabActiveTarget);
      return null;
    }
    console.log('🔵 [CROSSTAB] Target variable found:', {
      name: targetVar.name,
      type: targetVar.type,
      codes: targetVar.codes,
      statements: targetVar.statements
    });
    const typeLowerTarget = targetVar.type?.toLowerCase() || '';
    const targetTags = Array.isArray((targetVar as any).tags) ? (targetVar as any).tags : [];
    const targetHasScaleTag = targetTags.some((t: string) => /scale\s*\(7pt\)/i.test(String(t)));
    const targetEligible =
      (typeLowerTarget.includes('single select') && !typeLowerTarget.includes('grid')) ||
      (typeLowerTarget.includes('single select grid') && targetHasScaleTag);
    if (!targetEligible) {
      console.log('🔴 [CROSSTAB] Target variable not eligible for crosstab:', {
        typeLowerTarget,
        targetHasScaleTag,
        reason: 'Must be single select or single select grid with scale tag'
      });
      return null;
    }
    const targetIsScaleGrid = typeLowerTarget.includes('single select grid') && targetHasScaleTag;
    console.log('🔵 [CROSSTAB] Target is eligible:', { targetIsScaleGrid });

    const targetBaseNum = getBaseQuestionNumber(targetVar.name).replace(/^Q/i, '');
    const targetMatchingQuestion = questionnaireQuestions.find((q) => {
      const qNum = q.number || q.id;
      if (!qNum) return false;
      const qStr = String(qNum);
      const normQ = qStr.replace(/^Q/i, '');
      return normQ === targetBaseNum || qStr === targetBaseNum || `Q${normQ}` === targetBaseNum;
    });

    const targetOptions: Array<{ code: string; text: string }> = [];
    if (targetIsScaleGrid) {
      targetOptions.push(...scaleBucketOptions);
    } else if (targetVar.codes && Object.keys(targetVar.codes).length > 0) {
      Object.entries(targetVar.codes).forEach(([code, text]) => {
        targetOptions.push({ code, text: String(text || code) });
      });
    } else if (Array.isArray((targetVar as any).responseOptions)) {
      (targetVar as any).responseOptions.forEach((opt: any, idx: number) => {
        const code = typeof opt === 'string' ? `c${idx + 1}` : (opt.code || `c${idx + 1}`);
        const text = typeof opt === 'string' ? opt : (opt.text || opt.label || opt.value || code);
        targetOptions.push({ code, text });
      });
    }
    if (targetOptions.length === 0) {
      console.log('🔴 [CROSSTAB] No target options found');
      return null;
    }
    console.log('🔵 [CROSSTAB] Target options:', targetOptions);

    const targetCodes = targetOptions.map((o) => o.code);

  const getStatementValues = (
      stmtCode: string,
      forSelected: boolean
    ): { values: any[]; header: string } | null => {
      const baseNum = forSelected
        ? getBaseQuestionNumber(selectedVar.name).replace(/^Q/i, '')
        : targetBaseNum;
      const questionRef = forSelected ? matchingQuestion : targetMatchingQuestion;
      const varName = forSelected ? selectedVar.name : targetVar.name;

      const columnSuffix = forSelected && selectedVarColumnSuffix ? selectedVarColumnSuffix : '';

      // For numeric grids with column suffixes, questionRef may be null (column is not a separate question)
      // We can still proceed using the base information we have
      if (!questionRef && !columnSuffix) {
        console.log(`🔴 [CROSSTAB] No matching question found for statement "${stmtCode}":`, {
          forSelected,
          varName,
          baseNum,
          matchingQuestion: forSelected ? matchingQuestion : targetMatchingQuestion,
          selectedVarName: selectedVar.name,
          allQuestions: questionnaireQuestions.map(q => ({ number: q.number, id: q.id }))
        });
        return null;
      }

      // Normalize statement code to avoid double-appending base/column
      const basePattern = new RegExp(`^Q?${baseNum}`, 'i');
      let coreCode = stmtCode.replace(basePattern, '');
      // Strip trailing column code if present
      coreCode = coreCode.replace(/_?c\d+$/i, '');
      if (columnSuffix) {
        const colPattern = new RegExp(`_?${columnSuffix}$`, 'i');
        coreCode = coreCode.replace(colPattern, '');
      }
      coreCode = coreCode.replace(/^[_-]+/, '');

      const baseWithPrefix = baseNum.toLowerCase().startsWith('q') ? baseNum : `Q${baseNum}`;
      const questionNum = questionRef ? (questionRef.number || questionRef.id || '') : baseWithPrefix;

      const stmtCodeLower = stmtCode.toLowerCase();
      const headerHint = statementHeaderHints[stmtCodeLower];
      const headerHintWithSuffix =
        headerHint && selectedVarColumnSuffix
          ? headerHint.replace(/c\d+/i, selectedVarColumnSuffix)
          : '';

      const candidates: string[] = [
        headerHintWithSuffix || '',
        headerHint || '',
        stmtCode,
        coreCode,
        `${baseWithPrefix}${coreCode}`,
        `${baseWithPrefix}_${coreCode}`,
        `${baseNum}${coreCode}`,
        `${baseNum}_${coreCode}`,
        `${questionNum}${coreCode}`,
        `${questionNum}_${coreCode}`,
        `${varName}${coreCode}`,
        `${varName}_${coreCode}`,
      ];

      if (columnSuffix) {
        candidates.push(
          `${baseWithPrefix}${coreCode}${columnSuffix}`,
          `${baseWithPrefix}_${coreCode}_${columnSuffix}`,
          `${baseNum}${coreCode}${columnSuffix}`,
          `${baseNum}_${coreCode}_${columnSuffix}`,
          `${questionNum}${coreCode}${columnSuffix}`,
          `${questionNum}_${coreCode}_${columnSuffix}`,
          `${varName}${coreCode}${columnSuffix}`,
          `${varName}_${coreCode}_${columnSuffix}`
        );
      }

      console.log(`🔍 [CROSSTAB] Looking for statement values:`, {
        stmtCode,
        forSelected,
        varName,
        candidatesCount: candidates.length,
        firstFewCandidates: candidates.slice(0, 5)
      });

      for (const header of candidates.filter(Boolean)) {
        const data = getVariableDataByExpectedHeader(header);
        if (data && Array.isArray(data.values) && data.values.length > 0) {
          console.log(`✅ [CROSSTAB] Found statement data for "${stmtCode}" at header "${header}":`, {
            valueCount: data.values.length,
            firstFewValues: data.values.slice(0, 5)
          });
          return { values: data.values, header };
        }
      }
      console.log(`❌ [CROSSTAB] No data found for statement "${stmtCode}", tried ${candidates.length} headers`);
      return null;
    };

    const targetData = getVariableDataByExpectedHeader(targetVar.name);
    let targetValues = Array.isArray(targetData?.values) ? targetData.values : [];
    console.log('🔵 [CROSSTAB] Target variable data:', {
      targetVarName: targetVar.name,
      hasData: !!targetData,
      targetValuesCount: targetValues.length,
      firstFewTargetValues: targetValues.slice(0, 10),
      uniqueTargetValues: [...new Set(targetValues.filter(v => v !== null && v !== undefined))]
    });

    // Fallback/override for scale grids: build respondent-level values by averaging numeric responses across statements
    const buildTargetGridValues = (): any[] | null => {
      const baseNum = targetBaseNum;
      const targetQ = targetMatchingQuestion;
      const statements: Array<{ code: string; text: string }> = [];
      if (targetVar.statements && Object.keys(targetVar.statements).length > 0) {
        Object.entries(targetVar.statements).forEach(([code, text]) => {
          statements.push({ code: String(code), text: String(text || code) });
        });
      } else if (Array.isArray((targetQ as any)?.statementOptions) && (targetQ as any).statementOptions.length > 0) {
        (targetQ as any).statementOptions.forEach((opt: any, idx: number) => {
          statements.push({
            code: String(opt.code ?? opt.id ?? `r${idx + 1}`),
            text: String(opt.text ?? opt.label ?? opt.value ?? opt.name ?? `Row ${idx + 1}`),
          });
        });
      }
      if (statements.length === 0) return null;

      const stmtValueArrays: Array<any[] | null> = statements.map((stmt, idx) => {
        const candidates = [
          `Q${baseNum}${stmt.code}`,
          `Q${baseNum}_${stmt.code}`,
          `${targetQ?.number || targetQ?.id || ''}${stmt.code}`,
          `${targetQ?.number || targetQ?.id || ''}_${stmt.code}`,
          `${targetVar.name}${stmt.code}`,
          `${targetVar.name}_${stmt.code}`,
        ];
        for (const header of candidates) {
          const data = getVariableDataByExpectedHeader(header);
          if (data && Array.isArray(data.values) && data.values.length > 0) {
            return data.values;
          }
        }
        return null;
      });

      const maxLen = Math.max(...stmtValueArrays.map((arr) => (Array.isArray(arr) ? arr.length : 0)), 0);
      if (maxLen === 0) return null;

      const result: any[] = [];
      for (let i = 0; i < maxLen; i++) {
        const nums: number[] = [];
        stmtValueArrays.forEach((arr) => {
          if (!arr || arr[i] === null || arr[i] === undefined) return;
          const n = Number(arr[i]);
          if (!Number.isNaN(n)) nums.push(n);
        });
        if (nums.length === 0) {
          result.push(null);
        } else {
          const avg = nums.reduce((a, b) => a + b, 0) / nums.length;
          result.push(avg);
        }
      }
      return result;
    };

    if (targetIsScaleGrid) {
      const fallbackValues = buildTargetGridValues();
      if (fallbackValues && fallbackValues.length > 0) {
        targetValues = fallbackValues;
      }
    }

    if (targetValues.length === 0) {
      console.log('🔴 [CROSSTAB] No target values found, cannot build crosstab');
      return null;
    }

    // Build respondent index sets for each cut (by target code)
    const indicesByCutCode: Record<string, Set<number>> = {};
    targetOptions.forEach((opt) => {
      indicesByCutCode[opt.code] = new Set<number>();
    });
    for (let i = 0; i < targetValues.length; i++) {
      const tRaw = targetValues[i];
      if (tRaw === null || tRaw === undefined || tRaw === '') continue;
      const rawCode = targetIsScaleGrid ? getScaleBucketCode(tRaw) : String(tRaw).trim();
      if (!rawCode) continue;

      if (indicesByCutCode[rawCode]) {
        indicesByCutCode[rawCode].add(i);
        continue;
      }

      // Be forgiving about whether codes are stored like "1" vs "c1"
      const altCode = rawCode.toLowerCase().startsWith('c') ? rawCode.replace(/^c/i, '') : `c${rawCode}`;
      if (indicesByCutCode[altCode]) {
        indicesByCutCode[altCode].add(i);
      }
    }

    // Numeric grid crosstab: build tables aligned with numeric grid summaries
    if (isNumericGrid) {
      const statements = multiSelectGridStatements;
      if (!statements.length) return null;

      // Only show cut columns with base > 0 (same UX as other crosstabs)
      let activeCuts = targetOptions.filter((opt) => (indicesByCutCode[opt.code]?.size || 0) > 0);
      if (activeCuts.length === 0) activeCuts = targetOptions;

      const numericGridSummaryTypeFromOptionId = (id: string): NumericGridSummaryType | null => {
        const ends = (suffix: string) => id.endsWith(suffix);
        if (ends('_MeanSummaryTable') && !ends('_MeanNoOutliersSummaryTable')) return 'mean';
        if (ends('_SumSummaryTable') && !ends('_SumNoOutliersSummaryTable')) return 'sum';
        if (ends('_MeanNoOutliersSummaryTable')) return 'meanNoOutliers';
        if (ends('_SumNoOutliersSummaryTable')) return 'sumNoOutliers';
        return null;
      };

      const selectedIds = Array.from(selectedVarTableSelections || []);
      const selectedSummaryOptions = tableOptions.filter((opt) => opt.type === 'summary' && selectedIds.includes(opt.id));
      let summaryOptionsToUse = selectedSummaryOptions.filter((opt) => numericGridSummaryTypeFromOptionId(opt.id));
      if (summaryOptionsToUse.length === 0) {
        // Fallback: match prior behavior (at least show Sum Summary)
        const fallback =
          tableOptions.find((opt) => opt.type === 'summary' && /_SumSummaryTable$/i.test(opt.id)) ||
          tableOptions.find((opt) => opt.type === 'summary' && /SummaryTable$/i.test(opt.id));
        summaryOptionsToUse = fallback ? [fallback] : [];
      }
      if (summaryOptionsToUse.length === 0) return null;

      // Sorting/hold settings should match Tables view (use variable name or base key)
      const baseKey = getBaseQuestionNumber(selectedVar.name);
      const sortKey = variableSortByFrequency[selectedVar.name] !== undefined ? selectedVar.name : baseKey;
      const holdKey = variableHoldResponseCodes[selectedVar.name] !== undefined ? selectedVar.name : baseKey;
      const sortState = variableSortByFrequency[sortKey];
      const isSortedByFrequency = sortState !== undefined ? sortState : false;
      const holdCodes = variableHoldResponseCodes[holdKey] || [];

      const cuts = [{ code: 'total', text: 'TOTAL', isTotal: true }, ...activeCuts.map((c) => ({ ...c, isTotal: false }))];

      const tables = summaryOptionsToUse
        .map((opt) => {
          const summaryType = numericGridSummaryTypeFromOptionId(opt.id);
          if (!summaryType) return null;

          const totalModel = buildNumericGridSummaryModel({
            variable: selectedVar,
            variableName: selectedVar.name,
            optionId: opt.id,
            summaryType,
            statements,
            responseOptions,
            getVariableDataByExpectedHeader,
            respondentFilter: null,
            sortByFrequency: isSortedByFrequency,
            holdCodes,
          });

          const modelsByCutCode: Record<string, any> = { total: totalModel };
          activeCuts.forEach((cut) => {
            modelsByCutCode[cut.code] = buildNumericGridSummaryModel({
              variable: selectedVar,
              variableName: selectedVar.name,
              optionId: opt.id,
              summaryType,
              statements,
              responseOptions,
              getVariableDataByExpectedHeader,
              respondentFilter: indicesByCutCode[cut.code] || new Set<number>(),
              sortByFrequency: false,
              holdCodes: [],
            });
          });

          return {
            optionId: opt.id,
            summaryType,
            tableName: totalModel.tableName,
            isMeanSummaryTable: totalModel.isMeanSummaryTable,
            allBasesEqual: totalModel.allBasesEqual,
            gridColumns: totalModel.columnsToUse.map((code) => ({
              code,
              text: totalModel.columnLabels[code] || code,
            })),
            cuts,
            rowOrder: totalModel.rows.map((r) => r.code),
            rowTextByCode: totalModel.rows.reduce((acc: Record<string, string>, r) => {
              acc[r.code] = r.text;
              return acc;
            }, {}),
            modelsByCutCode,
          };
        })
        .filter(Boolean);

      if (tables.length === 0) return null;
      return { mode: 'numeric-grid-crosstab', target: crosstabActiveTarget, tables };
    }

    // If using scale buckets for single-select grid 7pt: build bucket tables per statement
    if (useScaleBuckets) {
      const statements = singleSelectGridStatements;
      const bucketTables: Array<{
        code: string;
        text: string;
        rows: Array<{ label: string; cells: Record<string, { count: number; pct: number }>; totalCount: number; totalPct: number }>;
        colTotals: Record<string, number>;
      }> = scaleBucketOptions.map((b) => ({ code: b.code, text: b.text, rows: [], colTotals: {} }));

      statements.forEach((stmt) => {
      const stmtData = getStatementValues(stmt.code, true);
      const stmtValues = stmtData?.values;
      const targetVals = targetValues as any[];
      if (!stmtValues || !targetVals || targetVals.length === 0) return;
      const len = Math.min(stmtValues.length, targetVals.length);

        // base per target for this statement
        const stmtColTotals: Record<string, number> = {};
        for (let i = 0; i < len; i++) {
          const tRaw = targetVals[i];
          const sRaw = stmtValues[i];
          if (tRaw === null || tRaw === undefined || sRaw === null || sRaw === undefined) continue;
          const tCode = targetIsScaleGrid ? getScaleBucketCode(tRaw) : String(tRaw).trim();
          if (!targetCodes.includes(tCode)) continue;
          stmtColTotals[tCode] = (stmtColTotals[tCode] || 0) + 1;
        }

        scaleBucketOptions.forEach((bucket) => {
          const cells: Record<string, { count: number; pct: number }> = {};
          targetOptions.forEach((t) => {
            cells[t.code] = { count: 0, pct: 0 };
          });

          for (let i = 0; i < len; i++) {
            const tRaw = targetVals[i];
            const sRaw = stmtValues[i];
            if (tRaw === null || tRaw === undefined || sRaw === null || sRaw === undefined) continue;
            const tCode = targetIsScaleGrid ? getScaleBucketCode(tRaw) : String(tRaw).trim();
            const bucketCode = getScaleBucketCode(sRaw);
            if (bucketCode !== bucket.code) continue;
            if (!targetCodes.includes(tCode)) continue;
            cells[tCode].count += 1;
          }

          targetOptions.forEach((t) => {
            const base = stmtColTotals[t.code] || 0;
            cells[t.code].pct = base > 0 ? (cells[t.code].count / base) * 100 : 0;
          });

          const totalBase = Object.values(stmtColTotals).reduce((a, b) => a + b, 0);
          const totalCount = Object.values(cells).reduce((s, c) => s + (c.count || 0), 0);
          const totalPct = totalBase > 0 ? (totalCount / totalBase) * 100 : 0;

          const table = bucketTables.find((b) => b.code === bucket.code);
          if (table) {
            table.rows.push({ label: stmt.text, cells, totalCount, totalPct, colTotals: { ...stmtColTotals } });
            Object.entries(stmtColTotals).forEach(([code, val]) => {
              table.colTotals[code] = (table.colTotals[code] || 0) + val;
            });
          }
        });
      });

      // Filter out buckets with no rows
      const filteredBuckets = bucketTables.filter((b) => b.rows.length > 0);
      let activeColumns = targetOptions.filter((col) =>
        filteredBuckets.some((b) => (b.colTotals[col.code] || 0) > 0)
      );
      if (activeColumns.length === 0) activeColumns = targetOptions;
      return { target: crosstabActiveTarget, columns: activeColumns, bucketTables: filteredBuckets };
    }

    // Default (non-bucket) flow
    const selectedData = getVariableDataByExpectedHeader(selectedVar.name);
    const selectedValues = Array.isArray(selectedData?.values) ? selectedData.values : [];
    if (selectedValues.length === 0) return null;

    const len = Math.min(selectedValues.length, targetValues.length);

    const colTotals: Record<string, number> = {};
    const totalCounts: Record<string, number> = {};
    for (let i = 0; i < len; i++) {
      const tRaw = targetValues[i];
      const sRaw = selectedValues[i];
      if (tRaw === null || tRaw === undefined || sRaw === null || sRaw === undefined) continue;
      const tCode = targetIsScaleGrid ? getScaleBucketCode(tRaw) : String(tRaw).trim();
      const sCode = String(sRaw).trim();
      if (!tCode || !sCode) continue;
      if (!targetCodes.includes(tCode)) continue;
      colTotals[tCode] = (colTotals[tCode] || 0) + 1;
      totalCounts[sCode] = (totalCounts[sCode] || 0) + 1;
    }

    const rows = responseOptions.map((opt) => {
      const cells: Record<string, { count: number; pct: number }> = {};
      targetOptions.forEach((t) => {
        cells[t.code] = { count: 0, pct: 0 };
      });
      for (let i = 0; i < len; i++) {
        const tRaw = targetValues[i];
        const sRaw = selectedValues[i];
        if (tRaw === null || tRaw === undefined || sRaw === null || sRaw === undefined) continue;
        const tCode = targetIsScaleGrid ? getScaleBucketCode(tRaw) : String(tRaw).trim();
        const sCode = String(sRaw).trim();
        if (sCode !== opt.code) continue;
        if (!targetCodes.includes(tCode)) continue;
        cells[tCode].count += 1;
      }
      Object.keys(cells).forEach((code) => {
        const base = colTotals[code] || 0;
        cells[code].pct = base > 0 ? (cells[code].count / base) * 100 : 0;
      });
      const totalBase = Object.values(colTotals).reduce((a, b) => a + b, 0);
      const totalCount = totalCounts[opt.code] || 0;
      const totalPct = totalBase > 0 ? (totalCount / totalBase) * 100 : 0;
      return { label: opt.text, cells, totalCount, totalPct };
    });

    const activeColumns = targetOptions.filter((col) => (colTotals[col.code] || 0) > 0);
    if (activeColumns.length === 0) return null;
    const totalBaseActive = activeColumns.reduce((sum, c) => sum + (colTotals[c.code] || 0), 0);

    const filteredRows = rows.map((row) => {
      const filteredCells: Record<string, { count: number; pct: number }> = {};
      activeColumns.forEach((c) => {
        filteredCells[c.code] = row.cells[c.code] || { count: 0, pct: 0 };
      });
      const filteredTotalCount = Object.values(filteredCells).reduce((s, c) => s + (c.count || 0), 0);
      const filteredTotalPct = totalBaseActive > 0 ? (filteredTotalCount / totalBaseActive) * 100 : 0;
      return { ...row, cells: filteredCells, totalCount: filteredTotalCount, totalPct: filteredTotalPct };
    });

    const activeColTotals: Record<string, number> = {};
    activeColumns.forEach((c) => {
      activeColTotals[c.code] = colTotals[c.code] || 0;
    });

    return { target: crosstabActiveTarget, columns: activeColumns, rows: filteredRows, colTotals: activeColTotals };
  }, [
    crosstabActiveTarget,
    selectedVar,
    isCrosstabSupported,
    getVariableDataByExpectedHeader,
    responseOptions,
    variables,
    tagsWithScaleDetection,
    useScaleBuckets,
    getScaleBucketCode,
    scaleBucketOptions,
    singleSelectGridStatements,
    matchingQuestion,
    getExpectedHeadersForQuestion,
    isNumericGrid,
    isNumericGridNumberTag,
    isNumericGridPercentTag,
    selectedVarTableSelections,
    multiSelectGridStatements,
    statementHeaderHints,
    selectedVarColumnSuffix,
  ]);

  const crosstabSigSummary = React.useMemo(() => {
    if (!crosstabSummary) return [];
    if ((crosstabSummary as any).bucketTables) return [];

    if ((crosstabSummary as any).mode === 'numeric-grid-crosstab') {
      const tables = (crosstabSummary as any).tables || [];
      const summaries: Array<{ row: string; col: string; colPct: number; targets: Array<{ text: string; pct: number }> }> = [];

      tables.forEach((t: any) => {
        const isMean = !!t.isMeanSummaryTable;
        const cuts: Array<{ code: string; text: string }> = Array.isArray(t.cuts) ? t.cuts : [];
        const nonTotalCuts = cuts.filter((c) => c.code !== 'total');
        const modelsByCutCode: Record<string, any> = t.modelsByCutCode || {};
        const rowOrder: string[] = Array.isArray(t.rowOrder) ? t.rowOrder : [];
        const rowTextByCode: Record<string, string> = t.rowTextByCode || {};
        const gridCols: Array<{ code: string; text: string }> = Array.isArray(t.gridColumns) ? t.gridColumns : [];

        const letterByCutCode = nonTotalCuts.reduce((acc: Record<string, string>, c, idx) => {
          acc[c.code] = String.fromCharCode(65 + idx);
          return acc;
        }, {});

        const getRowForCut = (cutCode: string, rowCode: string) => {
          const model = modelsByCutCode[cutCode];
          return model?.rows?.find((r: any) => r.code === rowCode) || null;
        };

        rowOrder.forEach((rowCode) => {
          gridCols.forEach((gc) => {
            nonTotalCuts.forEach((cut1) => {
              const row1 = getRowForCut(cut1.code, rowCode);
              const v1 = Number(row1?.columnValues?.[gc.code] || 0);
              const n1 = Number(row1?.columnBases?.[gc.code] || 0) || Number(row1?.base || 0);
              const sd1 = Number(row1?.columnStdDevs?.[gc.code] || 0);

              const targets: Array<{ text: string; pct: number }> = [];

              nonTotalCuts.forEach((cut2) => {
                if (cut2.code === cut1.code) return;
                const row2 = getRowForCut(cut2.code, rowCode);
                const v2 = Number(row2?.columnValues?.[gc.code] || 0);
                const n2 = Number(row2?.columnBases?.[gc.code] || 0) || Number(row2?.base || 0);
                const sd2 = Number(row2?.columnStdDevs?.[gc.code] || 0);

                let isSignificant = false;
                if (isMean) {
                  if (n1 > 1 && n2 > 1 && (sd1 > 0 || sd2 > 0)) {
                    const se = Math.sqrt((sd1 * sd1) / n1 + (sd2 * sd2) / n2);
                    if (se > 0) {
                      const test = (v1 - v2) / se;
                      isSignificant = test >= 1.96;
                    }
                  }
                } else {
                  const totals1 = modelsByCutCode[cut1.code]?.totalValuesByColumn || {};
                  const totals2 = modelsByCutCode[cut2.code]?.totalValuesByColumn || {};
                  const denom1 = Number(totals1?.[gc.code] || 0);
                  const denom2 = Number(totals2?.[gc.code] || 0);
                  const p1 = denom1 > 0 ? v1 / denom1 : 0;
                  const p2 = denom2 > 0 ? v2 / denom2 : 0;
                  if (n1 > 0 && n2 > 0) {
                    const zDen = Math.sqrt((p1 * (1 - p1)) / n1 + (p2 * (1 - p2)) / n2);
                    if (zDen > 0) {
                      const z = (p1 - p2) / zDen;
                      isSignificant = z >= 1.96;
                    }
                  }
                }

                if (isSignificant) {
                  if (isMean) {
                    targets.push({ text: cut2.text, pct: v2 });
                  } else {
                    const denom2 = Number((modelsByCutCode[cut2.code]?.totalValuesByColumn || {})?.[gc.code] || 0);
                    const pct2 = denom2 > 0 ? (v2 / denom2) * 100 : 0;
                    targets.push({ text: cut2.text, pct: pct2 });
                  }
                }
              });

              if (targets.length === 0) return;

              const rowText = rowTextByCode[rowCode] || rowCode;
              const gridSuffix = gridCols.length > 1 ? ` - ${gc.text || gc.code}` : '';
              const rowLabel = `${rowText}${gridSuffix} (${t.summaryType || (isMean ? 'mean' : 'sum')})`;

              const colPct = isMean
                ? v1
                : (() => {
                    const denom1 = Number((modelsByCutCode[cut1.code]?.totalValuesByColumn || {})?.[gc.code] || 0);
                    return denom1 > 0 ? (v1 / denom1) * 100 : 0;
                  })();

              // Only include columns that have stat letters (non-total cuts)
              if (!letterByCutCode[cut1.code]) return;

              summaries.push({
                row: rowLabel,
                col: cut1.text,
                colPct,
                targets,
              });
            });
          });
        });
      });

      return summaries;
    }

    // Handle multi-table mode
    if ((crosstabSummary as any).mode === 'numeric-grid-multi') {
      const tables = (crosstabSummary as any).tables || [];
      // Apply sig testing to all tables (both mean and sum)
      const allSummaries: Array<{ row: string; col: string; colPct: number; targets: Array<{ text: string; pct: number }> }> = [];

      tables.forEach((ng: any) => {
        const columns = ng.columns || [];
        const bases: Record<string, number> = ng.columnBases || {};
        const isMeanMode = ng.valueType === 'mean';
        const letterToCol: Record<string, { code: string; text: string }> = {};
        columns.forEach((col: any, idx: number) => {
          letterToCol[String.fromCharCode(65 + idx)] = { code: col.code, text: col.text };
        });
        ng.rows.forEach((row: any) => {
          const lettersMap: Record<string, string> = {};
          columns.forEach((col: any, colIdx: number) => {
            const base = bases[col.code] || 0;
            const cell = row.cells[col.code] || { value: 0, base: 0, pct: 0, stdDev: 0 };
            const lettersArr: string[] = [];

            if (base > 0 && cell.base > 0) {
              columns.forEach((compareCol: any, compareIdx: number) => {
                if (compareCol.code === col.code) return;
                const base2 = bases[compareCol.code] || 0;
                const cell2 = row.cells[compareCol.code] || { value: 0, base: 0, pct: 0, stdDev: 0 };
                if (base2 <= 0 || cell2.base <= 0) return;

                let isSignificant = false;
                if (isMeanMode) {
                  // T-test for comparing means
                  const mean1 = cell.value;
                  const mean2 = cell2.value;
                  const n1 = cell.base;
                  const n2 = cell2.base;
                  const sd1 = cell.stdDev || 0;
                  const sd2 = cell2.stdDev || 0;

                  if (n1 > 1 && n2 > 1 && (sd1 > 0 || sd2 > 0)) {
                    const se = Math.sqrt((sd1 * sd1) / n1 + (sd2 * sd2) / n2);
                    if (se > 0) {
                      const t = Math.abs(mean1 - mean2) / se;
                      isSignificant = t >= 1.96;
                    }
                  }
                } else {
                  // Proportion test for sum mode
                  const p1 = ((cell.pct || 0) as number) / 100;
                  const p2 = ((cell2.pct || 0) as number) / 100;
                  const zDen = Math.sqrt((p1 * (1 - p1)) / base + (p2 * (1 - p2)) / base2);
                  if (zDen > 0) {
                    const z = (p1 - p2) / zDen;
                    isSignificant = z >= 1.96;
                  }
                }

                if (isSignificant) {
                  lettersArr.push(String.fromCharCode(65 + compareIdx));
                }
              });
            }
            lettersMap[col.code] = lettersArr.join('');
          });
          Object.entries(lettersMap).forEach(([colCode, letters]) => {
            if (!letters) return;
            const letterArr = letters.split('');
            const col = columns.find((c: any) => c.code === colCode);
            if (!col) return;
            const cell = row.cells[colCode] || { value: 0, pct: 0 };
            const displayValue = isMeanMode ? cell.value : cell.pct;
            const targets = letterArr
              .map((l) => {
                const mapping = letterToCol[l];
                if (!mapping) return null;
                const targetCell = row.cells[mapping.code] || { value: 0, pct: 0 };
                const targetValue = isMeanMode ? targetCell.value : targetCell.pct;
                return { text: mapping.text, pct: targetValue };
              })
              .filter(Boolean) as Array<{ text: string; pct: number }>;
            allSummaries.push({
              row: `${row.label} (${ng.valueType})`,
              col: col.text,
              colPct: displayValue,
              targets,
            });
          });
        });
      });
      return allSummaries;
    }

    // Handle single numeric-grid mode
    if ((crosstabSummary as any).mode === 'numeric-grid') {
      const ng: any = crosstabSummary;
      const columns = ng.columns || [];
      const bases: Record<string, number> = ng.columnBases || {};
      const isMeanMode = ng.valueType === 'mean';
      const letterToCol: Record<string, { code: string; text: string }> = {};
      columns.forEach((col: any, idx: number) => {
        letterToCol[String.fromCharCode(65 + idx)] = { code: col.code, text: col.text };
      });
      const summaries: Array<{ row: string; col: string; colPct: number; targets: Array<{ text: string; pct: number }> }> = [];
      ng.rows.forEach((row: any) => {
        const lettersMap: Record<string, string> = {};
        columns.forEach((col: any, colIdx: number) => {
          const base = bases[col.code] || 0;
          const cell = row.cells[col.code] || { value: 0, base: 0, pct: 0, stdDev: 0 };
          const lettersArr: string[] = [];

          if (base > 0 && cell.base > 0) {
            columns.forEach((compareCol: any, compareIdx: number) => {
              if (compareCol.code === col.code) return;
              const base2 = bases[compareCol.code] || 0;
              const cell2 = row.cells[compareCol.code] || { value: 0, base: 0, pct: 0, stdDev: 0 };
              if (base2 <= 0 || cell2.base <= 0) return;

              let isSignificant = false;
              if (isMeanMode) {
                // T-test for comparing means
                const mean1 = cell.value;
                const mean2 = cell2.value;
                const n1 = cell.base;
                const n2 = cell2.base;
                const sd1 = cell.stdDev || 0;
                const sd2 = cell2.stdDev || 0;

                if (n1 > 1 && n2 > 1 && (sd1 > 0 || sd2 > 0)) {
                  const se = Math.sqrt((sd1 * sd1) / n1 + (sd2 * sd2) / n2);
                  if (se > 0) {
                    const t = Math.abs(mean1 - mean2) / se;
                    isSignificant = t >= 1.96;
                  }
                }
              } else {
                // Proportion test for sum mode
                const p1 = ((cell.pct || 0) as number) / 100;
                const p2 = ((cell2.pct || 0) as number) / 100;
                const zDen = Math.sqrt((p1 * (1 - p1)) / base + (p2 * (1 - p2)) / base2);
                if (zDen > 0) {
                  const z = (p1 - p2) / zDen;
                  isSignificant = z >= 1.96;
                }
              }

              if (isSignificant) {
                lettersArr.push(String.fromCharCode(65 + compareIdx));
              }
            });
          }
          lettersMap[col.code] = lettersArr.join('');
        });
        Object.entries(lettersMap).forEach(([colCode, letters]) => {
          if (!letters) return;
          const letterArr = letters.split('');
          const col = columns.find((c: any) => c.code === colCode);
          if (!col) return;
          const cell = row.cells[colCode] || { value: 0, pct: 0 };
          const displayValue = isMeanMode ? cell.value : cell.pct;
          const targets = letterArr
            .map((l) => {
              const mapping = letterToCol[l];
              if (!mapping) return null;
              const targetCell = row.cells[mapping.code] || { value: 0, pct: 0 };
              const targetValue = isMeanMode ? targetCell.value : targetCell.pct;
              return { text: mapping.text, pct: targetValue };
            })
            .filter(Boolean) as Array<{ text: string; pct: number }>;
          summaries.push({
            row: row.label,
            col: col.text,
            colPct: displayValue,
            targets,
          });
        });
      });
      return summaries;
    }

    const columns = crosstabSummary.columns;
    const colTotals = crosstabSummary.colTotals || {};
    const letterToCol: Record<string, { code: string; text: string }> = {};
    columns.forEach((col, idx) => {
      letterToCol[String.fromCharCode(65 + idx)] = { code: col.code, text: col.text };
    });

    const summaries: Array<{ row: string; col: string; colPct: number; targets: Array<{ text: string; pct: number }> }> = [];

    crosstabSummary.rows.forEach((row) => {
      const lettersMap: Record<string, string> = {};
      columns.forEach((col) => {
        const base = colTotals[col.code] || 0;
        const lettersArr: string[] = [];
        if (base > 0) {
          const p1 = (row.cells[col.code]?.count || 0) / base;
          columns.forEach((compareCol, compareIdx) => {
            if (compareCol.code === col.code) return;
            const base2 = colTotals[compareCol.code] || 0;
            if (base2 <= 0) return;
            const p2 = (row.cells[compareCol.code]?.count || 0) / base2;
            const zDen = Math.sqrt((p1 * (1 - p1)) / base + (p2 * (1 - p2)) / base2);
            if (zDen > 0) {
              const z = (p1 - p2) / zDen;
              if (z >= 1.96) {
                lettersArr.push(String.fromCharCode(65 + compareIdx));
              }
            }
          });
        }
        lettersMap[col.code] = lettersArr.join('');
      });

      columns.forEach((col) => {
        const letters = lettersMap[col.code];
        if (letters) {
          const targets = letters
            .split('')
            .map((l) => letterToCol[l])
            .filter(Boolean)
            .map((meta) => ({
              text: meta.text,
              pct: row.cells[meta.code]?.pct ?? 0,
            }));
          if (targets.length) {
            summaries.push({
              row: row.label,
              col: col.text,
              colPct: row.cells[col.code]?.pct ?? 0,
              targets
            });
          }
        }
      });
    });

    return summaries;
  }, [crosstabSummary]);

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
    <>
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
                      <span className="text-xs px-2 py-1 rounded bg-blue-100 text-blue-800" style={{ minWidth: '80px', textAlign: 'center' }}>
                        {questionType}
                      </span>
                      {tags.length > 0 && tags.map((tag: string, idx: number) => (
                        <span
                          key={idx}
                          className="text-xs px-2 py-1 rounded bg-gray-200 text-gray-800"
                        >
                          {tag}
                        </span>
                      ))}
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
                      {isChartSupported && chartStatus !== 'chart' && !crosstabActiveTarget && (
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
                      {isCrosstabSupported && isChartSupported && chartStatus !== 'chart' && (
                        <button
                          type="button"
                          className={
                            crosstabActiveTarget
                              ? 'text-xs px-3 py-1 rounded border border-gray-300 text-gray-800 bg-white hover:bg-gray-100 transition'
                              : 'text-xs px-3 py-1 rounded bg-[#D14A2D] text-white hover:bg-[#bf4329] transition'
                          }
                          onClick={handleCrosstabButtonClick}
                          disabled={chartStatus === 'loading'}
                        >
                          {crosstabActiveTarget ? 'View tables' : 'Run crosstab'}
                        </button>
                      )}
                      {isCrosstabSupported && isChartSupported && chartStatus === 'table' && crosstabActiveTarget && (
                        <button
                          type="button"
                          className="text-xs px-3 py-1 rounded bg-[#D14A2D] text-white hover:bg-[#bf4329] transition"
                          onClick={() => {
                            const firstEligible = variables.find((v) => {
                              const tl = v.type?.toLowerCase() || '';
                              return v.name !== selectedVariable && tl.includes('single select') && !tl.includes('grid');
                            });
                            setCrosstabTarget(firstEligible?.name || null);
                            setShowCrosstabModal(true);
                          }}
                          disabled={chartStatus === 'loading'}
                        >
                          Run New Crosstab
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
                {chartStatus === 'table' && crosstabSummary && (
                  <div className="mb-4 space-y-6">
                    <div className="mb-2 flex items-start justify-between gap-4">
                      <div>
                        <div className="flex items-center gap-2">
                          <h4 className="text-sm font-semibold text-gray-900">
                            Crosstab for: {crosstabTargetQuestion?.number || crosstabSummary.target}
                          </h4>
                        </div>
                        {crosstabTargetQuestion?.text ? (
                          <div className="text-sm text-gray-700 whitespace-pre-line">
                            {crosstabTargetQuestion.text}
                          </div>
                        ) : null}
                        <div className="text-xs text-gray-600 italic mt-1">
                          *Only showing columns with base greater than 0
                        </div>
                      </div>
                    </div>

                    {((crosstabSummary as any).mode === 'numeric-grid-crosstab') ? (
                      <GridNumericCrosstabTables
                        tables={(crosstabSummary as any).tables || []}
                        onViewSummary={() => setShowCrosstabSummary(true)}
                      />
                    ) : useScaleBuckets && crosstabSummary.bucketTables ? (
                      <div className="space-y-6">
                        {crosstabSummary.bucketTables.map((bucket, bucketIdx) => {
                          const lettersMapCache: Record<number, Record<string, string>> = {};
                          return (
                            <div key={bucket.code} className="border border-gray-200 rounded-lg bg-white overflow-hidden">
                              <table className="min-w-full table-fixed">
                                <thead className="bg-[#D14A2D]">
                                  <tr>
                                    <th className="px-4 py-2 text-left text-xs font-semibold text-white uppercase tracking-wider border-r border-[#D14A2D] whitespace-nowrap">
                                      <div className="flex items-center gap-2">
                                        <span>{bucket.text}</span>
                                        {bucket.rows.length > 0 && (
                                          <button
                                            type="button"
                                            className="text-[11px] px-2 py-0.5 rounded border border-white/60 text-white hover:bg-white/10 transition"
                                            onClick={() => setShowCrosstabSummary({ bucketIndex: bucketIdx })}
                                          >
                                            View Summary
                                          </button>
                                        )}
                                      </div>
                                    </th>
                                    <th className="px-3 py-2 text-center text-xs font-semibold text-white uppercase tracking-wider border-l border-[#D14A2D] whitespace-nowrap w-28 max-w-[7.5rem] overflow-hidden text-ellipsis">Total</th>
                                    {crosstabSummary.columns.map((col) => (
                                      <th key={col.code} className="px-3 py-2 text-center text-xs font-semibold text-white uppercase tracking-wider border-l border-[#D14A2D] whitespace-nowrap w-28 max-w-[7.5rem] overflow-hidden text-ellipsis">
                                        {col.text}
                                      </th>
                                    ))}
                                  </tr>
                                </thead>
                                <tbody className="bg-white divide-y divide-gray-200">
                                  <tr className="bg-[#D14A2D]">
                                    <td className="px-4 py-2 border-r border-[#D14A2D]"></td>
                                    <td className="px-4 py-2 text-xs text-white text-center border-l border-[#D14A2D] font-semibold"></td>
                                    {crosstabSummary.columns.map((col, idx) => (
                                      <td key={col.code} className="px-4 py-2 text-xs text-white text-center border-l border-[#D14A2D] font-semibold">
                                        ({String.fromCharCode(65 + idx)})
                                      </td>
                                    ))}
                                  </tr>
                                  {bucket.rows.map((row, rowIdx) => {
                                    const lettersMap: Record<string, string> = lettersMapCache[rowIdx] || {};
                                    if (!lettersMapCache[rowIdx]) {
                                      let hasLetters = false;
                                      crosstabSummary.columns.forEach((col, colIdx) => {
                                        const base = bucket.colTotals?.[col.code] || 0;
                                        const lettersArr: string[] = [];
                                        if (base > 0) {
                                          const p1 = (row.cells[col.code]?.count || 0) / base;
                                          crosstabSummary.columns.forEach((compareCol, compareIdx) => {
                                            if (compareCol.code === col.code) return;
                                            const base2 = bucket.colTotals?.[compareCol.code] || 0;
                                            if (base2 <= 0) return;
                                            const p2 = (row.cells[compareCol.code]?.count || 0) / base2;
                                            const zDen = Math.sqrt((p1 * (1 - p1)) / base + (p2 * (1 - p2)) / base2);
                                            if (zDen > 0) {
                                              const z = (p1 - p2) / zDen;
                                              if (z >= 1.96) {
                                                lettersArr.push(String.fromCharCode(65 + compareIdx));
                                              }
                                            }
                                          });
                                        }
                                        const trimmed = lettersArr.join('');
                                        if (trimmed) hasLetters = true;
                                        lettersMap[col.code] = trimmed;
                                        lettersMapCache[rowIdx] = lettersMap;
                                      });
                                    }

                                    const hasLetters = Object.values(lettersMap).some((v) => v);
                                    return (
                                      <React.Fragment key={`${bucket.code}-${row.label}-${rowIdx}`}>
                                        {(() => {
                                          const totalBaseRow = Object.values(row.colTotals || {}).reduce((s, v) => s + v, 0);
                                          const hasZero = totalBaseRow === 0 || crosstabSummary.columns.some((col) => ((row.colTotals || {})[col.code] || 0) === 0);
                                          const baseTextColor = hasZero ? 'text-red-700' : 'text-gray-900';
                                          return (
                                            <tr className="bg-gray-50">
                                              <td className="px-4 py-2 text-xs font-medium italic text-gray-700 border-r border-gray-200">Base (Total responding)</td>
                                              <td className={`px-4 py-2 text-xs italic ${baseTextColor} text-center border-l border-gray-200`}>
                                                {totalBaseRow.toLocaleString()}
                                              </td>
                                              {crosstabSummary.columns.map((col) => {
                                                const base = (row.colTotals || {})[col.code] || 0;
                                                return (
                                                  <td key={col.code} className={`px-4 py-2 text-xs italic ${baseTextColor} text-center border-l border-gray-200`}>
                                                    {base.toLocaleString()}
                                                    {base > 0 && base < 15 ? <span className="text-red-600 font-semibold">*</span> : null}
                                                  </td>
                                                );
                                              })}
                                            </tr>
                                          );
                                        })()}
                                        <tr>
                                          <td className="px-4 py-2 text-sm font-medium text-gray-900 border-r border-gray-200" rowSpan={hasLetters ? 3 : 2}>{row.label}</td>
                                          <td className="px-4 py-2 text-sm text-gray-900 text-center border-l border-gray-200">
                                            {row.totalCount.toLocaleString()}
                                          </td>
                                          {crosstabSummary.columns.map((col) => {
                                            const letters = lettersMap[col.code];
                                            return (
                                              <td
                                                key={col.code}
                                                className="px-4 py-2 text-sm text-gray-900 text-center border-l border-gray-200"
                                                style={{ backgroundColor: letters ? '#e0f2ff' : 'transparent', fontWeight: '400', color: '#111827' }}
                                              >
                                                {row.cells[col.code]?.count.toLocaleString() ?? '0'}
                                              </td>
                                            );
                                          })}
                                        </tr>
                                        <tr>
                                          <td className="px-4 py-2 text-xs text-gray-900 text-center border-l border-gray-200">
                                            {row.totalPct.toFixed(1)}%
                                          </td>
                                          {crosstabSummary.columns.map((col) => {
                                            const letters = lettersMap[col.code];
                                            return (
                                              <td
                                                key={col.code}
                                                className="px-4 py-2 text-xs text-gray-900 text-center border-l border-gray-200"
                                                style={{ backgroundColor: letters ? '#e0f2ff' : 'transparent', fontWeight: '400', color: '#111827' }}
                                              >
                                                {(row.cells[col.code]?.pct ?? 0).toFixed(1)}%
                                              </td>
                                            );
                                          })}
                                        </tr>
                                        {hasLetters && (
                                          <tr>
                                            <td className="px-4 py-1 text-[11px] text-gray-700 text-center border-l border-gray-200"></td>
                                            {crosstabSummary.columns.map((col) => {
                                              const letters = lettersMap[col.code] || '';
                                              return (
                                                <td
                                                  key={col.code}
                                                  className="px-4 py-1 text-[11px] font-semibold text-blue-700 text-center border-l border-gray-200"
                                                  style={{ backgroundColor: letters ? '#e0f2ff' : 'transparent' }}
                                                >
                                                  {letters}
                                                </td>
                                              );
                                            })}
                                          </tr>
                                        )}
                                      </React.Fragment>
                                    );
                                  })}
                                </tbody>
                              </table>
                            </div>
                          );
                        })}
                      </div>
                    ) : (
                      <div className="border border-gray-200 rounded-lg bg-white overflow-hidden">
                        <table className="min-w-full table-fixed">
                          <thead className="bg-[#D14A2D]">
                            <tr>
                              <th className="px-4 py-2 text-left text-xs font-semibold text-white uppercase tracking-wider border-r border-[#D14A2D]"></th>
                              <th className="px-3 py-2 text-center text-xs font-semibold text-white uppercase tracking-wider border-l border-[#D14A2D] whitespace-nowrap w-28 max-w-[7.5rem] overflow-hidden text-ellipsis">Total</th>
                              {crosstabSummary.columns.map((col) => (
                                <th key={col.code} className="px-3 py-2 text-center text-xs font-semibold text-white uppercase tracking-wider border-l border-[#D14A2D] whitespace-nowrap w-28 max-w-[7.5rem] overflow-hidden text-ellipsis">
                                  {col.text}
                                </th>
                              ))}
                            </tr>
                          </thead>
                          <tbody className="bg-white divide-y divide-gray-200">
                            <tr className="bg-[#D14A2D]">
                              <td className="px-4 py-2 border-r border-[#D14A2D]"></td>
                              <td className="px-4 py-2 text-xs text-white text-center border-l border-[#D14A2D] font-semibold"></td>
                              {crosstabSummary.columns.map((col, idx) => (
                                <td key={col.code} className="px-4 py-2 text-xs text-white text-center border-l border-[#D14A2D] font-semibold">
                                  ({String.fromCharCode(65 + idx)})
                                </td>
                              ))}
                            </tr>
                            <tr className="bg-gray-100">
                              <td className="px-4 py-2 text-sm font-medium text-gray-900 border-r border-gray-200">Base (Total responding)</td>
                              <td className="px-4 py-2 text-sm text-gray-900 text-center border-l border-gray-200">
                                {crosstabSummary.rows.reduce((sum, r) => sum + (r.totalCount || 0), 0).toLocaleString()}
                              </td>
                              {crosstabSummary.columns.map((col) => {
                                const colBase = crosstabSummary.rows.reduce((sum, r) => sum + (r.cells[col.code]?.count || 0), 0);
                                return (
                                  <td key={col.code} className="px-4 py-2 text-sm text-gray-900 text-center border-l border-gray-200">
                                    {colBase.toLocaleString()}
                                    {colBase > 0 && colBase < 15 ? <span className="text-red-600 font-semibold">*</span> : null}
                                  </td>
                                );
                              })}
                            </tr>
                            {crosstabSummary.rows.map((row, idx) => {
                              const isAlt = idx % 2 === 1;
                              const rowBg = isAlt ? 'bg-gray-50' : 'bg-white';
                              const lettersMap: Record<string, string> = {};
                              let hasLetters = false;
                              crosstabSummary.columns.forEach((col, colIdx) => {
                                const base = crosstabSummary.colTotals?.[col.code] || 0;
                                const lettersArr: string[] = [];
                                if (base > 0) {
                                  const p1 = (row.cells[col.code]?.count || 0) / base;
                                  crosstabSummary.columns.forEach((compareCol, compareIdx) => {
                                    if (compareCol.code === col.code) return;
                                    const base2 = crosstabSummary.colTotals?.[compareCol.code] || 0;
                                    if (base2 <= 0) return;
                                    const p2 = (row.cells[compareCol.code]?.count || 0) / base2;
                                    const zDen = Math.sqrt((p1 * (1 - p1)) / base + (p2 * (1 - p2)) / base2);
                                    if (zDen > 0) {
                                      const z = (p1 - p2) / zDen;
                                      if (z >= 1.96) {
                                        lettersArr.push(String.fromCharCode(65 + compareIdx));
                                      }
                                    }
                                  });
                                }
                              const trimmed = lettersArr.join('');
                                if (trimmed) hasLetters = true;
                                lettersMap[col.code] = trimmed;
                              });
                              return (
                                <React.Fragment key={idx}>
                                  <tr className={rowBg}>
                                    <td className="px-4 py-2 text-sm font-medium text-gray-900 border-r border-gray-200" rowSpan={hasLetters ? 3 : 2}>{row.label}</td>
                                    <td className="px-4 py-2 text-sm text-gray-900 text-center border-l border-gray-200">
                                      {row.totalCount.toLocaleString()}
                                    </td>
                                    {crosstabSummary.columns.map((col) => {
                                      const letters = lettersMap[col.code];
                                      return (
                                        <td
                                          key={col.code}
                                          className="px-4 py-2 text-sm text-gray-900 text-center border-l border-gray-200"
                                          style={{ backgroundColor: letters ? '#e0f2ff' : 'transparent', fontWeight: '400', color: '#111827' }}
                                        >
                                          {row.cells[col.code]?.count.toLocaleString() ?? '0'}
                                        </td>
                                      );
                                    })}
                                  </tr>
                                  <tr className={rowBg}>
                                    <td className="px-4 py-2 text-xs text-gray-900 text-center border-l border-gray-200">
                                      {row.totalPct.toFixed(1)}%
                                    </td>
                                    {crosstabSummary.columns.map((col) => {
                                      const letters = lettersMap[col.code];
                                      return (
                                        <td
                                          key={col.code}
                                          className="px-4 py-2 text-xs text-gray-900 text-center border-l border-gray-200"
                                          style={{ backgroundColor: letters ? '#e0f2ff' : 'transparent', fontWeight: '400', color: '#111827' }}
                                        >
                                          {(row.cells[col.code]?.pct ?? 0).toFixed(1)}%
                                        </td>
                                      );
                                    })}
                                  </tr>
                                  {hasLetters && (
                                    <tr className={rowBg}>
                                      <td className="px-4 py-1 text-[11px] text-gray-700 text-center border-l border-gray-200"></td>
                                      {crosstabSummary.columns.map((col) => {
                                        const letters = lettersMap[col.code] || '';
                                        return (
                                          <td
                                            key={col.code}
                                            className="px-4 py-1 text-[11px] font-semibold text-blue-700 text-center border-l border-gray-200"
                                            style={{ backgroundColor: letters ? '#e0f2ff' : 'transparent' }}
                                          >
                                            {letters}
                                          </td>
                                        );
                                      })}
                                    </tr>
                                  )}
                                </React.Fragment>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>
                )}
                {chartStatus === 'table' && tableVar && !crosstabSummary && (
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
                      <div className="text-sm font-medium text-gray-700 animate-pulse">
                        {crosstabLoading ? 'Running crosstab' : 'Generating chart'}
                      </div>
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
    {showCrosstabModal && (
      <div
        className="fixed z-40 px-4 pointer-events-none"
        style={{ top: '260px', right: '32px', left: 'auto', transform: 'none' }}
      >
        <div
          ref={crosstabModalRef}
          className="bg-gray-50 rounded-lg shadow-xl w-full max-w-2xl p-4 space-y-4 border border-gray-300 pointer-events-auto"
        >
          <div className="flex items-start justify-between gap-4">
            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <span className="text-sm font-semibold text-gray-900">{questionNumber || selectedVar?.name}</span>
                {selectedVar?.type ? (
                  <span className="text-[11px] px-2 py-0.5 rounded-full bg-blue-100 text-blue-800">
                    {selectedVar.type}
                  </span>
                ) : null}
              </div>
              {headerQuestionTextGlobal ? (
                <div className="text-sm text-gray-700 whitespace-pre-line">{headerQuestionTextGlobal}</div>
              ) : null}
            </div>
            <button
              className="text-gray-400 hover:text-gray-600"
              onClick={() => setShowCrosstabModal(false)}
            >
              <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
                <path fillRule="evenodd" d="M10 8.586l4.95-4.95a1 1 0 111.414 1.414L11.414 10l4.95 4.95a1 1 0 01-1.414 1.414L10 11.414l-4.95 4.95a1 1 0 01-1.414-1.414L8.586 10l-4.95-4.95A1 1 0 115.05 3.636L10 8.586z" clipRule="evenodd" />
              </svg>
            </button>
          </div>
          <div className="space-y-2">
            <label className="text-xs font-medium text-gray-700">Cross by question</label>
            <div className="border border-gray-200 rounded-md max-h-80 overflow-y-auto p-1 space-y-1">
              {variables
                .filter((v) => v.name !== selectedVariable)
                .filter((v) => {
                  const typeLowerVar = v.type?.toLowerCase() || '';
                  const tags = Array.isArray((v as any).tags) ? (v as any).tags : [];
                  const hasScale = tags.some((t: string) => /scale\s*\(7pt\)/i.test(String(t)));
                  const isSs = typeLowerVar.includes('single select') && !typeLowerVar.includes('grid');
                  const isSsgScale = typeLowerVar.includes('single select grid') && hasScale;
                  return isSs || isSsgScale;
                })
                .map((v) => {
                  const meta = getQuestionMetaForVar(v);
                  const isSelected = crosstabTarget === v.name;
                  return (
                    <button
                      key={v.name}
                      type="button"
                      onClick={() => setCrosstabTarget(v.name)}
                      className={`w-full text-left px-3 py-2 rounded-lg text-sm transition-colors ${
                        isSelected ? 'bg-orange-100 text-orange-900' : 'hover:bg-gray-100 text-gray-700'
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 text-sm text-gray-900 truncate">
                            <span className="whitespace-nowrap font-semibold">{meta.number}</span>
                            <span className="truncate font-normal">{meta.text || v.name}</span>
                          </div>
                          <div className="text-xs text-gray-600 truncate mt-0.5">
                            {meta.type || 'Unknown type'}
                          </div>
                        </div>
                      </div>
                    </button>
                  );
                })}
            </div>
          </div>
          <div className="flex items-center justify-end gap-2">
            <button
              className="text-sm px-3 py-1 rounded border border-gray-300 text-gray-700 hover:bg-gray-50"
              onClick={() => setShowCrosstabModal(false)}
            >
              Cancel
            </button>
            <button
              className="text-sm px-3 py-1 rounded text-white"
              style={{ backgroundColor: BRAND_ORANGE }}
              disabled={!crosstabTarget}
              onClick={startCrosstabRun}
            >
              Run
            </button>
          </div>
        </div>
      </div>
    )}
    {showCrosstabSummary && (
      <div className="fixed inset-0 z-40 flex items-center justify-center px-4 pointer-events-none">
        <div
          ref={crosstabSummaryRef}
          className="bg-gray-50 rounded-lg shadow-xl w-full max-w-xl p-4 space-y-3 border border-gray-300 pointer-events-auto"
        >
          <div className="flex items-start justify-between gap-4">
            <div className="space-y-1">
              <h4 className="text-sm font-semibold text-gray-900">Crosstab summary</h4>
              <div className="text-xs text-gray-600">
                Showing significant differences at 95% confidence (letters in table).
              </div>
            </div>
            <button
              className="text-gray-400 hover:text-gray-600"
              onClick={() => setShowCrosstabSummary(false)}
            >
              <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
                <path fillRule="evenodd" d="M10 8.586l4.95-4.95a1 1 0 111.414 1.414L11.414 10l4.95 4.95a1 1 0 01-1.414 1.414L10 11.414l-4.95 4.95a1 1 0 01-1.414-1.414L8.586 10l-4.95-4.95A1 1 0 115.05 3.636L10 8.586z" clipRule="evenodd" />
              </svg>
            </button>
          </div>
          <div className="border-t border-gray-200" />
            {(() => {
            if (!crosstabSummary) return <div className="text-sm text-gray-700">No crosstab data available.</div>;
            const rowsLength = Array.isArray((crosstabSummary as any).rows) ? (crosstabSummary as any).rows.length : 0;
            const bucketLength = Array.isArray((crosstabSummary as any).bucketTables) ? (crosstabSummary as any).bucketTables.length : 0;
            if (rowsLength === 0 && bucketLength === 0) {
              return <div className="text-sm text-gray-700">No crosstab data available.</div>;
            }
            return null;
          })()}
          {crosstabSummary && !crosstabSummary.bucketTables && (
            <>
              {crosstabSigSummary.length === 0 ? (
                <div className="text-sm text-gray-700">No significant differences found.</div>
              ) : (
                <div className="max-h-80 overflow-y-auto space-y-3">
                  {Object.entries(
                    crosstabSigSummary.reduce<Record<string, typeof crosstabSigSummary>>((acc, item) => {
                      acc[item.row] = acc[item.row] || [];
                      acc[item.row].push(item);
                      return acc;
                    }, {})
                  ).map(([rowLabel, items]) => (
                    <div key={rowLabel} className="space-y-1">
                      <div className="text-sm font-semibold text-gray-900">
                        {(questionNumber || selectedVar?.name || 'Question')} - Answered "{rowLabel}"
                      </div>
                      <ul className="list-disc list-outside pl-5 space-y-1">
                        {items.map((item, idx) => (
                          <li key={`${rowLabel}-${item.col}-${idx}`} className="text-sm text-gray-900">
                            <span>{item.col}</span>{' '}
                            <span className="text-xs italic text-blue-700">
                              ({item.colPct.toFixed(0)}%)
                            </span>{' '}
                            {item.targets.length > 1 ? (
                              <>
                                is significantly higher compared to:
                                <ul className="list-disc list-inside mt-1 space-y-0.5">
                                  {item.targets.map((t) => (
                                    <li key={`${rowLabel}-${item.col}-${t.text}`} className="text-sm text-gray-900">
                                      {t.text}{' '}
                                      <span className="text-xs italic text-blue-700">({t.pct.toFixed(0)}%)</span>
                                    </li>
                                  ))}
                                </ul>
                              </>
                            ) : (
                              <>
                                is significantly higher vs{' '}
                                {item.targets.map((t) => (
                                  <span key={`${rowLabel}-${item.col}-${t.text}`}>
                                    {t.text}{' '}
                                    <span className="text-xs italic text-blue-700">({t.pct.toFixed(0)}%)</span>
                                  </span>
                                ))}
                              </>
                            )}
                          </li>
                        ))}
                      </ul>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
          {crosstabSummary && crosstabSummary.bucketTables && typeof showCrosstabSummary === 'object' && (
            (() => {
              const bucketIndex = showCrosstabSummary.bucketIndex;
              const bucket = crosstabSummary.bucketTables?.[bucketIndex];
              if (!bucket) return <div className="text-sm text-gray-700">No crosstab data available.</div>;
              const rows = bucket.rows || [];
              if (rows.length === 0) return <div className="text-sm text-gray-700">No significant differences found.</div>;
              const bucketLabelTag = bucket.code === 't2b' ? ' (T2B)' : bucket.code === 'm3b' ? ' (M3B)' : bucket.code === 'b2b' ? ' (B2B)' : '';

              const columns = crosstabSummary.columns;
              const colTotals = bucket.colTotals || {};
              const letterToCol: Record<string, { code: string; text: string }> = {};
              columns.forEach((col, idx) => {
                letterToCol[String.fromCharCode(65 + idx)] = { code: col.code, text: col.text };
              });

              const summaries: Array<{ row: string; col: string; colPct: number; targets: Array<{ text: string; pct: number }> }> = [];

              rows.forEach((row) => {
                const lettersMap: Record<string, string> = {};
                columns.forEach((col) => {
                  const base = colTotals[col.code] || 0;
                  const lettersArr: string[] = [];
                  if (base > 0) {
                    const p1 = (row.cells[col.code]?.count || 0) / base;
                    columns.forEach((compareCol, compareIdx) => {
                      if (compareCol.code === col.code) return;
                      const base2 = colTotals[compareCol.code] || 0;
                      if (base2 <= 0) return;
                      const p2 = (row.cells[compareCol.code]?.count || 0) / base2;
                      const zDen = Math.sqrt((p1 * (1 - p1)) / base + (p2 * (1 - p2)) / base2);
                      if (zDen > 0) {
                        const z = (p1 - p2) / zDen;
                        if (z >= 1.96) {
                          lettersArr.push(String.fromCharCode(65 + compareIdx));
                        }
                      }
                    });
                  }
                  lettersMap[col.code] = lettersArr.join('');
                });

                columns.forEach((col) => {
                  const letters = lettersMap[col.code];
                  if (letters) {
                    const targets = letters
                      .split('')
                      .map((l) => letterToCol[l])
                      .filter(Boolean)
                      .map((meta) => ({
                        text: meta.text,
                        pct: row.cells[meta.code]?.pct ?? 0,
                      }));
                    if (targets.length) {
                      summaries.push({
                        row: row.label,
                        col: col.text,
                        colPct: row.cells[col.code]?.pct ?? 0,
                        targets,
                      });
                    }
                  }
                });
              });

              if (summaries.length === 0) return <div className="text-sm text-gray-700">No significant differences found.</div>;

              return (
                <div className="max-h-80 overflow-y-auto space-y-3">
                  {Object.entries(
                    summaries.reduce<Record<string, typeof summaries>>((acc, item) => {
                      acc[item.row] = acc[item.row] || [];
                      acc[item.row].push(item);
                      return acc;
                    }, {})
                  ).map(([rowLabel, items]) => (
                      <div key={rowLabel} className="space-y-1">
                      <div className="text-sm font-semibold text-gray-900">
                        {rowLabel}{bucketLabelTag}
                      </div>
                      <ul className="list-disc list-outside pl-5 space-y-1">
                        {items.map((item, idx) => {
                          const targetsText = item.targets
                            .map((t) => `${t.text} ` + `(<span class=\"text-xs italic text-blue-700\">${t.pct.toFixed(0)}%</span>)`)
                            .join(', ');
                          return (
                            <li key={`${rowLabel}-${item.col}-${idx}`} className="text-sm text-gray-900">
                              <span>{item.col}</span>{' '}
                              <span className="text-xs italic text-blue-700">
                                ({item.colPct.toFixed(0)}%)
                              </span>{' '}
                              {item.targets.length > 1 ? (
                                <>
                                  is significantly higher compared to:
                                  <ul className="list-disc list-inside mt-1 space-y-0.5">
                                    {item.targets.map((t) => (
                                      <li key={`${rowLabel}-${item.col}-${t.text}`} className="text-sm text-gray-900">
                                        {t.text}{' '}
                                        <span className="text-xs italic text-blue-700">({t.pct.toFixed(0)}%)</span>
                                      </li>
                                    ))}
                                  </ul>
                                </>
                              ) : (
                                <>
                                  is significantly higher vs{' '}
                                  <span dangerouslySetInnerHTML={{ __html: targetsText }} />
                                </>
                              )}
                            </li>
                          );
                        })}
                      </ul>
                    </div>
                  ))}
                </div>
              );
            })()
          )}
        </div>
      </div>
    )}
    </>
  );
};
