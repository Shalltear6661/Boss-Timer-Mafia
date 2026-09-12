import { fetchSheetValues, getAllSheetConfigs } from './sheets.js'

const LOOT_SHEET = 'Loot'
const LOOT_RANGE = 'A1:Z200'

/** Urutan tampilan accordion */
export const LOOT_CATEGORIES = [
  { id: 'ability', label: 'Ability' },
  { id: 'cloak', label: 'Cloak' },
  { id: 'ring', label: 'Ring' },
  { id: 'earrings', label: 'Earrings' },
  { id: 'bracelet', label: 'Bracelet' },
  { id: 'belt', label: 'Belt' },
  { id: 'armor', label: 'Armor' },
  { id: 'saddle', label: 'Saddle' },
  { id: 'other', label: 'Lain-lain' },
]

/**
 * Klasifikasi nama loot → kategori (ability, cloak, ring, …).
 * @param {string} name
 */
export function categorizeLoot(name) {
  const n = String(name || '').trim()
  if (/^ability\b/i.test(n) || /\bability\s*:/i.test(n)) {
    return { id: 'ability', label: 'Ability' }
  }
  if (/\bcloak\b/i.test(n)) return { id: 'cloak', label: 'Cloak' }
  if (/\bring\b/i.test(n)) return { id: 'ring', label: 'Ring' }
  if (/\bearrings?\b/i.test(n)) return { id: 'earrings', label: 'Earrings' }
  if (/\bbracelet\b/i.test(n)) return { id: 'bracelet', label: 'Bracelet' }
  if (/\bbelt\b/i.test(n)) return { id: 'belt', label: 'Belt' }
  if (/\b(armor|pants|gauntlets?|gloves?|helmet|boots?)\b/i.test(n)) {
    return { id: 'armor', label: 'Armor' }
  }
  if (/\bsaddle\b/i.test(n)) return { id: 'saddle', label: 'Saddle' }
  return { id: 'other', label: 'Lain-lain' }
}

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
    .map((item) => {
      const cat = categorizeLoot(item.name)
      return {
        id: `${item.turn}-${item.name}-${item.holder || 'none'}`
          .toLowerCase()
          .replace(/\s+/g, '-')
          .replace(/[^a-z0-9\-]+/g, ''),
        name: item.name,
        turn: item.turn,
        holder: item.holder,
        qty: item.qty,
        category: cat.id,
        categoryLabel: cat.label,
      }
    })
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

  const order = new Map(LOOT_CATEGORIES.map((c, i) => [c.id, i]))
  items.sort((a, b) => {
    const byCat = (order.get(a.category) ?? 99) - (order.get(b.category) ?? 99)
    if (byCat !== 0) return byCat
    const byName = a.name.localeCompare(b.name, 'en', { sensitivity: 'base' })
    if (byName !== 0) return byName
    return a.turn.localeCompare(b.turn)
  })

  return { items, errors }
}
