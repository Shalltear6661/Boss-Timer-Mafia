import { getMaintenanceMode } from '../server/sheets.js'
import { setMaintenanceMode } from '../server/sheetsWrite.js'
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
 * GET  /api/maintenance → baca status
 * POST /api/maintenance → toggle (editor only)
 */
export default async function handler(req, res) {
  res.setHeader('Content-Type', 'application/json')

  if (req.method === 'GET') {
    try {
      const result = await getMaintenanceMode(process.env)
      res.statusCode = 200
      res.end(JSON.stringify(result))
    } catch (e) {
      console.error('[api/maintenance]', e?.message || e)
      res.statusCode = 500
      res.end(JSON.stringify({ error: e.message || 'Gagal baca maintenance', maintenance: false }))
    }
    return
  }

  if (req.method === 'POST') {
    try {
      const session = getSessionFromRequest(req, process.env)
      if (!session?.email) {
        res.statusCode = 401
        res.end(JSON.stringify({ error: 'Login dulu' }))
        return
      }
      if (!isEditorEmail(session.email, process.env)) {
        res.statusCode = 403
        res.end(JSON.stringify({ error: 'Hanya Editor yang bisa toggle maintenance' }))
        return
      }

      const body = await readBody(req)
      const active = body.active === true
      const result = await setMaintenanceMode(active, process.env)
      res.statusCode = 200
      res.end(JSON.stringify({ ...result, toggledBy: session.email }))
    } catch (e) {
      console.error('[api/maintenance]', e?.message || e)
      res.statusCode = 500
      res.end(JSON.stringify({ error: e.message || 'Gagal set maintenance' }))
    }
    return
  }

  res.statusCode = 405
  res.end(JSON.stringify({ error: 'Method not allowed' }))
}