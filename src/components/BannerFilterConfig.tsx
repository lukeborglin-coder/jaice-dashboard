import React, { useState, useRef, useEffect } from 'react';
import { XMarkIcon, PlusIcon, TrashIcon, PencilIcon, FunnelIcon } from '@heroicons/react/24/outline';
import { type BannerCondition, type BannerConditionGroup } from '../types/dataTabulation';

const BRAND_ORANGE = '#D14A2D';

interface BannerFilterConfigProps {
  variables: any[];
  filterConditions: BannerConditionGroup[] | null;
  onFilterChange: (conditions: BannerConditionGroup[] | null) => void;
  rawData?: { rows: any[]; columns: string[] } | null;
  columnMapping?: Record<string, string>;
}

interface VariableSelectorPopupProps {
  variables: any[];
  selectedVariable: string;
  onSelect: (variableName: string) => void;
  onClose: () => void;
  anchorRef: React.RefObject<HTMLButtonElement>;
}

const VariableSelectorPopup: React.FC<VariableSelectorPopupProps> = ({ variables, selectedVariable, onSelect, onClose, anchorRef }) => {
  const [search, setSearch] = useState('');
  const popupRef = useRef<HTMLDivElement>(null);

  const filteredVariables = variables.filter(v =>
    v.name.toLowerCase().includes(search.toLowerCase()) ||
    (v.description && v.description.toLowerCase().includes(search.toLowerCase()))
  );

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
      <div className="fixed inset-0 bg-black/20 z-40" onClick={onClose} />
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
            placeholder="Search questions..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="flex-1 px-3 py-2 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-[#D14A2D] focus:border-[#D14A2D]"
            autoFocus
          />
          <button
            onClick={onClose}
            className="p-1.5 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg transition-colors"
          >
            <XMarkIcon className="h-5 w-5" />
          </button>
        </div>
        <div className="space-y-1 max-h-96 overflow-y-auto">
          {filteredVariables.map(v => (
            <button
              key={v.name}
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
                <span>
                  <span className="font-medium">{v.name}</span>
                </span>
                {v.description && (
                  <span className="text-gray-500 text-xs leading-tight mt-0.5 line-clamp-1">
                    {v.description}
                  </span>
                )}
              </div>
            </button>
          ))}
          {filteredVariables.length === 0 && (
            <div className="text-sm text-gray-400 italic py-4 text-center">No questions found</div>
          )}
        </div>
      </div>
    </>
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

  const parseCondition = (cond: string): { operator: string; value: string; value2: string } => {
    if (!cond) return { operator: '>=', value: '', value2: '' };

    const betweenMatch = cond.match(/^(\d+(?:\.\d+)?)\s*(?:-|AND)\s*(\d+(?:\.\d+)?)$/i);
    if (betweenMatch) {
      return { operator: 'between', value: betweenMatch[1], value2: betweenMatch[2] };
    }

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
    <div
      ref={popupRef}
      className="fixed z-50 bg-white border border-gray-200 rounded-lg shadow-lg p-3"
      style={{ top: position.top, left: position.left, minWidth: '280px', maxWidth: '500px' }}
    >
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
    </div>
  );
};

const BannerFilterConfig: React.FC<BannerFilterConfigProps> = ({
  variables,
  filterConditions,
  onFilterChange,
  rawData,
  columnMapping
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [localConditions, setLocalConditions] = useState<BannerCondition[]>(() => {
    if (filterConditions && filterConditions.length > 0) {
      return filterConditions[0].conditions;
    }
    return [];
  });
  // Track operators between conditions (for N conditions, there are N-1 operators)
  const [localOperators, setLocalOperators] = useState<('OR' | 'AND')[]>(() => {
    if (filterConditions && filterConditions.length > 0 && filterConditions[0].conditions.length > 1) {
      // If we have multiple conditions, default all to the group operator
      const operator = filterConditions[0].operator;
      const count = filterConditions[0].conditions.length - 1;
      return Array(count).fill(operator);
    }
    return [];
  });

  // Update operators when conditions change externally
  useEffect(() => {
    if (filterConditions && filterConditions.length > 0) {
      const conditions = filterConditions[0].conditions;
      if (conditions.length > 1) {
        const operator = filterConditions[0].operator;
        const count = conditions.length - 1;
        setLocalOperators(Array(count).fill(operator));
      } else {
        setLocalOperators([]);
      }
    } else {
      setLocalOperators([]);
    }
  }, [filterConditions]);
  const [showVariableSelector, setShowVariableSelector] = useState<number | null>(null);
  const [showNumericCondition, setShowNumericCondition] = useState<number | null>(null);
  const variableButtonRefs = useRef<Record<string, React.RefObject<HTMLButtonElement>>>({});
  const numericButtonRefs = useRef<Record<string, React.RefObject<HTMLButtonElement>>>({});

  // Get all selectable variables (categorical + numeric)
  const selectableVariables = React.useMemo(() => {
    return variables.filter(v => {
      const hasCodes = v.codes && Object.keys(v.codes).length > 0;
      const isNumericType = v.type?.toLowerCase().includes('numeric') && !v.type?.toLowerCase().includes('grid');
      return hasCodes || isNumericType;
    });
  }, [variables]);

  const categoricalVariables = variables.filter(v =>
    v.codes && Object.keys(v.codes).length > 0
  );

  const isNumericVariable = (varName: string): boolean => {
    const v = variables.find(variable => variable.name === varName);
    if (!v) return false;
    const hasCodes = v.codes && Object.keys(v.codes).length > 0;
    const isNumericType = v.type?.toLowerCase().includes('numeric') && !v.type?.toLowerCase().includes('grid');
    return !hasCodes && isNumericType;
  };

  const getButtonRef = (refs: React.MutableRefObject<Record<string, React.RefObject<HTMLButtonElement>>>, conditionId: string, suffix?: string): React.RefObject<HTMLButtonElement> => {
    const key = suffix ? `${conditionId}-${suffix}` : conditionId;
    if (!refs.current[key]) {
      refs.current[key] = React.createRef<HTMLButtonElement>();
    }
    return refs.current[key];
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
    // If removing the first condition, remove the first operator
    // If removing any other condition, remove the operator before it
    if (index === 0 && localOperators.length > 0) {
      setLocalOperators(localOperators.slice(1));
    } else if (index > 0) {
      setLocalOperators(localOperators.filter((_, i) => i !== index - 1));
    }
  };

  const updateCondition = (index: number, updates: Partial<BannerCondition>) => {
    setLocalConditions(localConditions.map((c, i) => i === index ? { ...c, ...updates } : c));
  };

  const handleSave = () => {
    if (localConditions.length === 0 || localConditions.some(c => !c.variableName || c.codes.length === 0)) {
      onFilterChange(null);
    } else {
      // If we have multiple conditions with different operators, we need to group them
      // For simplicity, if all operators are the same, use that operator
      // Otherwise, we'll use the first operator (this is a simplification)
      const operator = localOperators.length > 0 && localOperators.every(op => op === localOperators[0])
        ? localOperators[0]
        : (localOperators[0] || 'OR');
      
      onFilterChange([{
        conditions: localConditions,
        operator: operator
      }]);
    }
    setIsOpen(false);
  };

  const handleClear = () => {
    setLocalConditions([]);
    setLocalOperators([]);
    onFilterChange(null);
    setIsOpen(false);
  };

  const getFilterSummary = () => {
    if (!filterConditions || filterConditions.length === 0 || filterConditions[0].conditions.length === 0) {
      return null;
    }
    const conditions = filterConditions[0].conditions;
    const operator = filterConditions[0].operator;
    return conditions.map(c => {
      const isNumeric = isNumericVariable(c.variableName);
      if (isNumeric && c.codes.length > 0) {
        return `${c.variableName}${c.codes[0]}`;
      }
      const variable = categoricalVariables.find(v => v.name === c.variableName);
      if (variable && c.codes.length > 0) {
        return `${c.variableName}=${c.codes.join(',')}`;
      }
      return c.variableName || '?';
    }).join(` ${operator} `);
  };

  const summary = getFilterSummary();

  return (
    <div className="relative">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className={`flex items-center gap-2 px-3 py-2 text-sm rounded-lg transition-colors ${
          filterConditions && filterConditions.length > 0 && filterConditions[0].conditions.length > 0
            ? 'bg-orange-100 text-orange-800 border border-orange-300'
            : 'bg-gray-100 text-gray-700 border border-gray-300 hover:bg-gray-200'
        }`}
      >
        <FunnelIcon className="h-4 w-4" />
        <span>Filter</span>
        {summary && (
          <span className="text-xs font-medium ml-1">({summary.length > 30 ? summary.substring(0, 30) + '...' : summary})</span>
        )}
      </button>

      {isOpen && (
        <div className="absolute top-full left-0 mt-2 bg-white border border-gray-200 rounded-lg shadow-xl z-50 w-96">
          <div className="p-4 border-b border-gray-200">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-gray-900">Banner Filter Configuration</h3>
              <button
                onClick={() => setIsOpen(false)}
                className="text-gray-400 hover:text-gray-600 transition-colors"
              >
                <XMarkIcon className="h-5 w-5" />
              </button>
            </div>
            <p className="text-xs text-gray-500 mt-1">Configure conditions to filter banner data</p>
          </div>

          <div className="p-4 space-y-4 max-h-96 overflow-y-auto">
            {localConditions.map((cond, idx) => {
              const isNumeric = isNumericVariable(cond.variableName);
              const variable = categoricalVariables.find(v => v.name === cond.variableName);
              const varButtonRef = getButtonRef(variableButtonRefs, cond.id || String(idx));

              return (
                <React.Fragment key={cond.id || idx}>
                  <div className="p-3 bg-gray-50 rounded-lg border border-gray-200 space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-semibold text-gray-700">Condition {idx + 1}</span>
                      {localConditions.length > 1 && (
                        <button
                          onClick={() => removeCondition(idx)}
                          className="p-1 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded transition-colors"
                        >
                          <TrashIcon className="h-3 w-3" />
                        </button>
                      )}
                    </div>

                    <div>
                      <label className="block text-xs font-medium text-gray-600 mb-1">Question:</label>
                      <button
                        ref={varButtonRef}
                        onClick={() => setShowVariableSelector(idx)}
                        className="w-full px-3 py-2 text-left text-sm border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors"
                      >
                        {cond.variableName || 'Select question...'}
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
                          anchorRef={varButtonRef}
                        />
                      )}
                    </div>

                    {cond.variableName && (
                      <div>
                        <label className="block text-xs font-medium text-gray-600 mb-1">
                          {isNumeric ? 'Condition:' : 'Response Codes:'}
                        </label>
                        {isNumeric ? (
                          <>
                            <button
                              ref={getButtonRef(numericButtonRefs, cond.id || String(idx))}
                              onClick={() => setShowNumericCondition(idx)}
                              className="w-full px-3 py-2 text-left text-sm font-mono border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors"
                            >
                              {cond.codes[0] || 'Set condition...'}
                            </button>
                            {showNumericCondition === idx && (
                              <NumericConditionPopup
                                variableName={cond.variableName}
                                currentCondition={cond.codes[0] || ''}
                                onConditionChange={(condition) => {
                                  updateCondition(idx, { codes: condition ? [condition] : [] });
                                  setShowNumericCondition(null);
                                }}
                                onClose={() => setShowNumericCondition(null)}
                                anchorRef={getButtonRef(numericButtonRefs, cond.id || String(idx))}
                              />
                            )}
                          </>
                        ) : variable ? (
                          <div className="space-y-2">
                            <label className="block text-xs font-medium text-gray-600">Codes:</label>
                            <div className="flex flex-wrap gap-2 max-h-48 overflow-y-auto p-2 border border-gray-200 rounded-lg bg-white">
                              {Object.entries(variable.codes || {}).map(([code, label]: [string, any]) => (
                                <label
                                  key={code}
                                  className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs rounded border cursor-pointer transition-colors ${
                                    cond.codes.includes(code)
                                      ? 'bg-orange-100 border-orange-300 text-orange-800'
                                      : 'bg-gray-50 border-gray-200 text-gray-600 hover:bg-gray-100'
                                  }`}
                                >
                                  <input
                                    type="checkbox"
                                    checked={cond.codes.includes(code)}
                                    onChange={(e) => {
                                      const newCodes = e.target.checked
                                        ? [...cond.codes, code]
                                        : cond.codes.filter(c => c !== code);
                                      updateCondition(idx, { codes: newCodes });
                                    }}
                                    className="rounded border-gray-300 text-[#D14A2D] focus:ring-[#D14A2D]"
                                  />
                                  <span className="font-medium">{code}:</span>
                                  <span>{String(label).substring(0, 30)}{String(label).length > 30 ? '...' : ''}</span>
                                </label>
                              ))}
                            </div>
                            {cond.codes.length > 0 && (
                              <div className="text-xs text-gray-500">
                                {cond.codes.length} code{cond.codes.length !== 1 ? 's' : ''} selected
                              </div>
                            )}
                          </div>
                        ) : null}
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

          <div className="flex items-center justify-end gap-2 p-4 border-t border-gray-200 bg-gray-50">
            <button
              onClick={handleClear}
              className="px-3 py-1.5 text-xs text-gray-700 hover:bg-gray-200 rounded-lg"
            >
              Clear
            </button>
            <button
              onClick={handleSave}
              className="px-3 py-1.5 text-xs text-white rounded-lg hover:opacity-90"
              style={{ backgroundColor: BRAND_ORANGE }}
            >
              Apply Filter
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

export default BannerFilterConfig;

