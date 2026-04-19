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

  it('exposes the expected preset catalog', () => {
    expect(TIME_SHAPER_ENVELOPE_PRESETS.map((preset) => preset.id)).toEqual([
      'hold_step',
      'linear',
      'easy_ease',
      'easy_ease_in',
      'easy_ease_out',
      'stutter_jump'
    ]);
  });
});
