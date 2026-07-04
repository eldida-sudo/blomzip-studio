import fs from "fs";
import path from "path";

const imagesRoot = path.join(process.cwd(), "public", "images");
const outputPath = path.join(process.cwd(), "public", "data", "images.json");

const imageExtensions = [".jpg", ".jpeg", ".png", ".webp", ".gif"];

function walk(dir) {
  if (!fs.existsSync(dir)) return [];

  const entries = fs.readdirSync(dir, { withFileTypes: true });

  return entries.flatMap((entry) => {
    const fullPath = path.join(dir, entry.name);

    if (entry.isDirectory()) {
      return walk(fullPath);
    }

    const ext = path.extname(entry.name).toLowerCase();

    if (!imageExtensions.includes(ext)) {
      return [];
    }

    return [fullPath];
  });
}

function createTitle(filename) {
  return filename
    .replace(/\.[^.]+$/, "")
    .replace(/[-_]/g, " ");
}

const existingImages = fs.existsSync(outputPath)
  ? JSON.parse(fs.readFileSync(outputPath, "utf-8"))
  : [];

const existingBySrc = new Map(
  existingImages.map((image) => [image.src, image])
);

const files = walk(imagesRoot);

const images = files.map((filePath, index) => {
  const relativePath = path.relative(imagesRoot, filePath);
  const parts = relativePath.split(path.sep);
  const filename = parts.at(-1);
  const collection = parts.length > 1 ? parts[0] : "Unsorted";
  const src = `/images/${parts.join("/")}`;

  const existing = existingBySrc.get(src);

  if (existing) {
    return {
      ...existing,
      id: index + 1,
      src,
    };
  }

  const title = createTitle(filename);

  return {
    id: index + 1,
    title,
    collection,
    date: "",
    tags: [collection],
    favorite: false,
    hero: false,
    notes: "",
    color: "linear-gradient(135deg, #42583c, #d8d1b8)",
    src,
    alt: title,
    storyRole: "",
    season: "",
    location: collection,
    mood: "",
    material: "",
    light: "",
    composition: "",
    importSource: "Auto folder import",
  };
});

fs.writeFileSync(outputPath, JSON.stringify(images, null, 2));

console.log(`Imported ${images.length} images`);
console.log(`Preserved metadata for ${images.filter((image) => existingBySrc.has(image.src)).length} existing images`);
console.log(`Added ${images.filter((image) => !existingBySrc.has(image.src)).length} new images`);
console.log(`Wrote ${outputPath}`);