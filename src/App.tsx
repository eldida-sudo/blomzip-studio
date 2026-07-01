import './App.css'

const demoImages = [
  {
    id: 'wheel',
    title: 'The Wheel',
    year: '2020',
    category: 'Arrival',
    image: 'https://images.unsplash.com/photo-1501004318641-b39e6451bec6?auto=format&fit=crop&w=900&q=80',
  },
  {
    id: 'evening',
    title: 'Evening Courtyard',
    year: '2020',
    category: 'Evening',
    image: 'https://images.unsplash.com/photo-1500530855697-b586d89ba3ee?auto=format&fit=crop&w=900&q=80',
  },
  {
    id: 'bee',
    title: "Bee on Lamb's Ear",
    year: '2026',
    category: 'Small Worlds',
    image: 'https://images.unsplash.com/photo-1490750967868-88aa4486c946?auto=format&fit=crop&w=900&q=80',
  },
]

function App() {
  return (
    <main className="studio">
      <aside className="sidebar">
        <p className="eyebrow">Blomzip Studio</p>
        <h1>From archive to exhibition.</h1>
        <nav>
          <button>Archive</button>
          <button>Hero Hunt</button>
          <button>Moments</button>
          <button>Loveable Queue</button>
        </nav>
      </aside>

      <section className="workspace">
        <header className="topbar">
          <div>
            <p className="eyebrow">Sprint 1</p>
            <h2>Open the archive</h2>
          </div>
          <input placeholder="Search images, moments, places..." />
        </header>

        <section className="stats">
          <article>
            <span>3</span>
            <p>Demo images</p>
          </article>
          <article>
            <span>0</span>
            <p>Heroes selected</p>
          </article>
          <article>
            <span>0</span>
            <p>Moments created</p>
          </article>
        </section>

        <section className="gallery">
          {demoImages.map((image) => (
            <article className="card" key={image.id}>
              <img src={image.image} alt={image.title} />
              <div>
                <p>{image.category}</p>
                <h3>{image.title}</h3>
                <small>{image.year}</small>
              </div>
            </article>
          ))}
        </section>
      </section>
    </main>
  )
}

export default App