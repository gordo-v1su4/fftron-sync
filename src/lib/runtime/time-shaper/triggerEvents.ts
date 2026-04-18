import { pruneMidiEventsByDensity } from '$lib/midi/densityPruning';
import type { MidiTriggerStream, TimeShaperTriggerEvent } from '$lib/midi/types';

const DEFAULT_TRIGGER_COLOR = '#f59e0b';
const streamEventCache = new WeakMap<
  MidiTriggerStream,
  { signature: string; events: ReturnType<typeof pruneMidiEventsByDensity> }
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
    streamEventCache.set(stream, { signature, events: filtered });
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

  streamEventCache.set(stream, { signature, events: scoped });
  return scoped;
};

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

    for (const event of getFilteredStreamEvents(stream)) {
      const adjustedStartSeconds =
        event.startSeconds + stream.offsetMs / 1000 + triggerShiftMs / 1000;
      const durationSeconds = Math.max(fallbackDurationSeconds, event.durationSeconds);
      if (transportTimeSeconds < adjustedStartSeconds || transportTimeSeconds > adjustedStartSeconds + durationSeconds) {
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
    }
  }

  return winner;
};
