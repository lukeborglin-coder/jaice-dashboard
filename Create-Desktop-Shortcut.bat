@echo off
echo Creating JAICE Dashboard desktop shortcut...

REM Get the current directory
set "CURRENT_DIR=%~dp0"

REM Create VBS script to create shortcut
echo Set oWS = WScript.CreateObject("WScript.Shell") > CreateShortcut.vbs
echo sLinkFile = "%USERPROFILE%\Desktop\JAICE Dashboard.lnk" >> CreateShortcut.vbs
echo Set oLink = oWS.CreateShortcut(sLinkFile) >> CreateShortcut.vbs
echo oLink.TargetPath = "%CURRENT_DIR%JAICE-Dashboard.bat" >> CreateShortcut.vbs
echo oLink.WorkingDirectory = "%CURRENT_DIR%" >> CreateShortcut.vbs
echo oLink.Description = "JAICE Dashboard - AI Content Analysis" >> CreateShortcut.vbs
echo oLink.IconLocation = "%CURRENT_DIR%assets\Circle.png" >> CreateShortcut.vbs
echo oLink.Save >> CreateShortcut.vbs

REM Run the VBS script
cscript CreateShortcut.vbs

REM Clean up
del CreateShortcut.vbs

echo Desktop shortcut created successfully!
echo You can now pin "JAICE Dashboard" to your taskbar or start menu.
pause

