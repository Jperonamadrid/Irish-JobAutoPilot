// Scores new jobs against the person's CV and rules, in batches, with the cheap model.
const { log, pool } = require('./util');
const { ask } = require('./llm');
const { plainText } = require('./cvtext');
const { AUTO_FILL } = require('./intake');

const BATCH = 15;

const SYSTEM = `You screen job postings for one candidate. Score each job 0-100 for how likely the candidate is to get an interview and want the job.
90+: one of their target roles and the core requirements match their experience. 70-89: solid fit, maybe a stretch on one requirement. 50-69: partial fit. Below 50: wrong field or clearly out of reach.
Judge on the actual duties and requirements, not just the title. Follow the candidate's own rules and scoring guidance exactly where they apply (for example, if they say lateral moves or step-downs are fine, do not mark those down).
Missing one named tool the candidate could learn quickly is a small deduction, not a large one. Recruitment agency postings are fine; score the role itself. If the description is empty, score on title and company alone and cap at 75.
Set dealbreaker=true only for the candidate's stated dealbreakers, when the posting requires a language the candidate does not speak, or when a remote role is restricted to countries the candidate cannot work from.
Keep reason under 20 words.`;

const SCHEMA = { type: 'object', required: ['results'], properties: { results: { type: 'array', items: {
  type: 'object', required: ['id', 'score', 'dealbreaker', 'reason'],
  properties: { id: { type: 'string' }, score: { type: 'integer' }, dealbreaker: { type: 'boolean' }, reason: { type: 'string' } } } } } };

function candidateBrief(user) {
  const p = user.profile;
  return [`Name: ${p.fullName}. Based in ${p.city || user.settings.search.city}, ${p.country || user.preset.country}. Languages: ${(p.languages || []).join(', ') || 'English'}.`,
    `Work authorisation: ${p.workAuthorized || 'not stated'}; needs sponsorship: ${p.needsSponsorship || 'not stated'}.`,
    `Target roles: ${user.settings.search.titles.join(', ')}.`,
    `Remote: ${user.settings.search.remote}.`,
    '', '# Candidate rules', user.rules(), '', '# CV', plainText(user.cv())].join('\n');
}

async function score(user, store) {
  const todo = store.where(j => j.status === 'new');
  if (!todo.length) return log('scoring: nothing new to score');
  const brief = candidateBrief(user);
  const { threshold } = user.settings.apply;
  const batches = [];
  for (let i = 0; i < todo.length; i += BATCH) batches.push(todo.slice(i, i + BATCH));
  log(`scoring ${todo.length} jobs in ${batches.length} batch(es)`);
  await pool(batches, 3, async batch => {
    const jobs = batch.map(j => `### id: ${j.id}\n${j.title} | ${j.company} | ${j.location}\n${(j.description || '(no description)').slice(0, 2500)}`).join('\n\n');
    let res;
    try {
      res = await ask({ model: user.settings.models.score, system: SYSTEM, schema: SCHEMA,
        prompt: `# Candidate\n${brief}\n\n# Jobs\n${jobs}\n\nReturn one result per job id.` });
    } catch (e) { return log('a scoring batch failed (will retry next run):', e.message); }
    let good = 0;
    for (const r of res.results) {
      const j = store.get(r.id); if (!j || j.status !== 'new') continue;
      const s = Math.max(0, Math.min(100, r.score | 0));
      const pass = !r.dealbreaker && s >= threshold;
      if (pass) good++;
      store.update(j.id, { score: s, reason: r.reason, dealbreaker: r.dealbreaker, status: !pass ? 'skipped' : AUTO_FILL.has(j.ats) ? 'ready' : 'manual' }, 'scored');
    }
    store.save();
    log(`scored ${batch.length}: ${good} good matches (${store.where(j => j.status === 'new').length} left)`);
  });
}

module.exports = { score, candidateBrief };
