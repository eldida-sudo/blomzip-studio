import { describe, expect, it } from "vitest";
import { FixtureVisionProvider, NotConfiguredVisionProvider, VISION_ANALYSIS_VERSION } from "./visionProvider";

describe("NotConfiguredVisionProvider", () => {
  it("never fabricates visual understanding and fails clearly", async () => {
    const provider = new NotConfiguredVisionProvider();

    await expect(provider.analyzeImage({ imageRecordId: "image-1", filename: "courtyard-01.jpg" })).rejects.toThrow(
      /no genuine image-analysis provider is configured/i
    );
  });
});

describe("FixtureVisionProvider", () => {
  it("returns deterministic, provider-labeled signals for use in tests only", async () => {
    const provider = new FixtureVisionProvider();

    const first = await provider.analyzeImage({ imageRecordId: "image-1", filename: "courtyard-01.jpg" });
    const second = await provider.analyzeImage({ imageRecordId: "image-1", filename: "courtyard-01.jpg" });

    expect(first.signals).toEqual(second.signals);
    expect(first.provider).toBe("fixture-vision-provider-dev");
    expect(first.analysisVersion).toBe(VISION_ANALYSIS_VERSION);
    expect(first.signals.every((signal) => signal.provider === "fixture-vision-provider-dev")).toBe(true);
    expect(first.signals).toEqual(expect.arrayContaining([
      expect.objectContaining({ signal: "human-activity", confidence: 0.92 }),
      expect.objectContaining({ signal: "spatial-overview" }),
    ]));
  });

  it("supports per-filename fixtures so tests can exercise different signal combinations", async () => {
    const provider = new FixtureVisionProvider({
      "change-01.jpg": [
        { signal: "visible-change-cue", confidence: 0.8, detail: "A section of the wall shows fresh paint.", provider: "", analysisVersion: VISION_ANALYSIS_VERSION },
      ],
    });

    const result = await provider.analyzeImage({ imageRecordId: "image-2", filename: "change-01.jpg" });

    expect(result.signals).toEqual([
      expect.objectContaining({ signal: "visible-change-cue", provider: "fixture-vision-provider-dev" }),
    ]);
  });
});
