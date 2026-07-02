import { useMemo, useState } from "react";
import { initialImages, type ImageItem } from "./data/demoImages";
import "./App.css";

type ViewFilter = "all" | "favorites" | "hero";

function App() {
  const [images, setImages] = useState<ImageItem[]>(initialImages);
  const [search, setSearch] = useState("");
  const [collectionFilter, setCollectionFilter] = useState("All");
  const [viewFilter, setViewFilter] = useState<ViewFilter>("all");

  const collections = useMemo(() => {
    return ["All", ...Array.from(new Set(images.map((image) => image.collection)))];
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
          <span>Favorites</span>
          <strong>{favoriteCount}</strong>
        </div>

        <div className="sidebar-card">
          <span>Hero candidates</span>
          <strong>{heroCount}</strong>
        </div>
      </aside>

      <section className="content">
        <header className="toolbar">
          <div>
            <p className="eyebrow">v0.7</p>
            <h2>Richer metadata for image storytelling</h2>
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
        </div>

        <section className="image-grid">
          {filteredImages.map((image) => (
            <article className="image-card" key={image.id}>
              <div
                className="image-preview"
                style={{ background: image.src ? undefined : image.color }}
              >
                {image.src && <img src={image.src} alt={image.alt} />}
                {image.hero && <span className="hero-badge">Hero</span>}
                {image.favorite && <span className="favorite-badge">★</span>}
              </div>

              <div className="image-body">
                <div className="image-heading">
                  <div>
                    <p className="collection">{image.collection}</p>
                    <h3>{image.title}</h3>
                  </div>
                  <span className="date">{image.date}</span>
                </div>

                <div className="meta-list">
                  <p><strong>Role:</strong> {image.storyRole}</p>
                  <p><strong>Season:</strong> {image.season}</p>
                  <p><strong>Location:</strong> {image.location}</p>
                  <p><strong>Mood:</strong> {image.mood}</p>
                  <p><strong>Light:</strong> {image.light}</p>
                </div>

                <div className="detail-list">
                  <p><strong>Material:</strong> {image.material}</p>
                  <p><strong>Composition:</strong> {image.composition}</p>
                  <p><strong>Import:</strong> {image.importSource}</p>
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
          ))}
        </section>
      </section>
    </main>
  );
}

export default App;
