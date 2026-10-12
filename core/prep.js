// Interview prep for one job you have an interview for: likely questions with answer outlines built
// from your real CV, questions to ask them, what to brush up on, and a short "about me" pitch.
const { log } = require('./util');
const { ask } = require('./llm');
const { plainText } = require('./cvtext');

const SYSTEM = `You help one candidate prepare for a job interview. Use only the CV, the job posting and the candidate's rules.
Truthful: every answer outline must rest on facts in the CV; never invent experience, numbers, tools or results. Where the posting asks for something the CV does not show, say so honestly in "prepare" with a constructive way to address it (related experience, eagerness to learn), never a made-up claim.
questions: 8 to 10 questions this employer is likely to ask for this role (mix of role-specific, behavioural and motivation), each with why they ask it and an answer outline in the candidate's voice using a real example from the CV (situation, action, result where it fits). Keep each outline under 70 words.
askThem: 4 or 5 good questions for the candidate to ask, specific to this posting.
prepare: 3 to 6 things to check or refresh before the interview.
pitch: a 30-second "tell me about yourself" in the first person, about 70 words, plain and specific.
No em dashes, no "passionate", no "leverage".`;

const SCHEMA = { type: 'object', required: ['pitch', 'questions', 'askThem', 'prepare'], properties: {
  pitch: { type: 'string' },
  questions: { type: 'array', items: { type: 'object', required: ['q', 'why', 'answer'], properties: { q: { type: 'string' }, why: { type: 'string' }, answer: { type: 'string' } } } },
  askThem: { type: 'array', items: { type: 'string' } },
  prepare: { type: 'array', items: { type: 'string' } } } };

const clean = s => String(s || '').replace(/\s*—\s*/g, ', ').replace(/–/g, '-').trim();

async function prep(user, store, id) {
  const job = store.get(id);
  if (!job) throw new Error(`No job ${id}`);
  log(`preparing interview notes for ${job.company} | ${job.title}`);
  const r = await ask({ model: user.settings.models.answer, system: SYSTEM, schema: SCHEMA,
    prompt: `# Candidate rules\n${user.rules()}\n\n# CV\n${plainText(user.cv())}\n\n# Job\n${job.title} at ${job.company} (${job.location || ''})\n${(job.description || '(no description saved)').slice(0, 6000)}` });
  const out = { pitch: clean(r.pitch), questions: r.questions.map(q => ({ q: clean(q.q), why: clean(q.why), answer: clean(q.answer) })),
    askThem: r.askThem.map(clean), prepare: r.prepare.map(clean), at: new Date().toISOString() };
  store.update(id, { prep: out }); store.save();
  log(`interview notes ready: ${out.questions.length} likely questions, ${out.askThem.length} to ask them`);
  return out;
}

module.exports = { prep };
