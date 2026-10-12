// Test helpers: an isolated data folder per test file, a throwaway user, and a fake fetch that
// serves saved responses from test/fixtures so no test touches the network or the real model.
const fs = require('fs');
const os = require('os');
const path = require('path');

const home = fs.mkdtempSync(path.join(os.tmpdir(), 'jobpilot-test-'));
process.env.JOBPILOT_HOME = home;
// Temporary folders made by a test file are removed when it finishes.
const temps = [home];
const tempDir = prefix => { const d = fs.mkdtempSync(path.join(os.tmpdir(), prefix)); temps.push(d); return d; };
process.on('exit', () => { for (const d of temps) fs.rmSync(d, { recursive: true, force: true }); });
const fixture = name => fs.readFileSync(path.join(__dirname, 'fixtures', name), 'utf8');

function makeUser(name = 'Test Person', { settings = {}, profile = {}, cv } = {}) {
  const { createUser, User } = require('../core/user');
  const { writeJson } = require('../core/util');
  const u = createUser(name + ' ' + Math.random().toString(36).slice(2, 7));
  writeJson(u.paths.settings, { search: { includeKeywords: ['administrator', 'infrastructure', 'service desk'], excludeKeywords: ['director', 'software engineer'], city: 'Dublin', remote: 'europe', titles: ['Systems Administrator'] }, ...settings });
  writeJson(u.paths.profile, { fullName: 'Test Person', firstName: 'Test', lastName: 'Person', email: 't@example.com', phone: '+353 1 234 5678',
    city: 'Dublin', country: 'Ireland', linkedin: 'https://www.linkedin.com/in/test', currentEmployer: 'Acme', currentTitle: 'Systems Administrator',
    workAuthorized: 'Yes', needsSponsorship: 'No', salaryText: 'EUR 60,000', salaryNumber: 60000, noticePeriod: '1 month', noticeDays: 30, languages: ['English'], ...profile });
  writeJson(u.paths.cv, cv || require('./fixtures/cv.json'));
  return new User(u.id);
}

// Route fetch(url) to fixtures by substring match; anything unmatched is a test failure.
function fakeFetch(routes) {
  global.fetch = async (url) => {
    const hit = Object.entries(routes).find(([k]) => String(url).includes(k));
    if (!hit) throw new Error('unexpected network call in test: ' + url);
    const body = typeof hit[1] === 'function' ? hit[1](url) : hit[1];
    return { ok: true, status: 200, json: async () => (typeof body === 'string' ? JSON.parse(body) : body), text: async () => (typeof body === 'string' ? body : JSON.stringify(body)) };
  };
}

module.exports = { home, tempDir, fixture, makeUser, fakeFetch };
