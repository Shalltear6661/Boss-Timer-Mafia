/**
 * GET /api/loots — barang belum terjual dari sheet Loot (MAFIA + MAFIAx2 digabung)
 */
import { loadUnsoldLoots } from '../server/loot.js'

export default async function handler(req, res) {
  res.setHeader('Content-Type', 'application/json')
  res.setHeader('Cache-Control', 's-maxage=30, stale-while-revalidate=60')

  if (req.method !== 'GET') {
    res.statusCode = 405
    res.end(JSON.stringify({ error: 'Method not allowed' }))
    return
  }

  try {
    const { items, errors } = await loadUnsoldLoots(process.env)
    res.statusCode = 200
    res.end(
      JSON.stringify({
        items,
        count: items.length,
        errors: errors.length ? errors : undefined,
      })
    )
  } catch (e) {
    console.error('[api/loots]', e?.message || e)
    res.statusCode = 500
    res.end(JSON.stringify({ error: e?.message || 'Gagal load loot' }))
  }
}
