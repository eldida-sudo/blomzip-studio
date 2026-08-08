/**
 * @vitest-environment jsdom
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { DraftWorkspace, Visit } from "../models/blomzip";
import { createArchiveStateSnapshot } from "./archivePersistence";
import {
  ARCHIVE_DATABASE_NAME,
  ARCHIVE_THUMBNAIL_STORE_NAME,
  openArchiveDatabase,
} from "./archiveIndexedDb";
import {
  hydrateArchiveStateThumbnails,
  persistArchiveThumbnailBinaries,
} from "./archiveThumbnailStore";

function createInMemoryIndexedDb() {
  const storeNames = new Set<string>();
  const stores = new Map<string, Map<string, unknown>>();

  const ensureStore = (storeName: string) => {
    if (!storeNames.has(storeName)) {
      storeNames.add(storeName);
      stores.set(storeName, new Map());
    }
  };

  const database = {
    objectStoreNames: {
      contains: (storeName: string) => storeNames.has(storeName),
    },
    createObjectStore: (storeName: string) => {
      ensureStore(storeName);
      return {} as IDBObjectStore;
    },
    transaction: (storeName: string) => {
      ensureStore(storeName);

      const transaction = {
        oncomplete: null as ((event: Event) => void) | null,
        onerror: null as ((event: Event) => void) | null,
        onabort: null as ((event: Event) => void) | null,
        objectStore: (targetStoreName: string) => {
          ensureStore(targetStoreName);
          const targetStore = stores.get(targetStoreName) as Map<string, unknown>;

          return {
            get: (key: string) => {
              const request = {
                result: targetStore.get(key),
                onsuccess: null as ((event: Event) => void) | null,
                onerror: null as ((event: Event) => void) | null,
              };

              queueMicrotask(() => {
                request.onsuccess?.(new Event("success"));
              });

              return request;
            },
            put: (value: { key?: string; imageRecordId?: string }) => {
              const key = value.key ?? value.imageRecordId;

              if (key) {
                targetStore.set(key, value);
              }

              const request = {
                onsuccess: null as ((event: Event) => void) | null,
                onerror: null as ((event: Event) => void) | null,
              };

              queueMicrotask(() => {
                request.onsuccess?.(new Event("success"));
                transaction.oncomplete?.(new Event("complete"));
              });

              return request;
            },
          };
        },
      };

      return transaction;
    },
    close: () => undefined,
  };

  return {
    open: (_name: string, _version?: number) => {
      const request = {
        result: undefined as unknown,
        onerror: null as ((event: Event) => void) | null,
        onsuccess: null as ((event: Event) => void) | null,
        onupgradeneeded: null as ((event: Event) => void) | null,
      };

      queueMicrotask(() => {
        request.result = database;
        request.onupgradeneeded?.(new Event("upgradeneeded"));
        request.onsuccess?.(new Event("success"));
      });

      return request;
    },
    deleteDatabase: (_name: string) => {
      const request = {
        onerror: null as ((event: Event) => void) | null,
        onsuccess: null as ((event: Event) => void) | null,
        onblocked: null as ((event: Event) => void) | null,
      };

      queueMicrotask(() => {
        storeNames.clear();
        stores.clear();
        request.onsuccess?.(new Event("success"));
      });

      return request;
    },
  };
}

const defaultWorkspace: DraftWorkspace = {
  drafts: [],
  activeDraftId: null,
};

function createVisitWithThumbnail(imageRecordId: string, thumbnailUrl: string): Visit {
  return {
    id: `visit-${imageRecordId}`,
    placeId: "place-1",
    date: "2026-08-08",
    entries: [
      {
        id: `entry-${imageRecordId}`,
        imageRecordId,
        visitId: `visit-${imageRecordId}`,
        status: "new",
        notes: "",
        tags: [],
        observations: [],
        reviewed: false,
        createdAt: "2026-08-08T00:00:00.000Z",
        updatedAt: "2026-08-08T00:00:00.000Z",
      },
    ],
    imageCount: 1,
    imageRecords: [
      {
        id: imageRecordId,
        importBatchId: "batch-1",
        filename: `${imageRecordId}.jpg`,
        fileSize: 10,
        format: "jpeg",
        sourcePath: `${imageRecordId}.jpg`,
        timelineIndex: 0,
        thumbnailUrl,
      },
    ],
    importBatches: [
      {
        id: "batch-1",
        fileName: "archive.zip",
        importedAt: "2026-08-08T00:00:00.000Z",
        imageCount: 1,
      },
    ],
    status: "Review in progress",
  };
}

describe("archiveThumbnailStore", () => {
  beforeEach(async () => {
    vi.restoreAllMocks();
    vi.stubGlobal("indexedDB", createInMemoryIndexedDb());

    await new Promise<void>((resolve) => {
      const request = indexedDB.deleteDatabase(ARCHIVE_DATABASE_NAME);
      request.onsuccess = () => resolve();
      request.onerror = () => resolve();
      request.onblocked = () => resolve();
    });
  });

  it("persists thumbnail binary data separately in IndexedDB", async () => {
    const visit = createVisitWithThumbnail(
      "image-binary-1",
      "data:image/gif;base64,R0lGODlhAQABAIAAAAUEBAAAACwAAAAAAQABAAACAkQBADs="
    );

    await persistArchiveThumbnailBinaries({
      importVisit: visit,
      draftWorkspace: defaultWorkspace,
    });

    const database = await openArchiveDatabase();

    try {
      const transaction = database.transaction(ARCHIVE_THUMBNAIL_STORE_NAME, "readonly");
      const store = transaction.objectStore(ARCHIVE_THUMBNAIL_STORE_NAME);
      const persisted = await new Promise<{ imageRecordId: string; thumbnailBlob: Blob } | undefined>((resolve, reject) => {
        const request = store.get("image-binary-1");
        request.onsuccess = () => resolve(request.result as { imageRecordId: string; thumbnailBlob: Blob } | undefined);
        request.onerror = () => reject(request.error);
      });

      expect(persisted?.imageRecordId).toBe("image-binary-1");
      expect(persisted?.thumbnailBlob).toBeInstanceOf(Blob);
      expect(persisted?.thumbnailBlob.size).toBeGreaterThan(0);
    } finally {
      database.close();
    }
  });

  it("hydrates metadata-only archive snapshots with runtime blob thumbnail URLs", async () => {
    const visit = createVisitWithThumbnail(
      "image-hydrate-1",
      "data:image/gif;base64,R0lGODlhAQABAIAAAAUEBAAAACwAAAAAAQABAAACAkQBADs="
    );

    await persistArchiveThumbnailBinaries({
      importVisit: visit,
      draftWorkspace: defaultWorkspace,
    });

    const snapshot = createArchiveStateSnapshot({
      importVisit: visit,
      draftWorkspace: defaultWorkspace,
    });

    const createObjectURL = vi.fn(() => "blob:restored-thumbnail");
    vi.stubGlobal("URL", {
      createObjectURL,
      revokeObjectURL: vi.fn(),
    } as unknown as typeof URL);

    const hydrated = await hydrateArchiveStateThumbnails(snapshot);

    expect(createObjectURL).toHaveBeenCalledTimes(1);
    expect(hydrated.objectUrls).toEqual(["blob:restored-thumbnail"]);
    expect(hydrated.value.importVisit?.imageRecords?.[0]?.thumbnailUrl).toBe("blob:restored-thumbnail");
  });
});
