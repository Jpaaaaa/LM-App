import type { Database as SqlDatabase } from 'sql.js'
import { addMonths } from 'date-fns'
import type {
  PlatformDevicePublicStatus,
  PlatformDeviceRow,
  PlatformLicenseTier,
  PlatformPingResponse,
} from '@shared/types/platform-devices'

import { LICENSE_ROLLING_SYNC_MAX_MS } from '../../shared/license-rolling.ts'

/**
 * Rolling window: must ping at least once within this interval (ms).
 * Override for local tests: `AMAAN_ROLLING_SYNC_MAX_MS=60000` (1 minute). Clamped 1s–366d.
 */
function resolveRollingSyncMaxMs(): number {
  const raw = process.env.AMAAN_ROLLING_SYNC_MAX_MS?.trim()
  if (!raw) return LICENSE_ROLLING_SYNC_MAX_MS
  const n = Number(raw)
  if (!Number.isFinite(n)) return LICENSE_ROLLING_SYNC_MAX_MS
  const min = 1000
  const max = 366 * 24 * 60 * 60 * 1000
  return Math.min(max, Math.max(min, Math.round(n)))
}

export const ROLLING_SYNC_MAX_MS = resolveRollingSyncMaxMs()

const TIERS: ReadonlySet<string> = new Set(['5d', '15d', '1m', '2m', 'lifetime', 'custom'])

/** Min/max for platform "custom" tier: validity window from activation/renew time. */
export const CUSTOM_VALID_FOR_MS_MIN = 1_000
export const CUSTOM_VALID_FOR_MS_MAX = Math.floor(10 * 365.25 * 24 * 60 * 60 * 1000)

export function clampCustomValidForMs(n: number): number {
  return Math.min(CUSTOM_VALID_FOR_MS_MAX, Math.max(CUSTOM_VALID_FOR_MS_MIN, Math.round(n)))
}

export function assertTier(x: string): asserts x is PlatformLicenseTier {
  if (!TIERS.has(x)) throw new Error('INVALID_TIER')
}

export function computeExpiryFromTier(issuedAtMs: number, tier: PlatformLicenseTier): number | null {
  if (tier === 'lifetime') return null
  if (tier === 'custom') return null
  if (tier === '5d') return issuedAtMs + 5 * 86400000
  if (tier === '15d') return issuedAtMs + 15 * 86400000
  if (tier === '1m') return addMonths(new Date(issuedAtMs), 1).getTime()
  if (tier === '2m') return addMonths(new Date(issuedAtMs), 2).getTime()
  return null
}

function rowFromStmt(row: Record<string, unknown> | undefined): PlatformDeviceRow | null {
  if (!row) return null
  return {
    machineId: String(row.machine_id),
    label: row.label != null ? String(row.label) : null,
    tier: row.tier as PlatformLicenseTier,
    expiresAtMs: row.expires_at_ms != null ? Number(row.expires_at_ms) : null,
    revoked: Number(row.revoked) === 1,
    lastSyncAtMs: row.last_sync_at_ms != null ? Number(row.last_sync_at_ms) : null,
    createdAtMs: Number(row.created_at_ms),
    updatedAtMs: Number(row.updated_at_ms),
    notes: row.notes != null ? String(row.notes) : null,
  }
}

export function listDevices(database: SqlDatabase): PlatformDeviceRow[] {
  const stmt = database.prepare(
    `SELECT machine_id, label, tier, expires_at_ms, revoked, last_sync_at_ms, created_at_ms, updated_at_ms, notes
     FROM platform_devices ORDER BY updated_at_ms DESC`,
  )
  const out: PlatformDeviceRow[] = []
  while (stmt.step()) {
    const r = rowFromStmt(stmt.getAsObject())
    if (r) out.push(r)
  }
  stmt.free()
  return out
}

export function findDevice(database: SqlDatabase, machineId: string): PlatformDeviceRow | null {
  const stmt = database.prepare(
    `SELECT machine_id, label, tier, expires_at_ms, revoked, last_sync_at_ms, created_at_ms, updated_at_ms, notes
     FROM platform_devices WHERE machine_id = ?`,
  )
  stmt.bind([machineId.trim()])
  let row: PlatformDeviceRow | null = null
  if (stmt.step()) {
    row = rowFromStmt(stmt.getAsObject())
  }
  stmt.free()
  return row
}

export type UpsertDeviceInput = {
  machineId: string
  label?: string | null
  tier: PlatformLicenseTier
  notes?: string | null
  /** Recalculate tier expiry from now and reset rolling sync clock */
  renew: boolean
  /**
   * When `tier` is `custom` and this upsert computes a new expiry (new device or `renew`),
   * length of the license window from `now` (ms). Clamped to platform min/max.
   */
  customValidForMs?: number
}

export function upsertDevice(database: SqlDatabase, input: UpsertDeviceInput): PlatformDeviceRow {
  assertTier(input.tier)
  const now = Date.now()
  const mid = input.machineId.trim()
  const existing = findDevice(database, mid)

  const createdAtMs = existing?.createdAtMs ?? now
  let expiresAtMs: number | null
  let lastSyncAtMs: number | null

  if (!existing || input.renew) {
    if (input.tier === 'lifetime') {
      expiresAtMs = null
    } else if (input.tier === 'custom') {
      if (input.customValidForMs == null || !Number.isFinite(input.customValidForMs)) {
        throw new Error('CUSTOM_DURATION_REQUIRED')
      }
      expiresAtMs = now + clampCustomValidForMs(input.customValidForMs)
    } else {
      expiresAtMs = computeExpiryFromTier(now, input.tier)
    }
    lastSyncAtMs = now
  } else {
    expiresAtMs = existing.expiresAtMs
    lastSyncAtMs = existing.lastSyncAtMs
  }

  const label = input.label !== undefined ? input.label : existing?.label ?? null
  const notes = input.notes !== undefined ? input.notes : existing?.notes ?? null

  database.run(
    `INSERT INTO platform_devices (machine_id, label, tier, expires_at_ms, revoked, last_sync_at_ms, created_at_ms, updated_at_ms, notes)
     VALUES (?, ?, ?, ?, 0, ?, ?, ?, ?)
     ON CONFLICT(machine_id) DO UPDATE SET
       label = excluded.label,
       tier = excluded.tier,
       expires_at_ms = excluded.expires_at_ms,
       last_sync_at_ms = excluded.last_sync_at_ms,
       updated_at_ms = excluded.updated_at_ms,
       notes = excluded.notes,
       revoked = 0`,
    [mid, label, input.tier, expiresAtMs, lastSyncAtMs, createdAtMs, now, notes],
  )

  const r = findDevice(database, mid)
  if (!r) throw new Error('UPSERT_FAILED')
  return r
}

export function setRevoked(database: SqlDatabase, machineId: string, revoked: boolean): void {
  const now = Date.now()
  database.run(`UPDATE platform_devices SET revoked = ?, updated_at_ms = ? WHERE machine_id = ?`, [
    revoked ? 1 : 0,
    now,
    machineId.trim(),
  ])
}

export type AdminDevicePatch = {
  label?: string | null
  notes?: string | null
  tier?: PlatformLicenseTier
  expiresAtMs?: number | null
  lastSyncAtMs?: number | null
}

/**
 * Partial update for admin UI (explicit expiry / last-sync anchors, label, notes, tier).
 * Non-lifetime tiers must keep a finite `expiresAtMs` after the merge.
 */
export function updateDeviceAdmin(
  database: SqlDatabase,
  machineId: string,
  patch: AdminDevicePatch,
): PlatformDeviceRow {
  const mid = machineId.trim()
  const existing = findDevice(database, mid)
  if (!existing) throw new Error('NOT_FOUND')

  const tier = patch.tier !== undefined ? patch.tier : existing.tier
  assertTier(tier)

  let expiresAtMs = existing.expiresAtMs
  if (patch.expiresAtMs !== undefined) expiresAtMs = patch.expiresAtMs
  if (tier === 'lifetime') expiresAtMs = null

  if (tier !== 'lifetime' && (expiresAtMs == null || !Number.isFinite(expiresAtMs))) {
    throw new Error('EXPIRY_REQUIRED')
  }

  let lastSyncAtMs = existing.lastSyncAtMs
  if (patch.lastSyncAtMs !== undefined) lastSyncAtMs = patch.lastSyncAtMs
  if (lastSyncAtMs != null && !Number.isFinite(lastSyncAtMs)) {
    throw new Error('INVALID_LAST_SYNC')
  }

  const label = patch.label !== undefined ? patch.label : existing.label
  const notes = patch.notes !== undefined ? patch.notes : existing.notes
  const now = Date.now()

  database.run(
    `UPDATE platform_devices SET tier = ?, expires_at_ms = ?, last_sync_at_ms = ?, label = ?, notes = ?, updated_at_ms = ? WHERE machine_id = ?`,
    [tier, expiresAtMs, lastSyncAtMs, label, notes, now, mid],
  )

  const row = findDevice(database, mid)
  if (!row) throw new Error('UPDATE_FAILED')
  return row
}

export function deleteDevice(database: SqlDatabase, machineId: string): boolean {
  const mid = machineId.trim()
  if (!findDevice(database, mid)) return false
  database.run(`DELETE FROM platform_devices WHERE machine_id = ?`, [mid])
  return findDevice(database, mid) === null
}

export function recordSync(database: SqlDatabase, machineId: string): void {
  const now = Date.now()
  database.run(`UPDATE platform_devices SET last_sync_at_ms = ?, updated_at_ms = ? WHERE machine_id = ?`, [
    now,
    now,
    machineId.trim(),
  ])
}

function daysBetween(fromMs: number, toMs: number): number {
  return Math.ceil((toMs - fromMs) / 86400000)
}

export function evaluateDevice(
  row: PlatformDeviceRow | null,
  nowMs: number = Date.now(),
): { status: PlatformDevicePublicStatus; nextRequiredSyncBeforeMs: number | null } {
  if (!row) {
    return { status: 'unknown_device', nextRequiredSyncBeforeMs: null }
  }
  if (row.revoked) {
    return { status: 'revoked', nextRequiredSyncBeforeMs: null }
  }

  const anchor = row.lastSyncAtMs ?? row.createdAtMs
  const rollingDeadline = anchor + ROLLING_SYNC_MAX_MS

  if (nowMs > rollingDeadline) {
    return { status: 'sync_required', nextRequiredSyncBeforeMs: rollingDeadline }
  }

  if (row.tier !== 'lifetime' && row.expiresAtMs != null && nowMs > row.expiresAtMs) {
    return { status: 'expired', nextRequiredSyncBeforeMs: null }
  }

  const datedCap = row.tier !== 'lifetime' && row.expiresAtMs != null ? row.expiresAtMs : Infinity
  const nextSync = Math.min(rollingDeadline, datedCap)

  return { status: 'active', nextRequiredSyncBeforeMs: nextSync }
}

export function buildPingResponse(row: PlatformDeviceRow | null, nowMs: number = Date.now()): PlatformPingResponse {
  if (!row) {
    return {
      ok: false,
      status: 'unknown_device',
      machineId: '',
      tier: null,
      expiresAtMs: null,
      daysUntilExpiry: null,
      nextRequiredSyncBeforeMs: null,
      serverTimeMs: nowMs,
      message: 'Machine not registered',
    }
  }

  const { status, nextRequiredSyncBeforeMs } = evaluateDevice(row, nowMs)

  let daysUntilExpiry: number | null = null
  if (row.expiresAtMs != null && row.tier !== 'lifetime') {
    daysUntilExpiry = Math.max(0, daysBetween(nowMs, row.expiresAtMs))
  }

  const ok = status === 'active'

  return {
    ok,
    status,
    machineId: row.machineId,
    tier: row.tier,
    expiresAtMs: row.expiresAtMs,
    daysUntilExpiry,
    nextRequiredSyncBeforeMs,
    serverTimeMs: nowMs,
    message:
      status === 'sync_required'
        ? 'Monthly online check required — connect to renew your window.'
        : undefined,
  }
}
