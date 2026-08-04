import {
  verifyGoogleIdToken,
  signSession,
  sessionCookieHeader,
  clearSessionCookieHeader,
  getSessionFromRequest,
  isEditorEmail,
} from '../server/session.js'

function readBody(req) {
  return new Promise(async (resolve, reject) => {
    try {
      if (req.body && typeof req.body === 'object' && !Buffer.isBuffer(req.body)) {
        resolve(req.body)
        return
      }
      if (typeof req.body === 'string') {
        resolve(req.body ? JSON.parse(req.body) : {})
        return
      }
      const chunks = []
      for await (const chunk of req) chunks.push(chunk)
      const raw = Buffer.concat(chunks).toString('utf8')
      resolve(raw ? JSON.parse(raw) : {})
    } catch (e) {
      reject(e)
    }
  })
}

function isSecure(req) {
  const proto = req.headers['x-forwarded-proto'] || ''
  return String(proto).includes('https') || process.env.NODE_ENV === 'production'
}

/**
 * GET  /api/auth?action=config|me
 * POST /api/auth?action=login|logout
 */
export default async function handler(req, res) {
  res.setHeader('Content-Type', 'application/json')
  const url = new URL(req.url || '/', 'http://localhost')
  const action = url.searchParams.get('action') || (req.method === 'GET' ? 'me' : '')

  try {
    if (req.method === 'GET' && action === 'config') {
      const clientId = process.env['GOOGLE_OAUTH_CLIENT_ID'] || ''
      res.statusCode = 200
      res.end(JSON.stringify({ clientId }))
      return
    }

    if (req.method === 'GET' && (action === 'me' || action === '')) {
      const session = getSessionFromRequest(req, process.env)
      if (!session?.email) {
        res.statusCode = 200
        res.end(JSON.stringify({ authenticated: false, canEdit: false }))
        return
      }
      res.statusCode = 200
      res.end(
        JSON.stringify({
          authenticated: true,
          email: session.email,
          name: session.name || session.email,
          picture: session.picture || '',
          canEdit: isEditorEmail(session.email, process.env),
        })
      )
      return
    }

    if (req.method === 'POST' && action === 'login') {
      const body = await readBody(req)
      const credential = body.credential
      if (!credential) {
        res.statusCode = 400
        res.end(JSON.stringify({ error: 'credential wajib' }))
        return
      }
      const profile = await verifyGoogleIdToken(credential, process.env)
      const token = signSession(
        { email: profile.email, name: profile.name, picture: profile.picture },
        process.env
      )
      res.setHeader('Set-Cookie', sessionCookieHeader(token, { secure: isSecure(req) }))
      res.statusCode = 200
      res.end(
        JSON.stringify({
          authenticated: true,
          email: profile.email,
          name: profile.name,
          picture: profile.picture,
          canEdit: isEditorEmail(profile.email, process.env),
        })
      )
      return
    }

    if (req.method === 'POST' && action === 'logout') {
      res.setHeader('Set-Cookie', clearSessionCookieHeader({ secure: isSecure(req) }))
      res.statusCode = 200
      res.end(JSON.stringify({ ok: true }))
      return
    }

    res.statusCode = 400
    res.end(JSON.stringify({ error: 'action tidak dikenal' }))
  } catch (e) {
    console.error('[api/auth]', e?.message || e)
    res.statusCode = 401
    res.end(JSON.stringify({ error: e.message || 'Auth gagal' }))
  }
}
