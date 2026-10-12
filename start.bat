@echo off
rem Windows: double-click this file to start JobPilot.
cd /d "%~dp0"
where node >nul 2>nul || (echo JobPilot needs Node.js 20 or newer: https://nodejs.org & pause & exit /b 1)
if not exist node_modules (echo First run: installing... & call npm install --no-fund --no-audit)
node -e "require('fs').accessSync(require('playwright').chromium.executablePath())" 2>nul || call npx --yes playwright install chromium
node server\index.js
