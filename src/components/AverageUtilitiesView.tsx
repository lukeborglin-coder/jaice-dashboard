import React, { useMemo } from 'react';

interface AverageUtilitiesViewProps {
  workflow: any;
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

export default function AverageUtilitiesView({ workflow }: AverageUtilitiesViewProps) {
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
        schemaLevels.forEach((schemaLevel) => {
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

  // Calculate the maximum height needed for tables based on number of levels
  // Header: ~60px (title + range box + padding), Each row: ~35px
  // Note: p-4 adds 16px padding on all sides (top and bottom = 32px total)
  const calculateTableContentHeight = (numLevels: number) => {
    const headerHeight = 60; // Title + range box + mb-3 spacing
    const rowHeight = 35; // Approximate row height with padding
    return headerHeight + (numLevels * rowHeight);
  };

  const maxTableContentHeight = attributesData.length > 0
    ? Math.max(...attributesData.map(attr => calculateTableContentHeight(attr.levels.length)))
    : 0;
  
  // The table box includes p-4 padding (16px top + 16px bottom = 32px)
  const maxTableBoxHeight = maxTableContentHeight + 32;

  return (
    <div className="min-h-full">
      <div className="bg-white border-b border-gray-200 px-6 py-4">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-semibold text-gray-900">Average Utilities</h1>
            <p className="text-sm text-gray-600 mt-1">Utility values for each attribute level. Higher values indicate greater preference.</p>
          </div>
          <div className="flex items-center gap-4 text-xs text-gray-600">
            <span className="font-semibold">Spread Strength:</span>
            <div className="flex items-center gap-1">
              <div className="w-2 h-2 rounded-full bg-green-500"></div>
              <span>Strong</span>
            </div>
            <div className="flex items-center gap-1">
              <div className="w-2 h-2 rounded-full bg-yellow-500"></div>
              <span>Medium</span>
            </div>
            <div className="flex items-center gap-1">
              <div className="w-2 h-2 rounded-full bg-red-500"></div>
              <span>Weak</span>
            </div>
          </div>
        </div>
      </div>

      <div className="px-6 py-6 bg-gray-50 space-y-8">
        {attributesData.map((attr, index) => {
          const chartWidth = 800;
          // Use the maximum table box height (including padding) to ensure charts align with table boxes
          const chartHeight = maxTableBoxHeight > 0 ? maxTableBoxHeight : 300;
          // Bottom margin fixed to accommodate 2-line wrapped labels
          // Top margin minimal to maximize plot area - expand plot area to fill available space
          const bottomMargin = 110; // Fixed bottom margin for labels
          const topMargin = 20; // Minimal top margin
          const margin = { top: topMargin, right: 40, bottom: bottomMargin, left: 60 };
          const plotWidth = chartWidth - margin.left - margin.right;
          // Calculate plot height to use all available vertical space
          const plotHeight = chartHeight - margin.top - margin.bottom;
          
          // Calculate spacing between points - ensure at least some space between levels
          // Account for Y-axis on left and chart boundary on right
          const minLabelWidth = 100; // Minimum label width
          const startPadding = 60; // Padding from Y-axis (half of typical label width)
          const endPadding = 40; // Padding on the right (half of typical label width)
          const availableWidth = plotWidth - startPadding - endPadding;
          
          const pointSpacing = attr.levels.length > 1 
            ? availableWidth / (attr.levels.length - 1)
            : availableWidth / 2;
          
          // Dynamic label width: use pointSpacing to fill the space evenly
          // Make sure it's at least the minimum width
          // But also ensure it doesn't cause labels to extend beyond chart boundaries
          let labelWidth = Math.max(pointSpacing, minLabelWidth);
          
          // Check if labels would extend beyond boundaries
          // First point's label should start at or after margin.left (Y-axis)
          // Last point's label should end at or before chartWidth (right edge of chart)
          if (attr.levels.length > 0) {
            const firstPointX = margin.left + startPadding;
            const lastPointX = margin.left + startPadding + (attr.levels.length - 1) * pointSpacing;
            const chartRightEdge = chartWidth;
            
            // Check left boundary: first label's left edge should be >= margin.left (Y-axis)
            const firstLabelLeft = firstPointX - labelWidth / 2;
            if (firstLabelLeft < margin.left) {
              labelWidth = Math.min(labelWidth, (firstPointX - margin.left) * 2);
            }
            
            // Check right boundary: last label's right edge should be <= chartRightEdge
            const lastLabelRight = lastPointX + labelWidth / 2;
            if (lastLabelRight > chartRightEdge) {
              labelWidth = Math.min(labelWidth, (chartRightEdge - lastPointX) * 2);
            }
          }
          
          // Calculate Y-axis scaling per-attribute for independent scaling
          const attrMin = attr.minUtility;
          const attrMax = attr.maxUtility;
          const attrRange = attrMax - attrMin;
          // If range is zero or very small, use symmetric padding around the value
          const padding = attrRange > 0.001 
            ? Math.max(attrRange * 0.1, 0.005) // 10% padding, minimum 0.005
            : Math.max(Math.abs(attrMin || attrMax || 0) * 0.1, 0.01); // 10% of value, minimum 0.01
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
          
          // Calculate where the lines should end (at the right edge of the last label)
          const lastPointX = points.length > 0 ? points[points.length - 1].x : margin.left + startPadding;
          const lineEndX = lastPointX + labelWidth / 2;

          // Create path for the line
          const linePath = points.map((point, i) => {
            return `${i === 0 ? 'M' : 'L'} ${point.x} ${point.y}`;
          }).join(' ');

          return (
            <div key={attr.attributeName || index} className="bg-white rounded-lg border border-gray-200 p-6 relative">
              <div className="flex justify-between items-center mb-4">
                <h3 className="text-lg font-semibold text-gray-900">{attr.attributeLabel}</h3>
                <div className="flex items-center gap-2 px-3 py-1.5 bg-gray-100 rounded border border-gray-300 text-xs text-gray-600">
                  <div 
                    className="w-2 h-2 rounded-full"
                    style={{ backgroundColor: attr.spreadColor || '#9ca3af' }}
                  ></div>
                  <span>Spread: {attr.spread.toFixed(3)}</span>
                </div>
              </div>
              
              <div className="flex gap-6 items-stretch">
                {/* Table on the left */}
                <div className="flex-1 min-w-0 flex flex-col">
                  <div 
                    className="bg-gray-50 rounded border border-gray-300 p-4 flex flex-col"
                    style={{ minHeight: `${maxTableBoxHeight}px` }}
                  >
                    <div className="overflow-x-auto">
                      <table className="w-full text-xs">
                        <thead>
                          <tr className="border-b border-gray-300">
                            <th className="text-left py-2 px-3 font-semibold text-gray-700" colSpan={2}>Levels ({attr.levels.length})</th>
                            <th className="text-left py-2 px-3 font-semibold text-gray-700">Raw Value</th>
                          </tr>
                        </thead>
                        <tbody>
                          {attr.levels.map((level, levelIdx) => (
                            <tr 
                              key={levelIdx} 
                              className="border-b border-gray-200"
                            >
                              <td className="py-2 px-3 text-gray-500 text-xs whitespace-nowrap w-auto">
                                {level.code || level.level}
                              </td>
                              <td className="py-2 px-3 text-gray-900 text-xs max-w-xs truncate" title={level.level}>
                                {String(level.level || '').replace(/^[-•·\s]+/, '').trim() || level.level}
                              </td>
                              <td className="py-2 px-3 text-gray-900 text-xs">
                                {level.value.toFixed(6)}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </div>
                
                {/* Chart on the right */}
                <div className="overflow-x-auto flex-shrink-0 flex flex-col justify-end" style={{ minHeight: '100%' }}>
                  <svg width={chartWidth} height={chartHeight} className="w-full flex-shrink-0" style={{ minWidth: chartWidth }}>
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
                          x1={margin.left}
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
                  
                  {/* X-axis line - extend to end of last label */}
                  <line
                    x1={margin.left}
                    y1={margin.top + plotHeight}
                    x2={lineEndX}
                    y2={margin.top + plotHeight}
                    stroke="#d1d5db"
                    strokeWidth="1"
                  />
                  
                  {/* X-axis tick marks */}
                  {points.map((point, i) => (
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
                  {points.map((point, i) => (
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
                  
                  {/* X-axis labels - horizontal, clean text without dashes, wrapped to 2 lines */}
                  {points.map((point, i) => {
                    // Clean the level text - remove leading dashes/bullets
                    const cleanLevelText = String(point.level.level || '').replace(/^[-•·\s]+/, '').trim();
                    // Use dynamic label width calculated above
                    const labelX = point.x - labelWidth / 2;
                    
                    return (
                      <g key={i}>
                        <foreignObject
                          x={labelX}
                          y={margin.top + plotHeight + 25}
                          width={labelWidth}
                          height={50}
                        >
                          <div
                            className="text-xs text-gray-700"
                            style={{
                              width: `${labelWidth}px`,
                              display: '-webkit-box',
                              WebkitLineClamp: 2,
                              WebkitBoxOrient: 'vertical',
                              overflow: 'hidden',
                              textOverflow: 'ellipsis',
                              textAlign: 'center',
                              lineHeight: '1.2',
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
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

