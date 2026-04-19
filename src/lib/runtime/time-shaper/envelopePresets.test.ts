import { describe, expect, it } from 'vitest';
import {
  findTimeShaperEnvelopePreset,
  sampleEnvelopePreset,
  TIME_SHAPER_ENVELOPE_PRESETS
} from './envelopePresets';

describe('time shaper envelope presets', () => {
  it('samples the stepped hold preset at full strength across the hold region', () => {
    const preset = findTimeShaperEnvelopePreset('hold_step');
    expect(sampleEnvelopePreset(preset, 0.5)).toBeCloseTo(1, 2);
    expect(sampleEnvelopePreset(preset, 1)).toBeCloseTo(0, 2);
  });

  it('makes ease-out rise faster than ease-in at early progress', () => {
    const easeIn = findTimeShaperEnvelopePreset('easy_ease_in');
    const easeOut = findTimeShaperEnvelopePreset('easy_ease_out');

    expect(sampleEnvelopePreset(easeOut, 0.2)).toBeGreaterThan(sampleEnvelopePreset(easeIn, 0.2));
  });

  it('includes the expanded reference-style preset families', () => {
    const ids = TIME_SHAPER_ENVELOPE_PRESETS.map((preset) => preset.id);
    expect(ids).toEqual(expect.arrayContaining([
      'linear_attack',
      'linear_release',
      'linear_attack_release',
      'sloped_attack_fast',
      'sloped_wobble',
      'silence',
      'hard_on_off',
      'hard_off_on',
      'hard_on_off_on',
      'easy_ease',
      'stutter_jump',
    ]));
  });
});
