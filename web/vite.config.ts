import path from 'node:path'
import { fileURLToPath } from 'node:url'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

const root = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.join(root, '..')

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
      },
      '/updates': {
        target: 'http://127.0.0.1:3850',
        changeOrigin: true,
      },
    },
  },
})
