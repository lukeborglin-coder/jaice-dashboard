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
 * @param {Object} respondentData - Respondent's data
 * @param {number} medianLOI - Median length of interview in seconds
 * @param {Object} rule - Quality rule
 * @param {Object} settings - Rule settings + global aggressiveness
 * @returns {Object|null} Flag object or null
 */
export function checkSpeeding(respondentData, medianLOI, rule, settings) {
  const { speedingThresholdPercent = 30 } = settings;
  const aggressiveness = settings.speedingAggressiveness || 50;
  
  // Higher aggressiveness = lower threshold (more sensitive)
  const threshold = speedingThresholdPercent - (aggressiveness - 50) * 0.2;
  
  // Try to get LOI from data
  let loi = null;
  const loiColumns = ['LOI', 'loi', 'LengthOfInterview', 'length_of_interview', 'duration'];
  for (const col of loiColumns) {
    if (respondentData.columns?.[col] !== undefined && respondentData.columns[col] !== null) {
      loi = parseFloat(respondentData.columns[col]);
      if (!isNaN(loi)) break;
    }
  }
  
  if (loi === null || medianLOI === null || medianLOI === 0) {
    return null; // Can't check without LOI data
  }
  
  const percentageOfMedian = (loi / medianLOI) * 100;
  
  if (percentageOfMedian < threshold) {
    return {
      ruleId: rule.id,
      checkTypeId: 'speeding',
      severity: percentageOfMedian < 15 ? 'major' : percentageOfMedian < 25 ? 'moderate' : 'minor',
      weight: percentageOfMedian < 15 ? 20 : percentageOfMedian < 25 ? 10 : 5,
      message: `Speeding detected: Completed in ${loi}s (${percentageOfMedian.toFixed(1)}% of median ${medianLOI}s)`,
      rawDataSnippet: {
        loi,
        medianLOI,
        percentageOfMedian: percentageOfMedian.toFixed(1)
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

