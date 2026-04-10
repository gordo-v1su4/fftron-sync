import { describe, expect, it } from 'vitest';
import {
  classifyDeckSwitch,
  createHotDeckState,
  enforceMaxTwoVisibleDecks,
  reduceHotDeckState,
  selectVisibleDecks,
  type DeckSwitchTelemetryInput,
  type HotDeckState,
  type PresentableFrameHandle,
  type VisibleDeckOutput
} from './hotDeck';

const identity = { deckId: 'deck-a', slotId: 'lane-1-slot-1', sourceId: 'source-a' };

const frame = (overrides: Partial<PresentableFrameHandle> = {}): PresentableFrameHandle => ({
  id: 'frame-a',
  deckId: identity.deckId,
  sourceId: identity.sourceId,
  kind: 'frame',
  acquiredAtMs: 12,
  stale: false,
  ...overrides
});

const hotSwitchInput = (overrides: Partial<DeckSwitchTelemetryInput> = {}): DeckSwitchTelemetryInput => ({
  deckId: identity.deckId,
  sourceId: identity.sourceId,
  readiness: 'hot',
  hadPresentableFrame: true,
  scheduledBoundaryMs: 1000,
  requestedAtMs: 1000,
  frontendReceiptMs: 1004,
  presentedAtMs: 1014,
  displayFrameBudgetMs: 16.67,
  rendererBackend: 'webgpu',
  decodeBackend: 'webcodecs',
  timingAuthority: 'rust',
  ...overrides
});

const prepare = (state: HotDeckState): HotDeckState =>
  reduceHotDeckState(state, { type: 'prepare', atMs: 1 });

describe('hot deck lifecycle reducer', () => {
  it('transitions cold -> warming on prepare', () => {
    expect(prepare(createHotDeckState(identity)).readiness).toBe('warming');
  });

  it('transitions warming -> hot on first valid presentable frame', () => {
    const state = reduceHotDeckState(prepare(createHotDeckState(identity)), {
      type: 'frameReady',
      atMs: 2,
      frame: frame()
    });

    expect(state.readiness).toBe('hot');
    expect(state.presentableFrame?.id).toBe('frame-a');
    expect(state.retainedFrameIds).toEqual(['frame-a']);
  });

  it('transitions warming -> warm when resources are ready without first frame', () => {
    const state = reduceHotDeckState(prepare(createHotDeckState(identity)), {
      type: 'resourcesReady',
      atMs: 2
    });

    expect(state.readiness).toBe('warm');
    expect(state.presentableFrame).toBeNull();
  });

  it('transitions warm -> hot when a presentable frame arrives', () => {
    const warm = reduceHotDeckState(prepare(createHotDeckState(identity)), {
      type: 'resourcesReady',
      atMs: 2
    });
    const hot = reduceHotDeckState(warm, { type: 'frameReady', atMs: 3, frame: frame() });

    expect(hot.readiness).toBe('hot');
    expect(hot.resourcesReady).toBe(true);
  });

  it('transitions warming -> failed on load error and releases retained frames', () => {
    const warming = prepare(createHotDeckState(identity));
    const failed = reduceHotDeckState(warming, { type: 'failed', atMs: 3, reason: 'decode error' });

    expect(failed.readiness).toBe('failed');
    expect(failed.failureReason).toBe('decode error');
    expect(failed.retainedFrameIds).toEqual([]);
  });

  it('transitions warm/hot -> disposed and records released frame handles', () => {
    const hot = reduceHotDeckState(prepare(createHotDeckState(identity)), {
      type: 'frameReady',
      atMs: 2,
      frame: frame()
    });
    const disposed = reduceHotDeckState(hot, { type: 'dispose', atMs: 3 });

    expect(disposed.readiness).toBe('disposed');
    expect(disposed.presentableFrame).toBeNull();
    expect(disposed.retainedFrameIds).toEqual([]);
    expect(disposed.lastReleasedFrameIds).toEqual(['frame-a']);
  });

  it('transitions failed/disposed -> warming only through retry', () => {
    const failed = reduceHotDeckState(prepare(createHotDeckState(identity)), {
      type: 'failed',
      atMs: 2,
      reason: 'missing source'
    });
    const disposed = reduceHotDeckState(failed, { type: 'dispose', atMs: 3 });

    expect(reduceHotDeckState(failed, { type: 'retry', atMs: 4 }).readiness).toBe('warming');
    expect(reduceHotDeckState(disposed, { type: 'retry', atMs: 5 }).readiness).toBe('warming');
  });

  it('never marks stale frame acquisition hot; it requires explicit frame-hold fallback', () => {
    const state = reduceHotDeckState(prepare(createHotDeckState(identity)), {
      type: 'frameReady',
      atMs: 2,
      frame: frame({ id: 'stale-frame', stale: true })
    });

    expect(state.readiness).toBe('warm');
    expect(state.presentableFrame).toBeNull();
    expect(state.staleFramePolicy).toBe('frameHoldFallback');
    expect(state.failureReason).toContain('cannot be hot');
  });
});

describe('one-visible-deck selector', () => {
  it('returns one visible deck in steady state', () => {
    expect(selectVisibleDecks({ activeDeckId: 'deck-a', transition: false })).toEqual([
      { deckId: 'deck-a', role: 'active' }
    ]);
  });

  it('returns exactly two decks during a transition', () => {
    expect(selectVisibleDecks({ activeDeckId: 'deck-a', incomingDeckId: 'deck-b', transition: true })).toEqual([
      { deckId: 'deck-a', role: 'outgoing' },
      { deckId: 'deck-b', role: 'incoming' }
    ]);
  });

  it('reduces more than two requested deck outputs deterministically', () => {
    const requested: VisibleDeckOutput[] = [
      { deckId: 'deck-a', role: 'outgoing' },
      { deckId: 'deck-b', role: 'incoming' },
      { deckId: 'deck-c', role: 'incoming' },
      { deckId: 'deck-b', role: 'incoming' }
    ];

    expect(enforceMaxTwoVisibleDecks(requested)).toEqual([
      { deckId: 'deck-a', role: 'outgoing' },
      { deckId: 'deck-b', role: 'incoming' }
    ]);
  });
});

describe('deck switch telemetry classification', () => {
  it('classifies a Rust-authoritative prepared switch within one frame as hot', () => {
    const result = classifyDeckSwitch(hotSwitchInput());

    expect(result.classification).toBe('hot');
    expect(result.withinOneFrameBudget).toBe(true);
    expect(result.fallbackReason).toBeNull();
  });

  it('rejects hot status when no presentable frame/proxy/pre-render handle exists', () => {
    const result = classifyDeckSwitch(hotSwitchInput({ hadPresentableFrame: false }));

    expect(result.classification).toBe('coldFallback');
    expect(result.fallbackReason).toContain('no valid presentable');
  });

  it('rejects hot status when presentation misses the display frame budget', () => {
    const result = classifyDeckSwitch(hotSwitchInput({ presentedAtMs: 1030 }));

    expect(result.classification).toBe('coldFallback');
    expect(result.withinOneFrameBudget).toBe(false);
    expect(result.fallbackReason).toContain('one-frame budget');
  });

  it('treats frontend-only timing as prototype data, not hot readiness proof', () => {
    const result = classifyDeckSwitch(hotSwitchInput({ timingAuthority: 'frontend-prototype' }));

    expect(result.classification).toBe('coldFallback');
    expect(result.fallbackReason).toContain('Rust scheduler authority');
  });

  it('preserves failed readiness as failed switch telemetry', () => {
    expect(classifyDeckSwitch(hotSwitchInput({ readiness: 'failed' })).classification).toBe('failed');
  });
});
