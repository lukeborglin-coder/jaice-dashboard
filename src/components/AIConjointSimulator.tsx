import React, { useState, useEffect, useMemo } from 'react';
import { API_BASE_URL } from '../config';

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
  const [dataUploaded, setDataUploaded] = useState(false);
  const [surveyData, setSurveyData] = useState<any>(null);
  const [estimating, setEstimating] = useState(false);
  const [estimationError, setEstimationError] = useState<string | null>(null);
  const [savedScenarios, setSavedScenarios] = useState<SavedScenario[]>([]);
  const [activeScenarios, setActiveScenarios] = useState<ActiveScenario[]>([]);
  const [showSaveScenarioModal, setShowSaveScenarioModal] = useState(false);
  const [scenarioNameToSave, setScenarioNameToSave] = useState('');
  const [showLoadScenarioModal, setShowLoadScenarioModal] = useState(false);

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

  useEffect(() => {
    console.log('AIConjointSimulator - workflow:', workflow);
    console.log('AIConjointSimulator - aiAnalysis:', workflow?.aiAnalysis);
    
    if (workflow?.aiAnalysis?.attributes) {
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
    }

    // Check if survey data is already uploaded
    if (workflow?.survey || workflow?.surveyUploadedAt) {
      console.log('AIConjointSimulator - Survey data already uploaded:', workflow.survey);
      setDataUploaded(true);
      
      // Load survey data from workflow
      if (workflow.survey) {
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
          const normalizedProducts = surveySummary.marketShareProducts.map((product: any) => {
            const currentShare = typeof product.currentShare === 'number'
              ? product.currentShare
              : parseFloat(product.currentShare) || 0;

            const adjustedShare = typeof product.adjustedShare === 'number'
              ? product.adjustedShare
              : parseFloat(product.adjustedShare) || currentShare;

            return {
              name: product.name || `Product ${product.rowNumber || ''}`.trim(),
              currentShare,
              adjustedShare
            };
          });

          console.log('Loaded market share products from workflow:', normalizedProducts);
          setMarketShareProducts(normalizedProducts);
        }
      }
    } else {
      // Initialize market share products from AI analysis if no survey data
      if (workflow?.aiAnalysis?.products) {
        const products = workflow.aiAnalysis.products.map((product: string) => ({
          name: product,
          currentShare: 0,
          adjustedShare: 0
        }));
        setMarketShareProducts(products);
      }
    }
  }, [workflow]);

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

  const loadSavedScenario = (savedScenario: SavedScenario) => {
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
    setShowLoadScenarioModal(false);
  };

  const addSavedScenarioToView = (savedScenario: SavedScenario) => {
    if (activeScenarios.length >= 10) {
      alert('Maximum 10 scenarios can be displayed at once');
      return;
    }
    
    // Check if already added
    if (activeScenarios.some(s => s.id === savedScenario.id)) {
      alert('This scenario is already added to the view');
      return;
    }
    
    // Run analysis for this saved scenario
    runScenarioAnalysis(savedScenario.selections, savedScenario.name, savedScenario.id);
    setShowLoadScenarioModal(false);
  };

  const removeActiveScenario = (scenarioId: string) => {
    setActiveScenarios(prev => prev.filter(s => s.id !== scenarioId));
  };

  const runScenarioAnalysis = async (selections?: Record<string, string>, scenarioName?: string, scenarioId?: string) => {
    // Use provided selections or current scenario selections
    const selectionsToUse = selections || scenarios[0]?.selections || {};
    const nameToUse = scenarioName || scenarios[0]?.name || 'Scenario';
    const idToUse = scenarioId || `scenario_${Date.now()}`;
    
    if (!workflow?.id) {
      alert('Workflow not found');
      return;
    }

    const estimationData = workflow?.estimationResult || workflow?.estimation;
    if (!estimationData) {
      alert('Please estimate utilities first before running scenario analysis');
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
        const level = attribute?.levels.find(lvl => lvl.levelNo === levelId);
        
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
        const errorData = await response.json();
        throw new Error(errorData.detail || 'Failed to run scenario analysis');
      }

      const result = await response.json();
      
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
        
        // Update market share products
        if (result.scenarioAnalysis?.projectedScenarios?.[0]) {
          const firstScenario = result.scenarioAnalysis.projectedScenarios[0];
          const updatedProducts = firstScenario.products.map((product: any) => ({
            name: product.name,
            currentShare: product.currentShare || 0,
            adjustedShare: product.marketShare || 0,
            change: product.change || 0
          }));
          setMarketShareProducts(updatedProducts);
        }
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

    setUploadingData(true);
    try {
      const formData = new FormData();
      formData.append('file', file);
      formData.append('workflowId', workflow.id);

      const token = localStorage.getItem('cognitive_dash_token');
      
      // Use AI-powered data processing endpoint for AI workflows
      const endpoint = workflow.aiGenerated 
        ? 'http://localhost:3005/api/conjoint/ai-workflow/process-data'
        : 'http://localhost:3005/api/conjoint/workflows/' + workflow.id + '/survey';
      
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
      setSurveyData(result);
      setDataUploaded(true);
      setDataFile(file);

      // Notify parent to refresh workflow data
      if (onWorkflowUpdate) {
        await onWorkflowUpdate();
      }

      // Automatically run estimation after successful upload
      try {
        await estimateUtilities();
      } catch (error) {
        console.error('Auto-estimation failed:', error);
        // Don't show error alert here - the estimateUtilities function will handle it
        // The yellow box will still appear to allow manual retry
      }

      // Update market share products with real data
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
            adjustedShare
          };
        });

        console.log('Normalized market share products:', normalizedProducts);
        setMarketShareProducts(normalizedProducts);
      }

      // Show detailed preprocessing results
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

    } catch (error: any) {
      console.error('Upload error:', error);
      alert('Failed to upload survey data: ' + error.message);
    } finally {
      setUploadingData(false);
    }
  };

  const estimateUtilities = async () => {
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
    if (!confirm('Are you sure you want to remove all uploaded survey data? This will also clear any estimation results. This action cannot be undone.')) {
      return;
    }

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

      // Clear local state
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

      // Notify parent to refresh workflow data
      if (onWorkflowUpdate) {
        onWorkflowUpdate();
      }
    } catch (error: any) {
      console.error('Error removing survey data:', error);
      alert('Failed to remove survey data: ' + error.message);
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

  // Data upload section component (reusable)
  const DataUploadSection = () => (
    <>
      <div className="p-4 bg-blue-50 border border-blue-200 rounded-lg flex flex-col">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-blue-300">
                <th className="text-left p-2 font-semibold text-blue-800">File Name</th>
                <th className="text-left p-2 font-semibold text-blue-800">Date Uploaded</th>
                <th className="text-left p-2 font-semibold text-blue-800">Respondents</th>
                <th className="text-left p-2 font-semibold text-blue-800"></th>
              </tr>
            </thead>
              <tbody>
              {dataUploaded && workflow?.survey ? (
                <tr>
                  <td className="p-2 text-gray-700">{workflow.survey.fileName || 'Uploaded file'}</td>
                  <td className="p-2 text-gray-700">
                    {workflow.surveyUploadedAt 
                      ? new Date(workflow.surveyUploadedAt).toLocaleDateString(undefined, {
                          year: 'numeric',
                          month: 'short',
                          day: 'numeric',
                          hour: 'numeric',
                          minute: '2-digit'
                        })
                      : 'N/A'}
                  </td>
                  <td className="p-2 text-gray-700">
                    {workflow.survey?.summary?.dataSummary?.totalRows || 'N/A'}
                  </td>
                  <td className="p-2">
                    <div className="flex items-center justify-end gap-3">
                      {workflow.survey?.storedFileName && (
                        <a
                          href={`${API_BASE_URL}/api/conjoint/workflows/${workflow.id}/survey/download`}
                          download
                          className="text-blue-600 hover:text-blue-800 underline"
                        >
                          Download
                        </a>
                      )}
                      <button
                        onClick={clearUploadedData}
                        className="px-3 py-1 bg-red-600 text-white text-xs font-semibold rounded-lg hover:bg-red-700 transition"
                        title="Remove all uploaded survey data and start fresh"
                      >
                        Remove Data
                      </button>
                    </div>
                  </td>
                </tr>
              ) : (
                <tr className="border-b border-blue-200">
                  <td colSpan={4} className="p-2">
                    <div className="flex items-center">
                      <div className="relative">
                        <input
                          type="file"
                          accept=".xlsx,.xls,.csv"
                          onChange={async (e) => {
                            const file = e.target.files?.[0] || null;
                            if (file) {
                              setDataFile(file);
                              setDataUploaded(false);
                              // Automatically start upload when file is selected
                              await uploadSurveyData(file);
                            }
                          }}
                          disabled={uploadingData}
                          className="hidden"
                          id="file-upload-input"
                        />
                        <label
                          htmlFor="file-upload-input"
                          className={`inline-flex items-center px-4 py-2 bg-blue-600 text-white text-sm font-semibold rounded-lg hover:bg-blue-700 cursor-pointer transition ${
                            uploadingData ? 'opacity-50 cursor-not-allowed' : ''
                          }`}
                        >
                          {uploadingData ? 'Uploading...' : 'Upload data file'}
                        </label>
                      </div>
                    </div>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
      
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
          <DataUploadSection />
          
          <div className="flex gap-6 mt-6">
            {/* Raw Survey Data Columns */}
            {workflow?.survey?.summary?.dataSummary && (
              <div className="flex-1 p-4 bg-blue-50 border border-blue-200 rounded-lg">
                <h3 className="text-sm font-semibold text-blue-800 mb-2">Survey Data Summary</h3>
                <div className="space-y-2 text-sm">
                  <div>
                    <span className="font-medium">Relevant Columns:</span> {workflow.survey.summary.dataSummary.relevantColumnCount}
                  </div>
                  <div>
                    <span className="font-medium">Choice Columns:</span> {workflow.survey.summary.dataSummary.choiceColumns}
                  </div>
                  <div>
                    <span className="font-medium">Market Share Columns:</span> {workflow.survey.summary.dataSummary.marketShareColumns}
                  </div>
                  <div>
                    <span className="font-medium">Attribute Columns:</span> {workflow.survey.summary.dataSummary.attributeColumns}
                  </div>
                </div>
              </div>
            )}
            
            {/* Survey Response Options */}
            {workflow?.survey?.summary?.marketShareProducts && workflow.survey.summary.marketShareProducts.length > 0 && (
              <div className="flex-1 p-4 bg-green-50 border border-green-200 rounded-lg">
                <h3 className="text-sm font-semibold text-green-800 mb-2">
                  Survey Response Options {workflow?.aiAnalysis?.marketShareQuestion ? `(${workflow.aiAnalysis.marketShareQuestion})` : `(${workflow.survey.summary.marketShareProducts.length})`}
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
                      {workflow.survey.summary.marketShareProducts
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
        </div>
      </div>

      {/* Main Content */}
      <div className="flex-1 flex overflow-hidden">
        {/* Left Panel - Simulator Table */}
        <div className="flex-[2] overflow-auto">
          <div className="p-6">
            <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
              <div className="overflow-x-auto">
                <table className="min-w-full divide-y divide-gray-200">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider w-1/2">
                        Attributes
                      </th>
                      <th className="px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider w-1/2">
                        <div className="flex items-center justify-center gap-3">
                          <span className="text-xs font-medium text-gray-700">
                            Product Scenario
                          </span>
                          <button
                            onClick={generateRandomSelections}
                            className="px-2 py-1 text-xs bg-gray-200 text-gray-700 rounded hover:bg-gray-300 transition font-normal"
                            title="Generate random selections for all attributes"
                          >
                            Generate Random
                          </button>
                          <button
                            onClick={() => {
                              if (scenarios.length > 0 && Object.keys(scenarios[0].selections).length > 0) {
                                setShowSaveScenarioModal(true);
                              } else {
                                alert('Please select at least one attribute level before saving');
                              }
                            }}
                            className="px-2 py-1 text-xs bg-green-600 text-white rounded hover:bg-green-700 transition font-normal"
                            title="Save current scenario"
                          >
                            Save Scenario
                          </button>
                        </div>
                      </th>
                    </tr>
                  </thead>
                  <tbody className="bg-white divide-y divide-gray-200">
                    {attributes.length > 0 ? (
                      attributes.map((attribute) => (
                        <tr key={attribute.attributeNo} className="hover:bg-gray-50">
                          <td className="px-4 py-4 text-sm text-gray-900">
                            <div className="font-medium">{attribute.attributeText}</div>
                          </td>
                          <td className="px-4 py-4 text-center">
                            <select
                              value={scenarios[0]?.selections[attribute.attributeNo] || ''}
                              onChange={(e) => updateScenarioSelection(scenarios[0].id, attribute.attributeNo, e.target.value)}
                              className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
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
                        <td colSpan={2} className="px-4 py-8 text-center text-gray-500">
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
            <div className="mt-6 flex justify-end">
              <button
                onClick={simulate}
                disabled={analyzingScenarios || marketShareProducts.length === 0 || !allAttributesSelected}
                className="px-6 py-3 bg-blue-600 text-white font-semibold rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition"
              >
                {analyzingScenarios ? 'Analyzing...' : 'Run Scenario Analysis'}
              </button>
            </div>
          </div>
        </div>

        {/* Right Panel - Market Share */}
        <div className="flex-1 bg-white border-l border-gray-200 overflow-auto">
          <div className="p-6">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-lg font-semibold text-gray-900">Market Share</h3>
                <button
                  onClick={() => setShowLoadScenarioModal(true)}
                  disabled={savedScenarios.length === 0 || activeScenarios.length >= 10}
                  className="px-2 py-1 text-xs bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition"
                >
                  Add saved product scenario
                </button>
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
                        // Get the current scenario analysis (if it exists and is in activeScenarios)
                        const currentScenario = activeScenarios.find(s => s.id === 'scenario1');
                        const analysis = currentScenario?.analysis || scenarioAnalysis;
                        
                        let adjustedShareValue = currentShareValue;
                        let changePercentPoints = 0;
                        
                        if (analysis?.projectedScenarios?.[0]) {
                          const scenarioProduct = analysis.projectedScenarios[0].products.find((p: any) => 
                            p.name === product.name || p.rowNumber === product.rowNumber
                          );
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
                            <td className="px-3 py-2 text-gray-900">{product.name}</td>
                            <td className="px-3 py-2 text-center text-gray-700 font-semibold">{(currentShareValue * 100).toFixed(1)}%</td>
                            {(activeScenarios.length > 0 || scenarioAnalysis) && (
                              <>
                                <td className={`px-3 py-2 text-center font-medium ${hasChange ? 'text-blue-600' : 'text-gray-700'}`}>
                                  {(adjustedShareValue * 100).toFixed(1)}%
                                </td>
                                <td className={`px-3 py-2 text-center italic ${
                                  isPositive ? 'text-green-600' : isNegative ? 'text-red-600' : 'text-gray-700'
                                }`}>
                                  {hasChange && (isPositive ? '+' : '')}{changePercentPoints.toFixed(1)}<span className="italic">%</span>
                                </td>
                              </>
                            )}
                          </tr>
                        );
                      })}
                      
                      {/* Saved Scenarios as additional product rows (excluding current scenario) */}
                      {activeScenarios
                        .filter(s => s.id !== 'scenario1')
                        .map((activeScenario) => {
                          const analysis = activeScenario.analysis;
                          if (!analysis?.projectedScenarios?.[0]) return null;
                          
                          const scenarioProducts = analysis.projectedScenarios[0].products || [];
                          
                          // Add each product from the saved scenario as a new row
                          return scenarioProducts.map((scenarioProduct: any, idx: number) => {
                            const currentShareValue = Number(scenarioProduct.currentShare ?? 0);
                            const futureShare = Number(scenarioProduct.marketShare ?? 0);
                            const change = Number(scenarioProduct.change ?? 0) * 100;
                            const isPositive = change > 0;
                            const isNegative = change < 0;
                            
                            // Create a unique product name that includes the scenario name
                            const productName = scenarioProduct.name || `${activeScenario.name} - Product ${idx + 1}`;
                            
                            return (
                              <tr 
                                key={`${activeScenario.id}-${idx}`} 
                                className="border-b border-gray-200"
                                data-scenario-id={activeScenario.id}
                                data-scenario-name={activeScenario.name}
                              >
                                <td className="px-3 py-2 text-gray-900">
                                  <div className="flex items-center justify-between">
                                    <span>{productName}</span>
                                    {idx === scenarioProducts.length - 1 && (
                                      <button
                                        onClick={() => removeActiveScenario(activeScenario.id)}
                                        className="ml-2 text-red-500 hover:text-red-700 text-xs font-bold"
                                        title="Remove scenario"
                                      >
                                        ×
                                      </button>
                                    )}
                                  </div>
                                </td>
                                <td className="px-3 py-2 text-center text-gray-700 font-semibold">{(currentShareValue * 100).toFixed(1)}%</td>
                                <td className="px-3 py-2 text-center font-medium text-blue-600">
                                  {(futureShare * 100).toFixed(1)}%
                                </td>
                                <td className={`px-3 py-2 text-center italic ${
                                  isPositive ? 'text-green-600' : isNegative ? 'text-red-600' : 'text-gray-700'
                                }`}>
                                  {isPositive ? '+' : ''}{change.toFixed(1)}<span className="italic">%</span>
                                </td>
                              </tr>
                            );
                          });
                        }).flat()}
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

      {/* Load/Add Saved Scenario Modal */}
      {showLoadScenarioModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-6 max-w-md w-full mx-4 max-h-[80vh] overflow-y-auto">
            <h3 className="text-lg font-semibold text-gray-900 mb-4">Saved Scenarios</h3>
            {savedScenarios.length === 0 ? (
              <p className="text-sm text-gray-600 mb-4">No saved scenarios yet. Create and save a scenario to see it here.</p>
            ) : (
              <div className="space-y-2 mb-4">
                {savedScenarios.map((savedScenario) => {
                  const isAlreadyAdded = activeScenarios.some(s => s.id === savedScenario.id);
                  return (
                    <div
                      key={savedScenario.id}
                      className="flex items-center justify-between p-3 border border-gray-200 rounded-lg hover:bg-gray-50"
                    >
                      <div className="flex-1">
                        <div className="font-medium text-gray-900">{savedScenario.name}</div>
                        <div className="text-xs text-gray-500">
                          {new Date(savedScenario.createdAt).toLocaleDateString()}
                        </div>
                      </div>
                      <div className="flex gap-2">
                        <button
                          onClick={() => loadSavedScenario(savedScenario)}
                          className="px-3 py-1 text-xs bg-blue-600 text-white rounded hover:bg-blue-700 transition"
                        >
                          Load
                        </button>
                        <button
                          onClick={() => addSavedScenarioToView(savedScenario)}
                          disabled={isAlreadyAdded || activeScenarios.length >= 10}
                          className="px-3 py-1 text-xs bg-green-600 text-white rounded hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed transition"
                        >
                          {isAlreadyAdded ? 'Added' : 'Add to View'}
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
            <div className="flex justify-end">
              <button
                onClick={() => setShowLoadScenarioModal(false)}
                className="px-4 py-2 text-sm text-gray-700 bg-gray-200 rounded-lg hover:bg-gray-300 transition"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}
