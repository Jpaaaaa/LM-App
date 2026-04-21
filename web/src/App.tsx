import { useCallback, useEffect, useState } from 'react'
import { formatLicenseRemainDaysMinutes, formatLicenseRemainMs } from '@shared/format-license-countdown'
import { ReleasesTab } from './ReleasesTab'
import './styles.css'

type TabId = 'devices' | 'releases'

/* ─── Types ─── */
const JSON_HEADERS: HeadersInit = { 'Content-Type': 'application/json' }
type CustomUnit = 'seconds' | 'minutes' | 'hours' | 'days'
type DeviceRow = {
  machineId: string
  label: string | null
  tier: string
  expiresAtMs: number | null
  revoked: boolean
  lastSyncAtMs: number | null
  createdAtMs: number
  updatedAtMs: number
  notes: string | null
  rollingMaxMs: number | null
  /** Resolved offline window (ms): per-device or server default). */
  effectiveRollingMaxMs?: number
  computedStatus: string
  rollingDeadlineMs: number
}

/* ─── Utils ─── */
function unitToMs(amount: number, unit: CustomUnit): number {
  switch (unit) {
    case 'seconds': return amount * 1_000
    case 'minutes': return amount * 60_000
    case 'hours':   return amount * 3_600_000
    case 'days':    return amount * 86_400_000
    default:        return amount * 1_000
  }
}

/** null = server default; `err` = invalid input */
function parseOfflineGraceMs(daysStr: string, minutesStr: string): number | null | 'err' {
  const dTrim = daysStr.trim()
  const mTrim = minutesStr.trim()
  if (!dTrim && !mTrim) return null
  const d = dTrim === '' ? 0 : Number(dTrim)
  const m = mTrim === '' ? 0 : Number(mTrim)
  if (!Number.isInteger(d) || !Number.isInteger(m) || d < 0 || m < 0) return 'err'
  const total = d * 86_400_000 + m * 60_000
  if (total <= 0) return null
  return total
}

function msToOfflineDaysMinutes(ms: number | null): { days: string; minutes: string } {
  if (ms == null || !Number.isFinite(ms)) return { days: '', minutes: '' }
  const d = Math.floor(ms / 86_400_000)
  const m = Math.floor((ms % 86_400_000) / 60_000)
  return { days: String(d), minutes: String(m) }
}
function msToDatetimeLocal(ms: number): string {
  const d = new Date(ms)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth()+1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`
}
function parseDatetimeLocal(s: string): number | null {
  const t = s.trim()
  if (!t) return null
  const ms = new Date(t).getTime()
  return Number.isFinite(ms) ? ms : null
}
function fmtDate(ms: number | null) {
  if (ms == null) return '—'
  return new Date(ms).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
}
function statusBadgeClass(status: string, revoked: boolean) {
  if (revoked) return 'badge badge--revoked'
  const s = status.toLowerCase()
  if (s.includes('lifetime')) return 'badge badge--lifetime'
  if (s.includes('active') || s.includes('ok')) return 'badge badge--active'
  if (s.includes('expir')) return 'badge badge--expired'
  return 'badge badge--default'
}
function statusLabel(status: string, revoked: boolean) {
  if (revoked) return 'Revoked'
  const s = status.toLowerCase()
  if (s.includes('lifetime')) return 'Lifetime'
  if (s.includes('active') || s.includes('ok')) return 'Active'
  if (s.includes('expir')) return 'Expired'
  return status
}

/* ─── SVG Icons ─── */
const Ico = {
  plus: (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
      <path d="M8 2v12M2 8h12" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
    </svg>
  ),
  refresh: (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
      <path d="M13.5 2.5A6.5 6.5 0 1 1 7 1.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"/>
      <path d="M7 1.5 9.5 4 7 6.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  ),
  edit: (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
      <path d="M9.5 1.5 12.5 4.5 5 12H2v-3L9.5 1.5Z" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  ),
  lock: (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
      <rect x="2" y="6.5" width="10" height="7" rx="1.5" stroke="currentColor" strokeWidth="1.4"/>
      <path d="M4.5 6.5V4a2.5 2.5 0 0 1 5 0v2.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/>
    </svg>
  ),
  unlock: (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
      <rect x="2" y="6.5" width="10" height="7" rx="1.5" stroke="currentColor" strokeWidth="1.4"/>
      <path d="M4.5 6.5V4a2.5 2.5 0 0 1 5 0" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/>
    </svg>
  ),
  trash: (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
      <path d="M1.5 3.5h11M5 3.5V2.5a.5.5 0 0 1 .5-.5h3a.5.5 0 0 1 .5.5v1M11.5 3.5 11 11a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1L2.5 3.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  ),
  exclamation: (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
      <circle cx="8" cy="8" r="7" stroke="currentColor" strokeWidth="1.4"/>
      <path d="M8 5v4M8 11v.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"/>
    </svg>
  ),
  chevronRight: (
    <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
      <path d="M4 2l4 4-4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  ),
  device: (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
      <rect x="2" y="1" width="12" height="14" rx="2" stroke="white" strokeWidth="1.4"/>
      <path d="M6 13h4" stroke="white" strokeWidth="1.4" strokeLinecap="round"/>
    </svg>
  ),
  key: (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
      <circle cx="5.5" cy="8" r="3.5" stroke="white" strokeWidth="1.4"/>
      <path d="M8.5 8h6M12.5 8v2" stroke="white" strokeWidth="1.4" strokeLinecap="round"/>
    </svg>
  ),
  empty: (
    <svg width="48" height="48" viewBox="0 0 48 48" fill="none">
      <rect x="8" y="4" width="28" height="36" rx="4" stroke="currentColor" strokeWidth="1.6"/>
      <path d="M16 16h16M16 22h16M16 28h10" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"/>
      <circle cx="36" cy="36" r="8" fill="var(--bg-secondary)" stroke="currentColor" strokeWidth="1.4"/>
      <path d="M33 36h6M36 33v6" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/>
    </svg>
  ),
  save: (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
      <path d="M2 2.5A.5.5 0 0 1 2.5 2h9l2.5 2.5V13.5a.5.5 0 0 1-.5.5h-11a.5.5 0 0 1-.5-.5V2.5Z" stroke="currentColor" strokeWidth="1.4"/>
      <path d="M5 2v3.5h6V2" stroke="currentColor" strokeWidth="1.4"/>
      <rect x="4" y="9" width="8" height="5" rx="0.5" stroke="currentColor" strokeWidth="1.4"/>
    </svg>
  ),
}

/* ─── Field component (iOS grouped list cell) ─── */
function Field({
  label, hint, children, first = false,
}: { label: string; hint?: string; children: React.ReactNode; first?: boolean }) {
  return (
    <div className="field" style={first ? { borderRadius: '0' } : {}}>
      <label className="field__label">{label}</label>
      {children}
      {hint ? <p style={{ fontSize: 12, color: 'var(--label-3)', lineHeight: 1.45, paddingBottom: 8 }}>{hint}</p> : null}
    </div>
  )
}

/* ─── Device Card ─── */
function DeviceCard({
  d, nowTick, onEdit, onRevoke, onDelete,
}: {
  d: DeviceRow
  nowTick: number
  onEdit: (d: DeviceRow) => void
  onRevoke: (id: string, rev: boolean) => void
  onDelete: (id: string) => void
}) {
  return (
    <article className={`device-card${d.revoked ? ' device-card--revoked' : ''}`}>
      {/* Head */}
      <div className="device-card__head">
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="device-card__name">{d.label ?? 'Unnamed device'}</div>
          <div className="device-card__id">{d.machineId}</div>
        </div>
        <span className={statusBadgeClass(d.computedStatus, d.revoked)}>
          <span className="badge__dot" />
          {statusLabel(d.computedStatus, d.revoked)}
        </span>
      </div>

      {/* Meta 2×2 grid */}
      <div className="device-card__meta">
        <div className="device-meta">
          <div className="device-meta__label">Tier</div>
          <div className="device-meta__value">{d.tier}</div>
        </div>
        <div className="device-meta">
          <div className="device-meta__label">Expires</div>
          <div className="device-meta__value">{fmtDate(d.expiresAtMs)}</div>
          {d.expiresAtMs != null ? (
            <div className="device-meta__countdown" aria-live="polite">
              {formatLicenseRemainMs(d.expiresAtMs - nowTick)}
            </div>
          ) : null}
        </div>
        <div className="device-meta">
          <div className="device-meta__label">Rolling</div>
          <div className="device-meta__value">{fmtDate(d.rollingDeadlineMs)}</div>
          <div className="device-meta__countdown" aria-live="polite">
            {formatLicenseRemainMs(d.rollingDeadlineMs - nowTick)}
          </div>
        </div>
        <div className="device-meta">
          <div className="device-meta__label">Last sync</div>
          <div className="device-meta__value">{fmtDate(d.lastSyncAtMs)}</div>
        </div>
        <div className="device-meta">
          <div className="device-meta__label">Offline max</div>
          <div className="device-meta__value">
            {d.rollingMaxMs != null && Number.isFinite(d.rollingMaxMs)
              ? formatLicenseRemainDaysMinutes(d.rollingMaxMs)
              : d.effectiveRollingMaxMs != null && Number.isFinite(d.effectiveRollingMaxMs)
                ? `Default (${formatLicenseRemainDaysMinutes(d.effectiveRollingMaxMs)})`
                : 'Server default'}
          </div>
        </div>
      </div>

      {/* Actions */}
      <div className="device-card__actions">
        <button
          type="button"
          className="act-btn act-btn--blue"
          onClick={() => onEdit(d)}
          aria-label="Edit"
        >
          {Ico.edit}
          Edit
        </button>
        <button
          type="button"
          className={d.revoked ? 'act-btn act-btn--green' : 'act-btn act-btn--orange'}
          onClick={() => onRevoke(d.machineId, d.revoked)}
          aria-label={d.revoked ? 'Restore' : 'Revoke'}
        >
          {d.revoked ? Ico.unlock : Ico.lock}
          {d.revoked ? 'Restore' : 'Revoke'}
        </button>
        <button
          type="button"
          className="act-btn act-btn--red"
          onClick={() => onDelete(d.machineId)}
          aria-label="Delete"
        >
          {Ico.trash}
          Delete
        </button>
      </div>
    </article>
  )
}

/* ─── Main App ─── */
export function App() {
  const [devices, setDevices] = useState<DeviceRow[]>([])
  const [error, setError]     = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [nowTick, setNowTick] = useState(() => Date.now())

  const [newMachineId, setNewMachineId] = useState('')
  const [newLabel,     setNewLabel]     = useState('')
  const [newTier,      setNewTier]      = useState('5d')
  const [newNotes,     setNewNotes]     = useState('')
  const [renew,        setRenew]        = useState(true)
  const [customAmount, setCustomAmount] = useState('7')
  const [customUnit,   setCustomUnit]   = useState<CustomUnit>('days')
  const [newRollingDays, setNewRollingDays] = useState('')
  const [newRollingMinutes, setNewRollingMinutes] = useState('')

  const [editOpen,     setEditOpen]     = useState(false)
  const [editRow,      setEditRow]      = useState<DeviceRow | null>(null)
  const [editLabel,    setEditLabel]    = useState('')
  const [editNotes,    setEditNotes]    = useState('')
  const [editTier,     setEditTier]     = useState('5d')
  const [editExpires,  setEditExpires]  = useState('')
  const [editLastSync, setEditLastSync] = useState('')
  const [editRollingDays, setEditRollingDays] = useState('')
  const [editRollingMinutes, setEditRollingMinutes] = useState('')
  const [editSaving,   setEditSaving]   = useState(false)

  const [tab, setTab] = useState<TabId>('devices')

  const load = useCallback(async () => {
    setLoading(true); setError(null)
    try {
      const r = await fetch('/api/platform/admin/devices', { credentials: 'include' })
      if (!r.ok) {
        const j = (await r.json().catch(() => ({}))) as { error?: string }
        throw new Error(j.error ?? r.statusText)
      }
      const j = (await r.json()) as { devices: DeviceRow[] }
      setDevices(j.devices ?? [])
    } catch (e) { setError(e instanceof Error ? e.message : String(e)) }
    finally { setLoading(false) }
  }, [])

  useEffect(() => { void load() }, [load])
  useEffect(() => {
    const id = setInterval(() => setNowTick(Date.now()), 1_000)
    return () => clearInterval(id)
  }, [])

  async function addDevice(e: React.FormEvent) {
    e.preventDefault(); setError(null)
    try {
      let customValidForMs: number | undefined
      if (newTier === 'custom') {
        const amt = Number(String(customAmount).trim().replace(',', '.'))
        if (!Number.isFinite(amt) || amt <= 0) { setError('Enter a positive number.'); return }
        customValidForMs = unitToMs(amt, customUnit)
      }
      const rollingParsed = parseOfflineGraceMs(newRollingDays, newRollingMinutes)
      if (rollingParsed === 'err') {
        setError('Offline grace: use whole numbers (days and minutes ≥ 0).')
        return
      }
      const r = await fetch('/api/platform/admin/devices', {
        method: 'POST', headers: JSON_HEADERS, credentials: 'include',
        body: JSON.stringify({
          machineId: newMachineId.trim(),
          label: newLabel.trim() || null,
          tier: newTier, renew,
          notes: newNotes.trim() || null,
          ...(customValidForMs != null ? { customValidForMs } : {}),
          ...(rollingParsed !== null ? { rollingMaxMs: rollingParsed } : {}),
        }),
      })
      if (!r.ok) {
        const j = (await r.json().catch(() => ({}))) as { error?: string; message?: string }
        throw new Error(j.message ?? j.error ?? r.statusText)
      }
      setNewMachineId('')
      setNewRollingDays('')
      setNewRollingMinutes('')
      await load()
    } catch (e) { setError(e instanceof Error ? e.message : String(e)) }
  }

  async function toggleRevoke(machineId: string, revoked: boolean) {
    setError(null)
    try {
      const r = await fetch(`/api/platform/admin/devices/${encodeURIComponent(machineId)}/revoke`, {
        method: 'PATCH', headers: JSON_HEADERS, credentials: 'include',
        body: JSON.stringify({ revoked: !revoked }),
      })
      if (!r.ok) throw new Error(await r.text())
      await load()
    } catch (e) { setError(e instanceof Error ? e.message : String(e)) }
  }

  function openEdit(d: DeviceRow) {
    setEditRow(d); setEditLabel(d.label ?? ''); setEditNotes(d.notes ?? '')
    setEditTier(d.tier)
    setEditExpires(d.tier === 'lifetime' || d.expiresAtMs == null ? '' : msToDatetimeLocal(d.expiresAtMs))
    setEditLastSync(msToDatetimeLocal(d.lastSyncAtMs ?? d.createdAtMs))
    {
      const { days, minutes } = msToOfflineDaysMinutes(d.rollingMaxMs)
      setEditRollingDays(days)
      setEditRollingMinutes(minutes)
    }
    setEditOpen(true); setError(null)
  }

  function closeEdit() { setEditOpen(false); setEditRow(null); setEditSaving(false) }

  async function saveEdit(e: React.FormEvent) {
    e.preventDefault(); if (!editRow) return; setError(null)
    const expiresAtMs = editTier === 'lifetime' ? null : parseDatetimeLocal(editExpires)
    if (editTier !== 'lifetime' && expiresAtMs == null) {
      setError('Set expiry date or choose Lifetime.'); return
    }
    const lastSyncTrim = editLastSync.trim()
    const lastSyncAtMs = lastSyncTrim ? parseDatetimeLocal(lastSyncTrim) : null
    if (lastSyncTrim && lastSyncAtMs == null) { setError('Invalid last sync date.'); return }
    const rollingParsed = parseOfflineGraceMs(editRollingDays, editRollingMinutes)
    if (rollingParsed === 'err') {
      setError('Offline grace: use whole numbers (days and minutes ≥ 0).')
      return
    }
    setEditSaving(true)
    try {
      const r = await fetch(`/api/platform/admin/devices/${encodeURIComponent(editRow.machineId)}`, {
        method: 'PATCH', headers: JSON_HEADERS, credentials: 'include',
        body: JSON.stringify({
          label: editLabel.trim() || null,
          notes: editNotes.trim() || null,
          tier: editTier, expiresAtMs, lastSyncAtMs,
          rollingMaxMs: rollingParsed,
        }),
      })
      if (!r.ok) {
        const j = (await r.json().catch(() => ({}))) as { error?: string; message?: string }
        throw new Error(j.message ?? j.error ?? r.statusText)
      }
      closeEdit(); await load()
    } catch (err) { setError(err instanceof Error ? err.message : String(err)) }
    finally { setEditSaving(false) }
  }

  async function removeDevice(machineId: string) {
    if (!window.confirm(`Delete device?\n${machineId}`)) return
    setError(null)
    try {
      const r = await fetch(`/api/platform/admin/devices/${encodeURIComponent(machineId)}`, {
        method: 'DELETE',
        credentials: 'include',
      })
      if (!r.ok) {
        const j = (await r.json().catch(() => ({}))) as { error?: string }
        throw new Error(j.error ?? r.statusText)
      }
      if (editRow?.machineId === machineId) closeEdit()
      await load()
    } catch (err) { setError(err instanceof Error ? err.message : String(err)) }
  }

  /* ── Render ── */
  return (
    <div className="app-shell">
      <header>
        <nav className="nav-bar" aria-label="App navigation">
          <div className="nav-bar__inner">
            <div className="nav-bar__brand">
              <span className="nav-bar__icon" aria-hidden>
                <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                  <path
                    d="M15.5 3.5a2.5 2.5 0 0 1 2.5 2.5v2h-4v-2a2.5 2.5 0 0 1 2.5-2.5Z"
                    stroke="currentColor"
                    strokeWidth="1.35"
                    strokeLinejoin="round"
                  />
                  <rect x="6" y="10" width="13" height="10.5" rx="2" stroke="currentColor" strokeWidth="1.35" />
                  <circle cx="10" cy="15" r="1.4" fill="currentColor" />
                  <path d="M14 15h4.5" stroke="currentColor" strokeWidth="1.35" strokeLinecap="round" />
                </svg>
              </span>
              <div className="nav-bar__titles">
                <h1 className="nav-bar__title">LM App</h1>
                <p className="nav-bar__subtitle">License manager · Device activation · Update feed</p>
              </div>
            </div>
          </div>
        </nav>
      </header>

      <main className="page">

        {/* ── Tab switcher ── */}
        <div className="lm-tabs-wrap">
          <div role="tablist" aria-label="Sections" className="tab-bar">
            <button
              role="tab"
              type="button"
              aria-selected={tab === 'devices'}
              className={`tab-bar__btn${tab === 'devices' ? ' tab-bar__btn--active' : ''}`}
              onClick={() => setTab('devices')}
            >
              Devices
            </button>
            <button
              role="tab"
              type="button"
              aria-selected={tab === 'releases'}
              className={`tab-bar__btn${tab === 'releases' ? ' tab-bar__btn--active' : ''}`}
              onClick={() => setTab('releases')}
            >
              Releases
            </button>
          </div>
        </div>

        {tab === 'releases' ? <ReleasesTab /> : (<>

        {/* Error */}
        {error ? (
          <div className="alert" role="alert">
            {Ico.exclamation}
            <span>{error}</span>
          </div>
        ) : null}

        {/* ── Activate form (single <form> so submit includes all fields) ── */}
        <p className="section-label">New device</p>
        <form
          onSubmit={(ev) => void addDevice(ev)}
          style={{ marginBottom: 36 }}
        >
        <div className="ios-section" style={{ marginBottom: 8 }}>
          <Field label="Machine ID" first>
            <input
              id="new-machine-id"
              className="field__input"
              required
              value={newMachineId}
              onChange={(e) => setNewMachineId(e.target.value)}
              dir="ltr"
              placeholder="WIN-ABC123-XYZ"
              autoComplete="off"
              spellCheck={false}
            />
          </Field>
          <Field label="Label">
            <input
              id="new-label"
              className="field__input"
              value={newLabel}
              onChange={(e) => setNewLabel(e.target.value)}
              placeholder="Front desk"
            />
          </Field>
          <Field label="Tier">
            <select
              id="new-tier"
              className="field__select"
              value={newTier}
              onChange={(e) => setNewTier(e.target.value)}
            >
              <option value="5d">5 days</option>
              <option value="15d">15 days</option>
              <option value="1m">1 month</option>
              <option value="2m">2 months</option>
              <option value="lifetime">Lifetime</option>
              <option value="custom">Custom…</option>
            </select>
          </Field>
          {newTier === 'custom' ? (
            <>
              <Field label="Amount">
                <input
                  id="custom-amount"
                  className="field__input"
                  type="number"
                  min={0.001}
                  step="any"
                  required
                  dir="ltr"
                  value={customAmount}
                  onChange={(e) => setCustomAmount(e.target.value)}
                />
              </Field>
              <Field label="Unit">
                <select
                  id="custom-unit"
                  className="field__select"
                  value={customUnit}
                  onChange={(e) => setCustomUnit(e.target.value as CustomUnit)}
                >
                  <option value="seconds">Seconds</option>
                  <option value="minutes">Minutes</option>
                  <option value="hours">Hours</option>
                  <option value="days">Days</option>
                </select>
              </Field>
            </>
          ) : null}
          <Field label="Notes">
            <textarea
              id="new-notes"
              className="field__textarea"
              value={newNotes}
              onChange={(e) => setNewNotes(e.target.value)}
              rows={2}
              placeholder="Optional"
            />
          </Field>
          <Field
            label="Offline grace"
            hint="Max time without a sync before the device must check in. Leave blank to use the server default."
          >
            <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
              <input
                id="new-rolling-days"
                className="field__input"
                type="number"
                min={0}
                step={1}
                dir="ltr"
                placeholder="Days"
                aria-label="Offline grace days"
                value={newRollingDays}
                onChange={(e) => setNewRollingDays(e.target.value)}
                style={{ flex: 1 }}
              />
              <span style={{ color: 'var(--label-3)', fontSize: 13 }}>d</span>
              <input
                id="new-rolling-minutes"
                className="field__input"
                type="number"
                min={0}
                step={1}
                dir="ltr"
                placeholder="Minutes"
                aria-label="Offline grace minutes"
                value={newRollingMinutes}
                onChange={(e) => setNewRollingMinutes(e.target.value)}
                style={{ flex: 1 }}
              />
              <span style={{ color: 'var(--label-3)', fontSize: 13 }}>m</span>
            </div>
          </Field>

          <div className="ios-toggle-row">
            <span className="ios-toggle-label">Renew from now</span>
            <input
              id="renew-toggle"
              type="checkbox"
              className="ios-toggle-input"
              checked={renew}
              onChange={(e) => setRenew(e.target.checked)}
            />
          </div>
        </div>

          <button
            id="activate-btn"
            type="submit"
            className="btn btn-primary btn-primary--green"
            disabled={loading}
            style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}
          >
            {loading
              ? <span className="spinner" />
              : <>{Ico.plus} Activate</>
            }
          </button>
        </form>

        {/* ── Devices list ── */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
          <p className="section-label" style={{ margin: 0 }}>
            Devices{devices.length > 0 ? ` — ${devices.length}` : ''}
          </p>
          <button
            id="refresh-btn"
            type="button"
            className="btn btn-nav"
            onClick={() => void load()}
            disabled={loading}
            aria-label="Refresh"
          >
            {loading ? <span className="spinner spinner--blue" style={{ width: 14, height: 14 }} /> : Ico.refresh}
          </button>
        </div>

        {devices.length > 0 ? (
          <div>
            {devices.map((d) => (
              <DeviceCard
                key={d.machineId}
                d={d}
                nowTick={nowTick}
                onEdit={openEdit}
                onRevoke={(id, rev) => void toggleRevoke(id, rev)}
                onDelete={(id) => void removeDevice(id)}
              />
            ))}
          </div>
        ) : !loading ? (
          <div className="empty-state" style={{ color: 'var(--label-3)' }}>
            {Ico.empty}
            <p className="empty-state__title">No devices</p>
            <p className="empty-state__sub">Activate a device above.</p>
          </div>
        ) : (
          <div className="empty-state">
            <span className="spinner spinner--blue" style={{ width: 28, height: 28 }} />
          </div>
        )}

        </>)}
      </main>

      {/* ── Edit sheet ── */}
      {editOpen && editRow ? (
        <div
          role="presentation"
          className="sheet-backdrop"
          onClick={closeEdit}
          onKeyDown={(e) => { if (e.key === 'Escape') closeEdit() }}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="edit-sheet-title"
            className="sheet"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="sheet__handle-wrap"><div className="sheet__handle" /></div>

            {/* Sheet nav bar */}
            <div className="sheet__nav">
              <button id="edit-cancel-btn" className="sheet__nav-btn" type="button" onClick={closeEdit} disabled={editSaving}>
                Cancel
              </button>
              <span id="edit-sheet-title" className="sheet__nav-title">Edit device</span>
              <button
                id="edit-save-btn"
                className="sheet__nav-btn sheet__nav-btn--bold"
                type="button"
                onClick={(e) => void saveEdit(e as unknown as React.FormEvent)}
                disabled={editSaving}
              >
                {editSaving ? <span className="spinner" style={{ width: 14, height: 14 }} /> : 'Save'}
              </button>
            </div>

            <div className="sheet__content">
              {/* Machine ID read-only */}
              <p style={{ fontSize: 12, color: 'var(--label-3)', padding: '0 16px 6px', fontFamily: 'SF Mono, Menlo, monospace', wordBreak: 'break-all', lineHeight: 1.5 }}>
                {editRow.machineId}
              </p>

              <form id="edit-form" onSubmit={(ev) => void saveEdit(ev)}>
                <div className="ios-section" style={{ marginBottom: 8, borderRadius: 0 }}>
                  <Field label="Label" first>
                    <input
                      id="edit-label"
                      className="field__input"
                      value={editLabel}
                      onChange={(e) => setEditLabel(e.target.value)}
                      placeholder="Front desk"
                    />
                  </Field>
                  <Field label="Tier">
                    <select
                      id="edit-tier"
                      className="field__select"
                      value={editTier}
                      onChange={(e) => { const v = e.target.value; setEditTier(v); if (v === 'lifetime') setEditExpires('') }}
                    >
                      <option value="5d">5 days</option>
                      <option value="15d">15 days</option>
                      <option value="1m">1 month</option>
                      <option value="2m">2 months</option>
                      <option value="lifetime">Lifetime</option>
                      <option value="custom">Custom</option>
                    </select>
                  </Field>
                  <Field label="Expires" hint={editTier === 'lifetime' ? 'Not applicable for lifetime tier.' : undefined}>
                    <input
                      id="edit-expires"
                      className="field__input"
                      type="datetime-local"
                      disabled={editTier === 'lifetime'}
                      value={editExpires}
                      onChange={(e) => setEditExpires(e.target.value)}
                    />
                  </Field>
                  <Field
                    label="Last sync"
                    hint="Rolling deadline uses last sync + offline grace (custom or server default)."
                  >
                    <input
                      id="edit-last-sync"
                      className="field__input"
                      type="datetime-local"
                      value={editLastSync}
                      onChange={(e) => setEditLastSync(e.target.value)}
                    />
                  </Field>
                  <Field
                    label="Offline grace"
                    hint="Blank days and minutes = server default window."
                  >
                    <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                      <input
                        id="edit-rolling-days"
                        className="field__input"
                        type="number"
                        min={0}
                        step={1}
                        dir="ltr"
                        placeholder="Days"
                        aria-label="Offline grace days"
                        value={editRollingDays}
                        onChange={(e) => setEditRollingDays(e.target.value)}
                        style={{ flex: 1 }}
                      />
                      <span style={{ color: 'var(--label-3)', fontSize: 13 }}>d</span>
                      <input
                        id="edit-rolling-minutes"
                        className="field__input"
                        type="number"
                        min={0}
                        step={1}
                        dir="ltr"
                        placeholder="Minutes"
                        aria-label="Offline grace minutes"
                        value={editRollingMinutes}
                        onChange={(e) => setEditRollingMinutes(e.target.value)}
                        style={{ flex: 1 }}
                      />
                      <span style={{ color: 'var(--label-3)', fontSize: 13 }}>m</span>
                    </div>
                  </Field>
                  <Field label="Notes">
                    <textarea
                      id="edit-notes"
                      className="field__textarea"
                      value={editNotes}
                      onChange={(e) => setEditNotes(e.target.value)}
                      rows={2}
                    />
                  </Field>
                </div>
              </form>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  )
}
