export type ImageItem = {
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

export const initialImages: ImageItem[] = [
  {
    id: 1,
    title: "Röd stockros mot husvägg",
    collection: "Stockrosor",
    date: "Juni 2026",
    tags: ["röd", "höjd", "husvägg", "kontrast"],
    favorite: true,
    hero: true,
    notes:
      "Stark färgkoppling till fasaden. Bra kandidat för berättelsen om kontrast.",
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
    notes:
      "Bra exempel på kontraster: strävt, lent, rött, grönt, luftigt.",
    color: "linear-gradient(135deg, #c8596b, #e7d8a5)",
  },
];