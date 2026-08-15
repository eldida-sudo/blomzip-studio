import type { Entry, EntryRecommendation, EntryRecommendationKind } from "../models/blomzip";

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