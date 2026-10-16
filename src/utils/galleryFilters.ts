import type { Entry, ImageRecord } from "../models/blomzip";

export const UNASSIGNED_PLACE_FILTER = "__unassigned__";
export const EXTERNAL_PLACE_FILTER = "__external__";

export interface CurationFilters {
  unreviewedOnly: boolean;
  storySelectedOnly: boolean;
  showHidden: boolean;
}

export const DEFAULT_CURATION_FILTERS: CurationFilters = {
  unreviewedOnly: false,
  storySelectedOnly: false,
  showHidden: false,
};

interface FilterableItem {
  entry?: Pick<Entry, "hidden" | "reviewed" | "storySelected">;
  imageRecord?: Pick<ImageRecord, "placeId" | "externalClassification">;
}

export function matchesPlaceFilter(item: FilterableItem, placeFilter: string | null): boolean {
  if (placeFilter === null) {
    return true;
  }

  if (placeFilter === EXTERNAL_PLACE_FILTER) {
    return Boolean(item.imageRecord?.externalClassification);
  }

  if (placeFilter === UNASSIGNED_PLACE_FILTER) {
    return !item.imageRecord?.placeId && !item.imageRecord?.externalClassification;
  }

  return item.imageRecord?.placeId === placeFilter;
}

export function matchesCurationFilters(item: FilterableItem, filters: CurationFilters): boolean {
  if (item.entry?.hidden && !filters.showHidden) {
    return false;
  }

  if (filters.unreviewedOnly && item.entry?.reviewed) {
    return false;
  }

  if (filters.storySelectedOnly && !item.entry?.storySelected) {
    return false;
  }

  return true;
}

export interface PlaceImageCounts {
  total: number;
  unassigned: number;
  external: number;
  byPlace: Record<string, number>;
}

/** Counts honour only the hidden rule so a place count means "photographs in this place", whatever other filters are on. */
export function countImagesByPlace(items: FilterableItem[], showHidden: boolean): PlaceImageCounts {
  const counts: PlaceImageCounts = { total: 0, unassigned: 0, external: 0, byPlace: {} };

  for (const item of items) {
    if (item.entry?.hidden && !showHidden) {
      continue;
    }

    counts.total += 1;

    const placeId = item.imageRecord?.placeId;
    if (item.imageRecord?.externalClassification && !placeId) {
      counts.external += 1;
    } else if (placeId) {
      counts.byPlace[placeId] = (counts.byPlace[placeId] ?? 0) + 1;
    } else {
      counts.unassigned += 1;
    }
  }

  return counts;
}
