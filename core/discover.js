// Board discovery: for a company found on LinkedIn/IrishJobs/etc. with no known board, guess slugs
// and probe the job systems companies publish their openings on. A hit only counts when that board
// lists a job with the same title, so a slug belonging to an unrelated company is never added.
// Greenhouse, Ashby, Lever and Workable boards can also be filled in automatically; SmartRecruiters,
// Recruitee and Personio boards are searched directly (full description, the company's own link).
// Hits and misses are cached in data/boards.json, shared by everyone using this install.
//
// The person can also follow companies by name or by careers-page link (followed()): those boards
// are fetched on every run whether or not a job board search turned them up.
const path = require('path');
const { log, getJson, getText, pool, norm, readJson, writeJson, SHARED_DIR, isBlocked } = require('./util');
const { workableJobs, smartRecruitersJobs, parsePersonio } = require('./sources/boards');

const FILE = path.join(SHARED_DIR, 'boards.json');
const FILLABLE = new Set(['greenhouse', 'ashby', 'lever', 'workable']);

function slugGuesses(company) {
  const words = norm(company).replace(/\b(inc|ltd|limited|llc|plc|group|ireland|dublin|europe|emea|technologies|technology|software|holdings|co)\b/g, ' ').split(/\s+/).filter(Boolean);
  return [...new Set([words.join(''), words.join('-'), words[0]].filter(s => s && s.length > 2))];
}

const HOSTS = { greenhouse: 'https://boards-api.greenhouse.io/', ashby: 'https://api.ashbyhq.com/', lever: 'https://api.lever.co/', workable: 'https://apply.workable.com/',
  smartrecruiters: 'https://api.smartrecruiters.com/' };
// Each probe returns the board's job titles, or null when there is no such board.
const PROBES = {
  greenhouse: async s => (await getJson(`https://boards-api.greenhouse.io/v1/boards/${s}/jobs`))?.jobs?.map(x => x.title),
  ashby: async s => (await getJson(`https://api.ashbyhq.com/posting-api/job-board/${s}`))?.jobs?.map(x => x.title),
  lever: async s => { const r = await getJson(`https://api.lever.co/v0/postings/${s}?mode=json`); return Array.isArray(r) ? r.map(x => x.text) : null; },
  workable: async s => (await workableJobs(s))?.map(x => x.title),
  smartrecruiters: async s => (await smartRecruitersJobs(s))?.map(x => x.name),
  recruitee: async s => (await getJson(`https://${s}.recruitee.com/api/offers/`))?.offers?.map(x => x.title),
  personio: async s => { const x = await getText(`https://${s}.jobs.personio.de/xml?language=en`); return x?.includes('<position>') ? parsePersonio(x).map(p => p.title) : null; }
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
        const list = await PROBES[ats](slug);
        if (list && list.some(t => titles.has(norm(t)))) {
          cache.found[slug] = { ats, company, at: new Date().toISOString() };
          log(`found ${company}'s ${ats} board ("${slug}"): ` + (FILLABLE.has(ats) ? 'its jobs can now be filled in automatically' : 'its jobs are now searched directly'));
          return;
        }
      }
      // Only a real "no such board" counts as a miss; a rate-limited site proves nothing.
      if (!atsList.some(a => isBlocked(HOSTS[a] || `https://${slug}.${a}.com/`))) cache.misses[slug] = new Date().toISOString();
    }
  });
  writeJson(FILE, cache);
  return cache.found;
}

// A careers-page link names its board directly. Returns { ats, slug } or a Workday { ats, workday }.
function boardFromUrl(text) {
  let u; try { u = new URL(/^https?:/i.test(text) ? text : 'https://' + text); } catch { return null; }
  const host = u.hostname.toLowerCase(), first = u.pathname.split('/').filter(Boolean)[0] || '';
  const q = u.searchParams.get('for');
  if (/(^|\.)greenhouse\.io$/.test(host)) { const slug = q || (first !== 'embed' && first); return slug ? { ats: 'greenhouse', slug: slug.toLowerCase() } : null; }
  if (host === 'jobs.lever.co') return first && { ats: 'lever', slug: first.toLowerCase() };
  if (host === 'jobs.ashbyhq.com') return first && { ats: 'ashby', slug: first };
  if (host === 'apply.workable.com') return first && { ats: 'workable', slug: first.toLowerCase() };
  if (/^(jobs|careers)\.smartrecruiters\.com$/.test(host)) return first && { ats: 'smartrecruiters', slug: first };
  let m;
  if ((m = host.match(/^([\w-]+)\.recruitee\.com$/))) return { ats: 'recruitee', slug: m[1] };
  if ((m = host.match(/^([\w-]+)\.jobs\.personio\.(de|com)$/))) return { ats: 'personio', slug: m[1] };
  if ((m = host.match(/^([\w-]+)\.(wd\d+)\.myworkdayjobs\.com$/))) {
    const site = u.pathname.split('/').filter(p => p && !/^[a-z]{2}-[A-Z]{2}$/.test(p))[0];
    return site ? { ats: 'workday', workday: { tenant: m[1], wd: m[2], site } } : null;
  }
  return null;
}

// Boards for the companies the person follows: links are read directly, names are looked up once
// (first job system with a board under a likely slug) and remembered.
async function followed(entries) {
  const cache = readJson(FILE, { found: {}, misses: {} });
  cache.named ||= {};
  const out = [];
  for (const raw of entries.map(e => String(e).trim()).filter(Boolean)) {
    const fromUrl = /[./]/.test(raw) && boardFromUrl(raw);
    if (fromUrl) { out.push({ ...fromUrl, company: raw }); continue; }
    const key = norm(raw), hit = cache.named[key];
    if (hit?.slug) { out.push({ ...hit, company: raw }); continue; }
    if (hit && Date.parse(hit.at) > Date.now() - 7 * 86400000) continue;   // looked up recently, nothing found
    let found = null;
    for (const slug of slugGuesses(raw)) {
      for (const ats of Object.keys(PROBES)) if ((await PROBES[ats](slug))?.length) { found = { ats, slug }; break; }
      if (found) break;
    }
    cache.named[key] = { ...(found || {}), at: new Date().toISOString() };
    log(found ? `following ${raw}: found its ${found.ats} board ("${found.slug}")`
      : `following ${raw}: no public job board found under that name; paste a link to its careers page instead`);
    if (found) out.push({ ...found, company: raw });
  }
  writeJson(FILE, cache);
  return out;
}

module.exports = { discoverBoards, slugGuesses, boardFromUrl, followed, FILLABLE };
