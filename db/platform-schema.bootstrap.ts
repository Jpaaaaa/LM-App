import type { Database as SqlDatabase } from 'sql.js'

function ensureRollingMaxColumn(database: SqlDatabase): void {
  const stmt = database.prepare(
    "SELECT 1 FROM pragma_table_info('platform_devices') WHERE name = 'rolling_max_ms' LIMIT 1",
  )
  const exists = stmt.step()
  stmt.free()
  if (!exists) {
    database.run('ALTER TABLE platform_devices ADD COLUMN rolling_max_ms INTEGER')
  }
}

export function runPlatformSchemaBootstrap(database: SqlDatabase): void {
  database.run(`
    CREATE TABLE IF NOT EXISTS platform_devices (
      machine_id TEXT PRIMARY KEY,
      label TEXT,
      tier TEXT NOT NULL,
      expires_at_ms INTEGER,
      revoked INTEGER NOT NULL DEFAULT 0,
      last_sync_at_ms INTEGER,
      created_at_ms INTEGER NOT NULL,
      updated_at_ms INTEGER NOT NULL,
      notes TEXT,
      rolling_max_ms INTEGER
    );
  `)
  ensureRollingMaxColumn(database)
}
