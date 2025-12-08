import React, { useState, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { XMarkIcon, MagnifyingGlassIcon } from '@heroicons/react/24/outline';

const BRAND_ORANGE = '#D14A2D';

interface ManualMappingModalProps {
  isOpen: boolean;
  onClose: () => void;
  selectedHeader: string | null;
  columnHeaders: string[];
  searchValue: string;
  onSearchChange: (value: string) => void;
  onSelect: (expectedHeader: string, columnHeader: string) => void;
  onUnmap?: (expectedHeader: string) => void;
  existingMapping?: Record<string, string>;
}

export const ManualMappingModal: React.FC<ManualMappingModalProps> = ({
  isOpen,
  onClose,
  selectedHeader,
  columnHeaders,
  searchValue,
  onSearchChange,
  onSelect,
  onUnmap,
  existingMapping = {},
}) => {
  const [localSearch, setLocalSearch] = useState(searchValue);

  // Filter column headers based on search
  const filteredHeaders = useMemo(() => {
    if (!localSearch.trim()) {
      return columnHeaders;
    }
    const searchLower = localSearch.toLowerCase().trim();
    return columnHeaders.filter(header => 
      String(header).toLowerCase().includes(searchLower)
    );
  }, [columnHeaders, localSearch]);

  const handleSearchChange = (value: string) => {
    setLocalSearch(value);
    onSearchChange(value);
  };

  const handleSelect = (columnHeader: string) => {
    if (selectedHeader) {
      onSelect(selectedHeader, columnHeader);
      onClose();
    }
  };

  const handleUnmap = () => {
    if (selectedHeader && onUnmap) {
      onUnmap(selectedHeader);
      onClose();
    }
  };

  const currentMapping = selectedHeader ? (existingMapping[selectedHeader] || existingMapping[selectedHeader.replace(/^Q/, '')] || '') : '';

  if (!isOpen || !selectedHeader) return null;

  return createPortal(
    <div className="fixed inset-0 z-[2600] flex items-center justify-center p-4" onClick={onClose}>
      <div className="absolute inset-0 bg-black/40"></div>
      <div
        className="relative z-[2601] bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[80vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200">
          <div>
            <h4 className="text-lg font-semibold text-gray-900">Map Variable to Column Header</h4>
            <p className="text-sm text-gray-500 mt-1">
              Select a column header from your data file to map to: <span className="font-medium text-gray-900">{selectedHeader}</span>
              {currentMapping && (
                <span className="block mt-1 text-xs text-gray-600">Currently mapped to: <span className="font-medium">{currentMapping}</span></span>
              )}
            </p>
          </div>
          <button
            type="button"
            className="text-gray-400 hover:text-gray-600 transition-colors"
            onClick={onClose}
          >
            <XMarkIcon className="h-6 w-6" />
          </button>
        </div>

        <div className="flex-1 overflow-hidden flex flex-col px-6 py-4">
          <div className="relative mb-4">
            <MagnifyingGlassIcon className="absolute left-3 top-1/2 transform -translate-y-1/2 h-5 w-5 text-gray-400" />
            <input
              type="text"
              placeholder="Search column headers..."
              value={localSearch}
              onChange={(e) => handleSearchChange(e.target.value)}
              className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-orange-500 focus:border-transparent"
              autoFocus
            />
          </div>

          <div className="flex-1 overflow-y-auto border border-gray-200 rounded-lg">
            {filteredHeaders.length > 0 ? (
              <div className="divide-y divide-gray-200">
                {filteredHeaders.map((header, idx) => {
                  const isMapped = Object.values(existingMapping).includes(header);
                  const mappedTo = Object.entries(existingMapping).find(([_, val]) => val === header)?.[0];
                  const isCurrentMapping = header === currentMapping;
                  
                  return (
                    <button
                      key={idx}
                      onClick={() => handleSelect(header)}
                      disabled={isMapped && mappedTo !== selectedHeader}
                      className={`w-full px-4 py-3 text-left transition-colors ${
                        isCurrentMapping
                          ? 'bg-green-50 border-l-4 border-green-500 cursor-pointer'
                          : isMapped && mappedTo !== selectedHeader
                          ? 'opacity-50 cursor-not-allowed bg-gray-50'
                          : 'hover:bg-gray-50 cursor-pointer'
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <span className={`text-sm font-medium ${isCurrentMapping ? 'text-green-900' : 'text-gray-900'}`}>
                          {header}
                          {isCurrentMapping && <span className="ml-2 text-xs text-green-600">(Current mapping)</span>}
                        </span>
                        {isMapped && mappedTo !== selectedHeader && !isCurrentMapping && (
                          <span className="text-xs text-gray-500 italic">Already mapped to {mappedTo}</span>
                        )}
                      </div>
                    </button>
                  );
                })}
              </div>
            ) : (
              <div className="px-4 py-8 text-center text-sm text-gray-500">
                No column headers found matching "{localSearch}"
              </div>
            )}
          </div>
        </div>

        <div className="px-6 py-4 border-t border-gray-200 flex justify-between items-center">
          <div>
            {currentMapping && onUnmap && (
              <button
                type="button"
                onClick={handleUnmap}
                className="px-4 py-2 text-sm font-medium text-red-700 bg-white border border-red-300 rounded-lg hover:bg-red-50 transition-colors"
              >
                Unmap
              </button>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
};

