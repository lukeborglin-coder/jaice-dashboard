import React from 'react';
import { createPortal } from 'react-dom';
import { XMarkIcon } from '@heroicons/react/24/outline';
import { VariableStatsSelection, Variable } from '../../utils/tabs/types';
import { 
  getDefaultTableSelectionsForVariable, 
  getDefaultStatsSelectionsForVariable, 
  getDefaultSortAndHoldForVariable 
} from '../../utils/tabs/defaultSelections';

const BRAND_ORANGE = '#D14A2D';

interface SettingsPopupModalProps {
  isOpen: boolean;
  onClose: () => void;
  significanceLevel: 95 | 90;
  onSignificanceLevelChange: (level: 95 | 90) => void;
  percentageDecimals: 0 | 1 | 2;
  onPercentageDecimalsChange: (decimals: 0 | 1 | 2) => void;
  variables: Variable[];
  questionnaireQuestions: any[];
  selectedQuestionnaire: any;
  onResetSpecs: () => void;
}

export const SettingsPopupModal: React.FC<SettingsPopupModalProps> = ({
  isOpen,
  onClose,
  significanceLevel,
  onSignificanceLevelChange,
  percentageDecimals,
  onPercentageDecimalsChange,
  variables,
  questionnaireQuestions,
  selectedQuestionnaire,
  onResetSpecs,
}) => {
  if (!isOpen) return null;

  return createPortal(
    <div 
      className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50"
      onClick={onClose}
    >
      <div 
        className="bg-white rounded-lg shadow-xl max-w-md w-full mx-4 p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-xl font-semibold text-gray-900">Table Settings</h2>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 transition-colors"
          >
            <XMarkIcon className="h-6 w-6" />
          </button>
        </div>

        <div className="space-y-6">
          {/* Significance Level Setting */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Significance Level for Statistical Testing
            </label>
            <div className="flex gap-4">
              <label className="flex items-center">
                <input
                  type="radio"
                  name="significanceLevel"
                  value="95"
                  checked={significanceLevel === 95}
                  onChange={() => onSignificanceLevelChange(95)}
                  className="mr-2"
                />
                <span className="text-sm text-gray-700">95%</span>
              </label>
              <label className="flex items-center">
                <input
                  type="radio"
                  name="significanceLevel"
                  value="90"
                  checked={significanceLevel === 90}
                  onChange={() => onSignificanceLevelChange(90)}
                  className="mr-2"
                />
                <span className="text-sm text-gray-700">90%</span>
              </label>
            </div>
          </div>

          {/* Decimal Places Setting */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Decimal Places for Percentages
            </label>
            <select
              value={percentageDecimals}
              onChange={(e) => onPercentageDecimalsChange(Number(e.target.value) as 0 | 1 | 2)}
              className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-500"
            >
              <option value={0}>0 decimals</option>
              <option value={1}>1 decimal</option>
              <option value={2}>2 decimals</option>
            </select>
          </div>

          {/* Reset Specs Button */}
          <div className="pt-4 border-t border-gray-200">
            <button
              onClick={onResetSpecs}
              className="w-full px-4 py-2 text-sm font-medium text-white rounded-lg transition-colors hover:opacity-90"
              style={{ backgroundColor: BRAND_ORANGE }}
            >
              Reset All Specs to Defaults
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
};

