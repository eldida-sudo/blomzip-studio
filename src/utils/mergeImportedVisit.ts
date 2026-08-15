import type { Entry, ImageRecord, Visit } from "../models/blomzip";
import { parseCaptureDate } from "./captureDate";
import { orderImageRecordsForTimeline } from "./orderImageRecordsForTimeline";

function inferVisitDateFromRecords(records: ImageRecord[], fallbackDate: string): string {
  const parsedDates = records
    .map((record) => record.captureDate)
    .filter((captureDate): captureDate is string => typeof captureDate === "string")
    .map((captureDate) => {
      return parseCaptureDate(captureDate)?.getTime() ?? null;
    })
    .filter((value): value is number => value !== null)
    .sort((left, right) => left - right);

  if (parsedDates.length === 0) {
    return fallbackDate;
  }

  return new Date(parsedDates[0]).toISOString().slice(0, 10);
}

function createFallbackEntry(imageRecordId: string, visitId: string, index: number): Entry {
  const now = new Date().toISOString();

  return {
    id: `entry-fallback-${index}-${imageRecordId}`,
    imageRecordId,
    visitId,
    status: "new",
    notes: "",
    tags: [],
    observations: [],
    favorite: false,
    hero: false,
    storySelected: false,
    reviewed: false,
    createdAt: now,
    updatedAt: now,
  };
}

export function mergeImportedVisit(currentVisit: Visit | null, incomingVisit: Visit | null): Visit | null {
  if (!incomingVisit) {
    return currentVisit;
  }

  if (!currentVisit) {
    return incomingVisit;
  }

  const mergedVisitId = currentVisit.id;
  const allImageRecords = [...(currentVisit.imageRecords ?? []), ...(incomingVisit.imageRecords ?? [])];
  const { orderedRecords } = orderImageRecordsForTimeline(allImageRecords);
  const reindexedRecords = orderedRecords.map((record, index) => ({
    ...record,
    timelineIndex: index,
  }));

  const entryByImageRecordId = new Map<string, Entry>();

  incomingVisit.entries.forEach((entry) => {
    entryByImageRecordId.set(entry.imageRecordId, entry);
  });

  // Human decisions are immutable: keep existing curation when duplicate record IDs appear.
  currentVisit.entries.forEach((entry) => {
    entryByImageRecordId.set(entry.imageRecordId, entry);
  });

  const orderedEntries = reindexedRecords.map((record, index) => {
    const existingEntry = entryByImageRecordId.get(record.id);

    if (!existingEntry) {
      return createFallbackEntry(record.id, mergedVisitId, index);
    }

    if (existingEntry.visitId === mergedVisitId) {
      return existingEntry;
    }

    return {
      ...existingEntry,
      visitId: mergedVisitId,
      updatedAt: new Date().toISOString(),
    };
  });

  const mergedBatches = [...(currentVisit.importBatches ?? []), ...(incomingVisit.importBatches ?? [])];
  const uniqueBatches = Array.from(new Map(mergedBatches.map((batch) => [batch.id, batch])).values()).sort((left, right) =>
    left.importedAt.localeCompare(right.importedAt)
  );

  return {
    ...currentVisit,
    placeId: incomingVisit.placeId || currentVisit.placeId,
    date: inferVisitDateFromRecords(reindexedRecords, currentVisit.date),
    imageCount: reindexedRecords.length,
    importedImageFiles: reindexedRecords.map((record) => record.filename),
    imageRecords: reindexedRecords,
    importBatches: uniqueBatches,
    status: "Ready for AI",
    entries: orderedEntries,
    weather: incomingVisit.weather ?? currentVisit.weather,
  };
}
