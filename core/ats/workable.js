// Workable. Form schema from apply.workable.com/api/v1/jobs/<shortcode>/form; field ids are the
// DOM ids/names on apply.workable.com/<account>/j/<shortcode>/apply/.
const { getJson } = require('../util');
const { pickCombo, outcome } = require('../browser');

const ROLES = { firstname: 'firstName', lastname: 'lastName', email: 'email', phone: 'phone', resume: 'resume', address: 'location', cover_letter: 'coverLetter' };
const TYPES = { text: 'text', email: 'text', phone: 'text', paragraph: 'textarea', file: 'file', dropdown: 'select', boolean: 'boolean', date: 'date', number: 'number' };

async function schema(job) {
  const d = await getJson(`https://apply.workable.com/api/v1/jobs/${job.atsId}/form`);
  if (!Array.isArray(d)) return null;
  const fields = [], blockers = [];
  for (const sec of d) for (const f of sec.fields || []) {
    if (['avatar', 'headline'].includes(f.id)) continue;
    if (f.id === 'gdpr') continue;   // consent box, ticked in fill()
    if (f.type === 'group') { if (f.required) blockers.push({ key: f.id, label: f.label || f.id, why: 'required experience/education section' }); continue; }
    let type = TYPES[f.type];
    if (f.type === 'multiple') type = f.singleOption ? 'radio' : 'checkboxes';
    if (!type) { if (f.required) blockers.push({ key: f.id, label: f.label, why: `unsupported field type ${f.type}` }); continue; }
    const role = ROLES[f.id] || (f.id === 'summary' ? 'summary' : /linkedin/i.test(f.label) && type === 'text' ? 'linkedin' : undefined);
    fields.push({ key: f.id, label: (f.label || f.description || f.id).replace(/<[^>]+>/g, '').trim(), description: f.helper || '', required: !!f.required,
      type: type === 'radio' ? 'select' : type === 'checkboxes' ? 'multiselect' : type, widget: f.type === 'phone' ? 'phone' : type, role,
      options: f.options?.length ? f.options.map(o => ({ label: String(o.value).trim(), value: String(o.value).trim() })) : undefined });
  }
  return { fields, blockers };
}

const esc = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// Radio/checkbox option: <input id=ID name=KEY> inside <div id=wrapper_ID role=radio>, text in #radio_label_ID
// (or checkbox_label_ID). Find the ID whose label text matches, then click its wrapper.
async function clickChoice(page, key, text) {
  const id = await page.evaluate(([key, text]) => {
    for (const i of document.querySelectorAll(`input[name="${key}"]`)) {
      const l = document.getElementById('radio_label_' + i.id) || document.getElementById('checkbox_label_' + i.id);
      if (l && l.textContent.trim() === text) return i.id;
    }
  }, [key, text]);
  if (!id) throw new Error(`option not found: ${text}`);
  await page.locator(`[id="wrapper_${id}"], [id="${id}"]`).first().click({ force: true });
}

async function fill(page, job, fields, res, files) {
  await page.goto(job.applyUrl, { waitUntil: 'domcontentloaded', timeout: 45000 });
  await page.locator('#firstname').waitFor({ timeout: 30000 });
  // The cookie dialog appears a moment after load and blocks every click until dismissed.
  const decline = page.locator('[data-ui="cookie-consent-decline"]');
  if (await decline.waitFor({ timeout: 8000 }).then(() => true, () => false)) { await decline.click(); await decline.waitFor({ state: 'hidden', timeout: 5000 }).catch(() => {}); }
  const errors = [];
  const ordered = [...fields].sort((a, b) => (b.role === 'resume') - (a.role === 'resume'));
  for (const f of ordered) {
    const v = f.role === 'coverLetter' ? res.coverLetter : res.values[f.key];
    if (v === undefined || v === '') continue;
    try {
      switch (f.widget) {
        case 'file': await page.locator(`input[type=file][data-ui="${f.key}"]`).setInputFiles(v); await page.waitForTimeout(3000); break;
        case 'phone': await page.locator('input[name="phone"]').fill(String(v)); break;
        case 'text': case 'number': case 'date': await page.locator(`[id="${f.key}"]`).fill(String(v)); break;
        case 'textarea': await page.locator(`textarea[id="${f.key}"]`).fill(String(v)); break;
        case 'select':   // read-only combobox: open it, then click the option in its listbox
          await page.locator(`[id="input_${f.key}_input"]`).click();
          await page.locator(`[id="input_${f.key}_listbox"]`).getByRole('option', { name: v, exact: true }).click();
          break;
        case 'radio': await clickChoice(page, f.key, v); break;
        case 'checkboxes': for (const val of v) await clickChoice(page, f.key, val); break;
        case 'boolean': if (v) await page.locator(`[role=checkbox]:has(input[name="${f.key}"])`).first().click(); break;
      }
    } catch (e) { errors.push({ key: f.key, label: f.label, why: 'could not fill: ' + e.message.split('\n')[0].slice(0, 120) }); }
  }
  // GDPR consent checkbox (the candidate accepts privacy notices; see answers.json).
  const gdpr = page.locator('label:has(input[name="gdpr"])');
  if (await gdpr.count() && !(await page.locator('input[name="gdpr"]').isChecked())) await gdpr.first().click().catch(() => {});
  return errors;
}

async function submit(page) {
  await page.locator('[data-ui="apply-button"]').click();
  return outcome(page, {
    success: /application (has been )?(submitted|sent|received)|thank you for (applying|your application)/i,
    error: p => p.locator('[data-ui$="error"], [role=alert]').allInnerTexts().then(t => t.map(s => s.trim()).filter(Boolean))
  });
}

module.exports = { schema, fill, submit };
