export interface ResponseOption {
  code: string;
  text: string;
}

export interface MultiSelectResponseCounts {
  counts: Record<string, number>;
  respondents: number;
}

export const buildResponseValueMap = (responseOptions: ResponseOption[]): Record<string, string> => {
  const valueToCodeMap: Record<string, string> = {};
  responseOptions.forEach((opt, idx) => {
    const code = opt.code;
    valueToCodeMap[code] = code;
    valueToCodeMap[code.toLowerCase()] = code;
    valueToCodeMap[code.toUpperCase()] = code;

    const numericMatch = code.match(/(\d+)$/);
    if (numericMatch) {
      const numericPart = numericMatch[1];
      valueToCodeMap[numericPart] = code;
      valueToCodeMap[String(parseInt(numericPart, 10))] = code;
    }

    const codeIndex = idx + 1;
    valueToCodeMap[String(codeIndex)] = code;
  });

  return valueToCodeMap;
};

const incrementCount = (
  valueStr: string,
  valueToCodeMap: Record<string, string>,
  counts: Record<string, number>
) => {
  if (valueToCodeMap.hasOwnProperty(valueStr)) {
    const matchedCode = valueToCodeMap[valueStr];
    if (counts.hasOwnProperty(matchedCode)) {
      counts[matchedCode]++;
    }
    return;
  }

  const lowerValue = valueStr.toLowerCase();
  if (valueToCodeMap.hasOwnProperty(lowerValue)) {
    const matchedCode = valueToCodeMap[lowerValue];
    if (counts.hasOwnProperty(matchedCode)) {
      counts[matchedCode]++;
    }
    return;
  }

  const upperValue = valueStr.toUpperCase();
  if (valueToCodeMap.hasOwnProperty(upperValue)) {
    const matchedCode = valueToCodeMap[upperValue];
    if (counts.hasOwnProperty(matchedCode)) {
      counts[matchedCode]++;
    }
    return;
  }

  const numericValue = parseFloat(valueStr);
  if (!isNaN(numericValue)) {
    const numericStr = String(Math.round(numericValue));
    if (valueToCodeMap.hasOwnProperty(numericStr)) {
      const matchedCode = valueToCodeMap[numericStr];
      if (counts.hasOwnProperty(matchedCode)) {
        counts[matchedCode]++;
      }
    }
  }
};

export const countRespondentsWithData = (
  variableName: string,
  getVariableDataByExpectedHeader?: (expectedHeader: string) => any
): number => {
  if (!getVariableDataByExpectedHeader) return 0;

  const variableData = getVariableDataByExpectedHeader(variableName);
  if (!variableData || !variableData.values) return 0;

  return variableData.values.filter((v: any) =>
    v !== null &&
    v !== undefined &&
    v !== '' &&
    !(typeof v === 'string' && v.trim() === '')
  ).length;
};

export const getMultiSelectResponseCounts = (
  variableName: string,
  responseOptions: ResponseOption[],
  getVariableDataByExpectedHeader?: (expectedHeader: string) => any
): MultiSelectResponseCounts => {
  const counts: Record<string, number> = {};
  responseOptions.forEach(opt => {
    counts[opt.code] = 0;
  });

  if (!getVariableDataByExpectedHeader) {
    return { counts, respondents: 0 };
  }

  const variableData = getVariableDataByExpectedHeader(variableName);
  if (!variableData || !variableData.values) {
    return { counts, respondents: 0 };
  }

  const valueToCodeMap = buildResponseValueMap(responseOptions);

  variableData.values.forEach((value: any) => {
    if (value === null || value === undefined || value === '') return;

    if (Array.isArray(value)) {
      value.forEach((item: any) => {
        if (item === null || item === undefined || item === '') return;
        const normalized = String(item).trim();
        if (!normalized) return;
        incrementCount(normalized, valueToCodeMap, counts);
      });
      return;
    }

    const valueStr = String(value).trim();
    if (!valueStr) return;

    if (valueStr.includes(',')) {
      const parts = valueStr.split(',').map(part => part.trim()).filter(part => part !== '');
      parts.forEach(part => {
        incrementCount(part, valueToCodeMap, counts);
      });
      return;
    }

    incrementCount(valueStr, valueToCodeMap, counts);
  });

  const respondents = countRespondentsWithData(variableName, getVariableDataByExpectedHeader);
  return { counts, respondents };
};

export const parseMultiSelectNotes = (notes: any): ResponseOption[] => {
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

export const countCheckedForItemColumn = (
  itemCode: string,
  getVariableDataByExpectedHeader?: (expectedHeader: string) => any,
  fallbackHeaders: string[] = []
): number => {
  if (!getVariableDataByExpectedHeader) return 0;

  const getValues = (header: string) => {
    const data = getVariableDataByExpectedHeader(header);
    if (!data || !Array.isArray(data.values) || data.values.length === 0) {
      return null;
    }
    return data.values;
  };

  let values = getValues(itemCode);
  for (const header of fallbackHeaders) {
    if (values && values.length > 0) break;
    values = getValues(header);
  }

  if (!values) return 0;

  const isChecked = (v: any) => {
    if (v === 1 || v === true) return true;
    if (v === 0 || v === false) return false;
    const s = String(v ?? '').trim().toLowerCase();
    if (!s) return false;
    if (s === '1') return true;
    if (s === '0') return false;
    if (s.includes('checked')) return true;
    if (s.includes('unchecked')) return false;
    return false;
  };

  return values.reduce((acc: number, v: any) => acc + (isChecked(v) ? 1 : 0), 0);
};
