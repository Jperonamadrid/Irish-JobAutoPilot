const test = require('node:test');
const assert = require('node:assert');
const { makeUser } = require('./helpers');
const { Store } = require('../core/store');
const { merge } = require('../core/intake');
const { openQuestions, answer } = require('../core/questions');
const { score } = require('../core/score');
const llm = require('../core/llm');

test('a company-board posting replaces a LinkedIn copy of the same job', () => {
  const u = makeUser(), s = new Store(u.paths.jobs);
  merge(u, s, [{ id: 'li:1', ats: 'external', company: 'Acme Ltd', title: 'Systems Administrator', url: 'u1' }]);
  const r = merge(u, s, [{ id: 'gh:acme:2', ats: 'greenhouse', company: 'Acme', title: 'Systems Administrator', url: 'u2' }]);
  assert.strictEqual(r.added, 1);
  assert.strictEqual(s.get('li:1').status, 'duplicate');
  const again = merge(u, s, [{ id: 'li:3', ats: 'external', company: 'Acme', title: 'Systems Administrator', url: 'u3' }]);
  assert.strictEqual(again.added, 0, 'a later LinkedIn copy is not re-added');
});

test('excluded companies never enter the job list', () => {
  const u = makeUser('X', { settings: { search: { includeKeywords: ['administrator'], excludeKeywords: [], excludeCompanies: ['Example Recruiters'] } } });
  const s = new Store(u.paths.jobs);
  assert.strictEqual(merge(u, s, [{ id: 'a', ats: 'external', company: 'Example Recruiters', title: 'Administrator', url: 'x' }]).added, 0);
});

test('scoring sets ready/manual/skipped from score, threshold and dealbreakers', async () => {
  const u = makeUser(), s = new Store(u.paths.jobs);
  merge(u, s, [{ id: 'gh:a:1', ats: 'greenhouse', company: 'A', title: 'Admin 1', url: '1' }, { id: 'li:2', ats: 'external', company: 'B', title: 'Admin 2', url: '2' },
    { id: 'gh:c:3', ats: 'greenhouse', company: 'C', title: 'Admin 3', url: '3' }, { id: 'gh:d:4', ats: 'greenhouse', company: 'D', title: 'Admin 4', url: '4' }]);
  llm.setAsk(async () => ({ results: [{ id: 'gh:a:1', score: 85, dealbreaker: false, reason: 'fit', area: 'Sandyford' }, { id: 'li:2', score: 80, dealbreaker: false, reason: 'fit' },
    { id: 'gh:c:3', score: 60, dealbreaker: false, reason: 'weak' }, { id: 'gh:d:4', score: 95, dealbreaker: true, reason: 'salary' }] }));
  await score(u, s);
  llm.setAsk(null);
  assert.deepStrictEqual(['gh:a:1', 'li:2', 'gh:c:3', 'gh:d:4'].map(id => s.get(id).status), ['ready', 'manual', 'skipped', 'skipped']);
});

test('one answer clears the same question on every waiting job', () => {
  const u = makeUser(), s = new Store(u.paths.jobs);
  merge(u, s, [{ id: 'a', ats: 'greenhouse', company: 'A', title: 'Admin', url: 'a' }, { id: 'b', ats: 'greenhouse', company: 'B', title: 'Admin', url: 'b' }]);
  for (const id of ['a', 'b']) s.update(id, { status: 'needs_input', pending: [{ key: 'q', label: 'Do you hold a clean driving licence?', why: 'not in profile' }] });
  s.update('b', { pending: [...s.get('b').pending, { key: 'q2', label: 'Expected start date?', why: 'not in profile' }] });
  const qs = openQuestions(s);
  assert.strictEqual(qs.length, 2);
  assert.strictEqual(qs[0].jobs.length, 2, 'shared question listed once');
  assert.strictEqual(answer(u, s, 'Do you hold a clean driving licence?', 'Yes'), 1);
  assert.strictEqual(s.get('a').status, 'ready');
  assert.strictEqual(s.get('b').status, 'needs_input', 'still waiting on its other question');
});

test('a broad search scores the most relevant jobs first, up to the cap', async () => {
  const u = makeUser('Cap', { settings: { search: { titles: ['Payroll Specialist'], includeKeywords: ['payroll', 'finance'], excludeKeywords: [] }, apply: { maxScorePerRun: 2 } } });
  const s = new Store(u.paths.jobs);
  merge(u, s, [{ id: 'f', ats: 'external', company: 'A', title: 'Finance Clerk', url: 'f' }, { id: 'p', ats: 'external', company: 'B', title: 'Payroll Specialist', url: 'p' },
    { id: 'q', ats: 'external', company: 'C', title: 'Finance Assistant', url: 'q' }]);
  let seen = [];
  llm.setAsk(async ({ prompt }) => { seen = [...prompt.matchAll(/### id: (\w+)/g)].map(m => m[1]); return { results: seen.map(id => ({ id, score: 50, dealbreaker: false, reason: 'x', area: '' })) }; });
  await score(u, s);
  llm.setAsk(null);
  assert.strictEqual(seen.length, 2);
  assert.ok(seen.includes('p'), 'the exact title match is scored first');
  assert.strictEqual(s.where(j => j.status === 'new').length, 1, 'the rest wait for the next run');
});
