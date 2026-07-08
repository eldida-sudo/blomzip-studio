import { useEffect, useMemo, useState } from "react";
import { initialImages, type ImageItem } from "./data/demoImages";
import { EntryReview } from "./components/EntryReview";
import { ZipImportPanel } from "./components/ZipImportPanel";
import type { Entry, Visit } from "./models/blomzip";
import type { ZipImportSummary } from "./utils/readZipImages";
import "./App.css";

type ViewFilter = "all" | "favorites" | "hero";
type CardLayout = "landscape" | "portrait";

function App() {
  const [images, setImages] = useState<ImageItem[]>(initialImages);
  const [dataSource, setDataSource] = useState("Demo fallback");
  const [search, setSearch] = useState("");
  const [collectionFilter, setCollectionFilter] = useState("All");
  const [viewFilter, setViewFilter] = useState<ViewFilter>("all");
  const [cardLayout, setCardLayout] = useState<CardLayout>("landscape");
  const [selectedImage, setSelectedImage] = useState<ImageItem | null>(null);
  const [importSummary, setImportSummary] = useState<ZipImportSummary | null>(null);
  const [importVisit, setImportVisit] = useState<Visit | null>(null);
  const [isReviewingEntries, setIsReviewingEntries] = useState(false);

  function handleImportEntryUpdated(updatedEntry: Entry) {
    setImportVisit((currentVisit) => {
      if (!currentVisit) {
        return currentVisit;
      }

      return {
        ...currentVisit,
        entries: currentVisit.entries.map((entry) =>
          entry.id === updatedEntry.id ? updatedEntry : entry
        ),
      };
    });
  }

  useEffect(() => {
    fetch("/data/images.json")
      .then((response) => {
        if (!response.ok) throw new Error("Could not load imported images");
        return response.json();
      })
      .then((data: ImageItem[]) => {
        setImages(data);
        setDataSource("Auto-imported JSON");
      })
      .catch(() => {
        setImages(initialImages);
        setDataSource("Demo fallback");
      });
  }, []);

  const collections = useMemo(() => {
    return ["All", ...Array.from(new Set(images.map((image) => image.collection)))];
  }, [images]);

  const collectionStats = useMemo(() => {
    return Array.from(
      images.reduce((stats, image) => {
        stats.set(image.collection, (stats.get(image.collection) ?? 0) + 1);
        return stats;
      }, new Map<string, number>())
    ).sort((a, b) => b[1] - a[1]);
  }, [images]);

  const filteredImages = images.filter((image) => {
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

  const favoriteCount = images.filter((image) => image.favorite).length;
  const heroCount = images.filter((image) => image.hero).length;
  const importStatusItems = useMemo(() => {
    const hasMetadata = (importVisit?.imageRecords ?? []).some(
      (record) => record.width || record.height || record.mimeType || record.orientation || record.captureDate || record.aspectRatio
    );
    const hasTimeline = (importVisit?.imageRecords ?? []).some((record) => record.timelineIndex !== undefined);
    const hasEntries = (importVisit?.entries ?? []).length > 0;

    return [
      {
        label: "ZIP loaded",
        detail: importSummary?.status === "ready" ? "Archive read successfully." : importSummary?.status === "empty" ? "Archive had no supported images." : importSummary?.status === "invalid" ? "Archive could not be read." : "Waiting for an archive.",
        active: Boolean(importSummary),
      },
      {
        label: "Images detected",
        detail: `${importSummary?.imageCount ?? 0} image files found`,
        active: (importSummary?.imageCount ?? 0) > 0,
      },
      {
        label: "Metadata extracted",
        detail: hasMetadata ? "Technical details captured for the records." : "Metadata is still being assembled.",
        active: hasMetadata,
      },
      {
        label: "Timeline created",
        detail: hasTimeline ? "Images are ordered for review." : "Timeline ordering is pending.",
        active: hasTimeline,
      },
      {
        label: "Entries created",
        detail: hasEntries ? `${importVisit?.entries?.length ?? 0} in-memory entries ready.` : "Entries are being prepared.",
        active: hasEntries,
      },
      {
        label: "Ready for review",
        detail: hasEntries && hasTimeline ? "The import is ready for review." : "The import is still being assembled.",
        active: hasEntries && hasTimeline,
      },
    ];
  }, [importSummary, importVisit]);

  function toggleFavorite(id: number) {
    setImages((currentImages) =>
      currentImages.map((image) =>
        image.id === id ? { ...image, favorite: !image.favorite } : image
      )
    );
  }

  function toggleHero(id: number) {
    setImages((currentImages) =>
      currentImages.map((image) =>
        image.id === id ? { ...image, hero: !image.hero } : image
      )
    );
  }

  function updateNotes(id: number, notes: string) {
    setImages((currentImages) =>
      currentImages.map((image) =>
        image.id === id ? { ...image, notes } : image
      )
    );
  }

  function renderMeta(label: string, value: string) {
    if (!value) return null;

    return (
      <p>
        <strong>{label}:</strong> {value}
      </p>
    );
  }

  function renderImageCard(image: ImageItem) {
    return (
      <article className="image-card" key={image.id}>
        <button
          className="image-preview image-open-button"
          style={{ background: image.src ? undefined : image.color }}
          onClick={() => setSelectedImage(image)}
        >
          {image.src && <img src={image.src} alt={image.alt} />}
          {image.hero && <span className="hero-badge">Hero</span>}
          {image.favorite && <span className="favorite-badge">★</span>}
        </button>

        <div className="image-body">
          <div className="image-heading">
            <div>
              <p className="collection">{image.collection}</p>
              <h3>{image.title}</h3>
            </div>
            {image.date && <span className="date">{image.date}</span>}
          </div>

          <div className="meta-list compact">
            {renderMeta("Role", image.storyRole)}
            {renderMeta("Season", image.season)}
            {renderMeta("Location", image.location)}
            {renderMeta("Mood", image.mood)}
            {renderMeta("Light", image.light)}
          </div>

          <div className="tag-row">
            {image.tags.map((tag) => (
              <span key={tag}>{tag}</span>
            ))}
          </div>

          <textarea
            value={image.notes}
            onChange={(event) => updateNotes(image.id, event.target.value)}
            aria-label={`Notes for ${image.title}`}
            placeholder="Add notes..."
          />

          <div className="button-row">
            <button
              className={image.favorite ? "active" : ""}
              onClick={() => toggleFavorite(image.id)}
            >
              {image.favorite ? "Favorited" : "Favorite"}
            </button>

            <button
              className={image.hero ? "active" : ""}
              onClick={() => toggleHero(image.id)}
            >
              {image.hero ? "Hero image" : "Mark hero"}
            </button>
          </div>
        </div>
      </article>
    );
  }

  return (
    <main className="studio">
      <aside className="sidebar">
        <div>
          <p className="eyebrow">Blomzip Studio</p>
          <h1>Garden image sorting for stories, patterns and proof.</h1>
        </div>

        <div className="sidebar-card">
          <span>Total images</span>
          <strong>{images.length}</strong>
        </div>

        <div className="sidebar-card">
          <span>Showing now</span>
          <strong>
            {filteredImages.length} / {images.length}
          </strong>
        </div>

        <div className="sidebar-card">
          <span>Favorites</span>
          <strong>{favoriteCount}</strong>
        </div>

        <div className="sidebar-card">
          <span>Hero candidates</span>
          <strong>{heroCount}</strong>
        </div>

        <div className="sidebar-card">
          <span>Collections</span>
          <strong>{collectionStats.length}</strong>
        </div>

        <div className="sidebar-card">
          <span>Data source</span>
          <strong>{dataSource}</strong>
        </div>

        <div className="sidebar-card">
          <span>Collection stats</span>
          <div className="collection-stats">
            <button
              className={collectionFilter === "All" ? "active" : ""}
              onClick={() => setCollectionFilter("All")}
            >
              <span>All</span>
              <strong>{images.length}</strong>
            </button>

            {collectionStats.map(([collection, count]) => (
              <button
                key={collection}
                className={collectionFilter === collection ? "active" : ""}
                onClick={() => setCollectionFilter(collection)}
              >
                <span>{collection}</span>
                <strong>{count}</strong>
              </button>
            ))}
          </div>
        </div>

        <ZipImportPanel className="zip-panel" onImportStateChange={({ summary, visit }) => {
          setImportSummary(summary);
          setImportVisit(visit);
        }} />
      </aside>

      <section className="content">
        {isReviewingEntries && importVisit ? (
          <EntryReview
            visit={importVisit}
            onClose={() => setIsReviewingEntries(false)}
            onEntryUpdated={handleImportEntryUpdated}
          />
        ) : importVisit ? (
          <div className="import-mode">
            <section className="import-mode-panel">
              <div className="import-mode-heading">
                <p className="eyebrow">Import mode</p>
                <h2>Import Visit</h2>
                <p className="result-count">
                  The ZIP archive has become an in-memory visit with image records, metadata, a timeline order and review entries.
                </p>
              </div>

              <div className="import-status-list">
                {importStatusItems.map((item) => (
                  <div key={item.label} className={`status-pill ${item.active ? "active" : ""}`}>
                    <span className="status-pill-mark">{item.active ? "✓" : "•"}</span>
                    <div>
                      <strong>{item.label}</strong>
                      <p>{item.detail}</p>
                    </div>
                  </div>
                ))}
              </div>

              <div className="import-next-step">
                <div>
                  <p className="eyebrow">Next</p>
                  <h3>Review entries</h3>
                  <p className="result-count">
                    Step through the in-memory entries and begin shaping observations in the next phase.
                  </p>
                </div>
                <button type="button" onClick={() => setIsReviewingEntries(true)}>
                  Review entries
                </button>
              </div>
            </section>

            <section className="import-preview-section">
              <div className="import-preview-heading">
                <div>
                  <p className="eyebrow">Preview gallery</p>
                  <h3>Imported images</h3>
                </div>
                <span>{importVisit.imageRecords?.length ?? 0} ordered</span>
              </div>

              <div className="preview-gallery">
                {(importVisit.imageRecords ?? []).map((record) => (
                  <div key={record.id} className="preview-card">
                    <div className="preview-thumb">
                      {record.thumbnailUrl ? (
                        <img src={record.thumbnailUrl} alt={record.filename} />
                      ) : (
                        <span>No preview</span>
                      )}
                    </div>
                    <div className="preview-meta">
                      <strong>{record.filename}</strong>
                      <span>#{record.timelineIndex ?? 0}</span>
                      <span>
                        {record.width && record.height ? `${record.width} × ${record.height}` : "Dimensions unavailable"}
                        {record.orientation ? ` • ${record.orientation}` : ""}
                      </span>
                      <span className="preview-entry-badge">0 observations</span>
                      <span className="preview-entry-badge preview-entry-badge-subtle">Ready for AI</span>
                    </div>
                  </div>
                ))}
              </div>
            </section>

            <section className="import-library import-library-secondary">
              <div className="import-preview-heading">
                <div>
                  <p className="eyebrow">Studio library</p>
                  <h3>Existing image collection</h3>
                </div>
              </div>

              <section className={`image-grid ${cardLayout}`}>
                {filteredImages.map((image) => renderImageCard(image))}
              </section>
            </section>
          </div>
        ) : (
          <>
            <header className="toolbar">
              <div>
                <p className="eyebrow">v0.8.5</p>
                <h2>Filtered image count</h2>
                <p className="result-count">
                  Showing {filteredImages.length} of {images.length} images
                </p>
              </div>

              <div className="controls">
                <input
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder="Search images, tags, notes, light or mood..."
                />

                <select
                  value={collectionFilter}
                  onChange={(event) => setCollectionFilter(event.target.value)}
                >
                  {collections.map((collection) => (
                    <option key={collection} value={collection}>
                      {collection}
                    </option>
                  ))}
                </select>
              </div>
            </header>

            <div className="filter-row" aria-label="Image view filters">
              <button
                className={viewFilter === "all" ? "active" : ""}
                onClick={() => setViewFilter("all")}
              >
                All
              </button>

              <button
                className={viewFilter === "favorites" ? "active" : ""}
                onClick={() => setViewFilter("favorites")}
              >
                Favorites
              </button>

              <button
                className={viewFilter === "hero" ? "active" : ""}
                onClick={() => setViewFilter("hero")}
              >
                Hero
              </button>

              <button
                className={cardLayout === "landscape" ? "active" : ""}
                onClick={() => setCardLayout("landscape")}
              >
                Landscape
              </button>

              <button
                className={cardLayout === "portrait" ? "active" : ""}
                onClick={() => setCardLayout("portrait")}
              >
                Portrait
              </button>
            </div>

            <section className={`image-grid ${cardLayout}`}>
              {filteredImages.map((image) => renderImageCard(image))}
            </section>
          </>
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