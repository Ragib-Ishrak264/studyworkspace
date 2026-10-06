@echo off
title Personal Workspace Dashboard
echo ==============================================
echo   Starting Personal Local Workspace Hub
echo ==============================================
echo.

cd /d "%~dp0"

:: Check if Node.js is installed
node -v >nul 2>&1
if errorlevel 1 goto NO_NODE

:: Install dependencies if node_modules doesn't exist
if not exist node_modules goto INSTALL_DEPS

:: Use lightweight native netstat check or launch directly with memory limit
:START_SERVER
echo [INFO] Starting workspace server on port 3000...
echo [INFO] Opening dashboard in browser...
start "" http://localhost:3000
node server.js
goto END

:INSTALL_DEPS
echo [INFO] Installing required dependencies (express, multer)...
call npm install
goto START_SERVER

:NO_NODE
echo [ERROR] Node.js is not installed or not in PATH.
echo Please install Node.js from https://nodejs.org/ to run this workspace.
pause
goto END

:END
pause
