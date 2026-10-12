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
const outcomes = require('../core/outcomes');
const schedule = require('../core/schedule');
const update = require('../core/update');
const { SHARED_DIR } = require('../core/util');

const PORT = +process.env.PORT || 4317;
const WEB = path.join(ROOT, 'web');
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.png': 'image/png', '.pdf': 'application/pdf', '.txt': 'text/plain; charset=utf-8', '.svg': 'image/svg+xml',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' };

// ---- one background task at a time ----------------------------------------------------------------
const clients = new Set();
const history = [];   // recent log lines for pages opened mid-task
let task = null;      // { id, user, name, startedAt, proc }
let aiOk = 0;          // time Claude Code last answered the check
let lastResult = null; // outcome of the last finished task, so the page can explain a failure
function broadcast(event, data) {
  const msg = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const c of clients) c.write(msg);
}
function emit(line) { history.push(line); if (history.length > 400) history.shift(); broadcast('log', line); }

const TASKS = {
  onboard: { label: 'Reading your CV' }, search: { label: 'Searching for jobs' }, score: { label: 'Scoring jobs' },
  find: { label: 'Finding and scoring jobs' }, prepare: { label: 'Filling in application forms' }, run: { label: 'Daily run' },
  scan: { label: 'Scanning the job market' }, kits: { label: 'Making tailored CVs and cover letters' }, market: { label: 'Building the market report' },
  careers: { label: 'Exploring career options' }, prep: { label: 'Preparing for your interview' }, review: { label: 'Review and submit' }, login: { label: 'Signing in to job sites' }
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
    task.error = code ? (history.filter(l => /ERROR:/.test(l)).pop() || '').replace(/^.*ERROR:\s*/, '') || 'it stopped unexpectedly' : null;
    lastResult = { name: task.name, user: task.user, ok: code === 0, error: task.error, at: Date.now() };
    emit(code === 0 ? `✔ ${task.label} finished` : `✖ ${task.label} stopped${code ? ' with an error' : ''}`);
    task = null;
    broadcast('result', lastResult);
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
// Files keep their real names when saved ("Maria Murphy CV.pdf", not "file.pdf"): recruiters see the
// name of whatever gets uploaded. PDFs and images open in the browser; Word files download.
function sendFile(res, file) {
  if (!fs.existsSync(file) || !fs.statSync(file).isFile()) return send(res, 404, { error: 'not found' });
  const ext = path.extname(file).toLowerCase(), name = path.basename(file);
  const how = ['.pdf', '.png', '.txt', '.html', '.js', '.css', '.svg'].includes(ext) ? 'inline' : 'attachment';
  const ascii = name.replace(/[^\x20-\x7e]/g, '_').replace(/"/g, "'");
  res.writeHead(200, { 'Content-Type': TYPES[ext] || 'application/octet-stream', 'Cache-Control': 'no-store',
    'Content-Disposition': `${how}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(name)}` });
  fs.createReadStream(file).pipe(res);
}

function userSummary(u) {
  const store = new Store(u.paths.jobs);
  return { id: u.id, profile: u.profile, settings: { ...u.settings, joobleKey: u.settings.joobleKey ? '••••' : '' }, ready: u.ready,
    hasCv: fs.existsSync(u.paths.cv), counts: store.counts(), onboarding: readJson(u.p('onboarding.json'), null),
    questions: openQuestions(store).length, followUps: outcomes.stats(store).nudges.length, rules: u.rules(), hasMarket: fs.existsSync(u.p('market.json')), hasCareers: fs.existsSync(u.p('careers.json')),
    autoToday: store.where(j => j.autoSubmitted && (j.submittedAt || '').slice(0, 10) === new Date().toISOString().slice(0, 10)).length };
}

const jobView = j => ({ id: j.id, title: j.title, company: j.company, location: j.location, url: j.url, source: j.source, ats: j.ats,
  status: j.status, score: j.score, reason: j.reason, postedAt: j.postedAt, firstSeen: j.firstSeen, submittedAt: j.submittedAt,
  screenshot: j.screenshot, cvPdf: j.cvPdf, error: j.error, problems: fillProblems(j), pending: j.pending || [], kit: j.kit || null,
  prep: j.prep || null, followed: !!j.followed, verdict: j.verdict || null, autoSubmitted: !!j.autoSubmitted, submittedShot: j.submittedShot, outcome: j.outcome || null, cvUsed: j.cvUsed || null, hasTailoredCv: !!(j.kit?.tailored || j.cvPdf), followedUpAt: j.followedUpAt || null, nudge: outcomes.nudge(j), canFill: ['greenhouse', 'ashby', 'lever', 'workable'].includes(j.ats) });

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
  if (parts[0] === 'ai-check') {
    // Is Claude Code installed and signed in? Cached for 10 minutes once it works.
    if (!aiOk || Date.now() - aiOk > 600000 || url.searchParams.get('fresh')) {
      const r = await require('../core/llm').check();
      aiOk = r.ok ? Date.now() : 0;
      return send(res, 200, r);
    }
    return send(res, 200, { ok: true, detail: 'Claude Code is ready' });
  }
  if (parts[0] === 'update') {
    if (m === 'GET') {
      if (url.searchParams.get('fresh')) await checkForUpdate();
      return send(res, 200, { ...updateState, current: update.VERSION, method: fs.existsSync(path.join(ROOT, '.git')) ? 'git' : 'download' });
    }
    return send(res, 200, installUpdate());
  }
  if (parts[0] === 'quiz') return send(res, 200, require('../core/careers').QUIZ);
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
    // Auto-apply can only be switched on with the person's explicit consent; switching back to
    // "help me apply" withdraws it, so turning auto on again asks again.
    if (b.mode === 'auto') {
      if (b.autoConsent !== true) return send(res, 400, { error: 'Tick the box to confirm you want applications submitted automatically.' });
      b.auto = { ...(b.auto || {}), consentAt: new Date().toISOString() };
    }
    if (b.mode === 'help') b.auto = { ...(b.auto || {}), consentAt: null };
    delete b.autoConsent;
    if (b.joobleKey === '••••') delete b.joobleKey;
    // Arrays replace rather than merge.
    const cur = readJson(u.paths.settings, {});
    delete b.schedule?.lastRun;
    for (const k of ['search', 'apply', 'sources', 'rules', 'auto', 'schedule']) if (b[k]) cur[k] = { ...(cur[k] || {}), ...b[k] };
    for (const k of ['joobleKey', 'preset', 'mode', 'setupDone']) if (b[k] !== undefined) cur[k] = b[k];
    if (b.schedule) cur.schedule = schedule.onSave({ ...u.settings, ...cur, schedule: { ...u.settings.schedule, ...cur.schedule } });
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
    if (['.doc', '.odt', '.rtf', '.pages'].includes(ext)) return send(res, 400, { error: 'This is an older document format. Open it in Word and "Save as" .docx or PDF, then upload that.' });
    if (!['.pdf', '.docx', '.txt'].includes(ext)) return send(res, 400, { error: 'Please upload a PDF or Word (.docx) file.' });
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
    if (b.cvUsed !== undefined && !outcomes.CV_USED.includes(b.cvUsed)) return send(res, 400, { error: 'bad CV choice' });
    // After applying: what happened next, which CV you sent, or that you sent a follow-up.
    if (!b.status && (b.outcome !== undefined || b.followedUp || b.cvUsed)) {
      if (s.get(id).status !== 'submitted') return send(res, 400, { error: 'Mark the job as applied first' });
      if (b.outcome !== undefined && !outcomes.OUTCOMES[b.outcome]) return send(res, 400, { error: 'bad outcome' });
      const now = new Date().toISOString();
      s.update(id, b.followedUp ? { followedUpAt: now } : b.cvUsed ? { cvUsed: b.cvUsed } : { outcome: b.outcome, outcomeAt: now }, 'changed in the app'); s.save();
      return send(res, 200, jobView(s.get(id)));
    }
    const allowed = ['submitted', 'skipped', 'ready', 'manual'];
    if (!allowed.includes(b.status)) return send(res, 400, { error: 'bad status' });
    // Your call on the job, remembered so scoring learns what you want (see score.js decisions()).
    const at = new Date().toISOString(), was = s.get(id).status;
    const verdict = b.status === 'skipped' ? { verdict: 'no', reason: String(b.reason || '').trim().slice(0, 120), at }
      : b.status === 'submitted' || (b.status === 'ready' && was === 'skipped') ? { verdict: 'yes', at } : undefined;
    s.update(id, { status: b.status, ...(verdict ? { verdict } : {}),
      ...(b.status === 'submitted' ? { submittedAt: at, ...(b.cvUsed ? { cvUsed: b.cvUsed } : {}) } : {}) }, 'changed in the app'); s.save();
    return send(res, 200, jobView(s.get(id)));
  }
  if (what === 'titles' && m === 'POST') {
    const b = await json(req);
    const titles = [...new Set((b.titles || []).map(t => String(t).trim()).filter(Boolean))];
    if (!titles.length) return send(res, 400, { error: 'Choose at least one job title' });
    await require('../core/onboard').refineKeywords(u, titles);
    return send(res, 200, userSummary(new User(u.id)));
  }
  if (what === 'careers-picks' && m === 'PUT') {
    const c = require('../core/careers').load(u), b = await json(req);
    if (!c) return send(res, 404, { error: 'take the quiz first' });
    c.options.forEach((o, i) => { o.picked = !!b.picks?.[i]; });
    writeJson(u.p('careers.json'), c);
    return send(res, 200, { ok: true });
  }
  if (what === 'outcomes') return send(res, 200, outcomes.stats(new Store(u.paths.jobs)));
  if (what === 'market') return send(res, 200, require('../core/market').load(u));
  if (what === 'careers') {
    if (m === 'GET') return send(res, 200, require('../core/careers').load(u));
    const b = await json(req);
    const f = u.p('quiz-answers.json'); writeJson(f, b.answers || {});
    return send(res, 200, startTask(u.id, 'careers', [f]));
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

// ---- updates ---------------------------------------------------------------------------------------------
// Checks GitHub for a newer version when the app starts and every 6 hours (JOBPILOT_NO_UPDATE_CHECK=1
// turns this off). Installing is always your choice: the page shows what is new and an Update button.
let updateState = { latest: null, newer: false, notes: [], checkedAt: null, error: null, installing: false };
async function checkForUpdate() {
  if (process.env.JOBPILOT_NO_UPDATE_CHECK) return;
  try { Object.assign(updateState, await update.check(), { error: null }); }
  catch (e) { updateState.error = e.message; updateState.checkedAt = new Date().toISOString(); }
  broadcast('update', { ...updateState, current: update.VERSION });
}
const RESTARTED = path.join(SHARED_DIR, 'restarted-after-update');
function installUpdate() {
  if (task) throw Object.assign(new Error(`Wait for "${TASKS[task.name].label}" to finish (or press Stop), then update.`), { status: 409 });
  if (updateState.installing) throw Object.assign(new Error('The update is already being installed.'), { status: 409 });
  updateState.installing = true;
  history.length = 0;
  emit(`▶ Updating JobPilot from ${update.VERSION}…`);
  update.install({ say: line => emit(line) }).then(r => {
    emit(`✔ Updated to ${r.version}. Restarting…`);
    broadcast('updated', { version: r.version });
    fs.mkdirSync(SHARED_DIR, { recursive: true }); fs.writeFileSync(RESTARTED, r.version);
    // Exit code 75 asks start.sh / start.bat to start the new version (see those files).
    setTimeout(() => { server.close(); process.exit(update.RESTART_CODE); }, 1500);
  }).catch(e => {
    updateState.installing = false;
    emit(`✖ Update failed: ${e.message}`);
    broadcast('result', { name: 'update', ok: false, error: `Update failed: ${e.message}`, at: Date.now() });
  });
  return { ok: true };
}

// Automatic daily runs: once a minute, start the first one that is due (one task at a time, so
// several people's runs simply go one after another).
function startDueRuns() {
  if (task) return;
  for (const { id } of listUsers()) {
    try {   // one person's unreadable settings must never stop the app or the others' runs
      const u = new User(id);
      if (!schedule.isDue(u.settings)) continue;
      u.saveSettings({ schedule: { lastRun: schedule.localDate(new Date()) } });
      startTask(id, 'run'); emit(`(started automatically: ${u.profile.fullName || id}'s daily run)`);
      return;
    } catch (e) { console.log(`automatic run for ${id} not started: ${e.message}`); }
  }
}

function openBrowser(link) {
  if (process.argv.includes('--no-open')) return;
  const opener = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'cmd' : 'xdg-open';
  const args = process.platform === 'win32' ? ['/c', 'start', '', link] : [link];
  spawn(opener, args, { stdio: 'ignore', detached: true }).on('error', () => {}).unref();
}

if (require.main === module) {
  const link = `http://localhost:${PORT}`;
  // Started twice (e.g. start.bat double-clicked again)? Just open the one already running.
  server.on('error', e => {
    if (e.code !== 'EADDRINUSE') throw e;
    console.log(`JobPilot is already running at ${link}; opening it.`);
    openBrowser(link);
    setTimeout(() => process.exit(0), 1500);
  });
  server.listen(PORT, '127.0.0.1', () => {
    console.log(`JobPilot ${update.VERSION} is running at ${link}  (keep this window open; press Ctrl+C to stop)`);
    // After an update the page that asked for it is still open and reloads by itself.
    if (fs.existsSync(RESTARTED)) fs.rmSync(RESTARTED, { force: true }); else openBrowser(link);
    setTimeout(checkForUpdate, 10000);
    setInterval(checkForUpdate, 6 * 3600000);
    setTimeout(startDueRuns, 20000);   // catch up shortly after opening (gives the page time to load)
    setInterval(startDueRuns, 60000);
  });
}

module.exports = { server };
