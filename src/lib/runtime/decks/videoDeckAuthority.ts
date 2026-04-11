import { get } from 'svelte/store';
import {
  type AudioOnsetEvent,
  audioOnsets,
  audioRuntime,
  tempoState,
} from '$lib/stores/runtime';
import {
  initialVideoDeckAuthorityState,
  type VideoDeckAuthorityState,
  type VideoDeckClipRecord,
  type VideoDeckQuantizeMode,
  videoDeckAuthority,
} from '$lib/stores/videoDeck';

export interface VideoDeckAuthorityMeta {
  countedOnsetIds: string[];
  lastSlotIndex: number;
  previousAudioTime: number;
  previousSelectedClipId: string;
}

export interface VideoDeckAuthorityInput {
  audioCurrentTime: number;
  audioIsPlaying: boolean;
  audioSource: string;
  bpm: number;
  onsets: AudioOnsetEvent[];
}

const MAX_TRACKED_ONSET_IDS = 512;

const initialMeta = (): VideoDeckAuthorityMeta => ({
  countedOnsetIds: [],
  lastSlotIndex: -1,
  previousAudioTime: 0,
  previousSelectedClipId: '',
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

export const getTransportSlotIndex = (
  audioCurrentTime: number,
  bpm: number,
  quantizeMode: VideoDeckQuantizeMode,
): number => {
  const safeBpm = Math.max(20, Math.min(300, bpm || 120));
  const beatDuration = 60 / safeBpm;
  const slotDuration = quantizeMode === 'bar' ? beatDuration * 4 : beatDuration;
  if (!Number.isFinite(audioCurrentTime) || audioCurrentTime < 0 || slotDuration <= 0) {
    return -1;
  }
  return Math.floor(audioCurrentTime / slotDuration);
};

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
        meta.countedOnsetIds.length || meta.lastSlotIndex !== -1
          ? {
              ...meta,
              countedOnsetIds: [],
              lastSlotIndex: -1,
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
      countedOnsetIds: [],
      lastSlotIndex: -1,
    },
  };
};

const trimCountedOnsetIds = (ids: string[]): string[] =>
  ids.length > MAX_TRACKED_ONSET_IDS ? ids.slice(-MAX_TRACKED_ONSET_IDS) : ids;

const countEligibleOnsets = (
  state: VideoDeckAuthorityState,
  meta: VideoDeckAuthorityMeta,
  input: VideoDeckAuthorityInput,
): { countedOnsetIds: string[]; addedCount: number; hasDetectedOnset: boolean } => {
  if (!state.envelopeGateEnabled) {
    return {
      countedOnsetIds: meta.countedOnsetIds,
      addedCount: 0,
      hasDetectedOnset: false,
    };
  }

  const essentiaOnsets = input.onsets.filter((event) => event.source === 'essentia');
  const source = essentiaOnsets.length > 0 ? 'essentia' : 'detected';
  const eligibleOnsetIds = input.onsets
    .filter(
      (event) =>
        event.source === source && event.timeSeconds <= input.audioCurrentTime + 0.05,
    )
    .map((event) => event.id);
  const counted = new Set(meta.countedOnsetIds);
  const newIds = eligibleOnsetIds.filter((id) => !counted.has(id));

  if (newIds.length === 0) {
    return {
      countedOnsetIds: meta.countedOnsetIds,
      addedCount: 0,
      hasDetectedOnset: eligibleOnsetIds.length > 0,
    };
  }

  return {
    countedOnsetIds: trimCountedOnsetIds([...meta.countedOnsetIds, ...newIds]),
    addedCount: newIds.length,
    hasDetectedOnset: true,
  };
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

  const currentSlotIndex = getTransportSlotIndex(
    input.audioCurrentTime,
    input.bpm,
    state.quantizeMode,
  );
  const audioWentBackwards = input.audioCurrentTime + 0.05 < meta.previousAudioTime;
  const selectedClipChanged = state.selectedClipId !== meta.previousSelectedClipId;
  const shouldResetProgress = audioWentBackwards || selectedClipChanged;

  if (shouldResetProgress) {
    state = {
      ...state,
      onsetCountForClip: 0,
    };
    meta = {
      ...meta,
      countedOnsetIds: [],
      lastSlotIndex: currentSlotIndex,
    };
  }

  const playable = getPlayableClips(state);
  const playbackActive =
    input.audioSource === 'file' &&
    input.audioIsPlaying &&
    playable.length >= 2 &&
    Boolean(state.selectedClipId);

  const onsetCount = countEligibleOnsets(state, meta, input);
  if (onsetCount.addedCount > 0) {
    state = {
      ...state,
      onsetCountForClip: state.onsetCountForClip + onsetCount.addedCount,
    };
    meta = {
      ...meta,
      countedOnsetIds: onsetCount.countedOnsetIds,
    };
  }

  if (playbackActive && currentSlotIndex > meta.lastSlotIndex) {
    if (!state.envelopeGateEnabled && meta.lastSlotIndex >= 0) {
      state = {
        ...state,
        onsetCountForClip: state.onsetCountForClip + 1,
      };
    }

    if (meta.lastSlotIndex >= 0) {
      if (state.onsetCountForClip >= state.onsetSwitchTarget) {
        const currentIndex = playable.findIndex((clip) => clip.id === state.selectedClipId);
        const normalizedCurrentIndex = currentIndex < 0 ? 0 : currentIndex;
        const nextClip = playable[(normalizedCurrentIndex + 1) % playable.length];
        const skipChance = Math.max(0, Math.min(100, state.switchSkipChancePercent)) / 100;

        if (state.prewarmClipId === nextClip.id && !state.prewarmReady) {
          state = {
            ...state,
            status: `Warming ${nextClip.name}; holding ${
              playable[normalizedCurrentIndex]?.name ?? 'clip'
            } to avoid frozen switch`,
          };
        } else if (skipChance > 0 && randomValue < skipChance) {
          state = {
            ...state,
            onsetCountForClip: 0,
            status: `Quantized ${state.quantizeMode} switch bypassed (${Math.round(
              skipChance * 100,
            )}%) · onset ${state.onsetSwitchTarget}/${state.onsetSwitchTarget}`,
          };
          meta = {
            ...meta,
            countedOnsetIds: [],
          };
        } else {
          state = {
            ...state,
            selectedClipId: nextClip.id,
            onsetCountForClip: 0,
            status: `Quantized ${state.quantizeMode} switch after ${
              state.onsetSwitchTarget
            } onset(s): ${nextClip.name} (slot ${currentSlotIndex})`,
          };
          meta = {
            ...meta,
            countedOnsetIds: [],
          };
        }
      } else {
        const clipName =
          playable.find((clip) => clip.id === state.selectedClipId)?.name ?? 'clip';
        state = {
          ...state,
          status: state.envelopeGateEnabled
            ? onsetCount.hasDetectedOnset
              ? `Holding ${clipName}: onset ${state.onsetCountForClip}/${state.onsetSwitchTarget}`
              : `Holding ${clipName}: waiting for onset ${state.onsetCountForClip}/${state.onsetSwitchTarget}`
            : `Holding ${clipName}: onset ${state.onsetCountForClip}/${state.onsetSwitchTarget}`,
        };
      }
    }

    meta = {
      ...meta,
      lastSlotIndex: currentSlotIndex,
    };
  } else if (!playbackActive && currentSlotIndex >= 0) {
    meta = {
      ...meta,
      lastSlotIndex: currentSlotIndex,
    };
  }

  return {
    state,
    meta: {
      ...meta,
      previousAudioTime: input.audioCurrentTime,
      previousSelectedClipId: state.selectedClipId,
    },
  };
}

let schedulerRefCount = 0;
let schedulerStop: (() => void) | null = null;

export function startVideoDeckAuthorityScheduler(): () => void {
  schedulerRefCount += 1;
  if (schedulerStop) {
    return () => stopVideoDeckAuthorityScheduler();
  }

  let authorityState = get(videoDeckAuthority);
  let transportState = get(audioRuntime);
  let currentTempoState = get(tempoState);
  let onsetState = get(audioOnsets);
  let authorityMeta = initialMeta();
  let suppressAuthoritySubscribe = false;

  const recompute = () => {
    const next = advanceVideoDeckAuthority(authorityState, authorityMeta, {
      audioCurrentTime: transportState.currentTime,
      audioIsPlaying: transportState.isPlaying,
      audioSource: transportState.source,
      bpm: currentTempoState.bpm,
      onsets: onsetState,
    }, Math.random());
    authorityMeta = next.meta;
    if (authoritySignature(next.state) === authoritySignature(authorityState)) {
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
    audioOnsets.subscribe((value) => {
      onsetState = value;
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

function authoritySignature(state: VideoDeckAuthorityState): string {
  return JSON.stringify([
    state.selectedClipId,
    state.prewarmClipId,
    state.prewarmReady,
    state.autoSwitchEnabled,
    state.quantizeMode,
    state.envelopeGateEnabled,
    state.onsetSwitchTarget,
    state.switchSkipChancePercent,
    state.onsetCountForClip,
    state.status,
    state.soloLane,
    state.laneMuted,
    state.clips.map((clip) => [clip.id, clip.lane, clip.slot]).join('|'),
  ]);
}

export function resetVideoDeckAuthorityStore() {
  videoDeckAuthority.set(initialVideoDeckAuthorityState);
}
