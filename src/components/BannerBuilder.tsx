import React, { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { XMarkIcon, PlusIcon, TrashIcon, ChevronDownIcon, MagnifyingGlassIcon } from '@heroicons/react/24/outline';
import { type ParsedDataFile } from '../utils/dataTabulationHelpers';
import { type BannerGroup, type BannerCut, type BannerSubGroup } from '../types/dataTabulation';

const BRAND_ORANGE = '#D14A2D';

interface BannerBuilderProps {
  variables: any[]; // Variables directly from Variables tab
  onSave: (group: BannerGroup) => void;
  onCancel: () => void;
  editingGroup?: BannerGroup | null;
  existingBannerCount?: number; // Number of existing banners to generate "Banner N" title
}

const BannerBuilder: React.FC<BannerBuilderProps> = ({ variables, onSave, onCancel, editingGroup, existingBannerCount = 0 }) => {
  const [confidenceLevel, setConfidenceLevel] = useState<95 | 90 | 80>(editingGroup?.confidenceLevel || 95);
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
  const [openDropdown, setOpenDropdown] = useState<string | null>(null);
  const dropdownRefs = useRef<{ [key: string]: HTMLDivElement | null }>({});
  const buttonRefs = useRef<{ [key: string]: HTMLButtonElement | null }>({});
  const [dropdownPosition, setDropdownPosition] = useState<{ [key: string]: { top: number; left: number; width: number; maxHeight: number } }>({});
  const [searchTerm, setSearchTerm] = useState<string>('');

  // Filter for variables that have codes (categorical variables)
  const categoricalVariables = variables.filter(v =>
    v.codes && Object.keys(v.codes).length > 0
  );

  // Close dropdown when clicking outside and update position on scroll/resize
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (openDropdown) {
        const dropdownElement = dropdownRefs.current[openDropdown];
        const buttonElement = buttonRefs.current[openDropdown];
        if (
          dropdownElement && 
          !dropdownElement.contains(event.target as Node) &&
          buttonElement &&
          !buttonElement.contains(event.target as Node)
        ) {
          setOpenDropdown(null);
        }
      }
    };

    const updatePosition = () => {
      if (openDropdown) {
        const button = buttonRefs.current[openDropdown];
        if (button) {
          const rect = button.getBoundingClientRect();
          const viewportHeight = window.innerHeight;
          const availableSpace = viewportHeight - rect.bottom - 8; // 8px gap below button
          const maxHeight = Math.max(200, availableSpace - 20); // Minimum 200px, with 20px padding from bottom
          
          setDropdownPosition(prev => ({
            ...prev,
            [openDropdown]: {
              top: rect.bottom + 8,
              left: rect.left,
              width: rect.width,
              maxHeight: maxHeight
            }
          }));
        }
      }
    };

    if (openDropdown) {
      document.addEventListener('mousedown', handleClickOutside);
      window.addEventListener('scroll', updatePosition, true);
      window.addEventListener('resize', updatePosition);
      return () => {
        document.removeEventListener('mousedown', handleClickOutside);
        window.removeEventListener('scroll', updatePosition, true);
        window.removeEventListener('resize', updatePosition);
      };
    }
  }, [openDropdown]);

  const getDropdownKey = (subGroupId: string, cutId: string) => `${subGroupId}-${cutId}`;

  const toggleDropdown = (subGroupId: string, cutId: string) => {
    const key = getDropdownKey(subGroupId, cutId);
    if (openDropdown === key) {
      setOpenDropdown(null);
      setSearchTerm(''); // Reset search when closing
    } else {
      const button = buttonRefs.current[key];
      if (button) {
        const rect = button.getBoundingClientRect();
        const viewportHeight = window.innerHeight;
        const availableSpace = viewportHeight - rect.bottom - 8; // 8px gap below button
        const maxHeight = Math.max(200, availableSpace - 20); // Minimum 200px, with 20px padding from bottom
        
        setDropdownPosition({
          ...dropdownPosition,
          [key]: {
            top: rect.bottom + 8, // 8px gap below button
            left: rect.left,
            width: rect.width,
            maxHeight: maxHeight
          }
        });
      }
      setOpenDropdown(key);
      setSearchTerm(''); // Reset search when opening
    }
  };

  const selectVariable = (subGroupId: string, cutId: string, variableName: string) => {
    updateCut(subGroupId, cutId, { variableName, codes: [] });
    setOpenDropdown(null);
    setSearchTerm(''); // Reset search when selecting
  };

  // Filter variables based on search term
  const filteredVariables = searchTerm.trim() === '' 
    ? categoricalVariables 
    : categoricalVariables.filter(v => 
        v.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
        (v.description && v.description.toLowerCase().includes(searchTerm.toLowerCase()))
      );

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

  const addCut = (subGroupId: string, afterCutIndex?: number) => {
    setSubGroups(subGroups.map(g => {
      if (g.id === subGroupId) {
        const newCut = { id: `${Date.now()}-${g.cuts.length + 1}`, title: '', variableName: '', codes: [] };
        if (afterCutIndex !== undefined && afterCutIndex >= 0) {
          // Insert after the specified cut index
          const newCuts = [...g.cuts];
          newCuts.splice(afterCutIndex + 1, 0, newCut);
          return { ...g, cuts: newCuts };
        } else {
          // Add to the end (fallback)
          return { ...g, cuts: [...g.cuts, newCut] };
        }
      }
      return g;
    }));
  };

  const removeCut = (subGroupId: string, cutId: string) => {
    setSubGroups(subGroups.map(g => {
      if (g.id === subGroupId && g.cuts.length > 2) {
        const newCuts = g.cuts.filter(c => c.id !== cutId);
        // Ensure minimum of 2 cuts
        if (newCuts.length >= 2) {
          return { ...g, cuts: newCuts };
        }
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

  const handleSave = () => {
    // Auto-generate title: "Banner 1", "Banner 2", etc.
    const generatedTitle = editingGroup?.title || `Banner ${existingBannerCount + 1}`;

    const group: BannerGroup = {
      id: editingGroup?.id || Date.now().toString(),
      title: generatedTitle,
      confidenceLevel,
      groups: subGroups
    };

    onSave(group);
  };

  return (
    <div className="flex flex-col h-full bg-white">
      {/* Header */}
      <div className="flex items-center justify-between p-4 border-b border-gray-200">
        <h2 className="text-xl font-semibold text-gray-900">
          {editingGroup ? 'Edit Banner Group' : 'Create Banner Group'}
        </h2>
        <button onClick={onCancel} className="text-gray-400 hover:text-gray-600">
          <XMarkIcon className="h-6 w-6" />
        </button>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-6">

        {/* Sub-Groups */}
        <div className="mb-4">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-3">
              <h3 className="text-lg font-medium text-gray-900">Sub-Groups</h3>
              <select
                value={confidenceLevel}
                onChange={(e) => setConfidenceLevel(Number(e.target.value) as 95 | 90 | 80)}
                className="px-3 py-1.5 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-[#D14A2D] focus:border-[#D14A2D]"
              >
                <option value={95}>95% Confidence</option>
                <option value={90}>90% Confidence</option>
                <option value={80}>80% Confidence</option>
              </select>
            </div>
            <button
              onClick={addSubGroup}
              className="flex items-center gap-2 px-3 py-1.5 text-sm text-[#D14A2D] hover:bg-orange-50 rounded-lg"
            >
              <PlusIcon className="h-4 w-4" />
              Add Sub-Group
            </button>
          </div>

          {subGroups.map((subGroup, subGroupIndex) => (
            <div key={subGroup.id} className="mb-6">
              <div className="flex items-center justify-end mb-2">
                {subGroups.length > 1 && (
                  <button
                    onClick={() => removeSubGroup(subGroup.id)}
                    className="p-2 text-red-600 hover:bg-red-50 rounded-lg"
                    title="Remove sub-group"
                  >
                    <TrashIcon className="h-5 w-5" />
                  </button>
                )}
              </div>

              {/* Cuts - Displayed as table matching final banner format */}
              <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="min-w-full divide-y divide-gray-200">
                      <thead className="bg-gray-50">
                        {/* Subgroup title row - merged across all cuts */}
                        <tr>
                          <th 
                            colSpan={subGroup.cuts.length}
                            className="px-3 py-2 text-xs font-bold text-gray-900 uppercase tracking-wider text-center border-r border-gray-300 border-b border-gray-300"
                          >
                            <div className="relative flex items-center justify-center px-2">
                              {subGroups.length > 1 && (
                                <button
                                  onClick={() => removeSubGroup(subGroup.id)}
                                  className="absolute left-2 text-gray-500 hover:text-red-600 p-1 rounded transition-colors z-10"
                                  title="Remove sub-group"
                                >
                                  <XMarkIcon className="h-4 w-4" />
                                </button>
                              )}
                              <input
                                type="text"
                                value={subGroup.title}
                                onChange={(e) => updateSubGroup(subGroup.id, { title: e.target.value })}
                                placeholder={`Sub-Group ${subGroupIndex + 1} Title`}
                                className="flex-1 max-w-[90%] px-2 py-1 text-xs font-bold border border-gray-300 rounded focus:ring-2 focus:ring-[#D14A2D] focus:border-[#D14A2D] text-center bg-transparent"
                              />
                            </div>
                          </th>
                        </tr>
                        {/* Cut titles row */}
                        <tr>
                          {subGroup.cuts.map((cut, cutIndex) => {
                            const statLetter = String.fromCharCode(65 + cutIndex); // A, B, C, etc.
                            return (
                              <th key={cut.id} className="px-3 py-2 text-xs font-medium text-gray-700 uppercase tracking-wider text-center border-r border-gray-300 relative" style={{ width: `${100 / subGroup.cuts.length}%` }}>
                                <div className="flex flex-col items-center gap-1">
                                  <div className="relative flex items-center justify-center w-full px-2">
                                    {subGroup.cuts.length > 2 && (
                                      <button
                                        onClick={() => removeCut(subGroup.id, cut.id)}
                                        className="absolute left-2 text-gray-500 hover:text-red-600 p-1 rounded transition-colors z-10"
                                        title="Remove cut"
                                      >
                                        <XMarkIcon className="h-4 w-4" />
                                      </button>
                                    )}
                                    <input
                                      type="text"
                                      value={cut.title}
                                      onChange={(e) => updateCut(subGroup.id, cut.id, { title: e.target.value })}
                                      placeholder={`Cut ${cutIndex + 1} Title`}
                                      className="flex-1 max-w-[85%] px-2 py-1 text-xs border border-gray-300 rounded focus:ring-2 focus:ring-[#D14A2D] focus:border-[#D14A2D] text-center"
                                    />
                                    <button
                                      onClick={() => addCut(subGroup.id, cutIndex)}
                                      className="absolute right-2 text-gray-500 hover:text-[#D14A2D] p-1 rounded transition-colors z-10"
                                      title="Add cut after this one"
                                    >
                                      <PlusIcon className="h-4 w-4" />
                                    </button>
                                  </div>
                                  <span className="text-xs font-semibold text-gray-600">({statLetter})</span>
                                </div>
                              </th>
                            );
                          })}
                        </tr>
                      </thead>
                      <tbody className="bg-white divide-y divide-gray-200">
                        {/* Variable Selection Row */}
                        <tr>
                          {subGroup.cuts.map((cut) => {
                            const dropdownKey = getDropdownKey(subGroup.id, cut.id);
                            const isOpen = openDropdown === dropdownKey;
                            const selectedVariable = categoricalVariables.find(v => v.name === cut.variableName);
                            const displayText = selectedVariable 
                              ? `${selectedVariable.name}${selectedVariable.description ? ` - ${selectedVariable.description}` : ''}`
                              : 'Select Variable';

                            return (
                              <td key={cut.id} className="px-3 py-2 border-r border-gray-300 relative" style={{ width: `${100 / subGroup.cuts.length}%` }}>
                                <div className="relative">
                                  <button
                                    ref={(el) => { buttonRefs.current[dropdownKey] = el; }}
                                    type="button"
                                    onClick={() => toggleDropdown(subGroup.id, cut.id)}
                                    className="w-full px-2 py-1 text-xs border border-gray-300 rounded focus:ring-2 focus:ring-[#D14A2D] focus:border-[#D14A2D] bg-white hover:bg-gray-50 flex items-center justify-between text-left"
                                  >
                                    <span className="truncate flex-1">{displayText}</span>
                                    <ChevronDownIcon className={`h-4 w-4 flex-shrink-0 ml-1 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
                                  </button>
                                  
                                  {isOpen && dropdownPosition[dropdownKey] && typeof document !== 'undefined' && createPortal(
                                    <div
                                      ref={(el) => { dropdownRefs.current[dropdownKey] = el; }}
                                      className="fixed bg-white border border-gray-300 rounded shadow-lg z-[9999] overflow-hidden flex flex-col"
                                      style={{
                                        top: `${dropdownPosition[dropdownKey].top}px`,
                                        left: `${dropdownPosition[dropdownKey].left}px`,
                                        width: `${dropdownPosition[dropdownKey].width}px`,
                                        maxHeight: `${dropdownPosition[dropdownKey].maxHeight}px`
                                      }}
                                    >
                                      {/* Search bar */}
                                      <div className="p-2 border-b border-gray-200">
                                        <div className="relative">
                                          <MagnifyingGlassIcon className="absolute left-2 top-1/2 transform -translate-y-1/2 h-4 w-4 text-gray-400" />
                                          <input
                                            type="text"
                                            value={searchTerm}
                                            onChange={(e) => setSearchTerm(e.target.value)}
                                            placeholder="Search variables..."
                                            className="w-full pl-8 pr-8 py-1.5 text-xs border border-gray-300 rounded focus:ring-2 focus:ring-[#D14A2D] focus:border-[#D14A2D]"
                                            autoFocus
                                            onClick={(e) => e.stopPropagation()}
                                          />
                                          <button
                                            type="button"
                                            onClick={() => {
                                              setOpenDropdown(null);
                                              setSearchTerm('');
                                            }}
                                            className="absolute right-2 top-1/2 transform -translate-y-1/2 text-gray-400 hover:text-gray-600 p-0.5 rounded transition-colors"
                                            title="Close"
                                          >
                                            <XMarkIcon className="h-4 w-4" />
                                          </button>
                                        </div>
                                      </div>
                                      
                                      {/* Options list */}
                                      <div className="overflow-y-auto flex-1">
                                        <div className="py-1">
                                          <button
                                            type="button"
                                            onClick={() => selectVariable(subGroup.id, cut.id, '')}
                                            className={`w-full px-3 py-2 text-xs text-left hover:bg-gray-100 ${!cut.variableName ? 'bg-gray-100 font-semibold' : ''}`}
                                          >
                                            Select Variable
                                          </button>
                                          {filteredVariables.length > 0 ? (
                                            filteredVariables.map(v => {
                                              const displayText = v.description 
                                                ? `${v.name} | ${v.description}`
                                                : v.name;
                                              return (
                                                <button
                                                  key={v.name}
                                                  type="button"
                                                  onClick={() => selectVariable(subGroup.id, cut.id, v.name)}
                                                  className={`w-full px-3 py-2 text-xs text-left hover:bg-gray-100 ${cut.variableName === v.name ? 'bg-gray-100 font-semibold' : ''}`}
                                                  title={displayText}
                                                >
                                                  <div className="truncate">
                                                    <span className="font-bold">{v.name}</span>
                                                    {v.description && (
                                                      <>
                                                        <span className="mx-1">|</span>
                                                        <span>{v.description}</span>
                                                      </>
                                                    )}
                                                  </div>
                                                </button>
                                              );
                                            })
                                          ) : (
                                            <div className="px-3 py-2 text-xs text-gray-500 text-center">
                                              No variables found
                                            </div>
                                          )}
                                        </div>
                                      </div>
                                    </div>,
                                    document.body
                                  )}
                                </div>
                              </td>
                            );
                          })}
                        </tr>
                        {/* Codes Selection Row - One row showing codes for all cuts */}
                        <tr>
                          {subGroup.cuts.map((cut) => {
                            const selectedVariable = categoricalVariables.find(v => v.name === cut.variableName);
                            
                            return (
                              <td key={cut.id} className="px-3 py-2 border-r border-gray-300 align-top" style={{ width: `${100 / subGroup.cuts.length}%` }}>
                                {selectedVariable ? (
                                  <div className="max-h-40 overflow-y-auto space-y-1">
                                    {Object.entries(selectedVariable.codes || {}).map(([code, label]: [string, any]) => (
                                      <label key={code} className="flex items-center gap-1 text-xs cursor-pointer hover:bg-gray-50 p-1 rounded">
                                        <input
                                          type="checkbox"
                                          checked={cut.codes.includes(code)}
                                          onChange={(e) => {
                                            const newCodes = e.target.checked
                                              ? [...cut.codes, code]
                                              : cut.codes.filter(c => c !== code);
                                            updateCut(subGroup.id, cut.id, { codes: newCodes });
                                          }}
                                          className="rounded border-gray-300 text-[#D14A2D] focus:ring-[#D14A2D]"
                                        />
                                        <span className="text-xs flex-1">{code}: {String(label).substring(0, 25)}{String(label).length > 25 ? '...' : ''}</span>
                                      </label>
                                    ))}
                                  </div>
                                ) : (
                                  <span className="text-xs text-gray-400">Select variable first</span>
                                )}
                              </td>
                            );
                          })}
                        </tr>
                      </tbody>
                    </table>
                  </div>
                </div>
            </div>
          ))}
        </div>
      </div>

      {/* Footer */}
      <div className="flex items-center justify-end gap-3 p-4 border-t border-gray-200 bg-gray-50">
        <button
          onClick={onCancel}
          className="px-4 py-2 text-sm text-gray-700 hover:bg-gray-200 rounded-lg"
        >
          Cancel
        </button>
        <button
          onClick={handleSave}
          className="px-4 py-2 text-sm text-white bg-[#D14A2D] hover:bg-[#B83E25] rounded-lg"
        >
          {editingGroup ? 'Update Banner Group' : 'Create Banner Group'}
        </button>
      </div>
    </div>
  );
};

export default BannerBuilder;
