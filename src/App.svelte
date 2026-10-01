<script>
  import { onMount, onDestroy, tick } from 'svelte'
  import { initialBosses } from './lib/bossData.js'
  import { weeklyBosses as initialWeeklyBosses, nextSpawnFor } from './lib/weeklyBossData.js'
  import { fetchIntervalBosses, fetchWeeklyBosses, markBossKilled, fetchUnsoldLoots } from './lib/spreadsheet.js'
  import { submitCombatPower } from './lib/combatPower.js'
  import { ensureNotificationPermission, checkAndNotify, unlockAudio, playAlertSound, claimFromPushTag, isNotificationGranted, enableNotificationsWithPush, getNotificationPermission, isAudioUnlocked } from './lib/notifications.js'
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
    isUpdateCpWindowOpen,
    SOURCE_TZ,
  } from './lib/timezone.js'
  import { categorizeLoot, LOOT_CATEGORIES } from './lib/lootCategory.js'

  const STORAGE_KEY = 'boss-timer-data-v3'
  const WEEKLY_STORAGE_KEY = 'boss-timer-weekly-v4'
  const TURN_MIN_KEY = 'boss-timer-turn-min-v1'
  const TZ_STORAGE_KEY = 'boss-timer-tz-v1'
  const SYNC_INTERVAL_MS = 60 * 1000
  const MINIMIZED_BOSS_COUNT_MOBILE = 2
  const MINIMIZED_BOSS_COUNT_DESKTOP = 2
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
      const turn = boss._sheetTurn || boss.turn || ''
      await markBossKilled(boss.name, deathISO, turn)
      bosses = bosses.map((b) =>
        b.id === boss.id ? { ...b, lastDeath: deathDate } : b
      )
      persist()
      // Jangan sync penuh langsung — hemat quota Sheets (1 kill + 4 baca = mudah kena limit).
      // UI sudah di-update lokal; sync ringan setelah jeda singkat.
      setTimeout(() => {
        syncFromSpreadsheet().catch(() => {})
      }, 20_000)
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
  let notifDenied = typeof Notification !== 'undefined' && Notification.permission === 'denied'
  let soundReady = false
  let notifHint = ''
  let pushEnabled = false
  let pushSupported =
    typeof window !== 'undefined' &&
    'serviceWorker' in navigator &&
    'PushManager' in window
  let searchQuery = ''
  let searchOpen = false
  let searchInputEl
  let mainTab = 'jadwal' // 'jadwal' | 'loot' | 'cp'
  let lootItems = []
  let lootLoading = false
  let lootError = ''
  /** @type {Record<string, boolean>} accordion terbuka per kategori (default: terbuka) */
  let lootAccordionOpen = {}
  let cpGuild = 'MAFIA'
  let cpName = ''
  let cpPower = ''
  let cpFile = null
  let cpPreview = ''
  let cpSubmitting = false
  let cpMessage = ''
  let cpError = ''
  let cpDragOver = false
  let cpFileInputEl
  let turnMinimized = loadTurnMinimized()
  let tzId = loadTzId()
  let isMobile =
    typeof window !== 'undefined' && window.matchMedia
      ? window.matchMedia(MOBILE_MQ).matches
      : true
  let mobileMq

  async function onEnableNotifClick() {
    notifHint = ''
    const result = await enableNotificationsWithPush()
    notifEnabled = result.granted
    notifDenied = getNotificationPermission() === 'denied'
    pushEnabled = result.push
    soundReady = !!result.sound || isAudioUnlocked()
    if (result.reason === 'denied') {
      notifHint =
        'Izin notifikasi diblokir browser. Buka gembok URL → Site settings → Notifications → Allow, lalu refresh.'
    } else if (result.granted && !result.sound) {
      notifHint = 'Notifikasi aktif. Ketuk “Tes Suara” untuk dengar notif10 / notif5 / spawn.'
    } else if (result.granted && !result.push) {
      const hints = {
        vapid_missing:
          'Notifikasi aktif. Push belum siap: VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY belum terisi di Railway Variables (lalu Redeploy).',
        server_sync:
          'Notifikasi aktif. Push belum tersimpan ke server — cek sheet PushSubs + Service Account Editor.',
        service_worker:
          'Notifikasi aktif. Service Worker gagal (butuh HTTPS / jangan mode Incognito).',
        subscribe_failed:
          'Notifikasi aktif. Browser menolak subscribe push (coba hapus izin situs, lalu aktifkan lagi).',
        browser_unsupported:
          'Notifikasi aktif. Browser ini tidak support Web Push (iOS: pasang ke Home Screen).',
      }
      notifHint =
        hints[result.pushError] ||
        'Notifikasi aktif. Push belum siap — cek VAPID di Railway Variables.'
    }
  }

  async function onTestSoundClick() {
    // Putar berurutan: notif10 → notif5 → spawn
    const samples = [
      ['10', 'Boss'],
      ['5', 'Boss'],
      ['spawn', 'Boss'],
    ]
    let anyOk = false
    for (const [id, name] of samples) {
      const ok = await playAlertSound(id, name, { force: true })
      if (ok) anyOk = true
      // Tunggu clip selesai (file custom lebih panjang)
      const waitMs = id === '10' ? 4500 : id === '5' ? 8000 : 9000
      await new Promise((r) => setTimeout(r, waitMs))
    }
    soundReady = anyOk || isAudioUnlocked()
    notifHint = anyOk
      ? 'Suara OK: notif10 → notif5 → spawn.'
      : 'Gagal putar suara. Pastikan tab tidak di-mute dan izinkan Sound untuk situs ini.'
  }

  $: tzOption = getTimezoneOption(tzId)
  $: displayTimeZone = tzOption.tz
  $: tzLabel = tzOption.short
  $: minimizedBossCount = isMobile ? MINIMIZED_BOSS_COUNT_MOBILE : MINIMIZED_BOSS_COUNT_DESKTOP
  // Update CP: Jumat penuh (00–24) berdasarkan WIB agar sama untuk semua member
  $: cpTabOpen = isUpdateCpWindowOpen(now, SOURCE_TZ)
  $: if (!cpTabOpen && mainTab === 'cp') {
    mainTab = 'jadwal'
  }

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

  function toggleSearch() {
    searchOpen = !searchOpen
    if (searchOpen) {
      requestAnimationFrame(() => searchInputEl?.focus())
    }
  }

  function clearSearch() {
    searchQuery = ''
    searchOpen = false
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
        bosses = JSON.parse(raw).map((b) => ({ ...b, lastDeath: new Date(b.lastDeath), _sheetTurn: b._sheetTurn || b.turn || '' }))
      } catch (e) {
        console.error('Gagal load data tersimpan, pakai data awal', e)
        bosses = initialBosses.map((b) => ({ ...b, lastDeath: new Date(b.lastDeath), _sheetTurn: b.turn || '' }))
      }
    } else {
      bosses = initialBosses.map((b) => ({ ...b, lastDeath: new Date(b.lastDeath), _sheetTurn: b.turn || '' }))
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
  let weeklySyncTick = 0
  async function syncFromSpreadsheet() {
    if (syncing) return
    syncing = true
    try {
      // Weekly jarang berubah — sync tiap ~5 menit (5 × interval 60s), hemat quota baca.
      weeklySyncTick += 1
      const shouldSyncWeekly = weeklySyncTick === 1 || weeklySyncTick % 5 === 0

      const fetchedBosses = await fetchIntervalBosses()
      const fetchedWeekly = shouldSyncWeekly ? await fetchWeeklyBosses() : []

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

  async function syncLoots() {
    if (lootLoading) return
    lootLoading = true
    lootError = ''
    try {
      const { items, errors } = await fetchUnsoldLoots()
      lootItems = items
      if (errors?.length && items.length === 0) {
        lootError = errors.join('; ')
      }
    } catch (e) {
      console.warn('Gagal load loot:', e)
      lootError = e.message || 'Gagal load loot'
    } finally {
      lootLoading = false
    }
  }

  function setMainTab(tab) {
    if (tab === 'cp' && !isUpdateCpWindowOpen(new Date(), SOURCE_TZ)) {
      cpError = ''
      notifHint = 'Update CP hanya dibuka hari Jumat (00:00–24:00 WIB).'
      return
    }
    mainTab = tab
    if (tab === 'loot' && lootItems.length === 0 && !lootLoading) {
      syncLoots()
    }
  }

  function onCpFileChange(event) {
    const file = event.currentTarget?.files?.[0] || null
    applyCpFile(file)
  }

  function applyCpFile(file) {
    cpFile = file
    cpError = ''
    cpMessage = ''
    if (cpPreview) {
      try {
        URL.revokeObjectURL(cpPreview)
      } catch {
        /* ignore */
      }
    }
    cpPreview = file ? URL.createObjectURL(file) : ''
  }

  function clearCpScreenshot() {
    applyCpFile(null)
  }

  function onCpDrop(event) {
    event.preventDefault()
    cpDragOver = false
    const file = event.dataTransfer?.files?.[0]
    if (file) applyCpFile(file)
  }

  function formatCpInput(raw) {
    const digits = String(raw || '').replace(/[^\d]/g, '')
    if (!digits) return ''
    return Number(digits).toLocaleString('id-ID')
  }

  function onCpPowerInput(event) {
    const raw = event.currentTarget?.value || ''
    cpPower = formatCpInput(raw)
  }

  function clearCpForm(keepGuild = true) {
    if (!keepGuild) cpGuild = 'MAFIA'
    cpName = ''
    cpPower = ''
    applyCpFile(null)
  }

  async function onCpSubmit() {
    cpError = ''
    cpMessage = ''
    if (!cpGuild) {
      cpError = 'Pilih guild'
      return
    }
    if (!String(cpName).trim()) {
      cpError = 'Nama wajib diisi'
      return
    }
    const power = Number(String(cpPower).replace(/[^\d]/g, ''))
    if (!Number.isFinite(power) || power <= 0) {
      cpError = 'UpdateCP tidak valid'
      return
    }
    // Screenshot sementara dinonaktifkan
    // if (!cpFile) {
    //   cpError = 'Screenshot equip wajib'
    //   return
    // }
    cpSubmitting = true
    try {
      const result = await submitCombatPower({
        guild: cpGuild,
        ingameName: String(cpName).trim(),
        combatPower: power,
        // screenshotFile: cpFile,
      })
      cpMessage = result.updated
        ? `${cpName.trim()} di-update → ${result.combatPower} CP (${cpGuild}). Last Update: ${result.lastUpdate}`
        : `${cpName.trim()} ditambah → ${result.combatPower} CP (${cpGuild}). Last Update: ${result.lastUpdate}`
      clearCpForm(true)
    } catch (e) {
      cpError = e.message || 'Gagal submit combat power'
    } finally {
      cpSubmitting = false
    }
  }

  function load() {
    loadFromStorage()
    syncFromSpreadsheet()
  }

  function persist() {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify(bosses.map((b) => ({ ...b, lastDeath: b.lastDeath.toISOString(), _sheetTurn: b._sheetTurn })))
    )
  }

  function persistWeekly() {
    localStorage.setItem(WEEKLY_STORAGE_KEY, JSON.stringify(weeklyBossesList))
  }

  async function refreshFromSpreadsheet() {
    spreadsheetStatus = 'loading'
    if (mainTab === 'loot') {
      await syncLoots()
      spreadsheetStatus = lootError ? 'cache' : 'live'
    } else {
      await syncFromSpreadsheet()
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
      const turn = boss._sheetTurn || boss.turn || ''
      await markBossKilled(boss.name, deathISO, turn)
      bosses = bosses.map((b) =>
        b.id === boss.id ? { ...b, lastDeath: deathDate || new Date() } : b
      )
      persist()
      setTimeout(() => {
        syncFromSpreadsheet().catch(() => {})
      }, 20_000)
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
          'GOOGLE_OAUTH_CLIENT_ID belum di-set di .env / Railway (atau server belum di-restart/redeploy)'
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
  $: searching = searchNeedle.length > 0
  $: filteredLoots = lootItems
    .map((item) => {
      const cat = categorizeLoot(item.name)
      return { ...item, category: cat.id, categoryLabel: cat.label }
    })
    .filter(
      (item) =>
        matchesSearch(item.name) ||
        matchesSearch(item.holder) ||
        matchesSearch(item.turn) ||
        matchesSearch(item.categoryLabel)
    )
  $: lootTotalQty = filteredLoots.reduce((n, item) => n + (item.qty || 1), 0)
  $: lootGroups = (() => {
    const map = new Map()
    for (const item of filteredLoots) {
      const id = item.category || 'other'
      const label = item.categoryLabel || 'Lain-lain'
      if (!map.has(id)) {
        map.set(id, { id, label, items: [], qty: 0 })
      }
      const g = map.get(id)
      g.items.push(item)
      g.qty += item.qty || 1
    }
    const order = new Map(LOOT_CATEGORIES.map((c, i) => [c.id, i]))
    return [...map.values()].sort(
      (a, b) => (order.get(a.id) ?? 99) - (order.get(b.id) ?? 99)
    )
  })()
  $: searchHitCount =
    mainTab === 'loot'
      ? filteredLoots.length
      : bossesByTurn.reduce((n, [, bs]) => n + bs.length, 0) +
        weeklyTurnCards.reduce((n, g) => n + g.bosses.length, 0)

  function toggleLootGroup(id) {
    // default terbuka (undefined !== false); klik = tutup/buka
    const currentlyOpen = lootAccordionOpen[id] !== false
    lootAccordionOpen = {
      ...lootAccordionOpen,
      [id]: !currentlyOpen,
    }
  }

  // Kirim notifikasi browser saat milestone 10m / 5m / spawn
  $: if (bosses.length) {
    const watchList = [
      ...sortedBosses.map((b) => {
        const nextSpawn = b.lastDeath.getTime() + b.spawnIntervalHours * 3600 * 1000
        return {
          id: `ib-${b.turn || 'MAFIA'}-${b.id}`,
          name: b.name,
          msLeft: nextSpawn - now.getTime(),
        }
      }),
      ...sortedWeeklyBosses.map((b) => {
        const nextSpawn = nextSpawnFor(b, now)
        return {
          id: `wb-${b.turn || 'MAFIA'}-${b.id}`,
          name: b.name,
          msLeft: nextSpawn.getTime() - now.getTime(),
        }
      }),
    ]
    checkAndNotify(watchList)
  }

  onMount(async () => {
    load()
    if (ENABLE_MARK_KILLED) initAuth()
    else authReady = true
    notifEnabled = isNotificationGranted()
    notifDenied = getNotificationPermission() === 'denied'
    soundReady = isAudioUnlocked()
    // Re-subscribe push jika permission sudah granted (refresh / reopen)
    if (notifEnabled && pushSupported) {
      import('./lib/push.js')
        .then(({ subscribeToPush, isPushSubscribedLocally }) => {
          pushEnabled = isPushSubscribedLocally()
          return subscribeToPush()
        })
        .then((result) => {
          pushEnabled = !!result?.subscription
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
    const unlockOnce = async () => {
      const ok = await unlockAudio()
      soundReady = ok || isAudioUnlocked()
      window.removeEventListener('pointerdown', unlockOnce)
    }
    window.addEventListener('pointerdown', unlockOnce)

    // Web Push → tab terbuka: putar suara sesuai milestone (skip jika sudah di-fire lokal)
    const onSwMessage = (event) => {
      if (event.data?.type === 'PLAY_ALERT_SOUND' || event.data?.type === 'PUSH_RECEIVED') {
        const tag = event.data.payload?.tag || event.data.tag || ''
        // Local timer sering sudah putar dulu — jangan putar lagi dari push
        if (tag && !claimFromPushTag(tag)) return

        const milestone =
          event.data.milestone ||
          event.data.payload?.milestone ||
          (String(tag).endsWith('-spawn')
            ? 'spawn'
            : String(tag).endsWith('-5')
              ? '5'
              : String(tag).endsWith('-10')
                ? '10'
                : 'spawn')
        const bossName = event.data.bossName || event.data.payload?.bossName || ''
        playAlertSound(milestone, bossName)
      }
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
    <div class="header-brand">
      <img class="brand-mark brand-mark--desktop" src="/3551739.jpg" alt="Mafia Timer" width="40" height="40" />
      <h1 class="header-title">Mafia Timer</h1>
    </div>
    <div class="header-meta">
      <div class="header-tools">
        <img class="brand-mark brand-mark--mobile" src="/3551739.jpg" alt="Mafia Timer" width="40" height="40" />
        <div class="header-tools-actions">
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
          <button
            type="button"
            class="search-toggle"
            class:active={searchOpen || searching}
            on:click={toggleSearch}
            aria-label="Cari boss"
            aria-expanded={searchOpen}
            title="Cari boss"
          >
            <svg class="search-icon" viewBox="0 0 24 24" aria-hidden="true">
              <circle cx="11" cy="11" r="6.5" fill="none" stroke="currentColor" stroke-width="2" />
              <path d="M16.5 16.5L21 21" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" />
            </svg>
          </button>
        </div>
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
      <div class="clock header-clock">
        <div class="clock-time">
          {formatTimeInZone(now, displayTimeZone, { withSeconds: true })}
          <span class="tz-tag">{tzLabel}</span>
        </div>
        <div class="clock-date">{formatDateInZone(now, displayTimeZone)}</div>
      </div>
    </div>
    {#if searchOpen}
      <div class="header-search">
        <input
          type="search"
          class="search-input"
          placeholder="Cari boss / loot..."
          bind:value={searchQuery}
          bind:this={searchInputEl}
          autocomplete="off"
          spellcheck="false"
          on:keydown={(e) => e.key === 'Escape' && (searchOpen = false)}
        />
        {#if searching}
          <span class="search-meta">{searchHitCount} hasil</span>
          <button type="button" class="search-clear" on:click={clearSearch}>Hapus</button>
        {/if}
      </div>
    {/if}
  </header>

  {#if killError}
    <div class="kill-error">{killError}</div>
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
        Login Google di kanan atas untuk Tandai Mati (Editor).
      {:else}
        Login belum siap — set <code>GOOGLE_OAUTH_CLIENT_ID</code>.
      {/if}
    </div>
  {:else if ENABLE_MARK_KILLED && !canEdit}
    <div class="role-banner view">
      View-only: <strong>{user.email}</strong>
    </div>
  {/if}

  {#if notifDenied}
    <div class="notif-banner warn">
      <span>
        Notifikasi diblokir untuk situs ini. Di Chrome: gembok URL → Site settings → Notifications →
        <strong>Allow</strong>, lalu refresh halaman Railway.
      </span>
    </div>
  {:else if !notifEnabled && notifSupported}
    <div class="notif-banner">
      <span>Aktifkan notifikasi + suara agar alert spawn tetap muncul (termasuk saat minimize).</span>
      <button type="button" on:click={onEnableNotifClick}>Izinkan</button>
    </div>
  {:else if notifEnabled && pushSupported && !pushEnabled}
    <div class="notif-banner">
      <span>Aktifkan Web Push untuk notifikasi di background.</span>
      <button type="button" on:click={onEnableNotifClick}>Aktifkan Push</button>
      <button type="button" class="notif-secondary" on:click={onTestSoundClick}>Tes Suara</button>
    </div>
  {:else if notifEnabled && !soundReady}
    <div class="notif-banner">
      <span>Notifikasi aktif. Ketuk sekali untuk mengizinkan suara alert di browser ini.</span>
      <button type="button" on:click={onTestSoundClick}>Tes Suara</button>
    </div>
  {/if}
  {#if notifHint}
    <p class="notif-hint">{notifHint}</p>
  {/if}

  {#if searching && searchHitCount === 0}
    <p class="empty-hint search-empty">
      {#if mainTab === 'loot'}
        Tidak ada loot “{searchQuery.trim()}”.
      {:else}
        Tidak ada boss bernama “{searchQuery.trim()}”.
      {/if}
    </p>
  {/if}

  <nav class="app-tabs" aria-label="Menu utama">
    <button
      type="button"
      class="app-tab"
      class:active={mainTab === 'jadwal'}
      on:click={() => setMainTab('jadwal')}
    >
      Jadwal
    </button>
    <button
      type="button"
      class="app-tab"
      class:active={mainTab === 'loot'}
      on:click={() => setMainTab('loot')}
    >
      Loot
      {#if lootItems.length > 0}
        <span class="app-tab-count">{lootItems.reduce((n, i) => n + (i.qty || 1), 0)}</span>
      {/if}
    </button>
    <button
      type="button"
      class="app-tab"
      class:active={mainTab === 'cp'}
      class:locked={!cpTabOpen}
      disabled={!cpTabOpen}
      title={cpTabOpen ? 'Update Combat Power' : 'Hanya Jumat 00:00–24:00 WIB'}
      on:click={() => setMainTab('cp')}
    >
      Update CP
      {#if !cpTabOpen}
        <span class="app-tab-lock">Jumat</span>
      {/if}
    </button>
  </nav>
  {#if !cpTabOpen && mainTab !== 'cp'}
    <p class="cp-window-note">Update CP dibuka setiap <strong>Jumat 00:00–24:00 WIB</strong>.</p>
  {/if}

  {#if mainTab === 'jadwal'}
  <section>
    <h2 class="section-title cooldown">COOLDOWN</h2>
    {#if bossesByTurn.length === 0}
      <p class="empty-hint">
        {#if searching}
          Tidak ada field boss yang cocok.
        {:else}
          Belum ada data field boss tersedia.
        {/if}
      </p>
    {:else}
      <div class="turn-grid">
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
              {turnLabel === 'Tanpa Turn' ? 'Tanpa Turn' : turnLabel}
              <span class="turn-count">{turnBosses.length}</span>
              {#if turnBosses.length > minimizedBossCount}
                <button
                  type="button"
                  class="turn-toggle"
                  aria-expanded={!minimized}
                  on:click={() => toggleTurnMinimized(turnKey)}
                >
                  {minimized ? `Semua (${turnBosses.length})` : 'Minimize'}
                </button>
              {/if}
            </h3>
            <div class="card-grid turn-cards">
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
          </div>
        {/each}
      </div>
    {/if}
  </section>

  <section>
    <h2 class="section-title fixed-time">FIXED TIME</h2>
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
  {:else if mainTab === 'loot'}
  <section class="loot-section">
    <h2 class="section-title loot-title">Belum Terjual</h2>
    {#if lootLoading && lootItems.length === 0}
      <p class="empty-hint">Memuat loot...</p>
    {:else if lootError && lootItems.length === 0}
      <p class="empty-hint">{lootError}</p>
    {:else if filteredLoots.length === 0}
      <p class="empty-hint">
        {#if searching}
          Tidak ada loot yang cocok.
        {:else}
          Tidak ada barang belum terjual.
        {/if}
      </p>
    {:else}
      <p class="loot-meta">{lootTotalQty} item · {lootGroups.length} kategori · MAFIA + MAFIAx2</p>
      <div class="loot-accordions">
        {#each lootGroups as group (group.id)}
          {@const groupOpen = lootAccordionOpen[group.id] !== false}
          <div class="loot-acc" class:open={groupOpen}>
            <button
              type="button"
              class="loot-acc-head"
              aria-expanded={groupOpen}
              on:click={() => toggleLootGroup(group.id)}
            >
              <span class="loot-acc-chevron" aria-hidden="true">▸</span>
              <span class="loot-acc-label">{group.label}</span>
              <span class="loot-acc-count">{group.qty}</span>
            </button>
            {#if groupOpen}
              <ul class="loot-list">
                {#each group.items as item (item.id)}
                  <li
                    class="loot-row"
                    class:mafia={item.turn === 'MAFIA'}
                    class:mafiax2={item.turn === 'MAFIAx2'}
                  >
                    <div class="loot-main">
                      <span class="loot-name">{item.name}</span>
                      {#if item.qty > 1}
                        <span class="loot-qty">×{item.qty}</span>
                      {/if}
                    </div>
                    <div class="loot-side">
                      {#if item.holder}
                        <span class="loot-holder">{item.holder}</span>
                      {/if}
                      <span
                        class="loot-turn"
                        class:mafia={item.turn === 'MAFIA'}
                        class:mafiax2={item.turn === 'MAFIAx2'}
                      >
                        {item.turn}
                      </span>
                    </div>
                  </li>
                {/each}
              </ul>
            {/if}
          </div>
        {/each}
      </div>
    {/if}
  </section>
  {:else}
  <section class="cp-section">
    <h2 class="section-title cp-title">Update Combat Power</h2>

    <div class="cp-shell">
      <div class="cp-intro">
        <p class="cp-intro-title">Update CP karakter</p>
        <p class="cp-hint">
          Sesuai sheet <strong>Update CP</strong>: kolom <strong>Nama</strong> &amp; <strong>UpdateCP</strong>.
          Nama yang sudah ada akan di-update; yang baru ditambahkan. Tanggal <em>Last Update</em> ikut berubah.
        </p>
      </div>

      <form class="cp-form" on:submit|preventDefault={onCpSubmit}>
        <div class="cp-step">
          <span class="cp-step-num">1</span>
          <div class="cp-step-body">
            <span class="cp-label">Guild</span>
            <div class="cp-guild-toggle" role="group" aria-label="Pilih guild">
              <button
                type="button"
                class="cp-guild-btn mafia"
                class:active={cpGuild === 'MAFIA'}
                aria-pressed={cpGuild === 'MAFIA'}
                on:click={() => (cpGuild = 'MAFIA')}
              >
                <span class="cp-guild-dot"></span>
                MAFIA
              </button>
              <button
                type="button"
                class="cp-guild-btn mafiax2"
                class:active={cpGuild === 'MAFIAx2'}
                aria-pressed={cpGuild === 'MAFIAx2'}
                on:click={() => (cpGuild = 'MAFIAx2')}
              >
                <span class="cp-guild-dot"></span>
                MAFIAx2
              </button>
            </div>
          </div>
        </div>

        <div class="cp-step">
          <span class="cp-step-num">2</span>
          <div class="cp-step-body cp-grid-2">
            <label class="cp-field">
              <span class="cp-label">Nama</span>
              <input
                type="text"
                bind:value={cpName}
                placeholder="Sesuai kolom Nama di sheet"
                maxlength="40"
                required
                autocomplete="off"
              />
            </label>
            <label class="cp-field">
              <span class="cp-label">UpdateCP</span>
              <div class="cp-power-wrap">
                <input
                  type="text"
                  inputmode="numeric"
                  value={cpPower}
                  on:input={onCpPowerInput}
                  placeholder="151.165"
                  required
                  autocomplete="off"
                />
                <span class="cp-power-suffix">CP</span>
              </div>
            </label>
          </div>
        </div>

        <!-- Screenshot equip sementara dinonaktifkan
        <div class="cp-step">
          <span class="cp-step-num">3</span>
          <div class="cp-step-body">
            <span class="cp-label">Screenshot Equip</span>
            <input
              bind:this={cpFileInputEl}
              class="cp-file-native"
              type="file"
              accept="image/*"
              capture="environment"
              on:change={onCpFileChange}
            />
            {#if !cpPreview}
              <button
                type="button"
                class="cp-dropzone"
                class:dragover={cpDragOver}
                on:click={() => cpFileInputEl?.click()}
                on:dragover|preventDefault={() => (cpDragOver = true)}
                on:dragleave|preventDefault={() => (cpDragOver = false)}
                on:drop={onCpDrop}
              >
                <span class="cp-drop-icon" aria-hidden="true">⬆</span>
                <span class="cp-drop-title">Ketuk untuk upload</span>
                <span class="cp-drop-sub">atau drag &amp; drop gambar equip di sini</span>
                <span class="cp-drop-meta">JPG / PNG · otomatis dikompres</span>
              </button>
            {:else}
              <div class="cp-preview-card">
                <img class="cp-preview" src={cpPreview} alt="Preview screenshot equip" />
                <div class="cp-preview-bar">
                  <span class="cp-preview-name">{cpFile?.name || 'screenshot'}</span>
                  <div class="cp-preview-actions">
                    <button type="button" class="cp-preview-btn" on:click={() => cpFileInputEl?.click()}>
                      Ganti
                    </button>
                    <button type="button" class="cp-preview-btn danger" on:click={clearCpScreenshot}>
                      Hapus
                    </button>
                  </div>
                </div>
              </div>
            {/if}
          </div>
        </div>
        -->

        {#if cpError}
          <p class="cp-status error" role="alert">{cpError}</p>
        {/if}
        {#if cpMessage}
          <p class="cp-status ok" role="status">{cpMessage}</p>
        {/if}

        <button type="submit" class="cp-submit" disabled={cpSubmitting}>
          {#if cpSubmitting}
            <span class="cp-spinner" aria-hidden="true"></span>
            Menyimpan ke {cpGuild}…
          {:else}
            Simpan Combat Power
          {/if}
        </button>
      </form>
    </div>
  </section>
  {/if}

  <footer>
    <p class="footer-note">Sync spreadsheet tiap menit · Editor: Tandai Mati</p>
    <button class="link" on:click={refreshFromSpreadsheet} disabled={syncing}>
      {syncing ? 'Menyinkronkan...' : 'Refresh data'}
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
    max-width: 1100px;
    margin: 0 auto;
    padding: 22px 20px 56px;
  }

  header {
    display: grid;
    grid-template-columns: 1fr auto;
    align-items: center;
    gap: 10px;
    margin-bottom: 14px;
    padding-bottom: 12px;
    border-bottom: 1px solid #23232f;
  }
  .header-brand {
    display: flex;
    align-items: center;
    gap: 10px;
    min-width: 0;
  }
  .brand-mark {
    width: 40px;
    height: 40px;
    border-radius: 10px;
    object-fit: cover;
    flex-shrink: 0;
    box-shadow: 0 0 12px rgba(240, 180, 40, 0.35);
  }
  .brand-mark--mobile {
    display: none;
  }
  .header-title {
    font-family: 'Cinzel', serif;
    font-size: 20px;
    margin: 0;
    letter-spacing: 0.02em;
    background: linear-gradient(135deg, #fff, #c9b8ff);
    -webkit-background-clip: text;
    background-clip: text;
    color: transparent;
  }
  .brand-status {
    margin: 0;
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
  .header-meta {
    display: flex;
    align-items: center;
    gap: 14px;
    flex-wrap: wrap;
  }
  .header-tools {
    display: flex;
    align-items: center;
    gap: 6px;
  }
  .header-tools-actions {
    display: flex;
    align-items: center;
    gap: 6px;
  }
  .search-toggle {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 34px;
    height: 34px;
    padding: 0;
    border-radius: 10px;
    background: rgba(0, 0, 0, 0.35);
    border: 1px solid #2a2a38;
    color: #8a8aa0;
    cursor: pointer;
    flex-shrink: 0;
  }
  .search-toggle:hover {
    color: #d8d8e6;
    border-color: #4a4a68;
  }
  .search-toggle.active {
    color: #f0b428;
    border-color: rgba(240, 180, 40, 0.45);
    background: rgba(240, 180, 40, 0.12);
  }
  .search-icon {
    width: 16px;
    height: 16px;
    display: block;
  }
  .header-search {
    grid-column: 1 / -1;
    display: flex;
    align-items: center;
    gap: 8px;
    margin-top: 2px;
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
    font-size: 11px;
    color: #e8e0ff;
  }
  .role-banner {
    margin-bottom: 10px;
    padding: 7px 10px;
    border-radius: 8px;
    background: rgba(106, 90, 205, 0.12);
    border: 1px solid rgba(106, 90, 205, 0.35);
    color: #c8c0e8;
    font-size: 12px;
  }
  .role-banner.view {
    background: rgba(240, 180, 40, 0.08);
    border-color: rgba(240, 180, 40, 0.3);
    color: #c8b87f;
  }
  .clock-time {
    font-family: 'JetBrains Mono', monospace;
    font-size: 16px;
    font-weight: 700;
    color: #d8d8e6;
  }
  .clock-date {
    font-size: 10px;
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
    gap: 8px;
    margin-bottom: 12px;
    padding: 8px 10px;
    border-radius: 8px;
    background: rgba(106, 90, 205, 0.12);
    border: 1px solid rgba(106, 90, 205, 0.35);
    font-size: 12px;
    color: #c8c0e8;
  }
  .notif-banner.warn {
    background: rgba(180, 120, 40, 0.12);
    border-color: rgba(200, 140, 50, 0.45);
    color: #e8c48a;
  }
  .notif-banner button {
    background: #4a3a8a;
    border: none;
    color: #fff;
    padding: 6px 10px;
    border-radius: 6px;
    cursor: pointer;
    font-size: 11px;
    font-weight: 600;
    font-family: inherit;
  }
  .notif-banner button.notif-secondary {
    background: #2a3348;
    color: #d5dced;
  }
  .notif-banner button:hover {
    background: #5a48a8;
  }
  .notif-hint {
    margin: -4px 0 12px;
    font-size: 11px;
    color: #8a8aa0;
  }
  .empty-hint {
    margin: 0;
    font-size: 12px;
    color: #6a6a80;
  }
  .kill-error {
    margin-bottom: 10px;
    padding: 8px 10px;
    border-radius: 8px;
    background: rgba(224, 72, 60, 0.12);
    border: 1px solid rgba(224, 72, 60, 0.4);
    color: #ff8478;
    font-size: 12px;
  }

  .search-empty {
    margin-bottom: 12px;
    padding: 8px 10px;
    border-radius: 8px;
    background: rgba(255, 255, 255, 0.03);
    border: 1px dashed #2a2a38;
  }

  .search-input {
    flex: 1;
    min-width: 0;
    padding: 8px 10px;
    border-radius: 8px;
    border: 1px solid #2a2a38;
    background: #14141e;
    color: #eee;
    font-size: 13px;
    font-family: inherit;
    outline: none;
    transition: border-color 0.15s, box-shadow 0.15s;
  }
  .search-input::placeholder {
    color: #6a6a80;
  }
  .search-input:focus {
    border-color: rgba(160, 140, 224, 0.55);
    box-shadow: 0 0 0 2px rgba(124, 92, 200, 0.18);
  }
  .search-meta {
    font-size: 11px;
    color: #8a8aa0;
    white-space: nowrap;
  }
  .search-clear {
    border: 1px solid #2a2a38;
    background: #1a1a26;
    color: #c8c8d8;
    border-radius: 6px;
    padding: 6px 10px;
    font-size: 11px;
    cursor: pointer;
  }
  .search-clear:hover {
    border-color: #3a3a4a;
    color: #fff;
  }

  .turn-grid {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 14px;
    align-items: start;
  }
  .turn-panel {
    margin-bottom: 0;
    padding: 14px 14px 16px;
    border-radius: 14px;
    border: 1px solid #2a2a38;
    background: #14141e;
    min-width: 0;
  }
  .turn-panel.noturn {
    grid-column: 1 / -1;
    border-color: rgba(148, 163, 184, 0.35);
    background: linear-gradient(135deg, rgba(148, 163, 184, 0.1) 0%, rgba(20, 20, 30, 0.95) 55%);
    box-shadow: inset 3px 0 0 #94a3b8;
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
  .turn-label {
    display: flex;
    align-items: center;
    gap: 8px;
    margin: 0 0 12px;
    font-family: 'Cinzel', serif;
    font-size: 16px;
    font-weight: 700;
    letter-spacing: 0.03em;
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
    width: 7px;
    height: 7px;
    border-radius: 50%;
    background: #6a6a80;
    flex-shrink: 0;
  }
  .turn-panel.mafia .turn-dot {
    background: #3b82f6;
    box-shadow: 0 0 8px rgba(59, 130, 246, 0.7);
  }
  .turn-panel.mafiax2 .turn-dot {
    background: #a855f7;
    box-shadow: 0 0 8px rgba(168, 85, 247, 0.7);
  }
  .turn-panel.noturn .turn-dot {
    background: #94a3b8;
    box-shadow: 0 0 8px rgba(148, 163, 184, 0.5);
  }
  .turn-count {
    font-family: 'Inter', system-ui, sans-serif;
    font-size: 12px;
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
    font-size: 12px;
    font-weight: 600;
    color: inherit;
    background: rgba(0, 0, 0, 0.28);
    border: 1px solid rgba(255, 255, 255, 0.14);
    border-radius: 8px;
    padding: 5px 10px;
    cursor: pointer;
  }
  .turn-toggle:hover {
    background: rgba(255, 255, 255, 0.08);
  }

  section {
    margin-bottom: 28px;
  }

  .section-title {
    display: block;
    width: 100%;
    box-sizing: border-box;
    font-family: 'Cinzel', serif;
    font-size: 15px;
    text-transform: uppercase;
    letter-spacing: 0.12em;
    font-weight: 700;
    margin: 0 0 12px;
    padding: 11px 16px;
    border-radius: 10px;
    border: 1px solid transparent;
    text-align: center;
  }
  .section-title.cooldown {
    color: #fde68a;
    background: linear-gradient(
      135deg,
      rgba(240, 180, 40, 0.28) 0%,
      rgba(180, 100, 20, 0.12) 55%,
      rgba(20, 20, 30, 0.4) 100%
    );
    border-color: rgba(240, 180, 40, 0.4);
    box-shadow: inset 0 1px 0 rgba(255, 220, 120, 0.18);
  }
  .section-title.fixed-time {
    color: #e9d5ff;
    background: linear-gradient(
      135deg,
      rgba(168, 85, 247, 0.28) 0%,
      rgba(124, 58, 237, 0.12) 55%,
      rgba(20, 20, 30, 0.4) 100%
    );
    border-color: rgba(168, 85, 247, 0.42);
    box-shadow: inset 0 1px 0 rgba(200, 160, 255, 0.15);
  }
  .section-title.loot-title {
    color: #bbf7d0;
    background: linear-gradient(
      135deg,
      rgba(34, 197, 94, 0.24) 0%,
      rgba(22, 101, 52, 0.12) 55%,
      rgba(20, 20, 30, 0.4) 100%
    );
    border-color: rgba(34, 197, 94, 0.4);
    box-shadow: inset 0 1px 0 rgba(134, 239, 172, 0.15);
  }
  .section-title.cp-title {
    color: #fde68a;
    background: linear-gradient(
      135deg,
      rgba(245, 158, 11, 0.24) 0%,
      rgba(146, 64, 14, 0.12) 55%,
      rgba(20, 20, 30, 0.4) 100%
    );
    border-color: rgba(245, 158, 11, 0.4);
    box-shadow: inset 0 1px 0 rgba(253, 230, 138, 0.15);
  }

  .cp-shell {
    position: relative;
    border: 1px solid #2a2a38;
    border-radius: 16px;
    padding: 18px 16px 20px;
    background:
      radial-gradient(ellipse 80% 60% at 10% 0%, rgba(245, 158, 11, 0.1), transparent 55%),
      linear-gradient(165deg, #171722 0%, #12121a 100%);
    box-shadow: 0 12px 40px rgba(0, 0, 0, 0.28);
    overflow: hidden;
    animation: cp-enter 0.35s ease-out;
  }
  @keyframes cp-enter {
    from {
      opacity: 0;
      transform: translateY(8px);
    }
    to {
      opacity: 1;
      transform: translateY(0);
    }
  }
  .cp-intro {
    margin-bottom: 18px;
  }
  .cp-intro-title {
    margin: 0 0 6px;
    font-family: 'Cinzel', serif;
    font-size: 16px;
    font-weight: 700;
    letter-spacing: 0.04em;
    color: #f5f0e6;
  }
  .cp-hint {
    margin: 0;
    font-size: 13px;
    color: #9a9ab0;
    line-height: 1.5;
  }
  .cp-hint strong {
    color: #f0b428;
    font-weight: 600;
  }
  .cp-form {
    display: flex;
    flex-direction: column;
    gap: 16px;
  }
  .cp-step {
    display: grid;
    grid-template-columns: 28px 1fr;
    gap: 12px;
    align-items: start;
  }
  .cp-step-num {
    width: 28px;
    height: 28px;
    border-radius: 50%;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    font-family: 'JetBrains Mono', ui-monospace, monospace;
    font-size: 12px;
    font-weight: 700;
    color: #0f0f17;
    background: linear-gradient(145deg, #f0b428, #d97706);
    box-shadow: 0 0 12px rgba(240, 180, 40, 0.35);
    margin-top: 2px;
  }
  .cp-step-body {
    position: relative;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .cp-grid-2 {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 12px;
  }
  .cp-label {
    font-size: 11px;
    font-weight: 700;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: #a8a8bc;
  }
  .cp-field {
    display: flex;
    flex-direction: column;
    gap: 6px;
    min-width: 0;
  }
  .cp-field input {
    font-family: 'Inter', system-ui, sans-serif;
    font-size: 15px;
    font-weight: 500;
    color: #f0eef7;
    background: #0e0e16;
    border: 1px solid #2f2f40;
    border-radius: 12px;
    padding: 12px 14px;
    transition: border-color 0.15s ease, box-shadow 0.15s ease;
  }
  .cp-field input:focus {
    outline: none;
    border-color: rgba(240, 180, 40, 0.55);
    box-shadow: 0 0 0 3px rgba(240, 180, 40, 0.12);
  }
  .cp-power-wrap {
    position: relative;
  }
  .cp-power-wrap input {
    width: 100%;
    box-sizing: border-box;
    padding-right: 48px;
    font-family: 'JetBrains Mono', ui-monospace, monospace;
    font-weight: 700;
    letter-spacing: 0.02em;
  }
  .cp-power-suffix {
    position: absolute;
    right: 12px;
    top: 50%;
    transform: translateY(-50%);
    font-size: 11px;
    font-weight: 700;
    letter-spacing: 0.06em;
    color: #f0b428;
    pointer-events: none;
  }
  .cp-guild-toggle {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 8px;
  }
  .cp-guild-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 8px;
    min-height: 48px;
    padding: 10px 12px;
    border-radius: 12px;
    border: 1px solid #2f2f40;
    background: #0e0e16;
    color: #8a8aa0;
    font-family: 'Cinzel', serif;
    font-size: 13px;
    font-weight: 700;
    letter-spacing: 0.06em;
    cursor: pointer;
    transition: border-color 0.15s ease, background 0.15s ease, color 0.15s ease, transform 0.12s ease;
  }
  .cp-guild-btn:hover {
    color: #d8d8e6;
    border-color: #3a3a4a;
  }
  .cp-guild-btn:active {
    transform: scale(0.98);
  }
  .cp-guild-dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: #55556a;
  }
  .cp-guild-btn.mafia.active {
    color: #dbeafe;
    border-color: rgba(59, 130, 246, 0.55);
    background: linear-gradient(135deg, rgba(37, 99, 235, 0.28), rgba(14, 14, 22, 0.95));
    box-shadow: inset 0 1px 0 rgba(147, 197, 253, 0.2);
  }
  .cp-guild-btn.mafia.active .cp-guild-dot {
    background: #60a5fa;
    box-shadow: 0 0 8px rgba(96, 165, 250, 0.7);
  }
  .cp-guild-btn.mafiax2.active {
    color: #f3e8ff;
    border-color: rgba(168, 85, 247, 0.55);
    background: linear-gradient(135deg, rgba(147, 51, 234, 0.28), rgba(14, 14, 22, 0.95));
    box-shadow: inset 0 1px 0 rgba(216, 180, 254, 0.2);
  }
  .cp-guild-btn.mafiax2.active .cp-guild-dot {
    background: #c084fc;
    box-shadow: 0 0 8px rgba(192, 132, 252, 0.7);
  }
  .cp-file-native {
    position: absolute;
    width: 1px;
    height: 1px;
    opacity: 0;
    pointer-events: none;
  }
  .cp-dropzone {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 4px;
    width: 100%;
    min-height: 148px;
    padding: 20px 16px;
    border-radius: 14px;
    border: 1.5px dashed #3a3a4e;
    background: rgba(14, 14, 22, 0.85);
    color: #c8c8d8;
    cursor: pointer;
    text-align: center;
    transition: border-color 0.15s ease, background 0.15s ease, transform 0.12s ease;
  }
  .cp-dropzone:hover,
  .cp-dropzone.dragover {
    border-color: rgba(240, 180, 40, 0.65);
    background: rgba(240, 180, 40, 0.06);
  }
  .cp-dropzone.dragover {
    transform: scale(1.01);
  }
  .cp-drop-icon {
    font-size: 22px;
    color: #f0b428;
    margin-bottom: 4px;
  }
  .cp-drop-title {
    font-size: 14px;
    font-weight: 600;
    color: #f0eef7;
  }
  .cp-drop-sub {
    font-size: 12px;
    color: #8a8aa0;
  }
  .cp-drop-meta {
    margin-top: 6px;
    font-size: 11px;
    color: #6a6a80;
  }
  .cp-preview-card {
    border: 1px solid #2f2f40;
    border-radius: 14px;
    overflow: hidden;
    background: #0a0a12;
    animation: cp-enter 0.25s ease-out;
  }
  .cp-preview {
    display: block;
    width: 100%;
    max-height: 280px;
    object-fit: contain;
    background: #08080e;
  }
  .cp-preview-bar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
    padding: 10px 12px;
    border-top: 1px solid #2a2a38;
    background: #14141e;
  }
  .cp-preview-name {
    min-width: 0;
    font-size: 12px;
    color: #9a9ab0;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .cp-preview-actions {
    display: flex;
    gap: 6px;
    flex-shrink: 0;
  }
  .cp-preview-btn {
    border: 1px solid #35354a;
    border-radius: 8px;
    background: #1a1a26;
    color: #d8d8e6;
    font-size: 12px;
    font-weight: 600;
    padding: 6px 10px;
    cursor: pointer;
  }
  .cp-preview-btn:hover {
    background: #222230;
  }
  .cp-preview-btn.danger {
    color: #fca5a5;
    border-color: rgba(248, 113, 113, 0.35);
  }
  .cp-status {
    margin: 0;
    padding: 10px 12px;
    border-radius: 10px;
    font-size: 13px;
    line-height: 1.4;
  }
  .cp-status.error {
    color: #fecaca;
    background: rgba(239, 68, 68, 0.12);
    border: 1px solid rgba(239, 68, 68, 0.3);
  }
  .cp-status.ok {
    color: #bbf7d0;
    background: rgba(34, 197, 94, 0.12);
    border: 1px solid rgba(34, 197, 94, 0.3);
  }
  .cp-submit {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 10px;
    width: 100%;
    min-height: 50px;
    margin-top: 2px;
    border: 1px solid rgba(240, 180, 40, 0.5);
    border-radius: 12px;
    padding: 12px 16px;
    background: linear-gradient(135deg, rgba(240, 180, 40, 0.35), rgba(180, 100, 20, 0.18) 45%, rgba(20, 20, 30, 0.95));
    color: #fff7d6;
    font-family: 'Cinzel', serif;
    font-size: 13px;
    font-weight: 700;
    letter-spacing: 0.07em;
    text-transform: uppercase;
    cursor: pointer;
    box-shadow: 0 8px 24px rgba(240, 180, 40, 0.12);
    transition: transform 0.12s ease, filter 0.15s ease;
  }
  .cp-submit:hover:not(:disabled) {
    filter: brightness(1.08);
  }
  .cp-submit:active:not(:disabled) {
    transform: scale(0.985);
  }
  .cp-submit:disabled {
    opacity: 0.65;
    cursor: wait;
  }
  .cp-spinner {
    width: 14px;
    height: 14px;
    border-radius: 50%;
    border: 2px solid rgba(255, 247, 214, 0.25);
    border-top-color: #fff7d6;
    animation: cp-spin 0.7s linear infinite;
  }
  @keyframes cp-spin {
    to {
      transform: rotate(360deg);
    }
  }

  @media (max-width: 560px) {
    .cp-grid-2 {
      grid-template-columns: 1fr;
    }
    .cp-shell {
      padding: 16px 12px 18px;
    }
  }

  .app-tabs {
    display: grid;
    grid-template-columns: 1fr 1fr 1fr;
    gap: 8px;
    margin-bottom: 14px;
  }
  .app-tab {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 8px;
    padding: 10px 12px;
    border-radius: 10px;
    border: 1px solid #2a2a38;
    background: #14141e;
    color: #8a8aa0;
    font-family: 'Cinzel', serif;
    font-size: 13px;
    font-weight: 700;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    cursor: pointer;
  }
  .app-tab:hover {
    color: #d8d8e6;
    border-color: #3a3a4a;
  }
  .app-tab.active {
    color: #f0eef7;
    border-color: rgba(240, 180, 40, 0.45);
    background: linear-gradient(135deg, rgba(240, 180, 40, 0.18), rgba(20, 20, 30, 0.9));
  }
  .app-tab.locked,
  .app-tab:disabled {
    opacity: 0.45;
    cursor: not-allowed;
    color: #6a6a80;
  }
  .app-tab-lock {
    font-family: 'Inter', system-ui, sans-serif;
    font-size: 10px;
    font-weight: 600;
    letter-spacing: 0;
    text-transform: none;
    opacity: 0.9;
    background: rgba(0, 0, 0, 0.28);
    border: 1px solid rgba(255, 255, 255, 0.1);
    border-radius: 999px;
    padding: 1px 6px;
  }
  .cp-window-note {
    margin: -6px 0 12px;
    font-size: 12px;
    color: #8a8aa0;
    text-align: center;
  }
  .cp-window-note strong {
    color: #f0b428;
  }
  .app-tab-count {
    font-family: 'Inter', system-ui, sans-serif;
    font-size: 11px;
    font-weight: 600;
    letter-spacing: 0;
    text-transform: none;
    color: inherit;
    opacity: 0.8;
    background: rgba(0, 0, 0, 0.28);
    border: 1px solid rgba(255, 255, 255, 0.12);
    border-radius: 999px;
    padding: 1px 7px;
  }

  .loot-meta {
    margin: 0 0 10px;
    font-size: 12px;
    color: #8a8aa0;
  }
  .loot-accordions {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .loot-acc {
    border: 1px solid #2a2a38;
    border-radius: 12px;
    background: #14141e;
    overflow: hidden;
  }
  .loot-acc-head {
    width: 100%;
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 11px 12px;
    border: 0;
    background: transparent;
    color: #f0eef7;
    cursor: pointer;
    text-align: left;
    font-family: 'Cinzel', serif;
    font-size: 13px;
    font-weight: 700;
    letter-spacing: 0.05em;
    text-transform: uppercase;
  }
  .loot-acc-head:hover {
    background: rgba(255, 255, 255, 0.03);
  }
  .loot-acc-chevron {
    display: inline-flex;
    width: 1em;
    color: #f0b428;
    transition: transform 0.18s ease;
    font-size: 12px;
  }
  .loot-acc.open .loot-acc-chevron {
    transform: rotate(90deg);
  }
  .loot-acc-label {
    flex: 1;
    min-width: 0;
  }
  .loot-acc-count {
    font-family: 'Inter', system-ui, sans-serif;
    font-size: 11px;
    font-weight: 600;
    letter-spacing: 0;
    text-transform: none;
    color: #bbf7d0;
    background: rgba(34, 197, 94, 0.12);
    border: 1px solid rgba(34, 197, 94, 0.3);
    border-radius: 999px;
    padding: 2px 8px;
  }
  .loot-acc .loot-list {
    padding: 0 8px 8px;
  }
  .loot-list {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .loot-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
    padding: 10px 12px;
    border-radius: 10px;
    border: 1px solid #2a2a38;
    border-left: 3px solid #35354a;
    background: #1a1a26;
  }
  .loot-row.mafia {
    border-left-color: #3b82f6;
    background: rgba(37, 99, 235, 0.08);
  }
  .loot-row.mafiax2 {
    border-left-color: #a855f7;
    background: rgba(147, 51, 234, 0.1);
  }
  .loot-main {
    min-width: 0;
    display: flex;
    align-items: baseline;
    gap: 8px;
  }
  .loot-name {
    font-size: 14px;
    font-weight: 600;
    color: #f0eef7;
  }
  .loot-qty {
    font-family: 'JetBrains Mono', ui-monospace, monospace;
    font-size: 12px;
    font-weight: 700;
    color: #f0b428;
  }
  .loot-side {
    display: flex;
    align-items: center;
    gap: 8px;
    flex-shrink: 0;
  }
  .loot-holder {
    font-size: 11px;
    color: #8a8aa0;
    max-width: 110px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .loot-turn {
    font-size: 10px;
    font-weight: 700;
    letter-spacing: 0.04em;
    text-transform: uppercase;
    padding: 3px 8px;
    border-radius: 999px;
    border: 1px solid transparent;
  }
  .loot-turn.mafia {
    color: #93c5fd;
    background: rgba(59, 130, 246, 0.15);
    border-color: rgba(59, 130, 246, 0.35);
  }
  .loot-turn.mafiax2 {
    color: #e9d5ff;
    background: rgba(168, 85, 247, 0.15);
    border-color: rgba(168, 85, 247, 0.35);
  }

  .card-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(240px, 1fr));
    gap: 12px;
  }
  .turn-cards {
    grid-template-columns: 1fr;
    gap: 10px;
  }
  .weekly-turn-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 14px;
  }

  @media (max-width: 700px) {
    main {
      padding: 14px 12px 40px;
    }
    .turn-grid,
    .weekly-turn-grid {
      grid-template-columns: 1fr;
      gap: 8px;
    }
    .turn-panel {
      padding: 8px 10px 10px;
      border-radius: 10px;
    }
    .turn-label {
      font-size: 13px;
      margin: 0 0 8px;
      gap: 6px;
    }
    .turn-count {
      font-size: 10px;
      padding: 0 6px;
    }
    .turn-toggle {
      font-size: 10px;
      padding: 3px 8px;
      border-radius: 6px;
    }
    .section-title {
      font-size: 13px;
      letter-spacing: 0.1em;
      margin: 0 0 8px;
      padding: 8px 12px;
      border-radius: 8px;
    }
    section {
      margin-bottom: 16px;
    }
    .card-grid {
      gap: 8px;
    }
    .turn-cards {
      gap: 8px;
    }
  }

  footer {
    text-align: center;
    margin-top: 6px;
  }
  .footer-note {
    margin: 0 0 6px;
    font-size: 11px;
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

  @media (max-width: 719px) {
    header {
      display: flex;
      flex-direction: column;
      gap: 10px;
      text-align: center;
    }
    .header-brand {
      display: none;
    }
    .brand-mark--mobile {
      display: block;
      width: 34px;
      height: 34px;
    }
    .header-meta {
      flex-direction: column;
      width: 100%;
      gap: 10px;
    }
    .header-tools {
      justify-content: space-between;
      align-items: center;
      width: 100%;
      gap: 8px;
    }
    .auth-box {
      justify-content: center;
      width: 100%;
    }
    .header-clock {
      text-align: center;
      width: 100%;
    }
    .google-btn {
      margin: 0 auto;
    }
  }

  @media (prefers-reduced-motion: reduce) {
    :global(*) {
      animation-duration: 0.01ms !important;
      animation-iteration-count: 1 !important;
    }
  }
</style>
