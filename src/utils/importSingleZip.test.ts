import { describe, expect, it, vi } from "vitest";
import type { Visit } from "../models/blomzip";
import type { ZipImportSummary } from "./readZipImages";

const mockReadZipImages = vi.fn();
const mockCreateTemporaryVisitFromZip = vi.fn();

vi.mock("./readZipImages", () => ({
  readZipImages: (...args: unknown[]) => mockReadZipImages(...args),
}));

vi.mock("./createTemporaryVisitFromZip", () => ({
  createTemporaryVisitFromZip: (...args: unknown[]) => mockCreateTemporaryVisitFromZip(...args),
}));

describe("importSingleZip", () => {
  it("reads the archive and creates a temporary visit on success", async () => {
    const { importSingleZip } = await import("./importSingleZip");

    const summary: ZipImportSummary = {
      fileName: "good.zip",
      status: "ready",
      imageCount: 2,
      totalImageSize: 10,
      imageFiles: ["a.jpg", "b.jpg"],
    };
    const visit = { id: "visit-1" } as Visit;

    mockReadZipImages.mockReset().mockResolvedValue(summary);
    mockCreateTemporaryVisitFromZip.mockReset().mockReturnValue(visit);

    const file = { name: "good.zip", arrayBuffer: vi.fn() } as unknown as File;
    const result = await importSingleZip(file);

    expect(result.status).toBe("success");
    expect(result.summary).toBe(summary);
    expect(result.visit).toBe(visit);
    expect(mockCreateTemporaryVisitFromZip).toHaveBeenCalledWith(summary);
  });

  it("reports failure without creating a visit when the ZIP is invalid", async () => {
    const { importSingleZip } = await import("./importSingleZip");

    const summary: ZipImportSummary = {
      fileName: "bad.zip",
      status: "invalid",
      imageCount: 0,
      totalImageSize: 0,
      imageFiles: [],
      errorMessage: "Corrupted central directory",
    };

    mockReadZipImages.mockReset().mockResolvedValue(summary);
    mockCreateTemporaryVisitFromZip.mockReset();

    const file = { name: "bad.zip", arrayBuffer: vi.fn() } as unknown as File;
    const result = await importSingleZip(file);

    expect(result.status).toBe("failed");
    expect(result.visit).toBeNull();
    expect(result.errorMessage).toBe("Corrupted central directory");
    expect(mockCreateTemporaryVisitFromZip).not.toHaveBeenCalled();
  });

  it("falls back to a generic error message when none is provided", async () => {
    const { importSingleZip } = await import("./importSingleZip");

    mockReadZipImages.mockReset().mockResolvedValue({
      fileName: "bad.zip",
      status: "invalid",
      imageCount: 0,
      totalImageSize: 0,
      imageFiles: [],
    } satisfies ZipImportSummary);

    const file = { name: "bad.zip", arrayBuffer: vi.fn() } as unknown as File;
    const result = await importSingleZip(file);

    expect(result.errorMessage).toBe("The selected file could not be read as a ZIP archive.");
  });
});
