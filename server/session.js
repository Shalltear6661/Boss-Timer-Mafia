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

/** Verifikasi Google ID token (credential dari GIS) */
export async function verifyGoogleIdToken(idToken, env = process.env) {
  const clientId = env['GOOGLE_OAUTH_CLIENT_ID']
  if (!clientId) throw new Error('GOOGLE_OAUTH_CLIENT_ID belum di-set')

  const res = await fetch(
    `https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(idToken)}`
  )
  const data = await res.json().catch(() => ({}))
  if (!res.ok) {
    throw new Error(data.error_description || data.error || 'ID token tidak valid')
  }
  if (data.aud !== clientId) {
    throw new Error('ID token audience tidak cocok')
  }
  if (data.email_verified !== 'true' && data.email_verified !== true) {
    throw new Error('Email Google belum terverifikasi')
  }
  return {
    email: data.email,
    name: data.name || data.email,
    picture: data.picture || '',
  }
}

export { COOKIE_NAME, MAX_AGE_SEC }
