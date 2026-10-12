const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
// Where per-person data lives. Override with JOBPILOT_HOME to keep data outside the app folder.
const USERS_DIR = process.env.JOBPILOT_HOME ? path.join(process.env.JOBPILOT_HOME, 'users') : path.join(ROOT, 'users');
const SHARED_DIR = process.env.JOBPILOT_HOME ? path.join(process.env.JOBPILOT_HOME, 'shared') : path.join(ROOT, 'data');

const sleep = ms => new Promise(r => setTimeout(r, ms));
const today = () => new Date().toISOString().slice(0, 10);
const log = (...a) => console.log(new Date().toLocaleTimeString('en-GB', { hour12: false }), ...a);

// Hosts that told us to back off (429 with a long Retry-After) are skipped until then, so one
// busy site never gets hammered and never slows the rest of the run.
const blockedUntil = new Map();
const hostOf = url => { try { return new URL(url).host; } catch { return ''; } };

// fetch with timeout and retry. Short 429s and 5xx/network errors retry with backoff; a long
// Retry-After trips the circuit breaker for that host; other 4xx return null.
async function request(url, opts = {}, { tries = 3, as = 'json', timeout = 20000 } = {}) {
  const host = hostOf(url);
  if (blockedUntil.get(host) > Date.now()) return null;
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(url, { ...opts, signal: AbortSignal.timeout(timeout) });
      if (r.status === 429) {
        const wait = +r.headers?.get?.('retry-after') || 0;
        if (wait > 60) {
          blockedUntil.set(host, Date.now() + wait * 1000);
          log(`${host} asked us to slow down; skipping it until ${new Date(Date.now() + wait * 1000).toLocaleString('en-GB')}`);
          return null;
        }
        await sleep(Math.max(wait * 1000, 1000 * 2 ** i)); continue;
      }
      if (r.status >= 500) { await sleep(1000 * 2 ** i); continue; }
      if (!r.ok) return null;
      return as === 'json' ? await r.json() : as === 'text' ? await r.text() : r;
    } catch { await sleep(1000 * 2 ** i); }
  }
  return null;
}
const getJson = (url, opts) => request(url, opts);
const getText = (url, opts) => request(url, opts, { as: 'text' });
const postJson = (url, body) => request(url, { method: 'POST',
  headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, body: JSON.stringify(body) });

// Run fn over items with at most n in flight. A throwing item yields null instead of failing all.
async function pool(items, n, fn) {
  const out = []; let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
    while (i < items.length) { const k = i++; try { out[k] = await fn(items[k], k); } catch (e) { out[k] = null; log('pool error:', e.message); } }
  }));
  return out;
}

const decode = s => String(s ?? '').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
  .replace(/&quot;/g, '"').replace(/&#39;|&#x27;|&rsquo;/g, "'").replace(/&#(\d+);/g, (_, n) => String.fromCharCode(n));
const htmlToText = h => decode(decode(String(h || '')).replace(/<(br|\/p|\/li|\/h\d|\/div)[^>]*>/gi, '\n')
  .replace(/<li[^>]*>/gi, '- ').replace(/<[^>]+>/g, '')).replace(/[ \t]+/g, ' ').replace(/\n\s*\n+/g, '\n').trim();
// Lowercase alphanumerics only: used for company/title fingerprints and question matching.
const norm = s => String(s || '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
const slug = s => norm(s).replace(/ /g, '-');

function readJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; }
}
// Write via temp file + rename so a crash mid-write never corrupts the file.
function writeJson(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
  fs.renameSync(tmp, file);
}

const isBlocked = url => blockedUntil.get(hostOf(url)) > Date.now();

module.exports = { ROOT, USERS_DIR, SHARED_DIR, sleep, today, log, request, isBlocked, getJson, getText, postJson, pool,
  htmlToText, decode, norm, slug, readJson, writeJson };
