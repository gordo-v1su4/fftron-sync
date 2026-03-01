<script lang="ts">
  import { onDestroy, onMount } from "svelte";
  import {
    activeSection,
    automationBounds,
    audioBands,
    audioRuntime,
    detectedTempo,
    essentiaAnalysis,
    markers,
    reactiveEnvelope,
    tempoState,
    timelineSeekRequest,
    waveformOverview,
  } from "$lib/stores/runtime";
  import {
    analyzeEssentiaFull,
    analyzeEssentiaRhythm,
    analyzeEssentiaStructure,
    type EssentiaFullResponse,
    type EssentiaStructureSection,
  } from "$lib/services/essentia";
  import {
    extractWaveformOverview,
    isLikelyWavFile,
  } from "$lib/audio/wav";
  import type { EngineCueMarker } from "$lib/types/timeline";
  import type { ReactiveBandTarget } from "$lib/types/engine";

  const targets: ReactiveBandTarget[] = ["low", "mid", "high", "full"];
  const clamp01 = (value: number): number => Math.min(1, Math.max(0, value));
  const importEnv = import.meta.env as Record<string, string | undefined>;
  const defaultEssentiaApiKey =
    (importEnv.VITE_ESSENTIA_API_KEY ?? importEnv.ESSENTIA_API_KEY ?? "").trim();
  const waveformResolution = 4096;

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
  let detectionRequestId = 0;

  let target: ReactiveBandTarget = "full";
  let attackMs = 27;
  let releaseMs = 190;
  let threshold = 0.12;
  let sensitivity = 1;
  let speedMinValue = 0.5;
  let speedMaxValue = 2.1;
  let stutterMinValue = 0;
  let stutterMaxValue = 1;
  const speedDomainMin = 0.25;
  const speedDomainMax = 4;

  let envelopeA = 0;
  let envelopeB = 0;
  let lastHandledSeekRequestId = 0;

  const normalizeSectionLabel = (label: string): string => {
    const clean = label
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-");
    return clean.length > 0 ? clean : "section";
  };

  const compileSectionMarkers = (
    sections: EssentiaStructureSection[],
    bpm: number,
  ): EngineCueMarker[] => {
    const beatsPerSecond = Math.max(20, Math.min(300, bpm)) / 60;
    const sectionCounts = new Map<string, number>();
    return sections.map((section, index) => {
      const totalBeats = Math.max(0, section.start * beatsPerSecond);
      const bar = Math.floor(totalBeats / 4) + 1;
      const beat = (Math.floor(totalBeats) % 4) + 1;
      const baseSection = normalizeSectionLabel(section.label || `section-${index + 1}`);
      const occurrence = (sectionCounts.get(baseSection) ?? 0) + 1;
      sectionCounts.set(baseSection, occurrence);
      const sectionId = occurrence === 1 ? baseSection : `${baseSection}-${occurrence}`;
      return {
        id: `ess-${index + 1}`,
        section: sectionId,
        bar,
        beat,
        quantize: "1n",
        action: "trigger_clip",
        payload: {
          start: section.start,
          end: section.end,
          duration: section.duration,
          energy: section.energy,
          label: section.label,
          source: "essentia",
        },
      };
    });
  };

  const detectEssentiaWithFallback = async (
    file: File,
    apiKey: string,
  ): Promise<{ full: EssentiaFullResponse; usedFallback: boolean }> => {
    try {
      const full = await analyzeEssentiaFull(file, apiKey);
      return { full, usedFallback: false };
    } catch (fullError) {
      const [rhythm, structure] = await Promise.all([
        analyzeEssentiaRhythm(file, apiKey),
        analyzeEssentiaStructure(file, apiKey),
      ]);

      const fallbackFull: EssentiaFullResponse = {
        ...rhythm,
        structure,
        classification: null,
        tonal: null,
        vocals: null,
      };

      console.warn("Essentia /analyze/full failed; used rhythm+structure fallback", fullError);
      return { full: fallbackFull, usedFallback: true };
    }
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

  const applyAutomationBounds = () => {
    const speedMin = Math.max(
      speedDomainMin,
      Math.min(speedMinValue, speedDomainMax - 0.01),
    );
    const speedMax = Math.min(
      speedDomainMax,
      Math.max(speedMaxValue, speedMin + 0.01),
    );
    const stutterMin = Math.max(0, Math.min(stutterMinValue, 0.999));
    const stutterMax = Math.min(1, Math.max(stutterMaxValue, stutterMin + 0.001));

    speedMinValue = Number(speedMin.toFixed(2));
    speedMaxValue = Number(speedMax.toFixed(2));
    stutterMinValue = Number(stutterMin.toFixed(2));
    stutterMaxValue = Number(stutterMax.toFixed(2));

    automationBounds.set({
      speedMin: speedMinValue,
      speedMax: speedMaxValue,
      stutterMin: stutterMinValue,
      stutterMax: stutterMaxValue,
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

      // Drive transport/timeline from the real media clock each frame.
      if (audioElement && $audioRuntime.source === "file") {
        const nextCurrentTime = audioElement.currentTime || 0;
        const nextDuration = Number.isFinite(audioElement.duration)
          ? audioElement.duration
          : $audioRuntime.duration;
        const nextIsPlaying = !audioElement.paused && !audioElement.ended;

        audioRuntime.update((state) => {
          const currentTimeChanged =
            Math.abs(state.currentTime - nextCurrentTime) > 0.001;
          const durationChanged = Math.abs(state.duration - nextDuration) > 0.001;
          const playingChanged = state.isPlaying !== nextIsPlaying;
          if (!currentTimeChanged && !durationChanged && !playingChanged) {
            return state;
          }
          return {
            ...state,
            currentTime: nextCurrentTime,
            duration: nextDuration,
            isPlaying: nextIsPlaying,
          };
        });
      }
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
    audioElement.currentTime = 0;
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
    markers.set([]);
    activeSection.set("");
    essentiaAnalysis.set({
      bpm: null,
      confidence: null,
      duration: null,
      boundaries: [],
      sections: [],
      energyCurve: [],
      full: null,
      updatedAtMs: null,
    });

    if (isLikelyWavFile(file.name, file.type)) {
      try {
        const waveform = extractWaveformOverview(await file.arrayBuffer(), {
          sourceName: file.name,
          resolution: waveformResolution,
        });
        waveformOverview.set(waveform);
        audioRuntime.update((state) => ({
          ...state,
          duration: waveform.durationSeconds,
        }));
        status = `Loaded ${file.name} (${waveform.channelCount}ch ${waveform.sampleRate}Hz WAV)`;
      } catch (error) {
        waveformOverview.set(null);
        status = `Loaded ${file.name}, but WAV analysis failed: ${error instanceof Error ? error.message : "unknown error"}`;
      }
    } else {
      waveformOverview.set(null);
      status = `Loaded track: ${file.name}`;
    }

    if (defaultEssentiaApiKey || essentiaApiKey.trim()) {
      void runEssentiaDetection(file);
    } else {
      status = `${status} (Essentia key not configured in env)`;
    }
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

  const runEssentiaDetection = async (fileOverride?: File) => {
    const file = fileOverride ?? loadedMediaFile;
    if (!file) {
      status = "Load an audio/video file before Essentia detection.";
      return;
    }
    const apiKey = (essentiaApiKey.trim() || defaultEssentiaApiKey).trim();
    if (!apiKey) {
      status = "Set VITE_ESSENTIA_API_KEY in environment to run BPM/section detection.";
      return;
    }

    const requestId = ++detectionRequestId;
    essentiaLoading = true;
    try {
      const { full, usedFallback } = await detectEssentiaWithFallback(file, apiKey);
      if (requestId !== detectionRequestId) return;

      const markersFromSections = compileSectionMarkers(
        full.structure.sections,
        full.bpm,
      );
      markers.set(markersFromSections);
      if (markersFromSections.length > 0)
        activeSection.set(markersFromSections[0].section);
      else activeSection.set("");

      const firstBeatSeconds = full.beats[0] ?? 0;
      const normalizedConfidence = clamp01(full.confidence);
      tempoState.update((state) => ({
        ...state,
        bpm: full.bpm,
        confidence: normalizedConfidence,
        source: "auto",
        downbeatEpochMs: Date.now() - firstBeatSeconds * 1000,
      }));
      detectedTempo.set({
        bpm: full.bpm,
        confidence: normalizedConfidence,
        source: "essentia",
        updatedAtMs: Date.now(),
      });
      const sectionCounts = new Map<string, number>();
      essentiaAnalysis.set({
        bpm: full.bpm,
        confidence: normalizedConfidence,
        duration: full.duration,
        boundaries: full.structure.boundaries,
        sections: full.structure.sections.map((section, index) => {
          const baseSection = normalizeSectionLabel(
            section.label || `section-${index + 1}`,
          );
          const occurrence = (sectionCounts.get(baseSection) ?? 0) + 1;
          sectionCounts.set(baseSection, occurrence);
          return {
            id: `sec-${index + 1}`,
            label: section.label || baseSection,
            section:
              occurrence === 1 ? baseSection : `${baseSection}-${occurrence}`,
            start: Math.max(0, section.start),
            end: Math.max(section.start, section.end),
            duration: section.duration,
            energy: section.energy,
          };
        }),
        energyCurve: full.energy.curve ?? [],
        full,
        updatedAtMs: Date.now(),
      });

      status = usedFallback
        ? "Essentia detection complete (fallback mode)."
        : "Essentia detection complete.";
    } catch (error) {
      markers.set([]);
      activeSection.set("");
      essentiaAnalysis.set({
        bpm: null,
        confidence: null,
        duration: null,
        boundaries: [],
        sections: [],
        energyCurve: [],
        full: null,
        updatedAtMs: null,
      });
      status = `Essentia detection failed: ${error instanceof Error ? error.message : "unknown error"}`;
    } finally {
      if (requestId === detectionRequestId) {
        essentiaLoading = false;
      }
    }
  };

  onMount(() => {
    applyEnvelopeSettings();
    startFftLoop();
    essentiaApiKey = defaultEssentiaApiKey;
    speedMinValue = $automationBounds.speedMin;
    speedMaxValue = $automationBounds.speedMax;
    stutterMinValue = $automationBounds.stutterMin;
    stutterMaxValue = $automationBounds.stutterMax;
  });

  $: if (
    $timelineSeekRequest &&
    $timelineSeekRequest.requestId !== lastHandledSeekRequestId
  ) {
    lastHandledSeekRequestId = $timelineSeekRequest.requestId;
    if (audioElement && $audioRuntime.source === "file") {
      const seekMax = Number.isFinite(audioElement.duration)
        ? audioElement.duration
        : $audioRuntime.duration;
      const seekTime = Math.max(0, Math.min($timelineSeekRequest.time, seekMax));
      audioElement.currentTime = seekTime;
      audioRuntime.update((state) => ({
        ...state,
        currentTime: seekTime,
      }));
    }
  }

  onDestroy(() => {
    if (rafId) cancelAnimationFrame(rafId);
    if (loadedTrackUrl) URL.revokeObjectURL(loadedTrackUrl);
    teardownMic();
    disconnectSources();
    analyser?.disconnect();
    monitorGain?.disconnect();
    if (context) void context.close();
    waveformOverview.set(null);
    markers.set([]);
    activeSection.set("");
    essentiaAnalysis.set({
      bpm: null,
      confidence: null,
      duration: null,
      boundaries: [],
      sections: [],
      energyCurve: [],
      full: null,
      updatedAtMs: null,
    });
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
    <p class="text-[0.6rem] m-0 truncate text-primary-500" aria-live="polite">
      {status}
    </p>
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
        <span class="text-surface-500 uppercase font-bold text-[0.55rem]"
          >Essentia Auto</span
        >
        <span class="text-[0.55rem] text-surface-300 font-mono"
          >{defaultEssentiaApiKey ? "Key from env" : "No env key"}</span
        >
        <button
          class="bg-primary-500/20 text-primary-500 border border-primary-500 hover:bg-primary-500 hover:text-surface-950 px-1.5 py-0.5 rounded-sm font-bold"
          disabled={essentiaLoading || !loadedMediaFile}
          on:click={() => void runEssentiaDetection()}
          >{essentiaLoading ? "Detecting…" : "Re-Detect BPM+Sections"}</button
        >
      </div>

      <div
        class="flex items-center justify-between gap-2 bg-emerald-500/10 border border-emerald-500/60 rounded-sm px-1.5 py-0.5 font-mono text-[0.6rem]"
      >
        <span class="uppercase text-emerald-300 font-bold tracking-wide"
          >BPM Detected</span
        >
        <span class="text-emerald-200">
          {$detectedTempo.bpm !== null
            ? $detectedTempo.bpm.toFixed(2)
            : "Waiting for detection"}
        </span>
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
          aria-label="Play audio track"
          on:click={playTrack}>▶</button
        >
        <button
          class="bg-surface-800 border border-surface-700 hover:bg-surface-700 px-1.5 py-0.5 rounded-sm"
          aria-label="Pause audio track"
          on:click={pauseTrack}>⏸</button
        >
        <button
          class="bg-surface-800 border border-surface-700 hover:bg-surface-700 px-1.5 py-0.5 rounded-sm"
          aria-label="Stop audio track"
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
        class="grid grid-cols-[auto_minmax(0,132px)_auto_46px_auto_46px] items-center justify-start gap-1 bg-surface-950 p-1 border border-surface-800 rounded-sm"
      >
        <label
          for="reactive-target"
          class="text-surface-500 uppercase font-bold text-[0.55rem]"
          >Node</label
        >
        <select
          id="reactive-target"
          bind:value={target}
          on:change={applyEnvelopeSettings}
          class="bg-surface-900 border border-surface-700 text-surface-200 px-1 py-0.5 rounded-sm outline-none max-w-[132px]"
        >
          {#each targets as option}
            <option value={option}>{option}</option>
          {/each}
        </select>
        <label
          for="reactive-attack"
          class="text-surface-500 uppercase font-bold text-[0.55rem]"
          >Attk</label
        >
        <input
          id="reactive-attack"
          type="number"
          min="5"
          max="800"
          step="1"
          bind:value={attackMs}
          on:input={applyEnvelopeSettings}
          class="w-[46px] bg-surface-900 border border-surface-700 text-surface-200 px-1 py-0.5 rounded-sm text-right"
        />
        <label
          for="reactive-release"
          class="text-surface-500 uppercase font-bold text-[0.55rem]"
          >Rel</label
        >
        <input
          id="reactive-release"
          type="number"
          min="20"
          max="1500"
          step="5"
          bind:value={releaseMs}
          on:input={applyEnvelopeSettings}
          class="w-[46px] bg-surface-900 border border-surface-700 text-surface-200 px-1 py-0.5 rounded-sm text-right"
        />
      </div>

      <div
        class="grid grid-cols-[auto_1fr_auto_1fr] items-center gap-1 bg-surface-950 p-1 border border-surface-800 rounded-sm"
      >
        <label
          for="reactive-threshold"
          class="text-surface-500 uppercase font-bold text-[0.55rem]"
          >Thr</label
        >
        <input
          id="reactive-threshold"
          type="range"
          min="0"
          max="0.8"
          step="0.01"
          bind:value={threshold}
          on:input={applyEnvelopeSettings}
          class="accent-primary-500 h-1 bg-surface-800 rounded-sm appearance-none outline-none"
        />
        <label
          for="reactive-sensitivity"
          class="text-surface-500 uppercase font-bold text-[0.55rem]"
          >Sens</label
        >
        <input
          id="reactive-sensitivity"
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
      <div
        class="grid grid-cols-[auto_52px_auto_52px_auto_52px_auto_52px] items-center gap-1 bg-surface-950 p-1 border border-surface-800 rounded-sm font-mono text-[0.58rem]"
      >
        <span class="text-surface-500 uppercase font-bold">SPD</span>
        <input
          type="number"
          min={speedDomainMin}
          max={speedDomainMax}
          step="0.01"
          bind:value={speedMinValue}
          on:input={applyAutomationBounds}
          class="bg-surface-900 border border-surface-700 text-surface-200 px-1 py-0.5 rounded-sm text-right"
          aria-label="Speed minimum"
        />
        <span class="text-surface-500 uppercase font-bold">MAX</span>
        <input
          type="number"
          min={speedDomainMin}
          max={speedDomainMax}
          step="0.01"
          bind:value={speedMaxValue}
          on:input={applyAutomationBounds}
          class="bg-surface-900 border border-surface-700 text-surface-200 px-1 py-0.5 rounded-sm text-right"
          aria-label="Speed maximum"
        />
        <span class="text-surface-500 uppercase font-bold">STT</span>
        <input
          type="number"
          min="0"
          max="1"
          step="0.01"
          bind:value={stutterMinValue}
          on:input={applyAutomationBounds}
          class="bg-surface-900 border border-surface-700 text-surface-200 px-1 py-0.5 rounded-sm text-right"
          aria-label="Stutter minimum"
        />
        <span class="text-surface-500 uppercase font-bold">MAX</span>
        <input
          type="number"
          min="0"
          max="1"
          step="0.01"
          bind:value={stutterMaxValue}
          on:input={applyAutomationBounds}
          class="bg-surface-900 border border-surface-700 text-surface-200 px-1 py-0.5 rounded-sm text-right"
          aria-label="Stutter maximum"
        />
      </div>

      <div
        class="bg-surface-950 border border-surface-800 rounded-sm p-1 flex flex-col gap-1"
      >
        <h3
          class="text-[0.55rem] font-bold text-surface-400 uppercase tracking-widest m-0 pb-1 border-b border-surface-800"
        >
          Signal Gate
        </h3>

        <div
          class="flex flex-col gap-[2px] mt-1 text-[0.6rem] uppercase text-surface-400"
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
          class="h-10 rounded-sm border flex items-center justify-center text-[0.6rem] font-bold {$audioBands.peak
            ? 'border-primary-500 text-primary-500 shadow-[inset_0_0_8px_rgba(245,158,11,0.2)] bg-primary-500/10'
            : 'border-surface-800 text-surface-600 bg-surface-900'}"
        >
          {$audioBands.peak ? "PEAK ON" : "PEAK OFF"}
        </div>
      </div>
    </div>
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
    on:play={() =>
      audioRuntime.update((s) => ({
        ...s,
        isPlaying: true,
        currentTime: audioElement?.currentTime ?? s.currentTime,
      }))}
    on:pause={() =>
      audioRuntime.update((s) => ({
        ...s,
        isPlaying: false,
        currentTime: audioElement?.currentTime ?? s.currentTime,
      }))}
    on:seeked={() =>
      audioRuntime.update((s) => ({
        ...s,
        currentTime: audioElement?.currentTime ?? s.currentTime,
      }))}
    on:ended={() =>
      audioRuntime.update((s) => ({
        ...s,
        isPlaying: false,
        currentTime: Number.isFinite(audioElement?.duration)
          ? (audioElement?.duration ?? s.currentTime)
          : s.currentTime,
      }))}
  ></audio>
</div>
