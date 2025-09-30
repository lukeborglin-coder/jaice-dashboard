import * as XLSX from 'xlsx';

/**
 * Client-side helper (optional) if you want to parse CA locally.
 */
export async function parseCAFile(file){
  const buf = await file.arrayBuffer();
  const wb = XLSX.read(buf);
  const out = {};
  wb.SheetNames.forEach(name=>{
    const ws = wb.Sheets[name];
    out[name] = XLSX.utils.sheet_to_json(ws, { defval: "" });
  });
  return out;
}
