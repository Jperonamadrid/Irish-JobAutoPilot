// Onboarding: CV file -> profile.json, cv.json, search settings and rules, via one AI call.
// The extracted CV is checked against the original text: numbers that do not appear in the
// original and bullets that do not closely match it are flagged for the person to review.
const fs = require('fs');
const path = require('path');
const { log, norm, slug, writeJson } = require('./util');
const { ask } = require('./llm');
const { fileText } = require('./pdftext');
const { composeRules } = require('./rules');

const SYSTEM = `You convert a CV into structured data for a job-application assistant.
Copy the CV's own words. Bullets must be the original sentences, only fixing broken line wraps, hyphenation and odd characters from PDF extraction. Do not add, merge, summarise, improve or invent anything: no new numbers, tools, employers, dates or achievements.
Keep the CV's dates exactly as written (e.g. "2022 to 2024", "Jan 2020 - Mar 2022").
company is the employer name only; put the town/country in location. skillsHeading is the CV's own heading for the skills section (e.g. "Skills", "Technical Skills", "Key Skills").
If the CV groups several short contracts under one heading, keep that structure using "roles".
Search suggestions: titles = 10-20 job-board search terms for roles this person is qualified for and likely wants (their current level and adjacent roles). includeKeywords = 20-50 short words/phrases that appear in titles of suitable jobs (include singular forms; e.g. "administrator", "infrastructure", "service desk"). excludeKeywords = words in titles of clearly unsuitable jobs for this person (other professions, much more senior levels such as "director", "vp", "principal", internships if they are experienced).
scoringGuidance: 3-6 short bullet lines telling a job-screening model what counts as a strong or weak fit for this person, based only on the CV.`;

const S = { type: 'string' }, A = items => ({ type: 'array', items });
const SCHEMA = { type: 'object', required: ['profile', 'cv', 'search', 'scoringGuidance'], properties: {
  profile: { type: 'object', required: ['firstName', 'lastName', 'email', 'phone'], properties: {
    firstName: S, lastName: S, email: S, phone: S, city: S, country: S, linkedin: S, currentEmployer: S, currentTitle: S,
    yearsExperience: { type: 'number' }, languages: A(S),
    education: { type: 'object', properties: { degree: S, field: S, school: S, year: S } } } },
  cv: { type: 'object', required: ['summary', 'skills', 'experience', 'education'], properties: {
    summary: S, skillsHeading: S,
    skills: A({ type: 'object', required: ['category', 'items'], properties: { category: S, items: S } }),
    experience: A({ type: 'object', required: ['company', 'dates'], properties: { company: S, location: S, dates: S, title: S, intro: S,
      bullets: A(S), roles: A({ type: 'object', required: ['title', 'company', 'bullets'], properties: { title: S, company: S, bullets: A(S) } }) } }),
    education: A({ type: 'object', required: ['degree'], properties: { degree: S, dates: S, lines: A(S) } }) } },
  search: { type: 'object', required: ['titles', 'includeKeywords', 'excludeKeywords'], properties: { titles: A(S), includeKeywords: A(S), excludeKeywords: A(S) } },
  scoringGuidance: S } };

// Compare extracted CV against the original text. Returns a list of human-readable warnings.
function factCheck(sourceText, cv) {
  const src = norm(sourceText), srcWords = new Set(src.split(' '));
  const warnings = [];
  const srcNums = new Set((sourceText.match(/\d+(?:[.,]\d+)?/g) || []).map(n => n.replace(',', '.')));
  const all = JSON.stringify(cv);
  for (const n of new Set(all.match(/\d+(?:[.,]\d+)?/g) || [])) if (!srcNums.has(n.replace(',', '.'))) warnings.push(`The number "${n}" is not in your original CV.`);
  const bullets = (cv.experience || []).flatMap(e => [...(e.bullets || []), ...(e.roles || []).flatMap(r => r.bullets || [])]);
  for (const b of bullets) {
    const ws = norm(b).split(' ').filter(w => w.length > 3);
    if (!ws.length) continue;
    const hit = ws.filter(w => srcWords.has(w)).length / ws.length;
    if (hit < 0.85) warnings.push(`This line differs from your original CV, please check it: "${b.slice(0, 90)}${b.length > 90 ? '…' : ''}"`);
  }
  return warnings;
}

// Run onboarding for `user` from a CV file already saved in their folder.
async function onboard(user, cvFile) {
  log('reading your CV…');
  const text = (await fileText(cvFile)).trim();
  if (text.length < 300) throw new Error('Could not read enough text from that CV. If it is a scanned image, export it as a text PDF or Word file.');
  log('extracting your profile with AI (about a minute)…');
  const r = await ask({ model: user.settings.models.answer, system: SYSTEM, schema: SCHEMA, timeout: 400000,
    prompt: `# CV text\n${text.slice(0, 20000)}\n\nThe person searches for jobs in ${user.preset.label}.` });
  const p = r.profile;
  const used = new Set();
  const uid = s => { let id = slug(s).slice(0, 30) || 'job', n = 1, out = id; while (used.has(out)) out = `${id}-${++n}`; used.add(out); return out; };
  const fullName = `${p.firstName} ${p.lastName}`.trim();
  if (p.linkedin && !/^https?:\/\//.test(p.linkedin)) p.linkedin = `https://${p.linkedin.replace(/^\/+/, '')}`;
  const cv = {
    name: fullName,
    contact: [p.email, p.phone, ...(p.linkedin ? [{ text: 'LinkedIn', url: p.linkedin.startsWith('http') ? p.linkedin : `https://${p.linkedin}` }] : []),
      [p.city, p.country].filter(Boolean).join(', ')].filter(Boolean),
    summary: r.cv.summary,
    skillsHeading: r.cv.skillsHeading || 'Skills',
    skills: r.cv.skills.map(s => [s.category, s.items]),
    experience: r.cv.experience.map(e => ({ id: uid(e.company), company: e.company, location: e.location || '', dates: e.dates,
      ...(e.title ? { title: e.title } : {}), ...(e.intro ? { intro: e.intro } : {}),
      ...(e.bullets?.length ? { bullets: e.bullets } : {}),
      ...(e.roles?.length ? { roles: e.roles.map(ro => ({ id: uid(ro.company), title: ro.title, company: ro.company, bullets: ro.bullets })) } : {}) })),
    education: r.cv.education.map(ed => ({ degree: ed.degree, dates: ed.dates || '', lines: (ed.lines || []).map(t => ({ text: t })) }))
  };
  const warnings = factCheck(text, cv);
  writeJson(user.paths.cv, cv);
  user.saveProfile({
    firstName: p.firstName, lastName: p.lastName, fullName, email: p.email, phone: p.phone,
    city: p.city || user.settings.search.city, country: p.country || user.preset.country, linkedin: p.linkedin || '',
    currentEmployer: p.currentEmployer || '', currentTitle: p.currentTitle || '', yearsExperience: p.yearsExperience,
    languages: p.languages?.length ? p.languages : ['English'],
    education: { school: p.education?.school || '', degree: p.education?.degree || '', field: p.education?.field || '', year: p.education?.year || '',
      degreeOption: '', degreeFallback: '' },
    cvSource: path.basename(cvFile)
  });
  user.saveSettings({ search: { titles: r.search.titles, includeKeywords: r.search.includeKeywords, excludeKeywords: r.search.excludeKeywords,
    ...(p.city ? { city: p.city } : {}) }, rules: { scoringGuidance: r.scoringGuidance } });
  composeRules(user);
  writeJson(user.p('onboarding.json'), { at: new Date().toISOString(), warnings });
  log(`profile created${warnings.length ? `, with ${warnings.length} thing(s) to check` : ''}`);
  return { warnings };
}

module.exports = { onboard, factCheck };
