// Stand-in for server/index.js in the launcher test (CI): the first start asks for a restart
// (exit 75, as after an update), the second exits normally. Each start is recorded. With
// LAUNCHER_FILE set, the first start also changes that launcher file the way an update would,
// adding a line that must never run (the launcher has to cope with being replaced mid-run).
const fs = require('fs');
const file = process.env.LAUNCH_LOG;
const n = (fs.existsSync(file) ? fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).length : 0) + 1;
fs.appendFileSync(file, `start ${n}\n`);
if (n === 1 && process.env.LAUNCHER_FILE) {
  const eol = /\.(bat|cmd)$/i.test(process.env.LAUNCHER_FILE) ? '\r\n' : '\n';
  const junk = /\.(bat|cmd)$/i.test(process.env.LAUNCHER_FILE) ? 'echo UPDATE-BROKE-THE-LAUNCHER' : 'echo UPDATE-BROKE-THE-LAUNCHER';
  const old = fs.readFileSync(process.env.LAUNCHER_FILE, 'utf8');
  fs.writeFileSync(process.env.LAUNCHER_FILE, `${'rem padding '.repeat(20)}${eol}${old}${eol}${junk}${eol}`.replace(/^rem/, /\.sh$/.test(process.env.LAUNCHER_FILE) ? '#' : 'rem'));
}
process.exit(n === 1 ? 75 : 0);
