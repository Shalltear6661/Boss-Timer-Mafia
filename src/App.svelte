<script>
  import { onMount, onDestroy, tick } from 'svelte'
  import { initialBosses } from './lib/bossData.js'
  import { weeklyBosses as initialWeeklyBosses, nextSpawnFor } from './lib/weeklyBossData.js'
  import { fetchIntervalBosses, fetchWeeklyBosses, markBossKilled, fetchMaintenanceStatus, toggleMaintenanceActive } from './lib/spreadsheet.js'
  import { ensureNotificationPermission, checkAndNotify, unlockAudio, playAlertSound, isNotificationGranted, enableNotificationsWithPush } from './lib/notifications.js'
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
  import {
    TIMEZONE_OPTIONS,
    getTimezoneOption,
    formatTimeInZone,
    formatDateInZone,
    zonedTimeToUtc,
  } from './lib/timezone.js'

  const STORAGE_KEY = 'boss-timer-data-v3'
  const WEEKLY_STORAGE_KEY = 'boss-timer-weekly-v4'
  const TURN_MIN_KEY = 'boss-timer-turn-min-v1'
  const TZ_STORAGE_KEY = 'boss-timer-tz-v1'
  const SYNC_INTERVAL_MS = 60 * 1000
  const MINIMIZED_BOSS_COUNT_MOBILE = 3
  const MINIMIZED_BOSS_COUNT_DESKTOP = 4
  const MOBILE_MQ = '(max-width: 719px)'
  const SPREADSHEET_URL =
    'https://docs.google.com/spreadsheets/d/16RuhOUl3XUXtWMkBeRZwgYBYdCoOH4w-zPUVyLqf3hI/edit?gid=1345093675#gid=1345093675'
  // Service Account + share sheet sudah siap
  const ENABLE_MARK_KILLED = true

  let bosses = []
  let weeklyBossesList = []
  let now = new Date()
  let tickInterval
  let syncInterval
  let spreadsheetStatus = 'loading' // 'loading' | 'live' | 'cache'
  let syncing = false
  let killingId = null
  let killError = ''
  let killTarget = null
  let killDate = ''
  let killTime = ''

  function openKillForm(boss) {
    const pad = (n) => String(n).padStart(2, '0')
    const d = new Date()
    const local = new Intl.DateTimeFormat('en-CA', {
      timeZone: displayTimeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(d)
    killDate = local
    const timeParts = new Intl.DateTimeFormat('en-GB', {
      timeZone: displayTimeZone,
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).formatToParts(d)
    const hh = timeParts.find((p) => p.type === 'hour')?.value || '00'
    const mm = timeParts.find((p) => p.type === 'minute')?.value || '00'
    killTime = `${hh}:${mm}`
    killTarget = boss
  }

  function closeKillForm() {
    killTarget = null
  }

  function confirmKill() {
    if (!killTarget || !killDate || !killTime) return
    const [year, month, day] = killDate.split('-').map(Number)
    const [hour, minute] = killTime.split(':').map(Number)
    const deathDate = zonedTimeToUtc({ year, month, day, hour, minute }, displayTimeZone)
    const target = killTarget
    killingId = target.id
    killError = ''
    markKilledFromModal(target, deathDate)
  }

  async function markKilledFromModal(boss, deathDate) {
    if (!boss?.name) return
    try {
      const deathISO = deathDate.toISOString()
      const turn = boss._sheetTurn || ''
      await markBossKilled(boss.name, deathISO, turn)
      bosses = bosses.map((b) =>
        b.id === boss.id ? { ...b, lastDeath: deathDate } : b
      )
      persist()
      await syncFromSpreadsheet()
      killTarget = null // sukses → tutup modal
    } catch (e) {
      console.error(e)
      killError = e.message || 'Gagal menyimpan ke spreadsheet'
    } finally {
      killingId = null
    }
  }

  let user = { authenticated: false, canEdit: false, email: '', name: '', picture: '' }
  let authReady = false
  let googleClientId = ''
  let googleBtnEl
  let authError = ''
  let notifSupported = typeof Notification !== 'undefined'
  // Baca permission langsung agar banner tidak muncul lagi setelah refresh
  let notifEnabled = typeof Notification !== 'undefined' && Notification.permission === 'granted'
  let pushEnabled = false
  let pushSupported =
    typeof window !== 'undefined' &&
    'serviceWorker' in navigator &&
    'PushManager' in window
  let searchQuery = ''
  let turnMinimized = loadTurnMinimized()
  let tzId = loadTzId()
  let isMobile =
    typeof window !== 'undefined' && window.matchMedia
      ? window.matchMedia(MOBILE_MQ).matches
      : true
  let mobileMq
  let maintenanceMode = false
  let maintenanceLoading = false

  $: tzOption = getTimezoneOption(tzId)
  $: displayTimeZone = tzOption.tz
  $: tzLabel = tzOption.short
  $: minimizedBossCount = isMobile ? MINIMIZED_BOSS_COUNT_MOBILE : MINIMIZED_BOSS_COUNT_DESKTOP

  function loadTzId() {
    try {
      const saved = localStorage.getItem(TZ_STORAGE_KEY)
      if (saved && TIMEZONE_OPTIONS.some((o) => o.id === saved)) return saved
    } catch {
      /* ignore */
    }
    return 'id'
  }

  function setTimezone(id) {
    if (!TIMEZONE_OPTIONS.some((o) => o.id === id)) return
    tzId = id
    try {
      localStorage.setItem(TZ_STORAGE_KEY, id)
    } catch {
      /* ignore */
    }
  }

  function loadTurnMinimized() {
    try {
      return JSON.parse(localStorage.getItem(TURN_MIN_KEY) || '{}') || {}
    } catch {
      return {}
    }
  }

  function toggleTurnMinimized(key) {
    const currentlyMinimized = turnMinimized[key] !== false
    turnMinimized = {
      ...turnMinimized,
      [key]: !currentlyMinimized,
    }
    try {
      localStorage.setItem(TURN_MIN_KEY, JSON.stringify(turnMinimized))
    } catch {
      /* ignore */
    }
  }

  $: canEdit = ENABLE_MARK_KILLED && !!user.canEdit
  $: searchNeedle = searchQuery.trim().toLowerCase()

  function matchesSearch(name) {
    if (!searchNeedle) return true
    return String(name || '')
      .toLowerCase()
      .includes(searchNeedle)
  }

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
      const [fetchedBosses, fetchedWeekly, maint] = await Promise.all([
        fetchIntervalBosses(),
        fetchWeeklyBosses(),
        fetchMaintenanceStatus(),
      ])

      maintenanceMode = maint.maintenance

      if (maintenanceMode) {
        bosses = []
        persist()
      } else if (fetchedBosses.length > 0) {
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

  async function toggleMaintenance(active) {
    if (!canEdit || maintenanceLoading) return
    maintenanceLoading = true
    try {
      await toggleMaintenanceActive(active)
      maintenanceMode = active
      if (active) {
        bosses = []
        persist()
      } else {
        await syncFromSpreadsheet()
      }
    } catch (e) {
      console.error('Gagal toggle maintenance:', e)
    } finally {
      maintenanceLoading = false
    }
  }

  async function markKilled(boss, deathDate) {
    if (!canEdit) {
      killError = 'Login sebagai Editor untuk menandai mati'
      return
    }
    if (!boss?.name || killingId) return
    killingId = boss.id
    killError = ''
    try {
      const deathISO = deathDate ? deathDate.toISOString() : new Date().toISOString()
      const turn = boss._sheetTurn || ''
      await markBossKilled(boss.name, deathISO, turn)
      bosses = bosses.map((b) =>
        b.id === boss.id ? { ...b, lastDeath: deathDate || new Date() } : b
      )
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

  function normalizeTurn(turn) {
    const t = (turn || '').trim()
    if (!t || t === '-') return 'Tanpa Turn'
    return t
  }

  function turnOrder(turn) {
    const t = normalizeTurn(turn)
    if (t === 'MAFIA') return 0
    if (t === 'MAFIAx2') return 1
    if (t === 'Tanpa Turn') return 99
    return 50
  }

  function groupByTurn(list) {
    const map = new Map()
    for (const b of list) {
      const key = normalizeTurn(b.turn)
      if (!map.has(key)) map.set(key, [])
      map.get(key).push(b)
    }
    return [...map.entries()].sort(
      (a, b) => turnOrder(a[0]) - turnOrder(b[0]) || a[0].localeCompare(b[0])
    )
  }

  $: sortedBosses = [...bosses].sort((a, b) => {
    const turnDiff = turnOrder(a.turn) - turnOrder(b.turn)
    if (turnDiff !== 0) return turnDiff
    const nextA = a.lastDeath.getTime() + a.spawnIntervalHours * 3600 * 1000
    const nextB = b.lastDeath.getTime() + b.spawnIntervalHours * 3600 * 1000
    return nextA - nextB
  })

  $: sortedWeeklyBosses = [...weeklyBossesList].sort((a, b) => {
    const turnDiff = turnOrder(a.turn) - turnOrder(b.turn)
    if (turnDiff !== 0) return turnDiff
    return nextSpawnFor(a, now).getTime() - nextSpawnFor(b, now).getTime()
  })

  $: weeklyTurnCards = ['MAFIA', 'MAFIAx2']
    .map((turn) => ({
      turn,
      bosses: sortedWeeklyBosses.filter(
        (b) => (b.turn || '').trim() === turn && (!searchNeedle || String(b.name || '').toLowerCase().includes(searchNeedle))
      ),
    }))
    .filter((g) => g.bosses.length > 0)
  $: bossesByTurn = groupByTurn(
    sortedBosses.filter((b) => !searchNeedle || String(b.name || '').toLowerCase().includes(searchNeedle))
  )
  $: searchHitCount =
    bossesByTurn.reduce((n, [, bs]) => n + bs.length, 0) +
    weeklyTurnCards.reduce((n, g) => n + g.bosses.length, 0)
  $: searching = searchNeedle.length > 0

  // Kirim notifikasi browser saat milestone 10m / 5m / spawn
  $: if (bosses.length) {
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
    // Re-subscribe push jika permission sudah granted (refresh / reopen)
    if (notifEnabled && pushSupported) {
      import('./lib/push.js')
        .then(({ subscribeToPush, isPushSubscribedLocally }) => {
          pushEnabled = isPushSubscribedLocally()
          return subscribeToPush()
        })
        .then((sub) => {
          pushEnabled = !!sub
        })
        .catch(() => {})
    }
    if (typeof window !== 'undefined' && window.matchMedia) {
      mobileMq = window.matchMedia(MOBILE_MQ)
      isMobile = mobileMq.matches
      const onMq = (e) => {
        isMobile = e.matches
      }
      if (mobileMq.addEventListener) mobileMq.addEventListener('change', onMq)
      else mobileMq.addListener(onMq)
      mobileMq._onChange = onMq
    }
    const unlockOnce = () => {
      unlockAudio()
      window.removeEventListener('pointerdown', unlockOnce)
    }
    window.addEventListener('pointerdown', unlockOnce)

    // Web Push → minta tab terbuka putar suara custom
    const onSwMessage = (event) => {
      if (event.data?.type === 'PLAY_ALERT_SOUND') playAlertSound()
    }
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.addEventListener('message', onSwMessage)
      window._swMessageHandler = onSwMessage
    }

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
    if (mobileMq?._onChange) {
      if (mobileMq.removeEventListener) mobileMq.removeEventListener('change', mobileMq._onChange)
      else mobileMq.removeListener(mobileMq._onChange)
    }
    if (window._swMessageHandler && 'serviceWorker' in navigator) {
      navigator.serviceWorker.removeEventListener('message', window._swMessageHandler)
      delete window._swMessageHandler
    }
  })
</script>

<main>
  <header>
    <div class="brand">
      <span class="brand-mark">◈</span>
      <div>
        <h1>Mafia Timer</h1>
        <div class="brand-status">
          <a
            class="spreadsheet-status"
            class:live={spreadsheetStatus === 'live'}
            class:cache={spreadsheetStatus === 'cache'}
            class:loading={spreadsheetStatus === 'loading'}
            href={SPREADSHEET_URL}
            target="_blank"
            rel="noopener noreferrer"
            title="Buka spreadsheet di tab baru"
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
          </a>
        </div>
        <h2 class="tagline">Bersama MOJO kita kuasai LORDNINE</h2>
      </div>
    </div>
    <div class="header-right">
      <div class="tz-switch" role="group" aria-label="Zona waktu">
        {#each TIMEZONE_OPTIONS as opt (opt.id)}
          <button
            type="button"
            class="tz-btn"
            class:active={tzId === opt.id}
            on:click={() => setTimezone(opt.id)}
            title={`${opt.label} (${opt.short})`}
          >
            {opt.label}
          </button>
        {/each}
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
      <div class="clock">
        <div class="clock-time">
          {formatTimeInZone(now, displayTimeZone, { withSeconds: true })}
          <span class="tz-tag">{tzLabel}</span>
        </div>
        <div class="clock-date">{formatDateInZone(now, displayTimeZone)}</div>
      </div>
    </div>
  </header>

  {#if killError}
    <div class="kill-error">{killError}</div>
  {/if}

  <!-- Maintenance Banner -->
  {#if maintenanceMode}
    <div class="maintenance-banner" role="alert">
      <div class="maint-icon">🔧</div>
      <div class="maint-text">
        <strong>Maintenance Aktif</strong> — Jadwal interval boss dikosongkan sementara.
        {#if canEdit}
          <button
            class="maint-btn"
            on:click={() => toggleMaintenance(false)}
            disabled={maintenanceLoading}
          >
            {maintenanceLoading ? 'Memproses...' : 'Akhiri Maintenance'}
          </button>
        {/if}
      </div>
    </div>
  {:else if canEdit}
    <div class="maintenance-toggle">
      <button
        class="maint-btn outline"
        on:click={() => toggleMaintenance(true)}
        disabled={maintenanceLoading}
      >
        {maintenanceLoading ? 'Memproses...' : 'Mulai Maintenance'}
      </button>
    </div>
  {/if}

  {#if killTarget}
  <!-- svelte-ignore a11y-click-events-have-key-events -->
  <div class="kill-modal-overlay" on:click={closeKillForm} on:keydown={(e) => e.key === 'Escape' && closeKillForm()} role="dialog" aria-modal="true" aria-label="Input tanggal dan jam kematian">
    <div class="kill-modal" on:click|stopPropagation>
      <h3 class="modal-title">Tandai Mati — {killTarget.name}</h3>
      <p class="modal-hint">Masukkan tanggal dan jam boss mati (sesuaikan zona waktu {tzLabel})</p>
      <div class="modal-fields">
        <label class="modal-label">
          <span>Tanggal</span>
          <input type="date" class="modal-input" bind:value={killDate} />
        </label>
        <label class="modal-label">
          <span>Jam</span>
          <input type="time" class="modal-input" bind:value={killTime} />
        </label>
      </div>
      <div class="modal-actions">
        <button class="modal-cancel" on:click={closeKillForm}>Batal</button>
        <button class="modal-confirm" on:click={confirmKill} disabled={killingId || !killDate || !killTime}>
          {killingId ? 'Menyimpan...' : 'Konfirmasi'}
        </button>
      </div>
    </div>
  </div>
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
      <span>
        Aktifkan notifikasi + Web Push agar peringatan 10 menit / 5 menit / spawn tetap muncul
        meski browser di-minimize (mobile).
      </span>
      <button
        on:click={async () => {
          const result = await enableNotificationsWithPush()
          notifEnabled = result.granted
          pushEnabled = result.push
        }}
      >
        Izinkan Notifikasi & Push
      </button>
    </div>
  {:else if notifEnabled && pushSupported && !pushEnabled}
    <div class="notif-banner">
      <span>Notifikasi lokal aktif. Aktifkan Web Push agar tetap jalan saat app di-minimize.</span>
      <button
        on:click={async () => {
          const result = await enableNotificationsWithPush()
          notifEnabled = result.granted
          pushEnabled = result.push
        }}
      >
        Aktifkan Web Push
      </button>
    </div>
  {/if}

  <div class="search-bar">
    <input
      type="search"
      class="search-input"
      placeholder="Cari boss by nama..."
      bind:value={searchQuery}
      autocomplete="off"
      spellcheck="false"
    />
    {#if searching}
      <span class="search-meta">{searchHitCount} hasil</span>
      <button type="button" class="search-clear" on:click={() => (searchQuery = '')}>Hapus</button>
    {/if}
  </div>

  {#if searching && searchHitCount === 0}
    <p class="empty-hint search-empty">Tidak ada boss bernama “{searchQuery.trim()}”.</p>
  {/if}

  <section>
    <h2 class="section-title">Field Boss (Interval)</h2>
    {#if bossesByTurn.length === 0}
      <p class="empty-hint">
        {#if searching}
          Tidak ada field boss yang cocok.
        {:else}
          Belum ada data field boss tersedia.
        {/if}
      </p>
    {:else}
      {#each bossesByTurn as [turnLabel, turnBosses] (turnLabel)}
        {@const turnKey = 'field:' + turnLabel}
        {@const minimized = turnMinimized[turnKey] !== false}
        {@const shownBosses =
          !minimized || turnBosses.length <= minimizedBossCount
            ? turnBosses
            : turnBosses.slice(0, minimizedBossCount)}
        <div
          class="turn-panel"
          class:mafia={turnLabel === 'MAFIA'}
          class:mafiax2={turnLabel === 'MAFIAx2'}
          class:noturn={turnLabel === 'Tanpa Turn'}
          class:minimized
        >
          <h3 class="turn-label">
            <span class="turn-dot"></span>
            {turnLabel === 'Tanpa Turn' ? 'Tanpa Turn' : `Turn ${turnLabel}`}
            <span class="turn-count">{turnBosses.length}</span>
            {#if turnBosses.length > minimizedBossCount}
              <button
                type="button"
                class="turn-toggle"
                aria-expanded={!minimized}
                on:click={() => toggleTurnMinimized(turnKey)}
              >
                {minimized ? `Tampilkan semua (${turnBosses.length})` : 'Minimize'}
              </button>
            {/if}
          </h3>
          <div class="card-grid">
            {#each shownBosses as boss (boss.id)}
              <BossCard
                {boss}
                {now}
                timeZone={displayTimeZone}
                {tzLabel}
                onMarkKilled={canEdit ? (boss) => openKillForm(boss) : null}
                killing={killingId === boss.id}
                showKill={canEdit}
              />
            {/each}
          </div>
          {#if minimized && turnBosses.length > minimizedBossCount}
            <p class="min-hint">Menampilkan {minimizedBossCount} dari {turnBosses.length} boss</p>
          {/if}
        </div>
      {/each}
    {/if}
  </section>

  <section>
    <h2 class="section-title">Boss Mingguan (Jadwal Tetap)</h2>
    {#if weeklyTurnCards.length === 0}
      <p class="empty-hint">
        {#if searching}
          Tidak ada boss mingguan yang cocok.
        {:else}
          Tidak ada data boss mingguan MAFIA / MAFIAx2.
        {/if}
      </p>
    {:else}
      <div class="card-grid weekly-turn-grid">
        {#each weeklyTurnCards as group (group.turn)}
          {@const weeklyKey = 'weekly:' + group.turn}
          {@const weeklyMinimized = turnMinimized[weeklyKey] !== false}
          <WeeklyCard
            turn={group.turn}
            bosses={group.bosses}
            {now}
            timeZone={displayTimeZone}
            {tzLabel}
            minimized={weeklyMinimized}
            minCount={minimizedBossCount}
            onToggleMinimize={() => toggleTurnMinimized(weeklyKey)}
          />
        {/each}
      </div>
    {/if}
  </section>

  <footer>
    <p class="footer-note">
      Login sebagai Editor untuk Tandai Mati. Data sync dari spreadsheet tiap menit.
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
    font-size: 14px;
    color: #f0b428;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    font-family: 'Inter', system-ui, sans-serif;
    font-weight: 500;
  }
  .brand-status {
    margin: 4px 0 2px;
  }
  .brand-status .spreadsheet-status {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    font-size: 10px;
    color: #7a7a90;
    padding: 2px 8px;
    border-radius: 20px;
    background: #181825;
    border: 1px solid #2a2a38;
    cursor: pointer;
    font-family: inherit;
    text-decoration: none;
  }
  .brand-status .spreadsheet-status:hover {
    border-color: #4a4a68;
  }
  .brand-status .spreadsheet-status.live {
    border-color: #2a6a3a;
    color: #7fc88a;
  }
  .brand-status .spreadsheet-status.cache {
    border-color: #6a5a2a;
    color: #c8b87f;
  }
  .brand-status .spreadsheet-status.loading {
    border-color: #3a3a5a;
    color: #9a9ab0;
  }
  .brand-status .dot {
    width: 6px;
    height: 6px;
    border-radius: 50%;
  }
  .brand-status .live-dot {
    background: #4ade80;
    box-shadow: 0 0 6px rgba(74, 222, 128, 0.5);
  }
  .brand-status .cache-dot {
    background: #f0b428;
    box-shadow: 0 0 6px rgba(240, 180, 40, 0.4);
  }
  .brand-status .loading-dot {
    background: #7a7a90;
    animation: pulse 1s ease-in-out infinite;
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
  .tz-switch {
    display: inline-flex;
    padding: 3px;
    border-radius: 10px;
    background: rgba(0, 0, 0, 0.35);
    border: 1px solid #2a2a38;
    gap: 2px;
  }
  .tz-btn {
    font-family: 'Inter', system-ui, sans-serif;
    font-size: 11px;
    font-weight: 600;
    color: #8a8aa0;
    background: transparent;
    border: none;
    border-radius: 7px;
    padding: 6px 10px;
    cursor: pointer;
  }
  .tz-btn:hover {
    color: #d8d8e6;
  }
  .tz-btn.active {
    color: #0f0f17;
    background: linear-gradient(135deg, #f0b428, #e0a020);
  }
  .tz-tag {
    margin-left: 6px;
    font-size: 11px;
    font-weight: 600;
    color: #f0b428;
    letter-spacing: 0.04em;
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

  .search-empty {
    margin-bottom: 18px;
    padding: 12px 14px;
    border-radius: 10px;
    background: rgba(255, 255, 255, 0.03);
    border: 1px dashed #2a2a38;
  }

  .search-bar {
    display: flex;
    align-items: center;
    gap: 10px;
    margin-bottom: 20px;
  }
  .search-input {
    flex: 1;
    min-width: 0;
    padding: 11px 14px;
    border-radius: 10px;
    border: 1px solid #2a2a38;
    background: #14141e;
    color: #eee;
    font-size: 14px;
    font-family: inherit;
    outline: none;
    transition: border-color 0.15s, box-shadow 0.15s;
  }
  .search-input::placeholder {
    color: #6a6a80;
  }
  .search-input:focus {
    border-color: rgba(160, 140, 224, 0.55);
    box-shadow: 0 0 0 3px rgba(124, 92, 200, 0.18);
  }
  .search-meta {
    font-size: 12px;
    color: #8a8aa0;
    white-space: nowrap;
  }
  .search-clear {
    border: 1px solid #2a2a38;
    background: #1a1a26;
    color: #c8c8d8;
    border-radius: 8px;
    padding: 8px 12px;
    font-size: 12px;
    cursor: pointer;
  }
  .search-clear:hover {
    border-color: #3a3a4a;
    color: #fff;
  }

  .section-title {
    font-size: 13px;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: #8a8aa0;
    font-weight: 600;
    margin: 0 0 14px;
  }

  .turn-panel {
    margin-bottom: 16px;
    padding: 14px 16px 16px;
    border-radius: 14px;
    border: 1px solid #2a2a38;
    background: #14141e;
  }
  .turn-panel:last-child {
    margin-bottom: 0;
  }
  .turn-panel.mafia {
    border-color: rgba(59, 130, 246, 0.45);
    background: linear-gradient(135deg, rgba(37, 99, 235, 0.18) 0%, rgba(20, 20, 30, 0.95) 55%);
    box-shadow: inset 3px 0 0 #3b82f6;
  }
  .turn-panel.mafiax2 {
    border-color: rgba(168, 85, 247, 0.5);
    background: linear-gradient(135deg, rgba(147, 51, 234, 0.2) 0%, rgba(20, 20, 30, 0.95) 55%);
    box-shadow: inset 3px 0 0 #a855f7;
  }
  .turn-panel.noturn {
    border-color: rgba(148, 163, 184, 0.35);
    background: linear-gradient(135deg, rgba(148, 163, 184, 0.1) 0%, rgba(20, 20, 30, 0.95) 55%);
    box-shadow: inset 3px 0 0 #94a3b8;
  }
  .turn-label {
    display: flex;
    align-items: center;
    gap: 8px;
    margin: 0 0 12px;
    font-family: 'Cinzel', serif;
    font-size: 15px;
    font-weight: 700;
    letter-spacing: 0.04em;
    color: #c8c8d8;
  }
  .turn-panel.mafia .turn-label {
    color: #93c5fd;
  }
  .turn-panel.mafiax2 .turn-label {
    color: #e9d5ff;
  }
  .turn-panel.noturn .turn-label {
    color: #cbd5e1;
  }
  .turn-dot {
    width: 9px;
    height: 9px;
    border-radius: 50%;
    background: #6a6a80;
    flex-shrink: 0;
  }
  .turn-panel.mafia .turn-dot {
    background: #3b82f6;
    box-shadow: 0 0 10px rgba(59, 130, 246, 0.7);
  }
  .turn-panel.mafiax2 .turn-dot {
    background: #a855f7;
    box-shadow: 0 0 10px rgba(168, 85, 247, 0.7);
  }
  .turn-panel.noturn .turn-dot {
    background: #94a3b8;
    box-shadow: 0 0 10px rgba(148, 163, 184, 0.5);
  }
  .turn-count {
    font-family: 'Inter', system-ui, sans-serif;
    font-size: 11px;
    font-weight: 600;
    color: inherit;
    opacity: 0.75;
    background: rgba(0, 0, 0, 0.25);
    border: 1px solid rgba(255, 255, 255, 0.12);
    border-radius: 999px;
    padding: 1px 8px;
    margin-left: 2px;
  }
  .turn-toggle {
    margin-left: auto;
    font-family: 'Inter', system-ui, sans-serif;
    font-size: 11px;
    font-weight: 600;
    color: inherit;
    background: rgba(0, 0, 0, 0.28);
    border: 1px solid rgba(255, 255, 255, 0.14);
    border-radius: 8px;
    padding: 4px 10px;
    cursor: pointer;
  }
  .turn-toggle:hover {
    background: rgba(255, 255, 255, 0.08);
  }
  .min-hint {
    margin: 10px 0 0;
    font-size: 12px;
    color: #8a8aa0;
  }

  section {
    margin-bottom: 34px;
  }

  .card-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
    gap: 12px;
  }
  .weekly-turn-grid {
    grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
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

  /* Modal kill */
  .kill-modal-overlay {
    position: fixed;
    inset: 0;
    z-index: 1000;
    display: flex;
    align-items: center;
    justify-content: center;
    background: rgba(0, 0, 0, 0.6);
    backdrop-filter: blur(4px);
  }
  .kill-modal {
    background: #1e1e2e;
    border: 1px solid #2a2a38;
    border-radius: 16px;
    padding: 24px;
    width: 340px;
    max-width: 92vw;
    display: flex;
    flex-direction: column;
    gap: 16px;
    box-shadow: 0 24px 48px rgba(0, 0, 0, 0.5);
  }
  .modal-title {
    margin: 0;
    font-family: 'Cinzel', serif;
    font-size: 16px;
    color: #f0eef7;
  }
  .modal-hint {
    margin: 0;
    font-size: 12px;
    color: #8a8aa0;
    line-height: 1.4;
  }
  .modal-fields {
    display: flex;
    flex-direction: column;
    gap: 12px;
  }
  .modal-label {
    display: flex;
    flex-direction: column;
    gap: 4px;
    font-size: 12px;
    color: #a8a8b8;
  }
  .modal-input {
    background: #12121c;
    border: 1px solid #3a3a52;
    border-radius: 8px;
    padding: 10px 12px;
    font-size: 14px;
    font-family: inherit;
    color: #f0eef7;
  }
  .modal-input:focus {
    outline: none;
    border-color: #6a5acd;
  }
  .modal-actions {
    display: flex;
    gap: 10px;
    margin-top: 4px;
  }
  .modal-cancel,
  .modal-confirm {
    flex: 1;
    padding: 10px;
    border-radius: 8px;
    font-size: 13px;
    font-weight: 600;
    cursor: pointer;
    border: none;
    font-family: inherit;
  }
  .modal-cancel {
    background: #2a2a38;
    color: #a8a8b8;
  }
  .modal-cancel:hover {
    background: #3a3a4a;
  }
  .modal-confirm {
    background: #d13a3a;
    color: #fff;
  }
  .modal-confirm:hover:not(:disabled) {
    background: #e04a4a;
  }
  .modal-confirm:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  /* Maintenance */
  .maintenance-banner {
    display: flex;
    align-items: flex-start;
    gap: 12px;
    margin-bottom: 20px;
    padding: 14px 16px;
    border-radius: 12px;
    background: rgba(224, 72, 60, 0.15);
    border: 1px solid rgba(224, 72, 60, 0.55);
    color: #ff8a7a;
    font-size: 14px;
    line-height: 1.5;
  }
  .maint-icon {
    font-size: 24px;
    flex-shrink: 0;
    line-height: 1.2;
  }
  .maint-text {
    flex: 1;
    min-width: 0;
  }
  .maint-text strong {
    color: #ffa090;
  }
  .maint-btn {
    display: inline-block;
    margin-top: 8px;
    background: #e0483c;
    border: none;
    color: #fff;
    padding: 7px 14px;
    border-radius: 8px;
    font-size: 12px;
    font-weight: 600;
    cursor: pointer;
    font-family: inherit;
  }
  .maint-btn:hover:not(:disabled) {
    background: #d04030;
  }
  .maint-btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
  .maint-btn.outline {
    background: transparent;
    border: 1px solid #e0483c;
    color: #ff8a7a;
  }
  .maint-btn.outline:hover:not(:disabled) {
    background: rgba(224, 72, 60, 0.15);
  }
  .maintenance-toggle {
    margin-bottom: 20px;
  }

  @media (max-width: 719px) {
    .clock {
      text-align: center;
      width: 100%;
    }
    .header-right {
      justify-content: center;
    }
  }

  @media (prefers-reduced-motion: reduce) {
    :global(*) {
      animation-duration: 0.01ms !important;
      animation-iteration-count: 1 !important;
    }
  }
</style>
