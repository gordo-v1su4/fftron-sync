import type { RuntimeCapabilities } from '$lib/types/engine';
import type { PresentableFrameHandle, VisibleDeckOutput } from '$lib/runtime/decks/hotDeck';

export interface DeckGpuFeatureFlags {
  useWebGpuHotDecks: boolean;
}

export interface DeckGpuCapabilityInput {
  capabilities: RuntimeCapabilities;
  flags: DeckGpuFeatureFlags;
  navigatorGpuAvailable: boolean;
  deviceLost: boolean;
}

export interface DeckGpuCapabilityState {
  enabled: boolean;
  backend: 'webgpu' | 'fallback';
  fallbackReason: string | null;
}

export interface DeckSourceSnapshot {
  activeDeckId: string;
  activeFrame: PresentableFrameHandle | null;
  transition: boolean;
  incomingDeckId?: string;
  incomingFrame?: PresentableFrameHandle | null;
}

export interface DeckRenderTarget {
  deckId: string;
  role: VisibleDeckOutput['role'];
  frame: PresentableFrameHandle;
}

export interface DeckRenderPlan {
  mode: 'steady' | 'transition' | 'fallback';
  targets: DeckRenderTarget[];
  capability: DeckGpuCapabilityState;
  fallbackReason: string | null;
}
