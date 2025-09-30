@echo off
echo ========================================
echo    JAICE Dashboard Startup Script
echo ========================================
echo.

REM Check if Node.js is installed
node --version >nul 2>&1
if %errorlevel% neq 0 (
    echo ERROR: Node.js is not installed or not in PATH
    echo Please install Node.js from https://nodejs.org/
    pause
    exit /b 1
)

echo ✅ Node.js found
echo.

REM Check if we're in the right directory
if not exist "package.json" (
    echo ERROR: package.json not found. Please run this script from the project root directory.
    pause
    exit /b 1
)

if not exist "server\package.json" (
    echo ERROR: Server package.json not found. Please check your project structure.
    pause
    exit /b 1
)

echo ✅ Project structure verified
echo.

REM Install dependencies if node_modules doesn't exist
if not exist "node_modules" (
    echo 📦 Installing frontend dependencies...
    npm install
    if %errorlevel% neq 0 (
        echo ERROR: Failed to install frontend dependencies
        pause
        exit /b 1
    )
)

if not exist "server\node_modules" (
    echo 📦 Installing server dependencies...
    cd server
    npm install
    if %errorlevel% neq 0 (
        echo ERROR: Failed to install server dependencies
        pause
        exit /b 1
    )
    cd ..
)

echo ✅ Dependencies verified
echo.

REM Check for .env file
if not exist "server\.env" (
    echo ⚠️  WARNING: No .env file found in server directory
    echo Creating a template .env file...
    echo OPENAI_API_KEY=your_openai_api_key_here > server\.env
    echo.
    echo Please edit server\.env and add your OpenAI API key:
    echo OPENAI_API_KEY=sk-your-actual-key-here
    echo.
)

echo 🚀 Starting JAICE Dashboard...
echo.
echo Frontend will be available at: http://localhost:5173
echo Backend API will be available at: http://localhost:3005
echo.
echo Press Ctrl+C to stop both servers
echo ========================================
echo.

REM Start both servers using the npm start script
npm start

