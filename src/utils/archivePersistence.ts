import type { DraftWorkspace, Entry, ImageRecord, Observation, Visit } from "../models/blomzip";
import { ARCHIVE_STATE_STORE_NAME, openArchiveDatabase } from "./archiveIndexedDb";

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

function sanitizeObservationForPersistence(observation: Observation): Observation {
  return {
    ...observation,
  };
}

function sanitizeEntryForPersistence(entry: Entry): Entry {
  return {
    ...entry,
    tags: [...entry.tags],
    observations: entry.observations.map((observation) => sanitizeObservationForPersistence(observation)),
    analysisSuggestions: entry.analysisSuggestions
      ? {
          ...entry.analysisSuggestions,
          categories: [...entry.analysisSuggestions.categories],
          possibleDuplicateEntryIds: entry.analysisSuggestions.possibleDuplicateEntryIds
            ? [...entry.analysisSuggestions.possibleDuplicateEntryIds]
            : undefined,
        }
      : undefined,
  };
}

function sanitizeImageRecordForPersistence(record: ImageRecord): ImageRecord {
  const { thumbnailUrl: _thumbnailUrl, ...recordWithoutThumbnail } = record;

  return {
    ...recordWithoutThumbnail,
    location: record.location ? { ...record.location } : undefined,
    tags: record.tags ? [...record.tags] : undefined,
    custom: record.custom ? { ...record.custom } : undefined,
  };
}

function sanitizeVisitForPersistence(visit: Visit): Visit {
  return {
    ...visit,
    entries: visit.entries.map((entry) => sanitizeEntryForPersistence(entry)),
    importedImageFiles: visit.importedImageFiles ? [...visit.importedImageFiles] : undefined,
    imageRecords: visit.imageRecords?.map((record) => sanitizeImageRecordForPersistence(record)),
    importBatches: visit.importBatches?.map((batch) => ({
      ...batch,
      sourceMetadata: batch.sourceMetadata ? { ...batch.sourceMetadata } : undefined,
    })),
  };
}

function sanitizeDraftWorkspaceForArchivePersistence(workspace: DraftWorkspace): DraftWorkspace {
  return {
    activeDraftId: typeof workspace.activeDraftId === "string" ? workspace.activeDraftId : null,
    drafts: workspace.drafts.map((draft) => ({
      ...draft,
      visit: sanitizeVisitForPersistence(draft.visit),
      // Draft gallery cards are reconstructable from draft visit metadata.
      studioImages: [],
    })),
  };
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
    importVisit: state.importVisit ? sanitizeVisitForPersistence(state.importVisit) : null,
    draftWorkspace: sanitizeDraftWorkspaceForArchivePersistence(state.draftWorkspace),
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

  try {
    const database = await openArchiveDatabase();

    try {
      const transaction = database.transaction(ARCHIVE_STATE_STORE_NAME, "readonly");
      const store = transaction.objectStore(ARCHIVE_STATE_STORE_NAME);

      const record = await new Promise<{ snapshot?: unknown } | undefined>((resolve, reject) => {
        const readRequest = store.get("current");

        readRequest.onerror = () => {
          reject(readRequest.error ?? new Error("Could not read archive state"));
        };

        readRequest.onsuccess = () => {
          resolve(readRequest.result as { snapshot?: unknown } | undefined);
        };
      });

      return migrateArchiveState(record?.snapshot ?? record);
    } finally {
      database.close();
    }
  } catch {
    return null;
  }
}

async function saveToIndexedDB(snapshot: ArchiveState): Promise<void> {
  if (typeof indexedDB === "undefined") {
    return;
  }

  const database = await openArchiveDatabase();

  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction(ARCHIVE_STATE_STORE_NAME, "readwrite");
      const store = transaction.objectStore(ARCHIVE_STATE_STORE_NAME);
      store.put({ key: "current", snapshot: sanitizeArchiveState(snapshot) });

      transaction.onerror = () => {
        reject(transaction.error ?? new Error("Could not save archive storage"));
      };

      transaction.onabort = () => {
        reject(transaction.error ?? new Error("Could not save archive storage"));
      };

      transaction.oncomplete = () => {
        resolve();
      };
    });
  } finally {
    database.close();
  }
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
