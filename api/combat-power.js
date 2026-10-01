/**
 * POST /api/combat-power
 * Body JSON: { guild, ingameName, combatPower, screenshotBase64, screenshotMime }
 */
import { upsertCombatPower } from '../server/combatPower.js'
import { getSessionFromRequest } from '../server/session.js'

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

export default async function handler(req, res) {
  res.setHeader('Content-Type', 'application/json')
  res.setHeader('Cache-Control', 'no-store')

  if (req.method !== 'POST') {
    res.statusCode = 405
    res.end(JSON.stringify({ error: 'Method not allowed' }))
    return
  }

  try {
    const body = await readBody(req)
    const session = getSessionFromRequest(req, process.env)
    const result = await upsertCombatPower(
      {
        guild: body.guild,
        ingameName: body.ingameName,
        combatPower: body.combatPower,
        screenshotBase64: body.screenshotBase64,
        screenshotMime: body.screenshotMime,
        submittedBy: session?.email || body.email || '',
      },
      process.env
    )
    res.statusCode = 200
    res.end(JSON.stringify({ ok: true, ...result }))
  } catch (e) {
    console.error('[api/combat-power]', e?.message || e)
    res.statusCode = 400
    res.end(JSON.stringify({ error: e.message || 'Gagal simpan combat power' }))
  }
}
