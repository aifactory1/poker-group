'use strict';

const express = require('express');
const auth = require('../auth');
const svc = require('../services');
const { formatNiceDate, formatTime12 } = require('../dates');

const router = express.Router();

async function loadRsvpContext(req, res, next) {
  const player = await svc.getPlayerByToken(req.params.token);
  if (!player || !player.active) {
    const err = new Error('This RSVP link is not valid.');
    err.status = 404;
    return next(err);
  }
  await svc.ensureUpcomingGames(12);
  const game = await svc.nextScheduledGame();
  req.player = player;
  req.game = game;
  next();
}

router.get('/rsvp/:token', loadRsvpContext, async (req, res) => {
  const rsvp = req.game ? await svc.getRsvp(req.player.id, req.game.id) : null;
  res.render('rsvp', {
    title: 'RSVP — ' + ((await svc.getSettings()).group_name),
    layout: 'player',
    player: req.player,
    game: req.game,
    rsvp,
    token: req.params.token,
    formatNiceDate,
    formatTime12,
    settings: await svc.getSettings(),
  });
});

router.post('/rsvp/:token', loadRsvpContext, auth.requireCsrf, async (req, res, next) => {
  try {
    if (!req.game) {
      req.flash('error', 'There is no upcoming scheduled game to RSVP for.');
      return res.redirect('/rsvp/' + req.params.token);
    }
    await svc.saveRsvp(req.player.id, req.game.id, {
      status: req.body.status,
      party_size: req.body.party_size,
      message: req.body.message,
      message_visibility: req.body.message_visibility,
    });
    req.flash('ok', 'Your RSVP has been saved.');
    res.redirect('/rsvp/' + req.params.token);
  } catch (err) {
    if (err.status === 400) {
      req.flash('error', err.message);
      return res.redirect('/rsvp/' + req.params.token);
    }
    next(err);
  }
});

router.get('/rsvp/:token/whos', loadRsvpContext, async (req, res) => {
  if (!req.game) {
    return res.render('whos', {
      title: "Who's playing",
      layout: 'player',
      player: req.player,
      game: null,
      view: null,
      token: req.params.token,
      formatNiceDate,
      formatTime12,
      settings: await svc.getSettings(),
    });
  }
  const view = await svc.publicWhosPlaying(req.game);
  res.render('whos', {
    title: "Who's playing",
    layout: 'player',
    player: req.player,
    game: req.game,
    view,
    token: req.params.token,
    formatNiceDate,
    formatTime12,
    settings: await svc.getSettings(),
  });
});

module.exports = router;
