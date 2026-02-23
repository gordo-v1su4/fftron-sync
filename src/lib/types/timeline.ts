export type TimelineAuthority = 'rust_clock';
export type TheatreUsage = 'authoring_only';

export type QuantizeGrid = '1n' | '1/2n' | '1/4n' | '1/8n' | '1/16n';
export type CueAction = 'trigger_clip' | 'apply_accent' | 'swap_scene';

export interface EngineSequence {
  id: string;
  name: string;
  section: string;
}

export interface EngineCueMarker {
  id: string;
  section: string;
  bar: number;
  beat: number;
  quantize: QuantizeGrid;
  action: CueAction;
  payload: Record<string, unknown>;
}

export interface EngineEnvelopeTemplate {
  id: string;
  name: string;
  attackMs: number;
  decayMs: number;
  sustain: number;
  releaseMs: number;
  curveIn: 'linear' | 'sine_in' | 'sine_out' | 'exp';
  curveOut: 'linear' | 'sine_in' | 'sine_out' | 'exp';
}

export interface TheatreExportBundle {
  version: string;
  fps: number;
  sequences: EngineSequence[];
  cueMarkers: EngineCueMarker[];
  envelopeTemplates: EngineEnvelopeTemplate[];
}

export const isTheatreExportBundle = (value: unknown): value is TheatreExportBundle => {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<TheatreExportBundle>;
  return (
    typeof candidate.version === 'string' &&
    typeof candidate.fps === 'number' &&
    Array.isArray(candidate.sequences) &&
    Array.isArray(candidate.cueMarkers) &&
    Array.isArray(candidate.envelopeTemplates)
  );
};
