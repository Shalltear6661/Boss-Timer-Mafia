# Boss Timer

Timer respawn boss (Svelte + Vite). Data dari Google Spreadsheet, view-only.

## Cara jalankan (local)

1. Copy env:
   ```bash
   cp .env.example .env
   ```
2. Isi `GOOGLE_SHEETS_API_KEY` di `.env`
3. Jalankan:
   ```bash
   npm install
   npm run dev
   ```
4. Buka http://localhost:5173

Browser hanya memanggil `/api/sheets?range=...` — **API key tidak muncul di Network tab**.

## Deploy production (Vercel) — supaya key tetap tersembunyi

Hosting static biasa (GitHub Pages, dll.) **tidak cukup**, karena butuh serverless proxy.

1. Push repo ke GitHub
2. Import project di [Vercel](https://vercel.com)
3. Di **Settings → Environment Variables**, tambahkan:
   - `GOOGLE_SHEETS_API_KEY`
   - `GOOGLE_SHEETS_ID`
   - `GOOGLE_SHEETS_NAME` (opsional, default `BOSS Timer`)
4. Deploy

Endpoint production: `https://your-app.vercel.app/api/sheets?range=A2:D`  
(server yang memanggil Google; key tidak ikut ke browser)

### Penting soal keamanan API key

- Key yang pernah ada di frontend / chat **sebaiknya di-rotate** di Google Cloud Console
- Restrict key ke **Google Sheets API** saja
- Setelah pakai proxy, batasi juga jika memungkinkan

## Fitur

- Sync data dari spreadsheet (auto tiap 1 menit)
- Hero card sticky untuk boss ≤10 menit / spawn
- Notifikasi browser + suara di 10 menit, 5 menit, dan spawn
- View-only (update waktu kematian di spreadsheet)
