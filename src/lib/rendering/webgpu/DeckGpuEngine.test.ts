import { describe, expect, it } from 'vitest';
import type { RuntimeCapabilities } from '$lib/types/engine';
import type { PresentableFrameHandle } from '$lib/runtime/decks/hotDeck';
import { resolveDeckGpuCapability } from './capability';
import { DeckGpuEngine } from './DeckGpuEngine';
import { DeckRenderTargetManager } from './DeckRenderTargetManager';
import type { DeckGpuCapabilityInput, DeckGpuCapabilityState } from './types';

const capabilities = (overrides: Partial<RuntimeCapabilities> = {}): RuntimeCapabilities => ({
  webgl2: true,
  webgpu: true,
  webcodecs: true,
  nativeFfmpeg: false,
  rustFfmpegFeature: false,
  selectedRenderer: 'webgpu',
  selectedDecode: 'webcodecs',
  activeRenderer: 'webgpu',
  activeDecode: 'webcodecs',
  activationState: 'webgpu_active',
  fallbackReason: null,
  engineLoadError: null,
  hotDecks: {
    useWebGpuHotDecks: true,
    useVideoTimeShaper: true,
    useDeckFrameCache: true
  },
  ...overrides
});

const capabilityInput = (overrides: Partial<DeckGpuCapabilityInput> = {}): DeckGpuCapabilityInput => ({
  capabilities: capabilities(),
  flags: { useWebGpuHotDecks: true },
  navigatorGpuAvailable: true,
  deviceLost: false,
  ...overrides
});

const enabledCapability: DeckGpuCapabilityState = {
  enabled: true,
  backend: 'webgpu',
  fallbackReason: null
};

const frame = (deckId: string, sourceId: string): PresentableFrameHandle => ({
  id: `${deckId}-frame`,
  deckId,
  sourceId,
  kind: 'prerender',
  acquiredAtMs: 500,
  stale: false
});

describe('WebGPU deck capability contract', () => {
  it('enables the skeleton only behind the feature flag and WebGPU-selected runtime capability', () => {
    expect(resolveDeckGpuCapability(capabilityInput())).toEqual({
      enabled: true,
      backend: 'webgpu',
      fallbackReason: null
    });
  });

  it('falls back when feature flag is disabled', () => {
    const state = resolveDeckGpuCapability(capabilityInput({ flags: { useWebGpuHotDecks: false } }));

    expect(state.enabled).toBe(false);
    expect(state.fallbackReason).toContain('feature flag');
  });

  it('falls back when navigator.gpu is unavailable', () => {
    const state = resolveDeckGpuCapability(capabilityInput({ navigatorGpuAvailable: false }));

    expect(state.enabled).toBe(false);
    expect(state.fallbackReason).toContain('navigator.gpu');
  });

  it('falls back when the WebGPU device is lost', () => {
    const state = resolveDeckGpuCapability(capabilityInput({ deviceLost: true }));

    expect(state.enabled).toBe(false);
    expect(state.fallbackReason).toContain('lost');
  });

  it('falls back when runtime WebGPU capability or selected renderer disagrees', () => {
    expect(
      resolveDeckGpuCapability(capabilityInput({ capabilities: capabilities({ webgpu: false }) })).fallbackReason
    ).toContain('webgpu unavailable');
    expect(
      resolveDeckGpuCapability(capabilityInput({ capabilities: capabilities({ selectedRenderer: 'webgl2' }) }))
        .fallbackReason
    ).toContain('selected renderer');
  });
});

describe('narrowed WebGPU deck render target manager', () => {
  it('plans exactly one active deck target in steady state', () => {
    const plan = new DeckRenderTargetManager().createPlan(
      {
        activeDeckId: 'deck-a',
        activeFrame: frame('deck-a', 'source-a'),
        transition: false
      },
      enabledCapability
    );

    expect(plan.mode).toBe('steady');
    expect(plan.targets.map((target) => [target.deckId, target.role])).toEqual([['deck-a', 'active']]);
    expect(plan.fallbackReason).toBeNull();
  });

  it('plans exactly two deck targets during transitions and no arbitrary layer stack', () => {
    const plan = new DeckRenderTargetManager().createPlan(
      {
        activeDeckId: 'deck-a',
        activeFrame: frame('deck-a', 'source-a'),
        incomingDeckId: 'deck-b',
        incomingFrame: frame('deck-b', 'source-b'),
        transition: true
      },
      enabledCapability
    );

    expect(plan.mode).toBe('transition');
    expect(plan.targets).toHaveLength(2);
    expect(plan.targets.map((target) => target.role)).toEqual(['outgoing', 'incoming']);
  });

  it('falls back rather than presenting a transition when one transition frame is unavailable', () => {
    const plan = new DeckRenderTargetManager().createPlan(
      {
        activeDeckId: 'deck-a',
        activeFrame: frame('deck-a', 'source-a'),
        incomingDeckId: 'deck-b',
        incomingFrame: null,
        transition: true
      },
      enabledCapability
    );

    expect(plan.mode).toBe('fallback');
    expect(plan.targets).toHaveLength(1);
    expect(plan.fallbackReason).toContain('transition requested');
  });

  it('falls back when no active presentable frame handle exists', () => {
    const plan = new DeckRenderTargetManager().createPlan(
      {
        activeDeckId: 'deck-a',
        activeFrame: null,
        transition: false
      },
      enabledCapability
    );

    expect(plan.mode).toBe('fallback');
    expect(plan.targets).toHaveLength(0);
    expect(plan.fallbackReason).toContain('no presentable');
  });
});

describe('DeckGpuEngine facade', () => {
  it('combines capability fallback with target planning', () => {
    const engine = new DeckGpuEngine();
    const plan = engine.planPresentation(
      {
        activeDeckId: 'deck-a',
        activeFrame: frame('deck-a', 'source-a'),
        transition: false
      },
      capabilityInput({ navigatorGpuAvailable: false })
    );

    expect(plan.mode).toBe('fallback');
    expect(plan.targets).toHaveLength(0);
    expect(plan.capability.fallbackReason).toContain('navigator.gpu');
  });
});
