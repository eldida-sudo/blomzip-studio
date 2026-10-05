import { afterEach, describe, expect, it, vi } from "vitest";
import {
  applyHeroRoleGate,
  FixtureVisionProvider,
  HERO_ROLE_MIN_SCORE,
  NotConfiguredVisionProvider,
  parsePlaceMatchOutput,
  ProxyVisionProvider,
  VISION_ANALYSIS_VERSION,
} from "./visionProvider";

describe("applyHeroRoleGate", () => {
  it("forces roles below the minimum score to neither", () => {
    expect(applyHeroRoleGate(HERO_ROLE_MIN_SCORE - 0.01, "place_hero")).toBe("neither");
    expect(applyHeroRoleGate(HERO_ROLE_MIN_SCORE - 0.01, "story_hero")).toBe("neither");
    expect(applyHeroRoleGate(HERO_ROLE_MIN_SCORE - 0.01, "both")).toBe("neither");
  });

  it("preserves the proposed role at the minimum score", () => {
    expect(applyHeroRoleGate(HERO_ROLE_MIN_SCORE, "place_hero")).toBe("place_hero");
  });
});

describe("NotConfiguredVisionProvider", () => {
  it("never fabricates visual understanding and fails clearly", async () => {
    const provider = new NotConfiguredVisionProvider();

    await expect(
      provider.analyzeImage({
        imageRecordId: "image-1",
        filename: "courtyard-01.jpg",
      })
    ).rejects.toThrow(/no genuine image-analysis provider is configured/i);
  });
});

describe("FixtureVisionProvider", () => {
  it("returns deterministic, provider-labeled signals for use in tests only", async () => {
    const provider = new FixtureVisionProvider();

    const first = await provider.analyzeImage({
      imageRecordId: "image-1",
      filename: "courtyard-01.jpg",
    });
    const second = await provider.analyzeImage({
      imageRecordId: "image-1",
      filename: "courtyard-01.jpg",
    });

    expect(first.signals).toEqual(second.signals);
    expect(first.provider).toBe("fixture-vision-provider-dev");
    expect(first.analysisVersion).toBe(VISION_ANALYSIS_VERSION);
    expect(
      first.signals.every(
        (signal) => signal.provider === "fixture-vision-provider-dev"
      )
    ).toBe(true);
    expect(first.signals).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          signal: "human-activity",
          confidence: 0.92,
        }),
        expect.objectContaining({ signal: "spatial-overview" }),
      ])
    );
  });

  it("supports per-filename fixtures so tests can exercise different signal combinations", async () => {
    const provider = new FixtureVisionProvider({
      "change-01.jpg": [
        {
          signal: "visible-change-cue",
          confidence: 0.8,
          detail: "A section of the wall shows fresh paint.",
          provider: "",
          analysisVersion: VISION_ANALYSIS_VERSION,
        },
      ],
    });

    const result = await provider.analyzeImage({
      imageRecordId: "image-2",
      filename: "change-01.jpg",
    });

    expect(result.signals).toEqual([
      expect.objectContaining({
        signal: "visible-change-cue",
        provider: "fixture-vision-provider-dev",
      }),
    ]);
  });
});
describe("place match parsing", () => {
  const context = { placeId: "seating-area", imageRecordId: "image-1", provider: "blomzip-vision-proxy" };
  const output = (value: Record<string, unknown>) =>
    JSON.stringify({ classification: "SAME_PLACE", score: 0.9, reason: "Same bench and hedge.", matched_features: ["stone bench", "clipped hedge"], ...value });

  it("parses a SAME_PLACE result with at least two distinct place-defining features", () => {
    expect(parsePlaceMatchOutput(output({ reason: " Same bench and hedge. " }), context)).toEqual({
      placeId: "seating-area",
      imageRecordId: "image-1",
      classification: "SAME_PLACE",
      matchedFeatures: ["stone bench", "clipped hedge"],
      score: 0.9,
      reason: "Same bench and hedge.",
      provider: "blomzip-vision-proxy",
      analysisVersion: VISION_ANALYSIS_VERSION,
    });
  });

  it("downgrades SAME_PLACE backed by only one feature to NEARBY_CONTEXT", () => {
    const result = parsePlaceMatchOutput(output({ matched_features: ["stone bench"], score: 0.95 }), context);
    expect(result.classification).toBe("NEARBY_CONTEXT");
    expect(result.score).toBeLessThanOrEqual(0.5);
  });

  it("downgrades SAME_PLACE backed by no features (context alone) to NEARBY_CONTEXT", () => {
    expect(parsePlaceMatchOutput(output({ matched_features: [] }), context).classification).toBe("NEARBY_CONTEXT");
  });

  it("does not count duplicate or blank features twice", () => {
    const result = parsePlaceMatchOutput(output({ matched_features: ["Stone bench", " stone bench ", ""] }), context);
    expect(result.classification).toBe("NEARBY_CONTEXT");
    expect(result.matchedFeatures).toEqual(["Stone bench"]);
  });

  it("keeps NEARBY_CONTEXT and DIFFERENT_PLACE and bounds their scores", () => {
    expect(parsePlaceMatchOutput(output({ classification: "NEARBY_CONTEXT", score: 0.93, matched_features: [] }), context)).toMatchObject({
      classification: "NEARBY_CONTEXT",
      score: 0.5,
    });
    expect(parsePlaceMatchOutput(output({ classification: "DIFFERENT_PLACE", score: 0.9, matched_features: [] }), context)).toMatchObject({
      classification: "DIFFERENT_PLACE",
      score: 0.2,
    });
  });

  it("clamps scores into 0-1", () => {
    expect(parsePlaceMatchOutput(output({ score: 1.7 }), context).score).toBe(1);
    expect(parsePlaceMatchOutput(output({ score: -2 }), context).score).toBe(0);
  });

  it("rejects malformed output instead of fabricating a match", () => {
    expect(() => parsePlaceMatchOutput("not json", context)).toThrow();
    expect(() => parsePlaceMatchOutput(output({ classification: "MAYBE" }), context)).toThrow(/classification/);
    expect(() => parsePlaceMatchOutput(output({ classification: undefined }), context)).toThrow(/classification/);
    expect(() => parsePlaceMatchOutput(output({ score: "0.9" }), context)).toThrow(/score/);
    expect(() => parsePlaceMatchOutput(output({ reason: "  " }), context)).toThrow(/reason/);
    expect(() => parsePlaceMatchOutput(output({ matched_features: undefined }), context)).toThrow(/matched_features/);
    expect(() => parsePlaceMatchOutput(output({ matched_features: [1] }), context)).toThrow(/matched_features/);
  });

  it("does not let the not-configured or fixture providers match", async () => {
    const request = {
      placeId: "seating-area",
      placeName: "The Seating Area",
      imageRecordId: "image-1",
      candidateImageDataUrl: "data:image/jpeg;base64,AA==",
      anchorImageDataUrls: [],
      signature: TEST_SIGNATURE,
    };

    await expect(new NotConfiguredVisionProvider().matchPlaceCandidate(request)).rejects.toThrow();
    await expect(new FixtureVisionProvider().matchPlaceCandidate(request)).rejects.toThrow();
  });
});

const TEST_SIGNATURE = { core: ["gate post"], supporting: ["latch"], contextual: ["paving"] };

describe("ProxyVisionProvider.derivePlaceSignature", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const request = { placeName: "P", anchorImageDataUrls: ["data:image/jpeg;base64,QQ=="] };

  it("posts the anchors only and returns the signature", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ signature: TEST_SIGNATURE }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(new ProxyVisionProvider().derivePlaceSignature(request)).resolves.toEqual(TEST_SIGNATURE);

    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("/api/vision/place-signature");
    expect(Object.keys(JSON.parse(init.body as string)).sort()).toEqual(["anchorImageDataUrls", "placeName"]);
  });

  it("surfaces proxy errors and rejects malformed signatures", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ error: "bad signature" }), { status: 502 })));
    await expect(new ProxyVisionProvider().derivePlaceSignature(request)).rejects.toThrow("bad signature");

    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ signature: { core: [] } }), { status: 200 })));
    await expect(new ProxyVisionProvider().derivePlaceSignature(request)).rejects.toThrow("valid place signature");
  });
});

describe("ProxyVisionProvider.matchPlaceCandidate", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("posts the place name, anchors and candidate and parses the response", async () => {
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ outputText: JSON.stringify({ classification: "SAME_PLACE", score: 0.64, reason: "Matching gate.", matched_features: ["gate post", "latch"] }) }), { status: 200 })
    );
    vi.stubGlobal("fetch", fetchMock);

    const outcome = await new ProxyVisionProvider().matchPlaceCandidate({
      placeId: "front-gate",
      placeName: "The Front Gate",
      imageRecordId: "image-9",
      candidateImageDataUrl: "data:image/jpeg;base64,Q0FORA==",
      anchorImageDataUrls: ["data:image/jpeg;base64,QQ==", "data:image/jpeg;base64,Qg==", "data:image/jpeg;base64,Qw=="],
      signature: TEST_SIGNATURE,
    });

    expect(outcome).toMatchObject({ placeId: "front-gate", imageRecordId: "image-9", score: 0.64, classification: "SAME_PLACE", provider: "blomzip-vision-proxy" });

    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("/api/vision/match-place");
    expect(JSON.parse(init.body as string)).toMatchObject({ placeName: "The Front Gate", signature: TEST_SIGNATURE });
    expect(JSON.parse(init.body as string).anchorImageDataUrls).toHaveLength(3);
  });

  it("surfaces proxy errors", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ error: "boom" }), { status: 500 })));

    await expect(
      new ProxyVisionProvider().matchPlaceCandidate({
        placeId: "p",
        placeName: "P",
        imageRecordId: "i",
        candidateImageDataUrl: "data:image/jpeg;base64,AA==",
        anchorImageDataUrls: [],
      signature: TEST_SIGNATURE,
      })
    ).rejects.toThrow("boom");
  });
});
