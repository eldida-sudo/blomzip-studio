import { describe, expect, it } from "vitest";
import type { ImageRecord, PlaceVisualAnchor, Visit } from "../models/blomzip";
import type { PlaceSignature } from "./visionProvider";
import {
  addPlaceAnchors,
  createEmptyPlaceTrainingState,
  createMatchResultId,
  getPlaceAnchors,
  listArchiveAnchorCandidates,
  upsertMatchResult,
  validateArchiveAnchorSelection,
} from "./placeTraining";
import { cacheSignature, computeAnchorSetKey, getCachedSignature } from "./placeSignatureCache";

const PLACE = "seating-area";
const rec = (id: string, extra: Partial<ImageRecord> = {}): ImageRecord => ({
  id,
  filename: `${id}.jpg`,
  fileSize: 1,
  format: "jpeg",
  sourcePath: `${id}.jpg`,
  thumbnailUrl: `blob:${id}`,
  placeId: PLACE,
  ...extra,
});
const visit = (records: ImageRecord[]): Visit => ({ id: "v", placeId: "courtyard", date: "2026-01-01", entries: [], imageRecords: records });
const anchor = (id: string, recordId?: string): PlaceVisualAnchor => ({
  id,
  placeId: PLACE,
  filename: `${id}.jpg`,
  mimeType: "image/jpeg",
  createdAt: "2026-01-01T00:00:00.000Z",
  width: 1,
  height: 1,
  source: recordId ? "archive-photo" : "upload",
  sourceImageRecordId: recordId,
});
const sig = {} as PlaceSignature;

describe("archive anchor selection", () => {
  const records = ["a", "b", "c", "d"].map((id) => rec(id));

  it("lists assigned photographs, flagging approved ones separately and nothing as anchor yet", () => {
    let state = createEmptyPlaceTrainingState();
    state = upsertMatchResult(state, {
      id: createMatchResultId(PLACE, "a"),
      placeId: PLACE,
      imageRecordId: "a",
      classification: "SAME_PLACE",
      score: 0.9,
      reason: "",
      provider: "t",
      analysisVersion: 1,
      matchedAt: "x",
      status: "approved",
    });
    const list = listArchiveAnchorCandidates(visit([...records, rec("other", { placeId: "raised-bed" })]), state, PLACE);
    expect(list.map((c) => c.record.id)).toEqual(["a", "b", "c", "d"]);
    expect(list.find((c) => c.record.id === "a")?.verified).toBe(true);
    expect(list.find((c) => c.record.id === "b")?.verified).toBe(false);
    expect(list.some((c) => c.alreadyAnchor)).toBe(false);
  });

  it("enforces 3–8 totals and rejects duplicates, already anchored and no-data photographs", () => {
    const v = visit([...records, rec("svg", { thumbnailUrl: "data:image/svg+xml,x" })]);
    const empty = createEmptyPlaceTrainingState();
    expect(validateArchiveAnchorSelection(v, empty, PLACE, ["a", "b"]).ok).toBe(false);
    const ok = validateArchiveAnchorSelection(v, empty, PLACE, ["a", "b", "c", "a"]);
    expect(ok.ok && ok.value.map((r) => r.id)).toEqual(["a", "b", "c"]);
    expect(validateArchiveAnchorSelection(v, empty, PLACE, ["a", "b", "svg"]).ok).toBe(false);

    const withA = addPlaceAnchors(empty, PLACE, [anchor("x1", "a"), anchor("x2"), anchor("x3")]);
    if (!withA.ok) throw new Error("setup");
    expect(validateArchiveAnchorSelection(v, withA.value, PLACE, ["a"]).ok).toBe(false);
    expect(validateArchiveAnchorSelection(v, withA.value, PLACE, ["b"]).ok).toBe(true);
    expect(listArchiveAnchorCandidates(v, withA.value, PLACE).find((c) => c.record.id === "a")?.alreadyAnchor).toBe(true);
  });

  it("rejects identical content and over-limit selections", () => {
    const v = visit([rec("a", { contentHash: "h" }), rec("b", { contentHash: "h" }), rec("c")]);
    expect(validateArchiveAnchorSelection(v, createEmptyPlaceTrainingState(), PLACE, ["a", "b", "c"]).ok).toBe(false);
    const many = visit(Array.from({ length: 9 }, (_, i) => rec(`m${i}`)));
    expect(
      validateArchiveAnchorSelection(many, createEmptyPlaceTrainingState(), PLACE, (many.imageRecords ?? []).map((r) => r.id)).ok
    ).toBe(false);
  });

  it("treats a photograph with identical content as already anchored", () => {
    const v = visit([rec("a", { contentHash: "h" }), rec("b", { contentHash: "h" })]);
    const added = addPlaceAnchors(createEmptyPlaceTrainingState(), PLACE, [anchor("x1", "a")]);
    if (!added.ok) throw new Error("setup");
    expect(listArchiveAnchorCandidates(v, added.value, PLACE).every((c) => c.alreadyAnchor)).toBe(true);
  });

  it("preserves existing anchors, archive data and match history; persists across reload; invalidates cache", async () => {
    const v = visit(records);
    const before = JSON.stringify(v);
    const base = addPlaceAnchors(createEmptyPlaceTrainingState(), PLACE, [anchor("x1")]);
    if (!base.ok) throw new Error("setup");
    const selection = validateArchiveAnchorSelection(v, base.value, PLACE, ["a", "b"]);
    expect(selection.ok).toBe(true);

    const keyBefore = await computeAnchorSetKey([{ id: "x1", blob: new Blob(["1"]) }]);
    const cached = cacheSignature(base.value, PLACE, keyBefore, sig, "t");
    const next = addPlaceAnchors(cached, PLACE, [anchor("n1", "a"), anchor("n2", "b")]);
    if (!next.ok) throw new Error("add");

    expect(getPlaceAnchors(next.value, PLACE).map((a) => a.id)).toEqual(["x1", "n1", "n2"]);
    expect(next.value.matchResults).toEqual(cached.matchResults);
    expect(JSON.stringify(v)).toBe(before);

    const keyAfter = await computeAnchorSetKey([
      { id: "x1", blob: new Blob(["1"]) },
      { id: "n1", blob: new Blob(["a"]) },
      { id: "n2", blob: new Blob(["b"]) },
    ]);
    expect(keyAfter).not.toBe(keyBefore);
    expect(getCachedSignature(next.value, PLACE, keyAfter)).toBeNull();

    const reloaded = JSON.parse(JSON.stringify(next.value));
    expect(getPlaceAnchors(reloaded, PLACE)).toHaveLength(3);
    expect(validateArchiveAnchorSelection(v, reloaded, PLACE, ["a"]).ok).toBe(false);
  });
});
