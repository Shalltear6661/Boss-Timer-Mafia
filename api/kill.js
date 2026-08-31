import { markBossKilledOnSheet } from '../server/sheetsWrite.js'
import { getSessionFromRequest, isEditorEmail } from '../server/session.js'

async function readBody(req) {
  if (req.body && typeof req.body === 'object' && !Buffer.isBuffer(req.body)) {
    return req.body
  }
  if (typeof req.body === 'string') {
    return req.body ? JSON.parse(req.body) : {}
  }
  const chunks = []
  for await (const chunk of req) chunks.push(chunk)
  const raw = Buffer.concat(chunks).toString('utf8')
  return raw ? JSON.parse(raw) : {}
}

/**
 * POST /api/kill — hanya email di EDITOR_EMAILS
 */
export default async function handler(req, res) {
  res.setHeader('Content-Type', 'application/json')

  if (req.method !== 'POST') {
    res.statusCode = 405
    res.end(JSON.stringify({ error: 'Method not allowed' }))
    return
  }

  try {
    const session = getSessionFromRequest(req, process.env)
    if (!session?.email) {
      res.statusCode = 401
      res.end(JSON.stringify({ error: 'Login dulu untuk menandai mati' }))
      return
    }
    if (!isEditorEmail(session.email, process.env)) {
      res.statusCode = 403
      res.end(JSON.stringify({ error: 'Akun Anda view-only. Hanya Editor yang bisa Tandai Mati.' }))
      return
    }

    const body = await readBody(req)
    const name = body.name || body.bossName
    if (!name) {
      res.statusCode = 400
      res.end(JSON.stringify({ error: 'Field name wajib' }))
      return
    }
    const deathISO = body.deathTime || body.deathDate || null
    const deathDate = deathISO ? new Date(deathISO) : new Date()
    const turn = body.turn || ''

    const result = await markBossKilledOnSheet(String(name), process.env, deathDate, String(turn))
    res.statusCode = 200
    res.end(JSON.stringify({ ok: true, ...result, by: session.email }))
  } catch (e) {
    console.error('[api/kill]', e?.message || e)
    const setupFail = ['MISSING_WRITE_CREDS', 'MISSING_SA', 'SA_KEY_INVALID', 'SA_TOKEN_FAILED', 'MISSING_OAUTH', 'OAUTH_REFRESH_FAILED'].includes(
      e?.code
    )
    res.statusCode = setupFail ? 500 : 400
    res.end(
      JSON.stringify({
        error: e?.message || 'Gagal update spreadsheet',
        hint:
          e?.code === 'MISSING_WRITE_CREDS' || e?.code === 'MISSING_SA'
            ? 'Set Service Account di Vercel + share spreadsheet ke email SA (Editor)'
            : e?.code === 'SA_TOKEN_FAILED'
              ? 'Cek private key SA / pastikan Google Sheets API enabled'
              : undefined,
      })
    )
  }
}
