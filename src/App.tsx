import { useEffect, useMemo, useRef, useState } from "react";
import { initialImages, type ImageItem } from "./data/demoImages";
import { EntryReview } from "./components/EntryReview";
import { ZipImportPanel } from "./components/ZipImportPanel";
import type { DraftVisit, DraftWorkspace, Entry, ImageRecord, Visit } from "./models/blomzip";
import {
  createDraftImportSummary,
  createDraftVisitFromState,
  loadDraftWorkspace,
  saveDraftWorkspace,
  upsertDraftVisit,
} from "./utils/draftWorkspace";
import { createPublishReadyVisitOutput } from "./utils/publishReadyOutput";
import type { ZipImportSummary } from "./utils/readZipImages";
import "./App.css";

type ViewFilter = "all" | "favorites" | "hero";

function createDraftGalleryImage(options: {
  visit: Visit;
  entry: Entry;
  imageRecord: ImageRecord | undefined;
  index: number;
}): ImageItem {
  const { visit, entry, imageRecord, index } = options;
  const filename = imageRecord?.filename ?? `entry-${index + 1}`;

  return {
    id: index + 1,
    title: filename,
    collection: "Imported ZIP",
    date: visit.date,
    tags: [...entry.tags],
    favorite: false,
    hero: false,
    notes: entry.notes,
    color: "linear-gradient(135deg, #6a7878, #d6d6c8)",
    src: imageRecord?.thumbnailUrl ?? "",
    alt: filename,
    storyRole: entry.reviewed ? "Reviewed import entry" : "Pending import entry",
    season: "Imported",
    location: imageRecord?.sourcePath ?? "Imported visit",
    mood: "",
    material: "",
    light: "",
    composition: "",
    importSource: `ZIP import (${visit.id})`,
  };
}

function createGalleryImagesFromVisit(visit: Visit): ImageItem[] {
  const imageRecordsById = new Map((visit.imageRecords ?? []).map((record) => [record.id, record]));

  return visit.entries.map((entry, index) =>
    createDraftGalleryImage({
      visit,
      entry,
      imageRecord: imageRecordsById.get(entry.imageRecordId),
      index,
    })
  );
}

function App() {
  const [images, setImages] = useState<ImageItem[]>(initialImages);
  const [search, setSearch] = useState("");
  const [collectionFilter, setCollectionFilter] = useState("All");
  const [viewFilter, setViewFilter] = useState<ViewFilter>("all");
  const [selectedImage, setSelectedImage] = useState<ImageItem | null>(null);
  const [importSummary, setImportSummary] = useState<ZipImportSummary | null>(null);
  const [importVisit, setImportVisit] = useState<Visit | null>(null);
  const [draftWorkspace, setDraftWorkspace] = useState<DraftWorkspace>(() => loadDraftWorkspace());
  const [isReviewingEntries, setIsReviewingEntries] = useState(false);
  const [reviewStartIndex, setReviewStartIndex] = useState(0);
  const hasAppliedStudioImagesRef = useRef(false);

  useEffect(() => {
    saveDraftWorkspace(draftWorkspace);
  }, [draftWorkspace]);

  function handleImportEntryUpdated(updatedEntry: Entry) {
    setImportVisit((currentVisit) => {
      if (!currentVisit) {
        return currentVisit;
      }

      return {
        ...currentVisit,
        status: currentVisit.status === "Finalized" ? currentVisit.status : "Review in progress",
        entries: currentVisit.entries.map((entry) =>
          entry.id === updatedEntry.id ? updatedEntry : entry
        ),
      };
    });
  }

  function handleVisitFinalized(finalizedVisit: Visit) {
    setImportVisit(finalizedVisit);
    setIsReviewingEntries(false);
  }

  function openReviewAtIndex(index: number) {
    setReviewStartIndex(index);
    setIsReviewingEntries(true);
  }

  function handleSaveDraft() {
    if (!importVisit) {
      return;
    }

    const draftImages = createGalleryImagesFromVisit(importVisit);

    const draftVisit = createDraftVisitFromState({
      visit: {
        ...importVisit,
        status: importVisit.status === "Finalized" ? "Finalized" : "Review in progress",
      },
      studioImages: draftImages,
    });

    setDraftWorkspace((currentWorkspace) => upsertDraftVisit(currentWorkspace, draftVisit));
  }

  function handleLoadDraft(draftVisit: DraftVisit) {
    hasAppliedStudioImagesRef.current = true;
    setImages(draftVisit.studioImages);
    setImportSummary(createDraftImportSummary(draftVisit));
    setImportVisit(draftVisit.visit);
    setReviewStartIndex(0);
    setIsReviewingEntries(true);
    setSelectedImage(null);
    setDraftWorkspace((currentWorkspace) => ({
      ...currentWorkspace,
      activeDraftId: draftVisit.id,
    }));
  }

  useEffect(() => {
    fetch("/data/images.json")
      .then((response) => {
        if (!response.ok) throw new Error("Could not load imported images");
        return response.json();
      })
      .then((data: ImageItem[]) => {
        if (hasAppliedStudioImagesRef.current) {
          return;
        }

        setImages(data);
        hasAppliedStudioImagesRef.current = true;
      })
      .catch(() => {
        if (hasAppliedStudioImagesRef.current) {
          return;
        }

        setImages(initialImages);
        hasAppliedStudioImagesRef.current = true;
      });
  }, []);

  const gallerySourceImages = useMemo(
    () => (importVisit ? createGalleryImagesFromVisit(importVisit) : images),
    [importVisit, images]
  );

  const collections = useMemo(() => {
    return ["All", ...Array.from(new Set(gallerySourceImages.map((image) => image.collection)))];
  }, [gallerySourceImages]);

  const collectionStats = useMemo(() => {
    return Array.from(
      gallerySourceImages.reduce((stats, image) => {
        stats.set(image.collection, (stats.get(image.collection) ?? 0) + 1);
        return stats;
      }, new Map<string, number>())
    ).sort((a, b) => b[1] - a[1]);
  }, [gallerySourceImages]);

  const galleryItems = useMemo(
    () => gallerySourceImages.map((image, index) => ({ image, index })),
    [gallerySourceImages]
  );

  const filteredImages = galleryItems.filter(({ image }) => {
    const searchText =
      `${image.title} ${image.collection} ${image.tags.join(" ")} ${image.notes} ${image.storyRole} ${image.season} ${image.location} ${image.mood} ${image.material} ${image.light} ${image.composition} ${image.importSource}`.toLowerCase();

    const matchesSearch = searchText.includes(search.toLowerCase());
    const matchesCollection =
      collectionFilter === "All" || image.collection === collectionFilter;

    const matchesViewFilter =
      viewFilter === "all" ||
      (viewFilter === "favorites" && image.favorite) ||
      (viewFilter === "hero" && image.hero);

    return matchesSearch && matchesCollection && matchesViewFilter;
  });

  const reviewedEntryCount = importVisit?.entries.filter((entry) => entry.reviewed).length ?? 0;
  const totalImportedEntries = importVisit?.entries.length ?? 0;
  const reviewProgressPercent = totalImportedEntries > 0 ? Math.round((reviewedEntryCount / totalImportedEntries) * 100) : 0;
  const savedDrafts = draftWorkspace.drafts;
  const activeGalleryImageId = selectedImage?.id ?? (!isReviewingEntries && importVisit ? gallerySourceImages[reviewStartIndex]?.id : null);
  const canFinalizeVisit = totalImportedEntries > 0 && reviewedEntryCount === totalImportedEntries;
  const isVisitFinalized = importVisit?.status === "Finalized";

  function handleFinalizeImportedVisit() {
    setImportVisit((currentVisit) => {
      if (!currentVisit) {
        return currentVisit;
      }

      const reviewedCount = currentVisit.entries.filter((entry) => entry.reviewed).length;
      const totalEntries = currentVisit.entries.length;
      const readyToFinalize = totalEntries > 0 && reviewedCount === totalEntries;

      if (!readyToFinalize) {
        return currentVisit;
      }

      return {
        ...currentVisit,
        status: "Finalized",
      };
    });
  }

  function handleDownloadPublishReadyOutput() {
    if (!importVisit || !isVisitFinalized) {
      return;
    }

    const output = createPublishReadyVisitOutput(importVisit);
    const outputBlob = new Blob([JSON.stringify(output, null, 2)], { type: "application/json" });
    const outputUrl = URL.createObjectURL(outputBlob);
    const outputLink = document.createElement("a");
    const sanitizedDate = importVisit.date.replace(/[^0-9-]/g, "-");

    outputLink.href = outputUrl;
    outputLink.download = `visit-${sanitizedDate}-publish-ready.json`;
    document.body.appendChild(outputLink);
    outputLink.click();
    document.body.removeChild(outputLink);
    URL.revokeObjectURL(outputUrl);
  }

  const workflowStateLabel = !importSummary
    ? "ZIP import"
    : !importVisit
      ? "Draft ready"
      : isVisitFinalized
        ? "Review status complete"
        : canFinalizeVisit
          ? "Review status complete"
          : isReviewingEntries
            ? "Entry Review"
            : "Curate thumbnails";

  const workflowNextActionLabel = !importSummary
    ? "Import a ZIP archive"
    : !importVisit
      ? "Load or create a draft"
      : isVisitFinalized
        ? "Download publish-ready output"
        : canFinalizeVisit
          ? "Finalize visit"
          : isReviewingEntries
            ? "Continue reviewing entries"
            : "Open Entry Review";

  const draftStatusLabel = !importVisit
    ? "No draft active"
    : isVisitFinalized
      ? "Finalized"
      : canFinalizeVisit
        ? "Review status complete"
        : importVisit.status ?? "Ready for AI";

  function getImageFilename(image: ImageItem) {
    return image.src.split("/").pop() ?? image.title;
  }

  function renderMeta(label: string, value: string) {
    if (!value) {
      return null;
    }

    return (
      <p>
        <strong>{label}:</strong> {value}
      </p>
    );
  }

  function renderGalleryCard({ image, index }: { image: ImageItem; index: number }) {
    const reviewed = importVisit?.entries[index]?.reviewed;

    return (
      <button
        key={image.id}
        type="button"
        className={`gallery-card gallery-card-button preview-card-button ${activeGalleryImageId === image.id ? "is-current" : ""}`}
        onClick={() => (importVisit ? openReviewAtIndex(index) : setSelectedImage(image))}
        aria-label={`Open ${getImageFilename(image)}`}
        aria-pressed={activeGalleryImageId === image.id}
      >
        <div className="gallery-card-thumb">
          {image.src ? <img src={image.src} alt={image.alt} /> : <span>No preview</span>}
          {image.hero ? <span className="gallery-card-badge gallery-card-badge-top-left">Hero</span> : null}
          {image.favorite ? <span className="gallery-card-badge gallery-card-badge-top-right">Favorite</span> : null}
        </div>

        <div className="gallery-card-body">
          <div className="gallery-card-header">
            <strong>{getImageFilename(image)}</strong>
            <span>#{index + 1}</span>
          </div>

          <p className="gallery-card-meta">
            {image.location}
            <span>•</span>
            {image.collection}
          </p>

          <div className="gallery-card-statuses">
            {image.favorite ? <span className="gallery-chip">Favorite</span> : null}
            {image.hero ? <span className="gallery-chip">Hero</span> : null}
            {reviewed !== undefined ? (
              <span className={`gallery-chip ${reviewed ? "active" : "muted"}`}>
                {reviewed ? "Reviewed" : "Pending"}
              </span>
            ) : null}
          </div>
        </div>
      </button>
    );
  }

  const draftSummary = importVisit
    ? {
        description: `${totalImportedEntries} entries, ${reviewedEntryCount} reviewed, ${reviewProgressPercent}% complete.`,
        status: draftStatusLabel,
      }
    : null;

  return (
    <main className="studio">
      <aside className="sidebar">
        <section className="sidebar-card sidebar-summary-card">
          <div>
            <p className="eyebrow">Blomzip Studio</p>
            <h1>{draftSummary ? "Current draft" : "Ready for a draft"}</h1>
            <p className="result-count">
              {draftSummary
                ? draftSummary.description
                : "Import a ZIP archive or choose a saved draft to start curation."}
            </p>
            <p className="result-count">Workflow: {workflowStateLabel}</p>
            <p className="result-count">Next: {workflowNextActionLabel}</p>
          </div>
          <div className="sidebar-summary-stack">
            <span className="sidebar-summary-pill">{draftSummary?.status ?? draftStatusLabel}</span>
            <strong>{gallerySourceImages.length} images</strong>
          </div>
        </section>

        <section className="sidebar-card sidebar-progress-card">
          <div>
            <span>Review progress</span>
            <strong>
              {totalImportedEntries > 0 ? `${reviewedEntryCount} / ${totalImportedEntries}` : "No entries yet"}
            </strong>
          </div>
          <div className="sidebar-progress-meter" aria-hidden="true">
            <span style={{ width: `${reviewProgressPercent}%` }} />
          </div>
        </section>

        <section className="sidebar-card sidebar-save-load-card">
          <div>
            <p className="eyebrow">Draft workspace</p>
            <h3>Save or load a draft</h3>
            <p className="result-count">
              Keep the current curation session in browser storage without changing the canonical archive.
            </p>
          </div>

          <div className="collection-stats draft-actions">
            <button type="button" className="primary-action" onClick={handleSaveDraft} disabled={!importVisit}>
              Save Draft
            </button>

            {savedDrafts.length > 0 ? (
              savedDrafts.map((draftVisit) => (
                <button
                  key={draftVisit.id}
                  type="button"
                  className={draftWorkspace.activeDraftId === draftVisit.id ? "active" : ""}
                  onClick={() => handleLoadDraft(draftVisit)}
                >
                  <span>{draftVisit.label}</span>
                  <strong>{draftVisit.visit.entries.length} entries</strong>
                </button>
              ))
            ) : (
              <p className="result-count">No saved drafts yet.</p>
            )}
          </div>
        </section>

        <section className={`sidebar-import-shell ${importVisit ? "secondary" : "primary"}`}>
          <ZipImportPanel
            className="zip-panel"
            onImportStateChange={({ summary, visit }) => {
              setImportSummary(summary);
              setImportVisit(visit);
            }}
          />

          {importSummary ? (
            <div className="sidebar-card import-summary-mini">
              <span>ZIP ready</span>
              <strong>{importSummary.fileName}</strong>
              <p className="result-count">
                {importSummary.imageCount} images, {importSummary.status}
              </p>
            </div>
          ) : null}
        </section>

        <section className="sidebar-card sidebar-collection-card">
          <p className="eyebrow">Collection stats</p>
          <div className="collection-stats compact-stats">
            <button
              className={collectionFilter === "All" ? "active" : ""}
              type="button"
              onClick={() => setCollectionFilter("All")}
            >
              <span>All</span>
              <strong>{gallerySourceImages.length}</strong>
            </button>

            {collectionStats.map(([collection, count]) => (
              <button
                key={collection}
                type="button"
                className={collectionFilter === collection ? "active" : ""}
                onClick={() => setCollectionFilter(collection)}
              >
                <span>{collection}</span>
                <strong>{count}</strong>
              </button>
            ))}
          </div>
        </section>
      </aside>

      <section className="content">
        {isReviewingEntries && importVisit ? (
          <EntryReview
            visit={importVisit}
            initialEntryIndex={reviewStartIndex}
            onClose={() => setIsReviewingEntries(false)}
            onEntryUpdated={handleImportEntryUpdated}
            onVisitFinalized={handleVisitFinalized}
            onSaveDraft={handleSaveDraft}
          />
        ) : (
          <div className="gallery-shell">
            <header className="gallery-header">
              <div>
                <p className="eyebrow">{importVisit ? "Current draft gallery" : "Studio gallery"}</p>
                <h2>{importVisit ? "Curate by thumbnail" : "Browse the studio collection"}</h2>
                <p className="result-count">
                  {filteredImages.length} of {gallerySourceImages.length} images shown.
                  {importVisit
                    ? " Click any thumbnail to open Entry Review at that image."
                    : " Import a ZIP to switch the workspace into review mode."}
                </p>
              </div>

              {importVisit ? (
                <div className="gallery-header-actions">
                  <span className="import-summary-badge">{draftStatusLabel}</span>
                  {isVisitFinalized ? (
                    <button type="button" className="primary-action" onClick={handleDownloadPublishReadyOutput}>
                      Download publish-ready JSON
                    </button>
                  ) : null}
                  {canFinalizeVisit && !isVisitFinalized ? (
                    <button type="button" className="primary-action" onClick={handleFinalizeImportedVisit}>
                      Finalize visit
                    </button>
                  ) : null}
                  <button type="button" className="primary-action" onClick={() => openReviewAtIndex(0)}>
                    Review entries
                  </button>
                </div>
              ) : null}
            </header>

            <div className="gallery-toolbar">
              <input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Search filenames, location, collection, tags or notes..."
              />

              <select value={collectionFilter} onChange={(event) => setCollectionFilter(event.target.value)}>
                {collections.map((collection) => (
                  <option key={collection} value={collection}>
                    {collection}
                  </option>
                ))}
              </select>

              <div className="filter-row filter-row-compact" aria-label="Image view filters">
                <button type="button" className={viewFilter === "all" ? "active" : ""} onClick={() => setViewFilter("all")}>
                  All
                </button>

                <button
                  type="button"
                  className={viewFilter === "favorites" ? "active" : ""}
                  onClick={() => setViewFilter("favorites")}
                >
                  Favorites
                </button>

                <button type="button" className={viewFilter === "hero" ? "active" : ""} onClick={() => setViewFilter("hero")}>
                  Hero
                </button>
              </div>
            </div>

            <section className="gallery-grid">{filteredImages.map(renderGalleryCard)}</section>
          </div>
        )}
      </section>

      {selectedImage && (
        <div className="detail-overlay" onClick={() => setSelectedImage(null)}>
          <article className="detail-panel" onClick={(event) => event.stopPropagation()}>
            <button className="close-button" onClick={() => setSelectedImage(null)}>
              Close
            </button>

            <div className="detail-image">
              <img src={selectedImage.src} alt={selectedImage.alt} />
            </div>

            <div className="detail-body">
              <p className="collection">{selectedImage.collection}</p>
              <h2>{selectedImage.title}</h2>

              <div className="meta-list">
                {renderMeta("Role", selectedImage.storyRole)}
                {renderMeta("Season", selectedImage.season)}
                {renderMeta("Location", selectedImage.location)}
                {renderMeta("Mood", selectedImage.mood)}
                {renderMeta("Light", selectedImage.light)}
                {renderMeta("Material", selectedImage.material)}
                {renderMeta("Composition", selectedImage.composition)}
                {renderMeta("Import", selectedImage.importSource)}
              </div>

              <div className="tag-row">
                {selectedImage.tags.map((tag) => (
                  <span key={tag}>{tag}</span>
                ))}
              </div>

              {selectedImage.notes && <p className="detail-notes">{selectedImage.notes}</p>}
            </div>
          </article>
        </div>
      )}
    </main>
  );
}

export default App;