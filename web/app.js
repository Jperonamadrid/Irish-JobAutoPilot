// JobPilot web app (no framework, no build step).
const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const eur = n => n == null ? '–' : '€' + Math.round(n).toLocaleString('en-IE');
const state = { user: null, data: null, tab: 'home', step: 'cv', wiz: 0, jobFilter: 'recommended', task: null, mapFilter: '' };

async function api(path, opts = {}) {
  const r = await fetch('/api' + path, { ...opts, headers: { 'X-JobPilot': '1', ...(opts.body && !(opts.body instanceof Blob) ? { 'Content-Type': 'application/json' } : {}), ...(opts.headers || {}) } });
  const body = r.headers.get('content-type')?.includes('json') ? await r.json() : null;
  if (!r.ok) throw new Error(body?.error || r.statusText);
  return body;
}
const put = (p, b) => api(p, { method: 'PUT', body: JSON.stringify(b) });
const post = (p, b) => api(p, { method: 'POST', body: JSON.stringify(b) });
function toast(msg, ms = 4000) { const t = $('#toast'); t.textContent = msg; t.classList.remove('hide'); clearTimeout(toast.t); toast.t = setTimeout(() => t.classList.add('hide'), ms); }
const guard = fn => async (...a) => { try { await fn(...a); } catch (e) { toast(e.message, 7000); } };
const file = p => `/api/users/${state.user}/file?path=${encodeURIComponent(p)}`;
const runTask = async (name, args) => { await post('/task', { user: state.user, name, args }); };

// ---- people & top-level views ---------------------------------------------------------------------------
async function loadUsers(select) {
  const users = await api('/users');
  const none = !users.length;
  $('#welcome').classList.toggle('hide', !none);
  $('#tabs').classList.toggle('hide', none); $('.who').classList.toggle('hide', none);
  if (none) { $$('.view').forEach(v => v.id !== 'welcome' && v.classList.add('hide')); return; }
  const keep = select || localStorage.getItem('jp-user');
  state.user = users.find(u => u.id === keep)?.id || users[0].id;
  $('#userSel').innerHTML = users.map(u => `<option value="${esc(u.id)}" ${u.id === state.user ? 'selected' : ''}>${esc(u.name)}</option>`).join('');
  await refresh();
}
async function refresh() {
  if (!state.user) return;
  localStorage.setItem('jp-user', state.user);
  state.data = await api(`/users/${state.user}`);
  const q = state.data.questions; $('#qcount').textContent = q; $('#qcount').classList.toggle('hide', !q);
  const f = state.data.followUps; $('#fcount').textContent = f; $('#fcount').classList.toggle('hide', !f);
  if (!state.data.settings.setupDone) return showSetup();
  $('#tabs').classList.remove('hide');
  if (state.tab === 'setup') state.tab = 'home';
  showTab(state.tab);
}
$('#userSel').onchange = guard(async e => { state.user = e.target.value; state.wiz = 0; await refresh(); });
$('#addUser').onclick = guard(async () => {
  const name = prompt('Full name of the person to add:');
  if (!name?.trim()) return;
  const u = await post('/users', { name }); state.wiz = 0; await loadUsers(u.id);
});
$('#createFirst').onclick = guard(async () => {
  const name = $('#newName').value.trim(); if (!name) return toast('Enter your name first');
  const u = await post('/users', { name }); await loadUsers(u.id);
});

function showTab(t) {
  state.tab = t;
  $$('#tabs button').forEach(b => b.classList.toggle('on', b.dataset.tab === t));
  $$('.view').forEach(v => v.classList.toggle('hide', v.id !== t));
  const r = ({ home: renderHome, jobs: renderJobs, results: renderResults, market: renderMarket, map: renderMap, careers: renderCareers, questions: renderQuestions, profile: renderStep })[t]?.();
  if (r?.catch) r.catch(e => toast(e.message));
}
$$('#tabs button').forEach(b => b.onclick = () => showTab(b.dataset.tab));

// ---- live activity ---------------------------------------------------------------------------------------
const onTaskDone = [];
function connect() {
  const es = new EventSource('/api/events');
  es.addEventListener('log', e => {
    const line = JSON.parse(e.data);
    for (const l of [$('#log'), $('#wizLog'), $('#updLog')]) if (l) { l.textContent += line + '\n'; l.scrollTop = l.scrollHeight; }
  });
  es.addEventListener('update', e => { state.update = JSON.parse(e.data); renderUpdate(); });
  es.addEventListener('updated', e => waitForRestart(JSON.parse(e.data).version));
  es.addEventListener('result', e => {
    state.lastResult = JSON.parse(e.data);
    if (state.lastResult?.name === 'update') overlay(null);
    if (state.lastResult && !state.lastResult.ok) toast('Something went wrong: ' + (state.lastResult.error || 'see the Activity log on Home'), 12000);
  });
  es.addEventListener('task', e => {
    const t = JSON.parse(e.data), was = state.task;
    state.task = t;
    $('#taskState').textContent = t ? `${t.label}…` : 'Idle';
    $('#stopTask').classList.toggle('hide', !t);
    if (t && !was) $('#log').textContent = '';
    if (!t && was) {
      const before = recommended();
      refresh().then(() => { notifyDone(was, before); onTaskDone.splice(0).forEach(f => f(was)); }).catch(() => {});
    }
    $$('[data-run]').forEach(b => b.disabled = !!t);
  });
  es.onerror = () => { $('#taskState').textContent = 'Reconnecting…'; };
}
$('#stopTask').onclick = guard(() => api('/task', { method: 'DELETE' }));

// ---- updates: the version in the top bar, a card on Home when a newer one is out ---------------------
function overlay(title, text = '', withLog = false) {
  $('#overlay').classList.toggle('hide', !title);
  if (!title) return;
  $('#ovTitle').textContent = title; $('#ovText').textContent = text; $('#updLog').classList.toggle('hide', !withLog);
}
async function loadUpdate(fresh) {
  state.update = await api('/update' + (fresh ? '?fresh=1' : '')).catch(() => state.update);
  renderUpdate();
}
function renderUpdate() {
  const u = state.update; if (!u) return;
  $('#ver').textContent = u.newer ? `v${u.current} · update available` : `v${u.current}`;
  $('#ver').classList.toggle('new', !!u.newer);
  const box = $('#updateBox'); if (!box) return;
  let skipped = null; try { skipped = localStorage.getItem('jp-skip-update'); } catch {}
  if (!u.newer || skipped === u.latest) { box.innerHTML = ''; return; }
  box.innerHTML = `<div class="card update"><div class="row between wrap"><h2>✨ JobPilot ${esc(u.latest)} is out</h2><span class="muted small">you have ${esc(u.current)}</span></div>
    ${u.notes.slice(0, 3).map(n => `<b class="small">What's new in ${esc(n.version)}</b><ul class="small">${n.items.map(i => `<li>${esc(i)}</li>`).join('')}</ul>`).join('')}
    <p class="help">Takes a minute or two. Your CV, answers, jobs and settings are kept. JobPilot restarts by itself.</p>
    <div class="row"><button class="primary" id="doUpdate">Update now</button><button class="ghost" id="laterUpdate">Later</button></div></div>`;
  $('#laterUpdate').onclick = () => { try { localStorage.setItem('jp-skip-update', u.latest); } catch {} renderUpdate(); toast('OK. Click the version number at the top any time to update.'); };
  $('#doUpdate').onclick = guard(async () => {
    if (state.task) throw new Error(`Wait for "${state.task.label}" to finish first.`);
    $('#updLog').textContent = '';
    overlay(`Updating to JobPilot ${u.latest}…`, 'Keep this window and the JobPilot window open. This takes a minute or two.', true);
    try { await post('/update', {}); } catch (e) { overlay(null); throw e; }
  });
}
// After installing, the app restarts: wait until the new version answers, then reload the page.
async function waitForRestart(version) {
  overlay(`Updated to ${version}. Restarting JobPilot…`, 'This page reloads by itself in a few seconds.');
  for (const t0 = Date.now(); Date.now() - t0 < 90000;) {
    await new Promise(r => setTimeout(r, 2000));
    const u = await fetch('/api/update', { headers: { 'X-JobPilot': '1' } }).then(r => r.ok ? r.json() : null).catch(() => null);
    if (u?.current === version) return location.reload();
  }
  overlay('JobPilot was updated, but it did not start again by itself.', 'Open it again the usual way: double-click start.bat (Windows) or start.command / start.sh (Mac, Linux).');
}
$('#ver').onclick = guard(async () => {
  try { localStorage.removeItem('jp-skip-update'); } catch {}
  $('#ver').textContent = 'checking…';
  await loadUpdate(true);
  const u = state.update;
  if (u?.error) toast('Could not check for updates: ' + u.error, 7000);
  else if (u?.newer) { showTab('home'); window.scrollTo(0, 0); }
  else toast(`You have the latest version (${u?.current}).`);
});
const recommended = () => { const c = state.data?.counts || {}; return (c.ready || 0) + (c.manual || 0); };
// A desktop notification when a long task finishes while you are looking at something else.
function notifyDone(t, before) {
  if (!('Notification' in window) || Notification.permission !== 'granted' || !document.hidden) return;
  const r = state.lastResult, now = recommended();
  const body = r && !r.ok ? `${t.label} stopped: ${r.error || 'see the Activity log'}`
    : ['run', 'scan', 'find'].includes(t.name) ? `${now} jobs recommended for you${now > before ? ` (${now - before} new)` : ''}.` : `${t.label} finished.`;
  const n = new Notification('JobPilot', { body, tag: 'jobpilot-task' });
  n.onclick = () => { window.focus(); state.jobFilter = 'recommended'; showTab('jobs'); n.close(); };
}

// ---- shared form helpers -------------------------------------------------------------------------------
const field = (id, label, value, { type = 'text', help = '', options, req } = {}) => `<label>${label}${req ? ' <b class="req">*</b>' : ''}${options
  ? `<select id="${id}">${options.map(([v, l]) => `<option value="${esc(v)}" ${String(value ?? '') === String(v) ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select>`
  : type === 'textarea' ? `<textarea id="${id}">${esc(value ?? '')}</textarea>` : `<input id="${id}" type="${type}" value="${esc(value ?? '')}">`}${help ? `<p class="help">${help}</p>` : ''}</label>`;
const yn = [['', 'Choose…'], ['Yes', 'Yes'], ['No', 'No']];
const val = id => ($('#' + id)?.value ?? '').trim();

function cvDrop(after) {
  return {
    html: `<div class="drop" id="drop">📄 <b>Drop your CV here</b> or click to choose a file<br><span class="muted">PDF or Word</span><input type="file" id="cvFile" accept=".pdf,.docx,.doc,.odt,.rtf,.txt" hidden></div>`,
    bind() {
      const drop = $('#drop'), input = $('#cvFile');
      drop.onclick = () => input.click();
      drop.ondragover = e => { e.preventDefault(); drop.classList.add('over'); };
      drop.ondragleave = () => drop.classList.remove('over');
      const upload = guard(async f => {
        if (!f) return;
        if (state.data.hasCv && !confirm('Replace your profile with what is read from this CV? Your answers and job list are kept.')) return;
        const r = await fetch(`/api/users/${state.user}/upload-cv`, { method: 'POST', body: f, headers: { 'X-JobPilot': '1', 'X-Filename': encodeURIComponent(f.name) } });
        if (!r.ok) throw new Error((await r.json()).error);
        after?.();
      });
      drop.ondrop = e => { e.preventDefault(); drop.classList.remove('over'); upload(e.dataTransfer.files[0]); };
      input.onchange = () => upload(input.files[0]);
    }
  };
}

function aboutForm(p) {
  const e = p.education || {};
  return `
    <div class="card"><h2>Your contact details</h2><p class="muted">Read from your CV. Please check them: they go on every application.</p><div class="grid2">
      ${field('firstName', 'First name', p.firstName, { req: 1 })}${field('lastName', 'Last name', p.lastName, { req: 1 })}
      ${field('email', 'Email', p.email, { type: 'email', req: 1 })}${field('phone', 'Phone', p.phone, { req: 1, help: 'with country code, e.g. +353 83 123 4567' })}
      ${field('city', 'Where you live (town or city)', p.city, { req: 1 })}${field('linkedin', 'LinkedIn profile link (if you have one)', p.linkedin)}
      ${field('currentEmployer', 'Current or last employer', p.currentEmployer)}${field('currentTitle', 'Current or last job title', p.currentTitle)}
    </div></div>
    <div class="card"><h2>Questions almost every form asks</h2><p class="muted">Answer once here and they are used on every application.</p><div class="grid2">
      ${field('workAuthorized', 'Are you allowed to work in Ireland?', p.workAuthorized, { options: yn, req: 1 })}
      ${field('needsSponsorship', 'Do you need a visa or work permit sponsored?', p.needsSponsorship, { options: yn, req: 1 })}
      ${field('visaStatus', 'Your status in words', p.visaStatus, { help: 'e.g. "Irish citizen", "EU citizen", "Stamp 4"' })}
      ${field('nationality', 'Nationality', p.nationality)}
      ${field('noticePeriod', 'Notice period at your current job', p.noticePeriod, { req: 1, help: 'e.g. "1 week", "2 weeks", "1 month", or "None"' })}
      ${field('noticeDays', 'Notice period in days', p.noticeDays ?? 14, { type: 'number' })}
      ${field('currentPay', 'What you earn now (optional, private)', p.currentPay, { help: 'Only used to suggest better-paid options, e.g. "minimum wage" or "€28,000"' })}
      ${field('salaryText', 'Pay you would ask for', p.salaryText, { req: 1, help: 'e.g. "€30,000 to €34,000 a year depending on the role"' })}
      ${field('salaryNumber', 'Same as a single number (yearly €)', p.salaryNumber, { type: 'number' })}
      ${field('onsiteOk', 'Happy to work on site / in an office?', p.onsiteOk, { options: yn })}
      ${field('shiftWorkOk', 'Happy to do shifts or weekends?', p.shiftWorkOk, { options: yn })}
      ${field('basedInRegion', 'Do you live in Europe?', p.basedInRegion || 'Yes', { options: yn })}
      ${field('languages', 'Languages you speak (comma separated)', (p.languages || ['English']).join(', '))}
    </div></div>
    <div class="card"><h2>Education (for forms that ask)</h2><div class="grid2">
      ${field('school', 'School / college', e.school)}
      ${field('degreeOption', 'Highest level', e.degreeOption, { options: [['', 'Choose…'], ['High School', 'Leaving Cert / secondary school'], ["Associate's Degree", 'QQI Level 5-6 / Higher Certificate'], ["Bachelor's Degree", "Bachelor's degree"], ["Master's Degree", "Master's degree"], ['Doctor of Philosophy (Ph.D.)', 'PhD'], ['Other', 'Other']] })}
    </div><p class="help">Questions about gender, ethnicity, disability and similar are always answered "prefer not to say" or left blank.</p></div>`;
}
async function saveAbout(required) {
  const missing = [['firstName', 'first name'], ['lastName', 'last name'], ['email', 'email'], ['phone', 'phone'], ['city', 'town or city'],
    ['workAuthorized', 'permission to work'], ['needsSponsorship', 'sponsorship'], ['noticePeriod', 'notice period'], ['salaryText', 'pay you would ask for']].filter(([k]) => !val(k));
  if (required && missing.length) throw new Error('Please fill in: ' + missing.map(m => m[1]).join(', '));
  if (val('email') && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(val('email'))) throw new Error('That email address does not look right');
  if (val('phone') && val('phone').replace(/\D/g, '').length < 8) throw new Error('That phone number looks too short');
  const fn = val('firstName'), ln = val('lastName'), e = state.data.profile.education || {};
  await put(`/users/${state.user}/profile`, {
    firstName: fn, lastName: ln, fullName: `${fn} ${ln}`.trim(), email: val('email'), phone: val('phone'), city: val('city'),
    linkedin: val('linkedin') && !/^https?:/.test(val('linkedin')) ? 'https://' + val('linkedin') : val('linkedin'),
    currentEmployer: val('currentEmployer'), currentTitle: val('currentTitle'), workAuthorized: val('workAuthorized'), needsSponsorship: val('needsSponsorship'),
    visaStatus: val('visaStatus'), nationality: val('nationality'), noticePeriod: val('noticePeriod'), noticeDays: +val('noticeDays') || 14,
    currentPay: val('currentPay'), salaryText: val('salaryText'), salaryNumber: +val('salaryNumber') || '', onsiteOk: val('onsiteOk'), shiftWorkOk: val('shiftWorkOk'),
    basedInRegion: val('basedInRegion'), languages: val('languages').split(',').map(s => s.trim()).filter(Boolean),
    locationText: [val('city'), 'Ireland'].join(', '), education: { ...e, school: val('school'), degreeOption: val('degreeOption'), degreeFallback: val('degreeOption') }
  });
  state.data = await api(`/users/${state.user}`);
}

// Title picker: suggestions as tick boxes + "add your own".
function titlePicker(suggested, chosen) {
  const all = [...new Set([...chosen, ...suggested])];
  return `<div class="picks" id="picks">${all.map(t => `<label class="pick"><input type="checkbox" value="${esc(t)}" ${chosen.includes(t) ? 'checked' : ''}> ${esc(t)}</label>`).join('')}</div>
    <div class="row" style="margin-top:10px"><input id="ownTitle" placeholder="Add your own job title, e.g. Receptionist"><button id="addTitle">Add</button></div>`;
}
function bindTitlePicker() {
  const add = () => { const v = val('ownTitle'); if (!v) return; $('#picks').insertAdjacentHTML('beforeend', `<label class="pick"><input type="checkbox" value="${esc(v)}" checked> ${esc(v)}</label>`); $('#ownTitle').value = ''; };
  $('#addTitle').onclick = add; $('#ownTitle').onkeydown = e => { if (e.key === 'Enter') { e.preventDefault(); add(); } };
}
const pickedTitles = () => $$('#picks input:checked').map(i => i.value);

function modeChooser(s) {
  const a = s.auto || {};
  return `<div class="modes">
      <label class="modecard"><input type="radio" name="mode" value="help" ${s.mode !== 'auto' ? 'checked' : ''}>
        <h3>🧭 Help me apply</h3><p>JobPilot finds and ranks jobs, explains why each fits, and makes a <b>tailored CV and cover letter</b> for every recommended job. <b>You</b> open the link and apply. It can also fill in a form for you to check and submit.</p><p class="muted">Recommended to start with.</p></label>
      <label class="modecard"><input type="radio" name="mode" value="auto" ${s.mode === 'auto' ? 'checked' : ''}>
        <h3>🚀 Apply for me</h3><p>Everything above, and JobPilot also <b>submits applications by itself</b> on company sites it can fill in, within the limits below. Jobs it cannot submit safely stay in your list with their CV and letter.</p></label>
    </div>
    <div id="autoBox" class="card ${s.mode === 'auto' ? '' : 'hide'}"><h3>Limits for automatic applications</h3><div class="grid2">
      ${field('minScore', 'Only apply when the fit score is at least', a.minScore ?? 80, { type: 'number', help: '80 = only strong fits. Lower means more applications.' })}
      ${field('dailyLimit', 'Most automatic applications per day', a.dailyLimit ?? 10, { type: 'number' })}</div>
      <ul class="muted small"><li>Only when every required question is answered from your profile and the form is checked complete.</li>
      <li>Never for legal declarations, "I didn't use AI" statements, criminal record or anything your profile doesn't cover: those come to you.</li>
      <li>Never solves CAPTCHAs; one application per company per run; a screenshot is kept of every submission.</li></ul>
      <label class="row consent"><input type="checkbox" id="autoConsent" ${a.consentAt ? 'checked' : ''}> I understand JobPilot will submit job applications in my name without me checking each one first.</label>
    </div>`;
}
function bindModeChooser() { $$('input[name=mode]').forEach(r => r.onchange = () => $('#autoBox').classList.toggle('hide', $('input[name=mode]:checked').value !== 'auto')); }
async function saveMode() {
  const mode = $('input[name=mode]:checked').value;
  if (mode === 'auto' && !$('#autoConsent').checked) throw new Error('Tick the box to confirm automatic applications, or choose "Help me apply".');
  await put(`/users/${state.user}/settings`, mode === 'auto'
    ? { mode, autoConsent: true, auto: { minScore: Math.min(95, Math.max(60, +val('minScore') || 80)), dailyLimit: Math.min(50, Math.max(1, +val('dailyLimit') || 10)) } }
    : { mode });
}

// ---- first-time setup wizard ------------------------------------------------------------------------------
const WIZ = ['Your CV', 'Your details', 'Explore careers', 'Jobs to look for', 'How to apply', 'Market scan'];
function showSetup() {
  state.tab = 'setup';
  $$('.view').forEach(v => v.classList.toggle('hide', v.id !== 'setup'));
  $('#tabs').classList.add('hide');
  if (state.wiz === 0 && state.data.hasCv) state.wiz = 1;
  renderWizard();
}
function renderWizard() {
  const i = state.wiz, d = state.data, body = $('#wizBody');
  $('#wizSteps').innerHTML = WIZ.map((w, k) => `<li class="${k < i ? 'done' : k === i ? 'on' : ''}">${k < i ? '✓' : k + 1}. ${w}</li>`).join('');
  const go = n => { state.wiz = n; renderWizard(); window.scrollTo(0, 0); };
  const nav = (nextLabel = 'Next →') => `<div class="savebar">${i > 0 ? '<button id="wBack" class="ghost">← Back</button>' : ''}<button id="wNext" class="primary">${nextLabel}</button></div>`;
  const bindBack = () => $('#wBack') && ($('#wBack').onclick = () => go(i - 1));

  if (i === 0) {
    const drop = cvDrop(() => {
      body.innerHTML = `<div class="card"><h2>Reading your CV…</h2><p class="muted">About a minute. You can watch what it is doing:</p><pre id="wizLog" class="log" style="height:180px"></pre></div>`;
      onTaskDone.push(() => {
        const r = state.lastResult;
        if (!state.data.hasCv || (r && !r.ok)) { state.cvError = r?.error || 'The CV could not be read.'; return go(0); }
        state.cvError = null;
        const w = state.data.onboarding?.warnings || [];
        if (w.length) toast(`${w.length} line(s) differ from your original CV: please check them in Profile → Your CV.`, 9000);
        go(1);
      });
    });
    body.innerHTML = `<div class="card"><h2>Hi ${esc(d.profile.firstName || d.profile.fullName || '')}! Let's start with your CV</h2>
      <p>JobPilot reads it, fills in your details, and suggests jobs you could do.</p>
      ${state.cvError ? `<div class="problem"><b>That did not work:</b> ${esc(state.cvError)}</div>` : ''}
      <div id="aiState" class="muted">Checking that the AI (Claude Code) is ready…</div><div id="dropWrap" class="hide">${drop.html}</div></div>`;
    drop.bind();
    const check = async fresh => {
      $('#aiState').className = 'muted'; $('#aiState').textContent = 'Checking that the AI (Claude Code) is ready… (up to a minute)';
      const r = await api('/ai-check' + (fresh ? '?fresh=1' : '')).catch(e => ({ ok: false, detail: e.message }));
      if (!$('#aiState')) return;
      if (r.ok) { $('#aiState').className = 'okbox'; $('#aiState').textContent = '✓ The AI is ready.'; $('#dropWrap').classList.remove('hide'); }
      else { $('#aiState').className = 'problem'; $('#aiState').innerHTML = `<b>The AI is not ready yet, so your CV cannot be read.</b><br>${esc(r.detail)}<br><button id="aiAgain" class="small" style="margin-top:8px">Check again</button>`;
        $('#aiAgain').onclick = () => check(true); }
    };
    check(false);
    return;
  }
  if (i === 1) {
    body.innerHTML = aboutForm(d.profile) + nav();
    bindBack(); $('#wNext').onclick = guard(async () => { await saveAbout(true); go(2); });
    return;
  }
  if (i === 2) {
    body.innerHTML = `<div class="card"><h2>Not sure what to look for?</h2><p>Take a 2-minute quiz. JobPilot combines it with your CV and suggests <b>better-paid jobs you could realistically get</b>, checked against real job ads near you. You can skip this.</p>
      <div class="row"><button id="takeQuiz" class="primary">Take the quiz</button><button id="skipQuiz" class="ghost">Skip, I know what I want</button></div></div>
      <div id="careerInline"></div>${nav()}`;
    bindBack();
    $('#takeQuiz').onclick = () => quiz($('#careerInline'), () => go(2));
    $('#skipQuiz').onclick = () => go(3); $('#wNext').onclick = () => go(3);
    if (d.hasCareers) careerResults($('#careerInline'), true);
    return;
  }
  if (i === 3) {
    const se = d.settings.search;
    api(`/users/${state.user}/careers`).then(c => {
      const fromCareers = (c?.options || []).filter(o => o.picked).flatMap(o => o.searchTitles);
      body.innerHTML = `<div class="card"><h2>Which jobs should JobPilot look for?</h2><p>Suggested from your CV${fromCareers.length ? ' and the careers you picked' : ''}. Untick any you don't want and add your own.</p>
        ${titlePicker([...se.titles, ...fromCareers], [...new Set([...se.titles, ...fromCareers])])}</div>
        <div class="card"><h2>Where and how much</h2><div class="grid2">
          ${field('city', 'Area', se.city || d.profile.city || 'Dublin')}
          ${field('remote', 'Remote jobs too?', se.remote, { options: [['none', 'No, only jobs near me'], ['country', 'Yes, remote within Ireland'], ['europe', 'Yes, remote across Europe'], ['anywhere', 'Yes, remote anywhere']] })}
          ${field('minSalary', 'Lowest yearly pay you would accept (€, 0 = any)', d.settings.apply.minSalary || 0, { type: 'number' })}</div></div>${nav()}`;
      bindTitlePicker(); bindBack();
      $('#wNext').onclick = guard(async () => {
        const titles = pickedTitles(); if (!titles.length) throw new Error('Pick at least one job title');
        $('#wNext').disabled = true; $('#wNext').textContent = 'Saving…';
        try {
          await put(`/users/${state.user}/settings`, { search: { city: val('city'), remote: val('remote') }, apply: { minSalary: +val('minSalary') || 0 } });
          await post(`/users/${state.user}/titles`, { titles });
          state.data = await api(`/users/${state.user}`); go(4);
        } finally { if ($('#wNext')) { $('#wNext').disabled = false; } }
      });
    }).catch(e => toast(e.message));
    return;
  }
  if (i === 4) {
    body.innerHTML = `<div class="card"><h2>How should JobPilot help?</h2><p class="muted">You can change this any time in Profile → How to apply.</p>${modeChooser(d.settings)}</div>${nav()}`;
    bindModeChooser(); bindBack();
    $('#wNext').onclick = guard(async () => { await saveMode(); state.data = await api(`/users/${state.user}`); go(5); });
    return;
  }
  body.innerHTML = `<div class="card"><h2>Ready for your first market scan</h2>
    <p>JobPilot searches every job site for the last 2 weeks, scores each job against your CV, makes a tailored CV and cover letter for the best ones${d.settings.mode === 'auto' ? ', applies to the strongest fits' : ''}, and builds your market report.</p>
    <p class="muted">It takes about 10-15 minutes. A browser window may open and close by itself: leave it alone.</p>
    <button id="startScan" class="primary big">▶ Start my first scan</button><pre id="wizLog" class="log hide" style="height:260px;margin-top:12px"></pre></div>${nav('Skip for now')}`;
  bindBack();
  const finish = () => put(`/users/${state.user}/settings`, { setupDone: true });
  $('#wNext').onclick = guard(async () => { await finish(); state.tab = 'home'; await refresh(); });
  $('#startScan').onclick = guard(async () => {
    await runTask('scan'); $('#startScan').disabled = true; $('#startScan').textContent = 'Scanning…'; $('#wizLog').classList.remove('hide');
    onTaskDone.push(async () => { await finish(); state.tab = 'market'; await refresh(); toast('Your market report is ready'); });
  });
}

// ---- career explorer --------------------------------------------------------------------------------------
async function quiz(el, done) {
  const qs = await api('/quiz');
  el.innerHTML = `<div class="card"><h2>Career quiz</h2><p class="muted">Pick everything that applies. Skip anything you like.</p>
    ${qs.map(q => `<div class="quizq"><b>${esc(q.q)}</b><div class="opts">${q.free ? `<input data-q="${q.id}" placeholder="Optional">`
      : q.options.map(o => `<label class="pick"><input type="${q.multi ? 'checkbox' : 'radio'}" name="q_${q.id}" value="${esc(o)}"> ${esc(o)}</label>`).join('')}</div></div>`).join('')}
    <button id="quizGo" class="primary">Show me career options</button><pre id="wizLog" class="log hide" style="height:160px;margin-top:12px"></pre></div>`;
  $('#quizGo').onclick = guard(async () => {
    const answers = {};
    for (const q of qs) answers[q.id] = q.free ? (el.querySelector(`[data-q="${q.id}"]`).value || '') : [...el.querySelectorAll(`input[name="q_${q.id}"]:checked`)].map(i => i.value);
    await post(`/users/${state.user}/careers`, { answers });
    $('#quizGo').disabled = true; $('#quizGo').textContent = 'Thinking… (about a minute)'; $('#wizLog').classList.remove('hide');
    onTaskDone.push(() => done());
  });
}
async function careerResults(el, inWizard) {
  const c = await api(`/users/${state.user}/careers`);
  if (!c) { el.innerHTML = ''; return; }
  el.innerHTML = `<div class="card"><h2>Career options for you</h2><p class="muted">Salary ranges are estimates. "Open now nearby" and "pay stated in ads" come from live job ads today. Tick the ones you want to search for.</p>
    ${c.options.map((o, i) => `<div class="career">
      <div class="row between wrap"><label class="h3"><input type="checkbox" class="cpick" data-i="${i}" ${o.picked ? 'checked' : ''}> ${esc(o.career)}</label><span class="tag">${esc(o.timeToStart)}</span></div>
      <p>${esc(o.why)}</p>
      <div class="kv"><span>💶 ${esc(o.salaryEstimate)}</span><span>📋 ${o.openJobs ?? 0} open now nearby</span><span>📈 pay stated in ads: ${o.salaryMedian ? eur(o.salaryMedian) + ' typical' : 'not enough ads say'}</span></div>
      <p class="muted"><b>To get in:</b> ${esc(o.entry)}</p>
      <ul>${o.firstSteps.map(s => `<li>${esc(s)}</li>`).join('')}</ul>
      <p class="muted">Job titles searched: ${o.searchTitles.map(esc).join(', ')}</p></div>`).join('')}
    ${inWizard ? '<p class="muted">Ticked careers are added to your job titles on the next step.</p>' : `<button id="useCareers" class="primary">Add the ticked careers to my job search</button>`}</div>`;
  const picks = () => c.options.map((o, i) => !!el.querySelector(`.cpick[data-i="${i}"]`)?.checked);
  $$('.cpick').forEach(cb => cb.onchange = guard(() => put(`/users/${state.user}/careers-picks`, { picks: picks() })));
  $('#useCareers') && ($('#useCareers').onclick = guard(async () => {
    const p = picks(), add = c.options.filter((o, i) => p[i]).flatMap(o => o.searchTitles);
    if (!add.length) throw new Error('Tick at least one career first');
    await put(`/users/${state.user}/careers-picks`, { picks: p });
    await post(`/users/${state.user}/titles`, { titles: [...new Set([...state.data.settings.search.titles, ...add])] });
    toast(`Added ${add.length} job titles to your search. Press "Daily run" on Home to search for them.`, 7000); state.data = await api(`/users/${state.user}`);
  }));
}
async function renderCareers() {
  const el = $('#careersBody');
  el.innerHTML = `<div class="card"><div class="row between wrap"><div><h2>Career explorer</h2><p class="muted">Find better-paid work that fits you: a short quiz plus your CV, checked against real job ads.</p></div>
    <button id="retake" class="primary">${state.data.hasCareers ? 'Retake the quiz' : 'Take the quiz'}</button></div></div><div id="careerList"></div>`;
  $('#retake').onclick = () => quiz($('#careerList'), () => showTab('careers'));
  await careerResults($('#careerList'), false);
}

// ---- home --------------------------------------------------------------------------------------------------
function renderHome() {
  const d = state.data, c = d.counts, auto = d.settings.mode === 'auto';
  $('#modeBanner').innerHTML = auto
    ? `<b>🚀 Apply for me</b> is on: strong fits (score ${d.settings.auto.minScore}+) are submitted automatically, up to ${d.settings.auto.dailyLimit} a day. <a href="#" data-goto="mode">Change</a>`
    : `<b>🧭 Help me apply</b>: JobPilot recommends jobs and makes a tailored CV and cover letter for each; you apply. <a href="#" data-goto="mode">Change</a>`;
  const sc = d.settings.schedule || {};
  $('#modeBanner').innerHTML += `<div class="small" style="margin-top:4px">⏰ ${sc.on ? `Daily run starts by itself ${sc.days === 'weekdays' ? 'every weekday' : 'every day'} at ${esc(sc.time)} while JobPilot is open.`
    : 'Daily run: only when you press the button.'} <a href="#" data-goto="search">${sc.on ? 'Change' : 'Run it automatically'}</a></div>`;
  const rec = (c.ready || 0) + (c.manual || 0);
  const stats = [['recommended', rec, 'Recommended for you'], ['needs_input', c.needs_input || 0, 'Need your answers'],
    ...(auto ? [['submitted', d.autoToday, 'Applied for you today']] : [['ready_to_submit', c.ready_to_submit || 0, 'Forms filled, ready to send']]),
    ['submitted', c.submitted || 0, 'Applied in total'], ...(d.followUps ? [['results', d.followUps, 'Follow-ups due']] : [])];
  $('#stats').innerHTML = stats.map(([k, n, l]) => `<div class="stat" data-go="${k}"><b>${n}</b><span>${l}</span></div>`).join('');
  $$('.stat').forEach(s => s.onclick = () => {
    if (s.dataset.go === 'results') return showTab('results');
    state.jobFilter = s.dataset.go; showTab(s.dataset.go === 'needs_input' && d.questions ? 'questions' : 'jobs');
  });
  $('#actions').innerHTML = `
    <button class="primary big" data-run="run">▶ Daily run<small>find new jobs, score them, make CVs and letters${auto ? ', apply to strong fits' : ''}</small></button>
    <button class="big" data-show="jobs">⭐ My recommended jobs<small>links, why they fit, tailored CV and cover letter</small></button>
    <button class="big" data-show="market">📊 Market report<small>demand, pay, who is hiring</small></button>
    ${c.ready_to_submit ? `<button class="big accent" data-run="review">✅ Review &amp; submit<small>${c.ready_to_submit} filled form(s) waiting for you</small></button>` : ''}
    <button class="big ghost" data-run="login">🔑 Sign in to job sites<small>IrishJobs, Jobs.ie, LinkedIn</small></button>`;
  $$('[data-run]').forEach(b => { b.disabled = !!state.task; b.onclick = guard(async () => {
    if (b.dataset.run === 'review') toast('A browser window opens with the first form. Check it, click Submit, then close the tab for the next one.', 8000);
    if (b.dataset.run === 'login') toast('A Chrome window opens. Sign in on each tab, then close the window.', 8000);
    await runTask(b.dataset.run);
  }); });
  $$('[data-show]').forEach(b => b.onclick = () => { if (b.dataset.show === 'jobs') state.jobFilter = 'recommended'; showTab(b.dataset.show); });
  $$('[data-goto]').forEach(a => a.onclick = e => { e.preventDefault(); state.step = a.dataset.goto; showTab('profile'); });
}

// ---- jobs ----------------------------------------------------------------------------------------------------
const FILTERS = [['recommended', 'Recommended'], ['needs_input', 'Need answers'], ['ready_to_submit', 'Form filled'], ['submitted', 'Applied'], ['failed', 'Problems'], ['skipped', 'Not a fit'], ['', 'All']];
const STATUS_LABEL = { new: 'New', ready: 'Recommended', manual: 'Recommended', ready_to_submit: 'Form filled, ready to send', needs_input: 'Needs your answers',
  submitted: 'Applied', skipped: 'Not a fit', failed: 'Problem', closed: 'Closed', duplicate: 'Duplicate', excluded: 'Excluded' };
const statusQuery = f => f === 'recommended' ? 'ready,manual' : f;
async function renderJobs() {
  const c = state.data.counts, count = k => k === 'recommended' ? (c.ready || 0) + (c.manual || 0) : c[k];
  $('#jobFilters').innerHTML = FILTERS.map(([k, l]) => `<span class="chip ${state.jobFilter === k ? 'on' : ''}" data-f="${k}">${l}${k && count(k) ? ` (${count(k)})` : ''}</span>`).join('');
  $$('#jobFilters .chip').forEach(ch => ch.onclick = () => { state.jobFilter = ch.dataset.f; renderJobs(); });
  const jobs = await api(`/users/${state.user}/jobs${state.jobFilter ? '?status=' + statusQuery(state.jobFilter) : ''}`);
  const q = $('#jobSearch').value.toLowerCase();
  const list = jobs.filter(j => !q || `${j.title} ${j.company}`.toLowerCase().includes(q));
  $('#jobList').innerHTML = list.length ? list.map(jobCard).join('') : `<div class="card muted">Nothing here yet. Press <b>Daily run</b> on Home to search.</div>`;
  bindJobButtons(list);
}
function jobCard(j) {
  const k = j.kit;
  return `<div class="job">
    <div class="score" title="How well it fits you (0-100)">${j.score ?? '–'}</div>
    <div>
      <h3>${esc(j.title)}</h3>
      <div class="meta">${j.followed ? '<span class="tag follow" title="A company you follow">★ Following</span> ' : ''}${esc(j.company)} · ${esc(j.location || '')} · <span class="tag ${j.status}">${j.autoSubmitted ? 'Applied for you' : STATUS_LABEL[j.status] || j.status}</span> <span class="tag">${esc(j.source || '')}</span></div>
      ${j.reason ? `<div class="why">💡 ${esc(j.reason)}</div>` : ''}
      ${j.status === 'skipped' && j.verdict?.reason ? `<div class="why muted">You said: ${esc(j.verdict.reason)}</div>` : ''}
      ${j.status === 'needs_input' ? `<div class="why">Waiting on: ${esc(j.pending.map(p => p.label).join('; ').slice(0, 220))}</div>` : ''}
      ${j.problems.length || j.error ? `<div class="why" style="color:var(--red)">${esc(j.error || j.problems.map(p => p.label + ': ' + p.why).join('; ').slice(0, 220))}</div>` : ''}
      ${k ? `<details class="kit"><summary>📎 Your tailored CV and cover letter</summary>
          <div class="links"><a href="${file(k.cvPdf)}" target="_blank">CV (PDF)</a>${k.cvDocx ? `<a href="${file(k.cvDocx)}">CV (Word)</a>` : ''}<a href="${file(k.letterPdf)}" target="_blank">Cover letter (PDF)</a>${k.letterDocx ? `<a href="${file(k.letterDocx)}">Cover letter (Word)</a>` : ''}<a href="#" data-copy="${esc(j.id)}">Copy cover letter text</a></div>
          <b>What was changed in your CV:</b><ul>${k.changes.map(x => `<li>${esc(x)}</li>`).join('')}</ul></details>` : ''}
      ${j.status === 'submitted' ? outcomeRow(j) : ''}
      ${prepPanel(j)}
      <div class="links"><a href="${esc(j.url)}" target="_blank" rel="noopener">Open the job ad ↗</a>
        ${j.screenshot ? `<a href="${file(j.screenshot)}" target="_blank">Filled form</a>` : ''}${j.submittedShot ? `<a href="${file(j.submittedShot)}" target="_blank">Submission screenshot</a>` : ''}</div>
    </div>
    <div class="btns">
      ${['ready', 'manual'].includes(j.status) && !k ? `<button class="small" data-kit="${esc(j.id)}">Make CV + letter</button>` : ''}
      ${['ready', 'needs_input', 'ready_to_submit'].includes(j.status) && j.canFill ? `<button class="small accent" data-review="${esc(j.id)}">Fill the form for me</button>` : ''}
      ${j.status === 'submitted' && ['interview', 'offer'].includes(j.outcome) ? `<button class="small accent" data-prep="${esc(j.id)}">${j.prep ? 'Redo interview prep' : 'Prepare for interview'}</button>` : ''}
      ${j.status !== 'submitted' ? (j.hasTailoredCv
        ? `<span class="applied-with" data-id="${esc(j.id)}"><button class="small accent" data-applied="${esc(j.id)}">I applied</button></span>`
        : `<button class="small accent" data-mark="submitted" data-id="${esc(j.id)}">I applied</button>`) : ''}
      ${!['submitted', 'skipped'].includes(j.status) ? `<span class="skip-why"><button class="small ghost" data-skip="${esc(j.id)}">Not for me</button></span>` : ''}
      ${j.status === 'skipped' ? `<button class="small ghost" data-mark="ready" data-id="${esc(j.id)}">Recommend anyway</button>` : ''}
    </div></div>`;
}
// After applying: what happened, plus a nudge to follow up (10+ days) or close it (30+ days).
const OUTCOMES = [['waiting', 'Waiting to hear'], ['replied', 'Heard back'], ['interview', 'Interview'], ['offer', 'Offer'], ['rejected', 'Rejected'], ['no_reply', 'No reply']];
const nudgeText = n => n.kind === 'follow_up'
  ? `⏰ Applied ${n.days} days ago with no reply. A short, polite follow-up email to the recruiter often helps.`
  : `No reply after ${n.days} days. Mark it as "No reply" to keep your results accurate.`;
// A polite follow-up email to copy into your mail app (no AI needed).
function followUpEmail(j) {
  const p = state.data.profile, when = j.submittedAt ? new Date(j.submittedAt).toLocaleDateString('en-IE', { day: 'numeric', month: 'long' }) : 'recently';
  return `Subject: Following up on my application for ${j.title}\n\nHello,\n\nI applied for the ${j.title} role at ${j.company} on ${when} and wanted to follow up. ` +
    `I am still very interested in the position and would be glad to share anything else that would help with your decision.\n\nThank you for your time.\n\nKind regards,\n${p.fullName || ''}${p.phone ? '\n' + p.phone : ''}`;
}
// Interview prep notes, once made.
function prepPanel(j) {
  const p = j.prep;
  if (!p) return '';
  return `<details class="kit"><summary>🎯 Interview prep</summary>
    <h3>About you in 30 seconds</h3><p>${esc(p.pitch)}</p>
    <h3>Questions they are likely to ask</h3>${p.questions.map(q => `<div class="prepq"><b>${esc(q.q)}</b><div class="muted small">${esc(q.why)}</div><div>${esc(q.answer)}</div></div>`).join('')}
    <h3>Questions to ask them</h3><ul>${p.askThem.map(x => `<li>${esc(x)}</li>`).join('')}</ul>
    <h3>Before the interview</h3><ul>${p.prepare.map(x => `<li>${esc(x)}</li>`).join('')}</ul></details>`;
}
function outcomeRow(j) {
  return `<div class="outcome"><div class="row wrap"><label class="row">What happened? <select data-outcome="${esc(j.id)}" style="width:auto">${OUTCOMES.map(([v, l]) =>
      `<option value="${v}" ${(j.outcome || 'waiting') === v ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
    ${j.hasTailoredCv ? `<label class="row">CV sent <select data-cvused="${esc(j.id)}" style="width:auto">${[['', 'Not recorded'], ['tailored', 'Tailored'], ['standard', 'Standard']].map(([v, l]) =>
      `<option value="${v}" ${(j.cvUsed || '') === v ? 'selected' : ''} ${!v ? 'disabled' : ''}>${l}</option>`).join('')}</select></label>` : ''}</div>
    ${j.nudge ? `<div class="why">${nudgeText(j.nudge)} ${j.nudge.kind === 'follow_up' ? `<button class="small" data-email="${esc(j.id)}">Copy a follow-up email</button> <button class="small" data-followed="${esc(j.id)}">I followed up</button>`
      : `<button class="small" data-noreply="${esc(j.id)}">Mark as no reply</button>`}</div>` : ''}</div>`;
}
function bindOutcomeButtons(after, jobs = []) {
  const set = (id, body) => post(`/users/${state.user}/jobs/${encodeURIComponent(id)}`, body).then(refresh).then(() => after?.());
  $$('[data-outcome]').forEach(sel => sel.onchange = guard(() => set(sel.dataset.outcome, { outcome: sel.value })));
  $$('[data-cvused]').forEach(sel => sel.onchange = guard(() => set(sel.dataset.cvused, { cvUsed: sel.value })));
  $$('[data-followed]').forEach(b => b.onclick = guard(() => set(b.dataset.followed, { followedUp: true })));
  $$('[data-noreply]').forEach(b => b.onclick = guard(() => set(b.dataset.noreply, { outcome: 'no_reply' })));
  $$('[data-email]').forEach(b => b.onclick = guard(async () => {
    const j = jobs.find(x => x.id === b.dataset.email); if (!j) return;
    await navigator.clipboard.writeText(followUpEmail(j)); toast('Follow-up email copied: paste it into a reply to the recruiter or the company\'s jobs address.', 7000);
  }));
  $$('[data-prep]').forEach(b => b.onclick = guard(async () => {
    await runTask('prep', [b.dataset.prep]); toast('Writing your interview notes (about a minute)…');
    onTaskDone.push(() => showTab(state.tab));
  }));
}
function bindJobButtons(list) {
  bindOutcomeButtons(null, list);
  const mark = guard(async (id, body) => { await post(`/users/${state.user}/jobs/${encodeURIComponent(id)}`, body); await refresh(); });
  $$('[data-mark]').forEach(b => b.onclick = () => mark(b.dataset.id, { status: b.dataset.mark }));
  // "Not for me": a one-tap reason teaches the scoring what to avoid (it is optional).
  const SKIP_REASONS = ['Wrong kind of work', 'Too senior', 'Too junior', 'Too far / wrong location', 'Pay too low', 'Not this company', 'Other'];
  $$('[data-skip]').forEach(b => b.onclick = () => {
    const id = b.dataset.skip, box = b.parentElement;
    box.innerHTML = `<div class="reasons"><span class="muted small">Why? (helps future scoring)</span>${SKIP_REASONS.map(r => `<button class="small ghost" data-why="${esc(r)}">${esc(r)}</button>`).join('')}<button class="small ghost" data-why="">Just skip</button></div>`;
    box.querySelectorAll('[data-why]').forEach(w => w.onclick = () => {
      const reason = w.dataset.why === 'Other' ? (prompt('In a few words, why is this job not for you?') || '') : w.dataset.why;
      mark(id, { status: 'skipped', reason });
    });
  });
  // A tailored CV exists: ask which one went with the application, so Results compares what was sent.
  $$('[data-applied]').forEach(b => b.onclick = () => {
    const box = b.parentElement, id = box.dataset.id;
    box.innerHTML = `<span class="muted small">Which CV did you send?</span> <button class="small accent" data-cv="tailored">Tailored</button> <button class="small" data-cv="standard">Standard</button>`;
    box.querySelectorAll('[data-cv]').forEach(c => c.onclick = () => mark(id, { status: 'submitted', cvUsed: c.dataset.cv }));
  });
  $$('[data-review]').forEach(b => b.onclick = guard(async () => { toast('Opening the form in a browser window. Check it, click Submit, then close the tab.', 8000); await runTask('review', [b.dataset.review]); showTab('home'); }));
  $$('[data-kit]').forEach(b => b.onclick = guard(async () => { await runTask('kits', [b.dataset.kit]); toast('Making the tailored CV and cover letter (about a minute)…'); onTaskDone.push(() => showTab('jobs')); }));
  $$('[data-copy]').forEach(a => a.onclick = guard(async e => { e.preventDefault(); const j = list.find(x => x.id === a.dataset.copy); await navigator.clipboard.writeText(j.kit.letter); toast('Cover letter copied: paste it into the application.'); }));
}
$('#jobSearch').oninput = () => renderJobs();

// ---- results ------------------------------------------------------------------------------------------------
async function renderResults() {
  const r = await api(`/users/${state.user}/outcomes`), t = r.total, el = $('#resultsBody');
  if (!t.applied) {
    el.innerHTML = `<div class="card"><h2>No applications yet</h2><p class="muted">When you apply (press "I applied" on a job, or let JobPilot apply for you), record here what happened next: replies, interviews, offers. JobPilot then shows which job sites, CV versions and fit scores actually get you answers, and reminds you to follow up.</p></div>`;
    return;
  }
  const pct = (a, b) => b ? Math.round(100 * a / b) + '%' : '–';
  const table = (title, rows) => rows.length > 1 ? `<div class="card"><h2>${title}</h2><div class="tblwrap"><table class="tbl">
    <tr><th></th><th>Applied</th><th>Heard back</th><th>Interviews</th><th>Offers</th><th>Reply rate</th></tr>
    ${rows.map(x => `<tr><td>${esc(x.label)}</td><td>${x.applied}</td><td>${x.responded}</td><td>${x.interviews}</td><td>${x.offers}</td>
      <td>${x.responseRate}%${x.applied < 10 ? ' <span class="muted small">(few)</span>' : ''}</td></tr>`).join('')}</table></div></div>` : '';
  el.innerHTML = `
    <div class="stats">
      <div class="stat"><b>${t.applied}</b><span>applied</span></div>
      <div class="stat"><b>${t.responded}</b><span>heard back (${t.responseRate}%)</span></div>
      <div class="stat"><b>${t.interviews}</b><span>interviews (${pct(t.interviews, t.applied)})</span></div>
      <div class="stat"><b>${t.offers}</b><span>offers</span></div>
      <div class="stat"><b>${t.noReply}</b><span>no reply after a month</span></div>
    </div>
    <div class="card"><h2>Follow-ups due</h2>
      ${r.nudges.length ? r.nudges.map(n => `<div class="q"><b>${esc(n.title)}</b> <span class="muted">${esc(n.company)}</span> · <a href="${esc(n.url)}" target="_blank" rel="noopener">job ad ↗</a>
        ${outcomeRow({ ...n, outcome: 'waiting' })}</div>`).join('') : '<p class="muted">Nothing to follow up right now.</p>'}</div>
    ${table('By job site', r.bySource)}${table('By CV version', r.byCv)}${table('By fit score', r.byScore)}${table('Who applied', r.byHow)}
    <p class="help">Rates on fewer than 10 applications can swing a lot; give it a few weeks before changing your search because of them. Record outcomes on the Jobs page (Applied) or here.</p>`;
  bindOutcomeButtons(() => showTab('results'), r.nudges);
}

// ---- market -----------------------------------------------------------------------------------------------
async function renderMarket() {
  const m = await api(`/users/${state.user}/market`), el = $('#marketBody');
  if (!m) {
    el.innerHTML = `<div class="card"><h2>No market report yet</h2><p>Run a market scan to see how many jobs there are for you, what they pay and who is hiring.</p><button class="primary" id="scanNow">▶ Scan the market (10-15 min)</button></div>`;
    $('#scanNow').onclick = guard(async () => { await runTask('scan'); showTab('home'); onTaskDone.push(() => showTab('market')); });
    return;
  }
  const maxJobs = Math.max(1, ...m.byTitle.map(t => t.jobs));
  el.innerHTML = `
    <div class="card"><div class="row between wrap"><h2>Your job market</h2><span class="muted">last ${m.days} days · updated ${new Date(m.at).toLocaleString('en-GB')}</span></div>
      ${m.summary ? `<p class="lead">${esc(m.summary)}</p>` : ''}
      <div class="stats"><div class="stat"><b>${m.total}</b><span>jobs matching your search</span></div><div class="stat"><b>${m.goodFits}</b><span>good fits for you</span></div>
        <div class="stat"><b>${eur(m.salary.median)}</b><span>typical stated pay (${m.salary.postingsWithSalary} ads say)</span></div><div class="stat"><b>${m.remoteShare}%</b><span>remote</span></div></div>
      ${m.tips?.length ? `<h3>What to do next</h3><ul>${m.tips.map(t => `<li>${esc(t)}</li>`).join('')}</ul>` : ''}
      ${m.suggestedTitles?.length ? `<h3>Titles worth adding (click to add)</h3><div class="chips">${m.suggestedTitles.map(t => `<span class="chip" data-addtitle="${esc(t)}">+ ${esc(t)}</span>`).join('')}</div>` : ''}</div>
    <div class="card"><h2>Demand by job title</h2><div class="tblwrap"><table class="tbl"><tr><th>Title</th><th>Jobs</th><th></th><th>Good fits</th><th>Pay stated in ads</th></tr>
      ${m.byTitle.map(t => `<tr><td>${esc(t.title)}</td><td>${t.jobs}</td><td class="barcell"><div class="bar" style="width:${Math.round(100 * t.jobs / maxJobs)}%"></div></td><td>${t.goodFits}</td>
        <td>${t.salaryMedian ? `${eur(t.salaryMedian)} <span class="muted">(${eur(t.salaryMin)}-${eur(t.salaryMax)}, ${t.salaryCount} ads)</span>` : '<span class="muted">not stated</span>'}</td></tr>`).join('')}</table></div></div>
    <div class="grid2">
      <div class="card"><h2>Who is hiring</h2>${m.topCompanies.map(([c, n]) => `<div class="row between"><span>${esc(c)}</span><b>${n}</b></div>`).join('')}</div>
      <div class="card"><h2>Top recommendations</h2>${m.recommended.map(r => `<div class="rec"><b>${r.score}</b> <a href="${esc(r.url)}" target="_blank" rel="noopener">${esc(r.title)}</a> <span class="muted">${esc(r.company)}</span><div class="muted small">${esc(r.reason || '')}</div></div>`).join('') || '<p class="muted">None yet</p>'}
        <button class="ghost" id="seeAll">See all with CVs and letters →</button></div>
    </div>
    <div class="card"><h2>Where the jobs were found</h2><div class="chips">${m.bySource.map(([s, n]) => `<span class="chip">${esc(s)} · ${n}</span>`).join('')}</div></div>`;
  $('#seeAll').onclick = () => { state.jobFilter = 'recommended'; showTab('jobs'); };
  $$('[data-addtitle]').forEach(ch => ch.onclick = guard(async () => {
    await post(`/users/${state.user}/titles`, { titles: [...state.data.settings.search.titles, ch.dataset.addtitle] });
    toast(`Added "${ch.dataset.addtitle}" to your search`); ch.remove(); state.data = await api(`/users/${state.user}`);
  }));
}

// ---- map ------------------------------------------------------------------------------------------------------
const MAP_COLORS = { ready_to_submit: '#137a4b', needs_input: '#c27c0e', manual: '#7c3aed', ready: '#1d4ed8', submitted: '#64748b', failed: '#b42318' };
const MAP_FILTERS = [['', 'All open'], ['ready', 'Recommended'], ['needs_input', 'Need answers'], ['ready_to_submit', 'Form filled'], ['submitted', 'Applied']];
let leafletMap, markerLayer;
const hash = s => [...s].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7);
function spread(p, i, n) {
  if (n <= 1) return [p.lat, p.lng];
  const r = 0.0035 * Math.sqrt(n / 6 + 0.5), a = (2 * Math.PI * i) / n + (hash(p.label) % 100) / 50;
  return [p.lat + r * Math.sin(a), p.lng + r * 1.6 * Math.cos(a)];
}
async function renderMap() {
  if (typeof L === 'undefined') { $('#leaflet').innerHTML = '<p class="card">The map needs an internet connection (map images come from OpenStreetMap).</p>'; return; }
  $('#mapFilters').innerHTML = MAP_FILTERS.map(([k, l]) => `<span class="chip ${state.mapFilter === k ? 'on' : ''}" data-mf="${k}">${k ? `<span class="dot" style="background:${MAP_COLORS[k]}"></span>` : ''}${l}</span>`).join('');
  $$('#mapFilters .chip').forEach(c => c.onclick = () => { state.mapFilter = c.dataset.mf; renderMap(); });
  const d = await api(`/users/${state.user}/map`);
  const keep = j => !state.mapFilter || j.status === state.mapFilter || (state.mapFilter === 'ready' && j.status === 'manual');
  const placed = d.placed.filter(keep), remote = d.remote.filter(keep), unknown = d.unknown.filter(keep);
  if (!leafletMap) {
    leafletMap = L.map('leaflet').setView([53.35, -6.26], 11);
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 18, attribution: '&copy; OpenStreetMap contributors' }).addTo(leafletMap);
    markerLayer = L.layerGroup().addTo(leafletMap);
  }
  setTimeout(() => leafletMap.invalidateSize(), 50);
  markerLayer.clearLayers();
  const groups = {}, cities = {};
  for (const j of placed) ((j.precision === 'city' ? cities : groups)[`${j.lat},${j.lng}`] ||= []).push(j);
  const item = j => `<div><span class="dot" style="background:${MAP_COLORS[j.status] || '#1d4ed8'}"></span><a href="${esc(j.url)}" target="_blank" rel="noopener">${esc(j.title)}</a> <span style="color:#6b7280">${esc(j.company)} · ${j.score ?? '–'}</span></div>`;
  for (const g of Object.values(cities)) {
    const n = g.length, size = Math.min(70, 30 + Math.sqrt(n) * 5);
    L.marker([g[0].lat, g[0].lng], { icon: L.divIcon({ className: '', iconSize: [size, size], html: `<div class="bubble" style="width:${size}px;height:${size}px">${n}</div>` }) })
      .bindPopup(`<b>${n} job${n > 1 ? 's' : ''} · ${esc(g[0].label)}</b><div class="plist">${g.sort((a, b) => (b.score || 0) - (a.score || 0)).map(item).join('')}</div>`, { maxWidth: 360 }).addTo(markerLayer);
  }
  for (const g of Object.values(groups)) g.forEach((j, i) => {
    L.circleMarker(spread(j, i, g.length), { radius: 8, weight: 2, color: '#fff', fillColor: MAP_COLORS[j.status] || '#1d4ed8', fillOpacity: 0.95 })
      .bindPopup(`<b>${esc(j.title)}</b><br>${esc(j.company)}<br>Score ${j.score ?? '–'} · ${STATUS_LABEL[j.status] || j.status}<br><span style="color:#6b7280">${esc(j.label)}</span><br><a href="${esc(j.url)}" target="_blank" rel="noopener">Open the job ad ↗</a>`).addTo(markerLayer);
  });
  const exact = placed.filter(j => j.precision === 'area').length;
  $('#mapNote').textContent = `${placed.length} jobs on the map: ${exact} with a known area, ${placed.length - exact} where the ad only names the town (numbered bubbles)`;
  const side = j => `<div class="it">${item(j)}</div>`;
  $('#mapSide').innerHTML = `<h3>Remote (${remote.length})</h3>${remote.map(side).join('') || '<p class="muted">None</p>'}${unknown.length ? `<h3>Location unclear (${unknown.length})</h3>${unknown.map(side).join('')}` : ''}`;
}

// ---- questions ---------------------------------------------------------------------------------------------
async function renderQuestions() {
  const qs = await api(`/users/${state.user}/questions`);
  $('#qList').innerHTML = qs.length ? qs.map((q, i) => `
    <div class="q"><b>${esc(q.label)}</b>
      <div class="for">Asked by ${q.jobs.length} application${q.jobs.length > 1 ? 's' : ''}: ${esc(q.jobs.slice(0, 3).map(j => j.company).join(', '))}${q.jobs.length > 3 ? '…' : ''} · ${esc(q.why)}</div>
      <div class="row"><input data-qi="${i}" placeholder="Your answer (for choices, type the option text)"><button class="primary" data-qs="${i}">Save</button></div></div>`).join('')
    : `<div class="card muted">No open questions. 🎉</div>`;
  $$('[data-qs]').forEach(b => b.onclick = guard(async () => {
    const i = +b.dataset.qs;
    const r = await post(`/users/${state.user}/questions`, { question: qs[i].label, answer: $(`[data-qi="${i}"]`).value });
    toast(r.requeued ? `Saved. ${r.requeued} application(s) will be filled again on the next run.` : 'Saved. It will be used on every future form.');
    await refresh();
  }));
}

// ---- profile -----------------------------------------------------------------------------------------------
$$('#steps button').forEach(b => b.onclick = () => { state.step = b.dataset.step; renderStep(); });
function renderStep() {
  $$('#steps button').forEach(b => b.classList.toggle('on', b.dataset.step === state.step));
  const d = state.data, body = $('#stepBody'), saveBar = `<div class="savebar"><button class="primary" id="saveStep">Save</button></div>`;
  if (state.step === 'cv') {
    const w = d.onboarding?.warnings || [], drop = cvDrop(() => { toast('Reading your CV… watch progress on Home.'); showTab('home'); });
    body.innerHTML = `<div class="card"><h2>Your CV</h2><p class="muted">This is your standard version. For each job JobPilot reorders and rewords it to match the ad, but never adds facts, numbers, employers or dates.</p>
      ${drop.html}${w.length ? `<h3>Please check these against your original CV</h3>${w.map(x => `<div class="warn">${esc(x)}</div>`).join('')}` : ''}</div>
      ${d.hasCv ? `<div class="card"><div class="row between"><h2>Preview</h2><span><a href="/api/users/${state.user}/cv.docx">Download Word</a> · <a href="/api/users/${state.user}/cv.pdf" target="_blank">Open PDF</a></span></div>
        <iframe class="pdf" src="/api/users/${state.user}/cv.pdf?t=${Date.now()}"></iframe></div>` : ''}`;
    return drop.bind();
  }
  if (state.step === 'about') { body.innerHTML = aboutForm(d.profile) + saveBar; $('#saveStep').onclick = guard(async () => { await saveAbout(false); toast('Saved'); }); return; }
  if (state.step === 'search') {
    const se = d.settings.search, a = d.settings.apply, so = d.settings.sources;
    const src = [['boards', 'Company career pages (Greenhouse, Ashby, Lever, Workable, SmartRecruiters, Recruitee, Personio)'], ['linkedin', 'LinkedIn'], ['irishjobs', 'IrishJobs.ie and Jobs.ie'],
      ['careerjet', 'CareerJet.ie'], ['publicjobs', 'publicjobs.ie (public sector)'], ['jobsireland', 'JobsIreland.ie'], ['recruitireland', 'RecruitIreland.com'], ['workable', 'Workable search'],
      ['jobicy', 'Remote job feed (Jobicy)'], ['remoteok', 'Remote job feed (Remote OK)'], ['workday', 'Workday employers'], ['jooble', 'Jooble (needs a free API key)']];
    body.innerHTML = `<div class="card"><h2>Jobs to look for</h2>${titlePicker([], se.titles)}<p class="help">Search keywords update automatically from these titles.</p></div>
      <div class="card"><h2>Where and how much</h2><div class="grid2">
        ${field('city', 'Area', se.city)}
        ${field('remote', 'Remote jobs too?', se.remote, { options: [['none', 'No, only jobs near me'], ['country', 'Yes, remote within Ireland'], ['europe', 'Yes, remote across Europe'], ['anywhere', 'Yes, remote anywhere']] })}
        ${field('minSalary', 'Lowest yearly pay you would accept (€, 0 = any)', a.minSalary || 0, { type: 'number' })}
        ${field('threshold', 'Recommend jobs scoring at least', a.threshold, { type: 'number', help: '70 is a good start. Lower = more jobs, more long shots.' })}
        ${field('kitsPerRun', 'Tailored CV + letter packs per run', a.kitsPerRun ?? 10, { type: 'number' })}
        ${field('excludeCompanies', 'Never apply to (comma separated)', se.excludeCompanies.join(', '))}</div></div>
      <div class="card"><h2>Automatic daily run</h2>
        <label class="row"><input type="checkbox" id="schedOn" style="width:auto" ${d.settings.schedule?.on ? 'checked' : ''}> Start the daily run by itself</label>
        <div class="grid2" style="margin-top:8px">${field('schedTime', 'At', d.settings.schedule?.time || '08:30', { type: 'time' })}
          ${field('schedDays', 'On', d.settings.schedule?.days || 'weekdays', { options: [['weekdays', 'Weekdays'], ['daily', 'Every day']] })}</div>
        <p class="help">JobPilot must be open (it can sit in the background). If the computer was off at that time, the run starts when JobPilot is next opened that day. You get a notification when it finishes.</p></div>
      <div class="card"><h2>Companies you'd love to work for</h2>
        ${field('followCompanies', 'One per line: a company name, or better, a link to its careers page', (se.followCompanies || []).join('\n'), { type: 'textarea',
          help: 'Their own job boards are checked on every run, and the AI knows you want to work there. Links from Greenhouse, Lever, Ashby, Workable, SmartRecruiters, Recruitee, Personio and Workday careers pages work; for a name, JobPilot looks up the board and says in the Activity log what it found.' })}</div>
      <div class="card"><h2>Where to look</h2>${src.map(([k, l]) => `<label class="row"><input type="checkbox" id="src_${k}" style="width:auto" ${so[k] ? 'checked' : ''}> ${l}</label>`).join('')}
        <div style="margin-top:10px">${field('joobleKey', 'Jooble API key (optional)', d.settings.joobleKey)}</div>
        <details style="margin-top:10px"><summary class="muted">Advanced: title keywords</summary><p class="help">Include: ${esc(se.includeKeywords.join(', '))}</p><p class="help">Exclude: ${esc(se.excludeKeywords.join(', '))}</p></details></div>${saveBar}`;
    bindTitlePicker();
    $('#saveStep').onclick = guard(async () => {
      const titles = pickedTitles(); if (!titles.length) throw new Error('Keep at least one job title');
      if ($('#schedOn').checked && 'Notification' in window && Notification.permission === 'default') Notification.requestPermission().catch(() => {});
      await put(`/users/${state.user}/settings`, { search: { city: val('city'), remote: val('remote'), excludeCompanies: val('excludeCompanies').split(',').map(s => s.trim()).filter(Boolean),
          followCompanies: [...new Set(val('followCompanies').split('\n').map(s => s.trim()).filter(Boolean))] },
        schedule: { on: $('#schedOn').checked, time: val('schedTime') || '08:30', days: val('schedDays') },
        apply: { minSalary: +val('minSalary') || 0, threshold: Math.min(95, Math.max(30, +val('threshold') || 70)), kitsPerRun: Math.max(1, +val('kitsPerRun') || 10) },
        sources: Object.fromEntries(src.map(([k]) => [k, $('#src_' + k).checked])), joobleKey: val('joobleKey') });
      if (titles.join('|') !== se.titles.join('|')) await post(`/users/${state.user}/titles`, { titles });
      toast('Saved'); state.data = await api(`/users/${state.user}`); renderStep();
    });
    return;
  }
  if (state.step === 'mode') {
    body.innerHTML = `<div class="card"><h2>How should JobPilot help?</h2>${modeChooser(d.settings)}</div>${saveBar}`;
    bindModeChooser(); $('#saveStep').onclick = guard(async () => { await saveMode(); toast('Saved'); state.data = await api(`/users/${state.user}`); renderStep(); });
    return;
  }
  const r = d.settings.rules || {};
  body.innerHTML = `<div class="card"><h2>Fine-tuning (optional)</h2><p class="muted">Plain-English instructions the AI follows when scoring jobs and writing for you.</p>
      ${field('scoringGuidance', 'What makes a job a good or bad fit for you', r.scoringGuidance, { type: 'textarea', help: 'e.g. "Any job is fine if it pays better." "No sales-heavy roles."' })}
      ${field('dealbreakers', 'Other dealbreakers', r.dealbreakers, { type: 'textarea' })}
      ${field('writingRules', 'How your cover letters should sound', r.writingRules, { type: 'textarea', help: 'Leave empty for the default: plain, friendly, three short paragraphs.' })}
      ${field('notes', 'Anything else the AI should know', r.notes, { type: 'textarea' })}</div>
    <div class="card"><h2>What the AI reads</h2><pre class="log" style="height:auto;max-height:380px;background:var(--bg);color:var(--text)">${esc(d.rules)}</pre></div>${saveBar}`;
  $('#saveStep').onclick = guard(async () => {
    await put(`/users/${state.user}/settings`, { rules: { scoringGuidance: val('scoringGuidance'), dealbreakers: val('dealbreakers'), writingRules: val('writingRules'), notes: val('notes') } });
    toast('Saved'); state.data = await api(`/users/${state.user}`); renderStep();
  });
}

connect();
loadUsers().catch(e => toast(e.message, 8000));
loadUpdate(false);
