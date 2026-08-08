import type { ImageRecord } from "../models/blomzip";

function createPlaceholderThumbnailDataUrl(filename: string): string {
  const safeName = filename.trim() || "Imported image";
  const label = safeName.length > 20 ? `${safeName.slice(0, 17)}...` : safeName;
  const escapedLabel = label
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

  const backgroundPalette = ["#c8d7b5", "#e1cfc8", "#bfd9da", "#dfd3b7", "#d5bfd3"];
  const textPalette = ["#2f4632", "#4b2f2f", "#1e3d43", "#43341c", "#45243f"];

  let hash = 0;
  for (let index = 0; index < safeName.length; index += 1) {
    hash = (hash * 31 + safeName.charCodeAt(index)) >>> 0;
  }

  const paletteIndex = hash % backgroundPalette.length;
  const background = backgroundPalette[paletteIndex];
  const foreground = textPalette[paletteIndex];

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="320" height="240" viewBox="0 0 320 240"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0%" stop-color="${background}"/><stop offset="100%" stop-color="#f4efe2"/></linearGradient></defs><rect width="320" height="240" fill="url(#g)" rx="18" ry="18"/><rect x="18" y="18" width="284" height="204" rx="14" ry="14" fill="rgba(255,255,255,0.45)"/><text x="160" y="128" text-anchor="middle" dominant-baseline="middle" fill="${foreground}" font-size="18" font-family="Verdana, Geneva, sans-serif">${escapedLabel}</text></svg>`;

  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

export function createThumbnailUrlForRecord(
  record?: Partial<Pick<ImageRecord, "thumbnailUrl" | "filename">> | null
): string | undefined {
  if (record?.thumbnailUrl) {
    return record.thumbnailUrl;
  }

  if (!record?.filename) {
    return undefined;
  }

  return createPlaceholderThumbnailDataUrl(record.filename);
}

export function revokeThumbnailUrls(records: ImageRecord[]) {
  for (const record of records) {
    if (record.thumbnailUrl?.startsWith("blob:")) {
      URL.revokeObjectURL(record.thumbnailUrl);
    }
  }
}
