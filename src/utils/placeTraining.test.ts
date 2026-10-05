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
  MAX_PLACE_ANCHORS,
  rejectMatch,
  removePlaceAnchor,
  replacePlaceAnchor,
  selectMatchCandidates,
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
      strong: "Strong match",
      possible: "Possible match",
      low: "Low confidence",
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
