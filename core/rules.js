// rules.md: the plain-English brief every AI call reads (targets, dealbreakers, scoring guidance,
// writing rules). It is generated from settings.rules so the app's forms stay the source of truth.
const fs = require('fs');

const DEFAULT_WRITING = 'Plain, human tone. No em dashes, no placeholder brackets, no buzzword stacks, never "passionate" or "leverage". ' +
  'Cover letters are one page, three short paragraphs: why this role, two or three matching achievements with numbers, a short close.';

function composeRules(user) {
  const s = user.settings, r = s.rules || {}, p = user.profile;
  const deal = [
    s.apply.minSalary ? `Salary below EUR ${Number(s.apply.minSalary).toLocaleString('en-IE')} (when the posting states one).` : '',
    s.search.remote === 'none' ? `Roles not in or near ${s.search.city}.` : `Roles outside ${user.preset.country} that are not fully remote.`,
    'Unpaid roles or internships.',
    r.dealbreakers || ''
  ].filter(Boolean);
  const md = [
    `# Candidate rules for ${p.fullName || user.id}`, '',
    '## Target roles', s.search.titles.map(t => `- ${t}`).join('\n') || '- (none yet)', '',
    '## Dealbreakers (skip these)', deal.map(d => `- ${d}`).join('\n'), '',
    '## Scoring guidance', r.scoringGuidance || '- Judge fit on duties and requirements against the CV.', '',
    '## Writing rules', r.writingRules || DEFAULT_WRITING, '',
    ...(r.notes ? ['## Other notes', r.notes, ''] : [])
  ].join('\n');
  fs.writeFileSync(user.paths.rules, md);
  return md;
}

module.exports = { composeRules, DEFAULT_WRITING };
