<script lang="ts">
  import { activeSection, markers } from '$lib/stores/runtime';

  export let duration = 0;
  export let currentTime = 0;
  export let onSeek: (time: number) => void = () => {};
  export let autoSwitchEnabled = false;
  export let quantizeMode: 'beat' | 'bar' = 'beat';
  export let onToggleAutoSwitch: () => void = () => {};
  export let onSetQuantizeMode: (mode: 'beat' | 'bar') => void = () => {};

  const sections = ['intro', 'verse-a', 'chorus-a', 'bridge', 'outro'];

  const formatClock = (seconds: number): string => {
    if (!Number.isFinite(seconds) || seconds < 0) return '00:00';
    const mins = Math.floor(seconds / 60)
      .toString()
      .padStart(2, '0');
    const secs = Math.floor(seconds % 60)
      .toString()
      .padStart(2, '0');
    return `${mins}:${secs}`;
  };

  const scrub = (event: Event) => {
    const value = Number((event.currentTarget as HTMLInputElement).value);
    onSeek(value);
  };

  $: safeDuration = duration > 0 ? duration : 1;
  $: progress = Math.min(Math.max(currentTime / safeDuration, 0), 1) * 100;
  $: markerPositions = $markers.map((_, index) => ((index + 1) / ($markers.length + 1)) * 100);
</script>

<section class="timeline-shell">
  <header class="timeline-head">
    <h3>Timeline</h3>
    <p>{formatClock(currentTime)} / {formatClock(duration)}</p>
  </header>

  <div class="ruler">
    <div class="progress" style={`width:${progress}%`}></div>
    {#each markerPositions as position}
      <span class="marker" style={`left:${position}%`}></span>
    {/each}
    <div class="ticks">
      {#each Array.from({ length: 17 }) as _, index}
        <span class="tick" style={`left:${(index / 16) * 100}%`}></span>
      {/each}
    </div>
  </div>

  <input
    class="scrub"
    type="range"
    min="0"
    max={safeDuration}
    step="0.01"
    value={Math.min(currentTime, safeDuration)}
    on:input={scrub}
    aria-label="Timeline scrub"
  />

  <div class="section-row">
    {#each sections as section}
      <button
        class:active={$activeSection === section}
        on:click={() => activeSection.set(section)}
      >
        {section}
      </button>
    {/each}
  </div>

  <div class="quantize-row">
    <button class:active={autoSwitchEnabled} on:click={onToggleAutoSwitch}>
      {autoSwitchEnabled ? 'Auto On' : 'Auto Off'}
    </button>
    <button class:active={quantizeMode === 'beat'} on:click={() => onSetQuantizeMode('beat')}>Beat</button>
    <button class:active={quantizeMode === 'bar'} on:click={() => onSetQuantizeMode('bar')}>Bar</button>
  </div>
</section>

<style>
  .timeline-shell {
    border: 1px solid #3f3f46;
    border-radius: 0.7rem;
    padding: 0.75rem;
    background: #111113;
  }

  .timeline-head {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
    margin-bottom: 0.4rem;
  }

  .timeline-head h3 {
    margin: 0;
    font-size: 0.95rem;
  }

  .timeline-head p {
    margin: 0;
    color: #a1a1aa;
    font-size: 0.85rem;
  }

  .ruler {
    position: relative;
    height: 18px;
    border-radius: 0.45rem;
    background: #18181b;
    border: 1px solid #3f3f46;
    overflow: hidden;
  }

  .progress {
    position: absolute;
    inset: 0 auto 0 0;
    background: linear-gradient(90deg, #f59e0b, #fbbf24);
    opacity: 0.25;
  }

  .ticks {
    position: absolute;
    inset: 0;
  }

  .tick {
    position: absolute;
    top: 0;
    width: 1px;
    height: 100%;
    background: rgba(250, 250, 250, 0.18);
  }

  .marker {
    position: absolute;
    top: 1px;
    width: 2px;
    height: 14px;
    background: #10b981;
    transform: translateX(-1px);
  }

  .scrub {
    width: 100%;
    margin-top: 0.45rem;
  }

  .section-row {
    display: flex;
    flex-wrap: wrap;
    gap: 0.4rem;
    margin-top: 0.55rem;
  }

  .section-row button {
    border: 1px solid #3f3f46;
    border-radius: 0.45rem;
    background: #27272a;
    color: #f4f4f5;
    padding: 0.3rem 0.52rem;
    font-size: 0.78rem;
    cursor: pointer;
    text-transform: uppercase;
  }

  .section-row button.active {
    background: #f59e0b;
    border-color: #f59e0b;
    color: #1c1917;
    font-weight: 600;
  }

  .quantize-row {
    display: flex;
    gap: 0.35rem;
    flex-wrap: wrap;
    margin-top: 0.5rem;
  }

  .quantize-row button {
    border: 1px solid #3f3f46;
    border-radius: 0.4rem;
    background: #27272a;
    color: #f4f4f5;
    padding: 0.28rem 0.5rem;
    font-size: 0.76rem;
    cursor: pointer;
  }

  .quantize-row button.active {
    background: #10b981;
    border-color: #10b981;
    color: #052e22;
    font-weight: 600;
  }
</style>
