import { describe, expect, it } from "vitest";
import type { ImageRecord } from "../models/blomzip";
import { orderImageRecordsForTimeline } from "./orderImageRecordsForTimeline";

function createRecord(filename: string, captureDate?: string): ImageRecord {
  return {
    id: filename,
    filename,
    fileSize: 1,
    format: "jpg",
    sourcePath: filename,
    captureDate,
  };
}

describe("orderImageRecordsForTimeline", () => {
  it("orders records by capture date when dates are available", () => {
    const records = [
      createRecord("zeta.jpg", "2024-03-02"),
      createRecord("alpha.jpg", "2024-01-01"),
      createRecord("middle.jpg", "2024-02-15"),
    ];

    const result = orderImageRecordsForTimeline(records);

    expect(result.strategy).toBe("captureDate");
    expect(result.orderedRecords.map((record) => record.filename)).toEqual(["alpha.jpg", "middle.jpg", "zeta.jpg"]);
  });

  it("falls back to filename ordering when no capture dates exist", () => {
    const records = [createRecord("zeta.jpg"), createRecord("alpha.jpg"), createRecord("middle.jpg")];

    const result = orderImageRecordsForTimeline(records);

    expect(result.strategy).toBe("filename");
    expect(result.orderedRecords.map((record) => record.filename)).toEqual(["alpha.jpg", "middle.jpg", "zeta.jpg"]);
  });

  it("keeps missing-date records in their original relative order while sorting dated records first", () => {
    const records = [
      createRecord("later.jpg", "2024-03-01"),
      createRecord("missing-a.jpg"),
      createRecord("earlier.jpg", "2024-01-01"),
      createRecord("missing-b.jpg"),
    ];

    const result = orderImageRecordsForTimeline(records);

    expect(result.strategy).toBe("captureDate");
    expect(result.orderedRecords.map((record) => record.filename)).toEqual(["earlier.jpg", "later.jpg", "missing-a.jpg", "missing-b.jpg"]);
  });
});
