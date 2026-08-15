import { describe, expect, it } from "vitest";
import type { Entry, EntryRecommendation, EntrySuggestionCategory, ImageRecord } from "../models/blomzip";
import { rankEditorialRecommendations } from "./recommendationRanking";

function createRecommendation(kind: EntryRecommendation["kind"], score: number): EntryRecommendation {
  return {
    kind,
    score,
    reasons: [`${kind} reason`],
    evidence: [{ signal: `${kind}-signal` }],
    engine: "vision-engine-v0.2",
    generatedAt: "2026-08-14T00:00:00.000Z",
    analysisVersion: 2,
  };
}

function createEntry(options: {
  id: string;
  imageRecordId: string;
  recommendations?: EntryRecommendation[];
  legacyCategories?: EntrySuggestionCategory[];
}): Entry {
  return {
    id: options.id,
    imageRecordId: options.imageRecordId,
    visitId: "visit-1",
    status: "new",
    notes: "",
    tags: [],
    observations: [],
    analysisSuggestions: {
      engine: "future-vision-engine",
      generatedAt: "2026-08-14T00:00:00.000Z",
      confidence: 0.8,
      categories: options.legacyCategories ?? [],
      recommendations: options.recommendations,
    },
    createdAt: "2026-08-14T00:00:00.000Z",
    updatedAt: "2026-08-14T00:00:00.000Z",
  };
}

function createImageRecord(options: {
  id: string;
  placeId?: string;
  captureDate?: string;
  timelineIndex?: number;
  importBatchId?: string;
}): ImageRecord {
  return {
    id: options.id,
    importBatchId: options.importBatchId,
    placeId: options.placeId,
    filename: `${options.id}.jpg`,
    fileSize: 1,
    format: "jpg",
    sourcePath: options.id,
    captureDate: options.captureDate,
    timelineIndex: options.timelineIndex,
  };
}

describe("rankEditorialRecommendations", () => {
  const imageRecords = [
    createImageRecord({ id: "image-1", placeId: "rock-garden", captureDate: "2026-01-03T10:00:00.000Z", timelineIndex: 2, importBatchId: "batch-70" }),
    createImageRecord({ id: "image-2", placeId: "rock-garden", captureDate: "2026-01-01T10:00:00.000Z", timelineIndex: 0, importBatchId: "batch-1" }),
    createImageRecord({ id: "image-3", placeId: "house-wall", captureDate: "2026-01-02T10:00:00.000Z", timelineIndex: 1, importBatchId: "batch-2" }),
    createImageRecord({ id: "image-4", timelineIndex: 3, importBatchId: "batch-70" }),
  ];

  const entries = [
    createEntry({ id: "entry-1", imageRecordId: "image-1", recommendations: [createRecommendation("story", 0.8), createRecommendation("hero", 0.3)] }),
    createEntry({ id: "entry-2", imageRecordId: "image-2", recommendations: [createRecommendation("story", 0.9)] }),
    createEntry({ id: "entry-3", imageRecordId: "image-3", recommendations: [createRecommendation("story", 0.95), createRecommendation("hero", 0.99)] }),
    createEntry({ id: "entry-4", imageRecordId: "image-4", recommendations: [createRecommendation("story", 0.7)] }),
  ];

  it("ranks higher-scored Story recommendations across import batches", () => {
    const ranked = rankEditorialRecommendations({ entries, imageRecords, kind: "story", scope: { type: "archive" } });

    expect(ranked.map((candidate) => [candidate.entryId, candidate.rank])).toEqual([
      ["entry-3", 1],
      ["entry-2", 2],
      ["entry-1", 3],
      ["entry-4", 4],
    ]);
  });

  it("ranks Hero recommendations independently from Story recommendations", () => {
    const ranked = rankEditorialRecommendations({ entries, imageRecords, kind: "hero", scope: { type: "archive" } });

    expect(ranked.map((candidate) => candidate.entryId)).toEqual(["entry-3", "entry-1"]);
  });

  it("supports canonical-place ranking while leaving unassigned images archive-eligible", () => {
    const archiveRanked = rankEditorialRecommendations({ entries, imageRecords, kind: "story", scope: { type: "archive" } });
    const placeRanked = rankEditorialRecommendations({
      entries,
      imageRecords,
      kind: "story",
      scope: { type: "canonical-place", placeId: "rock-garden" },
    });

    expect(archiveRanked.find((candidate) => candidate.entryId === "entry-2")?.rank).toBe(2);
    expect(placeRanked.map((candidate) => [candidate.entryId, candidate.rank])).toEqual([
      ["entry-2", 1],
      ["entry-1", 2],
    ]);
    expect(archiveRanked.some((candidate) => candidate.entryId === "entry-4")).toBe(true);
    expect(placeRanked.some((candidate) => candidate.entryId === "entry-4")).toBe(false);
  });

  it("uses capture date, timeline order, input order, and entry id as deterministic score tie-breakers", () => {
    const tiedEntries = [
      createEntry({ id: "entry-z", imageRecordId: "tie-1", recommendations: [createRecommendation("story", 0.8)] }),
      createEntry({ id: "entry-a", imageRecordId: "tie-2", recommendations: [createRecommendation("story", 0.8)] }),
      createEntry({ id: "entry-b", imageRecordId: "tie-3", recommendations: [createRecommendation("story", 0.8)] }),
    ];
    const tiedRecords = [
      createImageRecord({ id: "tie-1", captureDate: "2026-01-02T10:00:00.000Z", timelineIndex: 1 }),
      createImageRecord({ id: "tie-2", captureDate: "2026-01-01T10:00:00.000Z", timelineIndex: 2 }),
      createImageRecord({ id: "tie-3", captureDate: "2026-01-01T10:00:00.000Z", timelineIndex: 0 }),
    ];
    const options = { entries: tiedEntries, imageRecords: tiedRecords, kind: "story" as const, scope: { type: "archive" as const } };

    expect(rankEditorialRecommendations(options).map((candidate) => candidate.entryId)).toEqual(["entry-b", "entry-a", "entry-z"]);
    expect(rankEditorialRecommendations(options)).toEqual(rankEditorialRecommendations(options));
  });

  it("excludes invalid scores and legacy-only categories without mutating source data", () => {
    const legacyEntry = createEntry({ id: "legacy", imageRecordId: "legacy-image", legacyCategories: ["story-candidate"] });
    delete legacyEntry.analysisSuggestions?.recommendations;
    const invalidEntry = createEntry({ id: "invalid", imageRecordId: "invalid-image", recommendations: [createRecommendation("story", Number.NaN)] });
    const source = [legacyEntry, invalidEntry, entries[0]!];
    const sourceSnapshot = structuredClone(source);

    const ranked = rankEditorialRecommendations({
      entries: source,
      imageRecords: [...imageRecords, createImageRecord({ id: "legacy-image" }), createImageRecord({ id: "invalid-image" })],
      kind: "story",
      scope: { type: "archive" },
    });

    expect(ranked.map((candidate) => candidate.entryId)).toEqual(["entry-1"]);
    expect(source).toEqual(sourceSnapshot);
  });
});