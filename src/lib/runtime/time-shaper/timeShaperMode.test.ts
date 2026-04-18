import { describe, expect, it } from 'vitest';
import { shouldUseContinuousTimeShaperFallback } from './timeShaperMode';

describe('shouldUseContinuousTimeShaperFallback', () => {
  it('preserves legacy audio-reactive fallback while envelope energy stays above threshold', () => {
    expect(shouldUseContinuousTimeShaperFallback('audio', 'blockedByThreshold', 0.4, 0.3, 'stutter-1-8')).toBe(true);
  });

  it('preserves the legacy always-on half-time exception', () => {
    expect(shouldUseContinuousTimeShaperFallback('audio', 'blockedByThreshold', 0, 0.3, 'half-time')).toBe(true);
  });

  it('disables continuous fallback in midi-only mode', () => {
    expect(shouldUseContinuousTimeShaperFallback('midi', 'triggered', 1, 0.2, 'half-time')).toBe(false);
  });
});
