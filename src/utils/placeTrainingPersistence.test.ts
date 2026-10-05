/**
 * @vitest-environment jsdom
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DraftWorkspace, PlaceVisualAnchor, Visit } from "../models/blomzip";
import {
  createArchiveStateSnapshot,
  loadArchiveState,
  loadSafetySnapshot,
  parseArchiveBackup,
  saveArchiveState,
  saveSafetySnapshot,
} from "./archivePersistence";
import { getAnchorImages, putAnchorImage } from "./placeAnchorStore";
import {
  addPlaceAnchors,
  createEmptyPlaceTrainingState,
  getPlaceAnchors,
  removePlaceAnchor,
  upsertMatchResult,
} from "./placeTraining";

function createInMemoryIndexedDb() {
  const stores = new Map<string, Map<string, unknown>>();
  const storeFor = (name: string) => {
    if (!stores.has(name)) stores.set(name, new Map());
    return stores.get(name) as Map<string, unknown>;
  };

  const database = {
    objectStoreNames: { contains: (name: string) => stores.has(name) },
    createObjectStore: (name: string) => {
      storeFor(name);
      return {} as IDBObjectStore;
    },
    transaction: (_name: string) => {
      const transaction = {
        oncomplete: null as (() => void) | null,
        onerror: null as (() => void) | null,
        onabort: null as (() => void) | null,
        objectStore: (name: string) => {
          const store = storeFor(name);
          return {
            get: (key: string) => {
              const request = { result: store.get(key), onsuccess: null as (() => void) | null, onerror: null as (() => void) | null };
              queueMicrotask(() => request.onsuccess?.());
              return request;
            },
            put: (value: { key?: string; anchorId?: string; imageRecordId?: string }) => {
              const key = value.key ?? value.anchorId ?? value.imageRecordId;
              if (key) store.set(key, value);
              queueMicrotask(() => transaction.oncomplete?.());
              return {};
            },
          };
        },
      };
      return transaction;
    },
    close: () => undefined,
  };

  return {
    open: () => {
      const request = {
        result: undefined as unknown,
        onerror: null as (() => void) | null,
        onsuccess: null as (() => void) | null,
        onupgradeneeded: null as (() => void) | null,
      };
      queueMicrotask(() => {
        request.result = database;
        request.onupgradeneeded?.();
        request.onsuccess?.();
      });
      return request;
    },
  };
}

const emptyWorkspace: DraftWorkspace = { drafts: [], activeDraftId: null };

const visit: Visit = {
  id: "visit-1",
  placeId: "courtyard",
  date: "2026-10-05",
  entries: [],
  imageRecords: [{ id: "image-1", filename: "image-1.jpg", fileSize: 1, format: "jpeg", sourcePath: "image-1.jpg" }],
};

function anchor(id: string): PlaceVisualAnchor {
  return {
    id,
    placeId: "seating-area",
    filename: `${id}.jpg`,
    mimeType: "image/jpeg",
    createdAt: "2026-10-05T00:00:00.000Z",
    width: 1600,
    height: 1200,
    source: "upload",
  };
}

describe("place training persistence", () => {
  beforeEach(() => {
    window.localStorage.clear();
    vi.stubGlobal("indexedDB", createInMemoryIndexedDb());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("persists anchor metadata and match results across reloads", async () => {
    let training = createEmptyPlaceTrainingState();
    const added = addPlaceAnchors(training, "seating-area", [anchor("a1"), anchor("a2"), anchor("a3")]);
    if (!added.ok) throw new Error("setup");
    training = upsertMatchResult(added.value, {
      id: "match-seating-area-image-1",
      placeId: "seating-area",
      imageRecordId: "image-1",
      score: 0.7,
      reason: "Same bench.",
      provider: "blomzip-vision-proxy",
      analysisVersion: 1,
      matchedAt: "2026-10-05T00:00:00.000Z",
      status: "rejected",
    });

    await saveArchiveState(createArchiveStateSnapshot({ importVisit: visit, draftWorkspace: emptyWorkspace, placeTraining: training }));
    const loaded = await loadArchiveState();

    expect(loaded?.placeTraining.anchorsByPlaceId["seating-area"].map((item) => item.id)).toEqual(["a1", "a2", "a3"]);
    expect(loaded?.placeTraining.matchResults[0]).toMatchObject({ status: "rejected", score: 0.7 });
    expect(JSON.stringify(loaded)).not.toContain("data:image");
  });

  it("loads archives saved before place training existed with empty training state", () => {
    const legacy = {
      schema: "blomzip.archive-state",
      schemaVersion: 2,
      savedAt: "2026-10-01T00:00:00.000Z",
      importVisit: visit,
      draftWorkspace: emptyWorkspace,
    };

    const parsed = parseArchiveBackup(JSON.stringify(legacy));
    expect(parsed.ok && parsed.state.placeTraining).toEqual({ anchorsByPlaceId: {}, matchResults: [] });
  });

  it("restores an anchor image from a safety snapshot after the anchor was removed", async () => {
    const imageBlob = new Blob(["anchor-bytes"], { type: "image/jpeg" });
    await putAnchorImage({ anchorId: "a1", placeId: "seating-area", blob: imageBlob, mimeType: "image/jpeg", width: 1600, height: 1200 });

    const added = addPlaceAnchors(createEmptyPlaceTrainingState(), "seating-area", [anchor("a1")]);
    if (!added.ok) throw new Error("setup");

    const summary = await saveSafetySnapshot(
      createArchiveStateSnapshot({ importVisit: visit, draftWorkspace: emptyWorkspace, placeTraining: added.value }),
      "Before removing an anchor"
    );

    const afterRemoval = removePlaceAnchor(added.value, "seating-area", "a1");
    expect(getPlaceAnchors(afterRemoval, "seating-area")).toEqual([]);

    // Removal must keep the bytes so recovery can restore them.
    expect((await getAnchorImages(["a1"])).has("a1")).toBe(true);

    const restored = await loadSafetySnapshot(summary.id);
    expect(restored.ok).toBe(true);
    if (!restored.ok) return;

    const restoredAnchors = getPlaceAnchors(restored.state.placeTraining, "seating-area");
    expect(restoredAnchors.map((item) => item.id)).toEqual(["a1"]);

    const images = await getAnchorImages(restoredAnchors.map((item) => item.id));
    expect(images.get("a1")?.blob).toBe(imageBlob);
  });

  it("reports missing bytes instead of inventing them", async () => {
    expect((await getAnchorImages(["never-stored"])).size).toBe(0);
  });
});
