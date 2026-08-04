/**
 * OAuth2 dengan refresh token akun Google pribadi (Editor spreadsheet).
 * Env yang dibutuhkan:
 * - GOOGLE_OAUTH_CLIENT_ID
 * - GOOGLE_OAUTH_CLIENT_SECRET
 * - GOOGLE_OAUTH_REFRESH_TOKEN
 */

export async function getAccessToken(env = process.env) {
  const clientId = env['GOOGLE_OAUTH_CLIENT_ID']
  const clientSecret = env['GOOGLE_OAUTH_CLIENT_SECRET']
  const refreshToken = env['GOOGLE_OAUTH_REFRESH_TOKEN']

  if (!clientId || !clientSecret || !refreshToken) {
    const err = new Error(
      'OAuth belum lengkap. Set GOOGLE_OAUTH_CLIENT_ID, GOOGLE_OAUTH_CLIENT_SECRET, GOOGLE_OAUTH_REFRESH_TOKEN'
    )
    err.code = 'MISSING_OAUTH'
    throw err
  }

  const body = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    refresh_token: refreshToken,
    grant_type: 'refresh_token',
  })

  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  })

  const data = await res.json().catch(() => ({}))
  if (!res.ok || !data.access_token) {
    const err = new Error(
      data.error_description || data.error || `Gagal refresh token (${res.status})`
    )
    err.code = 'OAUTH_REFRESH_FAILED'
    throw err
  }

  return data.access_token
}
