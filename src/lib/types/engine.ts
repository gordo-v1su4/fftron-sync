import type { QuantizeGrid } from '$lib/types/timeline';

export type RendererBackend = 'webgl2' | 'webgpu';
export type DecodeBackend = 'htmlvideo' | 'webcodecs' | 'native_ffmpeg';
export type TempoSource = 'manual' | 'tap' | 'link' | 'midi_clock' | 'auto';
export type AudioInputSource = 'none' | 'file' | 'mic';
export type ReactiveBandTarget = 'low' | 'mid' | 'high' | 'full';

export interface RuntimeCapabilities {
  webgl2: boolean;
  webgpu: boolean;
  webcodecs: boolean;
  nativeFfmpeg: boolean;
  rustFfmpegFeature: boolean;
  selectedRenderer: RendererBackend;
  selectedDecode: DecodeBackend;
}

export interface TempoState {
  bpm: number;
  confidence: number;
  downbeatEpochMs: number;
  source: TempoSource;
  tapCount: number;
}

export interface DetectedTempoState {
  bpm: number | null;
  confidence: number | null;
  source: 'essentia' | null;
  updatedAtMs: number | null;
}

export interface ScheduledAction {
  id: number;
  action: string;
  section: string | null;
  quantize: QuantizeGrid;
  executeAtMs: number;
}

export interface AudioBandState {
  low: number;
  mid: number;
  high: number;
  full: number;
  envelopeA: number;
  envelopeB: number;
  peak: boolean;
}

export interface ReactiveEnvelopeState {
  target: ReactiveBandTarget;
  attackMs: number;
  releaseMs: number;
  threshold: number;
  sensitivity: number;
}

export interface AudioRuntimeState {
  source: AudioInputSource;
  trackName: string;
  isPlaying: boolean;
  currentTime: number;
  duration: number;
}
