# JAICE Dashboard - Easy Startup Guide

## Quick Start (One-Click Launch)

### Option: Double-click the batch file
1. **Double-click `Start-JAICE.bat`** in your project folder
2. The script will automatically:
   - Stop anything already listening on ports 3005 and 5173
   - Start the backend server and frontend
   - Open your browser to the dashboard

## What happens when you start:

- **Backend Server**: Runs on `http://localhost:3005`
- **Frontend Website**: Runs on `http://localhost:5173`
- **Automatic Browser**: The website should open automatically

## First Time Setup:

1. **Get an OpenAI API Key** (for AI features):
   - Go to https://platform.openai.com/api-keys
   - Create a new API key
   - Edit `server\.env` file
   - Replace `your_openai_api_key_here` with your actual key

2. **Example .env file**:
   ```
   OPENAI_API_KEY=sk-your-actual-key-here
   ```

## Troubleshooting:

- **"Node.js not found"**: Install Node.js from https://nodejs.org/
- **Port already in use**: Close other applications using ports 3005 or 5173
- **Dependencies error**: Delete `node_modules` folders and run the startup script again
- **API not working**: Check your `.env` file has the correct OpenAI API key

## Manual Start (if needed):

```bash
# Terminal 1 - Backend
cd server
npm start

# Terminal 2 - Frontend  
npm run dev
```

## Stopping the servers:
- Press `Ctrl+C` in the terminal window
- Or close the terminal window

