import { derived, writable } from 'svelte/store';
import type {
  AudioBandState,
  AudioRuntimeState,
  ReactiveEnvelopeState,
  RuntimeCapabilities,
  ScheduledAction,
  TempoState
} from '$lib/types/engine';
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

export const audioRuntime = writable<AudioRuntimeState>({
  source: 'none',
  trackName: 'No track loaded',
  isPlaying: false,
  currentTime: 0,
  duration: 0
});

export const reactiveEnvelope = writable<ReactiveEnvelopeState>({
  target: 'full',
  attackMs: 27,
  releaseMs: 190,
  threshold: 0.12,
  sensitivity: 1
});

export const audioBands = writable<AudioBandState>({
  low: 0,
  mid: 0,
  high: 0,
  full: 0,
  envelopeA: 0,
  envelopeB: 0,
  peak: false
});

export const canUseWebGpu = derived(runtimeCapabilities, ($caps) => $caps.webgpu && $caps.selectedRenderer === 'webgpu');
