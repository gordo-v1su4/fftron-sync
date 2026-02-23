<script lang="ts">
  import { onMount } from 'svelte';
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
    tapBpm
  } from '$lib/tauri/commands';
  import { activeSection, runtimeCapabilities, scheduledActions, tempoState } from '$lib/stores/runtime';
  import type { DecodeBackend, RendererBackend } from '$lib/types/engine';
  import type { QuantizeGrid } from '$lib/types/timeline';

  const quantizeOptions: QuantizeGrid[] = ['1n', '1/2n', '1/4n', '1/8n', '1/16n'];

  let bpmInput = 120;
  let selectedGrid: QuantizeGrid = '1/4n';
  let status = 'Idle';

  const getErrorMessage = (error: unknown): string => (error instanceof Error ? error.message : 'unknown error');

  const refresh = async () => {
    try {
      runtimeCapabilities.set(await detectRuntimeCapabilities());
      const tempo = await getTempoState();
      tempoState.set(tempo);
      bpmInput = Math.round(tempo.bpm * 100) / 100;
      scheduledActions.set(await listScheduledActions());
    } catch (error) {
      status = `Tauri runtime unavailable in browser preview: ${getErrorMessage(error)}`;
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
      status = 'Tap captured';
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
      const backend = (event.currentTarget as HTMLSelectElement).value as DecodeBackend;
      runtimeCapabilities.set(await setDecodeBackend(backend));
      status = `Decode backend set to ${backend}`;
    } catch (error) {
      status = `Set decode backend failed: ${getErrorMessage(error)}`;
    }
  };

  const switchRenderer = async (event: Event) => {
    try {
      const backend = (event.currentTarget as HTMLSelectElement).value as RendererBackend;
      runtimeCapabilities.set(await setRendererBackend(backend));
      status = `Renderer backend set to ${backend}`;
    } catch (error) {
      status = `Set renderer backend failed: ${getErrorMessage(error)}`;
    }
  };

  const nudge = async (delta: number) => {
    try {
      tempoState.set(await nudgeBpm(delta));
      status = `Nudged BPM by ${delta > 0 ? '+' : ''}${delta}`;
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
      await queuePreviewAction('trigger_clip', $activeSection, selectedGrid);
      scheduledActions.set(await listScheduledActions());
      status = 'Queued preview trigger';
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

<section class="panel">
  <h2>Transport + Runtime</h2>

  <div class="line">
    <label for="bpm-input">BPM</label>
    <input id="bpm-input" type="number" bind:value={bpmInput} min="20" max="300" step="0.01" />
    <button on:click={applyBpm}>Set</button>
    <button on:click={runTap}>Tap</button>
    <button on:click={() => nudge(-0.1)}>-0.1</button>
    <button on:click={() => nudge(0.1)}>+0.1</button>
    <button on:click={() => resyncDownbeat(Date.now()).then((value) => tempoState.set(value))}>Resync</button>
  </div>

  <div class="line">
    <label for="quantize-select">Quantize</label>
    <select id="quantize-select" bind:value={selectedGrid}>
      {#each quantizeOptions as option}
        <option value={option}>{option}</option>
      {/each}
    </select>
    <button on:click={applyGrid}>Apply Grid</button>
    <button on:click={queuePreview}>Queue Preview</button>
    <button on:click={queueMarkers}>Queue Section Markers</button>
    <button on:click={flushDue}>Pop Due</button>
  </div>

  <div class="line">
    <label for="decode-select">Decode</label>
    <select id="decode-select" value={$runtimeCapabilities.selectedDecode} on:change={switchDecode}>
      <option value="htmlvideo">htmlvideo</option>
      <option value="webcodecs" disabled={!$runtimeCapabilities.webcodecs}>webcodecs</option>
      <option value="native_ffmpeg" disabled={!$runtimeCapabilities.nativeFfmpeg}>native_ffmpeg</option>
    </select>

    <label for="renderer-select">Renderer</label>
    <select id="renderer-select" value={$runtimeCapabilities.selectedRenderer} on:change={switchRenderer}>
      <option value="webgl2">webgl2</option>
      <option value="webgpu" disabled={!$runtimeCapabilities.webgpu}>webgpu</option>
    </select>

    <button on:click={refresh}>Refresh Capabilities</button>
  </div>

  <p class="meta">
    BPM {$tempoState.bpm.toFixed(2)} · Source {$tempoState.source} · Confidence {$tempoState.confidence.toFixed(2)} · Taps {$tempoState.tapCount}
  </p>
  <p class="meta">
    FFmpeg PATH {$runtimeCapabilities.nativeFfmpeg ? 'available' : 'missing'} · Rust ffmpeg feature {$runtimeCapabilities.rustFfmpegFeature ? 'enabled' : 'disabled'}
  </p>
  <p class="meta">Queued actions {$scheduledActions.length} · Active section {$activeSection}</p>
  <p class="status">{status}</p>
</section>

<style>
  .panel {
    border: 1px solid #3f3f46;
    border-radius: 0.75rem;
    padding: 1rem;
    background: rgba(10, 10, 11, 0.9);
  }

  .line {
    display: flex;
    gap: 0.5rem;
    flex-wrap: wrap;
    align-items: center;
    margin-bottom: 0.6rem;
  }

  label {
    font-size: 0.85rem;
    color: #a1a1aa;
  }

  input,
  select,
  button {
    border-radius: 0.5rem;
    border: 1px solid #3f3f46;
    background: #18181b;
    color: #f4f4f5;
    padding: 0.45rem 0.65rem;
    font: inherit;
  }

  button {
    cursor: pointer;
    background: #f59e0b;
    border-color: #f59e0b;
    color: #1c1917;
    font-weight: 600;
  }

  .meta {
    margin: 0.3rem 0;
    color: #a1a1aa;
    font-size: 0.88rem;
  }

  .status {
    margin-top: 0.6rem;
    color: #10b981;
  }
</style>
