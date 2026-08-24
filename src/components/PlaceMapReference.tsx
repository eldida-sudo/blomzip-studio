import { useEffect, useState } from "react";
import { calibratePlaceHotspot, getPlaceHotspot, isPlaceCalibrated } from "../data/placeHotspots";

interface PlaceMapReferenceProps {
  selectedPlaceId?: string;
  onClose?: () => void;
}

const COURTYARD_MAP_IMAGE = "/images/living-map.png";
const IS_DEVELOPMENT = import.meta.env.DEV;

export function PlaceMapReference({ selectedPlaceId, onClose }: PlaceMapReferenceProps) {
  const [calibrationCoordinates, setCalibrationCoordinates] = useState<{ x: number; y: number } | null>(null);
  
  const selectedHotspot = selectedPlaceId ? getPlaceHotspot(selectedPlaceId) : null;
  const isCalibrated = selectedPlaceId ? isPlaceCalibrated(selectedPlaceId) : false;

  useEffect(() => {
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
    if (!IS_DEVELOPMENT || !selectedPlaceId || !calibrationCoordinates) return;

    calibratePlaceHotspot(selectedPlaceId, calibrationCoordinates);
    setCalibrationCoordinates(null);
  }

  function handleResetCalibration() {
    if (!IS_DEVELOPMENT) return;

    setCalibrationCoordinates(null);
  }

  return (
    <div className="place-map-reference">
      <div className="place-map-container">
        <svg
          className="place-map-svg"
          viewBox="0 0 1 1"
          preserveAspectRatio="xMidYMid meet"
          onClick={handleMapClick}
          style={IS_DEVELOPMENT ? { cursor: "crosshair" } : undefined}
        >
          <image
            href={COURTYARD_MAP_IMAGE}
            x="0"
            y="0"
            width="1"
            height="1"
            preserveAspectRatio="xMidYMid slice"
          />
          {selectedHotspot && isCalibrated && (
            <circle
              cx={selectedHotspot.x}
              cy={selectedHotspot.y}
              r={selectedHotspot.radius}
              className="place-map-hotspot place-map-hotspot-active"
              aria-label={`Selected place location`}
            />
          )}
          {IS_DEVELOPMENT && calibrationCoordinates && (
            <circle
              cx={calibrationCoordinates.x}
              cy={calibrationCoordinates.y}
              r={selectedHotspot?.radius ?? 0.07}
              className="place-map-hotspot place-map-hotspot-pending"
              aria-label="Pending hotspot position"
              data-testid="pending-hotspot"
            />
          )}
        </svg>
      </div>

      {!isCalibrated && selectedPlaceId && (
        <p className="place-map-calibration-notice">
          Click the map to choose a position. Save to calibrate this place.
        </p>
      )}

      {IS_DEVELOPMENT && calibrationCoordinates && (
        <p className="place-map-calibration-display" data-testid="calibration-coordinates">
          Logged: x: {calibrationCoordinates.x}, y: {calibrationCoordinates.y}
        </p>
      )}

      {IS_DEVELOPMENT && selectedPlaceId && (
        <div className="place-map-calibration-actions">
          <button
            type="button"
            className="secondary-action"
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
