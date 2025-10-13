/**
 * Script to migrate existing transcripts to add analysisId properties
 * Run this script to add analysisId to all existing transcripts
 */

const API_BASE_URL = process.env.API_BASE_URL || 'http://localhost:3005';

async function runMigration() {
  try {
    console.log('🔄 Starting transcript migration...');
    console.log(`📡 API Base URL: ${API_BASE_URL}`);
    
    // Run the migration
    const migrationResponse = await fetch(`${API_BASE_URL}/api/migrate/add-analysis-ids`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      }
    });
    
    if (!migrationResponse.ok) {
      throw new Error(`Migration failed: ${migrationResponse.status} ${migrationResponse.statusText}`);
    }
    
    const migrationResult = await migrationResponse.json();
    console.log('✅ Migration completed successfully!');
    console.log('📊 Migration Stats:', migrationResult.stats);
    
    // Verify the migration
    console.log('\n🔍 Verifying migration results...');
    const verificationResponse = await fetch(`${API_BASE_URL}/api/migrate/verify-migration`, {
      method: 'GET'
    });
    
    if (!verificationResponse.ok) {
      throw new Error(`Verification failed: ${verificationResponse.status} ${verificationResponse.statusText}`);
    }
    
    const verificationResult = await verificationResponse.json();
    console.log('✅ Verification completed!');
    console.log('📊 Verification Stats:', verificationResult.stats);
    
    // Summary
    const stats = verificationResult.stats;
    console.log('\n🎉 Migration Summary:');
    console.log(`📁 Total Projects: ${stats.totalProjects}`);
    console.log(`📄 Total Transcripts: ${stats.totalTranscripts}`);
    console.log(`✅ Transcripts with analysisId: ${stats.transcriptsWithAnalysisId}`);
    console.log(`❌ Transcripts without analysisId: ${stats.transcriptsWithoutAnalysisId}`);
    
    if (stats.transcriptsWithoutAnalysisId > 0) {
      console.log('\n⚠️ Some transcripts still don\'t have analysisId. This might be expected if:');
      console.log('   - They belong to projects with no content analyses');
      console.log('   - They are orphaned transcripts');
    } else {
      console.log('\n🎉 All transcripts now have analysisId!');
    }
    
  } catch (error) {
    console.error('❌ Migration failed:', error.message);
    process.exit(1);
  }
}

// Run the migration
runMigration();
