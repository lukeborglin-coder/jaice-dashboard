import express from 'express';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const router = express.Router();

// Data paths
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '../data');
const TRANSCRIPTS_PATH = path.join(DATA_DIR, 'transcripts.json');
const CAX_PATH = path.join(DATA_DIR, 'savedAnalyses.json');

/**
 * Migration script to add analysisId to existing transcripts
 * This matches transcripts to their content analyses based on projectId and usage patterns
 */
router.post('/add-analysis-ids', async (req, res) => {
  try {
    console.log('🔄 Starting transcript migration to add analysisIds...');
    
    // Load transcripts data
    const transcriptsData = await fs.readFile(TRANSCRIPTS_PATH, 'utf8');
    const transcripts = JSON.parse(transcriptsData);
    
    // Load content analyses data
    const caData = await fs.readFile(CAX_PATH, 'utf8');
    const analyses = JSON.parse(caData);
    
    console.log('📊 Migration Stats:', {
      totalProjects: Object.keys(transcripts).length,
      totalAnalyses: analyses.length,
      totalTranscripts: Object.values(transcripts).flat().length
    });
    
    let migrationStats = {
      projectsProcessed: 0,
      transcriptsUpdated: 0,
      transcriptsSkipped: 0,
      errors: []
    };
    
    // Process each project
    for (const projectId in transcripts) {
      console.log(`\n🔍 Processing project: ${projectId}`);
      const projectTranscripts = transcripts[projectId];
      
      // Find all analyses for this project
      const projectAnalyses = analyses.filter(ca => ca.projectId === projectId);
      console.log(`Found ${projectAnalyses.length} analyses for project ${projectId}`);
      
      if (projectAnalyses.length === 0) {
        console.log(`⚠️ No analyses found for project ${projectId}, skipping...`);
        migrationStats.transcriptsSkipped += projectTranscripts.length;
        continue;
      }
      
      // If only one analysis, assign all transcripts to it
      if (projectAnalyses.length === 1) {
        const analysisId = projectAnalyses[0].id;
        console.log(`📝 Single analysis found, assigning all transcripts to analysisId: ${analysisId}`);
        
        for (const transcript of projectTranscripts) {
          if (!transcript.analysisId) {
            transcript.analysisId = analysisId;
            migrationStats.transcriptsUpdated++;
            console.log(`✅ Updated transcript ${transcript.id} -> analysisId: ${analysisId}`);
          } else {
            migrationStats.transcriptsSkipped++;
            console.log(`⏭️ Transcript ${transcript.id} already has analysisId: ${transcript.analysisId}`);
          }
        }
      } else {
        // Multiple analyses - need to match transcripts to analyses
        console.log(`🔍 Multiple analyses found, attempting to match transcripts...`);
        
        for (const transcript of projectTranscripts) {
          if (transcript.analysisId) {
            migrationStats.transcriptsSkipped++;
            console.log(`⏭️ Transcript ${transcript.id} already has analysisId: ${transcript.analysisId}`);
            continue;
          }
          
          // Try to match transcript to analysis based on usage in savedAnalyses
          let matchedAnalysisId = null;
          
          for (const analysis of projectAnalyses) {
            // Check if this transcript is referenced in the analysis
            if (analysis.transcripts && Array.isArray(analysis.transcripts)) {
              const isUsedInAnalysis = analysis.transcripts.some(t => 
                t.id === transcript.id || 
                t.sourceTranscriptId === transcript.id ||
                t.originalFilename === transcript.originalFilename ||
                t.cleanedFilename === transcript.cleanedFilename
              );
              
              if (isUsedInAnalysis) {
                matchedAnalysisId = analysis.id;
                console.log(`🎯 Matched transcript ${transcript.id} to analysis ${analysis.id} (${analysis.name})`);
                break;
              }
            }
          }
          
          // If no match found, assign to the first analysis (fallback)
          if (!matchedAnalysisId) {
            matchedAnalysisId = projectAnalyses[0].id;
            console.log(`⚠️ No specific match found for transcript ${transcript.id}, assigning to first analysis: ${matchedAnalysisId}`);
          }
          
          transcript.analysisId = matchedAnalysisId;
          migrationStats.transcriptsUpdated++;
          console.log(`✅ Updated transcript ${transcript.id} -> analysisId: ${matchedAnalysisId}`);
        }
      }
      
      migrationStats.projectsProcessed++;
    }
    
    // Save the updated transcripts
    console.log('\n💾 Saving updated transcripts...');
    await fs.writeFile(TRANSCRIPTS_PATH, JSON.stringify(transcripts, null, 2));
    
    console.log('\n🎉 Migration completed!');
    console.log('📊 Final Stats:', migrationStats);
    
    res.json({
      success: true,
      message: 'Transcript migration completed successfully',
      stats: migrationStats
    });
    
  } catch (error) {
    console.error('❌ Migration failed:', error);
    res.status(500).json({
      success: false,
      error: 'Migration failed',
      message: error.message
    });
  }
});

/**
 * Verify migration results
 */
router.get('/verify-migration', async (req, res) => {
  try {
    console.log('🔍 Verifying migration results...');
    
    // Load transcripts data
    const transcriptsData = await fs.readFile(TRANSCRIPTS_PATH, 'utf8');
    const transcripts = JSON.parse(transcriptsData);
    
    // Load content analyses data
    const caData = await fs.readFile(CAX_PATH, 'utf8');
    const analyses = JSON.parse(caData);
    
    let verificationStats = {
      totalProjects: Object.keys(transcripts).length,
      totalTranscripts: 0,
      transcriptsWithAnalysisId: 0,
      transcriptsWithoutAnalysisId: 0,
      projectBreakdown: {}
    };
    
    // Analyze each project
    for (const projectId in transcripts) {
      const projectTranscripts = transcripts[projectId];
      const projectAnalyses = analyses.filter(ca => ca.projectId === projectId);
      
      const projectStats = {
        totalTranscripts: projectTranscripts.length,
        transcriptsWithAnalysisId: 0,
        transcriptsWithoutAnalysisId: 0,
        analysisIds: new Set(),
        analyses: projectAnalyses.map(a => ({ id: a.id, name: a.name }))
      };
      
      for (const transcript of projectTranscripts) {
        verificationStats.totalTranscripts++;
        
        if (transcript.analysisId) {
          verificationStats.transcriptsWithAnalysisId++;
          projectStats.transcriptsWithAnalysisId++;
          projectStats.analysisIds.add(transcript.analysisId);
        } else {
          verificationStats.transcriptsWithoutAnalysisId++;
          projectStats.transcriptsWithoutAnalysisId++;
        }
      }
      
      projectStats.analysisIds = Array.from(projectStats.analysisIds);
      verificationStats.projectBreakdown[projectId] = projectStats;
    }
    
    console.log('📊 Verification Results:', verificationStats);
    
    res.json({
      success: true,
      stats: verificationStats
    });
    
  } catch (error) {
    console.error('❌ Verification failed:', error);
    res.status(500).json({
      success: false,
      error: 'Verification failed',
      message: error.message
    });
  }
});

export default router;
