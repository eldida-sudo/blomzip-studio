import { useEffect, useMemo, useState } from "react";
import type { Entry, Observation, Visit } from "../models/blomzip";
import { MockObservationEngine, type ObservationEngine } from "./observationEngine";

interface EntryReviewProps {
  visit: Visit;
  initialEntryIndex?: number;
  onClose?: () => void;
  onEntryUpdated?: (entry: Entry) => void;
  onVisitFinalized?: (visit: Visit) => void;
  onSaveDraft?: () => void;
}

interface EntryDraft {
  id: string;
  notes: string;
  tags: string;
}

export function EntryReview({ visit, initialEntryIndex = 0, onClose, onEntryUpdated, onVisitFinalized, onSaveDraft }: EntryReviewProps) {
  const [currentIndex, setCurrentIndex] = useState(() => {
    if (visit.entries.length === 0) {
      return 0;
    }

    return Math.min(Math.max(initialEntryIndex, 0), visit.entries.length - 1);
  });
  const [entries, setEntries] = useState(visit.entries);
  const [observationEngine] = useState<ObservationEngine>(() => new MockObservationEngine());
  const [saveFeedback, setSaveFeedback] = useState<{ savedAt: string } | null>(null);
  const [isSavingDraft, setIsSavingDraft] = useState(false);
  const [drafts, setDrafts] = useState<EntryDraft[]>(() =>
    visit.entries.map((entry) => ({
      id: entry.id,
      notes: entry.notes,
      tags: entry.tags.join(", "),
    }))
  );

  useEffect(() => {
    const nextEntries = visit.entries;
    const nextCurrentIndex = nextEntries.length > 0
      ? Math.min(Math.max(initialEntryIndex, 0), nextEntries.length - 1)
      : 0;

    setCurrentIndex(nextCurrentIndex);
    setEntries(nextEntries);
    setSaveFeedback(null);
    setIsSavingDraft(false);
    setDrafts(
      nextEntries.map((entry) => ({
        id: entry.id,
        notes: entry.notes,
        tags: entry.tags.join(", "),
      }))
    );
  }, [visit.id, visit.entries, initialEntryIndex]);

  const entry = useMemo(() => entries[currentIndex], [entries, currentIndex]);
  const imageRecord = useMemo(() => visit.imageRecords?.find((record) => record.id === entry?.imageRecordId), [visit.imageRecords, entry]);
  const draft = useMemo(() => drafts.find((item) => item.id === entry?.id), [drafts, entry]);
  const observationCount = entry?.observations.length ?? 0;
  const hasObservations = observationCount > 0;
  const isEntryReviewed = entry?.reviewed ?? false;
  const reviewedEntryCount = entries.filter((entryItem) => entryItem.reviewed).length;
  const totalEntryCount = entries.length;
  const percentReviewed = totalEntryCount > 0 ? Math.round((reviewedEntryCount / totalEntryCount) * 100) : 0;
  const canFinalizeVisit = totalEntryCount > 0 && reviewedEntryCount === totalEntryCount;
  const workflowStateLabel = visit.status === "Finalized"
    ? "Review status complete"
    : canFinalizeVisit
      ? "Review status complete"
      : "Entry Review";
  const workflowNextActionLabel = visit.status === "Finalized"
    ? "Download publish-ready output"
    : canFinalizeVisit
      ? "Finalize visit"
      : "Continue reviewing entries";

  useEffect(() => {
    if (!saveFeedback) {
      return;
    }

    const timeoutId = window.setTimeout(() => {
      setSaveFeedback(null);
    }, 2000);

    return () => window.clearTimeout(timeoutId);
  }, [saveFeedback]);

  function updateDraft(update: Partial<EntryDraft>) {
    if (!entry) return;

    setDrafts((currentDrafts) =>
      currentDrafts.map((draftItem) => (draftItem.id === entry.id ? { ...draftItem, ...update } : draftItem))
    );
  }

  function applyEntryUpdate(updatedEntry: Entry) {
    setEntries((currentEntries) =>
      currentEntries.map((currentEntry) =>
        currentEntry.id === updatedEntry.id ? updatedEntry : currentEntry
      )
    );

    onEntryUpdated?.(updatedEntry);
  }

  function handleNotesChange(value: string) {
    if (!entry) return;

    updateDraft({ notes: value });

    applyEntryUpdate({
      ...entry,
      notes: value,
      updatedAt: new Date().toISOString(),
    });
  }

  function handleTagsChange(value: string) {
    if (!entry) return;

    updateDraft({ tags: value });

    const tags = value
      .split(",")
      .map((tag) => tag.trim())
      .filter((tag): tag is string => tag.length > 0);

    applyEntryUpdate({
      ...entry,
      tags,
      updatedAt: new Date().toISOString(),
    });
  }

  function handlePrevious() {
    setCurrentIndex((index) => (index > 0 ? index - 1 : index));
  }

  function handleNext() {
    setCurrentIndex((index) => (index < visit.entries.length - 1 ? index + 1 : index));
  }

  function updateObservation(updatedObservation: Observation) {
    if (!entry) return;

    const updatedEntry = {
      ...entry,
      observations: entry.observations.map((observation) =>
        observation.id === updatedObservation.id ? updatedObservation : observation
      ),
      updatedAt: new Date().toISOString(),
    };

    applyEntryUpdate(updatedEntry);
  }

  function handleMarkEntryReviewed() {
    if (!entry) return;

    applyEntryUpdate({
      ...entry,
      reviewed: true,
      updatedAt: new Date().toISOString(),
    });
  }

  function handleFinalizeVisit() {
    if (!canFinalizeVisit) return;

    onVisitFinalized?.({
      ...visit,
      entries,
      status: "Finalized",
    });
  }

  function handleSaveDraft() {
    if (!onSaveDraft || isSavingDraft) return;

    setIsSavingDraft(true);
    onSaveDraft();
    setSaveFeedback({ savedAt: new Date().toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }) });

    window.setTimeout(() => {
      setIsSavingDraft(false);
    }, 250);
  }

  function handleObservationTextChange(observationId: string, value: string) {
    if (!entry) return;

    const observation = entry.observations.find((item) => item.id === observationId);
    if (!observation) return;

    updateObservation({
      ...observation,
      value,
    });
  }

  function handleAcceptObservation(observationId: string) {
    if (!entry) return;

    const observation = entry.observations.find((item) => item.id === observationId);
    if (!observation) return;

    updateObservation({
      ...observation,
      reviewed: true,
      accepted: true,
    });
  }

  function handleRejectObservation(observationId: string) {
    if (!entry) return;

    const observation = entry.observations.find((item) => item.id === observationId);
    if (!observation) return;

    updateObservation({
      ...observation,
      reviewed: true,
      accepted: false,
    });
  }

  function handleAnalyzeImage() {
    if (!entry) return;

    const observations = observationEngine.generateObservations(entry.id);

    const updatedEntry = {
      ...entry,
      observations: [...entry.observations, ...observations],
      updatedAt: new Date().toISOString(),
    };

    applyEntryUpdate(updatedEntry);
  }

  if (!entry || !draft) {
    return null;
  }

  return (
    <section className="entry-review-screen">
      <div className="entry-review-header">
        <div>
          <p className="eyebrow">Entry review</p>
          <h2>{visit.date}</h2>
          <p className="result-count">Review each imported entry in sequence without saving anything yet.</p>
          <p className="result-count">Workflow: {workflowStateLabel}</p>
          <p className="result-count">Next: {workflowNextActionLabel}</p>
        </div>

        {onClose ? (
          <button type="button" onClick={onClose}>
            Back to import
          </button>
        ) : null}
        <div className="entry-review-status-row">
          <span className={`entry-review-entry-status ${isEntryReviewed ? "reviewed" : "pending"}`}>
            {isEntryReviewed ? "Entry reviewed" : "Review pending"}
          </span>
          <button type="button" onClick={handleMarkEntryReviewed} disabled={isEntryReviewed}>
            {isEntryReviewed ? "Reviewed" : "Mark entry reviewed"}
          </button>
        </div>
        {onSaveDraft ? (
          <div className="entry-review-save-draft-row">
            <button type="button" onClick={handleSaveDraft} disabled={isSavingDraft} aria-pressed={isSavingDraft}>
              {isSavingDraft ? "Saving Draft..." : "Save Draft"}
            </button>
            {saveFeedback ? (
              <span className="entry-review-save-feedback">Draft saved at {saveFeedback.savedAt}</span>
            ) : null}
          </div>
        ) : null}
        <div className="entry-review-progress-row">
          <span>
            {reviewedEntryCount} of {totalEntryCount} entries reviewed ({percentReviewed}%)
          </span>
          <button
            type="button"
            className="finalize-visit-button"
            onClick={handleFinalizeVisit}
            disabled={!canFinalizeVisit || visit.status === "Finalized"}
          >
            {visit.status === "Finalized" ? "Visit finalized" : "Finalize visit"}
          </button>
        </div>
      </div>

      <div className="entry-review-toolbar">
        <button type="button" onClick={handlePrevious} disabled={currentIndex === 0}>
          Previous
        </button>
        <span>
          Entry {currentIndex + 1} of {visit.entries.length}
        </span>
        <button type="button" onClick={handleNext} disabled={currentIndex === visit.entries.length - 1}>
          Next
        </button>
      </div>

      <div className="entry-review-card">
        <div className="entry-review-preview">
          {imageRecord?.thumbnailUrl ? (
            <img src={imageRecord.thumbnailUrl} alt={imageRecord.filename} />
          ) : (
            <div className="entry-review-placeholder">No preview</div>
          )}
        </div>

        <div className="entry-review-body">
          <div className="entry-review-meta">
            <div className="entry-review-title-row">
              <div>
                <p className="eyebrow">Entry</p>
                <h3>{imageRecord?.filename ?? "Imported image"}</h3>
              </div>
              <span className="entry-review-badge">Ready for AI</span>
            </div>
            <div className="entry-review-submeta">
              <span>Timeline index {imageRecord?.timelineIndex ?? currentIndex}</span>
              <span>{imageRecord?.orientation ?? "—"}</span>
            </div>
            <div className="meta-list compact">
              <p>
                <strong>Format:</strong> {imageRecord?.format ?? "—"}
              </p>
              <p>
                <strong>Size:</strong> {imageRecord?.fileSize ? `${imageRecord.fileSize} bytes` : "—"}
              </p>
              <p>
                <strong>Dimensions:</strong> {imageRecord?.width && imageRecord?.height ? `${imageRecord.width} × ${imageRecord.height}` : "—"}
              </p>
              <p>
                <strong>Captured:</strong> {imageRecord?.captureDate ?? "—"}
              </p>
              <p>
                <strong>Orientation:</strong> {imageRecord?.orientation ?? "—"}
              </p>
            </div>
          </div>

          <label className="entry-review-field">
            <span>Notes</span>
            <textarea
              value={draft.notes}
              onChange={(event) => handleNotesChange(event.target.value)}
              placeholder="Add notes for this entry..."
            />
          </label>

          <label className="entry-review-field">
            <span>Tags</span>
            <input
              value={draft.tags}
              onChange={(event) => handleTagsChange(event.target.value)}
              placeholder="Add tags, separated by commas"
            />
          </label>

          <div className="entry-review-field">
            <span>Observations</span>
            <div className={`entry-review-observations ${hasObservations ? "has-observations" : ""}`}>
              <div className="entry-review-observations-header">
                <div>
                  <strong>{observationCount} observations</strong>
                  <p>{hasObservations ? "Observation created" : "Awaiting mock review"}</p>
                </div>
                <span className={hasObservations ? "entry-review-status-pill" : ""}>
                  {hasObservations ? "Mock observation" : "No result yet"}
                </span>
              </div>

              {!hasObservations ? (
                <button type="button" className="entry-review-analyze-button" onClick={handleAnalyzeImage}>
                  Analyze image
                </button>
              ) : (
                <>
                  <div className="entry-review-observation-hero">
                    <p>Observation created</p>
                    <span>Mock analysis completed in memory.</span>
                  </div>
                  <ul className="entry-review-observation-list">
                    {entry.observations.map((observation) => {
                      const isResolved = observation.reviewed;
                      const statusText = observation.reviewed
                        ? observation.accepted
                          ? "Accepted"
                          : "Rejected"
                        : "Pending review";

                      return (
                        <li key={observation.id} className="entry-review-observation-card">
                          <div className="entry-review-observation-row">
                            <strong>{observation.type}</strong>
                            <input
                              type="text"
                              className="entry-review-observation-input"
                              value={observation.value}
                              onChange={(event) => handleObservationTextChange(observation.id, event.target.value)}
                              disabled={isResolved}
                            />
                          </div>
                          <div className="entry-review-observation-meta">
                            <span>Confidence {(observation.confidence ? observation.confidence * 100 : 0).toFixed(0)}%</span>
                            <span>{observation.source}</span>
                          </div>
                          <div className="entry-review-observation-meta entry-review-observation-meta-secondary">
                            <span>{statusText}</span>
                          </div>
                          <div className="entry-review-observation-actions">
                            <button
                              type="button"
                              className="entry-review-observation-action accept"
                              onClick={() => handleAcceptObservation(observation.id)}
                              disabled={isResolved}
                            >
                              Accept
                            </button>
                            <button
                              type="button"
                              className="entry-review-observation-action reject"
                              onClick={() => handleRejectObservation(observation.id)}
                              disabled={isResolved}
                            >
                              Reject
                            </button>
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                </>
              )}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
