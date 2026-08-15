import type { Entry, EntryRecommendation, ImageRecord, Visit } from "../models/blomzip";
import { parseCaptureDate } from "./captureDate";

const STORY_ANALYSIS_VERSION = 2;
const MIN_CONTEXT_SPAN_MS = 14 * 24 * 60 * 60 * 1000;
const MIN_TEMPORAL_SEPARATION_MS = 14 * 24 * 60 * 60 * 1000;

interface StoryRow {
  entry: Entry;
  imageRecord: ImageRecord;
  captureTimestamp: number | null;
  timelineIndex: number;
}

function compareStoryRows(left: StoryRow, right: StoryRow): number {
  if (left.captureTimestamp !== right.captureTimestamp) {
    if (left.captureTimestamp === null) return 1;
    if (right.captureTimestamp === null) return -1;
    return left.captureTimestamp - right.captureTimestamp;
  }

  if (left.timelineIndex !== right.timelineIndex) {
    return left.timelineIndex - right.timelineIndex;
  }

  return left.entry.id.localeCompare(right.entry.id);
}

function getDuplicateKey(imageRecord: ImageRecord): string | null {
  if (!imageRecord.width || !imageRecord.height || !imageRecord.fileSize) {
    return null;
  }

  return `${imageRecord.format}-${imageRecord.width}x${imageRecord.height}-${Math.round(imageRecord.fileSize / 1024)}`;
}

function getDuplicateRepresentativeIds(rows: StoryRow[]): Set<string> {
  const rowsByDuplicateKey = new Map<string, StoryRow[]>();

  rows.forEach((row) => {
    const duplicateKey = getDuplicateKey(row.imageRecord);
    if (!duplicateKey) return;

    const group = rowsByDuplicateKey.get(duplicateKey) ?? [];
    group.push(row);
    rowsByDuplicateKey.set(duplicateKey, group);
  });

  const suppressedEntryIds = new Set<string>();
  rowsByDuplicateKey.forEach((group) => {
    if (group.length < 2) return;

    const representative = [...group].sort(compareStoryRows)[0];
    group.forEach((row) => {
      if (row.entry.id !== representative?.entry.id) {
        suppressedEntryIds.add(row.entry.id);
      }
    });
  });

  return suppressedEntryIds;
}

function getGeneratedAt(visit: Visit): string {
  const timestamps = (visit.importBatches ?? [])
    .map((batch) => Date.parse(batch.importedAt))
    .filter((timestamp) => !Number.isNaN(timestamp));

  if (timestamps.length > 0) {
    return new Date(Math.max(...timestamps)).toISOString();
  }

  const visitTimestamp = parseCaptureDate(visit.date)?.getTime();
  return visitTimestamp === undefined ? "1970-01-01T00:00:00.000Z" : new Date(visitTimestamp).toISOString();
}

function buildStoryRecommendation(options: {
  row: StoryRow;
  contextRows: StoryRow[];
  generatedAt: string;
}): EntryRecommendation | null {
  const { row, contextRows, generatedAt } = options;
  if (row.captureTimestamp === null || contextRows.length < 2) {
    return null;
  }

  const datedRows = contextRows.filter((contextRow) => contextRow.captureTimestamp !== null).sort(compareStoryRows);
  if (datedRows.length < 2) {
    return null;
  }

  const firstTimestamp = datedRows[0]?.captureTimestamp ?? 0;
  const lastTimestamp = datedRows[datedRows.length - 1]?.captureTimestamp ?? 0;
  const span = lastTimestamp - firstTimestamp;
  const rowIndex = datedRows.findIndex((contextRow) => contextRow.entry.id === row.entry.id);
  const isAnchor = span >= MIN_CONTEXT_SPAN_MS && (rowIndex === 0 || rowIndex === datedRows.length - 1);
  const previousTimestamp = rowIndex > 0 ? datedRows[rowIndex - 1]?.captureTimestamp ?? null : null;
  const nextTimestamp = rowIndex >= 0 && rowIndex < datedRows.length - 1 ? datedRows[rowIndex + 1]?.captureTimestamp ?? null : null;
  const nearestGap = Math.min(
    previousTimestamp === null ? Number.POSITIVE_INFINITY : row.captureTimestamp - previousTimestamp,
    nextTimestamp === null ? Number.POSITIVE_INFINITY : nextTimestamp - row.captureTimestamp
  );
  const hasTemporalSeparation = nearestGap >= MIN_TEMPORAL_SEPARATION_MS;

  if (!isAnchor && !hasTemporalSeparation) {
    return null;
  }

  const reasons: string[] = [];
  const evidence: EntryRecommendation["evidence"] = [];
  let score = 0;
  const contextLabel = row.imageRecord.placeId ? "this place" : "the archive";

  if (isAnchor) {
    score += 0.38;
    reasons.push(`Provides an ${rowIndex === 0 ? "early" : "late"} chronological reference for ${contextLabel}.`);
    evidence.push({
      signal: "chronological-anchor",
      contribution: 0.38,
      detail: `${Math.round(span / (24 * 60 * 60 * 1000))} days across available dated photographs`,
    });
  }

  if (hasTemporalSeparation) {
    score += 0.32;
    reasons.push(`Adds temporal separation from nearby photographs in ${contextLabel}.`);
    evidence.push({
      signal: "temporal-separation",
      contribution: 0.32,
      detail: `${Math.round(nearestGap / (24 * 60 * 60 * 1000))} days to the nearest dated photograph`,
    });
  }

  if (row.imageRecord.placeId && contextRows.length <= 3) {
    score += 0.18;
    reasons.push("Adds coverage to an underrepresented place in the archive.");
    evidence.push({
      signal: "place-coverage",
      contribution: 0.18,
      detail: `${contextRows.length} photographs currently assigned to this place`,
    });
  }

  return {
    kind: "story",
    score: Math.round(Math.min(score, 1) * 100) / 100,
    reasons,
    evidence,
    engine: "vision-engine-v0.2-story-context",
    generatedAt,
    analysisVersion: STORY_ANALYSIS_VERSION,
  };
}

/**
 * Derives Story assessments from stable archive metadata only. Context-sensitive values
 * should be regenerated after imports or canonical-place changes; ranks remain derived.
 */
export function generateStoryRecommendations(visit: Visit): Map<string, EntryRecommendation> {
  const imageRecordById = new Map((visit.imageRecords ?? []).map((imageRecord) => [imageRecord.id, imageRecord]));
  const rows = visit.entries
    .map((entry, index) => {
      const imageRecord = imageRecordById.get(entry.imageRecordId);
      if (!imageRecord) return null;

      return {
        entry,
        imageRecord,
        captureTimestamp: parseCaptureDate(imageRecord.captureDate)?.getTime() ?? null,
        timelineIndex: imageRecord.timelineIndex ?? index,
      };
    })
    .filter((row): row is StoryRow => row !== null);
  const suppressedEntryIds = getDuplicateRepresentativeIds(rows);
  const rowsByContext = new Map<string, StoryRow[]>();
  const generatedAt = getGeneratedAt(visit);

  rows.forEach((row) => {
    const contextKey = row.imageRecord.placeId ? `place:${row.imageRecord.placeId}` : "archive:unassigned";
    const contextRows = rowsByContext.get(contextKey) ?? [];
    contextRows.push(row);
    rowsByContext.set(contextKey, contextRows);
  });

  const recommendations = new Map<string, EntryRecommendation>();
  rows.forEach((row) => {
    if (suppressedEntryIds.has(row.entry.id)) return;

    const contextKey = row.imageRecord.placeId ? `place:${row.imageRecord.placeId}` : "archive:unassigned";
    const recommendation = buildStoryRecommendation({
      row,
      contextRows: rowsByContext.get(contextKey) ?? [],
      generatedAt,
    });

    if (recommendation) {
      recommendations.set(row.entry.id, recommendation);
    }
  });

  return recommendations;
}

export function applyStoryRecommendations(visit: Visit): Visit {
  const recommendationsByEntryId = generateStoryRecommendations(visit);

  return {
    ...visit,
    entries: visit.entries.map((entry) => {
      if (!entry.analysisSuggestions) return entry;

      const retainedRecommendations = (entry.analysisSuggestions.recommendations ?? [])
        .filter((recommendation) => recommendation.kind !== "story");
      const storyRecommendation = recommendationsByEntryId.get(entry.id);

      return {
        ...entry,
        analysisSuggestions: {
          ...entry.analysisSuggestions,
          recommendations: storyRecommendation
            ? [...retainedRecommendations, storyRecommendation]
            : retainedRecommendations,
        },
      };
    }),
  };
}