#!/usr/bin/env bash
# Starts JobPilot and opens it in your browser. Safe to run every time: the first run installs
# what is needed, later runs start straight away.
set -e
cd "$(dirname "$0")"
if ! command -v node >/dev/null 2>&1; then
  echo "JobPilot needs Node.js 20 or newer: https://nodejs.org (choose the LTS version), then run this again."; read -r -p "Press Enter to close"; exit 1
fi
if [ ! -d node_modules ]; then echo "First run: installing (one or two minutes)..."; npm install --no-fund --no-audit; fi
if ! node -e "require('playwright').chromium.executablePath() && require('fs').accessSync(require('playwright').chromium.executablePath())" 2>/dev/null; then
  echo "Installing the PDF/browser engine..."; npx --yes playwright install chromium
fi
exec node server/index.js
