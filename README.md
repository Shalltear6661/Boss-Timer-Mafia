# Boss Timer

Timer respawn boss. Semua orang bisa **lihat**. Hanya email **Editor** yang bisa **Tandai Mati**.

## Role

| Status | Bisa lihat | Tandai Mati |
|--------|------------|------------|
| Tanpa login | Ya | Tidak |
| Login, email di `EDITOR_EMAILS` | Ya | Ya |
| Login, email lain | Ya | Tidak (view-only) |

## Setup

```bash
cp .env.example .env
npm install
```

### 1. Google Cloud

1. Enable **Google Sheets API**
2. Buat OAuth Client **Web application**
   - Authorized JavaScript origins: `http://localhost:5173`, `https://YOUR.vercel.app`
3. Isi `GOOGLE_OAUTH_CLIENT_ID` (+ secret) di `.env`
4. Consent screen → tambah Test users (email yang akan login)
5. Jalankan `npm run auth:google` **sekali** (login sebagai pemilik sheet) → dapat `GOOGLE_OAUTH_REFRESH_TOKEN` untuk menulis ke spreadsheet
6. Set `EDITOR_EMAILS=emailanda@gmail.com,editor2@gmail.com`

### 2. Jalankan

```bash
npm run dev
```

### 3. Vercel env

`GOOGLE_SHEETS_API_KEY`, `GOOGLE_SHEETS_ID`, `GOOGLE_OAUTH_CLIENT_ID`, `GOOGLE_OAUTH_CLIENT_SECRET`, `GOOGLE_OAUTH_REFRESH_TOKEN`, `EDITOR_EMAILS`, `SESSION_SECRET` → lalu Redeploy.
