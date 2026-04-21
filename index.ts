import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { startPlatformServer } from './http/platform-server.js'
import { loadPlatformEnvFile } from './load-env.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

loadPlatformEnvFile()

const dbPath = process.env.PLATFORM_DB_PATH ?? path.join(process.cwd(), 'platform-data', 'platform.db')
const port = Number(process.env.PLATFORM_PORT ?? 3850)
const webDistPath = path.join(__dirname, 'web', 'dist')
const updatesDir = process.env.PLATFORM_UPDATES_DIR ?? path.join(process.cwd(), 'platform-data', 'updates')

async function main(): Promise<void> {
  await startPlatformServer({
    dbPath,
    port,
    webDist: fs.existsSync(webDistPath) ? webDistPath : undefined,
    updatesDir,
  })
  console.log(`Platform API listening on http://0.0.0.0:${port}`)
  console.log(`DB: ${dbPath}`)
  console.log(`Updates dir: ${updatesDir}`)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
