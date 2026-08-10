/**
 * Vercel Serverless Function
 * GET /api/sheets?range=A2:D
 *
 * Baca env lewat bracket notation supaya bundler tidak meng-inline
 * process.env.GOOGLE_SHEETS_API_KEY menjadi undefined saat build.
 */

function getConfig() {
  const env = process.env
  return {
    // Bracket notation = hindari inlining kosong saat build Vercel
    apiKey: env['GOOGLE_SHEETS_API_KEY'] || env['GOOGLE_API_KEY'] || '',
    spreadsheetId: env['GOOGLE_SHEETS_ID'] || '1WL21q_xEAqmt6TQ15zvobC-Ui5vEUxvjMIKDf_1o3Q8',
    sheetName: env['GOOGLE_SHEETS_NAME'] || 'BOSS Timer',
  }
}

async function fetchSheetValues(range) {
  const { apiKey, spreadsheetId, sheetName } = getConfig()

  if (!apiKey) {
    const err = new Error('GOOGLE_SHEETS_API_KEY belum di-set di environment')
    err.code = 'MISSING_ENV'
    throw err
  }
  if (!range || !/^[A-Z0-9:]+$/i.test(range)) {
    throw new Error('Range tidak valid')
  }

  const safeSheet = String(sheetName).replace(/'/g, "''")
  const a1 = `'${safeSheet}'!${range}`
  const url =
    `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}` +
    `/values/${encodeURIComponent(a1)}?key=${encodeURIComponent(apiKey)}`

  const res = await fetch(url)
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`Google Sheets error ${res.status}: ${text.slice(0, 200)}`)
  }
  const data = await res.json()
  return data.values || []
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 's-maxage=30, stale-while-revalidate=60')
  res.setHeader('Content-Type', 'application/json')

  if (req.method !== 'GET') {
    res.statusCode = 405
    res.end(JSON.stringify({ error: 'Method not allowed' }))
    return
  }

  try {
    // Vercel menyediakan req.query; fallback ke URL parsing
    const range =
      (req.query && req.query.range) ||
      new URL(req.url || '/', 'http://localhost').searchParams.get('range')

    if (!range) {
      res.statusCode = 400
      res.end(JSON.stringify({ error: 'Query range wajib, contoh: ?range=A2:D' }))
      return
    }

    const values = await fetchSheetValues(String(range))
    res.statusCode = 200
    res.end(JSON.stringify({ values }))
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
