import type { DeckGpuCapabilityInput, DeckGpuCapabilityState } from './types';

export function resolveDeckGpuCapability(input: DeckGpuCapabilityInput): DeckGpuCapabilityState {
  if (!input.flags.useWebGpuHotDecks) {
    return fallback('useWebGpuHotDecks feature flag is disabled');
  }

  if (input.deviceLost) {
    return fallback('WebGPU device is lost or recovering');
  }

  if (!input.navigatorGpuAvailable) {
    return fallback('navigator.gpu is unavailable in the Tauri WebView');
  }

  if (!input.capabilities.webgpu) {
    return fallback('runtime capability store reports webgpu unavailable');
  }

  if (input.capabilities.selectedRenderer !== 'webgpu') {
    return fallback(`selected renderer is ${input.capabilities.selectedRenderer}`);
  }

  return {
    enabled: true,
    backend: 'webgpu',
    fallbackReason: null
  };
}

function fallback(fallbackReason: string): DeckGpuCapabilityState {
  return {
    enabled: false,
    backend: 'fallback',
    fallbackReason
  };
}
