// Open questions: required form fields the app could not answer safely. Shown once per distinct
// question (a question shared by five forms is answered once), saved as a "learned" answer, and
// every job waiting only on answered questions goes back to "ready" for re-filling.
const { norm, readJson } = require('./util');
const { learn } = require('./answers');

// Problems that are not questions for the person (they are retried or need the browser).
const NOT_A_QUESTION = /^could not fill|the form did not load|finish submitting|verification code|captcha|the ai call failed/i;

function openQuestions(store) {
  const qs = new Map();
  for (const j of store.where(j => j.status === 'needs_input'))
    for (const p of j.pending || []) {
      if (NOT_A_QUESTION.test(p.why) || p.key === 'submit') continue;
      const k = norm(p.label);
      if (!qs.has(k)) qs.set(k, { key: k, label: p.label, why: p.why, jobs: [], options: null });
      const q = qs.get(k);
      q.jobs.push({ id: j.id, company: j.company, title: j.title });
    }
  return [...qs.values()].sort((a, b) => b.jobs.length - a.jobs.length);
}

// Jobs with problems that are not questions (fill errors etc.), for the job list.
const fillProblems = job => (job.pending || []).filter(p => NOT_A_QUESTION.test(p.why));

function answer(user, store, question, value) {
  learn(user, question, value);
  const bank = readJson(user.paths.answers, { learned: {} });
  const known = new Set(Object.keys(bank.learned || {}));
  let requeued = 0;
  for (const j of store.where(j => j.status === 'needs_input'))
    if ((j.pending || []).every(p => known.has(norm(p.label)) || NOT_A_QUESTION.test(p.why))) {
      store.update(j.id, { status: 'ready' }, 'questions answered'); requeued++;
    }
  store.save();
  return requeued;
}

module.exports = { openQuestions, answer, fillProblems, NOT_A_QUESTION };
