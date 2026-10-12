// Irish job portals.
//   CareerJet.ie   official public API (aggregates many Irish sites)       plain HTTP
//   publicjobs.ie  public sector (councils, HSE, civil service)             plain HTTP, structured listing
//   JobsIreland.ie the State's employment portal                           inside its own page (it only
//                  answers requests made from its pages)
//   RecruitIreland Irish job board (robots.txt allows all)                  plain HTTP, search page + job page
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

// ---- RecruitIreland.com ---------------------------------------------------------------------------
const RI = 'https://www.recruitireland.com';
// "5 days ago", "3 hours ago", "Today" -> ISO date (approximate, as the site shows it).
function agoToDate(text, now = Date.now()) {
  const t = String(text || '').toLowerCase().trim();
  if (/today|just now|hour|minute/.test(t)) return new Date(now).toISOString();
  if (/yesterday/.test(t)) return new Date(now - 86400000).toISOString();
  const m = t.match(/(\d+)\s*(day|week|month)/);
  return m ? new Date(now - +m[1] * { day: 1, week: 7, month: 30 }[m[2]] * 86400000).toISOString() : undefined;
}
function parseRecruitIreland(html) {
  return html.split('class="rounded bg-2-grey-50 p-5 lg:p-10 space-y-5"').slice(1).map(card => {
    const link = card.match(/href="(https:\/\/www\.recruitireland\.com\/company\/([^/"]+)\/job\/[^"]*?-(\d+))"/);
    const title = card.match(/<h2[^>]*>\s*<a[^>]*>\s*([\s\S]*?)\s*<\/a>/);
    if (!link || !title) return null;
    const span = icon => { const m = card.match(new RegExp(`icon-${icon}[^>]*><\\/i>\\s*<span[^>]*>([^<]*)<`)); return m ? decode(m[1]).trim() : ''; };
    const company = decode((card.match(/<img[^>]*alt="([^"]*)"/) || [])[1] || '') || link[2].replace(/-/g, ' ');
    return { id: link[3], url: link[1], title: decode(title[1]).trim(), company, location: span('location'), workplace: span('building'),
      salary: span('money'), ago: span('calendar'), snippet: decode((card.match(/<p class="line-clamp-2">([\s\S]*?)<\/p>/) || [])[1] || '').trim() };
  }).filter(Boolean);
}
const recruitIrelandText = html => htmlToText((String(html).match(/class="prose prose-base[^"]*">([\s\S]*?)<\/div>/) || [])[1] || '');
async function recruitireland({ titles, wanted, days }) {
  const out = new Map(), cutoff = Date.now() - (days + 1) * 86400000, UA = { 'User-Agent': 'Mozilla/5.0 JobPilot' };
  for (const kw of titles) {
    const html = await getText(`${RI}/search/jobs?query=${encodeURIComponent(kw)}`, { headers: UA });
    if (!html) { log('recruitireland: no response for', kw); continue; }
    for (const r of parseRecruitIreland(html)) {
      const postedAt = agoToDate(r.ago);
      if (postedAt && Date.parse(postedAt) < cutoff) continue;
      const remote = /remote/i.test(r.workplace) ? 'remote ireland' : '';
      if (!wanted(r.title, [r.location, remote, /dublin/i.test(r.title) ? 'Dublin' : ''])) continue;
      out.set(r.id, { id: `recruitireland:${r.id}`, source: 'recruitireland', ats: 'external', company: r.company, title: r.title,
        location: remote ? `${r.location} (remote)` : r.location, url: r.url, postedAt, salaryText: r.salary,
        description: [r.snippet, r.salary && `Salary: ${r.salary}`].filter(Boolean).join('\n') });
    }
    await sleep(500);
  }
  // Full descriptions for the jobs that passed the filters (the search page shows only a snippet).
  await pool([...out.values()], 2, async j => {
    const d = recruitIrelandText(await getText(j.url, { headers: UA }) || '');
    if (d) j.description = clip([d, j.salaryText && `Salary: ${j.salaryText}`].filter(Boolean).join('\n'));
    await sleep(300);
  });
  for (const j of out.values()) delete j.salaryText;
  return [...out.values()];
}

module.exports = { recruitireland, parseRecruitIreland, recruitIrelandText, agoToDate, careerjet, publicjobs, jobsireland, parsePublicJobs, parseJobsIreland };
