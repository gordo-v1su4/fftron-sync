export interface MidiNoteEvent {
  id: string;
  note: number;
  velocity: number;
  startTicks: number;
  durationTicks: number;
  startSeconds: number;
  durationSeconds: number;
  endSeconds: number;
  channel: number;
  trackIndex: number;
  trackName: string;
}

export interface MidiTrackSummary {
  key: string;
  name: string;
  channel: number | null;
  noteCount: number;
}

export interface ParsedMidiFile {
  name: string;
  format: number;
  ticksPerQuarterNote: number;
  durationSeconds: number;
  events: MidiNoteEvent[];
  tracks: MidiTrackSummary[];
}

export interface MidiTriggerStream {
  id: string;
  name: string;
  color: string;
  visible: boolean;
  enabled: boolean;
  density: number;
  offsetMs: number;
  sectionTag: string;
  activeOnlyInSection: boolean;
  targetPresetId: string;
  trackFilter: string;
  durationSeconds: number;
  tracks: MidiTrackSummary[];
  events: MidiNoteEvent[];
  parseError: string | null;
}

export type TimeShaperTriggerSource = 'audio' | 'midi' | 'hybrid';

export interface TimeShaperTriggerEvent {
  id: string;
  source: 'audio' | 'midi';
  label: string;
  startSeconds: number;
  durationSeconds: number;
  velocity: number;
  color: string;
  note?: number;
  streamId?: string;
  targetPresetId?: string;
}
