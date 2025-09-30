# JAICE Dashboard Startup Script (PowerShell)
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "    JAICE Dashboard Startup Script" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

# Check if Node.js is installed
try {
    $nodeVersion = node --version 2>$null
    if ($LASTEXITCODE -ne 0) {
        throw "Node.js not found"
    }
    Write-Host "✅ Node.js found: $nodeVersion" -ForegroundColor Green
} catch {
    Write-Host "ERROR: Node.js is not installed or not in PATH" -ForegroundColor Red
    Write-Host "Please install Node.js from https://nodejs.org/" -ForegroundColor Yellow
    Read-Host "Press Enter to exit"
    exit 1
}

Write-Host ""

# Check if we're in the right directory
if (-not (Test-Path "package.json")) {
    Write-Host "ERROR: package.json not found. Please run this script from the project root directory." -ForegroundColor Red
    Read-Host "Press Enter to exit"
    exit 1
}

if (-not (Test-Path "server\package.json")) {
    Write-Host "ERROR: Server package.json not found. Please check your project structure." -ForegroundColor Red
    Read-Host "Press Enter to exit"
    exit 1
}

Write-Host "✅ Project structure verified" -ForegroundColor Green
Write-Host ""

# Install dependencies if node_modules doesn't exist
if (-not (Test-Path "node_modules")) {
    Write-Host "📦 Installing frontend dependencies..." -ForegroundColor Yellow
    npm install
    if ($LASTEXITCODE -ne 0) {
        Write-Host "ERROR: Failed to install frontend dependencies" -ForegroundColor Red
        Read-Host "Press Enter to exit"
        exit 1
    }
}

if (-not (Test-Path "server\node_modules")) {
    Write-Host "📦 Installing server dependencies..." -ForegroundColor Yellow
    Set-Location server
    npm install
    if ($LASTEXITCODE -ne 0) {
        Write-Host "ERROR: Failed to install server dependencies" -ForegroundColor Red
        Read-Host "Press Enter to exit"
        exit 1
    }
    Set-Location ..
}

Write-Host "✅ Dependencies verified" -ForegroundColor Green
Write-Host ""

# Check for .env file
if (-not (Test-Path "server\.env")) {
    Write-Host "⚠️  WARNING: No .env file found in server directory" -ForegroundColor Yellow
    Write-Host "Creating a template .env file..." -ForegroundColor Yellow
    "OPENAI_API_KEY=your_openai_api_key_here" | Out-File -FilePath "server\.env" -Encoding UTF8
    Write-Host ""
    Write-Host "Please edit server\.env and add your OpenAI API key:" -ForegroundColor Yellow
    Write-Host "OPENAI_API_KEY=sk-your-actual-key-here" -ForegroundColor Yellow
    Write-Host ""
}

Write-Host "🚀 Starting JAICE Dashboard..." -ForegroundColor Green
Write-Host ""
Write-Host "Frontend will be available at: http://localhost:5173" -ForegroundColor Cyan
Write-Host "Backend API will be available at: http://localhost:3005" -ForegroundColor Cyan
Write-Host ""
Write-Host "Press Ctrl+C to stop both servers" -ForegroundColor Yellow
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

# Start both servers using the npm start script
npm start

