import { getPlaceById } from "../data/canonicalPlaces";
import type { ImageRecord, Visit } from "../models/blomzip";

export const OVERVIEW_PLACE_LABEL = "Courtyard Overview";
export const OVERVIEW_BLOCKED_MESSAGE =
  "This photograph is marked Courtyard Overview, so it was left unchanged. Return it to the archive pool first.";

export function isOverviewRecord(record: Pick<ImageRecord, "overviewClassification"> | null | undefined): boolean {
  return Boolean(record?.overviewClassification);
}

export type OverviewChangeResult = { ok: true; visit: Visit } | { ok: false; error: string };

function findRecord(visit: Visit, imageRecordId: string): ImageRecord | undefined {
  return visit.imageRecords?.find((candidate) => candidate.id === imageRecordId);
}

function replaceRecord(visit: Visit, imageRecordId: string, update: (record: ImageRecord) => ImageRecord): Visit {
  return {
    ...visit,
    imageRecords: (visit.imageRecords ?? []).map((candidate) => (candidate.id === imageRecordId ? update(candidate) : candidate)),
  };
}

/** Keeps only known canonical place IDs, de-duplicated in first-seen order. */
export function normalizeVisiblePlaceIds(placeIds: readonly string[]): string[] {
  return Array.from(new Set(placeIds)).filter((placeId) => Boolean(getPlaceById(placeId)));
}

/** Curator action. Refuses assigned or External photographs; never edits placeId, entries, Story flags or match history. */
export function markRecordOverview(visit: Visit, imageRecordId: string, now: string = new Date().toISOString()): OverviewChangeResult {
  const record = findRecord(visit, imageRecordId);

  if (!record) {
    return { ok: false, error: "That photograph is no longer in the archive." };
  }

  if (record.placeId) {
    return {
      ok: false,
      error: "This photograph is assigned to a place. Unassign it first; nothing is unassigned automatically.",
    };
  }

  if (record.externalClassification) {
    return { ok: false, error: "This photograph is marked External / Inspiration. Return it to the archive pool first." };
  }

  if (record.overviewClassification) {
    return { ok: true, visit };
  }

  return { ok: true, visit: replaceRecord(visit, imageRecordId, (candidate) => ({ ...candidate, overviewClassification: { classifiedAt: now } })) };
}

/** Removes the classification and its secondary references only; everything else is left exactly as it was. */
export function clearRecordOverview(visit: Visit, imageRecordId: string): OverviewChangeResult {
  const record = findRecord(visit, imageRecordId);

  if (!record) {
    return { ok: false, error: "That photograph is no longer in the archive." };
  }

  if (!record.overviewClassification) {
    return { ok: true, visit };
  }

  return {
    ok: true,
    visit: replaceRecord(visit, imageRecordId, (candidate) => {
      const { overviewClassification: _removed, ...rest } = candidate;
      return rest;
    }),
  };
}

/** Records optional secondary place references on an Overview photograph. These are not assignments or anchors. */
export function setOverviewVisiblePlaces(visit: Visit, imageRecordId: string, placeIds: readonly string[]): OverviewChangeResult {
  const record = findRecord(visit, imageRecordId);

  if (!record) {
    return { ok: false, error: "That photograph is no longer in the archive." };
  }

  if (!record.overviewClassification) {
    return { ok: false, error: "Mark this photograph as Courtyard Overview before recording visible places." };
  }

  const normalized = normalizeVisiblePlaceIds(placeIds);
  const current = record.overviewClassification.visiblePlaceIds ?? [];

  if (normalized.length === current.length && normalized.every((placeId, index) => placeId === current[index])) {
    return { ok: true, visit };
  }

  return {
    ok: true,
    visit: replaceRecord(visit, imageRecordId, (candidate) => {
      const { visiblePlaceIds: _previous, ...base } = candidate.overviewClassification!;
      return {
        ...candidate,
        overviewClassification: normalized.length > 0 ? { ...base, visiblePlaceIds: normalized } : base,
      };
    }),
  };
}
