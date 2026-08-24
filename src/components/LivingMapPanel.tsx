import { useState } from "react";
import { listCanonicalPlaces } from "../data/canonicalPlaces";
import { getPlaceHotspot } from "../data/placeHotspots";
import { PlaceMapReference } from "./PlaceMapReference";

const LIVING_MAP_IMAGE = "/images/living-map.png";
const LIVING_MAP_WIDTH = 1934;
const LIVING_MAP_HEIGHT = 1304;

interface LivingMapPanelProps {
  selectedPlaceId?: string | null;
  onPlaceSelect?: (placeId: string | null) => void;
}

/**
 * Full-aspect Living Map shown above the archive image timeline.
 * Hovering/focusing/clicking a place name or hotspot highlights the other;
 * clicking the banner (or the "Open map" affordance) opens the full, uncropped map.
 */
export function LivingMapPanel({ selectedPlaceId: controlledPlaceId, onPlaceSelect }: LivingMapPanelProps = {}) {
  const [hoveredPlaceId, setHoveredPlaceId] = useState<string | null>(null);
  const [localSelectedPlaceId, setLocalSelectedPlaceId] = useState<string | null>(null);
  const [isFullMapOpen, setIsFullMapOpen] = useState(false);
  const places = listCanonicalPlaces();
  const selectedPlaceId = controlledPlaceId === undefined ? localSelectedPlaceId : controlledPlaceId;
  const activePlaceId = hoveredPlaceId ?? selectedPlaceId;

  function selectPlace(placeId: string | null) {
    setLocalSelectedPlaceId(placeId);
    onPlaceSelect?.(placeId);
  }

  function clearHoverIfMatches(placeId: string) {
    setHoveredPlaceId((current) => (current === placeId ? null : current));
  }

  function openFullMap() {
    setIsFullMapOpen(true);
  }

  return (
    <section className="living-map-banner-section" data-testid="living-map-panel" aria-label="Living map of the courtyard">
      <div className="living-map-banner">
        <div
          className="living-map-banner-map"
          onClick={openFullMap}
          data-testid="living-map-banner-map"
        >
          <svg
            className="living-map-banner-svg"
            viewBox={`0 0 ${LIVING_MAP_WIDTH} ${LIVING_MAP_HEIGHT}`}
            preserveAspectRatio="xMidYMid meet"
            aria-hidden="true"
          >
            <image
              href={LIVING_MAP_IMAGE}
              x="0"
              y="0"
              width={LIVING_MAP_WIDTH}
              height={LIVING_MAP_HEIGHT}
              preserveAspectRatio="none"
            />
            {places.map((place) => {
              const hotspot = getPlaceHotspot(place.id);
              if (!hotspot || !hotspot.calibrated) {
                return null;
              }

              const isActive = activePlaceId === place.id;

              return (
                <circle
                  key={place.id}
                  cx={hotspot.x * LIVING_MAP_WIDTH}
                  cy={hotspot.y * LIVING_MAP_HEIGHT}
                  r={hotspot.radius * LIVING_MAP_WIDTH * (isActive ? 0.42 : 0.33)}
                  className={isActive ? "living-map-banner-hotspot is-active" : "living-map-banner-hotspot"}
                  tabIndex={0}
                  role="button"
                  aria-label={place.displayName}
                  data-testid={`living-map-hotspot-${place.id}`}
                  onClick={(event) => {
                    event.stopPropagation();
                    selectPlace(place.id);
                  }}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      event.stopPropagation();
                      selectPlace(place.id);
                    }
                  }}
                  onMouseEnter={() => setHoveredPlaceId(place.id)}
                  onMouseLeave={() => clearHoverIfMatches(place.id)}
                  onFocus={() => setHoveredPlaceId(place.id)}
                  onBlur={() => clearHoverIfMatches(place.id)}
                />
              );
            })}
          </svg>

          <button
            type="button"
            className="living-map-banner-open"
            onClick={(event) => {
              event.stopPropagation();
              openFullMap();
            }}
            data-testid="living-map-open-full"
          >
            <span aria-hidden="true">⤢</span> Open map
          </button>
        </div>

        <ul className="living-map-banner-places">
          <li>
            <button
              type="button"
              className={activePlaceId === null ? "living-map-banner-place is-active" : "living-map-banner-place"}
              onClick={() => selectPlace(null)}
              data-testid="living-map-place-all"
            >
              All places
            </button>
          </li>
          {places.map((place) => (
            <li key={place.id}>
              <button
                type="button"
                className={activePlaceId === place.id ? "living-map-banner-place is-active" : "living-map-banner-place"}
                onMouseEnter={() => setHoveredPlaceId(place.id)}
                onMouseLeave={() => clearHoverIfMatches(place.id)}
                onFocus={() => setHoveredPlaceId(place.id)}
                onBlur={() => clearHoverIfMatches(place.id)}
                onClick={() => selectPlace(place.id)}
                data-testid={`living-map-place-${place.id}`}
              >
                {place.displayName}
              </button>
            </li>
          ))}
        </ul>
      </div>

      {isFullMapOpen && (
        <div className="place-map-overlay" onClick={() => setIsFullMapOpen(false)}>
          <div className="place-map-popover" onClick={(event) => event.stopPropagation()}>
            <PlaceMapReference
              selectedPlaceId={activePlaceId ?? undefined}
              onClose={() => setIsFullMapOpen(false)}
            />
          </div>
        </div>
      )}
    </section>
  );
}

