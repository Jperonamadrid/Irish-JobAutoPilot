// IrishJobs.ie and Jobs.ie (both StepStone). They drop plain HTTP clients, so pages load in a real
// browser window (shared, signed-out profile); results come from the page's embedded JSON
// (window.__PRELOADED_STATE__), not from scraping the layout. Applying needs an account on the
// site, so these jobs go to the manual list.
const { log, sleep, htmlToText, slug } = require('../util');

// `page` belongs to the shared search browser opened by intake.js.
async function stepstone(page, { sites, city, titles, wanted, known, days }) {
  if (!sites?.length) return [];
  const cutoff = Date.now() - (days + 1) * 86400000;
  const found = new Map();
  {
    for (const site of sites) {
      let failures = 0;
      for (const kw of titles) {
        try {
          await page.goto(`https://${site}/jobs/${slug(kw)}/in-${slug(city)}?radius=30&sort=2`, { waitUntil: 'domcontentloaded', timeout: 30000 });
          const items = await page.waitForFunction(() => window.__PRELOADED_STATE__?.['app-unifiedResultlist']?.searchResults?.items,
            null, { timeout: 15000 }).then(h => h.jsonValue());
          for (const x of items) {
            if (Date.parse(x.datePosted) < cutoff || !wanted(x.title, [x.location])) continue;
            found.set(`${site}:${x.id}`, { site, x });
          }
        } catch (e) { if (++failures >= 3) { log(`${site}: stopped after repeated failures (${e.message.split('\n')[0].slice(0, 80)})`); break; } }
        await sleep(1200);
      }
    }
    const out = [];
    for (const [, { site, x }] of found) {
      const job = { id: `${site.includes('irishjobs') ? 'irishjobs' : 'jobsie'}:${x.id}`, source: site.replace('www.', ''), ats: 'external',
        company: x.isAnonymous ? 'Anonymous (agency)' : x.companyName, title: x.title.trim(), location: x.location,
        url: `https://${site}${x.url}`, postedAt: x.datePosted, description: x.textSnippet || '' };
      if (!known(job)) {   // full description only for jobs not stored before
        try {
          await page.goto(job.url, { waitUntil: 'domcontentloaded', timeout: 30000 });
          const secs = await page.waitForFunction(() => window.__PRELOADED_STATE__?.JobAdContent?.props?.textSections, null, { timeout: 15000 }).then(h => h.jsonValue());
          job.description = htmlToText(secs.map(s => s.content).join('\n')).slice(0, 6000);
          await sleep(800);
        } catch {}
      }
      out.push(job);
    }
    log(`${sites.map(s => s.replace('www.', '')).join(' / ')}: ${out.length} recent matching jobs`);
    return out;
  }
}

module.exports = { stepstone };
