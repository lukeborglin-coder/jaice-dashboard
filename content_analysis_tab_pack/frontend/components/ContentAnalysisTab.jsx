import React, { useState, useMemo } from 'react';
import { ArrowUpDown, Upload } from 'lucide-react';

export default function ContentAnalysisTab() {
  const [projectId, setProjectId] = useState('demo');
  const [data, setData] = useState(null);
  const [sort, setSort] = useState({ sheet: 'Category Ranking', col: 'Rank', dir: 'asc' });
  const [busy, setBusy] = useState(false);

  async function fetchProject() {
    const res = await fetch(`/api/ca/${projectId}`);
    const json = await res.json();
    setData(json);
  }

  async function uploadCA(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    setBusy(true);
    const fd = new FormData();
    fd.append('file', file);
    fd.append('projectId', projectId);
    const res = await fetch('/api/ca/upload', { method: 'POST', body: fd });
    const json = await res.json();
    setBusy(false);
    await fetchProject();
  }

  async function generateFromDG(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    setBusy(true);
    const fd = new FormData();
    fd.append('dg', file);
    const res = await fetch('/api/ca/generate', { method: 'POST', body: fd });
    const json = await res.json();
    setBusy(false);
    if (json?.downloadUrl) {
      window.open(json.downloadUrl, '_blank');
    }
  }

  const rankSorted = useMemo(() => {
    if (!data) return null;
    const sheet = data[sort.sheet] || [];
    const rows = [...sheet];
    rows.sort((a,b) => {
      const av = toNum(a[sort.col]); const bv = toNum(b[sort.col]);
      return sort.dir === 'asc' ? av - bv : bv - av;
    });
    return rows;
  }, [data, sort]);

  return (
    <div className="p-6 space-y-6">
      <header className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Content Analysis</h1>
        <div className="flex gap-3">
          <a className="px-3 py-2 rounded-xl shadow" href="/api/ca/template">Download Template</a>
          <label className="px-3 py-2 rounded-xl shadow cursor-pointer flex items-center gap-2">
            <Upload className="w-4 h-4" /><span>Upload CA (.xlsx)</span>
            <input type="file" accept=".xlsx" className="hidden" onChange={uploadCA}/>
          </label>
          <label className="px-3 py-2 rounded-xl shadow cursor-pointer flex items-center gap-2">
            <Upload className="w-4 h-4" /><span>DG → Generate CA</span>
            <input type="file" accept=".docx" className="hidden" onChange={generateFromDG}/>
          </label>
        </div>
      </header>

      <section className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card title="Project">
          <input className="border rounded px-3 py-2 w-full" value={projectId} onChange={e=>setProjectId(e.target.value)} placeholder="project id"/>
          <button className="mt-3 px-3 py-2 rounded-xl shadow" onClick={fetchProject} disabled={busy}>Load</button>
        </Card>
        <Card title="Rank View Controls">
          <div className="flex gap-2">
            <select className="border rounded px-2 py-2" value={sort.sheet} onChange={e=>setSort(s=>({...s, sheet:e.target.value}))}>
              {["Category Ranking","Category C","Category S","Background & SMA Management"].map(s=> <option key={s}>{s}</option>)}
            </select>
            <select className="border rounded px-2 py-2" value={sort.col} onChange={e=>setSort(s=>({...s, col:e.target.value}))}>
              {["Rank","Mentions","Net Positive","Top Box"].map(c=> <option key={c}>{c}</option>)}
            </select>
            <button className="px-3 py-2 rounded-xl shadow" onClick={()=>setSort(s=>({...s, dir: s.dir==='asc'?'desc':'asc'}))}>
              <ArrowUpDown className="w-4 h-4 inline mr-1"/>{sort.dir.toUpperCase()}
            </button>
          </div>
        </Card>
        <Card title="Status">
          <p>{busy ? "Working..." : "Idle"}</p>
          <p>Loaded sheets: {data ? Object.keys(data).length : 0}</p>
        </Card>
      </section>

      <section>
        <h2 className="text-xl font-semibold mb-2">{sort.sheet} (sorted by {sort.col}, {sort.dir})</h2>
        <div className="overflow-auto border rounded-2xl">
          <table className="min-w-full text-sm">
            <thead className="bg-gray-50">
              <tr>{rankSorted?.[0] && Object.keys(rankSorted[0]).map(h => <th key={h} className="px-3 py-2 text-left">{h}</th>)}</tr>
            </thead>
            <tbody>
              {rankSorted?.map((r,i)=>(
                <tr key={i} className="odd:bg-white even:bg-gray-50">
                  {Object.keys(r).map(k => <td key={k} className="px-3 py-2">{String(r[k] ?? "")}</td>)}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

function Card({title, children}){
  return (
    <div className="rounded-2xl shadow p-4 bg-white">
      <h3 className="font-semibold mb-2">{title}</h3>
      {children}
    </div>
  )
}

function toNum(x){
  const n = Number(x);
  return Number.isFinite(n) ? n : -Infinity;
}
