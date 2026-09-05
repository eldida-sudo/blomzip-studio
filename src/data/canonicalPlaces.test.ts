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
      "parking-trellis",
      "miriams-bed",
      "compost-area",
      "garden-arch",
      "under-maple",
      "parking-peninsula",
    ]);
  });

  it("exposes the complete expected id-to-label mapping with unique ids", () => {
    const places = listCanonicalPlaces();
    const ids = places.map((place) => place.id);

    expect(new Set(ids).size).toBe(ids.length);

    expect(Object.fromEntries(places.map((place) => [place.id, place.displayName]))).toEqual({
      parking: "Parking Edge — needs reassignment",
      "raised-bed": "The Raised Beds",
      "seating-area": "The Seating Area",
      "central-lawn": "The Lawn",
      "shade-corner": "The Shade Corner",
      "rock-garden": "The Rock Garden",
      "garden-border": "The Garden Border",
      "house-wall": "The Bicycle Trellis Bed",
      entrance: "Under the Pine",
      "parking-trellis": "The Parking Trellis",
      "miriams-bed": "Miriam's Bed",
      "compost-area": "The Compost Area",
      "garden-arch": "The Garden Arch",
      "under-maple": "Under the Maple",
      "parking-peninsula": "The Parking Peninsula",
    });
  });

  it("preserves the existing ids behind renamed places", () => {
    expect(getPlaceById("house-wall")?.displayName).toBe("The Bicycle Trellis Bed");
    expect(getPlaceById("entrance")?.displayName).toBe("Under the Pine");
  });

  it("keeps the legacy Parking Edge id selectable with a needs-reassignment label", () => {
    const parkingPlace = getPlaceById("parking");

    expect(parkingPlace?.id).toBe("parking");
    expect(parkingPlace?.displayName).toBe("Parking Edge — needs reassignment");
    expect(listCanonicalPlaces().some((place) => place.id === "parking")).toBe(true);
  });

  it("looks up canonical places by id", () => {
    expect(getPlaceById("house-wall")?.displayName).toBe("The Bicycle Trellis Bed");
    expect(getPlaceById("courtyard-rabatt-vid-husvagg")?.id).toBe("house-wall");
    expect(getPlaceById("missing-place")).toBeNull();
  });

  it("resolves aliases case-insensitively and with whitespace tolerance", () => {
    expect(resolvePlaceAlias("  the   bicycle   trellis   bed  ")?.id).toBe("house-wall");
    expect(resolvePlaceAlias("sittplatsen VID häcken")?.id).toBe("seating-area");
    expect(resolvePlaceAlias("Rabatt vid husvägg")?.id).toBe("house-wall");
    expect(resolvePlaceAlias("Portalen")?.id).toBe("garden-arch");
    expect(resolvePlaceAlias("Bukett från innergården")).toBeNull();
    expect(resolvePlaceAlias("Courtyard / grönska")).toBeNull();
    expect(resolvePlaceAlias("unknown place")).toBeNull();
  });
});