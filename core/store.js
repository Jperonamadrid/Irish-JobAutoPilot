// One person's job database (users/<id>/jobs.json), keyed by stable id (e.g. gh:stripe:8007205).
// Status flow: new -> skipped | ready | manual
//   ready -> ready_to_submit | needs_input | failed | closed     any -> submitted (you sent it)
const { readJson, writeJson, norm } = require('./util');

const fingerprint = (company, title) =>
  norm(company).replace(/ (inc|ltd|limited|llc|plc|group|ireland|technologies|labs)\b/g, '') + '|' + norm(title);

class Store {
  constructor(file) {
    this.file = file;
    this.jobs = readJson(file, {});
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
    if (patch.status && patch.status !== j.status) j.history.push({ at: new Date().toISOString(), from: j.status, to: patch.status, note });
    Object.assign(j, patch);
    return j;
  }
  all() { return Object.values(this.jobs); }
  where(fn) { return this.all().filter(fn); }
  counts() { const c = {}; for (const j of this.all()) c[j.status] = (c[j.status] || 0) + 1; return c; }
  save() { writeJson(this.file, this.jobs); }
}

module.exports = { Store, fingerprint };
