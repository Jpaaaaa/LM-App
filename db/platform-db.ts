import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import initSqlJs, { type Database as SqlDatabase } from 'sql.js'
import { runPlatformSchemaBootstrap } from './platform-schema.bootstrap'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

function sqlJsDistDir(): string {
  return path.join(__dirname, '..', '..', 'node_modules', 'sql.js', 'dist')
}

let db: SqlDatabase | null = null
let dbFilePath: string | null = null

export async function initPlatformDb(dbPath: string): Promise<void> {
  const SQL = await initSqlJs({
    locateFile: (file: string) => path.join(sqlJsDistDir(), file),
  })

  dbFilePath = dbPath
  const dir = path.dirname(dbPath)
  fs.mkdirSync(dir, { recursive: true })

  let database: SqlDatabase
  if (fs.existsSync(dbPath)) {
    database = new SQL.Database(fs.readFileSync(dbPath))
  } else {
    database = new SQL.Database()
  }

  database.run('PRAGMA foreign_keys = ON')
  runPlatformSchemaBootstrap(database)
  db = database
  persistPlatformDb()
}

export function getPlatformDb(): SqlDatabase {
  if (!db) throw new Error('Platform database not initialized')
  return db
}

export function persistPlatformDb(): void {
  if (!db || !dbFilePath) return
  fs.mkdirSync(path.dirname(dbFilePath), { recursive: true })
  fs.writeFileSync(dbFilePath, Buffer.from(db.export()))
}
