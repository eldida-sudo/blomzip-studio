import { describe, expect, it, vi } from "vitest";
import { MockObservationEngine } from "../components/observationEngine";
import type { Visit } from "../models/blomzip";
import { mergeImportedVisit } from "./mergeImportedVisit";

function createVisit(seed: {
  visitId: string;
  batchId: string;
  fileName: string;
  importedAt: string;
  imageSpecs: Array<{ id: string; filename: string; captureDate?: string; contentHash?: string; sourcePath?: string }>;
}): Visit {
  const { visitId, batchId, fileName, importedAt, imageSpecs } = seed;

  return {
    id: visitId,
    placeId: "temporary-import",
    date: "2026-07-10",
    imageCount: imageSpecs.length,
    importedImageFiles: imageSpecs.map((spec) => spec.filename),
    importBatches: [
      {
        id: batchId,
        fileName,
        importedAt,
        imageCount: imageSpecs.length,
      },
    ],
    imageRecords: imageSpecs.map((spec, index) => ({
      id: spec.id,
      importBatchId: batchId,
      filename: spec.filename,
      fileSize: 100,
      format: "jpg",
      sourcePath: spec.sourcePath ?? spec.filename,
      contentHash: spec.contentHash ?? `sha256:${spec.id}`,
      captureDate: spec.captureDate,
      timelineIndex: index,
    })),
    entries: imageSpecs.map((spec, index) => ({
      id: `entry-${spec.id}`,
      imageRecordId: spec.id,
      visitId,
      status: "new",
      notes: "",
      tags: [],
      observations: [],
      favorite: false,
      hero: false,
      storySelected: false,
      reviewed: false,
      createdAt: "2026-07-10T00:00:00.000Z",
      updatedAt: `2026-07-10T00:00:0${index}.000Z`,
    })),
    status: "Ready for AI",
  };
}

describe("mergeImportedVisit", () => {
  it("merges multiple ZIP imports into one visit and preserves per-image batch provenance", () => {
    const first = createVisit({
      visitId: "visit-a",
      batchId: "batch-a",
      fileName: "a.zip",
      importedAt: "2026-07-10T10:00:00.000Z",
      imageSpecs: [{ id: "image-a1", filename: "a-1.jpg", captureDate: "2026-06-01T10:00:00.000Z" }],
    });

    const second = createVisit({
      visitId: "visit-b",
      batchId: "batch-b",
      fileName: "b.zip",
      importedAt: "2026-07-10T11:00:00.000Z",
      imageSpecs: [{ id: "image-b1", filename: "b-1.jpg", captureDate: "2026-06-02T10:00:00.000Z" }],
    });

    const merged = mergeImportedVisit(first, second);

    expect(merged?.id).toBe("visit-a");
    expect(merged?.imageCount).toBe(2);
    expect(merged?.importBatches?.map((batch) => batch.fileName)).toEqual(["a.zip", "b.zip"]);
    expect(merged?.imageRecords?.map((record) => ({ id: record.id, importBatchId: record.importBatchId }))).toEqual([
      { id: "image-a1", importBatchId: "batch-a" },
      { id: "image-b1", importBatchId: "batch-b" },
    ]);
  });

  it("orders merged images chronologically by captureDate and groups same-date entries stably", () => {
    const base = createVisit({
      visitId: "visit-a",
      batchId: "batch-a",
      fileName: "a.zip",
      importedAt: "2026-07-10T10:00:00.000Z",
      imageSpecs: [
        { id: "image-a1", filename: "a-1.jpg", captureDate: "2026-06-02T10:00:00.000Z" },
        { id: "image-a2", filename: "a-2.jpg", captureDate: "2026-06-02T11:00:00.000Z" },
      ],
    });

    const incoming = createVisit({
      visitId: "visit-b",
      batchId: "batch-b",
      fileName: "b.zip",
      importedAt: "2026-07-10T11:00:00.000Z",
      imageSpecs: [
        { id: "image-b1", filename: "b-1.jpg", captureDate: "2026-06-01T10:00:00.000Z" },
        { id: "image-b2", filename: "b-2.jpg", captureDate: "2026-06-02T11:00:00.000Z" },
      ],
    });

    const merged = mergeImportedVisit(base, incoming);

    expect(merged?.imageRecords?.map((record) => record.id)).toEqual(["image-b1", "image-a1", "image-a2", "image-b2"]);
    expect(merged?.entries.map((entry) => entry.imageRecordId)).toEqual(["image-b1", "image-a1", "image-a2", "image-b2"]);
    expect(merged?.imageRecords?.map((record) => record.timelineIndex)).toEqual([0, 1, 2, 3]);
    expect(merged?.date).toBe("2026-06-01");
  });

  it("preserves existing human decisions when incoming data contains duplicate image IDs", () => {
    const current = createVisit({
      visitId: "visit-a",
      batchId: "batch-a",
      fileName: "a.zip",
      importedAt: "2026-07-10T10:00:00.000Z",
      imageSpecs: [{ id: "image-shared", filename: "shared.jpg", captureDate: "2026-06-01T10:00:00.000Z", contentHash: "sha256:shared" }],
    });

    current.entries[0] = {
      ...current.entries[0],
      notes: "Human curated note",
      reviewed: true,
      favorite: true,
    };

    const incoming = createVisit({
      visitId: "visit-b",
      batchId: "batch-b",
      fileName: "b.zip",
      importedAt: "2026-07-10T11:00:00.000Z",
      imageSpecs: [{ id: "image-shared-reimport", filename: "shared.jpg", captureDate: "2026-06-01T10:00:00.000Z", contentHash: "sha256:shared" }],
    });

    incoming.entries[0] = {
      ...incoming.entries[0],
      notes: "Incoming replacement note",
      reviewed: false,
      favorite: false,
    };

    const merged = mergeImportedVisit(current, incoming);
    const mergedEntry = merged?.entries.find((entry) => entry.imageRecordId === "image-shared");

    expect(mergedEntry?.notes).toBe("Human curated note");
    expect(mergedEntry?.reviewed).toBe(true);
    expect(mergedEntry?.favorite).toBe(true);
    expect(merged?.imageRecords).toHaveLength(1);
    expect(merged?.imageRecords?.[0]?.additionalOccurrences).toEqual([
      {
        importBatchId: "batch-b",
        filename: "shared.jpg",
        sourcePath: "shared.jpg",
        importedAt: "2026-07-10T11:00:00.000Z",
      },
    ]);
    expect(merged?.importBatches?.[1]).toMatchObject({
      rawImageCount: 1,
      importedImageCount: 0,
      duplicateSkippedCount: 1,
    });
  });

  it("keeps different bytes with the same filename as separate canonical records", () => {
    const first = createVisit({
      visitId: "visit-a",
      batchId: "batch-a",
      fileName: "a.zip",
      importedAt: "2026-07-10T10:00:00.000Z",
      imageSpecs: [{ id: "image-a", filename: "photo.jpg", contentHash: "sha256:one" }],
    });
    const second = createVisit({
      visitId: "visit-b",
      batchId: "batch-b",
      fileName: "b.zip",
      importedAt: "2026-07-10T11:00:00.000Z",
      imageSpecs: [{ id: "image-b", filename: "photo.jpg", contentHash: "sha256:two" }],
    });

    const merged = mergeImportedVisit(first, second);

    expect(merged?.imageRecords).toHaveLength(2);
    expect(merged?.importBatches?.[1]).toMatchObject({ importedImageCount: 1, duplicateSkippedCount: 0 });
  });

  it("leaves legacy unhashed records intact and does not use metadata to deduplicate them", () => {
    const legacy = createVisit({
      visitId: "visit-a",
      batchId: "batch-a",
      fileName: "legacy.zip",
      importedAt: "2026-07-10T10:00:00.000Z",
      imageSpecs: [{ id: "legacy-image", filename: "photo.jpg" }],
    });
    delete legacy.imageRecords?.[0]?.contentHash;
    const incoming = createVisit({
      visitId: "visit-b",
      batchId: "batch-b",
      fileName: "new.zip",
      importedAt: "2026-07-10T11:00:00.000Z",
      imageSpecs: [{ id: "new-image", filename: "photo.jpg", contentHash: "sha256:known" }],
    });

    const merged = mergeImportedVisit(legacy, incoming);

    expect(merged?.imageRecords?.map((record) => record.id)).toEqual(["legacy-image", "new-image"]);
    expect(merged?.imageRecords?.[0]?.contentHash).toBeUndefined();
  });

  it("analyzes only new unique records while preserving existing curation and non-story analysis", () => {
    const current = createVisit({
      visitId: "visit-a",
      batchId: "batch-a",
      fileName: "a.zip",
      importedAt: "2026-07-10T10:00:00.000Z",
      imageSpecs: [{ id: "existing", filename: "existing.jpg", contentHash: "sha256:existing" }],
    });
    current.entries[0] = {
      ...current.entries[0],
      favorite: true,
      hero: true,
      storySelected: true,
      hidden: true,
      notes: "Curator note",
      tags: ["curated"],
      visualAnalysis: {
        signals: [],
        provider: "test",
        generatedAt: "2026-01-01T00:00:00.000Z",
        analysisVersion: 1,
      },
      analysisSuggestions: {
        engine: "mock-observation-engine",
        generatedAt: "2026-01-01T00:00:00.000Z",
        confidence: 0.9,
        categories: ["favorite-candidate"],
        recommendations: [{
          kind: "favorite",
          score: 0.9,
          reasons: ["Existing"],
          evidence: [],
          engine: "test",
          generatedAt: "2026-01-01T00:00:00.000Z",
          analysisVersion: 2,
        }],
      },
    };
    const incoming = createVisit({
      visitId: "visit-b",
      batchId: "batch-b",
      fileName: "b.zip",
      importedAt: "2026-07-10T11:00:00.000Z",
      imageSpecs: [
        { id: "duplicate", filename: "different-name.jpg", sourcePath: "other/different-name.jpg", contentHash: "sha256:existing" },
        { id: "new", filename: "new.jpg", contentHash: "sha256:new" },
      ],
    });
    const engine = new MockObservationEngine();
    const observationSpy = vi.spyOn(engine, "generateObservations");

    const merged = mergeImportedVisit(current, incoming, { observationEngine: engine });

    expect(observationSpy).toHaveBeenCalledTimes(1);
    expect(observationSpy).toHaveBeenCalledWith("entry-new");
    expect(merged?.entries.map((entry) => entry.imageRecordId).sort()).toEqual(["existing", "new"]);
    expect(merged?.entries.find((entry) => entry.imageRecordId === "existing")).toMatchObject({
      favorite: true,
      hero: true,
      storySelected: true,
      hidden: true,
      notes: "Curator note",
      tags: ["curated"],
      visualAnalysis: current.entries[0].visualAnalysis,
    });
    expect(merged?.entries.find((entry) => entry.imageRecordId === "existing")?.analysisSuggestions?.recommendations)
      .toContainEqual(expect.objectContaining({ kind: "favorite" }));
  });

  it("keeps both merge inputs immutable while returning appended canonical provenance", () => {
    const current = createVisit({
      visitId: "visit-a",
      batchId: "batch-a",
      fileName: "a.zip",
      importedAt: "2026-07-10T10:00:00.000Z",
      imageSpecs: [{ id: "one", filename: "one.jpg", contentHash: "sha256:one" }],
    });
    const incoming = createVisit({
      visitId: "visit-b",
      batchId: "batch-b",
      fileName: "b.zip",
      importedAt: "2026-07-10T11:00:00.000Z",
      imageSpecs: [{ id: "copy", filename: "copy.jpg", sourcePath: "other/copy.jpg", contentHash: "sha256:one" }],
    });
    const originalCurrent = structuredClone(current);
    const originalIncoming = structuredClone(incoming);

    const merged = mergeImportedVisit(current, incoming);

    expect(current).toEqual(originalCurrent);
    expect(incoming).toEqual(originalIncoming);
    expect(merged?.imageRecords?.[0]?.additionalOccurrences).toEqual([
      {
        importBatchId: "batch-b",
        filename: "copy.jpg",
        sourcePath: "other/copy.jpg",
        importedAt: "2026-07-10T11:00:00.000Z",
      },
    ]);
  });

  it("retains an all-duplicate multi-image re-import as an audit batch", () => {
    const first = createVisit({
      visitId: "visit-a",
      batchId: "batch-a",
      fileName: "first.zip",
      importedAt: "2026-07-10T10:00:00.000Z",
      imageSpecs: [
        { id: "one", filename: "one.jpg", contentHash: "sha256:one" },
        { id: "two", filename: "two.jpg", contentHash: "sha256:two" },
        { id: "three", filename: "three.jpg", contentHash: "sha256:three" },
      ],
    });
    const reimport = createVisit({
      visitId: "visit-b",
      batchId: "batch-b",
      fileName: "first-again.zip",
      importedAt: "2026-07-10T11:00:00.000Z",
      imageSpecs: [
        { id: "copy-one", filename: "one-copy.jpg", sourcePath: "again/one-copy.jpg", contentHash: "sha256:one" },
        { id: "copy-two", filename: "two-copy.jpg", sourcePath: "again/two-copy.jpg", contentHash: "sha256:two" },
        { id: "copy-three", filename: "three-copy.jpg", sourcePath: "again/three-copy.jpg", contentHash: "sha256:three" },
      ],
    });

    const merged = mergeImportedVisit(first, reimport);

    expect(merged?.imageRecords).toHaveLength(3);
    expect(merged?.importBatches).toHaveLength(2);
    expect(merged?.importBatches?.[1]).toMatchObject({
      rawImageCount: 3,
      importedImageCount: 0,
      duplicateSkippedCount: 3,
    });
    expect(merged?.imageRecords?.every((record) => record.additionalOccurrences?.[0]?.importBatchId === "batch-b")).toBe(true);
  });
});
