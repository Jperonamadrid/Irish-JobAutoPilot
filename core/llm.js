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
  if (process.platform !== 'win32') return (resolved = { cmd: 'claude', pre: [] });
  const found = (spawnSync('where', ['claude'], { encoding: 'utf8' }).stdout || '').split(/\r?\n/).map(s => s.trim()).filter(Boolean);
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
    p.on('error', e => { clearTimeout(timer); reject(new Error(`could not start Claude Code (${e.code}). Is it installed? Run: npm run doctor`)); });
    p.stdout.on('data', d => out += d); p.stderr.on('data', d => err += d);
    p.on('close', code => {
      clearTimeout(timer);
      try {
        const r = JSON.parse(out);
        spent += r.total_cost_usd || 0;
        if (r.is_error || !r.structured_output) return reject(new Error('claude error: ' + String(r.result || err).slice(0, 300)));
        resolve(r.structured_output);
      } catch { reject(new Error(`claude exit ${code}: ${(err || out).slice(0, 300)}`)); }
    });
    p.stdin.end(prompt);
  });
}

let impl = realAsk;
const ask = opts => impl(opts);
const setAsk = fn => { impl = fn || realAsk; };
const cost = () => spent;

// Used by the doctor check: is the CLI installed, and can it answer a tiny prompt?
async function check() {
  const { cmd, pre } = claudeCommand();
  const v = spawnSync(cmd, [...pre, '--version'], { encoding: 'utf8', windowsHide: true });
  if (v.error) return { ok: false, detail: 'Claude Code is not installed (https://claude.com/claude-code)' };
  try {
    const r = await realAsk({ model: 'haiku', system: 'Reply with the JSON requested.', prompt: 'Return {"ok": true}.',
      schema: { type: 'object', required: ['ok'], properties: { ok: { type: 'boolean' } } }, timeout: 90000 });
    return { ok: !!r.ok, detail: `Claude Code ${v.stdout.trim()} answered` };
  } catch (e) { return { ok: false, detail: `Claude Code is installed but did not answer: ${e.message.slice(0, 160)}. Run "claude" once to sign in.` }; }
}

module.exports = { ask, setAsk, cost, check };
