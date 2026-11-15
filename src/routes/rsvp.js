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
  const game = await svc.nextPlayerFacingGame();
  req.player = player;
  req.game = game;
  next();
}

router.get('/rsvp/:token', loadRsvpContext, async (req, res) => {
  const rsvp = req.game ? await svc.getRsvp(req.player.id, req.game.id) : null;
  res.render('rsvp', {
    title: 'RSVP',
    layout: 'player',
    player: req.player,
    game: req.game,
    rsvp,
    token: req.params.token,
    formatNiceDate,
    formatTime12,
    settings: await svc.getSettings(),
    venue: req.game ? svc.effectiveVenue(req.game, await svc.getSettings()) : '',
    saved: req.query.saved === '1',
  });
});

function wantsJson(req) {
  const accept = String(req.get('accept') || '');
  return accept.includes('application/json');
}

router.post('/rsvp/:token', loadRsvpContext, auth.requireCsrf, async (req, res, next) => {
  try {
    if (!req.game) {
      if (wantsJson(req)) return res.status(400).json({ ok: false, error: 'There is no upcoming scheduled game to RSVP for.' });
      req.flash('error', 'There is no upcoming scheduled game to RSVP for.');
      return res.redirect('/rsvp/' + req.params.token);
    }
    const status = req.body.choice || req.body.status;
    const existing = await svc.getRsvp(req.player.id, req.game.id);
    const saved = await svc.saveRsvp(req.player.id, req.game.id, {
      status: status || (existing && existing.status),
      party_size: req.body.party_size,
      message: Object.prototype.hasOwnProperty.call(req.body, 'message') ? req.body.message : undefined,
      message_visibility: req.body.message_visibility,
    });
    if (wantsJson(req)) {
      return res.json({
        ok: true,
        rsvp: {
          status: saved.status,
          party_size: saved.party_size,
          message: saved.message || '',
          message_visibility: saved.message_visibility,
        },
      });
    }
    res.redirect('/rsvp/' + req.params.token + '?saved=1');
  } catch (err) {
    if (err.status === 400 || err.status === 404) {
      if (wantsJson(req)) return res.status(err.status).json({ ok: false, error: err.message });
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
      venue: '',
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
    venue: svc.effectiveVenue(req.game, await svc.getSettings()),
  });
});

module.exports = router;
