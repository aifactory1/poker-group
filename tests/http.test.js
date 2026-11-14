'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

process.env.NODE_ENV = 'test';
process.env.ADMIN_PASSWORD = 'test-password-123';

const setupDir = fs.mkdtempSync(path.join(os.tmpdir(), 'poker-setup-'));
process.env.SETUP_TOKEN_PATH = path.join(setupDir, 'setup-token.json');

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { openDatabase, resetDbHandle } = require('../src/db');
const { seed } = require('../src/seed');
const { openTestDatabase, closeTestDatabase } = require('./db-helper');
const { createApp } = require('../src/app');
const svc = require('../src/services');
const setupToken = require('../src/setup-token');
const auth = require('../src/auth');

let server;
let base;

class Client {
  constructor() { this.cookies = {}; }
  cookieHeader() { return Object.entries(this.cookies).map(([k, v]) => k + '=' + v).join('; '); }
  store(res) {
    const set = res.headers.getSetCookie ? res.headers.getSetCookie() : [];
    for (const c of set) {
      const [pair] = c.split(';');
      const i = pair.indexOf('=');
      this.cookies[pair.slice(0, i)] = pair.slice(i + 1);
    }
  }
  async get(path) {
    const res = await fetch(base + path, { headers: { cookie: this.cookieHeader() }, redirect: 'manual' });
    this.store(res);
    return { res, text: await res.text() };
  }
  async post(path, data) {
    const res = await fetch(base + path, {
      method: 'POST',
      headers: { cookie: this.cookieHeader(), 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(data).toString(),
      redirect: 'manual',
    });
    this.store(res);
    return { res, text: await res.text() };
  }
}

function csrfFrom(html) {
  const m = html.match(/name="_csrf" value="([^"]+)"/);
  assert.ok(m, 'csrf token present');
  return m[1];
}

describe('HTTP flows', () => {
  before(async () => {
    process.env.NODE_ENV = 'test';
    process.env.ADMIN_PASSWORD = 'test-password-123';
    await openTestDatabase();
    // config reads ADMIN_PASSWORD at require time; set it on config too
    require('../src/config').config.adminPassword = 'test-password-123';
    await seed();
    const app = createApp();
    await new Promise((resolve) => { server = app.listen(0, '127.0.0.1', resolve); });
    base = 'http://127.0.0.1:' + server.address().port;
  });

  after(async () => {
    if (server) await new Promise((r) => server.close(r));
    await closeTestDatabase();
  });

  it('redirects admin pages to login when signed out', async () => {
    const c = new Client();
    const { res } = await c.get('/players');
    assert.equal(res.status, 302);
    assert.match(res.headers.get('location'), /^\/login/);
  });

  it('rejects a wrong password and accepts the right one', async () => {
    const c = new Client();
    let page = await c.get('/login');
    let { res } = await c.post('/login', { _csrf: csrfFrom(page.text), email: 'eric@example.com', password: 'nope', next: '/' });
    assert.match(res.headers.get('location'), /^\/login/);

    page = await c.get('/login');
    ({ res } = await c.post('/login', { _csrf: csrfFrom(page.text), email: 'eric@example.com', password: 'test-password-123', next: '/' }));
    assert.equal(res.headers.get('location'), '/');
    const dash = await c.get('/');
    assert.equal(dash.res.status, 200);
    assert.match(dash.text, /Next game/);
    assert.match(dash.text, /Yes \(people, incl\. guests\)/);
  });

  it('admin can add, edit, and delete a player, and skip a Monday', async () => {
    const c = new Client();
    let page = await c.get('/login');
    await c.post('/login', { _csrf: csrfFrom(page.text), email: 'eric@example.com', password: 'test-password-123', next: '/' });

    page = await c.get('/players');
    await c.post('/players', { _csrf: csrfFrom(page.text), name: 'Lee', email: 'lee@example.com', phone: '', active: '1' });
    const lee = await svc.getPlayerByEmail('lee@example.com');
    assert.ok(lee);

    page = await c.get('/players?edit=' + lee.id);
    await c.post('/players/' + lee.id, { _csrf: csrfFrom(page.text), name: 'Lee R.', email: 'lee@example.com', phone: '555-0199', active: '1' });
    assert.equal((await svc.getPlayer(lee.id)).name, 'Lee R.');

    page = await c.get('/players');
    await c.post('/players/' + lee.id + '/delete', { _csrf: csrfFrom(page.text) });
    assert.equal(await svc.getPlayer(lee.id), undefined);

    const game = await svc.nextScheduledGame();
    const [y, m] = game.game_date.split('-');
    page = await c.get('/calendar?year=' + y + '&month=' + Number(m) + '&date=' + game.game_date);
    assert.match(page.text, /Skip selected Monday/);
    await c.post('/calendar/skip', { _csrf: csrfFrom(page.text), date: game.game_date, year: y, month: Number(m) });
    assert.equal((await svc.getGameByDate(game.game_date)).status, 'skipped');
    page = await c.get('/calendar?year=' + y + '&month=' + Number(m) + '&date=' + game.game_date);
    await c.post('/calendar/restore', { _csrf: csrfFrom(page.text), date: game.game_date, year: y, month: Number(m) });
    assert.equal((await svc.getGameByDate(game.game_date)).status, 'scheduled');
  });

  it('player can RSVP via private token with no login and sees only public messages', async () => {
    const c = new Client();
    const chris = await svc.getPlayerByEmail('chris@example.com');
    let page = await c.get('/rsvp/' + chris.rsvp_token);
    assert.equal(page.res.status, 200);
    assert.match(page.text, /Game: /);
    assert.match(page.text, /Time: 7:30 PM–10:00 PM/);
    assert.doesNotMatch(page.text, /Time:[^<]*America\/Phoenix/);

    const { res } = await c.post('/rsvp/' + chris.rsvp_token, {
      _csrf: csrfFrom(page.text),
      status: 'yes',
      party_size: '3',
      message: 'Bringing two',
      message_visibility: 'group',
    });
    assert.equal(res.status, 302);
    const game = await svc.nextScheduledGame();
    const r = await svc.getRsvp(chris.id, game.id);
    assert.equal(r.status, 'yes');
    assert.equal(r.party_size, 3);

    page = await c.get('/rsvp/' + chris.rsvp_token);
    assert.match(page.text, /id="rsvp-status" value="yes"/);

    const whos = await c.get('/rsvp/' + chris.rsvp_token + '/whos');
    assert.match(whos.text, /Bringing two/);
    assert.match(whos.text, /Hosting as usual\./);
    assert.doesNotMatch(whos.text, /Might be late/); // organizer-only
  });

  it('rejects an unknown RSVP token', async () => {
    const c = new Client();
    const { res } = await c.get('/rsvp/not-a-real-token');
    assert.equal(res.status, 404);
  });

  it('sets the Secure cookie flag when the request is HTTPS behind a proxy', async () => {
    const res = await fetch(base + '/login', {
      headers: { 'X-Forwarded-Proto': 'https', 'X-Forwarded-For': '203.0.113.10' },
      redirect: 'manual',
    });
    const set = res.headers.getSetCookie ? res.headers.getSetCookie() : [];
    const sid = set.find((c) => c.startsWith('poker_group.sid='));
    assert.ok(sid, 'session cookie is set');
    assert.match(sid, /Secure/i);
  });

  it('lets the organizer set a password through a one-time setup link', async () => {
    const created = await setupToken.ensureSetupToken({ force: true });
    assert.ok(created.token);
    const token = created.token;
    const c = new Client();

    const missing = await c.get('/setup/not-a-real-token');
    assert.equal(missing.res.status, 404);

    let page = await c.get('/setup/' + token);
    assert.equal(page.res.status, 200);
    assert.match(page.text, /Set your organizer password/);
    assert.match(page.text, /value="eric@example.com"/);

    let { res } = await c.post('/setup/' + token, {
      _csrf: csrfFrom(page.text),
      email: 'eric@example.com',
      password: 'short',
      password_confirm: 'short',
    });
    assert.equal(res.status, 302);
    assert.match(res.headers.get('location'), new RegExp('/setup/' + token));
    page = await c.get('/setup/' + token);
    assert.match(page.text, /at least 8 characters/);

    page = await c.get('/setup/' + token);
    ({ res } = await c.post('/setup/' + token, {
      _csrf: csrfFrom(page.text),
      email: 'not-an-email',
      password: 'good-password-1',
      password_confirm: 'good-password-1',
    }));
    assert.equal(res.status, 302);
    page = await c.get('/setup/' + token);
    assert.match(page.text, /valid email/);

    page = await c.get('/setup/' + token);
    ({ res } = await c.post('/setup/' + token, {
      _csrf: csrfFrom(page.text),
      email: 'eric@example.com',
      password: 'good-password-1',
      password_confirm: 'mismatch-password',
    }));
    assert.equal(res.status, 302);
    page = await c.get('/setup/' + token);
    assert.match(page.text, /do not match/);

    // Token must still be usable after validation failures.
    page = await c.get('/setup/' + token);
    ({ res } = await c.post('/setup/' + token, {
      _csrf: csrfFrom(page.text),
      email: 'eric.organizer@example.com',
      password: 'new-organizer-pass',
      password_confirm: 'new-organizer-pass',
    }));
    assert.equal(res.status, 302);
    assert.equal(res.headers.get('location'), '/');

    const dash = await c.get('/');
    assert.equal(dash.res.status, 200);
    assert.match(dash.text, /Next game/);

    const reused = await c.get('/setup/' + token);
    assert.equal(reused.res.status, 404);
    assert.match(reused.text, /already been used/);

    const admin = await auth.getAdminByEmail('eric.organizer@example.com');
    assert.ok(admin);

    const other = new Client();
    page = await other.get('/login');
    ({ res } = await other.post('/login', {
      _csrf: csrfFrom(page.text),
      email: 'eric.organizer@example.com',
      password: 'new-organizer-pass',
      next: '/',
    }));
    assert.equal(res.headers.get('location'), '/');
  });
});
