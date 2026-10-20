import { useState } from "react";
import { listCanonicalPlaces } from "../data/canonicalPlaces";
import type { Visit } from "../models/blomzip";
import {
  planBulkPlaceAssignment,
  type BulkPlaceAssignmentResult,
  type BulkPlaceAssignmentUndo,
} from "../utils/bulkPlaceAssignment";

interface BulkPlaceAssignPanelProps {
  visit: Visit;
  active: boolean;
  selectedIds: string[];
  visibleIds: string[];
  onActiveChange: (active: boolean) => void;
  onSelectionChange: (ids: string[]) => void;
  onApply: (imageRecordIds: string[], placeId: string) => BulkPlaceAssignmentResult;
  onUndo: (undo: BulkPlaceAssignmentUndo) => { restoredCount: number; skippedCount: number };
}

function photoLabel(count: number) {
  return `${count} photo${count === 1 ? "" : "s"}`;
}

export function BulkPlaceAssignPanel({
  visit,
  active,
  selectedIds,
  visibleIds,
  onActiveChange,
  onSelectionChange,
  onApply,
  onUndo,
}: BulkPlaceAssignPanelProps) {
  const [placeId, setPlaceId] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [lastUndo, setLastUndo] = useState<BulkPlaceAssignmentUndo | null>(null);
  const places = listCanonicalPlaces();
  const placeName = places.find((place) => place.id === placeId)?.displayName;
  const plan = placeId ? planBulkPlaceAssignment(visit, selectedIds, placeId) : null;
  const visibleSet = new Set(visibleIds);
  const hiddenSelectedCount = selectedIds.filter((id) => !visibleSet.has(id)).length;

  function handleConfirm() {
    if (!placeId) return;

    const outcome = onApply(selectedIds, placeId);
    setConfirming(false);

    if (!outcome.ok) {
      setMessage(outcome.error);
      return;
    }

    setLastUndo(outcome.undo);
    const applied = outcome.plan.applicableIds.length;
    const left = outcome.plan.skipped.length + outcome.plan.unchangedIds.length;
    setMessage(
      applied === 0
        ? "Nothing was changed."
        : `Assigned ${photoLabel(applied)} to ${placeName}.` + (left > 0 ? ` ${left} left unchanged.` : "")
    );
    onSelectionChange([]);
  }

  function handleUndo() {
    if (!lastUndo) return;

    const outcome = onUndo(lastUndo);
    setLastUndo(null);
    setMessage(
      `Restored ${photoLabel(outcome.restoredCount)}.` +
        (outcome.skippedCount > 0 ? ` ${outcome.skippedCount} left unchanged because they were edited since.` : "")
    );
  }

  return (
    <section className="bulk-place-assign" data-testid="bulk-place-assign-panel" aria-label="Assign a place to several photographs">
      {!active ? (
        <button type="button" data-testid="bulk-place-start" onClick={() => onActiveChange(true)}>
          Select multiple
        </button>
      ) : (
        <>
          <p data-testid="bulk-place-count">
            {selectedIds.length} selected
            {hiddenSelectedCount > 0 ? ` (${hiddenSelectedCount} not shown by current filters)` : ""}
          </p>
          <div className="bulk-place-row">
            <button type="button" data-testid="bulk-place-select-shown" onClick={() => onSelectionChange(visibleIds)}>
              Select all shown
            </button>
            <button type="button" data-testid="bulk-place-clear" disabled={selectedIds.length === 0} onClick={() => onSelectionChange([])}>
              Clear selection
            </button>
          </div>
          <select
            aria-label="Canonical Place for the selected photographs"
            data-testid="bulk-place-select"
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

          {confirming && plan ? (
            <div role="alertdialog" aria-label="Confirm place assignment" data-testid="bulk-place-confirm">
              <p data-testid="bulk-place-confirm-text">
                Assign {photoLabel(plan.applicableIds.length)} to {placeName}?
                {plan.overwriteIds.length > 0
                  ? ` ${plan.overwriteIds.length} already ha${plan.overwriteIds.length === 1 ? "s" : "ve"} a different place, which will be overwritten.`
                  : ""}
                {plan.skipped.length + plan.unchangedIds.length > 0
                  ? ` ${plan.skipped.length + plan.unchangedIds.length} will stay unchanged (already there, or External / Overview / Close-up).`
                  : ""}
              </p>
              <div className="bulk-place-row">
                <button type="button" data-testid="bulk-place-confirm-apply" onClick={handleConfirm}>
                  Confirm
                </button>
                <button type="button" data-testid="bulk-place-confirm-cancel" onClick={() => setConfirming(false)}>
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <button
              type="button"
              data-testid="bulk-place-assign"
              disabled={!plan || plan.applicableIds.length === 0}
              onClick={() => setConfirming(true)}
            >
              Assign place to {photoLabel(plan ? plan.applicableIds.length : selectedIds.length)}
            </button>
          )}

          <button
            type="button"
            data-testid="bulk-place-done"
            onClick={() => {
              onActiveChange(false);
              onSelectionChange([]);
              setConfirming(false);
            }}
          >
            Cancel
          </button>
        </>
      )}
      {lastUndo ? (
        <button type="button" data-testid="bulk-place-undo" onClick={handleUndo}>
          Undo last bulk assignment
        </button>
      ) : null}
      {message ? (
        <p data-testid="bulk-place-message" role="status">
          {message}
        </p>
      ) : null}
    </section>
  );
}
