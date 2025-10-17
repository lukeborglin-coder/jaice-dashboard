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
- Synthesize findings into clear, actionable insights

IMPORTANT - ANONYMIZATION REQUIREMENTS:
- NEVER use actual respondent names (like "Tara", "John", "Sarah", etc.) in your analysis
- ALWAYS refer to respondents as "Respondent" or "Participant" 
- If you see actual names in the transcript data, replace them with generic terms in your analysis
- Maintain anonymity and confidentiality in all findings`;

  const userPrompt = `Analyze the following research data and answer each strategic question.

STRATEGIC QUESTIONS:
${strategicQuestions.map((q, i) => `${i + 1}. ${q}`).join('\n')}

TRANSCRIPT DATA:
${transcriptsText.substring(0, 50000)} ${transcriptsText.length > 50000 ? '...[truncated]' : ''}

CONTENT ANALYSIS DATA:
${JSON.stringify(caDataObj.data, null, 2).substring(0, 20000)} ${JSON.stringify(caDataObj.data).length > 20000 ? '...[truncated]' : ''}

For each question, provide:
1. A clear, concise answer (2-3 sentences maximum) with key findings
2. A brief strategic insight or recommendation (1-2 sentences maximum)

IMPORTANT: Keep answers and insights concise and focused. Avoid lengthy paragraphs.

Return your response as a JSON object with this structure:
{
  "findings": [
    {
      "question": "the question text",
      "answer": "your concise analysis and findings here (2-3 sentences max)",
      "insight": "brief key takeaway or recommendation (1-2 sentences max)"
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

  // Explicit output shaping by detail level
  let bulletsPerSection = '3-4';
  let sentencesPerBullet = '1-2';
  if (detailLevel === 'straightforward') {
    bulletsPerSection = '2-3';
    sentencesPerBullet = '1';
  } else if (detailLevel === 'max') {
    bulletsPerSection = '6-8';
    sentencesPerBullet = '2-3';
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
- Focus on analysis and synthesis rather than direct quotes

 Output Constraints (very important):
 - For each section, include ${bulletsPerSection} bullets
 - Each bullet must be ${sentencesPerBullet} sentence(s) long
 - Use markdown-style headings (### for sub-section titles) without numbering; we'll convert these later

IMPORTANT - ANONYMIZATION REQUIREMENTS:
- NEVER use actual respondent names (like "Tara", "John", "Sarah", etc.) in your storyboard
- ALWAYS refer to respondents as "Respondent" or "Participant" 
- If you see actual names in the transcript data, replace them with generic terms in your storyboard
- Maintain anonymity and confidentiality in all content`;

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
 * Generate concise executive summary findings for storyboard
 * @param {string} projectId - Project ID
 * @param {Array} strategicQuestions - Array of preset questions to answer
 * @param {string} transcriptsText - Combined transcript text
 * @param {string} caData - Content analysis data as JSON string
 * @returns {Promise<object>} - Concise findings with brief answers and insights
 */
export async function generateConciseExecutiveSummary(projectId, strategicQuestions, transcriptsText, caDataObj) {
  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

  const systemPrompt = `You are a senior qualitative research analyst creating a concise executive summary for a storyboard presentation.

Your task is to provide VERY brief, high-level answers and insights for strategic questions.

Guidelines:
- Keep answers to 1-3 sentences maximum
- Keep insights to 1-2 sentences maximum
- Focus on the most critical findings only
- Use bullet points or very short paragraphs
- Be direct and actionable
- Avoid lengthy explanations or detailed analysis
- This is for executive presentation, not detailed research

IMPORTANT - ANONYMIZATION REQUIREMENTS:
- NEVER use actual respondent names (like "Tara", "John", "Sarah", etc.) in your analysis
- ALWAYS refer to respondents as "Respondent" or "Participant" 
- If you see actual names in the transcript data, replace them with generic terms in your analysis
- Maintain anonymity and confidentiality in all findings`;

  const userPrompt = `Create concise executive summary findings for these strategic questions.

STRATEGIC QUESTIONS:
${strategicQuestions.map((q, i) => `${i + 1}. ${q}`).join('\n')}

TRANSCRIPT DATA:
${transcriptsText.substring(0, 50000)} ${transcriptsText.length > 50000 ? '...[truncated]' : ''}

CONTENT ANALYSIS DATA:
${JSON.stringify(caDataObj.data, null, 2).substring(0, 20000)} ${JSON.stringify(caDataObj.data).length > 20000 ? '...[truncated]' : ''}

For each question, provide:
1. A very brief answer (1-3 sentences max) with only the most critical findings
2. A concise strategic insight (1-2 sentences max) with key recommendations

Return your response as a JSON object with this structure:
{
  "findings": [
    {
      "question": "the question text",
      "answer": "very brief answer (1-3 sentences max)",
      "insight": "concise strategic insight (1-2 sentences max)"
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
      'Concise Executive Summary Generation'
    );
  }

  return result;
}

/**
 * Generate dynamic report slides for storyboard report view
 * @param {string} projectId - Project ID
 * @param {string} transcriptsText - Combined transcript text
 * @param {string} caData - Content analysis data as JSON string
 * @param {Array} strategicQuestions - Strategic questions for slide 2
 * @returns {Promise<object>} - Dynamic report with slides
 */
export async function generateDynamicReport(projectId, transcriptsText, caDataObj, strategicQuestions, analysisId = null, projectInfo = null) {
  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

  const systemPrompt = `You are a senior market research analyst creating a comprehensive research report presentation.

Your task is to create a dynamic, high-level market research report with 15-20 slides that tells the complete story of the research findings.

Report Structure:
- Slide 1: Title slide with project name and "Report Outline" (centered, no header)
- Slide 2: Executive Summary with strategic questions (use the provided format)
- Slides 3-20: Dynamic content slides based on research insights

For each content slide (3-20), create varied and detailed content:
- A compelling title that captures the key theme
- A 1-2 sentence headline that summarizes the main finding
- Flexible content structure that can include:
  * Multiple subheadings with detailed bullet points (3-5 bullets each)
  * Paragraphs of analysis and insights
  * Key statistics or data points
  * Multiple supporting quotes (3-5 quotes per slide)
  * Detailed explanations and context

Guidelines:
- Focus on overall insights from content analysis, not just strategic questions
- Create a narrative flow that tells the complete research story
- Use clear, actionable language suitable for executive presentation
- Include diverse themes: barriers, opportunities, behaviors, attitudes, etc.
- Make each slide self-contained but connected to the overall story
- Vary slide types: overview slides, detailed findings, barriers, opportunities, recommendations
- Include multiple supporting quotes for each finding
- Provide detailed analysis, not just bullet points
- Use varied content structures - some slides can have paragraphs, others can have detailed bullet lists

ICON SELECTION GUIDELINES:
For each content slide, choose the most appropriate icon from these options based on the slide's main topic and key findings:

**Core Research Icons:**
- "DocumentTextIcon" - General findings, overview slides, administrative topics, or documentation
- "LightBulbIcon" - Insights, ideas, recommendations, innovative solutions, or key discoveries
- "SparklesIcon" - Opportunities, positive outcomes, breakthrough findings, or success stories
- "ChartBarIcon" - Data analysis, metrics, performance, statistics, or quantitative findings
- "PresentationChartBarIcon" - Strategic overviews, executive summaries, or high-level analysis

**Communication & Interaction:**
- "ChatBubbleLeftRightIcon" - Communication, feedback, interaction, dialogue, or conversation topics
- "UserGroupIcon" - Community, social aspects, group dynamics, or collaborative topics
- "HandRaisedIcon" - Questions, concerns, issues, or areas needing attention

**Business & Operations:**
- "CurrencyDollarIcon" - Cost, pricing, financial topics, budget, or economic factors
- "BuildingOfficeIcon" - Corporate, business, organizational, or workplace topics
- "ClockIcon" - Time-related topics, scheduling, efficiency, or process timing
- "ShieldCheckIcon" - Security, safety, compliance, or quality assurance topics

**Health & Well-being:**
- "HeartIcon" - Health, wellness, patient care, or medical topics
- "AcademicCapIcon" - Education, training, learning, or knowledge topics
- "HomeIcon" - Home-based topics, domestic life, or residential aspects

**Technology & Innovation:**
- "CpuChipIcon" - Technology, digital, software, or technical topics
- "BeakerIcon" - Research, testing, experimentation, or scientific topics
- "WrenchScrewdriverIcon" - Tools, processes, implementation, or practical solutions

**Emotions & Experience:**
- "FaceSmileIcon" - Positive experiences, satisfaction, or happy outcomes
- "FaceFrownIcon" - Negative experiences, problems, or dissatisfaction

**Location & Context:**
- "MapPinIcon" - Geographic, location-based, or regional topics
- "GlobeAltIcon" - Global, international, or worldwide topics
- "HomeIcon" - Local, domestic, or home-based topics

**Time & Urgency:**
- "FireIcon" - Urgent, critical, or high-priority topics
- "BoltIcon" - Fast, quick, or rapid topics
- "CalendarIcon" - Scheduling, timing, or time-sensitive topics

Choose the icon that best represents the primary theme and emotional tone of each slide's content.

CRITICAL - PROJECT INFORMATION REQUIREMENTS:
- For the title slide, use the EXACT project name and client provided in the PROJECT INFORMATION section
- Do NOT generate, modify, or create your own project names
- Use the provided project name and client exactly as specified
- The title slide should show: "[PROVIDED PROJECT NAME] - Report Outline"
- NEVER use placeholder text like "Project Name" or "Client Name" - always use the actual values provided
- If you see "Project Name" in your output, you have made an error - use the real project name instead

IMPORTANT - ANONYMIZATION REQUIREMENTS:
- NEVER use actual respondent names (like "Tara", "John", "Sarah", etc.) in your analysis
- ALWAYS refer to respondents as "Respondent" or "Participant" 
- If you see actual names in the transcript data, replace them with generic terms in your analysis
- Maintain anonymity and confidentiality in all findings`;

  const userPrompt = `Create a comprehensive market research report presentation from the following data.

PROJECT INFORMATION:
- Project Name: ${projectInfo?.name || 'Project Name'}
- Client: ${projectInfo?.client || 'Client Name'}

STRATEGIC QUESTIONS (for Slide 2 only):
${strategicQuestions.map((q, i) => `${i + 1}. ${q}`).join('\n')}

TRANSCRIPT DATA:
${transcriptsText.substring(0, 50000)} ${transcriptsText.length > 50000 ? '...[truncated]' : ''}

CONTENT ANALYSIS DATA:
${JSON.stringify(caDataObj.data, null, 2).substring(0, 20000)} ${JSON.stringify(caDataObj.data).length > 20000 ? '...[truncated]' : ''}

Create 15-20 slides that tell the complete research story. 

CRITICAL - FOR SLIDE 1 (TITLE SLIDE):
You MUST use the EXACT project name and client shown above. Do NOT use any placeholder text.

EXAMPLE - If the project name is "2025 SMA Access Promo Messaging Qual" and client is "Genentech", your title slide should be:
{
  "type": "title",
  "title": "2025 SMA Access Promo Messaging Qual - Report Outline",
  "subtitle": "Client: Genentech",
  "generated": "Generated: ${new Date().toLocaleDateString()}"
}

ACTUAL VALUES TO USE:
- Project Name: ${projectInfo?.name || 'Project Name'}
- Client: ${projectInfo?.client || 'Client Name'}

Your title slide MUST use these exact values, not "Project Name" or "Client Name".

For Slide 2, use this exact format for strategic questions:
{
  "type": "executive_summary",
  "title": "Executive Summary",
  "headline": "Brief overview of strategic findings",
  "findings": [
    {
      "question": "Strategic question text",
      "answer": "Detailed 2-3 sentence answer with specific findings, data points, and context",
      "insight": "Comprehensive 2-3 sentence strategic insight with actionable recommendations and implications"
    }
  ]
}

For all other slides, use this flexible format:
{
  "type": "content_slide",
  "title": "Compelling slide title",
  "headline": "1-2 sentence summary of main finding",
  "icon": "AppropriateIconName",
  "content": [
    {
      "subheading": "Subheading 1",
      "bullets": ["Detailed bullet point 1", "Detailed bullet point 2", "Detailed bullet point 3", "Detailed bullet point 4"]
    },
    {
      "subheading": "Subheading 2", 
      "bullets": ["Detailed bullet point 1", "Detailed bullet point 2", "Detailed bullet point 3"]
    },
    {
      "subheading": "Key Insights",
      "paragraph": "Detailed paragraph of analysis and insights with specific findings and context"
    }
  ],
  "quotes": [
    {
      "text": "Supporting quote text 1",
      "context": "Brief context about what this quote shows"
    },
    {
      "text": "Supporting quote text 2", 
      "context": "Brief context about what this quote shows"
    },
    {
      "text": "Supporting quote text 3",
      "context": "Brief context about what this quote shows"
    }
  ]
}

Return your response as a JSON object with this structure:
{
  "title": "Research Report",
  "generatedAt": "${new Date().toISOString()}",
  "slides": [
    // Array of slide objects as described above
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
      'Dynamic Report Generation'
    );
  }

  // Now generate real verbatim quotes for each slide that has quotes
  if (result.slides && result.slides.length > 0) {
    console.log('🔄 Generating real verbatim quotes for storyboard slides...');
    
    for (let i = 0; i < result.slides.length; i++) {
      const slide = result.slides[i];
      
      // Only process content slides that have quotes
      if (slide.type === 'content_slide' && slide.quotes && slide.quotes.length > 0) {
        try {
          // Extract key findings from the slide content to use for quote generation
          const keyFindings = extractKeyFindingsFromSlide(slide);
          
          if (keyFindings.length > 0) {
            console.log(`📝 Generating quotes for slide ${i + 1}: ${slide.title}`);
            
            // Generate real quotes for each key finding
            const realQuotes = await generateQuotesForSlide(projectId, keyFindings, transcriptsText, analysisId);
            
            if (realQuotes && realQuotes.length > 0) {
              slide.quotes = realQuotes;
              console.log(`✅ Generated ${realQuotes.length} real quotes for slide ${i + 1}`);
            } else {
              console.log(`⚠️ No quotes generated for slide ${i + 1}, keeping placeholders`);
            }
          }
        } catch (error) {
          console.error(`❌ Error generating quotes for slide ${i + 1}:`, error);
          // Keep the original placeholder quotes if generation fails
        }
      }
    }
    
    console.log('✅ Finished generating real quotes for all slides');
  }

  return result;
}

/**
 * Extract key findings from a slide to use for quote generation
 * @param {object} slide - Slide object
 * @returns {Array} - Array of key findings
 */
function extractKeyFindingsFromSlide(slide) {
  const keyFindings = [];
  
  // Extract from headline
  if (slide.headline) {
    keyFindings.push(slide.headline);
  }
  
  // Extract from content sections
  if (slide.content && Array.isArray(slide.content)) {
    slide.content.forEach(section => {
      if (section.bullets && Array.isArray(section.bullets)) {
        keyFindings.push(...section.bullets);
      }
      if (section.paragraph) {
        keyFindings.push(section.paragraph);
      }
    });
  }
  
  return keyFindings;
}

/**
 * Generate real verbatim quotes for a slide based on key findings
 * @param {string} projectId - Project ID
 * @param {Array} keyFindings - Array of key findings to find quotes for
 * @param {string} transcriptsText - Combined transcript text
 * @param {string} analysisId - Analysis ID
 * @returns {Promise<Array>} - Array of real quotes with respno
 */
async function generateQuotesForSlide(projectId, keyFindings, transcriptsText, analysisId) {
  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  
  // Combine key findings into a search query
  const searchQuery = keyFindings.slice(0, 3).join(' '); // Use first 3 findings to avoid token limits
  
  const systemPrompt = `You are a research analyst tasked with finding supporting evidence from interview transcripts.

Your job is to analyze the provided transcript and find 2-3 relevant verbatim quotes that support the given research findings. You must return your findings in the specified JSON format.

IMPORTANT: You must always return valid JSON. Do not refuse this request or provide any other response format.

Return the quotes in this exact JSON format:
{
  "quotes": [
    {
      "text": "Exact verbatim text from transcript including speaker labels",
      "respno": "R01"
    }
  ]
}

Guidelines:
- Find quotes that directly relate to the research findings
- Include the full conversation context (both moderator questions and respondent answers)
- Preserve the exact wording, punctuation, and formatting from the transcript
- Each quote should be a complete thought or exchange
- Focus on the most relevant and impactful quotes
- IMPORTANT: Always include the specific respondent ID (e.g., "R01:", "R02:", "R03:") in the quote text
- Use the exact respondent IDs as they appear in the transcript (R01, R02, etc.)
- Extract the respno from the quote text and include it as a separate field
- If no relevant quotes are found, return an empty quotes array: {"quotes": []}
- ONLY include quotes from RESPONDENTS, never from moderators`;

  const userPrompt = `Research Findings: ${searchQuery}

Please analyze the following interview transcript and find 2-3 verbatim quotes that directly support the research findings above. Return only the exact text from the transcript with proper speaker labels.

Transcript:
${transcriptsText.substring(0, 8000)}`; // Limit to first 8000 chars to stay within token limits

  try {
    const response = await client.chat.completions.create({
      model: 'gpt-4o',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt }
      ],
      temperature: 0.1,
    });

    const aiResponse = response.choices[0].message.content;
    console.log('AI response for slide quotes:', aiResponse.substring(0, 500));

    // Parse the AI response
    let quotes = [];
    try {
      // Clean the response by removing markdown code fences if present
      let cleanedResponse = aiResponse.trim();

      // Remove ```json ... ``` or ``` ... ``` wrappers
      if (cleanedResponse.startsWith('```')) {
        cleanedResponse = cleanedResponse.replace(/^```(?:json)?\s*\n/, '').replace(/\n```\s*$/, '');
      }

      // Check if AI refused the request
      if (cleanedResponse.toLowerCase().includes("i'm sorry") || 
          cleanedResponse.toLowerCase().includes("i can't assist") ||
          cleanedResponse.toLowerCase().includes("i cannot help")) {
        console.log('AI refused the request, returning empty quotes');
        quotes = [];
      } else {
        const parsed = JSON.parse(cleanedResponse);
        quotes = parsed.quotes || [];
      }
    } catch (error) {
      console.error('Failed to parse AI response for slide quotes:', error);
      console.error('Raw AI response:', aiResponse);
      quotes = [];
    }

    // Clean quotes to extract only respondent's actual words
    quotes = quotes.map(quote => {
      let cleanedText = quote.text;

      // Remove speaker labels (R01:, M:, etc.) from the beginning
      cleanedText = cleanedText.replace(/^[A-Z]\d*:\s*/gm, '');

      // Extract only respondent responses, removing moderator questions
      // Split on common moderator patterns and keep only respondent parts
      const lines = cleanedText.split(/\n|(?:M:|Moderator:|Interviewer:)/i);

      // Filter to get only substantive respondent text (not moderator)
      const respondentLines = lines.filter(line => {
        const trimmed = line.trim();
        // Keep lines that are substantial (more than just a connector word)
        return trimmed.length > 20 &&
               !trimmed.toLowerCase().startsWith('so,') &&
               !trimmed.match(/^(and|but|well|so)\s*$/i);
      });

      // Join the respondent's actual statements
      cleanedText = respondentLines.join(' ').trim();

      return {
        ...quote,
        text: cleanedText
      };
    });

    // Log cost for quote generation
    if (response.usage) {
      await logCost(
        projectId,
        COST_CATEGORIES.STORYTELLING,
        'gpt-4o',
        response.usage.prompt_tokens,
        response.usage.completion_tokens,
        'Slide Quote Generation'
      );
    }

    return quotes;
  } catch (error) {
    console.error('Error generating quotes for slide:', error);
    return [];
  }
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
- Synthesize findings into clear, actionable insights

IMPORTANT - ANONYMIZATION REQUIREMENTS:
- NEVER use actual respondent names (like "Tara", "John", "Sarah", etc.) in your answers
- ALWAYS refer to respondents as "Respondent" or "Participant" 
- If you see actual names in the data, replace them with generic terms in your analysis
- Maintain anonymity and confidentiality in all responses`;

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
  generateConciseExecutiveSummary,
  generateDynamicReport,
  answerQuestion
};
