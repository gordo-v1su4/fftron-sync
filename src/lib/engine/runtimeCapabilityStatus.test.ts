import { describe, expect, it } from 'vitest';
import { describeRuntimeCapabilityTruth } from './runtimeCapabilityStatus';
import type { RuntimeCapabilities } from '$lib/types/engine';

const capabilities = (overrides: Partial<RuntimeCapabilities> = {}): RuntimeCapabilities => ({
  webgl2: true,
  webgpu: false,
  webcodecs: false,
  nativeFfmpeg: false,
  rustFfmpegFeature: false,
  selectedRenderer: 'webgl2',
  selectedDecode: 'htmlvideo',
  activeRenderer: 'webgl2',
  activeDecode: 'htmlvideo',
  activationState: 'htmlvideo_fallback',
  fallbackReason: 'Current live deck path remains on the HTMLVideo/WebGL2 transition path.',
  engineLoadError: 'MasterSelects-style WebGPU engine is not active yet.',
  hotDecks: {
    useWebGpuHotDecks: false,
    useVideoTimeShaper: false,
    useDeckFrameCache: false
  },
  ...overrides
});

describe('describeRuntimeCapabilityTruth', () => {
  it('reports the fallback path plainly when no probe-backed preference is selected', () => {
    expect(describeRuntimeCapabilityTruth(capabilities())).toEqual({
      engineSummary: 'Engine active: WEBGL2 / htmlvideo',
      integrationNote: 'MasterSelects-style WebGPU engine is not active yet.',
      tone: 'error',
    });
  });

  it('surfaces WebGPU selection as an unmet engine requirement until active playback really switches', () => {
    expect(
      describeRuntimeCapabilityTruth(
        capabilities({
          webgpu: true,
          webcodecs: true,
          hotDecks: {
            useWebGpuHotDecks: true,
            useVideoTimeShaper: false,
            useDeckFrameCache: false
          },
          selectedRenderer: 'webgpu',
          selectedDecode: 'webcodecs',
          activeRenderer: 'webgl2',
          activeDecode: 'htmlvideo',
          activationState: 'webgpu_required',
          fallbackReason: 'MasterSelects-style WebGPU playback engine is not wired as the active deck path yet.',
          engineLoadError: 'MasterSelects-style WebGPU engine is not active yet.',
        })
      )
    ).toEqual({
      engineSummary: 'Engine active: WEBGL2 / htmlvideo',
      integrationNote: 'MasterSelects-style WebGPU engine is not active yet.',
      tone: 'error',
    });
  });

  it('reports a real WebGPU active path as healthy when activation is complete', () => {
    expect(
      describeRuntimeCapabilityTruth(
        capabilities({
          webgpu: true,
          webcodecs: true,
          selectedRenderer: 'webgpu',
          selectedDecode: 'webcodecs',
          activeRenderer: 'webgpu',
          activeDecode: 'webcodecs',
          activationState: 'webgpu_active',
          fallbackReason: null,
          engineLoadError: null,
        })
      )
    ).toEqual({
      engineSummary: 'Engine active: WEBGPU / webcodecs',
      integrationNote: 'MasterSelects-style WebGPU deck playback is active.',
      tone: 'ok',
    });
  });
});
