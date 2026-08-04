import crypto from 'node:crypto'

const COOKIE_NAME = 'boss_session'
const MAX_AGE_SEC = 60 * 60 * 24 * 14 // 14 hari

function b64urlJson(obj) {
  return Buffer.from(JSON.stringify(obj)).toString('base64url')
}

function fromB64urlJson(str) {
  return JSON.parse(Buffer.from(str, 'base64url').toString('utf8'))
}

export function getSessionSecret(env = process.env) {
  return env['SESSION_SECRET'] || env['GOOGLE_OAUTH_CLIENT_SECRET'] || 'dev-insecure-session-secret'
}

export function parseEditorEmails(env = process.env) {
  const raw = env['EDITOR_EMAILS'] || ''
  return raw
    .split(',')
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean)
}

export function isEditorEmail(email, env = process.env) {
  if (!email) return false
  const list = parseEditorEmails(env)
  return list.includes(String(email).trim().toLowerCase())
}

export function signSession(payload, env = process.env) {
  const secret = getSessionSecret(env)
  const body = b64urlJson({
    ...payload,
    exp: Math.floor(Date.now() / 1000) + MAX_AGE_SEC,
  })
  const sig = crypto.createHmac('sha256', secret).update(body).digest('base64url')
  return `${body}.${sig}`
}

export function verifySession(token, env = process.env) {
  if (!token || !token.includes('.')) return null
  const secret = getSessionSecret(env)
  const [body, sig] = token.split('.')
  const expected = crypto.createHmac('sha256', secret).update(body).digest('base64url')
  const a = Buffer.from(sig)
  const b = Buffer.from(expected)
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null
  try {
    const payload = fromB64urlJson(body)
    if (!payload.exp || payload.exp < Math.floor(Date.now() / 1000)) return null
    return payload
  } catch {
    return null
  }
}

export function parseCookies(cookieHeader = '') {
  const out = {}
  for (const part of cookieHeader.split(';')) {
    const idx = part.indexOf('=')
    if (idx < 0) continue
    const k = part.slice(0, idx).trim()
    const v = part.slice(idx + 1).trim()
    out[k] = decodeURIComponent(v)
  }
  return out
}

export function getSessionFromRequest(req, env = process.env) {
  const cookies = parseCookies(req.headers?.cookie || req.headers?.Cookie || '')
  return verifySession(cookies[COOKIE_NAME], env)
}

export function sessionCookieHeader(token, { secure = true } = {}) {
  const parts = [
    `${COOKIE_NAME}=${encodeURIComponent(token)}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${MAX_AGE_SEC}`,
  ]
  if (secure) parts.push('Secure')
  return parts.join('; ')
}

export function clearSessionCookieHeader({ secure = true } = {}) {
  const parts = [`${COOKIE_NAME}=`, 'Path=/', 'HttpOnly', 'SameSite=Lax', 'Max-Age=0']
  if (secure) parts.push('Secure')
  return parts.join('; ')
}

let cachedCerts = null
let cachedCertsAt = 0
const CERTS_TTL_MS = 60 * 60 * 1000

function decodeJwtPart(part) {
  return JSON.parse(Buffer.from(part, 'base64url').toString('utf8'))
}

async function getGoogleCerts() {
  const now = Date.now()
  if (cachedCerts && now - cachedCertsAt < CERTS_TTL_MS) return cachedCerts
  const res = await fetch('https://www.googleapis.com/oauth2/v3/certs', {
    signal: AbortSignal.timeout(8000),
  })
  if (!res.ok) throw new Error('Gagal ambil Google certs')
  cachedCerts = await res.json()
  cachedCertsAt = now
  return cachedCerts
}

/**
 * Verifikasi Google ID token lokal (cepat, certs di-cache).
 * Fallback ke tokeninfo jika verifikasi lokal gagal.
 */
export async function verifyGoogleIdToken(idToken, env = process.env) {
  const clientId = env['GOOGLE_OAUTH_CLIENT_ID']
  if (!clientId) throw new Error('GOOGLE_OAUTH_CLIENT_ID belum di-set')
  if (!idToken || typeof idToken !== 'string') throw new Error('credential wajib')

  try {
    const parts = idToken.split('.')
    if (parts.length !== 3) throw new Error('format JWT tidak valid')
    const [hB64, pB64, sB64] = parts
    const header = decodeJwtPart(hB64)
    const payload = decodeJwtPart(pB64)

    if (payload.aud !== clientId) throw new Error('ID token audience tidak cocok')
    if (payload.iss !== 'https://accounts.google.com' && payload.iss !== 'accounts.google.com') {
      throw new Error('ID token issuer tidak valid')
    }
    const now = Math.floor(Date.now() / 1000)
    if (!payload.exp || payload.exp < now) throw new Error('ID token sudah kadaluarsa')
    if (payload.email_verified !== true && payload.email_verified !== 'true') {
      throw new Error('Email Google belum terverifikasi')
    }
    if (!payload.email) throw new Error('Email tidak ada di token')

    const certs = await getGoogleCerts()
    const jwk = (certs.keys || []).find((k) => k.kid === header.kid)
    if (!jwk) throw new Error('Google cert tidak ditemukan untuk kid')

    const keyObject = crypto.createPublicKey({ key: jwk, format: 'jwk' })
    const ok = crypto.verify(
      'RSA-SHA256',
      Buffer.from(`${hB64}.${pB64}`),
      keyObject,
      Buffer.from(sB64, 'base64url')
    )
    if (!ok) throw new Error('Tanda tangan ID token tidak valid')

    return {
      email: payload.email,
      name: payload.name || payload.email,
      picture: payload.picture || '',
    }
  } catch (localErr) {
    // Fallback: tokeninfo (lebih lambat, bergantung jaringan ke Google)
    const res = await fetch(
      `https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(idToken)}`,
      { signal: AbortSignal.timeout(10000) }
    )
    const data = await res.json().catch(() => ({}))
    if (!res.ok) {
      throw new Error(
        data.error_description || data.error || localErr.message || 'ID token tidak valid'
      )
    }
    if (data.aud !== clientId) throw new Error('ID token audience tidak cocok')
    if (data.email_verified !== 'true' && data.email_verified !== true) {
      throw new Error('Email Google belum terverifikasi')
    }
    return {
      email: data.email,
      name: data.name || data.email,
      picture: data.picture || '',
    }
  }
}

export { COOKIE_NAME, MAX_AGE_SEC }
