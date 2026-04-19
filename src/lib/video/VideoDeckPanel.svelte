<script lang="ts">
  import { onDestroy, onMount } from "svelte";
  import {
    applyVideoTimeShape,
    composePlaybackEffects,
    evaluateAudioTrigger,
    findTimeShapeGesturePreset,
    findTimeShaperEnvelopePreset,
    findActiveMidiTriggerEvent,
    sampleEnvelopePreset,
    shouldUseContinuousTimeShaperFallback,
    TIME_SHAPE_GESTURE_PRESETS,
    type VideoTimeShapeCurve,
  } from "$lib/runtime/time-shaper";
  import {
    activeSection,
    audioRuntime,
    automationBounds,
    automationRuntime,
    audioBands,
    midiTriggerStreams,
    reactiveEnvelope,
    runtimeCapabilities,
    tempoState,
    timeShaperEnvelopePresetId,
    timeShaperRecentEvents,
    timeShaperTriggerShiftMs,
    timeShaperTriggerSource,
    transportAlignment,
  } from "$lib/stores/runtime";
  import { videoDeckAuthority, type VideoDeckClipRecord } from "$lib/stores/videoDeck";
  import {
    SPEED_AUTOMATION_DOMAIN,
    clampValue,
    mapNormalizedToRange,
    normalizeAutomationBounds,
  } from "$lib/runtime/automationBounds";
  import {
    describeVideoDeckSwitchNotice,
    type VideoDeckPrewarmStatus,
  } from "$lib/video/hotDeckSwitchStatus";
  import { enforceSilentVideoElement } from "$lib/video/mediaMute";
  import { WebGpuVideoPresenter } from "$lib/rendering/webgpu/WebGpuVideoPresenter";
  import type { TimeShaperTriggerEvent } from "$lib/midi/types";
  import EnvelopePresetGallery from "$lib/time-shaper/EnvelopePresetGallery.svelte";
  import TriggerEventStrip from "$lib/time-shaper/TriggerEventStrip.svelte";

  export let duration = 0;
  export let currentTime = 0;
  export let autoSwitchEnabled = true;
  export let quantizeMode: "beat" | "bar" = "beat";
  export let seekTo: (time: number) => void = () => {};
  const seekPlayer = (t: number) => {
    if (!player || !Number.isFinite(t)) return;
    player.currentTime = Math.max(0, Math.min(t, duration || t));
  };

  let clips: VideoDeckClipRecord[] = [];
  let selectedClipId = "";
  let player: HTMLVideoElement | null = null;
  let prewarmPlayer: HTMLVideoElement | null = null;
  let webGpuCanvas: HTMLCanvasElement | null = null;
  let authorityStatus = "";
  let uiStatus = "Drop or upload clips to begin playback.";
  let envelopeGateEnabled = true;
  let speedRampEnabled = true;
  let timeShaperEnabled = true;
  let selectedTimeShapePresetId = "stutter-1-8";
  let timeShaperMix = 0.82;
  let timeShaperDepth = 0.86;
  let timeShaperCooldownMs = 950;
  let timeShaperStatus = "TimeShaper armed";
  let timeShaperLastAppliedMs = 0;
  let timeShaperLastTriggeredAtMs: number | null = null;
  let timeShaperActiveUntilMs = 0;
  let timeShaperNextTriggerAllowedAtMs = 0;
  let timeShaperAudioTriggerStartSeconds: number | null = null;
  let timeShaperAudioTriggerId = "";
  let lastLoggedTimeShaperEventId = "";
  let timeShaperPanelCollapsed = true;
  let timeShaperPanelTab: "presets" | "triggers" = "presets";
  let switchSkipChancePercent = 0;
  let onsetSwitchTarget = 4;
  let onsetCountForClip = 0;
  const maxOnsetDots = 8;
  let currentPlaybackRate = 1;
  let currentAutomationRate = 1;
  let playbackRafId = 0;
  let pendingSeekRatio: number | null = null;
  let resumeAfterSwitch = false;
  let prewarmClipId = "";
  let prewarmStatus: VideoDeckPrewarmStatus = "idle";
  const matrixColumns = 14;
  const totalMatrixSlots = matrixColumns * 3;
  let matrixCollapsed = true;
  let uploadLane = 0;
  let laneMuted = [false, false, false];
  let soloLane: number | null = null;
  let lastSelectedClipId = "";
  let prewarmReady = false;
  let webGpuPresenter: WebGpuVideoPresenter | null = null;
  let webGpuEngineReady = false;
  let webGpuEngineError: string | null = null;
  let webGpuFramePresented = false;
  let videoFrameCallbackId: number | null = null;
  let videoFrameCallbackSource: HTMLVideoElement | null = null;
  let lastPresentedFrameAtMs = 0;
  let videoPlaybackActive = false;
  let switchInFlight = false;
  const speedDomainMin = SPEED_AUTOMATION_DOMAIN.min;
  const speedDomainMax = SPEED_AUTOMATION_DOMAIN.max;

  type VideoFrameCallbackCapable = HTMLVideoElement & {
    requestVideoFrameCallback?: (
      callback: (now: DOMHighResTimeStamp, metadata: VideoFrameCallbackMetadata) => void,
    ) => number;
    cancelVideoFrameCallback?: (handle: number) => void;
  };
  const wrapMediaTime = (value: number, mediaDuration: number): number => {
    if (!Number.isFinite(value)) return 0;
    if (!Number.isFinite(mediaDuration) || mediaDuration <= 0) return Math.max(0, value);
    const wrapped = value % mediaDuration;
    return wrapped < 0 ? wrapped + mediaDuration : wrapped;
  };

  const makeId = (): string =>
    `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

  const formatFrequencyLabel = (value: number): string => {
    if (!Number.isFinite(value)) return "0Hz";
    if (value >= 1000) {
      const normalized = value / 1000;
      return `${normalized >= 10 ? normalized.toFixed(0) : normalized.toFixed(1)}kHz`;
    }
    return `${Math.round(value)}Hz`;
  };

  const syncEngineTruth = () => {
    const webGpuActive = webGpuEngineReady && webGpuFramePresented && !webGpuEngineError;
    runtimeCapabilities.update((state) => ({
      ...state,
      selectedRenderer: "webgpu",
      selectedDecode: "htmlvideo",
      hotDecks: {
        ...state.hotDecks,
        useWebGpuHotDecks: true,
      },
      activeRenderer: webGpuActive ? "webgpu" : "webgl2",
      activeDecode: "htmlvideo",
      activationState: webGpuActive
        ? "webgpu_active"
        : webGpuEngineError
          ? "engine_error"
          : "webgpu_required",
      fallbackReason: webGpuActive
        ? null
        : "MasterSelects-style WebGPU playback has not produced a valid frame yet.",
      engineLoadError: webGpuActive ? null : webGpuEngineError,
    }));
  };

  const ensureWebGpuPresenter = async () => {
    if (webGpuEngineReady || !webGpuCanvas) return;
    try {
      if (!webGpuPresenter) webGpuPresenter = new WebGpuVideoPresenter();
      await webGpuPresenter.attach(webGpuCanvas);
      webGpuPresenter.setSource(player);
      webGpuEngineReady = true;
      webGpuEngineError = null;
      webGpuFramePresented = false;
    } catch (error) {
      webGpuEngineReady = false;
      webGpuEngineError = error instanceof Error ? error.message : "unknown engine error";
      webGpuFramePresented = false;
    }
    syncEngineTruth();
  };

  const syncVideoPlaybackState = () => {
    videoPlaybackActive = Boolean(
      !switchInFlight && player && !player.paused && !player.ended && player.currentSrc,
    );
  };

  const resumeCurrentPlayer = async () => {
    if (!player) return;
    try {
      await player.play();
      switchInFlight = false;
      syncVideoPlaybackState();
      if (!(player as VideoFrameCallbackCapable).requestVideoFrameCallback) {
        renderWebGpuFrame();
      }
    } catch (error) {
      switchInFlight = false;
      syncVideoPlaybackState();
      uiStatus = `Video playback failed: ${error instanceof Error ? error.message : "unknown error"}`;
    }
  };

  const renderWebGpuFrame = () => {
    if (!webGpuEngineReady) return;
    try {
      const rendered = webGpuPresenter?.render() ?? false;
      if (rendered) {
        webGpuFramePresented = true;
      }
    } catch (error) {
      webGpuEngineReady = false;
      webGpuFramePresented = false;
      webGpuEngineError = error instanceof Error ? error.message : "unknown engine error";
      syncEngineTruth();
      return;
    }
    syncEngineTruth();
  };

  const cancelVideoFramePump = () => {
    const source = videoFrameCallbackSource as VideoFrameCallbackCapable | null;
    if (
      source &&
      videoFrameCallbackId !== null &&
      typeof source.cancelVideoFrameCallback === "function"
    ) {
      source.cancelVideoFrameCallback(videoFrameCallbackId);
    }
    videoFrameCallbackId = null;
    videoFrameCallbackSource = null;
  };

  const scheduleVideoFramePump = (source: HTMLVideoElement | null = player) => {
    const frameSource = source as VideoFrameCallbackCapable | null;
    if (
      !webGpuEngineReady ||
      !frameSource ||
      typeof frameSource.requestVideoFrameCallback !== "function"
    ) {
      cancelVideoFramePump();
      return;
    }

    if (videoFrameCallbackSource === frameSource && videoFrameCallbackId !== null) return;
    cancelVideoFramePump();

    const pump = () => {
      if (
        !webGpuEngineReady ||
        !frameSource.currentSrc ||
        frameSource !== player ||
        typeof frameSource.requestVideoFrameCallback !== "function"
      ) {
        cancelVideoFramePump();
        return;
      }

      videoFrameCallbackSource = frameSource;
      videoFrameCallbackId = frameSource.requestVideoFrameCallback((_, metadata) => {
        videoFrameCallbackId = null;
        lastPresentedFrameAtMs = performance.now();
        currentTime = metadata.mediaTime ?? frameSource.currentTime ?? 0;
        renderWebGpuFrame();
        if (!frameSource.paused && !frameSource.ended) {
          pump();
        } else {
          cancelVideoFramePump();
        }
      });
    };

    pump();
  };

  let currentClip: VideoDeckClipRecord | undefined = undefined;
  let currentClipIndex = -1;
  let currentTimeShapePreset = TIME_SHAPE_GESTURE_PRESETS[0];
  let nextPrewarmClip: VideoDeckClipRecord | undefined = undefined;
  let switchNotice = describeVideoDeckSwitchNotice({
    autoSwitchEnabled,
    playableClipCount: 0,
    currentClipName: undefined,
    nextClipName: undefined,
    prewarmStatus,
  });
  let playableClipCount = 0;
  let matrixSummary = "No clips loaded";
  let timeShapePreviewPoints = "";
  let timeShapePreviewPhase = 0;
  let timeShaperTriggerLabel = "20Hz–14kHz";
  let transportTimeSeconds = 0;
  let recentTimeShaperEvents: TimeShaperTriggerEvent[] = [];

  $: selectedClipId = $videoDeckAuthority.selectedClipId;
  $: authorityStatus = $videoDeckAuthority.status;
  $: onsetCountForClip = $videoDeckAuthority.onsetCountForClip;
  $: currentClip = clips.find((clip) => clip.id === selectedClipId);
  $: currentClipIndex = clips.findIndex((clip) => clip.id === selectedClipId);
  $: currentTimeShapePreset = findTimeShapeGesturePreset(selectedTimeShapePresetId);
  $: nextPrewarmClip = (() => {
    const playable = playableClips();
    if (playable.length < 2 || !selectedClipId) return undefined;
    const currentIndex = playable.findIndex((clip) => clip.id === selectedClipId);
    return playable[(currentIndex < 0 ? 0 : currentIndex + 1) % playable.length];
  })();
  $: if (nextPrewarmClip?.id !== prewarmClipId) {
    prewarmClipId = nextPrewarmClip?.id ?? "";
    prewarmStatus = nextPrewarmClip ? "warming" : "idle";
    if (prewarmPlayer && nextPrewarmClip) {
      prewarmPlayer.load();
    }
  }
  $: prewarmReady = prewarmStatus === "ready";
  $: switchNotice = describeVideoDeckSwitchNotice({
    autoSwitchEnabled,
    playableClipCount: playableClips().length,
    currentClipName: currentClip?.name,
    nextClipName: nextPrewarmClip?.name,
    prewarmStatus,
  });
  $: playableClipCount = playableClips().length;
  $: matrixSummary = clips.length
    ? `${clips.length}/${totalMatrixSlots} loaded · ${playableClipCount} live${currentClip ? ` · Now ${currentClip.name.replace(/\.[^/.]+$/, "")}` : ""}`
    : "No clips loaded";
  $: timeShapePreviewPoints = currentTimeShapePreset.points
    .map((point) => `${Math.max(0, Math.min(1, point.x)) * 100},${50 - Math.max(-1, Math.min(1, point.y)) * 38}`)
    .join(" "), currentTimeShapePreset.id;
  $: timeShapePreviewPhase = (() => {
    const cycle = Math.max(0.0001, currentTimeShapePreset.cycleBeats);
    const phase = (getTransportBeatPosition() % cycle) / cycle;
    return Math.max(0, Math.min(100, phase * 100));
  })();
  $: timeShaperTriggerLabel = `${formatFrequencyLabel($reactiveEnvelope.rangeStartHz)}–${formatFrequencyLabel($reactiveEnvelope.rangeEndHz)}`;
  $: transportTimeSeconds = getTransportTimeSeconds();
  $: recentTimeShaperEvents = $timeShaperRecentEvents.slice(-16);
  $: enforceSilentVideoElement(player);
  $: enforceSilentVideoElement(prewarmPlayer);
  $: if (webGpuEngineReady) {
    webGpuPresenter?.setSource(player);
    scheduleVideoFramePump(player);
  } else {
    cancelVideoFramePump();
  }
  $: if (webGpuCanvas) {
    void ensureWebGpuPresenter();
  }
  $: videoDeckAuthority.update((state) => ({
    ...state,
    clips,
    laneMuted: [...laneMuted],
    soloLane,
    autoSwitchEnabled,
    quantizeMode,
    envelopeGateEnabled,
    onsetSwitchTarget,
    switchSkipChancePercent,
    prewarmClipId,
    prewarmReady,
    videoPlaybackActive,
  }));
  $: if (selectedClipId !== lastSelectedClipId) {
    if (lastSelectedClipId && player) {
      pendingSeekRatio = duration > 0 ? currentTime / duration : 0;
      resumeAfterSwitch = videoPlaybackActive || switchInFlight || !player.paused;
      switchInFlight = true;
      videoPlaybackActive = false;
    }
    lastSelectedClipId = selectedClipId;
  }
  const laneIsActive = (lane: number): boolean =>
    soloLane === null ? !laneMuted[lane] : soloLane === lane;
  const playableClips = (): VideoDeckClipRecord[] =>
    clips
      .filter((clip) => laneIsActive(clip.lane))
      .sort((a, b) => (a.lane === b.lane ? a.slot - b.slot : a.lane - b.lane));

  const ensurePlayableSelection = () => {
    const playable = playableClips();
    if (playable.length === 0) {
      videoDeckAuthority.update((state) => ({ ...state, selectedClipId: "" }));
      duration = 0;
      currentTime = 0;
      return;
    }
    if (!playable.some((clip) => clip.id === selectedClipId)) {
      videoDeckAuthority.update((state) => ({
        ...state,
        selectedClipId: playable[0].id,
      }));
      duration = 0;
      currentTime = 0;
    }
  };

  const clipAtMatrix = (row: number, col: number): VideoDeckClipRecord | undefined => {
    if (clips.length === 0) return undefined;
    return clips.find((clip) => clip.lane === row && clip.slot === col);
  };

  const selectClip = (id: string) => {
    videoDeckAuthority.update((state) => ({ ...state, selectedClipId: id }));
    duration = 0;
    currentTime = 0;
    uiStatus = `Selected ${clips.find((clip) => clip.id === id)?.name ?? "clip"}`;
  };

  const uploadClips = (event: Event) => {
    const lane = Number(uploadLane);
    const files = Array.from(
      (event.currentTarget as HTMLInputElement).files ?? [],
    ).filter((file) => file.type.startsWith("video/"));

    if (!files.length) {
      uiStatus = "No video files detected in selection.";
      return;
    }

    const availableSlots = Array.from(
      { length: matrixColumns },
      (_, slot) => slot,
    ).filter(
      (slot) =>
        !clips.some((clip) => clip.lane === lane && clip.slot === slot),
    );

    if (availableSlots.length === 0) {
      uiStatus = `Layer ${uploadLane + 1} is full. Remove clips or upload to another layer.`;
      return;
    }

    const acceptedFiles = files.slice(0, availableSlots.length);
    const droppedCount = files.length - acceptedFiles.length;
    const added = acceptedFiles.map((file, index) => ({
      id: makeId(),
      name: file.name,
      url: URL.createObjectURL(file),
      sizeMb: (file.size / (1024 * 1024)).toFixed(1),
      lane,
      slot: availableSlots[index],
    }));

    clips = [...clips, ...added].sort((a, b) =>
      a.lane === b.lane ? a.slot - b.slot : a.lane - b.lane,
    );
    ensurePlayableSelection();
    if (!selectedClipId) {
      videoDeckAuthority.update((state) => ({ ...state, selectedClipId: added[0].id }));
    }
    uiStatus = droppedCount
      ? `Loaded ${added.length} clip(s) to layer ${lane + 1}. ${droppedCount} clip(s) skipped.`
      : `Loaded ${added.length} clip${added.length > 1 ? "s" : ""} to layer ${lane + 1}`;
  };

  const removeClip = (id: string) => {
    const clip = clips.find((entry) => entry.id === id);
    if (clip) URL.revokeObjectURL(clip.url);
    clips = clips.filter((entry) => entry.id !== id);
    ensurePlayableSelection();
    if (selectedClipId === id)
      uiStatus = "Selected clip removed. Switched to next active clip.";
  };

  const applyOnsetTarget = () => {
    onsetSwitchTarget = Math.max(1, Math.min(32, Math.round(Number(onsetSwitchTarget) || 1)));
  };

  const getOnsetProgress = (): number =>
    onsetSwitchTarget > 0
      ? clampValue(onsetCountForClip / onsetSwitchTarget, 0, 1)
      : 0;

  const getOnsetDotCount = (): number => Math.max(1, Math.min(maxOnsetDots, onsetSwitchTarget));

  const getFilledOnsetDots = (): number => Math.round(getOnsetProgress() * getOnsetDotCount());

  const applySwitchSkipChance = () => {
    switchSkipChancePercent = Number(
      clampValue(Number(switchSkipChancePercent) || 0, 0, 100).toFixed(0),
    );
  };

  const toggleEnvelopeGate = () => {
    envelopeGateEnabled = !envelopeGateEnabled;
  };

  const buildTimeShapeCurve = (
    preset = currentTimeShapePreset,
    mixScale = 1,
  ): VideoTimeShapeCurve => ({
    points: preset.points,
    cycleBeats: preset.cycleBeats,
    yRangeBeats: preset.yRangeBeats,
    mode: preset.mode,
    playbackMode: preset.playbackMode,
    repeatWindowBeats: preset.repeatWindowBeats,
    tapeStopFloor: preset.tapeStopFloor,
    mix: timeShaperMix * mixScale,
    depth: timeShaperDepth * mixScale,
    bypass: !timeShaperEnabled,
  });

  const getTransportBeatPosition = (): number => {
    const bpm = Math.max(20, Math.min(300, $tempoState.bpm || 120));
    const secondsPerBeat = 60 / bpm;
    if ($audioRuntime.source === "file" && ($audioRuntime.isPlaying || $audioRuntime.currentTime > 0)) {
      return Math.max(0, ($audioRuntime.currentTime - $transportAlignment.firstBeatSeconds) / secondsPerBeat);
    }
    return Math.max(0, (Date.now() - $tempoState.downbeatEpochMs) / 1000 / secondsPerBeat);
  };

  const getTransportTimeSeconds = (): number => {
    if ($audioRuntime.source === "file" && ($audioRuntime.isPlaying || $audioRuntime.currentTime > 0)) {
      return Math.max(0, $audioRuntime.currentTime);
    }
    return Math.max(0, currentTime || player?.currentTime || 0);
  };

  const pushRecentTimeShaperEvent = (event: TimeShaperTriggerEvent) => {
    if (lastLoggedTimeShaperEventId === event.id) return;
    lastLoggedTimeShaperEventId = event.id;
    timeShaperRecentEvents.update((events) => [...events.slice(-31), event]);
  };

  const buildAudioTriggerEvent = (
    transportSeconds: number,
    fallbackDurationSeconds: number,
    score: number,
  ): TimeShaperTriggerEvent | null => {
    const audioEventDurationSeconds = Math.max(0.08, fallbackDurationSeconds);
    if (timeShaperAudioTriggerStartSeconds === null) return null;
    if (transportSeconds > timeShaperAudioTriggerStartSeconds + audioEventDurationSeconds) return null;
    return {
      id: timeShaperAudioTriggerId,
      source: "audio",
      label: `Audio · ${score.toFixed(2)}`,
      startSeconds: timeShaperAudioTriggerStartSeconds,
      durationSeconds: audioEventDurationSeconds,
      velocity: Math.max(0.2, Math.min(1, score)),
      color: "#f59e0b",
    };
  };

  const getTimeShaperTriggerWindow = (secondsPerBeat: number) => {
    const cycleWindowMs = Math.max(
      180,
      currentTimeShapePreset.cycleBeats * secondsPerBeat * 1000,
    );
    const repeatWindowMs = Math.max(
      120,
      (currentTimeShapePreset.repeatWindowBeats ?? currentTimeShapePreset.cycleBeats) *
        secondsPerBeat *
        1000,
    );
    const latchMs = currentTimeShapePreset.playbackMode === "stutterRepeat"
      ? Math.max(cycleWindowMs * 0.9, repeatWindowMs * 2.4)
      : cycleWindowMs * 0.92;
    const cooldownMs = currentTimeShapePreset.playbackMode === "stutterRepeat"
      ? Math.max(cycleWindowMs, repeatWindowMs * 2.8)
      : Math.max(cycleWindowMs * 1.05, 320);

    return {
      latchMs: Math.round(clampValue(latchMs, 180, 2600)),
      cooldownMs: Math.round(
        clampValue(timeShaperCooldownMs || cooldownMs, 220, 3200),
      ),
    };
  };

  const applyTimeShaper = () => {
    if (!player || player.paused || !timeShaperEnabled || !duration || duration <= 0) {
      timeShaperStatus = timeShaperEnabled ? "TimeShaper waiting" : "TimeShaper bypassed";
      return;
    }

    const now = Date.now();
    const bpm = Math.max(20, Math.min(300, $tempoState.bpm || 120));
    const secondsPerBeat = 60 / bpm;
    const triggerWindow = getTimeShaperTriggerWindow(secondsPerBeat);
    const audioTrigger = evaluateAudioTrigger(
      {
        enabled: $timeShaperTriggerSource !== "midi",
        band: "effectRange",
        threshold: $reactiveEnvelope.threshold,
        sensitivity: $reactiveEnvelope.sensitivity,
        detail: timeShaperDepth,
        triggerShiftMs: $timeShaperTriggerShiftMs,
        lastTriggeredAtMs: timeShaperLastTriggeredAtMs,
      },
      $audioBands,
      now,
    );

    const cooldownBlocked = now < timeShaperNextTriggerAllowedAtMs;
    const triggeredNow = audioTrigger.status === "triggered" && !cooldownBlocked;
    if (triggeredNow) {
      timeShaperLastTriggeredAtMs = now;
      timeShaperActiveUntilMs = now + triggerWindow.latchMs;
      timeShaperNextTriggerAllowedAtMs = now + triggerWindow.cooldownMs;
    }

    const selectedEnvelopePreset = findTimeShaperEnvelopePreset($timeShaperEnvelopePresetId);
    const defaultDurationSeconds = Math.max(
      selectedEnvelopePreset.defaultDurationBeats * secondsPerBeat,
      currentTimeShapePreset.cycleBeats * secondsPerBeat,
    );

    if (audioTrigger.status === "triggered" && audioTrigger.triggerAtMs !== null) {
      timeShaperLastTriggeredAtMs = now;
      timeShaperAudioTriggerStartSeconds =
        getTransportTimeSeconds() + (audioTrigger.triggerAtMs - now) / 1000;
      timeShaperAudioTriggerId = `audio-${audioTrigger.triggerAtMs}`;
    }

    const activeMidiEvent = findActiveMidiTriggerEvent(
      $midiTriggerStreams,
      getTransportTimeSeconds(),
      defaultDurationSeconds,
      $activeSection,
      $timeShaperTriggerShiftMs,
    );
    const activeAudioEvent = buildAudioTriggerEvent(
      getTransportTimeSeconds(),
      defaultDurationSeconds,
      audioTrigger.score,
    );

    const activeTriggerEvent =
      $timeShaperTriggerSource === "midi"
        ? activeMidiEvent
        : $timeShaperTriggerSource === "hybrid"
          ? activeMidiEvent && activeAudioEvent
            ? (activeMidiEvent.startSeconds >= activeAudioEvent.startSeconds
                ? activeMidiEvent
                : activeAudioEvent)
            : (activeMidiEvent ?? activeAudioEvent)
          : activeAudioEvent;

    if (!activeTriggerEvent) {
      const fallbackContinuousTrigger =
        now < timeShaperActiveUntilMs ||
        shouldUseContinuousTimeShaperFallback(
          $timeShaperTriggerSource,
          audioTrigger.status,
          $audioBands.envelopeA,
          $reactiveEnvelope.threshold,
          currentTimeShapePreset.id,
        );

      if (!fallbackContinuousTrigger) {
        const cooldownSeconds = Math.max(0, (timeShaperNextTriggerAllowedAtMs - now) / 1000);
        timeShaperStatus = cooldownBlocked
          ? `TS cooling ${cooldownSeconds.toFixed(1)}s · FX ${timeShaperTriggerLabel}`
          : `TS armed · FX ${timeShaperTriggerLabel} · ${audioTrigger.score.toFixed(2)}`;
        return;
      }

      const fallbackResult = applyVideoTimeShape({
        normalSourceTimeSeconds: player.currentTime || 0,
        beatPosition: getTransportBeatPosition(),
        secondsPerBeat,
        curve: buildTimeShapeCurve(),
      });
      const fallbackShapedTime = wrapMediaTime(fallbackResult.sourceTimeSeconds, duration);
      const fallbackDelta = Math.abs(fallbackShapedTime - (player.currentTime || 0));
      const fallbackSeekThreshold = fallbackResult.metadata.hardJump ? 0.01 : 0.035;
      const fallbackAllowSourceJump = fallbackResult.metadata.playbackMode !== "tapeStop";
      const fallbackMinSeekIntervalMs = webGpuEngineReady ? 78 : 45;

      if (
        fallbackAllowSourceJump &&
        !player.seeking &&
        player.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA &&
        fallbackDelta > fallbackSeekThreshold &&
        now - timeShaperLastAppliedMs > fallbackMinSeekIntervalMs
      ) {
        player.currentTime = fallbackShapedTime;
        timeShaperLastAppliedMs = now;
      }

      const fallbackPlayback = composePlaybackEffects({
        automationPlaybackRate: currentAutomationRate || 1,
        timeShaperPlaybackRate: fallbackResult.playbackRate || 1,
        mixAmount: fallbackResult.mixAmount,
        maxPlaybackRate: speedDomainMax,
      });
      player.playbackRate = fallbackPlayback.playbackRate;
      currentPlaybackRate = fallbackPlayback.playbackRate;
      timeShaperStatus = `${currentTimeShapePreset.shortLabel} · continuous fallback · ${fallbackResult.metadata.playbackMode}`;
      return;
    }

    pushRecentTimeShaperEvent(activeTriggerEvent);
    const activePreset = findTimeShapeGesturePreset(activeTriggerEvent.targetPresetId ?? selectedTimeShapePresetId);
    const eventElapsedSeconds = Math.max(0, getTransportTimeSeconds() - activeTriggerEvent.startSeconds);
    const eventDurationSeconds = Math.max(activeTriggerEvent.durationSeconds, defaultDurationSeconds);
    const eventProgress = Math.max(0, Math.min(1, eventElapsedSeconds / eventDurationSeconds));
    const envelopeAmount = sampleEnvelopePreset(selectedEnvelopePreset, eventProgress);
    const velocityMixScale = Math.max(0.2, Math.min(1, activeTriggerEvent.velocity));
    const result = applyVideoTimeShape({
      normalSourceTimeSeconds: player.currentTime || 0,
      beatPosition: eventProgress * activePreset.cycleBeats,
      secondsPerBeat,
      curve: buildTimeShapeCurve(activePreset, envelopeAmount * velocityMixScale),
    });
    const shapedTime = wrapMediaTime(result.sourceTimeSeconds, duration);
    const delta = Math.abs(shapedTime - (player.currentTime || 0));
    const seekThreshold = result.metadata.hardJump ? 0.01 : 0.035;
    const allowSourceJump = result.metadata.playbackMode !== "tapeStop";
    const minSeekIntervalMs = webGpuEngineReady ? 78 : 45;

    if (
      allowSourceJump &&
      !player.seeking &&
      player.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA &&
      delta > seekThreshold &&
      now - timeShaperLastAppliedMs > minSeekIntervalMs
    ) {
      player.currentTime = shapedTime;
      timeShaperLastAppliedMs = now;
    }

    const composedPlayback = composePlaybackEffects({
      automationPlaybackRate: currentAutomationRate || 1,
      timeShaperPlaybackRate: result.playbackRate || 1,
      mixAmount: result.mixAmount,
      maxPlaybackRate: speedDomainMax,
    });
    player.playbackRate = composedPlayback.playbackRate;
    currentPlaybackRate = composedPlayback.playbackRate;
    timeShaperStatus = `${activePreset.shortLabel} · ${selectedEnvelopePreset.label} · ${(result.mixAmount * 100).toFixed(0)}%`;
  };

  const applySpeedRamp = () => {
    if (!player || player.paused) return;
    const automationSpeedNorm = Math.max(
      0,
      Math.min(1, $automationRuntime.speed),
    );
    const normalizedAutomationBounds = normalizeAutomationBounds($automationBounds);
    const speedMinBound = normalizedAutomationBounds.speedMin;
    const speedMaxBound = normalizedAutomationBounds.speedMax;
    const automationRate = mapNormalizedToRange(
      automationSpeedNorm,
      speedMinBound,
      speedMaxBound,
    );
    currentAutomationRate = automationRate;
    const targetRate = speedRampEnabled
      ? Math.max(speedDomainMin, Math.min(speedDomainMax, automationRate))
      : 1;
    currentPlaybackRate = targetRate;
    player.playbackRate = targetRate;
  };

  const stopPlaybackLoop = () => {
    if (playbackRafId) {
      cancelAnimationFrame(playbackRafId);
      playbackRafId = 0;
    }
  };

  const startPlaybackLoop = () => {
    if (playbackRafId) return;

    const tick = () => {
      playbackRafId = requestAnimationFrame(tick);
      if (!player) return;

      currentTime = player.currentTime || 0;
      if ((!duration || duration <= 0) && Number.isFinite(player.duration)) {
        duration = player.duration;
      }

      if (!player.paused) {
        applySpeedRamp();
        applyTimeShaper();
        if (!(player as VideoFrameCallbackCapable).requestVideoFrameCallback) {
          renderWebGpuFrame();
        }
      }
    };

    playbackRafId = requestAnimationFrame(tick);
  };

  const play = async () => {
    if (!player) return;
    ensurePlayableSelection();
    if (!selectedClipId) {
      uiStatus = "No active clip available.";
      return;
    }
    applySpeedRamp();
    startPlaybackLoop();
    await resumeCurrentPlayer();
    uiStatus = `Playing ${currentClip?.name ?? "clip"}`;
  };

  const pause = () => {
    player?.pause();
    stopPlaybackLoop();
    cancelVideoFramePump();
    syncVideoPlaybackState();
    if (player) player.playbackRate = 1;
    currentPlaybackRate = 1;
    timeShaperLastAppliedMs = 0;
    timeShaperLastTriggeredAtMs = null;
    timeShaperActiveUntilMs = 0;
    timeShaperNextTriggerAllowedAtMs = 0;
    uiStatus = "Paused";
  };

  const stop = () => {
    if (!player) return;
    player.pause();
    stopPlaybackLoop();
    cancelVideoFramePump();
    syncVideoPlaybackState();
    player.currentTime = 0;
    player.playbackRate = 1;
    currentPlaybackRate = 1;
    timeShaperLastAppliedMs = 0;
    timeShaperLastTriggeredAtMs = null;
    timeShaperActiveUntilMs = 0;
    timeShaperNextTriggerAllowedAtMs = 0;
    currentTime = 0;
    uiStatus = "Stopped";
  };

  const toggleMuteLane = (lane: number) => {
    laneMuted = laneMuted.map((entry, index) =>
      index === lane ? !entry : entry,
    );
    if (laneMuted[lane] && soloLane === lane) soloLane = null;
    ensurePlayableSelection();
  };

  const toggleSoloLane = (lane: number) => {
    soloLane = soloLane === lane ? null : lane;
    ensurePlayableSelection();
  };

  const setUploadLane = (event: Event) => {
    uploadLane = Number((event.currentTarget as HTMLSelectElement).value);
  };

  $: seekTo = seekPlayer;

  onMount(() => {
    syncEngineTruth();
  });

  onDestroy(() => {
    stopPlaybackLoop();
    cancelVideoFramePump();
    webGpuPresenter?.detach();
    for (const clip of clips) URL.revokeObjectURL(clip.url);
  });
</script>

<div
  class="h-full flex flex-col gap-1 bg-surface-900 border border-surface-800 rounded-md p-1"
>
  <div
    class="flex-none flex items-center justify-between gap-2 border-b border-surface-800 pb-1 mb-1"
  >
    <div class="min-w-0 flex items-center gap-2">
      <h2
        class="text-[0.65rem] font-bold uppercase tracking-widest text-surface-400 m-0"
      >
        Video Matrix
      </h2>
      <button
        type="button"
        class="rounded-sm border border-surface-700 bg-surface-950 px-2 py-0.5 text-[0.52rem] font-bold uppercase tracking-[0.18em] text-surface-300 hover:bg-surface-800"
        aria-controls="video-matrix-grid"
        aria-expanded={!matrixCollapsed}
        on:click={() => {
          matrixCollapsed = !matrixCollapsed;
        }}
      >
        {matrixCollapsed ? "Show Grid" : "Hide Grid"}
      </button>
    </div>
    <p class="min-w-0 max-w-60 text-[0.6rem] m-0 truncate text-primary-500" aria-live="polite">
      {authorityStatus || uiStatus}
    </p>
  </div>

  {#if matrixCollapsed}
    <div
      class="flex-none flex items-center justify-between gap-2 rounded-sm border border-surface-800 bg-surface-950 px-2 py-1 text-[0.58rem] font-mono text-surface-400"
    >
      <div class="min-w-0 flex items-center gap-1.5 overflow-hidden">
        <span class="rounded-sm border border-surface-800 bg-surface-900 px-1.5 py-0.5 text-surface-200">
          {clips.length}/{totalMatrixSlots} loaded
        </span>
        <span class="rounded-sm border border-surface-800 bg-surface-900 px-1.5 py-0.5 text-surface-300">
          {playableClipCount} live
        </span>
        <span class="truncate rounded-sm border border-surface-800 bg-surface-900 px-1.5 py-0.5 text-surface-300">
          {matrixSummary}
        </span>
      </div>
      <span class="hidden xl:inline text-[0.5rem] uppercase tracking-[0.18em] text-surface-500">
        Matrix Collapsed
      </span>
    </div>
  {:else}
    <div
      id="video-matrix-grid"
      class="flex-none flex flex-col gap-[1px] bg-surface-800 border border-surface-800 rounded-sm overflow-hidden text-[0.6rem]"
    >
      {#each [2, 1, 0] as layer}
        <div class="flex items-stretch bg-surface-950">
          <div
            class="w-16 flex flex-col items-center justify-center gap-1 bg-surface-900 p-1 border-r border-surface-800"
          >
            <span class="text-[0.55rem] text-surface-400 font-bold uppercase"
              >L{layer + 1}</span
            >
            <div class="flex gap-1 w-10">
              <button
                class="w-5 h-5 rounded-sm flex items-center justify-center font-bold text-[0.55rem] bg-surface-800 {laneMuted[
                  layer
                ]
                  ? 'text-error-500 border border-error-500'
                  : 'text-surface-400 border border-surface-700'}"
                aria-label={`Mute layer ${layer + 1}`}
                on:click={() => toggleMuteLane(layer)}>M</button
              >
              <button
                class="w-5 h-5 rounded-sm flex items-center justify-center font-bold text-[0.55rem] bg-surface-800 {soloLane ===
                layer
                  ? 'text-primary-500 border border-primary-500'
                  : 'text-surface-400 border border-surface-700'}"
                aria-label={`Solo layer ${layer + 1}`}
                on:click={() => toggleSoloLane(layer)}>S</button
              >
            </div>
          </div>
          <div class="flex-1 grid grid-cols-14 gap-[1px] bg-surface-800 p-[1px]">
            {#each Array.from({ length: matrixColumns }) as _, col}
              {@const clip = clipAtMatrix(layer, col)}
              <button
                class="relative h-14 flex flex-col overflow-hidden bg-surface-950 text-surface-500 hover:bg-surface-800 border transition-colors {clip &&
                clip.id === selectedClipId
                  ? 'border-primary-500 shadow-[inset_0_0_12px_rgba(245,158,11,0.25)]'
                  : 'border-transparent'}"
                aria-label={clip
                  ? `Select ${clip.name} on layer ${layer + 1}, slot ${col + 1}`
                  : `Empty slot ${col + 1} on layer ${layer + 1}`}
                title={clip
                  ? `Matrix slot: ${clip.name}. Click to cue this clip. Auto-cycling repeats it until ${onsetSwitchTarget} onset(s) are counted, then switches on the next ${quantizeMode} boundary.`
                  : `Empty matrix slot. Add videos from the sample folder or your own files.`}
                on:click={() => clip && selectClip(clip.id)}
              >
                {#if clip}
                  <video
                    src={clip.url}
                    class="absolute inset-0 w-full h-full object-cover opacity-60 mix-blend-screen"
                    muted
                    disablePictureInPicture
                    preload="metadata"
                  ></video>
                  <div
                    class="absolute inset-x-0 bottom-0 bg-gradient-to-t from-surface-950 to-transparent p-0.5 z-10 text-left"
                  >
                    <span
                      class="text-[0.55rem] tracking-tighter font-mono uppercase text-surface-200 block truncate drop-shadow-md"
                      >{clip.name.replace(/\.[^/.]+$/, "")}</span
                    >
                  </div>
                {:else}
                  <span class="m-auto text-[0.5rem] text-surface-700">·</span>
                {/if}
              </button>
            {/each}
          </div>
        </div>
      {/each}
    </div>
  {/if}

  <div class="flex flex-row gap-1 flex-1 min-h-0">
    <div
      class="w-40 flex-none flex flex-col gap-1 border border-surface-800 bg-surface-950 rounded-sm p-1 overflow-hidden"
    >
      <div
        class="flex gap-1 items-center bg-surface-900 p-1 rounded-sm border border-surface-800"
      >
        <label for="upload-lane" class="sr-only">Upload lane</label>
        <select
          id="upload-lane"
          class="flex-1 text-[0.6rem] bg-surface-950 border border-surface-800 rounded-sm py-0.5 px-1"
          value={String(uploadLane)}
          on:change={setUploadLane}
        >
          <option value={0}>L1</option>
          <option value={1}>L2</option>
          <option value={2}>L3</option>
        </select>
        <label
          class="btn btn-sm preset-filled-primary-500 text-[0.6rem] py-0.5 px-2 cursor-pointer font-bold m-0"
          for="video-upload">Add</label
        >
        <input
          id="video-upload"
          type="file"
          accept="video/*"
          multiple
          on:change={uploadClips}
          class="hidden"
        />
      </div>

      <div class="flex-1 overflow-y-auto flex flex-col gap-1 pr-1">
        {#if clips.length === 0}
          <div class="text-[0.6rem] text-surface-500 text-center mt-2">
            No clips
          </div>
        {/if}
        {#each clips as clip}
          <div
            class="group flex flex-col p-1 rounded-sm border {clip.id ===
            selectedClipId
              ? 'border-primary-500 bg-surface-900'
              : 'border-surface-800 bg-surface-950'} hover:bg-surface-900"
          >
            <div class="flex justify-between items-start gap-1">
              <button
                class="text-left truncate flex-1 text-[0.6rem] font-bold text-surface-200"
                aria-label={`Select clip ${clip.name}`}
                on:click={() => selectClip(clip.id)}>{clip.name}</button
              >
              <button
                class="text-[0.55rem] text-surface-500 hover:text-error-500"
                aria-label={`Remove clip ${clip.name}`}
                on:click={() => removeClip(clip.id)}>✕</button
              >
            </div>
            <div class="text-[0.55rem] text-surface-500 flex justify-between">
              <span>L{clip.lane + 1} S{clip.slot + 1}</span>
              <span>{clip.sizeMb}M</span>
            </div>
          </div>
        {/each}
      </div>
    </div>

    <div
      class="flex-1 flex flex-col items-center justify-center min-w-0 bg-surface-950 border border-surface-800 rounded-sm overflow-hidden relative p-1"
    >
      <div
        class="w-full max-h-full aspect-video bg-black rounded-sm border border-surface-900 relative flex items-center justify-center overflow-hidden shadow-xl shadow-black/50 mx-auto"
      >
        <div class="absolute top-1 right-1 left-1 z-10 flex flex-wrap justify-end gap-1 pointer-events-none opacity-75">
          {#if switchNotice.state !== "idle"}
            <div
              class="px-1.5 py-0.5 rounded-sm border backdrop-blur-sm bg-surface-950/60 {switchNotice.state === 'hotReady'
                ? 'border-emerald-500/55 text-emerald-200'
                : switchNotice.state === 'warmingHold'
                  ? 'border-amber-500/55 text-amber-100'
                  : 'border-rose-500/55 text-rose-100'}"
              data-testid="video-switch-notice"
              aria-label={`${switchNotice.headline}. ${switchNotice.detail}`}
            >
              <div class="text-[0.52rem] uppercase tracking-[0.18em] font-bold">
                {switchNotice.headline}
              </div>
            </div>
          {/if}
          <span
            class="text-[0.55rem] px-1 py-0.5 bg-surface-950/60 border border-surface-700/80 rounded-sm font-mono backdrop-blur-sm"
            >C: {Math.max(1, currentClipIndex + 1)}</span
          >
          <span
            class="text-[0.55rem] px-1 py-0.5 bg-surface-950/60 border border-primary-500/55 text-primary-300 rounded-sm font-mono backdrop-blur-sm"
            data-testid="video-timeshaper-hud"
            title="Live TimeShaper status. Preset curves below remap the selected video clip's source time while it remains the one visible deck."
            >{timeShaperStatus}</span
          >
          <span
            class="text-[0.55rem] px-1 py-0.5 bg-surface-950/60 border border-surface-700/80 rounded-sm font-mono backdrop-blur-sm"
            >{$activeSection} · {currentPlaybackRate.toFixed(2)}x · S{
              currentAutomationRate.toFixed(2)
            }x</span
          >
        </div>

        {#if currentClip}
          <canvas
            bind:this={webGpuCanvas}
            class="absolute inset-0 z-[1] m-auto max-h-full max-w-full {webGpuEngineReady && webGpuFramePresented ? '' : 'hidden'}"
            aria-label="WebGPU deck presenter"
          ></canvas>
          <video
            bind:this={player}
            src={currentClip.url}
            class="w-full h-full object-contain {webGpuEngineReady && webGpuFramePresented ? 'opacity-0 pointer-events-none' : ''}"
            playsinline
            muted
            loop
            on:play={() => {
              syncVideoPlaybackState();
              startPlaybackLoop();
            }}
            on:pause={() => {
              syncVideoPlaybackState();
              stopPlaybackLoop();
            }}
            on:ended={() => {
              syncVideoPlaybackState();
              stopPlaybackLoop();
            }}
            on:loadedmetadata={() => {
              duration = player?.duration ?? 0;
              syncVideoPlaybackState();
              if (player && pendingSeekRatio !== null && duration > 0) {
                player.currentTime = Math.min(
                  duration * pendingSeekRatio,
                  Math.max(0, duration - 0.05),
                );
                pendingSeekRatio = null;
              }
              if (!(player as VideoFrameCallbackCapable | null)?.requestVideoFrameCallback) {
                renderWebGpuFrame();
              }
            }}
            on:canplay={() => {
              scheduleVideoFramePump(player);
              if (player && resumeAfterSwitch) {
                startPlaybackLoop();
                void resumeCurrentPlayer().finally(() => {
                  resumeAfterSwitch = false;
                });
              } else {
                switchInFlight = false;
                syncVideoPlaybackState();
              }
            }}
            on:timeupdate={() => {
              currentTime = player?.currentTime ?? 0;
              syncVideoPlaybackState();
              applySpeedRamp();
              if (!(player as VideoFrameCallbackCapable | null)?.requestVideoFrameCallback) {
                renderWebGpuFrame();
              }
            }}
          >
            <track
              kind="captions"
              srclang="en"
              label="Captions"
              src="data:text/vtt,WEBVTT"
            />
          </video>
        {:else}
          <div
            class="w-full h-full flex items-center justify-center text-[0.65rem] text-surface-600 font-mono tracking-widest bg-surface-900"
          >
            NO SIGNAL
          </div>
        {/if}

        {#if webGpuEngineError}
          <div
            class="absolute left-2 top-2 z-20 max-w-72 rounded border border-error-500/80 bg-error-500/10 px-2 py-1 text-[0.52rem] font-mono text-error-100"
            data-testid="webgpu-engine-error"
            title="MasterSelects-style WebGPU engine failed to initialize."
          >
            <div class="font-bold uppercase tracking-[0.18em]">WebGPU engine error</div>
            <div class="normal-case tracking-normal leading-tight">{webGpuEngineError}</div>
          </div>
        {/if}

        <div class="absolute bottom-1 w-full px-1 z-10">
          <div
            class="flex justify-between items-center bg-surface-950/90 border border-surface-800 rounded-sm p-1 backdrop-blur-sm"
          >
            <div class="flex gap-1">
              <button
                class="btn btn-sm bg-surface-800 border border-surface-700 hover:bg-surface-700 text-[0.6rem] px-2 py-0.5"
                aria-label="Play selected clip"
                on:click={play}>▶</button
              >
              <button
                class="btn btn-sm bg-surface-800 border border-surface-700 hover:bg-surface-700 text-[0.6rem] px-2 py-0.5"
                aria-label="Pause selected clip"
                on:click={pause}>⏸</button
              >
              <button
                class="btn btn-sm bg-surface-800 border border-surface-700 hover:bg-surface-700 text-[0.6rem] px-2 py-0.5"
                aria-label="Stop selected clip"
                on:click={stop}>⏹</button
              >
            </div>
	            <div
	              class="flex flex-wrap items-center gap-1 px-1 py-0.5 rounded-sm border border-surface-700 bg-surface-900"
	              data-testid="timeshaper-preset-controls"
	            >
	              <button
                class="btn btn-sm text-[0.58rem] px-1.5 py-0.5 border font-bold {timeShaperEnabled
                  ? 'border-primary-500 bg-primary-500/20 text-primary-400'
                  : 'border-surface-700 bg-surface-800 text-surface-400'}"
                title="Toggle video TimeShaper. When enabled, the selected preset can stutter, scratch, reverse, or drag the current clip's source time."
                on:click={() => {
                  timeShaperEnabled = !timeShaperEnabled;
                  timeShaperLastTriggeredAtMs = null;
                  timeShaperActiveUntilMs = 0;
                  timeShaperNextTriggerAllowedAtMs = 0;
                  if (!timeShaperEnabled) timeShaperStatus = "TimeShaper bypassed";
                }}
              >
                TS {timeShaperEnabled ? "ON" : "OFF"}
              </button>
              <label for="timeshaper-preset" class="sr-only">TimeShaper curve preset</label>
              <select
                id="timeshaper-preset"
                bind:value={selectedTimeShapePresetId}
                class="bg-surface-950 border border-surface-700 rounded-sm px-1 py-0.5 text-[0.56rem] font-mono text-surface-200"
                aria-label="TimeShaper curve preset"
                title="Choose the preset curve that remaps video timing with stutters, scratches, tape-stop drags, or easing ramps."
              >
                {#each TIME_SHAPE_GESTURE_PRESETS as preset}
                  <option value={preset.id}>{preset.label}</option>
                {/each}
              </select>
              <label for="timeshaper-source" class="text-[0.52rem] text-surface-400 uppercase font-bold">Source</label>
              <select
                id="timeshaper-source"
                bind:value={$timeShaperTriggerSource}
                class="bg-surface-950 border border-surface-700 rounded-sm px-1 py-0.5 text-[0.56rem] font-mono text-surface-200"
                aria-label="TimeShaper trigger source"
              >
                <option value="audio">Audio</option>
                <option value="midi">MIDI</option>
                <option value="hybrid">Hybrid</option>
              </select>
              <svg
                class="h-8 w-24 rounded-sm border border-surface-700 bg-surface-950"
                viewBox="0 0 100 100"
                preserveAspectRatio="none"
                aria-label="Visible TimeShaper preset curve"
                data-testid="timeshaper-curve-preview"
              >
                <rect x="0" y="0" width="100" height="100" fill="rgba(15,23,42,0.92)" />
                <path d="M0 50 H100" stroke="rgba(148,163,184,0.35)" stroke-width="1" />
                <polyline
                  points={timeShapePreviewPoints}
                  fill="none"
                  stroke="rgb(190,242,100)"
                  stroke-width="3"
                  stroke-linejoin="round"
                  stroke-linecap="round"
                />
                <line x1={timeShapePreviewPhase} x2={timeShapePreviewPhase} y1="0" y2="100" stroke="rgb(245,158,11)" stroke-width="1.5" />
              </svg>
	              <label for="timeshaper-mix" class="text-[0.52rem] text-surface-400 uppercase font-bold">Mix</label>
              <input
                id="timeshaper-mix"
                type="range"
                min="0"
                max="1"
                step="0.01"
                bind:value={timeShaperMix}
                class="w-14 h-1 accent-primary-500"
                aria-label="TimeShaper mix amount"
                title="Dry/wet amount for TimeShaper. 0 keeps the base playback/ramp behavior, while 1 applies the full source-time and playback-rate modulation for the selected preset."
              />
              <label for="timeshaper-cooldown" class="text-[0.52rem] text-surface-400 uppercase font-bold">Cool</label>
              <input
                id="timeshaper-cooldown"
                type="range"
                min="220"
                max="3200"
                step="20"
                bind:value={timeShaperCooldownMs}
                class="w-14 h-1 accent-primary-500"
                aria-label="TimeShaper cooldown"
                title="Minimum wait before TimeShaper can retrigger again after a punch."
              />
              <span
                class="rounded-sm border border-surface-700 bg-surface-950 px-1 py-0.5 text-[0.52rem] font-mono text-surface-300"
                title="TimeShaper cooldown seconds"
              >
                {(timeShaperCooldownMs / 1000).toFixed(2)}s
              </span>
              <div
                class="rounded-sm border border-surface-700 bg-surface-950 px-1.5 py-0.5 text-[0.56rem] font-mono text-primary-200"
                aria-label="TimeShaper trigger range"
                title="TimeShaper now follows the Audio Reactive panel's draggable effect span instead of a separate low/mid/high/full selector."
              >
	                FX {timeShaperTriggerLabel}
	              </div>
	              <label for="timeshaper-trigger-shift" class="text-[0.52rem] text-surface-400 uppercase font-bold">Shift</label>
	              <input
	                id="timeshaper-trigger-shift"
	                type="range"
	                min="-250"
	                max="250"
	                step="1"
	                bind:value={$timeShaperTriggerShiftMs}
	                class="w-16 h-1 accent-primary-500"
	                aria-label="TimeShaper trigger shift"
	                title="Move event-triggered envelopes earlier or later in milliseconds."
	              />
	              <span class="text-[0.5rem] font-mono text-surface-400 w-12 text-right">
	                {$timeShaperTriggerShiftMs}ms
	              </span>
	              <div
	                class="flex items-center gap-1"
	                data-testid="onset-progress-meter"
                title="Accumulated onsets for the current clip. Filled dots and bar show progress toward the switch target."
              >
                <span class="text-[0.52rem] text-surface-400 font-mono">
                  {onsetCountForClip}/{onsetSwitchTarget}
                </span>
                <div class="flex gap-[2px]" aria-hidden="true">
                  {#each Array.from({ length: getOnsetDotCount() }) as _, dotIndex}
                    <span
                      class="h-2 w-2 rounded-full border {dotIndex < getFilledOnsetDots()
                        ? 'border-primary-400 bg-primary-400 shadow-[0_0_6px_rgba(245,158,11,0.65)]'
                        : 'border-surface-700 bg-surface-950'}"
                    ></span>
                  {/each}
                </div>
                <div
                  class="h-1 w-16 overflow-hidden rounded-full border border-surface-700 bg-surface-950"
                  role="meter"
                  aria-label="Accumulated onsets before next clip"
                  aria-valuemin="0"
                  aria-valuemax={onsetSwitchTarget}
                  aria-valuenow={onsetCountForClip}
                >
                  <div
                    class="h-full bg-primary-400 transition-all duration-100"
                    style={`width:${getOnsetProgress() * 100}%`}
                  ></div>
                </div>
              </div>
              <label for="onset-switch-target" class="text-[0.52rem] text-surface-400 uppercase font-bold">Onsets</label>
              <input
                id="onset-switch-target"
                type="number"
                min="1"
                max="32"
                step="1"
                bind:value={onsetSwitchTarget}
                on:input={applyOnsetTarget}
                class="w-10 bg-surface-950 border border-surface-700 rounded-sm px-1 py-0 text-[0.52rem] font-mono text-surface-300 text-right"
                aria-label="Onsets before next clip"
	                title="The current clip repeats until this many audio onsets are counted, then the next active matrix clip is selected on the quantized beat/bar boundary."
	              />
	            </div>
            <button
              class="btn btn-sm text-[0.6rem] px-2 py-0.5 border font-bold {envelopeGateEnabled
                ? 'border-primary-500 bg-primary-500/20 text-primary-400'
                : 'border-surface-700 bg-surface-800 text-surface-400'}"
              title="Gate auto-cycling by audio onsets. When on, clips repeat until the onset counter reaches the target; when off, quantized boundaries count instead."
              on:click={toggleEnvelopeGate}
            >
              GATE {envelopeGateEnabled ? "ON" : "OFF"}
            </button>
            <button
              class="btn btn-sm text-[0.6rem] px-2 py-0.5 border font-bold {speedRampEnabled
                ? 'border-primary-500 bg-primary-500/20 text-primary-400'
                : 'border-surface-700 bg-surface-800 text-surface-400'}"
              title="Toggle bottom timeline speed automation. The visible speed lane drives the actual playback rate while TimeShaper handles source-time remapping."
              on:click={() => {
                speedRampEnabled = !speedRampEnabled;
                if (!speedRampEnabled && player) {
                  player.playbackRate = 1;
                  currentPlaybackRate = 1;
                }
              }}
            >
              RAMP {speedRampEnabled ? "ON" : "OFF"}
            </button>
            <div class="flex items-center gap-1 rounded-sm border border-surface-700 bg-surface-900 px-1 py-0.5">
              <button
                class="px-1.5 py-0.5 text-[0.52rem] font-bold uppercase rounded-sm {timeShaperPanelTab === 'presets'
                  ? 'bg-primary-500/20 text-primary-300'
                  : 'text-surface-500 hover:bg-surface-800'}"
                aria-pressed={timeShaperPanelTab === "presets"}
                on:click={() => {
                  timeShaperPanelTab = "presets";
                  timeShaperPanelCollapsed = false;
                }}
              >
                Presets
              </button>
              <button
                class="px-1.5 py-0.5 text-[0.52rem] font-bold uppercase rounded-sm {timeShaperPanelTab === 'triggers'
                  ? 'bg-primary-500/20 text-primary-300'
                  : 'text-surface-500 hover:bg-surface-800'}"
                aria-pressed={timeShaperPanelTab === "triggers"}
                on:click={() => {
                  timeShaperPanelTab = "triggers";
                  timeShaperPanelCollapsed = false;
                }}
              >
                Triggers
              </button>
              <button
                class="px-1.5 py-0.5 text-[0.52rem] font-bold uppercase rounded-sm border border-surface-700 bg-surface-950 text-surface-300"
                aria-expanded={!timeShaperPanelCollapsed}
                on:click={() => (timeShaperPanelCollapsed = !timeShaperPanelCollapsed)}
                title="Collapse this panel to give the viewer more room."
              >
                {timeShaperPanelCollapsed ? "Show" : "Hide"}
              </button>
            </div>
            <div
              class="flex items-center gap-1 px-1 py-0.5 rounded-sm border border-surface-700 bg-surface-900"
            >
              <span class="text-[0.52rem] font-bold text-surface-400 uppercase"
                >Skip</span
              >
              <input
                type="range"
                min="0"
                max="100"
                step="1"
                bind:value={switchSkipChancePercent}
                on:input={applySwitchSkipChance}
                class="w-16 h-1 accent-primary-500"
                aria-label="Random quantized switch bypass probability"
                title="Random quantized switch bypass probability"
              />
              <input
                type="number"
                min="0"
                max="100"
                step="1"
                bind:value={switchSkipChancePercent}
                on:input={applySwitchSkipChance}
                class="w-10 bg-surface-950 border border-surface-700 rounded-sm px-1 py-0 text-[0.52rem] font-mono text-surface-300 text-right"
                aria-label="Skip chance percent"
              />
              <span class="text-[0.5rem] text-surface-500 font-mono">
                {(switchSkipChancePercent / 100).toFixed(2)}
              </span>
            </div>
	            </div>
	          </div>
	        {#if nextPrewarmClip}
          <video
            bind:this={prewarmPlayer}
            src={nextPrewarmClip.url}
            muted
            preload="auto"
            class="hidden"
            aria-hidden="true"
            on:loadstart={() => {
              prewarmStatus = "warming";
            }}
            on:waiting={() => {
              prewarmStatus = "warming";
            }}
            on:canplay={() => {
              prewarmStatus = "ready";
            }}
            on:error={() => {
              prewarmStatus = "failed";
            }}
          ></video>
        {/if}
      </div>
      {#if !timeShaperPanelCollapsed}
        <div class="mt-1 w-full rounded-sm border border-surface-800 bg-surface-950 px-2 py-1">
          <div class="mb-1 flex items-center justify-between gap-2">
            <div>
              <div class="text-[0.52rem] font-bold uppercase tracking-[0.16em] text-primary-400">
                {timeShaperPanelTab === "presets" ? "Trigger Envelopes" : "Trigger Monitor"}
              </div>
              <div class="text-[0.5rem] text-surface-500">
                {timeShaperPanelTab === "presets"
                  ? "Visual ramp presets for event-fired TimeShaper gestures."
                  : "Recent trigger points for the active TimeShaper source."}
              </div>
            </div>
            <div class="text-[0.52rem] font-mono text-surface-400">
              {$timeShaperTriggerSource.toUpperCase()}
            </div>
          </div>

          {#if timeShaperPanelTab === "presets"}
            <EnvelopePresetGallery
              selectedId={$timeShaperEnvelopePresetId}
              onSelect={(id) => $timeShaperEnvelopePresetId = id as typeof $timeShaperEnvelopePresetId}
            />
          {:else}
            <div class="flex flex-col gap-1">
              <TriggerEventStrip events={recentTimeShaperEvents} transportTime={transportTimeSeconds} />
              <div class="text-[0.52rem] text-surface-500">
                Recent MIDI/audio trigger hits stay here instead of covering the viewer.
              </div>
            </div>
          {/if}
        </div>
      {/if}
    </div>
  </div>
</div>
