import { describe, expect, it } from 'vitest';
import type { AudioBandState } from '$lib/types/engine';
import {
  applyVideoTimeShape,
  evaluateAudioTrigger,
  type VideoTimeShapeCurve
} from './videoTimeShaper';

const bands: AudioBandState = {
  low: 0.8,
  mid: 0.3,
  high: 0.1,
  full: 0.6,
  envelopeA: 0.5,
  envelopeB: 0.2,
  peak: true
};

const curve: VideoTimeShapeCurve = {
  points: [
    { x: 0, y: 0 },
    { x: 0.5, y: -1 },
    { x: 1, y: 1 }
  ],
  cycleBeats: 4,
  yRangeBeats: 2,
  mix: 1,
  depth: 1,
  mode: 'smoothStep',
  bypass: false
};

describe('video TimeShaper model', () => {
  it('maps beat-cycle X and Y values to source-time offsets', () => {
    const result = applyVideoTimeShape({
      normalSourceTimeSeconds: 10,
      beatPosition: 2,
      secondsPerBeat: 0.5,
      curve
    });

    expect(result.phase).toBe(0.5);
    expect(result.offsetBeats).toBe(-2);
    expect(result.sourceTimeSeconds).toBe(9);
  });

  it('returns normal playback for bypass or zero mix/depth', () => {
    const bypass = applyVideoTimeShape({
      normalSourceTimeSeconds: 10,
      beatPosition: 2,
      secondsPerBeat: 0.5,
      curve: { ...curve, bypass: true }
    });
    const dry = applyVideoTimeShape({
      normalSourceTimeSeconds: 10,
      beatPosition: 2,
      secondsPerBeat: 0.5,
      curve: { ...curve, mix: 0 }
    });
    const noDepth = applyVideoTimeShape({
      normalSourceTimeSeconds: 10,
      beatPosition: 2,
      secondsPerBeat: 0.5,
      curve: { ...curve, depth: 0 }
    });

    expect(bypass.sourceTimeSeconds).toBe(10);
    expect(dry.sourceTimeSeconds).toBe(10);
    expect(noDepth.sourceTimeSeconds).toBe(10);
  });

  it('distinguishes smooth step frame-hold metadata from instant hard jumps', () => {
    const smooth = applyVideoTimeShape({
      normalSourceTimeSeconds: 10,
      beatPosition: 1,
      secondsPerBeat: 0.5,
      curve: { ...curve, mode: 'smoothStep' }
    });
    const instant = applyVideoTimeShape({
      normalSourceTimeSeconds: 10,
      beatPosition: 1,
      secondsPerBeat: 0.5,
      curve: { ...curve, mode: 'instantStep' }
    });

    expect(smooth.metadata).toMatchObject({ holdFrame: true, crossfadeSafe: true, hardJump: false });
    expect(instant.metadata).toMatchObject({ holdFrame: false, crossfadeSafe: false, hardJump: true });
  });

  it('loops source time inside repeat windows for stutter/repeat patterns', () => {
    const result = applyVideoTimeShape({
      normalSourceTimeSeconds: 10,
      beatPosition: 2.75,
      secondsPerBeat: 0.5,
      curve: {
        ...curve,
        points: [{ x: 0, y: 0 }],
        playbackMode: 'stutterRepeat',
        repeatWindowBeats: 0.5
      }
    });

    expect(result.metadata.playbackMode).toBe('stutterRepeat');
    expect(result.metadata.repeatWindowBeats).toBe(0.5);
    expect(result.playbackRate).toBe(1);
    expect(result.sourceTimeSeconds).toBe(8.75);
  });

  it('mirrors source time through the cycle for reverse playback', () => {
    const result = applyVideoTimeShape({
      normalSourceTimeSeconds: 10,
      beatPosition: 1,
      secondsPerBeat: 0.5,
      curve: { ...curve, points: [{ x: 0, y: 0 }], playbackMode: 'reverse' }
    });

    expect(result.metadata.playbackMode).toBe('reverse');
    expect(result.playbackRate).toBe(-1);
    expect(result.sourceTimeSeconds).toBe(11);
  });

  it('decelerates source time for tape-stop patterns', () => {
    const result = applyVideoTimeShape({
      normalSourceTimeSeconds: 10,
      beatPosition: 2,
      secondsPerBeat: 0.5,
      curve: {
        ...curve,
        points: [{ x: 0, y: 0 }],
        playbackMode: 'tapeStop',
        tapeStopFloor: 0.2
      }
    });

    expect(result.metadata.playbackMode).toBe('tapeStop');
    expect(result.playbackRate).toBeCloseTo(0.6);
    expect(result.sourceTimeSeconds).toBeCloseTo(9.8);
  });

  it('uses audio band threshold, sensitivity, detail, and trigger shift deterministically', () => {
    const triggered = evaluateAudioTrigger(
      {
        enabled: true,
        band: 'low',
        threshold: 0.7,
        sensitivity: 1,
        detail: 1,
        triggerShiftMs: -40,
        lastTriggeredAtMs: null
      },
      bands,
      1_000
    );
    const subThreshold = evaluateAudioTrigger(
      {
        enabled: true,
        band: 'high',
        threshold: 0.7,
        sensitivity: 1,
        detail: 1,
        triggerShiftMs: 0,
        lastTriggeredAtMs: null
      },
      bands,
      1_000
    );
    const densityBlocked = evaluateAudioTrigger(
      {
        enabled: true,
        band: 'low',
        threshold: 0.7,
        sensitivity: 1,
        detail: 0,
        triggerShiftMs: 0,
        lastTriggeredAtMs: 900
      },
      bands,
      1_000
    );

    expect(triggered.status).toBe('triggered');
    expect(triggered.triggerAtMs).toBe(960);
    expect(triggered.minGapMs).toBe(60);
    expect(subThreshold.status).toBe('blockedByThreshold');
    expect(densityBlocked.status).toBe('blockedByDensity');
    expect(densityBlocked.minGapMs).toBe(320);
  });
});
