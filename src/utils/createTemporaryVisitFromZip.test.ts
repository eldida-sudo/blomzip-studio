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
    expect(visit?.status).toBe("Ready for observations");
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
