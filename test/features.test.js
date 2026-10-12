const test = require('node:test');
const assert = require('node:assert');
const { makeUser } = require('./helpers');
const { Store } = require('../core/store');
const { merge } = require('../core/intake');
const llm = require('../core/llm');

test('scoring sees your own recent decisions and reasons', async () => {
  const { score } = require('../core/score');
  const u = makeUser(), s = new Store(u.paths.jobs);
  merge(u, s, [{ id: 'old1', ats: 'external', company: 'A', title: 'Senior Administrator', url: '1' }, { id: 'old2', ats: 'external', company: 'B', title: 'IT Administrator', url: '2' },
    { id: 'new', ats: 'external', company: 'C', title: 'Systems Administrator', url: '3' }]);
  s.update('old1', { status: 'skipped', verdict: { verdict: 'no', reason: 'Too senior', at: '2026-10-01T00:00:00Z' } });
  s.update('old2', { status: 'submitted', verdict: { verdict: 'yes', at: '2026-10-02T00:00:00Z' } });
  let prompt = '';
  llm.setAsk(async o => { prompt = o.prompt; return { results: [{ id: 'new', score: 80, dealbreaker: false, reason: 'fit', area: '' }] }; });
  await score(u, s);
  llm.setAsk(null);
  assert.match(prompt, /Turned down, with their reason:\n- Senior Administrator at A: Too senior/);
  assert.match(prompt, /Wanted \(applied or asked to see\):\n- IT Administrator at B/);
});

test('the daily run starts by itself once a day, after its time, on the chosen days', () => {
  const { isDue, onSave } = require('../core/schedule');
  const st = o => ({ setupDone: true, schedule: { on: true, time: '08:30', days: 'weekdays', lastRun: null, ...o } });
  const mon9 = new Date(2026, 9, 12, 9, 0), mon8 = new Date(2026, 9, 12, 8, 0), sat9 = new Date(2026, 9, 10, 9, 0);
  assert.ok(isDue(st(), mon9));
  assert.ok(!isDue(st(), mon8), 'not before its time');
  assert.ok(!isDue(st(), sat9), 'weekdays only');
  assert.ok(isDue(st({ days: 'daily' }), sat9));
  assert.ok(!isDue(st({ lastRun: '2026-10-12' }), mon9), 'once a day');
  assert.ok(!isDue(st({ on: false }), mon9));
  assert.ok(!isDue({ ...st(), setupDone: false }, mon9), 'not before setup is finished');
  assert.strictEqual(onSave(st(), mon9).lastRun, '2026-10-12', 'switching it on after the time waits until tomorrow');
  assert.strictEqual(onSave(st(), mon8).lastRun, null);
});

test('interview prep is saved on the job, without em dashes', async () => {
  const { prep } = require('../core/prep');
  const u = makeUser(), s = new Store(u.paths.jobs);
  s.add({ id: 'j', company: 'Acme', title: 'Systems Administrator', url: 'j', status: 'submitted', outcome: 'interview', description: 'Run Entra ID.' }); s.save();
  let seen = '';
  llm.setAsk(async o => { seen = o.prompt; return { pitch: 'I run identity — and automation.', questions: [{ q: 'Tell us about Entra ID', why: 'core tool', answer: 'Ran it for 300 users.' }],
    askThem: ['What does success look like?'], prepare: ['Refresh PowerShell'] }; });
  await prep(u, s, 'j');
  llm.setAsk(null);
  assert.match(seen, /Run Entra ID/);
  const p = new Store(u.paths.jobs).get('j').prep;
  assert.strictEqual(p.pitch, 'I run identity, and automation.');
  assert.strictEqual(p.questions[0].answer, 'Ran it for 300 users.');
});
