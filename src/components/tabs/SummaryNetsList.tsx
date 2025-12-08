import React from 'react';
import { NetRange, NetCodeSelection } from '../../utils/tabs/types';
import { XMarkIcon } from '@heroicons/react/24/outline';

const BRAND_ORANGE = '#D14A2D';

interface SummaryNetsListProps {
  variableName: string;
  ranges: NetRange[];
  codeSelections: NetCodeSelection[];
  onAddRange?: () => void;
  onAddCode?: () => void;
  onEditRange?: (index: number) => void;
  onEditCode?: (index: number) => void;
  onDeleteRange?: (index: number) => void;
  onDeleteCode?: (index: number) => void;
  onUpdateRange?: (index: number, field: 'name' | 'low' | 'high', value: string) => void;
  responseOptions?: Array<{ code: string; text: string }>;
  isNumericQuestion?: boolean;
  isNumericGrid?: boolean;
  isSingleSelectGrid?: boolean;
  isSingleSelect?: boolean;
}

export const SummaryNetsList: React.FC<SummaryNetsListProps> = ({
  variableName,
  ranges,
  codeSelections,
  onAddRange,
  onAddCode,
  onEditRange,
  onEditCode,
  onDeleteRange,
  onDeleteCode,
  onUpdateRange,
  responseOptions = [],
  isNumericQuestion = false,
  isNumericGrid = false,
  isSingleSelectGrid = false,
  isSingleSelect = false,
}) => {
  // For numeric questions/grids, show ranges in a table
  if ((isNumericQuestion || isNumericGrid) && ranges.length > 0) {
    return (
      <div className="mt-4 border-t border-gray-200 pt-4 space-y-3">
        <div className="flex items-center justify-between">
          <h5 className="text-sm font-semibold text-gray-900">Nets</h5>
          {onAddRange && (
            <button
              type="button"
              onClick={onAddRange}
              className="text-sm font-medium text-orange-600 hover:text-orange-700"
            >
              + Net
            </button>
          )}
        </div>
        {ranges.length === 0 ? (
          <p className="text-xs text-gray-500">No nets defined. Click + Net to create one.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full border border-gray-200 text-sm">
              <thead className="bg-gray-50 text-xs font-semibold text-gray-600">
                <tr>
                  <th className="py-2 px-3 text-left border-b border-gray-200">Net Name</th>
                  <th className="py-2 px-3 text-center border-b border-gray-200 w-16">Low</th>
                  <th className="py-2 px-3 text-center border-b border-gray-200 w-16">High</th>
                  <th className="py-2 text-center border-b border-gray-200 w-12"> </th>
                </tr>
              </thead>
              <tbody>
                {ranges.map((net, idx) => (
                  <tr key={`${variableName}-net-${idx}`}>
                    <td className="py-2 px-3 border-b border-gray-200">
                      {onUpdateRange ? (
                        <input
                          type="text"
                          value={net.name}
                          onChange={(e) => onUpdateRange(idx, 'name', e.target.value)}
                          className="w-full border border-gray-300 rounded-md px-2 py-1 text-sm focus:outline-none focus:ring-1 focus:ring-orange-500"
                        />
                      ) : (
                        <span>{net.name || `Net ${idx + 1}`}</span>
                      )}
                    </td>
                    <td className="py-2 px-2 border-b border-gray-200 text-center">
                      {onUpdateRange ? (
                        <input
                          type="text"
                          inputMode="decimal"
                          pattern="[0-9.-]*"
                          value={net.low}
                          onChange={(e) => onUpdateRange(idx, 'low', e.target.value.replace(/[^0-9.-]/g, ''))}
                          className="w-16 border border-gray-300 rounded-md px-2 py-1 text-sm text-center focus:outline-none focus:ring-1 focus:ring-orange-500"
                        />
                      ) : (
                        <span>{net.low}</span>
                      )}
                    </td>
                    <td className="py-2 px-2 border-b border-gray-200 text-center">
                      {onUpdateRange ? (
                        <input
                          type="text"
                          inputMode="decimal"
                          pattern="[0-9.-]*"
                          value={net.high}
                          onChange={(e) => onUpdateRange(idx, 'high', e.target.value.replace(/[^0-9.-]/g, ''))}
                          className="w-16 border border-gray-300 rounded-md px-2 py-1 text-sm text-center focus:outline-none focus:ring-1 focus:ring-orange-500"
                        />
                      ) : (
                        <span>{net.high}</span>
                      )}
                    </td>
                    <td className="py-2 border-b border-gray-200 text-center">
                      {onDeleteRange && (
                        <button
                          type="button"
                          className="inline-flex items-center justify-center text-red-500 hover:text-red-600"
                          onClick={() => onDeleteRange(idx)}
                        >
                          <XMarkIcon className="h-4 w-4" />
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    );
  }

  // For single select grids and single select questions, show code selections
  if ((isSingleSelectGrid || isSingleSelect) && codeSelections.length > 0) {
    return (
      <div className="mt-4 border-t border-gray-200 pt-4 space-y-2">
        <div className="flex items-center justify-between">
          <h5 className="text-sm font-semibold text-gray-900">
            {isSingleSelectGrid ? 'Nets' : 'Pre-made Nets'}
          </h5>
          {onAddCode && (
            <button
              type="button"
              className="text-xs font-semibold"
              style={{ color: BRAND_ORANGE }}
              onClick={onAddCode}
            >
              + Add Net
            </button>
          )}
        </div>
        {codeSelections.length === 0 ? (
          <p className="text-xs text-gray-500">No nets defined. Click + Add Net to create one.</p>
        ) : (
          <div className="space-y-2">
            {codeSelections.map((net, idx) => {
              const codesDisplay = Array.isArray(net.codes) && net.codes.length > 0
                ? net.codes.join(', ')
                : 'No codes selected';
              return (
                <div
                  key={`${variableName}-premade-net-${idx}`}
                  className="flex flex-col gap-1 rounded-lg border border-dashed border-gray-200 px-3 py-2 text-sm bg-gray-50"
                >
                  <div className="flex items-center gap-3">
                    <span className="truncate font-medium">{net.name || `Net ${idx + 1}`}</span>
                    {onEditCode && (
                      <button
                        type="button"
                        className="text-xs text-blue-600 hover:underline ml-auto"
                        onClick={() => onEditCode(idx)}
                      >
                        Edit
                      </button>
                    )}
                    {onDeleteCode && (
                      <button
                        type="button"
                        className="text-xs text-red-600 hover:underline"
                        onClick={() => onDeleteCode(idx)}
                      >
                        Delete
                      </button>
                    )}
                  </div>
                  <span className="text-xs text-gray-500">Codes: {codesDisplay}</span>
                </div>
              );
            })}
          </div>
        )}
      </div>
    );
  }

  return null;
};
