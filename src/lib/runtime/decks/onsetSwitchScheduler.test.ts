import { describe, expect, it } from 'vitest';

import {
  advanceOnsetSwitchScheduler,
  carryOnsetSwitchSchedulerState,
  computeTransportSlotIndex,
  createOnsetSwitchSchedulerState,
} from './onsetSwitchScheduler';

describe('computeTransportSlotIndex', () => {
  it('aligns beat slots against the detected first beat offset', () => {
    expect(computeTransportSlotIndex(0.2, 120, 0.5, 'beat')).toBe(-1);
    expect(computeTransportSlotIndex(0.51, 120, 0.5, 'beat')).toBe(0);
    expect(computeTransportSlotIndex(1.04, 120, 0.5, 'beat')).toBe(1);
  });
});

describe('advanceOnsetSwitchScheduler', () => {
  it('counts analyzed onsets without needing detected fallback data', () => {
    const initial = createOnsetSwitchSchedulerState(2);
    const result = advanceOnsetSwitchScheduler(initial, {
      transportTimeSeconds: 1.05,
      bpm: 120,
      firstBeatSeconds: 0,
      quantizeMode: 'beat',
      target: 2,
      envelopeGateEnabled: true,
      autoSwitchEnabled: true,
      playableClipCount: 2,
      nextClipReady: true,
      analyzedOnsets: [
        { id: 'a-1', timeSeconds: 0.25, band: 'full', value: 1, threshold: 0 },
        { id: 'a-2', timeSeconds: 1.0, band: 'full', value: 1, threshold: 0 },
      ],
      detectedOnsets: [],
    });

    expect(result.state.progressCount).toBe(2);
    expect(result.state.progressMode).toBe('analyzed');
    expect(result.countedEvents.map((event) => event.id)).toEqual([
      'count-analyzed-a-1',
      'count-analyzed-a-2',
    ]);
    expect(result.state.armedAtSlotIndex).toBe(2);
  });

  it('waits for analyzed onsets instead of counting detected fallback events', () => {
    const result = advanceOnsetSwitchScheduler(createOnsetSwitchSchedulerState(1), {
      transportTimeSeconds: 0.55,
      bpm: 120,
      firstBeatSeconds: 0,
      quantizeMode: 'beat',
      target: 1,
      envelopeGateEnabled: true,
      autoSwitchEnabled: true,
      playableClipCount: 2,
      nextClipReady: true,
      analyzedOnsets: [],
      detectedOnsets: [
        { id: 'd-1', timeSeconds: 0.5, band: 'mid', value: 0.8, threshold: 0.2 },
      ],
    });

    expect(result.state.progressMode).toBe('analyzed');
    expect(result.countedEvents).toHaveLength(0);
    expect(result.state.progressCount).toBe(0);
  });


  it('does not backfill every past analyzed onset when analysis finishes mid-playback', () => {
    const waiting = advanceOnsetSwitchScheduler(createOnsetSwitchSchedulerState(4), {
      transportTimeSeconds: 12.4,
      bpm: 120,
      firstBeatSeconds: 0,
      quantizeMode: 'beat',
      target: 4,
      envelopeGateEnabled: true,
      autoSwitchEnabled: true,
      playableClipCount: 2,
      nextClipReady: true,
      analyzedOnsets: [],
      detectedOnsets: [],
    });

    const analyzedArrived = advanceOnsetSwitchScheduler(waiting.state, {
      transportTimeSeconds: 12.45,
      bpm: 120,
      firstBeatSeconds: 0,
      quantizeMode: 'beat',
      target: 4,
      envelopeGateEnabled: true,
      autoSwitchEnabled: true,
      playableClipCount: 2,
      nextClipReady: true,
      analyzedOnsets: [
        { id: 'a-1', timeSeconds: 0.25, band: 'full', value: 1, threshold: 0 },
        { id: 'a-2', timeSeconds: 1.0, band: 'full', value: 1, threshold: 0 },
        { id: 'a-3', timeSeconds: 4.0, band: 'full', value: 1, threshold: 0 },
        { id: 'a-4', timeSeconds: 8.0, band: 'full', value: 1, threshold: 0 },
        { id: 'a-5', timeSeconds: 12.3, band: 'full', value: 1, threshold: 0 },
        { id: 'a-6', timeSeconds: 12.62, band: 'full', value: 1, threshold: 0 },
      ],
      detectedOnsets: [],
    });

    expect(analyzedArrived.state.progressCount).toBe(0);
    expect(analyzedArrived.countedEvents).toHaveLength(0);
    expect(analyzedArrived.state.lastCountedAnalyzedIndex).toBe(5);

    const nextBeat = advanceOnsetSwitchScheduler(analyzedArrived.state, {
      transportTimeSeconds: 12.7,
      bpm: 120,
      firstBeatSeconds: 0,
      quantizeMode: 'beat',
      target: 4,
      envelopeGateEnabled: true,
      autoSwitchEnabled: true,
      playableClipCount: 2,
      nextClipReady: true,
      analyzedOnsets: [
        { id: 'a-1', timeSeconds: 0.25, band: 'full', value: 1, threshold: 0 },
        { id: 'a-2', timeSeconds: 1.0, band: 'full', value: 1, threshold: 0 },
        { id: 'a-3', timeSeconds: 4.0, band: 'full', value: 1, threshold: 0 },
        { id: 'a-4', timeSeconds: 8.0, band: 'full', value: 1, threshold: 0 },
        { id: 'a-5', timeSeconds: 12.3, band: 'full', value: 1, threshold: 0 },
        { id: 'a-6', timeSeconds: 12.62, band: 'full', value: 1, threshold: 0 },
      ],
      detectedOnsets: [],
    });

    expect(nextBeat.state.progressCount).toBe(1);
    expect(nextBeat.countedEvents.map((event) => event.id)).toEqual(['count-analyzed-a-6']);
  });

  it('arms at the target slot and switches only on the following transport boundary', () => {
    const armed = advanceOnsetSwitchScheduler(createOnsetSwitchSchedulerState(2), {
      transportTimeSeconds: 1.01,
      bpm: 120,
      firstBeatSeconds: 0,
      quantizeMode: 'beat',
      target: 2,
      envelopeGateEnabled: true,
      autoSwitchEnabled: true,
      playableClipCount: 2,
      nextClipReady: true,
      analyzedOnsets: [
        { id: 'a-1', timeSeconds: 0.25, band: 'full', value: 1, threshold: 0 },
        { id: 'a-2', timeSeconds: 1.0, band: 'full', value: 1, threshold: 0 },
      ],
      detectedOnsets: [],
    });

    expect(armed.shouldSwitch).toBe(false);
    expect(armed.state.armedAtSlotIndex).toBe(2);

    const switched = advanceOnsetSwitchScheduler(armed.state, {
      transportTimeSeconds: 1.55,
      bpm: 120,
      firstBeatSeconds: 0,
      quantizeMode: 'beat',
      target: 2,
      envelopeGateEnabled: true,
      autoSwitchEnabled: true,
      playableClipCount: 2,
      nextClipReady: true,
      analyzedOnsets: [
        { id: 'a-1', timeSeconds: 0.25, band: 'full', value: 1, threshold: 0 },
        { id: 'a-2', timeSeconds: 1.0, band: 'full', value: 1, threshold: 0 },
      ],
      detectedOnsets: [],
    });

    expect(switched.currentSlotIndex).toBe(3);
    expect(switched.shouldSwitch).toBe(true);
  });

  it('keeps the switch armed and exposes a blocked reason when the next clip is not ready', () => {
    const armed = {
      ...createOnsetSwitchSchedulerState(1),
      progressCount: 1,
      armedAtSlotIndex: 0,
      lastTransportSlot: 0,
    };

    const blocked = advanceOnsetSwitchScheduler(armed, {
      transportTimeSeconds: 0.55,
      bpm: 120,
      firstBeatSeconds: 0,
      quantizeMode: 'beat',
      target: 1,
      envelopeGateEnabled: true,
      autoSwitchEnabled: true,
      playableClipCount: 2,
      nextClipReady: false,
      nextClipLabel: 'clip-b',
      analyzedOnsets: [],
      detectedOnsets: [],
    });

    expect(blocked.shouldSwitch).toBe(false);
    expect(blocked.state.blockedReason).toBe('next clip clip-b is not ready');
    expect(blocked.state.armedAtSlotIndex).toBe(0);
  });

  it('preserves counted onset indexes when carrying state after a successful switch', () => {
    const carried = carryOnsetSwitchSchedulerState(
      {
        ...createOnsetSwitchSchedulerState(4),
        progressCount: 4,
        armedAtSlotIndex: 7,
        lastTransportSlot: 8,
        lastCountedAnalyzedIndex: 5,
      },
      4,
      8,
    );

    expect(carried.progressCount).toBe(0);
    expect(carried.lastTransportSlot).toBe(8);
    expect(carried.lastCountedAnalyzedIndex).toBe(5);
    expect(carried.armedAtSlotIndex).toBeNull();
  });
});
