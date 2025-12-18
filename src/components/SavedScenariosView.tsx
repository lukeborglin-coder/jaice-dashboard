import React, { useState, useEffect, useCallback, useRef } from 'react';
import { API_BASE_URL, CONJOINT_BACKEND_ENABLED } from '../config';

interface SavedScenario {
  id: string;
  name: string;
  selections: Record<string, string>;
  createdAt: string;
}

interface SavedScenariosViewProps {
  workflow: any;
}

interface LevelImpact {
  levelCode: string;
  levelText: string;
  marketShare: number;
  change: number;
}

interface MarketShareProduct {
  name: string;
  currentShare: number;
  adjustedShare?: number;
}

export default function SavedScenariosView({ workflow }: SavedScenariosViewProps) {
  const [savedScenarios, setSavedScenarios] = useState<SavedScenario[]>([]);
  const [attributes, setAttributes] = useState<any[]>([]);
  const [selectedScenarioId, setSelectedScenarioId] = useState<string>('');
  const [expandedAttribute, setExpandedAttribute] = useState<string | null>(null);
  const [levelImpacts, setLevelImpacts] = useState<Record<string, LevelImpact[]>>({});
  const [loadingImpacts, setLoadingImpacts] = useState<string | null>(null);
  const [baselineMarketShare, setBaselineMarketShare] = useState<number | null>(null);
  const [marketShareProducts, setMarketShareProducts] = useState<MarketShareProduct[]>([]);
  const [scenarioAnalysis, setScenarioAnalysis] = useState<any>(null);
  const [loadingAnalysis, setLoadingAnalysis] = useState(false);
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const currentRunIdRef = useRef<string | null>(null);

  useEffect(() => {
    if (!workflow?.id) return;
    
    // Load saved scenarios from localStorage
    const savedKey = `conjoint_saved_scenarios_${workflow.id}`;
    try {
      const saved = localStorage.getItem(savedKey);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed)) {
          setSavedScenarios(parsed);
        }
      }
    } catch (e) {
      console.error('Failed to load saved scenarios:', e);
    }

    // Load attributes from workflow
    if (workflow?.aiAnalysis?.attributes) {
      const processedAttributes = workflow.aiAnalysis.attributes.map((attr: any) => ({
        attributeNo: String(attr.attributeNo || ''),
        attributeText: attr.attributeText || '',
        levels: (attr.levels || []).map((level: any) => ({
          levelNo: String(level.levelNo || ''),
          levelText: level.levelText || '',
          code: String(level.code || level.levelNo || '')
        }))
      }));
      setAttributes(processedAttributes);
    }
  }, [workflow]);

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsDropdownOpen(false);
      }
    };

    if (isDropdownOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isDropdownOpen]);

  const getLevelText = (attributeNo: string, levelCode: string): string => {
    const attribute = attributes.find(attr => attr.attributeNo === attributeNo);
    if (!attribute) return levelCode;
    
    const level = attribute.levels.find((lvl: any) => lvl.code === levelCode || lvl.levelNo === levelCode);
    return level ? level.levelText : levelCode;
  };

  const runScenarioAnalysisRef = useRef<((selections: Record<string, string>, returnFullAnalysis?: boolean) => Promise<any>) | null>(null);

  const runScenarioAnalysis = useCallback(async (selections: Record<string, string>, returnFullAnalysis = false): Promise<any> => {
    console.log('[runScenarioAnalysis] Called with', { selections, returnFullAnalysis, hasWorkflowId: !!workflow?.id });
    
    if (!CONJOINT_BACKEND_ENABLED) {
      return null;
    }

    if (!workflow?.id) {
      console.log('[runScenarioAnalysis] Early return: no workflow ID');
      return null;
    }

    const estimationData = workflow?.estimationResult || workflow?.estimation;
    if (!estimationData) {
      console.log('[runScenarioAnalysis] Early return: no estimation data');
      return null;
    }

    try {
      const schemaAttributes = estimationData?.schema?.attributes || [];
      console.log('[runScenarioAnalysis] Schema attributes count:', schemaAttributes.length);
      
      // Build attribute mapping
      const attributeNoToSchemaName = new Map<string, string>();
      attributes.forEach((attr: any) => {
        const matchingSchemaAttr = schemaAttributes.find((schemaAttr: any) => 
          schemaAttr.label?.toLowerCase().trim() === attr.attributeText?.toLowerCase().trim()
        );
        if (matchingSchemaAttr) {
          attributeNoToSchemaName.set(attr.attributeNo, matchingSchemaAttr.name);
        }
      });

      const utilities = estimationData?.utilities || {};
      const scenarioData: Record<string, string> = {};
      
      // Map selections to utility keys
      Object.entries(selections).forEach(([attributeId, levelId]) => {
        const attribute = attributes.find(attr => attr.attributeNo === attributeId);
        const level = attribute?.levels.find((lvl: any) => lvl.levelNo === levelId || lvl.code === levelId);
        
        if (attribute && level) {
          const schemaName = attributeNoToSchemaName.get(attributeId) || attribute.attributeText;
          const attrUtilities = utilities[schemaName] || {};
          
          // Try to find matching utility key
          let levelKey = level.levelText;
          const matchingKey = Object.keys(attrUtilities).find(key => 
            key.toLowerCase().trim() === level.levelText.toLowerCase().trim()
          );
          if (matchingKey) {
            levelKey = matchingKey;
          }
          
          scenarioData[schemaName] = levelKey;
        }
      });

      console.log('[runScenarioAnalysis] Scenario data prepared:', scenarioData);
      const token = localStorage.getItem('cognitive_dash_token');
      console.log('[runScenarioAnalysis] Making API call to', `${API_BASE_URL}/api/conjoint/workflows/${workflow.id}/scenario-analysis`);
      
      const response = await fetch(`${API_BASE_URL}/api/conjoint/workflows/${workflow.id}/scenario-analysis`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({
          newScenarios: [scenarioData],
          choiceRule: 'logit'
        })
      });

      console.log('[runScenarioAnalysis] Response status:', response.status, response.statusText);

      if (!response.ok) {
        const errorText = await response.text();
        console.error(`[runScenarioAnalysis] Scenario analysis failed: ${response.status} ${response.statusText}`, errorText);
        throw new Error(`Failed to run scenario analysis: ${response.status} ${response.statusText}`);
      }

      const result = await response.json();
      console.log('[runScenarioAnalysis] Response received:', result);
      
      if (returnFullAnalysis) {
        console.log('[runScenarioAnalysis] Returning full analysis');
        return result.scenarioAnalysis;
      }
      
      const projectedScenario = result.scenarioAnalysis?.projectedScenarios?.[0];
      if (!projectedScenario?.products) {
        console.log('[runScenarioAnalysis] No projected scenario products found');
        return null;
      }

      // Get the new product's market share (last product in the array)
      const products = projectedScenario.products || [];
      const newProduct = products[products.length - 1];
      const marketShare = newProduct ? Number(newProduct.marketShare || 0) : null;
      console.log('[runScenarioAnalysis] Returning market share:', marketShare);
      return marketShare;
    } catch (error) {
      console.error('[runScenarioAnalysis] Error running scenario analysis:', error);
      return null;
    }
  }, [workflow, attributes]);

  // Update the ref whenever the function changes
  useEffect(() => {
    runScenarioAnalysisRef.current = runScenarioAnalysis;
  }, [runScenarioAnalysis]);

  // Load market share products from workflow
  useEffect(() => {
    if (!workflow?.id) return;

    const loadMarketShareProducts = () => {
      if (workflow?.survey?.summary?.marketShareProducts) {
        const normalizedProducts = workflow.survey.summary.marketShareProducts.map((product: any) => {
          const currentShare = typeof product.currentShare === 'number'
            ? product.currentShare
            : parseFloat(product.currentShare) || 0;

          return {
            name: product.name || `Product ${product.rowNumber || ''}`.trim(),
            currentShare,
            adjustedShare: currentShare
          };
        });
        setMarketShareProducts(normalizedProducts);
      } else if (workflow?.aiAnalysis?.products) {
        const products = workflow.aiAnalysis.products.map((product: string) => ({
          name: product,
          currentShare: 0,
          adjustedShare: 0
        }));
        setMarketShareProducts(products);
      }
    };

    loadMarketShareProducts();
  }, [workflow]);

  // Run scenario analysis when scenario is selected
  useEffect(() => {
    console.log('[SavedScenariosView] useEffect triggered', {
      selectedScenarioId,
      savedScenariosCount: savedScenarios.length,
      workflowId: workflow?.id,
      attributesCount: attributes.length
    });

    if (!selectedScenarioId) {
      console.log('[SavedScenariosView] Early return: no selectedScenarioId');
      setLoadingAnalysis(false);
      currentRunIdRef.current = null;
      return;
    }
    const selectedScenario = savedScenarios.find(s => s.id === selectedScenarioId);
    console.log('[SavedScenariosView] Selected scenario:', selectedScenario);
    
    if (!selectedScenario || !workflow?.id) {
      console.log('[SavedScenariosView] Early return: no scenario or workflow', {
        hasScenario: !!selectedScenario,
        hasWorkflowId: !!workflow?.id
      });
      setLoadingAnalysis(false);
      currentRunIdRef.current = null;
      return;
    }
    
    // Wait for attributes to be loaded
    if (attributes.length === 0) {
      console.log('[SavedScenariosView] Early return: no attributes loaded yet');
      setLoadingAnalysis(false);
      return;
    }

    // Generate a unique run ID for this analysis
    const runId = `${selectedScenarioId}-${Date.now()}`;
    currentRunIdRef.current = runId;
    console.log('[SavedScenariosView] Starting scenario analysis with runId:', runId);

    const loadScenarioAnalysis = async () => {
      // Check if this run is still current
      const isCurrentRun = () => currentRunIdRef.current === runId;
      
      console.log('[SavedScenariosView] loadScenarioAnalysis called for runId:', runId);
      setLoadingAnalysis(true);
      // Reset impacts when switching scenarios - don't pre-calculate them
      setLevelImpacts({});
      setBaselineMarketShare(null);
      
      try {
        const runAnalysis = runScenarioAnalysisRef.current;
        if (!runAnalysis) {
          console.error('[SavedScenariosView] runScenarioAnalysis function not available');
          return;
        }

        console.log('[SavedScenariosView] Running main scenario analysis...');
        // Only get the main scenario analysis - don't pre-calculate all impacts
        const analysis = await runAnalysis(selectedScenario.selections, true);
        console.log('[SavedScenariosView] Main analysis result:', analysis);
        
        if (!isCurrentRun()) {
          console.log('[SavedScenariosView] Run cancelled: no longer current run');
          return;
        }
        
        if (analysis) {
          setScenarioAnalysis(analysis);
        } else {
          console.warn('[SavedScenariosView] No analysis returned from runScenarioAnalysis');
        }
        
        console.log('[SavedScenariosView] Running baseline market share calculation...');
        // Calculate baseline market share for when impacts are calculated on-demand
        const baselineShare = await runAnalysis(selectedScenario.selections, false);
        console.log('[SavedScenariosView] Baseline share result:', baselineShare);
        
        if (!isCurrentRun()) {
          console.log('[SavedScenariosView] Run cancelled: no longer current run');
          return;
        }
        
        if (baselineShare !== null) {
          setBaselineMarketShare(baselineShare);
        } else {
          console.warn('[SavedScenariosView] No baseline share calculated');
        }
      } catch (error) {
        if (isCurrentRun()) {
          console.error('[SavedScenariosView] Error loading scenario analysis:', error);
          alert('Failed to load scenario analysis. Please check the console for details.');
        }
      } finally {
        if (isCurrentRun()) {
          console.log('[SavedScenariosView] Analysis complete, clearing loading states');
          setLoadingAnalysis(false);
        }
      }
    };

    loadScenarioAnalysis();

    // Cleanup function to cancel if scenario changes
    return () => {
      console.log('[SavedScenariosView] Cleanup: cancelling runId:', runId);
      // Only clear the run ID if it matches the current run
      if (currentRunIdRef.current === runId) {
        currentRunIdRef.current = null;
        setLoadingAnalysis(false);
      }
    };
  }, [selectedScenarioId, savedScenarios, workflow?.id, attributes.length]);

  // Calculate selectedScenario early so it can be used in callbacks
  const selectedScenario = savedScenarios.find(s => s.id === selectedScenarioId);

  const calculateLevelImpacts = useCallback(async (attributeNo: string) => {
    const scenario = savedScenarios.find(s => s.id === selectedScenarioId);
    if (!scenario) return;
    
    setLoadingImpacts(attributeNo);
    
    try {
      // First, get baseline market share with current selections
      // Use existing baseline if available, otherwise calculate
      let baselineShare = baselineMarketShare;
      if (baselineShare === null) {
        baselineShare = await runScenarioAnalysis(scenario.selections, false);
        if (baselineShare !== null) {
          setBaselineMarketShare(baselineShare);
        }
      }
      
      if (baselineShare === null) {
        alert('Unable to calculate market share. Please ensure utilities have been estimated.');
        setLoadingImpacts(null);
        return;
      }

      const attribute = attributes.find(attr => attr.attributeNo === attributeNo);
      if (!attribute || !attribute.levels) {
        setLoadingImpacts(null);
        return;
      }

      // Calculate market share for each level
      const impacts: LevelImpact[] = [];
      
      for (const level of attribute.levels) {
        // Create new selections with this level
        const testSelections = { ...scenario.selections };
        testSelections[attributeNo] = level.levelNo || level.code;
        
        const marketShare = await runScenarioAnalysis(testSelections, false);
        if (marketShare !== null) {
          impacts.push({
            levelCode: level.levelNo || level.code,
            levelText: level.levelText,
            marketShare,
            change: marketShare - baselineShare
          });
        }
      }

      setLevelImpacts(prev => ({
        ...prev,
        [attributeNo]: impacts
      }));
    } catch (error) {
      console.error('Error calculating level impacts:', error);
      alert('Failed to calculate level impacts');
    } finally {
      setLoadingImpacts(null);
    }
  }, [selectedScenarioId, savedScenarios, runScenarioAnalysis, attributes, baselineMarketShare]);

  const handleRowClick = useCallback((attributeNo: string) => {
    if (expandedAttribute === attributeNo) {
      setExpandedAttribute(null);
    } else {
      setExpandedAttribute(attributeNo);
      // Calculate impacts if not already calculated
      if (!levelImpacts[attributeNo]) {
        calculateLevelImpacts(attributeNo);
      }
    }
  }, [expandedAttribute, levelImpacts, calculateLevelImpacts]);

  // Reset expanded attribute when scenario changes
  useEffect(() => {
    setExpandedAttribute(null);
    setLevelImpacts({});
    setBaselineMarketShare(null);
    setScenarioAnalysis(null);
  }, [selectedScenarioId]);

  // Early return if workflow is not available (after all hooks)
  if (!workflow || !workflow.id) {
    return (
      <div className="px-6 py-6 bg-gray-50">
        <div className="p-4 bg-white border border-gray-200 rounded-lg text-center">
          <p className="text-gray-600">Workflow not available. Please select a workflow first.</p>
        </div>
      </div>
    );
  }

  if (savedScenarios.length === 0) {
    return (
      <div className="px-6 py-6 bg-gray-50">
        <div className="p-4 bg-white border border-gray-200 rounded-lg text-center">
          <p className="text-gray-600">No saved scenarios yet. Create and save scenarios in the Simulator tab to see them here.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col bg-gray-50">
      {!CONJOINT_BACKEND_ENABLED && (
        <div className="bg-amber-50 border-b border-amber-200 px-6 py-3 text-sm text-amber-900">
          <p className="font-semibold">UI-only mode</p>
          <p className="mt-1 text-amber-800">
            Scenario analysis is disabled because the Conjoint backend has been removed.
          </p>
        </div>
      )}
      <div className="px-6 py-4 bg-white border-b border-gray-200">
        <div className="mb-4">
          <label className="block text-sm font-medium text-gray-700 mb-2">
            Select Scenario
          </label>
          <div className="relative w-full max-w-md" ref={dropdownRef}>
            <button
              type="button"
              onClick={() => setIsDropdownOpen(!isDropdownOpen)}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 bg-white text-left flex items-center justify-between"
            >
              <span className={selectedScenarioId ? 'text-gray-900' : 'text-gray-500'}>
                {selectedScenarioId 
                  ? (() => {
                      const scenario = savedScenarios.find(s => s.id === selectedScenarioId);
                      return scenario ? scenario.name : 'Select a scenario...';
                    })()
                  : 'Select a scenario...'
                }
              </span>
              <svg className={`h-4 w-4 text-gray-400 transition-transform ${isDropdownOpen ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
              </svg>
            </button>
            {isDropdownOpen && (
              <div className="absolute z-10 w-full mt-1 bg-white border border-gray-300 rounded-lg shadow-lg max-h-60 overflow-y-auto">
                <button
                  type="button"
                  onClick={() => {
                    setSelectedScenarioId('');
                    setIsDropdownOpen(false);
                  }}
                  className={`w-full px-3 py-2 text-left hover:bg-gray-50 focus:bg-gray-50 focus:outline-none ${
                    !selectedScenarioId ? 'bg-gray-50' : ''
                  }`}
                >
                  <span className="text-gray-500">Select a scenario...</span>
                </button>
                {savedScenarios.map((scenario) => (
                  <button
                    key={scenario.id}
                    type="button"
                    onClick={() => {
                      console.log('[SavedScenariosView] Scenario selected from dropdown:', scenario.id, scenario.name);
                      setSelectedScenarioId(scenario.id);
                      setIsDropdownOpen(false);
                    }}
                    className={`w-full px-3 py-2 text-left hover:bg-gray-50 focus:bg-gray-50 focus:outline-none border-t border-gray-100 ${
                      selectedScenarioId === scenario.id ? 'bg-blue-50' : ''
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <span className="text-gray-900">{scenario.name}</span>
                      <span className="text-gray-500 italic text-xs ml-2">
                        ({new Date(scenario.createdAt).toLocaleDateString()})
                      </span>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
         {loadingAnalysis && (
           <div className="flex items-center gap-2 text-sm text-gray-600">
             <svg className="animate-spin h-5 w-5 text-blue-500" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
               <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
               <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
             </svg>
             <span>Loading attributes, levels, and market share data...</span>
           </div>
         )}
       </div>

       {!loadingAnalysis && (
         <div className="flex-1 flex overflow-hidden">
          {/* Left Panel - Scenario Details */}
          <div className="flex-[2] overflow-auto">
            <div className="p-3">
              {selectedScenario && (
                <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
                <div className="px-4 py-3 bg-gray-50 border-b border-gray-200">
                  <div className="flex items-center justify-between">
                    <h3 className="text-lg font-semibold text-gray-900">{selectedScenario.name}</h3>
                    <div className="text-xs text-gray-500">
                      {new Date(selectedScenario.createdAt).toLocaleDateString(undefined, {
                        year: 'numeric',
                        month: 'short',
                        day: 'numeric',
                        hour: 'numeric',
                        minute: '2-digit'
                      })}
                    </div>
                  </div>
                </div>
                
                <div className="overflow-x-auto">
                  <table className="w-full">
                    <thead className="bg-gray-50">
                      <tr>
                        <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider border-b border-gray-200">
                          Attribute
                        </th>
                        <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider border-b border-gray-200">
                          Selected Level
                        </th>
                      </tr>
                    </thead>
                    <tbody className="bg-white divide-y divide-gray-200">
                      {attributes.map((attribute) => {
                        const selectedLevelCode = selectedScenario.selections[attribute.attributeNo];
                        const selectedLevelText = selectedLevelCode 
                          ? getLevelText(attribute.attributeNo, selectedLevelCode)
                          : 'Not selected';
                        const isExpanded = expandedAttribute === attribute.attributeNo;
                        const impacts = levelImpacts[attribute.attributeNo] || [];
                        const isLoading = loadingImpacts === attribute.attributeNo;
                        
                        // Calculate level strength (optimal, middle, worst) based on market share
                        // Only calculate if impacts are available (when row has been expanded)
                        let levelStrengthColor: 'green' | 'yellow' | 'red' | null = null;
                        if (impacts.length > 0 && selectedLevelCode) {
                          const sortedImpacts = [...impacts].sort((a, b) => b.marketShare - a.marketShare);
                          const selectedImpact = impacts.find(i => i.levelCode === selectedLevelCode);
                          
                          if (selectedImpact) {
                            const maxMarketShare = sortedImpacts[0].marketShare;
                            const minMarketShare = sortedImpacts[sortedImpacts.length - 1].marketShare;
                            
                            // If only one level, it's green
                            if (sortedImpacts.length === 1) {
                              levelStrengthColor = 'green';
                            } else if (selectedImpact.marketShare === maxMarketShare) {
                              // Highest market share = green
                              levelStrengthColor = 'green';
                            } else if (selectedImpact.marketShare === minMarketShare) {
                              // Lowest market share = red
                              levelStrengthColor = 'red';
                            } else {
                              // Middle range = yellow
                              levelStrengthColor = 'yellow';
                            }
                          }
                        }
                        // If impacts not calculated yet, show no bullet (will appear after row is expanded)
                        
                        return (
                          <React.Fragment key={attribute.attributeNo}>
                            <tr 
                              className="hover:bg-gray-50 cursor-pointer"
                              onClick={() => handleRowClick(attribute.attributeNo)}
                            >
                              <td className="px-4 py-3 text-sm font-medium text-gray-900">
                                {attribute.attributeText}
                              </td>
                              <td className="px-4 py-3 text-sm text-gray-700">
                                <div className="flex items-center gap-2">
                                  {selectedLevelCode && levelStrengthColor && (
                                    <span 
                                      className={`inline-block w-2 h-2 rounded-full flex-shrink-0 ${
                                        levelStrengthColor === 'green' ? 'bg-green-500' :
                                        levelStrengthColor === 'yellow' ? 'bg-yellow-500' :
                                        'bg-red-500'
                                      }`}
                                      style={{ width: '8px', height: '8px', flexShrink: 0 }}
                                    />
                                  )}
                                  {selectedLevelCode ? selectedLevelText : <span className="text-gray-400 italic">Not selected</span>}
                                </div>
                              </td>
                            </tr>
                             {isExpanded && (
                               <tr>
                                 <td colSpan={2} className="px-4 py-4 bg-gray-50">
                                   {isLoading ? (
                                     <div className="text-sm text-gray-600">Calculating market share impacts...</div>
                                   ) : impacts.length > 0 ? (
                                     <div>
                                       <table className="w-full">
                                         <thead>
                                           <tr className="border-b border-gray-300">
                                             <th className="text-left px-2 py-2 text-xs font-semibold text-gray-800">Level</th>
                                             <th className="text-center px-2 py-2 text-xs font-semibold text-gray-800">Market Share</th>
                                             <th className="text-center px-2 py-2 text-xs font-semibold text-gray-800">Change</th>
                                           </tr>
                                         </thead>
                                         <tbody>
                                           {(() => {
                                             // Calculate level strength colors for all impacts
                                             const sortedImpacts = [...impacts].sort((a, b) => b.marketShare - a.marketShare);
                                             const maxMarketShare = sortedImpacts[0]?.marketShare || 0;
                                             const minMarketShare = sortedImpacts[sortedImpacts.length - 1]?.marketShare || 0;
                                             
                                             return impacts.map((impact) => {
                                               const isSelected = impact.levelCode === selectedLevelCode;
                                               const isPositive = impact.change > 0;
                                               const isNegative = impact.change < 0;
                                               
                                               // Determine bullet color based on market share
                                               let bulletColor: 'green' | 'yellow' | 'red' | null = null;
                                               if (sortedImpacts.length === 1) {
                                                 bulletColor = 'green';
                                               } else if (impact.marketShare === maxMarketShare) {
                                                 bulletColor = 'green';
                                               } else if (impact.marketShare === minMarketShare) {
                                                 bulletColor = 'red';
                                               } else {
                                                 bulletColor = 'yellow';
                                               }
                                               
                                               return (
                                                 <tr 
                                                   key={impact.levelCode}
                                                   className={`border-b border-gray-200 ${
                                                     isSelected ? 'bg-blue-50' : ''
                                                   }`}
                                                 >
                                                   <td className="px-2 py-2">
                                                     <div className="flex items-center gap-2">
                                                       <span 
                                                         className={`inline-block w-2 h-2 rounded-full flex-shrink-0 ${
                                                           bulletColor === 'green' ? 'bg-green-500' :
                                                           bulletColor === 'yellow' ? 'bg-yellow-500' :
                                                           'bg-red-500'
                                                         }`}
                                                         style={{ width: '8px', height: '8px', flexShrink: 0 }}
                                                       />
                                                       <span className="text-sm text-gray-900">
                                                         {impact.levelText}
                                                       </span>
                                                     </div>
                                                   </td>
                                                   <td className="px-2 py-2 text-center">
                                                     <span className="text-sm text-gray-700">
                                                       {(impact.marketShare * 100).toFixed(1)}%
                                                     </span>
                                                   </td>
                                                   <td className="px-2 py-2 text-center">
                                                     <span className={`text-sm font-medium ${
                                                       isSelected ? 'text-gray-600' :
                                                       isPositive ? 'text-green-600' : isNegative ? 'text-red-600' : 'text-gray-600'
                                                     }`}>
                                                       {isSelected ? '-' : `${isPositive ? '+' : ''}${(impact.change * 100).toFixed(1)}%`}
                                                     </span>
                                                   </td>
                                                 </tr>
                                               );
                                             });
                                           })()}
                                         </tbody>
                                       </table>
                                     </div>
                                   ) : (
                                     <div className="text-sm text-gray-600">No impact data available</div>
                                   )}
                                 </td>
                               </tr>
                             )}
                          </React.Fragment>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Right Panel - Market Share */}
        <div className="flex-1 bg-white border-l border-gray-200 overflow-auto">
          <div className="p-3">
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-base font-semibold text-gray-900">Market Share</h3>
            </div>
            
            <div className="space-y-2">
              {/* Market Share Table */}
              <div>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-gray-300">
                        <th className="text-left px-2 py-1.5 text-xs font-semibold text-gray-800">Product</th>
                        <th className="text-center px-2 py-1.5 text-xs font-semibold text-gray-800">Current</th>
                        {scenarioAnalysis && (
                          <>
                            <th className="text-center px-2 py-1.5 text-xs font-semibold text-gray-800">Future</th>
                            <th className="text-center px-2 py-1.5 text-xs font-semibold text-gray-800">Change</th>
                          </>
                        )}
                      </tr>
                    </thead>
                    <tbody>
                      {/* Current Market Share Products */}
                      {marketShareProducts.map((product, index) => {
                        const currentShareValue = Number(product.currentShare ?? 0);
                        
                        let adjustedShareValue = currentShareValue;
                        let changePercentPoints = 0;
                        
                        if (scenarioAnalysis?.projectedScenarios?.[0]) {
                          const scenarioProducts = scenarioAnalysis.projectedScenarios[0].products || [];
                          // Find the existing product (not the new one - new products have currentShare === 0)
                          const scenarioProduct = scenarioProducts.find((p: any) => {
                            const isExistingProduct = Number(p.currentShare ?? 0) > 0.001;
                            const matchesProduct = p.name === product.name || 
                                                   (p.rowNumber && product.rowNumber && p.rowNumber === product.rowNumber);
                            return isExistingProduct && matchesProduct;
                          });
                          
                          if (scenarioProduct) {
                            adjustedShareValue = Number(scenarioProduct.marketShare ?? currentShareValue);
                            changePercentPoints = (adjustedShareValue - currentShareValue) * 100;
                          }
                        }
                        
                        const hasChange = Math.abs(changePercentPoints) > 0.0001;
                        const isPositive = changePercentPoints > 0;
                        const isNegative = changePercentPoints < 0;
                        
                        return (
                          <tr key={`current-${index}`} className="border-b border-gray-200">
                            <td className="px-2 py-1.5 text-gray-900">{product.name}</td>
                            <td className="px-2 py-1.5 text-center text-gray-700 font-semibold">{(currentShareValue * 100).toFixed(1)}%</td>
                            {scenarioAnalysis && (
                              <>
                                <td className={`px-2 py-1.5 text-center font-medium ${hasChange ? 'text-blue-600' : 'text-gray-700'}`}>
                                  {(adjustedShareValue * 100).toFixed(1)}%
                                </td>
                                <td className={`px-2 py-1.5 text-center italic ${
                                  isPositive ? 'text-green-600' : isNegative ? 'text-red-600' : 'text-gray-700'
                                }`}>
                                  {hasChange && (isPositive ? '+' : '')}{changePercentPoints.toFixed(1)}<span className="italic">%</span>
                                </td>
                              </>
                            )}
                          </tr>
                        );
                      })}
                      
                      {/* New Product from Selected Scenario */}
                      {selectedScenario && scenarioAnalysis?.projectedScenarios?.[0] && (() => {
                        const scenarioProducts = scenarioAnalysis.projectedScenarios[0].products || [];
                        const newProduct = scenarioProducts.length > 0 
                          ? scenarioProducts[scenarioProducts.length - 1]
                          : null;
                        
                        if (!newProduct) return null;
                        
                        const currentShareValue = Number(newProduct.currentShare ?? 0);
                        if (currentShareValue > 0.001) return null;
                        
                        const futureShare = Number(newProduct.marketShare ?? 0);
                        const change = Number(newProduct.change ?? 0) * 100;
                        const isPositive = change > 0;
                        const isNegative = change < 0;
                        
                        return (
                          <tr className="border-b border-gray-200">
                            <td className="px-2 py-1.5 text-gray-900">{selectedScenario.name}</td>
                            <td className="px-2 py-1.5 text-center text-gray-700 font-semibold">{(currentShareValue * 100).toFixed(1)}%</td>
                            <td className="px-2 py-1.5 text-center font-medium text-blue-600">
                              {(futureShare * 100).toFixed(1)}%
                            </td>
                            <td className={`px-2 py-1.5 text-center italic ${
                              isPositive ? 'text-green-600' : isNegative ? 'text-red-600' : 'text-gray-700'
                            }`}>
                              {isPositive ? '+' : ''}{change.toFixed(1)}<span className="italic">%</span>
                            </td>
                          </tr>
                        );
                      })()}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          </div>
        </div>
        </div>
      )}
    </div>
  );
}

