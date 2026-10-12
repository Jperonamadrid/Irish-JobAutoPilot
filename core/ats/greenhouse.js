// Greenhouse. The questions API returns every field with its DOM id, so filling is exact.
const { getJson, htmlToText } = require('../util');
const { pickCombo, outcome } = require('../browser');

const ROLES = { first_name: 'firstName', last_name: 'lastName', email: 'email', phone: 'phone', resume: 'resume', cover_letter: 'coverLetter' };
const TYPES = { input_text: 'text', textarea: 'textarea', input_file: 'file', multi_value_single_select: 'select', multi_value_multi_select: 'multiselect' };

async function schema(job) {
  const d = await getJson(`https://boards-api.greenhouse.io/v1/boards/${job.board}/jobs/${job.atsId}?questions=true`);
  if (!d) return null;   // posting closed
  if (!job.description) job.description = htmlToText(d.content).slice(0, 6000);
  const fields = [], blockers = [];
  const add = (q, f, extra = {}) => {
    const type = TYPES[f.type];
    if (!type || /_text$/.test(f.name)) return;   // resume_text / cover_letter_text: we upload files instead
    fields.push({ key: f.name, label: q.label.trim(), description: htmlToText(q.description || ''), required: !!q.required, type,
      role: ROLES[f.name] || (/linkedin/i.test(q.label) && type === 'text' ? 'linkedin' : undefined),
      options: f.values?.length ? f.values.map(v => ({ label: v.label.trim(), value: String(v.value) })) : undefined, ...extra });
  };
  for (const q of d.questions || []) for (const f of q.fields) add(q, f);
  if ((d.location_questions || []).some(q => q.fields.some(f => f.name === 'location')))
    fields.push({ key: 'candidate-location', label: 'Location', required: true, type: 'location', role: 'location' });
  for (const c of d.compliance || []) for (const q of c.questions || []) for (const f of q.fields || []) add(q, f, { eeo: true });
  // Demographic survey: rendered as a react-select with the question id as the DOM id. Only
  // required ones are touched, and the rules answer them with the "don't wish to answer" option.
  for (const q of d.demographic_questions?.questions || []) if (q.required)
    fields.push({ key: String(q.id), label: q.label.trim(), required: true, type: 'select', eeo: true,
      options: q.answer_options.map(a => ({ label: a.label.trim(), value: String(a.id) })) });
  if (d.education === 'education_required')
    fields.push({ key: 'school--0', label: 'School', required: true, type: 'education', edu: 'school' },
                { key: 'degree--0', label: 'Degree', required: true, type: 'education', edu: 'degree' });
  return { fields, blockers };
}

const byId = (page, id) => page.locator(`[id="${id}"]`);

// Upload and confirm the file name shows up; retry once if the widget reported an error.
async function upload(page, key, file) {
  const name = require('path').basename(file);
  for (let i = 0; i < 4; i++) {
    await byId(page, key).setInputFiles(file);
    const ok = await page.getByText(name, { exact: false }).first().waitFor({ timeout: 8000 }).then(() => true, () => false);
    if (ok) return;
    await page.waitForTimeout(4000 + i * 2000);   // uploader may still be initialising
  }
  throw new Error(`upload of ${name} did not complete`);
}

async function fill(page, job, fields, res, files) {
  await page.goto(job.applyUrl, { waitUntil: 'domcontentloaded', timeout: 45000 });
  await byId(page, 'first_name').waitFor({ timeout: 30000 });
  // Uploads fail ("reading 'uploadFile'") until the page has fetched its presigned upload fields.
  await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
  const errors = [];
  // Files first: Greenhouse can parse the resume and prefill, which we then overwrite.
  const ordered = [...fields].sort((a, b) => (b.type === 'file') - (a.type === 'file'));
  for (const f of ordered) {
    const v = f.role === 'coverLetter' ? files.coverLetter : res.values[f.key];
    if (v === undefined || v === '') continue;
    try {
      switch (f.type) {
        case 'file': await upload(page, f.key, v); break;
        case 'text': case 'textarea': case 'number': case 'date': await byId(page, f.key).fill(String(v)); break;
        case 'select': await pickCombo(page, byId(page, f.key), f.options.find(o => o.value === v).label); break;
        case 'multiselect':
          // Short lists render as checkboxes; long ones as a multi-value react-select.
          for (const val of v) {
            const cb = byId(page, `${f.key}_${val}`);
            if (await cb.count()) await cb.check({ force: true });
            else await pickCombo(page, byId(page, f.key), f.options.find(o => o.value === val).label);
          }
          break;
        case 'location': await pickCombo(page, byId(page, 'candidate-location'), /Dublin.*Ireland/i, 'Dublin'); break;
        case 'education':
          // School: the profile's school if the list has it, else "Other". Degree: exact option text.
          if (f.edu === 'school') await pickCombo(page, byId(page, f.key), v).catch(() => pickCombo(page, byId(page, f.key), 'Other'));
          else await pickCombo(page, byId(page, f.key), v, '')
            .catch(() => pickCombo(page, byId(page, f.key), files.degreeFallback || 'Other', ''));
          break;
      }
    } catch (e) { errors.push({ key: f.key, label: f.label, why: 'could not fill: ' + e.message.split('\n')[0].slice(0, 120) }); }
  }
  // GDPR / privacy consent boxes that are not part of the questions API.
  for (const cb of await page.locator('input[type=checkbox][id*="consent"], input[type=checkbox][name*="consent"]').all())
    if (!(await cb.isChecked())) await cb.check().catch(() => {});
  return errors;
}

async function submit(page) {
  await page.getByRole('button', { name: /submit application/i }).click();
  return outcome(page, {
    success: /thank you for applying|application (has been )?(received|submitted)|we('ve| have) received your application/i,
    code: /verification code|security code|code (was |has been )?sent to/i,
    error: p => p.locator('.helper-text--error, [class*="error-message"], [role=alert]').allInnerTexts().then(t => t.map(s => s.trim()).filter(Boolean))
  });
}

module.exports = { schema, fill, submit };
