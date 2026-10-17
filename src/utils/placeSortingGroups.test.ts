import { describe, expect, it } from "vitest";
import type { ImageRecord, PlaceMatchResult, PlaceTrainingState, Visit } from "../models/blomzip";
import { buildSortingQueue } from "./placeSorting";
import {
  buildSortingGroups,
  buildSortingProgress,
  bulkAssignSortingPhotos,
  getResultFreshness,
  orderSortingItems,
  planBulkApproval,
} from "./placeSortingGroups";
import { createEmptyPlaceTrainingState, createMatchResultId, listArchiveAnchorCandidates, upsertMatchResult } from "./placeTraining";

const NOW = "2026-10-10T00:00:00.000Z";

function result(placeId: string, imageRecordId: string, classification: PlaceMatchResult["classification"], score: number, extra: Partial<PlaceMatchResult> = {}): PlaceMatchResult {
  return {
    id: createMatchResultId(placeId, imageRecordId),
    placeId,
    imageRecordId,
    classification,
    matchedFeatures: classification === "SAME_PLACE" ? ["bench", "wall"] : [],
    score,
    reason: "r",
    provider: "test",
    analysisVersion: 1,
    matchedAt: "2026-10-05T00:00:00.000Z",
    status: "pending",
    ...extra,
  };
}

function record(id: string, extra: Partial<ImageRecord> = {}): ImageRecord {
  return { id, filename: `${id}.jpg`, fileSize: 1, format: "jpeg", sourcePath: `${id}.jpg`, ...extra };
}

function fixture() {
  let state: PlaceTrainingState = createEmptyPlaceTrainingState();
  const add = (r: PlaceMatchResult) => (state = upsertMatchResult(state, r));
  add(result("seating-area", "p1", "SAME_PLACE", 0.95));
  add(result("raised-bed", "p1", "DIFFERENT_PLACE", 0.1));
  add(result("seating-area", "p2", "SAME_PLACE", 0.9));
  add(result("seating-area", "p3", "SAME_PLACE", 0.88));
  add(result("raised-bed", "p3", "SAME_PLACE", 0.84));
  add(result("seating-area", "p4", "NEARBY_CONTEXT", 0.6));
  add(result("seating-area", "p5", "SAME_PLACE", 0.95));
  add(result("seating-area", "p6", "SAME_PLACE", 0.5));
  const visit: Visit = {
    id: "v",
    placeId: "courtyard",
    date: "2026-10-05",
    entries: [],
    imageRecords: [
      record("p1", { captureDate: "2026-10-03" }),
      record("p2", { captureDate: "2026-10-01" }),
      record("p3"),
      record("p4"),
      record("p5", { overviewClassification: { classifiedAt: NOW } }),
      record("p6"),
    ],
  };
  return { visit, state };
}

describe("sorting groups", () => {
  it("groups by supported place, ambiguous and unresolved, excluding classified photographs", () => {
    const { visit, state } = fixture();
    const queue = buildSortingQueue(visit, state, []);
    const groups = buildSortingGroups(queue);

    expect(groups.map((group) => [group.key, group.items.map((item) => item.record.id)])).toEqual([
      ["place:seating-area", ["p1", "p2"]],
      ["ambiguous", ["p3"]],
      ["unresolved", ["p4", "p6"]],
    ]);
    expect(queue.some((item) => item.record.id === "p5")).toBe(false);
  });

  it("regroups after a curator decision without touching stored results", () => {
    const { visit, state } = fixture();
    const before = JSON.stringify(state.matchResults);
    const assigned = { ...visit, imageRecords: visit.imageRecords!.map((r) => (r.id === "p1" ? { ...r, placeId: "seating-area" } : r)) };
    const groups = buildSortingGroups(buildSortingQueue(assigned, state, []));

    expect(groups[0].items.map((item) => item.record.id)).toEqual(["p2"]);
    expect(JSON.stringify(state.matchResults)).toBe(before);
  });

  it("orders chronologically or by archive without using dates for grouping", () => {
    const { visit, state } = fixture();
    const queue = buildSortingQueue(visit, state, []);

    expect(orderSortingItems(queue, "chronological", visit.imageRecords!).map((i) => i.record.id).slice(0, 2)).toEqual(["p2", "p1"]);
    expect(orderSortingItems(queue, "original", visit.imageRecords!).map((i) => i.record.id)).toEqual(["p1", "p2", "p3", "p4", "p6"]);
    expect(orderSortingItems(queue, "priority", visit.imageRecords!)[0].proposal.status).toBe("proposed");
  });

  it("flags results older than a later anchor and leaves unknown dates unverified", () => {
    const { state } = fixture();
    const id = createMatchResultId("seating-area", "p1");
    expect(getResultFreshness(state, id)).toBe("current");

    const newer = {
      ...state,
      anchorsByPlaceId: {
        "seating-area": [{ id: "a", placeId: "seating-area", filename: "a.jpg", mimeType: "image/jpeg", createdAt: "2026-10-09T00:00:00.000Z", source: "upload" as const }],
      },
    };
    expect(getResultFreshness(newer, id)).toBe("older");
    expect(getResultFreshness({ ...state, matchResults: [result("seating-area", "p1", "SAME_PLACE", 0.9, { matchedAt: "bad" })] }, id)).toBe("unknown");
  });
});

describe("bulk approval", () => {
  it("plans only supported photographs and excludes stale evidence", () => {
    const { visit, state } = fixture();
    const group = buildSortingGroups(buildSortingQueue(visit, state, []))[0];
    expect(planBulkApproval(group.items, state, "seating-area").eligible.map((i) => i.record.id)).toEqual(["p1", "p2"]);
    expect(planBulkApproval(group.items, state, "raised-bed").eligible).toEqual([]);

    const stale = { ...state, signatureCache: { "seating-area": { anchorSetKey: "k", signature: { core: [], supporting: [], contextual: [] }, provider: "t", derivedAt: "2026-10-09T00:00:00.000Z" } } };
    expect(planBulkApproval(group.items, stale, "seating-area").skipped).toHaveLength(2);
  });

  it("never overwrites an existing assignment, writes audit entries and keeps match evidence", () => {
    const { visit, state } = fixture();
    const items = buildSortingQueue(visit, state, []);
    const proposals = items.filter((i) => ["p1", "p2"].includes(i.record.id)).map((i) => i.proposal);
    const concurrent: Visit = { ...visit, imageRecords: visit.imageRecords!.map((r) => (r.id === "p2" ? { ...r, placeId: "house-wall" } : r)) };
    const outcome = bulkAssignSortingPhotos(concurrent, state, proposals, "seating-area", NOW);

    expect(outcome.assignedIds).toEqual(["p1"]);
    expect(outcome.skipped).toHaveLength(1);
    expect(outcome.visit.imageRecords!.find((r) => r.id === "p2")?.placeId).toBe("house-wall");
    expect(outcome.visit.imageRecords!.find((r) => r.id === "p1")?.placeId).toBe("seating-area");
    expect(outcome.state.sortingCorrections).toHaveLength(1);
    expect(outcome.state.matchResults).toHaveLength(state.matchResults.length);
  });

  it("refuses proposals that do not support the confirmed target place", () => {
    const { visit, state } = fixture();
    const p3 = buildSortingQueue(visit, state, []).find((i) => i.record.id === "p3")!.proposal;
    const outcome = bulkAssignSortingPhotos(visit, state, [p3], "seating-area", NOW);
    expect(outcome.assignedIds).toEqual([]);
    expect(outcome.visit).toBe(visit);
  });
});

describe("sorting progress and anchor candidates", () => {
  it("only counts recorded curator decisions as confirmed", () => {
    const { visit, state } = fixture();
    const assigned: Visit = {
      ...visit,
      entries: [{ id: "e", imageRecordId: "p1", visitId: "v", status: "new", notes: "", tags: [], observations: [], reviewed: true, createdAt: NOW, updatedAt: NOW }],
      imageRecords: visit.imageRecords!.map((r) => (["p1", "p2"].includes(r.id) ? { ...r, placeId: "seating-area" } : r)),
    };
    const withDecision = { ...state, sortingCorrections: [{ id: "c", imageRecordId: "p1", decision: "approved" as const, proposalStatus: "proposed" as const, assignedPlaceId: "seating-area", candidates: [], decidedAt: NOW }] };
    const progress = buildSortingProgress(assigned, withDecision);

    expect(progress).toMatchObject({ total: 6, assigned: 2, curatorConfirmed: 1, overview: 1, editoriallyReviewed: 1, awaiting: 3 });

    const candidates = listArchiveAnchorCandidates(assigned, withDecision, "seating-area");
    expect(candidates.map((c) => [c.record.id, c.verified])).toEqual([["p1", true], ["p2", false]]);
  });

  it("never offers overview, detail or external photographs as anchor candidates", () => {
    const { visit, state } = fixture();
    const all: Visit = {
      ...visit,
      imageRecords: [
        record("a", { placeId: "seating-area" }),
        record("b", { placeId: "seating-area", overviewClassification: { classifiedAt: NOW } }),
        record("c", { placeId: "seating-area", placeDetailClassification: { classifiedAt: NOW } }),
        record("d", { placeId: "seating-area", externalClassification: { classifiedAt: NOW } }),
      ],
    };
    expect(listArchiveAnchorCandidates(all, state, "seating-area").map((c) => c.record.id)).toEqual(["a"]);
  });
});
