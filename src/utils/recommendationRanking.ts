import type { Entry, EntryRecommendation, EntryRecommendationKind, ImageRecord } from "../models/blomzip";
import { parseCaptureDate } from "./captureDate";

export type EditorialRecommendationRankingScope =
  | { type: "archive" }
  | { type: "canonical-place"; placeId: string };

export interface RankedEditorialRecommendation {
  entryId: string;
  imageRecordId: string;
  kind: EntryRecommendationKind;
  score: number;
  rank: number;
  scope: EditorialRecommendationRankingScope;
  placeId?: string;
  recommendation: EntryRecommendation;
}

export interface RankEditorialRecommendationsOptions {
  entries: Entry[];
  imageRecords: ImageRecord[] | undefined;
  kind: EntryRecommendationKind;
  scope: EditorialRecommendationRankingScope;
}

interface RankingCandidate extends RankedEditorialRecommendation {
  captureTimestamp: number | null;
  timelineIndex: number | null;
  entryIndex: number;
}

function matchesScope(imageRecord: ImageRecord | undefined, scope: EditorialRecommendationRankingScope): boolean {
  return scope.type === "archive" || imageRecord?.placeId === scope.placeId;
}

function compareCandidates(left: RankingCandidate, right: RankingCandidate): number {
  if (right.score !== left.score) {
    return right.score - left.score;
  }

  if (left.captureTimestamp !== right.captureTimestamp) {
    if (left.captureTimestamp === null) {
      return 1;
    }

    if (right.captureTimestamp === null) {
      return -1;
    }

    return left.captureTimestamp - right.captureTimestamp;
  }

  if (left.timelineIndex !== right.timelineIndex) {
    if (left.timelineIndex === null) {
      return 1;
    }

    if (right.timelineIndex === null) {
      return -1;
    }

    return left.timelineIndex - right.timelineIndex;
  }

  if (left.entryIndex !== right.entryIndex) {
    return left.entryIndex - right.entryIndex;
  }

  return left.entryId.localeCompare(right.entryId);
}

/**
 * Returns a derived ranking of stored v0.2 recommendations without mutating archive data.
 * Future time-range or sequence scopes can be added to EditorialRecommendationRankingScope.
 */
export function rankEditorialRecommendations(options: RankEditorialRecommendationsOptions): RankedEditorialRecommendation[] {
  const imageRecordById = new Map((options.imageRecords ?? []).map((imageRecord) => [imageRecord.id, imageRecord]));
  const candidates: RankingCandidate[] = [];

  options.entries.forEach((entry, entryIndex) => {
    const imageRecord = imageRecordById.get(entry.imageRecordId);

    if (!matchesScope(imageRecord, options.scope)) {
      return;
    }

    const recommendations = entry.analysisSuggestions?.recommendations ?? [];
    recommendations.forEach((recommendation) => {
      if (recommendation.kind !== options.kind || !Number.isFinite(recommendation.score)) {
        return;
      }

      candidates.push({
        entryId: entry.id,
        imageRecordId: entry.imageRecordId,
        kind: recommendation.kind,
        score: recommendation.score,
        rank: 0,
        scope: options.scope,
        placeId: imageRecord?.placeId,
        recommendation,
        captureTimestamp: parseCaptureDate(imageRecord?.captureDate)?.getTime() ?? null,
        timelineIndex: imageRecord?.timelineIndex ?? null,
        entryIndex,
      });
    });
  });

  return candidates
    .sort(compareCandidates)
    .map(({ captureTimestamp: _captureTimestamp, timelineIndex: _timelineIndex, entryIndex: _entryIndex, ...candidate }, index) => ({
      ...candidate,
      rank: index + 1,
    }));
}