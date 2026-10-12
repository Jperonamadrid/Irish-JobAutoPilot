const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const { ROOT, sleep } = require('./util');

// A visible browser needs a desktop session. On Linux without one, run headless instead of crashing.
const canShowWindow = () => process.platform !== 'linux' || !!process.env.DISPLAY || !!process.env.WAYLAND_DISPLAY;

// Persistent browser for one profile directory (each person has their own, so their site logins
// stay separate). Real Chrome scores better on reCAPTCHA than the bundled Chromium; fall back to
// Chromium when Chrome is not installed.
async function launch(userDataDir, { headless = false } = {}) {
  const opts = { headless: headless || !canShowWindow(), viewport: { width: 1280, height: 900 }, acceptDownloads: false };
  fs.mkdirSync(userDataDir, { recursive: true });
  try { return await chromium.launchPersistentContext(userDataDir, { ...opts, channel: 'chrome' }); }
  catch (e) {
    if (/ProcessSingleton|already in use/i.test(e.message)) throw new Error('That browser profile is already open in another window. Close it and try again.');
    return chromium.launchPersistentContext(userDataDir, opts);
  }
}

// Pick an option in a searchable combobox (react-select, Ashby, location autocompletes).
// `want` is an exact label string or a RegExp. Types `typed` (defaults to the label) to filter.
async function pickCombo(page, input, want, typed) {
  await input.click();
  await input.fill('');
  await input.pressSequentially(String(typed ?? want).slice(0, 40), { delay: 15 });
  const options = page.getByRole('option');
  await options.first().waitFor({ timeout: 8000 });
  const exact = typeof want === 'string' ? page.getByRole('option', { name: want, exact: true }) : options.filter({ hasText: want });
  if (await exact.count()) return exact.first().click();
  if (typeof want === 'string') {
    const loose = options.filter({ hasText: want.slice(0, 30) });
    if (await loose.count()) return loose.first().click();
  }
  throw new Error(`option not found: ${want}`);
}

// After clicking submit, poll the page until it shows success, a verification step, or errors.
async function outcome(page, { success, code, error, captcha }, ms = 30000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    await sleep(1000);
    const url = page.url();
    const text = await page.locator('body').innerText({ timeout: 3000 }).catch(() => '');
    if (/confirmation|thank|success/i.test(url) || success.test(text)) return { status: 'submitted' };
    if (code && code.test(text)) return { status: 'needs_input', detail: 'the site emailed a verification code to finish submitting' };
    if (captcha && await captcha(page)) return { status: 'needs_input', detail: 'CAPTCHA challenge on submit' };
    if (error) {
      const errs = await error(page);
      if (errs.length) return { status: 'invalid', detail: errs.slice(0, 5).join('; ') };
    }
  }
  return { status: 'unknown', detail: 'no confirmation seen within 30s' };
}

// Headless browser used only to print HTML to PDF (CVs and cover letters), with the bundled font.
let pdfBrowser;
const FONT_DIR = path.join(ROOT, 'assets', 'fonts');
const fontCss = () => ['Regular', 'Bold', 'Italic', 'BoldItalic'].map(v => {
  const b64 = fs.readFileSync(path.join(FONT_DIR, `Carlito-${v}.ttf`)).toString('base64');
  return `@font-face{font-family:'Carlito';src:url(data:font/ttf;base64,${b64});font-weight:${/Bold/.test(v) ? 700 : 400};font-style:${/Italic/.test(v) ? 'italic' : 'normal'}}`;
}).join('');
async function htmlToPdf(html, file, { margin = '18mm' } = {}) {
  pdfBrowser ||= await chromium.launch({ headless: true });
  const page = await pdfBrowser.newPage();
  try {
    await page.setContent(`<!doctype html><html><head><meta charset="utf-8"><style>${fontCss()}</style></head><body>${html}</body></html>`, { waitUntil: 'load' });
    fs.mkdirSync(path.dirname(file), { recursive: true });
    await page.pdf({ path: file, format: 'A4', printBackground: true, margin: { top: margin, bottom: margin, left: margin, right: margin } });
  } finally { await page.close(); }
  return file;
}
async function closePdf() { if (pdfBrowser) await pdfBrowser.close().catch(() => {}); pdfBrowser = null; }

const esc = s => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
async function letterPdf(file, text) {
  const body = `<div style="font:11pt/1.5 Carlito,Calibri,sans-serif">${text.split(/\n\s*\n/).map(p => `<p>${esc(p).replace(/\n/g, '<br>')}</p>`).join('')}</div>`;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file.replace(/\.pdf$/, '.txt'), text);
  return htmlToPdf(body, file, { margin: '25mm' });
}

module.exports = { launch, pickCombo, outcome, htmlToPdf, letterPdf, closePdf, canShowWindow, esc };
