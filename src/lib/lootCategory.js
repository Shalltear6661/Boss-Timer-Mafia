/** Urutan tampilan accordion loot */
export const LOOT_CATEGORIES = [
  { id: 'ability', label: 'Ability' },
  { id: 'weapon', label: 'Weapon' },
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
 * Weapon: Knuckles, Scythe, Sword and Shield, Battle Staff,
 * Battle Shield, Greatsword, Staff, Dual Daggers, Bow, Crossbow
 */
const WEAPON_RE =
  /\b(sword\s+and\s+shield|dual\s+daggers?|battle\s+staff|battle\s+shield|great\s*swords?|knuckles?|scythes?|crossbows?|staffs?|bows?)\b/i

/**
 * Klasifikasi nama loot → kategori (ability, weapon, cloak, …).
 * @param {string} name
 * @returns {{ id: string, label: string }}
 */
export function categorizeLoot(name) {
  const n = String(name || '').trim()
  if (/^ability\b/i.test(n) || /\bability\s*:/i.test(n)) {
    return { id: 'ability', label: 'Ability' }
  }
  if (WEAPON_RE.test(n)) return { id: 'weapon', label: 'Weapon' }
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
