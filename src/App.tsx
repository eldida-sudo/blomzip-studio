import { useMemo, useState } from "react";
import { initialImages, type ImageItem } from "./data/demoImages";
import "./App.css";

function App() {
  const [images, setImages] = useState<ImageItem[]>(initialImages);
  const [search, setSearch] = useState("");
  const [collectionFilter, setCollectionFilter] = useState("All");

  const collections = useMemo(() => {
    return ["All", ...Array.from(new Set(images.map((image) => image.collection)))];
  }, [images]);

  const filteredImages = images.filter((image) => {
    const searchText =
      `${image.title} ${image.collection} ${image.tags.join(" ")} ${image.notes} ${image.storyRole} ${image.season} ${image.location}`.toLowerCase();

    const matchesSearch = searchText.includes(search.toLowerCase());
    const matchesCollection =
      collectionFilter === "All" || image.collection === collectionFilter;

    return matchesSearch && matchesCollection;
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
            <p className="eyebrow">v0.4</p>
            <h2>Story-ready image fields</h2>
          </div>

          <div className="controls">
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search images, tags, notes or places..."
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

        <section className="image-grid">
          {filteredImages.map((image) => (
            <article className="image-card" key={image.id}>
              <div className="image-preview" style={{ background: image.color }}>
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
                  <p>
                    <strong>Role:</strong> {image.storyRole}
                  </p>
                  <p>
                    <strong>Season:</strong> {image.season}
                  </p>
                  <p>
                    <strong>Location:</strong> {image.location}
                  </p>
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