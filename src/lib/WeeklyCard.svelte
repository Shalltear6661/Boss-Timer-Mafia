<script>
  import { nextSpawnFor, dayName } from './weeklyBossData.js'

  export let boss
  export let now

  $: nextSpawn = nextSpawnFor(boss, now)
  $: msLeft = nextSpawn.getTime() - now.getTime()
  $: isSoon = msLeft <= 10 * 60 * 1000 && msLeft > 0

  function formatCountdown(ms) {
    if (ms <= 0) return 'SPAWN!'
    const totalSec = Math.floor(ms / 1000)
    const h = Math.floor(totalSec / 3600)
    const m = Math.floor((totalSec % 3600) / 60)
    const s = totalSec % 60
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
  }

  function formatSchedule(s) {
    return `${dayName(s.day)} ${s.time}`
  }

  function formatNext(date) {
    return `${dayName(date.getDay())} ${date.toLocaleTimeString('id-ID', {
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    })}`
  }
</script>

<article class="card" class:soon={isSoon}>
  <div class="top">
    <h4>{boss.name}</h4>
  </div>
  <div class="countdown">{formatCountdown(msLeft)}</div>
  <div class="details">
    <span class="schedule">{boss.schedules.map(formatSchedule).join(' / ')}</span>
    <span>Next {formatNext(nextSpawn)}</span>
  </div>
</article>

<style>
  .card {
    background: #1a1a26;
    border: 1px solid #2a2a38;
    border-left: 3px solid #4a3a6a;
    border-radius: 12px;
    padding: 14px 16px;
    display: flex;
    flex-direction: column;
    gap: 8px;
    transition: border-color 0.2s, background 0.2s;
  }
  .card.soon {
    border-left-color: #f0b428;
    background: rgba(240, 180, 40, 0.06);
  }
  .top {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
  }
  h4 {
    margin: 0;
    font-family: 'Cinzel', serif;
    font-size: 15px;
    color: #f0eef7;
  }
  .countdown {
    font-family: 'JetBrains Mono', ui-monospace, monospace;
    font-size: 22px;
    font-weight: 700;
    font-variant-numeric: tabular-nums;
    color: #d8d8e6;
  }
  .soon .countdown {
    color: #f0b428;
  }
  .details {
    display: flex;
    justify-content: space-between;
    font-size: 11.5px;
    color: #8a8aa0;
    gap: 8px;
  }
  .schedule {
    color: #a08ce0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
</style>
