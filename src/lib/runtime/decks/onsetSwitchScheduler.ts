import type { ReactiveBandTarget } from '$lib/types/engine';

export type QuantizeMode = 'beat' | 'bar';
export type OnsetProgressMode = 'analyzed' | 'detected-fallback' | 'quantized';

export interface OnsetEventLike {
  id: string;
  timeSeconds: number;
  band: ReactiveBandTarget;
  value: number;
  threshold: number;
}

export interface CountedProgressEvent {
  id: string;
  timeSeconds: number;
  band: ReactiveBandTarget;
  value: number;
  threshold: number;
  mode: OnsetProgressMode;
}

export interface OnsetSwitchSchedulerState {
  progressCount: number;
  target: number;
  armedAtSlotIndex: number | null;
  lastTransportSlot: number | null;
  lastCountedAnalyzedIndex: number;
  lastCountedDetectedIndex: number;
  lastTransportTimeSeconds: number;
  blockedReason: string | null;
  progressMode: OnsetProgressMode;
}

export interface OnsetSwitchSchedulerInput {
  transportTimeSeconds: number;
  bpm: number;
  firstBeatSeconds: number;
  quantizeMode: QuantizeMode;
  target: number;
  envelopeGateEnabled: boolean;
  autoSwitchEnabled: boolean;
  playableClipCount: number;
  nextClipReady: boolean;
  nextClipLabel?: string | null;
  analyzedOnsets: OnsetEventLike[];
  detectedOnsets: OnsetEventLike[];
}

export interface OnsetSwitchSchedulerResult {
  state: OnsetSwitchSchedulerState;
  countedEvents: CountedProgressEvent[];
  currentSlotIndex: number;
  shouldSwitch: boolean;
}

const DEFAULT_PROGRESS_MODE: OnsetProgressMode = 'analyzed';
const SLOT_LOOKAHEAD_SECONDS = 0.05;

const clampTarget = (target: number): number => Math.max(1, Math.round(Number(target) || 1));

export const createOnsetSwitchSchedulerState = (
  target = 4,
): OnsetSwitchSchedulerState => ({
  progressCount: 0,
  target: clampTarget(target),
  armedAtSlotIndex: null,
  lastTransportSlot: null,
  lastCountedAnalyzedIndex: 0,
  lastCountedDetectedIndex: 0,
  lastTransportTimeSeconds: 0,
  blockedReason: null,
  progressMode: DEFAULT_PROGRESS_MODE,
});

export const carryOnsetSwitchSchedulerState = (
  state: OnsetSwitchSchedulerState,
  target = state.target,
  currentSlotIndex = state.lastTransportSlot,
): OnsetSwitchSchedulerState => ({
  ...state,
  progressCount: 0,
  target: clampTarget(target),
  armedAtSlotIndex: null,
  lastTransportSlot: currentSlotIndex,
  blockedReason: null,
});

export const computeTransportSlotIndex = (
  transportTimeSeconds: number,
  bpm: number,
  firstBeatSeconds: number,
  quantizeMode: QuantizeMode,
): number => {
  const safeBpm = Math.max(20, Math.min(300, bpm || 120));
  const secondsPerBeat = 60 / safeBpm;
  const secondsPerSlot = quantizeMode === 'bar' ? secondsPerBeat * 4 : secondsPerBeat;
  const alignedTime = transportTimeSeconds - Math.max(0, firstBeatSeconds);

  if (!Number.isFinite(alignedTime) || alignedTime < 0) {
    return -1;
  }

  return Math.floor((alignedTime + SLOT_LOOKAHEAD_SECONDS) / secondsPerSlot);
};

export const advanceOnsetSwitchScheduler = (
  previousState: OnsetSwitchSchedulerState,
  input: OnsetSwitchSchedulerInput,
): OnsetSwitchSchedulerResult => {
  let state =
    input.transportTimeSeconds + SLOT_LOOKAHEAD_SECONDS < previousState.lastTransportTimeSeconds
      ? createOnsetSwitchSchedulerState(input.target)
      : { ...previousState, target: clampTarget(input.target), blockedReason: null };

  const currentSlotIndex = computeTransportSlotIndex(
    input.transportTimeSeconds,
    input.bpm,
    input.firstBeatSeconds,
    input.quantizeMode,
  );
  const countedEvents: CountedProgressEvent[] = [];
  const deadline = input.transportTimeSeconds + SLOT_LOOKAHEAD_SECONDS;

  const pushFrom = (events: OnsetEventLike[], startIndex: number, mode: OnsetProgressMode) => {
    let nextIndex = startIndex;
    while (nextIndex < events.length) {
      const event = events[nextIndex];
      if (!event || event.timeSeconds > deadline) break;
      countedEvents.push({
        id: `count-${mode}-${event.id}`,
        timeSeconds: event.timeSeconds,
        band: event.band,
        value: event.value,
        threshold: event.threshold,
        mode,
      });
      nextIndex += 1;
    }
    return nextIndex;
  };

  if (input.envelopeGateEnabled) {
    if (input.analyzedOnsets.length > 0) {
      state.lastCountedAnalyzedIndex = pushFrom(
        input.analyzedOnsets,
        state.lastCountedAnalyzedIndex,
        'analyzed',
      );
      state.progressMode = 'analyzed';
    } else {
      state.progressMode = 'analyzed';
    }
  }

  state.progressCount += countedEvents.length;

  const lastTransportSlot = state.lastTransportSlot ?? currentSlotIndex;
  if (!input.envelopeGateEnabled && currentSlotIndex > lastTransportSlot) {
    const boundaryAdvance = currentSlotIndex - lastTransportSlot;
    for (let index = 0; index < boundaryAdvance; index += 1) {
      countedEvents.push({
        id: `count-quantized-${lastTransportSlot + index + 1}`,
        timeSeconds: input.transportTimeSeconds,
        band: 'full',
        value: 1,
        threshold: 0,
        mode: 'quantized',
      });
    }
    state.progressCount += boundaryAdvance;
    state.progressMode = 'quantized';
  }

  if (
    state.progressCount >= state.target &&
    state.armedAtSlotIndex === null &&
    currentSlotIndex >= 0
  ) {
    state.armedAtSlotIndex = currentSlotIndex;
  }

  let shouldSwitch = false;
  if (
    currentSlotIndex > lastTransportSlot &&
    state.armedAtSlotIndex !== null &&
    currentSlotIndex > state.armedAtSlotIndex
  ) {
    if (!input.autoSwitchEnabled || input.playableClipCount < 2) {
      state.blockedReason = 'auto-switch unavailable';
    } else if (!input.nextClipReady) {
      state.blockedReason = input.nextClipLabel
        ? `next clip ${input.nextClipLabel} is not ready`
        : 'next clip is not ready';
    } else {
      shouldSwitch = true;
    }
  }

  state.lastTransportSlot = currentSlotIndex;
  state.lastTransportTimeSeconds = Math.max(0, input.transportTimeSeconds);

  return {
    state,
    countedEvents,
    currentSlotIndex,
    shouldSwitch,
  };
};
