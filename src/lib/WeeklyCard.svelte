<script>
  import { nextSpawnFor, dayNameInZone } from './weeklyBossData.js'

  export let turn
  export let bosses = []
  export let now
  export let timeZone = 'Asia/Jakarta'
  export let tzLabel = 'WIB'
  export let minimized = true
  export let minCount = 4
  export let onToggleMinimize = null

  function formatCountdown(ms) {
    if (ms <= 0) return 'SPAWN!'
    const totalSec = Math.floor(ms / 1000)
    const h = Math.floor(totalSec / 3600)
    const m = Math.floor((totalSec % 3600) / 60)
    const s = totalSec % 60
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
  }

  function formatClock(date, zone, label) {
    return (
      new Date(date).toLocaleTimeString('id-ID', {
        timeZone: zone,
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
      }) +
      ' ' +
      label
    )
  }

  $: rows = bosses
    .map((boss) => {
      const nextSpawn = nextSpawnFor(boss, now)
      const msLeft = nextSpawn.getTime() - now.getTime()
      return {
        boss,
        nextSpawn,
        msLeft,
        dayLabel: dayNameInZone(nextSpawn, timeZone),
        clockLabel: formatClock(nextSpawn, timeZone, tzLabel),
      }
    })
    .sort((a, b) => a.msLeft - b.msLeft)

  $: next = rows[0]
  $: msLeft = next?.msLeft ?? 0
  $: isSoon = msLeft <= 10 * 60 * 1000 && msLeft > 0
  $: isUp = msLeft <= 0
  $: canMinimize = rows.length > minCount
  $: visibleRows = minimized && canMinimize ? rows.slice(0, minCount) : rows
  $: nextDetail = next ? `${next.dayLabel} ${next.clockLabel}` : ''
</script>

<article
  class="card"
  class:soon={isSoon}
  class:up={isUp}
  class:turn-mafia={turn === 'MAFIA'}
  class:turn-mafiax2={turn === 'MAFIAx2'}
>
  <div class="top">
    <h4>{turn}</h4>
    <span class="count">{bosses.length} boss</span>
  </div>
  {#if next}
    <div class="next-boss">Next: {next.boss.name}</div>
    <div class="countdown">{formatCountdown(msLeft)}</div>
    <div class="details">
      <span>Mingguan</span>
      <span>{nextDetail}</span>
    </div>
  {/if}
  <ul class="boss-list">
    {#each visibleRows as row (row.boss.id)}
      <li class:active={row.boss.id === next?.boss.id} class:soon-row={row.msLeft <= 10 * 60 * 1000 && row.msLeft > 0}>
        <span class="name">{row.boss.name}</span>
        <span class="when">{row.dayLabel} {row.clockLabel}</span>
      </li>
    {/each}
  </ul>
  {#if canMinimize}
    <button
      type="button"
      class="min-toggle"
      aria-expanded={!minimized}
      on:click={() => onToggleMinimize && onToggleMinimize()}
    >
      {minimized ? `Tampilkan semua (${rows.length})` : 'Minimize'}
    </button>
  {/if}
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
  .card.turn-mafia {
    border-left-color: #3b82f6;
    background: rgba(37, 99, 235, 0.1);
  }
  .card.turn-mafiax2 {
    border-left-color: #a855f7;
    background: rgba(147, 51, 234, 0.12);
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
    align-items: center;
    gap: 8px;
  }
  h4 {
    margin: 0;
    font-family: 'Cinzel', serif;
    font-size: 16px;
    color: #f0eef7;
    letter-spacing: 0.04em;
  }
  .count {
    font-size: 11px;
    color: #8a8aa0;
  }
  .next-boss {
    font-size: 12px;
    color: #c4b5fd;
    font-weight: 500;
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
  .details {
    display: flex;
    justify-content: space-between;
    gap: 8px;
    font-size: 11px;
    color: #8a8aa0;
  }
  .boss-list {
    list-style: none;
    margin: 4px 0 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  .boss-list li {
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
  .boss-list li.active {
    color: #e8e4ff;
    background: rgba(124, 92, 200, 0.18);
    border: 1px solid rgba(160, 140, 224, 0.35);
  }
  .boss-list li.soon-row {
    color: #f0b428;
    background: rgba(240, 180, 40, 0.1);
    border: 1px solid rgba(240, 180, 40, 0.35);
  }
  .name {
    font-weight: 500;
  }
  .when {
    font-family: 'JetBrains Mono', ui-monospace, monospace;
    font-variant-numeric: tabular-nums;
    font-size: 11px;
    font-weight: 600;
    white-space: nowrap;
  }
  .min-toggle {
    align-self: stretch;
    margin-top: 2px;
    font-size: 11px;
    font-weight: 600;
    color: #b8b8c8;
    background: rgba(0, 0, 0, 0.28);
    border: 1px solid rgba(255, 255, 255, 0.12);
    border-radius: 8px;
    padding: 6px 10px;
    cursor: pointer;
  }
  .min-toggle:hover {
    background: rgba(255, 255, 255, 0.08);
  }
</style>
