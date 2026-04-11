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
  previousSelectedClipId: clipA.id,
  schedulerState: {
    progressCount: 0,
    target: 2,
    armedAtSlotIndex: null,
    lastTransportSlot: 0,
    lastCountedAnalyzedIndex: 0,
    lastCountedDetectedIndex: 0,
    lastTransportTimeSeconds: 0.2,
    blockedReason: null,
    progressMode: 'analyzed',
  },
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

const baseInput = (
  analyzedOnsets: AudioOnsetEvent[],
  detectedOnsets: AudioOnsetEvent[] = [],
): VideoDeckAuthorityInput => ({
  audioCurrentTime: 0.62,
  audioIsPlaying: true,
  audioSource: 'file',
  bpm: 120,
  firstBeatSeconds: 0,
  analyzedOnsets,
  detectedOnsets,
});

const nextBoundaryInput = (
  overrides: Partial<VideoDeckAuthorityInput> = {},
): VideoDeckAuthorityInput => ({
  ...baseInput([]),
  audioCurrentTime: 1.12,
  ...overrides,
});

describe('advanceVideoDeckAuthority', () => {
  it('switches clips on the next transport slot once the onset target is met', () => {
    const armed = advanceVideoDeckAuthority(
      baseState(),
      baseMeta(),
      baseInput([
        onset('ess-1', 0.1, 'essentia'),
        onset('ess-2', 0.3, 'essentia'),
      ]),
    );

    expect(armed.state.selectedClipId).toBe(clipA.id);
    expect(armed.state.status).toContain('Armed beat switch');

    const switched = advanceVideoDeckAuthority(
      armed.state,
      armed.meta,
      nextBoundaryInput({
        analyzedOnsets: [
          onset('ess-1', 0.1, 'essentia'),
          onset('ess-2', 0.3, 'essentia'),
        ],
      }),
    );

    expect(switched.state.selectedClipId).toBe(clipB.id);
    expect(switched.state.onsetCountForClip).toBe(0);
    expect(switched.state.status).toContain('Quantized beat switch');
  });

  it('holds the current clip when the next clip is still prewarming', () => {
    const armed = advanceVideoDeckAuthority(
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

    const held = advanceVideoDeckAuthority(
      armed.state,
      armed.meta,
      nextBoundaryInput({
        analyzedOnsets: [
          onset('ess-1', 0.1, 'essentia'),
          onset('ess-2', 0.3, 'essentia'),
        ],
      }),
    );

    expect(held.state.selectedClipId).toBe(clipA.id);
    expect(held.state.status.toLowerCase()).toContain('holding');
  });

  it('falls back to detected onsets when authoritative essentia onsets are unavailable', () => {
    const armed = advanceVideoDeckAuthority(
      baseState(),
      baseMeta(),
      baseInput(
        [],
        [
        onset('det-1', 0.1, 'detected'),
        onset('det-2', 0.3, 'detected'),
        ],
      ),
    );

    expect(armed.meta.schedulerState.progressMode).toBe('detected-fallback');

    const switched = advanceVideoDeckAuthority(
      armed.state,
      armed.meta,
      nextBoundaryInput({
        detectedOnsets: [
          onset('det-1', 0.1, 'detected'),
          onset('det-2', 0.3, 'detected'),
        ],
      }),
    );

    expect(switched.state.selectedClipId).toBe(clipB.id);
  });

  it('counts transport slots instead of onsets when gating is disabled', () => {
    const armed = advanceVideoDeckAuthority(
      {
        ...baseState(),
        envelopeGateEnabled: false,
        onsetSwitchTarget: 1,
      },
      baseMeta(),
      baseInput([]),
    );

    expect(armed.state.status).toContain('Armed beat switch');

    const switched = advanceVideoDeckAuthority(
      armed.state,
      armed.meta,
      nextBoundaryInput(),
    );

    expect(switched.state.selectedClipId).toBe(clipB.id);
    expect(switched.state.status).toContain('Quantized beat switch');
  });

  it('surfaces explicit analyzed-onset fallback status before detected onsets arrive', () => {
    const result = advanceVideoDeckAuthority(
      baseState(),
      {
        ...baseMeta(),
        schedulerState: {
          ...baseMeta().schedulerState,
          lastTransportSlot: 1,
        },
      },
      {
        ...baseInput([]),
        audioCurrentTime: 0.7,
      },
    );

    expect(result.state.status).toBe('Holding switch: awaiting analyzed onsets');
  });
});
