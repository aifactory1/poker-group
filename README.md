# Poker Group

A small web app for Eric’s Monday nickel-dime poker night. It replaces a Punchbowl-style invite with a recurring Monday calendar, private RSVP links, and an organizer admin panel.

Phase 1 runs entirely on your computer (or later on a host such as Railway). **No email or SMS is actually sent.** Invitation, reminder, auto-cancel, and announcement jobs are implemented but only write a log so a real provider can be hooked up later.

## Features (phase 1)

- Organizer login (single admin, hashed password, session cookie)
- Player add / edit / delete, optional phone, private RSVP token per player
- Recurring Monday calendar: skip or restore a night, edit times
- U.S. federal holidays are **computed** for any year (including weekend observance). Holiday Mondays start as skipped and can be restored
- Private RSVP page (no sign-in): Yes / No / Maybe, party size, optional message, visibility “Only the organizer” (default) or “Everyone in Poker Group”
- “Who’s playing” view shows public messages only
- Dashboard tallies for the next scheduled game. Guests count toward the minimum; Maybe does not
- Settings: group name (Poker Group), Friday 10:00 invites, Sunday 10:00 reminders to non-responders, auto-cancel on by default at 4:00 PM game day, minimum 5
- Announcements: choose coming / not coming / everyone, see a recipient count and preview, “send” is log-only

## How to run locally

You need Node.js 20 or later.

```bash
cd poker-group-app
cp .env.example .env   # optional; defaults work for local use
npm install
npm start
```

Then open [http://localhost:3000](http://localhost:3000).

The first start creates a SQLite database at `data/poker-group.db`, seeds sample `@example.com` players, and creates the organizer account.

**Organizer login** can be set through a one-time setup link at `/setup/<token>`. The first start creates a single-use token (48-hour expiry) and writes the path to `data/setup-link.txt` (gitignored; the token is stored hashed in `data/setup-token.json`). Open that page, choose your login email (default `eric@example.com`) and a password of at least 8 characters. After it is used, the link no longer works.

For purely local development, a generated password may also be written to `data/admin-credentials.txt` (gitignored). Do not share either file or any password in chat. If the credentials file already exists from a previous seed, the password is not rotated until you use the setup link.

```bash
npm test          # automated tests
npm run seed      # re-apply seed data (does not wipe existing players)
```

## Configuration

See `.env.example`. The important variables:

| Variable | Purpose |
| --- | --- |
| `PORT` | Listen port (default `3000`) |
| `SQLITE_PATH` | Local SQLite file (default `./data/poker-group.db`) |
| `DATABASE_URL` | If set to a `postgres://` URL, the app uses Postgres instead (install optional `pg`) |
| `SESSION_SECRET` | Cookie signing secret — set a long random value before deploying |
| `ADMIN_EMAIL` / `ADMIN_PASSWORD` | Used only when creating the first admin |
| `BASE_URL` | Absolute origin used in RSVP links in the (stubbed) invite log |
| `RUN_JOBS=1` | Start the in-process scheduler (still log-only) |

Times are always America/Phoenix (Arizona does not observe daylight saving).

## Deploying later (Railway)

This is ready to deploy later; nothing has been purchased or signed up in this phase.

1. Create a Railway project and a Postgres plugin when you are ready.
2. Set `DATABASE_URL`, `SESSION_SECRET`, `BASE_URL`, `ADMIN_EMAIL`, and `ADMIN_PASSWORD`.
3. The start command is `npm start` (or the included `Procfile`).
4. Add a cron or keep `RUN_JOBS=1` for Friday invites, Sunday reminders, and the game-day cutoff. Hook `src/notify.js` to a real email/SMS provider when you want messages to go out.

Until then, keep using Punchbowl (paid through June 2027) and develop locally for free.

## Project layout

```
src/           Express app, database, services, routes, jobs
views/         EJS pages (admin + RSVP)
public/        CSS and a little RSVP/calendar JavaScript
tests/         Holiday math, services, and HTTP flow tests
data/          SQLite database and admin-credentials.txt (local)
screenshots/   Captured page shots from a local run
```

## Sample data

Seeded players: Eric (organizer), Mike, Dave, Tom, Joe, Sam, and Chris, all `@example.com`. The next scheduled Monday is pre-filled with a few RSVPs so the dashboard is not empty.

## Hosting on Render (test site)

The test site runs on Render's free plan with a free Render Postgres database
(the web service disk is temporary, so all data lives in Postgres).

- Build: `npm ci --omit=dev` · Start: `npm start` · Health check: `/health`
- Environment (set in the Render dashboard, never in the repo): `DATABASE_URL`,
  `SESSION_SECRET`, `SETUP_TOKEN`, `BASE_URL`, `NODE_ENV=production`, `RUN_JOBS=0`,
  `TZ=America/Phoenix`
- On first boot with an empty database the app seeds sample `@example.com` players and
  next-Monday RSVPs. No organizer password is generated; instead `/setup/<SETUP_TOKEN>`
  works once (7-day expiry) so the organizer can choose a password.
- Free-tier notes: the service sleeps after ~15 minutes idle and takes up to a minute to
  wake; free Postgres databases expire after 30 days.

Run the test suite against Postgres with `TEST_DATABASE_URL=postgres://... npm test`
(the target database's tables are wiped).
