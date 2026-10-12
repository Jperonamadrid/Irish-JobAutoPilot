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
