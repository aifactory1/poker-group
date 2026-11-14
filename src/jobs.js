'use strict';

/**
 * In-process scheduler for later deployment (e.g. Railway).
 * Jobs compare America/Phoenix wall time to Settings and call the stubbed
 * notify layer. Disabled unless RUN_JOBS=1. Safe to invoke on demand
 * from the Settings screen.
 */

const svc = require('./services');
const { todayISO, nowTimeHHMM, weekdayUTC } = require('./dates');

let timer = null;
let lastRunKey = {
  invite: '',
  reminder: '',
  auto_cancel: '',
};

function mark(name, iso, hhmm) {
  lastRunKey[name] = iso + 'T' + hhmm;
}

function already(name, iso, hhmm) {
  return lastRunKey[name] === iso + 'T' + hhmm;
}

async function tick(now = new Date()) {
  const st = await svc.getSettings();
  const iso = todayISO(now);
  const hhmm = nowTimeHHMM(now);
  const dow = weekdayUTC(iso);

  if (dow === Number(st.invite_weekday) && hhmm >= st.invite_time && !already('invite', iso, st.invite_time)) {
    const result = await svc.runInviteJob(now);
    mark('invite', iso, st.invite_time);
    console.log('[jobs] invite', result.ok ? 'ok count=' + result.count : result.reason);
  }
  if (dow === Number(st.remind_weekday) && hhmm >= st.remind_time && !already('reminder', iso, st.remind_time)) {
    const result = await svc.runReminderJob(now);
    mark('reminder', iso, st.remind_time);
    console.log('[jobs] reminder', result.ok ? 'ok count=' + result.count : result.reason);
  }
  if (hhmm >= st.cutoff_time && !already('auto_cancel', iso, st.cutoff_time)) {
    const result = await svc.runAutoCancelJob(now);
    mark('auto_cancel', iso, st.cutoff_time);
    if (result.ok || (result.reason && !/not a game night|turned off/.test(result.reason))) {
      console.log('[jobs] auto-cancel', result);
    }
  }
}

function start(intervalMs = 60 * 1000) {
  if (timer) return;
  console.log('[jobs] in-process scheduler started (log-only notifications)');
  timer = setInterval(async () => {
    try {
      await tick();
    } catch (err) {
      console.error('[jobs] tick failed', err);
    }
  }, intervalMs);
  if (typeof timer.unref === 'function') timer.unref();
}

function stop() {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}

module.exports = { start, stop, tick, lastRunKey };
