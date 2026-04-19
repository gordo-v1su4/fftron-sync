<script lang="ts">
  import {
    TIME_SHAPER_ENVELOPE_PRESETS,
    sampleEnvelopePreset,
    type TimeShaperEnvelopePreset
  } from '$lib/runtime/time-shaper/envelopePresets';

  export let selectedId = 'easy_ease';
  export let onSelect: (id: string) => void = () => {};

  const sampleCount = 36;

  const buildPreviewCoordinates = (preset: TimeShaperEnvelopePreset): Array<{ x: number; y: number }> =>
    Array.from({ length: sampleCount }, (_, index) => {
      const xNorm = index / (sampleCount - 1);
      const yNorm = sampleEnvelopePreset(preset, xNorm);
      return {
        x: 8 + xNorm * 84,
        y: 42 - yNorm * 26,
      };
    });

  const buildKeyPoints = (preset: TimeShaperEnvelopePreset): Array<{ x: number; y: number }> =>
    preset.points.map((point) => ({
      x: 8 + point.x * 84,
      y: 42 - point.y * 26,
    }));

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
    return `${line} L ${last.x} 42 L 8 42 Z`;
  };

  const shortLabel = (label: string): string =>
    label
      .replace('Release', 'Rel')
      .replace('Attack', 'Atk')
      .replace('Linear', 'Lin')
      .replace('Sloped', 'Slp')
      .replace('Stepped', 'Step')
      .replace('Silence', 'Silent');
</script>

<div class="grid grid-cols-4 sm:grid-cols-5 md:grid-cols-6 xl:grid-cols-7 gap-x-2 gap-y-3" data-testid="timeshaper-envelope-gallery">
  {#each TIME_SHAPER_ENVELOPE_PRESETS as preset}
    <button
      class="group flex flex-col items-center gap-1.5 rounded-sm px-0.5 py-0.5 text-center transition-colors {preset.id === selectedId ? 'text-primary-200' : 'text-surface-400 hover:text-surface-200'}"
      onclick={() => onSelect(preset.id)}
      title={preset.description}
      aria-pressed={preset.id === selectedId}
    >
      <svg
        class="h-10 w-10 rounded-md border {preset.id === selectedId
          ? 'border-primary-500 bg-surface-900 shadow-[inset_0_0_0_1px_rgba(245,158,11,0.2)]'
          : 'border-surface-700 bg-surface-950 group-hover:border-surface-500'}"
        viewBox="0 0 50 50"
        preserveAspectRatio="xMidYMid meet"
        aria-label={preset.label}
      >
        <path d="M8 42 H42" stroke="rgba(203,213,225,0.08)" stroke-width="0.8" />
        <path d="M8 29 H42" stroke="rgba(203,213,225,0.05)" stroke-width="0.6" stroke-dasharray="2 2" />
        <path d={buildPreviewFill(preset)} fill="rgba(96,165,250,0.08)" stroke="none" />
        <path
          d={buildPreviewPath(preset)}
          fill="none"
          stroke={preset.id === selectedId ? 'rgb(96,165,250)' : 'rgba(167,139,250,0.92)'}
          stroke-width="1.1"
          stroke-linejoin="round"
          stroke-linecap="round"
        />
        {#each buildKeyPoints(preset) as point}
          <circle
            cx={point.x}
            cy={point.y}
            r="1.15"
            fill={preset.id === selectedId ? 'rgb(191,219,254)' : 'rgb(216,180,254)'}
            stroke="rgba(15,23,42,0.95)"
            stroke-width="0.55"
          />
        {/each}
      </svg>
      <div class="max-w-[4.5rem] text-[0.48rem] font-medium leading-tight {preset.id === selectedId ? 'text-primary-100' : 'text-surface-400'}">
        {shortLabel(preset.label)}
      </div>
    </button>
  {/each}
</div>
