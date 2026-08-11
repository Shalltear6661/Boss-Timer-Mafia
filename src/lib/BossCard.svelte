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
  <div class="top">
    <h4>{boss.name}</h4>
    <span class="lv">Lv {boss.level}</span>
  </div>
  {#if boss.turn}
    <span class="turn-badge" class:mafia={boss.turn === 'MAFIA'} class:mafiax2={boss.turn === 'MAFIAx2'}>
      {boss.turn}
    </span>
  {/if}
  <div class="countdown">{formatCountdown(msLeft)}</div>
  <div class="details">
    <span>Interval {boss.spawnIntervalHours}j</span>
    <span>Next {nextClock}</span>
  </div>
  {#if showKill && onMarkKilled}
  <div class="actions">
    <button class="primary" disabled={killing} on:click={() => onMarkKilled(boss)}>
      {killing ? 'Menyimpan...' : 'Tandai Mati'}
    </button>
  </div>
  {/if}
</article>

<style>
  .card {
    background: #1a1a26;
    border: 1px solid #2a2a38;
    border-left: 3px solid #35354a;
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
    align-items: baseline;
  }
  h4 {
    margin: 0;
    font-family: 'Cinzel', serif;
    font-size: 15px;
    color: #f0eef7;
  }
  .turn-badge {
    align-self: flex-start;
    font-size: 10px;
    font-weight: 700;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    padding: 3px 9px;
    border-radius: 999px;
    background: #2a2a38;
    color: #a8a8b8;
    border: 1px solid transparent;
  }
  .turn-badge.mafia {
    background: rgba(59, 130, 246, 0.28);
    color: #bfdbfe;
    border-color: rgba(59, 130, 246, 0.5);
  }
  .turn-badge.mafiax2 {
    background: rgba(168, 85, 247, 0.3);
    color: #f3e8ff;
    border-color: rgba(168, 85, 247, 0.55);
  }
  .lv {
    font-size: 11px;
    color: #8a8aa0;
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
    font-size: 11.5px;
    color: #8a8aa0;
  }
  .actions {
    display: flex;
    gap: 8px;
    margin-top: 4px;
  }
  button {
    flex: 1;
    padding: 7px 8px;
    border-radius: 7px;
    font-size: 12px;
    cursor: pointer;
    border: none;
    font-family: inherit;
  }
  button:disabled {
    opacity: 0.6;
    cursor: wait;
  }
  .primary {
    background: #3a3a52;
    color: #eee;
  }
  .primary:hover:not(:disabled) {
    background: #47476a;
  }
</style>
