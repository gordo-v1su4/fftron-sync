import type { RuntimeCapabilities } from '$lib/types/engine';

export interface RuntimeCapabilityTruth {
  engineSummary: string;
  integrationNote: string;
  tone: 'ok' | 'error';
  rendererBadge: string;
  goalBadge: string;
  probeBadge: string;
}

export function describeRuntimeCapabilityTruth(capabilities: RuntimeCapabilities): RuntimeCapabilityTruth {
  const webGpuActive = capabilities.activationState === 'webgpu_active';
  const engineSummary = `Engine active: ${capabilities.activeRenderer.toUpperCase()} / ${capabilities.activeDecode}`;
  const integrationNote =
    webGpuActive
      ? 'MasterSelects-style WebGPU deck playback is active.'
      : capabilities.engineLoadError ??
        capabilities.fallbackReason ??
        'Current live deck path remains on the HTMLVideo/WebGL2 transition path.';

  return {
    engineSummary,
    integrationNote,
    tone: webGpuActive ? 'ok' : 'error',
    rendererBadge: `${capabilities.activeRenderer.toUpperCase()} / ${capabilities.activeDecode}`,
    goalBadge:
      capabilities.activationState === 'engine_error'
        ? 'WebGPU engine error'
        : webGpuActive
          ? 'MasterSelects WebGPU live'
          : 'MasterSelects WebGPU required',
    probeBadge: webGpuActive ? 'WGPU live' : `WGPU ${capabilities.webgpu ? 'probe' : 'no'}`
  };
}
