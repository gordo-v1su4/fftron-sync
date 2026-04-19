import type { AudioOnsetEvent } from '$lib/stores/runtime';
import type { MidiTriggerStream } from '$lib/midi/types';
import { getFilteredStreamEvents } from '$lib/runtime/time-shaper/triggerEvents';

export interface TimelineOnsetMarker {
  id: string;
  position: number;
  label: string;
  timeSeconds: number;
  source: AudioOnsetEvent['source'] | 'midi';
  color?: string;
  intensity?: number;
}

export interface BuildTimelineOnsetLanesInput {
  authoritative: AudioOnsetEvent[];
  liveFallback: AudioOnsetEvent[];
  countedDebug: AudioOnsetEvent[];
  midiStreams?: readonly MidiTriggerStream[];
  activeSection?: string;
  markerMode?: 'onsets' | 'midi' | 'both';
  onsetDensity?: number;
  durationSeconds: number;
  viewportStart: number;
  viewportWindow: number;
}

export interface TimelineOnsetLanes {
  authoritative: TimelineOnsetMarker[];
  liveFallback: TimelineOnsetMarker[];
  countedDebug: TimelineOnsetMarker[];
  midi: TimelineOnsetMarker[];
}

const clamp = (value: number, min: number, max: number): number => Math.max(min, Math.min(max, value));

const toViewportPercent = (
  timeSeconds: number,
  durationSeconds: number,
  viewportStart: number,
  viewportWindow: number,
): number => {
  if (!Number.isFinite(durationSeconds) || durationSeconds <= 0 || viewportWindow <= 0) {
    return -1;
  }
  const absoluteProgress = timeSeconds / durationSeconds;
  return ((absoluteProgress - viewportStart) / viewportWindow) * 100;
};

const buildLabel = (event: AudioOnsetEvent, prefix: string): string =>
  `${prefix} · ${event.timeSeconds.toFixed(2)}s · ${event.band}`;

export const pruneOnsetEventsByDensity = (events: readonly AudioOnsetEvent[], density: number): AudioOnsetEvent[] => {
  if (events.length <= 1) return [...events];
  const clampedDensity = clamp(density, 0.05, 1);
  if (clampedDensity >= 0.999) return [...events];

  const keepCount = Math.max(1, Math.round(events.length * clampedDensity));
  const selectedIds = new Set(
    [...events]
      .sort((left, right) => {
        if (right.value !== left.value) return right.value - left.value;
        return left.timeSeconds - right.timeSeconds;
      })
      .slice(0, keepCount)
      .map((event) => event.id),
  );

  return events.filter((event) => selectedIds.has(event.id));
};

const buildMarkers = (
  events: AudioOnsetEvent[],
  durationSeconds: number,
  viewportStart: number,
  viewportWindow: number,
  prefix: string,
): TimelineOnsetMarker[] =>
  events
    .map((event) => ({
      id: event.id,
      position: toViewportPercent(
        event.timeSeconds,
        durationSeconds,
        viewportStart,
        viewportWindow,
      ),
      label: buildLabel(event, prefix),
      timeSeconds: event.timeSeconds,
      source: event.source,
      intensity: event.value,
    }))
    .filter((marker) => marker.position >= 0 && marker.position <= 100);

const buildMidiMarkers = (
  streams: readonly MidiTriggerStream[],
  activeSection: string,
  durationSeconds: number,
  viewportStart: number,
  viewportWindow: number,
): TimelineOnsetMarker[] =>
  streams.flatMap((stream) => {
    if (!stream.enabled || !stream.visible || stream.parseError) return [];
    if (stream.activeOnlyInSection && stream.sectionTag !== 'all' && stream.sectionTag !== activeSection) {
      return [];
    }

    return getFilteredStreamEvents(stream)
      .map((event) => {
        const timeSeconds = Math.max(0, event.startSeconds + stream.offsetMs / 1000);
        return {
          id: `${stream.id}:${event.id}`,
          position: toViewportPercent(timeSeconds, durationSeconds, viewportStart, viewportWindow),
          label: `${stream.name} · note ${event.note} · ${(event.velocity * 100).toFixed(0)}%`,
          timeSeconds,
          source: 'midi' as const,
          color: stream.color,
          intensity: event.velocity,
        };
      })
      .filter((marker) => marker.position >= 0 && marker.position <= 100);
  });

export const buildTimelineOnsetLanes = ({
  authoritative,
  liveFallback,
  countedDebug,
  midiStreams = [],
  activeSection = '',
  markerMode = 'both',
  onsetDensity = 1,
  durationSeconds,
  viewportStart,
  viewportWindow,
}: BuildTimelineOnsetLanesInput): TimelineOnsetLanes => ({
  authoritative:
    markerMode === 'midi'
      ? []
      : buildMarkers(
          pruneOnsetEventsByDensity(authoritative.filter((event) => event.source === 'essentia'), onsetDensity),
          durationSeconds,
          viewportStart,
          viewportWindow,
          'Analyzed',
        ),
  liveFallback: [],
  countedDebug: [],
  midi:
    markerMode === 'onsets'
      ? []
      : buildMidiMarkers(midiStreams, activeSection, durationSeconds, viewportStart, viewportWindow),
});
