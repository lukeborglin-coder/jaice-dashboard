import React, { useState, useEffect } from 'react';
import { XMarkIcon, PlusIcon, TrashIcon } from '@heroicons/react/24/outline';
import { type ParsedDataFile, getCodeLabel } from '../utils/dataTabulationParser';
import { type BannerGroup, type BannerCut, type BannerSubGroup } from '../types/dataTabulation';

interface BannerBuilderProps {
  parsedFile: ParsedDataFile | null;
  editingGroup: BannerGroup | null;
  onSave: (group: BannerGroup) => void;
  onCancel: () => void;
}

const BannerBuilder: React.FC<BannerBuilderProps> = ({ parsedFile, editingGroup, onSave, onCancel }) => {
  const [groupTitle, setGroupTitle] = useState(editingGroup?.title || '');
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

  const categoricalVariables = parsedFile?.variables.filter(v => v.type === 'categorical') || [];

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
    if (subGroups.length <= 1) return; // Must have at least 1 sub-group
    setSubGroups(subGroups.filter(g => g.id !== subGroupId));
  };

  const updateSubGroup = (subGroupId: string, updates: Partial<BannerSubGroup>) => {
    setSubGroups(subGroups.map(g => g.id === subGroupId ? { ...g, ...updates } : g));
  };

  const addCut = (subGroupId: string) => {
    setSubGroups(subGroups.map(g => 
      g.id === subGroupId 
        ? { ...g, cuts: [...g.cuts, { id: `${subGroupId}-${Date.now()}`, title: '', variableName: '', codes: [] }] }
        : g
    ));
  };

  const removeCut = (subGroupId: string, cutId: string) => {
    setSubGroups(subGroups.map(g => {
      if (g.id !== subGroupId) return g;
      if (g.cuts.length <= 2) return g; // Must have at least 2 cuts
      return { ...g, cuts: g.cuts.filter(c => c.id !== cutId) };
    }));
  };

  const updateCut = (subGroupId: string, cutId: string, updates: Partial<BannerCut>) => {
    setSubGroups(subGroups.map(g => 
      g.id === subGroupId 
        ? { ...g, cuts: g.cuts.map(c => c.id === cutId ? { ...c, ...updates } : c) }
        : g
    ));
  };

  const handleVariableChange = (subGroupId: string, cutId: string, variableName: string) => {
    updateCut(subGroupId, cutId, { variableName, codes: [] }); // Reset codes when variable changes
  };

  const toggleCode = (subGroupId: string, cutId: string, code: string) => {
    setSubGroups(subGroups.map(g => {
      if (g.id !== subGroupId) return g;
      const cut = g.cuts.find(c => c.id === cutId);
      if (!cut) return g;
      
      const newCodes = cut.codes.includes(code)
        ? cut.codes.filter(c => c !== code)
        : [...cut.codes, code];
      
      return { ...g, cuts: g.cuts.map(c => c.id === cutId ? { ...c, codes: newCodes } : c) };
    }));
  };

  const handleSave = () => {
    // Validate
    if (!groupTitle.trim()) {
      alert('Please enter a group title');
      return;
    }
    
    if (subGroups.length === 0) {
      alert('Please add at least one group');
      return;
    }

    for (const subGroup of subGroups) {
      if (!subGroup.title.trim()) {
        alert('Please enter a title for all groups');
        return;
      }
      if (subGroup.cuts.length < 2) {
        alert(`Group "${subGroup.title}" must have at least 2 cuts`);
        return;
      }
      for (const cut of subGroup.cuts) {
        if (!cut.title.trim()) {
          alert('Please enter a title for all cuts');
          return;
        }
        if (!cut.variableName) {
          alert('Please select a variable for all cuts');
          return;
        }
        if (cut.codes.length === 0) {
          alert('Please select at least one code for each cut');
          return;
        }
      }
    }

    const group: BannerGroup = {
      id: editingGroup?.id || Date.now().toString(),
      title: groupTitle.trim(),
      groups: subGroups.map(g => ({
        ...g,
        title: g.title.trim(),
        cuts: g.cuts.map(c => ({ ...c, title: c.title.trim() }))
      })),
      confidenceLevel: confidenceLevel
    };

    onSave(group);
  };

  return (
    <div className="flex-1 flex flex-col p-4 overflow-hidden">
      <div className="max-w-6xl mx-auto w-full h-full flex flex-col">
        <div className="flex items-center justify-between mb-3 flex-shrink-0">
          <h3 className="text-lg font-semibold text-gray-900">
            {editingGroup ? 'Edit Banner Group' : 'Create Banner Group'}
          </h3>
          <button
            onClick={onCancel}
            className="text-gray-400 hover:text-gray-600"
          >
            <XMarkIcon className="h-5 w-5" />
          </button>
        </div>

        <div className="flex flex-col flex-1 min-h-0 space-y-3">
          {/* Group Title */}
          <div className="flex-shrink-0">
            <label className="block text-xs font-medium text-gray-700 mb-1">
              Group Title <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              value={groupTitle}
              onChange={(e) => setGroupTitle(e.target.value)}
              placeholder="Enter banner group title..."
              className="w-full border border-gray-300 rounded-md px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-orange-500"
            />
          </div>

          {/* Confidence Level */}
          <div className="flex-shrink-0">
            <label className="block text-xs font-medium text-gray-700 mb-1">
              Stat Testing Confidence Level
            </label>
            <select
              value={confidenceLevel}
              onChange={(e) => setConfidenceLevel(Number(e.target.value) as 95 | 90 | 80)}
              className="w-full border border-gray-300 rounded-md px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-orange-500"
            >
              <option value={95}>95%</option>
              <option value={90}>90%</option>
              <option value={80}>80%</option>
            </select>
          </div>

          {/* Sub-Groups */}
          <div className="flex flex-col flex-1 min-h-0 overflow-y-auto space-y-4">
            <div className="flex items-center justify-between flex-shrink-0">
              <label className="block text-xs font-medium text-gray-700">
                Groups <span className="text-red-500">*</span>
              </label>
              <button
                onClick={addSubGroup}
                className="flex items-center gap-1 px-2 py-1 text-xs text-gray-700 bg-gray-100 hover:bg-gray-200 rounded-md transition-colors"
              >
                <PlusIcon className="h-3 w-3" />
                Add Group
              </button>
            </div>

            {subGroups.map((subGroup, groupIndex) => (
              <div key={subGroup.id} className="border border-gray-300 rounded-lg p-3 space-y-3 bg-gray-50">
                <div className="flex items-center justify-between">
                  <div className="flex-1">
                    <label className="block text-xs font-medium text-gray-700 mb-1">
                      Group {groupIndex + 1} Title <span className="text-red-500">*</span>
                    </label>
                    <input
                      type="text"
                      value={subGroup.title}
                      onChange={(e) => updateSubGroup(subGroup.id, { title: e.target.value })}
                      placeholder="Enter group title..."
                      className="w-full border border-gray-300 rounded-md px-2 py-1 text-xs focus:outline-none focus:ring-2 focus:ring-orange-500"
                    />
                  </div>
                  {subGroups.length > 1 && (
                    <button
                      onClick={() => removeSubGroup(subGroup.id)}
                      className="ml-3 text-red-600 hover:text-red-800 p-1 rounded"
                      title="Remove group"
                    >
                      <TrashIcon className="h-4 w-4" />
                    </button>
                  )}
                </div>

                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <label className="block text-xs font-medium text-gray-700">
                      Cuts <span className="text-red-500">*</span> (at least 2 required)
                    </label>
                    <button
                      onClick={() => addCut(subGroup.id)}
                      className="flex items-center gap-1 px-2 py-0.5 text-xs text-gray-700 bg-white border border-gray-300 hover:bg-gray-50 rounded-md transition-colors"
                    >
                      <PlusIcon className="h-3 w-3" />
                      Add Cut
                    </button>
                  </div>

                  <div className="flex flex-wrap gap-2">
                    {subGroup.cuts.map((cut, cutIndex) => {
                      const selectedVariable = categoricalVariables.find(v => v.name === cut.variableName);
                      const availableCodes = selectedVariable ? Object.keys(selectedVariable.codes) : [];

                      return (
                        <div key={cut.id} className="border border-gray-200 rounded-lg p-2 space-y-2 bg-white w-fit">
                          {subGroup.cuts.length > 2 && (
                            <div className="flex justify-end">
                              <button
                                onClick={() => removeCut(subGroup.id, cut.id)}
                                className="text-red-600 hover:text-red-800 p-0.5 rounded"
                              >
                                <TrashIcon className="h-3 w-3" />
                              </button>
                            </div>
                          )}

                          {/* Cut Title */}
                          <div>
                            <label className="block text-xs font-medium text-gray-700 mb-0.5">
                              Title <span className="text-red-500">*</span>
                            </label>
                            <input
                              type="text"
                              value={cut.title}
                              onChange={(e) => updateCut(subGroup.id, cut.id, { title: e.target.value })}
                              placeholder="Enter cut title..."
                              className="border border-gray-300 rounded-md px-2 py-1 text-xs focus:outline-none focus:ring-2 focus:ring-orange-500"
                              style={{ width: '250px' }}
                            />
                          </div>

                          {/* Variable Selection */}
                          <div className="w-full min-w-0">
                            <label className="block text-xs font-medium text-gray-700 mb-0.5">
                              Variable <span className="text-red-500">*</span>
                            </label>
                            <select
                              value={cut.variableName}
                              onChange={(e) => handleVariableChange(subGroup.id, cut.id, e.target.value)}
                              className="border border-gray-300 rounded-md px-2 py-1 text-xs focus:outline-none focus:ring-2 focus:ring-orange-500"
                              style={{ 
                                width: '250px',
                                overflow: 'hidden',
                                textOverflow: 'ellipsis',
                                whiteSpace: 'nowrap'
                              }}
                            >
                              <option value="">Select a variable...</option>
                              {categoricalVariables.map(variable => {
                                const fullText = `${variable.name} - ${variable.description}`;
                                // Truncate to ~30 characters to fit within 250px dropdown width
                                const displayText = fullText.length > 30 
                                  ? fullText.substring(0, 27) + '...' 
                                  : fullText;
                                return (
                                  <option 
                                    key={variable.name} 
                                    value={variable.name}
                                    title={fullText}
                                  >
                                    {displayText}
                                  </option>
                                );
                              })}
                            </select>
                          </div>

                          {/* Code Selection */}
                          {selectedVariable && availableCodes.length > 0 && (
                            <div>
                              <label className="block text-xs font-medium text-gray-700 mb-0.5">
                                Codes <span className="text-red-500">*</span>
                              </label>
                              <div className="border border-gray-200 rounded-md p-1.5 max-h-32 overflow-y-auto">
                                <div className="space-y-0.5">
                                  {availableCodes.map(code => (
                                    <label
                                      key={code}
                                      className="flex items-center space-x-1 cursor-pointer hover:bg-gray-50 p-0.5 rounded text-xs"
                                    >
                                      <input
                                        type="checkbox"
                                        checked={cut.codes.includes(code)}
                                        onChange={() => toggleCode(subGroup.id, cut.id, code)}
                                        className="rounded border-gray-300"
                                      />
                                      <span className="text-xs text-gray-700 truncate">
                                        {selectedVariable.codes[code]}
                                      </span>
                                    </label>
                                  ))}
                                </div>
                              </div>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
            ))}
          </div>

          {/* Action Buttons */}
          <div className="flex items-center justify-end gap-3 pt-2 border-t border-gray-200 flex-shrink-0">
            <button
              onClick={onCancel}
              className="px-3 py-1.5 text-xs font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50 transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={handleSave}
              className="px-3 py-1.5 text-xs font-medium text-white rounded-md hover:opacity-90 transition-opacity"
              style={{ backgroundColor: '#D14A2D' }}
            >
              Save Banner Group
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default BannerBuilder;

