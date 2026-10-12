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
