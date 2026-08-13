import { getVapidKeys } from '../server/push.js'

/**
 * GET /api/push-vapid — public key saja (aman dibuka tanpa login)
 */
export default async function handler(req, res) {
  res.setHeader('Content-Type', 'application/json')
  res.setHeader('Cache-Control', 'no-store')

  if (req.method !== 'GET') {
    res.statusCode = 405
    res.end(JSON.stringify({ error: 'Method not allowed' }))
    return
  }

  const { publicKey } = getVapidKeys(process.env)
  if (!publicKey) {
    res.statusCode = 500
    res.end(
      JSON.stringify({
        error: 'VAPID_PUBLIC_KEY belum di-set',
        hint: 'Jalankan: node scripts/generate-vapid.mjs lalu isi .env / Vercel',
      })
    )
    return
  }

  res.statusCode = 200
  res.end(JSON.stringify({ vapidPublicKey: publicKey }))
}
