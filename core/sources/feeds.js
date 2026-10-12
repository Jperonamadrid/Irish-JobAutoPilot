// Search-based sources: LinkedIn (public signed-out search), Workable search, Jobicy and Remote OK
// (remote), Jooble.
// None of these can be auto-filled directly; their jobs go to the manual list unless the
// company's own board is found (see discover.js).
const { log, getJson, getText, postJson, pool, htmlToText, decode, sleep } = require('../util');

const UA = { 'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/153.0 Safari/537.36' };
const clip = (s, n = 6000) => (s || '').slice(0, n);

function parseLinkedInCards(html) {
  return html.split('<li>').slice(1).map(card => {
    const g = re => { const m = card.match(re); return m ? decode(m[1].replace(/<[^>]+>/g, '')).trim() : ''; };
    return { liId: g(/jobPosting:(\d+)/), title: g(/base-search-card__title">([\s\S]*?)<\/h3>/),
      company: g(/base-search-card__subtitle">([\s\S]*?)<\/h4>/), location: g(/job-search-card__location">([\s\S]*?)<\/span>/),
      postedAt: g(/datetime="([^"]+)"/) };
  }).filter(c => c.liId && c.title);
}

async function linkedin({ titles, wanted, location, days, pages = 2 }) {
  const cards = new Map();
  for (const kw of titles) {
    for (let p = 0; p < pages; p++) {
      const url = `https://www.linkedin.com/jobs-guest/jobs/api/seeMoreJobPostings/search?keywords=${encodeURIComponent(kw)}` +
        `&location=${encodeURIComponent(location)}&f_TPR=r${days * 86400}&start=${p * 25}`;
      const html = await getText(url, { headers: UA });
      if (!html) { log('linkedin: no response for', kw); break; }
      const got = parseLinkedInCards(html);
      got.forEach(c => cards.set(c.liId, c));
      if (got.length < 10) break;
      await sleep(800);   // LinkedIn rate-limits bursts
    }
  }
  const keep = [...cards.values()].filter(c => wanted(c.title, [c.location]));
  log(`linkedin: ${cards.size} results, ${keep.length} match your filters`);
  await pool(keep, 3, async c => {
    const html = await getText(`https://www.linkedin.com/jobs-guest/jobs/api/jobPosting/${c.liId}`, { headers: UA });
    const m = html && html.match(/show-more-less-html__markup[^>]*>([\s\S]*?)<\/div>/);
    c.description = clip(htmlToText(m ? m[1] : ''));
    c.easyApply = !!(html && /apply-link-onsite/.test(html));
    await sleep(400);
  });
  return keep.map(c => ({
    id: `li:${c.liId}`, source: 'linkedin', ats: c.easyApply ? 'linkedin-easy' : 'external', company: c.company,
    title: c.title, location: c.location, url: `https://www.linkedin.com/jobs/view/${c.liId}`,
    postedAt: c.postedAt, description: c.description
  }));
}

async function workableSearch({ titles, wanted, country }) {
  const out = new Map();
  await pool(titles, 3, async q => {
    for (const where of [country, 'Europe']) {
      const j = await getJson(`https://jobs.workable.com/api/v1/jobs?query=${encodeURIComponent(q)}&location=${encodeURIComponent(where)}`, { headers: UA });
      for (const x of j?.jobs || []) {
        if (where === 'Europe' && x.workplace !== 'remote') continue;   // outside the country only if remote
        const loc = [x.location?.city, x.location?.countryName, x.workplace === 'remote' ? 'remote ' + (x.location?.countryName || '') : ''].filter(Boolean).join(', ');
        if (!wanted(x.title, [...(x.locations || []), loc])) continue;
        out.set(x.id, { id: `workable:${x.id}`, source: 'workable', ats: 'workable-search', company: x.company?.title || 'Unknown', title: x.title.trim(),
          location: x.workplace === 'remote' ? `Remote (${x.location?.countryName || 'Europe'})` : loc, url: x.url, postedAt: x.created,
          description: clip(htmlToText([x.description, x.requirementsSection].join('\n'))) });
      }
    }
  });
  return [...out.values()];
}

async function jobicy({ wanted, country }) {
  const out = [];
  for (const geo of ['europe', 'emea', country.toLowerCase()]) {
    const j = await getJson(`https://jobicy.com/api/v2/remote-jobs?count=100&geo=${encodeURIComponent(geo)}`, { headers: UA });
    for (const x of j?.jobs || []) {
      const t = decode(x.jobTitle).replace(/\s*\(remote[^)]*\)\s*$/i, '').trim();
      if (!wanted(t, ['remote ' + x.jobGeo])) continue;
      out.push({ id: `jobicy:${x.id}`, source: 'jobicy', ats: 'external', company: decode(x.companyName), title: t,
        location: `Remote (${x.jobGeo})`, url: x.url, postedAt: x.pubDate, description: clip(htmlToText(x.jobDescription)) });
    }
  }
  return out;
}

async function jooble({ key, titles, wanted, location, days }) {
  if (!key) return [];
  const out = [];
  const from = new Date(Date.now() - days * 86400000).toISOString().slice(0, 10);
  for (const kw of titles) {
    const j = await postJson(`https://jooble.org/api/${key}`, { keywords: kw, location, radius: '40', datecreatedfrom: from });
    for (const x of j?.jobs || []) if (wanted(x.title, [x.location])) out.push({
      id: `jooble:${x.id}`, source: 'jooble', ats: 'external', company: x.company || 'Unknown', title: decode(x.title).trim(),
      location: x.location, url: x.link, postedAt: x.updated, description: clip(htmlToText(x.snippet))
    });
  }
  return out;
}

// Remote OK: one public feed of recent remote jobs. Its terms ask for a link back and the source
// named, which every job here has (url + source). Many are restricted to a region; scoring checks.
// Remote OK sends some text UTF-8 encoded twice ("MÃ©xico"); undo that when it shows.
const unmangle = s => /Ã.|Â./.test(s) ? Buffer.from(s, 'latin1').toString('utf8') : s;
function mapRemoteOk(list, { wanted }) {
  return (Array.isArray(list) ? list : []).filter(x => x?.id && x.position)
    .map(x => ({ ...x, position: unmangle(decode(x.position)).trim(), company: unmangle(decode(x.company)), location: unmangle(decode(x.location || '')).trim() }))
    .filter(x => wanted(x.position, ['remote ' + x.location]))
    .map(x => ({ id: `remoteok:${x.id}`, source: 'remoteok', ats: 'external', company: x.company || 'Unknown', title: x.position,
      location: `Remote${x.location ? ` (${x.location})` : ''}`, url: x.url, postedAt: x.date, description: clip(htmlToText(x.description)) }));
}
async function remoteok({ wanted }) {
  return mapRemoteOk(await getJson('https://remoteok.com/api', { headers: UA }), { wanted });
}

module.exports = { linkedin, workableSearch, jobicy, jooble, remoteok, mapRemoteOk, parseLinkedInCards };
