<script lang="ts">
  import { activeSection, markers, midiTriggerStreams } from '$lib/stores/runtime';
  import { TIME_SHAPE_GESTURE_PRESETS } from '$lib/runtime/time-shaper/gesturePresets';
  import { pruneMidiEventsByDensity } from '$lib/midi/densityPruning';
  import { parseMidiFile } from '$lib/midi/parseMidi';
  import type { MidiTriggerStream } from '$lib/midi/types';

  const streamColors = ['#38bdf8', '#f59e0b', '#f472b6', '#a3e635', '#c084fc', '#fb7185'];
  let sectionOptions: string[] = [];

  $: sectionOptions = Array.from(
    new Set($markers.map((marker) => marker.section).filter((section) => section.length > 0))
  );

  const makeStreamId = (): string =>
    `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

  const nextColor = (index: number): string => streamColors[index % streamColors.length];

  const filteredCount = (stream: MidiTriggerStream): number => pruneMidiEventsByDensity(stream.events, stream.density).length;

  const updateStream = (id: string, mutate: (stream: MidiTriggerStream) => MidiTriggerStream) => {
    midiTriggerStreams.update((streams) => streams.map((stream) => (stream.id === id ? mutate(stream) : stream)));
  };

  const removeStream = (id: string) => {
    midiTriggerStreams.update((streams) => streams.filter((stream) => stream.id !== id));
  };

  const handleMidiUpload = async (event: Event) => {
    const input = event.currentTarget as HTMLInputElement;
    const files = Array.from(input.files ?? []).filter((file) => /\.(mid|midi)$/i.test(file.name));
    if (files.length === 0) return;

    const existingCount = $midiTriggerStreams.length;
    const parsed: MidiTriggerStream[] = [];

    for (const [index, file] of files.entries()) {
      try {
        const midi = parseMidiFile(await file.arrayBuffer(), file.name);
        parsed.push({
          id: makeStreamId(),
          name: file.name,
          color: nextColor(existingCount + index),
          visible: true,
          enabled: true,
          density: 1,
          offsetMs: 0,
          sectionTag: $activeSection || 'all',
          activeOnlyInSection: false,
          targetPresetId: TIME_SHAPE_GESTURE_PRESETS[0].id,
          trackFilter: 'all',
          durationSeconds: midi.durationSeconds,
          tracks: midi.tracks,
          events: midi.events,
          parseError: null
        });
      } catch (error) {
        parsed.push({
          id: makeStreamId(),
          name: file.name,
          color: nextColor(existingCount + index),
          visible: true,
          enabled: false,
          density: 1,
          offsetMs: 0,
          sectionTag: 'all',
          activeOnlyInSection: false,
          targetPresetId: TIME_SHAPE_GESTURE_PRESETS[0].id,
          trackFilter: 'all',
          durationSeconds: 0,
          tracks: [],
          events: [],
          parseError: error instanceof Error ? error.message : 'MIDI parse failed'
        });
      }
    }

    midiTriggerStreams.update((streams) => [...streams, ...parsed]);
    input.value = '';
  };
</script>

<div class="flex flex-col gap-1 rounded-sm border border-surface-800 bg-surface-950 p-1" data-testid="midi-trigger-panel">
  <div class="flex items-center justify-between gap-2">
    <div>
      <div class="text-[0.55rem] font-bold uppercase tracking-[0.16em] text-primary-400">MIDI Trigger Streams</div>
      <div class="text-[0.52rem] text-surface-500">Color-coded stems with density, routing, and section tags.</div>
    </div>
    <label class="btn btn-sm preset-filled-primary-500 text-[0.56rem] px-2 py-0.5 cursor-pointer">
      Add MIDI
      <input type="file" accept=".mid,.midi" multiple class="hidden" onchange={handleMidiUpload} />
    </label>
  </div>

  {#if $midiTriggerStreams.length === 0}
    <div class="rounded-sm border border-dashed border-surface-700 px-2 py-2 text-[0.55rem] text-surface-500">
      No MIDI streams loaded yet.
    </div>
  {/if}

  <div class="flex flex-col gap-1">
    {#each $midiTriggerStreams as stream}
      <div class="rounded-sm border border-surface-800 bg-surface-900 p-1 text-[0.55rem]">
        <div class="flex items-center gap-1 mb-1">
          <input type="color" value={stream.color} class="h-6 w-6 rounded-sm border border-surface-700 bg-transparent p-0"
            onchange={(event) => updateStream(stream.id, (entry) => ({ ...entry, color: (event.currentTarget as HTMLInputElement).value }))} />
          <button class="px-1.5 py-0.5 rounded-sm border {stream.visible ? 'border-primary-500 text-primary-300' : 'border-surface-700 text-surface-500'}"
            onclick={() => updateStream(stream.id, (entry) => ({ ...entry, visible: !entry.visible }))}>
            {stream.visible ? 'Shown' : 'Hidden'}
          </button>
          <label class="flex items-center gap-1 text-surface-400">
            <input type="checkbox" checked={stream.enabled}
              onchange={(event) => updateStream(stream.id, (entry) => ({ ...entry, enabled: (event.currentTarget as HTMLInputElement).checked }))} />
            Active
          </label>
          <div class="truncate text-surface-200 font-bold">{stream.name}</div>
          <button class="ml-auto text-surface-500 hover:text-error-400" onclick={() => removeStream(stream.id)}>✕</button>
        </div>

        {#if stream.parseError}
          <div class="rounded-sm border border-error-500/60 bg-error-500/10 px-2 py-1 text-error-200">{stream.parseError}</div>
        {:else}
          <div class="grid md:grid-cols-2 gap-1">
            <label class="flex flex-col gap-0.5">
              <span class="text-surface-500 uppercase">Track</span>
              <select value={stream.trackFilter} class="bg-surface-950 border border-surface-800 rounded-sm px-1 py-0.5"
                onchange={(event) => updateStream(stream.id, (entry) => ({ ...entry, trackFilter: (event.currentTarget as HTMLSelectElement).value }))}>
                <option value="all">All Tracks</option>
                {#each stream.tracks as track}
                  <option value={track.key}>{track.name} ({track.noteCount})</option>
                {/each}
              </select>
            </label>
            <label class="flex flex-col gap-0.5">
              <span class="text-surface-500 uppercase">Effect</span>
              <select value={stream.targetPresetId} class="bg-surface-950 border border-surface-800 rounded-sm px-1 py-0.5"
                onchange={(event) => updateStream(stream.id, (entry) => ({ ...entry, targetPresetId: (event.currentTarget as HTMLSelectElement).value }))}>
                {#each TIME_SHAPE_GESTURE_PRESETS as preset}
                  <option value={preset.id}>{preset.label}</option>
                {/each}
              </select>
            </label>
            <label class="flex flex-col gap-0.5">
              <span class="text-surface-500 uppercase">Section</span>
              <select value={stream.sectionTag} class="bg-surface-950 border border-surface-800 rounded-sm px-1 py-0.5"
                onchange={(event) => updateStream(stream.id, (entry) => ({ ...entry, sectionTag: (event.currentTarget as HTMLSelectElement).value }))}>
                <option value="all">All Sections</option>
                {#each sectionOptions as section}
                  <option value={section}>{section}</option>
                {/each}
              </select>
            </label>
            <label class="flex flex-col gap-0.5">
              <span class="text-surface-500 uppercase">Offset</span>
              <input type="number" step="1" value={stream.offsetMs} class="bg-surface-950 border border-surface-800 rounded-sm px-1 py-0.5"
                onchange={(event) => updateStream(stream.id, (entry) => ({ ...entry, offsetMs: Number((event.currentTarget as HTMLInputElement).value) || 0 }))} />
            </label>
          </div>

          <div class="mt-1 grid md:grid-cols-[1fr_auto_auto] gap-2 items-center">
            <label class="flex flex-col gap-0.5">
              <span class="text-surface-500 uppercase">Density {(stream.density * 100).toFixed(0)}%</span>
              <input type="range" min="0.05" max="1" step="0.05" value={stream.density}
                class="accent-primary-500"
                oninput={(event) => updateStream(stream.id, (entry) => ({ ...entry, density: Number((event.currentTarget as HTMLInputElement).value) || 1 }))} />
            </label>
            <label class="flex items-center gap-1 text-surface-400">
              <input type="checkbox" checked={stream.activeOnlyInSection}
                onchange={(event) => updateStream(stream.id, (entry) => ({ ...entry, activeOnlyInSection: (event.currentTarget as HTMLInputElement).checked }))} />
              Active only in tagged section
            </label>
            <div class="text-right text-surface-500 font-mono">
              {filteredCount(stream)} / {stream.events.length} events
            </div>
          </div>
        {/if}
      </div>
    {/each}
  </div>
</div>
