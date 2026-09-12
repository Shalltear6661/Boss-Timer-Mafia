import { fetchSheetValues, getAllSheetConfigs } from './sheets.js'

const LOOT_SHEET = 'Loot'
const LOOT_RANGE = 'A1:Z200'

/**
 * Parse kolom "Belum Terjual" dari sheet Loot.
 * MAFIA: No | Belum Terjual | Holder
 * MAFIAx2: No | Belum Terjual
 */
export function parseUnsoldLoot(values, turn) {
  const rows = values || []
  let headerRow = -1
  let nameCol = -1
  let holderCol = -1

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i] || []
    for (let c = 0; c < row.length; c++) {
      const cell = String(row[c] || '')
        .trim()
        .toLowerCase()
      if (cell === 'belum terjual') {
        headerRow = i
        nameCol = c
        for (let c2 = c + 1; c2 <= Math.min(c + 2, row.length - 1); c2++) {
          if (/^holder$/i.test(String(row[c2] || '').trim())) {
            holderCol = c2
            break
          }
        }
        break
      }
    }
    if (headerRow >= 0) break
  }

  if (headerRow < 0 || nameCol < 0) return []

  /** @type {Map<string, { name: string, turn: string, holder: string, qty: number }>} */
  const grouped = new Map()

  for (let i = headerRow + 1; i < rows.length; i++) {
    const name = String(rows[i]?.[nameCol] || '').trim()
    if (!name) continue
    const holder = holderCol >= 0 ? String(rows[i]?.[holderCol] || '').trim() : ''
    const key = `${turn}|${name.toLowerCase()}|${holder.toLowerCase()}`
    const existing = grouped.get(key)
    if (existing) {
      existing.qty += 1
    } else {
      grouped.set(key, { name, turn, holder, qty: 1 })
    }
  }

  return [...grouped.values()]
    .map((item) => ({
      id: `${item.turn}-${item.name}-${item.holder || 'none'}`
        .toLowerCase()
        .replace(/\s+/g, '-')
        .replace(/[^a-z0-9\-]+/g, ''),
      name: item.name,
      turn: item.turn,
      holder: item.holder,
      qty: item.qty,
    }))
    .sort((a, b) => a.name.localeCompare(b.name, 'en', { sensitivity: 'base' }))
}

/** Ambil loot belum terjual dari semua spreadsheet (satu list digabung) */
export async function loadUnsoldLoots(env = process.env) {
  const configs = getAllSheetConfigs(env)
  const results = await Promise.allSettled(
    configs.map(async (config) => {
      const values = await fetchSheetValues(LOOT_RANGE, config.turn, env, {
        sheetName: LOOT_SHEET,
      })
      return parseUnsoldLoot(values, config.turn)
    })
  )

  const items = []
  const errors = []
  for (let i = 0; i < results.length; i++) {
    const r = results[i]
    if (r.status === 'fulfilled') items.push(...r.value)
    else errors.push(`${configs[i].turn}: ${r.reason?.message || r.reason}`)
  }

  items.sort((a, b) => {
    const byName = a.name.localeCompare(b.name, 'en', { sensitivity: 'base' })
    if (byName !== 0) return byName
    return a.turn.localeCompare(b.turn)
  })

  return { items, errors }
}
