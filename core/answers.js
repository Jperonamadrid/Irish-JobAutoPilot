// Resolves an answer for every form field, cheapest source first:
//   1. profile fields (name, email, CV...)   2. answers the person gave before (exact question)
//   3. rules in answers.json                 4. one AI call per job for whatever is left
// Anything required that still has no safe answer becomes a pending question for the person.
const { norm, readJson, writeJson, log } = require('./util');
const { ask } = require('./llm');
const { plainText } = require('./cvtext');

const DECLINE_RE = /prefer not|decline|don.?t wish|do not wish|not to (say|disclose|answer|identify)|rather not|choose not/i;

// No em dashes in form text (they read as machine-written), and no stray whitespace.
const clean = s => String(s).replace(/\s*—\s*/g, ', ').replace(/–/g, '-').trim();
const startDate = profile => new Date(Date.now() + (profile.noticeDays ?? 30) * 86400000).toISOString().slice(0, 10);

// Map a free answer onto one of a field's options. Returns the option or null.
function matchOption(options, answer) {
  if (!options?.length || answer == null) return null;
  if (answer === 'DECLINE') return options.find(o => DECLINE_RE.test(o.label)) || null;
  const a = norm(answer);
  if (!a) return null;
  return options.find(o => norm(o.label) === a)
    || options.find(o => norm(o.label).startsWith(a + ' ') || a.startsWith(norm(o.label) + ' '))
    || (a.length > 3 ? options.find(o => norm(o.label).includes(a)) : null)
    || null;
}

// Turn a raw answer into the value an adapter expects for this field type.
// Returns undefined when the answer does not fit the field (so a later source can try).
function coerce(field, raw, profile = {}) {
  if (raw == null || raw === '') return undefined;
  switch (field.type) {
    case 'boolean': { const a = norm(raw); return a.startsWith('yes') ? true : a.startsWith('no') ? false : undefined; }
    case 'select': {
      // A bare "Yes"/"No" must not land on a long option like "Yes, I intend to work remotely".
      if (/^(yes|no)$/i.test(String(raw).trim())) { const o = field.options?.find(o => norm(o.label) === norm(raw)); return o ? o.value : undefined; }
      const o = matchOption(field.options, raw); return o ? o.value : undefined;
    }
    case 'multiselect': {
      const parts = Array.isArray(raw) ? raw : String(raw).split(/\s*[;|]\s*/);
      const vals = parts.map(p => matchOption(field.options, p)).filter(Boolean).map(o => o.value);
      return vals.length ? [...new Set(vals)] : undefined;
    }
    case 'consent': { const a = norm(raw); return a.startsWith('yes') ? true : undefined; }
    case 'number': { const n = String(raw).replace(/[^\d.]/g, ''); return n ? n : undefined; }
    case 'date': return /^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw : startDate(profile);
    default: return clean(raw);
  }
}

// Fields every ATS has, identified by the adapter through field.role / field.edu.
function fromProfile(field, user, files) {
  const p = user.profile;
  switch (field.role) {
    case 'firstName': return p.firstName;
    case 'lastName': return p.lastName;
    case 'fullName': return p.fullName;
    case 'email': return p.email;
    case 'phone': return p.phone;
    case 'resume': return files.cv;
    case 'location': return p.locationText || [p.city, p.country].filter(Boolean).join(', ');
    case 'linkedin': return p.linkedin || '';
    case 'currentCompany': return p.currentEmployer;
    case 'summary': return files.summary;
  }
  switch (field.edu) {
    case 'school': return p.education?.school || 'Other';
    case 'degree': return p.education?.degreeOption;
  }
}

// {{field}} placeholders from the profile. Returns null when any placeholder is empty, so the
// person is asked instead of the form getting a blank or a guess.
function template(s, profile) {
  let missing = false;
  const out = s.replace(/\{\{(\w+)\}\}/g, (_, k) => { const v = profile[k]; if (v == null || v === '') missing = true; return v ?? ''; });
  return missing ? null : out;
}

function fromBank(field, bank, profile) {
  const q = field.label + (field.description ? ' ' + field.description : '');
  const learned = bank.learned?.[norm(field.label)];
  if (learned != null && learned !== '') return { raw: learned, src: 'learned' };
  for (const r of bank.rules || []) {
    let re; try { re = new RegExp(r.q, 'i'); } catch { continue; }
    if (!re.test(q)) continue;
    if (r.a === 'ASK') return { ask: true };
    if (r.a === 'SKIP') return { skip: true };
    if (r.a === 'DECLINE') return field.required ? { raw: 'DECLINE', src: 'rule', decline: true } : { skip: true };
    if (field.type === 'number' && /salary|compensation|pay/i.test(q) && profile.salaryNumber) return { raw: String(profile.salaryNumber), src: 'rule' };
    const a = template(r.a, profile);
    return a == null ? { ask: true, why: 'your profile does not have this yet' } : { raw: a, src: 'rule' };
  }
  return null;
}

const LLM_SYSTEM = `You fill in job application questions for one candidate, in their voice (first person).
Rules:
- Be truthful. Only claim what the CV and profile support. If a yes/no question asks about a qualification the candidate does not have (for example more years than they have), answer honestly ("No").
- If a question needs a fact that is not in the profile or CV (security clearance, a certification number, a referral name, a personal preference not stated), set needsUser=true and value="".
- Never answer attestations that the candidate personally completed the form or did not use AI, legal waivers (arbitration), criminal record, or demographic questions: needsUser=true.
- For select/multiselect/boolean fields, value must be exactly one of the listed options (multiselect: options joined with " | ").
- Free-text answers: plain, direct, specific, 40-120 words unless the question asks for more. Follow the candidate's writing rules exactly. Never use em dashes, buzzword stacks, "passionate" or "leverage".
- Cover letter (only when requested): one page, three short paragraphs: why this role at this company, two or three matching achievements with numbers from the CV, a short close. Sign off with the candidate's full name. No placeholders, no addresses, no date line. Never point out gaps, missing years or missing skills; lead with what matches.`;

const LLM_SCHEMA = { type: 'object', required: ['answers', 'coverLetter'], properties: {
  answers: { type: 'array', items: { type: 'object', required: ['key', 'value', 'needsUser'], properties: {
    key: { type: 'string' }, value: { type: 'string' }, needsUser: { type: 'boolean' }, why: { type: 'string' } } } },
  coverLetter: { type: 'string' } } };

const FORM_FACTS = ['fullName', 'email', 'city', 'country', 'currentEmployer', 'currentTitle', 'yearsExperience', 'noticePeriod', 'salaryText',
  'workAuthorized', 'needsSponsorship', 'visaStatus', 'nationality', 'languages', 'linkedin'];

async function fromLLM(user, job, fields, wantLetter) {
  const qs = fields.map(f => ({ key: f.key, question: f.label, ...(f.description ? { details: f.description.slice(0, 400) } : {}),
    type: f.type, required: f.required, ...(f.options ? { options: f.options.map(o => o.label) } : {}) }));
  const facts = Object.fromEntries(FORM_FACTS.filter(k => user.profile[k] != null && user.profile[k] !== '').map(k => [k, user.profile[k]]));
  const prompt = `# Candidate facts\n${JSON.stringify(facts, null, 1)}\n\n# Candidate rules\n${user.rules()}\n\n# CV\n${plainText(user.cv())}\n\n` +
    `# Job\n${job.title} at ${job.company} (${job.location})\n${(job.description || '').slice(0, 5000)}\n\n` +
    `# Questions\n${JSON.stringify(qs, null, 1)}\n\n` +
    `Answer every question by key. Today is ${new Date().toISOString().slice(0, 10)}; earliest start date is ${startDate(user.profile)}.\n` +
    (wantLetter ? 'Also write a tailored cover letter for this job in coverLetter.' : 'Leave coverLetter empty.');
  return ask({ model: user.settings.models.answer, system: LLM_SYSTEM, prompt, schema: LLM_SCHEMA });
}

// fields come from an ATS adapter's schema(). files = { cv, summary }. Returns
// { values: {key: value}, pending: [{key, label, why}], coverLetter, sources: {key: src} }.
// `prev` is an earlier result for the same job: its AI answers and letter are reused, so a re-fill
// (after the person answers a question, or to review) costs nothing.
async function resolve(user, job, fields, files = {}, prev) {
  const bank = readJson(user.paths.answers, { learned: {}, rules: [] });
  const profile = user.profile;
  const values = {}, sources = {}, pending = [], forAI = [];
  const ask_ = (f, why) => { if (f.required) pending.push({ key: f.key, label: f.label, why }); };
  for (const f of fields) {
    if (f.role === 'coverLetter') continue;
    const p = fromProfile(f, user, files);
    if (p !== undefined) {
      if (p) { values[f.key] = f.role === 'resume' || f.edu ? p : coerce(f, p, profile); sources[f.key] = 'profile'; }
      else ask_(f, 'not in your profile');
      continue;
    }
    const b = fromBank(f, bank, profile);
    if (b?.ask) { ask_(f, b.why || 'you asked to always answer this yourself'); continue; }
    if (b?.skip) continue;
    if (b) {
      const v = coerce(f, b.raw, profile);
      if (v !== undefined) { values[f.key] = v; sources[f.key] = b.src; continue; }
      if (b.decline) { ask_(f, 'demographic question with no "prefer not to say" option'); continue; }
    }
    if (f.type === 'file') { ask_(f, 'asks for a file other than your CV'); continue; }
    forAI.push(f);
  }
  const letterField = fields.find(f => f.role === 'coverLetter');
  let coverLetter = prev?.coverLetter || '';
  if (prev) for (const f of [...forAI]) {
    if (prev.sources?.[f.key] === 'llm' && prev.values?.[f.key] !== undefined) { values[f.key] = prev.values[f.key]; sources[f.key] = 'llm'; forAI.splice(forAI.indexOf(f), 1); }
    else if (f.required && prev.pending?.some(x => x.key === f.key)) { pending.push(prev.pending.find(x => x.key === f.key)); forAI.splice(forAI.indexOf(f), 1); }
  }
  if (forAI.length || (letterField && !coverLetter)) {
    try {
      const r = await fromLLM(user, job, forAI, !!letterField && !coverLetter);
      if (!coverLetter) coverLetter = clean(r.coverLetter || '');
      for (const a of r.answers) {
        const f = forAI.find(x => x.key === a.key); if (!f) continue;
        const v = a.needsUser ? undefined : coerce(f, a.value, profile);
        if (v !== undefined) { values[f.key] = v; sources[f.key] = 'llm'; }
        else ask_(f, a.why || 'not covered by your profile or CV');
      }
    } catch (e) {
      log('AI answers failed:', e.message);
      for (const f of forAI) ask_(f, 'the AI call failed; it will be retried');
    }
    for (const f of forAI) if (f.required && values[f.key] === undefined && !pending.some(x => x.key === f.key)) ask_(f, 'not answered');
  }
  return { values, pending, coverLetter, sources };
}

// Save the person's answer so every future form with the same question uses it.
function learn(user, question, answer) {
  const bank = readJson(user.paths.answers, { learned: {}, rules: [] });
  bank.learned ||= {};
  bank.learned[norm(question)] = answer;
  writeJson(user.paths.answers, bank);
}

module.exports = { resolve, learn, matchOption, coerce, template, fromBank, startDate, DECLINE_RE };
