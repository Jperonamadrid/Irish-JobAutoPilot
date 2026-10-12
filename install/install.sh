#!/usr/bin/env bash
# JobPilot installer for macOS and Linux. One command does everything:
#
#   curl -fsSL https://raw.githubusercontent.com/Jperonamadrid/Irish-JobAutoPilot/main/install/install.sh | bash
#
# It installs only what is missing, without asking for an admin password:
#   1. JobPilot itself, in ~/JobPilot (an existing copy is updated; your data in users/ is kept)
#   2. Node.js, inside that folder (runtime/node), if this computer does not have Node 20 or newer
#   3. JobPilot's parts and its PDF/browser engine
#   4. Claude Code (the AI JobPilot uses), then helps you sign in
#   5. a desktop shortcut, then it starts JobPilot
# Running it again is safe: it repairs or updates whatever is there.
#
# Options, as environment variables before "bash":
#   JOBPILOT_DIR=/path      where to install (default ~/JobPilot)
#   JOBPILOT_REF=branch     which version of the repository to install (default main)
#   JOBPILOT_NO_START=1     do not start JobPilot at the end
#   JOBPILOT_LOCAL_NODE=1   always use JobPilot's own Node.js, even if the computer has one
#   JOBPILOT_SKIP_CLAUDE=1  do not install or sign in to Claude Code
#
# Everything is inside main() so that nothing runs unless the whole script has downloaded.
main() {
  set -euo pipefail
  local REPO="Jperonamadrid/Irish-JobAutoPilot" REF="${JOBPILOT_REF:-main}" DIR="${JOBPILOT_DIR:-$HOME/JobPilot}" NODE_LINE="22"
  local tmp; tmp="$(mktemp -d)"; trap 'rm -rf "$tmp"' EXIT
  say() { printf '\n\033[1;34m==>\033[0m %s\n' "$*"; }
  fail() { printf '\n\033[1;31mJobPilot could not be installed:\033[0m %s\n' "$*" >&2; exit 1; }
  ask() { if [ -r /dev/tty ]; then read -r -p "$1" REPLY </dev/tty || true; fi; }

  local os arch
  case "$(uname -s)" in Darwin) os=darwin ;; Linux) os=linux ;; *) fail "this installer is for macOS and Linux. On Windows use install.ps1 (see the README)." ;; esac
  case "$(uname -m)" in x86_64|amd64) arch=x64 ;; arm64|aarch64) arch=arm64 ;; *) fail "unsupported processor: $(uname -m)" ;; esac
  for c in curl tar; do command -v "$c" >/dev/null || fail "'$c' is missing. Install it and run this again."; done
  sha256() { if command -v sha256sum >/dev/null; then sha256sum "$1" | cut -d' ' -f1; else shasum -a 256 "$1" | cut -d' ' -f1; fi; }

  echo "JobPilot installer: everything goes into $DIR"

  # ---- 1. JobPilot ----------------------------------------------------------------------------------
  if [ -d "$DIR/.git" ]; then
    say "Updating your JobPilot (git pull)"
    git -C "$DIR" pull --ff-only || fail "git pull did not work in $DIR. Undo your own changes there, or remove the .git folder, and run this again."
  else
    say "Downloading JobPilot"
    curl -fsSL "https://codeload.github.com/$REPO/tar.gz/$REF" -o "$tmp/jobpilot.tgz" || fail "could not download JobPilot from GitHub."
    mkdir -p "$tmp/src" && tar -xzf "$tmp/jobpilot.tgz" -C "$tmp/src" --strip-components=1
    [ -f "$tmp/src/server/index.js" ] || fail "the download looks incomplete."
    mkdir -p "$DIR"
    # The download never contains users/ (your data), data/ or runtime/, so copying over keeps them.
    cp -R "$tmp/src/." "$DIR/"
  fi
  chmod +x "$DIR/start.sh" "$DIR/start.command" 2>/dev/null || true
  cd "$DIR"

  # ---- 2. Node.js -------------------------------------------------------------------------------------
  if [ -x runtime/node/bin/node ]; then export PATH="$DIR/runtime/node/bin:$PATH"; fi
  if { [ -z "${JOBPILOT_LOCAL_NODE:-}" ] || [ -x runtime/node/bin/node ]; } && command -v node >/dev/null && node -e "process.exit(+process.versions.node.split('.')[0] >= 20 ? 0 : 1)"; then
    say "Node.js $(node --version) is already here"
  else
    say "Installing Node.js $NODE_LINE (inside the JobPilot folder; no admin needed)"
    local base="https://nodejs.org/dist/latest-v$NODE_LINE.x" file sum
    curl -fsSL "$base/SHASUMS256.txt" -o "$tmp/SHASUMS256.txt" || fail "could not reach nodejs.org."
    file="$(grep -oE "node-v[0-9.]+-$os-$arch\.tar\.gz$" "$tmp/SHASUMS256.txt" | head -1)"
    [ -n "$file" ] || fail "no Node.js download for $os-$arch."
    curl -fsSL "$base/$file" -o "$tmp/$file" || fail "could not download Node.js."
    sum="$(grep " $file\$" "$tmp/SHASUMS256.txt" | cut -d' ' -f1)"
    [ "$(sha256 "$tmp/$file")" = "$sum" ] || fail "the Node.js download is damaged (checksum mismatch). Run this again."
    rm -rf runtime/node && mkdir -p runtime/node && tar -xzf "$tmp/$file" -C runtime/node --strip-components=1
    export PATH="$DIR/runtime/node/bin:$PATH"
    say "Node.js $(node --version) installed"
  fi

  # ---- 3. JobPilot's parts and the PDF/browser engine ----------------------------------------------
  say "Installing JobPilot's parts (one or two minutes)"
  npm install --no-fund --no-audit --loglevel=error || fail "npm install failed (see above)."
  say "Installing the PDF/browser engine"
  npx --yes playwright install chromium || fail "the browser engine did not install (see above)."

  # ---- 4. Claude Code -------------------------------------------------------------------------------
  if [ -z "${JOBPILOT_SKIP_CLAUDE:-}" ]; then
    export PATH="$HOME/.local/bin:$PATH"
    if command -v claude >/dev/null; then say "Claude Code is already installed"
    else
      say "Installing Claude Code (the AI JobPilot uses)"
      curl -fsSL https://claude.ai/install.sh | bash || fail "Claude Code did not install (see above)."
    fi
    say "Checking that Claude Code is signed in"
    if node -e "require('./core/llm').check().then(r => process.exit(r.ok ? 0 : 1))" 2>/dev/null; then
      echo "Claude Code is ready."
    elif [ -r /dev/tty ]; then
      echo "Claude Code needs you to sign in once with your Claude account (Pro or higher)."
      echo "It opens now: follow the steps, sign in in the browser, then type /exit to come back here."
      ask "Press Enter to open Claude Code... "
      claude </dev/tty >/dev/tty 2>&1 || true
    else
      echo "Sign in later: open a terminal, type: claude   then sign in and type /exit."
    fi
  fi

  # ---- 5. Shortcut and start ------------------------------------------------------------------------
  if [ "$os" = darwin ] && [ -d "$HOME/Desktop" ]; then
    ln -sf "$DIR/start.command" "$HOME/Desktop/JobPilot.command" && echo "Desktop shortcut: JobPilot.command"
  elif [ "$os" = linux ]; then
    node scripts/linux-shortcut.js >/dev/null 2>&1 && echo "Added JobPilot to your applications menu." || true
  fi
  if [ "$os" = darwin ] && [ ! -d "/Applications/Google Chrome.app" ]; then
    echo "Tip: Google Chrome (https://www.google.com/chrome/) is recommended for signing in to job sites; JobPilot works without it."
  fi

  say "JobPilot is installed in $DIR"
  echo "Start it any time with the desktop shortcut, or: $DIR/start.sh"
  if [ -z "${JOBPILOT_NO_START:-}" ]; then
    say "Starting JobPilot (keep this window open while you use it)"
    trap - EXIT; rm -rf "$tmp"
    exec ./start.sh </dev/null
  fi
}
main "$@"
