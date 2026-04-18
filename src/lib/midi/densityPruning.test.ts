import { describe, expect, it } from 'vitest';
import { pruneMidiEventsByDensity } from './densityPruning';
import type { MidiNoteEvent } from './types';

const event = (id: string, startSeconds: number, velocity: number): MidiNoteEvent => ({
  id,
  note: 60,
  velocity,
  startTicks: Math.round(startSeconds * 100),
  durationTicks: 50,
  startSeconds,
  durationSeconds: 0.25,
  endSeconds: startSeconds + 0.25,
  channel: 0,
  trackIndex: 0,
  trackName: 'Kick'
});

describe('pruneMidiEventsByDensity', () => {
  it('keeps higher-velocity notes before weaker ones', () => {
    const result = pruneMidiEventsByDensity(
      [event('a', 0, 0.2), event('b', 0.1, 0.95), event('c', 0.2, 0.7), event('d', 0.3, 0.1)],
      0.5
    );

    expect(result.map((entry) => entry.id)).toEqual(['b', 'c']);
  });

  it('returns all events when density is full', () => {
    const events = [event('a', 0, 0.2), event('b', 0.1, 0.95)];
    expect(pruneMidiEventsByDensity(events, 1)).toEqual(events);
  });
});
