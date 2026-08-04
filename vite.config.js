import { defineConfig, loadEnv } from 'vite'
import { svelte } from '@sveltejs/vite-plugin-svelte'
import { fetchSheetValues } from './server/sheets.js'

/**
 * Proxy /api/sheets di dev & preview — API key tetap di server (process.env).
 */
function sheetsApiPlugin(env) {
  async function handle(req, res, next) {
    const url = req.url || ''
    if (!url.startsWith('/api/sheets')) return next()

    try {
      const parsed = new URL(url, 'http://localhost')
      const range = parsed.searchParams.get('range')
      if (!range) {
        res.statusCode = 400
        res.setHeader('Content-Type', 'application/json')
        res.end(JSON.stringify({ error: 'Query range wajib' }))
        return
      }
      const values = await fetchSheetValues(range, env)
      res.statusCode = 200
      res.setHeader('Content-Type', 'application/json')
      res.end(JSON.stringify({ values }))
    } catch (e) {
      console.error('[sheets-proxy]', e)
      res.statusCode = 500
      res.setHeader('Content-Type', 'application/json')
      res.end(JSON.stringify({ error: e.message || 'Gagal fetch spreadsheet' }))
    }
  }

  return {
    name: 'sheets-api-proxy',
    configureServer(server) {
      server.middlewares.use(handle)
    },
    configurePreviewServer(server) {
      server.middlewares.use(handle)
    },
  }
}

export default defineConfig(({ mode }) => {
  // Prefix '' = load semua env termasuk GOOGLE_SHEETS_* (bukan hanya VITE_*)
  const env = loadEnv(mode, process.cwd(), '')
  return {
    plugins: [svelte(), sheetsApiPlugin(env)],
  }
})
