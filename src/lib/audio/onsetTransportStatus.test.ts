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

  it("surfaces missing analyzed onsets as an error-state wait condition", () => {
    expect(
      describeOnsetTransportState({
        progressCount: 0,
        target: 4,
        armed: false,
        blockedReason: null,
        progressMode: "detected-fallback",
        lastTransportSlot: null,
      }),
    ).toEqual({
      headline: "Waiting for count",
      detail: "Awaiting analyzed onsets · 0/4",
      tone: "error",
    });
  });
});
