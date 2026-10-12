// One person using the app. Everything personal lives in users/<id>/:
//   settings.json  search + apply preferences      profile.json  form data (name, phone, salary...)
//   cv.json        master CV content               rules.md      targets, dealbreakers, writing rules (fed to the AI)
//   answers.json   question rules + learned answers jobs.json     job database
//   outputs/       tailored CVs, letters, shots     browser/      this person's Chrome profile (site logins)
const fs = require('fs');
const path = require('path');
const { USERS_DIR, readJson, writeJson, norm, slug } = require('./util');

const DEFAULT_SETTINGS = {
  preset: 'ireland',
  search: {
    titles: [],              // search terms for LinkedIn / IrishJobs / Jooble / Workable
    includeKeywords: [],     // a job title must contain one of these...
    excludeKeywords: [],     // ...and none of these
    city: 'Dublin',
    remote: 'europe',        // none | country | europe | anywhere
    postedWithinDays: 3,
    excludeCompanies: [],    // never apply here (e.g. your current employer, the agency that placed you)
    followCompanies: []      // always search these companies' own job boards (names or careers-page links)
  },
  apply: {
    minSalary: 0,            // dealbreaker when a posting states a lower salary (0 = none)
    threshold: 70,           // minimum AI score to prepare an application
    maxPerRun: 25,
    maxPerCompanyPerRun: 2,
    tailorCv: true,
    kitsPerRun: 10,          // tailored CV + cover letter packs made per run
    maxScorePerRun: 300,     // AI scoring cap per run (the rest wait for the next run)
    companyCaps: { openai: { max: 5, days: 180 } }   // employers that publish an application limit
  },
  sources: { boards: true, linkedin: true, irishjobs: true, careerjet: true, publicjobs: true, jobsireland: true,
    workable: true, jobicy: true, workday: true, jooble: false, recruitireland: true, remoteok: true },
  rules: { scoringGuidance: '', dealbreakers: '', writingRules: '', notes: '' },   // composed into rules.md
  // help = recommend jobs and make a tailored CV + letter for each; the person applies.
  // auto = also submit applications by itself, within the limits below. Only the person can turn it on.
  mode: 'help',
  auto: { consentAt: null, minScore: 80, dailyLimit: 10 },
  setupDone: false,
  schedule: { on: false, time: '08:30', days: 'weekdays', lastRun: null },   // automatic daily run (see schedule.js)
  joobleKey: '',
  models: { score: 'haiku', answer: 'sonnet' }
};

// Languages that, when named in a job title, usually mean the role requires them.
const TITLE_LANGUAGES = ['german', 'french', 'italian', 'dutch', 'spanish', 'portuguese', 'polish', 'nordic', 'swedish', 'danish',
  'norwegian', 'finnish', 'japanese', 'korean', 'mandarin', 'chinese', 'cantonese', 'arabic', 'turkish', 'russian', 'hebrew', 'greek'];

const deepMerge = (a, b) => {
  const out = { ...a };
  for (const [k, v] of Object.entries(b || {})) out[k] = v && typeof v === 'object' && !Array.isArray(v) && a[k] && typeof a[k] === 'object' ? deepMerge(a[k], v) : v;
  return out;
};

// Keyword matcher for job titles. Keywords are plain phrases (no regex): matched as whole words,
// case-insensitive, with an optional plural "s", and also with spaces removed for longer phrases
// ("service desk" matches "ServiceDesk").
function keywordMatcher(keywords) {
  const ks = keywords.map(norm).filter(Boolean);
  return title => {
    const t = ` ${norm(title)} `, squashed = t.replace(/ /g, '');
    return ks.some(k => t.includes(` ${k} `) || t.includes(` ${k}s `) || (k.length >= 6 && k.includes(' ') && squashed.includes(k.replace(/ /g, ''))));
  };
}

function locationMatcher(settings, preset) {
  const words = [settings.search.city, preset.country, preset.countryCode].filter(Boolean).map(w => w.toLowerCase());
  const local = new RegExp(`(${words.map(w => w.length <= 2 ? `\\b${w}\\b` : w).join('|')})`, 'i');
  const remote = {
    none: null,
    country: new RegExp(`remote.{0,15}(${preset.country})|(${preset.country}).{0,15}remote`, 'i'),
    europe: /(\bemea\b|\beurope\b|european union|home[- ]based|anywhere|worldwide|global remote|^\s*remote\s*$|remote[ -]*(first|friendly)?\s*[-(,]?\s*(emea|europe|eu\b|global|worldwide|uk & ireland))/i,
    anywhere: /(remote|anywhere|worldwide|global|home[- ]based|\bemea\b|\beurope\b)/i
  }[settings.search.remote || 'none'];
  return locs => locs.some(l => l && (local.test(l) || (remote && remote.test(l))));
}

class User {
  constructor(id) {
    this.id = id;
    this.dir = path.join(USERS_DIR, id);
    if (!fs.existsSync(this.dir)) throw new Error(`No such user: ${id}`);
    this.reload();
  }
  p(...parts) { return path.join(this.dir, ...parts); }
  get paths() {
    return { settings: this.p('settings.json'), profile: this.p('profile.json'), cv: this.p('cv.json'), rules: this.p('rules.md'),
      answers: this.p('answers.json'), jobs: this.p('jobs.json'), outputs: this.p('outputs'), browser: this.p('browser'), logs: this.p('logs') };
  }
  reload() {
    this.settings = deepMerge(DEFAULT_SETTINGS, readJson(this.paths.settings, {}));
    this.profile = readJson(this.paths.profile, {});
    this.preset = require(`../presets/${this.settings.preset}`);
    const s = this.settings.search;
    const spoken = (this.profile.languages || []).map(l => l.toLowerCase());
    this.filters = {
      include: keywordMatcher(s.includeKeywords),
      exclude: keywordMatcher([...s.excludeKeywords, ...TITLE_LANGUAGES.filter(l => !spoken.includes(l))]),
      location: locationMatcher(this.settings, this.preset),
      excludedCompany: c => s.excludeCompanies.some(x => norm(c).includes(norm(x)))
    };
  }
  // True when a posting passes this person's title and location filters.
  wanted(title, locations) {
    return this.filters.include(title) && !this.filters.exclude(title) && this.filters.location(locations.filter(Boolean));
  }
  cv() { return readJson(this.paths.cv); }
  rules() { try { return fs.readFileSync(this.paths.rules, 'utf8'); } catch { return ''; } }
  saveSettings(patch) { writeJson(this.paths.settings, deepMerge(readJson(this.paths.settings, {}), patch)); this.reload(); }
  saveProfile(patch) { writeJson(this.paths.profile, { ...this.profile, ...patch }); this.reload(); }
  get ready() { return fs.existsSync(this.paths.cv) && !!this.profile.fullName && this.settings.search.includeKeywords.length > 0; }
}

function listUsers() {
  if (!fs.existsSync(USERS_DIR)) return [];
  return fs.readdirSync(USERS_DIR).filter(d => fs.existsSync(path.join(USERS_DIR, d, 'settings.json')))
    .map(id => ({ id, name: readJson(path.join(USERS_DIR, id, 'profile.json'), {}).fullName || id }));
}

function createUser(name) {
  const id = slug(name) || `user-${Date.now()}`;
  const dir = path.join(USERS_DIR, id);
  if (fs.existsSync(dir)) throw new Error(`A user called "${id}" already exists`);
  fs.mkdirSync(dir, { recursive: true });
  writeJson(path.join(dir, 'settings.json'), {});
  writeJson(path.join(dir, 'profile.json'), { fullName: name });
  fs.copyFileSync(path.join(__dirname, '..', 'templates', 'answers.json'), path.join(dir, 'answers.json'));
  return new User(id);
}

module.exports = { User, listUsers, createUser, keywordMatcher, locationMatcher, DEFAULT_SETTINGS, deepMerge };
