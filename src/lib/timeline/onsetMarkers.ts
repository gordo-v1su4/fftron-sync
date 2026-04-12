import type { AudioOnsetEvent } from "$lib/stores/runtime";

export interface TimelineOnsetMarker {
  id: string;
  position: number;
  label: string;
  timeSeconds: number;
  source: AudioOnsetEvent["source"];
}

export interface BuildTimelineOnsetLanesInput {
  authoritative: AudioOnsetEvent[];
  liveFallback: AudioOnsetEvent[];
  countedDebug: AudioOnsetEvent[];
  durationSeconds: number;
  viewportStart: number;
  viewportWindow: number;
}

export interface TimelineOnsetLanes {
  authoritative: TimelineOnsetMarker[];
  liveFallback: TimelineOnsetMarker[];
  countedDebug: TimelineOnsetMarker[];
}

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
    }))
    .filter((marker) => marker.position >= 0 && marker.position <= 100);

export const buildTimelineOnsetLanes = ({
  authoritative,
  liveFallback,
  countedDebug,
  durationSeconds,
  viewportStart,
  viewportWindow,
}: BuildTimelineOnsetLanesInput): TimelineOnsetLanes => ({
  authoritative: buildMarkers(
    authoritative.filter((event) => event.source === "essentia"),
    durationSeconds,
    viewportStart,
    viewportWindow,
    "Analyzed",
  ),
  liveFallback: [],
  countedDebug: [],
});
