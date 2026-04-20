import type { Database as SqlDatabase } from 'sql.js'

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
      notes TEXT
    );
  `)
}
