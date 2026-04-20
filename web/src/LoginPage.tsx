import { useState } from 'react'

type Props = {
  onLoggedIn: () => void
}

export function LoginPage({ onLoggedIn }: Props) {
  const [username, setUsername] = useState('admin')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setBusy(true)
    try {
      const r = await fetch('/api/platform/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ username: username.trim(), password }),
      })
      if (!r.ok) {
        const j = (await r.json().catch(() => ({}))) as { error?: string; message?: string }
        throw new Error(j.message ?? j.error ?? 'Sign in failed')
      }
      onLoggedIn()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="login-shell">
      <div className="login-card">
        <div className="login-card__brand">
          <span className="login-card__icon" aria-hidden>
            <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" width="28" height="28">
              <path
                d="M15.5 3.5a2.5 2.5 0 0 1 2.5 2.5v2h-4v-2a2.5 2.5 0 0 1 2.5-2.5Z"
                stroke="currentColor"
                strokeWidth="1.35"
                strokeLinejoin="round"
              />
              <rect x="6" y="10" width="13" height="10.5" rx="2" stroke="currentColor" strokeWidth="1.35" />
              <circle cx="10" cy="15" r="1.4" fill="currentColor" />
            </svg>
          </span>
          <div>
            <h1 className="login-card__title">LM App</h1>
            <p className="login-card__subtitle">Sign in to admin</p>
          </div>
        </div>

        <form className="login-form" onSubmit={onSubmit}>
          <label className="login-field">
            <span className="login-field__label">Username</span>
            <input
              className="login-field__input"
              autoComplete="username"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              disabled={busy}
            />
          </label>
          <label className="login-field">
            <span className="login-field__label">Password</span>
            <input
              className="login-field__input"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              disabled={busy}
            />
          </label>
          {error ? (
            <div className="login-form__error" role="alert">
              {error}
            </div>
          ) : null}
          <button type="submit" className="login-form__submit" disabled={busy}>
            {busy ? 'Signing in…' : 'Sign in'}
          </button>
        </form>
      </div>
    </div>
  )
}
