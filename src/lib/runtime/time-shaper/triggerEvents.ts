import { pruneMidiEventsByDensity } from '$lib/midi/densityPruning';
import type { MidiTriggerStream, TimeShaperTriggerEvent } from '$lib/midi/types';

const DEFAULT_TRIGGER_COLOR = '#f59e0b';

const findLastCandidateIndex = (
  starts: readonly number[],
  target: number,
): number => {
  let low = 0;
  let high = starts.length - 1;
  let result = -1;

  while (low <= high) {
    const middle = Math.floor((low + high) / 2);
    const value = starts[middle] ?? Number.POSITIVE_INFINITY;
    if (value <= target) {
      result = middle;
      low = middle + 1;
    } else {
      high = middle - 1;
    }
  }

  return result;
};
const streamEventCache = new WeakMap<
  MidiTriggerStream,
  { signature: string; events: ReturnType<typeof pruneMidiEventsByDensity>; starts: number[] }
>();

export const getFilteredStreamEvents = (stream: MidiTriggerStream) => {
  const signature = [
    stream.trackFilter,
    stream.density.toFixed(2),
    stream.events.length,
    stream.events[0]?.id ?? 'first:none',
    stream.events[stream.events.length - 1]?.id ?? 'last:none'
  ].join('|');
  const cached = streamEventCache.get(stream);
  if (cached?.signature === signature) {
    return cached.events;
  }

  const filtered = pruneMidiEventsByDensity(stream.events, stream.density);
  if (stream.trackFilter === 'all') {
    streamEventCache.set(stream, {
      signature,
      events: filtered,
      starts: filtered.map((event) => event.startSeconds),
    });
    return filtered;
  }

  const parts = stream.trackFilter.split(':');
  const trackIndex = Number(parts[1]);
  const channelTokenIndex = parts.findIndex((part) => part === 'ch');
  const channel =
    channelTokenIndex >= 0 && channelTokenIndex + 1 < parts.length
      ? Number(parts[channelTokenIndex + 1])
      : null;

  const scoped = filtered.filter((event) => {
    if (Number.isFinite(trackIndex) && event.trackIndex !== trackIndex) return false;
    if (channel !== null && Number.isFinite(channel) && event.channel !== channel) return false;
    return true;
  });

  streamEventCache.set(stream, {
    signature,
    events: scoped,
    starts: scoped.map((event) => event.startSeconds),
  });
  return scoped;
};

const getFilteredStreamStarts = (stream: MidiTriggerStream): number[] =>
  streamEventCache.get(stream)?.starts ?? getFilteredStreamEvents(stream).map((event) => event.startSeconds);

export const findActiveMidiTriggerEvent = (
  streams: readonly MidiTriggerStream[],
  transportTimeSeconds: number,
  fallbackDurationSeconds: number,
  activeSection: string,
  triggerShiftMs = 0
): TimeShaperTriggerEvent | null => {
  let winner: TimeShaperTriggerEvent | null = null;

  for (const stream of streams) {
    if (!stream.enabled || !stream.visible) continue;
    if (stream.activeOnlyInSection && stream.sectionTag !== 'all' && stream.sectionTag !== activeSection) {
      continue;
    }

    const events = getFilteredStreamEvents(stream);
    const starts = getFilteredStreamStarts(stream);
    const startOffsetSeconds = stream.offsetMs / 1000 + triggerShiftMs / 1000;
    const latestStartIndex = findLastCandidateIndex(
      starts,
      transportTimeSeconds - startOffsetSeconds,
    );

    for (let index = latestStartIndex; index >= 0; index -= 1) {
      const event = events[index];
      if (!event) continue;

      const adjustedStartSeconds = event.startSeconds + startOffsetSeconds;
      const durationSeconds = Math.max(fallbackDurationSeconds, event.durationSeconds);
      if (transportTimeSeconds > adjustedStartSeconds + durationSeconds) {
        break;
      }
      if (transportTimeSeconds < adjustedStartSeconds) {
        continue;
      }

      const candidate: TimeShaperTriggerEvent = {
        id: `${stream.id}:${event.id}`,
        source: 'midi',
        label: `${stream.name} · ${event.note}`,
        startSeconds: adjustedStartSeconds,
        durationSeconds,
        velocity: event.velocity,
        color: stream.color || DEFAULT_TRIGGER_COLOR,
        note: event.note,
        streamId: stream.id,
        targetPresetId: stream.targetPresetId
      };

      if (!winner || candidate.startSeconds > winner.startSeconds) {
        winner = candidate;
      }
      break;
    }
  }

  return winner;
};
