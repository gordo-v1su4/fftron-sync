import {
  enforceMaxTwoVisibleDecks,
  selectVisibleDecks,
  type PresentableFrameHandle,
  type VisibleDeckOutput
} from '$lib/runtime/decks/hotDeck';
import type { DeckGpuCapabilityState, DeckRenderPlan, DeckRenderTarget, DeckSourceSnapshot } from './types';

export class DeckRenderTargetManager {
  createPlan(snapshot: DeckSourceSnapshot, capability: DeckGpuCapabilityState): DeckRenderPlan {
    if (!capability.enabled) {
      return {
        mode: 'fallback',
        targets: [],
        capability,
        fallbackReason: capability.fallbackReason ?? 'WebGPU deck renderer disabled'
      };
    }

    const requestedDecks = enforceMaxTwoVisibleDecks(
      selectVisibleDecks({
        activeDeckId: snapshot.activeDeckId,
        incomingDeckId: snapshot.incomingDeckId,
        transition: snapshot.transition
      })
    );
    const targets = requestedDecks.flatMap((deck) => this.toTarget(deck, snapshot));
    const fallbackReason = this.getFallbackReason(requestedDecks, targets);

    return {
      mode: fallbackReason ? 'fallback' : targets.length === 2 ? 'transition' : 'steady',
      targets,
      capability,
      fallbackReason
    };
  }

  private toTarget(deck: VisibleDeckOutput, snapshot: DeckSourceSnapshot): DeckRenderTarget[] {
    const frame = this.getFrameForDeck(deck.deckId, snapshot);
    if (!frame) return [];

    return [
      {
        deckId: deck.deckId,
        role: deck.role,
        frame
      }
    ];
  }

  private getFrameForDeck(deckId: string, snapshot: DeckSourceSnapshot): PresentableFrameHandle | null {
    if (deckId === snapshot.activeDeckId) return snapshot.activeFrame;
    if (deckId === snapshot.incomingDeckId) return snapshot.incomingFrame ?? null;
    return null;
  }

  private getFallbackReason(requestedDecks: readonly VisibleDeckOutput[], targets: readonly DeckRenderTarget[]): string | null {
    if (targets.length === requestedDecks.length && targets.length > 0) return null;
    if (targets.length === 0) return 'no presentable frame/proxy/pre-render handle for active deck';
    return 'transition requested but one of the two deck frames is unavailable';
  }
}
