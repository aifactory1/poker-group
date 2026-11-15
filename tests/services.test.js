'use strict';

process.env.NODE_ENV = 'test';
process.env.ADMIN_PASSWORD = 'test-password-123';


const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { openDatabase, resetDbHandle, getDb } = require('../src/db');
const { seed } = require('../src/seed');
const { openTestDatabase, closeTestDatabase } = require('./db-helper');
const svc = require('../src/services');
const { holidayOnDate } = require('../src/holidays');

describe('services: players, calendar, RSVP, tallies', () => {
  before(async () => {
    process.env.NODE_ENV = 'test';
    process.env.ADMIN_PASSWORD = 'test-password-123';
    await openTestDatabase();
    await seed();
  });

  after(async () => {
    await closeTestDatabase();
  });

  it('seeds sample players and an organizer', async () => {
    const players = await svc.listPlayers();
    assert.ok(players.length >= 7);
    assert.ok(players.every((p) => p.email.endsWith('@example.com')));
    assert.ok(players.every((p) => p.rsvp_token));
    const admin = await getDb().get('SELECT * FROM admin_users WHERE email = ?', ['eric@example.com']);
    assert.ok(admin);
    assert.ok(admin.password_hash.startsWith('$2'));
  });

  it('supports player CRUD', async () => {
    const created = await svc.createPlayer({ name: 'Pat', email: 'pat@example.com', phone: '555-0100' });
    assert.equal(created.name, 'Pat');
    const updated = await svc.updatePlayer(created.id, { name: 'Patricia', email: 'pat@example.com', phone: '555-0101', active: true });
    assert.equal(updated.name, 'Patricia');
    await svc.deletePlayer(created.id);
    assert.equal(await svc.getPlayer(created.id), undefined);
  });

  it('rejects duplicate emails', async () => {
    await assert.rejects(() => svc.createPlayer({ name: 'Dup', email: 'eric@example.com' }), /already exists/);
  });

  it('skips and restores a Monday and auto-skips computed holidays', async () => {
    const game = await svc.nextScheduledGame();
    assert.ok(game);
    assert.equal(game.status, 'scheduled');

    const skipped = await svc.skipGame(game.game_date, 'Organizer skipped');
    assert.equal(skipped.status, 'skipped');
    const restored = await svc.restoreGame(game.game_date);
    assert.equal(restored.status, 'scheduled');
    assert.equal(restored.skip_reason, null);

    const mlk = '2026-01-19';
    const night = await svc.ensureGameNight(mlk);
    assert.equal(night.status, 'skipped');
    assert.match(night.skip_reason, /Martin Luther King/);
    assert.ok(holidayOnDate(mlk));

    const yomKippur = '2026-09-21'; // Monday
    const ykNight = await svc.ensureGameNight(yomKippur);
    assert.equal(ykNight.status, 'skipped');
    assert.match(ykNight.skip_reason, /Yom Kippur/);

    const erevPurim = '2027-03-22'; // Monday evening start
    const purimNight = await svc.ensureGameNight(erevPurim);
    assert.equal(purimNight.status, 'skipped');
    assert.match(purimNight.skip_reason, /Purim/);
  });

  it('counts guests toward the minimum and ignores maybe', async () => {
    const game = await svc.nextScheduledGame();
    const t = await svc.tallyForGame(game);
    // Seed: Eric 1 + Mike 2 + Dave 1 = 4 yes people; Tom maybe; Joe no; Sam/Chris unanswered
    assert.equal(t.yesPeople, 4);
    assert.equal(t.yesPlayers, 3);
    assert.equal(t.maybe, 1);
    assert.equal(t.no, 1);
    assert.equal(t.unanswered, 2);
    assert.equal(t.meetsMinimum, false);
    assert.equal(t.minimum, 5);
  });

  it('saves an RSVP via token data and hides organizer-only messages', async () => {
    const game = await svc.nextScheduledGame();
    const sam = await svc.getPlayerByEmail('sam@example.com');
    await svc.saveRsvp(sam.id, game.id, {
      status: 'yes',
      party_size: 2,
      message: 'Secret note to Eric',
      message_visibility: 'organizer',
    });
    const t = await svc.tallyForGame(game);
    assert.equal(t.yesPeople, 6); // 4 + Sam and guest
    assert.equal(t.meetsMinimum, true);

    const view = await svc.publicWhosPlaying(game);
    const samRow = view.rows.find((r) => r.name === 'Sam');
    assert.equal(samRow.status, 'yes');
    assert.equal(samRow.coming, 2);
    assert.equal(samRow.publicMessage, '');

    const eric = view.rows.find((r) => r.name.startsWith('Eric'));
    assert.equal(eric.publicMessage, 'Hosting as usual.');

    const tom = view.rows.find((r) => r.name === 'Tom');
    assert.equal(tom.status, 'maybe');
    assert.equal(tom.publicMessage, ''); // "Might be late." is organizer-only
  });

  it('auto-cancel stub cancels when under minimum after cutoff and only logs', async () => {
    const freshDate = '2026-11-30'; // a Monday after the seeded next game (2026-11-16)
    const night = await svc.ensureGameNight(freshDate);
    if (night.status !== 'scheduled') await svc.restoreGame(freshDate);
    const afterCutoff = new Date('2026-11-30T16:05:00-07:00');
    const result = await svc.runAutoCancelJob(afterCutoff);
    assert.equal(result.ok, true);
    assert.equal(result.cancelled, true);
    assert.equal(result.stub, true);
    assert.equal((await svc.getGameByDate(freshDate)).status, 'cancelled');
    const logs = await getDb().all("SELECT * FROM job_logs WHERE job_type IN ('auto_cancel_job', 'email')");
    assert.ok(logs.length > 0);
  });

  it('notifies the organizer immediately for a private message, and includes public messages in reminder and game-day summary', async () => {
    const game = await svc.nextScheduledGame();
    const chris = await svc.getPlayerByEmail('chris@example.com');
    const before = await getDb().all("SELECT * FROM job_logs WHERE job_type = 'email'");
    const beforeIds = new Set(before.map((l) => l.id));

    await svc.saveRsvp(chris.id, game.id, {
      status: 'yes',
      party_size: 1,
      message: 'Running late, tell Eric only',
      message_visibility: 'organizer',
    });
    const afterPrivate = await getDb().all("SELECT * FROM job_logs WHERE job_type IN ('email', 'organizer_message')");
    const newPrivate = afterPrivate.filter((l) => !beforeIds.has(l.id));
    assert.ok(newPrivate.some((l) => l.job_type === 'organizer_message' && String(l.payload).includes('Running late, tell Eric only')));
    const privateEmails = newPrivate.filter((l) => l.job_type === 'email' && String(l.payload).includes('private_message'));
    assert.ok(privateEmails.length >= 1);
    assert.ok(privateEmails.every((l) => String(l.payload).includes('eric@example.com')));
    assert.ok(!privateEmails.some((l) => /mike@example.com|dave@example.com/.test(String(l.payload))));

    const midIds = new Set((await getDb().all("SELECT id FROM job_logs")).map((l) => l.id));
    await svc.saveRsvp(chris.id, game.id, {
      status: 'yes',
      party_size: 1,
      message: 'Bringing chips for everyone',
      message_visibility: 'group',
    });
    const afterPublic = await getDb().all("SELECT * FROM job_logs WHERE job_type = 'email'");
    const newPublicEmails = afterPublic.filter((l) => !midIds.has(l.id));
    assert.equal(newPublicEmails.length, 0, 'no per-message emails to the group');

    const reminder = await svc.runReminderJob(new Date('2026-11-15T10:00:00-07:00'));
    assert.equal(reminder.ok, true);
    assert.ok(reminder.publicMessages.some((line) => /Bringing chips for everyone/.test(line)));
    const reminderLog = await getDb().get(
      "SELECT * FROM job_logs WHERE job_type = 'reminder_job' ORDER BY id DESC LIMIT 1"
    );
    assert.ok(reminderLog);
    assert.match(String(reminderLog.payload), /Bringing chips for everyone/);

    const summary = await svc.runGameDaySummaryJob(new Date('2026-11-16T09:05:00-07:00'));
    assert.equal(summary.ok, true);
    assert.ok(summary.publicMessages.some((line) => /Bringing chips for everyone/.test(line)));
    assert.ok(summary.count >= 7);
  });

  it('records an organizer override and uses venue on invites', async () => {
    const game = await svc.nextScheduledGame();
    const chris = await svc.getPlayerByEmail('chris@example.com');
    await svc.saveRsvp(chris.id, game.id, {
      status: 'yes',
      party_size: 2,
      setBy: { name: 'Eric', kind: 'organizer' },
    });
    const tally = await svc.tallyForGame(game);
    const row = tally.rows.find((r) => r.player.email === 'chris@example.com');
    assert.equal(row.status, 'yes');
    assert.equal(row.coming, 2);
    assert.equal(row.setByName, 'Eric');

    await svc.updateSettings({ default_venue: "Eric's house" });
    const st = await svc.getSettings();
    assert.equal(svc.effectiveVenue(game, st), "Eric's house");
    await svc.ensureGameNight('2027-03-01');
    await svc.updateGameTimes('2027-03-01', '18:00', '22:00', { venue: 'Mike\'s garage' });
    const updated = await svc.getGameByDate('2027-03-01');
    assert.equal(svc.effectiveVenue(updated, st), "Mike's garage");
  });

  it('manual cancel notifies (log only), stays player-facing, and can be reinstated', async () => {
    const date = '2026-12-07';
    await svc.ensureGameNight(date);
    await svc.restoreGame(date);
    const cancelled = await svc.cancelUpcomingGame(date, { reason: 'Only two can make it', cancelledBy: 'Eric' });
    assert.equal(cancelled.status, 'cancelled');
    const logs = await getDb().all("SELECT * FROM job_logs WHERE job_type IN ('cancel_game', 'email') ORDER BY id DESC LIMIT 20");
    assert.ok(logs.some((l) => l.job_type === 'cancel_game'));
    assert.ok(logs.some((l) => l.job_type === 'email' && String(l.payload).includes('Only two can make it')));
    const facing = await svc.nextPlayerFacingGame(date);
    assert.equal(facing.game_date, date);
    assert.equal(facing.status, 'cancelled');
    const scheduled = await svc.nextScheduledGame(date);
    assert.ok(!scheduled || scheduled.game_date !== date);
    const restored = await svc.restoreGame(date);
    assert.equal(restored.status, 'scheduled');
  });

  it('grants, expires, and revokes temporary organizer access', async () => {
    const { hashPassword } = require('../src/crypto-util');
    const auth = require('../src/auth');
    const mike = await svc.getPlayerByEmail('mike@example.com');
    const owner = await getDb().get("SELECT * FROM admin_users ORDER BY id ASC LIMIT 1");
    const granted = await svc.grantTempOrganizer({
      playerId: mike.id,
      starts_on: '2026-11-14',
      ends_on: '2026-11-17',
      grantedBy: owner.id,
    });
    assert.ok(granted.setupPath.startsWith('/setup/'));
    assert.equal(granted.grant.status, 'active');

    const completed = await svc.completeTempSetup(granted.token, {
      email: 'mike@example.com',
      passwordHash: hashPassword('temp-organizer-pass'),
    });
    assert.equal(completed.ok, true);
    const tempAdmin = completed.admin;
    assert.equal(tempAdmin.role, 'temp');
    assert.ok(await svc.getActiveGrantForAdmin(tempAdmin.id, '2026-11-16'));
    assert.equal(await svc.getActiveGrantForAdmin(tempAdmin.id, '2026-11-18'), undefined);

    await svc.revokeGrant(granted.grant.id);
    const revoked = await svc.getGrant(granted.grant.id);
    assert.equal(revoked.status, 'revoked');
    assert.equal(await svc.getActiveGrantForAdmin(tempAdmin.id, '2026-11-16'), undefined);
  });

  it('does not use a login email as an organizer display name', async () => {
    const fromEmailOnly = await svc.organizerDisplayName({
      email: 'ericwald+pokersite@gmail.com',
      role: 'owner',
      player_id: null,
    });
    assert.equal(fromEmailOnly, 'the organizer');
    const eric = await svc.getPlayerByEmail('eric@example.com');
    const linked = await svc.organizerDisplayName({
      email: 'ericwald+pokersite@gmail.com',
      player_id: eric.id,
    });
    assert.equal(linked, 'Eric');
    const matched = await svc.organizerDisplayName({ email: 'eric@example.com' });
    assert.equal(matched, 'Eric');
  });
});
