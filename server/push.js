import webpush from 'web-push'

const MISSING_VAPID = () =>
  new Error('VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY belum di-set di environment')

export function getVapidKeys(env = process.env) {
  const publicKey = env['VAPID_PUBLIC_KEY'] || ''
  const privateKey = env['VAPID_PRIVATE_KEY'] || ''
  const contact = env['VAPID_CONTACT_EMAIL'] || 'mailto:admin@example.com'
  return { publicKey, privateKey, contact }
}

export function ensureVapidConfigured(env = process.env) {
  const { publicKey, privateKey, contact } = getVapidKeys(env)
  if (!publicKey || !privateKey) throw MISSING_VAPID()
  webpush.setVapidDetails(contact, publicKey, privateKey)
}

/**
 * Kirim satu push notification ke satu subscription.
 */
export async function sendPushToSubscription(subscription, payload, env = process.env) {
  if (!subscription?.endpoint) throw new Error('Subscription tidak valid')
  ensureVapidConfigured(env)
  await webpush.sendNotification(subscription, JSON.stringify(payload))
}

/**
 * Kirim push ke daftar subscription.
 * @returns {Promise<{ok: number, failed: number, expiredEndpoints: string[]}>}
 */
export async function sendPushToMany(subscriptions, payload, env = process.env) {
  ensureVapidConfigured(env)
  let ok = 0
  let failed = 0
  const expiredEndpoints = []

  await Promise.all(
    (subscriptions || []).map(async (sub) => {
      try {
        await webpush.sendNotification(sub, JSON.stringify(payload))
        ok += 1
      } catch (e) {
        failed += 1
        const status = e?.statusCode || e?.status
        if (status === 404 || status === 410) {
          expiredEndpoints.push(sub.endpoint)
        }
      }
    })
  )

  return { ok, failed, expiredEndpoints }
}
