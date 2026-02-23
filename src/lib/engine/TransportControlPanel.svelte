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
      status = 'Runtime state synced';
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
    <button class="emph" on:click={applyBpm}>Set</button>
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
    <button class="emph" on:click={applyGrid}>Apply Grid</button>
    <button on:click={queuePreview}>Queue Preview</button>
    <button class="emph" on:click={queueMarkers}>Queue Markers</button>
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

    <button class="emph" on:click={refresh}>Refresh</button>
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
    border: 1px solid var(--border);
    border-radius: 0.6rem;
    padding: 0.65rem;
    background: rgba(15, 15, 16, 0.94);
  }

  h2 {
    margin: 0 0 0.42rem;
    font-size: 1rem;
  }

  .line {
    display: flex;
    gap: 0.32rem;
    flex-wrap: wrap;
    align-items: center;
    margin-bottom: 0.42rem;
  }

  label {
    font-size: 0.72rem;
    color: var(--muted);
    letter-spacing: 0.01em;
  }

  input,
  select,
  button {
    height: 1.9rem;
    border-radius: 0.42rem;
    border: 1px solid var(--border);
    background: var(--surface-2);
    color: var(--text);
    padding: 0 0.52rem;
    font: inherit;
    font-size: 0.78rem;
    line-height: 1;
  }

  button {
    cursor: pointer;
    font-weight: 600;
  }

  button.emph {
    background: var(--accent);
    border-color: var(--accent);
    color: #1a1408;
  }

  .meta {
    margin: 0.14rem 0;
    color: var(--muted);
    font-size: 0.73rem;
  }

  .status {
    margin-top: 0.42rem;
    color: var(--accent-ok);
    font-size: 0.74rem;
  }
</style>
