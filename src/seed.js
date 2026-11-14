'use strict';

const fs = require('fs');
const path = require('path');
const { config, ensureDataDir } = require('./config');
const { openDatabase, getDb, resetDbHandle } = require('./db');
const { hashPassword, randomPassword } = require('./crypto-util');
const auth = require('./auth');
const svc = require('./services');
const { todayISO } = require('./dates');

const SAMPLE_PLAYERS = [
  { name: 'Eric (Organizer)', email: 'eric@example.com', phone: null },
  { name: 'Mike', email: 'mike@example.com', phone: null },
  { name: 'Dave', email: 'dave@example.com', phone: null },
  { name: 'Tom', email: 'tom@example.com', phone: null },
  { name: 'Joe', email: 'joe@example.com', phone: null },
  { name: 'Sam', email: 'sam@example.com', phone: null },
  { name: 'Chris', email: 'chris@example.com', phone: null },
];

function writeCredentials(email, password) {
  ensureDataDir();
  const body =
    'Poker Group — local admin credentials\n' +
    '=====================================\n' +
    'This file is for local development only. Do not reuse this password in production.\n\n' +
    'email: ' + email + '\n' +
    'password: ' + password + '\n' +
    'login: ' + config.baseUrl + '/login\n';
  fs.writeFileSync(config.credentialsPath, body, { mode: 0o600 });
  return config.credentialsPath;
}

async function seedAdmin({ writeFile } = {}) {
  const existing = await auth.getAdminByEmail(config.adminEmail);
  if (existing) return { created: false, email: existing.email, credentialsPath: config.credentialsPath };
  // Hosted (Render): no generated password. The organizer account is created through the
  // one-time /setup/<SETUP_TOKEN> link instead, so no secret ever lives in the repo or logs.
  if (process.env.SETUP_TOKEN && !config.adminPassword) {
    return { created: false, email: null, credentialsPath: null, deferredToSetup: true };
  }
  const password = config.adminPassword || randomPassword(18);
  await auth.createAdmin(config.adminEmail, hashPassword(password));
  const shouldWrite = writeFile != null ? writeFile : !['test', 'production'].includes(process.env.NODE_ENV);
  const credentialsPath = shouldWrite ? writeCredentials(config.adminEmail, password) : null;
  return { created: true, email: config.adminEmail, credentialsPath, password: shouldWrite ? undefined : password };
}

async function seedPlayersAndGames() {
  await svc.ensureSettings();
  if ((await svc.listPlayers({ includeInactive: true })).length === 0) {
    for (const p of SAMPLE_PLAYERS) await svc.createPlayer({ ...p, active: true });
  }
  await svc.ensureUpcomingGames(26);
  const game = await svc.nextScheduledGame(todayISO());
  if (!game) return { game: null };

  const already = await getDb().get('SELECT COUNT(*) AS n FROM rsvps WHERE game_night_id = ?', [game.id]);
  if (Number(already.n) > 0) return { game, rsvpsSeeded: false };

  const byEmail = Object.fromEntries((await svc.listPlayers()).map((p) => [p.email, p]));
  const samples = [
    { email: 'eric@example.com', status: 'yes', party_size: 1, message: 'Hosting as usual.', message_visibility: 'group' },
    { email: 'mike@example.com', status: 'yes', party_size: 2, message: 'Bringing a guest.', message_visibility: 'group' },
    { email: 'dave@example.com', status: 'yes', party_size: 1, message: '', message_visibility: 'organizer' },
    { email: 'tom@example.com', status: 'maybe', party_size: 1, message: 'Might be late.', message_visibility: 'organizer' },
    { email: 'joe@example.com', status: 'no', party_size: 1, message: 'Out of town.', message_visibility: 'group' },
  ];
  for (const s of samples) {
    const p = byEmail[s.email];
    if (p) await svc.saveRsvp(p.id, game.id, s);
  }
  return { game, rsvpsSeeded: true };
}

async function seed({ sqlitePath } = {}) {
  if (sqlitePath) {
    resetDbHandle();
    await openDatabase({ sqlitePath });
  } else {
    await openDatabase();
  }
  const admin = await seedAdmin();
  const games = await seedPlayersAndGames();
  return { admin, games };
}

if (require.main === module) {
  seed()
    .then((result) => {
      console.log('Seed complete.');
      console.log('Admin email:', result.admin.email);
      console.log('Admin credentials file:', result.admin.credentialsPath);
      if (result.admin.created) console.log('Created a new admin account. Password is in the credentials file.');
      else console.log('Admin already existed; password was not changed.');
      if (result.games.game) console.log('Next scheduled game:', result.games.game.game_date);
    })
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}

module.exports = { seed, seedAdmin, seedPlayersAndGames, SAMPLE_PLAYERS, writeCredentials };
