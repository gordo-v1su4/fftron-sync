import { describe, expect, it } from 'vitest';
import type { AudioOnsetEvent } from '$lib/stores/runtime';
import { buildTimelineOnsetLanes } from './onsetMarkers';

const event = (overrides: Partial<AudioOnsetEvent>): AudioOnsetEvent => ({
  id: 'event',
  timestampMs: 1000,
  timeSeconds: 1,
  band: 'full',
  value: 1,
  threshold: 0,
  counted: false,
  source: 'essentia',
  ...overrides
});

describe('buildTimelineOnsetLanes', () => {
  it('keeps analyzed onsets authoritative even after they are counted for transport progress', () => {
    const lanes = buildTimelineOnsetLanes(
      [
        event({ source: 'essentia', counted: true, timeSeconds: 2 }),
        event({ id: 'detected', source: 'detected', timeSeconds: 2.5 }),
        event({ id: 'counted', source: 'counted', counted: true, timeSeconds: 3 })
      ],
      10,
      0,
      1
    );

    expect(lanes.authoritative).toHaveLength(1);
    expect(lanes.authoritative[0].source).toBe('essentia');
    expect(lanes.authoritative[0].label).toContain('counted for transport progress');
    expect(lanes.liveFallback).toHaveLength(1);
    expect(lanes.liveFallback[0].label).toContain('Live fallback');
    expect(lanes.countedDebug).toHaveLength(1);
    expect(lanes.countedDebug[0].source).toBe('counted');
  });

  it('clips markers to the current viewport', () => {
    const lanes = buildTimelineOnsetLanes(
      [
        event({ id: 'before', timeSeconds: 1 }),
        event({ id: 'inside', timeSeconds: 6 }),
        event({ id: 'after', source: 'counted', counted: true, timeSeconds: 12 })
      ],
      12,
      0.25,
      0.5
    );

    expect(lanes.authoritative).toHaveLength(1);
    expect(lanes.authoritative[0].position).toBeCloseTo(50);
    expect(lanes.liveFallback).toHaveLength(0);
    expect(lanes.countedDebug).toHaveLength(0);
  });

  it('returns no markers when duration or viewport is invalid', () => {
    const lanes = buildTimelineOnsetLanes([event({})], 0, 0, 1);

    expect(lanes).toEqual({
      authoritative: [],
      liveFallback: [],
      countedDebug: []
    });
  });
});
