import React, { useState, useEffect } from 'react';
import { XMarkIcon, PlusIcon, TrashIcon } from '@heroicons/react/24/outline';
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

  // Filter for variables that have codes (categorical variables)
  const categoricalVariables = variables.filter(v =>
    v.codes && Object.keys(v.codes).length > 0
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

  const addCut = (subGroupId: string) => {
    setSubGroups(subGroups.map(g => {
      if (g.id === subGroupId) {
        return {
          ...g,
          cuts: [...g.cuts, { id: `${Date.now()}-${g.cuts.length + 1}`, title: '', variableName: '', codes: [] }]
        };
      }
      return g;
    }));
  };

  const removeCut = (subGroupId: string, cutId: string) => {
    setSubGroups(subGroups.map(g => {
      if (g.id === subGroupId && g.cuts.length > 2) {
        return { ...g, cuts: g.cuts.filter(c => c.id !== cutId) };
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
            <div key={subGroup.id} className="mb-6 p-4 border border-gray-200 rounded-lg">
              <div className="flex items-center justify-between mb-4">
                <input
                  type="text"
                  value={subGroup.title}
                  onChange={(e) => updateSubGroup(subGroup.id, { title: e.target.value })}
                  placeholder={`Sub-Group ${subGroupIndex + 1} Title`}
                  className="flex-1 px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-[#D14A2D] focus:border-[#D14A2D]"
                />
                {subGroups.length > 1 && (
                  <button
                    onClick={() => removeSubGroup(subGroup.id)}
                    className="ml-2 p-2 text-red-600 hover:bg-red-50 rounded-lg"
                    title="Remove sub-group"
                  >
                    <TrashIcon className="h-5 w-5" />
                  </button>
                )}
              </div>

              {/* Cuts */}
              <div className="grid grid-cols-2 gap-3">
                {subGroup.cuts.map((cut, cutIndex) => {
                  const selectedVariable = categoricalVariables.find(v => v.name === cut.variableName);

                  return (
                    <div key={cut.id} className="relative p-3 bg-gray-50 rounded-lg">
                      <div className="space-y-2">
                        <input
                          type="text"
                          value={cut.title}
                          onChange={(e) => updateCut(subGroup.id, cut.id, { title: e.target.value })}
                          placeholder="Cut Title"
                          className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-[#D14A2D] focus:border-[#D14A2D]"
                        />

                        <select
                          value={cut.variableName}
                          onChange={(e) => updateCut(subGroup.id, cut.id, { variableName: e.target.value, codes: [] })}
                          className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-[#D14A2D] focus:border-[#D14A2D]"
                        >
                          <option value="">Select Variable</option>
                          {categoricalVariables.map(v => (
                            <option key={v.name} value={v.name}>
                              {v.name} - {v.description || 'No description'}
                            </option>
                          ))}
                        </select>

                        {selectedVariable && (
                          <div className="pl-3 border-l-2 border-gray-300">
                            <p className="text-xs text-gray-600 mb-2">Select codes to include:</p>
                            <div className="space-y-1 max-h-40 overflow-y-auto">
                              {Object.entries(selectedVariable.codes || {}).map(([code, label]: [string, any]) => (
                                <label key={code} className="flex items-center gap-2 text-sm">
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
                                  <span>{code}: {label}</span>
                                </label>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>

                      {subGroup.cuts.length > 2 && (
                        <button
                          onClick={() => removeCut(subGroup.id, cut.id)}
                          className="absolute top-2 right-2 p-1.5 text-red-600 hover:bg-red-100 rounded-lg"
                          title="Remove cut"
                        >
                          <TrashIcon className="h-4 w-4" />
                        </button>
                      )}
                    </div>
                  );
                })}

                <button
                  onClick={() => addCut(subGroup.id)}
                  className="py-2 text-sm text-[#D14A2D] hover:bg-orange-50 rounded-lg border border-dashed border-[#D14A2D]"
                >
                  + Add Cut
                </button>
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
