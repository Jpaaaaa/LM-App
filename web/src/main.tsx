import { StrictMode, useCallback, useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'
import { LoginPage } from './LoginPage'
import './styles.css'

function Root() {
  const [gate, setGate] = useState<'loading' | 'in' | 'out'>('loading')

  const refresh = useCallback(async () => {
    const r = await fetch('/api/platform/auth/me', { credentials: 'include' })
    setGate(r.ok ? 'in' : 'out')
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  if (gate === 'loading') {
    return (
      <div className="login-gate">
        <p className="login-gate__msg">Loading…</p>
      </div>
    )
  }
  if (gate === 'out') {
    return <LoginPage onLoggedIn={() => setGate('in')} />
  }
  return (
    <App
      onLogout={() => setGate('out')}
    />
  )
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Root />
  </StrictMode>,
)
