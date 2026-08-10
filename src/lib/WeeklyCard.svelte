<script>
  import { nextSpawnFor, upcomingSchedules, dayName } from './weeklyBossData.js'

  export let boss
  export let now

  $: nextSpawn = nextSpawnFor(boss, now)
  $: msLeft = nextSpawn.getTime() - now.getTime()
  $: isSoon = msLeft <= 10 * 60 * 1000 && msLeft > 0
  $: isUp = msLeft <= 0
  $: scheduleRows = upcomingSchedules(boss, now)

  function formatCountdown(ms) {
    if (ms <= 0) return 'SPAWN!'
    const totalSec = Math.floor(ms / 1000)
    const h = Math.floor(totalSec / 3600)
    const m = Math.floor((totalSec % 3600) / 60)
    const s = totalSec % 60
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
  }

  function formatClock(date) {
    return date.toLocaleTimeString('id-ID', {
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    })
  }
</script>

<article class="card" class:soon={isSoon} class:up={isUp}>
  <div class="top">
    <h4>{boss.name}</h4>
    <span class="next-hint">Next {dayName(nextSpawn.getDay())} {formatClock(nextSpawn)}</span>
  </div>
  <div class="countdown">{formatCountdown(msLeft)}</div>
  <ul class="schedule-list">
    {#each scheduleRows as row, i (row.day + '-' + row.time)}
      <li class:primary={i === 0} class:soon-row={row.msLeft <= 10 * 60 * 1000 && row.msLeft > 0}>
        <span class="day">{dayName(row.day)} {row.time}</span>
        <span class="row-countdown">{formatCountdown(row.msLeft)}</span>
      </li>
    {/each}
  </ul>
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
  .card.up {
    border-left-color: #e0483c;
    background: rgba(224, 72, 60, 0.08);
  }
  .top {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
    gap: 8px;
  }
  h4 {
    margin: 0;
    font-family: 'Cinzel', serif;
    font-size: 15px;
    color: #f0eef7;
  }
  .next-hint {
    font-size: 11px;
    color: #8a8aa0;
    white-space: nowrap;
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
  .up .countdown {
    color: #ff6b6b;
  }
  .schedule-list {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  .schedule-list li {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 10px;
    font-size: 12px;
    color: #8a8aa0;
    padding: 5px 8px;
    border-radius: 7px;
    background: rgba(255, 255, 255, 0.03);
  }
  .schedule-list li.primary {
    color: #d4c4ff;
    background: rgba(124, 92, 200, 0.18);
    border: 1px solid rgba(160, 140, 224, 0.35);
  }
  .schedule-list li.soon-row {
    color: #f0b428;
    background: rgba(240, 180, 40, 0.1);
    border: 1px solid rgba(240, 180, 40, 0.35);
  }
  .day {
    font-weight: 500;
  }
  .row-countdown {
    font-family: 'JetBrains Mono', ui-monospace, monospace;
    font-variant-numeric: tabular-nums;
    font-size: 11.5px;
    font-weight: 600;
  }
</style>
