<script>
  import { nextSpawnFor, dayNameInZone } from './weeklyBossData.js'

  export let turn
  export let bosses = []
  export let now
  export let timeZone = 'Asia/Jakarta'
  export let tzLabel = 'WIB'
  export let minimized = true
  export let minCount = 2
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
</script>

<article
  class="card"
  class:soon={isSoon}
  class:up={isUp}
  class:turn-mafia={turn === 'MAFIA'}
  class:turn-mafiax2={turn === 'MAFIAx2'}
>
  <div class="head">
    <div class="head-left">
      <h4>{turn}</h4>
      <span class="count">{bosses.length}</span>
    </div>
    {#if next}
      <div class="next-line">
        <span class="next-name">{next.boss.name}</span>
        <span class="countdown" class:soon-text={isSoon} class:up-text={isUp}>
          {formatCountdown(msLeft)}
        </span>
      </div>
    {/if}
  </div>

  <ul class="boss-list">
    {#each visibleRows as row (row.boss.id)}
      <li
        class:active={row.boss.id === next?.boss.id && !isSoon && !isUp}
        class:soon-row={row.msLeft <= 10 * 60 * 1000 && row.msLeft > 0}
        class:spawn-row={row.msLeft <= 0}
      >
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
      {minimized ? `Semua (${rows.length})` : 'Minimize'}
    </button>
  {/if}
</article>

<style>
  .card {
    background: #1a1a26;
    border: 1px solid #2a2a38;
    border-left: 4px solid #4a3a6a;
    border-radius: 12px;
    padding: 14px 16px;
    display: flex;
    flex-direction: column;
    gap: 10px;
  }
  .card.turn-mafia {
    border-left-color: #3b82f6;
    background: rgba(37, 99, 235, 0.08);
  }
  .card.turn-mafiax2 {
    border-left-color: #a855f7;
    background: rgba(147, 51, 234, 0.1);
  }
  .card.soon {
    border-color: rgba(240, 180, 40, 0.4);
    border-left-color: #f0b428;
    background: rgba(240, 180, 40, 0.08);
  }
  .card.up {
    border-color: rgba(224, 72, 60, 0.45);
    border-left-color: #e0483c;
    background: rgba(224, 72, 60, 0.1);
  }
  .head {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .head-left {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  h4 {
    margin: 0;
    font-family: 'Cinzel', serif;
    font-size: 17px;
    color: #f0eef7;
    letter-spacing: 0.03em;
  }
  .count {
    font-size: 12px;
    font-weight: 600;
    color: #8a8aa0;
    background: rgba(0, 0, 0, 0.25);
    border: 1px solid rgba(255, 255, 255, 0.1);
    border-radius: 999px;
    padding: 1px 8px;
    line-height: 18px;
  }
  .next-line {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 12px;
  }
  .next-name {
    font-size: 14px;
    color: #b8b0d8;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .countdown {
    font-family: 'JetBrains Mono', ui-monospace, monospace;
    font-size: 22px;
    font-weight: 700;
    font-variant-numeric: tabular-nums;
    color: #d8d8e6;
    flex-shrink: 0;
  }
  .countdown.soon-text {
    color: #f0b428;
  }
  .countdown.up-text {
    color: #ff6b6b;
  }
  .boss-list {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 5px;
  }
  .boss-list li {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 10px;
    font-size: 13px;
    color: #8a8aa0;
    padding: 7px 10px;
    border-radius: 8px;
    background: rgba(255, 255, 255, 0.03);
  }
  .boss-list li.active {
    color: #e8e4ff;
    background: rgba(124, 92, 200, 0.16);
  }
  .boss-list li.soon-row {
    color: #f0b428;
    background: rgba(240, 180, 40, 0.1);
  }
  .boss-list li.spawn-row {
    color: #ff6b6b;
    background: rgba(224, 72, 60, 0.12);
    font-weight: 600;
  }
  .name {
    font-weight: 500;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .when {
    font-family: 'JetBrains Mono', ui-monospace, monospace;
    font-variant-numeric: tabular-nums;
    font-size: 12px;
    font-weight: 600;
    white-space: nowrap;
    flex-shrink: 0;
  }
  .min-toggle {
    align-self: stretch;
    font-size: 12px;
    font-weight: 600;
    color: #a8a8b8;
    background: rgba(0, 0, 0, 0.25);
    border: 1px solid rgba(255, 255, 255, 0.1);
    border-radius: 8px;
    padding: 7px 10px;
    cursor: pointer;
  }
  .min-toggle:hover {
    background: rgba(255, 255, 255, 0.08);
  }

  @media (max-width: 700px) {
    .card {
      border-left-width: 3px;
      border-radius: 10px;
      padding: 9px 11px;
      gap: 5px;
    }
    .head {
      gap: 4px;
    }
    .head-left {
      gap: 6px;
    }
    h4 {
      font-size: 13px;
    }
    .count {
      font-size: 10px;
      padding: 0 6px;
      line-height: 16px;
    }
    .next-name {
      font-size: 11px;
    }
    .countdown {
      font-size: 15px;
    }
    .boss-list {
      gap: 3px;
    }
    .boss-list li {
      font-size: 11px;
      padding: 4px 7px;
      border-radius: 6px;
      gap: 8px;
    }
    .when {
      font-size: 10px;
    }
    .min-toggle {
      font-size: 10px;
      border-radius: 6px;
      padding: 4px 8px;
    }
  }
</style>
