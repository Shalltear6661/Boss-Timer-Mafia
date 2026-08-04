import { fetchSheetValues } from '../server/sheets.js'

/**
 * Vercel Serverless Function
 * GET /api/sheets?range=A2:D
 * API key hanya ada di environment Vercel, tidak terlihat di browser.
 */
export default async function handler(req, res) {
  res.setHeader('Cache-Control', 's-maxage=30, stale-while-revalidate=60')

  if (req.method !== 'GET') {
    res.statusCode = 405
    res.setHeader('Content-Type', 'application/json')
    res.end(JSON.stringify({ error: 'Method not allowed' }))
    return
  }

  try {
    const url = new URL(req.url, 'http://localhost')
    const range = url.searchParams.get('range')
    if (!range) {
      res.statusCode = 400
      res.setHeader('Content-Type', 'application/json')
      res.end(JSON.stringify({ error: 'Query range wajib, contoh: ?range=A2:D' }))
      return
    }

    const values = await fetchSheetValues(range)
    res.statusCode = 200
    res.setHeader('Content-Type', 'application/json')
    res.end(JSON.stringify({ values }))
  } catch (e) {
    console.error('[api/sheets]', e)
    res.statusCode = 500
    res.setHeader('Content-Type', 'application/json')
    res.end(JSON.stringify({ error: e.message || 'Gagal fetch spreadsheet' }))
  }
}
