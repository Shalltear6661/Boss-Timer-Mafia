/**
 * Baca file JSON Service Account → cetak baris untuk .env / Vercel.
 * Usage: node scripts/sa-to-env.mjs ./path/ke/key.json
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const file = process.argv[2]
if (!file) {
  console.error('Usage: node scripts/sa-to-env.mjs ./service-account.json')
  process.exit(1)
}

const raw = readFileSync(resolve(process.cwd(), file), 'utf8')
const json = JSON.parse(raw)
if (!json.client_email || !json.private_key) {
  console.error('File JSON bukan Service Account key (butuh client_email + private_key)')
  process.exit(1)
}

const keyOneLine = JSON.stringify(json.private_key) // sudah ada quotes + \n escaped

console.log('\n=== Salin ke .env ===\n')
console.log(`GOOGLE_SERVICE_ACCOUNT_EMAIL=${json.client_email}`)
console.log(`GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY=${keyOneLine}`)
console.log('\n=== Atau satu variabel JSON ===\n')
console.log(`GOOGLE_SERVICE_ACCOUNT_JSON=${JSON.stringify(json)}`)
console.log('\n=== Lalu ===')
console.log(`1. Share spreadsheet ke: ${json.client_email} (Editor)`)
console.log('2. Restart npm run dev / Redeploy Vercel\n')
