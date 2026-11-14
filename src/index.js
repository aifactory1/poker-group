'use strict';

const { config, isPostgres } = require('./config');
const { openDatabase } = require('./db');
const { seed } = require('./seed');
const { createApp } = require('./app');
const jobs = require('./jobs');
const setupToken = require('./setup-token');

async function main() {
  if (config.nodeEnv === 'production' && !process.env.SESSION_SECRET) {
    throw new Error('SESSION_SECRET must be set in production.');
  }
  await openDatabase();
  console.log('Database: ' + (isPostgres() ? 'Postgres (DATABASE_URL)' : 'SQLite ' + config.sqlitePath));
  const result = await seed();
  if (result.admin.created && result.admin.credentialsPath) {
    console.log('Created organizer login. Credentials: ' + result.admin.credentialsPath);
  }
  if (process.env.LOG_SAMPLE_RSVP_LINKS === '1') {
    // Test site only: sample players use fake @example.com addresses, so their links are safe to log.
    const svc = require('./services');
    for (const p of await svc.listPlayers({ includeInactive: false })) {
      if (/@example\.com$/i.test(p.email)) console.log('Sample RSVP link: ' + p.name + ' ' + svc.rsvpUrl(p));
    }
  }
  if (result.games && result.games.rsvpsSeeded) console.log('Seeded sample RSVPs for ' + result.games.game.game_date);

  if (process.env.SETUP_TOKEN) {
    const ttlHours = Number(process.env.SETUP_TOKEN_TTL_HOURS) || 7 * 24;
    const env = await setupToken.ensureEnvSetupToken(process.env.SETUP_TOKEN, { ttlMs: ttlHours * 3600 * 1000 });
    if (env.enabled) console.log('One-time organizer setup link is enabled (from SETUP_TOKEN). Expires ' + env.expiresAt);
    else console.log('Organizer setup link not enabled: ' + env.reason);
  } else if (config.nodeEnv !== 'production') {
    const setup = await setupToken.ensureSetupToken();
    if (setup.created) {
      console.log('One-time organizer setup link written to data/setup-link.txt (expires in 48 hours, single use).');
    } else {
      console.log('A valid unused organizer setup link already exists in data/setup-link.txt.');
    }
  }

  const app = createApp();
  // Hosts like Render need 0.0.0.0; local dev stays on loopback unless HOST is set.
  const host = process.env.HOST || (config.nodeEnv === 'production' ? '0.0.0.0' : '127.0.0.1');
  const server = app.listen(config.port, host, () => {
    console.log('Poker Group listening on ' + config.baseUrl + ' (' + host + ':' + config.port + ')');
    console.log('Notifications are log-only. No email or SMS is sent.');
  });
  if (config.runJobs) jobs.start();
  return server;
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}

module.exports = { main };
