import React, { useState, useEffect } from 'react';
import { PlusIcon, TrashIcon, Cog6ToothIcon } from '@heroicons/react/24/outline';
import * as api from '../../services/dataQualityApi';

interface QualityPlanTabProps {
  projectId: string;
  qualityPlan: any;
  loadingPlan: boolean;
  onSavePlan: (plan: any) => Promise<any>;
  onLoadPlan: () => Promise<void>;
}

export default function QualityPlanTab({
  projectId,
  qualityPlan,
  loadingPlan,
  onSavePlan,
  onLoadPlan
}: QualityPlanTabProps) {
  const [selectedRule, setSelectedRule] = useState<any>(null);
  const [showAddRule, setShowAddRule] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [questionnaireId, setQuestionnaireId] = useState<string>('');

  const handleGeneratePlan = async () => {
    setGenerating(true);
    try {
      await api.qualityPlanApi.generate(projectId, questionnaireId || undefined);
      await onLoadPlan();
    } catch (error) {
      console.error('Error generating plan:', error);
      alert('Failed to generate quality plan');
    } finally {
      setGenerating(false);
    }
  };

  const handleDeleteRule = async (ruleId: string) => {
    if (!window.confirm('Are you sure you want to delete this rule?')) return;
    
    try {
      await api.qualityPlanApi.deleteRule(projectId, ruleId);
      await onLoadPlan();
    } catch (error) {
      console.error('Error deleting rule:', error);
      alert('Failed to delete rule');
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

  if (loadingPlan) {
    return <div className="p-8 text-center text-gray-500">Loading quality plan...</div>;
  }

  if (!qualityPlan) {
    return (
      <div className="p-8">
        <div className="text-center">
          <p className="text-gray-500 mb-4">No quality plan found</p>
          <button
            onClick={handleGeneratePlan}
            disabled={generating}
            className="px-4 py-2 bg-orange-500 text-white rounded-lg hover:bg-orange-600 disabled:opacity-50"
          >
            {generating ? 'Generating...' : 'Generate from Questionnaire'}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="p-6">
      <div className="flex justify-between items-center mb-6">
        <h2 className="text-xl font-semibold">Quality Plan</h2>
        <div className="flex gap-2 items-center">
          <input
            type="text"
            value={questionnaireId}
            onChange={(e) => setQuestionnaireId(e.target.value)}
            placeholder="Questionnaire ID (optional)"
            className="px-3 py-2 border border-gray-300 rounded-lg text-sm"
          />
          <button
            onClick={() => setShowSettings(true)}
            className="px-4 py-2 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 flex items-center gap-2"
          >
            <Cog6ToothIcon className="w-4 h-4" />
            Settings
          </button>
          <button
            onClick={handleGeneratePlan}
            disabled={generating}
            className="px-4 py-2 bg-orange-500 text-white rounded-lg hover:bg-orange-600 disabled:opacity-50"
          >
            {generating ? 'Generating...' : 'Generate from QNR'}
          </button>
          <button
            onClick={() => setShowAddRule(true)}
            className="px-4 py-2 bg-orange-500 text-white rounded-lg hover:bg-orange-600 flex items-center gap-2"
          >
            <PlusIcon className="w-4 h-4" />
            Add Rule
          </button>
        </div>
      </div>

      {/* Rules Table */}
      <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
        <table className="min-w-full divide-y divide-gray-200">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Question</th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Type</th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Check Type</th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Enabled</th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Actions</th>
            </tr>
          </thead>
          <tbody className="bg-white divide-y divide-gray-200">
            {qualityPlan.rules?.length > 0 ? (
              qualityPlan.rules.map((rule: any) => (
                <tr key={rule.id} className="hover:bg-gray-50">
                  <td className="px-4 py-3 text-sm">
                    <div>
                      <div className="font-medium text-gray-900">{rule.questionNumber}</div>
                      <div className="text-gray-500 text-xs truncate max-w-md">{rule.questionText}</div>
                    </div>
                  </td>
                  <td className="px-4 py-3 text-sm text-gray-500">{rule.questionType}</td>
                  <td className="px-4 py-3 text-sm text-gray-500">{rule.checkTypeId}</td>
                  <td className="px-4 py-3 text-sm">
                    <button
                      onClick={() => handleToggleRule(rule)}
                      className={`px-3 py-1 rounded-full text-xs font-medium ${
                        rule.enabled
                          ? 'bg-green-100 text-green-800'
                          : 'bg-gray-100 text-gray-800'
                      }`}
                    >
                      {rule.enabled ? 'Enabled' : 'Disabled'}
                    </button>
                  </td>
                  <td className="px-4 py-3 text-sm">
                    <div className="flex gap-2">
                      <button
                        onClick={() => setSelectedRule(rule)}
                        className="text-orange-600 hover:text-orange-800"
                      >
                        Edit
                      </button>
                      <button
                        onClick={() => handleDeleteRule(rule.id)}
                        className="text-red-600 hover:text-red-800"
                      >
                        <TrashIcon className="w-4 h-4" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))
            ) : (
              <tr>
                <td colSpan={5} className="px-4 py-8 text-center text-gray-500">
                  No rules defined. Click "Generate from QNR" or "Add Rule" to get started.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* TODO: Add modals for Add Rule, Edit Rule, Settings */}
    </div>
  );
}

