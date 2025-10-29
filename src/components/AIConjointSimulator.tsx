import React, { useState, useEffect } from 'react';
import { API_BASE_URL } from '../config';

interface AIConjointSimulatorProps {
  workflow: any;
  onClose?: () => void;
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

interface MarketShareProduct {
  name: string;
  currentShare: number;
  adjustedShare?: number;
}

export default function AIConjointSimulator({ workflow, onClose }: AIConjointSimulatorProps) {
  const [attributes, setAttributes] = useState<Attribute[]>([]);
  const [scenarios, setScenarios] = useState<Scenario[]>([
    { id: 'scenario1', name: 'Scenario 1', enabled: false, selections: {} },
    { id: 'scenario2', name: 'Scenario 2', enabled: false, selections: {} },
    { id: 'scenario3', name: 'Scenario 3', enabled: false, selections: {} }
  ]);
  const [marketShareProducts, setMarketShareProducts] = useState<MarketShareProduct[]>([]);
  const [simulating, setSimulating] = useState(false);
  const [dataFile, setDataFile] = useState<File | null>(null);
  const [uploadingData, setUploadingData] = useState(false);
  const [dataUploaded, setDataUploaded] = useState(false);
  const [surveyData, setSurveyData] = useState<any>(null);
  const [showInfoModal, setShowInfoModal] = useState(false);

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

    // Initialize market share products from AI analysis
    if (workflow?.aiAnalysis?.products) {
      const products = workflow.aiAnalysis.products.map((product: string) => ({
        name: product,
        currentShare: 0,
        adjustedShare: 0
      }));
      setMarketShareProducts(products);
    }
  }, [workflow]);

  const updateScenarioSelection = (scenarioId: string, attributeNo: string, levelCode: string) => {
    setScenarios(prev => prev.map(scenario => 
      scenario.id === scenarioId 
        ? { ...scenario, selections: { ...scenario.selections, [attributeNo]: levelCode } }
        : scenario
    ));
  };

  const toggleScenarioEnabled = (scenarioId: string) => {
    setScenarios(prev => prev.map(scenario => 
      scenario.id === scenarioId 
        ? { ...scenario, enabled: !scenario.enabled }
        : scenario
    ));
  };

  const uploadSurveyData = async () => {
    if (!dataFile) {
      alert('Please select a data file first');
      return;
    }

    setUploadingData(true);
    try {
      const formData = new FormData();
      formData.append('file', dataFile);
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

  const [scenarioAnalysis, setScenarioAnalysis] = useState<any>(null);
  const [analyzingScenarios, setAnalyzingScenarios] = useState(false);

  const simulate = async () => {
    setAnalyzingScenarios(true);
    try {
      const enabledScenarios = scenarios.filter(s => s.enabled);
      
      if (enabledScenarios.length === 0) {
        // Reset to original shares
        setMarketShareProducts(prev => prev.map(product => ({
          ...product,
          adjustedShare: product.currentShare
        })));
        setScenarioAnalysis(null);
        return;
      }

      // Prepare new scenarios for Python backend
      const newScenarios = enabledScenarios.map(scenario => {
        const scenarioData: Record<string, string> = {};
        
        // Map scenario selections to attribute levels
        Object.entries(scenario.selections).forEach(([attributeId, levelId]) => {
          const attribute = attributes.find(attr => attr.attributeNo === attributeId);
          const level = attribute?.levels.find(lvl => lvl.levelNo === levelId);
          
          if (attribute && level) {
            // Use attribute text as key and level text as value
            scenarioData[attribute.attributeText] = level.levelText;
          }
        });
        
        return scenarioData;
      });

      console.log('Sending scenarios to backend:', newScenarios);

      // Call the scenario analysis endpoint
      const response = await fetch(`${API_BASE_URL}/api/conjoint/workflows/${workflow.id}/scenario-analysis`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          newScenarios: newScenarios,
          choiceRule: 'logit'
        }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.detail || 'Scenario analysis failed');
      }

      const result = await response.json();
      console.log('Scenario analysis result:', result);

      // Update market share products with projected shares
      if (result.scenarioAnalysis?.projectedScenarios?.[0]) {
        const firstScenario = result.scenarioAnalysis.projectedScenarios[0];
        const updatedProducts = firstScenario.products.map((product: any) => ({
          name: product.name,
          currentShare: product.currentShare || 0,
          adjustedShare: product.marketShare || 0,
          change: product.change || 0
        }));

        setMarketShareProducts(updatedProducts);
        setScenarioAnalysis(result.scenarioAnalysis);
      }

    } catch (error) {
      console.error('Scenario analysis error:', error);
      alert(`Scenario analysis failed: ${error.message}`);
    } finally {
      setAnalyzingScenarios(false);
    }
  };

  const totalMarketShare = marketShareProducts.reduce((sum, product) => sum + (product.adjustedShare || product.currentShare), 0);

  return (
    <div className="h-full flex flex-col bg-gray-50">
      {/* Header */}
      <div className="bg-white border-b border-gray-200 px-6 py-4">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-semibold text-gray-900">AI Conjoint Simulator</h1>
            <p className="text-sm text-gray-600 mt-1">{workflow?.name || 'Workflow Simulator'}</p>
          </div>
          <div className="flex items-center gap-3">
            <button
              onClick={() => setShowInfoModal(true)}
              className="px-3 py-2 text-sm font-medium text-blue-700 bg-blue-50 border border-blue-200 rounded-lg hover:bg-blue-100 transition flex items-center gap-2"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              View Analysis Details
            </button>
            {onClose && (
              <button
                onClick={onClose}
                className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 transition"
              >
                Close
              </button>
            )}
          </div>
        </div>
        
        {/* Data Upload Section */}
        <div className="mt-4 p-4 bg-blue-50 border border-blue-200 rounded-lg">
          <div className="flex items-center justify-between">
            <div className="flex-1">
              <h3 className="text-sm font-semibold text-blue-900 mb-2">AI-Powered Data Processing</h3>
              <p className="text-xs text-blue-700 mb-3">
                Upload your raw survey data file. AI will intelligently analyze it to extract only the columns relevant to your conjoint analysis, using the datamap to understand code definitions.
              </p>
              <div className="flex items-center gap-3">
                <input
                  type="file"
                  accept=".xlsx,.xls,.csv"
                  onChange={(e) => setDataFile(e.target.files?.[0] || null)}
                  className="text-sm text-gray-600 file:mr-4 file:py-2 file:px-4 file:rounded-lg file:border-0 file:text-sm file:font-semibold file:bg-blue-50 file:text-blue-700 hover:file:bg-blue-100"
                />
                {dataFile && (
                  <div className="text-xs text-green-600 flex items-center gap-1">
                    <span>✓</span>
                    <span>{dataFile.name}</span>
                  </div>
                )}
                <button
                  onClick={uploadSurveyData}
                  disabled={uploadingData || !dataFile || dataUploaded}
                  className="px-4 py-2 bg-blue-600 text-white text-sm font-semibold rounded-lg disabled:opacity-50 disabled:cursor-not-allowed hover:bg-blue-700 transition"
                >
                  {uploadingData ? 'Uploading...' : dataUploaded ? 'Data Uploaded' : 'Upload Data'}
                </button>
              </div>
            </div>
            {dataUploaded && (
              <div className="ml-4 text-xs text-green-600 flex items-center gap-1">
                <span>✓</span>
                <span>Survey data processed</span>
              </div>
            )}
          </div>
        </div>

        {/* Data Processing Results */}
        {surveyData?.detailedBreakdown && (
          <div className="mt-4 p-4 bg-green-50 border border-green-200 rounded-lg">
            <h3 className="text-sm font-semibold text-green-900 mb-3">Data Processing Complete!</h3>
            
            <div className="grid grid-cols-2 gap-4 mb-4">
              <div className="bg-white p-3 rounded-lg border border-green-200">
                <div className="text-xs font-semibold text-gray-700 mb-1">Total Rows Processed</div>
                <div className="text-lg font-bold text-green-600">{surveyData.detailedBreakdown.totalRows}</div>
              </div>
              <div className="bg-white p-3 rounded-lg border border-green-200">
                <div className="text-xs font-semibold text-gray-700 mb-1">Relevant Columns Found</div>
                <div className="text-lg font-bold text-green-600">{surveyData.detailedBreakdown.relevantColumnCount}</div>
              </div>
            </div>

            <div className="grid grid-cols-3 gap-3 mb-4">
              <div className="bg-white p-3 rounded-lg border border-green-200">
                <div className="text-xs font-semibold text-gray-700 mb-1">Choice Columns</div>
                <div className="text-sm font-bold text-blue-600">{surveyData.detailedBreakdown.choiceColumns}</div>
              </div>
              <div className="bg-white p-3 rounded-lg border border-green-200">
                <div className="text-xs font-semibold text-gray-700 mb-1">Market Share Columns</div>
                <div className="text-sm font-bold text-purple-600">{surveyData.detailedBreakdown.marketShareColumns}</div>
              </div>
              <div className="bg-white p-3 rounded-lg border border-green-200">
                <div className="text-xs font-semibold text-gray-700 mb-1">Attribute Columns</div>
                <div className="text-sm font-bold text-orange-600">{surveyData.detailedBreakdown.attributeColumns}</div>
              </div>
            </div>

            {/* Market Share Scenarios */}
            {surveyData.detailedBreakdown.marketShareScenarios && (
              <div className="mb-4">
                <div className="text-xs font-semibold text-gray-700 mb-2">Market Share Scenarios</div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="bg-white p-3 rounded-lg border border-green-200">
                    <div className="text-xs font-semibold text-gray-700 mb-1">Original (Current Market)</div>
                    <div className="text-sm font-bold text-green-600">
                      {surveyData.detailedBreakdown.marketShareScenarios.original} tasks
                    </div>
                  </div>
                  <div className="bg-white p-3 rounded-lg border border-green-200">
                    <div className="text-xs font-semibold text-gray-700 mb-1">With New Options</div>
                    <div className="text-sm font-bold text-blue-600">
                      {surveyData.detailedBreakdown.marketShareScenarios.withNewOptions} tasks
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* Products Found */}
            {surveyData.detailedBreakdown.products && surveyData.detailedBreakdown.products.length > 0 && (
              <div>
                <div className="text-xs font-semibold text-gray-700 mb-2">Products Identified</div>
                <div className="flex flex-wrap gap-2">
                  {surveyData.detailedBreakdown.products.map((product: any, i: number) => (
                    <span key={i} className="px-2 py-1 bg-white text-xs font-medium text-gray-700 border border-green-200 rounded">
                      {product.name}
                    </span>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Main Content */}
      <div className="flex-1 flex overflow-hidden">
        {/* Left Panel - Simulator Table (3/4 width) */}
        <div className="flex-1 overflow-auto">
          <div className="p-6">
            <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
              <div className="overflow-x-auto">
                <table className="min-w-full divide-y divide-gray-200">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider w-1/4">
                        Attributes
                      </th>
                      {scenarios.map((scenario, index) => (
                        <th key={scenario.id} className="px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider">
                          <div className="flex flex-col items-center space-y-2">
                            <div className="flex items-center space-x-2">
                              <input
                                type="checkbox"
                                checked={scenario.enabled}
                                onChange={() => toggleScenarioEnabled(scenario.id)}
                                className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 rounded"
                              />
                              <span className="text-xs font-medium text-gray-700">
                                {scenario.name}
                              </span>
                            </div>
                          </div>
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="bg-white divide-y divide-gray-200">
                    {attributes.length > 0 ? (
                      attributes.map((attribute) => (
                        <tr key={attribute.attributeNo} className="hover:bg-gray-50">
                          <td className="px-4 py-4 text-sm text-gray-900">
                            <div className="font-medium">{attribute.attributeText}</div>
                            <div className="text-xs text-gray-500">Attribute {attribute.attributeNo}</div>
                          </td>
                          {scenarios.map((scenario) => (
                            <td key={scenario.id} className="px-4 py-4 text-center">
                              <select
                                value={scenario.selections[attribute.attributeNo] || ''}
                                onChange={(e) => updateScenarioSelection(scenario.id, attribute.attributeNo, e.target.value)}
                                className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                                disabled={!scenario.enabled}
                              >
                                <option value="">Select level...</option>
                                {attribute.levels.map((level) => (
                                  <option key={level.code} value={level.code}>
                                    {level.levelText}
                                  </option>
                                ))}
                              </select>
                            </td>
                          ))}
                        </tr>
                      ))
                    ) : (
                      <tr>
                        <td colSpan={scenarios.length + 1} className="px-4 py-8 text-center text-gray-500">
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
            <div className="mt-6 flex justify-center">
              <button
                onClick={simulate}
                disabled={analyzingScenarios || marketShareProducts.length === 0}
                className="px-6 py-3 bg-blue-600 text-white font-semibold rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition"
              >
                {analyzingScenarios ? 'Analyzing...' : 'Run Scenario Analysis'}
              </button>
            </div>
          </div>
        </div>

        {/* Right Panel - Market Share (1/4 width) */}
        <div className="w-1/4 bg-white border-l border-gray-200 overflow-auto">
          <div className="p-6">
            <h3 className="text-lg font-semibold text-gray-900 mb-4">Market Share</h3>
            
            <div className="space-y-4">
              {/* Current Products */}
              <div>
                <h4 className="text-sm font-medium text-gray-700 mb-2">Current Products</h4>
                <div className="space-y-2">
                  {marketShareProducts.map((product, index) => (
                    <div key={index} className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
                      <div className="flex-1">
                        <div className="text-sm font-medium text-gray-900">{product.name}</div>
                        {(() => {
                          const currentShareValue = Number(product.currentShare ?? 0);
                          const adjustedShareValue = Number(product.adjustedShare ?? currentShareValue);
                          return (
                            <>
                        <div className="text-xs text-gray-500">
                          Original: {(currentShareValue * 100).toFixed(1)}%
                        </div>
                        {product.adjustedShare !== undefined && Math.abs(adjustedShareValue - currentShareValue) > 0.0001 && (
                          <div className="text-xs text-blue-600">
                            Adjusted: {(adjustedShareValue * 100).toFixed(1)}%
                          </div>
                        )}
                          </>
                          );
                        })()}
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* New Scenarios */}
              <div>
                <h4 className="text-sm font-medium text-gray-700 mb-2">New Scenarios</h4>
                <div className="space-y-2">
                  {scenarios.filter(s => s.enabled).map((scenario) => (
                    <div key={scenario.id} className="p-3 bg-blue-50 rounded-lg">
                      <div className="text-sm font-medium text-blue-900">{scenario.name}</div>
                      <div className="text-xs text-blue-600">
                        {Object.keys(scenario.selections).length} attributes configured
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Total Market Share */}
              <div className="pt-4 border-t border-gray-200">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium text-gray-700">Total Market Share:</span>
                  <span className={`text-sm font-semibold ${Math.abs((totalMarketShare * 100) - 100) < 0.1 ? 'text-green-600' : 'text-red-600'}`}>
                    {(totalMarketShare * 100).toFixed(1)}%
                  </span>
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

                  {/* Projected Scenarios */}
                  {scenarioAnalysis.projectedScenarios && scenarioAnalysis.projectedScenarios.length > 0 && (
                    <div className="space-y-2">
                      <div className="text-xs font-medium text-gray-600">Projected Scenarios:</div>
                      {scenarioAnalysis.projectedScenarios.map((scenario: any, index: number) => (
                        <div key={index} className="p-2 bg-blue-50 rounded text-xs">
                          <div className="font-medium text-blue-900">{scenario.scenario_name}</div>
                          <div className="text-blue-700">
                            Total Share: {(scenario.total_share * 100).toFixed(1)}%
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Info Modal */}
      {showInfoModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50">
          <div className="bg-white rounded-lg shadow-xl max-w-4xl w-full mx-4 max-h-[90vh] overflow-y-auto">
            <div className="p-6">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-lg font-semibold text-gray-900">AI Analysis Details</h2>
                <button
                  onClick={() => setShowInfoModal(false)}
                  className="text-gray-400 hover:text-gray-600 transition"
                >
                  <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>

              <div className="space-y-4">
                {/* Conjoint Section */}
                {workflow?.aiAnalysis?.conjointSection && (
                  <div className="p-4 bg-green-50 border border-green-200 rounded-lg">
                    <h3 className="text-sm font-semibold text-green-800 mb-2">Conjoint Section Identified</h3>
                    <p className="text-sm text-gray-700">{workflow.aiAnalysis.conjointSection}</p>
                    {workflow.aiAnalysis.sectionDescription && (
                      <p className="text-xs text-gray-600 mt-1">{workflow.aiAnalysis.sectionDescription}</p>
                    )}
                  </div>
                )}

                {/* Products */}
                {workflow?.aiAnalysis?.products && workflow.aiAnalysis.products.length > 0 && (
                  <div className="p-4 bg-blue-50 border border-blue-200 rounded-lg">
                    <h3 className="text-sm font-semibold text-blue-800 mb-2">Products Found ({workflow.aiAnalysis.products.length})</h3>
                    <div className="grid grid-cols-2 gap-2">
                      {workflow.aiAnalysis.products.map((product: any, i: number) => (
                        <div key={i} className="text-sm text-gray-700 bg-white p-2 rounded border">
                          {product.name || product}
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Survey Response Options */}
                {workflow?.survey?.summary?.marketShareProducts && workflow.survey.summary.marketShareProducts.length > 0 && (
                  <div className="p-4 bg-green-50 border border-green-200 rounded-lg">
                    <h3 className="text-sm font-semibold text-green-800 mb-2">Survey Response Options ({workflow.survey.summary.marketShareProducts.length})</h3>
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="border-b border-green-300">
                            <th className="text-left p-2 font-semibold text-green-800">Response Number</th>
                            <th className="text-left p-2 font-semibold text-green-800">Response Option</th>
                            <th className="text-right p-2 font-semibold text-green-800">Avg Share</th>
                          </tr>
                        </thead>
                        <tbody>
                          {workflow.survey.summary.marketShareProducts
                            .sort((a: any, b: any) => (a.rowNumber || 0) - (b.rowNumber || 0))
                            .map((product: any, i: number) => (
                            <tr key={i} className="border-b border-green-200">
                              <td className="p-2 font-mono text-gray-700">{product.rowNumber || 'N/A'}</td>
                              <td className="p-2 text-gray-700">{product.name}</td>
                              <td className="p-2 text-right font-mono text-gray-700">
                                {product.currentShare ? `${(product.currentShare * 100).toFixed(1)}%` : 'N/A'}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}

                {/* Raw Survey Data Columns */}
                {workflow?.survey?.summary?.dataSummary && (
                  <div className="p-4 bg-orange-50 border border-orange-200 rounded-lg">
                    <h3 className="text-sm font-semibold text-orange-800 mb-2">Survey Data Summary</h3>
                    <div className="grid grid-cols-2 gap-4 text-sm">
                      <div>
                        <span className="font-medium">Total Rows:</span> {workflow.survey.summary.dataSummary.totalRows}
                      </div>
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

                {/* Attributes */}
                {workflow?.aiAnalysis?.attributes && workflow.aiAnalysis.attributes.length > 0 && (
                  <div className="p-4 bg-purple-50 border border-purple-200 rounded-lg">
                    <h3 className="text-sm font-semibold text-purple-800 mb-2">Attributes Found ({workflow.aiAnalysis.attributes.length})</h3>
                    <div className="space-y-3">
                      {workflow.aiAnalysis.attributes.map((attr: any, i: number) => (
                        <div key={i} className="bg-white p-3 rounded border">
                          <div className="font-medium text-gray-900 mb-2">
                            {attr.attributeText || attr.name} (Attribute {attr.attributeNo || i + 1})
                          </div>
                          {attr.levels && attr.levels.length > 0 && (
                            <div className="ml-2">
                              <div className="text-xs text-gray-600 mb-1">{attr.levels.length} levels:</div>
                              <div className="grid grid-cols-2 gap-1">
                                {attr.levels.map((level: any, j: number) => (
                                  <div key={j} className="text-xs text-gray-600 bg-gray-50 p-1 rounded">
                                    {level.levelText || level.name || level}
                                  </div>
                                ))}
                              </div>
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Design Summary */}
                {workflow?.designSummary && (
                  <div className="p-4 bg-yellow-50 border border-yellow-200 rounded-lg">
                    <h3 className="text-sm font-semibold text-yellow-800 mb-2">Design Summary</h3>
                    <div className="grid grid-cols-2 gap-4 text-sm">
                      <div>
                        <span className="font-medium">Total Rows:</span> {workflow.designSummary.totalRows}
                      </div>
                      <div>
                        <span className="font-medium">Attribute Columns:</span> {workflow.designSummary.attColumnCount}
                      </div>
                      <div>
                        <span className="font-medium">Versions:</span> {workflow.designSummary.versions}
                      </div>
                      <div>
                        <span className="font-medium">Coverage:</span> {workflow.designSummary.attributeCoverage}%
                      </div>
                    </div>
                  </div>
                )}

                {/* Market Share Question */}
                {workflow?.aiAnalysis?.marketShareQuestion && (
                  <div className="p-4 bg-indigo-50 border border-indigo-200 rounded-lg">
                    <h3 className="text-sm font-semibold text-indigo-800 mb-2">Market Share Question</h3>
                    <p className="text-sm text-gray-700">{workflow.aiAnalysis.marketShareQuestion}</p>
                  </div>
                )}

                {/* Workflow Info */}
                <div className="p-4 bg-gray-50 border border-gray-200 rounded-lg">
                  <h3 className="text-sm font-semibold text-gray-800 mb-2">Workflow Information</h3>
                  <div className="grid grid-cols-2 gap-4 text-sm">
                    <div>
                      <span className="font-medium">Workflow ID:</span> {workflow?.id}
                    </div>
                    <div>
                      <span className="font-medium">Created:</span> {workflow?.createdAt ? new Date(workflow.createdAt).toLocaleString() : 'Unknown'}
                    </div>
                    <div>
                      <span className="font-medium">Source File:</span> {workflow?.sourceFileName || 'Unknown'}
                    </div>
                    <div>
                      <span className="font-medium">Status:</span> {workflow?.temporary ? 'Temporary' : 'Finalized'}
                    </div>
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
