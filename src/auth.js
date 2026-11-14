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

async function requireAdmin(req, res, next) {
  if (req.session && req.session.adminId) {
    const admin = await getAdminById(req.session.adminId);
    if (admin) {
      req.admin = admin;
      res.locals.admin = admin;
      return next();
    }
  }
  const nextUrl = req.originalUrl || '/';
  return res.redirect('/login?next=' + encodeURIComponent(nextUrl));
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

async function createAdmin(email, passwordHash) {
  const ts = nowIso();
  const result = await getDb().run(
    'INSERT INTO admin_users (email, password_hash, created_at) VALUES (?, ?, ?)',
    [email, passwordHash, ts]
  );
  return await getAdminById(result.lastInsertRowid);
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
  requireAdmin,
  requireCsrf,
  createAdmin,
  updateOrganizerCredentials,
};
