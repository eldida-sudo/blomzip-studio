import { useEffect, useMemo, useState } from "react";
import type { Visit } from "../models/blomzip";
import { MockObservationEngine, type ObservationEngine } from "./observationEngine";

interface EntryReviewProps {
  visit: Visit;
  onClose?: () => void;
}

interface EntryDraft {
  id: string;
  notes: string;
  tags: string;
}

export function EntryReview({ visit, onClose }: EntryReviewProps) {
  const [currentIndex, setCurrentIndex] = useState(0);
  const [entries, setEntries] = useState(visit.entries);
  const [observationEngine] = useState<ObservationEngine>(() => new MockObservationEngine());
  const [drafts, setDrafts] = useState<EntryDraft[]>(() =>
    visit.entries.map((entry) => ({
      id: entry.id,
      notes: entry.notes,
      tags: entry.tags.join(", "),
    }))
  );

  useEffect(() => {
    setCurrentIndex(0);
    setEntries(visit.entries);
    setDrafts(
      visit.entries.map((entry) => ({
        id: entry.id,
        notes: entry.notes,
        tags: entry.tags.join(", "),
      }))
    );
  }, [visit.id, visit.entries]);

  const entry = useMemo(() => entries[currentIndex], [entries, currentIndex]);
  const imageRecord = useMemo(() => visit.imageRecords?.find((record) => record.id === entry?.imageRecordId), [visit.imageRecords, entry]);
  const draft = useMemo(() => drafts.find((item) => item.id === entry?.id), [drafts, entry]);
  const observationCount = entry?.observations.length ?? 0;
  const hasObservations = observationCount > 0;

  function updateDraft(update: Partial<EntryDraft>) {
    if (!entry) return;

    setDrafts((currentDrafts) =>
      currentDrafts.map((draftItem) => (draftItem.id === entry.id ? { ...draftItem, ...update } : draftItem))
    );
  }

  function handleNotesChange(value: string) {
    updateDraft({ notes: value });
  }

  function handleTagsChange(value: string) {
    updateDraft({ tags: value });
  }

  function handlePrevious() {
    setCurrentIndex((index) => (index > 0 ? index - 1 : index));
  }

  function handleNext() {
    setCurrentIndex((index) => (index < visit.entries.length - 1 ? index + 1 : index));
  }

  function handleAnalyzeImage() {
    if (!entry) return;

    const observations = observationEngine.generateObservations(entry.id);
    setEntries((currentEntries) =>
      currentEntries.map((currentEntry) =>
        currentEntry.id === entry.id
          ? { ...currentEntry, observations: [...currentEntry.observations, ...observations] }
          : currentEntry
      )
    );
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
        </div>

        {onClose ? (
          <button type="button" onClick={onClose}>
            Back to import
          </button>
        ) : null}
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
                    {entry.observations.map((observation) => (
                      <li key={observation.id} className="entry-review-observation-card">
                        <div className="entry-review-observation-row">
                          <strong>{observation.type}</strong>
                          <span>{observation.value}</span>
                        </div>
                        <div className="entry-review-observation-meta">
                          <span>Confidence {(observation.confidence ? observation.confidence * 100 : 0).toFixed(0)}%</span>
                          <span>{observation.source}</span>
                        </div>
                        <div className="entry-review-observation-meta entry-review-observation-meta-secondary">
                          <span>Reviewed: {observation.reviewed ? "Yes" : "No"}</span>
                        </div>
                        <div className="entry-review-observation-actions">
                          <button type="button">Approve</button>
                          <button type="button">Edit</button>
                          <button type="button">Remove</button>
                        </div>
                      </li>
                    ))}
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
