<script lang="ts">
  import type { TimeShaperTriggerEvent } from '$lib/midi/types';

  export let events: TimeShaperTriggerEvent[] = [];
  export let transportTime = 0;
  export let windowSeconds = 4;

  const visibleEvents = (): TimeShaperTriggerEvent[] =>
    events.filter((event) => event.startSeconds >= transportTime - windowSeconds && event.startSeconds <= transportTime + 0.25);

  const positionFor = (event: TimeShaperTriggerEvent): number =>
    ((event.startSeconds - (transportTime - windowSeconds)) / (windowSeconds + 0.25)) * 100;
</script>

<div class="relative h-14 rounded-sm border border-surface-800 bg-surface-950 overflow-hidden" data-testid="timeshaper-trigger-strip">
  <div class="absolute inset-0 bg-[linear-gradient(to_right,rgba(148,163,184,0.08)_1px,transparent_1px)] bg-[size:8%_100%]"></div>
  <div class="absolute inset-y-0 left-[80%] w-px bg-primary-500/60"></div>
  {#each visibleEvents() as event}
    <div class="absolute bottom-0 w-3 -translate-x-1/2" style={`left:${positionFor(event)}%`}>
      <div class="mx-auto h-9 w-[2px] rounded-full" style={`background:${event.color}`} title={event.label}></div>
      <div class="mx-auto mt-1 h-2 w-2 rounded-full border border-surface-950" style={`background:${event.color}`}></div>
    </div>
  {/each}
</div>
