import { get } from 'svelte/store';
import {
  type AudioOnsetEvent,
  audioOnsets,
  audioRuntime,
  liveDetectedOnsets,
  onsetTransportState,
  switchProgressEvents,
  tempoState,
  transportAlignment,
} from '$lib/stores/runtime';
import {
  advanceOnsetSwitchScheduler,
  carryOnsetSwitchSchedulerState,
  computeTransportSlotIndex,
  createOnsetSwitchSchedulerState,
  type CountedProgressEvent,
  type OnsetSwitchSchedulerState,
} from '$lib/runtime/decks/onsetSwitchScheduler';
import {
  initialVideoDeckAuthorityState,
  type VideoDeckAuthorityState,
  type VideoDeckClipRecord,
  videoDeckAuthority,
} from '$lib/stores/videoDeck';

export interface VideoDeckAuthorityMeta {
  previousSelectedClipId: string;
  schedulerState: OnsetSwitchSchedulerState;
}

export interface VideoDeckAuthorityInput {
  audioCurrentTime: number;
  audioIsPlaying: boolean;
  audioSource: string;
  bpm: number;
  firstBeatSeconds: number;
  analyzedOnsets: AudioOnsetEvent[];
  detectedOnsets: AudioOnsetEvent[];
}

const initialMeta = (): VideoDeckAuthorityMeta => ({
  previousSelectedClipId: '',
  schedulerState: createOnsetSwitchSchedulerState(initialVideoDeckAuthorityState.onsetSwitchTarget),
});

const laneIsActive = (
  laneMuted: boolean[],
  soloLane: number | null,
  lane: number,
): boolean => (soloLane === null ? !laneMuted[lane] : soloLane === lane);

export const getPlayableClips = (
  state: VideoDeckAuthorityState,
): VideoDeckClipRecord[] =>
  state.clips
    .filter((clip) => laneIsActive(state.laneMuted, state.soloLane, clip.lane))
    .sort((a, b) => (a.lane === b.lane ? a.slot - b.slot : a.lane - b.lane));

const normalizeSelection = (
  state: VideoDeckAuthorityState,
  meta: VideoDeckAuthorityMeta,
): { state: VideoDeckAuthorityState; meta: VideoDeckAuthorityMeta } => {
  const playable = getPlayableClips(state);
  if (playable.length === 0) {
    return {
      state:
        state.selectedClipId || state.onsetCountForClip
          ? {
              ...state,
              selectedClipId: '',
              prewarmClipId: '',
              onsetCountForClip: 0,
            }
          : state,
      meta:
        meta.previousSelectedClipId || meta.schedulerState.lastTransportSlot !== null
          ? {
              ...meta,
              previousSelectedClipId: '',
              schedulerState: createOnsetSwitchSchedulerState(state.onsetSwitchTarget),
            }
          : meta,
    };
  }

  if (playable.some((clip) => clip.id === state.selectedClipId)) {
    return { state, meta };
  }

  return {
    state: {
      ...state,
      selectedClipId: playable[0].id,
      onsetCountForClip: 0,
    },
    meta: {
      ...meta,
      schedulerState: carryOnsetSwitchSchedulerState(
        meta.schedulerState,
        state.onsetSwitchTarget,
        meta.schedulerState.lastTransportSlot,
      ),
    },
  };
};

const appendCountedProgressEvents = (events: CountedProgressEvent[]) => {
  if (events.length === 0) return;
  switchProgressEvents.update((existing) =>
    [
      ...existing,
      ...events.map((event, index) => ({
        id: `${event.id}-${index}`,
        timestampMs: Date.now(),
        timeSeconds: event.timeSeconds,
        band: event.band,
        value: event.value,
        threshold: event.threshold,
        counted: true,
        source: 'counted' as const,
      })),
    ].slice(-256),
  );
};

const updateOnsetTransportState = (
  schedulerState: OnsetSwitchSchedulerState,
  state: VideoDeckAuthorityState,
) => {
  onsetTransportState.set({
    progressCount: schedulerState.progressCount,
    target: state.onsetSwitchTarget,
    armed: schedulerState.armedAtSlotIndex !== null,
    blockedReason: schedulerState.blockedReason,
    progressMode: schedulerState.progressMode,
    lastTransportSlot: schedulerState.lastTransportSlot,
  });
};

export function advanceVideoDeckAuthority(
  authorityState: VideoDeckAuthorityState,
  authorityMeta: VideoDeckAuthorityMeta,
  input: VideoDeckAuthorityInput,
  randomValue = 1,
): { state: VideoDeckAuthorityState; meta: VideoDeckAuthorityMeta } {
  let state = authorityState;
  let meta = authorityMeta;

  ({ state, meta } = normalizeSelection(state, meta));
  const selectedClipChanged = state.selectedClipId !== meta.previousSelectedClipId;
  if (selectedClipChanged) {
    meta = {
      ...meta,
      schedulerState: carryOnsetSwitchSchedulerState(
        meta.schedulerState,
        state.onsetSwitchTarget,
        meta.schedulerState.lastTransportSlot,
      ),
    };
  }

  const playable = getPlayableClips(state);
  const playbackActive =
    input.audioSource === 'file' &&
    input.audioIsPlaying &&
    state.videoPlaybackActive &&
    playable.length >= 2 &&
    Boolean(state.selectedClipId);

  const currentIndex = playable.findIndex((clip) => clip.id === state.selectedClipId);
  const normalizedCurrentIndex = currentIndex < 0 ? 0 : currentIndex;
  const nextClip = playable.length > 1 ? playable[(normalizedCurrentIndex + 1) % playable.length] : undefined;
  const nextClipReady = nextClip ? state.prewarmClipId !== nextClip.id || state.prewarmReady : true;

  const schedulerResult = advanceOnsetSwitchScheduler(meta.schedulerState, {
    transportTimeSeconds: input.audioCurrentTime,
    bpm: input.bpm,
    firstBeatSeconds: input.firstBeatSeconds,
    quantizeMode: state.quantizeMode,
    target: state.onsetSwitchTarget,
    envelopeGateEnabled: state.envelopeGateEnabled,
    autoSwitchEnabled: state.autoSwitchEnabled && playbackActive,
    playableClipCount: playable.length,
    nextClipReady,
    nextClipLabel: nextClip?.name ?? null,
    analyzedOnsets: input.analyzedOnsets,
    detectedOnsets: input.detectedOnsets,
  });

  meta = {
    ...meta,
    schedulerState: schedulerResult.state,
  };

  appendCountedProgressEvents(schedulerResult.countedEvents);

  state = {
    ...state,
    onsetCountForClip: schedulerResult.state.progressCount,
  };

  if (playbackActive && schedulerResult.shouldSwitch && nextClip) {
    const skipChance = Math.max(0, Math.min(100, state.switchSkipChancePercent)) / 100;
    if (skipChance > 0 && randomValue < skipChance) {
      state = {
        ...state,
        onsetCountForClip: 0,
        status: `Quantized ${state.quantizeMode} switch bypassed (${Math.round(
          skipChance * 100,
        )}%) · onset ${state.onsetSwitchTarget}/${state.onsetSwitchTarget}`,
      };
    } else {
      state = {
        ...state,
        selectedClipId: nextClip.id,
        onsetCountForClip: 0,
        status: `Quantized ${state.quantizeMode} switch after ${
          state.onsetSwitchTarget
        } onset(s): ${nextClip.name} (slot ${schedulerResult.currentSlotIndex})`,
      };
    }
    meta = {
      ...meta,
      schedulerState: carryOnsetSwitchSchedulerState(
        schedulerResult.state,
        state.onsetSwitchTarget,
        schedulerResult.currentSlotIndex,
      ),
    };
  } else {
    const clipName =
      playable.find((clip) => clip.id === state.selectedClipId)?.name ?? 'clip';
    const hasDetectedFallback = input.detectedOnsets.length > 0;

    state = {
      ...state,
      status: schedulerResult.state.blockedReason
        ? `Holding ${clipName}: ${schedulerResult.state.blockedReason}`
        : schedulerResult.state.armedAtSlotIndex !== null
          ? `Armed ${state.quantizeMode} switch · onset ${state.onsetCountForClip}/${state.onsetSwitchTarget}`
          : schedulerResult.countedEvents.length > 0 || !state.envelopeGateEnabled
            ? `Holding ${clipName}: onset ${state.onsetCountForClip}/${state.onsetSwitchTarget}`
            : input.analyzedOnsets.length === 0
              ? hasDetectedFallback
                ? 'Holding switch: awaiting analyzed onsets (detected fallback armed)'
                : 'Holding switch: awaiting analyzed onsets'
              : `Holding ${clipName}: waiting for onset ${state.onsetCountForClip}/${state.onsetSwitchTarget}`,
    };
  }

  return {
    state,
    meta: {
      ...meta,
      previousSelectedClipId: state.selectedClipId,
    },
  };
}

let schedulerRefCount = 0;
let schedulerStop: (() => void) | null = null;

const clipsMatch = (
  left: VideoDeckClipRecord[],
  right: VideoDeckClipRecord[],
): boolean => {
  if (left.length !== right.length) return false;
  for (let index = 0; index < left.length; index += 1) {
    const a = left[index];
    const b = right[index];
    if (
      a.id !== b.id ||
      a.name !== b.name ||
      a.url !== b.url ||
      a.sizeMb !== b.sizeMb ||
      a.lane !== b.lane ||
      a.slot !== b.slot
    ) {
      return false;
    }
  }
  return true;
};

const authorityStateMatches = (
  left: VideoDeckAuthorityState,
  right: VideoDeckAuthorityState,
): boolean =>
  left.selectedClipId === right.selectedClipId &&
  left.prewarmClipId === right.prewarmClipId &&
  left.prewarmReady === right.prewarmReady &&
  left.autoSwitchEnabled === right.autoSwitchEnabled &&
  left.quantizeMode === right.quantizeMode &&
  left.envelopeGateEnabled === right.envelopeGateEnabled &&
  left.onsetSwitchTarget === right.onsetSwitchTarget &&
  left.switchSkipChancePercent === right.switchSkipChancePercent &&
  left.onsetCountForClip === right.onsetCountForClip &&
  left.videoPlaybackActive === right.videoPlaybackActive &&
  left.status === right.status &&
  left.soloLane === right.soloLane &&
  left.laneMuted.length === right.laneMuted.length &&
  left.laneMuted.every((value, index) => value === right.laneMuted[index]) &&
  clipsMatch(left.clips, right.clips);

export function startVideoDeckAuthorityScheduler(): () => void {
  schedulerRefCount += 1;
  if (schedulerStop) {
    return () => stopVideoDeckAuthorityScheduler();
  }

  let authorityState = get(videoDeckAuthority);
  let transportState = get(audioRuntime);
  let currentTempoState = get(tempoState);
  let currentTransportAlignment = get(transportAlignment);
  let analyzedOnsetState = get(audioOnsets);
  let detectedOnsetState = get(liveDetectedOnsets);
  let authorityMeta = initialMeta();
  let suppressAuthoritySubscribe = false;

  const recompute = () => {
    const next = advanceVideoDeckAuthority(authorityState, authorityMeta, {
      audioCurrentTime: transportState.currentTime,
      audioIsPlaying: transportState.isPlaying,
      audioSource: transportState.source,
      bpm: currentTempoState.bpm,
      firstBeatSeconds: currentTransportAlignment.firstBeatSeconds,
      analyzedOnsets: analyzedOnsetState,
      detectedOnsets: detectedOnsetState,
    }, Math.random());
    authorityMeta = next.meta;
    updateOnsetTransportState(next.meta.schedulerState, next.state);
    if (authorityStateMatches(next.state, authorityState)) {
      return;
    }
    authorityState = next.state;
    suppressAuthoritySubscribe = true;
    videoDeckAuthority.set(next.state);
    suppressAuthoritySubscribe = false;
  };

  const unsubscribers = [
    videoDeckAuthority.subscribe((value) => {
      authorityState = value;
      if (!suppressAuthoritySubscribe) recompute();
    }),
    audioRuntime.subscribe((value) => {
      transportState = value;
      recompute();
    }),
    tempoState.subscribe((value) => {
      currentTempoState = value;
      recompute();
    }),
    transportAlignment.subscribe((value) => {
      currentTransportAlignment = value;
      recompute();
    }),
    audioOnsets.subscribe((value) => {
      analyzedOnsetState = value;
      recompute();
    }),
    liveDetectedOnsets.subscribe((value) => {
      detectedOnsetState = value;
      recompute();
    }),
  ];

  recompute();

  schedulerStop = () => {
    for (const unsubscribe of unsubscribers) unsubscribe();
    schedulerStop = null;
  };

  return () => stopVideoDeckAuthorityScheduler();
}

function stopVideoDeckAuthorityScheduler() {
  schedulerRefCount = Math.max(0, schedulerRefCount - 1);
  if (schedulerRefCount === 0) {
    schedulerStop?.();
  }
}

export function resetVideoDeckAuthorityStore() {
  videoDeckAuthority.set(initialVideoDeckAuthorityState);
}
