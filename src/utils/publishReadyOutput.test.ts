import { describe, expect, it } from "vitest";
import type { Visit } from "../models/blomzip";
import { createPublishReadyVisitOutput } from "./publishReadyOutput";

describe("createPublishReadyVisitOutput", () => {
  it("creates a versioned publish schema with visit metadata, entries and counts", () => {
    const visit: Visit = {
      id: "visit-1",
      placeId: "place-1",
      date: "2026-07-09",
      status: "Finalized",
      weather: { temperature: 22, conditions: "clear" },
      imageCount: 2,
      importedImageFiles: ["courtyard-01.jpg", "courtyard-02.jpg"],
      imageRecords: [
        {
          id: "image-1",
          filename: "courtyard-01.jpg",
          fileSize: 1200,
          format: "jpeg",
          sourcePath: "courtyard-01.jpg",
          timelineIndex: 0,
          captureDate: "2026-07-08T10:00:00.000Z",
          width: 1600,
          height: 1200,
          aspectRatio: 1.333,
          orientation: "landscape",
          mimeType: "image/jpeg",
          thumbnailUrl: "blob:thumb-1",
        },
      ],
      entries: [
        {
          id: "entry-1",
          imageRecordId: "image-1",
          visitId: "visit-1",
          status: "new",
          notes: "lavender near path",
          tags: ["lavender", "pollinator"],
          observations: [
            {
              id: "obs-1",
              entryId: "entry-1",
              type: "plant",
              source: "user",
              value: "Lavandula",
              createdAt: "2026-07-09T11:00:00.000Z",
              reviewed: true,
              accepted: true,
            },
          ],
          reviewed: true,
          createdAt: "2026-07-09T00:00:00.000Z",
          updatedAt: "2026-07-09T00:00:00.000Z",
        },
        {
          id: "entry-2",
          imageRecordId: "missing-image-record",
          visitId: "visit-1",
          status: "new",
          notes: "",
          tags: [],
          observations: [],
          reviewed: false,
          createdAt: "2026-07-09T00:00:00.000Z",
          updatedAt: "2026-07-09T00:00:00.000Z",
        },
      ],
    };

    const output = createPublishReadyVisitOutput(visit, "2026-07-09T12:00:00.000Z");

    expect(output.schema).toBe("blomzip.publish-ready.visit");
    expect(output.schemaVersion).toBe("1.1.0");
    expect(output.stage).toBe("publish");
    expect(output.exportedAt).toBe("2026-07-09T12:00:00.000Z");

    expect(output.counts).toEqual({
      totalEntries: 2,
      reviewedEntries: 1,
      pendingEntries: 1,
      exportedEntries: 2,
    });

    expect(output.visit).toEqual({
      id: "visit-1",
      placeId: "place-1",
      date: "2026-07-09",
      status: "Finalized",
      weather: { temperature: 22, conditions: "clear" },
      imageCount: 2,
      importedImageFiles: ["courtyard-01.jpg", "courtyard-02.jpg"],
      location: undefined,
    });

    expect(output.entries[0]).toEqual({
      id: "entry-1",
      visitId: "visit-1",
      imageRecordId: "image-1",
      review: {
        reviewed: true,
        status: "new",
      },
      content: {
        notes: "lavender near path",
        tags: ["lavender", "pollinator"],
        observations: [
          {
            id: "obs-1",
            entryId: "entry-1",
            type: "plant",
            source: "user",
            value: "Lavandula",
            createdAt: "2026-07-09T11:00:00.000Z",
            reviewed: true,
            accepted: true,
          },
        ],
      },
      image: {
        filename: "courtyard-01.jpg",
        sourcePath: "courtyard-01.jpg",
        format: "jpeg",
        fileSize: 1200,
        timelineIndex: 0,
        captureDate: "2026-07-08T10:00:00.000Z",
        width: 1600,
        height: 1200,
        aspectRatio: 1.333,
        orientation: "landscape",
        mimeType: "image/jpeg",
        thumbnailUrl: "blob:thumb-1",
        location: undefined,
      },
      createdAt: "2026-07-09T00:00:00.000Z",
      updatedAt: "2026-07-09T00:00:00.000Z",
    });

    expect(output.entries[1]?.image).toBeNull();
  });

  it("returns cloned values for nested payloads", () => {
    const visit: Visit = {
      id: "visit-2",
      placeId: "place-2",
      date: "2026-07-09",
      entries: [
        {
          id: "entry-1",
          imageRecordId: "image-1",
          visitId: "visit-2",
          status: "new",
          notes: "initial",
          tags: ["before"],
          observations: [
            {
              id: "obs-1",
              entryId: "entry-1",
              type: "general",
              source: "user",
              value: "before",
              createdAt: "2026-07-09T00:00:00.000Z",
              reviewed: false,
            },
          ],
          reviewed: false,
          createdAt: "2026-07-09T00:00:00.000Z",
          updatedAt: "2026-07-09T00:00:00.000Z",
        },
      ],
    };

    const output = createPublishReadyVisitOutput(visit);

    visit.entries[0]!.notes = "changed";
    visit.entries[0]!.tags.push("after");
    visit.entries[0]!.observations[0]!.value = "changed";

    expect(output.entries[0]!.content.notes).toBe("initial");
    expect(output.entries[0]!.content.tags).toEqual(["before"]);
    expect(output.entries[0]!.content.observations[0]!.value).toBe("before");
    expect(output.rawVisit.entries[0]!.notes).toBe("initial");
  });
});
