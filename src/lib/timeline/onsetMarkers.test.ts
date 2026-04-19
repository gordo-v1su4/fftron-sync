import { describe, expect, it } from 'vitest';

import type { MidiTriggerStream } from '$lib/midi/types';
import type { AudioOnsetEvent } from '$lib/stores/runtime';
import { buildTimelineOnsetLanes } from './onsetMarkers';

const makeEvent = (
  id: string,
  source: AudioOnsetEvent['source'],
  timeSeconds: number,
  value = 1,
): AudioOnsetEvent => ({
  id,
  timestampMs: 0,
  timeSeconds,
  band: 'full',
  value,
  threshold: 0,
  counted: source === 'counted',
  source,
});

const midiStream = (overrides: Partial<MidiTriggerStream> = {}): MidiTriggerStream => ({
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
  durationSeconds: 4,
  tracks: [],
  parseError: null,
  events: [
    {
      id: 'evt-1',
      note: 60,
      velocity: 0.9,
      startTicks: 0,
      durationTicks: 96,
      startSeconds: 1,
      durationSeconds: 0.25,
      endSeconds: 1.25,
      channel: 0,
      trackIndex: 0,
      trackName: 'Kick',
    },
  ],
  ...overrides,
});

describe('buildTimelineOnsetLanes', () => {
  it('keeps only analyzed markers on the waveform lane', () => {
    const lanes = buildTimelineOnsetLanes({
      authoritative: [makeEvent('ess-1', 'essentia', 1)],
      liveFallback: [makeEvent('det-1', 'detected', 2)],
      countedDebug: [makeEvent('count-1', 'counted', 3)],
      durationSeconds: 4,
      viewportStart: 0,
      viewportWindow: 1,
    });

    expect(lanes.authoritative.map((marker) => marker.id)).toEqual(['ess-1']);
    expect(lanes.liveFallback).toEqual([]);
    expect(lanes.countedDebug).toEqual([]);
    expect(lanes.authoritative[0]?.position).toBe(25);
    expect(lanes.midi).toEqual([]);
  });

  it('filters markers outside the visible viewport', () => {
    const lanes = buildTimelineOnsetLanes({
      authoritative: [
        makeEvent('before', 'essentia', 0.5),
        makeEvent('visible', 'essentia', 2.5),
        makeEvent('after', 'essentia', 3.75),
      ],
      liveFallback: [],
      countedDebug: [],
      durationSeconds: 4,
      viewportStart: 0.5,
      viewportWindow: 0.25,
    });

    expect(lanes.authoritative.map((marker) => marker.id)).toEqual(['visible']);
  });

  it('culls weaker onsets first when density is reduced', () => {
    const lanes = buildTimelineOnsetLanes({
      authoritative: [
        makeEvent('quiet', 'essentia', 0.5, 0.2),
        makeEvent('loud', 'essentia', 1.5, 0.9),
        makeEvent('mid', 'essentia', 2.5, 0.6),
      ],
      liveFallback: [],
      countedDebug: [],
      markerMode: 'onsets',
      onsetDensity: 0.34,
      durationSeconds: 4,
      viewportStart: 0,
      viewportWindow: 1,
    });

    expect(lanes.authoritative.map((marker) => marker.id)).toEqual(['loud']);
  });

  it('can show midi markers without onset markers', () => {
    const lanes = buildTimelineOnsetLanes({
      authoritative: [makeEvent('ess-1', 'essentia', 1)],
      liveFallback: [],
      countedDebug: [],
      midiStreams: [midiStream()],
      activeSection: 'intro',
      markerMode: 'midi',
      durationSeconds: 4,
      viewportStart: 0,
      viewportWindow: 1,
    });

    expect(lanes.authoritative).toEqual([]);
    expect(lanes.midi).toHaveLength(1);
    expect(lanes.midi[0]).toMatchObject({ id: 'stream-1:evt-1', source: 'midi', color: '#38bdf8' });
  });
});
