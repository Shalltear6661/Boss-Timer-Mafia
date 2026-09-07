/**
 * Production HTTP server untuk Railway (atau host Node apa pun).
 * Melayani static build (dist/) + API handlers di /api/*.
 */
import http from 'node:http'
import { createReadStream, existsSync, readFileSync } from 'node:fs'
import { stat } from 'node:fs/promises'
import { dirname, extname, join, normalize } from 'node:path'
import { fileURLToPath } from 'node:url'

import auth from './api/auth.js'
import sheets from './api/sheets.js'
import kill from './api/kill.js'
import pushVapid from './api/push-vapid.js'
import pushSubscribe from './api/push-subscribe.js'
import pushNotify from './api/push-notify.js'
import cronPush from './api/cron-push.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const DIST = join(__dirname, 'dist')
const PORT = Number(process.env.PORT) || 3000

/** Muat .env lokal jika ada (Railway sudah inject env vars). */
function loadEnvFile() {
  const p = join(__dirname, '.env')
  if (!existsSync(p)) return
  for (const line of readFileSync(p, 'utf8').split('\n')) {
    const t = line.trim()
    if (!t || t.startsWith('#')) continue
    const i = t.indexOf('=')
    if (i < 0) continue
    const key = t.slice(0, i).trim()
    let val = t.slice(i + 1).trim()
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1)
    }
    if (process.env[key] === undefined) process.env[key] = val
  }
}

loadEnvFile()

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.webp': 'image/webp',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.json': 'application/json',
  '.webmanifest': 'application/manifest+json',
  '.map': 'application/json',
}

const routes = [
  [/^\/api\/auth\/?$/, auth],
  [/^\/api\/sheets\/?$/, sheets],
  [/^\/api\/kill\/?$/, kill],
  [/^\/api\/push-vapid\/?$/, pushVapid],
  [/^\/api\/push-subscribe\/?$/, pushSubscribe],
  [/^\/api\/push-notify\/?$/, pushNotify],
  [/^\/api\/cron-push\/?$/, cronPush],
]

function safeDistPath(pathname) {
  const rel = pathname === '/' ? 'index.html' : pathname.replace(/^\//, '')
  const resolved = normalize(join(DIST, rel))
  if (!resolved.startsWith(DIST)) return null
  return resolved
}

async function serveStatic(req, res, pathname) {
  let filePath = safeDistPath(pathname)
  if (!filePath) {
    res.statusCode = 403
    res.end('Forbidden')
    return
  }

  try {
    let s = await stat(filePath)
    if (s.isDirectory()) {
      filePath = join(filePath, 'index.html')
      s = await stat(filePath)
    }
  } catch {
    // SPA fallback untuk client-side routes
    filePath = join(DIST, 'index.html')
    try {
      await stat(filePath)
    } catch {
      res.statusCode = 404
      res.setHeader('Content-Type', 'text/plain; charset=utf-8')
      res.end('Not found — jalankan npm run build terlebih dahulu')
      return
    }
  }

  const ext = extname(filePath)
  res.statusCode = 200
  res.setHeader('Content-Type', MIME[ext] || 'application/octet-stream')
  createReadStream(filePath).pipe(res)
}

const server = http.createServer(async (req, res) => {
  try {
    const host = req.headers.host || 'localhost'
    const url = new URL(req.url || '/', `http://${host}`)
    const pathname = url.pathname

    for (const [re, handler] of routes) {
      if (re.test(pathname)) {
        await handler(req, res)
        return
      }
    }

    if (pathname.startsWith('/api/')) {
      res.statusCode = 404
      res.setHeader('Content-Type', 'application/json')
      res.end(JSON.stringify({ error: 'API tidak ditemukan' }))
      return
    }

    await serveStatic(req, res, pathname)
  } catch (e) {
    console.error('[server]', e)
    if (!res.headersSent) {
      res.statusCode = 500
      res.setHeader('Content-Type', 'application/json')
      res.end(JSON.stringify({ error: 'Internal server error' }))
    }
  }
})

server.listen(PORT, '0.0.0.0', () => {
  console.log(`Boss Timer listening on 0.0.0.0:${PORT}`)
})
