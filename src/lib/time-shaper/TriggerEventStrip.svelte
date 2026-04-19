<script lang="ts">
  import type { TimeShaperTriggerEvent } from '$lib/midi/types';
  import type { EssentiaDetectedSection } from '$lib/stores/runtime';

  export let events: TimeShaperTriggerEvent[] = [];
  export let transportTime = 0;
  export let windowSeconds = 4;
  export let futureWindowSeconds = 0.25;
  export let sections: EssentiaDetectedSection[] = [];
  export let activeSection = '';

  const visibleEvents = (): TimeShaperTriggerEvent[] =>
    events.filter((event) => event.startSeconds >= transportTime - windowSeconds && event.startSeconds <= transportTime + futureWindowSeconds);

  const positionFor = (event: TimeShaperTriggerEvent): number =>
    ((event.startSeconds - (transportTime - windowSeconds)) / (windowSeconds + futureWindowSeconds)) * 100;

  const nowMarkerPercent = (): number => (windowSeconds / (windowSeconds + futureWindowSeconds)) * 100;

  const toShortSectionLabel = (section: EssentiaDetectedSection): string => {
    const source = (section.label || section.section || '').toLowerCase();
    if (source.startsWith('chor')) return 'CH';
    if (source.startsWith('verse')) return 'V';
    if (source.startsWith('bridge')) return 'B';
    if (source.startsWith('outro') || source.startsWith('outro')) return 'O';
    if (source.startsWith('intro')) return 'I';
    if (source.startsWith('drop')) return 'D';
    return source.slice(0, 2).toUpperCase() || '--';
  };

  const visibleSections = (): Array<{ left: number; width: number; label: string; active: boolean }> =>
    sections
      .map((section) => {
        const left = ((section.start - (transportTime - windowSeconds)) / (windowSeconds + futureWindowSeconds)) * 100;
        const right = ((section.end - (transportTime - windowSeconds)) / (windowSeconds + futureWindowSeconds)) * 100;
        return {
          left: Math.max(0, Math.min(100, left)),
          width: Math.max(0, Math.min(100, right) - Math.max(0, Math.min(100, left))),
          label: toShortSectionLabel(section),
          active: section.section === activeSection,
        };
      })
      .filter((section) => section.width > 1.5);
</script>

<div class="relative h-14 rounded-sm border border-surface-800 bg-surface-950 overflow-hidden" data-testid="timeshaper-trigger-strip">
  <div class="absolute inset-0 bg-[linear-gradient(to_right,rgba(203,213,225,0.08)_1px,transparent_1px)] bg-[size:12.5%_100%]"></div>
  <div class="absolute inset-0 bg-[linear-gradient(to_right,rgba(148,163,184,0.05)_1px,transparent_1px)] bg-[size:6.25%_100%]"></div>
  {#each visibleSections() as section}
    <div
      class="absolute inset-y-0 border-r border-surface-200/8 {section.active ? 'bg-primary-500/10' : 'bg-surface-200/[0.03]'}"
      style={`left:${section.left}%;width:${section.width}%`}
      aria-hidden="true"
    >
      <div class="absolute left-1 top-1 text-[0.45rem] font-bold uppercase tracking-[0.16em] {section.active ? 'text-primary-300' : 'text-surface-500'}">
        {section.label}
      </div>
    </div>
  {/each}
  <div class="absolute inset-y-0 w-px bg-primary-500/60" style={`left:${nowMarkerPercent()}%`}></div>
  {#each visibleEvents() as event}
    <div class="absolute bottom-0 w-3 -translate-x-1/2" style={`left:${positionFor(event)}%`}>
      <div class="mx-auto h-9 w-[2px] rounded-full" style={`background:${event.color}`} title={event.label}></div>
      <div class="mx-auto mt-1 h-2 w-2 rounded-full border border-surface-950" style={`background:${event.color}`}></div>
    </div>
  {/each}
</div>
