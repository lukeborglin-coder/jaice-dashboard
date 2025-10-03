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

  // Use the full transcript with speaker labels intact for better quote matching
  const respondentText = transcript;

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
    '- Output three top-level keys: "rows", "quotes", and "context".',
    '  - rows: { "<Sheet>": { "<Col>": "key finding summary" } }',
    '  - quotes: { "<Sheet>": { "<Col>": ["verbatim quote 1", "verbatim quote 2", ...] } }',
    '  - context: { "<Sheet>": { "<Col>": ["full context for quote 1", "full context for quote 2", ...] } }',
    '- If transcript lacks evidence for a column, set that column to an empty string - but still include the sheet and column.',
    '- CRITICAL - CELL CONTENT FORMAT: Each cell value should be a THIRD-PERSON SUMMARY/KEY FINDING, NOT a first-person quote:',
    '  * Write as objective research notes (e.g., "Learns about treatments through Facebook groups" NOT "I learn about treatments through Facebook")',
    '  * 2–4 sentences capturing the key insight with specific details (who/what/how/why)',
    '  * Use clear, analytical language suitable for a research report',
    '  * Aim for depth (up to ~900 characters) where evidence exists',
    '- Do NOT invent respondent ID/date/time. Do NOT infer demographics unless clearly stated.',
    '- Ignore moderator text; focus on respondent statements. If speaker labels are missing/wrong, USE CONTEXT to distinguish.',
    '- Do NOT add extra columns or sheets; use only those provided.',
    '- CRITICAL - EXACT QUOTE EXTRACTION: For every NON-EMPTY cell value, you MUST include 2–4 compelling VERBATIM quotes from the respondent that directly support the key finding.',
    '',
    '  ⚠️ QUOTES MUST BE COPY-PASTED EXACTLY FROM THE TRANSCRIPT ⚠️',
    '  * Find the exact sentence or phrase in the transcript where the respondent said this',
    '  * COPY the text word-for-word, character-for-character from the transcript',
    '  * Do NOT reword, paraphrase, summarize, or change ANY words',
    '  * Do NOT add your own phrasing like "I found X to be Y" - use their ACTUAL words',
    '  * Remove "Respondent:" label but keep everything else exactly as spoken',
    '  * Each quote should be 15-50 words - a complete thought from the respondent',
    '  * If you cannot find an exact quote in the transcript, leave the quotes array empty for that column',
    '',
    '  Example of WRONG quote extraction:',
    '  ❌ "The respondent found Evrysdi to be manageable and effective" (THIS IS PARAPHRASING)',
    '',
    '  Example of CORRECT quote extraction:',
    '  ✅ "It was easy to take at home and I didn\'t have to worry about going to the hospital every month" (EXACT WORDS FROM TRANSCRIPT)',
    '',
    '- CRITICAL - CONTEXT EXTRACTION: For EVERY non-empty cell value (key finding), you MUST provide comprehensive context that supports ALL aspects of the finding. In the "context" object:',
    '  * IMPORTANT: The number of context entries does NOT need to match the number of quotes. Provide as many context blocks as needed to fully support the key finding.',
    '  * CRITICAL REQUIREMENT: EVERY supporting quote MUST appear verbatim in at least one context block. Do not create context blocks that omit the quotes.',
    '  * Each context block should be a LONG, COMPLETE conversational excerpt (typically 5-15 speaker turns, sometimes more)',
    '  * MUST include ALL parts of the key finding - if the finding mentions multiple things (e.g., "learns via Facebook groups AND interested in oral medication"), provide context blocks for EACH part',
    '  * Each context block should include:',
    '    - The moderator\'s question that introduced the topic',
    '    - The respondent\'s initial answer',
    '    - ALL follow-up questions and answers on that same topic or sub-topic',
    '    - Keep going until the moderator clearly changes to a completely different subject',
    '  * DO NOT truncate context blocks after just 1-2 exchanges. Continue the excerpt as long as it\'s relevant.',
    '  * Include speaker labels (Moderator: and Respondent:) so the conversation flow is clear',
    '  * Format as a multi-line string with each speaker turn on a new line (use \\n)',
    '  * If relevant discussion happens in multiple non-contiguous parts of the transcript, create separate context blocks for each part',
    '  * Example: If key finding is "Learns about treatments through Facebook groups AND interested in oral medication Evrysdi", provide 2+ context blocks:',
    '    - One showing the FULL Facebook groups discussion (including all questions/answers on that topic)',
    '    - One showing the FULL oral medication/Evrysdi discussion (including all questions/answers on that topic)',
    '  * Example format (note the multiple exchanges):',
    '    "Moderator: How do you learn about new treatments?\\nRespondent: Through Facebook groups...\\nModerator: When did you join those groups?\\nRespondent: I don\'t remember exactly...\\nModerator: What do people share in those groups?\\nRespondent: Mostly treatment updates and personal experiences..."',
    '',
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

  userParts.push('=== OUTPUT FORMAT EXAMPLE ===');
  userParts.push(JSON.stringify({
    rows: {
      "Finding New Treatments": {
        "Finding New Treatments": "Learns about new SMA treatments primarily through Facebook support groups, which serve as the main source of information about treatment developments."
      }
    },
    quotes: {
      "Finding New Treatments": {
        "Finding New Treatments": [
          "That was the only thing that I was getting my information from was these Facebook support groups that I was a part of for spinal muscular atrophy.",
          "That was where I was getting my information."
        ]
      }
    },
    context: {
      "Finding New Treatments": {
        "Finding New Treatments": [
          "Moderator: So you weren't going to a doctor. How are you learning about these developments in the SMA treatment?\\nRespondent: Through Facebook. That was the only thing that I was getting my information from was these Facebook support groups that I was a part of for spinal muscular atrophy. That was where I was getting my information.\\nModerator: So interesting. When do you think you joined those groups?",
          "Moderator: So you weren't going to a doctor. How are you learning about these developments in the SMA treatment?\\nRespondent: Through Facebook. That was the only thing that I was getting my information from was these Facebook support groups that I was a part of for spinal muscular atrophy. That was where I was getting my information."
        ]
      }
    }
  }, null, 2));

  const messages = [
    { role: 'system', content: sys },
    { role: 'user', content: userParts.join('\n\n') },
  ];

  const resp = await client.chat.completions.create({
    model: 'gpt-4o',
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

  console.log('🤖 AI RAW RESPONSE - Top-level keys:', Object.keys(json));
  console.log('🤖 AI RAW RESPONSE - Sheets returned:', Object.keys(json.rows || {}));
  console.log('🤖 AI RAW RESPONSE - Has quotes?:', !!json.quotes, 'Keys:', json.quotes ? Object.keys(json.quotes) : []);
  console.log('🤖 AI RAW RESPONSE - Has context?:', !!json.context, 'Keys:', json.context ? Object.keys(json.context) : []);

  // Sample one context to see if it's populated
  if (json.context) {
    const firstSheet = Object.keys(json.context)[0];
    if (firstSheet && json.context[firstSheet]) {
      const firstCol = Object.keys(json.context[firstSheet])[0];
      if (firstCol) {
        console.log(`🔍 Sample context from "${firstSheet}"."${firstCol}":`, json.context[firstSheet][firstCol]);
      }
    }
  }

  const rowsOut = {};
  const quotesOut = {};
  const contextOut = {};
  const aiRows = (json && typeof json === 'object' && json.rows && typeof json.rows === 'object') ? json.rows : {};
  const aiQuotes = (json && typeof json === 'object' && json.quotes && typeof json.quotes === 'object') ? json.quotes : {};
  const aiContext = (json && typeof json === 'object' && json.context && typeof json.context === 'object') ? json.context : {};

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

    const fromContext = aiContext[sheet] || {};
    const colContext = {};
    for (const col of cols) {
      const c = fromContext[col];
      if (Array.isArray(c)) {
        colContext[col] = c.slice(0, 5).map(x => (typeof x === 'string' ? x : String(x)).trim()).filter(Boolean);
      } else {
        colContext[col] = [];
      }
    }
    contextOut[sheet] = colContext;
  }

  console.log('📤 Returning context for sheets:', Object.keys(contextOut));
  for (const [sheet, cols] of Object.entries(contextOut)) {
    const filledContextCols = Object.entries(cols).filter(([k, v]) => Array.isArray(v) && v.length > 0);
    console.log(`  📝 Sheet "${sheet}": ${filledContextCols.length} columns with context`);
  }

  return { rows: rowsOut, quotes: quotesOut, context: contextOut };
}
