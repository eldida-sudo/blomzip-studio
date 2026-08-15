/**
 * @vitest-environment jsdom
 */

import { createRoot, type Root } from "react-dom/client";
import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ZipImportPanel } from "./ZipImportPanel";
import type { Visit } from "../models/blomzip";
import type { ZipImportSummary } from "../utils/readZipImages";

const mockReadZipImages = vi.fn();
const mockCreateTemporaryVisitFromZip = vi.fn();
const mockRevokeThumbnailUrls = vi.fn();

vi.mock("../utils/readZipImages", () => ({
  readZipImages: (...args: unknown[]) => mockReadZipImages(...args),
}));

vi.mock("../utils/createTemporaryVisitFromZip", () => ({
  createTemporaryVisitFromZip: (...args: unknown[]) => mockCreateTemporaryVisitFromZip(...args),
}));

vi.mock("../utils/createThumbnailUrls", () => ({
  revokeThumbnailUrls: (...args: unknown[]) => mockRevokeThumbnailUrls(...args),
}));

describe("ZipImportPanel", () => {
  let container: HTMLDivElement;
  let root: Root;
  let didUnmountRoot = false;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    didUnmountRoot = false;
    mockReadZipImages.mockReset();
    mockCreateTemporaryVisitFromZip.mockReset();
    mockRevokeThumbnailUrls.mockReset();
  });

  afterEach(() => {
    if (!didUnmountRoot) {
      act(() => {
        root.unmount();
      });
    }
    container.remove();
  });

  it("keeps previous thumbnails alive during multiple imports and revokes all on unmount", async () => {
    const summary: ZipImportSummary = {
      fileName: "images.zip",
      status: "ready",
      imageCount: 1,
      totalImageSize: 5,
      imageFiles: ["one.jpg"],
      imageEntries: [{ filename: "one.jpg", fileSize: 5, data: new Uint8Array([1, 2, 3, 4, 5]) }],
    };

    const firstVisit: Visit = {
      id: "visit-1",
      placeId: "place-1",
      date: "2026-07-09",
      entries: [],
      imageRecords: [
        {
          id: "image-1",
          filename: "one.jpg",
          fileSize: 5,
          format: "jpeg",
          sourcePath: "one.jpg",
          thumbnailUrl: "blob:first",
        },
      ],
    };

    const secondVisit: Visit = {
      id: "visit-2",
      placeId: "place-1",
      date: "2026-07-09",
      entries: [],
      imageRecords: [
        {
          id: "image-2",
          filename: "two.jpg",
          fileSize: 5,
          format: "jpeg",
          sourcePath: "two.jpg",
          thumbnailUrl: "blob:second",
        },
      ],
    };

    const fileA = {
      name: "a.zip",
      arrayBuffer: vi.fn(async () => new ArrayBuffer(8)),
    } as unknown as File;

    const fileB = {
      name: "b.zip",
      arrayBuffer: vi.fn(async () => new ArrayBuffer(8)),
    } as unknown as File;

    mockReadZipImages.mockResolvedValue(summary);
    mockCreateTemporaryVisitFromZip
      .mockReturnValueOnce(firstVisit)
      .mockReturnValueOnce(secondVisit);

    act(() => {
      root.render(<ZipImportPanel />);
    });

    const input = container.querySelector("input[type='file']") as HTMLInputElement;
    expect(input).toBeTruthy();

    Object.defineProperty(input, "files", {
      configurable: true,
      value: [fileA],
    });

    await act(async () => {
      input.dispatchEvent(new Event("change", { bubbles: true }));
    });

    expect(mockRevokeThumbnailUrls).not.toHaveBeenCalled();

    Object.defineProperty(input, "files", {
      configurable: true,
      value: [fileB],
    });

    await act(async () => {
      input.dispatchEvent(new Event("change", { bubbles: true }));
    });

    expect(mockRevokeThumbnailUrls).not.toHaveBeenCalled();

    act(() => {
      root.unmount();
    });
    didUnmountRoot = true;

    expect(mockRevokeThumbnailUrls).toHaveBeenCalledTimes(1);
    expect(mockRevokeThumbnailUrls).toHaveBeenNthCalledWith(1, [
      ...(firstVisit.imageRecords ?? []),
      ...(secondVisit.imageRecords ?? []),
    ]);
  });

  it("allows selecting multiple ZIP files in one picker action", () => {
    act(() => {
      root.render(<ZipImportPanel />);
    });

    const input = container.querySelector("input[type='file']") as HTMLInputElement;
    expect(input.multiple).toBe(true);
    expect(input.accept).toBe(".zip,application/zip");
  });

  it("processes multiple selected ZIP files sequentially, not concurrently, and disables the picker while active", async () => {
    let resolveFirstRead: ((summary: ZipImportSummary) => void) | undefined;
    let resolveSecondRead: ((summary: ZipImportSummary) => void) | undefined;

    const firstDeferred = new Promise<ZipImportSummary>((resolve) => {
      resolveFirstRead = resolve;
    });
    const secondDeferred = new Promise<ZipImportSummary>((resolve) => {
      resolveSecondRead = resolve;
    });

    mockReadZipImages
      .mockImplementationOnce(() => firstDeferred)
      .mockImplementationOnce(() => secondDeferred);
    mockCreateTemporaryVisitFromZip.mockReturnValue(null);

    const fileA = { name: "a.zip", arrayBuffer: vi.fn(async () => new ArrayBuffer(8)) } as unknown as File;
    const fileB = { name: "b.zip", arrayBuffer: vi.fn(async () => new ArrayBuffer(8)) } as unknown as File;

    act(() => {
      root.render(<ZipImportPanel />);
    });

    const input = container.querySelector("input[type='file']") as HTMLInputElement;
    Object.defineProperty(input, "files", { configurable: true, value: [fileA, fileB] });

    await act(async () => {
      input.dispatchEvent(new Event("change", { bubbles: true }));
    });

    // Only the first ZIP should have started reading; the queue must not run concurrently.
    expect(mockReadZipImages).toHaveBeenCalledTimes(1);
    expect((container.querySelector("input[type='file']") as HTMLInputElement).disabled).toBe(true);
    expect(container.textContent).toContain("Importing 1 of 2 ZIP archives");

    await act(async () => {
      resolveFirstRead?.({
        fileName: "a.zip",
        status: "ready",
        imageCount: 1,
        totalImageSize: 5,
        imageFiles: ["one.jpg"],
      });
      await firstDeferred;
    });

    expect(mockReadZipImages).toHaveBeenCalledTimes(2);

    await act(async () => {
      resolveSecondRead?.({
        fileName: "b.zip",
        status: "ready",
        imageCount: 3,
        totalImageSize: 15,
        imageFiles: ["two.jpg", "three.jpg", "four.jpg"],
      });
      await secondDeferred;
    });

    expect(container.textContent).toContain("2 ZIP archives processed · 2 imported");
    expect((container.querySelector("input[type='file']") as HTMLInputElement).disabled).toBe(false);
  });

  it("isolates a failing ZIP so later ZIPs still import and shows per-file queue status", async () => {
    const goodSummary: ZipImportSummary = {
      fileName: "good.zip",
      status: "ready",
      imageCount: 2,
      totalImageSize: 10,
      imageFiles: ["a.jpg", "b.jpg"],
    };
    const badSummary: ZipImportSummary = {
      fileName: "bad.zip",
      status: "invalid",
      imageCount: 0,
      totalImageSize: 0,
      imageFiles: [],
      errorMessage: "Corrupted archive",
    };
    const thirdSummary: ZipImportSummary = {
      fileName: "third.zip",
      status: "ready",
      imageCount: 1,
      totalImageSize: 5,
      imageFiles: ["c.jpg"],
    };

    mockReadZipImages
      .mockResolvedValueOnce(goodSummary)
      .mockResolvedValueOnce(badSummary)
      .mockResolvedValueOnce(thirdSummary);
    mockCreateTemporaryVisitFromZip.mockReturnValue({
      id: "visit-x",
      placeId: "temporary-import",
      date: "2026-07-09",
      entries: [],
      imageRecords: [],
    } satisfies Visit);

    const onImportStateChange = vi.fn();
    const fileA = { name: "good.zip", arrayBuffer: vi.fn(async () => new ArrayBuffer(8)) } as unknown as File;
    const fileB = { name: "bad.zip", arrayBuffer: vi.fn(async () => new ArrayBuffer(8)) } as unknown as File;
    const fileC = { name: "third.zip", arrayBuffer: vi.fn(async () => new ArrayBuffer(8)) } as unknown as File;

    act(() => {
      root.render(<ZipImportPanel onImportStateChange={onImportStateChange} />);
    });

    const input = container.querySelector("input[type='file']") as HTMLInputElement;
    Object.defineProperty(input, "files", { configurable: true, value: [fileA, fileB, fileC] });

    await act(async () => {
      input.dispatchEvent(new Event("change", { bubbles: true }));
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(mockReadZipImages).toHaveBeenCalledTimes(3);
    expect(onImportStateChange).toHaveBeenCalledTimes(3);
    expect(onImportStateChange.mock.calls[1][0].visit).toBeNull();

    expect(container.textContent).toContain("3 ZIP archives processed · 2 imported · 1 failed");

    const failedItem = container.querySelector('[data-testid="zip-queue-item-bad.zip"]');
    expect(failedItem?.textContent).toContain("Failed");
    expect(failedItem?.textContent).toContain("Corrupted archive");

    const goodItem = container.querySelector('[data-testid="zip-queue-item-good.zip"]');
    expect(goodItem?.textContent).toContain("Imported");

    const thirdItem = container.querySelector('[data-testid="zip-queue-item-third.zip"]');
    expect(thirdItem?.textContent).toContain("Imported");
  });
});
