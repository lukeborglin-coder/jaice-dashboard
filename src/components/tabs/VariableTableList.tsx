import React from 'react';
import { Variable } from '../../utils/tabs/types';
import { TableOption } from '../../utils/tabs/tableOptions';

interface VariableTableListProps {
  variable: Variable;
  isExpanded: boolean;
  tableOptions: TableOption[];
  onTableClick?: (tableId: string) => void;
}

export const VariableTableList: React.FC<VariableTableListProps> = ({
  variable,
  isExpanded,
  tableOptions,
  onTableClick,
}) => {
  if (!isExpanded || tableOptions.length === 0) {
    return null;
  }

  return (
    <div className="ml-4 mt-1 space-y-1 border-l-2 border-gray-200 pl-3">
      {tableOptions.map((option) => (
        <button
          key={option.id}
          onClick={() => onTableClick?.(option.id)}
          className="w-full text-left px-2 py-1.5 rounded text-xs transition-colors hover:bg-gray-50 text-gray-600"
        >
          <div className="flex items-center gap-2">
            <span className="truncate flex-1">{option.label}</span>
            {option.pill && (
              <span className="text-xs px-2 py-0.5 rounded-full bg-blue-50 text-blue-700 border border-blue-100 flex-shrink-0">
                {option.pill}
              </span>
            )}
            <span className="text-xs text-gray-400 flex-shrink-0">
              {option.type === 'individual' ? 'Individual' : option.type === 'summary' ? 'Summary' : 'Net'}
            </span>
          </div>
        </button>
      ))}
    </div>
  );
};

