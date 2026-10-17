/**
 * @vitest-environment jsdom
 */

import { describe, expect, it, vi } from "vitest";
import type { DraftWorkspace, ImageRecord, PlaceMatchResult, PlaceTrainingState, PlaceVisualAnchor, Visit } from "../models/blomzip";
import { createArchiveStateSnapshot, parseArchiveBackup } from "./archivePersistence";
import { clearRecordOverview, markRecordOverview } from "./courtyardOverview";
import { discoverPlacesVisionSummary } from "./discoverPlacesVisionEngine";
import { isPlaceMatchEligible, markRecordExternal } from "./externalClassification";
import { countImagesByPlace, matchesPlaceFilter, UNASSIGNED_PLACE_FILTER } from "./galleryFilters";
import { mergeImportedVisit } from "./mergeImportedVisit";
import {
  applyBulkPlaceDetail,
  clearRecordPlaceDetail,
  isPlaceDetailRecord,
  markRecordPlaceDetail,
  planBulkPlaceDetail,
  undoBulkPlaceDetail,
} from "./placeDetail";
import { cacheSignature, computeAnchorSetKey } from "./placeSignatureCache";
import { assignSortingPhoto, buildSortingQueue, planSortingRun, rankPlacesForPhoto } from "./placeSorting";
import { computeSortingReadiness, runSortingBatch } from "./placeSortingRun";
import {
  approveMatch,
  createEmptyPlaceTrainingState,
  listArchiveAnchorCandidates,
  reassignMatch,
  selectMatchCandidates,
  undoReview,
  validateArchiveAnchorSelection,
} from "./placeTraining";
import type { PlaceMatchOutcome, VisionProvider } from "./visionProvider";

const NOW = "2026-10-17T10:00:00.000Z";
const PLACES = ["seating-area", "raised-bed", "house-wall"];

function record(id: string, extra: Partial<ImageRecord> = {}): ImageRecord {
  return { id, filename: `${id}.jpg`, fileSize: 1, format: "jpeg", sourcePath: `${id}.jpg`, thumbnailUrl: `blob:${id}`, ...extra };
}

const detail = (id: string, placeId = "seating-area", extra: Partial<ImageRecord> = {}) =>
  record(id, { placeId, placeDetailClassification: { classifiedAt: NOW }, ...extra });

function visitOf(records: ImageRecord[]): Visit {
  return {
    id: "v",
    placeId: "courtyard",
    date: "2026-10-05",
    entries: records.map((r) => ({
      id: `entry-${r.id}`,
      imageRecordId: r.id,
      visitId: "v",
      status: "new" as const,
      notes: "keep me",
      tags: ["t"],
      observations: [{ id: `o-${r.id}` }] as never,
      storySelected: true,
      reviewed: true,
      createdAt: NOW,
      updatedAt: NOW,
    })),
    imageRecords: records,
  };
}

function match(imageRecordId: string, placeId: string, status: PlaceMatchResult["status"] = "pending"): PlaceMatchResult {
  return {
    id: `match-${placeId}-${imageRecordId}`,
    placeId,
    imageRecordId,
    classification: "SAME_PLACE",
    matchedFeatures: ["a", "b"],
    score: 0.9,
    reason: "r",
    provider: "test",
    analysisVersion: 1,
    matchedAt: NOW,
    status,
  };
}

function anchor(id: string, placeId: string): PlaceVisualAnchor {
  return { id, placeId, filename: `${id}.jpg`, mimeType: "image/jpeg", createdAt: NOW, source: "upload" };
}

function ok<T extends { ok: boolean }>(outcome: T): Extract<T, { ok: true }> {
  if (!outcome.ok) throw new Error(String((outcome as { error?: string }).error));
  return outcome as Extract<T, { ok: true }>;
}

const emptyWorkspace: DraftWorkspace = { drafts: [], activeDraftId: null };

describe("manual Place Detail classification", () => {
  it("assigns the chosen place to an unassigned photograph and is reversible without losing the place", () => {
    const visit = visitOf([record("a", { notes: "n", tags: ["x"] }), record("b")]);
    const marked = ok(markRecordPlaceDetail(visit, "a", "miriams-bed", NOW));
    const rec = marked.visit.imageRecords![0];

    expect(rec).toMatchObject({ placeId: "miriams-bed", placeDetailClassification: { classifiedAt: NOW }, notes: "n", tags: ["x"] });
    expect(marked.visit.imageRecords![1]).toBe(visit.imageRecords![1]);
    expect(marked.visit.entries).toBe(visit.entries);
    expect(visit.imageRecords![0]).not.toHaveProperty("placeDetailClassification");

    const cleared = ok(clearRecordPlaceDetail(marked.visit, "a"));
    expect(cleared.visit.imageRecords![0]).toMatchObject({ placeId: "miriams-bed", notes: "n" });
    expect(isPlaceDetailRecord(cleared.visit.imageRecords![0])).toBe(false);
  });

  it("keeps an existing place when it matches the confirmed one", () => {
    const visit = visitOf([record("a", { placeId: "seating-area" })]);
    const marked = ok(markRecordPlaceDetail(visit, "a", "seating-area", NOW));

    expect(marked.visit.imageRecords![0].placeId).toBe("seating-area");
    expect(ok(clearRecordPlaceDetail(marked.visit, "a")).visit.imageRecords).toEqual(visit.imageRecords);
  });

  it("never overwrites a different existing place", () => {
    const visit = visitOf([record("a", { placeId: "seating-area" })]);
    const outcome = markRecordPlaceDetail(visit, "a", "raised-bed", NOW);

    expect(outcome.ok).toBe(false);
    expect(visit.imageRecords![0]).toEqual(record("a", { placeId: "seating-area" }));
  });

  it("rejects unknown places and missing photographs, and is idempotent", () => {
    const visit = visitOf([detail("a")]);

    expect(markRecordPlaceDetail(visit, "a", "nowhere", NOW).ok).toBe(false);
    expect(markRecordPlaceDetail(visit, "missing", "seating-area", NOW).ok).toBe(false);
    expect(ok(markRecordPlaceDetail(visit, "a", "seating-area", "later")).visit).toBe(visit);
    expect(ok(clearRecordPlaceDetail(visitOf([record("b")]), "b")).visit.imageRecords).toEqual([record("b")]);
  });

  it("is incompatible with External / Inspiration and Courtyard Overview in both directions", () => {
    const external = visitOf([record("e", { externalClassification: { classifiedAt: NOW } })]);
    const overview = visitOf([record("o", { overviewClassification: { classifiedAt: NOW } })]);
    const marked = visitOf([detail("d")]);

    expect(markRecordPlaceDetail(external, "e", "seating-area", NOW).ok).toBe(false);
    expect(markRecordPlaceDetail(overview, "o", "seating-area", NOW).ok).toBe(false);
    expect(markRecordExternal(marked, "d", NOW).ok).toBe(false);
    expect(markRecordOverview(marked, "d", NOW).ok).toBe(false);
    expect(ok(clearRecordOverview(overview, "o")).visit.imageRecords![0]).toEqual(record("o"));
  });
});

describe("matching, sorting and discovery exclusion", () => {
  it("is not match eligible, even if the place assignment were missing", () => {
    expect(isPlaceMatchEligible(detail("a"))).toBe(false);
    expect(isPlaceMatchEligible({ placeDetailClassification: { classifiedAt: NOW } })).toBe(false);
    expect(isPlaceMatchEligible(record("a"))).toBe(true);
  });

  it("is excluded from candidates, sorting plans, the sorting queue and discovery", () => {
    const orphan = record("orphan", { placeDetailClassification: { classifiedAt: NOW } });
    const visit = visitOf([record("a"), detail("d"), orphan]);
    const state = createEmptyPlaceTrainingState();

    expect(selectMatchCandidates(visit, "seating-area", state).map((r) => r.id)).toEqual(["a"]);
    expect(planSortingRun(visit, state, PLACES).items.map((i) => i.record.id)).toEqual(["a"]);

    const withResults = { ...state, matchResults: [match("d", "seating-area"), match("orphan", "seating-area")] };
    expect(buildSortingQueue(visit, withResults, ["seating-area"])).toEqual([]);
    expect(rankPlacesForPhoto("a", withResults, PLACES).status).toBe("unassigned");

    const summary = discoverPlacesVisionSummary(visit);
    expect(JSON.stringify(summary.candidatePlaceGroups)).not.toContain('"d"');
    expect(JSON.stringify(summary.candidatePlaceGroups)).not.toContain("orphan");
  });

  it("blocks approving, reassigning, sorting-assigning and undoing onto a Place Detail photograph", () => {
    const orphan = record("orphan", { placeDetailClassification: { classifiedAt: NOW } });
    const visit = visitOf([orphan]);
    const state = { ...createEmptyPlaceTrainingState(), matchResults: [match("orphan", "seating-area")] };

    expect(approveMatch(visit, state, "match-seating-area-orphan").ok).toBe(false);
    expect(reassignMatch(visit, state, "match-seating-area-orphan", "raised-bed", NOW).ok).toBe(false);
    expect(assignSortingPhoto(visit, state, rankPlacesForPhoto("orphan", state, PLACES), "seating-area", NOW).ok).toBe(false);

    const reviewed = {
      ...state,
      matchResults: [{ ...match("d", "seating-area", "rejected"), review: { decision: "reassigned" as const, assignedPlaceId: "seating-area", decidedAt: NOW } }],
    };
    const undone = undoReview(visitOf([detail("d")]), reviewed, "match-seating-area-d");
    expect(undone.ok).toBe(false);
  });
});

describe("visual anchors", () => {
  it("never offers or accepts Place Detail photographs as anchors", () => {
    const visit = visitOf([record("a", { placeId: "seating-area" }), detail("d")]);
    const state = createEmptyPlaceTrainingState();

    expect(listArchiveAnchorCandidates(visit, state, "seating-area").map((c) => c.record.id)).toEqual(["a"]);

    const outcome = validateArchiveAnchorSelection(visit, state, "seating-area", ["d"]);
    expect(outcome.ok).toBe(false);
    expect(!outcome.ok && outcome.error).toMatch(/cannot be visual anchors/);
  });
});

describe("bulk classification", () => {
  const visit = () =>
    visitOf([
      record("free"),
      record("same", { placeId: "miriams-bed", notes: "keep" }),
      record("other", { placeId: "seating-area" }),
      record("ext", { externalClassification: { classifiedAt: NOW } }),
      record("ov", { overviewClassification: { classifiedAt: NOW } }),
      detail("done", "miriams-bed"),
      detail("elsewhere", "seating-area"),
    ]);
  const ids = ["free", "same", "other", "ext", "ov", "done", "elsewhere", "missing", "free"];

  it("previews applicable, already done and conflicting records without mutating", () => {
    const v = visit();
    const plan = planBulkPlaceDetail(v, ids, "miriams-bed");

    expect(plan.applicableIds).toEqual(["free", "same"]);
    expect(plan.newlyAssignedCount).toBe(1);
    expect(plan.alreadyDoneIds).toEqual(["done"]);
    expect(plan.conflicts.map((c) => [c.imageRecordId, c.reason])).toEqual([
      ["other", "other-place"],
      ["ext", "external"],
      ["ov", "overview"],
      ["elsewhere", "other-place"],
      ["missing", "missing"],
    ]);
    expect(v).toEqual(visit());
  });

  it("changes only applicable records and preserves everything else", () => {
    const v = visit();
    const outcome = ok(applyBulkPlaceDetail(v, ids, "miriams-bed", NOW));
    const byId = new Map(outcome.visit.imageRecords!.map((r) => [r.id, r]));

    expect(outcome.appliedCount).toBe(2);
    expect(outcome.skippedCount).toBe(6);
    expect(byId.get("free")).toMatchObject({ placeId: "miriams-bed", placeDetailClassification: { classifiedAt: NOW } });
    expect(byId.get("same")).toMatchObject({ placeId: "miriams-bed", notes: "keep", placeDetailClassification: { classifiedAt: NOW } });
    for (const untouched of ["other", "ext", "ov", "done", "elsewhere"]) {
      expect(byId.get(untouched)).toBe(v.imageRecords!.find((r) => r.id === untouched));
    }
    expect(outcome.visit.entries).toBe(v.entries);
  });

  it("does nothing without a place or without applicable records", () => {
    const v = visit();

    expect(applyBulkPlaceDetail(v, ["free"], "", NOW).ok).toBe(false);
    const noop = ok(applyBulkPlaceDetail(v, ["other", "ext"], "miriams-bed", NOW));
    expect(noop.visit).toBe(v);
    expect(noop.undo).toBeNull();
  });

  it("undo restores the original classification and place assignments exactly", () => {
    const v = visit();
    const outcome = ok(applyBulkPlaceDetail(v, ids, "miriams-bed", NOW));
    const undone = undoBulkPlaceDetail(outcome.visit, outcome.undo!);

    expect(undone.restoredCount).toBe(2);
    expect(undone.skippedCount).toBe(0);
    expect(undone.visit.imageRecords).toEqual(v.imageRecords);
  });

  it("undo leaves records the curator edited afterwards untouched", () => {
    const outcome = ok(applyBulkPlaceDetail(visit(), ["free", "same"], "miriams-bed", NOW));
    const edited = ok(clearRecordPlaceDetail(outcome.visit, "same")).visit;
    const moved: Visit = {
      ...edited,
      imageRecords: edited.imageRecords!.map((r) => (r.id === "free" ? { ...r, placeId: "raised-bed" } : r)),
    };
    const undone = undoBulkPlaceDetail(moved, outcome.undo!);

    expect(undone.restoredCount).toBe(0);
    expect(undone.skippedCount).toBe(2);
    expect(undone.visit.imageRecords).toEqual(moved.imageRecords);
  });

  it("does not undo a classification that was removed and re-applied later", () => {
    const outcome = ok(applyBulkPlaceDetail(visit(), ["free"], "miriams-bed", NOW));
    const cleared = ok(clearRecordPlaceDetail(outcome.visit, "free")).visit;
    const reapplied = ok(markRecordPlaceDetail(cleared, "free", "miriams-bed", "later")).visit;

    expect(undoBulkPlaceDetail(reapplied, outcome.undo!).restoredCount).toBe(0);
  });
});

describe("zero model calls and in-flight protection", () => {
  function setup(records: ImageRecord[]) {
    let training = createEmptyPlaceTrainingState();
    PLACES.forEach((placeId) => {
      training.anchorsByPlaceId[placeId] = [1, 2, 3].map((n) => anchor(`${placeId}-${n}`, placeId));
    });
    const anchorMap = new Map<string, { blob: Blob }>();
    Object.values(training.anchorsByPlaceId).flat().forEach((a) => anchorMap.set(a.id, { blob: new Blob([a.id]) }));
    const anchorImages = { get: (id: string) => anchorMap.get(id), has: (id: string) => anchorMap.has(id) };
    const hash = async (blob: Blob) => `h-${await blob.text()}`;
    const derive = vi.fn(async () => ({ core: ["x"], supporting: [], contextual: [] }));
    const outcome = (request: { placeId: string; imageRecordId: string }): PlaceMatchOutcome => ({
      placeId: request.placeId,
      imageRecordId: request.imageRecordId,
      classification: "SAME_PLACE",
      matchedFeatures: ["a", "b"],
      score: 0.9,
      reason: "r",
      provider: "test",
      analysisVersion: 1,
    });
    const matchFn = vi.fn(async (request: { placeId: string; imageRecordId: string }) => outcome(request));
    const provider = { id: "test", derivePlaceSignature: derive, matchPlaceCandidate: matchFn } as unknown as VisionProvider;

    return {
      visit: visitOf(records),
      anchorImages,
      hash,
      derive,
      matchFn,
      provider,
      outcome,
      getTraining: () => training,
      commit: (updater: (c: PlaceTrainingState) => PlaceTrainingState) => {
        training = updater(training);
      },
      seedSignatures: async () => {
        for (const placeId of PLACES) {
          const anchors = training.anchorsByPlaceId[placeId].map((a) => ({ id: a.id, blob: anchorMap.get(a.id)!.blob }));
          training = cacheSignature(training, placeId, await computeAnchorSetKey(anchors, hash), { core: ["x"], supporting: [], contextual: [] }, "test");
        }
      },
    };
  }

  const run = (env: ReturnType<typeof setup>, getVisit?: () => Visit) =>
    runSortingBatch(env.visit, {
      provider: env.provider,
      getTraining: env.getTraining,
      commit: env.commit,
      anchorImages: env.anchorImages,
      prepareCandidateImage: async () => "data:image/jpeg;base64,AA==",
      isCancelled: () => false,
      getVisit,
      hash: env.hash,
    });

  it("estimates zero calls and makes none when every photograph is a Place Detail", async () => {
    const env = setup([detail("d1"), detail("d2", "raised-bed")]);
    const readiness = await computeSortingReadiness(env.visit, env.getTraining(), env.anchorImages, env.hash);

    expect(readiness.plan).toEqual({ items: [], comparisonCount: 0 });
    expect(readiness.uncachedSignaturePlaceIds).toEqual([]);

    const summary = await run(env);
    expect(summary).toMatchObject({ comparisonCalls: 0, signatureCalls: 0, failures: 0 });
    expect(env.matchFn).not.toHaveBeenCalled();
    expect(env.derive).not.toHaveBeenCalled();
  });

  it("stops requests and discards the result when a photograph becomes a Place Detail mid-run", async () => {
    const env = setup([record("a"), record("b")]);
    await env.seedSignatures();
    let liveVisit: Visit = env.visit;
    const marked = ok(markRecordPlaceDetail(liveVisit, "a", "seating-area", NOW));

    env.matchFn.mockImplementationOnce(async (request: { placeId: string; imageRecordId: string }) => {
      liveVisit = marked.visit;
      return env.outcome(request);
    });

    const summary = await run(env, () => liveVisit);

    expect(env.matchFn.mock.calls.filter(([request]) => request.imageRecordId === "a")).toHaveLength(1);
    expect(env.matchFn.mock.calls.filter(([request]) => request.imageRecordId === "b")).toHaveLength(3);
    expect(env.getTraining().matchResults.some((result) => result.imageRecordId === "a")).toBe(false);
    expect(summary.failures).toBe(0);
    expect(liveVisit.imageRecords![0].placeId).toBe("seating-area");
  });
});

describe("gallery filters", () => {
  const items = [{ imageRecord: record("a") }, { imageRecord: detail("d", "miriams-bed") }, { imageRecord: record("b", { placeId: "miriams-bed" }) }];

  it("keeps Place Detail photographs in their place filter and counts, and out of Unassigned", () => {
    expect(items.filter((i) => matchesPlaceFilter(i, "miriams-bed")).map((i) => i.imageRecord.id)).toEqual(["d", "b"]);
    expect(items.filter((i) => matchesPlaceFilter(i, UNASSIGNED_PLACE_FILTER)).map((i) => i.imageRecord.id)).toEqual(["a"]);
    expect(countImagesByPlace(items, false)).toMatchObject({ total: 3, unassigned: 1, byPlace: { "miriams-bed": 2 } });
  });
});

describe("persistence, backups, drafts and merging", () => {
  const markedVisit = (): Visit =>
    ok(markRecordPlaceDetail(visitOf([record("a"), record("c", { notes: "tulips", tags: ["x"] })]), "c", "miriams-bed", NOW)).visit;

  it("survives snapshot, JSON export and import with all other fields and editorial decisions", () => {
    const parsed = ok(parseArchiveBackup(JSON.stringify(createArchiveStateSnapshot({ importVisit: markedVisit(), draftWorkspace: emptyWorkspace }))));
    const restored = parsed.state.importVisit?.imageRecords?.find((r) => r.id === "c");

    expect(restored).toMatchObject({ placeId: "miriams-bed", placeDetailClassification: { classifiedAt: NOW }, notes: "tulips", tags: ["x"] });
    expect(parsed.state.importVisit?.entries[1]).toMatchObject({ notes: "keep me", storySelected: true, reviewed: true });
    expect(parsed.state.importVisit?.entries[1].observations).toHaveLength(1);
    expect(parsed.state.importVisit?.imageRecords?.find((r) => r.id === "a")).not.toHaveProperty("placeDetailClassification");
  });

  it("survives draft workspaces", () => {
    const workspace: DraftWorkspace = {
      activeDraftId: "d1",
      drafts: [{ id: "d1", label: "Draft", createdAt: NOW, savedAt: NOW, visit: markedVisit(), studioImages: [] }],
    };
    const parsed = ok(parseArchiveBackup(JSON.stringify(createArchiveStateSnapshot({ importVisit: markedVisit(), draftWorkspace: workspace }))));

    expect(parsed.state.draftWorkspace.drafts[0].visit.imageRecords?.[1].placeDetailClassification).toEqual({ classifiedAt: NOW });
  });

  it("loads old backups without the field unchanged", () => {
    const legacy = createArchiveStateSnapshot({ importVisit: visitOf([record("a")]), draftWorkspace: emptyWorkspace });
    const parsed = ok(parseArchiveBackup(JSON.stringify({ ...legacy, schemaVersion: 2 })));

    expect(parsed.state.importVisit?.imageRecords?.every((r) => !("placeDetailClassification" in r))).toBe(true);
  });

  it("is reversible after a persistence round trip and keeps the place", () => {
    const parsed = ok(parseArchiveBackup(JSON.stringify(createArchiveStateSnapshot({ importVisit: markedVisit(), draftWorkspace: emptyWorkspace }))));
    const cleared = ok(clearRecordPlaceDetail(parsed.state.importVisit!, "c")).visit.imageRecords!.find((r) => r.id === "c");

    expect(cleared).toMatchObject({ placeId: "miriams-bed", notes: "tulips" });
    expect(isPlaceDetailRecord(cleared)).toBe(false);
  });

  it("keeps the classification and place when a duplicate photograph is imported again", () => {
    const current = visitOf([detail("d", "miriams-bed", { contentHash: "h1" })]);
    const merged = mergeImportedVisit(current, visitOf([record("d-2", { contentHash: "h1" })]));

    expect(merged?.imageRecords).toHaveLength(1);
    expect(merged?.imageRecords?.[0]).toMatchObject({ placeId: "miriams-bed", placeDetailClassification: { classifiedAt: NOW } });
  });
});
