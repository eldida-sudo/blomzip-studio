import { getPlaceById } from "../data/canonicalPlaces";
import type { ImageRecord, Visit } from "../models/blomzip";

export const PLACE_DETAIL_LABEL = "Place Detail / Close-up";
export const PLACE_DETAIL_BLOCKED_MESSAGE =
  "This photograph is marked Place Detail / Close-up, so it was left unchanged. Remove the classification first.";

export function isPlaceDetailRecord(record: Pick<ImageRecord, "placeDetailClassification"> | null | undefined): boolean {
  return Boolean(record?.placeDetailClassification);
}

export type PlaceDetailChangeResult = { ok: true; visit: Visit } | { ok: false; error: string };

type ConflictReason = "missing" | "external" | "overview" | "other-place";

function describeConflict(record: ImageRecord | undefined, targetPlaceId: string): ConflictReason | null {
  if (!record) return "missing";
  if (record.externalClassification) return "external";
  if (record.overviewClassification) return "overview";
  if (record.placeId && record.placeId !== targetPlaceId) return "other-place";
  return null;
}

const CONFLICT_MESSAGES: Record<ConflictReason, string> = {
  missing: "That photograph is no longer in the archive.",
  external: "This photograph is marked External / Inspiration. Return it to the archive pool first.",
  overview: "This photograph is marked Courtyard Overview. Return it to the archive pool first.",
  "other-place": "This photograph is assigned to a different place. Change its place explicitly first; nothing is overwritten automatically.",
};

function updateRecords(visit: Visit, update: (record: ImageRecord) => ImageRecord | undefined): Visit {
  return {
    ...visit,
    imageRecords: (visit.imageRecords ?? []).map((record) => update(record) ?? record),
  };
}

/**
 * Curator action. The place must be chosen explicitly; an existing different place is never overwritten.
 * Touches only placeId (when unassigned) and the classification: entries, Story flags and match history are untouched.
 */
export function markRecordPlaceDetail(
  visit: Visit,
  imageRecordId: string,
  placeId: string,
  now: string = new Date().toISOString()
): PlaceDetailChangeResult {
  if (!getPlaceById(placeId)) {
    return { ok: false, error: "That place is not a known canonical place." };
  }

  const record = visit.imageRecords?.find((candidate) => candidate.id === imageRecordId);
  const conflict = describeConflict(record, placeId);

  if (conflict) {
    return { ok: false, error: CONFLICT_MESSAGES[conflict] };
  }

  if (record?.placeDetailClassification) {
    return { ok: true, visit };
  }

  return {
    ok: true,
    visit: updateRecords(visit, (candidate) =>
      candidate.id === imageRecordId ? { ...candidate, placeId, placeDetailClassification: { classifiedAt: now } } : undefined
    ),
  };
}

/** Removes only the classification; the place assignment and everything else stay exactly as they were. */
export function clearRecordPlaceDetail(visit: Visit, imageRecordId: string): PlaceDetailChangeResult {
  const record = visit.imageRecords?.find((candidate) => candidate.id === imageRecordId);

  if (!record) {
    return { ok: false, error: CONFLICT_MESSAGES.missing };
  }

  if (!record.placeDetailClassification) {
    return { ok: true, visit };
  }

  return {
    ok: true,
    visit: updateRecords(visit, (candidate) => {
      if (candidate.id !== imageRecordId) return undefined;
      const { placeDetailClassification: _removed, ...rest } = candidate;
      return rest;
    }),
  };
}

export interface BulkPlaceDetailPlan {
  placeId: string;
  /** Records that would change: unassigned, or already assigned to the chosen place. */
  applicableIds: string[];
  /** Already Place Detail for the chosen place; nothing to do. */
  alreadyDoneIds: string[];
  /** Excluded; each needs individual review. */
  conflicts: { imageRecordId: string; reason: ConflictReason; currentPlaceId?: string }[];
  /** Applicable records that currently have no place and would receive the chosen one. */
  newlyAssignedCount: number;
}

/** Pure preview. Never mutates and never decides anything for conflicting records. */
export function planBulkPlaceDetail(visit: Visit, imageRecordIds: readonly string[], placeId: string): BulkPlaceDetailPlan {
  const plan: BulkPlaceDetailPlan = { placeId, applicableIds: [], alreadyDoneIds: [], conflicts: [], newlyAssignedCount: 0 };
  const byId = new Map((visit.imageRecords ?? []).map((record) => [record.id, record]));

  for (const id of new Set(imageRecordIds)) {
    const record = byId.get(id);
    const conflict = describeConflict(record, placeId);

    if (conflict) {
      plan.conflicts.push({ imageRecordId: id, reason: conflict, currentPlaceId: record?.placeId });
    } else if (record?.placeDetailClassification) {
      plan.alreadyDoneIds.push(id);
    } else {
      plan.applicableIds.push(id);
      if (!record?.placeId) plan.newlyAssignedCount += 1;
    }
  }

  return plan;
}

/** Everything needed to restore one bulk operation. Kept in memory by the caller only. */
export interface BulkPlaceDetailUndo {
  placeId: string;
  classifiedAt: string;
  entries: { imageRecordId: string; hadPlaceId: boolean }[];
}

export type BulkPlaceDetailResult =
  | { ok: true; visit: Visit; undo: BulkPlaceDetailUndo | null; appliedCount: number; skippedCount: number }
  | { ok: false; error: string };

export function applyBulkPlaceDetail(
  visit: Visit,
  imageRecordIds: readonly string[],
  placeId: string,
  now: string = new Date().toISOString()
): BulkPlaceDetailResult {
  if (!getPlaceById(placeId)) {
    return { ok: false, error: "Choose a canonical place first." };
  }

  const plan = planBulkPlaceDetail(visit, imageRecordIds, placeId);

  if (plan.applicableIds.length === 0) {
    return { ok: true, visit, undo: null, appliedCount: 0, skippedCount: plan.conflicts.length + plan.alreadyDoneIds.length };
  }

  const applicable = new Set(plan.applicableIds);
  const entries = (visit.imageRecords ?? [])
    .filter((record) => applicable.has(record.id))
    .map((record) => ({ imageRecordId: record.id, hadPlaceId: Boolean(record.placeId) }));

  return {
    ok: true,
    visit: updateRecords(visit, (record) =>
      applicable.has(record.id) ? { ...record, placeId, placeDetailClassification: { classifiedAt: now } } : undefined
    ),
    undo: { placeId, classifiedAt: now, entries },
    appliedCount: plan.applicableIds.length,
    skippedCount: plan.conflicts.length + plan.alreadyDoneIds.length,
  };
}

/**
 * Restores records to their state before the bulk operation. A record the curator changed afterwards
 * (different place, classification removed or re-applied) is left exactly as it is.
 */
export function undoBulkPlaceDetail(
  visit: Visit,
  undo: BulkPlaceDetailUndo
): { visit: Visit; restoredCount: number; skippedCount: number } {
  const pending = new Map(undo.entries.map((entry) => [entry.imageRecordId, entry]));
  let restoredCount = 0;

  const next = updateRecords(visit, (record) => {
    const entry = pending.get(record.id);

    if (!entry || record.placeId !== undo.placeId || record.placeDetailClassification?.classifiedAt !== undo.classifiedAt) {
      return undefined;
    }

    restoredCount += 1;
    const { placeDetailClassification: _removed, placeId: _placeId, ...rest } = record;
    return entry.hadPlaceId ? { ...rest, placeId: undo.placeId } : rest;
  });

  return { visit: next, restoredCount, skippedCount: undo.entries.length - restoredCount };
}
