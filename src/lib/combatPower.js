/**
 * Client: submit update combat power.
 * Screenshot equip sementara dinonaktifkan.
 */

/** Kompres gambar → JPEG dataURL (maxWidth, quality) — siap dipakai lagi nanti */
export function compressImageFile(file, maxWidth = 1280, quality = 0.78) {
  return new Promise((resolve, reject) => {
    if (!file || !file.type?.startsWith('image/')) {
      reject(new Error('File harus berupa gambar'))
      return
    }
    const reader = new FileReader()
    reader.onerror = () => reject(new Error('Gagal baca file'))
    reader.onload = () => {
      const img = new Image()
      img.onerror = () => reject(new Error('Gambar tidak valid'))
      img.onload = () => {
        const scale = Math.min(1, maxWidth / img.width)
        const w = Math.max(1, Math.round(img.width * scale))
        const h = Math.max(1, Math.round(img.height * scale))
        const canvas = document.createElement('canvas')
        canvas.width = w
        canvas.height = h
        const ctx = canvas.getContext('2d')
        ctx.drawImage(img, 0, 0, w, h)
        const dataUrl = canvas.toDataURL('image/jpeg', quality)
        resolve({
          dataUrl,
          base64: dataUrl.replace(/^data:image\/jpeg;base64,/, ''),
          mime: 'image/jpeg',
          width: w,
          height: h,
        })
      }
      img.src = reader.result
    }
    reader.readAsDataURL(file)
  })
}

/**
 * @param {{ guild: string, ingameName: string, combatPower: number|string, screenshotFile?: File }} payload
 */
export async function submitCombatPower(payload) {
  const { guild, ingameName, combatPower /*, screenshotFile */ } = payload

  // --- Screenshot sementara dinonaktifkan ---
  // if (!screenshotFile) throw new Error('Screenshot equip wajib')
  // const compressed = await compressImageFile(screenshotFile)

  const res = await fetch('/api/combat-power', {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      guild,
      ingameName,
      combatPower,
      // screenshotBase64: compressed.base64,
      // screenshotMime: compressed.mime,
    }),
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data.error || `Gagal submit (${res.status})`)
  return data
}
