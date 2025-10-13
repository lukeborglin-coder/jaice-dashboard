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
export async function generateKeyFindings(projectId, strategicQuestions, transcriptsText, caDataObj, detailLevel = 'moderate') {
  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

  // Use same detail level system as Ask a Question
  let detailInstruction = 'Provide a moderate level of detail.';
  if (detailLevel === 'straightforward') {
    detailInstruction = 'Be concise and to the point.';
  } else if (detailLevel === 'max') {
    detailInstruction = 'Provide comprehensive detail and context.';
  }

  const systemPrompt = `You are a senior qualitative research analyst specializing in healthcare and pharmaceutical market research.

Your task is to analyze transcripts and content analysis data to answer strategic research questions.

Guidelines:
- ${detailInstruction}
- Be clear, accurate, and evidence-based
- Focus on the "why" and "so what" - surface insights, not just observations
- Identify patterns, themes, and contradictions
- Highlight surprising or unexpected findings
- Present findings as clear analysis without including direct quotes
- Base your analysis on the provided data and present it as clean analysis text
- Synthesize findings into clear, actionable insights`;

  const userPrompt = `Analyze the following research data and answer each strategic question.

STRATEGIC QUESTIONS:
${strategicQuestions.map((q, i) => `${i + 1}. ${q}`).join('\n')}

TRANSCRIPT DATA:
${transcriptsText.substring(0, 50000)} ${transcriptsText.length > 50000 ? '...[truncated]' : ''}

CONTENT ANALYSIS DATA:
${JSON.stringify(caDataObj.data, null, 2).substring(0, 20000)} ${JSON.stringify(caDataObj.data).length > 20000 ? '...[truncated]' : ''}

For each question, provide:
1. A clear, comprehensive answer with analysis and findings
2. Key insight or recommendation

Return your response as a JSON object with this structure:
{
  "findings": [
    {
      "question": "the question text",
      "answer": "your synthesized analysis and findings here",
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

  let quoteInstruction = 'Focus on synthesized findings and analysis without including direct quotes.';
  if (quoteLevel === 'none') {
    quoteInstruction = 'Focus on synthesized findings only without any quotes.';
  } else if (quoteLevel === 'few') {
    quoteInstruction = 'Focus on synthesized findings with minimal illustrative examples.';
  } else if (quoteLevel === 'many') {
    quoteInstruction = 'Focus on comprehensive synthesized findings with detailed analysis.';
  }

  const systemPrompt = `You are a senior qualitative research analyst creating a professional research storyboard.

A storyboard organizes qualitative findings into a narrative that tells the story of the research.

Style Guidelines:
- ${detailInstruction}
- ${quoteInstruction}
- Use clear headers and bullet points
- Present findings in a logical narrative flow
- Highlight key themes, patterns, and insights
- Note contradictions and nuances
- Focus on analysis and synthesis rather than direct quotes`;

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
      "content": "markdown formatted content with headers, bullets, and analysis"
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


export async function answerQuestion(projectId, question, transcriptsText, caDataObj, existingFindings = null, detailLevel = 'moderate', quoteLevel = 'moderate') {
  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  
  let detailInstruction = 'Provide a moderate level of detail.';
  if (detailLevel === 'straightforward') {
    detailInstruction = 'Be concise and to the point.';
  } else if (detailLevel === 'max') {
    detailInstruction = 'Provide comprehensive detail and context.';
  }

  let quoteInstruction = 'Focus on synthesized analysis and findings without including direct quotes.';
  if (quoteLevel === 'none') {
    quoteInstruction = 'Provide synthesized answer only without any quotes.';
  } else if (quoteLevel === 'few') {
    quoteInstruction = 'Focus on synthesized analysis with minimal illustrative examples.';
  } else if (quoteLevel === 'many') {
    quoteInstruction = 'Provide comprehensive synthesized analysis with detailed findings.';
  }

  const systemPrompt = `You are a senior qualitative research analyst answering questions about research findings.

Guidelines:
- ${detailInstruction}
- Be clear, accurate, and evidence-based
- Note when data is insufficient to answer fully
- Provide actionable insights when possible
- Focus on analysis, insights, and findings without including direct quotes
- Base your analysis on the provided data and present it as clean analysis text
- Synthesize findings into clear, actionable insights`;

  let contextSection = '';
  if (existingFindings && existingFindings.findings) {
    contextSection = `\n\nPREVIOUSLY GENERATED KEY FINDINGS:\n${JSON.stringify(existingFindings.findings, null, 2)}`;
  }

  // Use only content analysis data, no transcripts
  const userPrompt = `Answer this question based on the research data:

QUESTION: ${question}

CONTENT ANALYSIS DATA:
${JSON.stringify(caDataObj.data, null, 2).substring(0, 30000)} ${JSON.stringify(caDataObj.data).length > 30000 ? '...[truncated]' : ''}${contextSection}

Return your response as a JSON object with this structure:
{
  "question": "${question}",
  "answer": "your synthesized analysis and findings here",
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
