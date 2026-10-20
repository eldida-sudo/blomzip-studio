import { getPlaceById } from "../data/canonicalPlaces";
import type { Visit } from "../models/blomzip";

export type BulkAssignSkipReason = "missing" | "external" | "overview" | "place-detail";

export interface BulkPlaceAssignmentPlan {
  placeId: string;
  /** Records whose placeId would be set or changed. */
  applicableIds: string[];
  /** Applicable records that currently have a different place and would be overwritten. */
  overwriteIds: string[];
  /** Already assigned to the chosen place; nothing to do. */
  unchangedIds: string[];
  /** Left untouched: they hold a classification that is independent of a plain place assignment. */
  skipped: { imageRecordId: string; reason: BulkAssignSkipReason }[];
}

/** Everything needed to undo one bulk assignment. Kept in memory by the caller only. */
export interface BulkPlaceAssignmentUndo {
  placeId: string;
  entries: { imageRecordId: string; previousPlaceId?: string }[];
}

export type BulkPlaceAssignmentResult =
  | { ok: true; visit: Visit; undo: BulkPlaceAssignmentUndo | null; plan: BulkPlaceAssignmentPlan }
  | { ok: false; error: string };

/** Pure preview; mirrors the single-photograph rule (External/Overview records are never given a place). */
export function planBulkPlaceAssignment(
  visit: Visit,
  imageRecordIds: readonly string[],
  placeId: string
): BulkPlaceAssignmentPlan {
  const plan: BulkPlaceAssignmentPlan = { placeId, applicableIds: [], overwriteIds: [], unchangedIds: [], skipped: [] };
  const byId = new Map((visit.imageRecords ?? []).map((record) => [record.id, record]));

  for (const id of new Set(imageRecordIds)) {
    const record = byId.get(id);

    if (!record) {
      plan.skipped.push({ imageRecordId: id, reason: "missing" });
    } else if (record.externalClassification) {
      plan.skipped.push({ imageRecordId: id, reason: "external" });
    } else if (record.overviewClassification) {
      plan.skipped.push({ imageRecordId: id, reason: "overview" });
    } else if (record.placeDetailClassification) {
      plan.skipped.push({ imageRecordId: id, reason: "place-detail" });
    } else if (record.placeId === placeId) {
      plan.unchangedIds.push(id);
    } else {
      plan.applicableIds.push(id);
      if (record.placeId) plan.overwriteIds.push(id);
    }
  }

  return plan;
}

/** Sets only placeId on the selected, applicable records. Entries, flags and match history are untouched. */
export function applyBulkPlaceAssignment(
  visit: Visit,
  imageRecordIds: readonly string[],
  placeId: string
): BulkPlaceAssignmentResult {
  if (!getPlaceById(placeId)) {
    return { ok: false, error: "Choose a canonical place first." };
  }

  const plan = planBulkPlaceAssignment(visit, imageRecordIds, placeId);

  if (plan.applicableIds.length === 0) {
    return { ok: true, visit, undo: null, plan };
  }

  const applicable = new Set(plan.applicableIds);
  const entries = (visit.imageRecords ?? [])
    .filter((record) => applicable.has(record.id))
    .map((record) => ({ imageRecordId: record.id, previousPlaceId: record.placeId }));

  return {
    ok: true,
    visit: {
      ...visit,
      imageRecords: (visit.imageRecords ?? []).map((record) => (applicable.has(record.id) ? { ...record, placeId } : record)),
    },
    undo: { placeId, entries },
    plan,
  };
}

/** Restores previous places. A record the curator changed afterwards is left exactly as it is. */
export function undoBulkPlaceAssignment(
  visit: Visit,
  undo: BulkPlaceAssignmentUndo
): { visit: Visit; restoredCount: number; skippedCount: number } {
  const pending = new Map(undo.entries.map((entry) => [entry.imageRecordId, entry]));
  let restoredCount = 0;

  const imageRecords = (visit.imageRecords ?? []).map((record) => {
    const entry = pending.get(record.id);

    if (!entry || record.placeId !== undo.placeId || record.placeDetailClassification || record.externalClassification || record.overviewClassification) {
      return record;
    }

    restoredCount += 1;
    const { placeId: _placeId, ...rest } = record;
    return entry.previousPlaceId ? { ...rest, placeId: entry.previousPlaceId } : rest;
  });

  return { visit: { ...visit, imageRecords }, restoredCount, skippedCount: undo.entries.length - restoredCount };
}
