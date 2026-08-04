/**
 * One-time script: dapatkan GOOGLE_OAUTH_REFRESH_TOKEN dari akun Google pribadi.
 *
 * Persiapan:
 * 1. Google Cloud Console → APIs & Services → Enable "Google Sheets API"
 * 2. Credentials → Create OAuth client ID → tipe "Desktop app"
 * 3. Copy Client ID & Client Secret ke .env:
 *    GOOGLE_OAUTH_CLIENT_ID=...
 *    GOOGLE_OAUTH_CLIENT_SECRET=...
 * 4. OAuth consent screen → tambahkan email pribadi sebagai Test user
 * 5. Jalankan: npm run auth:google
 * 6. Login pakai email pribadi → izinkan akses → salin refresh_token ke .env & Vercel
 */

import http from 'node:http'
import { readFileSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { exec } from 'node:child_process'

const PORT = 8765
const REDIRECT_URI = `http://localhost:${PORT}/oauth2callback`
const SCOPE = 'https://www.googleapis.com/auth/spreadsheets'

function loadEnvFile() {
  const p = resolve(process.cwd(), '.env')
  if (!existsSync(p)) return {}
  const out = {}
  for (const line of readFileSync(p, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/)
    if (!m) continue
    out[m[1]] = m[2].replace(/^["']|["']$/g, '')
  }
  return out
}

const env = { ...loadEnvFile(), ...process.env }
const clientId = env.GOOGLE_OAUTH_CLIENT_ID
const clientSecret = env.GOOGLE_OAUTH_CLIENT_SECRET

if (!clientId || !clientSecret) {
  console.error('Set GOOGLE_OAUTH_CLIENT_ID dan GOOGLE_OAUTH_CLIENT_SECRET di .env dulu.')
  process.exit(1)
}

const authUrl =
  'https://accounts.google.com/o/oauth2/v2/auth?' +
  new URLSearchParams({
    client_id: clientId,
    redirect_uri: REDIRECT_URI,
    response_type: 'code',
    scope: SCOPE,
    access_type: 'offline',
    prompt: 'consent',
  }).toString()

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://localhost:${PORT}`)
    if (url.pathname !== '/oauth2callback') {
      res.writeHead(404)
      res.end('Not found')
      return
    }
    const code = url.searchParams.get('code')
    const err = url.searchParams.get('error')
    if (err) {
      res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' })
      res.end(`<h1>Gagal: ${err}</h1>`)
      server.close()
      process.exit(1)
    }

    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: REDIRECT_URI,
        grant_type: 'authorization_code',
      }),
    })
    const tokens = await tokenRes.json()
    if (!tokenRes.ok) {
      res.writeHead(500, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify(tokens, null, 2))
      server.close()
      process.exit(1)
    }

    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
    res.end(
      `<h1>Berhasil</h1><p>Refresh token ada di terminal. Tutup tab ini.</p>` +
        `<pre>${tokens.refresh_token || '(kosong — revoke akses app di akun Google lalu ulangi dengan prompt=consent)'}</pre>`
    )

    console.log('\n=== SALIN KE .env DAN VERCEL ===\n')
    console.log(`GOOGLE_OAUTH_REFRESH_TOKEN=${tokens.refresh_token || ''}`)
    console.log('\n================================\n')
    if (!tokens.refresh_token) {
      console.warn(
        'Refresh token kosong. Buka https://myaccount.google.com/permissions hapus akses app ini, lalu jalankan ulang.'
      )
    }
    server.close()
    process.exit(0)
  } catch (e) {
    console.error(e)
    res.writeHead(500)
    res.end(String(e))
    server.close()
    process.exit(1)
  }
})

server.listen(PORT, () => {
  console.log('\nLogin pakai EMAIL PRIBADI Anda (pemilik/editor spreadsheet).\n')
  console.log('Buka URL ini jika browser tidak terbuka otomatis:\n')
  console.log(authUrl + '\n')
  const open =
    process.platform === 'darwin' ? `open "${authUrl}"` : process.platform === 'win32' ? `start "" "${authUrl}"` : `xdg-open "${authUrl}"`
  exec(open, () => {})
})
