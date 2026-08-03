/**
 * @vitest-environment jsdom
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { DraftWorkspace, Visit } from "../models/blomzip";
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
      schemaVersion: 1,
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
            thumbnailUrl: expect.stringContaining("data:image/jpeg;base64,"),
          }),
        ]),
      }),
      draftWorkspace: expect.objectContaining({
        activeDraftId: "draft-1",
        drafts: expect.arrayContaining([
          expect.objectContaining({
            id: "draft-1",
            visit: expect.objectContaining({ id: visit.id }),
          }),
        ]),
      }),
    }));
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
      schemaVersion: 1,
      importVisit: expect.objectContaining({ id: visit.id }),
    }));
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
});
