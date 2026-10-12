// Updates: tells you when a newer JobPilot is published and installs it on request.
//
// "Published" means the version in package.json on the repository's main branch is higher than
// the one running here; CHANGELOG.md says what changed. To release: raise the version, add a
// CHANGELOG entry, push to main.
//
// Installing never touches your data (users/, data/) or node_modules/. A git checkout updates
// with `git pull --ff-only`; a downloaded copy fetches the new files from GitHub, unpacks them in
// a staging folder, checks them, then copies them over. Dependencies are reinstalled only when
// they changed. The app then restarts itself (exit code 75 tells start.sh / start.bat to start it
// again).
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { spawnSync } = require('child_process');
const { ROOT, SHARED_DIR, log } = require('./util');

const pkg = () => JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
const VERSION = pkg().version;
const RESTART_CODE = 75;
const KEEP = new Set(['users', 'data', 'node_modules', '.git', 'runtime']);   // never overwritten

// "github:owner/repo" or a GitHub URL in package.json "repository".
function repo(p = pkg()) {
  const r = typeof p.repository === 'string' ? p.repository : p.repository?.url || '';
  const m = r.match(/(?:github:|github\.com[/:])([\w.-]+)\/([\w.-]+?)(?:\.git)?$/);
  // JOBPILOT_UPDATE_BRANCH follows another branch (for trying a version before it reaches main).
  return m ? { owner: m[1], name: m[2], branch: process.env.JOBPILOT_UPDATE_BRANCH || 'main' } : null;
}

// 1.10.0 > 1.9.3; missing parts count as 0; anything after "-" is ignored.
function compare(a, b) {
  const pa = String(a).split('-')[0].split('.').map(Number), pb = String(b).split('-')[0].split('.').map(Number);
  for (let i = 0; i < 3; i++) if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) > (pb[i] || 0) ? 1 : -1;
  return 0;
}

// CHANGELOG.md: "## 0.2.0 (2026-10-12)" headings, each followed by "- item" lines.
function parseChangelog(md) {
  const out = [];
  for (const line of String(md || '').split(/\r?\n/)) {
    const h = line.match(/^##\s+v?(\d+\.\d+\.\d+)\s*(?:\(([^)]*)\))?/);
    if (h) { out.push({ version: h[1], date: h[2] || '', items: [] }); continue; }
    const item = line.match(/^\s*[-*]\s+(.*)/);
    if (item && out.length) out[out.length - 1].items.push(item[1].trim());
  }
  return out;
}
const notesSince = (entries, current) => entries.filter(e => compare(e.version, current) > 0);

// What the main branch offers now. Returns { current, latest, newer, notes } or throws.
async function check({ fetchImpl = fetch } = {}) {
  const r = repo();
  if (!r) throw new Error('no GitHub repository in package.json');
  const raw = f => `https://raw.githubusercontent.com/${r.owner}/${r.name}/${r.branch}/${f}`;
  const get = async (f, as) => {
    const res = await fetchImpl(raw(f), { signal: AbortSignal.timeout(15000), headers: { 'Cache-Control': 'no-cache' } });
    if (!res.ok) throw new Error(`GitHub answered ${res.status} for ${f}`);
    return as === 'json' ? res.json() : res.text();
  };
  const latest = (await get('package.json', 'json')).version;
  const notes = compare(latest, VERSION) > 0 ? notesSince(parseChangelog(await get('CHANGELOG.md').catch(() => '')), VERSION) : [];
  return { current: VERSION, latest, newer: compare(latest, VERSION) > 0, notes, checkedAt: new Date().toISOString() };
}

// ---- unpacking GitHub's .tar.gz (no extra dependency) -----------------------------------------------
// Plain ustar entries plus the pax headers GitHub adds (global comment, and long paths).
function untar(buf) {
  const files = [];
  let pax = {};
  const str = (o, n) => buf.toString('utf8', o, o + n).replace(/\0.*$/s, '');
  const paxRecords = data => {
    const rec = {};
    for (let i = 0; i < data.length;) {
      const sp = data.indexOf(32, i); if (sp < 0) break;
      const len = +data.toString('utf8', i, sp); if (!len) break;
      const kv = data.toString('utf8', sp + 1, i + len - 1), eq = kv.indexOf('=');
      rec[kv.slice(0, eq)] = kv.slice(eq + 1); i += len;
    }
    return rec;
  };
  for (let off = 0; off + 512 <= buf.length;) {
    if (buf[off] === 0) break;   // end-of-archive blocks
    const size = parseInt(str(off + 124, 12).trim() || '0', 8), type = String.fromCharCode(buf[off + 156] || 48);
    const mode = parseInt(str(off + 100, 8).trim() || '644', 8);
    const prefix = str(off + 345, 155), name = (prefix ? prefix + '/' : '') + str(off, 100);
    const data = buf.subarray(off + 512, off + 512 + size);
    off += 512 + Math.ceil(size / 512) * 512;
    if (type === 'x') { pax = paxRecords(data); continue; }
    if (type === 'g') continue;
    const full = pax.path || name; pax = {};
    if (type === '0' || type === '7') files.push({ path: full, data: Buffer.from(data), mode });
  }
  return files;
}

// Files from a GitHub archive, without its top folder ("repo-main/"), minus anything we keep.
function archiveFiles(tgz) {
  const out = [];
  for (const f of untar(zlib.gunzipSync(tgz))) {
    const rel = f.path.split('/').slice(1).join('/');
    if (!rel || rel.split('/').some(p => p === '..') || KEEP.has(rel.split('/')[0])) continue;
    out.push({ ...f, path: rel });
  }
  return out;
}

// Did the dependencies change (not just the version number)? Then they need installing.
const deps = text => { try { const p = JSON.parse(text); return JSON.stringify([p.dependencies, p.optionalDependencies]); } catch { return text; } };
const read = (root, f) => { try { return fs.readFileSync(path.join(root, f), 'utf8'); } catch { return null; } };
const changed = (root, before) => deps(read(root, 'package.json')) !== deps(before['package.json']) || read(root, 'package-lock.json') !== before['package-lock.json'];

function npmInstall(root, say) {
  say('installing updated dependencies (a minute or two)...');
  const r = spawnSync(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['install', '--no-fund', '--no-audit'],
    { cwd: root, encoding: 'utf8', shell: process.platform === 'win32', windowsHide: true });
  if (r.status !== 0) throw new Error('npm install failed: ' + String(r.stderr || r.stdout || r.error?.message).trim().split('\n').slice(-3).join(' '));
}

// Install the latest version into root. Returns { method, version }.
async function install({ root = ROOT, fetchImpl = fetch, say = log, git = fs.existsSync(path.join(root, '.git')) } = {}) {
  const before = { 'package.json': read(root, 'package.json'), 'package-lock.json': read(root, 'package-lock.json') };
  if (git) {
    say('updating with git pull...');
    const r = spawnSync('git', ['pull', '--ff-only'], { cwd: root, encoding: 'utf8', windowsHide: true });
    if (r.status !== 0) throw new Error(`git pull did not work: ${String(r.stderr || r.stdout || r.error?.message).trim().split('\n').slice(-2).join(' ')}. ` +
      'If you changed files in the JobPilot folder yourself, undo or commit those changes and try again.');
  } else {
    const r = repo(JSON.parse(before['package.json']));
    const url = `https://codeload.github.com/${r.owner}/${r.name}/tar.gz/refs/heads/${r.branch}`;
    say('downloading the new version from GitHub...');
    const res = await fetchImpl(url, { signal: AbortSignal.timeout(120000) });
    if (!res.ok) throw new Error(`download failed (GitHub answered ${res.status})`);
    const files = archiveFiles(Buffer.from(await res.arrayBuffer()));
    // Check it is a complete JobPilot before changing anything here.
    for (const must of ['package.json', 'server/index.js', 'cli.js', 'web/app.js']) if (!files.some(f => f.path === must)) throw new Error(`the download looks incomplete (no ${must}); nothing was changed`);
    say(`copying ${files.length} files (your CV, answers and jobs in users/ are not touched)...`);
    const staging = path.join(SHARED_DIR, 'update-staging');
    fs.rmSync(staging, { recursive: true, force: true });
    for (const f of files) { const p = path.join(staging, f.path); fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, f.data, { mode: f.mode & 0o777 || 0o644 }); }
    for (const f of files) {
      const dest = path.join(root, f.path), next = fs.readFileSync(path.join(staging, f.path));
      if (fs.existsSync(dest) && fs.readFileSync(dest).equals(next)) continue;   // unchanged: leave it alone
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.writeFileSync(dest + '.updating', next, { mode: f.mode & 0o777 || 0o644 });
      fs.renameSync(dest + '.updating', dest);
    }
    fs.rmSync(staging, { recursive: true, force: true });
  }
  if (changed(root, before)) npmInstall(root, say);
  const version = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).version;
  say(`updated to JobPilot ${version}`);
  return { method: git ? 'git' : 'download', version };
}

module.exports = { VERSION, RESTART_CODE, repo, compare, parseChangelog, notesSince, check, install, untar, archiveFiles, changed };
