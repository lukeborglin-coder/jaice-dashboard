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
    '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━',
    'TWO DISTINCT OUTPUTS ARE REQUIRED FOR EACH COLUMN:',
    '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━',
    '',
    '1️⃣ KEY FINDING (goes in the cell):',
    '   - Write a THIRD-PERSON SUMMARY that accurately describes what you learned (be comprehensive where evidence exists)',
    '   - Use objective research language (e.g., "Learns about treatments through Facebook groups")',
    '   - 3–6 sentences capturing who/what/how/why with specific details',
    '   - No artificial length limit; include specifics and nuance when supported by the transcript',
    '   - Do NOT leave cells empty just because you want verbatim quotes - ALWAYS create a finding if there is ANY relevant discussion',
    '',
    '2️⃣ ADDITIONAL CONTEXT (shows ALL conversations that informed the finding):',
    '   - Extract COMPREHENSIVE conversation snippets WITH speaker labels (Moderator: and Respondent:)',
    '   - Think of this as "complete transcript excerpts" - show ALL relevant back-and-forth dialogue',
    '   - Each context block should be EXTENSIVE and COMPLETE (typically 10-30 speaker turns)',
    '   - Start with the moderator question that introduced the topic',
    '   - Include ALL follow-up questions, answers, and related discussions until the topic changes',
    '   - Format with speaker labels and line breaks (use \\n between turns)',
    '   - Provide MULTIPLE context blocks if the topic was discussed in different parts of the interview',
    '   - ⚠️ CRITICAL: Include EVERY conversation that relates to this topic, not just one example',
    '   - ⚠️ If there were 5 different points in the conversation about this theme, include ALL 5',
    '   - ⚠️ NEVER truncate context - always include the complete moderator question and full respondent answer',
    '   - ⚠️ Include moderator follow-up questions and respondent elaborations in the same context block',
    '   - Example format:',
    '     "Moderator: How do you learn about new SMA treatments?\\nRespondent: Through Facebook. That was the only thing that I was getting my information from was these Facebook support groups...\\nModerator: When did you join those groups?\\nRespondent: I don\'t know exactly... probably ten years, maybe eleven at the most."',
    '',
    '3️⃣ SUPPORTING QUOTES (REMOVED - Focus on comprehensive context instead):',
    '   - Supporting quotes are disabled - focus on providing comprehensive Additional Context',
    '   - The Additional Context should contain all the relevant conversation snippets',
    '   - Users will see the full conversation context instead of individual quotes',
    '',
    '   ━━━ CONTEXT EXAMPLES ━━━',
    '   ✅ GOOD context: "Moderator: How do you learn about new SMA treatments?\\nRespondent: Through Facebook. That was the only thing that I was getting my information from was these Facebook support groups that I was a part of for spinal muscular atrophy. That was where I was getting my information.\\nModerator: So interesting. When do you think you joined those groups?\\nRespondent: I don\'t know exactly... probably ten years, maybe eleven at the most.\\nModerator: What kind of information do you get from those groups?\\nRespondent: Mostly about new treatments and how other people are doing with them. It\'s really helpful to hear from people who are actually using the treatments."',
    '   ✅ GOOD context: "Moderator: What treatments have you tried?\\nRespondent: So I\'ve been on it on two separate occasions. The first time, I started in April 2021, and I took it until April 2022.\\nModerator: And what happened after that?\\nRespondent: I stopped because I didn\'t see any improvement.\\nModerator: How did you feel about stopping?\\nRespondent: It was disappointing, but I knew I had to try something else. My doctor suggested we might try a different approach."',
    '',
    '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━',
    'CRITICAL VALIDATION:',
    '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━',
    '✓ Every key finding should have comprehensive Additional Context (unless truly no evidence exists)',
    '✓ Context blocks should read like actual transcript excerpts with natural dialogue flow',
    '✓ Context should include ALL relevant conversations about the topic, not just one example',
    '✓ ⚠️ COMPREHENSIVE: Include every conversation that relates to this topic ⚠️',
    '✓ ⚠️ MULTIPLE CONTEXTS: If topic discussed in 5 different places, include all 5 ⚠️',
    '',
    '- Do NOT invent respondent ID/date/time. Do NOT infer demographics unless clearly stated.',
    '- Ignore moderator text when creating findings; focus on respondent statements.',
    '- If speaker labels are missing/wrong, USE CONTEXT to distinguish moderator from respondent.',
    '- Do NOT add extra columns or sheets; use only those provided.',
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

  // Reinforce requirements inline for better adherence
  userParts.push('=== REQUIREMENTS ===');
  userParts.push([
    'Follow this workflow strictly:',
    '1) Use the full CLEANED transcript as the source of truth.',
    '2) Review all tab titles and columns; map findings by meaning (conversation may jump).',
    '3) For EVERY sheet/column, write a Key Finding in objective research notes; do not copy/paste; no artificial length limits.',
    '4) For each Key Finding, provide COMPREHENSIVE context excerpts that show ALL relevant conversations.',
    '5) Include MULTIPLE context blocks if the topic was discussed in different parts of the interview.',
    '6) ⚠️ CRITICAL: Include EVERY conversation that relates to this topic, not just one example!',
    '7) ⚠️ If there were 5 different points in the conversation about this theme, include ALL 5!',
  ].join('\n'));

  console.log(`📋 Sending ${Object.keys(sheetsColumns).length} sheets to AI:`, Object.keys(sheetsColumns));
  for (const [sheet, cols] of Object.entries(sheetsColumns)) {
    console.log(`   "${sheet}": ${cols.length} columns`);
  }

  userParts.push('=== TRANSCRIPT (FULL) ===');
  userParts.push(transcript);

  userParts.push('=== OUTPUT FORMAT EXAMPLE ===');
  userParts.push(JSON.stringify({
    rows: {
      "Finding New Treatments": {
        "Finding New Treatments": "Learns about new SMA treatments primarily through Facebook support groups, which serve as the main source of information about treatment developments."
      }
    },
    context: {
      "Finding New Treatments": {
        "Finding New Treatments": [
          "Moderator: So you weren't going to a doctor. How are you learning about these developments in the SMA treatment?\\nRespondent: Through Facebook. That was the only thing that I was getting my information from was these Facebook support groups that I was a part of for spinal muscular atrophy. That was where I was getting my information.\\nModerator: So interesting. When do you think you joined those groups?\\nRespondent: I don't know exactly... probably ten years, maybe eleven at the most.",
          "Moderator: What other sources do you use for treatment information?\\nRespondent: Honestly, just those Facebook groups. I don't really trust other sources. The people in those groups have been through it themselves, so they know what they're talking about.\\nModerator: Do you ever check with your doctor about what you learn?\\nRespondent: Sometimes, but usually I just go with what the group says."
        ]
      }
    }
  }, null, 2));

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
      console.log(`🔄 Attempt ${attempt}/3: Calling OpenAI API with gpt-4o (higher token limit)...`);
      resp = await client.chat.completions.create({
        model: 'gpt-4o',
        temperature: 0.1,
        messages,
        response_format: { type: 'json_object' },
      });

      const content = resp.choices[0].message.content;
      console.log('🔍 Raw AI response (first 500 chars):', content?.substring(0, 500));
      console.log('🔍 Raw AI response (last 500 chars):', content?.substring(content.length - 500));

      json = JSON.parse(content);
      console.log(`✅ Successfully parsed JSON on attempt ${attempt}`);
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
                  maxItems: 10
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
          max_tokens: 16000
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
