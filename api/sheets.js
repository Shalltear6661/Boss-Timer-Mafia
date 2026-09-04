/**
 * Vercel Serverless Function
 * GET /api/sheets?range=A2:H&turn=MAFIA
 *
 * Multi-sheet: parameter ?turn=MAFIA / MAFIAx2 untuk routing ke sheet berbeda.
 * Jika turn tidak diisi, fallback ke config umum.
 */

import { fetchSheetValues } from '../server/sheets.js'

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate')
  res.setHeader('Content-Type', 'application/json')

  if (req.method !== 'GET') {
    res.statusCode = 405
    res.end(JSON.stringify({ error: 'Method not allowed' }))
    return
  }

  try {
    const range =
      (req.query && req.query.range) ||
      new URL(req.url || '/', 'http://localhost').searchParams.get('range')

    const turn =
      (req.query && req.query.turn) ||
      new URL(req.url || '/', 'http://localhost').searchParams.get('turn') ||
      ''

    if (!range) {
      res.statusCode = 400
      res.end(JSON.stringify({ error: 'Query range wajib, contoh: ?range=A2:D' }))
      return
    }

    const values = await fetchSheetValues(String(range), String(turn), process.env)
    res.statusCode = 200
    res.end(JSON.stringify({ values, turn: turn || 'default' }))
  } catch (e) {
    console.error('[api/sheets]', e?.message || e)
    res.statusCode = e?.code === 'MISSING_ENV' ? 500 : 500
    res.end(
      JSON.stringify({
        error: e?.message || 'Gagal fetch spreadsheet',
        hint:
          e?.code === 'MISSING_ENV'
            ? 'Vercel → Settings → Environment Variables → pastikan nama persis GOOGLE_SHEETS_API_KEY, centang Production (+ Preview), lalu Redeploy (Deployments → … → Redeploy).'
            : undefined,
      })
    )
  }
}
