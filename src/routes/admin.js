'use strict';

const express = require('express');
const auth = require('../auth');
const svc = require('../services');
const { holidayOnDate } = require('../holidays');
const {
  todayISO,
  formatNiceDate,
  formatTime12,
  weekdayName,
  daysInMonth,
  monthLabel,
  addDaysISO,
  weekdayUTC,
} = require('../dates');
const notify = require('../notify');
const { config } = require('../config');

const router = express.Router();

function rejectPastGameDate(date) {
  if (!date) return;
  if (String(date) < todayISO()) {
    throw Object.assign(new Error('Past dates cannot be edited.'), { status: 400 });
  }
}

router.use(auth.requireAdmin);
router.use(auth.requireCsrf);

router.get('/', async (req, res) => {
  await svc.ensureUpcomingGames(16);
  const game = await svc.nextPlayerFacingGame();
  const tally = game ? await svc.tallyForGame(game) : null;
  const settings = await svc.getSettings();
  res.render('admin/dashboard', {
    title: 'Dashboard',
    nav: 'dashboard',
    game,
    tally,
    settings,
    venue: game ? svc.effectiveVenue(game, settings) : '',
    formatNiceDate,
    formatTime12,
  });
});

router.post('/dashboard/rsvp/:playerId', async (req, res, next) => {
  try {
    if (!req.actor || !req.actor.canOverrideRsvp) {
      const err = new Error('You cannot change another player\'s RSVP.');
      err.status = 403;
      return next(err);
    }
    const game = await svc.nextPlayerFacingGame();
    if (!game || game.status !== 'scheduled') {
      throw Object.assign(new Error('There is no upcoming scheduled game to change an RSVP for.'), { status: 400 });
    }
    const setByName = await svc.organizerDisplayName(req.admin);
    await svc.saveRsvp(req.params.playerId, game.id, {
      status: req.body.status,
      party_size: req.body.party_size,
      setBy: { name: setByName, kind: req.actor.isOwner ? 'organizer' : 'temp_organizer' },
    });
    req.flash('ok', 'RSVP updated and recorded as set by ' + setByName + '.');
  } catch (err) {
    if (err.status === 403) return next(err);
    req.flash('error', err.message);
  }
  res.redirect('/#attendees');
});

router.post('/dashboard/cancel', async (req, res) => {
  try {
    const game = await svc.nextPlayerFacingGame();
    if (!game || game.status !== 'scheduled') {
      throw Object.assign(new Error('There is no upcoming scheduled game to cancel.'), { status: 400 });
    }
    if (String(game.game_date) < todayISO()) {
      throw Object.assign(new Error('Past dates cannot be edited.'), { status: 400 });
    }
    const cancelledBy = await svc.organizerDisplayName(req.admin);
    await svc.cancelUpcomingGame(game.game_date, {
      reason: req.body.reason,
      cancelledBy,
    });
    req.flash('ok', 'Game cancelled. Players will be notified (logged only during testing).');
  } catch (err) {
    req.flash('error', err.message);
  }
  res.redirect('/#game');
});

router.post('/dashboard/reinstate', async (req, res) => {
  try {
    const game = await svc.nextPlayerFacingGame();
    if (!game || game.status !== 'cancelled') {
      throw Object.assign(new Error('There is no cancelled game to reinstate.'), { status: 400 });
    }
    if (String(game.game_date) < todayISO()) {
      throw Object.assign(new Error('Past dates cannot be edited.'), { status: 400 });
    }
    await svc.restoreGame(game.game_date);
    req.flash('ok', 'Game reinstated.');
  } catch (err) {
    req.flash('error', err.message);
  }
  res.redirect('/#game');
});

router.get('/players', async (req, res) => {
  const players = await svc.listPlayers({ includeInactive: true });
  const editing = req.query.edit ? await svc.getPlayer(req.query.edit) : null;
  const grantDefaults = await svc.defaultGrantDates();
  res.render('admin/players', {
    title: 'Players',
    nav: 'players',
    players,
    editing,
    rsvpUrl: svc.rsvpUrl,
    grants: await svc.listGrants(),
    grantDefaults,
    pendingSetupLink: req.session.pendingSetupLink || null,
    formatNiceDate,
  });
});

router.post('/players', async (req, res) => {
  try {
    await svc.createPlayer({
      name: req.body.name,
      email: req.body.email,
      phone: req.body.phone,
      active: req.body.active !== '0',
    });
    req.flash('ok', 'Player added.');
    res.redirect('/players');
  } catch (err) {
    req.flash('error', err.message);
    res.redirect('/players');
  }
});

router.post('/players/grant-organizer', auth.requireOwner, async (req, res) => {
  try {
    const result = await svc.grantTempOrganizer({
      playerId: req.body.grant_player_id,
      starts_on: req.body.starts_on,
      ends_on: req.body.ends_on,
      grantedBy: req.admin && req.admin.id,
    });
    req.session.pendingSetupLink = {
      url: config.baseUrl + result.setupPath,
      path: result.setupPath,
      playerName: result.grant.player_name,
      startsOn: result.grant.starts_on,
      endsOn: result.grant.ends_on,
      expiresAt: result.expiresAt,
    };
    req.flash('ok', 'Temporary organizer access granted to ' + result.grant.player_name + '. Copy the one-time setup link below and send it to them.');
  } catch (err) {
    req.flash('error', err.message);
  }
  res.redirect('/players#temp-organizer');
});

router.post('/players/:id', async (req, res) => {
  try {
    await svc.updatePlayer(req.params.id, {
      name: req.body.name,
      email: req.body.email,
      phone: req.body.phone,
      active: req.body.active === '1' || req.body.active === 'on',
    });
    req.flash('ok', 'Player updated.');
    res.redirect('/players');
  } catch (err) {
    req.flash('error', err.message);
    res.redirect('/players?edit=' + encodeURIComponent(req.params.id));
  }
});

router.post('/players/:id/delete', auth.requireOwner, async (req, res) => {
  try {
    const p = await svc.deletePlayer(req.params.id);
    req.flash('ok', 'Removed ' + p.name + '.');
  } catch (err) {
    req.flash('error', err.message);
  }
  res.redirect('/players');
});

router.post('/players/:id/rotate-token', async (req, res) => {
  try {
    await svc.rotatePlayerToken(req.params.id);
    req.flash('ok', 'A new private RSVP link was created. The old link no longer works.');
  } catch (err) {
    req.flash('error', err.message);
  }
  res.redirect('/players?edit=' + encodeURIComponent(req.params.id) + '#player-form');
});

router.post('/players/grants/:grantId/revoke', auth.requireOwner, async (req, res) => {
  try {
    const grant = await svc.revokeGrant(req.params.grantId);
    if (req.session.pendingSetupLink && grant && req.session.pendingSetupLink.playerName === grant.player_name) {
      req.session.pendingSetupLink = null;
    }
    req.flash('ok', 'Temporary organizer access for ' + grant.player_name + ' has been revoked.');
  } catch (err) {
    req.flash('error', err.message);
  }
  res.redirect('/players#temp-organizer');
});

router.get('/calendar', async (req, res) => {
  const today = todayISO();
  const now = new Date();
  let year = Number(req.query.year) || Number(today.slice(0, 4));
  let month = Number(req.query.month) || Number(today.slice(5, 7));
  if (month < 1) {
    month = 12;
    year -= 1;
  }
  if (month > 12) {
    month = 1;
    year += 1;
  }
  await svc.gamesInMonth(year, month);
  const requested = req.query.date || null;
  const selected = requested && requested >= today ? requested : null;
  const selectedGame = selected ? await svc.getGameByDate(selected) : null;
  const selectedHoliday = selected ? holidayOnDate(selected) : null;
  const startPad = weekdayUTC(year + '-' + String(month).padStart(2, '0') + '-01');
  const dim = daysInMonth(year, month);
  const days = [];
  for (let i = 0; i < startPad; i++) days.push({ pad: true });
  for (let d = 1; d <= dim; d++) {
    const iso = year + '-' + String(month).padStart(2, '0') + '-' + String(d).padStart(2, '0');
    const game = weekdayUTC(iso) === 1 ? await svc.getGameByDate(iso) : null;
    const hol = holidayOnDate(iso);
    const isPast = iso < today;
    days.push({
      pad: false,
      iso,
      day: d,
      isMonday: weekdayUTC(iso) === 1,
      isToday: iso === today,
      isPast,
      selected: !isPast && iso === selected,
      game,
      holiday: hol,
    });
  }
  const settings = await svc.getSettings();
  const upcoming = await svc.upcomingList(8);
  const prev = month === 1 ? { year: year - 1, month: 12 } : { year, month: month - 1 };
  const next = month === 12 ? { year: year + 1, month: 1 } : { year, month: month + 1 };
  res.render('admin/calendar', {
    title: 'Calendar',
    nav: 'calendar',
    year,
    month,
    monthLabel: monthLabel(year, month),
    days,
    prev,
    next,
    selected,
    selectedGame,
    selectedHoliday,
    settings,
    upcoming,
    formatNiceDate,
    formatTime12,
    weekdayUTC,
  });
});

router.post('/calendar/skip', async (req, res) => {
  const date = req.body.date;
  const year = req.body.year;
  const month = req.body.month;
  try {
    if (!date) throw Object.assign(new Error('Select a date first'), { status: 400 });
    rejectPastGameDate(date);
    const hol = holidayOnDate(date);
    await svc.skipGame(date, hol ? svc.holidaySkipReason(hol) : 'Organizer skipped');
    req.flash('ok', 'No game on ' + formatNiceDate(date) + '.');
  } catch (err) {
    req.flash('error', err.message);
  }
  res.redirect('/calendar?year=' + year + '&month=' + month + '#calendar');
});

router.post('/calendar/restore', async (req, res) => {
  const date = req.body.date;
  const year = req.body.year;
  const month = req.body.month;
  try {
    if (!date) throw Object.assign(new Error('Select a date first'), { status: 400 });
    rejectPastGameDate(date);
    await svc.restoreGame(date);
    req.flash('ok', 'Game restored on ' + formatNiceDate(date) + '.');
  } catch (err) {
    req.flash('error', err.message);
  }
  res.redirect('/calendar?year=' + year + '&month=' + month + '#calendar');
});

router.post('/calendar/times', async (req, res) => {
  const date = req.body.date;
  const year = req.body.year;
  const month = req.body.month;
  try {
    if (date && req.body.night_start && req.body.night_end) {
      rejectPastGameDate(date);
      await svc.updateGameTimes(date, req.body.night_start, req.body.night_end, { venue: req.body.venue });
      req.flash('ok', 'Time and venue updated for ' + formatNiceDate(date) + '.');
    } else if (req.body.default_start_time && req.body.default_end_time) {
      if (!req.actor || !req.actor.isOwner) {
        throw Object.assign(new Error('Only the main organizer can change the default game times.'), { status: 403 });
      }
      await svc.updateSettings({
        default_start_time: req.body.default_start_time,
        default_end_time: req.body.default_end_time,
        applyTimesToFuture: true,
      });
      req.flash('ok', 'Default game times saved and applied to upcoming scheduled nights.');
    }
  } catch (err) {
    req.flash('error', err.message);
  }
  const q = '/calendar?year=' + year + '&month=' + month + '#calendar';
  res.redirect(q);
});

router.get('/announce', async (req, res) => {
  const game = await svc.nextScheduledGame();
  const audience = req.query.audience || 'yes';
  const subject = req.query.subject || 'Poker Group update';
  const body = req.query.body || 'Hey everyone — quick note from Poker Group.';
  const preview = await svc.previewAnnouncement({ gameId: game && game.id, audience, subject, body });
  res.render('admin/announce', {
    title: 'Announce',
    nav: 'announce',
    game,
    preview,
    audience,
    subject,
    body,
    history: await svc.listAnnouncements(10),
    formatNiceDate,
    formatTime12,
  });
});

router.post('/announce/preview', async (req, res) => {
  const params = new URLSearchParams({
    audience: req.body.audience || 'all',
    subject: req.body.subject || '',
    body: req.body.body || '',
  });
  res.redirect('/announce?' + params.toString());
});

router.post('/announce/send', async (req, res) => {
  try {
    const game = await svc.nextScheduledGame();
    const result = await svc.sendAnnouncement({
      gameId: game && game.id,
      audience: req.body.audience,
      subject: req.body.subject,
      body: req.body.body,
    });
    req.flash('ok', 'Announcement logged for ' + result.count + ' recipient(s). No email was actually sent.');
  } catch (err) {
    req.flash('error', err.message);
  }
  res.redirect('/announce');
});

router.get('/settings', auth.requireOwner, async (req, res) => {
  res.render('admin/settings', {
    title: 'Settings',
    nav: 'settings',
    settings: await svc.getSettings(),
    weekdayName,
    logs: await notify.recentLogs(12),
  });
});

router.post('/settings', auth.requireOwner, async (req, res) => {
  try {
    await svc.updateSettings({
      group_name: req.body.group_name,
      invite_weekday: req.body.invite_weekday,
      invite_time: req.body.invite_time,
      remind_weekday: req.body.remind_weekday,
      remind_time: req.body.remind_time,
      auto_cancel_enabled: req.body.auto_cancel_enabled === '1' || req.body.auto_cancel_enabled === 'on',
      cutoff_time: req.body.cutoff_time,
      minimum_yes: req.body.minimum_yes,
      default_start_time: req.body.default_start_time,
      default_end_time: req.body.default_end_time,
      default_venue: req.body.default_venue,
      applyTimesToFuture: true,
    });
    req.flash('ok', 'Settings saved.');
  } catch (err) {
    req.flash('error', err.message);
  }
  res.redirect('/settings');
});

router.post('/settings/job/:kind', auth.requireOwner, async (req, res) => {
  const kind = req.params.kind;
  let result;
  if (kind === 'invite') result = await svc.runInviteJob();
  else if (kind === 'reminder') result = await svc.runReminderJob();
  else if (kind === 'auto-cancel') result = await svc.runAutoCancelJob();
  else {
    req.flash('error', 'Unknown job.');
    return res.redirect('/settings');
  }
  if (kind === 'auto-cancel') {
    if (result.cancelled) req.flash('ok', 'Game auto-cancelled (notifications logged only).');
    else if (result.ok && !result.cancelled) req.flash('ok', 'Cutoff check: enough people confirmed. Game stays on.');
    else req.flash('info', result.reason || 'No action taken.');
  } else if (result.ok) {
    const extra = result.count != null ? ' Recipients: ' + result.count + '.' : '';
    req.flash('ok', 'Ran ' + kind + ' job (log only).' + extra);
  } else {
    req.flash('info', result.reason || 'No action taken.');
  }
  res.redirect('/settings#testing-tools');
});

module.exports = router;
