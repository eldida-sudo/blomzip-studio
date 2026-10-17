import { useState } from "react";
import { listCanonicalPlaces } from "../data/canonicalPlaces";
import type { Visit } from "../models/blomzip";
import {
  PLACE_DETAIL_LABEL,
  planBulkPlaceDetail,
  type BulkPlaceDetailResult,
  type BulkPlaceDetailUndo,
} from "../utils/placeDetail";

interface PlaceDetailBulkPanelProps {
  visit: Visit;
  active: boolean;
  selectedIds: string[];
  visibleIds: string[];
  onActiveChange: (active: boolean) => void;
  onSelectionChange: (ids: string[]) => void;
  onApply: (imageRecordIds: string[], placeId: string) => BulkPlaceDetailResult;
  onUndo: (undo: BulkPlaceDetailUndo) => { restoredCount: number; skippedCount: number };
}

const CONFLICT_LABELS = {
  missing: "no longer in the archive",
  external: "External / Inspiration",
  overview: "Courtyard Overview",
  "other-place": "already assigned to another place",
} as const;

export function PlaceDetailBulkPanel({
  visit,
  active,
  selectedIds,
  visibleIds,
  onActiveChange,
  onSelectionChange,
  onApply,
  onUndo,
}: PlaceDetailBulkPanelProps) {
  const [placeId, setPlaceId] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [lastUndo, setLastUndo] = useState<BulkPlaceDetailUndo | null>(null);
  const places = listCanonicalPlaces();
  const placeName = places.find((place) => place.id === placeId)?.displayName;
  const plan = placeId ? planBulkPlaceDetail(visit, selectedIds, placeId) : null;
  const filenames = new Map((visit.imageRecords ?? []).map((record) => [record.id, record.filename]));

  function handleConfirm() {
    if (!placeId) return;

    const outcome = onApply(selectedIds, placeId);
    setConfirming(false);

    if (!outcome.ok) {
      setMessage(outcome.error);
      return;
    }

    setLastUndo(outcome.undo);
    setMessage(
      outcome.appliedCount === 0
        ? "Nothing was changed."
        : `Marked ${outcome.appliedCount} photograph${outcome.appliedCount === 1 ? "" : "s"} as ${PLACE_DETAIL_LABEL} of ${placeName}.` +
            (outcome.skippedCount > 0 ? ` ${outcome.skippedCount} skipped.` : "")
    );
    onSelectionChange([]);
  }

  function handleUndo() {
    if (!lastUndo) return;

    const outcome = onUndo(lastUndo);
    setLastUndo(null);
    setMessage(
      `Restored ${outcome.restoredCount} photograph${outcome.restoredCount === 1 ? "" : "s"}.` +
        (outcome.skippedCount > 0 ? ` ${outcome.skippedCount} left unchanged because they were edited since.` : "")
    );
  }

  return (
    <section className="place-detail-bulk" data-testid="place-detail-bulk-panel" aria-label={`${PLACE_DETAIL_LABEL} bulk classification`}>
      {!active ? (
        <button type="button" data-testid="place-detail-bulk-start" onClick={() => onActiveChange(true)}>
          Select photographs for {PLACE_DETAIL_LABEL}
        </button>
      ) : (
        <>
          <p data-testid="place-detail-bulk-count">{selectedIds.length} selected</p>
          <button type="button" data-testid="place-detail-bulk-select-shown" onClick={() => onSelectionChange(visibleIds)}>
            Select all shown
          </button>
          <button type="button" data-testid="place-detail-bulk-clear" onClick={() => onSelectionChange([])}>
            Clear selection
          </button>
          <label>
            Place for the selected close-ups{" "}
            <select
              data-testid="place-detail-bulk-place"
              value={placeId}
              onChange={(event) => {
                setPlaceId(event.target.value);
                setConfirming(false);
              }}
            >
              <option value="">Choose a place…</option>
              {places.map((place) => (
                <option key={place.id} value={place.id}>
                  {place.displayName}
                </option>
              ))}
            </select>
          </label>

          {plan ? (
            <div data-testid="place-detail-bulk-preview" role="status">
              <p>
                {plan.applicableIds.length} would be marked as {PLACE_DETAIL_LABEL} of {placeName}
                {plan.newlyAssignedCount > 0 ? ` (${plan.newlyAssignedCount} currently unassigned would be assigned to it)` : ""}.
                {plan.alreadyDoneIds.length > 0 ? ` ${plan.alreadyDoneIds.length} already marked.` : ""}
              </p>
              {plan.conflicts.length > 0 ? (
                <div data-testid="place-detail-bulk-conflicts">
                  <p>{plan.conflicts.length} excluded; review them individually. Nothing is overwritten:</p>
                  <ul>
                    {plan.conflicts.map((conflict) => (
                      <li key={conflict.imageRecordId}>
                        {filenames.get(conflict.imageRecordId) ?? conflict.imageRecordId}: {CONFLICT_LABELS[conflict.reason]}
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
            </div>
          ) : null}

          {confirming ? (
            <>
              <p data-testid="place-detail-bulk-confirm-text">
                Confirm: mark {plan?.applicableIds.length ?? 0} photograph(s) as close-ups of {placeName}. They will never be matched
                or used as visual anchors. You can undo this right after.
              </p>
              <button type="button" data-testid="place-detail-bulk-confirm" onClick={handleConfirm}>
                Confirm
              </button>
              <button type="button" onClick={() => setConfirming(false)}>
                Cancel
              </button>
            </>
          ) : (
            <button
              type="button"
              data-testid="place-detail-bulk-mark"
              disabled={!plan || plan.applicableIds.length === 0}
              onClick={() => setConfirming(true)}
            >
              Mark as {PLACE_DETAIL_LABEL}
            </button>
          )}
          <button
            type="button"
            data-testid="place-detail-bulk-done"
            onClick={() => {
              onActiveChange(false);
              onSelectionChange([]);
              setConfirming(false);
            }}
          >
            Done selecting
          </button>
        </>
      )}
      {lastUndo ? (
        <button type="button" data-testid="place-detail-bulk-undo" onClick={handleUndo}>
          Undo last bulk classification
        </button>
      ) : null}
      {message ? (
        <p data-testid="place-detail-bulk-message" role="status">
          {message}
        </p>
      ) : null}
    </section>
  );
}
