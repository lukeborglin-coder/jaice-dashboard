# Transcript Migration: Adding analysisId to Existing Transcripts

## Overview

This migration adds `analysisId` properties to existing transcripts to enable proper data isolation in the storytelling system. Without this migration, transcripts are shared across all content analyses within a project.

## What This Migration Does

1. **Analyzes existing transcripts** in `transcripts.json`
2. **Matches transcripts to content analyses** based on:
   - Project ID matching
   - Transcript usage in saved analyses
   - Filename matching
3. **Adds `analysisId` property** to each transcript
4. **Handles edge cases** like orphaned transcripts or projects with no analyses

## How to Run the Migration

### Option 1: Using the Migration Script (Recommended)

1. **Start your server** (if not already running):
   ```bash
   cd server
   npm start
   ```

2. **Run the migration script**:
   ```bash
   node migrate-transcripts.js
   ```

### Option 2: Using API Endpoints Directly

1. **Run the migration**:
   ```bash
   curl -X POST http://localhost:3005/api/migrate/add-analysis-ids
   ```

2. **Verify the results**:
   ```bash
   curl http://localhost:3005/api/migrate/verify-migration
   ```

## Migration Logic

### Single Analysis Projects
- If a project has only one content analysis, all transcripts are assigned to that analysis

### Multiple Analysis Projects
- The migration attempts to match transcripts to analyses based on:
  - Transcript usage in `savedAnalyses[idx].transcripts`
  - Filename matching
  - If no match is found, assigns to the first analysis

### Edge Cases
- **Orphaned transcripts**: Transcripts without matching analyses are left unchanged
- **Projects with no analyses**: All transcripts are skipped
- **Already migrated transcripts**: Skipped to avoid overwriting

## Verification

After running the migration, you can verify the results:

```bash
curl http://localhost:3005/api/migrate/verify-migration
```

This will show:
- Total projects processed
- Total transcripts updated
- Breakdown by project
- Any transcripts that still lack `analysisId`

## Expected Results

After migration, your `transcripts.json` will look like:

```json
{
  "P-1759518369917": [
    {
      "id": "transcript-123",
      "originalPath": "/path/to/original.docx",
      "cleanedPath": "/path/to/cleaned.txt",
      "analysisId": "1760382812396",  // ← This is added by migration
      "respno": "R1",
      "originalFilename": "interview1.docx"
    }
  ]
}
```

## Benefits After Migration

1. **Proper Data Isolation**: Each content analysis will only see its own transcripts
2. **Accurate Supporting Quotes**: Quotes will be scoped to the specific analysis
3. **No More Fallback Issues**: The system won't need to fall back to all project transcripts
4. **Better Performance**: Faster transcript filtering and processing

## Troubleshooting

### If Migration Fails
- Check that your server is running
- Verify that `transcripts.json` and `savedAnalyses.json` exist
- Check server logs for detailed error messages

### If Some Transcripts Still Lack analysisId
- These are likely orphaned transcripts from projects with no content analyses
- This is expected behavior and won't affect functionality
- You can manually assign them later if needed

### If You Need to Rollback
- The migration doesn't modify existing `analysisId` values
- You can safely run the migration multiple times
- Original transcript data is preserved

## Files Modified

- `server/routes/migrate-transcripts.mjs` - Migration logic
- `server/server.mjs` - Added migration route
- `migrate-transcripts.js` - Migration script
- `transcripts.json` - Updated with `analysisId` properties

## Next Steps

After running the migration:

1. **Test the storytelling system** to ensure quotes work correctly
2. **Verify data isolation** by checking that different analyses show different quotes
3. **Remove the fallback mechanism** in `getTranscriptsText` if desired (optional)

The migration is safe to run multiple times and won't overwrite existing `analysisId` values.
