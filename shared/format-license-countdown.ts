function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n)
}

/** Human-readable time remaining from a delta in milliseconds (can be negative). */
export function formatLicenseRemainMs(deltaMs: number): string {
  if (!Number.isFinite(deltaMs)) return '—'
  if (deltaMs <= 0) return '0:00:00'

  const totalSec = Math.floor(deltaMs / 1000)
  const days = Math.floor(totalSec / 86400)
  const h = Math.floor((totalSec % 86400) / 3600)
  const m = Math.floor((totalSec % 3600) / 60)
  const s = totalSec % 60

  if (days > 0) {
    return `${days}d ${pad2(h)}:${pad2(m)}:${pad2(s)}`
  }
  return `${h}:${pad2(m)}:${pad2(s)}`
}
