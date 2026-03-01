import { writable } from 'svelte/store';
import type {
  AudioBandState,
  AudioRuntimeState,
  DetectedTempoState,
  ReactiveEnvelopeState,
  RuntimeCapabilities,
  ScheduledAction,
  TempoState
} from '$lib/types/engine';
import type { EngineCueMarker } from '$lib/types/timeline';
import type { WaveformOverview } from '$lib/audio/wav';

export interface TimelineSeekRequest {
  time: number;
  requestId: number;
}

export interface EssentiaDetectedSection {
  id: string;
  label: string;
  section: string;
  start: number;
  end: number;
  duration: number;
  energy: number;
}

export interface EssentiaAnalysisState {
  bpm: number | null;
  confidence: number | null;
  duration: number | null;
  boundaries: number[];
  sections: EssentiaDetectedSection[];
  energyCurve: number[];
  updatedAtMs: number | null;
}

export interface AutomationRuntimeState {
  speed: number;
  stutter: number;
}

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

export const detectedTempo = writable<DetectedTempoState>({
  bpm: null,
  confidence: null,
  source: null,
  updatedAtMs: null
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

export const waveformOverview = writable<WaveformOverview | null>(null);
export const timelineSeekRequest = writable<TimelineSeekRequest | null>(null);
export const essentiaAnalysis = writable<EssentiaAnalysisState>({
  bpm: null,
  confidence: null,
  duration: null,
  boundaries: [],
  sections: [],
  energyCurve: [],
  updatedAtMs: null
});
export const automationRuntime = writable<AutomationRuntimeState>({
  speed: 0.5,
  stutter: 0
});
