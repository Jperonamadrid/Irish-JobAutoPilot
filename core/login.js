// Opens a normal Chrome window (no automation flags: sites such as IrishJobs refuse logins from
// automated browsers) on this person's own browser profile, so they can sign in to job sites by
// hand. Passwords are typed by the person and never seen or stored by the app; only the site's
// login cookie stays in the profile. --password-store=basic matches Playwright, otherwise the
// cookies are encrypted with the desktop keyring and the automation cannot read them.
const fs = require('fs');
const { spawn } = require('child_process');
const { log } = require('./util');

const SITES = ['https://www.irishjobs.ie/en-GB/candidate/login', 'https://www.jobs.ie/en-GB/candidate/login', 'https://www.linkedin.com/login'];

function chromePath() {
  const candidates = {
    linux: ['/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/opt/google/chrome/chrome'],
    darwin: ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'],
    win32: [`${process.env.PROGRAMFILES}\\Google\\Chrome\\Application\\chrome.exe`, `${process.env['PROGRAMFILES(X86)']}\\Google\\Chrome\\Application\\chrome.exe`,
      `${process.env.LOCALAPPDATA}\\Google\\Chrome\\Application\\chrome.exe`]
  }[process.platform] || [];
  return candidates.find(p => p && fs.existsSync(p));
}

async function login(user, urls = []) {
  const chrome = chromePath();
  if (!chrome) throw new Error('Google Chrome is needed to sign in to job sites. Install it from https://www.google.com/chrome/');
  fs.mkdirSync(user.paths.browser, { recursive: true });
  log('A Chrome window is opening. Sign in on each tab (tick "Stay logged in"), then close the window.');
  const p = spawn(chrome, [`--user-data-dir=${user.paths.browser}`, '--password-store=basic', '--no-first-run', '--new-window', ...(urls.length ? urls : SITES)], { stdio: 'ignore' });
  await new Promise((resolve, reject) => { p.on('exit', resolve); p.on('error', reject); });
  log('Chrome closed. Your sign-ins are saved for future runs.');
}

module.exports = { login, chromePath };
