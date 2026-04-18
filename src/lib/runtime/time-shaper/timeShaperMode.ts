import type { AudioTriggerStatus } from './videoTimeShaper';
import type { TimeShaperTriggerSource } from '$lib/midi/types';

export const shouldUseContinuousTimeShaperFallback = (
  triggerSource: TimeShaperTriggerSource,
  audioTriggerStatus: AudioTriggerStatus,
  envelopeA: number,
  threshold: number,
  presetId: string
): boolean =>
  triggerSource !== 'midi' &&
  (audioTriggerStatus === 'triggered' || envelopeA > threshold || presetId === 'half-time');
