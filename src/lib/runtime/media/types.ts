import type { DecodeBackend } from '$lib/types/engine';
import type { DeckFrameLease, DeckFrameRequest, HotDeckId } from '$lib/types/hot-deck';

export interface MediaSourceDescriptor {
  sourceId: string;
  url: string;
  durationSeconds: number | null;
  decodeBackend: DecodeBackend;
}

export interface DecodeSession {
  sourceId: string;
  backend: DecodeBackend;
  acquireFrame: (request: DeckFrameRequest) => Promise<DeckFrameLease>;
  dispose: () => Promise<void> | void;
}

export interface MediaSourceRuntime {
  descriptor: MediaSourceDescriptor;
  createDecodeSession: (deckId: HotDeckId) => Promise<DecodeSession>;
  dispose: () => Promise<void> | void;
}
