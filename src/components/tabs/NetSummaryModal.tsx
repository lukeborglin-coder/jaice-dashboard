import React from 'react';
import { createPortal } from 'react-dom';
import { XMarkIcon } from '@heroicons/react/24/outline';
import { NetSummaryModalState, Variable } from '../../utils/tabs/types';

const BRAND_ORANGE = '#D14A2D';

interface NetSummaryModalProps {
  isOpen: boolean;
  onClose: () => void;
  state: NetSummaryModalState;
  onChange: (field: 'name' | 'low' | 'high', value: string) => void;
  onCodeToggle: (code: string) => void;
  onSave: () => void;
  variable: Variable | null;
}

export const NetSummaryModal: React.FC<NetSummaryModalProps> = ({
  isOpen,
  onClose,
  state,
  onChange,
  onCodeToggle,
  onSave,
  variable,
}) => {
  if (!isOpen) return null;

  const disableNetSummarySave = state.mode === 'range'
    ? (!state.name.trim() || !state.low.trim() || !state.high.trim())
    : (!state.name.trim() || state.selectedCodes.length === 0);

  return createPortal(
    <div className="fixed inset-0 z-[2600] flex items-center justify-center p-4" onClick={onClose}>
      <div className="absolute inset-0 bg-black/40"></div>
      <div
        className="relative z-[2601] bg-white rounded-2xl shadow-2xl w-full max-w-md"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100">
          <div>
            <h4 className="text-sm font-semibold text-gray-900">Define Net Summary Table</h4>
            {state.variableName && (
              <p className="text-xs text-gray-500">Q{state.variableName}</p>
            )}
          </div>
          <button
            type="button"
            className="text-gray-400 hover:text-gray-600"
            onClick={onClose}
          >
            <XMarkIcon className="h-5 w-5" />
          </button>
        </div>
        <div className="px-4 py-4 space-y-4">
          <div>
            <label className="text-xs font-semibold text-gray-700 uppercase tracking-wide">Net name</label>
            <input
              type="text"
              value={state.name}
              onChange={(e) => onChange('name', e.target.value)}
              className="mt-1 w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-orange-500"
              placeholder="Enter net name"
            />
          </div>
          {state.mode === 'range' && (
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="text-xs font-semibold text-gray-700 uppercase tracking-wide">Low</label>
                <input
                  type="text"
                  inputMode="decimal"
                  pattern="[0-9.-]*"
                  value={state.low}
                  onChange={(e) => onChange('low', e.target.value)}
                  className="mt-1 w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm text-center focus:outline-none focus:ring-1 focus:ring-orange-500"
                />
              </div>
              <div>
                <label className="text-xs font-semibold text-gray-700 uppercase tracking-wide">High</label>
                <input
                  type="text"
                  inputMode="decimal"
                  pattern="[0-9.-]*"
                  value={state.high}
                  onChange={(e) => onChange('high', e.target.value)}
                  className="mt-1 w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm text-center focus:outline-none focus:ring-1 focus:ring-orange-500"
                />
              </div>
            </div>
          )}
          {state.mode === 'codes' && (
            <div>
              <label className="text-xs font-semibold text-gray-700 uppercase tracking-wide">Select response options</label>
              <div className="mt-1 max-h-48 overflow-y-auto border border-gray-200 rounded-md divide-y divide-gray-100">
                {state.responseOptions.map(option => {
                  const isChecked = state.selectedCodes.includes(option.code);
                  return (
                    <label
                      key={`${state.variableName}-net-${option.code}`}
                      className="flex items-center gap-2 px-3 py-2 text-sm text-gray-800 hover:bg-gray-50 cursor-pointer"
                    >
                      <input
                        type="checkbox"
                        className="h-4 w-4 rounded border-gray-300 text-orange-600 focus:ring-orange-500"
                        checked={isChecked}
                        onClick={(e) => e.stopPropagation()}
                        onChange={(e) => {
                          e.stopPropagation();
                          onCodeToggle(option.code);
                        }}
                      />
                      <span className="truncate">
                        <span className="font-mono text-xs text-gray-500 mr-2">{option.code}</span>
                        {option.text}
                      </span>
                    </label>
                  );
                })}
                {state.responseOptions.length === 0 && (
                  <div className="px-3 py-2 text-xs text-gray-400">No response options available.</div>
                )}
              </div>
            </div>
          )}
          {state.error && (
            <p className="text-xs text-red-500">{state.error}</p>
          )}
        </div>
        <div className="flex justify-end gap-3 border-t border-gray-100 px-4 py-3">
          <button
            type="button"
            className="px-3 py-1.5 text-xs font-medium text-gray-600 hover:text-gray-800"
            onClick={onClose}
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={disableNetSummarySave}
            className={`inline-flex items-center px-4 py-1.5 rounded-md text-xs font-semibold text-white ${disableNetSummarySave ? 'bg-gray-300 cursor-not-allowed' : ''}`}
            style={!disableNetSummarySave ? { backgroundColor: BRAND_ORANGE } : undefined}
            onClick={onSave}
          >
            Save Net
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
};
