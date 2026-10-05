import { describe, expect, it } from "vitest";
import {
  countImagesByPlace,
  DEFAULT_CURATION_FILTERS,
  matchesCurationFilters,
  matchesPlaceFilter,
  UNASSIGNED_PLACE_FILTER,
} from "./galleryFilters";

const items = [
  { entry: { reviewed: true, storySelected: true }, imageRecord: { placeId: "rock-garden" } },
  { entry: { reviewed: false }, imageRecord: {} },
  { entry: { reviewed: false, hidden: true }, imageRecord: { placeId: "rock-garden" } },
  { entry: { reviewed: false, hidden: true }, imageRecord: {} },
];

describe("galleryFilters", () => {
  it("excludes hidden entries unless showHidden is on", () => {
    expect(items.filter((item) => matchesCurationFilters(item, DEFAULT_CURATION_FILTERS))).toHaveLength(2);
    expect(items.filter((item) => matchesCurationFilters(item, { ...DEFAULT_CURATION_FILTERS, showHidden: true }))).toHaveLength(4);
  });

  it("filters unreviewed and story-selected entries", () => {
    const base = { ...DEFAULT_CURATION_FILTERS, showHidden: true };

    expect(items.filter((item) => matchesCurationFilters(item, { ...base, unreviewedOnly: true }))).toHaveLength(3);
    expect(items.filter((item) => matchesCurationFilters(item, { ...base, storySelectedOnly: true }))).toHaveLength(1);
  });

  it("matches the unassigned and specific place filters", () => {
    expect(items.filter((item) => matchesPlaceFilter(item, null))).toHaveLength(4);
    expect(items.filter((item) => matchesPlaceFilter(item, UNASSIGNED_PLACE_FILTER))).toHaveLength(2);
    expect(items.filter((item) => matchesPlaceFilter(item, "rock-garden"))).toHaveLength(2);
  });

  it("counts per place, honouring only the hidden rule", () => {
    expect(countImagesByPlace(items, false)).toEqual({ total: 2, unassigned: 1, byPlace: { "rock-garden": 1 } });
    expect(countImagesByPlace(items, true)).toEqual({ total: 4, unassigned: 2, byPlace: { "rock-garden": 2 } });
  });
});
