import React, { useEffect, useMemo, useState } from 'react';
import { ExclamationTriangleIcon, LightBulbIcon } from '@heroicons/react/24/outline';
import { API_BASE_URL } from '../config';
import { useAuth } from '../contexts/AuthContext';

type FeedbackType = 'bug' | 'feature';
type Status = 'pending review' | 'working on it' | 'done' | 'archived';

export default function Feedback({ defaultType = 'bug' as FeedbackType }) {
  const { user } = useAuth();
  const [activeTab, setActiveTab] = useState<FeedbackType>(defaultType);
  const [subject, setSubject] = useState('');
  const [type, setType] = useState<FeedbackType>(defaultType);
  const [body, setBody] = useState('');
  const [priority, setPriority] = useState<'low' | 'medium' | 'high'>('medium');
  const [loading, setLoading] = useState(false);
  const [submitInfo, setSubmitInfo] = useState<{ ok: boolean; msg: string } | null>(null);
  const [bugWorking, setBugWorking] = useState<any[]>([]);
  const [bugDone, setBugDone] = useState<any[]>([]);
  const [featWorking, setFeatWorking] = useState<any[]>([]);
  const [featDone, setFeatDone] = useState<any[]>([]);

  const loadActive = async () => {
    try {
      const headers: any = { 'Authorization': `Bearer ${localStorage.getItem('jaice_token')}` };
      const [workingBugs, doneBugs, workingFeatures, doneFeatures] = await Promise.all([
        fetch(`${API_BASE_URL}/api/feedback?type=bug&status=working%20on%20it`, { headers }).then(r => r.json()),
        fetch(`${API_BASE_URL}/api/feedback?type=bug&status=done`, { headers }).then(r => r.json()),
        fetch(`${API_BASE_URL}/api/feedback?type=feature&status=working%20on%20it`, { headers }).then(r => r.json()),
        fetch(`${API_BASE_URL}/api/feedback?type=feature&status=done`, { headers }).then(r => r.json()),
      ]);
      const toSorted = (arr: any[]) => [...(arr || [])].sort((a, b) => (b.statusUpdatedAt || b.updatedAt || b.createdAt).localeCompare(a.statusUpdatedAt || a.updatedAt || a.createdAt));
      setBugWorking(toSorted(workingBugs.bugReports).slice(0, 5));
      setBugDone(toSorted(doneBugs.bugReports).slice(0, 5));
      setFeatWorking(toSorted(workingFeatures.featureRequests).slice(0, 5));
      setFeatDone(toSorted(doneFeatures.featureRequests).slice(0, 5));
    } catch (e) {
      setBugWorking([]); setBugDone([]);
      setFeatWorking([]); setFeatDone([]);
    }
  };

  useEffect(() => {
    loadActive();
  }, []);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!subject || !body) return alert('Please fill out subject and details');
    setLoading(true);
    try {
      const resp = await fetch(`${API_BASE_URL}/api/feedback`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${localStorage.getItem('jaice_token')}`
        },
        body: JSON.stringify({ type, subject, body, priority })
      });
      if (resp.ok) {
        setSubject(''); setBody(''); setPriority('medium'); setType(activeTab);
        setSubmitInfo({ ok: true, msg: 'Submitted' });
        setTimeout(() => setSubmitInfo(null), 3000);
        loadActive();
      } else {
        const err = await resp.json().catch(() => ({}));
        setSubmitInfo({ ok: false, msg: err.error || 'Failed to submit' });
        setTimeout(() => setSubmitInfo(null), 4000);
      }
    } finally {
      setLoading(false);
    }
  };

  const List = ({ title, items }: { title: string; items: any[] }) => (
    <div className="mb-6">
      <h4 className="text-sm font-semibold text-gray-800 mb-2">{title}</h4>
      {items.length === 0 ? (
        <div className="text-xs text-gray-500 italic">No items</div>
      ) : (
        <ul className="space-y-2">
          {items.map((i) => (
            <li key={i.id} className="border rounded p-2">
              <div className="text-sm text-gray-800">{i.subject}</div>
              <div className="text-xs text-gray-600">Priority: {i.priority} | Status: {i.status}</div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );

  return (
    <div className="w-full grid grid-cols-1 lg:grid-cols-4 gap-6">
      <div className="lg:col-span-4">
        <h2 className="text-2xl font-bold mb-2" style={{ color: '#5D5F62' }}>Feedback</h2>
        <div className="border-b border-gray-200 mb-4">
          <nav className="-mb-px flex space-x-8">
            <button
              onClick={() => { setActiveTab('bug'); setType('bug'); }}
              className={`py-2 px-1 border-b-2 font-medium text-sm ${activeTab === 'bug' ? 'text-gray-900' : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'}`}
              style={activeTab === 'bug' ? { borderBottomColor: '#D14A2D', color: '#D14A2D' } : {}}
            >
              <span className="inline-flex items-center gap-2"><ExclamationTriangleIcon className="w-4 h-4" /> Bug Report</span>
            </button>
            <button
              onClick={() => { setActiveTab('feature'); setType('feature'); }}
              className={`py-2 px-1 border-b-2 font-medium text-sm ${activeTab === 'feature' ? 'text-gray-900' : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'}`}
              style={activeTab === 'feature' ? { borderBottomColor: '#D14A2D', color: '#D14A2D' } : {}}
            >
              <span className="inline-flex items-center gap-2"><LightBulbIcon className="w-4 h-4" /> Feature Request</span>
            </button>
          </nav>
        </div>
      </div>
      {/* Main form takes half (2/4) */}
      <div className="lg:col-span-2">
        <div className="bg-white rounded-lg border border-gray-200 p-6 h-full flex flex-col">
          <form className="space-y-4" onSubmit={submit}>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Subject</label>
              <input className="w-full border rounded px-3 py-2" value={subject} onChange={e => setSubject(e.target.value)} required />
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Type</label>
                <select className="w-full border rounded px-3 py-2" value={type} onChange={e => setType(e.target.value as FeedbackType)}>
                  <option value="bug">Bug Report</option>
                  <option value="feature">Feature Request</option>
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Priority</label>
                <select className="w-full border rounded px-3 py-2" value={priority} onChange={e => setPriority(e.target.value as any)}>
                  <option value="low">Low</option>
                  <option value="medium">Medium</option>
                  <option value="high">High</option>
                </select>
              </div>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Details</label>
              <textarea className="w-full border rounded px-3 py-2 min-h-[120px]" value={body} onChange={e => setBody(e.target.value)} required />
            </div>
            <div className="flex items-center justify-end gap-3">
              {submitInfo && (
                <span className={`text-xs ${submitInfo.ok ? 'text-green-600' : 'text-red-600'}`}>{submitInfo.msg}</span>
              )}
              <button type="submit" disabled={loading} className="px-4 py-2 text-white rounded disabled:opacity-50" style={{ backgroundColor: '#D14A2D' }}>
                {loading ? 'Submitting...' : 'Submit'}
              </button>
            </div>
          </form>
        </div>
      </div>
      {/* Right two boxes each 1/4 width */}
      {activeTab === 'feature' ? (
        <>
          <div className="lg:col-span-1">
            <div className="relative bg-white rounded-lg border border-gray-200 p-4 h-full">
              <div className="absolute top-2 right-2 w-2 h-2 rounded-full" style={{ backgroundColor: '#FACC15' }}></div>
              <List title="Feature Requests: In Progress" items={featWorking} />
            </div>
          </div>
          <div className="lg:col-span-1">
            <div className="relative bg-white rounded-lg border border-gray-200 p-4 h-full">
              <div className="absolute top-2 right-2 w-2 h-2 rounded-full" style={{ backgroundColor: '#10B981' }}></div>
              <List title="Feature Requests: Completed" items={featDone} />
            </div>
          </div>
        </>
      ) : (
        <>
          <div className="lg:col-span-1">
            <div className="relative bg-white rounded-lg border border-gray-200 p-4 h-full">
              <div className="absolute top-2 right-2 w-2 h-2 rounded-full" style={{ backgroundColor: '#FACC15' }}></div>
              <List title="Bug Reports: In Progress" items={bugWorking} />
            </div>
          </div>
          <div className="lg:col-span-1">
            <div className="relative bg-white rounded-lg border border-gray-200 p-4 h-full">
              <div className="absolute top-2 right-2 w-2 h-2 rounded-full" style={{ backgroundColor: '#10B981' }}></div>
              <List title="Bug Reports: Completed" items={bugDone} />
            </div>
          </div>
        </>
      )}
    </div>
  );
}
