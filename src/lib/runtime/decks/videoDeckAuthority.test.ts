import { describe, expect, it } from 'vitest';
import type { AudioOnsetEvent } from '$lib/stores/runtime';
import {
  advanceVideoDeckAuthority,
  type VideoDeckAuthorityInput,
  type VideoDeckAuthorityMeta,
} from './videoDeckAuthority';
import type { VideoDeckAuthorityState } from '$lib/stores/videoDeck';

const clipA = {
  id: 'clip-a',
  name: 'Clip A',
  url: 'clip-a.mp4',
  sizeMb: '10.0',
  lane: 0,
  slot: 0,
};

const clipB = {
  id: 'clip-b',
  name: 'Clip B',
  url: 'clip-b.mp4',
  sizeMb: '10.0',
  lane: 0,
  slot: 1,
};

const baseState = (): VideoDeckAuthorityState => ({
  clips: [clipA, clipB],
  laneMuted: [false, false, false],
  soloLane: null,
  selectedClipId: clipA.id,
  prewarmClipId: clipB.id,
  prewarmReady: true,
  autoSwitchEnabled: true,
  quantizeMode: 'beat',
  envelopeGateEnabled: true,
  onsetSwitchTarget: 2,
  switchSkipChancePercent: 0,
  onsetCountForClip: 0,
  status: '',
});

const baseMeta = (): VideoDeckAuthorityMeta => ({
  countedOnsetIds: [],
  lastSlotIndex: 0,
  previousAudioTime: 0.2,
  previousSelectedClipId: clipA.id,
});

const onset = (
  id: string,
  timeSeconds: number,
  source: AudioOnsetEvent['source'],
): AudioOnsetEvent => ({
  id,
  timestampMs: 0,
  timeSeconds,
  band: 'full',
  value: 1,
  threshold: 0,
  counted: false,
  source,
});

const baseInput = (onsets: AudioOnsetEvent[]): VideoDeckAuthorityInput => ({
  audioCurrentTime: 0.62,
  audioIsPlaying: true,
  audioSource: 'file',
  bpm: 120,
  onsets,
});

describe('advanceVideoDeckAuthority', () => {
  it('switches clips on the next transport slot once the onset target is met', () => {
    const result = advanceVideoDeckAuthority(
      baseState(),
      baseMeta(),
      baseInput([
        onset('ess-1', 0.1, 'essentia'),
        onset('ess-2', 0.3, 'essentia'),
      ]),
    );

    expect(result.state.selectedClipId).toBe(clipB.id);
    expect(result.state.onsetCountForClip).toBe(0);
    expect(result.state.status).toContain('Quantized beat switch');
  });

  it('holds the current clip when the next clip is still prewarming', () => {
    const result = advanceVideoDeckAuthority(
      {
        ...baseState(),
        prewarmReady: false,
      },
      baseMeta(),
      baseInput([
        onset('ess-1', 0.1, 'essentia'),
        onset('ess-2', 0.3, 'essentia'),
      ]),
    );

    expect(result.state.selectedClipId).toBe(clipA.id);
    expect(result.state.status).toContain('holding');
  });

  it('falls back to detected onsets when authoritative essentia onsets are unavailable', () => {
    const result = advanceVideoDeckAuthority(
      baseState(),
      baseMeta(),
      baseInput([
        onset('det-1', 0.1, 'detected'),
        onset('det-2', 0.3, 'detected'),
      ]),
    );

    expect(result.state.selectedClipId).toBe(clipB.id);
    expect(result.meta.countedOnsetIds).toEqual([]);
  });

  it('counts transport slots instead of onsets when gating is disabled', () => {
    const result = advanceVideoDeckAuthority(
      {
        ...baseState(),
        envelopeGateEnabled: false,
        onsetSwitchTarget: 1,
      },
      baseMeta(),
      baseInput([]),
    );

    expect(result.state.selectedClipId).toBe(clipB.id);
    expect(result.state.status).toContain('Quantized beat switch');
  });
});
