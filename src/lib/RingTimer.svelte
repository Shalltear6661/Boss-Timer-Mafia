<script>
  // pct: 0-100, seberapa jauh dari waktu 15 menit sebelum spawn (0 = 15 menit
  // lagi, 100 = waktunya spawn sekarang). color: warna aktif ring.
  export let pct = 0
  export let color = '#f0b428'
  export let size = 72
  export let thickness = 5
</script>

<div
  class="ring"
  style="
    --size: {size}px;
    --thickness: {thickness}px;
    --color: {color};
    --pct: {Math.max(0, Math.min(100, pct))};
  "
>
  <div class="ring-inner">
    <slot />
  </div>
</div>

<style>
  .ring {
    position: relative;
    width: var(--size);
    height: var(--size);
    border-radius: 50%;
    background: conic-gradient(var(--color) calc(var(--pct) * 1%), rgba(255, 255, 255, 0.09) 0);
    flex-shrink: 0;
  }
  .ring-inner {
    position: absolute;
    inset: var(--thickness);
    border-radius: 50%;
    background: #16161f;
    display: flex;
    align-items: center;
    justify-content: center;
  }
</style>
