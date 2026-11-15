'use strict';

const GRANTS_SQL = `CREATE TABLE IF NOT EXISTS temp_organizer_grants (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  player_id INTEGER NOT NULL,
  admin_user_id INTEGER,
  starts_on TEXT NOT NULL,
  ends_on TEXT NOT NULL,
  revoked_at TEXT,
  granted_by INTEGER,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
)`;

const ALTERS = [
  { table: 'settings', column: 'default_venue', ddl: "TEXT NOT NULL DEFAULT ''" },
  { table: 'game_nights', column: 'venue', ddl: 'TEXT' },
  { table: 'rsvps', column: 'set_by_name', ddl: 'TEXT' },
  { table: 'rsvps', column: 'set_by_kind', ddl: 'TEXT' },
  { table: 'admin_users', column: 'role', ddl: "TEXT NOT NULL DEFAULT 'owner'" },
  { table: 'admin_users', column: 'player_id', ddl: 'INTEGER' },
  { table: 'setup_tokens', column: 'purpose', ddl: "TEXT NOT NULL DEFAULT 'owner'" },
  { table: 'setup_tokens', column: 'grant_id', ddl: 'INTEGER' },
];

async function tableColumns(db, table) {
  if (db.dialect === 'postgres') {
    const rows = await db.all(
      `SELECT column_name AS name
       FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = ?`,
      [table]
    );
    return (rows || []).map((r) => r.name);
  }
  const rows = await db.all('PRAGMA table_info(' + table + ')');
  return (rows || []).map((r) => r.name);
}

async function addColumnIfMissing(db, table, column, ddl) {
  const cols = await tableColumns(db, table);
  if (cols.includes(column)) return false;
  await db.exec('ALTER TABLE ' + table + ' ADD COLUMN ' + column + ' ' + ddl);
  return true;
}

async function applySchemaUpdates(db) {
  const grantsSql =
    db.dialect === 'postgres'
      ? GRANTS_SQL.replace(/INTEGER PRIMARY KEY AUTOINCREMENT/g, 'SERIAL PRIMARY KEY')
      : GRANTS_SQL;
  await db.exec(grantsSql);
  for (const a of ALTERS) {
    await addColumnIfMissing(db, a.table, a.column, a.ddl);
  }
  // Existing organizer rows created before this column should be owners.
  if (db.dialect === 'postgres') {
    await db.exec(`UPDATE admin_users SET role = 'owner' WHERE role IS NULL OR role = ''`);
  }
}

module.exports = { applySchemaUpdates, tableColumns };
