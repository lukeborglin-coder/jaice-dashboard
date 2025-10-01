# Fix Render Environment Variables

## Problem - RESOLVED
Your environment variables are now correctly configured!

## Current Configuration (CORRECT ✅)

Your Render backend environment variables should be:

```
CORS_ORIGIN=https://jaice-dashboard.onrender.com
DATA_DIR=/server/data
FILES_DIR=/server/data/uploads
JWT_SECRET=your-jwt-secret
OPENAI_API_KEY=your-openai-api-key-here
PORT=10000
```

These match your disk mount path at `/server/data`.

## Why This Works

Your persistent disk is mounted at `/server/data`. The environment variables now correctly point to this location, so all data will be saved to the persistent disk and survive deployments!

## After Updating

1. Save the environment variables in Render dashboard
2. Manually trigger a redeploy (or it will auto-deploy)
3. Check logs to ensure the server starts correctly
4. Test creating a project - it should now save properly!

## Verify It's Working

After redeploying with correct env vars:
1. Visit: `https://jaice-dashboard-api.onrender.com/health`
2. Should return: `{"status":"OK","timestamp":"...","openaiConfigured":true}`
3. Create a test project in your frontend
4. Should save without "Failed to save project to server" error
5. Make a code change and redeploy
6. Your test project should still be there!
