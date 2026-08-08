import type { DraftWorkspace, ImageRecord, Visit } from "../models/blomzip";
import type { ArchiveState } from "./archivePersistence";
import {
  ARCHIVE_THUMBNAIL_STORE_NAME,
  openArchiveDatabase,
} from "./archiveIndexedDb";

interface StoredThumbnailRecord {
  imageRecordId: string;
  thumbnailBlob: Blob;
  savedAt: string;
}

declare global {
  interface Window {
    __BLOMZIP_DEBUG_THUMBNAILS__?: boolean;
  }
}

interface ThumbnailHydrationResult<T> {
  value: T;
  objectUrls: string[];
}

function isRuntimeThumbnailUrl(value: string | undefined): value is string {
  if (!value) {
    return false;
  }

  if (value.startsWith("data:image/svg+xml")) {
    return false;
  }

  return value.startsWith("data:") || value.startsWith("blob:");
}

function isThumbnailDebugEnabled(): boolean {
  if (typeof window === "undefined") {
    return false;
  }

  return Boolean(import.meta.env?.DEV && window.__BLOMZIP_DEBUG_THUMBNAILS__);
}

function thumbnailDebug(event: string, details: Record<string, unknown>) {
  if (!isThumbnailDebugEnabled()) {
    return;
  }

  console.debug("[blomzip-thumbnails]", event, details);
}

async function thumbnailUrlToBlob(thumbnailUrl: string): Promise<Blob | null> {
  if (thumbnailUrl.startsWith("data:")) {
    try {
      const [header, payload] = thumbnailUrl.split(",", 2);
      if (!header || !payload) {
        return null;
      }

      const mimeType = header.slice(5).split(";")[0] || "application/octet-stream";
      const isBase64 = header.includes(";base64");

      if (isBase64) {
        const binary = atob(payload);
        const bytes = new Uint8Array(binary.length);

        for (let index = 0; index < binary.length; index += 1) {
          bytes[index] = binary.charCodeAt(index);
        }

        return new Blob([bytes], { type: mimeType });
      }

      return new Blob([decodeURIComponent(payload)], { type: mimeType });
    } catch {
      return null;
    }
  }

  try {
    const response = await fetch(thumbnailUrl);
    if (!response.ok) {
      return null;
    }

    return await response.blob();
  } catch {
    return null;
  }
}

function requestToPromise<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    request.onsuccess = () => {
      resolve(request.result);
    };

    request.onerror = () => {
      reject(request.error ?? new Error("IndexedDB request failed"));
    };
  });
}

function collectRecordsById(visit: Visit | null, recordMap: Map<string, ImageRecord>) {
  if (!visit?.imageRecords) {
    return;
  }

  for (const record of visit.imageRecords) {
    if (!recordMap.has(record.id)) {
      recordMap.set(record.id, record);
    }
  }
}

function collectArchiveImageRecords(options: {
  importVisit: Visit | null;
  draftWorkspace: DraftWorkspace;
}): ImageRecord[] {
  const recordMap = new Map<string, ImageRecord>();

  collectRecordsById(options.importVisit, recordMap);

  for (const draft of options.draftWorkspace.drafts) {
    collectRecordsById(draft.visit, recordMap);
  }

  return Array.from(recordMap.values());
}

export async function persistArchiveThumbnailBinaries(options: {
  importVisit: Visit | null;
  draftWorkspace: DraftWorkspace;
}): Promise<void> {
  if (typeof indexedDB === "undefined") {
    thumbnailDebug("persist-skipped", { reason: "indexeddb-unavailable" });
    return;
  }

  const records = collectArchiveImageRecords(options).filter((record) => isRuntimeThumbnailUrl(record.thumbnailUrl));
  if (records.length === 0) {
    thumbnailDebug("persist-skipped", { reason: "no-runtime-thumbnails" });
    return;
  }

  thumbnailDebug("persist-start", {
    candidateRecordCount: records.length,
    imageRecordIds: records.map((record) => record.id),
    urlTypes: records.map((record) => (record.thumbnailUrl?.startsWith("blob:") ? "blob" : "data")),
  });

  const recordsWithBlobs = await Promise.all(
    records.map(async (record) => {
      if (!record.thumbnailUrl) {
        return null;
      }

      const thumbnailBlob = await thumbnailUrlToBlob(record.thumbnailUrl);
      if (!thumbnailBlob) {
        thumbnailDebug("persist-conversion-failed", {
          imageRecordId: record.id,
          thumbnailPrefix: record.thumbnailUrl.slice(0, 24),
        });
        return null;
      }

      return {
        imageRecordId: record.id,
        thumbnailBlob,
      };
    })
  );

  const writableRecords = recordsWithBlobs.filter((record): record is { imageRecordId: string; thumbnailBlob: Blob } => Boolean(record));
  if (writableRecords.length === 0) {
    thumbnailDebug("persist-skipped", { reason: "no-convertible-thumbnails" });
    return;
  }

  const database = await openArchiveDatabase();

  try {
    const transaction = database.transaction(ARCHIVE_THUMBNAIL_STORE_NAME, "readwrite");
    const store = transaction.objectStore(ARCHIVE_THUMBNAIL_STORE_NAME);

    for (const record of writableRecords) {
      store.put({
        imageRecordId: record.imageRecordId,
        thumbnailBlob: record.thumbnailBlob,
        savedAt: new Date().toISOString(),
      } satisfies StoredThumbnailRecord);
    }

    await new Promise<void>((resolve, reject) => {
      transaction.oncomplete = () => {
        resolve();
      };

      transaction.onerror = () => {
        reject(transaction.error ?? new Error("Could not persist thumbnail binaries"));
      };

      transaction.onabort = () => {
        reject(transaction.error ?? new Error("Thumbnail transaction aborted"));
      };
    });

    thumbnailDebug("persist-success", {
      storedCount: writableRecords.length,
      imageRecordIds: writableRecords.map((record) => record.imageRecordId),
    });
  } finally {
    database.close();
  }
}

async function hydrateVisitThumbnails(
  visit: Visit | null,
  store: IDBObjectStore
): Promise<ThumbnailHydrationResult<Visit | null>> {
  if (!visit?.imageRecords || visit.imageRecords.length === 0) {
    return { value: visit, objectUrls: [] };
  }

  const objectUrls: string[] = [];

  const imageRecords = await Promise.all(
    visit.imageRecords.map(async (record) => {
      if (record.thumbnailUrl) {
        return record;
      }

      const storedRecord = await requestToPromise(store.get(record.id) as IDBRequest<StoredThumbnailRecord | undefined>);
      if (!storedRecord?.thumbnailBlob) {
        thumbnailDebug("hydrate-miss", { imageRecordId: record.id });
        return record;
      }

      const objectUrl = URL.createObjectURL(storedRecord.thumbnailBlob);
      objectUrls.push(objectUrl);

      thumbnailDebug("hydrate-hit", {
        imageRecordId: record.id,
        objectUrl,
        blobSize: storedRecord.thumbnailBlob.size,
      });

      return {
        ...record,
        thumbnailUrl: objectUrl,
      };
    })
  );

  return {
    value: {
      ...visit,
      imageRecords,
    },
    objectUrls,
  };
}

async function hydrateDraftWorkspaceThumbnails(
  workspace: DraftWorkspace,
  store: IDBObjectStore
): Promise<ThumbnailHydrationResult<DraftWorkspace>> {
  const objectUrls: string[] = [];

  const drafts = await Promise.all(
    workspace.drafts.map(async (draft) => {
      const hydratedVisit = await hydrateVisitThumbnails(draft.visit, store);
      objectUrls.push(...hydratedVisit.objectUrls);

      return {
        ...draft,
        visit: hydratedVisit.value ?? draft.visit,
      };
    })
  );

  return {
    value: {
      ...workspace,
      drafts,
    },
    objectUrls,
  };
}

export async function hydrateArchiveStateThumbnails(snapshot: ArchiveState): Promise<ThumbnailHydrationResult<ArchiveState>> {
  if (typeof indexedDB === "undefined") {
    thumbnailDebug("hydrate-skipped", { reason: "indexeddb-unavailable" });
    return {
      value: snapshot,
      objectUrls: [],
    };
  }

  thumbnailDebug("hydrate-start", {
    importImageRecordCount: snapshot.importVisit?.imageRecords?.length ?? 0,
    draftCount: snapshot.draftWorkspace.drafts.length,
  });

  const database = await openArchiveDatabase();

  try {
    const transaction = database.transaction(ARCHIVE_THUMBNAIL_STORE_NAME, "readonly");
    const store = transaction.objectStore(ARCHIVE_THUMBNAIL_STORE_NAME);

    const importVisitResult = await hydrateVisitThumbnails(snapshot.importVisit, store);
    const draftWorkspaceResult = await hydrateDraftWorkspaceThumbnails(snapshot.draftWorkspace, store);

    return {
      value: {
        ...snapshot,
        importVisit: importVisitResult.value,
        draftWorkspace: draftWorkspaceResult.value,
      },
      objectUrls: [...importVisitResult.objectUrls, ...draftWorkspaceResult.objectUrls],
    };
  } finally {
    database.close();
  }
}

export function collectBlobThumbnailUrlsFromVisit(visit: Visit | null): string[] {
  if (!visit?.imageRecords) {
    return [];
  }

  return visit.imageRecords
    .map((record) => record.thumbnailUrl)
    .filter((thumbnailUrl): thumbnailUrl is string => Boolean(thumbnailUrl?.startsWith("blob:")));
}
