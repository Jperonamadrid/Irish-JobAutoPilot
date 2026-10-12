const test = require('node:test');
const assert = require('node:assert');
const { fixture } = require('./helpers');
const { mapGreenhouse, mapAshby } = require('../core/sources/boards');
const { parseLinkedInCards } = require('../core/sources/feeds');
const { slugGuesses } = require('../core/discover');

const all = { wanted: () => true, names: { notion: 'Notion' } };

test('greenhouse board JSON maps to jobs with embed apply URLs', () => {
  const jobs = mapGreenhouse(JSON.parse(fixture('gh-board.json')), 'intercom', all);
  assert.ok(jobs.length > 5);
  for (const j of jobs) {
    assert.match(j.id, /^gh:intercom:\d+$/);
    assert.match(j.applyUrl, /job-boards\.greenhouse\.io\/embed\/job_app\?for=intercom&token=\d+/);
    assert.ok(j.title && j.company);
  }
});

test('ashby board JSON maps to jobs and respects the filter', () => {
  const d = JSON.parse(fixture('ashby-board.json'));
  const jobs = mapAshby(d, 'notion', all);
  assert.strictEqual(jobs[0].company, 'Notion');
  assert.match(jobs[0].applyUrl, /\/application$/);
  assert.strictEqual(mapAshby(d, 'notion', { ...all, wanted: () => false }).length, 0);
});

test('linkedin guest search cards parse', () => {
  const cards = parseLinkedInCards(fixture('linkedin-cards.html'));
  assert.ok(cards.length >= 5);
  for (const c of cards) { assert.match(c.liId, /^\d+$/); assert.ok(c.title); assert.ok(c.company); }
});

test('board slug guesses', () => {
  assert.deepStrictEqual(slugGuesses('Fruition Group Ireland'), ['fruition']);
  assert.ok(slugGuesses('Security Risk Advisors').includes('securityriskadvisors'));
});

test('publicjobs.ie listing parses into structured rows', () => {
  const { parsePublicJobs } = require('../core/sources/irish');
  const rows = parsePublicJobs(fixture('publicjobs.html'));
  assert.ok(rows.length >= 20);
  for (const r of rows.slice(0, 10)) { assert.match(r.id, /^\d+$/); assert.ok(r.title); assert.match(r.url, /publicjobs\.tal\.net/); }
});

test('jobsireland.ie listing fragment parses', () => {
  const { parseJobsIreland } = require('../core/sources/irish');
  const rows = parseJobsIreland(fixture('jobsireland.html'));
  assert.ok(rows.length >= 1);
  assert.ok(rows[0].id && rows[0].title && rows[0].company);
});

test('a long Retry-After stops further calls to that host for the run', async () => {
  const { request } = require('../core/util');
  let calls = 0;
  global.fetch = async () => { calls++; return { ok: false, status: 429, headers: { get: () => '86400' } }; };
  assert.strictEqual(await request('https://limited.example.com/a'), null);
  assert.strictEqual(await request('https://limited.example.com/b'), null);
  assert.strictEqual(calls, 1, 'second call never reached the network');
});

test('SmartRecruiters, Recruitee and Personio boards map to jobs', () => {
  const { mapSmartRecruiters, mapRecruitee, parsePersonio } = require('../core/sources/boards');
  const sr = mapSmartRecruiters(JSON.parse(fixture('sr-list.json')).content, 'version1', all);
  assert.ok(sr.length >= 5);
  assert.match(sr[0].id, /^sr:version1:\d+$/);
  assert.strictEqual(sr[0].company, 'Version 1');
  assert.match(sr[0].url, /jobs\.smartrecruiters\.com\/Version1\/\d+/);
  const rc = mapRecruitee(JSON.parse(fixture('recruitee.json')), 'bunq', all);
  assert.ok(rc.length >= 3 && rc[0].description.length > 100 && /^\d{4}-\d\d-\d\dT/.test(rc[0].postedAt));
  assert.strictEqual(mapRecruitee(JSON.parse(fixture('recruitee.json')), 'bunq', { ...all, wanted: (t, l) => l.some(x => /dublin/i.test(x || '')) }).length, 0);
  const pe = parsePersonio(fixture('personio.xml'));
  assert.strictEqual(pe[0].title, 'Staff Software Engineer, Data Platform');
  assert.deepStrictEqual(pe[0].offices, ['Munich', 'Berlin']);
  assert.match(pe[0].description, /Dublin or Munich/);
});

test('RecruitIreland search cards and job pages parse', () => {
  const { parseRecruitIreland, recruitIrelandText, agoToDate } = require('../core/sources/irish');
  const rows = parseRecruitIreland(fixture('recruitireland-search.html'));
  assert.ok(rows.length >= 5);
  assert.deepStrictEqual([rows[0].id, rows[0].title, rows[0].company, rows[0].location], ['33515', 'Sales Administrator - County Westmeath', 'ICDS RECRUITMENT', 'Co. Westmeath']);
  assert.match(recruitIrelandText(fixture('recruitireland-job.html')), /• Resolving customer queries/);
  const now = Date.parse('2026-10-12T12:00:00Z');
  assert.strictEqual(agoToDate('5 days ago', now).slice(0, 10), '2026-10-07');
  assert.strictEqual(agoToDate('2 weeks ago', now).slice(0, 10), '2026-09-28');
  assert.strictEqual(agoToDate('3 hours ago', now).slice(0, 10), '2026-10-12');
});

test('Remote OK feed maps to remote jobs and repairs garbled text', () => {
  const { mapRemoteOk } = require('../core/sources/feeds');
  const jobs = mapRemoteOk(JSON.parse(fixture('remoteok.json')), all);
  assert.ok(jobs.length >= 5, 'the legal notice row is skipped');
  assert.ok(jobs.every(j => /^remoteok:/.test(j.id) && /^Remote/.test(j.location) && j.url));
  assert.ok(jobs.some(j => j.location === 'Remote (Ciudad de México, Mexico)'));
});

test('a careers-page link names its job board', () => {
  const { boardFromUrl } = require('../core/discover');
  assert.deepStrictEqual(boardFromUrl('https://boards.greenhouse.io/intercom'), { ats: 'greenhouse', slug: 'intercom' });
  assert.deepStrictEqual(boardFromUrl('job-boards.greenhouse.io/embed/job_app?for=stripe&token=1'), { ats: 'greenhouse', slug: 'stripe' });
  assert.deepStrictEqual(boardFromUrl('https://jobs.lever.co/Kitman/123'), { ats: 'lever', slug: 'kitman' });
  assert.deepStrictEqual(boardFromUrl('https://jobs.smartrecruiters.com/Version1/123-x'), { ats: 'smartrecruiters', slug: 'Version1' });
  assert.deepStrictEqual(boardFromUrl('https://teamwork.jobs.personio.de/'), { ats: 'personio', slug: 'teamwork' });
  assert.deepStrictEqual(boardFromUrl('https://acme.wd3.myworkdayjobs.com/en-US/Careers'), { ats: 'workday', workday: { tenant: 'acme', wd: 'wd3', site: 'Careers' } });
  assert.strictEqual(boardFromUrl('https://example.com/careers'), null);
});

test('the same job worded differently on two sites is one job; different teams are not', () => {
  const { fingerprint } = require('../core/store');
  const same = (a, b, co = 'Acme') => fingerprint(co, a) === fingerprint(co, b);
  assert.ok(same('Sr. Data Analyst (m/f/d)', 'Senior Data Analyst - Dublin'));
  assert.ok(same('Customer Service Rep | Acme', 'Customer Service Representative (Hybrid)'));
  assert.ok(same('Junior Sales & Marketing Exec', 'Junior Sales and Marketing Executive'));
  assert.ok(!same('Software Engineer - Payments', 'Software Engineer - Identity'));
  assert.ok(!same('Data Analyst (Python)', 'Data Analyst (SQL)'));
});
