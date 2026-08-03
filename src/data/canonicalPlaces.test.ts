import { describe, expect, it } from "vitest";
import { getPlaceById, listCanonicalPlaces, resolvePlaceAlias } from "./canonicalPlaces";

describe("canonicalPlaces", () => {
  it("lists canonical places in sort order", () => {
    const places = listCanonicalPlaces();

    expect(places.map((place) => place.id)).toEqual([
      "parking",
      "raised-bed",
      "seating-area",
      "central-lawn",
      "shade-corner",
      "rock-garden",
      "garden-border",
      "house-wall",
      "entrance",
    ]);
  });

  it("looks up canonical places by id", () => {
    expect(getPlaceById("house-wall")?.displayName).toBe("The House Wall");
    expect(getPlaceById("courtyard-rabatt-vid-husvagg")?.id).toBe("house-wall");
    expect(getPlaceById("missing-place")).toBeNull();
  });

  it("resolves aliases case-insensitively and with whitespace tolerance", () => {
    expect(resolvePlaceAlias("  the   house   wall  ")?.id).toBe("house-wall");
    expect(resolvePlaceAlias("sittplatsen VID häcken")?.id).toBe("seating-area");
    expect(resolvePlaceAlias("Rabatt vid husvägg")?.id).toBe("house-wall");
    expect(resolvePlaceAlias("Bukett från innergården")).toBeNull();
    expect(resolvePlaceAlias("Courtyard / grönska")).toBeNull();
    expect(resolvePlaceAlias("unknown place")).toBeNull();
  });
});