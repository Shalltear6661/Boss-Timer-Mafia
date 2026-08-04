<script>
  import RingTimer from './RingTimer.svelte'

  export let name
  export let meta
  export let msLeft
  export let isUp
  export let canMarkKilled = false
  export let onMarkKilled = null
  export let killing = false

  const SOON_WINDOW = 10 * 60 * 1000

  $: urgency =
    isUp || msLeft <= 0 ? 'spawn' : msLeft <= 5 * 60 * 1000 ? 'critical' : 'warn'
  $: pct = isUp || msLeft <= 0 ? 100 : 100 - Math.max(0, Math.min(100, (msLeft / SOON_WINDOW) * 100))
  $: ringColor = urgency === 'spawn' ? '#e0483c' : urgency === 'critical' ? '#ff6b35' : '#f0b428'

  function formatCountdown(ms) {
    if (ms <= 0) return 'SPAWN'
    const totalSec = Math.floor(ms / 1000)
    const m = Math.floor(totalSec / 60)
    const s = totalSec % 60
    return `${m}:${String(s).padStart(2, '0')}`
  }

  function urgencyLabel() {
    if (urgency === 'spawn') return 'Sudah Waktunya'
    if (urgency === 'critical') return '5 Menit Lagi'
    return '10 Menit Lagi'
  }
</script>

<article class="card" class:spawn={urgency === 'spawn'} class:critical={urgency === 'critical'} class:warn={urgency === 'warn'}>
  <RingTimer pct={pct} color={ringColor} size={96} thickness={7}>
    <span class="ring-label">{isUp || msLeft <= 0 ? '⚔' : formatCountdown(msLeft)}</span>
  </RingTimer>
  <div class="info">
    <div class="eyebrow">{urgencyLabel()}</div>
    <h3>{name}</h3>
    <p class="meta">{meta}</p>
    {#if !(isUp || msLeft <= 0)}
      <p class="countdown-big">{formatCountdown(msLeft)}</p>
    {:else}
      <p class="countdown-big spawn-text">SPAWN SEKARANG</p>
    {/if}
    {#if canMarkKilled && onMarkKilled}
      <button class="kill-btn" disabled={killing} on:click={onMarkKilled}>
        {killing ? 'Menyimpan...' : 'Tandai Mati'}
      </button>
    {/if}
  </div>
</article>

<style>
  .card {
    display: flex;
    align-items: center;
    gap: 22px;
    padding: 22px 26px;
    border-radius: 18px;
    min-height: 120px;
  }
  .card.warn {
    background: linear-gradient(155deg, rgba(240, 180, 40, 0.18), rgba(22, 22, 31, 0.95));
    border: 1px solid rgba(240, 180, 40, 0.45);
    box-shadow: 0 0 32px -6px rgba(240, 180, 40, 0.5);
    animation: glow-gold 2.2s ease-in-out infinite;
  }
  .card.critical {
    background: linear-gradient(155deg, rgba(255, 107, 53, 0.22), rgba(22, 22, 31, 0.95));
    border: 1px solid rgba(255, 107, 53, 0.55);
    box-shadow: 0 0 36px -4px rgba(255, 107, 53, 0.6);
    animation: glow-orange 1.4s ease-in-out infinite;
  }
  .card.spawn {
    background: linear-gradient(155deg, rgba(224, 72, 60, 0.28), rgba(22, 22, 31, 0.95));
    border: 1px solid rgba(224, 72, 60, 0.65);
    box-shadow: 0 0 40px -2px rgba(224, 72, 60, 0.7);
    animation: glow-red 0.9s ease-in-out infinite;
  }
  @keyframes glow-gold {
    0%, 100% { box-shadow: 0 0 22px -8px rgba(240, 180, 40, 0.4); }
    50% { box-shadow: 0 0 36px -4px rgba(240, 180, 40, 0.7); }
  }
  @keyframes glow-orange {
    0%, 100% { box-shadow: 0 0 22px -6px rgba(255, 107, 53, 0.45); }
    50% { box-shadow: 0 0 40px -2px rgba(255, 107, 53, 0.8); }
  }
  @keyframes glow-red {
    0%, 100% { box-shadow: 0 0 22px -4px rgba(224, 72, 60, 0.5); transform: scale(1); }
    50% { box-shadow: 0 0 44px 0 rgba(224, 72, 60, 0.85); transform: scale(1.01); }
  }
  .ring-label {
    font-family: 'JetBrains Mono', ui-monospace, monospace;
    font-size: 16px;
    font-weight: 700;
    color: #fff;
    font-variant-numeric: tabular-nums;
  }
  .info {
    min-width: 0;
    flex: 1;
  }
  .eyebrow {
    font-size: 11px;
    letter-spacing: 0.1em;
    text-transform: uppercase;
    color: #f0b428;
    font-weight: 700;
  }
  .critical .eyebrow {
    color: #ff8c5a;
  }
  .spawn .eyebrow {
    color: #ff8478;
  }
  h3 {
    font-family: 'Cinzel', serif;
    font-size: 26px;
    margin: 4px 0 4px;
    color: #f4f1fa;
    line-height: 1.15;
  }
  .meta {
    margin: 0;
    font-size: 13px;
    color: #a3a3b8;
  }
  .countdown-big {
    margin: 10px 0 0;
    font-family: 'JetBrains Mono', ui-monospace, monospace;
    font-size: 28px;
    font-weight: 700;
    font-variant-numeric: tabular-nums;
    color: #f0b428;
  }
  .critical .countdown-big {
    color: #ff8c5a;
  }
  .spawn-text {
    color: #ff6b6b !important;
    letter-spacing: 0.04em;
  }
  .kill-btn {
    margin-top: 12px;
    background: #3a3a52;
    border: none;
    color: #eee;
    padding: 8px 14px;
    border-radius: 8px;
    font-size: 12px;
    font-weight: 600;
    cursor: pointer;
    font-family: inherit;
  }
  .kill-btn:hover:not(:disabled) {
    background: #47476a;
  }
  .kill-btn:disabled {
    opacity: 0.6;
    cursor: wait;
  }
</style>
