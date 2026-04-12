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
    setQuantization,
    tapBpm,
  } from "$lib/tauri/commands";
  import {
    activeSection,
    detectedTempo,
    runtimeCapabilities,
    scheduledActions,
    tempoState,
  } from "$lib/stores/runtime";
  import { describeRuntimeCapabilityTruth } from "$lib/engine/runtimeCapabilityStatus";
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
  let capabilityTruth = describeRuntimeCapabilityTruth($runtimeCapabilities);

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

  $: bpmInput = Math.round($tempoState.bpm * 100) / 100;
  $: capabilityTruth = describeRuntimeCapabilityTruth($runtimeCapabilities);
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
    <p class="text-[0.6rem] m-0 truncate text-primary-500" aria-live="polite">
      {status}
    </p>
  </div>

  <div class="flex flex-col gap-1 flex-1 text-[0.65rem]">
    <div
      class="flex flex-wrap gap-1 items-center bg-surface-950 p-1 border border-surface-800 rounded-sm"
    >
      <label
        for="transport-bpm"
        class="text-surface-500 uppercase font-bold text-[0.55rem] w-8"
        >BPM</label
      >
      <input
        id="transport-bpm"
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
      <span
        class="ml-1 px-1.5 py-0.5 rounded-sm border border-emerald-500/60 bg-emerald-500/10 text-emerald-300 font-mono"
      >
        DET {$detectedTempo.bpm !== null ? $detectedTempo.bpm.toFixed(2) : "--"}
      </span>
    </div>

    <div
      class="flex flex-wrap gap-1 items-center bg-surface-950 p-1 border border-surface-800 rounded-sm"
    >
      <label
        for="transport-quantize"
        class="text-surface-500 uppercase font-bold text-[0.55rem] w-8"
        >Qtz</label
      >
      <select
        id="transport-quantize"
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
      <span
        class="text-surface-500 uppercase font-bold text-[0.55rem] w-8"
        >Rndr</span
      >
      <div
        class="rounded-sm border border-surface-700 bg-surface-900 px-2 py-0.5 text-[0.6rem] font-mono text-surface-200"
      >
        HTMLVideo / WebGL2
      </div>
      <span
        class="text-surface-500 uppercase font-bold text-[0.55rem] ml-1"
        >Goal</span
      >
      <div
        class="rounded-sm border border-error-500/70 bg-error-500/10 px-2 py-0.5 text-[0.6rem] font-mono text-error-200"
      >
        MasterSelects WebGPU engine required
      </div>
      <button
        class="bg-primary-500/20 text-primary-500 border border-primary-500 hover:bg-primary-500 hover:text-surface-950 px-1.5 py-0.5 rounded-sm font-bold ml-auto"
        on:click={refresh}>Refresh</button
      >
      <span
        class="px-1.5 py-0.5 rounded-sm border border-surface-700 bg-surface-900 text-surface-300 font-mono"
        title="Browser/WebView capability probe only"
      >
        WGPU {$runtimeCapabilities.webgpu ? "probe" : "no"}
      </span>
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
    <div class="flex justify-between">
      <span class="text-emerald-300"
        >Detected BPM: {$detectedTempo.bpm !== null
          ? $detectedTempo.bpm.toFixed(2)
          : "N/A"}</span
      >
      <span class="text-emerald-300"
        >Detected Conf: {$detectedTempo.confidence !== null
          ? `${($detectedTempo.confidence * 100).toFixed(0)}%`
          : "N/A"}</span
      >
    </div>
    <div class="flex justify-between gap-2">
      <span>{capabilityTruth.engineSummary}</span>
      <span class={capabilityTruth.tone === "error" ? "text-error-300" : "text-emerald-300"}>
        {capabilityTruth.integrationNote}
      </span>
    </div>
    <div class="text-[0.52rem] normal-case tracking-normal {capabilityTruth.tone === 'error' ? 'text-error-200' : 'text-surface-400'}">
      {capabilityTruth.integrationNote}
    </div>
  </div>
</div>
