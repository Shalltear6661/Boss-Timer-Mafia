# Boss Timer (MVP)

Aplikasi timer boss respawn, dibuat dengan Svelte + Vite.

## Cara jalankan

```bash
npm install
npm run dev
```

Buka http://localhost:5173

## Build untuk produksi

```bash
npm run build
```

Hasil build ada di folder `dist/`, tinggal di-host di static hosting mana saja
(Netlify, Vercel, GitHub Pages, atau server sendiri).

## Tampilan

UI sudah didesain ulang jadi tema "panel HUD raid tracker": background gelap
dengan gradient ungu lembut, font Cinzel untuk judul/nama boss, dan
JetBrains Mono untuk angka countdown (biar mudah dibaca, tabular).

- **Kartu "Akan Spawn Sebentar Lagi"** muncul otomatis di paling atas kalau
  ada boss (field boss atau mingguan) yang tinggal <=15 menit lagi atau
  sudah waktunya spawn. Tiap kartu punya ring countdown melingkar (mirip
  cooldown skill di game) yang mengecil seiring waktu berkurang, kuning untuk
  "segera" dan merah berdenyut untuk "sudah waktunya".
- Semua boss ditampilkan sebagai card grid (bukan tabel lagi), responsif ke
  mobile.
- Warna aksen kartu berubah otomatis: netral -> kuning (segera) -> merah
  (sudah lewat waktu, khusus field boss).

## Fitur MVP

Ada 2 jenis boss, sesuai data di spreadsheet:

**1. Field Boss (interval)** — Venatus, Viorent, Ego, Livera, Lady Dalia,
Undomiel, Araneo, Baron. Next spawn dihitung dari `Time of Death + Spawn
Interval`.
- Tombol "Tandai Mati" untuk update waktu kematian ke waktu sekarang
  (otomatis hitung ulang next spawn).
- Tambah / hapus boss baru lewat form di bawah tabel.

**2. Boss Mingguan (jadwal tetap)** — Clemantis, Saphirus, Neutro, Thymele,
Milavy, Ringor, Roderick, Auraq, Chaiflock, Benji, Libitina, Rakajeth,
Tumier, Camalia. Next spawn dihitung dari hari & jam tetap tiap minggu
(beberapa boss punya 2 jadwal per minggu).

Fitur umum:
- Countdown real-time (update tiap detik) untuk semua boss.
- Otomatis diurutkan dari yang paling cepat spawn.
- Baris kuning = spawn dalam <= 15 menit. Baris merah + badge "UP" = sudah
  waktunya spawn (khusus field boss).
- Data disimpan otomatis di localStorage browser, jadi tidak hilang saat
  refresh.
- Tombol "Reset ke data spreadsheet" untuk kembali ke data awal dari
  spreadsheet.

## Data awal

- Field boss: `src/lib/bossData.js`
- Boss mingguan: `src/lib/weeklyBossData.js`

Untuk mengubah/menambah data awal, edit langsung file-file tersebut.

**Catatan zona waktu:** jam pada boss mingguan diasumsikan sama dengan
zona waktu browser yang menjalankan app (WIB). Kalau di-deploy/dibuka dari
device dengan zona waktu berbeda, hitungannya bisa geser.

## Ide pengembangan lanjut (belum ada di MVP ini)

- Sinkronisasi data antar device (backend/DB, bukan cuma localStorage)
- Notifikasi/alert suara saat boss mau spawn
- Multi-user / sharing jadwal boss ke guild
- Import langsung dari Google Sheet (butuh API key & backend)
