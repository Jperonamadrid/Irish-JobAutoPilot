// Plain-text rendering of a cv.json, used in AI prompts.
// cv.json shape:
// { name, contact: [string | {text, url}], summary, skills: [[category, "a, b, c"]],
//   experience: [{ id, company, location, dates, title?, intro?, bullets?: [], roles?: [{ id, title, company, bullets }] }],
//   education: [{ degree, dates, lines: [{ label?, text, muted? }] }] }
function plainText(cv) {
  if (!cv) return '';
  const exp = (cv.experience || []).map(e => [
    `${e.company}${e.location ? ', ' + e.location : ''} (${e.dates})${e.title ? ': ' + e.title : ''}`, e.intro || '',
    ...(e.bullets || []).map(b => '- ' + b),
    ...(e.roles || []).flatMap(r => [`${r.title}, ${r.company}`, ...r.bullets.map(b => '- ' + b)])
  ].filter(Boolean).join('\n'));
  const edu = educationList(cv).map(ed => `${ed.degree} (${ed.dates}). ${(ed.lines || []).map(l => (l.label ? l.label + ' ' : '') + l.text).join(' ')}`);
  return [cv.summary, 'Skills:', ...(cv.skills || []).map(([k, v]) => `${k}: ${v}`), 'Experience:', ...exp, 'Education:', ...edu].join('\n');
}
// Older CVs stored a single education object; newer ones a list.
const educationList = cv => !cv.education ? [] : Array.isArray(cv.education) ? cv.education : [cv.education];

module.exports = { plainText, educationList };
