import type {
  DraftWorkspace,
  Entry,
  EntryRecommendation,
  ImageRecord,
  Observation,
  PlaceMatchResult,
  PlaceTrainingState,
  PlaceVisualAnchor,
  VisualAnalysisResult,
  Visit,
} from "../models/blomzip";
import { ARCHIVE_STATE_STORE_NAME, openArchiveDatabase } from "./archiveIndexedDb";

const ARCHIVE_STORAGE_KEY = "blomzip-studio:archive-state:v1";
const ARCHIVE_SCHEMA = "blomzip.archive-state";
const ARCHIVE_SCHEMA_VERSION = 3;
const PREVIOUS_ARCHIVE_SCHEMA_VERSION = 2;
const LEGACY_ARCHIVE_SCHEMA_VERSION = 1;

export interface ArchiveState {
  schema: typeof ARCHIVE_SCHEMA;
  schemaVersion: typeof ARCHIVE_SCHEMA_VERSION;
  savedAt: string;
  importVisit: Visit | null;
  draftWorkspace: DraftWorkspace;
  // Metadata only: anchor image bytes live in their own IndexedDB store.
  placeTraining: PlaceTrainingState;
}

function sanitizePlaceTraining(value: unknown): PlaceTrainingState {
  const empty: PlaceTrainingState = { anchorsByPlaceId: {}, matchResults: [] };

  if (!isRecord(value)) {
    return empty;
  }

  const anchorsByPlaceId: Record<string, PlaceVisualAnchor[]> = {};

  if (isRecord(value.anchorsByPlaceId)) {
    for (const [placeId, anchors] of Object.entries(value.anchorsByPlaceId)) {
      if (!Array.isArray(anchors)) {
        continue;
      }

      const valid = anchors
        .filter(
          (anchor): anchor is PlaceVisualAnchor =>
            isRecord(anchor) && typeof anchor.id === "string" && typeof anchor.filename === "string"
        )
        .map((anchor) => ({ ...anchor, placeId }));

      if (valid.length > 0) {
        anchorsByPlaceId[placeId] = valid;
      }
    }
  }

  const matchResults = Array.isArray(value.matchResults)
    ? value.matchResults
        .filter(
          (result): result is PlaceMatchResult =>
            isRecord(result) &&
            typeof result.id === "string" &&
            typeof result.placeId === "string" &&
            typeof result.imageRecordId === "string" &&
            typeof result.score === "number" &&
            (result.status === "pending" || result.status === "approved" || result.status === "rejected")
        )
        .map((result) => ({ ...result }))
    : [];

  return { anchorsByPlaceId, matchResults };
}

function sanitizeObservationForPersistence(observation: Observation): Observation {
  return {
    ...observation,
  };
}

function sanitizeRecommendationForPersistence(recommendation: EntryRecommendation): EntryRecommendation {
  return {
    ...recommendation,
    reasons: [...recommendation.reasons],
    evidence: recommendation.evidence.map((evidence) => ({ ...evidence })),
  };
}

function sanitizeVisualAnalysisForPersistence(visualAnalysis: VisualAnalysisResult): VisualAnalysisResult {
  return {
    ...visualAnalysis,
    signals: visualAnalysis.signals.map((signal) => ({ ...signal })),
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
          recommendations: entry.analysisSuggestions.recommendations
            ? entry.analysisSuggestions.recommendations.map((recommendation) => sanitizeRecommendationForPersistence(recommendation))
            : undefined,
        }
      : undefined,
    visualAnalysis: entry.visualAnalysis ? sanitizeVisualAnalysisForPersistence(entry.visualAnalysis) : undefined,
    privacyStatus: entry.privacyStatus,
  };
}

function sanitizeImageRecordForPersistence(record: ImageRecord): ImageRecord {
  const { thumbnailUrl: _thumbnailUrl, ...recordWithoutThumbnail } = record;

  return {
    ...recordWithoutThumbnail,
    contentHash: record.contentHash,
    additionalOccurrences: record.additionalOccurrences
      ? record.additionalOccurrences.map((occurrence) => ({ ...occurrence }))
      : undefined,
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
      rawImageCount: batch.rawImageCount,
      importedImageCount: batch.importedImageCount,
      duplicateSkippedCount: batch.duplicateSkippedCount,
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
    placeTraining: sanitizePlaceTraining(state.placeTraining),
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

function createEmptyTraining(): PlaceTrainingState {
  return { anchorsByPlaceId: {}, matchResults: [] };
}

function migrateArchiveState(value: unknown): ArchiveState | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const raw = value as Partial<ArchiveState> & { visit?: Visit; workspace?: DraftWorkspace };

  if (
    raw.schema === ARCHIVE_SCHEMA &&
    (raw.schemaVersion === ARCHIVE_SCHEMA_VERSION ||
      raw.schemaVersion === PREVIOUS_ARCHIVE_SCHEMA_VERSION ||
      raw.schemaVersion === LEGACY_ARCHIVE_SCHEMA_VERSION)
  ) {
    if (!isDraftWorkspace(raw.draftWorkspace)) {
      return null;
    }

    return sanitizeArchiveState({
      schema: ARCHIVE_SCHEMA,
      schemaVersion: ARCHIVE_SCHEMA_VERSION,
      savedAt: typeof raw.savedAt === "string" ? raw.savedAt : new Date().toISOString(),
      importVisit: raw.importVisit ?? null,
      draftWorkspace: raw.draftWorkspace,
      placeTraining: raw.placeTraining ?? createEmptyTraining(),
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
    placeTraining: createEmptyTraining(),
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

  // localStorage is written synchronously, first, so a reload/unmount that interrupts
  // the slower asynchronous IndexedDB write still finds this save on the next load.
  let localStorageWriteFailed = false;
  try {
    saveToLocalStorage(sanitizedSnapshot);
  } catch {
    localStorageWriteFailed = true;
  }

  try {
    await saveToIndexedDB(sanitizedSnapshot);
  } catch (indexedDbError) {
    if (localStorageWriteFailed) {
      throw indexedDbError instanceof Error
        ? indexedDbError
        : new Error("Could not persist archive state to any storage backend");
    }
    // localStorage already holds the snapshot; IndexedDB is the secondary durable copy.
  }
}

export function createArchiveStateSnapshot(options: {
  importVisit: Visit | null;
  draftWorkspace: DraftWorkspace;
  placeTraining?: PlaceTrainingState;
}): ArchiveState {
  return sanitizeArchiveState({
    schema: ARCHIVE_SCHEMA,
    schemaVersion: ARCHIVE_SCHEMA_VERSION,
    savedAt: new Date().toISOString(),
    importVisit: options.importVisit,
    draftWorkspace: options.draftWorkspace,
    placeTraining: options.placeTraining ?? createEmptyTraining(),
  });
}

export function archiveStateHasContent(snapshot: ArchiveState): boolean {
  return Boolean(
    snapshot.importVisit ||
      snapshot.draftWorkspace.drafts.length > 0 ||
      Object.keys(snapshot.placeTraining.anchorsByPlaceId).length > 0
  );
}

export interface ArchiveStateCounts {
  photographs: number;
  entries: number;
  storySelected: number;
  drafts: number;
}

export function getArchiveStateCounts(state: ArchiveState): ArchiveStateCounts {
  const visit = state.importVisit;

  return {
    photographs: visit?.imageRecords?.length ?? visit?.entries.length ?? 0,
    entries: visit?.entries.length ?? 0,
    storySelected: visit?.entries.filter((entry) => entry.storySelected).length ?? 0,
    drafts: state.draftWorkspace.drafts.length,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isValidVisitShape(value: unknown): boolean {
  if (!isRecord(value) || !Array.isArray(value.entries)) {
    return false;
  }

  if (value.imageRecords !== undefined && !Array.isArray(value.imageRecords)) {
    return false;
  }

  const entriesAreValid = value.entries.every(
    (entry) => isRecord(entry) && typeof entry.id === "string" && typeof entry.imageRecordId === "string" && Array.isArray(entry.tags) && Array.isArray(entry.observations)
  );
  const recordsAreValid = (value.imageRecords as unknown[] | undefined)?.every(
    (record) => isRecord(record) && typeof record.id === "string" && typeof record.filename === "string"
  ) ?? true;

  return entriesAreValid && recordsAreValid;
}

export type ArchiveBackupParseResult =
  | { ok: true; state: ArchiveState }
  | { ok: false; error: string };

/** Validates an untrusted archive state (backup file or stored snapshot) without touching any stored data. */
export function validateArchiveBackup(value: unknown): ArchiveBackupParseResult {
  if (!isRecord(value) || value.schema !== ARCHIVE_SCHEMA) {
    return { ok: false, error: "This file is not a Blomzip archive backup." };
  }

  if (value.schemaVersion !== ARCHIVE_SCHEMA_VERSION &&
    value.schemaVersion !== PREVIOUS_ARCHIVE_SCHEMA_VERSION &&
    value.schemaVersion !== LEGACY_ARCHIVE_SCHEMA_VERSION) {
    return { ok: false, error: "This backup was made with an unsupported version of Studio." };
  }

  if (value.importVisit !== null && value.importVisit !== undefined && !isValidVisitShape(value.importVisit)) {
    return { ok: false, error: "The backup's archive data is damaged or incomplete." };
  }

  if (!isDraftWorkspace(value.draftWorkspace) || !value.draftWorkspace.drafts.every((draft) => isRecord(draft) && isValidVisitShape(draft.visit))) {
    return { ok: false, error: "The backup's draft data is damaged or incomplete." };
  }

  let state: ArchiveState | null;
  try {
    state = migrateArchiveState(value);
  } catch {
    state = null;
  }

  if (!state) {
    return { ok: false, error: "The backup could not be read." };
  }

  if (!archiveStateHasContent(state)) {
    return { ok: false, error: "The backup contains no archive data, so restoring it would only empty Studio." };
  }

  return { ok: true, state };
}

export function parseArchiveBackup(text: string): ArchiveBackupParseResult {
  try {
    return validateArchiveBackup(JSON.parse(text));
  } catch {
    return { ok: false, error: "The selected file is not valid JSON." };
  }
}

const SAFETY_SNAPSHOT_RECORD_KEY = "safety-snapshots";
export const MAX_SAFETY_SNAPSHOTS = 5;

interface StoredSafetySnapshot {
  id: string;
  createdAt: string;
  reason: string;
  snapshot: ArchiveState;
}

export interface SafetySnapshotSummary {
  id: string;
  createdAt: string;
  reason: string;
  counts: ArchiveStateCounts;
}

function summarizeSafetySnapshot(stored: StoredSafetySnapshot): SafetySnapshotSummary {
  return {
    id: stored.id,
    createdAt: stored.createdAt,
    reason: stored.reason,
    counts: getArchiveStateCounts(stored.snapshot),
  };
}

function isStoredSafetySnapshot(value: unknown): value is StoredSafetySnapshot {
  return isRecord(value) && typeof value.id === "string" && typeof value.createdAt === "string" && typeof value.reason === "string" && isRecord(value.snapshot);
}

// All snapshots live in one record so the list is read and trimmed atomically.
async function readStoredSafetySnapshots(): Promise<StoredSafetySnapshot[]> {
  const database = await openArchiveDatabase();

  try {
    const record = await new Promise<{ snapshots?: unknown } | undefined>((resolve, reject) => {
      const store = database.transaction(ARCHIVE_STATE_STORE_NAME, "readonly").objectStore(ARCHIVE_STATE_STORE_NAME);
      const readRequest = store.get(SAFETY_SNAPSHOT_RECORD_KEY);

      readRequest.onerror = () => reject(readRequest.error ?? new Error("Could not read safety snapshots"));
      readRequest.onsuccess = () => resolve(readRequest.result as { snapshots?: unknown } | undefined);
    });

    return Array.isArray(record?.snapshots) ? record.snapshots.filter(isStoredSafetySnapshot) : [];
  } finally {
    database.close();
  }
}

async function writeStoredSafetySnapshots(snapshots: StoredSafetySnapshot[]): Promise<void> {
  const database = await openArchiveDatabase();

  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction(ARCHIVE_STATE_STORE_NAME, "readwrite");
      transaction.objectStore(ARCHIVE_STATE_STORE_NAME).put({ key: SAFETY_SNAPSHOT_RECORD_KEY, snapshots });

      transaction.onerror = () => reject(transaction.error ?? new Error("Could not save safety snapshot"));
      transaction.onabort = () => reject(transaction.error ?? new Error("Could not save safety snapshot"));
      transaction.oncomplete = () => resolve();
    });
  } finally {
    database.close();
  }
}

/** Stores a recoverable copy of the given state; rejects if it could not be durably written. */
export async function saveSafetySnapshot(state: ArchiveState, reason: string): Promise<SafetySnapshotSummary> {
  const existing = await readStoredSafetySnapshots();
  const createdAt = new Date().toISOString();
  const stored: StoredSafetySnapshot = {
    id: `safety-${Date.parse(createdAt)}-${Math.random().toString(36).slice(2, 8)}`,
    createdAt,
    reason,
    snapshot: sanitizeArchiveState(state),
  };

  await writeStoredSafetySnapshots([stored, ...existing].slice(0, MAX_SAFETY_SNAPSHOTS));

  return summarizeSafetySnapshot(stored);
}

export async function listSafetySnapshots(): Promise<SafetySnapshotSummary[]> {
  try {
    return (await readStoredSafetySnapshots()).map(summarizeSafetySnapshot);
  } catch {
    return [];
  }
}

export async function loadSafetySnapshot(id: string): Promise<ArchiveBackupParseResult> {
  let stored: StoredSafetySnapshot | undefined;

  try {
    stored = (await readStoredSafetySnapshots()).find((candidate) => candidate.id === id);
  } catch {
    return { ok: false, error: "Safety snapshots could not be read." };
  }

  if (!stored) {
    return { ok: false, error: "That safety snapshot no longer exists." };
  }

  return validateArchiveBackup(stored.snapshot);
}
