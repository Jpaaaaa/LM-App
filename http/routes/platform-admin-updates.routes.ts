import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import type { FastifyInstance } from 'fastify'
import type {
  PlatformUpdateFileEntry,
  PlatformUpdateFilesResponse,
  PlatformUpdatePublishResponse,
  PlatformUpdateUploadResponse,
} from '@shared/types/app-update'

/**
 * Allowed artifact extensions. `electron-builder` on Windows emits `.exe`,
 * `.exe.blockmap`, and `latest.yml`. We also accept `.zip` and `.yaml` so
 * future channels (beta, alpha) or cross-platform builds work without changes.
 * Explicit allow-list is safer than a blocklist — no wildcards.
 */
const ALLOWED_EXT = new Set([
  '.yml',
  '.yaml',
  '.exe',
  '.blockmap',
  '.zip',
  '.dmg',
  '.appimage',
  '.deb',
  '.rpm',
])

/** Installer-style extensions — the ones a `latest.yml` can point at. */
const INSTALLER_EXT = new Set(['.exe', '.zip', '.dmg', '.appimage', '.deb', '.rpm'])

/** Regex pulling semver from an installer filename (e.g. `Bazar One Setup 1.2.3.exe`). */
const VERSION_FROM_NAME = /(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)\.(?:exe|zip|dmg|appimage|deb|rpm)$/i

/** Hash a file and return `{ sha512Base64, size }` — streams, so large installers don't OOM. */
async function hashFile(filePath: string): Promise<{ sha512Base64: string; size: number }> {
  const hash = crypto.createHash('sha512')
  let size = 0
  await new Promise<void>((resolve, reject) => {
    const s = fs.createReadStream(filePath)
    s.on('data', (chunk) => {
      const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
      size += buf.length
      hash.update(buf)
    })
    s.on('end', () => resolve())
    s.on('error', reject)
  })
  return { sha512Base64: hash.digest('base64'), size }
}

/**
 * Build an electron-updater-compatible `latest.yml` body pointing at a single
 * installer. Matches what `electron-builder` emits for the NSIS target — the
 * minimum set of fields `electron-updater` actually reads.
 */
function buildLatestYml(params: {
  version: string
  installerName: string
  sha512Base64: string
  size: number
  releaseDateIso: string
}): string {
  const { version, installerName, sha512Base64, size, releaseDateIso } = params
  return (
    `version: ${version}\n` +
    `files:\n` +
    `  - url: ${installerName}\n` +
    `    sha512: ${sha512Base64}\n` +
    `    size: ${size}\n` +
    `path: ${installerName}\n` +
    `sha512: ${sha512Base64}\n` +
    `releaseDate: '${releaseDateIso}'\n`
  )
}

/** Safe filename: no path separators, no parent refs, not hidden. */
function sanitizeFilename(name: string): string | null {
  const base = path.basename(name).trim()
  if (!base) return null
  if (base.startsWith('.')) return null
  if (base.includes('/') || base.includes('\\')) return null
  if (base === '.' || base === '..') return null
  const lower = base.toLowerCase()
  const ext =
    lower.endsWith('.exe.blockmap')
      ? '.blockmap'
      : path.extname(lower)
  if (!ALLOWED_EXT.has(ext)) return null
  return base
}

function listArtifactFiles(dir: string): PlatformUpdateFileEntry[] {
  if (!fs.existsSync(dir)) return []
  const entries = fs.readdirSync(dir, { withFileTypes: true })
  const files: PlatformUpdateFileEntry[] = []
  for (const e of entries) {
    if (!e.isFile()) continue
    if (e.name.endsWith('.part')) continue
    try {
      const stat = fs.statSync(path.join(dir, e.name))
      files.push({
        name: e.name,
        sizeBytes: stat.size,
        modifiedAtMs: stat.mtimeMs,
      })
    } catch {
      // skip transient fs errors
    }
  }
  files.sort((a, b) => b.modifiedAtMs - a.modifiedAtMs)
  return files
}

export type RegisterPlatformAdminUpdatesRoutesOptions = {
  /** Absolute path to the directory that holds `latest.yml` + installer files. */
  updatesDir: string
  /** Max allowed size per uploaded file, in bytes. Defaults to 1 GiB. */
  maxFileBytes?: number
}

export async function registerPlatformAdminUpdatesRoutes(
  app: FastifyInstance,
  opts: RegisterPlatformAdminUpdatesRoutesOptions,
): Promise<void> {
  const { updatesDir } = opts
  const maxFileBytes = opts.maxFileBytes ?? 1024 * 1024 * 1024 // 1 GiB

  /** List files currently in the updates folder. */
  app.get('/api/platform/admin/updates/files', async (_req, reply) => {
    const body: PlatformUpdateFilesResponse = {
      updatesDir,
      directoryExists: fs.existsSync(updatesDir),
      files: listArtifactFiles(updatesDir),
    }
    return reply.send(body)
  })

  /**
   * Upload one or more release artifacts. Accepts `multipart/form-data` with
   * any number of file parts. Each file is streamed to a `*.part` tempfile and
   * atomically renamed into place on success. Existing files are overwritten
   * (intentional — re-publishing a `latest.yml` is the common case).
   */
  app.post('/api/platform/admin/updates/upload', async (req, reply) => {
    if (!req.isMultipart()) {
      return reply.status(400).send({ error: 'EXPECTED_MULTIPART' })
    }

    try {
      fs.mkdirSync(updatesDir, { recursive: true })
    } catch (e) {
      return reply.status(500).send({
        error: 'MKDIR_FAILED',
        message: e instanceof Error ? e.message : String(e),
      })
    }

    const accepted: Array<{ name: string; sizeBytes: number; sha512Base64: string }> = []
    const rejected: Array<{ name: string; reason: string }> = []

    const parts = req.files({ limits: { fileSize: maxFileBytes } })
    try {
      for await (const part of parts) {
        const safeName = sanitizeFilename(part.filename)
        if (!safeName) {
          rejected.push({ name: part.filename, reason: 'INVALID_NAME_OR_EXT' })
          // Drain the stream so we don't leak file descriptors.
          part.file.resume()
          continue
        }

        const finalPath = path.join(updatesDir, safeName)
        const tmpPath = `${finalPath}.part`
        const hash = crypto.createHash('sha512')
        let bytes = 0
        let truncated = false

        await new Promise<void>((resolve, reject) => {
          const out = fs.createWriteStream(tmpPath)
          part.file.on('data', (chunk: Buffer) => {
            bytes += chunk.length
            hash.update(chunk)
          })
          part.file.on('limit', () => {
            truncated = true
          })
          part.file.on('error', reject)
          out.on('error', reject)
          out.on('finish', () => resolve())
          part.file.pipe(out)
        })

        if (truncated) {
          try { fs.unlinkSync(tmpPath) } catch { /* ignore */ }
          rejected.push({ name: safeName, reason: 'TOO_LARGE' })
          continue
        }

        try {
          fs.renameSync(tmpPath, finalPath)
        } catch (e) {
          try { fs.unlinkSync(tmpPath) } catch { /* ignore */ }
          rejected.push({
            name: safeName,
            reason: e instanceof Error ? e.message : 'RENAME_FAILED',
          })
          continue
        }

        accepted.push({
          name: safeName,
          sizeBytes: bytes,
          sha512Base64: hash.digest('base64'),
        })
      }
    } catch (e) {
      return reply.status(500).send({
        error: 'UPLOAD_FAILED',
        message: e instanceof Error ? e.message : String(e),
      })
    }

    const body: PlatformUpdateUploadResponse = {
      accepted,
      rejected,
      files: listArtifactFiles(updatesDir),
    }
    return reply.send(body)
  })

  /**
   * Publish a release: write a fresh `latest.yml` pointing at a named installer
   * that already lives in the updates folder. This is what tells clients that
   * a new version is live — electron-updater polls `latest.yml` for the
   * current version + SHA-512 and downloads the file at `path:`.
   *
   * Version is taken from the request body if provided, otherwise auto-parsed
   * from the filename (e.g. `Bazar One Setup 1.2.3.exe` → `1.2.3`).
   */
  app.post<{
    Body: { installer?: string; version?: string; releaseDate?: string }
  }>('/api/platform/admin/updates/publish', async (req, reply) => {
    const installerRaw = typeof req.body?.installer === 'string' ? req.body.installer : ''
    const safeName = sanitizeFilename(installerRaw)
    if (!safeName) {
      return reply.status(400).send({ error: 'INVALID_INSTALLER' })
    }
    const lower = safeName.toLowerCase()
    const ext = lower.endsWith('.exe.blockmap') ? '.blockmap' : path.extname(lower)
    if (!INSTALLER_EXT.has(ext)) {
      return reply.status(400).send({
        error: 'NOT_AN_INSTALLER',
        message: `Publish target must be one of ${[...INSTALLER_EXT].join(', ')}`,
      })
    }
    const installerPath = path.join(updatesDir, safeName)
    if (!fs.existsSync(installerPath)) {
      return reply.status(404).send({ error: 'INSTALLER_NOT_FOUND' })
    }

    let version = typeof req.body?.version === 'string' ? req.body.version.trim() : ''
    if (!version) {
      const m = safeName.match(VERSION_FROM_NAME)
      if (!m) {
        return reply.status(400).send({
          error: 'VERSION_REQUIRED',
          message:
            'Could not detect a version in the filename. Provide `version` in the request body (semver, e.g. 1.2.3).',
        })
      }
      version = m[1]
    }
    if (!/^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/.test(version)) {
      return reply.status(400).send({
        error: 'INVALID_VERSION',
        message: 'Version must be semver (e.g. 1.2.3 or 1.2.3-beta.1).',
      })
    }

    let hashed: { sha512Base64: string; size: number }
    try {
      hashed = await hashFile(installerPath)
    } catch (e) {
      return reply.status(500).send({
        error: 'HASH_FAILED',
        message: e instanceof Error ? e.message : String(e),
      })
    }

    const releaseDateIso =
      typeof req.body?.releaseDate === 'string' && req.body.releaseDate.trim()
        ? req.body.releaseDate.trim()
        : new Date().toISOString()

    const yml = buildLatestYml({
      version,
      installerName: safeName,
      sha512Base64: hashed.sha512Base64,
      size: hashed.size,
      releaseDateIso,
    })

    const ymlPath = path.join(updatesDir, 'latest.yml')
    const tmpPath = `${ymlPath}.part`
    try {
      fs.writeFileSync(tmpPath, yml, 'utf8')
      fs.renameSync(tmpPath, ymlPath)
    } catch (e) {
      try { fs.unlinkSync(tmpPath) } catch { /* ignore */ }
      return reply.status(500).send({
        error: 'WRITE_FAILED',
        message: e instanceof Error ? e.message : String(e),
      })
    }

    const body: PlatformUpdatePublishResponse = {
      version,
      installer: safeName,
      sha512: hashed.sha512Base64,
      sizeBytes: hashed.size,
      releaseDate: releaseDateIso,
      files: listArtifactFiles(updatesDir),
    }
    return reply.send(body)
  })

  /** Delete a single artifact by filename. */
  app.delete<{ Params: { name: string } }>(
    '/api/platform/admin/updates/files/:name',
    async (req, reply) => {
      const safeName = sanitizeFilename(req.params.name)
      if (!safeName) {
        return reply.status(400).send({ error: 'INVALID_NAME' })
      }
      const target = path.join(updatesDir, safeName)
      if (!fs.existsSync(target)) {
        return reply.status(404).send({ error: 'NOT_FOUND' })
      }
      try {
        const stat = fs.statSync(target)
        if (!stat.isFile()) {
          return reply.status(400).send({ error: 'NOT_A_FILE' })
        }
        fs.unlinkSync(target)
      } catch (e) {
        return reply.status(500).send({
          error: 'DELETE_FAILED',
          message: e instanceof Error ? e.message : String(e),
        })
      }
      const body: PlatformUpdateFilesResponse = {
        updatesDir,
        directoryExists: fs.existsSync(updatesDir),
        files: listArtifactFiles(updatesDir),
      }
      return reply.send(body)
    },
  )
}
