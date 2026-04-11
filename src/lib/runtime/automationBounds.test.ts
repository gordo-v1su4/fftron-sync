import { describe, expect, it } from 'vitest';

import {
  SPEED_AUTOMATION_DOMAIN,
  STUTTER_AUTOMATION_DOMAIN,
  mapNormalizedToRange,
  mapRangeToNormalized,
  normalizeAutomationBounds,
} from './automationBounds';

describe('automation bounds helpers', () => {
  it('keeps valid bounds unchanged', () => {
    expect(
      normalizeAutomationBounds({
        speedMin: 0.5,
        speedMax: 2.1,
        stutterMin: 0,
        stutterMax: 1,
      }),
    ).toEqual({
      speedMin: 0.5,
      speedMax: 2.1,
      stutterMin: 0,
      stutterMax: 1,
    });
  });

  it('normalizes inverted and out-of-range bounds into the supported domains', () => {
    expect(
      normalizeAutomationBounds({
        speedMin: 5,
        speedMax: 0.1,
        stutterMin: 2,
        stutterMax: -1,
      }),
    ).toEqual({
      speedMin: 0.25,
      speedMax: 0.26,
      stutterMin: 0,
      stutterMax: 0.001,
    });
  });

  it('round-trips normalized values through the speed range helpers', () => {
    const speed = mapNormalizedToRange(0.37, 0.5, 2.1);
    expect(mapRangeToNormalized(speed, 0.5, 2.1)).toBeCloseTo(0.37, 6);
  });

  it('clamps out-of-range normalized values before mapping', () => {
    expect(
      mapNormalizedToRange(-1, SPEED_AUTOMATION_DOMAIN.min, SPEED_AUTOMATION_DOMAIN.max),
    ).toBe(SPEED_AUTOMATION_DOMAIN.min);
    expect(
      mapNormalizedToRange(2, STUTTER_AUTOMATION_DOMAIN.min, STUTTER_AUTOMATION_DOMAIN.max),
    ).toBe(STUTTER_AUTOMATION_DOMAIN.max);
  });
});
