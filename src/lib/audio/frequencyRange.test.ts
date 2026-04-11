import { describe, expect, it } from 'vitest';
import {
  clampFrequencyRange,
  derivePresetTarget,
  findPresetById,
  formatFrequency,
  frequencyToPercent,
  percentToFrequency
} from './frequencyRange';

describe('frequencyRange helpers', () => {
  it('clamps ranges and keeps handle order stable', () => {
    expect(clampFrequencyRange(18_000, 120)).toEqual({
      startHz: 120,
      endHz: 14_000
    });
  });

  it('maps frequency selections onto preset labels truthfully', () => {
    expect(derivePresetTarget({ startHz: 25, endHz: 160 })).toBe('low');
    expect(derivePresetTarget({ startHz: 220, endHz: 1_400 })).toBe('mid');
    expect(derivePresetTarget({ startHz: 2_400, endHz: 9_800 })).toBe('high');
    expect(derivePresetTarget({ startHz: 120, endHz: 6_200 })).toBe('full');
  });

  it('round-trips percent/frequency conversion within analyzer tolerance', () => {
    const hz = 860;
    const roundTrip = percentToFrequency(frequencyToPercent(hz));

    expect(roundTrip).toBeGreaterThan(820);
    expect(roundTrip).toBeLessThan(900);
  });

  it('formats preset labels and readouts for the UI', () => {
    expect(findPresetById('mid').label).toBe('Mid');
    expect(formatFrequency(120)).toBe('120 Hz');
    expect(formatFrequency(2_400)).toBe('2.4 kHz');
  });
});
