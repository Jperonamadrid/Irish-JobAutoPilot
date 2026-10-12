// Prepares applications: tailored CV + cover letter + every form field filled, then stops.
// Nothing is ever submitted by the app; review() opens each one for the person to check and send.
const fs = require('fs');
const path = require('path');
const { log, today, norm } = require('./util');
const { resolve } = require('./answers');
const { launch, letterPdf, closePdf } = require('./browser');
const { cvFor, masterPdf } = require('./cv');

const adapters = { greenhouse: require('./ats/greenhouse'), ashby: require('./ats/ashby'), lever: require('./ats/lever'), workable: require('./ats/workable') };
const safe = id => id.replace(/[^\w.-]+/g, '_');

// Per-run and per-company limits, including published caps like OpenAI's 5 per 180 days.
function pick(user, store, { ids, limit, statuses }) {
  if (ids?.length) return ids.map(id => store.get(id)).filter(Boolean);
  const { maxPerRun, maxPerCompanyPerRun, companyCaps } = user.settings.apply;
  const perCompany = {};
  const sent = (company, days) => store.where(j => norm(j.company) === company && j.status === 'submitted' &&
    Date.parse(j.submittedAt || 0) > Date.now() - days * 86400000).length;
  return store.where(j => statuses.includes(j.status) && adapters[j.ats])
    .sort((a, b) => (b.score || 0) - (a.score || 0))
    .filter(j => {
      const c = norm(j.company), cap = companyCaps[c.replace(/ /g, '')];
      if ((perCompany[c] = (perCompany[c] || 0) + 1) > maxPerCompanyPerRun) return false;
      if (cap && sent(c, cap.days) + perCompany[c] > cap.max) return false;
      return true;
    })
    .slice(0, limit ?? maxPerRun);
}

// Fill one job's form in `browser`. Returns the open page when keepOpen, otherwise closes it.
async function prepareOne(user, browser, store, job, { keepOpen = false } = {}) {
  const ad = adapters[job.ats];
  const sch = await ad.schema(job);
  if (!sch) { store.update(job.id, { status: 'closed' }, 'posting no longer open'); log(`closed        ${job.company} | ${job.title}`); return null; }
  const out = path.join(user.paths.outputs, 'jobs', safe(job.id));

  // CV: tailored once per job and reused on later re-fills.
  const files = { degreeFallback: user.profile.education?.degreeFallback };
  if (job.cvPdf && fs.existsSync(path.join(user.dir, job.cvPdf))) {
    files.cv = path.join(user.dir, job.cvPdf);
    files.summary = job.cvSummary || user.cv().summary;
  } else if (user.settings.apply.tailorCv) {
    const c = await cvFor(user, job);
    files.cv = c.pdf; files.summary = c.summary;
    if (c.tailored) store.update(job.id, { cvPdf: path.relative(user.dir, c.pdf), cvSummary: c.summary });
  } else { files.cv = await masterPdf(user); files.summary = user.cv().summary; }

  const res = await resolve(user, job, sch.fields, files, job.answers);
  if (res.coverLetter && sch.fields.some(f => f.role === 'coverLetter' && f.type === 'file'))
    files.coverLetter = await letterPdf(path.join(out, `Cover Letter - ${user.profile.fullName}.pdf`), res.coverLetter);
  if (res.coverLetter) { fs.mkdirSync(out, { recursive: true }); fs.writeFileSync(path.join(out, 'cover-letter.txt'), res.coverLetter); }

  const page = await browser.newPage();
  let fillErrors = [];
  try { fillErrors = await ad.fill(page, job, sch.fields, res, files); }
  catch (e) { fillErrors = [{ key: 'page', label: 'the application form', why: 'the form did not load: ' + e.message.split('\n')[0].slice(0, 150) }]; }
  const pending = [...sch.blockers, ...res.pending, ...fillErrors];
  const shot = path.join(out, `form-${today()}.png`);
  await page.screenshot({ path: shot, fullPage: true }).catch(() => {});
  store.update(job.id, {
    answers: { values: res.values, sources: res.sources, coverLetter: res.coverLetter, pending: res.pending },
    pending, screenshot: path.relative(user.dir, shot), filledAt: new Date().toISOString(), error: undefined,
    status: pending.length ? 'needs_input' : 'ready_to_submit'
  }, pending.length ? `${pending.length} open question(s)` : 'prepared');
  log(`${pending.length ? 'needs you    ' : 'prepared     '} ${job.score ?? '--'} ${job.company} | ${job.title}` +
    (pending.length ? `  (${pending.map(p => p.label).join('; ').slice(0, 110)})` : ''));
  if (keepOpen) return page;
  await page.close();
  return null;
}

async function prepare(user, store, { limit, ids, statuses = ['ready'] } = {}) {
  const jobs = pick(user, store, { ids, limit, statuses });
  if (!jobs.length) return log('prepare: nothing waiting to be prepared');
  log(`preparing ${jobs.length} application(s); nothing will be submitted`);
  await masterPdf(user);
  const browser = await launch(user.paths.browser);
  try {
    for (const job of jobs) {
      try { await prepareOne(user, browser, store, job); }
      catch (e) { store.update(job.id, { status: 'failed', error: e.message.slice(0, 300) }, 'error'); log('failed', job.company, '|', job.title, '-', e.message.split('\n')[0]); }
      store.save();
    }
  } finally { await browser.close().catch(() => {}); await closePdf(); }
}

// The person submits, never the app. Each prepared application opens (re-filled from saved
// answers, no AI cost); the job is marked submitted when its confirmation page appears, and left
// in the queue if the tab is closed without submitting.
const DONE_RE = /thank you for (applying|your (application|interest))|application (was |has been )?(successfully )?(submitted|received|sent)|we('ve| have) received your application|thanks for applying/i;
async function review(user, store, { ids, onStep } = {}) {
  const jobs = ids?.length ? ids.map(id => store.get(id)).filter(Boolean)
    : store.where(j => j.status === 'ready_to_submit').sort((a, b) => (b.score || 0) - (a.score || 0));
  if (!jobs.length) return log('review: nothing prepared yet');
  const browser = await launch(user.paths.browser);
  try {
    for (const [i, job] of jobs.entries()) {
      log(`[${i + 1}/${jobs.length}] ${job.score} | ${job.company} | ${job.title}`);
      const page = await prepareOne(user, browser, store, job, { keepOpen: true });
      store.save();
      if (!page) continue;
      log(store.get(job.id).status === 'needs_input'
        ? '  some questions are still unanswered: fill them in the browser if you want to send it now'
        : '  check the form, click Submit if you are happy, then close the tab to go to the next one');
      onStep?.(job);
      let sent = false;
      const timer = setInterval(async () => {
        const t = await page.locator('body').innerText({ timeout: 2000 }).catch(() => '');
        if (DONE_RE.test(t) || /confirmation|thank/i.test(page.url())) sent = true;
      }, 1500);
      await new Promise(r => page.on('close', r));
      clearInterval(timer);
      if (sent) { store.update(job.id, { status: 'submitted', submittedAt: new Date().toISOString() }, 'submitted by you'); log('  recorded as submitted'); }
      else log('  not submitted; it stays in the queue');
      store.save();
    }
  } finally { await browser.close().catch(() => {}); await closePdf(); }
}

module.exports = { prepare, review, prepareOne, pick, adapters };
