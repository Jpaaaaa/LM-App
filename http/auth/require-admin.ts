import type { FastifyReply, FastifyRequest } from 'fastify'
import { parseAdminSession } from './admin-session'

export async function requireAdminSession(req: FastifyRequest, reply: FastifyReply): Promise<void> {
  if (!parseAdminSession(req)) {
    return reply.status(401).send({ error: 'UNAUTHORIZED' })
  }
}
