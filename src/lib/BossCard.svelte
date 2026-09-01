<script>
  export let boss
  export let now
  export let timeZone = 'Asia/Jakarta'
  export let tzLabel = 'WIB'
  export let onMarkKilled = null
  export let killing = false
  export let showKill = false

  $: nextSpawn = boss.lastDeath.getTime() + boss.spawnIntervalHours * 3600 * 1000
  $: msLeft = nextSpawn - now.getTime()
  $: isUp = msLeft <= 0
  $: isSoon = !isUp && msLeft <= 10 * 60 * 1000
  $: nextClock = formatClock(nextSpawn, timeZone, tzLabel)

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
</script>

<article
  class="card"
  class:soon={isSoon}
  class:up={isUp}
  class:turn-mafia={boss.turn === 'MAFIA'}
  class:turn-mafiax2={boss.turn === 'MAFIAx2'}
>
  <div class="row-main">
    <div class="identity">
      <h4>{boss.name}</h4>
      <span class="meta">Lv {boss.level} · {boss.spawnIntervalHours}j</span>
    </div>
    <div class="countdown" class:soon-text={isSoon} class:up-text={isUp}>
      {formatCountdown(msLeft)}
    </div>
  </div>
  <div class="row-sub">
    <span class="next">Next {nextClock}</span>
    {#if isUp}
      <span class="status up-status">SPAWN</span>
    {:else if isSoon}
      <span class="status soon-status">Soon</span>
    {/if}
    {#if showKill && onMarkKilled}
      <button class="kill" disabled={killing} on:click={() => onMarkKilled(boss)}>
        {killing ? '...' : 'Mati'}
      </button>
    {/if}
  </div>
</article>

<style>
  .card {
    background: #1a1a26;
    border: 1px solid #2a2a38;
    border-left: 3px solid #35354a;
    border-radius: 10px;
    padding: 8px 10px;
    display: flex;
    flex-direction: column;
    gap: 4px;
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
  .row-main {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 8px;
  }
  .identity {
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 1px;
  }
  h4 {
    margin: 0;
    font-family: 'Cinzel', serif;
    font-size: 13px;
    color: #f0eef7;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .meta {
    font-size: 10px;
    color: #7a7a90;
  }
  .countdown {
    font-family: 'JetBrains Mono', ui-monospace, monospace;
    font-size: 15px;
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
  .row-sub {
    display: flex;
    align-items: center;
    gap: 6px;
    min-height: 22px;
  }
  .next {
    flex: 1;
    min-width: 0;
    font-size: 10px;
    color: #8a8aa0;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .status {
    font-size: 9px;
    font-weight: 700;
    letter-spacing: 0.04em;
    text-transform: uppercase;
    padding: 2px 6px;
    border-radius: 999px;
    flex-shrink: 0;
  }
  .soon-status {
    color: #f0b428;
    background: rgba(240, 180, 40, 0.15);
    border: 1px solid rgba(240, 180, 40, 0.3);
  }
  .up-status {
    color: #ff6b6b;
    background: rgba(224, 72, 60, 0.18);
    border: 1px solid rgba(224, 72, 60, 0.35);
  }
  .kill {
    flex-shrink: 0;
    padding: 3px 8px;
    border-radius: 6px;
    font-size: 10px;
    font-weight: 600;
    cursor: pointer;
    border: none;
    font-family: inherit;
    background: #3a3a52;
    color: #eee;
  }
  .kill:hover:not(:disabled) {
    background: #47476a;
  }
  .kill:disabled {
    opacity: 0.6;
    cursor: wait;
  }
</style>
