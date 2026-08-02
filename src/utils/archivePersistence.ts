import type { DraftWorkspace, Visit } from "../models/blomzip";

const ARCHIVE_STORAGE_KEY = "blomzip-studio:archive-state:v1";
const ARCHIVE_SCHEMA = "blomzip.archive-state";
const ARCHIVE_SCHEMA_VERSION = 1;

export interface ArchiveState {
  schema: typeof ARCHIVE_SCHEMA;
  schemaVersion: typeof ARCHIVE_SCHEMA_VERSION;
  savedAt: string;
  importVisit: Visit | null;
  draftWorkspace: DraftWorkspace;
}

function cloneValue<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function isDraftWorkspace(value: unknown): value is DraftWorkspace {
  if (!value || typeof value !== "object") {
    return false;
  }

  const workspace = value as DraftWorkspace;
  return Array.isArray(workspace.drafts) && (typeof workspace.activeDraftId === "string" || workspace.activeDraftId === null);
}

function sanitizeArchiveState(state: ArchiveState): ArchiveState {
  return {
    schema: ARCHIVE_SCHEMA,
    schemaVersion: ARCHIVE_SCHEMA_VERSION,
    savedAt: typeof state.savedAt === "string" ? state.savedAt : new Date().toISOString(),
    importVisit: state.importVisit ? cloneValue(state.importVisit) : null,
    draftWorkspace: cloneValue(state.draftWorkspace),
  };
}

function getArchiveStateTimestamp(snapshot: ArchiveState | null): number {
  if (!snapshot) {
    return Number.NEGATIVE_INFINITY;
  }

  const parsed = Date.parse(snapshot.savedAt);
  return Number.isNaN(parsed) ? Number.NEGATIVE_INFINITY : parsed;
}

function chooseNewestArchiveState(localSnapshot: ArchiveState | null, indexedDbSnapshot: ArchiveState | null): ArchiveState | null {
  if (!localSnapshot) {
    return indexedDbSnapshot;
  }

  if (!indexedDbSnapshot) {
    return localSnapshot;
  }

  return getArchiveStateTimestamp(indexedDbSnapshot) >= getArchiveStateTimestamp(localSnapshot)
    ? indexedDbSnapshot
    : localSnapshot;
}

function migrateArchiveState(value: unknown): ArchiveState | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const raw = value as Partial<ArchiveState> & { visit?: Visit; workspace?: DraftWorkspace };

  if (raw.schema === ARCHIVE_SCHEMA && raw.schemaVersion === ARCHIVE_SCHEMA_VERSION) {
    if (!isDraftWorkspace(raw.draftWorkspace)) {
      return null;
    }

    return sanitizeArchiveState({
      schema: ARCHIVE_SCHEMA,
      schemaVersion: ARCHIVE_SCHEMA_VERSION,
      savedAt: typeof raw.savedAt === "string" ? raw.savedAt : new Date().toISOString(),
      importVisit: raw.importVisit ?? null,
      draftWorkspace: raw.draftWorkspace,
    });
  }

  const legacyVisit = (raw as { visit?: Visit }).visit ?? raw.importVisit ?? null;
  const legacyWorkspace = (raw as { workspace?: DraftWorkspace }).workspace ?? raw.draftWorkspace ?? null;

  if (!isDraftWorkspace(legacyWorkspace)) {
    return null;
  }

  return sanitizeArchiveState({
    schema: ARCHIVE_SCHEMA,
    schemaVersion: ARCHIVE_SCHEMA_VERSION,
    savedAt: typeof raw.savedAt === "string" ? raw.savedAt : new Date().toISOString(),
    importVisit: legacyVisit,
    draftWorkspace: legacyWorkspace,
  });
}

async function loadFromIndexedDB(): Promise<ArchiveState | null> {
  if (typeof indexedDB === "undefined") {
    return null;
  }

  return new Promise<ArchiveState | null>((resolve) => {
    const request = indexedDB.open("blomzip-studio-archive", ARCHIVE_SCHEMA_VERSION);

    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains("archive-state")) {
        database.createObjectStore("archive-state", { keyPath: "key" });
      }
    };

    request.onerror = () => {
      resolve(null);
    };

    request.onsuccess = () => {
      const database = request.result;
      const transaction = database.transaction("archive-state", "readonly");
      const store = transaction.objectStore("archive-state");
      const readRequest = store.get("current");

      readRequest.onerror = () => {
        database.close();
        resolve(null);
      };

      readRequest.onsuccess = () => {
        database.close();
        resolve(migrateArchiveState(readRequest.result?.snapshot ?? readRequest.result));
      };
    };
  });
}

async function saveToIndexedDB(snapshot: ArchiveState): Promise<void> {
  if (typeof indexedDB === "undefined") {
    return;
  }

  return new Promise<void>((resolve, reject) => {
    const request = indexedDB.open("blomzip-studio-archive", ARCHIVE_SCHEMA_VERSION);

    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains("archive-state")) {
        database.createObjectStore("archive-state", { keyPath: "key" });
      }
    };

    request.onerror = () => {
      reject(request.error ?? new Error("Could not open archive storage"));
    };

    request.onsuccess = () => {
      const database = request.result;
      const transaction = database.transaction("archive-state", "readwrite");
      const store = transaction.objectStore("archive-state");
      store.put({ key: "current", snapshot: sanitizeArchiveState(snapshot) });

      transaction.onerror = () => {
        database.close();
        reject(transaction.error ?? new Error("Could not save archive storage"));
      };

      transaction.oncomplete = () => {
        database.close();
        resolve();
      };
    };
  });
}

function loadFromLocalStorage(): ArchiveState | null {
  if (typeof window === "undefined") {
    return null;
  }

  const serialized = window.localStorage.getItem(ARCHIVE_STORAGE_KEY);
  if (!serialized) {
    return null;
  }

  try {
    return migrateArchiveState(JSON.parse(serialized));
  } catch {
    return null;
  }
}

function saveToLocalStorage(snapshot: ArchiveState): void {
  if (typeof window === "undefined") {
    return;
  }

  window.localStorage.setItem(ARCHIVE_STORAGE_KEY, JSON.stringify(sanitizeArchiveState(snapshot)));
}

export async function loadArchiveState(): Promise<ArchiveState | null> {
  const localStorageSnapshot = loadFromLocalStorage();
  const indexedDbSnapshot = await loadFromIndexedDB();

  return chooseNewestArchiveState(localStorageSnapshot, indexedDbSnapshot);
}

export async function saveArchiveState(snapshot: ArchiveState): Promise<void> {
  const sanitizedSnapshot = sanitizeArchiveState(snapshot);

  try {
    await saveToIndexedDB(sanitizedSnapshot);

    try {
      saveToLocalStorage(sanitizedSnapshot);
    } catch {
      // IndexedDB persisted the canonical snapshot; localStorage is a secondary mirror.
    }

    return;
  } catch (indexedDbError) {
    try {
      saveToLocalStorage(sanitizedSnapshot);
      return;
    } catch (localStorageError) {
      throw indexedDbError instanceof Error
        ? indexedDbError
        : new Error("Could not persist archive state to any storage backend");
    }
  }
}

export function createArchiveStateSnapshot(options: {
  importVisit: Visit | null;
  draftWorkspace: DraftWorkspace;
}): ArchiveState {
  return sanitizeArchiveState({
    schema: ARCHIVE_SCHEMA,
    schemaVersion: ARCHIVE_SCHEMA_VERSION,
    savedAt: new Date().toISOString(),
    importVisit: options.importVisit,
    draftWorkspace: options.draftWorkspace,
  });
}

export function archiveStateHasContent(snapshot: ArchiveState): boolean {
  return Boolean(snapshot.importVisit || snapshot.draftWorkspace.drafts.length > 0);
}
