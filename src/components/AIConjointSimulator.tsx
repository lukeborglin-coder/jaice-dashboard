import React, { useState, useEffect, useMemo, useRef } from 'react';
import { API_BASE_URL, CONJOINT_BACKEND_ENABLED } from '../config';
import { IconDeviceFloppy, IconRefresh, IconPlus, IconInfoCircle } from '@tabler/icons-react';

interface AIConjointSimulatorProps {
  workflow: any;
  onClose?: () => void;
  dataOnly?: boolean;
  onWorkflowUpdate?: () => void;
}

interface AttributeLevel {
  levelNo: string;
  levelText: string;
  code: string;
}

interface Attribute {
  attributeNo: string;
  attributeText: string;
  levels: AttributeLevel[];
}

interface Scenario {
  id: string;
  name: string;
  enabled: boolean;
  selections: Record<string, string>;
}

interface SavedScenario {
  id: string;
  name: string;
  selections: Record<string, string>;
  createdAt: string;
}

interface ActiveScenario {
  id: string;
  name: string;
  analysis?: any;
}

interface MarketShareProduct {
  name: string;
  currentShare: number;
  adjustedShare?: number;
  rowNumber?: number;
}

export default function AIConjointSimulator({ workflow, onClose, dataOnly = false, onWorkflowUpdate }: AIConjointSimulatorProps) {
  const [attributes, setAttributes] = useState<Attribute[]>([]);
  const [scenarios, setScenarios] = useState<Scenario[]>([
    { id: 'scenario1', name: 'Scenario 1', enabled: true, selections: {} }
  ]);
  const [marketShareProducts, setMarketShareProducts] = useState<MarketShareProduct[]>([]);
  const [simulating, setSimulating] = useState(false);
  const [dataFile, setDataFile] = useState<File | null>(null);
  const [uploadingData, setUploadingData] = useState(false);
  const [clearingData, setClearingData] = useState(false);
  const clearingDataRef = useRef(false);
  const [dataUploaded, setDataUploaded] = useState(false);
  const [surveyData, setSurveyData] = useState<any>(null);
  const [estimating, setEstimating] = useState(false);
  const [estimationError, setEstimationError] = useState<string | null>(null);
  const [savedScenarios, setSavedScenarios] = useState<SavedScenario[]>([]);
  const [activeScenarios, setActiveScenarios] = useState<ActiveScenario[]>([]);
  const [showSaveScenarioModal, setShowSaveScenarioModal] = useState(false);
  const [scenarioNameToSave, setScenarioNameToSave] = useState('');
  const [selectedScenarioIds, setSelectedScenarioIds] = useState<Set<string>>(new Set());
  const [showScenarioDropdown, setShowScenarioDropdown] = useState(false);
  const [showDebugPanel, setShowDebugPanel] = useState(false);

  // Load persisted scenario selections and saved scenarios
  useEffect(() => {
    if (!workflow?.id) return;
    
    const storageKey = `conjoint_scenarios_${workflow.id}`;
    const savedKey = `conjoint_saved_scenarios_${workflow.id}`;
    
    // Load persisted scenario selections
    try {
      const persisted = localStorage.getItem(storageKey);
      if (persisted) {
        const parsed = JSON.parse(persisted);
        if (parsed.scenarios && Array.isArray(parsed.scenarios) && parsed.scenarios.length > 0) {
          setScenarios(parsed.scenarios);
        }
      }
    } catch (e) {
      console.error('Failed to load persisted scenarios:', e);
    }
    
    // Load saved scenarios
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
  }, [workflow?.id]);

  // Persist scenario selections whenever they change
  useEffect(() => {
    if (!workflow?.id) return;
    
    const storageKey = `conjoint_scenarios_${workflow.id}`;
    try {
      localStorage.setItem(storageKey, JSON.stringify({ scenarios }));
    } catch (e) {
      console.error('Failed to persist scenarios:', e);
    }
  }, [scenarios, workflow?.id]);

  // Close dropdown when clicking outside
  useEffect(() => {
    if (!showScenarioDropdown) return;

    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as HTMLElement;
      if (!target.closest('.scenario-dropdown-container')) {
        setShowScenarioDropdown(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [showScenarioDropdown]);

  useEffect(() => {
    // Skip entirely if we're in the middle of clearing data
    // Use both state and ref to catch all race conditions
    // This prevents race conditions where the workflow prop updates before we're done clearing
    if (clearingData || clearingDataRef.current) {
      console.log('AIConjointSimulator - Skipping useEffect because clearingData is true');
      return;
    }

    console.log('AIConjointSimulator - workflow:', workflow);
    console.log('AIConjointSimulator - workflow keys:', workflow ? Object.keys(workflow) : 'workflow is null/undefined');
    console.log('AIConjointSimulator - aiAnalysis:', workflow?.aiAnalysis);
    console.log('AIConjointSimulator - aiAnalysis type:', typeof workflow?.aiAnalysis);
    console.log('AIConjointSimulator - aiGenerated:', workflow?.aiGenerated);
    console.log('AIConjointSimulator - workflow.attributes:', workflow?.attributes);
    console.log('AIConjointSimulator - workflow.attributes length:', Array.isArray(workflow?.attributes) ? workflow.attributes.length : 'not array');
    console.log('AIConjointSimulator - aiAnalysis.attributes:', workflow?.aiAnalysis?.attributes);
    console.log('AIConjointSimulator - aiAnalysis.attributes length:', Array.isArray(workflow?.aiAnalysis?.attributes) ? workflow.aiAnalysis.attributes.length : 'not array');
    
    // Check for attributes in multiple possible locations
    // Priority 1: Check workflow.attributes (normalized format) - this is the most reliable source
    // This is where normalizedAttributes from Step 2 are stored
    if (workflow?.attributes && Array.isArray(workflow.attributes) && workflow.attributes.length > 0) {
      console.log('AIConjointSimulator - ✓ Found attributes in workflow.attributes (normalized format)');
      console.log('AIConjointSimulator - workflow.attributes length:', workflow.attributes.length);
      console.log('AIConjointSimulator - workflow.attributes sample (first 2):', workflow.attributes.slice(0, 2));
      
      // Group normalized attributes by attributeNo
      const attributeMap = new Map();
      workflow.attributes.forEach((attr: any) => {
        const key = String(attr.attributeNo || '').trim();
        if (!key) return;
        
        if (!attributeMap.has(key)) {
          attributeMap.set(key, {
            attributeNo: key,
            attributeText: attr.attributeText || '',
            levels: []
          });
        }
        
        attributeMap.get(key).levels.push({
          levelNo: String(attr.levelNo || ''),
          levelText: attr.levelText || '',
          code: String(attr.code || attr.levelNo || '')
        });
      });
      
      const processedAttributes = Array.from(attributeMap.values());
      setAttributes(processedAttributes);
      console.log('AIConjointSimulator - processed attributes from normalized format:', processedAttributes);
    } else if (workflow?.aiAnalysis?.attributes && Array.isArray(workflow.aiAnalysis.attributes) && workflow.aiAnalysis.attributes.length > 0) {
      // Priority 2: Check aiAnalysis.attributes (grouped format)
      console.log('AIConjointSimulator - Found attributes in aiAnalysis.attributes');
      console.log('AIConjointSimulator - raw attributes:', workflow.aiAnalysis.attributes);
      
      // The AI analysis already returns attributes with grouped levels
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
      console.log('AIConjointSimulator - processed attributes:', processedAttributes);
    } else if (workflow?.attributes && Array.isArray(workflow.attributes) && workflow.attributes.length > 0) {
      // Fallback: try to use normalizedAttributes if available
      console.log('AIConjointSimulator - Found attributes in workflow.attributes (normalized format)');
      console.log('AIConjointSimulator - workflow.attributes length:', workflow.attributes.length);
      
      // Group normalized attributes by attributeNo
      const attributeMap = new Map();
      workflow.attributes.forEach((attr: any) => {
        const key = String(attr.attributeNo || '').trim();
        if (!key) return;
        
        if (!attributeMap.has(key)) {
          attributeMap.set(key, {
            attributeNo: key,
            attributeText: attr.attributeText || '',
            levels: []
          });
        }
        
        attributeMap.get(key).levels.push({
          levelNo: String(attr.levelNo || ''),
          levelText: attr.levelText || '',
          code: String(attr.code || attr.levelNo || '')
        });
      });
      
      const processedAttributes = Array.from(attributeMap.values());
      setAttributes(processedAttributes);
      console.log('AIConjointSimulator - processed attributes from normalized format:', processedAttributes);
    } else {
      // Final fallback: check workflow.attributes (normalized format) even if empty array check failed
      if (workflow?.attributes && Array.isArray(workflow.attributes)) {
        console.log('AIConjointSimulator - Trying fallback: workflow.attributes (even if initially empty)');
        console.log('AIConjointSimulator - workflow.attributes length:', workflow.attributes.length);
        console.log('AIConjointSimulator - workflow.attributes sample:', workflow.attributes.slice(0, 3));
        
        // Group normalized attributes by attributeNo
        const attributeMap = new Map();
        workflow.attributes.forEach((attr: any) => {
          const key = String(attr.attributeNo || '').trim();
          if (!key) return;
          
          if (!attributeMap.has(key)) {
            attributeMap.set(key, {
              attributeNo: key,
              attributeText: attr.attributeText || '',
              levels: []
            });
          }
          
          attributeMap.get(key).levels.push({
            levelNo: String(attr.levelNo || ''),
            levelText: attr.levelText || '',
            code: String(attr.code || attr.levelNo || '')
          });
        });
        
        const processedAttributes = Array.from(attributeMap.values());
        if (processedAttributes.length > 0) {
          setAttributes(processedAttributes);
          console.log('AIConjointSimulator - Successfully loaded attributes from workflow.attributes:', processedAttributes.length);
          return; // Exit early since we found attributes
        }
      }
      
      console.warn('AIConjointSimulator - No attributes found in workflow');
      console.warn('AIConjointSimulator - aiAnalysis.attributes:', workflow?.aiAnalysis?.attributes);
      console.warn('AIConjointSimulator - workflow.attributes:', workflow?.attributes);
      console.warn('AIConjointSimulator - workflow structure sample:', {
        hasAiAnalysis: !!workflow?.aiAnalysis,
        aiAnalysisKeys: workflow?.aiAnalysis ? Object.keys(workflow.aiAnalysis) : [],
        hasAttributes: !!workflow?.attributes,
        attributesType: Array.isArray(workflow?.attributes) ? 'array' : typeof workflow?.attributes,
        attributesLength: Array.isArray(workflow?.attributes) ? workflow.attributes.length : 'N/A'
      });
      setAttributes([]);
    }

    // Check if survey data is already uploaded
    // Only skip loading if we're actively clearing data (not just because dataUploaded is false)
    // After a page reload, dataUploaded will be false, but we should still load if workflow has data
    const shouldLoadSurveyData = (workflow?.survey || workflow?.surveyUploadedAt) && !clearingData && !clearingDataRef.current;
    
    if (shouldLoadSurveyData) {
      console.log('AIConjointSimulator - Survey data already uploaded:', workflow.survey);
      
      // Load survey data from workflow
      if (workflow.survey) {
        // Always update dataUploaded when workflow has survey data (unless actively uploading)
        if (!uploadingData) {
          setDataUploaded(true);
        }
        const surveySummary = workflow.survey.summary;
        
        // Set survey data
        setSurveyData({
          workflow: workflow,
          summary: surveySummary,
          detailedBreakdown: surveySummary?.dataSummary ? {
            totalRows: surveySummary.dataSummary.totalRows,
            relevantColumnCount: surveySummary.dataSummary.relevantColumnCount,
            choiceColumns: surveySummary.dataSummary.choiceColumns,
            marketShareColumns: surveySummary.dataSummary.marketShareColumns,
            attributeColumns: surveySummary.dataSummary.attributeColumns,
            marketShareScenarios: {
              original: Array.isArray(surveySummary.marketShareScenarios?.original)
                ? surveySummary.marketShareScenarios.original.length
                : surveySummary.marketShareScenarios?.original || 0,
              withNewOptions: Array.isArray(surveySummary.marketShareScenarios?.withNewOptions)
                ? surveySummary.marketShareScenarios.withNewOptions.length
                : surveySummary.marketShareScenarios?.withNewOptions || 0,
              details: surveySummary.marketShareScenarios
            },
            products: surveySummary.products
          } : null
        });

        // Load market share products from uploaded survey data
        if (Array.isArray(surveySummary?.marketShareProducts) && surveySummary.marketShareProducts.length > 0) {
          console.log('Raw market share products from workflow:', surveySummary.marketShareProducts);
          const normalizedProducts = surveySummary.marketShareProducts.map((product: any) => {
            // Parse currentShare - handle both decimal (0-1) and percentage (0-100) formats
            let currentShare = 0;
            if (typeof product.currentShare === 'number') {
              currentShare = product.currentShare;
              // If it's a percentage (greater than 1), convert to decimal
              if (currentShare > 1) {
                currentShare = currentShare / 100;
              }
            } else if (typeof product.currentShare === 'string') {
              const parsed = parseFloat(product.currentShare);
              if (!isNaN(parsed)) {
                currentShare = parsed > 1 ? parsed / 100 : parsed;
              }
            }

            // Parse adjustedShare similarly
            let adjustedShare = currentShare;
            if (typeof product.adjustedShare === 'number') {
              adjustedShare = product.adjustedShare;
              if (adjustedShare > 1) {
                adjustedShare = adjustedShare / 100;
              }
            } else if (typeof product.adjustedShare === 'string') {
              const parsed = parseFloat(product.adjustedShare);
              if (!isNaN(parsed)) {
                adjustedShare = parsed > 1 ? parsed / 100 : parsed;
              }
            }

            return {
              name: product.name || `Product ${product.rowNumber || ''}`.trim(),
              currentShare,
              adjustedShare,
              rowNumber: product.rowNumber
            };
          });

          console.log('Normalized market share products:', normalizedProducts);
          setMarketShareProducts(normalizedProducts);
        } else {
          console.warn('No market share products found in survey summary:', surveySummary);
        }
      }
    } else {
      // No survey data - clear survey data state if it exists
      // Only clear if we're not currently in the middle of an operation
      // IMPORTANT: Skip this if clearingData is true - we've already cleared manually
      if (!uploadingData && !clearingData) {
        // Only clear if the state is currently set (avoid unnecessary state updates)
        if (dataUploaded || surveyData) {
          setDataUploaded(false);
          setSurveyData(null);
        }
      }
      
      // Initialize market share products from AI analysis if no survey data
      // Only do this if we're not currently clearing data
      if (!clearingData && workflow?.aiAnalysis?.products) {
        const products = workflow.aiAnalysis.products.map((product: string) => ({
          name: product,
          currentShare: 0,
          adjustedShare: 0
        }));
        setMarketShareProducts(products);
      }
    }
  }, [workflow, clearingData, uploadingData]);

  const updateScenarioSelection = (scenarioId: string, attributeNo: string, levelCode: string) => {
    setScenarios(prev => prev.map(scenario => 
      scenario.id === scenarioId 
        ? { ...scenario, selections: { ...scenario.selections, [attributeNo]: levelCode } }
        : scenario
    ));
  };

  const saveCurrentScenario = () => {
    if (!scenarioNameToSave.trim()) {
      alert('Please enter a name for the scenario');
      return;
    }
    
    if (scenarios.length === 0) {
      alert('No scenario to save');
      return;
    }
    
    const currentScenario = scenarios[0];
    if (!currentScenario || Object.keys(currentScenario.selections).length === 0) {
      alert('Please select at least one attribute level before saving');
      return;
    }
    
    // Check for duplicate selections (exact same level combinations)
    const currentSelectionsStr = JSON.stringify(currentScenario.selections);
    const duplicateScenario = savedScenarios.find(saved => {
      const savedSelectionsStr = JSON.stringify(saved.selections);
      return savedSelectionsStr === currentSelectionsStr;
    });
    
    if (duplicateScenario) {
      alert(`A scenario with the exact same attribute levels already exists: "${duplicateScenario.name}"`);
      return;
    }
    
    const newSavedScenario: SavedScenario = {
      id: `saved_${Date.now()}`,
      name: scenarioNameToSave.trim(),
      selections: { ...currentScenario.selections },
      createdAt: new Date().toISOString()
    };
    
    const updated = [...savedScenarios, newSavedScenario];
    setSavedScenarios(updated);
    
    // Persist to localStorage
    if (workflow?.id) {
      const savedKey = `conjoint_saved_scenarios_${workflow.id}`;
      try {
        localStorage.setItem(savedKey, JSON.stringify(updated));
      } catch (e) {
        console.error('Failed to save scenario:', e);
      }
    }
    
    setScenarioNameToSave('');
    setShowSaveScenarioModal(false);
    alert(`Scenario "${newSavedScenario.name}" saved successfully!`);
  };

  const toggleScenarioSelection = (scenarioId: string) => {
    setSelectedScenarioIds(prev => {
      const newSet = new Set(prev);
      if (newSet.has(scenarioId)) {
        newSet.delete(scenarioId);
      } else {
        newSet.add(scenarioId);
      }
      return newSet;
    });
  };

  const addSelectedScenariosToView = async () => {
    if (selectedScenarioIds.size === 0) {
      alert('Please select at least one scenario to add');
      return;
    }

    if (activeScenarios.length + selectedScenarioIds.size > 10) {
      alert('Maximum 10 scenarios can be displayed at once');
      return;
    }

    // Check if any selected scenarios are already added
    const alreadyAdded = Array.from(selectedScenarioIds).filter(id => 
      activeScenarios.some(s => s.id === id)
    );
    
    if (alreadyAdded.length > 0) {
      alert('Some selected scenarios are already added to the view');
      return;
    }

    // Get scenarios to add
    const scenariosToAdd = savedScenarios.filter(s => selectedScenarioIds.has(s.id));
    
    // Check for duplicate names
    const existingProductNames = new Set(
      activeScenarios
        .filter(s => s.id !== 'scenario1')
        .map(s => s.name)
    );
    
    const duplicateNames = scenariosToAdd
      .map(s => s.name)
      .filter(name => existingProductNames.has(name));
    
    if (duplicateNames.length > 0) {
      alert(`Cannot add scenarios with duplicate names: ${duplicateNames.join(', ')}\n\nPlease rename or remove existing scenarios first.`);
      return;
    }

    // Add all selected scenarios
    for (const savedScenario of scenariosToAdd) {
      await runScenarioAnalysis(savedScenario.selections, savedScenario.name, savedScenario.id);
    }

    // Clear selections and close dropdown
    setSelectedScenarioIds(new Set());
    setShowScenarioDropdown(false);
  };

  const removeActiveScenario = (scenarioId: string) => {
    setActiveScenarios(prev => prev.filter(s => s.id !== scenarioId));
  };

  const loadSavedScenarioIntoSimulator = (scenarioId: string) => {
    // Find the saved scenario by ID
    const savedScenario = savedScenarios.find(s => s.id === scenarioId);
    if (!savedScenario) {
      alert('Scenario not found');
      return;
    }
    
    // Load the selections into the current scenario
    if (scenarios.length === 0) {
      setScenarios([{
        id: 'scenario1',
        name: 'Scenario 1',
        enabled: true,
        selections: { ...savedScenario.selections }
      }]);
    } else {
      setScenarios(prev => prev.map(scenario => 
        scenario.id === scenarios[0].id
          ? { ...scenario, selections: { ...savedScenario.selections } }
          : scenario
      ));
    }
  };

  const runScenarioAnalysis = async (selections?: Record<string, string>, scenarioName?: string, scenarioId?: string) => {
    // Use provided selections or current scenario selections
    const selectionsToUse = selections || scenarios[0]?.selections || {};
    const nameToUse = scenarioName || scenarios[0]?.name || 'Scenario';
    const idToUse = scenarioId || `scenario_${Date.now()}`;

    if (!CONJOINT_BACKEND_ENABLED) {
      alert('Conjoint backend is disabled (UI-only mode).');
      return;
    }
    
    if (!workflow?.id) {
      alert('Workflow not found');
      return;
    }

    const estimationData = workflow?.estimationResult || workflow?.estimation;
    if (!estimationData) {
      alert('Please estimate utilities first before running scenario analysis');
      return;
    }

    // Validate that all attributes have selections
    const missingSelections = attributes.filter(attr => !selectionsToUse[attr.attributeNo]);
    if (missingSelections.length > 0) {
      alert(`Please select all attribute levels. Missing: ${missingSelections.map(a => a.attributeText).join(', ')}`);
      return;
    }

    setSimulating(true);
    try {
      const schemaAttributes = estimationData?.schema?.attributes || [];
      
      // Build attribute mapping (same as before)
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
      Object.entries(selectionsToUse).forEach(([attributeId, levelId]) => {
        const attribute = attributes.find(attr => attr.attributeNo === attributeId);
        const level = attribute?.levels.find(lvl => lvl.levelNo === levelId || lvl.code === levelId);
        
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
      
      // Log the scenario data being sent for debugging
      console.log('[runScenarioAnalysis] Selections to use:', selectionsToUse);
      console.log('[runScenarioAnalysis] Mapped scenario data:', scenarioData);
      console.log('[runScenarioAnalysis] Attributes:', attributes.map(a => ({ no: a.attributeNo, text: a.attributeText })));

      const token = localStorage.getItem('cognitive_dash_token');
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

      if (!response.ok) {
        let errorMessage = 'Failed to run scenario analysis';
        try {
          const errorData = await response.json();
          errorMessage = errorData.detail || errorData.message || errorMessage;
          console.error('[runScenarioAnalysis] Error response:', errorData);
        } catch (e) {
          const errorText = await response.text();
          errorMessage = errorText || errorMessage;
          console.error('[runScenarioAnalysis] Error response (text):', errorText);
        }
        throw new Error(errorMessage);
      }

      const result = await response.json();
      
      console.log('[runScenarioAnalysis] Scenario data sent:', scenarioData);
      console.log('[runScenarioAnalysis] Full response:', result);
      console.log('[runScenarioAnalysis] Analysis result:', result.scenarioAnalysis);
      console.log('[runScenarioAnalysis] Diagnostics:', result.scenarioAnalysis?.diagnostics);
      
      // Check if scenarioAnalysis exists
      if (!result.scenarioAnalysis) {
        console.error('[runScenarioAnalysis] No scenarioAnalysis in response:', result);
        throw new Error('No scenario analysis data in response');
      }
      
      // If this is the current scenario (not a saved scenario), add it to activeScenarios with id 'scenario1'
      if (!selections && scenarios.length > 0) {
        // Current scenario - add to activeScenarios with id 'scenario1'
        setActiveScenarios(prev => {
          const existing = prev.find(s => s.id === 'scenario1');
          if (existing) {
            return prev.map(s => s.id === 'scenario1' ? { ...s, name: scenarios[0].name, analysis: result.scenarioAnalysis } : s);
          }
          return [...prev, { id: 'scenario1', name: scenarios[0].name, analysis: result.scenarioAnalysis }];
        });
        
        // Update scenarioAnalysis state for backward compatibility
        setScenarioAnalysis(result.scenarioAnalysis);
        
        // DON'T update marketShareProducts with all products - keep original products
        // Only update their adjusted shares will be shown in the display logic
        // This prevents new products from appearing in the main product list
      } else {
        // Saved scenario - add to activeScenarios
        setActiveScenarios(prev => {
          const existing = prev.find(s => s.id === idToUse);
          if (existing) {
            return prev.map(s => s.id === idToUse ? { ...s, analysis: result.scenarioAnalysis } : s);
          }
          return [...prev, { id: idToUse, name: nameToUse, analysis: result.scenarioAnalysis }];
        });
      }
      
    } catch (error: any) {
      console.error('Scenario analysis error:', error);
      alert('Failed to run scenario analysis: ' + error.message);
    } finally {
      setSimulating(false);
    }
  };

  const toggleScenarioEnabled = (scenarioId: string) => {
    setScenarios(prev => prev.map(scenario => 
      scenario.id === scenarioId 
        ? { ...scenario, enabled: !scenario.enabled }
        : scenario
    ));
  };

  const generateRandomSelections = () => {
    if (scenarios.length === 0 || attributes.length === 0) {
      return;
    }
    
    const randomSelections: Record<string, string> = {};
    attributes.forEach(attribute => {
      if (attribute.levels && attribute.levels.length > 0) {
        const randomIndex = Math.floor(Math.random() * attribute.levels.length);
        const randomLevel = attribute.levels[randomIndex];
        randomSelections[attribute.attributeNo] = randomLevel.levelNo;
      }
    });
    
    setScenarios(prev => prev.map(scenario => 
      scenario.id === scenarios[0].id
        ? { ...scenario, selections: randomSelections }
        : scenario
    ));
  };

  const uploadSurveyData = async (fileToUpload?: File) => {
    const file = fileToUpload || dataFile;
    if (!file) {
      alert('Please select a data file first');
      return;
    }

    if (!CONJOINT_BACKEND_ENABLED) {
      alert('Conjoint backend is disabled (UI-only mode).');
      return;
    }

    // Prevent double uploads
    if (uploadingData) {
      console.log('[Upload] Upload already in progress, skipping');
      return;
    }

    setUploadingData(true);
    try {
      const formData = new FormData();
      formData.append('file', file);
      formData.append('workflowId', workflow.id);

      const token = localStorage.getItem('cognitive_dash_token');
      
      // Use AI-powered data processing endpoint for AI workflows
      const endpoint = workflow.aiGenerated 
        ? `${API_BASE_URL}/api/conjoint/ai-workflow/process-data`
        : `${API_BASE_URL}/api/conjoint/workflows/${workflow.id}/survey`;
      
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`
        },
        body: formData
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.detail || 'Failed to upload survey data');
      }

      const result = await response.json();
      
      // Update local state immediately with the result data
      // This ensures the UI shows the uploaded data right away
      setSurveyData(result);
      setDataFile(file);
      
      // Extract survey data from result to set dataUploaded
      const hasSurveyData = result.workflow?.survey || result.survey || result.summary;
      if (hasSurveyData) {
        setDataUploaded(true);
      }

      // Update market share products with real data from result
      const marketShareProductsSource =
        (Array.isArray(result.summary?.marketShareProducts) && result.summary?.marketShareProducts) ||
        (Array.isArray(result.workflow?.survey?.summary?.marketShareProducts) && result.workflow.survey.summary.marketShareProducts) ||
        (Array.isArray(result.dataSummary?.marketShareProducts) && result.dataSummary.marketShareProducts);

      if (Array.isArray(marketShareProductsSource)) {
        const normalizedProducts = marketShareProductsSource.map((product: any) => {
          const currentShare = typeof product.currentShare === 'number'
            ? product.currentShare
            : parseFloat(product.currentShare) || 0;

          const adjustedShare = typeof product.adjustedShare === 'number'
            ? product.adjustedShare
            : parseFloat(product.adjustedShare) || currentShare;

          return {
            name: product.name || `Product ${product.rowNumber || ''}`.trim(),
            currentShare,
            adjustedShare,
            rowNumber: product.rowNumber
          };
        });

        console.log('Normalized market share products:', normalizedProducts);
        setMarketShareProducts(normalizedProducts);
      }

      // Show detailed preprocessing results from result
      const workflowSummary = result.summary ?? result.workflow?.survey?.summary;
      if (workflowSummary?.dataSummary) {
        const dataSummary = workflowSummary.dataSummary;
        console.log('Data processing results:', dataSummary);
        
        // Update state with detailed results
        setSurveyData({
          ...result,
          detailedBreakdown: {
            totalRows: dataSummary.totalRows,
            relevantColumnCount: dataSummary.relevantColumnCount,
            choiceColumns: dataSummary.choiceColumns,
            marketShareColumns: dataSummary.marketShareColumns,
            attributeColumns: dataSummary.attributeColumns,
            marketShareScenarios: {
              original: Array.isArray(workflowSummary.marketShareScenarios?.original)
                ? workflowSummary.marketShareScenarios.original.length
                : workflowSummary.marketShareScenarios?.original || 0,
              withNewOptions: Array.isArray(workflowSummary.marketShareScenarios?.withNewOptions)
                ? workflowSummary.marketShareScenarios.withNewOptions.length
                : workflowSummary.marketShareScenarios?.withNewOptions || 0,
              details: workflowSummary.marketShareScenarios
            },
            products: workflowSummary.products
          }
        });
      }

      // Notify parent to refresh workflow data (for persistence)
      // This happens after local state is updated so UI is responsive
      if (onWorkflowUpdate) {
        await onWorkflowUpdate();
      }

      // Small delay to ensure workflow prop has been updated before estimating
      await new Promise(resolve => setTimeout(resolve, 100));

      // Automatically run estimation after successful upload
      try {
        await estimateUtilities();
      } catch (error) {
        console.error('Auto-estimation failed:', error);
        // Don't show error alert here - the estimateUtilities function will handle it
        // The yellow box will still appear to allow manual retry
      }

    } catch (error: any) {
      console.error('Upload error:', error);
      alert('Failed to upload survey data: ' + error.message);
    } finally {
      setUploadingData(false);
    }
  };

  const estimateUtilities = async () => {
    if (!CONJOINT_BACKEND_ENABLED) {
      alert('Conjoint backend is disabled (UI-only mode).');
      return;
    }

    setEstimating(true);
    setEstimationError(null);
    try {
      const token = localStorage.getItem('cognitive_dash_token');
      const response = await fetch(`${API_BASE_URL}/api/conjoint/workflows/${workflow.id}/estimate`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.detail || 'Failed to estimate utilities');
      }

      const result = await response.json();
      console.log('Estimation result:', result);

      // Notify parent to refresh workflow data to get updated estimation
      if (onWorkflowUpdate) {
        await onWorkflowUpdate();
      }
      
      // Don't reload the page - the parent component will update the workflow prop
      // which will cause this component to re-render with the updated data
    } catch (error: any) {
      console.error('Estimation error:', error);
      setEstimationError(error.message);
      alert('Failed to estimate utilities: ' + error.message);
    } finally {
      setEstimating(false);
    }
  };

  const clearUploadedData = async () => {
    if (clearingData) {
      return; // Prevent double-clicks
    }

    if (!confirm('Are you sure you want to remove all uploaded survey data? This will also clear any estimation results. This action cannot be undone.')) {
      return;
    }

    setClearingData(true);
    clearingDataRef.current = true;
    try {
      const token = localStorage.getItem('cognitive_dash_token');
      const url = `${API_BASE_URL}/api/conjoint/workflows/${workflow.id}/survey`;
      console.log('[Clear Data] Calling DELETE:', url);
      
      const response = await fetch(url, {
        method: 'DELETE',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        }
      });

      console.log('[Clear Data] Response status:', response.status, response.statusText);
      console.log('[Clear Data] Response headers:', response.headers);

      if (!response.ok) {
        // Try to get error message
        const contentType = response.headers.get('content-type');
        let errorMessage = 'Failed to remove survey data';
        
        if (contentType && contentType.includes('application/json')) {
          try {
            const errorData = await response.json();
            errorMessage = errorData.detail || errorData.message || errorMessage;
          } catch (e) {
            console.error('[Clear Data] Failed to parse error JSON:', e);
          }
        } else {
          // If it's HTML, get the text
          const text = await response.text();
          console.error('[Clear Data] Received HTML instead of JSON:', text.substring(0, 200));
          errorMessage = `Server returned ${response.status} ${response.statusText}. The endpoint may not be available.`;
        }
        
        throw new Error(errorMessage);
      }

      // Clear local state immediately to update UI (this is the source of truth)
      setDataUploaded(false);
      setDataFile(null);
      setSurveyData(null);
      setEstimationError(null);
      
      // Reset market share products to initial state
      if (workflow?.aiAnalysis?.products) {
        const products = workflow.aiAnalysis.products.map((product: string) => ({
          name: product,
          currentShare: 0,
          adjustedShare: 0
        }));
        setMarketShareProducts(products);
      }

      // Notify parent to refresh workflow data (for persistence)
      // This happens after local state is cleared so UI is responsive
      // Even if the backend returns stale data, our local state will override it
      if (onWorkflowUpdate) {
        await onWorkflowUpdate();
      }

      // Wait a moment for the workflow prop to update
      // We keep clearingData=true during this wait to prevent useEffect from reloading data
      // The useEffect will skip entirely while clearingData is true
      await new Promise(resolve => setTimeout(resolve, 300));
    } catch (error: any) {
      console.error('Error removing survey data:', error);
      alert('Failed to remove survey data: ' + error.message);
    } finally {
      // Wait a bit more before clearing the flag to ensure all effects have run
      await new Promise(resolve => setTimeout(resolve, 100));
      setClearingData(false);
      clearingDataRef.current = false;
    }
  };

  const [scenarioAnalysis, setScenarioAnalysis] = useState<any>(null);
  const [analyzingScenarios, setAnalyzingScenarios] = useState(false);

  const simulate = async () => {
    setAnalyzingScenarios(true);
    setSimulating(true);
    try {
      // Use the shared runScenarioAnalysis function for current scenario
      await runScenarioAnalysis();
      
      // Scroll to top of page after scenario analysis completes
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch (error: any) {
      console.error('Scenario analysis error:', error);
      alert(`Scenario analysis failed: ${error.message}`);
    } finally {
      setAnalyzingScenarios(false);
      setSimulating(false);
    }
  };

  const totalMarketShare = marketShareProducts.reduce((sum, product) => sum + (product.adjustedShare || product.currentShare), 0);

  // Check if all attributes have a level selected
  const allAttributesSelected = useMemo(() => {
    if (attributes.length === 0 || scenarios.length === 0) {
      return false;
    }
    const scenario = scenarios[0];
    return attributes.every(attr => {
      const selectedLevel = scenario.selections[attr.attributeNo];
      return selectedLevel && selectedLevel !== '';
    });
  }, [attributes, scenarios]);

  // New simplified upload component - completely isolated
  const SimpleUploadSection = () => {
    const [isUploading, setIsUploading] = useState(false);
    const [uploadStatus, setUploadStatus] = useState<'idle' | 'success' | 'error'>('idle');
    const [uploadMessage, setUploadMessage] = useState('');
    const [isDeleting, setIsDeleting] = useState(false);

    const handleUpload = async (file: File) => {
      if (!CONJOINT_BACKEND_ENABLED) {
        alert('Conjoint backend is disabled (UI-only mode).');
        return;
      }

      setIsUploading(true);
      setUploadStatus('idle');
      setUploadMessage('');

      try {
        const formData = new FormData();
        formData.append('file', file);
        formData.append('workflowId', workflow.id);

        const token = localStorage.getItem('cognitive_dash_token');
        const endpoint = workflow.aiGenerated 
          ? `${API_BASE_URL}/api/conjoint/ai-workflow/process-data`
          : `${API_BASE_URL}/api/conjoint/workflows/${workflow.id}/survey`;
        
        const response = await fetch(endpoint, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${token}`
          },
          body: formData
        });

        if (!response.ok) {
          const errorData = await response.json();
          throw new Error(errorData.detail || 'Failed to upload survey data');
        }

        const result = await response.json();
        setUploadStatus('success');
        setUploadMessage('File uploaded successfully! Processing...');

        // Wait a moment for the backend to process, then automatically estimate utilities
        await new Promise(resolve => setTimeout(resolve, 500));
        
        try {
          setUploadMessage('Estimating utilities...');
          const token = localStorage.getItem('cognitive_dash_token');
          const estimateUrl = `${API_BASE_URL}/api/conjoint/workflows/${workflow.id}/estimate`;
          
          const estimateResponse = await fetch(estimateUrl, {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${token}`
            }
          });

          if (!estimateResponse.ok) {
            let errorMessage = 'Failed to estimate utilities';
            try {
              const errorData = await estimateResponse.json();
              errorMessage = errorData.detail || errorData.message || errorMessage;
            } catch (e) {
              // If response is not JSON, try to get text
              try {
                const errorText = await estimateResponse.text();
                if (errorText) errorMessage = errorText;
              } catch (e2) {
                // Ignore if can't read response
              }
            }
            throw new Error(errorMessage);
          }

          // Refresh workflow data once at the end with both upload and estimation results
          if (onWorkflowUpdate) {
            await onWorkflowUpdate();
          }

          setUploadStatus('success');
          setUploadMessage('File uploaded and utilities estimated successfully!');
        } catch (estimateError: any) {
          console.error('Estimation error:', estimateError);
          // If estimation fails, still refresh to show the uploaded data
          if (onWorkflowUpdate) {
            await onWorkflowUpdate();
          }
          setUploadStatus('success');
          setUploadMessage('File uploaded successfully! Utilities estimation failed - you can estimate manually.');
        }

      } catch (error: any) {
        console.error('Upload error:', error);
        console.error('Upload error details:', error);
        setUploadStatus('error');
        const errorMessage = error.message || error.detail || 'Failed to upload file';
        setUploadMessage(errorMessage);
      } finally {
        setIsUploading(false);
      }
    };

    const handleDelete = async () => {
      if (!confirm('Are you sure you want to remove all uploaded survey data? This action cannot be undone.')) {
        return;
      }

      if (!CONJOINT_BACKEND_ENABLED) {
        alert('Conjoint backend is disabled (UI-only mode).');
        return;
      }

      setIsDeleting(true);
      try {
        const token = localStorage.getItem('cognitive_dash_token');
        const url = `${API_BASE_URL}/api/conjoint/workflows/${workflow.id}/survey`;
        
        const response = await fetch(url, {
          method: 'DELETE',
          headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json'
          }
        });

        if (!response.ok) {
          throw new Error('Failed to remove survey data');
        }

        // Refresh workflow data
        if (onWorkflowUpdate) {
          await onWorkflowUpdate();
        }
        // No need to reload - onWorkflowUpdate already refreshed the data

      } catch (error: any) {
        console.error('Delete error:', error);
        alert('Failed to remove survey data: ' + error.message);
      } finally {
        setIsDeleting(false);
      }
    };

    const hasData = workflow?.survey || workflow?.surveyUploadedAt;

    return (
      <div className="p-4 bg-green-50 border border-green-200 rounded-lg">
        <h3 className="text-sm font-semibold text-green-800 mb-3">Upload Survey Data</h3>
        
        {hasData ? (
          <div className="space-y-3">
            <div className="text-sm text-gray-700">
              <p><span className="font-medium">File:</span> {workflow?.survey?.fileName || 'Uploaded file'}</p>
              <p><span className="font-medium">Uploaded:</span> {
                workflow?.surveyUploadedAt 
                  ? new Date(workflow.surveyUploadedAt).toLocaleDateString(undefined, {
                      year: 'numeric',
                      month: 'short',
                      day: 'numeric',
                      hour: 'numeric',
                      minute: '2-digit'
                    })
                  : 'N/A'
              }</p>
            </div>
            <div className="flex gap-3">
              {CONJOINT_BACKEND_ENABLED && workflow?.survey?.storedFileName && (
                <a
                  href={`${API_BASE_URL}/api/conjoint/workflows/${workflow.id}/survey/download`}
                  download
                  className="px-3 py-2 bg-blue-600 text-white text-sm font-semibold rounded-lg hover:bg-blue-700 transition"
                >
                  Download
                </a>
              )}
              <button
                onClick={handleDelete}
                disabled={isDeleting}
                className="px-3 py-2 bg-red-600 text-white text-sm font-semibold rounded-lg hover:bg-red-700 transition disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isDeleting ? 'Removing...' : 'Remove Data'}
              </button>
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            <div className="relative">
              <input
                type="file"
                accept=".xlsx,.xls,.csv"
                onChange={(e) => {
                  const file = e.target.files?.[0] || null;
                  if (file) {
                    handleUpload(file);
                  }
                }}
                disabled={isUploading}
                className="hidden"
                id="simple-upload-input"
              />
              <label
                htmlFor="simple-upload-input"
                className={`inline-flex items-center px-4 py-2 bg-blue-600 text-white text-sm font-semibold rounded-lg hover:bg-blue-700 cursor-pointer transition ${
                  isUploading ? 'opacity-50 cursor-not-allowed' : ''
                }`}
              >
                {isUploading ? 'Uploading...' : 'Upload data file'}
              </label>
            </div>
            {uploadStatus === 'success' && (
              <p className="text-sm text-green-700">{uploadMessage}</p>
            )}
            {uploadStatus === 'error' && (
              <p className="text-sm text-red-700">{uploadMessage}</p>
            )}
          </div>
        )}
      </div>
    );
  };

  // Data upload section component (DISABLED - using SimpleUploadSection instead)
  const DataUploadSection = () => null;
      
  // Estimate Utilities Button - Show if data is uploaded but estimation hasn't been run
  const EstimateUtilitiesSection = () => {
    if (!dataUploaded || workflow?.estimation || workflow?.estimationResult) {
      return null;
    }
    
    return (
      <div className="mt-4 p-4 bg-yellow-50 border border-yellow-200 rounded-lg">
        <div className="flex items-center justify-between">
          <div className="flex-1">
            <h3 className="text-sm font-semibold text-yellow-900 mb-1">Ready to Estimate Utilities</h3>
            <p className="text-xs text-yellow-700 mb-3">
              Survey data has been processed. Click below to estimate utilities from the uploaded data.
            </p>
            {estimationError && (
              <p className="text-xs text-red-600 mb-2">{estimationError}</p>
            )}
            <button
              onClick={estimateUtilities}
              disabled={estimating}
              className="px-4 py-2 bg-yellow-600 text-white text-sm font-semibold rounded-lg disabled:opacity-50 disabled:cursor-not-allowed hover:bg-yellow-700 transition"
            >
              {estimating ? 'Estimating...' : 'Estimate Utilities'}
            </button>
          </div>
        </div>
      </div>
    );
  };

  // If dataOnly mode, show only the data upload section
  if (dataOnly) {
    return (
      <div className="min-h-full">
        <div className="bg-white border-b border-gray-200 px-6 py-4">
          <div>
            <h1 className="text-xl font-semibold text-gray-900">Data</h1>
            <p className="text-sm text-gray-600 mt-1">Upload your raw survey data file. This will intelligently analyze it to extract only the columns relevant to your conjoint analysis, using the datamap to understand code definitions.</p>
          </div>
        </div>
        
        <div className="px-6 py-6 bg-gray-50">
          <SimpleUploadSection />
          
          <div className="flex gap-6 mt-6">
            {/* Raw Survey Data Columns */}
            {(workflow?.survey?.summary?.dataSummary || surveyData?.workflow?.survey?.summary?.dataSummary || surveyData?.summary?.dataSummary) && (
              <div className="flex-1 p-4 bg-green-50 border border-green-200 rounded-lg">
                <h3 className="text-sm font-semibold text-green-800 mb-2">Survey Data Summary</h3>
                <div className="space-y-2 text-sm">
                  <div>
                    <span className="font-medium">Total Rows:</span>{' '}
                    <span className="font-semibold text-green-900">
                      {workflow?.survey?.summary?.dataSummary?.totalRows ||
                       surveyData?.workflow?.survey?.summary?.dataSummary?.totalRows ||
                       surveyData?.summary?.dataSummary?.totalRows ||
                       surveyData?.detailedBreakdown?.totalRows ||
                       'N/A'}
                    </span>
                  </div>
                  <div>
                    <span className="font-medium">Relevant Columns:</span> {
                      workflow?.survey?.summary?.dataSummary?.relevantColumnCount ||
                      surveyData?.workflow?.survey?.summary?.dataSummary?.relevantColumnCount ||
                      surveyData?.summary?.dataSummary?.relevantColumnCount || 
                      surveyData?.detailedBreakdown?.relevantColumnCount ||
                      'N/A'
                    }
                  </div>
                  <div>
                    <span className="font-medium">Choice Columns:</span> {
                      workflow?.survey?.summary?.dataSummary?.choiceColumns ||
                      surveyData?.workflow?.survey?.summary?.dataSummary?.choiceColumns ||
                      surveyData?.summary?.dataSummary?.choiceColumns ||
                      surveyData?.detailedBreakdown?.choiceColumns ||
                      'N/A'
                    }
                  </div>
                  <div>
                    <span className="font-medium">Market Share Columns:</span> {
                      workflow?.survey?.summary?.dataSummary?.marketShareColumns ||
                      surveyData?.workflow?.survey?.summary?.dataSummary?.marketShareColumns ||
                      surveyData?.summary?.dataSummary?.marketShareColumns ||
                      surveyData?.detailedBreakdown?.marketShareColumns ||
                      'N/A'
                    }
                  </div>
                  <div>
                    <span className="font-medium">Attribute Columns:</span>{' '}
                    {(() => {
                      const attributeColumns = workflow?.survey?.summary?.dataSummary?.attributeColumns ||
                        surveyData?.workflow?.survey?.summary?.dataSummary?.attributeColumns ||
                        surveyData?.summary?.dataSummary?.attributeColumns ||
                        surveyData?.detailedBreakdown?.attributeColumns;
                      
                      if (!attributeColumns) {
                        return 'N/A';
                      }
                      
                      if (Array.isArray(attributeColumns)) {
                        if (attributeColumns.length === 0) {
                          return '0 (none found)';
                        }
                        // Show count and first few columns, with option to see all
                        const displayCount = Math.min(attributeColumns.length, 5);
                        const remaining = attributeColumns.length - displayCount;
                        return (
                          <span>
                            {attributeColumns.length} total
                            {attributeColumns.length > 0 && (
                              <span className="ml-2 text-xs text-gray-600">
                                ({attributeColumns.slice(0, displayCount).join(', ')}
                                {remaining > 0 && ` + ${remaining} more`})
                              </span>
                            )}
                          </span>
                        );
                      }
                      
                      // If it's a number (old format), just show the count
                      if (typeof attributeColumns === 'number') {
                        return `${attributeColumns} (stored as count)`;
                      }
                      
                      // Fallback: try to convert to string
                      return String(attributeColumns);
                    })()}
                  </div>
                </div>
              </div>
            )}
            
            {/* Survey Response Options */}
            {((workflow?.survey?.summary?.marketShareProducts && workflow.survey.summary.marketShareProducts.length > 0) ||
              (surveyData?.workflow?.survey?.summary?.marketShareProducts && surveyData.workflow.survey.summary.marketShareProducts.length > 0) ||
              (marketShareProducts && marketShareProducts.length > 0)) && (
              <div className="flex-1 p-4 bg-green-50 border border-green-200 rounded-lg">
                <h3 className="text-sm font-semibold text-green-800 mb-2">
                  Survey Response Options {
                    workflow?.aiAnalysis?.marketShareQuestion 
                      ? `(${workflow.aiAnalysis.marketShareQuestion})` 
                      : `(${
                          (workflow?.survey?.summary?.marketShareProducts?.length || 0) ||
                          (surveyData?.workflow?.survey?.summary?.marketShareProducts?.length || 0) ||
                          (marketShareProducts?.length || 0)
                        })`
                  }
                </h3>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-green-300">
                        <th colSpan={2} className="text-left p-2 font-semibold text-green-800">Response Option</th>
                        <th className="text-center p-2 font-semibold text-green-800">Avg Share</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(workflow?.survey?.summary?.marketShareProducts || 
                        surveyData?.workflow?.survey?.summary?.marketShareProducts || 
                        marketShareProducts || [])
                        .sort((a: any, b: any) => (a.rowNumber || 0) - (b.rowNumber || 0))
                        .map((product: any, i: number) => (
                        <tr key={i} className="border-b border-green-200">
                          <td className="p-2 text-gray-700 w-auto whitespace-nowrap">{product.rowNumber || 'N/A'}</td>
                          <td className="p-2 text-gray-700">{product.name}</td>
                          <td className="p-2 text-center text-gray-700">
                            {product.currentShare ? `${(product.currentShare * 100).toFixed(1)}%` : 'N/A'}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>
          
          {/* Design to Data File Column Mapping */}
          {workflow?.survey?.summary?.columnMapping && (
            <div className="mt-6 p-4 bg-blue-50 border border-blue-200 rounded-lg">
              <h3 className="text-sm font-semibold text-blue-800 mb-3">Design Matrix to Data File Column Mapping</h3>
              <div className="overflow-x-auto">
                <table className="w-full text-sm border-collapse">
                  <thead>
                    <tr className="bg-blue-100 border-b-2 border-blue-300">
                      <th className="text-left p-2 font-semibold text-blue-800">Design Element</th>
                      <th className="text-left p-2 font-semibold text-blue-800">Data File Column(s)</th>
                      <th className="text-left p-2 font-semibold text-blue-800">Description</th>
                      <th className="text-left p-2 font-semibold text-blue-800">Pattern</th>
                    </tr>
                  </thead>
                  <tbody>
                    {workflow.survey.summary.columnMapping.columnMapping?.map((mapping: any, i: number) => (
                      <tr key={i} className="border-b border-blue-200 hover:bg-blue-50">
                        <td className="p-2 text-gray-800 font-medium">{mapping.designElement || 'N/A'}</td>
                        <td className="p-2 text-gray-700">
                          {mapping.dataFileColumns ? (
                            <div className="flex flex-wrap gap-1">
                              {Array.isArray(mapping.dataFileColumns) ? (
                                mapping.dataFileColumns.slice(0, 5).map((col: string, idx: number) => (
                                  <span key={idx} className="px-2 py-1 bg-gray-100 rounded text-xs font-mono">
                                    {col}
                                  </span>
                                ))
                              ) : (
                                <span className="px-2 py-1 bg-gray-100 rounded text-xs font-mono">
                                  {String(mapping.dataFileColumns)}
                                </span>
                              )}
                              {Array.isArray(mapping.dataFileColumns) && mapping.dataFileColumns.length > 5 && (
                                <span className="text-xs text-gray-500">
                                  +{mapping.dataFileColumns.length - 5} more
                                </span>
                              )}
                            </div>
                          ) : mapping.dataFileColumn ? (
                            <span className="px-2 py-1 bg-gray-100 rounded text-xs font-mono">
                              {mapping.dataFileColumn}
                            </span>
                          ) : (
                            <span className="text-gray-400">N/A</span>
                          )}
                        </td>
                        <td className="p-2 text-gray-600 text-xs">{mapping.description || 'N/A'}</td>
                        <td className="p-2 text-gray-600 text-xs font-mono">
                          {mapping.pattern || 'N/A'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              
              {/* Column Naming Convention Summary */}
              {workflow.survey.summary.columnMapping.columnNamingConvention && (
                <div className="mt-4 p-3 bg-white rounded border border-blue-200">
                  <h4 className="text-xs font-semibold text-blue-800 mb-2">Column Naming Convention</h4>
                  <div className="grid grid-cols-2 gap-3 text-xs">
                    <div>
                      <span className="font-medium text-gray-700">Task Extraction:</span>
                      <p className="text-gray-600 mt-1">
                        {workflow.survey.summary.columnMapping.columnNamingConvention.taskExtraction || 'N/A'}
                      </p>
                    </div>
                    <div>
                      <span className="font-medium text-gray-700">Concept Extraction:</span>
                      <p className="text-gray-600 mt-1">
                        {workflow.survey.summary.columnMapping.columnNamingConvention.conceptExtraction || 'N/A'}
                      </p>
                    </div>
                    <div>
                      <span className="font-medium text-gray-700">Attribute Extraction:</span>
                      <p className="text-gray-600 mt-1">
                        {workflow.survey.summary.columnMapping.columnNamingConvention.attributeExtraction || 'N/A'}
                      </p>
                    </div>
                    {workflow.survey.summary.columnMapping.columnNamingConvention.examples && (
                      <div>
                        <span className="font-medium text-gray-700">Examples:</span>
                        <div className="mt-1 space-y-1">
                          {Array.isArray(workflow.survey.summary.columnMapping.columnNamingConvention.examples) ? (
                            workflow.survey.summary.columnMapping.columnNamingConvention.examples.slice(0, 3).map((ex: string, idx: number) => (
                              <code key={idx} className="block text-xs bg-gray-100 px-2 py-1 rounded">
                                {ex}
                              </code>
                            ))
                          ) : (
                            <code className="block text-xs bg-gray-100 px-2 py-1 rounded">
                              {String(workflow.survey.summary.columnMapping.columnNamingConvention.examples)}
                            </code>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              )}
              
              {/* Mapping Summary */}
              {workflow.survey.summary.columnMapping.summary && (
                <div className="mt-3 flex gap-4 text-xs">
                  <div>
                    <span className="font-medium text-gray-700">Attributes Mapped:</span>{' '}
                    <span className="text-gray-600">
                      {workflow.survey.summary.columnMapping.summary.totalAttributesMapped || 'N/A'}
                    </span>
                  </div>
                  <div>
                    <span className="font-medium text-gray-700">Choice Columns:</span>{' '}
                    <span className="text-gray-600">
                      {workflow.survey.summary.columnMapping.summary.totalChoiceColumns || 'N/A'}
                    </span>
                  </div>
                  <div>
                    <span className="font-medium text-gray-700">Market Share Columns:</span>{' '}
                    <span className="text-gray-600">
                      {workflow.survey.summary.columnMapping.summary.totalMarketShareColumns || 'N/A'}
                    </span>
                  </div>
                  <div>
                    <span className="font-medium text-gray-700">Confidence:</span>{' '}
                    <span className={`font-semibold ${
                      workflow.survey.summary.columnMapping.summary.mappingConfidence === 'high' ? 'text-green-600' :
                      workflow.survey.summary.columnMapping.summary.mappingConfidence === 'medium' ? 'text-yellow-600' :
                      'text-red-600'
                    }`}>
                      {workflow.survey.summary.columnMapping.summary.mappingConfidence || 'N/A'}
                    </span>
                  </div>
                </div>
              )}
            </div>
          )}
          
          <EstimateUtilitiesSection />
        </div>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col bg-gray-50">
      {/* Header */}
      <div className="bg-white border-b border-gray-200 px-6 py-4">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-semibold text-gray-900">Conjoint Simulator</h1>
            <p className="text-sm text-gray-600 mt-1">{workflow?.name || 'Workflow Simulator'}</p>
          </div>
          <button
            onClick={() => setShowDebugPanel(!showDebugPanel)}
            className="px-3 py-1.5 text-xs font-medium text-gray-700 bg-gray-100 hover:bg-gray-200 rounded border border-gray-300 transition"
          >
            {showDebugPanel ? 'Hide Debug' : 'Show Debug'}
          </button>
        </div>
      </div>

      {!CONJOINT_BACKEND_ENABLED && (
        <div className="bg-amber-50 border-b border-amber-200 px-6 py-3 text-sm text-amber-900">
          <p className="font-semibold">UI-only mode</p>
          <p className="mt-1 text-amber-800">
            The Conjoint backend has been removed from this repo. Upload, estimation, and scenario analysis are disabled.
          </p>
        </div>
      )}

      {/* Debug Panel - Matching Diagnostics Only */}
      {showDebugPanel && (
        <div className="bg-blue-50 border-b border-blue-200 px-6 py-4 max-h-96 overflow-auto">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-semibold text-blue-900">Scenario Matching Diagnostics</h3>
            <button
              onClick={async () => {
                try {
                  const currentScenario = activeScenarios.find(s => s.id === 'scenario1');
                  const analysis = currentScenario?.analysis || scenarioAnalysis;
                  const diagnostics = analysis?.diagnostics || {};
                  const usedSurveyData = diagnostics.used_survey_data_for_matching === true;
                  const matchedTask = diagnostics.matching_tasks_used?.[0];
                  
                  const matchingDiag = diagnostics.matching_diagnostics;
                  // Determine reason with better diagnostics
                  let reason = 'Survey data not available';
                  if (usedSurveyData) {
                    reason = `Matched to Task ${matchedTask || 'N/A'}`;
                  } else if (diagnostics.has_survey_data || diagnostics.has_survey_data_for_matching) {
                    reason = matchingDiag?.reason || 'Could not match scenario to specific tasks - using utility-based projection';
                  }
                  
                  const debugContent = {
                    timestamp: new Date().toISOString(),
                    matchingStatus: {
                      usedSurveyData,
                      matchedTask: matchedTask || null,
                      method: usedSurveyData ? 'Survey Data Matching' : 'Projection Method',
                      reason: reason
                    },
                    matchingDiagnostics: matchingDiag || null,
                    currentScenario: {
                      name: scenarios[0]?.name || 'Scenario 1',
                      selections: scenarios[0]?.selections || {}
                    },
                    attributes: attributes.map(attr => {
                      const selection = scenarios[0]?.selections?.[attr.attributeNo];
                      const selectedLevel = attr.levels?.find((l: any) => l.code === selection || l.levelNo === selection);
                      return {
                        attributeNo: attr.attributeNo,
                        attributeText: attr.attributeText,
                        selectedLevel: selectedLevel ? {
                          code: selectedLevel.code,
                          levelText: selectedLevel.levelText
                        } : null,
                        status: selectedLevel ? 'selected' : 'not selected'
                      };
                    }),
                    availableData: {
                      attributeColumnsCount: Array.isArray(workflow?.survey?.summary?.dataSummary?.attributeColumns)
                        ? workflow.survey.summary.dataSummary.attributeColumns.length
                        : 0,
                      withNewOptionsColumnsCount: Array.isArray(workflow?.survey?.summary?.marketShareScenarios?.withNewOptions)
                        ? workflow.survey.summary.marketShareScenarios.withNewOptions.length
                        : 0,
                      surveyDataAvailable: !!workflow?.survey?.storedFileName,
                      attributeColumnsCountFromDiagnostics: diagnostics.attribute_columns_count || 0,
                      surveyDataRowsCount: diagnostics.survey_data_rows_count || 0,
                      withNewOptionsColumnsCountFromDiagnostics: diagnostics.with_new_options_columns_count || 0
                    }
                  };
                  
                  const debugText = JSON.stringify(debugContent, null, 2);
                  await navigator.clipboard.writeText(debugText);
                  alert('Matching diagnostics copied to clipboard!');
                } catch (error) {
                  console.error('Failed to copy debug info:', error);
                  alert('Failed to copy debug information. Check console for details.');
                }
              }}
              className="px-3 py-1.5 text-xs font-medium text-white bg-blue-600 hover:bg-blue-700 rounded border border-blue-700 transition"
            >
              Copy Diagnostics
            </button>
          </div>
          <div className="space-y-4 text-xs">
            {/* Matching Status */}
            <div className="bg-white p-3 rounded border border-blue-300">
              <h4 className="font-semibold text-gray-900 mb-2">Matching Status</h4>
              {(() => {
                const currentScenario = activeScenarios.find(s => s.id === 'scenario1');
                const analysis = currentScenario?.analysis || scenarioAnalysis;
                const diagnostics = analysis?.diagnostics || {};
                
                // Debug logging
                console.log('[Debug Panel] Analysis:', analysis);
                console.log('[Debug Panel] Diagnostics:', diagnostics);
                console.log('[Debug Panel] Workflow survey data:', {
                  hasStoredFile: !!workflow?.survey?.storedFileName,
                  attributeColumns: workflow?.survey?.summary?.dataSummary?.attributeColumns?.length,
                  withNewOptions: workflow?.survey?.summary?.marketShareScenarios?.withNewOptions?.length
                });
                
                const usedSurveyData = diagnostics.used_survey_data_for_matching === true;
                const matchedTask = diagnostics.matching_tasks_used?.[0];
                const matchingDiag = diagnostics.matching_diagnostics;
                
                // Fallback: check if survey data exists even if diagnostics don't show it
                const hasSurveyDataFromWorkflow = !!(
                  workflow?.survey?.storedFileName &&
                  (workflow?.survey?.summary?.dataSummary?.attributeColumns?.length > 0 ||
                   workflow?.survey?.summary?.marketShareScenarios?.withNewOptions?.length > 0)
                );
                const effectiveHasSurveyData = diagnostics.has_survey_data || diagnostics.has_survey_data_for_matching || hasSurveyDataFromWorkflow;
                
                return (
                  <div className="space-y-2">
                    <div className={`p-2 rounded ${usedSurveyData ? 'bg-green-100 border border-green-300' : 'bg-yellow-100 border border-yellow-300'}`}>
                      <div className="flex items-center gap-2">
                        <span className={`text-lg ${usedSurveyData ? 'text-green-600' : 'text-yellow-600'}`}>
                          {usedSurveyData ? '✓' : '⚠'}
                        </span>
                        <div>
                          <div className="font-semibold">
                            {usedSurveyData ? 'Matched to Survey Data' : 'Using Projection Method'}
                          </div>
                          <div className="text-xs text-gray-600 mt-1">
                            {usedSurveyData 
                              ? `Task ${matchedTask || 'N/A'}: Scenario matched to actual survey responses`
                              : effectiveHasSurveyData
                                ? matchingDiag?.reason || 'Could not match scenario to specific tasks - using utility-based projection'
                                : 'Survey data not available for matching'}
                          </div>
                        </div>
                      </div>
                    </div>
                    {matchedTask && (
                      <div className="text-xs text-gray-600">
                        <strong>Matched Task:</strong> {matchedTask}
                      </div>
                    )}
                    {!usedSurveyData && (matchingDiag || effectiveHasSurveyData) && (
                      <div className="text-xs text-gray-600 p-2 bg-gray-50 rounded space-y-2">
                        {matchingDiag && (
                          <>
                            <div>
                              <strong>Matching Attempt:</strong> {matchingDiag.attempted ? 'Yes' : 'No'}
                            </div>
                            {matchingDiag.reason && (
                              <div className="text-gray-700">{matchingDiag.reason}</div>
                            )}
                          </>
                        )}
                        {!matchingDiag && effectiveHasSurveyData && (
                          <div className="text-gray-700">
                            Matching was attempted but no diagnostic information is available. Check backend logs for details.
                            <div className="text-xs text-gray-500 mt-1">
                              (Survey data exists: {workflow?.survey?.storedFileName ? 'Yes' : 'No'}, 
                              Attribute columns: {workflow?.survey?.summary?.dataSummary?.attributeColumns?.length || 0})
                            </div>
                          </div>
                        )}
                        {matchingDiag?.best_candidate && (
                          <div className="mt-2 p-2 bg-blue-50 rounded border border-blue-200">
                            <div className="font-semibold text-blue-800 mb-1">Best Match Candidate:</div>
                            <div className="space-y-1 text-gray-700">
                              <div><strong>Task:</strong> {matchingDiag.best_candidate.task}</div>
                              <div><strong>Product:</strong> {matchingDiag.best_candidate.rowNumber}</div>
                              <div><strong>Match Score:</strong> {matchingDiag.best_candidate.matchPercentage || `${(matchingDiag.best_candidate.matchScore * 100).toFixed(1)}%`}</div>
                              <div className="text-xs text-gray-600 mt-1">
                                Threshold required: 80% (below threshold, so using projection method)
                              </div>
                            </div>
                          </div>
                        )}
                        {/* Detailed Diagnostics */}
                        {matchingDiag?.detailed_diagnostics && (
                          <div className="mt-3 p-3 bg-yellow-50 rounded border border-yellow-300">
                            <div className="font-semibold text-yellow-800 mb-2">Detailed Matching Diagnostics</div>
                            <div className="space-y-2 text-gray-700">
                              <div className="grid grid-cols-2 gap-2">
                                <div><strong>Task/Concept:</strong> {matchingDiag.detailed_diagnostics.task}/{matchingDiag.detailed_diagnostics.concept}</div>
                                <div><strong>Product:</strong> {matchingDiag.detailed_diagnostics.rowNumber}</div>
                              </div>
                              <div className="border-t border-yellow-200 pt-2">
                                <div className="font-semibold mb-1">Attribute Processing:</div>
                                <div className="grid grid-cols-2 gap-2 text-xs">
                                  <div>Total Attributes: <strong>{matchingDiag.detailed_diagnostics.total_attributes}</strong></div>
                                  <div>Processed: <strong>{matchingDiag.detailed_diagnostics.processed_attributes}</strong></div>
                                  <div>Matched: <strong className="text-green-600">{matchingDiag.detailed_diagnostics.matched_attributes}</strong></div>
                                  <div>Match Rate: <strong>{matchingDiag.detailed_diagnostics.processed_attributes > 0 ? ((matchingDiag.detailed_diagnostics.matched_attributes / matchingDiag.detailed_diagnostics.processed_attributes) * 100).toFixed(1) : 0}%</strong></div>
                                </div>
                              </div>
                              {matchingDiag.detailed_diagnostics.skipped_breakdown && (
                                <div className="border-t border-yellow-200 pt-2">
                                  <div className="font-semibold mb-1">Skipped Attributes Breakdown:</div>
                                  <div className="grid grid-cols-3 gap-2 text-xs">
                                    <div className="text-orange-600">
                                      No Schema: <strong>{matchingDiag.detailed_diagnostics.skipped_breakdown.no_schema}</strong>
                                    </div>
                                    <div className="text-red-600">
                                      No Column: <strong>{matchingDiag.detailed_diagnostics.skipped_breakdown.no_column}</strong>
                                    </div>
                                    <div className="text-purple-600">
                                      No Value: <strong>{matchingDiag.detailed_diagnostics.skipped_breakdown.no_value}</strong>
                                    </div>
                                  </div>
                                </div>
                              )}
                              {matchingDiag.detailed_diagnostics.columns_found !== undefined && (
                                <div className="border-t border-yellow-200 pt-2">
                                  <div className="font-semibold mb-1">Columns Found:</div>
                                  <div className="text-xs">
                                    <div>Total: <strong>{matchingDiag.detailed_diagnostics.columns_found}</strong></div>
                                    {matchingDiag.detailed_diagnostics.sample_columns && matchingDiag.detailed_diagnostics.sample_columns.length > 0 && (
                                      <div className="mt-1">
                                        <div className="text-gray-600 mb-1">Sample columns:</div>
                                        <div className="max-h-20 overflow-auto bg-white p-1 rounded border border-gray-200">
                                          {matchingDiag.detailed_diagnostics.sample_columns.slice(0, 5).map((col: string, idx: number) => (
                                            <div key={idx} className="text-xs font-mono">{col}</div>
                                          ))}
                                        </div>
                                      </div>
                                    )}
                                  </div>
                                </div>
                              )}
                              {matchingDiag.detailed_diagnostics.unmatched_attributes && matchingDiag.detailed_diagnostics.unmatched_attributes.length > 0 && (
                                <div className="border-t border-yellow-200 pt-2">
                                  <div className="font-semibold mb-1">Unmatched Attributes (First 3):</div>
                                  <div className="space-y-1 max-h-32 overflow-auto">
                                    {matchingDiag.detailed_diagnostics.unmatched_attributes.slice(0, 3).map((unm: any, idx: number) => (
                                      <div key={idx} className="text-xs bg-white p-1.5 rounded border border-red-200">
                                        <div className="font-semibold text-red-700">#{unm.attr_no} {unm.attr_name}</div>
                                        <div className="text-gray-600 mt-0.5">Scenario: "{unm.scenario_level?.substring(0, 40)}..."</div>
                                        <div className="text-gray-600">Row Value: "{unm.row_value}"</div>
                                        {unm.schema_level_codes && unm.schema_level_codes.length > 0 && (
                                          <div className="text-gray-500 text-xs mt-0.5">Schema codes: {unm.schema_level_codes.join(', ')}</div>
                                        )}
                                      </div>
                                    ))}
                                  </div>
                                </div>
                              )}
                              {matchingDiag.detailed_diagnostics.matched_attributes_sample && matchingDiag.detailed_diagnostics.matched_attributes_sample.length > 0 && (
                                <div className="border-t border-yellow-200 pt-2">
                                  <div className="font-semibold mb-1">Successfully Matched Attributes (Sample):</div>
                                  <div className="space-y-1 max-h-24 overflow-auto">
                                    {matchingDiag.detailed_diagnostics.matched_attributes_sample.slice(0, 3).map((match: string, idx: number) => (
                                      <div key={idx} className="text-xs bg-green-50 p-1 rounded border border-green-200 text-green-800">
                                        {match}
                                      </div>
                                    ))}
                                  </div>
                                </div>
                              )}
                            </div>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })()}
            </div>

            {/* Attribute Matching Chart */}
            <div className="bg-white p-3 rounded border border-blue-300">
              <h4 className="font-semibold text-gray-900 mb-2">Current Scenario Attributes</h4>
              <div className="max-h-64 overflow-auto">
                <table className="w-full text-xs">
                  <thead className="bg-gray-50 sticky top-0">
                    <tr>
                      <th className="px-2 py-1.5 text-left font-semibold text-gray-700">#</th>
                      <th className="px-2 py-1.5 text-left font-semibold text-gray-700">Attribute</th>
                      <th className="px-2 py-1.5 text-left font-semibold text-gray-700">Selected Level</th>
                      <th className="px-2 py-1.5 text-center font-semibold text-gray-700">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-200">
                    {attributes.map((attr, idx) => {
                      const selection = scenarios[0]?.selections?.[attr.attributeNo];
                      const selectedLevel = attr.levels?.find((l: any) => l.code === selection || l.levelNo === selection);
                      
                      return (
                        <tr key={attr.attributeNo} className="hover:bg-gray-50">
                          <td className="px-2 py-1.5 text-gray-600">{attr.attributeNo}</td>
                          <td className="px-2 py-1.5 text-gray-900">{attr.attributeText}</td>
                          <td className="px-2 py-1.5 text-gray-700">
                            {selectedLevel ? (
                              <span className="text-xs">{selectedLevel.levelText}</span>
                            ) : (
                              <span className="text-gray-400 italic">Not selected</span>
                            )}
                          </td>
                          <td className="px-2 py-1.5 text-center">
                            {selectedLevel ? (
                              <span className="px-2 py-0.5 bg-green-100 text-green-700 rounded text-xs">✓</span>
                            ) : (
                              <span className="px-2 py-0.5 bg-gray-100 text-gray-500 rounded text-xs">-</span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <div className="mt-2 text-xs text-gray-600">
                <strong>Total Attributes:</strong> {attributes.length} | 
                <strong className="ml-2">Selected:</strong> {Object.keys(scenarios[0]?.selections || {}).filter(k => scenarios[0]?.selections[k]).length}
              </div>
            </div>

            {/* Attribute Columns Info */}
            <div className="bg-white p-3 rounded border border-blue-300">
              <h4 className="font-semibold text-gray-900 mb-2">Available Data</h4>
              <div className="space-y-2 text-xs">
                <div className="flex justify-between items-center">
                  <span className="text-gray-700">Attribute Columns (hATTR):</span>
                  <span className="font-semibold">
                    {Array.isArray(workflow?.survey?.summary?.dataSummary?.attributeColumns)
                      ? workflow.survey.summary.dataSummary.attributeColumns.length
                      : '0'}
                  </span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-gray-700">With New Options Columns:</span>
                  <span className="font-semibold">
                    {Array.isArray(workflow?.survey?.summary?.marketShareScenarios?.withNewOptions)
                      ? workflow.survey.summary.marketShareScenarios.withNewOptions.length
                      : '0'}
                  </span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-gray-700">Survey Data Available:</span>
                  <span className={`font-semibold ${workflow?.survey?.storedFileName ? 'text-green-600' : 'text-red-600'}`}>
                    {workflow?.survey?.storedFileName ? 'Yes' : 'No'}
                  </span>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Main Content */}
      <div className="flex-1 flex overflow-hidden">
        {/* Left Panel - Simulator Table */}
        <div className="flex-[2] overflow-auto">
          <div className="p-3">
            <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
              <div className="overflow-x-auto">
                <table className="min-w-full divide-y divide-gray-200">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider w-1/2">
                        Attributes
                      </th>
                      <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider w-1/2">
                        <div className="flex items-center justify-between">
                          <span className="text-xs font-medium text-gray-700">
                            Product Scenario
                          </span>
                          <div className="flex items-center gap-2">
                            <button
                              onClick={generateRandomSelections}
                              className="p-1 bg-white text-gray-700 border border-gray-300 rounded hover:bg-gray-50 transition flex items-center justify-center"
                              title="Generate random selections for all attributes"
                            >
                              <IconRefresh size={16} stroke={1.5} />
                            </button>
                            <button
                              onClick={() => {
                                if (allAttributesSelected && scenarios.length > 0) {
                                  setShowSaveScenarioModal(true);
                                }
                              }}
                              disabled={!allAttributesSelected}
                              className="p-1 bg-white text-gray-700 border border-gray-300 rounded hover:bg-gray-50 transition flex items-center justify-center disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:bg-white"
                              title={allAttributesSelected ? "Save current scenario" : "Select all attribute levels to save"}
                            >
                              <IconDeviceFloppy size={16} stroke={1.5} />
                            </button>
                          </div>
                        </div>
                      </th>
                    </tr>
                  </thead>
                  <tbody className="bg-white divide-y divide-gray-200">
                    {attributes.length > 0 ? (
                      attributes.map((attribute) => (
                        <tr key={attribute.attributeNo} className="hover:bg-gray-50">
                          <td className="px-3 py-2 text-sm text-gray-900">
                            <div className="font-medium">{attribute.attributeText}</div>
                          </td>
                          <td className="px-3 py-2 text-center">
                            <select
                              value={scenarios[0]?.selections[attribute.attributeNo] || ''}
                              onChange={(e) => updateScenarioSelection(scenarios[0].id, attribute.attributeNo, e.target.value)}
                              className="w-full px-2 py-1.5 text-sm border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-blue-500 focus:border-blue-500"
                            >
                              <option value="">Select level...</option>
                              {attribute.levels.map((level) => (
                                <option key={level.code} value={level.code}>
                                  {level.levelText}
                                </option>
                              ))}
                            </select>
                          </td>
                        </tr>
                      ))
                    ) : (
                      <tr>
                        <td colSpan={2} className="px-3 py-4 text-center text-gray-500">
                          <div className="text-sm">
                            {workflow?.aiAnalysis ? 'No attributes found in AI analysis' : 'Loading workflow data...'}
                          </div>
                          <div className="text-xs mt-1">
                            Debug: workflow={!!workflow}, aiAnalysis={!!workflow?.aiAnalysis}, attributes={attributes.length}
                          </div>
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Simulate Button */}
            <div className="mt-3 flex justify-end">
              <button
                onClick={simulate}
                disabled={analyzingScenarios || marketShareProducts.length === 0 || !allAttributesSelected}
                className="px-4 py-2 text-sm bg-blue-600 text-white font-semibold rounded hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition"
              >
                {analyzingScenarios ? 'Analyzing...' : 'Run Scenario Analysis'}
              </button>
            </div>
          </div>
        </div>

        {/* Right Panel - Market Share */}
        <div className="flex-1 bg-white border-l border-gray-200 overflow-auto">
          <div className="p-3">
              <div className="flex items-center justify-between mb-2">
                <h3 className="text-base font-semibold text-gray-900">Market Share</h3>
                {savedScenarios.length > 0 && (
                  <div className="relative scenario-dropdown-container">
                    <button
                      onClick={() => setShowScenarioDropdown(!showScenarioDropdown)}
                      disabled={activeScenarios.length >= 10}
                      className="p-1 bg-white text-gray-700 border border-gray-300 rounded hover:bg-gray-50 transition flex items-center justify-center disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:bg-white"
                      title={activeScenarios.length >= 10 ? "Maximum 10 scenarios allowed" : "Add saved product scenario"}
                    >
                      <IconPlus size={16} stroke={1.5} />
                      {selectedScenarioIds.size > 0 && (
                        <span className="ml-1 text-xs font-semibold">{selectedScenarioIds.size}</span>
                      )}
                    </button>
                    {showScenarioDropdown && (
                      <div className="absolute right-0 mt-1 w-64 bg-white border border-gray-300 rounded-lg shadow-lg z-50 max-h-96 overflow-y-auto">
                        <div className="p-2">
                          <div className="text-xs font-semibold text-gray-700 mb-2 px-2">Select scenarios to add:</div>
                          <div className="space-y-1">
                            {savedScenarios.map((savedScenario) => {
                              const isAlreadyAdded = activeScenarios.some(s => s.id === savedScenario.id);
                              const isSelected = selectedScenarioIds.has(savedScenario.id);
                              // Check if name is duplicate (excluding self)
                              const hasDuplicateName = activeScenarios
                                .filter(s => s.id !== savedScenario.id && s.id !== 'scenario1')
                                .some(s => s.name === savedScenario.name);
                              
                              const isDisabled = isAlreadyAdded || hasDuplicateName;
                              
                              return (
                                <label
                                  key={savedScenario.id}
                                  className={`flex items-center p-2 hover:bg-gray-50 ${
                                    isDisabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'
                                  }`}
                                >
                                  <input
                                    type="checkbox"
                                    checked={isSelected}
                                    onChange={() => toggleScenarioSelection(savedScenario.id)}
                                    disabled={isDisabled}
                                    className="mr-2"
                                  />
                                  <div className="flex-1">
                                    <div className="text-sm text-gray-900">{savedScenario.name}</div>
                                    <div className="text-xs text-gray-500">
                                      {new Date(savedScenario.createdAt).toLocaleDateString()}
                                    </div>
                                  </div>
                                  {isAlreadyAdded && (
                                    <span className="text-xs text-gray-400">Added</span>
                                  )}
                                  {hasDuplicateName && !isAlreadyAdded && (
                                    <span className="text-xs text-orange-500">Duplicate name</span>
                                  )}
                                </label>
                              );
                            })}
                          </div>
                          {selectedScenarioIds.size > 0 && (
                            <div className="mt-3 pt-3 border-t border-gray-200 flex justify-end gap-2">
                              <button
                                onClick={() => {
                                  setSelectedScenarioIds(new Set());
                                  setShowScenarioDropdown(false);
                                }}
                                className="px-3 py-1 text-xs text-gray-700 bg-gray-200 rounded hover:bg-gray-300 transition"
                              >
                                Cancel
                              </button>
                              <button
                                onClick={addSelectedScenariosToView}
                                className="px-3 py-1 text-xs bg-green-600 text-white rounded hover:bg-green-700 transition"
                              >
                                Add Selected ({selectedScenarioIds.size})
                              </button>
                            </div>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            
            <div className="space-y-4">
              {/* Market Share Table */}
              <div>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-gray-300">
                        <th className="text-left px-3 py-2 font-semibold text-gray-800">Product</th>
                        <th className="text-center px-3 py-2 font-semibold text-gray-800">Current</th>
                        {/* Show Future and Change columns only if we have active scenarios or current scenario analysis */}
                        {(activeScenarios.length > 0 || scenarioAnalysis) && (
                          <>
                            <th className="text-center px-3 py-2 font-semibold text-gray-800">Future</th>
                            <th className="text-center px-3 py-2 font-semibold text-gray-800">Change</th>
                          </>
                        )}
                      </tr>
                    </thead>
                    <tbody>
                      {/* Current Market Share Products */}
                      {marketShareProducts.map((product, index) => {
                        const currentShareValue = Number(product.currentShare ?? 0);
                        
                        // Get the analysis to use for displaying adjusted shares
                        // Priority: current scenario (scenario1) > first saved scenario > legacy scenarioAnalysis
                        let analysis = null;
                        const currentScenario = activeScenarios.find(s => s.id === 'scenario1');
                        if (currentScenario?.analysis) {
                          analysis = currentScenario.analysis;
                        } else if (activeScenarios.length > 0) {
                          // Use first saved scenario's analysis to show how existing products are affected
                          const firstSavedScenario = activeScenarios.find(s => s.id !== 'scenario1');
                          if (firstSavedScenario?.analysis) {
                            analysis = firstSavedScenario.analysis;
                          }
                        } else {
                          analysis = scenarioAnalysis;
                        }
                        
                        let adjustedShareValue = currentShareValue;
                        let changePercentPoints = 0;
                        
                        if (analysis?.projectedScenarios?.[0]) {
                          const scenarioProducts = analysis.projectedScenarios[0].products || [];
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
                            {(activeScenarios.length > 0 || scenarioAnalysis) && (
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
                      
                      {/* All active scenarios (including current scenario) - only show new product */}
                      {activeScenarios
                        .filter((scenario, index, self) => 
                          // Deduplicate: only show first occurrence of each scenario ID
                          index === self.findIndex(s => s.id === scenario.id)
                        )
                        .map((activeScenario) => {
                          const analysis = activeScenario.analysis;
                          if (!analysis?.projectedScenarios?.[0]) return null;
                          
                          const scenarioProducts = analysis.projectedScenarios[0].products || [];
                          
                          // Find the new product (has currentShare === 0 or very close to 0)
                          // Check all products to find the one that's actually new
                          const newProduct = scenarioProducts.find((p: any) => {
                            const currentShare = Number(p.currentShare ?? 0);
                            return currentShare <= 0.001; // New product has no current share
                          });
                          
                          if (!newProduct) return null;
                          
                          // Double-check: make sure it's not in the original products list
                          const isInOriginalProducts = marketShareProducts.some(p => 
                            p.name === newProduct.name || 
                            (p.rowNumber && newProduct.rowNumber && p.rowNumber === newProduct.rowNumber)
                          );
                          if (isInOriginalProducts) {
                            // This is actually an existing product, skip it
                            return null;
                          }
                          
                          const currentShareValue = Number(newProduct.currentShare ?? 0);
                          const futureShare = Number(newProduct.marketShare ?? 0);
                          const change = Number(newProduct.change ?? 0) * 100;
                          
                          // Skip if no meaningful share (both current and future are 0 or very small)
                          if (futureShare < 0.001 && currentShareValue < 0.001) {
                            return null;
                          }
                          
                          const isPositive = change > 0;
                          const isNegative = change < 0;
                          
                          // Use the scenario name (saved product name) or a descriptive name
                          // For scenario1, use the actual scenario name from scenarios array
                          let productName = activeScenario.name || `New Product`;
                          if (activeScenario.id === 'scenario1' && scenarios.length > 0) {
                            productName = scenarios[0].name || `New Product`;
                          }
                          
                          return (
                            <tr 
                              key={`${activeScenario.id}-new-product`} 
                              className="border-b border-gray-200"
                              data-scenario-id={activeScenario.id}
                              data-scenario-name={activeScenario.name}
                            >
                              <td className="px-2 py-1.5 text-gray-900">
                                <div className="flex items-center justify-between">
                                  <div className="flex items-center gap-2">
                                    <span>{productName}</span>
                                    {activeScenario.id !== 'scenario1' && (
                                      <button
                                        onClick={() => loadSavedScenarioIntoSimulator(activeScenario.id)}
                                        className="text-blue-500 hover:text-blue-700 transition flex items-center justify-center"
                                        title="Load this scenario into simulator"
                                      >
                                        <IconInfoCircle size={16} stroke={1.5} />
                                      </button>
                                    )}
                                  </div>
                                  <button
                                    onClick={() => removeActiveScenario(activeScenario.id)}
                                    className="ml-2 text-red-500 hover:text-red-700 text-xs font-bold px-1 hover:bg-red-50 rounded"
                                    title="Delete product"
                                  >
                                    ×
                                  </button>
                                </div>
                              </td>
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
                        })}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Scenario Analysis Results */}
              {scenarioAnalysis && (
                <div className="pt-4 border-t border-gray-200">
                  <h4 className="text-sm font-medium text-gray-700 mb-3">Analysis Results</h4>
                  
                  {/* Market Impact */}
                  {scenarioAnalysis.marketImpact && (
                    <div className="mb-4 p-3 bg-green-50 rounded-lg">
                      <div className="text-sm font-medium text-green-900 mb-2">Market Impact</div>
                      <div className="space-y-1 text-xs text-green-700">
                        <div>New Product Share: {(scenarioAnalysis.marketImpact.new_product_share * 100).toFixed(1)}%</div>
                        <div>Market Expansion: {scenarioAnalysis.marketImpact.market_expansion ? 'Yes' : 'No'}</div>
                        <div>Max Increase: {(scenarioAnalysis.marketImpact.max_increase * 100).toFixed(1)}%</div>
                        <div>Max Decrease: {(scenarioAnalysis.marketImpact.max_decrease * 100).toFixed(1)}%</div>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Save Scenario Modal */}
      {showSaveScenarioModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-6 max-w-md w-full mx-4">
            <h3 className="text-lg font-semibold text-gray-900 mb-4">Save Scenario</h3>
            <div className="mb-4">
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Scenario Name
              </label>
              <input
                type="text"
                value={scenarioNameToSave}
                onChange={(e) => setScenarioNameToSave(e.target.value)}
                placeholder="Enter scenario name"
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                autoFocus
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    saveCurrentScenario();
                  } else if (e.key === 'Escape') {
                    setShowSaveScenarioModal(false);
                    setScenarioNameToSave('');
                  }
                }}
              />
            </div>
            <div className="flex justify-end gap-3">
              <button
                onClick={() => {
                  setShowSaveScenarioModal(false);
                  setScenarioNameToSave('');
                }}
                className="px-4 py-2 text-sm text-gray-700 bg-gray-200 rounded-lg hover:bg-gray-300 transition"
              >
                Cancel
              </button>
              <button
                onClick={saveCurrentScenario}
                disabled={!scenarioNameToSave.trim()}
                className="px-4 py-2 text-sm text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition"
              >
                Save
              </button>
            </div>
          </div>
        </div>
      )}


    </div>
  );
}
