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

  it("revokes previous import thumbnails only when replacing import or unmounting", async () => {
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

    expect(mockRevokeThumbnailUrls).toHaveBeenCalledTimes(1);
    expect(mockRevokeThumbnailUrls).toHaveBeenNthCalledWith(1, firstVisit.imageRecords);

    act(() => {
      root.unmount();
    });
    didUnmountRoot = true;

    expect(mockRevokeThumbnailUrls).toHaveBeenCalledTimes(2);
    expect(mockRevokeThumbnailUrls).toHaveBeenNthCalledWith(2, secondVisit.imageRecords);
  });
});
