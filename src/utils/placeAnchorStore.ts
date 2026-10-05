import { openArchiveDatabase, PLACE_ANCHOR_IMAGE_STORE_NAME } from "./archiveIndexedDb";

export interface StoredAnchorImage {
  anchorId: string;
  placeId: string;
  blob: Blob;
  mimeType: string;
  width?: number;
  height?: number;
  savedAt: string;
}

/*
 * Anchor image blobs are deliberately never deleted. A removed anchor may still be
 * referenced by a retained safety snapshot, and restoring that snapshot must be able to
 * bring the image back. Anchors are few and small (max 8 per place, <=1600px JPEG).
 */

export async function putAnchorImage(image: Omit<StoredAnchorImage, "savedAt">): Promise<void> {
  const database = await openArchiveDatabase();

  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction(PLACE_ANCHOR_IMAGE_STORE_NAME, "readwrite");
      transaction.objectStore(PLACE_ANCHOR_IMAGE_STORE_NAME).put({
        ...image,
        savedAt: new Date().toISOString(),
      } satisfies StoredAnchorImage);

      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error ?? new Error("Could not save anchor image"));
      transaction.onabort = () => reject(transaction.error ?? new Error("Could not save anchor image"));
    });
  } finally {
    database.close();
  }
}

export async function getAnchorImages(anchorIds: string[]): Promise<Map<string, StoredAnchorImage>> {
  const found = new Map<string, StoredAnchorImage>();

  if (anchorIds.length === 0 || typeof indexedDB === "undefined") {
    return found;
  }

  let database: IDBDatabase;
  try {
    database = await openArchiveDatabase();
  } catch {
    return found;
  }

  try {
    const store = database.transaction(PLACE_ANCHOR_IMAGE_STORE_NAME, "readonly").objectStore(PLACE_ANCHOR_IMAGE_STORE_NAME);

    await Promise.all(
      anchorIds.map(
        (anchorId) =>
          new Promise<void>((resolve) => {
            const request = store.get(anchorId);
            request.onsuccess = () => {
              const record = request.result as StoredAnchorImage | undefined;
              if (record?.blob) {
                found.set(anchorId, record);
              }
              resolve();
            };
            request.onerror = () => resolve();
          })
      )
    );
  } catch {
    // Missing bytes are reported to the curator as "image missing".
  } finally {
    database.close();
  }

  return found;
}
