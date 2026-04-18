<script lang="ts">
  import { onDestroy, onMount } from "svelte";
  import {
    activeSection,
    automationBounds,
    audioBands,
    audioOnsets,
    audioRuntime,
    detectedTempo,
    essentiaAnalysis,
    liveDetectedOnsets,
    markers,
    onsetTransportState,
    reactiveEnvelope,
    tempoState,
    timelineSeekRequest,
    transportAlignment,
    waveformOverview,
    switchProgressEvents,
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
  import {
    clampFrequencyRange,
    describeEffectRangeRouting,
    derivePresetTarget,
    EFFECT_RANGE_MAX_HZ,
    EFFECT_RANGE_MIN_HZ,
    findPresetById,
    formatFrequency,
    FREQUENCY_PRESETS,
    frequencyToPercent,
    MIN_EFFECT_RANGE_GAP_PERCENT,
    moveEffectRangeHandle,
    normalizeEffectRangePercents,
    nudgeEffectRangeHandle,
    percentToFrequency,
    percentFromPointer,
    resolveNearestEffectRangeHandle,
    type FrequencyRange,
    type EffectRangeHandle,
  } from "$lib/audio/frequencyRange";
  import {
    SPEED_AUTOMATION_DOMAIN,
    clampValue,
  } from "$lib/runtime/automationBounds";
  import { describeOnsetTransportState } from "$lib/audio/onsetTransportStatus";
  import type { EngineCueMarker } from "$lib/types/timeline";
  import type { ReactiveBandTarget } from "$lib/types/engine";
  import { getEssentiaClientApiKey } from "$lib/config/essentia-env";
  import MidiTriggerPanel from "$lib/audio/MidiTriggerPanel.svelte";

  const defaultEssentiaApiKey = getEssentiaClientApiKey();
  const waveformResolution = 4096;
  const spectrumPathWidth = 640;
  const spectrumPathHeight = 136;
  const spectrumBarCount = 96;

  let audioElement: HTMLAudioElement | null = null;
  let fileInput: HTMLInputElement | null = null;
  let rangeSelectorTrackEl: HTMLDivElement | null = null;
  let context: AudioContext | null = null;
  let analyser: AnalyserNode | null = null;
  let monitorGain: GainNode | null = null;
  let mediaNode: MediaElementAudioSourceNode | null = null;
  let micNode: MediaStreamAudioSourceNode | null = null;
  let micStream: MediaStream | null = null;
  let rafId = 0;
  let lastFrameMs = 0;
  let fftData: Uint8Array | null = null;
  let spectrumBars: number[] = Array.from({ length: spectrumBarCount }, () => 0);
  let onsetWasOpen = false;
  let lastDetectedOnsetMs = 0;
  let loadedTrackUrl = "";
  let loadedMediaFile: File | null = null;
  let status = "Load a song (or mic) to drive FFT and envelopes.";
  let essentiaApiKey = "";
  let essentiaLoading = false;
  let detectionRequestId = 0;

  let target: ReactiveBandTarget = "full";
  let effectRangeStartHz = EFFECT_RANGE_MIN_HZ;
  let effectRangeEndHz = EFFECT_RANGE_MAX_HZ;
  let rangeStartPercent = 0;
  let rangeEndPercent = 100;
  let attackMs = 27;
  let releaseMs = 190;
  let threshold = 0.09;
  let sensitivity = 1;
  let speedMinValue = 0.5;
  let speedMaxValue = 3;
  let stutterMinValue = 0;
  let stutterMaxValue = 0;
  const speedDomainMin = SPEED_AUTOMATION_DOMAIN.min;
  const speedDomainMax = SPEED_AUTOMATION_DOMAIN.max;

  let envelopeA = 0;
  let envelopeB = 0;
  let lastHandledSeekRequestId = 0;
  let spectrumCurvePath = "";
  let spectrumAreaPath = "";
  let selectedRangeLabel = "";
  let selectedRangeRouting = describeEffectRangeRouting({
    startHz: EFFECT_RANGE_MIN_HZ,
    endHz: EFFECT_RANGE_MAX_HZ,
  });
  let activeRangeHandle: EffectRangeHandle | null = null;
  let rangePointerCleanup: (() => void) | null = null;
  let activeRangeRect: { left: number; width: number } | null = null;
  let onsetTransportPresentation = describeOnsetTransportState({
    progressCount: 0,
    target: 4,
    armed: false,
    blockedReason: null,
    progressMode: "analyzed",
    lastTransportSlot: null,
  });
  let onsetDetectionState: "waiting" | "ready" | "error" = "waiting";

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

      return { full: fallbackFull, usedFallback: false };
    } catch (rhythmStructureError) {
      const full = await analyzeEssentiaFull(file, apiKey);
      console.warn(
        "Essentia /analyze/rhythm+/analyze/structure failed; fell back to /analyze/full",
        rhythmStructureError,
      );
      return { full, usedFallback: true };
    }
  };

  const buildSpectrumPaths = (values: number[]) => {
    if (values.length === 0) {
      return {
        curve: "",
        area: "",
      };
    }

    const points = values.map((value, index) => {
      const x =
        values.length === 1
          ? spectrumPathWidth / 2
          : (index / (values.length - 1)) * spectrumPathWidth;
      const y = spectrumPathHeight - clampValue(value, 0, 1) * spectrumPathHeight;
      return { x, y };
    });

    if (points.length === 1) {
      const point = points[0];
      return {
        curve: `M ${point.x} ${point.y}`,
        area: `M ${point.x} ${spectrumPathHeight} L ${point.x} ${point.y} L ${point.x} ${spectrumPathHeight} Z`,
      };
    }

    let curve = `M ${points[0].x} ${points[0].y}`;
    for (let index = 1; index < points.length - 1; index += 1) {
      const current = points[index];
      const next = points[index + 1];
      const midpointX = (current.x + next.x) / 2;
      const midpointY = (current.y + next.y) / 2;
      curve += ` Q ${current.x} ${current.y} ${midpointX} ${midpointY}`;
    }
    const lastControl = points[points.length - 2];
    const lastPoint = points[points.length - 1];
    curve += ` Q ${lastControl.x} ${lastControl.y} ${lastPoint.x} ${lastPoint.y}`;

    return {
      curve,
      area: `${curve} L ${spectrumPathWidth} ${spectrumPathHeight} L 0 ${spectrumPathHeight} Z`,
    };
  };

  const syncEffectRange = (nextRange: FrequencyRange) => {
    const normalized = clampFrequencyRange(nextRange.startHz, nextRange.endHz);
    effectRangeStartHz = normalized.startHz;
    effectRangeEndHz = normalized.endHz;
    rangeStartPercent = frequencyToPercent(normalized.startHz);
    rangeEndPercent = frequencyToPercent(normalized.endHz);
    target = derivePresetTarget(normalized);
  };

  const applyEffectRangeFromPercents = (startPercent: number, endPercent: number) => {
    const normalizedPercents = normalizeEffectRangePercents(
      startPercent,
      endPercent,
      MIN_EFFECT_RANGE_GAP_PERCENT,
    );
    const orderedStart = normalizedPercents.startPercent;
    const orderedEnd = normalizedPercents.endPercent;
    syncEffectRange({
      startHz: percentToFrequency(orderedStart),
      endHz: percentToFrequency(orderedEnd),
    });
    applyEnvelopeSettings();
  };

  const updateEffectRangeHandle = (
    handle: EffectRangeHandle,
    nextPercent: number,
  ) => {
    const normalized = moveEffectRangeHandle(
      {
        startPercent: rangeStartPercent,
        endPercent: rangeEndPercent,
      },
      handle,
      nextPercent,
      MIN_EFFECT_RANGE_GAP_PERCENT,
    );
    applyEffectRangeFromPercents(
      normalized.startPercent,
      normalized.endPercent,
    );
  };

  const selectPresetRange = (presetId: ReactiveBandTarget) => {
    const preset = findPresetById(presetId);
    syncEffectRange({
      startHz: preset.startHz,
      endHz: preset.endHz,
    });
    applyEnvelopeSettings();
  };

  const handleRangeStartInput = (event: Event) => {
    updateEffectRangeHandle(
      "start",
      (event.currentTarget as HTMLInputElement).valueAsNumber,
    );
  };

  const handleRangeEndInput = (event: Event) => {
    updateEffectRangeHandle(
      "end",
      (event.currentTarget as HTMLInputElement).valueAsNumber,
    );
  };

  const getRangePercentFromClientX = (
    clientX: number,
    rect = activeRangeRect,
  ): number | null => {
    if (!rect || rect.width <= 0) return null;
    return percentFromPointer(clientX, rect.left, rect.width);
  };

  const stopRangePointerDrag = () => {
    rangePointerCleanup?.();
    rangePointerCleanup = null;
    activeRangeHandle = null;
    activeRangeRect = null;
  };

  const beginRangePointerDrag = (
    handle: EffectRangeHandle,
    event: PointerEvent,
  ) => {
    if (!event.isPrimary) return;
    event.preventDefault();
    stopRangePointerDrag();
    const rect = rangeSelectorTrackEl?.getBoundingClientRect();
    if (!rect || rect.width <= 0) return;
    activeRangeHandle = handle;
    activeRangeRect = { left: rect.left, width: rect.width };
    const applyFromPointer = (clientX: number) => {
      const percent = getRangePercentFromClientX(clientX, activeRangeRect);
      if (percent === null) return;
      updateEffectRangeHandle(handle, percent);
    };

    applyFromPointer(event.clientX);

    const handlePointerMove = (moveEvent: PointerEvent) => {
      applyFromPointer(moveEvent.clientX);
    };
    const handlePointerUp = () => {
      stopRangePointerDrag();
    };

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp, { once: true });
    window.addEventListener("pointercancel", handlePointerUp, { once: true });
    rangePointerCleanup = () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
      window.removeEventListener("pointercancel", handlePointerUp);
    };
  };

  const handleRangeTrackPointerDown = (event: PointerEvent) => {
    if (!event.isPrimary) return;
    if ((event.target as HTMLElement | null)?.closest("[data-range-handle]")) {
      return;
    }

    const percent = getRangePercentFromClientX(event.clientX);
    if (percent === null) return;
    const nearestHandle = resolveNearestEffectRangeHandle(
      {
        startPercent: rangeStartPercent,
        endPercent: rangeEndPercent,
      },
      percent,
    );
    beginRangePointerDrag(nearestHandle, event);
  };

  const handleRangeHandleKeydown = (
    handle: EffectRangeHandle,
    event: KeyboardEvent,
  ) => {
    const baseStep = event.shiftKey ? 5 : 1;
    let nextRange = null as
      | {
          startPercent: number;
          endPercent: number;
        }
      | null;

    switch (event.key) {
      case "ArrowLeft":
      case "ArrowDown":
        nextRange = nudgeEffectRangeHandle(
          {
            startPercent: rangeStartPercent,
            endPercent: rangeEndPercent,
          },
          handle,
          -baseStep,
          MIN_EFFECT_RANGE_GAP_PERCENT,
        );
        break;
      case "ArrowRight":
      case "ArrowUp":
        nextRange = nudgeEffectRangeHandle(
          {
            startPercent: rangeStartPercent,
            endPercent: rangeEndPercent,
          },
          handle,
          baseStep,
          MIN_EFFECT_RANGE_GAP_PERCENT,
        );
        break;
      case "PageDown":
        nextRange = nudgeEffectRangeHandle(
          {
            startPercent: rangeStartPercent,
            endPercent: rangeEndPercent,
          },
          handle,
          -10,
          MIN_EFFECT_RANGE_GAP_PERCENT,
        );
        break;
      case "PageUp":
        nextRange = nudgeEffectRangeHandle(
          {
            startPercent: rangeStartPercent,
            endPercent: rangeEndPercent,
          },
          handle,
          10,
          MIN_EFFECT_RANGE_GAP_PERCENT,
        );
        break;
      case "Home":
        nextRange =
          handle === "start"
            ? moveEffectRangeHandle(
                {
                  startPercent: rangeStartPercent,
                  endPercent: rangeEndPercent,
                },
                "start",
                0,
                MIN_EFFECT_RANGE_GAP_PERCENT,
              )
            : moveEffectRangeHandle(
                {
                  startPercent: rangeStartPercent,
                  endPercent: rangeEndPercent,
                },
                "end",
                rangeStartPercent + MIN_EFFECT_RANGE_GAP_PERCENT,
                MIN_EFFECT_RANGE_GAP_PERCENT,
              );
        break;
      case "End":
        nextRange =
          handle === "end"
            ? moveEffectRangeHandle(
                {
                  startPercent: rangeStartPercent,
                  endPercent: rangeEndPercent,
                },
                "end",
                100,
                MIN_EFFECT_RANGE_GAP_PERCENT,
              )
            : moveEffectRangeHandle(
                {
                  startPercent: rangeStartPercent,
                  endPercent: rangeEndPercent,
                },
                "start",
                rangeEndPercent - MIN_EFFECT_RANGE_GAP_PERCENT,
                MIN_EFFECT_RANGE_GAP_PERCENT,
              );
        break;
      default:
        return;
    }

    event.preventDefault();
    if (nextRange) {
      applyEffectRangeFromPercents(
        nextRange.startPercent,
        nextRange.endPercent,
      );
    }
  };

  const applyEnvelopeSettings = () => {
    reactiveEnvelope.set({
      target,
      rangeStartHz: effectRangeStartHz,
      rangeEndHz: effectRangeEndHz,
      attackMs,
      releaseMs,
      threshold,
      sensitivity,
    });
  };

  const applyAutomationBounds = () => {
    const speedMin = clampValue(speedMinValue, speedDomainMin, speedDomainMax - 0.01);
    const speedMax = clampValue(speedMaxValue, speedMin + 0.01, speedDomainMax);
    const stutterMin = 0;
    const stutterMax = 0;

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

  const ensureAudioGraph = async (resumeContext = true) => {
    if (!context) context = new AudioContext();
    if (resumeContext && context.state === "suspended") await context.resume();

    if (!analyser) {
      analyser = context.createAnalyser();
      analyser.fftSize = 4096;
      analyser.smoothingTimeConstant = 0.28;
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
    await ensureAudioGraph(false);
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

  const pushDetectedOnset = (value: number, timestamp: number) => {
    lastDetectedOnsetMs = Date.now();
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
      const full = bandAverage(EFFECT_RANGE_MIN_HZ, EFFECT_RANGE_MAX_HZ);
      const targetedRaw = bandAverage(effectRangeStartHz, effectRangeEndHz);
      const scaledTarget = clampValue(
        ((targetedRaw - threshold) / Math.max(0.01, 1 - threshold)) *
          sensitivity,
        0,
        1,
      );
      const scaledFull = clampValue(
        ((full - threshold) / Math.max(0.01, 1 - threshold)) * sensitivity,
        0,
        1,
      );

      if (fftData.length > 0) {
        const binSize = Math.max(1, Math.floor(fftData.length / spectrumBars.length));
        spectrumBars = spectrumBars.map((_, barIndex) => {
          const start = barIndex * binSize;
          const end = Math.min(fftData!.length, start + binSize);
          let total = 0;
          let peak = 0;
          for (let index = start; index < end; index += 1) {
            const normalized = fftData![index] / 255;
            total += normalized;
            peak = Math.max(peak, normalized);
          }
          if (end <= start) return 0;
          const average = total / (end - start);
          return clampValue(peak * 0.72 + average * 0.28, 0, 1);
        });
      }

      const onsetOpen = targetedRaw > threshold;
      if (onsetOpen && !onsetWasOpen) pushDetectedOnset(targetedRaw, timestamp);
      onsetWasOpen = onsetOpen;

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
    audioOnsets.set([]);
    liveDetectedOnsets.set([]);
    switchProgressEvents.set([]);
    transportAlignment.set({
      firstBeatSeconds: 0,
      source: "default",
    });
    onsetTransportState.set({
      progressCount: 0,
      target: 4,
      armed: false,
      blockedReason: null,
      progressMode: "analyzed",
      lastTransportSlot: null,
    });
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
      status = `${status} (Essentia key missing — set VITE_ESSENTIA_API_KEY or ESSENTIA_API_KEY in project .env, then restart dev / rebuild)`;
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
      status =
        "Set VITE_ESSENTIA_API_KEY or ESSENTIA_API_KEY in .env to run BPM/section detection.";
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
      const normalizedConfidence = clampValue(full.confidence, 0, 1);
      tempoState.update((state) => ({
        ...state,
        bpm: full.bpm,
        confidence: normalizedConfidence,
        source: "auto",
        downbeatEpochMs: Date.now() - firstBeatSeconds * 1000,
      }));
      transportAlignment.set({
        firstBeatSeconds,
        source: "essentia",
      });
      detectedTempo.set({
        bpm: full.bpm,
        confidence: normalizedConfidence,
        source: "essentia",
        updatedAtMs: Date.now(),
      });
      const sectionCounts = new Map<string, number>();
      audioOnsets.set(
        full.onsets.map((onset, index) => ({
          id: `ess-onset-${index}`,
          timestampMs: Date.now(),
          timeSeconds: Math.max(0, onset),
          band: "full" as const,
          value: 1,
          threshold: 0,
          counted: false,
          source: "essentia" as const,
        })),
      );

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

      status = "Essentia detection complete.";
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
    essentiaApiKey = defaultEssentiaApiKey;
    syncEffectRange({
      startHz: $reactiveEnvelope.rangeStartHz,
      endHz: $reactiveEnvelope.rangeEndHz,
    });
    applyEnvelopeSettings();
    startFftLoop();
    speedMinValue = $automationBounds.speedMin;
    speedMaxValue = $automationBounds.speedMax;
    stutterMinValue = $automationBounds.stutterMin;
    stutterMaxValue = $automationBounds.stutterMax;
  });

  $: ({
    curve: spectrumCurvePath,
    area: spectrumAreaPath,
  } = buildSpectrumPaths(spectrumBars));
  $: selectedRangeLabel = `${formatFrequency(effectRangeStartHz)} – ${formatFrequency(effectRangeEndHz)}`;
  $: selectedRangeRouting = describeEffectRangeRouting({
    startHz: effectRangeStartHz,
    endHz: effectRangeEndHz,
  });
  $: onsetTransportPresentation = describeOnsetTransportState($onsetTransportState);
  $: onsetDetectionState = essentiaLoading
    ? "waiting"
    : status.startsWith("Essentia detection failed:")
      ? "error"
      : $audioOnsets.length > 0 && $detectedTempo.source === "essentia"
        ? "ready"
        : "waiting";

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
    stopRangePointerDrag();
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

      <MidiTriggerPanel />

      <div
        class="flex items-center justify-between gap-2 rounded-sm px-1.5 py-0.5 font-mono text-[0.6rem] {onsetDetectionState === 'ready'
          ? 'bg-emerald-500/10 border border-emerald-500/60'
          : onsetDetectionState === 'error'
            ? 'bg-error-500/10 border border-error-500/70'
            : 'bg-surface-950 border border-surface-700'}"
      >
        <span class="uppercase font-bold tracking-wide {onsetDetectionState === 'ready'
          ? 'text-emerald-300'
          : onsetDetectionState === 'error'
            ? 'text-error-200'
            : 'text-surface-400'}"
          >Onsets</span
        >
        <span class={onsetDetectionState === 'ready'
          ? 'text-emerald-200'
          : onsetDetectionState === 'error'
            ? 'text-error-100'
            : 'text-surface-300'}>
          {onsetDetectionState === "ready"
            ? `${$audioOnsets.length} returned · ${$detectedTempo.bpm?.toFixed(2) ?? "--"} BPM`
            : onsetDetectionState === "error"
              ? status.replace("Essentia detection failed: ", "")
              : essentiaLoading
                ? "Detecting analyzed onsets…"
                : "Waiting for analyzed onsets"}
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
        class="grid grid-cols-[minmax(0,1fr)_auto_46px_auto_46px] items-center gap-1 bg-surface-950 p-1 border border-surface-800 rounded-sm"
      >
        <div class="flex min-w-0 flex-col gap-1">
          <div class="flex items-center justify-between gap-2">
            <span class="text-surface-500 uppercase font-bold text-[0.55rem]"
              >Effect Range</span
            >
            <span class="truncate text-[0.58rem] font-mono text-primary-300"
              >{target.toUpperCase()} · {selectedRangeLabel}</span
            >
          </div>
          <div class="flex flex-wrap gap-1">
            {#each FREQUENCY_PRESETS as preset}
              <button
                class="rounded-sm border px-1.5 py-0.5 text-[0.52rem] font-bold uppercase tracking-wide {target === preset.id
                  ? 'border-primary-500 bg-primary-500/15 text-primary-300'
                  : 'border-surface-700 bg-surface-900 text-surface-400 hover:bg-surface-800'}"
                aria-pressed={target === preset.id}
                on:click={() => selectPresetRange(preset.id)}>{preset.label}</button
              >
            {/each}
          </div>
        </div>
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

      <div
        class="bg-surface-950 border border-surface-800 rounded-sm p-1 flex flex-col gap-1"
        data-testid="fft-analyzer-visual"
        title="FFT analyzer: the smoothed curve shows captured spectrum energy, Low/Mid/High regions stay labeled, and the highlighted frequency span drives the live effect envelope."
      >
        <div class="flex items-center justify-between text-[0.55rem] uppercase font-bold text-surface-400">
          <span>FFT Analyzer</span>
          <span class="font-mono text-primary-300">{selectedRangeRouting.label} · Thr {threshold.toFixed(2)}</span>
        </div>
        <div class="relative h-32 overflow-hidden rounded-sm border border-surface-800 bg-surface-950">
          <div class="absolute inset-0">
            {#each FREQUENCY_PRESETS.filter((preset) => preset.id !== "full") as preset}
              <div
                class="absolute inset-y-0 border-r border-surface-800/60 text-[0.5rem] font-bold uppercase tracking-[0.2em] text-surface-500/85"
                style={`left:${frequencyToPercent(preset.startHz)}%; width:${frequencyToPercent(preset.endHz) - frequencyToPercent(preset.startHz)}%`}
              >
                <span class="absolute left-2 top-2">{preset.label}</span>
              </div>
            {/each}
          </div>
          <div
            class="absolute inset-y-0 rounded-sm border border-primary-400/65 bg-primary-500/10 shadow-[inset_0_0_24px_rgba(245,158,11,0.18)]"
            style={`left:${rangeStartPercent}%; width:${Math.max(0, rangeEndPercent - rangeStartPercent)}%`}
          ></div>
          <div
            class="absolute left-0 right-0 border-t border-primary-400/70"
            style={`bottom:${threshold * 100}%`}
          ></div>
          <svg class="absolute inset-0 h-full w-full" viewBox={`0 0 ${spectrumPathWidth} ${spectrumPathHeight}`} preserveAspectRatio="none" aria-hidden="true">
            <defs>
              <linearGradient id="fft-area-gradient" x1="0" x2="0" y1="0" y2="1">
                <stop offset="0%" stop-color="rgba(96,165,250,0.35)" />
                <stop offset="100%" stop-color="rgba(96,165,250,0.02)" />
              </linearGradient>
            </defs>
            <path d={spectrumAreaPath} fill="url(#fft-area-gradient)"></path>
            <path
              d={spectrumCurvePath}
              fill="none"
              stroke="rgba(125,211,252,0.95)"
              stroke-linejoin="round"
              stroke-linecap="round"
              stroke-width="1.8"
            ></path>
          </svg>
          <div
            class="pointer-events-none absolute -top-0.5 -translate-x-1/2 rounded-sm border border-primary-500/60 bg-surface-950/95 px-1 py-0.5 text-[0.5rem] font-mono text-primary-200 shadow-[0_0_12px_rgba(245,158,11,0.2)]"
            style={`left:${rangeStartPercent}%`}
          >
            {formatFrequency(effectRangeStartHz)}
          </div>
          <div
            class="pointer-events-none absolute -top-0.5 -translate-x-1/2 rounded-sm border border-primary-500/60 bg-surface-950/95 px-1 py-0.5 text-[0.5rem] font-mono text-primary-200 shadow-[0_0_12px_rgba(245,158,11,0.2)]"
            style={`left:${rangeEndPercent}%`}
          >
            {formatFrequency(effectRangeEndHz)}
          </div>
          {#if Date.now() - lastDetectedOnsetMs < 180}
            <div class="absolute inset-0 border border-primary-300 shadow-[inset_0_0_20px_rgba(245,158,11,0.35)]"></div>
          {/if}
        </div>
        <div class="grid grid-cols-[1fr_auto] gap-2 text-[0.55rem] font-mono text-surface-400">
          <div class="grid grid-cols-4 gap-1">
            <span class={target === "low" ? "text-emerald-300" : ""}>LOW {$audioBands.low.toFixed(2)}</span>
            <span class={target === "mid" ? "text-primary-300" : ""}>MID {$audioBands.mid.toFixed(2)}</span>
            <span class={target === "high" ? "text-cyan-300" : ""}>HIGH {$audioBands.high.toFixed(2)}</span>
            <span class={target === "full" ? "text-primary-300" : ""}>FULL {$audioBands.full.toFixed(2)}</span>
          </div>
          <span class="text-primary-200">DRV {$audioBands.envelopeA.toFixed(2)}</span>
        </div>
        <div
          class="relative rounded-sm border border-surface-800 bg-surface-950 px-2 py-2"
          data-testid="fft-range-selector"
        >
          <div class="mb-2 flex items-center justify-between text-[0.52rem] uppercase tracking-wide text-surface-500">
            <span class="font-bold">Effect span</span>
            <span class="font-mono text-primary-300">{selectedRangeLabel}</span>
          </div>
          <div
            bind:this={rangeSelectorTrackEl}
            role="group"
            aria-label="Effect range selector track"
            class="relative h-11 touch-none select-none"
            on:pointerdown={handleRangeTrackPointerDown}
          >
            <div class="absolute inset-x-0 top-1/2 h-1.5 -translate-y-1/2 rounded-full bg-surface-800"></div>
            {#each FREQUENCY_PRESETS.filter((preset) => preset.id !== "full") as preset}
              <div
                class="pointer-events-none absolute inset-y-1 rounded-sm border border-surface-800/60 bg-surface-900/50"
                style={`left:${frequencyToPercent(preset.startHz)}%; width:${frequencyToPercent(preset.endHz) - frequencyToPercent(preset.startHz)}%`}
                aria-hidden="true"
              >
                <span class="absolute left-1 top-0.5 text-[0.46rem] font-bold uppercase tracking-[0.18em] text-surface-500/80">
                  {preset.label}
                </span>
              </div>
            {/each}
            <div
              class="pointer-events-none absolute inset-y-1 rounded-sm border border-primary-400/70 bg-primary-500/12 shadow-[0_0_16px_rgba(245,158,11,0.25)]"
              style={`left:${rangeStartPercent}%; width:${Math.max(0, rangeEndPercent - rangeStartPercent)}%`}
            ></div>
            <button
              type="button"
              data-range-handle="start"
              role="slider"
              aria-label="Effect range start frequency"
              aria-orientation="horizontal"
              aria-valuemin={EFFECT_RANGE_MIN_HZ}
              aria-valuemax={Math.round(effectRangeEndHz)}
              aria-valuenow={Math.round(effectRangeStartHz)}
              aria-valuetext={formatFrequency(effectRangeStartHz)}
              class="absolute top-1/2 z-10 h-5 w-5 -translate-x-1/2 -translate-y-1/2 rounded-full border border-primary-300 bg-surface-950 shadow-[0_0_0_1px_rgba(245,158,11,0.12),0_0_16px_rgba(245,158,11,0.25)] outline-none transition hover:scale-105 focus-visible:ring-2 focus-visible:ring-primary-400/70"
              class:border-primary-100={activeRangeHandle === "start"}
              class:scale-105={activeRangeHandle === "start"}
              style={`left:${rangeStartPercent}%`}
              on:pointerdown={(event) => beginRangePointerDrag("start", event)}
              on:keydown={(event) => handleRangeHandleKeydown("start", event)}
            >
              <span class="sr-only">Move range start</span>
            </button>
            <button
              type="button"
              data-range-handle="end"
              role="slider"
              aria-label="Effect range end frequency"
              aria-orientation="horizontal"
              aria-valuemin={Math.round(effectRangeStartHz)}
              aria-valuemax={EFFECT_RANGE_MAX_HZ}
              aria-valuenow={Math.round(effectRangeEndHz)}
              aria-valuetext={formatFrequency(effectRangeEndHz)}
              class="absolute top-1/2 z-10 h-5 w-5 -translate-x-1/2 -translate-y-1/2 rounded-full border border-primary-300 bg-surface-950 shadow-[0_0_0_1px_rgba(245,158,11,0.12),0_0_16px_rgba(245,158,11,0.25)] outline-none transition hover:scale-105 focus-visible:ring-2 focus-visible:ring-primary-400/70"
              class:border-primary-100={activeRangeHandle === "end"}
              class:scale-105={activeRangeHandle === "end"}
              style={`left:${rangeEndPercent}%`}
              on:pointerdown={(event) => beginRangePointerDrag("end", event)}
              on:keydown={(event) => handleRangeHandleKeydown("end", event)}
            >
              <span class="sr-only">Move range end</span>
            </button>
            <div
              class="pointer-events-none absolute top-0 z-20 -translate-x-1/2 rounded-sm border border-primary-500/60 bg-surface-950/95 px-1 py-0.5 text-[0.5rem] font-mono text-primary-200 shadow-[0_0_12px_rgba(245,158,11,0.2)]"
              style={`left:${rangeStartPercent}%`}
            >
              {formatFrequency(effectRangeStartHz)}
            </div>
            <div
              class="pointer-events-none absolute top-0 z-20 -translate-x-1/2 rounded-sm border border-primary-500/60 bg-surface-950/95 px-1 py-0.5 text-[0.5rem] font-mono text-primary-200 shadow-[0_0_12px_rgba(245,158,11,0.2)]"
              style={`left:${rangeEndPercent}%`}
            >
              {formatFrequency(effectRangeEndHz)}
            </div>
          </div>
          <div class="mt-2 flex items-center justify-between text-[0.5rem] font-mono text-surface-500">
            <span>{formatFrequency(EFFECT_RANGE_MIN_HZ)}</span>
            <span>{formatFrequency(EFFECT_RANGE_MAX_HZ)}</span>
          </div>
          <div class="mt-2 grid grid-cols-[auto_1fr] gap-2 rounded-sm border border-surface-800 bg-surface-900/70 px-2 py-1 text-[0.52rem]">
            <span class="font-bold uppercase tracking-wide text-surface-500">Routing</span>
            <span class="text-surface-300">{selectedRangeRouting.detail}</span>
          </div>
          <div class="sr-only">
            <label for="effect-range-start-input">Effect range start frequency</label>
            <input
              id="effect-range-start-input"
              type="range"
              min="0"
              max="100"
              step="0.5"
              value={rangeStartPercent}
              on:input={handleRangeStartInput}
            />
            <label for="effect-range-end-input">Effect range end frequency</label>
            <input
              id="effect-range-end-input"
              type="range"
              min="0"
              max="100"
              step="0.5"
              value={rangeEndPercent}
              on:input={handleRangeEndInput}
            />
          </div>
        </div>
      </div>

      <div class="flex flex-col gap-1 mt-1">
        <div
          class="rounded-sm border px-2 py-1 text-[0.55rem] font-mono uppercase tracking-wide {onsetTransportPresentation.tone === 'armed'
            ? 'border-emerald-500/70 bg-emerald-500/10 text-emerald-100'
            : onsetTransportPresentation.tone === 'error'
              ? 'border-error-500/70 bg-error-500/10 text-error-100'
            : onsetTransportPresentation.tone === 'warning'
              ? 'border-amber-400/70 bg-amber-500/10 text-amber-100'
              : 'border-surface-700 bg-surface-950 text-surface-300'}"
          data-testid="onset-transport-status"
          title="Authoritative onset transport state: analyzed markers remain authoritative, fallback is labeled, and armed/holding states stay explicit."
        >
          <div class="font-bold">{onsetTransportPresentation.headline}</div>
          <div class="normal-case tracking-normal text-[0.52rem]">{onsetTransportPresentation.detail}</div>
        </div>
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
        class="grid grid-cols-[auto_52px_auto_52px] items-center gap-1 bg-surface-950 p-1 border border-surface-800 rounded-sm font-mono text-[0.58rem]"
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
