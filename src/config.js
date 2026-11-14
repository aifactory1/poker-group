'use strict';

const path = require('path');
const fs = require('fs');

const ROOT = path.join(__dirname, '..');

// Load .env if present; missing file is fine.
require('dotenv').config({ path: path.join(ROOT, '.env') });

function intEnv(name, fallback) {
  const raw = process.env[name];
  if (raw == null || raw === '') return fallback;
  const n = Number(raw);
  return Number.isFinite(n) ? n : fallback;
}

const config = {
  root: ROOT,
  port: intEnv('PORT', 3000),
  timezone: process.env.TZ || 'America/Phoenix',
  groupName: 'Poker Group',
  sessionSecret: process.env.SESSION_SECRET || 'dev-only-session-secret-change-me',
  databaseUrl: process.env.DATABASE_URL || '',
  sqlitePath: process.env.SQLITE_PATH
    ? path.resolve(process.env.SQLITE_PATH)
    : path.join(ROOT, 'data', 'poker-group.db'),
  adminEmail: process.env.ADMIN_EMAIL || 'eric@example.com',
  adminPassword: process.env.ADMIN_PASSWORD || '',
  credentialsPath: path.join(ROOT, 'data', 'admin-credentials.txt'),
  runJobs: process.env.RUN_JOBS === '1',
  baseUrl: (process.env.BASE_URL || 'http://localhost:3000').replace(/\/$/, ''),
  nodeEnv: process.env.NODE_ENV || 'development',
};

function isPostgres() {
  const url = config.databaseUrl;
  return /^postgres(ql)?:\/\//i.test(url);
}

function ensureDataDir() {
  const dir = path.dirname(isPostgres() ? config.sqlitePath : config.sqlitePath);
  const dataDir = path.join(ROOT, 'data');
  fs.mkdirSync(dataDir, { recursive: true });
  return dir;
}

module.exports = { config, isPostgres, ensureDataDir, ROOT };
