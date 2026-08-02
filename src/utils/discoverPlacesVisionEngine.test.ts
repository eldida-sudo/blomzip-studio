import { describe, expect, it } from "vitest";
import type { Visit } from "../models/blomzip";
import { discoverPlacesVisionSummary } from "./discoverPlacesVisionEngine";

function createVisit(imageRecords: Visit["imageRecords"], entries: Visit["entries"]): Visit {
  return {
    id: "visit-vision-1",
    placeId: "temporary-import",
    date: "2026-08-02",
    imageCount: imageRecords?.length ?? 0,
    imageRecords,
    entries,
    importBatches: [
      {
        id: "batch-1",
        fileName: "vision.zip",
        importedAt: "2026-08-02T10:00:00.000Z",
        imageCount: imageRecords?.length ?? 0,
      },
    ],
    status: "Ready for AI",
  };
}

describe("discoverPlacesVisionSummary", () => {
  it("clusters place candidates using path, sequence and dimensions", () => {
    const visit = createVisit(
      [
        {
          id: "img-1",
          importBatchId: "batch-1",
          filename: "a1.jpg",
          sourcePath: "north-yard/a1.jpg",
          format: "jpg",
          fileSize: 1800000,
          width: 4000,
          height: 3000,
          aspectRatio: 1.3333,
          orientation: "landscape",
          captureDate: "2026-08-02T10:00:00.000Z",
          timelineIndex: 0,
        },
        {
          id: "img-2",
          importBatchId: "batch-1",
          filename: "a2.jpg",
          sourcePath: "north-yard/a2.jpg",
          format: "jpg",
          fileSize: 1785000,
          width: 4000,
          height: 3000,
          aspectRatio: 1.3333,
          orientation: "landscape",
          captureDate: "2026-08-02T10:06:00.000Z",
          timelineIndex: 1,
        },
        {
          id: "img-3",
          importBatchId: "batch-1",
          filename: "b1.jpg",
          sourcePath: "south-garden/b1.jpg",
          format: "jpg",
          fileSize: 1960000,
          width: 3000,
          height: 4000,
          aspectRatio: 0.75,
          orientation: "portrait",
          captureDate: "2026-08-02T14:00:00.000Z",
          timelineIndex: 2,
        },
      ],
      [
        {
          id: "entry-1",
          imageRecordId: "img-1",
          visitId: "visit-vision-1",
          status: "new",
          notes: "",
          tags: [],
          observations: [],
          createdAt: "2026-08-02T10:00:00.000Z",
          updatedAt: "2026-08-02T10:00:00.000Z",
        },
        {
          id: "entry-2",
          imageRecordId: "img-2",
          visitId: "visit-vision-1",
          status: "new",
          notes: "",
          tags: [],
          observations: [],
          createdAt: "2026-08-02T10:00:00.000Z",
          updatedAt: "2026-08-02T10:00:00.000Z",
        },
        {
          id: "entry-3",
          imageRecordId: "img-3",
          visitId: "visit-vision-1",
          status: "new",
          notes: "",
          tags: [],
          observations: [],
          createdAt: "2026-08-02T10:00:00.000Z",
          updatedAt: "2026-08-02T10:00:00.000Z",
        },
      ]
    );

    const summary = discoverPlacesVisionSummary(visit);

    expect(summary.analysisScope).toBe("full-archive");
    expect(summary.analyzedImageCount).toBe(3);
    expect(summary.candidatePlaceGroupCount).toBe(1);
    expect(summary.candidatePlaceGroups[0]?.imageRecordIds).toEqual(["img-1", "img-2"]);
    expect(summary.candidatePlaceGroups[0]?.confidence).toBeGreaterThan(0.7);
  });

  it("finds near duplicates and reduces duplicates to extra-copy count", () => {
    const visit = createVisit(
      [
        {
          id: "img-1",
          importBatchId: "batch-1",
          filename: "dup-1.jpg",
          sourcePath: "yard/dup-1.jpg",
          format: "jpg",
          fileSize: 1320000,
          width: 2048,
          height: 1536,
          orientation: "landscape",
          captureDate: "2026-08-02T10:00:00.000Z",
          timelineIndex: 0,
        },
        {
          id: "img-2",
          importBatchId: "batch-1",
          filename: "dup-2.jpg",
          sourcePath: "yard/dup-2.jpg",
          format: "jpg",
          fileSize: 1320100,
          width: 2048,
          height: 1536,
          orientation: "landscape",
          captureDate: "2026-08-02T10:00:20.000Z",
          timelineIndex: 1,
        },
        {
          id: "img-3",
          importBatchId: "batch-1",
          filename: "hero.jpg",
          sourcePath: "yard/hero.jpg",
          format: "jpg",
          fileSize: 2450000,
          width: 4032,
          height: 3024,
          orientation: "landscape",
          captureDate: "2026-08-02T11:00:00.000Z",
          timelineIndex: 2,
        },
      ],
      [
        {
          id: "entry-1",
          imageRecordId: "img-1",
          visitId: "visit-vision-1",
          status: "new",
          notes: "",
          tags: [],
          observations: [],
          createdAt: "2026-08-02T10:00:00.000Z",
          updatedAt: "2026-08-02T10:00:00.000Z",
        },
        {
          id: "entry-2",
          imageRecordId: "img-2",
          visitId: "visit-vision-1",
          status: "new",
          notes: "",
          tags: [],
          observations: [],
          createdAt: "2026-08-02T10:00:00.000Z",
          updatedAt: "2026-08-02T10:00:00.000Z",
        },
        {
          id: "entry-3",
          imageRecordId: "img-3",
          visitId: "visit-vision-1",
          status: "new",
          notes: "",
          tags: [],
          observations: [],
          analysisSuggestions: {
            engine: "mock-observation-engine",
            generatedAt: "2026-08-02T11:00:00.000Z",
            confidence: 0.92,
            categories: ["story-candidate", "hero-candidate"],
          },
          createdAt: "2026-08-02T10:00:00.000Z",
          updatedAt: "2026-08-02T10:00:00.000Z",
        },
      ]
    );

    const summary = discoverPlacesVisionSummary(visit);

    expect(summary.nearDuplicateGroups).toHaveLength(1);
    expect(summary.nearDuplicateGroups[0]?.imageRecordIds).toEqual(["img-1", "img-2"]);
    expect(summary.nearDuplicateCount).toBe(1);
    expect(summary.heroCandidateCount).toBeGreaterThanOrEqual(1);
    expect(summary.heroCandidates[0]?.imageRecordId).toBe("img-3");
  });

  it("returns an empty summary when no records exist", () => {
    const visit = createVisit([], []);
    const summary = discoverPlacesVisionSummary(visit);

    expect(summary.analyzedImageCount).toBe(0);
    expect(summary.candidatePlaceGroupCount).toBe(0);
    expect(summary.nearDuplicateCount).toBe(0);
    expect(summary.heroCandidateCount).toBe(0);
  });

  it("analyzes only the requested import batch when available", () => {
    const visit = createVisit(
      [
        {
          id: "img-a1",
          importBatchId: "batch-a",
          filename: "a1.jpg",
          sourcePath: "north-yard/a1.jpg",
          format: "jpg",
          fileSize: 1800000,
          width: 4000,
          height: 3000,
          aspectRatio: 1.3333,
          orientation: "landscape",
          captureDate: "2026-08-02T10:00:00.000Z",
          timelineIndex: 0,
        },
        {
          id: "img-b1",
          importBatchId: "batch-b",
          filename: "b1.jpg",
          sourcePath: "south-garden/b1.jpg",
          format: "jpg",
          fileSize: 1805000,
          width: 4000,
          height: 3000,
          aspectRatio: 1.3333,
          orientation: "landscape",
          captureDate: "2026-08-02T10:04:00.000Z",
          timelineIndex: 1,
        },
        {
          id: "img-b2",
          importBatchId: "batch-b",
          filename: "b2.jpg",
          sourcePath: "south-garden/b2.jpg",
          format: "jpg",
          fileSize: 1804500,
          width: 4000,
          height: 3000,
          aspectRatio: 1.3333,
          orientation: "landscape",
          captureDate: "2026-08-02T10:06:00.000Z",
          timelineIndex: 2,
        },
      ],
      [
        {
          id: "entry-a1",
          imageRecordId: "img-a1",
          visitId: "visit-vision-1",
          status: "new",
          notes: "",
          tags: [],
          observations: [],
          createdAt: "2026-08-02T10:00:00.000Z",
          updatedAt: "2026-08-02T10:00:00.000Z",
        },
        {
          id: "entry-b1",
          imageRecordId: "img-b1",
          visitId: "visit-vision-1",
          status: "new",
          notes: "",
          tags: [],
          observations: [],
          createdAt: "2026-08-02T10:00:00.000Z",
          updatedAt: "2026-08-02T10:00:00.000Z",
        },
        {
          id: "entry-b2",
          imageRecordId: "img-b2",
          visitId: "visit-vision-1",
          status: "new",
          notes: "",
          tags: [],
          observations: [],
          createdAt: "2026-08-02T10:00:00.000Z",
          updatedAt: "2026-08-02T10:00:00.000Z",
        },
      ]
    );

    const summary = discoverPlacesVisionSummary(visit, { importBatchId: "batch-b" });

    expect(summary.analysisScope).toBe("import-batch");
    expect(summary.analysisImportBatchId).toBe("batch-b");
    expect(summary.analyzedImageCount).toBe(2);
    expect(summary.candidatePlaceGroups[0]?.imageRecordIds).toEqual(["img-b1", "img-b2"]);
  });

  it("falls back to full archive analysis when a requested batch is unavailable", () => {
    const visit = createVisit(
      [
        {
          id: "img-1",
          importBatchId: "batch-1",
          filename: "a1.jpg",
          sourcePath: "north-yard/a1.jpg",
          format: "jpg",
          fileSize: 1800000,
          width: 4000,
          height: 3000,
          aspectRatio: 1.3333,
          orientation: "landscape",
          captureDate: "2026-08-02T10:00:00.000Z",
          timelineIndex: 0,
        },
        {
          id: "img-2",
          importBatchId: "batch-1",
          filename: "a2.jpg",
          sourcePath: "north-yard/a2.jpg",
          format: "jpg",
          fileSize: 1785000,
          width: 4000,
          height: 3000,
          aspectRatio: 1.3333,
          orientation: "landscape",
          captureDate: "2026-08-02T10:06:00.000Z",
          timelineIndex: 1,
        },
      ],
      [
        {
          id: "entry-1",
          imageRecordId: "img-1",
          visitId: "visit-vision-1",
          status: "new",
          notes: "",
          tags: [],
          observations: [],
          createdAt: "2026-08-02T10:00:00.000Z",
          updatedAt: "2026-08-02T10:00:00.000Z",
        },
        {
          id: "entry-2",
          imageRecordId: "img-2",
          visitId: "visit-vision-1",
          status: "new",
          notes: "",
          tags: [],
          observations: [],
          createdAt: "2026-08-02T10:00:00.000Z",
          updatedAt: "2026-08-02T10:00:00.000Z",
        },
      ]
    );

    const summary = discoverPlacesVisionSummary(visit, { importBatchId: "missing-batch" });

    expect(summary.analysisScope).toBe("full-archive");
    expect(summary.analyzedImageCount).toBe(2);
    expect(summary.candidatePlaceGroupCount).toBe(1);
  });
});
