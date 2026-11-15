'use strict';

const express = require('express');
const auth = require('../auth');
const setupToken = require('../setup-token');
const { hashPassword } = require('../crypto-util');
const { config } = require('../config');
const fs = require('fs');

const router = express.Router();

const failed = new Map();

function loginAllowed(ip) {
  const rec = failed.get(ip) || { n: 0, at: 0 };
  if (rec.n >= 10 && Date.now() - rec.at < 15 * 60 * 1000) return false;
  if (Date.now() - rec.at >= 15 * 60 * 1000) failed.delete(ip);
  return true;
}

function recordFail(ip) {
  const rec = failed.get(ip) || { n: 0, at: 0 };
  rec.n += 1;
  rec.at = Date.now();
  failed.set(ip, rec);
}

router.get('/login', async (req, res) => {
  if (req.session.adminId) return res.redirect('/');
  res.render('login', { title: 'Organizer login', next: req.query.next || '/' });
});

router.post('/login', auth.requireCsrf, async (req, res) => {
  const ip = req.ip || 'local';
  if (!loginAllowed(ip)) {
    req.flash('error', 'Too many login attempts. Please wait and try again.');
    return res.redirect('/login');
  }
  const email = String(req.body.email || '').trim();
  const password = String(req.body.password || '');
  const admin = await auth.authenticate(email, password);
  if (!admin) {
    recordFail(ip);
    req.flash('error', 'Email or password is incorrect.');
    return res.redirect('/login?next=' + encodeURIComponent(req.body.next || '/'));
  }
  failed.delete(ip);
  req.session.adminId = admin.id;
  if ((admin.role || 'owner') === 'temp') {
    const actor = await auth.actorFromSession(req);
    if (!actor || actor.blocked) {
      req.session.adminId = null;
      req.flash('info', (actor && actor.blockReason) || 'Your temporary organizer access has ended.');
      return res.redirect('/login');
    }
  }
  const next = String(req.body.next || '/');
  const safeNext = next.startsWith('/') && !next.startsWith('//') ? next : '/';
  res.redirect(safeNext);
});

router.post('/logout', auth.requireCsrf, async (req, res) => {
  req.session.destroy(() => {
    res.redirect('/login');
  });
});

function looksLikeEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value || '').trim());
}

function setupUnavailable(reason) {
  if (reason === 'used') return 'This setup link has already been used.';
  if (reason === 'expired') return 'This setup link has expired.';
  return 'This setup link is not valid.';
}

const setupFailed = new Map();

function setupAllowed(ip) {
  const rec = setupFailed.get(ip) || { n: 0, at: 0 };
  if (rec.n >= 10 && Date.now() - rec.at < 15 * 60 * 1000) return false;
  if (Date.now() - rec.at >= 15 * 60 * 1000) setupFailed.delete(ip);
  return true;
}

function recordSetupFail(ip) {
  const rec = setupFailed.get(ip) || { n: 0, at: 0 };
  rec.n += 1;
  rec.at = Date.now();
  setupFailed.set(ip, rec);
}

function renderSetupError(res, reason) {
  return res.status(404).render('error', {
    title: 'Setup link unavailable',
    status: 404,
    message: setupUnavailable(reason) + ' Ask for a new one-time link if you still need to set the organizer password.',
  });
}

router.get('/setup/:token', async (req, res) => {
  const checked = await setupToken.inspectToken(req.params.token);
  if (!checked.ok) return renderSetupError(res, checked.reason);
  if (checked.purpose === 'temp') {
    const svc = require('../services');
    const grant = await svc.getGrant(checked.grantId);
    if (!grant || grant.revoked_at || grant.status === 'expired') {
      return renderSetupError(res, 'expired');
    }
    return res.render('setup', {
      title: 'Set temporary organizer password',
      token: req.params.token,
      defaultEmail: grant.player_email,
      mode: 'temp',
      playerName: grant.player_name,
      startsOn: grant.starts_on,
      endsOn: grant.ends_on,
      formatNiceDate: require('../dates').formatNiceDate,
    });
  }
  const admin = await auth.getAdminByEmail(config.adminEmail) || await auth.getAdminById(1);
  const defaultEmail = (admin && admin.email) || config.adminEmail || 'eric@example.com';
  res.render('setup', {
    title: 'Set organizer password',
    token: req.params.token,
    defaultEmail,
    mode: 'owner',
  });
});

router.post('/setup/:token', auth.requireCsrf, async (req, res, next) => {
  const ip = req.ip || 'local';
  const checked = await setupToken.inspectToken(req.params.token);
  if (!checked.ok) return renderSetupError(res, checked.reason);
  if (!setupAllowed(ip)) {
    req.flash('error', 'Too many attempts. Please wait and try again.');
    return res.redirect('/setup/' + encodeURIComponent(req.params.token));
  }

  const email = String(req.body.email || '').trim();
  const password = String(req.body.password || '');
  const confirm = String(req.body.password_confirm || '');

  function retry(message) {
    recordSetupFail(ip);
    req.flash('error', message);
    return res.redirect('/setup/' + encodeURIComponent(req.params.token));
  }

  if (!looksLikeEmail(email)) return retry('Please enter a valid email address.');
  if (password.length < 8) return retry('Choose a password of at least 8 characters.');
  if (password !== confirm) return retry('The password and confirmation do not match.');

  const precheck = await setupToken.inspectToken(req.params.token);
  if (precheck.ok && precheck.purpose === 'temp') {
    try {
      const svc = require('../services');
      const completed = await svc.completeTempSetup(req.params.token, {
        email,
        passwordHash: hashPassword(password),
      });
      if (!completed.ok) return renderSetupError(res, completed.reason);
      return req.session.regenerate((err) => {
        if (err) return next(err);
        req.session.adminId = completed.admin.id;
        req.session.flashes = [
          {
            type: 'ok',
            message: 'Your temporary organizer password has been saved. You are signed in.',
          },
        ];
        res.redirect('/');
      });
    } catch (err) {
      if (err.status === 400) return retry(err.message);
      return next(err);
    }
  }

  const consumed = await setupToken.consumeToken(req.params.token);
  if (!consumed.ok) return renderSetupError(res, consumed.reason);

  try {
    const updated = await auth.updateOrganizerCredentials(email, hashPassword(password));
    try {
      if (config.credentialsPath && fs.existsSync(config.credentialsPath)) {
        fs.writeFileSync(
          config.credentialsPath,
          'Poker Group — organizer password was set through the one-time setup link.\n' +
            'The previous generated password is no longer valid and is not stored here.\n' +
            'email: ' + updated.email + '\n' +
            'login: ' + config.baseUrl + '/login\n',
          { mode: 0o600 }
        );
      }
    } catch (err) {
      console.error('Could not update credentials file after setup:', err.message);
    }

    req.session.regenerate((err) => {
      if (err) return next(err);
      req.session.adminId = updated.id;
      req.session.flashes = [
        {
          type: 'ok',
          message: 'Your organizer password has been saved. You are signed in.',
        },
      ];
      res.redirect('/');
    });
  } catch (err) {
    return next(err);
  }
});

module.exports = router;
