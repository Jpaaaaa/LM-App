import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type {
  PlatformUpdateFileEntry,
  PlatformUpdateFilesResponse,
  PlatformUpdateHealthResponse,
  PlatformUpdateLatestResponse,
  PlatformUpdatePublishResponse,
  PlatformUpdateUploadResponse,
} from '@shared/types/app-update'

/** Installer extensions that can be published (match the server's allow-list). */
const PUBLISHABLE_EXT = new Set(['.exe', '.zip', '.dmg', '.appimage', '.deb', '.rpm'])
function isPublishable(name: string): boolean {
  const lower = name.toLowerCase()
  if (lower.endsWith('.exe.blockmap')) return false
  const dot = lower.lastIndexOf('.')
  if (dot < 0) return false
  return PUBLISHABLE_EXT.has(lower.slice(dot))
}

/* ─── Helpers ─── */
function fmtBytes(n: number): string {
  if (!Number.isFinite(n) || n < 0) return '—'
  if (n < 1024) return `${n} B`
  const u = ['KB', 'MB', 'GB', 'TB']
  let v = n / 1024
  let i = 0
  while (v >= 1024 && i < u.length - 1) { v /= 1024; i++ }
  return `${v >= 10 ? v.toFixed(0) : v.toFixed(1)} ${u[i]}`
}

function fmtDateTime(ms: number | null): string {
  if (ms == null || !Number.isFinite(ms)) return '—'
  const d = new Date(ms)
  return d.toLocaleString(undefined, {
    month: 'short', day: 'numeric', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  })
}

function fmtIso(iso: string | null | undefined): string {
  if (!iso) return '—'
  const ms = Date.parse(iso)
  return Number.isFinite(ms) ? fmtDateTime(ms) : iso
}

function fileExtLabel(name: string): string {
  const lower = name.toLowerCase()
  if (lower.endsWith('.exe.blockmap')) return 'BLOCKMAP'
  const dot = lower.lastIndexOf('.')
  if (dot < 0) return 'FILE'
  return lower.slice(dot + 1).toUpperCase()
}

function fileBadgeClass(name: string): string {
  const lower = name.toLowerCase()
  if (lower.endsWith('.yml') || lower.endsWith('.yaml')) return 'rel-badge rel-badge--blue'
  if (lower.endsWith('.exe')) return 'rel-badge rel-badge--green'
  if (lower.endsWith('.blockmap')) return 'rel-badge rel-badge--neutral'
  return 'rel-badge rel-badge--neutral'
}

/* ─── Icons ─── */
const Ico = {
  refresh: (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
      <path d="M13.5 2.5A6.5 6.5 0 1 1 7 1.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"/>
      <path d="M7 1.5 9.5 4 7 6.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  ),
  upload: (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
      <path d="M8 11V2M8 2 4.5 5.5M8 2l3.5 3.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/>
      <path d="M2 11v2a1 1 0 0 0 1 1h10a1 1 0 0 0 1-1v-2" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"/>
    </svg>
  ),
  trash: (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
      <path d="M1.5 3.5h11M5 3.5V2.5a.5.5 0 0 1 .5-.5h3a.5.5 0 0 1 .5.5v1M11.5 3.5 11 11a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1L2.5 3.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  ),
  copy: (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
      <rect x="3.5" y="3.5" width="8" height="9" rx="1" stroke="currentColor" strokeWidth="1.4"/>
      <path d="M5.5 3.5V2a.5.5 0 0 1 .5-.5h4a.5.5 0 0 1 .5.5v7.5" stroke="currentColor" strokeWidth="1.4"/>
    </svg>
  ),
  broadcast: (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
      <circle cx="7" cy="7" r="1.5" fill="currentColor"/>
      <path d="M4.5 4.5a3.5 3.5 0 0 0 0 5M9.5 4.5a3.5 3.5 0 0 1 0 5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/>
      <path d="M2.5 2.5a6 6 0 0 0 0 9M11.5 2.5a6 6 0 0 1 0 9" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/>
    </svg>
  ),
  exclamation: (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
      <circle cx="8" cy="8" r="7" stroke="currentColor" strokeWidth="1.4"/>
      <path d="M8 5v4M8 11v.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"/>
    </svg>
  ),
  empty: (
    <svg width="48" height="48" viewBox="0 0 48 48" fill="none">
      <rect x="8" y="4" width="32" height="40" rx="4" stroke="currentColor" strokeWidth="1.6"/>
      <path d="M16 16h16M16 22h16M16 28h10" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"/>
    </svg>
  ),
}

/* ─── Main component ─── */
export function ReleasesTab() {
  const [manifest, setManifest] = useState<PlatformUpdateLatestResponse | null>(null)
  const [health, setHealth] = useState<PlatformUpdateHealthResponse | null>(null)
  const [files, setFiles] = useState<PlatformUpdateFileEntry[] | null>(null)
  const [updatesDir, setUpdatesDir] = useState<string>('')
  const [error, setError] = useState<string | null>(null)
  const [toast, setToast] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [uploadPct, setUploadPct] = useState<number | null>(null)
  const [dragOver, setDragOver] = useState(false)
  const [deleting, setDeleting] = useState<string | null>(null)
  const [publishing, setPublishing] = useState<string | null>(null)

  const fileInputRef = useRef<HTMLInputElement | null>(null)

  const feedUrl = useMemo(() => {
    if (typeof window === 'undefined') return ''
    return `${window.location.origin.replace(/\/$/, '')}/updates/`
  }, [])

  const loadAll = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const [mRes, hRes, fRes] = await Promise.all([
        fetch('/api/platform/update/latest'),
        fetch('/api/platform/update/health'),
        fetch('/api/platform/admin/updates/files', { credentials: 'include' }),
      ])
      if (!mRes.ok) throw new Error(`manifest: ${mRes.statusText}`)
      if (!hRes.ok) throw new Error(`health: ${hRes.statusText}`)
      if (!fRes.ok) throw new Error(`files: ${fRes.statusText}`)
      const m = (await mRes.json()) as PlatformUpdateLatestResponse
      const h = (await hRes.json()) as PlatformUpdateHealthResponse
      const f = (await fRes.json()) as PlatformUpdateFilesResponse
      setManifest(m)
      setHealth(h)
      setFiles(f.files)
      setUpdatesDir(f.updatesDir)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { void loadAll() }, [loadAll])

  async function copyFeedUrl() {
    try {
      await navigator.clipboard.writeText(feedUrl)
      setToast('Feed URL copied')
      window.setTimeout(() => setToast(null), 1800)
    } catch {
      setToast('Could not copy')
      window.setTimeout(() => setToast(null), 1800)
    }
  }

  function pickFiles() { fileInputRef.current?.click() }

  function uploadFiles(fileList: FileList | File[]) {
    const arr = Array.from(fileList)
    if (arr.length === 0) return
    setUploading(true)
    setUploadPct(0)
    setError(null)
    setToast(null)

    const form = new FormData()
    for (const f of arr) form.append('files', f, f.name)

    const xhr = new XMLHttpRequest()
    xhr.withCredentials = true
    xhr.open('POST', '/api/platform/admin/updates/upload')
    xhr.upload.onprogress = (ev) => {
      if (ev.lengthComputable) {
        setUploadPct(Math.round((ev.loaded / ev.total) * 100))
      }
    }
    xhr.onload = () => {
      setUploading(false)
      setUploadPct(null)
      if (xhr.status >= 200 && xhr.status < 300) {
        try {
          const body = JSON.parse(xhr.responseText) as PlatformUpdateUploadResponse
          setFiles(body.files)
          if (body.rejected.length > 0) {
            setError(
              `Rejected: ${body.rejected.map((r) => `${r.name} (${r.reason})`).join(', ')}`,
            )
          } else {
            setToast(`Uploaded ${body.accepted.length} file${body.accepted.length === 1 ? '' : 's'}`)
            window.setTimeout(() => setToast(null), 2400)
          }
          void loadAll()
        } catch {
          setError('Bad server response')
        }
      } else {
        let msg = `Upload failed (${xhr.status})`
        try {
          const j = JSON.parse(xhr.responseText) as { error?: string; message?: string }
          msg = j.message ?? j.error ?? msg
        } catch { /* ignore */ }
        setError(msg)
      }
    }
    xhr.onerror = () => {
      setUploading(false); setUploadPct(null); setError('Network error during upload')
    }
    xhr.send(form)
  }

  function onDrop(e: React.DragEvent<HTMLDivElement>) {
    e.preventDefault()
    setDragOver(false)
    if (uploading) return
    if (!e.dataTransfer?.files || e.dataTransfer.files.length === 0) return
    uploadFiles(e.dataTransfer.files)
  }

  async function publishInstaller(name: string) {
    if (!window.confirm(
      `Publish ${name} to clients?\n\n` +
      `A new latest.yml will be written and every connected POS will see the update on its next check.`,
    )) return
    setPublishing(name); setError(null); setToast(null)
    try {
      const r = await fetch('/api/platform/admin/updates/publish', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ installer: name }),
      })
      if (!r.ok) {
        const j = (await r.json().catch(() => ({}))) as { error?: string; message?: string }
        throw new Error(j.message ?? j.error ?? r.statusText)
      }
      const body = (await r.json()) as PlatformUpdatePublishResponse
      setToast(`Published v${body.version} · clients will pick it up on their next check`)
      window.setTimeout(() => setToast(null), 3200)
      void loadAll()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setPublishing(null)
    }
  }

  async function deleteFile(name: string) {
    if (!window.confirm(`Delete ${name}?`)) return
    setDeleting(name); setError(null)
    try {
      const r = await fetch(`/api/platform/admin/updates/files/${encodeURIComponent(name)}`, {
        method: 'DELETE',
        credentials: 'include',
      })
      if (!r.ok) {
        const j = (await r.json().catch(() => ({}))) as { error?: string; message?: string }
        throw new Error(j.message ?? j.error ?? r.statusText)
      }
      const body = (await r.json()) as PlatformUpdateFilesResponse
      setFiles(body.files)
      setToast(`Deleted ${name}`)
      window.setTimeout(() => setToast(null), 1800)
      void loadAll()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setDeleting(null)
    }
  }

  const hasManifest = manifest && 'version' in manifest
  const healthy = Boolean(health?.directoryExists && health?.latestYmlExists)
  const publishedInstaller = hasManifest ? (manifest as { path: string }).path : null

  return (
    <>
      {/* Error / toast */}
      {error ? (
        <div className="alert" role="alert">
          {Ico.exclamation}
          <span>{error}</span>
        </div>
      ) : null}
      {toast ? (
        <div className="rel-toast" role="status" aria-live="polite">{toast}</div>
      ) : null}

      {/* ── Health / manifest summary ── */}
      <div className="rel-summary">
        <div className="rel-summary__row">
          <span className={`rel-dot ${healthy ? 'rel-dot--ok' : 'rel-dot--warn'}`} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div className="rel-summary__title">
              {hasManifest
                ? `Live: v${(manifest as { version: string }).version}`
                : 'No release published'}
            </div>
            <div className="rel-summary__sub">
              {health?.latestYmlExists
                ? `Manifest present · ${fmtIso((manifest as { releaseDate?: string | null }).releaseDate ?? null)}`
                : health?.directoryExists
                  ? 'Folder exists but `latest.yml` is missing'
                  : 'Updates folder does not exist'}
            </div>
          </div>
        </div>
        {hasManifest ? (
          <>
            <div className="rel-summary__divider" />
            <div className="rel-summary__kv">
              <div className="rel-summary__kv-row">
                <span className="rel-summary__kv-key">Installer</span>
                <span className="rel-summary__kv-val" dir="ltr">
                  {(manifest as { path: string }).path || '—'}
                </span>
              </div>
              {(manifest as { sha512?: string | null }).sha512 ? (
                <div className="rel-summary__kv-row">
                  <span className="rel-summary__kv-key">SHA-512</span>
                  <span className="rel-summary__kv-val rel-summary__kv-val--mono" dir="ltr">
                    {(manifest as { sha512: string }).sha512.slice(0, 12)}…
                  </span>
                </div>
              ) : null}
              <div className="rel-summary__kv-row">
                <span className="rel-summary__kv-key">Folder</span>
                <span className="rel-summary__kv-val rel-summary__kv-val--mono" dir="ltr">
                  {updatesDir || '—'}
                </span>
              </div>
            </div>
          </>
        ) : null}
      </div>

      {/* ── Feed URL ── */}
      <p className="section-label">Feed URL</p>
      <div className="ios-section" style={{ marginBottom: 20 }}>
        <div className="rel-url-row">
          <code className="rel-url" dir="ltr">{feedUrl}</code>
          <button
            type="button"
            className="btn btn-pill btn-pill--blue"
            onClick={() => void copyFeedUrl()}
            aria-label="Copy feed URL"
          >
            {Ico.copy}
            Copy
          </button>
        </div>
        <p className="rel-hint">
          Point the POS client's <code>AMAAN_UPDATE_FEED_URL_EMBEDDED</code> build variable at this URL
          (use HTTPS in production).
        </p>
      </div>

      {/* ── Drop-zone ── */}
      <p className="section-label">Publish release</p>
      <div
        role="button"
        tabIndex={0}
        className={`rel-drop${dragOver ? ' rel-drop--active' : ''}${uploading ? ' rel-drop--busy' : ''}`}
        onClick={() => { if (!uploading) pickFiles() }}
        onKeyDown={(e) => { if ((e.key === 'Enter' || e.key === ' ') && !uploading) pickFiles() }}
        onDragOver={(e) => { e.preventDefault(); if (!uploading) setDragOver(true) }}
        onDragLeave={() => setDragOver(false)}
        onDrop={onDrop}
        aria-disabled={uploading}
      >
        <div className="rel-drop__icon">{Ico.upload}</div>
        <div className="rel-drop__title">
          {uploading
            ? `Uploading… ${uploadPct != null ? `${uploadPct}%` : ''}`
            : 'Drop installer + latest.yml here'}
        </div>
        <div className="rel-drop__sub">
          {uploading ? 'Please keep this tab open.' : 'or click to choose files'}
        </div>
        {uploading && uploadPct != null ? (
          <div className="rel-drop__bar"><div style={{ width: `${uploadPct}%` }} /></div>
        ) : null}
        <input
          ref={fileInputRef}
          type="file"
          multiple
          accept=".yml,.yaml,.exe,.blockmap,.zip,.dmg,.AppImage,.deb,.rpm"
          style={{ display: 'none' }}
          onChange={(e) => {
            if (e.target.files && e.target.files.length > 0) uploadFiles(e.target.files)
            e.target.value = ''
          }}
        />
      </div>

      {/* ── File list ── */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 28, marginBottom: 8 }}>
        <p className="section-label" style={{ margin: 0 }}>
          Artifacts{files && files.length > 0 ? ` — ${files.length}` : ''}
        </p>
        <button
          type="button"
          className="btn btn-nav"
          onClick={() => void loadAll()}
          disabled={loading || uploading}
          aria-label="Refresh"
        >
          {loading ? <span className="spinner spinner--blue" style={{ width: 14, height: 14 }} /> : Ico.refresh}
        </button>
      </div>

      {files === null ? (
        <div className="empty-state">
          <span className="spinner spinner--blue" style={{ width: 28, height: 28 }} />
        </div>
      ) : files.length === 0 ? (
        <div className="empty-state" style={{ color: 'var(--label-3)' }}>
          {Ico.empty}
          <p className="empty-state__title">No artifacts</p>
          <p className="empty-state__sub">Drop a release above to publish it.</p>
        </div>
      ) : (
        <div className="ios-section" style={{ marginBottom: 24 }}>
          {files.map((f, idx) => {
            const publishable = isPublishable(f.name)
            const isLive = publishedInstaller === f.name
            return (
              <div key={f.name} className="rel-file" style={idx === 0 ? { borderRadius: 0 } : {}}>
                <div className="rel-file__main">
                  <div className="rel-file__head">
                    <span className={fileBadgeClass(f.name)}>{fileExtLabel(f.name)}</span>
                    {isLive ? <span className="rel-badge rel-badge--live">LIVE</span> : null}
                    <a
                      className="rel-file__name"
                      href={`/updates/${encodeURIComponent(f.name)}`}
                      target="_blank"
                      rel="noreferrer"
                      dir="ltr"
                    >
                      {f.name}
                    </a>
                  </div>
                  <div className="rel-file__meta">
                    <span>{fmtBytes(f.sizeBytes)}</span>
                    <span>·</span>
                    <span>{fmtDateTime(f.modifiedAtMs)}</span>
                  </div>
                </div>
                <div className="rel-file__actions">
                  {publishable ? (
                    <button
                      type="button"
                      className={`rel-file__publish${isLive ? ' rel-file__publish--live' : ''}`}
                      onClick={() => void publishInstaller(f.name)}
                      disabled={publishing === f.name || deleting === f.name}
                      title={isLive ? 'Re-publish this version' : 'Publish to clients'}
                    >
                      {publishing === f.name ? (
                        <span className="spinner spinner--blue" style={{ width: 14, height: 14 }} />
                      ) : (
                        <>
                          {Ico.broadcast}
                          <span>{isLive ? 'Re-publish' : 'Publish'}</span>
                        </>
                      )}
                    </button>
                  ) : null}
                  <button
                    type="button"
                    className="act-btn act-btn--red rel-file__del"
                    onClick={() => void deleteFile(f.name)}
                    disabled={deleting === f.name || publishing === f.name}
                    aria-label={`Delete ${f.name}`}
                  >
                    {deleting === f.name
                      ? <span className="spinner spinner--blue" style={{ width: 14, height: 14 }} />
                      : Ico.trash}
                  </button>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </>
  )
}
