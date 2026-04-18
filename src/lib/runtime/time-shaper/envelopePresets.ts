export type TimeShaperEnvelopeInterpolation = 'linear' | 'smoothstep' | 'ease_in' | 'ease_out' | 'step';
export type TimeShaperEnvelopePresetId =
  | 'hold_step'
  | 'linear'
  | 'easy_ease'
  | 'easy_ease_in'
  | 'easy_ease_out'
  | 'stutter_jump';

export interface TimeShaperEnvelopePoint {
  x: number;
  y: number;
}

export interface TimeShaperEnvelopePreset {
  id: TimeShaperEnvelopePresetId;
  label: string;
  description: string;
  mode: TimeShaperEnvelopeInterpolation;
  defaultDurationBeats: number;
  points: readonly TimeShaperEnvelopePoint[];
}

const clamp = (value: number, min: number, max: number): number => Math.max(min, Math.min(max, value));

export const TIME_SHAPER_ENVELOPE_PRESETS: readonly TimeShaperEnvelopePreset[] = [
  {
    id: 'hold_step',
    label: 'Hold / Stepped',
    description: 'Hard gate that jumps up quickly and holds before release.',
    mode: 'step',
    defaultDurationBeats: 0.5,
    points: [
      { x: 0, y: 0 },
      { x: 0.06, y: 1 },
      { x: 0.88, y: 1 },
      { x: 1, y: 0 }
    ]
  },
  {
    id: 'linear',
    label: 'Linear',
    description: 'Straight ramp up then down.',
    mode: 'linear',
    defaultDurationBeats: 1,
    points: [
      { x: 0, y: 0 },
      { x: 0.5, y: 1 },
      { x: 1, y: 0 }
    ]
  },
  {
    id: 'easy_ease',
    label: 'Easy Ease',
    description: 'Rounded attack and release.',
    mode: 'smoothstep',
    defaultDurationBeats: 1,
    points: [
      { x: 0, y: 0 },
      { x: 0.5, y: 1 },
      { x: 1, y: 0 }
    ]
  },
  {
    id: 'easy_ease_in',
    label: 'Easy Ease In',
    description: 'Delayed rise with a gentler attack.',
    mode: 'ease_in',
    defaultDurationBeats: 1,
    points: [
      { x: 0, y: 0 },
      { x: 0.56, y: 1 },
      { x: 1, y: 0 }
    ]
  },
  {
    id: 'easy_ease_out',
    label: 'Easy Ease Out',
    description: 'Fast onset followed by a smoother release.',
    mode: 'ease_out',
    defaultDurationBeats: 1,
    points: [
      { x: 0, y: 0 },
      { x: 0.42, y: 1 },
      { x: 1, y: 0 }
    ]
  },
  {
    id: 'stutter_jump',
    label: 'Stutter Jump',
    description: 'Fast repeated jump for choppy rhythmic hits.',
    mode: 'step',
    defaultDurationBeats: 0.25,
    points: [
      { x: 0, y: 0 },
      { x: 0.08, y: 1 },
      { x: 0.34, y: 0.1 },
      { x: 0.38, y: 1 },
      { x: 0.62, y: 0.08 },
      { x: 0.66, y: 1 },
      { x: 1, y: 0 }
    ]
  }
];

export const findTimeShaperEnvelopePreset = (
  id: string | null | undefined
): TimeShaperEnvelopePreset =>
  TIME_SHAPER_ENVELOPE_PRESETS.find((preset) => preset.id === id) ?? TIME_SHAPER_ENVELOPE_PRESETS[2];

const easingForMode = (mode: TimeShaperEnvelopeInterpolation, t: number): number => {
  const clamped = clamp(t, 0, 1);
  switch (mode) {
    case 'ease_in':
      return clamped * clamped;
    case 'ease_out':
      return 1 - (1 - clamped) * (1 - clamped);
    case 'smoothstep':
      return clamped * clamped * (3 - 2 * clamped);
    case 'step':
      return clamped >= 1 ? 1 : 0;
    case 'linear':
    default:
      return clamped;
  }
};

export const sampleEnvelopePreset = (
  preset: TimeShaperEnvelopePreset,
  progress: number
): number => {
  const x = clamp(progress, 0, 1);
  const points = preset.points;
  if (points.length === 0) return 0;
  if (x <= points[0].x) return points[0].y;
  if (x >= points[points.length - 1].x) return points[points.length - 1].y;

  for (let index = 0; index < points.length - 1; index += 1) {
    const from = points[index];
    const to = points[index + 1];
    if (x < from.x || x > to.x) continue;
    const span = Math.max(0.0001, to.x - from.x);
    const local = easingForMode(preset.mode, (x - from.x) / span);
    return from.y + (to.y - from.y) * local;
  }

  return points[points.length - 1].y;
};
