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
      rendererSummary: 'Renderer active: WebGL2 fallback',
      decodeSummary: 'Decode active: HTMLVideo fallback',
      integrationNote: 'Current live deck path remains the HTMLVideo/WebGL2 fallback.'
    });
  });

  it('marks WebGPU and WebCodecs selections as probe-only instead of active integration', () => {
    expect(
      describeRuntimeCapabilityTruth(
        capabilities({
          webgpu: true,
          webcodecs: true,
          selectedRenderer: 'webgpu',
          selectedDecode: 'webcodecs'
        })
      )
    ).toEqual({
      rendererSummary: 'Renderer pref: WebGPU probe only',
      decodeSummary: 'Decode pref: WebCodecs probe only',
      integrationNote: 'WebGPU/WebCodecs selections are capability preferences only until telemetry-backed deck integration is live.'
    });
  });

  it('keeps native ffmpeg truthful as an actual desktop decode path', () => {
    expect(
      describeRuntimeCapabilityTruth(
        capabilities({
          nativeFfmpeg: true,
          selectedDecode: 'native_ffmpeg'
        })
      )
    ).toMatchObject({
      decodeSummary: 'Decode active: native_ffmpeg desktop path'
    });
  });
});
