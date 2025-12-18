/**
 * Scoring Engine for QA Results
 */

/**
 * Calculate overall quality score from flags
 * @param {Array} flags - Array of QA flags
 * @param {Object} aggressivenessSettings - Global aggressiveness settings
 * @returns {number} Score from 0-100
 */
export function calculateScore(flags, aggressivenessSettings = {}) {
  if (!flags || flags.length === 0) {
    return 100; // No flags = perfect score
  }
  
  // Start at 100
  let score = 100;
  
  // Subtract penalties based on severity and weight
  flags.forEach((flag) => {
    const weight = flag.weight || 0;
    score -= weight;
  });
  
  // Apply aggressiveness multiplier
  // Higher aggressiveness = more penalty
  const avgAggressiveness = Object.values(aggressivenessSettings).reduce((a, b) => a + b, 0) / 
    (Object.keys(aggressivenessSettings).length || 1);
  const multiplier = 1 + (avgAggressiveness - 50) / 100; // 0.5x to 1.5x
  score = score * multiplier;
  
  // Ensure score is between 0 and 100
  score = Math.max(0, Math.min(100, score));
  
  return Math.round(score);
}

/**
 * Categorize respondent based on score and flags
 * @param {number} score - Quality score (0-100)
 * @param {Array} flags - Array of QA flags
 * @param {Object} thresholds - Optional custom thresholds
 * @returns {string} "good" | "questionable" | "remove"
 */
export function categorizeRespondent(score, flags = [], thresholds = {}) {
  const {
    goodThreshold = 80,
    questionableThreshold = 50
  } = thresholds;
  
  // If there are major flags, automatically categorize as "remove"
  const hasMajorFlags = flags.some((f) => f.severity === 'major');
  if (hasMajorFlags && score < questionableThreshold) {
    return 'remove';
  }
  
  // Use score thresholds
  if (score >= goodThreshold) {
    return 'good';
  } else if (score >= questionableThreshold) {
    return 'questionable';
  } else {
    return 'remove';
  }
}

/**
 * Get default thresholds based on aggressiveness
 * @param {Object} aggressivenessSettings - Global aggressiveness settings
 * @returns {Object} Thresholds object
 */
export function getDefaultThresholds(aggressivenessSettings = {}) {
  const avgAggressiveness = Object.values(aggressivenessSettings).reduce((a, b) => a + b, 0) / 
    (Object.keys(aggressivenessSettings).length || 1);
  
  // Higher aggressiveness = stricter thresholds (lower good threshold)
  const goodThreshold = 80 - (avgAggressiveness - 50) * 0.2; // 70-90 range
  const questionableThreshold = 50 - (avgAggressiveness - 50) * 0.15; // 42.5-57.5 range
  
  return {
    goodThreshold: Math.max(70, Math.min(90, goodThreshold)),
    questionableThreshold: Math.max(40, Math.min(60, questionableThreshold))
  };
}









