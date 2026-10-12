// JobPilot local web app. Listens on 127.0.0.1 only. Long tasks (search, prepare, review...) run
// as child processes of cli.js so a browser crash can never take the app down; their output is
// streamed to the page over Server-Sent Events.
const http = require('http');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { ROOT, readJson, writeJson } = require('../core/util');
const { User, listUsers, createUser } = require('../core/user');
const { Store } = require('../core/store');
const { openQuestions, answer, fillProblems } = require('../core/questions');
const { composeRules } = require('../core/rules');

const PORT = +process.env.PORT || 4317;
const WEB = path.join(ROOT, 'web');
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.png': 'image/png', '.pdf': 'application/pdf', '.txt': 'text/plain; charset=utf-8', '.svg': 'image/svg+xml',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' };

// ---- one background task at a time ----------------------------------------------------------------
const clients = new Set();
const history = [];   // recent log lines for pages opened mid-task
let task = null;      // { id, user, name, startedAt, proc }
function broadcast(event, data) {
  const msg = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const c of clients) c.write(msg);
}
function emit(line) { history.push(line); if (history.length > 400) history.shift(); broadcast('log', line); }

const TASKS = {
  onboard: { label: 'Reading your CV' }, search: { label: 'Searching for jobs' }, score: { label: 'Scoring jobs' },
  find: { label: 'Finding and scoring jobs' }, prepare: { label: 'Preparing applications' }, run: { label: 'Daily run' },
  review: { label: 'Review and submit' }, login: { label: 'Signing in to job sites' }
};
function startTask(userId, name, args = []) {
  if (task) throw Object.assign(new Error(`"${TASKS[task.name].label}" is still running. Wait for it or press Stop.`), { status: 409 });
  if (!TASKS[name]) throw Object.assign(new Error('unknown task'), { status: 400 });
  const proc = spawn(process.execPath, [path.join(ROOT, 'cli.js'), name, ...args, '--user', userId], { cwd: ROOT, env: process.env });
  task = { id: Date.now(), user: userId, name, label: TASKS[name].label, startedAt: new Date().toISOString(), proc };
  history.length = 0;
  emit(`▶ ${task.label}…`);
  broadcast('task', publicTask());
  let buf = '';
  const onData = d => { buf += d; const lines = buf.split('\n'); buf = lines.pop(); lines.filter(Boolean).forEach(emit); };
  proc.stdout.on('data', onData); proc.stderr.on('data', onData);
  proc.on('close', code => {
    if (buf) emit(buf);
    emit(code === 0 ? `✔ ${task.label} finished` : `✖ ${task.label} stopped${code ? ' with an error' : ''}`);
    task = null;
    broadcast('task', null);
  });
  return publicTask();
}
const publicTask = () => task && { id: task.id, user: task.user, name: task.name, label: task.label, startedAt: task.startedAt };

// ---- helpers -----------------------------------------------------------------------------------------
const send = (res, status, body, type = 'application/json') => {
  res.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
  res.end(type === 'application/json' ? JSON.stringify(body) : body);
};
const readBody = (req, limit = 15e6) => new Promise((resolve, reject) => {
  const chunks = []; let n = 0;
  req.on('data', c => { n += c.length; if (n > limit) { reject(Object.assign(new Error('file too large'), { status: 413 })); req.destroy(); } else chunks.push(c); });
  req.on('end', () => resolve(Buffer.concat(chunks))); req.on('error', reject);
});
const json = async req => { const b = await readBody(req, 2e6); return b.length ? JSON.parse(b) : {}; };
function sendFile(res, file) {
  if (!fs.existsSync(file) || !fs.statSync(file).isFile()) return send(res, 404, { error: 'not found' });
  res.writeHead(200, { 'Content-Type': TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream', 'Cache-Control': 'no-store' });
  fs.createReadStream(file).pipe(res);
}

function userSummary(u) {
  const store = new Store(u.paths.jobs);
  return { id: u.id, profile: u.profile, settings: { ...u.settings, joobleKey: u.settings.joobleKey ? '••••' : '' }, ready: u.ready,
    hasCv: fs.existsSync(u.paths.cv), counts: store.counts(), onboarding: readJson(u.p('onboarding.json'), null),
    questions: openQuestions(store).length, rules: u.rules() };
}

const jobView = j => ({ id: j.id, title: j.title, company: j.company, location: j.location, url: j.url, source: j.source, ats: j.ats,
  status: j.status, score: j.score, reason: j.reason, postedAt: j.postedAt, firstSeen: j.firstSeen, submittedAt: j.submittedAt,
  screenshot: j.screenshot, cvPdf: j.cvPdf, error: j.error, problems: fillProblems(j), pending: j.pending || [] });

// ---- routes ------------------------------------------------------------------------------------------
async function api(req, res, url) {
  const parts = url.pathname.split('/').filter(Boolean).slice(1);   // after "api"
  const m = req.method;
  if (parts[0] === 'events') {
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', Connection: 'keep-alive' });
    res.write(`event: task\ndata: ${JSON.stringify(publicTask())}\n\n`);
    for (const l of history) res.write(`event: log\ndata: ${JSON.stringify(l)}\n\n`);
    clients.add(res); req.on('close', () => clients.delete(res));
    return;
  }
  if (parts[0] === 'doctor') return send(res, 200, await require('../core/doctor').doctor({ skipAi: url.searchParams.get('ai') !== '1' }));
  if (parts[0] === 'task') {
    if (m === 'GET') return send(res, 200, publicTask());
    if (m === 'DELETE') { if (task) task.proc.kill('SIGTERM'); return send(res, 200, { ok: true }); }
    const b = await json(req);
    return send(res, 200, startTask(b.user, b.name, (b.args || []).map(String)));
  }
  if (parts[0] !== 'users') return send(res, 404, { error: 'not found' });
  if (!parts[1]) {
    if (m === 'GET') return send(res, 200, listUsers());
    if (m === 'POST') { const b = await json(req); if (!b.name?.trim()) return send(res, 400, { error: 'Enter a name' }); return send(res, 200, userSummary(createUser(b.name.trim()))); }
  }
  const u = new User(parts[1]);
  const what = parts[2];
  if (!what && m === 'GET') return send(res, 200, userSummary(u));
  if (what === 'profile' && m === 'PUT') { u.saveProfile(await json(req)); composeRules(u); return send(res, 200, userSummary(u)); }
  if (what === 'settings' && m === 'PUT') {
    const b = await json(req);
    if (b.joobleKey === '••••') delete b.joobleKey;
    // Arrays replace rather than merge.
    const cur = readJson(u.paths.settings, {});
    for (const k of ['search', 'apply', 'sources', 'rules']) if (b[k]) cur[k] = { ...(cur[k] || {}), ...b[k] };
    for (const k of ['joobleKey', 'preset']) if (b[k] !== undefined) cur[k] = b[k];
    writeJson(u.paths.settings, cur); u.reload(); composeRules(u);
    return send(res, 200, userSummary(u));
  }
  if (what === 'cv' && m === 'GET') return send(res, 200, u.cv() || null);
  if (what === 'cv' && m === 'PUT') { writeJson(u.paths.cv, await json(req)); return send(res, 200, { ok: true }); }
  if (what === 'cv.pdf' || what === 'cv.docx') {
    const { masterPdf } = require('../core/cv');
    const pdf = await masterPdf(u);
    return sendFile(res, what === 'cv.pdf' ? pdf : pdf.replace(/\.pdf$/, '.docx'));
  }
  if (what === 'upload-cv' && m === 'POST') {
    const name = decodeURIComponent(req.headers['x-filename'] || 'cv.pdf');
    const ext = path.extname(name).toLowerCase();
    if (!['.pdf', '.docx', '.txt'].includes(ext)) return send(res, 400, { error: 'Please upload a PDF, Word (.docx) or text file.' });
    const file = u.p(`source-cv${ext}`);
    fs.writeFileSync(file, await readBody(req));
    return send(res, 200, startTask(u.id, 'onboard', [file]));
  }
  if (what === 'jobs' && !parts[3]) {
    const st = url.searchParams.get('status');
    const jobs = new Store(u.paths.jobs).all().filter(j => !st || st.split(',').includes(j.status));
    jobs.sort((a, b) => (b.score ?? -1) - (a.score ?? -1) || String(b.firstSeen).localeCompare(String(a.firstSeen)));
    return send(res, 200, jobs.slice(0, 500).map(jobView));
  }
  if (what === 'jobs' && parts[3] && m === 'POST') {
    const b = await json(req), s = new Store(u.paths.jobs), id = decodeURIComponent(parts[3]);
    if (!s.get(id)) return send(res, 404, { error: 'no such job' });
    const allowed = ['submitted', 'skipped', 'ready', 'manual'];
    if (!allowed.includes(b.status)) return send(res, 400, { error: 'bad status' });
    s.update(id, { status: b.status, ...(b.status === 'submitted' ? { submittedAt: new Date().toISOString() } : {}) }, 'changed in the app'); s.save();
    return send(res, 200, jobView(s.get(id)));
  }
  if (what === 'map') {
    // Jobs worth seeing (not skipped/duplicates), with a rough location from core/geo.js.
    const { locate } = require('../core/geo');
    const hide = new Set(['skipped', 'duplicate', 'closed', 'excluded', 'new']);
    const out = { placed: [], remote: [], unknown: [] };
    for (const j of new Store(u.paths.jobs).all()) {
      if (hide.has(j.status)) continue;
      const g = locate(j), v = { id: j.id, title: j.title, company: j.company, score: j.score, status: j.status, url: j.url, location: j.location };
      if (!g) out.unknown.push(v); else if (g.precision === 'remote') out.remote.push(v); else out.placed.push({ ...v, ...g });
    }
    return send(res, 200, out);
  }
  if (what === 'questions') {
    const s = new Store(u.paths.jobs);
    if (m === 'GET') return send(res, 200, openQuestions(s));
    const b = await json(req);
    if (!b.question || !String(b.answer ?? '').trim()) return send(res, 400, { error: 'Write an answer first' });
    return send(res, 200, { requeued: answer(u, s, b.question, String(b.answer).trim()) });
  }
  if (what === 'file') {   // screenshots, tailored CVs, letters: only inside this person's folder
    const rel = url.searchParams.get('path') || '';
    const file = path.resolve(u.dir, rel);
    if (!file.startsWith(u.dir + path.sep) || /(^|[\\/])(browser|\.\.)/.test(rel)) return send(res, 403, { error: 'forbidden' });
    return sendFile(res, file);
  }
  return send(res, 404, { error: 'not found' });
}

const server = http.createServer(async (req, res) => {
  try {
    // Only this computer: reject other Host headers (DNS rebinding) and cross-site writes (CSRF).
    const host = (req.headers.host || '').split(':')[0];
    if (!['localhost', '127.0.0.1'].includes(host)) return send(res, 403, { error: 'forbidden host' });
    if (req.method !== 'GET' && req.headers['x-jobpilot'] !== '1') return send(res, 403, { error: 'missing app header' });
    const url = new URL(req.url, `http://${req.headers.host}`);
    if (url.pathname.startsWith('/api/')) return await api(req, res, url);
    const file = path.join(WEB, url.pathname === '/' ? 'index.html' : path.normalize(url.pathname).replace(/^([\\/]\.\.)+/, ''));
    if (!file.startsWith(WEB)) return send(res, 403, { error: 'forbidden' });
    return sendFile(res, fs.existsSync(file) ? file : path.join(WEB, 'index.html'));
  } catch (e) {
    send(res, e.status || (/No such user/.test(e.message) ? 404 : 500), { error: e.message });
  }
});

if (require.main === module) {
  server.listen(PORT, '127.0.0.1', () => {
    const link = `http://localhost:${PORT}`;
    console.log(`JobPilot is running at ${link}  (press Ctrl+C to stop)`);
    if (!process.argv.includes('--no-open')) {
      const opener = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'cmd' : 'xdg-open';
      const args = process.platform === 'win32' ? ['/c', 'start', '', link] : [link];
      spawn(opener, args, { stdio: 'ignore', detached: true }).on('error', () => {}).unref();
    }
  });
}

module.exports = { server };
