/**
 * Access token untuk menulis ke Google Sheets.
 *
 * Prioritas:
 * 1. GOOGLE_SERVICE_ACCOUNT_FILE → path ke file JSON key
 * 2. GOOGLE_SERVICE_ACCOUNT_JSON → string JSON lengkap
 * 3. GOOGLE_SERVICE_ACCOUNT_EMAIL + GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY
 * 4. Fallback OAuth refresh token (legacy)
 */

import crypto from 'node:crypto'
import { readFileSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'

const SA_SCOPE = 'https://www.googleapis.com/auth/spreadsheets'
const TOKEN_URL = 'https://oauth2.googleapis.com/token'

function b64url(input) {
  const buf = Buffer.isBuffer(input) ? input : Buffer.from(input)
  return buf.toString('base64url')
}

function normalizePrivateKey(raw) {
  let key = String(raw || '').trim()
  // Hapus kutip wrapping (env / paste)
  if (
    (key.startsWith('"') && key.endsWith('"')) ||
    (key.startsWith("'") && key.endsWith("'"))
  ) {
    key = key.slice(1, -1).trim()
  }
  // Literal \n → newline (Vercel / .env satu baris)
  key = key.replace(/\\n/g, '\n')
  // Rapikan spasi aneh di sekitar header PEM
  key = key.replace(/\r\n/g, '\n')
  if (!key.endsWith('\n')) key += '\n'
  return key
}

function fromJsonObject(parsed) {
  if (!parsed?.client_email || !parsed?.private_key) return null
  return {
    clientEmail: String(parsed.client_email).trim(),
    privateKey: normalizePrivateKey(parsed.private_key),
  }
}

function parseServiceAccount(env) {
  const filePath = (env['GOOGLE_SERVICE_ACCOUNT_FILE'] || '').trim()
  if (filePath) {
    const abs = resolve(process.cwd(), filePath)
    if (!existsSync(abs)) {
      const err = new Error(`File Service Account tidak ditemukan: ${filePath}`)
      err.code = 'MISSING_SA'
      throw err
    }
    try {
      const parsed = JSON.parse(readFileSync(abs, 'utf8'))
      const sa = fromJsonObject(parsed)
      if (sa) return sa
    } catch (e) {
      const err = new Error('GOOGLE_SERVICE_ACCOUNT_FILE bukan JSON Service Account yang valid')
      err.code = 'MISSING_SA'
      err.cause = e
      throw err
    }
  }

  const rawJson = env['GOOGLE_SERVICE_ACCOUNT_JSON']
  if (rawJson) {
    try {
      const parsed = typeof rawJson === 'string' ? JSON.parse(rawJson) : rawJson
      const sa = fromJsonObject(parsed)
      if (sa) return sa
    } catch {
      const err = new Error('GOOGLE_SERVICE_ACCOUNT_JSON tidak valid (bukan JSON)')
      err.code = 'MISSING_SA'
      throw err
    }
  }

  const clientEmail = (env['GOOGLE_SERVICE_ACCOUNT_EMAIL'] || '').trim()
  const privateKey = normalizePrivateKey(env['GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY'] || '')
  if (clientEmail && privateKey.includes('BEGIN PRIVATE KEY')) {
    return { clientEmail, privateKey }
  }

  return null
}

async function getServiceAccountAccessToken(env) {
  const sa = parseServiceAccount(env)
  if (!sa) return null

  let keyObject
  try {
    keyObject = crypto.createPrivateKey(sa.privateKey)
  } catch (e) {
    const err = new Error(
      'Private key Service Account tidak valid. Download ulang JSON key, lalu: npm run sa:env -- ./file.json'
    )
    err.code = 'SA_KEY_INVALID'
    err.cause = e
    throw err
  }

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
  const signer = crypto.createSign('RSA-SHA256')
  signer.update(unsigned)
  signer.end()
  const signature = signer.sign(keyObject)
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
    const msg = data.error_description || data.error || `Gagal token Service Account (${res.status})`
    const err = new Error(
      /invalid jwt signature/i.test(msg)
        ? 'Invalid JWT Signature — key SA di Google Cloud tidak cocok dengan file JSON. Hapus key lama, buat key JSON baru, ganti file, lalu npm run sa:test'
        : msg
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
    'Belum ada kredensial tulis. Set GOOGLE_SERVICE_ACCOUNT_FILE=./service-account.json (atau EMAIL + PRIVATE_KEY), lalu share spreadsheet ke email SA sebagai Editor.'
  )
  err.code = 'MISSING_WRITE_CREDS'
  throw err
}
