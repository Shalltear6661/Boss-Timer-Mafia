import { getAccessToken } from './googleAuth.js'
import { getSheetsConfig } from './sheets.js'

const PUSH_SHEET = 'PushSubs'
const HEADER = ['endpoint', 'p256dh', 'auth', 'email', 'updatedAt']

function sheetA1(range) {
  const safe = String(PUSH_SHEET).replace(/'/g, "''")
  return `'${safe}'!${range}`
}

async function sheetsFetch(url, accessToken, options = {}) {
  const res = await fetch(url, {
    ...options,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) {
    const err = new Error(data.error?.message || `Sheets error ${res.status}`)
    err.code = data.error?.status || res.status
    err.status = res.status
    throw err
  }
  return data
}

/** Pastikan sheet PushSubs ada + header di baris 1 */
export async function ensurePushSheet(env = process.env) {
  const { spreadsheetId } = getSheetsConfig(env)
  const accessToken = await getAccessToken(env)

  const metaUrl = `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}?fields=sheets.properties.title`
  const meta = await sheetsFetch(metaUrl, accessToken)
  const titles = (meta.sheets || []).map((s) => s.properties?.title)
  if (!titles.includes(PUSH_SHEET)) {
    const batchUrl = `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}:batchUpdate`
    await sheetsFetch(batchUrl, accessToken, {
      method: 'POST',
      body: JSON.stringify({
        requests: [{ addSheet: { properties: { title: PUSH_SHEET } } }],
      }),
    })
  }

  // Pastikan header
  const headerUrl =
    `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}` +
    `/values/${encodeURIComponent(sheetA1('A1:E1'))}?valueInputOption=RAW`
  await sheetsFetch(headerUrl, accessToken, {
    method: 'PUT',
    body: JSON.stringify({ values: [HEADER] }),
  })

  return { spreadsheetId, accessToken }
}

/**
 * @returns {Promise<Array<{endpoint: string, keys: {p256dh: string, auth: string}, email?: string, row: number}>>}
 */
export async function listPushSubscriptions(env = process.env) {
  const { spreadsheetId, accessToken } = await ensurePushSheet(env)
  const readUrl =
    `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}` +
    `/values/${encodeURIComponent(sheetA1('A2:E'))}`
  const data = await sheetsFetch(readUrl, accessToken)
  const rows = data.values || []
  const out = []
  for (let i = 0; i < rows.length; i++) {
    const [endpoint, p256dh, auth, email] = rows[i]
    if (!endpoint || !p256dh || !auth) continue
    out.push({
      endpoint: String(endpoint).trim(),
      keys: { p256dh: String(p256dh).trim(), auth: String(auth).trim() },
      email: (email || '').trim() || undefined,
      row: i + 2,
    })
  }
  return out
}

/** Upsert subscription by endpoint */
export async function upsertPushSubscription(subscription, email = '', env = process.env) {
  const endpoint = subscription?.endpoint
  const p256dh = subscription?.keys?.p256dh
  const auth = subscription?.keys?.auth
  if (!endpoint || !p256dh || !auth) throw new Error('Subscription tidak lengkap')

  const { spreadsheetId, accessToken } = await ensurePushSheet(env)
  const existing = await listPushSubscriptions(env)
  const found = existing.find((s) => s.endpoint === endpoint)
  const updatedAt = new Date().toISOString()
  const rowValues = [endpoint, p256dh, auth, email || '', updatedAt]

  if (found) {
    const writeUrl =
      `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}` +
      `/values/${encodeURIComponent(sheetA1(`A${found.row}:E${found.row}`))}?valueInputOption=RAW`
    await sheetsFetch(writeUrl, accessToken, {
      method: 'PUT',
      body: JSON.stringify({ values: [rowValues] }),
    })
    return { updated: true, row: found.row }
  }

  const appendUrl =
    `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}` +
    `/values/${encodeURIComponent(sheetA1('A:E'))}:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`
  await sheetsFetch(appendUrl, accessToken, {
    method: 'POST',
    body: JSON.stringify({ values: [rowValues] }),
  })
  return { created: true }
}

/** Hapus subscription by endpoint */
export async function removePushSubscription(endpoint, env = process.env) {
  if (!endpoint) return { removed: false }
  const { spreadsheetId, accessToken } = await ensurePushSheet(env)
  const existing = await listPushSubscriptions(env)
  const found = existing.find((s) => s.endpoint === endpoint)
  if (!found) return { removed: false }

  const batchUrl = `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}:batchUpdate`
  // Cari sheetId PushSubs
  const metaUrl = `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}?fields=sheets.properties`
  const meta = await sheetsFetch(metaUrl, accessToken)
  const sheet = (meta.sheets || []).find((s) => s.properties?.title === PUSH_SHEET)
  if (!sheet) return { removed: false }
  const sheetId = sheet.properties.sheetId

  await sheetsFetch(batchUrl, accessToken, {
    method: 'POST',
    body: JSON.stringify({
      requests: [
        {
          deleteDimension: {
            range: {
              sheetId,
              dimension: 'ROWS',
              startIndex: found.row - 1,
              endIndex: found.row,
            },
          },
        },
      ],
    }),
  })
  return { removed: true }
}
