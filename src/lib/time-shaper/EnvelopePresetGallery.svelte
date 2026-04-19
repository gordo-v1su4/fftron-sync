<script lang="ts">
  import {
    TIME_SHAPER_ENVELOPE_PRESETS,
    sampleEnvelopePreset,
    type TimeShaperEnvelopePreset
  } from '$lib/runtime/time-shaper/envelopePresets';

  export let selectedId = 'easy_ease';
  export let onSelect: (id: string) => void = () => {};

  const buildPreviewPoints = (preset: TimeShaperEnvelopePreset): string =>
    Array.from({ length: 24 }, (_, index) => {
      const xNorm = index / 23;
      const yNorm = sampleEnvelopePreset(preset, xNorm);
      return `${xNorm * 100},${96 - yNorm * 84}`;
    }).join(' ');
</script>

<div class="grid grid-cols-2 md:grid-cols-3 gap-1" data-testid="timeshaper-envelope-gallery">
  {#each TIME_SHAPER_ENVELOPE_PRESETS as preset}
    <button
      class="rounded-sm border p-1 text-left bg-surface-950 hover:bg-surface-900 transition-colors {preset.id === selectedId
        ? 'border-primary-500 shadow-[inset_0_0_0_1px_rgba(245,158,11,0.35)]'
        : 'border-surface-800'}"
      onclick={() => onSelect(preset.id)}
      title={preset.description}
      aria-pressed={preset.id === selectedId}
    >
      <div class="flex items-center justify-between mb-1">
        <span class="text-[0.55rem] font-bold uppercase tracking-[0.16em] text-surface-300">{preset.label}</span>
        <span class="text-[0.5rem] text-surface-500 font-mono">{preset.defaultDurationBeats.toFixed(2)}b</span>
      </div>
      <svg class="w-full h-14 rounded-sm border border-surface-800 bg-surface-950" viewBox="0 0 100 100" preserveAspectRatio="none">
        <path d="M0 96 H100" stroke="rgba(148,163,184,0.18)" stroke-width="1" />
        <polyline
          points={buildPreviewPoints(preset)}
          fill="none"
          stroke="rgb(56,189,248)"
          stroke-width="2.4"
          stroke-linejoin="round"
          stroke-linecap="round"
        />
      </svg>
      <div class="mt-1 text-[0.5rem] text-surface-500 line-clamp-2">{preset.description}</div>
    </button>
  {/each}
</div>
