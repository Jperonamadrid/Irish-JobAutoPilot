// Thin wrapper over the Claude Code CLI (`claude -p`) for structured JSON calls. No tools, no MCP,
// no session files and a short system prompt, so each call only pays for the prompt we send.
// Tests replace the implementation with setAsk() so nothing calls the real model.
const { spawn, spawnSync } = require('child_process');

let spent = 0;
function realAsk({ model, system, prompt, schema, timeout = 300000 }) {
  const args = ['-p', '--model', model, '--tools', '', '--strict-mcp-config', '--no-session-persistence',
    '--setting-sources', '', '--output-format', 'json', '--system-prompt', system, '--json-schema', JSON.stringify(schema)];
  return new Promise((resolve, reject) => {
    const p = spawn('claude', args, { stdio: ['pipe', 'pipe', 'pipe'] });
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
  const v = spawnSync('claude', ['--version'], { encoding: 'utf8' });
  if (v.error) return { ok: false, detail: 'Claude Code is not installed (https://claude.com/claude-code)' };
  try {
    const r = await realAsk({ model: 'haiku', system: 'Reply with the JSON requested.', prompt: 'Return {"ok": true}.',
      schema: { type: 'object', required: ['ok'], properties: { ok: { type: 'boolean' } } }, timeout: 90000 });
    return { ok: !!r.ok, detail: `Claude Code ${v.stdout.trim()} answered` };
  } catch (e) { return { ok: false, detail: `Claude Code is installed but did not answer: ${e.message.slice(0, 160)}. Run "claude" once to sign in.` }; }
}

module.exports = { ask, setAsk, cost, check };
