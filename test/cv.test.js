const test = require('node:test');
const assert = require('node:assert');
require('./helpers');
const { validate } = require('../core/cv');
const { factCheck } = require('../core/onboard');
const master = require('./fixtures/cv.json');
const clone = () => JSON.parse(JSON.stringify(master));

test('tailoring may reorder and reword', () => {
  const t = clone();
  t.experience[0].bullets.reverse();
  t.summary = 'Systems administrator focused on identity, cutting MTTR by 20%.';
  t.skills.reverse();
  assert.strictEqual(validate(master, t), null);
});

test('tailoring may not invent numbers, skills, employers, dates or education', () => {
  let t = clone(); t.experience[0].bullets[0] = 'Ran Entra ID for 500 users.';
  assert.match(validate(master, t), /new numbers: 500/);
  t = clone(); t.skills[0][1] += ', Kubernetes';
  assert.match(validate(master, t), /new skills: kubernetes/);
  t = clone(); t.experience[0].company = 'Acme Global';
  assert.match(validate(master, t), /structure changed/);
  t = clone(); t.experience[1].roles[0].title = 'Senior Support Engineer';
  assert.match(validate(master, t), /structure changed/);
  t = clone(); t.education[0].degree = 'MSc Computing';
  assert.match(validate(master, t), /education changed/);
  t = clone(); t.summary = 'Admin — identity.';
  assert.match(validate(master, t), /em dash/);
});

test('onboarding fact check flags numbers and lines not in the original CV', () => {
  const source = 'Ran Entra ID for 300 users across 4 offices. Cut MTTR by 20% with PowerShell automation.';
  const cv = { experience: [{ bullets: ['Ran Entra ID for 300 users across 4 offices.', 'Managed a budget of 2 million euro for global procurement initiatives.'] }] };
  const w = factCheck(source, cv);
  assert.ok(w.some(x => /"2"/.test(x)), 'invented number flagged');
  assert.ok(w.some(x => /budget/.test(x)), 'invented line flagged');
  assert.ok(!w.some(x => /Entra/.test(x)), 'faithful line not flagged');
});

test('CV intake errors are explained in plain words', async () => {
  const { fileText } = require('../core/pdftext');
  await assert.rejects(fileText('old-cv.doc'), /Save as/);
  await assert.rejects(fileText('cv.pages'), /Save as/);
  const { explain } = require('../core/llm');
  assert.match(explain('Invalid API key · Please run /login'), /not signed in/);
  assert.match(explain('Claude Code on Windows requires git-bash'), /Git for Windows/);
  assert.match(explain('Usage limit reached'), /limit/);
});

test('reworded bullets may not name tools the CV never mentions', () => {
  const job = { title: 'Cloud Engineer', company: 'Stripe' };
  let t = clone(); t.experience[0].bullets[0] = 'Ran Entra ID and Kubernetes for 300 users across 4 offices.';
  assert.match(validate(master, t, job), /not in the CV: Kubernetes/);
  t = clone(); t.experience[1].roles[0].bullets[0] = 'Resolved 40 ServiceNow tickets a day.';
  assert.match(validate(master, t, job), /ServiceNow/);
  t = clone(); t.experience[0].bullets[1] = 'Cut MTTR by 20% using C# tooling.';
  assert.match(validate(master, t, job), /C#/);
  t = clone(); t.experience[0].bullets[2] = 'Led a disaster recovery test across 3 environments, e.g. Azure.';
  assert.match(validate(master, t, job), /Azure/, 'a name right after "e.g." still counts');
  t = clone(); t.experience[0].bullets[0] = 'Administered Entra ID for 300 users across 4 offices; Okta single sign-on.';
  assert.strictEqual(validate(master, t, job), null, 'rewording with known names and a capital after ";" is fine');
  t = clone(); t.summary = 'Systems administrator ready to join Stripe as a Cloud Engineer, cutting MTTR by 20%.';
  assert.strictEqual(validate(master, t, job), null, 'the summary may name the job and company');
  t = clone(); t.experience[0].bullets[0] = 'Ran Entra ID for 300 users across 4 offices at Stripe.';
  assert.match(validate(master, t, job), /Stripe/, 'but bullets may not');
});

test('a filled form reuses the cover letter from the Jobs page', async () => {
  const { earlierAnswers } = require('../core/apply');
  const { resolve } = require('../core/answers');
  const llm = require('../core/llm');
  const u = require('./helpers').makeUser();
  const job = { id: 'x', title: 'Admin', company: 'A', kit: { letter: 'Dear team, the letter you saw.' } };
  let calls = 0;
  llm.setAsk(async () => { calls++; return { answers: [], coverLetter: 'A different letter.' }; });
  const r = await resolve(u, job, [{ key: 'cl', role: 'coverLetter', type: 'text', label: 'Cover letter' }], {}, earlierAnswers(job));
  llm.setAsk(null);
  assert.strictEqual(r.coverLetter, 'Dear team, the letter you saw.');
  assert.strictEqual(calls, 0, 'no second letter is written');
  assert.strictEqual(earlierAnswers({ answers: { coverLetter: 'old' } }).coverLetter, 'old');
});
