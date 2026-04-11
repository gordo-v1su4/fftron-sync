import { describe, expect, it } from "vitest";

import { describeOnsetTransportState } from "./onsetTransportStatus";

describe("describeOnsetTransportState", () => {
  it("marks armed switches explicitly", () => {
    expect(
      describeOnsetTransportState({
        progressCount: 4,
        target: 4,
        armed: true,
        blockedReason: null,
        progressMode: "analyzed",
        lastTransportSlot: 8,
      }),
    ).toEqual({
      headline: "Switch armed",
      detail: "Analyzed onsets · 4/4 · awaiting next transport boundary",
      tone: "armed",
    });
  });

  it("surfaces fallback blocked reasons without pretending analyzed authority", () => {
    expect(
      describeOnsetTransportState({
        progressCount: 4,
        target: 4,
        armed: true,
        blockedReason: "next clip deck-b is not ready",
        progressMode: "detected-fallback",
        lastTransportSlot: 8,
      }),
    ).toEqual({
      headline: "Holding switch",
      detail: "Detected fallback · 4/4 · next clip deck-b is not ready",
      tone: "warning",
    });
  });
});
