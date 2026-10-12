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
  update [--install]           is there a newer JobPilot? --install installs it (your data is kept)
  users                        list people set up on this computer
  create "<Full Name>"         add a person
  onboard <cv-file>  --user ID read a CV and build the profile
  search             --user ID find new jobs (no AI)
  score              --user ID score new jobs with AI
  find               --user ID search + score
  prepare [--limit N] [ids...] --user ID   fill forms (submits only in auto-apply mode, within its limits)
  run                --user ID daily run: find, score, CV + letter packs, (auto mode) submit, market report
  scan               --user ID first market scan (last 14 days), then the same as run
  kits [ids...]      --user ID tailored CV + cover letter for recommended jobs
  market             --user ID rebuild the market report
  careers <answers.json> --user ID career explorer from quiz answers
  keywords           --user ID rebuild search keywords from the job titles
  review [ids...]    --user ID open prepared applications so YOU can check and submit them
  login [urls...]    --user ID open this person's browser to sign in to job sites by hand
  locate             --user ID find office areas for the map (jobs scored before areas were recorded)
  status             --user ID job counts
  mark <id> <status> --user ID e.g. mark li:123 submitted --cv tailored (after applying by hand; --cv tailored | standard)
                               or mark li:123 skipped --reason "too senior" (scoring learns from it)
  mark <id> <outcome> --user ID after applying: replied | interview | offer | rejected | no_reply | waiting
  results            --user ID replies, interviews and follow-ups due
  prep <id>          --user ID interview prep notes for a job you have an interview for`;

const args = process.argv.slice(2);
const cmd = args[0];
const opt = f => { const i = args.indexOf(f); return i > -1 ? args[i + 1] : undefined; };
const positional = args.slice(1).filter((a, i, all) => !a.startsWith('--') && !['--user', '--limit', '--cv', '--reason'].includes(all[i - 1]));

function userFromArgs() {
  const id = opt('--user') || (listUsers().length === 1 ? listUsers()[0].id : null);
  if (!id) throw new Error('Say which person with --user <id>. Known: ' + (listUsers().map(u => u.id).join(', ') || 'none yet'));
  return new User(id);
}

// Mirror console output into users/<id>/logs/<date>.log. Written synchronously: the process exits
// as soon as a command finishes, which would cut off a buffered stream's last lines (or all of them).
function teeLog(user) {
  fs.mkdirSync(user.paths.logs, { recursive: true });
  const file = path.join(user.paths.logs, `${today()}.log`);
  const orig = console.log;
  console.log = (...a) => { orig(...a); try { fs.appendFileSync(file, a.join(' ') + '\n'); } catch {} };
}

(async () => {
  const { cost } = require('./core/llm');
  switch (cmd) {
    case 'doctor': { const r = await require('./core/doctor').doctor(); for (const c of r) console.log(`${c.ok ? 'OK  ' : c.warn ? 'WARN' : 'FAIL'}  ${c.name}: ${c.detail}`); process.exitCode = r.some(c => !c.ok && !c.warn) ? 1 : 0; return; }
    case 'update': {
      const up = require('./core/update'), r = await up.check();
      console.log(r.newer ? `JobPilot ${r.latest} is available (you have ${r.current}).` : `You have the latest JobPilot (${r.current}).`);
      for (const n of r.notes) { console.log(`\n${n.version}${n.date ? ` (${n.date})` : ''}`); n.items.forEach(i => console.log('  - ' + i)); }
      if (r.newer && args.includes('--install')) { await up.install({ say: m => console.log(m) }); console.log('Done. Start JobPilot again to use the new version.'); }
      else if (r.newer) console.log('\nTo install it: node cli.js update --install   (or press Update in the app)');
      return;
    }
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
    case 'run': case 'scan': {
      // run = daily run. scan = first market scan (looks back 14 days instead of a few).
      const s = store();
      await require('./core/intake').intake(user, s, cmd === 'scan' ? { days: 14 } : {});
      await require('./core/score').score(user, s);
      await require('./core/kit').makeKits(user, s);
      if (user.settings.mode === 'auto') await require('./core/apply').prepare(user, s);
      await require('./core/market').report(user, s);
      const c = s.counts(), autoToday = s.where(j => j.autoSubmitted && (j.submittedAt || '').slice(0, 10) === new Date().toISOString().slice(0, 10)).length;
      log(`done. Recommended for you: ${(c.ready || 0) + (c.manual || 0)}.` + (user.settings.mode === 'auto'
        ? ` Submitted automatically today: ${autoToday}. Need your answers: ${c.needs_input || 0}.` : ' Each has a tailored CV and cover letter ready.'));
      break;
    }
    case 'kits': await require('./core/kit').makeKits(user, store(), { ids: positional }); break;
    case 'market': await require('./core/market').report(user, store()); break;
    case 'careers': {
      const answers = positional[0] ? JSON.parse(fs.readFileSync(positional[0], 'utf8')) : {};
      await require('./core/careers').explore(user, answers);
      break;
    }
    case 'keywords': await require('./core/onboard').refineKeywords(user, user.settings.search.titles); log('search keywords updated from your titles'); break;
    case 'locate': await require('./core/score').locateAreas(user, store()); break;
    case 'review': await require('./core/apply').review(user, store(), { ids: positional }); break;
    case 'login': await require('./core/login').login(user, positional); break;
    case 'status': console.table(store().counts()); break;
    case 'prep': if (!positional[0]) throw new Error('Say which job: prep <id>'); await require('./core/prep').prep(user, store(), positional[0]); break;
    case 'results': {
      const r = require('./core/outcomes').stats(store()), t = r.total;
      log(`applied ${t.applied}: heard back ${t.responded} (${t.responseRate}%), interviews ${t.interviews}, offers ${t.offers}, no reply ${t.noReply}`);
      for (const [name, rows] of [['by source', r.bySource], ['by CV', r.byCv], ['by fit score', r.byScore]])
        log(name + ': ' + rows.map(x => `${x.label} ${x.responded}/${x.applied}`).join(', '));
      for (const n of r.nudges) log(`${n.nudge.kind === 'follow_up' ? 'follow up' : 'no reply?'}  ${n.nudge.days}d  ${n.company} | ${n.title}  (${n.id})`);
      break;
    }
    case 'mark': {
      const [id, status] = positional, s = store();
      if (!s.get(id)) throw new Error(`No job ${id}`);
      if (require('./core/outcomes').OUTCOMES[status]) {
        if (s.get(id).status !== 'submitted') throw new Error(`Mark ${id} as submitted first`);
        s.update(id, { outcome: status, outcomeAt: new Date().toISOString() }, 'marked by hand'); s.save();
        log(`${id} outcome -> ${status}`); break;
      }
      const cv = opt('--cv');
      if (cv && !['tailored', 'standard'].includes(cv)) throw new Error('--cv must be tailored or standard');
      const at = new Date().toISOString();
      const verdict = status === 'skipped' ? { verdict: 'no', reason: opt('--reason') || '', at } : status === 'submitted' ? { verdict: 'yes', at } : undefined;
      s.update(id, { status, ...(verdict ? { verdict } : {}), ...(status === 'submitted' ? { submittedAt: at, ...(cv ? { cvUsed: cv } : {}) } : {}) }, 'marked by hand'); s.save();
      log(`${id} -> ${status}`); break;
    }
    default: console.log(HELP); process.exitCode = 1;
  }
  if (cost() > 0) log(`AI usage this run: about $${cost().toFixed(2)} at API prices`);
})().catch(e => { console.log('ERROR: ' + e.message); process.exitCode = 1; })
  // Always finish: close the background PDF engine and exit, so the app never waits on a task forever.
  .finally(async () => { await require('./core/browser').closePdf().catch(() => {}); process.exit(process.exitCode || 0); });
