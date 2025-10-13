import OpenAI from 'openai';
import { logCost, COST_CATEGORIES } from './costTracking.service.mjs';

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

// Extract verbatim quotes from the verbatimQuotes structure (same as content analysis popups)
function extractVerbatimQuotes(verbatimQuotesData, question) {
  if (!verbatimQuotesData || typeof verbatimQuotesData !== 'object') return [];
  
  const allQuotes = [];
  const questionLower = question.toLowerCase();
  
  // Extract verbatim quotes from the same structure used by content analysis popups
  for (const [sheetName, sheetQuotes] of Object.entries(verbatimQuotesData)) {
    if (!sheetQuotes || typeof sheetQuotes !== 'object') continue;
    
    for (const [respondentId, respondentQuotes] of Object.entries(sheetQuotes)) {
      if (!respondentQuotes || typeof respondentQuotes !== 'object') continue;
      
      for (const [columnName, quoteData] of Object.entries(respondentQuotes)) {
        if (!quoteData || !Array.isArray(quoteData.quotes)) continue;
        
        // Filter quotes that might be relevant to the question
        for (const quote of quoteData.quotes) {
          if (quote && typeof quote.text === 'string' && quote.text.trim()) {
            const quoteLower = quote.text.toLowerCase();
            // Simple relevance check - look for key terms from the question
            const questionWords = questionLower.split(/\s+/).filter(word => word.length > 3);
            const hasRelevantTerms = questionWords.some(word => quoteLower.includes(word));
            
            if (hasRelevantTerms || questionWords.length === 0) {
              allQuotes.push(quote.text.trim());
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
export async function answerQuestion(projectId, question, transcriptsText, caDataObj, existingFindings = null, detailLevel = 'moderate', quoteLevel = 'moderate') {
  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

  // Extract real verbatim quotes from content analysis data (same as popups)
  const realQuotes = extractVerbatimQuotes(caDataObj.verbatimQuotes || {}, question);
  
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
- ${quoteInstruction}
- Be clear, accurate, and evidence-based
- Note when data is insufficient to answer fully
- Provide actionable insights when possible
- Use ONLY the provided verbatim quotes to support your answer
- Do not generate or paraphrase quotes - use only the exact quotes provided`;

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
  if (realQuotes.length > 0 && quoteLevel !== 'none') {
    result.quotes = realQuotes.slice(0, quoteLevel === 'few' ? 2 : quoteLevel === 'many' ? 8 : 4);
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
