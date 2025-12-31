import React, { useState, useRef, useEffect } from 'react';
import { XMarkIcon, PlusIcon, TrashIcon, PencilIcon, Cog6ToothIcon, ArrowDownTrayIcon } from '@heroicons/react/24/outline';
import { type BannerGroup, type BannerCut, type BannerSubGroup, type BannerCondition, type BannerConditionGroup, type BannerSumCondition } from '../types/dataTabulation';
import { API_BASE_URL } from '../config';
import ExcelJS from 'exceljs';

const BRAND_ORANGE = '#D14A2D';

// Resolve a survey variable (with codes) from an expected header name like QC7r3
function resolveCategoricalVariableForName(
  expectedName: string,
  categoricalVariables: any[]
): any | null {
  // Normalize helpers
  const addQ = (s: string) => (s.startsWith('Q') ? s : `Q${s}`);
  const stripQ = (s: string) => s.replace(/^Q/, '');

  // 1) Try exact
  const exact = categoricalVariables.find(v => v.name === expectedName);
  if (exact) return exact;

  // 2) Try toggling leading Q on the full expected name
  const withQ = addQ(expectedName);
  const withoutQ = stripQ(expectedName);
  const exactWithQ = categoricalVariables.find(v => v.name === withQ);
  if (exactWithQ) return exactWithQ;
  const exactWithoutQ = categoricalVariables.find(v => v.name === withoutQ);
  if (exactWithoutQ) return exactWithoutQ;

  // 3) Extract base like QC7/C7 from QC7r3, C7r3, QC7r3c1, etc.
  const match = expectedName.match(/^Q?([A-Za-z]*\d+)/);
  if (match) {
    const baseNoQ = match[1]; // letter+digits without Q
    const baseCandidates = [baseNoQ, addQ(baseNoQ)];
    for (const cand of baseCandidates) {
      const byBase = categoricalVariables.find(v => v.name === cand);
      if (byBase) return byBase;
    }
  }
  return null;
}

interface BannerBuilderProps {
  variables: any[];
  onSave: (group: BannerGroup) => void;
  onChange?: (group: BannerGroup) => void;
  onCancel: () => void;
  editingGroup?: BannerGroup | null;
  existingBannerCount?: number;
  rawData?: { rows: any[]; columns: string[] } | null;
  columnMapping?: Record<string, string>;
  settingsOpenRef?: React.MutableRefObject<(() => void) | null>;
  questionnaireId?: string;
  expectedHeaders?: string[];
  variableTableSelections?: Record<string, Set<string>>;
  getTablesForVariable?: (variable: any) => string[];
  projectName?: string;
}

interface PopupProps {
  onClose: () => void;
  anchorRef: React.RefObject<HTMLButtonElement>;
  children: React.ReactNode;
  minWidth?: string;
}

const Popup: React.FC<PopupProps> = ({ onClose, anchorRef, children, minWidth = '250px' }) => {
  const popupRef = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState({ top: 0, left: 0 });

  useEffect(() => {
    if (anchorRef.current) {
      const rect = anchorRef.current.getBoundingClientRect();
      setPosition({
        top: rect.bottom + window.scrollY + 4,
        left: rect.left + window.scrollX
      });
    }
  }, [anchorRef]);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (popupRef.current && !popupRef.current.contains(e.target as Node) &&
          anchorRef.current && !anchorRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [onClose, anchorRef]);

  return (
    <div
      ref={popupRef}
      className="fixed z-50 bg-white border border-gray-200 rounded-lg shadow-lg p-3 max-h-80 overflow-y-auto"
      style={{ top: position.top, left: position.left, minWidth, maxWidth: '500px' }}
    >
      {children}
    </div>
  );
};

interface VariableSelectorPopupProps {
  variables: any[]; // may be raw column objects { name: string } or full variable objects
  selectedVariable: string;
  onSelect: (variableName: string) => void;
  onClose: () => void;
  anchorRef: React.RefObject<HTMLButtonElement>;
}

const VariableSelectorPopup: React.FC<VariableSelectorPopupProps> = ({ variables, selectedVariable, onSelect, onClose, anchorRef }) => {
  const [search, setSearch] = useState('');
  const popupRef = useRef<HTMLDivElement>(null);

  const filteredVariables = variables.filter(v => {
    const name = String(v.name || '').toLowerCase();
    const desc = String(v.description || '').toLowerCase();
    const q = search.toLowerCase();
    return name.includes(q) || (!!desc && desc.includes(q));
  });

  // Handle click outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (popupRef.current && !popupRef.current.contains(e.target as Node) &&
          anchorRef.current && !anchorRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [onClose, anchorRef]);

  return (
    <>
      {/* Backdrop */}
      <div className="fixed inset-0 bg-black/20 z-40" onClick={onClose} />
      {/* Centered Modal */}
      <div
        ref={popupRef}
        className="fixed z-50 bg-white border border-gray-200 rounded-lg shadow-xl p-4"
        style={{
          top: '50%',
          left: '50%',
          transform: 'translate(-50%, -50%)',
          width: '500px',
          maxWidth: '90vw',
          maxHeight: '80vh'
        }}
      >
        <div className="flex items-center gap-2 mb-3">
          <input
            type="text"
            placeholder="Search columns..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="flex-1 px-3 py-2 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-[#D14A2D] focus:border-[#D14A2D]"
            autoFocus
          />
          <button
            onClick={onClose}
            className="p-1.5 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg transition-colors"
            title="Close"
          >
            <XMarkIcon className="h-5 w-5" />
          </button>
        </div>
        <div className="space-y-1 max-h-96 overflow-y-auto">
          {filteredVariables.map((v, idx) => (
            <button
              key={`${v.name}-${idx}`}
              onClick={() => {
                onSelect(v.name);
                onClose();
              }}
              className={`w-full text-left px-3 py-2.5 text-sm rounded-lg transition-colors ${
                selectedVariable === v.name
                  ? 'bg-orange-100 text-orange-800'
                  : 'hover:bg-gray-100 text-gray-700'
              }`}
            >
              <div className="flex flex-col">
                <span className="font-medium">{v.name}</span>
                {v._cellLabel && (
                  <span className="text-gray-500 ml-1">{v._cellLabel}</span>
                )}
                {v.description && (
                  <span className="text-gray-500 text-xs leading-tight mt-0.5 line-clamp-1">
                    {v.description}
                  </span>
                )}
              </div>
            </button>
          ))}
          {filteredVariables.length === 0 && (
            <div className="text-sm text-gray-400 italic py-4 text-center">No variables found</div>
          )}
        </div>
      </div>
    </>
  );
};

interface CodeSelectorPopupProps {
  variable: any;
  selectedCodes: string[];
  onCodesChange: (codes: string[]) => void;
  onClose: () => void;
  anchorRef: React.RefObject<HTMLButtonElement>;
}

const CodeSelectorPopup: React.FC<CodeSelectorPopupProps> = ({ variable, selectedCodes, onCodesChange, onClose, anchorRef }) => {
  // Fallback: if no codes available for the variable (e.g., raw data column), allow free-form entry
  if (!variable || !variable.codes || Object.keys(variable.codes).length === 0) {
    let inputValue = selectedCodes.join(', ');
    return (
      <Popup onClose={onClose} anchorRef={anchorRef}>
        <div className="space-y-2">
          <label className="block text-xs font-medium text-gray-600">Codes (comma-separated)</label>
          <input
            type="text"
            defaultValue={inputValue}
            onChange={(e) => { inputValue = e.target.value; }}
            placeholder="e.g., 1,2,3 or r1,r2"
            className="w-full px-3 py-1.5 text-sm border border-gray-300 rounded"
          />
          <div className="text-xs text-gray-500">Enter exact values as they appear in the data.</div>
        </div>
        <div className="mt-3 pt-2 border-t border-gray-200 flex justify-end">
          <button
            onClick={() => {
              const codes = inputValue.split(',').map(s => s.trim()).filter(Boolean);
              onCodesChange(codes);
              onClose();
            }}
            className="px-3 py-1 text-xs text-white rounded hover:opacity-90"
            style={{ backgroundColor: BRAND_ORANGE }}
          >
            Apply
          </button>
        </div>
      </Popup>
    );
  }

  // Helpers for normalization within this popup
  const getCanonicalKey = (raw: string): string => {
    const keys = Object.keys(variable.codes || {});
    const preferCPrefix = keys.every(k => /^c\d+$/i.test(k));
    // Exact match
    const exact = keys.find(k => k.toLowerCase() === String(raw).toLowerCase());
    if (exact) return exact;
    // Numeric mapping
    const num = String(raw).replace(/^c/i, '');
    if (/^\d+$/.test(num)) {
      const cand = preferCPrefix ? `c${num}` : num;
      const found = keys.find(k => k.toLowerCase() === cand.toLowerCase());
      if (found) return found;
    }
    return String(raw);
  };
  const hasEquivalentCode = (codes: string[], key: string): boolean => {
    const keyLower = key.toLowerCase();
    const keyNum = keyLower.replace(/^c/i, '');
    return codes.some(c => {
      const s = String(c).toLowerCase();
      if (s === keyLower) return true;
      const sNum = s.replace(/^c/i, '');
      return sNum === keyNum;
    });
  };
  const normalizeAndDedup = (codes: string[]): string[] => {
    const mapped = (codes || []).map(getCanonicalKey);
    const seen = new Set<string>();
    const dedup: string[] = [];
    mapped.forEach(m => {
      const key = m.toLowerCase();
      if (!seen.has(key)) {
        seen.add(key);
        dedup.push(m);
      }
    });
    return dedup;
  };

  return (
    <Popup onClose={onClose} anchorRef={anchorRef}>
      <div className="flex flex-wrap gap-2">
        {Object.entries(variable.codes || {}).map(([code, label]: [string, any]) => (
          <label
            key={code}
            className={`inline-flex items-center gap-1 px-2 py-1 text-xs rounded border cursor-pointer transition-colors ${
              hasEquivalentCode(selectedCodes, code)
                ? 'bg-orange-100 border-orange-300 text-orange-800'
                : 'bg-gray-50 border-gray-200 text-gray-600 hover:bg-gray-100'
            }`}
          >
            <input
              type="checkbox"
              checked={hasEquivalentCode(selectedCodes, code)}
              onChange={(e) => {
                if (e.target.checked) {
                  const normalized = normalizeAndDedup([...selectedCodes, code]);
                  onCodesChange(normalized);
                } else {
                  const codeNum = code.replace(/^c/i, '').toLowerCase();
                  const filtered = selectedCodes.filter(c => {
                    const s = String(c).toLowerCase();
                    if (s === code.toLowerCase()) return false;
                    const sNum = s.replace(/^c/i, '');
                    return sNum !== codeNum;
                  });
                  const normalized = normalizeAndDedup(filtered);
                  onCodesChange(normalized);
                }
              }}
              className="sr-only"
            />
            <span>{code}: {String(label).substring(0, 25)}{String(label).length > 25 ? '...' : ''}</span>
          </label>
        ))}
      </div>
      <div className="mt-3 pt-2 border-t border-gray-200 flex justify-end">
        <button
          onClick={onClose}
          className="px-3 py-1 text-xs text-white rounded hover:opacity-90"
          style={{ backgroundColor: BRAND_ORANGE }}
        >
          Done
        </button>
      </div>
    </Popup>
  );
};

interface NumericConditionPopupProps {
  variableName: string;
  currentCondition: string;
  onConditionChange: (condition: string) => void;
  onClose: () => void;
  anchorRef: React.RefObject<HTMLButtonElement>;
}

const NumericConditionPopup: React.FC<NumericConditionPopupProps> = ({ variableName, currentCondition, onConditionChange, onClose, anchorRef }) => {
  // Parse existing condition
  const parseCondition = (cond: string): { operator: string; value: string; value2: string } => {
    if (!cond) return { operator: '>=', value: '', value2: '' };

    // Check for "between" format: "10-50" or "10 AND 50"
    const betweenMatch = cond.match(/^(\d+(?:\.\d+)?)\s*(?:-|AND)\s*(\d+(?:\.\d+)?)$/i);
    if (betweenMatch) {
      return { operator: 'between', value: betweenMatch[1], value2: betweenMatch[2] };
    }

    // Check for standard operators: >=50, <=50, >50, <50, =50
    const opMatch = cond.match(/^(>=|<=|>|<|=)\s*(\d+(?:\.\d+)?)$/);
    if (opMatch) {
      return { operator: opMatch[1], value: opMatch[2], value2: '' };
    }

    return { operator: '>=', value: cond.replace(/[^0-9.]/g, ''), value2: '' };
  };

  const parsed = parseCondition(currentCondition);
  const [operator, setOperator] = useState(parsed.operator);
  const [value, setValue] = useState(parsed.value);
  const [value2, setValue2] = useState(parsed.value2);

  const handleApply = () => {
    if (!value) {
      onConditionChange('');
      onClose();
      return;
    }

    let condition = '';
    if (operator === 'between') {
      if (value && value2) {
        condition = `${value}-${value2}`;
      }
    } else {
      condition = `${operator}${value}`;
    }

    onConditionChange(condition);
    onClose();
  };

  return (
    <Popup onClose={onClose} anchorRef={anchorRef} minWidth="280px">
      <div className="space-y-3">
        <div className="text-xs font-medium text-gray-700 mb-2">
          Define condition for {variableName}
        </div>
        <div className="flex items-center gap-2">
          <select
            value={operator}
            onChange={(e) => setOperator(e.target.value)}
            className="px-2 py-1.5 text-sm border border-gray-300 rounded focus:ring-2 focus:ring-[#D14A2D] focus:border-[#D14A2D]"
          >
            <option value=">=">≥ (greater or equal)</option>
            <option value="<=">≤ (less or equal)</option>
            <option value=">">{'>'} (greater than)</option>
            <option value="<">{'<'} (less than)</option>
            <option value="=">=  (equal to)</option>
            <option value="between">Between</option>
          </select>
        </div>
        <div className="flex items-center gap-2">
          <input
            type="number"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder={operator === 'between' ? 'Min' : 'Value'}
            className="flex-1 px-2 py-1.5 text-sm border border-gray-300 rounded focus:ring-2 focus:ring-[#D14A2D] focus:border-[#D14A2D]"
          />
          {operator === 'between' && (
            <>
              <span className="text-gray-500 text-sm">to</span>
              <input
                type="number"
                value={value2}
                onChange={(e) => setValue2(e.target.value)}
                placeholder="Max"
                className="flex-1 px-2 py-1.5 text-sm border border-gray-300 rounded focus:ring-2 focus:ring-[#D14A2D] focus:border-[#D14A2D]"
              />
            </>
          )}
        </div>
        <div className="text-xs text-gray-500">
          Preview: <span className="font-mono">{variableName}{operator === 'between' ? ` ${value || '?'} to ${value2 || '?'}` : `${operator}${value || '?'}`}</span>
        </div>
      </div>
      <div className="mt-3 pt-2 border-t border-gray-200 flex justify-end gap-2">
        <button
          onClick={onClose}
          className="px-3 py-1 text-xs text-gray-600 hover:bg-gray-100 rounded"
        >
          Cancel
        </button>
        <button
          onClick={handleApply}
          className="px-3 py-1 text-xs text-white rounded hover:opacity-90"
          style={{ backgroundColor: BRAND_ORANGE }}
        >
          Apply
        </button>
      </div>
    </Popup>
  );
};

// Component for editing cut conditions with AND/OR/SUM support
interface CutConditionsEditorProps {
  cut: BannerCut;
  subGroupId: string;
  selectableVariables: any[];
  categoricalVariables: any[];
  isNumericVariable: (varName: string) => boolean;
  updateCut: (subGroupId: string, cutId: string, updates: Partial<BannerCut>) => void;
  openVariableSelector: { subGroupId: string; cutId: string; conditionIndex?: number } | null;
  setOpenVariableSelector: (value: { subGroupId: string; cutId: string; conditionIndex?: number } | null) => void;
  openCodeSelector: { subGroupId: string; cutId: string; conditionIndex?: number } | null;
  setOpenCodeSelector: (value: { subGroupId: string; cutId: string; conditionIndex?: number } | null) => void;
  getButtonRef: (refs: React.MutableRefObject<Record<string, React.RefObject<HTMLButtonElement>>>, subGroupId: string, cutId: string, suffix?: string) => React.RefObject<HTMLButtonElement>;
  codeButtonRefs: React.MutableRefObject<Record<string, React.RefObject<HTMLButtonElement>>>;
  variableButtonRefs: React.MutableRefObject<Record<string, React.RefObject<HTMLButtonElement>>>;
  rawData?: { rows: any[]; columns: string[] } | null;
  columnMapping?: Record<string, string> | undefined;
}

// Configuration Modal Component
interface ConditionsConfigModalProps {
  cut: BannerCut;
  subGroupId: string;
  selectableVariables: any[];
  categoricalVariables: any[];
  isNumericVariable: (varName: string) => boolean;
  updateCut: (subGroupId: string, cutId: string, updates: Partial<BannerCut>) => void;
  onClose: () => void;
  rawData?: { rows: any[]; columns: string[] } | null;
  columnMapping?: Record<string, string> | undefined;
}

const ConditionsConfigModal: React.FC<ConditionsConfigModalProps> = ({
  cut,
  subGroupId,
  selectableVariables,
  categoricalVariables,
  isNumericVariable,
  updateCut,
  onClose,
  rawData,
  columnMapping
}) => {
  // Debug: log variables only once when modal opens
  React.useEffect(() => {
    console.log('📋 ConditionsConfigModal opened with', selectableVariables.length, 'variables');
    const numericVars = selectableVariables.filter(v => v.type?.toLowerCase().includes('numeric'));
    console.log('📋 Numeric variables (all types):', numericVars.map(v => ({ name: v.name, type: v.type, hasCodes: !!v.codes && Object.keys(v.codes).length > 0 })));
    const numericGridCols = selectableVariables.filter(v => v._originalVariable);
    console.log('📋 Numeric grid columns available:', numericGridCols.map(v => v.name));
  }, []);

  const [localConditions, setLocalConditions] = React.useState<BannerCondition[]>(() => {
    if (cut.conditionGroups && cut.conditionGroups.length > 0) {
      return cut.conditionGroups.flatMap(g => g.conditions);
    }
    if (cut.variableName) {
      return [{ id: '0', variableName: cut.variableName, codes: cut.codes }];
    }
    // Automatically add first condition if none exist
    return [{ id: Date.now().toString(), variableName: '', codes: [] }];
  });
  // Track operators between conditions (for N conditions, there are N-1 operators)
  const [localOperators, setLocalOperators] = React.useState<('OR' | 'AND')[]>(() => {
    if (cut.conditionGroups && cut.conditionGroups.length > 0 && cut.conditionGroups[0].conditions.length > 1) {
      const operator = cut.conditionGroups[0].operator;
      const count = cut.conditionGroups[0].conditions.length - 1;
      return Array(count).fill(operator);
    }
    // If we auto-added a condition, no operators needed yet (only 1 condition)
    return [];
  });
  const [showVariableSelector, setShowVariableSelector] = React.useState<number | null>(null);

  // Normalize any existing codes to canonical keys on mount (prevents duplicate numeric vs c-prefixed)
  React.useEffect(() => {
    setLocalConditions(prev => {
      let changed = false;
      const next = prev.map(c => {
        const surveyVar =
          categoricalVariables.find(v => v.name === c.variableName) ||
          resolveCategoricalVariableForName(c.variableName, categoricalVariables);
        if (surveyVar && surveyVar.codes && Array.isArray(c.codes)) {
          const normalized = normalizeCodesForSurveyVar(c.codes, surveyVar);
          const same =
            normalized.length === c.codes.length &&
            normalized.every((v, i) => String(v).toLowerCase() === String(c.codes[i]).toLowerCase());
          if (!same) {
            changed = true;
            return { ...c, codes: normalized };
          }
        }
        return c;
      });
      return changed ? next : prev;
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Helpers: data matching and previews
  const valueMatchesCode = (raw: any, code: string): boolean => {
    if (raw === null || raw === undefined || raw === '') return false;
    const s = String(raw).trim();
    const n = Number(s);
    if (s === code) return true;
    const codeNoC = code.replace(/^c/i, '');
    if (s === codeNoC) return true;
    if (!isNaN(n) && String(n) === codeNoC) return true;
    return false;
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
  const getRecognizedSummary = (varName: string, codes: string[]): { count: number; examples: string[] } => {
    const header = getColumnHeader(varName, columnMapping) || (rawData?.columns?.includes(varName) ? varName : null);
    if (!rawData || !rawData.rows || !header) return { count: 0, examples: [] };
    const examples: string[] = [];
    let count = 0;
    const seen = new Set<string>();
    const maxScan = 3000;
    const maxExamples = 6;
    for (let i = 0; i < rawData.rows.length && i < maxScan; i++) {
      const v = rawData.rows[i]?.[header];
      if (codes.some(c => valueMatchesCode(v, c))) {
        count++;
        const s = String(v);
        if (!seen.has(s) && examples.length < maxExamples) {
          seen.add(s);
          examples.push(s);
        }
      }
    }
    return { count, examples };
  };
  const formatCodesForDisplay = (codes: string[]): string => {
    // Show numeric part for c-prefixed codes; deduplicate on display
    const nums = codes.map(c => {
      const m = c.match(/^c(\d+)$/i);
      return m ? m[1] : c;
    });
    const seen = new Set<string>();
    const dedup: string[] = [];
    nums.forEach(n => {
      const key = String(n).toLowerCase();
      if (!seen.has(key)) {
        seen.add(key);
        dedup.push(n);
      }
    });
    return dedup.join(', ');
  };
  // Normalize codes against a survey variable's code keys (e.g., 9 -> c9), and deduplicate
  const normalizeCodesForSurveyVar = (codes: string[], surveyVar: any): string[] => {
    if (!Array.isArray(codes) || !surveyVar || !surveyVar.codes) return codes || [];
    const keys: string[] = Object.keys(surveyVar.codes || {});
    const preferCPrefix = keys.every(k => /^c\d+$/i.test(k));
    const toCanonical = (c: string): string | null => {
      if (!c) return null;
      const raw = String(c).trim();
      // Exact key match (case-insensitive)
      const found = keys.find(k => k.toLowerCase() === raw.toLowerCase());
      if (found) return found;
      // Numeric mapping
      const num = raw.replace(/^c/i, '');
      if (/^\d+$/.test(num)) {
        const candidate = preferCPrefix ? `c${num}` : num;
        const fx = keys.find(k => k.toLowerCase() === candidate.toLowerCase());
        if (fx) return fx;
      }
      return raw;
    };
    const mapped = codes.map(toCanonical).filter(Boolean) as string[];
    const seen = new Set<string>();
    const dedup: string[] = [];
    mapped.forEach(m => {
      const key = m.toLowerCase();
      if (!seen.has(key)) {
        seen.add(key);
        dedup.push(m);
      }
    });
    return dedup;
  };
  // Check if a code is selected accounting for numeric vs c-prefixed equivalents
  const hasEquivalentCode = (selected: string[], codeKey: string): boolean => {
    const codeKeyLower = codeKey.toLowerCase();
    const codeKeyNum = codeKeyLower.replace(/^c/i, '');
    return selected.some(c => {
      const s = String(c).toLowerCase();
      if (s === codeKeyLower) return true;
      const sNum = s.replace(/^c/i, '');
      return sNum === codeKeyNum;
    });
  };

  // Check if all conditions are valid
  const allConditionsValid = React.useMemo(() => {
    if (localConditions.length === 0) return true; // Empty is valid (clears conditions)
    
    return localConditions.every(cond => {
      if (!cond.variableName) return false;
      
      const isNumeric = (() => {
        // Prefer known variable types
        if (isNumericVariable(cond.variableName)) return true;
        // If the variable name exactly matches a known categorical variable, treat as categorical
        const exactCategorical = categoricalVariables.find(v => v.name === cond.variableName);
        if (exactCategorical && exactCategorical.codes && Object.keys(exactCategorical.codes).length > 0) return false;
        // If this expected header maps to a categorical survey variable with codes, treat as categorical
        const mappedCat = resolveCategoricalVariableForName(cond.variableName, categoricalVariables);
        if (mappedCat && mappedCat.codes && Object.keys(mappedCat.codes).length > 0) return false;
        // Fallback: infer numeric by sampling rawData values if available
        if (rawData && columnMapping) {
          const colHeader = getColumnHeader(cond.variableName, columnMapping);
          if (colHeader) {
            const sampleVals = (rawData.rows || []).slice(0, 200).map(r => r[colHeader]).filter(v => v !== null && v !== undefined && v !== '');
            const numericCount = sampleVals.filter(v => !isNaN(Number(String(v).trim()))).length;
            if (sampleVals.length > 0 && numericCount / sampleVals.length >= 0.9) return true;
          }
        }
        return false;
      })();
      if (isNumeric) {
        // For numeric, need an operator selected and a value entered
        if (cond.codes.length === 0 || !cond.codes[0]) return false;
        const conditionStr = cond.codes[0];
        // Check if it's just "between" without values, or empty operator
        if (conditionStr === 'between' || conditionStr === '') return false;
        // Check if it has a value (not just an operator)
        const hasValue = /^(>=|<=|>|<|=)\s*\d/.test(conditionStr) || /^\d+-\d+/.test(conditionStr) || /^\d+-/.test(conditionStr);
        return hasValue;
      } else {
        // For categorical, need at least one code selected
        return cond.codes.length > 0;
      }
    });
  }, [localConditions, isNumericVariable, categoricalVariables, rawData, columnMapping]);

  // If a preview is visible (categorical has codes selected, or numeric shows a condition string),
  // allow saving even if stricter validation disagrees.
  const hasAnyPreview = React.useMemo(() => {
    return localConditions.some(cond => {
      if (!cond.variableName) return false;
      const isNumeric = (() => {
        if (isNumericVariable(cond.variableName)) return true;
        const exactCategorical = categoricalVariables.find(v => v.name === cond.variableName);
        if (exactCategorical && exactCategorical.codes && Object.keys(exactCategorical.codes).length > 0) return false;
        const mappedCat = resolveCategoricalVariableForName(cond.variableName, categoricalVariables);
        if (mappedCat && mappedCat.codes && Object.keys(mappedCat.codes).length > 0) return false;
        if (rawData && columnMapping) {
          const colHeader = getColumnHeader(cond.variableName, columnMapping);
          if (colHeader) {
            const sampleVals = (rawData.rows || []).slice(0, 200).map(r => r[colHeader]).filter(v => v !== null && v !== undefined && v !== '');
            const numericCount = sampleVals.filter(v => !isNaN(Number(String(v).trim()))).length;
            if (sampleVals.length > 0 && numericCount / sampleVals.length >= 0.9) return true;
          }
        }
        return false;
      })();
      if (isNumeric) {
        const c0 = cond.codes?.[0] || '';
        return !!c0 && ( /^(>=|<=|>|<|=)\s*\d/.test(c0) || /^\d+-\d+/.test(c0) || /^\d+-/.test(c0) || c0.trim().length > 0 );
      } else {
        return Array.isArray(cond.codes) && cond.codes.length > 0;
      }
    });
  }, [localConditions, isNumericVariable, categoricalVariables, rawData, columnMapping]);

  const handleSave = () => {
    if (!(allConditionsValid || hasAnyPreview)) {
      // Don't save if conditions are incomplete and no preview is visible
      return;
    }

    if (localConditions.length > 0) {
      // If all operators are the same, use that operator; otherwise use the first one
      const operator = localOperators.length > 0 && localOperators.every(op => op === localOperators[0])
        ? localOperators[0]
        : (localOperators[0] || 'OR');
      
      updateCut(subGroupId, cut.id, {
        conditionGroups: [{
          conditions: localConditions,
          operator: operator
        }],
        variableName: localConditions[0]?.variableName || '',
        codes: localConditions[0]?.codes || [],
        sumCondition: undefined
      });
    } else {
      updateCut(subGroupId, cut.id, {
        conditionGroups: undefined,
        variableName: '',
        codes: [],
        sumCondition: undefined
      });
    }
    onClose();
  };

  const addCondition = () => {
    const newCondition: BannerCondition = { id: Date.now().toString(), variableName: '', codes: [] };
    setLocalConditions([...localConditions, newCondition]);
    // Add a new operator (default to 'OR') when adding a condition
    setLocalOperators([...localOperators, 'OR']);
  };

  const removeCondition = (index: number) => {
    setLocalConditions(localConditions.filter((_, i) => i !== index));
    // Remove the corresponding operator
    if (index === 0 && localOperators.length > 0) {
      setLocalOperators(localOperators.slice(1));
    } else if (index > 0) {
      setLocalOperators(localOperators.filter((_, i) => i !== index - 1));
    }
  };

  const updateCondition = (index: number, updates: Partial<BannerCondition>) => {
    setLocalConditions(localConditions.map((c, i) => i === index ? { ...c, ...updates } : c));
  };


  // Helpers to support raw-data-backed selection when variable isn't a known categorical
  function getColumnHeader(varName: string, mapping?: Record<string, string>): string | null {
    if (!mapping) return null;
    const variations = [varName, `Q${varName}`, varName.replace(/^Q/, ''), `${varName}r1`, `Q${varName.replace(/^Q/, '')}r1`];
    for (const v of variations) {
      if (mapping[v]) return mapping[v];
      const match = Object.keys(mapping).find(k => k.toLowerCase() === v.toLowerCase());
      if (match) return mapping[match];
    }
    return null;
  }

  const getRawDistinctValues = (varName: string): string[] => {
    if (!rawData || !rawData.rows) return [];
    let header = getColumnHeader(varName, columnMapping);
    if (!header) {
      // If not in mapping, allow direct column usage if present
      if (rawData.columns && rawData.columns.includes(varName)) {
        header = varName;
      } else {
        return [];
      }
    }
    const set = new Set<string>();
    const maxToScan = 5000;
    const maxDistinct = 200;
    const rows = rawData.rows;
    for (let i = 0; i < rows.length && i < maxToScan; i++) {
      const val = rows[i]?.[header];
      if (val === null || val === undefined) continue;
      const s = String(val).trim();
      if (s.length === 0) continue;
      set.add(s);
      if (set.size >= maxDistinct) break;
    }
    return Array.from(set).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  };

  // (moved to module scope) resolveCategoricalVariableForName
  return (
    <div
      className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-lg shadow-xl w-full max-w-2xl mx-4 max-h-[80vh] overflow-hidden flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="p-4 border-b border-gray-200">
          <div className="flex items-center justify-between mb-2">
            <div>
              <h3 className="text-lg font-semibold text-gray-900">Configure Conditions</h3>
              <p className="text-xs text-gray-600 mt-1">
                {(() => {
                  const c: any = cut as any;
                  if (c.definitionText) return String(c.definitionText);
                  if (c.sumCondition && c.sumCondition.variables && c.sumCondition.variables.length > 0) {
                    return `SUM(${c.sumCondition.variables.join(', ')}) ${c.sumCondition.condition || ''}`;
                  }
                  if (c.conditionGroups && Array.isArray(c.conditionGroups) && c.conditionGroups.length > 0) {
                    const group = c.conditionGroups[0];
                    const op = group.operator || 'OR';
                    const conds = (group.conditions || []).map((cond: any) => {
                      const codes = Array.isArray(cond.codes) ? cond.codes.join(', ') : '';
                      return `${cond.variableName}${codes ? '=' + codes : ''}`;
                    }).join(` ${op} `);
                    return conds || '';
                  }
                  if (c.variableName) {
                    const codes = Array.isArray(c.codes) ? c.codes.join(', ') : '';
                    return `${c.variableName}${codes ? '=' + codes : ''}`;
                  }
                  return '';
                })()}
              </p>
            </div>
            <button
              onClick={onClose}
              className="text-gray-400 hover:text-gray-600 transition-colors"
            >
              <XMarkIcon className="h-6 w-6" />
            </button>
          </div>
          {localConditions.length > 0 && localConditions.some(c => c.variableName && c.codes.length > 0) && (
            <div className="text-sm text-gray-600 font-mono mt-2">
              {localConditions
                .filter(c => c.variableName && c.codes.length > 0)
                .map((cond, idx) => {
                  const isNumeric = isNumericVariable(cond.variableName);
                  const variable = categoricalVariables.find(v => v.name === cond.variableName);
                  let conditionText = '';
                  
                  if (isNumeric && cond.codes.length > 0) {
                    conditionText = `${cond.variableName}${cond.codes[0]}`;
                  } else if (variable && cond.codes.length > 0) {
                    // Remove 'c' prefix from codes for display
                    const displayCodes = cond.codes.map(code => code.replace(/^c/i, ''));
                    conditionText = `${cond.variableName} = ${displayCodes.join(', ')}`;
                  } else {
                    conditionText = cond.variableName || '';
                  }
                  
                  return (
                    <React.Fragment key={cond.id || idx}>
                      {idx > 0 && (
                        <span className="mx-2 font-semibold" style={{ color: localOperators[idx - 1] === 'OR' ? '#B45309' : '#1D4ED8' }}>
                          {localOperators[idx - 1] || 'OR'}
                        </span>
                      )}
                      <span>{conditionText}</span>
                    </React.Fragment>
                  );
                })}
            </div>
          )}
        </div>

        <div className="flex-1 overflow-y-auto p-6 space-y-4">
              {localConditions.map((cond, idx) => {
                const isNumeric = isNumericVariable(cond.variableName);
                const variable = categoricalVariables.find(v => v.name === cond.variableName);

                return (
                  <React.Fragment key={cond.id || idx}>
                    <div className="p-4 bg-gray-50 rounded-lg border border-gray-200 space-y-3">
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-semibold text-gray-700">Condition {idx + 1}</span>
                      {localConditions.length > 1 && (
                        <button
                          onClick={() => removeCondition(idx)}
                          className="p-1 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded transition-colors"
                        >
                          <TrashIcon className="h-4 w-4" />
                        </button>
                      )}
                    </div>

                    {/* Variable Selection */}
                    <div>
                      <label className="block text-xs font-medium text-gray-600 mb-1">Variable:</label>
                      <button
                        onClick={() => setShowVariableSelector(idx)}
                        className="w-full px-3 py-2 text-left text-sm border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors"
                      >
                        {cond.variableName || 'Select variable...'}
                      </button>
                      {showVariableSelector === idx && (
                        <VariableSelectorPopup
                          variables={selectableVariables}
                          selectedVariable={cond.variableName}
                          onSelect={(varName) => {
                            updateCondition(idx, { variableName: varName, codes: [] });
                            setShowVariableSelector(null);
                          }}
                          onClose={() => setShowVariableSelector(null)}
                          anchorRef={{ current: null } as React.RefObject<HTMLButtonElement>}
                        />
                      )}
                    </div>

                    {/* Code/Condition Selection */}
                    {cond.variableName && (
                      <div>
                        <label className="block text-xs font-medium text-gray-600 mb-1">
                          {isNumeric ? 'Condition:' : 'Codes:'}
                        </label>
                        {isNumeric ? (() => {
                          const currentCondition = cond.codes[0] || '';
                          const parseCondition = (condStr: string) => {
                            if (!condStr) return { operator: '', value: '', value2: '' };
                            // Check for between format with both values: "5-100" or "5 AND 100"
                            const betweenMatch = condStr.match(/^(\d+(?:\.\d+)?)\s*(?:-|AND)\s*(\d+(?:\.\d+)?)$/i);
                            if (betweenMatch) {
                              return { operator: 'between', value: betweenMatch[1], value2: betweenMatch[2] };
                            }
                            // Check for between format with only min value: "5-" (user is typing)
                            const betweenPartialMatch = condStr.match(/^(\d+(?:\.\d+)?)\s*-\s*$/);
                            if (betweenPartialMatch) {
                              return { operator: 'between', value: betweenPartialMatch[1], value2: '' };
                            }
                            // Check if it's just the word "between"
                            if (condStr === 'between') {
                              return { operator: 'between', value: '', value2: '' };
                            }
                            // Check for operator with value
                            const opMatch = condStr.match(/^(>=|<=|>|<|=)\s*(\d+(?:\.\d+)?)$/);
                            if (opMatch) {
                              return { operator: opMatch[1], value: opMatch[2], value2: '' };
                            }
                            // Check if it's just an operator (no value yet)
                            if (/^(>=|<=|>|<|=)$/.test(condStr)) {
                              return { operator: condStr as '>=' | '<=' | '>' | '<' | '=', value: '', value2: '' };
                            }
                            return { operator: '', value: '', value2: '' };
                          };
                          const parsed = parseCondition(currentCondition);
                          const isBetween = parsed.operator === 'between';
                          
                          return (
                            <div className="space-y-2">
                              <div className="flex items-center gap-2">
                                <select
                                  value={parsed.operator}
                                  onChange={(e) => {
                                    const newOp = e.target.value;
                                    if (!newOp) {
                                      updateCondition(idx, { codes: [] });
                                      return;
                                    }
                                    let newCondition = '';
                                    if (newOp === 'between') {
                                      // When switching to between, preserve existing value as min if it exists
                                      newCondition = parsed.value && parsed.value2 
                                        ? `${parsed.value}-${parsed.value2}`
                                        : (parsed.value ? `${parsed.value}-` : 'between');
                                    } else {
                                      // When switching to a single operator, preserve the value or just set the operator
                                      newCondition = parsed.value ? `${newOp}${parsed.value}` : newOp;
                                    }
                                    updateCondition(idx, { codes: [newCondition] });
                                  }}
                                  className="px-2 py-1.5 text-sm border border-gray-300 rounded focus:ring-2 focus:ring-[#D14A2D] focus:border-[#D14A2D]"
                                >
                                  <option value="">Select operator...</option>
                                  <option value=">=">≥ (greater or equal)</option>
                                  <option value="<=">≤ (less or equal)</option>
                                  <option value=">">{'>'} (greater than)</option>
                                  <option value="<">{'<'} (less than)</option>
                                  <option value="=">=  (equal to)</option>
                                  <option value="between">Between</option>
                                </select>
                                <input
                                  type="number"
                                  value={parsed.value}
                                  onChange={(e) => {
                                    if (!parsed.operator) {
                                      // If no operator selected, don't update
                                      return;
                                    }
                                    let newCondition = '';
                                    if (isBetween) {
                                      newCondition = e.target.value && parsed.value2 
                                        ? `${e.target.value}-${parsed.value2}`
                                        : (e.target.value ? `${e.target.value}-` : '');
                                    } else {
                                      newCondition = e.target.value ? `${parsed.operator}${e.target.value}` : parsed.operator;
                                    }
                                    updateCondition(idx, { codes: newCondition ? [newCondition] : [] });
                                  }}
                                  placeholder={isBetween ? 'Min' : 'Value'}
                                  disabled={!parsed.operator}
                                  className="flex-1 px-2 py-1.5 text-sm border border-gray-300 rounded focus:ring-2 focus:ring-[#D14A2D] focus:border-[#D14A2D] disabled:bg-gray-100 disabled:cursor-not-allowed"
                                />
                                {isBetween && (
                                  <>
                                    <span className="text-gray-500 text-sm">to</span>
                                    <input
                                      type="number"
                                      value={parsed.value2}
                                      onChange={(e) => {
                                        const newCondition = parsed.value && e.target.value 
                                          ? `${parsed.value}-${e.target.value}`
                                          : (parsed.value ? `${parsed.value}-` : '');
                                        updateCondition(idx, { codes: newCondition ? [newCondition] : [] });
                                      }}
                                      placeholder="Max"
                                      disabled={!parsed.operator}
                                      className="flex-1 px-2 py-1.5 text-sm border border-gray-300 rounded focus:ring-2 focus:ring-[#D14A2D] focus:border-[#D14A2D] disabled:bg-gray-100 disabled:cursor-not-allowed"
                                    />
                                  </>
                                )}
                              </div>
                              {currentCondition && (
                                <div className="text-xs text-gray-500 font-mono">
                                  Preview: {cond.variableName} {currentCondition}
                                </div>
                              )}
                            </div>
                          );
                        })() : variable ? (
                          <div className="space-y-2">
                            <div className="space-y-1 max-h-48 overflow-y-auto p-2 border border-gray-200 rounded-lg bg-white">
                              {Object.entries(variable.codes || {}).map(([code, label]) => (
                                <label
                                  key={code}
                                  className={`flex items-center gap-2 px-2.5 py-1.5 text-xs rounded border cursor-pointer transition-colors ${
                                    hasEquivalentCode(cond.codes, code)
                                      ? 'bg-orange-100 border-orange-300 text-orange-800'
                                      : 'bg-gray-50 border-gray-200 text-gray-600 hover:bg-gray-100'
                                  }`}
                                >
                                  <input
                                    type="checkbox"
                                    checked={hasEquivalentCode(cond.codes, code)}
                                    onChange={(e) => {
                                      if (e.target.checked) {
                                        const normalized = normalizeCodesForSurveyVar([...cond.codes, code], { codes: variable.codes });
                                        updateCondition(idx, { codes: normalized });
                                      } else {
                                        const codeNum = code.replace(/^c/i, '').toLowerCase();
                                        const filtered = cond.codes.filter(c => {
                                          const s = String(c).toLowerCase();
                                          if (s === code.toLowerCase()) return false;
                                          const sNum = s.replace(/^c/i, '');
                                          return sNum !== codeNum;
                                        });
                                        const normalized = normalizeCodesForSurveyVar(filtered, { codes: variable.codes });
                                        updateCondition(idx, { codes: normalized });
                                      }
                                    }}
                                    className="rounded border-gray-300 text-[#D14A2D] focus:ring-[#D14A2D]"
                                  />
                                  <span className="font-medium">{code}:</span>
                                  <span>{String(label)}</span>
                                </label>
                              ))}
                            </div>
                            {cond.codes.length > 0 && (
                              <div className="text-xs text-gray-500 font-mono">
                                {(() => {
                                  const normalized = normalizeCodesForSurveyVar(cond.codes, { codes: variable.codes });
                                  return <>Preview: {cond.variableName} = {formatCodesForDisplay(normalized)}</>;
                                })()}
                              </div>
                            )}
                          </div>
                        ) : (
                          // Fallback for raw data columns without predefined codes:
                          // 1) Try to resolve to a survey variable with codes (e.g., QC7r3 -> QC7)
                          // 2) Else offer suggested distinct values + free-form add
                          (() => {
                            const surveyVar = resolveCategoricalVariableForName(cond.variableName, categoricalVariables);
                            if (surveyVar && surveyVar.codes && Object.keys(surveyVar.codes).length > 0) {
                              return (
                                <div className="space-y-2">
                                  <div className="space-y-1 max-h-48 overflow-y-auto p-2 border border-gray-200 rounded-lg bg-white">
                                    {Object.entries(surveyVar.codes || {}).map(([code, label]: [string, any]) => (
                                      <label
                                        key={code}
                                        className={`flex items-center gap-2 px-2.5 py-1.5 text-xs rounded border cursor-pointer transition-colors ${
                                          hasEquivalentCode(cond.codes, code)
                                            ? 'bg-orange-100 border-orange-300 text-orange-800'
                                            : 'bg-gray-50 border-gray-200 text-gray-600 hover:bg-gray-100'
                                        }`}
                                      >
                                        <input
                                          type="checkbox"
                                          checked={hasEquivalentCode(cond.codes, code)}
                                          onChange={(e) => {
                                            if (e.target.checked) {
                                              const normalized = normalizeCodesForSurveyVar([...cond.codes, code], surveyVar);
                                              updateCondition(idx, { codes: normalized });
                                            } else {
                                              // Remove both canonical and numeric equivalents
                                              const codeNum = code.replace(/^c/i, '').toLowerCase();
                                              const filtered = cond.codes.filter(c => {
                                                const s = String(c).toLowerCase();
                                                if (s === code.toLowerCase()) return false;
                                                const sNum = s.replace(/^c/i, '');
                                                return sNum !== codeNum;
                                              });
                                              const normalized = normalizeCodesForSurveyVar(filtered, surveyVar);
                                              updateCondition(idx, { codes: normalized });
                                            }
                                          }}
                                          className="rounded border-gray-300 text-[#D14A2D] focus:ring-[#D14A2D]"
                                        />
                                        <span className="font-medium">{code}:</span>
                                        <span>{String(label)}</span>
                                      </label>
                                    ))}
                                  </div>
                                  {cond.codes.length > 0 && (
                                    <>
                                      <div className="text-xs text-gray-500 font-mono">
                                        {(() => {
                                          const normalized = normalizeCodesForSurveyVar(cond.codes, surveyVar);
                                          return <>Preview: {cond.variableName} = {formatCodesForDisplay(normalized)}</>;
                                        })()}
                                      </div>
                                    </>
                                  )}
                                </div>
                              );
                            }
                            // Distinct values fallback
                            return (
                              <div className="space-y-2">
                                <div className="space-y-1 max-h-48 overflow-y-auto p-2 border border-gray-200 rounded-lg bg-white">
                                  {(() => {
                                    const values = getRawDistinctValues(cond.variableName);
                                    if (values.length === 0) {
                                      return <div className="text-xs text-gray-400 italic py-2">No sample values found for this column.</div>;
                                    }
                                    return values.map((val) => (
                                      <label
                                        key={val}
                                        className={`flex items-center gap-2 px-2.5 py-1.5 text-xs rounded border cursor-pointer transition-colors ${
                                          cond.codes.includes(val)
                                            ? 'bg-orange-100 border-orange-300 text-orange-800'
                                            : 'bg-gray-50 border-gray-200 text-gray-600 hover:bg-gray-100'
                                        }`}
                                      >
                                        <input
                                          type="checkbox"
                                          checked={cond.codes.includes(val)}
                                          onChange={(e) => {
                                            const newCodes = e.target.checked
                                              ? [...cond.codes, val]
                                              : cond.codes.filter(c => c !== val);
                                            updateCondition(idx, { codes: newCodes });
                                          }}
                                          className="rounded border-gray-300 text-[#D14A2D] focus:ring-[#D14A2D]"
                                        />
                                        <span className="font-medium">{val}</span>
                                      </label>
                                    ));
                                  })()}
                                </div>
                                {/* Definition + recognition preview */}
                                {cond.codes.length > 0 && (
                                  <>
                                    <div className="text-xs text-gray-500 font-mono">
                                      Preview: {cond.variableName} = {formatCodesForDisplay(cond.codes)}
                                    </div>
                                  </>
                                )}
                              </div>
                            );
                          })()
                        )}
                      </div>
                    )}
                    </div>
                    {idx < localConditions.length - 1 && (
                      <div className="flex justify-center py-1">
                        <button
                          onClick={() => {
                            const newOperators = [...localOperators];
                            newOperators[idx] = newOperators[idx] === 'OR' ? 'AND' : 'OR';
                            setLocalOperators(newOperators);
                          }}
                          className="px-4 py-1.5 text-xs font-medium rounded-lg transition-colors"
                          style={{
                            backgroundColor: localOperators[idx] === 'OR' ? '#FEF3C7' : '#DBEAFE',
                            color: localOperators[idx] === 'OR' ? '#B45309' : '#1D4ED8',
                            border: `1px solid ${localOperators[idx] === 'OR' ? '#F59E0B' : '#3B82F6'}`
                          }}
                        >
                          {localOperators[idx] || 'OR'}
                        </button>
                      </div>
                    )}
                  </React.Fragment>
                );
              })}

              <button
                onClick={addCondition}
                className="w-full py-2 border-2 border-dashed border-gray-300 rounded-lg text-sm text-gray-500 hover:border-[#D14A2D] hover:text-[#D14A2D] transition-colors"
              >
                + Add Condition
              </button>
        </div>

        <div className="flex items-center justify-end gap-3 p-4 border-t border-gray-200 bg-gray-50">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm text-gray-700 hover:bg-gray-200 rounded-lg"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={!(allConditionsValid || hasAnyPreview)}
            className="px-4 py-2 text-sm text-white rounded-lg transition-opacity disabled:opacity-50 disabled:cursor-not-allowed"
            style={{ backgroundColor: BRAND_ORANGE }}
            title={!(allConditionsValid || hasAnyPreview) ? "Please complete all conditions before saving" : ""}
          >
            Save
          </button>
        </div>
      </div>
    </div>
  );
};

const CutConditionsEditor: React.FC<CutConditionsEditorProps> = ({
  cut,
  subGroupId,
  selectableVariables,
  categoricalVariables,
  isNumericVariable,
  updateCut,
  openVariableSelector,
  setOpenVariableSelector,
  openCodeSelector,
  setOpenCodeSelector,
  getButtonRef,
  codeButtonRefs,
  variableButtonRefs,
  rawData,
  columnMapping
}) => {
  const [showConfigModal, setShowConfigModal] = React.useState(false);

  // Get summary of conditions
  const getConditionsSummary = () => {
    if (cut.sumCondition) {
      return `SUM(${cut.sumCondition.variables.join(', ')}) ${cut.sumCondition.condition}`;
    }
    if (cut.conditionGroups && cut.conditionGroups.length > 0) {
      const conditions = cut.conditionGroups.flatMap(g => g.conditions);
      const operator = cut.conditionGroups[0].operator;
      return conditions.map(c => `${c.variableName}=${c.codes.join(',')}`).join(` ${operator} `);
    }
    if (cut.variableName) {
      return `${cut.variableName}=${cut.codes.join(',')}`;
    }
    return null;
  };

  const summary = getConditionsSummary();

  return (
    <>
      {summary ? (
        <div className="flex items-center gap-2">
          <span className="text-xs text-gray-700 font-mono">{summary}</span>
          <button
            onClick={() => setShowConfigModal(true)}
            className="p-1 text-gray-400 hover:text-orange-600 hover:bg-orange-50 rounded transition-colors"
            title="Edit conditions"
          >
            <PencilIcon className="h-4 w-4" />
          </button>
        </div>
      ) : (
        <button
          onClick={() => setShowConfigModal(true)}
          className="px-3 py-1.5 text-xs font-medium text-white rounded-lg hover:opacity-90 transition-colors"
          style={{ backgroundColor: BRAND_ORANGE }}
        >
          Configure
        </button>
      )}

      {showConfigModal && (
        <ConditionsConfigModal
          cut={cut}
          subGroupId={subGroupId}
          selectableVariables={selectableVariables}
          categoricalVariables={categoricalVariables}
          isNumericVariable={isNumericVariable}
          updateCut={updateCut}
          onClose={() => setShowConfigModal(false)}
          rawData={rawData}
          columnMapping={columnMapping}
        />
      )}
    </>
  );
};

const OldCutConditionsEditor: React.FC<CutConditionsEditorProps> = ({
  cut,
  subGroupId,
  selectableVariables,
  categoricalVariables,
  isNumericVariable,
  updateCut,
  openVariableSelector,
  setOpenVariableSelector,
  openCodeSelector,
  setOpenCodeSelector,
  getButtonRef,
  codeButtonRefs,
  variableButtonRefs
}) => {
  // Initialize conditions from cut data
  const getConditions = (): BannerCondition[] => {
    // If we have conditionGroups, use those
    if (cut.conditionGroups && cut.conditionGroups.length > 0) {
      return cut.conditionGroups.flatMap(g => g.conditions);
    }
    // Legacy: single variable/codes
    if (cut.variableName) {
      return [{ id: '0', variableName: cut.variableName, codes: cut.codes }];
    }
    return [];
  };

  const conditions = getConditions();
  const operator = cut.conditionGroups?.[0]?.operator || 'OR';
  const isSumMode = !!cut.sumCondition;

  // Get display text for a condition
  const getConditionDisplay = (cond: BannerCondition) => {
    const isNumeric = isNumericVariable(cond.variableName);
    if (isNumeric && cond.codes.length > 0) {
      return `${cond.variableName}${cond.codes[0]}`;
    }
    const variable = categoricalVariables.find(v => v.name === cond.variableName);
    if (variable && cond.codes.length > 0) {
      return `${cond.variableName}=${cond.codes.join(',')}`;
    }
    return cond.variableName || 'Select variable';
  };

  // Add a new condition
  const addCondition = () => {
    const newCondition: BannerCondition = { id: Date.now().toString(), variableName: '', codes: [] };
    const currentConditions = conditions.length > 0 ? conditions : [];
    const newConditions = [...currentConditions, newCondition];

    updateCut(subGroupId, cut.id, {
      conditionGroups: [{
        conditions: newConditions,
        operator: operator
      }],
      // Clear legacy fields when using compound conditions
      variableName: newConditions[0]?.variableName || '',
      codes: newConditions[0]?.codes || []
    });
  };

  // Remove a condition
  const removeCondition = (index: number) => {
    const newConditions = conditions.filter((_, i) => i !== index);
    if (newConditions.length === 0) {
      updateCut(subGroupId, cut.id, {
        conditionGroups: undefined,
        variableName: '',
        codes: []
      });
    } else {
      updateCut(subGroupId, cut.id, {
        conditionGroups: [{
          conditions: newConditions,
          operator: operator
        }],
        variableName: newConditions[0]?.variableName || '',
        codes: newConditions[0]?.codes || []
      });
    }
  };

  // Update a specific condition
  const updateCondition = (index: number, updates: Partial<BannerCondition>) => {
    const newConditions = conditions.map((c, i) => i === index ? { ...c, ...updates } : c);
    updateCut(subGroupId, cut.id, {
      conditionGroups: [{
        conditions: newConditions,
        operator: operator
      }],
      // Keep legacy fields in sync with first condition
      variableName: newConditions[0]?.variableName || '',
      codes: newConditions[0]?.codes || []
    });
  };

  // Toggle operator
  const toggleOperator = () => {
    const newOp = operator === 'OR' ? 'AND' : 'OR';
    if (conditions.length > 0) {
      updateCut(subGroupId, cut.id, {
        conditionGroups: [{
          conditions: conditions,
          operator: newOp
        }]
      });
    }
  };

  // Toggle SUM mode
  const toggleSumMode = () => {
    if (isSumMode) {
      // Convert back to regular conditions
      updateCut(subGroupId, cut.id, {
        sumCondition: undefined,
        conditionGroups: undefined,
        variableName: '',
        codes: []
      });
    } else {
      // Convert to SUM mode
      const numericVars = conditions
        .filter(c => isNumericVariable(c.variableName))
        .map(c => c.variableName);
      updateCut(subGroupId, cut.id, {
        sumCondition: {
          id: Date.now().toString(),
          type: 'SUM',
          variables: numericVars.length > 0 ? numericVars : [],
          condition: '>=0'
        },
        conditionGroups: undefined
      });
    }
  };

  // Update SUM condition
  const updateSumCondition = (updates: Partial<BannerSumCondition>) => {
    if (cut.sumCondition) {
      updateCut(subGroupId, cut.id, {
        sumCondition: { ...cut.sumCondition, ...updates }
      });
    }
  };

  // Add variable to SUM
  const addSumVariable = (varName: string) => {
    if (cut.sumCondition) {
      updateCut(subGroupId, cut.id, {
        sumCondition: {
          ...cut.sumCondition,
          variables: [...cut.sumCondition.variables, varName]
        }
      });
    }
  };

  // Remove variable from SUM
  const removeSumVariable = (index: number) => {
    if (cut.sumCondition) {
      updateCut(subGroupId, cut.id, {
        sumCondition: {
          ...cut.sumCondition,
          variables: cut.sumCondition.variables.filter((_, i) => i !== index)
        }
      });
    }
  };

  // Render SUM mode UI
  if (isSumMode && cut.sumCondition) {
    return (
      <div className="space-y-2">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-xs font-medium text-purple-700 bg-purple-100 px-2 py-0.5 rounded">SUM</span>
          {cut.sumCondition.variables.map((varName, idx) => (
            <React.Fragment key={idx}>
              {idx > 0 && <span className="text-xs text-gray-400">+</span>}
              <span className="inline-flex items-center gap-1 px-2 py-0.5 text-xs rounded bg-blue-100 border border-blue-300 text-blue-800 font-mono">
                {varName}
                <button
                  onClick={() => removeSumVariable(idx)}
                  className="ml-0.5 text-blue-600 hover:text-blue-800 hover:bg-blue-200 rounded-full p-0.5 transition-colors"
                >
                  <XMarkIcon className="h-3 w-3" />
                </button>
              </span>
            </React.Fragment>
          ))}
          <button
            onClick={() => setOpenVariableSelector({ subGroupId, cutId: cut.id, conditionIndex: -1 })}
            className="p-1 text-gray-400 hover:text-purple-600 hover:bg-purple-50 rounded transition-colors"
            title="Add variable to sum"
          >
            <PlusIcon className="h-4 w-4" />
          </button>
          {openVariableSelector?.subGroupId === subGroupId && openVariableSelector?.cutId === cut.id && openVariableSelector?.conditionIndex === -1 && (
            <VariableSelectorPopup
              variables={combinedSelectableVariables.filter(v => isNumericVariable(v.name))}
              selectedVariable=""
              onSelect={(varName) => {
                addSumVariable(varName);
                setOpenVariableSelector(null);
              }}
              onClose={() => setOpenVariableSelector(null)}
              anchorRef={{ current: null } as React.RefObject<HTMLButtonElement>}
            />
          )}
        </div>
        <div className="flex items-center gap-2">
          <input
            type="text"
            value={cut.sumCondition.condition}
            onChange={(e) => updateSumCondition({ condition: e.target.value })}
            placeholder=">=50"
            className="w-24 px-2 py-1 text-xs font-mono border border-gray-300 rounded focus:ring-2 focus:ring-[#D14A2D] focus:border-[#D14A2D]"
          />
          <button
            onClick={toggleSumMode}
            className="text-xs text-gray-500 hover:text-gray-700 underline"
          >
            Switch to OR/AND
          </button>
        </div>
      </div>
    );
  }

  // Render regular conditions UI
  const configureButtonRef = getButtonRef(variableButtonRefs, subGroupId, `${cut.id}-configure`);

  return (
    <div className="space-y-2">
      {conditions.length === 0 ? (
        <>
          <button
            ref={configureButtonRef}
            onClick={() => setOpenVariableSelector({ subGroupId, cutId: cut.id, conditionIndex: 0 })}
            className="px-3 py-1.5 text-xs font-medium text-white rounded-lg hover:opacity-90 transition-colors"
            style={{ backgroundColor: BRAND_ORANGE }}
          >
            Configure
          </button>
          {openVariableSelector?.subGroupId === subGroupId && openVariableSelector?.cutId === cut.id && openVariableSelector?.conditionIndex === 0 && (
            <VariableSelectorPopup
              variables={combinedSelectableVariables}
              selectedVariable=""
              onSelect={(varName) => {
                const newCondition: BannerCondition = { id: Date.now().toString(), variableName: varName, codes: [] };
                updateCut(subGroupId, cut.id, {
                  conditionGroups: [{
                    conditions: [newCondition],
                    operator: 'OR'
                  }],
                  variableName: varName,
                  codes: []
                });
                setOpenVariableSelector(null);
              }}
              onClose={() => setOpenVariableSelector(null)}
              anchorRef={configureButtonRef}
            />
          )}
        </>
      ) : (
        <>
          {conditions.map((cond, idx) => {
            const isNumeric = isNumericVariable(cond.variableName);
            const variable = categoricalVariables.find(v => v.name === cond.variableName);
            const varButtonRef = getButtonRef(variableButtonRefs, subGroupId, `${cut.id}-${idx}`);
            const codeButtonRef = getButtonRef(codeButtonRefs, subGroupId, `${cut.id}-${idx}`);

            return (
              <div key={cond.id || idx} className="flex items-center gap-2 flex-wrap">
                {idx > 0 && (
                  <button
                    onClick={toggleOperator}
                    className="text-xs font-medium px-2 py-0.5 rounded border cursor-pointer transition-colors"
                    style={{
                      backgroundColor: operator === 'OR' ? '#FEF3C7' : '#DBEAFE',
                      borderColor: operator === 'OR' ? '#F59E0B' : '#3B82F6',
                      color: operator === 'OR' ? '#B45309' : '#1D4ED8'
                    }}
                  >
                    {operator}
                  </button>
                )}

                {/* Variable pill */}
                <span className="inline-flex items-center gap-1 px-2 py-0.5 text-xs rounded bg-orange-100 border border-orange-300 text-orange-800 font-medium">
                  {cond.variableName || 'Select'}
                  <button
                    ref={varButtonRef}
                    onClick={() => setOpenVariableSelector({ subGroupId, cutId: cut.id, conditionIndex: idx })}
                    className="p-0.5 text-orange-600 hover:text-orange-800 hover:bg-orange-200 rounded transition-colors"
                  >
                    <PencilIcon className="h-3 w-3" />
                  </button>
                </span>
                {openVariableSelector?.subGroupId === subGroupId && openVariableSelector?.cutId === cut.id && openVariableSelector?.conditionIndex === idx && (
                  <VariableSelectorPopup
                    variables={combinedSelectableVariables}
                    selectedVariable={cond.variableName}
                    onSelect={(varName) => {
                      updateCondition(idx, { variableName: varName, codes: [] });
                      setOpenVariableSelector(null);
                    }}
                    onClose={() => setOpenVariableSelector(null)}
                    anchorRef={varButtonRef}
                  />
                )}

                {/* Codes/Condition */}
                {cond.variableName && (
                  isNumeric ? (
                    <>
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 text-xs rounded bg-blue-100 border border-blue-300 text-blue-800 font-mono">
                        {cond.codes[0] || '?'}
                        <button
                          ref={codeButtonRef}
                          onClick={() => setOpenCodeSelector({ subGroupId, cutId: cut.id, conditionIndex: idx })}
                          className="p-0.5 text-blue-600 hover:text-blue-800 hover:bg-blue-200 rounded transition-colors"
                        >
                          <PencilIcon className="h-3 w-3" />
                        </button>
                      </span>
                      {openCodeSelector?.subGroupId === subGroupId && openCodeSelector?.cutId === cut.id && openCodeSelector?.conditionIndex === idx && (
                        <NumericConditionPopup
                          variableName={cond.variableName}
                          currentCondition={cond.codes[0] || ''}
                          onConditionChange={(condition) => {
                            updateCondition(idx, { codes: condition ? [condition] : [] });
                            setOpenCodeSelector(null);
                          }}
                          onClose={() => setOpenCodeSelector(null)}
                          anchorRef={codeButtonRef}
                        />
                      )}
                    </>
                  ) : variable ? (
                    <>
                      {cond.codes.length > 0 ? (
                        cond.codes.map(code => (
                          <span
                            key={code}
                            className="inline-flex items-center gap-1 px-2 py-0.5 text-xs rounded bg-orange-100 border border-orange-300 text-orange-800"
                          >
                            {code}
                            <button
                              onClick={() => {
                                const newCodes = cond.codes.filter(c => c !== code);
                                updateCondition(idx, { codes: newCodes });
                              }}
                              className="p-0.5 text-orange-600 hover:text-orange-800 hover:bg-orange-200 rounded-full transition-colors"
                            >
                              <XMarkIcon className="h-3 w-3" />
                            </button>
                          </span>
                        ))
                      ) : (
                        <span className="text-xs text-gray-400 italic">No codes</span>
                      )}
                      <button
                        ref={codeButtonRef}
                        onClick={() => setOpenCodeSelector({ subGroupId, cutId: cut.id, conditionIndex: idx })}
                        className="p-1 text-gray-400 hover:text-orange-600 hover:bg-orange-50 rounded transition-colors"
                      >
                        <PencilIcon className="h-3 w-3" />
                      </button>
                      {openCodeSelector?.subGroupId === subGroupId && openCodeSelector?.cutId === cut.id && openCodeSelector?.conditionIndex === idx && (
                        <CodeSelectorPopup
                          variable={variable}
                          selectedCodes={cond.codes}
                          onCodesChange={(codes) => {
                            updateCondition(idx, { codes });
                          }}
                          onClose={() => setOpenCodeSelector(null)}
                          anchorRef={codeButtonRef}
                        />
                      )}
                    </>
                  ) : null
                )}

                {/* Remove condition button */}
                {conditions.length > 1 && (
                  <button
                    onClick={() => removeCondition(idx)}
                    className="p-1 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded transition-colors"
                  >
                    <XMarkIcon className="h-3 w-3" />
                  </button>
                )}
              </div>
            );
          })}

          {/* Add condition and SUM toggle buttons */}
          <div className="flex items-center gap-2 pt-1">
            <button
              onClick={addCondition}
              className="text-xs text-[#D14A2D] hover:bg-orange-50 px-2 py-1 rounded border border-dashed border-[#D14A2D] transition-colors"
            >
              + Add {operator}
            </button>
            <button
              onClick={toggleSumMode}
              className="text-xs text-purple-600 hover:bg-purple-50 px-2 py-1 rounded border border-dashed border-purple-400 transition-colors"
            >
              Use SUM
            </button>
          </div>
        </>
      )}
    </div>
  );
};

const BannerBuilder: React.FC<BannerBuilderProps> = ({ variables, onSave, onChange, onCancel, editingGroup, existingBannerCount = 0, rawData, columnMapping, settingsOpenRef, questionnaireId, expectedHeaders, variableTableSelections, getTablesForVariable, projectName }) => {
  const [confidenceLevel, setConfidenceLevel] = useState<95 | 90 | 80>(editingGroup?.confidenceLevel || 95);
  const [includeTotal, setIncludeTotal] = useState<boolean>(editingGroup?.includeTotal !== false);
  const defaultBannerName = projectName ? `${projectName}_B${existingBannerCount + 1}` : `Banner ${existingBannerCount + 1}`;
  const [bannerTitle, setBannerTitle] = useState<string>(editingGroup?.title || defaultBannerName);
  const [subGroups, setSubGroups] = useState<BannerSubGroup[]>(
    editingGroup?.groups || [
      {
        id: '1',
        title: '',
        cuts: [
          { id: '1-1', title: '', variableName: '', codes: [] },
          { id: '1-2', title: '', variableName: '', codes: [] }
        ]
      }
    ]
  );
  const [openCodeSelector, setOpenCodeSelector] = useState<{ subGroupId: string; cutId: string; conditionIndex?: number } | null>(null);
  const [openVariableSelector, setOpenVariableSelector] = useState<{ subGroupId: string; cutId: string; conditionIndex?: number } | null>(null);
  const [showSettingsPopup, setShowSettingsPopup] = useState(false);
  const [isEditingTitle, setIsEditingTitle] = useState(false);
  const [aiConfiguring, setAiConfiguring] = useState(false);
  const [isExporting, setIsExporting] = useState(false);

  // Track initial state to detect changes
  const initialStateRef = useRef({
    bannerTitle: editingGroup?.title || defaultBannerName,
    confidenceLevel: editingGroup?.confidenceLevel || 95,
    includeTotal: editingGroup?.includeTotal !== false,
    subGroups: JSON.stringify(editingGroup?.groups || [
      {
        id: '1',
        title: '',
        cuts: [
          { id: '1-1', title: '', variableName: '', codes: [] },
          { id: '1-2', title: '', variableName: '', codes: [] }
        ]
      }
    ])
  });

  // Detect if there are unsaved changes
  const hasChanges = React.useMemo(() => {
    const initial = initialStateRef.current;
    return (
      bannerTitle !== initial.bannerTitle ||
      confidenceLevel !== initial.confidenceLevel ||
      includeTotal !== initial.includeTotal ||
      JSON.stringify(subGroups) !== initial.subGroups
    );
  }, [bannerTitle, confidenceLevel, includeTotal, subGroups]);

  // Expose settings opener to parent so the top-level header button can open it
  useEffect(() => {
    if (settingsOpenRef) {
      settingsOpenRef.current = () => setShowSettingsPopup(true);
      return () => {
        if (settingsOpenRef) settingsOpenRef.current = null;
      };
    }
  }, [settingsOpenRef]);

  // Auto-trigger AI configuration when a newly imported group is opened
  useEffect(() => {
    if (editingGroup && (editingGroup as any)._isNewlyImported && questionnaireId) {
      // Trigger immediately (no delay) to prevent flash
      handleConfigureAllWithAI();
      // Remove the flag after triggering
      if (editingGroup) {
        delete (editingGroup as any)._isNewlyImported;
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editingGroup?.id, questionnaireId]);
  const codeButtonRefs = useRef<Record<string, React.RefObject<HTMLButtonElement>>>({});
  const variableButtonRefs = useRef<Record<string, React.RefObject<HTMLButtonElement>>>({});

  // Filter for variables that have codes (categorical variables) OR are numeric
  const categoricalVariables = variables.filter(v =>
    v.codes && Object.keys(v.codes).length > 0
  );

  // Get all selectable variables (categorical + numeric + expanded numeric grid cells)
  const selectableVariables = React.useMemo(() => {
    const result: any[] = [];

    variables.forEach(v => {
      const isNumericGrid = v.type?.toLowerCase().includes('numeric') && v.type?.toLowerCase().includes('grid');

      // Include categorical variables (have codes) - but NOT numeric grids
      if (v.codes && Object.keys(v.codes).length > 0 && !isNumericGrid) {
        result.push(v);
      }
      // For numeric grids, expand each column as a separate selectable variable
      else if (isNumericGrid && v.codes && Object.keys(v.codes).length > 0) {
        // This is a numeric grid with multiple columns - create one entry per column
        const baseNumber = v.name.replace(/^Q/, '');
        Object.entries(v.codes).forEach(([colCode, colLabel]) => {
          const normalizedColCode = colCode.startsWith('c') || colCode.startsWith('C') ? colCode : `c${colCode}`;
          result.push({
            ...v,
            name: `Q${baseNumber}${normalizedColCode}`,
            description: `${v.description || v.name} - ${colLabel}`,
            _originalVariable: v.name,
            _columnCode: normalizedColCode,
            _columnLabel: colLabel
          });
        });
      }
      // Include single-column numeric variables and numeric grids without codes
      else if (v.type?.toLowerCase().includes('numeric')) {
        result.push(v);
      }
    });

    return result;
  }, [variables]);

  // Build selectable variables from EXPECTED HEADERS ONLY
  // Merge with selectableVariables to get full variable info (codes, descriptions, etc.)
  const combinedSelectableVariables = React.useMemo(() => {
    const headers = Array.isArray(expectedHeaders) ? expectedHeaders : [];
    
    // If no expected headers, use selectableVariables directly
    if (headers.length === 0) {
      return selectableVariables;
    }
    
    // Group by base (strip leading Q, remove r/c parts for base key)
    const baseInfo = new Map<string, { items: string[]; hasSub: boolean }>();
    const isSubPart = (h: string) => /(^|[^A-Za-z])r\d+/i.test(h) || /(^|[^A-Za-z])c\d+/i.test(h) || /_r\d+/i.test(h) || /_c\d+/i.test(h) || /-r\d+/i.test(h) || /-c\d+/i.test(h);
    const getBaseKey = (h: string) => {
      // Examples:
      // QC7r3 -> C7 ; C7r3 -> C7 ; QC7 -> C7
      const noQ = h.replace(/^Q/i, '');
      const m = noQ.match(/^([A-Za-z]*\d+)/);
      return m ? m[1] : noQ;
    };
    headers.forEach(h => {
      const base = getBaseKey(h);
      if (!baseInfo.has(base)) baseInfo.set(base, { items: [], hasSub: false });
      const info = baseInfo.get(base)!;
      info.items.push(h);
      if (isSubPart(h)) info.hasSub = true;
    });
    // Filter: remove plain base headers when subparts exist for that base
    const filtered = headers.filter(h => {
      const info = baseInfo.get(getBaseKey(h));
      if (!info) return true;
      const hasSubs = info.hasSub;
      const isBaseOnly = !isSubPart(h);
      // If there are subparts for this base, exclude the base-only header
      if (hasSubs && isBaseOnly) return false;
      return true;
    });
    // Deduplicate
    const dedup = Array.from(new Set(filtered));
    
    // Map to full variable objects by matching with selectableVariables
    // This ensures we have codes, descriptions, etc.
    const result: any[] = [];
    const matchedHeaders = new Set<string>();
    
    dedup.forEach(headerName => {
      // Try to find matching variable in selectableVariables
      const matched = selectableVariables.find(sv => {
        // Exact match
        if (sv.name === headerName) return true;
        // Try with/without Q prefix
        const svNoQ = sv.name.replace(/^Q/i, '');
        const hNoQ = headerName.replace(/^Q/i, '');
        if (svNoQ === hNoQ) return true;
        // For grid cells, check if header matches the synthetic name
        if (sv._isGridCell && sv.name === headerName) return true;

        // For numeric grid columns: match headers like QS14r1c1 to expanded column variables like QS14c1
        // Extract column code from header (e.g., QS14r1c1 -> c1)
        const colMatch = headerName.match(/c\d+$/i);
        if (colMatch && sv._originalVariable) {
          // This is an expanded column variable - check if the column codes match
          const headerBase = headerName.replace(/r\d+c\d+$/i, ''); // QS14r1c1 -> QS14
          const svBase = sv.name.replace(/c\d+$/i, ''); // QS14c1 -> QS14
          const headerCol = colMatch[0].toLowerCase(); // c1
          const svCol = sv._columnCode?.toLowerCase(); // c1
          if (headerBase.toLowerCase() === svBase.toLowerCase() && headerCol === svCol) {
            return true;
          }
        }

        return false;
      });

      if (matched) {
        // Avoid duplicates - only add if not already in result
        const alreadyAdded = result.some(r => r.name === matched.name);
        if (!alreadyAdded) {
          result.push(matched);
        }
        matchedHeaders.add(headerName);
      } else {
        // If no match found, try to resolve from categoricalVariables for codes
        const resolved = resolveCategoricalVariableForName(headerName, categoricalVariables);
        if (resolved) {
          result.push(resolved);
          matchedHeaders.add(headerName);
        }
      }
    });
    
    // If we have expected headers but didn't match many, include all selectableVariables as fallback
    // This ensures variables are always available for selection
    if (result.length === 0 || result.length < selectableVariables.length * 0.5) {
      // Add all selectableVariables that weren't already matched
      selectableVariables.forEach(sv => {
        const alreadyIncluded = result.some(r => r.name === sv.name);
        if (!alreadyIncluded) {
          result.push(sv);
        }
      });
    }

    return result;
  }, [expectedHeaders, selectableVariables, categoricalVariables]);

  // Check if a variable is numeric (no codes, type includes numeric)
  const isNumericVariable = (varName: string): boolean => {
    // Check if this is an expanded numeric grid column variable
    const expandedVar = selectableVariables.find(sv =>
      sv.name === varName && sv._originalVariable
    );
    if (expandedVar) return true;

    const v = variables.find(variable => variable.name === varName);
    if (!v) return false;
    const hasCodes = v.codes && Object.keys(v.codes).length > 0;
    const isNumericType = v.type?.toLowerCase().includes('numeric');
    // Numeric grids have codes for columns but are still numeric variables
    const isNumericGrid = isNumericType && v.type?.toLowerCase().includes('grid');
    return isNumericGrid || (!hasCodes && isNumericType);
  };

  // Calculate sample size for a cut
  const calculateSampleSize = (variableName: string, codes: string[]): number => {
    if (!rawData || !rawData.rows || !columnMapping || !variableName || codes.length === 0) {
      return 0;
    }

    // Find the column header for this variable
    const getColumnHeader = (varName: string): string | null => {
      const variations = [varName, `Q${varName}`, varName.replace(/^Q/, ''), `${varName}r1`, `Q${varName.replace(/^Q/, '')}r1`];
      for (const v of variations) {
        if (columnMapping[v]) return columnMapping[v];
        const match = Object.keys(columnMapping).find(k => k.toLowerCase() === v.toLowerCase());
        if (match) return columnMapping[match];
      }
      // Fallback: allow direct use of raw column name if present
      if (rawData.columns && rawData.columns.includes(varName)) {
        return varName;
      }
      return null;
    };

    const colHeader = getColumnHeader(variableName);
    if (!colHeader) return 0;

    // Check if this is a numeric condition
    const isNumeric = isNumericVariable(variableName);

    let count = 0;
    rawData.rows.forEach((row: any) => {
      const val = row[colHeader];
      if (val === null || val === undefined || val === '') return;
      const valStr = String(val).trim();
      const numVal = Number(valStr);

      if (isNumeric && codes.length === 1) {
        // Parse numeric condition
        const condition = codes[0];
        let matches = false;

        // Check for "between" format: "10-50"
        const betweenMatch = condition.match(/^(\d+(?:\.\d+)?)-(\d+(?:\.\d+)?)$/);
        if (betweenMatch) {
          const min = parseFloat(betweenMatch[1]);
          const max = parseFloat(betweenMatch[2]);
          if (!isNaN(numVal) && numVal >= min && numVal <= max) {
            matches = true;
          }
        } else {
          // Check for standard operators: >=50, <=50, >50, <50, =50
          const opMatch = condition.match(/^(>=|<=|>|<|=)(\d+(?:\.\d+)?)$/);
          if (opMatch) {
            const op = opMatch[1];
            const compareVal = parseFloat(opMatch[2]);
            if (!isNaN(numVal)) {
              switch (op) {
                case '>=': matches = numVal >= compareVal; break;
                case '<=': matches = numVal <= compareVal; break;
                case '>': matches = numVal > compareVal; break;
                case '<': matches = numVal < compareVal; break;
                case '=': matches = numVal === compareVal; break;
              }
            }
          }
        }

        if (matches) count++;
      } else {
        // Categorical matching
        for (const code of codes) {
          let matches = false;
          if (valStr === code) matches = true;
          else if (!isNaN(numVal) && String(numVal) === code) matches = true;
          else {
            const codeNoC = code.replace(/^c/i, '');
            if (valStr === codeNoC || (!isNaN(numVal) && !isNaN(Number(codeNoC)) && numVal === Number(codeNoC))) {
              matches = true;
            }
          }
          if (matches) {
            count++;
            break;
          }
        }
      }
    });

    return count;
  };

  // Calculate sample size for a cut with compound conditions
  const calculateCutSampleSize = (cut: BannerCut): number => {
    if (!rawData || !rawData.rows || !columnMapping) return 0;

    // Handle SUM condition
    if (cut.sumCondition && cut.sumCondition.variables.length > 0) {
      const getColumnHeader = (varName: string): string | null => {
        const variations = [varName, `Q${varName}`, varName.replace(/^Q/, ''), `${varName}r1`, `Q${varName.replace(/^Q/, '')}r1`];
        for (const v of variations) {
          if (columnMapping[v]) return columnMapping[v];
          const match = Object.keys(columnMapping).find(k => k.toLowerCase() === v.toLowerCase());
          if (match) return columnMapping[match];
        }
        if (rawData.columns && rawData.columns.includes(varName)) {
          return varName;
        }
        return null;
      };

      // Parse the condition
      const parseCondition = (cond: string): { operator: string; value: number } | null => {
        const match = cond.match(/^(>=|<=|>|<|=)(\d+(?:\.\d+)?)$/);
        if (match) {
          return { operator: match[1], value: parseFloat(match[2]) };
        }
        return null;
      };

      const parsedCond = parseCondition(cut.sumCondition.condition);
      if (!parsedCond) return 0;

      let count = 0;
      rawData.rows.forEach((row: any) => {
        let sum = 0;
        let hasValidValue = false;

        for (const varName of cut.sumCondition!.variables) {
          const colHeader = getColumnHeader(varName);
          if (!colHeader) continue;
          const val = row[colHeader];
          if (val !== null && val !== undefined && val !== '') {
            const numVal = Number(val);
            if (!isNaN(numVal)) {
              sum += numVal;
              hasValidValue = true;
            }
          }
        }

        if (hasValidValue) {
          let matches = false;
          switch (parsedCond.operator) {
            case '>=': matches = sum >= parsedCond.value; break;
            case '<=': matches = sum <= parsedCond.value; break;
            case '>': matches = sum > parsedCond.value; break;
            case '<': matches = sum < parsedCond.value; break;
            case '=': matches = sum === parsedCond.value; break;
          }
          if (matches) count++;
        }
      });
      return count;
    }

    // Handle compound conditions
    if (cut.conditionGroups && cut.conditionGroups.length > 0) {
      const group = cut.conditionGroups[0];
      const conditions = group.conditions;
      const operator = group.operator;

      if (conditions.length === 0) return 0;

      // Helper to check if a row matches a single condition
      const rowMatchesCondition = (row: any, cond: BannerCondition): boolean => {
        if (!cond.variableName || cond.codes.length === 0) return false;

        const getColumnHeader = (varName: string): string | null => {
          const variations = [varName, `Q${varName}`, varName.replace(/^Q/, ''), `${varName}r1`, `Q${varName.replace(/^Q/, '')}r1`];
          for (const v of variations) {
            if (columnMapping[v]) return columnMapping[v];
            const match = Object.keys(columnMapping).find(k => k.toLowerCase() === v.toLowerCase());
            if (match) return columnMapping[match];
          }
          if (rawData.columns && rawData.columns.includes(varName)) {
            return varName;
          }
          return null;
        };

        const colHeader = getColumnHeader(cond.variableName);
        if (!colHeader) return false;

        const val = row[colHeader];
        if (val === null || val === undefined || val === '') return false;
        const valStr = String(val).trim();
        const numVal = Number(valStr);

        const isNumeric = isNumericVariable(cond.variableName);

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

      let count = 0;
      rawData.rows.forEach((row: any) => {
        let matches: boolean;
        if (operator === 'OR') {
          matches = conditions.some(cond => rowMatchesCondition(row, cond));
        } else {
          matches = conditions.every(cond => rowMatchesCondition(row, cond));
        }
        if (matches) count++;
      });
      return count;
    }

    // Legacy: single variable/codes
    if (cut.variableName && cut.codes.length > 0) {
      return calculateSampleSize(cut.variableName, cut.codes);
    }

    return 0;
  };

  const addSubGroup = () => {
    setSubGroups([...subGroups, {
      id: Date.now().toString(),
      title: '',
      cuts: [
        { id: `${Date.now()}-1`, title: '', variableName: '', codes: [] },
        { id: `${Date.now()}-2`, title: '', variableName: '', codes: [] }
      ]
    }]);
  };

  const removeSubGroup = (subGroupId: string) => {
    if (subGroups.length <= 1) return;
    setSubGroups(subGroups.filter(g => g.id !== subGroupId));
  };

  const updateSubGroup = (subGroupId: string, updates: Partial<BannerSubGroup>) => {
    setSubGroups(subGroups.map(g => g.id === subGroupId ? { ...g, ...updates } : g));
  };

  const addCut = (subGroupId: string) => {
    setSubGroups(subGroups.map(g => {
      if (g.id === subGroupId) {
        const newCut = { id: `${Date.now()}-${g.cuts.length + 1}`, title: '', variableName: '', codes: [] };
        return { ...g, cuts: [...g.cuts, newCut] };
      }
      return g;
    }));
  };

  const removeCut = (subGroupId: string, cutId: string) => {
    setSubGroups(subGroups.map(g => {
      if (g.id === subGroupId && g.cuts.length > 1) {
        return { ...g, cuts: g.cuts.filter(c => c.id !== cutId) };
      }
      return g;
    }));
  };

  const updateCut = (subGroupId: string, cutId: string, updates: Partial<BannerCut>) => {
    setSubGroups(subGroups.map(g => {
      if (g.id === subGroupId) {
        return {
          ...g,
          cuts: g.cuts.map(c => c.id === cutId ? { ...c, ...updates } : c)
        };
      }
      return g;
    }));
  };

  const getButtonRef = (refs: React.MutableRefObject<Record<string, React.RefObject<HTMLButtonElement>>>, subGroupId: string, cutId: string, suffix?: string): React.RefObject<HTMLButtonElement> => {
    const key = suffix ? `${subGroupId}-${cutId}-${suffix}` : `${subGroupId}-${cutId}`;
    if (!refs.current[key]) {
      refs.current[key] = React.createRef<HTMLButtonElement>();
    }
    return refs.current[key];
  };

  const handleExportBanner = async () => {
    if (!rawData || !rawData.rows || rawData.rows.length === 0) {
      alert('No data available to export');
      return;
    }

    if (!getTablesForVariable || !variableTableSelections) {
      alert('Table selection data not available');
      return;
    }

    setIsExporting(true);
    try {
      const workbook = new ExcelJS.Workbook();

      // Helper to get column header from variable name
      const getColumnHeader = (varName: string): string | null => {
        const variations = [
          varName,
          varName.startsWith('Q') ? varName : `Q${varName}`,
          varName.startsWith('Q') ? varName.substring(1) : varName
        ];

        for (const variation of variations) {
          if (columnMapping && columnMapping[variation]) {
            return columnMapping[variation];
          }
          const matchingKey = columnMapping ? Object.keys(columnMapping).find(
            key => key.toLowerCase() === variation.toLowerCase()
          ) : undefined;
          if (matchingKey && columnMapping) {
            return columnMapping[matchingKey];
          }
        }

        if (rawData.columns) {
          for (const variation of variations) {
            const directMatch = rawData.columns.find(
              col => col.toLowerCase() === variation.toLowerCase()
            );
            if (directMatch) {
              return directMatch;
            }
          }
        }

        return null;
      };

      // Build banner columns structure
      const bannerCols: Array<{ title: string; predicate: (row: any) => boolean }> = [];

      subGroups.forEach(sg => {
        sg.cuts.forEach(cut => {
          const cutTitle = `${sg.title ? sg.title + ' - ' : ''}${cut.title || 'Untitled'}`;
          const cutVarName = cut.variableName;
          const cutCodes = Array.isArray(cut.codes) ? cut.codes : [];

          bannerCols.push({
            title: cutTitle,
            predicate: (row: any) => {
              if (!cutVarName || cutCodes.length === 0) return false;
              const header = getColumnHeader(cutVarName);
              if (!header) return false;
              const value = row[header];
              if (value === null || value === undefined || value === '') return false;
              const valueStr = String(value).trim();
              return cutCodes.some(code => {
                if (valueStr === code) return true;
                const codeNoC = code.replace(/^c/i, '');
                if (valueStr === codeNoC) return true;
                const numVal = Number(valueStr);
                if (!isNaN(numVal) && String(numVal) === codeNoC) return true;
                return false;
              });
            }
          });
        });
      });

      // Create Table of Contents worksheet
      const tocWorksheet = workbook.addWorksheet('Table of Contents');

      // Create Data Cuts worksheet
      const dataCutsWorksheet = workbook.addWorksheet('Data Cuts');
      let currentRow = 1;
      const tablePositions: Array<{ tableNumber: number; tableName: string; rowNumber: number; variable: any }> = [];
      let tableNumber = 0;

      // Process each variable
      for (const variable of variables) {
        const tables = getTablesForVariable(variable);

        if (!tables || tables.length === 0) continue;

        for (const tableName of tables) {
          tableNumber++;

          // Add spacing between tables
          if (tableNumber > 1) {
            currentRow += 3;
          }

          const tableStartRow = currentRow;
          tablePositions.push({ tableNumber, tableName, rowNumber: currentRow, variable });

          // Table title
          const tableTitle = `Table ${tableNumber}: ${variable.name}`;
          const titleRow = dataCutsWorksheet.getRow(currentRow++);
          titleRow.getCell(2).value = tableTitle;
          titleRow.getCell(2).font = { bold: true, size: 12 };

          // Question text
          const questionRow = dataCutsWorksheet.getRow(currentRow++);
          questionRow.getCell(2).value = variable.description || variable.name;
          questionRow.getCell(2).font = { size: 11 };

          // Build header row
          const headerRow = dataCutsWorksheet.getRow(currentRow++);
          let col = 2;

          // Row label column
          headerRow.getCell(col).value = '';
          headerRow.getCell(col).font = { bold: true, color: { argb: 'FFFFFFFF' } };
          headerRow.getCell(col).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFD14A2D' } };
          headerRow.getCell(col).border = { top: {style: 'thin'}, bottom: {style: 'thin'}, left: {style: 'thin'}, right: {style: 'thin'} };
          dataCutsWorksheet.getColumn(col).width = 40;
          col++;

          // Total column
          if (includeTotal) {
            headerRow.getCell(col).value = 'Total';
            headerRow.getCell(col).alignment = { horizontal: 'center', vertical: 'middle' };
            headerRow.getCell(col).font = { bold: true, color: { argb: 'FFFFFFFF' } };
            headerRow.getCell(col).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFD14A2D' } };
            headerRow.getCell(col).border = { top: {style: 'thin'}, bottom: {style: 'thin'}, left: {style: 'thin'}, right: {style: 'thin'} };
            dataCutsWorksheet.getColumn(col).width = 12;
            col++;
          }

          // Banner columns
          bannerCols.forEach((bannerCol) => {
            headerRow.getCell(col).value = bannerCol.title;
            headerRow.getCell(col).alignment = { horizontal: 'center', vertical: 'middle' };
            headerRow.getCell(col).font = { bold: true, color: { argb: 'FFFFFFFF' } };
            headerRow.getCell(col).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFD14A2D' } };
            headerRow.getCell(col).border = { top: {style: 'thin'}, bottom: {style: 'thin'}, left: {style: 'thin'}, right: {style: 'thin'} };
            dataCutsWorksheet.getColumn(col).width = 12;
            col++;
          });

          // Get variable data
          const varHeader = getColumnHeader(variable.name);
          const varData = varHeader ? rawData.rows.map((row: any) => row[varHeader]) : [];

          // Calculate total base
          const totalBase = varData.filter((v: any) => v !== null && v !== undefined && v !== '').length;

          // Calculate banner bases
          const bannerBases: number[] = [];
          bannerCols.forEach((bannerCol) => {
            const bannerRows = rawData.rows.filter(bannerCol.predicate);
            const bannerBase = varHeader ? bannerRows.filter((row: any) => {
              const v = row[varHeader];
              return v !== null && v !== undefined && v !== '';
            }).length : 0;
            bannerBases.push(bannerBase);
          });

          // Add base row first (italic, not bold)
          const baseRow = dataCutsWorksheet.getRow(currentRow++);
          let baseCol = 2;
          baseRow.getCell(baseCol).value = 'Base';
          baseRow.getCell(baseCol).font = { italic: true };
          baseRow.getCell(baseCol).border = { top: {style: 'thin'}, bottom: {style: 'thin'}, left: {style: 'thin'}, right: {style: 'thin'} };
          baseCol++;

          if (includeTotal) {
            baseRow.getCell(baseCol).value = totalBase;
            baseRow.getCell(baseCol).alignment = { horizontal: 'center' };
            baseRow.getCell(baseCol).font = { italic: true };
            baseRow.getCell(baseCol).border = { top: {style: 'thin'}, bottom: {style: 'thin'}, left: {style: 'thin'}, right: {style: 'thin'} };
            baseCol++;
          }

          bannerBases.forEach((bannerBase) => {
            baseRow.getCell(baseCol).value = bannerBase;
            baseRow.getCell(baseCol).alignment = { horizontal: 'center' };
            baseRow.getCell(baseCol).font = { italic: true };
            baseRow.getCell(baseCol).border = { top: {style: 'thin'}, bottom: {style: 'thin'}, left: {style: 'thin'}, right: {style: 'thin'} };
            baseCol++;
          });

          // Get response options
          const responseOptions: Array<{ code: string; text: string }> = [];
          if (variable.codes && Object.keys(variable.codes).length > 0) {
            Object.entries(variable.codes).forEach(([code, text]) => {
              responseOptions.push({ code, text: String(text) });
            });
          }

          // Build data rows for each response option (count row, then percentage row)
          responseOptions.forEach((option) => {
            // Count row
            const countRow = dataCutsWorksheet.getRow(currentRow++);
            let col = 2;

            // Row label
            countRow.getCell(col).value = option.text;
            countRow.getCell(col).border = { top: {style: 'thin'}, bottom: {style: 'thin'}, left: {style: 'thin'}, right: {style: 'thin'} };
            col++;

            // Total column - count
            if (includeTotal) {
              const totalCount = varData.filter((v: any) => {
                if (v === null || v === undefined || v === '') return false;
                const vStr = String(v).trim();
                return vStr === option.code || vStr === option.code.replace(/^c/i, '') || vStr === String(Number(option.code.replace(/^c/i, '')));
              }).length;
              countRow.getCell(col).value = totalCount;
              countRow.getCell(col).alignment = { horizontal: 'center' };
              countRow.getCell(col).border = { top: {style: 'thin'}, bottom: {style: 'thin'}, left: {style: 'thin'}, right: {style: 'thin'} };
              col++;
            }

            // Banner columns - counts
            bannerCols.forEach((bannerCol, idx) => {
              const bannerRows = rawData.rows.filter(bannerCol.predicate);
              const bannerCount = varHeader ? bannerRows.filter((row: any) => {
                const v = row[varHeader];
                if (v === null || v === undefined || v === '') return false;
                const vStr = String(v).trim();
                return vStr === option.code || vStr === option.code.replace(/^c/i, '') || vStr === String(Number(option.code.replace(/^c/i, '')));
              }).length : 0;

              countRow.getCell(col).value = bannerCount;
              countRow.getCell(col).alignment = { horizontal: 'center' };
              countRow.getCell(col).border = { top: {style: 'thin'}, bottom: {style: 'thin'}, left: {style: 'thin'}, right: {style: 'thin'} };
              col++;
            });

            // Percentage row
            const pctRow = dataCutsWorksheet.getRow(currentRow++);
            let pctCol = 2;

            // Empty row label for percentage row
            pctRow.getCell(pctCol).value = '';
            pctRow.getCell(pctCol).border = { top: {style: 'thin'}, bottom: {style: 'thin'}, left: {style: 'thin'}, right: {style: 'thin'} };
            pctCol++;

            // Total column - percentage
            if (includeTotal) {
              const totalCount = varData.filter((v: any) => {
                if (v === null || v === undefined || v === '') return false;
                const vStr = String(v).trim();
                return vStr === option.code || vStr === option.code.replace(/^c/i, '') || vStr === String(Number(option.code.replace(/^c/i, '')));
              }).length;
              const totalPct = totalBase > 0 ? ((totalCount / totalBase) * 100).toFixed(1) : '0.0';
              pctRow.getCell(pctCol).value = `${totalPct}%`;
              pctRow.getCell(pctCol).alignment = { horizontal: 'center' };
              pctRow.getCell(pctCol).border = { top: {style: 'thin'}, bottom: {style: 'thin'}, left: {style: 'thin'}, right: {style: 'thin'} };
              pctCol++;
            }

            // Banner columns - percentages
            bannerCols.forEach((bannerCol, idx) => {
              const bannerRows = rawData.rows.filter(bannerCol.predicate);
              const bannerBase = bannerBases[idx];
              const bannerCount = varHeader ? bannerRows.filter((row: any) => {
                const v = row[varHeader];
                if (v === null || v === undefined || v === '') return false;
                const vStr = String(v).trim();
                return vStr === option.code || vStr === option.code.replace(/^c/i, '') || vStr === String(Number(option.code.replace(/^c/i, '')));
              }).length : 0;

              const bannerPct = bannerBase > 0 ? ((bannerCount / bannerBase) * 100).toFixed(1) : '0.0';
              pctRow.getCell(pctCol).value = `${bannerPct}%`;
              pctRow.getCell(pctCol).alignment = { horizontal: 'center' };
              pctRow.getCell(pctCol).border = { top: {style: 'thin'}, bottom: {style: 'thin'}, left: {style: 'thin'}, right: {style: 'thin'} };
              pctCol++;
            });
          });
        }
      }

      // Build Table of Contents
      tocWorksheet.getColumn(1).width = 15;
      tocWorksheet.getColumn(2).width = 60;
      tocWorksheet.getColumn(3).width = 15;

      const tocHeaderRow = tocWorksheet.getRow(1);
      tocHeaderRow.getCell(1).value = 'Table #';
      tocHeaderRow.getCell(2).value = 'Description';
      tocHeaderRow.getCell(3).value = 'Row';
      tocHeaderRow.font = { bold: true, color: { argb: 'FFFFFFFF' } };
      tocHeaderRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFD14A2D' } };
      tocHeaderRow.alignment = { vertical: 'middle', horizontal: 'left' };

      let tocRow = 2;
      tablePositions.forEach((pos) => {
        const row = tocWorksheet.getRow(tocRow++);
        row.getCell(1).value = pos.tableNumber;
        row.getCell(2).value = `${pos.variable.name}: ${pos.variable.description || pos.variable.name}`;
        row.getCell(3).value = pos.rowNumber;
      });

      // Generate and download the file
      const buffer = await workbook.xlsx.writeBuffer();
      const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${bannerTitle.replace(/[^a-zA-Z0-9]/g, '_')}_Banner.xlsx`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (error) {
      console.error('Error exporting banner:', error);
      alert(`Failed to export banner: ${error instanceof Error ? error.message : 'Unknown error'}`);
    } finally {
      setIsExporting(false);
    }
  };

  const handleSave = () => {
    // Auto-generate sub-group titles if not set
    const subGroupsWithTitles = subGroups.map((sg, idx) => ({
      ...sg,
      title: sg.title || `Sub-Group ${idx + 1}`
    }));

    const group: BannerGroup = {
      id: editingGroup?.id || Date.now().toString(),
      title: bannerTitle,
      confidenceLevel,
      includeTotal,
      groups: subGroupsWithTitles
    };
    onSave(group);

    // Reset initial state to current state after save
    initialStateRef.current = {
      bannerTitle,
      confidenceLevel,
      includeTotal,
      subGroups: JSON.stringify(subGroupsWithTitles)
    };
  };

  // Match Data tab's "Respondents" count: count rows with a non-empty record/respno field
  const totalSampleSize = React.useMemo(() => {
    if (!rawData || !rawData.rows) return 0;
    const rows: any[] = rawestRows();
    const count = rows.filter((row: any) => {
      const rv = (row as any)['record'] ??
                 (row as any)['respno'] ??
                 (row as any)['Record'] ??
                 (row as any)['Respno'] ??
                 (row as any)['RECORD'] ??
                 (row as any)['RESPNO'];
      if (rv === null || rv === undefined) return false;
      const s = String(rv).trim();
      return s.length > 0;
    }).length;
    return count;
  }, [rawData]);

  // Helper to get raw data rows (defensive against unexpected shapes)
  function rawestRows(): any[] {
    const r: any = (rawData as any)?.rows;
    return Array.isArray(r) ? r : [];
  }

  // Debounced autosave to parent whenever edits happen (keeps builder open)
  useEffect(() => {
    if (!onChange) return;
    const id = editingGroup?.id || `${Date.now()}`; // fallback id; parent likely has a real id
    const group: BannerGroup = {
      id,
      title: bannerTitle,
      confidenceLevel,
      includeTotal,
      groups: subGroups
    };
    const t = setTimeout(() => onChange(group), 250);
    return () => clearTimeout(t);
  }, [bannerTitle, confidenceLevel, includeTotal, subGroups, editingGroup?.id, onChange]);

  // Build human-readable definition text for a cut (matches Banner Definition column)
  const getDefinitionTextForCut = (cut: BannerCut): string => {
    const c: any = cut as any;
    if (c.definitionText) return String(c.definitionText);
    if (c.sumCondition && c.sumCondition.variables && c.sumCondition.variables.length > 0) {
      return `SUM(${c.sumCondition.variables.join(', ')}) ${c.sumCondition.condition || ''}`;
    }
    if (c.conditionGroups && Array.isArray(c.conditionGroups) && c.conditionGroups.length > 0) {
      const group = c.conditionGroups[0];
      const op = group.operator || 'OR';
      const conds = (group.conditions || []).map((cond: any) => {
        const codes = Array.isArray(cond.codes) ? cond.codes.join(', ') : '';
        return `${cond.variableName}${codes ? '=' + codes : ''}`;
      }).join(` ${op} `);
      return conds || '';
    }
    if (c.variableName) {
      const codes = Array.isArray(c.codes) ? c.codes.join(', ') : '';
      return `${c.variableName}${codes ? '=' + codes : ''}`;
    }
    return '';
  };

  // Send all row definitions to AI to auto-configure variables/codes
  const handleConfigureAllWithAI = async () => {
    if (!questionnaireId) return;
    if (aiConfiguring) return;
    try {
      setAiConfiguring(true);
      // Collect all rows (cuts) across subGroups
      const allCuts = subGroups.flatMap(sg => sg.cuts.map(c => ({ sgId: sg.id, cut: c })));
      const payloadCuts = allCuts.map(({ sgId, cut }) => ({
        subGroupId: sgId,
        cutId: cut.id,
        title: cut.title || '',
        definitionText: getDefinitionTextForCut(cut)
      }));
      // Build expected header details: per-expected-header codes and types
      const headers = Array.isArray(expectedHeaders) ? expectedHeaders : [];
      const expectedHeadersDetail = headers.map((h) => {
        const surveyVar = resolveCategoricalVariableForName(h, categoricalVariables);
        const codes = surveyVar?.codes ? Object.keys(surveyVar.codes).slice(0, 200) : [];
        const type = surveyVar?.type || 'Unknown';
        return { header: h, type, codes };
      });
      const res = await fetch(`${API_BASE_URL}/api/questionnaire/banners/auto-configure`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${localStorage.getItem('cognitive_dash_token')}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          questionnaireId,
          cuts: payloadCuts,
          variables: [], // do not distract the AI with base variables; expected headers are canonical
          expectedHeaders: headers,
          expectedHeadersDetail
        })
      });
      if (!res.ok) {
        setAiConfiguring(false);
        return;
      }
      const data = await res.json();
      // Helper: normalize codes to match the survey variable's code keys
      const normalizeCodesForVar = (varName: string, codes: string[] | undefined): string[] => {
        if (!codes || codes.length === 0) return [];
        // Try to resolve the categorical definition and take its keys as canonical
        const surveyVar =
          categoricalVariables.find(v => v.name === varName) ||
          resolveCategoricalVariableForName(varName, categoricalVariables);
        if (!surveyVar || !surveyVar.codes) {
          // If we cannot resolve, return as-is
          return codes.filter(Boolean);
        }
        const keys = Object.keys(surveyVar.codes || {});
        const keySetLower = new Set(keys.map(k => k.toLowerCase()));
        // If keys look like c-prefixed numbers, prefer that
        const preferCPrefix = keys.every(k => /^c\d+$/i.test(k));
        const toCanonical = (c: string): string | null => {
          if (!c) return null;
          const raw = String(c).trim();
          // Exact key match (case-insensitive)
          if (keySetLower.has(raw.toLowerCase())) {
            // return with original casing from keys
            const found = keys.find(k => k.toLowerCase() === raw.toLowerCase());
            return found || raw;
          }
          // If incoming is like "9" and keys are "c9"
          const num = raw.replace(/^c/i, '');
          if (/^\d+$/.test(num)) {
            const candidate = preferCPrefix ? `c${num}` : num;
            const fx = keys.find(k => k.toLowerCase() === candidate.toLowerCase());
            if (fx) return fx;
          }
          // No good mapping; keep as-is
          return raw;
        };
        // Deduplicate after mapping
        const mapped = codes.map(toCanonical).filter(Boolean) as string[];
        const seen = new Set<string>();
        const dedup: string[] = [];
        for (const m of mapped) {
          const low = m.toLowerCase();
          if (!seen.has(low)) {
            seen.add(low);
            dedup.push(m);
          }
        }
        return dedup;
      };
      const outputs: Array<{
        cutId: string;
        variableName?: string;
        codes?: string[];
        numericCondition?: string;
        conditions?: Array<{ variableName: string; codes?: string[]; numericCondition?: string }>;
        operator?: 'OR' | 'AND';
      }> = data.configs || [];
      if (!Array.isArray(outputs)) {
        setAiConfiguring(false);
        return;
      }
      // Apply outputs to current subGroups
      const byCutId = new Map<string, {
        variableName?: string;
        codes?: string[];
        numericCondition?: string;
        conditions?: Array<{ variableName: string; codes?: string[]; numericCondition?: string }>;
        operator?: 'OR' | 'AND';
      }>();
      // Normalize any returned codes to match survey variable code keys
      outputs.forEach(o => {
        if (Array.isArray(o.conditions) && o.conditions.length > 0) {
          const normalizedConds = o.conditions.map(cn => ({
            variableName: cn.variableName,
            numericCondition: cn.numericCondition,
            codes: normalizeCodesForVar(cn.variableName, cn.codes)
          }));
          byCutId.set(o.cutId, { ...o, conditions: normalizedConds });
        } else {
          byCutId.set(o.cutId, {
            ...o,
            codes: normalizeCodesForVar(o.variableName || '', o.codes)
          });
        }
      });
      setSubGroups(prev => prev.map(sg => ({
        ...sg,
        cuts: sg.cuts.map(cut => {
          const upd = byCutId.get(cut.id);
          if (!upd) return cut; // leave blank if no match
          // Multi-condition form
          if (Array.isArray(upd.conditions) && upd.conditions.length > 0) {
            if (expectedHeaders && expectedHeaders.length > 0) {
              const allAllowed = upd.conditions.every(cn => expectedHeaders.includes(cn.variableName));
              if (!allAllowed) return cut;
            }
            const op = upd.operator === 'AND' ? 'AND' : 'OR';
            const builtConds = upd.conditions.map((cn, idx) => {
              const isNum = isNumericVariable(cn.variableName);
              const codes = isNum && cn.numericCondition ? [cn.numericCondition] : (cn.codes || []);
              return { id: String(idx), variableName: cn.variableName, codes };
            });
            const first = builtConds[0];
            return {
              ...cut,
              conditionGroups: [{
                conditions: builtConds,
                operator: op
              }],
              variableName: first?.variableName || '',
              codes: first?.codes || [],
              sumCondition: undefined
            };
          }
          // Single-condition form
          if (!upd.variableName) return cut;
          if (expectedHeaders && expectedHeaders.length > 0 && !expectedHeaders.includes(upd.variableName!)) {
            return cut;
          }
          const isNumeric = isNumericVariable(upd.variableName);
          if (isNumeric && upd.numericCondition) {
            return {
              ...cut,
              conditionGroups: [{
                conditions: [{ id: '0', variableName: upd.variableName, codes: [upd.numericCondition] }],
                operator: 'OR'
              }],
              variableName: upd.variableName,
              codes: [upd.numericCondition],
              sumCondition: undefined
            };
          } else if (upd.codes && upd.codes.length > 0) {
            return {
              ...cut,
              conditionGroups: [{
                conditions: [{ id: '0', variableName: upd.variableName, codes: upd.codes }],
                operator: 'OR'
              }],
              variableName: upd.variableName,
              codes: upd.codes,
              sumCondition: undefined
            };
          }
          // If we have a variable but no usable details, leave as-is
          return cut;
        })
      })));

      // Auto-save after successful configuration if this was a newly imported banner
      if (editingGroup && (editingGroup as any)._isNewlyImported) {
        // Small delay to ensure state updates are processed
        setTimeout(() => {
          handleSave();
        }, 100);
      }
    } finally {
      setAiConfiguring(false);
    }
  };

  // Check if we should show loading (either actively configuring or about to configure)
  const shouldShowLoading = aiConfiguring || (editingGroup && (editingGroup as any)._isNewlyImported && questionnaireId);

  return (
    <div className="flex flex-col h-full bg-white">
      {shouldShowLoading ? (
        <div className="flex flex-col items-center justify-center py-20">
          <div className="mx-auto h-12 w-12 animate-spin rounded-full border-4 border-gray-200 border-t-[#D14A2D]" />
          <div className="mt-3 text-sm text-gray-600">Configuring banner specifications…</div>
        </div>
      ) : (
        <>
          {/* Header */}
          <div className="flex items-center justify-between p-4 border-b border-gray-200">
        <div className="flex items-center gap-2">
          {isEditingTitle ? (
            <input
              type="text"
              value={bannerTitle}
              onChange={(e) => setBannerTitle(e.target.value)}
              onBlur={() => setIsEditingTitle(false)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') setIsEditingTitle(false);
                if (e.key === 'Escape') {
                  setBannerTitle(editingGroup?.title || defaultBannerName);
                  setIsEditingTitle(false);
                }
              }}
              autoFocus
              className="px-3 py-1.5 text-lg font-semibold border border-gray-300 rounded-lg focus:ring-2 focus:ring-[#D14A2D] focus:border-[#D14A2D]"
            />
          ) : (
            <>
              <h2 className="text-xl font-semibold text-gray-900">{bannerTitle}</h2>
              <button
                onClick={() => setIsEditingTitle(true)}
                className="p-1.5 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded transition-colors"
                title="Edit banner title"
              >
                <PencilIcon className="h-5 w-5" />
              </button>
            </>
          )}
        </div>
        {hasChanges ? (
          <div className="flex items-center gap-2">
            <button
              onClick={onCancel}
              className="px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-200 rounded-lg"
              title="Cancel editing"
            >
              Cancel
            </button>
            <button
              onClick={handleSave}
              className="px-3 py-1.5 text-sm text-white rounded-lg hover:opacity-90"
              style={{ backgroundColor: BRAND_ORANGE }}
              title="Save banner group"
            >
              Save
            </button>
          </div>
        ) : (
          <button
            onClick={onCancel}
            className="px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-200 rounded-lg"
            title="Go back"
          >
            Back
          </button>
        )}
      </div>

      {/* Settings Popup */}
      {showSettingsPopup && (
        <div
          className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50"
          onClick={() => setShowSettingsPopup(false)}
        >
          <div
            className="bg-white rounded-lg shadow-xl max-w-md w-full mx-4 p-6"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold text-gray-900">Banner Settings</h3>
              <button
                onClick={() => setShowSettingsPopup(false)}
                className="text-gray-400 hover:text-gray-600 transition-colors"
              >
                <XMarkIcon className="h-6 w-6" />
              </button>
            </div>

            <div className="space-y-4">
              {/* Stat Level Dropdown */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Statistical Significance Level
                </label>
                <select
                  value={confidenceLevel}
                  onChange={(e) => setConfidenceLevel(Number(e.target.value) as 95 | 90 | 80)}
                  className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-[#D14A2D] focus:border-[#D14A2D]"
                >
                  <option value={95}>95% Confidence</option>
                  <option value={90}>90% Confidence</option>
                  <option value={80}>80% Confidence</option>
                </select>
              </div>

              {/* Include Total Checkbox */}
              <div>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={includeTotal}
                    onChange={(e) => setIncludeTotal(e.target.checked)}
                    className="w-4 h-4 rounded border-gray-300 text-[#D14A2D] focus:ring-[#D14A2D]"
                  />
                  <span className="text-sm font-medium text-gray-700">Include Total</span>
                </label>
                {includeTotal && (
                  <div className="mt-2 text-sm text-gray-600">
                    Total Sample: <span className="font-semibold">{totalSampleSize.toLocaleString()}</span>
                  </div>
                )}
              </div>
            </div>

            <div className="mt-6 flex justify-end">
              <button
                onClick={() => setShowSettingsPopup(false)}
                className="px-4 py-2 text-sm font-medium text-white rounded-lg transition-colors hover:opacity-90"
                style={{ backgroundColor: BRAND_ORANGE }}
              >
                Done
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Content */}
      <div className="flex-1 overflow-y-auto py-6 space-y-4">
        {/* Single Excel-style table for all sub-groups/cuts */}
        <div className="overflow-x-auto border border-gray-200 rounded-lg">
          <table className="min-w-full text-sm border-collapse" style={{ tableLayout: 'fixed' }}>
            <colgroup>
              <col style={{ width: '240px' }} />
              <col style={{ width: '220px' }} />
              <col />
              <col style={{ width: '140px' }} />
            </colgroup>
            <thead className="sticky top-0 z-10" style={{ backgroundColor: BRAND_ORANGE }}>
              <tr className="border-b-2 border-gray-300">
                <th className="px-4 py-2 text-left text-xs font-semibold text-white uppercase tracking-wider border-r border-white/20 whitespace-nowrap">
                  Banner Heading (e.g. Gender)
                </th>
                <th className="px-4 py-2 text-left text-xs font-semibold text-white uppercase tracking-wider border-r border-white/20 whitespace-nowrap">
                  Banner Point (e.g. Male)
                </th>
                <th className="px-4 py-2 text-left text-xs font-semibold text-white uppercase tracking-wider whitespace-nowrap">
                  Banner Definition
                </th>
                <th className="px-4 py-2 text-left text-xs font-semibold text-white uppercase tracking-wider whitespace-nowrap">
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {includeTotal && (
                <tr className="bg-blue-50">
                  <td className="px-4 py-2 border-r border-gray-100 align-top">
                    <div className="px-2 py-1 text-sm font-medium text-gray-900">Total</div>
                  </td>
                  <td className="px-4 py-2 border-r border-gray-100 align-top">
                    <div className="px-2 py-1 text-sm text-gray-700">Total</div>
                  </td>
                  <td className="px-4 py-2 align-top text-gray-700">
                    <span className="text-sm">All respondents</span>
                  </td>
                  <td className="px-4 py-2 align-top">
                    <div className="text-xs text-gray-500 italic">Auto-included</div>
                  </td>
                </tr>
              )}
              {subGroups.map((subGroup, subGroupIndex) => {
                const cutCount = subGroup.cuts.length || 1;
                return subGroup.cuts.map((cut, cutIndex) => {
                  const isFirstRowForGroup = cutIndex === 0;
                  const codeButtonRef = getButtonRef(codeButtonRefs, subGroup.id, cut.id);
                  const variableButtonRef = getButtonRef(variableButtonRefs, subGroup.id, cut.id);
                  const groupBg = subGroupIndex % 2 === 1 ? 'bg-gray-50' : 'bg-white';
                  return (
                    <tr key={`${subGroup.id}-${cut.id}`} className={groupBg}>
                      {/* Banner Heading with rowSpan for this group */}
                      {isFirstRowForGroup && (
                        <td className="px-4 py-2 border-r border-gray-100 align-top" rowSpan={cutCount}>
                          <div className="flex items-start gap-2">
                            <input
                              type="text"
                              value={subGroup.title}
                              onChange={(e) => updateSubGroup(subGroup.id, { title: e.target.value })}
                              placeholder={`Banner Heading ${subGroupIndex + 1}`}
                              className="w-full px-2 py-1 text-sm border border-gray-300 rounded focus:ring-2 focus:ring-[#D14A2D] focus:border-[#D14A2D]"
                            />
                          </div>
                        </td>
                      )}
                      {/* Banner Point */}
                      <td className="px-4 py-2 border-r border-gray-100 align-top">
                        <input
                          type="text"
                          value={cut.title}
                          onChange={(e) => updateCut(subGroup.id, cut.id, { title: e.target.value })}
                          placeholder="Banner Point (e.g., Male)"
                          className="w-full px-2 py-1 text-sm border border-gray-300 rounded focus:ring-2 focus:ring-[#D14A2D] focus:border-[#D14A2D]"
                        />
                      </td>
                      {/* Banner Definition */}
                      <td className="px-4 py-2 align-top text-gray-700">
                        {(() => {
                          // Prefer imported definition text
                          if ((cut as any).definitionText) {
                            return <span className="whitespace-pre-wrap">{(cut as any).definitionText}</span>;
                          }
                          // Fallback to a computed summary of current conditions
                          const c: any = cut as any;
                          if (c.sumCondition && c.sumCondition.variables && c.sumCondition.variables.length > 0) {
                            return `SUM(${c.sumCondition.variables.join(', ')}) ${c.sumCondition.condition || ''}`;
                          }
                          if (c.conditionGroups && Array.isArray(c.conditionGroups) && c.conditionGroups.length > 0) {
                            const group = c.conditionGroups[0];
                            const op = group.operator || 'OR';
                            const conds = (group.conditions || []).map((cond: any) => {
                              const codes = Array.isArray(cond.codes) ? cond.codes.join(', ') : '';
                              return `${cond.variableName}${codes ? '=' + codes : ''}`;
                            }).join(` ${op} `);
                            return conds || '';
                          }
                          if (c.variableName) {
                            const codes = Array.isArray(c.codes) ? c.codes.join(', ') : '';
                            return `${c.variableName}${codes ? '=' + codes : ''}`;
                          }
                          return '';
                        })()}
                      </td>
                      {/* Configure */}
                      <td className="px-4 py-2 align-top">
                        <div className="flex items-start gap-2">
                          <CutConditionsEditor
                            cut={cut}
                            subGroupId={subGroup.id}
                            selectableVariables={combinedSelectableVariables}
                            categoricalVariables={categoricalVariables}
                            isNumericVariable={isNumericVariable}
                            updateCut={updateCut}
                            openVariableSelector={openVariableSelector}
                            setOpenVariableSelector={setOpenVariableSelector}
                            openCodeSelector={openCodeSelector}
                            setOpenCodeSelector={setOpenCodeSelector}
                            getButtonRef={getButtonRef}
                            codeButtonRefs={codeButtonRefs}
                            variableButtonRefs={variableButtonRefs}
                            rawData={rawData}
                            columnMapping={columnMapping}
                          />
                          {subGroups.length > 1 && (
                            <button
                              onClick={() => removeSubGroup(subGroup.id)}
                              className="p-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded transition-colors"
                              title="Remove banner heading"
                            >
                              <TrashIcon className="h-4 w-4" />
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                });
              })}
            </tbody>
          </table>
        </div>

        {/* Add Sub-Group Button */}
        <button
          onClick={addSubGroup}
          className="w-full py-3 border-2 border-dashed border-gray-300 text-sm text-gray-500 hover:border-[#D14A2D] hover:text-[#D14A2D] transition-colors flex items-center justify-center gap-2 bg-white"
        >
          <PlusIcon className="h-5 w-5" />
          Add Sub-Group
        </button>
        </div>

        {/* Footer removed (moved actions to header) */}
        </>
      )}
    </div>
  );
};

export default BannerBuilder;
