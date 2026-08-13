/**
 * Generate VAPID keys untuk Web Push.
 * Usage: yarn generate:vapid
 * Lalu copy output ke .env dan Vercel Environment Variables.
 */
import webpush from 'web-push'
import { randomBytes } from 'node:crypto'

const keys = webpush.generateVAPIDKeys()
const cronSecret = randomBytes(24).toString('base64url')

console.log(`
# --- Web Push (VAPID) ---
# Paste ke .env lokal + Vercel → Settings → Environment Variables
VAPID_PUBLIC_KEY=${keys.publicKey}
VAPID_PRIVATE_KEY=${keys.privateKey}
VAPID_CONTACT_EMAIL=mailto:admin@example.com
CRON_SECRET=${cronSecret}
`)
