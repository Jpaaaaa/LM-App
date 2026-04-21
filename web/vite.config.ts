import type { IncomingMessage } from 'node:http'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

const root = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.join(root, '..')

/** Dev server is http://localhost — strip Secure from proxied Set-Cookie so the browser stores the session. */
function stripSecureFromSetCookie(proxyRes: IncomingMessage): void {
  const raw = proxyRes.headers['set-cookie']
  if (raw == null) return
  const list = Array.isArray(raw) ? raw : [raw]
  proxyRes.headers['set-cookie'] = list.map((c) => c.replace(/;\s*Secure/gi, ''))
}

export default defineConfig({
  plugins: [react()],
  root,
  base: '/',
  build: {
    outDir: path.join(root, 'dist'),
    emptyDir: true,
  },
  resolve: {
    alias: {
      '@shared': path.join(repoRoot, 'shared'),
    },
  },
  server: {
    port: 3851,
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:3850',
        changeOrigin: true,
        configure(proxy) {
          proxy.on('proxyRes', stripSecureFromSetCookie)
        },
      },
      '/updates': {
        target: 'http://127.0.0.1:3850',
        changeOrigin: true,
        configure(proxy) {
          proxy.on('proxyRes', stripSecureFromSetCookie)
        },
      },
    },
  },
})
