@echo off

setlocal

echo ========================================

echo JAICE Dashboard Launcher

echo ========================================

echo.



set "ROOT=%~dp0"



echo [1/4] Stopping existing servers on ports 3005 and 5173...

for /f "tokens=5" %%a in ('netstat -aon ^| findstr :3005 ^| findstr LISTENING') do taskkill /F /PID %%a >nul 2>nul

for /f "tokens=5" %%a in ('netstat -aon ^| findstr :5173 ^| findstr LISTENING') do taskkill /F /PID %%a >nul 2>nul



echo Waiting for processes to terminate...

timeout /t 2



echo.

echo [2/4] Starting Backend (http://localhost:3005)...

start "JAICE Backend" cmd /k "cd /d ""%ROOT%server"" && set PORT=3005 && set DEBUG_DATAMAP=1 && npm start"



echo.

echo [3/4] Starting Frontend (http://localhost:5173)...

start "JAICE Frontend" cmd /k "cd /d ""%ROOT%"" && npm run start:frontend"



echo.

echo Waiting for frontend to start...

timeout /t 5



echo [4/4] Opening browser...

start http://localhost:5173



echo.

echo ========================================

echo Started. Close server windows to stop.

echo ========================================

echo.

exit /b 0





