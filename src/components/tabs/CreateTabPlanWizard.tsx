import React, { useMemo, useState } from 'react';
import { XMarkIcon } from '@heroicons/react/24/outline';
import { TabPlan, TabPlanSourceType } from '../../hooks/useTabPlans';

const BRAND_ORANGE = '#D14A2D';

type WizardStep = 'choose' | 'qnr' | 'raw';

export function CreateTabPlanWizard({
  isOpen,
  projectId,
  questionnaires,
  onClose,
  onCreatePlan,
  onUploadRawFile,
  onCreated,
}: {
  isOpen: boolean;
  projectId: string;
  questionnaires: any[];
  onClose: () => void;
  onCreatePlan: (payload: { projectId: string; name: string; sourceType: TabPlanSourceType; qnrId?: string }) => Promise<TabPlan>;
  onUploadRawFile: (planId: string, file: File) => Promise<any>;
  onCreated: (plan: TabPlan) => void;
}) {
  const [step, setStep] = useState<WizardStep>('choose');
  const [preferredSource, setPreferredSource] = useState<WizardStep>('raw');
  const [planName, setPlanName] = useState('');
  const [selectedQnrId, setSelectedQnrId] = useState('');
  const [rawFile, setRawFile] = useState<File | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const qnrOptions = useMemo(() => {
    return Array.isArray(questionnaires) ? questionnaires : [];
  }, [questionnaires]);
  const hasQnrs = qnrOptions.length > 0;

  if (!isOpen) return null;

  const reset = () => {
    setStep('choose');
    setPreferredSource('raw');
    setPlanName('');
    setSelectedQnrId('');
    setRawFile(null);
    setSubmitting(false);
    setError(null);
  };

  const handleClose = () => {
    reset();
    onClose();
  };

  const canSubmit = (() => {
    const nameOk = planName.trim().length > 0;
    if (step === 'choose') return true;
    if (step === 'qnr') return nameOk && !!selectedQnrId;
    if (step === 'raw') return nameOk && !!rawFile;
    return false;
  })();

  const handleSubmit = async () => {
    setError(null);
    if (!canSubmit) return;
    if (step === 'choose') {
      setStep(preferredSource);
      return;
    }
    setSubmitting(true);
    try {
      if (step === 'qnr') {
        const plan = await onCreatePlan({
          projectId,
          name: planName.trim(),
          sourceType: 'qnr',
          qnrId: selectedQnrId,
        });
        onCreated(plan);
        handleClose();
        return;
      }

      if (step === 'raw') {
        const plan = await onCreatePlan({
          projectId,
          name: planName.trim(),
          sourceType: 'raw',
        });
        if (!rawFile) throw new Error('No file selected');
        await onUploadRawFile(plan.id, rawFile);
        onCreated(plan);
        handleClose();
        return;
      }
    } catch (e: any) {
      setError(e?.message || 'Failed to create tab plan');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="w-full max-w-2xl rounded-lg bg-white shadow-lg border border-gray-200 overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-200">
          <div>
            <div className="text-sm font-semibold text-gray-900">Create Tab Plan</div>
            <div className="text-xs text-gray-500">Choose how you want to generate the tab plan.</div>
          </div>
          <button onClick={handleClose} className="p-1 rounded hover:bg-gray-100" title="Close">
            <XMarkIcon className="h-5 w-5 text-gray-600" />
          </button>
        </div>

        <div className="px-5 py-4 space-y-4">
          {error && (
            <div className="rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
              {error}
            </div>
          )}

          {step === 'choose' && (
            <div className="space-y-3">
              <button
                onClick={() => {
                  setPreferredSource('raw');
                }}
                className={`w-full text-left border rounded-lg p-4 transition ${preferredSource === 'raw' ? 'border-orange-400 bg-orange-50' : 'hover:bg-gray-50'}`}
              >
                <div className="text-sm font-semibold text-gray-900">Build based on raw data upload</div>
                <div className="text-xs text-gray-500 mt-1">
                  Upload a raw excel data file that includes a data map tab (Forsta download).
                </div>
              </button>
              <button
                onClick={() => {
                  if (!hasQnrs) return;
                  setPreferredSource('qnr');
                }}
                disabled={!hasQnrs}
                className={`w-full text-left border rounded-lg p-4 transition ${
                  preferredSource === 'qnr' ? 'border-orange-400 bg-orange-50' : 'hover:bg-gray-50'
                } ${!hasQnrs ? 'opacity-50 cursor-not-allowed' : ''}`}
              >
                <div className="text-sm font-semibold text-gray-900">Build based on QNR</div>
                <div className="text-xs text-gray-500 mt-1">
                  {hasQnrs
                    ? 'Tie this plan to a specific QNR in this project.'
                    : 'No QNR uploaded for this project yet.'}
                </div>
              </button>
            </div>
          )}

          {step !== 'choose' && (
            <>
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">Tab Plan Name</label>
                <input
                  value={planName}
                  onChange={(e) => setPlanName(e.target.value)}
                  className="w-full px-3 py-2 text-sm border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-orange-500"
                  placeholder="e.g., W1 Standard Tabs"
                />
              </div>

              {step === 'qnr' && (
                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1">Select QNR</label>
                  <select
                    value={selectedQnrId}
                    onChange={(e) => setSelectedQnrId(e.target.value)}
                    className="w-full px-3 py-2 text-sm border border-gray-300 rounded-md bg-white focus:outline-none focus:ring-2 focus:ring-orange-500"
                  >
                    <option value="">Choose a QNR…</option>
                    {qnrOptions.map((q) => (
                      <option key={q.id} value={q.id}>
                        {q.name}
                      </option>
                    ))}
                  </select>
                  {qnrOptions.length === 0 && (
                    <div className="mt-2 text-xs text-gray-500">
                      No QNRs found for this project. Choose “raw data upload” instead.
                    </div>
                  )}
                </div>
              )}

              {step === 'raw' && (
                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1">Upload data file (.xlsx/.xls)</label>
                  <input
                    type="file"
                    accept=".xlsx,.xls"
                    onChange={(e) => setRawFile(e.target.files?.[0] || null)}
                    className="w-full text-sm"
                  />
                  <div className="mt-2 text-xs text-gray-500">
                    File must include a Data Map sheet (second sheet or named “Datamap”/“Data Map”).
                  </div>
                </div>
              )}
            </>
          )}
        </div>

        <div className="px-5 py-4 border-t border-gray-200 flex items-center justify-between">
          <div className="flex items-center gap-2">
            {step !== 'choose' && (
              <button
                onClick={() => setStep('choose')}
                className="px-3 py-2 text-sm text-gray-700 border border-gray-300 rounded-md hover:bg-gray-50"
                disabled={submitting}
              >
                Back
              </button>
            )}
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={handleClose}
              className="px-3 py-2 text-sm text-gray-700 border border-gray-300 rounded-md hover:bg-gray-50"
              disabled={submitting}
            >
              Cancel
            </button>
            <button
              onClick={handleSubmit}
              disabled={!canSubmit || submitting}
              className="px-4 py-2 text-sm text-white rounded-md disabled:opacity-50 disabled:cursor-not-allowed hover:opacity-90"
              style={{ backgroundColor: BRAND_ORANGE }}
            >
              {step === 'choose' ? 'Next' : submitting ? 'Creating…' : 'Create Tab Plan'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}





