const embeddedClientId =
  typeof __GOOGLE_OAUTH_CLIENT_ID__ !== 'undefined' ? __GOOGLE_OAUTH_CLIENT_ID__ : ''

export async function getAuthConfig() {
  // Utama: nilai yang di-inject Vite dari GOOGLE_OAUTH_CLIENT_ID saat dev/build
  if (embeddedClientId) {
    return { clientId: embeddedClientId }
  }
  // Fallback: dari API server (Vercel runtime / proxy)
  const res = await fetch('/api/auth?action=config')
  if (!res.ok) throw new Error('Gagal load auth config')
  const data = await res.json()
  return { clientId: data.clientId || '' }
}

export async function fetchMe() {
  const res = await fetch('/api/auth?action=me', { credentials: 'include' })
  if (!res.ok) return { authenticated: false, canEdit: false }
  return res.json()
}

export async function loginWithCredential(credential) {
  const res = await fetch('/api/auth?action=login', {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ credential }),
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data.error || 'Login gagal')
  return data
}

export async function logout() {
  await fetch('/api/auth?action=logout', {
    method: 'POST',
    credentials: 'include',
  })
}

/** Load Google Identity Services lalu render tombol login */
export function loadGoogleScript() {
  return new Promise((resolve, reject) => {
    if (window.google?.accounts?.id) {
      resolve()
      return
    }
    const existing = document.querySelector('script[data-gsi]')
    if (existing) {
      existing.addEventListener('load', () => resolve())
      existing.addEventListener('error', reject)
      return
    }
    const s = document.createElement('script')
    s.src = 'https://accounts.google.com/gsi/client'
    s.async = true
    s.dataset.gsi = '1'
    s.onload = () => resolve()
    s.onerror = reject
    document.head.appendChild(s)
  })
}

export function renderGoogleButton(element, clientId, onCredential) {
  if (!window.google?.accounts?.id || !clientId || !element) return
  window.google.accounts.id.initialize({
    client_id: clientId,
    callback: (response) => onCredential(response.credential),
    auto_select: false,
    cancel_on_tap_outside: true,
  })
  element.innerHTML = ''
  window.google.accounts.id.renderButton(element, {
    theme: 'filled_black',
    size: 'medium',
    text: 'signin_with',
    shape: 'pill',
    locale: 'id',
  })
}
