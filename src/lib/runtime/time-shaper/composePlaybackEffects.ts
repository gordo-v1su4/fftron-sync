export interface ComposePlaybackEffectsInput {
  automationPlaybackRate: number;
  timeShaperPlaybackRate: number;
  mixAmount: number;
  maxPlaybackRate: number;
}

export interface ComposePlaybackEffectsResult {
  playbackRate: number;
  precedence: 'automation_only' | 'automation_plus_timeshaper';
}

const clamp = (value: number, min: number, max: number): number => Math.max(min, Math.min(max, value));

export const composePlaybackEffects = ({
  automationPlaybackRate,
  timeShaperPlaybackRate,
  mixAmount,
  maxPlaybackRate
}: ComposePlaybackEffectsInput): ComposePlaybackEffectsResult => {
  const baselineRate = clamp(automationPlaybackRate, 0.25, maxPlaybackRate);
  const clampedMix = clamp(mixAmount, 0, 1);

  if (clampedMix <= 0) {
    return {
      playbackRate: baselineRate,
      precedence: 'automation_only'
    };
  }

  const shapedRate = clamp(Math.abs(timeShaperPlaybackRate), 0.5, maxPlaybackRate);
  const targetRate = clamp(baselineRate * shapedRate, 0.25, maxPlaybackRate);

  return {
    playbackRate: baselineRate + (targetRate - baselineRate) * clampedMix,
    precedence: 'automation_plus_timeshaper'
  };
};
