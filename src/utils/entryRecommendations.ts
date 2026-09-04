import type {
  Entry,
  EntryRecommendation,
  EntryRecommendationKind,
  EntrySuggestionCategory,
  ImageRecord,
  Observation,
  Visit,
} from "../models/blomzip";
import type { ObservationEngine } from "../components/observationEngine";

export interface CurrentEditorialRecommendation {
  source: "v0.2";
  recommendation: EntryRecommendation;
}

export interface LegacyEditorialRecommendation {
  source: "legacy-category";
  kind: EntryRecommendationKind;
}

export type EditorialRecommendation = CurrentEditorialRecommendation | LegacyEditorialRecommendation;

const LEGACY_CATEGORY_TO_KIND: Array<{ category: string; kind: EntryRecommendationKind }> = [
  { category: "story-candidate", kind: "story" },
  { category: "hero-candidate", kind: "hero" },
  { category: "favorite-candidate", kind: "favorite" },
];

export function getEntryEditorialRecommendations(entry: Pick<Entry, "analysisSuggestions">): EditorialRecommendation[] {
  const suggestions = entry.analysisSuggestions;

  if (!suggestions) {
    return [];
  }

  if (suggestions.recommendations !== undefined) {
    return suggestions.recommendations.map((recommendation) => ({
      source: "v0.2" as const,
      recommendation,
    }));
  }

  return LEGACY_CATEGORY_TO_KIND
    .filter(({ category }) => suggestions.categories.includes(category as typeof suggestions.categories[number]))
    .map(({ kind }) => ({
      source: "legacy-category" as const,
      kind,
    }));
}

export function getPossibleDuplicateEntryIdsByRecord(imageRecords: ImageRecord[] | undefined): Map<string, string[]> {
  const duplicatesByRecordId = new Map<string, string[]>();

  if (!imageRecords || imageRecords.length < 2) {
    return duplicatesByRecordId;
  }

  const groups = new Map<string, string[]>();

  imageRecords.forEach((record) => {
    const width = record.width ?? 0;
    const height = record.height ?? 0;
    const sizeBucket = Math.round(record.fileSize / 1024);
    const key = `${record.format}-${width}x${height}-${sizeBucket}`;
    const group = groups.get(key) ?? [];
    group.push(record.id);
    groups.set(key, group);
  });

  groups.forEach((recordIds) => {
    if (recordIds.length < 2) {
      return;
    }

    recordIds.forEach((recordId) => {
      duplicatesByRecordId.set(
        recordId,
        recordIds.filter((candidateId) => candidateId !== recordId)
      );
    });
  });

  return duplicatesByRecordId;
}

export function createAutomaticSuggestions(options: {
  entry: Entry;
  imageRecord: ImageRecord | undefined;
  observations: Observation[];
  possibleDuplicateEntryIds: string[];
}) {
  const { entry, imageRecord, observations, possibleDuplicateEntryIds } = options;
  const confidenceValues = observations
    .map((observation) => observation.confidence)
    .filter((confidence): confidence is number => typeof confidence === "number");
  const confidence =
    confidenceValues.length > 0
      ? confidenceValues.reduce((total, value) => total + value, 0) / confidenceValues.length
      : 0.6;

  const hasChangeSignal = observations.some((observation) => observation.type.toLowerCase().includes("change"));
  const categories = new Set<EntrySuggestionCategory>();

  if (confidence >= 0.7) {
    categories.add("favorite-candidate");
  }

  if (confidence >= 0.85) {
    categories.add("hero-candidate");
  }

  if (hasChangeSignal) {
    categories.add("strong-change");
  }

  if (imageRecord?.orientation === "landscape") {
    categories.add("overview-image");
  } else {
    categories.add("detail-image");
  }

  if ((imageRecord?.sourcePath ?? "").includes("/")) {
    categories.add("by-place");
  }

  if (!entry.reviewed) {
    categories.add("needs-review");
  }

  if (confidence < 0.75) {
    categories.add("low-confidence");
  }

  if (possibleDuplicateEntryIds.length > 0) {
    categories.add("possible-duplicates");
  }

  return {
    engine: "mock-observation-engine" as const,
    generatedAt: new Date().toISOString(),
    confidence,
    categories: Array.from(categories),
    possibleDuplicateEntryIds: possibleDuplicateEntryIds.length > 0 ? possibleDuplicateEntryIds : undefined,
  };
}

export function withAutomaticAnalysisSuggestions(visit: Visit, observationEngine: ObservationEngine): Visit {
  const imageRecordsById = new Map((visit.imageRecords ?? []).map((record) => [record.id, record]));
  const duplicateRecordIds = getPossibleDuplicateEntryIdsByRecord(visit.imageRecords);
  const entryIdByRecordId = new Map(visit.entries.map((entry) => [entry.imageRecordId, entry.id]));

  return {
    ...visit,
    entries: visit.entries.map((entry) => {
      const imageRecord = imageRecordsById.get(entry.imageRecordId);
      const observations =
        entry.observations.length > 0 ? entry.observations : observationEngine.generateObservations(entry.id);

      if (entry.analysisSuggestions) {
        return {
          ...entry,
          observations,
        };
      }

      const possibleDuplicateEntryIds = (duplicateRecordIds.get(entry.imageRecordId) ?? [])
        .map((recordId) => entryIdByRecordId.get(recordId))
        .filter((entryId): entryId is string => Boolean(entryId));

      return {
        ...entry,
        observations,
        analysisSuggestions: createAutomaticSuggestions({
          entry,
          imageRecord,
          observations,
          possibleDuplicateEntryIds,
        }),
      };
    }),
  };
}