import React, { useState, useMemo } from 'react';
import { PlusIcon, TrashIcon, Cog6ToothIcon, XMarkIcon, ChatBubbleBottomCenterTextIcon, Bars3Icon, ClockIcon } from '@heroicons/react/24/outline';
import * as api from '../../services/dataQualityApi';
import { useToast } from '../Toast';
import { API_BASE_URL } from '../../config';
import { calculateLOIMinutesFromQuestions } from '../../utils/calculateLOI';

const BRAND_ORANGE = '#D14A2D';

const CHECK_TYPES = [
  { id: 'speeding', label: 'Speeding', description: '', icon: ClockIcon, color: '#EF4444' },
  { id: 'open_end', label: 'Open-End Quality', description: 'Check quality of open-ended responses', icon: ChatBubbleBottomCenterTextIcon, color: '#8B5CF6' },
  { id: 'straightlining', label: 'Straight-Lining', description: 'Detect repetitive answer patterns in grids', icon: Bars3Icon, color: '#F59E0B' },
];

const QUESTION_TYPES = ['single', 'multi', 'open_end', 'numeric', 'grid', 'ranking'];

interface QualityPlanTabProps {
  projectId: string;
  qualityPlan: any;
  loadingPlan: boolean;
  onSavePlan: (plan: any) => Promise<any>;
  onLoadPlan: () => Promise<void>;
}

interface RuleFormData {
  questionNumber: string;
  questionText: string;
  questionType: string;
  checkTypeId: string;
  enabled: boolean;
  config: {
    threshold?: number;
    minLength?: number;
    maxLength?: number;
    validRange?: { min: number; max: number };
  };
}

const defaultRuleForm: RuleFormData = {
  questionNumber: '',
  questionText: '',
  questionType: 'single',
  checkTypeId: 'open_end',
  enabled: true,
  config: {},
};

export default function QualityPlanTab({
  projectId,
  qualityPlan,
  loadingPlan,
  onSavePlan,
  onLoadPlan
}: QualityPlanTabProps) {
  const toast = useToast();
  const [selectedRule, setSelectedRule] = useState<any>(null);
  const [showAddRule, setShowAddRule] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [questionnaireId, setQuestionnaireId] = useState<string>('');
  const [ruleForm, setRuleForm] = useState<RuleFormData>(defaultRuleForm);
  const [settings, setSettings] = useState({
    openEndAggressiveness: qualityPlan?.globalAggressiveness?.openEndAggressiveness ?? 50,
    straightliningAggressiveness: qualityPlan?.globalAggressiveness?.straightliningAggressiveness ?? 50,
    speedingAggressiveness: qualityPlan?.globalAggressiveness?.speedingAggressiveness ?? 50,
    logicAggressiveness: qualityPlan?.globalAggressiveness?.logicAggressiveness ?? 50,
    expectedLOI: qualityPlan?.expectedLOI ?? '',
  });

  // When opening Settings, prefill Expected LOI from the same heuristic used on the QNR Overview page.
  // We only do this if the plan doesn't already have an expected LOI and the input is empty.
  React.useEffect(() => {
    const shouldPrefill =
      showSettings &&
      (qualityPlan?.expectedLOI === null || qualityPlan?.expectedLOI === undefined || qualityPlan?.expectedLOI === '') &&
      (settings.expectedLOI === null || settings.expectedLOI === undefined || settings.expectedLOI === '');

    if (!shouldPrefill) return;

    let cancelled = false;

    (async () => {
      try {
        const token = localStorage.getItem('cognitive_dash_token');
        const response = await fetch(`${API_BASE_URL}/api/questionnaire/${projectId}`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!response.ok) return;

        const questionnaires = await response.json();
        if (!Array.isArray(questionnaires) || questionnaires.length === 0) return;

        // Pick the most recent questionnaire that has questions.
        const sorted = [...questionnaires].sort((a: any, b: any) => {
          const at = new Date(a?.createdAt || 0).getTime();
          const bt = new Date(b?.createdAt || 0).getTime();
          return bt - at;
        });

        const qnr = sorted.find((q: any) => Array.isArray(q?.questions) && q.questions.length > 0);
        if (!qnr) return;

        const minutes = calculateLOIMinutesFromQuestions(qnr.questions);
        if (cancelled) return;

        setSettings((prev) => ({
          ...prev,
          expectedLOI: minutes ? String(minutes) : '',
        }));
      } catch {
        // silent fallback
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [showSettings, projectId, qualityPlan?.expectedLOI, settings.expectedLOI]);

  const handleGeneratePlan = async () => {
    if (qualityPlan?.rules?.length > 0) {
      if (!window.confirm('This will regenerate the quality plan and may overwrite existing rules. Continue?')) {
        return;
      }
    }
    setGenerating(true);
    try {
      await api.qualityPlanApi.generate(projectId, questionnaireId || undefined);
      await onLoadPlan();
      toast.success('Quality plan generated successfully');
    } catch (error) {
      console.error('Error generating plan:', error);
      toast.error('Failed to generate quality plan');
    } finally {
      setGenerating(false);
    }
  };

  const handleDeleteRule = async (ruleId: string) => {
    if (!window.confirm('Are you sure you want to delete this rule?')) return;
    
    try {
      await api.qualityPlanApi.deleteRule(projectId, ruleId);
      await onLoadPlan();
      toast.success('Rule deleted successfully');
    } catch (error) {
      console.error('Error deleting rule:', error);
      toast.error('Failed to delete rule');
    }
  };

  const handleToggleRule = async (rule: any) => {
    try {
      await api.qualityPlanApi.updateRule(projectId, rule.id, {
        ...rule,
        enabled: !rule.enabled
      });
      await onLoadPlan();
    } catch (error) {
      console.error('Error updating rule:', error);
    }
  };

  const handleOpenEditRule = (rule: any) => {
    setRuleForm({
      questionNumber: rule.questionNumber || '',
      questionText: rule.questionText || '',
      questionType: rule.questionType || 'single',
      checkTypeId: rule.checkTypeId || 'open_end',
      enabled: rule.enabled ?? true,
      config: rule.config || {},
    });
    setSelectedRule(rule);
  };

  const handleCloseEditRule = () => {
    setSelectedRule(null);
    setRuleForm(defaultRuleForm);
  };

  const handleOpenAddRule = (checkTypeId?: string) => {
    setRuleForm({
      ...defaultRuleForm,
      checkTypeId: checkTypeId || 'open_end',
    });
    setShowAddRule(true);
  };

  // Group rules by check type
  const rulesByCheckType = useMemo(() => {
    const grouped: Record<string, any[]> = {};
    CHECK_TYPES.forEach(ct => {
      grouped[ct.id] = [];
    });
    qualityPlan?.rules?.forEach((rule: any) => {
      if (grouped[rule.checkTypeId]) {
        grouped[rule.checkTypeId].push(rule);
      } else {
        // If check type not found, ignore (UI only shows the enabled check types)
      }
    });
    return grouped;
  }, [qualityPlan?.rules]);

  const handleCloseAddRule = () => {
    setShowAddRule(false);
    setRuleForm(defaultRuleForm);
  };

  const handleSaveRule = async () => {
    if (!ruleForm.questionNumber.trim()) {
      toast.warning('Question number is required');
      return;
    }

    setSaving(true);
    try {
      if (selectedRule) {
        await api.qualityPlanApi.updateRule(projectId, selectedRule.id, {
          ...selectedRule,
          ...ruleForm,
        });
        handleCloseEditRule();
        toast.success('Rule updated successfully');
      } else {
        await api.qualityPlanApi.addRule(projectId, ruleForm);
        handleCloseAddRule();
        toast.success('Rule added successfully');
      }
      await onLoadPlan();
    } catch (error) {
      console.error('Error saving rule:', error);
      toast.error('Failed to save rule');
    } finally {
      setSaving(false);
    }
  };

  const handleSaveSettings = async () => {
    setSaving(true);
    try {
      const { expectedLOI, ...aggressivenessSettings } = settings;
      await api.qualityPlanApi.updateSettings(projectId, {
        globalAggressiveness: aggressivenessSettings,
        expectedLOI: expectedLOI || null,
      });
      await onLoadPlan();
      setShowSettings(false);
      toast.success('Settings saved successfully');
    } catch (error) {
      console.error('Error saving settings:', error);
      toast.error('Failed to save settings');
    } finally {
      setSaving(false);
    }
  };

  // Sync settings when qualityPlan changes
  React.useEffect(() => {
    if (qualityPlan) {
      setSettings({
        openEndAggressiveness: qualityPlan.globalAggressiveness?.openEndAggressiveness ?? 50,
        straightliningAggressiveness: qualityPlan.globalAggressiveness?.straightliningAggressiveness ?? 50,
        speedingAggressiveness: qualityPlan.globalAggressiveness?.speedingAggressiveness ?? 50,
        logicAggressiveness: qualityPlan.globalAggressiveness?.logicAggressiveness ?? 50,
        expectedLOI: qualityPlan.expectedLOI ?? '',
      });
    }
  }, [qualityPlan]);

  if (loadingPlan) {
    return (
      <div className="p-8">
        <div className="animate-pulse space-y-4">
          <div className="h-8 bg-gray-200 rounded w-1/4"></div>
          <div className="h-64 bg-gray-200 rounded"></div>
        </div>
      </div>
    );
  }

  if (!qualityPlan) {
    return (
      <div className="p-8">
        <div className="text-center py-12">
          <div className="mx-auto w-16 h-16 rounded-full flex items-center justify-center mb-4" style={{ backgroundColor: `${BRAND_ORANGE}15` }}>
            <Cog6ToothIcon className="w-8 h-8" style={{ color: BRAND_ORANGE }} />
          </div>
          <h3 className="text-lg font-medium text-gray-900 mb-2">No Quality Plan Found</h3>
          <p className="text-gray-500 mb-6 max-w-sm mx-auto">
            Generate a quality plan from your questionnaire to start validating survey data.
          </p>
          <div className="flex flex-col items-center gap-3">
            <input
              type="text"
              value={questionnaireId}
              onChange={(e) => setQuestionnaireId(e.target.value)}
              placeholder="Questionnaire ID (optional)"
              className="px-3 py-2 border border-gray-300 rounded-lg text-sm w-64"
            />
          <button
            onClick={handleGeneratePlan}
            disabled={generating}
              className="px-6 py-2 text-white rounded-lg disabled:opacity-50 transition-colors"
              style={{ backgroundColor: BRAND_ORANGE }}
              onMouseOver={(e) => e.currentTarget.style.backgroundColor = '#B8402A'}
              onMouseOut={(e) => e.currentTarget.style.backgroundColor = BRAND_ORANGE}
          >
              {generating ? 'Generating...' : 'Generate Quality Plan'}
          </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="p-6">
      <div className="flex justify-between items-center mb-6">
        <h2 className="text-xl font-semibold text-gray-900">Quality Plan</h2>
        <div className="flex gap-2 items-center">
          <input
            type="text"
            value={questionnaireId}
            onChange={(e) => setQuestionnaireId(e.target.value)}
            placeholder="Questionnaire ID"
            className="px-3 py-2 border border-gray-300 rounded-lg text-sm w-40"
          />
          <button
            onClick={() => setShowSettings(true)}
            className="px-4 py-2 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 flex items-center gap-2 transition-colors"
          >
            <Cog6ToothIcon className="w-4 h-4" />
            Settings
          </button>
          <button
            onClick={handleGeneratePlan}
            disabled={generating}
            className="px-4 py-2 text-white rounded-lg disabled:opacity-50 transition-colors"
            style={{ backgroundColor: BRAND_ORANGE }}
            onMouseOver={(e) => !generating && (e.currentTarget.style.backgroundColor = '#B8402A')}
            onMouseOut={(e) => e.currentTarget.style.backgroundColor = BRAND_ORANGE}
          >
            {generating ? 'Generating...' : 'Regenerate Plan'}
          </button>
        </div>
      </div>

      {/* Check Type Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {CHECK_TYPES.map((checkType) => {
          const Icon = checkType.icon;
          const rules = rulesByCheckType[checkType.id] || [];
          
          return (
            <div
              key={checkType.id}
              className="bg-white rounded-lg border border-gray-200 overflow-hidden flex flex-col min-h-[420px] h-[min(70vh,520px)]"
            >
              {/* Card Header */}
              <div 
                className="px-4 py-3 border-b border-gray-100 flex items-center justify-between flex-shrink-0"
                style={{ backgroundColor: `${checkType.color}08` }}
              >
                <div className="flex items-center gap-3">
                  <div 
                    className="w-8 h-8 rounded-lg flex items-center justify-center"
                    style={{ backgroundColor: `${checkType.color}15` }}
                  >
                    <Icon className="w-4 h-4" style={{ color: checkType.color }} />
                  </div>
                    <div>
                    <h3 className="font-medium text-gray-900 text-sm">{checkType.label}</h3>
                    {!!checkType.description && (
                      <p className="text-xs text-gray-500">{checkType.description}</p>
                    )}
                  </div>
                    </div>
                <div className="flex items-center gap-2">
                  <span 
                    className="text-xs font-medium px-2 py-1 rounded-full"
                    style={{ 
                      backgroundColor: rules.length > 0 ? `${checkType.color}15` : '#f3f4f6',
                      color: rules.length > 0 ? checkType.color : '#9ca3af'
                    }}
                  >
                    {rules.length} rule{rules.length !== 1 ? 's' : ''}
                  </span>
                    <button
                    onClick={() => handleOpenAddRule(checkType.id)}
                    className="p-1.5 rounded-lg hover:bg-gray-100 transition-colors"
                    title={`Add ${checkType.label} rule`}
                  >
                    <PlusIcon className="w-4 h-4 text-gray-500" />
                  </button>
                </div>
              </div>

              {/* Rules List */}
              <div className="divide-y divide-gray-100 flex-1 overflow-y-auto">
                {rules.length > 0 ? (
                  rules.map((rule: any) => (
                    <div 
                      key={rule.id}
                      className="px-4 py-2.5 flex items-center justify-between hover:bg-gray-50 transition-colors"
                    >
                      <div className="flex items-center gap-3 min-w-0 flex-1">
                        <button
                          onClick={() => handleToggleRule(rule)}
                          className={`w-2 h-2 rounded-full flex-shrink-0 transition-colors ${
                            rule.enabled ? 'bg-green-500' : 'bg-gray-300'
                          }`}
                          title={rule.enabled ? 'Enabled - Click to disable' : 'Disabled - Click to enable'}
                        />
                        <div className="min-w-0">
                          <span className="text-sm font-medium text-gray-900">{rule.questionNumber}</span>
                          {rule.questionText && (
                            <span className="text-xs text-gray-500 ml-2 truncate">
                              {rule.questionText.length > 40 
                                ? rule.questionText.substring(0, 40) + '...' 
                                : rule.questionText}
                            </span>
                          )}
                        </div>
                      </div>
                      <div className="flex items-center gap-1 flex-shrink-0 ml-2">
                      <button
                          onClick={() => handleOpenEditRule(rule)}
                          className="p-1 rounded hover:bg-gray-200 transition-colors text-xs font-medium"
                          style={{ color: BRAND_ORANGE }}
                      >
                        Edit
                      </button>
                      <button
                        onClick={() => handleDeleteRule(rule.id)}
                          className="p-1 rounded hover:bg-red-50 text-gray-400 hover:text-red-500 transition-colors"
                      >
                          <TrashIcon className="w-3.5 h-3.5" />
                      </button>
                      </div>
                    </div>
              ))
            ) : (
                  <div className="px-4 py-6 text-center">
                    <p className="text-sm text-gray-400">No rules configured</p>
                    <button
                      onClick={() => handleOpenAddRule(checkType.id)}
                      className="mt-2 text-xs font-medium transition-colors"
                      style={{ color: checkType.color }}
                    >
                      + Add first rule
                    </button>
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Add/Edit Rule Modal */}
      {(showAddRule || selectedRule) && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-lg mx-4 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200">
              <h3 className="text-lg font-semibold text-gray-900">
                {selectedRule ? 'Edit Rule' : 'Add New Rule'}
              </h3>
              <button
                onClick={selectedRule ? handleCloseEditRule : handleCloseAddRule}
                className="text-gray-400 hover:text-gray-600 transition-colors"
              >
                <XMarkIcon className="w-6 h-6" />
              </button>
            </div>
            
            <div className="p-6 space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Question Number <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  value={ruleForm.questionNumber}
                  onChange={(e) => setRuleForm({ ...ruleForm, questionNumber: e.target.value })}
                  placeholder="e.g., Q1, Q2a"
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:outline-none focus:border-gray-400"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Question Text
                </label>
                <textarea
                  value={ruleForm.questionText}
                  onChange={(e) => setRuleForm({ ...ruleForm, questionText: e.target.value })}
                  placeholder="Enter the question text for reference"
                  rows={2}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:outline-none focus:border-gray-400"
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Question Type
                  </label>
                  <select
                    value={ruleForm.questionType}
                    onChange={(e) => setRuleForm({ ...ruleForm, questionType: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:outline-none focus:border-gray-400"
                  >
                    {QUESTION_TYPES.map((type) => (
                      <option key={type} value={type}>
                        {type.replace('_', ' ').replace(/\b\w/g, l => l.toUpperCase())}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Check Type
                  </label>
                  <select
                    value={ruleForm.checkTypeId}
                    onChange={(e) => setRuleForm({ ...ruleForm, checkTypeId: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:outline-none focus:border-gray-400"
                  >
                    {CHECK_TYPES.map((type) => (
                      <option key={type.id} value={type.id}>{type.label}</option>
                    ))}
                  </select>
                </div>
              </div>

              {ruleForm.checkTypeId !== 'speeding' && (
                <div className="text-sm text-gray-500 bg-gray-50 rounded-lg p-3">
                  {CHECK_TYPES.find(t => t.id === ruleForm.checkTypeId)?.description}
                </div>
              )}

              {/* Config options based on check type */}
              {ruleForm.checkTypeId === 'open_end' && (
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Min Length
                    </label>
                    <input
                      type="number"
                      value={ruleForm.config.minLength || ''}
                      onChange={(e) => setRuleForm({
                        ...ruleForm,
                        config: { ...ruleForm.config, minLength: parseInt(e.target.value) || undefined }
                      })}
                      placeholder="e.g., 10"
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:outline-none focus:border-gray-400"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Max Length
                    </label>
                    <input
                      type="number"
                      value={ruleForm.config.maxLength || ''}
                      onChange={(e) => setRuleForm({
                        ...ruleForm,
                        config: { ...ruleForm.config, maxLength: parseInt(e.target.value) || undefined }
                      })}
                      placeholder="e.g., 500"
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:outline-none focus:border-gray-400"
                    />
                  </div>
                </div>
              )}

              {ruleForm.checkTypeId === 'straightlining' && (
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Threshold (%)
                  </label>
                  <input
                    type="number"
                    min="0"
                    max="100"
                    value={ruleForm.config.threshold || ''}
                    onChange={(e) => setRuleForm({
                      ...ruleForm,
                      config: { ...ruleForm.config, threshold: parseInt(e.target.value) || undefined }
                    })}
                    placeholder="e.g., 80"
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:outline-none focus:border-gray-400"
                  />
                </div>
              )}

              <div className="flex items-center gap-2">
                <input
                  type="checkbox"
                  id="rule-enabled"
                  checked={ruleForm.enabled}
                  onChange={(e) => setRuleForm({ ...ruleForm, enabled: e.target.checked })}
                  className="w-4 h-4 rounded focus:ring-2"
                  style={{ accentColor: BRAND_ORANGE }}
                />
                <label htmlFor="rule-enabled" className="text-sm text-gray-700">
                  Enable this rule
                </label>
              </div>
            </div>

            <div className="flex justify-end gap-3 px-6 py-4 border-t border-gray-200 bg-gray-50">
              <button
                onClick={selectedRule ? handleCloseEditRule : handleCloseAddRule}
                className="px-4 py-2 text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleSaveRule}
                disabled={saving}
                className="px-4 py-2 text-white rounded-lg disabled:opacity-50 transition-colors"
                style={{ backgroundColor: BRAND_ORANGE }}
                onMouseOver={(e) => !saving && (e.currentTarget.style.backgroundColor = '#B8402A')}
                onMouseOut={(e) => e.currentTarget.style.backgroundColor = BRAND_ORANGE}
              >
                {saving ? 'Saving...' : selectedRule ? 'Update Rule' : 'Add Rule'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Settings Modal */}
      {showSettings && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-md mx-4">
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200">
              <h3 className="text-lg font-semibold text-gray-900">Quality Check Settings</h3>
              <button
                onClick={() => setShowSettings(false)}
                className="text-gray-400 hover:text-gray-600 transition-colors"
              >
                <XMarkIcon className="w-6 h-6" />
              </button>
            </div>

            <div className="p-6 space-y-6">
              {/* Expected LOI Section */}
              <div className="pb-4 border-b border-gray-200">
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Expected LOI (Length of Interview)
                </label>
                <div className="flex items-center gap-2">
                  <input
                    type="number"
                    min="1"
                    max="120"
                    value={settings.expectedLOI}
                    onChange={(e) => setSettings({ ...settings, expectedLOI: e.target.value })}
                    placeholder="e.g., 15"
                    className="w-24 px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:outline-none focus:border-gray-400"
                  />
                  <span className="text-sm text-gray-500">minutes</span>
                </div>
                <p className="text-xs text-gray-400 mt-1">
                  Required for speeding checks. Compares against 'qtime' column in data uploads.
                </p>
              </div>

              <p className="text-sm text-gray-500">
                Adjust the aggressiveness of each check type. Higher values flag more respondents.
              </p>

              <div>
                <div className="flex justify-between mb-2">
                  <label className="text-sm font-medium text-gray-700">Speeding</label>
                  <span className="text-sm text-gray-500">{settings.speedingAggressiveness}%</span>
                </div>
                <input
                  type="range"
                  min="0"
                  max="100"
                  value={settings.speedingAggressiveness}
                  onChange={(e) => setSettings({ ...settings, speedingAggressiveness: parseInt(e.target.value) })}
                  className="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer"
                  style={{ accentColor: BRAND_ORANGE }}
                />
                <div className="flex justify-between text-xs text-gray-400 mt-1">
                  <span>Lenient</span>
                  <span>Strict</span>
                </div>
              </div>

              <div>
                <div className="flex justify-between mb-2">
                  <label className="text-sm font-medium text-gray-700">Open-End Quality</label>
                  <span className="text-sm text-gray-500">{settings.openEndAggressiveness}%</span>
                </div>
                <input
                  type="range"
                  min="0"
                  max="100"
                  value={settings.openEndAggressiveness}
                  onChange={(e) => setSettings({ ...settings, openEndAggressiveness: parseInt(e.target.value) })}
                  className="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer"
                  style={{ accentColor: BRAND_ORANGE }}
                />
                <div className="flex justify-between text-xs text-gray-400 mt-1">
                  <span>Lenient</span>
                  <span>Strict</span>
                </div>
              </div>

              <div>
                <div className="flex justify-between mb-2">
                  <label className="text-sm font-medium text-gray-700">Straight-Lining</label>
                  <span className="text-sm text-gray-500">{settings.straightliningAggressiveness}%</span>
                </div>
                <input
                  type="range"
                  min="0"
                  max="100"
                  value={settings.straightliningAggressiveness}
                  onChange={(e) => setSettings({ ...settings, straightliningAggressiveness: parseInt(e.target.value) })}
                  className="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer"
                  style={{ accentColor: BRAND_ORANGE }}
                />
                <div className="flex justify-between text-xs text-gray-400 mt-1">
                  <span>Lenient</span>
                  <span>Strict</span>
                </div>
              </div>

            </div>

            <div className="flex justify-end gap-3 px-6 py-4 border-t border-gray-200 bg-gray-50">
              <button
                onClick={() => setShowSettings(false)}
                className="px-4 py-2 text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleSaveSettings}
                disabled={saving}
                className="px-4 py-2 text-white rounded-lg disabled:opacity-50 transition-colors"
                style={{ backgroundColor: BRAND_ORANGE }}
                onMouseOver={(e) => !saving && (e.currentTarget.style.backgroundColor = '#B8402A')}
                onMouseOut={(e) => e.currentTarget.style.backgroundColor = BRAND_ORANGE}
              >
                {saving ? 'Saving...' : 'Save Settings'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
