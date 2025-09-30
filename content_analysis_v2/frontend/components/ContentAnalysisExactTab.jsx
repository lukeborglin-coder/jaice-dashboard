import React, { useState, useMemo } from 'react';
import { Upload, FileDown } from 'lucide-react';

export default function ContentAnalysisExactTab(){
  const [projectId, setProjectId] = useState('demo');
  const [data, setData] = useState(null);            // preview JSON stored here
  const [busy, setBusy] = useState(false);
  const [activeSheet, setActiveSheet] = useState('Category Ranking');

  async function fetchProject(){
    const res = await fetch(`http://localhost:3002/api/caX/${projectId}`);
    const json = await res.json();
    setData(json);
  }

  // NEW: DG → JSON preview (no auto download)
  async function previewFromDG(e){
    const file = e.target.files?.[0]; if(!file) return;
    setBusy(true);
    const fd = new FormData();
    fd.append('dg', file);
    const res = await fetch('http://localhost:3002/api/caX/preview', { method:'POST', body: fd });
    const json = await res.json();
    setBusy(false);
    setData(json);
    // Default to first sheet with rows if available
    const firstPopulated = Object.keys(json).find(s => Array.isArray(json[s]) && json[s].length);
    if (firstPopulated) setActiveSheet(firstPopulated);
  }

  // NEW: Export current preview JSON to Excel (server-side)
  async function exportExcel(){
    if(!data) return;
    setBusy(true);
    const res = await fetch('http://localhost:3002/api/caX/export', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ data })
    });
    // trigger download
    const blob = await res.blob();
    setBusy(false);
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'Content_Analysis.xlsx';
    document.body.appendChild(a);
    a.click();
    a.remove();
    window.URL.revokeObjectURL(url);
  }

  async function uploadCA(e){
    const file = e.target.files?.[0]; if(!file) return;
    setBusy(true);
    const fd = new FormData();
    fd.append('file', file);
    fd.append('projectId', projectId);
    await fetch('http://localhost:3002/api/caX/upload', { method:'POST', body: fd });
    setBusy(false);
    await fetchProject();
  }

  const sheetNames = useMemo(()=> data ? Object.keys(data) : [], [data]);
  const rows = useMemo(()=> data && data[activeSheet] ? data[activeSheet] : [], [data, activeSheet]);
  const headers = rows?.[0] ? Object.keys(rows[0]) : (data && data[activeSheet] ? inferHeadersFromSchema(data, activeSheet) : []);

  return (
    <div className="p-6 space-y-6">
      {/* Controls */}
      <header className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Content Analysis (Preview-first)</h1>
        <div className="flex gap-3">
          <label className="px-3 py-2 rounded-xl shadow cursor-pointer flex items-center gap-2">
            <Upload className="w-4 h-4"/><span>Upload CA (.xlsx)</span>
            <input type="file" accept=".xlsx" className="hidden" onChange={uploadCA}/>
          </label>
          <label className="px-3 py-2 rounded-xl shadow cursor-pointer flex items-center gap-2">
            <Upload className="w-4 h-4"/><span>DG → Preview (no download)</span>
            <input type="file" accept=".docx" className="hidden" onChange={previewFromDG}/>
          </label>
          <button className="px-3 py-2 rounded-xl shadow flex items-center gap-2" disabled={!data || busy} onClick={exportExcel}>
            <FileDown className="w-4 h-4"/><span>Export Excel</span>
          </button>
        </div>
      </header>

      {/* Project & Tabs */}
      <section className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card title="Project">
          <input className="border rounded px-3 py-2 w-full" value={projectId} onChange={e=>setProjectId(e.target.value)} placeholder="project id"/>
          <button className="mt-3 px-3 py-2 rounded-xl shadow" onClick={fetchProject} disabled={busy}>Load</button>
        </Card>
        <Card title="Sections">
          <div className="flex flex-wrap gap-2">
            {sheetNames.map(n=> (
              <button
                key={n}
                className={"px-3 py-1 rounded-full shadow " + (activeSheet===n ? "bg-gray-200" : "bg-white")}
                onClick={()=>setActiveSheet(n)}
              >
                {n}
              </button>
            ))}
          </div>
        </Card>
        <Card title="Status">
          <p>{busy ? "Working..." : "Idle"}</p>
          <p>Active: {activeSheet}</p>
          <p>Rows: {rows.length}</p>
        </Card>
      </section>

      {/* Preview Table */}
      <section>
        <h2 className="text-xl font-semibold mb-2">{activeSheet || "Preview"}</h2>
        <div className="overflow-auto border rounded-2xl min-h-[200px] bg-white">
          <table className="min-w-full text-sm">
            <thead className="bg-gray-50">
              <tr>{headers.map(h=> <th key={h} className="px-3 py-2 text-left">{h}</th>)}</tr>
            </thead>
            <tbody>
              {rows.map((r,i)=>(
                <tr key={i} className="odd:bg-white even:bg-gray-50">
                  {headers.map(k=> <td key={k} className="px-3 py-2">{String(r[k] ?? "")}</td>)}
                </tr>
              ))}
              {!rows.length && (
                <tr><td className="px-3 py-4 text-gray-500">No rows yet. Upload a DG to see a preview.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  )
}

function Card({title, children}){
  return <div className="rounded-2xl shadow p-4 bg-white"><h3 className="font-semibold mb-2">{title}</h3>{children}</div>;
}

function inferHeadersFromSchema(data, sheet){
  // If empty sheet, pick headers from any sibling sheet with rows (helps render header row)
  const any = Object.values(data).find(v => Array.isArray(v) && v[0]);
  return any ? Object.keys(any[0]) : [];
}
