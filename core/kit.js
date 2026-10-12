// "Help me apply" pack for one job: tailored CV (PDF + Word), what was changed in it and why,
// and a cover letter. Works for every job, including sites the app cannot fill in.
const fs = require('fs');
const path = require('path');
const { log, norm } = require('./util');
const { ask } = require('./llm');
const { plainText } = require('./cvtext');
const { cvFor } = require('./cv');
const { letterPdf } = require('./browser');

const LETTER_SYSTEM = `You write a cover letter for one candidate and one job, in the candidate's voice.
One page, three short paragraphs: why this role at this company, two or three matching achievements with numbers taken from the CV, a short close. Sign off with the candidate's full name.
Truthful: only what the CV supports. Never point out gaps or missing skills. No placeholders, no addresses, no date line. Follow the candidate's writing rules. No em dashes, never "passionate" or "leverage".`;

async function writeLetter(user, job) {
  const r = await ask({ model: user.settings.models.answer, system: LETTER_SYSTEM,
    schema: { type: 'object', required: ['letter'], properties: { letter: { type: 'string' } } },
    prompt: `# Candidate rules\n${user.rules()}\n\n# CV\n${plainText(user.cv())}\n\n# Job\n${job.title} at ${job.company} (${job.location})\n${(job.description || '').slice(0, 5000)}` });
  return r.letter.replace(/\s*—\s*/g, ', ').replace(/–/g, '-').trim();
}

// Human-readable list of what tailoring changed, so the person can see and trust it.
function cvChanges(master, t) {
  if (!t) return ['Your standard CV is used for this job (no changes).'];
  const out = [];
  if (norm(master.summary) !== norm(t.summary)) out.push('Summary rewritten to match this role.');
  const order = cv => (cv.skills || []).map(s => s[0]).join('|');
  if (order(master) !== order(t)) out.push(`Skills reordered: "${t.skills[0][0]}" now first.`);
  const units = cv => (cv.experience || []).flatMap(e => [...(e.bullets ? [[e.company, e.bullets]] : []), ...(e.roles || []).map(r => [r.company, r.bullets])]);
  const mu = Object.fromEntries(units(master).map(([k, b]) => [k, b]));
  for (const [company, b] of units(t)) {
    const orig = mu[company] || [];
    const cut = orig.length - b.length;
    const firstChanged = norm(b[0]) !== norm(orig[0]);
    if (cut > 0 && firstChanged) out.push(`${company}: most relevant points moved to the top, ${cut} less relevant cut.`);
    else if (cut > 0) out.push(`${company}: ${cut} less relevant point${cut > 1 ? 's' : ''} cut to keep it to 2 pages.`);
    else if (firstChanged) out.push(`${company}: most relevant points moved to the top.`);
  }
  out.push('Employers, job titles, dates, numbers and qualifications are unchanged (checked automatically).');
  return out;
}

async function makeKit(user, store, job) {
  const dir = path.join(user.paths.outputs, 'jobs', job.id.replace(/[^\w.-]+/g, '_'));
  const c = await cvFor(user, job);
  const letter = job.kit?.letter || await writeLetter(user, job);
  const letterFile = await letterPdf(path.join(dir, `Cover Letter - ${user.profile.fullName}.pdf`), letter);
  const rel = f => f && path.relative(user.dir, f);
  const kit = { cvPdf: rel(c.pdf), cvDocx: rel(c.pdf.replace(/\.pdf$/, '.docx')), letter, letterPdf: rel(letterFile),
    changes: cvChanges(user.cv(), c.tailoredCv), tailored: c.tailored, at: new Date().toISOString() };
  if (!fs.existsSync(path.join(user.dir, kit.cvDocx))) delete kit.cvDocx;
  store.update(job.id, { kit, ...(c.tailored ? { cvPdf: kit.cvPdf, cvSummary: c.summary } : {}) });
  store.save();
  log(`pack ready       ${job.score ?? '--'} ${job.company} | ${job.title}`);
  return kit;
}

// Packs for the best recommended jobs that do not have one yet.
async function makeKits(user, store, { limit, ids } = {}) {
  const jobs = ids?.length ? ids.map(id => store.get(id)).filter(Boolean)
    : store.where(j => ['ready', 'manual'].includes(j.status) && !j.kit).sort((a, b) => (b.score || 0) - (a.score || 0)).slice(0, limit ?? user.settings.apply.kitsPerRun);
  if (!jobs.length) return log('packs: every recommended job already has its CV and cover letter');
  log(`making tailored CV + cover letter for ${jobs.length} recommended job(s)`);
  for (const j of jobs) {
    try { await makeKit(user, store, j); }
    catch (e) { log('could not make the pack for', j.company, '-', e.message.split('\n')[0]); }
  }
}

module.exports = { makeKit, makeKits, writeLetter, cvChanges };
