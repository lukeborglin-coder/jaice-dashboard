@echo off
title JAICE Dashboard
color 0A

REM Hide the console window after starting
if not "%1"=="am_admin" (powershell start -verb runAs '%0' am_admin & exit /b)

REM Change to script directory
cd /d "%~dp0"

REM Run the PowerShell script
powershell -ExecutionPolicy Bypass -File "JAICE-Dashboard.ps1"

pause


