/**
 * Uji kredensial Service Account (tanpa cetak secret).
 * Usage: node scripts/sa-test.mjs
 */
import { readFileSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { getAccessToken } from '../server/googleAuth.js'

function loadEnvFile() {
  const p = resolve(process.cwd(), '.env')
  if (!existsSync(p)) return {}
  const out = {}
  for (const line of readFileSync(p, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/)
    if (!m) continue
    let v = m[2].trim()
    if (
      (v.startsWith('"') && v.endsWith('"')) ||
      (v.startsWith("'") && v.endsWith("'"))
    ) {
      v = v.slice(1, -1)
    }
    v = v.replace(/\\n/g, '\n')
    out[m[1]] = v
  }
  return out
}

const env = { ...loadEnvFile(), ...process.env }

try {
  const token = await getAccessToken(env)
  console.log('OK: Service Account dapat access token (' + token.length + ' chars)')

  const id = env.GOOGLE_SHEETS_ID
  const sheet = env.GOOGLE_SHEETS_NAME || 'BOSS Timer'
  if (!id) {
    console.log('Skip baca sheet: GOOGLE_SHEETS_ID kosong')
    process.exit(0)
  }
  const range = encodeURIComponent(`'${sheet}'!A2:A2`)
  const res = await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${id}/values/${range}`,
    { headers: { Authorization: `Bearer ${token}` } }
  )
  const data = await res.json().catch(() => ({}))
  if (!res.ok) {
    console.error('Gagal baca sheet:', data.error?.message || res.status)
    console.error('Pastikan spreadsheet di-share ke email SA sebagai Editor.')
    process.exit(1)
  }
  console.log('OK: Bisa baca spreadsheet. Cell A2 =', JSON.stringify((data.values || [])[0]?.[0] || ''))
  console.log('Siap untuk Tandai Mati.')
} catch (e) {
  console.error('GAGAL:', e.message)
  if (e.code) console.error('code:', e.code)
  process.exit(1)
}
