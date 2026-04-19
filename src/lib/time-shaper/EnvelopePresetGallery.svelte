<script lang="ts">
  import {
    TIME_SHAPER_ENVELOPE_PRESETS,
    sampleEnvelopePreset,
    type TimeShaperEnvelopePreset
  } from '$lib/runtime/time-shaper/envelopePresets';

  export let selectedId = 'easy_ease';
  export let onSelect: (id: string) => void = () => {};

  const sampleCount = 40;

  const buildPreviewCoordinates = (preset: TimeShaperEnvelopePreset): Array<{ x: number; y: number }> =>
    Array.from({ length: sampleCount }, (_, index) => {
      const xNorm = index / (sampleCount - 1);
      const yNorm = sampleEnvelopePreset(preset, xNorm);
      return {
        x: xNorm * 100,
        y: 92 - yNorm * 74,
      };
    });

  const toSmoothPath = (points: Array<{ x: number; y: number }>): string => {
    if (points.length === 0) return '';
    if (points.length === 1) return `M ${points[0].x} ${points[0].y}`;

    let path = `M ${points[0].x} ${points[0].y}`;
    for (let index = 0; index < points.length - 1; index += 1) {
      const current = points[index];
      const next = points[index + 1];
      const previous = points[index - 1] ?? current;
      const afterNext = points[index + 2] ?? next;
      const control1X = current.x + (next.x - previous.x) / 6;
      const control1Y = current.y + (next.y - previous.y) / 6;
      const control2X = next.x - (afterNext.x - current.x) / 6;
      const control2Y = next.y - (afterNext.y - current.y) / 6;
      path += ` C ${control1X} ${control1Y}, ${control2X} ${control2Y}, ${next.x} ${next.y}`;
    }
    return path;
  };

  const buildPreviewPath = (preset: TimeShaperEnvelopePreset): string =>
    toSmoothPath(buildPreviewCoordinates(preset));

  const buildPreviewFill = (preset: TimeShaperEnvelopePreset): string => {
    const points = buildPreviewCoordinates(preset);
    if (points.length === 0) return '';
    const line = toSmoothPath(points);
    const last = points[points.length - 1];
    return `${line} L ${last.x} 92 L 0 92 Z`;
  };
</script>

<div class="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-5 gap-1" data-testid="timeshaper-envelope-gallery">
  {#each TIME_SHAPER_ENVELOPE_PRESETS as preset}
    <button
      class="rounded-sm border p-1 text-left bg-surface-950 hover:bg-surface-900 transition-colors {preset.id === selectedId
        ? 'border-primary-500 shadow-[inset_0_0_0_1px_rgba(245,158,11,0.35)]'
        : 'border-surface-800'}"
      onclick={() => onSelect(preset.id)}
      title={preset.description}
      aria-pressed={preset.id === selectedId}
    >
      <div class="mb-1 flex items-start justify-between gap-2">
        <div>
          <span class="text-[0.55rem] font-bold uppercase tracking-[0.16em] text-surface-300">{preset.label}</span>
          <div class="text-[0.46rem] uppercase tracking-[0.16em] text-surface-500">{preset.mode.replace('_', ' ')}</div>
        </div>
        <span class="shrink-0 rounded-sm border border-surface-800 bg-surface-900 px-1 py-0.5 text-[0.48rem] text-surface-400 font-mono">{preset.defaultDurationBeats.toFixed(2)}b</span>
      </div>
      <svg class="w-full h-14 rounded-sm border border-surface-800 bg-surface-950" viewBox="0 0 100 100" preserveAspectRatio="none">
        <defs>
          <linearGradient id="envFill-{preset.id}" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stop-color="rgba(59,130,246,0.28)" />
            <stop offset="100%" stop-color="rgba(59,130,246,0.02)" />
          </linearGradient>
        </defs>
        <path d="M0 92 H100" stroke="rgba(148,163,184,0.14)" stroke-width="1" />
        <path d="M0 18 H100" stroke="rgba(203,213,225,0.05)" stroke-width="1" stroke-dasharray="2 2" />
        <path d="M0 55 H100" stroke="rgba(203,213,225,0.04)" stroke-width="1" stroke-dasharray="2 2" />
        <path d={buildPreviewFill(preset)} fill="url(#envFill-{preset.id})" stroke="none" />
        <path
          d={buildPreviewPath(preset)}
          fill="none"
          stroke="rgb(56,189,248)"
          stroke-width="1.45"
          stroke-linejoin="round"
          stroke-linecap="round"
        />
      </svg>
      <div class="mt-1 text-[0.5rem] text-surface-500 line-clamp-2">{preset.description}</div>
    </button>
  {/each}
</div>
