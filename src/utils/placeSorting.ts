import { getPlaceById } from "../data/canonicalPlaces";
import type {
  ImageRecord,
  PlaceMatchClassification,
  PlaceMatchEvaluationSnapshot,
  PlaceMatchResult,
  PlaceSortingProposalStatus,
  PlaceTrainingState,
  Visit,
} from "../models/blomzip";
import {
  hasRuntimeImageData,
  MIN_PLACE_ANCHORS,
  STRONG_MATCH_MIN_SCORE,
  upsertMatchResult,
  type ReviewOutcome,
} from "./placeTraining";
import { MIN_SAME_PLACE_FEATURES } from "./visionProvider";

export const SORTING_BATCH_SIZE = 5;
// Provisional: model scores are not calibrated probabilities, so this is only one guard among several.
export const PRIMARY_SCORE_MARGIN = 0.15;
export const PRIMARY_MIN_SCORE = STRONG_MATCH_MIN_SCORE;
const MAX_STORED_CORRECTIONS = 500;

export interface SortingCandidate {
  placeId: string;
  resultId: string;
  classification: PlaceMatchClassification;
  score: number;
  matchedFeatures: string[];
  reason: string;
  previousEvaluations: PlaceMatchEvaluationSnapshot[];
}

export interface SortingProposal {
  imageRecordId: string;
  status: PlaceSortingProposalStatus;
  statusReason: string;
  /** Only set when status is "proposed". */
  primary?: SortingCandidate;
  /** Other places with SAME_PLACE evidence, strongest first. */
  alternatives: SortingCandidate[];
  /** NEARBY_CONTEXT results: secondary context only, never assignable as primary. */
  context: SortingCandidate[];
  allCandidates: SortingCandidate[];
}

export function getTrainedPlaceIds(state: PlaceTrainingState): string[] {
  return Object.entries(state.anchorsByPlaceId)
    .filter(([, anchors]) => anchors.length >= MIN_PLACE_ANCHORS)
    .map(([placeId]) => placeId);
}

/** Trained places whose anchor image bytes are actually available; null means "trust the metadata". */
export function listSortablePlaceIds(state: PlaceTrainingState, availableAnchorIds: ReadonlySet<string> | null): string[] {
  return Object.entries(state.anchorsByPlaceId)
    .filter(([, anchors]) => {
      const usable = availableAnchorIds ? anchors.filter((anchor) => availableAnchorIds.has(anchor.id)) : anchors;
      return usable.length >= MIN_PLACE_ANCHORS;
    })
    .map(([placeId]) => placeId);
}

function toCandidate(result: PlaceMatchResult): SortingCandidate {
  return {
    placeId: result.placeId,
    resultId: result.id,
    classification: result.classification as PlaceMatchClassification,
    score: result.score,
    matchedFeatures: result.matchedFeatures ?? [],
    reason: result.reason,
    previousEvaluations: result.previousEvaluations ?? [],
  };
}

function rankBySameStrength(left: SortingCandidate, right: SortingCandidate): number {
  return right.score - left.score || right.matchedFeatures.length - left.matchedFeatures.length;
}

/**
 * Ranks places for one photograph from existing match results only (no model calls).
 * A primary place is proposed only with a strong, multi-feature SAME_PLACE result that clearly
 * leads every other SAME_PLACE result and when every expected place was actually compared.
 */
export function rankPlacesForPhoto(
  imageRecordId: string,
  state: PlaceTrainingState,
  expectedPlaceIds: readonly string[]
): SortingProposal {
  const results = state.matchResults.filter((result) => result.imageRecordId === imageRecordId && result.classification);
  const evaluated = new Set(results.map((result) => result.placeId));
  const live = results.filter((result) => result.status === "pending").map(toCandidate);
  const same = live.filter((candidate) => candidate.classification === "SAME_PLACE").sort(rankBySameStrength);
  const context = live.filter((candidate) => candidate.classification === "NEARBY_CONTEXT").sort(rankBySameStrength);
  const base = { imageRecordId, context, allCandidates: [...same, ...context] };
  const missing = expectedPlaceIds.filter((placeId) => !evaluated.has(placeId));

  if (same.length === 0) {
    return {
      ...base,
      status: "unassigned",
      statusReason: "No single primary place is clearly supported. This may be an overview or a context shot.",
      alternatives: [],
    };
  }

  const [top, ...rest] = same;

  if (missing.length > 0) {
    return {
      ...base,
      status: "incomplete",
      statusReason: `Not yet compared against ${missing.length} trained ${missing.length === 1 ? "place" : "places"}.`,
      alternatives: same,
    };
  }

  if (top.score < PRIMARY_MIN_SCORE || top.matchedFeatures.length < MIN_SAME_PLACE_FEATURES) {
    return { ...base, status: "uncertain", statusReason: "The visual evidence is weak.", alternatives: same };
  }

  if (rest.length > 0 && top.score - rest[0].score < PRIMARY_SCORE_MARGIN) {
    return {
      ...base,
      status: "uncertain",
      statusReason: "Two or more places look similarly plausible.",
      alternatives: same,
    };
  }

  return { ...base, status: "proposed", statusReason: "One place is clearly supported.", primary: top, alternatives: rest };
}

function hasUnsureDecision(state: PlaceTrainingState, imageRecordId: string): boolean {
  return state.matchResults.some(
    (result) => result.imageRecordId === imageRecordId && result.status === "pending" && result.review?.decision === "unsure"
  );
}

function listUnassigned(visit: Visit | null): ImageRecord[] {
  return (visit?.imageRecords ?? []).filter((record) => !record.placeId);
}

/** Unassigned photographs awaiting a curator decision, excluding those set aside as "not sure". */
export function buildSortingQueue(
  visit: Visit | null,
  state: PlaceTrainingState,
  expectedPlaceIds: readonly string[]
): { record: ImageRecord; proposal: SortingProposal }[] {
  return listUnassigned(visit)
    .filter((record) => !hasUnsureDecision(state, record.id))
    .map((record) => ({ record, proposal: rankPlacesForPhoto(record.id, state, expectedPlaceIds) }))
    .filter(({ proposal }) => proposal.allCandidates.length > 0);
}

export function listSetAsidePhotos(visit: Visit | null, state: PlaceTrainingState): ImageRecord[] {
  return listUnassigned(visit).filter((record) => hasUnsureDecision(state, record.id));
}

export interface SortingRunPlanItem {
  record: ImageRecord;
  placeIds: string[];
}

export interface SortingRunPlan {
  items: SortingRunPlanItem[];
  comparisonCount: number;
}

/**
 * Up to `limit` unassigned photographs with real image data that still lack a comparison for at least one
 * sortable place. Existing results are never re-run or replaced; only missing comparisons are planned.
 */
export function planSortingRun(
  visit: Visit | null,
  state: PlaceTrainingState,
  placeIds: readonly string[],
  limit: number = SORTING_BATCH_SIZE
): SortingRunPlan {
  const items: SortingRunPlanItem[] = [];

  for (const record of listUnassigned(visit)) {
    if (items.length >= limit) {
      break;
    }

    if (!hasRuntimeImageData(record) || hasUnsureDecision(state, record.id)) {
      continue;
    }

    const done = new Set(
      state.matchResults.filter((result) => result.imageRecordId === record.id && result.classification).map((result) => result.placeId)
    );
    const missing = placeIds.filter((placeId) => !done.has(placeId));

    if (missing.length > 0) {
      items.push({ record, placeIds: missing });
    }
  }

  return { items, comparisonCount: items.reduce((total, item) => total + item.placeIds.length, 0) };
}

function appendCorrection(
  state: PlaceTrainingState,
  proposal: SortingProposal,
  decision: "approved" | "corrected" | "unsure",
  assignedPlaceId: string | undefined,
  now: string
): PlaceTrainingState {
  const entry = {
    id: `sorting-${proposal.imageRecordId}-${now}`,
    imageRecordId: proposal.imageRecordId,
    decision,
    proposalStatus: proposal.status,
    proposedPlaceId: proposal.primary?.placeId,
    assignedPlaceId,
    candidates: proposal.allCandidates.map(({ placeId, classification, score }) => ({ placeId, classification, score })),
    decidedAt: now,
  };

  return { ...state, sortingCorrections: [...(state.sortingCorrections ?? []), entry].slice(-MAX_STORED_CORRECTIONS) };
}

/**
 * Assigns the primary place from the sorting queue. Never overwrites an existing placeId.
 * Competing pending proposals for other places are left untouched: they stop being listed because the
 * photograph is no longer unassigned, and they are not recorded as negative evidence. Only an explicitly
 * proposed place that the curator overrides is recorded as rejected.
 */
export function assignSortingPhoto(
  visit: Visit,
  state: PlaceTrainingState,
  proposal: SortingProposal,
  targetPlaceId: string,
  now: string = new Date().toISOString()
): ReviewOutcome {
  const record = visit.imageRecords?.find((candidate) => candidate.id === proposal.imageRecordId);

  if (!record) {
    return { ok: false, error: "That photograph is no longer in the archive." };
  }

  if (record.placeId) {
    return { ok: false, error: "This photograph already has a place, so it was left unchanged." };
  }

  if (!getPlaceById(targetPlaceId)) {
    return { ok: false, error: "That place is not a known canonical place." };
  }

  const target = proposal.allCandidates.find((candidate) => candidate.placeId === targetPlaceId);
  const approvedByEvidence = target?.classification === "SAME_PLACE";
  let next = state;

  if (approvedByEvidence && target) {
    const existing = state.matchResults.find((result) => result.id === target.resultId);
    if (existing) {
      next = upsertMatchResult(next, { ...existing, status: "approved" });
    }
  }

  if (proposal.primary && proposal.primary.placeId !== targetPlaceId) {
    const overridden = next.matchResults.find((result) => result.id === proposal.primary?.resultId);
    if (overridden) {
      next = upsertMatchResult(next, {
        ...overridden,
        status: "rejected",
        review: { decision: "reassigned", assignedPlaceId: targetPlaceId, decidedAt: now },
      });
    }
  }

  const decision = proposal.primary?.placeId === targetPlaceId ? "approved" : "corrected";

  return {
    ok: true,
    visit: {
      ...visit,
      imageRecords: (visit.imageRecords ?? []).map((candidate) =>
        candidate.id === record.id ? { ...candidate, placeId: targetPlaceId } : candidate
      ),
    },
    state: appendCorrection(next, proposal, decision, targetPlaceId, now),
  };
}

/** Sets the photograph aside without assigning anything. Not negative evidence for any place. */
export function setPhotoAside(
  state: PlaceTrainingState,
  proposal: SortingProposal,
  now: string = new Date().toISOString()
): PlaceTrainingState {
  const next = {
    ...state,
    matchResults: state.matchResults.map((result) =>
      result.imageRecordId === proposal.imageRecordId && result.status === "pending" && !result.review
        ? { ...result, review: { decision: "unsure" as const, decidedAt: now } }
        : result
    ),
  };

  return appendCorrection(next, proposal, "unsure", undefined, now);
}

export function returnPhotoToQueue(state: PlaceTrainingState, imageRecordId: string): PlaceTrainingState {
  return {
    ...state,
    matchResults: state.matchResults.map((result) => {
      if (result.imageRecordId !== imageRecordId || result.review?.decision !== "unsure") {
        return result;
      }
      const { review: _review, ...rest } = result;
      return rest;
    }),
  };
}

export interface PlaceTrainingReadinessRow {
  placeId: string;
  displayName: string;
  registeredAnchors: number;
  availableAnchors: number;
  missingAnchors: number;
  /** Archive photographs currently assigned to this place. These are NOT training anchors. */
  assignedPhotos: number;
  eligible: boolean;
}

/** Overview of every canonical place. Reads local state only; makes no model calls. */
export function buildTrainingReadiness(
  places: readonly { id: string; displayName: string }[],
  visit: Visit | null,
  state: PlaceTrainingState,
  availableAnchorIds: ReadonlySet<string>
): PlaceTrainingReadinessRow[] {
  return places.map((place) => {
    const anchors = state.anchorsByPlaceId[place.id] ?? [];
    const available = anchors.filter((anchor) => availableAnchorIds.has(anchor.id)).length;

    return {
      placeId: place.id,
      displayName: place.displayName,
      registeredAnchors: anchors.length,
      availableAnchors: available,
      missingAnchors: anchors.length - available,
      assignedPhotos: (visit?.imageRecords ?? []).filter((record) => record.placeId === place.id).length,
      eligible: available >= MIN_PLACE_ANCHORS,
    };
  });
}
