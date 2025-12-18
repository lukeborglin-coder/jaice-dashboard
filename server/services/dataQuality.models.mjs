/**
 * Data Quality Module - Data Models
 * 
 * These are TypeScript-like structures documented as JSDoc comments
 * for reference. The actual implementation uses plain JavaScript objects.
 */

/**
 * @typedef {Object} QualityCheckType
 * @property {string} id - Unique identifier (e.g., "open_end", "straightlining", "speeding", "logic_consistency", "custom")
 * @property {string} label - Display label for UI
 * @property {string} description - What this check does
 * @property {string[]} supportedQuestionTypes - Question types this check applies to (e.g., ["open_end"], ["grid", "scale"])
 * @property {number} defaultAggressiveness - Default aggressiveness (0-100)
 * @property {Object} [settingsSchema] - Optional JSON schema describing custom parameters
 */

/**
 * @typedef {Object} QualityRule
 * @property {string} id - Unique rule identifier
 * @property {string} questionId - Internal questionnaire ID (e.g., "A2")
 * @property {string} questionNumber - Question number for UI (e.g., "A2")
 * @property {string} questionText - Full question text
 * @property {string} questionType - Question type (single, multi, grid, open-end, etc.)
 * @property {string} checkTypeId - Type of check (e.g., "open_end", "straightlining", "custom")
 * @property {Object} settings - Per-rule JSON settings (thresholds, min rows, etc.)
 * @property {boolean} enabled - Whether this rule is active
 * @property {string} [customInstruction] - For custom rules, the natural language instruction
 * @property {string[]} [relatedQuestionIds] - For logic_consistency, the question IDs involved
 */

/**
 * @typedef {Object} QualityPlan
 * @property {string} projectId - Project ID
 * @property {QualityRule[]} rules - List of quality rules
 * @property {Object} globalAggressiveness - Global aggressiveness sliders (0-100)
 * @property {number} globalAggressiveness.openEndAggressiveness
 * @property {number} globalAggressiveness.straightliningAggressiveness
 * @property {number} globalAggressiveness.speedingAggressiveness
 * @property {number} globalAggressiveness.logicAggressiveness
 * @property {number} [expectedLOI] - Expected Length of Interview in minutes (from questionnaire)
 * @property {string} createdAt - ISO timestamp
 * @property {string} updatedAt - ISO timestamp
 * @property {string} [lastGeneratedFromQuestionnaireAt] - When plan was last auto-generated
 */

/**
 * @typedef {Object} QAFlag
 * @property {string} ruleId - Link to QualityRule
 * @property {string} checkTypeId - Type of check that produced this flag
 * @property {string} severity - "minor" | "moderate" | "major"
 * @property {number} weight - Numeric weight for scoring
 * @property {string} message - Human-readable description
 * @property {Object} [rawDataSnippet] - Optional snapshot of values that triggered the flag
 */

/**
 * @typedef {Object} RespondentQAStatus
 * @property {string} projectId - Project ID
 * @property {string} respno - Respondent ID
 * @property {QAFlag[]} flags - Array of flags/issues found
 * @property {number} score - Overall quality score (0-100)
 * @property {string} category - "good" | "questionable" | "remove"
 * @property {boolean} statusLocked - If manually overridden
 * @property {string} createdAt - ISO timestamp
 * @property {string} updatedAt - ISO timestamp
 */

/**
 * @typedef {Object} QADataRow
 * @property {string} respno - Respondent ID
 * @property {Object} columns - Column values (only columns needed for Quality Plan)
 */

/**
 * Predefined check types
 */
export const QUALITY_CHECK_TYPES = [
  {
    id: 'open_end',
    label: 'Open-End Quality',
    description: 'Checks for very short answers, gibberish, or duplicate responses across open-ended questions',
    supportedQuestionTypes: ['Open End', 'Open End List'],
    defaultAggressiveness: 50,
    settingsSchema: {
      minLengthForFlag: { type: 'number', default: 2, min: 1, max: 10 },
      maxGibberishScore: { type: 'number', default: 0.7, min: 0, max: 1 },
      maxSimilarityAcrossOEs: { type: 'number', default: 0.8, min: 0, max: 1 }
    }
  },
  {
    id: 'straightlining',
    label: 'Straight-Lining',
    description: 'Detects when respondents select the same value for multiple items in a grid/scale',
    supportedQuestionTypes: ['Single Select Grid', 'Numeric Grid'],
    defaultAggressiveness: 50,
    settingsSchema: {
      minGridItems: { type: 'number', default: 3, min: 2, max: 20 },
      straightlineThresholdPercent: { type: 'number', default: 80, min: 50, max: 100 }
    }
  },
  {
    id: 'speeding',
    label: 'Speeding',
    description: 'Uses qtime column to identify respondents who completed faster than expected LOI',
    supportedQuestionTypes: ['*'], // Global check - applies to all respondents
    defaultAggressiveness: 50,
    settingsSchema: {
      speedingThresholdPercent: { type: 'number', default: 50, min: 20, max: 80 } // % of expected LOI to flag
    }
  },
  {
    id: 'logic_consistency',
    label: 'Logic Consistency',
    description: 'Checks for logical inconsistencies between related questions',
    supportedQuestionTypes: ['*'], // Applies to all question types
    defaultAggressiveness: 50,
    settingsSchema: {
      description: { type: 'string', default: '' } // Natural language description of expected consistency
    }
  },
  {
    id: 'custom',
    label: 'Custom Rule',
    description: 'User-defined quality check rule',
    supportedQuestionTypes: ['*'], // Applies to all question types
    defaultAggressiveness: 50,
    settingsSchema: {
      instruction: { type: 'string', default: '' } // Natural language instruction
    }
  }
];

/**
 * Get a check type by ID
 */
export function getCheckTypeById(id) {
  return QUALITY_CHECK_TYPES.find((ct) => ct.id === id);
}

/**
 * Get check types that support a question type
 */
export function getCheckTypesForQuestionType(questionType) {
  return QUALITY_CHECK_TYPES.filter((ct) => {
    if (ct.supportedQuestionTypes.includes('*')) {
      return true;
    }
    return ct.supportedQuestionTypes.some((supported) =>
      questionType?.toLowerCase().includes(supported.toLowerCase())
    );
  });
}

/**
 * Create default quality plan
 */
export function createDefaultQualityPlan(projectId) {
  return {
    projectId,
    rules: [],
    globalAggressiveness: {
      openEndAggressiveness: 50,
      straightliningAggressiveness: 50,
      speedingAggressiveness: 50,
      logicAggressiveness: 50
    },
    expectedLOI: null, // Expected Length of Interview in minutes (set from questionnaire)
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
}

/**
 * Create default quality rule
 */
export function createDefaultQualityRule(question, checkTypeId) {
  const checkType = getCheckTypeById(checkTypeId);
  const defaultSettings = {};
  
  if (checkType?.settingsSchema) {
    Object.entries(checkType.settingsSchema).forEach(([key, schema]) => {
      if (schema.default !== undefined) {
        defaultSettings[key] = schema.default;
      }
    });
  }

  return {
    id: `${question.number || question.id}_${checkTypeId}_${Date.now()}`,
    questionId: question.number || question.id,
    questionNumber: question.number || question.id,
    questionText: question.text || '',
    questionType: question.type || '',
    checkTypeId,
    settings: defaultSettings,
    enabled: true
  };
}




