import { useState, useCallback, useEffect } from 'react';
import { VariableStatsSelection, createDefaultStatsSelection } from '../utils/tabs/types';

interface UseStatsSelectionsProps {
  storageKey?: string;
  selectedQuestionnaireId?: string;
}

export const useStatsSelections = (props?: UseStatsSelectionsProps) => {
  const { selectedQuestionnaireId, storageKey } = props || {};
  const keyBase = storageKey || selectedQuestionnaireId;
  const [variableStatsSelections, setVariableStatsSelections] = useState<Record<string, VariableStatsSelection>>({});
  const [singleSelectSort, setSingleSelectSort] = useState<Record<string, { column: 'code' | 'count' | 'percentage', direction: 'asc' | 'desc' }>>({});

  // Load stats selections from localStorage when questionnaire changes
  useEffect(() => {
    if (keyBase) {
      const key = `variableStatsSelections_${keyBase}`;
      const stored = localStorage.getItem(key);
      if (stored) {
        try {
          const parsed = JSON.parse(stored);
          setVariableStatsSelections(parsed || {});
        } catch (e) {
          setVariableStatsSelections({});
        }
      } else {
        setVariableStatsSelections({});
      }
    } else {
      setVariableStatsSelections({});
    }
  }, [keyBase]);

  // Save stats selections to localStorage when they change
  useEffect(() => {
    if (keyBase && Object.keys(variableStatsSelections).length > 0) {
      const key = `variableStatsSelections_${keyBase}`;
      try {
        localStorage.setItem(key, JSON.stringify(variableStatsSelections));
      } catch (e) {
        console.warn('Failed to persist stats selections to localStorage', e);
      }
    } else if (keyBase && Object.keys(variableStatsSelections).length === 0) {
      // Clear localStorage if selections are empty
      const key = `variableStatsSelections_${keyBase}`;
      localStorage.removeItem(key);
    }
  }, [variableStatsSelections, keyBase]);

  const getStatsSelectionsForVariable = useCallback((variableName: string): VariableStatsSelection => {
    if (!variableName) return createDefaultStatsSelection();
    const current = variableStatsSelections[variableName];
    if (!current) {
      return createDefaultStatsSelection();
    }
    return { ...createDefaultStatsSelection(), ...current };
  }, [variableStatsSelections]);

  const handleToggleStatSelection = useCallback((variableName: string, key: keyof VariableStatsSelection) => {
    if (!variableName) return;
    setVariableStatsSelections(prev => {
      const existing = prev[variableName];
      const merged = existing ? { ...createDefaultStatsSelection(), ...existing } : createDefaultStatsSelection();
      const updatedValue = !merged[key];
      const updatedSelection = { ...merged, [key]: updatedValue };
      return {
        ...prev,
        [variableName]: updatedSelection,
      };
    });
  }, []);

  return {
    variableStatsSelections,
    singleSelectSort,
    getStatsSelectionsForVariable,
    handleToggleStatSelection,
    setVariableStatsSelections,
    setSingleSelectSort,
  };
};

