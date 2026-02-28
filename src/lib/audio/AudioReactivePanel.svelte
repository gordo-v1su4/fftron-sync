<script lang="ts">
  import { onDestroy, onMount } from "svelte";
  import {
    activeSection,
    audioBands,
    audioRuntime,
    markers,
    reactiveEnvelope,
    tempoState,
  } from "$lib/stores/runtime";
  import {
    analyzeEssentiaRhythm,
    analyzeEssentiaStructure,
  } from "$lib/services/essentia";
  import type { EngineCueMarker } from "$lib/types/timeline";
  import type { ReactiveBandTarget } from "$lib/types/engine";

  const targets: ReactiveBandTarget[] = ["low", "mid", "high", "full"];
  const clamp01 = (value: number): number => Math.min(1, Math.max(0, value));
  const defaultEssentiaApiKey =
    (import.meta.env.VITE_ESSENTIA_API_KEY as string | undefined)?.trim() ?? "";

  let audioElement: HTMLAudioElement | null = null;
  let fileInput: HTMLInputElement | null = null;
  let context: AudioContext | null = null;
  let analyser: AnalyserNode | null = null;
  let monitorGain: GainNode | null = null;
  let mediaNode: MediaElementAudioSourceNode | null = null;
  let micNode: MediaStreamAudioSourceNode | null = null;
  let micStream: MediaStream | null = null;
  let rafId = 0;
  let lastFrameMs = 0;
  let fftData: Uint8Array | null = null;
  let loadedTrackUrl = "";
  let loadedMediaFile: File | null = null;
  let status = "Load a song (or mic) to drive FFT and envelopes.";
  let essentiaApiKey = "";
  let essentiaLoading = false;

  let target: ReactiveBandTarget = "full";
  let attackMs = 27;
  let releaseMs = 190;
  let threshold = 0.12;
  let sensitivity = 1;

  let envelopeA = 0;
  let envelopeB = 0;

  const normalizeSectionLabel = (label: string): string => {
    const clean = label
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-");
    return clean.length > 0 ? clean : "section";
  };

  const compileSectionMarkers = (
    sections: Array<{ start: number; label: string }>,
    bpm: number,
  ): EngineCueMarker[] => {
    const beatsPerSecond = Math.max(20, Math.min(300, bpm)) / 60;
    return sections.map((section, index) => {
      const totalBeats = Math.max(0, section.start * beatsPerSecond);
      const bar = Math.floor(totalBeats / 4) + 1;
      const beat = (Math.floor(totalBeats) % 4) + 1;
      return {
        id: `ess-${index + 1}`,
        section: normalizeSectionLabel(section.label || `section-${index + 1}`),
        bar,
        beat,
        quantize: "1n",
        action: "trigger_clip",
        payload: {
          start: section.start,
          source: "essentia",
        },
      };
    });
  };

  const applyEnvelopeSettings = () => {
    reactiveEnvelope.set({
      target,
      attackMs,
      releaseMs,
      threshold,
      sensitivity,
    });
  };

  const disconnectSources = () => {
    mediaNode?.disconnect();
    micNode?.disconnect();
  };

  const ensureAudioGraph = async () => {
    if (!context) context = new AudioContext();
    if (context.state === "suspended") await context.resume();

    if (!analyser) {
      analyser = context.createAnalyser();
      analyser.fftSize = 2048;
      analyser.smoothingTimeConstant = 0.22;
      fftData = new Uint8Array(analyser.frequencyBinCount);
    }

    if (!monitorGain) {
      monitorGain = context.createGain();
      monitorGain.gain.value = 1;
      analyser.connect(monitorGain);
      monitorGain.connect(context.destination);
    }
  };

  const attachFileSource = async () => {
    if (!audioElement) return;
    await ensureAudioGraph();
    if (!context || !analyser || !monitorGain) return;

    if (!mediaNode) {
      mediaNode = context.createMediaElementSource(audioElement);
    }

    disconnectSources();
    mediaNode.connect(analyser);
    monitorGain.gain.value = 1;
    status = "File source routed to FFT engine.";
  };

  const attachMicSource = async () => {
    if (!navigator.mediaDevices?.getUserMedia) {
      status = "Microphone capture is unavailable in this browser.";
      return;
    }

    await ensureAudioGraph();
    if (!context || !analyser || !monitorGain) return;

    if (micStream) {
      micStream.getTracks().forEach((track) => track.stop());
      micStream = null;
    }

    micStream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false,
      },
    });

    micNode = context.createMediaStreamSource(micStream);
    disconnectSources();
    micNode.connect(analyser);
    monitorGain.gain.value = 0;
    audioElement?.pause();

    audioRuntime.set({
      source: "mic",
      trackName: "External audio input",
      isPlaying: true,
      currentTime: 0,
      duration: 0,
    });
    status = "Mic source live. Monitoring disabled to prevent feedback.";
  };

  const teardownMic = () => {
    if (micStream) {
      micStream.getTracks().forEach((track) => track.stop());
      micStream = null;
    }
    micNode?.disconnect();
    micNode = null;
  };

  const bandAverage = (startHz: number, endHz: number): number => {
    if (!fftData || !analyser || !context) return 0;

    const nyquist = context.sampleRate / 2;
    const start = Math.max(0, Math.floor((startHz / nyquist) * fftData.length));
    const end = Math.min(
      fftData.length - 1,
      Math.floor((endHz / nyquist) * fftData.length),
    );
    if (end <= start) return 0;

    let total = 0;
    for (let index = start; index <= end; index += 1) {
      total += fftData[index];
    }
    return total / ((end - start + 1) * 255);
  };

  const smoothEnvelope = (
    current: number,
    next: number,
    dtMs: number,
    riseMs: number,
    fallMs: number,
  ): number => {
    const tau = next > current ? Math.max(6, riseMs) : Math.max(6, fallMs);
    const alpha = 1 - Math.exp(-dtMs / tau);
    return current + (next - current) * alpha;
  };

  const startFftLoop = () => {
    if (rafId) return;

    const frame = (timestamp: number) => {
      rafId = requestAnimationFrame(frame);
      if (!analyser || !fftData) return;

      analyser.getByteFrequencyData(fftData as Uint8Array<ArrayBuffer>);

      const low = bandAverage(20, 180);
      const mid = bandAverage(180, 2000);
      const high = bandAverage(2000, 10000);
      const full = bandAverage(20, 14000);

      const targetedRaw =
        target === "low"
          ? low
          : target === "mid"
            ? mid
            : target === "high"
              ? high
              : full;
      const scaledTarget = clamp01(
        ((targetedRaw - threshold) / Math.max(0.01, 1 - threshold)) *
          sensitivity,
      );
      const scaledFull = clamp01(
        ((full - threshold) / Math.max(0.01, 1 - threshold)) * sensitivity,
      );

      const dt = lastFrameMs > 0 ? timestamp - lastFrameMs : 16.67;
      lastFrameMs = timestamp;

      envelopeA = smoothEnvelope(
        envelopeA,
        scaledTarget,
        dt,
        attackMs,
        releaseMs,
      );
      envelopeB = smoothEnvelope(
        envelopeB,
        scaledFull,
        dt,
        attackMs * 1.6,
        releaseMs * 1.45,
      );

      audioBands.set({
        low,
        mid,
        high,
        full,
        envelopeA,
        envelopeB,
        peak: envelopeA > 0.82 || high > 0.9,
      });
    };

    rafId = requestAnimationFrame(frame);
  };

  const loadTrack = async (event: Event) => {
    const file = (event.currentTarget as HTMLInputElement).files?.[0];
    if (!file || !audioElement) {
      status = "No media file selected.";
      return;
    }

    teardownMic();

    if (loadedTrackUrl) URL.revokeObjectURL(loadedTrackUrl);
    loadedTrackUrl = URL.createObjectURL(file);
    audioElement.src = loadedTrackUrl;
    audioElement.load();
    await attachFileSource();
    loadedMediaFile = file;

    audioRuntime.set({
      source: "file",
      trackName: file.name,
      isPlaying: false,
      currentTime: 0,
      duration: 0,
    });

    status = `Loaded track: ${file.name}`;
  };

  const playTrack = async () => {
    if (
      !audioElement ||
      !$audioRuntime.trackName ||
      $audioRuntime.source !== "file"
    )
      return;
    await ensureAudioGraph();
    await audioElement.play();
    status = "Track playback running.";
  };

  const pauseTrack = () => {
    audioElement?.pause();
    status = "Track paused.";
  };

  const stopTrack = () => {
    if (!audioElement) return;
    audioElement.pause();
    audioElement.currentTime = 0;
    status = "Track stopped.";
  };

  const toggleMic = async () => {
    if ($audioRuntime.source === "mic") {
      teardownMic();
      if (audioElement?.src) {
        await attachFileSource();
        audioRuntime.update((state) => ({
          ...state,
          source: "file",
          isPlaying: false,
        }));
        status = "Mic disabled. File source restored.";
      } else {
        audioRuntime.set({
          source: "none",
          trackName: "No track loaded",
          isPlaying: false,
          currentTime: 0,
          duration: 0,
        });
        status = "Mic disabled.";
      }
      return;
    }

    try {
      await attachMicSource();
    } catch (error) {
      status = `Mic enable failed: ${error instanceof Error ? error.message : "unknown error"}`;
    }
  };

  const runEssentiaDetection = async () => {
    if (!loadedMediaFile) {
      status = "Load an audio/video file before Essentia detection.";
      return;
    }
    if (!essentiaApiKey.trim()) {
      status = "Add an Essentia API key to run BPM/section detection.";
      return;
    }

    essentiaLoading = true;
    try {
      const [rhythm, structure] = await Promise.all([
        analyzeEssentiaRhythm(loadedMediaFile, essentiaApiKey.trim()),
        analyzeEssentiaStructure(loadedMediaFile, essentiaApiKey.trim()),
      ]);

      const markersFromSections = compileSectionMarkers(
        structure.sections,
        rhythm.bpm,
      );
      markers.set(markersFromSections);
      if (markersFromSections.length > 0)
        activeSection.set(markersFromSections[0].section);

      const firstBeatSeconds = rhythm.beats[0] ?? 0;
      tempoState.update((state) => ({
        ...state,
        bpm: rhythm.bpm,
        confidence: rhythm.confidence,
        source: "auto",
        downbeatEpochMs: Date.now() - firstBeatSeconds * 1000,
      }));

      status = `Essentia detected BPM ${rhythm.bpm.toFixed(2)} (${(rhythm.confidence * 100).toFixed(0)}%) and ${markersFromSections.length} sections`;
    } catch (error) {
      status = `Essentia detection failed: ${error instanceof Error ? error.message : "unknown error"}`;
    } finally {
      essentiaLoading = false;
    }
  };

  onMount(() => {
    applyEnvelopeSettings();
    startFftLoop();
    if (typeof window !== "undefined") {
      const storedKey =
        window.localStorage.getItem("essentia_api_key")?.trim() ?? "";
      essentiaApiKey = storedKey || defaultEssentiaApiKey;
    }
  });

  $: if (typeof window !== "undefined") {
    window.localStorage.setItem("essentia_api_key", essentiaApiKey);
  }

  onDestroy(() => {
    if (rafId) cancelAnimationFrame(rafId);
    if (loadedTrackUrl) URL.revokeObjectURL(loadedTrackUrl);
    teardownMic();
    disconnectSources();
    analyser?.disconnect();
    monitorGain?.disconnect();
    if (context) void context.close();
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
      Audio Reactive Analyzer
    </h2>
    <p class="text-[0.6rem] m-0 truncate text-primary-500">{status}</p>
  </div>

  <div class="flex flex-row gap-1 flex-1 min-h-0">
    <div class="flex-1 flex flex-col gap-1 text-[0.65rem]">
      <div
        class="flex flex-wrap gap-1 items-center bg-surface-950 p-1 border border-surface-800 rounded-sm"
      >
        <label
          for="track-file"
          class="btn btn-sm bg-primary-500/20 text-primary-500 border border-primary-500 hover:bg-primary-500 hover:text-surface-950 px-2 py-0.5 rounded-sm font-bold cursor-pointer m-0"
          >Load Song</label
        >
        <input
          id="track-file"
          bind:this={fileInput}
          type="file"
          accept="audio/*,video/*"
          on:change={loadTrack}
          class="hidden"
        />
        <button
          class="bg-surface-800 border border-surface-700 hover:bg-surface-700 px-2 py-0.5 rounded-sm"
          on:click={toggleMic}
          >{$audioRuntime.source === "mic" ? "Mic Off" : "Mic In"}</button
        >
      </div>

      <div
        class="flex flex-wrap gap-1 items-center bg-surface-950 p-1 border border-surface-800 rounded-sm"
      >
        <label class="text-surface-500 uppercase font-bold text-[0.55rem]"
          >Essentia Key</label
        >
        <input
          type="password"
          bind:value={essentiaApiKey}
          placeholder="X-API-Key"
          autocomplete="off"
          spellcheck="false"
          class="flex-1 bg-surface-900 border border-surface-700 text-surface-200 px-1 py-0.5 rounded-sm"
        />
        <button
          class="bg-primary-500/20 text-primary-500 border border-primary-500 hover:bg-primary-500 hover:text-surface-950 px-1.5 py-0.5 rounded-sm font-bold"
          disabled={essentiaLoading}
          on:click={runEssentiaDetection}
          >{essentiaLoading ? "Detecting…" : "Detect BPM+Sections"}</button
        >
      </div>

      <div
        class="bg-surface-800 border border-surface-700 rounded-sm px-1.5 py-0.5 text-surface-200 truncate font-mono text-[0.6rem]"
      >
        {$audioRuntime.trackName}
      </div>

      <div
        class="flex flex-wrap gap-1 items-center bg-surface-950 p-1 border border-surface-800 rounded-sm font-mono text-[0.65rem]"
      >
        <span
          class="w-12 bg-surface-900 border border-surface-700 px-1 text-center rounded-sm"
          >{$tempoState.bpm.toFixed(2)}</span
        >
        <button
          class="bg-surface-800 border border-surface-700 hover:bg-surface-700 px-1.5 py-0.5 rounded-sm"
          on:click={playTrack}>▶</button
        >
        <button
          class="bg-surface-800 border border-surface-700 hover:bg-surface-700 px-1.5 py-0.5 rounded-sm"
          on:click={pauseTrack}>⏸</button
        >
        <button
          class="bg-surface-800 border border-surface-700 hover:bg-surface-700 px-1.5 py-0.5 rounded-sm"
          on:click={stopTrack}>⏹</button
        >
        <span class="text-surface-400 ml-auto"
          >{$audioRuntime.currentTime.toFixed(1)} / {Math.max(
            $audioRuntime.duration,
            0,
          ).toFixed(1)}s</span
        >
      </div>

      <div
        class="grid grid-cols-[auto_1fr_auto_40px_auto_40px] items-center gap-1 bg-surface-950 p-1 border border-surface-800 rounded-sm"
      >
        <label class="text-surface-500 uppercase font-bold text-[0.55rem]"
          >Node</label
        >
        <select
          bind:value={target}
          on:change={applyEnvelopeSettings}
          class="bg-surface-900 border border-surface-700 text-surface-200 px-1 py-0.5 rounded-sm outline-none"
        >
          {#each targets as option}
            <option value={option}>{option}</option>
          {/each}
        </select>
        <label class="text-surface-500 uppercase font-bold text-[0.55rem]"
          >Attk</label
        >
        <input
          type="number"
          min="5"
          max="800"
          step="1"
          bind:value={attackMs}
          on:input={applyEnvelopeSettings}
          class="bg-surface-900 border border-surface-700 text-surface-200 px-1 py-0.5 rounded-sm text-right"
        />
        <label class="text-surface-500 uppercase font-bold text-[0.55rem]"
          >Rel</label
        >
        <input
          type="number"
          min="20"
          max="1500"
          step="5"
          bind:value={releaseMs}
          on:input={applyEnvelopeSettings}
          class="bg-surface-900 border border-surface-700 text-surface-200 px-1 py-0.5 rounded-sm text-right"
        />
      </div>

      <div
        class="grid grid-cols-[auto_1fr_auto_1fr] items-center gap-1 bg-surface-950 p-1 border border-surface-800 rounded-sm"
      >
        <label class="text-surface-500 uppercase font-bold text-[0.55rem]"
          >Thr</label
        >
        <input
          type="range"
          min="0"
          max="0.8"
          step="0.01"
          bind:value={threshold}
          on:input={applyEnvelopeSettings}
          class="accent-primary-500 h-1 bg-surface-800 rounded-sm appearance-none outline-none"
        />
        <label class="text-surface-500 uppercase font-bold text-[0.55rem]"
          >Sens</label
        >
        <input
          type="range"
          min="0.5"
          max="2.5"
          step="0.01"
          bind:value={sensitivity}
          on:input={applyEnvelopeSettings}
          class="accent-primary-500 h-1 bg-surface-800 rounded-sm appearance-none outline-none"
        />
      </div>

      <div class="flex flex-col gap-1 mt-1">
        <div
          class="grid grid-cols-[60px_1fr] items-center gap-1 text-[0.6rem] uppercase text-surface-400 font-bold"
        >
          <span>Env A</span>
          <div
            class="h-1.5 bg-surface-800 rounded-full overflow-hidden border border-surface-700"
          >
            <div
              class="h-full bg-gradient-to-r from-primary-600 to-primary-400 transition-all duration-75"
              style={`width:${$audioBands.envelopeA * 100}%`}
            ></div>
          </div>
        </div>
        <div
          class="grid grid-cols-[60px_1fr] items-center gap-1 text-[0.6rem] uppercase text-surface-400 font-bold"
        >
          <span>Env B</span>
          <div
            class="h-1.5 bg-surface-800 rounded-full overflow-hidden border border-surface-700"
          >
            <div
              class="h-full bg-gradient-to-r from-primary-600 to-primary-400 transition-all duration-75"
              style={`width:${$audioBands.envelopeB * 100}%`}
            ></div>
          </div>
        </div>
      </div>
    </div>

    <aside
      class="w-32 flex-none bg-surface-950 border border-surface-800 rounded-sm p-1 flex flex-col gap-1"
    >
      <h3
        class="text-[0.55rem] font-bold text-surface-400 uppercase tracking-widest m-0 pb-1 border-b border-surface-800"
      >
        Signal Gate
      </h3>

      <div
        class="flex flex-col gap-[2px] mt-1 flex-1 text-[0.6rem] uppercase text-surface-400"
      >
        <div class="grid grid-cols-[10px_1fr] items-center gap-1">
          <span>L</span>
          <div class="h-1 bg-surface-800 rounded-sm overflow-hidden">
            <div
              class="h-full bg-surface-300 transition-all duration-75"
              style={`width:${$audioBands.low * 100}%`}
            ></div>
          </div>
        </div>
        <div class="grid grid-cols-[10px_1fr] items-center gap-1">
          <span>M</span>
          <div class="h-1 bg-surface-800 rounded-sm overflow-hidden">
            <div
              class="h-full bg-surface-300 transition-all duration-75"
              style={`width:${$audioBands.mid * 100}%`}
            ></div>
          </div>
        </div>
        <div class="grid grid-cols-[10px_1fr] items-center gap-1">
          <span>H</span>
          <div class="h-1 bg-surface-800 rounded-sm overflow-hidden">
            <div
              class="h-full bg-surface-300 transition-all duration-75"
              style={`width:${$audioBands.high * 100}%`}
            ></div>
          </div>
        </div>
        <div class="grid grid-cols-[10px_1fr] items-center gap-1">
          <span>F</span>
          <div class="h-1 bg-surface-800 rounded-sm overflow-hidden">
            <div
              class="h-full bg-surface-300 transition-all duration-75"
              style={`width:${$audioBands.full * 100}%`}
            ></div>
          </div>
        </div>
      </div>
      <div
        class="flex-none h-12 rounded-sm border flex items-center justify-center text-[0.65rem] font-bold mt-auto {$audioBands.peak
          ? 'border-primary-500 text-primary-500 shadow-[inset_0_0_8px_rgba(245,158,11,0.2)] bg-primary-500/10'
          : 'border-surface-800 text-surface-600 bg-surface-900'}"
      >
        {$audioBands.peak ? "PEAK ON" : "PEAK OFF"}
      </div>
    </aside>
  </div>

  <audio
    bind:this={audioElement}
    preload="metadata"
    on:loadedmetadata={() =>
      audioRuntime.update((s) => ({
        ...s,
        duration: Number.isFinite(audioElement?.duration)
          ? (audioElement?.duration ?? 0)
          : 0,
      }))}
    on:timeupdate={() =>
      audioRuntime.update((s) => ({
        ...s,
        currentTime: audioElement?.currentTime ?? 0,
      }))}
    on:play={() => audioRuntime.update((s) => ({ ...s, isPlaying: true }))}
    on:pause={() => audioRuntime.update((s) => ({ ...s, isPlaying: false }))}
  ></audio>
</div>
