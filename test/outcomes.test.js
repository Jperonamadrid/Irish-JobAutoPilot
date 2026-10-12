const test = require('node:test');
const assert = require('node:assert');
const { makeUser } = require('./helpers');
const { Store } = require('../core/store');
const { nudge, stats } = require('../core/outcomes');

const NOW = Date.parse('2026-10-12T12:00:00Z');
const ago = d => new Date(NOW - d * 86400000).toISOString();

test('follow-up after 10 days, suggest "no reply" after 30, nothing once you hear back', () => {
  const j = (days, extra = {}) => ({ status: 'submitted', submittedAt: ago(days), ...extra });
  assert.strictEqual(nudge(j(3), NOW), null);
  assert.deepStrictEqual(nudge(j(12), NOW), { kind: 'follow_up', days: 12 });
  assert.strictEqual(nudge(j(12, { followedUpAt: ago(1) }), NOW), null, 'already followed up');
  assert.strictEqual(nudge(j(40, { followedUpAt: ago(20) }), NOW).kind, 'give_up');
  assert.strictEqual(nudge(j(40, { outcome: 'interview' }), NOW), null);
  assert.strictEqual(nudge({ status: 'ready', submittedAt: ago(40) }, NOW), null, 'not applied');
});

test('results group replies by source, CV version and fit score', () => {
  const u = makeUser(), s = new Store(u.paths.jobs);
  const add = (id, o) => s.add({ id, company: id, title: 'Admin', url: id, status: 'submitted', ...o });
  add('a', { source: 'linkedin', score: 92, submittedAt: ago(5), outcome: 'interview', kit: { tailored: true } });
  add('b', { source: 'linkedin', score: 75, submittedAt: ago(15) });
  add('c', { source: 'greenhouse', score: 85, submittedAt: ago(45), autoSubmitted: true });
  add('d', { source: 'greenhouse', score: 81, submittedAt: ago(20), outcome: 'rejected', cvPdf: 'x.pdf' });
  s.add({ id: 'e', company: 'E', title: 'Admin', url: 'e', status: 'ready' });
  const r = stats(s, NOW);
  assert.deepStrictEqual({ ...r.total }, { applied: 4, responded: 2, interviews: 1, offers: 0, rejected: 1, noReply: 1, responseRate: 50 });
  assert.deepStrictEqual(Object.fromEntries(r.byCv.map(x => [x.label, [x.applied, x.responded]])), { 'Tailored CV': [2, 2], 'Standard CV': [2, 0] });
  assert.deepStrictEqual(Object.fromEntries(r.bySource.map(x => [x.label, x.responded])), { linkedin: 1, greenhouse: 1 });
  assert.deepStrictEqual(Object.fromEntries(r.byScore.map(x => [x.label, x.applied])), { '90+': 1, '70-79': 1, '80-89': 2 });
  assert.deepStrictEqual(r.nudges.map(n => [n.id, n.nudge.kind]), [['c', 'give_up'], ['b', 'follow_up']]);
});
