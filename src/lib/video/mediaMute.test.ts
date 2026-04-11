import { describe, expect, it } from "vitest";

import { enforceSilentVideoElement } from "./mediaMute";

describe("enforceSilentVideoElement", () => {
  it("hardens clip media to stay silent", () => {
    const element = {
      muted: false,
      defaultMuted: false,
      volume: 0.8,
    } as HTMLVideoElement;

    enforceSilentVideoElement(element);

    expect(element.muted).toBe(true);
    expect(element.defaultMuted).toBe(true);
    expect(element.volume).toBe(0);
  });

  it("accepts nullish elements without throwing", () => {
    expect(() => enforceSilentVideoElement(null)).not.toThrow();
    expect(() => enforceSilentVideoElement(undefined)).not.toThrow();
  });
});
