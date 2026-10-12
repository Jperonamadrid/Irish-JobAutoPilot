const test = require('node:test');
const assert = require('node:assert');
const { makeUser } = require('./helpers');
const { keywordMatcher } = require('../core/user');

test('keywords match whole words, plurals and squashed phrases', () => {
  const m = keywordMatcher(['administrator', 'service desk', 'iam', 'intern']);
  assert.ok(m('Senior Systems Administrator'));
  assert.ok(m('IT Administrators wanted'));
  assert.ok(m('ServiceDesk Team Lead'));
  assert.ok(m('IAM Engineer'));
  assert.ok(!m('Diamond cutter'), 'iam must not match inside a word');
  assert.ok(!m('Internal Auditor'), 'intern must not match internal');
});

test('user filters: title include/exclude, spoken languages, location and remote scope', () => {
  const u = makeUser();
  assert.ok(u.wanted('Infrastructure Engineer', ['Dublin, Ireland']));
  assert.ok(!u.wanted('Director of Infrastructure', ['Dublin']), 'excluded keyword');
  assert.ok(!u.wanted('Infrastructure Engineer (German speaking)', ['Dublin']), 'unspoken language');
  assert.ok(u.wanted('Infrastructure Engineer', ['Remote - EMEA']), 'remote in Europe allowed');
  assert.ok(!u.wanted('Infrastructure Engineer', ['Remote - US']), 'US-only remote rejected');
  assert.ok(!u.wanted('Infrastructure Engineer', ['London, UK']), 'other city rejected');
  assert.ok(!u.wanted('Chef', ['Dublin']), 'no include keyword');
});

test('remote "none" only accepts the home city/country', () => {
  const u = makeUser('Local Only', { settings: { search: { includeKeywords: ['administrator'], excludeKeywords: [], city: 'Cork', remote: 'none' } } });
  assert.ok(u.wanted('Systems Administrator', ['Cork, Ireland']));
  assert.ok(!u.wanted('Systems Administrator', ['Remote (EMEA)']));
});

test('excluded companies', () => {
  const u = makeUser('Excl', { settings: { search: { includeKeywords: ['administrator'], excludeKeywords: [], excludeCompanies: ['Example Recruiters'] } } });
  assert.ok(u.filters.excludedCompany('Example Recruiters Ltd'));
  assert.ok(!u.filters.excludedCompany('Stripe'));
});
