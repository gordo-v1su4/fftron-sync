import type { DecodeBackend, RendererBackend } from '$lib/types/engine';

export type HotDeckId = string;
export type HotDeckReadiness = 'cold' | 'warming' | 'warm' | 'hot' | 'failed' | 'disposed';
export type DeckFrameKind = 'frame' | 'proxy' | 'prerender';
export type SwitchReadiness = 'hot' | 'warm' | 'coldFallback' | 'failed';
export type TimingAuthority = 'rust_authoritative' | 'frontend_fallback';

export interface PresentableDeckFrame {
  handleId: string;
  deckId: HotDeckId;
  sourceId: string;
  kind: DeckFrameKind;
  acquiredAtMs: number;
  stale: boolean;
}

export interface DeckFrameLease {
  frame: PresentableDeckFrame;
  release: () => void;
  readonly released: boolean;
}

export interface HotDeckState {
  id: HotDeckId;
  slotId: string;
  sourceId: string;
  readiness: HotDeckReadiness;
  resourceReady: boolean;
  presentableFrame: PresentableDeckFrame | null;
  lastError: string | null;
  updatedAtMs: number;
}

export interface DeckFrameRequest {
  deckId: HotDeckId;
  sourceId: string;
  targetTimeSeconds: number;
  preferKind: DeckFrameKind;
  maxStaleMs: number;
}

export interface HotDeckPrepareOptions {
  deckId: HotDeckId;
  slotId: string;
  sourceId: string;
  nowMs: number;
}

export interface DeckOutput {
  deckId: HotDeckId;
  role: 'active' | 'outgoing' | 'incoming';
  opacity: number;
}

export interface DeckSelectionRequest {
  activeDeckId: HotDeckId | null;
  transition?: {
    fromDeckId: HotDeckId;
    toDeckId: HotDeckId;
    progress: number;
    mode: 'hard_cut' | 'crossfade';
  } | null;
}

export interface DeckSwitchTelemetryInput {
  deckId: HotDeckId;
  scheduledBoundaryMs: number;
  requestedAtMs: number;
  frontendReceiptAtMs: number;
  presentedAtMs: number | null;
  displayFrameBudgetMs: number;
  timingAuthority: TimingAuthority;
  readinessBeforeSwitch: HotDeckReadiness;
  hadPreparedFrame: boolean;
  backend: RendererBackend | DecodeBackend;
  fallbackReason?: string;
}

export interface DeckSwitchResult {
  deckId: HotDeckId;
  readiness: SwitchReadiness;
  frameDeltaMs: number | null;
  withinFrameBudget: boolean;
  timingAuthority: TimingAuthority;
  backend: RendererBackend | DecodeBackend;
  fallbackReason: string | null;
}
