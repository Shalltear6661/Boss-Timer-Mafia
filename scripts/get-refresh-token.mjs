/**
 * One-time: dapatkan GOOGLE_OAUTH_REFRESH_TOKEN.
 *
 * ERROR "daftarkan URI pengalihan" = redirect URI belum ada di OAuth client.
 * Client ID di request harus SAMA dengan client yang Anda edit di Console.
 *
 * Setup (Web application — paling jelas di Console):
 * 1. https://console.cloud.google.com/apis/credentials
 * 2. Klik OAuth client yang Client ID-nya = yang di .env (bukan client lain)
 * 3. Application type harus "Web application"
 * 4. Authorized redirect URIs → ADD (bukan JavaScript origins):
 *      http://localhost:8765/oauth2callback
 * 5. Save → tunggu ~30 detik
 * 6. Consent screen → Test users → email Anda
 * 7. npm run auth:google
 *
 * Opsional di .env kalau URI Anda beda:
 *   GOOGLE_OAUTH_REDIRECT_URI=http://localhost:8765/oauth2callback
 */

import http from 'node:http'
import { readFileSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { exec } from 'node:child_process'
import readline from 'node:readline'

const PORT = 8765
const SCOPE = 'https://www.googleapis.com/auth/spreadsheets'
const TOKEN_TIMEOUT_MS = 25000

function loadEnvFile() {
  const p = resolve(process.cwd(), '.env')
  if (!existsSync(p)) return {}
  const out = {}
  for (const line of readFileSync(p, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/)
    if (!m) continue
    out[m[1]] = m[2].replace(/^["']|["']$/g, '').trim()
  }
  return out
}

const env = { ...loadEnvFile(), ...process.env }

const clientId = (
  env.GOOGLE_OAUTH_DESKTOP_CLIENT_ID ||
  env.GOOGLE_OAUTH_CLIENT_ID ||
  ''
).trim()
const clientSecret = (
  env.GOOGLE_OAUTH_DESKTOP_CLIENT_SECRET ||
  env.GOOGLE_OAUTH_CLIENT_SECRET ||
  ''
).trim()

const REDIRECT_URI = (
  env.GOOGLE_OAUTH_REDIRECT_URI ||
  `http://localhost:${PORT}/oauth2callback`
).trim()

if (!clientId || !clientSecret) {
  console.error('Set GOOGLE_OAUTH_CLIENT_ID dan GOOGLE_OAUTH_CLIENT_SECRET di .env')
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

async function exchangeCode(code) {
  const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code: code.trim(),
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: REDIRECT_URI,
      grant_type: 'authorization_code',
    }),
    signal: AbortSignal.timeout(TOKEN_TIMEOUT_MS),
  })
  const tokens = await tokenRes.json()
  if (!tokenRes.ok) {
    console.error('\nGagal tukar token:')
    console.error(JSON.stringify(tokens, null, 2))
    if (tokens.error === 'redirect_uri_mismatch' || /redirect/i.test(tokens.error_description || '')) {
      console.error(`\nredirect_uri yang dipakai: ${REDIRECT_URI}`)
      console.error('Harus PERSIS sama di Console → Authorized redirect URIs')
    }
    process.exit(1)
  }
  return tokens
}

function finish(tokens) {
  console.log('\n=== SALIN KE .env DAN VERCEL ===\n')
  console.log(`GOOGLE_OAUTH_REFRESH_TOKEN=${tokens.refresh_token || ''}`)
  console.log('\n================================\n')
  if (!tokens.refresh_token) {
    console.warn(
      'Refresh token kosong. Hapus akses app di https://myaccount.google.com/permissions lalu ulangi.'
    )
  }
  process.exit(0)
}

function ask(question) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout })
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close()
      resolve(answer)
    })
  })
}

function extractCode(input) {
  const s = (input || '').trim()
  if (!s) return ''
  try {
    if (s.includes('code=')) {
      const u = new URL(s.includes('://') ? s : `http://localhost/?${s.replace(/^\?/, '')}`)
      return u.searchParams.get('code') || ''
    }
  } catch {
    /* plain code */
  }
  return s
}

console.log('\n========== CEK REDIRECT URI ==========')
console.log('Client ID (harus sama di Console):')
console.log(`  ${clientId}`)
console.log('Redirect URI yang HARUS ada di Authorized redirect URIs:')
console.log(`  ${REDIRECT_URI}`)
console.log('')
console.log('Langkah Console:')
console.log('  1. Buka https://console.cloud.google.com/apis/credentials')
console.log('  2. Klik OAuth 2.0 Client yang Client ID-nya di atas (klik namanya)')
console.log('  3. Di bagian "Authorized redirect URIs" (BUKAN JavaScript origins)')
console.log('     → Add URI → tempel URI di atas → Save')
console.log('  4. Tunggu 30–60 detik, lalu lanjut di sini')
console.log('======================================\n')

const manual = process.argv.includes('--manual')

if (manual) {
  console.log('Mode manual: buka URL di bawah, izinkan akses.')
  console.log('Setelah redirect (atau kalau halaman error tapi URL bar ada ?code=...),')
  console.log('salin SELURUH URL dari address bar, atau hanya nilai code-nya.\n')
  console.log(authUrl + '\n')
  const open =
    process.platform === 'darwin'
      ? `open "${authUrl}"`
      : process.platform === 'win32'
        ? `start "" "${authUrl}"`
        : `xdg-open "${authUrl}"`
  exec(open, () => {})

  const pasted = await ask('Tempel URL atau code di sini lalu Enter:\n> ')
  const code = extractCode(pasted)
  if (!code) {
    console.error('Code tidak ditemukan.')
    process.exit(1)
  }
  console.log('Menukar code...')
  const tokens = await exchangeCode(code)
  finish(tokens)
} else {
  const redirectUrl = new URL(REDIRECT_URI)
  const listenHost = redirectUrl.hostname === '127.0.0.1' ? '127.0.0.1' : undefined
  const listenPort = Number(redirectUrl.port) || PORT
  const expectedPath = redirectUrl.pathname || '/'

  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, `http://localhost:${listenPort}`)
      const pathOk =
        url.pathname === expectedPath ||
        (expectedPath === '/oauth2callback' && url.pathname === '/oauth2callback/') ||
        (expectedPath === '/' && (url.pathname === '/' || url.pathname === ''))

      if (!pathOk && url.pathname !== '/oauth2callback') {
        res.writeHead(404)
        res.end(`Not found. Expected path: ${expectedPath}`)
        return
      }

      const err = url.searchParams.get('error')
      if (err) {
        res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' })
        res.end(`<h1>Gagal: ${err}</h1><p>${url.searchParams.get('error_description') || ''}</p>`)
        console.error('OAuth error:', err, url.searchParams.get('error_description'))
        server.close()
        process.exit(1)
      }

      const code = url.searchParams.get('code')
      if (!code) {
        res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' })
        res.end('<h1>Code tidak ada di URL</h1>')
        return
      }

      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
      res.write('<h1>Memproses...</h1><p>Lihat terminal.</p>')

      console.log('\nCode diterima. Menukar ke refresh token...')
      const tokens = await exchangeCode(code)
      res.end('<h1>Berhasil</h1><p>Lihat terminal. Tutup tab ini.</p>')
      server.close()
      finish(tokens)
    } catch (e) {
      console.error(e)
      try {
        res.end(`<h1>Error</h1><pre>${e.message}</pre>`)
      } catch {
        /* ignore */
      }
      server.close()
      process.exit(1)
    }
  })

  server.listen(listenPort, listenHost, () => {
    console.log(`Server callback: ${REDIRECT_URI}`)
    console.log('Login URL:\n')
    console.log(authUrl + '\n')
    console.log('Kalau Google masih bilang URI belum terdaftar:')
    console.log('  → URI belum Save di client yang benar, atau salah kolom (origins vs redirect).')
    console.log('  → Setelah Save, tunggu 1 menit lalu Ctrl+C dan jalankan ulang.')
    console.log('  → Atau: npm run auth:google -- --manual\n')
    const open =
      process.platform === 'darwin'
        ? `open "${authUrl}"`
        : process.platform === 'win32'
          ? `start "" "${authUrl}"`
          : `xdg-open "${authUrl}"`
    exec(open, () => {})
  })
}
