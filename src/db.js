'use strict';

const fs = require('fs');
const path = require('path');
const { config, isPostgres, ensureDataDir } = require('./config');

let impl = null;

const SQLITE_SCHEMA = [
  `CREATE TABLE IF NOT EXISTS schema_migrations (
    id INTEGER PRIMARY KEY,
    name TEXT UNIQUE NOT NULL,
    applied_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS admin_users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    created_at TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'owner',
    player_id INTEGER
  )`,
  `CREATE TABLE IF NOT EXISTS sessions (
    sid TEXT PRIMARY KEY,
    sess TEXT NOT NULL,
    expire BIGINT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS setup_tokens (
    hash TEXT PRIMARY KEY,
    source TEXT NOT NULL,
    created_at TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    used_at TEXT,
    purpose TEXT NOT NULL DEFAULT 'owner',
    grant_id INTEGER
  )`,
  `CREATE TABLE IF NOT EXISTS settings (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    group_name TEXT NOT NULL,
    invite_weekday INTEGER NOT NULL,
    invite_time TEXT NOT NULL,
    remind_weekday INTEGER NOT NULL,
    remind_time TEXT NOT NULL,
    auto_cancel_enabled INTEGER NOT NULL,
    cutoff_time TEXT NOT NULL,
    minimum_yes INTEGER NOT NULL,
    default_start_time TEXT NOT NULL,
    default_end_time TEXT NOT NULL,
    timezone TEXT NOT NULL,
    default_venue TEXT NOT NULL DEFAULT ''
  )`,
  `CREATE TABLE IF NOT EXISTS players (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    email TEXT NOT NULL UNIQUE,
    phone TEXT,
    active INTEGER NOT NULL DEFAULT 1,
    rsvp_token TEXT NOT NULL UNIQUE,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS game_nights (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    game_date TEXT NOT NULL UNIQUE,
    start_time TEXT NOT NULL,
    end_time TEXT NOT NULL,
    status TEXT NOT NULL,
    skip_reason TEXT,
    venue TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS rsvps (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    player_id INTEGER NOT NULL,
    game_night_id INTEGER NOT NULL,
    status TEXT NOT NULL,
    party_size INTEGER NOT NULL DEFAULT 1,
    message TEXT,
    message_visibility TEXT NOT NULL DEFAULT 'organizer',
    set_by_name TEXT,
    set_by_kind TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    UNIQUE (player_id, game_night_id),
    FOREIGN KEY (player_id) REFERENCES players(id) ON DELETE CASCADE,
    FOREIGN KEY (game_night_id) REFERENCES game_nights(id) ON DELETE CASCADE
  )`,
  `CREATE TABLE IF NOT EXISTS announcements (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    game_night_id INTEGER,
    audience TEXT NOT NULL,
    subject TEXT NOT NULL,
    body TEXT NOT NULL,
    recipient_count INTEGER NOT NULL DEFAULT 0,
    status TEXT NOT NULL,
    created_at TEXT NOT NULL,
    sent_at TEXT,
    FOREIGN KEY (game_night_id) REFERENCES game_nights(id) ON DELETE SET NULL
  )`,
  `CREATE TABLE IF NOT EXISTS job_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    job_type TEXT NOT NULL,
    payload TEXT NOT NULL,
    created_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS temp_organizer_grants (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    player_id INTEGER NOT NULL,
    admin_user_id INTEGER,
    starts_on TEXT NOT NULL,
    ends_on TEXT NOT NULL,
    revoked_at TEXT,
    granted_by INTEGER,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`,
];

function pgSchema() {
  return SQLITE_SCHEMA.map((sql) =>
    sql
      .replace(/INTEGER PRIMARY KEY AUTOINCREMENT/g, 'SERIAL PRIMARY KEY')
      
  );
}

function nowIso() {
  return new Date().toISOString();
}

function createSqlite(filePath) {
  if (filePath !== ':memory:') {
    ensureDataDir();
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
  }
  // Loaded lazily so a Postgres-only host never touches node:sqlite.
  const { DatabaseSync } = require('node:sqlite');
  const db = new DatabaseSync(filePath);
  db.exec('PRAGMA foreign_keys = ON');
  if (filePath !== ':memory:') {
    db.exec('PRAGMA journal_mode = WAL');
  }

  const api = {
    dialect: 'sqlite',
    raw: db,
    exec(sql) {
      db.exec(sql);
    },
    run(sql, params = []) {
      const stmt = db.prepare(sql);
      const info = stmt.run(...params);
      return { changes: Number(info.changes || 0), lastInsertRowid: Number(info.lastInsertRowid || 0) };
    },
    get(sql, params = []) {
      const stmt = db.prepare(sql);
      const row = stmt.get(...params);
      return row === undefined ? undefined : row;
    },
    all(sql, params = []) {
      const stmt = db.prepare(sql);
      return stmt.all(...params);
    },
    close() {
      db.close();
    },
  };
  return api;
}

function toPg(sql) {
  let i = 0;
  return sql.replace(/\?/g, () => '$' + (++i));
}

// INSERTs into tables with a SERIAL id get RETURNING id so callers can read lastInsertRowid
// the same way they do with SQLite.
function withReturning(sql) {
  if (!/^\s*INSERT\s/i.test(sql)) return sql;
  if (/\bRETURNING\b/i.test(sql)) return sql;
  if (/INSERT\s+INTO\s+(sessions|setup_tokens|settings)\b/i.test(sql)) return sql;
  return sql.replace(/;?\s*$/, ' RETURNING id');
}

async function createPostgres(url) {
  let pg;
  try {
    pg = require('pg');
  } catch {
    throw new Error('DATABASE_URL is Postgres but the optional "pg" package is not installed. Run npm install pg');
  }
  // COUNT(*) and BIGINT columns come back as strings by default; parse to numbers.
  pg.types.setTypeParser(20, (v) => (v === null ? null : Number(v)));
  const pool = new pg.Pool({ connectionString: url, ssl: sslFor(url), max: 5 });
  pool.on('error', (err) => console.error('[db] idle client error', err.message));

  async function query(sql, params = []) {
    return pool.query(toPg(withReturning(sql)), params);
  }

  const api = {
    dialect: 'postgres',
    raw: pool,
    async exec(sql) {
      await pool.query(sql);
    },
    async run(sql, params = []) {
      const res = await query(sql, params);
      const last = res.rows && res.rows[0] && res.rows[0].id;
      return { changes: res.rowCount || 0, lastInsertRowid: last != null ? Number(last) : 0 };
    },
    async get(sql, params = []) {
      const res = await query(sql, params);
      return res.rows[0];
    },
    async all(sql, params = []) {
      const res = await query(sql, params);
      return res.rows;
    },
    async close() {
      await pool.end();
    },
  };
  return api;
}

function sslFor(url) {
  if (/localhost|127\.0\.0\.1/i.test(url)) return false;
  if (/sslmode=disable/i.test(url)) return false;
  return { rejectUnauthorized: false };
}

function migrateSqlite(db) {
  for (const sql of SQLITE_SCHEMA) db.exec(sql);
}

async function migratePostgres(db) {
  for (const sql of pgSchema()) await db.exec(sql);
}

async function migrateAll(db) {
  if (db.dialect === 'postgres') await migratePostgres(db);
  else migrateSqlite(db);
  const { applySchemaUpdates } = require('./migrate');
  await applySchemaUpdates(db);
}

async function openDatabase(opts = {}) {
  if (impl) return impl;
  if (opts.databaseUrl) {
    impl = await createPostgres(opts.databaseUrl);
    await migrateAll(impl);
    return impl;
  }
  if (opts.sqlitePath) {
    impl = createSqlite(opts.sqlitePath);
    await migrateAll(impl);
    return impl;
  }
  if (isPostgres()) {
    impl = await createPostgres(config.databaseUrl);
    await migrateAll(impl);
    return impl;
  }
  impl = createSqlite(opts.file || config.sqlitePath);
  await migrateAll(impl);
  return impl;
}

function getDb() {
  if (!impl) throw new Error('Database has not been opened. Call openDatabase() first.');
  return impl;
}

function resetDbHandle() {
  impl = null;
}

async function closeDatabase() {
  const cur = impl;
  impl = null;
  if (cur) await cur.close();
}

function isAsyncDb(db) {
  return !!(db && db.dialect === 'postgres');
}

module.exports = {
  openDatabase,
  getDb,
  resetDbHandle,
  closeDatabase,
  isAsyncDb,
  nowIso,
  createSqlite,
  migrateSqlite,
};
