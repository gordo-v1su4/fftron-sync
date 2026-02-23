import { derived, writable } from 'svelte/store';
import type { ScheduledAction, RuntimeCapabilities, TempoState } from '$lib/types/engine';
import type { EngineCueMarker } from '$lib/types/timeline';

export const runtimeCapabilities = writable<RuntimeCapabilities>({
  webgl2: true,
  webgpu: false,
  webcodecs: false,
  nativeFfmpeg: false,
  rustFfmpegFeature: false,
  selectedRenderer: 'webgl2',
  selectedDecode: 'htmlvideo'
});

export const tempoState = writable<TempoState>({
  bpm: 120,
  confidence: 1,
  downbeatEpochMs: Date.now(),
  source: 'manual',
  tapCount: 0
});

export const scheduledActions = writable<ScheduledAction[]>([]);

export const markers = writable<EngineCueMarker[]>([]);
export const activeSection = writable<string>('verse-a');

export const canUseWebGpu = derived(runtimeCapabilities, ($caps) => $caps.webgpu && $caps.selectedRenderer === 'webgpu');
