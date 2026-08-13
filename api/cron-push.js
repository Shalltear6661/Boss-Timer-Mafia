import { sendPushToMany } from '../server/push.js'
import { listPushSubscriptions, removePushSubscription } from '../server/pushStore.js'
import { loadWatchList, collectDueNotifications } from '../server/bossSchedule.js'

function authorized(req, env) {
  const secret = env.CRON_SECRET || ''
  if (!secret) return false
  const url = new URL(req.url || '/', 'http://localhost')
  const q = url.searchParams.get('secret') || ''
  const header = req.headers?.authorization || ''
  const bearer = header.startsWith('Bearer ') ? header.slice(7) : ''
  return q === secret || bearer === secret
}

/**
 * GET|POST /api/cron-push
 * Dipanggil cron eksternal (mis. cron-job.org) tiap menit.
 * Auth: ?secret=CRON_SECRET atau Authorization: Bearer CRON_SECRET
 */
export default async function handler(req, res) {
  res.setHeader('Content-Type', 'application/json')

  if (req.method !== 'GET' && req.method !== 'POST') {
    res.statusCode = 405
    res.end(JSON.stringify({ error: 'Method not allowed' }))
    return
  }

  try {
    if (!authorized(req, process.env)) {
      res.statusCode = 401
      res.end(JSON.stringify({ error: 'Unauthorized cron' }))
      return
    }

    const now = new Date()
    const items = await loadWatchList(process.env, now)
    const due = collectDueNotifications(items)

    if (due.length === 0) {
      res.statusCode = 200
      res.end(JSON.stringify({ ok: true, due: 0, sent: 0, skipped: 'no milestones' }))
      return
    }

    const subs = await listPushSubscriptions(process.env)
    if (subs.length === 0) {
      res.statusCode = 200
      res.end(JSON.stringify({ ok: true, due: due.length, sent: 0, skipped: 'no subscribers' }))
      return
    }

    let totalOk = 0
    let totalFail = 0
    const sent = []

    for (const payload of due) {
      const result = await sendPushToMany(subs, payload, process.env)
      totalOk += result.ok
      totalFail += result.failed
      sent.push({ tag: payload.tag, title: payload.title, ...result })

      // Hapus subscription expired (410/404)
      for (const ep of result.expiredEndpoints || []) {
        try {
          await removePushSubscription(ep, process.env)
        } catch (e) {
          console.warn('[cron-push] gagal hapus sub expired', e?.message)
        }
      }
    }

    res.statusCode = 200
    res.end(
      JSON.stringify({
        ok: true,
        due: due.length,
        subscribers: subs.length,
        totalOk,
        totalFail,
        sent,
        at: now.toISOString(),
      })
    )
  } catch (e) {
    console.error('[api/cron-push]', e?.message || e)
    res.statusCode = 500
    res.end(JSON.stringify({ error: e.message || 'Cron push gagal' }))
  }
}
