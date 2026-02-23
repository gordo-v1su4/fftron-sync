import type { QuantizeGrid } from '$lib/types/timeline';

export type RendererBackend = 'webgl2' | 'webgpu';
export type DecodeBackend = 'htmlvideo' | 'webcodecs' | 'native_ffmpeg';
export type TempoSource = 'manual' | 'tap' | 'link' | 'midi_clock' | 'auto';

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

export interface ScheduledAction {
  id: number;
  action: string;
  section: string | null;
  quantize: QuantizeGrid;
  executeAtMs: number;
}
