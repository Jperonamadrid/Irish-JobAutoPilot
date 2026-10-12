// JobPilot web app (no framework, no build step).
const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const state = { user: null, data: null, tab: 'home', step: 'cv', jobFilter: 'ready_to_submit', task: null };

async function api(path, opts = {}) {
  const r = await fetch('/api' + path, { ...opts, headers: { 'X-JobPilot': '1', ...(opts.body && !(opts.body instanceof Blob) ? { 'Content-Type': 'application/json' } : {}), ...(opts.headers || {}) } });
  const body = r.headers.get('content-type')?.includes('json') ? await r.json() : null;
  if (!r.ok) throw new Error(body?.error || r.statusText);
  return body;
}
const put = (p, b) => api(p, { method: 'PUT', body: JSON.stringify(b) });
const post = (p, b) => api(p, { method: 'POST', body: JSON.stringify(b) });
function toast(msg, ms = 3500) { const t = $('#toast'); t.textContent = msg; t.classList.remove('hide'); clearTimeout(toast.t); toast.t = setTimeout(() => t.classList.add('hide'), ms); }
const guard = fn => async (...a) => { try { await fn(...a); } catch (e) { toast(e.message, 6000); } };

// ---- people ------------------------------------------------------------------------------------------
async function loadUsers(select) {
  const users = await api('/users');
  $('#welcome').classList.toggle('hide', users.length > 0);
  $$('.view').forEach(v => v.id !== 'welcome' && v.classList.toggle('hide', !users.length || v.id !== state.tab));
  $('#tabs').classList.toggle('hide', !users.length); $('.who').classList.toggle('hide', !users.length);
  if (!users.length) return;
  const keep = select || localStorage.getItem('jp-user');
  state.user = users.find(u => u.id === keep)?.id || users[0].id;
  $('#userSel').innerHTML = users.map(u => `<option value="${esc(u.id)}" ${u.id === state.user ? 'selected' : ''}>${esc(u.name)}</option>`).join('');
  await refresh();
}
async function refresh() {
  if (!state.user) return;
  localStorage.setItem('jp-user', state.user);
  state.data = await api(`/users/${state.user}`);
  renderHome();
  const q = state.data.questions; $('#qcount').textContent = q; $('#qcount').classList.toggle('hide', !q);
  if (state.tab === 'jobs') renderJobs();
  if (state.tab === 'questions') renderQuestions();
  if (state.tab === 'profile') renderStep();
}
$('#userSel').onchange = guard(async e => { state.user = e.target.value; await refresh(); });
$('#addUser').onclick = guard(async () => {
  const name = prompt('Full name of the person to add:');
  if (!name?.trim()) return;
  const u = await post('/users', { name });
  await loadUsers(u.id); showTab('profile'); state.step = 'cv'; renderStep();
});
$('#createFirst').onclick = guard(async () => {
  const name = $('#newName').value.trim(); if (!name) return toast('Enter your name first');
  const u = await post('/users', { name }); state.tab = 'profile'; await loadUsers(u.id); showTab('profile');
});

// ---- tabs ----------------------------------------------------------------------------------------------
function showTab(t) {
  state.tab = t;
  $$('#tabs button').forEach(b => b.classList.toggle('on', b.dataset.tab === t));
  $$('.view').forEach(v => v.id !== 'welcome' && v.classList.toggle('hide', v.id !== t));
  if (t === 'jobs') renderJobs(); if (t === 'questions') renderQuestions(); if (t === 'profile') renderStep();
  if (t === 'map') renderMap().catch(e => toast(e.message));
}
$$('#tabs button').forEach(b => b.onclick = () => showTab(b.dataset.tab));

// ---- home ----------------------------------------------------------------------------------------------
const STATS = [
  ['ready_to_submit', 'Ready for you to submit'], ['needs_input', 'Need your answers'], ['manual', 'Apply by hand'],
  ['ready', 'Waiting to be prepared'], ['submitted', 'Submitted']];
function renderHome() {
  const d = state.data, c = d.counts;
  $('#stats').innerHTML = STATS.map(([k, l]) => `<div class="stat" data-go="${k}"><b>${c[k] || 0}</b><span>${l}</span></div>`).join('');
  $$('.stat').forEach(s => s.onclick = () => { state.jobFilter = s.dataset.go; renderJobs.picked = true; showTab(s.dataset.go === 'needs_input' && d.questions ? 'questions' : 'jobs'); });
  const missing = [];
  if (!d.hasCv) missing.push('upload your CV');
  if (!d.profile.email || !d.profile.phone) missing.push('check your contact details');
  if (!d.settings.search.includeKeywords.length) missing.push('choose the jobs you want');
  for (const k of ['workAuthorized', 'needsSponsorship', 'noticePeriod', 'salaryText']) if (!d.profile[k]) { missing.push('answer the "About you" questions'); break; }
  const b = $('#setupBanner');
  b.classList.toggle('hide', !missing.length);
  b.innerHTML = missing.length ? `<b>Almost there.</b> Before the first run, please ${missing.join(', ')} in <a href="#" id="goSetup">Profile &amp; CV</a>.` : '';
  $('#goSetup') && ($('#goSetup').onclick = e => { e.preventDefault(); showTab('profile'); });
  $$('[data-run]').forEach(btn => btn.disabled = !!state.task || (!d.ready && btn.dataset.run !== 'login'));
}
$$('[data-run]').forEach(b => b.onclick = guard(async () => {
  const name = b.dataset.run;
  if (name === 'review') toast('A browser window will open with the first application. Check it, click Submit, then close the tab for the next one.', 8000);
  if (name === 'login') toast('A Chrome window will open. Sign in on each tab, then close the window.', 8000);
  await post('/task', { user: state.user, name }); showTab('home');
}));
$('#stopTask').onclick = guard(() => api('/task', { method: 'DELETE' }));

// ---- live activity -------------------------------------------------------------------------------------
function connect() {
  const es = new EventSource('/api/events');
  es.addEventListener('log', e => { const l = $('#log'); l.textContent += JSON.parse(e.data) + '\n'; l.scrollTop = l.scrollHeight; });
  es.addEventListener('task', e => {
    const t = JSON.parse(e.data), was = state.task;
    state.task = t;
    $('#taskState').textContent = t ? `${t.label}…` : 'Idle';
    $('#stopTask').classList.toggle('hide', !t);
    if (t && !was) $('#log').textContent = '';
    if (!t && was) refresh().catch(() => {});
    if (state.data) renderHome();
  });
  es.onerror = () => { $('#taskState').textContent = 'Reconnecting…'; };
}

// ---- jobs ----------------------------------------------------------------------------------------------
const FILTERS = [['ready_to_submit', 'Ready to submit'], ['needs_input', 'Need answers'], ['manual', 'Apply by hand'], ['ready', 'Waiting'],
  ['failed', 'Problems'], ['submitted', 'Submitted'], ['skipped', 'Not a fit'], ['', 'All']];
const STATUS_LABEL = { new: 'New', ready: 'Waiting to be prepared', ready_to_submit: 'Ready to submit', needs_input: 'Needs your answers', manual: 'Apply by hand',
  submitted: 'Submitted', skipped: 'Not a fit', failed: 'Problem', closed: 'Closed', duplicate: 'Duplicate', excluded: 'Excluded' };
async function renderJobs() {
  // Open on the first non-empty category the first time.
  const c = state.data?.counts || {};
  if (!renderJobs.picked && state.jobFilter && !c[state.jobFilter]) state.jobFilter = (FILTERS.find(([k]) => k && c[k]) || [''])[0];
  renderJobs.picked = true;
  $('#jobFilters').innerHTML = FILTERS.map(([k, l]) => `<span class="chip ${state.jobFilter === k ? 'on' : ''}" data-f="${k}">${l}${k && state.data?.counts[k] ? ` (${state.data.counts[k]})` : ''}</span>`).join('');
  $$('#jobFilters .chip').forEach(ch => ch.onclick = () => { state.jobFilter = ch.dataset.f; renderJobs(); });
  const jobs = await api(`/users/${state.user}/jobs${state.jobFilter ? '?status=' + state.jobFilter : ''}`);
  const q = $('#jobSearch').value.toLowerCase();
  const list = jobs.filter(j => !q || `${j.title} ${j.company}`.toLowerCase().includes(q));
  const file = p => `/api/users/${state.user}/file?path=${encodeURIComponent(p)}`;
  $('#jobList').innerHTML = list.length ? list.map(j => `
    <div class="job">
      <div class="score" title="How well it fits (0-100)">${j.score ?? '–'}</div>
      <div>
        <h3>${esc(j.title)}</h3>
        <div class="meta">${esc(j.company)} · ${esc(j.location || '')} · <span class="tag ${j.status}">${STATUS_LABEL[j.status] || j.status}</span> <span class="tag">${esc(j.source || '')}</span></div>
        ${j.reason ? `<div class="why">${esc(j.reason)}</div>` : ''}
        ${j.status === 'needs_input' ? `<div class="why">Waiting on: ${esc(j.pending.map(p => p.label).join('; ').slice(0, 220))}</div>` : ''}
        ${j.problems.length || j.error ? `<div class="why" style="color:var(--red)">${esc(j.error || j.problems.map(p => p.label + ': ' + p.why).join('; ').slice(0, 220))}</div>` : ''}
        <div class="links"><a href="${esc(j.url)}" target="_blank" rel="noopener">Job posting ↗</a>
          ${j.screenshot ? `<a href="${file(j.screenshot)}" target="_blank">Filled form</a>` : ''}
          ${j.cvPdf ? `<a href="${file(j.cvPdf)}" target="_blank">Tailored CV</a>` : ''}</div>
      </div>
      <div class="btns">
        ${j.status === 'ready_to_submit' || j.status === 'needs_input' ? `<button class="small accent" data-review="${esc(j.id)}">Review &amp; submit</button>` : ''}
        ${j.status === 'manual' ? `<button class="small accent" data-mark="submitted" data-id="${esc(j.id)}">I applied</button>` : ''}
        ${!['submitted', 'skipped'].includes(j.status) ? `<button class="small ghost" data-mark="skipped" data-id="${esc(j.id)}">Not for me</button>` : ''}
        ${j.status === 'skipped' ? `<button class="small ghost" data-mark="ready" data-id="${esc(j.id)}">Prepare anyway</button>` : ''}
        ${j.status === 'ready_to_submit' ? `<button class="small ghost" data-mark="submitted" data-id="${esc(j.id)}">I already sent it</button>` : ''}
      </div>
    </div>`).join('') : `<div class="card muted">Nothing here yet.</div>`;
  $$('[data-mark]').forEach(b => b.onclick = guard(async () => { await post(`/users/${state.user}/jobs/${encodeURIComponent(b.dataset.id)}`, { status: b.dataset.mark }); await refresh(); renderJobs(); }));
  $$('[data-review]').forEach(b => b.onclick = guard(async () => {
    toast('Opening the form in a browser window. Check it, click Submit, then close the tab.', 8000);
    await post('/task', { user: state.user, name: 'review', args: [b.dataset.review] }); showTab('home');
  }));
}
$('#jobSearch').oninput = () => renderJobs();

// ---- map ---------------------------------------------------------------------------------------------------
const MAP_COLORS = { ready_to_submit: '#137a4b', needs_input: '#c27c0e', manual: '#7c3aed', ready: '#1d4ed8', submitted: '#64748b', failed: '#b42318' };
const MAP_FILTERS = [['', 'All open'], ['ready_to_submit', 'Ready to submit'], ['needs_input', 'Need answers'], ['manual', 'Apply by hand'], ['ready', 'Waiting'], ['submitted', 'Submitted']];
let leafletMap, markerLayer;
// Spread jobs that share one area centre in a small circle so each can be clicked.
const hash = s => [...s].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7);
function spread(p, i, n) {
  if (n <= 1) return [p.lat, p.lng];
  const r = (p.precision === 'city' ? 0.012 : 0.0035) * Math.sqrt(n / 6 + 0.5), a = (2 * Math.PI * i) / n + (hash(p.label) % 100) / 50;
  return [p.lat + r * Math.sin(a), p.lng + r * 1.6 * Math.cos(a)];
}
async function renderMap() {
  if (typeof L === 'undefined') { $('#leaflet').innerHTML = '<p class="card">The map needs an internet connection (map images come from OpenStreetMap).</p>'; return; }
  state.mapFilter ??= '';
  $('#mapFilters').innerHTML = MAP_FILTERS.map(([k, l]) => `<span class="chip ${state.mapFilter === k ? 'on' : ''}" data-mf="${k}">${k ? `<span class="dot" style="background:${MAP_COLORS[k]}"></span>` : ''}${l}</span>`).join('');
  $$('#mapFilters .chip').forEach(c => c.onclick = () => { state.mapFilter = c.dataset.mf; renderMap(); });
  const d = await api(`/users/${state.user}/map`);
  const keep = j => !state.mapFilter || j.status === state.mapFilter;
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
  // Jobs where only the city is known: one labelled bubble per city that lists them, not a pile of dots.
  for (const g of Object.values(cities)) {
    const n = g.length, size = Math.min(70, 30 + Math.sqrt(n) * 5);
    const icon = L.divIcon({ className: '', iconSize: [size, size], html: `<div class="bubble" style="width:${size}px;height:${size}px">${n}</div>` });
    L.marker([g[0].lat, g[0].lng], { icon }).bindPopup(`<b>${n} job${n > 1 ? 's' : ''} · ${esc(g[0].label)}</b><div class="plist">${g.sort((a, b) => (b.score || 0) - (a.score || 0))
      .map(j => `<div><span class="dot" style="background:${MAP_COLORS[j.status] || '#1d4ed8'}"></span><a href="${esc(j.url)}" target="_blank" rel="noopener">${esc(j.title)}</a> <span style="color:#6b7280">${esc(j.company)} · ${j.score ?? '–'}</span></div>`).join('')}</div>`, { maxWidth: 360 })
      .addTo(markerLayer);
  }
  for (const g of Object.values(groups)) g.forEach((j, i) => {
    const m = L.circleMarker(spread(j, i, g.length), { radius: 8, weight: 2, color: '#fff', fillColor: MAP_COLORS[j.status] || '#1d4ed8', fillOpacity: j.precision === 'city' ? 0.55 : 0.95 });
    m.bindPopup(`<b>${esc(j.title)}</b><br>${esc(j.company)}<br>Score ${j.score ?? '–'} · ${STATUS_LABEL[j.status] || j.status}<br><span style="color:#6b7280">${esc(j.label)}</span><br><a href="${esc(j.url)}" target="_blank" rel="noopener">Job posting ↗</a>`);
    m.addTo(markerLayer);
  });
  const inDublin = placed.filter(j => Math.abs(j.lat - 53.35) < 0.3 && Math.abs(j.lng + 6.26) < 0.45);
  const exact = placed.filter(j => j.precision === 'area').length;
  $('#mapNote').textContent = `${placed.length} jobs on the map (${inDublin.length} in the Dublin area): ${exact} with a known area, ${placed.length - exact} where the posting only names the city (numbered bubbles)`;
  const item = j => `<div class="it"><span class="dot" style="background:${MAP_COLORS[j.status] || '#1d4ed8'}"></span><a href="${esc(j.url)}" target="_blank" rel="noopener">${esc(j.title)}</a><br><span class="muted">${esc(j.company)} · ${j.score ?? '–'}</span></div>`;
  $('#mapSide').innerHTML = `<h3>Remote (${remote.length})</h3>${remote.map(item).join('') || '<p class="muted">None</p>'}
    ${unknown.length ? `<h3>Location unclear (${unknown.length})</h3>${unknown.map(item).join('')}` : ''}`;
}

// ---- questions -------------------------------------------------------------------------------------------
async function renderQuestions() {
  const qs = await api(`/users/${state.user}/questions`);
  $('#qList').innerHTML = qs.length ? qs.map((q, i) => `
    <div class="q">
      <b>${esc(q.label)}</b>
      <div class="for">Asked by ${q.jobs.length} application${q.jobs.length > 1 ? 's' : ''}: ${esc(q.jobs.slice(0, 3).map(j => j.company).join(', '))}${q.jobs.length > 3 ? '…' : ''} · ${esc(q.why)}</div>
      <div class="row"><input data-qi="${i}" placeholder="Your answer (for choices, type the option text)"><button class="primary" data-qs="${i}">Save</button></div>
    </div>`).join('') : `<div class="card muted">No open questions. 🎉</div>`;
  $$('[data-qs]').forEach(b => b.onclick = guard(async () => {
    const i = +b.dataset.qs, val = $(`[data-qi="${i}"]`).value;
    const r = await post(`/users/${state.user}/questions`, { question: qs[i].label, answer: val });
    toast(r.requeued ? `Saved. ${r.requeued} application(s) will be prepared again on the next run.` : 'Saved. It will be used on every future form.');
    await refresh(); renderQuestions();
  }));
}

// ---- profile steps --------------------------------------------------------------------------------------
$$('#steps button').forEach(b => b.onclick = () => { state.step = b.dataset.step; renderStep(); });
function renderStep() {
  $$('#steps button').forEach(b => b.classList.toggle('on', b.dataset.step === state.step));
  ({ cv: stepCv, about: stepAbout, search: stepSearch, rules: stepRules })[state.step]();
}

function stepCv() {
  const d = state.data, w = d.onboarding?.warnings || [];
  $('#stepBody').innerHTML = `
    <div class="card">
      <h2>${d.hasCv ? 'Your CV' : 'Start with your CV'}</h2>
      <p class="muted">${d.hasCv ? 'This is the standard version. For each job, JobPilot reorders and rewords it to match the posting, but never adds facts, numbers, employers or dates.'
        : 'Drop your CV here (PDF or Word). JobPilot reads it with AI and fills in your profile, suggests job titles, and builds a clean CV. It takes about a minute.'}</p>
      <div class="drop" id="drop">📄 Drop your CV here or click to choose a file<input type="file" id="cvFile" accept=".pdf,.docx,.txt" hidden></div>
      ${w.length ? `<h3>Please check these against your original CV</h3>${w.map(x => `<div class="warn">${esc(x)}</div>`).join('')}` : ''}
    </div>
    ${d.hasCv ? `<div class="card"><div class="row between"><h2>Preview</h2><span><a href="/api/users/${state.user}/cv.docx">Download Word</a> · <a href="/api/users/${state.user}/cv.pdf" target="_blank">Open PDF</a></span></div>
      <iframe class="pdf" src="/api/users/${state.user}/cv.pdf?t=${Date.now()}"></iframe></div>` : ''}`;
  const drop = $('#drop'), input = $('#cvFile');
  drop.onclick = () => input.click();
  drop.ondragover = e => { e.preventDefault(); drop.classList.add('over'); };
  drop.ondragleave = () => drop.classList.remove('over');
  const upload = guard(async file => {
    if (!file) return;
    if (d.hasCv && !confirm('Replace your profile with what is read from this CV? Your answers and job list are kept.')) return;
    await fetch(`/api/users/${state.user}/upload-cv`, { method: 'POST', body: file, headers: { 'X-JobPilot': '1', 'X-Filename': encodeURIComponent(file.name) } })
      .then(async r => { if (!r.ok) throw new Error((await r.json()).error); });
    toast('Reading your CV… watch the progress on Home.'); showTab('home');
  });
  drop.ondrop = e => { e.preventDefault(); drop.classList.remove('over'); upload(e.dataTransfer.files[0]); };
  input.onchange = () => upload(input.files[0]);
}

const field = (id, label, value, { type = 'text', help = '', options } = {}) => `<label>${label}${options
  ? `<select id="${id}">${options.map(([v, l]) => `<option value="${esc(v)}" ${String(value ?? '') === String(v) ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select>`
  : type === 'textarea' ? `<textarea id="${id}">${esc(value ?? '')}</textarea>` : `<input id="${id}" type="${type}" value="${esc(value ?? '')}">`}${help ? `<p class="help">${help}</p>` : ''}</label>`;
const yn = [['', 'Choose…'], ['Yes', 'Yes'], ['No', 'No']];

function stepAbout() {
  const p = state.data.profile, e = p.education || {};
  $('#stepBody').innerHTML = `
    <div class="card"><h2>Contact details</h2><div class="grid2">
      ${field('firstName', 'First name', p.firstName)}${field('lastName', 'Last name', p.lastName)}
      ${field('email', 'Email for applications', p.email, { type: 'email' })}${field('phone', 'Phone (with country code)', p.phone, { help: 'e.g. +353 83 123 4567' })}
      ${field('city', 'City', p.city)}${field('linkedin', 'LinkedIn profile URL', p.linkedin)}
      ${field('currentEmployer', 'Current or last employer', p.currentEmployer)}${field('currentTitle', 'Current or last job title', p.currentTitle)}
    </div></div>
    <div class="card"><h2>Questions most forms ask</h2><p class="muted">Answered once here, used on every form. Leave one empty and you'll be asked when a form needs it.</p><div class="grid2">
      ${field('workAuthorized', 'Are you allowed to work in Ireland?', p.workAuthorized, { options: yn })}
      ${field('needsSponsorship', 'Do you need visa sponsorship?', p.needsSponsorship, { options: yn })}
      ${field('visaStatus', 'Visa / permit status (in words)', p.visaStatus, { help: 'e.g. "EU citizen, no visa required" or "Stamp 4"' })}
      ${field('nationality', 'Nationality', p.nationality)}
      ${field('noticePeriod', 'Notice period', p.noticePeriod, { help: 'e.g. "1 month"' })}
      ${field('noticeDays', 'Notice period in days', p.noticeDays, { type: 'number' })}
      ${field('salaryText', 'Salary expectation (as you would write it)', p.salaryText, { help: 'e.g. "EUR 45,000 to 50,000 depending on the role"' })}
      ${field('salaryNumber', 'Salary expectation (single number)', p.salaryNumber, { type: 'number', help: 'used when a form wants only a number' })}
      ${field('onsiteOk', 'Happy to work in an office some days?', p.onsiteOk, { options: yn })}
      ${field('shiftWorkOk', 'Happy to do shifts / on-call?', p.shiftWorkOk, { options: yn })}
      ${field('basedInRegion', 'Are you based in Europe/EMEA?', p.basedInRegion || 'Yes', { options: yn })}
      ${field('languages', 'Languages you speak (comma separated)', (p.languages || []).join(', '))}
    </div></div>
    <div class="card"><h2>Education (for forms with an education section)</h2><div class="grid2">
      ${field('school', 'School / college', e.school)}
      ${field('degreeOption', 'Degree level', e.degreeOption, { options: [['', 'Choose…'], ["High School", 'Leaving Cert / High School'], ["Associate's Degree", "Associate's / Higher Diploma"], ["Bachelor's Degree", "Bachelor's"], ["Master's Degree", "Master's"], ["Doctor of Philosophy (Ph.D.)", 'PhD'], ['Other', 'Other']] })}
    </div><p class="help">Demographic questions (gender, ethnicity, disability…) are always answered "prefer not to say" or left blank.</p></div>
    <div class="savebar"><button class="primary" id="saveAbout">Save</button></div>`;
  $('#saveAbout').onclick = guard(async () => {
    const v = id => $('#' + id).value.trim();
    const fn = v('firstName'), ln = v('lastName');
    await put(`/users/${state.user}/profile`, {
      firstName: fn, lastName: ln, fullName: `${fn} ${ln}`.trim(), email: v('email'), phone: v('phone'), city: v('city'), linkedin: v('linkedin'),
      currentEmployer: v('currentEmployer'), currentTitle: v('currentTitle'), workAuthorized: v('workAuthorized'), needsSponsorship: v('needsSponsorship'),
      visaStatus: v('visaStatus'), nationality: v('nationality'), noticePeriod: v('noticePeriod'), noticeDays: +v('noticeDays') || 30,
      salaryText: v('salaryText'), salaryNumber: +v('salaryNumber') || '', onsiteOk: v('onsiteOk'), shiftWorkOk: v('shiftWorkOk'), basedInRegion: v('basedInRegion'),
      languages: v('languages').split(',').map(s => s.trim()).filter(Boolean),
      locationText: [v('city'), state.data.profile.country || 'Ireland'].filter(Boolean).join(', '),
      education: { ...e, school: v('school'), degreeOption: v('degreeOption'), degreeFallback: v('degreeOption') }
    });
    toast('Saved'); await refresh();
  });
}

// Tag editor: chips with ×, Enter or comma adds.
function tagbox(id, values) {
  setTimeout(() => {
    const box = $('#' + id), inp = box.querySelector('input');
    const draw = () => { box.querySelectorAll('span').forEach(s => s.remove()); box._v.forEach((t, i) => {
      const s = document.createElement('span'); s.innerHTML = `${esc(t)}<button title="Remove">×</button>`;
      s.querySelector('button').onclick = () => { box._v.splice(i, 1); draw(); }; box.insertBefore(s, inp); }); };
    box._v = [...values]; draw();
    inp.onkeydown = e => { if ((e.key === 'Enter' || e.key === ',') && inp.value.trim()) { e.preventDefault(); box._v.push(inp.value.trim()); inp.value = ''; draw(); }
      else if (e.key === 'Backspace' && !inp.value && box._v.length) { box._v.pop(); draw(); } };
    inp.onblur = () => { if (inp.value.trim()) { box._v.push(inp.value.trim()); inp.value = ''; draw(); } };
  });
  return `<div class="tagbox" id="${id}"><input placeholder="type and press Enter"></div>`;
}
const tags = id => $('#' + id)._v;

function stepSearch() {
  const s = state.data.settings, se = s.search, a = s.apply, so = s.sources;
  const src = [['boards', 'Company career pages (Greenhouse, Ashby, Lever, Workable): filled in automatically'], ['linkedin', 'LinkedIn'],
    ['irishjobs', 'IrishJobs.ie and Jobs.ie'], ['careerjet', 'CareerJet.ie (collects jobs from many Irish sites)'], ['publicjobs', 'publicjobs.ie (public sector)'],
    ['jobsireland', 'JobsIreland.ie (State employment service)'], ['workable', 'Workable search'], ['jobicy', 'Remote job feed (Jobicy)'], ['workday', 'Workday employers'], ['jooble', 'Jooble (needs a free API key)']];
  $('#stepBody').innerHTML = `
    <div class="card"><h2>Jobs you want</h2>
      <label>Job titles to search for${tagbox('titles', se.titles)}<p class="help">Searched on LinkedIn, IrishJobs, Jobs.ie and others. 8-20 titles works well.</p></label>
      <label style="margin-top:12px">A job title must contain one of these words${tagbox('inc', se.includeKeywords)}<p class="help">e.g. "accountant", "payroll", "administrator". Plurals match automatically.</p></label>
      <label style="margin-top:12px">…and none of these${tagbox('exc', se.excludeKeywords)}<p class="help">e.g. "director", "intern", or other professions. Jobs requiring a language you don't speak are skipped automatically.</p></label>
      <label style="margin-top:12px">Never apply to these companies${tagbox('excCo', se.excludeCompanies)}</label>
    </div>
    <div class="card"><h2>Where and how</h2><div class="grid2">
      ${field('city', 'City', se.city)}
      ${field('remote', 'Remote jobs', se.remote, { options: [['none', 'Only jobs in my city'], ['country', 'Also remote within Ireland'], ['europe', 'Also remote across Europe / EMEA'], ['anywhere', 'Also remote anywhere']] })}
      ${field('minSalary', 'Lowest salary you would accept (EUR, 0 = any)', a.minSalary || 0, { type: 'number' })}
      ${field('threshold', 'Only prepare jobs scoring at least', a.threshold, { type: 'number', help: '70 is a good start. Lower = more applications, more long shots.' })}
      ${field('maxPerRun', 'Most applications to prepare per run', a.maxPerRun, { type: 'number' })}
      ${field('tailorCv', 'Tailor the CV for each job', a.tailorCv ? '1' : '0', { options: [['1', 'Yes (recommended)'], ['0', 'No, always send the standard CV']] })}
    </div></div>
    <div class="card"><h2>Where to look</h2>${src.map(([k, l]) => `<label class="row"><input type="checkbox" id="src_${k}" style="width:auto" ${so[k] ? 'checked' : ''}> ${l}</label>`).join('')}
      <div style="margin-top:10px">${field('joobleKey', 'Jooble API key (optional)', s.joobleKey, { help: 'Free from jooble.org/api/about' })}</div></div>
    <div class="savebar"><button class="primary" id="saveSearch">Save</button></div>`;
  $('#saveSearch').onclick = guard(async () => {
    const v = id => $('#' + id).value.trim();
    await put(`/users/${state.user}/settings`, {
      search: { titles: tags('titles'), includeKeywords: tags('inc'), excludeKeywords: tags('exc'), excludeCompanies: tags('excCo'), city: v('city'), remote: v('remote') },
      apply: { minSalary: +v('minSalary') || 0, threshold: Math.min(95, Math.max(30, +v('threshold') || 70)), maxPerRun: Math.max(1, +v('maxPerRun') || 25), tailorCv: v('tailorCv') === '1' },
      sources: Object.fromEntries(src.map(([k]) => [k, $('#src_' + k).checked])), joobleKey: v('joobleKey')
    });
    toast('Saved'); await refresh();
  });
}

function stepRules() {
  const r = state.data.settings.rules || {};
  $('#stepBody').innerHTML = `
    <div class="card"><h2>Fine-tuning (optional)</h2><p class="muted">Plain-English instructions the AI follows when scoring jobs and writing for you.</p>
      ${field('scoringGuidance', 'What makes a job a good or bad fit for you', r.scoringGuidance, { type: 'textarea', help: 'e.g. "Step-down roles are fine." "No sales-heavy roles."' })}
      ${field('dealbreakers', 'Other dealbreakers', r.dealbreakers, { type: 'textarea', help: 'e.g. "Fully on-site roles outside Dublin." Salary and location are set in step 3.' })}
      ${field('writingRules', 'How your cover letters and answers should sound', r.writingRules, { type: 'textarea', help: 'Leave empty for the default: plain, human, no buzzwords, three short paragraphs.' })}
      ${field('notes', 'Anything else the AI should know', r.notes, { type: 'textarea' })}
    </div>
    <div class="card"><h2>What the AI reads (generated)</h2><pre class="log" style="height:auto;max-height:380px;background:var(--bg);color:var(--text)">${esc(state.data.rules)}</pre></div>
    <div class="savebar"><button class="primary" id="saveRules">Save</button></div>`;
  $('#saveRules').onclick = guard(async () => {
    const v = id => $('#' + id).value.trim();
    await put(`/users/${state.user}/settings`, { rules: { scoringGuidance: v('scoringGuidance'), dealbreakers: v('dealbreakers'), writingRules: v('writingRules'), notes: v('notes') } });
    toast('Saved'); await refresh();
  });
}

connect();
loadUsers().catch(e => toast(e.message, 8000));
