'use strict';

const { openDatabase, resetDbHandle, getDb } = require('../src/db');

/**
 * Tests run against in-memory SQLite by default. Set TEST_DATABASE_URL to a throwaway
 * Postgres database to run the same suite against the Postgres adapter (tables are wiped).
 */
async function openTestDatabase() {
  resetDbHandle();
  const url = process.env.TEST_DATABASE_URL;
  if (!url) return openDatabase({ sqlitePath: ':memory:' });
  await openDatabase({ databaseUrl: url });
  await getDb().exec(
    'TRUNCATE rsvps, announcements, job_logs, game_nights, players, admin_users, sessions, settings, setup_tokens, temp_organizer_grants RESTART IDENTITY CASCADE'
  );
  return getDb();
}

async function closeTestDatabase() {
  const { closeDatabase } = require('../src/db');
  await closeDatabase();
}

module.exports = { openTestDatabase, closeTestDatabase };
