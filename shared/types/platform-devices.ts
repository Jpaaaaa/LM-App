export type PlatformLicenseTier = '5d' | '15d' | '1m' | '2m' | 'lifetime' | 'custom'

export type PlatformDevicePublicStatus =
  | 'unknown_device'
  | 'revoked'
  | 'sync_required'
  | 'expired'
  | 'active'

export type PlatformDeviceRow = {
  machineId: string
  label: string | null
  tier: PlatformLicenseTier
  expiresAtMs: number | null
  revoked: boolean
  lastSyncAtMs: number | null
  createdAtMs: number
  updatedAtMs: number
  notes: string | null
  /**
   * Max time after last sync before `sync_required` (ms). Null = use server default
   * (`AMAAN_ROLLING_SYNC_MAX_MS` / built-in default).
   */
  rollingMaxMs: number | null
}

export type PlatformPingResponse = {
  ok: boolean
  status: PlatformDevicePublicStatus
  machineId: string
  tier: PlatformLicenseTier | null
  expiresAtMs: number | null
  daysUntilExpiry: number | null
  nextRequiredSyncBeforeMs: number | null
  serverTimeMs: number
  message?: string
}
