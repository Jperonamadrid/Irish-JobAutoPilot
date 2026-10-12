// Lever. The apply page is server-rendered; custom questions carry their full definition as
// JSON in a hidden cards[<id>][baseTemplate] input, so the schema comes from plain HTTP.
const { getText, decode } = require('../util');
const { outcome } = require('../browser');

const STANDARD = {
  resume: { role: 'resume', type: 'file', label: 'Resume/CV' }, name: { role: 'fullName', type: 'text', label: 'Full name' },
  email: { role: 'email', type: 'text', label: 'Email' }, phone: { role: 'phone', type: 'text', label: 'Phone' },
  org: { role: 'currentCompany', type: 'text', label: 'Current company' }, location: { role: 'location', type: 'text', label: 'Location' },
  'urls[LinkedIn]': { role: 'linkedin', type: 'text', label: 'LinkedIn URL' }, comments: { role: 'coverLetter', type: 'textarea', label: 'Additional information' }
};
const CARD_TYPES = { text: 'text', textarea: 'textarea', 'multiple-choice': 'select', dropdown: 'select', 'multiple-select': 'multiselect' };

async function schema(job) {
  const html = await getText(job.applyUrl);
  if (!html || !/application-form|resume-upload-input/.test(html)) return null;
  const fields = [], blockers = [];
  for (const [name, s] of Object.entries(STANDARD)) {
    if (!html.includes(`name="${name}"`)) continue;
    const required = new RegExp(`name="${name.replace(/[[\]]/g, '\\$&')}"[^>]*required`).test(html) || name === 'resume' || name === 'name' || name === 'email';
    fields.push({ key: name, ...s, required });
  }
  for (const m of html.matchAll(/value="([^"]*)" name="cards\[([\w-]+)\]\[baseTemplate\]"/g)) {
    let card; try { card = JSON.parse(decode(m[1])); } catch { continue; }
    (card.fields || []).forEach((f, i) => {
      const key = `cards[${m[2]}][field${i}]`, type = CARD_TYPES[f.type];
      if (!type) { if (f.required) blockers.push({ key, label: f.text, why: `unsupported field type ${f.type}` }); return; }
      fields.push({ key, label: f.text, description: f.description || '', required: !!f.required, type,
        options: f.options?.length ? f.options.map(o => ({ label: o.text, value: o.text })) : undefined });
    });
  }
  return { fields, blockers };
}

async function fill(page, job, fields, res, files) {
  await page.goto(job.applyUrl, { waitUntil: 'domcontentloaded', timeout: 45000 });
  await page.locator('#resume-upload-input').waitFor({ state: 'attached', timeout: 30000 });
  const errors = [];
  const el = k => page.locator(`[name="${k}"]`);
  for (const f of fields) {
    // Lever has no cover letter upload; the tailored letter goes in "Additional information".
    const v = f.role === 'coverLetter' ? res.coverLetter : res.values[f.key];
    if (v === undefined || v === '') continue;
    try {
      if (f.key === 'resume') { await page.locator('#resume-upload-input').setInputFiles(v); await page.waitForTimeout(3000); continue; }
      switch (f.type) {
        case 'text': case 'textarea': await el(f.key).first().fill(String(v)); break;
        case 'select':
          if (await page.locator(`select[name="${f.key}"]`).count()) await page.locator(`select[name="${f.key}"]`).selectOption({ label: v });
          else await page.locator(`input[name="${f.key}"][value="${v.replace(/"/g, '\\"')}"]`).check();
          break;
        case 'multiselect': for (const val of v) await page.locator(`input[name="${f.key}"][value="${val.replace(/"/g, '\\"')}"]`).check(); break;
      }
    } catch (e) { errors.push({ key: f.key, label: f.label, why: 'could not fill: ' + e.message.split('\n')[0].slice(0, 120) }); }
  }
  return errors;
}

async function submit(page) {
  await page.locator('#btn-submit, button[type=submit]').first().click();
  return outcome(page, {
    success: /application (was )?submitted|thanks for applying|thank you for applying/i,
    captcha: p => p.locator('iframe[src*="hcaptcha"][title*="challenge" i]').isVisible().catch(() => false),
    error: p => p.locator('.error-message:visible, .application-error:visible').allInnerTexts().catch(() => [])
  });
}

module.exports = { schema, fill, submit };
