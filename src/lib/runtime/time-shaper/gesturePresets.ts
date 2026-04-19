import type { TimeShaperEnvelopePresetId } from './envelopePresets';
import type { VideoTimeShapeCurve, VideoTimeShapePlaybackMode, VideoTimeShapeStepMode } from './videoTimeShaper';

export interface TimeShapeGesturePreset {
  id: string;
  label: string;
  shortLabel: string;
  playbackMode: VideoTimeShapePlaybackMode;
  mode: VideoTimeShapeStepMode;
  cycleBeats: number;
  yRangeBeats: number;
  repeatWindowBeats?: number;
  tapeStopFloor?: number;
  envelopePresetId: TimeShaperEnvelopePresetId;
  points: VideoTimeShapeCurve['points'];
}

export const TIME_SHAPE_GESTURE_PRESETS: readonly TimeShapeGesturePreset[] = [
  {
    id: 'stutter-1-8',
    label: '1/8 Beat Stutter',
    shortLabel: 'STT 1/8',
    playbackMode: 'stutterRepeat',
    mode: 'instantStep',
    cycleBeats: 1,
    yRangeBeats: 0.5,
    repeatWindowBeats: 0.125,
    envelopePresetId: 'stutter_jump',
    points: [
      { x: 0, y: 0 },
      { x: 0.24, y: -0.2 },
      { x: 0.5, y: -0.65 },
      { x: 0.75, y: -0.35 },
      { x: 1, y: 0 }
    ]
  },
  {
    id: 'scratch-back',
    label: 'Backspin Scratch',
    shortLabel: 'SCRATCH',
    playbackMode: 'sourceOffset',
    mode: 'instantStep',
    cycleBeats: 2,
    yRangeBeats: 2,
    envelopePresetId: 'linear',
    points: [
      { x: 0, y: 0 },
      { x: 0.18, y: -0.85 },
      { x: 0.38, y: 0.2 },
      { x: 0.58, y: -1 },
      { x: 1, y: 0 }
    ]
  },
  {
    id: 'reverse-slice',
    label: 'Reverse Slice',
    shortLabel: 'REV',
    playbackMode: 'reverse',
    mode: 'smoothStep',
    cycleBeats: 4,
    yRangeBeats: 0.75,
    envelopePresetId: 'easy_ease',
    points: [
      { x: 0, y: 0 },
      { x: 0.5, y: -0.5 },
      { x: 1, y: 0 }
    ]
  },
  {
    id: 'tape-stop',
    label: 'Tape Stop',
    shortLabel: 'TAPE',
    playbackMode: 'tapeStop',
    mode: 'smoothStep',
    cycleBeats: 4,
    yRangeBeats: 1,
    tapeStopFloor: 0.08,
    envelopePresetId: 'easy_ease_in',
    points: [
      { x: 0, y: 0 },
      { x: 0.35, y: -0.1 },
      { x: 0.75, y: -0.75 },
      { x: 1, y: -1 }
    ]
  },
  {
    id: 'half-time',
    label: 'Half-Time Drag',
    shortLabel: 'HALF',
    playbackMode: 'sourceOffset',
    mode: 'smoothStep',
    cycleBeats: 4,
    yRangeBeats: 1,
    envelopePresetId: 'easy_ease_out',
    points: [
      { x: 0, y: 0 },
      { x: 0.5, y: -0.4 },
      { x: 1, y: -0.8 }
    ]
  },
  {
    id: 'triplet-skip-back',
    label: 'Triplet Skip-Back',
    shortLabel: 'TRIPLET',
    playbackMode: 'stutterRepeat',
    mode: 'instantStep',
    cycleBeats: 1,
    yRangeBeats: 0.45,
    repeatWindowBeats: 1 / 3,
    envelopePresetId: 'stutter_jump',
    points: [
      { x: 0, y: 0 },
      { x: 0.16, y: -0.18 },
      { x: 0.33, y: -0.62 },
      { x: 0.5, y: -0.14 },
      { x: 0.66, y: -0.58 },
      { x: 0.83, y: -0.2 },
      { x: 1, y: 0 }
    ]
  },
  {
    id: 'ease-ramp-out',
    label: 'Easy Ease Ramp-Out',
    shortLabel: 'EASE OUT',
    playbackMode: 'sourceOffset',
    mode: 'smoothStep',
    cycleBeats: 4,
    yRangeBeats: 0.85,
    envelopePresetId: 'easy_ease_out',
    points: [
      { x: 0, y: 0 },
      { x: 0.2, y: -0.08 },
      { x: 0.48, y: -0.32 },
      { x: 0.78, y: -0.72 },
      { x: 1, y: -1 }
    ]
  },
  {
    id: 'medium-ramp-up',
    label: 'Medium Ramp-Up',
    shortLabel: 'MID UP',
    playbackMode: 'sourceOffset',
    mode: 'smoothStep',
    cycleBeats: 4,
    yRangeBeats: 0.9,
    envelopePresetId: 'easy_ease',
    points: [
      { x: 0, y: 0 },
      { x: 0.22, y: 0.1 },
      { x: 0.5, y: 0.34 },
      { x: 0.78, y: 0.68 },
      { x: 1, y: 1 }
    ]
  },
  {
    id: 'fast-in-slow-out',
    label: 'Fast In Slow Out',
    shortLabel: 'FI SO',
    playbackMode: 'sourceOffset',
    mode: 'smoothStep',
    cycleBeats: 2,
    yRangeBeats: 0.75,
    envelopePresetId: 'easy_ease_out',
    points: [
      { x: 0, y: 0 },
      { x: 0.12, y: -0.58 },
      { x: 0.38, y: -0.84 },
      { x: 0.72, y: -0.95 },
      { x: 1, y: -1 }
    ]
  },
  {
    id: 'slow-in-fast-out',
    label: 'Slow In Fast Out',
    shortLabel: 'SI FO',
    playbackMode: 'sourceOffset',
    mode: 'smoothStep',
    cycleBeats: 2,
    yRangeBeats: 0.75,
    envelopePresetId: 'easy_ease_in',
    points: [
      { x: 0, y: 0 },
      { x: 0.28, y: -0.06 },
      { x: 0.62, y: -0.28 },
      { x: 0.88, y: -0.72 },
      { x: 1, y: -1 }
    ]
  }
];

export const findTimeShapeGesturePreset = (id: string | null | undefined): TimeShapeGesturePreset =>
  TIME_SHAPE_GESTURE_PRESETS.find((preset) => preset.id === id) ?? TIME_SHAPE_GESTURE_PRESETS[0];
