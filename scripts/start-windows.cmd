@echo off
rem Started by start.bat: checks what JobPilot needs, installs what is missing, then runs it.
rem After an update JobPilot exits with code 75 and is started again from :run. The line that runs
rem it is a single line on purpose: cmd reads it whole before running it, so an update that
rem replaces this file while JobPilot is running cannot confuse it.
if exist "%CD%\runtime\node\node.exe" set "PATH=%CD%\runtime\node;%PATH%"
where node >nul 2>nul || (echo JobPilot needs Node.js 20 or newer. Run the JobPilot installer again, or get it from https://nodejs.org & pause & exit /b 1)
if not defined JOBPILOT_SERVER set "JOBPILOT_SERVER=server\index.js"
:run
if not exist node_modules (echo First run: installing, one or two minutes... & call npm install --no-fund --no-audit)
node -e "require('fs').accessSync(require('playwright').chromium.executablePath())" 2>nul || call npx --yes playwright install chromium
node "%JOBPILOT_SERVER%" & if errorlevel 75 if not errorlevel 76 (echo. & echo Restarting with the new version... & goto run)
exit /b
