import { describe, expect, it } from 'vitest';
import {
  clampFrequencyRange,
  derivePresetTarget,
  findPresetById,
  formatFrequency,
  frequencyToPercent,
  moveEffectRangeHandle,
  normalizeEffectRangePercents,
  nudgeEffectRangeHandle,
  percentFromPointer,
  percentToFrequency,
  resolveNearestEffectRangeHandle
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

  it('normalizes dual-handle percentages without letting the handles invert', () => {
    expect(normalizeEffectRangePercents(88, 12)).toEqual({
      startPercent: 10,
      endPercent: 12
    });
  });

  it('moves and nudges handles while preserving the minimum gap', () => {
    expect(
      moveEffectRangeHandle(
        { startPercent: 24, endPercent: 60 },
        'start',
        59.5
      )
    ).toEqual({
      startPercent: 58,
      endPercent: 60
    });

    expect(
      nudgeEffectRangeHandle(
        { startPercent: 24, endPercent: 60 },
        'end',
        -40
      )
    ).toEqual({
      startPercent: 24,
      endPercent: 26
    });
  });

  it('maps pointer positions and chooses the nearest drag handle deterministically', () => {
    expect(percentFromPointer(150, 100, 200)).toBeCloseTo(25);
    expect(
      resolveNearestEffectRangeHandle(
        { startPercent: 20, endPercent: 72 },
        28
      )
    ).toBe('start');
    expect(
      resolveNearestEffectRangeHandle(
        { startPercent: 20, endPercent: 72 },
        66
      )
    ).toBe('end');
  });
});
