import { useState, useCallback, useEffect } from 'react';
import { createSerializedTableSelections, parseSerializedTableSelections } from '../utils/tabs/serialization';

interface UseTableSelectionsProps {
  storageKey?: string;
  selectedQuestionnaireId?: string;
}

export const useTableSelections = (props?: UseTableSelectionsProps) => {
  const { selectedQuestionnaireId, storageKey } = props || {};
  const keyBase = storageKey || selectedQuestionnaireId;
  const [variableTableSelections, setVariableTableSelections] = useState<Record<string, Set<string>>>({});
  const [summaryTableSortSelections, setSummaryTableSortSelections] = useState<Record<string, Set<string>>>({});
  const [variableSortByFrequency, setVariableSortByFrequency] = useState<Record<string, boolean>>({});
  const [variableHoldResponseCodes, setVariableHoldResponseCodes] = useState<Record<string, string[]>>({});
  const [holdOptionsDropdownOpen, setHoldOptionsDropdownOpen] = useState<Record<string, boolean>>({});

  // Load table selections from localStorage when key changes
  useEffect(() => {
    if (keyBase) {
      const key = `variableTableSelections_${keyBase}`;
      const stored = localStorage.getItem(key);
      if (stored) {
        try {
          const parsed = JSON.parse(stored);
          setVariableTableSelections(parseSerializedTableSelections(parsed));
        } catch (e) {
          setVariableTableSelections({});
        }
      } else {
        setVariableTableSelections({});
      }

      const sortKey = `summaryTableSortSelections_${keyBase}`;
      const storedSort = localStorage.getItem(sortKey);
      if (storedSort) {
        try {
          const parsed = JSON.parse(storedSort);
          setSummaryTableSortSelections(parseSerializedTableSelections(parsed));
        } catch (e) {
          setSummaryTableSortSelections({});
        }
      } else {
        setSummaryTableSortSelections({});
      }

      const frequencyKey = `variableSortByFrequency_${keyBase}`;
      const storedFrequency = localStorage.getItem(frequencyKey);
      if (storedFrequency) {
        try {
          const parsed = JSON.parse(storedFrequency);
          setVariableSortByFrequency(parsed || {});
        } catch (e) {
          setVariableSortByFrequency({});
        }
      } else {
        setVariableSortByFrequency({});
      }

      const holdKey = `variableHoldResponseCodes_${keyBase}`;
      const storedHold = localStorage.getItem(holdKey);
      if (storedHold) {
        try {
          const parsed = JSON.parse(storedHold);
          setVariableHoldResponseCodes(parsed || {});
        } catch (e) {
          setVariableHoldResponseCodes({});
        }
      } else {
        setVariableHoldResponseCodes({});
      }
    } else {
      setVariableTableSelections({});
      setSummaryTableSortSelections({});
      setVariableSortByFrequency({});
      setVariableHoldResponseCodes({});
    }
  }, [keyBase]);

  // Save table selections to localStorage when they change
  useEffect(() => {
    if (keyBase) {
      const key = `variableTableSelections_${keyBase}`;
      const serialized = createSerializedTableSelections(variableTableSelections);
      if (Object.keys(serialized).length > 0) {
        try {
          localStorage.setItem(key, JSON.stringify(serialized));
        } catch (e) {
          console.warn('Failed to persist table selections to localStorage', e);
        }
      } else {
        localStorage.removeItem(key);
      }
    }
  }, [variableTableSelections, keyBase]);

  // Save summary sort selections to localStorage when they change
  useEffect(() => {
    if (keyBase) {
      const key = `summaryTableSortSelections_${keyBase}`;
      const serialized = createSerializedTableSelections(summaryTableSortSelections);
      if (Object.keys(serialized).length > 0) {
        try {
          localStorage.setItem(key, JSON.stringify(serialized));
        } catch (e) {
          console.warn('Failed to persist sort selections to localStorage', e);
        }
      } else {
        localStorage.removeItem(key);
      }
    }
  }, [summaryTableSortSelections, keyBase]);

  // Save sort by frequency to localStorage when it changes
  useEffect(() => {
    if (keyBase) {
      const key = `variableSortByFrequency_${keyBase}`;
      if (Object.keys(variableSortByFrequency).length > 0) {
        try {
          localStorage.setItem(key, JSON.stringify(variableSortByFrequency));
        } catch (e) {
          console.warn('Failed to persist sort frequency to localStorage', e);
        }
      } else {
        localStorage.removeItem(key);
      }
    }
  }, [variableSortByFrequency, keyBase]);

  // Save hold response codes to localStorage when they change
  useEffect(() => {
    if (keyBase) {
      const key = `variableHoldResponseCodes_${keyBase}`;
      if (Object.keys(variableHoldResponseCodes).length > 0) {
        try {
          localStorage.setItem(key, JSON.stringify(variableHoldResponseCodes));
        } catch (e) {
          console.warn('Failed to persist hold codes to localStorage', e);
        }
      } else {
        localStorage.removeItem(key);
      }
    }
  }, [variableHoldResponseCodes, keyBase]);

  const handleToggleIndividualTable = useCallback((variableName: string, tableName: string, allTableNames: string[], initialSelectedNames?: string[]) => {
    if (!variableName || !tableName) return;
    setVariableTableSelections(prev => {
      const currentSet = prev[variableName];
      // Start with empty set if no current selection - no auto-selection
      const baseSet = currentSet ? new Set(currentSet) : new Set<string>();
      if (baseSet.has(tableName)) {
        baseSet.delete(tableName);
      } else {
        baseSet.add(tableName);
      }
      return {
        ...prev,
        [variableName]: baseSet,
      };
    });
  }, []);

  const handleSelectTable = useCallback((variableName: string, tableName: string) => {
    if (!variableName || !tableName) return;
    setVariableTableSelections(prev => {
      return {
        ...prev,
        [variableName]: new Set([tableName]),
      };
    });
  }, []);

  const handleSelectAllIndividualTables = useCallback((variableName: string, individualTableIds: string[], allTableIds: string[]) => {
    if (!variableName) return;
    setVariableTableSelections(prev => {
      const baseSet = prev[variableName] ? new Set(prev[variableName]) : new Set(allTableIds);
      individualTableIds.forEach(id => baseSet.add(id));
      if (baseSet.size === allTableIds.length) {
        const next = { ...prev };
        delete next[variableName];
        return next;
      }
      return {
        ...prev,
        [variableName]: baseSet,
      };
    });
  }, []);

  const handleUnselectAllIndividualTables = useCallback((variableName: string, individualTableIds: string[], allTableIds: string[]) => {
    if (!variableName) return;
    setVariableTableSelections(prev => {
      const baseSet = prev[variableName] ? new Set(prev[variableName]) : new Set(allTableIds);
      individualTableIds.forEach(id => baseSet.delete(id));
      return {
        ...prev,
        [variableName]: baseSet,
      };
    });
  }, []);

  const removeSummarySortSelection = useCallback((variableName: string, tableName: string) => {
    if (!variableName || !tableName) return;
    setSummaryTableSortSelections(prev => {
      const currentSet = prev[variableName];
      if (!currentSet || !currentSet.has(tableName)) return prev;
      const updatedSet = new Set(currentSet);
      updatedSet.delete(tableName);
      const nextState = { ...prev };
      if (updatedSet.size === 0) {
        delete nextState[variableName];
      } else {
        nextState[variableName] = updatedSet;
      }
      return nextState;
    });
  }, []);

  const handleSummaryTableSortToggle = useCallback((variableName: string, tableName: string, defaultOn: boolean) => {
    if (!variableName || !tableName) return;
    setSummaryTableSortSelections(prev => {
      const currentSet = prev[variableName] ? new Set(prev[variableName]) : new Set<string>();
      const isCurrentlyStored = currentSet.has(tableName);
      const isCurrentlyOn = defaultOn ? !isCurrentlyStored : isCurrentlyStored;
      const nextIsOn = !isCurrentlyOn;

      if (defaultOn) {
        if (nextIsOn) {
          currentSet.delete(tableName);
        } else {
          currentSet.add(tableName);
        }
      } else {
        if (nextIsOn) {
          currentSet.add(tableName);
        } else {
          currentSet.delete(tableName);
        }
      }

      const nextState = { ...prev };
      if (currentSet.size === 0) {
        delete nextState[variableName];
      } else {
        nextState[variableName] = currentSet;
      }
      return nextState;
    });
  }, []);

  const handleSortPreferenceChange = useCallback((variableName: string, value: 'default' | 'frequency', persistFalse = false) => {
    if (!variableName) return;
    setVariableSortByFrequency(prev => {
      if (value === 'frequency') {
        return { ...prev, [variableName]: true };
      }
      if (persistFalse) {
        return { ...prev, [variableName]: false };
      }
      const { [variableName]: _removed, ...rest } = prev;
      return rest;
    });
    if (value === 'default') {
      setVariableHoldResponseCodes(prev => {
        if (!(variableName in prev)) {
          return prev;
        }
        const { [variableName]: _removed, ...rest } = prev;
        return rest;
      });
      setHoldOptionsDropdownOpen(prev => {
        if (!(variableName in prev)) {
          return prev;
        }
        const { [variableName]: _removed, ...rest } = prev;
        return rest;
      });
    }
  }, []);

  const handleHoldOptionsToggle = useCallback((variableName: string, enabled: boolean, defaultCodes: string[] = []) => {
    if (!variableName) return;
    setVariableHoldResponseCodes(prev => {
      if (!enabled) {
        const { [variableName]: _removed, ...rest } = prev;
        return rest;
      }
      const existing = prev[variableName];
      if (existing && existing.length > 0) {
        return prev;
      }
      return { ...prev, [variableName]: defaultCodes };
    });
    if (!enabled) {
      setHoldOptionsDropdownOpen(prev => {
        if (!(variableName in prev)) return prev;
        const { [variableName]: _removed, ...rest } = prev;
        return rest;
      });
    }
  }, []);

  const handleHoldOptionSelection = useCallback((variableName: string, code: string) => {
    if (!variableName) return;
    setVariableHoldResponseCodes(prev => {
      const current = prev[variableName] || [];
      const exists = current.includes(code);
      const updated = exists ? current.filter(c => c !== code) : [...current, code];
      return { ...prev, [variableName]: updated };
    });
  }, []);

  const applyHoldOrdering = useCallback((items: any[], variableName: string, getCode: (item: any) => string) => {
    const holdList = variableHoldResponseCodes[variableName];
    if (!holdList || holdList.length === 0) {
      return items;
    }
    const holdSet = new Set(holdList);
    const remaining: any[] = [];
    items.forEach(item => {
      const code = getCode(item);
      if (!holdSet.has(code)) {
        remaining.push(item);
      }
    });
    const held: any[] = [];
    holdList.forEach(code => {
      const match = items.find(item => getCode(item) === code);
      if (match) {
        held.push(match);
      }
    });
    return [...remaining, ...held];
  }, [variableHoldResponseCodes]);

  const openHoldOptionsDropdown = useCallback((variableName: string) => {
    if (!variableName) return;
    setHoldOptionsDropdownOpen(prev => ({ ...prev, [variableName]: true }));
  }, []);

  const closeHoldOptionsDropdown = useCallback((variableName: string) => {
    if (!variableName) return;
    setHoldOptionsDropdownOpen(prev => {
      if (!prev[variableName]) return prev;
      const { [variableName]: _removed, ...rest } = prev;
      return rest;
    });
  }, []);

  return {
    variableTableSelections,
    summaryTableSortSelections,
    variableSortByFrequency,
    variableHoldResponseCodes,
    holdOptionsDropdownOpen,
    handleToggleIndividualTable,
    handleSelectTable,
    handleSelectAllIndividualTables,
    handleUnselectAllIndividualTables,
    removeSummarySortSelection,
    handleSummaryTableSortToggle,
    handleSortPreferenceChange,
    handleHoldOptionsToggle,
    handleHoldOptionSelection,
    applyHoldOrdering,
    openHoldOptionsDropdown,
    closeHoldOptionsDropdown,
    setVariableTableSelections,
    setSummaryTableSortSelections,
    setVariableSortByFrequency,
    setVariableHoldResponseCodes,
  };
};

