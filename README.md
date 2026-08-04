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

### 1. Baca spreadsheet (API Key)

1. Enable **Google Sheets API**
2. Buat **API Key** → isi `GOOGLE_SHEETS_API_KEY`
3. Pastikan `GOOGLE_SHEETS_ID` / `GOOGLE_SHEETS_NAME` benar

### 2. Tulis spreadsheet (Service Account) — untuk Tandai Mati

1. Google Cloud → **IAM & Admin** → **Service Accounts** → **Create**
2. Buka SA → **Keys** → **Add key** → **JSON** → download
3. Buka spreadsheet → **Share** → tempel `client_email` dari JSON sebagai **Editor**
4. Isi di `.env` (pilih salah satu):
   - `GOOGLE_SERVICE_ACCOUNT_EMAIL` + `GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY`  
     (di private key, ganti newline jadi `\n` dalam satu baris), **atau**
   - `GOOGLE_SERVICE_ACCOUNT_JSON` = seluruh isi file JSON (satu baris)

Tidak perlu `npm run auth:google`.

### 3. Login Google (role Editor / view-only)

1. Buat OAuth Client **Web application**
   - Authorized JavaScript origins: `http://localhost:5173`, `https://YOUR.vercel.app`
2. Isi `GOOGLE_OAUTH_CLIENT_ID` (+ secret opsional untuk server)
3. Consent screen → **Test users** → email yang akan login
4. Set `EDITOR_EMAILS=emailanda@gmail.com`

### 4. Jalankan

```bash
npm run dev
```

### 5. Vercel env

Wajib:

- `GOOGLE_SHEETS_API_KEY`, `GOOGLE_SHEETS_ID`, `GOOGLE_SHEETS_NAME`
- `GOOGLE_SERVICE_ACCOUNT_EMAIL` + `GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY` (atau `GOOGLE_SERVICE_ACCOUNT_JSON`)
- `GOOGLE_OAUTH_CLIENT_ID`
- `EDITOR_EMAILS`, `SESSION_SECRET`

Lalu **Redeploy**.
