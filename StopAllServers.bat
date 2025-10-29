@echo off
echo ========================================
echo JAICE Dashboard - Stop All Servers
echo ========================================
echo.

echo Stopping all servers...
echo.

REM Kill processes on specific ports
echo Stopping Frontend (Port 5173)...
for /f "tokens=5" %%a in ('netstat -aon ^| findstr :5173 ^| findstr LISTENING') do taskkill /F /PID %%a 2>nul

echo Stopping Backend (Port 3005)...
for /f "tokens=5" %%a in ('netstat -aon ^| findstr :3005 ^| findstr LISTENING') do taskkill /F /PID %%a 2>nul

echo Stopping Conjoint API (Port 8000)...
for /f "tokens=5" %%a in ('netstat -aon ^| findstr :8000 ^| findstr LISTENING') do taskkill /F /PID %%a 2>nul

REM Extra cleanup
echo Cleaning up remaining processes...
taskkill /F /IM node.exe 2>nul
taskkill /F /IM python.exe 2>nul

echo.
echo ========================================
echo All servers stopped!
echo ========================================
echo.
pause
