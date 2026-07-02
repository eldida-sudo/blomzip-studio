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
  src: string;
  alt: string;
  storyRole: string;
  season: string;
  location: string;
  mood: string;
  material: string;
  light: string;
  composition: string;
  importSource: string;
};

export const initialImages: ImageItem[] = [
  {
    id: 1,
    title: "Röd stockros mot husvägg",
    collection: "Stockrosor",
    date: "Juni 2026",
    tags: ["röd", "höjd", "husvägg", "kontrast", "fasad"],
    favorite: true,
    hero: true,
    notes:
      "Stark färgkoppling till fasaden. Bra kandidat för berättelsen om kontrast och hur växter gör huset mer levande.",
    color: "linear-gradient(135deg, #9f2f35, #d8a36f)",
    src: "/images/garden-photo.jpg",
    alt: "Röd stockros nära en varm husvägg.",
    storyRole: "Färg, höjd och kontrast mot fasaden.",
    season: "Försommar",
    location: "Rabatt vid husvägg",
    mood: "Dramatisk men mjuk",
    material: "Blomblad, tegelton, grönska",
    light: "Sidoljus / varm väggreflex",
    composition: "Vertikal växt mot stor färgyta",
    importSource: "Demo / ersätts med innergårdsbild",
  },
  {
    id: 2,
    title: "Innergårdens sittplats",
    collection: "Innergård",
    date: "Juni 2026",
    tags: ["sittplats", "skugga", "rum", "paus", "gårdsrum"],
    favorite: true,
    hero: false,
    notes:
      "Visar hur platsen börjar bli ett rum snarare än bara gård. Viktig för före/efter-berättelsen.",
    color: "linear-gradient(135deg, #42583c, #d8d1b8)",
    src: "/images/courtyard-story.png",
    alt: "Sittplats på innergård med grönska runt omkring.",
    storyRole: "Visar hur gården blir en plats att stanna i.",
    season: "Sommar",
    location: "Sittplatsen vid häcken",
    mood: "Lugn, skyddad, inbjudande",
    material: "Bord, stolar, häck, krukor",
    light: "Skugga / mjukt dagsljus",
    composition: "Blick in mot rabatter istället för parkering",
    importSource: "Demo / ersätts med innergårdsbild",
  },
  {
    id: 3,
    title: "Blandad trädgårdsbukett",
    collection: "Buketter",
    date: "Juni 2026",
    tags: ["bukett", "form", "färg", "struktur", "skörd"],
    favorite: false,
    hero: false,
    notes:
      "Bra exempel på kontraster: strävt, lent, rött, grönt, luftigt. Kan bli egen kategori för fotografiskt urval.",
    color: "linear-gradient(135deg, #c8596b, #e7d8a5)",
    src: "/images/creative-reference.png",
    alt: "Blandad bukett med färg- och formkontraster.",
    storyRole: "Visar skörd, materialkänsla och fotografiskt urval.",
    season: "Sommar",
    location: "Bukett från innergården",
    mood: "Lekfull, taktil, färgrik",
    material: "Stjälkar, blad, kronblad, vas",
    light: "Inomhusljus / fönsterljus",
    composition: "Tät blandning med synliga kontraster",
    importSource: "Demo / ersätts med bukettbild",
  },
];