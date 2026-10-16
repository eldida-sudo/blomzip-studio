/**
 * @vitest-environment jsdom
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { ARCHIVE_STATE_STORE_NAME, ARCHIVE_THUMBNAIL_STORE_NAME, PLACE_ANCHOR_IMAGE_STORE_NAME } from "./archiveIndexedDb";
import {
  createAnchorImageBackup,
  importAnchorImageBackup,
  validateAnchorImageBackup,
  type AnchorImageBackup,
} from "./placeAnchorBackup";

type Request = {
  result?: unknown;
  error?: unknown;
  onsuccess: (() => void) | null;
  onerror: (() => void) | null;
};

const stores = new Map<string, Map<string, Record<string, unknown>>>();
let writeCount = 0;

function keyOf(storeName: string, value: Record<string, unknown>) {
  return String(storeName === ARCHIVE_STATE_STORE_NAME ? value.key : storeName === ARCHIVE_THUMBNAIL_STORE_NAME ? value.imageRecordId : value.anchorId);
}

function installFakeIndexedDb() {
  stores.clear();
  writeCount = 0;
  [ARCHIVE_STATE_STORE_NAME, ARCHIVE_THUMBNAIL_STORE_NAME, PLACE_ANCHOR_IMAGE_STORE_NAME].forEach((name) => stores.set(name, new Map()));

  const database = {
    objectStoreNames: { contains: () => true },
    createObjectStore: () => ({}),
    close: () => undefined,
    transaction: (storeName: string, mode: string) => {
      const transaction: { oncomplete: (() => void) | null; onerror: (() => void) | null; onabort: (() => void) | null; error?: unknown; objectStore: () => unknown } = {
        oncomplete: null,
        onerror: null,
        onabort: null,
        objectStore: () => {
          const store = stores.get(storeName)!;
          const respond = (request: Request, result: unknown) => {
            request.result = result;
            queueMicrotask(() => request.onsuccess?.());
          };
          return {
            get: (key: string) => {
              const request: Request = { onsuccess: null, onerror: null };
              respond(request, store.get(key));
              return request;
            },
            getAll: () => {
              const request: Request = { onsuccess: null, onerror: null };
              respond(request, [...store.values()]);
              return request;
            },
            add: (value: Record<string, unknown>) => {
              const key = keyOf(storeName, value);
              if (mode !== "readwrite" || store.has(key)) {
                throw new Error("ConstraintError");
              }
              writeCount += 1;
              store.set(key, value);
              return {};
            },
            put: () => {
              throw new Error("put must not be used");
            },
          };
        },
      };
      // Completes after the request callbacks queued above have run.
      setTimeout(() => transaction.oncomplete?.(), 0);
      return transaction;
    },
  };

  vi.stubGlobal("indexedDB", {
    open: () => {
      const request: { result: unknown; onsuccess: (() => void) | null; onerror: (() => void) | null; onupgradeneeded: (() => void) | null } = {
        result: database,
        onsuccess: null,
        onerror: null,
        onupgradeneeded: null,
      };
      queueMicrotask(() => request.onsuccess?.());
      return request;
    },
  });
}

function bytesToBase64(bytes: number[]) {
  return btoa(String.fromCharCode(...bytes));
}

function seed(anchorId: string, bytes: number[], extra: Record<string, unknown> = {}) {
  stores.get(PLACE_ANCHOR_IMAGE_STORE_NAME)!.set(anchorId, {
    anchorId,
    placeId: "place-a",
    blob: new Blob([new Uint8Array(bytes)], { type: "image/png" }),
    mimeType: "image/png",
    width: 10,
    height: 20,
    savedAt: "2026-01-01T00:00:00.000Z",
    ...extra,
  });
}

function record(anchorId: string, bytes = [1, 2, 3, 4]) {
  return {
    anchorId,
    placeId: "place-b",
    mimeType: "image/jpeg",
    width: 5,
    height: 6,
    savedAt: "2026-02-02T00:00:00.000Z",
    dataBase64: bytesToBase64(bytes),
  };
}

function backup(images: unknown[]) {
  return JSON.stringify({ schema: "blomzip.anchor-images", version: 1, exportedAt: "2026-03-03T00:00:00.000Z", images });
}

async function readBytes(blob: Blob): Promise<number[]> {
  const buffer = await new Promise<ArrayBuffer>((resolve) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as ArrayBuffer);
    reader.readAsArrayBuffer(blob);
  });
  return [...new Uint8Array(buffer)];
}

describe("anchor image backup", () => {
  beforeEach(() => installFakeIndexedDb());

  it("exports every record, including orphans, without writing", async () => {
    seed("anchor-1", [9, 8, 7]);
    seed("orphan", [255, 0, 1], { placeId: "removed-place", width: undefined, height: undefined });
    stores.get(ARCHIVE_STATE_STORE_NAME)!.set("state", { key: "state" });

    const exported = await createAnchorImageBackup();

    expect(exported.schema).toBe("blomzip.anchor-images");
    expect(exported.version).toBe(1);
    expect(exported.images.map((image) => image.anchorId).sort()).toEqual(["anchor-1", "orphan"]);
    expect(exported.images.find((image) => image.anchorId === "anchor-1")).toMatchObject({
      placeId: "place-a",
      mimeType: "image/png",
      width: 10,
      height: 20,
      savedAt: "2026-01-01T00:00:00.000Z",
      dataBase64: bytesToBase64([9, 8, 7]),
    });
    expect(exported.images.find((image) => image.anchorId === "orphan")).not.toHaveProperty("width");
    expect(writeCount).toBe(0);
  });

  it("round-trips an export into an empty store, preserving all fields and bytes", async () => {
    seed("anchor-1", [9, 8, 7]);
    const exported: AnchorImageBackup = await createAnchorImageBackup();
    stores.get(PLACE_ANCHOR_IMAGE_STORE_NAME)!.clear();

    const outcome = await importAnchorImageBackup(JSON.stringify(exported));

    expect(outcome).toEqual({ ok: true, result: { added: 1, skipped: 0, errors: 0 } });
    const restored = stores.get(PLACE_ANCHOR_IMAGE_STORE_NAME)!.get("anchor-1")!;
    expect(restored).toMatchObject({ placeId: "place-a", mimeType: "image/png", width: 10, height: 20, savedAt: "2026-01-01T00:00:00.000Z" });
    expect(await readBytes(restored.blob as Blob)).toEqual([9, 8, 7]);
  });

  it("imports valid records, preserving metadata", async () => {
    const outcome = await importAnchorImageBackup(backup([record("a"), record("b", [5, 6])]));

    expect(outcome).toEqual({ ok: true, result: { added: 2, skipped: 0, errors: 0 } });
    const stored = stores.get(PLACE_ANCHOR_IMAGE_STORE_NAME)!.get("b")!;
    expect(stored).toMatchObject({ anchorId: "b", placeId: "place-b", mimeType: "image/jpeg", width: 5, height: 6, savedAt: "2026-02-02T00:00:00.000Z" });
    expect(await readBytes(stored.blob as Blob)).toEqual([5, 6]);
  });

  it("never overwrites existing anchors and leaves other stores untouched", async () => {
    seed("a", [9, 9, 9]);
    const original = stores.get(PLACE_ANCHOR_IMAGE_STORE_NAME)!.get("a");
    stores.get(ARCHIVE_STATE_STORE_NAME)!.set("state", { key: "state", marker: 1 });
    stores.get(ARCHIVE_THUMBNAIL_STORE_NAME)!.set("t", { imageRecordId: "t" });

    const outcome = await importAnchorImageBackup(backup([record("a"), record("c")]));

    expect(outcome).toEqual({ ok: true, result: { added: 1, skipped: 1, errors: 0 } });
    expect(stores.get(PLACE_ANCHOR_IMAGE_STORE_NAME)!.get("a")).toBe(original);
    expect(stores.get(ARCHIVE_STATE_STORE_NAME)!.get("state")).toEqual({ key: "state", marker: 1 });
    expect(stores.get(ARCHIVE_THUMBNAIL_STORE_NAME)!.size).toBe(1);
    expect(stores.get(ARCHIVE_STATE_STORE_NAME)!.size).toBe(1);
  });

  it("is idempotent when imported twice", async () => {
    const text = backup([record("a")]);
    await importAnchorImageBackup(text);
    expect(await importAnchorImageBackup(text)).toEqual({ ok: true, result: { added: 0, skipped: 1, errors: 0 } });
  });

  it.each([
    ["invalid JSON", "not json"],
    ["wrong schema", JSON.stringify({ schema: "other", version: 1, images: [record("a")] })],
    ["wrong version", JSON.stringify({ schema: "blomzip.anchor-images", version: 2, images: [record("a")] })],
    ["no images", backup([])],
    ["non-object record", backup(["x"])],
    ["empty anchorId", backup([{ ...record("a"), anchorId: "" }])],
    ["empty placeId", backup([{ ...record("a"), placeId: "" }])],
    ["bad mime", backup([{ ...record("a"), mimeType: "image/gif" }])],
    ["bad width", backup([{ ...record("a"), width: -1 }])],
    ["bad height", backup([{ ...record("a"), height: 1.5 }])],
    ["bad date", backup([{ ...record("a"), savedAt: "nope" }])],
    ["bad base64 characters", backup([{ ...record("a"), dataBase64: "@@@@" }])],
    ["bad base64 length", backup([{ ...record("a"), dataBase64: "abc" }])],
    ["empty data", backup([{ ...record("a"), dataBase64: "" }])],
    ["duplicate ids", backup([record("a"), record("a")])],
    ["one bad record among good ones", backup([record("a"), record("b"), { ...record("c"), mimeType: "text/html" }])],
  ])("rejects %s without writing anything", async (_name, text) => {
    const outcome = await importAnchorImageBackup(text);

    expect(outcome.ok).toBe(false);
    expect(writeCount).toBe(0);
    expect(stores.get(PLACE_ANCHOR_IMAGE_STORE_NAME)!.size).toBe(0);
  });

  it("validates without touching storage", () => {
    expect(validateAnchorImageBackup(JSON.parse(backup([record("a")]))).ok).toBe(true);
    expect(validateAnchorImageBackup(null).ok).toBe(false);
  });
});
