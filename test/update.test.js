const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const zlib = require('zlib');
require('./helpers');
const up = require('../core/update');

// A GitHub-style .tar.gz: a pax global header, a top folder, and a long path in a pax header.
function tarGz(entries) {
  const blocks = [];
  const header = (name, size, type, mode = '644') => {
    const h = Buffer.alloc(512);
    h.write(name.slice(0, 100), 0); h.write(mode.padStart(7, '0') + '\0', 100); h.write(size.toString(8).padStart(11, '0') + '\0', 124);
    h.write('00000000000\0', 136); h.write(type, 156); h.write('ustar\0', 257); h.write('00', 263);
    h.fill(' ', 148, 156); let sum = 0; for (const b of h) sum += b; h.write(sum.toString(8).padStart(6, '0') + '\0 ', 148);
    return h;
  };
  const push = (name, data, type, mode) => { blocks.push(header(name, data.length, type, mode), data, Buffer.alloc((512 - data.length % 512) % 512)); };
  const paxRec = (k, v) => { let len = k.length + v.length + 3; len += String(len).length; if (String(len).length !== String(len - String(len).length).length) len++; return `${len} ${k}=${v}\n`; };
  push('pax_global_header', Buffer.from(paxRec('comment', 'abc123')), 'g');
  for (const [name, text, mode] of entries) {
    if (name.length > 100) push('PaxHeaders/x', Buffer.from(paxRec('path', name)), 'x');
    push(name, Buffer.from(text), '0', mode);
  }
  blocks.push(Buffer.alloc(1024));
  return zlib.gzipSync(Buffer.concat(blocks));
}

test('versions compare as numbers, and the changelog lists what is new since yours', () => {
  assert.strictEqual(up.compare('0.10.0', '0.9.9'), 1);
  assert.strictEqual(up.compare('1.2.0', '1.2'), 0);
  assert.strictEqual(up.compare('0.2.0', '0.3.0'), -1);
  const log = up.parseChangelog('# t\n\n## 0.3.0 (2026-11-01)\n- C\n- D\n\n## 0.2.0\n- B\n\n## 0.1.0\n- A\n');
  assert.deepStrictEqual(up.notesSince(log, '0.1.0').map(e => [e.version, e.items]), [['0.3.0', ['C', 'D']], ['0.2.0', ['B']]]);
  assert.strictEqual(log[0].date, '2026-11-01');
});

test('every release has its changelog entry and points at the repository', () => {
  const entries = up.parseChangelog(fs.readFileSync(path.join(__dirname, '..', 'CHANGELOG.md'), 'utf8'));
  assert.strictEqual(entries[0].version, up.VERSION, 'the newest CHANGELOG.md section must match package.json "version"');
  assert.ok(entries[0].items.length, 'say what changed');
  assert.deepStrictEqual(up.repo(), { owner: 'Jperonamadrid', name: 'Irish-JobAutoPilot', branch: 'main' });
});

test('the update check reads the version and notes from GitHub', async () => {
  const seen = [];
  const fetchImpl = async url => { seen.push(url); return { ok: true,
    json: async () => ({ version: '9.0.0' }), text: async () => '## 9.0.0 (2027-01-01)\n- Big change\n\n## ' + up.VERSION + '\n- Old\n' }; };
  const r = await up.check({ fetchImpl });
  assert.deepStrictEqual([r.current, r.latest, r.newer], [up.VERSION, '9.0.0', true]);
  assert.deepStrictEqual(r.notes.map(n => n.items), [['Big change']]);
  assert.ok(seen.every(u => u.startsWith('https://raw.githubusercontent.com/Jperonamadrid/Irish-JobAutoPilot/main/')));
  const same = await up.check({ fetchImpl: async () => ({ ok: true, json: async () => ({ version: up.VERSION }) }) });
  assert.strictEqual(same.newer, false);
});

test('GitHub archives unpack without their top folder, long paths included, and never into your data', () => {
  const long = 'repo-main/' + 'deep/'.repeat(22) + 'file.txt';
  const files = up.archiveFiles(tarGz([['repo-main/package.json', '{}'], ['repo-main/start.sh', '#!/bin/sh', '755'], [long, 'x'],
    ['repo-main/users/me/cv.json', 'NOT YOURS'], ['repo-main/data/boards.json', 'no'], ['repo-main/../evil', 'no']]));
  assert.deepStrictEqual(files.map(f => f.path).sort(), ['deep/'.repeat(22) + 'file.txt', 'package.json', 'start.sh'].sort());
  assert.strictEqual(files.find(f => f.path === 'start.sh').mode, 0o755);
});

test('installing a downloaded update replaces the app files and keeps your data', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'jp-update-'));
  const write = (f, t) => { fs.mkdirSync(path.dirname(path.join(root, f)), { recursive: true }); fs.writeFileSync(path.join(root, f), t); };
  const pkg = v => JSON.stringify({ name: 'jobpilot', version: v, repository: 'github:Jperonamadrid/Irish-JobAutoPilot', dependencies: { a: '1' } });
  write('package.json', pkg('0.1.0')); write('package-lock.json', 'lock'); write('server/index.js', 'old'); write('users/me/cv.json', 'MY CV'); write('core/mine.js', 'kept');
  const tgz = tarGz([['r-main/package.json', pkg('0.9.0')], ['r-main/package-lock.json', 'lock'], ['r-main/server/index.js', 'new'], ['r-main/cli.js', 'cli'],
    ['r-main/web/app.js', 'web'], ['r-main/users/me/cv.json', 'OVERWRITTEN']]);
  let url;
  const r = await up.install({ root, git: false, say: () => {}, fetchImpl: async u => { url = u; return { ok: true, arrayBuffer: async () => tgz } } });
  assert.strictEqual(url, 'https://codeload.github.com/Jperonamadrid/Irish-JobAutoPilot/tar.gz/refs/heads/main');
  assert.deepStrictEqual(r, { method: 'download', version: '0.9.0' });
  assert.strictEqual(fs.readFileSync(path.join(root, 'server/index.js'), 'utf8'), 'new');
  assert.strictEqual(fs.readFileSync(path.join(root, 'users/me/cv.json'), 'utf8'), 'MY CV', 'your data is never touched');
  assert.strictEqual(fs.readFileSync(path.join(root, 'core/mine.js'), 'utf8'), 'kept');
  assert.ok(!fs.readdirSync(path.join(root, 'server')).some(f => f.endsWith('.updating')));
});

test('an incomplete download changes nothing', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'jp-update-'));
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ version: '0.1.0', repository: 'github:a/b' }));
  const tgz = tarGz([['r/package.json', '{"version":"0.2.0"}'], ['r/README.md', 'half']]);
  await assert.rejects(up.install({ root, git: false, say: () => {}, fetchImpl: async () => ({ ok: true, arrayBuffer: async () => tgz }) }), /incomplete/);
  assert.ok(!fs.existsSync(path.join(root, 'README.md')));
  assert.match(fs.readFileSync(path.join(root, 'package.json'), 'utf8'), /0\.1\.0/);
});

test('dependencies are reinstalled only when they change', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'jp-update-'));
  const before = { 'package.json': JSON.stringify({ version: '1.0.0', dependencies: { a: '1' } }), 'package-lock.json': 'L' };
  fs.writeFileSync(path.join(root, 'package-lock.json'), 'L');
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ version: '1.1.0', dependencies: { a: '1' } }));
  assert.strictEqual(up.changed(root, before), false, 'a new version number alone needs no install');
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ version: '1.1.0', dependencies: { a: '2' } }));
  assert.strictEqual(up.changed(root, before), true);
});
