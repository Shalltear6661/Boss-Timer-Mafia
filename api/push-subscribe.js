import { getVapidKeys } from '../server/push.js'
import { upsertPushSubscription, removePushSubscription } from '../server/pushStore.js'
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

/**
 * POST /api/push-subscribe — simpan subscription ke sheet PushSubs
 * DELETE /api/push-subscribe — hapus subscription
 * Tidak wajib login (semua user boleh terima push).
 */
export default async function handler(req, res) {
  res.setHeader('Content-Type', 'application/json')

  try {
    const { publicKey } = getVapidKeys(process.env)
    if (!publicKey) {
      res.statusCode = 500
      res.end(JSON.stringify({ error: 'VAPID keys belum di-set' }))
      return
    }

    if (req.method === 'GET') {
      res.statusCode = 200
      res.end(JSON.stringify({ vapidPublicKey: publicKey }))
      return
    }

    const body = await readBody(req)
    const subscription = body.subscription
    const session = getSessionFromRequest(req, process.env)
    const email = session?.email || body.email || ''

    if (req.method === 'DELETE' || body.action === 'unsubscribe') {
      if (!subscription?.endpoint) {
        res.statusCode = 400
        res.end(JSON.stringify({ error: 'endpoint wajib' }))
        return
      }
      const result = await removePushSubscription(subscription.endpoint, process.env)
      res.statusCode = 200
      res.end(JSON.stringify({ ok: true, ...result }))
      return
    }

    if (req.method !== 'POST') {
      res.statusCode = 405
      res.end(JSON.stringify({ error: 'Method not allowed' }))
      return
    }

    if (!subscription?.endpoint || !subscription?.keys?.p256dh || !subscription?.keys?.auth) {
      res.statusCode = 400
      res.end(JSON.stringify({ error: 'Subscription tidak lengkap' }))
      return
    }

    const result = await upsertPushSubscription(subscription, email, process.env)
    res.statusCode = 200
    res.end(JSON.stringify({ ok: true, vapidPublicKey: publicKey, ...result }))
  } catch (e) {
    console.error('[api/push-subscribe]', e?.message || e)
    res.statusCode = 500
    res.end(JSON.stringify({ error: e.message || 'Gagal subscribe' }))
  }
}
