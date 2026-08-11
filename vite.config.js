import { defineConfig, loadEnv } from 'vite'
import { svelte } from '@sveltejs/vite-plugin-svelte'
import { fetchSheetValues } from './server/sheets.js'
import { markBossKilledOnSheet } from './server/sheetsWrite.js'
import {
  verifyGoogleIdToken,
  signSession,
  sessionCookieHeader,
  clearSessionCookieHeader,
  getSessionFromRequest,
  isEditorEmail,
} from './server/session.js'

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = []
    req.on('data', (c) => chunks.push(c))
    req.on('end', () => {
      try {
        const raw = Buffer.concat(chunks).toString('utf8')
        resolve(raw ? JSON.parse(raw) : {})
      } catch (e) {
        reject(e)
      }
    })
    req.on('error', reject)
  })
}

function sendJson(res, status, data, headers = {}) {
  res.statusCode = status
  res.setHeader('Content-Type', 'application/json')
  for (const [k, v] of Object.entries(headers)) res.setHeader(k, v)
  res.end(JSON.stringify(data))
}

function sheetsApiPlugin(env) {
  async function handle(req, res, next) {
    const url = req.url || ''

    // --- Auth ---
    if (url.startsWith('/api/auth')) {
      try {
        const parsed = new URL(url, 'http://localhost')
        const action = parsed.searchParams.get('action') || (req.method === 'GET' ? 'me' : '')

        if (req.method === 'GET' && action === 'config') {
          sendJson(res, 200, {
            clientId: env['GOOGLE_OAUTH_CLIENT_ID'] || process.env['GOOGLE_OAUTH_CLIENT_ID'] || '',
          })
          return
        }

        if (req.method === 'GET' && (action === 'me' || action === '')) {
          // Vite middleware: reconstruct cookie header from req
          const fakeReq = { headers: { cookie: req.headers.cookie || '' } }
          const session = getSessionFromRequest(fakeReq, env)
          if (!session?.email) {
            sendJson(res, 200, { authenticated: false, canEdit: false })
            return
          }
          sendJson(res, 200, {
            authenticated: true,
            email: session.email,
            name: session.name || session.email,
            picture: session.picture || '',
            canEdit: isEditorEmail(session.email, env),
          })
          return
        }

        if (req.method === 'POST' && action === 'login') {
          const body = await readJsonBody(req)
          const profile = await verifyGoogleIdToken(body.credential, env)
          const token = signSession(
            { email: profile.email, name: profile.name, picture: profile.picture },
            env
          )
          sendJson(
            res,
            200,
            {
              authenticated: true,
              email: profile.email,
              name: profile.name,
              picture: profile.picture,
              canEdit: isEditorEmail(profile.email, env),
            },
            { 'Set-Cookie': sessionCookieHeader(token, { secure: false }) }
          )
          return
        }

        if (req.method === 'POST' && action === 'logout') {
          sendJson(res, 200, { ok: true }, {
            'Set-Cookie': clearSessionCookieHeader({ secure: false }),
          })
          return
        }

        sendJson(res, 400, { error: 'action tidak dikenal' })
      } catch (e) {
        console.error('[auth-proxy]', e)
        sendJson(res, 401, { error: e.message || 'Auth gagal' })
      }
      return
    }

    if (url.startsWith('/api/sheets')) {
      try {
        const parsed = new URL(url, 'http://localhost')
        const range = parsed.searchParams.get('range')
        if (!range) {
          sendJson(res, 400, { error: 'Query range wajib' })
          return
        }
        const values = await fetchSheetValues(range, env)
        sendJson(res, 200, { values })
      } catch (e) {
        console.error('[sheets-proxy]', e)
        sendJson(res, 500, { error: e.message || 'Gagal fetch spreadsheet' })
      }
      return
    }

    if (url.startsWith('/api/kill') && req.method === 'POST') {
      try {
        const fakeReq = { headers: { cookie: req.headers.cookie || '' } }
        const session = getSessionFromRequest(fakeReq, env)
        if (!session?.email) {
          sendJson(res, 401, { error: 'Login dulu untuk menandai mati' })
          return
        }
        if (!isEditorEmail(session.email, env)) {
          sendJson(res, 403, { error: 'Akun Anda view-only. Hanya Editor yang bisa Tandai Mati.' })
          return
        }
        const body = await readJsonBody(req)
        const name = body.name || body.bossName
        if (!name) {
          sendJson(res, 400, { error: 'Field name wajib' })
          return
        }
        const deathISO = body.deathTime || body.deathDate || null
        const deathDate = deathISO ? new Date(deathISO) : new Date()
        const result = await markBossKilledOnSheet(String(name), env, deathDate)
        sendJson(res, 200, { ok: true, ...result, by: session.email })
      } catch (e) {
        console.error('[kill-proxy]', e)
        sendJson(res, 500, { error: e.message || 'Gagal update spreadsheet' })
      }
      return
    }

    return next()
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
  const env = loadEnv(mode, process.cwd(), '')
  // Client ID bersifat publik — inject ke frontend supaya tombol login
  // tidak bergantung hanya pada /api/auth (dan ikut ter-update saat rebuild).
  const googleClientId = env.GOOGLE_OAUTH_CLIENT_ID || process.env.GOOGLE_OAUTH_CLIENT_ID || ''
  return {
    define: {
      __GOOGLE_OAUTH_CLIENT_ID__: JSON.stringify(googleClientId),
    },
    plugins: [svelte(), sheetsApiPlugin({ ...env, GOOGLE_OAUTH_CLIENT_ID: googleClientId })],
  }
})
