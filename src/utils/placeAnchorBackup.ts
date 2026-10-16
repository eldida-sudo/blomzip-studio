import { openArchiveDatabase, PLACE_ANCHOR_IMAGE_STORE_NAME } from "./archiveIndexedDb";
import type { StoredAnchorImage } from "./placeAnchorStore";

export const ANCHOR_IMAGE_BACKUP_SCHEMA = "blomzip.anchor-images";
export const ANCHOR_IMAGE_BACKUP_VERSION = 1;
const ALLOWED_MIME_TYPES: readonly string[] = ["image/jpeg", "image/png"];
const BASE64_PATTERN = /^[A-Za-z0-9+/]+={0,2}$/;

export interface AnchorImageBackupRecord {
  anchorId: string;
  placeId: string;
  mimeType: string;
  width?: number;
  height?: number;
  savedAt: string;
  dataBase64: string;
}

export interface AnchorImageBackup {
  schema: typeof ANCHOR_IMAGE_BACKUP_SCHEMA;
  version: typeof ANCHOR_IMAGE_BACKUP_VERSION;
  exportedAt: string;
  images: AnchorImageBackupRecord[];
}

export interface AnchorImageImportResult {
  added: number;
  skipped: number;
  errors: number;
}

export type AnchorImageBackupParseResult =
  | { ok: true; records: AnchorImageBackupRecord[] }
  | { ok: false; error: string };

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error ?? new Error("Could not read anchor image"));
    reader.onload = () => {
      const bytes = new Uint8Array(reader.result as ArrayBuffer);
      let binary = "";
      const chunkSize = 0x8000;
      for (let index = 0; index < bytes.length; index += chunkSize) {
        binary += String.fromCharCode(...bytes.subarray(index, index + chunkSize));
      }
      resolve(btoa(binary));
    };
    reader.readAsArrayBuffer(blob);
  });
}

function base64ToBlob(base64: string, mimeType: string): Blob {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return new Blob([bytes], { type: mimeType });
}

async function readAllAnchorImages(): Promise<StoredAnchorImage[]> {
  const database = await openArchiveDatabase();

  try {
    return await new Promise<StoredAnchorImage[]>((resolve, reject) => {
      const request = database
        .transaction(PLACE_ANCHOR_IMAGE_STORE_NAME, "readonly")
        .objectStore(PLACE_ANCHOR_IMAGE_STORE_NAME)
        .getAll();

      request.onerror = () => reject(request.error ?? new Error("Could not read anchor images"));
      request.onsuccess = () => resolve(request.result as StoredAnchorImage[]);
    });
  } finally {
    database.close();
  }
}

/** Reads every record in the anchor image store (including orphans) without writing anything. */
export async function createAnchorImageBackup(): Promise<AnchorImageBackup> {
  const stored = await readAllAnchorImages();
  const images: AnchorImageBackupRecord[] = [];

  for (const record of stored) {
    if (!record || typeof record.anchorId !== "string" || !(record.blob instanceof Blob)) {
      throw new Error("A stored anchor image is damaged, so the backup was not created.");
    }

    const entry: AnchorImageBackupRecord = {
      anchorId: record.anchorId,
      placeId: record.placeId,
      mimeType: record.mimeType,
      savedAt: record.savedAt,
      dataBase64: await blobToBase64(record.blob),
    };
    if (record.width !== undefined) {
      entry.width = record.width;
    }
    if (record.height !== undefined) {
      entry.height = record.height;
    }
    images.push(entry);
  }

  return {
    schema: ANCHOR_IMAGE_BACKUP_SCHEMA,
    version: ANCHOR_IMAGE_BACKUP_VERSION,
    exportedAt: new Date().toISOString(),
    images,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function isPositiveInteger(value: unknown): boolean {
  return typeof value === "number" && Number.isInteger(value) && value > 0;
}

function isValidBase64(value: unknown): value is string {
  if (typeof value !== "string" || value.length === 0 || value.length % 4 !== 0 || !BASE64_PATTERN.test(value)) {
    return false;
  }

  try {
    atob(value);
    return true;
  } catch {
    return false;
  }
}

/** Validates the whole file; nothing is written unless every record passes. */
export function validateAnchorImageBackup(value: unknown): AnchorImageBackupParseResult {
  if (!isRecord(value) || value.schema !== ANCHOR_IMAGE_BACKUP_SCHEMA) {
    return { ok: false, error: "This file is not a Blomzip anchor-image backup." };
  }

  if (value.version !== ANCHOR_IMAGE_BACKUP_VERSION) {
    return { ok: false, error: "This anchor-image backup was made with an unsupported version of Studio." };
  }

  if (!Array.isArray(value.images) || value.images.length === 0) {
    return { ok: false, error: "The anchor-image backup contains no images." };
  }

  const seenIds = new Set<string>();
  const records: AnchorImageBackupRecord[] = [];

  for (const [index, item] of value.images.entries()) {
    const label = `Image ${index + 1}`;

    if (!isRecord(item)) {
      return { ok: false, error: `${label} is not a valid record.` };
    }
    if (!isNonEmptyString(item.anchorId)) {
      return { ok: false, error: `${label} has no anchor ID.` };
    }
    if (seenIds.has(item.anchorId)) {
      return { ok: false, error: `${label} repeats anchor ID "${item.anchorId}".` };
    }
    seenIds.add(item.anchorId);

    if (!isNonEmptyString(item.placeId)) {
      return { ok: false, error: `${label} has no place ID.` };
    }
    if (typeof item.mimeType !== "string" || !ALLOWED_MIME_TYPES.includes(item.mimeType)) {
      return { ok: false, error: `${label} has an unsupported image type.` };
    }
    if (item.width !== undefined && !isPositiveInteger(item.width)) {
      return { ok: false, error: `${label} has an invalid width.` };
    }
    if (item.height !== undefined && !isPositiveInteger(item.height)) {
      return { ok: false, error: `${label} has an invalid height.` };
    }
    if (!isNonEmptyString(item.savedAt) || Number.isNaN(Date.parse(item.savedAt))) {
      return { ok: false, error: `${label} has an invalid saved date.` };
    }
    if (!isValidBase64(item.dataBase64)) {
      return { ok: false, error: `${label} has damaged image data.` };
    }

    const record: AnchorImageBackupRecord = {
      anchorId: item.anchorId,
      placeId: item.placeId,
      mimeType: item.mimeType,
      savedAt: item.savedAt,
      dataBase64: item.dataBase64,
    };
    if (item.width !== undefined) {
      record.width = item.width as number;
    }
    if (item.height !== undefined) {
      record.height = item.height as number;
    }
    records.push(record);
  }

  return { ok: true, records };
}

export function parseAnchorImageBackup(text: string): AnchorImageBackupParseResult {
  try {
    return validateAnchorImageBackup(JSON.parse(text));
  } catch {
    return { ok: false, error: "The selected file is not valid JSON." };
  }
}

type AddOutcome = "added" | "skipped";

function addIfAbsent(database: IDBDatabase, record: AnchorImageBackupRecord): Promise<AddOutcome> {
  return new Promise<AddOutcome>((resolve, reject) => {
    const transaction = database.transaction(PLACE_ANCHOR_IMAGE_STORE_NAME, "readwrite");
    const store = transaction.objectStore(PLACE_ANCHOR_IMAGE_STORE_NAME);
    let outcome: AddOutcome = "skipped";

    transaction.oncomplete = () => resolve(outcome);
    transaction.onerror = () => reject(transaction.error ?? new Error("Could not restore anchor image"));
    transaction.onabort = () => reject(transaction.error ?? new Error("Could not restore anchor image"));

    const existing = store.get(record.anchorId);
    existing.onerror = () => reject(existing.error ?? new Error("Could not check anchor image"));
    existing.onsuccess = () => {
      if (existing.result !== undefined) {
        return;
      }

      const stored: StoredAnchorImage = {
        anchorId: record.anchorId,
        placeId: record.placeId,
        blob: base64ToBlob(record.dataBase64, record.mimeType),
        mimeType: record.mimeType,
        savedAt: record.savedAt,
        ...(record.width !== undefined ? { width: record.width } : {}),
        ...(record.height !== undefined ? { height: record.height } : {}),
      };
      // add() fails on an existing key, so a record can never be overwritten.
      store.add(stored);
      outcome = "added";
    };
  });
}

/** Adds records whose anchor ID is absent. Existing records are never touched. */
export async function restoreAnchorImages(records: AnchorImageBackupRecord[]): Promise<AnchorImageImportResult> {
  const result: AnchorImageImportResult = { added: 0, skipped: 0, errors: 0 };
  const database = await openArchiveDatabase();

  try {
    for (const record of records) {
      try {
        const outcome = await addIfAbsent(database, record);
        result[outcome === "added" ? "added" : "skipped"] += 1;
      } catch {
        result.errors += 1;
      }
    }
  } finally {
    database.close();
  }

  return result;
}

export async function importAnchorImageBackup(
  text: string
): Promise<{ ok: true; result: AnchorImageImportResult } | { ok: false; error: string }> {
  const parsed = parseAnchorImageBackup(text);

  if (!parsed.ok) {
    return parsed;
  }

  try {
    return { ok: true, result: await restoreAnchorImages(parsed.records) };
  } catch {
    return { ok: false, error: "Could not open this browser's anchor image storage." };
  }
}
