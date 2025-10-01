import React, { useEffect, useMemo, useState } from 'react';
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
  const [bugReports, setBugReports] = useState<any[]>([]);
  const [featureRequests, setFeatureRequests] = useState<any[]>([]);

  const loadActive = async () => {
    try {
      const headers: any = { 'Authorization': `Bearer ${localStorage.getItem('jaice_token')}` };
      const [workingBugs, doneBugs, workingFeatures, doneFeatures] = await Promise.all([
        fetch(`${API_BASE_URL}/api/feedback?type=bug&status=working%20on%20it`, { headers }).then(r => r.json()),
        fetch(`${API_BASE_URL}/api/feedback?type=bug&status=done`, { headers }).then(r => r.json()),
        fetch(`${API_BASE_URL}/api/feedback?type=feature&status=working%20on%20it`, { headers }).then(r => r.json()),
        fetch(`${API_BASE_URL}/api/feedback?type=feature&status=done`, { headers }).then(r => r.json()),
      ]);
      const bugs = [...(workingBugs.bugReports || []), ...(doneBugs.bugReports || [])]
        .sort((a, b) => (b.statusUpdatedAt || b.updatedAt || b.createdAt).localeCompare(a.statusUpdatedAt || a.updatedAt || a.createdAt))
        .slice(0, 10);
      const feats = [...(workingFeatures.featureRequests || []), ...(doneFeatures.featureRequests || [])]
        .sort((a, b) => (b.statusUpdatedAt || b.updatedAt || b.createdAt).localeCompare(a.statusUpdatedAt || a.updatedAt || a.createdAt))
        .slice(0, 10);
      setBugReports(bugs);
      setFeatureRequests(feats);
    } catch (e) {
      setBugReports([]);
      setFeatureRequests([]);
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
        alert('Thanks! Your submission has been received.');
        loadActive();
      } else {
        const err = await resp.json().catch(() => ({}));
        alert(err.error || 'Failed to submit');
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
              <div className="text-xs text-gray-500 mb-1">{new Date(i.updatedAt || i.createdAt).toLocaleString()}</div>
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
      <div className="lg:col-span-3">
        <div className="bg-white rounded-lg border border-gray-200 p-6">
          <div className="mb-4 flex items-center gap-2">
            <button
              className={`px-3 py-1 text-sm rounded ${activeTab === 'bug' ? 'text-white' : 'border border-gray-300'}`}
              style={activeTab === 'bug' ? { backgroundColor: '#D14A2D' } : {}}
              onClick={() => { setActiveTab('bug'); setType('bug'); }}
            >
              Bug Report
            </button>
            <button
              className={`px-3 py-1 text-sm rounded ${activeTab === 'feature' ? 'text-white' : 'border border-gray-300'}`}
              style={activeTab === 'feature' ? { backgroundColor: '#D14A2D' } : {}}
              onClick={() => { setActiveTab('feature'); setType('feature'); }}
            >
              Feature Request
            </button>
          </div>
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
            <div className="text-right">
              <button type="submit" disabled={loading} className="px-4 py-2 text-white rounded disabled:opacity-50" style={{ backgroundColor: '#D14A2D' }}>
                {loading ? 'Submitting...' : 'Submit'}
              </button>
            </div>
          </form>
        </div>
      </div>
      <div className="lg:col-span-1">
        <div className="bg-white rounded-lg border border-gray-200 p-4">
          <h3 className="text-sm font-semibold text-gray-900 mb-3">Active Items</h3>
          <List title="Bug Reports (Reviewing/Done)" items={bugReports} />
          <List title="Feature Requests (Reviewing/Done)" items={featureRequests} />
        </div>
      </div>
    </div>
  );
}

