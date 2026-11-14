'use strict';

const path = require('path');
const express = require('express');
const session = require('express-session');
const { config, ROOT } = require('./config');
const { SqliteSessionStore } = require('./session-store');
const auth = require('./auth');
const authRoutes = require('./routes/auth');
const adminRoutes = require('./routes/admin');
const rsvpRoutes = require('./routes/rsvp');

function createApp() {
  const app = express();
  app.set('trust proxy', 1);
  app.set('view engine', 'ejs');
  app.set('views', path.join(ROOT, 'views'));

  app.use(express.urlencoded({ extended: false }));
  app.use(express.json());
  app.use('/static', express.static(path.join(ROOT, 'public')));

  app.use(
    session({
      name: 'poker_group.sid',
      secret: config.sessionSecret,
      resave: false,
      saveUninitialized: false,
      store: new SqliteSessionStore(),
      cookie: {
        httpOnly: true,
        sameSite: 'lax',
        // 'auto' + trust proxy: Secure on HTTPS (including a public tunnel), not on local http.
        secure: config.nodeEnv === 'production' ? true : 'auto',
        maxAge: 7 * 24 * 60 * 60 * 1000,
      },
    })
  );

  app.use(async (req, res, next) => {
    const flashes = req.session.flashes || [];
    req.session.flashes = [];
    res.locals.flashes = flashes;
    res.locals.csrfToken = auth.issueCsrf(req);
    res.locals.groupName = 'Poker Group';
    res.locals.currentPath = req.path;
    res.locals.isProd = config.nodeEnv === 'production';
    res.locals.admin = null;
    if (req.session && req.session.adminId) {
      try {
        const admin = await auth.getAdminById(req.session.adminId);
        if (admin) {
          req.admin = admin;
          res.locals.admin = admin;
        }
      } catch (err) {
        return next(err);
      }
    }
    next();
  });

  app.use((req, res, next) => {
    req.flash = function (type, message) {
      if (!req.session.flashes) req.session.flashes = [];
      req.session.flashes.push({ type, message });
    };
    next();
  });

  app.get('/health', (req, res) => {
    res.json({ ok: true, service: 'poker-group' });
  });

  app.use(authRoutes);
  app.use(rsvpRoutes);
  app.use(adminRoutes);

  app.use((req, res) => {
    res.status(404).render('error', { title: 'Not found', status: 404, message: 'That page does not exist.' });
  });

  app.use((err, req, res, next) => {
    const status = err.status || 500;
    if (status >= 500) console.error(err);
    if (req.accepts('html')) {
      return res.status(status).render('error', {
        title: status === 403 ? 'Forbidden' : 'Something went wrong',
        status,
        message: err.message || 'Unexpected error',
      });
    }
    res.status(status).json({ error: err.message || 'Unexpected error' });
  });

  return app;
}

module.exports = { createApp };
