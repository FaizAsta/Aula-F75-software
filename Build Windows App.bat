@echo off
cd /d "%~dp0"
title Build Aula Control
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js is not installed. Get it from https://nodejs.org and run this again.
  pause
  exit /b 1
)
if not exist node_modules (
  echo Installing dependencies, this takes a few minutes the first time...
  call npm install
  if errorlevel 1 (
    echo Install failed.
    pause
    exit /b 1
  )
)
echo.
echo Building the Windows installer. This takes a few minutes...
call npm run dist
if errorlevel 1 goto failed
echo.
echo Done. The installer is in the dist folder: Aula-Control-Setup.exe
echo Double-click it to install Aula Control like any other Windows app.
start "" "%~dp0dist"
pause
exit /b 0

:failed
rem The first build on Windows often needs administrator rights (it unpacks files that contain symbolic links).
rem If we are not an administrator yet, ask Windows for permission and run this same file again.
net session >nul 2>&1
if not errorlevel 1 goto failed_admin
echo.
echo The build failed. Trying again with administrator rights.
echo Click Yes on the Windows prompt that appears.
powershell -NoProfile -Command "Start-Process -FilePath '%~f0' -Verb RunAs"
exit /b 1

:failed_admin
echo.
echo The build failed even with administrator rights. Scroll up to read the error message.
pause
exit /b 1
