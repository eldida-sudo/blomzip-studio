import { type ImageRecord, type Visit } from "../models/blomzip";
import { extractImageMetadata } from "./extractImageMetadata";
import { orderImageRecordsForTimeline } from "./orderImageRecordsForTimeline";
import { type ZipImportSummary } from "./readZipImages";

function createThumbnailUrlFromImageData(data: Uint8Array, fileName: string) {
  const mimeType = fileName.toLowerCase().endsWith("png") ? "image/png" : fileName.toLowerCase().endsWith("webp") ? "image/webp" : "image/jpeg";
  const bytes = data.slice();
  const blob = new Blob([bytes], { type: mimeType });
  return URL.createObjectURL(blob);
}

interface VisitCreationOptions {
  date?: string;
}

function createImageRecords(summary: ZipImportSummary): ImageRecord[] {
  const imageRecords = summary.imageFiles.map((filename, index) => {
    const imageEntry = summary.imageEntries?.[index];
    const metadata = imageEntry?.data ? extractImageMetadata(imageEntry.data, filename) : {};

    return {
      id: `image-${index}-${filename}`,
      filename,
      fileSize: imageEntry?.fileSize ?? 0,
      format: filename.split(".").pop()?.toLowerCase() ?? "unknown",
      sourcePath: filename,
      thumbnailUrl: imageEntry?.data ? createThumbnailUrlFromImageData(imageEntry.data, filename) : undefined,
      ...metadata,
    };
  });

  const { orderedRecords } = orderImageRecordsForTimeline(imageRecords);

  return orderedRecords.map((record, index) => ({
    ...record,
    timelineIndex: index,
  }));
}

export function createTemporaryVisitFromZip(
  summary: ZipImportSummary,
  options: VisitCreationOptions = {}
): Visit | null {
  if (summary.status !== "ready") {
    return null;
  }

  const now = new Date();
  const fallbackDate = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;

  return {
    id: `visit-${summary.fileName}-${summary.imageCount}-${Date.now()}`,
    placeId: "temporary-import",
    date: options.date ?? fallbackDate,
    entries: [],
    imageCount: summary.imageCount,
    importedImageFiles: summary.imageFiles,
    imageRecords: createImageRecords(summary),
    status: "Ready for observations",
  };
}
