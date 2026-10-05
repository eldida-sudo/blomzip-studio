import type {
  ImageRecord,
  PlaceMatchClassification,
  PlaceMatchResult,
  PlaceTrainingState,
  PlaceVisualAnchor,
  Visit,
} from "../models/blomzip";

export const MIN_PLACE_ANCHORS = 3;
export const MAX_PLACE_ANCHORS = 8;
export const MAX_MATCH_CANDIDATES_PER_RUN = 20;
export const ACCEPTED_ANCHOR_MIME_TYPES: readonly string[] = ["image/jpeg", "image/png"];

export type TrainingResult<T> = { ok: true; value: T } | { ok: false; error: string };

export function createEmptyPlaceTrainingState(): PlaceTrainingState {
  return { anchorsByPlaceId: {}, matchResults: [] };
}

export function getPlaceAnchors(state: PlaceTrainingState, placeId: string): PlaceVisualAnchor[] {
  return state.anchorsByPlaceId[placeId] ?? [];
}

export function countAllAnchors(state: PlaceTrainingState): number {
  return Object.values(state.anchorsByPlaceId).reduce((total, anchors) => total + anchors.length, 0);
}

export function addPlaceAnchors(
  state: PlaceTrainingState,
  placeId: string,
  anchors: PlaceVisualAnchor[]
): TrainingResult<PlaceTrainingState> {
  const current = getPlaceAnchors(state, placeId);
  const remaining = MAX_PLACE_ANCHORS - current.length;

  if (anchors.length > remaining) {
    return {
      ok: false,
      error:
        remaining <= 0
          ? `This place already has the maximum of ${MAX_PLACE_ANCHORS} visual anchors. Remove one first.`
          : `Only ${remaining} more visual ${remaining === 1 ? "anchor fits" : "anchors fit"} (maximum ${MAX_PLACE_ANCHORS}). Nothing was added.`,
    };
  }

  return {
    ok: true,
    value: {
      ...state,
      anchorsByPlaceId: {
        ...state.anchorsByPlaceId,
        [placeId]: [...current, ...anchors.map((anchor) => ({ ...anchor, placeId }))],
      },
    },
  };
}

export function removePlaceAnchor(state: PlaceTrainingState, placeId: string, anchorId: string): PlaceTrainingState {
  const remaining = getPlaceAnchors(state, placeId).filter((anchor) => anchor.id !== anchorId);
  const { [placeId]: _removed, ...otherPlaces } = state.anchorsByPlaceId;

  return {
    ...state,
    anchorsByPlaceId: remaining.length > 0 ? { ...otherPlaces, [placeId]: remaining } : otherPlaces,
  };
}

export function replacePlaceAnchor(
  state: PlaceTrainingState,
  placeId: string,
  oldAnchorId: string,
  replacement: PlaceVisualAnchor
): TrainingResult<PlaceTrainingState> {
  const current = getPlaceAnchors(state, placeId);

  if (!current.some((anchor) => anchor.id === oldAnchorId)) {
    return { ok: false, error: "That visual anchor no longer exists." };
  }

  return {
    ok: true,
    value: {
      ...state,
      anchorsByPlaceId: {
        ...state.anchorsByPlaceId,
        [placeId]: current.map((anchor) => (anchor.id === oldAnchorId ? { ...replacement, placeId } : anchor)),
      },
    },
  };
}

export function isAcceptedAnchorFile(file: { type: string; name: string }): boolean {
  if (ACCEPTED_ANCHOR_MIME_TYPES.includes(file.type)) {
    return true;
  }

  return !file.type && /\.(jpe?g|png)$/i.test(file.name);
}

export type MatchingReadiness = { ready: true } | { ready: false; message: string };

/** Only anchors whose image bytes are actually available count toward the minimum. */
export function getMatchingReadiness(usableAnchorCount: number): MatchingReadiness {
  if (usableAnchorCount >= MIN_PLACE_ANCHORS) {
    return { ready: true };
  }

  return {
    ready: false,
    message: `This place needs more training examples. Add at least ${MIN_PLACE_ANCHORS} visual anchors (currently ${usableAnchorCount} usable) before searching for matches.`,
  };
}

export function hasRuntimeImageData(record: Pick<ImageRecord, "thumbnailUrl">): boolean {
  const url = record.thumbnailUrl;

  if (!url || url.startsWith("data:image/svg+xml")) {
    return false;
  }

  return url.startsWith("blob:") || url.startsWith("data:");
}

/**
 * Candidates are strictly the currently unassigned photographs that have real image data
 * and have not already been judged (pending/approved/rejected) for this place.
 */
export function selectMatchCandidates(
  visit: Visit | null,
  placeId: string,
  state: PlaceTrainingState,
  limit: number = MAX_MATCH_CANDIDATES_PER_RUN
): ImageRecord[] {
  if (!visit?.imageRecords) {
    return [];
  }

  // Pending results from before classification existed are unverified, so they may be re-evaluated.
  const judged = new Set(
    state.matchResults
      .filter((result) => result.placeId === placeId && !(result.status === "pending" && !result.classification))
      .map((result) => result.imageRecordId)
  );

  return visit.imageRecords
    .filter((record) => !record.placeId && hasRuntimeImageData(record) && !judged.has(record.id))
    .slice(0, limit);
}

export function countRemainingCandidates(visit: Visit | null, placeId: string, state: PlaceTrainingState): number {
  return selectMatchCandidates(visit, placeId, state, Number.MAX_SAFE_INTEGER).length;
}

export function createMatchResultId(placeId: string, imageRecordId: string): string {
  return `match-${placeId}-${imageRecordId}`;
}

export function upsertMatchResult(state: PlaceTrainingState, result: PlaceMatchResult): PlaceTrainingState {
  return {
    ...state,
    matchResults: [...state.matchResults.filter((existing) => existing.id !== result.id), result],
  };
}

function listPendingByClassification(
  visit: Visit | null,
  placeId: string,
  state: PlaceTrainingState,
  classification: PlaceMatchClassification
): PlaceMatchResult[] {
  const unassignedIds = new Set(
    (visit?.imageRecords ?? []).filter((record) => !record.placeId).map((record) => record.id)
  );

  return state.matchResults
    .filter(
      (result) =>
        result.placeId === placeId &&
        result.status === "pending" &&
        result.classification === classification &&
        unassignedIds.has(result.imageRecordId)
    )
    .sort((left, right) => right.score - left.score);
}

/** "Likely matches": SAME_PLACE only. */
export function listPendingMatches(visit: Visit | null, placeId: string, state: PlaceTrainingState): PlaceMatchResult[] {
  return listPendingByClassification(visit, placeId, state, "SAME_PLACE");
}

/** Shown separately and collapsed; these are never offered for approval. */
export function listNearbyContextMatches(visit: Visit | null, placeId: string, state: PlaceTrainingState): PlaceMatchResult[] {
  return listPendingByClassification(visit, placeId, state, "NEARBY_CONTEXT");
}

export type ApproveMatchResult =
  | { ok: true; visit: Visit; state: PlaceTrainingState }
  | { ok: false; error: string };

/** The only code path that assigns a place from a match. It never overwrites an existing placeId. */
export function approveMatch(visit: Visit, state: PlaceTrainingState, resultId: string): ApproveMatchResult {
  const result = state.matchResults.find((candidate) => candidate.id === resultId);

  if (!result) {
    return { ok: false, error: "That match result no longer exists." };
  }

  const record = visit.imageRecords?.find((candidate) => candidate.id === result.imageRecordId);

  if (!record) {
    return { ok: false, error: "That photograph is no longer in the archive." };
  }

  if (result.classification !== "SAME_PLACE") {
    return { ok: false, error: "Only photographs classified as the same place can be approved." };
  }

  if (record.placeId) {
    return { ok: false, error: "This photograph already has a place, so it was left unchanged." };
  }

  return {
    ok: true,
    visit: {
      ...visit,
      imageRecords: (visit.imageRecords ?? []).map((candidate) =>
        candidate.id === record.id ? { ...candidate, placeId: result.placeId } : candidate
      ),
    },
    state: upsertMatchResult(state, { ...result, status: "approved" }),
  };
}

/** Rejecting records the judgement only; the photograph itself is never modified. */
export function rejectMatch(state: PlaceTrainingState, resultId: string): PlaceTrainingState {
  return {
    ...state,
    matchResults: state.matchResults.map((result) =>
      result.id === resultId ? { ...result, status: "rejected" } : result
    ),
  };
}

export type MatchConfidence = "strong" | "possible" | "low";

export const STRONG_MATCH_MIN_SCORE = 0.8;
export const POSSIBLE_MATCH_MIN_SCORE = 0.55;

export const MATCH_CONFIDENCE_LABELS: Record<MatchConfidence, string> = {
  strong: "Strong match",
  possible: "Possible match",
  low: "Low confidence",
};

/** Presentation only: a category never triggers an assignment. */
export function getMatchConfidence(score: number): MatchConfidence {
  if (score >= STRONG_MATCH_MIN_SCORE) {
    return "strong";
  }

  return score >= POSSIBLE_MATCH_MIN_SCORE ? "possible" : "low";
}
