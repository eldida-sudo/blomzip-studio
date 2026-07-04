import JSZip from "jszip";
import { describe, expect, it } from "vitest";
import { readZipImages } from "./readZipImages";

describe("readZipImages", () => {
  it("lists supported image files and ignores non-image files", async () => {
    const zip = new JSZip();
    zip.file("photos/one.jpg", Uint8Array.from([1, 2, 3]));
    zip.file("photos/two.png", Uint8Array.from([4, 5, 6, 7, 8]));
    zip.file("notes.txt", "hello");

    const archiveBuffer = await zip.generateAsync({ type: "arraybuffer" });

    const result = await readZipImages({
      name: "sample.zip",
      arrayBuffer: async () => archiveBuffer,
    } as File);

    expect(result.fileName).toBe("sample.zip");
    expect(result.status).toBe("ready");
    expect(result.imageCount).toBe(2);
    expect(result.totalImageSize).toBe(8);
    expect(result.imageFiles).toEqual(["one.jpg", "two.png"]);
  });

  it("reports empty zips gracefully", async () => {
    const zip = new JSZip();
    const archiveBuffer = await zip.generateAsync({ type: "arraybuffer" });

    const result = await readZipImages({
      name: "empty.zip",
      arrayBuffer: async () => archiveBuffer,
    } as File);

    expect(result.status).toBe("empty");
    expect(result.imageCount).toBe(0);
    expect(result.imageFiles).toEqual([]);
  });

  it("reports invalid archives gracefully", async () => {
    const result = await readZipImages({
      name: "broken.zip",
      arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer,
    } as File);

    expect(result.status).toBe("invalid");
    expect(result.imageCount).toBe(0);
    expect(result.imageFiles).toEqual([]);
  });
});
