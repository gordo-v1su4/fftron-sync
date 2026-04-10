import { describe, expect, it } from 'vitest';
import {
  createColdHotDeck,
  decideHotDeckCapability,
  defaultHotDeckFeatureFlags,
  measureDeckSwitch,
  selectVisibleDecks,
  transitionHotDeck,
  type PreparedFrameHandle
} from './hotDeckContracts';

const preparedFrame: PreparedFrameHandle = {
  id: 'frame-1',
  deckId: 'deck-a',
  sourceId: 'source-a',
  kind: 'frame',
  presentable: true,
  acquiredAtMs: 900
};

describe('hot deck lifecycle contract', () => {
  it('keeps hot deck feature flags default-off for safe rollout', () => {
    expect(defaultHotDeckFeatureFlags).toEqual({
      useWebGpuHotDecks: false,
      useVideoTimeShaper: false,
      useDeckFrameCache: false
    });
  });

  it('moves from cold to warming when preparation starts', () => {
    const state = transitionHotDeck(createColdHotDeck('deck-a', 'source-a'), { type: 'prepare', atMs: 10 });

    expect(state.readiness).toBe('warming');
    expect(state.resourcesRetained).toBe(true);
  });

  it('moves from warming to hot only after a valid presentable frame exists', () => {
    const warming = transitionHotDeck(createColdHotDeck('deck-a', 'source-a'), { type: 'prepare', atMs: 10 });
    const hot = transitionHotDeck(warming, { type: 'frameReady', atMs: 20, handle: preparedFrame });

    expect(hot.readiness).toBe('hot');
    expect(hot.presentableHandle).toEqual(preparedFrame);
  });

  it('keeps resource-only readiness warm until a first frame is presentable', () => {
    const warming = transitionHotDeck(createColdHotDeck('deck-a', 'source-a'), { type: 'prepare', atMs: 10 });
    const warm = transitionHotDeck(warming, { type: 'resourcesReady', atMs: 20 });

    expect(warm.readiness).toBe('warm');
    expect(warm.presentableHandle).toBeUndefined();
  });

  it('moves from warm to hot when frame readiness arrives', () => {
    const warming = transitionHotDeck(createColdHotDeck('deck-a', 'source-a'), { type: 'prepare', atMs: 10 });
    const warm = transitionHotDeck(warming, { type: 'resourcesReady', atMs: 20 });
    const hot = transitionHotDeck(warm, { type: 'frameReady', atMs: 30, handle: preparedFrame });

    expect(hot.readiness).toBe('hot');
  });

  it('does not silently treat failed or stale frame acquisition as hot', () => {
    const warming = transitionHotDeck(createColdHotDeck('deck-a', 'source-a'), { type: 'prepare', atMs: 10 });
    const failed = transitionHotDeck(warming, {
      type: 'frameReady',
      atMs: 20,
      handle: { ...preparedFrame, id: 'stale-frame', stale: true }
    });

    expect(failed.readiness).toBe('failed');
    expect(failed.error).toContain('not presentable');
  });

  it('retries failed and disposed decks back to warming', () => {
    const warming = transitionHotDeck(createColdHotDeck('deck-a', 'source-a'), { type: 'prepare', atMs: 10 });
    const failed = transitionHotDeck(warming, { type: 'loadError', atMs: 20, error: 'decode failed' });
    const retrying = transitionHotDeck(failed, { type: 'retry', atMs: 30 });
    const disposed = transitionHotDeck(retrying, { type: 'dispose', atMs: 40 });
    const retryingAgain = transitionHotDeck(disposed, { type: 'retry', atMs: 50 });

    expect(retrying.readiness).toBe('warming');
    expect(disposed.readiness).toBe('disposed');
    expect(retryingAgain.readiness).toBe('warming');
  });

  it('releases presentable handles on dispose or eviction', () => {
    const hot = transitionHotDeck(
      transitionHotDeck(createColdHotDeck('deck-a', 'source-a'), { type: 'prepare', atMs: 10 }),
      { type: 'frameReady', atMs: 20, handle: preparedFrame }
    );
    const disposed = transitionHotDeck(hot, { type: 'evict', atMs: 30 });

    expect(disposed.readiness).toBe('disposed');
    expect(disposed.resourcesRetained).toBe(false);
    expect(disposed.presentableHandle).toBeUndefined();
    expect(disposed.releasedHandleIds).toEqual(['frame-1']);
  });
});

describe('one-visible-deck render selection contract', () => {
  it('returns exactly one visible deck in steady state', () => {
    expect(selectVisibleDecks({ activeDeckId: 'deck-a' })).toEqual({
      mode: 'steady',
      visibleDeckIds: ['deck-a'],
      droppedDeckIds: []
    });
  });

  it('returns exactly two decks during transitions', () => {
    expect(
      selectVisibleDecks({ activeDeckId: 'deck-a', transitionToDeckId: 'deck-b', transitionProgress: 0.5 })
    ).toEqual({
      mode: 'transition',
      visibleDeckIds: ['deck-a', 'deck-b'],
      droppedDeckIds: []
    });
  });

  it('deterministically drops extra requested decks instead of creating a compositor stack', () => {
    expect(
      selectVisibleDecks({
        activeDeckId: 'deck-a',
        transitionToDeckId: 'deck-b',
        transitionProgress: 0.5,
        extraRequestedDeckIds: ['deck-c', 'deck-d']
      })
    ).toEqual({
      mode: 'transition',
      visibleDeckIds: ['deck-a', 'deck-b'],
      droppedDeckIds: ['deck-c', 'deck-d']
    });
  });
});

describe('hot switch telemetry contract', () => {
  it('reports hot only when Rust-timed presentation uses a prepared handle within one frame', () => {
    const result = measureDeckSwitch({
      deckId: 'deck-a',
      readiness: 'hot',
      handle: preparedFrame,
      scheduledBoundaryAtMs: 1000,
      requestedAtMs: 1000,
      frontendReceiptAtMs: 1001,
      presentedAtMs: 1012,
      displayFrameBudgetMs: 16.67,
      timingAuthority: 'rust',
      rendererBackend: 'webgpu',
      decodeBackend: 'webcodecs'
    });

    expect(result.classification).toBe('hot');
    expect(result.canReportHot).toBe(true);
    expect(result.requestToPresentationMs).toBe(12);
  });

  it('does not report hot without a prepared presentable handle at the boundary', () => {
    const result = measureDeckSwitch({
      deckId: 'deck-a',
      readiness: 'hot',
      scheduledBoundaryAtMs: 1000,
      requestedAtMs: 1000,
      frontendReceiptAtMs: 1001,
      presentedAtMs: 1012,
      displayFrameBudgetMs: 16.67,
      timingAuthority: 'rust',
      rendererBackend: 'webgpu',
      decodeBackend: 'webcodecs'
    });

    expect(result.classification).toBe('failed');
    expect(result.canReportHot).toBe(false);
    expect(result.fallbackReason).toBe('missingPreparedHandleAtBoundary');
  });

  it('treats frontend-only timing as fallback/prototype data', () => {
    const result = measureDeckSwitch({
      deckId: 'deck-a',
      readiness: 'hot',
      handle: preparedFrame,
      scheduledBoundaryAtMs: 1000,
      requestedAtMs: 1000,
      frontendReceiptAtMs: 1001,
      presentedAtMs: 1012,
      displayFrameBudgetMs: 16.67,
      timingAuthority: 'frontendFallback',
      rendererBackend: 'webgpu',
      decodeBackend: 'webcodecs'
    });

    expect(result.classification).toBe('warm');
    expect(result.canReportHot).toBe(false);
    expect(result.fallbackReason).toBe('frontendTimingFallback');
  });

  it('maps cold switches to explicit cold fallback instead of hot', () => {
    const result = measureDeckSwitch({
      deckId: 'deck-a',
      readiness: 'cold',
      scheduledBoundaryAtMs: 1000,
      requestedAtMs: 1000,
      frontendReceiptAtMs: 1001,
      presentedAtMs: 1012,
      displayFrameBudgetMs: 16.67,
      timingAuthority: 'rust',
      rendererBackend: 'htmlvideo',
      decodeBackend: 'htmlvideo'
    });

    expect(result.classification).toBe('coldFallback');
    expect(result.canReportHot).toBe(false);
  });

  it('rejects missed one-frame budgets as non-hot', () => {
    const result = measureDeckSwitch({
      deckId: 'deck-a',
      readiness: 'hot',
      handle: preparedFrame,
      scheduledBoundaryAtMs: 1000,
      requestedAtMs: 1000,
      frontendReceiptAtMs: 1001,
      presentedAtMs: 1034,
      displayFrameBudgetMs: 16.67,
      timingAuthority: 'rust',
      rendererBackend: 'webgpu',
      decodeBackend: 'webcodecs'
    });

    expect(result.classification).toBe('warm');
    expect(result.canReportHot).toBe(false);
    expect(result.fallbackReason).toBe('missedFrameBudget');
  });
});

describe('capability and fallback matrix contract', () => {
  it('keeps unavailable WebGPU/WebCodecs/device-loss paths from claiming hot', () => {
    expect(
      decideHotDeckCapability({
        webgpu: false,
        webcodecs: true,
        deviceLost: false,
        rustReportsWebGpu: false,
        rustReportsWebCodecs: false
      })
    ).toMatchObject({ canAttemptWebGpuHotPath: false, fallbackReason: 'webgpuUnavailable' });
    expect(
      decideHotDeckCapability({
        webgpu: true,
        webcodecs: false,
        deviceLost: false,
        rustReportsWebGpu: true,
        rustReportsWebCodecs: false
      })
    ).toMatchObject({ canAttemptWebGpuHotPath: false, fallbackReason: 'webcodecsUnavailable' });
    expect(
      decideHotDeckCapability({
        webgpu: true,
        webcodecs: true,
        deviceLost: true,
        rustReportsWebGpu: true,
        rustReportsWebCodecs: true
      })
    ).toMatchObject({ canAttemptWebGpuHotPath: false, fallbackReason: 'deviceLost' });
  });

  it('allows JS/WebView capability to attempt WebGPU while Rust stays conservative, but not to claim hot without telemetry', () => {
    expect(
      decideHotDeckCapability({
        webgpu: true,
        webcodecs: true,
        deviceLost: false,
        rustReportsWebGpu: false,
        rustReportsWebCodecs: false
      })
    ).toEqual({
      canAttemptWebGpuHotPath: true,
      canClaimHotWithoutTelemetry: false,
      rustCapabilityMismatch: true,
      fallbackReason: undefined
    });
  });
});
