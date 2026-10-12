const test = require('node:test');
const assert = require('node:assert');
const { makeUser } = require('./helpers');
const { matchOption, coerce, template, fromBank, resolve } = require('../core/answers');
const llm = require('../core/llm');
const bank = require('../templates/answers.json');

const yesNo = [{ label: 'Yes', value: '1' }, { label: 'No', value: '0' }];

test('bare Yes/No never lands on a long option', () => {
  const f = { type: 'select', options: [{ label: 'Yes, I intend to work remotely.', value: 'r' }, { label: 'No, I intend to work from an office location.', value: 'o' }] };
  assert.strictEqual(coerce(f, 'Yes'), undefined);
  assert.strictEqual(coerce({ type: 'select', options: yesNo }, 'yes'), '1');
});

test('DECLINE picks the prefer-not option only', () => {
  const opts = [{ label: 'Male', value: 'm' }, { label: 'Female', value: 'f' }, { label: "I don't wish to answer", value: 'd' }];
  assert.strictEqual(matchOption(opts, 'DECLINE').value, 'd');
  assert.strictEqual(matchOption([{ label: 'Male', value: 'm' }], 'DECLINE'), null);
});

test('multiselect keeps only real options', () => {
  const f = { type: 'multiselect', options: [{ label: 'Dublin', value: '1' }, { label: 'Cork', value: '2' }] };
  assert.deepStrictEqual(coerce(f, 'Dublin, Ireland'), ['1']);
  assert.strictEqual(coerce(f, 'Paris'), undefined);
});

test('templates with a missing profile field ask instead of guessing', () => {
  assert.strictEqual(template('{{nationality}}', {}), null);
  assert.strictEqual(template('{{city}}, {{country}}', { city: 'Dublin', country: 'Ireland' }), 'Dublin, Ireland');
  const r = fromBank({ label: 'What is your nationality?', type: 'text' }, bank, {});
  assert.ok(r.ask);
});

test('rule order: preferred name is not a referral, sponsorship beats authorisation', () => {
  const p = { needsSponsorship: 'No', workAuthorized: 'Yes' };
  assert.strictEqual(fromBank({ label: 'Preferred name', type: 'text' }, bank, p), null);
  assert.strictEqual(fromBank({ label: 'Will you require sponsorship for a work permit?', type: 'select' }, bank, p).raw, 'No');
  assert.strictEqual(fromBank({ label: 'Are you legally authorised to work in Ireland?', type: 'select' }, bank, p).raw, 'Yes');
  assert.ok(fromBank({ label: 'I confirm I completed this application without the use of AI', type: 'checkbox' }, bank, p).ask);
  assert.ok(fromBank({ label: 'Agreement to Arbitrate', type: 'select' }, bank, p).ask);
  assert.ok(fromBank({ label: 'Are you subject to a non-compete?', type: 'select' }, bank, p).ask);
});

test('resolve: profile, rules, AI, and pending, with no real model', async () => {
  const u = makeUser();
  let calls = 0;
  llm.setAsk(async ({ prompt }) => {
    calls++;
    assert.ok(prompt.includes('Why do you want'), 'only unanswered questions go to the AI');
    return { answers: [{ key: 'why', value: 'Because the role fits my identity work.', needsUser: false },
      { key: 'clearance', value: '', needsUser: true, why: 'not in profile' }], coverLetter: 'Dear team,\n\nLetter — text.\n\nTest Person' };
  });
  const fields = [
    { key: 'first_name', label: 'First Name', required: true, type: 'text', role: 'firstName' },
    { key: 'resume', label: 'Resume', required: true, type: 'file', role: 'resume' },
    { key: 'sp', label: 'Will you require visa sponsorship?', required: true, type: 'select', options: yesNo },
    { key: 'why', label: 'Why do you want to work here?', required: true, type: 'textarea' },
    { key: 'clearance', label: 'Do you hold security clearance?', required: true, type: 'text' },
    { key: 'gender', label: 'Gender', required: false, type: 'select', options: yesNo },
    { key: 'cl', label: 'Cover letter', required: false, type: 'file', role: 'coverLetter' }
  ];
  const r = await resolve(u, { title: 'Sysadmin', company: 'X', location: 'Dublin', description: '' }, fields, { cv: '/tmp/cv.pdf' });
  llm.setAsk(null);
  assert.strictEqual(calls, 1);
  assert.strictEqual(r.values.first_name, 'Test');
  assert.strictEqual(r.values.resume, '/tmp/cv.pdf');
  assert.strictEqual(r.values.sp, '0');
  assert.match(r.values.why, /identity work/);
  assert.strictEqual(r.values.gender, undefined, 'optional demographic skipped');
  assert.deepStrictEqual(r.pending.map(p => p.key), ['clearance']);
  assert.ok(!r.coverLetter.includes('—'), 'em dash removed');
});

test('resolve reuses earlier AI answers without calling the model', async () => {
  const u = makeUser();
  llm.setAsk(async () => { throw new Error('model must not be called'); });
  const f = [{ key: 'why', label: 'Why us?', required: true, type: 'textarea' }, { key: 'cl', label: 'Cover letter', type: 'file', role: 'coverLetter' }];
  const r = await resolve(u, { title: 't', company: 'c' }, f, {}, { values: { why: 'Saved answer' }, sources: { why: 'llm' }, coverLetter: 'Saved letter', pending: [] });
  llm.setAsk(null);
  assert.strictEqual(r.values.why, 'Saved answer');
  assert.strictEqual(r.coverLetter, 'Saved letter');
});
