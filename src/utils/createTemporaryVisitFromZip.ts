import { type Visit } from "../models/blomzip";
import { type ZipImportSummary } from "./readZipImages";

interface VisitCreationOptions {
  date?: string;
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
    status: "Ready for observations",
  };
}
