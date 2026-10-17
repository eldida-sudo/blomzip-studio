import { getPlaceById } from "../data/canonicalPlaces";
import type {
  ImageRecord,
  PlaceMatchClassification,
  PlaceMatchEvaluationSnapshot,
  PlaceMatchResult,
  PlaceTrainingState,
  PlaceVisualAnchor,
  Visit,
} from "../models/blomzip";

import { EXTERNAL_BLOCKED_MESSAGE, isExternalRecord, isPlaceMatchEligible } from "./externalClassification";
import { isOverviewRecord, OVERVIEW_BLOCKED_MESSAGE } from "./courtyardOverview";
import { isPlaceDetailRecord, PLACE_DETAIL_BLOCKED_MESSAGE } from "./placeDetail";

export const MIN_PLACE_ANCHORS = 3;
export const MAX_PLACE_ANCHORS = 8;
export const MAX_MATCH_CANDIDATES_PER_RUN = 20;
export const MAX_REEVALUATION_CANDIDATES_PER_RUN = 5;
export const PLACE_DETAIL_ANCHOR_MESSAGE =
  "Place Detail / Close-up photographs cannot be visual anchors. Anchors must show distinctive geography of the place.";
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
    .filter((record) => isPlaceMatchEligible(record) && hasRuntimeImageData(record) && !judged.has(record.id))
    .slice(0, limit);
}

export function countRemainingCandidates(visit: Visit | null, placeId: string, state: PlaceTrainingState): number {
  return selectMatchCandidates(visit, placeId, state, Number.MAX_SAFE_INTEGER).length;
}

function isReevaluationEligible(
  placeId: string,
  state: PlaceTrainingState,
  record: ImageRecord
): boolean {
  if (!isPlaceMatchEligible(record) || !hasRuntimeImageData(record)) {
    return false;
  }

  return state.matchResults.some(
    (result) =>
      result.placeId === placeId &&
      result.imageRecordId === record.id &&
      result.status === "pending" &&
      !result.review &&
      (result.classification === "SAME_PLACE" || result.classification === "NEARBY_CONTEXT")
  );
}

/** Existing unreviewed, unassigned classified results; never includes rejected or unsure results. */
export function selectReevaluationCandidates(
  visit: Visit | null,
  placeId: string,
  state: PlaceTrainingState,
  limit: number = MAX_REEVALUATION_CANDIDATES_PER_RUN
): ImageRecord[] {
  return (visit?.imageRecords ?? [])
    .filter((record) => isReevaluationEligible(placeId, state, record))
    .slice(0, limit);
}

export function countReevaluationCandidates(visit: Visit | null, placeId: string, state: PlaceTrainingState): number {
  return selectReevaluationCandidates(visit, placeId, state, Number.MAX_SAFE_INTEGER).length;
}

export interface PlaceMatchEvaluationComparison {
  result: PlaceMatchResult;
  record: ImageRecord;
  previous: PlaceMatchEvaluationSnapshot;
  classificationChanged: boolean;
}

/** Builds comparisons from saved result history for one completed run, with changed classes first. */
export function listReevaluationComparisons(
  visit: Visit | null,
  state: PlaceTrainingState,
  resultIds: string[]
): PlaceMatchEvaluationComparison[] {
  const ids = new Set(resultIds);
  const recordsById = new Map((visit?.imageRecords ?? []).map((record) => [record.id, record]));

  return state.matchResults
    .filter((result) => ids.has(result.id) && (result.previousEvaluations?.length ?? 0) > 0)
    .flatMap((result) => {
      const record = recordsById.get(result.imageRecordId);
      const previous = result.previousEvaluations?.[result.previousEvaluations.length - 1];

      return record && previous
        ? [{
            result,
            record,
            previous,
            classificationChanged: previous.classification !== result.classification,
          }]
        : [];
    })
    .sort((left, right) => Number(right.classificationChanged) - Number(left.classificationChanged));
}

/**
 * Replaces only an eligible current result and appends its prior evaluation for comparison.
 * Returns null if the result or photograph became reviewed/assigned while evaluation was running.
 */
export function saveReevaluatedMatch(
  visit: Visit | null,
  state: PlaceTrainingState,
  replacement: PlaceMatchResult
): { state: PlaceTrainingState; classificationChanged: boolean } | null {
  const previous = state.matchResults.find(
    (result) => result.id === replacement.id && result.placeId === replacement.placeId
  );
  const record = visit?.imageRecords?.find((image) => image.id === replacement.imageRecordId);

  if (
    !previous ||
    !record ||
    previous.imageRecordId !== replacement.imageRecordId ||
    (previous.classification !== "SAME_PLACE" && previous.classification !== "NEARBY_CONTEXT") ||
    !isReevaluationEligible(replacement.placeId, state, record)
  ) {
    return null;
  }

  const snapshot: PlaceMatchEvaluationSnapshot = {
    classification: previous.classification as PlaceMatchClassification,
    matchedFeatures: previous.matchedFeatures,
    score: previous.score,
    reason: previous.reason,
    provider: previous.provider,
    analysisVersion: previous.analysisVersion,
    engineVersion: previous.engineVersion,
    matchedAt: previous.matchedAt,
  };
  const nextResult: PlaceMatchResult = {
    ...replacement,
    status: "pending",
    previousEvaluations: [...(previous.previousEvaluations ?? []), snapshot],
  };

  return {
    state: upsertMatchResult(state, nextResult),
    classificationChanged: previous.classification !== replacement.classification,
  };
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
    (visit?.imageRecords ?? []).filter(isPlaceMatchEligible).map((record) => record.id)
  );

  return state.matchResults
    .filter(
      (result) =>
        result.placeId === placeId &&
        result.status === "pending" &&
        result.classification === classification &&
        !result.review &&
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

  if (isExternalRecord(record)) {
    return { ok: false, error: EXTERNAL_BLOCKED_MESSAGE };
  }

  if (isOverviewRecord(record)) {
    return { ok: false, error: OVERVIEW_BLOCKED_MESSAGE };
  }

  if (isPlaceDetailRecord(record)) {
    return { ok: false, error: PLACE_DETAIL_BLOCKED_MESSAGE };
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

export type ReviewOutcome =
  | { ok: true; visit: Visit; state: PlaceTrainingState }
  | { ok: false; error: string };

/**
 * Assigns the photograph to a different canonical place. The original suggestion stays recorded as a
 * rejected result so it is not offered again. Never overwrites an existing placeId.
 */
export function reassignMatch(
  visit: Visit,
  state: PlaceTrainingState,
  resultId: string,
  targetPlaceId: string,
  now: string = new Date().toISOString()
): ReviewOutcome {
  const result = state.matchResults.find((candidate) => candidate.id === resultId);

  if (!result) {
    return { ok: false, error: "That match result no longer exists." };
  }

  if (!getPlaceById(targetPlaceId)) {
    return { ok: false, error: "That place is not a known canonical place." };
  }

  if (targetPlaceId === result.placeId) {
    return { ok: false, error: "Choose a different place, or approve the suggestion." };
  }

  const record = visit.imageRecords?.find((candidate) => candidate.id === result.imageRecordId);

  if (!record) {
    return { ok: false, error: "That photograph is no longer in the archive." };
  }

  if (isExternalRecord(record)) {
    return { ok: false, error: EXTERNAL_BLOCKED_MESSAGE };
  }

  if (isOverviewRecord(record)) {
    return { ok: false, error: OVERVIEW_BLOCKED_MESSAGE };
  }

  if (isPlaceDetailRecord(record)) {
    return { ok: false, error: PLACE_DETAIL_BLOCKED_MESSAGE };
  }

  if (record.placeId) {
    return { ok: false, error: "This photograph already has a place, so it was left unchanged." };
  }

  return {
    ok: true,
    visit: {
      ...visit,
      imageRecords: (visit.imageRecords ?? []).map((candidate) =>
        candidate.id === record.id ? { ...candidate, placeId: targetPlaceId } : candidate
      ),
    },
    state: upsertMatchResult(state, {
      ...result,
      status: "rejected",
      review: { decision: "reassigned", assignedPlaceId: targetPlaceId, decidedAt: now },
    }),
  };
}

/** Leaves the photograph unassigned. Not negative feedback: the result stays pending, only hidden from review. */
export function markMatchUnsure(
  state: PlaceTrainingState,
  resultId: string,
  now: string = new Date().toISOString()
): PlaceTrainingState {
  return {
    ...state,
    matchResults: state.matchResults.map((result) =>
      result.id === resultId && result.status === "pending" && !result.review
        ? { ...result, review: { decision: "unsure", decidedAt: now } }
        : result
    ),
  };
}

/** Reverts a reassignment or "not sure" decision. Refuses if the photograph's place changed since. */
export function undoReview(visit: Visit, state: PlaceTrainingState, resultId: string): ReviewOutcome {
  const result = state.matchResults.find((candidate) => candidate.id === resultId);

  if (!result?.review) {
    return { ok: false, error: "There is nothing to undo for this photograph." };
  }

  const { review, ...rest } = result;
  const restored: PlaceMatchResult = { ...rest, status: "pending" };

  if (review.decision === "unsure") {
    return { ok: true, visit, state: upsertMatchResult(state, restored) };
  }

  const record = visit.imageRecords?.find((candidate) => candidate.id === result.imageRecordId);

  if (!record || record.placeId !== review.assignedPlaceId) {
    return { ok: false, error: "This photograph's place has changed since, so it was left unchanged." };
  }

  if (isPlaceDetailRecord(record)) {
    return { ok: false, error: PLACE_DETAIL_BLOCKED_MESSAGE };
  }

  return {
    ok: true,
    visit: {
      ...visit,
      imageRecords: (visit.imageRecords ?? []).map((candidate) => {
        if (candidate.id !== record.id) {
          return candidate;
        }
        const { placeId: _removed, ...withoutPlace } = candidate;
        return withoutPlace;
      }),
    },
    state: upsertMatchResult(state, restored),
  };
}

export type MatchConfidence = "strong" | "possible" | "low";

export const STRONG_MATCH_MIN_SCORE = 0.8;
export const POSSIBLE_MATCH_MIN_SCORE = 0.55;

export const MATCH_CONFIDENCE_LABELS: Record<MatchConfidence, string> = {
  strong: "High model score",
  possible: "Medium model score",
  low: "Low model score",
};

/** Presentation only: a category never triggers an assignment. */
export function getMatchConfidence(score: number): MatchConfidence {
  if (score >= STRONG_MATCH_MIN_SCORE) {
    return "strong";
  }

  return score >= POSSIBLE_MATCH_MIN_SCORE ? "possible" : "low";
}

export interface ArchiveAnchorCandidate {
  record: ImageRecord;
  /** True only when the curator approved a match for this place. Plain assignment is not verification. */
  verified: boolean;
  alreadyAnchor: boolean;
  hasImageData: boolean;
  /** Features the stored comparison matched for this place; a hint of distinctiveness, empty when none is recorded. */
  matchedFeatures: string[];
}

/** Photographs currently assigned to the place, offered as anchor candidates. Nothing is selected or assumed correct. */
export function listArchiveAnchorCandidates(
  visit: Visit | null,
  state: PlaceTrainingState,
  placeId: string
): ArchiveAnchorCandidate[] {
  const anchors = getPlaceAnchors(state, placeId);
  const records = visit?.imageRecords ?? [];
  const anchoredIds = new Set(anchors.map((anchor) => anchor.sourceImageRecordId).filter(Boolean));
  const anchoredHashes = new Set(
    records.filter((record) => anchoredIds.has(record.id) && record.contentHash).map((record) => record.contentHash)
  );
  // Curator confirmation is only what the data records explicitly: an approved match, or a sorting-queue
  // approval/correction to this place. A bare placeId could come from an import or an older workflow.
  const approvedIds = new Set(
    state.matchResults.filter((result) => result.placeId === placeId && result.status === "approved").map((result) => result.imageRecordId)
  );
  (state.sortingCorrections ?? []).forEach((correction) => {
    if (correction.decision !== "unsure" && correction.assignedPlaceId === placeId) {
      approvedIds.add(correction.imageRecordId);
    }
  });
  const featuresByRecord = new Map<string, string[]>();
  state.matchResults.forEach((result) => {
    if (result.placeId === placeId && result.classification === "SAME_PLACE" && result.status !== "rejected") {
      featuresByRecord.set(result.imageRecordId, result.matchedFeatures ?? []);
    }
  });

  return records
    .filter(
      (record) =>
        record.placeId === placeId &&
        !isPlaceDetailRecord(record) &&
        !record.overviewClassification &&
        !record.externalClassification
    )
    .map((record) => ({
      record,
      verified: approvedIds.has(record.id),
      alreadyAnchor: anchoredIds.has(record.id) || Boolean(record.contentHash && anchoredHashes.has(record.contentHash)),
      hasImageData: hasRuntimeImageData(record),
      matchedFeatures: featuresByRecord.get(record.id) ?? [],
    }))
    .sort((a, b) => Number(b.verified) - Number(a.verified) || b.matchedFeatures.length - a.matchedFeatures.length);
}

/**
 * Validates a curator's archive selection against the anchor limits. Existing anchors are never removed and
 * duplicates (same photograph, or identical content) are rejected. Pure: no storage, no model calls.
 */
export function validateArchiveAnchorSelection(
  visit: Visit | null,
  state: PlaceTrainingState,
  placeId: string,
  selectedRecordIds: readonly string[]
): TrainingResult<ImageRecord[]> {
  const candidates = new Map(listArchiveAnchorCandidates(visit, state, placeId).map((candidate) => [candidate.record.id, candidate]));
  const chosen: ImageRecord[] = [];
  const seenHashes = new Set<string>();

  for (const id of new Set(selectedRecordIds)) {
    const candidate = candidates.get(id);

    if (visit?.imageRecords?.some((record) => record.id === id && isPlaceDetailRecord(record))) {
      return { ok: false, error: PLACE_DETAIL_ANCHOR_MESSAGE };
    }

    if (!candidate) {
      return { ok: false, error: "A selected photograph is no longer assigned to this place." };
    }

    if (candidate.alreadyAnchor) {
      return { ok: false, error: `${candidate.record.filename} is already a visual anchor.` };
    }

    if (!candidate.hasImageData) {
      return { ok: false, error: `${candidate.record.filename} has no image data in this browser.` };
    }

    const hash = candidate.record.contentHash;
    if (hash && seenHashes.has(hash)) {
      return { ok: false, error: "Two selected photographs are identical; choose only one." };
    }
    if (hash) seenHashes.add(hash);

    chosen.push(candidate.record);
  }

  const total = getPlaceAnchors(state, placeId).length + chosen.length;

  if (chosen.length === 0 || total < MIN_PLACE_ANCHORS) {
    return { ok: false, error: `Select photographs so this place has at least ${MIN_PLACE_ANCHORS} visual anchors (currently ${total}).` };
  }

  if (total > MAX_PLACE_ANCHORS) {
    return { ok: false, error: `A place can have at most ${MAX_PLACE_ANCHORS} visual anchors (this would make ${total}).` };
  }

  return { ok: true, value: chosen };
}
