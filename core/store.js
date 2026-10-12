// One person's job database (users/<id>/jobs.json), keyed by stable id (e.g. gh:stripe:8007205).
// Status flow: new -> skipped | ready | manual
//   ready -> ready_to_submit | needs_input | failed | closed     any -> submitted (you sent it)
// After submitted, `outcome` records what happened next (see outcomes.js).
//
// Two processes write this file at once: a long task (daily run) and the web app (you marking a
// job applied or answering a question while the run goes on). So save() never just overwrites:
// it merges this copy's changes, field by field, into what is on disk now.
const { readJson, writeJson, norm } = require('./util');

// Same company + same job, however each site words it: "Sr. Data Analyst (m/f/d) - Dublin" and
// "Senior Data Analyst" match. Abbreviations are expanded; gender tags, and suffixes or brackets that
// only name a place, a work mode or the company, are dropped. "Engineer - Payments" stays distinct.
const ABBREV = { sr: 'senior', snr: 'senior', jr: 'junior', jnr: 'junior', mgr: 'manager', mngr: 'manager', eng: 'engineer', engr: 'engineer',
  assoc: 'associate', asst: 'assistant', admin: 'administrator', exec: 'executive', dev: 'developer', rep: 'representative', coord: 'coordinator', spec: 'specialist' };
const PLACE = new Set(['dublin', 'cork', 'galway', 'limerick', 'waterford', 'ireland', 'remote', 'hybrid', 'onsite', 'on', 'site', 'office', 'emea', 'europe',
  'uk', 'eu', 'full', 'part', 'time', 'permanent', 'contract', 'temporary', 'fixed', 'term', 'county', 'co', 'based', 'in', 'or', 'and', 'any']);
const companyWords = company => norm(company).replace(/ (inc|ltd|limited|llc|plc|group|ireland|technologies|labs)\b/g, '').trim();
function titlePrint(title, company = '') {
  const co = companyWords(company);
  const noise = text => { const n = norm(text); return !n || n === co || n.split(' ').every(w => PLACE.has(w)); };
  let t = String(title || '').replace(/\((?:[mfwdx]\s*\/\s*)+[mfwdx]\)|\b[mfwd]\/[mfwd](\/[mfwdx])?\b/gi, ' ');   // (m/f/d), m/w/d
  for (let m; (m = t.match(/^(.*\S)\s+[-–|]\s+([^-–|]*)$/)) && noise(m[2]);) t = m[1];          // "... - Dublin", "... | Acme"
  t = t.replace(/\(([^)]*)\)/g, (all, inner) => noise(inner) ? ' ' : ` ${inner} `);
  return norm(t).split(' ').filter(w => w !== 'and').map(w => ABBREV[w] || w).join(' ');
}
const fingerprint = (company, title) => companyWords(company) + '|' + titlePrint(title, company);
const same = (a, b) => a === b || (!!a && !!b && typeof a === 'object' && typeof b === 'object' && JSON.stringify(a) === JSON.stringify(b));

class Store {
  constructor(file) {
    this.file = file;
    this.jobs = readJson(file, {});
    this.base = structuredClone(this.jobs);   // as loaded, to tell our changes from another writer's
    this.reindex();
  }
  reindex() {
    this.byUrl = new Map(); this.byPrint = new Map();
    for (const j of Object.values(this.jobs)) this.index(j);
  }
  index(j) {
    if (j.url) this.byUrl.set(j.url, j.id);
    this.byPrint.set(fingerprint(j.company, j.title), j.id);
  }
  get(id) { return this.jobs[id]; }
  has(job) { return !!(this.jobs[job.id] || this.byUrl.has(job.url)); }
  // Id of a different stored job with the same company + title (e.g. a LinkedIn copy of a board post).
  duplicate(job) { const id = this.byPrint.get(fingerprint(job.company, job.title)); return id && id !== job.id ? id : null; }
  add(job) {
    this.jobs[job.id] = { status: 'new', firstSeen: new Date().toISOString(), history: [], ...job };
    this.index(this.jobs[job.id]);
    return this.jobs[job.id];
  }
  update(id, patch, note) {
    const j = this.jobs[id];
    if (!j) throw new Error(`unknown job ${id}`);
    const at = new Date().toISOString();
    if (patch.status && patch.status !== j.status) j.history.push({ at, from: j.status, to: patch.status, note });
    if (patch.outcome && patch.outcome !== j.outcome) j.history.push({ at, outcome: patch.outcome, note });
    Object.assign(j, patch);
    return j;
  }
  all() { return Object.values(this.jobs); }
  where(fn) { return this.all().filter(fn); }
  counts() { const c = {}; for (const j of this.all()) c[j.status] = (c[j.status] || 0) + 1; return c; }

  // Our changes since loading go on top of the file as it is now. A field the other writer also
  // changed keeps their value: they saved first, and it is usually you (e.g. "I applied") overruling
  // a run that started earlier. Afterwards this copy holds the merged result, updated in place so
  // job objects callers already hold stay live.
  save() {
    const disk = readJson(this.file, {});
    for (const [id, ours] of Object.entries(this.jobs)) {
      const base = this.base[id] || {}, theirs = disk[id];
      if (!theirs) { disk[id] = ours; continue; }
      const lost = new Set();
      for (const k of new Set([...Object.keys(ours), ...Object.keys(base)])) {
        if (k === 'history' || same(ours[k], base[k])) continue;
        if (!same(theirs[k], base[k])) { lost.add(k); continue; }
        if (ours[k] === undefined) delete theirs[k]; else theirs[k] = ours[k];
      }
      // History is append-only: keep both sides' new entries, minus ours for a change that lost.
      const added = (ours.history || []).slice((base.history || []).length)
        .filter(h => !(h.to && lost.has('status')) && !(h.outcome && lost.has('outcome')));
      if (added.length) theirs.history = [...(theirs.history || []), ...added];
    }
    writeJson(this.file, disk);
    for (const [id, j] of Object.entries(disk)) {
      const mine = this.jobs[id];
      if (!mine) { this.jobs[id] = j; continue; }
      if (mine === j) continue;
      for (const k of Object.keys(mine)) if (!(k in j)) delete mine[k];
      Object.assign(mine, j);
    }
    this.base = structuredClone(this.jobs);
    this.reindex();
  }
}

module.exports = { Store, fingerprint, titlePrint };
