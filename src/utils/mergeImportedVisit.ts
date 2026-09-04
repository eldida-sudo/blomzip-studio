import type { Entry, ImageOccurrence, ImageRecord, ImportBatch, Visit } from "../models/blomzip";
import type { ObservationEngine } from "../components/observationEngine";
import { parseCaptureDate } from "./captureDate";
import { withAutomaticAnalysisSuggestions } from "./entryRecommendations";
import { orderImageRecordsForTimeline } from "./orderImageRecordsForTimeline";
import { applyStoryRecommendations } from "./storyRecommendations";

export interface BatchImportOutcome {
  fileName: string;
  rawImageCount: number;
  importedImageCount: number;
  duplicateSkippedCount: number;
  totalPhotographs: number;
  totalBatches: number;
}

export interface MergeImportedVisitOptions {
  observationEngine?: ObservationEngine;
}

// Shared wording so "supported / new / matched" never disagrees between sidebar surfaces.
export function formatBatchImportSummary(rawCount: number, importedCount: number, duplicateCount: number): string {
  const newLabel = `${importedCount} new photograph${importedCount === 1 ? "" : "s"}`;

  if (duplicateCount > 0) {
    return `${newLabel} · ${duplicateCount} matched to existing photograph${duplicateCount === 1 ? "" : "s"}`;
  }

  return `${rawCount} supported · ${newLabel} added`;
}

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

function cloneVisitForMerge(visit: Visit): Visit {
  return {
    ...visit,
    entries: visit.entries.map((entry) => ({
      ...entry,
      tags: [...entry.tags],
      observations: entry.observations.map((observation) => ({ ...observation })),
      analysisSuggestions: entry.analysisSuggestions
        ? {
            ...entry.analysisSuggestions,
            categories: [...entry.analysisSuggestions.categories],
            possibleDuplicateEntryIds: entry.analysisSuggestions.possibleDuplicateEntryIds
              ? [...entry.analysisSuggestions.possibleDuplicateEntryIds]
              : undefined,
            recommendations: entry.analysisSuggestions.recommendations
              ? entry.analysisSuggestions.recommendations.map((recommendation) => ({
                  ...recommendation,
                  reasons: [...recommendation.reasons],
                  evidence: recommendation.evidence.map((evidence) => ({ ...evidence })),
                }))
              : undefined,
          }
        : undefined,
    })),
    imageRecords: visit.imageRecords?.map((record) => ({
      ...record,
      additionalOccurrences: record.additionalOccurrences?.map((occurrence) => ({ ...occurrence })),
    })),
    importBatches: visit.importBatches?.map((batch) => ({
      ...batch,
      sourceMetadata: batch.sourceMetadata ? { ...batch.sourceMetadata } : undefined,
    })),
  };
}

export function createBatchImportOutcome(
  mergedVisit: Visit | null,
  targetBatchId?: string | null
): BatchImportOutcome | null {
  if (!mergedVisit || !mergedVisit.importBatches || mergedVisit.importBatches.length === 0) {
    return null;
  }

  const batches = mergedVisit.importBatches;
  const targetBatch = targetBatchId
    ? batches.find((b) => b.id === targetBatchId) ?? batches[batches.length - 1]
    : batches[batches.length - 1];

  if (!targetBatch) {
    return null;
  }

  return {
    fileName: targetBatch.fileName,
    rawImageCount: targetBatch.rawImageCount ?? targetBatch.imageCount,
    importedImageCount: targetBatch.importedImageCount ?? targetBatch.imageCount,
    duplicateSkippedCount: targetBatch.duplicateSkippedCount ?? 0,
    totalPhotographs: mergedVisit.imageRecords?.length ?? mergedVisit.imageCount ?? 0,
    totalBatches: batches.length,
  };
}

export function mergeImportedVisit(
  currentVisit: Visit | null,
  incomingVisit: Visit | null,
  options?: MergeImportedVisitOptions
): Visit | null {
  if (!incomingVisit) {
    return currentVisit;
  }

  incomingVisit = cloneVisitForMerge(incomingVisit);

  if (!currentVisit) {
    let analyzedVisit = incomingVisit;
    if (options?.observationEngine) {
      analyzedVisit = withAutomaticAnalysisSuggestions(incomingVisit, options.observationEngine);
    }
    const finalVisit = applyStoryRecommendations(analyzedVisit);
    const firstBatch = finalVisit.importBatches?.[0];
    if (firstBatch) {
      firstBatch.rawImageCount = firstBatch.rawImageCount ?? finalVisit.imageRecords?.length ?? 0;
      firstBatch.importedImageCount = finalVisit.imageRecords?.length ?? 0;
      firstBatch.duplicateSkippedCount = firstBatch.duplicateSkippedCount ?? 0;
      firstBatch.imageCount = finalVisit.imageRecords?.length ?? 0;
    }
    return finalVisit;
  }

  const incomingBatch = incomingVisit.importBatches?.[0];
  const incomingBatchId = incomingBatch?.id ?? "";
  const incomingBatchImportedAt = incomingBatch?.importedAt ?? new Date().toISOString();

  // Clone existing records so provenance updates do not mutate previous state directly
  const existingRecords: ImageRecord[] = (currentVisit.imageRecords ?? []).map((record) => ({
    ...record,
    additionalOccurrences: record.additionalOccurrences
      ? record.additionalOccurrences.map((occ) => ({ ...occ }))
      : undefined,
  }));

  const existingByHash = new Map<string, ImageRecord>();

  for (const record of existingRecords) {
    if (record.contentHash) {
      existingByHash.set(record.contentHash, record);
    }
  }

  const newUniqueRecords: ImageRecord[] = [];
  const newUniqueEntries: Entry[] = [];
  let crossBatchDuplicateCount = 0;
  const incomingEntryByRecordId = new Map(incomingVisit.entries.map((entry) => [entry.imageRecordId, entry]));

  for (const incRecord of incomingVisit.imageRecords ?? []) {
    const matchedCanonical = incRecord.contentHash ? existingByHash.get(incRecord.contentHash) : undefined;

    if (matchedCanonical) {
      crossBatchDuplicateCount += 1;
      const occurrences: ImageOccurrence[] = matchedCanonical.additionalOccurrences
        ? [...matchedCanonical.additionalOccurrences]
        : [];

      occurrences.push({
        importBatchId: incRecord.importBatchId ?? incomingBatchId,
        filename: incRecord.filename,
        sourcePath: incRecord.sourcePath,
        importedAt: incomingBatchImportedAt,
      });

      if (incRecord.additionalOccurrences) {
        occurrences.push(...incRecord.additionalOccurrences);
      }

      matchedCanonical.additionalOccurrences = occurrences;
    } else {
      newUniqueRecords.push(incRecord);
      if (incRecord.contentHash) {
        existingByHash.set(incRecord.contentHash, incRecord);
      }

      const matchingEntry = incomingEntryByRecordId.get(incRecord.id);
      if (matchingEntry) {
        newUniqueEntries.push(matchingEntry);
      }
    }
  }

  // Analyze ONLY newly surviving unique incoming records
  let analyzedNewEntries = newUniqueEntries;
  if (options?.observationEngine && newUniqueRecords.length > 0) {
    const miniVisit: Visit = {
      ...incomingVisit,
      imageRecords: newUniqueRecords,
      entries: newUniqueEntries,
      imageCount: newUniqueRecords.length,
      importedImageFiles: newUniqueRecords.map((r) => r.filename),
    };
    const analyzedMini = withAutomaticAnalysisSuggestions(miniVisit, options.observationEngine);
    analyzedNewEntries = analyzedMini.entries;
  }

  const allRecords = [...existingRecords, ...newUniqueRecords];
  const { orderedRecords } = orderImageRecordsForTimeline(allRecords);
  const reindexedRecords = orderedRecords.map((record, index) => ({
    ...record,
    timelineIndex: index,
  }));

  const mergedVisitId = currentVisit.id;
  const analyzedNewEntryMap = new Map(analyzedNewEntries.map((entry) => [entry.imageRecordId, entry]));
  const existingEntryMap = new Map(currentVisit.entries.map((entry) => [entry.imageRecordId, entry]));

  // Human decisions and existing non-story analysis are immutable
  const orderedEntries = reindexedRecords.map((record, index) => {
    const existingEntry = existingEntryMap.get(record.id);
    if (existingEntry) {
      if (existingEntry.visitId === mergedVisitId) {
        return existingEntry;
      }
      return {
        ...existingEntry,
        visitId: mergedVisitId,
        updatedAt: new Date().toISOString(),
      };
    }

    const newEntry = analyzedNewEntryMap.get(record.id);
    if (newEntry) {
      if (newEntry.visitId === mergedVisitId) {
        return newEntry;
      }
      return {
        ...newEntry,
        visitId: mergedVisitId,
        updatedAt: new Date().toISOString(),
      };
    }

    return createFallbackEntry(record.id, mergedVisitId, index);
  });

  // Update batch metrics for the incoming batch
  if (incomingBatch) {
    const inBatchSkipped = incomingBatch.duplicateSkippedCount ?? 0;
    const rawCount =
      incomingBatch.rawImageCount ??
      (incomingVisit.importedImageFiles?.length ?? incomingVisit.imageRecords?.length ?? 0);

    incomingBatch.rawImageCount = rawCount;
    incomingBatch.duplicateSkippedCount = inBatchSkipped + crossBatchDuplicateCount;
    incomingBatch.importedImageCount = newUniqueRecords.length;
    incomingBatch.imageCount = newUniqueRecords.length;
  }

  const incomingBatches = incomingVisit.importBatches ?? [];
  const mergedBatches: ImportBatch[] = [...(currentVisit.importBatches ?? []), ...incomingBatches];
  const uniqueBatches = Array.from(new Map(mergedBatches.map((batch) => [batch.id, batch])).values()).sort(
    (left, right) => left.importedAt.localeCompare(right.importedAt)
  );

  const mergedVisit: Visit = {
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

  return applyStoryRecommendations(mergedVisit);
}
