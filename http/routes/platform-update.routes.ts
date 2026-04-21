import fs from 'node:fs'
import path from 'node:path'
import type { FastifyInstance } from 'fastify'
import type {
  PlatformUpdateLatestResponse,
  PlatformUpdateManifest,
} from '../../shared/types/app-update.js'

/**
 * Minimal `latest.yml` reader — pulls version / path / sha512 / releaseDate
 * without taking a YAML parser dep. electron-builder's `latest.yml` is stable
 * and uses simple key: value lines, so regex extraction is sufficient for the
 * admin UI's informational view. Clients use electron-updater, which reads
 * the raw YAML directly from `/updates/latest.yml`.
 */
function readLatestYml(updatesDir: string): PlatformUpdateManifest | null {
  const ymlPath = path.join(updatesDir, 'latest.yml')
  if (!fs.existsSync(ymlPath)) return null
  let raw: string
  try {
    raw = fs.readFileSync(ymlPath, 'utf8')
  } catch {
    return null
  }

  const version = matchLine(raw, /^version:\s*(.+)\s*$/m)
  if (!version) return null

  const topPath = matchLine(raw, /^path:\s*(.+)\s*$/m)
  const topSha = matchLine(raw, /^sha512:\s*(.+)\s*$/m)
  const firstFile = extractFirstFilesEntry(raw)

  const effectivePath = topPath ?? firstFile?.url ?? ''
  const effectiveSha = topSha ?? firstFile?.sha512 ?? null
  const releaseDate = matchLine(raw, /^releaseDate:\s*["']?([^"'\r\n]+)["']?\s*$/m)

  return {
    version: String(version).replace(/^['"]|['"]$/g, ''),
    path: String(effectivePath).replace(/^['"]|['"]$/g, ''),
    sha512: effectiveSha ? String(effectiveSha).replace(/^['"]|['"]$/g, '') : null,
    releaseDate: releaseDate ? String(releaseDate) : null,
  }
}

function matchLine(raw: string, re: RegExp): string | null {
  const m = raw.match(re)
  return m?.[1]?.trim() ?? null
}

/** Grab the first entry under a `files:` list (url + sha512). */
function extractFirstFilesEntry(raw: string): { url: string; sha512: string | null } | null {
  const filesIdx = raw.indexOf('\nfiles:')
  if (filesIdx === -1) return null
  const tail = raw.slice(filesIdx)
  const urlMatch = tail.match(/^\s*-\s*url:\s*(.+)\s*$/m)
  if (!urlMatch) return null
  const shaMatch = tail.match(/^\s*sha512:\s*(.+)\s*$/m)
  return {
    url: urlMatch[1].trim().replace(/^['"]|['"]$/g, ''),
    sha512: shaMatch ? shaMatch[1].trim().replace(/^['"]|['"]$/g, '') : null,
  }
}

export type RegisterPlatformUpdateRoutesOptions = {
  /** Absolute path to the directory that holds `latest.yml` + installer files. */
  updatesDir: string
}

export async function registerPlatformUpdateRoutes(
  app: FastifyInstance,
  opts: RegisterPlatformUpdateRoutesOptions,
): Promise<void> {
  const { updatesDir } = opts

  app.get('/api/platform/update/latest', async (_req, reply) => {
    const manifest = readLatestYml(updatesDir)
    const body: PlatformUpdateLatestResponse = manifest ?? { empty: true }
    return reply.send(body)
  })

  app.get('/api/platform/update/health', async (_req, reply) => {
    const exists = fs.existsSync(updatesDir)
    const ymlExists = exists && fs.existsSync(path.join(updatesDir, 'latest.yml'))
    return reply.send({
      ok: true,
      updatesDir,
      directoryExists: exists,
      latestYmlExists: ymlExists,
    })
  })
}
