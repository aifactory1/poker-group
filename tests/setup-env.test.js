'use strict';

// Hosted bootstrap: no organizer password; SETUP_TOKEN env enables a one-time /setup link.
process.env.NODE_ENV = 'test';
delete process.env.ADMIN_PASSWORD;
process.env.SETUP_TOKEN = 'test-setup-token-' + 'x'.repeat(40);

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { seed } = require('../src/seed');
const { createApp } = require('../src/app');
const setupToken = require('../src/setup-token');
const { getDb } = require('../src/db');
const { openTestDatabase, closeTestDatabase } = require('./db-helper');

let server;
let base;
const TOKEN = process.env.SETUP_TOKEN;

async function req(path, { method = 'GET', body, cookie } = {}) {
  const res = await fetch(base + path, {
    method,
    headers: { cookie: cookie || '', 'content-type': 'application/x-www-form-urlencoded' },
    body: body ? new URLSearchParams(body).toString() : undefined,
    redirect: 'manual',
  });
  const set = res.headers.getSetCookie();
  return { res, text: await res.text(), cookie: set.length ? set[0].split(';')[0] : cookie };
}

describe('hosted setup via SETUP_TOKEN', () => {
  before(async () => {
    require('../src/config').config.adminPassword = '';
    await openTestDatabase();
    const result = await seed();
    assert.equal(result.admin.created, false);
    assert.equal(result.admin.deferredToSetup, true);
    const app = createApp();
    await new Promise((resolve) => { server = app.listen(0, '127.0.0.1', resolve); });
    base = 'http://127.0.0.1:' + server.address().port;
  });

  after(async () => {
    if (server) await new Promise((r) => server.close(r));
    await closeTestDatabase();
  });

  it('seeds players and RSVPs but no organizer account', async () => {
    const admins = await getDb().get('SELECT COUNT(*) AS n FROM admin_users');
    assert.equal(Number(admins.n), 0);
    const players = await getDb().get('SELECT COUNT(*) AS n FROM players');
    assert.ok(Number(players.n) >= 7);
    const rsvps = await getDb().get('SELECT COUNT(*) AS n FROM rsvps');
    assert.ok(Number(rsvps.n) >= 5);
  });

  it('rejects short tokens and enables a valid env token once', async () => {
    assert.equal((await setupToken.ensureEnvSetupToken('short')).enabled, false);
    const first = await setupToken.ensureEnvSetupToken(TOKEN);
    assert.equal(first.enabled, true);
    assert.equal(first.created, true);
    const again = await setupToken.ensureEnvSetupToken(TOKEN);
    assert.equal(again.enabled, true);
    assert.equal(again.created, false);
  });

  it('creates the organizer through the link, then the link is dead even after a "restart"', async () => {
    let page = await req('/setup/' + TOKEN);
    assert.equal(page.res.status, 200);
    const csrf = page.text.match(/name="_csrf" value="([^"]+)"/)[1];
    const post = await req('/setup/' + TOKEN, {
      method: 'POST',
      cookie: page.cookie,
      body: { _csrf: csrf, email: 'organizer@example.com', password: 'long-enough-pw', password_confirm: 'long-enough-pw' },
    });
    assert.equal(post.res.status, 302);
    assert.equal(post.res.headers.get('location'), '/');

    const reused = await req('/setup/' + TOKEN);
    assert.equal(reused.res.status, 404);

    // Simulate a restart: the env var is still present but the organizer exists and the token is used.
    const restart = await setupToken.ensureEnvSetupToken(TOKEN);
    assert.equal(restart.enabled, false);
    assert.equal((await req('/setup/' + TOKEN)).res.status, 404);

    const login = await req('/login');
    const lc = login.text.match(/name="_csrf" value="([^"]+)"/)[1];
    const ok = await req('/login', {
      method: 'POST',
      cookie: login.cookie,
      body: { _csrf: lc, email: 'organizer@example.com', password: 'long-enough-pw', next: '/' },
    });
    assert.equal(ok.res.headers.get('location'), '/');
  });
});
