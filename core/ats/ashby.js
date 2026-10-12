// Ashby. The public GraphQL endpoint the hosted form uses returns the full field schema.
const { request } = require('../util');
const { pickCombo, outcome } = require('../browser');

const QUERY = `query ApiJobPosting($organizationHostedJobsPageName: String!, $jobPostingId: String!) {
  jobPosting(organizationHostedJobsPageName: $organizationHostedJobsPageName, jobPostingId: $jobPostingId) {
    id title applicationForm { sections { fieldEntries { ... on FormFieldEntry { id field isRequired isHidden } } } } } }`;
const TYPES = { String: 'text', Email: 'text', Phone: 'text', LongText: 'textarea', File: 'file', Boolean: 'boolean',
  ValueSelect: 'select', MultiValueSelect: 'multiselect', Location: 'location', Date: 'date', Number: 'number', SocialLink: 'text' };
const SYSTEM_ROLES = { _systemfield_name: 'fullName', _systemfield_email: 'email', _systemfield_resume: 'resume', _systemfield_location: 'location' };

async function schema(job) {
  const d = await request('https://jobs.ashbyhq.com/api/non-user-graphql?op=ApiJobPosting', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ operationName: 'ApiJobPosting', query: QUERY, variables: { organizationHostedJobsPageName: job.board, jobPostingId: job.atsId } })
  });
  const form = d?.data?.jobPosting?.applicationForm;
  if (!form) return null;
  const fields = [], blockers = [];
  for (const s of form.sections) for (const e of s.fieldEntries) {
    if (!e.field || e.isHidden) continue;
    const f = e.field, type = TYPES[f.type];
    if (!type) { if (e.isRequired) blockers.push({ key: f.path, label: f.title, why: `unsupported field type ${f.type}` }); continue; }
    let role = SYSTEM_ROLES[f.path];
    if (f.type === 'Phone') role = 'phone';
    if (f.type === 'Email') role = 'email';
    if (f.type === 'File' && /cover/i.test(f.title)) role = 'coverLetter';
    if (!role && /linkedin/i.test(f.title) && type === 'text') role = 'linkedin';
    fields.push({ key: f.path, label: f.title, required: !!e.isRequired, type, role,
      options: f.selectableValues?.length ? f.selectableValues.map(o => ({ label: o.label, value: o.label })) : undefined });
  }
  return { fields, blockers };
}

// A field lives either in a div[data-field-path] or, for radio/checkbox groups, a fieldset
// whose first label points at the path.
const box = (page, key) => page.locator(`[data-field-path="${key}"], fieldset:has(label[for="${key}"])`).first();

async function fill(page, job, fields, res, files) {
  await page.goto(job.applyUrl, { waitUntil: 'domcontentloaded', timeout: 45000 });
  await page.locator('#_systemfield_name, [data-field-path]').first().waitFor({ timeout: 30000 });
  const errors = [];
  // Resume first: Ashby parses it and autofills fields, which our values then overwrite.
  const ordered = [...fields].sort((a, b) => (b.role === 'resume') - (a.role === 'resume'));
  for (const f of ordered) {
    const v = f.role === 'coverLetter' ? files.coverLetter : res.values[f.key];
    if (v === undefined || v === '') continue;
    const c = box(page, f.key);
    try {
      switch (f.type) {
        case 'file': await c.locator('input[type=file]').setInputFiles(v); if (f.role === 'resume') await page.waitForTimeout(4000); break;
        case 'text': case 'number': await c.locator('input').first().fill(String(v)); break;
        case 'textarea': await c.locator('textarea').fill(String(v)); break;
        case 'date': { const i = c.locator('input').first(); await i.fill(v.replace(/(\d{4})-(\d\d)-(\d\d)/, '$2/$3/$1')); await i.press('Escape'); break; }
        case 'boolean': await c.locator(`button[data-option="${v ? 'yes' : 'no'}"]`).click(); break;
        case 'select':
          if (await c.locator('input[type=radio]').count()) await c.getByText(v, { exact: true }).click();
          else await pickCombo(page, c.locator('input').first(), v);
          break;
        case 'multiselect': for (const val of v) await c.getByText(val, { exact: true }).click(); break;
        case 'location': {
          // Some boards' geocoder returns nothing for one spelling but works for another.
          const input = c.locator('input[role=combobox]');
          let done = false;
          for (const [want, typed] of [[/Dublin.*Ireland/i, 'Dublin'], [/Dublin/i, 'Dublin, Ireland'], [/Ireland/i, 'Ireland']])
            if (await pickCombo(page, input, want, typed).then(() => true, () => false)) { done = true; break; }
          if (!done) throw new Error('location search returned no results');
          break;
        }
      }
    } catch (e) { errors.push({ key: f.key, label: f.label, why: 'could not fill: ' + e.message.split('\n')[0].slice(0, 120) }); }
  }
  return errors;
}

async function submit(page) {
  await page.getByRole('button', { name: /submit application/i }).click();
  return outcome(page, {
    success: /thank you for (applying|your (application|interest))|application (was |has been )?(successfully )?(submitted|received)/i,
    error: async p => {
      const t = await p.locator('[class*=error], [role=alert]').allInnerTexts().catch(() => []);
      return t.map(s => s.trim()).filter(s => s && !/^\s*$/.test(s));
    }
  });
}

module.exports = { schema, fill, submit };
