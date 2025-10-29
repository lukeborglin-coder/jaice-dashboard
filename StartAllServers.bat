@echo off
echo ========================================
echo JAICE Dashboard - One-Click Launcher
echo ========================================
echo.

REM Kill all running servers
echo [1/4] Stopping all existing servers...
echo.

REM Kill processes on specific ports
echo Killing processes on port 5173 (Frontend)...
for /f "tokens=5" %%a in ('netstat -aon ^| findstr :5173 ^| findstr LISTENING') do taskkill /F /PID %%a 2>nul

echo Killing processes on port 3005 (Backend)...
for /f "tokens=5" %%a in ('netstat -aon ^| findstr :3005 ^| findstr LISTENING') do taskkill /F /PID %%a 2>nul

echo Killing processes on port 8000 (Conjoint API)...
for /f "tokens=5" %%a in ('netstat -aon ^| findstr :8000 ^| findstr LISTENING') do taskkill /F /PID %%a 2>nul

REM Extra cleanup - kill any lingering node/python processes
echo Cleaning up any remaining processes...
taskkill /F /IM node.exe 2>nul
taskkill /F /IM python.exe 2>nul

echo.
echo Waiting for processes to fully terminate...
timeout /t 3 /nobreak >nul

echo.
echo [2/4] Starting Backend Server (Port 3005)...
start "Backend Server" cmd /k "cd /d "%~dp0server" && set PORT=3005 && node server.mjs"

echo.
echo [3/4] Starting Conjoint API Server (Port 8000)...
start "Conjoint API" cmd /k "cd /d "%~dp0conjoint-backend" && (if not exist .venv python -m venv .venv) && call .venv\Scripts\activate && python -m pip install --quiet -r requirements.txt && python -m uvicorn app:app --reload --port 8000"

echo.
echo Waiting for servers to initialize...
timeout /t 5 /nobreak >nul

echo.
echo [4/4] Starting Frontend Server (Port 5173)...
start "Frontend Server" cmd /k "cd /d "%~dp0" && npm run dev"

echo.
echo Waiting for frontend to start...
timeout /t 5 /nobreak >nul

echo.
echo Opening browser...
start http://localhost:5173

echo.
echo ========================================
echo All servers started successfully!
echo ========================================
echo.
echo Frontend:     http://localhost:5173
echo Backend:      http://localhost:3005
echo Conjoint API: http://localhost:8000
echo.
echo Press any key to exit this launcher...
pause >nul
