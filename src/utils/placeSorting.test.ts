/**
 * @vitest-environment jsdom
 */

import { describe, expect, it, vi } from "vitest";
import type {
  DraftWorkspace,
  ImageRecord,
  PlaceMatchClassification,
  PlaceMatchResult,
  PlaceTrainingState,
  PlaceVisualAnchor,
  Visit,
} from "../models/blomzip";
import { createArchiveStateSnapshot, parseArchiveBackup } from "./archivePersistence";
import { cacheSignature, computeAnchorSetKey, getCachedSignature, resolvePlaceSignature } from "./placeSignatureCache";
import {
  assignSortingPhoto,
  buildSortingQueue,
  buildTrainingReadiness,
  planSortingRun,
  rankPlacesForPhoto,
  returnPhotoToQueue,
  setPhotoAside,
  SORTING_BATCH_SIZE,
} from "./placeSorting";
import { computeSortingReadiness, runSortingBatch } from "./placeSortingRun";
import { createEmptyPlaceTrainingState, createMatchResultId, listPendingMatches, upsertMatchResult } from "./placeTraining";
import type { PlaceMatchOutcome, VisionProvider } from "./visionProvider";

const PLACES = ["seating-area", "raised-bed", "house-wall"];

function anchor(id: string, placeId: string): PlaceVisualAnchor {
  return { id, placeId, filename: `${id}.jpg`, mimeType: "image/jpeg", createdAt: "2026-10-01T00:00:00.000Z", source: "upload" };
}

function trainedState(): PlaceTrainingState {
  const state = createEmptyPlaceTrainingState();
  PLACES.forEach((placeId) => {
    state.anchorsByPlaceId[placeId] = [1, 2, 3].map((n) => anchor(`${placeId}-${n}`, placeId));
  });
  return state;
}

function record(id: string, extra: Partial<ImageRecord> = {}): ImageRecord {
  return { id, filename: `${id}.jpg`, fileSize: 1, format: "jpeg", sourcePath: `${id}.jpg`, thumbnailUrl: `blob:${id}`, ...extra };
}

function visitOf(records: ImageRecord[]): Visit {
  return { id: "v", placeId: "courtyard", date: "2026-10-05", entries: [], imageRecords: records };
}

function result(
  placeId: string,
  imageRecordId: string,
  classification: PlaceMatchClassification,
  score: number,
  features = ["bench", "wall"]
): PlaceMatchResult {
  return {
    id: createMatchResultId(placeId, imageRecordId),
    placeId,
    imageRecordId,
    classification,
    matchedFeatures: features,
    score,
    reason: "reason",
    provider: "test",
    analysisVersion: 1,
    matchedAt: "2026-10-05T00:00:00.000Z",
    status: "pending",
  };
}

function withResults(state: PlaceTrainingState, ...results: PlaceMatchResult[]) {
  return results.reduce(upsertMatchResult, state);
}

describe("rankPlacesForPhoto", () => {
  it("proposes one clearly supported primary place and keeps others as alternatives", () => {
    const state = withResults(
      trainedState(),
      result("seating-area", "p1", "SAME_PLACE", 0.92),
      result("raised-bed", "p1", "SAME_PLACE", 0.7),
      result("house-wall", "p1", "NEARBY_CONTEXT", 0.4)
    );
    const proposal = rankPlacesForPhoto("p1", state, PLACES);

    expect(proposal.status).toBe("proposed");
    expect(proposal.primary?.placeId).toBe("seating-area");
    expect(proposal.alternatives.map((c) => c.placeId)).toEqual(["raised-bed"]);
    expect(proposal.context.map((c) => c.placeId)).toEqual(["house-wall"]);
  });

  it("marks similarly plausible places as uncertain with no primary", () => {
    const state = withResults(
      trainedState(),
      result("seating-area", "p1", "SAME_PLACE", 0.9),
      result("raised-bed", "p1", "SAME_PLACE", 0.82),
      result("house-wall", "p1", "DIFFERENT_PLACE", 0.1)
    );
    const proposal = rankPlacesForPhoto("p1", state, PLACES);

    expect(proposal.status).toBe("uncertain");
    expect(proposal.primary).toBeUndefined();
  });

  it("marks weak evidence as uncertain", () => {
    const state = withResults(
      trainedState(),
      result("seating-area", "p1", "SAME_PLACE", 0.6),
      result("raised-bed", "p1", "DIFFERENT_PLACE", 0.1),
      result("house-wall", "p1", "DIFFERENT_PLACE", 0.1)
    );

    expect(rankPlacesForPhoto("p1", state, PLACES).status).toBe("uncertain");
  });

  it("leaves an overview with only background context unassigned and never proposes a context place", () => {
    const state = withResults(
      trainedState(),
      result("seating-area", "p1", "NEARBY_CONTEXT", 0.5),
      result("raised-bed", "p1", "NEARBY_CONTEXT", 0.45),
      result("house-wall", "p1", "DIFFERENT_PLACE", 0.1)
    );
    const proposal = rankPlacesForPhoto("p1", state, PLACES);

    expect(proposal.status).toBe("unassigned");
    expect(proposal.primary).toBeUndefined();
    expect(proposal.context).toHaveLength(2);
  });

  it("does not propose a primary place before every trained place has been compared", () => {
    const state = withResults(trainedState(), result("seating-area", "p1", "SAME_PLACE", 0.95));

    expect(rankPlacesForPhoto("p1", state, PLACES).status).toBe("incomplete");
  });
});

describe("planSortingRun", () => {
  it("caps the batch at five photographs and counts only missing comparisons", () => {
    const records = Array.from({ length: 8 }, (_, i) => record(`p${i}`));
    const state = withResults(trainedState(), result("seating-area", "p0", "SAME_PLACE", 0.9));
    const plan = planSortingRun(visitOf(records), state, PLACES);

    expect(SORTING_BATCH_SIZE).toBe(5);
    expect(plan.items).toHaveLength(5);
    // p0 is already compared for one place, so 2 + 4 * 3.
    expect(plan.comparisonCount).toBe(2 + 4 * 3);
  });

  it("skips assigned photographs, placeholders and photographs set aside", () => {
    const records = [
      record("assigned", { placeId: "seating-area" }),
      record("placeholder", { thumbnailUrl: "data:image/svg+xml;charset=utf-8,x" }),
      record("aside"),
      record("ok"),
    ];
    const aside = setPhotoAside(
      withResults(trainedState(), result("seating-area", "aside", "SAME_PLACE", 0.9)),
      rankPlacesForPhoto("aside", withResults(trainedState(), result("seating-area", "aside", "SAME_PLACE", 0.9)), PLACES)
    );
    const plan = planSortingRun(visitOf(records), aside, PLACES);

    expect(plan.items.map((item) => item.record.id)).toEqual(["ok"]);
  });
});

describe("assignSortingPhoto", () => {
  const competing = () =>
    withResults(
      trainedState(),
      result("seating-area", "p1", "SAME_PLACE", 0.95),
      result("raised-bed", "p1", "SAME_PLACE", 0.6),
      result("house-wall", "p1", "NEARBY_CONTEXT", 0.4)
    );

  it("approves the primary and resolves competing proposals without recording negative evidence", () => {
    const state = competing();
    const visit = visitOf([record("p1")]);
    const proposal = rankPlacesForPhoto("p1", state, PLACES);
    const outcome = assignSortingPhoto(visit, state, proposal, "seating-area", "2026-10-06T00:00:00.000Z");

    if (!outcome.ok) throw new Error(outcome.error);
    expect(outcome.visit.imageRecords?.[0].placeId).toBe("seating-area");

    const byPlace = (placeId: string) => outcome.state.matchResults.find((r) => r.placeId === placeId) as PlaceMatchResult;
    expect(byPlace("seating-area").status).toBe("approved");
    expect(byPlace("raised-bed")).toMatchObject({ status: "pending" });
    expect(byPlace("raised-bed").review).toBeUndefined();
    expect(byPlace("house-wall").status).toBe("pending");
    expect(listPendingMatches(outcome.visit, "raised-bed", outcome.state)).toHaveLength(0);
    expect(buildSortingQueue(outcome.visit, outcome.state, PLACES)).toHaveLength(0);
    expect(outcome.state.sortingCorrections?.[0]).toMatchObject({ decision: "approved", assignedPlaceId: "seating-area", proposedPlaceId: "seating-area" });
  });

  it("records a correction when the curator assigns another place and does not train on it", () => {
    const state = competing();
    const proposal = rankPlacesForPhoto("p1", state, PLACES);
    const outcome = assignSortingPhoto(visitOf([record("p1")]), state, proposal, "raised-bed");

    if (!outcome.ok) throw new Error(outcome.error);
    expect(outcome.state.sortingCorrections?.[0]).toMatchObject({ decision: "corrected", proposedPlaceId: "seating-area", assignedPlaceId: "raised-bed" });
    expect(outcome.state.matchResults.find((r) => r.placeId === "seating-area")).toMatchObject({ status: "rejected" });
    expect(outcome.state.anchorsByPlaceId).toEqual(state.anchorsByPlaceId);
  });

  it("never overwrites an existing manual assignment", () => {
    const state = competing();
    const proposal = rankPlacesForPhoto("p1", state, PLACES);
    const visit = visitOf([record("p1", { placeId: "house-wall" })]);
    const outcome = assignSortingPhoto(visit, state, proposal, "seating-area");

    expect(outcome.ok).toBe(false);
    expect(visit.imageRecords?.[0].placeId).toBe("house-wall");
  });

  it("does not queue manually assigned photographs and never plans comparisons for them", () => {
    const state = competing();
    const visit = visitOf([record("p1", { placeId: "house-wall" })]);

    expect(buildSortingQueue(visit, state, PLACES)).toHaveLength(0);
    expect(planSortingRun(visit, state, PLACES).items).toHaveLength(0);
  });

  it("Not sure sets a photograph aside without negative evidence and can be returned", () => {
    const state = competing();
    const proposal = rankPlacesForPhoto("p1", state, PLACES);
    const aside = setPhotoAside(state, proposal);

    expect(buildSortingQueue(visitOf([record("p1")]), aside, PLACES)).toHaveLength(0);
    expect(aside.matchResults.every((r) => r.status === "pending")).toBe(true);
    expect(aside.sortingCorrections?.[0].decision).toBe("unsure");

    const returned = returnPhotoToQueue(aside, "p1");
    expect(buildSortingQueue(visitOf([record("p1")]), returned, PLACES)).toHaveLength(1);
  });
});

describe("signature cache", () => {
  const hash = async (blob: Blob) => `hash-of-${await blob.text()}`;
  const anchorsOf = (...contents: string[]) => contents.map((text, i) => ({ id: `a${i}`, blob: new Blob([text]) }));

  it("is valid only for the exact anchor set and image content", async () => {
    const key = await computeAnchorSetKey(anchorsOf("x", "y", "z"), hash);
    const state = cacheSignature(createEmptyPlaceTrainingState(), "seating-area", key, { core: ["bench"], supporting: [], contextual: [] }, "test");

    expect(getCachedSignature(state, "seating-area", key)?.core).toEqual(["bench"]);
    // Same ids, replaced image content.
    expect(getCachedSignature(state, "seating-area", await computeAnchorSetKey(anchorsOf("x", "y", "CHANGED"), hash))).toBeNull();
    // Anchor removed.
    expect(getCachedSignature(state, "seating-area", await computeAnchorSetKey(anchorsOf("x", "y"), hash))).toBeNull();
    expect(getCachedSignature(state, "raised-bed", key)).toBeNull();
  });

  it("derives once, reuses while valid and regenerates when an anchor changes", async () => {
    let training = createEmptyPlaceTrainingState();
    const derive = vi.fn(async () => ({ core: ["bench"], supporting: [], contextual: [] }));
    const provider = { id: "test", derivePlaceSignature: derive } as unknown as VisionProvider;
    const run = (anchors: ReturnType<typeof anchorsOf>) =>
      resolvePlaceSignature({
        provider,
        placeId: "seating-area",
        placeName: "Seating",
        anchors,
        getTraining: () => training,
        commit: (updater) => {
          training = updater(training);
        },
        hash,
        anchorDataUrls: [],
      });

    expect((await run(anchorsOf("x", "y", "z"))).derived).toBe(true);
    expect((await run(anchorsOf("x", "y", "z"))).derived).toBe(false);
    expect(derive).toHaveBeenCalledTimes(1);
    expect((await run(anchorsOf("x", "y", "NEW"))).derived).toBe(true);
    expect(derive).toHaveBeenCalledTimes(2);
  });
});

describe("persistence and reload", () => {
  const emptyWorkspace: DraftWorkspace = { drafts: [], activeDraftId: null };

  it("round-trips cache, corrections and re-evaluation history, and rebuilds the queue without model calls", () => {
    let state = withResults(
      trainedState(),
      {
        ...result("seating-area", "p1", "SAME_PLACE", 0.95),
        previousEvaluations: [
          { classification: "NEARBY_CONTEXT", score: 0.4, reason: "older", provider: "test", analysisVersion: 1, matchedAt: "2026-10-01T00:00:00.000Z" },
        ],
      },
      result("raised-bed", "p1", "DIFFERENT_PLACE", 0.1),
      result("house-wall", "p1", "DIFFERENT_PLACE", 0.1)
    );
    state = cacheSignature(state, "seating-area", "key-1", { core: ["bench"], supporting: [], contextual: [] }, "test");
    const decided = setPhotoAside(state, rankPlacesForPhoto("p1", state, PLACES), "2026-10-06T00:00:00.000Z");

    const snapshot = createArchiveStateSnapshot({ importVisit: visitOf([record("p1"), record("p2")]), draftWorkspace: emptyWorkspace, placeTraining: decided });
    const parsed = parseArchiveBackup(JSON.stringify(snapshot));
    if (!parsed.ok) throw new Error(parsed.error);
    const reloaded = parsed.state.placeTraining;

    expect(reloaded.signatureCache?.["seating-area"].anchorSetKey).toBe("key-1");
    expect(reloaded.sortingCorrections).toHaveLength(1);

    const restored = returnPhotoToQueue(reloaded, "p1");
    const entry = buildSortingQueue(visitOf([record("p1")]), restored, PLACES)[0];
    expect(entry.proposal.primary?.previousEvaluations[0]).toMatchObject({ classification: "NEARBY_CONTEXT", score: 0.4 });
  });

  it("loads archives without the new optional fields unchanged", () => {
    const legacy = createArchiveStateSnapshot({ importVisit: null, draftWorkspace: emptyWorkspace, placeTraining: createEmptyPlaceTrainingState() });
    expect(legacy.placeTraining).toEqual({ anchorsByPlaceId: {}, matchResults: [] });
  });
});

describe("runSortingBatch model-call count", () => {
  function setup(cached: boolean) {
    const records = Array.from({ length: 7 }, (_, i) => record(`p${i}`));
    let training = trainedState();
    const anchorMap = new Map<string, { blob: Blob }>();
    Object.values(training.anchorsByPlaceId)
      .flat()
      .forEach((a) => anchorMap.set(a.id, { blob: new Blob([a.id]) }));
    const anchorImages = { get: (id: string) => anchorMap.get(id), has: (id: string) => anchorMap.has(id) };
    const hash = async (blob: Blob) => `h-${await blob.text()}`;

    return { records, anchorImages, hash, getTraining: () => training, commit: (u: (c: PlaceTrainingState) => PlaceTrainingState) => (training = u(training)), seed: async () => {
      if (!cached) return;
      for (const placeId of PLACES) {
        const anchors = training.anchorsByPlaceId[placeId].map((a) => ({ id: a.id, blob: anchorMap.get(a.id)!.blob }));
        training = cacheSignature(training, placeId, await computeAnchorSetKey(anchors, hash), { core: ["x"], supporting: [], contextual: [] }, "test");
      }
    } };
  }

  function provider() {
    const derive = vi.fn(async () => ({ core: ["x"], supporting: [], contextual: [] }));
    const match = vi.fn(
      async (request: { placeId: string; imageRecordId: string }): Promise<PlaceMatchOutcome> => ({
        placeId: request.placeId,
        imageRecordId: request.imageRecordId,
        classification: "DIFFERENT_PLACE",
        matchedFeatures: [],
        score: 0.1,
        reason: "no",
        provider: "test",
        analysisVersion: 1,
      })
    );
    return { derive, match, provider: { id: "test", derivePlaceSignature: derive, matchPlaceCandidate: match } as unknown as VisionProvider };
  }

  it("makes 5 photos x trained places comparisons plus one signature per uncached place, and shows it beforehand", async () => {
    const env = setup(false);
    const fake = provider();
    const readiness = await computeSortingReadiness(visitOf(env.records), env.getTraining(), env.anchorImages, env.hash);

    expect(readiness.plan.items).toHaveLength(5);
    expect(readiness.plan.comparisonCount).toBe(15);
    expect(readiness.uncachedSignaturePlaceIds).toHaveLength(3);

    const summary = await runSortingBatch(visitOf(env.records), {
      provider: fake.provider,
      getTraining: env.getTraining,
      commit: env.commit,
      anchorImages: env.anchorImages,
      prepareCandidateImage: async () => "data:image/jpeg;base64,AA==",
      isCancelled: () => false,
      hash: env.hash,
    });

    expect(summary).toMatchObject({ comparisonCalls: 15, signatureCalls: 3, failures: 0 });
    expect(fake.match).toHaveBeenCalledTimes(15);
    expect(fake.derive).toHaveBeenCalledTimes(3);
    expect(env.records.every((r) => !r.placeId)).toBe(true);
  });

  it("makes no signature calls when cached and never re-runs existing results", async () => {
    const env = setup(true);
    await env.seed();
    const fake = provider();
    const first = await runSortingBatch(visitOf(env.records), {
      provider: fake.provider,
      getTraining: env.getTraining,
      commit: env.commit,
      anchorImages: env.anchorImages,
      prepareCandidateImage: async () => "data:image/jpeg;base64,AA==",
      isCancelled: () => false,
      hash: env.hash,
    });

    expect(first).toMatchObject({ comparisonCalls: 15, signatureCalls: 0 });

    const second = await computeSortingReadiness(visitOf(env.records), env.getTraining(), env.anchorImages, env.hash);
    // The first five are fully compared, so the next batch moves on to the remaining two.
    expect(second.plan.items.map((i) => i.record.id)).toEqual(["p5", "p6"]);
  });
});

describe("buildTrainingReadiness", () => {
  it("separates anchors from assigned photos and detects missing anchor image data", () => {
    const state = trainedState();
    const places = [...PLACES, "no-anchors"].map((id) => ({ id, displayName: id }));
    const available = new Set(["seating-area-1", "seating-area-2", "seating-area-3", "raised-bed-1"]);
    const visit = visitOf([record("a", { placeId: "house-wall" }), record("b", { placeId: "house-wall" })]);
    const rows = Object.fromEntries(buildTrainingReadiness(places, visit, state, available).map((row) => [row.placeId, row]));

    expect(rows["seating-area"]).toMatchObject({ registeredAnchors: 3, availableAnchors: 3, eligible: true });
    expect(rows["raised-bed"]).toMatchObject({ registeredAnchors: 3, availableAnchors: 1, missingAnchors: 2, eligible: false });
    expect(rows["house-wall"]).toMatchObject({ assignedPhotos: 2, availableAnchors: 0, eligible: false });
    expect(rows["no-anchors"]).toMatchObject({ registeredAnchors: 0, missingAnchors: 0, eligible: false });
  });
});
