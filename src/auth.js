'use strict';

const crypto = require('crypto');
const { getDb, nowIso } = require('./db');
const { verifyPassword } = require('./crypto-util');

async function getAdminByEmail(email) {
  return await getDb().get('SELECT * FROM admin_users WHERE lower(email) = lower(?)', [String(email || '').trim()]);
}

async function getAdminById(id) {
  return await getDb().get('SELECT * FROM admin_users WHERE id = ?', [id]);
}

async function authenticate(email, password) {
  const admin = await getAdminByEmail(email);
  if (!admin) return null;
  if (!verifyPassword(password, admin.password_hash)) return null;
  return admin;
}

function issueCsrf(req) {
  if (!req.session.csrfToken) req.session.csrfToken = crypto.randomBytes(24).toString('hex');
  return req.session.csrfToken;
}

function requireCsrf(req, res, next) {
  if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS') return next();
  const token = (req.body && req.body._csrf) || req.get('x-csrf-token');
  if (!req.session || !req.session.csrfToken || token !== req.session.csrfToken) {
    const err = new Error('Session expired or invalid form token. Please try again.');
    err.status = 403;
    return next(err);
  }
  next();
}

async function createAdmin(email, passwordHash, { role = 'owner', playerId = null } = {}) {
  const ts = nowIso();
  const result = await getDb().run(
    'INSERT INTO admin_users (email, password_hash, created_at, role, player_id) VALUES (?, ?, ?, ?, ?)',
    [email, passwordHash, ts, role || 'owner', playerId]
  );
  return await getAdminById(result.lastInsertRowid);
}

async function actorFromSession(req) {
  if (!req.session || !req.session.adminId) return null;
  const admin = await getAdminById(req.session.adminId);
  if (!admin) return null;
  const role = admin.role || 'owner';
  if (role !== 'temp') {
    return {
      admin,
      role: 'owner',
      isOwner: true,
      blocked: false,
      canOverrideRsvp: true,
      canManageOrganizers: true,
      canDeletePlayers: true,
      canChangeSettings: true,
      grant: null,
    };
  }
  const svc = require('./services');
  const grant = await svc.getActiveGrantForAdmin(admin.id);
  if (grant) {
    return {
      admin,
      role: 'temp',
      isOwner: false,
      blocked: false,
      canOverrideRsvp: true,
      canManageOrganizers: false,
      canDeletePlayers: false,
      canChangeSettings: false,
      grant,
    };
  }
  const open = await svc.openGrantForAdmin(admin.id);
  return {
    admin,
    role: 'temp',
    isOwner: false,
    blocked: true,
    blockReason: open && open.status === 'upcoming'
      ? 'Your temporary organizer access starts on ' + open.starts_on + '.'
      : 'Your temporary organizer access has ended.',
    canOverrideRsvp: false,
    canManageOrganizers: false,
    canDeletePlayers: false,
    canChangeSettings: false,
    grant: open,
  };
}

async function requireAdmin(req, res, next) {
  const actor = req.actor || await actorFromSession(req);
  if (actor && !actor.blocked) {
    req.actor = actor;
    req.admin = actor.admin;
    res.locals.admin = actor.admin;
    res.locals.actor = actor;
    return next();
  }
  if (actor && actor.blocked) {
    req.session.adminId = null;
    if (typeof req.flash === 'function') req.flash('info', actor.blockReason || 'Your temporary organizer access has ended.');
    return res.redirect('/login');
  }
  const nextUrl = req.originalUrl || '/';
  return res.redirect('/login?next=' + encodeURIComponent(nextUrl));
}

function requireOwner(req, res, next) {
  if (!req.actor || !req.actor.isOwner) {
    const err = new Error('Only the main organizer can do that.');
    err.status = 403;
    return next(err);
  }
  next();
}

async function updateOrganizerCredentials(email, passwordHash) {
  const normalized = String(email || '').trim();
  const existing = await getDb().get('SELECT * FROM admin_users ORDER BY id ASC LIMIT 1');
  if (existing) {
    const clash = await getAdminByEmail(normalized);
    if (clash && clash.id !== existing.id) {
      const err = new Error('That email is already in use.');
      err.status = 400;
      throw err;
    }
    await getDb().run('UPDATE admin_users SET email = ?, password_hash = ? WHERE id = ?', [
      normalized,
      passwordHash,
      existing.id,
    ]);
    return await getAdminById(existing.id);
  }
  return await createAdmin(normalized, passwordHash);
}

module.exports = {
  getAdminByEmail,
  getAdminById,
  authenticate,
  issueCsrf,
  actorFromSession,
  requireAdmin,
  requireOwner,
  requireCsrf,
  createAdmin,
  updateOrganizerCredentials,
};
