import type { ImageRecord, Visit } from "../models/blomzip";

export const EXTERNAL_PLACE_LABEL = "External / Inspiration";
export const EXTERNAL_BLOCKED_MESSAGE =
  "This photograph is marked External / Inspiration, so it was left unchanged. Return it to the archive pool first.";

export function isExternalRecord(record: Pick<ImageRecord, "externalClassification"> | null | undefined): boolean {
  return Boolean(record?.externalClassification);
}

/** Only unassigned, non-external photographs may be discovered, matched, sorted or assigned. */
export function isPlaceMatchEligible(
  record: Pick<ImageRecord, "placeId" | "externalClassification" | "overviewClassification" | "placeDetailClassification">
): boolean {
  return !record.placeId && !record.externalClassification && !record.overviewClassification && !record.placeDetailClassification;
}

/** Eligibility against the latest visit, for re-checking before a model request or when its result arrives. */
export function isRecordEligibleNow(visit: Visit | null | undefined, imageRecordId: string): boolean {
  const record = visit?.imageRecords?.find((candidate) => candidate.id === imageRecordId);
  return Boolean(record && isPlaceMatchEligible(record));
}

export type ExternalChangeResult = { ok: true; visit: Visit } | { ok: false; error: string };

/** Curator action. Refuses assigned photographs; never edits placeId, entries, Story flags or match history. */
export function markRecordExternal(visit: Visit, imageRecordId: string, now: string = new Date().toISOString()): ExternalChangeResult {
  const record = visit.imageRecords?.find((candidate) => candidate.id === imageRecordId);

  if (!record) {
    return { ok: false, error: "That photograph is no longer in the archive." };
  }

  if (record.placeId) {
    return {
      ok: false,
      error: "This photograph is assigned to a place. Unassign it first if it was not taken in the courtyard.",
    };
  }

  if (record.overviewClassification) {
    return {
      ok: false,
      error: "This photograph is marked Courtyard Overview. Return it to the archive pool first if it was taken elsewhere.",
    };
  }

  if (record.externalClassification) {
    return { ok: true, visit };
  }

  return {
    ok: true,
    visit: {
      ...visit,
      imageRecords: (visit.imageRecords ?? []).map((candidate) =>
        candidate.id === imageRecordId ? { ...candidate, externalClassification: { classifiedAt: now } } : candidate
      ),
    },
  };
}

/** Removes only the classification; everything else on the record is left exactly as it was. */
export function clearRecordExternal(visit: Visit, imageRecordId: string): ExternalChangeResult {
  const record = visit.imageRecords?.find((candidate) => candidate.id === imageRecordId);

  if (!record) {
    return { ok: false, error: "That photograph is no longer in the archive." };
  }

  if (!record.externalClassification) {
    return { ok: true, visit };
  }

  return {
    ok: true,
    visit: {
      ...visit,
      imageRecords: (visit.imageRecords ?? []).map((candidate) => {
        if (candidate.id !== imageRecordId) {
          return candidate;
        }
        const { externalClassification: _removed, ...rest } = candidate;
        return rest;
      }),
    },
  };
}
