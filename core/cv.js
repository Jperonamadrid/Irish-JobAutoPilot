// CV rendering (HTML -> PDF with the bundled font, plus an editable .docx), and per-job tailoring.
// Tailoring may reorder, reword and trim; validate() rejects anything that adds facts.
const fs = require('fs');
const path = require('path');
const { log, readJson, writeJson } = require('./util');
const { ask } = require('./llm');
const { htmlToPdf, esc } = require('./browser');
const { pdfPages } = require('./pdftext');
const { educationList } = require('./cvtext');

// ---- HTML template (same look as the original Word CV: navy headings, two-column skills) -------
const CSS = `
*{box-sizing:border-box} body{margin:0;font:9.6pt/1.32 Carlito,Calibri,sans-serif;color:#111}
h1{font-size:20pt;color:#1F3A68;margin:0 0 2px} .contact{font-size:8.6pt;color:#595959;margin-bottom:6px}
.contact a{color:#595959;text-decoration:none}
h2{font-size:10.8pt;letter-spacing:.06em;text-transform:uppercase;color:#1F3A68;border-bottom:1px solid #1F3A68;margin:10px 0 5px;padding-bottom:2px}
p{margin:0 0 3px} table.skills{border-collapse:collapse;width:100%} .skills td{padding:1px 0 3px;vertical-align:top}
.skills td.k{width:27%;font-weight:700;color:#1F3A68;font-size:9.3pt} .skills td.v{font-size:9.3pt}
.co{display:flex;justify-content:space-between;margin-top:6px;break-after:avoid} .co .d{font-weight:700;color:#595959}
.title{font-style:italic;color:#7F7F7F;margin:0 0 2px;break-after:avoid} .role{font-weight:700;font-style:italic;color:#1F3A68;margin:4px 0 1px;break-after:avoid}
ul{margin:0 0 2px;padding-left:16px} li{margin:0 0 1.5px} li::marker{font-size:8pt}
.muted{color:#7F7F7F}`;

function cvHtml(cv) {
  const contact = (cv.contact || []).map(c => typeof c === 'string' ? esc(c) : `<a href="${esc(c.url)}">${esc(c.text)}</a>`).join('&nbsp; | &nbsp;');
  const bullets = list => list?.length ? `<ul>${list.map(b => `<li>${esc(b)}</li>`).join('')}</ul>` : '';
  const exp = (cv.experience || []).map(e => `
    <div class="co"><span><b>${esc(e.company)}</b>${e.location ? ', ' + esc(e.location) : ''}</span><span class="d">${esc(e.dates)}</span></div>
    ${e.title ? `<p class="title">${esc(e.title)}</p>` : ''}${e.intro ? `<p class="title">${esc(e.intro)}</p>` : ''}
    ${bullets(e.bullets)}
    ${(e.roles || []).map(r => `<p class="role">${esc(r.title)} &nbsp;·&nbsp; ${esc(r.company)}</p>${bullets(r.bullets)}`).join('')}`).join('');
  const edu = educationList(cv).map(ed => `
    <div class="co"><span><b>${esc(ed.degree)}</b></span><span class="d">${esc(ed.dates || '')}</span></div>
    ${(ed.lines || []).map(l => `<p class="${l.muted ? 'muted' : ''}">${l.label ? `<b>${esc(l.label)}</b> ` : ''}${esc(l.text)}</p>`).join('')}`).join('');
  return `<style>${CSS}</style><h1>${esc(cv.name)}</h1><div class="contact">${contact}</div>
    <h2>Professional Summary</h2><p>${esc(cv.summary)}</p>
    ${cv.skills?.length ? `<h2>${esc(cv.skillsHeading || 'Skills')}</h2><table class="skills">${cv.skills.map(([k, v]) => `<tr><td class="k">${esc(k)}</td><td class="v">${esc(v)}</td></tr>`).join('')}</table>` : ''}
    <h2>Professional Experience</h2>${exp}
    ${edu ? `<h2>Education</h2>${edu}` : ''}`;
}

// ---- Word export (editable copy) -----------------------------------------------------------------
async function cvDocx(cv, file) {
  const { Document, Packer, Paragraph, TextRun, ExternalHyperlink, Table, TableRow, TableCell, WidthType, BorderStyle,
    AlignmentType, TabStopType, LevelFormat } = require('docx');
  const NAVY = '1F3A68', GREY = '595959', MUTED = '7F7F7F', FONT = 'Calibri', PAGE_W = 11906, MARGIN = 1020, TEXT_W = PAGE_W - 2 * MARGIN;
  const NONE = { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' };
  const noB = { top: NONE, bottom: NONE, left: NONE, right: NONE, insideHorizontal: NONE, insideVertical: NONE };
  const run = (text, o = {}) => new TextRun({ text, font: FONT, size: o.size || 20, bold: o.bold, italics: o.italics, color: o.color });
  const para = (children, o = {}) => new Paragraph({ children, spacing: { before: o.before || 0, after: o.after ?? 40, line: 250 }, keepNext: o.keepNext });
  const heading = t => new Paragraph({ children: [new TextRun({ text: t.toUpperCase(), font: FONT, size: 22, bold: true, color: NAVY, characterSpacing: 20 })],
    spacing: { before: 160, after: 80 }, border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: NAVY, space: 2 } } });
  const line = (l, r) => new Paragraph({ tabStops: [{ type: TabStopType.RIGHT, position: TEXT_W }], spacing: { before: 100, after: 0 }, keepNext: true,
    children: [...l, run(`\t${r || ''}`, { bold: true, color: GREY })] });
  const bullet = t => new Paragraph({ numbering: { reference: 'dots', level: 0 }, spacing: { after: 20, line: 250 }, children: [run(t)] });
  const k = [para([new TextRun({ text: cv.name, font: FONT, size: 40, bold: true, color: NAVY })], { after: 20 })];
  const contact = [];
  (cv.contact || []).forEach((c, i) => {
    if (i) contact.push(run('  |  ', { size: 17, color: GREY }));
    contact.push(typeof c === 'string' ? run(c, { size: 17, color: GREY }) : new ExternalHyperlink({ link: c.url, children: [run(c.text, { size: 17, color: GREY })] }));
  });
  k.push(para(contact, { after: 60 }), heading('Professional Summary'), para([run(cv.summary)]));
  if (cv.skills?.length) {
    k.push(heading(cv.skillsHeading || 'Skills'));
    const c1 = 2700;
    k.push(new Table({ width: { size: TEXT_W, type: WidthType.DXA }, columnWidths: [c1, TEXT_W - c1], borders: noB,
      rows: cv.skills.map(([a, b]) => new TableRow({ children: [
        new TableCell({ width: { size: c1, type: WidthType.DXA }, borders: noB, children: [para([run(a, { bold: true, color: NAVY, size: 19 })], { after: 50 })] }),
        new TableCell({ width: { size: TEXT_W - c1, type: WidthType.DXA }, borders: noB, children: [para([run(b, { size: 19 })], { after: 50 })] })] })) }));
  }
  k.push(heading('Professional Experience'));
  for (const e of cv.experience || []) {
    k.push(line([run(e.company, { bold: true }), run(e.location ? `, ${e.location}` : '')], e.dates));
    if (e.title) k.push(para([run(e.title, { italics: true, color: MUTED })], { after: 30, keepNext: true }));
    if (e.intro) k.push(para([run(e.intro, { italics: true, color: MUTED })], { after: 40, keepNext: true }));
    (e.bullets || []).forEach(b => k.push(bullet(b)));
    for (const r of e.roles || []) {
      k.push(para([run(`${r.title}  ·  ${r.company}`, { bold: true, italics: true, color: NAVY })], { before: 60, after: 20, keepNext: true }));
      r.bullets.forEach(b => k.push(bullet(b)));
    }
  }
  const edu = educationList(cv);
  if (edu.length) {
    k.push(heading('Education'));
    for (const ed of edu) {
      k.push(line([run(ed.degree, { bold: true })], ed.dates));
      for (const l of ed.lines || []) k.push(para(l.label ? [run(l.label + ' ', { bold: true }), run(l.text)] : [run(l.text, { color: l.muted ? MUTED : undefined })], { after: 20 }));
    }
  }
  const doc = new Document({ creator: cv.name, title: `${cv.name} CV`, styles: { default: { document: { run: { font: FONT, size: 20 } } } },
    numbering: { config: [{ reference: 'dots', levels: [{ level: 0, format: LevelFormat.BULLET, text: '•', alignment: AlignmentType.LEFT,
      style: { paragraph: { indent: { left: 360, hanging: 220 } } } }] }] },
    sections: [{ properties: { page: { size: { width: PAGE_W, height: 16838 }, margin: { top: 800, bottom: 800, left: MARGIN, right: MARGIN } } }, children: k }] });
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, await Packer.toBuffer(doc));
  return file;
}

// Writes "<Name> CV.pdf" (and .docx) into dir. Returns { pdf, docx, pages }.
async function render(cv, dir) {
  const base = path.join(dir, `${cv.name} CV`);
  await htmlToPdf(cvHtml(cv), base + '.pdf', { margin: '14mm' });
  await cvDocx(cv, base + '.docx');
  return { pdf: base + '.pdf', docx: base + '.docx', pages: await pdfPages(base + '.pdf') };
}

// The untailored CV, re-rendered whenever cv.json changes.
async function masterPdf(user) {
  const cv = user.cv();
  const dir = path.join(user.paths.outputs, 'cv');
  const pdf = path.join(dir, `${cv.name} CV.pdf`);
  if (!fs.existsSync(pdf) || fs.statSync(pdf).mtimeMs < fs.statSync(user.paths.cv).mtimeMs) await render(cv, dir);
  return pdf;
}

// ---- Tailoring ---------------------------------------------------------------------------------
const TAILOR_SYSTEM = `You tailor a CV to one job posting.
Allowed: rewrite the summary for this role (3 sentences max); reorder bullets within a job so the most relevant come first; reword bullets to mirror the posting's terminology where the underlying fact is the same; drop the least relevant bullets (keep at least 2 per job or role); reorder skill categories and the items inside them.
Forbidden: adding or renaming employers, roles, job titles, dates, locations, or education; inventing numbers, metrics, tools, certifications or responsibilities not present in the master; changing any number; adding skills not already listed; removing a job or role.
Style: no em dashes, no "passionate", no "leverage", plain professional tone, keep the spelling conventions of the master. Keep the whole CV to two A4 pages: about 1,000 words at most.
Keep every skill category name exactly as given.`;

// Rejects a tailored CV that invented anything: the employer/date skeleton and education must be
// identical, every number must already exist in the master, and no new skills may appear.
function validate(master, t) {
  const skeleton = cv => JSON.stringify((cv.experience || []).map(e => [e.id, e.company, e.location, e.dates, e.title || '', (e.roles || []).map(r => [r.id, r.title, r.company])]));
  if (skeleton(master) !== skeleton(t)) return 'employer/role/date structure changed';
  if (JSON.stringify(educationList(master)) !== JSON.stringify(educationList(t))) return 'education changed';
  const nums = cv => new Set((JSON.stringify(cv).match(/\d+(?:[.,]\d+)?/g) || []));
  const known = nums(master);
  const invented = [...nums(t)].filter(n => !known.has(n));
  if (invented.length) return 'new numbers: ' + invented.join(', ');
  const cats = cv => JSON.stringify((cv.skills || []).map(s => s[0]).sort());
  if (cats(master) !== cats(t)) return 'skill categories changed';
  const skills = cv => new Set((cv.skills || []).flatMap(([, v]) => v.split(/,\s*/).map(s => s.trim().toLowerCase())));
  const ms = skills(master), extra = [...skills(t)].filter(s => !ms.has(s));
  if (extra.length) return 'new skills: ' + extra.join(', ');
  if (/—/.test(JSON.stringify(t))) return 'em dash';
  return null;
}

// The model only returns what it may change (summary, skills, bullets per job/role); employers,
// titles, dates and education are copied from the master, so they cannot drift.
async function tailor(user, job) {
  const { _help, ...cv } = user.cv();
  const units = (cv.experience || []).flatMap(e => [...(e.bullets?.length ? [{ id: e.id, heading: `${e.title || ''} at ${e.company}`, bullets: e.bullets }] : []),
    ...(e.roles || []).map(r => ({ id: r.id, heading: `${r.title} at ${r.company}`, bullets: r.bullets }))]);
  const schema = { type: 'object', required: ['summary', 'skills', 'jobs'], properties: {
    summary: { type: 'string' },
    skills: { type: 'array', items: { type: 'object', required: ['category', 'items'], properties: { category: { type: 'string' }, items: { type: 'string' } } } },
    jobs: { type: 'array', items: { type: 'object', required: ['id', 'bullets'], properties: { id: { type: 'string' }, bullets: { type: 'array', items: { type: 'string' } } } } } } };
  const prompt = `# Job\n${job.title} at ${job.company} (${job.location})\n${(job.description || '').slice(0, 5000)}\n\n` +
    `# Candidate rules\n${user.rules()}\n\n# Master summary\n${cv.summary}\n\n# Master skills (category: items)\n${(cv.skills || []).map(([k, v]) => `${k}: ${v}`).join('\n')}\n\n` +
    `# Master bullets by job id\n${JSON.stringify(units, null, 1)}\n\n` +
    `Return: summary; skills as the same categories (you may reorder categories and items, not rename or add); jobs with one entry per id listed above.`;
  let lastErr;
  for (let attempt = 0; attempt < 2; attempt++) {
    let r;
    try { r = await ask({ model: user.settings.models.answer, system: TAILOR_SYSTEM + (lastErr ? `\nYour previous attempt was rejected: ${lastErr}. Fix that.` : ''), prompt, schema }); }
    catch (e) { lastErr = e.message; continue; }
    const byId = Object.fromEntries((r.jobs || []).map(j => [j.id, j.bullets]));
    const pick = (id, orig) => (byId[id]?.length >= Math.min(2, orig.length) ? byId[id] : orig);
    const t = { ...cv, summary: r.summary, skills: (r.skills || []).map(s => [s.category, s.items]),
      experience: cv.experience.map(e => ({ ...e, ...(e.bullets ? { bullets: pick(e.id, e.bullets) } : {}),
        ...(e.roles ? { roles: e.roles.map(ro => ({ ...ro, bullets: pick(ro.id, ro.bullets) })) } : {}) })) };
    lastErr = validate(cv, t);
    if (!lastErr) return t;
    log('tailored CV rejected by the fact check:', lastErr);
  }
  return null;
}

// Tailored PDF for a job; falls back to the master CV if tailoring fails or runs past 2 pages.
async function cvFor(user, job) {
  const dir = path.join(user.paths.outputs, 'jobs', job.id.replace(/[^\w.-]+/g, '_'));
  try {
    const t = await tailor(user, job);
    if (t) {
      const r = await render(t, dir);
      if (r.pages <= 2) { writeJson(path.join(dir, 'cv.json'), t); return { pdf: r.pdf, summary: t.summary, tailored: true }; }
      log('tailored CV ran over 2 pages, using the standard CV');
    }
  } catch (e) { log('CV tailoring failed, using the standard CV:', e.message); }
  return { pdf: await masterPdf(user), summary: user.cv().summary, tailored: false };
}

module.exports = { cvHtml, cvDocx, render, masterPdf, tailor, validate, cvFor };
