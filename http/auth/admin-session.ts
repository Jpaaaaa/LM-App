import type { FastifyRequest } from 'fastify'

export const ADMIN_SESSION_COOKIE = 'platform_admin'

export function parseAdminSession(req: FastifyRequest): { username: string } | null {
  const raw = req.cookies[ADMIN_SESSION_COOKIE]
  if (!raw) return null
  const opened = req.unsignCookie(raw)
  if (!opened.valid || !opened.value) return null

  const expectedUser = process.env.PLATFORM_ADMIN_USERNAME?.trim() || 'admin'
  const parts = opened.value.split(':')
  if (parts.length !== 2) return null
  const [user, expStr] = parts
  const exp = Number(expStr)
  if (!Number.isFinite(exp) || Date.now() > exp) return null
  if (user !== expectedUser) return null
  return { username: user }
}
