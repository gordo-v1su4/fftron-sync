import type { AudioOnsetEvent } from '$lib/stores/runtime';

export interface TimelineOnsetMarker {
  position: number;
  source: AudioOnsetEvent['source'];
  counted: boolean;
  value: number;
  label: string;
}

export interface TimelineOnsetLanes {
  authoritative: TimelineOnsetMarker[];
  liveFallback: TimelineOnsetMarker[];
  countedDebug: TimelineOnsetMarker[];
}

const toLocalPercent = (
  xNorm: number,
  viewportStartNorm: number,
  viewportWindowNorm: number
): number => ((xNorm - viewportStartNorm) / viewportWindowNorm) * 100;

const labelForEvent = (event: AudioOnsetEvent): string => {
  const prefix =
    event.source === 'essentia'
      ? 'Analyzed'
      : event.source === 'counted'
        ? 'Count debug'
        : 'Live fallback';

  return `${prefix} ${event.band.toUpperCase()} onset · ${event.timeSeconds.toFixed(2)}s${
    event.source === 'essentia' && event.counted ? ' · counted for transport progress' : ''
  }`;
};

const toTimelineMarker = (
  event: AudioOnsetEvent,
  safeDuration: number,
  viewportStart: number,
  viewportWindow: number
): TimelineOnsetMarker => ({
  position: toLocalPercent(event.timeSeconds / safeDuration, viewportStart, viewportWindow),
  counted: event.counted,
  value: event.value,
  source: event.source,
  label: labelForEvent(event)
});

export function buildTimelineOnsetLanes(
  events: readonly AudioOnsetEvent[],
  safeDuration: number,
  viewportStart: number,
  viewportWindow: number
): TimelineOnsetLanes {
  if (!Number.isFinite(safeDuration) || safeDuration <= 0 || !Number.isFinite(viewportWindow) || viewportWindow <= 0) {
    return {
      authoritative: [],
      liveFallback: [],
      countedDebug: []
    };
  }

  const visibleMarkers = events
    .map((event) => toTimelineMarker(event, safeDuration, viewportStart, viewportWindow))
    .filter((entry) => entry.position >= 0 && entry.position <= 100);

  return {
    authoritative: visibleMarkers.filter((marker) => marker.source === 'essentia'),
    liveFallback: visibleMarkers.filter((marker) => marker.source === 'detected'),
    countedDebug: visibleMarkers.filter((marker) => marker.source === 'counted')
  };
}
