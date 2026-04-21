import fs from 'node:fs'
import path from 'node:path'
import cookie from '@fastify/cookie'
import cors from '@fastify/cors'
import fastifyMultipart from '@fastify/multipart'
import fastifyStatic from '@fastify/static'
import Fastify from 'fastify'
import { initPlatformDb } from '../db/platform-db.js'
import { requireAdminSession } from './auth/require-admin.js'
import { registerPlatformAuthRoutes } from './routes/platform-auth.routes.js'
import { registerPlatformAdminRoutes } from './routes/platform-admin.routes.js'
import { registerPlatformAdminUpdatesRoutes } from './routes/platform-admin-updates.routes.js'
import { registerPlatformPingRoutes } from './routes/platform-ping.routes.js'
import { registerPlatformUpdateRoutes } from './routes/platform-update.routes.js'

export type StartPlatformServerOptions = {
  dbPath: string
  port: number
  host?: string
  /** If set and exists, serve admin UI (e.g. platform/web/dist) */
  webDist?: string
  /**
   * Directory that holds auto-update artifacts (`latest.yml`, `*.exe`, `*.exe.blockmap`).
   * Served under `/updates/*`. Created if missing.
   */
  updatesDir?: string
}

export async function startPlatformServer(opts: StartPlatformServerOptions): Promise<void> {
  await initPlatformDb(opts.dbPath)

  // Fastify's default body limit (1 MiB) is far too small for installer
  // uploads; raise it so large multipart requests aren't rejected before the
  // per-file limit in `@fastify/multipart` kicks in.
  const app = Fastify({ logger: true, bodyLimit: 2 * 1024 * 1024 * 1024 })
  const sessionSecret = process.env.PLATFORM_SESSION_SECRET?.trim()
  if (!sessionSecret) {
    throw new Error('PLATFORM_SESSION_SECRET is required (use a long random string)')
  }
  await app.register(cookie, {
    secret: sessionSecret,
    hook: 'onRequest',
  })
  await app.register(cors, { origin: true, credentials: true })
  await app.register(fastifyMultipart, {
    limits: {
      // Per-file cap; matches the default in registerPlatformAdminUpdatesRoutes.
      fileSize: 1024 * 1024 * 1024,
      files: 10,
    },
  })

  app.get('/api/platform/health', async () => ({
    ok: true,
    service: 'amaan-platform',
  }))

  await registerPlatformPingRoutes(app)

  // Serve Electron auto-update artifacts under /updates/ and expose a JSON manifest
  // endpoint at /api/platform/update/latest for the admin UI. The directory is
  // created if missing so ops can SFTP a new `latest.yml` into it at any time.
  const updatesDir = path.resolve(opts.updatesDir ?? path.join(process.cwd(), 'platform-data', 'updates'))
  try {
    fs.mkdirSync(updatesDir, { recursive: true })
  } catch {
    // non-fatal: route still returns `empty: true` and static falls through
  }
  await app.register(fastifyStatic, {
    root: updatesDir,
    prefix: '/updates/',
    decorateReply: false,
    list: false,
  })
  await registerPlatformUpdateRoutes(app, { updatesDir })

  await registerPlatformAuthRoutes(app)

  await app.register(async (protectedApp) => {
    protectedApp.addHook('preHandler', requireAdminSession)
    await registerPlatformAdminRoutes(protectedApp)
    await registerPlatformAdminUpdatesRoutes(protectedApp, { updatesDir })
  })

  const webRoot = opts.webDist
  if (webRoot && fs.existsSync(webRoot)) {
    await app.register(fastifyStatic, {
      root: path.resolve(webRoot),
      prefix: '/',
      decorateReply: false,
    })
    const indexHtml = path.join(path.resolve(webRoot), 'index.html')
    app.setNotFoundHandler((req, reply) => {
      if (req.url.startsWith('/api')) {
        return reply.status(404).send({ error: 'Not found' })
      }
      if (!fs.existsSync(indexHtml)) {
        return reply.status(404).send('Not found')
      }
      return reply.type('text/html').send(fs.createReadStream(indexHtml))
    })
  }

  const host = opts.host ?? '0.0.0.0'
  await app.listen({ port: opts.port, host })
}
