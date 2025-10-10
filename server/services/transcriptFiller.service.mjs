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
export async function fillRespondentRowsFromTranscript({ transcript, sheetsColumns, discussionGuide, messageTestingDetails = null }) {
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
    'Task: For EVERY sheet and EVERY column, write a thorough Key Finding summary as research notes (objective; not copy/paste; comprehensive), focusing on respondent-only evidence (not moderator prompts).',
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
    '- Output two top-level keys: "rows" and "context".',
    '  - rows: { "<Sheet>": { "<Col>": "key finding summary" } }',
    '  - context: { "<Sheet>": { "<Col>": ["comprehensive context 1", "comprehensive context 2", ...] } }',
    '- If transcript lacks evidence for a column, set that column to an empty string - but still include the sheet and column.',
    '- Context arrays should contain ALL relevant conversation snippets for each topic.',
    '- If you cannot find VERBATIM quotes in the transcript for a topic, leave the context array EMPTY - never write summaries.',
    '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━',
    'TWO DISTINCT OUTPUTS ARE REQUIRED FOR EACH COLUMN:',
    '------------------------------------------------------------',
    '',
    '--- OUTPUT REQUIREMENTS ---',
    'KEY FINDING (cell value):',
    '  ⚠️ CRITICAL: Each finding MUST be 3-5 sentences. Findings with only 1-2 sentences are UNACCEPTABLE and will be rejected.',
    '  - Target length: 3-5 complete sentences with specific details and evidence.',
    '  - Include SPECIFIC EVIDENCE in EVERY finding: exact quotes, numbers, dates, timelines, names, channels, frequencies, concrete examples.',
    '  - ALWAYS explain the respondent\'s reasoning, motivations, emotions, experiences, and decision-making process.',
    '  - ALWAYS include relevant details, tensions, caveats, contrasts, and nuances.',
    '  - Organize logically: background → current situation → reasoning/details → outcomes → implications.',
    '  - Write as if you are taking comprehensive research notes, not creating a brief summary.',
    '',
    '  ✅ GOOD EXAMPLE (5 sentences with details):',
    '  "The respondent was diagnosed with SMA Type 3 at age 7 after experiencing difficulty walking and frequent falls at school. She describes her current health as stable overall but has noticed progressive weakness in her legs over the past two years, particularly when climbing stairs or walking on uneven surfaces. She manages her condition through weekly physical therapy sessions at a local clinic and regular check-ins with her neurologist every six months. For mobility, she uses a wheelchair for distances over 100 feet but can still walk short distances independently with a cane for support. She emphasizes that maintaining her independence in daily activities is her primary health goal."',
    '',
    '  ❌ BAD EXAMPLES (too brief, lacks detail):',
    '  - "The respondent has SMA and uses a wheelchair." (1 sentence - REJECTED)',
    '  - "The respondent lives with his wife and has two adult children." (1 sentence - REJECTED)',
    '  - "Since quitting his job, he spends time walking his dog and reading." (1 sentence - REJECTED)',
    '',
    '',
    'SUPPORTING QUOTES (context array):',
    '  ⚠️⚠️⚠️ CRITICAL: Provide 2-8 VERBATIM quotes from the RESPONDENT ONLY - NO MODERATOR TEXT ALLOWED ⚠️⚠️⚠️',
    '  ',
    '  🚨🚨🚨 WARNING: COPY WORD-FOR-WORD, DO NOT WRITE SUMMARIES! 🚨🚨🚨',
    '  WRONG: "He has not had regular discussions..." (This is YOUR summary in 3rd person)',
    '  WRONG: "The respondent explained that..." (This is YOUR description)',
    '  RIGHT: "To be honest, I was never seeing a neurologist..." (This is the RESPONDENT\'S actual words)',
    '  ',
    '  ABSOLUTE REQUIREMENTS FOR QUOTES:',
    '  1. Extract ONLY the respondent\'s words - copy word-for-word, character-for-character',
    '  2. DO NOT include "Respondent:" or "Moderator:" labels',
    '  3. DO NOT include ANY moderator questions, prompts, or follow-ups',
    '  4. DO NOT include "Moderator: [question] Respondent: [answer]" - ONLY include the [answer] part',
    '  5. DO NOT paraphrase, summarize, or clean up the text',
    '  6. Preserve ALL filler words (um, uh, like, you know)',
    '  7. Keep original grammar even if imperfect',
    '  8. Each quote should be 2-6 sentences from the respondent providing FULL CONTEXT',
    '  9. Include complete thoughts and explanations - do NOT truncate mid-thought',
    '  10. Capture the respondent\'s full explanation with all relevant details and reasoning',
    '',
    '  QUOTE EXAMPLES:',
    '  ✅ GOOD - Longer verbatim quote with full context:',
    '  "Through Facebook. That was the only thing that I was getting my information from was these Facebook support groups that I was a part of for spinal muscular atrophy. I don\'t think I joined until either my very late thirties or my early forties. I\'ve only been on it for probably ten years, maybe eleven at the most. I can read about it and sort of see what other people are doing about it."',
    '',
    '  ✅ GOOD - Multiple comprehensive verbatim quotes with reasoning:',
    '  ["I started in April 2021, and I took it until April 2022. I stopped because insurance wouldn\'t pay for it. They wouldn\'t allow me to renew it. There was part of me going, wait a minute. I got worse. The other part was like, well, insurance has denied it anyways. That\'s the writing on the wall.", "The first time when I took it, I literally had stopped driving my accessible vehicle several months prior. I started taking it that first time, and within a month and a half, I was strong enough to start driving again. I was able to wash my hair again. It was like, oh my gosh, this is amazing. But then what happened is after six months, it\'s like the bottom fell out, and I got worse quickly."]',
    '',
    '  ❌ BAD - Too short, missing context (REJECTED):',
    '  "She said, well, there\'s also another drug that\'s on the horizon of getting approved."',
    '  (This is too brief - needs the FULL conversation context around this statement)',
    '',
    '  ❌ BAD - Paraphrased (REJECTED):',
    '  "The respondent gets information from Facebook support groups."',
    '',
    '  ❌ BAD - Includes moderator text (REJECTED):',
    '  "Moderator: How do you learn about treatments? Respondent: Through Facebook groups."',
    '',
    '  ❌ BAD - Includes moderator even without label (REJECTED):',
    '  "What do you mean you will? Why will you? Because now I\'m curious to see if any changes."',
    '  (This includes the moderator\'s question - should ONLY include: "Because now I\'m curious to see if any changes.")',
    '',
    '  ❌ BAD - Cleaned up text (REJECTED):',
    '  "I got my information from Facebook support groups for SMA." (Original had filler words)',
    '',
    '  ❌ ABSOLUTELY WRONG - Third-person summary (REJECTED):',
    '  "He has not had regular discussions with healthcare providers about symptom tracking."',
    '  ⚠️ THIS IS A SUMMARY YOU WROTE - NOT A QUOTE FROM THE TRANSCRIPT!',
    '  ⚠️ Respondents speak in FIRST PERSON: "I", "me", "my" - NOT "he", "his", "the respondent"',
    '  ',
    '  ❌ ABSOLUTELY WRONG - Descriptive text (REJECTED):',
    '  "The respondent\'s muscle loss has significantly impacted his treatment decisions."',
    '  ⚠️ THIS IS YOUR DESCRIPTION - NOT THE RESPONDENT\'S WORDS!',
    '  ',
    '  ✅ CORRECT - First-person verbatim from transcript:',
    '  "To be honest, I was never seeing a neurologist on a regular basis. My primary care would check in with me, but we never really discussed how I was tracking my symptoms day-to-day. I think that\'s something that should have happened, looking back on it now. I was just doing my own thing, keeping mental notes, but nobody was asking me about it systematically."',
    '  ',
    '  🚨 CRITICAL CHECK: Every quote MUST contain first-person pronouns (I, me, my, we, our)',
    '  🚨 If your quote uses "he", "his", "the respondent", YOU MADE A MISTAKE - it\'s not a quote!',
    '',
    'CRITICAL VALIDATION:',
    '  - Every key finding should have 2-8 supporting quotes with comprehensive context',
    '  - Each quote should be 2-6 sentences long with full reasoning and details',
    '  - Quotes must be EXACT COPIES from the respondent\'s speech in the transcript',
    '  - Quotes should prove the key finding with specific evidence',
    '  - If the respondent discusses the topic multiple times, include quotes from different conversation sections',
    '  - Capture the respondent\'s full explanation, not just sentence fragments',
    '',
    'GENERAL REMINDERS:',
    '  - Do NOT invent respondent ID/date/time. Do NOT infer demographics unless clearly stated.',
    '  - Ignore moderator text when creating findings; focus on respondent statements.',
    '  - If speaker labels are missing or wrong, use context clues to distinguish moderator from respondent.',
    '  - Do NOT add extra columns or sheets; use only those provided.',
    '  - Return ALL sheets in your JSON response, even if some columns are empty strings.',
  ].join('\n');

  const userParts = [];

  // CRITICAL: Show the AI the EXACT sheets and columns it must fill
  userParts.push('=== REQUIRED SHEETS AND COLUMNS ===');
  userParts.push('You MUST use these EXACT sheet names and column names in your response:');
  userParts.push('');
  userParts.push('IMPORTANT: Do NOT fill these metadata columns - leave them as empty strings:');
  userParts.push('  - "Respondent ID"');
  userParts.push('  - "respno"');
  userParts.push('  - "Interview Date"');
  userParts.push('  - "Interview Time"');
  userParts.push('  - "Date"');
  userParts.push('  - "Time"');
  userParts.push('  - "Time (ET)"');
  userParts.push('These are automatically populated. Focus ONLY on content columns.');
  userParts.push('');
  for (const [sheetName, columns] of Object.entries(sheetsColumns)) {
    const contentColumns = columns.filter(c =>
      !['Respondent ID', 'respno', 'Interview Date', 'Interview Time', 'Date', 'Time', 'Time (ET)'].includes(c)
    );
    if (contentColumns.length > 0) {
      userParts.push(`Sheet: "${sheetName}"`);
      userParts.push(`Content Columns to Fill: ${contentColumns.map(c => `"${c}"`).join(', ')}`);
      userParts.push('');
    }
  }
  userParts.push('DO NOT create your own sheet names. USE ONLY THE EXACT NAMES ABOVE.');
  userParts.push('');

  userParts.push('=== TRANSCRIPT (FULL) ===');
  userParts.push(transcript);

  // Use actual sheet names from sheetsColumns in the example
  const exampleSheetName = Object.keys(sheetsColumns)[0] || 'Sheet1';
  const exampleColumnName = (sheetsColumns[exampleSheetName] && sheetsColumns[exampleSheetName][0]) || 'Column1';

  userParts.push('=== OUTPUT FORMAT EXAMPLE ===');
  userParts.push('Your response must match this structure using the EXACT sheet and column names provided above:');
  userParts.push(JSON.stringify({
    rows: {
      [exampleSheetName]: {
        [exampleColumnName]: "3-5 sentence key finding summary based on transcript evidence with specific details, reasoning, and context..."
      }
    },
    context: {
      [exampleSheetName]: {
        [exampleColumnName]: [
          "I was diagnosed in 2019, and it was a really difficult time for me because I didn't know what to expect. My doctor explained that I would need to start treatment right away, but I was hesitant because I had heard mixed things from other patients in my support group.",
          "The side effects were pretty manageable at first, just some fatigue and nausea. But after about six months, I started experiencing muscle weakness in my legs, and that's when I really started to worry about whether this treatment was working for me."
        ]
      }
    }
  }, null, 2));
  userParts.push('');
  userParts.push('IMPORTANT NOTES ABOUT THE EXAMPLE ABOVE:');
  userParts.push('- The context array quotes are EXAMPLES showing the STYLE and FORMAT you should use');
  userParts.push('- DO NOT copy these exact example quotes into your response');
  userParts.push('- Instead, find similar VERBATIM quotes from the actual transcript provided');
  userParts.push('- The quotes should be word-for-word copies from what the respondent actually said');
  userParts.push('- DO NOT write summaries like "The respondent explained..." or "He said that..."');
  userParts.push('- DO NOT write descriptions like "The respondent\'s muscle loss has significantly impacted..."');
  userParts.push('- COPY the respondent\'s actual words exactly as they appear in the transcript');

  const messages = [
    { role: 'system', content: sys },
    { role: 'user', content: userParts.join('\n\n') },
  ];

  let resp;
  let json;
  let lastError;

  // Retry up to 3 times if JSON parsing fails
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      console.log(`🔄 Attempt ${attempt}/3: Calling OpenAI API with gpt-4o...`);
      resp = await client.chat.completions.create({
        model: 'gpt-4o',
        temperature: 0.1,
        messages,
        response_format: { type: 'json_object' },
        max_tokens: 16384,
      });

      const content = resp.choices[0].message.content;
      console.log('🔍 Raw AI response (first 500 chars):', content?.substring(0, 500));
      console.log('🔍 Raw AI response (last 500 chars):', content?.substring(content.length - 500));

      json = JSON.parse(content);
      console.log(`✅ Successfully parsed JSON on attempt ${attempt}`);
      console.log('🔍 Parsed JSON structure:', {
        hasRows: !!json.rows,
        hasContext: !!json.context,
        rowsKeys: json.rows ? Object.keys(json.rows) : 'none',
        contextKeys: json.context ? Object.keys(json.context) : 'none'
      });
      if (json.context) {
        for (const [sheet, cols] of Object.entries(json.context)) {
          const filledCols = Object.entries(cols).filter(([k, v]) => Array.isArray(v) && v.length > 0);
          console.log(`  📝 AI returned context for sheet "${sheet}": ${filledCols.length} columns with data`);
        }
      }
      break; // Success - exit retry loop

    } catch (e) {
      lastError = e;
      console.error(`❌ Attempt ${attempt}/3 failed - JSON Parse Error:`, e.message);

      if (attempt === 3) {
        // Final attempt failed
        console.error('❌ All 3 attempts failed. Last response:', resp?.choices[0]?.message?.content);
        throw new Error(`AI returned invalid JSON for transcript filling after 3 attempts: ${e.message}`);
      }

      // Schema-enforced fallback before waiting
      try {
        console.log('dY"? Trying schema-enforced fallback request...');
        const schema = {
          type: 'object',
          required: ['rows', 'context'],
          additionalProperties: false,
          properties: {
            rows: {
              type: 'object',
              additionalProperties: {
                type: 'object',
                additionalProperties: { type: 'string' }
              }
            },
            context: {
              type: 'object',
              additionalProperties: {
                type: 'object',
                additionalProperties: {
                  type: 'array',
                  items: { type: 'string' },
                  maxItems: 8
                }
              }
            }
          }
        };

        const resp2 = await client.chat.completions.create({
          model: 'gpt-4o',
          temperature: 0.1,
          messages,
          response_format: { type: 'json_schema', json_schema: { name: 'ca_rows_quotes_context', schema, strict: true } },
          max_tokens: 16384
        });

        const content2 = resp2.choices?.[0]?.message?.content || '';
        console.log('dY"? Fallback AI response (first 300 chars):', content2.substring(0, 300));
        json = JSON.parse(content2);
        console.log('�o. Successfully parsed JSON via schema fallback');
        break; // Success - exit retry loop
      } catch (e2) {
        console.warn('�?O Schema fallback also failed:', e2.message);
      }

      // Wait before retrying (exponential backoff)
      const waitTime = attempt * 1000;
      console.log(`⏳ Waiting ${waitTime}ms before retry...`);
      await new Promise(resolve => setTimeout(resolve, waitTime));
    }
  }

  console.log('🤖 AI RAW RESPONSE - Top-level keys:', Object.keys(json));
  console.log('🤖 AI RAW RESPONSE - Sheets returned:', Object.keys(json.rows || {}));
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
  const contextOut = {};
  const aiRows = (json && typeof json === 'object' && json.rows && typeof json.rows === 'object') ? json.rows : {};
  const aiContext = (json && typeof json === 'object' && json.context && typeof json.context === 'object') ? json.context : {};

  console.log('🤖 AI returned data for sheets:', Object.keys(aiRows));
  for (const [sheetName, rowData] of Object.entries(aiRows)) {
    const filledCols = Object.entries(rowData).filter(([k, v]) => v && String(v).trim().length > 0);
    console.log(`  📊 Sheet "${sheetName}": ${filledCols.length}/${Object.keys(rowData).length} columns filled`);
    if (filledCols.length > 0) {
      console.log(`     Filled columns:`, filledCols.map(([k]) => k).join(', '));
    }
  }

  // Helper: normalize text for deduplication
  const norm = (s) => (typeof s === 'string' ? s.replace(/\s+/g, ' ').trim().toLowerCase() : '');

  // Helper to clean and validate context
  function _cleanContext(contextArray) {
    if (!Array.isArray(contextArray)) return [];
    return contextArray
      .map(ctx => (typeof ctx === 'string' ? ctx : String(ctx)).trim())
      .filter(Boolean)
      .map(ctx => ctx.replace(/\\n/g, '\n')); // Convert escaped newlines to actual newlines
  }

  // Ensure each requested sheet exists in result; if missing, create empty row
  for (const [sheet, cols] of Object.entries(sheetsColumns)) {
    const fromAI = aiRows[sheet] || {};
    const row = {};
    for (const col of cols) {
      const v = Object.prototype.hasOwnProperty.call(fromAI, col) ? fromAI[col] : '';
      // Keep full researcher-written summary without artificial character limits
      row[col] = (typeof v === 'string' ? v : (v == null ? '' : String(v))).trim();
    }
    rowsOut[sheet] = row;

    const fromContext = aiContext[sheet] || {};
    const colContext = {};
    for (const col of cols) {
      const rawContext = Array.isArray(fromContext[col]) ? fromContext[col] : [];
      const cleanedContext = _cleanContext(rawContext);
      
      // Remove duplicates while preserving order
      const seen = new Set();
      const uniqueContext = [];
      for (const ctx of cleanedContext) {
        const normalized = norm(ctx);
        if (normalized.length > 20 && !seen.has(normalized)) { // Only keep substantial context
          seen.add(normalized);
          uniqueContext.push(ctx);
        }
      }
      
      colContext[col] = uniqueContext;
    }
    contextOut[sheet] = colContext;
  }

  console.log('📤 Returning context for sheets:', Object.keys(contextOut));
  for (const [sheet, cols] of Object.entries(contextOut)) {
    const filledContextCols = Object.entries(cols).filter(([k, v]) => Array.isArray(v) && v.length > 0);
    console.log(`  📝 Sheet "${sheet}": ${filledContextCols.length} columns with context`);
  }

  // Validate: Check context quality
  let totalContextBlocks = 0;
  let emptyContextBlocks = 0;

  for (const [sheet, cols] of Object.entries(contextOut)) {
    for (const [col, contexts] of Object.entries(cols)) {
      if (!Array.isArray(contexts)) continue;
      totalContextBlocks += contexts.length;
      emptyContextBlocks += contexts.filter(ctx => !ctx || ctx.trim().length === 0).length;
    }
  }

  if (totalContextBlocks > 0) {
    console.log(`\n✅ Context validation: ${totalContextBlocks - emptyContextBlocks}/${totalContextBlocks} context blocks populated`);
    if (emptyContextBlocks > 0) {
      console.warn(`⚠️  WARNING: ${emptyContextBlocks} empty context blocks detected.`);
    }
  }

  return { rows: rowsOut, context: contextOut };
}
