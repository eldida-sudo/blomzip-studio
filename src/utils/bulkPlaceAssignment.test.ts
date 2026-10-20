import { describe, expect, it } from "vitest";
import type { ImageRecord, Visit } from "../models/blomzip";
import { applyBulkPlaceAssignment, planBulkPlaceAssignment, undoBulkPlaceAssignment } from "./bulkPlaceAssignment";

function record(id: string, extra: Partial<ImageRecord> = {}): ImageRecord {
  return { id, filename: `${id}.jpg`, fileSize: 1, format: "jpeg", sourcePath: `${id}.jpg`, thumbnailUrl: `blob:${id}`, ...extra };
}

function visitWith(records: ImageRecord[]): Visit {
  return {
    id: "v",
    placeId: "p",
    date: "2026-07-08",
    imageCount: records.length,
    imageRecords: records,
    entries: records.map((r) => ({
      id: `e-${r.id}`,
      imageRecordId: r.id,
      visitId: "v",
      status: "new",
      notes: "",
      tags: [],
      observations: [],
      reviewed: false,
      favorite: true,
      createdAt: "x",
      updatedAt: "x",
    })),
    status: "Ready for AI",
  } as unknown as Visit;
}

describe("bulk place assignment", () => {
  const visit = visitWith([
    record("a"),
    record("b", { placeId: "house-wall" }),
    record("c", { placeId: "seating-area" }),
    record("d", { externalClassification: { classifiedAt: "x" } } as Partial<ImageRecord>),
    record("e", { placeId: "house-wall", placeDetailClassification: { classifiedAt: "x" } }),
    record("f"),
  ]);

  it("plans new, overwritten, unchanged and skipped records without mutating", () => {
    const snapshot = JSON.stringify(visit);
    const plan = planBulkPlaceAssignment(visit, ["a", "b", "c", "d", "e", "zzz"], "seating-area");

    expect(plan.applicableIds).toEqual(["a", "b"]);
    expect(plan.overwriteIds).toEqual(["b"]);
    expect(plan.unchangedIds).toEqual(["c"]);
    expect(plan.skipped.map((s) => s.reason)).toEqual(["external", "place-detail", "missing"]);
    expect(JSON.stringify(visit)).toBe(snapshot);
  });

  it("changes only placeId of selected applicable records and leaves entries and others untouched", () => {
    const result = applyBulkPlaceAssignment(visit, ["a", "b", "d"], "seating-area");
    if (!result.ok) throw new Error("expected ok");

    const byId = new Map(result.visit.imageRecords!.map((r) => [r.id, r]));
    expect(byId.get("a")?.placeId).toBe("seating-area");
    expect(byId.get("b")?.placeId).toBe("seating-area");
    expect(byId.get("d")?.placeId).toBeUndefined();
    expect(byId.get("f")).toBe(visit.imageRecords![5]);
    expect(result.visit.entries).toBe(visit.entries);
  });

  it("rejects an unknown place and is a no-op when nothing applies", () => {
    expect(applyBulkPlaceAssignment(visit, ["a"], "nope").ok).toBe(false);
    const result = applyBulkPlaceAssignment(visit, ["c"], "seating-area");
    expect(result.ok && result.visit === visit && result.undo === null).toBe(true);
  });

  it("undoes to previous places, but not records edited since", () => {
    const result = applyBulkPlaceAssignment(visit, ["a", "b", "f"], "seating-area");
    if (!result.ok || !result.undo) throw new Error("expected undo");

    const edited: Visit = {
      ...result.visit,
      imageRecords: result.visit.imageRecords!.map((r) => (r.id === "f" ? { ...r, placeId: "raised-bed" } : r)),
    };
    const undone = undoBulkPlaceAssignment(edited, result.undo);
    const byId = new Map(undone.visit.imageRecords!.map((r) => [r.id, r]));

    expect(undone.restoredCount).toBe(2);
    expect(undone.skippedCount).toBe(1);
    expect(byId.get("a")?.placeId).toBeUndefined();
    expect(byId.get("b")?.placeId).toBe("house-wall");
    expect(byId.get("f")?.placeId).toBe("raised-bed");
  });
});
