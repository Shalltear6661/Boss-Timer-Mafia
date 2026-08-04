/**
 * Shared Google Sheets fetch — dipakai Vite (dev) & Vercel (production).
 * API key hanya hidup di server / env, tidak pernah dikirim ke browser.
 */

export function getSheetsConfig(env = process.env) {
  const apiKey = env.GOOGLE_SHEETS_API_KEY
  const spreadsheetId = env.GOOGLE_SHEETS_ID || '1WL21q_xEAqmt6TQ15zvobC-Ui5vEUxvjMIKDf_1o3Q8'
  const sheetName = env.GOOGLE_SHEETS_NAME || 'BOSS Timer'
  return { apiKey, spreadsheetId, sheetName }
}

/**
 * @param {string} range contoh: "A2:D"
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {Promise<string[][]>}
 */
export async function fetchSheetValues(range, env = process.env) {
  const { apiKey, spreadsheetId, sheetName } = getSheetsConfig(env)
  if (!apiKey) {
    throw new Error('GOOGLE_SHEETS_API_KEY belum di-set di environment')
  }
  if (!range || !/^[A-Z0-9:]+$/i.test(range)) {
    throw new Error('Range tidak valid')
  }

  const encodedSheet = encodeURIComponent(sheetName)
  const url =
    `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}` +
    `/values/'${encodedSheet}'!${range}?key=${apiKey}`

  const res = await fetch(url)
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`Google Sheets error ${res.status}: ${text.slice(0, 200)}`)
  }
  const data = await res.json()
  return data.values || []
}
