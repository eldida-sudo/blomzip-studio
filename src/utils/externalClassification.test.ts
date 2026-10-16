/**
 * @vitest-environment jsdom
 */

import { describe, expect, it, vi } from "vitest";
import type { DraftWorkspace, ImageRecord, PlaceMatchResult, PlaceTrainingState, PlaceVisualAnchor, Visit } from "../models/blomzip";
import { createArchiveStateSnapshot, parseArchiveBackup } from "./archivePersistence";
import { discoverPlacesVisionSummary } from "./discoverPlacesVisionEngine";
import {
  clearRecordExternal,
  isExternalRecord,
  isPlaceMatchEligible,
  isRecordEligibleNow,
  markRecordExternal,
} from "./externalClassification";
import { countImagesByPlace, EXTERNAL_PLACE_FILTER, matchesPlaceFilter, UNASSIGNED_PLACE_FILTER } from "./galleryFilters";
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

const externalRecord = () => record("ext", { externalClassification: { classifiedAt: NOW } });
const emptyWorkspace: DraftWorkspace = { drafts: [], activeDraftId: null };

describe("external classification helpers", () => {
  it("keeps external separate from unassigned and from assigned records", () => {
    expect(isExternalRecord(externalRecord())).toBe(true);
    expect(isExternalRecord(record("a"))).toBe(false);
    expect(isPlaceMatchEligible(record("a"))).toBe(true);
    expect(isPlaceMatchEligible(externalRecord())).toBe(false);
    expect(isPlaceMatchEligible(record("b", { placeId: "seating-area" }))).toBe(false);
  });

  it("marks and clears without touching anything else, and is fully reversible", () => {
    const visit = visitOf([record("a", { notes: "n", tags: ["x"] }), record("b")]);
    const marked = markRecordExternal(visit, "a", NOW);
    if (!marked.ok) throw new Error(marked.error);

    expect(marked.visit.imageRecords?.[0].externalClassification).toEqual({ classifiedAt: NOW });
    expect(marked.visit.imageRecords?.[1]).toBe(visit.imageRecords?.[1]);
    expect(marked.visit.entries).toBe(visit.entries);
    expect(visit.imageRecords?.[0].externalClassification).toBeUndefined();

    const cleared = clearRecordExternal(marked.visit, "a");
    if (!cleared.ok) throw new Error(cleared.error);
    expect(cleared.visit.imageRecords).toEqual(visit.imageRecords);
    expect(cleared.visit.imageRecords?.[0]).not.toHaveProperty("externalClassification");
  });

  it("refuses to mark an assigned photograph and never unassigns it", () => {
    const visit = visitOf([record("a", { placeId: "seating-area" })]);
    const outcome = markRecordExternal(visit, "a", NOW);

    expect(outcome.ok).toBe(false);
    expect(visit.imageRecords?.[0].placeId).toBe("seating-area");
  });

  it("reports missing photographs and is idempotent", () => {
    const visit = visitOf([externalRecord()]);

    expect(markRecordExternal(visit, "nope").ok).toBe(false);
    expect(clearRecordExternal(visit, "nope").ok).toBe(false);
    const again = markRecordExternal(visit, "ext", "later");
    expect(again.ok && again.visit).toBe(visit);
    const cleared = clearRecordExternal(visitOf([record("a")]), "a");
    expect(cleared.ok && cleared.visit.imageRecords?.[0].id).toBe("a");
  });

  it("re-checks eligibility against the latest visit", () => {
    expect(isRecordEligibleNow(visitOf([record("a")]), "a")).toBe(true);
    expect(isRecordEligibleNow(visitOf([externalRecord()]), "ext")).toBe(false);
    expect(isRecordEligibleNow(visitOf([record("a")]), "gone")).toBe(false);
    expect(isRecordEligibleNow(null, "a")).toBe(false);
  });
});

describe("external records are excluded from matching surfaces", () => {
  const visit = visitOf([record("a"), externalRecord()]);
  const state: PlaceTrainingState = {
    ...createEmptyPlaceTrainingState(),
    matchResults: [match("a", "seating-area"), match("ext", "seating-area"), match("ext", "raised-bed", "NEARBY_CONTEXT")],
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

  it("pending suggestions are hidden but stored, and return after reversal", () => {
    expect(listPendingMatches(visit, "seating-area", state).map((r) => r.imageRecordId)).toEqual(["a"]);
    expect(listNearbyContextMatches(visit, "raised-bed", state)).toEqual([]);
    expect(state.matchResults).toHaveLength(3);

    const restored = clearRecordExternal(visit, "ext");
    if (!restored.ok) throw new Error(restored.error);
    expect(listPendingMatches(restored.visit, "seating-area", state).map((r) => r.imageRecordId).sort()).toEqual(["a", "ext"]);
    expect(listNearbyContextMatches(restored.visit, "raised-bed", state)).toHaveLength(1);
  });

  it("sorting queue, set-aside list and plan", () => {
    const trained = { ...state, anchorsByPlaceId: { "seating-area": [1, 2, 3].map((n) => anchor(`s${n}`, "seating-area")) } };
    expect(buildSortingQueue(visit, trained, ["seating-area"]).map((e) => e.record.id)).toEqual(["a"]);
    expect(listSetAsidePhotos(visit, trained)).toEqual([]);
    expect(planSortingRun(visitOf([externalRecord()]), createEmptyPlaceTrainingState(), PLACES)).toEqual({ items: [], comparisonCount: 0 });
  });

  it("place discovery ignores them", () => {
    const records = ["a", "b", "ext"].map((id, index) =>
      record(id, {
        sourcePath: `yard/${id}.jpg`,
        width: 4000,
        height: 3000,
        orientation: "landscape",
        timelineIndex: index,
        ...(id === "ext" ? { externalClassification: { classifiedAt: NOW } } : {}),
      })
    );
    const summary = discoverPlacesVisionSummary(visitOf(records));

    expect(summary.analyzedImageCount).toBe(2);
    expect(summary.candidatePlaceGroups.flatMap((g) => g.imageRecordIds)).not.toContain("ext");
  });
});

describe("assignment guards", () => {
  const ext = visitOf([externalRecord()]);
  const state: PlaceTrainingState = { ...createEmptyPlaceTrainingState(), matchResults: [match("ext", "seating-area")] };

  it("approve and reassign are refused and change nothing", () => {
    const approved = approveMatch(ext, state, "match-seating-area-ext");
    const reassigned = reassignMatch(ext, state, "match-seating-area-ext", "raised-bed");

    expect(approved.ok).toBe(false);
    expect(reassigned.ok).toBe(false);
    expect(ext.imageRecords?.[0].placeId).toBeUndefined();
  });

  it("sorting assignment is refused", () => {
    const proposal = rankPlacesForPhoto("ext", state, ["seating-area"]);
    const outcome = assignSortingPhoto(ext, state, proposal, "seating-area");

    expect(outcome.ok).toBe(false);
    expect(ext.imageRecords?.[0].placeId).toBeUndefined();
  });

  it("re-evaluation results for an external photograph are not saved", () => {
    expect(saveReevaluatedMatch(ext, state, { ...match("ext", "seating-area"), score: 0.1 })).toBeNull();
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
    const matchFn = vi.fn(
      async (request: { placeId: string; imageRecordId: string }): Promise<PlaceMatchOutcome> => ({
        placeId: request.placeId,
        imageRecordId: request.imageRecordId,
        classification: "SAME_PLACE",
        matchedFeatures: ["a", "b"],
        score: 0.9,
        reason: "r",
        provider: "test",
        analysisVersion: 1,
      })
    );
    const provider = { id: "test", derivePlaceSignature: derive, matchPlaceCandidate: matchFn } as unknown as VisionProvider;

    return {
      visit: visitOf(records),
      anchorImages,
      hash,
      derive,
      matchFn,
      provider,
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

  it("estimates zero comparisons and makes zero provider calls when every photograph is external", async () => {
    const env = setup([externalRecord(), record("ext2", { externalClassification: { classifiedAt: NOW } })]);
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
    const env = setup([record("a"), externalRecord()]);
    const readiness = await computeSortingReadiness(env.visit, env.getTraining(), env.anchorImages, env.hash);

    expect(readiness.plan.items.map((i) => i.record.id)).toEqual(["a"]);
    expect(readiness.plan.comparisonCount).toBe(3);
  });

  it("stops requests and discards the result when the curator marks a photograph external mid-run", async () => {
    const env = setup([record("a"), record("b")]);
    await env.seedSignatures();
    let liveVisit: Visit = env.visit;
    const marked = markRecordExternal(liveVisit, "a", NOW);
    if (!marked.ok) throw new Error(marked.error);

    env.matchFn.mockImplementationOnce(async (request: { placeId: string; imageRecordId: string }) => {
      liveVisit = marked.visit;
      return {
        placeId: request.placeId,
        imageRecordId: request.imageRecordId,
        classification: "SAME_PLACE",
        matchedFeatures: ["a", "b"],
        score: 0.9,
        reason: "r",
        provider: "test",
        analysisVersion: 1,
      } as PlaceMatchOutcome;
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

    // One in-flight request for "a" was already made; its result is dropped and no further "a" requests follow.
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
    { imageRecord: externalRecord() },
  ];

  it("filters External / Inspiration separately and excludes it from Unassigned", () => {
    expect(items.filter((i) => matchesPlaceFilter(i, EXTERNAL_PLACE_FILTER)).map((i) => i.imageRecord.id)).toEqual(["ext"]);
    expect(items.filter((i) => matchesPlaceFilter(i, UNASSIGNED_PLACE_FILTER)).map((i) => i.imageRecord.id)).toEqual(["a"]);
    expect(items.filter((i) => matchesPlaceFilter(i, "seating-area")).map((i) => i.imageRecord.id)).toEqual(["b"]);
  });

  it("counts external photographs separately from Unassigned", () => {
    expect(countImagesByPlace(items, false)).toEqual({ total: 3, unassigned: 1, external: 1, byPlace: { "seating-area": 1 } });
  });
});

describe("persistence, backups, drafts and merging", () => {
  const markedVisit = (): Visit => {
    const outcome = markRecordExternal(visitOf([record("a"), record("ext", { notes: "inspiration", tags: ["x"] })]), "ext", NOW);
    if (!outcome.ok) throw new Error(outcome.error);
    return outcome.visit;
  };

  it("survives archive snapshot, JSON export and import, preserving all other fields", () => {
    const visit = markedVisit();
    const snapshot = createArchiveStateSnapshot({ importVisit: visit, draftWorkspace: emptyWorkspace });
    const parsed = parseArchiveBackup(JSON.stringify(snapshot));
    if (!parsed.ok) throw new Error(parsed.error);
    const restored = parsed.state.importVisit?.imageRecords?.find((r) => r.id === "ext");

    expect(restored?.externalClassification).toEqual({ classifiedAt: NOW });
    expect(restored).toMatchObject({ notes: "inspiration", tags: ["x"], sourcePath: "ext.jpg" });
    expect(parsed.state.importVisit?.entries[1]).toMatchObject({ notes: "keep me", storySelected: true });
    expect(parsed.state.importVisit?.imageRecords?.find((r) => r.id === "a")).not.toHaveProperty("externalClassification");
  });

  it("survives draft workspaces", () => {
    const workspace: DraftWorkspace = {
      activeDraftId: "d1",
      drafts: [{ id: "d1", label: "Draft", createdAt: NOW, savedAt: NOW, visit: markedVisit(), studioImages: [] }],
    };
    const snapshot = createArchiveStateSnapshot({ importVisit: markedVisit(), draftWorkspace: workspace });
    const parsed = parseArchiveBackup(JSON.stringify(snapshot));
    if (!parsed.ok) throw new Error(parsed.error);

    expect(parsed.state.draftWorkspace.drafts[0].visit.imageRecords?.[1].externalClassification).toEqual({ classifiedAt: NOW });
  });

  it("loads old backups without the field unchanged", () => {
    const legacy = createArchiveStateSnapshot({ importVisit: visitOf([record("a")]), draftWorkspace: emptyWorkspace });
    const parsed = parseArchiveBackup(JSON.stringify({ ...legacy, schemaVersion: 2 }));
    if (!parsed.ok) throw new Error(parsed.error);

    expect(parsed.state.importVisit?.imageRecords?.every((r) => !("externalClassification" in r))).toBe(true);
  });

  it("is reversible after a persistence round trip", () => {
    const snapshot = createArchiveStateSnapshot({ importVisit: markedVisit(), draftWorkspace: emptyWorkspace });
    const parsed = parseArchiveBackup(JSON.stringify(snapshot));
    if (!parsed.ok || !parsed.state.importVisit) throw new Error("parse failed");
    const cleared = clearRecordExternal(parsed.state.importVisit, "ext");
    if (!cleared.ok) throw new Error(cleared.error);

    expect(cleared.visit.imageRecords?.find((r) => r.id === "ext")).toMatchObject({ notes: "inspiration", tags: ["x"] });
    expect(isExternalRecord(cleared.visit.imageRecords?.find((r) => r.id === "ext"))).toBe(false);
  });

  it("keeps the classification when a duplicate of the photograph is imported again", () => {
    const current = visitOf([record("ext", { contentHash: "h1", externalClassification: { classifiedAt: NOW } })]);
    const incoming = visitOf([record("ext-2", { contentHash: "h1" })]);
    const merged = mergeImportedVisit(current, incoming);

    expect(merged?.imageRecords).toHaveLength(1);
    expect(merged?.imageRecords?.[0].externalClassification).toEqual({ classifiedAt: NOW });
  });
});
