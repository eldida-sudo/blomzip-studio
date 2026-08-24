import { useEffect, useState } from "react";
import { listCanonicalPlaces } from "../data/canonicalPlaces";
import { calibratePlaceHotspot, getPlaceHotspot, isPlaceCalibrated, listPlaceHotspots } from "../data/placeHotspots";

interface PlaceMapReferenceProps {
  selectedPlaceId?: string;
  onClose?: () => void;
}

const COURTYARD_MAP_IMAGE = "/images/living-map.png";
const LIVING_MAP_WIDTH = 1934;
const LIVING_MAP_HEIGHT = 1304;
const IS_DEVELOPMENT = import.meta.env.DEV;

export function PlaceMapReference({ selectedPlaceId, onClose }: PlaceMapReferenceProps) {
  const [calibrationPlaceId, setCalibrationPlaceId] = useState(selectedPlaceId ?? "");
  const [calibrationCoordinates, setCalibrationCoordinates] = useState<{ x: number; y: number } | null>(null);
  const activePlaceId = calibrationPlaceId || undefined;
  const selectedHotspot = activePlaceId ? getPlaceHotspot(activePlaceId) : null;
  const isCalibrated = activePlaceId ? isPlaceCalibrated(activePlaceId) : false;

  useEffect(() => {
    setCalibrationPlaceId(selectedPlaceId ?? "");
    setCalibrationCoordinates(null);
  }, [selectedPlaceId]);

  function handleMapClick(event: React.MouseEvent<SVGSVGElement>) {
    if (!IS_DEVELOPMENT) return;

    const svg = event.currentTarget;
    const rect = svg.getBoundingClientRect();
    const x = (event.clientX - rect.left) / rect.width;
    const y = (event.clientY - rect.top) / rect.height;

    const normalizedX = Math.round(x * 1000) / 1000;
    const normalizedY = Math.round(y * 1000) / 1000;

    setCalibrationCoordinates({ x: normalizedX, y: normalizedY });
  }

  function handleSaveCalibration() {
    if (!IS_DEVELOPMENT || !activePlaceId || !calibrationCoordinates) return;

    calibratePlaceHotspot(activePlaceId, calibrationCoordinates);
    setCalibrationCoordinates(null);
  }

  function handleResetCalibration() {
    if (!IS_DEVELOPMENT) return;

    setCalibrationCoordinates(null);
  }

  return (
    <div className="place-map-reference">
      {IS_DEVELOPMENT && (
        <label className="place-map-calibration-place">
          Calibrate canonical place
          <select
            value={calibrationPlaceId}
            onChange={(event) => {
              setCalibrationPlaceId(event.target.value);
              setCalibrationCoordinates(null);
            }}
            data-testid="calibration-place-select"
          >
            <option value="">Select a place</option>
            {listCanonicalPlaces().map((place) => (
              <option key={place.id} value={place.id}>
                {place.displayName}
              </option>
            ))}
          </select>
        </label>
      )}
      <div className="place-map-container">
        <svg
          className="place-map-svg"
          viewBox={`0 0 ${LIVING_MAP_WIDTH} ${LIVING_MAP_HEIGHT}`}
          preserveAspectRatio="xMidYMid meet"
          onClick={handleMapClick}
          style={IS_DEVELOPMENT ? { cursor: "crosshair" } : undefined}
        >
          <image
            href={COURTYARD_MAP_IMAGE}
            x="0"
            y="0"
            width={LIVING_MAP_WIDTH}
            height={LIVING_MAP_HEIGHT}
            preserveAspectRatio="none"
          />
          {listPlaceHotspots()
            .filter((hotspot) => hotspot.calibrated)
            .map((hotspot) => {
              const isSelected = hotspot.placeId === activePlaceId;

              return (
                <circle
                  key={hotspot.placeId}
                  cx={hotspot.x * LIVING_MAP_WIDTH}
                  cy={hotspot.y * LIVING_MAP_HEIGHT}
                  r={hotspot.radius * LIVING_MAP_WIDTH * (isSelected ? 0.42 : 0.33)}
                  className={isSelected ? "place-map-hotspot place-map-hotspot-active" : "place-map-hotspot"}
                  aria-label={isSelected ? "Selected place location" : "Calibrated place location"}
                  data-testid={`place-map-hotspot-${hotspot.placeId}`}
                />
              );
            })}
          {IS_DEVELOPMENT && calibrationCoordinates && (
            <circle
              cx={calibrationCoordinates.x * LIVING_MAP_WIDTH}
              cy={calibrationCoordinates.y * LIVING_MAP_HEIGHT}
              r={(selectedHotspot?.radius ?? 0.07) * LIVING_MAP_WIDTH * 0.33}
              className="place-map-hotspot place-map-hotspot-pending"
              aria-label="Pending hotspot position"
              data-testid="pending-hotspot"
            />
          )}
        </svg>
      </div>

      {!isCalibrated && activePlaceId && (
        <p className="place-map-calibration-notice">
          Click the map to choose a position. Save to calibrate this place.
        </p>
      )}

      {IS_DEVELOPMENT && calibrationCoordinates && (
        <p className="place-map-calibration-display" data-testid="calibration-coordinates">
          Logged: x: {calibrationCoordinates.x}, y: {calibrationCoordinates.y}
        </p>
      )}

      {IS_DEVELOPMENT && activePlaceId && (
        <div className="place-map-calibration-actions">
          <button
            type="button"
            className="place-map-save"
            onClick={handleSaveCalibration}
            disabled={!calibrationCoordinates}
            data-testid="save-hotspot-position"
          >
            Save hotspot position
          </button>
          {isCalibrated && (
            <button
              type="button"
              className="place-map-calibration-reset"
              onClick={handleResetCalibration}
              data-testid="reset-hotspot-position"
            >
              Reset / recalibrate
            </button>
          )}
        </div>
      )}

      {onClose && (
        <button
          type="button"
          className="place-map-close"
          onClick={onClose}
          aria-label="Close place map"
        >
          Close
        </button>
      )}
    </div>
  );
}
