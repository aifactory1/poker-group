'use strict';

const session = require('express-session');
const { getDb } = require('./db');

/**
 * express-session store backed by the app database (SQLite locally, Postgres on Render).
 */
class SqliteSessionStore extends session.Store {
  constructor(options = {}) {
    super(options);
    this.ttl = options.ttl || 7 * 24 * 60 * 60; // seconds
  }

  get(sid, cb) {
    (async () => {
      const row = await getDb().get('SELECT sess, expire FROM sessions WHERE sid = ?', [sid]);
      if (!row) return null;
      if (Number(row.expire) < Date.now()) {
        await getDb().run('DELETE FROM sessions WHERE sid = ?', [sid]);
        return null;
      }
      return JSON.parse(row.sess);
    })().then((s) => cb(null, s), cb);
  }

  set(sid, sess, cb) {
    const expire = Date.now() + this.ttl * 1000;
    const payload = JSON.stringify(sess);
    Promise.resolve(
      getDb().run(
        `INSERT INTO sessions (sid, sess, expire) VALUES (?, ?, ?)
         ON CONFLICT (sid) DO UPDATE SET sess = excluded.sess, expire = excluded.expire`,
        [sid, payload, expire]
      )
    ).then(() => cb && cb(null), (err) => cb && cb(err));
  }

  destroy(sid, cb) {
    Promise.resolve(getDb().run('DELETE FROM sessions WHERE sid = ?', [sid])).then(
      () => cb && cb(null),
      (err) => cb && cb(err)
    );
  }

  touch(sid, sess, cb) {
    const expire = Date.now() + this.ttl * 1000;
    Promise.resolve(getDb().run('UPDATE sessions SET expire = ? WHERE sid = ?', [expire, sid])).then(
      () => cb && cb(null),
      (err) => cb && cb(err)
    );
  }
}

module.exports = { SqliteSessionStore };
