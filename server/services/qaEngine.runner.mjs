import * as deterministicChecks from './qaEngine.deterministic.mjs';
import * as aiChecks from './qaEngine.ai.mjs';
import * as scoring from './qaEngine.scoring.mjs';
import { loadQAData, loadQAResults, saveQAResults } from './dataQuality.storage.mjs';
import { loadQualityPlan } from './dataQuality.storage.mjs';

/**
 * Run QA checks for specified respondents
 * @param {string} projectId - Project ID
 * @param {string[]} [respondentIds] - Optional array of respondent IDs. If not provided, checks all new respondents
 * @param {Object} [options] - Options
 * @param {boolean} [options.force] - Force re-check even if status is locked
 * @param {Array} [options.questionnaireQuestions] - Questionnaire questions (if not provided, will try to load)
 * @returns {Promise<Object>} Results summary
 */
export async function runQAForRespondents(projectId, respondentIds = null, options = {}) {
  const { force = false, questionnaireQuestions = null } = options;
  
  // Load quality plan
  const qualityPlan = await loadQualityPlan(projectId);
  if (!qualityPlan || !qualityPlan.rules || qualityPlan.rules.length === 0) {
    throw new Error('No quality plan found. Please create a quality plan first.');
  }
  
  // Filter to enabled rules only
  const enabledRules = qualityPlan.rules.filter((r) => r.enabled);
  if (enabledRules.length === 0) {
    throw new Error('No enabled quality rules found.');
  }
  
  // Load QA data
  const qaData = await loadQAData(projectId);
  if (!qaData || Object.keys(qaData).length === 0) {
    throw new Error('No QA data found. Please upload data first.');
  }
  
  // Load existing QA results
  const existingResults = await loadQAResults(projectId);
  
  // Determine which respondents to check
  let respondentsToCheck = [];
  if (respondentIds && Array.isArray(respondentIds)) {
    respondentsToCheck = respondentIds;
  } else {
    // Check all respondents in QA data
    respondentsToCheck = Object.keys(qaData);
  }
  
  // Filter to only new/unlocked respondents
  if (!force) {
    respondentsToCheck = respondentsToCheck.filter((respno) => {
      const existing = existingResults[respno];
      return !existing || !existing.statusLocked;
    });
  }
  
  if (respondentsToCheck.length === 0) {
    return {
      processed: 0,
      skipped: Object.keys(existingResults).length,
      results: []
    };
  }
  
  // Separate rules by type (deterministic vs AI)
  const deterministicRules = enabledRules.filter((r) => 
    ['straightlining', 'speeding'].includes(r.checkTypeId)
  );
  const aiRules = enabledRules.filter((r) => 
    ['open_end', 'logic_consistency', 'custom'].includes(r.checkTypeId)
  );
  
  // Calculate median LOI for speeding checks (if needed)
  let medianLOI = null;
  if (deterministicRules.some((r) => r.checkTypeId === 'speeding')) {
    const loiValues = Object.values(qaData)
      .map((row) => {
        const loiCols = ['LOI', 'loi', 'LengthOfInterview', 'length_of_interview', 'duration'];
        for (const col of loiCols) {
          if (row.columns?.[col] !== undefined && row.columns[col] !== null) {
            const val = parseFloat(row.columns[col]);
            if (!isNaN(val)) return val;
          }
        }
        return null;
      })
      .filter((v) => v !== null)
      .sort((a, b) => a - b);
    
    if (loiValues.length > 0) {
      const mid = Math.floor(loiValues.length / 2);
      medianLOI = loiValues.length % 2 === 0
        ? (loiValues[mid - 1] + loiValues[mid]) / 2
        : loiValues[mid];
    }
  }
  
  // Process each respondent
  const results = [];
  const settings = {
    ...qualityPlan.globalAggressiveness,
    medianLOI
  };
  
  for (const respno of respondentsToCheck) {
    const respondentData = qaData[respno];
    if (!respondentData) {
      continue; // Skip if data not found
    }
    
    const allFlags = [];
    
    // Run deterministic checks
    for (const rule of deterministicRules) {
      try {
        let flag = null;
        
        if (rule.checkTypeId === 'straightlining') {
          flag = deterministicChecks.checkStraightlining(respondentData, rule, settings);
        } else if (rule.checkTypeId === 'speeding') {
          flag = deterministicChecks.checkSpeeding(respondentData, medianLOI, rule, settings);
        } else if (rule.checkTypeId === 'logic_consistency') {
          flag = deterministicChecks.checkBasicLogic(respondentData, rule, settings);
        }
        
        if (flag) {
          allFlags.push(flag);
        }
      } catch (error) {
        console.error(`[QA Runner] Error checking rule ${rule.id} for ${respno}:`, error.message);
      }
    }
    
    // Run AI checks (batch by rule type for efficiency)
    if (aiRules.length > 0 && questionnaireQuestions) {
      for (const rule of aiRules) {
        try {
          let flags = [];
          
          if (rule.checkTypeId === 'open_end') {
            flags = await aiChecks.checkOpenEnd(respondentData, rule, settings, questionnaireQuestions);
          } else if (rule.checkTypeId === 'logic_consistency') {
            flags = await aiChecks.checkLogicConsistency(respondentData, rule, settings, questionnaireQuestions);
          } else if (rule.checkTypeId === 'custom') {
            flags = await aiChecks.checkCustom(respondentData, rule, settings, questionnaireQuestions);
          }
          
          allFlags.push(...flags);
        } catch (error) {
          console.error(`[QA Runner] Error in AI check for rule ${rule.id} (${respno}):`, error.message);
        }
      }
    }
    
    // Calculate score and category
    const score = scoring.calculateScore(allFlags, qualityPlan.globalAggressiveness);
    const thresholds = scoring.getDefaultThresholds(qualityPlan.globalAggressiveness);
    const category = scoring.categorizeRespondent(score, allFlags, thresholds);
    
    // Create result
    const result = {
      projectId,
      respno,
      flags: allFlags,
      score,
      category,
      statusLocked: false,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    
    results.push(result);
  }
  
  // Save results
  if (results.length > 0) {
    await saveQAResults(projectId, results);
  }
  
  return {
    processed: results.length,
    skipped: respondentsToCheck.length - results.length,
    results
  };
}


