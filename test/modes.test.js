const test = require('node:test');
const assert = require('node:assert');
const { makeUser } = require('./helpers');
const { Store } = require('../core/store');
const { canAutoSubmit } = require('../core/apply');
const { parseSalaries, matchesTitle, compute } = require('../core/market');
const { cvChanges } = require('../core/kit');
const { refineKeywords } = require('../core/onboard');
const llm = require('../core/llm');

const autoUser = (auto = {}) => makeUser('Auto', { settings: { mode: 'auto', auto: { consentAt: '2026-10-12T10:00:00Z', minScore: 80, dailyLimit: 2, ...auto },
  search: { includeKeywords: ['payroll'], excludeKeywords: [] } } });

test('auto-apply needs auto mode, the person\'s consent, a high score, no open questions and room in the daily limit', () => {
  const u = autoUser(), s = new Store(u.paths.jobs), job = { score: 85 };
  assert.ok(canAutoSubmit(u, s, job, []).ok);
  assert.match(canAutoSubmit(makeUser('Help'), s, job, []).why, /help me apply/);
  assert.match(canAutoSubmit(autoUser({ consentAt: null }), s, job, []).why, /not been switched on/);
  assert.match(canAutoSubmit(u, s, { score: 79 }, []).why, /below/);
  assert.match(canAutoSubmit(u, s, job, [{ key: 'q', label: 'Clearance?' }]).why, /questions/);
  const today = new Date().toISOString();
  s.add({ id: 'a', company: 'A', title: 'x', url: 'a', autoSubmitted: true, submittedAt: today });
  s.add({ id: 'b', company: 'B', title: 'y', url: 'b', autoSubmitted: true, submittedAt: today });
  assert.match(canAutoSubmit(u, s, job, []).why, /limit/);
});

test('salaries are read only from what postings state', () => {
  assert.deepStrictEqual(parseSalaries('Salary €30,000 - €35,000 per annum'), [30000, 35000]);
  assert.deepStrictEqual(parseSalaries('€32k DOE'), [32000]);
  assert.deepStrictEqual(parseSalaries('€15.50 per hour'), [Math.round(15.5 * 39 * 52)]);
  assert.deepStrictEqual(parseSalaries('Competitive salary and pension'), []);
  assert.deepStrictEqual(parseSalaries('€500 sign-on bonus'), [], 'small amounts are not salaries');
});

test('jobs are counted under a search title by its meaningful words', () => {
  assert.ok(matchesTitle('Senior Payroll Specialist (FTC)', 'Payroll Specialist'));
  assert.ok(!matchesTitle('Payroll Manager', 'Payroll Specialist'));
});

test('market numbers', () => {
  const u = makeUser('M', { settings: { search: { titles: ['Payroll Specialist'], includeKeywords: ['payroll'], excludeKeywords: [] } } });
  const s = new Store(u.paths.jobs);
  s.add({ id: '1', company: 'A', title: 'Payroll Specialist', url: '1', score: 85, status: 'ready', description: 'Salary €34,000' });
  s.add({ id: '2', company: 'A', title: 'Payroll Specialist', url: '2', score: 50, status: 'skipped', description: '' });
  s.add({ id: '3', company: 'B', title: 'Chef', url: '3', score: 10, status: 'skipped', location: 'Remote' });
  const m = compute(u, s);
  assert.strictEqual(m.total, 3);
  assert.deepStrictEqual([m.byTitle[0].jobs, m.byTitle[0].goodFits, m.byTitle[0].salaryMedian], [2, 1, 34000]);
  assert.strictEqual(m.topCompanies[0][0], 'A');
  assert.strictEqual(m.recommended.length, 1);
});

test('the person sees what tailoring changed', () => {
  const master = require('./fixtures/cv.json');
  const t = JSON.parse(JSON.stringify(master));
  t.summary = 'Different summary.'; t.skills.reverse(); t.experience[0].bullets = [master.experience[0].bullets[2], master.experience[0].bullets[0]];
  const c = cvChanges(master, t).join('\n');
  assert.match(c, /Summary rewritten/);
  assert.match(c, /Skills reordered/);
  assert.match(c, /Acme: most relevant points moved to the top, 1 less relevant cut/);
  assert.match(cvChanges(master, null)[0], /standard CV/);
});

test('changing titles rebuilds keywords; chosen titles can never be excluded', async () => {
  const u = makeUser('K');
  llm.setAsk(async () => ({ includeKeywords: ['retail'], excludeKeywords: ['assistant', 'director'] }));
  const r = await refineKeywords(u, ['Retail Assistant', 'Shop Supervisor']);
  llm.setAsk(null);
  assert.ok(r.include.includes('retail assistant') && r.include.includes('shop supervisor'));
  assert.ok(!r.exclude.includes('assistant'), 'a word from a chosen title is never excluded');
  assert.ok(r.exclude.includes('director'));
  assert.ok(u.wanted('Retail Assistant', ['Dublin']));
});
