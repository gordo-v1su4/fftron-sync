import type { DecodeBackend, RendererBackend } from '$lib/types/engine';

export type HotDeckId = string;
export type HotDeckReadiness = 'cold' | 'warming' | 'warm' | 'hot' | 'failed' | 'disposed';
export type PreparedFrameHandleKind = 'frame' | 'proxy' | 'pre_render_target';
export type DeckSwitchClassification = 'hot' | 'warm' | 'coldFallback' | 'failed';
export type DeckPresentationBackend = RendererBackend | 'htmlvideo';
export type TimingAuthority = 'rust' | 'frontendFallback';

export interface HotDeckFeatureFlags {
  useWebGpuHotDecks: boolean;
  useVideoTimeShaper: boolean;
  useDeckFrameCache: boolean;
}

export const defaultHotDeckFeatureFlags: HotDeckFeatureFlags = {
  useWebGpuHotDecks: false,
  useVideoTimeShaper: false,
  useDeckFrameCache: false
};

export interface PreparedFrameHandle {
  id: string;
  deckId: HotDeckId;
  sourceId: string;
  kind: PreparedFrameHandleKind;
  presentable: boolean;
  acquiredAtMs: number;
  stale?: boolean;
}

export interface HotDeckState {
  id: HotDeckId;
  sourceId: string;
  readiness: HotDeckReadiness;
  resourcesRetained: boolean;
  updatedAtMs: number;
  presentableHandle?: PreparedFrameHandle;
  error?: string;
  releasedHandleIds: readonly string[];
}

export type HotDeckEvent =
  | { type: 'prepare'; atMs: number }
  | { type: 'resourcesReady'; atMs: number }
  | { type: 'frameReady'; atMs: number; handle: PreparedFrameHandle }
  | { type: 'loadError'; atMs: number; error: string }
  | { type: 'dispose'; atMs: number }
  | { type: 'evict'; atMs: number }
  | { type: 'retry'; atMs: number };

export interface DeckRenderSelectionInput {
  activeDeckId: HotDeckId;
  transitionToDeckId?: HotDeckId;
  transitionProgress?: number;
  extraRequestedDeckIds?: readonly HotDeckId[];
}

export interface DeckRenderSelection {
  mode: 'steady' | 'transition';
  visibleDeckIds: readonly HotDeckId[];
  droppedDeckIds: readonly HotDeckId[];
}

export interface DeckSwitchMeasurementInput {
  deckId: HotDeckId;
  readiness: HotDeckReadiness;
  scheduledBoundaryAtMs: number;
  requestedAtMs: number;
  frontendReceiptAtMs: number;
  presentedAtMs: number;
  displayFrameBudgetMs: number;
  timingAuthority: TimingAuthority;
  rendererBackend: DeckPresentationBackend;
  decodeBackend: DecodeBackend;
  handle?: PreparedFrameHandle;
}

export interface DeckSwitchMeasurement {
  deckId: HotDeckId;
  classification: DeckSwitchClassification;
  canReportHot: boolean;
  scheduledBoundaryAtMs: number;
  requestedAtMs: number;
  frontendReceiptAtMs: number;
  presentedAtMs: number;
  requestToPresentationMs: number;
  boundaryToPresentationMs: number;
  displayFrameBudgetMs: number;
  rendererBackend: DeckPresentationBackend;
  decodeBackend: DecodeBackend;
  fallbackReason?: string;
}

export interface HotDeckCapabilityProbe {
  webgpu: boolean;
  webcodecs: boolean;
  deviceLost: boolean;
  rustReportsWebGpu: boolean;
  rustReportsWebCodecs: boolean;
}

export interface HotDeckCapabilityDecision {
  canAttemptWebGpuHotPath: boolean;
  canClaimHotWithoutTelemetry: false;
  fallbackReason?: string;
  rustCapabilityMismatch: boolean;
}

export function createColdHotDeck(id: HotDeckId, sourceId: string, atMs = 0): HotDeckState {
  return {
    id,
    sourceId,
    readiness: 'cold',
    resourcesRetained: false,
    updatedAtMs: atMs,
    releasedHandleIds: []
  };
}

export function isValidPresentableHandle(handle: PreparedFrameHandle | undefined): handle is PreparedFrameHandle {
  return Boolean(handle?.presentable && !handle.stale);
}

export function transitionHotDeck(state: HotDeckState, event: HotDeckEvent): HotDeckState {
  switch (event.type) {
    case 'prepare':
      return {
        ...state,
        readiness: 'warming',
        resourcesRetained: true,
        presentableHandle: undefined,
        error: undefined,
        updatedAtMs: event.atMs
      };
    case 'resourcesReady':
      return state.readiness === 'warming'
        ? { ...state, readiness: 'warm', resourcesRetained: true, updatedAtMs: event.atMs }
        : { ...state, updatedAtMs: event.atMs };
    case 'frameReady':
      return isValidPresentableHandle(event.handle)
        ? {
            ...state,
            readiness: 'hot',
            resourcesRetained: true,
            presentableHandle: event.handle,
            error: undefined,
            updatedAtMs: event.atMs
          }
        : {
            ...state,
            readiness: 'failed',
            resourcesRetained: state.resourcesRetained,
            presentableHandle: undefined,
            error: 'frame handle is not presentable',
            updatedAtMs: event.atMs
          };
    case 'loadError':
      return {
        ...state,
        readiness: 'failed',
        presentableHandle: undefined,
        error: event.error,
        updatedAtMs: event.atMs
      };
    case 'dispose':
    case 'evict':
      return releaseDeckRuntimeResources(state, event.atMs);
    case 'retry':
      return state.readiness === 'failed' || state.readiness === 'disposed' || state.readiness === 'cold'
        ? {
            ...state,
            readiness: 'warming',
            resourcesRetained: true,
            presentableHandle: undefined,
            error: undefined,
            updatedAtMs: event.atMs
          }
        : { ...state, updatedAtMs: event.atMs };
  }
}

export function releaseDeckRuntimeResources(state: HotDeckState, atMs: number): HotDeckState {
  const releasedHandleIds = state.presentableHandle
    ? appendUnique(state.releasedHandleIds, state.presentableHandle.id)
    : state.releasedHandleIds;

  return {
    ...state,
    readiness: 'disposed',
    resourcesRetained: false,
    presentableHandle: undefined,
    updatedAtMs: atMs,
    releasedHandleIds
  };
}

export function selectVisibleDecks(input: DeckRenderSelectionInput): DeckRenderSelection {
  const transitionActive =
    input.transitionToDeckId !== undefined &&
    input.transitionToDeckId !== input.activeDeckId &&
    input.transitionProgress !== undefined &&
    input.transitionProgress > 0 &&
    input.transitionProgress < 1;
  const requested = uniqueDeckIds([
    input.activeDeckId,
    ...(transitionActive && input.transitionToDeckId ? [input.transitionToDeckId] : []),
    ...(input.extraRequestedDeckIds ?? [])
  ]);
  const visibleCount = transitionActive ? 2 : 1;

  return {
    mode: transitionActive ? 'transition' : 'steady',
    visibleDeckIds: requested.slice(0, visibleCount),
    droppedDeckIds: requested.slice(visibleCount)
  };
}

export function measureDeckSwitch(input: DeckSwitchMeasurementInput): DeckSwitchMeasurement {
  const requestToPresentationMs = input.presentedAtMs - input.requestedAtMs;
  const boundaryToPresentationMs = input.presentedAtMs - input.scheduledBoundaryAtMs;
  const handleReadyAtBoundary =
    isValidPresentableHandle(input.handle) && input.handle.acquiredAtMs <= input.scheduledBoundaryAtMs;
  const withinFrameBudget =
    requestToPresentationMs <= input.displayFrameBudgetMs &&
    boundaryToPresentationMs >= 0 &&
    boundaryToPresentationMs <= input.displayFrameBudgetMs;
  const fallbackReason = getSwitchFallbackReason(input, handleReadyAtBoundary, withinFrameBudget);
  const classification = fallbackReason === undefined ? 'hot' : classifySwitchFallback(input.readiness, fallbackReason);

  return {
    deckId: input.deckId,
    classification,
    canReportHot: classification === 'hot',
    scheduledBoundaryAtMs: input.scheduledBoundaryAtMs,
    requestedAtMs: input.requestedAtMs,
    frontendReceiptAtMs: input.frontendReceiptAtMs,
    presentedAtMs: input.presentedAtMs,
    requestToPresentationMs,
    boundaryToPresentationMs,
    displayFrameBudgetMs: input.displayFrameBudgetMs,
    rendererBackend: input.rendererBackend,
    decodeBackend: input.decodeBackend,
    fallbackReason
  };
}

export function decideHotDeckCapability(probe: HotDeckCapabilityProbe): HotDeckCapabilityDecision {
  if (probe.deviceLost) {
    return capabilityDecision(false, 'deviceLost', probe);
  }
  if (!probe.webgpu) {
    return capabilityDecision(false, 'webgpuUnavailable', probe);
  }
  if (!probe.webcodecs) {
    return capabilityDecision(false, 'webcodecsUnavailable', probe);
  }

  return capabilityDecision(true, undefined, probe);
}

function getSwitchFallbackReason(
  input: DeckSwitchMeasurementInput,
  handleReadyAtBoundary: boolean,
  withinFrameBudget: boolean
): string | undefined {
  if (input.readiness === 'failed') return 'deckFailed';
  if (input.readiness === 'disposed') return 'deckDisposed';
  if (input.readiness === 'cold') return 'deckCold';
  if (input.readiness === 'warming' || input.readiness === 'warm') return 'deckNotHot';
  if (input.timingAuthority !== 'rust') return 'frontendTimingFallback';
  if (!handleReadyAtBoundary) return 'missingPreparedHandleAtBoundary';
  if (!withinFrameBudget) return 'missedFrameBudget';
  return undefined;
}

function classifySwitchFallback(
  readiness: HotDeckReadiness,
  fallbackReason: string
): DeckSwitchClassification {
  if (readiness === 'failed' || readiness === 'disposed' || fallbackReason === 'missingPreparedHandleAtBoundary') {
    return 'failed';
  }
  if (readiness === 'cold') {
    return 'coldFallback';
  }
  return 'warm';
}

function capabilityDecision(
  canAttemptWebGpuHotPath: boolean,
  fallbackReason: string | undefined,
  probe: HotDeckCapabilityProbe
): HotDeckCapabilityDecision {
  const rustCapabilityMismatch =
    (probe.webgpu && !probe.rustReportsWebGpu) || (probe.webcodecs && !probe.rustReportsWebCodecs);

  return {
    canAttemptWebGpuHotPath,
    canClaimHotWithoutTelemetry: false,
    fallbackReason,
    rustCapabilityMismatch
  };
}

function uniqueDeckIds(deckIds: readonly HotDeckId[]): HotDeckId[] {
  return [...new Set(deckIds)];
}

function appendUnique(values: readonly string[], next: string): readonly string[] {
  return values.includes(next) ? values : [...values, next];
}
