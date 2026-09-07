/**
 * Production HTTP server untuk Railway (atau host Node apa pun).
 * Melayani static build (dist/) + API handlers di /api/*.
 */
import http from 'node:http'
import { createReadStream, existsSync, readFileSync, readdirSync } from 'node:fs'
import { stat } from 'node:fs/promises'
import { dirname, extname, join, normalize, relative, sep } from 'node:path'
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
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.webp': 'image/webp',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.mp3': 'audio/mpeg',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.json': 'application/json',
  '.webmanifest': 'application/manifest+json',
  '.map': 'application/json',
}

const ASSET_EXTS = new Set(Object.keys(MIME).filter((e) => e !== '.html'))

const routes = [
  [/^\/api\/auth\/?$/, auth],
  [/^\/api\/sheets\/?$/, sheets],
  [/^\/api\/kill\/?$/, kill],
  [/^\/api\/push-vapid\/?$/, pushVapid],
  [/^\/api\/push-subscribe\/?$/, pushSubscribe],
  [/^\/api\/push-notify\/?$/, pushNotify],
  [/^\/api\/cron-push\/?$/, cronPush],
]

function isInsideDist(resolved) {
  const rel = relative(DIST, resolved)
  return rel === '' || (!rel.startsWith('..') && !rel.includes(`..${sep}`))
}

function safeDistPath(pathname) {
  const decoded = decodeURIComponent(pathname.split('?')[0])
  const rel = decoded === '/' ? 'index.html' : decoded.replace(/^\/+/, '')
  const resolved = normalize(join(DIST, rel))
  if (!isInsideDist(resolved)) return null
  return resolved
}

function sendFile(res, filePath) {
  const ext = extname(filePath).toLowerCase()
  res.statusCode = 200
  res.setHeader('Content-Type', MIME[ext] || 'application/octet-stream')
  if (ext === '.html') {
    res.setHeader('Cache-Control', 'no-cache')
  } else if (ASSET_EXTS.has(ext)) {
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable')
  }
  createReadStream(filePath)
    .on('error', (err) => {
      console.error('[static]', err.message)
      if (!res.headersSent) {
        res.statusCode = 500
        res.end('Read error')
      } else {
        res.destroy()
      }
    })
    .pipe(res)
}

async function serveStatic(req, res, pathname) {
  const filePath = safeDistPath(pathname)
  if (!filePath) {
    res.statusCode = 403
    res.end('Forbidden')
    return
  }

  const ext = extname(pathname).toLowerCase()
  const looksLikeAsset = ASSET_EXTS.has(ext) || pathname.startsWith('/assets/')

  try {
    const s = await stat(filePath)
    if (s.isDirectory()) {
      const indexPath = join(filePath, 'index.html')
      await stat(indexPath)
      sendFile(res, indexPath)
      return
    }
    sendFile(res, filePath)
  } catch {
    // Jangan fallback HTML untuk .js/.css — itu penyebab MIME error di browser
    if (looksLikeAsset) {
      res.statusCode = 404
      res.setHeader('Content-Type', 'text/plain; charset=utf-8')
      res.end(`Asset not found: ${pathname}`)
      return
    }

    const spa = join(DIST, 'index.html')
    try {
      await stat(spa)
      sendFile(res, spa)
    } catch {
      res.statusCode = 404
      res.setHeader('Content-Type', 'text/plain; charset=utf-8')
      res.end('Not found — dist/ kosong. Pastikan build berhasil (npm run build).')
    }
  }
}

function logDistStatus() {
  const indexOk = existsSync(join(DIST, 'index.html'))
  const assetsDir = join(DIST, 'assets')
  let assetCount = 0
  try {
    assetCount = readdirSync(assetsDir).length
  } catch {
    assetCount = 0
  }
  console.log(`[server] DIST=${DIST}`)
  console.log(`[server] index.html=${indexOk ? 'ok' : 'MISSING'} assets=${assetCount}`)
  if (!indexOk) {
    console.error('[server] WARNING: dist/index.html tidak ada. Railway harus menjalankan npm run build sebelum start.')
  }
}

logDistStatus()

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
