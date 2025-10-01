# Render Deployment Guide for JAICE Dashboard

## Overview
This guide will help you deploy your JAICE Dashboard to Render with proper persistent storage so data isn't lost when you push updates.

## Key Issues Fixed
1. **Persistent Disk**: All data (projects, users, vendors, feedback, uploads) now stored on a persistent disk that survives deployments
2. **Environment Configuration**: Proper environment variables for production
3. **File Upload Handling**: Uploads are saved to the persistent disk, not ephemeral storage

## Deployment Steps

### 1. Prepare Your Repository

Make sure your code is pushed to GitHub:
```bash
git add .
git commit -m "Add Render deployment configuration"
git push
```

### 2. Create Render Account & Connect GitHub

1. Go to https://render.com and sign up (or log in)
2. Click "New +" → "Blueprint"
3. Connect your GitHub account
4. Select your repository

### 3. Configure Environment Variables

After Render creates your services, you need to set these environment variables:

#### For Backend (jaice-dashboard-api):
- `OPENAI_API_KEY`: Your OpenAI API key (already in your .env)
- `CORS_ORIGIN`: Set to your frontend URL (e.g., `https://jaice-dashboard-frontend.onrender.com`)

#### For Frontend (jaice-dashboard-frontend):
- `VITE_API_URL`: Set to your backend URL (e.g., `https://jaice-dashboard-api.onrender.com`)

### 4. Set Environment Variables in Render Dashboard

1. Go to your Render dashboard
2. Click on "jaice-dashboard-api"
3. Go to "Environment" tab
4. Add the environment variables listed above
5. Repeat for "jaice-dashboard-frontend"

### 5. Verify Persistent Disk

1. In Render dashboard, go to "jaice-dashboard-api"
2. Click "Disks" tab
3. You should see a disk named "data-disk" mounted at `/opt/render/project/data`
4. This is where all your data will be stored permanently

### 6. Deploy

Render will automatically deploy when you push to GitHub. You can also manually trigger deploys from the dashboard.

## How Persistence Works

### Data Storage
All persistent data is stored in `/server/data`:
- `projects.json` - User projects
- `users.json` - User accounts
- `savedAnalyses.json` - Content analysis results
- `uploads/` - File uploads
- `discussionGuides/` - Saved discussion guides

### Environment Variables
- `DATA_DIR=/server/data` - Points to persistent disk
- `FILES_DIR=/server/data/uploads` - Upload directory on persistent disk

### What Happens During Deployment
1. Render builds your new code
2. The persistent disk at `/server/data` is **NOT** deleted
3. Your new server starts and connects to the existing persistent disk
4. All your data (projects, users, files) is still there!

## Testing Your Deployment

1. **Health Check**: Visit `https://your-api-url.onrender.com/health`
   - Should return: `{"status":"OK","timestamp":"...","openaiConfigured":true}`

2. **Create Test Data**:
   - Log in to your frontend
   - Create a test project
   - Upload a file

3. **Trigger a Deploy**:
   - Make a small change to your code
   - Push to GitHub
   - Wait for Render to redeploy

4. **Verify Persistence**:
   - After redeployment, your test project should still be there
   - Uploaded files should still be accessible

## Troubleshooting

### Data is still being lost
- Check that the disk is mounted: Dashboard → Service → Disks tab
- Verify `DATA_DIR` environment variable is set correctly
- Check logs for disk access errors

### Files not uploading
- Verify `FILES_DIR` points to the persistent disk
- Check file upload route is using `DATA_DIR`
- Ensure disk has sufficient space (1GB allocated)

### CORS errors
- Make sure `CORS_ORIGIN` is set to your frontend URL
- Include both `http://localhost:5173` (development) and your Render frontend URL

### API not accessible
- Check backend service is running
- Verify `VITE_API_URL` in frontend matches backend URL
- Check backend logs for errors

## Monitoring

- **Logs**: Dashboard → Service → Logs tab
- **Disk Usage**: Dashboard → Service → Disks tab
- **Metrics**: Dashboard → Service → Metrics tab

## Important Notes

1. **Free Tier Limitations**:
   - Services spin down after 15 minutes of inactivity
   - First request after spin-down will be slow (cold start)
   - Persistent disk data is NOT lost during spin-down

2. **Disk Size**:
   - Currently set to 1GB (free tier limit)
   - Monitor usage in Render dashboard
   - Upgrade plan if you need more space

3. **Environment Variables**:
   - Changes to env vars require manual redeploy
   - Never commit API keys to GitHub

## Updating Your App

When you push updates:
```bash
git add .
git commit -m "Your update message"
git push
```

Render will:
1. Automatically detect the push
2. Build the new version
3. Deploy it while preserving the persistent disk
4. Your data remains intact!

## Need Help?

- Render Docs: https://render.com/docs
- Check service logs in Render dashboard
- Verify environment variables are set correctly
- Ensure persistent disk is properly mounted
