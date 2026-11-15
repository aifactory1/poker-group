'use strict';

/**
 * One-time organizer setup links (/setup/<token>).
 *
 * Only a SHA-256 hash of each token is stored, in the setup_tokens table, so the
 * single-use / expiry state survives restarts on hosts with an ephemeral disk
 * (Render). Two sources:
 *   - "generated": local dev. A random token is created and its path is written to
 *     data/setup-link.txt (gitignored).
 *   - "env": hosted. SETUP_TOKEN is provided as a host environment variable and is
 *     registered only while no organizer account exists yet.
 */

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { ROOT } = require('./config');
const { getDb, nowIso } = require('./db');

const DEFAULT_PATH = path.join(ROOT, 'data', 'setup-token.json');
const TTL_MS = 48 * 60 * 60 * 1000;

function tokenPath() {
  return process.env.SETUP_TOKEN_PATH || DEFAULT_PATH;
}

function linkPath() {
  return path.join(path.dirname(tokenPath()), 'setup-link.txt');
}

function hashToken(token) {
  return crypto.createHash('sha256').update(String(token), 'utf8').digest('hex');
}

function writeLinkFile(token) {
  const file = linkPath();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, '/setup/' + token + '\n', { mode: 0o600 });
}

async function findUsable(source) {
  return getDb().get(
    'SELECT * FROM setup_tokens WHERE source = ? AND used_at IS NULL AND expires_at > ? ORDER BY created_at DESC LIMIT 1',
    [source, nowIso()]
  );
}

/**
 * Local dev: create a new single-use setup token unless a valid unused one already exists.
 * The raw token is only returned when a new one is created.
 */
async function ensureSetupToken({ force = false, writeFile = true } = {}) {
  const existing = await findUsable('generated');
  if (!force && existing) return { created: false, expiresAt: existing.expires_at, token: null };
  const ts = nowIso();
  if (force) {
    await getDb().run("UPDATE setup_tokens SET used_at = ? WHERE source = 'generated' AND used_at IS NULL", [ts]);
  }
  const token = crypto.randomBytes(32).toString('base64url');
  const expiresAt = new Date(Date.now() + TTL_MS).toISOString();
  await getDb().run(
    'INSERT INTO setup_tokens (hash, source, created_at, expires_at, used_at) VALUES (?, ?, ?, ?, NULL)',
    [hashToken(token), 'generated', ts, expiresAt]
  );
  if (writeFile) writeLinkFile(token);
  return { created: true, expiresAt, token };
}

/**
 * Hosted: register SETUP_TOKEN (from the environment) once, while no organizer exists.
 * Re-registering the same token after it was used or expired does nothing.
 */
async function ensureEnvSetupToken(token, { ttlMs = TTL_MS } = {}) {
  const raw = String(token || '').trim();
  if (raw.length < 32) return { enabled: false, reason: 'SETUP_TOKEN missing or too short (need 32+ chars)' };
  const admins = await getDb().get('SELECT COUNT(*) AS n FROM admin_users');
  if (Number(admins.n) > 0) return { enabled: false, reason: 'organizer account already exists' };
  const hash = hashToken(raw);
  const row = await getDb().get('SELECT * FROM setup_tokens WHERE hash = ?', [hash]);
  if (row) {
    if (row.used_at) return { enabled: false, reason: 'setup token already used' };
    if (Date.parse(row.expires_at) <= Date.now()) return { enabled: false, reason: 'setup token expired', expiresAt: row.expires_at };
    return { enabled: true, created: false, expiresAt: row.expires_at };
  }
  const expiresAt = new Date(Date.now() + ttlMs).toISOString();
  await getDb().run(
    `INSERT INTO setup_tokens (hash, source, created_at, expires_at, used_at) VALUES (?, ?, ?, ?, NULL)
     ON CONFLICT (hash) DO NOTHING`,
    [hash, 'env', nowIso(), expiresAt]
  );
  return { enabled: true, created: true, expiresAt };
}

async function createToken({ purpose = 'owner', grantId = null, source = 'generated', ttlMs = TTL_MS } = {}) {
  const token = crypto.randomBytes(32).toString('base64url');
  const expiresAt = new Date(Date.now() + ttlMs).toISOString();
  await getDb().run(
    'INSERT INTO setup_tokens (hash, source, created_at, expires_at, used_at, purpose, grant_id) VALUES (?, ?, ?, ?, NULL, ?, ?)',
    [hashToken(token), source, nowIso(), expiresAt, purpose || 'owner', grantId]
  );
  return { token, expiresAt, purpose, grantId };
}

async function inspectToken(token) {
  const provided = String(token || '');
  if (!provided) return { ok: false, reason: 'invalid' };
  const row = await getDb().get('SELECT * FROM setup_tokens WHERE hash = ?', [hashToken(provided)]);
  if (!row) return { ok: false, reason: 'invalid' };
  if (row.used_at) return { ok: false, reason: 'used' };
  if (!row.expires_at || Date.parse(row.expires_at) <= Date.now()) return { ok: false, reason: 'expired' };
  return {
    ok: true,
    expiresAt: row.expires_at,
    purpose: row.purpose || 'owner',
    grantId: row.grant_id || null,
    source: row.source,
  };
}

async function consumeToken(token) {
  const checked = await inspectToken(token);
  if (!checked.ok) return checked;
  const res = await getDb().run(
    'UPDATE setup_tokens SET used_at = ? WHERE hash = ? AND used_at IS NULL AND expires_at > ?',
    [nowIso(), hashToken(token), nowIso()]
  );
  if (res.changes !== 1) return { ok: false, reason: 'used' };
  return { ok: true };
}

function readLinkPath() {
  try {
    return fs.readFileSync(linkPath(), 'utf8').trim();
  } catch {
    return null;
  }
}

module.exports = {
  ensureSetupToken,
  ensureEnvSetupToken,
  createToken,
  inspectToken,
  consumeToken,
  readLinkPath,
  tokenPath,
  linkPath,
  hashToken,
  TTL_MS,
};
