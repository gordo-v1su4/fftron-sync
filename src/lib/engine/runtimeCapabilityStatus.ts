import type { RuntimeCapabilities } from '$lib/types/engine';

export interface RuntimeCapabilityTruth {
  rendererSummary: string;
  decodeSummary: string;
  integrationNote: string;
}

export function describeRuntimeCapabilityTruth(capabilities: RuntimeCapabilities): RuntimeCapabilityTruth {
  const rendererSummary =
    capabilities.selectedRenderer === 'webgpu'
      ? capabilities.webgpu
        ? 'Renderer pref: WebGPU probe only'
        : 'Renderer active: WebGL2 fallback'
      : 'Renderer active: WebGL2 fallback';

  const decodeSummary =
    capabilities.selectedDecode === 'webcodecs'
      ? capabilities.webcodecs
        ? 'Decode pref: WebCodecs probe only'
        : 'Decode active: HTMLVideo fallback'
      : capabilities.selectedDecode === 'native_ffmpeg'
        ? capabilities.nativeFfmpeg
          ? 'Decode active: native_ffmpeg desktop path'
          : 'Decode active: HTMLVideo fallback'
        : 'Decode active: HTMLVideo fallback';

  const integrationNote =
    capabilities.selectedRenderer === 'webgpu' || capabilities.selectedDecode === 'webcodecs'
      ? 'WebGPU/WebCodecs selections are capability preferences only until telemetry-backed deck integration is live.'
      : 'Current live deck path remains the HTMLVideo/WebGL2 fallback.';

  return {
    rendererSummary,
    decodeSummary,
    integrationNote
  };
}
