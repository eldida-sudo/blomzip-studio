import { useMemo, useState } from "react";
import "./App.css";

type ImageItem = {
  id: number;
  title: string;
  collection: string;
  date: string;
  tags: string[];
  favorite: boolean;
  hero: boolean;
  notes: string;
  color: string;
};

const initialImages: ImageItem[] = [
  {
    id: 1,
    title: "Röd stockros mot husvägg",
    collection: "Stockrosor",
    date: "Juni 2026",
    tags: ["röd", "höjd", "husvägg", "kontrast"],
    favorite: true,
    hero: true,
    notes: "Stark färgkoppling till fasaden. Bra kandidat för berättelsen om kontrast.",
    color: "linear-gradient(135deg, #9f2f35, #d8a36f)",
  },
  {
    id: 2,
    title: "Innergårdens sittplats",
    collection: "Innergård",
    date: "Juni 2026",
    tags: ["sittplats", "skugga", "rum", "paus"],
    favorite: true,
    hero: false,
    notes: "Visar hur platsen börjar bli ett rum snarare än bara gård.",
    color: "linear-gradient(135deg, #42583c, #d8d1b8)",
  },
  {
    id: 3,
    title: "Blandad trädgårdsbukett",
    collection: "Buketter",
    date: "Juni 2026",
    tags: ["bukett", "form", "färg", "struktur"],
    favorite: false,
    hero: false,
    notes: "Bra exempel på kontraster: strävt, lent, rött, grönt, luftigt.",
    color: "linear-gradient(135deg, #c8596b, #e7d8a5)",
  },
];

function App() {
  const [images, setImages] = useState<ImageItem[]>(initialImages);
  const [search, setSearch] = useState("");
  const [collectionFilter, setCollectionFilter] = useState("All");

  const collections = useMemo(() => {
    return ["All", ...Array.from(new Set(images.map((image) => image.collection)))];
  }, [images]);

  const filteredImages = images.filter((image) => {
    const searchText = `${image.title} ${image.collection} ${image.tags.join(" ")} ${image.notes}`.toLowerCase();
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
            <p className="eyebrow">v0.2</p>
            <h2>Favorite / Hero / Collections / Notes</h2>
          </div>

          <div className="controls">
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search images, tags or notes..."
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