#!/usr/bin/env node
// JobPilot command line. The web app runs these same commands in a child process.
//   node cli.js <command> --user <id> [options]
const fs = require('fs');
const path = require('path');
const { log, today } = require('./core/util');
const { User, listUsers, createUser } = require('./core/user');
const { Store } = require('./core/store');

const HELP = `JobPilot
  doctor                       check that everything needed is installed
  users                        list people set up on this computer
  create "<Full Name>"         add a person
  onboard <cv-file>  --user ID read a CV and build the profile
  search             --user ID find new jobs (no AI)
  score              --user ID score new jobs with AI
  find               --user ID search + score
  prepare [--limit N] [ids...] --user ID   tailor CV, write letter, fill forms (never submits)
  run                --user ID find + prepare (the daily run)
  review [ids...]    --user ID open prepared applications so YOU can check and submit them
  login [urls...]    --user ID open this person's browser to sign in to job sites by hand
  locate             --user ID find office areas for the map (jobs scored before areas were recorded)
  status             --user ID job counts
  mark <id> <status> --user ID e.g. mark li:123 submitted (after applying by hand)`;

const args = process.argv.slice(2);
const cmd = args[0];
const opt = f => { const i = args.indexOf(f); return i > -1 ? args[i + 1] : undefined; };
const positional = args.slice(1).filter((a, i, all) => !a.startsWith('--') && !['--user', '--limit'].includes(all[i - 1]));

function userFromArgs() {
  const id = opt('--user') || (listUsers().length === 1 ? listUsers()[0].id : null);
  if (!id) throw new Error('Say which person with --user <id>. Known: ' + (listUsers().map(u => u.id).join(', ') || 'none yet'));
  return new User(id);
}

// Mirror console output into users/<id>/logs/<date>.log.
function teeLog(user) {
  fs.mkdirSync(user.paths.logs, { recursive: true });
  const f = fs.createWriteStream(path.join(user.paths.logs, `${today()}.log`), { flags: 'a' });
  const orig = console.log;
  console.log = (...a) => { orig(...a); f.write(a.join(' ') + '\n'); };
}

(async () => {
  const { cost } = require('./core/llm');
  switch (cmd) {
    case 'doctor': { const r = await require('./core/doctor').doctor(); for (const c of r) console.log(`${c.ok ? 'OK  ' : c.warn ? 'WARN' : 'FAIL'}  ${c.name}: ${c.detail}`); process.exitCode = r.some(c => !c.ok && !c.warn) ? 1 : 0; return; }
    case 'users': for (const u of listUsers()) console.log(`${u.id}\t${u.name}`); return;
    case 'create': { const u = createUser(positional.join(' ')); console.log(`created ${u.id}`); return; }
    case undefined: case 'help': case '--help': console.log(HELP); return;
  }
  const user = userFromArgs();
  teeLog(user);
  const store = () => new Store(user.paths.jobs);
  switch (cmd) {
    case 'onboard': {
      const src = positional[0];
      if (!src || !fs.existsSync(src)) throw new Error('Give the path to a CV file (PDF, DOCX or TXT).');
      const dest = user.p(`source-cv${path.extname(src).toLowerCase()}`);
      if (path.resolve(src) !== dest) fs.copyFileSync(src, dest);
      const r = await require('./core/onboard').onboard(user, dest);
      for (const w of r.warnings) log('check:', w);
      break;
    }
    case 'search': await require('./core/intake').intake(user, store()); break;
    case 'score': await require('./core/score').score(user, store()); break;
    case 'find': { const s = store(); await require('./core/intake').intake(user, s); await require('./core/score').score(user, s); break; }
    case 'prepare': await require('./core/apply').prepare(user, store(), { ids: positional, limit: opt('--limit') && +opt('--limit') }); break;
    case 'run': {
      const s = store();
      await require('./core/intake').intake(user, s);
      await require('./core/score').score(user, s);
      await require('./core/apply').prepare(user, s);
      const c = s.counts();
      log(`done. Prepared and waiting for your review: ${c.ready_to_submit || 0}. Need your answers: ${c.needs_input || 0}. To apply by hand: ${c.manual || 0}.`);
      break;
    }
    case 'locate': await require('./core/score').locateAreas(user, store()); break;
    case 'review': await require('./core/apply').review(user, store(), { ids: positional }); break;
    case 'login': await require('./core/login').login(user, positional); break;
    case 'status': console.table(store().counts()); break;
    case 'mark': {
      const [id, status] = positional, s = store();
      if (!s.get(id)) throw new Error(`No job ${id}`);
      s.update(id, { status, ...(status === 'submitted' ? { submittedAt: new Date().toISOString() } : {}) }, 'marked by hand'); s.save();
      log(`${id} -> ${status}`); break;
    }
    default: console.log(HELP); process.exitCode = 1;
  }
  if (cost() > 0) log(`AI usage this run: about $${cost().toFixed(2)} at API prices`);
})().catch(e => { console.log('ERROR: ' + e.message); process.exitCode = 1; });
