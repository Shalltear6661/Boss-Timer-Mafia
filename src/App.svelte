<script>
  import { onMount, onDestroy, tick } from 'svelte'
  import { initialBosses } from './lib/bossData.js'
  import { weeklyBosses as initialWeeklyBosses, nextSpawnFor } from './lib/weeklyBossData.js'
  import { fetchIntervalBosses, fetchWeeklyBosses, markBossKilled } from './lib/spreadsheet.js'
  import { ensureNotificationPermission, checkAndNotify, unlockAudio, isNotificationGranted } from './lib/notifications.js'
  import {
    getAuthConfig,
    fetchMe,
    loginWithCredential,
    logout as apiLogout,
    loadGoogleScript,
    renderGoogleButton,
  } from './lib/auth.js'
  import BossCard from './lib/BossCard.svelte'
  import WeeklyCard from './lib/WeeklyCard.svelte'
  import SpawnSoonCard from './lib/SpawnSoonCard.svelte'

  const STORAGE_KEY = 'boss-timer-data-v2'
  const WEEKLY_STORAGE_KEY = 'boss-timer-weekly-v2'
  const SOON_WINDOW = 10 * 60 * 1000 // tampilkan di hero mulai 10 menit sebelum spawn
  const SYNC_INTERVAL_MS = 60 * 1000
  // Set true lagi setelah Service Account siap
  const ENABLE_MARK_KILLED = false

  let bosses = []
  let weeklyBossesList = []
  let now = new Date()
  let tickInterval
  let syncInterval
  let spreadsheetStatus = 'loading' // 'loading' | 'live' | 'cache'
  let syncing = false
  let killingId = null
  let killError = ''
  let user = { authenticated: false, canEdit: false, email: '', name: '', picture: '' }
  let authReady = false
  let googleClientId = ''
  let googleBtnEl
  let authError = ''
  let notifSupported = typeof Notification !== 'undefined'
  // Baca permission langsung agar banner tidak muncul lagi setelah refresh
  let notifEnabled = typeof Notification !== 'undefined' && Notification.permission === 'granted'

  $: canEdit = ENABLE_MARK_KILLED && !!user.canEdit

  function loadFromStorage() {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) {
      try {
        bosses = JSON.parse(raw).map((b) => ({ ...b, lastDeath: new Date(b.lastDeath) }))
      } catch (e) {
        console.error('Gagal load data tersimpan, pakai data awal', e)
        bosses = initialBosses.map((b) => ({ ...b, lastDeath: new Date(b.lastDeath) }))
      }
    } else {
      bosses = initialBosses.map((b) => ({ ...b, lastDeath: new Date(b.lastDeath) }))
    }

    const rawWeekly = localStorage.getItem(WEEKLY_STORAGE_KEY)
    if (rawWeekly) {
      try {
        weeklyBossesList = JSON.parse(rawWeekly)
      } catch (e) {
        console.error('Gagal load data boss mingguan, pakai data awal', e)
        weeklyBossesList = [...initialWeeklyBosses]
      }
    } else {
      weeklyBossesList = [...initialWeeklyBosses]
    }
  }

  // Ambil data terbaru dari Google Spreadsheet.
  // Kill di web akan menulis Time of Death ke spreadsheet (OAuth akun pribadi).
  async function syncFromSpreadsheet() {
    if (syncing) return
    syncing = true
    try {
      const [fetchedBosses, fetchedWeekly] = await Promise.all([
        fetchIntervalBosses(),
        fetchWeeklyBosses(),
      ])

      if (fetchedBosses.length > 0) {
        bosses = fetchedBosses.map((b) => ({ ...b, lastDeath: new Date(b.lastDeath) }))
        persist()
      }
      if (fetchedWeekly.length > 0) {
        weeklyBossesList = fetchedWeekly
        persistWeekly()
      }
      spreadsheetStatus = 'live'
    } catch (e) {
      console.warn('Gagal sinkronisasi spreadsheet, pakai data lokal:', e)
      spreadsheetStatus = 'cache'
    } finally {
      syncing = false
    }
  }

  function load() {
    loadFromStorage()
    syncFromSpreadsheet()
  }

  function persist() {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify(bosses.map((b) => ({ ...b, lastDeath: b.lastDeath.toISOString() })))
    )
  }

  function persistWeekly() {
    localStorage.setItem(WEEKLY_STORAGE_KEY, JSON.stringify(weeklyBossesList))
  }

  async function refreshFromSpreadsheet() {
    spreadsheetStatus = 'loading'
    await syncFromSpreadsheet()
  }

  async function markKilled(boss) {
    if (!canEdit) {
      killError = 'Login sebagai Editor untuk menandai mati'
      return
    }
    if (!boss?.name || killingId) return
    killingId = boss.id
    killError = ''
    try {
      await markBossKilled(boss.name)
      bosses = bosses.map((b) => (b.id === boss.id ? { ...b, lastDeath: new Date() } : b))
      persist()
      await syncFromSpreadsheet()
    } catch (e) {
      console.error(e)
      killError = e.message || 'Gagal menyimpan ke spreadsheet'
    } finally {
      killingId = null
    }
  }

  async function refreshUser() {
    user = await fetchMe()
  }

  async function handleGoogleCredential(credential) {
    try {
      user = await loginWithCredential(credential)
      killError = ''
    } catch (e) {
      killError = e.message || 'Login gagal'
    }
  }

  async function handleLogout() {
    await apiLogout()
    user = { authenticated: false, canEdit: false, email: '', name: '', picture: '' }
  }

  async function initAuth() {
    try {
      // Paralel: session + clientId + script GSI (jangan serial biar tombol login cepat muncul)
      const [me, cfg] = await Promise.all([
        fetchMe().catch(() => ({ authenticated: false, canEdit: false })),
        getAuthConfig().catch(() => ({ clientId: '' })),
        loadGoogleScript().catch(() => {}),
      ])
      user = me
      googleClientId = (cfg.clientId || '').trim()
      if (googleClientId) {
        await tick()
        if (googleBtnEl && !user.authenticated) {
          renderGoogleButton(googleBtnEl, googleClientId, handleGoogleCredential)
        }
      } else {
        authError =
          'GOOGLE_OAUTH_CLIENT_ID belum di-set di .env / Vercel (atau server belum di-restart/redeploy)'
      }
    } catch (e) {
      console.warn('Auth init:', e)
      authError = e.message || 'Gagal init login'
    } finally {
      authReady = true
    }
  }

  $: if (ENABLE_MARK_KILLED && authReady && googleBtnEl && googleClientId && !user.authenticated) {
    loadGoogleScript()
      .then(() => renderGoogleButton(googleBtnEl, googleClientId, handleGoogleCredential))
      .catch(() => {})
  }

  $: sortedBosses = [...bosses].sort((a, b) => {
    const nextA = a.lastDeath.getTime() + a.spawnIntervalHours * 3600 * 1000
    const nextB = b.lastDeath.getTime() + b.spawnIntervalHours * 3600 * 1000
    return nextA - nextB
  })

  $: sortedWeeklyBosses = [...weeklyBossesList].sort(
    (a, b) => nextSpawnFor(a, now).getTime() - nextSpawnFor(b, now).getTime()
  )

  // Boss yang segera spawn (<=10 menit) atau sudah waktunya — selalu di atas (hero sticky)
  $: soonList = [
    ...sortedBosses.map((b) => {
      const nextSpawn = b.lastDeath.getTime() + b.spawnIntervalHours * 3600 * 1000
      const msLeft = nextSpawn - now.getTime()
      return {
        id: 'ib-' + b.id,
        sourceId: b.id,
        type: 'interval',
        name: b.name,
        meta: `Lv ${b.level} · interval ${b.spawnIntervalHours}j`,
        msLeft,
        isUp: msLeft <= 0,
      }
    }),
    ...sortedWeeklyBosses.map((b) => {
      const nextSpawn = nextSpawnFor(b, now)
      const msLeft = nextSpawn.getTime() - now.getTime()
      return {
        id: 'wb-' + b.id,
        sourceId: b.id,
        type: 'weekly',
        name: b.name,
        meta: 'Boss mingguan',
        msLeft,
        isUp: msLeft <= 0,
      }
    }),
  ]
    .filter((b) => b.isUp || b.msLeft <= SOON_WINDOW)
    .sort((a, b) => a.msLeft - b.msLeft)

  // ID boss yang sudah di hero — jangan duplikat di list bawah
  $: soonIds = new Set(soonList.map((b) => `${b.type}:${b.sourceId}`))
  $: remainingBosses = sortedBosses.filter((b) => !soonIds.has('interval:' + b.id))
  $: remainingWeekly = sortedWeeklyBosses.filter((b) => !soonIds.has('weekly:' + b.id))

  // Kirim notifikasi browser saat milestone 10m / 5m / spawn
  $: if (soonList || bosses.length) {
    const watchList = [
      ...sortedBosses.map((b) => {
        const nextSpawn = b.lastDeath.getTime() + b.spawnIntervalHours * 3600 * 1000
        return { id: 'ib-' + b.id, name: b.name, msLeft: nextSpawn - now.getTime() }
      }),
      ...sortedWeeklyBosses.map((b) => {
        const nextSpawn = nextSpawnFor(b, now)
        return { id: 'wb-' + b.id, name: b.name, msLeft: nextSpawn.getTime() - now.getTime() }
      }),
    ]
    checkAndNotify(watchList)
  }

  onMount(async () => {
    load()
    if (ENABLE_MARK_KILLED) initAuth()
    else authReady = true
    notifEnabled = isNotificationGranted()
    const unlockOnce = () => {
      unlockAudio()
      window.removeEventListener('pointerdown', unlockOnce)
    }
    window.addEventListener('pointerdown', unlockOnce)
    tickInterval = setInterval(() => {
      now = new Date()
    }, 1000)
    syncInterval = setInterval(() => {
      syncFromSpreadsheet()
    }, SYNC_INTERVAL_MS)
  })

  onDestroy(() => {
    if (tickInterval) clearInterval(tickInterval)
    if (syncInterval) clearInterval(syncInterval)
  })
</script>

<main>
  <header>
    <div class="brand">
      <span class="brand-mark">◈</span>
      <div>
        <h1>Mafia Timer</h1>
        <p class="tagline">Bersama MOJO kita kuasai Helena 6</p>
      </div>
    </div>
    <div class="header-right">
      <div class="clock">
        <div class="clock-time">{now.toLocaleTimeString('id-ID', { hour12: false })}</div>
        <div class="clock-date">{now.toLocaleDateString('id-ID', { weekday: 'long', day: 'numeric', month: 'long' })}</div>
      </div>
      {#if ENABLE_MARK_KILLED}
        <div class="auth-box">
          {#if user.authenticated}
            <div class="user-chip" class:editor={canEdit}>
              {#if user.picture}
                <img src={user.picture} alt="" class="avatar" />
              {/if}
              <div class="user-meta">
                <span class="user-name">{user.name || user.email}</span>
                <span class="user-role">{canEdit ? 'Editor' : 'View-only'}</span>
              </div>
              <button class="logout-btn" on:click={handleLogout}>Keluar</button>
            </div>
          {:else if googleClientId}
            <div class="google-btn" bind:this={googleBtnEl}></div>
          {:else}
            <div class="login-placeholder" title={authError || 'Set GOOGLE_OAUTH_CLIENT_ID'}>
              Login belum siap
            </div>
          {/if}
        </div>
      {/if}
      <button
        class="spreadsheet-status"
        class:live={spreadsheetStatus === 'live'}
        class:cache={spreadsheetStatus === 'cache'}
        class:loading={spreadsheetStatus === 'loading'}
        on:click={refreshFromSpreadsheet}
        title="Klik untuk refresh dari spreadsheet"
        disabled={syncing}
      >
        {#if spreadsheetStatus === 'loading'}
          <span class="dot loading-dot"></span>
          <span class="label">Memuat...</span>
        {:else if spreadsheetStatus === 'live'}
          <span class="dot live-dot"></span>
          <span class="label">Spreadsheet</span>
        {:else}
          <span class="dot cache-dot"></span>
          <span class="label">Lokal</span>
        {/if}
      </button>
    </div>
  </header>

  {#if soonList.length > 0}
    <section class="hero sticky-hero">
      <div class="hero-header">
        <h2 class="section-title alert">Akan Spawn Sebentar Lagi</h2>
        <span class="hero-count">{soonList.length} boss</span>
      </div>
      <div class="hero-grid">
        {#each soonList as b (b.id)}
          <SpawnSoonCard
            name={b.name}
            meta={b.meta}
            msLeft={b.msLeft}
            isUp={b.isUp}
            canMarkKilled={canEdit && b.type === 'interval'}
            killing={killingId === b.sourceId}
            onMarkKilled={() => {
              const boss = bosses.find((x) => x.id === b.sourceId)
              if (boss) markKilled(boss)
            }}
          />
        {/each}
      </div>
    </section>
  {/if}

  {#if killError}
    <div class="kill-error">{killError}</div>
  {/if}

  {#if ENABLE_MARK_KILLED && !user.authenticated}
    <div class="role-banner">
      {#if googleClientId}
        Tombol <strong>Sign in with Google</strong> ada di kanan atas (sebelah jam). Login sebagai Editor untuk Tandai Mati.
      {:else}
        Tombol login belum muncul karena <code>GOOGLE_OAUTH_CLIENT_ID</code> masih kosong di <code>.env</code> / Vercel.
        Buat OAuth Client tipe <strong>Web application</strong>, isi Client ID, restart dev server / Redeploy.
      {/if}
    </div>
  {:else if ENABLE_MARK_KILLED && !canEdit}
    <div class="role-banner view">
      Anda login sebagai <strong>{user.email}</strong> (view-only). Hubungi admin untuk ditambahkan ke daftar Editor.
    </div>
  {/if}

  {#if !notifEnabled && notifSupported}
    <div class="notif-banner">
      <span>Aktifkan notifikasi + suara untuk peringatan 10 menit, 5 menit, dan saat spawn.</span>
      <button
        on:click={async () => {
          notifEnabled = await ensureNotificationPermission()
        }}
      >
        Izinkan Notifikasi & Suara
      </button>
    </div>
  {/if}

  <section>
    <h2 class="section-title">Field Boss (Interval)</h2>
    {#if remainingBosses.length === 0}
      <p class="empty-hint">Semua field boss yang relevan sedang ditampilkan di atas.</p>
    {:else}
      <div class="card-grid">
        {#each remainingBosses as boss (boss.id)}
          <BossCard
            {boss}
            {now}
            onMarkKilled={canEdit ? markKilled : null}
            killing={killingId === boss.id}
            showKill={canEdit}
          />
        {/each}
      </div>
    {/if}
  </section>

  <section>
    <h2 class="section-title">Boss Mingguan (Jadwal Tetap)</h2>
    {#if remainingWeekly.length === 0}
      <p class="empty-hint">Semua boss mingguan yang relevan sedang ditampilkan di atas.</p>
    {:else}
      <div class="card-grid">
        {#each remainingWeekly as boss (boss.id)}
          <WeeklyCard {boss} {now} />
        {/each}
      </div>
    {/if}
  </section>

  <footer>
    <p class="footer-note">
      Data dari Google Spreadsheet. Update waktu kematian di sheet; app sync otomatis tiap menit.
    </p>
    <button class="link" on:click={refreshFromSpreadsheet} disabled={syncing}>
      {syncing ? 'Menyinkronkan...' : 'Refresh data sekarang'}
    </button>
  </footer>
</main>

<style>
  @import url('https://fonts.googleapis.com/css2?family=Cinzel:wght@500;700&family=JetBrains+Mono:wght@500;700&family=Inter:wght@400;500;600&display=swap');

  :global(body) {
    margin: 0;
    background: radial-gradient(ellipse 1200px 600px at 50% -10%, #23213a 0%, #0f0f17 55%), #0f0f17;
    color: #eee;
    font-family: 'Inter', system-ui, sans-serif;
  }

  main {
    max-width: 960px;
    margin: 0 auto;
    padding: 28px 18px 70px;
  }

  header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    flex-wrap: wrap;
    gap: 12px;
    margin-bottom: 26px;
    padding-bottom: 20px;
    border-bottom: 1px solid #23232f;
  }
  .brand {
    display: flex;
    align-items: center;
    gap: 12px;
  }
  .brand-mark {
    font-size: 26px;
    color: #f0b428;
    text-shadow: 0 0 16px rgba(240, 180, 40, 0.6);
  }
  h1 {
    font-family: 'Cinzel', serif;
    font-size: 24px;
    margin: 0;
    letter-spacing: 0.02em;
    background: linear-gradient(135deg, #fff, #c9b8ff);
    -webkit-background-clip: text;
    background-clip: text;
    color: transparent;
  }
  .tagline {
    margin: 2px 0 0;
    font-size: 12px;
    color: #7a7a90;
  }
  .clock {
    text-align: right;
  }
  .header-right {
    display: flex;
    align-items: center;
    gap: 14px;
    flex-wrap: wrap;
  }
  .auth-box {
    display: flex;
    align-items: center;
  }
  .user-chip {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 4px 8px 4px 4px;
    border-radius: 999px;
    background: #181825;
    border: 1px solid #2a2a38;
  }
  .user-chip.editor {
    border-color: #2a6a3a;
  }
  .avatar {
    width: 28px;
    height: 28px;
    border-radius: 50%;
  }
  .user-meta {
    display: flex;
    flex-direction: column;
    line-height: 1.15;
    max-width: 140px;
  }
  .user-name {
    font-size: 11px;
    color: #ddd;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .user-role {
    font-size: 10px;
    color: #8a8aa0;
  }
  .user-chip.editor .user-role {
    color: #7fc88a;
  }
  .logout-btn {
    background: transparent;
    border: 1px solid #3a3a52;
    color: #aaa;
    font-size: 10px;
    padding: 4px 8px;
    border-radius: 999px;
    cursor: pointer;
    font-family: inherit;
  }
  .logout-btn:hover {
    border-color: #666;
    color: #eee;
  }
  .google-btn {
    min-height: 32px;
    min-width: 180px;
  }
  .login-placeholder {
    font-size: 11px;
    color: #c8b87f;
    padding: 6px 12px;
    border-radius: 999px;
    border: 1px dashed #6a5a2a;
    background: rgba(240, 180, 40, 0.08);
  }
  .role-banner code {
    font-size: 12px;
    color: #e8e0ff;
  }
  .role-banner {
    margin-bottom: 16px;
    padding: 10px 14px;
    border-radius: 10px;
    background: rgba(106, 90, 205, 0.12);
    border: 1px solid rgba(106, 90, 205, 0.35);
    color: #c8c0e8;
    font-size: 13px;
  }
  .role-banner.view {
    background: rgba(240, 180, 40, 0.08);
    border-color: rgba(240, 180, 40, 0.3);
    color: #c8b87f;
  }
  .clock-time {
    font-family: 'JetBrains Mono', monospace;
    font-size: 20px;
    font-weight: 700;
    color: #d8d8e6;
  }
  .clock-date {
    font-size: 11px;
    color: #7a7a90;
    text-transform: capitalize;
  }

  .spreadsheet-status {
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: 11px;
    color: #7a7a90;
    padding: 4px 10px;
    border-radius: 20px;
    background: #181825;
    border: 1px solid #2a2a38;
    cursor: pointer;
    font-family: inherit;
  }
  .spreadsheet-status:hover:not(:disabled) {
    border-color: #4a4a68;
  }
  .spreadsheet-status:disabled {
    opacity: 0.7;
    cursor: wait;
  }
  .spreadsheet-status.live {
    border-color: #2a6a3a;
    color: #7fc88a;
  }
  .spreadsheet-status.cache {
    border-color: #6a5a2a;
    color: #c8b87f;
  }
  .spreadsheet-status.loading {
    border-color: #3a3a5a;
    color: #9a9ab0;
  }
  .dot {
    width: 7px;
    height: 7px;
    border-radius: 50%;
  }
  .live-dot {
    background: #4ade80;
    box-shadow: 0 0 6px rgba(74, 222, 128, 0.5);
  }
  .cache-dot {
    background: #f0b428;
    box-shadow: 0 0 6px rgba(240, 180, 40, 0.4);
  }
  .loading-dot {
    background: #7a7a90;
    animation: pulse 1s ease-in-out infinite;
  }
  @keyframes pulse {
    0%, 100% { opacity: 0.4; }
    50% { opacity: 1; }
  }
  .label {
    font-weight: 500;
  }

  .hero {
    margin-bottom: 28px;
  }
  .sticky-hero {
    position: sticky;
    top: 0;
    z-index: 40;
    margin-left: -10px;
    margin-right: -10px;
    padding: 14px 10px 16px;
    background: linear-gradient(180deg, rgba(15, 15, 23, 0.97) 60%, rgba(15, 15, 23, 0.88));
    backdrop-filter: blur(10px);
    border-bottom: 1px solid rgba(240, 180, 40, 0.2);
    box-shadow: 0 12px 28px -16px rgba(0, 0, 0, 0.8);
  }
  .hero-header {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 12px;
    margin-bottom: 12px;
  }
  .hero-header .section-title {
    margin: 0;
  }
  .hero-count {
    font-size: 12px;
    color: #f0b428;
    font-weight: 600;
  }
  .hero-grid {
    display: grid;
    grid-template-columns: 1fr;
    gap: 14px;
  }
  @media (min-width: 720px) {
    .hero-grid {
      grid-template-columns: repeat(auto-fill, minmax(340px, 1fr));
    }
  }

  .notif-banner {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    margin-bottom: 24px;
    padding: 12px 16px;
    border-radius: 12px;
    background: rgba(106, 90, 205, 0.12);
    border: 1px solid rgba(106, 90, 205, 0.35);
    font-size: 13px;
    color: #c8c0e8;
  }
  .notif-banner button {
    background: #4a3a8a;
    border: none;
    color: #fff;
    padding: 8px 14px;
    border-radius: 8px;
    cursor: pointer;
    font-size: 12px;
    font-weight: 600;
    font-family: inherit;
  }
  .notif-banner button:hover {
    background: #5a48a8;
  }
  .empty-hint {
    margin: 0;
    font-size: 13px;
    color: #6a6a80;
  }
  .kill-error {
    margin-bottom: 16px;
    padding: 10px 14px;
    border-radius: 10px;
    background: rgba(224, 72, 60, 0.12);
    border: 1px solid rgba(224, 72, 60, 0.4);
    color: #ff8478;
    font-size: 13px;
  }

  .section-title {
    font-size: 13px;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: #8a8aa0;
    font-weight: 600;
    margin: 0 0 14px;
  }
  .section-title.alert {
    color: #f0b428;
    text-transform: none;
    letter-spacing: normal;
    font-size: 15px;
  }

  section {
    margin-bottom: 34px;
  }

  .card-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
    gap: 12px;
  }

  footer {
    text-align: center;
    margin-top: 10px;
  }
  .footer-note {
    margin: 0 0 10px;
    font-size: 12px;
    color: #6a6a80;
  }
  .link {
    background: none;
    border: none;
    color: #6a6a80;
    text-decoration: underline;
    cursor: pointer;
    font-size: 12px;
    font-family: inherit;
  }
  .link:disabled {
    opacity: 0.6;
    cursor: wait;
  }
  .link:hover:not(:disabled) {
    color: #9a9ab0;
  }

  @media (prefers-reduced-motion: reduce) {
    :global(*) {
      animation-duration: 0.01ms !important;
      animation-iteration-count: 1 !important;
    }
  }
</style>
