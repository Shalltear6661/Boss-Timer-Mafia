import { sendPushToMany, getVapidKeys } from '../server/push.js'
import { getSessionFromRequest, isEditorEmail } from '../server/session.js'

function readBody(req) {
  return new Promise(async (resolve) => {
    try {
      if (req.body && typeof req.body === 'object' && !Buffer.isBuffer(req.body)) {
        resolve(req.body)
        return
      }
      if (typeof req.body === 'string') {
        resolve(req.body ? JSON.parse(req.body) : {})
        return
      }
      const chunks = []
      for await (const chunk of req) chunks.push(chunk)
      const raw = Buffer.concat(chunks).toString('utf8')
      resolve(raw ? JSON.parse(raw) : {})
    } catch {
      resolve({})
    }
  })
}

/**
 * POST /api/push-notify
 * Body: { title, body, tag?, subscriptions?: PushSubscriptionJSON[] }
 *
 * Kirim push ke daftar subscription yang dikirim client.
 * Jika subscriptions kosong, hanya validasi VAPID (tanpa kirim).
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
      res.end(JSON.stringify({ error: 'Login dulu untuk kirim notifikasi' }))
      return
    }

    const body = await readBody(req)
    const { title, body: text, tag, subscriptions } = body
    if (!title || !text) {
      res.statusCode = 400
      res.end(JSON.stringify({ error: 'Field title dan body wajib' }))
      return
    }

    const vapidKeys = getVapidKeys(process.env)
    if (!vapidKeys.publicKey || !vapidKeys.privateKey) {
      res.statusCode = 500
      res.end(
        JSON.stringify({
          error: 'VAPID keys belum di-set di environment',
          hint: 'Set VAPID_PUBLIC_KEY dan VAPID_PRIVATE_KEY',
        })
      )
      return
    }

    const list = Array.isArray(subscriptions) ? subscriptions : []
    const payload = {
      title,
      body: text,
      tag: tag || 'boss-timer',
      vibrate: [300, 100, 300, 100, 500],
    }

    const result = await sendPushToMany(list, payload, process.env)

    res.statusCode = 200
    res.end(JSON.stringify({ ok: true, ...result }))
  } catch (e) {
    console.error('[api/push-notify]', e?.message || e)
    res.statusCode = 500
    res.end(JSON.stringify({ error: e.message || 'Gagal kirim notifikasi' }))
  }
}