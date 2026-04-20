import bcrypt from 'bcryptjs'
import type { FastifyInstance, FastifyRequest } from 'fastify'
import { ADMIN_SESSION_COOKIE, parseAdminSession } from '../auth/admin-session'

const SESSION_MAX_MS = 7 * 24 * 60 * 60 * 1000

function sessionCookieOpts(_req: FastifyRequest) {
  const secure =
    process.env.PLATFORM_COOKIE_SECURE !== '0' &&
    (process.env.NODE_ENV === 'production' || process.env.PLATFORM_COOKIE_SECURE === '1')
  return {
    path: '/' as const,
    httpOnly: true,
    sameSite: 'lax' as const,
    secure,
    maxAge: Math.floor(SESSION_MAX_MS / 1000),
  }
}

export async function registerPlatformAuthRoutes(app: FastifyInstance): Promise<void> {
  const hash = process.env.PLATFORM_ADMIN_PASSWORD_BCRYPT?.trim()
  const usernameConfigured = process.env.PLATFORM_ADMIN_USERNAME?.trim() || 'admin'

  app.get('/api/platform/auth/me', async (req, reply) => {
    const sess = parseAdminSession(req)
    if (!sess) return reply.status(401).send({ error: 'UNAUTHORIZED' })
    return reply.send({ ok: true, username: sess.username })
  })

  app.post<{
    Body: { username?: string; password?: string }
  }>('/api/platform/auth/login', async (req, reply) => {
    if (!hash) {
      return reply.status(503).send({ error: 'AUTH_NOT_CONFIGURED', message: 'Server missing PLATFORM_ADMIN_PASSWORD_BCRYPT' })
    }
    const u = typeof req.body?.username === 'string' ? req.body.username.trim() : ''
    const p = typeof req.body?.password === 'string' ? req.body.password : ''
    if (!u || !p) {
      return reply.status(400).send({ error: 'VALIDATION', message: 'username and password required' })
    }
    if (u !== usernameConfigured) {
      await bcrypt.compare(p, hash)
      return reply.status(401).send({ error: 'INVALID_CREDENTIALS' })
    }
    const ok = await bcrypt.compare(p, hash)
    if (!ok) return reply.status(401).send({ error: 'INVALID_CREDENTIALS' })

    const exp = Date.now() + SESSION_MAX_MS
    const payload = `${u}:${exp}`
    reply.setCookie(ADMIN_SESSION_COOKIE, payload, { ...sessionCookieOpts(req), signed: true })
    return reply.send({ ok: true })
  })

  app.post('/api/platform/auth/logout', async (req, reply) => {
    const o = sessionCookieOpts(req)
    reply.clearCookie(ADMIN_SESSION_COOKIE, { path: '/', httpOnly: true, sameSite: o.sameSite, secure: o.secure })
    return reply.send({ ok: true })
  })
}
