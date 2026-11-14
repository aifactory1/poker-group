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

const router = express.Router();

router.use(auth.requireAdmin);
router.use(auth.requireCsrf);

router.get('/', async (req, res) => {
  await svc.ensureUpcomingGames(16);
  const game = await svc.nextScheduledGame();
  const tally = game ? await svc.tallyForGame(game) : null;
  const settings = await svc.getSettings();
  res.render('admin/dashboard', {
    title: 'Dashboard',
    nav: 'dashboard',
    game,
    tally,
    settings,
    formatNiceDate,
    formatTime12,
  });
});

router.post('/admin/jobs/auto-cancel', async (req, res) => {
  const when = req.body.at ? new Date(req.body.at) : new Date();
  const result = await svc.runAutoCancelJob(when);
  if (result.cancelled) req.flash('ok', 'Game auto-cancelled (notifications logged only).');
  else if (result.ok && !result.cancelled) req.flash('ok', 'Cutoff check: enough people confirmed. Game stays on.');
  else req.flash('info', result.reason || 'No action taken.');
  res.redirect('/');
});

router.get('/players', async (req, res) => {
  const players = await svc.listPlayers({ includeInactive: true });
  const editing = req.query.edit ? await svc.getPlayer(req.query.edit) : null;
  res.render('admin/players', {
    title: 'Players',
    nav: 'players',
    players,
    editing,
    rsvpUrl: svc.rsvpUrl,
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

router.post('/players/:id/delete', async (req, res) => {
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
  res.redirect('/players');
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
  const selected = req.query.date || null;
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
    days.push({
      pad: false,
      iso,
      day: d,
      isMonday: weekdayUTC(iso) === 1,
      isToday: iso === today,
      selected: iso === selected,
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
    const hol = holidayOnDate(date);
    await svc.skipGame(date, hol ? svc.holidaySkipReason(hol) : 'Organizer skipped');
    req.flash('ok', 'No game on ' + formatNiceDate(date) + '.');
  } catch (err) {
    req.flash('error', err.message);
  }
  res.redirect('/calendar?year=' + year + '&month=' + month + '&date=' + encodeURIComponent(date || ''));
});

router.post('/calendar/restore', async (req, res) => {
  const date = req.body.date;
  const year = req.body.year;
  const month = req.body.month;
  try {
    if (!date) throw Object.assign(new Error('Select a date first'), { status: 400 });
    await svc.restoreGame(date);
    req.flash('ok', 'Game restored on ' + formatNiceDate(date) + '.');
  } catch (err) {
    req.flash('error', err.message);
  }
  res.redirect('/calendar?year=' + year + '&month=' + month + '&date=' + encodeURIComponent(date || ''));
});

router.post('/calendar/times', async (req, res) => {
  const date = req.body.date;
  const year = req.body.year;
  const month = req.body.month;
  try {
    if (date && req.body.night_start && req.body.night_end) {
      await svc.updateGameTimes(date, req.body.night_start, req.body.night_end);
      req.flash('ok', 'Times updated for ' + formatNiceDate(date) + '.');
    } else if (req.body.default_start_time && req.body.default_end_time) {
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
  const q = '/calendar?year=' + year + '&month=' + month + (date ? '&date=' + encodeURIComponent(date) : '');
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

router.get('/settings', async (req, res) => {
  res.render('admin/settings', {
    title: 'Settings',
    nav: 'settings',
    settings: await svc.getSettings(),
    weekdayName,
    logs: await notify.recentLogs(12),
  });
});

router.post('/settings', async (req, res) => {
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
      applyTimesToFuture: true,
    });
    req.flash('ok', 'Settings saved.');
  } catch (err) {
    req.flash('error', err.message);
  }
  res.redirect('/settings');
});

router.post('/settings/job/:kind', async (req, res) => {
  const kind = req.params.kind;
  let result;
  if (kind === 'invite') result = await svc.runInviteJob();
  else if (kind === 'reminder') result = await svc.runReminderJob();
  else if (kind === 'auto-cancel') result = await svc.runAutoCancelJob();
  else {
    req.flash('error', 'Unknown job.');
    return res.redirect('/settings');
  }
  if (result.ok) {
    const extra = result.cancelled ? ' Game cancelled.' : result.count != null ? ' Recipients: ' + result.count + '.' : '';
    req.flash('ok', 'Ran ' + kind + ' job (log only).' + extra);
  } else {
    req.flash('info', result.reason || 'No action taken.');
  }
  res.redirect('/settings');
});

module.exports = router;
