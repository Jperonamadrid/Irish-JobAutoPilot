#!/usr/bin/env bash
# Starts JobPilot and opens it in your browser. Safe to run every time: the first run installs
# what is needed, later runs start straight away. After an update, JobPilot restarts itself here.
# Everything is inside main(), which bash reads in full before running it, so an update that
# replaces this file while JobPilot is running cannot confuse it.
main() {
  cd "$(dirname "$0")"
  # Node.js put here by the JobPilot installer (no admin rights needed).
  if [ -x runtime/node/bin/node ]; then export PATH="$PWD/runtime/node/bin:$PATH"; fi
  if ! command -v node >/dev/null 2>&1 || ! node -e "process.exit(+process.versions.node.split('.')[0] >= 20 ? 0 : 1)"; then
    echo "JobPilot needs Node.js 20 or newer. Run the JobPilot installer again, or get Node.js from https://nodejs.org (LTS)."
    read -r -p "Press Enter to close" || true; exit 1
  fi
  while true; do
    if [ ! -d node_modules ]; then echo "First run: installing (one or two minutes)..."; npm install --no-fund --no-audit || exit 1; fi
    if ! node -e "require('fs').accessSync(require('playwright').chromium.executablePath())" 2>/dev/null; then
      echo "Installing the PDF/browser engine..."; npx --yes playwright install chromium || exit 1
    fi
    node "${JOBPILOT_SERVER:-server/index.js}"
    code=$?
    [ "$code" -eq 75 ] || exit "$code"   # 75 = updated: start the new version
    echo; echo "Restarting with the new version..."
  done
}
main "$@"; exit
