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
import type { EssentiaFullResponse } from '$lib/services/essentia';
import { mapRangeToNormalized } from '$lib/runtime/automationBounds';
import type {
  MidiTriggerStream,
  TimeShaperTriggerEvent,
  TimeShaperTriggerSource
} from '$lib/midi/types';
import type { TimeShaperEnvelopePresetId } from '$lib/runtime/time-shaper/envelopePresets';

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
  full: EssentiaFullResponse | null;
  updatedAtMs: number | null;
}

export interface AutomationRuntimeState {
  speed: number;
  stutter: number;
}

export interface AutomationBoundsState {
  speedMin: number;
  speedMax: number;
  stutterMin: number;
  stutterMax: number;
}

export interface AudioOnsetEvent {
  id: string;
  timestampMs: number;
  timeSeconds: number;
  band: import('$lib/types/engine').ReactiveBandTarget;
  value: number;
  threshold: number;
  counted: boolean;
  source: 'essentia' | 'detected' | 'counted';
}

export interface TransportAlignmentState {
  firstBeatSeconds: number;
  source: 'default' | 'essentia';
}

export interface OnsetTransportState {
  progressCount: number;
  target: number;
  armed: boolean;
  blockedReason: string | null;
  progressMode: 'analyzed' | 'detected-fallback' | 'quantized';
  lastTransportSlot: number | null;
}

export const runtimeCapabilities = writable<RuntimeCapabilities>({
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
  }
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
export const activeSection = writable<string>('');

export const audioRuntime = writable<AudioRuntimeState>({
  source: 'none',
  trackName: 'No track loaded',
  isPlaying: false,
  currentTime: 0,
  duration: 0
});

export const reactiveEnvelope = writable<ReactiveEnvelopeState>({
  target: 'full',
  rangeStartHz: 20,
  rangeEndHz: 14000,
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

export const audioOnsets = writable<AudioOnsetEvent[]>([]);
export const liveDetectedOnsets = writable<AudioOnsetEvent[]>([]);
export const switchProgressEvents = writable<AudioOnsetEvent[]>([]);
export const transportAlignment = writable<TransportAlignmentState>({
  firstBeatSeconds: 0,
  source: 'default'
});
export const onsetTransportState = writable<OnsetTransportState>({
  progressCount: 0,
  target: 4,
  armed: false,
  blockedReason: null,
  progressMode: 'analyzed',
  lastTransportSlot: null
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
  full: null,
  updatedAtMs: null
});
export const automationRuntime = writable<AutomationRuntimeState>({
  speed: mapRangeToNormalized(1, 0.5, 3),
  stutter: 0
});

export const automationBounds = writable<AutomationBoundsState>({
  speedMin: 0.5,
  speedMax: 3,
  stutterMin: 0,
  stutterMax: 0
});

export type TimelineMarkerMode = 'onsets' | 'midi' | 'both';

export const midiTriggerStreams = writable<MidiTriggerStream[]>([]);
export const timeShaperTriggerSource = writable<TimeShaperTriggerSource>('audio');
export const timeShaperEnvelopePresetId = writable<TimeShaperEnvelopePresetId>('easy_ease');
export const timeShaperTriggerShiftMs = writable<number>(0);
export const timeShaperRecentEvents = writable<TimeShaperTriggerEvent[]>([]);

export const timelineMarkerMode = writable<TimelineMarkerMode>('both');
export const onsetMarkerDensity = writable<number>(0.45);
export const timelineShowSpeedLane = writable<boolean>(true);
