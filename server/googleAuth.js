/**
 * Access token untuk menulis ke Google Sheets.
 *
 * Prioritas:
 * 1. Service Account (disarankan) — GOOGLE_SERVICE_ACCOUNT_EMAIL + PRIVATE_KEY
 *    atau GOOGLE_SERVICE_ACCOUNT_JSON (string JSON lengkap)
 * 2. Fallback OAuth refresh token pemilik sheet (opsional / legacy)
 */

import crypto from 'node:crypto'

const SA_SCOPE = 'https://www.googleapis.com/auth/spreadsheets'
const TOKEN_URL = 'https://oauth2.googleapis.com/token'

function b64url(input) {
  const buf = Buffer.isBuffer(input) ? input : Buffer.from(input)
  return buf.toString('base64url')
}

function parseServiceAccount(env) {
  const rawJson = env['GOOGLE_SERVICE_ACCOUNT_JSON']
  if (rawJson) {
    try {
      const parsed = typeof rawJson === 'string' ? JSON.parse(rawJson) : rawJson
      if (parsed?.client_email && parsed?.private_key) {
        return {
          clientEmail: parsed.client_email,
          privateKey: String(parsed.private_key).replace(/\\n/g, '\n'),
        }
      }
    } catch {
      const err = new Error('GOOGLE_SERVICE_ACCOUNT_JSON tidak valid (bukan JSON)')
      err.code = 'MISSING_SA'
      throw err
    }
  }

  const clientEmail = (env['GOOGLE_SERVICE_ACCOUNT_EMAIL'] || '').trim()
  let privateKey = (env['GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY'] || '').trim()
  if (clientEmail && privateKey) {
    // Vercel/env sering menyimpan newline sebagai \n
    privateKey = privateKey.replace(/\\n/g, '\n')
    // Hapus kutip wrapping jika ada
    if (
      (privateKey.startsWith('"') && privateKey.endsWith('"')) ||
      (privateKey.startsWith("'") && privateKey.endsWith("'"))
    ) {
      privateKey = privateKey.slice(1, -1).replace(/\\n/g, '\n')
    }
    return { clientEmail, privateKey }
  }

  return null
}

async function getServiceAccountAccessToken(env) {
  const sa = parseServiceAccount(env)
  if (!sa) return null

  const now = Math.floor(Date.now() / 1000)
  const header = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }))
  const claim = b64url(
    JSON.stringify({
      iss: sa.clientEmail,
      scope: SA_SCOPE,
      aud: TOKEN_URL,
      iat: now,
      exp: now + 3600,
    })
  )
  const unsigned = `${header}.${claim}`
  let signature
  try {
    signature = crypto.sign('RSA-SHA256', Buffer.from(unsigned), sa.privateKey)
  } catch (e) {
    const err = new Error(
      'Private key Service Account tidak valid. Pastikan GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY lengkap (termasuk BEGIN/END).'
    )
    err.code = 'SA_KEY_INVALID'
    err.cause = e
    throw err
  }
  const assertion = `${unsigned}.${b64url(signature)}`

  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion,
    }),
    signal: AbortSignal.timeout(15000),
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok || !data.access_token) {
    const err = new Error(
      data.error_description || data.error || `Gagal token Service Account (${res.status})`
    )
    err.code = 'SA_TOKEN_FAILED'
    throw err
  }
  return data.access_token
}

async function getOAuthRefreshAccessToken(env) {
  const clientId = env['GOOGLE_OAUTH_CLIENT_ID']
  const clientSecret = env['GOOGLE_OAUTH_CLIENT_SECRET']
  const refreshToken = env['GOOGLE_OAUTH_REFRESH_TOKEN']

  if (!clientId || !clientSecret || !refreshToken) return null

  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
    }),
    signal: AbortSignal.timeout(15000),
  })

  const data = await res.json().catch(() => ({}))
  if (!res.ok || !data.access_token) {
    const err = new Error(
      data.error_description || data.error || `Gagal refresh token (${res.status})`
    )
    err.code = 'OAUTH_REFRESH_FAILED'
    throw err
  }
  return data.access_token
}

export async function getAccessToken(env = process.env) {
  const saToken = await getServiceAccountAccessToken(env)
  if (saToken) return saToken

  const oauthToken = await getOAuthRefreshAccessToken(env)
  if (oauthToken) return oauthToken

  const err = new Error(
    'Belum ada kredensial tulis. Set Service Account: GOOGLE_SERVICE_ACCOUNT_EMAIL + GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY (atau GOOGLE_SERVICE_ACCOUNT_JSON), lalu share spreadsheet ke email SA sebagai Editor.'
  )
  err.code = 'MISSING_WRITE_CREDS'
  throw err
}
