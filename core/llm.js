// Thin wrapper over the Claude Code CLI (`claude -p`) for structured JSON calls. No tools, no MCP,
// no session files and a short system prompt, so each call only pays for the prompt we send.
// Tests replace the implementation with setAsk() so nothing calls the real model.
const { spawn, spawnSync } = require('child_process');

const fs = require('fs');
const path = require('path');

// How to start Claude Code. On Windows it is claude.exe (native installer) or an npm "claude.cmd"
// wrapper; a .cmd needs a shell that would mangle our JSON arguments, so run its JS entry with node.
let resolved;
function claudeCommand() {
  if (resolved) return resolved;
  if (process.platform !== 'win32') {
    // Also look where the installers put it, in case PATH was not updated for this session.
    const home = process.env.HOME || '';
    const known = [path.join(home, '.local', 'bin', 'claude'), path.join(home, '.claude', 'local', 'claude'), '/usr/local/bin/claude', '/opt/homebrew/bin/claude'];
    const inPath = !spawnSync('claude', ['--version'], { encoding: 'utf8' }).error;
    return (resolved = { cmd: inPath ? 'claude' : known.find(f => fs.existsSync(f)) || 'claude', pre: [] });
  }
  const found = (spawnSync('where', ['claude'], { encoding: 'utf8', windowsHide: true }).stdout || '').split(/\r?\n/).map(s => s.trim()).filter(Boolean);
  // Windows only refreshes PATH for programs started after an install, so also check the usual folders.
  const up = process.env.USERPROFILE || '', appdata = process.env.APPDATA || '', local = process.env.LOCALAPPDATA || '';
  found.push(...[path.join(up, '.local', 'bin', 'claude.exe'), path.join(local, 'Programs', 'claude', 'claude.exe'), path.join(local, 'AnthropicClaude', 'claude.exe'),
    path.join(appdata, 'npm', 'claude.cmd')].filter(f => fs.existsSync(f)));
  const exe = found.find(p => /\.exe$/i.test(p));
  if (exe) return (resolved = { cmd: exe, pre: [] });
  const wrapper = found.find(p => /\.cmd$/i.test(p));
  const entry = wrapper && path.join(path.dirname(wrapper), 'node_modules', '@anthropic-ai', 'claude-code', 'cli.js');
  if (entry && fs.existsSync(entry)) return (resolved = { cmd: process.execPath, pre: [entry] });
  return (resolved = { cmd: 'claude', pre: [] });
}

let spent = 0;
function realAsk({ model, system, prompt, schema, timeout = 300000 }) {
  const args = ['-p', '--model', model, '--tools', '', '--strict-mcp-config', '--no-session-persistence',
    '--setting-sources', '', '--output-format', 'json', '--system-prompt', system, '--json-schema', JSON.stringify(schema)];
  const { cmd, pre } = claudeCommand();
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, [...pre, ...args], { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
    let out = '', err = '';
    const timer = setTimeout(() => { p.kill('SIGTERM'); reject(new Error('claude timed out')); }, timeout);
    p.on('error', e => { clearTimeout(timer); reject(new Error(`Claude Code was not found on this computer (${e.code}). Install it (see INSTALL-WINDOWS.md step 1), then restart the computer and JobPilot.`)); });
    p.stdout.on('data', d => out += d); p.stderr.on('data', d => err += d);
    p.on('close', code => {
      clearTimeout(timer);
      try {
        const r = JSON.parse(out);
        spent += r.total_cost_usd || 0;
        if (r.is_error || !r.structured_output) return reject(new Error(explain(String(r.result || err))));
        resolve(r.structured_output);
      } catch { reject(new Error(explain(`exit ${code}: ${err || out}`))); }
    });
    p.stdin.end(prompt);
  });
}

// Turn Claude Code's raw failures into something a non-technical person can act on.
function explain(raw) {
  const t = raw.toLowerCase();
  if (/log ?in|logged in|authenticat|api key|unauthori[sz]ed|credential|sign in/.test(t))
    return 'Claude Code is not signed in. Open PowerShell (or Terminal), type: claude   then sign in in the browser, type /exit, and try again.';
  if (/git.?bash|requires git/.test(t)) return 'Claude Code on Windows needs Git for Windows. Install it from https://git-scm.com/download/win, restart the computer, and try again.';
  if (/usage limit|rate limit|quota|overloaded|credit/.test(t)) return 'Claude is busy or your Claude usage limit was reached. Wait a while and try again.';
  return 'Claude Code could not answer: ' + raw.replace(/\s+/g, ' ').slice(0, 240);
}

let impl = realAsk;
const ask = opts => impl(opts);
const setAsk = fn => { impl = fn || realAsk; };
const cost = () => spent;

// Used by the doctor check: is the CLI installed, and can it answer a tiny prompt?
async function check() {
  const { cmd, pre } = claudeCommand();
  const v = spawnSync(cmd, [...pre, '--version'], { encoding: 'utf8', windowsHide: true });
  if (v.error) return { ok: false, detail: 'Claude Code was not found. Install it (INSTALL-WINDOWS.md step 1 on Windows, or https://claude.com/claude-code), then restart the computer and JobPilot.' };
  try {
    const r = await realAsk({ model: 'haiku', system: 'Reply with the JSON requested.', prompt: 'Return {"ok": true}.',
      schema: { type: 'object', required: ['ok'], properties: { ok: { type: 'boolean' } } }, timeout: 90000 });
    return { ok: !!r.ok, detail: `Claude Code ${v.stdout.trim()} answered` };
  } catch (e) { return { ok: false, detail: e.message }; }
}

module.exports = { ask, setAsk, cost, check, explain };
