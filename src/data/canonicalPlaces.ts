export interface CanonicalPlace {
  id: string;
  displayName: string;
  shortDescription: string;
  aliases: string[];
  sortOrder: number;
}

const CANONICAL_PLACES: CanonicalPlace[] = [
  {
    id: "parking",
    displayName: "The Parking Edge",
    shortDescription: "The boundary edge beside the parking area.",
    aliases: [],
    sortOrder: 1,
  },
  {
    id: "raised-bed",
    displayName: "The Raised Beds",
    shortDescription: "The planted raised bed area.",
    aliases: [],
    sortOrder: 2,
  },
  {
    id: "seating-area",
    displayName: "The Seating Area",
    shortDescription: "The sheltered seating place in the courtyard.",
    aliases: ["Sittplatsen vid häcken", "sittplatsen vid häcken"],
    sortOrder: 3,
  },
  {
    id: "central-lawn",
    displayName: "The Lawn",
    shortDescription: "The central lawn area.",
    aliases: [],
    sortOrder: 4,
  },
  {
    id: "shade-corner",
    displayName: "The Shade Corner",
    shortDescription: "The shaded corner of the courtyard.",
    aliases: [],
    sortOrder: 5,
  },
  {
    id: "rock-garden",
    displayName: "The Rock Garden",
    shortDescription: "The rocky planting area.",
    aliases: [],
    sortOrder: 6,
  },
  {
    id: "garden-border",
    displayName: "The Garden Border",
    shortDescription: "The planted border along the garden edge.",
    aliases: [],
    sortOrder: 7,
  },
  {
    id: "house-wall",
    displayName: "The House Wall",
    shortDescription: "The wall-side planting zone beside the house.",
    aliases: ["Rabatt vid husvägg", "rabatt vid husvägg"],
    sortOrder: 8,
  },
  {
    id: "entrance",
    displayName: "The Entrance",
    shortDescription: "The entrance threshold to the courtyard.",
    aliases: [],
    sortOrder: 9,
  },
];

const LEGACY_PLACE_ID_MAP: Record<string, string> = {
  "courtyard-rabatt-vid-husvagg": "house-wall",
  "courtyard-sittplatsen-vid-hacken": "seating-area",
};

function normalizePlaceKey(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

const placeById = new Map(CANONICAL_PLACES.map((place) => [place.id, place]));
const placeByAlias = new Map<string, CanonicalPlace>();

CANONICAL_PLACES.forEach((place) => {
  placeByAlias.set(normalizePlaceKey(place.id), place);
  placeByAlias.set(normalizePlaceKey(place.displayName), place);

  place.aliases.forEach((alias) => {
    placeByAlias.set(normalizePlaceKey(alias), place);
  });
});

Object.entries(LEGACY_PLACE_ID_MAP).forEach(([legacyPlaceId, currentPlaceId]) => {
  const currentPlace = placeById.get(currentPlaceId);

  if (currentPlace) {
    placeByAlias.set(normalizePlaceKey(legacyPlaceId), currentPlace);
  }
});

export function listCanonicalPlaces(): CanonicalPlace[] {
  return [...CANONICAL_PLACES]
    .sort((left, right) => left.sortOrder - right.sortOrder)
    .map((place) => ({
      ...place,
      aliases: [...place.aliases],
    }));
}

export function getPlaceById(placeId: string): CanonicalPlace | null {
  return placeById.get(placeId) ?? placeByAlias.get(normalizePlaceKey(placeId)) ?? null;
}

export function resolvePlaceAlias(alias: string): CanonicalPlace | null {
  const normalizedAlias = normalizePlaceKey(alias);
  return placeByAlias.get(normalizedAlias) ?? null;
}
