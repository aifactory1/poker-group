'use strict';

/**
 * Headless Chrome screenshots of the local app.
 * Usage: node scripts/screenshots.js
 * Expects the server to be running (or starts it) and reads the admin
 * password from data/admin-credentials.txt.
 */

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { pathToFileURL } = require('url');

const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'screenshots');
const BASE = process.env.BASE_URL || 'http://127.0.0.1:3000';

function readPassword() {
  const file = path.join(ROOT, 'data', 'admin-credentials.txt');
  const text = fs.readFileSync(file, 'utf8');
  const m = text.match(/^password:\s*(.+)$/m);
  if (!m) throw new Error('Could not read password from ' + file);
  return m[1].trim();
}

async function waitForHealth(timeoutMs = 20000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(BASE + '/health');
      if (res.ok) return;
    } catch {}
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error('Server did not become ready at ' + BASE);
}

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  const puppeteer = await import('puppeteer-core');
  const email = 'eric@example.com';
  const password = readPassword();

  const browser = await puppeteer.default.launch({
    executablePath: process.env.CHROME_PATH || '/usr/bin/google-chrome-stable',
    headless: true,
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--window-size=390,844'],
    defaultViewport: { width: 390, height: 844, deviceScaleFactor: 2 },
  });

  const page = await browser.newPage();

  async function shot(name) {
    const dest = path.join(OUT, name + '.png');
    await page.screenshot({ path: dest, fullPage: true });
    console.log('wrote', dest);
  }

  await page.goto(BASE + '/login', { waitUntil: 'networkidle0' });
  await shot('01-login');

  await page.type('input[name="email"]', '', { delay: 0 });
  await page.evaluate(() => { document.querySelector('input[name="email"]').value = ''; });
  await page.type('input[name="email"]', email);
  await page.type('input[name="password"]', password);
  await Promise.all([
    page.waitForNavigation({ waitUntil: 'networkidle0' }),
    page.click('button[type="submit"]'),
  ]);
  await shot('02-dashboard');

  await page.goto(BASE + '/players', { waitUntil: 'networkidle0' });
  await shot('03-players');

  await page.goto(BASE + '/calendar', { waitUntil: 'networkidle0' });
  await shot('04-calendar');

  const firstMonday = await page.$('a.cal-day.monday-game, a.cal-day.holiday, a.cal-day.exception');
  if (firstMonday) {
    await Promise.all([
      page.waitForNavigation({ waitUntil: 'networkidle0' }),
      firstMonday.click(),
    ]);
    await shot('05-calendar-selected');
  }

  await page.goto(BASE + '/settings', { waitUntil: 'networkidle0' });
  await shot('06-settings');

  // Private RSVP as Mike
  const html = await page.content();
  // Get Mike's token from the players page
  await page.goto(BASE + '/players', { waitUntil: 'networkidle0' });
  const mikeUrl = await page.evaluate(() => {
    const links = [...document.querySelectorAll('a')];
    const row = [...document.querySelectorAll('tr')].find((r) => r.textContent.includes('mike@example.com'));
    const a = row && row.querySelector('a[href*="/rsvp/"]');
    return a ? a.getAttribute('href') : null;
  });
  if (!mikeUrl) throw new Error('Could not find Mike RSVP link');
  await page.goto(mikeUrl.startsWith('http') ? mikeUrl : BASE + mikeUrl.replace(/^http:\/\/localhost:3000/, ''), { waitUntil: 'networkidle0' });
  await shot('07-rsvp');

  await page.click('[data-rsvp="maybe"]');
  await new Promise((r) => setTimeout(r, 200));
  await shot('08-rsvp-maybe-selected');
  await page.click('[data-rsvp="yes"]');
  await new Promise((r) => setTimeout(r, 200));
  await shot('09-rsvp-yes-selected');

  const token = (mikeUrl.split('/rsvp/')[1] || '').split('/')[0];
  await page.goto(BASE + '/rsvp/' + token + '/whos', { waitUntil: 'networkidle0' });
  await shot('10-whos-playing');

  await page.goto(BASE + '/announce', { waitUntil: 'networkidle0' });
  await shot('11-announce');

  // Desktop-width dashboard
  await page.setViewport({ width: 1100, height: 800, deviceScaleFactor: 1 });
  await page.goto(BASE + '/', { waitUntil: 'networkidle0' });
  await shot('12-dashboard-desktop');

  await browser.close();
  void html;
}

if (require.main === module) {
  waitForHealth()
    .then(main)
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}

module.exports = { main, waitForHealth };
