import { describe, expect, it } from 'vitest';
import type { AudioBandState } from '$lib/types/engine';
import {
  applyVideoTimeShape,
  evaluateAudioTrigger,
  selectBandValue,
  type AudioTriggerConfig,
  type TimeShapeConfig,
  type VideoTimeShapeCurve
} from './timeShaper';

const curve: VideoTimeShapeCurve = {
  cycleBeats: 4,
  yRangeBeats: 2,
  points: [
    { x: 0, y: 0 },
    { x: 0.5, y: -1 },
    { x: 1, y: 1 }
  ]
};

const config: TimeShapeConfig = {
  enabled: true,
  bypass: false,
  mix: 1,
  depth: 1,
  beatDurationSeconds: 0.5,
  sourceDurationSeconds: 16,
  mode: 'smooth'
};

const bands: AudioBandState = {
  low: 0.1,
  mid: 0.4,
  high: 0.7,
  full: 0.9,
  envelopeA: 0.35,
  envelopeB: 0.65,
  peak: true
};

const triggerConfig: AudioTriggerConfig = {
  enabled: true,
  band: 'high',
  threshold: 0.6,
  sensitivity: 1,
  detail: 0.5,
  triggerShiftMs: -12
};

describe('Video TimeShaper curve math', () => {
  it('maps X-axis beat position to source-time offset', () => {
    const result = applyVideoTimeShape(8, 2, curve, config);

    expect(result.applied).toBe(true);
    expect(result.offsetSeconds).toBe(-1);
    expect(result.sourceTimeSeconds).toBe(7);
  });

  it('clamps Y-axis offset to configured beat range', () => {
    const extremeCurve: VideoTimeShapeCurve = {
      ...curve,
      points: [
        { x: 0, y: 3 },
        { x: 1, y: 3 }
      ]
    };

    const result = applyVideoTimeShape(8, 0, extremeCurve, config);

    expect(result.offsetSeconds).toBe(1);
    expect(result.sourceTimeSeconds).toBe(9);
  });

  it('uses frame-hold/crossfade-safe metadata for smooth steps', () => {
    expect(applyVideoTimeShape(8, 2, curve, { ...config, mode: 'smooth' }).transition).toBe(
      'hold-crossfade-safe'
    );
  });

  it('uses hard source-time jump metadata for instant steps', () => {
    expect(applyVideoTimeShape(8, 2, curve, { ...config, mode: 'instant' }).transition).toBe(
      'hard-jump'
    );
  });

  it('returns normal playback time while bypassed', () => {
    expect(applyVideoTimeShape(8, 2, curve, { ...config, bypass: true })).toEqual({
      sourceTimeSeconds: 8,
      offsetSeconds: 0,
      applied: false,
      transition: 'bypass'
    });
  });

  it('returns normal playback time at mix/depth 0 and full shaped time at mix/depth 1', () => {
    const dry = applyVideoTimeShape(8, 2, curve, { ...config, mix: 0 });
    const wet = applyVideoTimeShape(8, 2, curve, { ...config, mix: 1, depth: 1 });

    expect(dry.sourceTimeSeconds).toBe(8);
    expect(dry.applied).toBe(false);
    expect(wet.sourceTimeSeconds).toBe(7);
    expect(wet.applied).toBe(true);
  });
});

describe('audio trigger configuration', () => {
  it('blocks sub-threshold transients', () => {
    const result = evaluateAudioTrigger(bands, { ...triggerConfig, threshold: 0.8 }, 1000);

    expect(result.triggered).toBe(false);
    expect(result.scheduledAtMs).toBeNull();
  });

  it('selects low/mid/high/full frequency band sources', () => {
    expect(selectBandValue(bands, 'low')).toBe(0.1);
    expect(selectBandValue(bands, 'mid')).toBe(0.4);
    expect(selectBandValue(bands, 'high')).toBe(0.7);
    expect(selectBandValue(bands, 'full')).toBe(0.9);
  });

  it('uses sensitivity and detail to change trigger eligibility and density predictably', () => {
    const quiet = evaluateAudioTrigger(bands, { ...triggerConfig, sensitivity: 0.5, detail: 0 }, 1000);
    const dense = evaluateAudioTrigger(bands, { ...triggerConfig, sensitivity: 2, detail: 1 }, 1000);

    expect(quiet.triggered).toBe(false);
    expect(quiet.triggerDensity).toBe(1);
    expect(dense.triggered).toBe(true);
    expect(dense.triggerDensity).toBe(8);
  });

  it('applies trigger shift to scheduled trigger time', () => {
    const result = evaluateAudioTrigger(bands, triggerConfig, 1000);

    expect(result.triggered).toBe(true);
    expect(result.scheduledAtMs).toBe(988);
  });
});
