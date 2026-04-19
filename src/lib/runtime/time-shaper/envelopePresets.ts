export type TimeShaperEnvelopeInterpolation = 'linear' | 'smoothstep' | 'ease_in' | 'ease_out' | 'step';
export type TimeShaperEnvelopePresetId = string;

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

const preset = (
  id: TimeShaperEnvelopePresetId,
  label: string,
  description: string,
  points: readonly TimeShaperEnvelopePoint[],
  defaultDurationBeats = 1,
  mode: TimeShaperEnvelopeInterpolation = 'linear',
): TimeShaperEnvelopePreset => ({
  id,
  label,
  description,
  mode,
  defaultDurationBeats,
  points,
});

export const TIME_SHAPER_ENVELOPE_PRESETS: readonly TimeShaperEnvelopePreset[] = [
  preset('linear_attack', 'Linear Attack', 'Straight rise from silence to full level.', [
    { x: 0, y: 0 },
    { x: 1, y: 1 },
  ]),
  preset('linear_release', 'Linear Release', 'Straight fall from full level back to silence.', [
    { x: 0, y: 1 },
    { x: 1, y: 0 },
  ]),
  preset('linear_attack_release', 'Linear Attack Release', 'Sharp triangle with equal rise and fall.', [
    { x: 0, y: 0 },
    { x: 0.5, y: 1 },
    { x: 1, y: 0 },
  ]),
  preset('linear_release_attack', 'Linear Release Attack', 'Dip then recover with a linear V shape.', [
    { x: 0, y: 1 },
    { x: 0.5, y: 0 },
    { x: 1, y: 1 },
  ]),
  preset('linear_release_attack_release', 'Linear Release Attack Release', 'M-shaped linear envelope for quick recoveries.', [
    { x: 0, y: 1 },
    { x: 0.25, y: 0 },
    { x: 0.55, y: 1 },
    { x: 1, y: 0 },
  ]),
  preset('sloped_attack_fast', 'Sloped Attack Fast', 'Fast convex rise that reaches full level early.', [
    { x: 0, y: 0 },
    { x: 0.15, y: 0.55 },
    { x: 0.35, y: 0.9 },
    { x: 1, y: 1 },
  ], 1, 'ease_out'),
  preset('sloped_release_fast', 'Sloped Release Fast', 'Fast initial drop that relaxes into silence.', [
    { x: 0, y: 1 },
    { x: 0.2, y: 0.45 },
    { x: 0.45, y: 0.15 },
    { x: 1, y: 0 },
  ], 1, 'ease_out'),
  preset('sloped_attack_slow', 'Sloped Attack Slow', 'Slow build with more emphasis near the end.', [
    { x: 0, y: 0 },
    { x: 0.55, y: 0.15 },
    { x: 0.82, y: 0.7 },
    { x: 1, y: 1 },
  ], 1, 'ease_in'),
  preset('sloped_release_slow', 'Sloped Release Slow', 'Slow fade that hangs high before dropping late.', [
    { x: 0, y: 1 },
    { x: 0.18, y: 0.92 },
    { x: 0.6, y: 0.55 },
    { x: 1, y: 0 },
  ], 1, 'ease_in'),
  preset('sloped_release_attack_release', 'Sloped Release Attack Release', 'Curved valley that rebounds then fades.', [
    { x: 0, y: 1 },
    { x: 0.2, y: 0.2 },
    { x: 0.5, y: 0.82 },
    { x: 1, y: 0 },
  ], 1, 'smoothstep'),
  preset('sloped_release_attack', 'Sloped Release Attack', 'Rounded U-shape with a soft recovery.', [
    { x: 0, y: 1 },
    { x: 0.5, y: 0.18 },
    { x: 1, y: 1 },
  ], 1, 'smoothstep'),
  preset('sloped_attack_release', 'Sloped Attack Release', 'Rounded hill with gentle shoulders.', [
    { x: 0, y: 0 },
    { x: 0.5, y: 1 },
    { x: 1, y: 0 },
  ], 1, 'smoothstep'),
  preset('sloped_attack_release_slow', 'Sloped Attack Release Slow', 'Asymmetric peak with a longer curved tail.', [
    { x: 0, y: 0 },
    { x: 0.38, y: 1 },
    { x: 0.76, y: 0.72 },
    { x: 1, y: 0 },
  ], 1, 'smoothstep'),
  preset('sloped_release_attack_slow', 'Sloped Release Attack Slow', 'Inverse asymmetric dip with a slower return.', [
    { x: 0, y: 1 },
    { x: 0.3, y: 0.08 },
    { x: 0.62, y: 0.42 },
    { x: 1, y: 1 },
  ], 1, 'smoothstep'),
  preset('sloped_wobble', 'Sloped Wobble', 'Curved wobble for rhythmic motion rather than a single hit.', [
    { x: 0, y: 0.2 },
    { x: 0.18, y: 1 },
    { x: 0.38, y: 0.28 },
    { x: 0.58, y: 0.92 },
    { x: 0.78, y: 0.18 },
    { x: 1, y: 0.8 },
  ], 1, 'smoothstep'),
  preset('silence', 'Silence', 'Flat line at zero.', [
    { x: 0, y: 0 },
    { x: 1, y: 0 },
  ]),
  preset('hard_on_off', 'Hard On Off', 'Instant hard gate on, then hard off.', [
    { x: 0, y: 1 },
    { x: 0.55, y: 1 },
    { x: 0.56, y: 0 },
    { x: 1, y: 0 },
  ], 0.75, 'step'),
  preset('hard_off_on', 'Hard Off On', 'Instant hard gate off, then on.', [
    { x: 0, y: 0 },
    { x: 0.45, y: 0 },
    { x: 0.46, y: 1 },
    { x: 1, y: 1 },
  ], 0.75, 'step'),
  preset('hard_on_off_on', 'Hard On Off On', 'Stepped gate that pulses twice.', [
    { x: 0, y: 1 },
    { x: 0.28, y: 1 },
    { x: 0.29, y: 0 },
    { x: 0.55, y: 0 },
    { x: 0.56, y: 1 },
    { x: 1, y: 1 },
  ], 0.75, 'step'),

  // Keep the original useful FFTRON presets for compatibility and selection continuity.
  preset('hold_step', 'Hold / Stepped', 'Hard gate that jumps up quickly and holds before release.', [
    { x: 0, y: 0 },
    { x: 0.06, y: 1 },
    { x: 0.88, y: 1 },
    { x: 1, y: 0 },
  ], 0.5, 'step'),
  preset('linear', 'Linear', 'Straight ramp up then down.', [
    { x: 0, y: 0 },
    { x: 0.5, y: 1 },
    { x: 1, y: 0 },
  ]),
  preset('easy_ease', 'Easy Ease', 'Rounded attack and release.', [
    { x: 0, y: 0 },
    { x: 0.5, y: 1 },
    { x: 1, y: 0 },
  ], 1, 'smoothstep'),
  preset('easy_ease_in', 'Easy Ease In', 'Delayed rise with a gentler attack.', [
    { x: 0, y: 0 },
    { x: 0.56, y: 1 },
    { x: 1, y: 0 },
  ], 1, 'ease_in'),
  preset('easy_ease_out', 'Easy Ease Out', 'Fast onset followed by a smoother release.', [
    { x: 0, y: 0 },
    { x: 0.42, y: 1 },
    { x: 1, y: 0 },
  ], 1, 'ease_out'),
  preset('stutter_jump', 'Stutter Jump', 'Fast repeated jump for choppy rhythmic hits.', [
    { x: 0, y: 0 },
    { x: 0.08, y: 1 },
    { x: 0.34, y: 0.1 },
    { x: 0.38, y: 1 },
    { x: 0.62, y: 0.08 },
    { x: 0.66, y: 1 },
    { x: 1, y: 0 },
  ], 0.25, 'step'),
];

export const findTimeShaperEnvelopePreset = (
  id: string | null | undefined
): TimeShaperEnvelopePreset =>
  TIME_SHAPER_ENVELOPE_PRESETS.find((preset) => preset.id === id) ?? TIME_SHAPER_ENVELOPE_PRESETS[0];

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
