/**
 * Deterministic QA Checks
 * Pure functions with no side effects
 */

/**
 * Check for straight-lining in grid questions
 * @param {Object} respondentData - Respondent's data (columns object)
 * @param {Object} rule - Quality rule
 * @param {Object} settings - Rule settings + global aggressiveness
 * @returns {Object|null} Flag object or null if no issue
 */
export function checkStraightlining(respondentData, rule, settings) {
  const {
    minGridItems = 3,
    straightlineThresholdPercent = 80
  } = settings;
  
  const aggressiveness = settings.straightliningAggressiveness || 50;
  // Higher aggressiveness = lower threshold (more sensitive)
  const threshold = straightlineThresholdPercent - (aggressiveness - 50) * 0.3;
  
  // Get all columns for this question
  const questionId = rule.questionId || rule.questionNumber;
  const questionColumns = Object.keys(respondentData.columns || {}).filter(
    (col) => {
      const colLower = col.toLowerCase();
      const qIdLower = String(questionId).toLowerCase().replace(/^q/, '');
      return colLower.includes(qIdLower) && /r\d+/i.test(col);
    }
  );
  
  if (questionColumns.length < minGridItems) {
    return null; // Not enough items to check
  }
  
  // Get values for all grid items
  const values = questionColumns
    .map((col) => {
      const val = respondentData.columns[col];
      return val === null || val === undefined || val === '' ? null : String(val).trim();
    })
    .filter((v) => v !== null);
  
  if (values.length < minGridItems) {
    return null; // Not enough valid responses
  }
  
  // Count occurrences of each value
  const valueCounts = {};
  values.forEach((val) => {
    valueCounts[val] = (valueCounts[val] || 0) + 1;
  });
  
  // Find the most common value
  const maxCount = Math.max(...Object.values(valueCounts));
  const percentage = (maxCount / values.length) * 100;
  
  if (percentage >= threshold) {
    return {
      ruleId: rule.id,
      checkTypeId: 'straightlining',
      severity: percentage >= 95 ? 'major' : percentage >= 85 ? 'moderate' : 'minor',
      weight: percentage >= 95 ? 20 : percentage >= 85 ? 10 : 5,
      message: `Straight-lining detected: ${maxCount} of ${values.length} items (${percentage.toFixed(1)}%) have the same value "${Object.keys(valueCounts).find(k => valueCounts[k] === maxCount)}"`,
      rawDataSnippet: {
        questionId,
        values: values.slice(0, 10), // First 10 values
        percentage: percentage.toFixed(1)
      }
    };
  }
  
  return null;
}

/**
 * Check if respondent completed too quickly (speeding)
 * Uses 'qtime' column from data (seconds) and compares against expected LOI from questionnaire
 * @param {Object} respondentData - Respondent's data
 * @param {number} expectedLOI - Expected Length of Interview in minutes (from questionnaire)
 * @param {Object} rule - Quality rule
 * @param {Object} settings - Rule settings + global aggressiveness
 * @returns {Object|null} Flag object or null
 */
export function checkSpeeding(respondentData, expectedLOI, rule, settings) {
  const { speedingThresholdPercent = 50 } = settings;
  const aggressiveness = settings.speedingAggressiveness || 50;
  
  // Higher aggressiveness = lower threshold (more sensitive to speeders)
  // At 50% aggressiveness, threshold is 50% of expected LOI
  // At 100% aggressiveness, threshold is 40% of expected LOI
  // At 0% aggressiveness, threshold is 60% of expected LOI
  const threshold = speedingThresholdPercent - (aggressiveness - 50) * 0.2;
  
  // Get qtime from data (in seconds)
  let qtime = null;
  const qtimeColumns = ['qtime', 'QTIME', 'QTime', 'Qtime'];
  for (const col of qtimeColumns) {
    if (respondentData.columns?.[col] !== undefined && respondentData.columns[col] !== null) {
      qtime = parseFloat(respondentData.columns[col]);
      if (!isNaN(qtime)) break;
    }
  }
  
  if (qtime === null) {
    return null; // Can't check without qtime data
  }
  
  if (expectedLOI === null || expectedLOI === undefined || expectedLOI <= 0) {
    return null; // Can't check without expected LOI from questionnaire
  }
  
  // Convert expected LOI from minutes to seconds
  const expectedLOISeconds = expectedLOI * 60;
  
  // Calculate percentage of expected LOI
  const percentageOfExpected = (qtime / expectedLOISeconds) * 100;
  
  if (percentageOfExpected < threshold) {
    // Format time nicely
    const formatTime = (seconds) => {
      if (seconds < 60) return `${Math.round(seconds)}s`;
      const mins = Math.floor(seconds / 60);
      const secs = Math.round(seconds % 60);
      return secs > 0 ? `${mins}m ${secs}s` : `${mins}m`;
    };
    
    return {
      ruleId: rule.id,
      checkTypeId: 'speeding',
      severity: percentageOfExpected < 25 ? 'major' : percentageOfExpected < 40 ? 'moderate' : 'minor',
      weight: percentageOfExpected < 25 ? 20 : percentageOfExpected < 40 ? 10 : 5,
      message: `Speeding detected: Completed in ${formatTime(qtime)} (${percentageOfExpected.toFixed(0)}% of expected ${expectedLOI} min)`,
      rawDataSnippet: {
        qtime,
        expectedLOIMinutes: expectedLOI,
        expectedLOISeconds,
        percentageOfExpected: percentageOfExpected.toFixed(1)
      }
    };
  }
  
  return null;
}

/**
 * Basic logic consistency checks (deterministic rules)
 * For now, this is a placeholder for simple deterministic logic checks
 * More complex logic checks will use AI
 * @param {Object} respondentData - Respondent's data
 * @param {Object} rule - Quality rule
 * @param {Object} settings - Rule settings
 * @returns {Object|null} Flag object or null
 */
export function checkBasicLogic(respondentData, rule, settings) {
  // This is a placeholder for deterministic logic checks
  // For example: "If Q1 = 'No', then Q2 should not have a value"
  // Most logic checks will be handled by AI, but simple ones can go here
  
  if (!rule.relatedQuestionIds || rule.relatedQuestionIds.length < 2) {
    return null;
  }
  
  // Example: Check if "Never used" but then rated satisfaction
  // This would need to be configured per rule
  // For now, return null (let AI handle it)
  
  return null;
}




