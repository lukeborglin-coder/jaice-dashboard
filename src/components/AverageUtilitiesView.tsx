import React, { useMemo, useState, useEffect, useRef } from 'react';

interface AverageUtilitiesViewProps {
  workflow: any;
  axisMode?: 'independent' | 'consistent' | 'manual';
  manualMin?: number;
  manualMax?: number;
  onAxisModeChange?: (mode: 'independent' | 'consistent' | 'manual') => void;
  onManualValuesChange?: (min: number, max: number) => void;
}

interface UtilityLevel {
  level: string;
  code?: string;
  value: number;
  isReference?: boolean;
}

interface AttributeUtilities {
  attributeName: string;
  attributeLabel: string;
  levels: UtilityLevel[];
  minUtility: number;
  maxUtility: number;
  spread: number;
  spreadColor?: string;
}

// Helper function to convert hex color to rgba with opacity
const hexToRgba = (hex: string, opacity: number): string => {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r}, ${g}, ${b}, ${opacity})`;
};

export default function AverageUtilitiesView({ 
  workflow,
  axisMode: propAxisMode,
  manualMin: propManualMin,
  manualMax: propManualMax,
  onAxisModeChange,
  onManualValuesChange
}: AverageUtilitiesViewProps) {
  const [selectedAttributeForTable, setSelectedAttributeForTable] = useState<string | null>(null);
  const chartContainerRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const [containerHeights, setContainerHeights] = useState<Record<string, number>>({});
  const [axisMode, setAxisMode] = useState<'independent' | 'consistent' | 'manual'>(propAxisMode || 'independent');
  const [manualMin, setManualMin] = useState<number>(propManualMin ?? 0);
  const [manualMax, setManualMax] = useState<number>(propManualMax ?? 1);
  const [manualMinInput, setManualMinInput] = useState<string>(String(propManualMin ?? 0));
  const [manualMaxInput, setManualMaxInput] = useState<string>(String(propManualMax ?? 1));

  // Update local state when props change
  useEffect(() => {
    if (propAxisMode !== undefined) {
      setAxisMode(propAxisMode);
    }
  }, [propAxisMode]);

  useEffect(() => {
    if (propManualMin !== undefined) {
      setManualMin(propManualMin);
      setManualMinInput(String(propManualMin));
    }
  }, [propManualMin]);

  useEffect(() => {
    if (propManualMax !== undefined) {
      setManualMax(propManualMax);
      setManualMaxInput(String(propManualMax));
    }
  }, [propManualMax]);

  const attributesData = useMemo(() => {
    // Extract utilities from workflow
    // The workflow stores estimation in either:
    // - workflow.estimation (AI workflows, direct from backend)
    // - workflow.estimationResult (mapped in ConjointProjects from estimation)
    let utilities: Record<string, Record<string, number>> = {};
    let schemaAttributes: any[] = [];

    // Check for estimation data - prefer estimationResult (which is mapped from estimation),
    // but fall back to estimation directly if estimationResult isn't available
    const estimationData = workflow?.estimationResult || workflow?.estimation;
    
    if (estimationData?.utilities) {
      utilities = estimationData.utilities;
      schemaAttributes = estimationData.schema?.attributes || [];
    }

    // If no utilities found, show message
    if (!utilities || Object.keys(utilities).length === 0) {
      return [];
    }

    // Build attribute data with utilities
    const attributes: AttributeUtilities[] = [];

    // Use schema if available, otherwise use utility keys
    const sourceAttributes = schemaAttributes.length > 0
      ? schemaAttributes
      : Object.keys(utilities).map(name => ({
          name,
          label: name,
          levels: Object.keys(utilities[name] || {}).map(level => ({ code: level, level }))
        }));

    // Get original attribute definitions from workflow to extract codes
    // Try multiple sources: draft.attributes, aiAnalysis.attributes, or workflow.attributes
    const originalAttributes = workflow?.draft?.attributes || 
                               workflow?.aiAnalysis?.attributes || 
                               workflow?.attributes || 
                               [];
    
    // Build a map from attribute name to its original definition with codes
    const attributeNameToOriginal = new Map<string, any>();
    originalAttributes.forEach((origAttr: any) => {
      const attrNo = String(origAttr.attributeNo || '').trim();
      const attrName = String(origAttr.attributeText || '').trim();
      // Try to match by attribute number or name
      sourceAttributes.forEach(sourceAttr => {
        if (sourceAttr.attributeNo === attrNo || 
            sourceAttr.name?.includes(attrNo) ||
            sourceAttr.label === attrName) {
          attributeNameToOriginal.set(sourceAttr.name, origAttr);
        }
      });
    });

    sourceAttributes.forEach(attr => {
      const attributeName = attr.name;
      const attributeLabel = attr.label || attributeName;
      const levelMap = utilities[attributeName] || {};
      
      console.log(`[DEBUG] Processing attribute: ${attributeName}`, {
        rawLevelMap: levelMap,
        schemaLevels: attr.levels,
        reference: attr.reference
      });
      
      if (!levelMap || Object.keys(levelMap).length === 0) {
        console.log(`[DEBUG] Skipping ${attributeName} - no levelMap`);
        return;
      }

      // Handle reference level for effects coding
      const schemaLevels = Array.isArray(attr.levels) ? attr.levels : [];

      // Build a map from level label to code for this attribute
      // First try to get from original attribute definitions
      const levelLabelToCode = new Map<string, string>();
      const normalizedToCode = new Map<string, string>(); // normalized label -> code
      
      // Try to get codes from original workflow attributes
      const originalAttr = attributeNameToOriginal.get(attributeName);
      if (originalAttr && Array.isArray(originalAttr.levels)) {
        originalAttr.levels.forEach((levelDef: any) => {
          const levelText = String(levelDef.levelText || levelDef.level || '').trim();
          const code = String(levelDef.code || '').trim();
          if (levelText && code) {
            levelLabelToCode.set(levelText, code);
            normalizedToCode.set(levelText.toLowerCase().trim(), code);
          }
        });
      }
      
      // Fallback: try to get from schema levels if they're objects
      if (levelLabelToCode.size === 0) {
        schemaLevels.forEach((schemaLevel: any) => {
          if (typeof schemaLevel === 'object' && schemaLevel.code && schemaLevel.level) {
            const label = String(schemaLevel.level).trim();
            const code = String(schemaLevel.code).trim();
            levelLabelToCode.set(label, code);
            normalizedToCode.set(label.toLowerCase().trim(), code);
          } else if (typeof schemaLevel === 'string') {
            // If schema level is just a string, use it as both code and level
            const normalized = schemaLevel.trim().toLowerCase();
            normalizedToCode.set(normalized, schemaLevel);
          }
        });
      }

      console.log(`[DEBUG] ${attributeName} - levelLabelToCode map:`, Array.from(levelLabelToCode.entries()));
      console.log(`[DEBUG] ${attributeName} - utility keys (levelMap):`, Object.keys(levelMap));

      // Get all level utilities
      const baseLevels: UtilityLevel[] = Object.entries(levelMap).map(([level, value]) => {
        // Find the code for this level label
        let code = levelLabelToCode.get(level); // Try exact match first
        if (!code) {
          // Try normalized match
          const normalized = level.trim().toLowerCase();
          code = normalizedToCode.get(normalized);
        }
        if (!code) {
          // If still no match, the level might already be a code or we need to find it
          // Try to find a schema level that matches (might be case/whitespace difference)
          const schemaMatch = schemaLevels.find((sl: any) => {
            if (typeof sl === 'object') {
              const slLabel = String(sl.level || '').trim();
              return slLabel.toLowerCase() === level.trim().toLowerCase();
            }
            return false;
          });
          if (schemaMatch && typeof schemaMatch === 'object') {
            code = schemaMatch.code;
          }
        }
        // Fallback: if no code found, use the level itself (might already be a code)
        code = code || level;
        
        console.log(`[DEBUG] ${attributeName} - level "${level}" -> code "${code}"`);
        
        return {
          level,
          code,
          value: Number(value),
          isReference: false
        };
      });

      console.log(`[DEBUG] ${attributeName} - baseLevels (from utilities object):`, 
        baseLevels.map(l => ({ level: l.level, value: l.value }))
      );

      // Get reference level - prefer attr.reference, otherwise use the last level in schema
      // If schema level is an object, use its level property; if string, use directly
      const referenceLevel = attr.reference || 
        (schemaLevels.length ? 
          (typeof schemaLevels[schemaLevels.length - 1] === 'string' 
            ? schemaLevels[schemaLevels.length - 1] 
            : schemaLevels[schemaLevels.length - 1]?.level || schemaLevels[schemaLevels.length - 1]?.code) 
          : null);
      
      // Also get reference level code for matching (might be code or level)
      const referenceLevelCode = attr.reference || 
        (schemaLevels.length ? 
          (typeof schemaLevels[schemaLevels.length - 1] === 'string' 
            ? schemaLevels[schemaLevels.length - 1] 
            : schemaLevels[schemaLevels.length - 1]?.code || schemaLevels[schemaLevels.length - 1]?.level) 
          : null);
      
      console.log(`[DEBUG] ${attributeName} - referenceLevel:`, referenceLevel, 'referenceLevelCode:', referenceLevelCode);
      console.log(`[DEBUG] ${attributeName} - schemaLevels:`, schemaLevels);
      
      const allLevels = [...baseLevels];
      
      // Check if reference level is already in utilities (shouldn't be for effects coding, but check anyway)
      const referenceInUtilities = allLevels.find(l => l.level === referenceLevel || l.level === referenceLevelCode);
      
      if (referenceLevel && !referenceInUtilities) {
        // Reference level not in utilities - calculate it
        const referenceValue = -baseLevels.reduce((sum, row) => sum + row.value, 0);
        console.log(`[DEBUG] ${attributeName} - calculated reference value:`, referenceValue, 'from sum:', baseLevels.reduce((sum, row) => sum + row.value, 0));
        // Find the code for the reference level
        const refCode = levelLabelToCode.get(referenceLevel) || referenceLevelCode || referenceLevel;
        allLevels.push({
          level: referenceLevelCode || referenceLevel,
          code: refCode,
          value: referenceValue,
          isReference: true
        });
      } else if (referenceInUtilities) {
        // Reference level IS in utilities - mark it as reference
        console.log(`[DEBUG] ${attributeName} - reference level found in utilities, marking as reference`);
        referenceInUtilities.isReference = true;
      }
      
      console.log(`[DEBUG] ${attributeName} - allLevels (before ordering):`, 
        allLevels.map(l => ({ level: l.level, value: l.value, isReference: l.isReference }))
      );

      // Sort levels by code in ascending order
      // First, ensure all levels have codes set
      const allLevelsWithCodes = allLevels.map(level => {
        // If code is not set, try to find it from the levelLabelToCode map
        if (!level.code || level.code === level.level) {
          const code = levelLabelToCode.get(level.level);
          if (code) {
            return { ...level, code };
          }
        }
        return level;
      });
      
      // Sort by code (numeric if possible, otherwise lexicographic)
      const orderedLevels = allLevelsWithCodes.sort((a, b) => {
        const codeA = a.code || a.level;
        const codeB = b.code || b.level;
        
        // Try numeric comparison first
        const numA = Number(codeA);
        const numB = Number(codeB);
        if (!Number.isNaN(numA) && !Number.isNaN(numB)) {
          return numA - numB;
        }
        
        // Fallback to string comparison
        return codeA.localeCompare(codeB, undefined, { numeric: true, sensitivity: 'base' });
      });
      
      console.log(`[DEBUG] ${attributeName} - orderedLevels (final):`, 
        orderedLevels.map(l => ({ level: l.level, value: l.value, isReference: l.isReference }))
      );

      if (orderedLevels.length === 0) {
        return;
      }

      const values = orderedLevels.map(l => l.value);
      const minUtility = Math.min(...values);
      const maxUtility = Math.max(...values);

      // Debug logging
      console.log(`[AverageUtilitiesView] Attribute: ${attributeLabel}`, {
        attributeName,
        levelCount: orderedLevels.length,
        utilities: orderedLevels.map(l => ({ level: l.level, value: l.value })),
        minUtility,
        maxUtility,
        range: maxUtility - minUtility
      });

      const spread = maxUtility - minUtility;
      
      attributes.push({
        attributeName,
        attributeLabel,
        levels: orderedLevels,
        minUtility,
        maxUtility,
        spread
      });
    });

    // Sort attributes by spread (strongest to weakest)
    attributes.sort((a, b) => b.spread - a.spread);
    
    // Calculate min and max spread for color scaling
    const spreads = attributes.map(a => a.spread);
    const minSpread = Math.min(...spreads);
    const maxSpread = Math.max(...spreads);
    const spreadRange = maxSpread - minSpread;
    
    // Add color indicator to each attribute
    attributes.forEach(attr => {
      // Normalize spread to 0-1 range
      const normalizedSpread = spreadRange > 0 
        ? (attr.spread - minSpread) / spreadRange 
        : 0.5;
      
      // Color scale: green (strong) -> yellow (medium) -> red (weak)
      // Since we're sorting strongest to weakest, strongest = green
      let color = '#ef4444'; // red (weak)
      if (normalizedSpread > 0.66) {
        color = '#10b981'; // green (strong)
      } else if (normalizedSpread > 0.33) {
        color = '#f59e0b'; // yellow (medium)
      }
      
      attr.spreadColor = color;
    });

    return attributes;
  }, [workflow]);

  // Measure container heights on mount and resize
  useEffect(() => {
    const measureContainers = () => {
      const heights: Record<string, number> = {};
      Object.entries(chartContainerRefs.current).forEach(([key, element]) => {
        if (element) {
          heights[key] = element.clientHeight;
        }
      });
      if (Object.keys(heights).length > 0) {
        setContainerHeights(heights);
      }
    };

    // Measure after a short delay to ensure layout is complete
    const timeout = setTimeout(measureContainers, 100);
    measureContainers();
    window.addEventListener('resize', measureContainers);

    return () => {
      window.removeEventListener('resize', measureContainers);
      clearTimeout(timeout);
    };
  }, [attributesData]);

  if (attributesData.length === 0) {
    // Check if workflow has survey data but no estimation yet
    const hasSurveyData = workflow?.survey || workflow?.surveyUploadedAt;
    const hasEstimation = workflow?.estimationResult || workflow?.estimation;
    
    return (
      <div className="p-8 text-center text-gray-500">
        <p className="text-lg mb-2">No utilities data available</p>
        <p className="text-sm">
          {hasSurveyData && !hasEstimation
            ? 'Survey data is uploaded. Please run estimation to calculate average utilities.'
            : !hasSurveyData
            ? 'Please upload survey data and run estimation to view average utilities.'
            : 'Please run estimation first to view average utilities.'}
        </p>
      </div>
    );
  }

  // Note: Y-axis will be calculated per-attribute for independent scaling
  // Fixed chart height for consistency
  const defaultChartHeight = 320;
  const minChartHeight = 400; // Minimum height to prevent charts from being scrunched

  // Calculate global min/max for consistent axis mode
  const globalMinMax = useMemo(() => {
    if (axisMode !== 'consistent' || attributesData.length === 0) {
      return null;
    }
    let globalMin = Infinity;
    let globalMax = -Infinity;
    attributesData.forEach(attr => {
      if (attr.minUtility < globalMin) globalMin = attr.minUtility;
      if (attr.maxUtility > globalMax) globalMax = attr.maxUtility;
    });
    return { min: globalMin, max: globalMax };
  }, [axisMode, attributesData]);

  return (
    <div className="min-h-full">
      <div className="bg-white border-b border-gray-200 pr-6 pl-0 py-2">
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <span className="text-sm text-gray-700 whitespace-nowrap">Y-Axis:</span>
            <div className="flex items-center gap-2">
              <div className="flex items-center gap-1 border border-gray-300 rounded">
            <button
              onClick={() => {
                setAxisMode('independent');
                onAxisModeChange?.('independent');
              }}
              className={`px-2 py-1 text-xs transition ${
                axisMode === 'independent'
                  ? 'bg-blue-50 border-blue-300 text-blue-700'
                  : 'bg-white text-gray-700 hover:bg-gray-50'
              } ${axisMode === 'independent' ? 'border-r' : ''}`}
              title="Each chart uses its own Y-axis range"
            >
              Independent
            </button>
            <button
              onClick={() => {
                setAxisMode('consistent');
                onAxisModeChange?.('consistent');
              }}
              className={`px-2 py-1 text-xs transition ${
                axisMode === 'consistent'
                  ? 'bg-blue-50 border-blue-300 text-blue-700'
                  : 'bg-white text-gray-700 hover:bg-gray-50'
              } ${axisMode !== 'independent' && axisMode !== 'manual' ? 'border-x' : axisMode === 'consistent' ? 'border-r' : ''}`}
              title="All charts use the same Y-axis range"
            >
              Consistent
            </button>
            <button
              onClick={() => {
                setAxisMode('manual');
                onAxisModeChange?.('manual');
              }}
              className={`px-2 py-1 text-xs transition rounded-r ${
                axisMode === 'manual'
                  ? 'bg-blue-50 border-blue-300 text-blue-700'
                  : 'bg-white text-gray-700 hover:bg-gray-50'
              }`}
              title="Manually set Y-axis range"
            >
              Manual
            </button>
              </div>
              {axisMode === 'manual' && (
                <div className="flex items-center gap-2 text-xs">
                  <label className="flex items-center gap-1">
                    <span className="text-gray-600">Min:</span>
                    <input
                      type="text"
                      value={manualMinInput}
                      onChange={(e) => {
                        const value = e.target.value;
                        // Allow empty, digits, decimal point, and minus at the start
                        if (value === '' || /^-?\d*\.?\d*$/.test(value)) {
                          // Always update the input display
                          setManualMinInput(value);
                          
                          // Only update the actual number state if it's a valid complete number
                          if (value !== '' && value !== '-' && value !== '.' && value !== '-.') {
                            const numValue = Number(value);
                            if (!isNaN(numValue)) {
                              // Don't allow min to be greater than max
                              const newMin = numValue <= manualMax ? numValue : manualMin;
                              setManualMin(newMin);
                              onManualValuesChange?.(newMin, manualMax);
                            }
                          }
                        }
                      }}
                      onBlur={() => {
                        // On blur, ensure we have a valid number
                        const numValue = Number(manualMinInput);
                        if (isNaN(numValue) || manualMinInput === '' || manualMinInput === '-' || manualMinInput === '.' || manualMinInput === '-.') {
                          setManualMinInput(String(manualMin));
                        } else {
                          const newMin = numValue <= manualMax ? numValue : manualMin;
                          setManualMin(newMin);
                          setManualMinInput(String(newMin));
                          onManualValuesChange?.(newMin, manualMax);
                        }
                      }}
                      className="w-14 px-1 py-0.5 border border-gray-300 rounded text-xs [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                    />
                  </label>
                  <label className="flex items-center gap-1">
                    <span className="text-gray-600">Max:</span>
                    <input
                      type="text"
                      value={manualMaxInput}
                      onChange={(e) => {
                        const value = e.target.value;
                        // Allow empty, digits, decimal point, and minus at the start
                        if (value === '' || /^-?\d*\.?\d*$/.test(value)) {
                          // Always update the input display
                          setManualMaxInput(value);
                          
                          // Only update the actual number state if it's a valid complete number
                          if (value !== '' && value !== '-' && value !== '.' && value !== '-.') {
                            const numValue = Number(value);
                            if (!isNaN(numValue)) {
                              // Don't allow max to be smaller than min
                              const newMax = numValue >= manualMin ? numValue : manualMax;
                              setManualMax(newMax);
                              onManualValuesChange?.(manualMin, newMax);
                            }
                          }
                        }
                      }}
                      onBlur={() => {
                        // On blur, ensure we have a valid number
                        const numValue = Number(manualMaxInput);
                        if (isNaN(numValue) || manualMaxInput === '' || manualMaxInput === '-' || manualMaxInput === '.' || manualMaxInput === '-.') {
                          setManualMaxInput(String(manualMax));
                        } else {
                          const newMax = numValue >= manualMin ? numValue : manualMax;
                          setManualMax(newMax);
                          setManualMaxInput(String(newMax));
                          onManualValuesChange?.(manualMin, newMax);
                        }
                      }}
                      className="w-14 px-1 py-0.5 border border-gray-300 rounded text-xs [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                    />
                  </label>
                </div>
              )}
            </div>
          </div>
          <div className="flex items-center gap-3 text-xs text-gray-600 flex-shrink-0">
            <span className="font-semibold whitespace-nowrap">Spread Strength:</span>
            <div className="flex items-center gap-1 whitespace-nowrap">
              <div className="w-2 h-2 rounded-full bg-green-500"></div>
              <span>Strong</span>
            </div>
            <div className="flex items-center gap-1 whitespace-nowrap">
              <div className="w-2 h-2 rounded-full bg-yellow-500"></div>
              <span>Medium</span>
            </div>
            <div className="flex items-center gap-1 whitespace-nowrap">
              <div className="w-2 h-2 rounded-full bg-red-500"></div>
              <span>Weak</span>
            </div>
          </div>
        </div>
      </div>

      <div className="py-6 grid grid-cols-2 gap-6">
        {attributesData.map((attr, index) => {
          // Use measured container height if available, otherwise use default
          // Ensure minimum height to prevent charts from being scrunched
          const measuredHeight = containerHeights[attr.attributeName];
          const chartHeight = Math.max(
            measuredHeight && measuredHeight > 0 ? measuredHeight : defaultChartHeight,
            minChartHeight
          );
          // Bottom margin fixed to accommodate 3-line wrapped labels
          // Top margin minimal to maximize plot area - expand plot area to fill available space
          const labelHeight = 70; // Height for 3-line labels
          const bottomMargin = labelHeight; // Just enough for labels
          const topMargin = 15; // Padding above chart
          const chartPadding = 10; // Padding above and below the plot area
          const margin = { top: topMargin + chartPadding, right: 0, bottom: bottomMargin + chartPadding, left: 60 };
          // Chart width will be calculated dynamically based on container, but we need a base for calculations
          // The actual width will be set via CSS to fill the container
          const baseChartWidth = 1000; // Base width for calculations, but SVG will scale to container
          const plotWidth = baseChartWidth - margin.left - margin.right;
          // Calculate plot height to use all available vertical space
          const plotHeight = chartHeight - margin.top - margin.bottom;
          
          // Calculate spacing between points - ensure at least some space between levels
          // The space between Y-axis and first point, and after last point, should equal the spacing between points
          const minLabelWidth = 80; // Minimum label width
          const maxLabelWidth = 250; // Maximum label width to prevent labels from being too wide
          
          // Calculate point spacing: distribute available width evenly
          // We want: spacing from Y-axis to first point = spacing between points = spacing from last point to right edge
          // So if we have n levels, we need (n + 1) intervals of equal width
          const availableWidth = plotWidth - margin.left - margin.right;
          const pointSpacing = attr.levels.length > 0 
            ? availableWidth / (attr.levels.length + 1) // +1 for spacing from Y-axis to first point, and last point to right edge
            : availableWidth / 2;
          
          // Start padding equals point spacing so first point is one spacing unit from Y-axis
          const startPadding = pointSpacing;
          // End padding equals point spacing so last point is one spacing unit from right edge
          const endPadding = pointSpacing;
          
          // Dynamic label width based on available space between points
          // When there are fewer levels, pointSpacing is larger, so labels can be wider
          // When there are more levels, pointSpacing is smaller, so labels need to be narrower
          // Use 80-90% of pointSpacing to allow some padding between labels
          let labelWidth = pointSpacing * 0.85;
          
          // Ensure label width is within min/max bounds
          labelWidth = Math.max(labelWidth, minLabelWidth);
          labelWidth = Math.min(labelWidth, maxLabelWidth);
          
          // For very few levels (3 or less), allow labels to be wider
          if (attr.levels.length <= 3) {
            labelWidth = Math.min(pointSpacing * 0.95, maxLabelWidth);
          }
          
          // For many levels (8 or more), make labels narrower to prevent overlap
          if (attr.levels.length >= 8) {
            labelWidth = Math.max(pointSpacing * 0.7, minLabelWidth);
          }
          
          // Note: Removed constraints on first/last labels - they can extend beyond chart boundaries
          // to use available space more effectively
          
          // Calculate Y-axis scaling - use independent, consistent, or manual based on mode
          let attrMin, attrMax;
          if (axisMode === 'manual') {
            attrMin = manualMin;
            attrMax = manualMax;
          } else if (axisMode === 'consistent' && globalMinMax) {
            attrMin = globalMinMax.min;
            attrMax = globalMinMax.max;
          } else {
            attrMin = attr.minUtility;
            attrMax = attr.maxUtility;
          }
          const attrRange = attrMax - attrMin;
          // Only add padding if not in manual mode - manual mode should use exact values
          let padding = 0;
          if (axisMode !== 'manual') {
            // If range is zero or very small, use symmetric padding around the value
            padding = attrRange > 0.001 
              ? Math.max(attrRange * 0.1, 0.005) // 10% padding, minimum 0.005
              : Math.max(Math.abs(attrMin || attrMax || 0) * 0.1, 0.01); // 10% of value, minimum 0.01
          }
          const yMin = attrMin - padding;
          const yMax = attrMax + padding;
          const yAxisRange = yMax - yMin;
          
          // Generate Y-axis tick marks for this attribute
          const yTicks = [];
          const numTicks = 5;
          for (let i = 0; i <= numTicks; i++) {
            const value = yMin + (yAxisRange * i / numTicks);
            yTicks.push(value);
          }
          
          // Helper to convert utility value to Y coordinate
          const valueToY = (value: number) => {
            const normalized = (value - yMin) / yAxisRange;
            return margin.top + plotHeight - (normalized * plotHeight);
          };

          // Generate points for the line - start after the padding
          const points = attr.levels.map((level, i) => {
            const x = margin.left + startPadding + (i * pointSpacing);
            const y = valueToY(level.value);
            return { x, y, level, value: level.value };
          });
          
          // Calculate the X position of the last point (for line endings)
          const lastPointX = points.length > 0 ? points[points.length - 1].x : margin.left + startPadding;
          const firstPointX = points.length > 0 ? points[0].x : margin.left + startPadding;
          
          // Extend lines to fill the full width - extend to the right edge of the viewBox
          const lineStartX = firstPointX - pointSpacing;
          const lineEndX = baseChartWidth; // Extend all the way to the right edge
          
          // Calculate label distribution: evenly space labels from Y-axis to end of X-axis
          // First label's left edge aligns with Y-axis, last label's right edge aligns with end of X-axis
          const labelAreaStart = margin.left; // Y-axis position
          const labelAreaEnd = lineEndX; // End of X-axis line
          const labelAreaWidth = labelAreaEnd - labelAreaStart;
          const labelCount = attr.levels.length;
          const labelWidthPerLabel = labelAreaWidth / labelCount;
          
          // Reposition points to match label positions (centered in each label's allocated space)
          const repositionedPoints = points.map((point, i) => {
            // Each label's center is at: labelAreaStart + (i * labelWidthPerLabel) + (labelWidthPerLabel / 2)
            const labelCenterX = labelAreaStart + (i * labelWidthPerLabel) + (labelWidthPerLabel / 2);
            return {
              ...point,
              x: labelCenterX
            };
          });

          // Create path for the line using repositioned points
          const linePath = repositionedPoints.map((point, i) => {
            return `${i === 0 ? 'M' : 'L'} ${point.x} ${point.y}`;
          }).join(' ');

          return (
            <div key={attr.attributeName || index} className="bg-white rounded-lg border border-gray-200 px-2 pt-2 pb-0 relative flex flex-col">
              <div className="flex justify-between items-center mb-1 gap-2 min-w-0 pb-1 border-b border-gray-200">
                <h3 className="text-sm font-semibold text-gray-900 truncate flex-1 min-w-0" title={attr.attributeLabel}>{attr.attributeLabel}</h3>
                <div className="flex items-center gap-1.5 flex-shrink-0">
                  <button
                    onClick={() => {
                      setSelectedAttributeForTable(
                        selectedAttributeForTable === attr.attributeName 
                          ? null 
                          : attr.attributeName
                      );
                    }}
                    className={`px-1.5 py-0.5 border rounded transition text-xs ${
                      selectedAttributeForTable === attr.attributeName
                        ? 'bg-gray-100 border-gray-400 text-gray-900'
                        : 'bg-white border-gray-300 text-gray-700 hover:bg-gray-50'
                    }`}
                    title={selectedAttributeForTable === attr.attributeName ? "View chart" : "View table data"}
                  >
                    {selectedAttributeForTable === attr.attributeName ? 'View Chart' : 'View Table'}
                  </button>
                  <div 
                    className="flex items-center gap-1 px-1.5 py-0.5 rounded border text-xs text-gray-700"
                    style={{ 
                      backgroundColor: attr.spreadColor ? hexToRgba(attr.spreadColor, 0.15) : '#f3f4f6',
                      borderColor: attr.spreadColor ? hexToRgba(attr.spreadColor, 0.3) : '#d1d5db'
                    }}
                  >
                    <div 
                      className="w-1.5 h-1.5 rounded-full"
                      style={{ backgroundColor: attr.spreadColor || '#9ca3af' }}
                    ></div>
                    <span>Spread: {attr.spread.toFixed(3)}</span>
                  </div>
                </div>
              </div>
              
              {/* Chart or Table - toggle view */}
              <div 
                ref={(el) => {
                  if (el) {
                    chartContainerRefs.current[attr.attributeName] = el;
                  }
                }}
                className="w-full -mb-2 flex-1 min-h-0"
              >
                {selectedAttributeForTable === attr.attributeName ? (
                  /* Table view */
                  <div className="w-full h-full overflow-auto">
                    {(() => {
                      // Find the maximum utility value
                      const maxValue = Math.max(...attr.levels.map(l => l.value));
                      return (
                        <table className="w-full text-xs">
                          <thead>
                            <tr className="border-b border-gray-300">
                              <th className="text-left py-1.5 px-2 font-semibold text-gray-700">Level</th>
                              <th className="text-center py-1.5 px-2 font-semibold text-gray-700">Raw Value</th>
                            </tr>
                          </thead>
                          <tbody>
                            {attr.levels.map((level, levelIdx) => {
                              const isBest = level.value === maxValue;
                              return (
                                <tr 
                                  key={levelIdx} 
                                  className={`border-b border-gray-200 ${isBest ? 'bg-green-50' : ''}`}
                                >
                                  <td className="py-1.5 px-2 text-gray-900" title={level.level}>
                                    {String(level.level || '').replace(/^[-•·\s]+/, '').trim() || level.level}
                                  </td>
                                  <td className="py-1.5 px-2 text-gray-900 text-center">
                                    {level.value.toFixed(6)}
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      );
                    })()}
                  </div>
                ) : (
                  /* Chart view */
                  <svg 
                    viewBox={`0 0 ${baseChartWidth} ${chartHeight}`} 
                    preserveAspectRatio="xMidYMid meet"
                    className="w-full h-full"
                  >
                    {/* Y-axis line */}
                    <line
                      x1={margin.left}
                      y1={margin.top}
                      x2={margin.left}
                      y2={margin.top + plotHeight}
                      stroke="#d1d5db"
                      strokeWidth="1"
                    />
                    
                    {/* Y-axis ticks and labels */}
                    {yTicks.map((tickValue, i) => {
                      const y = valueToY(tickValue);
                      return (
                        <g key={i}>
                          <line
                            x1={margin.left - 5}
                            y1={y}
                            x2={margin.left}
                            y2={y}
                            stroke="#d1d5db"
                            strokeWidth="1"
                          />
                          <text
                            x={margin.left - 10}
                            y={y + 4}
                            textAnchor="end"
                            className="text-xs fill-gray-600"
                          >
                            {tickValue.toFixed(2)}
                          </text>
                        </g>
                      );
                    })}
                    
                    {/* Zero line - always show if zero is within the visible range */}
                    {(() => {
                      const zeroY = valueToY(0);
                      // Only show zero line if it's within the visible plot area
                      if (zeroY >= margin.top && zeroY <= margin.top + plotHeight) {
                        return (
                          <line
                            x1={lineStartX}
                            y1={zeroY}
                            x2={lineEndX}
                            y2={zeroY}
                            stroke="#9ca3af"
                            strokeWidth="1"
                            strokeDasharray="4 4"
                            opacity="0.6"
                          />
                        );
                      }
                      return null;
                    })()}
                    
                    {/* X-axis line - extend equally on both sides */}
                    <line
                      x1={lineStartX}
                      y1={margin.top + plotHeight}
                      x2={lineEndX}
                      y2={margin.top + plotHeight}
                      stroke="#d1d5db"
                      strokeWidth="1"
                    />
                    
                    {/* X-axis tick marks */}
                    {repositionedPoints.map((point, i) => (
                      <line
                        key={`x-tick-${i}`}
                        x1={point.x}
                        y1={margin.top + plotHeight}
                        x2={point.x}
                        y2={margin.top + plotHeight + 5}
                        stroke="#d1d5db"
                        strokeWidth="1"
                      />
                    ))}
                    
                    {/* Line path */}
                    <path
                      d={linePath}
                      fill="none"
                      stroke="#3b82f6"
                      strokeWidth="2"
                    />
                    
                    {/* Data points */}
                    {repositionedPoints.map((point, i) => (
                      <g key={i}>
                        <circle
                          cx={point.x}
                          cy={point.y}
                          r="5"
                          fill="#3b82f6"
                          stroke="white"
                          strokeWidth="2"
                        />
                        {/* Value label above point */}
                        <text
                          x={point.x}
                          y={point.y - 10}
                          textAnchor="middle"
                          className="text-xs fill-gray-700 font-medium"
                        >
                          {point.value.toFixed(3)}
                        </text>
                      </g>
                    ))}
                    
                    {/* X-axis labels - horizontal, clean text without dashes, wrapped to 3 lines */}
                    {repositionedPoints.map((point, i) => {
                      // Clean the level text - remove leading dashes/bullets
                      const cleanLevelText = String(point.level.level || '').replace(/^[-•·\s]+/, '').trim();
                      
                      // Calculate label width - evenly distribute labels across the label area
                      // Each label gets equal width based on the number of labels
                      const labelCount = points.length;
                      const labelWidthPerLabel = labelAreaWidth / labelCount;
                      
                      // Ensure width is within bounds
                      let pointLabelWidth = Math.max(labelWidthPerLabel, minLabelWidth);
                      pointLabelWidth = Math.min(pointLabelWidth, maxLabelWidth);
                      
                      // Position labels: first label left-aligned at Y-axis, last label right-aligned at end of X-axis
                      // Labels are evenly distributed in between
                      const labelX = labelAreaStart + (i * labelWidthPerLabel);
                      
                      // Position labels below the tick marks with some spacing
                      const tickMarkY = margin.top + plotHeight; // Y position of tick marks
                      const spaceBetweenTickAndLabel = 8; // Space between tick mark and label
                      const labelY = tickMarkY + 5 + spaceBetweenTickAndLabel; // Position labels below tick marks with spacing
                      
                      return (
                        <g key={i}>
                          <foreignObject
                            x={labelX}
                            y={labelY}
                            width={pointLabelWidth}
                            height={labelHeight}
                          >
                            <div
                              className="text-xs text-gray-700"
                              style={{
                                width: `${pointLabelWidth}px`,
                                display: '-webkit-box',
                                WebkitLineClamp: 3,
                                WebkitBoxOrient: 'vertical',
                                overflow: 'hidden',
                                textOverflow: 'ellipsis',
                                textAlign: 'center',
                                lineHeight: '1.3',
                                wordBreak: 'break-word'
                              }}
                              title={cleanLevelText || point.level.level}
                            >
                              {cleanLevelText || point.level.level}
                            </div>
                          </foreignObject>
                        </g>
                      );
                    })}
                  </svg>
                )}
              </div>
            </div>
          );
        })}
      </div>

    </div>
  );
}

