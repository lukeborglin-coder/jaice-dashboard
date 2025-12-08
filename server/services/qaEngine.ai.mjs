import OpenAI from 'openai';

/**
 * Initialize OpenAI client
 */
function getOpenAIClient() {
  if (!process.env.OPENAI_API_KEY || 
      process.env.OPENAI_API_KEY === 'your_openai_api_key_here' ||
      !process.env.OPENAI_API_KEY.startsWith('sk-')) {
    throw new Error('OPENAI_API_KEY is not configured. Please set it in your .env file.');
  }
  return new OpenAI({
    apiKey: process.env.OPENAI_API_KEY
  });
}

/**
 * Build AI prompt for quality checks
 * @param {Object} respondentData - Respondent's data
 * @param {Array} rules - Quality rules that require AI
 * @param {Array} questionnaireQuestions - Full questionnaire questions
 * @returns {string} Prompt text
 */
export function buildAIPrompt(respondentData, rules, questionnaireQuestions) {
  const promptParts = [];
  
  promptParts.push(`You are a data quality analyst. Review the following respondent's answers and identify quality issues based on the rules provided.`);
  promptParts.push('');
  promptParts.push('RESPONDENT DATA:');
  promptParts.push(`Respondent ID: ${respondentData.respno}`);
  promptParts.push('');
  
  // Add relevant questions and answers
  const relevantQuestions = [];
  rules.forEach((rule) => {
    const question = questionnaireQuestions.find(
      (q) => (q.number || q.id) === rule.questionId
    );
    if (question) {
      relevantQuestions.push({
        rule,
        question
      });
    }
  });
  
  promptParts.push('QUESTIONS AND ANSWERS:');
  relevantQuestions.forEach(({ rule, question }) => {
    promptParts.push(`Question ${rule.questionNumber}: ${question.text}`);
    promptParts.push(`Type: ${question.type}`);
    
    // Get answer(s) for this question
    const questionColumns = Object.keys(respondentData.columns || {}).filter((col) => {
      const colLower = col.toLowerCase();
      const qIdLower = String(rule.questionId).toLowerCase().replace(/^q/, '');
      return colLower.includes(qIdLower);
    });
    
    if (questionColumns.length > 0) {
      const answers = questionColumns
        .map((col) => {
          const val = respondentData.columns[col];
          return val !== null && val !== undefined && val !== '' ? String(val) : null;
        })
        .filter((v) => v !== null);
      
      if (answers.length > 0) {
        promptParts.push(`Answer(s): ${answers.join(', ')}`);
      } else {
        promptParts.push('Answer: [No response]');
      }
    } else {
      promptParts.push('Answer: [Not found in data]');
    }
    promptParts.push('');
  });
  
  promptParts.push('QUALITY CHECK RULES:');
  rules.forEach((rule) => {
    promptParts.push(`Rule: ${rule.checkTypeId}`);
    promptParts.push(`Question: ${rule.questionNumber} - ${rule.questionText}`);
    
    if (rule.checkTypeId === 'open_end') {
      promptParts.push('Check for:');
      promptParts.push('- Very short answers (1-2 words)');
      promptParts.push('- Gibberish or nonsensical text');
      promptParts.push('- Duplicate answers across multiple open-ended questions');
      promptParts.push(`Settings: minLength=${rule.settings.minLengthForFlag || 2}, maxGibberish=${rule.settings.maxGibberishScore || 0.7}`);
    } else if (rule.checkTypeId === 'logic_consistency') {
      promptParts.push('Check for logical consistency:');
      if (rule.settings.description) {
        promptParts.push(`Expected: ${rule.settings.description}`);
      }
      if (rule.relatedQuestionIds && rule.relatedQuestionIds.length > 1) {
        promptParts.push(`Related questions: ${rule.relatedQuestionIds.join(', ')}`);
      }
    } else if (rule.checkTypeId === 'custom') {
      promptParts.push(`Custom instruction: ${rule.settings.instruction || rule.customInstruction || 'N/A'}`);
    }
    promptParts.push('');
  });
  
  promptParts.push('INSTRUCTIONS:');
  promptParts.push('Review the respondent\'s answers and identify any quality issues based on the rules above.');
  promptParts.push('Return a JSON object with this structure:');
  promptParts.push(JSON.stringify({
    flags: [
      {
        ruleId: 'rule_id',
        checkTypeId: 'open_end',
        severity: 'minor' | 'moderate' | 'major',
        weight: 5,
        message: 'Human-readable description of the issue'
      }
    ]
  }, null, 2));
  promptParts.push('');
  promptParts.push('Return ONLY valid JSON. Do not include any explanatory text outside the JSON object.');
  
  return promptParts.join('\n');
}

/**
 * Call OpenAI API for quality checks
 * @param {string} prompt - Prompt text
 * @param {string} respondentId - Respondent ID for logging
 * @returns {Promise<Object>} Parsed AI response
 */
export async function callAIChecks(prompt, respondentId) {
  const client = getOpenAIClient();
  
  try {
    const response = await client.chat.completions.create({
      model: 'gpt-4o',
      temperature: 0.1,
      messages: [
        {
          role: 'system',
          content: 'You are a data quality analyst. Analyze respondent answers and identify quality issues. Return only valid JSON.'
        },
        {
          role: 'user',
          content: prompt
        }
      ],
      response_format: { type: 'json_object' },
      max_tokens: 4096
    });
    
    const content = response.choices[0].message.content;
    if (!content) {
      throw new Error('Empty response from AI');
    }
    
    return JSON.parse(content);
  } catch (error) {
    console.error(`[AI Check Error] Respondent ${respondentId}:`, error.message);
    throw error;
  }
}

/**
 * Parse AI response into flags
 * @param {Object} aiResponse - AI response object
 * @returns {Array} Array of flag objects
 */
export function parseAIResponse(aiResponse) {
  if (!aiResponse || !aiResponse.flags || !Array.isArray(aiResponse.flags)) {
    return [];
  }
  
  return aiResponse.flags.map((flag) => ({
    ruleId: flag.ruleId,
    checkTypeId: flag.checkTypeId,
    severity: flag.severity || 'minor',
    weight: flag.weight || 5,
    message: flag.message || 'Quality issue detected',
    rawDataSnippet: flag.rawDataSnippet || {}
  }));
}

/**
 * Check open-end questions using AI
 * @param {Object} respondentData - Respondent's data
 * @param {Object} rule - Quality rule
 * @param {Object} settings - Rule settings + global aggressiveness
 * @param {Array} questionnaireQuestions - Full questionnaire
 * @returns {Promise<Array>} Array of flags
 */
export async function checkOpenEnd(respondentData, rule, settings, questionnaireQuestions) {
  try {
    const prompt = buildAIPrompt(respondentData, [rule], questionnaireQuestions);
    const aiResponse = await callAIChecks(prompt, respondentData.respno);
    return parseAIResponse(aiResponse);
  } catch (error) {
    console.error(`[Open-End Check Error] Rule ${rule.id}:`, error.message);
    return []; // Return empty array on error
  }
}

/**
 * Check logic consistency using AI
 * @param {Object} respondentData - Respondent's data
 * @param {Object} rule - Quality rule
 * @param {Object} settings - Rule settings + global aggressiveness
 * @param {Array} questionnaireQuestions - Full questionnaire
 * @returns {Promise<Array>} Array of flags
 */
export async function checkLogicConsistency(respondentData, rule, settings, questionnaireQuestions) {
  try {
    const prompt = buildAIPrompt(respondentData, [rule], questionnaireQuestions);
    const aiResponse = await callAIChecks(prompt, respondentData.respno);
    return parseAIResponse(aiResponse);
  } catch (error) {
    console.error(`[Logic Consistency Check Error] Rule ${rule.id}:`, error.message);
    return []; // Return empty array on error
  }
}

/**
 * Check custom rules using AI
 * @param {Object} respondentData - Respondent's data
 * @param {Object} rule - Quality rule
 * @param {Object} settings - Rule settings + global aggressiveness
 * @param {Array} questionnaireQuestions - Full questionnaire
 * @returns {Promise<Array>} Array of flags
 */
export async function checkCustom(respondentData, rule, settings, questionnaireQuestions) {
  try {
    const prompt = buildAIPrompt(respondentData, [rule], questionnaireQuestions);
    const aiResponse = await callAIChecks(prompt, respondentData.respno);
    return parseAIResponse(aiResponse);
  } catch (error) {
    console.error(`[Custom Check Error] Rule ${rule.id}:`, error.message);
    return []; // Return empty array on error
  }
}

