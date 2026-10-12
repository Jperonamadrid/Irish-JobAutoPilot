// What happened after you applied. Each applied job can carry an outcome you record (heard back,
// interview, offer, rejected, no reply). From those this works out which follow-ups are due and
// which sources, CV versions and fit scores actually lead to replies, so the search can learn.
const OUTCOMES = { waiting: 'Waiting to hear', replied: 'Heard back', interview: 'Interview', offer: 'Offer', rejected: 'Rejected', no_reply: 'No reply' };
const RESPONDED = new Set(['replied', 'interview', 'offer', 'rejected']);
const FOLLOW_UP_DAYS = 10;   // a short follow-up email after about two weeks is normal practice
const GIVE_UP_DAYS = 30;     // after a month of silence, suggest closing it as "no reply"

const daysSince = (iso, now) => Math.floor((now - Date.parse(iso)) / 86400000);
const waiting = j => j.status === 'submitted' && (!j.outcome || j.outcome === 'waiting');

// A nudge for one applied job, or null: { kind: 'follow_up' | 'give_up', days }.
function nudge(j, now = Date.now()) {
  if (!waiting(j) || !j.submittedAt) return null;
  const days = daysSince(j.submittedAt, now);
  if (days >= GIVE_UP_DAYS) return { kind: 'give_up', days };
  if (days >= FOLLOW_UP_DAYS && !j.followedUpAt) return { kind: 'follow_up', days };
  return null;
}

// Counts for one group of applied jobs. Silence for a month counts as no reply.
function tally(jobs, now) {
  const n = k => jobs.filter(k).length;
  const applied = jobs.length, responded = n(j => RESPONDED.has(j.outcome));
  return { applied, responded, interviews: n(j => ['interview', 'offer'].includes(j.outcome)), offers: n(j => j.outcome === 'offer'),
    rejected: n(j => j.outcome === 'rejected'),
    noReply: n(j => j.outcome === 'no_reply' || (waiting(j) && j.submittedAt && daysSince(j.submittedAt, now) >= GIVE_UP_DAYS)),
    responseRate: applied ? Math.round(100 * responded / applied) : 0 };
}

function groupBy(jobs, key, now) {
  const g = {};
  for (const j of jobs) (g[key(j)] ||= []).push(j);
  return Object.entries(g).map(([label, js]) => ({ label, ...tally(js, now) })).sort((a, b) => b.applied - a.applied);
}

const scoreBand = s => s == null ? 'Not scored' : s >= 90 ? '90+' : s >= 80 ? '80-89' : s >= 70 ? '70-79' : 'Under 70';

function stats(store, now = Date.now()) {
  const applied = store.where(j => j.status === 'submitted');
  const view = j => ({ id: j.id, title: j.title, company: j.company, url: j.url, submittedAt: j.submittedAt, nudge: nudge(j, now) });
  return {
    total: tally(applied, now),
    nudges: applied.filter(j => nudge(j, now)).sort((a, b) => String(a.submittedAt).localeCompare(String(b.submittedAt))).map(view),
    bySource: groupBy(applied, j => j.source || 'other', now),
    byCv: groupBy(applied, j => j.kit?.tailored || j.cvPdf ? 'Tailored CV' : 'Standard CV', now),
    byScore: groupBy(applied, j => scoreBand(j.score), now),
    byHow: groupBy(applied, j => j.autoSubmitted ? 'Applied for you' : 'Applied by you', now)
  };
}

module.exports = { OUTCOMES, RESPONDED, FOLLOW_UP_DAYS, GIVE_UP_DAYS, nudge, stats, tally };
