import OpenAI from 'openai';

/**
 * Fill a single respondent row for each sheet using the transcript and optional discussion guide.
 * - Only fills columns present in `sheetsColumns` for each sheet
 * - Leaves cells empty when the transcript lacks evidence
 * - Keeps each cell concise (phrase or 1 short sentence)
 * - Prefers quoting or near-quoting the transcript; no speculation
 * - Never fabricates dates/times/IDs; caller sets those
 *
 * @param {Object} params
 * @param {string} params.transcript - Raw transcript text (may include moderator + respondent)
 * @param {Object<string,string[]>} params.sheetsColumns - Map of sheetName -> array of column headers
 * @param {string | null} params.discussionGuide - Optional discussion guide text for alignment
 * @returns {Promise<Object<string, Object>>} Map of sheetName -> row object (column -> value)
 */
export async function fillRespondentRowsFromTranscript({ transcript, sheetsColumns, discussionGuide }) {
  const hasValidKey = process.env.OPENAI_API_KEY &&
                      process.env.OPENAI_API_KEY !== 'your_openai_api_key_here' &&
                      process.env.OPENAI_API_KEY.startsWith('sk-');

  if (!hasValidKey) {
    throw new Error('OpenAI API key not configured. Please set OPENAI_API_KEY in environment variables.');
  }

  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

  // Try to derive a respondent-only view to improve quote extraction
  function respondentOnly(text) {
    try {
      const lines = text.split(/\r?\n/);
      const out = [];
      for (const raw of lines) {
        const line = raw.trim();
        if (!line) continue;
        // Skip clear moderator markers
        if (/^(moderator|interviewer|facilitator|mod:|m:)/i.test(line)) continue;
        if (/^q\d+[:\s]/i.test(line)) continue;
        // Strip respondent labels
        let content = line.replace(/^(respondent|participant|interviewee|resp:|r:)/i, '').trim();
        // If looks like "Speaker: content", keep content only
        const m = content.match(/^[^:]{1,40}:\s*(.*)$/);
        if (m) content = m[1];
        if (content.length) out.push(content);
      }
      return out.join('\n');
    } catch {
      return text;
    }
  }
  const respondentText = respondentOnly(transcript);

  // Build an instruction that is very strict and schema-bound
  const sys = [
    'You are a senior qualitative market researcher completing a Content Analysis grid from a single respondent transcript.',
    'Task: For EVERY sheet and EVERY column, extract concise respondent-only notes (not moderator prompts).',
    'CRITICAL: You MUST return data for ALL sheets provided. Do not skip any sheets.',
    '',
    'IMPORTANT - TRANSCRIPT FORMAT AWARENESS:',
    'Some transcripts may have MISSING or INCONSISTENT speaker labels:',
    '- The entire transcript may be attributed to one speaker (e.g., all labeled as "Respondent:" or "Doctor:") even though it contains BOTH moderator questions AND respondent answers.',
    '- There may be minimal or NO speaker labels, making it one continuous block of text.',
    '- When you encounter this format, you MUST think critically to distinguish between:',
    '  * Moderator questions (introducing topics, asking follow-ups, probing)',
    '  * Respondent answers (providing opinions, experiences, reactions)',
    '',
    'HOW TO HANDLE UNLABELED OR MISLABELED TRANSCRIPTS:',
    '1. READ CAREFULLY: Identify the natural flow of question → answer → question → answer',
    '2. RECOGNIZE PATTERNS: Questions often start with "Can you tell me...", "How do you...", "What are your thoughts...", "Would you say..."',
    '3. RECOGNIZE ANSWERS: Look for first-person responses ("I think...", "In my experience...", "We use...", "I would say...")',
    '4. USE CONTEXT: Match respondent statements to the appropriate content analysis columns based on topic and meaning',
    '5. EXTRACT CAREFULLY: Only extract respondent perspectives, NOT the moderator\'s questions or prompts',
    '',
    'Rules:',
    '- Output STRICT JSON only. No prose outside JSON.',
    '- Keys = EXACT sheet names given. ALL sheets MUST be present in your response.',
    '- Output two top-level keys: "rows" and "quotes".',
    '  - rows: { "<Sheet>": { "<Col>": "value" } }',
    '  - quotes: { "<Sheet>": { "<Col>": ["verbatim respondent quote", ...] } }',
    '- If transcript lacks evidence for a column, set that column to an empty string - but still include the sheet and column.',
    '- Cell content: 3–6 sentences, written in clear report-style notes with specific details (who/what/how many/why). Use full sentences separated by periods. Aim for depth (up to ~900 characters) where evidence exists.',
    '- Prefer quoting or near-quoting the respondent; avoid generic boilerplate.',
    '- Do NOT invent respondent ID/date/time. Do NOT infer demographics unless clearly stated.',
    '- Ignore moderator text; focus on respondent statements. If speaker labels are missing/wrong, USE CONTEXT to distinguish.',
    '- Do NOT add extra columns or sheets; use only those provided.',
    '- For every NON-EMPTY cell value, include 2–4 verbatim respondent quotes that directly support it. Quotes must be exact substrings from the RESPONDENT-ONLY TEXT, excluding moderator content.',
    '- REMEMBER: Return ALL sheets in your JSON response, even if some columns are empty strings.'
  ].join('\n');

  const userParts = [];
  if (discussionGuide) {
    userParts.push('=== DISCUSSION GUIDE (for alignment only) ===');
    userParts.push(discussionGuide);
  }

  userParts.push('=== SHEETS + COLUMNS ===');
  const sheetsSpec = Object.entries(sheetsColumns).map(([sheet, cols]) => {
    return `- ${sheet}: [${cols.join(', ')}]`;
  }).join('\n');
  userParts.push(sheetsSpec);

  console.log(`📋 Sending ${Object.keys(sheetsColumns).length} sheets to AI:`, Object.keys(sheetsColumns));
  for (const [sheet, cols] of Object.entries(sheetsColumns)) {
    console.log(`   "${sheet}": ${cols.length} columns`);
  }

  userParts.push('=== TRANSCRIPT (FULL) ===');
  userParts.push(transcript);
  userParts.push('=== RESPONDENT-ONLY TEXT (for quotes; exact substrings only) ===');
  userParts.push(respondentText);

  userParts.push('=== OUTPUT FORMAT ===');
  userParts.push('{ "rows": { "<Sheet1>": {"<ColA>": "..."}}, "quotes": { "<Sheet1>": {"<ColA>": ["quote1", "quote2"]}} }');

  const messages = [
    { role: 'system', content: sys },
    { role: 'user', content: userParts.join('\n\n') },
  ];

  const resp = await client.chat.completions.create({
    model: 'gpt-4o-mini',
    temperature: 0.1,
    messages,
    response_format: { type: 'json_object' },
  });

  let json;
  try {
    json = JSON.parse(resp.choices[0].message.content);
  } catch (e) {
    console.error('Failed to parse AI response:', resp.choices[0].message.content);
    throw new Error('AI returned invalid JSON for transcript filling');
  }

  console.log('🤖 AI RAW RESPONSE - Sheets returned:', Object.keys(json.rows || {}));

  const rowsOut = {};
  const quotesOut = {};
  const aiRows = (json && typeof json === 'object' && json.rows && typeof json.rows === 'object') ? json.rows : {};
  const aiQuotes = (json && typeof json === 'object' && json.quotes && typeof json.quotes === 'object') ? json.quotes : {};

  console.log('🤖 AI returned data for sheets:', Object.keys(aiRows));
  for (const [sheetName, rowData] of Object.entries(aiRows)) {
    const filledCols = Object.entries(rowData).filter(([k, v]) => v && String(v).trim().length > 0);
    console.log(`  📊 Sheet "${sheetName}": ${filledCols.length}/${Object.keys(rowData).length} columns filled`);
    if (filledCols.length > 0) {
      console.log(`     Filled columns:`, filledCols.map(([k]) => k).join(', '));
    }
  }

  // Ensure each requested sheet exists in result; if missing, create empty row
  for (const [sheet, cols] of Object.entries(sheetsColumns)) {
    const fromAI = aiRows[sheet] || {};
    const row = {};
    for (const col of cols) {
      const v = Object.prototype.hasOwnProperty.call(fromAI, col) ? fromAI[col] : '';
      row[col] = (typeof v === 'string' ? v : (v == null ? '' : String(v))).trim().slice(0, 300);
    }
    rowsOut[sheet] = row;

    const fromQuotes = aiQuotes[sheet] || {};
    const colQuotes = {};
    for (const col of cols) {
      const q = fromQuotes[col];
      if (Array.isArray(q)) {
        colQuotes[col] = q.slice(0, 5).map(x => (typeof x === 'string' ? x : String(x)).trim()).filter(Boolean);
      } else {
        colQuotes[col] = [];
      }
    }
    quotesOut[sheet] = colQuotes;
  }

  return { rows: rowsOut, quotes: quotesOut };
}
