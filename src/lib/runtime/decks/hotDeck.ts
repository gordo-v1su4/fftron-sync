import type { DecodeBackend, RendererBackend } from '$lib/types/engine';

export type HotDeckReadiness = 'cold' | 'warming' | 'warm' | 'hot' | 'failed' | 'disposed';
export type PreparedFrameKind = 'frame' | 'proxy' | 'prerender';
export type DeckSwitchClassification = 'hot' | 'warm' | 'coldFallback' | 'failed';
export type SwitchTimingAuthority = 'rust' | 'frontend-prototype';

export interface HotDeckId {
  deckId: string;
  slotId: string;
  sourceId: string;
}

export interface PresentableFrameHandle {
  id: string;
  deckId: string;
  sourceId: string;
  kind: PreparedFrameKind;
  acquiredAtMs: number;
  stale: boolean;
}

export interface HotDeckState extends HotDeckId {
  readiness: HotDeckReadiness;
  resourcesReady: boolean;
  presentableFrame: PresentableFrameHandle | null;
  retainedFrameIds: string[];
  lastReleasedFrameIds: string[];
  staleFramePolicy: 'reject' | 'frameHoldFallback';
  failureReason: string | null;
  updatedAtMs: number;
}

export type HotDeckEvent =
  | { type: 'prepare'; atMs: number }
  | { type: 'resourcesReady'; atMs: number }
  | { type: 'frameReady'; atMs: number; frame: PresentableFrameHandle }
  | { type: 'failed'; atMs: number; reason: string }
  | { type: 'dispose'; atMs: number }
  | { type: 'evict'; atMs: number }
  | { type: 'retry'; atMs: number };

export interface VisibleDeckSelectorInput {
  activeDeckId: string;
  incomingDeckId?: string;
  transition: boolean;
}

export interface VisibleDeckOutput {
  deckId: string;
  role: 'active' | 'outgoing' | 'incoming';
}

export interface DeckSwitchTelemetryInput {
  deckId: string;
  sourceId: string;
  readiness: HotDeckReadiness;
  hadPresentableFrame: boolean;
  scheduledBoundaryMs: number;
  requestedAtMs: number;
  frontendReceiptMs: number;
  presentedAtMs: number;
  displayFrameBudgetMs: number;
  rendererBackend: RendererBackend;
  decodeBackend: DecodeBackend;
  timingAuthority: SwitchTimingAuthority;
  fallbackReason?: string;
}

export interface DeckSwitchResult {
  deckId: string;
  sourceId: string;
  classification: DeckSwitchClassification;
  frameDeltaMs: number;
  withinOneFrameBudget: boolean;
  rendererBackend: RendererBackend;
  decodeBackend: DecodeBackend;
  timingAuthority: SwitchTimingAuthority;
  fallbackReason: string | null;
}

export function createHotDeckState(identity: HotDeckId, nowMs = 0): HotDeckState {
  return {
    ...identity,
    readiness: 'cold',
    resourcesReady: false,
    presentableFrame: null,
    retainedFrameIds: [],
    lastReleasedFrameIds: [],
    staleFramePolicy: 'reject',
    failureReason: null,
    updatedAtMs: nowMs
  };
}

export function reduceHotDeckState(state: HotDeckState, event: HotDeckEvent): HotDeckState {
  switch (event.type) {
    case 'prepare':
      if (state.readiness === 'disposed' || state.readiness === 'failed') return state;
      return {
        ...state,
        readiness: 'warming',
        resourcesReady: false,
        presentableFrame: null,
        failureReason: null,
        updatedAtMs: event.atMs
      };
    case 'resourcesReady':
      if (state.readiness !== 'warming') return touch(state, event.atMs);
      return {
        ...state,
        readiness: state.presentableFrame ? 'hot' : 'warm',
        resourcesReady: true,
        failureReason: null,
        updatedAtMs: event.atMs
      };
    case 'frameReady':
      if (state.readiness === 'disposed' || state.readiness === 'failed') return touch(state, event.atMs);
      if (event.frame.stale) {
        return {
          ...state,
          readiness: state.resourcesReady || state.readiness === 'warming' ? 'warm' : state.readiness,
          presentableFrame: null,
          retainedFrameIds: removeFrameId(state.retainedFrameIds, event.frame.id),
          staleFramePolicy: 'frameHoldFallback',
          failureReason: 'stale frame requires explicit frame-hold fallback and cannot be hot',
          updatedAtMs: event.atMs
        };
      }
      return {
        ...state,
        readiness: 'hot',
        resourcesReady: true,
        presentableFrame: event.frame,
        retainedFrameIds: addFrameId(state.retainedFrameIds, event.frame.id),
        staleFramePolicy: 'reject',
        failureReason: null,
        updatedAtMs: event.atMs
      };
    case 'failed':
      if (state.readiness === 'disposed') return touch(state, event.atMs);
      return {
        ...state,
        readiness: 'failed',
        resourcesReady: false,
        presentableFrame: null,
        failureReason: event.reason,
        lastReleasedFrameIds: releaseRetainedFrames(state),
        retainedFrameIds: [],
        updatedAtMs: event.atMs
      };
    case 'dispose':
      return {
        ...state,
        readiness: 'disposed',
        resourcesReady: false,
        presentableFrame: null,
        failureReason: null,
        lastReleasedFrameIds: releaseRetainedFrames(state),
        retainedFrameIds: [],
        updatedAtMs: event.atMs
      };
    case 'evict':
      return {
        ...state,
        readiness: 'cold',
        resourcesReady: false,
        presentableFrame: null,
        failureReason: null,
        lastReleasedFrameIds: releaseRetainedFrames(state),
        retainedFrameIds: [],
        updatedAtMs: event.atMs
      };
    case 'retry':
      if (state.readiness !== 'failed' && state.readiness !== 'disposed') return touch(state, event.atMs);
      return {
        ...state,
        readiness: 'warming',
        resourcesReady: false,
        presentableFrame: null,
        failureReason: null,
        lastReleasedFrameIds: releaseRetainedFrames(state),
        retainedFrameIds: [],
        updatedAtMs: event.atMs
      };
  }
}

export function selectVisibleDecks(input: VisibleDeckSelectorInput): VisibleDeckOutput[] {
  if (!input.transition || !input.incomingDeckId || input.incomingDeckId === input.activeDeckId) {
    return [{ deckId: input.activeDeckId, role: 'active' }];
  }

  return [
    { deckId: input.activeDeckId, role: 'outgoing' },
    { deckId: input.incomingDeckId, role: 'incoming' }
  ];
}

export function enforceMaxTwoVisibleDecks(requested: readonly VisibleDeckOutput[]): VisibleDeckOutput[] {
  const uniqueDecks = new Set<string>();
  const result: VisibleDeckOutput[] = [];

  for (const output of requested) {
    if (uniqueDecks.has(output.deckId)) continue;
    uniqueDecks.add(output.deckId);
    result.push(output);
    if (result.length === 2) break;
  }

  return result;
}

export function classifyDeckSwitch(input: DeckSwitchTelemetryInput): DeckSwitchResult {
  const frameDeltaMs = input.presentedAtMs - input.requestedAtMs;
  const timestampsValid = [
    input.scheduledBoundaryMs,
    input.requestedAtMs,
    input.frontendReceiptMs,
    input.presentedAtMs,
    input.displayFrameBudgetMs
  ].every((timestamp) => Number.isFinite(timestamp));
  const withinOneFrameBudget =
    timestampsValid && input.displayFrameBudgetMs > 0 && frameDeltaMs >= 0 && frameDeltaMs <= input.displayFrameBudgetMs;
  const canClaimHot =
    input.readiness === 'hot' &&
    input.hadPresentableFrame &&
    withinOneFrameBudget &&
    input.timingAuthority === 'rust';

  const classification: DeckSwitchClassification = canClaimHot
    ? 'hot'
    : input.readiness === 'failed'
      ? 'failed'
      : input.readiness === 'warm' || input.readiness === 'warming'
        ? 'warm'
        : 'coldFallback';

  return {
    deckId: input.deckId,
    sourceId: input.sourceId,
    classification,
    frameDeltaMs,
    withinOneFrameBudget,
    rendererBackend: input.rendererBackend,
    decodeBackend: input.decodeBackend,
    timingAuthority: input.timingAuthority,
    fallbackReason: canClaimHot ? null : input.fallbackReason ?? inferFallbackReason(input, withinOneFrameBudget)
  };
}

function inferFallbackReason(input: DeckSwitchTelemetryInput, withinOneFrameBudget: boolean): string {
  if (input.readiness === 'failed') return 'deck preparation failed';
  if (input.timingAuthority !== 'rust') return 'frontend timing is prototype data without Rust scheduler authority';
  if (!input.hadPresentableFrame) return 'no valid presentable frame/proxy/pre-render handle';
  if (input.readiness !== 'hot') return `readiness is ${input.readiness}`;
  if (!withinOneFrameBudget) return 'presentation missed one-frame budget';
  return 'not eligible for hot switch';
}

function touch(state: HotDeckState, updatedAtMs: number): HotDeckState {
  return { ...state, updatedAtMs };
}

function addFrameId(ids: readonly string[], frameId: string): string[] {
  return ids.includes(frameId) ? [...ids] : [...ids, frameId];
}

function removeFrameId(ids: readonly string[], frameId: string): string[] {
  return ids.filter((id) => id !== frameId);
}

function releaseRetainedFrames(state: HotDeckState): string[] {
  const retained = state.presentableFrame
    ? addFrameId(state.retainedFrameIds, state.presentableFrame.id)
    : [...state.retainedFrameIds];
  return [...new Set(retained)];
}
