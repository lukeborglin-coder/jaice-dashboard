import { useEffect, useState } from "react";
import axios from "axios";
import * as XLSX from "xlsx";
import { API_BASE_URL } from '../config';

const API_BASE = `${API_BASE_URL}/api/conjoint`;

type SimulatorAttribute = {
  name: string;
  levels: string[];
  reference?: string | null;
  label?: string | null;
};

type SimulatorSchema = {
  attributes?: SimulatorAttribute[];
};

type SimulatorModel = {
  intercept: number;
  utilities: Record<string, Record<string, number>>;
  schema?: SimulatorSchema | null;
};

type MarketShareProduct = {
  name: string;
  currentShare: number;
  newShare?: number;
};

interface ConjointSimulatorProps {
  initialModel?: SimulatorModel | null;
  initialScenarios?: any[];
  embedded?: boolean;
  onClose?: () => void;
  currentProducts?: MarketShareProduct[];
}

export default function ConjointSimulator({
  initialModel: initialModelProp = null,
  initialScenarios,
  embedded = false,
  onClose,
  currentProducts = []
}: ConjointSimulatorProps = {}) {
  const buildScenario = (attributesList: SimulatorAttribute[] = []) => {
    const scenario: Record<string, string> = {};
    attributesList.forEach(attribute => {
      const levels = Array.isArray(attribute.levels) ? attribute.levels : [];
      scenario[attribute.name] = attribute.reference || levels[0] || "";
    });
    return scenario;
  };

  const [file, setFile] = useState<File | null>(null);
  const [model, setModel] = useState<any>(initialModelProp);
  const [scenarios, setScenarios] = useState<any[]>(() => {
    if (initialModelProp?.schema?.attributes?.length) {
      if (initialScenarios && initialScenarios.length > 0) {
        return initialScenarios;
      }
      return [buildScenario(initialModelProp.schema.attributes || [])];
    }
    return initialScenarios || [];
  });
  const [rule, setRule] = useState<"logit" | "first_choice">("logit");
  const [results, setResults] = useState<any>(null);
  const [busy, setBusy] = useState(false);
  const [useSurveyFormat, setUseSurveyFormat] = useState(true); // Default to survey format
  const enableFileUpload = !initialModelProp;

  useEffect(() => {
    if (!initialModelProp) {
      return;
    }
    setModel(initialModelProp);
    setResults(null);
    if (initialModelProp.schema?.attributes?.length) {
      setScenarios(prev => {
        if (initialScenarios && initialScenarios.length > 0) {
          return initialScenarios;
        }
        if (prev.length > 0) {
          return prev;
        }
        return [buildScenario(initialModelProp.schema?.attributes || [])];
      });
    }
  }, [initialModelProp, initialScenarios]);

  async function onEstimate() {
    if (!file) return alert("Upload an Excel (.xlsx) file first.");
    setBusy(true);
    try {
      const fd = new FormData();
      fd.append("file", file);

      // Choose endpoint based on format
      const endpoint = useSurveyFormat
        ? `${API_BASE}/estimate_from_survey_export`
        : `${API_BASE}/estimate_from_two_sheets`;

      const res = await axios.post(endpoint, fd, {
        headers: { "Content-Type": "multipart/form-data" }
      });
      setModel(res.data);
      // Initialize one scenario with first level of each attribute
      const attributes: SimulatorAttribute[] = res.data?.schema?.attributes || [];
      const baseScenario = buildScenario(attributes);
      setScenarios([baseScenario]);
      setResults(null);
    } catch (e: any) {
      console.error(e);
      alert(e?.response?.data?.detail || e.message);
    } finally {
      setBusy(false);
    }
  }

  function updateScenario(idx: number, key: string, value: string) {
    const next = scenarios.map((s, i) => i === idx ? { ...s, [key]: value } : s);
    setScenarios(next);
  }

  function addScenario() {
    if (!model) return;
    if (scenarios.length >= 5) {
      alert("Maximum of 5 scenarios allowed");
      return;
    }
    const base = buildScenario(model.schema?.attributes || []);
    setScenarios([...scenarios, base]);
  }

  function removeScenario(i: number) {
    setScenarios(scenarios.filter((_, idx) => idx !== i));
  }

  function validateScenarios() {
    if (!model) return false;
    const attrNames = Array.isArray(model?.schema?.attributes)
      ? model.schema.attributes.map((a: any) => a.name)
      : [];
    if (attrNames.length === 0) {
      return false;
    }
    for (const s of scenarios) {
      for (const a of attrNames) {
        const v = s[a];
        if (v === undefined || v === null || String(v).trim() === "") return false;
      }
    }
    return true;
  }

  async function runSimulation() {
    if (!model) return alert("Estimate first.");
    if (!validateScenarios()) return alert("Every scenario must have a value for every attribute (no blanks).");
    setBusy(true);
    try {
      const payload = {
        intercept: model.intercept,
        utilities: model.utilities,
        scenarios,
        rule
      };
      const res = await axios.post(`${API_BASE}/simulate`, payload);

      // If we have current products, adjust shares to account for them
      if (currentProducts.length > 0 && res.data.shares) {
        const newScenarioShares = res.data.shares;
        const totalNewShare = newScenarioShares.reduce((sum: number, s: number) => sum + s, 0);

        // Calculate total current product share (should be 1.0 or close to it)
        const totalCurrentShare = currentProducts.reduce((sum, p) => sum + p.currentShare, 0);

        // Redistribute: new scenarios get their calculated shares,
        // current products get their baseline shares scaled down proportionally
        const scaleFactor = totalCurrentShare > 0 ? (1 - totalNewShare) / totalCurrentShare : 0;

        const adjustedCurrentProducts = currentProducts.map(p => ({
          ...p,
          adjustedShare: p.currentShare * scaleFactor
        }));

        setResults({
          ...res.data,
          adjustedCurrentProducts
        });
      } else {
        setResults(res.data);
      }
    } catch (e: any) {
      console.error(e);
      alert(e?.response?.data?.detail || e.message);
    } finally {
      setBusy(false);
    }
  }

  function downloadExcel() {
    if (!results || !model) return;
    const rows = scenarios.map((s, i) => {
      const utilities = Array.isArray(results.utilities) ? results.utilities : [];
      const shares = Array.isArray(results.shares) ? results.shares : [];
      const utilityValue = Number(utilities[i] ?? 0);
      const shareValue = Number(shares[i] ?? 0);

      return {
        Scenario: `Product ${i + 1}`,
        ...s,
        Utility: Number.isFinite(utilityValue) ? utilityValue : 0,
        'Share (%)': Number.isFinite(shareValue) ? shareValue * 100 : 0
      };
    });
    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Simulation");
    XLSX.writeFile(wb, "conjoint_simulation.xlsx");
  }
  const attrs = Array.isArray(model?.schema?.attributes) ? model.schema.attributes : [];
  const outerClassName = embedded ? "h-full bg-white text-gray-900" : "min-h-screen bg-gray-50 text-gray-900 p-6";
  const innerWrapperClassName = embedded ? "h-full overflow-y-auto" : "max-w-6xl mx-auto";
  const contentWrapperClassName = embedded ? "space-y-6 px-6 py-6" : "space-y-6";

  return (
    <div className={outerClassName}>
      <div className={innerWrapperClassName}>
        <div className={contentWrapperClassName}>
          {enableFileUpload && (
            <div className="bg-white rounded-2xl p-6 shadow">
              <h2 className="text-xl font-semibold mb-4">1) Upload Excel (.xlsx)</h2>

              {/* Format Selection */}
              <div className="mb-4 flex items-center gap-4">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="radio"
                    checked={useSurveyFormat}
                    onChange={() => setUseSurveyFormat(true)}
                    className="w-4 h-4"
                  />
                  <span className="text-sm">Survey Export (wide format)</span>
                </label>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="radio"
                    checked={!useSurveyFormat}
                    onChange={() => setUseSurveyFormat(false)}
                    className="w-4 h-4"
                  />
                  <span className="text-sm">Pre-formatted (two sheets)</span>
                </label>
              </div>

              <input
                type="file"
                accept=".xlsx"
                onChange={e => setFile(e.target.files?.[0] || null)}
                className="block mb-2"
              />
              <p className="text-sm text-gray-600 mb-3">
                {useSurveyFormat ? (
                  <>
                    <strong>Survey Export Format:</strong><br />
                    Automatically converts wide survey data with QC1_N choice columns and hATTR_*_Nc* attribute columns
                  </>
                ) : (
                  <>
                    <strong>Pre-formatted:</strong><br />
                    Sheet1 = CBC data in long format (resp_id, task_id, alt_id, chosen + one column per attribute)<br />
                    Sheet2 = Definitions table (name, type, levels, reference)
                  </>
                )}
              </p>
              <button
                onClick={onEstimate}
                disabled={busy}
                className="px-4 py-2 rounded-xl bg-black text-white disabled:opacity-50 hover:bg-gray-800 transition"
              >
                {busy ? "Estimating..." : "Estimate Model"}
              </button>

              {model && (
                <div className="mt-4 p-4 bg-green-50 rounded-lg">
                  <div className="font-semibold text-green-800">Model estimated successfully</div>
                  <div className="text-sm text-green-700">
                    Intercept: {typeof model.intercept === "number" ? model.intercept.toFixed(4) : String(model.intercept)}
                  </div>
                </div>
              )}
            </div>
          )}

          <div className="bg-white rounded-2xl p-6 shadow">
            <h2 className="text-xl font-semibold mb-4">
              {enableFileUpload ? "2) Build scenarios (all attributes required)" : "Build scenarios (all attributes required)"}
            </h2>
            {!model && (
              <div className="text-sm text-gray-600 p-4 bg-gray-50 rounded-lg">
                {enableFileUpload ? "Estimate first to load attributes and levels." : "Utilities have not been provided."}
              </div>
            )}
            {model && (
              <>
                <div className="flex gap-6">
                  {/* Main table section - 3/4 width */}
                  <div className="flex-1">
                    <div className="overflow-x-auto">
                      <table className="w-full border-collapse">
                        <thead>
                          <tr className="border-b-2 border-gray-300">
                            <th className="text-left p-3 bg-gray-50 font-semibold text-sm">Attribute</th>
                            {scenarios.map((_, i) => (
                              <th key={i} className="p-3 bg-gray-50 text-center">
                                <div className="flex flex-col items-center gap-2">
                                  <span className="font-semibold text-sm">Product {i + 1}</span>
                                  {scenarios.length > 1 && (
                                    <button
                                      onClick={() => removeScenario(i)}
                                      className="text-xs text-red-600 hover:underline"
                                    >
                                      Remove
                                    </button>
                                  )}
                                </div>
                              </th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {attrs.map((a: any) => (
                            <tr key={a.name} className="border-b border-gray-200">
                              <td className="p-3 font-medium text-sm text-gray-700 bg-gray-50">
                                {a.label || a.name}
                              </td>
                              {scenarios.map((s, i) => (
                                <td key={i} className="p-3">
                                  <select
                                    className="w-full border border-gray-300 rounded-lg p-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                                    value={s[a.name]}
                                    onChange={e => updateScenario(i, a.name, e.target.value)}
                                    required
                                  >
                                    {(a.levels || []).map((lvl: string) => (
                                      <option key={lvl} value={lvl}>{lvl}</option>
                                    ))}
                                  </select>
                                </td>
                              ))}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                    {scenarios.length < 5 && (
                      <button
                        onClick={addScenario}
                        className="mt-4 px-4 py-2 rounded-xl border border-gray-300 hover:bg-gray-50 transition text-sm"
                      >
                        + Add scenario ({scenarios.length}/5)
                      </button>
                    )}
                  </div>

                  {/* Market share section - 1/4 width */}
                  <div className="w-80 border-l pl-6">
                    <h3 className="font-semibold text-lg mb-4">Market Share</h3>
                    {!results && currentProducts.length === 0 && (
                      <div className="text-sm text-gray-500 italic">
                        Run simulation to see market shares
                      </div>
                    )}
                    {(results || currentProducts.length > 0) && (
                      <div className="space-y-3">
                        <div className="overflow-x-auto">
                          <table className="w-full text-sm border-collapse">
                            <thead>
                              <tr className="border-b border-gray-300">
                                <th className="text-left p-2 font-semibold text-gray-700">Product</th>
                                <th className="text-right p-2 font-semibold text-gray-700">Share</th>
                              </tr>
                            </thead>
                            <tbody>
                              {/* Current products from C2 */}
                              {currentProducts.map((product, i) => {
                                const adjustedProducts = results?.adjustedCurrentProducts || [];
                                const adjustedProduct = adjustedProducts.find((p: any) => p.name === product.name);
                                const displayShare = adjustedProduct ? adjustedProduct.adjustedShare : product.currentShare;
                                const isAdjusted = !!adjustedProduct;

                                return (
                                  <tr key={`current-${i}`} className="border-b border-gray-200 bg-gray-50">
                                    <td className="p-2 text-gray-700">{product.name}</td>
                                    <td className="p-2 text-right font-semibold text-gray-600">
                                      {isAdjusted && product.currentShare !== displayShare && (
                                        <span className="text-xs line-through text-gray-400 mr-2">
                                          {(product.currentShare * 100).toFixed(1)}%
                                        </span>
                                      )}
                                      {(displayShare * 100).toFixed(1)}%
                                    </td>
                                  </tr>
                                );
                              })}
                              {/* New product scenarios */}
                              {results && scenarios.map((_, i) => {
                                const shares = Array.isArray(results.shares) ? results.shares : [];
                                const rawShare = Number(shares[i] ?? 0);
                                const clampedShare = Number.isFinite(rawShare)
                                  ? Math.max(0, Math.min(rawShare, 1))
                                  : 0;
                                return (
                                  <tr key={`new-scenario-${i}`} className="border-b border-gray-200">
                                    <td className="p-2 text-gray-700">Product {i + 1} (New)</td>
                                    <td className="p-2 text-right font-semibold text-blue-600">
                                      {(clampedShare * 100).toFixed(1)}%
                                    </td>
                                  </tr>
                                );
                              })}
                              {/* Total row */}
                              {results && (
                                <tr className="border-t-2 border-gray-400 font-semibold">
                                  <td className="p-2 text-gray-900">Total</td>
                                  <td className="p-2 text-right text-gray-900">
                                    {(() => {
                                      const adjustedProducts = results.adjustedCurrentProducts || [];
                                      const currentTotal = adjustedProducts.reduce((sum: number, p: any) => sum + (p.adjustedShare || 0), 0);
                                      const newTotal = (results.shares || []).reduce((sum: number, s: number) => sum + s, 0);
                                      return ((currentTotal + newTotal) * 100).toFixed(1);
                                    })()}%
                                  </td>
                                </tr>
                              )}
                            </tbody>
                          </table>
                        </div>
                        {/* Visual bar chart */}
                        <div className="space-y-2 mt-4">
                          {/* Current products */}
                          {currentProducts.map((product, i) => {
                            const adjustedProducts = results?.adjustedCurrentProducts || [];
                            const adjustedProduct = adjustedProducts.find((p: any) => p.name === product.name);
                            const displayShare = adjustedProduct ? adjustedProduct.adjustedShare : product.currentShare;

                            return (
                              <div key={`current-bar-${i}`} className="space-y-1">
                                <div className="text-xs text-gray-600">{product.name}</div>
                                <div className="h-2 w-full rounded-full bg-gray-200">
                                  <div
                                    className="h-full rounded-full bg-gray-400 transition-all"
                                    style={{ width: `${displayShare * 100}%` }}
                                  />
                                </div>
                              </div>
                            );
                          })}
                          {/* New scenarios */}
                          {results && scenarios.map((_, i) => {
                            const shares = Array.isArray(results.shares) ? results.shares : [];
                            const rawShare = Number(shares[i] ?? 0);
                            const clampedShare = Number.isFinite(rawShare)
                              ? Math.max(0, Math.min(rawShare, 1))
                              : 0;
                            return (
                              <div key={`new-bar-${i}`} className="space-y-1">
                                <div className="text-xs text-gray-600">Product {i + 1} (New)</div>
                                <div className="h-2 w-full rounded-full bg-gray-200">
                                  <div
                                    className="h-full rounded-full bg-blue-500 transition-all"
                                    style={{ width: `${clampedShare * 100}%` }}
                                  />
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    )}
                  </div>
                </div>

                <div className="mt-8 pt-8 border-t">
                  <h2 className="text-xl font-semibold mb-4">
                    {enableFileUpload ? "3) Run simulation" : "Run simulation"}
                  </h2>
                  <div className="flex items-center gap-4 flex-wrap">
                    <div className="flex items-center gap-2">
                      <label className="text-sm font-medium">Rule:</label>
                      <select
                        value={rule}
                        onChange={e => setRule(e.target.value as "logit" | "first_choice")}
                        className="border border-gray-300 rounded-lg p-2"
                      >
                        <option value="logit">Share-of-Preference (logit)</option>
                        <option value="first_choice">First Choice</option>
                      </select>
                    </div>
                    <button
                      onClick={runSimulation}
                      disabled={busy || !model}
                      className="px-4 py-2 rounded-xl bg-black text-white disabled:opacity-50 hover:bg-gray-800 transition"
                    >
                      {busy ? "Simulating..." : "Simulate"}
                    </button>
                    <button
                      onClick={downloadExcel}
                      disabled={!results}
                      className="px-4 py-2 rounded-xl border border-gray-300 disabled:opacity-50 hover:bg-gray-50 transition"
                    >
                      Download Excel
                    </button>
                  </div>

                  {results && (
                    <div className="mt-6">
                      <h3 className="font-semibold text-lg mb-3">Results</h3>
                      {Array.isArray(results.warnings) && results.warnings.length > 0 && (
                        <div className="rounded-lg border border-yellow-200 bg-yellow-50 px-4 py-3 text-sm text-yellow-800 mb-4">
                          <p className="font-semibold">Warnings</p>
                          <ul className="list-disc list-inside space-y-1 mt-1">
                            {results.warnings.map((warning: string, idx: number) => (
                              <li key={idx}>{warning}</li>
                            ))}
                          </ul>
                        </div>
                      )}
                      <div className="space-y-4 mb-6">
                        {scenarios.map((_, i) => {
                          const shares = Array.isArray(results.shares) ? results.shares : [];
                          const rawShare = Number(shares[i] ?? 0);
                          const clampedShare = Number.isFinite(rawShare)
                            ? Math.max(0, Math.min(rawShare, 1))
                            : 0;
                          return (
                            <div key={`share-bar-${i}`} className="space-y-1">
                              <div className="flex items-center justify-between text-sm font-medium text-gray-700">
                                <span>Product {i + 1}</span>
                                <span>{(clampedShare * 100).toFixed(1)}%</span>
                              </div>
                              <div className="h-2 w-full rounded-full bg-gray-200">
                                <div
                                  className="h-full rounded-full bg-blue-500 transition-all"
                                  style={{ width: `${clampedShare * 100}%` }}
                                />
                              </div>
                            </div>
                          );
                        })}
                      </div>
                      <div className="overflow-x-auto">
                        <table className="w-full text-sm border border-gray-300 rounded-lg">
                          <thead className="bg-gray-100">
                            <tr>
                              <th className="p-3 text-left font-semibold">#</th>
                              {attrs.map((a: any) => (
                                <th key={a.name} className="p-3 text-left font-semibold">{a.name}</th>
                              ))}
                              <th className="p-3 text-right font-semibold">Utility</th>
                              <th className="p-3 text-right font-semibold">Share</th>
                            </tr>
                          </thead>
                          <tbody>
                            {scenarios.map((s, i) => {
                              const utilities = Array.isArray(results.utilities) ? results.utilities : [];
                              const shares = Array.isArray(results.shares) ? results.shares : [];
                              const utilityValue = Number(utilities[i] ?? 0);
                              const shareValue = Number(shares[i] ?? 0);
                              const clampedShare = Number.isFinite(shareValue)
                                ? Math.max(0, Math.min(shareValue, 1))
                                : 0;

                              return (
                                <tr key={i} className="border-t border-gray-200 hover:bg-gray-50">
                                  <td className="p-3">{i + 1}</td>
                                  {attrs.map((a: any) => (
                                    <td key={a.name} className="p-3">{String(s[a.name])}</td>
                                  ))}
                                  <td className="p-3 text-right font-mono">
                                    {Number.isFinite(utilityValue) ? utilityValue.toFixed(4) : '0.0000'}
                                  </td>
                                  <td className="p-3 text-right font-mono font-semibold text-blue-600">
                                    {(clampedShare * 100).toFixed(1)}%
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )}
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
