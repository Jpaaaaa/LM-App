import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

function resolvePlatformEnvPath(): string | null {
  const candidates = [
    path.join(__dirname, '.env'),
    path.join(process.cwd(), 'platform', '.env'),
    path.join(process.cwd(), '.env'),
  ]
  for (const p of candidates) {
    if (fs.existsSync(p)) return p
  }
  return null
}

/** Load `platform/.env` into `process.env` (idempotent). Call before reading platform env vars. */
export function loadPlatformEnvFile(): void {
  const envPath = resolvePlatformEnvPath()
  if (!envPath) return
  const raw = fs.readFileSync(envPath, 'utf8')
  for (const line of raw.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const eq = trimmed.indexOf('=')
    if (eq <= 0) continue
    const key = trimmed.slice(0, eq).trim()
    let val = trimmed.slice(eq + 1).trim()
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1)
    }
    const platformScoped = key.startsWith('PLATFORM_') || key.startsWith('AMAAN_')
    if (platformScoped || process.env[key] === undefined) process.env[key] = val
  }
}
