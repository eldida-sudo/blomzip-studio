import { describe, expect, it } from "vitest";
import type { ImageRecord, PlaceMatchResult, PlaceVisualAnchor, Visit } from "../models/blomzip";
import {
  addPlaceAnchors,
  approveMatch,
  createEmptyPlaceTrainingState,
  createMatchResultId,
  getMatchConfidence,
  getMatchingReadiness,
  MATCH_CONFIDENCE_LABELS,
  getPlaceAnchors,
  isAcceptedAnchorFile,
  listNearbyContextMatches,
  listPendingMatches,
  markMatchUnsure,
  reassignMatch,
  undoReview,
  MAX_PLACE_ANCHORS,
  rejectMatch,
  removePlaceAnchor,
  replacePlaceAnchor,
  selectMatchCandidates,
  countReevaluationCandidates,
  selectReevaluationCandidates,
  saveReevaluatedMatch,
  listReevaluationComparisons,
  upsertMatchResult,
} from "./placeTraining";

function anchor(id: string, placeId = "seating-area"): PlaceVisualAnchor {
  return {
    id,
    placeId,
    filename: `${id}.jpg`,
    mimeType: "image/jpeg",
    createdAt: "2026-10-05T00:00:00.000Z",
    source: "upload",
  };
}

function record(id: string, overrides: Partial<ImageRecord> = {}): ImageRecord {
  return {
    id,
    filename: `${id}.jpg`,
    fileSize: 1,
    format: "jpeg",
    sourcePath: `${id}.jpg`,
    thumbnailUrl: `blob:http://localhost/${id}`,
    ...overrides,
  };
}

function visitWith(records: ImageRecord[]): Visit {
  return { id: "visit-1", placeId: "courtyard", date: "2026-10-05", entries: [], imageRecords: records };
}

function match(imageRecordId: string, overrides: Partial<PlaceMatchResult> = {}): PlaceMatchResult {
  return {
    id: createMatchResultId("seating-area", imageRecordId),
    placeId: "seating-area",
    imageRecordId,
    classification: "SAME_PLACE",
    matchedFeatures: ["bench", "hedge"],
    score: 0.8,
    reason: "Same hedge and bench.",
    provider: "blomzip-vision-proxy",
    analysisVersion: 1,
    matchedAt: "2026-10-05T00:00:00.000Z",
    status: "pending",
    ...overrides,
  };
}

describe("visual anchor add/remove/replace", () => {
  it("adds anchors per place and removes them", () => {
    const added = addPlaceAnchors(createEmptyPlaceTrainingState(), "seating-area", [anchor("a1"), anchor("a2")]);
    expect(added.ok).toBe(true);
    if (!added.ok) return;

    expect(getPlaceAnchors(added.value, "seating-area").map((item) => item.id)).toEqual(["a1", "a2"]);

    const removed = removePlaceAnchor(added.value, "seating-area", "a1");
    expect(getPlaceAnchors(removed, "seating-area").map((item) => item.id)).toEqual(["a2"]);
    expect(getPlaceAnchors(removePlaceAnchor(removed, "seating-area", "a2"), "seating-area")).toEqual([]);
  });

  it("refuses a batch that would exceed the maximum and changes nothing", () => {
    const eight = Array.from({ length: MAX_PLACE_ANCHORS }, (_, index) => anchor(`a${index}`));
    const full = addPlaceAnchors(createEmptyPlaceTrainingState(), "seating-area", eight);
    expect(full.ok).toBe(true);
    if (!full.ok) return;

    const overflow = addPlaceAnchors(full.value, "seating-area", [anchor("extra")]);
    expect(overflow.ok).toBe(false);
    expect(getPlaceAnchors(full.value, "seating-area")).toHaveLength(MAX_PLACE_ANCHORS);
  });

  it("replaces one anchor in place", () => {
    const added = addPlaceAnchors(createEmptyPlaceTrainingState(), "seating-area", [anchor("a1"), anchor("a2")]);
    if (!added.ok) throw new Error("setup");

    const replaced = replacePlaceAnchor(added.value, "seating-area", "a1", anchor("a3"));
    expect(replaced.ok && getPlaceAnchors(replaced.value, "seating-area").map((item) => item.id)).toEqual(["a3", "a2"]);
    expect(replacePlaceAnchor(added.value, "seating-area", "missing", anchor("a4")).ok).toBe(false);
  });

  it("accepts only JPG and PNG files", () => {
    expect(isAcceptedAnchorFile({ type: "image/jpeg", name: "a.jpg" })).toBe(true);
    expect(isAcceptedAnchorFile({ type: "image/png", name: "a.png" })).toBe(true);
    expect(isAcceptedAnchorFile({ type: "image/gif", name: "a.gif" })).toBe(false);
    expect(isAcceptedAnchorFile({ type: "application/pdf", name: "a.pdf" })).toBe(false);
  });
});

describe("fewer-than-3-anchor guard", () => {
  it("blocks matching below three usable anchors and explains why", () => {
    const blocked = getMatchingReadiness(2);
    expect(blocked.ready).toBe(false);
    expect(!blocked.ready && blocked.message).toMatch(/needs more training examples/);
    expect(getMatchingReadiness(3)).toEqual({ ready: true });
  });
});

describe("candidate selection", () => {
  it("evaluates only unassigned photographs with real image data not already judged", () => {
    const visit = visitWith([
      record("unassigned-1"),
      record("assigned", { placeId: "central-lawn" }),
      record("no-image", { thumbnailUrl: undefined }),
      record("placeholder", { thumbnailUrl: "data:image/svg+xml;charset=utf-8,%3Csvg" }),
      record("rejected-before"),
      record("unassigned-2"),
    ]);
    const state = upsertMatchResult(createEmptyPlaceTrainingState(), match("rejected-before", { status: "rejected" }));

    expect(selectMatchCandidates(visit, "seating-area", state).map((item) => item.id)).toEqual([
      "unassigned-1",
      "unassigned-2",
    ]);
  });

  it("caps a run", () => {
    const visit = visitWith(Array.from({ length: 30 }, (_, index) => record(`p${index}`)));
    expect(selectMatchCandidates(visit, "seating-area", createEmptyPlaceTrainingState(), 20)).toHaveLength(20);
  });
});

describe("existing match re-evaluation", () => {
  it("selects only unassigned pending SAME_PLACE and NEARBY_CONTEXT results", () => {
    const visit = visitWith([
      record("same"),
      record("nearby"),
      record("assigned", { placeId: "seating-area" }),
      record("rejected"),
      record("unsure"),
      record("different"),
      record("missing-image", { thumbnailUrl: undefined }),
    ]);
    const state = [
      match("same"),
      match("nearby", { classification: "NEARBY_CONTEXT" }),
      match("assigned"),
      match("rejected", { status: "rejected" }),
      match("unsure", { review: { decision: "unsure", decidedAt: "2026-10-06T00:00:00.000Z" } }),
      match("different", { classification: "DIFFERENT_PLACE" }),
      match("missing-image"),
    ].reduce(upsertMatchResult, createEmptyPlaceTrainingState());

    expect(selectReevaluationCandidates(visit, "seating-area", state).map((item) => item.id)).toEqual(["same", "nearby"]);
    expect(countReevaluationCandidates(visit, "seating-area", state)).toBe(2);
  });

  it("caps a run at five candidates", () => {
    const records = Array.from({ length: 8 }, (_, index) => record(`match-${index}`));
    const state = records
      .map((item) => match(item.id))
      .reduce(upsertMatchResult, createEmptyPlaceTrainingState());
    expect(selectReevaluationCandidates(visitWith(records), "seating-area", state)).toHaveLength(5);
  });

  it("preserves the prior evaluation and reports whether classification changed", () => {
    const visit = visitWith([record("p1")]);
    const previous = match("p1", {
      previousEvaluations: [{
        classification: "NEARBY_CONTEXT",
        score: 0.4,
        reason: "Earlier run",
        provider: "old-provider",
        analysisVersion: 1,
        matchedAt: "2026-10-04T00:00:00.000Z",
      }],
    });
    const state = upsertMatchResult(createEmptyPlaceTrainingState(), previous);
    const replacement = match("p1", {
      classification: "NEARBY_CONTEXT",
      score: 0.45,
      engineVersion: "place-match-precision-v2",
      matchedAt: "2026-10-06T00:00:00.000Z",
    });

    const saved = saveReevaluatedMatch(visit, state, replacement);
    expect(saved?.classificationChanged).toBe(true);
    expect(saved?.state.matchResults[0]).toMatchObject({
      classification: "NEARBY_CONTEXT",
      engineVersion: "place-match-precision-v2",
      previousEvaluations: [
        previous.previousEvaluations?.[0],
        expect.objectContaining({
          classification: "SAME_PLACE",
          score: 0.8,
          reason: "Same hedge and bench.",
        }),
      ],
    });

    const unchanged = saveReevaluatedMatch(visit, saved!.state, {
      ...replacement,
      classification: "NEARBY_CONTEXT",
    });
    expect(unchanged?.classificationChanged).toBe(false);
    expect(unchanged?.state.matchResults[0].previousEvaluations).toHaveLength(3);
  });

  it("accepts a new DIFFERENT_PLACE classification and records it as a change", () => {
    const visit = visitWith([record("p1")]);
    const state = upsertMatchResult(createEmptyPlaceTrainingState(), match("p1"));
    const saved = saveReevaluatedMatch(
      visit,
      state,
      match("p1", { classification: "DIFFERENT_PLACE", score: 0.1 })
    );
    expect(saved?.classificationChanged).toBe(true);
    expect(saved?.state.matchResults[0].classification).toBe("DIFFERENT_PLACE");
    expect(saved?.state.matchResults[0].previousEvaluations?.[0].classification).toBe("SAME_PLACE");
  });

  it("builds comparisons from saved history and sorts changed classifications first", () => {
    const visit = visitWith([record("same"), record("changed")]);
    const same = match("same", {
      classification: "NEARBY_CONTEXT",
      previousEvaluations: [{
        classification: "NEARBY_CONTEXT",
        score: 0.4,
        reason: "Earlier nearby",
        provider: "old",
        analysisVersion: 1,
        matchedAt: "2026-10-04T00:00:00.000Z",
      }],
    });
    const changed = match("changed", {
      classification: "NEARBY_CONTEXT",
      previousEvaluations: [{
        classification: "SAME_PLACE",
        score: 0.85,
        reason: "Earlier same place",
        provider: "old",
        analysisVersion: 1,
        matchedAt: "2026-10-04T00:00:00.000Z",
      }],
    });
    const state = [same, changed].reduce(upsertMatchResult, createEmptyPlaceTrainingState());

    expect(listReevaluationComparisons(visit, state, [same.id, changed.id])).toMatchObject([
      {
        result: { imageRecordId: "changed", classification: "NEARBY_CONTEXT", score: 0.8 },
        previous: { classification: "SAME_PLACE", score: 0.85 },
        classificationChanged: true,
      },
      {
        result: { imageRecordId: "same", classification: "NEARBY_CONTEXT" },
        previous: { classification: "NEARBY_CONTEXT", score: 0.4 },
        classificationChanged: false,
      },
    ]);
  });

  it("refuses to replace an approved, rejected, or manually reviewed result", () => {
    const records = [record("approved", { placeId: "seating-area" }), record("rejected"), record("unsure")];
    const visit = visitWith(records);
    const state = [
      match("approved", { status: "approved" }),
      match("rejected", { status: "rejected" }),
      match("unsure", { review: { decision: "unsure", decidedAt: "2026-10-06T00:00:00.000Z" } }),
    ].reduce(upsertMatchResult, createEmptyPlaceTrainingState());
    const replacement = match("unsure", { classification: "NEARBY_CONTEXT" });

    expect(selectReevaluationCandidates(visit, "seating-area", state)).toEqual([]);
    expect(saveReevaluatedMatch(visit, state, replacement)).toBeNull();
    expect(state.matchResults.map(({ status, review }) => ({ status, review }))).toEqual([
      { status: "approved", review: undefined },
      { status: "rejected", review: undefined },
      { status: "pending", review: { decision: "unsure", decidedAt: "2026-10-06T00:00:00.000Z" } },
    ]);
  });
});

describe("approve and reject", () => {
  it("approval assigns the canonical place and records the decision", () => {
    const visit = visitWith([record("p1"), record("p2")]);
    const state = upsertMatchResult(createEmptyPlaceTrainingState(), match("p1"));

    const outcome = approveMatch(visit, state, createMatchResultId("seating-area", "p1"));
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;

    expect(outcome.visit.imageRecords?.find((item) => item.id === "p1")?.placeId).toBe("seating-area");
    expect(outcome.visit.imageRecords?.find((item) => item.id === "p2")?.placeId).toBeUndefined();
    expect(outcome.state.matchResults[0].status).toBe("approved");
  });

  it("rejection leaves the photograph unchanged and persists the decision", () => {
    const visit = visitWith([record("p1")]);
    const state = upsertMatchResult(createEmptyPlaceTrainingState(), match("p1"));
    const next = rejectMatch(state, createMatchResultId("seating-area", "p1"));

    expect(next.matchResults[0].status).toBe("rejected");
    expect(visit.imageRecords?.[0].placeId).toBeUndefined();
    expect(selectMatchCandidates(visit, "seating-area", next)).toEqual([]);
  });

  it("never overwrites an existing placeId", () => {
    const visit = visitWith([record("p1", { placeId: "central-lawn" })]);
    const state = upsertMatchResult(createEmptyPlaceTrainingState(), match("p1"));

    const outcome = approveMatch(visit, state, createMatchResultId("seating-area", "p1"));
    expect(outcome.ok).toBe(false);
    expect(visit.imageRecords?.[0].placeId).toBe("central-lawn");
    expect(state.matchResults[0].status).toBe("pending");
  });
});

describe("match confidence categories", () => {
  it("maps scores to strong, possible and low", () => {
    expect(getMatchConfidence(0.95)).toBe("strong");
    expect(getMatchConfidence(0.8)).toBe("strong");
    expect(getMatchConfidence(0.79)).toBe("possible");
    expect(getMatchConfidence(0.55)).toBe("possible");
    expect(getMatchConfidence(0.54)).toBe("low");
    expect(getMatchConfidence(0)).toBe("low");
  });

  it("uses curator-facing labels", () => {
    expect(MATCH_CONFIDENCE_LABELS).toEqual({
      strong: "High model score",
      possible: "Medium model score",
      low: "Low model score",
    });
  });

  it("never assigns a place just because the score is high", () => {
    const visit = visitWith([record("p1")]);
    const state = upsertMatchResult(createEmptyPlaceTrainingState(), match("p1", { score: 1 }));

    expect(getMatchConfidence(1)).toBe("strong");
    expect(visit.imageRecords?.[0].placeId).toBeUndefined();
    expect(state.matchResults[0].status).toBe("pending");
    expect(selectMatchCandidates(visit, "seating-area", state)).toEqual([]);
  });
});

describe("classification-aware results", () => {
  const visit = visitWith([record("same"), record("nearby"), record("different"), record("legacy")]);
  const state = [
    match("same"),
    match("nearby", { classification: "NEARBY_CONTEXT", score: 0.4 }),
    match("different", { classification: "DIFFERENT_PLACE", score: 0.05 }),
    match("legacy", { classification: undefined, matchedFeatures: undefined, score: 0.93 }),
  ].reduce(upsertMatchResult, createEmptyPlaceTrainingState());

  it("lists only SAME_PLACE under likely matches", () => {
    expect(listPendingMatches(visit, "seating-area", state).map((item) => item.imageRecordId)).toEqual(["same"]);
  });

  it("lists NEARBY_CONTEXT separately and hides DIFFERENT_PLACE and unverified legacy results", () => {
    expect(listNearbyContextMatches(visit, "seating-area", state).map((item) => item.imageRecordId)).toEqual(["nearby"]);
  });

  it("refuses to approve anything that is not SAME_PLACE and assigns nothing", () => {
    for (const id of ["nearby", "different", "legacy"]) {
      const outcome = approveMatch(visit, state, createMatchResultId("seating-area", id));
      expect(outcome.ok).toBe(false);
    }

    expect(visit.imageRecords?.every((item) => !item.placeId)).toBe(true);
  });

  it("re-evaluates unverified legacy pending results but not classified ones", () => {
    const ids = selectMatchCandidates(visit, "seating-area", state).map((item) => item.id);
    expect(ids).toEqual(["legacy"]);
  });
});

describe("curator review corrections", () => {
  const resultId = createMatchResultId("seating-area", "img-1");
  const setup = () => ({
    visit: visitWith([record("img-1"), record("img-2")]),
    state: upsertMatchResult(createEmptyPlaceTrainingState(), match("img-1")),
  });

  it("reassigns to another canonical place, records negative feedback, and adds no anchors", () => {
    const { visit, state } = setup();
    const outcome = reassignMatch(visit, state, resultId, "raised-bed", "2026-10-06T00:00:00.000Z");
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;

    expect(outcome.visit.imageRecords?.find((r) => r.id === "img-1")?.placeId).toBe("raised-bed");
    expect(outcome.visit.imageRecords?.find((r) => r.id === "img-2")?.placeId).toBeUndefined();
    expect(outcome.state.matchResults[0]).toMatchObject({
      status: "rejected",
      review: { decision: "reassigned", assignedPlaceId: "raised-bed" },
    });
    expect(outcome.state.anchorsByPlaceId).toEqual(state.anchorsByPlaceId);
    expect(listPendingMatches(outcome.visit, "seating-area", outcome.state)).toEqual([]);
  });

  it("refuses unknown, identical, and already-assigned targets without changes", () => {
    const { visit, state } = setup();
    expect(reassignMatch(visit, state, resultId, "nowhere").ok).toBe(false);
    expect(reassignMatch(visit, state, resultId, "seating-area").ok).toBe(false);
    expect(reassignMatch(visit, state, "missing", "raised-bed").ok).toBe(false);

    const assigned = visitWith([record("img-1", { placeId: "parking" }), record("img-2")]);
    expect(reassignMatch(assigned, state, resultId, "raised-bed").ok).toBe(false);
    expect(assigned.imageRecords?.[0].placeId).toBe("parking");
  });

  it("undoes a reassignment, restoring the unassigned photograph and pending result", () => {
    const { visit, state } = setup();
    const done = reassignMatch(visit, state, resultId, "raised-bed");
    if (!done.ok) throw new Error("setup");

    const undone = undoReview(done.visit, done.state, resultId);
    expect(undone.ok).toBe(true);
    if (!undone.ok) return;

    expect(undone.visit.imageRecords?.[0]).toEqual(visit.imageRecords?.[0]);
    expect("placeId" in (undone.visit.imageRecords?.[0] ?? {})).toBe(false);
    expect(undone.state.matchResults[0]).toEqual(state.matchResults[0]);
    expect(listPendingMatches(undone.visit, "seating-area", undone.state)).toHaveLength(1);
  });

  it("refuses to undo when the photograph's place changed since", () => {
    const { visit, state } = setup();
    const done = reassignMatch(visit, state, resultId, "raised-bed");
    if (!done.ok) throw new Error("setup");

    const changed = {
      ...done.visit,
      imageRecords: done.visit.imageRecords?.map((r) => (r.id === "img-1" ? { ...r, placeId: "parking" } : r)),
    };
    const undone = undoReview(changed, done.state, resultId);
    expect(undone.ok).toBe(false);
    expect(changed.imageRecords?.[0].placeId).toBe("parking");
    expect(undoReview(visit, state, resultId).ok).toBe(false);
  });

  it("'not sure' is not negative feedback and keeps the photograph eligible for other places", () => {
    const { visit, state } = setup();
    const unsure = markMatchUnsure(state, resultId, "2026-10-06T00:00:00.000Z");

    expect(unsure.matchResults[0].status).toBe("pending");
    expect(unsure.matchResults[0].review).toMatchObject({ decision: "unsure" });
    expect(unsure.matchResults.some((r) => r.status === "rejected")).toBe(false);
    expect(visit.imageRecords?.[0].placeId).toBeUndefined();
    expect(listPendingMatches(visit, "seating-area", unsure)).toEqual([]);
    expect(selectMatchCandidates(visit, "seating-area", unsure).map((r) => r.id)).toEqual(["img-2"]);
    expect(selectMatchCandidates(visit, "raised-bed", unsure).map((r) => r.id)).toEqual(["img-1", "img-2"]);
  });

  it("undoes 'not sure' so the suggestion reappears", () => {
    const { visit, state } = setup();
    const undone = undoReview(visit, markMatchUnsure(state, resultId), resultId);
    expect(undone.ok && undone.state.matchResults[0]).toEqual(state.matchResults[0]);
  });
});
