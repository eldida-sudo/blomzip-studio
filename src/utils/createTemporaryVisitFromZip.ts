import { type ImageRecord, type Visit } from "../models/blomzip";
import { type ZipImportSummary } from "./readZipImages";

interface VisitCreationOptions {
  date?: string;
}

function createImageRecords(summary: ZipImportSummary): ImageRecord[] {
  return summary.imageFiles.map((filename, index) => ({
    id: `image-${index}-${filename}`,
    filename,
    fileSize: 0,
    format: filename.split(".").pop()?.toLowerCase() ?? "unknown",
    sourcePath: filename,
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
