import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Entry, EntryRecommendationEvidence, EntryRecommendationKind, EntrySuggestionCategory, Observation, VisualEvidenceSignalId, Visit } from "../models/blomzip";
import { createThumbnailUrlForRecord } from "../utils/createThumbnailUrls";
import { getEntryEditorialRecommendations } from "../utils/entryRecommendations";
import { applyStoryRecommendations } from "../utils/storyRecommendations";
import { createVisionProvider, type VisionProvider } from "../utils/visionProvider";
import { MockObservationEngine, type ObservationEngine } from "./observationEngine";

interface EntryReviewProps {
  visit: Visit;
  initialEntryIndex?: number;
  onClose?: () => void;
  onEntryUpdated?: (entry: Entry) => void;
  onVisitFinalized?: (visit: Visit) => void;
  visionProvider?: VisionProvider;
}

interface EntryDraft {
  id: string;
  notes: string;
  tags: string;
  favorite: boolean;
  hero: boolean;
  storySelected: boolean;
}

interface VisualAnalysisStatus {
  state: "analyzing" | "failed";
  message?: string;
}

function getVisualEvidenceSignalLabel(signal: VisualEvidenceSignalId): string {
  const knownLabels: Record<VisualEvidenceSignalId, string> = {
    "human-activity": "Human activity",
    "spatial-overview": "Spatial overview",
    "place-legibility": "Place legibility",
    "visible-change-cue": "Visible change cue",
    "vegetation-state": "Vegetation state",
    "negative-space": "Negative space",
    "focal-structure": "Focal structure",
  };

  return knownLabels[signal];
}


function getSuggestionCategoryLabel(category: EntrySuggestionCategory): string {
  switch (category) {
    case "story-candidate":
      return "Story candidate";
    case "hero-candidate":
      return "Hero candidate";
    case "favorite-candidate":
      return "Favorite candidate";
    case "strong-change":
      return "Strong change";
    case "overview-image":
      return "Overview image";
    case "detail-image":
      return "Detail image";
    case "by-place":
      return "By place";
    case "needs-review":
      return "Needs review";
    case "low-confidence":
      return "Low confidence";
    case "possible-duplicates":
      return "Possible duplicate";
    default:
      return category;
  }
}

function getPlaceSuggestionLabel(sourcePath: string | undefined): string | null {
  if (!sourcePath || !sourcePath.includes("/")) {
    return null;
  }

  return sourcePath.split("/").slice(0, -1).pop() ?? null;
}

function getSuggestionReason(categories: EntrySuggestionCategory[]): string | null {
  if (categories.includes("story-candidate") || categories.includes("hero-candidate")) {
    return "High visual priority from AI scoring and composition signals.";
  }

  if (categories.includes("possible-duplicates")) {
    return "AI detected a similar image candidate in this archive import.";
  }

  if (categories.includes("low-confidence") || categories.includes("needs-review")) {
    return "AI confidence is lower here, so curator confirmation is important.";
  }

  if (categories.includes("by-place")) {
    return "AI grouped this image by place context from import metadata.";
  }

  return categories.length > 0 ? "AI generated review hints from image metadata and signals." : null;
}

function getRecommendationKindLabel(kind: EntryRecommendationKind): string {
  return kind.charAt(0).toUpperCase() + kind.slice(1);
}

function formatRecommendationScore(score: number): string | null {
  if (!Number.isFinite(score)) {
    return null;
  }

  return `${Math.round(Math.min(1, Math.max(0, score)) * 100)}%`;
}

function getEvidenceLabel(evidence: EntryRecommendationEvidence): string {
  const knownLabels: Record<string, string> = {
    "human-activity": "Human activity",
    "place-coverage": "Place coverage",
    "seasonal-event": "Seasonal event",
    "meaningful-change": "Meaningful change",
    "spatial-overview": "Spatial overview",
    "negative-space": "Negative space",
    "duplicate-penalty": "Duplicate similarity",
  };

  return knownLabels[evidence.signal] ?? evidence.signal.replace(/[-_]/g, " ").replace(/\b\w/g, (character) => character.toUpperCase());
}

function formatCapturedDate(captureDate: string | undefined): string {
  if (!captureDate) {
    return "Unknown";
  }

  const parsed = new Date(captureDate);
  if (Number.isNaN(parsed.getTime())) {
    return captureDate;
  }

  return parsed.toLocaleString();
}

export function EntryReview({ visit, initialEntryIndex = 0, onClose, onEntryUpdated, onVisitFinalized, visionProvider: visionProviderProp }: EntryReviewProps) {
  const [currentEntryId, setCurrentEntryId] = useState<string | null>(() => {
    if (visit.entries.length === 0) {
      return null;
    }

    const index = Math.min(Math.max(initialEntryIndex, 0), visit.entries.length - 1);
    return visit.entries[index]?.id ?? null;
  });
  const [entries, setEntries] = useState(visit.entries);
  const [observationEngine] = useState<ObservationEngine>(() => new MockObservationEngine());
  const [visionProvider] = useState<VisionProvider>(() => visionProviderProp ?? createVisionProvider());
  const [visualAnalysisStatusByEntryId, setVisualAnalysisStatusByEntryId] = useState<Record<string, VisualAnalysisStatus>>({});
  const [entrySaveFeedback, setEntrySaveFeedback] = useState<{ state: "saving" | "saved"; savedAt?: string } | null>(null);
  const lastResetRef = useRef<{ visitId: string; initialEntryIndex: number } | null>(null);
  const lastUpdatedEntryIdRef = useRef<string | null>(null);
  const entrySaveTimersRef = useRef<{ markSaved: number | null; clearSaved: number | null }>({
    markSaved: null,
    clearSaved: null,
  });
  const [drafts, setDrafts] = useState<EntryDraft[]>(() =>
    visit.entries.map((entry) => ({
      id: entry.id,
      notes: entry.notes,
      tags: entry.tags.join(", "),
      favorite: Boolean(entry.favorite),
      hero: Boolean(entry.hero),
      storySelected: Boolean(entry.storySelected),
    }))
  );

  useEffect(() => {
    const nextEntries = visit.entries;
    setEntries(nextEntries);
    setDrafts(
      nextEntries.map((entry) => ({
        id: entry.id,
        notes: entry.notes,
        tags: entry.tags.join(", "),
        favorite: Boolean(entry.favorite),
        hero: Boolean(entry.hero),
        storySelected: Boolean(entry.storySelected),
      }))
    );

    const shouldReset =
      !lastResetRef.current ||
      lastResetRef.current.visitId !== visit.id ||
      lastResetRef.current.initialEntryIndex !== initialEntryIndex;

    if (shouldReset) {
      const nextCurrentEntryId = nextEntries.length > 0
        ? nextEntries[Math.min(Math.max(initialEntryIndex, 0), nextEntries.length - 1)]?.id ?? null
        : null;

      setCurrentEntryId(nextCurrentEntryId);
      setEntrySaveFeedback(null);
      lastResetRef.current = { visitId: visit.id, initialEntryIndex };
    }
  }, [visit.entries, visit.id, initialEntryIndex]);

  useEffect(() => {
    const timers = entrySaveTimersRef.current;

    return () => {
      if (timers.markSaved) {
        window.clearTimeout(timers.markSaved);
      }

      if (timers.clearSaved) {
        window.clearTimeout(timers.clearSaved);
      }
    };
  }, []);

  useEffect(() => {
    const updatedEntryId = lastUpdatedEntryIdRef.current;
    if (!updatedEntryId) {
      return;
    }

    const updatedEntry = entries.find((entryItem) => entryItem.id === updatedEntryId);
    if (updatedEntry) {
      onEntryUpdated?.(updatedEntry);
    }

    lastUpdatedEntryIdRef.current = null;
  }, [entries, onEntryUpdated]);

  const currentIndex = useMemo(() => {
    if (!currentEntryId) {
      return entries.length > 0 ? 0 : -1;
    }

    const index = entries.findIndex((entryItem) => entryItem.id === currentEntryId);
    return index >= 0 ? index : entries.length > 0 ? 0 : -1;
  }, [entries, currentEntryId]);
  const entry = useMemo(() => (currentIndex >= 0 ? entries[currentIndex] : undefined), [entries, currentIndex]);
  const imageRecord = useMemo(() => visit.imageRecords?.find((record) => record.id === entry?.imageRecordId), [visit.imageRecords, entry]);
  const draft = useMemo(() => drafts.find((item) => item.id === entry?.id), [drafts, entry]);
  const observationCount = entry?.observations.length ?? 0;
  const hasObservations = observationCount > 0;
  const isEntryReviewed = entry?.reviewed ?? false;
  const reviewedEntryCount = entries.filter((entryItem) => entryItem.reviewed).length;
  const totalEntryCount = entries.length;
  const percentReviewed = totalEntryCount > 0 ? Math.round((reviewedEntryCount / totalEntryCount) * 100) : 0;
  const canFinalizeVisit = totalEntryCount > 0 && reviewedEntryCount === totalEntryCount;
  const isFinalizeVisible = canFinalizeVisit || visit.status === "Finalized";
  const saveStatusLabel = entrySaveFeedback
    ? entrySaveFeedback.state === "saving"
      ? "Saving changes..."
      : `Saved at ${entrySaveFeedback.savedAt}`
    : "Saved locally";
  const reviewStateLabel = isEntryReviewed ? "Reviewed" : "Pending review";

  const currentPositionLabel = `${currentIndex + 1} of ${entries.length}`;

  const suggestionCategories = entry?.analysisSuggestions?.categories ?? [];
  const editorialRecommendations = entry ? getEntryEditorialRecommendations(entry) : [];
  const hasV02Recommendations = entry?.analysisSuggestions?.recommendations !== undefined;
  const visualAnalysisStatus = entry ? visualAnalysisStatusByEntryId[entry.id] : undefined;
  const visualAnalysisState: "not-analyzed" | "analyzing" | "available" | "failed" = visualAnalysisStatus?.state === "analyzing"
    ? "analyzing"
    : visualAnalysisStatus?.state === "failed"
      ? "failed"
      : entry?.visualAnalysis
        ? "available"
        : "not-analyzed";
  const visualAnalysisStateLabel: Record<typeof visualAnalysisState, string> = {
    "not-analyzed": "Not analyzed",
    analyzing: "Analyzing...",
    available: "Analysis available",
    failed: "Analysis failed",
  };
  const suggestionReason = getSuggestionReason(suggestionCategories);
  const suggestionPlace = suggestionCategories.includes("by-place")
    ? getPlaceSuggestionLabel(imageRecord?.sourcePath)
    : null;
  const suggestionConfidence = typeof entry?.analysisSuggestions?.confidence === "number"
    ? Math.round(entry.analysisSuggestions.confidence * 100)
    : null;
  const previewSrc = createThumbnailUrlForRecord(imageRecord);
  const suggestionObservations = entry?.observations.filter((observation) => observation.source !== "user") ?? [];
  const duplicateReferenceFilenames = useMemo(() => {
    if (!entry?.analysisSuggestions?.possibleDuplicateEntryIds?.length) {
      return [] as string[];
    }

    const entryById = new Map(entries.map((entryItem) => [entryItem.id, entryItem]));
    const imageRecordById = new Map((visit.imageRecords ?? []).map((record) => [record.id, record]));

    return entry.analysisSuggestions.possibleDuplicateEntryIds
      .map((entryId) => {
        const duplicateEntry = entryById.get(entryId);
        if (!duplicateEntry) {
          return null;
        }

        return imageRecordById.get(duplicateEntry.imageRecordId)?.filename ?? null;
      })
      .filter((filename): filename is string => Boolean(filename));
  }, [entries, entry?.analysisSuggestions?.possibleDuplicateEntryIds, visit.imageRecords]);

  const aiSuggestionItems = useMemo(() => {
    const items: Array<{ title: string; evidence?: string }> = [];

    if (suggestionPlace) {
      items.push({
        title: "Place/group suggestion",
        evidence: suggestionPlace,
      });
    }

    if (suggestionObservations.length > 0) {
      items.push({
        title: "Suggested observations",
        evidence: suggestionObservations.map((observation) => `${observation.type}: ${observation.value}`).join("; "),
      });
    }

    return items;
  }, [suggestionCategories, suggestionObservations, suggestionPlace]);

  const updateDraft = useCallback((update: Partial<EntryDraft>) => {
    if (!entry) return;

    setDrafts((currentDrafts) =>
      currentDrafts.map((draftItem) => (draftItem.id === entry.id ? { ...draftItem, ...update } : draftItem))
    );
  }, [entry]);

  const applyEntryUpdate = useCallback((update: Entry | ((currentEntry: Entry) => Entry)) => {
    if (!entry) {
      return;
    }

    const targetEntryId = entry.id;

    if (entrySaveTimersRef.current.markSaved) {
      window.clearTimeout(entrySaveTimersRef.current.markSaved);
      entrySaveTimersRef.current.markSaved = null;
    }

    if (entrySaveTimersRef.current.clearSaved) {
      window.clearTimeout(entrySaveTimersRef.current.clearSaved);
      entrySaveTimersRef.current.clearSaved = null;
    }

    setEntrySaveFeedback({ state: "saving" });

    setEntries((currentEntries) =>
      currentEntries.map((currentEntry) => {
        if (currentEntry.id !== targetEntryId) {
          return currentEntry;
        }

        const updatedEntry = typeof update === "function" ? update(currentEntry) : update;
        lastUpdatedEntryIdRef.current = updatedEntry.id;
        return updatedEntry;
      })
    );

    entrySaveTimersRef.current.markSaved = window.setTimeout(() => {
      const savedAt = new Date().toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
      setEntrySaveFeedback({ state: "saved", savedAt });

      entrySaveTimersRef.current.clearSaved = window.setTimeout(() => {
        setEntrySaveFeedback(null);
        entrySaveTimersRef.current.clearSaved = null;
      }, 2000);

      entrySaveTimersRef.current.markSaved = null;
    }, 250);
  }, [entry]);

  function handleNotesChange(value: string) {
    if (!entry) return;

    updateDraft({ notes: value });

    applyEntryUpdate((currentEntry) => ({
      ...currentEntry,
      notes: value,
      updatedAt: new Date().toISOString(),
    }));
  }

  function handleTagsChange(value: string) {
    if (!entry) return;

    updateDraft({ tags: value });

    const tags = value
      .split(",")
      .map((tag) => tag.trim())
      .filter((tag): tag is string => tag.length > 0);

    applyEntryUpdate((currentEntry) => ({
      ...currentEntry,
      tags,
      updatedAt: new Date().toISOString(),
    }));
  }

  const handleFavoriteToggle = useCallback(() => {
    if (!entry || !draft) return;

    const favorite = !draft.favorite;

    updateDraft({ favorite });

    applyEntryUpdate((currentEntry) => ({
      ...currentEntry,
      favorite,
      updatedAt: new Date().toISOString(),
    }));
  }, [applyEntryUpdate, draft, entry, updateDraft]);

  const handleHeroToggle = useCallback(() => {
    if (!entry || !draft) return;

    const hero = !draft.hero;

    updateDraft({ hero });

    applyEntryUpdate((currentEntry) => ({
      ...currentEntry,
      hero,
      updatedAt: new Date().toISOString(),
    }));
  }, [applyEntryUpdate, draft, entry, updateDraft]);

  const handleStorySelectionToggle = useCallback(() => {
    if (!entry || !draft) return;

    const storySelected = !draft.storySelected;

    updateDraft({ storySelected });

    applyEntryUpdate((currentEntry) => ({
      ...currentEntry,
      storySelected,
      updatedAt: new Date().toISOString(),
    }));
  }, [applyEntryUpdate, draft, entry, updateDraft]);

  const handleAnalyzeImage = useCallback(() => {
    if (!entry) return;

    const observations = observationEngine.generateObservations(entry.id);

    applyEntryUpdate((currentEntry) => ({
      ...currentEntry,
      observations: [...currentEntry.observations, ...observations],
      updatedAt: new Date().toISOString(),
    }));
  }, [applyEntryUpdate, entry, observationEngine]);

  const handleAnalyzeImageVisually = useCallback(() => {
    if (!entry || !imageRecord) return;

    const targetEntryId = entry.id;

    setVisualAnalysisStatusByEntryId((current) => ({ ...current, [targetEntryId]: { state: "analyzing" } }));

    visionProvider
      .analyzeImage({
        imageRecordId: imageRecord.id,
        filename: imageRecord.filename,
        imageUrl: previewSrc,
      })
      .then((visualAnalysis) => {
        setEntries((currentEntries) => {
          const updatedEntries = currentEntries.map((currentEntry) =>
            currentEntry.id === targetEntryId
              ? { ...currentEntry, visualAnalysis, updatedAt: new Date().toISOString() }
              : currentEntry
          );

          return applyStoryRecommendations({ ...visit, entries: updatedEntries }).entries;
        });

        lastUpdatedEntryIdRef.current = targetEntryId;

        setVisualAnalysisStatusByEntryId((current) => {
          const { [targetEntryId]: _removed, ...rest } = current;
          return rest;
        });
      })
      .catch((error: unknown) => {
        setVisualAnalysisStatusByEntryId((current) => ({
          ...current,
          [targetEntryId]: {
            state: "failed",
            message: error instanceof Error ? error.message : "Visual analysis failed.",
          },
        }));
      });
  }, [entry, imageRecord, visionProvider, visit]);

  const handlePrevious = useCallback(() => {
    setCurrentEntryId((id) => {
      if (!id) {
        return id;
      }

      const index = entries.findIndex((entryItem) => entryItem.id === id);
      if (index <= 0) {
        return id;
      }

      return entries[index - 1]?.id ?? id;
    });
  }, [entries]);

  const handleNext = useCallback(() => {
    setCurrentEntryId((id) => {
      if (!id) {
        return id;
      }

      const index = entries.findIndex((entryItem) => entryItem.id === id);
      if (index < 0 || index >= entries.length - 1) {
        return id;
      }

      return entries[index + 1]?.id ?? id;
    });
  }, [entries]);

  function updateObservation(updatedObservation: Observation) {
    applyEntryUpdate((currentEntry) => ({
      ...currentEntry,
      observations: currentEntry.observations.map((observation) =>
        observation.id === updatedObservation.id ? updatedObservation : observation
      ),
      updatedAt: new Date().toISOString(),
    }));
  }

  const handleMarkEntryReviewed = useCallback(() => {
    const nextEntryId = entries[currentIndex + 1]?.id ?? null;

    applyEntryUpdate((currentEntry) => ({
      ...currentEntry,
      reviewed: true,
      updatedAt: new Date().toISOString(),
    }));

    if (nextEntryId) {
      setCurrentEntryId(nextEntryId);
    }
  }, [applyEntryUpdate, currentIndex, entries]);

  useEffect(() => {
    function handleKeyboardShortcut(event: KeyboardEvent) {
      const target = event.target as HTMLElement | null;
      if (target && (target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName))) {
        return;
      }

      const key = event.key.toLowerCase();

      if (key === "arrowleft" || key === "k") {
        event.preventDefault();
        handlePrevious();
        return;
      }

      if (key === "arrowright" || key === "j") {
        event.preventDefault();
        handleNext();
        return;
      }

      if (key === "r") {
        event.preventDefault();
        handleMarkEntryReviewed();
        return;
      }

      if (key === "f") {
        event.preventDefault();
        handleFavoriteToggle();
        return;
      }

      if (key === "h") {
        event.preventDefault();
        handleHeroToggle();
        return;
      }

      if (key === "s") {
        event.preventDefault();
        handleStorySelectionToggle();
        return;
      }

      if (key === "a") {
        event.preventDefault();
        handleAnalyzeImage();
        return;
      }

      if (key === "escape") {
        event.preventDefault();
        onClose?.();
      }
    }

    window.addEventListener("keydown", handleKeyboardShortcut);

    return () => {
      window.removeEventListener("keydown", handleKeyboardShortcut);
    };
  }, [handleAnalyzeImage, handleFavoriteToggle, handleHeroToggle, handleMarkEntryReviewed, handleNext, handlePrevious, handleStorySelectionToggle, onClose]);

  function handleFinalizeVisit() {
    if (!canFinalizeVisit) return;

    onVisitFinalized?.({
      ...visit,
      entries,
      status: "Finalized",
    });
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

  if (!entry || !draft) {
    return null;
  }

  return (
    <section className="entry-review-screen">
      <header className="entry-review-header" data-testid="entry-review-header">
        {onClose ? (
          <button type="button" onClick={onClose}>
            Back to archive
          </button>
        ) : null}

        <div className="entry-review-header-metric" data-testid="entry-review-position">
          <span>Entry</span>
          <strong>{currentPositionLabel}</strong>
        </div>

        <div className="entry-review-header-metric" data-testid="entry-review-save-status">
          <span>Save status</span>
          <strong>{saveStatusLabel}</strong>
        </div>

        <div className="entry-review-header-metric" data-testid="entry-review-progress">
          <span>Review progress</span>
          <strong>
            {reviewedEntryCount} of {totalEntryCount} ({percentReviewed}%)
          </strong>
          <div
            className="entry-review-progress-bar"
            role="progressbar"
            aria-label="Review progress"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={percentReviewed}
            aria-valuetext={`${reviewedEntryCount} of ${totalEntryCount} entries reviewed`}
          >
            <span style={{ width: `${percentReviewed}%` }} />
          </div>
        </div>

        {isFinalizeVisible ? (
          <button
            type="button"
            className="finalize-visit-button"
            onClick={handleFinalizeVisit}
            disabled={!canFinalizeVisit || visit.status === "Finalized"}
          >
            {visit.status === "Finalized" ? "Visit finalized" : "Finalize visit"}
          </button>
        ) : null}
      </header>

      <div className="entry-review-status-row" data-testid="entry-review-status-row">
        <span className={`entry-review-entry-status ${isEntryReviewed ? "reviewed" : "pending"}`}>
          {reviewStateLabel}
        </span>
        <span className={`entry-review-save-state ${entrySaveFeedback?.state ?? "saved"}`} aria-live="polite">
          {saveStatusLabel}
        </span>
      </div>

      <div className="entry-review-card" data-testid="entry-review-workspace">
        <div className="entry-review-preview" data-testid="entry-review-image-region">
          {previewSrc ? (
            <img
              src={previewSrc}
              alt={imageRecord?.filename ?? "Imported image"}
              className="entry-review-preview-image"
              data-testid="entry-review-main-image"
            />
          ) : (
            <div className="entry-review-placeholder">No preview</div>
          )}
        </div>

        <div className="entry-review-body" data-testid="entry-review-panel">
          <section className="entry-review-meta" data-testid="panel-filename">
            <h3>{imageRecord?.filename ?? "Imported image"}</h3>
          </section>

          {entry.analysisSuggestions ? (
            <section className="entry-review-editorial-recommendations" data-testid="panel-editorial-recommendations">
              <strong>Editorial recommendations</strong>
              {editorialRecommendations.length > 0 ? (
                <div className="entry-review-editorial-recommendation-list">
                  {editorialRecommendations.map((editorialRecommendation) => {
                    if (editorialRecommendation.source === "legacy-category") {
                      return (
                        <article key={`legacy-${editorialRecommendation.kind}`} className="entry-review-editorial-recommendation legacy">
                          <strong>Legacy AI suggestion: {getRecommendationKindLabel(editorialRecommendation.kind)} candidate</strong>
                          <p>Detailed recommendation evidence is not available for this analysis.</p>
                        </article>
                      );
                    }

                    const { recommendation } = editorialRecommendation;
                    const scoreLabel = formatRecommendationScore(recommendation.score);
                    const [primaryReason, ...additionalReasons] = recommendation.reasons;

                    return (
                      <article key={`${recommendation.kind}-${recommendation.generatedAt}`} className="entry-review-editorial-recommendation">
                        <div className="entry-review-editorial-recommendation-heading">
                          <strong>{getRecommendationKindLabel(recommendation.kind)}</strong>
                          {scoreLabel ? <span>Score {scoreLabel}</span> : null}
                        </div>
                        {primaryReason ? <p>{primaryReason}</p> : null}
                        {additionalReasons.length > 0 ? (
                          <details className="entry-review-editorial-details">
                            <summary>More reasons ({additionalReasons.length})</summary>
                            <ul>
                              {additionalReasons.map((reason) => <li key={reason}>{reason}</li>)}
                            </ul>
                          </details>
                        ) : null}
                        {recommendation.evidence.length > 0 ? (
                          <details className="entry-review-editorial-details">
                            <summary>Why this recommendation?</summary>
                            <ul>
                              {recommendation.evidence.map((evidence, index) => (
                                <li key={`${evidence.signal}-${index}`}>
                                  <strong>{getEvidenceLabel(evidence)}</strong>
                                  {evidence.detail ? ` - ${evidence.detail}` : null}
                                </li>
                              ))}
                            </ul>
                          </details>
                        ) : null}
                      </article>
                    );
                  })}
                </div>
              ) : hasV02Recommendations ? (
                <p className="entry-review-editorial-empty">No Story recommendation from this analysis.</p>
              ) : null}
            </section>
          ) : null}

          <section className="entry-review-visual-analysis" data-testid="panel-visual-analysis">
            <strong>Visual analysis</strong>
            <p className="entry-review-visual-analysis-status" data-testid="visual-analysis-status">
              {visualAnalysisStateLabel[visualAnalysisState]}
              {visualAnalysisState === "failed" && visualAnalysisStatus?.message ? ` — ${visualAnalysisStatus.message}` : null}
            </p>
            <button
              type="button"
              className="entry-review-visual-analysis-button"
              onClick={handleAnalyzeImageVisually}
              disabled={visualAnalysisState === "analyzing"}
            >
              {visualAnalysisState === "analyzing" ? "Analyzing..." : "Analyze image"}
            </button>
            {entry.visualAnalysis ? (
              <ul className="entry-review-visual-analysis-signal-list" data-testid="visual-analysis-signals">
                {entry.visualAnalysis.signals.map((signal) => (
                  <li key={signal.signal} className="entry-review-visual-analysis-signal">
                    <div className="entry-review-visual-analysis-signal-heading">
                      <strong>{getVisualEvidenceSignalLabel(signal.signal)}</strong>
                      <span>{Math.round(signal.confidence * 100)}%</span>
                    </div>
                    <p>{signal.detail}</p>
                  </li>
                ))}
              </ul>
            ) : null}
          </section>

          {entry.analysisSuggestions ? (
            <section className="entry-review-ai-suggestions" data-testid="panel-ai-suggestions">
              <strong>Analysis signals</strong>
              <p className="entry-review-ai-note">AI proposes. You decide what enters the archive.</p>
              {!hasV02Recommendations && suggestionConfidence !== null ? <p><strong>Analysis confidence:</strong> {suggestionConfidence}%</p> : null}
              <div className="entry-review-ai-suggestion-list" data-testid="panel-ai-suggestion-items">
                {aiSuggestionItems.map((item) => (
                  <article key={item.title} className="entry-review-ai-suggestion-item">
                    <strong>{item.title}</strong>
                    {item.evidence ? <p>{item.evidence}</p> : null}
                  </article>
                ))}
              </div>
              {suggestionCategories.length > 0 ? (
                <p>
                  <strong>Signal categories:</strong> {suggestionCategories.map((category) => getSuggestionCategoryLabel(category)).join(", ")}
                </p>
              ) : null}
              {!hasV02Recommendations && suggestionReason ? <p><strong>General context:</strong> {suggestionReason}</p> : null}
              {duplicateReferenceFilenames.length > 0 ? (
                <p>
                  <strong>Possible duplicates:</strong> {duplicateReferenceFilenames.join(", ")}
                </p>
              ) : null}
            </section>
          ) : null}

          <div className="entry-review-field entry-review-human-curation" data-testid="panel-curation-controls">
            <span>Your curation decisions</span>
            <p className="entry-review-human-curation-summary" data-testid="panel-curation-summary">
              {draft.hero ? "Hero selected" : "Hero not selected"} · {draft.favorite ? "Favorite selected" : "Favorite not selected"} · {draft.storySelected ? "Story selected" : "Story not selected"}
            </p>
            <div className="entry-review-curation-row">
              <button type="button" onClick={handleFavoriteToggle} aria-pressed={draft.favorite}>
                {draft.favorite ? "Favorite ✓" : "Mark as favorite"}
              </button>
              <button type="button" onClick={handleHeroToggle} aria-pressed={draft.hero}>
                {draft.hero ? "Hero ✓" : "Mark as hero"}
              </button>
              <button type="button" onClick={handleStorySelectionToggle} aria-pressed={draft.storySelected}>
                {draft.storySelected ? "Selected for Story ✓" : "Select for Story"}
              </button>
            </div>
          </div>

          <label className="entry-review-field" data-testid="panel-notes">
            <span>Notes</span>
            <textarea
              value={draft.notes}
              onChange={(event) => handleNotesChange(event.target.value)}
              placeholder="Add notes for this entry..."
            />
          </label>

          <label className="entry-review-field" data-testid="panel-tags">
            <span>Tags</span>
            <input
              value={draft.tags}
              onChange={(event) => handleTagsChange(event.target.value)}
              placeholder="Add tags, separated by commas"
            />
          </label>

          <div className="entry-review-field" data-testid="panel-observations">
            <span>Observations</span>
            <div className={`entry-review-observations ${hasObservations ? "has-observations" : ""}`}>
              <div className="entry-review-observations-header">
                <div>
                  <strong>{observationCount} observations</strong>
                  <p>{hasObservations ? "Review suggested observations" : "No observations yet"}</p>
                </div>
              </div>

              {!hasObservations ? (
                <button type="button" className="entry-review-analyze-button" onClick={handleAnalyzeImage}>
                  Analyze image
                </button>
              ) : (
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
              )}
            </div>
          </div>

          <div className="entry-review-review-action-row" data-testid="panel-mark-reviewed">
            <button type="button" onClick={handleMarkEntryReviewed} disabled={isEntryReviewed}>
              {isEntryReviewed ? "Reviewed" : "Mark entry reviewed"}
            </button>
          </div>

          <section className="entry-review-meta" data-testid="panel-captured-date">
            <p>
              <strong>Captured:</strong> {formatCapturedDate(imageRecord?.captureDate)}
            </p>
          </section>

          <section className="entry-review-meta" data-testid="panel-essential-metadata">
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
                <strong>Orientation:</strong> {imageRecord?.orientation ?? "—"}
              </p>
            </div>
          </section>
        </div>
      </div>

      <nav className="entry-review-navigation" data-testid="entry-review-navigation">
        <button type="button" onClick={handlePrevious} disabled={currentIndex === 0}>
          Previous
        </button>
        <div className="entry-review-navigation-copy">
          <span>
            Entry {currentIndex + 1} of {entries.length}
          </span>
          <small>Keyboard: ← / →, R reviewed, F favorite, H hero, S story, A analyze</small>
        </div>
        <button type="button" onClick={handleNext} disabled={currentIndex === entries.length - 1}>
          Next
        </button>
      </nav>
    </section>
  );
}
