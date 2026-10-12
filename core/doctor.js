// Checks everything the app needs, with a plain-English fix for each problem.
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const { ROOT, USERS_DIR } = require('./util');
const { chromePath } = require('./login');
const { canShowWindow } = require('./browser');

async function doctor({ skipAi = false } = {}) {
  const out = [];
  const add = (name, ok, detail, warn = false) => out.push({ name, ok, detail, warn });
  const major = +process.versions.node.split('.')[0];
  add('Node.js', major >= 20, major >= 20 ? process.versions.node : `version ${process.versions.node} is too old; install Node 20 or newer`);
  try { fs.mkdirSync(USERS_DIR, { recursive: true }); fs.accessSync(USERS_DIR, fs.constants.W_OK); add('Data folder', true, USERS_DIR); }
  catch { add('Data folder', false, `cannot write to ${USERS_DIR}`); }
  const fonts = ['Regular', 'Bold', 'Italic', 'BoldItalic'].every(v => fs.existsSync(path.join(ROOT, 'assets', 'fonts', `Carlito-${v}.ttf`)));
  add('CV font', fonts, fonts ? 'bundled' : 'assets/fonts is incomplete; re-download the app');
  try { const b = await chromium.launch({ headless: true }); await b.close(); add('PDF engine (Chromium)', true, 'installed'); }
  catch { add('PDF engine (Chromium)', false, 'run: npx playwright install chromium'); }
  const chrome = chromePath();
  add('Google Chrome', !!chrome, chrome || 'not found: install Chrome for site logins (applications still work with Chromium)', !chrome);
  add('Desktop session', canShowWindow(), canShowWindow() ? 'browser windows can be shown' : 'no display: forms are filled headless and review needs a desktop', !canShowWindow());
  if (!skipAi) { const c = await require('./llm').check(); add('Claude Code', c.ok, c.detail); }
  return out;
}

module.exports = { doctor };
