const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const { home } = require('./helpers');
const { Store } = require('../core/store');
const { writeJson, readJson } = require('../core/util');

const fresh = name => {
  const file = path.join(home, `${name}.json`);
  writeJson(file, { a: { id: 'a', company: 'A', title: 'Admin', url: 'a', status: 'ready', history: [] } });
  return file;
};

test('a long run does not undo what you did in the app meanwhile', () => {
  const file = fresh('concurrent');
  const run = new Store(file);                      // the daily run loads the list...
  const app = new Store(file);                      // ...then you mark the job applied in the app
  app.update('a', { status: 'submitted', submittedAt: '2026-10-12T10:00:00Z' }, 'changed in the app'); app.save();
  run.update('a', { status: 'ready_to_submit', screenshot: 'shot.png' }, 'prepared');
  run.add({ id: 'b', company: 'B', title: 'Admin', url: 'b' });
  run.save();
  const disk = readJson(file);
  assert.strictEqual(disk.a.status, 'submitted', 'your change wins');
  assert.strictEqual(disk.a.screenshot, 'shot.png', "the run's other fields are kept");
  assert.ok(disk.b, "the run's new job is kept");
  assert.deepStrictEqual(disk.a.history.map(h => h.to), ['submitted'], 'no history entry for the change that lost');
  assert.strictEqual(run.get('a').status, 'submitted', 'the run now sees your change');
});

test('saving keeps job objects the caller holds live, and changes made by assignment count', () => {
  const file = fresh('live');
  const s = new Store(file), held = s.get('a');
  const other = new Store(file); other.update('a', { reason: 'fit' }); other.save();
  held.area = 'Sandyford';
  s.save();
  assert.strictEqual(held.reason, 'fit', 'held object updated in place');
  held.area = 'Dublin 2';
  s.save();
  assert.strictEqual(readJson(file).a.area, 'Dublin 2');
  assert.strictEqual(readJson(file).a.reason, 'fit');
});

test('a field cleared to undefined is removed on save', () => {
  const file = fresh('clear');
  const s = new Store(file); s.update('a', { error: 'boom' }); s.save();
  s.update('a', { error: undefined }); s.save();
  assert.ok(!('error' in readJson(file).a));
});
