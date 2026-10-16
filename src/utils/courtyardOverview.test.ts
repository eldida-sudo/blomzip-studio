/**
 * @vitest-environment jsdom
 */

import { describe, expect, it, vi } from "vitest";
import type { DraftWorkspace, ImageRecord, PlaceMatchResult, PlaceTrainingState, PlaceVisualAnchor, Visit } from "../models/blomzip";
import { createArchiveStateSnapshot, parseArchiveBackup } from "./archivePersistence";
import {
  clearRecordOverview,
  isOverviewRecord,
  markRecordOverview,
  normalizeVisiblePlaceIds,
  setOverviewVisiblePlaces,
} from "./courtyardOverview";
import { discoverPlacesVisionSummary } from "./discoverPlacesVisionEngine";
import { clearRecordExternal, isPlaceMatchEligible, isRecordEligibleNow, markRecordExternal } from "./externalClassification";
import { countImagesByPlace, matchesPlaceFilter, OVERVIEW_PLACE_FILTER, UNASSIGNED_PLACE_FILTER } from "./galleryFilters";
import { mergeImportedVisit } from "./mergeImportedVisit";
import { cacheSignature, computeAnchorSetKey } from "./placeSignatureCache";
import { assignSortingPhoto, buildSortingQueue, listSetAsidePhotos, planSortingRun, rankPlacesForPhoto } from "./placeSorting";
import { computeSortingReadiness, runSortingBatch } from "./placeSortingRun";
import {
  approveMatch,
  countReevaluationCandidates,
  countRemainingCandidates,
  createEmptyPlaceTrainingState,
  listNearbyContextMatches,
  listPendingMatches,
  reassignMatch,
  saveReevaluatedMatch,
  selectMatchCandidates,
  selectReevaluationCandidates,
} from "./placeTraining";
import type { PlaceMatchOutcome, VisionProvider } from "./visionProvider";

const NOW = "2026-10-16T10:00:00.000Z";
const PLACES = ["seating-area", "raised-bed", "house-wall"];

function record(id: string, extra: Partial<ImageRecord> = {}): ImageRecord {
  return { id, filename: `${id}.jpg`, fileSize: 1, format: "jpeg", sourcePath: `${id}.jpg`, thumbnailUrl: `blob:${id}`, ...extra };
}

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
      observations: [],
      storySelected: true,
      createdAt: NOW,
      updatedAt: NOW,
    })),
    imageRecords: records,
  };
}

function match(imageRecordId: string, placeId: string, classification: "SAME_PLACE" | "NEARBY_CONTEXT" = "SAME_PLACE"): PlaceMatchResult {
  return {
    id: `match-${placeId}-${imageRecordId}`,
    placeId,
    imageRecordId,
    classification,
    matchedFeatures: ["a", "b"],
    score: 0.9,
    reason: "r",
    provider: "test",
    analysisVersion: 1,
    matchedAt: NOW,
    status: "pending",
  };
}

function anchor(id: string, placeId: string): PlaceVisualAnchor {
  return { id, placeId, filename: `${id}.jpg`, mimeType: "image/jpeg", createdAt: NOW, source: "upload" };
}

const overviewRecord = (id = "ov", extra: Partial<ImageRecord> = {}) =>
  record(id, { overviewClassification: { classifiedAt: NOW }, ...extra });
const emptyWorkspace: DraftWorkspace = { drafts: [], activeDraftId: null };

function ok<T extends { ok: boolean }>(outcome: T): Extract<T, { ok: true }> {
  if (!outcome.ok) throw new Error(String((outcome as { error?: string }).error));
  return outcome as Extract<T, { ok: true }>;
}

describe("courtyard overview helpers", () => {
  it("is separate from unassigned, assigned and External records", () => {
    expect(isOverviewRecord(overviewRecord())).toBe(true);
    expect(isOverviewRecord(record("a"))).toBe(false);
    expect(isPlaceMatchEligible(record("a"))).toBe(true);
    expect(isPlaceMatchEligible(overviewRecord())).toBe(false);
  });

  it("marks and clears without touching anything else, and is fully reversible", () => {
    const visit = visitOf([record("a", { notes: "n", tags: ["x"] }), record("b")]);
    const marked = ok(markRecordOverview(visit, "a", NOW));

    expect(marked.visit.imageRecords?.[0].overviewClassification).toEqual({ classifiedAt: NOW });
    expect(marked.visit.imageRecords?.[0]).not.toHaveProperty("placeId");
    expect(marked.visit.imageRecords?.[0]).not.toHaveProperty("externalClassification");
    expect(marked.visit.imageRecords?.[1]).toBe(visit.imageRecords?.[1]);
    expect(marked.visit.entries).toBe(visit.entries);
    expect(visit.imageRecords?.[0].overviewClassification).toBeUndefined();

    const cleared = ok(clearRecordOverview(marked.visit, "a"));
    expect(cleared.visit.imageRecords).toEqual(visit.imageRecords);
    expect(cleared.visit.imageRecords?.[0]).not.toHaveProperty("overviewClassification");
  });

  it("refuses an assigned photograph and never unassigns it", () => {
    const visit = visitOf([record("a", { placeId: "seating-area" })]);

    expect(markRecordOverview(visit, "a", NOW).ok).toBe(false);
    expect(visit.imageRecords?.[0].placeId).toBe("seating-area");
  });

  it("conflicts with External / Inspiration in both directions without changing either", () => {
    const external = visitOf([record("e", { externalClassification: { classifiedAt: NOW } })]);
    expect(markRecordOverview(external, "e", NOW).ok).toBe(false);

    const overview = visitOf([overviewRecord()]);
    const refused = markRecordExternal(overview, "ov", NOW);
    expect(refused.ok).toBe(false);
    expect(overview.imageRecords?.[0]).not.toHaveProperty("externalClassification");

    const backToPool = ok(clearRecordOverview(overview, "ov"));
    expect(markRecordExternal(backToPool.visit, "ov", NOW).ok).toBe(true);
  });

  it("is idempotent and reports missing photographs", () => {
    const visit = visitOf([overviewRecord()]);
    const again = ok(markRecordOverview(visit, "ov", "later"));

    expect(again.visit).toBe(visit);
    expect(markRecordOverview(visit, "nope").ok).toBe(false);
    expect(clearRecordOverview(visit, "nope").ok).toBe(false);
    expect(setOverviewVisiblePlaces(visit, "nope", []).ok).toBe(false);
    const plain = visitOf([record("a")]);
    expect(ok(clearRecordOverview(plain, "a")).visit).toBe(plain);
  });

  it("re-checks eligibility against the latest visit", () => {
    expect(isRecordEligibleNow(visitOf([record("a")]), "a")).toBe(true);
    expect(isRecordEligibleNow(visitOf([overviewRecord()]), "ov")).toBe(false);
  });
});

describe("secondary visible-place references", () => {
  const rock = "rock-garden";
  const pine = "shade-corner";

  it("records several existing places as references, not as a primary assignment", () => {
    const visit = visitOf([overviewRecord()]);
    const updated = ok(setOverviewVisiblePlaces(visit, "ov", [rock, pine, "miriams-bed", "central-lawn"])).visit;
    const rec = updated.imageRecords![0];

    expect(rec.overviewClassification?.visiblePlaceIds).toEqual([rock, pine, "miriams-bed", "central-lawn"]);
    expect(rec.placeId).toBeUndefined();
    expect(isPlaceMatchEligible(rec)).toBe(false);
    expect(matchesPlaceFilter({ imageRecord: rec }, rock)).toBe(false);
    expect(countImagesByPlace([{ imageRecord: rec }], false).byPlace).toEqual({});
  });

  it("drops unknown and duplicate IDs, and is idempotent", () => {
    expect(normalizeVisiblePlaceIds([rock, rock, "not-a-place", pine])).toEqual([rock, pine]);
    const visit = ok(setOverviewVisiblePlaces(visitOf([overviewRecord()]), "ov", [rock])).visit;
    expect(ok(setOverviewVisiblePlaces(visit, "ov", [rock, rock])).visit).toBe(visit);
  });

  it("removes the key when the list is emptied, and requires an Overview photograph", () => {
    const visit = ok(setOverviewVisiblePlaces(visitOf([overviewRecord()]), "ov", [rock])).visit;
    const emptied = ok(setOverviewVisiblePlaces(visit, "ov", [])).visit;

    expect(emptied.imageRecords?.[0].overviewClassification).toEqual({ classifiedAt: NOW });
    expect(setOverviewVisiblePlaces(visitOf([record("a")]), "a", [rock]).ok).toBe(false);
  });

  it("are removed together with the classification on reversal and never become anchors", () => {
    const visit = ok(setOverviewVisiblePlaces(visitOf([overviewRecord()]), "ov", [rock])).visit;
    const cleared = ok(clearRecordOverview(visit, "ov")).visit;

    expect(cleared.imageRecords?.[0]).toEqual(record("ov"));
    expect(createEmptyPlaceTrainingState().anchorsByPlaceId).toEqual({});
  });
});

describe("overview records are excluded from matching surfaces", () => {
  const visit = visitOf([record("a"), overviewRecord()]);
  const state: PlaceTrainingState = {
    ...createEmptyPlaceTrainingState(),
    matchResults: [match("a", "seating-area"), match("ov", "seating-area"), match("ov", "raised-bed", "NEARBY_CONTEXT")],
  };

  it("candidate selection and counts", () => {
    const empty = createEmptyPlaceTrainingState();
    expect(selectMatchCandidates(visit, "seating-area", empty).map((r) => r.id)).toEqual(["a"]);
    expect(countRemainingCandidates(visit, "seating-area", empty)).toBe(1);
  });

  it("re-evaluation selection and counts", () => {
    expect(selectReevaluationCandidates(visit, "seating-area", state).map((r) => r.id)).toEqual(["a"]);
    expect(countReevaluationCandidates(visit, "seating-area", state)).toBe(1);
  });

  it("preserves match results and shows them again after reversal", () => {
    expect(listPendingMatches(visit, "seating-area", state).map((r) => r.imageRecordId)).toEqual(["a"]);
    expect(listNearbyContextMatches(visit, "raised-bed", state)).toEqual([]);
    expect(state.matchResults).toHaveLength(3);

    const restored = ok(clearRecordOverview(visit, "ov")).visit;
    expect(listPendingMatches(restored, "seating-area", state).map((r) => r.imageRecordId).sort()).toEqual(["a", "ov"]);
    expect(listNearbyContextMatches(restored, "raised-bed", state)).toHaveLength(1);
  });

  it("sorting queue, set-aside list and plan", () => {
    const trained = { ...state, anchorsByPlaceId: { "seating-area": [1, 2, 3].map((n) => anchor(`s${n}`, "seating-area")) } };
    expect(buildSortingQueue(visit, trained, ["seating-area"]).map((e) => e.record.id)).toEqual(["a"]);
    expect(listSetAsidePhotos(visit, trained)).toEqual([]);
    expect(planSortingRun(visitOf([overviewRecord()]), createEmptyPlaceTrainingState(), PLACES)).toEqual({ items: [], comparisonCount: 0 });
  });

  it("place discovery ignores them", () => {
    const records = ["a", "b", "ov"].map((id, index) =>
      record(id, {
        sourcePath: `yard/${id}.jpg`,
        width: 4000,
        height: 3000,
        orientation: "landscape",
        timelineIndex: index,
        ...(id === "ov" ? { overviewClassification: { classifiedAt: NOW } } : {}),
      })
    );
    const summary = discoverPlacesVisionSummary(visitOf(records));

    expect(summary.analyzedImageCount).toBe(2);
    expect(summary.candidatePlaceGroups.flatMap((g) => g.imageRecordIds)).not.toContain("ov");
  });
});

describe("assignment guards", () => {
  const ov = visitOf([overviewRecord()]);
  const state: PlaceTrainingState = { ...createEmptyPlaceTrainingState(), matchResults: [match("ov", "seating-area")] };

  it("approve, reassign and sorting assignment are refused and change nothing", () => {
    expect(approveMatch(ov, state, "match-seating-area-ov").ok).toBe(false);
    expect(reassignMatch(ov, state, "match-seating-area-ov", "raised-bed").ok).toBe(false);
    expect(assignSortingPhoto(ov, state, rankPlacesForPhoto("ov", state, ["seating-area"]), "seating-area").ok).toBe(false);
    expect(ov.imageRecords?.[0].placeId).toBeUndefined();
  });

  it("re-evaluation results are not saved", () => {
    expect(saveReevaluatedMatch(ov, state, { ...match("ov", "seating-area"), score: 0.1 })).toBeNull();
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

  it("estimates zero comparisons and makes zero provider calls when every photograph is an overview", async () => {
    const env = setup([overviewRecord("o1"), overviewRecord("o2")]);
    const readiness = await computeSortingReadiness(env.visit, env.getTraining(), env.anchorImages, env.hash);

    expect(readiness.plan).toEqual({ items: [], comparisonCount: 0 });
    expect(readiness.uncachedSignaturePlaceIds).toEqual([]);

    const summary = await runSortingBatch(env.visit, {
      provider: env.provider,
      getTraining: env.getTraining,
      commit: env.commit,
      anchorImages: env.anchorImages,
      prepareCandidateImage: async () => "data:image/jpeg;base64,AA==",
      isCancelled: () => false,
      hash: env.hash,
    });

    expect(summary).toMatchObject({ comparisonCalls: 0, signatureCalls: 0, failures: 0 });
    expect(env.matchFn).not.toHaveBeenCalled();
    expect(env.derive).not.toHaveBeenCalled();
  });

  it("only counts eligible photographs in the estimate", async () => {
    const env = setup([record("a"), overviewRecord()]);
    const readiness = await computeSortingReadiness(env.visit, env.getTraining(), env.anchorImages, env.hash);

    expect(readiness.plan.items.map((i) => i.record.id)).toEqual(["a"]);
    expect(readiness.plan.comparisonCount).toBe(3);
  });

  it("stops requests and discards the result when the curator marks a photograph Overview mid-run", async () => {
    const env = setup([record("a"), record("b")]);
    await env.seedSignatures();
    let liveVisit: Visit = env.visit;
    const marked = ok(markRecordOverview(liveVisit, "a", NOW));

    env.matchFn.mockImplementationOnce(async (request: { placeId: string; imageRecordId: string }) => {
      liveVisit = marked.visit;
      return env.outcome(request);
    });

    const summary = await runSortingBatch(env.visit, {
      provider: env.provider,
      getTraining: env.getTraining,
      commit: env.commit,
      anchorImages: env.anchorImages,
      prepareCandidateImage: async () => "data:image/jpeg;base64,AA==",
      isCancelled: () => false,
      getVisit: () => liveVisit,
      hash: env.hash,
    });

    expect(env.matchFn.mock.calls.filter(([request]) => request.imageRecordId === "a")).toHaveLength(1);
    expect(env.matchFn.mock.calls.filter(([request]) => request.imageRecordId === "b")).toHaveLength(3);
    expect(env.getTraining().matchResults.some((result) => result.imageRecordId === "a")).toBe(false);
    expect(env.getTraining().matchResults.filter((result) => result.imageRecordId === "b")).toHaveLength(3);
    expect(summary.failures).toBe(0);
    expect(liveVisit.imageRecords?.[0].placeId).toBeUndefined();
  });
});

describe("gallery filters and counts", () => {
  const items = [
    { imageRecord: record("a") },
    { imageRecord: record("b", { placeId: "seating-area" }) },
    { imageRecord: record("e", { externalClassification: { classifiedAt: NOW } }) },
    { imageRecord: overviewRecord() },
  ];

  it("filters Overview separately and excludes it from Unassigned", () => {
    expect(items.filter((i) => matchesPlaceFilter(i, OVERVIEW_PLACE_FILTER)).map((i) => i.imageRecord.id)).toEqual(["ov"]);
    expect(items.filter((i) => matchesPlaceFilter(i, UNASSIGNED_PLACE_FILTER)).map((i) => i.imageRecord.id)).toEqual(["a"]);
    expect(items.filter((i) => matchesPlaceFilter(i, "seating-area")).map((i) => i.imageRecord.id)).toEqual(["b"]);
  });

  it("counts Overview separately from Unassigned and External", () => {
    expect(countImagesByPlace(items, false)).toEqual({
      total: 4,
      unassigned: 1,
      external: 1,
      overview: 1,
      byPlace: { "seating-area": 1 },
    });
  });
});

describe("persistence, backups, drafts and merging", () => {
  const markedVisit = (): Visit => {
    const marked = ok(markRecordOverview(visitOf([record("a"), record("ov", { notes: "balcony", tags: ["x"] })]), "ov", NOW));
    return ok(setOverviewVisiblePlaces(marked.visit, "ov", ["rock-garden", "shade-corner"])).visit;
  };
  const expected = { classifiedAt: NOW, visiblePlaceIds: ["rock-garden", "shade-corner"] };

  it("survives archive snapshot, JSON export and import, preserving all other fields", () => {
    const snapshot = createArchiveStateSnapshot({ importVisit: markedVisit(), draftWorkspace: emptyWorkspace });
    const parsed = ok(parseArchiveBackup(JSON.stringify(snapshot)));
    const restored = parsed.state.importVisit?.imageRecords?.find((r) => r.id === "ov");

    expect(restored?.overviewClassification).toEqual(expected);
    expect(restored).toMatchObject({ notes: "balcony", tags: ["x"], sourcePath: "ov.jpg" });
    expect(restored).not.toHaveProperty("placeId");
    expect(parsed.state.importVisit?.entries[1]).toMatchObject({ notes: "keep me", storySelected: true });
    expect(parsed.state.importVisit?.imageRecords?.find((r) => r.id === "a")).not.toHaveProperty("overviewClassification");
  });

  it("survives draft workspaces", () => {
    const workspace: DraftWorkspace = {
      activeDraftId: "d1",
      drafts: [{ id: "d1", label: "Draft", createdAt: NOW, savedAt: NOW, visit: markedVisit(), studioImages: [] }],
    };
    const snapshot = createArchiveStateSnapshot({ importVisit: markedVisit(), draftWorkspace: workspace });
    const parsed = ok(parseArchiveBackup(JSON.stringify(snapshot)));

    expect(parsed.state.draftWorkspace.drafts[0].visit.imageRecords?.[1].overviewClassification).toEqual(expected);
  });

  it("loads old backups without the field unchanged", () => {
    const legacy = createArchiveStateSnapshot({ importVisit: visitOf([record("a")]), draftWorkspace: emptyWorkspace });
    const parsed = ok(parseArchiveBackup(JSON.stringify({ ...legacy, schemaVersion: 2 })));

    expect(parsed.state.importVisit?.imageRecords?.every((r) => !("overviewClassification" in r))).toBe(true);
  });

  it("is reversible after a persistence round trip", () => {
    const snapshot = createArchiveStateSnapshot({ importVisit: markedVisit(), draftWorkspace: emptyWorkspace });
    const parsed = ok(parseArchiveBackup(JSON.stringify(snapshot)));
    const cleared = ok(clearRecordOverview(parsed.state.importVisit!, "ov"));
    const rec = cleared.visit.imageRecords?.find((r) => r.id === "ov");

    expect(rec).toMatchObject({ notes: "balcony", tags: ["x"] });
    expect(isOverviewRecord(rec)).toBe(false);
  });

  it("keeps the classification when a duplicate photograph is imported again", () => {
    const current = visitOf([record("ov", { contentHash: "h1", overviewClassification: { classifiedAt: NOW } })]);
    const merged = mergeImportedVisit(current, visitOf([record("ov-2", { contentHash: "h1" })]));

    expect(merged?.imageRecords).toHaveLength(1);
    expect(merged?.imageRecords?.[0].overviewClassification).toEqual({ classifiedAt: NOW });
  });

  it("does not change External / Inspiration behaviour", () => {
    const visit = visitOf([record("e")]);
    const marked = ok(markRecordExternal(visit, "e", NOW));
    expect(isPlaceMatchEligible(marked.visit.imageRecords![0])).toBe(false);
    expect(ok(clearRecordExternal(marked.visit, "e")).visit.imageRecords).toEqual(visit.imageRecords);
  });
});
