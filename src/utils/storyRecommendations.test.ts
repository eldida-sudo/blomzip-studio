import { describe, expect, it } from "vitest";
import type { Entry, ImageRecord, Visit } from "../models/blomzip";
import { rankEditorialRecommendations } from "./recommendationRanking";
import { applyStoryRecommendations, generateStoryRecommendations } from "./storyRecommendations";

function createEntry(id: string, imageRecordId: string, confidence = 0.95): Entry {
  return {
    id,
    imageRecordId,
    visitId: "visit-story-1",
    status: "new",
    notes: "",
    tags: [],
    observations: [],
    analysisSuggestions: {
      engine: "mock-observation-engine",
      generatedAt: "2026-08-14T00:00:00.000Z",
      confidence,
      categories: ["hero-candidate", "favorite-candidate"],
    },
    createdAt: "2026-08-14T00:00:00.000Z",
    updatedAt: "2026-08-14T00:00:00.000Z",
  };
}

function createRecord(options: {
  id: string;
  placeId?: string;
  captureDate?: string;
  timelineIndex: number;
  fileSize?: number;
  width?: number;
  height?: number;
}): ImageRecord {
  return {
    id: options.id,
    placeId: options.placeId,
    filename: `${options.id}.jpg`,
    fileSize: options.fileSize ?? 100_000 + (options.timelineIndex * 10_000),
    format: "jpg",
    sourcePath: options.id,
    captureDate: options.captureDate,
    timelineIndex: options.timelineIndex,
    width: options.width ?? 1200,
    height: options.height ?? 800,
  };
}

function createVisit(imageRecords: ImageRecord[], entries: Entry[]): Visit {
  return {
    id: "visit-story-1",
    placeId: "temporary-import",
    date: "2026-01-01",
    imageRecords,
    entries,
    importBatches: [
      {
        id: "batch-1",
        fileName: "story.zip",
        importedAt: "2026-08-14T00:00:00.000Z",
        imageCount: entries.length,
      },
    ],
  };
}

describe("generateStoryRecommendations", () => {
  it("uses archive context rather than generic mock observation confidence", () => {
    const records = [
      createRecord({ id: "image-1", placeId: "rock-garden", captureDate: "2026-01-01T10:00:00.000Z", timelineIndex: 0 }),
      createRecord({ id: "image-2", placeId: "rock-garden", captureDate: "2026-02-01T10:00:00.000Z", timelineIndex: 1 }),
    ];
    const highConfidenceVisit = createVisit(records, [createEntry("entry-1", "image-1", 0.98), createEntry("entry-2", "image-2", 0.84)]);
    const lowConfidenceVisit = createVisit(records, [createEntry("entry-1", "image-1", 0.1), createEntry("entry-2", "image-2", 0.2)]);

    expect(generateStoryRecommendations(highConfidenceVisit)).toEqual(generateStoryRecommendations(lowConfidenceVisit));
  });

  it("adds chronological and underrepresented-place evidence with context-dependent scores", () => {
    const records = [
      createRecord({ id: "rock-early", placeId: "rock-garden", captureDate: "2026-01-01T10:00:00.000Z", timelineIndex: 0 }),
      createRecord({ id: "rock-late", placeId: "rock-garden", captureDate: "2026-02-01T10:00:00.000Z", timelineIndex: 1 }),
      createRecord({ id: "wall-1", placeId: "house-wall", captureDate: "2026-01-01T10:00:00.000Z", timelineIndex: 2 }),
      createRecord({ id: "wall-2", placeId: "house-wall", captureDate: "2026-01-15T10:00:00.000Z", timelineIndex: 3 }),
      createRecord({ id: "wall-3", placeId: "house-wall", captureDate: "2026-01-29T10:00:00.000Z", timelineIndex: 4 }),
      createRecord({ id: "wall-4", placeId: "house-wall", captureDate: "2026-02-12T10:00:00.000Z", timelineIndex: 5 }),
    ];
    const entries = records.map((record, index) => createEntry(`entry-${index}`, record.id));
    const recommendations = generateStoryRecommendations(createVisit(records, entries));
    const rockRecommendation = recommendations.get("entry-0");
    const wallRecommendation = recommendations.get("entry-2");

    expect(rockRecommendation?.score).toBe(0.88);
    expect(rockRecommendation?.reasons).toContain("Provides an early chronological reference for this place.");
    expect(rockRecommendation?.reasons).toContain("Adds coverage to an underrepresented place in the archive.");
    expect(rockRecommendation?.evidence).toEqual(expect.arrayContaining([
      expect.objectContaining({ signal: "chronological-anchor" }),
      expect.objectContaining({ signal: "place-coverage", detail: "2 photographs currently assigned to this place" }),
    ]));
    expect(wallRecommendation?.score).toBe(0.7);
    expect(rockRecommendation?.score).toBeGreaterThan(wallRecommendation?.score ?? 0);
  });

  it("uses temporal separation, leaves dense or undated entries ineligible, and makes no visual claims", () => {
    const records = [
      createRecord({ id: "unassigned-early", captureDate: "2026-01-01T10:00:00.000Z", timelineIndex: 0 }),
      createRecord({ id: "unassigned-late", captureDate: "2026-01-20T10:00:00.000Z", timelineIndex: 1 }),
      createRecord({ id: "dense", placeId: "house-wall", captureDate: "2026-01-02T10:00:00.000Z", timelineIndex: 2 }),
      createRecord({ id: "undated", placeId: "house-wall", timelineIndex: 3 }),
    ];
    const entries = records.map((record, index) => createEntry(`entry-${index}`, record.id));
    const recommendations = generateStoryRecommendations(createVisit(records, entries));
    const unassignedRecommendation = recommendations.get("entry-0");

    expect(unassignedRecommendation?.evidence).toEqual(expect.arrayContaining([
      expect.objectContaining({ signal: "chronological-anchor" }),
      expect.objectContaining({ signal: "temporal-separation" }),
    ]));
    expect(recommendations.has("entry-2")).toBe(false);
    expect(recommendations.has("entry-3")).toBe(false);
    expect(unassignedRecommendation?.reasons.join(" ")).not.toMatch(/human|plant|flower|maintenance|social|visible/i);
  });

  it("suppresses non-representative metadata duplicates deterministically", () => {
    const records = [
      createRecord({ id: "duplicate-early", placeId: "rock-garden", captureDate: "2026-01-01T10:00:00.000Z", timelineIndex: 0, fileSize: 100_000 }),
      createRecord({ id: "duplicate-late", placeId: "rock-garden", captureDate: "2026-02-01T10:00:00.000Z", timelineIndex: 1, fileSize: 100_010 }),
      createRecord({ id: "unique", placeId: "rock-garden", captureDate: "2026-03-01T10:00:00.000Z", timelineIndex: 2, fileSize: 160_000 }),
    ];
    const entries = records.map((record, index) => createEntry(`entry-${index}`, record.id));
    const recommendations = generateStoryRecommendations(createVisit(records, entries));

    expect(recommendations.has("entry-0")).toBe(true);
    expect(recommendations.has("entry-1")).toBe(false);
  });

  it("is deterministic, does not recommend every entry, and integrates with archive ranking", () => {
    const records = [
      createRecord({ id: "anchor-1", placeId: "rock-garden", captureDate: "2026-01-01T10:00:00.000Z", timelineIndex: 0 }),
      createRecord({ id: "anchor-2", placeId: "rock-garden", captureDate: "2026-02-01T10:00:00.000Z", timelineIndex: 1 }),
      createRecord({ id: "dense", placeId: "rock-garden", captureDate: "2026-02-02T10:00:00.000Z", timelineIndex: 2, fileSize: 160_000 }),
    ];
    const entries = records.map((record, index) => createEntry(`entry-${index}`, record.id));
    const visit = createVisit(records, entries);
    const appliedVisit = applyStoryRecommendations(visit);
    const ranked = rankEditorialRecommendations({
      entries: appliedVisit.entries,
      imageRecords: appliedVisit.imageRecords,
      kind: "story",
      scope: { type: "archive" },
    });

    expect(generateStoryRecommendations(visit)).toEqual(generateStoryRecommendations(visit));
    expect(ranked.map((candidate) => candidate.entryId)).toEqual(["entry-0", "entry-2"]);
    expect(ranked).toHaveLength(2);
    expect(appliedVisit.entries[0]?.analysisSuggestions?.categories).not.toContain("story-candidate");
    expect(appliedVisit.entries[0]?.analysisSuggestions?.categories).toEqual(expect.arrayContaining(["hero-candidate", "favorite-candidate"]));
  });
});