const ARCHIVE_DATABASE_NAME = "blomzip-studio-archive";
const ARCHIVE_DATABASE_VERSION = 2;
const ARCHIVE_STATE_STORE_NAME = "archive-state";
const ARCHIVE_THUMBNAIL_STORE_NAME = "archive-thumbnails";

function ensureStore(database: IDBDatabase, storeName: string, options?: IDBObjectStoreParameters) {
  if (!database.objectStoreNames.contains(storeName)) {
    database.createObjectStore(storeName, options);
  }
}

export function openArchiveDatabase(): Promise<IDBDatabase> {
  if (typeof indexedDB === "undefined") {
    return Promise.reject(new Error("IndexedDB is unavailable"));
  }

  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(ARCHIVE_DATABASE_NAME, ARCHIVE_DATABASE_VERSION);

    request.onupgradeneeded = () => {
      const database = request.result;
      ensureStore(database, ARCHIVE_STATE_STORE_NAME, { keyPath: "key" });
      ensureStore(database, ARCHIVE_THUMBNAIL_STORE_NAME, { keyPath: "imageRecordId" });
    };

    request.onerror = () => {
      reject(request.error ?? new Error("Could not open archive database"));
    };

    request.onsuccess = () => {
      resolve(request.result);
    };
  });
}

export {
  ARCHIVE_DATABASE_NAME,
  ARCHIVE_DATABASE_VERSION,
  ARCHIVE_STATE_STORE_NAME,
  ARCHIVE_THUMBNAIL_STORE_NAME,
};
