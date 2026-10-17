import type { ImageRecord, PlaceTrainingState, Visit } from "../models/blomzip";
import { assignSortingPhoto, PRIMARY_SCORE_MARGIN, type SortingProposal } from "./placeSorting";
import { isPlaceMatchEligible } from "./externalClassification";

export type SortingOrder = "priority" | "grouped" | "chronological" | "original";
export type SortingGroupKind = "place" | "ambiguous" | "unresolved";
export type ResultFreshness = "current" | "older" | "unknown";

export interface SortingQueueItem {
  record: ImageRecord;
  proposal: SortingProposal;
}

export interface SortingGroup {
  key: string;
  kind: SortingGroupKind;
  /** Set for place groups only. */
  placeId?: string;
  items: SortingQueueItem[];
}

const STATUS_RANK: Record<SortingProposal["status"], number> = { proposed: 0, uncertain: 1, incomplete: 2, unassigned: 3 };

/**
 * Where a photograph belongs for review purposes. Only a clearly supported primary (the existing
 * proposal rules) joins a place group. Two or more close SAME_PLACE rivals are ambiguous. Everything
 * else, including weak, incomplete or context-only evidence, is unresolved. Scores are only used for
 * the existing ranking separation, never as calibrated confidence.
 */
export function classifyGroupKind(proposal: SortingProposal): SortingGroupKind {
  if (proposal.status === "proposed" && proposal.primary) {
    return "place";
  }

  if (proposal.status === "uncertain" && proposal.alternatives.length >= 2) {
    const [first, second] = proposal.alternatives;
    return first.score - second.score < PRIMARY_SCORE_MARGIN ? "ambiguous" : "unresolved";
  }

  return "unresolved";
}

export function buildSortingGroups(items: readonly SortingQueueItem[]): SortingGroup[] {
  const places = new Map<string, SortingGroup>();
  const ambiguous: SortingGroup = { key: "ambiguous", kind: "ambiguous", items: [] };
  const unresolved: SortingGroup = { key: "unresolved", kind: "unresolved", items: [] };

  for (const item of items) {
    const kind = classifyGroupKind(item.proposal);

    if (kind === "place") {
      const placeId = (item.proposal.primary as NonNullable<SortingProposal["primary"]>).placeId;
      const group = places.get(placeId) ?? { key: `place:${placeId}`, kind: "place" as const, placeId, items: [] };
      group.items.push(item);
      places.set(placeId, group);
    } else {
      (kind === "ambiguous" ? ambiguous : unresolved).items.push(item);
    }
  }

  const placeGroups = [...places.values()].sort((a, b) => b.items.length - a.items.length || a.key.localeCompare(b.key));

  return [...placeGroups, ambiguous, unresolved].filter((group) => group.items.length > 0);
}

/** Orders a queue without changing it. Capture dates are only used for the explicit chronological order. */
export function orderSortingItems(
  items: readonly SortingQueueItem[],
  order: SortingOrder,
  archiveOrder: readonly ImageRecord[]
): SortingQueueItem[] {
  const position = new Map(archiveOrder.map((record, index) => [record.id, index]));
  const byArchive = (a: SortingQueueItem, b: SortingQueueItem) => (position.get(a.record.id) ?? 0) - (position.get(b.record.id) ?? 0);
  const sorted = [...items].sort(byArchive);

  switch (order) {
    case "original":
      return sorted;
    case "chronological":
      return sorted.sort((a, b) => {
        const left = a.record.captureDate ?? "";
        const right = b.record.captureDate ?? "";
        return left && right ? left.localeCompare(right) : left ? -1 : right ? 1 : 0;
      });
    case "grouped":
      return buildSortingGroups(sorted).flatMap((group) => group.items);
    default:
      return sorted.sort((a, b) => STATUS_RANK[a.proposal.status] - STATUS_RANK[b.proposal.status]);
  }
}

/**
 * Compares a stored result with anchor/signature changes recorded for that place. It can only detect
 * additions or re-derivations dated after the comparison; removed anchors are not detectable.
 */
export function getResultFreshness(state: PlaceTrainingState, resultId: string): ResultFreshness {
  const result = state.matchResults.find((candidate) => candidate.id === resultId);

  if (!result) {
    return "unknown";
  }

  const matchedAt = Date.parse(result.matchedAt);
  const stamps = [
    ...(state.anchorsByPlaceId[result.placeId] ?? []).map((anchor) => Date.parse(anchor.createdAt)),
    ...(state.signatureCache?.[result.placeId] ? [Date.parse(state.signatureCache[result.placeId].derivedAt)] : []),
  ];

  if (Number.isNaN(matchedAt) || stamps.some(Number.isNaN)) {
    return "unknown";
  }

  return stamps.some((stamp) => stamp > matchedAt) ? "older" : "current";
}

/** Freshness of the evidence a photograph's conclusion rests on (its SAME_PLACE results). */
export function getProposalFreshness(state: PlaceTrainingState, proposal: SortingProposal): ResultFreshness {
  const candidates = proposal.primary ? [proposal.primary, ...proposal.alternatives] : proposal.alternatives;
  const values = candidates.map((candidate) => getResultFreshness(state, candidate.resultId));

  if (values.includes("older")) {
    return "older";
  }

  return values.length > 0 && values.every((value) => value === "current") ? "current" : "unknown";
}

export interface BulkApprovalSkip {
  imageRecordId: string;
  reason: string;
}

export interface BulkApprovalPlan {
  eligible: SortingQueueItem[];
  skipped: { item: SortingQueueItem; reason: string }[];
}

/** Which photographs in a place group may be approved together. Read-only preview. */
export function planBulkApproval(
  items: readonly SortingQueueItem[],
  state: PlaceTrainingState,
  targetPlaceId: string
): BulkApprovalPlan {
  const plan: BulkApprovalPlan = { eligible: [], skipped: [] };

  for (const item of items) {
    if (!isPlaceMatchEligible(item.record)) {
      plan.skipped.push({ item, reason: "Already has a place or classification." });
    } else if (item.proposal.status !== "proposed" || item.proposal.primary?.placeId !== targetPlaceId) {
      plan.skipped.push({ item, reason: "Not clearly supported for this place." });
    } else if (getProposalFreshness(state, item.proposal) === "older") {
      plan.skipped.push({ item, reason: "Evidence may predate the current anchors; review individually." });
    } else {
      plan.eligible.push(item);
    }
  }

  return plan;
}

export interface BulkAssignOutcome {
  visit: Visit;
  state: PlaceTrainingState;
  assignedIds: string[];
  skipped: BulkApprovalSkip[];
}

/**
 * Approves several photographs for one place, each through the single-photograph path so existing
 * assignments are never overwritten and every decision is written to the audit trail.
 */
export function bulkAssignSortingPhotos(
  visit: Visit,
  state: PlaceTrainingState,
  proposals: readonly SortingProposal[],
  targetPlaceId: string,
  now: string = new Date().toISOString()
): BulkAssignOutcome {
  let currentVisit = visit;
  let currentState = state;
  const assignedIds: string[] = [];
  const skipped: BulkApprovalSkip[] = [];

  for (const proposal of proposals) {
    if (proposal.status !== "proposed" || proposal.primary?.placeId !== targetPlaceId) {
      skipped.push({ imageRecordId: proposal.imageRecordId, reason: "Not clearly supported for this place." });
      continue;
    }

    if (getProposalFreshness(currentState, proposal) === "older") {
      skipped.push({ imageRecordId: proposal.imageRecordId, reason: "Evidence may predate the current anchors." });
      continue;
    }

    const outcome = assignSortingPhoto(currentVisit, currentState, proposal, targetPlaceId, now);

    if (outcome.ok) {
      currentVisit = outcome.visit;
      currentState = outcome.state;
      assignedIds.push(proposal.imageRecordId);
    } else {
      skipped.push({ imageRecordId: proposal.imageRecordId, reason: outcome.error });
    }
  }

  return { visit: currentVisit, state: currentState, assignedIds, skipped };
}

export interface SortingProgress {
  total: number;
  assigned: number;
  /** Assigned and backed by a recorded curator decision (sorting audit or an approved match). */
  curatorConfirmed: number;
  awaiting: number;
  overview: number;
  placeDetail: number;
  external: number;
  editoriallyReviewed: number;
}

/** Counts derived from existing data only. Nothing is inferred for photographs without a recorded decision. */
export function buildSortingProgress(visit: Visit | null, state: PlaceTrainingState): SortingProgress {
  const records = visit?.imageRecords ?? [];
  const confirmed = new Set<string>();

  for (const correction of state.sortingCorrections ?? []) {
    if (correction.decision !== "unsure" && correction.assignedPlaceId) {
      confirmed.add(`${correction.imageRecordId}|${correction.assignedPlaceId}`);
    }
  }

  for (const result of state.matchResults) {
    if (result.status === "approved") {
      confirmed.add(`${result.imageRecordId}|${result.placeId}`);
    }
  }

  const reviewedRecordIds = new Set((visit?.entries ?? []).filter((entry) => entry.reviewed).map((entry) => entry.imageRecordId));

  return {
    total: records.length,
    assigned: records.filter((record) => record.placeId).length,
    curatorConfirmed: records.filter((record) => record.placeId && confirmed.has(`${record.id}|${record.placeId}`)).length,
    awaiting: records.filter(isPlaceMatchEligible).length,
    overview: records.filter((record) => record.overviewClassification).length,
    placeDetail: records.filter((record) => record.placeDetailClassification).length,
    external: records.filter((record) => record.externalClassification).length,
    editoriallyReviewed: records.filter((record) => reviewedRecordIds.has(record.id)).length,
  };
}
