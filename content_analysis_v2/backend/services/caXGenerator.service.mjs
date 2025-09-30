import fs from 'fs/promises';
import path from 'path';
import xlsx from 'xlsx';
import OpenAI from 'openai';

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

async function loadSchema(url){
  const buf = await fs.readFile(new URL('../templates/ca_schema_from_user.json', url), 'utf-8');
  return JSON.parse(buf);
}

export async function previewFromDG_SchemaLocked(dgPath){
  const { extractDocx } = await import('docx-text-to-json');
  const dg = await extractDocx(dgPath);
  const dgText = dg.paragraphs.join('\n');
  const schema = await loadSchema(import.meta.url);

  const sys = 'You are a senior market research analyst. Output STRICT JSON by sheet, using ONLY the provided headers; no prose.';
  const user = [
    'Convert this Discussion Guide into a Content Analysis PREVIEW.',
    'Use these sheets and EXACT columns (omit any values you cannot confidently fill):',
    JSON.stringify(schema, null, 2),
    '',
    'Rules:',
    '- Return an object keyed by sheet name; each value is an array of row objects.',
    '- Use only the provided headers. Missing/unknown values = empty string.',
    '- Keep row counts manageable for preview (top items/themes; sample respondent rows).',
    '',
    'DG TEXT START >>>',
    dgText,
    '<<< DG TEXT END'
  ].join('\n');

  const resp = await client.chat.completions.create({
    model: 'gpt-4o-mini',
    temperature: 0.2,
    messages: [{ role: 'system', content: sys }, { role: 'user', content: user }],
    response_format: { type: 'json_object' }
  });

  const json = JSON.parse(resp.choices[0].message.content);
  // Ensure all sheets exist, even if empty
  for (const s of Object.keys(schema)) if (!json[s]) json[s] = [];
  return json;
}

export async function exportExcelFromPreview(previewJson, outDir){
  const schema = await loadSchema(import.meta.url);
  const wb = xlsx.utils.book_new();
  for (const [sheet, headers] of Object.entries(schema)){
    const rows = Array.isArray(previewJson[sheet]) ? previewJson[sheet] : [];
    const safeRows = rows.map(r => {
      const out = {};
      for (const h of headers) out[h] = r[h] ?? '';
      return out;
    });
    const ws = xlsx.utils.json_to_sheet(safeRows, { header: headers });
    xlsx.utils.book_append_sheet(wb, ws, sheet);
  }
  const filename = `CA_preview_export_${Date.now()}.xlsx`;
  const filePath = path.join(outDir, filename);
  xlsx.writeFile(wb, filePath);
  return { filePath, filename };
}
