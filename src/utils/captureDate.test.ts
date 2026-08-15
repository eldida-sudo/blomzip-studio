import { describe, expect, it } from "vitest";
import { normalizeCaptureDate, parseCaptureDate } from "./captureDate";

describe("captureDate", () => {
  it("parses and normalizes EXIF capture dates", () => {
    expect(normalizeCaptureDate("2024:05:06 12:34:56")).toBe("2024-05-06T12:34:56.000Z");
  });

  it("preserves support for ISO capture dates", () => {
    expect(parseCaptureDate("2024-05-06T12:34:56.000Z")?.toISOString()).toBe("2024-05-06T12:34:56.000Z");
  });

  it("rejects missing and invalid capture dates", () => {
    expect(parseCaptureDate(undefined)).toBeNull();
    expect(parseCaptureDate("2024:02:30 12:34:56")).toBeNull();
  });
});