// Career explorer: a short quiz + the CV -> realistic better-paid career options in Ireland, each
// checked against live job postings (how many are open nearby, and the salaries they state).
const { log, pool, writeJson, readJson, request } = require('./util');
const { ask } = require('./llm');
const { plainText } = require('./cvtext');
const { parseSalaries, median } = require('./market');

// Multiple choice keeps it quick; every question is optional.
const QUIZ = [
  { id: 'enjoy', q: 'Which of these do you enjoy most?', multi: true, options: ['Helping people face to face', 'Talking on the phone', 'Working on a computer', 'Organising and keeping things tidy', 'Working with numbers', 'Hands-on or physical work', 'Caring for people', 'Selling or persuading', 'Creative work', 'Driving or being out and about'] },
  { id: 'avoid', q: 'Anything you would rather avoid?', multi: true, options: ['Night shifts', 'Weekends', 'Heavy lifting', 'Selling targets', 'Long hours standing', 'Phone work all day', 'Lots of computer work'] },
  { id: 'hours', q: 'What hours suit you?', options: ['Full time, daytime', 'Full time, shifts are fine', 'Part time', 'Anything'] },
  { id: 'travel', q: 'How do you get to work?', options: ['Public transport', 'Car', 'Bike / walk', 'I can only work from home'] },
  { id: 'study', q: 'Would you do a short course to earn more?', options: ['Yes, a free course of a few months', 'Yes, even a longer one', 'Only training on the job', 'No'] },
  { id: 'pay', q: 'What is your pay goal?', options: ['Just above minimum wage, quickly', 'Around €30,000 a year', 'Around €35,000-40,000 a year', 'As high as possible over time'] },
  { id: 'english', q: 'How comfortable are you with English at work?', options: ['Fully fluent', 'Good, with small mistakes', 'Basic'] },
  { id: 'other', q: 'Anything else? (other languages, licences, things you are good at)', free: true }
];

const S = { type: 'string' }, A = items => ({ type: 'array', items });
const SCHEMA = { type: 'object', required: ['options'], properties: { options: A({ type: 'object',
  required: ['career', 'why', 'salaryEstimate', 'entry', 'firstSteps', 'searchTitles', 'timeToStart'],
  properties: { career: S, why: S, salaryEstimate: S, entry: S, firstSteps: A(S), searchTitles: A(S), timeToStart: S } }) } };

const SYSTEM = `You are a careful careers adviser in Ireland. Suggest 6 to 9 realistic career options for this person that pay more than they earn now, based on their CV and quiz answers.
Mix options they can apply for now with ones needing a short course. Respect what they want to avoid.
For each: why it fits them (refer to their CV or answers), a typical Irish salary range labelled as an estimate (e.g. "about €28,000-32,000 a year (estimate)"), what is needed to get in, 2-4 concrete first steps (free Irish options such as Springboard+, SOLAS/ETB QQI courses or employer training where they genuinely apply; do not invent course names), 3-6 job-board search titles, and how soon they could realistically start ("now", "1-3 months", "3-6 months").
Be honest; do not promise jobs. No em dashes.`;

// Live demand + stated pay for one option, via CareerJet's public API (fast, no browser).
async function pulse(titles, city) {
  let hits = 0; const pays = [];
  await pool(titles.slice(0, 4), 2, async t => {
    const d = await request(`http://public.api.careerjet.net/search?locale_code=en_IE&keywords=${encodeURIComponent(t)}&location=${encodeURIComponent(city)}&pagesize=50&page=1&user_ip=127.0.0.1&user_agent=JobPilot`,
      { headers: { Referer: 'http://localhost/jobpilot' } });
    if (!d) return;
    hits = Math.max(hits, d.hits || 0);
    for (const j of d.jobs || []) pays.push(...parseSalaries(`${j.salary || ''} ${j.description || ''}`));
  });
  return { openJobs: hits, salaryMedian: median(pays), salariesSeen: pays.length };
}

async function explore(user, answers) {
  log('thinking about career options for you…');
  const r = await ask({ model: user.settings.models.answer, system: SYSTEM, schema: SCHEMA, timeout: 300000,
    prompt: `# Person\nLives in ${user.profile.city || user.settings.search.city}, ${user.preset.country}. Current pay: ${user.profile.currentPay || 'about minimum wage'}.\n\n` +
      `# Quiz answers\n${QUIZ.map(q => `${q.q} ${[].concat(answers[q.id] || []).join('; ') || '(no answer)'}`).join('\n')}\n\n# CV\n${plainText(user.cv()) || '(no CV yet)'}` });
  log(`checking ${r.options.length} options against live job postings…`);
  const city = user.profile.city || user.settings.search.city;
  for (const o of r.options) Object.assign(o, await pulse(o.searchTitles, city));
  const out = { at: new Date().toISOString(), answers, options: r.options };
  writeJson(user.p('careers.json'), out);
  log('career options ready');
  return out;
}

module.exports = { QUIZ, explore, pulse, load: user => readJson(user.p('careers.json'), null) };
