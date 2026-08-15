/**
 * @vitest-environment jsdom
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { DraftWorkspace, Visit } from "../models/blomzip";
import { createThumbnailUrlForRecord } from "./createThumbnailUrls";
import {
  archiveStateHasContent,
  createArchiveStateSnapshot,
  loadArchiveState,
  saveArchiveState,
} from "./archivePersistence";

const visit: Visit = {
  id: "visit-1",
  placeId: "place-1",
  date: "2026-07-10",
  entries: [
    {
      id: "entry-1",
      imageRecordId: "image-1",
      visitId: "visit-1",
      status: "new",
      notes: "Persisted note",
      tags: ["garden"],
      observations: [
        {
          id: "obs-1",
          entryId: "entry-1",
          type: "Plant",
          confidence: 0.9,
          source: "user",
          value: "Hydrangea",
          createdAt: "2026-07-10T00:00:00.000Z",
          reviewed: true,
          accepted: true,
        },
      ],
      favorite: true,
      hero: true,
      storySelected: true,
      reviewed: true,
      createdAt: "2026-07-10T00:00:00.000Z",
      updatedAt: "2026-07-10T00:00:00.000Z",
    },
  ],
  imageCount: 1,
  imageRecords: [
    {
      id: "image-1",
      placeId: "house-wall",
      filename: "garden-01.jpg",
      fileSize: 1024,
      format: "jpeg",
      sourcePath: "garden/garden-01.jpg",
      width: 1600,
      height: 1200,
      orientation: "landscape",
      mimeType: "image/jpeg",
      timelineIndex: 0,
      thumbnailUrl: "data:image/jpeg;base64,R0lGODlhAQABAIAAAAUEBAAAACwAAAAAAQABAAACAkQBADs=",
    },
  ],
  importBatches: [
    {
      id: "batch-1",
      fileName: "garden.zip",
      importedAt: "2026-07-10T00:00:00.000Z",
      imageCount: 1,
    },
  ],
  status: "Review in progress",
};

const draftWorkspace: DraftWorkspace = {
  drafts: [
    {
      id: "draft-1",
      label: "Draft 2026-07-10",
      createdAt: "2026-07-10T00:00:00.000Z",
      savedAt: "2026-07-10T12:00:00.000Z",
      visit,
      studioImages: [],
    },
  ],
  activeDraftId: "draft-1",
};

describe("archivePersistence", () => {
  beforeEach(() => {
    window.localStorage.clear();
    vi.restoreAllMocks();
  });

  it("saves and restores the current archive state", async () => {
    const snapshot = createArchiveStateSnapshot({ importVisit: visit, draftWorkspace });

    expect(archiveStateHasContent(snapshot)).toBe(true);

    await saveArchiveState(snapshot);

    const restored = await loadArchiveState();

    expect(restored).toEqual(expect.objectContaining({
      schema: "blomzip.archive-state",
      schemaVersion: 2,
      importVisit: expect.objectContaining({
        id: visit.id,
        entries: expect.arrayContaining([
          expect.objectContaining({
            id: "entry-1",
            favorite: true,
            hero: true,
            storySelected: true,
            reviewed: true,
            notes: "Persisted note",
            observations: expect.arrayContaining([
              expect.objectContaining({
                id: "obs-1",
                value: "Hydrangea",
                accepted: true,
              }),
            ]),
          }),
        ]),
        imageRecords: expect.arrayContaining([
          expect.objectContaining({
            id: "image-1",
            placeId: "house-wall",
          }),
        ]),
      }),
      draftWorkspace: expect.objectContaining({
        activeDraftId: "draft-1",
        drafts: expect.arrayContaining([
          expect.objectContaining({
            id: "draft-1",
            visit: expect.objectContaining({ id: visit.id }),
            studioImages: [],
          }),
        ]),
      }),
    }));

    expect(restored?.importVisit?.imageRecords?.[0]).not.toHaveProperty("thumbnailUrl");
  });

  it("migrates a legacy archive payload without a schema wrapper", async () => {
    window.localStorage.setItem(
      "blomzip-studio:archive-state:v1",
      JSON.stringify({
        savedAt: "2026-07-10T12:00:00.000Z",
        importVisit: visit,
        draftWorkspace,
      })
    );

    const restored = await loadArchiveState();

    expect(restored).toEqual(expect.objectContaining({
      schema: "blomzip.archive-state",
      schemaVersion: 2,
      importVisit: expect.objectContaining({ id: visit.id }),
    }));
  });

  it("migrates a schema v1 archive without recommendations", async () => {
    window.localStorage.setItem(
      "blomzip-studio:archive-state:v1",
      JSON.stringify({
        schema: "blomzip.archive-state",
        schemaVersion: 1,
        savedAt: "2026-07-10T12:00:00.000Z",
        importVisit: {
          ...visit,
          entries: [{
            ...visit.entries[0],
            analysisSuggestions: {
              engine: "mock-observation-engine",
              generatedAt: "2026-07-10T00:00:00.000Z",
              confidence: 0.91,
              categories: ["story-candidate"],
            },
          }],
        },
        draftWorkspace,
      })
    );

    const restored = await loadArchiveState();

    expect(restored?.schemaVersion).toBe(2);
    expect(restored?.importVisit?.entries[0]?.analysisSuggestions).toEqual(expect.objectContaining({
      categories: ["story-candidate"],
      recommendations: undefined,
    }));
  });

  it("persists v0.2 recommendations with independent nested reasons and evidence", async () => {
    const recommendationVisit: Visit = {
      ...visit,
      entries: [{
        ...visit.entries[0],
        analysisSuggestions: {
          engine: "future-vision-engine",
          generatedAt: "2026-08-14T00:00:00.000Z",
          confidence: 0.8,
          categories: ["story-candidate"],
          recommendations: [
            {
              kind: "story",
              score: 0.88,
              reasons: ["Documents a seasonal change."],
              evidence: [{ signal: "seasonal-event", contribution: 0.52, detail: "Flowering border" }],
              engine: "vision-engine-v0.2",
              generatedAt: "2026-08-14T00:00:00.000Z",
              analysisVersion: 2,
            },
          ],
        },
      }],
    };
    const snapshot = createArchiveStateSnapshot({ importVisit: recommendationVisit, draftWorkspace });
    const sourceRecommendation = recommendationVisit.entries[0]?.analysisSuggestions?.recommendations?.[0];
    const persistedRecommendation = snapshot.importVisit?.entries[0]?.analysisSuggestions?.recommendations?.[0];

    if (!sourceRecommendation || !persistedRecommendation) {
      throw new Error("Expected v0.2 recommendation data");
    }

    sourceRecommendation.reasons[0] = "Changed after snapshot.";
    sourceRecommendation.evidence[0]!.detail = "Changed after snapshot.";

    expect(persistedRecommendation.reasons).toEqual(["Documents a seasonal change."]);
    expect(persistedRecommendation.evidence).toEqual([
      { signal: "seasonal-event", contribution: 0.52, detail: "Flowering border" },
    ]);

    await saveArchiveState(snapshot);
    const restored = await loadArchiveState();

    expect(restored?.importVisit?.entries[0]?.analysisSuggestions?.recommendations).toEqual([
      expect.objectContaining({
        kind: "story",
        score: 0.88,
        reasons: ["Documents a seasonal change."],
        evidence: [{ signal: "seasonal-event", contribution: 0.52, detail: "Flowering border" }],
      }),
    ]);
  });

  it("migrates legacy snapshots with oversized thumbnail payloads and preserves metadata while using fallback thumbnails", async () => {
    const largeThumbnail = `data:image/jpeg;base64,${"A".repeat(150_000)}`;
    const legacyVisit: Visit = {
      id: "visit-legacy-large",
      placeId: "place-legacy",
      date: "2026-06-15",
      weather: {
        temperature: 22,
        conditions: "Partly cloudy",
      },
      status: "Review in progress",
      imageCount: 2,
      importedImageFiles: ["legacy-01.jpg", "legacy-02.jpg"],
      entries: [
        {
          id: "entry-legacy-1",
          imageRecordId: "image-legacy-1",
          visitId: "visit-legacy-large",
          status: "new",
          notes: "North wall",
          tags: ["north", "sunlight"],
          observations: [
            {
              id: "obs-legacy-1",
              entryId: "entry-legacy-1",
              type: "change",
              confidence: 0.82,
              source: "user",
              value: "Growth visible",
              createdAt: "2026-06-15T09:00:00.000Z",
              reviewed: true,
              accepted: true,
            },
          ],
          favorite: true,
          hero: false,
          storySelected: true,
          reviewed: true,
          createdAt: "2026-06-15T09:00:00.000Z",
          updatedAt: "2026-06-15T09:05:00.000Z",
        },
        {
          id: "entry-legacy-2",
          imageRecordId: "image-legacy-2",
          visitId: "visit-legacy-large",
          status: "new",
          notes: "Path edge",
          tags: ["path"],
          observations: [],
          favorite: false,
          hero: true,
          storySelected: false,
          reviewed: false,
          createdAt: "2026-06-15T09:10:00.000Z",
          updatedAt: "2026-06-15T09:10:00.000Z",
        },
      ],
      imageRecords: [
        {
          id: "image-legacy-1",
          importBatchId: "batch-legacy-1",
          placeId: "house-wall",
          filename: "legacy-01.jpg",
          fileSize: 440123,
          format: "jpeg",
          sourcePath: "legacy/legacy-01.jpg",
          captureDate: "2026-06-15T09:00:00.000Z",
          width: 4032,
          height: 3024,
          aspectRatio: 1.3333,
          orientation: "landscape",
          mimeType: "image/jpeg",
          timelineIndex: 0,
          location: {
            latitude: 59.3293,
            longitude: 18.0686,
          },
          notes: "Legacy note 1",
          tags: ["wall", "flowerbed"],
          custom: {
            approved: true,
            score: 7,
          },
          thumbnailUrl: largeThumbnail,
        },
        {
          id: "image-legacy-2",
          importBatchId: "batch-legacy-1",
          placeId: "courtyard",
          filename: "legacy-02.jpg",
          fileSize: 550456,
          format: "jpeg",
          sourcePath: "legacy/legacy-02.jpg",
          captureDate: "2026-06-15T09:12:00.000Z",
          width: 3024,
          height: 4032,
          aspectRatio: 0.75,
          orientation: "portrait",
          mimeType: "image/jpeg",
          timelineIndex: 1,
          location: {
            latitude: 59.3295,
            longitude: 18.0682,
          },
          notes: "Legacy note 2",
          tags: ["path"],
          custom: {
            approved: false,
            score: 4,
          },
          thumbnailUrl: largeThumbnail,
        },
      ],
      importBatches: [
        {
          id: "batch-legacy-1",
          fileName: "legacy-large.zip",
          importedAt: "2026-06-15T10:00:00.000Z",
          imageCount: 2,
          sourceMetadata: {
            source: "legacy",
            note: "migration-test",
          },
        },
      ],
    };

    const legacyWorkspace: DraftWorkspace = {
      activeDraftId: "draft-legacy-1",
      drafts: [
        {
          id: "draft-legacy-1",
          label: "Legacy Draft",
          createdAt: "2026-06-15T10:05:00.000Z",
          savedAt: "2026-06-15T10:10:00.000Z",
          visit: legacyVisit,
          studioImages: [
            {
              id: 1,
              title: "legacy-01.jpg",
              collection: "Imported ZIP",
              date: "2026-06-15",
              tags: ["north"],
              favorite: true,
              hero: false,
              notes: "Legacy studio image",
              color: "linear-gradient(135deg, #6a7878, #d6d6c8)",
              src: largeThumbnail,
              alt: "legacy-01.jpg",
              storyRole: "Selected for Courtyard Story",
              season: "Imported",
              location: "House wall",
              mood: "",
              material: "",
              light: "",
              composition: "",
              importSource: "ZIP import (legacy-large.zip)",
            },
          ],
        },
      ],
    };

    window.localStorage.setItem(
      "blomzip-studio:archive-state:v1",
      JSON.stringify({
        savedAt: "2026-06-15T10:12:00.000Z",
        importVisit: legacyVisit,
        draftWorkspace: legacyWorkspace,
      })
    );

    await expect(loadArchiveState()).resolves.not.toBeNull();
    const restored = await loadArchiveState();

    expect(restored).toEqual(expect.objectContaining({
      schema: "blomzip.archive-state",
      schemaVersion: 2,
      savedAt: "2026-06-15T10:12:00.000Z",
    }));

    const expectedSanitizedRecords = legacyVisit.imageRecords?.map(({ thumbnailUrl: _thumbnailUrl, ...record }) => ({
      ...record,
    }));

    expect(restored?.importVisit).toEqual(expect.objectContaining({
      id: legacyVisit.id,
      placeId: legacyVisit.placeId,
      date: legacyVisit.date,
      weather: legacyVisit.weather,
      status: legacyVisit.status,
      imageCount: legacyVisit.imageCount,
      importedImageFiles: legacyVisit.importedImageFiles,
      entries: legacyVisit.entries,
      importBatches: legacyVisit.importBatches,
      imageRecords: expectedSanitizedRecords,
    }));

    expect(restored?.importVisit?.imageRecords?.every((record) => !record.thumbnailUrl)).toBe(true);

    expect(restored?.draftWorkspace).toEqual(expect.objectContaining({
      activeDraftId: "draft-legacy-1",
      drafts: [
        expect.objectContaining({
          id: "draft-legacy-1",
          label: "Legacy Draft",
          createdAt: "2026-06-15T10:05:00.000Z",
          savedAt: "2026-06-15T10:10:00.000Z",
          visit: expect.objectContaining({
            id: legacyVisit.id,
          }),
          studioImages: [],
        }),
      ],
    }));

    const regeneratedThumbnail = createThumbnailUrlForRecord(restored?.importVisit?.imageRecords?.[0]);
    expect(regeneratedThumbnail).toContain("data:image/svg+xml");
  });

  it("restores the newer archive snapshot from IndexedDB when localStorage still holds an older snapshot", async () => {
    const olderSnapshot = createArchiveStateSnapshot({
      importVisit: {
        ...visit,
        id: "visit-older",
        imageCount: 1,
        imageRecords: visit.imageRecords ? [visit.imageRecords[0]] : [],
        importBatches: [
          {
            id: "batch-older",
            fileName: "older.zip",
            importedAt: "2026-07-10T00:00:00.000Z",
            imageCount: 1,
          },
        ],
      },
      draftWorkspace: {
        drafts: [],
        activeDraftId: null,
      },
    });

    const newerSnapshot = createArchiveStateSnapshot({
      importVisit: {
        ...visit,
        id: "visit-newer",
        imageCount: 2,
        imageRecords: visit.imageRecords ? [
          ...visit.imageRecords,
          {
            ...visit.imageRecords[0],
            id: "image-2",
            filename: "garden-02.jpg",
            sourcePath: "garden/garden-02.jpg",
          },
        ] : [],
        importBatches: [
          {
            id: "batch-newer",
            fileName: "newer.zip",
            importedAt: "2026-07-11T00:00:00.000Z",
            imageCount: 2,
          },
        ],
      },
      draftWorkspace: {
        drafts: [],
        activeDraftId: null,
      },
    });

    window.localStorage.setItem("blomzip-studio:archive-state:v1", JSON.stringify(olderSnapshot));

    const storage = new Map<string, { key: string; snapshot: unknown }>();

    const fakeIndexedDB = {
      open: () => {
        const request = {
          result: undefined as unknown,
          onerror: null as ((event: Event) => void) | null,
          onsuccess: null as ((event: Event) => void) | null,
          onupgradeneeded: null as ((event: Event) => void) | null,
        };

        queueMicrotask(() => {
          request.result = {
            objectStoreNames: {
              contains: (name: string) => name === "archive-state",
            },
            transaction: () => {
              const transaction = {
                objectStore: () => ({
                  get: (key: string) => {
                    const readRequest = {
                      result: storage.get(key),
                      onerror: null as ((event: Event) => void) | null,
                      onsuccess: null as ((event: Event) => void) | null,
                    };

                    queueMicrotask(() => {
                      readRequest.onsuccess?.(new Event("success"));
                    });

                    return readRequest;
                  },
                  put: (value: { key: string; snapshot: unknown }) => {
                    storage.set(value.key, value);
                    queueMicrotask(() => {
                      transaction.oncomplete?.(new Event("complete"));
                    });

                    return {
                      onsuccess: null as ((event: Event) => void) | null,
                      onerror: null as ((event: Event) => void) | null,
                    };
                  },
                }),
                onerror: null as ((event: Event) => void) | null,
                oncomplete: null as ((event: Event) => void) | null,
              };

              return transaction;
            },
            close: () => undefined,
          };

          request.onsuccess?.(new Event("success"));
        });

        return request;
      },
    };

    vi.stubGlobal("indexedDB", fakeIndexedDB);
    vi.spyOn(Storage.prototype, "setItem").mockImplementation((key: string, value: string) => {
      if (key === "blomzip-studio:archive-state:v1") {
        throw new Error("localStorage unavailable");
      }

      return window.localStorage.setItem(key, value);
    });

    await saveArchiveState(newerSnapshot);

    const restored = await loadArchiveState();

    expect(restored).toEqual(expect.objectContaining({
      importVisit: expect.objectContaining({
        id: "visit-newer",
        imageCount: 2,
        importBatches: expect.arrayContaining([
          expect.objectContaining({ fileName: "newer.zip" }),
        ]),
      }),
    }));
  });

  it("strips large thumbnail payloads before persisting archive state", async () => {
    const originalSetItem = Storage.prototype.setItem;
    const largeThumbnail = `data:image/jpeg;base64,${"A".repeat(120_000)}`;
    const imageCount = 80;

    const largeVisit: Visit = {
      id: "visit-large",
      placeId: "place-large",
      date: "2026-08-01",
      imageCount,
      entries: Array.from({ length: imageCount }, (_, index) => ({
        id: `entry-${index}`,
        imageRecordId: `image-${index}`,
        visitId: "visit-large",
        status: "new",
        notes: "",
        tags: [],
        observations: [],
        reviewed: false,
        createdAt: "2026-08-01T00:00:00.000Z",
        updatedAt: "2026-08-01T00:00:00.000Z",
      })),
      imageRecords: Array.from({ length: imageCount }, (_, index) => ({
        id: `image-${index}`,
        importBatchId: "batch-large",
        filename: `photo-${index}.jpg`,
        fileSize: 1024 + index,
        format: "jpeg",
        sourcePath: `photo-${index}.jpg`,
        timelineIndex: index,
        thumbnailUrl: largeThumbnail,
      })),
      importBatches: [
        {
          id: "batch-large",
          fileName: "large.zip",
          importedAt: "2026-08-01T00:00:00.000Z",
          imageCount,
        },
      ],
    };

    const snapshot = createArchiveStateSnapshot({
      importVisit: largeVisit,
      draftWorkspace: {
        activeDraftId: null,
        drafts: [],
      },
    });

    vi.stubGlobal("indexedDB", undefined);
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(function mockedSetItem(this: Storage, key: string, value: string) {
      if (key === "blomzip-studio:archive-state:v1" && value.length > 200_000) {
        throw new Error("quota exceeded");
      }

      return originalSetItem.call(this, key, value);
    });

    await expect(saveArchiveState(snapshot)).resolves.toBeUndefined();

    const persisted = window.localStorage.getItem("blomzip-studio:archive-state:v1");
    expect(persisted).toBeTruthy();
    expect(persisted).not.toContain("data:image/jpeg;base64,");

    const parsed = persisted ? JSON.parse(persisted) as { importVisit?: Visit; draftWorkspace?: DraftWorkspace } : null;
    expect(parsed?.importVisit?.imageRecords?.every((record) => !record.thumbnailUrl)).toBe(true);
    expect(parsed?.draftWorkspace?.drafts.every((draft) => draft.studioImages.length === 0)).toBe(true);
  });
});
