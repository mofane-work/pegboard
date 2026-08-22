/// <reference types="vitest/config" />
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const dirname = path.dirname(fileURLToPath(import.meta.url))

/**
 * Deploy target decides the base path:
 *  - Vercel / custom domain / local  → '/'
 *  - GitHub Pages project site       → '/<repo>/'
 *
 * The Pages workflow sets BASE_PATH; everything else gets the default.
 */
const base = process.env.BASE_PATH ?? '/'

/**
 * Dev/preview are reachable over Tailscale, not just localhost, so the server
 * binds every interface and explicitly trusts tailnet hostnames. Vite rejects
 * unknown Host headers by default (DNS-rebinding protection) — without this,
 * a tailnet visit returns "Blocked request" rather than the app.
 */
const server = {
  host: true,
  port: 3001,
  strictPort: true,
  allowedHosts: ['.ts.net', 'nuc-server', 'localhost'],
}

export default defineConfig({
  base,
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(dirname, 'src'),
    },
  },
  server,
  preview: server,
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['src/test/setup.ts'],
  },
})
