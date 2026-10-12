// Irish job portals.
//   CareerJet.ie   official public API (aggregates many Irish sites)       plain HTTP
//   publicjobs.ie  public sector (councils, HSE, civil service)             plain HTTP, structured listing
//   JobsIreland.ie the State's employment portal                           inside its own page (it only
//                  answers requests made from its pages)
// Not included: Indeed and Glassdoor show "verify you are human" challenges to automated
// browsers, and this app does not try to get around those.
const { log, getText, request, pool, decode, htmlToText, sleep } = require('../util');

const clip = (s, n = 6000) => (s || '').slice(0, n);

// ---- CareerJet -----------------------------------------------------------------------------------
async function careerjet({ titles, wanted, city, days }) {
  const out = new Map();
  const cutoff = Date.now() - (days + 1) * 86400000;
  await pool(titles, 3, async kw => {
    const url = `http://public.api.careerjet.net/search?locale_code=en_IE&keywords=${encodeURIComponent(kw)}&location=${encodeURIComponent(city)}` +
      `&sort=date&pagesize=50&page=1&user_ip=127.0.0.1&user_agent=${encodeURIComponent('JobPilot')}`;
    // The API requires a Referer naming the calling page.
    const d = await request(url, { headers: { Referer: 'http://localhost/jobpilot' } });
    for (const x of d?.jobs || []) {
      const posted = Date.parse(x.date);
      if (posted && posted < cutoff) continue;
      if (!wanted(x.title, [x.locations])) continue;
      const id = `careerjet:${Buffer.from(x.url).toString('base64url').slice(-24)}`;
      out.set(id, { id, source: 'careerjet', ats: 'external', company: decode(x.company) || 'Unknown', title: decode(x.title).trim(),
        location: x.locations, url: x.url, postedAt: posted ? new Date(posted).toISOString() : undefined, description: clip(htmlToText(x.description)) });
    }
  });
  return [...out.values()];
}

// ---- publicjobs.ie -----------------------------------------------------------------------------------
const PJ_BOARD = 'https://publicjobs.tal.net/vx/lang-en-GB/mobile-0/appcentre-ext/brand-4/xf-423dd989250d/candidate/jobboard/vacancy/3/adv/';
function parsePublicJobs(html) {
  const field = (block, n) => { const m = block.match(new RegExp(`candidate-opp-field-${n}"><span[^>]*>[^<]*</span>([^<]*)<`)); return m ? decode(m[1]).trim() : ''; };
  return html.split('class="col-md-6 opp-container"').slice(1).map(b => {
    const link = b.match(/<a class="subject" href="([^"]+)">\s*([\s\S]*?)\s*<\/a>/);
    if (!link) return null;
    return { id: (b.match(/data-oppid="(\d+)"/) || [])[1], url: decode(link[1]), title: decode(link[2]).trim(),
      organisation: field(b, 5), location: field(b, 6), advertised: field(b, 7), closing: field(b, 8) };
  }).filter(x => x && x.id);
}
async function publicjobs({ wanted, days }) {
  const out = [];
  const cutoff = Date.now() - Math.max(days, 7) * 86400000;   // few new posts a day; look back a week
  for (let start = 0; start < 600; start += 50) {
    const html = await getText(`${PJ_BOARD}?start=${start}`, { headers: { 'User-Agent': 'Mozilla/5.0 JobPilot' } });
    if (!html) break;
    const rows = parsePublicJobs(html);
    for (const r of rows) {
      const posted = Date.parse(r.advertised);
      if (posted && posted < cutoff) continue;
      // Location is often the organisation ("Kerry County Council"); national bodies give none.
      const loc = r.location || r.organisation || 'Ireland';
      if (!wanted(r.title.replace(/ - [^-]+$/, ''), [loc, /dublin/i.test(r.title) ? 'Dublin' : ''])) continue;
      out.push({ id: `publicjobs:${r.id}`, source: 'publicjobs.ie', ats: 'external', company: r.organisation || 'Public sector',
        title: r.title, location: loc, url: r.url, postedAt: posted ? new Date(posted).toISOString() : undefined,
        description: `${r.title}. Organisation: ${r.organisation}. Location: ${loc}. Closing date: ${r.closing}.` });
    }
    if (rows.length < 50) break;
    await sleep(500);
  }
  return out;
}

// ---- JobsIreland.ie (needs a page of its own site) ---------------------------------------------------------
function parseJobsIreland(html) {
  return html.split('class="job-heading position-box"').slice(1).map(b => {
    const v = id => decode((b.match(new RegExp(`id="${id}" value="([^"]*)"`)) || [])[1] || '').trim();
    return { id: v('JobId'), title: v('JobTitle'), location: v('Location').replace(/,\s*$/, ''), start: v('StartDate'),
      company: decode((b.match(/alt="Logo of ([^"]+)"/) || [])[1] || '').trim(), paid: /position-paid/.test(b) };
  }).filter(x => x.id && x.title);
}
async function jobsireland(page, { titles, wanted, city, days }) {
  await page.goto('https://jobsireland.ie/en-US/browse-jobs', { waitUntil: 'domcontentloaded', timeout: 30000 });
  const cutoff = Date.now() - (days + 1) * 86400000;
  const out = new Map();
  for (const kw of titles) {
    const html = await page.evaluate(async ([kw, city]) => {
      const r = await fetch(`/Jobsireland.API/JobsIreland/BrowseJobs/43?CareerlevelId=-1&keyWord=${encodeURIComponent(kw)}&location=${encodeURIComponent(city)}&page=1&pageSize=50&VacancyTypeId=-1&RemoteOrBlended=-1`);
      return r.ok ? r.text() : '';
    }, [kw, city]).catch(() => '');
    for (const x of parseJobsIreland(html)) {
      if (!x.paid || (Date.parse(x.start) && Date.parse(x.start) < cutoff) || !wanted(x.title, [x.location, `${x.location}, Ireland`])) continue;
      out.set(x.id, { id: `jobsireland:${x.id}`, source: 'jobsireland.ie', ats: 'external', company: x.company || 'Unknown', title: x.title,
        location: x.location, url: `https://jobsireland.ie/en-US/job-Details?id=${x.id}`, postedAt: x.start ? new Date(x.start).toISOString() : undefined, description: '' });
    }
    await sleep(600);
  }
  // Descriptions for the matches (job page text).
  for (const j of out.values()) {
    try {
      await page.goto(j.url, { waitUntil: 'domcontentloaded', timeout: 30000 });
      j.description = clip((await page.locator('main, #content, body').first().innerText()).replace(/\s+\n/g, '\n'));
    } catch {}
  }
  log(`jobsireland.ie: ${out.size} recent matching jobs`);
  return [...out.values()];
}

module.exports = { careerjet, publicjobs, jobsireland, parsePublicJobs, parseJobsIreland };
