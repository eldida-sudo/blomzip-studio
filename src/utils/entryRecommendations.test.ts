import { describe, expect, it } from "vitest";
import type { Entry } from "../models/blomzip";
import { getEntryEditorialRecommendations } from "./entryRecommendations";

function createEntry(analysisSuggestions: Entry["analysisSuggestions"]): Entry {
  return {
    id: "entry-1",
    imageRecordId: "image-1",
    visitId: "visit-1",
    status: "new",
    notes: "",
    tags: [],
    observations: [],
    analysisSuggestions,
    createdAt: "2026-08-14T00:00:00.000Z",
    updatedAt: "2026-08-14T00:00:00.000Z",
  };
}

describe("getEntryEditorialRecommendations", () => {
  it("returns legacy editorial category fallbacks without scores or evidence", () => {
    const recommendations = getEntryEditorialRecommendations(createEntry({
      engine: "mock-observation-engine",
      generatedAt: "2026-08-14T00:00:00.000Z",
      confidence: 0.91,
      categories: ["story-candidate", "hero-candidate", "favorite-candidate", "strong-change", "needs-review"],
    }));

    expect(recommendations).toEqual([
      { source: "legacy-category", kind: "story" },
      { source: "legacy-category", kind: "hero" },
      { source: "legacy-category", kind: "favorite" },
    ]);
  });

  it("prefers v0.2 recommendations when they are present", () => {
    const recommendations = getEntryEditorialRecommendations(createEntry({
      engine: "future-vision-engine",
      generatedAt: "2026-08-14T00:00:00.000Z",
      confidence: 0.91,
      categories: ["story-candidate", "hero-candidate"],
      recommendations: [
        {
          kind: "favorite",
          score: 0.78,
          reasons: ["Distinct seasonal detail."],
          evidence: [{ signal: "seasonal-event", contribution: 0.4 }],
          engine: "vision-engine-v0.2",
          generatedAt: "2026-08-14T00:00:00.000Z",
          analysisVersion: 2,
        },
      ],
    }));

    expect(recommendations).toEqual([
      expect.objectContaining({
        source: "v0.2",
        recommendation: expect.objectContaining({ kind: "favorite", score: 0.78 }),
      }),
    ]);
  });

  it("does not expose descriptive or workflow categories as editorial recommendations", () => {
    const recommendations = getEntryEditorialRecommendations(createEntry({
      engine: "mock-observation-engine",
      generatedAt: "2026-08-14T00:00:00.000Z",
      confidence: 0.61,
      categories: ["strong-change", "overview-image", "by-place", "needs-review", "low-confidence", "possible-duplicates"],
    }));

    expect(recommendations).toEqual([]);
  });
});