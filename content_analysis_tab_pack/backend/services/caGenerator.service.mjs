import fs from 'fs/promises';
import path from 'path';
import OpenAI from 'openai';
import { buildSchema, sheetOrder } from '../util/xlsxSchema.mjs';
import xlsx from 'xlsx';

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

export async function generateCAFromDG(dgPath, outDir) {
  // 1) Extract text from DG (docx) using xlsx's helper not available, so use zip/docx text reader.
  const { extractDocx } = await import('docx-text-to-json'); // lightweight
  const dg = await extractDocx(dgPath); // { paragraphs: [...] }
  const dgText = dg.paragraphs.join('\n');

  // 2) Call LLM with structured prompt to emit JSON by sheet
  const prompt = await fs.readFile(new URL('../prompts/ca_from_dg_prompt.txt', import.meta.url), 'utf-8');
  const sys = `You are a senior market-research analyst who converts Discussion Guides into structured Content Analysis tables for Excel. Output STRICT JSON exactly matching the provided schema. No prose.`;
  const resp = await client.chat.completions.create({
    model: "gpt-4o-mini",
    temperature: 0.2,
    messages: [
      { role: "system", content: sys },
      { role: "user", content: prompt + "\n\n=== DG TEXT START ===\n" + dgText + "\n=== DG TEXT END ===" }
    ],
    response_format: { type: "json_object" }
  });
  const json = JSON.parse(resp.choices[0].message.content);

  // 3) Build workbook from schema + JSON
  const wb = xlsx.utils.book_new();
  for (const sheet of sheetOrder) {
    const cols = buildSchema(sheet);
    const rows = json[sheet] || [];
    const dfRows = rows.map(r => {
      const out = {};
      for (const col of cols) out[col] = r[col] ?? "";
      return out;
    });
    const ws = xlsx.utils.json_to_sheet(dfRows, { header: cols });
    xlsx.utils.book_append_sheet(wb, ws, sheet);
  }

  const outPath = path.join(outDir, `CA_${Date.now()}.xlsx`);
  xlsx.writeFile(wb, outPath);
  return outPath;
}
