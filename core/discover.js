// Board discovery: for a company found on LinkedIn/IrishJobs/etc. with no known board, guess slugs
// and probe Greenhouse, Ashby, Lever and Workable. A hit only counts when that board lists a job
// with the same title, so a slug belonging to an unrelated company is never added.
// Hits and misses are cached in data/boards.json, shared by everyone using this install.
const path = require('path');
const { log, getJson, pool, norm, readJson, writeJson, SHARED_DIR, isBlocked } = require('./util');
const { workableJobs } = require('./sources/boards');

const FILE = path.join(SHARED_DIR, 'boards.json');

function slugGuesses(company) {
  const words = norm(company).replace(/\b(inc|ltd|limited|llc|plc|group|ireland|dublin|europe|emea|technologies|technology|software|holdings|co)\b/g, ' ').split(/\s+/).filter(Boolean);
  return [...new Set([words.join(''), words.join('-'), words[0]].filter(s => s && s.length > 2))];
}

const HOSTS = { greenhouse: 'https://boards-api.greenhouse.io/', ashby: 'https://api.ashbyhq.com/', lever: 'https://api.lever.co/', workable: 'https://apply.workable.com/' };
const PROBES = {
  greenhouse: async s => (await getJson(`https://boards-api.greenhouse.io/v1/boards/${s}/jobs`))?.jobs?.map(x => x.title),
  ashby: async s => (await getJson(`https://api.ashbyhq.com/posting-api/job-board/${s}`))?.jobs?.map(x => x.title),
  lever: async s => { const r = await getJson(`https://api.lever.co/v0/postings/${s}?mode=json`); return Array.isArray(r) ? r.map(x => x.text) : null; },
  workable: async s => (await workableJobs(s))?.map(x => x.title)
};

// jobs: postings from search sources. known: Set of slugs already configured. Returns all found boards.
async function discoverBoards(jobs, known) {
  const cache = readJson(FILE, { found: {}, misses: {} });
  const monthAgo = Date.now() - 30 * 86400000;
  const byCompany = {};
  for (const j of jobs) if (j.ats === 'external' || j.ats === 'workable-search') (byCompany[j.company] ||= []).push(j);
  await pool(Object.keys(byCompany), 4, async company => {
    const titles = new Set(byCompany[company].map(j => norm(j.title)));
    for (const slug of slugGuesses(company)) {
      if (known.has(slug) || cache.found[slug]) continue;
      if (cache.misses[slug] && Date.parse(cache.misses[slug]) > monthAgo) continue;
      // Workable is only probed for companies seen in Workable's own search: it rate-limits hard.
      const atsList = Object.keys(PROBES).filter(a => a !== 'workable' || byCompany[company].some(j => j.ats === 'workable-search'));
      for (const ats of atsList) {
        const probe = PROBES[ats];
        const list = await probe(slug);
        if (list && list.some(t => titles.has(norm(t)))) {
          cache.found[slug] = { ats, company, at: new Date().toISOString() };
          log(`found ${company}'s ${ats} board ("${slug}"): its jobs can now be filled in automatically`);
          return;
        }
      }
      // Only a real "no such board" counts as a miss; a rate-limited site proves nothing.
      if (!atsList.some(a => isBlocked(HOSTS[a]))) cache.misses[slug] = new Date().toISOString();
    }
  });
  writeJson(FILE, cache);
  return cache.found;
}

module.exports = { discoverBoards, slugGuesses };
