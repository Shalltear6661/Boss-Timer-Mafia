<script>
  export let boss
  export let now

  $: nextSpawn = boss.lastDeath.getTime() + boss.spawnIntervalHours * 3600 * 1000
  $: msLeft = nextSpawn - now.getTime()
  $: isUp = msLeft <= 0
  $: isSoon = !isUp && msLeft <= 10 * 60 * 1000

  function formatCountdown(ms) {
    if (ms <= 0) return 'SPAWN!'
    const totalSec = Math.floor(ms / 1000)
    const h = Math.floor(totalSec / 3600)
    const m = Math.floor((totalSec % 3600) / 60)
    const s = totalSec % 60
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
  }

  function formatClock(date) {
    return (
      date.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit', hour12: false }) +
      ' WIB'
    )
  }
</script>

<article class="card" class:soon={isSoon} class:up={isUp}>
  <div class="top">
    <h4>{boss.name}</h4>
    <span class="lv">Lv {boss.level}</span>
  </div>
  <div class="countdown">{formatCountdown(msLeft)}</div>
  <div class="details">
    <span>Interval {boss.spawnIntervalHours}j</span>
    <span>Next {formatClock(new Date(nextSpawn))}</span>
  </div>
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
</style>
