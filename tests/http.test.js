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
    const skipped = await c.post('/calendar/skip', { _csrf: csrfFrom(page.text), date: game.game_date, year: y, month: Number(m) });
    assert.match(skipped.res.headers.get('location') || '', /#calendar/);
    assert.doesNotMatch(skipped.res.headers.get('location') || '', /[?&]date=/);
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

  it('calendar, RSVP, and player pages reflect organizer phone-testing fixes', async () => {
    const c = new Client();
    let page = await c.get('/login');
    await c.post('/login', { _csrf: csrfFrom(page.text), email: 'eric@example.com', password: 'test-password-123', next: '/' });

    const header = await c.get('/');
    assert.doesNotMatch(header.text, /Nickel-dime Mondays/);

    const players = await c.get('/players');
    assert.doesNotMatch(players.text, />New link</);
    assert.doesNotMatch(players.text, />RSVP link</);
    assert.match(players.text, /href="\/players\?edit=\d+#player-form"/);
    assert.match(players.text, /Temporary organizer/);

    const mike = await svc.getPlayerByEmail('mike@example.com');
    const edit = await c.get('/players?edit=' + mike.id);
    assert.match(edit.text, /Only needed if a link was forwarded or shared/);
    assert.match(edit.text, /Create a new RSVP link/);
    assert.match(edit.text, /Copy RSVP link/);

    assert.doesNotMatch(header.text, /Run auto-cancel check now/);
    assert.match(header.text, /Cancel this game/);
    const settingsPage = await c.get('/settings');
    assert.match(settingsPage.text, /Testing tools/);
    assert.match(settingsPage.text, /Test: run the 4 PM auto-cancel check now/);
    assert.match(settingsPage.text, /Default venue/);

    const cal = await c.get('/calendar?year=2026&month=9');
    assert.equal(cal.res.status, 200);
    assert.match(cal.text, /Yom Kippur/);

    const oldCal = await c.get('/calendar?year=2020&month=1');
    assert.match(oldCal.text, /class="[^"]*\bpast\b/);
    assert.doesNotMatch(oldCal.text, /href="\/calendar\?year=2020&amp;month=1&amp;date=2020-01-06#cal-details"/);

    const far = await c.get('/calendar?year=2027&month=12');
    assert.match(far.text, /#cal-details/);
    assert.match(far.text, /Hanukkah/);
    const selected = await c.get('/calendar?year=2027&month=12&date=2027-12-24#cal-details');
    assert.match(selected.text, /id="cal-details"/);
    assert.match(selected.text, /Hanukkah \(first night\)/);
    assert.match(selected.text, /Selected:/);

    const chris = await svc.getPlayerByEmail('chris@example.com');
    const rsvpAsAdmin = await c.get('/rsvp/' + chris.rsvp_token);
    assert.match(rsvpAsAdmin.text, /<title>RSVP — Poker Group<\/title>/);
    assert.doesNotMatch(rsvpAsAdmin.text, /RSVP — Poker Group — Poker Group/);
    assert.match(rsvpAsAdmin.text, /Back to dashboard/);

    const guest = new Client();
    const rsvpAsPlayer = await guest.get('/rsvp/' + chris.rsvp_token);
    assert.match(rsvpAsPlayer.text, /<title>RSVP — Poker Group<\/title>/);
    assert.doesNotMatch(rsvpAsPlayer.text, /Back to dashboard/);
    assert.doesNotMatch(rsvpAsPlayer.text, /Nickel-dime Mondays/);
  });


  it('lets the organizer override an RSVP, cancel a game, and reinstate it', async () => {
    const c = new Client();
    let page = await c.get('/login');
    await c.post('/login', { _csrf: csrfFrom(page.text), email: 'eric@example.com', password: 'test-password-123', next: '/' });

    page = await c.get('/settings');
    await c.post('/settings', {
      _csrf: csrfFrom(page.text),
      group_name: 'Poker Group',
      invite_weekday: '5',
      invite_time: '10:00',
      remind_weekday: '0',
      remind_time: '10:00',
      auto_cancel_enabled: '1',
      cutoff_time: '16:00',
      minimum_yes: '5',
      default_start_time: '19:00',
      default_end_time: '22:00',
      default_venue: "Eric's house",
    });

    const sam = await svc.getPlayerByEmail('sam@example.com');
    page = await c.get('/');
    assert.match(page.text, /Eric&#39;s house|Eric's house/);
    assert.match(page.text, /<th scope="col">Player</);
    assert.match(page.text, /<th scope="col">RSVP</);
    assert.match(page.text, /<th scope="col">Party size</);
    assert.match(page.text, /<th scope="col">Message</);
    assert.match(page.text, /class="rsvp-cell-btn/);
    assert.match(page.text, /id="rsvp-editor"/);
    assert.doesNotMatch(page.text, /class="rsvp-override"/);
    assert.doesNotMatch(page.text, /Update RSVP/);
    assert.match(page.text, new RegExp('data-player-id="' + sam.id + '"'));
    const override = await c.post('/dashboard/rsvp/' + sam.id, {
      _csrf: csrfFrom(page.text),
      status: 'yes',
      party_size: '2',
    });
    assert.equal(override.res.status, 302);
    assert.match(override.res.headers.get('location') || '', /#attendees/);
    page = await c.get('/');
    assert.match(page.text, /set by Eric/);
    assert.match(page.text, /class="rsvp-cell-btn is-yes"/);

    const guest = new Client();
    const denied = await guest.post('/dashboard/rsvp/' + sam.id, { _csrf: 'nope', status: 'no', party_size: '1' });
    assert.equal(denied.res.status, 302);
    assert.match(denied.res.headers.get('location') || '', /\/login/);

    page = await c.get('/');
    const cancel = await c.post('/dashboard/cancel', { _csrf: csrfFrom(page.text), reason: 'Only two can make it' });
    assert.equal(cancel.res.status, 302);
    page = await c.get('/');
    assert.match(page.text, /Cancelled/);
    assert.match(page.text, /Reinstate game/);
    assert.doesNotMatch(page.text, /id="cancel-game-btn"/);
    assert.doesNotMatch(page.text, /class="rsvp-cell-btn/);
    assert.doesNotMatch(page.text, /id="rsvp-editor"/);

    const token = sam.rsvp_token;
    const rsvp = await guest.get('/rsvp/' + token);
    assert.match(rsvp.text, /Cancelled/);
    assert.match(rsvp.text, /Only two can make it/);
    assert.doesNotMatch(rsvp.text, /id="rsvp-form"/);
    const whos = await guest.get('/rsvp/' + token + '/whos');
    assert.match(whos.text, /Cancelled/);
    assert.match(whos.text, /Eric&#39;s house|Eric's house/);

    page = await c.get('/');
    const reinstate = await c.post('/dashboard/reinstate', { _csrf: csrfFrom(page.text) });
    assert.equal(reinstate.res.status, 302);
    page = await c.get('/');
    assert.match(page.text, /Cancel this game/);
    assert.doesNotMatch(page.text, /Reinstate game/);
    const rsvpAfter = await guest.get('/rsvp/' + token);
    assert.doesNotMatch(rsvpAfter.text, />Cancelled</);
    assert.match(rsvpAfter.text, /id="rsvp-form"/);
  });

  it('lets a temporary organizer change RSVPs and cancel, but not settings or players', async () => {
    const owner = new Client();
    let page = await owner.get('/login');
    await owner.post('/login', { _csrf: csrfFrom(page.text), email: 'eric@example.com', password: 'test-password-123', next: '/' });

    const dave = await svc.getPlayerByEmail('dave@example.com');
    page = await owner.get('/players');
    const granted = await owner.post('/players/grant-organizer', {
      _csrf: csrfFrom(page.text),
      grant_player_id: String(dave.id),
      starts_on: '2026-11-14',
      ends_on: '2026-11-17',
    });
    assert.equal(granted.res.status, 302);
    page = await owner.get('/players');
    assert.match(page.text, /One-time setup link for Dave/);
    const link = page.text.match(/data-copy="([^"]+\/setup\/[^"]+)"/);
    assert.ok(link, 'setup link is shown');
    const setupUrl = link[1].replace(/&amp;/g, '&');
    const setupPath = setupUrl.slice(setupUrl.indexOf('/setup/'));

    const temp = new Client();
    page = await temp.get(setupPath);
    assert.match(page.text, /temporary organizer password/i);
    let { res } = await temp.post(setupPath, {
      _csrf: csrfFrom(page.text),
      email: 'dave@example.com',
      password: 'temp-dave-pass1',
      password_confirm: 'temp-dave-pass1',
    });
    assert.equal(res.status, 302);
    assert.equal(res.headers.get('location'), '/');

    page = await temp.get('/');
    assert.equal(page.res.status, 200);
    assert.match(page.text, /Temporary organizer: <strong>Dave<\/strong>/);
    assert.doesNotMatch(page.text, />Settings</);

    const settings = await temp.get('/settings');
    assert.equal(settings.res.status, 403);

    const mike = await svc.getPlayerByEmail('mike@example.com');
    page = await temp.get('/players');
    assert.doesNotMatch(page.text, />Delete</);
    const del = await temp.post('/players/' + mike.id + '/delete', { _csrf: csrfFrom(page.text) });
    assert.equal(del.res.status, 403);
    assert.ok(await svc.getPlayer(mike.id));

    const sam = await svc.getPlayerByEmail('sam@example.com');
    page = await temp.get('/');
    assert.match(page.text, /class="rsvp-cell-btn/);
    const override = await temp.post('/dashboard/rsvp/' + sam.id, {
      _csrf: csrfFrom(page.text),
      status: 'maybe',
      party_size: '1',
    });
    assert.equal(override.res.status, 302);
    page = await temp.get('/');
    assert.match(page.text, /set by Dave/);

    const cancel = await temp.post('/dashboard/cancel', { _csrf: csrfFrom(page.text), reason: 'Need a new venue' });
    assert.equal(cancel.res.status, 302);
    page = await temp.get('/');
    assert.match(page.text, /Reinstate game/);
    await temp.post('/dashboard/reinstate', { _csrf: csrfFrom(page.text) });

    const game = await svc.nextScheduledGame();
    const [y, m] = game.game_date.split('-');
    page = await temp.get('/calendar?year=' + y + '&month=' + Number(m) + '&date=' + game.game_date);
    const times = await temp.post('/calendar/times', {
      _csrf: csrfFrom(page.text),
      date: game.game_date,
      year: y,
      month: Number(m),
      night_start: '18:30',
      night_end: '22:30',
      venue: "Dave's house",
    });
    assert.equal(times.res.status, 302);
    assert.equal((await svc.getGameByDate(game.game_date)).venue, "Dave's house");

    page = await owner.get('/players');
    const grantRow = (await svc.listGrants()).find((g) => g.player_name === 'Dave' && (g.status === 'active' || g.status === 'upcoming'));
    assert.ok(grantRow);
    await owner.post('/players/grants/' + grantRow.id + '/revoke', { _csrf: csrfFrom(page.text) });
    const after = new Client();
    page = await after.get('/login');
    ({ res } = await after.post('/login', {
      _csrf: csrfFrom(page.text),
      email: 'dave@example.com',
      password: 'temp-dave-pass1',
      next: '/',
    }));
    assert.equal(res.status, 302);
    assert.match(res.headers.get('location') || '', /\/login/);
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
