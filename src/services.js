'use strict';

const { getDb, nowIso } = require('./db');
const { randomToken } = require('./crypto-util');
const { holidayOnDate } = require('./holidays');
const {
  todayISO,
  upcomingMondayOnOrAfter,
  addDaysISO,
  weekdayUTC,
  formatNiceDate,
  formatTime12,
  phoenixDateTime,
  daysInMonth,
} = require('./dates');
const notify = require('./notify');
const { config } = require('./config');

const DEFAULT_SETTINGS = {
  id: 1,
  group_name: 'Poker Group',
  invite_weekday: 5,
  invite_time: '10:00',
  remind_weekday: 0,
  remind_time: '10:00',
  auto_cancel_enabled: 1,
  cutoff_time: '16:00',
  minimum_yes: 5,
  default_start_time: '19:30',
  default_end_time: '22:00',
  timezone: 'America/Phoenix',
};

function bool01(v) {
  if (v === true || v === 1 || v === '1' || v === 'on' || v === 'true') return 1;
  return 0;
}

async function ensureSettings() {
  const db = getDb();
  const row = await db.get('SELECT * FROM settings WHERE id = 1');
  if (row) return normalizeSettings(row);
  await db.run(
    `INSERT INTO settings (
      id, group_name, invite_weekday, invite_time, remind_weekday, remind_time,
      auto_cancel_enabled, cutoff_time, minimum_yes, default_start_time, default_end_time, timezone
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT (id) DO NOTHING`,
    [
      1,
      DEFAULT_SETTINGS.group_name,
      DEFAULT_SETTINGS.invite_weekday,
      DEFAULT_SETTINGS.invite_time,
      DEFAULT_SETTINGS.remind_weekday,
      DEFAULT_SETTINGS.remind_time,
      DEFAULT_SETTINGS.auto_cancel_enabled,
      DEFAULT_SETTINGS.cutoff_time,
      DEFAULT_SETTINGS.minimum_yes,
      DEFAULT_SETTINGS.default_start_time,
      DEFAULT_SETTINGS.default_end_time,
      DEFAULT_SETTINGS.timezone,
    ]
  );
  return { ...DEFAULT_SETTINGS };
}

function normalizeSettings(row) {
  return {
    ...row,
    invite_weekday: Number(row.invite_weekday),
    remind_weekday: Number(row.remind_weekday),
    auto_cancel_enabled: Number(row.auto_cancel_enabled) === 1,
    minimum_yes: Number(row.minimum_yes),
  };
}

async function getSettings() {
  return await ensureSettings();
}

async function updateSettings(patch) {
  const cur = await ensureSettings();
  const next = {
    group_name: patch.group_name != null ? String(patch.group_name).trim() || 'Poker Group' : cur.group_name,
    invite_weekday: numOr(patch.invite_weekday, cur.invite_weekday),
    invite_time: patch.invite_time || cur.invite_time,
    remind_weekday: numOr(patch.remind_weekday, cur.remind_weekday),
    remind_time: patch.remind_time || cur.remind_time,
    auto_cancel_enabled: patch.auto_cancel_enabled == null ? bool01(cur.auto_cancel_enabled) : bool01(patch.auto_cancel_enabled),
    cutoff_time: patch.cutoff_time || cur.cutoff_time,
    minimum_yes: numOr(patch.minimum_yes, cur.minimum_yes),
    default_start_time: patch.default_start_time || cur.default_start_time,
    default_end_time: patch.default_end_time || cur.default_end_time,
    timezone: 'America/Phoenix',
  };
  await getDb().run(
    `UPDATE settings SET group_name=?, invite_weekday=?, invite_time=?, remind_weekday=?, remind_time=?,
      auto_cancel_enabled=?, cutoff_time=?, minimum_yes=?, default_start_time=?, default_end_time=?, timezone=?
      WHERE id = 1`,
    [
      next.group_name,
      next.invite_weekday,
      next.invite_time,
      next.remind_weekday,
      next.remind_time,
      next.auto_cancel_enabled,
      next.cutoff_time,
      next.minimum_yes,
      next.default_start_time,
      next.default_end_time,
      next.timezone,
    ]
  );
  if (patch.applyTimesToFuture && (patch.default_start_time || patch.default_end_time)) {
    const today = todayISO();
    await getDb().run(
      `UPDATE game_nights SET start_time = ?, end_time = ?, updated_at = ?
       WHERE game_date >= ? AND status = 'scheduled'`,
      [next.default_start_time, next.default_end_time, nowIso(), today]
    );
  }
  return await getSettings();
}

function numOr(v, fallback) {
  if (v == null || v === '') return fallback;
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

async function listPlayers({ includeInactive = true } = {}) {
  if (includeInactive) return await getDb().all('SELECT * FROM players ORDER BY lower(name), id');
  return await getDb().all('SELECT * FROM players WHERE active = 1 ORDER BY lower(name), id');
}

async function getPlayer(id) {
  return await getDb().get('SELECT * FROM players WHERE id = ?', [id]);
}

async function getPlayerByEmail(email) {
  return await getDb().get('SELECT * FROM players WHERE lower(email) = lower(?)', [email]);
}

async function getPlayerByToken(token) {
  if (!token) return null;
  return await getDb().get('SELECT * FROM players WHERE rsvp_token = ?', [token]);
}

function normalizeEmail(email) {
  return String(email || '').trim().toLowerCase();
}

async function createPlayer({ name, email, phone, active = true }) {
  name = String(name || '').trim();
  email = normalizeEmail(email);
  phone = phone ? String(phone).trim() : null;
  if (!name) throw Object.assign(new Error('Name is required'), { status: 400 });
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw Object.assign(new Error('A valid email is required'), { status: 400 });
  }
  if (await getPlayerByEmail(email)) {
    throw Object.assign(new Error('A player with that email already exists'), { status: 400 });
  }
  const ts = nowIso();
  const token = randomToken(24);
  const result = await getDb().run(
    `INSERT INTO players (name, email, phone, active, rsvp_token, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [name, email, phone, bool01(active), token, ts, ts]
  );
  return await getPlayer(result.lastInsertRowid);
}

async function updatePlayer(id, { name, email, phone, active }) {
  const existing = await getPlayer(id);
  if (!existing) throw Object.assign(new Error('Player not found'), { status: 404 });
  name = name != null ? String(name).trim() : existing.name;
  email = email != null ? normalizeEmail(email) : existing.email;
  phone = phone != null ? (String(phone).trim() || null) : existing.phone;
  const isActive = active == null ? existing.active : bool01(active);
  if (!name) throw Object.assign(new Error('Name is required'), { status: 400 });
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw Object.assign(new Error('A valid email is required'), { status: 400 });
  }
  const clash = await getDb().get('SELECT id FROM players WHERE lower(email) = lower(?) AND id != ?', [email, id]);
  if (clash) throw Object.assign(new Error('A player with that email already exists'), { status: 400 });
  await getDb().run(
    `UPDATE players SET name=?, email=?, phone=?, active=?, updated_at=? WHERE id=?`,
    [name, email, phone, isActive, nowIso(), id]
  );
  return await getPlayer(id);
}

async function deletePlayer(id) {
  const existing = await getPlayer(id);
  if (!existing) throw Object.assign(new Error('Player not found'), { status: 404 });
  await getDb().run('DELETE FROM rsvps WHERE player_id = ?', [id]);
  await getDb().run('DELETE FROM players WHERE id = ?', [id]);
  return existing;
}

async function rotatePlayerToken(id) {
  const token = randomToken(24);
  await getDb().run('UPDATE players SET rsvp_token = ?, updated_at = ? WHERE id = ?', [token, nowIso(), id]);
  return await getPlayer(id);
}

function rsvpUrl(player) {
  return config.baseUrl + '/rsvp/' + player.rsvp_token;
}

async function getGameByDate(iso) {
  return await getDb().get('SELECT * FROM game_nights WHERE game_date = ?', [iso]);
}

async function getGame(id) {
  return await getDb().get('SELECT * FROM game_nights WHERE id = ?', [id]);
}

function holidaySkipReason(h) {
  return 'Holiday: ' + h.label;
}

/**
 * Ensure the Monday exists as a game_night row.
 * New Mondays that fall on a computed US holiday (or observed date) start as skipped.
 */
async function ensureGameNight(iso, { settings } = {}) {
  if (weekdayUTC(iso) !== 1) {
    throw Object.assign(new Error('Game nights are Mondays only'), { status: 400 });
  }
  const existing = await getGameByDate(iso);
  if (existing) return existing;
  const st = settings || await getSettings();
  const hol = holidayOnDate(iso);
  const ts = nowIso();
  const status = hol ? 'skipped' : 'scheduled';
  const skip_reason = hol ? holidaySkipReason(hol) : null;
  // ON CONFLICT keeps concurrent page loads from colliding on the same Monday.
  await getDb().run(
    `INSERT INTO game_nights (game_date, start_time, end_time, status, skip_reason, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (game_date) DO NOTHING`,
    [iso, st.default_start_time, st.default_end_time, status, skip_reason, ts, ts]
  );
  return await getGameByDate(iso);
}

async function ensureUpcomingGames(weeks = 26, fromIso) {
  const start = upcomingMondayOnOrAfter(fromIso || todayISO());
  const settings = await getSettings();
  const created = [];
  for (let i = 0; i < weeks; i++) {
    created.push(await ensureGameNight(addDaysISO(start, i * 7), { settings }));
  }
  return created;
}

async function skipGame(iso, reason) {
  const game = await ensureGameNight(iso);
  const skip_reason = reason || 'Organizer skipped';
  await getDb().run(
    `UPDATE game_nights SET status = 'skipped', skip_reason = ?, updated_at = ? WHERE id = ?`,
    [skip_reason, nowIso(), game.id]
  );
  return await getGame(game.id);
}

async function restoreGame(iso) {
  const game = await ensureGameNight(iso);
  await getDb().run(
    `UPDATE game_nights SET status = 'scheduled', skip_reason = NULL, updated_at = ? WHERE id = ?`,
    [nowIso(), game.id]
  );
  return await getGame(game.id);
}

async function cancelGame(iso, reason) {
  const game = await ensureGameNight(iso);
  await getDb().run(
    `UPDATE game_nights SET status = 'cancelled', skip_reason = ?, updated_at = ? WHERE id = ?`,
    [reason || 'Cancelled', nowIso(), game.id]
  );
  return await getGame(game.id);
}

async function updateGameTimes(iso, startTime, endTime) {
  const game = await ensureGameNight(iso);
  await getDb().run(
    `UPDATE game_nights SET start_time = ?, end_time = ?, updated_at = ? WHERE id = ?`,
    [startTime, endTime, nowIso(), game.id]
  );
  return await getGame(game.id);
}

async function nextScheduledGame(fromIso) {
  await ensureUpcomingGames(16, fromIso);
  const start = fromIso || todayISO();
  return await getDb().get(
    `SELECT * FROM game_nights
     WHERE game_date >= ? AND status = 'scheduled'
     ORDER BY game_date ASC LIMIT 1`,
    [start]
  );
}

async function gamesInMonth(year, month) {
  const start = year + '-' + String(month).padStart(2, '0') + '-01';
  const endDay = daysInMonth(year, month);
  const end = year + '-' + String(month).padStart(2, '0') + '-' + String(endDay).padStart(2, '0');
  // Materialize each Monday in the visible range (including days that pad from adjacent months later).
  const firstMonday = upcomingMondayOnOrAfter(addDaysISO(start, -6));
  let iso = firstMonday;
  while (iso <= addDaysISO(end, 6)) {
    if (weekdayUTC(iso) === 1) await ensureGameNight(iso);
    iso = addDaysISO(iso, 7);
  }
  return await getDb().all(
    `SELECT * FROM game_nights WHERE game_date >= ? AND game_date <= ? ORDER BY game_date`,
    [addDaysISO(start, -7), addDaysISO(end, 7)]
  );
}

async function upcomingList(limit = 8) {
  await ensureUpcomingGames(20);
  return await getDb().all(
    `SELECT * FROM game_nights WHERE game_date >= ? ORDER BY game_date ASC LIMIT ?`,
    [upcomingMondayOnOrAfter(todayISO()), limit]
  );
}

function partyFor(rsvp) {
  if (!rsvp || rsvp.status !== 'yes') return 0;
  const n = Number(rsvp.party_size) || 1;
  return Math.max(1, n);
}

async function tallyForGame(game, players) {
  const rsvps = game
    ? await getDb().all('SELECT * FROM rsvps WHERE game_night_id = ?', [game.id])
    : [];
  const byPlayer = new Map(rsvps.map((r) => [Number(r.player_id), r]));
  const list = players || await listPlayers({ includeInactive: false });
  let yesPeople = 0;
  let yesPlayers = 0;
  let no = 0;
  let maybe = 0;
  let unanswered = 0;
  const rows = list.map((p) => {
    const r = byPlayer.get(Number(p.id));
    if (!r || !r.status) {
      unanswered++;
      return { player: p, rsvp: null, status: 'unanswered', coming: 0 };
    }
    if (r.status === 'yes') {
      yesPlayers++;
      yesPeople += partyFor(r);
    } else if (r.status === 'no') no++;
    else if (r.status === 'maybe') maybe++;
    else unanswered++;
    return { player: p, rsvp: r, status: r.status, coming: partyFor(r) };
  });
  const minimum = (await getSettings()).minimum_yes;
  return {
    yesPeople,
    yesPlayers,
    no,
    maybe,
    unanswered,
    meetsMinimum: yesPeople >= minimum,
    minimum,
    rows,
  };
}

async function getRsvp(playerId, gameId) {
  return await getDb().get('SELECT * FROM rsvps WHERE player_id = ? AND game_night_id = ?', [playerId, gameId]);
}

async function saveRsvp(playerId, gameId, { status, party_size, message, message_visibility }) {
  const allowed = { yes: 1, no: 1, maybe: 1 };
  if (!allowed[status]) throw Object.assign(new Error('Choose Yes, No, or Maybe'), { status: 400 });
  const game = await getGame(gameId);
  if (!game) throw Object.assign(new Error('Game not found'), { status: 404 });
  if (game.status !== 'scheduled') {
    throw Object.assign(new Error('This night is not scheduled'), { status: 400 });
  }
  let party = Math.max(1, Number(party_size) || 1);
  if (status !== 'yes') party = 1;
  if (party > 12) party = 12;
  const vis = message_visibility === 'group' ? 'group' : 'organizer';
  const msg = message != null ? String(message).trim() : '';
  const ts = nowIso();
  const existing = await getRsvp(playerId, gameId);
  if (existing) {
    await getDb().run(
      `UPDATE rsvps SET status=?, party_size=?, message=?, message_visibility=?, updated_at=? WHERE id=?`,
      [status, party, msg, vis, ts, existing.id]
    );
    return await getRsvp(playerId, gameId);
  }
  await getDb().run(
    `INSERT INTO rsvps (player_id, game_night_id, status, party_size, message, message_visibility, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [playerId, gameId, status, party, msg, vis, ts, ts]
  );
  return await getRsvp(playerId, gameId);
}

async function publicWhosPlaying(game) {
  const t = await tallyForGame(game);
  const publicRows = t.rows.map((row) => {
    const msg =
      row.rsvp && row.rsvp.message && row.rsvp.message_visibility === 'group' ? row.rsvp.message : '';
    return {
      name: row.player.name,
      status: row.status,
      coming: row.status === 'yes' ? row.coming : null,
      publicMessage: msg,
    };
  });
  return { tally: t, rows: publicRows, game };
}

async function recipientsForAnnouncement(game, audience) {
  const players = await listPlayers({ includeInactive: false });
  if (audience === 'all' || !game) return players;
  const t = await tallyForGame(game, players);
  if (audience === 'yes') return t.rows.filter((r) => r.status === 'yes').map((r) => r.player);
  if (audience === 'no') return t.rows.filter((r) => r.status === 'no').map((r) => r.player);
  return players;
}

async function previewAnnouncement({ gameId, audience, subject, body }) {
  const game = gameId ? await getGame(gameId) : await nextScheduledGame();
  const recipients = await recipientsForAnnouncement(game, audience || 'all');
  return { game, audience: audience || 'all', subject, body, recipients, count: recipients.length };
}

async function sendAnnouncement({ gameId, audience, subject, body }) {
  const preview = await previewAnnouncement({ gameId, audience, subject, body });
  const ts = nowIso();
  const result = await getDb().run(
    `INSERT INTO announcements (game_night_id, audience, subject, body, recipient_count, status, created_at, sent_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [preview.game ? preview.game.id : null, preview.audience, subject || '', body || '', preview.count, 'sent_stub', ts, ts]
  );
  for (const p of preview.recipients) {
    await notify.sendEmail({
      to: p.email,
      subject: subject || 'Poker Group update',
      text: body || '',
      meta: { kind: 'announcement', playerId: p.id, audience: preview.audience },
    });
  }
  return { ...preview, id: result.lastInsertRowid, status: 'sent_stub' };
}

async function listAnnouncements(limit = 20) {
  return await getDb().all('SELECT * FROM announcements ORDER BY id DESC LIMIT ?', [limit]);
}

async function runInviteJob(now = new Date()) {
  const game = await nextScheduledGame(todayISO(now));
  if (!game) return { ok: false, reason: 'No upcoming scheduled game' };
  const players = await listPlayers({ includeInactive: false });
  const st = await getSettings();
  const subject = st.group_name + ' — you\'re invited for ' + formatNiceDate(game.game_date);
  const sent = [];
  for (const p of players) {
    const text =
      'Game: ' + formatNiceDate(game.game_date) + '\n' +
      'Time: ' + formatTime12(game.start_time) + '–' + formatTime12(game.end_time) + '\n\n' +
      'RSVP here (private link): ' + rsvpUrl(p) + '\n';
    await notify.sendEmail({
      to: p.email,
      subject,
      text,
      meta: { kind: 'invite', gameId: game.id, playerId: p.id },
    });
    sent.push(p.email);
  }
  await notify.log('invite_job', { gameId: game.id, game_date: game.game_date, count: sent.length, stub: true });
  return { ok: true, game, count: sent.length, recipients: sent, stub: true };
}

async function runReminderJob(now = new Date()) {
  const game = await nextScheduledGame(todayISO(now));
  if (!game) return { ok: false, reason: 'No upcoming scheduled game' };
  const t = await tallyForGame(game);
  const unanswered = t.rows.filter((r) => r.status === 'unanswered').map((r) => r.player);
  const st = await getSettings();
  const subject = 'Reminder: RSVP for ' + st.group_name + ' on ' + formatNiceDate(game.game_date);
  for (const p of unanswered) {
    const text =
      'We have not heard from you yet.\n\n' +
      'Game: ' + formatNiceDate(game.game_date) + '\n' +
      'Time: ' + formatTime12(game.start_time) + '–' + formatTime12(game.end_time) + '\n\n' +
      'RSVP here: ' + rsvpUrl(p) + '\n';
    await notify.sendEmail({
      to: p.email,
      subject,
      text,
      meta: { kind: 'reminder', gameId: game.id, playerId: p.id },
    });
  }
  await notify.log('reminder_job', { gameId: game.id, count: unanswered.length, stub: true });
  return { ok: true, game, count: unanswered.length, recipients: unanswered.map((p) => p.email), stub: true };
}

async function runAutoCancelJob(now = new Date()) {
  const st = await getSettings();
  if (!st.auto_cancel_enabled) return { ok: false, reason: 'Auto-cancel is turned off' };
  const today = todayISO(now);
  const game = await getGameByDate(today) || (weekdayUTC(today) === 1 ? await ensureGameNight(today) : null);
  if (!game) return { ok: false, reason: 'Today is not a game night' };
  if (game.status !== 'scheduled') return { ok: false, reason: 'Game is already ' + game.status, game };
  const cutoff = phoenixDateTime(game.game_date, st.cutoff_time);
  if (now < cutoff) {
    return { ok: false, reason: 'Cutoff has not been reached', game, cutoff: cutoff.toISOString() };
  }
  const t = await tallyForGame(game);
  if (t.yesPeople >= st.minimum_yes) {
    await notify.log('auto_cancel_job', {
      gameId: game.id,
      result: 'on',
      yesPeople: t.yesPeople,
      minimum: st.minimum_yes,
      stub: true,
    });
    return { ok: true, cancelled: false, game, tally: t, stub: true };
  }
  const cancelled = await cancelGame(game.game_date, 'Auto-cancelled: ' + t.yesPeople + ' confirmed, need ' + st.minimum_yes);
  const players = await listPlayers({ includeInactive: false });
  const subject = (await getSettings()).group_name + ' — game cancelled for ' + formatNiceDate(game.game_date);
  const text =
    'Tonight\'s game is cancelled because fewer than ' +
    st.minimum_yes +
    ' people confirmed (including guests) by ' +
    formatTime12(st.cutoff_time) +
    '. Confirmed: ' +
    t.yesPeople +
    '.';
  for (const p of players) {
    await notify.sendEmail({
      to: p.email,
      subject,
      text,
      meta: { kind: 'auto_cancel', gameId: game.id, playerId: p.id },
    });
    if (p.phone) {
      await notify.sendSms({ to: p.phone, text, meta: { kind: 'auto_cancel', playerId: p.id } });
    }
  }
  await notify.log('auto_cancel_job', {
    gameId: game.id,
    result: 'cancelled',
    yesPeople: t.yesPeople,
    minimum: st.minimum_yes,
    stub: true,
  });
  return { ok: true, cancelled: true, game: cancelled, tally: t, stub: true };
}

module.exports = {
  DEFAULT_SETTINGS,
  ensureSettings,
  getSettings,
  updateSettings,
  listPlayers,
  getPlayer,
  getPlayerByEmail,
  getPlayerByToken,
  createPlayer,
  updatePlayer,
  deletePlayer,
  rotatePlayerToken,
  rsvpUrl,
  getGameByDate,
  getGame,
  ensureGameNight,
  ensureUpcomingGames,
  skipGame,
  restoreGame,
  cancelGame,
  updateGameTimes,
  nextScheduledGame,
  gamesInMonth,
  upcomingList,
  partyFor,
  tallyForGame,
  getRsvp,
  saveRsvp,
  publicWhosPlaying,
  recipientsForAnnouncement,
  previewAnnouncement,
  sendAnnouncement,
  listAnnouncements,
  runInviteJob,
  runReminderJob,
  runAutoCancelJob,
  holidaySkipReason,
};
