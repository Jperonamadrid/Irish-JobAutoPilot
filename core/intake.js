// Job intake for one person: pull every enabled source, keep titles/locations that match their
// filters, de-duplicate, and store new jobs. No AI involved: plain HTTP (plus a browser window for
// IrishJobs/Jobs.ie), so it is fast and free.
const path = require('path');
const { log, pool, SHARED_DIR } = require('./util');
const { launch } = require('./browser');
const irish = require('./sources/irish');
const boards = require('./sources/boards');
const feeds = require('./sources/feeds');
const { stepstone } = require('./sources/stepstone');
const { discoverBoards, followed } = require('./discover');

const AUTO_FILL = new Set(['greenhouse', 'ashby', 'lever', 'workable']);

async function intake(user, store, { days: daysOverride } = {}) {
  const t0 = Date.now();
  const { settings, preset } = user;
  const s = settings.search, on = settings.sources;
  const wanted = (t, l) => user.wanted(t, l);
  const names = { ...preset.names };
  const ctx = { wanted, names, city: s.city, country: preset.country, countryCode: preset.countryCode };
  const titles = s.titles.length ? s.titles : s.includeKeywords.slice(0, 15);
  const days = daysOverride || s.postedWithinDays;
  const fail = name => e => (log(`${name} failed (skipped this time): ${e.message.split('\n')[0]}`), []);
  const off = () => Promise.resolve([]);

  // Search sources first, so company boards they reveal are fetched in this same run.
  const liLocation = s.city === preset.defaultCity ? preset.linkedinLocation : `${s.city}, ${preset.country}`;
  // Sites that only work in a real browser share one window (one profile cannot be opened twice).
  const browserSources = async () => {
    if (!on.irishjobs && !on.jobsireland) return [];
    const ctx = await launch(path.join(SHARED_DIR, 'browser-scrape'));
    try {
      const page = await ctx.newPage();
      const a = on.irishjobs ? await stepstone(page, { sites: preset.stepstoneSites, city: s.city, titles, wanted, known: j => store.has(j), days }).catch(fail('IrishJobs/Jobs.ie')) : [];
      const b = on.jobsireland ? await irish.jobsireland(page, { titles, wanted, city: s.city, days }).catch(fail('JobsIreland')) : [];
      return [...a, ...b];
    } finally { await ctx.close().catch(() => {}); }
  };
  const [li, jb, wk, jc, ss, cj, pj, ri, ro] = await Promise.all([
    on.linkedin ? feeds.linkedin({ titles, wanted, location: liLocation, days }).catch(fail('LinkedIn')) : off(),
    on.jooble ? feeds.jooble({ key: settings.joobleKey, titles, wanted, location: `${s.city}, ${preset.country}`, days }).catch(fail('Jooble')) : off(),
    on.workable ? feeds.workableSearch({ titles, wanted, country: preset.country }).catch(fail('Workable search')) : off(),
    on.jobicy && s.remote !== 'none' ? feeds.jobicy({ wanted, country: preset.country }).catch(fail('Jobicy')) : off(),
    browserSources().catch(fail('browser sources')),
    on.careerjet ? irish.careerjet({ titles, wanted, city: s.city, days }).catch(fail('CareerJet')) : off(),
    on.publicjobs ? irish.publicjobs({ wanted, days }).catch(fail('publicjobs.ie')) : off(),
    on.recruitireland ? irish.recruitireland({ titles, wanted, days }).catch(fail('RecruitIreland')) : off(),
    on.remoteok && s.remote !== 'none' ? feeds.remoteok({ wanted }).catch(fail('Remote OK')) : off()
  ]);
  const searchJobs = [li, jb, wk, jc, ss, cj, pj, ri, ro].flat();

  const BOARDS = ['greenhouse', 'ashby', 'lever', 'workable', 'smartrecruiters', 'recruitee', 'personio'];
  const list = Object.fromEntries(BOARDS.map(a => [a, on.boards ? [...(preset.boards[a] || [])] : []]));
  const workdays = on.boards && on.workday ? [...preset.boards.workday] : [];
  const known = new Set(Object.values(list).flat().map(b => b.toLowerCase()));
  const found = on.boards ? { ...preset.discovered, ...await discoverBoards(searchJobs, known) } : {};
  for (const [slug, { ats, company }] of Object.entries(found)) {
    if (known.has(slug.toLowerCase()) || !list[ats]) continue;
    list[ats].push(slug); known.add(slug.toLowerCase());
    names[slug] ||= company;
  }
  // Companies the person follows are fetched on every run, even with company boards switched off.
  const follows = await followed(s.followCompanies || []).catch(e => (log('could not look up followed companies:', e.message), []));
  const followedBoards = new Set();
  for (const f of follows) {
    if (f.workday) { workdays.push(f.workday); followedBoards.add(f.workday.tenant); continue; }
    followedBoards.add(f.slug.toLowerCase());
    if (!known.has(f.slug.toLowerCase())) { list[f.ats].push(f.slug); known.add(f.slug.toLowerCase()); }
  }

  const tasks = [...BOARDS.flatMap(a => list[a].map(b => () => boards[a](b, ctx))), ...workdays.map(w => () => boards.workday(w, ctx))];
  const boardJobs = (await pool(tasks, 8, f => f())).flat().filter(Boolean);
  for (const j of boardJobs) if (followedBoards.has(String(j.board).toLowerCase())) j.followed = true;

  const r = merge(user, store, [...boardJobs, ...searchJobs]);
  store.save();
  const bySource = {};
  for (const j of [...boardJobs, ...searchJobs]) bySource[j.source] = (bySource[j.source] || 0) + 1;
  log(`search done in ${((Date.now() - t0) / 1000).toFixed(0)}s: ${r.added} new jobs (${Object.entries(bySource).map(([k, v]) => `${k} ${v}`).join(', ') || 'nothing matched'}); ` +
    `${r.seen} already known, ${r.dup} duplicates`);
  return r.added;
}

// Board postings come first in `jobs`: they can be filled automatically, so they win duplicate checks.
function merge(user, store, jobs) {
  let added = 0, dup = 0, seen = 0;
  const cutoff = Date.now() - 60 * 86400000;
  for (const job of jobs) {
    if (user.filters.excludedCompany(job.company)) continue;
    if (store.has(job)) {
      const old = store.get(job.id);   // fill gaps in older records
      if (old) for (const k of ['description', 'postedAt', 'applyUrl', 'location', 'board', 'atsId']) if (!old[k] && job[k]) old[k] = job[k];
      seen++; continue;
    }
    const other = store.duplicate(job);
    if (other) {
      const o = store.get(other);
      if (!AUTO_FILL.has(job.ats) || AUTO_FILL.has(o.ats) || ['submitted', 'skipped'].includes(o.status)) { dup++; continue; }
      store.update(other, { status: 'duplicate', duplicateOf: job.id }, 'company board posting found');
    }
    // Board postings are live by definition; aggregator results older than 60 days are dropped.
    if (!AUTO_FILL.has(job.ats) && job.postedAt && Date.parse(job.postedAt) < cutoff) continue;
    store.add(job); added++;
  }
  return { added, dup, seen };
}

module.exports = { intake, merge, AUTO_FILL };
