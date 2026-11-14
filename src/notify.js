'use strict';

/**
 * Notification stub. Phase 1 never sends real email or SMS.
 * All outbound messages are written to job_logs and stdout so a later
 * provider (email/SMS) can hook in here without changing callers.
 */

const { getDb, nowIso } = require('./db');

async function log(jobType, payload) {
  const db = getDb();
  const record = {
    job_type: jobType,
    at: nowIso(),
    ...payload,
  };
  const json = JSON.stringify(record, null, 2);
  console.log('[notify:stub]', jobType, json);
  await db.run('INSERT INTO job_logs (job_type, payload, created_at) VALUES (?, ?, ?)', [
    jobType,
    json,
    nowIso(),
  ]);
  return record;
}

async function sendEmail({ to, subject, text, html, meta }) {
  return await log('email', { to, subject, text, html: html || null, meta: meta || null, delivered: false, stub: true });
}

async function sendSms({ to, text, meta }) {
  return await log('sms', { to, subject: null, text, meta: meta || null, delivered: false, stub: true });
}

async function recentLogs(limit = 20) {
  const db = getDb();
  return await db.all('SELECT * FROM job_logs ORDER BY id DESC LIMIT ?', [limit]);
}

module.exports = { sendEmail, sendSms, log, recentLogs };
