<script lang="ts">
  import { onMount } from "svelte";
  import {
    detectRuntimeCapabilities,
    getTempoState,
    listScheduledActions,
    nudgeBpm,
    popDueActions,
    queuePreviewAction,
    queueSectionMarkers,
    resyncDownbeat,
    setBpm,
    setDecodeBackend,
    setQuantization,
    setRendererBackend,
    tapBpm,
  } from "$lib/tauri/commands";
  import {
    activeSection,
    runtimeCapabilities,
    scheduledActions,
    tempoState,
  } from "$lib/stores/runtime";
  import type { DecodeBackend, RendererBackend } from "$lib/types/engine";
  import type { QuantizeGrid } from "$lib/types/timeline";

  const quantizeOptions: QuantizeGrid[] = [
    "1n",
    "1/2n",
    "1/4n",
    "1/8n",
    "1/16n",
  ];

  let bpmInput = 120;
  let selectedGrid: QuantizeGrid = "1/4n";
  let status = "Idle";

  const getErrorMessage = (error: unknown): string =>
    error instanceof Error ? error.message : "unknown error";

  const refresh = async () => {
    try {
      runtimeCapabilities.set(await detectRuntimeCapabilities());
      const tempo = await getTempoState();
      tempoState.set(tempo);
      bpmInput = Math.round(tempo.bpm * 100) / 100;
      scheduledActions.set(await listScheduledActions());
      status = "Runtime state synced";
    } catch (error) {
      status = `Runtime sync failed: ${getErrorMessage(error)}`;
    }
  };

  const applyBpm = async () => {
    try {
      tempoState.set(await setBpm(bpmInput));
      status = `BPM set to ${bpmInput.toFixed(2)}`;
    } catch (error) {
      status = `Set BPM failed: ${getErrorMessage(error)}`;
    }
  };

  const runTap = async () => {
    try {
      tempoState.set(await tapBpm(Date.now()));
      status = "Tap captured";
    } catch (error) {
      status = `Tap failed: ${getErrorMessage(error)}`;
    }
  };

  const queueMarkers = async () => {
    try {
      const count = await queueSectionMarkers($activeSection);
      scheduledActions.set(await listScheduledActions());
      status = `Queued ${count} markers from ${$activeSection}`;
    } catch (error) {
      status = `Queue section markers failed: ${getErrorMessage(error)}`;
    }
  };

  const switchDecode = async (event: Event) => {
    try {
      const backend = (event.currentTarget as HTMLSelectElement)
        .value as DecodeBackend;
      runtimeCapabilities.set(await setDecodeBackend(backend));
      status = `Decode backend set to ${backend}`;
    } catch (error) {
      status = `Set decode backend failed: ${getErrorMessage(error)}`;
    }
  };

  const switchRenderer = async (event: Event) => {
    try {
      const backend = (event.currentTarget as HTMLSelectElement)
        .value as RendererBackend;
      runtimeCapabilities.set(await setRendererBackend(backend));
      status = `Renderer backend set to ${backend}`;
    } catch (error) {
      status = `Set renderer backend failed: ${getErrorMessage(error)}`;
    }
  };

  const nudge = async (delta: number) => {
    try {
      tempoState.set(await nudgeBpm(delta));
      status = `Nudged BPM by ${delta > 0 ? "+" : ""}${delta}`;
    } catch (error) {
      status = `Nudge failed: ${getErrorMessage(error)}`;
    }
  };

  const flushDue = async () => {
    try {
      const due = await popDueActions(Date.now());
      scheduledActions.set(await listScheduledActions());
      status = `Dispatched ${due.length} due actions`;
    } catch (error) {
      status = `Pop due actions failed: ${getErrorMessage(error)}`;
    }
  };

  const queuePreview = async () => {
    try {
      await queuePreviewAction("trigger_clip", $activeSection, selectedGrid);
      scheduledActions.set(await listScheduledActions());
      status = "Queued preview trigger";
    } catch (error) {
      status = `Queue preview failed: ${getErrorMessage(error)}`;
    }
  };

  const applyGrid = async () => {
    try {
      await setQuantization(selectedGrid);
      status = `Quantize grid set to ${selectedGrid}`;
    } catch (error) {
      status = `Set quantization failed: ${getErrorMessage(error)}`;
    }
  };

  onMount(async () => {
    await refresh();
  });
</script>

<div
  class="h-full flex flex-col gap-1 bg-surface-900 border border-surface-800 rounded-md p-1 font-sans"
>
  <div
    class="flex-none flex items-center justify-between border-b border-surface-800 pb-1 mb-1"
  >
    <h2
      class="text-[0.65rem] font-bold uppercase tracking-widest text-surface-400 m-0"
    >
      Transport + Runtime
    </h2>
    <p class="text-[0.6rem] m-0 truncate text-primary-500">{status}</p>
  </div>

  <div class="flex flex-col gap-1 flex-1 text-[0.65rem]">
    <div
      class="flex flex-wrap gap-1 items-center bg-surface-950 p-1 border border-surface-800 rounded-sm"
    >
      <label class="text-surface-500 uppercase font-bold text-[0.55rem] w-8"
        >BPM</label
      >
      <input
        type="number"
        bind:value={bpmInput}
        min="20"
        max="300"
        step="0.01"
        class="w-14 bg-surface-900 border border-surface-700 text-surface-200 px-1 py-0.5 rounded-sm"
      />
      <button
        class="bg-primary-500/20 text-primary-500 border border-primary-500 hover:bg-primary-500 hover:text-surface-950 px-1.5 py-0.5 rounded-sm font-bold"
        on:click={applyBpm}>Set</button
      >
      <button
        class="bg-surface-800 border border-surface-700 hover:bg-surface-700 px-1.5 py-0.5 rounded-sm"
        on:click={runTap}>Tap</button
      >
      <button
        class="bg-surface-800 border border-surface-700 hover:bg-surface-700 px-1.5 py-0.5 rounded-sm"
        on:click={() => nudge(-0.1)}>-0.1</button
      >
      <button
        class="bg-surface-800 border border-surface-700 hover:bg-surface-700 px-1.5 py-0.5 rounded-sm"
        on:click={() => nudge(0.1)}>+0.1</button
      >
      <button
        class="bg-surface-800 border border-surface-700 hover:bg-surface-700 px-1.5 py-0.5 rounded-sm ml-auto"
        on:click={() =>
          resyncDownbeat(Date.now()).then((value) => tempoState.set(value))}
        >Resync</button
      >
    </div>

    <div
      class="flex flex-wrap gap-1 items-center bg-surface-950 p-1 border border-surface-800 rounded-sm"
    >
      <label class="text-surface-500 uppercase font-bold text-[0.55rem] w-8"
        >Qtz</label
      >
      <select
        bind:value={selectedGrid}
        class="bg-surface-900 border border-surface-700 text-surface-200 px-1 py-0.5 rounded-sm outline-none"
      >
        {#each quantizeOptions as option}
          <option value={option}>{option}</option>
        {/each}
      </select>
      <button
        class="bg-primary-500/20 text-primary-500 border border-primary-500 hover:bg-primary-500 hover:text-surface-950 px-1.5 py-0.5 rounded-sm font-bold"
        on:click={applyGrid}>Apply</button
      >
      <button
        class="bg-surface-800 border border-surface-700 hover:bg-surface-700 px-1.5 py-0.5 rounded-sm"
        on:click={queuePreview}>Preview</button
      >
      <button
        class="bg-primary-500/20 text-primary-500 border border-primary-500 hover:bg-primary-500 hover:text-surface-950 px-1.5 py-0.5 rounded-sm font-bold"
        on:click={queueMarkers}>Markers</button
      >
      <button
        class="bg-surface-800 border border-surface-700 hover:bg-surface-700 px-1.5 py-0.5 rounded-sm ml-auto"
        on:click={flushDue}>Pop</button
      >
    </div>

    <div
      class="flex flex-wrap gap-1 items-center bg-surface-950 p-1 border border-surface-800 rounded-sm"
    >
      <label class="text-surface-500 uppercase font-bold text-[0.55rem] w-8"
        >Rndr</label
      >
      <select
        value={$runtimeCapabilities.selectedDecode}
        on:change={switchDecode}
        class="bg-surface-900 border border-surface-700 text-surface-200 px-1 py-0.5 rounded-sm w-20 outline-none"
      >
        <option value="htmlvideo">htmlvideo</option>
        <option value="webcodecs" disabled={!$runtimeCapabilities.webcodecs}
          >webcodecs</option
        >
        <option
          value="native_ffmpeg"
          disabled={!$runtimeCapabilities.nativeFfmpeg}>native_ffmpeg</option
        >
      </select>
      <label class="text-surface-500 uppercase font-bold text-[0.55rem] ml-1"
        >GPU</label
      >
      <select
        value={$runtimeCapabilities.selectedRenderer}
        on:change={switchRenderer}
        class="bg-surface-900 border border-surface-700 text-surface-200 px-1 py-0.5 rounded-sm w-16 outline-none"
      >
        <option value="webgl2">webgl2</option>
        <option value="webgpu" disabled={!$runtimeCapabilities.webgpu}
          >webgpu</option
        >
      </select>
      <button
        class="bg-primary-500/20 text-primary-500 border border-primary-500 hover:bg-primary-500 hover:text-surface-950 px-1.5 py-0.5 rounded-sm font-bold ml-auto"
        on:click={refresh}>Refresh</button
      >
    </div>
  </div>

  <div
    class="flex-none flex flex-col gap-0.5 text-[0.55rem] text-surface-500 mt-1 uppercase tracking-tighter"
  >
    <div class="flex justify-between">
      <span
        >BPM {$tempoState.bpm.toFixed(2)} [{$tempoState.source}] Conf: {$tempoState.confidence.toFixed(
          2,
        )} Taps: {$tempoState.tapCount}</span
      >
      <span>Sec: <span class="text-surface-200">{$activeSection}</span></span>
    </div>
    <div class="flex justify-between">
      <span
        >FFmpeg: {$runtimeCapabilities.nativeFfmpeg ? "Yes" : "No"} Rust: {$runtimeCapabilities.rustFfmpegFeature
          ? "Yes"
          : "No"}</span
      >
      <span
        >Queue: <span class="text-surface-200">{$scheduledActions.length}</span
        ></span
      >
    </div>
  </div>
</div>
