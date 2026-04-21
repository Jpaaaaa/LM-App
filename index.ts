import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { startPlatformServer } from './http/platform-server.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

const dbPath = process.env.PLATFORM_DB_PATH ?? path.join(process.cwd(), 'platform-data', 'platform.db')
const port = Number(process.env.PLATFORM_PORT ?? 3850)
const webDistPath = path.join(__dirname, 'web', 'dist')
const updatesDir = process.env.PLATFORM_UPDATES_DIR ?? path.join(process.cwd(), 'platform-data', 'updates')

async function main(): Promise<void> {
  if (!process.env.PLATFORM_ADMIN_PASSWORD_BCRYPT?.trim()) {
    console.error('Set PLATFORM_ADMIN_PASSWORD_BCRYPT (bcrypt hash of the admin password).')
    process.exit(1)
  }
  await startPlatformServer({
    dbPath,
    port,
    webDist: fs.existsSync(webDistPath) ? webDistPath : undefined,
    updatesDir,
  })
  console.log(`Platform API listening on http://0.0.0.0:${port}`)
  console.log(`DB: ${dbPath}`)
  console.log(`Updates dir: ${updatesDir}`)
  const adminUser = process.env.PLATFORM_ADMIN_USERNAME?.trim() || 'admin'
  console.log(`Admin login: username=${adminUser} (session cookie; change password via new bcrypt hash in env).`)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
