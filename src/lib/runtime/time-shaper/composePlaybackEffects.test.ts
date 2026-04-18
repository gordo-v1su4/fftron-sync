import { describe, expect, it } from 'vitest';
import { composePlaybackEffects } from './composePlaybackEffects';

describe('composePlaybackEffects', () => {
  it('returns the automation baseline when TimeShaper mix is inactive', () => {
    expect(
      composePlaybackEffects({
        automationPlaybackRate: 1.4,
        timeShaperPlaybackRate: 0.5,
        mixAmount: 0,
        maxPlaybackRate: 3
      })
    ).toEqual({ playbackRate: 1.4, precedence: 'automation_only' });
  });

  it('applies TimeShaper on top of the automation baseline instead of replacing it', () => {
    const result = composePlaybackEffects({
      automationPlaybackRate: 1.5,
      timeShaperPlaybackRate: 0.5,
      mixAmount: 0.5,
      maxPlaybackRate: 3
    });

    expect(result.precedence).toBe('automation_plus_timeshaper');
    expect(result.playbackRate).toBeCloseTo(1.125, 5);
  });

  it('uses the playback-rate magnitude for reverse gestures and clamps the final rate', () => {
    const result = composePlaybackEffects({
      automationPlaybackRate: 2.4,
      timeShaperPlaybackRate: -2,
      mixAmount: 1,
      maxPlaybackRate: 3
    });

    expect(result).toEqual({ playbackRate: 3, precedence: 'automation_plus_timeshaper' });
  });
});
