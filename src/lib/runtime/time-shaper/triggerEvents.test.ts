import { describe, expect, it } from 'vitest';
import type { MidiTriggerStream } from '$lib/midi/types';
import { findActiveMidiTriggerEvent, getFilteredStreamEvents } from './triggerEvents';

const stream = (overrides: Partial<MidiTriggerStream> = {}): MidiTriggerStream => ({
  id: 'stream-1',
  name: 'Kick Stem',
  color: '#38bdf8',
  visible: true,
  enabled: true,
  density: 1,
  offsetMs: 0,
  sectionTag: 'all',
  activeOnlyInSection: false,
  targetPresetId: 'stutter-1-8',
  trackFilter: 'all',
  durationSeconds: 2,
  tracks: [],
  parseError: null,
  events: [
    {
      id: 'evt-1',
      note: 60,
      velocity: 0.9,
      startTicks: 0,
      durationTicks: 96,
      startSeconds: 0.5,
      durationSeconds: 0.25,
      endSeconds: 0.75,
      channel: 0,
      trackIndex: 0,
      trackName: 'Kick'
    },
    {
      id: 'evt-2',
      note: 62,
      velocity: 0.4,
      startTicks: 96,
      durationTicks: 96,
      startSeconds: 1,
      durationSeconds: 0.25,
      endSeconds: 1.25,
      channel: 0,
      trackIndex: 0,
      trackName: 'Kick'
    }
  ],
  ...overrides
});

describe('trigger event helpers', () => {
  it('filters and keeps events when stream density is full', () => {
    expect(getFilteredStreamEvents(stream()).map((event) => event.id)).toEqual(['evt-1', 'evt-2']);
  });

  it('returns the latest active MIDI event within the fallback window', () => {
    const result = findActiveMidiTriggerEvent([stream()], 1.05, 0.3, 'verse');
    expect(result).toMatchObject({ id: 'stream-1:evt-2', source: 'midi', note: 62 });
  });

  it('applies the global trigger shift to midi events', () => {
    const earlyResult = findActiveMidiTriggerEvent([stream()], 0.52, 0.3, 'verse', -180);
    expect(earlyResult).toMatchObject({ id: 'stream-1:evt-1', source: 'midi', note: 60 });

    const lateResult = findActiveMidiTriggerEvent([stream()], 1.05, 0.3, 'verse', 180);
    expect(lateResult).toBeNull();
  });

  it('suppresses section-locked streams outside their tagged section', () => {
    const result = findActiveMidiTriggerEvent(
      [stream({ sectionTag: 'chorus', activeOnlyInSection: true })],
      0.55,
      0.4,
      'verse'
    );
    expect(result).toBeNull();
  });

  it('respects channel-qualified track filters', () => {
    const result = findActiveMidiTriggerEvent(
      [
        stream({
          trackFilter: 'track:0:ch:1',
          events: [
            {
              id: 'evt-ch0',
              note: 60,
              velocity: 0.9,
              startTicks: 0,
              durationTicks: 96,
              startSeconds: 0.5,
              durationSeconds: 0.25,
              endSeconds: 0.75,
              channel: 0,
              trackIndex: 0,
              trackName: 'Kick'
            },
            {
              id: 'evt-ch1',
              note: 64,
              velocity: 0.9,
              startTicks: 0,
              durationTicks: 96,
              startSeconds: 0.5,
              durationSeconds: 0.25,
              endSeconds: 0.75,
              channel: 1,
              trackIndex: 0,
              trackName: 'Kick'
            }
          ]
        })
      ],
      0.55,
      0.4,
      'verse'
    );

    expect(result?.id).toBe('stream-1:evt-ch1');
  });
});
