// Market report: what the searches found, for the person's titles, in plain numbers, plus a short
// AI-written summary. Salaries come only from what postings state (never invented).
const { log, norm, writeJson, readJson } = require('./util');
const { ask } = require('./llm');

const HOURS_PER_YEAR = 39 * 52;   // Irish full-time week

// Salaries stated in a posting, as annual EUR numbers. Returns [] when none.
function parseSalaries(text) {
  const t = String(text || '').replace(/ /g, ' ');
  const out = [];
  const num = s => +String(s).replace(/[,\s]/g, '');
  // €30,000 / €30k / 30,000 per annum (EUR); ranges handled as two numbers
  for (const m of t.matchAll(/€\s?(\d{1,3}(?:[,\s]\d{3})+|\d{2,3}(?:\.\d)?\s?k)\b(?!\s*(?:per|an|\/)\s*(?:hour|hr))/gi)) {
    const v = /k/i.test(m[1]) ? parseFloat(m[1]) * 1000 : num(m[1]);
    if (v >= 15000 && v <= 400000) out.push(v);
  }
  // €14.50 per hour
  for (const m of t.matchAll(/€\s?(\d{1,2}(?:\.\d{1,2})?)\s*(?:per|an|\/|p\/?)\s*(?:hour|hr|h)\b/gi)) {
    const v = parseFloat(m[1]);
    if (v >= 8 && v <= 150) out.push(Math.round(v * HOURS_PER_YEAR));
  }
  return out;
}
const median = a => { if (!a.length) return null; const s = [...a].sort((x, y) => x - y), m = s.length >> 1; return s.length % 2 ? s[m] : Math.round((s[m - 1] + s[m]) / 2); };

// A job "belongs" to a search title when its title contains that title's meaningful words.
const STOP = new Set(['and', 'of', 'the', 'i', 'ii', 'iii', 'a', 'in', 'for', 'to']);
const titleWords = t => norm(t).split(' ').filter(w => w.length > 1 && !STOP.has(w));
function matchesTitle(jobTitle, searchTitle) {
  const jt = ` ${norm(jobTitle)} `, ws = titleWords(searchTitle);
  return ws.length > 0 && ws.every(w => jt.includes(` ${w} `) || jt.includes(` ${w}s `));
}

function compute(user, store, { days = 30 } = {}) {
  const since = Date.now() - days * 86400000;
  const jobs = store.all().filter(j => !['duplicate', 'excluded'].includes(j.status) && Date.parse(j.firstSeen || 0) > since);
  const threshold = user.settings.apply.threshold;
  const good = j => (j.score ?? 0) >= threshold && !j.dealbreaker;
  const sal = j => (j._sal ??= parseSalaries(`${j.title}\n${j.description}`));
  const byTitle = user.settings.search.titles.map(t => {
    const m = jobs.filter(j => matchesTitle(j.title, t));
    const s = m.flatMap(sal);
    return { title: t, jobs: m.length, goodFits: m.filter(good).length, salaryMedian: median(s), salaryMin: s.length ? Math.min(...s) : null, salaryMax: s.length ? Math.max(...s) : null, salaryCount: m.filter(j => sal(j).length).length };
  }).sort((a, b) => b.jobs - a.jobs);
  const count = (arr, key) => Object.entries(arr.reduce((a, j) => { const k = key(j); if (k) a[k] = (a[k] || 0) + 1; return a; }, {})).sort((a, b) => b[1] - a[1]);
  // Overall pay only from jobs that match one of the person's titles (broad keywords can pull in
  // unrelated, differently paid roles).
  const titled = jobs.filter(j => user.settings.search.titles.some(t => matchesTitle(j.title, t)));
  const allSal = titled.flatMap(sal);
  const recommended = jobs.filter(j => ['ready', 'manual', 'ready_to_submit', 'needs_input'].includes(j.status)).sort((a, b) => (b.score || 0) - (a.score || 0))
    .slice(0, 12).map(j => ({ id: j.id, title: j.title, company: j.company, score: j.score, reason: j.reason, url: j.url, status: j.status }));
  return {
    at: new Date().toISOString(), days, total: jobs.length, goodFits: jobs.filter(good).length,
    remoteShare: jobs.length ? Math.round(100 * jobs.filter(j => /remote/i.test(j.location || '')).length / jobs.length) : 0,
    salary: { median: median(allSal), min: allSal.length ? Math.min(...allSal) : null, max: allSal.length ? Math.max(...allSal) : null, postingsWithSalary: titled.filter(j => sal(j).length).length },
    byTitle, topCompanies: count(jobs, j => j.company).slice(0, 12), bySource: count(jobs, j => j.source), recommended
  };
}

const SUMMARY_SCHEMA = { type: 'object', required: ['summary', 'tips', 'suggestedTitles'], properties: {
  summary: { type: 'string' }, tips: { type: 'array', items: { type: 'string' } }, suggestedTitles: { type: 'array', items: { type: 'string' } } } };

async function report(user, store) {
  const m = compute(user, store);
  log(`market: ${m.total} matching jobs in the last ${m.days} days, ${m.goodFits} good fits`);
  if (m.total) {
    try {
      const titlesSeen = store.all().filter(j => (j.score ?? 0) >= 60).map(j => j.title).slice(0, 120);
      const r = await ask({ model: user.settings.models.score, schema: SUMMARY_SCHEMA,
        system: 'You explain a job-market scan to a job seeker in plain, encouraging, honest English. Use only the numbers given; write money as euros (e.g. €40,000). Do not mention job-board or software names. No em dashes.',
        prompt: `# Candidate\n${user.profile.fullName}, ${user.profile.currentTitle || ''}. Target titles: ${user.settings.search.titles.join(', ')}.\n\n` +
          `# Scan results (JSON)\n${JSON.stringify({ ...m, recommended: m.recommended.map(r => `${r.title} at ${r.company} (${r.score})`) })}\n\n# Titles of jobs that scored 60+\n${titlesSeen.join('\n')}\n\n` +
          'Write: summary = 3-5 sentences on demand, pay (only stated salaries) and where the best chances are; tips = 3-5 practical next steps; ' +
          'suggestedTitles = up to 6 job titles that appear in the well-scoring jobs but are not in the target titles (empty if none).' });
      Object.assign(m, r);
    } catch (e) { log('market summary failed (numbers are still shown):', e.message); }
  }
  writeJson(user.p('market.json'), m);
  return m;
}

const load = user => readJson(user.p('market.json'), null);

module.exports = { report, compute, load, parseSalaries, matchesTitle, median };
