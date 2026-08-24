/**
 * Place hotspots data for the courtyard map reference.
 * These are relative positions (0–1) on the Living Map image where each canonical place is located.
 * Used by Place Discovery to help curators orient place assignments using the same spatial reference as Story.
 *
 * Coordinates are normalized to 0–1 range:
 * - x: 0 = left edge, 1 = right edge
 * - y: 0 = top edge, 1 = bottom edge
 * - radius: relative size of the hotspot circle
 *
 * Calibration status:
 * - calibrated: true = coordinates verified against living-map.png
 * - calibrated: false = placeholder position, needs manual calibration
 *
 * Development helper: Click on the map to calibrate normalized x/y coordinates.
 */

export interface PlaceHotspot {
  placeId: string;
  x: number;
  y: number;
  radius: number;
  calibrated: boolean;
}

/**
 * All 9 canonical courtyard places with hotspot positions on the Living Map.
 *
 * Calibrated places (verified visually against /images/living-map.png):
 * - seating-area: Sheltered seating area in the courtyard
 * - house-wall: Wall-side planting zone beside the house
 * - rock-garden: Rocky planting area in the courtyard
 *
 * Uncalibrated places (placeholder positions, need visual verification):
 * - parking: Boundary edge beside the parking area
 * - raised-bed: Planted raised bed area
 * - central-lawn: Central lawn area
 * - shade-corner: Shaded corner of the courtyard
 * - garden-border: Planted border along the garden edge
 * - entrance: Entrance threshold to the courtyard
 */
const PLACE_HOTSPOTS: PlaceHotspot[] = [
  {
    placeId: "parking",
    x: 0.15,
    y: 0.3,
    radius: 0.07,
    calibrated: false, // Placeholder: needs verification on living-map.png
  },
  {
    placeId: "raised-bed",
    x: 0.65,
    y: 0.2,
    radius: 0.08,
    calibrated: false, // Placeholder: needs verification on living-map.png
  },
  {
    placeId: "seating-area",
    x: 0.5,
    y: 0.6,
    radius: 0.08,
    calibrated: true, // Verified: sheltered seating area, mid-right position
  },
  {
    placeId: "central-lawn",
    x: 0.5,
    y: 0.5,
    radius: 0.1,
    calibrated: false, // Placeholder: needs verification on living-map.png
  },
  {
    placeId: "shade-corner",
    x: 0.25,
    y: 0.65,
    radius: 0.07,
    calibrated: false, // Placeholder: needs verification on living-map.png
  },
  {
    placeId: "rock-garden",
    x: 0.3,
    y: 0.4,
    radius: 0.06,
    calibrated: true, // Verified: rocky planting area, left-center position
  },
  {
    placeId: "garden-border",
    x: 0.7,
    y: 0.65,
    radius: 0.08,
    calibrated: false, // Placeholder: needs verification on living-map.png
  },
  {
    placeId: "house-wall",
    x: 0.75,
    y: 0.4,
    radius: 0.07,
    calibrated: true, // Verified: wall-side planting, right side position
  },
  {
    placeId: "entrance",
    x: 0.5,
    y: 0.15,
    radius: 0.06,
    calibrated: false, // Placeholder: needs verification on living-map.png
  },
];

const hotspotsByPlaceId = new Map(PLACE_HOTSPOTS.map((hotspot) => [hotspot.placeId, hotspot]));

export function getPlaceHotspot(placeId: string): PlaceHotspot | null {
  return hotspotsByPlaceId.get(placeId) ?? null;
}

export function listPlaceHotspots(): PlaceHotspot[] {
  return [...PLACE_HOTSPOTS];
}

export function isPlaceCalibrated(placeId: string): boolean {
  return hotspotsByPlaceId.get(placeId)?.calibrated ?? false;
}

export function calibratePlaceHotspot(placeId: string, coordinates: { x: number; y: number }): void {
  if (!import.meta.env.DEV) return;

  const hotspot = hotspotsByPlaceId.get(placeId);
  if (!hotspot) return;

  hotspot.x = coordinates.x;
  hotspot.y = coordinates.y;
  hotspot.calibrated = true;
}

export function getUncalibratedPlaceIds(): string[] {
  return PLACE_HOTSPOTS.filter((hotspot) => !hotspot.calibrated).map((hotspot) => hotspot.placeId);
}
