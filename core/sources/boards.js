// Company job boards with public APIs: Greenhouse, Ashby, Lever, Workable (all auto-fillable)
// and Workday (discovery only: applying needs an account per employer).
// map* functions are pure (API JSON in, jobs out) so tests can run them on saved fixtures.
const { log, request, getJson, getText, postJson, pool, htmlToText, decode, isBlocked } = require('../util');

const clip = (s, n = 6000) => (s || '').slice(0, n);
const titleCase = (s, names = {}) => names[s] || s.replace(/(^|[-_ ])(\w)/g, (_, a, b) => (a ? ' ' : '') + b.toUpperCase());

function mapGreenhouse(j, board, { wanted, names }) {
  return (j.jobs || []).filter(x => wanted(x.title, [x.location?.name, ...(x.offices || []).map(o => o.name)])).map(x => ({
    id: `gh:${board}:${x.id}`, source: 'greenhouse', ats: 'greenhouse', board, atsId: String(x.id),
    company: x.company_name || titleCase(board, names), title: x.title.trim(), location: x.location?.name || '',
    url: x.absolute_url, applyUrl: `https://job-boards.greenhouse.io/embed/job_app?for=${board}&token=${x.id}`,
    postedAt: x.first_published || x.updated_at, description: clip(htmlToText(x.content))
  }));
}

function mapAshby(j, board, { wanted, names }) {
  return (j.jobs || []).filter(x => x.isListed !== false).filter(x => {
    const locs = [x.location, ...(x.secondaryLocations || []).map(s => s.location), x.address?.postalAddress?.addressCountry];
    if (x.isRemote) locs.push('remote ' + locs.filter(Boolean).join(' '));
    return wanted(x.title, locs);
  }).map(x => ({
    id: `ashby:${board}:${x.id}`, source: 'ashby', ats: 'ashby', board, atsId: x.id,
    company: titleCase(board, names), title: x.title.trim(),
    location: [x.location, ...(x.secondaryLocations || []).map(s => s.location)].filter(Boolean).join(' / '),
    url: x.jobUrl, applyUrl: `https://jobs.ashbyhq.com/${board}/${x.id}/application`,
    postedAt: x.publishedAt, description: clip(x.descriptionPlain)
  }));
}

function mapLever(j, board, { wanted, names, countryCode, country }) {
  return (Array.isArray(j) ? j : []).filter(x => wanted(x.text, [x.categories?.location, ...(x.categories?.allLocations || []),
    x.country && x.country === countryCode ? country : ''])).map(x => ({
    id: `lever:${board}:${x.id}`, source: 'lever', ats: 'lever', board, atsId: x.id,
    company: titleCase(board, names), title: x.text.trim(), location: x.categories?.location || '',
    url: x.hostedUrl, applyUrl: x.applyUrl, postedAt: new Date(x.createdAt).toISOString(),
    description: clip([x.descriptionPlain, ...(x.lists || []).map(l => l.text + '\n' + htmlToText(l.content)), x.additionalPlain].join('\n'))
  }));
}

async function greenhouse(board, ctx) {
  const j = await getJson(`https://boards-api.greenhouse.io/v1/boards/${board}/jobs?content=true`);
  if (!j) return isBlocked('https://boards-api.greenhouse.io/') || log('greenhouse board not found:', board), [];
  return mapGreenhouse(j, board, ctx);
}
async function ashby(board, ctx) {
  const j = await getJson(`https://api.ashbyhq.com/posting-api/job-board/${board}`);
  if (!j) return isBlocked('https://api.ashbyhq.com/') || log('ashby board not found:', board), [];
  return mapAshby(j, board, ctx);
}
async function lever(board, ctx) {
  const j = await getJson(`https://api.lever.co/v0/postings/${board}?mode=json`);
  if (!Array.isArray(j)) return isBlocked('https://api.lever.co/') || log('lever board not found:', board), [];
  return mapLever(j, board, ctx);
}

// Workable: list an account's jobs (paginated), then fetch descriptions for the matching ones.
async function workableJobs(account) {
  const out = []; let token;
  for (let i = 0; i < 10; i++) {
    const j = await request(`https://apply.workable.com/api/v3/accounts/${account}/jobs`, { method: 'POST',
      headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ query: '', location: [], department: [], worktype: [], remote: [], ...(token ? { token } : {}) }) });
    if (!j?.results) return i ? out : null;
    out.push(...j.results); token = j.nextPage; if (!token) break;
  }
  return out;
}
async function workable(account, { wanted, names }) {
  const list = await workableJobs(account);
  if (!list) { if (!isBlocked('https://apply.workable.com/')) log('workable account not found:', account); return []; }
  const keep = list.filter(x => wanted(x.title, [x.location?.city, x.location?.country, x.remote ? 'remote ' + (x.location?.country || '') : '',
    ...(x.locations || []).map(l => `${l.city || ''}, ${l.country || ''}`)]));
  return (await pool(keep, 3, async x => {
    const d = await getJson(`https://apply.workable.com/api/v1/accounts/${account}/jobs/${x.shortcode}`);
    return { id: `workable:${account}:${x.shortcode}`, source: 'workable', ats: 'workable', board: account, atsId: x.shortcode,
      company: titleCase(account, names), title: x.title.trim(),
      location: x.remote ? `Remote (${x.location?.country || ''})` : [x.location?.city, x.location?.country].filter(Boolean).join(', '),
      url: `https://apply.workable.com/${account}/j/${x.shortcode}/`, applyUrl: `https://apply.workable.com/${account}/j/${x.shortcode}/apply/`,
      postedAt: x.published, description: clip(htmlToText([d?.description, d?.requirements].join('\n'))) };
  })).filter(Boolean);
}

async function workday({ tenant, wd, site }, { wanted, names, city }) {
  const base = `https://${tenant}.${wd}.myworkdayjobs.com`, out = [];
  for (let offset = 0; offset < 200; offset += 20) {   // the API rejects limit > 20
    const j = await postJson(`${base}/wday/cxs/${tenant}/${site}/jobs`, { appliedFacets: {}, limit: 20, offset, searchText: city });
    if (!j || !Array.isArray(j.jobPostings)) { if (!offset) log('workday tenant not responding:', tenant); break; }
    for (const x of j.jobPostings) if (wanted(x.title, [x.locationsText])) out.push({
      id: `wd:${tenant}:${x.externalPath.split('/').pop()}`, source: 'workday', ats: 'workday', board: tenant,
      company: titleCase(tenant, names), title: x.title.trim(), location: x.locationsText,
      url: `${base}/en-US/${site}${x.externalPath}`, detail: `${base}/wday/cxs/${tenant}/${site}${x.externalPath}`
    });
    if (offset + 20 >= (j.total || 0)) break;
  }
  await pool(out, 4, async o => {
    const d = await getJson(o.detail); delete o.detail;
    o.description = clip(htmlToText(d?.jobPostingInfo?.jobDescription));
    o.postedAt = d?.jobPostingInfo?.startDate;
  });
  return out;
}

// ---- Boards that can be searched but not filled in (their jobs go to the "apply yourself" list) ----

// SmartRecruiters: one company's postings in a country (plus its remote ones), then descriptions.
function mapSmartRecruiters(list, slug, { wanted, names }) {
  return list.filter(x => wanted(x.name, [x.location?.fullLocation, x.location?.city, x.location?.remote ? 'remote ' + (x.location?.country || '') : ''])).map(x => ({
    id: `sr:${slug}:${x.id}`, source: 'smartrecruiters', ats: 'smartrecruiters', board: slug, atsId: x.id,
    company: x.company?.name || titleCase(slug, names), title: x.name.trim(),
    location: x.location?.remote ? `Remote (${x.location?.fullLocation || ''})` : x.location?.fullLocation || '',
    url: `https://jobs.smartrecruiters.com/${x.company?.identifier || slug}/${x.id}`, postedAt: x.releasedDate
  }));
}
const srText = d => htmlToText(Object.values(d?.jobAd?.sections || {}).map(s => s?.text || '').join('\n'));
async function smartRecruitersJobs(slug, countryCode) {
  const out = [];
  for (let offset = 0; offset < 500; offset += 100) {
    const j = await getJson(`https://api.smartrecruiters.com/v1/companies/${slug}/postings?limit=100&offset=${offset}${countryCode ? '&country=' + countryCode.toLowerCase() : ''}`);
    if (!j?.content) return offset ? out : null;
    out.push(...j.content);
    if (offset + 100 >= (j.totalFound || 0)) break;
  }
  return out;
}
async function smartrecruiters(slug, ctx) {
  const list = await smartRecruitersJobs(slug, ctx.countryCode);
  if (!list) return isBlocked('https://api.smartrecruiters.com/') || log('smartrecruiters company not found:', slug), [];
  const jobs = mapSmartRecruiters(list, slug, ctx);
  await pool(jobs, 3, async j => {
    const d = await getJson(`https://api.smartrecruiters.com/v1/companies/${slug}/postings/${j.atsId}`);
    j.description = clip(srText(d)); if (d?.postingUrl) j.url = d.postingUrl;
  });
  return jobs;
}

// Recruitee: <slug>.recruitee.com publishes every open job with its description.
function mapRecruitee(j, slug, { wanted, names }) {
  return (j.offers || []).filter(x => wanted(x.title, [x.location, x.city, x.country, x.remote ? 'remote ' + (x.country || '') : ''])).map(x => ({
    id: `recruitee:${slug}:${x.id}`, source: 'recruitee', ats: 'recruitee', board: slug, atsId: String(x.id),
    company: x.company_name || titleCase(slug, names), title: x.title.trim(), location: x.remote ? `Remote (${x.country || ''})` : x.location || x.city || '',
    url: x.careers_url, postedAt: x.published_at && new Date(x.published_at.replace(' UTC', 'Z').replace(' ', 'T')).toISOString(),
    description: clip(htmlToText([x.description, x.requirements].join('\n')))
  }));
}
async function recruitee(slug, ctx) {
  const j = await getJson(`https://${slug}.recruitee.com/api/offers/`);
  if (!j) return log('recruitee board not found:', slug), [];
  return mapRecruitee(j, slug, ctx);
}

// Personio: <slug>.jobs.personio.de/xml (or .com) lists every position with its description.
function parsePersonio(xml) {
  const tag = (b, t) => { const m = b.match(new RegExp(`<${t}>([\\s\\S]*?)</${t}>`)); return m ? decode(m[1].replace(/<!\[CDATA\[|\]\]>/g, '')).trim() : ''; };
  return (String(xml).match(/<position>[\s\S]*?<\/position>/g) || []).map(b => ({
    id: tag(b, 'id'), title: tag(b, 'name'), company: tag(b, 'subcompany'), createdAt: tag(b, 'createdAt'),
    offices: [tag(b, 'office'), ...(tag(b, 'additionalOffices').match(/<office>[^<]*<\/office>/g) || []).map(o => tag(o, 'office'))].filter(Boolean),
    description: (b.match(/<value>[\s\S]*?<\/value>/g) || []).map(v => tag(v, 'value')).join('\n')
  })).filter(p => p.id && p.title);
}
async function personio(slug, { wanted, names }) {
  let xml, host;
  for (host of [`${slug}.jobs.personio.de`, `${slug}.jobs.personio.com`]) if ((xml = await getText(`https://${host}/xml?language=en`))?.includes('<position>')) break;
  if (!xml?.includes('<position>')) return log('personio board not found:', slug), [];
  return parsePersonio(xml).filter(p => wanted(p.title, p.offices)).map(p => ({
    id: `personio:${slug}:${p.id}`, source: 'personio', ats: 'personio', board: slug, atsId: p.id,
    company: names[slug] || p.company.replace(/\s+(SE|GmbH|Ltd|Limited|Inc)\b.*$/, '') || titleCase(slug, names), title: p.title,
    location: p.offices.join(', '), url: `https://${host}/job/${p.id}`, postedAt: p.createdAt || undefined, description: clip(htmlToText(p.description))
  }));
}

module.exports = { greenhouse, ashby, lever, workable, workableJobs, workday, smartrecruiters, smartRecruitersJobs, recruitee, personio,
  mapGreenhouse, mapAshby, mapLever, mapSmartRecruiters, mapRecruitee, parsePersonio, titleCase };
