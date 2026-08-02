import { describe, expect, it } from "vitest";
import type { Visit } from "../models/blomzip";
import { mergeImportedVisit } from "./mergeImportedVisit";

function createVisit(seed: {
  visitId: string;
  batchId: string;
  fileName: string;
  importedAt: string;
  imageSpecs: Array<{ id: string; filename: string; captureDate?: string }>;
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
      sourcePath: spec.filename,
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
      imageSpecs: [{ id: "image-shared", filename: "shared.jpg", captureDate: "2026-06-01T10:00:00.000Z" }],
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
      imageSpecs: [{ id: "image-shared", filename: "shared.jpg", captureDate: "2026-06-01T10:00:00.000Z" }],
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
  });
});
