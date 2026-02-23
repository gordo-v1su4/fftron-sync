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
    border: 1px solid var(--border);
    border-radius: 0.45rem;
    padding: 0.5rem;
    background: var(--surface-0);
  }

  .timeline-head {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
    margin-bottom: 0.3rem;
  }

  .timeline-head h3 {
    margin: 0;
    font-size: 0.82rem;
    text-transform: uppercase;
    letter-spacing: 0.03em;
  }

  .timeline-head p {
    margin: 0;
    color: var(--muted);
    font-size: 0.74rem;
  }

  .ruler {
    position: relative;
    height: 14px;
    border-radius: 0.32rem;
    background: var(--surface-2);
    border: 1px solid var(--border);
    overflow: hidden;
  }

  .progress {
    position: absolute;
    inset: 0 auto 0 0;
    background: linear-gradient(90deg, var(--accent), var(--accent-strong));
    opacity: 0.22;
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
    background: rgba(250, 250, 250, 0.14);
  }

  .marker {
    position: absolute;
    top: 1px;
    width: 2px;
    height: 10px;
    background: var(--accent-ok);
    transform: translateX(-1px);
  }

  .scrub {
    width: 100%;
    margin-top: 0.34rem;
  }

  .section-row {
    display: flex;
    flex-wrap: wrap;
    gap: 0.24rem;
    margin-top: 0.4rem;
  }

  .section-row button {
    border: 1px solid var(--border);
    border-radius: 0.32rem;
    background: var(--surface-2);
    color: var(--text);
    padding: 0.2rem 0.42rem;
    font-size: 0.66rem;
    font-weight: 600;
    cursor: pointer;
    text-transform: uppercase;
    letter-spacing: 0.02em;
  }

  .section-row button.active {
    background: var(--accent);
    border-color: var(--accent);
    color: #1a1408;
    font-weight: 600;
  }

  .quantize-row {
    display: flex;
    gap: 0.24rem;
    flex-wrap: wrap;
    margin-top: 0.34rem;
  }

  .quantize-row button {
    border: 1px solid var(--border);
    border-radius: 0.32rem;
    background: var(--surface-2);
    color: var(--text);
    padding: 0.2rem 0.42rem;
    font-size: 0.66rem;
    font-weight: 600;
    cursor: pointer;
  }

  .quantize-row button.active {
    background: var(--accent-ok);
    border-color: var(--accent-ok);
    color: #052e22;
    font-weight: 600;
  }
</style>
