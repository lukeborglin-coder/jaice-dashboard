import { useState, useCallback } from 'react';
import { NetRange, NetCodeSelection, NetSummaryModalState, NET_SUMMARY_MODAL_DEFAULT } from '../utils/tabs/types';

export const useSummaryNets = () => {
  const [netSummaryTableRanges, setNetSummaryTableRanges] = useState<Record<string, NetRange[]>>({});
  const [netSummaryTableSelectedCodes, setNetSummaryTableSelectedCodes] = useState<Record<string, NetCodeSelection[]>>({});
  const [netSummaryModalState, setNetSummaryModalState] = useState<NetSummaryModalState>(NET_SUMMARY_MODAL_DEFAULT);
  const [tempNetRanges, setTempNetRanges] = useState<Record<string, NetRange[]>>({});
  const [tempNetCodes, setTempNetCodes] = useState<Record<string, NetCodeSelection[]>>({});

  const handleAddInlineNumericNet = useCallback((variableName: string) => {
    if (!variableName) return;
    setNetSummaryTableRanges(prev => {
      const existing = prev[variableName] || [];
      return {
        ...prev,
        [variableName]: [...existing, { name: '', low: '', high: '', context: 'stats' }],
      };
    });
  }, []);

  const handleUpdateInlineNumericNet = useCallback((variableName: string, globalIndex: number, key: 'name' | 'low' | 'high', value: string) => {
    if (!variableName) return;
    setNetSummaryTableRanges(prev => {
      const existing = prev[variableName] || [];
      if (!existing[globalIndex]) return prev;
      const updated = [...existing];
      updated[globalIndex] = { ...updated[globalIndex], [key]: value };
      const lowVal = parseFloat(updated[globalIndex].low);
      const highVal = parseFloat(updated[globalIndex].high);
      if (!isNaN(lowVal) && !isNaN(highVal) && lowVal > highVal) {
        if (key === 'low') {
          updated[globalIndex].high = updated[globalIndex].low;
        } else if (key === 'high') {
          updated[globalIndex].low = updated[globalIndex].high;
        }
      }
      return {
        ...prev,
        [variableName]: updated,
      };
    });
  }, []);

  const handleRemoveInlineNumericNet = useCallback((variableName: string, globalIndex: number) => {
    if (!variableName) return;
    setNetSummaryTableRanges(prev => {
      const existing = prev[variableName] || [];
      if (!existing[globalIndex]) return prev;
      const updated = existing.filter((_, idx) => idx !== globalIndex);
      return {
        ...prev,
        [variableName]: updated,
      };
    });
  }, []);

  const openNetSummaryModal = useCallback((variableName: string, config?: {
    mode?: 'range' | 'codes';
    responseOptions?: Array<{ code: string; text: string }>;
    initialName?: string;
    initialLow?: string;
    initialHigh?: string;
    initialCodes?: string[];
    editingIndex?: number | null;
  }) => {
    if (!variableName) return;
    setNetSummaryModalState({
      ...NET_SUMMARY_MODAL_DEFAULT,
      variableName,
      isOpen: true,
      mode: config?.mode ?? 'range',
      responseOptions: config?.responseOptions ?? [],
      name: config?.initialName ?? '',
      low: config?.initialLow ?? '',
      high: config?.initialHigh ?? '',
      selectedCodes: config?.initialCodes ?? [],
      editingIndex: config?.editingIndex ?? null,
    });
  }, []);

  const closeNetSummaryModal = useCallback(() => {
    setNetSummaryModalState({ ...NET_SUMMARY_MODAL_DEFAULT });
  }, []);

  const handleNetSummaryModalFieldChange = useCallback((field: 'name' | 'low' | 'high', value: string) => {
    setNetSummaryModalState(prev => ({
      ...prev,
      [field]: field === 'name' ? value : value.replace(/[^0-9.-]/g, ''),
      error: undefined,
    }));
  }, []);

  const handleNetSummaryModalCodeToggle = useCallback((code: string) => {
    setNetSummaryModalState(prev => {
      const exists = prev.selectedCodes.includes(code);
      const updatedCodes = exists
        ? prev.selectedCodes.filter(c => c !== code)
        : [...prev.selectedCodes, code];
      return {
        ...prev,
        selectedCodes: updatedCodes,
        error: undefined,
      };
    });
  }, []);

  const handleEditNetSummary = useCallback((variableName: string, netMeta: { type: 'range' | 'codes'; index: number }, responseOptions: Array<{ code: string; text: string }>) => {
    if (!variableName) return;
    if (netMeta.type === 'range') {
      const net = netSummaryTableRanges[variableName]?.[netMeta.index];
      if (!net) return;
      openNetSummaryModal(variableName, {
        mode: 'range',
        initialName: net.name || '',
        initialLow: net.low || '',
        initialHigh: net.high || '',
        editingIndex: netMeta.index,
      });
    } else {
      const net = netSummaryTableSelectedCodes[variableName]?.[netMeta.index];
      if (!net) return;
      openNetSummaryModal(variableName, {
        mode: 'codes',
        responseOptions,
        initialName: net.name || '',
        initialCodes: net.codes || [],
        editingIndex: netMeta.index,
      });
    }
  }, [netSummaryTableRanges, netSummaryTableSelectedCodes, openNetSummaryModal]);

  const handleNetSummaryModalSave = useCallback(() => {
    const { variableName, name, low, high, mode, selectedCodes, editingIndex } = netSummaryModalState;
    if (!variableName) {
      closeNetSummaryModal();
      return;
    }
    const trimmedName = name.trim();
    const trimmedLow = low.trim();
    const trimmedHigh = high.trim();
    if (mode === 'codes') {
      if (!trimmedName) {
        setNetSummaryModalState(prev => ({ ...prev, error: 'Enter a net name.' }));
        return;
      }
      if (selectedCodes.length === 0) {
        setNetSummaryModalState(prev => ({ ...prev, error: 'Select at least one response option.' }));
        return;
      }
      if (editingIndex !== null) {
        setNetSummaryTableSelectedCodes(prev => {
          const existing = prev[variableName] || [];
          if (!existing[editingIndex]) return prev;
          const updated = [...existing];
          updated[editingIndex] = {
            ...updated[editingIndex],
            name: trimmedName,
            codes: selectedCodes,
          };
          return { ...prev, [variableName]: updated };
        });
      } else {
        setNetSummaryTableSelectedCodes(prev => {
          const existing = prev[variableName] || [];
          return {
            ...prev,
            [variableName]: [...existing, { name: trimmedName, codes: selectedCodes }],
          };
        });
      }
    } else {
      if (!trimmedName) {
        setNetSummaryModalState(prev => ({ ...prev, error: 'Enter a net name.' }));
        return;
      }
      if (!trimmedLow || !trimmedHigh) {
        setNetSummaryModalState(prev => ({ ...prev, error: 'Enter both low and high values.' }));
        return;
      }
      const lowNum = parseFloat(trimmedLow);
      const highNum = parseFloat(trimmedHigh);
      if (isNaN(lowNum) || isNaN(highNum)) {
        setNetSummaryModalState(prev => ({ ...prev, error: 'Low and high must be valid numbers.' }));
        return;
      }
      if (lowNum > highNum) {
        setNetSummaryModalState(prev => ({ ...prev, error: 'Low value must be less than or equal to high value.' }));
        return;
      }
      if (editingIndex !== null) {
        setNetSummaryTableRanges(prev => {
          const existing = prev[variableName] || [];
          if (!existing[editingIndex]) return prev;
          const updated = [...existing];
          updated[editingIndex] = {
            ...updated[editingIndex],
            name: trimmedName,
            low: trimmedLow,
            high: trimmedHigh,
          };
          return { ...prev, [variableName]: updated };
        });
      } else {
        setNetSummaryTableRanges(prev => {
          const existing = prev[variableName] || [];
          return {
            ...prev,
            [variableName]: [...existing, { name: trimmedName, low: trimmedLow, high: trimmedHigh, context: 'summary' }],
          };
        });
      }
    }
    closeNetSummaryModal();
  }, [netSummaryModalState, closeNetSummaryModal]);

  return {
    netSummaryTableRanges,
    netSummaryTableSelectedCodes,
    netSummaryModalState,
    tempNetRanges,
    tempNetCodes,
    handleAddInlineNumericNet,
    handleUpdateInlineNumericNet,
    handleRemoveInlineNumericNet,
    openNetSummaryModal,
    closeNetSummaryModal,
    handleNetSummaryModalFieldChange,
    handleNetSummaryModalCodeToggle,
    handleEditNetSummary,
    handleNetSummaryModalSave,
    setNetSummaryTableRanges,
    setNetSummaryTableSelectedCodes,
    setNetSummaryModalState,
    setTempNetRanges,
    setTempNetCodes,
  };
};


