import express from 'express';
import mammoth from 'mammoth';
import OpenAI from 'openai';
import { logCost, COST_CATEGORIES } from '../services/costTracking.service.mjs';

const router = express.Router();

// Hard-coded parser to extract questions from standardized format
function parseStandardizedFormat(cleanedText) {
  const questions = [];
  const questionBlocks = cleanedText.split('===QUESTION===').filter(block => block.trim());

  for (const block of questionBlocks) {
    if (!block.includes('===END===')) continue;

    const content = block.split('===END===')[0].trim();
    const lines = content.split('\n').map(l => l.trim()).filter(l => l);

    const question = {
      number: '',
      text: '',
      type: '',
      options: [],
      statementOptions: [],
      responseOptions: [],
      showLogic: '',
      randomize: false,
      tags: [],
      needsReview: false,
      logic: '',
      terminateLogic: null
    };

    let currentField = null;

    for (const line of lines) {
      if (line.startsWith('NUMBER:')) {
        question.number = line.substring(7).trim();
      } else if (line.startsWith('TEXT:')) {
        question.text = line.substring(5).trim();
      } else if (line.startsWith('TYPE:')) {
        question.type = line.substring(5).trim();
      } else if (line.startsWith('OPTIONS:')) {
        currentField = 'options';
      } else if (line.startsWith('STATEMENT_OPTIONS:')) {
        currentField = 'statementOptions';
      } else if (line.startsWith('RESPONSE_OPTIONS:')) {
        currentField = 'responseOptions';
      } else if (line.startsWith('SHOW_LOGIC:')) {
        question.showLogic = line.substring(11).trim();
        currentField = null;
      } else if (line.startsWith('RANDOMIZE:') || line.startsWith('RANDOMIZE_ROWS:')) {
        const value = line.includes(':') ? line.split(':')[1].trim().toLowerCase() : '';
        question.randomize = value === 'true';
        currentField = null;
      } else if (line.startsWith('TAGS:')) {
        const tagsStr = line.substring(5).trim();
        question.tags = tagsStr ? tagsStr.split(',').map(t => t.trim()).filter(t => t) : [];
        currentField = null;
      } else if (line.startsWith('NEEDS_REVIEW:')) {
        question.needsReview = line.substring(13).trim().toLowerCase() === 'true';
        currentField = null;
      } else if (line.startsWith('LOGIC:')) {
        question.logic = line.substring(6).trim();
        currentField = null;
      } else if (line.startsWith('TERMINATE_IF:')) {
        const terminateStr = line.substring(13).trim();
        if (terminateStr && terminateStr !== 'none') {
          // Check if it's a simple list of option codes or complex logic
          if (/^[\d,\s-]+$/.test(terminateStr)) {
            // Simple option codes like "1,2" or "1-4"
            const codes = [];
            const parts = terminateStr.split(',').map(p => p.trim());
            for (const part of parts) {
              if (part.includes('-')) {
                const [start, end] = part.split('-').map(n => parseInt(n.trim()));
                for (let i = start; i <= end; i++) {
                  codes.push(String(i));
                }
              } else {
                codes.push(part);
              }
            }
            question.terminateLogic = { optionCodes: codes };
          } else {
            // Complex logic - keep as string
            question.terminateLogic = terminateStr;
          }
        }
        currentField = null;
      } else if (currentField && line.match(/^\s+(.+)/)) {
        // This is a continuation line for options/statements/responses
        const match = line.match(/^\s*(.+)/);
        if (match) {
          const content = match[1].trim();
          if (content.includes('|')) {
            const [code, text] = content.split('|').map(s => s.trim());
            if (currentField === 'options') {
              question.options.push({ code, text });
            } else if (currentField === 'statementOptions') {
              question.statementOptions.push({ code, text });
            } else if (currentField === 'responseOptions') {
              question.responseOptions.push({ code, text });
            }
          } else if (currentField === 'options') {
            // Option without explicit code - use text as both
            question.options.push(content);
          }
        }
      }
    }

    // Clean up empty arrays
    if (question.statementOptions.length === 0) delete question.statementOptions;
    if (question.responseOptions.length === 0) delete question.responseOptions;
    if (question.options.length === 0) delete question.options;
    if (!question.showLogic) delete question.showLogic;
    if (!question.logic) delete question.logic;
    if (!question.terminateLogic) delete question.terminateLogic;
    if (question.tags.length === 0) delete question.tags;

    if (question.number && question.text) {
      questions.push(question);
    }
  }

  return questions;
}

// STEP 1: Just clean the questionnaire with AI (don't parse yet)
async function cleanQuestionnaire(filePath, projectId) {
  try {
    // Extract text from file
    const result = await mammoth.extractRawText({ path: filePath });
    const text = result.value;

    console.log(`📋 Converting questionnaire to standardized format using AI...`);

    // AI cleans the questionnaire to standardized format
    const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

    const cleaningPrompt = `You are a Forsta/Decipher questionnaire formatting expert. Convert this messy questionnaire to a clean, standardized format.

STANDARDIZED FORMAT - Convert each question to this EXACT format:

===QUESTION===
NUMBER: [question ID like Q1, S1, A1]
TEXT: [full question text]
TYPE: [one of: Single Select, Multi-Select, Numeric, Text, Single Select Grid, Multi-Select Grid, Numeric Grid, Numeric List, Rating Scale, Button Rating]
OPTIONS:
  [code]|[text]
  [code]|[text]
STATEMENT_OPTIONS:
  [code]|[text]
RESPONSE_OPTIONS:
  [code]|[text]
SHOW_LOGIC: [condition like "Q1=1", or leave blank]
RANDOMIZE_ROWS: [true/false - only if explicitly stated]
TAGS: [comma-separated: Scale, Demographic, %, Number]
NEEDS_REVIEW: [true/false]
LOGIC: [any skip logic]
TERMINATE_IF: [codes like "1,2" OR complex like "Q1=1 AND Q2=2", or "none"]
===END===

CRITICAL RULES:
1. Use OPTIONS for regular questions
2. Use STATEMENT_OPTIONS (rows: r1, r2, r3) and RESPONSE_OPTIONS (columns: c1, c2, c3) for grids
3. Extract FULL scale labels: "1 Strongly Disagree" not just "1"
4. TERMINATE_IF: simple codes like "1,2,3" OR complex logic like "Q1=1 AND Q2=2"
5. TAGS: Add "Scale" for rating questions, "%" for percentages, "Number" for counts, "Demographic" for demographics
6. RANDOMIZE_ROWS: only true if explicitly stated
7. Include EVERY question - don't skip any
8. Each question MUST be wrapped in ===QUESTION=== and ===END===

QUESTIONNAIRE TEXT:
${text}`;

    const startTime = Date.now();
    const response = await client.chat.completions.create({
      model: 'gpt-4o',
      messages: [{ role: 'user', content: cleaningPrompt }],
      temperature: 0.1,
      max_tokens: 16384
    });

    const requestTime = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log(`✅ AI cleaning completed in ${requestTime}s`);

    // Log cost
    if (projectId && response.usage) {
      const inputTokens = response.usage.prompt_tokens || 0;
      const outputTokens = response.usage.completion_tokens || 0;
      if (inputTokens > 0 && outputTokens > 0) {
        try {
          await logCost(
            projectId,
            COST_CATEGORIES.QUESTIONNAIRE_PARSING,
            'gpt-4o',
            inputTokens,
            outputTokens,
            'Questionnaire cleaning (new method)'
          );
        } catch (costError) {
          console.warn('Failed to log cost:', costError.message);
        }
      }
    }

    const cleanedText = response.choices[0].message.content;

    // Return cleaned text (don't parse yet - user will trigger that)
    return {
      cleanedText,
      cleaningTime: requestTime
    };
  } catch (error) {
    console.error('Error in cleanQuestionnaire:', error);
    throw error;
  }
}

// STEP 2: Parse already-cleaned questionnaire (instant!)
function parseCleanedQuestionnaire(cleanedText) {
  console.log(`⚡ Parsing cleaned questionnaire with hard-coded parser...`);
  const parseStartTime = Date.now();
  const questions = parseStandardizedFormat(cleanedText);
  const parseTime = ((Date.now() - parseStartTime) / 1000).toFixed(3);
  console.log(`✅ Parsed ${questions.length} questions in ${parseTime}s`);

  return {
    questions,
    parseTime
  };
}

export { cleanQuestionnaire, parseCleanedQuestionnaire, parseStandardizedFormat };
