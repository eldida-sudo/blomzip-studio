import { describe, expect, it } from "vitest";
import { createTemporaryVisitFromZip } from "./createTemporaryVisitFromZip";

describe("createTemporaryVisitFromZip", () => {
  it("creates a temporary visit from a successful ZIP summary", () => {
    const visit = createTemporaryVisitFromZip(
      {
        fileName: "archive.zip",
        status: "ready",
        imageCount: 2,
        totalImageSize: 42,
        imageFiles: ["one.jpg", "two.png"],
      },
      { date: "2026-07-04" }
    );

    expect(visit).not.toBeNull();
    expect(visit?.date).toBe("2026-07-04");
    expect(visit?.imageCount).toBe(2);
    expect(visit?.importedImageFiles).toEqual(["one.jpg", "two.png"]);
    expect(visit?.imageRecords).toEqual([
      expect.objectContaining({ filename: "one.jpg", format: "jpg", sourcePath: "one.jpg" }),
      expect.objectContaining({ filename: "two.png", format: "png", sourcePath: "two.png" }),
    ]);
    expect(visit?.status).toBe("Ready for AI");
  });

  it("enriches image records with metadata extracted from in-memory image bytes", () => {
    const jpegBytes = Uint8Array.from([
      0xff, 0xd8,
      0xff, 0xc0, 0x00, 0x0b,
      0x08, 0x01, 0x90, 0x02, 0x58, 0x03,
      0xff, 0xe1, 0x00, 0x1f,
      0x45, 0x78, 0x69, 0x66, 0x00, 0x00,
      0x44, 0x61, 0x74, 0x65, 0x54, 0x69, 0x6d, 0x65, 0x3d, 0x32, 0x30, 0x32, 0x34, 0x3a, 0x30, 0x35, 0x3a, 0x30, 0x36, 0x20, 0x31, 0x32, 0x3a, 0x33, 0x34, 0x3a, 0x35, 0x36,
      0xff, 0xd9,
    ]);

    const visit = createTemporaryVisitFromZip({
      fileName: "archive.zip",
      status: "ready",
      imageCount: 1,
      totalImageSize: jpegBytes.byteLength,
      imageFiles: ["photo.jpg"],
      imageEntries: [{ filename: "photo.jpg", fileSize: jpegBytes.byteLength, data: jpegBytes }],
    });

    expect(visit?.imageRecords?.[0]).toEqual(
      expect.objectContaining({
        filename: "photo.jpg",
        width: 600,
        height: 400,
        aspectRatio: 1.5,
        orientation: "landscape",
        captureDate: "2024:05:06 12:34:56",
        mimeType: "image/jpeg",
      })
    );
  });

  it("creates one entry per image record and attaches them to the visit", () => {
    const visit = createTemporaryVisitFromZip({
      fileName: "archive.zip",
      status: "ready",
      imageCount: 2,
      totalImageSize: 10,
      imageFiles: ["first.jpg", "second.jpg"],
      imageEntries: [
        { filename: "first.jpg", fileSize: 4, data: new Uint8Array([1, 2, 3, 4]) },
        { filename: "second.jpg", fileSize: 6, data: new Uint8Array([5, 6, 7, 8, 9, 10]) },
      ],
    });

    expect(visit?.entries).toHaveLength(2);
    expect(visit?.entries?.map((entry) => entry.imageRecordId)).toEqual(visit?.imageRecords?.map((record) => record.id));
    expect(visit?.entries?.map((entry) => entry.visitId)).toEqual([visit?.id, visit?.id]);
    expect(visit?.entries?.map((entry) => entry.status)).toEqual(["new", "new"]);
    expect(visit?.entries?.map((entry) => entry.notes)).toEqual(["", ""]);
    expect(visit?.entries?.map((entry) => entry.tags)).toEqual([[], []]);
    expect(visit?.entries?.every((entry) => entry.observations.length === 0)).toBe(true);
    expect(visit?.entries?.map((entry) => entry.observations)).toEqual([[], []]);
  });

  it("returns null when the ZIP summary is invalid", () => {
    const visit = createTemporaryVisitFromZip({
      fileName: "broken.zip",
      status: "invalid",
      imageCount: 0,
      totalImageSize: 0,
      imageFiles: [],
      errorMessage: "Not a ZIP",
    });

    expect(visit).toBeNull();
  });
});
