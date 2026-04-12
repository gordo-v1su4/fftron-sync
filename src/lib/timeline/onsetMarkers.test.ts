import { describe, expect, it } from "vitest";

import type { AudioOnsetEvent } from "$lib/stores/runtime";
import { buildTimelineOnsetLanes } from "./onsetMarkers";

const makeEvent = (
  id: string,
  source: AudioOnsetEvent["source"],
  timeSeconds: number,
): AudioOnsetEvent => ({
  id,
  timestampMs: 0,
  timeSeconds,
  band: "full",
  value: 1,
  threshold: 0,
  counted: source === "counted",
  source,
});

describe("buildTimelineOnsetLanes", () => {
  it("keeps only analyzed markers on the waveform lane", () => {
    const lanes = buildTimelineOnsetLanes({
      authoritative: [makeEvent("ess-1", "essentia", 1)],
      liveFallback: [makeEvent("det-1", "detected", 2)],
      countedDebug: [makeEvent("count-1", "counted", 3)],
      durationSeconds: 4,
      viewportStart: 0,
      viewportWindow: 1,
    });

    expect(lanes.authoritative.map((marker) => marker.id)).toEqual(["ess-1"]);
    expect(lanes.liveFallback).toEqual([]);
    expect(lanes.countedDebug).toEqual([]);
    expect(lanes.authoritative[0]?.position).toBe(25);
  });

  it("filters markers outside the visible viewport", () => {
    const lanes = buildTimelineOnsetLanes({
      authoritative: [
        makeEvent("before", "essentia", 0.5),
        makeEvent("visible", "essentia", 2.5),
        makeEvent("after", "essentia", 3.75),
      ],
      liveFallback: [],
      countedDebug: [],
      durationSeconds: 4,
      viewportStart: 0.5,
      viewportWindow: 0.25,
    });

    expect(lanes.authoritative.map((marker) => marker.id)).toEqual(["visible"]);
  });
});
