import OpenAI from 'openai';
import { logCost, COST_CATEGORIES } from './costTracking.service.mjs';
import fs from 'fs/promises';
import path from 'path';

/**
 * Storytelling Service
 * Handles AI generation for Key Findings, Storyboards, and Q&A
 */

// Estimate tokens for cost calculation (rough approximation)
function estimateTokens(text) {
  // Rough estimate: 1 token ≈ 4 characters for English text
  return Math.ceil(text.length / 4);
}

// Extract relevant verbatim quotes from content analysis data based on question
function extractRelevantQuotes(quotesData, question) {
  if (!quotesData || typeof quotesData !== 'object') return [];
  
  const allQuotes = [];
  const questionLower = question.toLowerCase();
  
  // Extract verbatim quotes from all sheets and respondents
  for (const [sheetName, sheetQuotes] of Object.entries(quotesData)) {
    if (!sheetQuotes || typeof sheetQuotes !== 'object') continue;
    
    for (const [respondentId, respondentQuotes] of Object.entries(sheetQuotes)) {
      if (!respondentQuotes || typeof respondentQuotes !== 'object') continue;
      
      for (const [columnName, columnQuotes] of Object.entries(respondentQuotes)) {
        if (!Array.isArray(columnQuotes)) continue;
        
        // Filter quotes that might be relevant to the question
        for (const quote of columnQuotes) {
          if (typeof quote === 'string' && quote.trim()) {
            const quoteLower = quote.toLowerCase();
            // Simple relevance check - look for key terms from the question
            const questionWords = questionLower.split(/\s+/).filter(word => word.length > 3);
            const hasRelevantTerms = questionWords.some(word => quoteLower.includes(word));
            
            if (hasRelevantTerms || questionWords.length === 0) {
              allQuotes.push(quote.trim());
            }
          }
        }
      }
    }
  }
  
  // Remove duplicates and return up to 10 most relevant quotes
  const uniqueQuotes = [...new Set(allQuotes)];
  return uniqueQuotes.slice(0, 10);
}

// Generate quotes on-demand for specific cells (same as content analysis)
async function generateQuotesForCell(analysisId, respondentId, columnName, sheetName, keyFinding) {
  try {
    const response = await fetch(`${process.env.API_BASE_URL || 'http://localhost:3005'}/api/content-analysis/get-verbatim-quotes`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        analysisId,
        respondentId,
        columnName,
        sheetName,
        keyFinding
      })
    });

    if (!response.ok) {
      console.error(`Failed to generate quotes for ${respondentId} - ${columnName}:`, response.status);
      return [];
    }

    const result = await response.json();
    return result.quotes || [];
  } catch (error) {
    console.error('Error generating quotes for cell:', error);
    return [];
  }
}

// Clean quote text by removing speaker labels and formatting
function cleanQuoteText(quoteText) {
  if (!quoteText || typeof quoteText !== 'string') return '';
  
  console.log(`🔍 Cleaning quote: "${quoteText.substring(0, 100)}..."`);
  
  // Remove common speaker labels
  let cleaned = quoteText
    .replace(/^(Respondent|Interviewer|Moderator|Facilitator|Researcher):\s*/i, '')
    .replace(/^R\d+:\s*/i, '') // Remove R01:, R02:, etc.
    .replace(/^\[.*?\]\s*/g, '') // Remove [bracketed content]
    .replace(/^\(.*?\)\s*/g, '') // Remove (parenthetical content) at start
    .trim();
  
  // Remove trailing speaker labels
  cleaned = cleaned.replace(/\s*\(Respondent|Interviewer|Moderator|Facilitator|Researcher\)$/i, '');
  
  console.log(`🔍 Cleaned quote: "${cleaned.substring(0, 100)}..."`);
  
  return cleaned;
}

// Check if a quote is relevant to the specific question
function isQuoteRelevantToQuestion(quoteText, question) {
  const quoteLower = quoteText.toLowerCase();
  const questionLower = question.toLowerCase();
  
  // Extract key terms from the question
  const questionWords = questionLower
    .split(/\s+/)
    .filter(word => word.length > 3)
    .map(word => word.replace(/[^\w]/g, '')); // Remove punctuation
  
  // Define question-specific keywords for better matching
  const questionKeywords = {
    'barriers': ['barrier', 'obstacle', 'challenge', 'difficulty', 'problem', 'issue', 'hinder', 'prevent', 'stop', 'block'],
    'treatment': ['treatment', 'therapy', 'medication', 'drug', 'medicine', 'care', 'medical', 'healthcare'],
    'cost': ['cost', 'price', 'expensive', 'afford', 'insurance', 'money', 'financial', 'pay', 'budget'],
    'benefits': ['benefit', 'help', 'improve', 'effective', 'work', 'useful', 'value', 'worth'],
    'access': ['access', 'available', 'get', 'obtain', 'find', 'reach', 'available'],
    'decision': ['decide', 'choice', 'choose', 'consider', 'think', 'opinion', 'view']
  };
  
  // Get relevant keywords based on question content
  const relevantKeywords = [];
  for (const [key, keywords] of Object.entries(questionKeywords)) {
    if (questionLower.includes(key)) {
      relevantKeywords.push(...keywords);
    }
  }
  
  // If we have specific keywords, check for them
  if (relevantKeywords.length > 0) {
    const hasRelevantKeyword = relevantKeywords.some(keyword => quoteLower.includes(keyword));
    if (hasRelevantKeyword) return true;
  }
  
  // Fallback to general word matching
  const hasQuestionWords = questionWords.some(word => quoteLower.includes(word));
  
  // For very specific questions, require at least some word match
  if (questionWords.length > 0) {
    return hasQuestionWords;
  }
  
  // For general questions, be more lenient
  return true;
}

// Extract verbatim quotes from the verbatimQuotes structure (same as content analysis popups)
function extractVerbatimQuotes(verbatimQuotesData, question) {
  if (!verbatimQuotesData || typeof verbatimQuotesData !== 'object') return [];
  
  const allQuotes = [];
  const questionLower = question.toLowerCase();
  
  console.log('🔍 Extracting verbatim quotes for question:', question);
  console.log('🔍 Verbatim quotes data keys:', Object.keys(verbatimQuotesData));
  
  // Extract verbatim quotes from the same structure used by content analysis popups
  for (const [sheetName, sheetQuotes] of Object.entries(verbatimQuotesData)) {
    if (!sheetQuotes || typeof sheetQuotes !== 'object') continue;
    
    for (const [respondentId, respondentQuotes] of Object.entries(sheetQuotes)) {
      if (!respondentQuotes || typeof respondentQuotes !== 'object') continue;
      
      for (const [columnName, quoteData] of Object.entries(respondentQuotes)) {
        if (!quoteData || !Array.isArray(quoteData.quotes)) continue;
        
        // Filter quotes that might be relevant to the question and are respondent direct quotes
        for (const quote of quoteData.quotes) {
          if (quote && typeof quote.text === 'string' && quote.text.trim()) {
            let quoteText = quote.text.trim();
            
            // Clean up the quote text - remove speaker labels and formatting
            quoteText = cleanQuoteText(quoteText);
            
            if (quoteText.length < 30) continue; // Skip very short quotes
            
            const quoteLower = quoteText.toLowerCase();
            
            // Filter out speaker notes and non-respondent content
            const isSpeakerNote = 
              quoteLower.startsWith('interviewer:') ||
              quoteLower.startsWith('moderator:') ||
              quoteLower.startsWith('facilitator:') ||
              quoteLower.startsWith('researcher:') ||
              quoteLower.startsWith('note:') ||
              quoteLower.startsWith('observation:') ||
              quoteLower.startsWith('respondent:') ||
              quoteLower.startsWith('[') && quoteLower.endsWith(']') ||
              quoteLower.includes('(laughs)') ||
              quoteLower.includes('(pauses)') ||
              quoteLower.includes('(coughs)') ||
              quoteLower.includes('(inaudible)') ||
              quoteLower.includes('(unclear)') ||
              quoteLower.includes('(background noise)') ||
              quoteLower.includes('respondent:') ||
              quoteText.length < 30;
            
            if (!isSpeakerNote) {
              // Check relevance to the specific question
              const isRelevant = isQuoteRelevantToQuestion(quoteText, question);
              
              if (isRelevant) {
                allQuotes.push(quoteText);
                console.log(`🔍 Added relevant quote from ${respondentId} - ${columnName}: ${quoteText.substring(0, 50)}...`);
              }
            }
          }
        }
      }
    }
  }
  
  // Remove duplicates and return up to 10 most relevant quotes
  const uniqueQuotes = [...new Set(allQuotes)];
  console.log(`🔍 Extracted ${uniqueQuotes.length} unique verbatim quotes`);
  return uniqueQuotes.slice(0, 10);
}

/**
 * Estimate cost for a storytelling operation
 * @param {string} transcriptsText - Combined transcript text
 * @param {string} caData - Content analysis data as string
 * @param {string} detailLevel - straightforward/moderate/max
 * @param {string} quoteLevel - none/few/moderate/many
 * @returns {object} - Cost estimate with inputTokens, outputTokens, cost, formattedCost
 */
export function estimateStorytellingCost(transcriptsText, caDataObj, detailLevel = 'moderate', quoteLevel = 'moderate', operationType = 'general') {
  // For Q&A operations, don't include transcripts since we only use CA data
  let inputText = '';
  
  if (operationType === 'qa') {
    // Q&A operations only use content analysis data
    const caDataString = JSON.stringify(caDataObj.data || {}, null, 2);
    inputText = caDataString.length > 30000 
      ? caDataString.substring(0, 30000) + '...[truncated]'
      : caDataString;
  } else {
    // Other operations (key findings, storyboard) use both transcripts and CA data
    const maxSampleSize = 50000; // ~12,500 tokens max
    
    const sampleTranscripts = transcriptsText.length > maxSampleSize 
      ? transcriptsText.substring(0, maxSampleSize) + '...[truncated]'
      : transcriptsText;
      
    const caDataString = JSON.stringify(caDataObj.data || {}, null, 2);
    const sampleCAData = caDataString.length > 20000 
      ? caDataString.substring(0, 20000) + '...[truncated]'
      : caDataString;
      
    inputText = sampleTranscripts + sampleCAData;
  }
  
  const inputTokens = estimateTokens(inputText);

  // Estimate output tokens based on detail level
  let outputMultiplier = 0.3; // default for moderate
  if (detailLevel === 'straightforward') outputMultiplier = 0.15;
  if (detailLevel === 'max') outputMultiplier = 0.5;

  // Adjust for quote level
  if (quoteLevel === 'many') outputMultiplier *= 1.5;
  else if (quoteLevel === 'moderate') outputMultiplier *= 1.2;
  else if (quoteLevel === 'few') outputMultiplier *= 1.1;

  const outputTokens = Math.ceil(inputTokens * outputMultiplier);

  // GPT-4o pricing: $2.50 per 1M input, $10.00 per 1M output
  const inputCost = (inputTokens / 1_000_000) * 2.50;
  const outputCost = (outputTokens / 1_000_000) * 10.00;
  const totalCost = inputCost + outputCost;

  // Debug logging
  console.log('💰 Cost Estimation Debug:', {
    operationType,
    originalTranscriptLength: transcriptsText.length,
    originalCADataLength: JSON.stringify(caDataObj.data || {}).length,
    inputTextLength: inputText.length,
    inputTokens,
    outputTokens,
    totalCost: totalCost.toFixed(4)
  });

  return {
    inputTokens,
    outputTokens,
    cost: totalCost,
    formattedCost: `$${totalCost.toFixed(2)}`
  };
}

/**
 * Generate Key Findings from transcripts and CA data
 * @param {string} projectId - Project ID
 * @param {Array} strategicQuestions - Array of preset questions to answer
 * @param {string} transcriptsText - Combined transcript text
 * @param {string} caData - Content analysis data as JSON string
 * @returns {Promise<object>} - Key findings with answers to each question
 */
export async function generateKeyFindings(projectId, strategicQuestions, transcriptsText, caDataObj) {
  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

  const systemPrompt = `You are a senior qualitative research analyst specializing in healthcare and pharmaceutical market research.

Your task is to analyze transcripts and content analysis data to answer strategic research questions.

Guidelines:
- Be concise and actionable
- Focus on the "why" and "so what" - surface insights, not just observations
- Support answers with brief quote excerpts when relevant (keep quotes to 1-2 sentences)
- Identify patterns, themes, and contradictions
- Highlight surprising or unexpected findings`;

  const userPrompt = `Analyze the following research data and answer each strategic question.

STRATEGIC QUESTIONS:
${strategicQuestions.map((q, i) => `${i + 1}. ${q}`).join('\n')}

TRANSCRIPT DATA:
${transcriptsText.substring(0, 50000)} ${transcriptsText.length > 50000 ? '...[truncated]' : ''}

CONTENT ANALYSIS DATA:
${JSON.stringify(caDataObj.data, null, 2).substring(0, 20000)} ${JSON.stringify(caDataObj.data).length > 20000 ? '...[truncated]' : ''}

For each question, provide:
1. A clear, concise answer (2-4 sentences)
2. Supporting quotes (1-3 brief excerpts)
3. Key insight or recommendation

Return your response as a JSON object with this structure:
{
  "findings": [
    {
      "question": "the question text",
      "answer": "concise answer",
      "quotes": ["quote 1", "quote 2"],
      "insight": "key takeaway or recommendation"
    }
  ]
}`;

  const response = await client.chat.completions.create({
    model: 'gpt-4o',
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt }
    ],
    temperature: 0.3,
    response_format: { type: 'json_object' }
  });

  const result = JSON.parse(response.choices[0].message.content);

  // Log cost
  if (response.usage) {
    await logCost(
      projectId,
      COST_CATEGORIES.STORYTELLING,
      'gpt-4o',
      response.usage.prompt_tokens,
      response.usage.completion_tokens,
      'Key Findings Generation'
    );
  }

  return result;
}

/**
 * Generate a Storyboard
 * @param {string} projectId - Project ID
 * @param {string} transcriptsText - Combined transcript text
 * @param {string} caData - Content analysis data as JSON string
 * @param {string} detailLevel - straightforward/moderate/max
 * @param {string} quoteLevel - none/few/moderate/many
 * @returns {Promise<object>} - Storyboard with sections and content
 */
export async function generateStoryboard(projectId, transcriptsText, caDataObj, detailLevel = 'moderate', quoteLevel = 'moderate') {
  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

  // Adjust system prompt based on detail level
  let detailInstruction = 'Provide moderate detail with clear structure.';
  if (detailLevel === 'straightforward') {
    detailInstruction = 'Be concise and high-level. Focus on executive summary style.';
  } else if (detailLevel === 'max') {
    detailInstruction = 'Provide comprehensive detail with deep analysis and context.';
  }

  let quoteInstruction = 'Include a moderate number of relevant quotes (2-4 per section).';
  if (quoteLevel === 'none') {
    quoteInstruction = 'Do not include any quotes. Focus on synthesized findings only.';
  } else if (quoteLevel === 'few') {
    quoteInstruction = 'Include a few key quotes (1-2 per section) for critical points only.';
  } else if (quoteLevel === 'many') {
    quoteInstruction = 'Include many supporting quotes (5-8 per section) to richly illustrate findings.';
  }

  const systemPrompt = `You are a senior qualitative research analyst creating a professional research storyboard.

A storyboard organizes qualitative findings into a narrative that tells the story of the research.

Style Guidelines:
- ${detailInstruction}
- ${quoteInstruction}
- Use clear headers and bullet points
- Present findings in a logical narrative flow
- Highlight key themes, patterns, and insights
- Note contradictions and nuances`;

  const userPrompt = `Create a research storyboard from the following data.

TRANSCRIPT DATA:
${transcriptsText.substring(0, 50000)} ${transcriptsText.length > 50000 ? '...[truncated]' : ''}

CONTENT ANALYSIS DATA:
${JSON.stringify(caDataObj.data, null, 2).substring(0, 20000)} ${JSON.stringify(caDataObj.data).length > 20000 ? '...[truncated]' : ''}

Structure your storyboard with these sections:
1. Executive Summary
2. Key Themes & Findings
3. Detailed Insights by Topic
4. Barriers & Challenges
5. Opportunities & Recommendations

Return your response as a JSON object with this structure:
{
  "title": "Research Storyboard",
  "generatedAt": "${new Date().toISOString()}",
  "sections": [
    {
      "title": "section title",
      "content": "markdown formatted content with headers, bullets, and quotes in italics"
    }
  ]
}`;

  const response = await client.chat.completions.create({
    model: 'gpt-4o',
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt }
    ],
    temperature: 0.3,
    response_format: { type: 'json_object' }
  });

  const result = JSON.parse(response.choices[0].message.content);

  // Log cost
  if (response.usage) {
    await logCost(
      projectId,
      COST_CATEGORIES.STORYTELLING,
      'gpt-4o',
      response.usage.prompt_tokens,
      response.usage.completion_tokens,
      `Storyboard Generation (${detailLevel} detail, ${quoteLevel} quotes)`
    );
  }

  return result;
}

/**
 * Answer a custom question
 * @param {string} projectId - Project ID
 * @param {string} question - User's question
 * @param {string} transcriptsText - Combined transcript text
 * @param {string} caData - Content analysis data as JSON string
 * @param {object} existingFindings - Previously generated key findings (optional)
 * @param {string} detailLevel - straightforward/moderate/max
 * @param {string} quoteLevel - none/few/moderate/many
 * @returns {Promise<object>} - Answer with quotes and insights
 */
async function findAnalysisIdForProject(projectId) {
  try {
    const CAX_PATH = path.join(process.env.DATA_DIR || '/server/data', 'savedAnalyses.json');
    const caDataContent = await fs.readFile(CAX_PATH, 'utf8');
    const caData = JSON.parse(caDataContent);
    
    const analysis = caData.find(ca => ca.projectId === projectId);
    return analysis ? analysis.id : null;
  } catch (error) {
    console.error('Error finding analysis ID for project:', error);
    return null;
  }
}

async function generateQuotesForQuestion(analysisId, question, caDataObj) {
  try {
    console.log('🔍 Generating quotes on-demand for question:', question);
    
    // Extract quotes directly from the content analysis data
    const allQuotes = [];
    const questionLower = question.toLowerCase();
    
    // Look through all data sheets and find relevant quotes
    if (caDataObj.data) {
      for (const [sheetName, sheetData] of Object.entries(caDataObj.data)) {
        if (Array.isArray(sheetData)) {
          for (const row of sheetData) {
            if (row && typeof row === 'object') {
              const respondentId = row['Respondent ID'] || row['respno'] || row['ID'] || row['id'];
              if (respondentId && respondentId.trim() !== '' && respondentId.trim() !== 'Respondent ID') {
                // For each column in the row, extract relevant content as quotes
                for (const [columnName, cellValue] of Object.entries(row)) {
                  if (columnName !== 'Respondent ID' && columnName !== 'respno' && columnName !== 'ID' && columnName !== 'id' && 
                      typeof cellValue === 'string' && cellValue.trim() !== '') {
                    
                    // Check if this cell content might be relevant to the question
                    const cellLower = cellValue.toLowerCase();
                    const questionWords = questionLower.split(/\s+/).filter(word => word.length > 3);
                    const hasRelevantTerms = questionWords.some(word => cellLower.includes(word));
                    
                    if (hasRelevantTerms || questionWords.length === 0) {
                      // Clean and filter the cell content as a potential quote
                      const cleanedQuote = cleanQuoteText(cellValue);
                      if (cleanedQuote.length >= 50 && isQuoteRelevantToQuestion(cleanedQuote, question)) {
                        allQuotes.push(cleanedQuote);
                        console.log(`🔍 Added quote from ${respondentId} - ${columnName}: ${cleanedQuote.substring(0, 50)}...`);
                      }
                    }
                  }
                }
              }
            }
          }
        }
      }
    }
    
    // Remove duplicates and return up to 10 most relevant quotes
    const uniqueQuotes = [...new Set(allQuotes)];
    console.log(`🔍 Generated ${uniqueQuotes.length} quotes for question`);
    return uniqueQuotes.slice(0, 10);
  } catch (error) {
    console.error('Error generating quotes for question:', error);
    return [];
  }
}

export async function answerQuestion(projectId, question, transcriptsText, caDataObj, existingFindings = null, detailLevel = 'moderate', quoteLevel = 'moderate') {
  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

  // First try to extract existing verbatim quotes
  let realQuotes = extractVerbatimQuotes(caDataObj.verbatimQuotes || {}, question);
  console.log(`🔍 Found ${realQuotes.length} existing verbatim quotes for question: ${question}`);
  
  // If no quotes found and quoteLevel is not 'none', generate quotes on-demand
  if (realQuotes.length === 0 && quoteLevel !== 'none') {
    console.log('🔍 No existing quotes found, generating quotes on-demand for question:', question);
    
    // Find the analysis ID for this project
    const analysisId = await findAnalysisIdForProject(projectId);
    if (analysisId) {
      // Generate quotes for relevant cells
      realQuotes = await generateQuotesForQuestion(analysisId, question, caDataObj);
    }
  }
  
  let detailInstruction = 'Provide a moderate level of detail.';
  if (detailLevel === 'straightforward') {
    detailInstruction = 'Be concise and to the point.';
  } else if (detailLevel === 'max') {
    detailInstruction = 'Provide comprehensive detail and context.';
  }

  let quoteInstruction = 'Include a moderate number of supporting quotes.';
  if (quoteLevel === 'none') {
    quoteInstruction = 'Do not include quotes. Provide synthesized answer only.';
  } else if (quoteLevel === 'few') {
    quoteInstruction = 'Include just a few key quotes.';
  } else if (quoteLevel === 'many') {
    quoteInstruction = 'Include many supporting quotes to richly illustrate the answer.';
  }

  const systemPrompt = `You are a senior qualitative research analyst answering questions about research findings.

Guidelines:
- ${detailInstruction}
- Be clear, accurate, and evidence-based
- Note when data is insufficient to answer fully
- Provide actionable insights when possible
- Do NOT include quotes in your answer text - quotes will be provided separately
- Focus on analysis, insights, and findings without embedding quotes
- Base your analysis on the provided data but present it as clean analysis text`;

  let contextSection = '';
  if (existingFindings && existingFindings.findings) {
    contextSection = `\n\nPREVIOUSLY GENERATED KEY FINDINGS:\n${JSON.stringify(existingFindings.findings, null, 2)}`;
  }

  const quotesSection = realQuotes.length > 0 
    ? `\n\nRELEVANT VERBATIM QUOTES:\n${realQuotes.map((q, i) => `${i + 1}. "${q}"`).join('\n')}`
    : '';

  // Use only content analysis data, no transcripts
  const userPrompt = `Answer this question based on the research data:

QUESTION: ${question}

CONTENT ANALYSIS DATA:
${JSON.stringify(caDataObj.data, null, 2).substring(0, 30000)} ${JSON.stringify(caDataObj.data).length > 30000 ? '...[truncated]' : ''}${contextSection}${quotesSection}

Return your response as a JSON object with this structure:
{
  "question": "${question}",
  "answer": "your answer here",
  "quotes": ["supporting quote 1", "supporting quote 2"],
  "confidence": "high/medium/low",
  "note": "any caveats or additional context"
}`;

  const response = await client.chat.completions.create({
    model: 'gpt-4o',
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt }
    ],
    temperature: 0.3,
    response_format: { type: 'json_object' }
  });

  const result = JSON.parse(response.choices[0].message.content);

  // Always use the real verbatim quotes instead of AI-generated ones
  console.log(`🔍 Final quote processing:`, {
    realQuotesCount: realQuotes.length,
    quoteLevel,
    realQuotes: realQuotes.map(q => q.substring(0, 100) + '...')
  });
  
  if (realQuotes.length > 0 && quoteLevel !== 'none') {
    const maxQuotes = quoteLevel === 'few' ? 2 : quoteLevel === 'many' ? 8 : 4;
    result.quotes = realQuotes.slice(0, maxQuotes);
    console.log(`🔍 Final quotes for response:`, result.quotes.map(q => q.substring(0, 100) + '...'));
  } else if (quoteLevel !== 'none') {
    result.quotes = [];
  }

  // Log cost
  if (response.usage) {
    await logCost(
      projectId,
      COST_CATEGORIES.STORYTELLING,
      'gpt-4o',
      response.usage.prompt_tokens,
      response.usage.completion_tokens,
      `Q&A: ${question.substring(0, 50)}`
    );
  }

  return result;
}

export default {
  estimateStorytellingCost,
  generateKeyFindings,
  generateStoryboard,
  answerQuestion
};
