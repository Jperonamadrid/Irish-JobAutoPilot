const test = require('node:test');
const assert = require('node:assert');
const { fixture, fakeFetch } = require('./helpers');

test('greenhouse questions map to typed fields with DOM ids', async () => {
  fakeFetch({ 'boards-api.greenhouse.io': fixture('gh-questions.json') });
  const s = await require('../core/ats/greenhouse').schema({ board: 'stripe', atsId: '8007205' });
  const byKey = Object.fromEntries(s.fields.map(f => [f.key, f]));
  assert.strictEqual(byKey.first_name.role, 'firstName');
  assert.strictEqual(byKey.resume.role, 'resume');
  assert.strictEqual(byKey['candidate-location'].type, 'location');
  assert.ok(s.fields.some(f => f.type === 'select' && f.options.length >= 2));
  assert.ok(s.fields.some(f => f.type === 'multiselect' && f.key.endsWith('[]')));
  assert.ok(!s.fields.some(f => /_text$/.test(f.key)), 'text alternatives to uploads are skipped');
});

test('ashby form maps system fields and yes/no', async () => {
  fakeFetch({ 'jobs.ashbyhq.com/api/non-user-graphql': fixture('ashby-form.json') });
  const s = await require('../core/ats/ashby').schema({ board: 'notion', atsId: 'x' });
  const roles = s.fields.map(f => f.role).filter(Boolean);
  for (const r of ['fullName', 'email', 'resume']) assert.ok(roles.includes(r), r);
});

test('workable form maps fields, skips photo/headline and the gdpr box', async () => {
  fakeFetch({ 'apply.workable.com/api/v1/jobs': fixture('workable-form.json') });
  const s = await require('../core/ats/workable').schema({ atsId: 'X' });
  const keys = s.fields.map(f => f.key);
  for (const k of ['firstname', 'lastname', 'email', 'resume']) assert.ok(keys.includes(k), k);
  for (const k of ['avatar', 'headline', 'gdpr']) assert.ok(!keys.includes(k), k);
});

test('lever apply page maps standard and custom card fields', async () => {
  fakeFetch({ 'jobs.lever.co': fixture('lever-apply.html') });
  const s = await require('../core/ats/lever').schema({ applyUrl: 'https://jobs.lever.co/x/y/apply' });
  const keys = s.fields.map(f => f.key);
  for (const k of ['resume', 'name', 'email']) assert.ok(keys.includes(k), k);
  assert.ok(keys.some(k => /^cards\[/.test(k)), 'custom questions found');
});
